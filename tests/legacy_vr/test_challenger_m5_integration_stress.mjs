/**
 * tests/test_challenger_m5_integration_stress.mjs
 * 
 * ============================================================================
 * EARTHSONIC "Terminator Skim" VR Mode & JPL Mission Console Aesthetic
 * TIER 5 SYSTEM INTEGRATION & ADVERSARIAL STRESS TEST SUITE
 * ============================================================================
 * 
 * Author: challenger_m5_2 (Teamwork Challenger / Critic & Specialist)
 * Scope: Cross-Subsystem Interactions, Fault Tolerance, Lifecycle Transitions,
 *        and Defensive Fallbacks.
 * 
 * Subsystem Domains Covered:
 *   1. Dual-mode renderer transitions (WebXR <-> Stereo fallback <-> 2D restore)
 *   2. Microsecond timeline synchronization and rapid boundary scrubs (Month 0 to Month 572)
 *   3. AudioContext state transitions (suspended, running, closed) and HRTF spatial acoustic stability
 *   4. Gyroscope yaw glider acceleration under high angular rates and zero-roll horizon invariants
 *   5. Gaze dwell concurrency across multiple holographic DataGlyphs and zenith exit aborts
 *   6. Integrated End-to-End stress workflow & SHA-256 forensic non-regression audit
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

import {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  CAMERA_NEAR,
  CAMERA_FAR,
  VROnboardingController,
  VRLoadingController
} from '../frontend/js/globe/vr/vr_scene.js';

import {
  VRRenderer,
  computeScissorStereo,
  DEFAULT_EYE_SEP,
  CAMERA_FOV
} from '../frontend/js/globe/vr/vr_renderer.js';

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
  EarthOrchestraMixer,
  calculateEffectiveGain
} from '../frontend/js/audio/mixer.js';

import { installEarthsonicVR } from '../frontend/js/globe/vr/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const globeJsPath = path.join(rootDir, 'frontend', 'js', 'globe', 'globe.js');
const EXPECTED_GLOBE_SHA256 = '63CB0A87AF839D60A7FFB7CF601D2D2C611AC75039250A8416D62445568C76F6';

// ============================================================================
// High-Fidelity Test Harness Mocks (DOM, WebGL, WebXR, Web Audio)
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
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
    this.style = {};
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.width = 1920;
    this.height = 1080;
    this.clientWidth = 1920;
    this.clientHeight = 1080;
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
  getContext() {
    return {
      fillStyle: '',
      fillRect() {},
      createLinearGradient() { return { addColorStop() {} }; },
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 128) * (h || 128) * 4) }),
      putImageData() {}
    };
  }
}

function createInstrumentedRenderer(width = 1920, height = 1080) {
  const log = [];
  const size = new THREE.Vector2(width, height);
  const domElement = new MockDOMElement('test-canvas', 'canvas');
  domElement.clientWidth = width;
  domElement.clientHeight = height;

  return {
    domElement,
    toneMapping: 0,
    toneMappingExposure: 1.0,
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
      log.push({ method: 'render', scene, camera, cameraName: camera?.name || 'camera' });
    },
    getSize: (target) => {
      target.copy(size);
      return target;
    },
    setSize: (w, h) => {
      size.set(w, h);
      domElement.clientWidth = w;
      domElement.clientHeight = h;
      log.push({ method: 'setSize', args: [w, h] });
    },
    _log: log,
    _clearLog: () => { log.length = 0; }
  };
}

class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
  }
  setValueAtTime(val) {
    this.value = val;
  }
}

class MockAudioListener {
  constructor() {
    this.positionX = new MockAudioParam(0);
    this.positionY = new MockAudioParam(0);
    this.positionZ = new MockAudioParam(0);
    this.forwardX = new MockAudioParam(0);
    this.forwardY = new MockAudioParam(0);
    this.forwardZ = new MockAudioParam(-1);
    this.upX = new MockAudioParam(0);
    this.upY = new MockAudioParam(1);
    this.upZ = new MockAudioParam(0);
  }
  setPosition(x, y, z) {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }
  setOrientation(fx, fy, fz, ux, uy, uz) {
    this.forwardX.value = fx;
    this.forwardY.value = fy;
    this.forwardZ.value = fz;
    this.upX.value = ux;
    this.upY.value = uy;
    this.upZ.value = uz;
  }
}

class MockPannerNode {
  constructor() {
    this.panningModel = 'HRTF';
    this.distanceModel = 'inverse';
    this.refDistance = 2.0;
    this.rolloffFactor = 1.2;
    this.maxDistance = 100.0;
    this.coneInnerAngle = 360;
    this.coneOuterAngle = 360;
    this.positionX = new MockAudioParam(0);
    this.positionY = new MockAudioParam(0);
    this.positionZ = new MockAudioParam(0);
    this.connectedTo = null;
  }
  setPosition(x, y, z) {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }
  connect(dest) {
    this.connectedTo = dest;
  }
  disconnect() {
    this.connectedTo = null;
  }
}

class MockAudioContext {
  constructor(state = 'running') {
    this.state = state;
    this.currentTime = 0.0;
    this.sampleRate = 44100;
    this.listener = new MockAudioListener();
    this.destination = {};
  }
  createPanner() {
    return new MockPannerNode();
  }
  createGain() {
    return {
      gain: new MockAudioParam(1.0),
      connect() {},
      disconnect() {}
    };
  }
  createAnalyser() {
    return {
      fftSize: 256,
      frequencyBinCount: 128,
      smoothingTimeConstant: 0.8,
      getByteFrequencyData() {},
      getByteTimeDomainData() {},
      connect() {},
      disconnect() {}
    };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// Global DOM Mock Environment Setup
let originalDocument = globalThis.document;
let originalWindow = globalThis.window;
let originalXr = globalThis.navigator ? globalThis.navigator.xr : undefined;

function setupMockEnvironment() {
  const elements = new Map();
  const body = new MockDOMElement('body', 'body');
  const onboarding = new MockDOMElement('vr-onboarding-prompt', 'div');
  const loading = new MockDOMElement('vr-loading-overlay', 'div');
  elements.set('body', body);
  elements.set('vr-onboarding-prompt', onboarding);
  elements.set('vr-loading-overlay', loading);

  globalThis.document = {
    body,
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => new MockDOMElement('', tag),
    createElementNS: (ns, tag) => new MockDOMElement('', tag)
  };

  const listeners = new Map();
  globalThis.window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      if (!listeners.has(type)) return;
      const arr = listeners.get(type);
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    },
    dispatchEvent: (event) => {
      const arr = listeners.get(event.type) || [];
      for (const fn of arr) fn(event);
    },
    screen: { orientation: { angle: 90 } },
    earthsonicVR: null
  };

  const mockXr = {
    isSessionSupported: async (mode) => mode === 'immersive-vr',
    requestSession: async (mode) => {
      const sessionListeners = new Map();
      return {
        addEventListener: (type, fn) => {
          if (!sessionListeners.has(type)) sessionListeners.set(type, []);
          sessionListeners.get(type).push(fn);
        },
        removeEventListener: (type, fn) => {
          if (!sessionListeners.has(type)) return;
          const arr = sessionListeners.get(type);
          const idx = arr.indexOf(fn);
          if (idx !== -1) arr.splice(idx, 1);
        },
        dispatchEvent: (event) => {
          const arr = sessionListeners.get(event.type) || [];
          for (const fn of arr) fn(event);
        },
        end: async function() {
          this.dispatchEvent({ type: 'end' });
        }
      };
    }
  };

  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: mockXr,
      writable: true,
      configurable: true
    });
  }
}

function teardownMockEnvironment() {
  globalThis.document = originalDocument;
  globalThis.window = originalWindow;
  if (globalThis.navigator) {
    if (originalXr !== undefined) {
      Object.defineProperty(globalThis.navigator, 'xr', {
        value: originalXr,
        writable: true,
        configurable: true
      });
    } else {
      delete globalThis.navigator.xr;
    }
  }
}

// ============================================================================
// SUITE 1: Dual-Mode Renderer Transitions & Lifecycle Robustness
// ============================================================================

describe('Tier 5 Integration Stress: Dual-Mode VR Renderer Transitions & Lifecycle Robustness', () => {
  beforeEach(() => {
    setupMockEnvironment();
  });
  afterEach(() => {
    teardownMockEnvironment();
  });

  it('STRESS-1.1: 50-Cycle Rapid Transition Storm: WebXR <-> Stereo <-> 2D Restore', async () => {
    const renderer = createInstrumentedRenderer(1920, 1080);
    const mockApp = {
      globe: { start() {}, stop() {} },
      mixer: {
        audioCtx: new MockAudioContext(),
        getAllTracks: () => [
          { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
          { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
          { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
          { isSoloed: false, isMuted: false, connect() {}, disconnect() {} }
        ],
        getTrack: () => ({ isSoloed: false, isMuted: false }),
        busInputNode: {}
      }
    };

    const vrScene = new TerminatorSkimVRScene(mockApp);
    await vrScene.init(renderer);

    // 50 rapid alternating cycles across WebXR, Stereo, and 2D Console
    for (let cycle = 0; cycle < 50; cycle++) {
      const isWebXRCycle = (cycle % 2 === 0);
      const targetMode = isWebXRCycle ? 'webxr' : 'stereo';

      // 1. Enter VR
      await vrScene.enterVR({ mode: targetMode });
      assert.equal(vrScene.isVRActive, true, `Cycle ${cycle}: VR must be active`);
      assert.equal(document.body.classList.contains('vr-mode-active'), true, `Cycle ${cycle}: body must have .vr-mode-active`);
      assert.equal(vrScene.glider.isEnabled, true, `Cycle ${cycle}: Glider must be enabled in VR`);
      assert.equal(vrScene.spatialAudio.isAttached, true, `Cycle ${cycle}: Spatial audio must be attached in VR`);

      if (isWebXRCycle) {
        assert.equal(vrScene.vrRenderer.isWebXRActive(), true, `Cycle ${cycle}: WebXR must be active`);
      } else {
        assert.equal(vrScene.vrRenderer.isStereoActive(), true, `Cycle ${cycle}: Stereo scissor must be active`);
      }

      // Simulate a render tick in VR
      vrScene.tick(0.016);

      // 2. Exit VR back to 2D
      vrScene.exitVR();
      assert.equal(vrScene.isVRActive, false, `Cycle ${cycle}: VR must be inactive after exit`);
      assert.equal(document.body.classList.contains('vr-mode-active'), false, `Cycle ${cycle}: body must restore 2D (no .vr-mode-active)`);
      assert.equal(vrScene.glider.isEnabled, false, `Cycle ${cycle}: Glider must be disabled in 2D`);
      assert.equal(vrScene.spatialAudio.isAttached, false, `Cycle ${cycle}: Spatial audio must be detached in 2D`);
      assert.equal(vrScene.vrRenderer.getMode(), 'inactive', `Cycle ${cycle}: Renderer mode must be inactive`);

      // Verify WebGL renderer state cleanup
      if (isWebXRCycle) {
        assert.equal(renderer.xr.enabled, false, `Cycle ${cycle}: renderer.xr.enabled must be disabled on WebXR 2D restore`);
      } else {
        const lastScissorTest = renderer._log.filter(l => l.method === 'setScissorTest').pop();
        assert.equal(lastScissorTest?.args[0], false, `Cycle ${cycle}: setScissorTest must be disabled on Stereo 2D restore`);

        const lastViewport = renderer._log.filter(l => l.method === 'setViewport').pop();
        assert.deepEqual(lastViewport?.args, [0, 0, 1920, 1080], `Cycle ${cycle}: Viewport must restore to full canvas [0, 0, 1920, 1080]`);
      }
    }
  });

  it('STRESS-1.2: WebXR Session Rejection & Automatic Graceful Fallback to Stereo Scissor', async () => {
    // Override navigator.xr to simulate rejection (e.g. SecurityError, NotSupportedError)
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: {
        isSessionSupported: async () => false,
        requestSession: async () => {
          throw new Error('NotSupportedError: Headset display unavailable');
        }
      },
      writable: true,
      configurable: true
    });

    const renderer = createInstrumentedRenderer(1920, 1080);
    const vrScene = new TerminatorSkimVRScene();
    await vrScene.init(renderer);

    // Call enterVR with WebXR requested when WebXR hardware fails
    await vrScene.enterVR({ mode: 'webxr' });

    // Invariant: Must catch rejection and gracefully fall back to 'stereo' scissor without unhandled error
    assert.equal(vrScene.vrRenderer.getMode(), 'stereo', 'Failed WebXR session must automatically fall back to stereo mode');
    assert.equal(vrScene.vrRenderer.isStereoActive(), true, 'Stereo scissor must be active');
    assert.equal(vrScene.vrRenderer.isWebXRActive(), false, 'WebXR must not be active');

    // Perform one stereo render pass
    renderer._clearLog();
    vrScene.vrRenderer.renderStereoPass();

    // Verify left and right eye scissor passes were dispatched
    const scissorCalls = renderer._log.filter(l => l.method === 'setScissor');
    assert.equal(scissorCalls.length, 3, 'Must call setScissor for Left Eye, Right Eye, and full canvas restore');
    assert.deepEqual(scissorCalls[0].args, [0, 0, 960, 1080], 'Left eye scissor rect');
    assert.deepEqual(scissorCalls[1].args, [960, 0, 960, 1080], 'Right eye scissor rect');
    assert.deepEqual(scissorCalls[2].args, [0, 0, 1920, 1080], 'Restore scissor rect');

    vrScene.vrRenderer.stop();
  });

  it('STRESS-1.3: Abrupt WebXR Headset Removal / Session Kill Clean Teardown', async () => {
    let mockSessionHandle = null;
    Object.defineProperty(globalThis.navigator, 'xr', {
      value: {
        isSessionSupported: async () => true,
        requestSession: async () => {
          const sessionListeners = new Map();
          mockSessionHandle = {
            addEventListener: (type, fn) => {
              if (!sessionListeners.has(type)) sessionListeners.set(type, []);
              sessionListeners.get(type).push(fn);
            },
            removeEventListener: (type, fn) => {
              if (!sessionListeners.has(type)) return;
              const arr = sessionListeners.get(type);
              const idx = arr.indexOf(fn);
              if (idx !== -1) arr.splice(idx, 1);
            },
            dispatchEvent: (event) => {
              const arr = sessionListeners.get(event.type) || [];
              for (const fn of arr) fn(event);
            },
            end: async function() {
              this.dispatchEvent({ type: 'end' });
            }
          };
          return mockSessionHandle;
        }
      },
      writable: true,
      configurable: true
    });

    const renderer = createInstrumentedRenderer(1920, 1080);
    const vrScene = new TerminatorSkimVRScene();
    await vrScene.init(renderer);

    await vrScene.enterVR({ mode: 'webxr' });
    assert.equal(vrScene.vrRenderer.isWebXRActive(), true, 'WebXR session active');
    assert.equal(document.body.classList.contains('vr-mode-active'), true);

    // Abrupt hardware event: headset removed / session aborted by browser OS
    assert.ok(mockSessionHandle, 'Mock WebXR session handle exists');
    mockSessionHandle.dispatchEvent({ type: 'end' });

    // Invariant: _handleSessionEnd must stop renderer and trigger exitVR()
    assert.equal(vrScene.vrRenderer.getMode(), 'inactive', 'Renderer mode must be inactive');
    assert.equal(vrScene.vrRenderer.isWebXRActive(), false, 'WebXR flag cleared');
    assert.equal(vrScene.isVRActive, false, 'VR scene isVRActive must be reset to false');
    assert.equal(document.body.classList.contains('vr-mode-active'), false, 'Body class must be cleared');
  });

  it('STRESS-1.4: Odd-Pixel & Extreme Aspect Ratio Scissor Parity Across 500 Dimensions', () => {
    let seed = 42;
    function randRange(min, max) {
      seed = (seed * 9301 + 49297) % 233280;
      return Math.floor(min + (seed / 233280) * (max - min));
    }

    const testCases = [
      [1, 1],
      [1, 2],
      [2, 1],
      [3, 3],
      [7, 13],
      [1921, 1081],     // Odd HD
      [3843, 2161],     // Odd 4K
      [5120, 1440],     // 32:9 Super Ultrawide
      [1080, 2400],     // 9:20 Mobile Portrait
      [7680, 4320]      // 8K UHD
    ];

    for (let i = 0; i < 490; i++) {
      testCases.push([randRange(1, 4096), randRange(1, 4096)]);
    }

    for (const [w, h] of testCases) {
      const stereo = computeScissorStereo(w, h, DEFAULT_EYE_SEP);
      const left = stereo.leftEye;
      const right = stereo.rightEye;

      // Invariant 1: Seamless split without gaps or overlaps
      const totalWidth = left.scissor[2] + right.scissor[2];
      assert.equal(totalWidth, w, `Width sum mismatch for ${w}x${h}: ${totalWidth} !== ${w}`);

      // Invariant 2: Left eye starts at x=0, right eye starts immediately after left eye
      assert.equal(left.scissor[0], 0, `Left eye X origin must be 0 for ${w}x${h}`);
      assert.equal(right.scissor[0], left.scissor[2], `Right eye X origin must match left width for ${w}x${h}`);

      // Invariant 3: Both eyes fill full canvas height
      assert.equal(left.scissor[3], h, `Left eye height mismatch for ${w}x${h}`);
      assert.equal(right.scissor[3], h, `Right eye height mismatch for ${w}x${h}`);

      // Invariant 4: Symmetrical camera offset parity
      assert.ok(Math.abs(left.camOffsetX - (-DEFAULT_EYE_SEP / 2.0)) < 1e-9);
      assert.ok(Math.abs(right.camOffsetX - (DEFAULT_EYE_SEP / 2.0)) < 1e-9);
    }
  });

  it('STRESS-1.5: Re-entrant enterVR, exitVR, and stop() Idempotence Under Concurrency', async () => {
    const renderer = createInstrumentedRenderer(1920, 1080);
    const vrScene = new TerminatorSkimVRScene();
    await vrScene.init(renderer);

    // Call exitVR() 10 times consecutively while already in 2D
    for (let i = 0; i < 10; i++) {
      assert.doesNotThrow(() => vrScene.exitVR(), 'exitVR in 2D must never throw');
      assert.equal(vrScene.isVRActive, false);
      assert.equal(document.body.classList.contains('vr-mode-active'), false);
    }

    // Rapid enter/exit cycles
    for (let i = 0; i < 5; i++) {
      await vrScene.enterVR({ mode: 'stereo' });
      assert.equal(vrScene.isVRActive, true);
      assert.equal(vrScene.vrRenderer.isStereoActive(), true);
      vrScene.exitVR();
      assert.equal(vrScene.isVRActive, false);
      assert.equal(vrScene.vrRenderer.isStereoActive(), false);
    }

    // Stop and re-stop renderer 10 times
    for (let i = 0; i < 10; i++) {
      assert.doesNotThrow(() => vrScene.vrRenderer.stop(), 'vrRenderer.stop() must be idempotent');
      assert.equal(vrScene.vrRenderer.getMode(), 'inactive');
    }

    vrScene.exitVR();
  });
});

// ============================================================================
// SUITE 2: Microsecond Timeline Synchronization & Boundary Scrubs
// ============================================================================

describe('Tier 5 Integration Stress: Microsecond Timeline Synchronization & Boundary Scrubs', () => {
  const records = [];
  for (let k = 0; k < TOTAL_MONTHS; k++) {
    const u = k / (TOTAL_MONTHS - 1);
    records.push({
      date: `Month-${k}`,
      temperature_anomaly: -0.08 + u * 1.08,
      co2_ppm: 336.14 + u * (426.50 - 336.14),
      ocean_temp_anomaly: 0.25 + u * 0.75,
      sea_ice_extent: 15.41 - u * 5.0,
      normalized_temperature: u,
      normalized_co2: u,
      normalized_ocean_temp: u,
      normalized_sea_ice_extent: 1.0 - u
    });
  }

  it('STRESS-2.1: Extreme Boundary Clamping (Month 0 / Jan 1979 to Month 572 / Sep 2026)', () => {
    // 1. Boundary Month 0: t = 0.0
    const recStart = interpolateHarmonizedRecord(records, 0.0);
    assert.equal(recStart.date, 'Month-0');
    assert.ok(Math.abs(recStart.temperature_anomaly - (-0.08)) < 1e-5);
    assert.ok(Math.abs(recStart.co2_ppm - 336.14) < 1e-4);

    // 2. Boundary Month 572: t = 1.0
    const recEnd = interpolateHarmonizedRecord(records, 1.0);
    assert.equal(recEnd.date, 'Month-572');
    assert.ok(Math.abs(recEnd.temperature_anomaly - 1.00) < 1e-5);
    assert.ok(Math.abs(recEnd.co2_ppm - 426.50) < 1e-4);

    // 3. Hostile / Malformed inputs: negative, overflow, NaN, Inf, null
    const hostileInputs = [-1000.0, -0.0001, 1.0001, 999.0, NaN, Infinity, -Infinity, null, undefined, 'bad_input'];
    for (const hostile of hostileInputs) {
      const safe = interpolateHarmonizedRecord(records, hostile);
      assert.ok(safe, `Must return valid record for ${hostile}`);
      assert.ok(!isNaN(safe.temperature_anomaly), `temperature_anomaly must not be NaN for ${hostile}`);
      assert.ok(!isNaN(safe.co2_ppm), `co2_ppm must not be NaN for ${hostile}`);
      assert.ok(safe.co2_ppm >= 336.0 && safe.co2_ppm <= 427.0, `co2_ppm clamped within valid range for ${hostile}`);
    }
  });

  it('STRESS-2.2: Microsecond Scrub Perturbations (dt = ±1e-6) & Gradient Continuity', () => {
    for (let i = 0; i < 500; i++) {
      const baseT = Math.random();
      const dtMicro = 1e-6;
      const t1 = Math.max(0.0, baseT - dtMicro);
      const t2 = Math.min(1.0, baseT + dtMicro);

      const r1 = interpolateHarmonizedRecord(records, t1);
      const r2 = interpolateHarmonizedRecord(records, t2);

      const dTemp = Math.abs(r2.temperature_anomaly - r1.temperature_anomaly);
      const dCO2 = Math.abs(r2.co2_ppm - r1.co2_ppm);

      assert.ok(dTemp < 1e-4, `Discontinuous temperature jump: ${dTemp} at t=${baseT}`);
      assert.ok(dCO2 < 1e-3, `Discontinuous CO2 jump: ${dCO2} at t=${baseT}`);
    }
  });

  it('STRESS-2.3: Rapid Boundary Scrub Bouncing (t = 0.0 <-> 1.0 at 1000 Hz) & Orthonormal Invariant', () => {
    const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);

    for (let step = 0; step < 500; step++) {
      const targetT = (step % 2 === 0) ? 0.0 : 1.0;
      const frame = getSplineFrame(spline, targetT, SKIM_ALTITUDE);

      // 1. Orbital altitude invariant: distance from planet origin = 10.22
      const altitude = frame.position.length();
      assert.ok(Math.abs(altitude - SKIM_ALTITUDE) < 1e-4, `Altitude mismatch: ${altitude} !== ${SKIM_ALTITUDE}`);

      // 2. Unit norm basis vectors
      assert.ok(Math.abs(frame.up.length() - 1.0) < 1e-5, 'Up vector must be unit length');
      assert.ok(Math.abs(frame.forward.length() - 1.0) < 1e-5, 'Forward vector must be unit length');
      assert.ok(Math.abs(frame.right.length() - 1.0) < 1e-5, 'Right vector must be unit length');

      // 3. Mutual orthogonality
      assert.ok(Math.abs(frame.up.dot(frame.forward)) < 1e-5, 'Up and forward must be orthogonal');
      assert.ok(Math.abs(frame.up.dot(frame.right)) < 1e-5, 'Up and right must be orthogonal');
      assert.ok(Math.abs(frame.forward.dot(frame.right)) < 1e-5, 'Forward and right must be orthogonal');

      // 4. Zero roll invariant
      assert.ok(Math.abs(frame.right.dot(frame.up)) < 1e-5, 'Right vector must have zero projection on Up vector (zero roll)');
    }
  });

  it('STRESS-2.4: Audio Playhead 40ms Seek Throttling vs Strict Boundary Exemption', () => {
    const seekLog = [];
    const mockMixer = {
      duration: 20.0,
      seekProgress: (t) => seekLog.push({ type: 'progress', t, sec: t * 20.0 }),
      seek: (s) => seekLog.push({ type: 'seconds', sec: s })
    };

    const spatialAudio = new VRSpatialAudio({ mixer: mockMixer });

    let mockTime = 1000.0;
    const originalPerf = globalThis.performance;
    globalThis.performance = { now: () => mockTime };

    try {
      // 1. Rapid continuous scrub within (0.0, 1.0) at 10ms intervals: must be throttled to >=40ms
      seekLog.length = 0;
      for (let i = 0; i < 10; i++) {
        mockTime += 10.0;
        spatialAudio.syncPlayhead(0.2 + i * 0.01);
      }
      assert.ok(seekLog.length >= 2 && seekLog.length <= 4, `Expected 2-4 throttled seeks, got ${seekLog.length}`);

      // 2. Strict Boundary Exemption: Seeks to t = 0.0 and t = 1.0 MUST dispatch immediately
      seekLog.length = 0;
      mockTime += 5.0; // only 5ms after last seek!
      spatialAudio.syncPlayhead(0.0);
      assert.equal(seekLog.length, 1, 'Boundary seek to t=0.0 must execute immediately (exempt from 40ms throttling)');
      assert.equal(seekLog[0].sec, 0.0);

      mockTime += 2.0; // only 2ms later!
      spatialAudio.syncPlayhead(1.0);
      assert.equal(seekLog.length, 2, 'Boundary seek to t=1.0 must execute immediately (exempt from 40ms throttling)');
      assert.equal(seekLog[1].sec, 20.0);

      // 3. Duplicate suppression: calling t=1.0 again with 0ms delta must be suppressed
      mockTime += 100.0;
      spatialAudio.syncPlayhead(1.0);
      assert.equal(seekLog.length, 2, 'Identical seek target must be suppressed');
    } finally {
      globalThis.performance = originalPerf;
    }
  });
});

// ============================================================================
// SUITE 3: AudioContext State Transitions & HRTF Spatial Acoustic Stability
// ============================================================================

describe('Tier 5 Integration Stress: AudioContext State Transitions & HRTF Spatial Acoustic Stability', () => {
  it('STRESS-3.1: AudioContext State Machine: Suspended -> Running -> Closed -> Re-Init', async () => {
    const mockCtx = new MockAudioContext('suspended');
    const mockMixer = {
      audioCtx: mockCtx,
      getAllTracks: () => [
        { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
        { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
        { isSoloed: false, isMuted: false, connect() {}, disconnect() {} },
        { isSoloed: false, isMuted: false, connect() {}, disconnect() {} }
      ],
      busInputNode: {}
    };

    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const glyphs = [new THREE.Group(), new THREE.Group(), new THREE.Group(), new THREE.Group()];

    const spatialAudio = new VRSpatialAudio({
      audioCtx: mockCtx,
      mixer: mockMixer,
      camera,
      dataGlyphs: glyphs
    });

    // 1. Suspended state
    assert.equal(mockCtx.state, 'suspended');
    assert.doesNotThrow(() => spatialAudio.update(camera, glyphs), 'Update in suspended state must not throw');
    assert.doesNotThrow(() => spatialAudio.attach(), 'Attach in suspended state must not throw');

    // 2. Unlock to running
    await mockCtx.resume();
    assert.equal(mockCtx.state, 'running');
    assert.doesNotThrow(() => spatialAudio.update(camera, glyphs), 'Update in running state must execute cleanly');

    // 3. Closed state
    await mockCtx.close();
    assert.equal(mockCtx.state, 'closed');
    assert.doesNotThrow(() => spatialAudio.update(camera, glyphs), 'Update in closed state must handle gracefully');
    assert.doesNotThrow(() => spatialAudio.detach(), 'Detach in closed state must execute cleanly');

    // 4. Re-init with new context
    const freshCtx = new MockAudioContext('running');
    spatialAudio.init(freshCtx, mockMixer, camera, glyphs);
    assert.equal(spatialAudio.audioCtx, freshCtx);
    assert.equal(spatialAudio.panners.length, 4);

    spatialAudio.dispose();
  });

  it('STRESS-3.2: 3D HRTF Inverse-Distance Attenuation & Extreme Singularity Clamping', () => {
    function calculateInverseGain(d, refDist = 2.0, rolloff = 1.2) {
      const safeD = Math.max(0.01, Number(d) || 0.0);
      if (safeD <= refDist) return 1.0;
      return refDist / (refDist + rolloff * (safeD - refDist));
    }

    // 1. Unity gain within refDistance (2.0m)
    assert.equal(calculateInverseGain(2.0), 1.0);
    assert.equal(calculateInverseGain(1.0), 1.0);
    assert.equal(calculateInverseGain(0.1), 1.0);

    // 2. Extreme Singularity Clamping
    assert.equal(calculateInverseGain(0.0), 1.0, 'Zero distance singularity must clamp to unity gain');
    assert.equal(calculateInverseGain(-5.0), 1.0, 'Negative distance must clamp safely to unity gain');
    assert.equal(calculateInverseGain(1e-12), 1.0, 'Sub-millimeter collision must clamp to unity gain');

    // 3. Expected attenuation points
    const gain4 = calculateInverseGain(4.0);
    assert.ok(Math.abs(gain4 - (2.0 / 4.4)) < 1e-5);

    const gain10 = calculateInverseGain(10.0);
    assert.ok(Math.abs(gain10 - (2.0 / 11.6)) < 1e-5);

    // 4. Extreme space distance: d = 1,000,000m
    const gainFar = calculateInverseGain(1e6);
    assert.ok(!isNaN(gainFar) && isFinite(gainFar));
    assert.ok(gainFar > 0.0 && gainFar < 1e-4, 'Gain at 1000km must be infinitesimal but strictly positive');
  });

  it('STRESS-3.3: 100-Cycle Reversible Bus Wiring (attach() <-> detach()) Integrity', () => {
    const tracks = [];
    for (let i = 0; i < 4; i++) {
      tracks.push({
        name: `Track_${i}`,
        spatialPannerNode: null,
        connectedTo: null,
        connect(node) { this.connectedTo = node; },
        disconnect() { this.connectedTo = null; }
      });
    }

    const mockCtx = new MockAudioContext();
    const mockMixer = {
      tracks,
      busInputNode: { name: 'MasterBusInput' },
      getAllTracks: () => tracks
    };

    const spatialAudio = new VRSpatialAudio({ audioCtx: mockCtx, mixer: mockMixer });

    // 100 consecutive reversible wiring cycles
    for (let cycle = 0; cycle < 100; cycle++) {
      // 1. Attach
      spatialAudio.attach();
      assert.equal(spatialAudio.isAttached, true, `Cycle ${cycle}: isAttached must be true`);
      for (let i = 0; i < 4; i++) {
        assert.equal(tracks[i].spatialPannerNode, spatialAudio.panners[i], `Cycle ${cycle}: track ${i} must hold spatialPannerNode`);
        assert.equal(tracks[i].connectedTo, spatialAudio.panners[i], `Cycle ${cycle}: track ${i} must connect to panner`);
        assert.equal(spatialAudio.panners[i].connectedTo, mockMixer.busInputNode, `Cycle ${cycle}: panner ${i} must connect to busInputNode`);
      }

      // 2. Detach
      spatialAudio.detach();
      assert.equal(spatialAudio.isAttached, false, `Cycle ${cycle}: isAttached must be false`);
      for (let i = 0; i < 4; i++) {
        assert.equal(tracks[i].spatialPannerNode, null, `Cycle ${cycle}: track ${i} spatialPannerNode must be null`);
        assert.equal(tracks[i].connectedTo, mockMixer.busInputNode, `Cycle ${cycle}: track ${i} must reconnect directly to busInputNode`);
        assert.equal(spatialAudio.panners[i].connectedTo, null, `Cycle ${cycle}: panner ${i} must be disconnected`);
      }
    }
  });

  it('STRESS-3.4: AudioParam Modern vs Legacy Web Audio Setter Coordinate Parity', () => {
    const modernListener = new MockAudioListener();
    const modernCtx = { currentTime: 0.5, listener: modernListener };

    const legacyCoords = { pos: [0, 0, 0], orient: [0, 0, -1, 0, 1, 0] };
    const legacyListener = {
      setPosition: (x, y, z) => { legacyCoords.pos = [x, y, z]; },
      setOrientation: (fx, fy, fz, ux, uy, uz) => { legacyCoords.orient = [fx, fy, fz, ux, uy, uz]; }
    };
    const legacyCtx = { currentTime: 0.5, listener: legacyListener };

    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    camera.position.set(10.22, 3.5, -4.8);
    camera.rotation.order = 'YXZ';
    camera.rotation.x = THREE.MathUtils.degToRad(-15.0);
    camera.rotation.y = THREE.MathUtils.degToRad(30.0);
    camera.rotation.z = 0.0;
    camera.updateMatrixWorld(true);

    const modernAudio = new VRSpatialAudio({ audioCtx: modernCtx, camera });
    modernAudio.update(camera, []);

    const legacyAudio = new VRSpatialAudio({ audioCtx: legacyCtx, camera });
    legacyAudio.update(camera, []);

    assert.ok(Math.abs(modernListener.positionX.value - legacyCoords.pos[0]) < 1e-4);
    assert.ok(Math.abs(modernListener.positionY.value - legacyCoords.pos[1]) < 1e-4);
    assert.ok(Math.abs(modernListener.positionZ.value - legacyCoords.pos[2]) < 1e-4);

    assert.ok(Math.abs(modernListener.forwardX.value - legacyCoords.orient[0]) < 1e-4);
    assert.ok(Math.abs(modernListener.forwardY.value - legacyCoords.orient[1]) < 1e-4);
    assert.ok(Math.abs(modernListener.forwardZ.value - legacyCoords.orient[2]) < 1e-4);
  });
});

// ============================================================================
// SUITE 4: Gyroscope Yaw Glider Acceleration & Zero-Roll Invariants
// ============================================================================

describe('Tier 5 Integration Stress: Gyroscope Yaw Glider Navigation & Zero-Roll Invariants', () => {
  it('STRESS-4.1: Yaw Deadzone Invariant Across ±15.0° Boundary Sweep (3600 Angles)', () => {
    for (let i = 0; i <= 3600; i++) {
      const yaw = -180.0 + i * 0.1;
      const res = computeGliderStep(yaw, 0.0, GLIDER_DEADZONE_DEG, GLIDER_ACCELERATION, GLIDER_DAMPING);

      if (Math.abs(yaw) <= 15.0) {
        assert.equal(res.excess, 0.0, `Excess must be 0.0 inside deadzone at yaw=${yaw.toFixed(2)}°`);
        assert.equal(res.newVelocity, 0.0, `New velocity must be 0.0 inside deadzone at yaw=${yaw.toFixed(2)}°`);
      } else if (yaw > 15.0) {
        assert.ok(res.excess > 0.0, `Excess must be positive for yaw=${yaw}°`);
        assert.ok(Math.abs(res.excess - (yaw - 15.0)) < 1e-9);
      } else {
        assert.ok(res.excess < 0.0, `Excess must be negative for yaw=${yaw}°`);
        assert.ok(Math.abs(res.excess - (yaw - (-15.0))) < 1e-9);
      }
    }
  });

  it('STRESS-4.2: Damped Acceleration Under High Angular Rates (±1000°/s) & Terminal Velocity', () => {
    // 1. Pure Recurrence Relation: sustained high yaw +90.0° (excess = +75.0°)
    // Theoretical steady-state terminal velocity:
    // v_term = (v_term + excess * 0.0004) * 0.92
    // v_term = (75.0 * 0.0004 * 0.92) / 0.08 = 0.345
    const expectedTerminalVelocity = (75.0 * 0.0004 * 0.92) / 0.08;

    let v = 0.0;
    for (let frame = 0; frame < 120; frame++) {
      const step = computeGliderStep(90.0, v, GLIDER_DEADZONE_DEG, GLIDER_ACCELERATION, GLIDER_DAMPING);
      v = step.newVelocity;
    }
    assert.ok(Math.abs(v - expectedTerminalVelocity) < 1e-4, `Terminal velocity should converge to ~0.345, got ${v}`);

    // 2. Return yaw into deadzone (0.0°): verify exponential geometric deceleration
    let prevV = v;
    for (let frame = 0; frame < 10; frame++) {
      const step = computeGliderStep(0.0, prevV, GLIDER_DEADZONE_DEG, GLIDER_ACCELERATION, GLIDER_DAMPING);
      const currentV = step.newVelocity;
      assert.ok(Math.abs(currentV - prevV * 0.92) < 1e-6, `Decay mismatch at frame ${frame}`);
      prevV = currentV;
    }

    // 3. Cutoff threshold: in VRGliderNavigation, verify velocity below 1e-7 snaps strictly to 0.0
    const glider = new VRGliderNavigation(null);
    glider.enable();
    glider.timelineVelocity = 5e-8; // below 1e-7 cutoff
    glider.stepPhysics(0.0);
    assert.equal(glider.getTimelineVelocity(), 0.0, 'Velocity must snap cleanly to 0.0 below 1e-7 threshold');
  });

  it('STRESS-4.3: Kinetic Wall Arrest at Timeline Limits (t = 0.0 and t = 1.0)', () => {
    const glider = new VRGliderNavigation(null);
    glider.enable();

    // 1. Backwards collision at t = 0.0
    glider.setTimelinePosition(0.02);
    glider.timelineVelocity = -0.05;
    glider.stepPhysics(0.0);

    assert.equal(glider.getTimelinePosition(), 0.0, 'Position must clamp to exactly 0.0');
    assert.equal(glider.getTimelineVelocity(), 0.0, 'Kinetic wall arrest must zero velocity on hitting t=0.0');

    // 2. Forward collision at t = 1.0
    glider.setTimelinePosition(0.98);
    glider.timelineVelocity = 0.05;
    glider.stepPhysics(0.0);

    assert.equal(glider.getTimelinePosition(), 1.0, 'Position must clamp to exactly 1.0');
    assert.equal(glider.getTimelineVelocity(), 0.0, 'Kinetic wall arrest must zero velocity on hitting t=1.0');
  });

  it('STRESS-4.4: 100% Locked Horizon Zero-Roll Invariant Under 1000 Adversarial 3D Orientations', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const mockVRScene = { camera };
    const glider = new VRGliderNavigation(mockVRScene);
    glider.enable();

    let seed = 12345;
    function randFloat(min, max) {
      seed = (seed * 9301 + 49297) % 233280;
      return min + (seed / 233280) * (max - min);
    }

    for (let i = 0; i < 1000; i++) {
      const pitch = randFloat(-90.0, 90.0);
      const yaw = randFloat(-10000.0, 10000.0);
      const hostileRoll = randFloat(-180.0, 180.0);

      // 1. Check enforceZeroRoll helper
      const safe = enforceZeroRoll(pitch, yaw, hostileRoll);
      assert.equal(safe.roll, 0.0, 'enforceZeroRoll must force roll to 0.0');
      assert.ok(safe.pitch >= -90.0 && safe.pitch <= 90.0, 'Pitch must be clamped to [-90, +90]');

      // 2. Check Glider camera rotation application
      glider.setLookAngles(yaw, pitch);
      assert.equal(glider.rollDeg, 0.0, 'glider.rollDeg must be 0.0');
      assert.equal(camera.rotation.order, 'YXZ', 'Euler order must be YXZ');
      assert.equal(camera.rotation.z, 0.0, 'Camera Z rotation must be strictly 0.0 at all times');

      // 3. Verify local right vector has zero vertical roll component
      const camQuat = new THREE.Quaternion().copy(camera.quaternion);
      const localRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
      assert.ok(Math.abs(localRight.y) < 1e-5, `Local right vector has vertical roll component: ${localRight.y}`);
    }
  });
});

// ============================================================================
// SUITE 5: Gaze Dwell Concurrency, Multi-Glyph Switching & Zenith Exit Aborts
// ============================================================================

describe('Tier 5 Integration Stress: Gaze Dwell Concurrency, Multi-Glyph Switching & Zenith Exit Aborts', () => {
  function createTestGlyphs() {
    const glyphs = [];
    const pitchRad = (-18.0 * Math.PI) / 180.0;
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
      glyphs.push(group);
    }
    return glyphs;
  }

  it('STRESS-5.1: Diegetic Horizon Arc Geometry & Hitbox Non-Interference (>0.50m Separation)', () => {
    const glyphs = createTestGlyphs();
    const positions = glyphs.map(g => g.position);

    let pairCount = 0;
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const dist = positions[i].distanceTo(positions[j]);
        assert.ok(dist > 0.50, `Pair (${i}, ${j}) separation must be > 0.50m, got ${dist.toFixed(4)}m`);
        pairCount++;
      }
    }
    assert.equal(pairCount, 6, 'Must verify all 6 unique glyph pairs');
  });

  it('STRESS-5.2: Concurrency & Rapid Gaze Switching Between Multiple DataGlyphs', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const cameraRig = new THREE.Group();
    cameraRig.add(camera);

    const glyphs = createTestGlyphs();
    glyphs.forEach(g => cameraRig.add(g));
    cameraRig.updateMatrixWorld(true);

    const triggeredStems = [];
    const mockMixer = {
      getTrack: () => ({ isSoloed: false, isMuted: false }),
      setTrackSolo: (id) => triggeredStems.push(id),
      getAllTracks: () => []
    };

    const gaze = new VRGazeController({ dataGlyphs: glyphs }, mockMixer);
    gaze.init();

    const pitchRad = (-18.0 * Math.PI) / 180.0;

    function aimAtGlyph(idx) {
      const yawDeg = -45.0 + (idx / 3.0) * 90.0;
      camera.rotation.order = 'YXZ';
      camera.rotation.x = pitchRad;
      camera.rotation.y = THREE.MathUtils.degToRad(-yawDeg);
      camera.rotation.z = 0.0;
      camera.updateMatrixWorld(true);
    }

    // 1. Dwell on Glyph 0 for 300ms (sub-threshold, progress = 0.5)
    aimAtGlyph(0);
    gaze.update(camera, 0.300);
    assert.equal(gaze.getActiveGlyph(), 0);
    assert.ok(Math.abs(gaze.getGlyphState(0).progress - 0.5) < 1e-4);

    // 2. Rapidly switch to Glyph 1 for 200ms
    aimAtGlyph(1);
    gaze.update(camera, 0.200);
    assert.equal(gaze.getActiveGlyph(), 1);
    assert.ok(Math.abs(gaze.getGlyphState(1).progress - (0.2 / 0.6)) < 1e-4);
    assert.equal(gaze.getGlyphState(0).progress, 0.0);

    // 3. Switch to Glyph 2 and sustain for full 600ms
    aimAtGlyph(2);
    gaze.update(camera, 0.600);
    assert.equal(gaze.getActiveGlyph(), 2);
    assert.equal(gaze.getGlyphState(2).hasTriggered, true);
    assert.equal(gaze.getGlyphState(2).progress, 1.0);
    assert.deepEqual(triggeredStems, ['ocean_temperature']);

    gaze.dispose();
  });

  it('STRESS-5.3: Sub-Threshold Dwell Decay & Anti-False-Latch Verification (599ms Dwell)', () => {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const glyphs = createTestGlyphs();
    const cameraRig = new THREE.Group();
    cameraRig.add(camera);
    glyphs.forEach(g => cameraRig.add(g));
    cameraRig.updateMatrixWorld(true);

    let toggleCalls = 0;
    const mockMixer = {
      getTrack: () => ({ isSoloed: false, isMuted: false }),
      setTrackSolo: () => { toggleCalls++; },
      getAllTracks: () => []
    };

    const gaze = new VRGazeController({ dataGlyphs: glyphs }, mockMixer);
    gaze.init();

    // Aim at Glyph 3 (sea_ice_extent: yaw = +45°)
    const pitchRad = (-18.0 * Math.PI) / 180.0;
    camera.rotation.order = 'YXZ';
    camera.rotation.x = pitchRad;
    camera.rotation.y = THREE.MathUtils.degToRad(-45.0);
    camera.rotation.z = 0.0;
    camera.updateMatrixWorld(true);

    // Dwell for exactly 0.599s (1ms under threshold)
    gaze.update(camera, 0.599);
    assert.equal(gaze.getGlyphState(3).hasTriggered, false, 'Must NOT trigger at 599ms');
    assert.equal(toggleCalls, 0);

    // Divert gaze into empty space
    camera.rotation.set(0, 0, 0);
    camera.updateMatrixWorld(true);

    // Over 250ms, progress must decay to zero without false triggering
    gaze.update(camera, 0.100);
    assert.equal(toggleCalls, 0);
    gaze.update(camera, 0.150);
    assert.equal(toggleCalls, 0);
    assert.equal(gaze.getGlyphState(3).dwellTimer, 0.0);
    assert.equal(gaze.getGlyphState(3).progress, 0.0);

    gaze.dispose();
  });

  it('STRESS-5.4: Zenith Gaze Exit Abort (1.4s) vs Sustained Trigger (1.5s) Hysteresis', () => {
    let exitTriggerCount = 0;
    const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
    const mockVRScene = {
      dataGlyphs: [],
      cameraRig: new THREE.Group(),
      zenithRing: { material: { uniforms: { uProgress: { value: 0.0 } } } },
      exitVR: () => { exitTriggerCount++; }
    };
    mockVRScene.cameraRig.add(camera);

    const gaze = new VRGazeController(mockVRScene, null, {
      onZenithExit: () => { exitTriggerCount++; }
    });

    // 1. Look up at zenith: pitch = +80.0°
    camera.rotation.order = 'YXZ';
    camera.rotation.x = THREE.MathUtils.degToRad(80.0);
    camera.rotation.y = 0.0;
    camera.rotation.z = 0.0;
    camera.updateMatrixWorld(true);

    // Dwell for 1.400s (sub-threshold: 1.4s < 1.5s)
    gaze.update(camera, 1.400);
    assert.equal(exitTriggerCount, 0, 'Exit must NOT trigger below 1.500s');
    assert.ok(Math.abs(gaze.zenithDwell - 1.400) < 1e-4);
    assert.ok(Math.abs(gaze.getZenithProgress() - (1.4 / 1.5)) < 1e-4);

    // 2. Look away down to horizon: pitch = +20.0°
    camera.rotation.x = THREE.MathUtils.degToRad(20.0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 0.050);

    assert.equal(gaze.zenithDwell, 0.0, 'Zenith dwell must reset to 0.0 on diversion');
    assert.equal(gaze.getZenithProgress(), 0.0, 'Zenith progress must reset to 0.0');
    assert.equal(exitTriggerCount, 0);

    // 3. Return to zenith (pitch = +85.0°) and sustain for full 1.500s
    camera.rotation.x = THREE.MathUtils.degToRad(85.0);
    camera.updateMatrixWorld(true);
    gaze.update(camera, 1.500);

    assert.equal(exitTriggerCount, 1, 'Exit must trigger once at 1.500s');
    assert.equal(gaze.zenithTriggered, true);

    // 4. Continued gaze at zenith must not multi-trigger
    gaze.update(camera, 1.000);
    assert.equal(exitTriggerCount, 1, 'Zenith exit must be latch-protected (single trigger)');

    gaze.dispose();
  });

  it('STRESS-5.5: Multi-Stem Solo Matrix Truth Table Under Gaze Interactions', () => {
    const tracks = [
      { id: 't0', isSoloed: false, isMuted: false, getLogGain: () => 0.8 },
      { id: 't1', isSoloed: false, isMuted: false, getLogGain: () => 0.8 },
      { id: 't2', isSoloed: false, isMuted: false, getLogGain: () => 0.8 },
      { id: 't3', isSoloed: false, isMuted: false, getLogGain: () => 0.8 }
    ];

    // State 1: Default mix -> all audible at 0.8
    for (const t of tracks) {
      assert.equal(calculateEffectiveGain(t, tracks), 0.8);
    }

    // State 2: Gaze solos Track 0
    tracks[0].isSoloed = true;
    assert.equal(calculateEffectiveGain(tracks[0], tracks), 0.8, 'Soloed track must remain audible');
    assert.equal(calculateEffectiveGain(tracks[1], tracks), 0.0, 'Non-soloed track 1 must be silenced');
    assert.equal(calculateEffectiveGain(tracks[2], tracks), 0.0, 'Non-soloed track 2 must be silenced');
    assert.equal(calculateEffectiveGain(tracks[3], tracks), 0.0, 'Non-soloed track 3 must be silenced');

    // State 3: Gaze also solos Track 2 (dual solo)
    tracks[2].isSoloed = true;
    assert.equal(calculateEffectiveGain(tracks[0], tracks), 0.8, 'Track 0 remains audible');
    assert.equal(calculateEffectiveGain(tracks[2], tracks), 0.8, 'Track 2 becomes audible');
    assert.equal(calculateEffectiveGain(tracks[1], tracks), 0.0, 'Track 1 remains silenced');
    assert.equal(calculateEffectiveGain(tracks[3], tracks), 0.0, 'Track 3 remains silenced');

    // State 4: Track 0 is muted while soloed -> mute overrides solo
    tracks[0].isMuted = true;
    assert.equal(calculateEffectiveGain(tracks[0], tracks), 0.0, 'Mute must silence track 0 even if soloed');
    assert.equal(calculateEffectiveGain(tracks[2], tracks), 0.8, 'Track 2 remains audible');

    // State 5: Clear all solos and mutes -> restore full audition
    tracks[0].isSoloed = false;
    tracks[2].isSoloed = false;
    tracks[0].isMuted = false;
    for (const t of tracks) {
      assert.equal(calculateEffectiveGain(t, tracks), 0.8);
    }
  });
});

// ============================================================================
// SUITE 6: Integrated Stress Scenario & Forensic Integrity Audit
// ============================================================================

describe('Tier 5 Integration Stress: Integrated End-to-End Stress Run & Forensic Integrity Audit', () => {
  beforeEach(() => {
    setupMockEnvironment();
  });
  afterEach(() => {
    teardownMockEnvironment();
  });

  it('STRESS-6.1: Full End-to-End Mission Scenario Under Stress', async () => {
    const renderer = createInstrumentedRenderer(1920, 1080);
    const mockAudioCtx = new MockAudioContext();
    const tracks = STEM_MAPPING.map(m => ({
      id: m.id,
      name: m.name,
      isSoloed: false,
      isMuted: false,
      volume: 0.85,
      getLogGain: () => 0.85,
      connect() {},
      disconnect() {}
    }));

    const mockApp = {
      globe: { start() {}, stop() {} },
      mixer: {
        audioCtx: mockAudioCtx,
        duration: 30.0,
        getAllTracks: () => tracks,
        getTrack: (id) => tracks.find(t => t.id === id),
        setTrackSolo: (id, solo) => {
          const t = tracks.find(trk => trk.id === id);
          if (t) t.isSoloed = Boolean(solo);
        },
        seekProgress() {},
        busInputNode: {}
      }
    };

    // 1. Install & bind global interface contract
    const earthsonicVR = installEarthsonicVR(mockApp);
    assert.ok(earthsonicVR, 'earthsonicVR contract installed');
    await earthsonicVR.init(renderer);

    // 2. Launch VR in Stereo mode
    await earthsonicVR.enterVR({ mode: 'stereo' });
    assert.equal(earthsonicVR.isVRActive, true);
    assert.equal(earthsonicVR.isStereoActive(), true);

    // 3. Glider navigation across 100 physics steps
    for (let step = 0; step < 100; step++) {
      earthsonicVR.setLookAngles(35.0, -18.0);
      earthsonicVR.tick(0.016);
    }
    assert.ok(earthsonicVR.timelinePosition > 0.0, 'Timeline must advance along TimeSpline');
    assert.ok(earthsonicVR.activeMonthRecord, 'Active monthly climate record populated');

    // 4. Gaze dwell on CO2 DataGlyph (index 1) for 600ms
    const yawCO2 = -45.0 + (1 / 3.0) * 90.0; // -15.0°
    earthsonicVR.setLookAngles(yawCO2, -18.0);
    earthsonicVR.tick(0.650);

    const co2Track = mockApp.mixer.getTrack('atmospheric_co2');
    assert.equal(co2Track.isSoloed, true, 'CO2 stem must be soloed via gaze dwell');

    // 5. Look straight up to Zenith for 1.5s to trigger exit
    earthsonicVR.setLookAngles(0.0, 85.0);
    earthsonicVR.tick(1.600);

    // Invariant: VR session cleanly tears down and returns to 2D console
    assert.equal(earthsonicVR.isVRActive, false, 'VR session must terminate on zenith gaze exit');
    assert.equal(document.body.classList.contains('vr-mode-active'), false, 'Body class must be cleared');
    assert.equal(earthsonicVR.isStereoActive(), false, 'Stereo scissor must be deactivated');
  });

  it('STRESS-6.2: Forensic Integrity Audit: globe.js SHA-256 Hash Unmodified', () => {
    assert.ok(fs.existsSync(globeJsPath), `globe.js must exist at ${globeJsPath}`);
    const content = fs.readFileSync(globeJsPath);
    const hash = crypto.createHash('sha256').update(content).digest('hex').toUpperCase();

    assert.equal(
      hash,
      EXPECTED_GLOBE_SHA256,
      `FATAL TAMPERING: globe.js SHA-256 hash mismatch!\nExpected: ${EXPECTED_GLOBE_SHA256}\nActual:   ${hash}`
    );
  });
});
