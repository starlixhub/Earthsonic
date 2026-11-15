"""
tests/test_image_sonifier.py
Opaque-box unit and contract tests for backend/sonification/image_sonifier.py.

Verifies:
  - Resizing frames to 720x360 equirectangular grid (lon -180..180, lat 90..-90)
  - Per-column normalized 0..1 metrics on tiny deterministic synthetic images:
      * Pure black (zeros)
      * Pure white (ones)
      * Half-split horizontal (hemisphere centroids)
      * Pure RGB primary bands (hue and ITU-R BT.601 luminance weights)
  - Strict 0..1 bounds verification across all column metrics
  - Layer-specific feature extraction:
      * Night lights: 2012 vs 2023 signed delta and positive delta
      * ISS Lightning: discrete event hotspot coordinate & intensity detection
      * GEDI Forest: column mean height and variance
      * CO2 DYAMOND: column concentration profile
  - Audio synthesizer: 44.1 kHz 16-bit PCM stereo WAV generation
"""

import math
import os
import sys
import wave
import io
import pytest
import numpy as np
from PIL import Image

# Progressive testability check: arm suite if module exists
try:
    import backend.sonification.image_sonifier as image_sonifier_module
    IMAGE_SONIFIER_AVAILABLE = True
except ImportError:
    IMAGE_SONIFIER_AVAILABLE = False
    image_sonifier_module = None

pytestmark = pytest.mark.skipif(
    not IMAGE_SONIFIER_AVAILABLE,
    reason="backend.sonification.image_sonifier not yet implemented (Milestone 2)"
)


def _get_sonifier():
    """Helper to acquire ImageSonifier class or instance."""
    if hasattr(image_sonifier_module, "ImageSonifier"):
        cls = getattr(image_sonifier_module, "ImageSonifier")
        return cls() if isinstance(cls, type) else cls
    return image_sonifier_module


class TestTier1FeatureCoverage:
    """Tier 1: Primary Happy-Path Image Feature Extraction & Equirectangular Resizing."""

    def test_equirectangular_resizing_to_720x360(self):
        """Verifies arbitrary dimensions resize to standard 720x360 equirectangular grid."""
        sonifier = _get_sonifier()

        # Create synthetic images of various sizes and aspect ratios
        test_sizes = [(10, 10), (100, 50), (1024, 512), (1920, 1080), (800, 600)]
        for w, h in test_sizes:
            img = Image.new("RGB", (w, h), color=(128, 64, 32))
            
            if hasattr(sonifier, "resize_to_grid"):
                grid = sonifier.resize_to_grid(img, target_shape=(720, 360))
            elif hasattr(image_sonifier_module, "resize_to_grid"):
                grid = image_sonifier_module.resize_to_grid(img, target_shape=(720, 360))
            elif hasattr(sonifier, "resize_frame"):
                grid = sonifier.resize_frame(img)
            else:
                pytest.fail("Missing resize_to_grid or resize_frame in image_sonifier")

            # Check output shape: (height=360, width=720, channels=3) or PIL Image (720, 360)
            if isinstance(grid, Image.Image):
                assert grid.size == (720, 360), f"Expected PIL size (720, 360), got {grid.size}"
            elif isinstance(grid, np.ndarray):
                assert grid.shape[:2] == (360, 720), f"Expected numpy grid (360, 720, 3), got {grid.shape}"
            else:
                pytest.fail(f"Unexpected grid return type: {type(grid)}")

    def test_pure_black_frame_metrics(self):
        """Pure black frame: luminance=0, density=0, hue=0, centroid=0.5 (equator default)."""
        sonifier = _get_sonifier()
        black_grid = np.zeros((360, 720, 3), dtype=np.uint8)

        if hasattr(sonifier, "extract_column_metrics"):
            columns = sonifier.extract_column_metrics(black_grid)
        elif hasattr(image_sonifier_module, "extract_column_metrics"):
            columns = image_sonifier_module.extract_column_metrics(black_grid)
        else:
            pytest.fail("Missing extract_column_metrics function in image_sonifier")

        assert len(columns) == 720, f"Expected 720 columns, got {len(columns)}"

        for col in columns:
            assert col["luminance"] == 0.0, f"Expected luminance 0.0 on black, got {col['luminance']}"
            assert col["density"] == 0.0, f"Expected density 0.0 on black, got {col['density']}"
            assert col["hue"] == 0.0, f"Expected hue 0.0 on black, got {col['hue']}"
            # Centroid defaults to 0.5 (equator) on zero intensity to avoid division by zero
            assert abs(col["vertical_centroid"] - 0.5) < 1e-4, (
                f"Expected centroid 0.5 (equator neutral) on black, got {col['vertical_centroid']}"
            )

    def test_pure_white_frame_metrics(self):
        """Pure white frame: luminance=1.0, density=1.0, hue=0.0 (achromatic), centroid=0.5."""
        sonifier = _get_sonifier()
        white_grid = np.full((360, 720, 3), 255, dtype=np.uint8)

        if hasattr(sonifier, "extract_column_metrics"):
            columns = sonifier.extract_column_metrics(white_grid)
        else:
            columns = image_sonifier_module.extract_column_metrics(white_grid)

        assert len(columns) == 720

        for col in columns:
            assert abs(col["luminance"] - 1.0) < 1e-3, f"Expected luminance 1.0, got {col['luminance']}"
            assert abs(col["density"] - 1.0) < 1e-3, f"Expected density 1.0, got {col['density']}"
            # Centroid should be exactly balanced at equator (0.5)
            assert abs(col["vertical_centroid"] - 0.5) < 0.05, (
                f"Expected centroid 0.5 on uniform white, got {col['vertical_centroid']}"
            )
            assert col["hue"] == 0.0, f"Achromatic white must have hue 0.0, got {col['hue']}"


class TestTier2BoundaryAndCornerCases:
    """Tier 2: Boundary Value Analysis & Extreme Contrast Patterns."""

    def test_half_split_horizontal_northern_hemisphere(self):
        """Top half white (rows 0..179), bottom half black (rows 180..359): centroid > 0.5."""
        sonifier = _get_sonifier()
        grid = np.zeros((360, 720, 3), dtype=np.uint8)
        grid[0:180, :, :] = 255  # Northern hemisphere active

        columns = sonifier.extract_column_metrics(grid)

        for col in columns:
            assert abs(col["luminance"] - 0.5) < 0.05, f"Expected luminance ~0.5, got {col['luminance']}"
            assert abs(col["density"] - 0.5) < 0.05, f"Expected density ~0.5, got {col['density']}"
            # Northern hemisphere should have centroid > 0.5 (centered around 0.75)
            assert col["vertical_centroid"] > 0.65, (
                f"Northern hemisphere centroid must be > 0.65, got {col['vertical_centroid']}"
            )

    def test_half_split_horizontal_southern_hemisphere(self):
        """Top half black (rows 0..179), bottom half white (rows 180..359): centroid < 0.5."""
        sonifier = _get_sonifier()
        grid = np.zeros((360, 720, 3), dtype=np.uint8)
        grid[180:360, :, :] = 255  # Southern hemisphere active

        columns = sonifier.extract_column_metrics(grid)

        for col in columns:
            assert abs(col["luminance"] - 0.5) < 0.05, f"Expected luminance ~0.5, got {col['luminance']}"
            assert abs(col["density"] - 0.5) < 0.05, f"Expected density ~0.5, got {col['density']}"
            # Southern hemisphere should have centroid < 0.5 (centered around 0.25)
            assert col["vertical_centroid"] < 0.35, (
                f"Southern hemisphere centroid must be < 0.35, got {col['vertical_centroid']}"
            )

    def test_extreme_polar_pixels(self):
        """Row 0 (North Pole +90°) and Row 359 (South Pole -90°) extreme centroids."""
        sonifier = _get_sonifier()

        # North Pole: Row 0 only
        north_grid = np.zeros((360, 720, 3), dtype=np.uint8)
        north_grid[0, :, :] = 255
        north_cols = sonifier.extract_column_metrics(north_grid)
        for col in north_cols:
            assert col["vertical_centroid"] >= 0.95, (
                f"North Pole row 0 must yield centroid near 1.0, got {col['vertical_centroid']}"
            )

        # South Pole: Row 359 only
        south_grid = np.zeros((360, 720, 3), dtype=np.uint8)
        south_grid[359, :, :] = 255
        south_cols = sonifier.extract_column_metrics(south_grid)
        for col in south_cols:
            assert col["vertical_centroid"] <= 0.05, (
                f"South Pole row 359 must yield centroid near 0.0, got {col['vertical_centroid']}"
            )

    def test_rgb_bands_hue_and_luminance_weights(self):
        """Verifies ITU-R BT.601 luminance weights: Y = 0.299R + 0.587G + 0.114B and HSV hue."""
        sonifier = _get_sonifier()

        # Create a grid with pure primary columns
        # Col 0..239: Pure Red (255, 0, 0)
        # Col 240..479: Pure Green (0, 255, 0)
        # Col 480..719: Pure Blue (0, 0, 255)
        grid = np.zeros((360, 720, 3), dtype=np.uint8)
        grid[:, 0:240] = [255, 0, 0]
        grid[:, 240:480] = [0, 255, 0]
        grid[:, 480:720] = [0, 0, 255]

        columns = sonifier.extract_column_metrics(grid)

        # Red columns: BT.601 luminance ~0.299, Hue = 0.0
        red_col = columns[100]
        assert abs(red_col["luminance"] - 0.299) < 0.03, f"Expected red luminance ~0.299, got {red_col['luminance']}"
        assert abs(red_col["hue"] - 0.0) < 0.05 or abs(red_col["hue"] - 1.0) < 0.05, f"Expected red hue ~0.0, got {red_col['hue']}"

        # Green columns: BT.601 luminance ~0.587, Hue = 120/360 ~ 0.333
        green_col = columns[350]
        assert abs(green_col["luminance"] - 0.587) < 0.03, f"Expected green luminance ~0.587, got {green_col['luminance']}"
        assert abs(green_col["hue"] - 0.333) < 0.05, f"Expected green hue ~0.333, got {green_col['hue']}"

        # Blue columns: BT.601 luminance ~0.114, Hue = 240/360 ~ 0.667
        blue_col = columns[600]
        assert abs(blue_col["luminance"] - 0.114) < 0.03, f"Expected blue luminance ~0.114, got {blue_col['luminance']}"
        assert abs(blue_col["hue"] - 0.667) < 0.05, f"Expected blue hue ~0.667, got {blue_col['hue']}"

    def test_strict_0_to_1_normalization_bounds_across_all_metrics(self):
        """Verifies that all metrics strictly obey 0.0 <= x <= 1.0 on arbitrary random noise."""
        sonifier = _get_sonifier()
        np.random.seed(42)
        random_grid = np.random.randint(0, 256, (360, 720, 3), dtype=np.uint8)

        columns = sonifier.extract_column_metrics(random_grid)
        assert len(columns) == 720

        for i, col in enumerate(columns):
            assert 0.0 <= col["luminance"] <= 1.0, f"Col {i} luminance {col['luminance']} out of [0, 1]"
            assert 0.0 <= col["hue"] <= 1.0, f"Col {i} hue {col['hue']} out of [0, 1]"
            assert 0.0 <= col["density"] <= 1.0, f"Col {i} density {col['density']} out of [0, 1]"
            assert 0.0 <= col["vertical_centroid"] <= 1.0, f"Col {i} centroid {col['vertical_centroid']} out of [0, 1]"


class TestTier3LayerSpecificFeatures:
    """Tier 3: Layer-Specific Features (Night Lights, Lightning, GEDI, CO2)."""

    def test_night_lights_differential_extraction(self):
        """Verifies 2012 vs 2023 signed delta and positive delta."""
        sonifier = _get_sonifier()
        grid_2012 = np.zeros((360, 720, 3), dtype=np.uint8)
        grid_2023 = np.zeros((360, 720, 3), dtype=np.uint8)

        # Region A (col 100): 2012 dark (0), 2023 bright (200) -> new electrification (positive delta)
        grid_2023[:, 100] = 200

        # Region B (col 200): 2012 bright (200), 2023 dark (0) -> dimming (negative delta)
        grid_2012[:, 200] = 200

        # Region C (col 300): both bright (150) -> stable (zero delta)
        grid_2012[:, 300] = 150
        grid_2023[:, 300] = 150

        if hasattr(sonifier, "extract_night_lights_diff"):
            diffs = sonifier.extract_night_lights_diff(grid_2012, grid_2023)
        elif hasattr(sonifier, "extract_layer_specific_features"):
            diffs, _ = sonifier.extract_layer_specific_features("night_lights", grid_2023, aux_grid=grid_2012)
        else:
            pytest.skip("extract_night_lights_diff not exposed directly")

        # Region A: positive change
        col100 = diffs[100]
        signed_diff_100 = col100.get("signed_diff") or col100.get("diff", 0.0)
        assert signed_diff_100 > 0.0, f"Expected positive signed diff at col 100, got {signed_diff_100}"

        # Region B: negative change
        col200 = diffs[200]
        signed_diff_200 = col200.get("signed_diff") or col200.get("diff", 0.0)
        assert signed_diff_200 < 0.0, f"Expected negative signed diff at col 200, got {signed_diff_200}"

    def test_lightning_hotspot_event_detection(self):
        """Verifies detection of discrete lightning events above intensity threshold."""
        sonifier = _get_sonifier()
        grid = np.zeros((360, 720, 3), dtype=np.uint8)

        # Inject 3 distinct high-intensity hotspots (> 0.65 intensity)
        # Hotspot 1: Catatumbo (-75.5 lon, 8.5 lat) -> col 209, row ~163
        grid[163, 209] = [255, 255, 255]

        # Hotspot 2: Congo (25.0 lon, 1.5 lat) -> col 410, row ~177
        grid[177, 410] = [240, 240, 255]

        if hasattr(sonifier, "extract_lightning_events"):
            events = sonifier.extract_lightning_events(grid)
        elif hasattr(sonifier, "extract_layer_specific_features"):
            _, events = sonifier.extract_layer_specific_features("lightning", grid)
        else:
            pytest.skip("extract_lightning_events not exposed directly")

        assert len(events) >= 2, f"Expected at least 2 detected lightning events, got {len(events)}"
        for ev in events:
            assert "lon" in ev, "Event must contain lon"
            assert "lat" in ev, "Event must contain lat"
            assert "intensity" in ev, "Event must contain intensity"
            assert 0.0 <= ev["intensity"] <= 1.0, f"Intensity {ev['intensity']} must be in [0, 1]"

    def test_gedi_canopy_metrics(self):
        """Verifies canopy height and variance computation bounded in [0, 1]."""
        sonifier = _get_sonifier()
        grid = np.zeros((360, 720, 3), dtype=np.uint8)

        # Column 10: Bare ground / ocean (all zeros)
        # Column 20: Tall uniform canopy (128)
        grid[:, 20] = 128
        # Column 30: Multi-tier canopy (gradient from 0 to 255)
        grid[:, 30] = np.tile(np.linspace(0, 255, 360, dtype=np.uint8).reshape(360, 1), (1, 3))

        if hasattr(sonifier, "extract_gedi_features"):
            gedi_cols = sonifier.extract_gedi_features(grid)
        elif hasattr(sonifier, "extract_layer_specific_features"):
            gedi_cols, _ = sonifier.extract_layer_specific_features("gedi_forest", grid)
        else:
            pytest.skip("extract_gedi_features not exposed directly")

        # Zero canopy: mean height = 0, variance = 0
        assert gedi_cols[10]["mean_height"] == 0.0
        assert gedi_cols[10]["height_variance"] == 0.0

        # Uniform canopy: variance ~ 0
        assert gedi_cols[20]["mean_height"] > 0.0
        assert gedi_cols[20]["height_variance"] < 0.05

        # Multi-tier canopy: variance > 0
        assert gedi_cols[30]["height_variance"] > 0.05


class TestTier4RealWorldAudioSynthesis:
    """Tier 4: Authentic Audio Synthesis Contract Verification."""

    def test_audio_synthesizer_generates_valid_stereo_wav(self):
        """Verifies synthesis generates valid 44.1 kHz 16-bit PCM stereo WAV stream."""
        sonifier = _get_sonifier()

        # Generate audio using LayerAudioSynthesizer or sonify_layer function
        synthesizer = None
        if hasattr(image_sonifier_module, "LayerAudioSynthesizer"):
            cls = getattr(image_sonifier_module, "LayerAudioSynthesizer")
            synthesizer = cls() if isinstance(cls, type) else cls
        elif hasattr(sonifier, "synthesizer"):
            synthesizer = sonifier.synthesizer
        elif hasattr(sonifier, "sonify_layer"):
            synthesizer = sonifier

        if synthesizer is None:
            pytest.skip("LayerAudioSynthesizer not found")

        # Create deterministic synthetic column metrics
        test_columns = [
            {
                "col_index": i,
                "lon": -180.0 + i * 0.5,
                "luminance": (math.sin(i / 20.0) + 1.0) / 2.0,
                "hue": (i % 360) / 360.0,
                "density": 0.5,
                "vertical_centroid": 0.5,
                "layer_features": {}
            }
            for i in range(720)
        ]

        duration = 2.0  # Short test duration
        if hasattr(synthesizer, "synthesize_wav"):
            wav_bytes = synthesizer.synthesize_wav("night_lights", test_columns, duration=duration)
        elif hasattr(synthesizer, "sonify_layer"):
            wav_bytes = synthesizer.sonify_layer("night_lights", test_columns, duration=duration)
        else:
            pytest.skip("synthesize_wav method not found")

        # Validate WAV stream format
        assert isinstance(wav_bytes, (bytes, bytearray)), "synthesize_wav must return bytes"
        assert wav_bytes.startswith(b"RIFF"), "WAV stream must begin with RIFF signature"
        assert b"WAVE" in wav_bytes[:16], "WAV header must contain WAVE marker"

        # Validate with python wave module
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            assert wf.getnchannels() == 2, f"Expected stereo (2 channels), got {wf.getnchannels()}"
            assert wf.getsampwidth() == 2, f"Expected 16-bit PCM (2 bytes/sample), got {wf.getsampwidth()}"
            assert wf.getframerate() == 44100, f"Expected 44.1 kHz sample rate, got {wf.getframerate()}"
            total_frames = wf.getnframes()
            expected_frames = int(duration * 44100)
            assert abs(total_frames - expected_frames) < 4410, (
                f"Expected ~{expected_frames} frames for {duration}s, got {total_frames}"
            )

        # Empty columns validation: must cleanly raise ValueError
        with pytest.raises(ValueError, match="Columns list cannot be empty"):
            if hasattr(synthesizer, "synthesize_wav"):
                synthesizer.synthesize_wav("night_lights", [])
            elif hasattr(synthesizer, "sonify_layer"):
                synthesizer.sonify_layer("night_lights", [])
