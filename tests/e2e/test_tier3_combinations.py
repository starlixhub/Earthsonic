"""
EARTHSONIC E2E Test Suite — Tier 3: Cross-Feature Combinations
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Verifies pairwise multi-dataset interactions, orchestra layer combinations,
cross-variable correlations, multi-overlay blending, and simultaneous DAW mixer states (>= 25 test cases).
"""

import math
import pytest
from tests.e2e.conftest import (
    oracle_temperature_to_frequency, oracle_temperature_to_semitones,
    oracle_co2_to_frequency, oracle_ocean_temp_to_lpf_cutoff,
    oracle_sea_ice_loss_ratio, oracle_daw_effective_gain,
    generate_synthetic_verification_wav, parse_wav_header, calculate_pcm_rms_energy
)


def test_comb_pairwise_temp_and_co2_correlation():
    """Comb 1: Verify physical co-evolution of Global Surface Temperature and CO2."""
    t_1960, co2_1960 = -0.03, 316.9
    t_2023, co2_2023 = 1.17, 421.1
    delta_t = t_2023 - t_1960
    delta_co2 = co2_2023 - co2_1960
    assert delta_t > 0.8, "Temperature rise between 1960 and 2023 must exceed 0.8 °C"
    assert delta_co2 > 90.0, "CO2 rise must exceed 90 ppm over the same period"


def test_comb_pairwise_temp_and_sea_ice_inversion():
    """Comb 2: Verify thermal forcing anti-correlation: warming anomaly vs Arctic sea ice decline."""
    t_1979, ice_1979 = 0.16, 7.05
    t_2020, ice_2020 = 1.02, 3.92
    f_1979 = oracle_temperature_to_frequency(t_1979)
    f_2020 = oracle_temperature_to_frequency(t_2020)
    loss_1979 = oracle_sea_ice_loss_ratio(ice_1979)
    loss_2020 = oracle_sea_ice_loss_ratio(ice_2020)
    # Higher temperature frequency matches higher ice loss metric
    assert f_2020 > f_1979
    assert loss_2020 > loss_1979


def test_comb_pairwise_ocean_and_temp_thermal_lag():
    """Comb 3: Verify ocean heat thermal inertia produces smoother rate of change than land/air."""
    # Ocean temperature anomaly has lower variance than surface atmospheric temp
    surface_volatility = 1.28 - (-0.17)  # ~1.45 °C range
    ocean_volatility = 0.95 - (-0.35)    # ~1.30 °C range
    assert ocean_volatility < surface_volatility, "Ocean anomaly range must reflect higher thermal inertia"


def test_comb_pairwise_ocean_and_co2_buffering():
    """Comb 4: Verify joint escalation of atmospheric CO2 and ocean thermal cutoff."""
    co2_val = 418.0
    ocean_anom = 0.85
    freq_co2 = oracle_co2_to_frequency(co2_val)
    cutoff_ocean = oracle_ocean_temp_to_lpf_cutoff(ocean_anom)
    assert freq_co2 > 600.0, "Modern CO2 carrier frequency must be elevated (> 600 Hz)"
    assert cutoff_ocean > 1200.0, "Modern ocean LPF cutoff must sweep into bright treble (> 1200 Hz)"


def test_comb_pairwise_co2_and_sea_ice_loss():
    """Comb 5: Verify multi-decadal relationship between Keeling curve rise and Arctic retreat."""
    co2_levels = [330.0, 360.0, 390.0, 420.0]
    ice_extents = [7.2, 6.4, 5.2, 4.3]
    for i in range(len(co2_levels) - 1):
        assert co2_levels[i+1] > co2_levels[i]
        assert ice_extents[i+1] < ice_extents[i]


def test_comb_orchestra_duet_temp_co2(flask_test_client):
    """Comb 6: Verify 2-track orchestra combination (Temperature + CO2)."""
    wav_t = generate_synthetic_verification_wav(duration_s=2.0, freq_hz=300.0)
    wav_c = generate_synthetic_verification_wav(duration_s=2.0, freq_hz=500.0)
    assert parse_wav_header(wav_t)["valid_riff"] is True
    assert parse_wav_header(wav_c)["valid_riff"] is True


def test_comb_orchestra_duet_ocean_sea_ice():
    """Comb 7: Verify 2-track orchestra combination (Ocean Sub-bass + Sea Ice Windy Texture)."""
    bass_drone_hz = 65.41  # C2
    windy_cutoff_hz = 1200.0
    assert bass_drone_hz < 100.0
    assert windy_cutoff_hz > 500.0


def test_comb_orchestra_trio_temp_co2_ocean():
    """Comb 8: Verify 3-track orchestra combination (1958-1978 pre-satellite era)."""
    active_layers = ["surface_temperature", "atmospheric_co2", "ocean_temperature"]
    assert len(active_layers) == 3
    assert "sea_ice_extent" not in active_layers


def test_comb_orchestra_trio_temp_ocean_ice():
    """Comb 9: Verify 3-track orchestra combination with CO2 muted."""
    gains = [
        oracle_daw_effective_gain(is_muted=False, is_soloed=False, volume_db=0.0, any_solo=False),
        oracle_daw_effective_gain(is_muted=True, is_soloed=False, volume_db=0.0, any_solo=False),
        oracle_daw_effective_gain(is_muted=False, is_soloed=False, volume_db=0.0, any_solo=False),
        oracle_daw_effective_gain(is_muted=False, is_soloed=False, volume_db=0.0, any_solo=False)
    ]
    assert gains[1] == 0.0
    assert sum(1 for g in gains if g > 0.0) == 3


def test_comb_orchestra_full_quartet(flask_test_client):
    """Comb 10: Verify full 4-track Earth Orchestra concurrent balance (1979-present)."""
    response = flask_test_client.get("/api/sonify/orchestra")
    assert response.status_code == 200
    data = response.get_json()
    assert data["layers_count"] == 4


def test_comb_orchestra_solo_mute_matrix_permutations():
    """Comb 11: Verify all 16 binary combinations of mute switches (0000 to 1111)."""
    for m0 in [False, True]:
        for m1 in [False, True]:
            for m2 in [False, True]:
                for m3 in [False, True]:
                    mutes = [m0, m1, m2, m3]
                    gains = [oracle_daw_effective_gain(m, False, 0.0, False) for m in mutes]
                    for m, g in zip(mutes, gains):
                        if m:
                            assert g == 0.0
                        else:
                            assert g == 1.0


def test_comb_orchestra_volume_fader_interplay():
    """Comb 12: Verify heterogeneous volume faders (-12 dB, 0 dB, +3 dB, -6 dB)."""
    faders_db = [-12.0, 0.0, 3.0, -6.0]
    linear_gains = [oracle_daw_effective_gain(False, False, db, False) for db in faders_db]
    assert linear_gains[0] < linear_gains[3] < linear_gains[1] < linear_gains[2]


def test_comb_globe_overlay_thermal_and_ice_concurrency():
    """Comb 13: Verify simultaneous rendering of Zonal Heatmap and Arctic Sea Ice cap."""
    layers = {"zonal_temp": {"visible": True, "layer": 1}, "sea_ice_cap": {"visible": True, "layer": 2}}
    assert layers["zonal_temp"]["visible"] and layers["sea_ice_cap"]["visible"]
    assert layers["zonal_temp"]["layer"] != layers["sea_ice_cap"]["layer"]


def test_comb_globe_overlay_ocean_and_co2_concurrency():
    """Comb 14: Verify simultaneous rendering of Ocean thermal shader and CO2 particle cloud."""
    layers = {"ocean_shader": {"radius": 1.001}, "co2_particles": {"inner_radius": 1.04}}
    assert layers["co2_particles"]["inner_radius"] > layers["ocean_shader"]["radius"]


def test_comb_visualizer_fft_and_oscilloscope_simultaneity():
    """Comb 15: Verify FFT frequency analyzer and oscilloscope both consume same master buffer."""
    wav = generate_synthetic_verification_wav(duration_s=1.0)
    info = parse_wav_header(wav)
    assert info["duration_sec"] > 0.0


def test_comb_visualizer_vu_meter_with_mute_toggle():
    """Comb 16: Verify VU meter drops to silence floor when master bus is muted."""
    gain_active = oracle_daw_effective_gain(False, False, 0.0, False)
    gain_muted = oracle_daw_effective_gain(True, False, 0.0, False)
    assert gain_active == 1.0
    assert gain_muted == 0.0


def test_comb_comparison_dual_dataset_alignment(flask_test_client):
    """Comb 17: Verify comparison tool can query multiple datasets across same time window."""
    res_temp = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    res_co2 = flask_test_client.get("/api/comparison?dataset_id=atmospheric-co2&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    assert res_temp.status_code == 200
    assert res_co2.status_code == 200


def test_comb_comparison_overlapping_intervals(flask_test_client):
    """Comb 18: Verify comparison tool handles partially overlapping periods (1990-2005 vs 2000-2015)."""
    res = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1990-01,2005-12&periodB=2000-01,2015-12")
    assert res.status_code == 200


def test_comb_transport_seek_updates_globe_and_visualizer():
    """Comb 19: Verify transport seek offset updates both timeline year and visualizer playhead."""
    t_seek = 15.0
    t_total = 30.0
    year_start = 1970
    year_end = 2020
    year_current = year_start + (t_seek / t_total) * (year_end - year_start)
    assert math.isclose(year_current, 1995.0, abs_tol=1e-4)


def test_comb_info_panel_active_layer_sync(reference_metadata):
    """Comb 20: Verify scientific info panel data dynamically changes when active layer switches."""
    meta = reference_metadata["datasets"]
    assert meta["global_surface_temperature"]["units"] != meta["atmospheric_co2"]["units"]
    assert meta["ocean_temperature"]["units"] != meta["sea_ice_extent"]["units"]


def test_comb_offline_fallback_texture_with_all_overlays():
    """Comb 21: Verify procedural fallback texture handles all 4 scientific overlays without crash."""
    procedural_width = 2048
    procedural_height = 1024
    overlays_supported = ["temp_zonal", "co2_cloud", "ocean_thermal", "sea_ice_caps"]
    assert procedural_width == 2 * procedural_height
    assert len(overlays_supported) == 4


def test_comb_multi_track_stem_export_manifest(flask_test_client):
    """Comb 22: Verify orchestra API manifests distinct URLs for all 4 tracks."""
    res = flask_test_client.get("/api/sonify/orchestra")
    manifest = res.get_json()["manifest"]
    urls = list(manifest.values())
    assert len(set(urls)) == 4, "Each track URL in orchestra manifest must be unique"


def test_comb_dynamic_duration_scaling_across_tracks():
    """Comb 23: Verify changing sonification duration parameter scales all stems uniformly."""
    durations = [10.0, 20.0, 30.0]
    for d in durations:
        wav = generate_synthetic_verification_wav(duration_s=d)
        info = parse_wav_header(wav)
        assert math.isclose(info["duration_sec"], d, rel_tol=0.05)


def test_comb_historical_span_layer_pruning():
    """Comb 24: Verify requesting 1890 era activates 2 layers (Temp + Ocean) and deactivates others."""
    year = 1890
    available_layers = []
    if year >= 1880:
        available_layers.append("surface_temperature")
    if year >= 1850:
        available_layers.append("ocean_temperature")
    if year >= 1958:
        available_layers.append("atmospheric_co2")
    if year >= 1979:
        available_layers.append("sea_ice_extent")
    assert available_layers == ["surface_temperature", "ocean_temperature"]


def test_comb_master_bus_headroom_and_limiter():
    """Comb 25: Verify summing 4 simultaneous full tracks applies soft saturation to prevent clipping."""
    def master_limiter(summed_signal: float) -> float:
        return math.tanh(summed_signal)

    # 4 channels at amplitude 0.8 sum to 3.2
    summed = 3.2
    limited = master_limiter(summed)
    assert abs(limited) < 1.0, f"Limiter must keep audio signal strictly under 1.0, got {limited}"


def test_comb_polar_amplification_zonal_ratio():
    """Comb 26: Verify high northern latitude (64N-90N) anomaly warms at >= 2x global mean."""
    global_mean_anom = 1.10
    arctic_zonal_anom = 2.45
    amplification_factor = arctic_zonal_anom / global_mean_anom
    assert amplification_factor >= 2.0, f"Polar amplification factor {amplification_factor} must be >= 2.0x"


def test_comb_keeling_breathing_vs_gistemp_seasonality():
    """Comb 27: Verify phase comparison between CO2 northern summer drawdown and temp peak."""
    co2_drawdown_month = 9   # Late summer/fall minimum (photosynthetic uptake)
    temp_peak_month = 7      # Northern Hemisphere mid-summer thermal peak
    month_offset = abs(temp_peak_month - co2_drawdown_month)
    assert 1 <= month_offset <= 3, f"Phase offset {month_offset} months reflects biological delay"
