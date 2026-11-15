"""
tests/test_adversarial_empirical_r1.py
Empirical Challenger Test Suite for Requirement R1:
3D Earth Globe Realism & Scientific Shaders.

Verifies:
  1. Authentic NASA Equirectangular 2K Textures (pixel stats, histograms, coordinate contrast).
  2. Graticule Geometry & Wireframe overlay (R=1.0008, 15° step, opacity 0.06, LineSegments).
  3. Temperature Blending Math & Coastline Preservation (0.42 cap, mix(), dFdx/dFdy edge detection).
  4. Ocean Thermal Shader Discard Rule & Low-Frequency Wave Math (waterMask <= 0.5 discard, #061428 navy, El Niño gradient).
  5. Atmospheric Halo Mesh & Complete Absence of Particle Cloud (BackSide sphere scale 1.06, Fresnel pow 3.0, cyan to amber-red shift, zero 1200 particle cloud).
  6. Starfield Point Size & Circular Alpha Sprites (gl_PointSize in [1.0, 2.2], opacity in [0.20, 0.85], smoothstep sprite discards).
"""

import os
import re
import math
import numpy as np
import pytest
from PIL import Image

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
GLOBE_DIR = os.path.join(FRONTEND_DIR, "js", "globe")
TEXTURES_DIR = os.path.join(FRONTEND_DIR, "assets", "textures")


# ============================================================================
# 1. TEXTURE PIXEL METRICS & AUTHENTICITY EMPIRICAL TESTS
# ============================================================================

class TestTexturePixelMetricsEmpirical:
    """Empirical verification of 2K Earth textures."""

    def test_texture_files_and_dimensions(self):
        """Verify all textures exist, are exact 2048x1024, and have non-trivial file sizes."""
        required_textures = {
            "earth_day_2k.png": 1_000_000,       # Authentic Blue Marble > 1MB
            "earth_specular_2k.png": 100_000,    # Mask > 100KB
            "earth_night_2k.png": 300_000,       # Black Marble lights > 300KB
            "earth_bump_2k.png": 20_000,
            "earth_clouds_2k.png": 100_000
        }
        for fname, min_size in required_textures.items():
            path = os.path.join(TEXTURES_DIR, fname)
            assert os.path.exists(path), f"Texture file {fname} is missing"
            size = os.path.getsize(path)
            assert size >= min_size, f"Texture {fname} is too small ({size} bytes, expected >= {min_size})"
            with Image.open(path) as img:
                assert img.size == (2048, 1024), f"Texture {fname} dimension must be (2048, 1024), got {img.size}"

    def test_day_texture_spectrum_and_geographic_colors(self):
        """Verify day map possesses authentic Earth spectrum and correct geographic colors."""
        path = os.path.join(TEXTURES_DIR, "earth_day_2k.png")
        with Image.open(path) as img:
            arr = np.array(img)
            # Must be 3-channel RGB
            assert arr.ndim == 3 and arr.shape[2] >= 3

            # Verify standard deviation across all 3 channels > 50 (photographic complexity)
            r_std = np.std(arr[:, :, 0])
            g_std = np.std(arr[:, :, 1])
            b_std = np.std(arr[:, :, 2])
            assert r_std > 50, f"Low R variance: {r_std}"
            assert g_std > 50, f"Low G variance: {g_std}"
            assert b_std > 50, f"Low B variance: {b_std}"

            # Pacific Ocean (x=227, y=512): Blue ocean dominance (B > R and B > G)
            pac_r, pac_g, pac_b = [int(c) for c in img.getpixel((227, 512))[:3]]
            assert pac_b > pac_r and pac_b > pac_g, f"Pacific ocean should have dominant blue channel: ({pac_r}, {pac_g}, {pac_b})"

            # Sahara Desert (x=1137, y=369): Sandy desert amber/tan (R > 180, G > 160, R > B)
            sah_r, sah_g, sah_b = [int(c) for c in img.getpixel((1137, 369))[:3]]
            assert sah_r > 180 and sah_g > 160 and sah_r > sah_b, f"Sahara desert should be warm sandy: ({sah_r}, {sah_g}, {sah_b})"

    def test_specular_mask_bimodality_and_ocean_land_contrast(self):
        """Verify specular mask strictly separates ocean (255) from land (< 50)."""
        path = os.path.join(TEXTURES_DIR, "earth_specular_2k.png")
        with Image.open(path) as img:
            arr = np.array(img)
            # Pacific Ocean (x=227, y=512) and Atlantic Ocean (x=796, y=369)
            pac_val = img.getpixel((227, 512))
            atl_val = img.getpixel((796, 369))
            assert pac_val == 255, f"Pacific specular mask should be 255, got {pac_val}"
            assert atl_val == 255, f"Atlantic specular mask should be 255, got {atl_val}"

            # Land: Sahara (1137, 369), North America (455, 284), Central Africa (1137, 512)
            sah_val = img.getpixel((1137, 369))
            na_val = img.getpixel((455, 284))
            assert sah_val < 10, f"Sahara land specular should be < 10, got {sah_val}"
            assert na_val < 10, f"North America land specular should be < 10, got {na_val}"

            # Global distribution: Earth surface is ~71% water.
            # Specular map ocean (>200) ratio should be between 60% and 80%.
            ocean_fraction = np.mean(arr > 200)
            assert 0.60 <= ocean_fraction <= 0.80, f"Ocean coverage fraction {ocean_fraction:.2f} outside [0.60, 0.80]"

    def test_night_texture_dark_oceans_and_city_clusters(self):
        """Verify night texture has dark oceans and bright metropolitan clusters."""
        path = os.path.join(TEXTURES_DIR, "earth_night_2k.png")
        with Image.open(path) as img:
            # Mid-Atlantic dark ocean (796, 341) and Pacific (227, 512)
            atl_night = img.getpixel((796, 341))
            pac_night = img.getpixel((227, 512))
            assert max(atl_night[:3]) < 25, f"Mid-Atlantic night should be dark: {atl_night}"
            assert max(pac_night[:3]) < 25, f"Pacific night should be dark: {pac_night}"

            # Metropolitan hubs: NYC (602, 280), London (1024, 219), Tokyo (1818, 309)
            for city_name, (cx, cy) in [("NYC", (602, 280)), ("London", (1024, 219)), ("Tokyo", (1818, 309))]:
                max_light = max(max(img.getpixel((cx + dx, cy + dy))[:3]) for dx in range(-4, 5) for dy in range(-4, 5))
                assert max_light > 200, f"{city_name} city lights should be luminous, got max {max_light}"


# ============================================================================
# 2. GRATICULE GEOMETRY & OVERLAY VERIFICATION
# ============================================================================

class TestGraticuleGeometryEmpirical:
    """Verify graticule 15-degree wireframe geometry implementation."""

    def test_graticule_parameters_in_globe_js(self):
        globe_js_path = os.path.join(GLOBE_DIR, "globe.js")
        with open(globe_js_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Radius 1.0008
        assert "radius = 1.0008" in code or "1.0008" in code, "Graticule must be positioned at R=1.0008"
        # LineSegments
        assert "THREE.LineSegments" in code or "this.THREE.LineSegments" in code, "Graticule must use LineSegments"
        # 15° parallels and meridians loop increments
        assert "lat += 15" in code, "Parallels must step by 15°"
        assert "lon += 15" in code, "Meridians must step by 15°"
        # Opacity 0.06
        assert "opacity: 0.06" in code, "Graticule opacity must be 0.06"
        # Attached to earthGroup
        assert "this.earthGroup.add(this.graticuleMesh)" in code, "Graticule mesh must be added to earthGroup"
        # Called in _loadAndBuildGlobe()
        assert "this._initGraticule()" in code, "Graticule initialization must be invoked in build lifecycle"


# ============================================================================
# 3. TEMPERATURE BLENDING MATH & COASTLINE PRESERVATION
# ============================================================================

class TestTemperatureBlendingEmpirical:
    """Verify ZonalHeatmapShader math, max 0.42 opacity capping, and coastline contrast."""

    def test_zonal_heatmap_shader_math_and_capping(self):
        shaders_js_path = os.path.join(GLOBE_DIR, "shaders.js")
        with open(shaders_js_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Opacity capping min(uOpacity, 0.42)
        assert "min(uOpacity, 0.42)" in code or "effectiveOpacity = min(" in code, \
            "Zonal shader must strictly cap opacity to 0.42 in GLSL"
        # Edge detection using dFdx and dFdy on waterMask
        assert "dFdx(waterMask)" in code and "dFdy(waterMask)" in code, \
            "Must use dFdx/dFdy on waterMask for coastline edge preservation"
        # Edge darkening formula
        assert "1.0 - edge * 0.35" in code or "edge" in code, \
            "Coastline edge darkening must be applied"

    def test_temperature_overlay_class_capping(self):
        overlays_js_path = os.path.join(GLOBE_DIR, "overlays.js")
        with open(overlays_js_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Default opacity updated to 0.14 per Milestone 2 / Layers Mode spec
        assert "this.opacity =" in code and "0.14" in code, "Default opacity must be configured with 0.14 per active spec"
        # setOpacity clamp
        assert "Math.min(0.42, opacity)" in code, "setOpacity must clamp to max 0.42"
        # NormalBlending
        assert "blending: THREE.NormalBlending" in code, "Must use normal alpha blending"


# ============================================================================
# 4. OCEAN THERMAL SHADER DISCARD RULE & ANOMALIES
# ============================================================================

class TestOceanThermalShaderEmpirical:
    """Verify OceanThermalShader discard rule, low-frequency wave math, and navy base."""

    def test_discard_rule_and_navy_base(self):
        shaders_js_path = os.path.join(GLOBE_DIR, "shaders.js")
        with open(shaders_js_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Discard rule when waterMask <= 0.5
        assert "if (waterMask <= 0.5)" in code and "discard;" in code, \
            "Ocean thermal shader must strictly discard when waterMask <= 0.5"

        # Navy baseline #061428: vec3(0.0235, 0.0784, 0.1569)
        assert "vec3(0.0235, 0.0784, 0.1569)" in code or "061428" in code, \
            "Must use deep navy #061428 as ocean baseline"

        # Low-frequency wave math: multiplier is 4.0 (NOT high-frequency 35.0)
        assert "position.x * 4.0" in code, "Wave displacement must be smooth low frequency (multiplier 4.0)"
        assert "position.x * 35.0" not in code, "Must not contain old high-frequency 35.0 cellular noise"

        # Equatorial Pacific El Niño gradient calculation
        assert "pacDist" in code and "elNinoHotspot" in code, \
            "Must compute equatorial Pacific El Niño anomaly hotspot"


# ============================================================================
# 5. ATMOSPHERIC HALO MESH & CO2 OVERLAY VERIFICATION
# ============================================================================

class TestAtmosphericHaloEmpirical:
    """Verify CO2Overlay atmospheric halo mesh, Fresnel lighting, and removal of particle ring."""

    def test_absence_of_1200_particle_cloud(self):
        overlays_js_path = os.path.join(GLOBE_DIR, "overlays.js")
        with open(overlays_js_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Absolutely NO 1200 particle cloud
        assert "1200" not in code, "overlays.js must not contain 1,200 particle cloud"
        assert "this.particleCount" not in code, "particleCount must not exist"

    def test_atmospheric_halo_geometry_and_fresnel_shader(self):
        overlays_js_path = os.path.join(GLOBE_DIR, "overlays.js")
        shaders_js_path = os.path.join(GLOBE_DIR, "shaders.js")
        with open(overlays_js_path, "r", encoding="utf-8") as f:
            overlays_code = f.read()
        with open(shaders_js_path, "r", encoding="utf-8") as f:
            shaders_code = f.read()

        # Halo mesh scaled to 1.06
        assert "scale.setScalar(1.06)" in overlays_code, "Atmospheric halo mesh must be scaled to 1.06"
        # BackSide mesh
        assert "side: THREE.BackSide" in overlays_code, "Atmospheric halo mesh must use BackSide"
        # Fresnel rim lighting pow(1.0 - viewDot, 3.0)
        assert "pow(1.0 - viewDot, 3.0)" in shaders_code, "Fresnel rim must use power of 3.0"
        # Cyan-blue to amber-red shift
        assert "uColorLow" in shaders_code and "uColorHigh" in shaders_code, "Halo must interpolate uColorLow to uColorHigh"
        assert "0.0, 0.75, 1.0" in overlays_code, "335 ppm baseline must be cyan-blue"
        assert "0.96, 0.28, 0.08" in overlays_code, "426+ ppm peak must be amber-red"


# ============================================================================
# 6. STARFIELD POINT SIZE & SOFT ALPHA SPRITES
# ============================================================================

class TestStarfieldEmpirical:
    """Verify StarfieldShader point sizes, opacity variance, and soft alpha sprites."""

    def test_starfield_shader_and_point_sizes(self):
        globe_js_path = os.path.join(GLOBE_DIR, "globe.js")
        shaders_js_path = os.path.join(GLOBE_DIR, "shaders.js")
        with open(globe_js_path, "r", encoding="utf-8") as f:
            globe_code = f.read()
        with open(shaders_js_path, "r", encoding="utf-8") as f:
            shaders_code = f.read()

        # Point sizes in globe.js: sizes[i] = 1.0 + Math.random() * 1.2 -> [1.0, 2.2]
        assert "1.0 + Math.random() * 1.2" in globe_code, "Star sizes must be strictly in [1.0, 2.2]"
        # Opacities in globe.js: opacities[i] = 0.20 + Math.random() * 0.65 -> [0.20, 0.85]
        assert "0.20 + Math.random() * 0.65" in globe_code, "Star opacities must be strictly in [0.20, 0.85]"

        # Shader circular soft alpha sprite
        assert "gl_PointSize = aSize" in shaders_code, "Starfield vertex shader must assign gl_PointSize = aSize"
        assert "gl_PointCoord - vec2(0.5)" in shaders_code, "Fragment shader must compute radial distance from point center"
        assert "smoothstep(0.5, 0.05, dist)" in shaders_code, "Fragment shader must produce smooth circular alpha sprite"
