"""
backend/routes/datasets.py
REST API endpoints for NASA Earth Science Observation datasets.
Serves:
  - GET /api/datasets
  - GET /api/timeseries/<dataset_id>
  - GET /api/timeseries/harmonized
  - GET /api/timeseries/zonal
  - GET /api/health
"""

import os
import json
import re
from flask import Blueprint, jsonify, request, current_app

datasets_bp = Blueprint("datasets", __name__, url_prefix="/api")

# Memory caches for processed data
_CACHE = {
    "harmonized": None,
    "annual": None,
    "zonal": None,
    "metadata": None,
}


def _get_config():
    return current_app.config


def _load_json(file_key, config_attr):
    if _CACHE[file_key] is None:
        path = current_app.config.get(config_attr)
        if not path or not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            _CACHE[file_key] = json.load(f)
    return _CACHE[file_key]


def get_metadata():
    return _load_json("metadata", "METADATA_PATH")


def get_harmonized():
    return _load_json("harmonized", "HARMONIZED_PATH")


def get_annual():
    return _load_json("annual", "ANNUAL_HARMONIZED_PATH")


def get_zonal():
    return _load_json("zonal", "ZONAL_PATH")


# Canonical alias map for dataset IDs
DATASET_ALIASES = {
    "global_surface_temperature": "global_surface_temperature",
    "nasa_giss_gistemp_v4": "global_surface_temperature",
    "temperature": "global_surface_temperature",
    "temp": "global_surface_temperature",
    "gistemp": "global_surface_temperature",

    "atmospheric_co2": "atmospheric_co2",
    "noaa_gml_mauna_loa_co2": "atmospheric_co2",
    "co2": "atmospheric_co2",
    "carbon_dioxide": "atmospheric_co2",
    "keeling": "atmospheric_co2",

    "ocean_temperature": "ocean_temperature",
    "noaa_ncei_global_ocean_temp": "ocean_temperature",
    "ocean_temp": "ocean_temperature",
    "ocean": "ocean_temperature",

    "sea_ice_extent": "sea_ice_extent",
    "nsidc_sea_ice_index_v4": "sea_ice_extent",
    "sea_ice": "sea_ice_extent",
    "ice": "sea_ice_extent",
    "arctic_sea_ice": "sea_ice_extent",

    # Hyphenated canonical IDs. These are the IDs the sonification engine, the
    # comparison panel and /api/sonify/<id> use, and the frontend asks
    # /api/timeseries/surface-temperature with them — but this table only had
    # underscored aliases, so those calls 404'd while /api/sonify succeeded.
    "surface-temperature": "global_surface_temperature",
    "global-surface-temperature": "global_surface_temperature",
    "atmospheric-co2": "atmospheric_co2",
    "ocean-temperature": "ocean_temperature",
    "ocean-temp": "ocean_temperature",
    "sea-ice-extent": "sea_ice_extent",
    "sea-ice": "sea_ice_extent",
}

DATE_REGEX = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")


def validate_date(date_str, param_name="date"):
    """Validate YYYY-MM date string."""
    if not date_str:
        return True, None
    if not DATE_REGEX.match(date_str):
        return False, f"Invalid {param_name} format '{date_str}'. Expected 'YYYY-MM' (e.g. 2000-01)."
    return True, None


@datasets_bp.route("/health", methods=["GET"])
def health_check():
    """Health status and dataset availability check."""
    meta = get_metadata()
    harm = get_harmonized()
    zonal = get_zonal()

    all_present = all([meta is not None, harm is not None, zonal is not None])

    # Check NASA SVS/EIC layer readiness across all 4 layers
    processed_dir = current_app.config.get("PROCESSED_DATA_DIR")
    if not processed_dir:
        base_dir = current_app.config.get("BASE_DIR", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        processed_dir = os.path.join(base_dir, "data", "processed")
    layers_dir = os.path.join(processed_dir, "layers")
    required_layers = ["night_lights", "lightning", "gedi_forest", "co2_dyamond"]
    layers_ready = bool(
        os.path.isdir(layers_dir) and all(
            os.path.exists(os.path.join(layers_dir, f"{lid}.json"))
            for lid in required_layers
        )
    )

    return jsonify({
        "status": "healthy" if all_present else "degraded",
        "service": "EARTHSONIC Dataset API",
        "authenticity_verification": "100% Authentic NASA/NOAA Observations (0% Synthetic)",
        "datasets_ready": all_present,
        "layers_ready": layers_ready,
        "total_harmonized_months": len(harm["months"]) if harm else 0,
        "harmonized_period": harm["period"] if harm else None,
    }), 200 if all_present else 503


@datasets_bp.route("/datasets", methods=["GET"])
def list_datasets():
    """
    List all authentic NASA Earth science observation datasets and their metadata.
    """
    meta = get_metadata()
    if not meta:
        return jsonify({"error": "Dataset metadata not found. Preprocessing may not have run."}), 500

    # Return full metadata catalog with array of datasets for convenient frontend consumption
    response = dict(meta)
    response["dataset_list"] = list(meta.get("datasets", {}).values())
    return jsonify(response), 200


@datasets_bp.route("/datasets/<dataset_id>", methods=["GET"])
def get_dataset_info(dataset_id):
    """
    Get detailed scientific metadata for a specific dataset ID.
    """
    meta = get_metadata()
    if not meta:
        return jsonify({"error": "Dataset metadata not found."}), 500

    canonical_id = DATASET_ALIASES.get(dataset_id.lower())
    if not canonical_id or canonical_id not in meta.get("datasets", {}):
        available = list(meta.get("datasets", {}).keys())
        return jsonify({
            "error": f"Dataset '{dataset_id}' not found.",
            "available_datasets": available
        }), 404

    return jsonify(meta["datasets"][canonical_id]), 200


@datasets_bp.route("/timeseries/<dataset_id>", methods=["GET"])
def get_timeseries(dataset_id):
    """
    Get time series observations for a specific dataset.
    Query parameters:
      - start: YYYY-MM (optional filter start)
      - end: YYYY-MM (optional filter end)
    Returns:
      {
        dataset_id, title, units, baseline, start, end, count,
        data: [{ date, value, normalized }]
      }
    """
    canonical_id = DATASET_ALIASES.get(dataset_id.lower())
    meta = get_metadata()
    harm = get_harmonized()

    if not harm or not meta:
        return jsonify({"error": "Processed datasets not available."}), 500

    if not canonical_id or canonical_id not in meta.get("datasets", {}):
        available = sorted(list(meta.get("datasets", {}).keys()))
        return jsonify({
            "error": f"Unknown dataset ID '{dataset_id}'.",
            "available_datasets": available
        }), 404

    start_param = request.args.get("start")
    end_param = request.args.get("end")
    if start_param:
        start_param = start_param.strip()
    if end_param:
        end_param = end_param.strip()

    # Validate date parameters
    valid, err = validate_date(start_param, "start")
    if not valid:
        return jsonify({"error": err}), 400
    valid, err = validate_date(end_param, "end")
    if not valid:
        return jsonify({"error": err}), 400

    if start_param and end_param and start_param > end_param:
        return jsonify({"error": f"start parameter '{start_param}' cannot be after end '{end_param}'."}), 400

    meta_info = meta["datasets"][canonical_id]

    # Map canonical ID to record property names
    prop_map = {
        "global_surface_temperature": ("temperature_anomaly", "normalized_temperature"),
        "atmospheric_co2": ("co2_ppm", "normalized_co2"),
        "ocean_temperature": ("ocean_temp_anomaly", "normalized_ocean_temp"),
        "sea_ice_extent": ("sea_ice_extent", "normalized_sea_ice_loss"),
    }

    val_prop, norm_prop = prop_map[canonical_id]

    data_points = []
    for rec in harm.get("records", []):
        date_str = rec["date"]
        if start_param and date_str < start_param:
            continue
        if end_param and date_str > end_param:
            continue

        data_points.append({
            "date": date_str,
            "year": rec["year"],
            "month": rec["month"],
            "value": rec.get(val_prop),
            "normalized": rec.get(norm_prop),
        })

    effective_start = data_points[0]["date"] if data_points else start_param
    effective_end = data_points[-1]["date"] if data_points else end_param

    return jsonify({
        "dataset_id": canonical_id,
        "title": meta_info.get("title"),
        "variable": meta_info.get("variable"),
        "agency": meta_info.get("agency"),
        "units": meta_info.get("units"),
        "baseline": meta_info.get("baseline"),
        "sonification_mapping": meta_info.get("sonification_mapping"),
        "start": effective_start,
        "end": effective_end,
        "count": len(data_points),
        "data": data_points
    }), 200


@datasets_bp.route("/timeseries/harmonized", methods=["GET"])
def get_harmonized_timeseries():
    """
    Get synchronized 4-track harmonized time series (Global Surface Temp, CO2, Ocean Temp, Sea Ice).
    Query parameters:
      - start: YYYY-MM (optional, default 1979-01)
      - end: YYYY-MM (optional, default 2026-09)
    """
    harm = get_harmonized()
    if not harm:
        return jsonify({"error": "Harmonized dataset not available."}), 500

    start_param = request.args.get("start")
    end_param = request.args.get("end")
    if start_param:
        start_param = start_param.strip()
    if end_param:
        end_param = end_param.strip()

    valid, err = validate_date(start_param, "start")
    if not valid:
        return jsonify({"error": err}), 400
    valid, err = validate_date(end_param, "end")
    if not valid:
        return jsonify({"error": err}), 400

    if start_param and end_param and start_param > end_param:
        return jsonify({"error": f"start parameter '{start_param}' cannot be after end '{end_param}'."}), 400

    records = harm.get("records", [])
    if start_param or end_param:
        filtered_records = []
        for r in records:
            d = r["date"]
            if start_param and d < start_param:
                continue
            if end_param and d > end_param:
                continue
            filtered_records.append(r)
        records = filtered_records

    months = [r["date"] for r in records]
    temps = [r["temperature_anomaly"] for r in records]
    co2s = [r["co2_ppm"] for r in records]
    oceans = [r["ocean_temp_anomaly"] for r in records]
    ices = [r["sea_ice_extent"] for r in records]

    norm_t = [r["normalized_temperature"] for r in records]
    norm_c = [r["normalized_co2"] for r in records]
    norm_o = [r["normalized_ocean_temp"] for r in records]
    norm_il = [r["normalized_sea_ice_loss"] for r in records]
    norm_ie = [r["normalized_sea_ice_extent"] for r in records]

    start_date = months[0] if months else start_param
    end_date = months[-1] if months else end_param

    return jsonify({
        "description": "EARTHSONIC Harmonized 4-Track NASA/NOAA Monthly Observations",
        "period": {
            "start": start_date,
            "end": end_date,
            "total_months": len(months),
        },
        "total_months": len(months),
        "months": months,
        "temperature_anomaly": temps,
        "co2_ppm": co2s,
        "ocean_temp_anomaly": oceans,
        "sea_ice_extent": ices,
        "normalized": {
            "temperature": norm_t,
            "co2": norm_c,
            "ocean_temp": norm_o,
            "sea_ice_loss": norm_il,
            "sea_ice_extent": norm_ie,
        },
        "records": records,
        "statistics": harm.get("statistics")
    }), 200


@datasets_bp.route("/timeseries/zonal", methods=["GET"])
def get_zonal_timeseries():
    """
    Get annual GISTEMP zonal temperature anomalies across 14 latitude bands (1880-2025).
    Query parameters:
      - start: YYYY (optional, e.g. 1950)
      - end: YYYY (optional, e.g. 2025)
    """
    zonal = get_zonal()
    if not zonal:
        return jsonify({"error": "Zonal temperature dataset not available."}), 500

    start_year = request.args.get("start")
    end_year = request.args.get("end")
    if start_year:
        start_year = start_year.strip()
    if end_year:
        end_year = end_year.strip()

    try:
        start_y = int(start_year) if start_year else None
        end_y = int(end_year) if end_year else None
    except ValueError:
        return jsonify({"error": "Year parameters start/end must be valid 4-digit integers."}), 400

    if start_y and end_y and start_y > end_y:
        return jsonify({"error": "start year cannot be greater than end year."}), 400

    records = zonal.get("records", [])
    if start_y or end_y:
        filtered = []
        for r in records:
            y = r["year"]
            if start_y and y < start_y:
                continue
            if end_y and y > end_y:
                continue
            filtered.append(r)
        records = filtered

    return jsonify({
        "title": "NASA GISTEMP v4 Zonal Annual Temperature Anomalies",
        "units": "°C",
        "baseline": "1951-1980 mean",
        "bands": zonal.get("bands", []),
        "count": len(records),
        "records": records
    }), 200
