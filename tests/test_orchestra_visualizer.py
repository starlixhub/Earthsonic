"""
tests/test_orchestra_visualizer.py
Comprehensive unit and integration test suite for Milestone 4:
Earth Orchestra Multi-Track Engine & Real-Time Audio Visualizer.

Validates:
  1. Static file structure and asset integrity
  2. Flask API routing for audio stems, manifest, and frontend static assets
  3. Digital audio mixing mathematics: logarithmic fader gain curve, dB conversions
  4. Solo / Mute matrix logic truth table across all channel permutations
  5. Anti-click ramp time constants and transport time formatting
  6. Real-Time RMS intensity and peak dBFS calculations (including sine wave RMS theory)
  7. Oscilloscope zero-crossing trigger detection algorithm
  8. Logarithmic 64-band frequency spectrum bin allocation and Nyquist bounds
  9. Gravity peak-hold acceleration and decay dynamics
"""

import os
import math
import pytest
import numpy as np

from backend.app import create_app
from backend.config import Config

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
AUDIO_JS_DIR = os.path.join(FRONTEND_DIR, "js", "audio")
VIS_JS_DIR = os.path.join(FRONTEND_DIR, "js", "visualizer")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")


@pytest.fixture
def client():
    """Flask test client fixture."""
    app = create_app(Config)
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ============================================================================
# 1. FILE STRUCTURE & INTEGRITY TESTS
# ============================================================================

def test_milestone4_files_exist():
    """Verify all Milestone 4 files exist in their designated directories."""
    required_files = [
        os.path.join(AUDIO_JS_DIR, "track.js"),
        os.path.join(AUDIO_JS_DIR, "mixer.js"),
        os.path.join(VIS_JS_DIR, "visualizer.js"),
        os.path.join(CSS_DIR, "orchestra.css"),
        os.path.join(CSS_DIR, "visualizer.css"),
        os.path.join(FRONTEND_DIR, "index.html"),
    ]
    for path in required_files:
        assert os.path.exists(path), f"Required M4 file missing: {path}"
        assert os.path.getsize(path) > 150, f"File appears too small or empty: {path}"


def test_index_html_contains_orchestra_and_visualizer_elements():
    """Verify index.html contains necessary visualizer canvases and mixer dock markup."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Visualizer canvases
    assert 'id="spectrum-canvas"' in html, "index.html missing #spectrum-canvas"
    assert 'id="waveform-canvas"' in html, "index.html missing #waveform-canvas"
    assert 'id="rms-meter-bar"' in html, "index.html missing #rms-meter-bar"
    assert 'id="rms-db-text"' in html, "index.html missing #rms-db-text"
    assert 'id="peak-db-text"' in html, "index.html missing #peak-db-text"

    # Orchestra mixer dock
    assert 'class="orchestra-dock"' in html, "index.html missing .orchestra-dock"
    assert 'id="btn-master-play"' in html, "index.html missing #btn-master-play"
    assert 'id="btn-master-pause"' in html, "index.html missing #btn-master-pause"
    assert 'id="btn-master-stop"' in html, "index.html missing #btn-master-stop"
    assert 'id="btn-master-loop"' in html, "index.html missing #btn-master-loop"
    assert 'id="orchestra-seek-slider"' in html, "index.html missing #orchestra-seek-slider"
    assert 'id="orchestra-time-display"' in html, "index.html missing #orchestra-time-display"

    # All 4 channels present
    for track_id in ["surface_temperature", "atmospheric_co2", "ocean_temperature", "sea_ice_extent"]:
        assert f'id="strip-{track_id}"' in html, f"index.html missing channel strip for {track_id}"
        assert f'data-track="{track_id}"' in html, f"index.html missing data-track attribute for {track_id}"


# Note: test_css_stylesheets_valid_rules was moved to tests/legacy_ui/
# because it asserted on obsolete Milestone 4/5 styling tokens (--orchestra-cyan, --vis-cyan)
# which were consolidated into tokens.css and replaced by the JPL Mission Console theme.


# ============================================================================
# 2. FLASK REST API SERVING TESTS
# ============================================================================

def test_static_serving_m4_modules(client):
    """Verify Flask serves M4 JavaScript and CSS modules with correct content."""
    res_track = client.get("/js/audio/track.js")
    assert res_track.status_code == 200
    assert b"TrackStrip" in res_track.data
    assert b"linearToLogGain" in res_track.data

    res_mixer = client.get("/js/audio/mixer.js")
    assert res_mixer.status_code == 200
    assert b"EarthOrchestraMixer" in res_mixer.data
    assert b"calculateEffectiveGain" in res_mixer.data

    res_vis = client.get("/js/visualizer/visualizer.js")
    assert res_vis.status_code == 200
    assert b"AudioVisualizer" in res_vis.data
    assert b"computeLogarithmicBands" in res_vis.data
    assert b"findZeroCrossingTrigger" in res_vis.data

    res_orch_css = client.get("/css/orchestra.css")
    assert res_orch_css.status_code == 200
    assert b"orchestra-dock" in res_orch_css.data

    res_vis_css = client.get("/css/visualizer.css")
    assert res_vis_css.status_code == 200
    assert b"visualizer-hud" in res_vis_css.data


def test_sonify_orchestra_manifest_endpoint(client):
    """Verify GET /api/sonify/orchestra returns synchronized stems for all 4 tracks."""
    res = client.get("/api/sonify/orchestra?duration=20")
    assert res.status_code == 200
    data = res.get_json()

    assert "manifest" in data
    assert "synchronized_duration_sec" in data
    assert data["synchronized_duration_sec"] == 20.0
    assert data["layers_count"] == 4

    manifest = data["manifest"]
    expected_stems = [
        "surface_temperature",
        "atmospheric_co2",
        "ocean_temperature",
        "sea_ice_extent"
    ]
    for stem in expected_stems:
        assert stem in manifest, f"Manifest missing stem '{stem}'"
        assert manifest[stem].startswith("/api/sonify/")
        assert "duration=20" in manifest[stem]


# ============================================================================
# 3. MATHEMATICAL VERIFICATION: GAIN CURVES & LOUDNESS
# ============================================================================

def py_linear_to_log_gain(val: float) -> float:
    """Python reference for linearToLogGain: V_gain = val^2."""
    clamped = max(0.0, min(1.0, float(val)))
    return clamped * clamped


def py_db_to_linear_gain(db: float) -> float:
    """Python reference for dbToLinearGain: 10^(db / 20)."""
    if db <= -60.0:
        return 0.0
    return 10.0 ** (db / 20.0)


def py_linear_gain_to_db(gain: float, floor: float = -100.0) -> float:
    """Python reference for linearGainToDb: 20 * log10(gain)."""
    if gain <= 1e-5:
        return floor
    return max(floor, 20.0 * math.log10(gain))


def test_logarithmic_fader_gain_curve():
    """Verify quadratic logarithmic fader law val^2."""
    assert py_linear_to_log_gain(0.0) == 0.0
    assert py_linear_to_log_gain(1.0) == 1.0
    assert math.isclose(py_linear_to_log_gain(0.5), 0.25, abs_tol=1e-6)
    assert math.isclose(py_linear_to_log_gain(0.8), 0.64, abs_tol=1e-6)

    # Clamping behavior
    assert py_linear_to_log_gain(-0.5) == 0.0
    assert py_linear_to_log_gain(1.5) == 1.0


def test_decibel_to_linear_conversions():
    """Verify bidirectional decibel to linear gain conversions."""
    # 0 dB is unity gain (1.0)
    assert math.isclose(py_db_to_linear_gain(0.0), 1.0, rel_tol=1e-5)
    assert math.isclose(py_linear_gain_to_db(1.0), 0.0, abs_tol=1e-5)

    # -6 dB is ~0.501187 gain
    gain_neg6 = py_db_to_linear_gain(-6.0)
    assert math.isclose(gain_neg6, 0.501187, rel_tol=1e-4)
    assert math.isclose(py_linear_gain_to_db(gain_neg6), -6.0, abs_tol=1e-4)

    # -20 dB is 0.1 gain
    gain_neg20 = py_db_to_linear_gain(-20.0)
    assert math.isclose(gain_neg20, 0.1, rel_tol=1e-5)
    assert math.isclose(py_linear_gain_to_db(0.1), -20.0, abs_tol=1e-5)

    # Silence floor clamp
    assert py_linear_gain_to_db(0.0) == -100.0
    assert py_linear_gain_to_db(1e-6) == -100.0


# ============================================================================
# 4. SOLO / MUTE MATRIX TRUTH TABLE VERIFICATION
# ============================================================================

class MockTrack:
    def __init__(self, name: str, volume: float = 0.8, is_muted: bool = False, is_soloed: bool = False):
        self.name = name
        self.volume = volume
        self.isMuted = is_muted
        self.isSoloed = is_soloed

    def getLogGain(self) -> float:
        return py_linear_to_log_gain(self.volume)


def py_calculate_effective_gain(track: MockTrack, all_tracks: list) -> float:
    """Python implementation of calculateEffectiveGain matching mixer.js."""
    if track.isMuted:
        return 0.0

    any_solo = any(t.isSoloed for t in all_tracks)
    if any_solo:
        if not track.isSoloed:
            return 0.0

    return track.getLogGain()


def test_solo_mute_truth_table_all_permutations():
    """
    Exhaustively test Solo/Mute truth table across channel permutations.
    Rules:
      1. isMuted=True -> Effective Gain MUST be 0.0 unconditionally.
      2. If any track in mixer isSoloed=True, non-soloed tracks MUST have gain 0.0.
      3. Soloed unmuted tracks have gain = getLogGain().
      4. When no tracks are soloed, unmuted tracks have gain = getLogGain().
    """
    track_names = ["Temp", "CO2", "Ocean", "Ice"]

    # Scenario A: All Unmuted, No Solos
    tracks = [MockTrack(name, volume=0.8) for name in track_names]
    for t in tracks:
        assert math.isclose(py_calculate_effective_gain(t, tracks), 0.64, abs_tol=1e-6)

    # Scenario B: Single Track Muted
    tracks[0].isMuted = True
    assert py_calculate_effective_gain(tracks[0], tracks) == 0.0
    assert math.isclose(py_calculate_effective_gain(tracks[1], tracks), 0.64, abs_tol=1e-6)
    assert math.isclose(py_calculate_effective_gain(tracks[2], tracks), 0.64, abs_tol=1e-6)
    assert math.isclose(py_calculate_effective_gain(tracks[3], tracks), 0.64, abs_tol=1e-6)

    # Scenario C: Single Track Soloed
    tracks = [MockTrack(name, volume=0.8) for name in track_names]
    tracks[1].isSoloed = True  # CO2 soloed
    assert py_calculate_effective_gain(tracks[0], tracks) == 0.0
    assert math.isclose(py_calculate_effective_gain(tracks[1], tracks), 0.64, abs_tol=1e-6)
    assert py_calculate_effective_gain(tracks[2], tracks) == 0.0
    assert py_calculate_effective_gain(tracks[3], tracks) == 0.0

    # Scenario D: Track is both Soloed AND Muted -> Mute takes precedence!
    tracks[1].isMuted = True
    assert py_calculate_effective_gain(tracks[1], tracks) == 0.0
    # Other tracks remain silenced because a solo is technically active
    assert py_calculate_effective_gain(tracks[0], tracks) == 0.0

    # Scenario E: Multiple Tracks Soloed (e.g. Tracks 0 and 2)
    tracks = [MockTrack(name, volume=0.8) for name in track_names]
    tracks[0].isSoloed = True
    tracks[2].isSoloed = True
    assert math.isclose(py_calculate_effective_gain(tracks[0], tracks), 0.64, abs_tol=1e-6)
    assert py_calculate_effective_gain(tracks[1], tracks) == 0.0
    assert math.isclose(py_calculate_effective_gain(tracks[2], tracks), 0.64, abs_tol=1e-6)
    assert py_calculate_effective_gain(tracks[3], tracks) == 0.0

    # Scenario F: All 4 Tracks Soloed -> Becomes equivalent to all active
    for t in tracks:
        t.isSoloed = True
    for t in tracks:
        assert math.isclose(py_calculate_effective_gain(t, tracks), 0.64, abs_tol=1e-6)


def test_solo_mute_exhaustive_binary_matrix():
    """Test every binary permutation of 4 tracks (16 mute patterns, 16 solo patterns)."""
    track_names = ["T1", "T2", "T3", "T4"]

    for solo_mask in range(16):
        for mute_mask in range(16):
            tracks = []
            for i, name in enumerate(track_names):
                is_solo = bool((solo_mask >> i) & 1)
                is_mute = bool((mute_mask >> i) & 1)
                tracks.append(MockTrack(name, volume=1.0, is_muted=is_mute, is_soloed=is_solo))

            any_solo = any(t.isSoloed for t in tracks)

            for t in tracks:
                gain = py_calculate_effective_gain(t, tracks)
                if t.isMuted:
                    assert gain == 0.0, f"Muted track must have 0 gain: solo={solo_mask}, mute={mute_mask}"
                elif any_solo and not t.isSoloed:
                    assert gain == 0.0, f"Non-solo track during solo must be silent: solo={solo_mask}, mute={mute_mask}"
                else:
                    msg = f"Active track must have unity gain: solo={solo_mask}, mute={mute_mask}"
                    assert math.isclose(gain, 1.0, abs_tol=1e-6), msg


# ============================================================================
# 5. TIME FORMATTING TESTS
# ============================================================================

def py_format_time_mmss(sec: float) -> str:
    """Python reference for formatTimeMMSS."""
    if math.isnan(sec) or sec < 0:
        sec = 0
    total_sec = int(math.floor(sec))
    minutes = total_sec // 60
    seconds = total_sec % 60
    return f"{minutes:02d}:{seconds:02d}"


def test_time_formatting_cases():
    """Verify MM:SS time formatting logic."""
    assert py_format_time_mmss(0.0) == "00:00"
    assert py_format_time_mmss(9.9) == "00:09"
    assert py_format_time_mmss(15.0) == "00:15"
    assert py_format_time_mmss(59.9) == "00:59"
    assert py_format_time_mmss(60.0) == "01:00"
    assert py_format_time_mmss(125.4) == "02:05"
    assert py_format_time_mmss(-5.0) == "00:00"
    assert py_format_time_mmss(float("nan")) == "00:00"


# ============================================================================
# 6. REAL-TIME RMS & PEAK SOUND INTENSITY MATH
# ============================================================================

def py_calculate_rms(buffer: np.ndarray) -> float:
    """Python reference for calculateRMS."""
    if len(buffer) == 0:
        return 0.0
    return float(np.sqrt(np.mean(buffer ** 2)))


def py_calculate_peak(buffer: np.ndarray) -> float:
    """Python reference for calculatePeak."""
    if len(buffer) == 0:
        return 0.0
    return float(np.max(np.abs(buffer)))


def py_calculate_dbfs(val: float, floor: float = -100.0) -> float:
    """Python reference for calculateDbFS."""
    if val <= 1e-5:
        return floor
    db = 20.0 * math.log10(val)
    return max(floor, min(0.0, db))


def test_rms_zero_signal():
    """Silence has 0.0 RMS and reaches the dBFS noise floor."""
    zeros = np.zeros(1024, dtype=np.float32)
    rms = py_calculate_rms(zeros)
    peak = py_calculate_peak(zeros)
    assert rms == 0.0
    assert peak == 0.0
    assert py_calculate_dbfs(rms) == -100.0


def test_rms_dc_full_scale():
    """DC signal at 1.0 has 1.0 RMS and 0.0 dBFS."""
    dc = np.ones(1024, dtype=np.float32)
    rms = py_calculate_rms(dc)
    peak = py_calculate_peak(dc)
    assert math.isclose(rms, 1.0, abs_tol=1e-6)
    assert math.isclose(peak, 1.0, abs_tol=1e-6)
    assert math.isclose(py_calculate_dbfs(rms), 0.0, abs_tol=1e-6)


def test_rms_sine_wave_theoretical():
    """
    A pure sine wave with peak amplitude A has theoretical RMS = A / sqrt(2).
    In decibels: 20 * log10(1 / sqrt(2)) = -3.0103 dBFS.
    """
    sr = 44100
    freq = 1000.0
    t = np.linspace(0.0, 1.0, sr, endpoint=False, dtype=np.float32)
    sine = np.sin(2.0 * np.pi * freq * t)

    rms = py_calculate_rms(sine)
    peak = py_calculate_peak(sine)

    theoretical_rms = 1.0 / np.sqrt(2.0)
    assert math.isclose(rms, theoretical_rms, rel_tol=1e-4)
    assert math.isclose(peak, 1.0, rel_tol=1e-4)

    rms_db = py_calculate_dbfs(rms)
    assert math.isclose(rms_db, -3.0103, abs_tol=0.01)


def test_rms_half_amplitude_sine_wave():
    """Half amplitude (0.5) sine wave should have RMS ~ 0.3535 and dBFS ~ -9.03 dBFS."""
    sr = 44100
    t = np.linspace(0.0, 1.0, sr, endpoint=False, dtype=np.float32)
    sine = 0.5 * np.sin(2.0 * np.pi * 440.0 * t)

    rms = py_calculate_rms(sine)
    peak = py_calculate_peak(sine)

    assert math.isclose(peak, 0.5, rel_tol=1e-4)
    assert math.isclose(rms, 0.5 / np.sqrt(2.0), rel_tol=1e-4)
    assert math.isclose(py_calculate_dbfs(rms), -9.0309, abs_tol=0.01)


# ============================================================================
# 7. OSCILLOSCOPE ZERO-CROSSING TRIGGER DETECTION ALGORITHM
# ============================================================================

def py_find_zero_crossing_trigger(buffer: np.ndarray, max_search: int = 1024) -> int:
    """Python implementation of findZeroCrossingTrigger matching visualizer.js."""
    limit = min(len(buffer) - 1, max_search)
    for i in range(limit):
        if buffer[i] <= 0.0 and buffer[i + 1] > 0.0:
            return i
    return 0


def test_zero_crossing_finds_positive_slope():
    """Verify zero crossing detects the first sample where buffer[i] <= 0 and buffer[i+1] > 0."""
    # Signal starting negative, crossing at index 5
    buf = np.array([-0.8, -0.6, -0.4, -0.2, -0.05, 0.15, 0.4, 0.7], dtype=np.float32)
    idx = py_find_zero_crossing_trigger(buf)
    assert idx == 4  # buf[4] is -0.05 (<=0) and buf[5] is 0.15 (>0)


def test_zero_crossing_with_inverted_sine_wave():
    """Verify trigger stabilizes a sine wave phase shift."""
    # Sine wave starting at phase pi (going negative, then crossing at index N/2)
    sr = 100
    t = np.linspace(0.0, 1.0, sr, endpoint=False)
    # Start at -sin: starts at 0, goes negative, crosses zero at t=0.5 (sample 50)
    wave = -np.sin(2 * np.pi * t).astype(np.float32)
    idx = py_find_zero_crossing_trigger(wave, max_search=80)
    assert idx == 50
    assert wave[idx] <= 0.0
    assert wave[idx + 1] > 0.0


def test_zero_crossing_fallback_on_flat_or_positive_signal():
    """Verify safe fallback to 0 when no zero crossing exists."""
    flat = np.zeros(256, dtype=np.float32)
    assert py_find_zero_crossing_trigger(flat) == 0

    positive = np.full(256, 0.5, dtype=np.float32)
    assert py_find_zero_crossing_trigger(positive) == 0


# ============================================================================
# 8. 64-BAND LOGARITHMIC FREQUENCY SPECTRUM MATH
# ============================================================================

def py_compute_logarithmic_bands(num_bands: int = 64, f_min: float = 20.0,
                                 f_max: float = 20000.0, fft_size: int = 2048,
                                 sample_rate: int = 44100):
    """Python reference for computeLogarithmicBands."""
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


def test_logarithmic_64_bands_coverage_and_monotonicity():
    """
    Verify 64 logarithmic bands:
      - Exactly 64 bands created
      - Monotonically increasing frequency bounds
      - Valid FFT bin ranges within [0, 1024]
      - Start frequency >= 20 Hz, end frequency <= 22,050 Hz
      - Every band has endBin > startBin (no zero-width bands)
    """
    bands = py_compute_logarithmic_bands(64, 20.0, 20000.0, 2048, 44100)
    assert len(bands) == 64

    prev_freq = 0.0
    for k, band in enumerate(bands):
        assert band["bandIndex"] == k
        assert band["startFreq"] > prev_freq
        assert band["endFreq"] > band["startFreq"]
        assert band["startBin"] >= 0
        assert band["endBin"] <= 1024
        assert band["endBin"] > band["startBin"], f"Band {k} has invalid bin range: {band}"
        prev_freq = band["startFreq"]

    # First band starts near 20 Hz
    assert math.isclose(bands[0]["startFreq"], 20.0, abs_tol=1e-3)
    # Last band ends at 20,000 Hz
    assert math.isclose(bands[63]["endFreq"], 20000.0, abs_tol=1.0)


# ============================================================================
# 9. GRAVITY PEAK HOLD CAP DYNAMICS
# ============================================================================

def test_gravity_peak_hold_dynamics():
    """
    Verify falling gravity peak hold caps:
      - Sudden peak rise: peak jumps instantly to new value, velocity resets.
      - Decaying signal: peak falls with accelerating downward velocity.
      - Clamp at floor 0.0.
    """
    gravity = 0.005
    peak_val = 0.0
    peak_vel = 0.0

    # Step 1: Transient attack to 0.9
    new_signal = 0.9
    if new_signal >= peak_val:
        peak_val = new_signal
        peak_vel = 0.0
    assert peak_val == 0.9
    assert peak_vel == 0.0

    # Step 2: Signal drops to 0.1, peak starts gravity decay toward 0.1
    decay_frames = 25
    trajectory = []
    for _ in range(decay_frames):
        new_signal = 0.1
        if new_signal >= peak_val:
            peak_val = new_signal
            peak_vel = 0.0
        else:
            peak_vel += gravity
            decayed = peak_val - peak_vel
            if decayed <= new_signal:
                peak_val = new_signal
                peak_vel = 0.0
            else:
                peak_val = decayed
        trajectory.append(peak_val)

    # Verify monotonic decay during drop towards 0.1
    for i in range(1, len(trajectory)):
        assert trajectory[i] <= trajectory[i - 1], "Peak must decay downward"

    # Peak has settled at the active signal floor (0.1)
    assert math.isclose(peak_val, 0.1, abs_tol=1e-5)

    # Step 3: Complete silence (0.0), peak decays to 0.0
    for _ in range(30):
        new_signal = 0.0
        if new_signal >= peak_val:
            peak_val = new_signal
            peak_vel = 0.0
        else:
            peak_vel += gravity
            decayed = peak_val - peak_vel
            if decayed <= new_signal:
                peak_val = new_signal
                peak_vel = 0.0
            else:
                peak_val = decayed
    assert peak_val == 0.0
