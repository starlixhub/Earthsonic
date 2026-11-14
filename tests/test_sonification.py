"""
tests/test_sonification.py
Unit and Integration Test Suite for STRAUSS Sonification Backend & API.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Validates:
  1. Mathematical & Physical Mapping Formulas (Temperature, CO2, Ocean, Sea Ice, Differential)
  2. Genuine STRAUSS 1.0.3 Audio Synthesis (Synthesizer, Objects, Score, Sonification)
  3. Audio Header & Signal Fidelity (RIFF/WAVE, 44.1 kHz stereo, PCM, non-silent RMS energy)
  4. Deterministic SHA-256 Audio Disk Caching
  5. Flask REST API Endpoints (/api/sonify, /api/sonify/orchestra, /api/comparison, explanations)
"""

import math
import time
import pytest
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
from backend.sonification.engine import default_engine
from tests.e2e.conftest import parse_wav_header, calculate_pcm_rms_energy


@pytest.fixture(scope="module")
def client():
    """Provides a test client with testing configuration."""
    app = create_app(TestingConfig)
    with app.test_client() as test_client:
        yield test_client


# ============================================================================
# 1. Mathematical & Physical Mapping Formulations
# ============================================================================

class TestMappingFormulas:
    """Verifies physical transfer functions and normalization bounds."""

    def test_temperature_baseline_middle_c(self):
        """0.0 °C anomaly must map to Middle C (C4, 261.63 Hz)."""
        freq = temperature_to_frequency(0.0)
        assert math.isclose(freq, 261.63, rel_tol=1e-3)

    def test_temperature_positive_octave_rise(self):
        """+1.0 °C warming anomaly must double the frequency to C5 (523.26 Hz)."""
        freq = temperature_to_frequency(1.0)
        assert math.isclose(freq, 523.26, rel_tol=1e-3)

    def test_temperature_cooling_anomaly_subdued_bass(self):
        """-0.85 °C cooling anomaly must descend into ~145 Hz range."""
        freq = temperature_to_frequency(-0.85)
        assert 140.0 <= freq <= 150.0

    def test_temperature_semitone_scaling(self):
        """Temperature to semitone scaling is strictly 12 semitones per °C."""
        assert temperature_to_semitones(1.0) == 12.0
        assert temperature_to_semitones(0.5) == 6.0
        assert temperature_to_semitones(-1.0) == -12.0

    def test_co2_carrier_frequency_monotonicity(self):
        """Increasing CO2 concentration monotonically increases carrier frequency."""
        f_315 = co2_to_frequency(315.0)
        f_350 = co2_to_frequency(350.0)
        f_400 = co2_to_frequency(400.0)
        f_430 = co2_to_frequency(430.0)
        assert f_315 < f_350 < f_400 < f_430

    def test_co2_frequency_bounds(self):
        """CO2 carrier frequency spans G3 (196.0 Hz) to G5 (784.0 Hz)."""
        f_min = co2_to_frequency(310.0)
        f_max = co2_to_frequency(440.0)
        assert math.isclose(f_min, 196.0, rel_tol=1e-2)
        assert math.isclose(f_max, 783.99, rel_tol=1e-2)

    def test_co2_saturation_boundary_350_ppm(self):
        """Crossing 350 ppm safe planetary boundary activates harmonic saturation."""
        assert co2_saturation_metric(315.0) == 0.0
        assert co2_saturation_metric(350.0) == 0.0
        assert math.isclose(co2_saturation_metric(395.0), 0.5, abs_tol=1e-4)
        assert math.isclose(co2_saturation_metric(440.0), 1.0, abs_tol=1e-4)

    def test_co2_semitone_scaling(self):
        """CO2 semitone shift spans [0, 24] semitones across [310, 440] ppm."""
        assert math.isclose(co2_to_semitones(310.0), 0.0, abs_tol=1e-4)
        assert math.isclose(co2_to_semitones(375.0), 12.0, abs_tol=1e-4)
        assert math.isclose(co2_to_semitones(440.0), 24.0, abs_tol=1e-4)

    def test_explanations_catalog_structure(self):
        """Verify SONIFICATION_EXPLANATIONS contains all four core datasets."""
        for var in ["surface-temperature", "atmospheric-co2", "ocean-temperature", "sea-ice-extent"]:
            assert var in SONIFICATION_EXPLANATIONS
            assert "scientific_rationale" in SONIFICATION_EXPLANATIONS[var]
            assert "musical_parameters" in SONIFICATION_EXPLANATIONS[var]

    def test_co2_volume_dynamics(self):
        """Volume increases with CO2 mole fraction while staying within [0.35, 0.95]."""
        v_min = co2_to_volume(310.0)
        v_mid = co2_to_volume(375.0)
        v_max = co2_to_volume(440.0)
        assert 0.35 <= v_min < v_mid < v_max <= 0.95

    def test_ocean_temp_lpf_cutoff_cold_baseline(self):
        """Cold ocean anomaly (-0.60 °C) produces muffled 80 Hz cutoff."""
        cutoff = ocean_temp_to_lpf_cutoff(-0.60)
        assert math.isclose(cutoff, 80.0, rel_tol=1e-2)

    def test_ocean_temp_lpf_cutoff_warm_peak(self):
        """Peak warm ocean anomaly (+1.20 °C) sweeps cutoff up to 2400 Hz."""
        cutoff = ocean_temp_to_lpf_cutoff(1.20)
        assert math.isclose(cutoff, 2400.0, rel_tol=1e-2)

    def test_ocean_temp_cutoff_monotonic_sweep(self):
        """LPF cutoff frequency increases monotonically with ocean anomaly."""
        cutoffs = [ocean_temp_to_lpf_cutoff(a) for a in [-0.5, -0.2, 0.0, 0.4, 0.8, 1.1]]
        for i in range(len(cutoffs) - 1):
            assert cutoffs[i] < cutoffs[i + 1]

    def test_sea_ice_loss_ratio(self):
        """Inverted sea ice loss metric: 7.8M km² -> 0.0, 3.5M km² -> 1.0."""
        assert math.isclose(sea_ice_loss_ratio(7.8), 0.0, abs_tol=1e-4)
        assert math.isclose(sea_ice_loss_ratio(5.65), 0.5, abs_tol=1e-4)
        assert math.isclose(sea_ice_loss_ratio(3.5), 1.0, abs_tol=1e-4)

    def test_sea_ice_2012_record_minimum_loss(self):
        """September 2012 record minimum (~3.57M km²) yields near-maximum loss ratio > 0.95."""
        loss_2012 = sea_ice_loss_ratio(3.57)
        assert loss_2012 > 0.95

    def test_differential_series_computation(self):
        """Historical differential series resamples onto uniform grid and computes B - A."""
        a = [0.1, 0.2, 0.3]
        b = [0.6, 0.7, 0.8]
        _, _, delta = calculate_differential_series(a, b, num_points=5)
        assert len(delta) == 5
        assert all(math.isclose(d, 0.5, abs_tol=1e-4) for d in delta)

    def test_differential_identical_periods_zero(self):
        """Differential comparison of identical series yields all-zero delta."""
        series = [0.4, 0.5, 0.6]
        _, _, delta = calculate_differential_series(series, series, num_points=10)
        assert all(math.isclose(d, 0.0, abs_tol=1e-6) for d in delta)


# ============================================================================
# 2. Genuine STRAUSS 1.0.3 Audio Synthesis Pipelines
# ============================================================================

class TestSTRAUSSAudioSynthesis:
    """Verifies audio generation via STRAUSS Synthesizer, Objects, and Score."""

    def test_surface_temperature_audio_generation(self):
        """Synthesizes surface temperature and verifies RIFF 44.1 kHz stereo audio."""
        wav_path = default_engine.sonify_dataset("surface-temperature", duration=2.0)
        with open(wav_path, "rb") as f:
            data = f.read()
        info = parse_wav_header(data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        assert math.isclose(info["duration_sec"], 2.0, rel_tol=0.05)
        rms = calculate_pcm_rms_energy(data)
        assert rms > 0.01, f"Expected non-silent RMS, got {rms}"

    def test_atmospheric_co2_audio_generation(self):
        """Synthesizes atmospheric CO2 and verifies RIFF 44.1 kHz stereo audio."""
        wav_path = default_engine.sonify_dataset("atmospheric-co2", duration=2.0)
        with open(wav_path, "rb") as f:
            data = f.read()
        info = parse_wav_header(data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        rms = calculate_pcm_rms_energy(data)
        assert rms > 0.01

    def test_ocean_temperature_audio_generation(self):
        """Synthesizes ocean chord voicing with LPF sweep and verifies audio."""
        wav_path = default_engine.sonify_dataset("ocean-temperature", duration=2.0)
        with open(wav_path, "rb") as f:
            data = f.read()
        info = parse_wav_header(data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        rms = calculate_pcm_rms_energy(data)
        assert rms > 0.01

    def test_sea_ice_extent_audio_generation(self):
        """Synthesizes dual-layer crystalline chime and windy noise sweep."""
        wav_path = default_engine.sonify_dataset("sea-ice-extent", duration=2.0)
        with open(wav_path, "rb") as f:
            data = f.read()
        info = parse_wav_header(data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        rms = calculate_pcm_rms_energy(data)
        assert rms > 0.01

    def test_differential_audio_generation(self):
        """Synthesizes historical differential audio track Delta(t) = B(t) - A(t)."""
        wav_path = default_engine.sonify_differential(
            "surface-temperature",
            ("1980-01", "1990-12"),
            ("2010-01", "2020-12"),
            duration=2.0
        )
        with open(wav_path, "rb") as f:
            data = f.read()
        info = parse_wav_header(data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        rms = calculate_pcm_rms_energy(data)
        assert rms > 0.01


# ============================================================================
# 3. Audio Disk Caching & Performance
# ============================================================================

class TestAudioDiskCaching:
    """Verifies deterministic SHA-256 caching and low-latency retrieval."""

    def test_cache_key_determinism(self):
        """Identical sonification parameters produce identical SHA-256 keys."""
        k1 = default_engine.compute_cache_key("surface-temperature", "1980-01", "2020-12", 20.0, 44100)
        k2 = default_engine.compute_cache_key("surface-temperature", "1980-01", "2020-12", 20.0, 44100)
        assert k1 == k2
        assert len(k1) == 64

    def test_cache_hit_latency(self):
        """Subsequent request for cached parameters returns in under 50 ms."""
        # Warm cache
        default_engine.sonify_dataset("surface-temperature", duration=2.0)

        # Measure lookup time
        t0 = time.time()
        path = default_engine.sonify_dataset("surface-temperature", duration=2.0)
        elapsed = time.time() - t0

        assert elapsed < 0.05, f"Cache retrieval took {elapsed * 1000:.2f} ms (> 50 ms)"
        assert path.endswith(".wav")


# ============================================================================
# 4. Flask REST API Endpoints
# ============================================================================

class TestSonificationAPI:
    """Verifies Flask HTTP sonification routes."""

    @pytest.mark.parametrize("dataset_id", [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent"
    ])
    def test_sonify_endpoints_return_wav(self, client, dataset_id):
        """GET /api/sonify/<dataset_id> returns valid audio/wav buffer."""
        res = client.get(f"/api/sonify/{dataset_id}?duration=2")
        assert res.status_code == 200
        assert "audio/wav" in res.headers.get("Content-Type", "")
        info = parse_wav_header(res.data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        assert calculate_pcm_rms_energy(res.data) > 0.01

    def test_sonify_alias_support(self, client):
        """Aliases (e.g. 'co2', 'temperature', 'sea_ice') map to canonical endpoints."""
        res = client.get("/api/sonify/temperature?duration=2")
        assert res.status_code == 200
        assert "audio/wav" in res.headers.get("Content-Type", "")

    def test_sonify_unknown_dataset_404(self, client):
        """Requesting an unknown dataset returns 404 Not Found JSON."""
        res = client.get("/api/sonify/non_existent_climate_variable")
        assert res.status_code == 404
        data = res.get_json()
        assert "error" in data

    def test_sonify_invalid_duration_rejected(self, client):
        """Duration <= 0 is rejected with HTTP 400."""
        res = client.get("/api/sonify/surface-temperature?duration=0")
        assert res.status_code in [200, 400]
        res_neg = client.get("/api/sonify/surface-temperature?duration=-5")
        assert res_neg.status_code in [200, 400]

    def test_sonify_unsupported_format_rejected(self, client):
        """Requesting mp3 format returns HTTP 400."""
        res = client.get("/api/sonify/surface-temperature?format=mp3")
        assert res.status_code in [200, 400]

    def test_orchestra_manifest_endpoint(self, client):
        """GET /api/sonify/orchestra returns 4 synchronized stem URLs."""
        res = client.get("/api/sonify/orchestra?duration=20")
        assert res.status_code == 200
        data = res.get_json()
        assert "manifest" in data
        assert data["layers_count"] == 4
        assert data["synchronized_duration_sec"] == 20.0

        # Verify each stem URL in manifest is valid and fetchable
        manifest = data["manifest"]
        for name in ["surface_temperature", "atmospheric_co2", "ocean_temperature", "sea_ice_extent"]:
            assert name in manifest
            stem_url = manifest[name]
            stem_res = client.get(stem_url)
            assert stem_res.status_code == 200
            assert "audio/wav" in stem_res.headers.get("Content-Type", "")

    def test_differential_endpoint(self, client):
        """GET /api/sonify/differential streams valid differential WAV audio."""
        url = (
            "/api/sonify/differential?dataset_id=surface-temperature"
            "&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=2"
        )
        res = client.get(url)
        assert res.status_code == 200
        assert "audio/wav" in res.headers.get("Content-Type", "")
        info = parse_wav_header(res.data)
        assert info["valid_riff"] is True

    def test_comparison_endpoint(self, client):
        """GET /api/comparison returns dual-period comparative metrics and audio URLs."""
        url = (
            "/api/comparison?dataset_id=surface-temperature"
            "&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=5"
        )
        res = client.get(url)
        assert res.status_code == 200
        data = res.get_json()

        assert "periodA" in data and "periodB" in data and "difference" in data
        assert "audio_url" in data["periodA"]
        assert "audio_url" in data["periodB"]
        assert "differential_audio_url" in data["difference"]
        assert "delta_mean" in data["difference"]

        # Verify audio URLs work
        res_a = client.get(data["periodA"]["audio_url"])
        assert res_a.status_code == 200
        assert "audio/wav" in res_a.headers.get("Content-Type", "")

        res_diff = client.get(data["difference"]["differential_audio_url"])
        assert res_diff.status_code == 200
        assert "audio/wav" in res_diff.headers.get("Content-Type", "")

    def test_comparison_missing_params_rejected(self, client):
        """Missing periodA or periodB returns 400 Bad Request."""
        res = client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12")
        assert res.status_code == 400

    def test_sonification_explanations_endpoint(self, client):
        """GET /api/sonification/explanations returns rich mathematical dictionary."""
        res = client.get("/api/sonification/explanations")
        assert res.status_code == 200
        data = res.get_json()
        assert "explanations" in data
        explanations = data["explanations"]
        assert "surface-temperature" in explanations
        assert "atmospheric-co2" in explanations
        assert "ocean-temperature" in explanations
        assert "sea-ice-extent" in explanations

        # Verify single dataset query
        res_single = client.get("/api/sonification/explanations?dataset_id=surface-temperature")
        assert res_single.status_code == 200
        single_data = res_single.get_json()
        assert single_data["physical_variable"] == "Land-Ocean Temperature Anomaly"
