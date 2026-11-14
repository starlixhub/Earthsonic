"""
backend/sonification
STRAUSS Scientific Sonification Package for EARTHSONIC.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
"""

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
from backend.sonification.engine import SonificationEngine

__all__ = [
    "temperature_to_frequency",
    "temperature_to_semitones",
    "co2_to_frequency",
    "co2_to_semitones",
    "co2_saturation_metric",
    "co2_to_volume",
    "ocean_temp_to_lpf_cutoff",
    "sea_ice_loss_ratio",
    "calculate_differential_series",
    "SONIFICATION_EXPLANATIONS",
    "SonificationEngine",
]
