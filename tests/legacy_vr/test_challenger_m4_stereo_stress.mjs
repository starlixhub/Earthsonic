/**
 * tests/test_challenger_m4_stereo_stress.mjs
 * Empirical Challenger Stress Test Suite for EARTHSONIC Milestone M4
 * Feature 27: Dual-Mode Scissor Stereo VR Renderer (vr_renderer.js).
 *
 * Scenarios Tested:
 *   1. Scissor Integer Split Invariant (1000 random & boundary dimensions)
 *   2. Non-Standard Aspect Ratios (32:9 ultrawide, 9:16 mobile, 1:1 square, 1x1 single-pixel, extreme columns/ribbons)
 *   3. Eye Separation Boundary Conditions & Zero-Roll Invariant (negative, zero, child, adult, giant, macro, orientation)
 *   4. Render Pass Call Sequence Verification with WebGL Mock (strict order, scissor test toggle, full-canvas restore)
 *   5. Rapid Start/Stop Cycling (50 consecutive cycles, timer safety, zero leak, idempotent disposal)
 *   6. Subsystem Lockstep Execution under Frame Delta Variations (dt in [0.001, 1.0], order preservation, delta clamp)
 *   7. Defensive Fallbacks & Malformed Parameter Robustness
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  VRRenderer,
  computeScissorStereo,
  DEFAULT_EYE_SEP,
  CAMERA_FOV,
  CAMERA_NEAR,
  CAMERA_FAR
} from '../frontend/js/globe/vr/vr_renderer.js';

/**
 * High-fidelity WebGLRenderer Mock tracking execution call order and arguments.
 */
function createInstrumentedRenderer(width = 1920, height = 1080) {
  const log = [];
  const size = new THREE.Vector2(width, height);

  return {
    domElement: {
      clientWidth: width,
      clientHeight: height,
      style: {}
    },
    xr: {
      enabled: false,
      isPresenting: false,
      setSession: async () => {},
      setAnimationLoop: (fn) => {}
    },
    setScissorTest: (enabled) => {
      log.push({ method: 'setScissorTest', args: [Boolean(enabled)] });
    },
    setScissor: (x, y, w, h) => {
      log.push({ method: 'setScissor', args: [x, y, w, h] });
    },
    setViewport: (x, y, w, h) => {
      log.push({ method: 'setViewport', args: [x, y, w, h] });
    },
    render: (scene, camera) => {
      log.push({ method: 'render', scene, camera, cameraName: camera?.name || 'unknown' });
    },
    getSize: (target) => {
      target.copy(size);
      return target;
    },
    setSize: (w, h) => {
      size.set(w, h);
      log.push({ method: 'setSize', args: [w, h] });
    },
    _log: log,
    _clearLog: () => { log.length = 0; }
  };
}

/**
 * Deterministic pseudo-random number generator (Mulberry32) for reproducible property-based testing.
 */
function createPRNG(seed = 133742) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Challenger M4 Stereo Stress: Feature 27 Scissor Stereo Pipeline', () => {

  // =========================================================================
  // SUITE 1: Scissor Integer Split Invariant (1000 Dimensions)
  // =========================================================================
  describe('Suite 1: Scissor Integer Split Invariant Across 1000 Dimensions', () => {

    it('SCENARIO-1.1: 1000 Random & Boundary Dimensions Property Invariant Check', () => {
      const prng = createPRNG(0xCAFEBABE);

      // Explicit deterministic edge cases to prepend to the test set
      const edgeCases = [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
        [3, 3],
        [5, 5],
        [7, 7],
        [11, 11],
        [1365, 768],
        [1366, 768],
        [1919, 1080],
        [1920, 1080],
        [1921, 1080],
        [1921, 1081],
        [2559, 1440],
        [2560, 1440],
        [2561, 1441],
        [3839, 2160],
        [3840, 2160],
        [3841, 2161],
        [7679, 4320],
        [7680, 4320],
        [5120, 1440],
        [1080, 1920],
        [1024, 1024],
        [7680, 1],
        [1, 4320]
      ];

      const testPairs = [...edgeCases];
      while (testPairs.length < 1000) {
        const w = Math.floor(prng() * 7680) + 1; // 1 to 7680
        const h = Math.floor(prng() * 4320) + 1; // 1 to 4320
        testPairs.push([w, h]);
      }

      assert.equal(testPairs.length, 1000, 'Test matrix must contain exactly 1000 dimensions');

      let verifiedCount = 0;
      for (const [w, h] of testPairs) {
        const stereo = computeScissorStereo(w, h, 0.064);

        const leftScissor = stereo.leftEye.scissor;
        const rightScissor = stereo.rightEye.scissor;
        const leftViewport = stereo.leftEye.viewport;
        const rightViewport = stereo.rightEye.viewport;

        const [xL, yL, wL, hL] = leftScissor;
        const [xR, yR, wR, hR] = rightScissor;

        // 1. Integer coordinates invariant
        assert.ok(Number.isInteger(xL) && Number.isInteger(yL) && Number.isInteger(wL) && Number.isInteger(hL),
          `Left scissor must have integer coordinates at ${w}x${h}`);
        assert.ok(Number.isInteger(xR) && Number.isInteger(yR) && Number.isInteger(wR) && Number.isInteger(hR),
          `Right scissor must have integer coordinates at ${w}x${h}`);

        // 2. Exact width conservation: W_left + W_right === W
        assert.equal(wL + wR, w,
          `Width conservation failed at ${w}x${h}: ${wL} + ${wR} !== ${w}`);

        // 3. Zero gap and zero overlap: X_right === W_left
        assert.equal(xL, 0, `Left eye X must start at 0 (got ${xL})`);
        assert.equal(xR, wL,
          `Right eye X must start at W_left with zero gap/overlap at ${w}x${h}: ${xR} !== ${wL}`);

        // 4. Full vertical coverage: Y === 0, H_eye === H
        assert.equal(yL, 0, `Left eye Y must be 0 (got ${yL})`);
        assert.equal(yR, 0, `Right eye Y must be 0 (got ${yR})`);
        assert.equal(hL, h, `Left eye H must match canvas H at ${w}x${h}`);
        assert.equal(hR, h, `Right eye H must match canvas H at ${w}x${h}`);

        // 5. Viewport and Scissor rectangles match exactly
        assert.deepEqual(leftViewport, leftScissor,
          `Left eye viewport and scissor must match identically at ${w}x${h}`);
        assert.deepEqual(rightViewport, rightScissor,
          `Right eye viewport and scissor must match identically at ${w}x${h}`);

        verifiedCount++;
      }

      assert.equal(verifiedCount, 1000, 'All 1000 dimensions must pass all 5 invariants');
    });

    it('SCENARIO-1.2: Boundary Fallbacks for Non-Numeric / Negative Dimensions', () => {
      // Missing / NaN / Negative dimension tests
      // Note: 0 is falsy, so it cleanly falls back to default 1920x1080 (standard for 0-dimension unattached canvases)
      const fallbackCases = [
        [0, 0, 1920, 1080],
        [-100, -200, 1, 1],
        [null, null, 1920, 1080],
        [undefined, undefined, 1920, 1080],
        ['bad', 'input', 1920, 1080],
        ['2560', '1440', 2560, 1440]
      ];

      for (const [inW, inH, expectedW, expectedH] of fallbackCases) {
        const s = computeScissorStereo(inW, inH);
        assert.equal(s.leftEye.scissor[2] + s.rightEye.scissor[2], expectedW);
        assert.equal(s.leftEye.scissor[3], expectedH);
        assert.equal(s.rightEye.scissor[3], expectedH);
      }
    });
  });

  // =========================================================================
  // SUITE 2: Non-Standard Aspect Ratios & Singularities
  // =========================================================================
  describe('Suite 2: Non-Standard Aspect Ratios and Singularities', () => {

    it('SCENARIO-2.1: Ultrawide 32:9 Aspect Ratio (5120x1440)', () => {
      const w = 5120;
      const h = 1440;
      const s = computeScissorStereo(w, h, DEFAULT_EYE_SEP);

      // Left Eye: 2560x1440 (16:9)
      assert.deepEqual(s.leftEye.scissor, [0, 0, 2560, 1440]);
      assert.deepEqual(s.leftEye.viewport, [0, 0, 2560, 1440]);

      // Right Eye: 2560x1440 (16:9)
      assert.deepEqual(s.rightEye.scissor, [2560, 0, 2560, 1440]);
      assert.deepEqual(s.rightEye.viewport, [2560, 0, 2560, 1440]);

      // Per-eye aspect ratio is precisely 16:9 (1.7777777777777777)
      const leftAspect = s.leftEye.viewport[2] / s.leftEye.viewport[3];
      const rightAspect = s.rightEye.viewport[2] / s.rightEye.viewport[3];
      assert.ok(Math.abs(leftAspect - (16 / 9)) < 1e-6);
      assert.ok(Math.abs(rightAspect - (16 / 9)) < 1e-6);

      // Verify VRRenderer camera aspect configuration
      const vrRenderer = new VRRenderer();
      const mockRenderer = createInstrumentedRenderer(w, h);
      const scene = new THREE.Scene();
      const rig = new THREE.Group();
      const cam = new THREE.PerspectiveCamera(75, w / h, 0.05, 250);
      vrRenderer.init(scene, rig, cam, mockRenderer);
      vrRenderer.handleResize();

      assert.ok(Math.abs(vrRenderer.cameraLeft.aspect - (16 / 9)) < 1e-6);
      assert.ok(Math.abs(vrRenderer.cameraRight.aspect - (16 / 9)) < 1e-6);
      assert.ok(Math.abs(cam.aspect - (32 / 9)) < 1e-6);
    });

    it('SCENARIO-2.2: Vertical Mobile 9:16 Aspect Ratio (1080x1920)', () => {
      const w = 1080;
      const h = 1920;
      const s = computeScissorStereo(w, h, DEFAULT_EYE_SEP);

      // Left: 540x1920 (9:32)
      assert.deepEqual(s.leftEye.scissor, [0, 0, 540, 1920]);
      // Right: 540x1920 (9:32)
      assert.deepEqual(s.rightEye.scissor, [540, 0, 540, 1920]);

      const eyeAspect = 540 / 1920; // 0.28125
      assert.equal(eyeAspect, 0.28125);

      const vrRenderer = new VRRenderer();
      const mockRenderer = createInstrumentedRenderer(w, h);
      const scene = new THREE.Scene();
      const rig = new THREE.Group();
      const cam = new THREE.PerspectiveCamera(75, w / h, 0.05, 250);
      vrRenderer.init(scene, rig, cam, mockRenderer);
      vrRenderer.handleResize();

      assert.equal(vrRenderer.cameraLeft.aspect, 0.28125);
      assert.equal(vrRenderer.cameraRight.aspect, 0.28125);
      assert.ok(Number.isFinite(vrRenderer.cameraLeft.projectionMatrix.elements[0]));
    });

    it('SCENARIO-2.3: Square 1:1 Aspect Ratio (1024x1024)', () => {
      const w = 1024;
      const h = 1024;
      const s = computeScissorStereo(w, h, DEFAULT_EYE_SEP);

      assert.deepEqual(s.leftEye.scissor, [0, 0, 512, 1024]);
      assert.deepEqual(s.rightEye.scissor, [512, 0, 512, 1024]);

      const eyeAspect = 512 / 1024; // 0.5 (1:2 aspect for half eye)
      assert.equal(eyeAspect, 0.5);

      const vrRenderer = new VRRenderer();
      const mockRenderer = createInstrumentedRenderer(w, h);
      const scene = new THREE.Scene();
      const rig = new THREE.Group();
      const cam = new THREE.PerspectiveCamera(75, 1.0, 0.05, 250);
      vrRenderer.init(scene, rig, cam, mockRenderer);
      vrRenderer.handleResize();

      assert.equal(vrRenderer.cameraLeft.aspect, 0.5);
      assert.equal(vrRenderer.cameraRight.aspect, 0.5);
    });

    it('SCENARIO-2.4: Single-Pixel Canvas Singularity (1x1)', () => {
      const w = 1;
      const h = 1;
      const s = computeScissorStereo(w, h, DEFAULT_EYE_SEP);

      // halfW = Math.floor(1/2) = 0, remW = 1 - 0 = 1
      assert.deepEqual(s.leftEye.scissor, [0, 0, 0, 1]);
      assert.deepEqual(s.rightEye.scissor, [0, 0, 1, 1]);
      assert.equal(s.leftEye.scissor[2] + s.rightEye.scissor[2], 1);
      assert.equal(s.rightEye.scissor[0], 0);

      // Ensure renderStereoPass handles 1x1 without throwing or crashing
      const vrRenderer = new VRRenderer();
      const mockRenderer = createInstrumentedRenderer(1, 1);
      const scene = new THREE.Scene();
      const rig = new THREE.Group();
      const cam = new THREE.PerspectiveCamera(75, 1.0, 0.05, 250);
      vrRenderer.init(scene, rig, cam, mockRenderer);

      assert.doesNotThrow(() => {
        vrRenderer.renderStereoPass();
      }, '1x1 single pixel canvas must render safely');
    });

    it('SCENARIO-2.5: Extreme Ribbon (7680x1) and Extreme Column (1x4320)', () => {
      const sRibbon = computeScissorStereo(7680, 1);
      assert.equal(sRibbon.leftEye.scissor[2], 3840);
      assert.equal(sRibbon.rightEye.scissor[2], 3840);
      assert.equal(sRibbon.leftEye.scissor[3], 1);

      const sColumn = computeScissorStereo(1, 4320);
      assert.equal(sColumn.leftEye.scissor[2], 0);
      assert.equal(sColumn.rightEye.scissor[2], 1);
      assert.equal(sColumn.leftEye.scissor[3], 4320);
    });
  });

  // =========================================================================
  // SUITE 3: Eye Separation Boundary Conditions & Zero-Roll Invariant
  // =========================================================================
  describe('Suite 3: Eye Separation Boundary Conditions and Zero-Roll Invariant', () => {

    it('SCENARIO-3.1: Parametric IPD Range (Negative, Zero, Child, Adult, Giant, Colossal)', () => {
      const ipdCases = [
        { label: 'Negative IPD (-0.064)', ipd: -0.064, leftOffset: 0.032, rightOffset: -0.032 },
        { label: 'Negative Child IPD (-0.045)', ipd: -0.045, leftOffset: 0.0225, rightOffset: -0.0225 },
        { label: 'Zero IPD (0.0)', ipd: 0.0, leftOffset: 0.0, rightOffset: 0.0 },
        { label: 'Extreme Child IPD (0.045)', ipd: 0.045, leftOffset: -0.0225, rightOffset: 0.0225 },
        { label: 'Standard Adult IPD (0.064)', ipd: 0.064, leftOffset: -0.032, rightOffset: 0.032 },
        { label: 'Giant IPD (0.120)', ipd: 0.120, leftOffset: -0.060, rightOffset: 0.060 },
        { label: 'Macro Colossal IPD (1.0)', ipd: 1.0, leftOffset: -0.500, rightOffset: 0.500 },
        { label: 'Microscopic IPD (1e-6)', ipd: 1e-6, leftOffset: -5e-7, rightOffset: 5e-7 }
      ];

      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      for (const { label, ipd, leftOffset, rightOffset } of ipdCases) {
        // Pure function check
        const stereo = computeScissorStereo(1920, 1080, ipd);
        assert.ok(Math.abs(stereo.leftEye.camOffsetX - leftOffset) < 1e-9, `${label}: left offset mismatch`);
        assert.ok(Math.abs(stereo.rightEye.camOffsetX - rightOffset) < 1e-9, `${label}: right offset mismatch`);

        // Check that zero IPD does not introduce negative zero
        if (ipd === 0.0) {
          assert.equal(Object.is(stereo.leftEye.camOffsetX, -0), false, 'Zero IPD must not be -0 for left offset');
          assert.equal(Object.is(stereo.rightEye.camOffsetX, -0), false, 'Zero IPD must not be -0 for right offset');
        }

        // Live VRRenderer camera positions check
        vrRenderer.setEyeSeparation(ipd);
        assert.equal(vrRenderer.getEyeSeparation(), ipd);

        assert.ok(Math.abs(vrRenderer.cameraLeft.position.x - leftOffset) < 1e-9,
          `${label}: cameraLeft.position.x must match ${leftOffset}`);
        assert.ok(Math.abs(vrRenderer.cameraRight.position.x - rightOffset) < 1e-9,
          `${label}: cameraRight.position.x must match ${rightOffset}`);

        // Y and Z local positions must remain strictly 0.0
        assert.equal(vrRenderer.cameraLeft.position.y, 0.0);
        assert.equal(vrRenderer.cameraLeft.position.z, 0.0);
        assert.equal(vrRenderer.cameraRight.position.y, 0.0);
        assert.equal(vrRenderer.cameraRight.position.z, 0.0);

        // Inter-camera separation distance
        const measuredDistance = vrRenderer.cameraLeft.position.distanceTo(vrRenderer.cameraRight.position);
        assert.ok(Math.abs(measuredDistance - Math.abs(ipd)) < 1e-9,
          `${label}: measured distance between eye cameras must equal |ipd|`);
      }
    });

    it('SCENARIO-3.2: 100% Locked Horizon (Zero Roll/Bank) Invariant across Orbital Orientations', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      // Test multiple orbital yaw and pitch angles (Requirement R4: zero roll/bank at all times)
      const orientations = [
        { name: 'Identity (forward)', yaw: 0, pitch: 0 },
        { name: '45 deg yaw', yaw: Math.PI / 4, pitch: 0 },
        { name: '90 deg right yaw', yaw: Math.PI / 2, pitch: 0 },
        { name: '180 deg reverse yaw', yaw: Math.PI, pitch: 0 },
        { name: '-18 deg horizon gaze', yaw: 0.2, pitch: -18 * (Math.PI / 180) },
        { name: '+75 deg zenith gaze', yaw: 0.0, pitch: 75 * (Math.PI / 180) }
      ];

      for (const orient of orientations) {
        // Apply orientation to camera using Euler with zero roll (YXZ order: yaw then pitch, zero roll Z)
        camera.rotation.set(orient.pitch, orient.yaw, 0, 'YXZ');
        cameraRig.updateMatrixWorld(true);

        // 1. Local rotation roll invariant: rotation.z === 0
        assert.equal(vrRenderer.cameraLeft.rotation.z, 0.0,
          `${orient.name}: cameraLeft must have local roll === 0`);
        assert.equal(vrRenderer.cameraRight.rotation.z, 0.0,
          `${orient.name}: cameraRight must have local roll === 0`);

        // 2. World positions of eyes along camera local X vector
        const leftWorldPos = new THREE.Vector3();
        const rightWorldPos = new THREE.Vector3();
        const camWorldPos = new THREE.Vector3();
        vrRenderer.cameraLeft.getWorldPosition(leftWorldPos);
        vrRenderer.cameraRight.getWorldPosition(rightWorldPos);
        camera.getWorldPosition(camWorldPos);

        // Eye midpoint must equal primary camera position
        const eyeMidpoint = leftWorldPos.clone().add(rightWorldPos).multiplyScalar(0.5);
        assert.ok(eyeMidpoint.distanceTo(camWorldPos) < 1e-6,
          `${orient.name}: midpoint of eye positions must coincide with primary camera world position`);

        // World displacement vector (Right - Left)
        const eyeVector = rightWorldPos.clone().sub(leftWorldPos);
        assert.ok(Math.abs(eyeVector.length() - 0.064) < 1e-6,
          `${orient.name}: eye vector length must equal eye separation (0.064m)`);

        // Camera local X axis transformed to world
        const camRightWorld = new THREE.Vector3(1, 0, 0).transformDirection(camera.matrixWorld);
        const normalizedEyeVec = eyeVector.clone().normalize();
        assert.ok(Math.abs(normalizedEyeVec.dot(camRightWorld) - 1.0) < 1e-6,
          `${orient.name}: eye displacement must align strictly with camera local right axis in world space`);

        // World up vector of eye cameras must remain orthogonal to displacement
        const camUpWorld = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorld);
        assert.ok(Math.abs(camUpWorld.dot(camRightWorld)) < 1e-6,
          `${orient.name}: camera local up and right axes must remain strictly orthogonal (zero roll)`);
      }
    });
  });

  // =========================================================================
  // SUITE 4: Render Pass Call Sequence Verification with WebGL Mock
  // =========================================================================
  describe('Suite 4: Render Pass Call Sequence Verification with WebGL Mock', () => {

    it('SCENARIO-4.1: Exact Call Ordering, Viewport/Scissor Rectangles & Scissor Toggle', () => {
      const scene = new THREE.Scene();
      scene.name = 'TestScene';
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 1920 / 1080, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      mockRenderer._clearLog();
      vrRenderer.renderStereoPass();

      const log = mockRenderer._log;

      // Filter call sequence:
      // Expect:
      // 0: setScissorTest(true)
      // 1: setViewport(0, 0, 960, 1080)
      // 2: setScissor(0, 0, 960, 1080)
      // 3: render(scene, cameraLeft)
      // 4: setViewport(960, 0, 960, 1080)
      // 5: setScissor(960, 0, 960, 1080)
      // 6: render(scene, cameraRight)
      // 7: setScissorTest(false)
      // 8: setViewport(0, 0, 1920, 1080)
      // 9: setScissor(0, 0, 1920, 1080)

      assert.equal(log.length, 10, 'Single stereo render pass must execute exactly 10 WebGL operations');

      // 1. setScissorTest(true)
      assert.equal(log[0].method, 'setScissorTest');
      assert.deepEqual(log[0].args, [true], 'Step 1 must enable scissor test');

      // 2. Left eye viewport
      assert.equal(log[1].method, 'setViewport');
      assert.deepEqual(log[1].args, [0, 0, 960, 1080], 'Step 2 must set left viewport');

      // 3. Left eye scissor
      assert.equal(log[2].method, 'setScissor');
      assert.deepEqual(log[2].args, [0, 0, 960, 1080], 'Step 3 must set left scissor');

      // 4. Render left eye
      assert.equal(log[3].method, 'render');
      assert.equal(log[3].camera, vrRenderer.cameraLeft, 'Step 4 must render cameraLeft');

      // 5. Right eye viewport
      assert.equal(log[4].method, 'setViewport');
      assert.deepEqual(log[4].args, [960, 0, 960, 1080], 'Step 5 must set right viewport');

      // 6. Right eye scissor
      assert.equal(log[5].method, 'setScissor');
      assert.deepEqual(log[5].args, [960, 0, 960, 1080], 'Step 6 must set right scissor');

      // 7. Render right eye
      assert.equal(log[6].method, 'render');
      assert.equal(log[6].camera, vrRenderer.cameraRight, 'Step 7 must render cameraRight');

      // 8. setScissorTest(false)
      assert.equal(log[7].method, 'setScissorTest');
      assert.deepEqual(log[7].args, [false], 'Step 8 must disable scissor test after passes');

      // 9. Full viewport restoration
      assert.equal(log[8].method, 'setViewport');
      assert.deepEqual(log[8].args, [0, 0, 1920, 1080], 'Step 9 must restore full canvas viewport');

      // 10. Full scissor restoration
      assert.equal(log[9].method, 'setScissor');
      assert.deepEqual(log[9].args, [0, 0, 1920, 1080], 'Step 10 must restore full canvas scissor');
    });

    it('SCENARIO-4.2: Asymmetric Odd-Width Canvas Call Sequence (1921x1081)', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 1921 / 1081, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1921, 1081);
      const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      mockRenderer._clearLog();
      vrRenderer.renderStereoPass();

      const log = mockRenderer._log;
      assert.equal(log.length, 10);

      // Left Eye: [0, 0, 960, 1081]
      assert.deepEqual(log[1].args, [0, 0, 960, 1081]);
      assert.deepEqual(log[2].args, [0, 0, 960, 1081]);

      // Right Eye: [960, 0, 961, 1081]
      assert.deepEqual(log[4].args, [960, 0, 961, 1081]);
      assert.deepEqual(log[5].args, [960, 0, 961, 1081]);

      // Restored: [0, 0, 1921, 1081]
      assert.deepEqual(log[8].args, [0, 0, 1921, 1081]);
      assert.deepEqual(log[9].args, [0, 0, 1921, 1081]);
    });

    it('SCENARIO-4.3: Multi-Frame State Invariance & No Leakage Across Consecutive Frames', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 1920 / 1080, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      for (let frame = 0; frame < 10; frame++) {
        mockRenderer._clearLog();
        vrRenderer.renderStereoPass();
        const log = mockRenderer._log;

        assert.equal(log.length, 10);
        assert.equal(log[0].method, 'setScissorTest');
        assert.equal(log[0].args[0], true);
        assert.equal(log[7].method, 'setScissorTest');
        assert.equal(log[7].args[0], false);
        assert.deepEqual(log[8].args, [0, 0, 1920, 1080]);
        assert.deepEqual(log[9].args, [0, 0, 1920, 1080]);
      }
    });
  });

  // =========================================================================
  // SUITE 5: Rapid Start/Stop Cycling & Lifecycle Stability
  // =========================================================================
  describe('Suite 5: Rapid Start/Stop Cycling and Lifecycle Stability', () => {

    it('SCENARIO-5.1: 50 Consecutive start("stereo") / stop() Cycles Without Hangs or Leaks', async () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      const mockRenderer = createInstrumentedRenderer(1920, 1080);

      let startCount = 0;
      let stopCount = 0;

      const vrRenderer = new VRRenderer({
        eyeSep: 0.064,
        onStart: (mode) => {
          assert.equal(mode, 'stereo');
          startCount++;
        },
        onStop: () => {
          stopCount++;
        }
      });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      for (let cycle = 1; cycle <= 50; cycle++) {
        // Start stereo
        const mode = await vrRenderer.start('stereo');
        assert.equal(mode, 'stereo');
        assert.equal(vrRenderer.isStereoActive(), true, `Cycle ${cycle}: isStereoActive must be true after start`);
        assert.equal(vrRenderer.getMode(), 'stereo');

        // Execute one stereo frame pass during active state
        vrRenderer.renderStereoPass();

        // Stop stereo
        vrRenderer.stop();
        assert.equal(vrRenderer.isStereoActive(), false, `Cycle ${cycle}: isStereoActive must be false after stop`);
        assert.equal(vrRenderer.getMode(), 'inactive');
      }

      assert.equal(startCount, 50, 'onStart callback must be called exactly 50 times');
      assert.equal(stopCount, 50, 'onStop callback must be called exactly 50 times');

      // Verify that after 50 cycles:
      // Scissor test is off
      const lastScissorCall = mockRenderer._log.filter(c => c.method === 'setScissorTest').pop();
      assert.ok(lastScissorCall);
      assert.equal(lastScissorCall.args[0], false, 'Scissor test must be disabled after stop');

      // Full canvas viewport is restored
      const lastViewportCall = mockRenderer._log.filter(c => c.method === 'setViewport').pop();
      assert.ok(lastViewportCall);
      assert.deepEqual(lastViewportCall.args, [0, 0, 1920, 1080]);
    });

    it('SCENARIO-5.2: Idempotent Stop Calls and Graceful Disposal', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      // Multiple consecutive stop calls on inactive renderer
      assert.doesNotThrow(() => {
        vrRenderer.stop();
        vrRenderer.stop();
        vrRenderer.stop();
      }, 'Consecutive stop calls must be idempotent and non-throwing');

      // Dispose
      assert.ok(camera.children.includes(vrRenderer.cameraLeft));
      assert.ok(camera.children.includes(vrRenderer.cameraRight));

      vrRenderer.dispose();

      // Camera children must be cleanly removed from parent camera
      assert.equal(camera.children.includes(vrRenderer.cameraLeft), false);
      assert.equal(camera.children.includes(vrRenderer.cameraRight), false);
      assert.equal(vrRenderer.cameraLeft, null);
      assert.equal(vrRenderer.cameraRight, null);
      assert.equal(vrRenderer.scene, null);
      assert.equal(vrRenderer.renderer, null);

      // Further stop after disposal must not throw
      assert.doesNotThrow(() => {
        vrRenderer.stop();
        vrRenderer.dispose();
      });
    });
  });

  // =========================================================================
  // SUITE 6: Subsystem Lockstep Execution under Frame Delta Variations
  // =========================================================================
  describe('Suite 6: Subsystem Lockstep Coordination under Frame Delta Variations', () => {

    it('SCENARIO-6.1: Subsystem Lockstep Execution with Delta dt in [0.001, 1.0] across 1000 Ticks', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const executionTrace = [];

      const mockVrScene = {
        update: (dt) => executionTrace.push({ sys: 'vr_scene', dt })
      };
      const mockGlider = {
        update: (dt) => executionTrace.push({ sys: 'vr_glider', dt })
      };
      const mockGaze = {
        update: (cam, dt) => executionTrace.push({ sys: 'vr_gaze', cam, dt })
      };
      const mockAudio = {
        updatePositions: () => executionTrace.push({ sys: 'vr_audio' })
      };

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer({
        vrScene: mockVrScene,
        glider: mockGlider,
        gaze: mockGaze,
        audio: mockAudio
      });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      // Diverse frame deltas including 1000 FPS (1ms), 120 FPS, 90 FPS, 60 FPS, 30 FPS, hitches up to 1.0s
      const deltaSamples = [
        0.001,   // 1000 FPS extreme stress
        0.005,   // 200 FPS
        0.00833, // 120 FPS
        0.01111, // 90 FPS
        0.01389, // 72 FPS (Meta Quest native)
        0.01667, // 60 FPS standard
        0.03333, // 30 FPS half rate
        0.05000, // 20 FPS low rate
        0.10000, // 10 FPS severe hitch
        0.25000, // 250ms GC freeze
        0.50000, // 500ms stall
        1.00000  // 1000ms deep freeze
      ];

      const prng = createPRNG(0x11223344);
      const totalTicks = 1000;

      for (let i = 0; i < totalTicks; i++) {
        // Select delta from samples or random range [0.001, 1.0]
        const dt = i < deltaSamples.length
          ? deltaSamples[i]
          : 0.001 + prng() * (1.0 - 0.001);

        const traceStartIndex = executionTrace.length;
        vrRenderer._updateSubsystems(dt);

        // Verify that exactly 4 subsystem calls occurred in strict sequence
        assert.equal(executionTrace.length - traceStartIndex, 4,
          `Tick ${i}: exactly 4 subsystems must be executed per frame`);

        const [callScene, callGlider, callGaze, callAudio] = executionTrace.slice(traceStartIndex);

        // Check subsystem sequence
        assert.equal(callScene.sys, 'vr_scene');
        assert.equal(callGlider.sys, 'vr_glider');
        assert.equal(callGaze.sys, 'vr_gaze');
        assert.equal(callAudio.sys, 'vr_audio');

        // Check delta passed to physics/scene subsystems
        assert.equal(callScene.dt, dt);
        assert.equal(callGlider.dt, dt);
        assert.equal(callGaze.dt, dt);
        assert.equal(callGaze.cam, camera);
      }

      assert.equal(executionTrace.length, totalTicks * 4,
        'All 1000 ticks must preserve 100% lockstep coordination with zero dropped calls');
    });

    it('SCENARIO-6.2: Delta Clamping in Stereo Frame Loop to Prevent Physics Blowout', () => {
      // In _renderStereoFrame: const delta = Math.min(this.clock.getDelta(), 0.1);
      // Verify that delta clamp of 0.1s is enforced when mock clock returns large delta
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      let capturedDelta = null;
      const mockVrScene = {
        update: (dt) => { capturedDelta = dt; }
      };

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer({ vrScene: mockVrScene });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      // Force large delta on clock
      vrRenderer.clock.getDelta = () => 1.5; // 1.5s simulated stall
      vrRenderer._isStereoActive = true;
      vrRenderer._renderStereoFrame();

      assert.equal(capturedDelta, 0.1, 'Large deltas (> 0.1s) must be clamped to 0.1s to avoid physics instability');
      vrRenderer.stop();
    });
  });

  // =========================================================================
  // SUITE 7: Defensive Fallbacks & Malformed Parameter Robustness
  // =========================================================================
  describe('Suite 7: Defensive Fallbacks and Malformed Parameter Robustness', () => {

    it('SCENARIO-7.1: Headless / Missing getSize Fallback to domElement or Window', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);

      // Renderer without getSize, only domElement
      const bareRenderer = {
        domElement: { clientWidth: 1680, clientHeight: 1050 }
      };

      const vrRenderer = new VRRenderer();
      vrRenderer.init(scene, cameraRig, camera, bareRenderer);

      const size = vrRenderer._getCanvasSize();
      assert.equal(size.x, 1680);
      assert.equal(size.y, 1050);

      // Renderer without domElement either -> fallback to 1920x1080 default
      const emptyRenderer = {};
      const vrRenderer2 = new VRRenderer();
      vrRenderer2.init(scene, cameraRig, camera, emptyRenderer);
      const defaultSize = vrRenderer2._getCanvasSize();
      assert.equal(defaultSize.x, 1920);
      assert.equal(defaultSize.y, 1080);
    });

    it('SCENARIO-7.2: Alternate Subsystem Method Names (tick / update)', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);

      let tickCalled = false;
      let audioUpdateCalled = false;

      // Subsystem with tick instead of update, update(cam, glyphs) instead of updatePositions
      const mockVrScene = {
        tick: (dt) => { tickCalled = true; },
        dataGlyphs: [{ id: 'glyph1' }]
      };
      const mockAudio = {
        update: (cam, glyphs) => { audioUpdateCalled = true; }
      };

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer({
        vrScene: mockVrScene,
        audio: mockAudio
      });
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);

      vrRenderer._updateSubsystems(0.016);
      assert.equal(tickCalled, true, 'vrScene.tick must be called if update is not present');
      assert.equal(audioUpdateCalled, true, 'vrAudio.update must be called if updatePositions is not present');
    });

    it('SCENARIO-7.3: Clean Re-Initialization Lifecycle via Dispose and Re-Init', () => {
      const scene = new THREE.Scene();
      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 250);
      cameraRig.add(camera);
      scene.add(cameraRig);

      const mockRenderer = createInstrumentedRenderer(1920, 1080);
      const vrRenderer = new VRRenderer();

      // First initialization
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);
      assert.equal(camera.children.filter(c => c.name.startsWith('Stereo_Camera')).length, 2);

      // Dispose cleans up eye cameras from camera
      vrRenderer.dispose();
      assert.equal(camera.children.filter(c => c.name.startsWith('Stereo_Camera')).length, 0);

      // Re-initialize afresh
      vrRenderer.init(scene, cameraRig, camera, mockRenderer);
      const eyeChildren = camera.children.filter(c => c.name.startsWith('Stereo_Camera'));
      assert.equal(eyeChildren.length, 2, 'Re-initialization after dispose must cleanly attach exactly 2 eye cameras');
    });
  });
});
