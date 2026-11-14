"""
backend/routes/comparison.py
Flask REST API Endpoints for Historical Climate Comparison & Analytics.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Serves:
  - GET /api/comparison
  - GET /api/sonify/comparison
"""

import re
from typing import Tuple, Optional
import numpy as np
from flask import Blueprint, jsonify, request

from backend.sonification.engine import default_engine

comparison_bp = Blueprint("comparison", __name__, url_prefix="/api")

DATE_REGEX = re.compile(r"^\d{4}(?:-(?:0[1-9]|1[0-2]))?$")


def _parse_period_string(period_str: str) -> Tuple[Optional[str], Optional[str]]:
    """Parse comma-separated date period string into (start, end)."""
    if not period_str:
        return None, None
    parts = [p.strip() for p in period_str.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    elif len(parts) == 1:
        return parts[0], parts[0]
    return None, None


@comparison_bp.route("/comparison", methods=["GET"])
@comparison_bp.route("/sonify/comparison", methods=["GET"])
def get_comparison():
    """
    Dual-Period Historical Comparison Tool.
    Compares two distinct historical epochs, returns comparative analytics and
    URLs for Period A audio, Period B audio, and Differential audio.

    Query parameters:
      - dataset_id: string (required)
      - periodA: string (required, 'YYYY-MM,YYYY-MM')
      - periodB: string (required, 'YYYY-MM,YYYY-MM')
      - duration: float in seconds (default: 15.0, range: [1.0, 60.0])
    """
    dataset_id = request.args.get("dataset_id")
    period_a_str = request.args.get("periodA")
    period_b_str = request.args.get("periodB")

    if not dataset_id or not period_a_str or not period_b_str:
        return jsonify({
            "error": "Missing required query parameters",
            "message": "Query parameters 'dataset_id', 'periodA', and 'periodB' are required."
        }), 400

    canon = default_engine.canonical_id(dataset_id)
    if not canon:
        return jsonify({
            "error": "Dataset not found",
            "message": f"Dataset '{dataset_id}' is not recognized.",
            "available_datasets": [
                "surface-temperature",
                "atmospheric-co2",
                "ocean-temperature",
                "sea-ice-extent"
            ]
        }), 404

    a_start, a_end = _parse_period_string(period_a_str)
    b_start, b_end = _parse_period_string(period_b_str)

    if not a_start or not a_end or not b_start or not b_end:
        return jsonify({
            "error": "Invalid period format",
            "message": "Both periodA and periodB must be formatted as 'YYYY-MM,YYYY-MM'."
        }), 400

    duration_arg = request.args.get("duration", "15.0")
    try:
        duration = float(duration_arg)
        duration = max(1.0, min(60.0, duration))
    except (ValueError, TypeError):
        duration = 15.0

    try:
        months_a, vals_a = default_engine.get_timeseries_slice(canon, a_start, a_end)
        months_b, vals_b = default_engine.get_timeseries_slice(canon, b_start, b_end)

        mean_a = float(np.mean(vals_a))
        mean_b = float(np.mean(vals_b))
        delta_mean = mean_b - mean_a

        if abs(mean_a) > 1e-6:
            percent_change = float((delta_mean / abs(mean_a)) * 100.0)
        else:
            percent_change = 0.0

        audio_url_a = f"/api/sonify/{canon}?start={a_start}&end={a_end}&duration={duration:.0f}"
        audio_url_b = f"/api/sonify/{canon}?start={b_start}&end={b_end}&duration={duration:.0f}"
        diff_audio_url = (
            f"/api/sonify/differential?dataset_id={canon}&periodA={period_a_str}&periodB={period_b_str}"
            f"&duration={duration:.0f}"
        )

        return jsonify({
            "dataset_id": canon,
            "periodA": {
                "range": period_a_str,
                "start": a_start,
                "end": a_end,
                "months_count": len(months_a),
                "mean": round(mean_a, 4),
                "min": round(float(np.min(vals_a)), 4),
                "max": round(float(np.max(vals_a)), 4),
                "audio_url": audio_url_a
            },
            "periodB": {
                "range": period_b_str,
                "start": b_start,
                "end": b_end,
                "months_count": len(months_b),
                "mean": round(mean_b, 4),
                "min": round(float(np.min(vals_b)), 4),
                "max": round(float(np.max(vals_b)), 4),
                "audio_url": audio_url_b
            },
            "difference": {
                "delta_mean": round(delta_mean, 4),
                "percent_change": round(percent_change, 2),
                "differential_audio_url": diff_audio_url
            }
        }), 200

    except Exception as e:
        return jsonify({
            "error": "Comparison calculation failed",
            "message": str(e)
        }), 500
