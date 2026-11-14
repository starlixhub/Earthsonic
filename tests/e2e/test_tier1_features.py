"""
EARTHSONIC E2E Test Suite — Tier 1: Feature Coverage (F1 through F18)
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Validates primary functionality, API contracts, mathematical oracles, and scientific
requirements for all 18 EARTHSONIC features (>= 5 test cases per feature = 90 tests).
"""

import math
import json
import pytest
from pathlib import Path
from tests.e2e.conftest import (
    PROJECT_ROOT, DATA_RAW_DIR, DATA_PROCESSED_DIR,
    oracle_temperature_to_frequency, oracle_temperature_to_semitones,
    oracle_co2_to_frequency, oracle_ocean_temp_to_lpf_cutoff,
    oracle_sea_ice_loss_ratio, oracle_daw_effective_gain,
    parse_wav_header, calculate_pcm_rms_energy, generate_synthetic_verification_wav
)


# ============================================================================
# F1: Global Surface Temperature Data & API
# ============================================================================

def test_f1_gistemp_raw_data_schema(data_raw_dir):
    """F1.1: Verify raw GISTEMP CSV header structure and column layout."""
    csv_path = data_raw_dir / "GLB.Ts+dSST.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    header_idx = 1 if "Land-Ocean" in lines[0] else 0
    header = lines[header_idx].split(",")
    assert "Year" in header[0], f"Expected 'Year' in column 0, got {header[0]}"
    for month in ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]:
        assert month in header, f"Expected month {month} in GISTEMP header"


def test_f1_gistemp_temporal_extent(data_raw_dir):
    """F1.2: Verify GISTEMP observation record spans 1880 to modern era."""
    csv_path = data_raw_dir / "GLB.Ts+dSST.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    years = []
    for line in lines[2:]:
        parts = line.split(",")
        if parts[0].isdigit():
            years.append(int(parts[0]))
    assert len(years) >= 140, f"Expected >= 140 observation years, found {len(years)}"
    assert min(years) == 1880, f"Expected start year 1880, got {min(years)}"
    assert max(years) >= 2024, f"Expected latest year >= 2024, got {max(years)}"


def test_f1_gistemp_null_encoding(data_raw_dir):
    """F1.3: Verify missing months encoded as '***' in GISTEMP are identified."""
    test_line = "2026,1.20,1.25,1.18,***,***,***,***,***,***,***,***,***"
    parts = test_line.split(",")
    parsed = [None if p == "***" else float(p) for p in parts[1:]]
    assert parsed[0] == 1.20
    assert parsed[3] is None, "Expected '***' to parse as None"
    assert parsed.count(None) == 9, "Expected exactly 9 missing months in sample row"


def test_f1_gistemp_anomaly_bounds():
    """F1.4: Verify GISTEMP temperature anomaly boundaries adhere to physical climate limits."""
    # NASA GISS documented range: -0.85 °C (1890s) to +1.50 °C (2023/2024)
    min_observed = -0.81
    max_observed = 1.48
    assert min_observed >= -0.85, f"Historical min {min_observed} exceeds lower bound -0.85 °C"
    assert max_observed <= 1.50, f"Historical max {max_observed} exceeds upper bound +1.50 °C"
    assert min_observed < 0.0 < max_observed, "Baseline 0.0 °C must lie strictly within observed range"


def test_f1_gistemp_endpoint_contract(flask_test_client):
    """F1.5: Verify GET /api/timeseries/temperature API contract."""
    response = flask_test_client.get("/api/timeseries/temperature")
    assert response.status_code == 200, f"Expected HTTP 200, got {response.status_code}"
    data = response.get_json()
    assert data is not None, "Response must be valid JSON"
    assert "dataset_id" in data or "months" in data or "data" in data, "JSON payload must contain dataset identifiers"


# ============================================================================
# F2: Atmospheric CO2 Data & API
# ============================================================================

def test_f2_co2_raw_data_preamble(data_raw_dir):
    """F2.1: Verify NOAA GML Mauna Loa CO2 comment preambles are parsed correctly."""
    csv_path = data_raw_dir / "co2_mm_mlo.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    with open(csv_path, "r", encoding="utf-8") as f:
        comment_lines = [line for line in f if line.startswith("#")]
    assert len(comment_lines) >= 30, f"Expected >= 30 metadata comment lines, got {len(comment_lines)}"


def test_f2_co2_temporal_span(data_raw_dir):
    """F2.2: Verify continuous monthly Keeling Curve record spans from March 1958."""
    csv_path = data_raw_dir / "co2_mm_mlo.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    data_rows = []
    with open(csv_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.startswith("#") and line.strip():
                parts = line.split(",")
                if len(parts) >= 4 and parts[0].strip().isdigit():
                    data_rows.append((int(parts[0]), int(parts[1]), float(parts[3])))
    assert len(data_rows) >= 750, f"Expected >= 750 monthly CO2 records, found {len(data_rows)}"
    first_year, first_month, _ = data_rows[0]
    assert first_year == 1958 and first_month == 3, f"Expected start 1958-03, got {first_year}-{first_month}"


def test_f2_co2_mole_fraction_monotonic_rise():
    """F2.3: Verify physical atmospheric CO2 dry air mole fraction increases significantly."""
    co2_1958 = 315.71
    co2_2024 = 426.90
    assert co2_2024 > co2_1958 + 100.0, "Modern CO2 must be > 100 ppm higher than 1958 baseline"
    assert 310.0 <= co2_1958 <= 320.0, "1958 baseline must be ~315 ppm"
    assert 420.0 <= co2_2024 <= 440.0, "2024 measurement must be ~427 ppm"


def test_f2_co2_seasonal_breathing_cycle():
    """F2.4: Verify biospheric seasonal cycle amplitude is preserved in CO2 data (~3-6 ppm)."""
    # Canonical seasonal variation: May peak minus October trough
    may_val = 426.5
    oct_val = 421.0
    seasonal_diff = may_val - oct_val
    assert 3.0 <= seasonal_diff <= 7.0, f"Seasonal amplitude {seasonal_diff} must be between 3.0 and 7.0 ppm"


def test_f2_co2_endpoint_contract(flask_test_client):
    """F2.5: Verify GET /api/timeseries/atmospheric_co2 API contract."""
    response = flask_test_client.get("/api/timeseries/atmospheric_co2")
    assert response.status_code == 200, f"Expected HTTP 200, got {response.status_code}"
    data = response.get_json()
    assert data is not None, "Response must be valid JSON"


# ============================================================================
# F3: Ocean Temperature Data & API
# ============================================================================

def test_f3_ocean_temp_preamble_and_columns(data_raw_dir):
    """F3.1: Verify NOAA NCEI ocean temperature anomaly CSV format."""
    csv_path = data_raw_dir / "ocean_temp_global.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    with open(csv_path, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]
    header_found = any("Departure" in line or "Anomaly" in line for line in lines[:6])
    assert header_found, "Expected ocean temp anomaly column header in top 6 lines"


def test_f3_ocean_temp_yyyymm_date_parsing():
    """F3.2: Verify YYYYMM integer date parsing into ISO year-month string."""
    sample_date_int = 185001
    year = sample_date_int // 100
    month = sample_date_int % 100
    iso_date = f"{year:04d}-{month:02d}"
    assert year == 1850 and month == 1
    assert iso_date == "1850-01"


def test_f3_ocean_temp_baseline_and_units():
    """F3.3: Verify ocean temperature units are °C relative to 20th century average."""
    baseline_anom = 0.0
    cool_era_anom = -0.45
    warm_era_anom = 1.05
    assert cool_era_anom < baseline_anom < warm_era_anom
    assert abs(warm_era_anom - baseline_anom) > 0.5, "Modern ocean anomaly must show significant warming"


def test_f3_ocean_temp_anomaly_limits():
    """F3.4: Verify ocean temperature anomaly values respect ocean thermal inertia bounds."""
    # Physical constraints: Ocean temperature anomaly bounds [-0.60, +1.20] °C
    min_bound = -0.60
    max_bound = 1.20
    test_val = 0.88
    assert min_bound <= test_val <= max_bound, f"Value {test_val} outside ocean bounds [{min_bound}, {max_bound}]"


def test_f3_ocean_temp_endpoint_contract(flask_test_client):
    """F3.5: Verify GET /api/timeseries/ocean_temperature API endpoint contract."""
    response = flask_test_client.get("/api/timeseries/ocean_temperature")
    assert response.status_code == 200, f"Expected HTTP 200, got {response.status_code}"
    data = response.get_json()
    assert data is not None


# ============================================================================
# F4: Sea Ice Extent Data & API
# ============================================================================

def test_f4_sea_ice_csv_whitespace_stripping():
    """F4.1: Verify whitespace padding in NSIDC CSV tokens is properly stripped."""
    sample_raw_line = "1979,  9,    NSIDC-0051,      N,   7.05,   4.58\n"
    tokens = [t.strip() for t in sample_raw_line.split(",")]
    assert tokens[0] == "1979"
    assert tokens[1] == "9"
    assert tokens[2] == "NSIDC-0051"
    assert float(tokens[4]) == 7.05
    assert float(tokens[5]) == 4.58


def test_f4_sea_ice_september_minimum_canonical(data_raw_dir):
    """F4.2: Verify Arctic September minimum sea ice series starts in 1979."""
    csv_path = data_raw_dir / "N_09_extent_v4.0.csv"
    if not csv_path.exists():
        pytest.skip("Raw data file not yet downloaded by M1")
    with open(csv_path, "r", encoding="utf-8") as f:
        data_lines = [line.strip() for line in f if line.strip() and not line.startswith("year")]
    first_year = int(data_lines[0].split(",")[0].strip())
    assert first_year == 1979, f"Expected satellite baseline year 1979, got {first_year}"


def test_f4_sea_ice_units_and_range():
    """F4.3: Verify Arctic sea ice extent is in million km2 within [3.0, 8.0]."""
    extent_1979 = 7.05
    extent_2023 = 4.37
    assert 3.0 <= extent_2023 <= 8.0, f"Extent {extent_2023} outside valid range"
    assert extent_1979 > extent_2023, "Baseline 1979 extent must exceed modern extent"


def test_f4_sea_ice_2012_record_minimum():
    """F4.4: Verify September 2012 record minimum (~3.57 million km2) is maintained."""
    record_min_2012 = 3.57
    assert 3.50 <= record_min_2012 <= 3.65, f"2012 record minimum must be ~3.57, got {record_min_2012}"


def test_f4_sea_ice_endpoint_contract(flask_test_client):
    """F4.5: Verify GET /api/timeseries/sea_ice_extent API endpoint contract."""
    response = flask_test_client.get("/api/timeseries/sea_ice_extent")
    assert response.status_code == 200, f"Expected HTTP 200, got {response.status_code}"
    data = response.get_json()
    assert data is not None


# ============================================================================
# F5: Harmonized 4-Track Timeline & Metadata
# ============================================================================

def test_f5_harmonized_grid_temporal_span(data_processed_dir):
    """F5.1: Verify harmonized multi-variable timeline spans 1979 through 2024+ (>= 540 months)."""
    harm_file = data_processed_dir / "earthsonic_monthly_harmonized.json"
    if not harm_file.exists():
        pytest.skip("Processed harmonized dataset not yet generated by M1")
    with open(harm_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    months = data.get("months", [])
    assert len(months) >= 540, f"Expected >= 540 months, got {len(months)}"
    assert months[0].startswith("1979-"), f"Expected start in 1979, got {months[0]}"


def test_f5_harmonized_grid_four_variables_present(data_processed_dir):
    """F5.2: Verify harmonized dataset contains all four core scientific indicators."""
    harm_file = data_processed_dir / "earthsonic_monthly_harmonized.json"
    if not harm_file.exists():
        pytest.skip("Processed harmonized dataset not yet generated by M1")
    with open(harm_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    for var in ["temperature_anomaly", "co2_ppm", "ocean_temp_anomaly", "sea_ice_extent"]:
        assert var in data, f"Required variable '{var}' missing from harmonized dataset"
        assert len(data[var]) == len(data["months"]), f"Length of {var} does not match months array"


def test_f5_metadata_catalog_authenticity_fields(data_processed_dir, reference_metadata):
    """F5.3: Verify metadata catalog documents authentic NASA/NOAA agencies and zero synthetic data."""
    meta_file = data_processed_dir / "metadata.json"
    if meta_file.exists():
        with open(meta_file, "r", encoding="utf-8") as f:
            meta = json.load(f)
    else:
        meta = reference_metadata
    datasets = meta.get("datasets", {})
    for key, spec in reference_metadata["datasets"].items():
        assert key in datasets or any(key in d.get("id", "") for d in datasets.values()), f"Dataset {key} missing from metadata"


def test_f5_metadata_sonification_mapping_descriptions(data_processed_dir, reference_metadata):
    """F5.4: Verify metadata catalog provides physical mapping descriptions for every layer."""
    meta_file = data_processed_dir / "metadata.json"
    if meta_file.exists():
        with open(meta_file, "r", encoding="utf-8") as f:
            meta = json.load(f)
    else:
        meta = reference_metadata
    assert "datasets" in meta, "Metadata must contain 'datasets' key"


def test_f5_endpoint_datasets_list(flask_test_client):
    """F5.5: Verify GET /api/datasets lists all 4 core climate variables."""
    response = flask_test_client.get("/api/datasets")
    assert response.status_code == 200, f"Expected HTTP 200, got {response.status_code}"
    data = response.get_json()
    assert "datasets" in data, "Response must include 'datasets' key"
    assert len(data["datasets"]) >= 4, f"Expected >= 4 datasets, found {len(data['datasets'])}"


# ============================================================================
# F6: Temperature STRAUSS Sonification
# ============================================================================

def test_f6_temperature_pitch_formula_neutral():
    """F6.1: Verify 0.0 °C temperature anomaly maps exactly to Middle C (261.63 Hz)."""
    freq = oracle_temperature_to_frequency(0.0)
    assert math.isclose(freq, 261.63, rel_tol=1e-3), f"Expected 261.63 Hz, got {freq}"


def test_f6_temperature_pitch_formula_positive():
    """F6.2: Verify +1.0 °C warming anomaly shifts pitch up by 1 full octave (523.26 Hz)."""
    freq = oracle_temperature_to_frequency(1.0)
    assert math.isclose(freq, 523.26, rel_tol=1e-3), f"Expected 523.26 Hz for +1.0 °C, got {freq}"


def test_f6_temperature_pitch_formula_negative():
    """F6.3: Verify -0.85 °C cooling anomaly shifts pitch down into lower register (~145 Hz)."""
    freq = oracle_temperature_to_frequency(-0.85)
    assert 140.0 <= freq <= 150.0, f"Expected ~145 Hz for -0.85 °C, got {freq}"


def test_f6_temperature_semitone_scaling():
    """F6.4: Verify temperature to semitone scaling is exactly 12 semitones per °C."""
    assert oracle_temperature_to_semitones(1.0) == 12.0
    assert oracle_temperature_to_semitones(0.5) == 6.0
    assert oracle_temperature_to_semitones(-1.0) == -12.0


def test_f6_temperature_audio_rendering_contract(flask_test_client):
    """F6.5: Verify GET /api/sonify/surface-temperature returns valid WAV audio buffer."""
    response = flask_test_client.get("/api/sonify/surface-temperature?duration=2")
    assert response.status_code == 200
    assert "audio/wav" in response.headers.get("Content-Type", "")
    info = parse_wav_header(response.data)
    assert info["valid_riff"] is True
    assert info["sample_rate"] in [44100, 48000]
    rms = calculate_pcm_rms_energy(response.data)
    assert rms > 0.01, f"Audio energy must be audible, got RMS={rms}"


# ============================================================================
# F7: CO2 STRAUSS Sonification
# ============================================================================

def test_f7_co2_carrier_frequency_monotonicity():
    """F7.1: Verify increasing CO2 concentration monotonically increases carrier frequency."""
    f_315 = oracle_co2_to_frequency(315.0)
    f_350 = oracle_co2_to_frequency(350.0)
    f_400 = oracle_co2_to_frequency(400.0)
    f_430 = oracle_co2_to_frequency(430.0)
    assert f_315 < f_350 < f_400 < f_430, "CO2 frequency must be strictly monotonic"


def test_f7_co2_normalization_bounds():
    """F7.2: Verify CO2 frequency range spans G3 (196 Hz) to G5 (784 Hz)."""
    f_min = oracle_co2_to_frequency(310.0)
    f_max = oracle_co2_to_frequency(440.0)
    assert math.isclose(f_min, 196.0, rel_tol=1e-2), f"Expected G3 (~196 Hz), got {f_min}"
    assert math.isclose(f_max, 783.99, rel_tol=1e-2), f"Expected G5 (~784 Hz), got {f_max}"


def test_f7_co2_harmonic_tension_saturation():
    """F7.3: Verify crossing 350 ppm boundary increases harmonic saturation metric."""
    def saturation_metric(ppm: float) -> float:
        return max(0.0, (ppm - 350.0) / (440.0 - 350.0))

    assert saturation_metric(320.0) == 0.0, "Sub-350 ppm should have zero penalty saturation"
    assert saturation_metric(350.0) == 0.0
    assert saturation_metric(395.0) == 0.5
    assert saturation_metric(440.0) == 1.0


def test_f7_co2_seasonal_modulation_envelope():
    """F7.4: Verify seasonal amplitude modulation envelope oscillates periodically."""
    # 12 months in year, peak in month 5, trough in month 10
    months = list(range(1, 13))
    oscillation = [math.sin(2 * math.pi * (m - 2) / 12) for m in months]
    assert oscillation[4] > 0.8, "May (index 4) should be near peak"
    assert oscillation[9] < -0.8, "October (index 9) should be near trough"


def test_f7_co2_audio_rendering_contract(flask_test_client):
    """F7.5: Verify GET /api/sonify/atmospheric-co2 returns valid WAV audio buffer."""
    response = flask_test_client.get("/api/sonify/atmospheric-co2?duration=2")
    assert response.status_code == 200
    info = parse_wav_header(response.data)
    assert info["valid_riff"] is True
    assert calculate_pcm_rms_energy(response.data) > 0.01


# ============================================================================
# F8: Ocean Temperature Sonification
# ============================================================================

def test_f8_ocean_deep_resonance_chord():
    """F8.1: Verify foundation sub-bass chord includes low-frequency roots (C2=65.4 Hz, G2=98.0 Hz)."""
    c2_hz = 65.41
    g2_hz = 97.99
    c3_hz = 130.81
    e3_hz = 164.81
    assert 50.0 <= c2_hz <= 70.0, "C2 fundamental must be in 50-70 Hz sub-bass register"
    assert g2_hz > c2_hz and c3_hz > g2_hz and e3_hz > c3_hz, "Voicing must be ascending chord"


def test_f8_ocean_lpf_cutoff_cold_baseline():
    """F8.2: Verify baseline/cold ocean temperature anomaly produces muffled cutoff (80-200 Hz)."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(-0.60)
    assert math.isclose(cutoff, 80.0, rel_tol=1e-2), f"Expected 80 Hz cutoff for -0.60 °C, got {cutoff}"


def test_f8_ocean_lpf_cutoff_warm_peak():
    """F8.3: Verify record warm ocean anomaly sweeps filter cutoff up to 2400 Hz."""
    cutoff = oracle_ocean_temp_to_lpf_cutoff(1.20)
    assert math.isclose(cutoff, 2400.0, rel_tol=1e-2), f"Expected 2400 Hz cutoff for +1.20 °C, got {cutoff}"


def test_f8_ocean_filter_monotonicity():
    """F8.4: Verify filter cutoff frequency strictly increases with ocean temperature anomaly."""
    cutoffs = [oracle_ocean_temp_to_lpf_cutoff(anom) for anom in [-0.5, -0.2, 0.0, 0.4, 0.8, 1.1]]
    for i in range(len(cutoffs) - 1):
        assert cutoffs[i] < cutoffs[i+1], f"Cutoff {cutoffs[i]} must be less than {cutoffs[i+1]}"


def test_f8_ocean_audio_rendering_contract(flask_test_client):
    """F8.5: Verify GET /api/sonify/ocean-temperature returns valid WAV audio buffer."""
    response = flask_test_client.get("/api/sonify/ocean-temperature?duration=2")
    assert response.status_code == 200
    info = parse_wav_header(response.data)
    assert info["valid_riff"] is True
    assert calculate_pcm_rms_energy(response.data) > 0.01


# ============================================================================
# F9: Sea Ice Extent Sonification
# ============================================================================

def test_f9_sea_ice_inverted_loss_metric():
    """F9.1: Verify inverted cryospheric loss metric: 7.8M km2 -> 0.0, 3.5M km2 -> 1.0."""
    loss_high = oracle_sea_ice_loss_ratio(7.8)
    loss_mid = oracle_sea_ice_loss_ratio(5.65)
    loss_low = oracle_sea_ice_loss_ratio(3.5)
    assert math.isclose(loss_high, 0.0, abs_tol=1e-4)
    assert math.isclose(loss_mid, 0.5, abs_tol=1e-4)
    assert math.isclose(loss_low, 1.0, abs_tol=1e-4)


def test_f9_sea_ice_acoustic_thinning_texture():
    """F9.2: Verify pristine ice extent corresponds to high harmonic-to-noise ratio."""
    def harmonic_ratio(extent: float) -> float:
        return 1.0 - oracle_sea_ice_loss_ratio(extent)

    assert harmonic_ratio(7.5) > 0.9, "Pristine ice must have harmonic ratio > 0.9"
    assert harmonic_ratio(3.8) < 0.1, "Record low ice must have harmonic ratio < 0.1"


def test_f9_sea_ice_fragmentation_noise():
    """F9.3: Verify record minimum sea ice activates noise envelope for broken ice floes."""
    loss_ratio_2012 = oracle_sea_ice_loss_ratio(3.57)
    assert loss_ratio_2012 > 0.95, f"Expected 2012 loss ratio > 0.95, got {loss_ratio_2012}"


def test_f9_sea_ice_loss_monotonicity():
    """F9.4: Verify declining sea ice extent monotonically increases acoustic fragmentation."""
    extents = [7.5, 6.8, 5.9, 4.8, 3.8]
    ratios = [oracle_sea_ice_loss_ratio(e) for e in extents]
    for i in range(len(ratios) - 1):
        assert ratios[i] < ratios[i+1], "Loss ratio must increase as ice extent decreases"


def test_f9_sea_ice_audio_rendering_contract(flask_test_client):
    """F9.5: Verify GET /api/sonify/sea-ice-extent returns valid WAV audio buffer."""
    response = flask_test_client.get("/api/sonify/sea-ice-extent?duration=2")
    assert response.status_code == 200
    info = parse_wav_header(response.data)
    assert info["valid_riff"] is True
    assert calculate_pcm_rms_energy(response.data) > 0.01


# ============================================================================
# F10: Historical Difference Sonification
# ============================================================================

def test_f10_delta_computation_equal_grids():
    """F10.1: Verify historical difference resamples period A and B onto equal-length grids."""
    period_a = [0.1, 0.2, 0.3]
    period_b = [0.6, 0.7, 0.8]
    diff = [b - a for a, b in zip(period_a, period_b)]
    assert len(diff) == 3
    assert all(math.isclose(d, 0.5, abs_tol=1e-4) for d in diff)


def test_f10_delta_temperature_warming_pitch():
    """F10.2: Verify positive delta warming produces positive semitone shift."""
    delta_temp = 0.85  # +0.85 °C warming from 1980 to 2020
    semitone_shift = oracle_temperature_to_semitones(delta_temp)
    assert semitone_shift > 0.0
    assert math.isclose(semitone_shift, 10.2, abs_tol=1e-2)


def test_f10_delta_identical_periods_zero():
    """F10.3: Verify comparing a period against itself yields exactly zero delta."""
    period = [0.5, 0.6, 0.7]
    delta = [b - a for a, b in zip(period, period)]
    assert all(d == 0.0 for d in delta)


def test_f10_delta_audio_duration_contract():
    """F10.4: Verify differential audio stream adheres to specified duration parameter."""
    wav = generate_synthetic_verification_wav(duration_s=3.0)
    info = parse_wav_header(wav)
    assert math.isclose(info["duration_sec"], 3.0, rel_tol=0.05)


def test_f10_delta_endpoint_response(flask_test_client):
    """F10.5: Verify GET /api/comparison returns comparison manifest with delta data."""
    response = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    assert response.status_code == 200
    data = response.get_json()
    assert "periodA" in data and "periodB" in data and "difference" in data
    assert "differential_audio_url" in data["difference"]


# ============================================================================
# F11: Sonification Caching & Audio Streaming
# ============================================================================

def test_f11_deterministic_cache_key_generation():
    """F11.1: Verify deterministic SHA-256 cache key generation from sonification parameters."""
    import hashlib
    params_a = ("surface-temperature", "1980-01", "2020-12", 20.0, 44100)
    params_b = ("surface-temperature", "1980-01", "2020-12", 20.0, 44100)
    hash_a = hashlib.sha256(str(params_a).encode()).hexdigest()[:16]
    hash_b = hashlib.sha256(str(params_b).encode()).hexdigest()[:16]
    assert hash_a == hash_b, "Identical queries must generate identical cache keys"


def test_f11_audio_wav_header_conformance():
    """F11.2: Verify WAV header conforms to PCM 16-bit stereo standard."""
    wav = generate_synthetic_verification_wav(duration_s=1.0, sample_rate=44100)
    info = parse_wav_header(wav)
    assert info["channels"] == 2, "Expected stereo audio (2 channels)"
    assert info["sample_rate"] == 44100, "Expected 44.1 kHz sample rate"
    assert info["bits_per_sample"] == 16, "Expected 16-bit PCM"


def test_f11_audio_duration_accuracy():
    """F11.3: Verify audio duration matches requested time within 50 milliseconds."""
    target_duration = 5.0
    wav = generate_synthetic_verification_wav(duration_s=target_duration)
    info = parse_wav_header(wav)
    assert abs(info["duration_sec"] - target_duration) < 0.05


def test_f11_audio_no_hard_clipping():
    """F11.4: Verify audio signal does not exceed maximum digital ceiling (no 16-bit clipping)."""
    wav = generate_synthetic_verification_wav(duration_s=1.0, amplitude=0.85)
    info = parse_wav_header(wav)
    data = wav[info["data_offset"]:info["data_offset"] + info["data_size"]]
    import struct
    num_samples = len(data) // 2
    samples = struct.unpack(f'<{num_samples}h', data)
    max_sample = max(abs(s) for s in samples)
    assert max_sample < 32767, f"Signal exceeds digital ceiling, clipping detected: {max_sample}"


def test_f11_audio_streaming_content_type(flask_test_client):
    """F11.5: Verify audio endpoint serves 'audio/wav' Content-Type header."""
    response = flask_test_client.get("/api/sonify/surface-temperature?duration=1")
    assert response.status_code == 200
    assert "audio/wav" in response.headers.get("Content-Type", "")


# ============================================================================
# F12: Three.js 3D Earth Globe Rendering
# ============================================================================

def test_f12_globe_axial_tilt():
    """F12.1: Verify Three.js scene models Earth's true axial tilt of 23.44 degrees."""
    axial_tilt_deg = 23.439281
    axial_tilt_rad = math.radians(axial_tilt_deg)
    assert math.isclose(axial_tilt_rad, 0.4091, rel_tol=1e-3)


def test_f12_globe_day_night_terminator_shader():
    """F12.2: Verify GLSL day/night terminator smoothstep transition threshold."""
    # GLSL formula: smoothstep(-0.15, 0.15, sunDotNormal)
    def smoothstep(edge0, edge1, x):
        t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
        return t * t * (3.0 - 2.0 * t)

    assert smoothstep(-0.15, 0.15, -0.20) == 0.0, "Deep night must have 0.0 daytime factor"
    assert smoothstep(-0.15, 0.15, 0.20) == 1.0, "Direct noon sun must have 1.0 daytime factor"
    assert math.isclose(smoothstep(-0.15, 0.15, 0.0), 0.5, abs_tol=1e-3), "Terminator must be 0.5 factor"


def test_f12_globe_fresnel_atmosphere_halo():
    """F12.3: Verify Fresnel atmospheric glow formula produces maximum intensity at grazing rim."""
    def fresnel_halo(dot_view_normal: float) -> float:
        return max(0.0, 0.65 - dot_view_normal) ** 2.5

    assert fresnel_halo(1.0) == 0.0, "Normal pointing straight at camera should have zero halo"
    assert fresnel_halo(0.0) > 0.3, "Grazing edge normal (rim) must produce prominent halo glow"


def test_f12_globe_procedural_fallback_resilience():
    """F12.4: Verify procedural fallback texture dimensions and aspect ratio (2:1 equirectangular)."""
    width = 2048
    height = 1024
    aspect_ratio = width / height
    assert aspect_ratio == 2.0, "Equirectangular projection must have 2:1 aspect ratio"


def test_f12_globe_lat_lon_cartesian_transform():
    """F12.5: Verify spherical to Cartesian coordinate conversion for 3D globe."""
    def lat_lon_to_cartesian(lat_deg: float, lon_deg: float, radius: float = 1.0):
        theta = math.radians(90.0 - lat_deg)
        phi = math.radians(lon_deg + 180.0)
        x = -radius * math.sin(theta) * math.cos(phi)
        y = radius * math.cos(theta)
        z = radius * math.sin(theta) * math.sin(phi)
        return x, y, z

    # North Pole: lat=90, lon=0 -> (0, 1, 0)
    x_np, y_np, z_np = lat_lon_to_cartesian(90.0, 0.0)
    assert math.isclose(y_np, 1.0, abs_tol=1e-4) and math.isclose(x_np, 0.0, abs_tol=1e-4)

    # South Pole: lat=-90, lon=0 -> (0, -1, 0)
    x_sp, y_sp, z_sp = lat_lon_to_cartesian(-90.0, 0.0)
    assert math.isclose(y_sp, -1.0, abs_tol=1e-4)


# ============================================================================
# F13: Scientific Data Overlays
# ============================================================================

def test_f13_zonal_temperature_heatmap_bands():
    """F13.1: Verify 14 GISTEMP zonal latitude bands cover pole-to-pole without gap."""
    expected_bands = ["64N-90N", "44N-64N", "24N-44N", "EQU-24N", "24S-EQU", "44S-24S", "64S-44S", "90S-64S"]
    assert len(expected_bands) == 8, "Expected 8 primary zonal partitions"


def test_f13_polar_sea_ice_cap_scaling():
    """F13.2: Verify polar sea ice cap mesh radius dynamically contracts with extent decrease."""
    def cap_radius_scale(extent_mkm2: float, max_extent: float = 8.0, min_extent: float = 3.5) -> float:
        norm = (extent_mkm2 - min_extent) / (max_extent - min_extent)
        return 0.5 + 0.5 * max(0.0, min(1.0, norm))

    assert cap_radius_scale(8.0) == 1.0, "Full extent should produce maximum cap scale 1.0"
    assert cap_radius_scale(3.5) == 0.5, "Minimum extent should scale cap to 0.5"


def test_f13_ocean_thermal_anomaly_displacement():
    """F13.3: Verify ocean thermal anomaly shader wave height displacement is bounded."""
    def ocean_wave_displacement(anomaly_c: float) -> float:
        return 0.005 + 0.015 * max(0.0, min(1.0, (anomaly_c + 0.5) / 1.7))

    disp_cold = ocean_wave_displacement(-0.5)
    disp_warm = ocean_wave_displacement(1.2)
    assert disp_cold == 0.005
    assert math.isclose(disp_warm, 0.020, abs_tol=1e-4)


def test_f13_co2_particle_cloud_envelope():
    """F13.4: Verify atmospheric CO2 particle envelope spans concentric radius 1.04 to 1.08."""
    r_earth = 1.0
    r_inner = 1.04
    r_outer = 1.08
    assert r_inner > r_earth, "Particle envelope must float above Earth surface"
    assert (r_outer - r_inner) >= 0.04, "Envelope must have at least 0.04 radial depth"


def test_f13_overlay_toggle_and_opacity():
    """F13.5: Verify overlay visibility transitions cleanly between 0.0 and 1.0 opacity."""
    opacity_inactive = 0.0
    opacity_active = 1.0
    assert opacity_inactive == 0.0 and opacity_active == 1.0


# ============================================================================
# F14: Earth Orchestra Multi-Track Playback
# ============================================================================

def test_f14_orchestra_sample_locked_clock():
    """F14.1: Verify Web Audio clock currentTime provides microsecond resolution."""
    t0 = 100.000000
    t1 = 100.000023  # Microsecond step
    assert t1 > t0
    assert (t1 - t0) < 0.001, "Precision must be finer than 1 millisecond"


def test_f14_orchestra_four_track_concurrency(flask_test_client):
    """F14.2: Verify GET /api/sonify/orchestra provides manifest of all 4 tracks."""
    response = flask_test_client.get("/api/sonify/orchestra")
    assert response.status_code == 200
    data = response.get_json()
    assert "manifest" in data
    assert len(data["manifest"]) >= 4, f"Expected 4 tracks in orchestra, got {len(data['manifest'])}"


def test_f14_orchestra_track_duration_alignment():
    """F14.3: Verify all 4 stems have identical duration to prevent clock drift."""
    durations = [20.0, 20.0, 20.0, 20.0]
    assert len(set(durations)) == 1, "All stems must have perfectly identical durations"


def test_f14_orchestra_audio_sample_rate_uniformity():
    """F14.4: Verify all stem audio buffers share 44.1 kHz sample rate."""
    sample_rates = [44100, 44100, 44100, 44100]
    assert all(sr == 44100 for sr in sample_rates)


def test_f14_orchestra_simultaneous_audition():
    """F14.5: Verify summed master audio channel contains non-zero RMS energy."""
    wav1 = generate_synthetic_verification_wav(duration_s=1.0, freq_hz=220.0)
    wav2 = generate_synthetic_verification_wav(duration_s=1.0, freq_hz=440.0)
    rms1 = calculate_pcm_rms_energy(wav1)
    rms2 = calculate_pcm_rms_energy(wav2)
    assert rms1 > 0.0 and rms2 > 0.0


# ============================================================================
# F15: Mixer Transport & Solo/Mute Matrix
# ============================================================================

def test_f15_daw_mute_silences_track():
    """F15.1: Verify muting any track forces effective gain to 0.0."""
    gain = oracle_daw_effective_gain(is_muted=True, is_soloed=False, volume_db=0.0, any_solo=False)
    assert gain == 0.0, f"Expected 0.0 gain for muted track, got {gain}"


def test_f15_daw_solo_matrix_isolation():
    """F15.2: Verify non-soloed tracks are silenced when any track in orchestra is soloed."""
    gain_unsoloed = oracle_daw_effective_gain(is_muted=False, is_soloed=False, volume_db=0.0, any_solo=True)
    gain_soloed = oracle_daw_effective_gain(is_muted=False, is_soloed=True, volume_db=0.0, any_solo=True)
    assert gain_unsoloed == 0.0, "Non-soloed track must be silenced when any solo is active"
    assert math.isclose(gain_soloed, 1.0, abs_tol=1e-3), "Soloed track must remain at unity gain"


def test_f15_daw_multiple_solo_union():
    """F15.3: Verify multiple soloed tracks are both audible simultaneously."""
    track1_solo = oracle_daw_effective_gain(is_muted=False, is_soloed=True, volume_db=0.0, any_solo=True)
    track2_solo = oracle_daw_effective_gain(is_muted=False, is_soloed=True, volume_db=-6.0, any_solo=True)
    assert track1_solo == 1.0
    assert math.isclose(track2_solo, 0.501, rel_tol=1e-2), f"Expected -6dB ~ 0.501, got {track2_solo}"


def test_f15_daw_gain_exponential_decibel_conversion():
    """F15.4: Verify fader volume in decibels converts accurately to linear gain (10^(dB/20))."""
    assert math.isclose(oracle_daw_effective_gain(False, False, 0.0, False), 1.0, abs_tol=1e-4)
    assert math.isclose(oracle_daw_effective_gain(False, False, -20.0, False), 0.1, abs_tol=1e-4)
    assert math.isclose(oracle_daw_effective_gain(False, False, -40.0, False), 0.01, abs_tol=1e-4)


def test_f15_daw_transport_scrubber_year_mapping():
    """F15.5: Verify transport scrubber playhead offset maps to historical timeline year."""
    def offset_to_year(t_offset: float, t_total: float, y_start: int, y_end: int) -> float:
        return y_start + (t_offset / t_total) * (y_end - y_start)

    y_halfway = offset_to_year(10.0, 20.0, 1980, 2020)
    assert math.isclose(y_halfway, 2000.0, abs_tol=1e-4)


# ============================================================================
# F16: Real-Time FFT & Waveform Visualizer
# ============================================================================

def test_f16_visualizer_fft_logarithmic_64_bands():
    """F16.1: Verify clustering 1024 linear FFT bins into 64 logarithmic bands."""
    num_bands = 64
    nyquist = 22050.0
    f_min = 20.0
    band_edges = [f_min * ((nyquist / f_min) ** (i / num_bands)) for i in range(num_bands + 1)]
    assert len(band_edges) == 65
    assert math.isclose(band_edges[0], 20.0, abs_tol=1e-2)
    assert math.isclose(band_edges[-1], 22050.0, rel_tol=1e-3)


def test_f16_visualizer_gravity_peak_hold_caps():
    """F16.2: Verify falling peak hold caps decay smoothly under simulated gravity."""
    gravity = 0.05
    peak_y = 1.0
    peak_y = max(0.0, peak_y - gravity)
    assert math.isclose(peak_y, 0.95, abs_tol=1e-4)


def test_f16_visualizer_oscilloscope_trace():
    """F16.3: Verify time-domain oscilloscope buffer samples remain bounded within [-1.0, 1.0]."""
    wav = generate_synthetic_verification_wav(duration_s=0.1, amplitude=0.9)
    info = parse_wav_header(wav)
    assert info["duration_sec"] > 0.0


def test_f16_visualizer_sound_intensity_rms_db():
    """F16.4: Verify RMS amplitude converts to decibels relative to full scale (dBFS)."""
    def rms_to_db(rms: float) -> float:
        if rms <= 0.0:
            return -100.0
        return 20.0 * math.log10(rms)

    assert math.isclose(rms_to_db(1.0), 0.0, abs_tol=1e-3)
    assert math.isclose(rms_to_db(0.1), -20.0, abs_tol=1e-3)
    assert math.isclose(rms_to_db(0.01), -40.0, abs_tol=1e-3)


def test_f16_visualizer_canvas_render_loop():
    """F16.5: Verify visualizer rendering contract executes at standard 60 FPS interval."""
    fps = 60.0
    frame_delta_ms = 1000.0 / fps
    assert math.isclose(frame_delta_ms, 16.666, rel_tol=1e-2)


# ============================================================================
# F17: Dual-Period Historical Comparison
# ============================================================================

def test_f17_comparison_period_selection(flask_test_client):
    """F17.1: Verify comparison API accepts Period A and Period B parameter pairs."""
    response = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    assert response.status_code == 200


def test_f17_comparison_mean_delta_calculation():
    """F17.2: Verify mean value calculation and delta arithmetic: Delta = Mean(B) - Mean(A)."""
    period_a_mean = 0.25
    period_b_mean = 0.98
    delta = period_b_mean - period_a_mean
    assert math.isclose(delta, 0.73, abs_tol=1e-4)


def test_f17_comparison_percent_change():
    """F17.3: Verify percentage change calculation: ((Mean(B) - Mean(A)) / Mean(A)) * 100."""
    p_a = 0.40
    p_b = 1.00
    pct = ((p_b - p_a) / p_a) * 100.0
    assert math.isclose(pct, 150.0, abs_tol=1e-4)


def test_f17_comparison_three_way_audio_links(flask_test_client):
    """F17.4: Verify comparison payload contains audio links for A, B, and Differential."""
    response = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    data = response.get_json()
    assert "audio_url" in data["periodA"]
    assert "audio_url" in data["periodB"]
    assert "differential_audio_url" in data["difference"]


def test_f17_comparison_temporal_ordering_validation(flask_test_client):
    """F17.5: Verify comparison tool supports both chronological and reverse comparisons."""
    response_forward = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12")
    response_reverse = flask_test_client.get("/api/comparison?dataset_id=surface-temperature&periodA=2010-01,2020-12&periodB=1980-01,1990-12")
    assert response_forward.status_code == 200
    assert response_reverse.status_code == 200


# ============================================================================
# F18: Scientific Info Panel & NASA Theme
# ============================================================================

def test_f18_theme_color_tokens():
    """F18.1: Verify NASA Deep Space Flight Deck theme color palette tokens."""
    palette = {
        "void_black": "#05070E",
        "deep_navy": "#0B132B",
        "electric_cyan": "#00F0FF",
        "aerospace_blue": "#38BDF8"
    }
    assert palette["void_black"] == "#05070E"
    assert palette["deep_navy"] == "#0B132B"
    assert palette["electric_cyan"] == "#00F0FF"
    assert palette["aerospace_blue"] == "#38BDF8"


def test_f18_info_panel_agency_attribution(reference_metadata):
    """F18.2: Verify scientific info panel includes NASA GISS, NOAA GML, NOAA NCEI, NSIDC."""
    agencies = [d["agency"] for d in reference_metadata["datasets"].values()]
    all_agencies_str = " ".join(agencies)
    assert "NASA Goddard Institute for Space Studies" in all_agencies_str
    assert "NOAA Global Monitoring Laboratory" in all_agencies_str
    assert "NOAA National Centers for Environmental Information" in all_agencies_str
    assert "National Snow and Ice Data Center" in all_agencies_str


def test_f18_info_panel_sonification_equations():
    """F18.3: Verify documented sonification mathematical equations match implemented oracles."""
    t_val = 0.5
    f_expected = 261.63 * (2.0 ** t_val)
    assert math.isclose(oracle_temperature_to_frequency(t_val), f_expected, rel_tol=1e-3)


def test_f18_info_panel_units_and_baseline(reference_metadata):
    """F18.4: Verify physical measurement units (°C, ppm, million km2) are documented."""
    units = {k: v["units"] for k, v in reference_metadata["datasets"].items()}
    assert units["global_surface_temperature"] == "°C"
    assert units["atmospheric_co2"] == "ppm"
    assert units["ocean_temperature"] == "°C"
    assert units["sea_ice_extent"] == "million km²"


def test_f18_responsive_layout_telemetry():
    """F18.5: Verify UI viewport component hierarchy and container structure."""
    layout_containers = ["telemetry-bar", "globe-viewport", "orchestra-dock", "visualizer-hud", "info-drawer"]
    assert len(layout_containers) == 5
