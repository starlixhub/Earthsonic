"""
backend/routes/layers.py
REST API Endpoints for NASA SVS/EIC Visual Observation Layers.
Part of EARTHSONIC — NASA Space Apps Challenge 2026.

Serves:
  - GET /api/layers (layer catalog, metadata, original sonification mappings)
  - GET /api/layers/<layer_id> (processed JSON with {meta, columns, events})
  - GET /api/layers/<layer_id>/sonify (cached 44.1 kHz 16-bit stereo WAV)
"""

import hashlib
import json
import math
import os
from typing import Any, Dict, List, Optional
from flask import Blueprint, current_app, jsonify, request, send_file
import numpy as np

from backend.sonification.image_sonifier import synthesize_wav

layers_bp = Blueprint("layers", __name__, url_prefix="/api")

# Canonical NASA SVS layer identifiers
REQUIRED_LAYER_IDS: List[str] = [
    "night_lights",
    "lightning",
    "gedi_forest",
    "co2_dyamond"
]

# Alias map for flexible slug resolution
LAYER_ALIASES: Dict[str, str] = {
    "night_lights": "night_lights",
    "night-lights": "night_lights",
    "nightlights": "night_lights",
    "lightning": "lightning",
    "iss_lightning": "lightning",
    "iss-lightning": "lightning",
    "gedi_forest": "gedi_forest",
    "gedi-forest": "gedi_forest",
    "gedi": "gedi_forest",
    "co2_dyamond": "co2_dyamond",
    "co2-dyamond": "co2_dyamond",
    "dyamond": "co2_dyamond",
}

# In-memory caches to avoid repetitive disk I/O
_LAYER_DATA_CACHE: Dict[str, Dict[str, Any]] = {}
_METADATA_CACHE: Optional[Dict[str, Any]] = None


def _get_project_root() -> str:
    """Return absolute path to the project root directory."""
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.dirname(os.path.dirname(pkg_dir))


def _get_layers_dir() -> str:
    """Get absolute path to processed layers directory."""
    if current_app:
        processed_dir = current_app.config.get("PROCESSED_DATA_DIR")
        if processed_dir:
            return os.path.join(processed_dir, "layers")
    return os.path.join(_get_project_root(), "data", "processed", "layers")


def _get_metadata_path() -> str:
    """Get absolute path to metadata.json."""
    if current_app:
        meta_path = current_app.config.get("METADATA_PATH")
        if meta_path:
            return meta_path
    return os.path.join(
        _get_project_root(), "data", "processed", "metadata.json"
    )


def _canonical_layer_id(layer_id: str) -> Optional[str]:
    """Normalize and validate a layer slug."""
    if not layer_id:
        return None
    normalized = layer_id.strip().lower()
    return LAYER_ALIASES.get(normalized)


def _load_metadata() -> Optional[Dict[str, Any]]:
    """Loads and caches data/processed/metadata.json."""
    global _METADATA_CACHE
    if _METADATA_CACHE is None:
        path = _get_metadata_path()
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                _METADATA_CACHE = json.load(f)
    return _METADATA_CACHE


def _load_layer_data(canonical_id: str) -> Optional[Dict[str, Any]]:
    """Loads and caches processed JSON data for a specific layer."""
    if canonical_id not in _LAYER_DATA_CACHE:
        file_path = os.path.join(_get_layers_dir(), f"{canonical_id}.json")
        if not os.path.exists(file_path):
            return None
        with open(file_path, "r", encoding="utf-8") as f:
            _LAYER_DATA_CACHE[canonical_id] = json.load(f)
    return _LAYER_DATA_CACHE[canonical_id]


@layers_bp.route("/layers", methods=["GET"])
def list_layers():
    """
    GET /api/layers
    Returns catalog and metadata for all 4 NASA SVS visual layers,
    including original sound mapping documentation with rationales.
    """
    meta_json = _load_metadata()
    layers_meta = meta_json.get("layers", {}) if meta_json else {}

    layers_list = []
    default_bounds = {"lon": [-180.0, 180.0], "lat": [-90.0, 90.0]}
    for layer_id in REQUIRED_LAYER_IDS:
        meta = layers_meta.get(layer_id)
        if not meta:
            layer_data = _load_layer_data(layer_id)
            if layer_data and "meta" in layer_data:
                meta = layer_data["meta"]
            else:
                meta = {"id": layer_id}

        layer_entry = {
            "id": layer_id,
            "title": meta.get("title", layer_id),
            "source_name": meta.get("source_name", ""),
            "source_url": meta.get("source_url", ""),
            "svs_id": meta.get("svs_id", ""),
            "agency": meta.get("agency", ""),
            "units": meta.get("units", ""),
            "bounds": meta.get("bounds", default_bounds),
            "frame_count": meta.get("frame_count", 1),
            "date": meta.get("date", ""),
            "sha256": meta.get("sha256", ""),
            "texture": meta.get("texture", f"/assets/layers/{layer_id}.jpg"),
            "column_count": meta.get("column_count", 720),
            "event_count": meta.get("event_count", 0),
            "sonification_mapping": meta.get("sonification_mapping", {}),
            "meta": meta
        }
        layers_list.append(layer_entry)

    return jsonify({
        "status": "success",
        "count": len(layers_list),
        "layers": layers_list,
        "layers_list": layers_list,
        "layers_dict": {layer["id"]: layer for layer in layers_list}
    }), 200


@layers_bp.route("/layers/<layer_id>", methods=["GET"])
def get_layer(layer_id: str):
    """
    GET /api/layers/<layer_id>
    Returns the processed JSON data schema {meta, columns, events}.
    Returns HTTP 404 with error JSON if layer is missing or unknown.
    """
    canonical = _canonical_layer_id(layer_id)
    if not canonical:
        return jsonify({
            "error": f"Layer '{layer_id}' not found.",
            "status_code": 404,
            "available_layers": REQUIRED_LAYER_IDS
        }), 404

    data = _load_layer_data(canonical)
    if not data:
        return jsonify({
            "error": f"Layer data file for '{canonical}' not found on server.",
            "status_code": 404
        }), 404

    return jsonify(data), 200


@layers_bp.route("/layers/<layer_id>/sonify", methods=["GET"])
def sonify_layer(layer_id: str):
    """
    GET /api/layers/<layer_id>/sonify?duration=20
    Serves cached 44.1 kHz 16-bit PCM stereo WAV audio synthesized from
    equirectangular layer columns and events.
    Validates duration > 0, clamps to maximum 60.0s.
    """
    canonical = _canonical_layer_id(layer_id)
    if not canonical:
        return jsonify({
            "error": f"Layer '{layer_id}' not found.",
            "status_code": 404,
            "available_layers": REQUIRED_LAYER_IDS
        }), 404

    duration_arg = request.args.get("duration", "20.0")
    try:
        duration = float(duration_arg)
    except (ValueError, TypeError):
        return jsonify({
            "error": (
                f"Invalid duration value '{duration_arg}'. "
                "Duration must be a positive number."
            ),
            "status_code": 400
        }), 400

    if math.isnan(duration) or math.isinf(duration):
        return jsonify({
            "status": "error",
            "message": "Invalid duration: must be a finite positive number"
        }), 400

    if duration <= 0:
        return jsonify({
            "error": "Duration must be greater than 0 seconds.",
            "status_code": 400
        }), 400

    # Safely clamp duration to maximum 60 seconds
    duration = min(60.0, duration)

    # Determine audio cache directory
    if current_app:
        cache_dir = current_app.config.get("AUDIO_CACHE_DIR")
    else:
        cache_dir = os.path.join(
            _get_project_root(), "backend", "cache", "audio"
        )
    os.makedirs(cache_dir, exist_ok=True)

    # Deterministic cache key matching existing cache pattern
    cache_raw = f"layer|{canonical}|{duration:.2f}|44100"
    cache_hash = hashlib.sha256(cache_raw.encode("utf-8")).hexdigest()
    cached_path = os.path.join(cache_dir, f"{cache_hash}.wav")

    # If cached file does not exist or is invalid header-only, synthesize
    if not (os.path.exists(cached_path) and os.path.getsize(cached_path) > 44):
        layer_data = _load_layer_data(canonical)
        if not layer_data:
            return jsonify({
                "error": (
                    f"Layer data for '{canonical}' not "
                    "available for synthesis."
                ),
                "status_code": 500
            }), 500

        columns = layer_data.get("columns", [])
        events = layer_data.get("events", [])

        # Deterministic seed for reproducible noise bursts
        seed = int(cache_hash[:8], 16)
        np.random.seed(seed)

        wav_bytes = synthesize_wav(
            layer_id=canonical,
            columns=columns,
            events=events,
            duration=duration,
            sample_rate=44100
        )
        with open(cached_path, "wb") as f:
            f.write(wav_bytes)

    response = send_file(
        cached_path,
        mimetype="audio/wav",
        as_attachment=False,
        download_name=f"{canonical}_{duration:.0f}s.wav"
    )
    response.headers["Accept-Ranges"] = "bytes"
    response.headers["Cache-Control"] = "public, max-age=604800, immutable"
    return response
