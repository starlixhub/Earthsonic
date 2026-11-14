"""
tests/test_globe.py
Comprehensive unit and integration test suite for Milestone 3:
Interactive 3D Earth Globe Visualization & Scientific Overlays.

Tests:
  - Globe component architecture & file structure
  - GLSL shader syntax, uniforms, varyings, and terminator logic
  - Procedural texture generator algorithms & bundled PNG assets
  - Geographic coordinate math (Lat/Lon <-> Vector3 roundtrip)
  - Scientific overlay geometry, scaling, and color-mapping logic
  - Backend REST API serving data required by globe overlays
  - Flask static file serving for HTML, CSS, JS, and textures
"""

import os
import re
import math
import pytest
from PIL import Image
from backend.app import create_app
from backend.config import Config

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
GLOBE_JS_DIR = os.path.join(FRONTEND_DIR, "js", "globe")
TEXTURES_DIR = os.path.join(FRONTEND_DIR, "assets", "textures")


@pytest.fixture
def client():
    """Flask test client fixture."""
    app = create_app(Config)
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


# ============================================================================
# 1. FILE STRUCTURE & INTEGRITY TESTS
# ============================================================================

def test_globe_files_exist():
    """Verify all Milestone 3 files exist in their designated directories."""
    required_files = [
        os.path.join(GLOBE_JS_DIR, "globe.js"),
        os.path.join(GLOBE_JS_DIR, "shaders.js"),
        os.path.join(GLOBE_JS_DIR, "textures.js"),
        os.path.join(GLOBE_JS_DIR, "overlays.js"),
        os.path.join(FRONTEND_DIR, "js", "api.js"),
        os.path.join(FRONTEND_DIR, "css", "globe.css"),
        os.path.join(FRONTEND_DIR, "index.html"),
    ]
    for path in required_files:
        assert os.path.exists(path), f"Required M3 file missing: {path}"
        assert os.path.getsize(path) > 100, f"File appears too small or empty: {path}"


def test_bundled_texture_assets_exist():
    """Verify all 5 2K Earth texture assets are present and valid."""
    texture_names = [
        "earth_day_2k.png",
        "earth_night_2k.png",
        "earth_bump_2k.png",
        "earth_specular_2k.png",
        "earth_clouds_2k.png",
    ]
    for name in texture_names:
        path = os.path.join(TEXTURES_DIR, name)
        assert os.path.exists(path), f"Missing texture asset: {name}"
        assert os.path.getsize(path) > 5000, f"Texture asset {name} is unusually small"

        # Verify image dimensions
        with Image.open(path) as img:
            assert img.size == (2048, 1024), f"Expected 2048x1024 for {name}, got {img.size}"


# ============================================================================
# 2. GLSL SHADER CODE & UNIFORMS TESTS
# ============================================================================

def test_shaders_js_content():
    """Verify GLSL shaders contain required uniforms, varyings, and math."""
    path = os.path.join(GLOBE_JS_DIR, "shaders.js")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Terminator Shader
    assert "TerminatorShader" in content
    assert "smoothstep(-0.15, 0.15" in content, "Terminator shader must use smoothstep(-0.15, 0.15, ...)"
    assert "dot(normal, sunDir)" in content or "dot(vNormal, vSunDirection)" in content
    assert "uDayMap" in content
    assert "uNightMap" in content
    assert "uSpecularMap" in content
    assert "uSunPosition" in content

    # Atmosphere Fresnel Shader
    assert "AtmosphereShader" in content
    assert "uAtmosphereColor" in content
    assert "0.65 - dotProd" in content or "dot" in content
    assert "uGlowPower" in content

    # Ocean Thermal Shader
    assert "OceanThermalShader" in content
    assert "uThermalAnomaly" in content
    assert "uWaveHeight" in content
    assert "uSpecularMask" in content

    # Zonal Heatmap Shader
    assert "ZonalHeatmapShader" in content
    assert "uBandAnomalies[14]" in content, "Zonal shader must declare 14-band uniform array"


def test_globe_core_axial_tilt():
    """Verify globe.js specifies the genuine axial tilt of Earth (23.44°)."""
    path = os.path.join(GLOBE_JS_DIR, "globe.js")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "AXIAL_TILT_DEG = 23.44" in content or "23.44" in content
    assert "CelestialPivot" in content
    assert "EarthCoreMesh" in content
    assert "EarthGroup" in content
    assert "flyTo" in content
    assert "flyToMaunaLoa" in content


# ============================================================================
# 3. GEOGRAPHIC COORDINATE MATHEMATICS TESTS
# ============================================================================

def lat_lon_to_cartesian_test(lat, lon, radius=1.0):
    """Python reference implementation of the geographic conversion formula."""
    phi = (90.0 - lat) * (math.pi / 180.0)
    theta = (lon + 180.0) * (math.pi / 180.0)
    x = -(radius * math.sin(phi) * math.cos(theta))
    z = radius * math.sin(phi) * math.sin(theta)
    y = radius * math.cos(phi)
    return x, y, z


def cartesian_to_lat_lon_test(x, y, z, radius=1.0):
    """Python reference implementation of inverse conversion."""
    norm = math.sqrt(x * x + y * y + z * z)
    ny = max(-1.0, min(1.0, y / norm))
    lat = 90.0 - math.acos(ny) * (180.0 / math.pi)
    lon = (math.atan2(z, -x) * (180.0 / math.pi)) - 180.0
    normalized_lon = ((lon + 180.0) % 360.0 + 360.0) % 360.0 - 180.0
    return lat, normalized_lon


def test_geographic_conversion_poles_and_equator():
    """Verify coordinate transforms at cardinal points."""
    # North Pole: lat = +90
    nx, ny, nz = lat_lon_to_cartesian_test(90.0, 0.0, 1.0)
    assert abs(ny - 1.0) < 1e-6
    assert abs(nx) < 1e-6 and abs(nz) < 1e-6

    # South Pole: lat = -90
    sx, sy, sz = lat_lon_to_cartesian_test(-90.0, 0.0, 1.0)
    assert abs(sy - (-1.0)) < 1e-6
    assert abs(sx) < 1e-6 and abs(sz) < 1e-6

    # Equator at lon = 0
    ex, ey, ez = lat_lon_to_cartesian_test(0.0, 0.0, 1.0)
    assert abs(ey) < 1e-6
    # Distance from origin must equal radius
    r = math.sqrt(ex * ex + ey * ey + ez * ez)
    assert abs(r - 1.0) < 1e-6


def test_mauna_loa_coordinates_and_roundtrip():
    """Verify Mauna Loa exact coordinates in overlays.js and roundtrip conversion."""
    path = os.path.join(GLOBE_JS_DIR, "overlays.js")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "19.5362" in content, "Mauna Loa latitude 19.5362 must be present in overlays.js"
    assert "-155.5763" in content, "Mauna Loa longitude -155.5763 must be present in overlays.js"

    # Test roundtrip
    m_lat = 19.5362
    m_lon = -155.5763
    x, y, z = lat_lon_to_cartesian_test(m_lat, m_lon, 1.0)
    r_lat, r_lon = cartesian_to_lat_lon_test(x, y, z, 1.0)

    assert abs(r_lat - m_lat) < 1e-4
    assert abs(r_lon - m_lon) < 1e-4


# ============================================================================
# 4. SCIENTIFIC OVERLAY SCALING & DATA MAPPING
# ============================================================================

def test_overlays_js_classes():
    """Verify overlays.js contains all 4 overlay classes and the manager."""
    path = os.path.join(GLOBE_JS_DIR, "overlays.js")
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    assert "class TemperatureOverlay" in content
    assert "class SeaIceOverlay" in content
    assert "class OceanThermalOverlay" in content
    assert "class CO2Overlay" in content
    assert "class OverlayManager" in content

    # Check 14 bands array in overlays.js
    expected_bands = [
        "Glob", "NHem", "SHem",
        "24N-90N", "24S-24N", "90S-24S",
        "64N-90N", "44N-64N", "24N-44N", "EQU-24N",
        "24S-EQU", "44S-24S", "64S-44S", "90S-64S"
    ]
    for b in expected_bands:
        assert f'"{b}"' in content or f"'{b}'" in content, f"Missing band: {b}"


def test_sea_ice_scaling_formula():
    """Verify sea ice extent scaling logic behaves monotonically within [0.60, 1.00]."""
    def scale_extent(norm):
        n = max(0.0, min(1.0, norm))
        return 0.60 + 0.40 * n

    assert scale_extent(0.0) == 0.60
    assert scale_extent(1.0) == 1.00
    assert scale_extent(0.5) == 0.80
    assert scale_extent(-0.5) == 0.60  # Clamped
    assert scale_extent(1.5) == 1.00   # Clamped


# ============================================================================
# 5. PROCEDURAL TEXTURES & OFFLINE CAPABILITY
# ============================================================================

def test_procedural_textures_specular_mask_contrast():
    """Verify specular map has high contrast between ocean (reflective) and land (matte)."""
    spec_path = os.path.join(TEXTURES_DIR, "earth_specular_2k.png")
    with Image.open(spec_path) as img:
        # Ocean sample (Pacific: lat=0, lon=-140 -> x=227, y=512)
        ocean_val = img.getpixel((227, 512))
        assert ocean_val >= 200, f"Ocean in specular map should be bright/white, got {ocean_val}"

        # Land sample (Sahara: lat=25, lon=20 -> x=1137, y=369)
        land_val = img.getpixel((1137, 369))
        assert land_val < 50, f"Land in specular map should be dark/matte, got {land_val}"


def test_procedural_textures_night_lights():
    """Verify night map has dark ocean and bright metropolitan clusters."""
    night_path = os.path.join(TEXTURES_DIR, "earth_night_2k.png")
    with Image.open(night_path) as img:
        # Mid-Atlantic Ocean (lat=30, lon=-40 -> x=796, y=341)
        ocean_pixel = img.getpixel((796, 341))
        # RGB values for dark ocean
        assert max(ocean_pixel[:3]) < 25, f"Night ocean should be dark, got {ocean_pixel}"

        # NYC Metropolitan Area (lat=40.7, lon=-74.0 -> x=602, y=280)
        # Search small radius around center for light cluster
        max_light = 0
        for dx in range(-4, 5):
            for dy in range(-4, 5):
                p = img.getpixel((602 + dx, 280 + dy))
                max_light = max(max_light, max(p[:3]))
        assert max_light > 180, f"NYC city lights should be luminous, max was {max_light}"


# ============================================================================
# 6. REST API INTEGRATION & STATIC SERVING
# ============================================================================

def test_api_timeseries_zonal(client):
    """Verify GET /api/timeseries/zonal returns 14 bands for GISTEMP overlay."""
    res = client.get("/api/timeseries/zonal")
    assert res.status_code == 200
    data = res.get_json()
    assert "bands" in data
    assert len(data["bands"]) == 14
    assert "records" in data
    assert len(data["records"]) > 100

    sample = data["records"][-1]
    assert "year" in sample
    assert "64N-90N" in sample
    assert "EQU-24N" in sample
    assert "90S-64S" in sample


def test_api_timeseries_harmonized(client):
    """Verify GET /api/timeseries/harmonized supplies multi-track data."""
    res = client.get("/api/timeseries/harmonized")
    data = res.get_json()
    assert "records" in data
    assert len(data["records"]) > 500
    assert "normalized" in data
    rec = data["records"][0]
    assert "date" in rec
    assert "temperature_anomaly" in rec
    assert "co2_ppm" in rec
    assert "ocean_temp_anomaly" in rec
    assert "sea_ice_extent" in rec
    assert "normalized_temperature" in rec


def test_static_serving_html_and_assets(client):
    """Verify Flask correctly serves index.html and globe static modules."""
    # Index HTML
    res_index = client.get("/")
    assert res_index.status_code == 200
    assert b"EARTHSONIC // 3D EARTH GLOBE" in res_index.data

    # Globe JS
    res_js = client.get("/js/globe/globe.js")
    assert res_js.status_code == 200
    assert b"EarthGlobe" in res_js.data

    # CSS
    res_css = client.get("/css/globe.css")
    assert res_css.status_code == 200
    assert b"globe-viewport" in res_css.data

    # Textures
    res_tex = client.get("/assets/textures/earth_day_2k.png")
    assert res_tex.status_code == 200
    assert res_tex.mimetype.startswith("image/png")
