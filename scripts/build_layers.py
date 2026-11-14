#!/usr/bin/env python3
"""
scripts/build_layers.py
Authentic NASA SVS/EIC Data Ingestion & Feature Preprocessing Pipeline.
Part of EARTHSONIC — NASA Space Apps Challenge 2026: "The Earth Information Jukebox".

Responsibilities:
  1. Verifies availability of raw NASA SVS visual assets in data/raw/svs/<layer>/
     - If raw files are missing, halts cleanly and prints a complete list of
       authoritative NASA SVS source URLs and expected filenames.
     - Supports `--download` (or `--fetch`) to pull authentic assets directly from NASA SVS.
  2. Resizes frames to 720x360 equirectangular grid (lon -180..180, lat 90..-90).
  3. Computes per-column normalized [0.0, 1.0] metrics:
     luminance, hue, pixel density, vertical centroid.
  4. Computes layer-specific features:
     - night_lights: 2012 vs 2023 signed delta and positive delta
     - lightning: discrete strike event detection (coordinates, intensity, time)
     - gedi_forest: column mean canopy height and height variance
     - co2_dyamond: column concentration profile and brightness
  5. Outputs authentic data/processed/layers/<layer>.json (100% NASA observation derived).
  6. Generates pre-resized textures in frontend/assets/layers/<layer>.jpg (<= 2048x1024).
  7. Registers checksums in data/checksums.sha256.
  8. Catalogs metadata in data/processed/metadata.json.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.sonification.image_sonifier import (
    GRID_WIDTH,
    GRID_HEIGHT,
    ImageSonifier,
)

DATA_RAW_SVS = PROJECT_ROOT / "data" / "raw" / "svs"
DATA_PROCESSED_LAYERS = PROJECT_ROOT / "data" / "processed" / "layers"
FRONTEND_ASSETS_LAYERS = PROJECT_ROOT / "frontend" / "assets" / "layers"
CHECKSUMS_FILE = PROJECT_ROOT / "data" / "checksums.sha256"
METADATA_FILE = PROJECT_ROOT / "data" / "processed" / "metadata.json"

USER_AGENT = "EARTHSONIC-DataFetcher/1.0 (NASA Space Apps Challenge 2026; scientific educational use)"

# Authoritative NASA SVS Layer Asset Specifications
LAYER_SPECS: Dict[str, Dict[str, Any]] = {
    "night_lights": {
        "id": "night_lights",
        "svs_id": 5276,
        "title": "Night Lights Change between 2012 and 2023",
        "source_name": "Change in Night Lights between 2012 and 2023",
        "source_url": "https://svs.gsfc.nasa.gov/5276/",
        "agency": "NASA Scientific Visualization Studio / Black Marble / Kel Elkins (USRA)",
        "units": "nW/(cm^2*sr) radiance change",
        "bounds": {"lon": [-180.0, 180.0], "lat": [-90.0, 90.0]},
        "frame_count": 2,
        "date": "2012-2023",
        "files": {
            "2012": {
                "filename": "nightlights_2012.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a005200/a005276/nightlights_flat_series_stills_8k_compare.02012.jpg",
                "fallback_url": "https://svs.gsfc.nasa.gov/vis/a000000/a005200/a005276/nightlights_2012-2023_change_flat.02599_print.jpg",
                "description": "Annual average equirectangular nighttime lights radiance map for 2012"
            },
            "2023": {
                "filename": "nightlights_2023.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a005200/a005276/nightlights_flat_series_stills_8k_compare.02023.jpg",
                "description": "Annual average equirectangular nighttime lights radiance map for 2023"
            },
            "change": {
                "filename": "nightlights_change.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a005200/a005276/nightlights_flat_change_still_8k.00700.jpg",
                "description": "Decadal net change still map (purple=increase, orange=decrease)"
            }
        },
        "sonification_mapping": {
            "audio_parameter": "stereo split & octave difference shift",
            "musical_range": "A3 (220 Hz) to A4 (440 Hz)",
            "neutral_point": "0.0 radiance delta",
            "rationale": "2012 lights route to the left channel while 2023 lights route to the right channel, with positive electrification anomalies triggering a one-octave leap."
        }
    },
    "lightning": {
        "id": "lightning",
        "svs_id": 5011,
        "title": "Lightning Events Detected from the International Space Station (ISS) 2017-2023",
        "source_name": "Lightning Events Detected from the International Space Station (ISS) 2017-2023",
        "source_url": "https://svs.gsfc.nasa.gov/5011/",
        "agency": "NASA GHRC DAAC / Lightning Imaging Sensor (LIS) on ISS",
        "units": "flash count & optical radiance",
        "bounds": {"lon": [-180.0, 180.0], "lat": [-90.0, 90.0]},
        "frame_count": 1,
        "date": "2017-2023",
        "files": {
            "master": {
                "filename": "iss_lightning.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a005000/a005011/iss_lightning_sos_yearly_debug_2023_sos_2048p60.00420_print.jpg",
                "description": "Equirectangular SOS composite map of ISS LIS lightning events 2017-2023"
            }
        },
        "sonification_mapping": {
            "audio_parameter": "percussive spatialized bursts",
            "musical_range": "220 Hz to 880 Hz",
            "neutral_point": "Quiet ionosphere baseline",
            "rationale": "Detected optical lightning flashes trigger percussive audio hits with strike intensity governing velocity, latitude governing pitch, and longitude governing stereo pan."
        }
    },
    "gedi_forest": {
        "id": "gedi_forest",
        "svs_id": 4950,
        "title": "GEDI Global Forest Canopy Height",
        "source_name": "GEDI Forest Canopy Height",
        "source_url": "https://svs.gsfc.nasa.gov/4950/",
        "agency": "NASA GEDI Mission / University of Maryland / Kel Elkins (USRA)",
        "units": "meters (canopy height)",
        "bounds": {"lon": [-180.0, 180.0], "lat": [-90.0, 90.0]},
        "frame_count": 1,
        "date": "2019-2023",
        "files": {
            "master": {
                "filename": "gedi_forest.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a004900/a004950/GEDI_global.0900_print.jpg",
                "description": "Global forest canopy height map from ISS GEDI LiDAR elevation measurements"
            }
        },
        "sonification_mapping": {
            "audio_parameter": "canopy pitch & detuned chorus",
            "musical_range": "F3 (174.6 Hz) to F5 (698.4 Hz)",
            "neutral_point": "0 meters canopy floor",
            "rationale": "Column mean canopy height drives resonant fundamental chime pitch while vertical height variance expands acoustic detuning and chorus width."
        }
    },
    "co2_dyamond": {
        "id": "co2_dyamond",
        "svs_id": 5436,
        "title": "DYAMOND Global Atmospheric Carbon Dioxide",
        "source_name": "DYAMOND Global Carbon Dioxide for Science On A Sphere",
        "source_url": "https://svs.gsfc.nasa.gov/5436/",
        "agency": "NASA GMAO / GEOS Simulation / Science On A Sphere",
        "units": "ppm (parts per million)",
        "bounds": {"lon": [-180.0, 180.0], "lat": [-90.0, 90.0]},
        "frame_count": 1,
        "date": "2020-01-20 to 2020-02-28",
        "files": {
            "master": {
                "filename": "co2_dyamond.jpg",
                "url": "https://svs.gsfc.nasa.gov/vis/a000000/a005400/a005436/dyamondPointCloud_1-29-2025a_dyamond_co2_sos_surface_8k.00001_print.jpg",
                "description": "Equirectangular SOS surface frame of ultra-high resolution GEOS CO2 simulation"
            }
        },
        "sonification_mapping": {
            "audio_parameter": "carrier pitch & harmonic overtone brightness",
            "musical_range": "C3 (130.8 Hz) to C5 (523.25 Hz)",
            "neutral_point": "400 ppm baseline",
            "rationale": "Simulated atmospheric CO2 concentration elevates carrier frequency while plume density increases overtone brightness as the sweep moves through the timeline."
        }
    }
}


def compute_sha256(filepath: Path) -> str:
    """Computes hexadecimal SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def check_missing_assets() -> List[Dict[str, str]]:
    """
    Checks data/raw/svs/<layer>/ for required files.
    Returns list of missing asset descriptors.
    """
    missing = []
    for layer_id, spec in LAYER_SPECS.items():
        layer_dir = DATA_RAW_SVS / layer_id
        for key, finfo in spec["files"].items():
            expected_path = layer_dir / finfo["filename"]
            if not expected_path.exists() or expected_path.stat().st_size == 0:
                missing.append({
                    "layer": layer_id,
                    "svs_id": str(spec["svs_id"]),
                    "file": finfo["filename"],
                    "url": finfo["url"],
                    "description": finfo["description"],
                    "path": str(expected_path)
                })
    return missing


def print_missing_report(missing: List[Dict[str, str]]):
    """Prints a clean, formatted diagnostic table of missing NASA source assets."""
    print("=" * 80)
    print("EARTHSONIC NASA SVS / EIC ASSET INGESTION CHECK")
    print("Zero Synthetic Data Policy — 100% Authentic NASA Observations Required")
    print("=" * 80)
    print(f"Status: {len(missing)} required authentic NASA source asset(s) not found on disk.\n")
    print(f"{'Layer':<14} {'SVS ID':<8} {'Filename':<26} {'Source URL'}")
    print("-" * 80)
    for item in missing:
        print(f"{item['layer']:<14} {item['svs_id']:<8} {item['file']:<26} {item['url']}")
    print("-" * 80)
    print("\nTo download these authentic NASA assets automatically, run:")
    print("    python scripts/build_layers.py --download\n")
    print("Or download each file manually from the URLs above and place into:")
    print(f"    {DATA_RAW_SVS}\\<layer>\\<filename>\n")


def download_file(url: str, dest_path: Path, timeout: int = 30):
    """Downloads a file with verified HTTP 200 response and browser User-Agent."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = dest_path.with_suffix(".tmp")
    print(f"  Downloading: {dest_path.name}")
    print(f"    Source: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"HTTP {response.status} when downloading {url}")
        with open(temp_path, "wb") as f_out:
            while chunk := response.read(65536):
                f_out.write(chunk)

    if temp_path.stat().st_size < 1000:
        if temp_path.exists():
            temp_path.unlink()
        raise ValueError(f"Downloaded file suspiciously small ({temp_path.stat().st_size} bytes)")

    if dest_path.exists():
        dest_path.unlink()
    temp_path.rename(dest_path)
    print(f"    Saved: {dest_path.stat().st_size:,} bytes")


def download_all_missing(missing: List[Dict[str, str]]):
    """Downloads all missing authentic NASA visual assets."""
    print(f"\n[+] Fetching {len(missing)} authentic NASA SVS assets...")
    for item in missing:
        dest_path = Path(item["path"])
        download_file(item["url"], dest_path)
    print("[+] All NASA raw assets successfully fetched and verified!\n")


def process_layer(layer_id: str, sonifier: ImageSonifier) -> Tuple[Dict[str, Any], Path, str]:
    """
    Processes authentic NASA raw images for a single layer:
      1. Resizes to 720x360 equirectangular grid
      2. Computes per-column normalized metrics
      3. Computes layer-specific features
      4. Saves data/processed/layers/<layer_id>.json
      5. Saves frontend/assets/layers/<layer_id>.jpg (<= 2048x1024)
    Returns: (layer_data, json_path, json_sha256)
    """
    spec = LAYER_SPECS[layer_id]
    layer_dir = DATA_RAW_SVS / layer_id

    DATA_PROCESSED_LAYERS.mkdir(parents=True, exist_ok=True)
    FRONTEND_ASSETS_LAYERS.mkdir(parents=True, exist_ok=True)

    print(f"Processing layer: {layer_id} (SVS #{spec['svs_id']})...")

    # 1. Load authentic NASA images and compute raw sha256
    raw_hashes = []
    for k, finfo in spec["files"].items():
        fpath = layer_dir / finfo["filename"]
        raw_hashes.append(f"{compute_sha256(fpath)}:{finfo['filename']}")
    raw_sha_combined = hashlib.sha256(";".join(raw_hashes).encode("utf-8")).hexdigest()

    # 2. Extract column metrics & layer-specific features
    if layer_id == "night_lights":
        path_2012 = layer_dir / spec["files"]["2012"]["filename"]
        path_2023 = layer_dir / spec["files"]["2023"]["filename"]
        grid_2012 = sonifier.resize_to_grid(path_2012)
        grid_2023 = sonifier.resize_to_grid(path_2023)

        # Baseline columns based on 2023 comparison
        columns = sonifier.extract_column_metrics(grid_2023)
        diffs = sonifier.extract_night_lights_diff(grid_2012, grid_2023)
        for i, d in enumerate(diffs):
            columns[i]["layer_features"] = d
        events = []

        # Save both 2012 and 2023 textures for A/B slider
        texture_2012 = Image.open(path_2012).resize((2048, 1024), Image.Resampling.LANCZOS)
        texture_2012.save(FRONTEND_ASSETS_LAYERS / "night_lights_2012.jpg", "JPEG", quality=88)

        texture_2023 = Image.open(path_2023).resize((2048, 1024), Image.Resampling.LANCZOS)
        texture_2023.save(FRONTEND_ASSETS_LAYERS / "night_lights_2023.jpg", "JPEG", quality=88)

        # Primary texture is 2023 comparison
        primary_texture_path = FRONTEND_ASSETS_LAYERS / "night_lights.jpg"
        texture_2023.save(primary_texture_path, "JPEG", quality=88)

    elif layer_id == "lightning":
        path_img = layer_dir / spec["files"]["master"]["filename"]
        grid = sonifier.resize_to_grid(path_img)
        columns = sonifier.extract_column_metrics(grid)
        events = sonifier.extract_lightning_events(grid, threshold=0.65)
        # If threshold is strict and real frame is dark, lower threshold slightly to capture authentic flashes
        if len(events) < 3:
            events = sonifier.extract_lightning_events(grid, threshold=0.45)
        if len(events) < 3:
            events = sonifier.extract_lightning_events(grid, threshold=0.25)

        primary_texture_path = FRONTEND_ASSETS_LAYERS / "lightning.jpg"
        texture = Image.open(path_img).resize((2048, 1024), Image.Resampling.LANCZOS)
        texture.save(primary_texture_path, "JPEG", quality=88)

    elif layer_id == "gedi_forest":
        path_img = layer_dir / spec["files"]["master"]["filename"]
        grid = sonifier.resize_to_grid(path_img)
        columns = sonifier.extract_column_metrics(grid)
        gedi_cols = sonifier.extract_gedi_features(grid)
        for i, g in enumerate(gedi_cols):
            columns[i]["layer_features"] = g
        events = []

        primary_texture_path = FRONTEND_ASSETS_LAYERS / "gedi_forest.jpg"
        texture = Image.open(path_img).resize((2048, 1024), Image.Resampling.LANCZOS)
        texture.save(primary_texture_path, "JPEG", quality=88)

    elif layer_id == "co2_dyamond":
        path_img = layer_dir / spec["files"]["master"]["filename"]
        grid = sonifier.resize_to_grid(path_img)
        columns = sonifier.extract_column_metrics(grid)
        co2_cols = sonifier.extract_co2_features(grid)
        for i, c in enumerate(co2_cols):
            columns[i]["layer_features"] = c
        events = []

        primary_texture_path = FRONTEND_ASSETS_LAYERS / "co2_dyamond.jpg"
        texture = Image.open(path_img).resize((2048, 1024), Image.Resampling.LANCZOS)
        texture.save(primary_texture_path, "JPEG", quality=88)

    else:
        raise ValueError(f"Unknown layer ID: {layer_id}")

    # 3. Assemble JSON contract structure
    layer_data = {
        "meta": {
            "id": spec["id"],
            "title": spec["title"],
            "source_name": spec["source_name"],
            "source_url": spec["source_url"],
            "svs_id": spec["svs_id"],
            "agency": spec["agency"],
            "units": spec["units"],
            "bounds": spec["bounds"],
            "frame_count": spec["frame_count"],
            "date": spec["date"],
            "sha256": raw_sha_combined,
            "texture": f"/assets/layers/{layer_id}.jpg",
            "sonification_mapping": spec["sonification_mapping"]
        },
        "columns": columns,
        "events": events
    }

    # 4. Save JSON
    json_path = DATA_PROCESSED_LAYERS / f"{layer_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(layer_data, f, indent=2)

    json_sha256 = compute_sha256(json_path)
    print(f"  -> Generated {json_path.name} ({len(columns)} cols, {len(events)} events, SHA-256: {json_sha256[:12]}...)")
    return layer_data, json_path, json_sha256


def update_checksums(processed_records: List[Tuple[str, Path, str]]):
    """
    Appends SHA-256 checksums of processed layer assets (under data/) to data/checksums.sha256.
    """
    existing_text = CHECKSUMS_FILE.read_text(encoding="utf-8") if CHECKSUMS_FILE.exists() else ""
    existing_lines = existing_text.splitlines()
    existing_hashes = set()
    for line in existing_lines:
        parts = line.strip().split()
        if len(parts) >= 2:
            existing_hashes.add(parts[0])

    new_lines = []
    for layer_id, json_path, json_sha in processed_records:
        rel_path = f"processed/layers/{json_path.name}"
        if json_sha not in existing_hashes:
            new_lines.append(f"{json_sha}  {rel_path}")
            existing_hashes.add(json_sha)

    if new_lines:
        with open(CHECKSUMS_FILE, "a", encoding="utf-8") as f:
            if existing_text and not existing_text.endswith("\n"):
                f.write("\n")
            f.write("# NASA SVS/EIC Layers Processed Assets Checksums\n")
            for nl in new_lines:
                f.write(f"{nl}\n")
        print(f"[+] Appended {len(new_lines)} asset checksum(s) to {CHECKSUMS_FILE.name}")


def update_metadata(layer_records: Dict[str, Dict[str, Any]]):
    """
    Appends authentic NASA SVS layers catalog to data/processed/metadata.json
    while strictly preserving existing climate datasets.
    """
    if METADATA_FILE.exists():
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            metadata = json.load(f)
    else:
        metadata = {
            "system": "EARTHSONIC Observation Catalog",
            "version": "1.0.0",
            "datasets": {}
        }

    # Ensure layers dictionary exists
    if "layers" not in metadata:
        metadata["layers"] = {}

    for layer_id, layer_data in layer_records.items():
        meta = layer_data["meta"].copy()
        metadata["layers"][layer_id] = {
            "id": meta["id"],
            "title": meta["title"],
            "source_name": meta["source_name"],
            "source_url": meta["source_url"],
            "svs_id": meta["svs_id"],
            "agency": meta["agency"],
            "units": meta["units"],
            "bounds": meta["bounds"],
            "frame_count": meta["frame_count"],
            "date": meta["date"],
            "sha256": meta["sha256"],
            "texture": meta.get("texture"),
            "column_count": len(layer_data.get("columns", [])),
            "event_count": len(layer_data.get("events", [])),
            "sonification_mapping": meta.get("sonification_mapping", {})
        }

    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"[+] Successfully updated {METADATA_FILE.name} with all 4 NASA layers.")


def main():
    parser = argparse.ArgumentParser(description="EARTHSONIC NASA SVS Layers Preprocessing Pipeline")
    parser.add_argument("--check", action="store_true", help="Check for raw NASA assets and exit cleanly")
    parser.add_argument("--download", "--fetch", action="store_true", help="Download authentic NASA SVS assets")
    parser.add_argument("--force", action="store_true", help="Force rebuild even if processed assets exist")
    args = parser.parse_args()

    missing = check_missing_assets()

    if args.check:
        if missing:
            print_missing_report(missing)
            print("[INFO] --check complete. Missing assets reported above.")
            return 0
        else:
            print("[OK] All authentic NASA SVS raw assets are present on disk.")
            return 0

    if missing:
        if args.download:
            download_all_missing(missing)
            # Re-check
            remaining = check_missing_assets()
            if remaining:
                print(f"[ERROR] Failed to fetch {len(remaining)} assets.")
                print_missing_report(remaining)
                return 1
        else:
            print_missing_report(missing)
            print("[INFO] Halting cleanly. Pass --download to fetch assets automatically.")
            return 0

    # Build layers
    print("\n[+] Starting NASA SVS Layers feature extraction and asset build...")
    sonifier = ImageSonifier()

    processed_records = []
    layer_records = {}

    for layer_id in LAYER_SPECS.keys():
        layer_data, json_path, json_sha = process_layer(layer_id, sonifier)
        processed_records.append((layer_id, json_path, json_sha))
        layer_records[layer_id] = layer_data

    # Update checksums
    update_checksums(processed_records)

    # Update metadata catalog
    update_metadata(layer_records)

    print("\n[+] Milestone 2 NASA SVS Layers build completed successfully!")
    return 0


if __name__ == "__main__":
    sys.exit(main())
