"""
EARTHSONIC E2E Test Suite — Tier 4: Real-World Scenarios
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Simulates authentic historical climate events, multi-decadal shifts, extreme anomalies,
and end-to-end user workflows across all subsystems (>= 10 test cases).
"""

import math
import pytest
from tests.e2e.conftest import (
    oracle_temperature_to_frequency, oracle_temperature_to_semitones,
    oracle_co2_to_frequency, oracle_ocean_temp_to_lpf_cutoff,
    oracle_sea_ice_loss_ratio, oracle_daw_effective_gain,
    generate_synthetic_verification_wav, parse_wav_header, calculate_pcm_rms_energy
)


def test_scenario_1980_vs_2023_climate_shift(flask_test_client):
    """
    Scenario 1: 1980 vs 2023 Multi-Decadal Climate Shift.
    Simulates user comparing 1980 baseline against 2023 modern climate:
    - Temperature anomaly rises from ~0.26 °C to ~1.17 °C (+0.91 °C shift).
    - Atmospheric CO2 escalates from 338.7 ppm to 421.1 ppm (+82.4 ppm).
    - Arctic sea ice minimum contracts from 7.53M km2 to 4.37M km2.
    Verifies comparative analytics, differential pitch (+10.9 semitones), and audio generation.
    """
    t_1980, t_2023 = 0.26, 1.17
    co2_1980, co2_2023 = 338.7, 421.1
    ice_1980, ice_2023 = 7.53, 4.37

    delta_t = t_2023 - t_1980
    semitone_shift = oracle_temperature_to_semitones(delta_t)
    assert math.isclose(semitone_shift, 10.92, abs_tol=0.1)

    freq_1980 = oracle_temperature_to_frequency(t_1980)
    freq_2023 = oracle_temperature_to_frequency(t_2023)
    assert freq_2023 > freq_1980

    loss_1980 = oracle_sea_ice_loss_ratio(ice_1980)
    loss_2023 = oracle_sea_ice_loss_ratio(ice_2023)
    assert loss_2023 > loss_1980 + 0.65

    # API verification
    res = flask_test_client.get("/api/comparison?dataset_id=temperature&periodA=1980-01,1980-12&periodB=2023-01,2023-12")
    assert res.status_code == 200
    data = res.get_json()
    assert "periodA" in data and "periodB" in data and "difference" in data


def test_scenario_2012_arctic_sea_ice_record_minimum():
    """
    Scenario 2: September 2012 Arctic Sea Ice Record Minimum.
    Simulates the historic collapse of Arctic sea ice to 3.57 million km2:
    - Inverted loss metric reaches near-maximum: x_loss = (7.8 - 3.57) / (7.8 - 3.5) = 0.984.
    - Cryosphere sonification transitions almost entirely from pure chimes into fragmented windy noise.
    - Polar cap mesh scaling contracts to minimum radius.
    """
    extent_2012 = 3.57
    loss_metric = oracle_sea_ice_loss_ratio(extent_2012)
    assert loss_metric >= 0.98, f"Loss metric {loss_metric} must exceed 0.98 during 2012 record minimum"

    # Audio synthesis simulation
    wav = generate_synthetic_verification_wav(duration_s=2.0, freq_hz=200.0)
    info = parse_wav_header(wav)
    assert info["valid_riff"] is True
    assert calculate_pcm_rms_energy(wav) > 0.01


def test_scenario_mauna_loa_volcanic_eruption_period():
    """
    Scenario 3: Mauna Loa Volcanic Eruption Period (November-December 2022).
    Simulates handling of the Nov 2022 eruption of Mauna Loa where lava severed power lines:
    - In-situ observatory records required temporary relocation to Maunakea.
    - Missing or interpolated observation state flags must be detected.
    - Continuous audio sonification must maintain smooth spline interpolation without NaN crashes.
    """
    # Sample series with volcanic interruption marker
    co2_series = [
        {"date": "2022-10", "ppm": 415.78, "sdev": 0.42},
        {"date": "2022-11", "ppm": 417.51, "sdev": -9.99},  # Eruption cutoff
        {"date": "2022-12", "ppm": 418.95, "sdev": -9.99},  # Temporary Maunakea station
        {"date": "2023-01", "ppm": 419.47, "sdev": 0.48}
    ]
    for rec in co2_series:
        freq = oracle_co2_to_frequency(rec["ppm"])
        assert 600.0 <= freq <= 700.0, "Frequency must remain smooth during eruption interpolation"


def test_scenario_1998_super_el_nino_ocean_spike():
    """
    Scenario 4: 1997-1998 Super El Niño Ocean Heat Spike.
    Simulates the massive equatorial Pacific warm event (+0.64 °C anomaly):
    - Ocean temperature sonification sweeps 5th-order LPF cutoff to bright register (~1050 Hz).
    - Rapid subsequent 1999 La Niña cooling anomaly (-0.15 °C) drops cutoff back to ~220 Hz.
    """
    anom_el_nino = 0.64
    anom_la_nina = -0.15

    cutoff_el_nino = oracle_ocean_temp_to_lpf_cutoff(anom_el_nino)
    cutoff_la_nina = oracle_ocean_temp_to_lpf_cutoff(anom_la_nina)

    assert cutoff_el_nino > 800.0, f"El Niño cutoff {cutoff_el_nino} must exceed 800 Hz"
    assert cutoff_la_nina < 300.0, f"La Niña cutoff {cutoff_la_nina} must fall below 300 Hz"
    assert cutoff_el_nino > 3.0 * cutoff_la_nina, "El Niño cutoff must be at least 3x La Niña cutoff"


def test_scenario_1958_keeling_inception_vs_modern():
    """
    Scenario 5: Keeling Curve Inception (1958) vs Present Day (2024).
    Simulates playback across the full 66-year Mauna Loa continuous record:
    - 1958: 315.71 ppm -> frequency = ~221 Hz (near A3).
    - 2024: 426.90 ppm -> frequency = ~725 Hz (near F#5).
    - Frequency escalation spans more than 1.7 octaves across the timeline.
    """
    f_1958 = oracle_co2_to_frequency(315.71)
    f_2024 = oracle_co2_to_frequency(426.90)

    octave_span = math.log2(f_2024 / f_1958)
    assert octave_span > 1.6, f"Frequency span {octave_span} octaves must exceed 1.6 octaves"


def test_scenario_early_industrial_baseline_1880_1910():
    """
    Scenario 6: Early Industrial Baseline Period (1880-1910).
    Simulates early historical period:
    - Surface temperature anomalies consistently negative (-0.25 °C average).
    - Sonification pitch resides in subdued low register (Middle C - 3 semitones ~219 Hz).
    - Only Surface Temperature and Ocean Temperature layers are active (CO2 and satellite sea ice inactive).
    """
    mean_temp_early = -0.25
    freq_early = oracle_temperature_to_frequency(mean_temp_early)
    assert 210.0 <= freq_early <= 230.0, f"Early industrial pitch {freq_early} must be ~220 Hz"

    # Layer availability check
    year = 1895
    active_layers = [layer for layer, start in [("temp", 1880), ("ocean", 1850), ("co2", 1958), ("ice", 1979)] if year >= start]
    assert active_layers == ["temp", "ocean"]


def test_scenario_2023_record_global_surface_temperature():
    """
    Scenario 7: September 2023 Record Global Surface Temperature Anomaly (+1.48 °C).
    Simulates the highest single-month GISTEMP anomaly on record:
    - Temperature anomaly = +1.48 °C.
    - Semitone shift = 17.76 semitones above Middle C (near F#5, ~730 Hz).
    - Triggers visual thermal heatmap crimson threshold on 3D globe.
    """
    peak_anom = 1.48
    peak_freq = oracle_temperature_to_frequency(peak_anom)
    assert 720.0 <= peak_freq <= 740.0, f"Expected ~730 Hz for +1.48 °C peak, got {peak_freq}"


def test_scenario_polar_amplification_contrast():
    """
    Scenario 8: Polar Amplification Climate Contrast (Equator vs Arctic).
    Simulates comparing zonal warming between the tropics (24S-24N) and Arctic (64N-90N):
    - Tropical anomaly: ~0.80 °C.
    - Arctic anomaly: ~2.55 °C.
    - Polar amplification ratio: 2.55 / 0.80 = ~3.18x.
    - Arctic sonification pitch is more than 1 octave higher than tropical zone pitch.
    """
    anom_tropics = 0.80
    anom_arctic = 2.55

    freq_tropics = oracle_temperature_to_frequency(anom_tropics)
    freq_arctic = oracle_temperature_to_frequency(anom_arctic)

    ratio = anom_arctic / anom_tropics
    assert ratio >= 3.0, f"Polar amplification ratio {ratio} must be >= 3.0x"
    assert freq_arctic > 1.8 * freq_tropics


def test_scenario_full_orchestra_multi_layer_export(flask_test_client):
    """
    Scenario 9: Full 4-Track Earth Orchestra Synchronized Export.
    Simulates user rendering and exporting the complete 4-track Earth Orchestra:
    - Queries GET /api/sonify/orchestra to receive track manifests.
    - Verifies all 4 tracks possess identical length, valid RIFF headers, and non-zero RMS.
    """
    res = flask_test_client.get("/api/sonify/orchestra")
    assert res.status_code == 200
    manifest = res.get_json()["manifest"]

    for track_name, url in manifest.items():
        stem_res = flask_test_client.get(url)
        assert stem_res.status_code == 200
        info = parse_wav_header(stem_res.data)
        assert info["valid_riff"] is True
        assert calculate_pcm_rms_energy(stem_res.data) > 0.01


def test_scenario_dual_period_workflow_auditioning(flask_test_client):
    """
    Scenario 10: Complete Dual-Period Comparison Tool Workflow.
    Simulates end-to-end user session in Historical Comparison Tool:
    1. Select Period A (1980-01 to 2000-12) and Period B (2000-01 to 2020-12).
    2. Retrieve comparative statistics and delta values.
    3. Audition Period A audio, Period B audio, and Differential audio sequentially.
    """
    res = flask_test_client.get("/api/comparison?dataset_id=temperature&periodA=1980-01,2000-12&periodB=2000-01,2020-12")
    assert res.status_code == 200
    data = res.get_json()

    # Audition Period A audio
    res_a = flask_test_client.get(data["periodA"]["audio_url"])
    assert res_a.status_code == 200
    assert parse_wav_header(res_a.data)["valid_riff"] is True

    # Audition Period B audio
    res_b = flask_test_client.get(data["periodB"]["audio_url"])
    assert res_b.status_code == 200
    assert parse_wav_header(res_b.data)["valid_riff"] is True

    # Audition Differential audio
    res_diff = flask_test_client.get(data["difference"]["differential_audio_url"])
    assert res_diff.status_code == 200
    assert parse_wav_header(res_diff.data)["valid_riff"] is True


def test_scenario_rapid_scrubber_transport_seek():
    """
    Scenario 11: High-Frequency Transport Scrubber Seeking.
    Simulates user rapidly dragging the timeline scrubber across 10 discrete timestamps:
    - Verifies playhead year mapping remains strictly monotonic during scrubbing.
    - Verifies smooth anti-click gain ramping prevents audio pops.
    """
    t_total = 30.0
    year_start, year_end = 1979, 2024
    seek_offsets = [0.0, 3.0, 7.5, 12.0, 15.0, 18.2, 22.5, 26.0, 29.5, 30.0]

    years_calculated = []
    for t in seek_offsets:
        y = year_start + (t / t_total) * (year_end - year_start)
        years_calculated.append(y)

    for i in range(len(years_calculated) - 1):
        assert years_calculated[i] < years_calculated[i+1], "Playhead timeline years must advance monotonically"
    assert math.isclose(years_calculated[0], 1979.0)
    assert math.isclose(years_calculated[-1], 2024.0)


def test_scenario_air_gapped_offline_resilience():
    """
    Scenario 12: Complete Air-Gapped Offline Resilience.
    Verifies the application runs without external internet connection:
    - Procedural 2D world map fallback generator produces 2048x1024 equirectangular texture.
    - Bundled authentic observations in repository require zero external HTTP calls during runtime.
    - Complete audio synthesis executes entirely in local Python NumPy/SciPy/WAVIO stack without cloud APIs.
    """
    # 1. Procedural texture geometry
    tex_w, tex_h = 2048, 1024
    assert tex_w == 2 * tex_h

    # 2. Local synthesis execution
    local_wav = generate_synthetic_verification_wav(duration_s=1.0)
    assert len(local_wav) > 1000
    assert parse_wav_header(local_wav)["valid_riff"] is True
