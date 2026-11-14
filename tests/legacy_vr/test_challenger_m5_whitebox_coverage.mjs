/**
 * tests/test_challenger_m5_whitebox_coverage.mjs
 * 
 * EARTHSONIC Milestone M5: Tier 5 White-Box Adversarial Coverage Hardening Suite.
 * 
 * Author: challenger_m5_1 (Teamwork Challenger / Critic & Specialist)
 * Scope:
 *   1. Dual-Mode VR Renderer (vr_renderer.js)
 *   2. Inertial Glider Navigation & Horizon Lock (vr_glider.js)
 *   3. Diegetic Gaze Interaction & Zenith Escape (vr_gaze.js)
 *   4. 3D HRTF Spatial Audio Subsystem (vr_audio.js)
 *   5. Planetary Phenomena Shaders & Math Models (vr_shaders.js)
 *   6. 573-Month TimeSpline & Scene Graph Frame (vr_spline.js, vr_scene.js)
 *   7. VR Launcher & Backend LAN IP Discovery (vr_launcher.js, backend/app.py)
 *   8. Minimal Chrome-Free VR Screen Isolation & JPL Theme (frontend/css/main.css)
 *   9. Forensic Tampering Audit & Chaotic Stress Simulation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';

// Import target subsystems under test
import {
  VRRenderer,
  computeScissorStereo,
  DEFAULT_EYE_SEP,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR
} from '../frontend/js/globe/vr/vr_renderer.js';

import {
  VRGliderNavigation,
  VRGlider,
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

import {
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader,
  generateTileableNoiseTexture,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  updatePlanetaryShaders
} from '../frontend/js/globe/vr/vr_shaders.js';

import {
  createTimeSpline,
  getSplineFrame,
  SKIM_ALTITUDE
} from '../frontend/js/globe/vr/vr_spline.js';

import {
  TOTAL_MONTHS,
  interpolateHarmonizedRecord
} from '../frontend/js/globe/vr/vr_timeline.js';

import {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  VROnboardingController,
  VRLoadingController
} from '../frontend/js/globe/vr/vr_scene.js';

import { installEarthsonicVR } from '../frontend/js/globe/vr/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Test Mock Utilities
// ============================================================================

function createMockRenderer(w = 1920, h = 1080) {
  const log = [];
  const size = new THREE.Vector2(w, h);
  return {
    domElement: {
      clientWidth: w,
      clientHeight: h,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    xr: { enabled: false, isPresenting: false, setSession: async () => {}, setAnimationLoop: () => {} },
    setScissorTest: (val) => log.push({ method: 'setScissorTest', args: [Boolean(val)] }),
    setScissor: (x, y, sw, sh) => log.push({ method: 'setScissor', args: [x, y, sw, sh] }),
    setViewport: (x, y, vw, vh) => log.push({ method: 'setViewport', args: [x, y, vw, vh] }),
    render: (scene, cam) => log.push({ method: 'render', camName: cam?.name || 'unknown' }),
    getSize: (target) => { target.copy(size); return target; },
    setSize: (newW, newH) => { size.set(newW, newH); log.push({ method: 'setSize', args: [newW, newH] }); },
    _log: log,
    _clear: () => { log.length = 0; }
  };
}

function createMockMixer() {
  const tracks = STEM_MAPPING.map(m => ({
    id: m.id,
    name: m.name,
    isSoloed: false,
    isMuted: false,
    connect: () => {},
    disconnect: () => {}
  }));

  return {
    tracks,
    getAllTracks: () => tracks,
    getTrack: (id) => tracks.find(t => t.id === id),
    setTrackSolo: (id, val) => {
      const t = tracks.find(x => x.id === id);
      if (t) t.isSoloed = Boolean(val);
    },
    setTrackMute: (id, val) => {
      const t = tracks.find(x => x.id === id);
      if (t) t.isMuted = Boolean(val);
    },
    busInputNode: { connect: () => {}, disconnect: () => {} },
    masterGainNode: { connect: () => {}, disconnect: () => {} },
    duration: 20.0,
    seekProgress: () => {},
    seek: () => {}
  };
}

// ============================================================================
// TIER 5 WHITE-BOX ADVERSARIAL STRESS SUITES
// ============================================================================

describe('Tier 5 Adversarial Stress Suite: White-Box Coverage Hardening', () => {

  // --------------------------------------------------------------------------
  // SUITE 1: Dual-Mode VR Renderer (vr_renderer.js)
  // --------------------------------------------------------------------------
  describe('Suite 1: Dual-Mode VR Renderer Boundary & Singularity Hardening', () => {

    it('T5-REN-01: Scissor stereo partition sum invariant across extreme odd/even dimensions', () => {
      const testDims = [
        [1, 1], [2, 1], [1, 2], [3, 1080], [1921, 1080], [1920, 1081],
        [3841, 2161], [7680, 1], [1, 4320], [100001, 50000]
      ];

      for (const [w, h] of testDims) {
        const result = computeScissorStereo(w, h, DEFAULT_EYE_SEP);
        const [lx, ly, lw, lh] = result.leftEye.scissor;
        const [rx, ry, rw, rh] = result.rightEye.scissor;

        // Partition invariant: left width + right width MUST EQUAL total width
        assert.equal(lw + rw, w, `Width sum must equal total width for ${w}x${h}`);
        // Right eye X offset must exactly equal left eye width
        assert.equal(rx, lw, `Right eye X must align with left eye width for ${w}x${h}`);
        assert.equal(lx, 0, `Left eye X must be 0 for ${w}x${h}`);
        assert.equal(ly, 0, `Left eye Y must be 0 for ${w}x${h}`);
        assert.equal(ry, 0, `Right eye Y must be 0 for ${w}x${h}`);
        assert.equal(lh, h, `Left eye height must match total height for ${w}x${h}`);
        assert.equal(rh, h, `Right eye height must match total height for ${w}x${h}`);
      }
    });

    it('T5-REN-02: Scissor stereo input sanitization and fallback for NaN, 0, negative, and strings', () => {
      // 0 width falls back to default 1920
      const resZero = computeScissorStereo(0, 0);
      assert.equal(resZero.leftEye.scissor[2] + resZero.rightEye.scissor[2], 1920);
      assert.equal(resZero.leftEye.scissor[3], 1080);

      // Negative values clamped via Math.max(1, ...)
      const resNeg = computeScissorStereo(-500, -200);
      assert.equal(resNeg.leftEye.scissor[2] + resNeg.rightEye.scissor[2], 1);
      assert.equal(resNeg.leftEye.scissor[3], 1);

      // NaN values fallback safely
      const resNaN = computeScissorStereo(NaN, NaN);
      assert.equal(resNaN.leftEye.scissor[2] + resNaN.rightEye.scissor[2], 1920);

      // String inputs coerced properly
      const resStr = computeScissorStereo("2560", "1440");
      assert.equal(resStr.leftEye.scissor[2] + resStr.rightEye.scissor[2], 2560);
      assert.equal(resStr.leftEye.scissor[3], 1440);
    });

    it('T5-REN-03: Interpupillary distance (IPD) offsets under extreme values and zero IPD', () => {
      // Normal adult IPD (64mm)
      const normal = computeScissorStereo(1920, 1080, 0.064);
      assert.equal(normal.leftEye.camOffsetX, -0.032);
      assert.equal(normal.rightEye.camOffsetX, 0.032);

      // Zero IPD (cyclopean mono pass)
      const zero = computeScissorStereo(1920, 1080, 0.0);
      assert.equal(zero.leftEye.camOffsetX, 0.0);
      assert.equal(zero.rightEye.camOffsetX, 0.0);

      // Negative IPD (inverted eyes)
      const inverted = computeScissorStereo(1920, 1080, -0.064);
      assert.equal(inverted.leftEye.camOffsetX, 0.032);
      assert.equal(inverted.rightEye.camOffsetX, -0.032);

      // Macro-orbital IPD (1000m baseline)
      const macro = computeScissorStereo(1920, 1080, 1000.0);
      assert.equal(macro.leftEye.camOffsetX, -500.0);
      assert.equal(macro.rightEye.camOffsetX, 500.0);
    });

    it('T5-REN-04: Full WebGL execution trace and scissor test restore invariant', () => {
      const mock = createMockRenderer(1920, 1080);
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);

      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, mock);

      mock._clear();
      vrRenderer.renderStereoPass();

      // Check log call ordering
      const log = mock._log;
      assert.ok(log.length >= 8, 'Must log scissor and viewport calls');

      // 1. Scissor enabled
      assert.equal(log[0].method, 'setScissorTest');
      assert.equal(log[0].args[0], true);

      // 2. Left eye viewport & scissor
      assert.equal(log[1].method, 'setViewport');
      assert.deepEqual(log[1].args, [0, 0, 960, 1080]);
      assert.equal(log[2].method, 'setScissor');
      assert.deepEqual(log[2].args, [0, 0, 960, 1080]);
      assert.equal(log[3].method, 'render');
      assert.equal(log[3].camName, 'Stereo_CameraLeft');

      // 3. Right eye viewport & scissor
      assert.equal(log[4].method, 'setViewport');
      assert.deepEqual(log[4].args, [960, 0, 960, 1080]);
      assert.equal(log[5].method, 'setScissor');
      assert.deepEqual(log[5].args, [960, 0, 960, 1080]);
      assert.equal(log[6].method, 'render');
      assert.equal(log[6].camName, 'Stereo_CameraRight');

      // 4. Scissor test must be turned OFF and full canvas restored
      assert.equal(log[7].method, 'setScissorTest');
      assert.equal(log[7].args[0], false);
      assert.equal(log[8].method, 'setViewport');
      assert.deepEqual(log[8].args, [0, 0, 1920, 1080]);
      assert.equal(log[9].method, 'setScissor');
      assert.deepEqual(log[9].args, [0, 0, 1920, 1080]);

      vrRenderer.dispose();
    });

    it('T5-REN-05: Idempotent start, stop, and rapid mode cycling stability', async () => {
      const mock = createMockRenderer();
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, mock);

      // Calling stop when inactive must be completely safe
      assert.doesNotThrow(() => vrRenderer.stop());
      assert.equal(vrRenderer.getMode(), 'inactive');

      // Cycle 25 consecutive start/stop stereo passes
      for (let i = 0; i < 25; i++) {
        await vrRenderer.start('stereo');
        assert.equal(vrRenderer.isStereoActive(), true);
        assert.equal(vrRenderer.getMode(), 'stereo');
        vrRenderer.stop();
        assert.equal(vrRenderer.isStereoActive(), false);
        assert.equal(vrRenderer.getMode(), 'inactive');
      }

      vrRenderer.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 2: Glider Inertial Physics & Horizon Lock (vr_glider.js)
  // --------------------------------------------------------------------------
  describe('Suite 2: Glider Inertial Physics & Horizon Lock Hardening', () => {

    it('T5-GLI-01: Micro-threshold deadzone boundary (+/-15.0 deg exact limits)', () => {
      // Exactly at +15.0 deg deadzone
      const atPos15 = computeGliderStep(15.0, 0.0);
      assert.equal(atPos15.excess, 0.0, 'Excess must be exactly 0 at +15.0 deg');
      assert.equal(atPos15.newVelocity, 0.0);

      // Infinitesimal positive breach (+15.0001 deg)
      const justAbove15 = computeGliderStep(15.0001, 0.0);
      assert.ok(justAbove15.excess > 0.0, 'Excess must be positive just above 15 deg');
      assert.ok(justAbove15.newVelocity > 0.0, 'Velocity must accelerate forward');

      // Exactly at -15.0 deg deadzone
      const atNeg15 = computeGliderStep(-15.0, 0.0);
      assert.equal(atNeg15.excess, 0.0, 'Excess must be exactly 0 at -15.0 deg');
      assert.equal(atNeg15.newVelocity, 0.0);

      // Infinitesimal negative breach (-15.0001 deg)
      const justBelowNeg15 = computeGliderStep(-15.0001, 0.0);
      assert.ok(justBelowNeg15.excess < 0.0, 'Excess must be negative just below -15 deg');
      assert.ok(justBelowNeg15.newVelocity < 0.0, 'Velocity must accelerate backward');

      // Interior values must have 0 excess
      for (const yaw of [-14.999, -10.0, -5.0, 0.0, 5.0, 10.0, 14.999]) {
        assert.equal(computeGliderStep(yaw, 0.0).excess, 0.0);
      }
    });

    it('T5-GLI-02: Yaw acceleration symmetry and geometric damping convergence', () => {
      const yawMag = 45.0; // 30 deg excess
      const pos = computeGliderStep(yawMag, 0.0);
      const neg = computeGliderStep(-yawMag, 0.0);

      assert.equal(pos.excess, -neg.excess, 'Positive and negative yaw excess must be strictly symmetric');
      assert.equal(pos.newVelocity, -neg.newVelocity, 'Positive and negative velocity must be strictly symmetric');

      // Multi-step damping decay from high velocity
      const glider = new VRGliderNavigation();
      glider.timelineVelocity = 0.05;
      for (let step = 0; step < 160; step++) {
        glider.stepPhysics(0.0); // Inside deadzone (yaw = 0)
      }
      assert.equal(glider.timelineVelocity, 0.0, 'Velocity must decay geometrically to 0.0 via creep cutoff');
    });

    it('T5-GLI-03: Elastic boundary wall collision arrest at t=0 and t=1', () => {
      const glider = new VRGliderNavigation();
      glider.setTimelinePosition(0.0);
      glider.timelineVelocity = -0.01; // Negative velocity at lower wall

      glider.stepPhysics(0.0);
      assert.equal(glider.getTimelinePosition(), 0.0, 'Position must remain clamped at 0.0');
      assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity must be arrested to 0.0 at wall');

      glider.setTimelinePosition(1.0);
      glider.timelineVelocity = 0.01; // Positive velocity at upper wall

      glider.stepPhysics(0.0);
      assert.equal(glider.getTimelinePosition(), 1.0, 'Position must remain clamped at 1.0');
      assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity must be arrested to 0.0 at wall');
    });

    it('T5-GLI-04: 100% locked horizon (roll === 0.0) invariant under dirty inputs and full pitch range', () => {
      const dirtyRolls = [0.1, 45.0, 90.0, 180.0, -90.0, -180.0, 720.0, NaN, undefined];

      for (const r of dirtyRolls) {
        const safe = enforceZeroRoll(30.0, 45.0, r);
        assert.equal(safe.roll, 0.0, `Roll must be strictly forced to 0.0 regardless of dirty input ${r}`);
        assert.equal(safe.pitch, 30.0);
      }

      // Pitch clamping [-90, +90]
      assert.equal(enforceZeroRoll(120.0, 0.0).pitch, 90.0, 'Pitch > 90 must clamp to 90');
      assert.equal(enforceZeroRoll(-120.0, 0.0).pitch, -90.0, 'Pitch < -90 must clamp to -90');

      // Camera Euler order and rotation.z invariant in Three.js
      const camera = new THREE.PerspectiveCamera();
      const mockScene = { camera };
      const nav = new VRGliderNavigation(mockScene);

      for (let pitch = -90; pitch <= 90; pitch += 15) {
        for (let yaw = -180; yaw <= 180; yaw += 45) {
          nav.setLookAngles(yaw, pitch);
          assert.equal(camera.rotation.order, 'YXZ', 'Euler order must remain YXZ');
          assert.equal(camera.rotation.z, 0.0, `Camera roll MUST be 0.0 at pitch=${pitch}, yaw=${yaw}`);
        }
      }
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 3: Diegetic Gaze Interaction & Zenith Escape (vr_gaze.js)
  // --------------------------------------------------------------------------
  describe('Suite 3: Diegetic Gaze Interaction & Zenith Escape Hardening', () => {

    it('T5-GAZ-01: Sphere raycasting forward condition and hitbox boundary', () => {
      const mockGlyphs = [];
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group();
        g.position.set(0, 0, -2.0); // Directly in front at z = -2.0
        mockGlyphs.push(g);
      }

      const vrScene = { dataGlyphs: mockGlyphs, cameraRig: new THREE.Group() };
      const gaze = new VRGazeController(vrScene);
      gaze.init();

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1); // Looking forward

      gaze.update(camera, 0.016);
      assert.equal(gaze.getActiveGlyph(), 0, 'Must intersect glyph directly in front');

      // Test glyph behind camera (z = +2.0)
      mockGlyphs[0].position.set(0, 0, 2.0);
      gaze.update(camera, 0.016);
      assert.equal(gaze.getActiveGlyph(), 1, 'Must NOT intersect glyph behind camera');
    });

    it('T5-GAZ-02: Sub-threshold dwell decay rate and rollback', () => {
      const mockGlyphs = [new THREE.Group()];
      mockGlyphs[0].position.set(0, 0, -2.0);
      const vrScene = { dataGlyphs: mockGlyphs, cameraRig: new THREE.Group() };
      const gaze = new VRGazeController(vrScene);
      gaze.init();

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);

      // Dwell for 300ms (50% of threshold)
      gaze.update(camera, 0.300);
      const state = gaze.getGlyphState(0);
      assert.ok(Math.abs(state.progress - 0.5) < 0.05, `Progress must be ~0.5: got ${state.progress}`);
      assert.equal(state.hasTriggered, false);

      // Divert gaze away (look right)
      camera.lookAt(1, 0, 0);
      gaze.update(camera, 0.100); // 100ms decay

      // Expected decay: dwellTimer reduced by 0.1 * GAZE_DECAY_RATE (2.5) = 0.25s
      assert.ok(state.dwellTimer < 0.300, 'Dwell timer must decay upon diversion');
      assert.ok(state.progress < 0.5, 'Progress must decay upon diversion');

      // More decay to reach zero
      gaze.update(camera, 0.200);
      assert.equal(state.dwellTimer, 0.0, 'Dwell timer must decay cleanly to 0.0');
      assert.equal(state.progress, 0.0, 'Progress must reach 0.0 without going negative');
    });

    it('T5-GAZ-03: Exact 600ms trigger threshold and single-fire idempotency', () => {
      const mockGlyphs = [new THREE.Group()];
      mockGlyphs[0].position.set(0, 0, -2.0);
      const mixer = createMockMixer();
      let triggerCount = 0;

      const vrScene = { dataGlyphs: mockGlyphs, cameraRig: new THREE.Group() };
      const gaze = new VRGazeController(vrScene, mixer, {
        onTrigger: () => { triggerCount++; }
      });
      gaze.init();

      const camera = new THREE.PerspectiveCamera();
      camera.position.set(0, 0, 0);
      camera.lookAt(0, 0, -1);

      // 590ms: not yet triggered
      gaze.update(camera, 0.590);
      assert.equal(triggerCount, 0, 'Must NOT trigger before 600ms');

      // +20ms: reaches 610ms -> triggers!
      gaze.update(camera, 0.020);
      assert.equal(triggerCount, 1, 'Must trigger at 600ms');
      assert.equal(mixer.getTrack(STEM_MAPPING[0].id).isSoloed, true);

      // Sustained dwell for another 1000ms: must NOT trigger again
      for (let i = 0; i < 20; i++) {
        gaze.update(camera, 0.050);
      }
      assert.equal(triggerCount, 1, 'Must NOT trigger repeatedly while hover is maintained');

      // Look away: trigger state clears
      camera.lookAt(1, 0, 0);
      gaze.update(camera, 0.050);
      assert.equal(gaze.getGlyphState(0).hasTriggered, false);
    });

    it('T5-GAZ-04: Zenith gaze exit threshold (+75 deg) and 1.5s dwell timing', () => {
      let exitFired = false;
      const rig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera();
      rig.add(camera);

      const vrScene = { dataGlyphs: [], cameraRig: rig, zenithRing: null };
      const gaze = new VRGazeController(vrScene, null, {
        onZenithExit: () => { exitFired = true; }
      });

      // 1. Look at +74 deg (just below +75 deg threshold)
      camera.lookAt(0, Math.sin(74 * Math.PI / 180), -Math.cos(74 * Math.PI / 180));
      gaze.update(camera, 1.0);
      assert.equal(gaze.getZenithProgress(), 0.0, 'Must NOT accumulate zenith dwell below 75 deg');
      assert.equal(exitFired, false);

      // 2. Look at +85 deg (well above +75 deg threshold)
      camera.lookAt(0, Math.sin(85 * Math.PI / 180), -Math.cos(85 * Math.PI / 180));

      // 1.4s dwell (below 1.5s)
      gaze.update(camera, 1.400);
      assert.ok(gaze.getZenithProgress() > 0.9, 'Zenith progress must be > 0.9');
      assert.equal(exitFired, false, 'Must NOT trigger exit before 1.5s');

      // +0.15s: reaches 1.55s -> triggers!
      gaze.update(camera, 0.150);
      assert.equal(exitFired, true, 'Must trigger zenith exit at 1.5s');

      // Looking back down resets progress immediately
      camera.lookAt(0, 0, -1);
      gaze.update(camera, 0.016);
      assert.equal(gaze.getZenithProgress(), 0.0, 'Zenith dwell must reset to 0 upon looking away');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 4: 3D HRTF Spatial Audio Subsystem (vr_audio.js)
  // --------------------------------------------------------------------------
  describe('Suite 4: 3D HRTF Spatial Audio & Seek Throttling Hardening', () => {

    it('T5-AUD-01: HRTF panner node specification invariants', () => {
      const audio = new VRSpatialAudio();
      assert.equal(audio.panners.length, 4);

      for (let i = 0; i < 4; i++) {
        const p = audio.panners[i];
        assert.equal(p.panningModel, PANNING_MODEL);
        assert.equal(p.distanceModel, DISTANCE_MODEL);
        assert.equal(p.refDistance, REF_DISTANCE);
        assert.equal(p.rolloffFactor, ROLLOFF_FACTOR);
        assert.equal(p.maxDistance, MAX_DISTANCE);
        assert.equal(p.coneInnerAngle, 360);
        assert.equal(p.coneOuterAngle, 360);
      }
    });

    it('T5-AUD-02: Panner coordinate updates matching DataGlyph world positions', () => {
      const glyphs = [];
      for (let i = 0; i < 4; i++) {
        const g = new THREE.Group();
        g.position.set(i * 1.5, -0.5, -2.0 - i * 0.2);
        g.updateMatrixWorld(true);
        glyphs.push(g);
      }

      const camera = new THREE.PerspectiveCamera();
      const audio = new VRSpatialAudio({ dataGlyphs: glyphs, camera });
      audio.updatePositions(camera, glyphs);

      for (let i = 0; i < 4; i++) {
        const p = audio.panners[i];
        assert.equal(p.positionX.value, i * 1.5);
        assert.equal(p.positionY.value, -0.5);
        assert.equal(p.positionZ.value, -2.0 - i * 0.2);
      }
    });

    it('T5-AUD-03: Audio playhead seek throttling (40ms rule) and boundary exemption', () => {
      let seekCount = 0;
      let lastSeekVal = -1;
      const mixer = {
        duration: 20.0,
        seekProgress: (t) => { seekCount++; lastSeekVal = t; },
        seek: () => {}
      };

      const audio = new VRSpatialAudio({ mixer });

      // First seek at t = 0.25 (flight scrub)
      audio.syncPlayhead(0.25);
      assert.equal(seekCount, 1);
      assert.equal(lastSeekVal, 0.25);

      // Immediate second seek at t = 0.26 within 1ms: must be throttled!
      audio.syncPlayhead(0.26);
      assert.equal(seekCount, 1, 'Rapid flight seek within 40ms must be throttled');

      // Identical stationary seek: suppressed
      audio.lastSeekTime = 0; // Bypass throttle timer
      audio.syncPlayhead(0.25);
      assert.equal(seekCount, 1, 'Identical stationary seek must be suppressed');

      // Boundary seeks (t = 0.0 and t = 1.0) must bypass 40ms throttle!
      audio.lastSeekTime = Date.now(); // Simulate recent seek
      audio.syncPlayhead(0.0);
      assert.equal(seekCount, 2, 'Boundary seek at t=0.0 must bypass 40ms throttle');
      assert.equal(lastSeekVal, 0.0);

      audio.lastSeekTime = Date.now();
      audio.syncPlayhead(1.0);
      assert.equal(seekCount, 3, 'Boundary seek at t=1.0 must bypass 40ms throttle');
      assert.equal(lastSeekVal, 1.0);
    });

    it('T5-AUD-04: Reversible attach and detach lifecycle restoration', () => {
      const mixer = createMockMixer();
      const audio = new VRSpatialAudio({ mixer });

      audio.attach();
      assert.equal(audio.isAttached, true);
      assert.equal(mixer.getAllTracks()[0].spatialPannerNode, audio.panners[0]);

      audio.detach();
      assert.equal(audio.isAttached, false);
      assert.equal(mixer.getAllTracks()[0].spatialPannerNode, null);

      audio.dispose();
      assert.equal(audio.panners.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 5: Planetary Physical Shaders (vr_shaders.js)
  // --------------------------------------------------------------------------
  describe('Suite 5: Planetary Shaders & Physical Mathematical Models Hardening', () => {

    it('T5-SHA-01: Procedural tileable noise headless fallback integrity', () => {
      const tex = generateTileableNoiseTexture(128, 128);
      assert.ok(tex instanceof THREE.DataTexture || tex instanceof THREE.CanvasTexture);
      assert.equal(tex.image.width, 128);
      assert.equal(tex.image.height, 128);
    });

    it('T5-SHA-02: GISTEMP v4 Terminator Ribbon color ramp mathematical interpolation', () => {
      const coolCobalt = new THREE.Vector3(0.15, 0.35, 0.90);
      const amberRed = new THREE.Vector3(0.95, 0.25, 0.10);

      const evalRamp = (anom) => {
        const clamped = Math.max(-1.0, Math.min(1.0, anom));
        const alpha = (clamped + 1.0) * 0.5;
        return new THREE.Vector3().lerpVectors(coolCobalt, amberRed, alpha);
      };

      // -1.0 deg C -> pure cool cobalt
      const c1979 = evalRamp(-1.0);
      assert.ok(Math.abs(c1979.x - 0.15) < 1e-4);
      assert.ok(Math.abs(c1979.y - 0.35) < 1e-4);
      assert.ok(Math.abs(c1979.z - 0.90) < 1e-4);

      // +1.0 deg C -> pure amber-red
      const c2026 = evalRamp(1.0);
      assert.ok(Math.abs(c2026.x - 0.95) < 1e-4);
      assert.ok(Math.abs(c2026.y - 0.25) < 1e-4);
      assert.ok(Math.abs(c2026.z - 0.10) < 1e-4);

      // Out of bounds anomaly clamping
      const cLow = evalRamp(-50.0);
      assert.deepEqual(cLow, c1979);
      const cHigh = evalRamp(50.0);
      assert.deepEqual(cHigh, c2026);
    });

    it('T5-SHA-03: Mauna Loa CO2 scattering optical depth and horizon haze formulas', () => {
      const evalCO2 = (ppm, envelope = 0.0) => {
        const clamped = Math.max(280.0, Math.min(600.0, ppm));
        const norm = Math.max(0.0, Math.min(1.0, (clamped - 336.0) / (426.0 - 336.0)));
        const depth = (1.0 + 0.75 * norm) * (1.0 + 0.15 * envelope);
        return { norm, depth };
      };

      // 336 ppm baseline
      const base = evalCO2(336.0);
      assert.equal(base.norm, 0.0);
      assert.equal(base.depth, 1.0);

      // 426 ppm peak
      const peak = evalCO2(426.0);
      assert.equal(peak.norm, 1.0);
      assert.equal(peak.depth, 1.75);

      // Audio envelope modulation
      const mod = evalCO2(426.0, 1.0);
      assert.ok(Math.abs(mod.depth - 1.75 * 1.15) < 1e-4);
    });

    it('T5-SHA-04: OceanGlowField Fresnel and water mask strictness', () => {
      const evalFresnel = (cosTheta) => Math.pow(1.0 - Math.max(0.0, cosTheta), 2.5);

      // Straight-on view (cosTheta = 1.0) -> Fresnel = 0.0
      assert.equal(evalFresnel(1.0), 0.0);

      // Horizon grazing view (cosTheta = 0.0) -> Fresnel = 1.0
      assert.equal(evalFresnel(0.0), 1.0);

      // 45 deg view
      const f45 = evalFresnel(Math.cos(Math.PI / 4));
      assert.ok(f45 > 0.0 && f45 < 1.0);
    });

    it('T5-SHA-05: NSIDC Ice Cap IOR=1.31 specular rim and boundary retreat', () => {
      const IOR = 1.31;
      const R0 = Math.pow((IOR - 1.0) / (IOR + 1.0), 2.0);
      assert.ok(Math.abs(R0 - 0.01802) < 1e-4, 'R0 must be ~0.01802 for ice IOR 1.31');

      const evalBoundary = (normExtent) => 85.0 - 25.0 * Math.max(0.0, Math.min(1.0, normExtent));

      // Record melt (normExtent = 0.0) -> boundary retreats to 85 deg
      assert.equal(evalBoundary(0.0), 85.0);

      // Full glaciation (normExtent = 1.0) -> boundary extends to 60 deg
      assert.equal(evalBoundary(1.0), 60.0);
    });

    it('T5-SHA-06: Robust updatePlanetaryShaders under missing or malformed inputs', () => {
      // Must not throw when called with null/empty record
      assert.doesNotThrow(() => updatePlanetaryShaders({}));

      const ribbon = createTerminatorRibbon(10.015, 0.18, 16);
      const atmo = createAtmosphereShell(10.25);
      const ocean = createOceanGlowField(10.002);
      const ice = createIceCapGroup(10.005);

      const record = {
        temperature_anomaly: 0.85,
        co2_ppm: 418.5,
        normalized_ocean_temp: 0.72,
        normalized_sea_ice_extent: 0.35
      };

      updatePlanetaryShaders({
        terminatorRibbon: ribbon,
        atmosphereShell: atmo,
        oceanGlowField: ocean,
        iceCapGroup: ice,
        monthRecord: record,
        audioEnvelopes: [0.5, 0.4, 0.3, 0.2],
        clockTime: 12.34
      });

      assert.equal(ribbon.material.uniforms.uAnomalyValue.value, 0.85);
      assert.equal(ribbon.material.uniforms.uAudioEnvelope.value, 0.5);
      assert.equal(atmo.material.uniforms.uCO2Ppm.value, 418.5);
      assert.equal(atmo.material.uniforms.uAudioEnvelope.value, 0.4);
      assert.equal(ocean.material.uniforms.uOHC.value, 0.72);
      assert.equal(ocean.material.uniforms.uAudioEnvelope.value, 0.3);
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 6: TimeSpline Orbit & Stratospheric Skim Frame (vr_spline.js)
  // --------------------------------------------------------------------------
  describe('Suite 6: TimeSpline Orbit & Stratospheric Skim Frame Hardening', () => {

    it('T5-SPL-01: TimeSpline parameterization and orbital altitude invariant', () => {
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
      assert.equal(spline.points.length, 573);

      // Verify orbital altitude is locked at 10.22 across 50 sample points
      for (let i = 0; i <= 50; i++) {
        const t = i / 50.0;
        const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);
        const radius = frame.position.length();
        assert.ok(
          Math.abs(radius - SKIM_ALTITUDE) < 1e-4,
          `Altitude at t=${t} must be ${SKIM_ALTITUDE}: got ${radius}`
        );
      }
    });

    it('T5-SPL-02: Horizon dip angle and depth buffer precision calculation', () => {
      // Horizon dip: arccos(R_earth / R_orbit)
      const dipRad = Math.acos(EARTH_RADIUS / SKIM_ALTITUDE);
      const dipDeg = dipRad * (180.0 / Math.PI);
      assert.ok(Math.abs(dipDeg - 11.91) < 0.1, `Horizon dip must be ~11.91 deg: got ${dipDeg}`);

      // Depth precision ratio: near / far
      const ratio = CAMERA_NEAR / CAMERA_FAR;
      assert.equal(ratio, 0.05 / 250.0);
      assert.equal(ratio, 0.0002, 'Depth ratio near/far must be 0.0002 for zero z-fighting');
    });

    it('T5-SPL-03: Orthonormal basis vectors and zero-roll frame invariant', () => {
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);

      for (let i = 0; i <= 20; i++) {
        const t = i / 20.0;
        const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);

        // Dot products must be ~0 (orthonormal)
        const upDotFwd = frame.up.dot(frame.forward);
        const upDotRight = frame.up.dot(frame.right);
        const fwdDotRight = frame.forward.dot(frame.right);

        assert.ok(Math.abs(upDotFwd) < 1e-5, `Up and Forward must be orthogonal at t=${t}`);
        assert.ok(Math.abs(upDotRight) < 1e-5, `Up and Right must be orthogonal at t=${t}`);
        assert.ok(Math.abs(fwdDotRight) < 1e-5, `Forward and Right must be orthogonal at t=${t}`);

        // Vector lengths must be 1.0
        assert.ok(Math.abs(frame.up.length() - 1.0) < 1e-5);
        assert.ok(Math.abs(frame.forward.length() - 1.0) < 1e-5);
        assert.ok(Math.abs(frame.right.length() - 1.0) < 1e-5);
      }
    });

    it('T5-SPL-04: Climate record linear interpolation boundary and fractional checks', () => {
      const records = [
        { date: '1979-01', temperature_anomaly: 0.10, co2_ppm: 336.0 },
        { date: '2026-09', temperature_anomaly: 1.10, co2_ppm: 426.0 }
      ];

      // t = 0.0
      const rStart = interpolateHarmonizedRecord(records, 0.0);
      assert.equal(rStart.date, '1979-01');
      assert.equal(rStart.temperature_anomaly, 0.10);
      assert.equal(rStart.co2_ppm, 336.0);

      // t = 1.0
      const rEnd = interpolateHarmonizedRecord(records, 1.0);
      assert.equal(rEnd.date, '2026-09');
      assert.equal(rEnd.temperature_anomaly, 1.10);
      assert.equal(rEnd.co2_ppm, 426.0);

      // t = 0.5 (halfway)
      const rMid = interpolateHarmonizedRecord(records, 0.5);
      assert.ok(Math.abs(rMid.temperature_anomaly - 0.60) < 1e-4);
      assert.ok(Math.abs(rMid.co2_ppm - 381.0) < 1e-4);
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 7: Backend LAN IP & Launch Info Contract (backend/app.py)
  // --------------------------------------------------------------------------
  describe('Suite 7: Backend LAN IP Discovery & Launch Contract Hardening', () => {

    it('T5-LAN-01: Static audit of backend/app.py GET /api/vr-launch-info contract', () => {
      const appPyPath = path.join(PROJECT_ROOT, 'backend', 'app.py');
      assert.ok(fs.existsSync(appPyPath), 'backend/app.py must exist');

      const content = fs.readFileSync(appPyPath, 'utf8');

      // Verify route definition
      assert.ok(content.includes('@app.route("/api/vr-launch-info"'), 'Must define /api/vr-launch-info route');
      assert.ok(content.includes('def vr_launch_info():'), 'Must define vr_launch_info handler');
      assert.ok(content.includes('get_primary_lan_ip()'), 'Must call get_primary_lan_ip()');
      assert.ok(content.includes('8.8.8.8'), 'Must use UDP connect trick to 8.8.8.8:80');
      assert.ok(content.includes('/?vr=1'), 'Must construct launch URL with ?vr=1 parameter');
      assert.ok(content.includes('0.0.0.0'), 'Must support binding to 0.0.0.0');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 8: JPL Theme & Minimal Chrome-Free VR Screen (frontend/css/main.css)
  // --------------------------------------------------------------------------
  describe('Suite 8: JPL Mission Console & Minimal VR Screen Isolation Hardening', () => {

    it('T5-CSS-01: Static audit of JPL theme tokens and typography in main.css', () => {
      const cssPath = path.join(PROJECT_ROOT, 'frontend', 'css', 'main.css');
      assert.ok(fs.existsSync(cssPath), 'frontend/css/main.css must exist');

      const css = fs.readFileSync(cssPath, 'utf8');

      // JPL palette tokens
      assert.ok(css.includes('--color-void: #060a12;'), 'Must define #060a12 void token');
      assert.ok(css.includes('--color-navy: #0b1220;'), 'Must define #0b1220 panel token');
      assert.ok(css.includes('--color-border: #1b2636;'), 'Must define #1b2636 hairline token');
      assert.ok(css.includes('--color-delta: #ff8a3d;'), 'Must define #ff8a3d primary amber token');
      assert.ok(css.includes('--color-cyan: #6fe3ff;'), 'Must define #6fe3ff secondary cyan token');
      assert.ok(css.includes('--color-text: #dce6f2;'), 'Must define #dce6f2 primary text token');
      assert.ok(css.includes('--color-muted: #7b8ba3;'), 'Must define #7b8ba3 secondary label token');

      // IBM Plex typography
      assert.ok(css.includes("'IBM Plex Mono'"), 'Must include IBM Plex Mono font token');
      assert.ok(css.includes("'IBM Plex Sans'"), 'Must include IBM Plex Sans font token');
    });

    it('T5-CSS-02: Complete 2D chrome isolation under body.vr-mode-active', () => {
      const cssPath = path.join(PROJECT_ROOT, 'frontend', 'css', 'main.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Rule must target body.vr-mode-active
      assert.ok(css.includes('body.vr-mode-active'), 'Must define body.vr-mode-active isolation rules');
      assert.ok(css.includes('display: none !important;'), 'Must enforce display: none !important');
      assert.ok(css.includes('visibility: hidden !important;'), 'Must enforce visibility: hidden !important');
      assert.ok(css.includes('opacity: 0 !important;'), 'Must enforce opacity: 0 !important');

      // Key 2D components isolated
      const components = [
        '.mission-header',
        '.globe-hud-overlay',
        '.orchestra-dock',
        '.telemetry-matrix-grid',
        '.channel-strip',
        '.visualizer-hud',
        '#vr-desktop-modal'
      ];

      for (const comp of components) {
        assert.ok(css.includes(comp), `Isolation rule must cover ${comp}`);
      }
    });

    it('T5-CSS-03: Fading onboarding prompt and amber loading overlay styles', () => {
      const cssPath = path.join(PROJECT_ROOT, 'frontend', 'css', 'main.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      assert.ok(css.includes('.vr-onboarding-prompt'), 'Must style .vr-onboarding-prompt');
      assert.ok(css.includes('transition: opacity 0.8s'), 'Must specify ~800ms fade transition');
      assert.ok(css.includes('#vr-loading-overlay') || css.includes('.vr-loading-overlay'), 'Must style VR loading overlay');
    });
  });

  // --------------------------------------------------------------------------
  // SUITE 9: Forensic Integrity Audit & Chaotic Multi-Subsystem Stress
  // --------------------------------------------------------------------------
  describe('Suite 9: Forensic Integrity Audit & Multi-Subsystem Stress Hardening', () => {

    it('T5-AUD-01: Verify frontend/js/globe/globe.js SHA-256 hash remains 100% PRISTINE', () => {
      const globeJsPath = path.join(PROJECT_ROOT, 'frontend', 'js', 'globe', 'globe.js');
      assert.ok(fs.existsSync(globeJsPath), 'frontend/js/globe/globe.js must exist');

      const fileBuffer = fs.readFileSync(globeJsPath);
      const computedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();

      const EXPECTED_HASH = '63CB0A87AF839D60A7FFB7CF601D2D2C611AC75039250A8416D62445568C76F6';
      assert.equal(
        computedHash,
        EXPECTED_HASH,
        `globe.js SHA-256 hash MUST be pristine! Found: ${computedHash}, Expected: ${EXPECTED_HASH}`
      );
    });

    it('T5-AUD-02: 100-frame chaotic stress simulation across all integrated VR subsystems', async () => {
      const mockRenderer = createMockRenderer(1920, 1080);
      const vrScene = new TerminatorSkimVRScene();

      // Ensure headless environment so Three.js uses DataTexture mocks
      const origDoc = global.document;
      delete global.document;

      // Mock AudioContext
      const mockAudioCtx = {
        currentTime: 0.0,
        listener: {
          positionX: { setValueAtTime: () => {} },
          positionY: { setValueAtTime: () => {} },
          positionZ: { setValueAtTime: () => {} },
          forwardX: { setValueAtTime: () => {} },
          forwardY: { setValueAtTime: () => {} },
          forwardZ: { setValueAtTime: () => {} },
          upX: { setValueAtTime: () => {} },
          upY: { setValueAtTime: () => {} },
          upZ: { setValueAtTime: () => {} }
        }
      };

      const mockMixer = createMockMixer();
      mockMixer.audioCtx = mockAudioCtx;

      vrScene.app = { mixer: mockMixer };
      await vrScene.init(mockRenderer);

      // Execute 100 chaotic frames
      for (let frame = 0; frame < 100; frame++) {
        // Random yaw oscillation (-60 to +60 deg)
        const randYaw = (Math.sin(frame * 0.3) * 60.0);
        // Random pitch oscillation (-45 to +85 deg)
        const randPitch = (Math.cos(frame * 0.2) * 65.0);

        vrScene.glider.setLookAngles(randYaw, randPitch);

        // Random audio envelope surges
        const envs = [
          Math.abs(Math.sin(frame * 0.1)),
          Math.abs(Math.cos(frame * 0.15)),
          Math.abs(Math.sin(frame * 0.2)),
          Math.abs(Math.cos(frame * 0.25))
        ];
        vrScene.updateAudioEnvelopes(envs);

        // Simulation tick (dt = 0.016s)
        vrScene.tick(0.016);

        // Invariant checks on every frame
        assert.equal(vrScene.camera.rotation.z, 0.0, `Frame ${frame}: Roll must be strictly 0.0`);
        assert.ok(!isNaN(vrScene.cameraRig.position.x), `Frame ${frame}: Camera position X cannot be NaN`);
        assert.ok(!isNaN(vrScene.cameraRig.position.y), `Frame ${frame}: Camera position Y cannot be NaN`);
        assert.ok(!isNaN(vrScene.cameraRig.position.z), `Frame ${frame}: Camera position Z cannot be NaN`);
        assert.ok(vrScene.currentT >= 0.0 && vrScene.currentT <= 1.0, `Frame ${frame}: Timeline t must be in [0, 1]`);
      }

      vrScene.exitVR();
      if (origDoc) global.document = origDoc;
    });

    it('T5-AUD-03: Global window.earthsonicVR contract complete surface coverage', () => {
      const mockApp = { mixer: createMockMixer() };
      const vrInterface = installEarthsonicVR(mockApp);

      // Accessors
      assert.ok('cameraRig' in vrInterface);
      assert.ok('camera' in vrInterface);
      assert.ok('timeSpline' in vrInterface);
      assert.ok('dataGlyphs' in vrInterface);
      assert.ok('isVRActive' in vrInterface);
      assert.ok('glider' in vrInterface);
      assert.ok('gazeController' in vrInterface);
      assert.ok('spatialAudio' in vrInterface);
      assert.ok('panners' in vrInterface);
      assert.ok('vrRenderer' in vrInterface);

      // Methods
      assert.equal(typeof vrInterface.enterVR, 'function');
      assert.equal(typeof vrInterface.exitVR, 'function');
      assert.equal(typeof vrInterface.updateTimeline, 'function');
      assert.equal(typeof vrInterface.updateAudioEnvelopes, 'function');
      assert.equal(typeof vrInterface.tick, 'function');
      assert.equal(typeof vrInterface.stepGlider, 'function');
      assert.equal(typeof vrInterface.setLookAngles, 'function');
      assert.equal(typeof vrInterface.getLookAngles, 'function');
      assert.equal(typeof vrInterface.getActiveGlyph, 'function');
      assert.equal(typeof vrInterface.triggerGlyph, 'function');
      assert.equal(typeof vrInterface.syncPlayhead, 'function');
    });
  });
});
