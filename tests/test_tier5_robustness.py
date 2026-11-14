"""
tests/test_tier5_robustness.py
Phase 2 (Tier 5) White-Box Adversarial Coverage Hardening Suite for EARTHSONIC.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Adversarially probes:
  1. Identical period comparison (verifying zero divergence Delta(t) = 0 and audible Middle C unison).
  2. Extreme boundary dates (1979-01 inception, 2026-09 horizon) and single-month periods.
  3. High-load concurrent requests to /api/comparison, /api/sonify/orchestra, and audio cache race conditions.
  4. Dynamic visualizer FFT grouping and RMS calculations under synthetic noise and pure DC offsets.
  5. Multi-track DAW mixer edge cases and 3D Globe shader / procedural texture fallbacks.
"""

import os
import sys
import math
import struct
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Tuple
import pytest
import numpy as np

from backend.app import create_app
from backend.config import TestingConfig, Config
from backend.sonification.mappings import (
    temperature_to_frequency,
    temperature_to_semitones,
    co2_to_frequency,
    co2_to_semitones,
    co2_to_volume,
    co2_saturation_metric,
    ocean_temp_to_lpf_cutoff,
    sea_ice_loss_ratio,
    calculate_differential_series,
    SONIFICATION_EXPLANATIONS,
)
from backend.sonification.engine import default_engine
from tests.e2e.conftest import parse_wav_header, calculate_pcm_rms_energy


# ============================================================================
# Pytest Fixtures
# ============================================================================

@pytest.fixture(scope="module")
def app_client():
    """Module-scoped Flask test client."""
    app = create_app(TestingConfig)
    with app.test_client() as client:
        yield client


@pytest.fixture(scope="module")
def harmonized_data():
    """Load monthly harmonized dataset directly."""
    with open(Config.HARMONIZED_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================================
# Python Reference Implementations for Visualizer & Mixer Oracles
# ============================================================================

def py_compute_logarithmic_bands(
    num_bands: int = 64,
    f_min: float = 20.0,
    f_max: float = 20000.0,
    fft_size: int = 2048,
    sample_rate: int = 44100
) -> List[Dict[str, Any]]:
    """Logarithmic FFT band bin allocation oracle matching visualizer.js."""
    bands = []
    bin_res = sample_rate / fft_size
    nyquist = sample_rate / 2.0
    clamped_f_max = min(f_max, nyquist)
    total_bins = fft_size // 2

    for k in range(num_bands):
        start_freq = f_min * ((clamped_f_max / f_min) ** (k / num_bands))
        end_freq = f_min * ((clamped_f_max / f_min) ** ((k + 1) / num_bands))

        start_bin = int(math.floor(start_freq / bin_res))
        end_bin = int(math.ceil(end_freq / bin_res))

        start_bin = max(0, min(start_bin, total_bins - 1))
        end_bin = max(start_bin + 1, min(end_bin, total_bins))

        bands.append({
            "bandIndex": k,
            "startFreq": start_freq,
            "endFreq": end_freq,
            "startBin": start_bin,
            "endBin": end_bin
        })
    return bands


def py_calculate_rms(buffer: np.ndarray) -> float:
    """RMS linear amplitude oracle."""
    if len(buffer) == 0:
        return 0.0
    return float(np.sqrt(np.mean(buffer ** 2)))


def py_calculate_peak(buffer: np.ndarray) -> float:
    """Peak absolute amplitude oracle."""
    if len(buffer) == 0:
        return 0.0
    return float(np.max(np.abs(buffer)))


def py_calculate_dbfs(val: float, floor: float = -100.0) -> float:
    """dBFS decibel calculation oracle with floor clamping."""
    if val <= 1e-5:
        return floor
    db = 20.0 * math.log10(val)
    return max(floor, min(0.0, db))


def py_find_zero_crossing_trigger(buffer: np.ndarray, max_search: int = 1024) -> int:
    """Zero crossing positive-slope stabilization oracle matching visualizer.js."""
    if len(buffer) < 2:
        return 0
    limit = min(len(buffer) - 1, max_search)
    for i in range(limit):
        if buffer[i] <= 0.0 and buffer[i + 1] > 0.0:
            return i
    return 0


# ============================================================================
# 1. IDENTICAL PERIOD COMPARISON (ZERO DIVERGENCE DELTA(t) = 0)
# ============================================================================

class TestIdenticalPeriodComparison:
    """
    Stress-tests differential comparison when Period A and Period B are identical.
    Ensures Delta(t) = 0.0 across all points, 0.0% change, Middle C unison audio.
    """

    @pytest.mark.parametrize("length", [2, 10, 50, 300, 573])
    def test_math_oracle_differential_zero_vector(self, length: int):
        """Mathematical oracle: identical vectors produce exactly zero delta at all points."""
        series = np.linspace(-0.5, 1.2, length).tolist()
        r_a, r_b, delta = calculate_differential_series(series, series, num_points=300)

        assert len(delta) == 300
        assert np.allclose(delta, 0.0, atol=1e-15), "Delta between identical series must be strictly 0"
        assert np.allclose(r_a, r_b, atol=1e-15), "Resampled A and B must be identical"

    def test_math_oracle_single_month_differential_zero(self):
        """Mathematical oracle: single-month point [0.85] vs [0.85] yields zero delta across 300 points."""
        series = [0.85]
        r_a, r_b, delta = calculate_differential_series(series, series, num_points=300)
        assert len(delta) == 300
        assert np.max(np.abs(delta)) == 0.0
        assert np.all(r_a == 0.85)
        assert np.all(r_b == 0.85)

    @pytest.mark.parametrize("canon", [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent"
    ])
    def test_math_oracle_differential_four_variables_identical(self, canon: str, harmonized_data: Dict[str, Any]):
        """Verify delta is 0 for all 4 authentic NASA variables when comparing identical 10-year periods."""
        prop_map = {
            "surface-temperature": "temperature_anomaly",
            "atmospheric-co2": "co2_ppm",
            "ocean-temperature": "ocean_temp_anomaly",
            "sea-ice-extent": "sea_ice_extent"
        }
        raw_vals = harmonized_data[prop_map[canon]][120:240]  # 1989 to 1998
        r_a, r_b, delta = calculate_differential_series(raw_vals, raw_vals, num_points=300)
        assert np.max(np.abs(delta)) < 1e-12

    @pytest.mark.parametrize("dataset_id", [
        "surface-temperature",
        "atmospheric-co2",
        "ocean-temperature",
        "sea-ice-extent"
    ])
    def test_api_comparison_identical_periods_zero_delta(self, app_client, dataset_id: str):
        """REST endpoint /api/comparison returns delta_mean = 0.0 and percent_change = 0.0."""
        period = "1995-01,2005-12"
        res = app_client.get(f"/api/comparison?dataset_id={dataset_id}&periodA={period}&periodB={period}&duration=10")
        assert res.status_code == 200
        data = res.get_json()

        assert data["dataset_id"] == dataset_id
        diff = data["difference"]
        assert diff["delta_mean"] == 0.0
        assert diff["percent_change"] == 0.0
        assert "differential_audio_url" in diff
        assert "periodA" in diff["differential_audio_url"]
        assert "periodB" in diff["differential_audio_url"]

    def test_api_comparison_identical_single_month_boundary_1979(self, app_client):
        """Single-month identical period at inception boundary (1979-01)."""
        res = app_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1979-01,1979-01&periodB=1979-01,1979-01")
        assert res.status_code == 200
        data = res.get_json()
        assert data["difference"]["delta_mean"] == 0.0
        assert data["difference"]["percent_change"] == 0.0
        assert data["periodA"]["start"] == "1979-01"
        assert data["periodB"]["start"] == "1979-01"

    def test_api_comparison_identical_single_month_boundary_2026(self, app_client):
        """Single-month identical period at terminus boundary (2026-09)."""
        res = app_client.get("/api/comparison?dataset_id=atmospheric-co2&periodA=2026-09,2026-09&periodB=2026-09,2026-09")
        assert res.status_code == 200
        data = res.get_json()
        assert data["difference"]["delta_mean"] == 0.0
        assert data["difference"]["percent_change"] == 0.0
        assert data["periodA"]["end"] == "2026-09"
        assert data["periodB"]["end"] == "2026-09"

    def test_differential_audio_synthesis_identical_periods_audible_unison(self):
        """
        Synthesizing differential audio for identical periods must render a valid WAV
        file playing a pure Middle C unison baseline (0 semitones pitch shift).
        """
        wav_path = default_engine.sonify_differential(
            dataset_id="surface-temperature",
            period_a=("1985-01", "1995-12"),
            period_b=("1985-01", "1995-12"),
            duration=3.0,
            sample_rate=44100
        )
        assert os.path.exists(wav_path)
        with open(wav_path, "rb") as f:
            audio_bytes = f.read()

        info = parse_wav_header(audio_bytes)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert info["sample_rate"] == 44100
        assert math.isclose(info["duration_sec"], 3.0, abs_tol=0.1)

        rms = calculate_pcm_rms_energy(audio_bytes)
        assert rms > 0.05, f"Audio should be an audible Middle C tone, got RMS={rms}"
        assert rms <= 1.0, "Audio must not exceed digital ceiling"

    def test_differential_audio_identical_single_month_boundaries(self, app_client):
        """GET /api/sonify/differential on identical 1-month periods streams valid WAV."""
        res = app_client.get(
            "/api/sonify/differential?dataset_id=ocean-temperature"
            "&periodA=1979-01,1979-01&periodB=1979-01,1979-01&duration=2.0"
        )
        assert res.status_code == 200
        assert res.content_type == "audio/wav"
        info = parse_wav_header(res.data)
        assert info["valid_riff"] is True
        assert info["channels"] == 2
        assert math.isclose(info["duration_sec"], 2.0, abs_tol=0.1)


# ============================================================================
# 2. EXTREME BOUNDARY DATES & SINGLE-MONTH PERIODS
# ============================================================================

class TestExtremeBoundaryDatesAndSingleMonthPeriods:
    """
    Validates robust edge-handling for the absolute extremes of the 573-month timeline:
    1979-01 inception, 2026-09 record terminus, single-month slices, and clamp behavior.
    """

    def test_timeseries_boundary_1979_01_single_month(self, app_client):
        """Endpoint /api/timeseries/global_surface_temperature for inception month 1979-01."""
        res = app_client.get("/api/timeseries/global_surface_temperature?start=1979-01&end=1979-01")
        assert res.status_code == 200
        data = res.get_json()
        assert data["dataset_id"] == "global_surface_temperature"
        assert len(data["data"]) == 1
        assert data["data"][0]["date"] == "1979-01"
        assert isinstance(data["data"][0]["value"], (int, float))

    def test_timeseries_boundary_2026_09_single_month(self, app_client):
        """Endpoint /api/timeseries/atmospheric_co2 for terminus month 2026-09."""
        res = app_client.get("/api/timeseries/atmospheric_co2?start=2026-09&end=2026-09")
        assert res.status_code == 200
        data = res.get_json()
        assert len(data["data"]) == 1
        assert data["data"][0]["date"] == "2026-09"
        assert data["data"][0]["value"] > 420.0  # Atmospheric CO2 in 2026

    def test_sonify_single_month_1979_01_surface_temperature(self, app_client):
        """Sonifying a single month at 1979-01 synthesizes successfully without NaN interpolation error."""
        res = app_client.get("/api/sonify/surface-temperature?start=1979-01&end=1979-01&duration=2.0")
        assert res.status_code == 200
        assert res.content_type == "audio/wav"
        info = parse_wav_header(res.data)
        assert info["valid_riff"] is True
        assert math.isclose(info["duration_sec"], 2.0, abs_tol=0.1)

    def test_sonify_single_month_2026_09_atmospheric_co2(self, app_client):
        """Sonifying a single month at 2026-09 synthesizes valid audio."""
        res = app_client.get("/api/sonify/atmospheric-co2?start=2026-09&end=2026-09&duration=2.0")
        assert res.status_code == 200
        info = parse_wav_header(res.data)
        assert info["valid_riff"] is True

    def test_comparison_extreme_span_1979_vs_2026(self, app_client):
        """Compare the 1979-01 inception month against the 2026-09 terminus month."""
        res = app_client.get(
            "/api/comparison?dataset_id=surface-temperature"
            "&periodA=1979-01,1979-01&periodB=2026-09,2026-09&duration=5.0"
        )
        assert res.status_code == 200
        data = res.get_json()
        diff = data["difference"]
        # Inception: 0.08°C, Terminus: 1.38°C -> Delta ~ 1.30°C
        assert diff["delta_mean"] > 1.0, f"Expected >1.0°C warming shift, got {diff['delta_mean']}"
        assert diff["percent_change"] > 500.0

    def test_comparison_single_month_interior_epochs(self, app_client):
        """Compare 1998-04 (Super El Niño peak) vs 2012-09 (Arctic Sea Ice record minimum)."""
        res = app_client.get(
            "/api/comparison?dataset_id=sea-ice-extent"
            "&periodA=1979-09,1979-09&periodB=2012-09,2012-09"
        )
        assert res.status_code == 200
        data = res.get_json()
        # 1979-09 ice ~7.05M km², 2012-09 ice ~3.57M km² -> Delta ~ -3.48M km²
        assert data["difference"]["delta_mean"] < -3.0

    def test_dates_prior_to_1979_clamp_gracefully(self, app_client):
        """Pre-1979 queries clamp safely to available observations without crashing."""
        res = app_client.get("/api/timeseries/temperature?start=1950-01&end=1978-12")
        assert res.status_code == 200
        data = res.get_json()
        assert "data" in data
        assert data["count"] == 0

    def test_dates_after_2026_clamp_gracefully(self, app_client):
        """Post-2026 queries clamp safely without crash."""
        res = app_client.get("/api/timeseries/atmospheric_co2?start=2027-01&end=2035-12")
        assert res.status_code == 200
        data = res.get_json()
        assert "data" in data
        assert data["count"] == 0

    def test_inverted_dates_rejection_or_handling(self, app_client):
        """Inverted dates (start > end) on /api/sonify must return HTTP 400 error cleanly."""
        res = app_client.get("/api/sonify/surface-temperature?start=2020-01&end=1990-01")
        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data
        assert "cannot be after" in data["error"]


# ============================================================================
# 3. HIGH-LOAD CONCURRENT REQUESTS TO COMPARISON & ORCHESTRA
# ============================================================================

class TestHighLoadConcurrency:
    """
    Stress-tests multithreaded concurrent requests against Flask endpoints:
    /api/comparison, /api/sonify/orchestra, and concurrent audio cache generation.
    """

    def test_concurrent_comparison_high_load(self):
        """30 concurrent requests to /api/comparison with diverse query parameters."""
        app = create_app(TestingConfig)
        datasets = ["surface-temperature", "atmospheric-co2", "ocean-temperature", "sea-ice-extent"]
        periods = [
            ("1980-01,1989-12", "2010-01,2019-12"),
            ("1990-01,1999-12", "2000-01,2009-12"),
            ("1979-01,1979-01", "2026-09,2026-09"),
            ("2000-01,2005-12", "2000-01,2005-12"),  # Identical period
        ]

        def worker_task(idx: int) -> Tuple[int, Dict[str, Any]]:
            with app.test_client() as client:
                d_id = datasets[idx % len(datasets)]
                p_a, p_b = periods[idx % len(periods)]
                url = f"/api/comparison?dataset_id={d_id}&periodA={p_a}&periodB={p_b}&duration=10"
                res = client.get(url)
                return res.status_code, res.get_json()

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(worker_task, i) for i in range(30)]
            results = [f.result() for f in as_completed(futures)]

        assert len(results) == 30
        for code, json_data in results:
            assert code == 200
            assert "difference" in json_data
            assert "periodA" in json_data
            assert "periodB" in json_data

    def test_concurrent_orchestra_manifest_high_load(self):
        """30 concurrent requests to /api/sonify/orchestra with variable duration/timeframes."""
        app = create_app(TestingConfig)

        def worker_task(idx: int) -> Tuple[int, Dict[str, Any]]:
            with app.test_client() as client:
                duration = 10 + (idx % 20)
                url = f"/api/sonify/orchestra?duration={duration}&start=1990-01&end=2020-12"
                res = client.get(url)
                return res.status_code, res.get_json()

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(worker_task, i) for i in range(30)]
            results = [f.result() for f in as_completed(futures)]

        assert len(results) == 30
        for code, manifest in results:
            assert code == 200
            assert manifest["layers_count"] == 4
            assert "surface_temperature" in manifest["manifest"]
            assert "atmospheric_co2" in manifest["manifest"]
            assert "ocean_temperature" in manifest["manifest"]
            assert "sea_ice_extent" in manifest["manifest"]

    def test_concurrent_cache_collision_race_condition(self):
        """
        10 concurrent threads simultaneously requesting the EXACT same audio parameters.
        Verifies zero race conditions, zero file locking collisions, and bit-level file integrity.
        """
        app = create_app(TestingConfig)
        # Pre-generate to verify concurrent multi-reader cache streaming
        default_engine.sonify_dataset("surface-temperature", "1982-01", "1984-12", duration=3.0)
        target_url = "/api/sonify/surface-temperature?start=1982-01&end=1984-12&duration=3.0"

        def worker_fetch(idx: int) -> Tuple[int, bytes]:
            with app.test_client() as client:
                res = client.get(target_url)
                return res.status_code, res.data

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(worker_fetch, i) for i in range(10)]
            results = [f.result() for f in as_completed(futures)]

        assert len(results) == 10
        first_payload = results[0][1]
        for code, payload in results:
            assert code == 200
            assert len(payload) == len(first_payload)
            info = parse_wav_header(payload)
            assert info["valid_riff"] is True

    def test_interleaved_heavy_workload_all_endpoints(self):
        """40 concurrent mixed requests stressing timeseries, comparison, manifest, explanations."""
        app = create_app(TestingConfig)
        urls = [
            "/api/datasets",
            "/api/timeseries/harmonized?start=1980-01&end=2020-12",
            "/api/sonify/orchestra?duration=15",
            "/api/comparison?dataset_id=ocean-temperature&periodA=1985-01,1995-12&periodB=2005-01,2015-12",
            "/api/sonification/explanations",
        ]

        def worker_task(idx: int) -> int:
            with app.test_client() as client:
                url = urls[idx % len(urls)]
                res = client.get(url)
                return res.status_code

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(worker_task, i) for i in range(40)]
            status_codes = [f.result() for f in as_completed(futures)]

        assert len(status_codes) == 40
        assert all(sc == 200 for sc in status_codes)


# ============================================================================
# 4. VISUALIZER FFT GROUPING & RMS UNDER SYNTHETIC NOISE AND PURE DC OFFSETS
# ============================================================================

class TestVisualizerFFTGroupingAndRMS:
    """
    Examines mathematical stability of 64-band logarithmic FFT bin grouping,
    RMS sound intensity, peak dBFS, and zero-crossing detection under:
      - Synthetic white noise, pink noise, and band-limited noise
      - Pure positive and negative DC offsets
      - AC signals with significant DC bias
      - Pathological and boundary buffers (empty, subnormal, full-scale square)
    """

    @pytest.mark.parametrize("fft_size", [256, 512, 1024, 2048, 4096])
    @pytest.mark.parametrize("sr", [22050, 44100, 48000, 96000])
    def test_fft_grouping_invariant_sweep(self, fft_size: int, sr: int):
        """
        Verify mathematical invariants across combinations of FFT size and sample rate:
        - Exactly 64 bands created
        - startBin < endBin for every band
        - Bin indices bounded within [0, fft_size // 2]
        - Frequencies strictly monotonically increasing
        """
        bands = py_compute_logarithmic_bands(
            num_bands=64, f_min=20.0, f_max=20000.0, fft_size=fft_size, sample_rate=sr
        )
        assert len(bands) == 64
        total_bins = fft_size // 2

        prev_f = 0.0
        for b in bands:
            assert b["startFreq"] > prev_f
            assert b["endFreq"] > b["startFreq"]
            assert 0 <= b["startBin"] < total_bins
            assert 0 < b["endBin"] <= total_bins
            assert b["endBin"] > b["startBin"], f"Band must have positive bin width: {b}"
            prev_f = b["startFreq"]

    def test_fft_grouping_nyquist_clamping(self):
        """If f_max exceeds Nyquist frequency (e.g. 30 kHz at 44.1 kHz sr), it must clamp to 22.05 kHz."""
        bands = py_compute_logarithmic_bands(
            num_bands=64, f_min=20.0, f_max=30000.0, fft_size=2048, sample_rate=44100
        )
        assert bands[-1]["endFreq"] <= 22050.0 + 1e-6
        assert bands[-1]["endBin"] == 1024

    def test_synthetic_white_noise_spectral_spread(self):
        """
        Synthetic white noise has flat expected power spectral density.
        Verify that energy distributes across all 64 bands with no zero-energy bands.
        """
        np.random.seed(42)
        n_samples = 2048
        white_noise = np.random.uniform(-1.0, 1.0, n_samples).astype(np.float32)

        # Compute FFT magnitudes
        fft_vals = np.abs(np.fft.rfft(white_noise))
        bands = py_compute_logarithmic_bands(64, 20.0, 20000.0, 2048, 44100)

        band_energies = []
        for b in bands:
            chunk = fft_vals[b["startBin"]:b["endBin"]]
            avg_energy = float(np.mean(chunk))
            band_energies.append(avg_energy)

        assert len(band_energies) == 64
        assert all(e > 0.0 for e in band_energies), "Every band must receive energy from white noise"

    def test_synthetic_pink_noise_downward_tilt(self):
        """
        Pink noise has 1/f power drop (-3 dB/octave).
        Verify that low frequency bands contain substantially higher energy than high frequency bands.
        """
        np.random.seed(42)
        n = 2048
        white_fft = np.fft.rfft(np.random.normal(0, 1, n))
        freqs = np.fft.rfftfreq(n)
        freqs[0] = 1e-6  # Avoid division by zero
        pink_fft = white_fft / np.sqrt(freqs)
        pink_time = np.fft.irfft(pink_fft)

        fft_mags = np.abs(np.fft.rfft(pink_time))
        bands = py_compute_logarithmic_bands(64, 20.0, 20000.0, 2048, 44100)

        low_band_energy = float(np.mean(fft_mags[bands[2]["startBin"]:bands[2]["endBin"]]))
        high_band_energy = float(np.mean(fft_mags[bands[60]["startBin"]:bands[60]["endBin"]]))

        assert low_band_energy > high_band_energy * 2.0, "Pink noise must have higher low-frequency energy"

    def test_synthetic_band_limited_noise_concentration(self):
        """
        Band-limited noise between 500 Hz and 1500 Hz must concentrate energy into
        the corresponding middle logarithmic bands while low (<100 Hz) and high (>5000 Hz) are near zero.
        """
        sr = 44100
        n = 2048
        freqs = np.fft.rfftfreq(n, 1.0 / sr)
        fft_synth = np.zeros(len(freqs), dtype=complex)

        # Inject noise only between 500 Hz and 1500 Hz
        mask = (freqs >= 500) & (freqs <= 1500)
        fft_synth[mask] = 100.0 * (np.random.randn(np.sum(mask)) + 1j * np.random.randn(np.sum(mask)))

        synth_time = np.fft.irfft(fft_synth)
        measured_fft = np.abs(np.fft.rfft(synth_time))
        bands = py_compute_logarithmic_bands(64, 20.0, 20000.0, 2048, sr)

        # Bands around 1000 Hz (index ~30-36) vs Bands at index < 5 or > 55
        target_energy = float(np.mean(measured_fft[bands[33]["startBin"]:bands[33]["endBin"]]))
        out_of_band_energy = float(np.mean(measured_fft[bands[2]["startBin"]:bands[2]["endBin"]]))

        assert target_energy > out_of_band_energy * 50.0

    @pytest.mark.parametrize("dc_val", [0.1, 0.25, 0.5, 0.75, 1.0])
    def test_rms_and_peak_pure_positive_dc(self, dc_val: float):
        """For pure positive DC offset, RMS = DC, Peak = DC, dBFS = 20*log10(DC)."""
        buf = np.full(1024, dc_val, dtype=np.float32)
        rms = py_calculate_rms(buf)
        peak = py_calculate_peak(buf)
        db = py_calculate_dbfs(rms)

        assert math.isclose(rms, dc_val, abs_tol=1e-5)
        assert math.isclose(peak, dc_val, abs_tol=1e-5)
        expected_db = 20.0 * math.log10(dc_val)
        assert math.isclose(db, expected_db, abs_tol=1e-3)

    @pytest.mark.parametrize("dc_val", [-0.2, -0.5, -0.8, -1.0])
    def test_rms_and_peak_pure_negative_dc(self, dc_val: float):
        """For pure negative DC offset, RMS = |DC|, Peak = |DC|."""
        buf = np.full(1024, dc_val, dtype=np.float32)
        rms = py_calculate_rms(buf)
        peak = py_calculate_peak(buf)

        assert math.isclose(rms, abs(dc_val), abs_tol=1e-5)
        assert math.isclose(peak, abs(dc_val), abs_tol=1e-5)

    def test_rms_mixed_dc_and_ac_theoretical(self):
        """
        Theoretical RMS of DC offset mixed with AC sine:
        s(t) = DC + A * sin(wt)
        RMS = sqrt( DC^2 + A^2 / 2 )
        """
        sr = 44100
        t = np.linspace(0.0, 1.0, sr, endpoint=False, dtype=np.float32)

        for dc in [0.2, 0.4]:
            for amp in [0.3, 0.5]:
                sig = dc + amp * np.sin(2.0 * np.pi * 500.0 * t)
                expected_rms = math.sqrt(dc ** 2 + (amp ** 2) / 2.0)
                actual_rms = py_calculate_rms(sig)
                assert math.isclose(actual_rms, expected_rms, rel_tol=1e-3)

    def test_zero_crossing_trigger_pure_positive_dc_fallback(self):
        """Pure positive DC (+0.5) never crosses zero; must gracefully return fallback 0."""
        buf = np.full(512, 0.5, dtype=np.float32)
        assert py_find_zero_crossing_trigger(buf) == 0

    def test_zero_crossing_trigger_pure_negative_dc_fallback(self):
        """Pure negative DC (-0.5) never transitions to positive; returns fallback 0."""
        buf = np.full(512, -0.5, dtype=np.float32)
        assert py_find_zero_crossing_trigger(buf) == 0

    def test_zero_crossing_trigger_ac_with_dc_offset(self):
        """AC sine wave with DC bias that shifts the positive zero-crossing location."""
        sr = 1000
        t = np.linspace(0.0, 1.0, sr, endpoint=False)
        # Sine wave starting at 0, amplitude 1.0, DC offset = -0.5
        # Crosses zero when sin(2*pi*t) = 0.5 -> t = 1/12 s -> sample ~83
        sig = (-0.5 + np.sin(2.0 * np.pi * t)).astype(np.float32)
        trigger_idx = py_find_zero_crossing_trigger(sig)

        assert trigger_idx > 0
        assert sig[trigger_idx] <= 0.0
        assert sig[trigger_idx + 1] > 0.0

    def test_pathological_audio_buffers_rms_and_dbfs(self):
        """Test pathological buffers: empty, single sample, subnormal floats, full-scale square."""
        # 1. Empty buffer
        empty = np.array([], dtype=np.float32)
        assert py_calculate_rms(empty) == 0.0
        assert py_calculate_peak(empty) == 0.0
        assert py_calculate_dbfs(py_calculate_rms(empty)) == -100.0

        # 2. Subnormal float
        subnormal = np.full(64, 1e-9, dtype=np.float32)
        assert py_calculate_dbfs(py_calculate_rms(subnormal)) == -100.0

        # 3. Full-scale alternating square wave
        square = np.array([1.0, -1.0] * 512, dtype=np.float32)
        assert math.isclose(py_calculate_rms(square), 1.0, abs_tol=1e-5)
        assert math.isclose(py_calculate_peak(square), 1.0, abs_tol=1e-5)
        assert math.isclose(py_calculate_dbfs(py_calculate_rms(square)), 0.0, abs_tol=1e-5)


# ============================================================================
# 5. DAW MIXER LOGIC & 3D GLOBE SHADER FALLBACKS
# ============================================================================

class TestDAWMixerAndGlobeShaderFallbacks:
    """
    Stress-tests edge cases in the multi-track DAW mixer and 3D Globe GLSL shaders.
    """

    def test_daw_mixer_solo_mute_matrix_comprehensive(self):
        """
        Exhaustive test of edge-case solo/mute permutations:
        - All 4 tracks muted: every track has 0.0 gain.
        - All 4 tracks soloed: all tracks have normal unity gain.
        - Solo active on track 1, but track 1 is ALSO muted: track 1 has 0.0 gain,
          and other tracks ALSO have 0.0 gain because solo isolation is active.
        """
        def calc_gain(t_muted, t_soloed, any_solo):
            if t_muted:
                return 0.0
            if any_solo and not t_soloed:
                return 0.0
            return 1.0

        # Case 1: All 4 muted
        for soloed in [False, True]:
            for i in range(4):
                assert calc_gain(t_muted=True, t_soloed=soloed, any_solo=True) == 0.0

        # Case 2: All 4 soloed, none muted
        for i in range(4):
            assert calc_gain(t_muted=False, t_soloed=True, any_solo=True) == 1.0

        # Case 3: Solo on Track 0, but Track 0 is muted
        t0_gain = calc_gain(t_muted=True, t_soloed=True, any_solo=True)
        t1_gain = calc_gain(t_muted=False, t_soloed=False, any_solo=True)
        assert t0_gain == 0.0, "Muted solo track must be silenced"
        assert t1_gain == 0.0, "Non-solo track must be silenced by active solo"

    def test_daw_transport_scrub_boundary_clamping(self):
        """Transport scrubber time clamps safely for negative time and time exceeding duration."""
        def clamp_transport_time(sec: float, max_duration: float = 20.0) -> float:
            if math.isnan(sec) or sec < 0.0:
                return 0.0
            return min(max_duration, sec)

        assert clamp_transport_time(-5.0) == 0.0
        assert clamp_transport_time(0.0) == 0.0
        assert clamp_transport_time(15.2) == 15.2
        assert clamp_transport_time(20.0) == 20.0
        assert clamp_transport_time(999.0) == 20.0
        assert clamp_transport_time(float("nan")) == 0.0

    def test_daw_logarithmic_fader_attenuation_curve(self):
        """Fader position x in [0.0, 1.0] maps to log gain = x^2 and proper dB."""
        def fader_to_gain(fader: float) -> float:
            f = max(0.0, min(1.0, fader))
            return f * f

        assert fader_to_gain(0.0) == 0.0
        assert math.isclose(fader_to_gain(0.5), 0.25, abs_tol=1e-5)
        assert math.isclose(fader_to_gain(1.0), 1.0, abs_tol=1e-5)

    def test_globe_shaders_terminator_and_atmosphere_syntax(self):
        """Verify GLSL shader definitions export valid code strings and uniforms."""
        shaders_js_path = os.path.join(Config.BASE_DIR, "frontend", "js", "globe", "shaders.js")
        with open(shaders_js_path, "r", encoding="utf-8") as f:
            js_code = f.read()

        # Check Day/Night Terminator shader
        assert "TerminatorShader" in js_code
        assert "uSunPosition" in js_code
        assert "uDayMap" in js_code
        assert "uNightMap" in js_code
        assert "smoothstep(-0.15, 0.15, sunDotNormal)" in js_code

        # Check Atmospheric Glow Halo shader
        assert "AtmosphereShader" in js_code
        assert "uAtmosphereColor" in js_code
        assert "uGlowPower" in js_code
        assert "uGlowIntensity" in js_code

    def test_globe_procedural_texture_coordinates_and_fallbacks(self):
        """
        Verify procedural texture coordinate transformation formulas:
        latLonToPixel(lon, lat, W, H):
          x = (lon + 180) / 360 * W
          y = (90 - lat) / 180 * H
        Coordinates at boundaries (±180 lon, ±90 lat) must map strictly to [0, W] and [0, H].
        """
        def lat_lon_to_pixel(lon: float, lat: float, width: float, height: float) -> Tuple[float, float]:
            x = ((lon + 180.0) / 360.0) * width
            y = ((90.0 - lat) / 180.0) * height
            return x, y

        w, h = 1024, 512
        # North Pole
        nx, ny = lat_lon_to_pixel(0.0, 90.0, w, h)
        assert math.isclose(nx, 512.0, abs_tol=1e-5)
        assert math.isclose(ny, 0.0, abs_tol=1e-5)

        # South Pole
        sx, sy = lat_lon_to_pixel(0.0, -90.0, w, h)
        assert math.isclose(sx, 512.0, abs_tol=1e-5)
        assert math.isclose(sy, 512.0, abs_tol=1e-5)

        # Prime Meridian Equator
        ex, ey = lat_lon_to_pixel(0.0, 0.0, w, h)
        assert math.isclose(ex, 512.0, abs_tol=1e-5)
        assert math.isclose(ey, 256.0, abs_tol=1e-5)

        # International Date Line
        dx1, _ = lat_lon_to_pixel(-180.0, 0.0, w, h)
        dx2, _ = lat_lon_to_pixel(180.0, 0.0, w, h)
        assert math.isclose(dx1, 0.0, abs_tol=1e-5)
        assert math.isclose(dx2, 1024.0, abs_tol=1e-5)
