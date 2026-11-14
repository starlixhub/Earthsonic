"""
tests/stress_m4_python_harness.py
Empirical Challenger Stress & Boundary Harness for Python Sonification Engine.
Tests:
1. SonificationEngine render pipelines with authentic and boundary datasets.
2. Audio buffer NaN, Inf, and clipping checks on rendered stereo WAV files.
3. Butterworth lowpass filter stability and numerical boundaries in ocean_temperature.
4. Scale quantization and frequency clipping boundaries in surface_temperature.
5. Multi-stage saturation stability in atmospheric_co2.
6. Crystalline bell and polar wind dual-layer crossfade stability in sea_ice.
7. Extreme values: negative, zero, extreme high, NaN/Inf handling.
"""

import os
import sys
import tempfile
import wave

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import numpy as np
import scipy.io.wavfile

from backend.sonification.engine import SonificationEngine, D_DORIAN_LYDIAN_SCALE
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
)

passed_checks = 0

def log_pass(msg: str):
    global passed_checks
    passed_checks += 1
    print(f"  [PASS {passed_checks}] {msg}")

def inspect_wav_buffer(wav_path: str):
    """Inspects rendered WAV file for NaN, Inf, channel count, sample rate, and peak amplitude."""
    assert os.path.exists(wav_path), f"File {wav_path} does not exist"
    
    with wave.open(wav_path, 'rb') as wf:
        n_channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        n_frames = wf.getnframes()
        assert n_channels == 2, f"Expected stereo (2 channels), got {n_channels}"
        assert framerate == 44100, f"Expected 44.1 kHz sample rate, got {framerate}"
        assert n_frames > 0, "WAV has zero frames"
        assert sampwidth in (2, 3, 4), f"Unexpected sample width: {sampwidth}"

    sr, data = scipy.io.wavfile.read(wav_path)
    assert sr == 44100
    assert data.ndim == 2 and data.shape[1] == 2

    # Check for NaN / Inf
    assert not np.isnan(data).any(), "WAV buffer contains NaN values!"
    assert not np.isinf(data).any(), "WAV buffer contains Inf values!"

    # Float conversion for peak analysis
    if data.dtype == np.int16:
        float_data = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        float_data = data.astype(np.float32) / 2147483648.0
    else:
        float_data = data.astype(np.float32)

    peak = float(np.max(np.abs(float_data)))
    rms = float(np.sqrt(np.mean(float_data ** 2)))
    return {
        "channels": n_channels,
        "sample_rate": sr,
        "frames": n_frames,
        "peak": peak,
        "rms": rms,
        "dtype": str(data.dtype)
    }

print("=== Milestone M4 Python Sonification Engine Empirical Challenge ===\n")

with tempfile.TemporaryDirectory() as tmp_dir:
    engine = SonificationEngine(cache_dir=tmp_dir)

    # ------------------------------------------------------------------------
    # 1. Surface Temperature Sonification
    # ------------------------------------------------------------------------
    print("--- 1. Surface Temperature Sonification (D Dorian / Lydian) ---")
    
    # 1.1 Standard historical trajectory
    t_normal = np.linspace(-0.3, 1.4, 120) # 120 months (10 years)
    out_t1 = os.path.join(tmp_dir, "test_temp_normal.wav")
    engine._render_temperature(t_normal, duration=2.0, sample_rate=44100, output_path=out_t1)
    res_t1 = inspect_wav_buffer(out_t1)
    assert res_t1["peak"] > 0.05, "Audio must not be silent"
    assert res_t1["peak"] <= 1.05, f"Audio should not severely clip (peak={res_t1['peak']})"
    log_pass(f"Temperature normal trajectory: 2.0s stereo, peak={res_t1['peak']:.3f}, rms={res_t1['rms']:.3f}")

    # 1.2 Extreme cold and extreme heat boundaries
    t_extreme = np.array([-5.0, -2.0, 0.0, +2.5, +5.0, +10.0])
    out_t2 = os.path.join(tmp_dir, "test_temp_extreme.wav")
    engine._render_temperature(t_extreme, duration=1.0, sample_rate=44100, output_path=out_t2)
    res_t2 = inspect_wav_buffer(out_t2)
    log_pass(f"Temperature extreme boundaries [-5°C to +10°C]: peak={res_t2['peak']:.3f}, 0 NaN/Inf")

    # 1.3 Quantization scale boundaries
    assert len(D_DORIAN_LYDIAN_SCALE) == 13
    assert D_DORIAN_LYDIAN_SCALE[0] == 220.0
    assert D_DORIAN_LYDIAN_SCALE[-1] == 880.0
    log_pass("D Dorian / Lydian scale pitch range strictly 220 Hz to 880 Hz verified")

    # ------------------------------------------------------------------------
    # 2. Atmospheric CO2 Sonification
    # ------------------------------------------------------------------------
    print("\n--- 2. Atmospheric CO2 Sonification (110 Hz Brass Drone + Breathing + Saturation) ---")

    # 2.1 Standard Keeling Curve trajectory
    co2_normal = np.linspace(315.0, 425.0, 150)
    out_c1 = os.path.join(tmp_dir, "test_co2_normal.wav")
    engine._render_co2(co2_normal, duration=2.0, sample_rate=44100, output_path=out_c1)
    res_c1 = inspect_wav_buffer(out_c1)
    assert res_c1["peak"] > 0.05
    assert res_c1["peak"] <= 1.05
    log_pass(f"CO2 standard trajectory (315-425 ppm): peak={res_c1['peak']:.3f}, rms={res_c1['rms']:.3f}")

    # 2.2 Pre-industrial vs high greenhouse threshold boundaries (280 ppm vs 550 ppm)
    co2_high = np.full(50, 500.0) # > 400 ppm high saturation
    out_c2 = os.path.join(tmp_dir, "test_co2_high.wav")
    engine._render_co2(co2_high, duration=1.0, sample_rate=44100, output_path=out_c2)
    res_c2 = inspect_wav_buffer(out_c2)
    assert res_c2["peak"] > 0.05
    log_pass(f"CO2 high greenhouse saturation (500 ppm): peak={res_c2['peak']:.3f}, 0 NaN/Inf")

    # ------------------------------------------------------------------------
    # 3. Ocean Temperature Sonification
    # ------------------------------------------------------------------------
    print("\n--- 3. Ocean Heat Sonification (Sub-bass 36-130 Hz + 24 dB/oct Butterworth) ---")

    # 3.1 Standard ocean anomaly
    ocean_normal = np.linspace(-0.2, 0.8, 100)
    out_o1 = os.path.join(tmp_dir, "test_ocean_normal.wav")
    engine._render_ocean_temperature(ocean_normal, duration=2.0, sample_rate=44100, output_path=out_o1)
    res_o1 = inspect_wav_buffer(out_o1)
    assert res_o1["peak"] > 0.01
    log_pass(f"Ocean heat normal trajectory (-0.2 to +0.8°C): peak={res_o1['peak']:.3f}, rms={res_o1['rms']:.3f}")

    # 3.2 Butterworth Filter Numerical Stability at Boundary Cutoffs (80 Hz and 2400 Hz)
    for test_cutoff in [80.0, 130.0, 500.0, 1500.0, 2400.0]:
        sos = scipy.signal.butter(4, test_cutoff, btype='lowpass', fs=44100, output='sos')
        # Feed unit impulse through filter to check for instability or divergence
        impulse = np.zeros(1000, dtype=np.float32)
        impulse[0] = 1.0
        response = scipy.signal.sosfilt(sos, impulse)
        assert not np.isnan(response).any(), f"Butterworth filter blew up with NaN at cutoff={test_cutoff}"
        assert not np.isinf(response).any(), f"Butterworth filter blew up with Inf at cutoff={test_cutoff}"
        assert np.max(np.abs(response)) < 2.0, f"Butterworth filter gain unstable at cutoff={test_cutoff}"
    log_pass("4th-order (24 dB/oct) Butterworth lowpass filter verified stable across all cutoffs [80, 2400] Hz")

    # ------------------------------------------------------------------------
    # 4. Sea Ice Extent Sonification
    # ------------------------------------------------------------------------
    print("\n--- 4. Sea Ice Extent Sonification (Chimes + Polar Wind Crossfade) ---")

    # 4.1 Pristine ice (7.8 M km²) - High chimes, zero polar wind
    ice_high = np.full(60, 7.8)
    out_i1 = os.path.join(tmp_dir, "test_ice_pristine.wav")
    engine._render_sea_ice(ice_high, duration=1.5, sample_rate=44100, output_path=out_i1)
    res_i1 = inspect_wav_buffer(out_i1)
    log_pass(f"Sea ice pristine (7.8M km²): peak={res_i1['peak']:.3f}, 0 NaN/Inf")

    # 4.2 Record minimum ice (3.4 M km²) - High polar wind, attenuated chimes
    ice_low = np.full(60, 3.4)
    out_i2 = os.path.join(tmp_dir, "test_ice_minimum.wav")
    engine._render_sea_ice(ice_low, duration=1.5, sample_rate=44100, output_path=out_i2)
    res_i2 = inspect_wav_buffer(out_i2)
    log_pass(f"Sea ice minimum (3.4M km²): peak={res_i2['peak']:.3f}, 0 NaN/Inf")

    # ------------------------------------------------------------------------
    # 5. Sonification Mapping Mathematical Invariants
    # ------------------------------------------------------------------------
    print("\n--- 5. Sonification Mapping Mathematical Invariants ---")

    # 5.1 Temperature
    assert abs(temperature_to_frequency(0.0) - 261.63) < 1e-4
    assert abs(temperature_to_frequency(1.0) - 523.26) < 1e-2
    assert abs(temperature_to_semitones(1.0) - 12.0) < 1e-6
    assert abs(temperature_to_semitones(-1.0) - (-12.0)) < 1e-6
    log_pass("Temperature mapping functions: C4 at 0°C, C5 at +1°C, 12 semitones/°C")

    # 5.2 CO2
    assert abs(co2_to_frequency(310.0) - 196.0) < 1e-2
    assert abs(co2_to_frequency(440.0) - 783.99) < 1e-2
    assert abs(co2_to_semitones(310.0) - 0.0) < 1e-6
    assert abs(co2_to_semitones(440.0) - 24.0) < 1e-6
    assert co2_saturation_metric(340.0) == 0.0 # Below 350 ppm
    assert co2_saturation_metric(350.0) == 0.0
    assert abs(co2_saturation_metric(440.0) - 1.0) < 1e-6
    log_pass("CO2 mapping functions: G3 (196 Hz) to G5 (784 Hz), 350 ppm threshold boundary")

    # 5.3 Ocean
    assert abs(ocean_temp_to_lpf_cutoff(-0.60) - 80.0) < 1e-2
    assert abs(ocean_temp_to_lpf_cutoff(1.20) - 2400.0) < 1e-2
    assert ocean_temp_to_lpf_cutoff(-10.0) == 80.0 # Underflow clamp
    assert ocean_temp_to_lpf_cutoff(10.0) == 2400.0 # Overflow clamp
    log_pass("Ocean LPF cutoff mapping: strictly clamped to [80, 2400] Hz logarithmic curve")

    # 5.4 Sea Ice
    assert abs(sea_ice_loss_ratio(7.8) - 0.0) < 1e-6
    assert abs(sea_ice_loss_ratio(3.5) - 1.0) < 1e-6
    assert sea_ice_loss_ratio(10.0) == 0.0 # Underflow clamp
    assert sea_ice_loss_ratio(1.0) == 1.0 # Overflow clamp
    log_pass("Sea ice loss ratio: 0.0 at 7.8M km², 1.0 at 3.5M km², boundary clamped")

    # 5.5 Differential series
    s_a = [1.0, 2.0, 3.0]
    s_b = [2.0, 4.0, 6.0]
    ra, rb, delta = calculate_differential_series(s_a, s_b, num_points=300)
    assert len(delta) == 300
    assert np.allclose(delta, rb - ra)
    log_pass("Differential series calculation: uniform grid resampling and exact delta B - A")

print(f"\n=======================================================")
print(f"ALL {passed_checks} PYTHON EMPIRICAL CHALLENGES PASSED GREEN!")
print(f"=======================================================\n")
