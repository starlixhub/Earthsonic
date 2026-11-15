"""
backend/sonification/image_sonifier.py
NASA SVS/EIC Visual-to-Audio Feature Extraction & Original Synthesis Engine.
Part of EARTHSONIC — NASA Space Apps Challenge 2026: "The Earth Information Jukebox".

Converts authentic NASA SVS scientific visual assets into:
  1. Equirectangular 720x360 normalized [0.0, 1.0] column metrics:
     - luminance: ITU-R BT.601 weighted perceived brightness
     - hue: active-pixel average HSV hue divided by 360.0
     - density: active pixel ratio (intensity > 0.02)
     - vertical_centroid: normalized latitude center of gravity from South (0.0) to North (1.0)
  2. Layer-specific features:
     - night_lights: 2012 vs 2023 signed delta and positive delta
     - lightning: discrete event hotspot coordinates, intensity, and timing
     - gedi_forest: column mean canopy height and height variance
     - co2_dyamond: column concentration and harmonic brightness
  3. Original 44.1 kHz 16-bit PCM stereo WAV sonification synthesis.
"""

import hashlib
import io
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
import wave

import numpy as np
from PIL import Image


# Equirectangular standard grid resolution
GRID_WIDTH = 720
GRID_HEIGHT = 360

# Pentatonic scale semitone ratios for modal pitch mapping
PENTATONIC_INTERVALS = [0, 2, 4, 7, 9]  # Major pentatonic degrees


class ImageSonifier:
    """Core image feature extraction engine for NASA SVS/EIC layers."""

    def __init__(self, target_shape: Tuple[int, int] = (GRID_WIDTH, GRID_HEIGHT)):
        self.target_width = target_shape[0]
        self.target_height = target_shape[1]
        self.synthesizer = LayerAudioSynthesizer()

    def resize_to_grid(
        self,
        image: Union[Image.Image, np.ndarray, str, Path],
        target_shape: Optional[Tuple[int, int]] = None
    ) -> np.ndarray:
        """
        Resizes an input image to equirectangular grid (width=720, height=360).
        Returns numpy array of shape (height, width, 3) in uint8 RGB format.
        """
        width = target_shape[0] if target_shape else self.target_width
        height = target_shape[1] if target_shape else self.target_height

        if isinstance(image, (str, Path)):
            pil_img = Image.open(image).convert("RGB")
        elif isinstance(image, np.ndarray):
            if image.ndim == 2:
                pil_img = Image.fromarray(image).convert("RGB")
            elif image.ndim == 3:
                if image.shape[2] == 4:
                    pil_img = Image.fromarray(image).convert("RGB")
                else:
                    pil_img = Image.fromarray(image[:, :, :3].astype(np.uint8), mode="RGB")
            else:
                raise ValueError(f"Invalid numpy image shape: {image.shape}")
        elif isinstance(image, Image.Image):
            pil_img = image.convert("RGB")
        else:
            raise TypeError(f"Unsupported image type: {type(image)}")

        # High-quality equirectangular resampling
        resized = pil_img.resize((width, height), resample=Image.Resampling.LANCZOS)
        return np.array(resized, dtype=np.uint8)

    def resize_frame(self, image: Union[Image.Image, np.ndarray, str, Path]) -> np.ndarray:
        """Alias for resize_to_grid with default 720x360 dimensions."""
        return self.resize_to_grid(image)

    def extract_column_metrics(self, grid: np.ndarray) -> List[Dict[str, Any]]:
        """
        Extracts per-column normalized metrics in [0.0, 1.0] across all columns.
        
        Metrics:
          - luminance: ITU-R BT.601 weighted brightness (0.299R + 0.587G + 0.114B) / 255
          - hue: active-pixel average HSV hue divided by 360.0 (0.0 for achromatic)
          - density: proportion of vertical pixels with intensity > 0.02
          - vertical_centroid: normalized center of mass from South (0.0) to North (1.0),
            defaulting to 0.5 (equator neutral) on zero intensity.
        """
        if grid.ndim != 3 or grid.shape[2] < 3:
            raise ValueError(f"Expected grid with 3 channels (H, W, 3), got shape {grid.shape}")

        height, width = grid.shape[:2]
        r = grid[:, :, 0].astype(np.float64)
        g = grid[:, :, 1].astype(np.float64)
        b = grid[:, :, 2].astype(np.float64)

        # 1. ITU-R BT.601 Luminance
        # Y = 0.299*R + 0.587*G + 0.114*B in [0.0, 1.0]
        y_pixel = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
        y_pixel = np.clip(y_pixel, 0.0, 1.0)
        col_luminance = np.mean(y_pixel, axis=0)

        # 2. Pixel Density: fraction of pixels with perceived intensity > 0.02
        active_mask = y_pixel > 0.02
        col_density = np.mean(active_mask.astype(np.float64), axis=0)

        # 3. Vertical Centroid:
        # Latitude coordinate mapping:
        # Row 0 = North Pole (+90° lat) -> weight = 1.0
        # Row height-1 = South Pole (-90° lat) -> weight = 0.0
        row_indices = np.arange(height, dtype=np.float64)
        if height > 1:
            row_weights = 1.0 - (row_indices / (height - 1.0))
        else:
            row_weights = np.array([0.5])

        # Weighted intensity sums per column
        col_sums = np.sum(y_pixel, axis=0)
        weighted_sums = np.dot(row_weights, y_pixel)

        col_centroids = np.zeros(width, dtype=np.float64)
        for c in range(width):
            if col_sums[c] < 1e-7:
                col_centroids[c] = 0.5  # Neutral equator fallback on zero intensity
            else:
                col_centroids[c] = weighted_sums[c] / col_sums[c]

        # 4. Column Hue:
        # Compute HSV hue for active chromatic pixels; achromatic/black defaults to 0.0
        c_max = np.maximum(np.maximum(r, g), b)
        c_min = np.minimum(np.minimum(r, g), b)
        delta = c_max - c_min

        # Chromatic threshold: delta >= 10 and c_max >= 15
        chromatic_mask = (delta >= 10.0) & (c_max >= 15.0)

        hues = np.zeros((height, width), dtype=np.float64)
        # Vectorized hue computation where delta > 0
        non_zero_delta = delta > 0.0
        
        # Red max
        mask_r = (c_max == r) & non_zero_delta
        hues[mask_r] = 60.0 * (((g[mask_r] - b[mask_r]) / delta[mask_r]) % 6.0)

        # Green max
        mask_g = (c_max == g) & (c_max != r) & non_zero_delta
        hues[mask_g] = 60.0 * (((b[mask_g] - r[mask_g]) / delta[mask_g]) + 2.0)

        # Blue max
        mask_b = (c_max == b) & (c_max != r) & (c_max != g) & non_zero_delta
        hues[mask_b] = 60.0 * (((r[mask_b] - g[mask_b]) / delta[mask_b]) + 4.0)

        # Normalize hue to [0.0, 1.0]
        hues_norm = (hues % 360.0) / 360.0

        col_hues = np.zeros(width, dtype=np.float64)
        for c in range(width):
            col_chroma = chromatic_mask[:, c]
            if np.any(col_chroma):
                col_hues[c] = np.mean(hues_norm[col_chroma, c])
            else:
                col_hues[c] = 0.0

        # Assemble per-column metrics
        columns = []
        for c in range(width):
            lon = -180.0 + c * (360.0 / width)
            columns.append({
                "col_index": c,
                "lon": round(float(lon), 4),
                "luminance": round(float(np.clip(col_luminance[c], 0.0, 1.0)), 6),
                "hue": round(float(np.clip(col_hues[c], 0.0, 1.0)), 6),
                "density": round(float(np.clip(col_density[c], 0.0, 1.0)), 6),
                "vertical_centroid": round(float(np.clip(col_centroids[c], 0.0, 1.0)), 6),
                "layer_features": {}
            })

        return columns

    def extract_night_lights_diff(
        self,
        grid_2012: np.ndarray,
        grid_2023: np.ndarray
    ) -> List[Dict[str, Any]]:
        """
        Computes signed difference and positive electrification delta between 2012 and 2023.
        """
        cols_2012 = self.extract_column_metrics(grid_2012)
        cols_2023 = self.extract_column_metrics(grid_2023)

        diffs = []
        for c in range(len(cols_2012)):
            l12 = cols_2012[c]["luminance"]
            l23 = cols_2023[c]["luminance"]
            delta = l23 - l12
            diffs.append({
                "col_index": c,
                "lon": cols_2012[c]["lon"],
                "signed_diff": round(float(delta), 6),
                "diff": round(float(delta), 6),
                "positive_diff": round(float(max(0.0, delta)), 6),
                "luminance_2012": l12,
                "luminance_2023": l23,
            })
        return diffs

    def extract_lightning_events(
        self,
        grid: np.ndarray,
        threshold: float = 0.65
    ) -> List[Dict[str, Any]]:
        """
        Detects discrete lightning strike hotspots above intensity threshold.
        Returns list of events with lon, lat, intensity, time, col_index.
        """
        height, width = grid.shape[:2]
        r = grid[:, :, 0].astype(np.float64)
        g = grid[:, :, 1].astype(np.float64)
        b = grid[:, :, 2].astype(np.float64)
        y = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

        events = []
        # Find local peaks above threshold
        for row in range(height):
            for col in range(width):
                val = y[row, col]
                if val >= threshold:
                    # Check if local maximum in 3x3 window
                    r_min = max(0, row - 1)
                    r_max = min(height, row + 2)
                    c_min = max(0, col - 1)
                    c_max = min(width, col + 2)
                    window = y[r_min:r_max, c_min:c_max]
                    if val >= np.max(window):
                        lon = -180.0 + col * (360.0 / width)
                        lat = 90.0 - row * (180.0 / height)
                        t = (col / float(width)) * 20.0
                        events.append({
                            "lon": round(float(lon), 3),
                            "lat": round(float(lat), 3),
                            "intensity": round(float(np.clip(val, 0.0, 1.0)), 4),
                            "time": round(float(t), 3),
                            "col_index": col
                        })
        return events

    def extract_gedi_features(self, grid: np.ndarray) -> List[Dict[str, Any]]:
        """
        Computes GEDI forest canopy column mean height and height variance in [0.0, 1.0].
        """
        height, width = grid.shape[:2]
        r = grid[:, :, 0].astype(np.float64)
        g = grid[:, :, 1].astype(np.float64)
        b = grid[:, :, 2].astype(np.float64)
        y = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

        gedi_cols = []
        for c in range(width):
            col_vals = y[:, c]
            mean_h = np.mean(col_vals)
            # Sample variance clamped to [0.0, 1.0]
            var_h = np.var(col_vals)
            lon = -180.0 + c * (360.0 / width)
            gedi_cols.append({
                "col_index": c,
                "lon": round(float(lon), 4),
                "mean_height": round(float(np.clip(mean_h, 0.0, 1.0)), 6),
                "height_variance": round(float(np.clip(var_h, 0.0, 1.0)), 6),
            })
        return gedi_cols

    def extract_co2_features(self, grid: np.ndarray) -> List[Dict[str, Any]]:
        """
        Computes DYAMOND CO2 concentration profile and brightness in [0.0, 1.0].
        """
        height, width = grid.shape[:2]
        r = grid[:, :, 0].astype(np.float64)
        g = grid[:, :, 1].astype(np.float64)
        b = grid[:, :, 2].astype(np.float64)
        y = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0

        co2_cols = []
        for c in range(width):
            col_vals = y[:, c]
            conc = np.mean(col_vals)
            lon = -180.0 + c * (360.0 / width)
            co2_cols.append({
                "col_index": c,
                "lon": round(float(lon), 4),
                "concentration": round(float(np.clip(conc, 0.0, 1.0)), 6),
                "brightness": round(float(np.clip(np.max(col_vals), 0.0, 1.0)), 6),
            })
        return co2_cols

    def extract_layer_specific_features(
        self,
        layer_id: str,
        grid: np.ndarray,
        aux_grid: Optional[np.ndarray] = None
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Extracts layer-specific features and returns (layer_features, events).
        """
        if layer_id == "night_lights":
            if aux_grid is not None:
                diffs = self.extract_night_lights_diff(aux_grid, grid)
            else:
                diffs = self.extract_night_lights_diff(grid, grid)
            return diffs, []

        elif layer_id == "lightning":
            events = self.extract_lightning_events(grid)
            return [], events

        elif layer_id == "gedi_forest":
            gedi_cols = self.extract_gedi_features(grid)
            return gedi_cols, []

        elif layer_id == "co2_dyamond":
            co2_cols = self.extract_co2_features(grid)
            return co2_cols, []

        return [], []

    def sonify_layer(
        self,
        layer_id: str,
        columns: List[Dict[str, Any]],
        events: Optional[List[Dict[str, Any]]] = None,
        duration: float = 20.0
    ) -> bytes:
        """Convenience method delegating to synthesizer."""
        return self.synthesizer.synthesize_wav(layer_id, columns, events=events, duration=duration)


class LayerAudioSynthesizer:
    """
    Original audio synthesis engine for NASA SVS/EIC layers.
    Generates 44.1 kHz 16-bit PCM stereo WAV audio with physical and musical mappings:
      - night_lights: 2012 Left, 2023 Right, positive delta triggers higher octave
      - lightning: percussive hits with velocity ~ intensity, pitch ~ lat, pan ~ lon
      - gedi_forest: canopy height -> pitch, variance -> chorus/reverb detune
      - co2_dyamond: concentration -> pitch, harmonic brightness advancing over timeline
    """

    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate

    def synthesize_wav(
        self,
        layer_id: str,
        columns: List[Dict[str, Any]],
        events: Optional[List[Dict[str, Any]]] = None,
        duration: float = 20.0,
        sample_rate: Optional[int] = None
    ) -> bytes:
        """
        Synthesizes a 44.1 kHz 16-bit PCM stereo WAV stream.
        """
        if not columns:
            raise ValueError("Columns list cannot be empty")

        sr = sample_rate or self.sample_rate
        duration = max(1.0, min(60.0, float(duration)))
        num_samples = int(duration * sr)
        num_cols = len(columns)

        time_axis = np.linspace(0.0, duration, num_samples, endpoint=False)
        left = np.zeros(num_samples, dtype=np.float64)
        right = np.zeros(num_samples, dtype=np.float64)

        samples_per_col = float(num_samples) / float(num_cols)

        # --------------------------------------------------------------------
        # Layer 1: Night Lights (2012 Left / 2023 Right, Delta Octave Boost)
        # --------------------------------------------------------------------
        if layer_id == "night_lights":
            base_f = 220.0  # A3 fundamental
            for c_idx, col in enumerate(columns):
                s_start = int(c_idx * samples_per_col)
                s_end = int((c_idx + 1) * samples_per_col)
                if s_start >= num_samples:
                    break
                s_end = min(num_samples, s_end)
                col_len = s_end - s_start
                if col_len <= 0:
                    continue

                t_chunk = time_axis[s_start:s_end]
                lf = col.get("layer_features", {})
                l12 = lf.get("luminance_2012", col.get("luminance", 0.0))
                l23 = lf.get("luminance_2023", col.get("luminance", 0.0))
                delta = lf.get("signed_diff", l23 - l12)

                # Left channel: 2012 baseline
                amp_l = 0.5 * l12
                # Right channel: 2023 comparison
                amp_r = 0.5 * l23

                # Pentatonic pitch class from hue
                hue = col.get("hue", 0.0)
                pitch_semis = PENTATONIC_INTERVALS[int(hue * 5) % 5]
                freq = base_f * (2.0 ** (pitch_semis / 12.0))

                # Positive delta triggers higher octave (+12 semitones = 2x frequency) on right channel
                freq_r = freq * 2.0 if delta > 0.05 else freq

                left[s_start:s_end] += amp_l * np.sin(2.0 * np.pi * freq * t_chunk)
                right[s_start:s_end] += amp_r * np.sin(2.0 * np.pi * freq_r * t_chunk)

        # --------------------------------------------------------------------
        # Layer 2: Lightning Events (Percussive Hits, Lat->Pitch, Lon->Pan)
        # --------------------------------------------------------------------
        elif layer_id == "lightning":
            # Ambient electrical drone bed (Schumann 7.83 Hz harmonics around 110 Hz)
            drone_f = 117.47  # D2
            drone_wave = 0.08 * np.sin(2.0 * np.pi * drone_f * time_axis)
            left += drone_wave
            right += drone_wave

            # Sonify column density as subtle ionospheric crackle
            for c_idx, col in enumerate(columns):
                dens = col.get("density", 0.0)
                if dens > 0.01:
                    s_start = int(c_idx * samples_per_col)
                    s_end = min(num_samples, int((c_idx + 1) * samples_per_col))
                    chunk_len = s_end - s_start
                    if chunk_len > 0:
                        crackle = (np.random.rand(chunk_len) - 0.5) * (dens * 0.15)
                        left[s_start:s_end] += crackle * 0.5
                        right[s_start:s_end] += crackle * 0.5

            # Synthesize discrete lightning strikes
            ev_list = events or []
            for ev in ev_list:
                intensity = ev.get("intensity", 0.5)
                lat = ev.get("lat", 0.0)
                lon = ev.get("lon", 0.0)

                # Timing: map lon (-180..180) to sweep time (0..duration)
                ev_time = ((lon + 180.0) / 360.0) * duration
                start_sample = int(ev_time * sr)
                if start_sample >= num_samples:
                    continue

                # Percussive strike duration: 40ms to 120ms based on intensity
                hit_len = int((0.04 + 0.08 * intensity) * sr)
                end_sample = min(num_samples, start_sample + hit_len)
                actual_len = end_sample - start_sample
                if actual_len <= 0:
                    continue

                # Pitch from latitude: South (-90) = 220 Hz, Equator (0) = 440 Hz, North (+90) = 880 Hz
                lat_norm = (lat + 90.0) / 180.0
                hit_freq = 220.0 * (2.0 ** (lat_norm * 2.0))

                t_hit = np.linspace(0.0, actual_len / sr, actual_len, endpoint=False)
                # Exponential attack-decay envelope
                env = np.exp(-t_hit * (30.0 / (0.1 + intensity)))
                # Harmonic strike burst (sine + noise transient)
                strike_burst = (
                    0.7 * np.sin(2.0 * np.pi * hit_freq * t_hit) +
                    0.3 * (np.random.rand(actual_len) - 0.5) * 2.0
                ) * env * (intensity * 0.6)

                # Stereo panning from longitude (-1.0 to +1.0)
                pan = lon / 180.0
                left_gain = math.sqrt(max(0.0, 0.5 * (1.0 - pan)))
                right_gain = math.sqrt(max(0.0, 0.5 * (1.0 + pan)))

                left[start_sample:end_sample] += strike_burst * left_gain
                right[start_sample:end_sample] += strike_burst * right_gain

        # --------------------------------------------------------------------
        # Layer 3: GEDI Forest (Canopy Height -> Pitch, Variance -> Chorus Detune)
        # --------------------------------------------------------------------
        elif layer_id == "gedi_forest":
            base_f = 174.61  # F3 fundamental
            for c_idx, col in enumerate(columns):
                s_start = int(c_idx * samples_per_col)
                s_end = min(num_samples, int((c_idx + 1) * samples_per_col))
                if s_start >= num_samples:
                    break
                col_len = s_end - s_start
                if col_len <= 0:
                    continue

                t_chunk = time_axis[s_start:s_end]
                lf = col.get("layer_features", {})
                mean_h = lf.get("mean_height", col.get("luminance", 0.0))
                var_h = lf.get("height_variance", 0.0)

                # Canopy height maps to pitch (from 174.6 Hz up to 698.4 Hz = F3 to F5)
                f_canopy = base_f * (2.0 ** (mean_h * 2.0))
                # Variance maps to detuning / dual chorus oscillators
                detune_hz = 0.5 + var_h * 15.0

                amp = 0.35 * (0.1 + 0.9 * mean_h)
                # Rich woodsy chime texture: primary oscillator + detuned chorus
                osc1 = np.sin(2.0 * np.pi * f_canopy * t_chunk)
                osc2 = np.sin(2.0 * np.pi * (f_canopy + detune_hz) * t_chunk)

                # Centroid pan: North Pole left, South Pole right
                cent = col.get("vertical_centroid", 0.5)
                pan_l = math.sqrt(max(0.0, cent))
                pan_r = math.sqrt(max(0.0, 1.0 - cent))

                chunk_audio = amp * 0.5 * (osc1 + osc2)
                left[s_start:s_end] += chunk_audio * pan_l
                right[s_start:s_end] += chunk_audio * pan_r

        # --------------------------------------------------------------------
        # Layer 4: CO2 DYAMOND (Concentration -> Pitch & Brightness Over Time)
        # --------------------------------------------------------------------
        else:  # co2_dyamond and fallback universal sonification
            base_f = 130.81  # C3 fundamental
            for c_idx, col in enumerate(columns):
                s_start = int(c_idx * samples_per_col)
                s_end = min(num_samples, int((c_idx + 1) * samples_per_col))
                if s_start >= num_samples:
                    break
                col_len = s_end - s_start
                if col_len <= 0:
                    continue

                t_chunk = time_axis[s_start:s_end]
                conc = col.get("luminance", 0.5)
                cent = col.get("vertical_centroid", 0.5)

                # Concentration elevates pitch from C3 (130.8 Hz) to C5 (523.25 Hz)
                f_co2 = base_f * (2.0 ** (conc * 2.0))
                # Harmonic overtone brightness expands with concentration
                overtone_amp = 0.25 * conc

                amp = 0.4 * (0.2 + 0.8 * conc)
                # Additive timbre: fundamental + 2nd + 3rd harmonics
                fundamental = np.sin(2.0 * np.pi * f_co2 * t_chunk)
                h2 = overtone_amp * np.sin(4.0 * np.pi * f_co2 * t_chunk)
                h3 = (overtone_amp * 0.5) * np.sin(6.0 * np.pi * f_co2 * t_chunk)

                tone = amp * (fundamental + h2 + h3)
                pan_l = math.sqrt(max(0.0, cent))
                pan_r = math.sqrt(max(0.0, 1.0 - cent))

                left[s_start:s_end] += tone * pan_l
                right[s_start:s_end] += tone * pan_r

        # --------------------------------------------------------------------
        # Post-Processing: Anti-click fade in/out & normalization
        # --------------------------------------------------------------------
        fade_samples = min(int(0.05 * sr), num_samples // 4)
        if fade_samples > 0:
            fade_in = np.linspace(0.0, 1.0, fade_samples)
            fade_out = np.linspace(1.0, 0.0, fade_samples)

            left[:fade_samples] *= fade_in
            right[:fade_samples] *= fade_in
            left[-fade_samples:] *= fade_out
            right[-fade_samples:] *= fade_out

        # Peak normalization to prevent digital clipping (-1.0 dB = 0.891)
        max_peak = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-6)
        if max_peak > 0.891:
            gain = 0.891 / max_peak
            left *= gain
            right *= gain

        # Convert to 16-bit PCM interleaved stereo
        left_int16 = (np.clip(left, -1.0, 1.0) * 32767.0).astype(np.int16)
        right_int16 = (np.clip(right, -1.0, 1.0) * 32767.0).astype(np.int16)

        interleaved = np.empty((num_samples * 2,), dtype=np.int16)
        interleaved[0::2] = left_int16
        interleaved[1::2] = right_int16

        # Encode to WAV byte buffer
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wf:
            wf.setnchannels(2)      # Stereo
            wf.setsampwidth(2)     # 16-bit PCM (2 bytes)
            wf.setframerate(sr)    # 44.1 kHz
            wf.writeframes(interleaved.tobytes())

        return wav_io.getvalue()

    def sonify_layer(
        self,
        layer_id: str,
        columns: List[Dict[str, Any]],
        events: Optional[List[Dict[str, Any]]] = None,
        duration: float = 20.0
    ) -> bytes:
        """Alias for synthesize_wav."""
        return self.synthesize_wav(layer_id, columns, events=events, duration=duration)


# Module-level convenience functions
_default_sonifier = ImageSonifier()


def resize_to_grid(
    image: Union[Image.Image, np.ndarray, str, Path],
    target_shape: Tuple[int, int] = (GRID_WIDTH, GRID_HEIGHT)
) -> np.ndarray:
    return _default_sonifier.resize_to_grid(image, target_shape=target_shape)


def extract_column_metrics(grid: np.ndarray) -> List[Dict[str, Any]]:
    return _default_sonifier.extract_column_metrics(grid)


def extract_layer_specific_features(
    layer_id: str,
    grid: np.ndarray,
    aux_grid: Optional[np.ndarray] = None
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    return _default_sonifier.extract_layer_specific_features(layer_id, grid, aux_grid=aux_grid)


def synthesize_wav(
    layer_id: str,
    columns: List[Dict[str, Any]],
    events: Optional[List[Dict[str, Any]]] = None,
    duration: float = 20.0,
    sample_rate: int = 44100
) -> bytes:
    return _default_sonifier.synthesizer.synthesize_wav(
        layer_id, columns, events=events, duration=duration, sample_rate=sample_rate
    )
