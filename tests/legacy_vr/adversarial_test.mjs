// .agents/teamwork/auditor_m3_fix/adversarial_test.mjs
// Independent Forensic Audit Stress Test for Milestone M3 Fix

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { VRSpatialAudio } from '../../../frontend/js/globe/vr/vr_audio.js';
import { VRGazeController } from '../../../frontend/js/globe/vr/vr_gaze.js';

console.log('=== STARTING INDEPENDENT FORENSIC STRESS AUDIT ===');

// -----------------------------------------------------------------------------
// Section 1: VRSpatialAudio.syncPlayhead Genuine Throttling & Boundary Pinning
// -----------------------------------------------------------------------------
console.log('\n--- Section 1: VRSpatialAudio.syncPlayhead Stress Tests ---');

{
  let seekCount = 0;
  let seekPositions = [];
  const mockMixer = {
    duration: 30.0,
    seekProgress: (t) => {
      seekCount++;
      seekPositions.push(t * 30.0);
    }
  };

  const audio = new VRSpatialAudio({ mixer: mockMixer });

  // 1.1 Non-numeric and out-of-range timeline inputs
  audio.syncPlayhead(NaN);
  assert.equal(seekPositions[seekPositions.length - 1], 0.0, 'NaN should clamp to 0.0');

  audio.syncPlayhead(-10.0);
  // -10 clamps to 0.0, which is stationary seek -> should be suppressed
  assert.equal(seekCount, 1, 'Stationary seek at 0.0 should be suppressed');

  audio.syncPlayhead(5.0); // clamps to 1.0 -> 30.0s
  assert.equal(seekPositions[seekPositions.length - 1], 30.0, '5.0 should clamp to 1.0 (30.0s)');

  // 1.2 Boundary Immunity: Exact 0.0 and Exact 1.0 are NEVER throttled by elapsed time
  // Reset audio state
  audio.lastSeekTime = 99999999; // Very recent seek time
  audio.lastSeekTarget = 15.0;

  // Even if dt is 0ms, boundary 0.0 MUST execute
  audio.syncPlayhead(0.0);
  assert.equal(seekPositions[seekPositions.length - 1], 0.0, 'Boundary 0.0 must seek even if elapsed < 40ms');

  audio.lastSeekTime = 99999999;
  audio.lastSeekTarget = 15.0;
  audio.syncPlayhead(1.0);
  assert.equal(seekPositions[seekPositions.length - 1], 30.0, 'Boundary 1.0 must seek even if elapsed < 40ms');

  console.log('  [PASS] Non-numeric clamping & boundary immunity');
}

{
  // 1.3 120 FPS high-refresh rate continuous scrub
  let seekCount = 0;
  let seekPositions = [];
  const mockMixer = {
    duration: 60.0,
    seekProgress: (t) => {
      seekCount++;
      seekPositions.push(t * 60.0);
    }
  };

  const audio = new VRSpatialAudio({ mixer: mockMixer });
  let simulatedTime = 5000.0;
  const origPerf = globalThis.performance;
  globalThis.performance = { now: () => simulatedTime };

  // 120 FPS: delta ~8.333ms over 1.0 second (120 frames)
  for (let f = 0; f < 120; f++) {
    simulatedTime += 8.3333;
    const t = f / 119.0;
    audio.syncPlayhead(t);
  }

  globalThis.performance = origPerf;

  // At 40ms throttle, in 1000ms there are at most ~25 seeks (+1 for final boundary)
  // 1000 / 40 = 25 seeks. With boundary 1.0: ~25-26 seeks.
  console.log(`  120 FPS scrub: seekCount=${seekCount}, finalTarget=${seekPositions[seekPositions.length - 1]}`);
  assert.ok(seekCount <= 27, `Expected <= 27 seeks at 120 FPS, got ${seekCount}`);
  assert.ok(seekCount >= 20, `Expected >= 20 seeks at 120 FPS, got ${seekCount}`);
  assert.equal(seekPositions[seekPositions.length - 1], 60.0, 'Must pin exactly to end of timeline');

  console.log('  [PASS] 120 FPS high-refresh rate seek throttling');
}

{
  // 1.4 Reverse scrubbing (1.0 down to 0.0) at 60 FPS
  let seekCount = 0;
  let seekPositions = [];
  const mockMixer = {
    duration: 20.0,
    seekProgress: (t) => {
      seekCount++;
      seekPositions.push(t * 20.0);
    }
  };

  const audio = new VRSpatialAudio({ mixer: mockMixer });
  let simulatedTime = 1000.0;
  const origPerf = globalThis.performance;
  globalThis.performance = { now: () => simulatedTime };

  for (let f = 0; f < 60; f++) {
    simulatedTime += 16.6667;
    const t = 1.0 - (f / 59.0);
    audio.syncPlayhead(t);
  }

  globalThis.performance = origPerf;

  console.log(`  Reverse scrub: seekCount=${seekCount}, finalTarget=${seekPositions[seekPositions.length - 1]}`);
  assert.ok(seekCount <= 26, `Expected <= 26 seeks in reverse, got ${seekCount}`);
  assert.ok(seekCount >= 20, `Expected >= 20 seeks in reverse, got ${seekCount}`);
  assert.equal(seekPositions[seekPositions.length - 1], 0.0, 'Must pin exactly to start in reverse');

  console.log('  [PASS] Reverse continuous scrubbing');
}

// -----------------------------------------------------------------------------
// Section 2: VRGazeController Orbital Local Up Vector Projection
// -----------------------------------------------------------------------------
console.log('\n--- Section 2: VRGazeController Orbital Up Vector Math Tests ---');

{
  // 2.1 Rig rotated into arbitrary 3D orientations
  // In orbit, spacecraft might be pitched 90 deg down, rolled, or heading sideways
  const cameraRig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
  cameraRig.add(camera);

  let exitCalled = 0;
  const gaze = new VRGazeController(
    { dataGlyphs: [] },
    null,
    { onZenithExit: () => { exitCalled++; } }
  );

  // Test across multiple arbitrary rig orientations:
  const testRigRotations = [
    new THREE.Euler(0, 0, 0, 'XYZ'),
    new THREE.Euler(Math.PI / 2, 0, 0, 'XYZ'),           // Pitched 90°
    new THREE.Euler(0, Math.PI / 2, 0, 'XYZ'),           // Yaw 90°
    new THREE.Euler(0, 0, Math.PI / 2, 'XYZ'),           // Roll 90°
    new THREE.Euler(Math.PI / 4, Math.PI / 3, Math.PI / 6, 'XYZ'), // Compound 3D angle
    new THREE.Euler(Math.PI, 0, 0, 'XYZ')                // Inverted 180°
  ];

  for (let i = 0; i < testRigRotations.length; i++) {
    const rot = testRigRotations[i];
    cameraRig.rotation.copy(rot);
    cameraRig.updateMatrixWorld(true);

    gaze.reset();
    exitCalled = 0;

    // A) Pilot looks horizontally forward in rig's frame (camera rotation.x = 0)
    camera.rotation.set(0, 0, 0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 2.0);
    assert.equal(gaze.zenithDwell, 0.0, `Rotation ${i}: Looking forward must have 0 zenith dwell`);
    assert.equal(exitCalled, 0, `Rotation ${i}: Forward gaze must not trigger exit`);

    // B) Pilot looks at +74.9° in rig's frame
    camera.rotation.set(THREE.MathUtils.degToRad(74.9), 0, 0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 2.0);
    assert.equal(gaze.zenithDwell, 0.0, `Rotation ${i}: +74.9° pitch must have 0 zenith dwell`);
    assert.equal(exitCalled, 0, `Rotation ${i}: +74.9° pitch must not trigger exit`);

    // C) Pilot looks at +80° in rig's frame for 1.49s (sub-threshold)
    camera.rotation.set(THREE.MathUtils.degToRad(80.0), 0, 0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 1.49);
    assert.ok(Math.abs(gaze.zenithDwell - 1.49) < 1e-4, `Rotation ${i}: Dwell should be 1.49s`);
    assert.equal(exitCalled, 0, `Rotation ${i}: Exit should not trigger at 1.49s`);

    // D) Advance 0.02s -> total 1.51s >= 1.5s -> Exit triggers!
    gaze.update(camera, 0.02);
    assert.equal(exitCalled, 1, `Rotation ${i}: Exit MUST trigger when local zenith sustained for >= 1.5s`);

    // E) Looking downward at -90° (nadir) in rig's frame
    gaze.reset();
    exitCalled = 0;
    camera.rotation.set(THREE.MathUtils.degToRad(-90.0), 0, 0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 2.0);
    assert.equal(gaze.zenithDwell, 0.0, `Rotation ${i}: Nadir (-90°) must have 0 zenith dwell`);
    assert.equal(exitCalled, 0);
  }

  console.log('  [PASS] Invariant: Local orbital zenith detection is frame-independent across all 3D rotations');
}

{
  // 2.2 Fallback when camera has no parent rig
  const standaloneCam = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
  let exitFired = 0;
  const gaze = new VRGazeController(
    { dataGlyphs: [] },
    null,
    { onZenithExit: () => { exitFired++; } }
  );

  // Looking +80° in world coordinates
  standaloneCam.rotation.set(THREE.MathUtils.degToRad(80.0), 0, 0);
  standaloneCam.updateMatrixWorld(true);
  gaze.update(standaloneCam, 1.55);
  assert.equal(exitFired, 1, 'Standalone camera must fallback to world Up (0, 1, 0) and trigger exit');

  console.log('  [PASS] Standalone camera fallback to world Up');
}

console.log('\n=== ALL INDEPENDENT FORENSIC STRESS TESTS PASSED ===\n');
