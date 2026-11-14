/**
 * tests/test_vr_glider_node.mjs
 * Verification of Milestone M3: VR Glider Navigation & 100% Locked Horizon.
 * Babylon.js port (VR-MIGRATION-2026):
 *   - VR-GLIDE-01 / VR-GLIDE-02: 1:1 ports (pure deterministic math, no engine).
 *   - VR-GLIDE-03: mock THREE.PerspectiveCamera replaced by a real
 *     BABYLON.UniversalCamera on NullEngine. The rewrite of the Euler-order
 *     probe: three.js asserted rotation.order === 'YXZ'; Babylon composes
 *     rotation as RotationYawPitchRoll(y, x, z) — the port instead asserts the
 *     INVARIANT that matters (roll === 0.0 at all times, both axes preserved).
 *     (Sign conventions: Babylon +yaw right / -pitch up — see vr_glider.js.)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

import {
  computeGliderStep,
  enforceZeroRoll,
  VRGliderNavigation,
  VRGlider,
  GLIDER_DEADZONE_DEG,
  GLIDER_ACCELERATION,
  GLIDER_DAMPING
} from '../frontend/js/globe/vr/vr_glider.js';

const DEG_TO_RAD = Math.PI / 180.0;

describe('Milestone M3: VR Glider Navigation & Locked Horizon', () => {

  it('VR-GLIDE-01: Glider Step Physics and Deadzone Constants', () => {
    assert.equal(GLIDER_DEADZONE_DEG, 15.0);
    assert.equal(GLIDER_ACCELERATION, 0.0004);
    assert.equal(GLIDER_DAMPING, 0.92);

    // 1. Inside deadzone: +10 deg
    const r1 = computeGliderStep(10.0, 0.0);
    assert.equal(r1.excess, 0.0);
    assert.equal(r1.newVelocity, 0.0);

    // 2. Inside deadzone: -14.9 deg
    const r2 = computeGliderStep(-14.9, 0.0);
    assert.equal(r2.excess, 0.0);
    assert.equal(r2.newVelocity, 0.0);

    // 3. Exact deadzone boundary: +15.0 deg
    const r3 = computeGliderStep(15.0, 0.0);
    assert.equal(r3.excess, 0.0);

    // 4. Exact deadzone boundary: -15.0 deg
    const r4 = computeGliderStep(-15.0, 0.0);
    assert.equal(r4.excess, 0.0);

    // 5. Just outside deadzone: +15.001 deg
    const r5 = computeGliderStep(15.001, 0.0);
    assert.ok(Math.abs(r5.excess - 0.001) < 1e-6);

    // 6. Just outside deadzone: -15.001 deg
    const r6 = computeGliderStep(-15.001, 0.0);
    assert.ok(Math.abs(r6.excess - (-0.001)) < 1e-6);

    // 7. Right turn: +35.0 deg
    const r7 = computeGliderStep(35.0, 0.0);
    assert.equal(r7.excess, 20.0);
    assert.ok(Math.abs(r7.newVelocity - (20.0 * 0.0004 * 0.92)) < 1e-6);

    // 8. Extreme yaw jerk: 180.0 deg
    const r8 = computeGliderStep(180.0, 0.0);
    assert.equal(r8.excess, 165.0);
    assert.ok(r8.newVelocity < 0.1, 'Single frame velocity from 180 deg jerk must remain smooth (<0.1)');

    // 9. Damping decay: yaw = 0, initial vel = 1.0
    const r9 = computeGliderStep(0.0, 1.0);
    assert.ok(Math.abs(r9.newVelocity - 0.92) < 1e-6);
  });

  it('VR-GLIDE-02: 100% Locked Horizon Zero Roll Invariant', () => {
    // 1. Standard pitch and yaw
    const h1 = enforceZeroRoll(-18.0, 45.0, 10.0);
    assert.equal(h1.pitch, -18.0);
    assert.equal(h1.yaw, 45.0);
    assert.equal(h1.roll, 0.0);

    // 2. Zenith pitch +90 deg enforces roll = 0.0
    const h2 = enforceZeroRoll(90.0, 0.0, 25.0);
    assert.equal(h2.pitch, 90.0);
    assert.equal(h2.roll, 0.0);

    // 3. Nadir pitch -90 deg enforces roll = 0.0
    const h3 = enforceZeroRoll(-90.0, 0.0, -25.0);
    assert.equal(h3.pitch, -90.0);
    assert.equal(h3.roll, 0.0);

    // 4. Over-pitch clamping
    const h4 = enforceZeroRoll(110.0, 0.0, 0.0);
    assert.equal(h4.pitch, 90.0);
    const h5 = enforceZeroRoll(-110.0, 0.0, 0.0);
    assert.equal(h5.pitch, -90.0);

    // 5. Yaw wrap-around (370 deg -> 10 deg)
    const h6 = enforceZeroRoll(0.0, 370.0, 0.0);
    assert.ok(Math.abs(h6.yaw - 10.0) < 1e-4);
  });

  it('VR-GLIDE-03: VRGliderNavigation Class Instance Lifecycle & Physics', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    scene.activeCamera = null;

    const mockCamera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);
    const mockRig = new BABYLON.TransformNode('CameraRig', scene);
    mockCamera.parent = mockRig;

    const mockScene = {
      camera: mockCamera,
      cameraRig: mockRig,
      updateTimeline: (t) => { mockScene.lastT = t; }
    };

    let scrubCalledWith = -1;
    const glider = new VRGliderNavigation(mockScene, {
      onTimelineScrub: (t) => { scrubCalledWith = t; }
    });

    assert.equal(glider.getTimelinePosition(), 0.0);
    assert.equal(glider.getTimelineVelocity(), 0.0);
    assert.equal(glider.getLookAngles().rollDeg, 0.0);

    // Set programmatic angles
    glider.setLookAngles(35.0, -18.0);
    assert.equal(glider.yawDeg, 35.0);
    assert.equal(glider.pitchDeg, -18.0);
    assert.equal(glider.rollDeg, 0.0);

    // Camera rotation applied via Babylon Euler path with roll locked
    assert.ok(!mockCamera.rotationQuaternion, 'Euler path must drive the camera (quaternion never engaged)');
    assert.equal(mockCamera.rotation.z, 0.0);
    // Yaw 35 (right) -> Babylon +Y rotation; pitch -18 (down) -> BABYLON +X rotation
    assert.ok(Math.abs(mockCamera.rotation.y - (35.0 * DEG_TO_RAD)) < 1e-9);
    assert.ok(Math.abs(mockCamera.rotation.x - (18.0 * DEG_TO_RAD)) < 1e-9);

    // Step physics with yaw = 35.0
    const step1 = glider.stepPhysics(35.0);
    assert.equal(step1.excess, 20.0);
    assert.ok(step1.newVelocity > 0.0);
    assert.ok(step1.newPosition > 0.0);

    // Frame update advances timeline
    glider.enable();
    glider.update(0.016);
    assert.ok(glider.getTimelinePosition() > 0.0);
    assert.ok(scrubCalledWith > 0.0);
    assert.equal(mockCamera.rotation.z, 0.0); // roll remains 0.0

    // Elastic wall clamp at 1.0
    glider.setTimelinePosition(1.0);
    glider.timelineVelocity = 0.05;
    glider.stepPhysics(35.0);
    assert.equal(glider.getTimelinePosition(), 1.0);
    assert.equal(glider.getTimelineVelocity(), 0.0); // arrested at wall

    // Elastic wall clamp at 0.0
    glider.setTimelinePosition(0.0);
    glider.timelineVelocity = -0.05;
    glider.stepPhysics(-35.0);
    assert.equal(glider.getTimelinePosition(), 0.0);
    assert.equal(glider.getTimelineVelocity(), 0.0); // arrested at wall

    // Recenter
    glider.recenter();
    assert.equal(glider.yawDeg, 0.0);
    assert.equal(glider.pitchDeg, 0.0);
    assert.equal(glider.rollDeg, 0.0);
    assert.equal(glider.timelineVelocity, 0.0);
    assert.equal(mockCamera.rotation.z, 0.0);

    glider.dispose();
    engine.dispose();
  });
});
