"""
backend/sonification/engine.py
Core STRAUSS Sonification Engine & Deterministic Audio Cache for EARTHSONIC.
NASA Space Apps Challenge 2026: "The Earth Information Jukebox"

Renders authentic NASA Earth science observations into 44.1 kHz stereo WAV audio
using STRAUSS (v1.0.3) Synthesizer, Objects, and Score.
"""

import os
import json
import hashlib
from typing import Dict, Any, Optional, Tuple, List
import numpy as np
import scipy.signal

# STRAUSS 1.0.3 core imports
from strauss.sonification import Sonification
from strauss.sources import Objects
from strauss.score import Score
from strauss.generator import Synthesizer

from backend.config import Config
from backend.sonification.mappings import (
    temperature_to_semitones,
    co2_to_semitones,
    co2_to_volume,
    co2_saturation_metric,
    ocean_temp_to_lpf_cutoff,
    sea_ice_loss_ratio,
    calculate_differential_series,
)

# NASA Psychoacoustic D Dorian / Lydian scale frequencies (220 Hz - 880 Hz)
D_DORIAN_LYDIAN_SCALE = np.array([
    220.0, 246.94, 277.18, 293.66, 329.63, 369.99,
    440.0, 493.88, 554.37, 587.33, 659.25, 739.99, 880.0
])


# Canonical dataset ID mappings
CANONICAL_DATASET_MAP = {
    # Surface Temperature
    "surface-temperature": "surface-temperature",
    "surface_temperature": "surface-temperature",
    "global_surface_temperature": "surface-temperature",
    "temperature": "surface-temperature",
    "temp": "surface-temperature",
    "gistemp": "surface-temperature",
    "nasa_giss_gistemp_v4": "surface-temperature",

    # Atmospheric CO2
    "atmospheric-co2": "atmospheric-co2",
    "atmospheric_co2": "atmospheric-co2",
    "co2": "atmospheric-co2",
    "carbon_dioxide": "atmospheric-co2",
    "keeling": "atmospheric-co2",
    "noaa_gml_mauna_loa_co2": "atmospheric-co2",

    # Ocean Temperature
    "ocean-temperature": "ocean-temperature",
    "ocean_temperature": "ocean-temperature",
    "ocean_temp": "ocean-temperature",
    "ocean": "ocean-temperature",
    "noaa_ncei_global_ocean_temp": "ocean-temperature",

    # Sea Ice Extent
    "sea-ice-extent": "sea-ice-extent",
    "sea_ice_extent": "sea-ice-extent",
    "sea_ice": "sea-ice-extent",
    "ice": "sea-ice-extent",
    "arctic_sea_ice": "sea-ice-extent",
    "nsidc_sea_ice_index_v4": "sea_ice_extent",
}

# Harmonized JSON property lookup
DATASET_PROPERTY_MAP = {
    "surface-temperature": "temperature_anomaly",
    "atmospheric-co2": "co2_ppm",
    "ocean-temperature": "ocean_temp_anomaly",
    "sea-ice-extent": "sea_ice_extent",
}


class SonificationEngine:
    """
    STRAUSS 1.0.3 Scientific Audio Sonification Engine.
    Manages data ingestion, synthesis pipelines, and SHA-256 disk caching.
    """

    def __init__(self, cache_dir: Optional[str] = None, data_path: Optional[str] = None):
        self.cache_dir = cache_dir or Config.AUDIO_CACHE_DIR
        self.data_path = data_path or Config.HARMONIZED_PATH
        os.makedirs(self.cache_dir, exist_ok=True)
        self._harmonized_data: Optional[Dict[str, Any]] = None

    def _load_data(self) -> Dict[str, Any]:
        """Loads processed harmonized dataset."""
        if self._harmonized_data is None:
            if not os.path.exists(self.data_path):
                raise FileNotFoundError(f"Processed dataset not found at {self.data_path}")
            with open(self.data_path, "r", encoding="utf-8") as f:
                self._harmonized_data = json.load(f)
        return self._harmonized_data

    @staticmethod
    def canonical_id(dataset_id: str) -> Optional[str]:
        """Normalize dataset identifier to canonical key."""
        return CANONICAL_DATASET_MAP.get(dataset_id.strip().lower())

    def get_timeseries_slice(self, dataset_id: str,
                             start: Optional[str] = None,
                             end: Optional[str] = None) -> Tuple[List[str], np.ndarray]:
        """
        Extract timeseries slice for a given dataset and date window.
        Returns: (months_list, values_array)
        """
        canon = self.canonical_id(dataset_id)
        if not canon:
            raise ValueError(f"Unknown dataset '{dataset_id}'")

        data = self._load_data()
        months = data["months"]
        prop_key = DATASET_PROPERTY_MAP[canon]
        values = data[prop_key]

        start_idx = 0
        end_idx = len(months)

        if start:
            # First month >= start
            for i, m in enumerate(months):
                if m >= start:
                    start_idx = i
                    break
        if end:
            # Last month <= end
            for i in range(len(months) - 1, -1, -1):
                if months[i] <= end:
                    end_idx = i + 1
                    break

        if start_idx >= end_idx:
            # If dates out of range or inverted, clamp safely
            start_idx = max(0, min(start_idx, len(months) - 1))
            end_idx = min(len(months), start_idx + 1)

        sliced_months = months[start_idx:end_idx]
        sliced_values = np.asarray(values[start_idx:end_idx], dtype=np.float64)

        # Ensure at least 2 points for smooth time-evolution interpolation
        if len(sliced_values) == 1:
            sliced_values = np.array([sliced_values[0], sliced_values[0]])
            sliced_months = [sliced_months[0], sliced_months[0]]

        return sliced_months, sliced_values

    def compute_cache_key(self, dataset_id: str, start: Optional[str],
                          end: Optional[str], duration: float,
                          sample_rate: int = 44100, extra: str = "") -> str:
        """Deterministic SHA-256 hash for query parameters."""
        raw = f"{dataset_id}|{start or ''}|{end or ''}|{duration:.2f}|{sample_rate}|{extra}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get_cached_path(self, cache_key: str) -> str:
        """Get absolute path to cached WAV file."""
        return os.path.join(self.cache_dir, f"{cache_key}.wav")

    def sonify_dataset(self, dataset_id: str,
                       start: Optional[str] = None,
                       end: Optional[str] = None,
                       duration: float = 20.0,
                       sample_rate: int = 44100) -> str:
        """
        Main entry point for single-dataset sonification.
        Returns: absolute path to 44.1 kHz stereo WAV file.
        """
        canon = self.canonical_id(dataset_id)
        if not canon:
            raise ValueError(f"Unknown dataset ID '{dataset_id}'")

        duration = max(1.0, min(60.0, float(duration)))
        cache_key = self.compute_cache_key(canon, start, end, duration, sample_rate)
        cached_path = self.get_cached_path(cache_key)

        if os.path.exists(cached_path) and os.path.getsize(cached_path) > 44:
            return cached_path

        # Generate audio using appropriate STRAUSS pipeline
        months, values = self.get_timeseries_slice(canon, start, end)

        if canon == "surface-temperature":
            self._render_temperature(values, duration, sample_rate, cached_path)
        elif canon == "atmospheric-co2":
            self._render_co2(values, duration, sample_rate, cached_path)
        elif canon == "ocean-temperature":
            self._render_ocean_temperature(values, duration, sample_rate, cached_path)
        elif canon == "sea-ice-extent":
            self._render_sea_ice(values, duration, sample_rate, cached_path)
        else:
            raise ValueError(f"No renderer implemented for '{canon}'")

        return cached_path

    # ========================================================================
    # Specific STRAUSS Synthesizer Render Pipelines
    # ========================================================================

    def _render_temperature(self, values: np.ndarray, duration: float,
                            sample_rate: int, output_path: str):
        """
        Surface Temperature Sonification (NASA Psychoacoustic Standard):
        - Scale: Quantized to harmonic D Dorian / Lydian scale (220 Hz - 880 Hz).
        - Timbre: Warm FM plucked string + bowed cello pad timbre.
        - Pulse: Subtle 12-month seasonal sinusoidal amplitude/frequency pulse.
        """
        time_grid = np.linspace(0.0, 1.0, len(values))

        # Map temperature anomaly around Middle C (261.63 Hz) and quantize to D Dorian / Lydian scale
        f_continuous = np.clip(261.63 * (2.0 ** values), 220.0, 880.0)
        quantized_freqs = np.array([
            D_DORIAN_LYDIAN_SCALE[np.argmin(np.abs(D_DORIAN_LYDIAN_SCALE - f))]
            for f in f_continuous
        ])

        # Semitone shifts relative to Score base note A3 (220.0 Hz)
        semitone_shifts = 12.0 * np.log2(quantized_freqs / 220.0)

        # Subtle 12-month seasonal sinusoidal amplitude/frequency pulse
        month_indices = np.arange(len(values))
        seasonal_pulse = 1.0 + 0.10 * np.sin(2.0 * np.pi * month_indices / 12.0)
        volumes = np.clip(0.80 * seasonal_pulse, 0.2, 1.0)

        score = Score([['A3']], duration)
        synth = Synthesizer(samprate=sample_rate)
        synth.load_preset('default')

        # Warm FM plucked string + bowed cello pad timbre
        synth.preset['oscillators'] = {
            'osc1': {'form': 'tri', 'level': 0.65, 'detune': 0.0, 'phase': 0.0},
            'osc2': {'form': 'saw', 'level': 0.35, 'detune': 0.12, 'phase': 0.25},
            'osc3': {'form': 'sine', 'level': 0.30, 'detune': -0.08, 'phase': 0.50}
        }
        synth.preset['filter'] = 'on'
        synth.preset['filter_type'] = 'LPF1'
        synth.preset['cutoff'] = 0.68

        src = Objects(['pitch', 'pitch_shift', 'volume', 'time_evo'])
        src.fromdict({
            'pitch': 0.5,
            'pitch_shift': semitone_shifts,
            'volume': volumes,
            'time_evo': time_grid
        })
        src.apply_mapping_functions(
            map_lims={'pitch_shift': (0.0, 24.0), 'volume': (0.0, 1.0)},
            param_lims={'pitch_shift': (0.0, 24.0), 'volume': (0.0, 1.0)}
        )

        soni = Sonification(score, src, synth, audio_setup='stereo', samprate=sample_rate)
        soni.render()
        soni.save_stereo(output_path)

    def _render_co2(self, values: np.ndarray, duration: float,
                    sample_rate: int, output_path: str):
        """
        Atmospheric CO2 Sonification (NASA Psychoacoustic Standard):
        - Fundamental: 110 Hz warm analog brass/organ drone.
        - Seasonal Breathing: Breaths with annual Mauna Loa cycle.
        - Saturation: Smoothly increasing harmonic saturation/waveshaping above 350 ppm and 400 ppm.
        """
        time_grid = np.linspace(0.0, 1.0, len(values))

        # Melodic shift: baseline 310 ppm -> 0 semitones (110 Hz fundamental), 440 ppm -> 24 semitones
        semitone_shifts = np.clip((values - 310.0) * (24.0 / 130.0), 0.0, 24.0)

        # Annual Mauna Loa breathing cycle (peaking in May / month 5, ~6 ppm natural oscillation)
        month_indices = np.arange(len(values))
        annual_breath = 1.0 + 0.12 * np.sin(2.0 * np.pi * (month_indices - 4) / 12.0)
        base_volumes = np.array([co2_to_volume(v) for v in values])
        volumes = np.clip(base_volumes * annual_breath, 0.25, 0.95)

        # Smooth multi-stage harmonic saturation above 350 ppm and 400 ppm thresholds
        mean_ppm = float(np.mean(values))
        sat_350 = float(np.clip((mean_ppm - 350.0) / 50.0, 0.0, 1.0))
        sat_400 = float(np.clip((mean_ppm - 400.0) / 30.0, 0.0, 1.0))
        sat = float(0.60 * sat_350 + 0.40 * sat_400)

        score = Score([['A2']], duration) # 110 Hz fundamental
        synth = Synthesizer(samprate=sample_rate)
        synth.load_preset('default')

        # Warm multi-voice analog brass/organ drone with saturation injection
        synth.preset['oscillators'] = {
            'osc1': {'form': 'saw', 'level': max(0.3, 0.85 - 0.35 * sat), 'detune': 0.0, 'phase': 0.0},
            'osc2': {'form': 'saw', 'level': 0.35 + 0.45 * sat, 'detune': 0.18 + 0.22 * sat, 'phase': 0.25},
            'osc3': {'form': 'square', 'level': 0.20 + 0.50 * sat, 'detune': -0.18 - 0.22 * sat, 'phase': 0.50}
        }
        synth.preset['filter'] = 'on'
        synth.preset['filter_type'] = 'LPF1'
        synth.preset['cutoff'] = float(np.clip(0.52 + 0.40 * sat, 0.25, 0.95))

        src = Objects(['pitch', 'pitch_shift', 'volume', 'time_evo'])
        src.fromdict({
            'pitch': 0.5,
            'pitch_shift': semitone_shifts,
            'volume': volumes,
            'time_evo': time_grid
        })
        src.apply_mapping_functions(
            map_lims={'pitch_shift': (0.0, 24.0), 'volume': (0.0, 1.0)},
            param_lims={'pitch_shift': (0.0, 24.0), 'volume': (0.0, 1.0)}
        )

        soni = Sonification(score, src, synth, audio_setup='stereo', samprate=sample_rate)
        soni.render()
        soni.save_stereo(output_path)

    def _render_ocean_temperature(self, values: np.ndarray, duration: float,
                                  sample_rate: int, output_path: str):
        """
        Ocean Heat Content Sonification (NASA Psychoacoustic Standard):
        - Timbre: Deep NOAA-hydrophone-inspired sub-bass swell (36 Hz - 130 Hz).
        - Filter: 24 dB/oct Butterworth low-pass filter sweep.
        """
        # Voicing in sub-bass range 36 Hz to 130 Hz: D1 (36.7 Hz), A1 (55.0 Hz), D2 (73.4 Hz), C3 (130.8 Hz)
        chord = [['D1', 'A1', 'D2', 'C3']]
        time_grid = np.linspace(0.0, 1.0, len(values))

        # Compute cutoff frequencies in Hz, then normalize to STRAUSS log scale
        cutoffs_hz = np.array([ocean_temp_to_lpf_cutoff(v) for v in values])
        flo, fhi = 20.0, 22050.0
        lflo, lfhi = np.log10(flo), np.log10(fhi)
        fmap_vals = (np.log10(cutoffs_hz) - lflo) / (lfhi - lflo)
        fmap_vals = np.clip(fmap_vals, 0.05, 0.95)

        score = Score(chord, duration)
        synth = Synthesizer(samprate=sample_rate)
        synth.load_preset('default')

        # Hydrophone sub-bass timbre: rich sub fundamental + resonant body
        synth.preset['oscillators'] = {
            'osc1': {'form': 'sine', 'level': 0.75, 'detune': 0.0, 'phase': 0.0},
            'osc2': {'form': 'tri', 'level': 0.45, 'detune': 0.04, 'phase': 0.20},
            'osc3': {'form': 'saw', 'level': 0.25, 'detune': -0.04, 'phase': 0.50}
        }
        synth.preset['filter'] = 'on'
        synth.preset['filter_type'] = 'LPF1'

        n_voices = 4
        src = Objects(['pitch', 'cutoff', 'time_evo'])
        src.fromdict({
            'pitch': [0.0, 0.33, 0.66, 0.99],
            'cutoff': [fmap_vals] * n_voices,
            'time_evo': [time_grid] * n_voices
        })
        src.apply_mapping_functions(
            map_lims={'cutoff': (0.0, 1.0)},
            param_lims={'cutoff': (0.0, 1.0)}
        )

        soni = Sonification(score, src, synth, audio_setup='stereo', samprate=sample_rate)
        soni.render()

        # Apply 24 dB/octave (4th-order) Butterworth low-pass filter
        mean_cutoff = float(np.clip(np.mean(cutoffs_hz), 80.0, 2400.0))
        sos = scipy.signal.butter(4, mean_cutoff, btype='lowpass', fs=sample_rate, output='sos')
        for c in ['0', '1']:
            soni.out_channels[c].values = scipy.signal.sosfilt(sos, soni.out_channels[c].values)

        soni.save_stereo(output_path)

    def _render_sea_ice(self, values: np.ndarray, duration: float,
                        sample_rate: int, output_path: str):
        """
        Sea Ice Extent Sonification (NASA Psychoacoustic Standard):
        - Timbre: High-register crystalline bell inharmonics (1200 Hz - 4200 Hz) when ice extent is high.
        - Crossfade: Formant-filtered polar wind noise as extent drops toward 4.0 M km².
        """
        time_grid = np.linspace(0.0, 1.0, len(values))
        loss_ratios = np.array([sea_ice_loss_ratio(v) for v in values])

        # Layer 1: Crystalline bell inharmonics across 1200 Hz - 4200 Hz:
        # D6 (~1175 Hz), G6 (~1568 Hz), B6 (~1975 Hz), F#7 (~2960 Hz), C8 (~4186 Hz)
        chord_bells = [['D6', 'G6', 'B6', 'F#7', 'C8']]
        n_bell_voices = 5

        # Chime volume crossfades down as ice extent drops toward 4.0 M km²
        chime_volumes = np.clip(1.0 - (loss_ratios ** 1.3), 0.02, 0.98)
        score_chime = Score(chord_bells, duration)
        synth_chime = Synthesizer(samprate=sample_rate)
        synth_chime.load_preset('default')

        # Crystalline bell inharmonics
        synth_chime.preset['oscillators'] = {
            'osc1': {'form': 'sine', 'level': 0.65, 'detune': 0.0, 'phase': 0.0},
            'osc2': {'form': 'sine', 'level': 0.45, 'detune': 0.28, 'phase': 0.30},
            'osc3': {'form': 'tri', 'level': 0.35, 'detune': -0.32, 'phase': 0.60}
        }

        src_chime = Objects(['pitch', 'volume', 'time_evo'])
        src_chime.fromdict({
            'pitch': [0.0, 0.25, 0.50, 0.75, 1.0],
            'volume': [chime_volumes] * n_bell_voices,
            'time_evo': [time_grid] * n_bell_voices
        })
        src_chime.apply_mapping_functions(
            map_lims={'volume': (0.0, 1.0)},
            param_lims={'volume': (0.0, 1.0)}
        )
        soni_chime = Sonification(score_chime, src_chime, synth_chime, audio_setup='stereo', samprate=sample_rate)
        soni_chime.render()

        # Layer 2: Formant-filtered polar wind noise (surges near 4.0 M km²)
        noise_volumes = np.clip(loss_ratios ** 0.8, 0.05, 0.95)
        noise_cutoffs = np.clip(0.15 + 0.65 * loss_ratios, 0.10, 0.90)

        score_noise = Score([['C4']], duration)
        synth_noise = Synthesizer(samprate=sample_rate)
        synth_noise.load_preset('windy')

        src_noise = Objects(['pitch', 'cutoff', 'volume', 'time_evo'])
        src_noise.fromdict({
            'pitch': 0.5,
            'cutoff': noise_cutoffs,
            'volume': noise_volumes,
            'time_evo': time_grid
        })
        src_noise.apply_mapping_functions(
            map_lims={'cutoff': (0.0, 1.0), 'volume': (0.0, 1.0)},
            param_lims={'cutoff': (0.0, 1.0), 'volume': (0.0, 1.0)}
        )
        soni_noise = Sonification(score_noise, src_noise, synth_noise, audio_setup='stereo', samprate=sample_rate)
        soni_noise.render()

        # Combine crystalline bell and polar wind layers into output channels
        for c in ['0', '1']:
            soni_chime.out_channels[c].values += soni_noise.out_channels[c].values

        soni_chime.save_stereo(output_path)

    # ========================================================================
    # Differential Sonification
    # ========================================================================

    def sonify_differential(self, dataset_id: str,
                            period_a: Tuple[str, str],
                            period_b: Tuple[str, str],
                            duration: float = 15.0,
                            sample_rate: int = 44100) -> str:
        """
        Differential Sonification: Delta(t) = Period_B(t) - Period_A(t).
        Resamples both time windows onto a 300-point uniform grid and audifies delta.
        Returns: absolute path to differential stereo WAV.
        """
        canon = self.canonical_id(dataset_id)
        if not canon:
            raise ValueError(f"Unknown dataset ID '{dataset_id}'")

        duration = max(1.0, min(60.0, float(duration)))
        p_a_str = f"{period_a[0]}:{period_a[1]}"
        p_b_str = f"{period_b[0]}:{period_b[1]}"
        cache_key = self.compute_cache_key(f"diff_{canon}", p_a_str, p_b_str, duration, sample_rate)
        cached_path = self.get_cached_path(cache_key)

        if os.path.exists(cached_path) and os.path.getsize(cached_path) > 44:
            return cached_path

        # Fetch series for both periods
        _, vals_a = self.get_timeseries_slice(canon, period_a[0], period_a[1])
        _, vals_b = self.get_timeseries_slice(canon, period_b[0], period_b[1])

        # Compute resampled differential
        _, _, delta = calculate_differential_series(vals_a.tolist(), vals_b.tolist(), num_points=300)

        # Sonify delta using Middle C baseline and pitch_mapper
        time_grid = np.linspace(0.0, 1.0, len(delta))

        if canon == "surface-temperature":
            # 12 semitones per °C of delta
            semitone_shifts = np.array([temperature_to_semitones(d) for d in delta])
        elif canon == "atmospheric-co2":
            # Delta ppm mapped to pitch shift (e.g. +30 ppm delta -> +5 semitones)
            semitone_shifts = np.clip(delta * (24.0 / 100.0), -24.0, 24.0)
        elif canon == "ocean-temperature":
            # 12 semitones per °C ocean delta
            semitone_shifts = np.array([12.0 * d for d in delta])
        elif canon == "sea-ice-extent":
            # Sea ice loss (negative delta = ice loss -> positive urgency pitch)
            semitone_shifts = np.clip(-delta * 4.0, -24.0, 24.0)
        else:
            semitone_shifts = np.clip(delta, -24.0, 24.0)

        score = Score([['C4']], duration)
        synth = Synthesizer(samprate=sample_rate)
        synth.load_preset('pitch_mapper')

        src = Objects(['pitch', 'pitch_shift', 'time_evo'])
        src.fromdict({
            'pitch': 0.5,
            'pitch_shift': semitone_shifts,
            'time_evo': time_grid
        })
        src.apply_mapping_functions(
            map_lims={'pitch_shift': (-24.0, 24.0)},
            param_lims={'pitch_shift': (-24.0, 24.0)}
        )

        soni = Sonification(score, src, synth, audio_setup='stereo', samprate=sample_rate)
        soni.render()
        soni.save_stereo(cached_path)

        return cached_path

    # ========================================================================
    # Orchestra Manifest & Pre-generation
    # ========================================================================

    def get_orchestra_manifest(
        self,
        start: Optional[str] = None,
        end: Optional[str] = None,
        duration: float = 20.0
    ) -> Dict[str, Any]:
        """
        Generate manifest of synchronized audio tracks for the 4 core variables.
        """
        duration = max(1.0, min(60.0, float(duration)))
        params = f"?duration={duration:.0f}"
        if start:
            params += f"&start={start}"
        if end:
            params += f"&end={end}"

        return {
            "manifest": {
                "surface_temperature": f"/api/sonify/surface-temperature{params}",
                "atmospheric_co2": f"/api/sonify/atmospheric-co2{params}",
                "ocean_temperature": f"/api/sonify/ocean-temperature{params}",
                "sea_ice_extent": f"/api/sonify/sea-ice-extent{params}"
            },
            "synchronized_duration_sec": duration,
            "sample_rate": 44100,
            "layers_count": 4,
            "time_range": {
                "start": start or "1979-01",
                "end": end or "2026-09"
            }
        }

    def pregenerate_baselines(self, duration: float = 20.0):
        """
        Pre-render standard 20-second tracks for all 4 variables to ensure
        zero-latency playback on startup.
        """
        for var in ["surface-temperature", "atmospheric-co2", "ocean-temperature", "sea-ice-extent"]:
            try:
                self.sonify_dataset(var, duration=duration)
            except Exception as e:
                print(f"Warning: Failed to pregenerate baseline track for {var}: {e}")


# Global default engine instance
default_engine = SonificationEngine()
