"""
tests/test_adversarial_empirical_m1.py
Empirical Challenger Test Suite for Milestone 1:
1. Complete observation verification (1979-01 to 2026-09) with zero NaN/null/leak.
2. Mathematical normalization oracle validation:
   - Temp: [-0.85, 1.50]
   - CO2: [312.0, 435.0] vs [310.0, 440.0]
   - Ocean: [-0.60, 1.20]
   - Sea ice: [3.5, 7.8] vs [3.5, 16.5]
3. Multithreaded concurrency stress testing on Flask endpoints.
4. Adversarial fuzzing: malformed dates, inverted boundaries, SQLi/XSS, path traversal, out-of-range dates.
"""

import os
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import pytest

from backend.app import create_app
from backend.config import TestingConfig

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")
MONTHLY_JSON = os.path.join(DATA_PROCESSED_DIR, "earthsonic_monthly_harmonized.json")
METADATA_JSON = os.path.join(DATA_PROCESSED_DIR, "metadata.json")
ZONAL_JSON = os.path.join(DATA_PROCESSED_DIR, "zonal_temperature_annual.json")


@pytest.fixture(scope="module")
def app_client():
    app = create_app(TestingConfig)
    with app.test_client() as client:
        yield client


@pytest.fixture(scope="module")
def raw_monthly_json_string():
    with open(MONTHLY_JSON, "r", encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def monthly_data():
    with open(MONTHLY_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def metadata():
    with open(METADATA_JSON, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# Category 1: 573-Month Completeness & Zero NaN/Null/Leak Verification
# ============================================================================

class TestDataCompletenessAndNullRejection:
    """Rigorous verification of 573-month continuous series without missing or invalid values."""

    def test_raw_json_zero_null_tokens(self, raw_monthly_json_string):
        """Verify raw serialized JSON contains zero ': null' tokens and zero 'NaN' or 'Infinity'."""
        assert ": null" not in raw_monthly_json_string, "Harmonized JSON contains ': null' leaks!"
        assert "NaN" not in raw_monthly_json_string, "Harmonized JSON contains 'NaN' tokens!"
        assert "Infinity" not in raw_monthly_json_string, "Harmonized JSON contains 'Infinity' tokens!"

    def test_exact_573_months_contiguous_sequence(self, monthly_data):
        """Verify strict contiguous sequence from 1979-01 to 2026-09 (573 months)."""
        months = monthly_data["months"]
        assert len(months) == 573, f"Expected 573 months, got {len(months)}"
        assert months[0] == "1979-01"
        assert months[-1] == "2026-09"

        # Verify month by month sequence
        cur_y, cur_m = 1979, 1
        for idx, m_str in enumerate(months):
            expected = f"{cur_y:04d}-{cur_m:02d}"
            assert m_str == expected, f"Index {idx}: expected {expected}, got {m_str}"
            cur_m += 1
            if cur_m > 12:
                cur_m = 1
                cur_y += 1

    def test_all_observations_complete_finite_numeric(self, monthly_data):
        """Every single month must have valid, finite float numbers for all 4 variables."""
        records = monthly_data["records"]
        assert len(records) == 573

        variables = [
            "temperature_anomaly",
            "co2_ppm",
            "ocean_temp_anomaly",
            "sea_ice_extent",
            "september_sea_ice_extent",
            "normalized_temperature",
            "normalized_co2",
            "normalized_ocean_temp",
            "normalized_sea_ice_loss",
            "normalized_sea_ice_extent"
        ]

        for rec in records:
            d = rec["date"]
            for var in variables:
                val = rec.get(var)
                assert val is not None, f"Variable '{var}' is None at {d}"
                assert isinstance(val, (int, float)), f"Variable '{var}' is non-numeric ({type(val)}) at {d}"
                assert not math.isnan(val), f"Variable '{var}' is NaN at {d}"
                assert not math.isinf(val), f"Variable '{var}' is Inf at {d}"

    def test_all_normalized_values_strictly_in_unit_interval(self, monthly_data):
        """Every single normalized value must lie within [0.0, 1.0]."""
        norm_keys = [
            "normalized_temperature",
            "normalized_co2",
            "normalized_ocean_temp",
            "normalized_sea_ice_loss",
            "normalized_sea_ice_extent"
        ]
        for rec in monthly_data["records"]:
            d = rec["date"]
            for k in norm_keys:
                v = rec[k]
                assert 0.0 <= v <= 1.0, f"{k} at {d} is outside [0.0, 1.0]: {v}"


# ============================================================================
# Category 2: Mathematical Normalization Formulas & Bounds Validation
# ============================================================================

class TestMathematicalNormalizationOracles:
    """Verifies normalization formulas against specified bounds and documents deviations."""

    def test_temperature_normalization_formula(self, monthly_data):
        """
        Temp normalization bounds: [-0.85, +1.50] °C.
        Formula: round(clamp((T - (-0.85)) / (1.50 - (-0.85))), 4) = round(clamp((T + 0.85) / 2.35), 4).
        """
        lo, hi = -0.85, 1.50
        for rec in monthly_data["records"]:
            t = rec["temperature_anomaly"]
            expected = round(max(0.0, min(1.0, (t - lo) / (hi - lo))), 4)
            actual = rec["normalized_temperature"]
            assert abs(expected - actual) <= 1e-4, f"Temp mismatch at {rec['date']}: exp={expected}, act={actual}"

    def test_ocean_temperature_normalization_formula(self, monthly_data):
        """
        Ocean temp normalization bounds: [-0.60, +1.20] °C.
        Formula: round(clamp((SST - (-0.60)) / (1.20 - (-0.60))), 4) = round(clamp((SST + 0.60) / 1.80), 4).
        """
        lo, hi = -0.60, 1.20
        for rec in monthly_data["records"]:
            o = rec["ocean_temp_anomaly"]
            expected = round(max(0.0, min(1.0, (o - lo) / (hi - lo))), 4)
            actual = rec["normalized_ocean_temp"]
            assert abs(expected - actual) <= 1e-4, f"Ocean mismatch at {rec['date']}: exp={expected}, act={actual}"

    def test_co2_normalization_bounds_audit(self, monthly_data):
        """
        CO2 Normalization Bounds Audit:
        Compares actual data normalization against:
          (a) Implemented bounds: [310.0, 440.0]
          (b) Spec contract bounds: [312.0, 435.0]
        """
        records = monthly_data["records"]
        matches_310_440 = 0
        matches_312_435 = 0

        for rec in records:
            c = rec["co2_ppm"]
            exp_310 = round(max(0.0, min(1.0, (c - 310.0) / (440.0 - 310.0))), 4)
            exp_312 = round(max(0.0, min(1.0, (c - 312.0) / (435.0 - 312.0))), 4)
            act = rec["normalized_co2"]

            if abs(exp_310 - act) <= 1e-4:
                matches_310_440 += 1
            if abs(exp_312 - act) <= 1e-4:
                matches_312_435 += 1

        assert matches_310_440 == 573, f"Expected 100% match with [310, 440], got {matches_310_440}/573"
        # Empirical finding: implementation uses [310, 440] rather than [312, 435]
        assert matches_312_435 < 10, (
            f"Expected deviation from [312, 435] spec bounds, got {matches_312_435} matches"
        )

    def test_sea_ice_normalization_bounds_audit(self, monthly_data):
        """
        Sea Ice Normalization Bounds Audit:
        Evaluates why [3.5, 7.8] applies to September minimum, while monthly extent requires [3.5, 16.5].
        """
        records = monthly_data["records"]
        months_over_78 = [r for r in records if r["sea_ice_extent"] > 7.8]
        # 80.1% of months exceed 7.8 M km² due to winter/spring sea ice cycle
        assert len(months_over_78) == 459, f"Expected 459 months > 7.8 M km², got {len(months_over_78)}"

        # Verify that monthly normalized_sea_ice_loss accurately uses [3.5, 16.5]
        for rec in records:
            ice = rec["sea_ice_extent"]
            exp_loss = round(max(0.0, min(1.0, (16.50 - ice) / (16.50 - 3.50))), 4)
            actual = rec["normalized_sea_ice_loss"]
            assert abs(exp_loss - actual) <= 1e-4, f"Sea ice loss mismatch at {rec['date']}"

        # Verify that September sea ice extent falls strictly within [3.5, 7.8]
        sep_records = [r for r in records if r["month"] == 9]
        for rec in sep_records:
            sep_ice = rec["sea_ice_extent"]
            assert 3.5 <= sep_ice <= 7.8, f"September ice outside [3.5, 7.8] at {rec['date']}: {sep_ice}"


@pytest.fixture(scope="module")
def flask_app():
    return create_app(TestingConfig)


# ============================================================================
# Category 3: Multithreaded Concurrency Stress Testing
# ============================================================================

class TestApiConcurrencyStress:
    """Stress tests Flask API under concurrent worker threads."""

    def test_concurrent_endpoint_queries(self, flask_app):
        """Execute 100 concurrent requests across 10 threads without race conditions or errors."""
        endpoints = [
            "/api/health",
            "/api/datasets",
            "/api/datasets/co2",
            "/api/timeseries/temperature?start=2000-01&end=2020-12",
            "/api/timeseries/atmospheric_co2",
            "/api/timeseries/ocean_temperature",
            "/api/timeseries/sea_ice_extent",
            "/api/timeseries/harmonized",
            "/api/timeseries/harmonized?start=1995-01&end=2015-12",
            "/api/timeseries/zonal?start=1950&end=2020",
        ]

        # Duplicate endpoints to reach 100 requests
        request_list = endpoints * 10
        results = []

        def make_request(url):
            with flask_app.test_client() as thread_client:
                t0 = time.perf_counter()
                res = thread_client.get(url)
                elapsed = time.perf_counter() - t0
                return res.status_code, elapsed, url

        t_start = time.perf_counter()
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(make_request, url) for url in request_list]
            for f in as_completed(futures):
                results.append(f.result())
        t_total = time.perf_counter() - t_start

        # Check all succeeded
        statuses = [r[0] for r in results]
        latencies = [r[1] for r in results]

        assert all(s == 200 for s in statuses), f"Non-200 status in concurrent requests: {statuses}"
        avg_latency_ms = (sum(latencies) / len(latencies)) * 1000
        print(f"\nConcurrency test: 100 requests in {t_total:.3f}s. Avg latency: {avg_latency_ms:.2f}ms")
        assert avg_latency_ms < 100.0, f"Average latency too high under concurrency: {avg_latency_ms:.2f}ms"


# ============================================================================
# Category 4: Adversarial Fuzzing & Boundary Queries
# ============================================================================

class TestAdversarialFuzzing:
    """Fuzzes API endpoints with malformed, inverted, out-of-range, and injection inputs."""

    @pytest.mark.parametrize("bad_date", [
        "2020-00",        # month 0
        "2020-13",        # month 13
        "2020-99",        # month 99
        "2020-1",         # single-digit month
        "20-01",          # 2-digit year
        "202001",         # missing hyphen
        "2020/01",        # slash instead of hyphen
        "2020-01-01",     # includes day
        "-2020-01",       # negative year
        "ABCD-01",        # alphabetic year
        "2020-AB",        # alphabetic month
        "1979-01; DROP TABLE",  # SQL injection
        "<script>alert(1)</script>",  # XSS
        "null",
        "NaN",
        "2020-01%00",     # null byte injection
    ])
    def test_malformed_start_and_end_rejected_with_400(self, app_client, bad_date):
        """Any malformed date string must be rejected with HTTP 400 and an error message."""
        res_start = app_client.get(f"/api/timeseries/temperature?start={bad_date}")
        assert res_start.status_code == 400, f"Expected 400 for start='{bad_date}', got {res_start.status_code}"
        assert "error" in res_start.get_json()

        res_end = app_client.get(f"/api/timeseries/temperature?end={bad_date}")
        assert res_end.status_code == 400, f"Expected 400 for end='{bad_date}', got {res_end.status_code}"
        assert "error" in res_end.get_json()

    def test_inverted_date_range_rejected_with_400(self, app_client):
        """start date greater than end date must return HTTP 400."""
        res = app_client.get("/api/timeseries/temperature?start=2025-01&end=2010-01")
        assert res.status_code == 400
        assert "cannot be after end" in res.get_json()["error"]

        res_harm = app_client.get("/api/timeseries/harmonized?start=2025-01&end=2010-01")
        assert res_harm.status_code == 400
        assert "cannot be after end" in res_harm.get_json()["error"]

    def test_boundary_months_exact_limits(self, app_client):
        """Testing exact boundary months: 1979-01 (start) and 2026-09 (end)."""
        # Exact start
        res = app_client.get("/api/timeseries/temperature?start=1979-01&end=1979-01")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 1
        assert data["data"][0]["date"] == "1979-01"

        # Exact end
        res = app_client.get("/api/timeseries/temperature?start=2026-09&end=2026-09")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 1
        assert data["data"][0]["date"] == "2026-09"

    def test_out_of_range_historical_and_future_dates(self, app_client):
        """Dates before 1979 or after 2026 return 200 OK with count 0 (not 500 crash)."""
        # Historical gap (before 1979)
        res_past = app_client.get("/api/timeseries/temperature?start=1950-01&end=1978-12")
        assert res_past.status_code == 200
        assert res_past.get_json()["count"] == 0
        assert res_past.get_json()["data"] == []

        # Future gap (after 2026-09)
        res_future = app_client.get("/api/timeseries/temperature?start=2026-10&end=2030-12")
        assert res_future.status_code == 200
        assert res_future.get_json()["count"] == 0
        assert res_future.get_json()["data"] == []

    @pytest.mark.parametrize("bad_id", [
        "../raw/GLB.Ts+dSST.csv",
        "..\\raw\\GLB.Ts+dSST.csv",
        "../../../../windows/win.ini",
        "undefined",
        "none",
        "null",
        "temp_nonexistent",
        "12345",
        "__class__",
    ])
    def test_adversarial_dataset_ids_return_404(self, app_client, bad_id):
        """Adversarial dataset IDs return 404 without crashing or path traversal."""
        res = app_client.get(f"/api/timeseries/{bad_id}")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data
        # If routed to datasets blueprint, available_datasets should be listed
        if "available_datasets" in data:
            assert len(data["available_datasets"]) >= 4

    def test_case_insensitive_aliases(self, app_client):
        """Aliases must resolve regardless of case."""
        cases = ["CO2", "co2", "Co2", "TEMP", "Temp", "ice", "ICE", "oCeAn"]
        for c in cases:
            res = app_client.get(f"/api/timeseries/{c}")
            assert res.status_code == 200, f"Alias '{c}' failed to resolve"
            assert res.get_json()["count"] == 573


if __name__ == "__main__":
    pytest.main(["-v", __file__])
