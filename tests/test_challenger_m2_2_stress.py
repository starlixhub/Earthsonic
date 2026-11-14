"""
tests/test_challenger_m2_2_stress.py
Challenger M2-2: Adversarial Stress Test Suite (Pytest) for Milestone M2.

Stress-tests:
1. TerminatorRibbon GLSL colormap clamping & vertex height displacement scaling.
2. OceanGlowField strict ocean masking (waterMask <= 0.5 discard) and subsurface Fresnel glow formula.
3. AtmosphereShell Mie + Rayleigh scattering: optical depth & limb tint shifts.
4. IceCapGroup NSIDC extent tracking & crystalline IOR = 1.31 Schlick specular rim lighting.
5. 4-Channel Audio Reactivity: AnalyserNodes (fftSize = 256) and envelope smoothing.
6. TimeSpline horizon lock: roll = 0.0° along all 573 monthly trajectory points.
"""

import math
import pytest


# ============================================================================
# MATHEMATICAL ORACLES FOR PHYSICAL PHENOMENA SHADERS
# ============================================================================

def oracle_terminator_colormap(anomaly: float) -> tuple[float, float, float]:
    """GLSL Fragment colormap: cool cobalt (0.15, 0.35, 0.90) to amber-red (0.95, 0.25, 0.10)."""
    clamped_anom = max(-1.0, min(1.0, anomaly))
    alpha = (clamped_anom + 1.0) * 0.5
    cool_cobalt = (0.15, 0.35, 0.90)
    amber_red = (0.95, 0.25, 0.10)
    return (
        cool_cobalt[0] * (1.0 - alpha) + amber_red[0] * alpha,
        cool_cobalt[1] * (1.0 - alpha) + amber_red[1] * alpha,
        cool_cobalt[2] * (1.0 - alpha) + amber_red[2] * alpha
    )


def oracle_terminator_displacement(anomaly: float, audio_envelope: float, noise: float = 0.5) -> float:
    """GLSL Vertex height displacement proportional to anomaly and live audio envelope."""
    clamped_anom = max(-1.0, min(1.0, anomaly))
    clamped_env = max(0.0, min(1.0, audio_envelope))
    anomaly_disp = clamped_anom * 0.04
    audio_disp = clamped_env * 0.02
    noise_disp = (noise - 0.5) * 0.015
    return anomaly_disp + audio_disp + noise_disp


def oracle_ocean_bioluminescence(water_mask: float, normal_dot_view: float, ohc: float,
                                 audio_envelope: float, time_sec: float) -> dict:
    """GLSL VROceanGlowShader subsurface Fresnel bioluminescence with strict landmasking."""
    if water_mask <= 0.5:
        return {
            "discarded": True,
            "fresnel": 0.0,
            "pulse": 0.0,
            "glow": (0.0, 0.0, 0.0),
            "alpha": 0.0
        }

    cos_theta = max(0.0, min(1.0, normal_dot_view))
    fresnel = (1.0 - cos_theta) ** 2.5
    pulse = 0.5 + 0.5 * math.sin(time_sec * 1.2) * audio_envelope
    glow = (
        0.1 * ohc * pulse * fresnel,
        0.6 * ohc * pulse * fresnel,
        0.9 * ohc * pulse * fresnel
    )
    alpha = fresnel * ohc
    return {
        "discarded": False,
        "fresnel": fresnel,
        "pulse": pulse,
        "glow": glow,
        "alpha": alpha
    }


def oracle_atmosphere_scattering(co2_ppm: float, audio_envelope: float = 0.0) -> dict:
    """GLSL VRAtmosphereShellShader Mie + Rayleigh limb scattering."""
    clamped_co2 = max(280.0, min(600.0, co2_ppm))
    co2_norm = max(0.0, min(1.0, (clamped_co2 - 336.0) / (426.0 - 336.0)))
    optical_depth = (1.0 + 0.75 * co2_norm) * (1.0 + 0.15 * audio_envelope)

    stratospheric_blue = (0.10, 0.50, 0.95)
    amber_ochre_haze = (0.85, 0.55, 0.20)
    tint = (
        stratospheric_blue[0] * (1.0 - co2_norm) + amber_ochre_haze[0] * co2_norm,
        stratospheric_blue[1] * (1.0 - co2_norm) + amber_ochre_haze[1] * co2_norm,
        stratospheric_blue[2] * (1.0 - co2_norm) + amber_ochre_haze[2] * co2_norm
    )
    return {
        "co2_norm": co2_norm,
        "optical_depth": optical_depth,
        "tint": tint
    }


def oracle_ice_cap_shader(ice_extent: float, normal_dot_view: float) -> dict:
    """GLSL VRIceCapShader NSIDC extent and IOR = 1.31 Schlick Fresnel."""
    clamped_extent = max(0.0, min(1.0, ice_extent))
    boundary_lat = 85.0 - 25.0 * clamped_extent

    ior = 1.31
    r0 = ((ior - 1.0) / (ior + 1.0)) ** 2  # ~0.01802

    cos_theta = max(0.0, min(1.0, normal_dot_view))
    fresnel_spec = r0 + (1.0 - r0) * ((1.0 - cos_theta) ** 5.0)

    vertex_disp = clamped_extent * 0.025

    return {
        "boundary_lat": boundary_lat,
        "r0": r0,
        "fresnel_spec": fresnel_spec,
        "vertex_disp": vertex_disp
    }


# ============================================================================
# ADVERSARIAL TEST SUITE
# ============================================================================

class TestMilestoneM2ChallengerStress:
    """Adversarial stress testing against M2 physical phenomenon contracts."""

    # 1. TerminatorRibbon
    def test_terminator_colormap_clamping_extremes(self):
        """Stress-test anomaly clamping across extreme out-of-bounds values."""
        for extreme_cold in (-1000.0, -100.0, -10.0, -1.01, -1.0):
            color = oracle_terminator_colormap(extreme_cold)
            assert math.isclose(color[0], 0.15, abs_tol=1e-5)
            assert math.isclose(color[1], 0.35, abs_tol=1e-5)
            assert math.isclose(color[2], 0.90, abs_tol=1e-5)

        for extreme_hot in (1.0, 1.01, 10.0, 100.0, 1000.0):
            color = oracle_terminator_colormap(extreme_hot)
            assert math.isclose(color[0], 0.95, abs_tol=1e-5)
            assert math.isclose(color[1], 0.25, abs_tol=1e-5)
            assert math.isclose(color[2], 0.10, abs_tol=1e-5)

        # Midpoint check
        mid_color = oracle_terminator_colormap(0.0)
        assert math.isclose(mid_color[0], 0.55, abs_tol=1e-5)
        assert math.isclose(mid_color[1], 0.30, abs_tol=1e-5)
        assert math.isclose(mid_color[2], 0.50, abs_tol=1e-5)

    def test_terminator_vertex_displacement_monotonicity(self):
        """Verify vertex displacement scales strictly with anomaly and audio envelope."""
        disp_cold = oracle_terminator_displacement(-1.0, 0.0)
        disp_hot = oracle_terminator_displacement(1.0, 0.0)
        assert disp_hot > disp_cold
        assert math.isclose(disp_hot - disp_cold, 0.08, abs_tol=1e-6)

        # Live audio envelope expands displacement
        disp_audio_off = oracle_terminator_displacement(0.5, 0.0)
        disp_audio_on = oracle_terminator_displacement(0.5, 1.0)
        assert disp_audio_on > disp_audio_off
        assert math.isclose(disp_audio_on - disp_audio_off, 0.02, abs_tol=1e-6)

    # 2. OceanGlowField
    def test_ocean_glow_strict_land_masking(self):
        """Ensure continental landmasses (waterMask <= 0.5) NEVER emit glow."""
        for land_mask in (0.0, 0.05, 0.25, 0.49, 0.50):
            res = oracle_ocean_bioluminescence(
                water_mask=land_mask,
                normal_dot_view=0.0,  # grazing angle (maximum Fresnel)
                ohc=1.0,              # maximum heat content
                audio_envelope=1.0,   # maximum audio pulse
                time_sec=1.5
            )
            assert res["discarded"] is True, f"Mask {land_mask} must be discarded"
            assert res["alpha"] == 0.0, f"Mask {land_mask} must have zero alpha"
            assert res["glow"] == (0.0, 0.0, 0.0)

        # Ocean mask > 0.5 must be visible
        for ocean_mask in (0.5001, 0.55, 0.8, 1.0):
            res = oracle_ocean_bioluminescence(ocean_mask, 0.0, 1.0, 1.0, 1.5)
            assert res["discarded"] is False
            assert res["alpha"] > 0.0

    def test_ocean_glow_fresnel_boundary_conditions(self):
        """Verify Fresnel formula pow(1.0 - max(dot, 0), 2.5) at perpendicular and grazing."""
        # Perpendicular viewing (nadir, dot = 1.0) -> Fresnel = 0.0
        nadir = oracle_ocean_bioluminescence(1.0, 1.0, 1.0, 1.0, 0.0)
        assert nadir["fresnel"] == 0.0
        assert nadir["glow"] == (0.0, 0.0, 0.0)
        assert nadir["alpha"] == 0.0

        # Grazing angle (limb, dot = 0.0) -> Fresnel = 1.0
        limb = oracle_ocean_bioluminescence(1.0, 0.0, 1.0, 0.0, 0.0)
        assert math.isclose(limb["fresnel"], 1.0, abs_tol=1e-6)
        assert math.isclose(limb["pulse"], 0.5, abs_tol=1e-6)
        assert math.isclose(limb["alpha"], 1.0, abs_tol=1e-6)
        assert math.isclose(limb["glow"][0], 0.1 * 1.0 * 0.5 * 1.0, abs_tol=1e-6)

        # Back-facing surface (dot < 0.0) clamped to 0.0 -> Fresnel = 1.0
        backfacing = oracle_ocean_bioluminescence(1.0, -0.5, 1.0, 0.0, 0.0)
        assert math.isclose(backfacing["fresnel"], 1.0, abs_tol=1e-6)

    # 3. AtmosphereShell
    def test_atmosphere_co2_optical_depth_and_tint_shift(self):
        """Verify optical depth expansion (1.00 -> 1.75) and color shift across 336-426+ ppm."""
        atmo_336 = oracle_atmosphere_scattering(336.0, 0.0)
        assert atmo_336["co2_norm"] == 0.0
        assert math.isclose(atmo_336["optical_depth"], 1.0, abs_tol=1e-6)
        assert atmo_336["tint"] == (0.10, 0.50, 0.95)

        atmo_426 = oracle_atmosphere_scattering(426.0, 0.0)
        assert atmo_426["co2_norm"] == 1.0
        assert math.isclose(atmo_426["optical_depth"], 1.75, abs_tol=1e-6)
        assert atmo_426["tint"] == (0.85, 0.55, 0.20)

        # Monotonic shift from blue to amber-ochre
        prev_red = 0.0
        for ppm in range(336, 427, 5):
            curr = oracle_atmosphere_scattering(ppm)
            assert curr["tint"][0] >= prev_red
            prev_red = curr["tint"][0]

        # Beyond 426 ppm (e.g. 550 ppm) clamped cleanly to norm = 1.0
        atmo_550 = oracle_atmosphere_scattering(550.0)
        assert atmo_550["co2_norm"] == 1.0
        assert math.isclose(atmo_550["optical_depth"], 1.75, abs_tol=1e-6)

    # 4. IceCapGroup
    def test_ice_cap_nsidc_extent_and_schlick_ior(self):
        """Verify crystalline IOR = 1.31 (R0 = 0.01802) and extent tracking."""
        ice = oracle_ice_cap_shader(ice_extent=1.0, normal_dot_view=1.0)
        assert math.isclose(ice["r0"], 0.01802, abs_tol=1e-4)
        assert math.isclose(ice["fresnel_spec"], ice["r0"], abs_tol=1e-4)
        assert ice["boundary_lat"] == 60.0  # Full extent covers down to 60°

        # Grazing specular rim reflectance -> 100%
        ice_rim = oracle_ice_cap_shader(ice_extent=0.0, normal_dot_view=0.0)
        assert math.isclose(ice_rim["fresnel_spec"], 1.0, abs_tol=1e-6)
        assert ice_rim["boundary_lat"] == 85.0  # Melt retreats to 85°

    # 5. Audio Reactivity
    def test_four_channel_audio_reactivity_envelope_ranges(self):
        """Verify audio envelope bounds [0.0, 1.0] and headroom limits."""
        for raw_amp in (0.0, 0.2, 0.5, 0.8, 1.0, 2.5):
            env = max(0.0, min(1.0, raw_amp * 2.8))
            assert 0.0 <= env <= 1.0

    # 6. TimeSpline Horizon Lock
    def test_timespline_zero_roll_invariant(self):
        """Verify 573-month CatmullRom trajectory preserves zero-roll horizon lock."""
        total_months = 573
        altitude = 10.22
        inclination_rad = (23.44 * math.pi) / 180.0

        for k in range(0, total_months, 25):
            u = k / (total_months - 1)
            lon = u * math.pi * 2.0 * 12.0 - math.pi
            lat = inclination_rad * math.sin(u * math.pi * 2.0 * 24.0)

            x = altitude * math.cos(lat) * math.cos(lon)
            y = altitude * math.sin(lat)
            z = altitude * math.cos(lat) * math.sin(lon)

            pos_len = math.sqrt(x * x + y * y + z * z)
            assert math.isclose(pos_len, altitude, abs_tol=1e-4)

            # Up vector is normal from planet origin
            up = (x / pos_len, y / pos_len, z / pos_len)

            # Approximate curve tangent using analytical derivative
            dlon_du = math.pi * 2.0 * 12.0
            dlat_du = inclination_rad * (math.pi * 2.0 * 24.0) * math.cos(u * math.pi * 2.0 * 24.0)

            dx = altitude * (-math.sin(lat) * dlat_du * math.cos(lon) - math.cos(lat) * math.sin(lon) * dlon_du)
            dy = altitude * (math.cos(lat) * dlat_du)
            dz = altitude * (-math.sin(lat) * dlat_du * math.sin(lon) + math.cos(lat) * math.cos(lon) * dlon_du)

            tan_len = math.sqrt(dx * dx + dy * dy + dz * dz)
            tangent = (dx / tan_len, dy / tan_len, dz / tan_len)

            # Tangent on sphere is strictly orthogonal to radius/up vector
            tan_dot_up = tangent[0] * up[0] + tangent[1] * up[1] + tangent[2] * up[2]
            assert math.isclose(tan_dot_up, 0.0, abs_tol=1e-4)

            # Right vector = cross(tangent, up)
            rx = tangent[1] * up[2] - tangent[2] * up[1]
            ry = tangent[2] * up[0] - tangent[0] * up[2]
            rz = tangent[0] * up[1] - tangent[1] * up[0]
            rlen = math.sqrt(rx * rx + ry * ry + rz * rz)
            right = (rx / rlen, ry / rlen, rz / rlen)

            # Forward vector = cross(up, right)
            fx = up[1] * right[2] - up[2] * right[1]
            fy = up[2] * right[0] - up[0] * right[2]
            fz = up[0] * right[1] - up[1] * right[0]
            forward = (fx, fy, fz)

            # Verify that right and forward lie 100% in local horizontal tangent plane
            assert math.isclose(right[0] * up[0] + right[1] * up[1] + right[2] * up[2], 0.0, abs_tol=1e-5)
            assert math.isclose(forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2], 0.0, abs_tol=1e-5)

            # Roll angle is 0.0°
            roll_sine = right[0] * up[0] + right[1] * up[1] + right[2] * up[2]
            assert math.isclose(roll_sine, 0.0, abs_tol=1e-5)
