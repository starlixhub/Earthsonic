/**
 * tests/test_challenger_m4_lifecycle_stress.mjs
 * 
 * Empirical Stress Test Suite for EARTHSONIC Milestone M4:
 * Features 23, 24, 25, 26: Zenith Exit Gesture, Onboarding Prompt, Amber Loading Spinner,
 * and Full VR Entry/Exit Lifecycle State Machine.
 * 
 * Author: challenger_m4_2_r (Teamwork Challenger / Critic & Specialist)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING
} from '../frontend/js/globe/vr/vr_gaze.js';

import {
  TerminatorSkimVRScene,
  VROnboardingController,
  VRLoadingController
} from '../frontend/js/globe/vr/vr_scene.js';

import { installEarthsonicVR } from '../frontend/js/globe/vr/index.js';

// ============================================================================
// Deterministic Mock DOM & Virtual Timer Infrastructure
// ============================================================================

class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) {
    for (const name of names) {
      if (name) this._classes.add(name);
    }
  }
  remove(...names) {
    for (const name of names) {
      if (name) this._classes.delete(name);
    }
  }
  contains(name) {
    return this._classes.has(name);
  }
  toggle(name) {
    if (this._classes.has(name)) {
      this._classes.delete(name);
      return false;
    }
    this._classes.add(name);
    return true;
  }
  toString() {
    return Array.from(this._classes).join(' ');
  }
}

class MockDOMElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
    this.style = {};
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.width = 128;
    this.height = 128;
    this.src = '';
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners.has(type)) return;
    const arr = this.listeners.get(type);
    const idx = arr.indexOf(fn);
    if (idx !== -1) arr.splice(idx, 1);
  }
  dispatchEvent(event) {
    const arr = this.listeners.get(event.type) || [];
    for (const fn of arr) fn(event);
  }
  getContext(type) {
    const gradient = { addColorStop() {} };
    return {
      fillStyle: '',
      fillRect() {},
      createLinearGradient() { return gradient; },
      beginPath() {},
      arc() {},
      fill() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}
    };
  }
}

class VirtualTimerHarness {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
    this.originalSetTimeout = globalThis.setTimeout;
    this.originalClearTimeout = globalThis.clearTimeout;
  }

  install() {
    globalThis.setTimeout = (cb, ms) => {
      const id = this.nextId++;
      this.timers.set(id, {
        cb,
        triggerAt: this.now + Math.max(0, Number(ms) || 0)
      });
      return id;
    };
    globalThis.clearTimeout = (id) => {
      this.timers.delete(id);
    };
  }

  uninstall() {
    globalThis.setTimeout = this.originalSetTimeout;
    globalThis.clearTimeout = this.originalClearTimeout;
    this.timers.clear();
  }

  advance(ms) {
    const target = this.now + ms;
    while (this.timers.size > 0) {
      let nextTimer = null;
      let nextId = null;
      for (const [id, t] of this.timers.entries()) {
        if (!nextTimer || t.triggerAt < nextTimer.triggerAt) {
          nextTimer = t;
          nextId = id;
        }
      }
      if (!nextTimer || nextTimer.triggerAt > target) {
        break;
      }
      this.now = nextTimer.triggerAt;
      this.timers.delete(nextId);
      nextTimer.cb();
    }
    this.now = target;
  }
}

function setupMockDOMEnvironment() {
  const elements = new Map();

  const onboardingEl = new MockDOMElement('vr-onboarding-prompt');
  onboardingEl.classList.add('hidden');
  elements.set('vr-onboarding-prompt', onboardingEl);

  const loadingEl = new MockDOMElement('vr-loading-overlay');
  loadingEl.classList.add('hidden');
  elements.set('vr-loading-overlay', loadingEl);

  const bodyEl = new MockDOMElement('body', 'body');
  elements.set('body', bodyEl);

  const mockDoc = {
    body: bodyEl,
    getElementById(id) {
      if (elements.has(id)) return elements.get(id);
      const el = new MockDOMElement(id);
      elements.set(id, el);
      return el;
    },
    createElement(tag) {
      return new MockDOMElement('', tag);
    },
    createElementNS(ns, tag) {
      return new MockDOMElement('', tag);
    }
  };

  const mockWin = {
    document: mockDoc,
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout
  };

  globalThis.document = mockDoc;
  globalThis.window = mockWin;

  return { mockDoc, mockWin, onboardingEl, loadingEl, bodyEl };
}

// ============================================================================
// 2D Mock Globe Simulation Model
// ============================================================================

class Mock2DGlobe {
  constructor() {
    this.isRunning = true;
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000);
    this.camera.position.set(0, 0, 2.5);
    this.scene = new THREE.Scene();
    this.scene.name = '2D_Globe_Scene';

    // Populate scene with core planetary meshes
    this.earthMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 16));
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(1.02, 16, 16));
    this.scene.add(this.earthMesh);
    this.scene.add(this.cloudMesh);

    this.controls = {
      autoRotate: true,
      autoRotateSpeed: 0.8,
      dampingFactor: 0.05,
      target: new THREE.Vector3(0, 0, 0),
      update() {}
    };

    this.startCalls = 0;
    this.stopCalls = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startCalls++;
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.stopCalls++;
  }
}

// ============================================================================
// Test Suite 1: Zenith Exit Hysteresis, Dwell Timing & Rig Orientation Invariance
// ============================================================================

describe('Suite 1: Zenith Exit Threshold Hysteresis, Dwell Timing & 3D Spatial Invariance', () => {

  it('ZENITH-01: Sub-threshold gaze at pitch 74.9° resets dwell and never triggers exit', () => {
    let exitCalls = 0;
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    const zenithRing = {
      material: {
        uniforms: {
          uProgress: { value: 0.0 }
        }
      }
    };

    const mockScene = {
      cameraRig,
      zenithRing,
      dataGlyphs: [],
      exitVR: () => { exitCalls++; }
    };

    const gaze = new VRGazeController(mockScene, null, {
      onZenithExit: () => { exitCalls++; }
    });

    // Orient camera to pitch 74.9° (0.1° below the 75.0° threshold)
    camera.rotation.order = 'YXZ';
    camera.rotation.set(THREE.MathUtils.degToRad(74.9), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    // Simulate 100 frames at dt = 0.05s (5.0 seconds total dwell)
    for (let frame = 1; frame <= 100; frame++) {
      gaze.update(camera, 0.05);

      assert.equal(gaze.zenithDwell, 0.0,
        `Frame ${frame}: zenithDwell must remain exactly 0.0 at pitch 74.9°`);
      assert.equal(gaze.zenithTriggered, false,
        `Frame ${frame}: zenithTriggered must remain false at pitch 74.9°`);
      assert.equal(zenithRing.material.uniforms.uProgress.value, 0.0,
        `Frame ${frame}: uProgress must remain 0.0 at pitch 74.9°`);
      assert.equal(exitCalls, 0,
        `Frame ${frame}: exit callback must never be invoked at pitch 74.9°`);
    }

    gaze.dispose();
  });

  it('ZENITH-02: Exact threshold gaze at pitch 75.0° accumulates dwell and triggers exit at exactly 1.500s', () => {
    let exitCalls = 0;
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    const zenithRing = {
      material: {
        uniforms: {
          uProgress: { value: 0.0 }
        }
      }
    };

    const mockScene = {
      cameraRig,
      zenithRing,
      dataGlyphs: [],
      exitVR: () => { exitCalls++; }
    };

    const gaze = new VRGazeController(mockScene, null, {
      onZenithExit: () => { exitCalls++; }
    });

    // Pitch at exactly 75.0°
    camera.rotation.order = 'YXZ';
    camera.rotation.set(THREE.MathUtils.degToRad(75.0), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    const dt = 0.016; // ~60 FPS
    let totalTime = 0;

    // Dwell up to 1.488s (93 frames) -> Sub-threshold progress
    for (let i = 0; i < 93; i++) {
      gaze.update(camera, dt);
      totalTime += dt;
      const expectedProgress = totalTime / ZENITH_DWELL_THRESHOLD_SEC;

      assert.ok(Math.abs(gaze.zenithDwell - totalTime) < 1e-4,
        `Time ${totalTime.toFixed(3)}s: dwell timer must accumulate dt`);
      assert.ok(Math.abs(zenithRing.material.uniforms.uProgress.value - expectedProgress) < 1e-4,
        `Time ${totalTime.toFixed(3)}s: uProgress uniform must match linear progress`);
      assert.equal(exitCalls, 0, `Exit must not trigger before 1.500s threshold`);
      assert.equal(gaze.zenithTriggered, false);
    }

    // Step across the 1.500s threshold (1.488s + 0.016s = 1.504s >= 1.500s)
    gaze.update(camera, dt);
    totalTime += dt;

    assert.equal(exitCalls, 1, `Exit must trigger exactly once when dwell reaches 1.500s`);
    assert.equal(gaze.zenithTriggered, true);
    assert.equal(zenithRing.material.uniforms.uProgress.value, 1.0,
      `uProgress uniform must clamp to 1.0 at trigger`);

    // Gaze continues at 75.0° for an additional 100 frames (1.6s)
    for (let i = 0; i < 100; i++) {
      gaze.update(camera, dt);
      assert.equal(exitCalls, 1, `Exit must NOT fire multiple times during sustained gaze`);
      assert.equal(zenithRing.material.uniforms.uProgress.value, 1.0);
    }

    gaze.dispose();
  });

  it('ZENITH-03: Subthreshold look-away: accumulating 1.490s at 80° then 1 frame at 74.9° resets dwell and uProgress immediately', () => {
    let exitCalls = 0;
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    const zenithRing = {
      material: {
        uniforms: {
          uProgress: { value: 0.0 }
        }
      }
    };

    const mockScene = {
      cameraRig,
      zenithRing,
      dataGlyphs: [],
      exitVR: () => { exitCalls++; }
    };

    const gaze = new VRGazeController(mockScene, null, {
      onZenithExit: () => { exitCalls++; }
    });

    camera.rotation.order = 'YXZ';

    // 1. Gaze at 80° pitch for 1.490s (99.33% progress)
    camera.rotation.set(THREE.MathUtils.degToRad(80.0), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    gaze.update(camera, 1.490);

    assert.ok(Math.abs(gaze.zenithDwell - 1.490) < 1e-4);
    assert.ok(Math.abs(zenithRing.material.uniforms.uProgress.value - (1.490 / 1.500)) < 1e-4);
    assert.equal(gaze.zenithTriggered, false);
    assert.equal(exitCalls, 0);

    // 2. Single look-away frame: drop pitch to 74.9° for dt = 0.016s
    camera.rotation.set(THREE.MathUtils.degToRad(74.9), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    gaze.update(camera, 0.016);

    // Dwell and progress must be immediately reset to 0.0
    assert.equal(gaze.zenithDwell, 0.0,
      'zenithDwell must reset to 0.0 immediately upon dipping below 75.0°');
    assert.equal(gaze.zenithTriggered, false);
    assert.equal(zenithRing.material.uniforms.uProgress.value, 0.0,
      'uProgress uniform must reset to 0.0 immediately upon look-away');
    assert.equal(exitCalls, 0);

    // 3. Return to 80° pitch for 0.5s: progress must accumulate from 0.0, NOT from 1.490s
    camera.rotation.set(THREE.MathUtils.degToRad(80.0), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    gaze.update(camera, 0.500);

    assert.ok(Math.abs(gaze.zenithDwell - 0.500) < 1e-4,
      'Dwell must accumulate afresh from 0.0 after look-away reset');
    assert.ok(Math.abs(zenithRing.material.uniforms.uProgress.value - (0.500 / 1.500)) < 1e-4);
    assert.equal(exitCalls, 0);

    gaze.dispose();
  });

  it('ZENITH-04: Continuous 3D progress ring uniform tracking strictly matches min(1.0, dwell / 1.500)', () => {
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    const zenithRing = {
      material: {
        uniforms: {
          uProgress: { value: 0.0 }
        }
      }
    };

    const mockScene = { cameraRig, zenithRing, dataGlyphs: [] };
    const gaze = new VRGazeController(mockScene, null, { onZenithExit: () => {} });

    camera.rotation.order = 'YXZ';
    camera.rotation.set(THREE.MathUtils.degToRad(85.0), 0, 0);
    cameraRig.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    // Initial check at dwell = 0.0s
    assert.equal(zenithRing.material.uniforms.uProgress.value, 0.0);
    assert.equal(gaze.getZenithProgress(), 0.0);

    // Accumulate in 100 positive increments of 0.025s (0.025s to 2.500s)
    const dt = 0.025;
    let accumulated = 0.0;

    for (let step = 1; step <= 100; step++) {
      gaze.update(camera, dt);
      accumulated += dt;

      const expected = Math.min(1.0, accumulated / ZENITH_DWELL_THRESHOLD_SEC);
      const actualUniform = zenithRing.material.uniforms.uProgress.value;
      const actualGetter = gaze.getZenithProgress();

      assert.ok(Math.abs(actualUniform - expected) < 1e-4,
        `Step ${step} (${accumulated.toFixed(3)}s): uniform ${actualUniform} must equal expected ${expected}`);
      assert.ok(Math.abs(actualGetter - expected) < 1e-4,
        `Step ${step} (${accumulated.toFixed(3)}s): getter ${actualGetter} must equal expected ${expected}`);
    }

    gaze.dispose();
  });

  it('ZENITH-05: 3D Rig Orientation Invariance: pitch detection relative to local orbital Up under 50 randomized roll/pitch/yaw headings', () => {
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    let exitCount = 0;
    const mockScene = {
      cameraRig,
      zenithRing: { material: { uniforms: { uProgress: { value: 0.0 } } } },
      dataGlyphs: [],
      exitVR: () => { exitCount++; }
    };

    const gaze = new VRGazeController(mockScene, null, {
      onZenithExit: () => { exitCount++; }
    });

    // Test 50 distinct random 3D orbital orientations of the CameraRig
    for (let testIdx = 0; testIdx < 50; testIdx++) {
      gaze.reset();
      exitCount = 0;

      // Random 3D orientation for CameraRig: roll in [-180, 180], pitch in [-90, 90], yaw in [-180, 180]
      const rigRoll = (Math.random() - 0.5) * 2.0 * Math.PI;
      const rigPitch = (Math.random() - 0.5) * Math.PI;
      const rigYaw = (Math.random() - 0.5) * 2.0 * Math.PI;

      cameraRig.quaternion.setFromEuler(new THREE.Euler(rigPitch, rigYaw, rigRoll, 'YXZ'));
      cameraRig.updateMatrixWorld(true);

      // 1. Mathematical dot-product invariant: test pitch detection invariance against expected local pitch
      for (const localPitchDeg of [0.0, 30.0, 60.0, 74.8, 75.2, 85.0, 90.0]) {
        camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(localPitchDeg));
        camera.updateMatrixWorld(true);

        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const rigUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cameraRig.getWorldQuaternion(new THREE.Quaternion())).normalize();
        const sinPitch = dir.dot(rigUp);
        const computedPitchDeg = Math.asin(Math.max(-1.0, Math.min(1.0, sinPitch))) * (180.0 / Math.PI);

        assert.ok(Math.abs(computedPitchDeg - localPitchDeg) < 1e-4,
          `Test ${testIdx}: computed pitch (${computedPitchDeg.toFixed(4)}°) must equal local pitch (${localPitchDeg}°) under arbitrary rig rotation`);
      }

      // 2. Sub-threshold: Pitch camera by 74.8° relative to rig local space -> Dwell remains 0.0
      camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(74.8));
      camera.updateMatrixWorld(true);

      gaze.update(camera, 1.0);
      assert.equal(gaze.zenithDwell, 0.0,
        `Test ${testIdx}: Dwell must remain 0.0 at local pitch 74.8° regardless of rig orientation`);
      assert.equal(exitCount, 0);

      // 3. Supra-threshold: Pitch camera by 75.2° relative to rig local space -> Triggers exit
      camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(75.2));
      camera.updateMatrixWorld(true);

      gaze.update(camera, 1.501);
      assert.equal(exitCount, 1,
        `Test ${testIdx}: Exit must trigger at local pitch 75.2° regardless of rig orientation`);

      // 4. True Zenith: Pitch camera to 90.0° (along local rigUp vector)
      gaze.reset();
      exitCount = 0;

      camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(90.0));
      camera.updateMatrixWorld(true);

      gaze.update(camera, 1.501);
      assert.equal(exitCount, 1,
        `Test ${testIdx}: Exit must trigger at local zenith (90.0°) regardless of rig orientation`);
    }

    gaze.dispose();
  });
});

// ============================================================================
// Test Suite 2: Onboarding Prompt Single-Fire Lifecycle (Feature 25)
// ============================================================================

describe('Suite 2: Onboarding Prompt Single-Fire Lifecycle (Feature 25)', () => {
  let timerHarness;

  beforeEach(() => {
    setupMockDOMEnvironment();
  });

  it('ONBOARD-01: First VR entry displays prompt for 3.0s, fades over 800ms to hidden', () => {
    timerHarness = new VirtualTimerHarness();
    timerHarness.install();

    try {
      const controller = new VROnboardingController();
      const promptEl = document.getElementById('vr-onboarding-prompt');

      assert.equal(controller.hasShown, false);
      assert.ok(promptEl.classList.contains('hidden'));

      // 1. Initial VR entry
      controller.show();

      assert.equal(controller.hasShown, true, 'hasShown must be set to true on first show');
      assert.ok(promptEl.classList.contains('visible'), 'Prompt must have class "visible" on show');
      assert.ok(!promptEl.classList.contains('hidden'), 'Prompt must not have class "hidden"');
      assert.ok(!promptEl.classList.contains('faded'), 'Prompt must not have class "faded"');

      // 2. Advance timer by 2999ms (before 3.0s timeout)
      timerHarness.advance(2999);
      assert.ok(promptEl.classList.contains('visible'), 'Prompt must stay visible at 2.999s');
      assert.ok(!promptEl.classList.contains('faded'));

      // 3. Advance across 3000ms: prompt begins 800ms fade
      timerHarness.advance(1); // now at 3000ms
      assert.ok(!promptEl.classList.contains('visible'), 'Class "visible" removed at 3.0s');
      assert.ok(promptEl.classList.contains('faded'), 'Class "faded" added at 3.0s for 800ms transition');
      assert.ok(!promptEl.classList.contains('hidden'));

      // 4. Advance 799ms into fade (total 3799ms)
      timerHarness.advance(799);
      assert.ok(promptEl.classList.contains('faded'));
      assert.ok(!promptEl.classList.contains('hidden'));

      // 5. Advance final 1ms to complete 800ms fade (total 3800ms)
      timerHarness.advance(1);
      assert.ok(promptEl.classList.contains('hidden'), 'Class "hidden" added after 800ms fade completes');
    } finally {
      timerHarness.uninstall();
    }
  });

  it('ONBOARD-02: 20 rapid enterVR / exitVR cycles NEVER re-show the onboarding prompt', () => {
    timerHarness = new VirtualTimerHarness();
    timerHarness.install();

    try {
      const controller = new VROnboardingController();
      const promptEl = document.getElementById('vr-onboarding-prompt');

      // Cycle 1: First entry displays and fades
      controller.show();
      timerHarness.advance(3800); // Complete display + fade
      assert.equal(controller.hasShown, true);
      assert.ok(promptEl.classList.contains('hidden'));

      // Cycles 2 through 21: 20 subsequent rapid transitions
      for (let cycle = 2; cycle <= 21; cycle++) {
        // Mock enterVR: show prompt
        controller.show();

        // Must remain hidden, hasShown remains true, never visible
        assert.equal(controller.hasShown, true, `Cycle ${cycle}: hasShown must remain true`);
        assert.ok(!promptEl.classList.contains('visible'),
          `Cycle ${cycle}: prompt must NEVER gain "visible" class after first entry`);
        assert.ok(promptEl.classList.contains('hidden'),
          `Cycle ${cycle}: prompt must remain "hidden"`);

        // Advance random time intervals (100ms to 5000ms)
        timerHarness.advance(500);

        // Mock exitVR: reset prompt
        controller.reset();

        assert.equal(controller.hasShown, true, `Cycle ${cycle}: reset must NOT clear hasShown flag`);
        assert.ok(promptEl.classList.contains('hidden'),
          `Cycle ${cycle}: prompt must stay hidden after reset`);
        assert.ok(!promptEl.classList.contains('visible'));
      }
    } finally {
      timerHarness.uninstall();
    }
  });

  it('ONBOARD-03: Immediate exitVR during active 3.0s display aborts timers cleanly without orphan callbacks', () => {
    timerHarness = new VirtualTimerHarness();
    timerHarness.install();

    try {
      const controller = new VROnboardingController();
      const promptEl = document.getElementById('vr-onboarding-prompt');

      controller.show();
      assert.ok(promptEl.classList.contains('visible'));

      // Advance 1.5s into display
      timerHarness.advance(1500);
      assert.ok(promptEl.classList.contains('visible'));

      // User exits VR abruptly at 1.5s
      controller.reset();

      assert.ok(!promptEl.classList.contains('visible'), 'Reset must immediately remove "visible"');
      assert.ok(promptEl.classList.contains('hidden'), 'Reset must immediately add "hidden"');

      // Advance time by 10.0s: pending timers must have been cancelled
      timerHarness.advance(10000);
      assert.ok(promptEl.classList.contains('hidden'));
      assert.ok(!promptEl.classList.contains('visible'));
    } finally {
      timerHarness.uninstall();
    }
  });
});

// ============================================================================
// Test Suite 3: Amber Loading Spinner Lifecycle & Idempotence (Feature 26)
// ============================================================================

describe('Suite 3: Amber Loading Spinner Lifecycle & Idempotence (Feature 26)', () => {
  beforeEach(() => {
    setupMockDOMEnvironment();
  });

  it('LOADER-01: Spinner shown during preloading, hidden upon scene ready', () => {
    const loadingCtrl = new VRLoadingController();
    const overlayEl = document.getElementById('vr-loading-overlay');

    // Initial state: hidden
    assert.ok(overlayEl.classList.contains('hidden'));

    // VR start initiates preloading
    loadingCtrl.show();
    assert.ok(!overlayEl.classList.contains('hidden'), 'show() must remove "hidden" class');

    // Scene ready completes preloading
    loadingCtrl.hide();
    assert.ok(overlayEl.classList.contains('hidden'), 'hide() must add "hidden" class');
  });

  it('LOADER-02: 50 consecutive hide calls are completely idempotent without DOM corruption', () => {
    const loadingCtrl = new VRLoadingController();
    const overlayEl = document.getElementById('vr-loading-overlay');

    // Show once
    loadingCtrl.show();
    assert.ok(!overlayEl.classList.contains('hidden'));

    // Hide 50 consecutive times
    for (let i = 1; i <= 50; i++) {
      assert.doesNotThrow(() => {
        loadingCtrl.hide();
      }, `Hide call ${i} must not throw`);
      assert.ok(overlayEl.classList.contains('hidden'), `Overlay must be hidden after call ${i}`);
    }

    // Verify element state is clean and undisturbed
    assert.equal(overlayEl.classList.contains('hidden'), true);
  });

  it('LOADER-03: Rapid show / hide interleaved stress under asynchronous asset loading simulation', async () => {
    const loadingCtrl = new VRLoadingController();
    const overlayEl = document.getElementById('vr-loading-overlay');

    for (let cycle = 0; cycle < 20; cycle++) {
      loadingCtrl.show();
      assert.ok(!overlayEl.classList.contains('hidden'));

      // Simulate microtask async loading delay
      await Promise.resolve();

      loadingCtrl.hide();
      assert.ok(overlayEl.classList.contains('hidden'));

      // Redundant hide on exitVR
      loadingCtrl.hide();
      assert.ok(overlayEl.classList.contains('hidden'));
    }
  });
});

// ============================================================================
// Test Suite 4: 2D Globe State Preservation Across 20 Enter/Exit Transitions
// ============================================================================

describe('Suite 4: 2D Globe State Preservation Across 20 Enter/Exit Transitions', () => {
  beforeEach(() => {
    setupMockDOMEnvironment();
  });

  it('GLOBE-01: enterVR stops 2D globe loop, exitVR restarts 2D globe loop', async () => {
    const mockGlobe = new Mock2DGlobe();
    const mockApp = { globe: mockGlobe, mixer: null, harmonizedData: { records: [] } };

    const vrScene = new TerminatorSkimVRScene(mockApp);
    await vrScene.init();

    assert.equal(mockGlobe.isRunning, true, '2D Globe starts in running state');
    assert.equal(mockGlobe.stopCalls, 0);
    assert.equal(mockGlobe.startCalls, 0);

    // Enter VR
    await vrScene.enterVR({ mode: 'stereo' });
    assert.equal(vrScene.isVRActive, true);
    assert.equal(mockGlobe.isRunning, false, '2D globe must be stopped while in VR');
    assert.equal(mockGlobe.stopCalls, 1, 'globe.stop() called on enterVR');

    // Exit VR
    vrScene.exitVR();
    assert.equal(vrScene.isVRActive, false);
    assert.equal(mockGlobe.isRunning, true, '2D globe must be restarted when exiting VR');
    assert.equal(mockGlobe.startCalls, 1, 'globe.start() called on exitVR');
  });

  it('GLOBE-02: 20 rapid enterVR / exitVR transitions preserve 2D camera, scene and controls state with zero drift', async () => {
    const mockGlobe = new Mock2DGlobe();
    const mockApp = { globe: mockGlobe, mixer: null, harmonizedData: { records: [] } };

    const vrScene = new TerminatorSkimVRScene(mockApp);
    await vrScene.init();

    // Snapshot baseline 2D globe camera position and scene structure
    const initialCamPos = mockGlobe.camera.position.clone();
    const initialCamFov = mockGlobe.camera.fov;
    const initialCamNear = mockGlobe.camera.near;
    const initialCamFar = mockGlobe.camera.far;
    const initialSceneChildCount = mockGlobe.scene.children.length;
    const initialAutoRotate = mockGlobe.controls.autoRotate;
    const initialDamping = mockGlobe.controls.dampingFactor;

    // Execute 20 rapid enterVR / exitVR transitions
    for (let cycle = 1; cycle <= 20; cycle++) {
      await vrScene.enterVR({ mode: 'stereo' });
      assert.equal(vrScene.isVRActive, true);
      assert.equal(mockGlobe.isRunning, false);

      vrScene.exitVR();
      assert.equal(vrScene.isVRActive, false);
      assert.equal(mockGlobe.isRunning, true);
    }

    // Assert exact call pairings: 20 stops, 20 starts
    assert.equal(mockGlobe.stopCalls, 20, 'Exact 20 stop() calls expected');
    assert.equal(mockGlobe.startCalls, 20, 'Exact 20 start() calls expected');

    // Assert 2D globe camera state is completely intact
    assert.equal(mockGlobe.camera.position.x, initialCamPos.x);
    assert.equal(mockGlobe.camera.position.y, initialCamPos.y);
    assert.equal(mockGlobe.camera.position.z, initialCamPos.z);
    assert.equal(mockGlobe.camera.fov, initialCamFov);
    assert.equal(mockGlobe.camera.near, initialCamNear);
    assert.equal(mockGlobe.camera.far, initialCamFar);

    // Assert 2D globe scene graph integrity
    assert.equal(mockGlobe.scene.children.length, initialSceneChildCount);
    assert.equal(mockGlobe.scene.children[0], mockGlobe.earthMesh);
    assert.equal(mockGlobe.scene.children[1], mockGlobe.cloudMesh);

    // Assert 2D globe controls configuration
    assert.equal(mockGlobe.controls.autoRotate, initialAutoRotate);
    assert.equal(mockGlobe.controls.dampingFactor, initialDamping);
    assert.equal(mockGlobe.controls.target.x, 0);
    assert.equal(mockGlobe.controls.target.y, 0);
    assert.equal(mockGlobe.controls.target.z, 0);
  });
});

// ============================================================================
// Test Suite 5: Global Interface Contract & Subsystem Coordination
// ============================================================================

describe('Suite 5: Global Interface Contract & Subsystem Coordination', () => {
  beforeEach(() => {
    setupMockDOMEnvironment();
  });

  it('CONTRACT-01: window.earthsonicVR exposes all Milestone M4 controllers, rings and progress getters', async () => {
    const vrInterface = installEarthsonicVR();
    await vrInterface.init();

    // Milestone M4 interface contracts
    assert.ok(vrInterface.vrRenderer, 'vrRenderer property must be exposed');
    assert.ok(vrInterface.zenithRing, 'zenithRing mesh must be exposed');
    assert.ok(vrInterface.onboardingController, 'onboardingController must be exposed');
    assert.ok(vrInterface.loadingController, 'loadingController must be exposed');

    assert.equal(typeof vrInterface.zenithProgress, 'number');
    assert.equal(vrInterface.zenithProgress, 0.0);

    assert.equal(typeof vrInterface.isWebXRActive, 'function');
    assert.equal(typeof vrInterface.isStereoActive, 'function');
    assert.equal(vrInterface.isWebXRActive(), false);
    assert.equal(vrInterface.isStereoActive(), false);

    assert.equal(typeof vrInterface.enterVR, 'function');
    assert.equal(typeof vrInterface.exitVR, 'function');
  });

  it('CONTRACT-02: Diegetic 3D Zenith Progress Ring Geometry, Orientation & Uniforms', async () => {
    const vrScene = new TerminatorSkimVRScene();
    await vrScene.init();

    const ring = vrScene.zenithRing;
    assert.ok(ring, 'zenithRing must exist in vrScene');
    assert.equal(ring.name, 'ZenithProgressRing');

    // Positioned at (0, 2.0, 0) relative to CameraRig
    assert.equal(ring.position.x, 0);
    assert.equal(ring.position.y, 2.0);
    assert.equal(ring.position.z, 0);

    // Rotated 90° to face directly downward toward the observer
    assert.ok(Math.abs(ring.rotation.x - Math.PI / 2) < 1e-4);

    // Amber JPL accent color (#ff8a3d) and uniform uProgress
    assert.ok(ring.material.uniforms.uProgress, 'uProgress uniform must be wired');
    assert.equal(ring.material.uniforms.uProgress.value, 0.0);
    assert.ok(ring.material.uniforms.uColor, 'uColor uniform must be wired');
    assert.equal(ring.material.uniforms.uColor.value.getHexString(), 'ff8a3d');
  });

  it('CONTRACT-03: GazeController reset and dispose clean up uniforms and hitboxes idempotently', () => {
    const cameraRig = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    cameraRig.add(camera);

    const zenithRing = {
      material: {
        uniforms: {
          uProgress: { value: 0.85 }
        }
      }
    };

    const mockScene = {
      cameraRig,
      zenithRing,
      dataGlyphs: []
    };

    const gaze = new VRGazeController(mockScene);
    gaze.zenithDwell = 1.25;
    gaze.zenithTriggered = true;

    // Reset clears state immediately
    gaze.reset();
    assert.equal(gaze.zenithDwell, 0.0);
    assert.equal(gaze.zenithTriggered, false);
    assert.equal(zenithRing.material.uniforms.uProgress.value, 0.0);

    // Dispose executes cleanly
    assert.doesNotThrow(() => {
      gaze.dispose();
    });
    assert.equal(gaze.hitboxMeshes.length, 0);
  });
});
