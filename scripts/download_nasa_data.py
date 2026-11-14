#!/usr/bin/env python3
"""
scripts/download_nasa_data.py
Automated fetcher for authentic NASA and NOAA Earth science datasets.
Downloads raw observation CSVs, validates structure, and computes SHA-256 checksums.

Data Sources:
1. NASA GISS GISTEMP v4 (Global & Zonal temperature anomalies)
2. NOAA GML Mauna Loa atmospheric CO2
3. NOAA NCEI Global Ocean Surface Temperature anomalies
4. NSIDC Sea Ice Index v4 Arctic monthly records (N_01 to N_12)
"""

import os
import sys
import hashlib
import requests

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_RAW_DIR = os.path.join(BASE_DIR, "data", "raw")
CHECKSUM_FILE = os.path.join(BASE_DIR, "data", "checksums.sha256")

# Authoritative URLs
DATASET_URLS = {
    "GLB.Ts+dSST.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv",
    "ZonAnn.Ts+dSST.csv": "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv",
    "co2_mm_mlo.csv": "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv",
    "ocean_temp_global.csv": (
        "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/"
        "global/time-series/globe/tavg/ocean/1/0/1850-2026/data.csv"
    ),
}

# Add NSIDC Arctic monthly files N_01 to N_12
NSIDC_BASE = "https://noaadata.apps.nsidc.org/NOAA/G02135/north/monthly/data/"
for m in range(1, 13):
    DATASET_URLS[f"N_{m:02d}_extent_v4.0.csv"] = f"{NSIDC_BASE}N_{m:02d}_extent_v4.0.csv"


def compute_sha256(filepath):
    """Compute SHA-256 hash of a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def download_file(url, target_path, timeout=30):
    """Download a file with verification of response code."""
    print(f"Downloading {url} -> {os.path.basename(target_path)}...")
    headers = {
        "User-Agent": "EARTHSONIC-DataFetcher/1.0 (NASA Space Apps Challenge 2026; scientific educational use)"
    }
    response = requests.get(url, headers=headers, timeout=timeout)
    response.raise_for_status()

    content = response.content
    if len(content) < 500:
        raise ValueError(f"Downloaded content suspiciously small ({len(content)} bytes) for {url}")

    with open(target_path, "wb") as f:
        f.write(content)

    print(f"  Saved {len(content):,} bytes -> {os.path.basename(target_path)}")
    return target_path


def validate_file_content(filename, filepath):
    """Validate that raw file is authentic and contains expected headers."""
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        lines = [f.readline() for _ in range(60)]

    header_sample = "".join(lines)

    if filename == "GLB.Ts+dSST.csv":
        if "Land-Ocean" not in header_sample and "Year" not in header_sample:
            raise ValueError(f"Header validation failed for {filename}")
    elif filename == "ZonAnn.Ts+dSST.csv":
        if "Year" not in header_sample or "Glob" not in header_sample:
            raise ValueError(f"Header validation failed for {filename}")
    elif filename == "co2_mm_mlo.csv":
        if "NOAA GML" not in header_sample and "Mauna Loa" not in header_sample and "year,month" not in header_sample:
            raise ValueError(f"Header validation failed for {filename}")
    elif filename == "ocean_temp_global.csv":
        if "Global Ocean" not in header_sample and "Departure" not in header_sample:
            raise ValueError(f"Header validation failed for {filename}")
    elif filename.startswith("N_") and filename.endswith("_extent_v4.0.csv"):
        if "extent" not in header_sample.lower() or "area" not in header_sample.lower():
            raise ValueError(f"Header validation failed for {filename}")

    return True


def verify_checksums():
    """Verify that all files in checksums.sha256 match their disk hashes."""
    if not os.path.exists(CHECKSUM_FILE):
        print(f"Checksum file not found: {CHECKSUM_FILE}")
        return False

    all_ok = True
    with open(CHECKSUM_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(maxsplit=1)
            if len(parts) != 2:
                continue
            expected_hash, rel_path = parts
            rel_path = rel_path.strip().replace("/", os.sep).replace("\\", os.sep)
            # handle both relative to data/ and relative to project
            if os.path.exists(os.path.join(BASE_DIR, rel_path)):
                target = os.path.join(BASE_DIR, rel_path)
            elif os.path.exists(os.path.join(os.path.dirname(CHECKSUM_FILE), rel_path)):
                target = os.path.join(os.path.dirname(CHECKSUM_FILE), rel_path)
            else:
                print(f"FAIL (missing): {rel_path}")
                all_ok = False
                continue

            actual_hash = compute_sha256(target)
            if actual_hash.lower() == expected_hash.lower():
                print(f"PASS: {os.path.basename(target)} ({actual_hash[:12]}...)")
            else:
                print(f"FAIL (mismatch): {os.path.basename(target)}: expected {expected_hash}, got {actual_hash}")
                all_ok = False

    return all_ok


def download_all():
    """Download all authentic raw datasets and produce checksum manifest."""
    os.makedirs(DATA_RAW_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(CHECKSUM_FILE), exist_ok=True)

    checksums = {}

    for filename, url in DATASET_URLS.items():
        target_path = os.path.join(DATA_RAW_DIR, filename)
        download_file(url, target_path)
        validate_file_content(filename, target_path)
        checksums[filename] = compute_sha256(target_path)

    # Write checksums.sha256
    with open(CHECKSUM_FILE, "w", encoding="utf-8") as f:
        f.write("# EARTHSONIC Authentic NASA/NOAA Dataset Checksums\n")
        f.write("# Generated automatically - Zero Synthetic Data Policy\n")
        for filename in sorted(checksums.keys()):
            # Use data/raw/filename relative path
            rel_path = f"raw/{filename}"
            f.write(f"{checksums[filename]}  {rel_path}\n")

    print(f"\nSuccessfully downloaded {len(DATASET_URLS)} authentic datasets.")
    print(f"Checksum manifest generated at: {CHECKSUM_FILE}")


if __name__ == "__main__":
    if "--verify" in sys.argv:
        success = verify_checksums()
        sys.exit(0 if success else 1)
    else:
        download_all()
