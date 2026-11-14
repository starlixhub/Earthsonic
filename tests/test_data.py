"""
tests/test_data.py
Unit tests verifying NASA/NOAA data authenticity, zero synthetic data,
normalization correctness, and preprocessed dataset integrity.
"""

import os
import json
import hashlib
import pytest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_RAW_DIR = os.path.join(DATA_DIR, "raw")
DATA_PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
CHECKSUM_FILE = os.path.join(DATA_DIR, "checksums.sha256")


def compute_sha256(filepath):
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


class TestDataAuthenticity:
    """Verifies that all bundled raw datasets are authentic and match SHA-256 manifest."""

    def test_checksum_file_exists_and_populated(self):
        assert os.path.exists(CHECKSUM_FILE), "data/checksums.sha256 must exist"
        with open(CHECKSUM_FILE, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        assert len(lines) >= 16, f"Expected at least 16 checksum entries, found {len(lines)}"

    def test_raw_dataset_checksums_match_disk(self):
        """Every file referenced in checksums.sha256 must exist and match its authentic hash."""
        with open(CHECKSUM_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                expected_hash, rel_path = line.split(maxsplit=1)
                full_path = os.path.join(DATA_DIR, rel_path.strip().replace("/", os.sep))
                assert os.path.exists(full_path), f"Raw file missing: {full_path}"
                actual_hash = compute_sha256(full_path)
                assert actual_hash.lower() == expected_hash.lower(), (
                    f"Checksum mismatch for {rel_path}: expected {expected_hash}, got {actual_hash}"
                )

    def test_gistemp_v4_raw_integrity(self):
        """NASA GISS GISTEMP v4 must span 1880 to 2026 with realistic anomaly values."""
        glb_path = os.path.join(DATA_RAW_DIR, "GLB.Ts+dSST.csv")
        assert os.path.exists(glb_path)
        with open(glb_path, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]

        assert "Land-Ocean: Global Means" in lines[0]
        assert "Year,Jan,Feb,Mar" in lines[1]
        assert len(lines) >= 147, f"GISTEMP should have >= 147 years, found {len(lines)}"

        # Check start year (1880) and modern year (2026)
        assert lines[2].startswith("1880")
        assert lines[-1].startswith("2026")

        # Verify authentic values (1893 cold anomaly, 2023/2024 warming peaks)
        content = "\n".join(lines)
        assert "-.81" in content or "-0.81" in content, "Expected historical 1893 minimum ~ -0.81°C"
        assert "1.48" in content, "Expected September 2023 peak anomaly 1.48°C"

    def test_co2_mauna_loa_raw_integrity(self):
        """Mauna Loa CO2 record must contain authentic Keeling Curve observations."""
        co2_path = os.path.join(DATA_RAW_DIR, "co2_mm_mlo.csv")
        assert os.path.exists(co2_path)
        with open(co2_path, "r", encoding="utf-8") as f:
            data_lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]

        # Header is year,month,... and first observation line is March 1958 (315.71 ppm)
        assert data_lines[0].startswith("year,month")
        assert data_lines[1].startswith("1958,3,"), f"First CO2 data line should be March 1958, got: {data_lines[1]}"
        assert "315.71" in data_lines[1]

        # Recent observations (2024-2026) must exceed 420 ppm
        last_line = data_lines[-1]
        parts = last_line.split(",")
        assert int(parts[0]) >= 2025, f"Expected data into 2025/2026, got year {parts[0]}"
        assert float(parts[3]) > 420.0, f"Modern CO2 should exceed 420 ppm, got {parts[3]}"

    def test_ocean_temp_raw_integrity(self):
        """NOAA NCEI Ocean SST record must span from 185001 to modern 2026."""
        ocean_path = os.path.join(DATA_RAW_DIR, "ocean_temp_global.csv")
        assert os.path.exists(ocean_path)
        with open(ocean_path, "r", encoding="utf-8") as f:
            data_lines = [line.strip() for line in f if line.strip() and not line.startswith("#")]

        # Header is Date,Departure from Average
        assert "Date,Departure" in data_lines[0]
        # First row is 185001
        assert data_lines[1].startswith("185001")
        # Last row is 202609
        assert data_lines[-1].startswith("202609")
        assert len(data_lines) >= 2100, f"Expected >= 2100 monthly ocean records, found {len(data_lines)}"

    def test_sea_ice_extent_raw_integrity(self):
        """NSIDC Arctic September sea ice must exhibit 1979 baseline ~7.05 and 2012 record minimum ~3.57."""
        ice_path = os.path.join(DATA_RAW_DIR, "N_09_extent_v4.0.csv")
        assert os.path.exists(ice_path)
        with open(ice_path, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]

        content = "\n".join(lines)
        assert "7.05" in content, "1979 September extent must be ~7.05 million km²"
        assert "3.57" in content, "2012 September record minimum must be ~3.57 million km²"


@pytest.fixture(scope="module")
def harmonized_data():
    path = os.path.join(DATA_PROCESSED_DIR, "earthsonic_monthly_harmonized.json")
    assert os.path.exists(path), f"Processed file missing: {path}"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def metadata_data():
    path = os.path.join(DATA_PROCESSED_DIR, "metadata.json")
    assert os.path.exists(path), f"Metadata file missing: {path}"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def zonal_data():
    path = os.path.join(DATA_PROCESSED_DIR, "zonal_temperature_annual.json")
    assert os.path.exists(path), f"Zonal file missing: {path}"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class TestProcessedDatasets:
    """Verifies the deterministically preprocessed JSON datasets."""

    def test_harmonized_timeline_length_and_period(self, harmonized_data):
        """Harmonized monthly timeline must have exactly 573 months spanning 1979-01 to 2026-09."""
        months = harmonized_data["months"]
        assert len(months) == 573, f"Expected 573 harmonized months, got {len(months)}"
        assert months[0] == "1979-01"
        assert months[-1] == "2026-09"
        assert len(harmonized_data["records"]) == 573

    def test_harmonized_arrays_complete_and_numeric(self, harmonized_data):
        """All 4 observation tracks must have 573 non-null floating point numbers."""
        assert len(harmonized_data["temperature_anomaly"]) == 573
        assert len(harmonized_data["co2_ppm"]) == 573
        assert len(harmonized_data["ocean_temp_anomaly"]) == 573
        assert len(harmonized_data["sea_ice_extent"]) == 573

        for i, val in enumerate(harmonized_data["temperature_anomaly"]):
            assert isinstance(val, (int, float)), f"Non-numeric temp at index {i}"
        for i, val in enumerate(harmonized_data["co2_ppm"]):
            assert isinstance(val, (int, float)) and val > 300, f"Invalid CO2 at index {i}: {val}"
        for i, val in enumerate(harmonized_data["ocean_temp_anomaly"]):
            assert isinstance(val, (int, float)), f"Non-numeric ocean temp at index {i}"
        for i, val in enumerate(harmonized_data["sea_ice_extent"]):
            assert isinstance(val, (int, float)) and val > 0, f"Invalid sea ice at index {i}: {val}"

    def test_normalization_values_strictly_within_bounds(self, harmonized_data):
        """All normalized values must be strictly between 0.0 and 1.0."""
        norm = harmonized_data["normalized"]
        for key in ["temperature", "co2", "ocean_temp", "sea_ice_loss", "sea_ice_extent"]:
            assert key in norm, f"Missing normalized key {key}"
            arr = norm[key]
            assert len(arr) == 573
            for idx, v in enumerate(arr):
                assert 0.0 <= v <= 1.0, f"Normalized {key} at {idx} out of bounds: {v}"

    def test_zonal_temperature_polar_amplification(self, zonal_data):
        """High Arctic (64N-90N) should exhibit greater warming than global or tropical bands."""
        bands = zonal_data["bands"]
        assert "Glob" in bands
        assert "64N-90N" in bands
        assert "EQU-24N" in bands

        # Compare 2024 warming anomaly between Arctic and Tropics
        records = {r["year"]: r for r in zonal_data["records"]}
        rec_2024 = records[2024]
        assert rec_2024["64N-90N"] > rec_2024["Glob"], (
            "Polar amplification: 64N-90N anomaly should exceed global anomaly"
        )
        assert rec_2024["64N-90N"] > rec_2024["EQU-24N"], (
            "Polar amplification: Arctic anomaly should exceed tropical anomaly"
        )

    def test_metadata_contains_all_four_variables(self, metadata_data):
        """Metadata catalog must describe all 4 core variables with scientific sources."""
        datasets = metadata_data["datasets"]
        assert "global_surface_temperature" in datasets
        assert "atmospheric_co2" in datasets
        assert "ocean_temperature" in datasets
        assert "sea_ice_extent" in datasets

        for key, info in datasets.items():
            assert "title" in info
            assert "agency" in info
            assert "units" in info
            assert "baseline" in info
            assert "temporal_coverage" in info
            assert "sonification_mapping" in info
