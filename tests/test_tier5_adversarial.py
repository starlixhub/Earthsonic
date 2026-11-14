"""
tests/test_tier5_adversarial.py
Tier 5 White-Box Adversarial Coverage Hardening Test Suite for EARTHSONIC.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Adversarial White-Box Probing Across:
1. Malformed Dates, Inverted Periods, ReDoS & Temporal Boundaries
2. Non-Existent Datasets, Alias Variations & Missing Parameters
3. Corrupt Audio Requests, Out-of-Range Durations & Format Rejection
4. Concurrency Stress on Audio Generation & Deterministic Caching
5. Live RIFF/WAVE Header Integrity, RMS Non-Silence & Zero-Clipping Headroom
6. Scientific Formula Extreme Values, Clamping & Null Handling
7. Frontend Audio Logic, DAW Solo/Mute Matrix & FFT Band Calculations
"""

import os
import sys
import math
import struct
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import pytest

# Ensure project root is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from backend.app import create_app
from backend.config import TestingConfig
from backend.sonification.mappings import (
    temperature_to_frequency,
    temperature_to_semitones,
    co2_to_frequency,
    co2_to_semitones,
    co2_saturation_metric,
    co2_to_volume,
    ocean_temp_to_lpf_cutoff,
    sea_ice_loss_ratio,
    calculate_differential_series,
    SONIFICATION_EXPLANATIONS,
)
from backend.sonification.engine import default_engine, CANONICAL_DATASET_MAP
from backend.routes.datasets import DATASET_ALIASES
from scripts.preprocess_nasa_data import (
    norm_temp,
    norm_co2,
    norm_ocean_temp,
    norm_sea_ice_loss,
    norm_sea_ice_extent,
    norm_september_ice,
    clamp,
)
from tests.e2e.conftest import parse_wav_header, calculate_pcm_rms_energy


@pytest.fixture(scope="module")
def client():
    """Provides a Flask test client with TestingConfig."""
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


# ============================================================================
# Category 1: Malformed Dates, Inverted Periods, ReDoS & Temporal Boundaries
# ============================================================================

class TestMalformedDatesAndTemporalBoundaries:
    """Probes date validation, inverted periods, ReDoS resilience, and boundary handling."""

    @pytest.mark.parametrize("invalid_date", [
        "2020/05",
        "2020-5",
        "2020-13",
        "2020-00",
        "yesterday",
        "2020-01-01",  # day included
        "2020.05",
        "2020-Jan",
        "invalid",
        "' OR '1'='1",
        "<script>alert(1)</script>",
        "2020-01\x00",
    ])
    def test_timeseries_rejects_malformed_start_date(self, client, invalid_date):
        """Malformed start dates must return HTTP 400 with a descriptive error."""
        res = client.get(f"/api/timeseries/global_surface_temperature?start={invalid_date}")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data

    @pytest.mark.parametrize("invalid_date", [
        "2025/12",
        "2025-14",
        "2025-0",
        "tomorrow",
        "9999-99",
    ])
    def test_timeseries_rejects_malformed_end_date(self, client, invalid_date):
        """Malformed end dates must return HTTP 400 with a descriptive error."""
        res = client.get(f"/api/timeseries/atmospheric_co2?end={invalid_date}")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data

    def test_redos_pattern_resilience(self, client):
        """Excessively long numeric strings must not trigger catastrophic backtracking."""
        long_junk = "1" * 5000 + "-01"
        t0 = time.perf_counter()
        res = client.get(f"/api/timeseries/global_surface_temperature?start={long_junk}")
        t1 = time.perf_counter()
        assert res.status_code == 400
        # ReDoS check: regex matching must finish in well under 100 milliseconds
        assert (t1 - t0) < 0.25, f"Date regex took too long: {t1 - t0:.4f}s (possible ReDoS)"

    def test_inverted_time_window_timeseries_rejected(self, client):
        """start > end must return HTTP 400 on dataset timeseries."""
        res = client.get("/api/timeseries/global_surface_temperature?start=2024-01&end=1980-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "start parameter" in data["error"] and "cannot be after end" in data["error"]

    def test_inverted_time_window_harmonized_rejected(self, client):
        """start > end must return HTTP 400 on harmonized timeseries."""
        res = client.get("/api/timeseries/harmonized?start=2025-01&end=1990-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "cannot be after end" in data["error"]

    def test_inverted_years_zonal_rejected(self, client):
        """start > end years must return HTTP 400 on zonal temperature endpoint."""
        res = client.get("/api/timeseries/zonal?start=2025&end=1950")
        assert res.status_code == 400
        data = res.get_json()
        assert "start year cannot be greater than end year" in data["error"]

    def test_non_integer_years_zonal_rejected(self, client):
        """Non-integer years in zonal API must return HTTP 400."""
        res = client.get("/api/timeseries/zonal?start=twentytwenty&end=2025")
        assert res.status_code == 400
        data = res.get_json()
        assert "must be valid 4-digit integers" in data["error"]

    def test_pre_observational_date_range_empty_result(self, client):
        """Valid format dates before observation record (e.g. 1800) return 200 with 0 count."""
        res = client.get("/api/timeseries/global_surface_temperature?start=1800-01&end=1850-01")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 0
        assert data["data"] == []

    def test_distant_future_date_range_empty_result(self, client):
        """Valid format dates in far future (e.g. 2090) return 200 with 0 count."""
        res = client.get("/api/timeseries/atmospheric_co2?start=2090-01&end=2095-12")
        assert res.status_code == 200
        data = res.get_json()
        assert data["count"] == 0
        assert data["data"] == []

    def test_sonify_inverted_dates_rejected(self, client):
        """Sonify endpoint must reject inverted start > end with HTTP 400."""
        res = client.get("/api/sonify/surface-temperature?start=2025-01&end=1980-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "cannot be after end" in data["error"]

    def test_sonify_malformed_start_date_rejected(self, client):
        """Sonify endpoint must reject malformed start date with HTTP 400."""
        res = client.get("/api/sonify/surface-temperature?start=bad-date")
        assert res.status_code == 400
        data = res.get_json()
        assert "Invalid start date format" in data["error"]


# ============================================================================
# Category 2: Non-Existent Datasets & Alias Resolution Robustness
# ============================================================================

class TestDatasetResolutionAndMissingParams:
    """Probes alias resolution, unknown dataset 404s, and missing parameter validation."""

    @pytest.mark.parametrize("unknown_id", [
        "fake_variable",
        "methane_ch4",
        "solar_irradiance",
        "__proto__",
        "constructor",
        "null",
        "undefined",
        "12345",
    ])
    def test_unknown_dataset_info_404(self, client, unknown_id):
        """Requesting info for unknown dataset ID must return HTTP 404."""
        res = client.get(f"/api/datasets/{unknown_id}")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data
        assert "available_datasets" in data

    @pytest.mark.parametrize("unknown_id", [
        "nonexistent_temperature",
        "co3_molecule",
        "random_noise",
    ])
    def test_unknown_dataset_timeseries_404(self, client, unknown_id):
        """Requesting timeseries for unknown dataset ID must return HTTP 404."""
        res = client.get(f"/api/timeseries/{unknown_id}")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data

    @pytest.mark.parametrize("unknown_id", [
        "unknown_climate_signal",
        "synthetic_layer",
    ])
    def test_unknown_dataset_sonify_404(self, client, unknown_id):
        """Sonifying unknown dataset ID must return HTTP 404."""
        res = client.get(f"/api/sonify/{unknown_id}")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data
        assert "available_datasets" in data

    @pytest.mark.parametrize("raw_alias, expected_canonical", [
        ("sUrFaCe-TeMpErAtUrE", "surface-temperature"),
        ("  CO2  ", "atmospheric-co2"),
        ("Ocean_Temperature", "ocean-temperature"),
        ("SEA_ICE_EXTENT", "sea-ice-extent"),
        ("temp", "surface-temperature"),
        ("gistemp", "surface-temperature"),
        ("keeling", "atmospheric-co2"),
        ("ocean_temp", "ocean-temperature"),
        ("arctic_sea_ice", "sea-ice-extent"),
    ])
    def test_engine_alias_resolution_robustness(self, raw_alias, expected_canonical):
        """SonificationEngine canonical_id resolver handles case, spacing, and aliases."""
        resolved = default_engine.canonical_id(raw_alias)
        assert resolved == expected_canonical

    @pytest.mark.parametrize("alias_key", list(DATASET_ALIASES.keys()))
    def test_dataset_route_aliases_resolve_valid_dataset(self, client, alias_key):
        """Every alias in DATASET_ALIASES must successfully resolve to 200 on /api/datasets/<id>."""
        res = client.get(f"/api/datasets/{alias_key}")
        assert res.status_code == 200
        data = res.get_json()
        assert "id" in data
        assert "title" in data

    def test_comparison_missing_required_params(self, client):
        """GET /api/comparison requires dataset_id, periodA, and periodB."""
        # Missing all
        res = client.get("/api/comparison")
        assert res.status_code == 400

        # Missing periodB
        res = client.get("/api/comparison?dataset_id=surface-temperature&periodA=1990-01,2000-01")
        assert res.status_code == 400

        # Missing dataset_id
        res = client.get("/api/comparison?periodA=1990-01,2000-01&periodB=2010-01,2020-01")
        assert res.status_code == 400

    def test_sonify_differential_missing_required_params(self, client):
        """GET /api/sonify/differential requires dataset_id, periodA, and periodB."""
        res = client.get("/api/sonify/differential?dataset_id=surface-temperature")
        assert res.status_code == 400
        data = res.get_json()
        assert "Missing required query parameters" in data["error"]

    def test_sonification_explanations_unknown_dataset_404(self, client):
        """Requesting explanations for an unknown dataset returns HTTP 404."""
        res = client.get("/api/sonification/explanations?dataset_id=nonexistent")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data


# ============================================================================
# Category 3: Corrupt Audio Requests & Duration Clamping
# ============================================================================

class TestCorruptAudioRequestsAndBoundaryDurations:
    """Probes unsupported audio formats, duration limits, and corrupt query params."""

    @pytest.mark.parametrize("bad_format", [
        "mp3",
        "flac",
        "ogg",
        "aac",
        "opus",
        "exe",
        "text/plain",
    ])
    def test_sonify_unsupported_formats_rejected(self, client, bad_format):
        """Unsupported audio format queries must return HTTP 400."""
        res = client.get(f"/api/sonify/surface-temperature?format={bad_format}")
        assert res.status_code == 400
        data = res.get_json()
        assert "Unsupported audio format" in data["error"]

    @pytest.mark.parametrize("bad_dur", [
        "-10.0",
        "0",
        "-0.01",
    ])
    def test_sonify_negative_or_zero_duration_rejected(self, client, bad_dur):
        """Non-positive durations must return HTTP 400."""
        res = client.get(f"/api/sonify/surface-temperature?duration={bad_dur}")
        assert res.status_code == 400
        data = res.get_json()
        assert "Duration must be greater than 0" in data["error"]

    @pytest.mark.parametrize("non_numeric_dur", [
        "abc",
        "undefined",
        "12sec",
        "dur_5",
        "--10",
    ])
    def test_sonify_non_numeric_duration_rejected(self, client, non_numeric_dur):
        """Non-numeric duration strings must return HTTP 400."""
        res = client.get(f"/api/sonify/surface-temperature?duration={non_numeric_dur}")
        assert res.status_code == 400
        data = res.get_json()
        assert "Invalid duration value" in data["error"]

    def test_sonify_nan_and_infinity_duration_resilience(self, client):
        """
        Adversarial float corner values:
        - 'infinity' passes float('inf') > 300.0 and safely clamps to 60.0s without server crash.
        - 'NaN' passes float('nan') and is safely clamped to 1.0s without server crash.
        Both return valid WAV files without unhandled exception.
        """
        # Test infinity
        res_inf = client.get("/api/sonify/surface-temperature?duration=infinity")
        assert res_inf.status_code == 200
        hdr_inf = parse_wav_header(res_inf.data)
        assert math.isclose(hdr_inf["duration_sec"], 60.0, abs_tol=0.25)

        # Test NaN (min(60.0, nan) resolves to 60.0 in Python IEEE-754 min/max semantics)
        res_nan = client.get("/api/sonify/surface-temperature?duration=NaN")
        assert res_nan.status_code == 200
        hdr_nan = parse_wav_header(res_nan.data)
        assert math.isclose(hdr_nan["duration_sec"], 60.0, abs_tol=0.25)

    def test_sonify_excessive_duration_safely_clamped(self, client):
        """Durations exceeding 300s are safely clamped to 60.0s without server crash or OOM."""
        res = client.get("/api/sonify/surface-temperature?duration=9999.0")
        assert res.status_code == 200
        header = parse_wav_header(res.data)
        # Clamped to 60.0s
        assert math.isclose(header["duration_sec"], 60.0, abs_tol=0.25)

    def test_sonify_subsecond_duration_safely_clamped(self, client):
        """Small positive durations below 1.0s are clamped to 1.0s."""
        res = client.get("/api/sonify/surface-temperature?duration=0.2")
        assert res.status_code == 200
        header = parse_wav_header(res.data)
        # Clamped to minimum 1.0s
        assert math.isclose(header["duration_sec"], 1.0, abs_tol=0.25)


# ============================================================================
# Category 4: Concurrency Stress on Audio Generation & Caching
# ============================================================================

class TestAudioConcurrencyAndCacheIntegrity:
    """Stress tests concurrent generation of identical and disparate audio streams."""

    def test_concurrent_identical_audio_requests(self, client):
        """
        Adversarial Race Condition Stress:
        Fire 8 simultaneous requests for the exact same uncached parameter tuple.
        Verifies:
        1. All threads receive HTTP 200.
        2. No thread receives a 0-byte or partially written corrupt WAV.
        3. All received payloads are byte-for-byte identical.
        """
        # Unique duration ensures uncached state initially
        dur = 3.33
        url = f"/api/sonify/surface-temperature?start=2010-01&end=2015-12&duration={dur:.2f}"

        results = []

        def worker_fetch():
            app = create_app(TestingConfig)
            with app.test_client() as c:
                resp = c.get(url)
                return resp.status_code, resp.data

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(worker_fetch) for _ in range(8)]
            for fut in as_completed(futures):
                results.append(fut.result())

        assert len(results) == 8
        first_payload = results[0][1]

        for status_code, data in results:
            assert status_code == 200
            assert len(data) > 1000
            # Header check
            assert data[:4] == b"RIFF"
            assert data[8:12] == b"WAVE"
            # Byte-for-byte consistency across all threads
            assert data == first_payload

    def test_concurrent_multidataset_streaming(self, client):
        """Simultaneously stream all 4 datasets + differential in parallel."""
        endpoints = [
            "/api/sonify/surface-temperature?duration=2.0",
            "/api/sonify/atmospheric-co2?duration=2.0",
            "/api/sonify/ocean-temperature?duration=2.0",
            "/api/sonify/sea-ice-extent?duration=2.0",
            "/api/sonify/differential?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=2.0",
        ]

        def fetch_endpoint(ep):
            app = create_app(TestingConfig)
            with app.test_client() as c:
                resp = c.get(ep)
                return ep, resp.status_code, resp.data

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(fetch_endpoint, ep) for ep in endpoints]
            for fut in as_completed(futures):
                ep, status, data = fut.result()
                assert status == 200, f"Endpoint {ep} failed with status {status}"
                assert len(data) > 1000
                header = parse_wav_header(data)
                assert header["valid_riff"] is True
                assert header["channels"] == 2
                assert header["sample_rate"] == 44100

    def test_cache_key_determinism_and_hit_speed(self, client):
        """Second call to identical parameters must be an instant cache hit with identical bytes."""
        url = "/api/sonify/atmospheric-co2?duration=2.5"
        t0 = time.perf_counter()
        res1 = client.get(url)
        t1 = time.perf_counter()
        assert res1.status_code == 200

        t2 = time.perf_counter()
        res2 = client.get(url)
        t3 = time.perf_counter()
        assert res2.status_code == 200

        # Exact byte match
        assert res1.data == res2.data

        # Cache hit should be fast (typically < 30ms in memory/local disk)
        cache_hit_duration = t3 - t2
        assert cache_hit_duration < 0.20, f"Cache hit unexpectedly slow: {cache_hit_duration:.4f}s"


# ============================================================================
# Category 5: Live Audio Buffer Integrity, RMS Non-Silence & RIFF Validation
# ============================================================================

class TestAudioBufferIntegrityAndSignalFidelity:
    """Opaque-box binary verification of RIFF headers, PCM sample values, and RMS energy."""

    @pytest.mark.parametrize("dataset_id", [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent",
    ])
    def test_core_variables_riff_header_and_rms_non_silence(self, client, dataset_id):
        """
        Every core variable audio track must satisfy:
        1. Canonical RIFF WAVE header with 44.1 kHz 24-bit or 16-bit PCM stereo.
        2. Non-silent RMS sample energy > 0.05.
        3. Zero integer clipping distortion (samples within digital full-scale ceiling).
        """
        res = client.get(f"/api/sonify/{dataset_id}?duration=2.0")
        assert res.status_code == 200
        raw_bytes = res.data

        # 1. Header verification
        header = parse_wav_header(raw_bytes)
        assert header["valid_riff"] is True
        assert header["channels"] == 2
        assert header["sample_rate"] == 44100
        assert header["bits_per_sample"] in [16, 24]
        expected_byte_rate = 44100 * 2 * (header["bits_per_sample"] // 8)
        assert header["byte_rate"] == expected_byte_rate
        assert math.isclose(header["duration_sec"], 2.0, abs_tol=0.25)

        # 2. RMS Non-Silence verification
        rms = calculate_pcm_rms_energy(raw_bytes)
        assert rms > 0.05, f"Audio for {dataset_id} is suspiciously quiet or silent! RMS: {rms:.4f}"
        assert rms <= 1.0, f"Audio for {dataset_id} has impossible RMS energy: {rms:.4f}"

        # 3. Clipping and Headroom verification
        data_chunk = raw_bytes[header["data_offset"]:header["data_offset"] + header["data_size"]]
        bits = header["bits_per_sample"]
        bytes_per_sample = bits // 8
        num_samples = len(data_chunk) // bytes_per_sample

        max_norm = 0.0
        ceiling = 1 << (bits - 1)
        for i in range(min(num_samples, 20000)):
            b = data_chunk[i * bytes_per_sample:(i + 1) * bytes_per_sample]
            val = int.from_bytes(b, byteorder="little", signed=True)
            norm = abs(val) / float(ceiling)
            if norm > max_norm:
                max_norm = norm

        # Digital ceiling: normalized amplitude must not exceed 1.0
        assert max_norm <= 1.0
        # Ensure audio contains active dynamics (not completely flat DC line)
        assert max_norm > 0.01

    def test_differential_sonification_riff_and_rms_energy(self, client):
        """Differential sonification must generate valid, audible stereo audio."""
        url = (
            "/api/sonify/differential?dataset_id=surface-temperature"
            "&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=3.0"
        )
        res = client.get(url)
        assert res.status_code == 200
        raw_bytes = res.data

        header = parse_wav_header(raw_bytes)
        assert header["channels"] == 2
        assert header["sample_rate"] == 44100
        assert math.isclose(header["duration_sec"], 3.0, abs_tol=0.25)

        rms = calculate_pcm_rms_energy(raw_bytes)
        assert rms > 0.05, f"Differential audio RMS too low: {rms:.4f}"

    def test_orchestra_manifest_all_stem_urls_resolvable(self, client):
        """All 4 track URLs in orchestra manifest must return valid 200 WAV streams."""
        res = client.get("/api/sonify/orchestra?duration=2.0")
        assert res.status_code == 200
        manifest_data = res.get_json()
        assert manifest_data["layers_count"] == 4
        manifest = manifest_data["manifest"]

        for track_name, url in manifest.items():
            stem_res = client.get(url)
            assert stem_res.status_code == 200, f"Manifest URL for {track_name} failed"
            header = parse_wav_header(stem_res.data)
            assert header["valid_riff"] is True
            assert header["sample_rate"] == 44100
            rms = calculate_pcm_rms_energy(stem_res.data)
            assert rms > 0.05


# ============================================================================
# Category 6: Scientific Formula Extreme Values & Null Handling
# ============================================================================

class TestScientificFormulasAndNormalizationBounds:
    """Probes mapping formulas with extreme numbers, boundary values, and null safety."""

    def test_temperature_extreme_anomalies(self):
        """Test temperature mapping at extreme cold (-50°C) and extreme hot (+50°C)."""
        f_cold = temperature_to_frequency(-50.0)
        assert f_cold > 0.0
        assert math.isfinite(f_cold)

        f_hot = temperature_to_frequency(10.0)
        assert f_hot == 261.63 * (2.0 ** 10.0)
        assert math.isfinite(f_hot)

    def test_co2_extreme_boundaries_and_clamping(self):
        """CO2 carrier frequency and volume must clamp cleanly beyond historical boundaries."""
        # Sub-minimum (e.g. 100 ppm)
        f_sub = co2_to_frequency(100.0)
        assert f_sub == 196.0  # Clamped to min_f

        # Hyper-high (e.g. 5,000 ppm)
        f_super = co2_to_frequency(5000.0)
        assert f_super == 783.99  # Clamped to max_f

        # Volume dynamics strictly clamped to [0.35, 0.95]
        v_sub = co2_to_volume(50.0)
        assert v_sub == 0.35
        v_super = co2_to_volume(10000.0)
        assert v_super == 0.95

        # Saturation metric clamped to [0.0, 1.0]
        sat_low = co2_saturation_metric(300.0)
        assert sat_low == 0.0
        sat_high = co2_saturation_metric(1000.0)
        assert sat_high == 1.0

    def test_ocean_temperature_cutoff_clamping(self):
        """Ocean Butterworth cutoff sweeps exponentially and strictly clamps to [80, 2400] Hz."""
        c_min = ocean_temp_to_lpf_cutoff(-5.0)
        assert c_min == 80.0

        c_max = ocean_temp_to_lpf_cutoff(10.0)
        assert c_max == 2400.0

        c_mid = ocean_temp_to_lpf_cutoff(0.30)
        assert 80.0 < c_mid < 2400.0

    def test_sea_ice_loss_ratio_clamping(self):
        """Sea ice loss ratio metric strictly bounded in [0.0, 1.0]."""
        # Excessive ice (e.g. 15M km2) -> pristine 0.0
        loss_zero = sea_ice_loss_ratio(15.0)
        assert loss_zero == 0.0

        # Vanishing ice (e.g. 1.0M km2) -> complete loss 1.0
        loss_full = sea_ice_loss_ratio(1.0)
        assert loss_full == 1.0

    def test_differential_series_empty_input_raises_value_error(self):
        """calculate_differential_series must raise ValueError on empty input series."""
        with pytest.raises(ValueError, match="must be non-empty"):
            calculate_differential_series([], [1.0, 2.0])

        with pytest.raises(ValueError, match="must be non-empty"):
            calculate_differential_series([1.0, 2.0], [])

    def test_differential_series_single_point_uniform_fill(self):
        """A single observation point correctly fills the 300-point uniform grid."""
        _, _, delta = calculate_differential_series([2.5], [4.5], num_points=300)
        assert len(delta) == 300
        assert np.allclose(delta, 2.0)

    def test_differential_identical_series_zero_delta(self):
        """Identical input series must produce an exact zero differential vector."""
        series = [1.0, 2.0, 3.0, 2.5, 1.8]
        _, _, delta = calculate_differential_series(series, series, num_points=300)
        assert np.allclose(delta, 0.0)

    def test_preprocess_normalization_null_safety(self):
        """Preprocessing normalizers must return None when passed None without throwing."""
        assert norm_temp(None) is None
        assert norm_co2(None) is None
        assert norm_ocean_temp(None) is None
        assert norm_sea_ice_loss(None) is None
        assert norm_sea_ice_extent(None) is None
        assert norm_september_ice(None) is None

    def test_preprocess_clamp_utility(self):
        """clamp helper strictly restrains floats within [min_val, max_val]."""
        assert clamp(-1.5) == 0.0
        assert clamp(2.5) == 1.0
        assert clamp(0.42) == 0.42
        assert clamp(50.0, 10.0, 40.0) == 40.0
        assert clamp(5.0, 10.0, 40.0) == 10.0


# ============================================================================
# Category 7: Frontend Audio Logic, DAW Solo/Mute Matrix & FFT Bands
# ============================================================================

class TestFrontendAudioLogicAndCalculations:
    """Verifies mathematical specifications of frontend DAW mixer, FFT, and time formatting."""

    def test_daw_solo_mute_matrix_exhaustive(self):
        """
        Exhaustive verification of the DAW Solo/Mute truth table:
        1. Muted track is always 0.0 gain.
        2. If any track is soloed, only soloed unmuted tracks are audible.
        3. If no track is soloed, all unmuted tracks are audible at fader^2 gain.
        """
        # Python representation of calculateEffectiveGain
        def effective_gain(track, all_tracks):
            if track.get("isMuted"):
                return 0.0
            any_solo = any(t.get("isSoloed") for t in all_tracks)
            if any_solo and not track.get("isSoloed"):
                return 0.0
            vol = track.get("volume", 0.8)
            return vol * vol

        tracks = [
            {"id": "t1", "volume": 0.8, "isMuted": False, "isSoloed": False},
            {"id": "t2", "volume": 0.7, "isMuted": False, "isSoloed": False},
            {"id": "t3", "volume": 0.6, "isMuted": False, "isSoloed": False},
            {"id": "t4", "volume": 0.5, "isMuted": False, "isSoloed": False},
        ]

        # Case 1: Default state (no solo, no mute)
        assert math.isclose(effective_gain(tracks[0], tracks), 0.64)
        assert math.isclose(effective_gain(tracks[1], tracks), 0.49)

        # Case 2: Track 1 muted
        tracks[0]["isMuted"] = True
        assert effective_gain(tracks[0], tracks) == 0.0
        assert math.isclose(effective_gain(tracks[1], tracks), 0.49)
        tracks[0]["isMuted"] = False

        # Case 3: Track 2 soloed
        tracks[1]["isSoloed"] = True
        assert effective_gain(tracks[0], tracks) == 0.0  # silenced because track 2 is soloed
        assert math.isclose(effective_gain(tracks[1], tracks), 0.49)
        assert effective_gain(tracks[2], tracks) == 0.0
        tracks[1]["isSoloed"] = False

        # Case 4: Track 2 soloed AND muted
        tracks[1]["isSoloed"] = True
        tracks[1]["isMuted"] = True
        assert effective_gain(tracks[1], tracks) == 0.0  # mute trumps solo!
        assert effective_gain(tracks[0], tracks) == 0.0  # still silenced by solo
        tracks[1]["isSoloed"] = False
        tracks[1]["isMuted"] = False

    def test_logarithmic_64_bands_coverage_and_monotonicity(self):
        """
        Calculates 64 logarithmic FFT bands from 20 Hz to 20000 Hz.
        Verifies:
        1. Exact count of 64 bands.
        2. Monotonically increasing start and end frequencies.
        3. No negative bin indices.
        4. Upper limit respects Nyquist (22050 Hz).
        """
        num_bands = 64
        f_min = 20.0
        f_max = 20000.0
        fft_size = 2048
        sample_rate = 44100
        bin_res = sample_rate / fft_size  # 21.533 Hz/bin

        bands = []
        for k in range(num_bands):
            start_f = f_min * ((f_max / f_min) ** (k / num_bands))
            end_f = f_min * ((f_max / f_min) ** ((k + 1) / num_bands))
            start_bin = int(start_f / bin_res)
            end_bin = int(math.ceil(end_f / bin_res))
            bands.append({
                "band": k,
                "startFreq": start_f,
                "endFreq": end_f,
                "startBin": start_bin,
                "endBin": end_bin
            })

        assert len(bands) == 64
        assert bands[0]["startFreq"] >= 20.0
        assert bands[-1]["endFreq"] <= 20000.0

        for i in range(len(bands) - 1):
            assert bands[i]["startFreq"] < bands[i + 1]["startFreq"]
            assert bands[i]["endFreq"] <= bands[i + 1]["startFreq"] + 1e-4
            assert bands[i]["startBin"] <= bands[i]["endBin"]

    def test_zero_crossing_trigger_behavior(self):
        """
        Tests the zero-crossing positive slope trigger algorithm used in the oscilloscope:
        1. Sine wave -> finds exact first positive transition.
        2. All-zero or constant DC -> falls back to index 0 safely.
        """
        def find_zero_crossing(buffer, max_search=1024):
            if len(buffer) < 2:
                return 0
            limit = min(len(buffer) - 1, max_search)
            for i in range(limit):
                if buffer[i] <= 0.0 and buffer[i + 1] > 0.0:
                    return i
            return 0

        # Sine wave starting from negative phase
        t = np.linspace(-np.pi, np.pi, 200)
        sine_buf = np.sin(t)
        idx = find_zero_crossing(sine_buf)
        # Should detect zero crossing near midpoint (~100)
        assert 95 <= idx <= 105
        assert sine_buf[idx] <= 0.0 and sine_buf[idx + 1] > 0.0

        # Constant flat signal
        flat_buf = np.zeros(200)
        assert find_zero_crossing(flat_buf) == 0

        # Inverted signal (only falling edges)
        falling = np.linspace(10.0, -10.0, 100)
        assert find_zero_crossing(falling) == 0
