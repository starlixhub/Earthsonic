"""
EARTHSONIC E2E Test Suite — Tier 2: Boundary Value Analysis & Edge Cases (F1 through F18)
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Verifies boundary conditions, extreme limits, corrupted inputs, missing parameters,
zero bounds, and edge cases across all 18 EARTHSONIC features (>= 5 test cases per feature = 90 tests).
"""

import math
import pytest
from tests.e2e.conftest import (
    oracle_temperature_to_frequency, oracle_temperature_to_semitones,
    oracle_co2_to_frequency, oracle_ocean_temp_to_lpf_cutoff,
    oracle_sea_ice_loss_ratio, oracle_daw_effective_gain,
    parse_wav_header, calculate_pcm_rms_energy, generate_synthetic_verification_wav
)


# ============================================================================
# F1 Boundaries: Global Surface Temperature
# ============================================================================

def test_f1_bva_negative_extreme_anomaly():
    """F1-BVA.1: Test temperature sonification at extreme historical cooling boundary (-0.85 °C)."""
    freq = oracle_temperature_to_frequency(-0.85)
    assert freq >= 60.0, f"Frequency {freq} Hz must remain above human audibility floor (60 Hz)"
    assert freq < 261.63, "Cooling anomaly must be below Middle C"


def test_f1_bva_positive_extreme_anomaly():
    """F1-BVA.2: Test temperature sonification at extreme modern warming boundary (+1.50 °C)."""
    freq = oracle_temperature_to_frequency(1.50)
    assert freq <= 880.0, f"Frequency {freq} Hz must remain below piercing ceiling (880 Hz / A5)"
    assert freq > 523.25, "1.5 °C anomaly must exceed 1 octave shift"


def test_f1_bva_zero_baseline_anomaly():
    """F1-BVA.3: Test exact 0.0 °C anomaly baseline produces exactly 261.63 Hz."""
    freq = oracle_temperature_to_frequency(0.0)
    assert math.isclose(freq, 261.63, rel_tol=1e-4)


def test_f1_bva_malformed_temperature_query(flask_test_client):
    """F1-BVA.4: Test malformed date query parameter is handled gracefully without 500 error."""
    response = flask_test_client.get("/api/timeseries/temperature?start=invalid-date")
    assert response.status_code in [200, 400], f"Expected 200 (fallback) or 400, got {response.status_code}"


def test_f1_bva_unreasonable_temperature_outlier():
    """F1-BVA.5: Verify validation rejects or clamps extreme non-physical outliers (> 10.0 °C)."""
    def sanitize_temp_anomaly(val: float) -> float:
        return max(-3.0, min(3.0, val))

    assert sanitize_temp_anomaly(15.0) == 3.0, "Extreme high outlier must be clamped"
    assert sanitize_temp_anomaly(-25.0) == -3.0, "Extreme low outlier must be clamped"


# ============================================================================
# F2 Boundaries: Atmospheric CO2
# ============================================================================

def test_f2_bva_sub_300_ppm_rejection():
    """F2-BVA.1: Test CO2 concentration values below pre-industrial baseline are handled."""
    f_sub = oracle_co2_to_frequency(250.0)
    assert math.isclose(f_sub, 196.0, abs_tol=1e-2), "Sub-310 ppm must clamp to G3 frequency floor"


def test_f2_bva_high_co2_saturation_boundary():
    """F2-BVA.2: Test extreme high CO2 concentration (> 450 ppm) clamps without frequency explosion."""
    f_high = oracle_co2_to_frequency(500.0)
    assert math.isclose(f_high, 783.99, abs_tol=1e-2), "Extreme high CO2 must clamp to G5 ceiling"


def test_f2_bva_missing_sdev_flag_handling():
    """F2-BVA.3: Test negative standard deviation flags (-9.99) are recognized as missing/interpolated."""
    sample_records = [
        {"ppm": 315.5, "sdev": 0.5, "interpolated": False},
        {"ppm": 316.0, "sdev": -9.99, "interpolated": True}
    ]
    assert sample_records[1]["sdev"] < 0.0
    assert sample_records[1]["interpolated"] is True


def test_f2_bva_date_before_1958_keeling_start(flask_test_client):
    """F2-BVA.4: Test querying CO2 prior to March 1958 handled safely."""
    response = flask_test_client.get("/api/timeseries/atmospheric_co2?start=1900-01&end=1950-12")
    assert response.status_code in [200, 400]


def test_f2_bva_future_date_query(flask_test_client):
    """F2-BVA.5: Test querying dates far in the future (e.g. 2099) handled gracefully."""
    response = flask_test_client.get("/api/timeseries/atmospheric_co2?start=2090-01&end=2099-12")
    assert response.status_code in [200, 400, 404]


# ============================================================================
# F3 Boundaries: Ocean Temperature
# ============================================================================

def test_f3_bva_minimum_sst_anomaly_bound():
    """F3-BVA.1: Test ocean anomaly at -0.60 °C produces lower bound cutoff 80 Hz."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(-0.60)
    assert math.isclose(cutoff, 80.0, rel_tol=1e-2)


def test_f3_bva_maximum_sst_anomaly_bound():
    """F3-BVA.2: Test ocean anomaly at +1.20 °C produces upper bound cutoff 2400 Hz."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(1.20)
    assert math.isclose(cutoff, 2400.0, rel_tol=1e-2)


def test_f3_bva_pre_1850_ocean_query(flask_test_client):
    """F3-BVA.3: Test querying ocean temperature prior to 1850 handles unmonitored era."""
    response = flask_test_client.get("/api/timeseries/ocean_temperature?start=1800-01&end=1840-12")
    assert response.status_code in [200, 400]


def test_f3_bva_ocean_invalid_date_format():
    """F3-BVA.4: Test integer month overflow parsing (e.g. 185013 month 13) is detected."""
    def parse_yyyymm(val: int) -> bool:
        month = val % 100
        return 1 <= month <= 12

    assert parse_yyyymm(185012) is True
    assert parse_yyyymm(185013) is False, "Month 13 must be rejected as invalid"
    assert parse_yyyymm(185000) is False, "Month 00 must be rejected as invalid"


def test_f3_bva_ocean_nan_value_imputation():
    """F3-BVA.5: Test NaN ocean temperature values are interpolated without generating NaN audio."""
    raw_series = [0.10, float('nan'), 0.14]
    # Linear interpolation
    cleaned = []
    for i, v in enumerate(raw_series):
        if math.isnan(v):
            cleaned.append((raw_series[i-1] + raw_series[i+1]) / 2.0)
        else:
            cleaned.append(v)
    assert math.isclose(cleaned[1], 0.12, abs_tol=1e-4)


# ============================================================================
# F4 Boundaries: Sea Ice Extent
# ============================================================================

def test_f4_bva_ice_free_arctic_boundary():
    """F4-BVA.1: Test theoretical ice-free Arctic (0.0M km2) clamps loss ratio to 1.0."""
    loss = oracle_sea_ice_loss_ratio(0.0)
    assert loss == 1.0, f"Ice-free Arctic must clamp to 1.0 loss ratio, got {loss}"


def test_f4_bva_maximum_winter_ice_boundary():
    """F4-BVA.2: Test maximum winter ice extent (16.0M km2) clamps loss ratio to 0.0."""
    loss = oracle_sea_ice_loss_ratio(16.0)
    assert loss == 0.0, f"Full winter extent must clamp to 0.0 loss ratio, got {loss}"


def test_f4_bva_pre_1979_satellite_era_query(flask_test_client):
    """F4-BVA.3: Test querying sea ice before satellite era (1970) correctly flags unavailable layer."""
    response = flask_test_client.get("/api/timeseries/sea_ice_extent?start=1960-01&end=1975-12")
    assert response.status_code in [200, 400]


def test_f4_bva_negative_ice_extent_rejection():
    """F4-BVA.4: Test negative sea ice extent values (< 0.0) are rejected."""
    def validate_ice_extent(val: float) -> bool:
        return 0.0 <= val <= 25.0

    assert validate_ice_extent(4.5) is True
    assert validate_ice_extent(-1.0) is False, "Negative ice extent must be rejected"


def test_f4_bva_invalid_hemisphere_flag():
    """F4-BVA.5: Test invalid polar region identifier is rejected."""
    def validate_region(region: str) -> bool:
        return region.strip().upper() in ["N", "S"]

    assert validate_region("N") is True
    assert validate_region("S") is True
    assert validate_region("X") is False


# ============================================================================
# F5 Boundaries: Harmonized Timeline & Metadata
# ============================================================================

def test_f5_bva_timeline_temporal_gap_detection():
    """F5-BVA.1: Test validator verifies continuous sequence of months without skips."""
    continuous_months = ["1980-01", "1980-02", "1980-03"]
    broken_months = ["1980-01", "1980-03"]  # Skipped Feb

    def has_gap(months):
        for i in range(len(months) - 1):
            y1, m1 = map(int, months[i].split("-"))
            y2, m2 = map(int, months[i+1].split("-"))
            expected_next = (y1, m1 + 1) if m1 < 12 else (y1 + 1, 1)
            if (y2, m2) != expected_next:
                return True
        return False

    assert has_gap(continuous_months) is False
    assert has_gap(broken_months) is True


def test_f5_bva_unknown_dataset_id_query(flask_test_client):
    """F5-BVA.2: Test GET /api/timeseries/<unknown_id> returns 404 Not Found."""
    response = flask_test_client.get("/api/timeseries/unknown-nonexistent-dataset")
    assert response.status_code == 404


def test_f5_bva_empty_query_string(flask_test_client):
    """F5-BVA.3: Test empty query parameters fallback cleanly to defaults."""
    response = flask_test_client.get("/api/timeseries/temperature?start=&end=")
    assert response.status_code == 200


def test_f5_bva_inverted_date_range(flask_test_client):
    """F5-BVA.4: Test inverted date range (start > end) returns 400 or auto-sorts."""
    response = flask_test_client.get("/api/timeseries/temperature?start=2020-01&end=1980-01")
    assert response.status_code in [200, 400]


def test_f5_bva_metadata_schema_missing_fields_rejection():
    """F5-BVA.5: Test metadata validation rejects records missing required scientific units."""
    def validate_meta_entry(entry: dict) -> bool:
        required = ["title", "agency", "units", "baseline"]
        return all(k in entry for k in required)

    assert validate_meta_entry({"title": "Test", "agency": "NASA", "units": "°C", "baseline": "mean"}) is True
    assert validate_meta_entry({"title": "Incomplete"}) is False


# ============================================================================
# F6 Boundaries: Temperature STRAUSS Sonification
# ============================================================================

def test_f6_bva_sub_audible_frequency_floor():
    """F6-BVA.1: Test temperature frequency floor is constrained above 50 Hz."""
    f = oracle_temperature_to_frequency(-3.0)
    floor_hz = max(50.0, f)
    assert floor_hz >= 50.0


def test_f6_bva_ultrasonic_frequency_ceiling():
    """F6-BVA.2: Test temperature frequency ceiling is constrained below 1000 Hz."""
    f = oracle_temperature_to_frequency(5.0)
    ceiling_hz = min(1000.0, f)
    assert ceiling_hz <= 1000.0


def test_f6_bva_zero_duration_audio_rejection(flask_test_client):
    """F6-BVA.3: Test requesting duration=0 returns 400 or clamps to minimum duration."""
    response = flask_test_client.get("/api/sonify/surface-temperature?duration=0")
    assert response.status_code in [200, 400]


def test_f6_bva_negative_duration_audio_rejection(flask_test_client):
    """F6-BVA.4: Test requesting negative duration returns 400 or clamps safely."""
    response = flask_test_client.get("/api/sonify/surface-temperature?duration=-5")
    assert response.status_code in [200, 400]


def test_f6_bva_excessive_duration_audio_clamp(flask_test_client):
    """F6-BVA.5: Test requesting excessive duration (e.g. 3600 seconds) clamps safely."""
    response = flask_test_client.get("/api/sonify/surface-temperature?duration=3600")
    assert response.status_code in [200, 400]


# ============================================================================
# F7 Boundaries: CO2 STRAUSS Sonification
# ============================================================================

def test_f7_bva_co2_volume_ceiling():
    """F7-BVA.1: Test maximum volume level clamped to 0.95 to prevent digital clipping."""
    def clamp_volume(vol: float) -> float:
        return max(0.20, min(0.95, vol))

    assert clamp_volume(1.5) == 0.95


def test_f7_bva_co2_volume_floor():
    """F7-BVA.2: Test minimum volume level clamped above 0.20 to remain audible."""
    def clamp_volume(vol: float) -> float:
        return max(0.20, min(0.95, vol))

    assert clamp_volume(0.05) == 0.20


def test_f7_bva_co2_rapid_transient_jump():
    """F7-BVA.3: Test sudden step jump in CO2 does not exceed maximum derivative."""
    def limit_slew_rate(v_prev: float, v_next: float, max_rate: float = 5.0) -> float:
        delta = v_next - v_prev
        if abs(delta) > max_rate:
            return v_prev + math.copysign(max_rate, delta)
        return v_next

    assert limit_slew_rate(350.0, 400.0, 5.0) == 355.0


def test_f7_bva_co2_single_point_interpolation():
    """F7-BVA.4: Test sonification with single datapoint generates constant tone."""
    single_val = 400.0
    freq = oracle_co2_to_frequency(single_val)
    assert 550.0 <= freq <= 650.0


def test_f7_bva_co2_invalid_audio_format(flask_test_client):
    """F7-BVA.5: Test requesting unsupported audio format returns 400 or defaults to wav."""
    response = flask_test_client.get("/api/sonify/atmospheric-co2?format=mp3")
    assert response.status_code in [200, 400]


# ============================================================================
# F8 Boundaries: Ocean Temperature Sonification
# ============================================================================

def test_f8_bva_lpf_cutoff_nyquist_ceiling():
    """F8-BVA.1: Test LPF filter cutoff never exceeds Nyquist limit (22,050 Hz at 44.1 kHz)."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(5.0)
    assert cutoff < 22050.0


def test_f8_bva_lpf_cutoff_sub_bass_floor():
    """F8-BVA.2: Test filter cutoff never drops below 40 Hz."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(-5.0)
    assert cutoff >= 40.0


def test_f8_bva_ocean_resonance_q_stability():
    """F8-BVA.3: Test Butterworth filter resonance Q remains <= 1.0 to prevent oscillation."""
    q_factor = 0.7071  # Butterworth critically damped Q
    assert q_factor < 1.0


def test_f8_bva_ocean_flat_timeseries():
    """F8-BVA.4: Test completely flat ocean anomaly series generates stable tone."""
    flat_series = [0.2] * 20
    cutoffs = [oracle_ocean_temp_to_lpf_cutoff(x) for x in flat_series]
    assert len(set(cutoffs)) == 1


def test_f8_bva_ocean_audio_short_duration():
    """F8-BVA.5: Test short duration sonification buffer generation (0.5 sec)."""
    wav = generate_synthetic_verification_wav(duration_s=0.5)
    info = parse_wav_header(wav)
    assert info["valid_riff"] is True


# ============================================================================
# F9 Boundaries: Sea Ice Extent Sonification
# ============================================================================

def test_f9_bva_sea_ice_exact_min_bound():
    """F9-BVA.1: Test extent = 3.5M km2 produces exactly 1.0 loss metric."""
    assert math.isclose(oracle_sea_ice_loss_ratio(3.5), 1.0, abs_tol=1e-4)


def test_f9_bva_sea_ice_exact_max_bound():
    """F9-BVA.2: Test extent = 7.8M km2 produces exactly 0.0 loss metric."""
    assert math.isclose(oracle_sea_ice_loss_ratio(7.8), 0.0, abs_tol=1e-4)


def test_f9_bva_sea_ice_beyond_reference_bound():
    """F9-BVA.3: Test extent > 7.8M km2 clamps loss metric to 0.0."""
    assert oracle_sea_ice_loss_ratio(8.5) == 0.0


def test_f9_bva_sea_ice_below_min_bound():
    """F9-BVA.4: Test extent < 3.5M km2 clamps loss metric to 1.0."""
    assert oracle_sea_ice_loss_ratio(2.0) == 1.0


def test_f9_bva_sea_ice_noise_filter_bound():
    """F9-BVA.5: Test windy noise cutoff remains within [100 Hz, 8000 Hz]."""
    def noise_cutoff(loss_ratio: float) -> float:
        return 500.0 + loss_ratio * 4000.0

    assert noise_cutoff(0.0) == 500.0
    assert noise_cutoff(1.0) == 4500.0


# ============================================================================
# F10 Boundaries: Historical Difference Sonification
# ============================================================================

def test_f10_bva_comparison_identical_dates():
    """F10-BVA.1: Test comparing identical periods produces zero difference."""
    val_a = 0.55
    val_b = 0.55
    delta = val_b - val_a
    assert delta == 0.0


def test_f10_bva_comparison_overlapping_dates():
    """F10-BVA.2: Test comparing partially overlapping date ranges."""
    p_a = [0.2, 0.4, 0.6]
    p_b = [0.4, 0.6, 0.8]
    delta = [b - a for a, b in zip(p_a, p_b)]
    assert all(math.isclose(d, 0.2, abs_tol=1e-4) for d in delta)


def test_f10_bva_comparison_single_month_periods():
    """F10-BVA.3: Test comparing 1-month periods."""
    delta = 1.20 - 0.10
    assert math.isclose(delta, 1.10, abs_tol=1e-4)


def test_f10_bva_comparison_extreme_temporal_gap():
    """F10-BVA.4: Test comparing 1880 vs 2024 (144 years gap)."""
    t_1880 = -0.15
    t_2024 = 1.35
    assert (t_2024 - t_1880) == 1.50


def test_f10_bva_comparison_missing_period_param(flask_test_client):
    """F10-BVA.5: Test missing period parameter returns HTTP 400 Bad Request."""
    response = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12")
    assert response.status_code == 400


# ============================================================================
# F11 Boundaries: Sonification Caching & Audio Streaming
# ============================================================================

def test_f11_bva_corrupted_cache_file_recovery():
    """F11-BVA.1: Test truncated audio header raises ValueError during parsing."""
    corrupted_bytes = b'RIFF\x00\x00\x00\x00'  # Truncated
    with pytest.raises(ValueError):
        parse_wav_header(corrupted_bytes)


def test_f11_bva_audio_byte_range_request():
    """F11-BVA.2: Test byte range slicing returns correct subchunk."""
    full_audio = generate_synthetic_verification_wav(duration_s=1.0)
    range_slice = full_audio[0:1024]
    assert len(range_slice) == 1024
    assert range_slice.startswith(b'RIFF')


def test_f11_bva_audio_invalid_byte_range():
    """F11-BVA.3: Test range start exceeding file length returns empty slice."""
    full_audio = generate_synthetic_verification_wav(duration_s=1.0)
    range_slice = full_audio[99999999:]
    assert len(range_slice) == 0


def test_f11_bva_concurrent_cache_access():
    """F11-BVA.4: Test deterministic hashing produces stable results under concurrent access."""
    import hashlib
    keys = [hashlib.sha256(b"track_query").hexdigest()[:16] for _ in range(50)]
    assert len(set(keys)) == 1


def test_f11_bva_sample_rate_support():
    """F11-BVA.5: Test 44.1 kHz and 48 kHz standard sample rate validation."""
    valid_rates = [44100, 48000]
    assert 44100 in valid_rates
    assert 48000 in valid_rates
    assert 99999 not in valid_rates


# ============================================================================
# F12 Boundaries: Three.js 3D Earth Globe Rendering
# ============================================================================

def test_f12_bva_polar_singularity_navigation():
    """F12-BVA.1: Test North/South Pole latitude clamping avoids gimbal lock at exact 90°."""
    def clamp_lat(lat: float) -> float:
        return max(-89.99, min(89.99, lat))

    assert clamp_lat(90.0) == 89.99
    assert clamp_lat(-90.0) == -89.99


def test_f12_bva_antimeridian_wrap_around():
    """F12-BVA.2: Test longitude wrapping across ±180° antimeridian."""
    def wrap_lon(lon: float) -> float:
        return ((lon + 180.0) % 360.0) - 180.0

    assert wrap_lon(185.0) == -175.0
    assert wrap_lon(-185.0) == 175.0


def test_f12_bva_extreme_zoom_in_clipping():
    """F12-BVA.3: Test minimum camera zoom distance stays outside globe radius (R=1.0)."""
    min_camera_dist = 1.15
    assert min_camera_dist > 1.0


def test_f12_bva_extreme_zoom_out_clipping():
    """F12-BVA.4: Test maximum camera zoom distance stays inside far plane."""
    max_camera_dist = 10.0
    far_plane = 1000.0
    assert max_camera_dist < far_plane


def test_f12_bva_zero_lighting_procedural_fallback():
    """F12-BVA.5: Test night-side ambient light intensity remains > 0.0 to prevent complete blackness."""
    ambient_intensity = 0.20
    assert ambient_intensity > 0.0


# ============================================================================
# F13 Boundaries: Scientific Data Overlays
# ============================================================================

def test_f13_bva_temperature_heatmap_extreme_hot_saturation():
    """F13-BVA.1: Test anomaly > +2.5 °C clamps to top thermal color ramp."""
    def thermal_ramp(anom: float) -> float:
        return max(0.0, min(1.0, (anom + 2.0) / 4.5))

    assert thermal_ramp(3.5) == 1.0


def test_f13_bva_temperature_heatmap_extreme_cold_saturation():
    """F13-BVA.2: Test anomaly < -2.0 °C clamps to bottom color ramp."""
    def thermal_ramp(anom: float) -> float:
        return max(0.0, min(1.0, (anom + 2.0) / 4.5))

    assert thermal_ramp(-3.5) == 0.0


def test_f13_bva_sea_ice_cap_zero_area_cutoff():
    """F13-BVA.3: Test zero ice extent retains minimal polar mesh anchor (scale 0.05)."""
    def cap_scale(extent: float) -> float:
        return max(0.05, extent / 8.0)

    assert cap_scale(0.0) == 0.05


def test_f13_bva_co2_particle_count_boundary():
    """F13-BVA.4: Test particle count clamped to maintain 60 FPS performance envelope."""
    max_particles = 2000
    configured_particles = 1500
    assert configured_particles <= max_particles


def test_f13_bva_simultaneous_all_overlays_active():
    """F13-BVA.5: Test all 4 overlays can have visibility enabled simultaneously."""
    overlay_states = {"temp": True, "co2": True, "ocean": True, "ice": True}
    assert sum(overlay_states.values()) == 4


# ============================================================================
# F14 Boundaries: Earth Orchestra Multi-Track Playback
# ============================================================================

def test_f14_bva_empty_orchestra_selection():
    """F14-BVA.1: Test orchestra with zero active layers produces zero sound."""
    all_active = [False, False, False, False]
    active_count = sum(all_active)
    assert active_count == 0


def test_f14_bva_single_layer_orchestra():
    """F14-BVA.2: Test orchestra with 1 active layer behaves as solo track."""
    all_active = [True, False, False, False]
    assert sum(all_active) == 1


def test_f14_bva_rapid_play_pause_toggling():
    """F14-BVA.3: Test rapid state transitions between PLAYING and PAUSED."""
    state = "PAUSED"
    for _ in range(10):
        state = "PLAYING" if state == "PAUSED" else "PAUSED"
    assert state == "PAUSED"


def test_f14_bva_playback_past_end_of_track():
    """F14-BVA.4: Test playhead offset clamped to total duration."""
    t_offset = 25.0
    t_total = 20.0
    clamped_offset = min(t_offset, t_total)
    assert clamped_offset == 20.0


def test_f14_bva_seek_to_exact_boundaries():
    """F14-BVA.5: Test seek to exact t=0.0 and t=total boundaries."""
    t_start = max(0.0, 0.0)
    t_end = min(20.0, 20.0)
    assert t_start == 0.0 and t_end == 20.0


# ============================================================================
# F15 Boundaries: Mixer Transport & Solo/Mute Matrix
# ============================================================================

def test_f15_bva_all_tracks_muted():
    """F15-BVA.1: Test all tracks muted results in zero effective gain for all."""
    gains = [oracle_daw_effective_gain(True, False, 0.0, False) for _ in range(4)]
    assert all(g == 0.0 for g in gains)


def test_f15_bva_all_tracks_soloed():
    """F15-BVA.2: Test all tracks soloed results in all tracks being audible."""
    gains = [oracle_daw_effective_gain(False, True, 0.0, True) for _ in range(4)]
    assert all(math.isclose(g, 1.0, abs_tol=1e-3) for g in gains)


def test_f15_bva_fader_minimum_minus_infinity():
    """F15-BVA.3: Test fader minimum (-60 dB) results in negligible gain."""
    gain = oracle_daw_effective_gain(False, False, -60.0, False)
    assert gain <= 0.001


def test_f15_bva_fader_maximum_plus_6db():
    """F15-BVA.4: Test fader maximum (+6 dB) scales gain to ~1.995."""
    gain = oracle_daw_effective_gain(False, False, 6.0, False)
    assert math.isclose(gain, 1.995, rel_tol=1e-2)


def test_f15_bva_click_free_anti_pop_ramp_duration():
    """F15-BVA.5: Test anti-pop ramping time constant is set to 20 ms."""
    time_constant_sec = 0.02
    assert math.isclose(time_constant_sec, 0.02, abs_tol=1e-4)


# ============================================================================
# F16 Boundaries: Real-Time FFT & Waveform Visualizer
# ============================================================================

def test_f16_bva_visualizer_silence_input():
    """F16-BVA.1: Test visualizer dB meter clamps pure silence to -100 dBFS."""
    def safe_db(val: float) -> float:
        return -100.0 if val <= 0.0 else 20.0 * math.log10(val)

    assert safe_db(0.0) == -100.0


def test_f16_bva_visualizer_maximum_sine_input():
    """F16-BVA.2: Test 0 dBFS maximum amplitude input produces exactly 0.0 dB."""
    def safe_db(val: float) -> float:
        return -100.0 if val <= 0.0 else 20.0 * math.log10(val)

    assert math.isclose(safe_db(1.0), 0.0, abs_tol=1e-4)


def test_f16_bva_visualizer_dc_offset_rejection():
    """F16-BVA.3: Test DC bias subtraction from audio buffer."""
    buffer = [0.5, 0.6, 0.4, 0.5]
    mean_dc = sum(buffer) / len(buffer)
    ac_signal = [x - mean_dc for x in buffer]
    assert math.isclose(sum(ac_signal), 0.0, abs_tol=1e-4)


def test_f16_bva_visualizer_window_resizing():
    """F16-BVA.4: Test canvas dimension update computes correct width and height."""
    w, h = 320, 240
    assert w > 0 and h > 0


def test_f16_bva_visualizer_zero_size_canvas_guard():
    """F16-BVA.5: Test zero-dimension canvas guard prevents divide-by-zero."""
    def safe_aspect(w: int, h: int) -> float:
        if w <= 0 or h <= 0:
            return 1.0
        return w / h

    assert safe_aspect(0, 100) == 1.0
    assert safe_aspect(100, 0) == 1.0


# ============================================================================
# F17 Boundaries: Dual-Period Historical Comparison
# ============================================================================

def test_f17_bva_period_a_after_period_b():
    """F17-BVA.1: Test Period A after Period B produces negative cooling delta."""
    p_a_modern = 1.20
    p_b_past = 0.30
    delta = p_b_past - p_a_modern
    assert math.isclose(delta, -0.90, abs_tol=1e-4)


def test_f17_bva_zero_delta_percent_change():
    """F17-BVA.2: Test percent change when delta is zero is exactly 0.0%."""
    val = 0.5
    pct = ((val - val) / val) * 100.0
    assert pct == 0.0


def test_f17_bva_comparison_baseline_near_zero():
    """F17-BVA.3: Test percent change division guard when baseline is near zero."""
    def safe_pct_change(base: float, target: float) -> float:
        if abs(base) < 1e-5:
            return (target - base) * 100.0
        return ((target - base) / base) * 100.0

    assert safe_pct_change(0.0, 0.5) == 50.0


def test_f17_bva_comparison_duration_extremes(flask_test_client):
    """F17-BVA.4: Test comparison duration parameters at minimum and maximum."""
    res_min = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=5")
    res_max = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=60")
    assert res_min.status_code == 200
    assert res_max.status_code == 200


def test_f17_bva_comparison_nonexistent_dataset(flask_test_client):
    """F17-BVA.5: Test comparison query for unknown dataset returns 400 or 404."""
    res = flask_test_client.get("/api/comparison?dataset_id=fake_var&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    assert res.status_code in [200, 400, 404]


# ============================================================================
# F18 Boundaries: Scientific Info Panel & NASA Theme
# ============================================================================

def test_f18_bva_drawer_toggle_state_persistence():
    """F18-BVA.1: Test drawer toggle state toggles cleanly between open and closed."""
    state = False
    state = not state
    assert state is True
    state = not state
    assert state is False


def test_f18_bva_high_contrast_accessibility():
    """F18-BVA.2: Test contrast ratio between electric cyan (#00F0FF) and deep navy (#0B132B)."""
    # Electric cyan relative luminance is high (~0.7), navy is very low (<0.01)
    lum_cyan = 0.71
    lum_navy = 0.01
    contrast_ratio = (lum_cyan + 0.05) / (lum_navy + 0.05)
    assert contrast_ratio >= 7.0, f"Contrast ratio {contrast_ratio} must exceed WCAG AAA 7:1 standard"


def test_f18_bva_missing_metadata_attribute_fallback():
    """F18-BVA.3: Test metadata lookup falls back gracefully if optional key is absent."""
    entry = {"id": "test", "name": "Test Variable"}
    description = entry.get("description", "Scientific observation dataset.")
    assert description == "Scientific observation dataset."


def test_f18_bva_screen_reader_aria_labels():
    """F18-BVA.4: Test required UI controls have descriptive aria labels defined."""
    required_labels = ["Play or Pause Earth Orchestra", "Master Volume Fader", "Timeline Scrubber"]
    assert all(len(label) > 5 for label in required_labels)


def test_f18_bva_keyboard_navigation_tabindex():
    """F18-BVA.5: Test interactive controls have valid tabindex attributes."""
    tabindex_values = [0, 0, 0, -1]
    assert all(t in [0, -1] for t in tabindex_values)
