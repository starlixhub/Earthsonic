/**
 * tests/stress_m3_empirical_challenge.mjs
 * Adversarial Empirical Verification Suite for Milestone M3:
 * Glider Navigation Physics, Deadzone Boundary, Damped Acceleration, and 100% Locked Horizon.
 *
 * Objectives:
 * 1. Deadzone Boundary Tests (+/-15°, exactly 15.0001°, -30°, continuity at boundary).
 * 2. Damped Acceleration Dynamics (formula, extreme 180° jerk, bounds < 0.10, clamping [0.0, 1.0], elastic wall arrest).
 * 3. 100% Locked Horizon Proof (Euler ordering semantics, rotation.z === 0.0, orthogonality to planet zenith across 573 months).
 * 4. Robustness under NaN, Infinity, and malformed inputs.
 * 5. Globe.js non-tampering invariant.
 *
 * Babylon.js port (VR-MIGRATION-2026):
 *   - Group 3 camera probes use a real BABYLON.UniversalCamera on NullEngine.
 *     three.js asserted rotation.order === 'YXZ'; Babylon composes rotation as
 *     Matrix.RotationYawPitchRoll(y, x, z) — the SAME instruction order — so
 *     the port verifies the composed matrix against that exact decomposition
 *     (Euler-order contract preserved semantically). Sign conventions differ
 *     per the verified left-handed basis: Babylon +yawX looks right (three's
 *     -yawX), -pitchX looks up (three's +pitchX).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../../frontend/vendor/babylon/babylon.core.module.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeGliderStep,
  enforceZeroRoll,
  VRGliderNavigation,
  GLIDER_DEADZONE_DEG,
  GLIDER_ACCELERATION,
  GLIDER_DAMPING
} from '../../frontend/js/globe/vr/vr_glider.js';

import { TOTAL_MONTHS } from '../../frontend/js/globe/vr/vr_timeline.js';

import {
  createTimeSpline,
  getSplineFrame,
  SKIM_ALTITUDE
} from '../../frontend/js/globe/vr/vr_spline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const DEG_TO_RAD = Math.PI / 180.0;

function createBabylonCameraFixture() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  scene.activeCamera = null;
  const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);
  camera.fov = 75 * DEG_TO_RAD;
  camera.minZ = 0.05;
  camera.maxZ = 250.0;
  camera.rotationQuaternion = null; // Euler path drives the camera
  const glider = new VRGliderNavigation({ camera });
  return { engine, scene, camera, glider };
}

// Refresh a camera's world matrix and return it (Node.getWorldMatrix is stale
// until (re)computed — Babylon computes lazily per frame in the browser).
function cameraWorldMatrix(camera) {
  camera.computeWorldMatrix(true);
  return camera.getWorldMatrix();
}

describe('Empirical Challenger M3: Adversarial Stress Test Suite', () => {

  describe('1. Deadzone Boundary & Continuity Tests', () => {

    it('1.1 Inside Deadzone (+/-15°): zero acceleration, velocity decays strictly by 0.92', () => {
      const testAngles = [
        0.0, 1.0, -1.0, 5.0, -5.0, 10.0, -10.0, 14.5, -14.5,
        14.9999, -14.9999, 15.0, -15.0
      ];
      const initialVelocities = [0.0, 0.05, -0.05, 0.10, -0.10, 0.0025];

      for (const vel of initialVelocities) {
        for (const yaw of testAngles) {
          const res = computeGliderStep(yaw, vel);
          assert.equal(res.excess, 0.0, `Yaw ${yaw}° inside deadzone must yield excess === 0.0`);
          const expectedVel = vel * GLIDER_DAMPING;
          assert.ok(
            Math.abs(res.newVelocity - expectedVel) < 1e-12,
            `Velocity must decay strictly by ${GLIDER_DAMPING}: got ${res.newVelocity}, expected ${expectedVel}`
          );
        }
      }
    });

    it('1.2 Just outside deadzone: 15.0001° yields excess = 0.0001° and positive acceleration', () => {
      const yaw = 15.0001;
      const res = computeGliderStep(yaw, 0.0);
      assert.ok(Math.abs(res.excess - 0.0001) < 1e-9, `Excess must be 0.0001°, got ${res.excess}`);
      const expectedVel = (0.0 + 0.0001 * GLIDER_ACCELERATION) * GLIDER_DAMPING;
      assert.ok(res.newVelocity > 0.0, 'Acceleration must be strictly positive');
      assert.ok(Math.abs(res.newVelocity - expectedVel) < 1e-12, `Velocity mismatch: got ${res.newVelocity}`);
    });

    it('1.3 Negative outside deadzone: -30.0° yields excess = -15.0° and negative acceleration', () => {
      const yaw = -30.0;
      const res = computeGliderStep(yaw, 0.0);
      assert.equal(res.excess, -15.0, `Excess must be -15.0°, got ${res.excess}`);
      const expectedVel = (-15.0 * GLIDER_ACCELERATION) * GLIDER_DAMPING; // -0.00552
      assert.ok(res.newVelocity < 0.0, 'Acceleration must be strictly negative');
      assert.ok(Math.abs(res.newVelocity - (-0.00552)) < 1e-12, 'Velocity should equal -0.00552 within floating point epsilon');
    });

    it('1.4 C0 Continuity across deadzone boundary (yaw -> 15.0+ and yaw -> -15.0-)', () => {
      const deltas = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
      for (const eps of deltas) {
        const resPos = computeGliderStep(15.0 + eps, 0.0);
        assert.ok(Math.abs(resPos.excess - eps) < 1e-11, `Excess at 15+eps should equal eps (${eps})`);
        assert.ok(resPos.excess > 0, 'Excess should be positive above +15°');

        const resNeg = computeGliderStep(-15.0 - eps, 0.0);
        assert.ok(Math.abs(resNeg.excess - (-eps)) < 1e-11, `Excess at -15-eps should equal -eps (${-eps})`);
        assert.ok(resNeg.excess < 0, 'Excess should be negative below -15°');
      }
    });
  });

  describe('2. Damped Acceleration Dynamics & Extreme Jerk Bounding', () => {

    it('2.1 Extreme 180° yaw jerk: single-frame velocity strictly bounded < 0.10 and does not explode', () => {
      // Maximum instantaneous positive jerk from rest
      const res180 = computeGliderStep(180.0, 0.0);
      assert.equal(res180.excess, 165.0, 'Excess at 180° must be 165.0°');
      // Velocity = 165 * 0.0004 * 0.92 = 0.06072
      assert.ok(res180.newVelocity < 0.10, `Single frame velocity must be < 0.10, got ${res180.newVelocity}`);
      assert.ok(res180.newVelocity > 0.05, `Single frame velocity must be > 0.05, got ${res180.newVelocity}`);
      assert.ok(Math.abs(res180.newVelocity - 0.06072) < 1e-12, `Velocity mismatch: ${res180.newVelocity}`);

      // Maximum instantaneous negative jerk from rest
      const resMinus180 = computeGliderStep(-180.0, 0.0);
      assert.equal(resMinus180.excess, -165.0, 'Excess at -180° must be -165.0°');
      assert.ok(resMinus180.newVelocity > -0.10, `Single frame velocity must be > -0.10, got ${resMinus180.newVelocity}`);
      assert.ok(resMinus180.newVelocity < -0.05, `Single frame velocity must be < -0.05, got ${resMinus180.newVelocity}`);
      assert.ok(Math.abs(resMinus180.newVelocity - (-0.06072)) < 1e-12, `Velocity mismatch: ${resMinus180.newVelocity}`);
    });

    it('2.2 Asymptotic terminal velocity under continuous maximum steering (yaw = 180° for 500 frames)', () => {
      let vel = 0.0;
      // Theoretical fixed point: v* = (v* + 165 * 0.0004) * 0.92
      // v*(1 - 0.92) = 165 * 0.0004 * 0.92 = 0.06072
      // v* = 0.06072 / 0.08 = 0.759
      for (let f = 0; f < 500; f++) {
        const step = computeGliderStep(180.0, vel);
        vel = step.newVelocity;
        assert.ok(!isNaN(vel) && isFinite(vel), `Velocity became NaN or Infinite at step ${f}`);
      }
      assert.ok(Math.abs(vel - 0.759) < 1e-4, `Terminal velocity should converge to 0.759: got ${vel}`);
    });

    it('2.3 Timeline position clamps strictly in [0.0, 1.0] and handles elastic wall arrest', () => {
      const glider = new VRGliderNavigation(null);
      glider.enable();

      // Test 1: Push forward to boundary t = 1.0
      glider.setTimelinePosition(0.95);
      for (let i = 0; i < 100; i++) {
        glider.stepPhysics(45.0); // positive steering
        assert.ok(glider.getTimelinePosition() <= 1.0, 'Position must not exceed 1.0');
        assert.ok(glider.getTimelinePosition() >= 0.0, 'Position must not be less than 0.0');
        assert.ok(!isNaN(glider.getTimelinePosition()), 'Position must not be NaN');
      }
      assert.equal(glider.getTimelinePosition(), 1.0, 'Position must arrest at 1.0');
      assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity must arrest to 0.0 at wall');

      // Test 2: Push backward to boundary t = 0.0
      glider.setTimelinePosition(0.05);
      for (let i = 0; i < 100; i++) {
        glider.stepPhysics(-45.0); // negative steering
        assert.ok(glider.getTimelinePosition() <= 1.0, 'Position must not exceed 1.0');
        assert.ok(glider.getTimelinePosition() >= 0.0, 'Position must not be less than 0.0');
        assert.ok(!isNaN(glider.getTimelinePosition()), 'Position must not be NaN');
      }
      assert.equal(glider.getTimelinePosition(), 0.0, 'Position must arrest at 0.0');
      assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity must arrest to 0.0 at wall');
    });

    it('2.4 Velocity creep cutoff: small residual velocities (< 1e-7) snap to zero', () => {
      const glider = new VRGliderNavigation(null);
      glider.timelineVelocity = 5e-8;
      glider.stepPhysics(0.0); // inside deadzone
      assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity below 1e-7 must snap cleanly to 0.0');
    });

    it('2.5 Resilience to NaN, null, undefined, and non-numeric inputs', () => {
      // Null / undefined yaw
      const resNull = computeGliderStep(null, null);
      assert.equal(resNull.excess, 0.0);
      assert.equal(resNull.newVelocity, 0.0);

      const resUndef = computeGliderStep(undefined, undefined);
      assert.equal(resUndef.excess, 0.0);
      assert.equal(resUndef.newVelocity, 0.0);

      // NaN inputs
      const resNaN = computeGliderStep(NaN, NaN);
      assert.equal(resNaN.excess, 0.0);
      assert.equal(resNaN.newVelocity, 0.0);

      // enforceZeroRoll robustness
      const safe = enforceZeroRoll(NaN, NaN, NaN);
      assert.equal(safe.pitch, 0.0);
      assert.equal(safe.yaw, 0.0);
      assert.equal(safe.roll, 0.0);

      const safeExtreme = enforceZeroRoll(999.0, -750.0, 45.0);
      assert.equal(safeExtreme.pitch, 90.0, 'Pitch > 90 must clamp to 90');
      assert.equal(safeExtreme.yaw, 330.0, 'Yaw -750 % 360 must normalize to 330');
      assert.equal(safeExtreme.roll, 0.0, 'Roll must be forced to 0.0');
    });
  });

  describe('3. 100% Locked Horizon Mathematical & Empirical Proof', () => {

    it('3.1 Camera rotation composes as strict yaw-pitch-roll (Roll=0) with Babylon RHÂO ordering', () => {
      // PORT OF "Euler order is strictly YXZ": Babylon composes
      // Matrix.RotationYawPitchRoll(y, x, z) — the identical instruction order
      // as three's YXZ (Ry * Rx * Rz). Verify the composed camera matrix
      // element-by-element against that exact decomposition, z = 0 always.
      const { engine, scene, camera, glider } = createBabylonCameraFixture();

      const yawSteps = [-180, -135, -90, -45, -15, 0, 15, 45, 90, 135, 180];
      const pitchSteps = [-90, -75, -45, -18, 0, 18, 45, 75, 90];

      for (const yaw of yawSteps) {
        for (const pitch of pitchSteps) {
          glider.setLookAngles(yaw, pitch);

          assert.equal(camera.rotation.z, 0.0, 'rotation.z must be strictly 0.0');

          // Babylon LH sign conventions (empirically verified):
          // rotation.y = +yaw (right); rotation.x = -pitch (up is negative)
          const expectedPitchRad = -pitch * DEG_TO_RAD;
          const expectedYawRad = yaw * DEG_TO_RAD;
          assert.ok(Math.abs(camera.rotation.x - expectedPitchRad) < 1e-6, `Pitch mismatch at (${yaw}, ${pitch})`);
          assert.ok(Math.abs(camera.rotation.y - expectedYawRad) < 1e-6, `Yaw mismatch at (${yaw}, ${pitch})`);

          // Composed matrix must equal Ry(y)*Rx(x)*Rz(0) exactly (YXZ order)
          const world = cameraWorldMatrix(camera);
          const expected = BABYLON.Matrix.RotationYawPitchRoll(expectedYawRad, expectedPitchRad, 0.0);
          for (let i = 0; i < 12; i++) { // rotation-only block (m[12..15] = translation)
            assert.ok(Math.abs(world.m[i] - expected.m[i]) < 1e-9,
              `Euler composition mismatch at (${yaw}, ${pitch}) element ${i}`);
          }
        }
      }
      engine.dispose();
    });

    it('3.2 Camera local Right vector has ZERO component along planet zenith (no roll) for all angles', () => {
      const { engine, camera, glider } = createBabylonCameraFixture();

      // Grid of 37 x 19 = 703 angle combinations
      for (let y = -180; y <= 180; y += 10) {
        for (let p = -90; p <= 90; p += 10) {
          glider.setLookAngles(y, p);
          const world = cameraWorldMatrix(camera);

          // Row-major column 0 of the world matrix = camera local Right vector
          const rightX = world.m[0];
          const rightY = world.m[4]; // Component along CameraRig Y (planet zenith normal)
          const rightZ = world.m[8];

          assert.ok(
            Math.abs(rightY) < 1e-12,
            `Camera Right vector has non-zero Y component (${rightY}) at yaw=${y}, pitch=${p} -> ROLL DETECTED!`
          );

          // Verify length of right vector is preserved
          const rightLen = Math.hypot(rightX, rightY, rightZ);
          assert.ok(Math.abs(rightLen - 1.0) < 1e-7, 'Right vector must have unit length');
        }
      }
      engine.dispose();
    });

    it('3.3 Orthonormal Horizon Lock across entire 573-month TimeSpline flight trajectory', () => {
      const { engine, scene } = createBabylonCameraFixture();
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);

      // CameraRig with quaternion copied from the verified spline frame
      const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
      const testCamera = scene.activeCamera; // unused; test camera is fresh below
      void testCamera;

      const rigCam = new BABYLON.UniversalCamera('RigCam', BABYLON.Vector3.Zero(), scene);
      rigCam.rotationQuaternion = null; // Euler head orientation
      rigCam.parent = cameraRig;

      // NOTE: the scene fixture's glider is bound to its own camera; here the
      // glider under test drives the rig camera rigCam.
      const glider = new VRGliderNavigation({ camera: rigCam });

      // Test monthly waypoints across 47.75 years (sample every 12 months = 1 year)
      for (let month = 0; month < TOTAL_MONTHS; month += 12) {
        const t = month / (TOTAL_MONTHS - 1);
        const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);

        cameraRig.position.set(frame.position.x, frame.position.y, frame.position.z);
        cameraRig.rotationQuaternion = new BABYLON.Quaternion(
          frame.quaternion.x, frame.quaternion.y, frame.quaternion.z, frame.quaternion.w
        );

        // Planet normal at CameraRig position
        const planetNormal = frame.position.clone().normalize();

        // Verify CameraRig frame properties:
        // 1. Rig Up must equal planetNormal
        assert.ok(frame.up.distanceTo(planetNormal) < 1e-6, `Rig up vector mismatch at t=${t}`);
        // 2. Rig Right must be orthogonal to planetNormal (dot === 0)
        assert.ok(Math.abs(frame.right.dot(planetNormal)) < 1e-6, `Rig right dot planetNormal != 0 at t=${t}`);
        // 3. Rig Forward must be orthogonal to planetNormal (dot === 0)
        assert.ok(Math.abs(frame.forward.dot(planetNormal)) < 1e-6, `Rig forward dot planetNormal != 0 at t=${t}`);

        // Now test Camera head orientation inside CameraRig at various head pitches & yaws
        const headOrientations = [
          { yaw: 0, pitch: 0 },
          { yaw: 45, pitch: -18 },   // looking at DataGlyphs
          { yaw: -60, pitch: 20 },
          { yaw: 120, pitch: -45 },
          { yaw: 0, pitch: 75 },     // zenith gaze
          { yaw: 0, pitch: -90 },    // nadir gaze
          { yaw: 180, pitch: 90 }    // extreme zenith
        ];

        for (const { yaw, pitch } of headOrientations) {
          glider.setLookAngles(yaw, pitch);
          const world = rigCam.computeWorldMatrix(true)
            ? rigCam.getWorldMatrix()
            : rigCam.getWorldMatrix();

          // Camera world Right direction = world matrix row-major column 0
          const rightWorld = new BABYLON.Vector3(world.m[0], world.m[4], world.m[8]);

          // Invariant: camRightWorld must be orthogonal to planetNormal
          // (meaning the camera horizon is completely level with the local spherical horizon!)
          const dotWithPlanetNormal = Math.abs(rightWorld.dot(
            new BABYLON.Vector3(planetNormal.x, planetNormal.y, planetNormal.z)
          ));
          assert.ok(
            dotWithPlanetNormal < 1e-6,
            `Horizon lock violation at month ${month} (t=${t}), yaw=${yaw}, pitch=${pitch}: dot=${dotWithPlanetNormal}`
          );
        }
      }
      engine.dispose();
    });

    it('3.4 Zenith (+90°) and Nadir (-90°) Extreme Attitude Stability (No Gimbal Singularity)', () => {
      const { engine, camera, glider } = createBabylonCameraFixture();

      // Zenith
      glider.setLookAngles(45.0, 90.0);
      let world = cameraWorldMatrix(camera);
      assert.equal(camera.rotation.z, 0.0);
      assert.ok(Math.abs(world.m[4]) < 1e-12, 'Zenith Right vector Y must be zero');
      assert.ok(!isNaN(world.m[0]) && isFinite(world.m[0]));

      // Nadir
      glider.setLookAngles(-45.0, -90.0);
      world = cameraWorldMatrix(camera);
      assert.equal(camera.rotation.z, 0.0);
      assert.ok(Math.abs(world.m[4]) < 1e-12, 'Nadir Right vector Y must be zero');
      assert.ok(!isNaN(world.m[0]) && isFinite(world.m[0]));

      engine.dispose();
    });
  });

  describe('4. Invariant: frontend/js/globe/globe.js Untouched', () => {
    it('4.1 globe.js contains zero VR imports, zero VR functions, and is clean', () => {
      const globePath = path.join(rootDir, 'frontend', 'js', 'globe', 'globe.js');
      assert.ok(fs.existsSync(globePath), 'globe.js must exist');
      const content = fs.readFileSync(globePath, 'utf8');

      // Must not contain vr references
      assert.ok(!content.includes('./vr/'), 'globe.js must not import ./vr/');
      assert.ok(!content.includes('VRGlider'), 'globe.js must not reference VRGlider');
      assert.ok(!content.includes('vrScene'), 'globe.js must not reference vrScene');
      assert.ok(!content.includes('dataGlyphs'), 'globe.js must not reference dataGlyphs');
      assert.ok(!content.includes('TerminatorSkim'), 'globe.js must not reference TerminatorSkim');
    });
  });
});
