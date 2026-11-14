"""
tests/test_challenger_m1.py
Empirical Challenger Suite for Milestone 1 (EARTHSONIC).
Adversarially tests:
  1. Historical truth & climate anomaly accuracy (1998 El Niño, 2012 Arctic minimum, 2023-2024 global warmth).
  2. Cross-dataset monthly alignment across all 4 variables from 1979-01 to 2026-09 (573 months).
  3. Annual harmonized vs. monthly harmonized mathematical consistency.
  4. Zonal temperature latitude bands (90N to 90S) consistency and polar amplification.
  5. Extreme queries and boundary robustness (year 1800, year 3000, empty, malformed, negative dates).
  6. Rapid sequential request throughput and cache stability.
  7. Raw CSV point-by-point observation audit (zero synthetic tolerance).
  8. Normalization invariants and mathematical recalculation fidelity.
  9. Boundary filtering precision.
"""

import os
import json
import time
import pytest
from backend.app import create_app
from backend.config import TestingConfig

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_PROCESSED_DIR = os.path.join(BASE_DIR, "data", "processed")
DATA_RAW_DIR = os.path.join(BASE_DIR, "data", "raw")


@pytest.fixture(scope="module")
def client():
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


@pytest.fixture(scope="module")
def monthly_data():
    path = os.path.join(DATA_PROCESSED_DIR, "earthsonic_monthly_harmonized.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def annual_data():
    path = os.path.join(DATA_PROCESSED_DIR, "earthsonic_annual_harmonized.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def zonal_data():
    path = os.path.join(DATA_PROCESSED_DIR, "zonal_temperature_annual.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# 1. Historical Truth & Climate Anomaly Accuracy
# ============================================================================

class TestHistoricalTruth:
    """Empirically verifies authentic climate anomalies against known historical events."""

    def test_1998_super_el_nino_ocean_spike(self, monthly_data):
        """
        1997-1998 Super El Niño:
        NOAA ocean temperature anomalies must show a pronounced peak in 1997-1998,
        with values exceeding +0.50 °C (peaking around ~0.65 °C in early 1998),
        which was the strongest ocean warming event of the 20th century.
        """
        records = {r["date"]: r for r in monthly_data["records"]}

        # Check ocean anomalies during the peak of 1997-1998 event
        elnino_months = [f"1998-{m:02d}" for m in range(1, 9)]
        elnino_ocean_anomalies = [records[m]["ocean_temp_anomaly"] for m in elnino_months]

        # Must have positive anomalies in all these months
        assert all(val > 0.45 for val in elnino_ocean_anomalies), (
            f"Expected 1998 El Niño ocean anomalies > 0.45 °C, got {elnino_ocean_anomalies}"
        )

        peak_1998_ocean = max(elnino_ocean_anomalies)
        assert peak_1998_ocean >= 0.55, f"1998 peak ocean anomaly should reach >= 0.55 °C, got {peak_1998_ocean}"

        # Global surface temperature in 1998 must also show significant warmth
        elnino_temp_anomalies = [records[m]["temperature_anomaly"] for m in elnino_months]
        peak_1998_temp = max(elnino_temp_anomalies)
        assert peak_1998_temp >= 0.65, f"1998 peak temp anomaly should reach >= 0.65 °C, got {peak_1998_temp}"

    def test_2012_arctic_sea_ice_minimum_historical_truth(self, monthly_data):
        """
        September 2012 recorded the lowest Arctic sea ice extent in the satellite observation era (~3.57 M sq km).
        Verify that:
        1. 2012-09 extent is exactly 3.57 million sq km.
        2. 2012-09 is the absolute minimum of all Septembers from 1979 to 2026.
        3. 2012-09 is the absolute lowest month across all 573 months.
        4. Normalized loss metric is at its peak (~0.9946 to 1.0).
        """
        records = monthly_data["records"]
        rec_2012_09 = next(r for r in records if r["date"] == "2012-09")

        assert rec_2012_09["sea_ice_extent"] == 3.57, (
            f"Expected canonical NSIDC 2012-09 extent of 3.57 M km², got {rec_2012_09['sea_ice_extent']}"
        )

        # Check all September records
        sep_records = [r for r in records if r["month"] == 9]
        min_sep = min(sep_records, key=lambda r: r["sea_ice_extent"])
        assert min_sep["date"] == "2012-09", (
            f"2012-09 must be lowest September, got {min_sep['date']} ({min_sep['sea_ice_extent']})"
        )

        # Check across ALL 573 months
        all_min = min(records, key=lambda r: r["sea_ice_extent"])
        assert all_min["date"] == "2012-09", (
            f"2012-09 must be the absolute lowest sea ice extent across all 573 months, got {all_min['date']}"
        )

        assert rec_2012_09["normalized_sea_ice_loss"] >= 0.99, (
            f"Normalized sea ice loss for 2012-09 should be >= 0.99, got {rec_2012_09['normalized_sea_ice_loss']}"
        )

    def test_2023_2024_global_record_warmth(self, monthly_data):
        """
        2023-2024 experienced unprecedented global temperatures:
        1. Single-month GISTEMP record peak occurred in September 2023 (+1.48 °C).
        2. Ocean surface temp broke all-time records in 2023-2024 exceeding 1.0 °C.
        3. Atmospheric CO2 exceeded 425 ppm for the first time in human history in 2024.
        """
        records = monthly_data["records"]

        # Max global surface temp anomaly across entire 573 months
        max_temp_rec = max(records, key=lambda r: r["temperature_anomaly"])
        assert max_temp_rec["date"] == "2023-09", (
            f"Highest temperature anomaly must be 2023-09, got {max_temp_rec['date']}"
        )
        assert max_temp_rec["temperature_anomaly"] == 1.48, (
            f"Expected peak temperature anomaly of 1.48 °C, got {max_temp_rec['temperature_anomaly']}"
        )

        # Ocean temperature in 2023-2024 should have values > 1.0 °C
        recent_ocean = [r["ocean_temp_anomaly"] for r in records if r["year"] in [2023, 2024]]
        assert any(val >= 1.0 for val in recent_ocean), (
            f"Expected ocean surface temperature to exceed 1.0 °C in 2023/2024, max was {max(recent_ocean)}"
        )

        # Atmospheric CO2 in 2024 should exceed 425 ppm
        co2_2024 = [r["co2_ppm"] for r in records if r["year"] == 2024]
        assert any(val >= 425.0 for val in co2_2024), (
            f"Expected CO2 to exceed 425 ppm in 2024, max was {max(co2_2024)}"
        )


# ============================================================================
# 2. Cross-Dataset Monthly Alignment & Completeness
# ============================================================================

class TestMonthlyAlignmentAndCompleteness:
    """Verifies that all 4 variables are present and synchronized for every single month."""

    def test_all_573_months_contiguous_and_sorted(self, monthly_data):
        """Verify strict contiguous sequence from 1979-01 to 2026-09 with no skips or duplicates."""
        months = monthly_data["months"]
        assert len(months) == 573

        expected_months = []
        for y in range(1979, 2027):
            max_m = 9 if y == 2026 else 12
            for m in range(1, max_m + 1):
                expected_months.append(f"{y:04d}-{m:02d}")

        assert months == expected_months, "Months list does not match expected contiguous sequence"

    def test_all_four_variables_present_every_single_month(self, monthly_data):
        """Every single month must have valid non-null, finite numbers for all 4 variables."""
        records = monthly_data["records"]
        assert len(records) == 573

        for rec in records:
            date_str = rec["date"]

            # Temperature
            t = rec.get("temperature_anomaly")
            assert t is not None, f"Null temperature at {date_str}"
            assert isinstance(t, (int, float)), f"Non-float temp at {date_str}"
            assert -1.0 <= t <= 2.0, f"Temp anomaly out of physical limits at {date_str}: {t}"

            # CO2
            c = rec.get("co2_ppm")
            assert c is not None, f"Null CO2 at {date_str}"
            assert isinstance(c, (int, float)), f"Non-float CO2 at {date_str}"
            assert 320.0 <= c <= 450.0, f"CO2 out of physical limits at {date_str}: {c}"

            # Ocean Temp
            o = rec.get("ocean_temp_anomaly")
            assert o is not None, f"Null ocean temp at {date_str}"
            assert isinstance(o, (int, float)), f"Non-float ocean temp at {date_str}"
            assert -1.0 <= o <= 2.0, f"Ocean temp out of physical limits at {date_str}: {o}"

            # Sea Ice
            ice = rec.get("sea_ice_extent")
            assert ice is not None, f"Null sea ice at {date_str}"
            assert isinstance(ice, (int, float)), f"Non-float sea ice at {date_str}"
            assert 2.0 <= ice <= 18.0, f"Sea ice out of physical limits at {date_str}: {ice}"

    def test_sensor_gap_interpolation_integrity(self, monthly_data):
        """
        Verify that ONLY the known satellite sensor gap (1987-12 and 1988-01)
        is flagged as interpolated, and that all other 571 months are raw authentic observations.
        """
        records = monthly_data["records"]
        interpolated = [r["date"] for r in records if r.get("is_sensor_gap_interpolated") is True]
        assert interpolated == ["1987-12", "1988-01"], (
            f"Unexpected interpolated months: {interpolated}"
        )


# ============================================================================
# 3. Annual Harmonized vs. Monthly Harmonized Consistency
# ============================================================================

class TestAnnualVsMonthlyConsistency:
    """Verifies that annual harmonized values match the mathematical aggregations of monthly data."""

    def test_annual_temp_matches_monthly_mean(self, monthly_data, annual_data):
        """Annual temperature anomaly should equal the arithmetic mean of the 12 monthly anomalies."""
        annual_map = {r["year"]: r for r in annual_data["records"]}

        # Check years 1979 through 2025 (complete 12-month years in monthly harmonized)
        for y in range(1979, 2026):
            m_records = [r for r in monthly_data["records"] if r["year"] == y]
            assert len(m_records) == 12, f"Year {y} should have 12 months in monthly data"

            expected_avg = round(sum(r["temperature_anomaly"] for r in m_records) / 12, 3)
            annual_val = annual_map[y]["temperature_anomaly"]

            assert abs(annual_val - expected_avg) <= 0.002, (
                f"Year {y}: annual temp {annual_val} != monthly mean {expected_avg}"
            )

    def test_annual_co2_matches_monthly_mean(self, monthly_data, annual_data):
        """Annual CO2 should equal the arithmetic mean of the 12 monthly CO2 values."""
        annual_map = {r["year"]: r for r in annual_data["records"]}

        for y in range(1979, 2026):
            m_records = [r for r in monthly_data["records"] if r["year"] == y]
            expected_avg = round(sum(r["co2_ppm"] for r in m_records) / 12, 2)
            annual_val = annual_map[y]["co2_ppm"]

            assert abs(annual_val - expected_avg) <= 0.02, (
                f"Year {y}: annual CO2 {annual_val} != monthly mean {expected_avg}"
            )

    def test_annual_ocean_temp_matches_monthly_mean(self, monthly_data, annual_data):
        """Annual ocean temp should equal the arithmetic mean of the 12 monthly ocean temp values."""
        annual_map = {r["year"]: r for r in annual_data["records"]}

        for y in range(1979, 2026):
            m_records = [r for r in monthly_data["records"] if r["year"] == y]
            expected_avg = round(sum(r["ocean_temp_anomaly"] for r in m_records) / 12, 3)
            annual_val = annual_map[y]["ocean_temp_anomaly"]

            assert abs(annual_val - expected_avg) <= 0.002, (
                f"Year {y}: annual ocean temp {annual_val} != monthly mean {expected_avg}"
            )

    def test_annual_sea_ice_matches_september_monthly(self, monthly_data, annual_data):
        """Annual sea ice record represents September minimum and must match September monthly extent."""
        annual_map = {r["year"]: r for r in annual_data["records"]}

        for y in range(1979, 2026):
            sep_rec = next(r for r in monthly_data["records"] if r["year"] == y and r["month"] == 9)
            annual_val = annual_map[y]["sea_ice_september_extent"]

            assert annual_val == sep_rec["sea_ice_extent"], (
                f"Year {y}: annual September sea ice {annual_val} != monthly September {sep_rec['sea_ice_extent']}"
            )


# ============================================================================
# 4. Zonal Temperature Latitude Bands (90N to 90S) Consistency
# ============================================================================

class TestZonalLatitudeConsistency:
    """Verifies zonal temperature bands across 90N to 90S."""

    def test_all_14_zonal_bands_present(self, zonal_data):
        """Ensure all 14 standard GISTEMP zonal bands are defined."""
        expected_bands = [
            "Glob", "NHem", "SHem",
            "24N-90N", "24S-24N", "90S-24S",
            "64N-90N", "44N-64N", "24N-44N", "EQU-24N",
            "24S-EQU", "44S-24S", "64S-44S", "90S-64S"
        ]
        assert zonal_data["bands"] == expected_bands

    def test_global_mean_matches_hemispheric_average(self, zonal_data):
        """
        Global temperature anomaly is approximately the average of NHem and SHem.
        Due to equal hemispheric area, Glob ~= (NHem + SHem) / 2.
        """
        records = zonal_data["records"]
        for r in records:
            if r["Glob"] is not None and r["NHem"] is not None and r["SHem"] is not None:
                hemi_avg = (r["NHem"] + r["SHem"]) / 2.0
                assert abs(r["Glob"] - hemi_avg) <= 0.03, (
                    f"Year {r['year']}: Glob {r['Glob']} deviates from hemi average {hemi_avg:.3f}"
                )

    def test_polar_amplification_zonal_gradient(self, zonal_data):
        """
        Arctic (64N-90N) must show marked polar amplification:
        The warming anomaly in the Arctic over 2015-2024 must exceed global and tropical anomalies.
        """
        recent = [r for r in zonal_data["records"] if 2015 <= r["year"] <= 2024]
        assert len(recent) == 10

        avg_arctic = sum(r["64N-90N"] for r in recent) / len(recent)
        avg_glob = sum(r["Glob"] for r in recent) / len(recent)
        avg_tropics = sum(r["24S-24N"] for r in recent) / len(recent)

        assert avg_arctic > avg_glob * 1.5, (
            f"Arctic warming ({avg_arctic:.2f} °C) must exceed 1.5x global warming ({avg_glob:.2f} °C)"
        )
        assert avg_arctic > avg_tropics, (
            f"Arctic warming ({avg_arctic:.2f} °C) must exceed tropical warming ({avg_tropics:.2f} °C)"
        )


# ============================================================================
# 5. Extreme Queries & Boundary Attacks on API
# ============================================================================

class TestExtremeApiQueries:
    """Stress-tests the REST API with out-of-range, corrupted, and adversarial queries."""

    def test_query_year_1800_out_of_range(self, client):
        """Querying year 1800 (prior to 1979) should return 200 OK with empty data list."""
        res = client.get("/api/timeseries/temperature?start=1800-01&end=1800-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 0
        assert data["data"] == []

    def test_query_year_3000_out_of_range(self, client):
        """Querying year 3000 (distant future) should return 200 OK with empty data list."""
        res = client.get("/api/timeseries/temperature?start=3000-01&end=3000-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 0
        assert data["data"] == []

    def test_query_negative_date_fails_validation(self, client):
        """Negative year format should fail date regex validation with HTTP 400."""
        res = client.get("/api/timeseries/temperature?start=-001-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "Invalid start format" in data["error"]

    def test_query_empty_strings(self, client):
        """Empty start and end query strings should default gracefully to full range."""
        res = client.get("/api/timeseries/temperature?start=&end=")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 573

    def test_query_whitespace_only_strings(self, client):
        """Whitespace-only query strings should be stripped and return full range."""
        res = client.get("/api/timeseries/temperature?start=%20%20&end=%20%20")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 573

    def test_query_inverted_dates_fails_validation(self, client):
        """Start date after end date should return HTTP 400."""
        res = client.get("/api/timeseries/temperature?start=2025-01&end=1990-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "cannot be after end" in data["error"]

    def test_query_invalid_month_formats(self, client):
        """Malformed months like 00, 13, single digit, or day inclusion must be rejected with HTTP 400."""
        bad_dates = [
            "2020-00",
            "2020-13",
            "2020-1",
            "2020/01",
            "2020-01-01",
            "invalid-text",
            "99999-01"
        ]
        for bad in bad_dates:
            res = client.get(f"/api/timeseries/temperature?start={bad}")
            assert res.status_code == 400, f"Expected 400 for '{bad}', got {res.status_code}"

    def test_harmonized_extreme_queries(self, client):
        """Harmonized endpoint should handle out-of-range queries gracefully."""
        res = client.get("/api/timeseries/harmonized?start=1800-01&end=1800-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["period"]["total_months"] == 0
        assert len(data["records"]) == 0

        res_future = client.get("/api/timeseries/harmonized?start=3000-01&end=3000-12")
        assert res_future.status_code == 200
        assert res_future.get_json()["period"]["total_months"] == 0

    def test_zonal_extreme_year_queries(self, client):
        """Zonal endpoint should handle extreme years and non-numeric input gracefully."""
        # Far past
        res = client.get("/api/timeseries/zonal?start=1700&end=1750")
        assert res.status_code == 200
        assert res.get_json()["count"] == 0

        # Far future
        res = client.get("/api/timeseries/zonal?start=3000&end=3050")
        assert res.status_code == 200
        assert res.get_json()["count"] == 0

        # Non-numeric
        res = client.get("/api/timeseries/zonal?start=year2000")
        assert res.status_code == 400

        # Inverted years
        res = client.get("/api/timeseries/zonal?start=2020&end=1980")
        assert res.status_code == 400

    def test_path_traversal_and_injection_dataset_id(self, client):
        """Adversarial dataset IDs (path traversal, SQL injection) should return 404 without leaking."""
        attacks = [
            "../../etc/passwd",
            "..\\..\\windows\\win.ini",
            "' OR '1'='1",
            "<script>alert(1)</script>",
            "null",
            "__proto__"
        ]
        for payload in attacks:
            res = client.get(f"/api/timeseries/{payload}")
            assert res.status_code == 404, f"Payload '{payload}' did not return 404"


# ============================================================================
# 6. Rapid Sequential Request Performance
# ============================================================================

class TestApiPerformanceAndStability:
    """Verifies that the API handles rapid sequential requests without degradation or crash."""

    def test_rapid_sequential_requests(self, client):
        """Execute 100 rapid sequential requests against harmonized and variable endpoints."""
        n_requests = 100
        latencies = []

        endpoints = [
            "/api/timeseries/harmonized",
            "/api/timeseries/temperature",
            "/api/timeseries/co2",
            "/api/timeseries/ocean_temp",
            "/api/timeseries/sea_ice",
            "/api/timeseries/zonal",
        ]

        t0_total = time.perf_counter()
        for i in range(n_requests):
            ep = endpoints[i % len(endpoints)]
            t0 = time.perf_counter()
            res = client.get(ep)
            dt = time.perf_counter() - t0
            latencies.append(dt)
            assert res.status_code == 200, f"Request {i} to {ep} failed with status {res.status_code}"

        total_time = time.perf_counter() - t0_total
        avg_latency_ms = (sum(latencies) / len(latencies)) * 1000
        max_latency_ms = max(latencies) * 1000

        print(f"\n100 Requests: Total={total_time:.3f}s, Avg={avg_latency_ms:.2f}ms, Max={max_latency_ms:.2f}ms")
        assert avg_latency_ms < 50.0, f"Average latency too high: {avg_latency_ms:.2f}ms"


# ============================================================================
# 7. Raw CSV Point-by-Point Observation Audit (Zero Synthetic Tolerance)
# ============================================================================

class TestPointByPointRawCsvAudit:
    """Audits preprocessed JSON values directly against the raw CSV files line-by-line."""

    def test_raw_gistemp_matches_processed_monthly(self, monthly_data):
        """Every single month's temperature anomaly must match GLB.Ts+dSST.csv exactly."""
        glb_path = os.path.join(DATA_RAW_DIR, "GLB.Ts+dSST.csv")
        raw_vals = {}
        with open(glb_path, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        for line in lines[2:]:
            parts = line.split(",")
            if parts[0].isdigit():
                y = int(parts[0])
                for m in range(1, 13):
                    if m < len(parts):
                        v = parts[m].strip()
                        if v and v != "***":
                            raw_vals[(y, m)] = float(v)

        for rec in monthly_data["records"]:
            key = (rec["year"], rec["month"])
            assert key in raw_vals, f"Missing raw GISTEMP value for {rec['date']}"
            assert rec["temperature_anomaly"] == raw_vals[key], (
                f"GISTEMP mismatch at {rec['date']}: processed={rec['temperature_anomaly']} vs raw={raw_vals[key]}"
            )

    def test_raw_co2_matches_processed_monthly(self, monthly_data):
        """Every single month's CO2 value must match co2_mm_mlo.csv exactly."""
        co2_path = os.path.join(DATA_RAW_DIR, "co2_mm_mlo.csv")
        raw_vals = {}
        with open(co2_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 5 and parts[0].isdigit():
                    y = int(parts[0])
                    m = int(parts[1])
                    avg_c = float(parts[3])
                    deseas = float(parts[4])
                    val = avg_c if avg_c > 0 else deseas
                    if val > 0:
                        raw_vals[(y, m)] = round(val, 2)

        for rec in monthly_data["records"]:
            key = (rec["year"], rec["month"])
            assert key in raw_vals, f"Missing raw CO2 value for {rec['date']}"
            assert rec["co2_ppm"] == raw_vals[key], (
                f"CO2 mismatch at {rec['date']}: processed={rec['co2_ppm']} vs raw={raw_vals[key]}"
            )

    def test_raw_ocean_temp_matches_processed_monthly(self, monthly_data):
        """Every single month's ocean temp anomaly must match ocean_temp_global.csv exactly."""
        ocean_path = os.path.join(DATA_RAW_DIR, "ocean_temp_global.csv")
        raw_vals = {}
        with open(ocean_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 2 and len(parts[0]) == 6 and parts[0].isdigit():
                    y = int(parts[0][:4])
                    m = int(parts[0][4:])
                    raw_vals[(y, m)] = round(float(parts[1]), 2)

        for rec in monthly_data["records"]:
            key = (rec["year"], rec["month"])
            assert key in raw_vals, f"Missing raw ocean temp for {rec['date']}"
            assert rec["ocean_temp_anomaly"] == raw_vals[key], (
                f"Ocean temp mismatch at {rec['date']}: processed={rec['ocean_temp_anomaly']} vs raw={raw_vals[key]}"
            )

    def test_raw_sea_ice_matches_processed_monthly(self, monthly_data):
        """Every single month's sea ice extent must match N_*.csv (except sensor gap months)."""
        raw_vals = {}
        for m in range(1, 13):
            fname = f"N_{m:02d}_extent_v4.0.csv"
            fpath = os.path.join(DATA_RAW_DIR, fname)
            with open(fpath, "r", encoding="utf-8") as f:
                for line in f:
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 5 and parts[0].isdigit():
                        y = int(parts[0])
                        ext = float(parts[4])
                        if ext > 0:
                            raw_vals[(y, m)] = round(ext, 2)

        for rec in monthly_data["records"]:
            if rec.get("is_sensor_gap_interpolated"):
                continue
            key = (rec["year"], rec["month"])
            assert key in raw_vals, f"Missing raw sea ice for {rec['date']}"
            assert rec["sea_ice_extent"] == raw_vals[key], (
                f"Sea ice mismatch at {rec['date']}: processed={rec['sea_ice_extent']} vs raw={raw_vals[key]}"
            )


# ============================================================================
# 8. Normalization Invariants & Mathematical Recalculation
# ============================================================================

class TestNormalizationMathematicalInvariants:
    """Verifies that all normalizations strictly adhere to defined physical mapping equations."""

    def test_normalization_recalculation_fidelity(self, monthly_data):
        """Recalculate normalized values independently for all 573 records."""
        for rec in monthly_data["records"]:
            # Temperature: (-0.85, 1.50)
            t = rec["temperature_anomaly"]
            exp_nt = round(max(0.0, min(1.0, (t - (-0.85)) / (1.50 - (-0.85)))), 4)
            assert abs(rec["normalized_temperature"] - exp_nt) <= 1e-4

            # CO2: (310.0, 440.0)
            c = rec["co2_ppm"]
            exp_nc = round(max(0.0, min(1.0, (c - 310.0) / (440.0 - 310.0))), 4)
            assert abs(rec["normalized_co2"] - exp_nc) <= 1e-4

            # Ocean temp: (-0.60, 1.20)
            o = rec["ocean_temp_anomaly"]
            exp_no = round(max(0.0, min(1.0, (o - (-0.60)) / (1.20 - (-0.60)))), 4)
            assert abs(rec["normalized_ocean_temp"] - exp_no) <= 1e-4

            # Sea ice: (3.50, 16.50)
            ice = rec["sea_ice_extent"]
            exp_loss = round(max(0.0, min(1.0, (16.50 - ice) / (16.50 - 3.50))), 4)
            exp_ext = round(max(0.0, min(1.0, (ice - 3.50) / (16.50 - 3.50))), 4)
            assert abs(rec["normalized_sea_ice_loss"] - exp_loss) <= 1e-4
            assert abs(rec["normalized_sea_ice_extent"] - exp_ext) <= 1e-4

            # Complementarity invariant
            assert abs((rec["normalized_sea_ice_loss"] + rec["normalized_sea_ice_extent"]) - 1.0) <= 1e-4


# ============================================================================
# 9. Boundary Filtering Precision
# ============================================================================

class TestPreciseDateBoundaryFiltering:
    """Tests exact edge filtering behavior when dates align with boundaries."""

    def test_single_month_range(self, client):
        res = client.get("/api/timeseries/temperature?start=2012-09&end=2012-09")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 1
        assert data["data"][0]["date"] == "2012-09"

    def test_start_boundary_matching_first_month(self, client):
        res = client.get("/api/timeseries/temperature?start=1979-01&end=1979-03")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 3
        assert data["start"] == "1979-01"
        assert data["end"] == "1979-03"

    def test_end_boundary_matching_last_month(self, client):
        res = client.get("/api/timeseries/temperature?start=2026-07&end=2026-09")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 3
        assert data["start"] == "2026-07"
        assert data["end"] == "2026-09"

    def test_pre_dataset_boundary_clamped(self, client):
        res = client.get("/api/timeseries/temperature?start=1970-01&end=1979-02")
        assert res.status_code == 200
        data = res.get_json()
        # Only 1979-01 and 1979-02 should be returned
        assert data["count"] == 2
        assert data["start"] == "1979-01"
        assert data["end"] == "1979-02"

    def test_post_dataset_boundary_clamped(self, client):
        res = client.get("/api/timeseries/temperature?start=2026-08&end=2030-12")
        assert res.status_code == 200
        data = res.get_json()
        # Only 2026-08 and 2026-09 should be returned
        assert data["count"] == 2
        assert data["start"] == "2026-08"
        assert data["end"] == "2026-09"


if __name__ == "__main__":
    pytest.main(["-v", __file__])
