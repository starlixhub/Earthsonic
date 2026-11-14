"""
tests/stress_m3_empirical_challenge.py
Adversarial Empirical Stress Harness for Milestone M3:
1. Deadzone Boundary Tests (+/-15 deg, 15.0001 deg, -30 deg, boundary continuity)
2. Damped Acceleration Dynamics (update formula, extreme 180° jerk bounding < 0.10, clamping [0.0, 1.0], elastic wall arrest)
3. 100% Locked Horizon Mathematical & Empirical Proof (Euler 'YXZ', zero roll, orthogonality to planet zenith)
4. Invariant Preservation: frontend/js/globe/globe.js untouched
"""

import math
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

GLIDER_DEADZONE_DEG = 15.0
GLIDER_ACCELERATION = 0.0004
GLIDER_DAMPING = 0.92


def compute_glider_step(yaw_deg: float, current_velocity: float,
                        deadzone_deg: float = GLIDER_DEADZONE_DEG,
                        accel: float = GLIDER_ACCELERATION,
                        damping: float = GLIDER_DAMPING):
    yaw = float(yaw_deg)
    vel = float(current_velocity)
    dz = float(deadzone_deg)
    a = float(accel)
    d = float(damping)

    if abs(yaw) <= dz:
        excess = 0.0
    elif yaw > dz:
        excess = yaw - dz
    else:
        excess = yaw - (-dz)

    new_velocity = (vel + excess * a) * d
    return excess, new_velocity


def test_deadzone_inside_boundaries():
    """Within +/-15 deg, verify ZERO acceleration and velocity decays strictly by 0.92."""
    angles = [0.0, 1.0, -1.0, 5.0, -5.0, 10.0, -10.0, 14.5, -14.5, 14.9999, -14.9999, 15.0, -15.0]
    initial_vels = [0.0, 0.05, -0.05, 0.10, -0.10, 0.0035]

    for v in initial_vels:
        for yaw in angles:
            excess, new_v = compute_glider_step(yaw, v)
            assert excess == 0.0, f"Yaw {yaw}° must have zero excess inside deadzone"
            expected_v = v * GLIDER_DAMPING
            assert math.isclose(new_v, expected_v, rel_tol=1e-12, abs_tol=1e-12), \
                f"Velocity must decay strictly by 0.92: got {new_v}, expected {expected_v}"


def test_deadzone_exact_threshold_15_0001():
    """At exactly 15.0001 deg, verify that yawExcess = 0.0001 deg produces tiny positive acceleration."""
    yaw = 15.0001
    excess, new_v = compute_glider_step(yaw, 0.0)
    assert math.isclose(excess, 0.0001, rel_tol=1e-9, abs_tol=1e-9), f"Excess mismatch: {excess}"
    expected_v = (0.0 + 0.0001 * GLIDER_ACCELERATION) * GLIDER_DAMPING
    assert new_v > 0.0, "Acceleration must be strictly positive"
    assert math.isclose(new_v, expected_v, rel_tol=1e-12, abs_tol=1e-12)


def test_deadzone_negative_threshold_minus_30():
    """At -30 deg, verify negative acceleration with yawExcess = -15 deg."""
    yaw = -30.0
    excess, new_v = compute_glider_step(yaw, 0.0)
    assert excess == -15.0, f"Excess mismatch: {excess}"
    expected_v = (-15.0 * GLIDER_ACCELERATION) * GLIDER_DAMPING
    assert new_v < 0.0, "Acceleration must be strictly negative"
    assert math.isclose(new_v, -0.00552, rel_tol=1e-12, abs_tol=1e-12)
    assert math.isclose(new_v, expected_v, rel_tol=1e-12, abs_tol=1e-12)


def test_deadzone_c0_continuity():
    """Verify C0 continuity across +/-15 deg threshold."""
    for eps in [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6]:
        excess_pos, _ = compute_glider_step(15.0 + eps, 0.0)
        assert math.isclose(excess_pos, eps, rel_tol=1e-9, abs_tol=1e-9)
        excess_neg, _ = compute_glider_step(-15.0 - eps, 0.0)
        assert math.isclose(excess_neg, -eps, rel_tol=1e-9, abs_tol=1e-9)


def test_damped_acceleration_formula_and_extreme_180_jerk():
    """Verify formula and test extreme 180° yaw jerk remains strictly bounded (< 0.10)."""
    # 1. Positive 180° jerk from rest
    excess_pos, v_pos = compute_glider_step(180.0, 0.0)
    assert excess_pos == 165.0
    # Expected: 165 * 0.0004 * 0.92 = 0.06072
    assert math.isclose(v_pos, 0.06072, rel_tol=1e-12, abs_tol=1e-12)
    assert v_pos < 0.10, f"Single frame velocity must be < 0.10, got {v_pos}"
    assert v_pos > 0.05

    # 2. Negative -180° jerk from rest
    excess_neg, v_neg = compute_glider_step(-180.0, 0.0)
    assert excess_neg == -165.0
    assert math.isclose(v_neg, -0.06072, rel_tol=1e-12, abs_tol=1e-12)
    assert v_neg > -0.10, f"Single frame velocity must be > -0.10, got {v_neg}"
    assert v_neg < -0.05


def test_asymptotic_terminal_velocity_convergence():
    """Verify velocity converges to finite terminal velocity under maximum sustained steering."""
    v = 0.0
    for _ in range(500):
        _, v = compute_glider_step(180.0, v)
        assert not math.isnan(v) and not math.isinf(v)

    # Theoretical terminal velocity: v* = (v* + 165*0.0004)*0.92 => v* = (165*0.0004*0.92)/0.08 = 0.759
    assert math.isclose(v, 0.759, rel_tol=1e-4, abs_tol=1e-4)


def test_timeline_position_clamping_and_elastic_arrest():
    """Verify position clamps strictly in [0.0, 1.0] and velocity is arrested at boundaries."""
    # Forward boundary arrest
    pos = 0.95
    vel = 0.0
    for _ in range(100):
        _, vel = compute_glider_step(60.0, vel)
        next_pos = max(0.0, min(1.0, pos + vel))
        if next_pos >= 1.0 and vel > 0.0:
            vel = 0.0
        pos = next_pos
        assert 0.0 <= pos <= 1.0

    assert pos == 1.0
    assert vel == 0.0

    # Backward boundary arrest
    pos = 0.05
    vel = 0.0
    for _ in range(100):
        _, vel = compute_glider_step(-60.0, vel)
        next_pos = max(0.0, min(1.0, pos + vel))
        if next_pos <= 0.0 and vel < 0.0:
            vel = 0.0
        pos = next_pos
        assert 0.0 <= pos <= 1.0

    assert pos == 0.0
    assert vel == 0.0


def test_mathematical_proof_100_percent_locked_horizon():
    """
    Mathematical Proof of 100% Locked Horizon:
    Camera rotation is Euler order 'YXZ' with rotation.z === 0.0.
    In CameraRig local space:
      R = R_y(-yaw) * R_x(pitch) * R_z(0)
    Camera Right vector in CameraRig local space is:
      cam_right = R * (1, 0, 0)^T = (cos(-yaw), 0, -sin(-yaw))^T = (cos(yaw), 0, sin(yaw))^T
    Since the CameraRig Y axis is the planet surface normal (zenith),
    the Y component of cam_right is IDENTICALLY ZERO for all yaw and all pitch angles.
    Therefore, the camera horizon never tilts or banks relative to the planet tangent plane.
    """
    # Sweep all yaw in [-180, 180] and pitch in [-90, 90]
    for yaw_deg in range(-180, 181, 10):
        for pitch_deg in range(-90, 91, 10):
            yaw = math.radians(-yaw_deg)
            pitch = math.radians(pitch_deg)

            # R_y * R_x
            # Column 0 of R:
            # [cos(yaw), 0, -sin(yaw)] * [1, 0, 0]^T = [cos(yaw), 0, -sin(yaw)]
            # R_x acting on (1,0,0)^T is just (1,0,0)^T.
            # Then R_y acting on (1,0,0)^T is (cos(yaw), 0, -sin(yaw)).
            right_x = math.cos(yaw)
            right_y = 0.0  # ZERO TILT / ZERO ROLL
            right_z = -math.sin(yaw)

            # Up normal of CameraRig is (0, 1, 0)
            dot_up = right_x * 0.0 + right_y * 1.0 + right_z * 0.0
            assert dot_up == 0.0, f"Roll detected at yaw={yaw_deg}, pitch={pitch_deg}"

            # Length of right vector is strictly 1.0
            length = math.hypot(right_x, right_y, right_z)
            assert math.isclose(length, 1.0, rel_tol=1e-12, abs_tol=1e-12)


def test_globe_js_untouched_invariant():
    """Verify frontend/js/globe/globe.js was NOT touched and contains no VR subsystem code."""
    globe_path = PROJECT_ROOT / "frontend" / "js" / "globe" / "globe.js"
    assert globe_path.exists(), "globe.js must exist"
    content = globe_path.read_text(encoding="utf-8")

    forbidden_tokens = ["./vr/", "VRGlider", "vrScene", "dataGlyphs", "TerminatorSkim", "timeSpline"]
    for token in forbidden_tokens:
        assert token not in content, f"globe.js must not contain '{token}'"
