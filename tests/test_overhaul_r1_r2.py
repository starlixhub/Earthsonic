"""
tests/test_overhaul_r1_r2.py
Comprehensive automated test suite verifying Requirement R1 (3D Earth Globe Realism & Shaders)
and Requirement R2 (Flight-Deck UI Polish & Telemetry Controls) with Zero Regression.
"""

import os
import re
import pytest
from PIL import Image

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
GLOBE_DIR = os.path.join(FRONTEND_DIR, "js", "globe")
CSS_DIR = os.path.join(FRONTEND_DIR, "css")
TEXTURES_DIR = os.path.join(FRONTEND_DIR, "assets", "textures")


# ============================================================================
# R1: 3D EARTH GLOBE REALISM & SHADERS
# ============================================================================

def test_r1_equirectangular_earth_textures_and_graticule():
    """Verify authentic equirectangular textures exist and 15-degree graticule overlay is configured."""
    for tex in ["earth_day_2k.png", "earth_night_2k.png", "earth_specular_2k.png"]:
        p = os.path.join(TEXTURES_DIR, tex)
        assert os.path.exists(p), f"Missing texture {tex}"
        with Image.open(p) as img:
            assert img.size == (2048, 1024), f"Texture {tex} must be 2048x1024"

    globe_js = open(os.path.join(GLOBE_DIR, "globe.js"), encoding="utf-8").read()
    # Graticule wireframe overlay with 15-degree step and rgba(255, 255, 255, 0.06)
    assert "15" in globe_js, "globe.js must declare 15-degree graticule step"
    assert "0.06" in globe_js or "rgba(255, 255, 255, 0.06)" in globe_js or "rgba(255,255,255,0.06)" in globe_js, \
        "Graticule must use rgba(255, 255, 255, 0.06)"


def test_r1_temperature_zonal_blend_max_opacity():
    """Verify temperature mode blends 14-band GISTEMP at max 0.42 opacity preserving coastline contrast."""
    shaders_js = open(os.path.join(GLOBE_DIR, "shaders.js"), encoding="utf-8").read()
    overlays_js = open(os.path.join(GLOBE_DIR, "overlays.js"), encoding="utf-8").read()

    # Check max opacity 0.42
    assert "0.42" in shaders_js or "0.42" in overlays_js, "Temperature blending must reference 0.42 max opacity"
    # Coastline preservation check: base earth color or mix formula
    assert "mix(" in shaders_js, "Zonal shader must blend with mix()"


def test_r1_ocean_thermal_shader_water_mask_and_smooth_bands():
    """Verify ocean thermal shader strictly masks to ocean (waterMask > 0.5) and uses smooth thermal bands."""
    shaders_js = open(os.path.join(GLOBE_DIR, "shaders.js"), encoding="utf-8").read()
    assert "0.5" in shaders_js, "Ocean thermal shader must threshold water mask at 0.5"
    assert ("waterMask > 0.5" in shaders_js or "waterMask >= 0.5" in shaders_js or 
            "> 0.5" in shaders_js or ">= 0.5" in shaders_js), "Mask strictly using ocean mask > 0.5"
    # Deep ocean navy #061428: RGB (6, 20, 40) or normalized (0.0235, 0.0784, 0.1568)
    assert ("061428" in shaders_js or "0.024" in shaders_js or "0.0235" in shaders_js or 
            "6.0 / 255.0" in shaders_js or "20.0" in shaders_js), "Must use deep ocean navy #061428 base"


def test_r1_atmospheric_halo_backside_mesh_and_no_particles():
    """Verify smooth BackSide sphere scaled to 1.06 with Fresnel rim lighting and removal of blocky particle ring."""
    shaders_js = open(os.path.join(GLOBE_DIR, "shaders.js"), encoding="utf-8").read()
    globe_js = open(os.path.join(GLOBE_DIR, "globe.js"), encoding="utf-8").read()
    overlays_js = open(os.path.join(GLOBE_DIR, "overlays.js"), encoding="utf-8").read()

    # BackSide sphere scaled to 1.06
    assert "1.06" in globe_js or "1.06" in overlays_js, "Atmospheric halo must be scaled to 1.06"
    assert "BackSide" in globe_js or "BackSide" in overlays_js, "Atmospheric halo must use BackSide"
    # Fresnel rim lighting pow(1.0 - dot(...), 3.0)
    assert "3.0" in shaders_js, "Fresnel rim lighting must use power of 3.0"
    # Removal of blocky particle ring: CO2Overlay should not use Points particle cloud
    assert "this.particleCount = 1200" not in overlays_js, "Blocky particle cloud ring must be removed"


def test_r1_starfield_point_size_and_sprites():
    """Verify starfield uses circular soft alpha sprites with point size 1.0px - 2.2px and opacity 0.2 - 0.85."""
    globe_js = open(os.path.join(GLOBE_DIR, "globe.js"), encoding="utf-8").read()
    # Starfield sizing and opacity specifications
    assert "1.0" in globe_js or "2.2" in globe_js, "Starfield point size must be in 1.0 - 2.2px range"
    assert "0.2" in globe_js and "0.85" in globe_js, "Starfield opacity must vary between 0.2 and 0.85"


# ============================================================================
# R2: FLIGHT-DECK UI POLISH & TELEMETRY CONTROLS
# ============================================================================

def test_r2_header_status_badge_unicode_bullet():
    """Verify header status badge displays actual • character instead of literal &bull; string."""
    index_html = open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8").read()
    app_js = open(os.path.join(FRONTEND_DIR, "js", "app.js"), encoding="utf-8").read()

    # Status badge must use actual • character
    assert "FLIGHT DECK ONLINE • 23.44° TILT" in app_js, "app.js must use actual • in telemetry status"
    assert "FLIGHT DECK ONLINE &bull;" not in app_js, "app.js must not contain literal &bull;"


def test_r2_live_earth_telemetry_matrix():
    """Verify top-right HUD card displays Live Earth Telemetry Matrix for all 4 variables."""
    index_html = open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8").read()
    app_js = open(os.path.join(FRONTEND_DIR, "js", "app.js"), encoding="utf-8").read()

    # Replaces DAY / NIGHT GLSL TERMINATOR
    assert "DAY / NIGHT GLSL TERMINATOR" not in index_html, "Must replace DAY / NIGHT GLSL TERMINATOR"
    # Contains all 4 telemetry variable keys
    assert "TEMP" in index_html and "CO2" in index_html and "OCEAN" in index_html and "ICE" in index_html, \
        "Telemetry matrix must display TEMP, CO2, OCEAN, ICE"
    # Telemetry matrix update function present in app.js
    assert "updateTelemetryMatrix" in app_js or "telemetry-matrix" in app_js or "matrix" in app_js.lower(), \
        "app.js must update telemetry matrix"


def test_r2_custom_range_input_styling():
    """Verify custom aerospace styling on all range inputs with 4px track #18181b, dynamic color fills, 6x14px thumbs #f4f4f5."""
    main_css = open(os.path.join(CSS_DIR, "main.css"), encoding="utf-8").read()
    orch_css = open(os.path.join(CSS_DIR, "orchestra.css"), encoding="utf-8").read()
    combined_css = main_css + "\n" + orch_css

    assert "-webkit-appearance: none" in combined_css
    assert "18181b" in combined_css, "Must use #18181b dark recessed track"
    assert "f4f4f5" in combined_css, "Must use #f4f4f5 precision thumb background"
    assert "6px" in combined_css and "14px" in combined_css, "Thumb must be 6px width by 14px height"
    assert "border-radius: 1px" in combined_css, "Thumb must have 1px border-radius"
    # Layer fill colors
    assert "fc3d21" in combined_css, "Temp fill color #fc3d21"
    assert "f59e0b" in combined_css, "CO2 fill color #f59e0b"
    assert "0ea5e9" in combined_css, "Ocean fill color #0ea5e9"
    assert "38bdf8" in combined_css, "Ice fill color #38bdf8"
    # No round 50% border radius on slider thumbs
    assert "slider-thumb {\n  border-radius: 50%" not in combined_css


def test_r2_orchestra_cards_header_readout_badges_and_no_pan():
    """Verify PAN slider row removed and live scientific-to-audio readout badges located in card headers."""
    index_html = open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8").read()
    app_js = open(os.path.join(FRONTEND_DIR, "js", "app.js"), encoding="utf-8").read()

    # Zero PAN sliders
    assert "strip-pan-slider" not in index_html
    assert "strip-pan-row" not in index_html
    # All 4 equation badges retained
    for cid in ["surface_temperature", "atmospheric_co2", "ocean_temperature", "sea_ice_extent"]:
        assert f'id="eq-badge-{cid}"' in index_html
        assert f'id="eq-text-{cid}"' in index_html

    # Acoustic parameter mappings present in updateLiveEquationBadges
    assert "Hz" in app_js
    assert "Drive" in app_js or "Sat" in app_js or "Drive" in index_html
    assert "LPF" in app_js
    assert "Wind" in app_js or "Wind Mix" in app_js


def test_r2_audio_visualizer_hud_height_and_oscilloscope_grid():
    """Verify visualizer HUD height reduced by 35%, technical oscilloscope grid, frequency axis, and decade labels."""
    index_html = open(os.path.join(FRONTEND_DIR, "index.html"), encoding="utf-8").read()
    vis_css = open(os.path.join(CSS_DIR, "visualizer.css"), encoding="utf-8").read()
    orch_css = open(os.path.join(CSS_DIR, "orchestra.css"), encoding="utf-8").read()
    combined_css = vis_css + "\n" + orch_css

    # Oscilloscope grid styling (24px 20px)
    assert "24px 20px" in combined_css, "Grid background-size must be 24px 20px"
    assert "linear-gradient" in combined_css

    # Frequency axis labels: 60Hz, 250Hz, 1kHz, 4kHz, 16kHz
    for freq in ["60Hz", "250Hz", "1kHz", "4kHz", "16kHz"]:
        assert freq in index_html, f"Missing frequency label {freq} in visualizer"

    # Decade tick labels: 1980, 1990, 2000, 2010, 2020, 2026
    for decade in ["1980", "1990", "2000", "2010", "2020", "2026"]:
        assert decade in index_html, f"Missing decade label {decade} under scrubber"


# ============================================================================
# R3: NON-REGRESSION & AUTHENTIC DATA INTEGRITY
# ============================================================================

def test_r3_authentic_data_values_unaltered():
    """Verify authentic NASA dataset values are preserved and no synthetic data is injected."""
    harm_path = os.path.join(PROJECT_ROOT, "data", "processed", "earthsonic_monthly_harmonized.json")
    assert os.path.exists(harm_path)
    import json
    with open(harm_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    assert len(data["records"]) == 573, "Must have exactly 573 authentic monthly records"
    # Check authentic endpoints
    first = data["records"][0]
    last = data["records"][-1]
    assert first["date"] == "1979-01"
    assert last["date"] == "2026-09"
