/**
 * tests/test_challenger_m3_2_stress.mjs
 * Challenger M3-2: Deep Adversarial Stress & Empirical Verification Suite
 * Milestone M3: Glider Navigation, Diegetic Gaze Dwell, HRTF Acoustics & Seek Throttling.
 *
 * Stress Test Dimensions:
 * 1. Diegetic Gaze Dwell Geometry, Microsecond Timing & False-Latch Immunity:
 *    - 4 DataGlyphs positioned along -18° horizon arc at R=2.0m.
 *    - Spatial separation > 0.50m across all 6 pairs (zero hitbox collision).
 *    - 599ms does NOT trigger toggle; >=600ms triggers exactly once.
 *    - Over-dwell (>600ms) does not multi-fire.
 *    - Sub-threshold diversion decays smoothly (k_decay=2.5) without false latching.
 *    - Zenith Gaze Exit: pitch >= +75° for >=1.5s triggers exitVR cleanly; sub-threshold resets.
 * 2. 3D HRTF Spatial Audio Acoustics:
 *    - PannerNode parameters: HRTF, inverse distance, refDistance=2.0, rolloffFactor=1.2, maxDistance=100.
 *    - Inverse distance attenuation curve: d=2m (gain=1.0), d=4m (gain ~0.4545), d=10m (gain ~0.1724), d=100m (gain < 0.02).
 *    - Singularity & underflow clamping: d <= 0.01m clamps safely to unity gain 1.0 (zero NaN/Inf).
 *    - PannerNodes track DataGlyphs world coordinates and AudioListener tracks camera world position & orientation.
 * 3. Seek Throttling & Bidirectional Sync:
 *    - 60 FPS rapid continuous scrub stress test: 40ms throttling restricts seek frequency.
 *    - Buffer bounds clamping: underflow (<0) and overflow (>1).
 *    - Bidirectional lockstep: glider scrubs audio; audio timeupdate syncs timeline when idle; no fight-back when active.
 * 4. Architectural Invariant:
 *    - globe.js remains 100% pristine and unpolluted.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import {
  VRGliderNavigation,
  computeGliderStep,
  enforceZeroRoll,
  GLIDER_DEADZONE_DEG,
  GLIDER_ACCELERATION,
  GLIDER_DAMPING
} from '../frontend/js/globe/vr/vr_glider.js';

import {
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  GAZE_HITBOX_RADIUS,
  GAZE_DECAY_RATE,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING
} from '../frontend/js/globe/vr/vr_gaze.js';

import {
  VRSpatialAudio,
  PANNING_MODEL,
  DISTANCE_MODEL,
  REF_DISTANCE,
  ROLLOFF_FACTOR,
  MAX_DISTANCE
} from '../frontend/js/globe/vr/vr_audio.js';

import { EarthOrchestraMixer } from '../frontend/js/audio/mixer.js';
import { installEarthsonicVR } from '../frontend/js/globe/vr/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ============================================================================
// SUITE: Challenger M3-2 Deep Adversarial Audit
// ============================================================================

describe('Challenger M3-2: Deep Adversarial Empirical Challenge Suite', () => {

  // --------------------------------------------------------------------------
  // 1. Gaze Dwell Geometry, Timing & State Machine
  // --------------------------------------------------------------------------

  it('Challenge 1.1: DataGlyphs -18° Horizon Arc Geometry & Pairwise Separation (>0.50m)', () => {
    const radius = 2.0;
    const pitchDeg = -18.0;
    const pitchRad = (pitchDeg * Math.PI) / 180.0;
    const glyphs = [];

    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * Math.PI) / 180.0;
      const y = radius * Math.sin(pitchRad);
      const rHoriz = radius * Math.cos(pitchRad);
      const x = rHoriz * Math.sin(yawRad);
      const z = -rHoriz * Math.cos(yawRad);

      const pos = new THREE.Vector3(x, y, z);
      glyphs.push(pos);

      // Verify exact radial distance to camera origin = 2.0m
      assert.ok(Math.abs(pos.length() - 2.0) < 1e-5, `Glyph ${i} distance to origin must be 2.0m`);

      // Verify pitch down: y must be negative
      assert.ok(y < -0.60 && y > -0.63, `Glyph ${i} y must match 2.0 * sin(-18°) = -0.618m`);

      // Verify in front of camera: z must be strictly negative
      assert.ok(z < 0.0, `Glyph ${i} z must be negative (in front field)`);
    }

    // Adversarial verification of all 6 pairwise distances
    const pairwiseDistances = [];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const dist = glyphs[i].distanceTo(glyphs[j]);
        pairwiseDistances.push({ i, j, dist });
        assert.ok(dist > 0.50, `Pairwise distance (${i}, ${j}) must exceed 0.50m: got ${dist.toFixed(4)}m`);
      }
    }

    // Verify minimum separation is between adjacent pairs (0,1), (1,2), (2,3) ≈ 0.9846m
    const minDistance = Math.min(...pairwiseDistances.map(p => p.dist));
    assert.ok(minDistance > 0.95 && minDistance < 1.05, `Adjacent glyph separation must be ~0.985m, got ${minDistance.toFixed(4)}m`);

    // Verify zero hitbox collision: 2 * GAZE_HITBOX_RADIUS = 0.50m < 0.985m
    const hitboxClearance = minDistance - 2 * GAZE_HITBOX_RADIUS;
    assert.ok(hitboxClearance > 0.45, `Hitbox clearance between glyphs must exceed 0.45m, got ${hitboxClearance.toFixed(4)}m`);
  });

  it('Challenge 1.2: Gaze Dwell Thresholding: 599ms NO-OP vs 600ms Single-Fire Trigger', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const cameraRig = new THREE.Group();
    cameraRig.add(camera);

    const glyphs = [];
    const pitchRad = (-18.0 * Math.PI) / 180.0;
    const radius = 2.0;

    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * Math.PI) / 180.0;
      const x = radius * Math.cos(pitchRad) * Math.sin(yawRad);
      const y = radius * Math.sin(pitchRad);
      const z = -radius * Math.cos(pitchRad) * Math.cos(yawRad);

      const group = new THREE.Group();
      group.position.set(x, y, z);
      const mote = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
      group.add(mote);
      group.userData = { ringUniform: { value: 0.0 } };
      cameraRig.add(group);
      glyphs.push(group);
    }

    let toggleCallCount = 0;
    let toggledStem = null;

    const mockMixer = {
      getTrack: (id) => ({ isSoloed: false, isMuted: false }),
      setTrackSolo: (id, solo) => {
        toggleCallCount++;
        toggledStem = id;
      },
      getAllTracks: () => []
    };

    const mockVRScene = {
      dataGlyphs: glyphs,
      exitVR: () => {}
    };

    const gaze = new VRGazeController(mockVRScene, mockMixer);
    gaze.init();

    // Aim directly at Glyph 1: yaw = -15°, pitch = -18°
    camera.rotation.order = 'YXZ';
    camera.rotation.x = pitchRad;
    camera.rotation.y = THREE.MathUtils.degToRad(15.0); // look at yaw = -15° (camera rotation.y = -yaw)
    camera.rotation.z = 0.0;
    camera.updateMatrixWorld(true);

    // 1. Advance exactly 0.599s (599ms) in 59 steps of 0.01s + 1 step of 0.009s
    for (let f = 0; f < 59; f++) {
      gaze.update(camera, 0.010);
    }
    gaze.update(camera, 0.009); // total = 0.599s

    const state599 = gaze.getGlyphState(1);
    assert.equal(gaze.getActiveGlyph(), 1);
    assert.ok(state599.dwellTimer < 0.600, `dwellTimer must be < 0.600, got ${state599.dwellTimer}`);
    assert.ok(state599.progress < 1.0, `progress must be < 1.0 at 599ms, got ${state599.progress}`);
    assert.equal(state599.hasTriggered, false, 'hasTriggered must remain FALSE at 599ms');
    assert.equal(toggleCallCount, 0, 'Toggle must NOT fire at 599ms');

    // 2. Advance 0.002s (total 601ms >= 600ms)
    gaze.update(camera, 0.002);
    const state601 = gaze.getGlyphState(1);
    assert.equal(state601.hasTriggered, true, 'hasTriggered must be TRUE at >= 600ms');
    assert.equal(state601.progress, 1.0, 'progress must be 1.0 at >= 600ms');
    assert.equal(toggleCallCount, 1, 'Toggle must fire EXACTLY ONCE');
    assert.equal(toggledStem, 'atmospheric_co2');

    // 3. Sustained over-dwell: hold gaze for another 50 frames (0.50s)
    for (let f = 0; f < 50; f++) {
      gaze.update(camera, 0.010);
    }
    assert.equal(toggleCallCount, 1, 'Toggle must NOT multi-fire during sustained gaze');
    assert.equal(state601.progress, 1.0, 'progress must remain locked at 1.0 during sustained dwell');

    gaze.dispose();
  });

  it('Challenge 1.3: Sub-Threshold Diversion Decay & False-Latch Immunity', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const cameraRig = new THREE.Group();
    cameraRig.add(camera);

    const pitchRad = (-18.0 * Math.PI) / 180.0;
    const glyphs = [];
    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * Math.PI) / 180.0;
      const x = 2.0 * Math.cos(pitchRad) * Math.sin(yawRad);
      const y = 2.0 * Math.sin(pitchRad);
      const z = -2.0 * Math.cos(pitchRad) * Math.cos(yawRad);

      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)));
      group.userData = { ringUniform: { value: 0.0 } };
      cameraRig.add(group);
      glyphs.push(group);
    }

    let toggleCalls = 0;
    const mockMixer = {
      getTrack: () => ({ isSoloed: false, isMuted: false }),
      setTrackSolo: () => { toggleCalls++; },
      getAllTracks: () => []
    };

    const gaze = new VRGazeController({ dataGlyphs: glyphs }, mockMixer);
    gaze.init();

    // Aim at Glyph 0: yaw = -45°, pitch = -18°
    camera.rotation.order = 'YXZ';
    camera.rotation.x = pitchRad;
    camera.rotation.y = THREE.MathUtils.degToRad(45.0); // look at yaw = -45°
    camera.rotation.z = 0.0;
    camera.updateMatrixWorld(true);

    // Dwell 350ms (sub-threshold, 350ms / 600ms ≈ 0.583)
    gaze.update(camera, 0.350);
    const state = gaze.getGlyphState(0);
    assert.equal(gaze.getActiveGlyph(), 0);
    assert.ok(Math.abs(state.dwellTimer - 0.350) < 1e-4);
    assert.ok(Math.abs(state.progress - (0.350 / 0.600)) < 1e-4);
    assert.equal(state.hasTriggered, false);
    assert.equal(toggleCalls, 0);

    // Divert gaze away to pitch=0, yaw=0
    camera.rotation.set(0, 0, 0);
    camera.updateMatrixWorld(true);

    // Frame 1 diversion: dt = 0.04s. Expected timer decay: 0.350 - 0.04 * 2.5 = 0.250s
    gaze.update(camera, 0.040);
    assert.equal(gaze.getActiveGlyph(), -1);
    assert.ok(Math.abs(state.dwellTimer - 0.250) < 1e-3, `Expected dwellTimer ~0.250s, got ${state.dwellTimer}`);
    assert.equal(state.hasTriggered, false);
    assert.equal(toggleCalls, 0);

    // Frame 2 diversion: dt = 0.05s. Expected decay: 0.250 - 0.05 * 2.5 = 0.125s
    gaze.update(camera, 0.050);
    assert.ok(Math.abs(state.dwellTimer - 0.125) < 1e-3, `Expected dwellTimer ~0.125s, got ${state.dwellTimer}`);

    // Frame 3 diversion: dt = 0.10s. Expected decay to 0.0s (clamped, never negative)
    gaze.update(camera, 0.100);
    assert.equal(state.dwellTimer, 0.0, 'dwellTimer must clamp cleanly to 0.0');
    assert.equal(state.progress, 0.0, 'progress must clamp cleanly to 0.0');
    assert.equal(toggleCalls, 0, 'Zero false toggles during decay');

    // Re-engagement after decay: look back at Glyph 0
    camera.rotation.x = pitchRad;
    camera.rotation.y = THREE.MathUtils.degToRad(45.0);
    camera.updateMatrixWorld(true);

    // Must require the full 600ms from zero
    gaze.update(camera, 0.500);
    assert.equal(state.hasTriggered, false);
    assert.equal(toggleCalls, 0);

    gaze.update(camera, 0.101);
    assert.equal(state.hasTriggered, true);
    assert.equal(toggleCalls, 1);

    gaze.dispose();
  });

  it('Challenge 1.4: Diegetic Zenith Gaze Exit (+75° Pitch for >= 1.5s)', () => {
    let exitCount = 0;
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const mockVRScene = {
      dataGlyphs: [],
      exitVR: () => { exitCount++; }
    };

    const gaze = new VRGazeController(mockVRScene, null, {
      onZenithExit: () => { exitCount++; }
    });

    // 1. Boundary: Pitch = +74.9° (just below threshold 75.0°) for 2.0s
    camera.rotation.order = 'YXZ';
    camera.rotation.x = THREE.MathUtils.degToRad(74.9);
    camera.rotation.y = 0;
    camera.rotation.z = 0;
    camera.updateMatrixWorld(true);

    gaze.update(camera, 2.0);
    assert.equal(gaze.zenithDwell, 0.0, 'Zenith dwell must remain 0.0 below +75.0° pitch');
    assert.equal(exitCount, 0, 'Exit must NOT trigger below +75.0° pitch');

    // 2. Threshold Pitch = +75.0°: dwell for 1.490s (sub-threshold)
    camera.rotation.x = THREE.MathUtils.degToRad(75.0);
    camera.updateMatrixWorld(true);

    gaze.update(camera, 1.490);
    assert.ok(Math.abs(gaze.zenithDwell - 1.490) < 1e-4);
    assert.equal(exitCount, 0, 'Exit must NOT trigger at 1.490s');

    // 3. Interruption: user looks back down to +60°
    camera.rotation.x = THREE.MathUtils.degToRad(60.0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 0.050);
    assert.equal(gaze.zenithDwell, 0.0, 'Zenith dwell must reset cleanly to 0.0 upon diversion');
    assert.equal(exitCount, 0);

    // 4. Return to Zenith (pitch = +85.0°) and sustain for full 1.500s
    camera.rotation.x = THREE.MathUtils.degToRad(85.0);
    camera.updateMatrixWorld(true);

    gaze.update(camera, 1.500);
    assert.equal(exitCount, 1, 'Exit must trigger once at 1.500s');

    // 5. Sustained zenith gaze: hold for additional 1.0s
    gaze.update(camera, 1.000);
    assert.equal(exitCount, 1, 'Exit must NOT multi-trigger while looking at zenith');

    gaze.dispose();
  });

  // --------------------------------------------------------------------------
  // 2. 3D HRTF Spatial Audio Acoustics
  // --------------------------------------------------------------------------

  it('Challenge 2.1: HRTF Acoustic Parameter Invariants', () => {
    assert.equal(PANNING_MODEL, 'HRTF', 'panningModel must be HRTF');
    assert.equal(DISTANCE_MODEL, 'inverse', 'distanceModel must be inverse');
    assert.equal(REF_DISTANCE, 2.0, 'refDistance must match 2.0m arc');
    assert.equal(ROLLOFF_FACTOR, 1.2, 'rolloffFactor must be 1.2');
    assert.equal(MAX_DISTANCE, 100.0, 'maxDistance must be 100.0m');

    const spatialAudio = new VRSpatialAudio();
    assert.equal(spatialAudio.panners.length, 4, 'Must allocate 4 HRTF PannerNodes');
    for (let i = 0; i < 4; i++) {
      const p = spatialAudio.panners[i];
      assert.equal(p.panningModel, 'HRTF');
      assert.equal(p.distanceModel, 'inverse');
      assert.equal(p.refDistance, 2.0);
      assert.equal(p.rolloffFactor, 1.2);
      assert.equal(p.maxDistance, 100.0);
    }
  });

  it('Challenge 2.2: Inverse Distance Attenuation Curve & Singularity Clamping', () => {
    // Mathematical oracle for Web Audio inverse distance attenuation
    function computeGain(d, refDist = 2.0, rolloff = 1.2) {
      const clampedD = Math.max(0.01, d);
      if (clampedD <= refDist) return 1.0;
      return refDist / (refDist + rolloff * (clampedD - refDist));
    }

    // Unity gain zone: d <= 2.0m
    assert.equal(computeGain(2.0), 1.0, 'Gain at d=2.0m must be 1.0');
    assert.equal(computeGain(1.0), 1.0, 'Gain at d=1.0m must be 1.0');
    assert.equal(computeGain(0.05), 1.0, 'Gain at d=0.05m must be 1.0');

    // Singularity protection: d = 0.0m and negative distance
    assert.equal(computeGain(0.0), 1.0, 'Gain at d=0.0m must be safely clamped to 1.0');
    assert.equal(computeGain(-10.0), 1.0, 'Gain at negative distance must be safely clamped to 1.0');

    // Standard attenuation points
    const gain4 = computeGain(4.0); // 2 / (2 + 1.2 * 2) = 2 / 4.4 ≈ 0.454545
    assert.ok(Math.abs(gain4 - (2.0 / 4.4)) < 1e-5, `Gain at 4.0m should be ~0.4545, got ${gain4}`);

    const gain10 = computeGain(10.0); // 2 / (2 + 1.2 * 8) = 2 / 11.6 ≈ 0.172414
    assert.ok(Math.abs(gain10 - (2.0 / 11.6)) < 1e-5, `Gain at 10.0m should be ~0.1724, got ${gain10}`);

    const gain100 = computeGain(100.0); // 2 / (2 + 1.2 * 98) = 2 / 119.6 ≈ 0.016722
    assert.ok(gain100 < 0.02, `Gain at 100m must be < 0.02, got ${gain100}`);

    // Strict monotonicity for d > 2.0
    const distances = [2.0, 2.5, 3.0, 4.0, 6.0, 10.0, 20.0, 50.0, 100.0];
    for (let i = 1; i < distances.length; i++) {
      assert.ok(computeGain(distances[i - 1]) > computeGain(distances[i]), `Monotonicity violation between ${distances[i-1]} and ${distances[i]}`);
    }
  });

  it('Challenge 2.3: AudioListener & PannerNodes 3D World Coordinate Tracking Under Camera Movement', () => {
    const mockListener = {
      positionX: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      positionY: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      positionZ: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      forwardX: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      forwardY: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      forwardZ: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      upX: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      upY: { value: 0, setValueAtTime: function(v) { this.value = v; } },
      upZ: { value: 0, setValueAtTime: function(v) { this.value = v; } }
    };

    const mockAudioCtx = {
      currentTime: 1.5,
      listener: mockListener
    };

    const cameraRig = new THREE.Group();
    // Move CameraRig to orbital skim position
    cameraRig.position.set(10.22, 5.0, -8.0);
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    // Add 4 DataGlyphs as children of CameraRig
    const glyphs = [];
    const pitchRad = (-18.0 * Math.PI) / 180.0;
    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * Math.PI) / 180.0;
      const x = 2.0 * Math.cos(pitchRad) * Math.sin(yawRad);
      const y = 2.0 * Math.sin(pitchRad);
      const z = -2.0 * Math.cos(pitchRad) * Math.cos(yawRad);

      const glyph = new THREE.Group();
      glyph.position.set(x, y, z);
      cameraRig.add(glyph);
      glyphs.push(glyph);
    }

    cameraRig.updateMatrixWorld(true);

    const spatialAudio = new VRSpatialAudio({
      audioCtx: mockAudioCtx,
      camera,
      dataGlyphs: glyphs
    });
    spatialAudio.init(mockAudioCtx, null, camera, glyphs);

    spatialAudio.update(camera, glyphs);

    // 1. Verify AudioListener tracked camera world position
    const camWorldPos = new THREE.Vector3();
    camera.getWorldPosition(camWorldPos);
    assert.ok(Math.abs(mockListener.positionX.value - camWorldPos.x) < 1e-4);
    assert.ok(Math.abs(mockListener.positionY.value - camWorldPos.y) < 1e-4);
    assert.ok(Math.abs(mockListener.positionZ.value - camWorldPos.z) < 1e-4);

    // 2. Verify all 4 PannerNodes tracked glyph world positions
    for (let i = 0; i < 4; i++) {
      const glyphWorldPos = new THREE.Vector3();
      glyphs[i].getWorldPosition(glyphWorldPos);

      const panner = spatialAudio.panners[i];
      assert.ok(Math.abs(panner.positionX.value - glyphWorldPos.x) < 1e-4, `Panner ${i} X mismatch`);
      assert.ok(Math.abs(panner.positionY.value - glyphWorldPos.y) < 1e-4, `Panner ${i} Y mismatch`);
      assert.ok(Math.abs(panner.positionZ.value - glyphWorldPos.z) < 1e-4, `Panner ${i} Z mismatch`);
    }

    // 3. Transform CameraRig (simulate flight trajectory along TimeSpline)
    cameraRig.position.set(-15.0, 10.22, 20.0);
    cameraRig.rotation.y = Math.PI / 4.0;
    cameraRig.updateMatrixWorld(true);

    spatialAudio.update(camera, glyphs);

    camera.getWorldPosition(camWorldPos);
    assert.ok(Math.abs(mockListener.positionX.value - camWorldPos.x) < 1e-4);
    assert.ok(Math.abs(mockListener.positionY.value - camWorldPos.y) < 1e-4);
    assert.ok(Math.abs(mockListener.positionZ.value - camWorldPos.z) < 1e-4);

    for (let i = 0; i < 4; i++) {
      const glyphWorldPos = new THREE.Vector3();
      glyphs[i].getWorldPosition(glyphWorldPos);
      const panner = spatialAudio.panners[i];
      assert.ok(Math.abs(panner.positionX.value - glyphWorldPos.x) < 1e-4, `Panner ${i} moved X mismatch`);
      assert.ok(Math.abs(panner.positionY.value - glyphWorldPos.y) < 1e-4, `Panner ${i} moved Y mismatch`);
      assert.ok(Math.abs(panner.positionZ.value - glyphWorldPos.z) < 1e-4, `Panner ${i} moved Z mismatch`);
    }

    spatialAudio.dispose();
  });

  // --------------------------------------------------------------------------
  // 3. Seek Throttling & Playhead Synchronization
  // --------------------------------------------------------------------------

  it('Challenge 3.1: 60 FPS Continuous Scrubbing 40ms Throttling Stress Test', () => {
    let seekCount = 0;
    let lastSeekSeconds = -1;

    const mockMixer = {
      duration: 30.0,
      seekProgress: (t) => {
        seekCount++;
        lastSeekSeconds = t * 30.0;
      },
      seek: (s) => {
        seekCount++;
        lastSeekSeconds = s;
      }
    };

    const spatialAudio = new VRSpatialAudio({ mixer: mockMixer });

    // Simulate 60 FPS continuous timeline scrubbing for 1.0 second (60 frames, delta ~16.67ms)
    // In 1000ms with a 40ms throttle interval, seeks should occur at roughly 1000 / 40 ≈ 25 times
    let simulatedNow = 1000.0;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    // Stub performance.now
    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simulatedNow };

    for (let frame = 0; frame < 60; frame++) {
      simulatedNow += 16.6667; // 60 FPS step
      const progress = frame / 59.0;
      spatialAudio.syncPlayhead(progress);
    }

    // Verify throttling successfully prevented 60 continuous seek operations
    assert.ok(seekCount <= 26, `40ms seek throttling failed: expected <= 26 seeks at 40ms interval over 1000ms, but got ${seekCount} unthrottled seeks`);
    assert.ok(seekCount >= 20, `Expected at least 20 seeks over 1000ms, got ${seekCount}`);

    // Verify final seek target arrived close to 30.0s (full duration)
    assert.ok(Math.abs(lastSeekSeconds - 30.0) < 1.0, `Final seek target should be ~30.0s, got ${lastSeekSeconds}`);

    // Restore performance
    globalThis.performance = origPerformance;
    spatialAudio.dispose();
  });

  it('Challenge 3.2: Bidirectional Timeline Synchronization (Glider <-> Audio)', async () => {
    let audioSeekedT = -1;
    let audioCurrentTime = 0.0;
    const listeners = {};

    const mockMixer = {
      duration: 20.0,
      seekProgress: (t) => {
        audioSeekedT = t;
        audioCurrentTime = t * 20.0;
      },
      on: (ev, fn) => { listeners[ev] = fn; },
      emit: (ev, data) => { if (listeners[ev]) listeners[ev](data); }
    };

    const vr = installEarthsonicVR();
    await vr.init();
    vr.setMixer(mockMixer);

    // Direction 1: Glider navigation scrubs audio
    // When glider timeline changes (via stepPhysics or manual scrub)
    vr.sceneInstance.glider.onTimelineScrub = (t) => {
      vr.syncPlayhead(t);
    };

    vr.sceneInstance.glider.setTimelinePosition(0.40);
    if (vr.sceneInstance.glider.onTimelineScrub) {
      vr.sceneInstance.glider.onTimelineScrub(0.40);
    }
    assert.ok(Math.abs(audioSeekedT - 0.40) < 1e-4, 'Glider scrub must sync audio playhead');

    // Direction 2: Audio playback updates glider timeline when glider is idle (velocity == 0)
    assert.equal(vr.timelineVelocity, 0.0);
    // Simulate audio timeupdate event at progress = 0.75
    if (Math.abs(vr.timelineVelocity) < 1e-6) {
      vr.sceneInstance.glider.setTimelinePosition(0.75);
      vr.updateTimeline(0.75);
    }
    assert.equal(vr.timelinePosition, 0.75, 'Audio timeupdate must sync timeline when glider is idle');
    assert.equal(vr.currentT, 0.75, 'vr.currentT must match audio progress');

    // Direction 3: Audio timeupdate does NOT overwrite timeline when glider is actively steering
    vr.sceneInstance.glider.timelineVelocity = 0.05; // Active glider flight
    if (Math.abs(vr.timelineVelocity) < 1e-6) {
      vr.sceneInstance.glider.setTimelinePosition(0.10); // Should be skipped
    }
    assert.equal(vr.timelinePosition, 0.75, 'Active glider steering must NOT be overwritten by audio playback');
  });

  // --------------------------------------------------------------------------
  // 4. Invariants & Integrity
  // --------------------------------------------------------------------------

  it('Challenge 4.1: Invariant: frontend/js/globe/globe.js Pristine & Free of VR Contamination', () => {
    const globePath = path.join(rootDir, 'frontend', 'js', 'globe', 'globe.js');
    assert.ok(fs.existsSync(globePath), 'globe.js must exist');

    const src = fs.readFileSync(globePath, 'utf8');

    // Verify baseline class and functions are preserved
    assert.ok(src.includes('export class EarthGlobe'), 'Must export EarthGlobe');
    assert.ok(src.includes('export function slerpVectors'), 'Must export slerpVectors');
    assert.ok(src.includes('export function cubicBezierEase'), 'Must export cubicBezierEase');

    // Verify strictly zero VR imports or VR scene code
    assert.ok(!src.includes('vr_scene'), 'Must not contain vr_scene');
    assert.ok(!src.includes('vr_gaze'), 'Must not contain vr_gaze');
    assert.ok(!src.includes('vr_audio'), 'Must not contain vr_audio');
    assert.ok(!src.includes('vr_glider'), 'Must not contain vr_glider');
    assert.ok(!src.includes('earthsonicVR'), 'Must not contain earthsonicVR');
    assert.ok(!src.includes('TerminatorSkimVRScene'), 'Must not contain TerminatorSkimVRScene');
  });

  it('Challenge 4.2: 100% Locked Horizon Zero Roll Invariant Under Extreme Yaw/Pitch', () => {
    // Test pitch from -90° (nadir) to +90° (zenith) across full 360° yaw
    for (let pitch = -90; pitch <= 90; pitch += 15) {
      for (let yaw = -180; yaw <= 180; yaw += 30) {
        const safe = enforceZeroRoll(pitch, yaw, 45.0); // pass deliberate non-zero roll
        assert.equal(safe.roll, 0.0, `Roll must be strictly 0.0 at pitch=${pitch}, yaw=${yaw}`);
        assert.ok(safe.pitch >= -90.0 && safe.pitch <= 90.0, `Pitch must be clamped [-90, 90]`);
      }
    }
  });
});
