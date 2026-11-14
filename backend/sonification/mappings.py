"""
backend/sonification/mappings.py
Scientific & Musical Mapping Equations for EARTHSONIC.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Authoritative mathematical formulations linking NASA/NOAA Earth observations
to acoustic synthesis dimensions (pitch, harmonic tension, cutoff sweep, timbre).
"""

from typing import List, Tuple, Dict, Any
import numpy as np


# ============================================================================
# 1. Temperature Sonification Mappings
# ============================================================================

def temperature_to_frequency(anom_c: float, base_hz: float = 261.63) -> float:
    """
    Map surface temperature anomaly (°C relative to 1951-1980 mean) to acoustic frequency in Hz.
    f(T) = base_hz * 2^(anom_c / 1.0)
    At 0.0 °C anomaly: Middle C (C4, 261.63 Hz).
    At +1.0 °C anomaly: Octave higher (C5, 523.26 Hz).
    At -0.85 °C cooling: Descends to ~144.7 Hz (~D3).
    """
    return float(base_hz * (2.0 ** (anom_c / 1.0)))


def temperature_to_semitones(anom_c: float, semitones_per_deg: float = 12.0) -> float:
    """
    Map temperature anomaly to pitch semitone shift from Middle C reference.
    Delta semitones = 12.0 * anom_c (1 octave = 12 semitones per 1.0 °C anomaly).
    """
    return float(semitones_per_deg * anom_c)


# ============================================================================
# 2. Atmospheric CO2 Sonification Mappings
# ============================================================================

def co2_to_frequency(ppm: float, min_ppm: float = 310.0, max_ppm: float = 440.0,
                     min_f: float = 196.0, max_f: float = 783.99) -> float:
    """
    Map Mauna Loa atmospheric CO2 concentration (ppm) to melodic carrier frequency.
    Spans from G3 (196.0 Hz) at 310 ppm to G5 (783.99 Hz) at 440 ppm.
    """
    norm = (ppm - min_ppm) / (max_ppm - min_ppm)
    norm = max(0.0, min(1.0, norm))
    return float(min_f + norm * (max_f - min_f))


def co2_to_semitones(ppm: float, min_ppm: float = 310.0, max_ppm: float = 440.0) -> float:
    """
    Map CO2 concentration to semitone shift relative to G3 baseline.
    G3 (196 Hz) to G5 (784 Hz) is 24 semitones (2 full octaves).
    """
    norm = (ppm - min_ppm) / (max_ppm - min_ppm)
    norm = max(0.0, min(1.0, norm))
    return float(24.0 * norm)


def co2_saturation_metric(ppm: float, baseline: float = 350.0, max_ppm: float = 440.0) -> float:
    """
    Calculates harmonic saturation / tension metric as CO2 exceeds the safe planetary boundary (350 ppm).
    Returns 0.0 below 350 ppm; scales linearly to 1.0 at 440 ppm.
    """
    if ppm <= baseline:
        return 0.0
    return float(min(1.0, (ppm - baseline) / (max_ppm - baseline)))


def co2_to_volume(ppm: float, min_ppm: float = 310.0, max_ppm: float = 440.0,
                  v_min: float = 0.35, v_max: float = 0.95) -> float:
    """
    Map CO2 concentration to dynamic volume intensity [v_min, v_max].
    """
    norm = (ppm - min_ppm) / (max_ppm - min_ppm)
    norm = max(0.0, min(1.0, norm))
    return float(v_min + (v_max - v_min) * (norm ** 0.85))


# ============================================================================
# 3. Ocean Heat & Temperature Mappings
# ============================================================================

def ocean_temp_to_lpf_cutoff(anom_c: float, min_anom: float = -0.60, max_anom: float = 1.20,
                             min_cut: float = 80.0, max_cut: float = 2400.0) -> float:
    """
    Map ocean temperature anomaly to 5th-order Butterworth low-pass filter cutoff in Hz.
    Logarithmic frequency sweep from 80 Hz (muffled sub-bass rumble) to 2400 Hz (bright resonant chord).
    """
    norm = (anom_c - min_anom) / (max_anom - min_anom)
    norm = max(0.0, min(1.0, norm))
    return float(min_cut * ((max_cut / min_cut) ** norm))


# ============================================================================
# 4. Arctic Sea Ice Extent Mappings
# ============================================================================

def sea_ice_loss_ratio(extent_mkm2: float, ref_extent: float = 7.8, min_extent: float = 3.5) -> float:
    """
    Calculate inverted cryospheric loss metric x_loss in [0, 1].
    High ice extent (7.8M km²) -> 0.0 (pristine crystalline stability).
    Low ice extent (3.5M km²) -> 1.0 (fragmented noise, albedo loss).
    """
    norm = (ref_extent - extent_mkm2) / (ref_extent - min_extent)
    return float(max(0.0, min(1.0, norm)))


# ============================================================================
# 5. Differential Historical Comparison
# ============================================================================

def calculate_differential_series(
    series_a: List[float],
    series_b: List[float],
    num_points: int = 300
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Resample time series A and B onto an identical uniform grid of `num_points`
    and compute delta = B - A.
    Returns: (resampled_a, resampled_b, delta)
    """
    arr_a = np.asarray(series_a, dtype=np.float64)
    arr_b = np.asarray(series_b, dtype=np.float64)

    if len(arr_a) == 0 or len(arr_b) == 0:
        raise ValueError("Series A and Series B must be non-empty.")

    x_a = np.linspace(0.0, 1.0, len(arr_a))
    x_b = np.linspace(0.0, 1.0, len(arr_b))
    grid = np.linspace(0.0, 1.0, num_points)

    if len(arr_a) == 1:
        resampled_a = np.full(num_points, arr_a[0])
    else:
        resampled_a = np.interp(grid, x_a, arr_a)

    if len(arr_b) == 1:
        resampled_b = np.full(num_points, arr_b[0])
    else:
        resampled_b = np.interp(grid, x_b, arr_b)

    delta = resampled_b - resampled_a
    return resampled_a, resampled_b, delta


# ============================================================================
# 6. Comprehensive Scientific & Musical Explanations Catalog
# ============================================================================

SONIFICATION_EXPLANATIONS: Dict[str, Dict[str, Any]] = {
    "surface-temperature": {
        "dataset_id": "surface-temperature",
        "title": "Global Surface Temperature Anomaly",
        "nasa_source": "NASA GISS Surface Temperature Analysis (GISTEMP v4)",
        "physical_variable": "Land-Ocean Temperature Anomaly",
        "units": "degrees Celsius (°C)",
        "baseline_reference": "1951-1980 Climatological Mean (0.0°C)",
        "observation_range": "[-0.85°C, +1.50°C]",
        "audio_parameter": "Pitch / Frequency Scaling (Semitone Shift)",
        "synthesis_engine": "STRAUSS Synthesizer with pitch_mapper preset (pure triangle wave)",
        "musical_parameters": {
            "root_note": "Middle C (C4, 261.63 Hz) at 0.0°C anomaly",
            "semitone_scaling": "12 semitones per 1.0°C anomaly (1 octave/°C)",
            "frequency_formula": "f(T) = 261.63 * 2^(T / 1.0) Hz",
            "timbre": "Triangle oscillator provides clear melodic pitch without harsh high harmonics"
        },
        "scientific_rationale": (
            "Human ear sensitivity is logarithmic with respect to frequency, matching the exponential "
            "semitone scale. Sub-zero anomalies descend into a calm, subdued register (~145 Hz, D3), "
            "while record warming anomalies rise past 520 Hz (C5) and above, giving listeners an intuitive "
            "auditory perception of unprecedented global thermal expansion."
        )
    },
    "atmospheric-co2": {
        "dataset_id": "atmospheric-co2",
        "title": "Atmospheric Carbon Dioxide Concentration",
        "nasa_source": "NOAA Global Monitoring Laboratory / Scripps / NASA Vital Signs",
        "physical_variable": "Atmospheric CO2 Mole Fraction",
        "units": "parts per million (ppm)",
        "baseline_reference": "315.7 ppm (March 1958 Keeling Record Inception)",
        "observation_range": "[310.0 ppm, 440.0+ ppm]",
        "audio_parameter": "Melodic Carrier Pitch, Volume Intensity, and Harmonic Saturation",
        "synthesis_engine": "STRAUSS Synthesizer with detuned saw oscillator bank and dynamic saturation",
        "musical_parameters": {
            "carrier_frequency_range": "G3 (196.0 Hz) at 310 ppm to G5 (784.0 Hz) at 440 ppm",
            "planetary_boundary_threshold": "350 ppm",
            "saturation_formula": "Saturation = max(0.0, (ppm - 350.0) / 90.0)",
            "dynamics": "Volume increases monotonically from 0.35 to 0.95 with power-law curve"
        },
        "scientific_rationale": (
            "Carbon dioxide accumulation drives planetary radiative forcing. Below the 350 ppm safe planetary "
            "boundary, the tone is warm and smooth. Crossing 350 ppm injects high detuned sawtooth overtones "
            "creating palpable acoustic tension, while the biospheric seasonal breathing cycle (May peak, "
            "October trough) modulates the amplitude envelope."
        )
    },
    "ocean-temperature": {
        "dataset_id": "ocean-temperature",
        "title": "Global Ocean Heat Content & Sea Surface Temperature",
        "nasa_source": "NOAA NCEI Global Ocean Heat & Temperature Anomalies (0-2000m)",
        "physical_variable": "Ocean Temperature Anomaly / Heat Content",
        "units": "degrees Celsius (°C) anomaly relative to 20th century mean",
        "baseline_reference": "20th Century Mean (1901-2000)",
        "observation_range": "[-0.60°C, +1.20°C]",
        "audio_parameter": "Deep Resonant Bass Chord Voicing & 5th-Order Butterworth LPF Cutoff Sweep",
        "synthesis_engine": "STRAUSS Synthesizer with 4-voice additive chords and LPF1 Butterworth filter sweep",
        "musical_parameters": {
            "chord_voicing": "C2 (65.4 Hz), G2 (98.0 Hz), C3 (130.8 Hz), E3 (164.8 Hz)",
            "filter_type": "5th-order Butterworth low-pass filter (LPF1)",
            "cutoff_range": "80 Hz (muffled sub-bass) up to 2400 Hz (bright, penetrating ocean resonance)",
            "filter_formula": "fc(T) = 80.0 * (2400.0 / 80.0)^norm(T) Hz"
        },
        "scientific_rationale": (
            "Earth's oceans absorb over 90% of excess solar heat trapped by greenhouse gases. This vast thermal "
            "inertia is sonified as an immense, subterranean sub-bass foundation chord. In earlier decades, the "
            "sound is muffled and hidden below 80 Hz. As hundreds of zettajoules of heat build up, the low-pass "
            "filter opens, letting the full resonant harmonics ring out loudly."
        )
    },
    "sea-ice-extent": {
        "dataset_id": "sea-ice-extent",
        "title": "Arctic Sea Ice Minimum Extent",
        "nasa_source": "NOAA / NSIDC Sea Ice Index Version 4 (Passive Microwave Satellite Sensors)",
        "physical_variable": "Northern Hemisphere September Sea Ice Extent",
        "units": "million square kilometers (M km²)",
        "baseline_reference": "1979-1982 Satellite Record Reference (~7.8M km²)",
        "observation_range": "[3.50M km², 7.80M km²]",
        "audio_parameter": "Crystalline Harmonic Chime Crossfade into Granular Noise Texture",
        "synthesis_engine": "STRAUSS Dual-Engine (Chime Synthesizer + windy LPF Noise Generator)",
        "musical_parameters": {
            "loss_metric": "x_loss = clamp((7.8 - extent) / (7.8 - 3.5), 0, 1)",
            "harmonic_voicing": "E5 (659.3 Hz), B5 (987.8 Hz), E6 (1318.5 Hz) pure chimes",
            "noise_preset": "windy preset (low-pass filtered white noise)",
            "crossfade_law": "Harmonic volume = (1 - x_loss), Noise volume = (x_loss)^0.8"
        },
        "scientific_rationale": (
            "Perennial polar sea ice acts as the planetary thermal mirror. Pristine late-1970s ice extent produces "
            "pure, glistening bell-like harmonics. As multi-year ice fragments and retreats toward the historic "
            "2012 record minimum (~3.57M km²), the crystalline tones decay, replaced by turbulent wind noise and "
            "granulated acoustic friction representing open, vulnerable ocean waters."
        )
    },
    "difference": {
        "dataset_id": "difference",
        "title": "Historical Period Differential Sonification",
        "nasa_source": "Comparative NASA Earth Observation Records",
        "physical_variable": "Delta(t) = Period B(t) - Period A(t)",
        "units": "Variable units (relative change)",
        "baseline_reference": "Delta = 0.0 (Identical Climate State)",
        "observation_range": "[-Delta_max, +Delta_max]",
        "audio_parameter": "Differential Pitch Shift and Harmonic Delta",
        "synthesis_engine": "STRAUSS Synthesizer with normalized equal-grid differential processing",
        "musical_parameters": {
            "reference_grid": "300 uniform normalized time points",
            "neutral_pitch": "Unison Middle C (261.63 Hz) at Delta = 0",
            "pitch_shift_formula": "Delta_semitones = 12.0 * Delta_T",
            "auditory_feedback": "Accelerated warming periods produce audible melodic divergence"
        },
        "scientific_rationale": (
            "Differential sonification audifies the exact rate of climate change between two user-selected "
            "eras (e.g. 1980-2000 vs 2000-2020). Comparing identical periods produces total unison/neutrality, "
            "while historical acceleration immediately reveals where and how rapidly the planetary balance shifted."
        )
    }
}
