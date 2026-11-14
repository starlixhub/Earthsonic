/**
 * tests/test_vr_split_screen_smoke.mjs
 *
 * Smoke test for the split-screen stereo ("ENTER SPLIT-SCREEN VR ON THIS PC")
 * path of Orbital Examine. It exists because that path shipped a blank canvas
 * with a clean console, and nothing in the suite noticed.
 *
 * The regressions pinned here, in the order they made the screen white:
 *
 *   SMOKE-SHADER-*  every fragment shader calls toneMapping()/linearToOutputTexel()
 *                   /sRGBTransferEOTF3(); the three ported Three.js chunks were
 *                   missing from BABYLON_VR_FRAGMENT_PRELUDE, so GLSL failed to
 *                   link, ShaderMaterial.isReady() stayed false, scene.isReady()
 *                   stayed false, and the render loop never drew a frame.
 *   SMOKE-COVER-*   skybox + panel labels were assigned to emissiveTexture with
 *                   disableLighting, a slot Babylon's standard shader never samples.
 *   SMOKE-EYE-*     eye cameras were aimed with a world-space target on a parented
 *                   TargetCamera, pointing both frusta ~90 degrees off the globe.
 *   SMOKE-STEREO-*  dual-viewport geometry: two cameras, viewports tiling 0..1,
 *                   eye separation, exit restoring the single-camera scene.
 *   SMOKE-PANEL-*   all eleven panel actions produce an observable state change.
 *   SMOKE-PICK-*    button picking must try BOTH eye cameras (a click that lands
 *                   in the other eye's half was silently swallowed after zooming).
 *   SMOKE-NAV-*     drag-rotate / wheel-zoom listeners exist on the stereo canvas,
 *                   because Babylon routes input to scene.activeCamera only and in
 *                   stereo that is the left eye, not the ArcRotateCamera.
 *
 * Runs on NullEngine (headless), same harness as test_babylon_engine_node.mjs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

import {
  BABYLON_VR_FRAGMENT_PRELUDE,
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader
} from '../frontend/js/globe/vr/vr_shaders.js';

import {
  OrbitalExamineScene,
  OrbitalControlPanel,
  ORBITAL_EYE_SEP,
  ORBITAL_MIN_RADIUS,
  ORBITAL_MAX_RADIUS,
  ORBITAL_ZOOM_STEP,
  ORBITAL_INITIAL_RADIUS,
  TOTAL_MONTHS
} from '../frontend/js/globe/vr/orbital_examine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SRC = fs.readFileSync(path.join(ROOT, 'frontend/js/globe/vr/orbital_examine.js'), 'utf8');
const STARFIELD_SRC = fs.readFileSync(path.join(ROOT, 'frontend/js/globe/vr/vr_starfield.js'), 'utf8');

const SHADERS = {
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader
};

// Same injection rule VRShaderMaterial applies (anchor right after `precision`).
function injectPrelude(source, prelude) {
  const anchor = 'precision highp float;';
  const at = source.indexOf(anchor);
  if (at === -1) return prelude + '\n' + source;
  return source.slice(0, at + anchor.length) + '\n' + prelude + source.slice(at + anchor.length);
}

const COLOR_HELPERS = ['sRGBTransferOETF', 'linearToOutputTexel', 'ACESFilmicToneMapping', 'toneMapping', 'sRGBTransferEOTF3'];

function makeScene() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  const inst = new OrbitalExamineScene(null);
  inst.engine = engine;
  inst.scene = scene;
  inst._initCamera();
  // A freshly constructed ArcRotateCamera still has position (0,0,0) until its
  // view matrix is computed; the real app has already rendered a frame by the
  // time the panel exists.
  inst.camera.getViewMatrix(true);
  inst.camera.computeWorldMatrix(true);
  return { engine, scene, inst };
}

function forwardOf(camera) {
  camera.computeWorldMatrix(true);
  return camera.getDirection(BABYLON.Axis.Z).normalize();
}

// Cameras have no getAbsolutePosition(); their world matrix carries the eye position.
function worldPositionOf(camera) {
  camera.computeWorldMatrix(true);
  return camera.getWorldMatrix().getTranslation();
}

function towardOrigin(camera) {
  return BABYLON.Vector3.Zero().subtract(worldPositionOf(camera)).normalize();
}

// ─── Shaders: the actual white-screen cause ─────────────────────────────────

describe('Split-screen smoke: shader prelude is complete', () => {
  it('SMOKE-SHADER-01: fragment prelude defines every ported Three.js helper', () => {
    for (const fn of COLOR_HELPERS) {
      assert.ok(
        new RegExp(`(vec3|vec4)\\s+${fn}\\s*\\(`).test(BABYLON_VR_FRAGMENT_PRELUDE),
        `fragment prelude must define ${fn}()`
      );
    }
  });

  it('SMOKE-SHADER-02: every shader resolves the color helpers it calls', () => {
    for (const [name, def] of Object.entries(SHADERS)) {
      const fragment = def.fragmentShader;
      assert.equal(typeof fragment, 'string', `${name} must ship a fragmentShader string`);

      const finalSource = injectPrelude(fragment, BABYLON_VR_FRAGMENT_PRELUDE);
      for (const fn of COLOR_HELPERS) {
        if (!new RegExp(`\\b${fn}\\s*\\(`).test(fragment)) continue;
        assert.ok(
          new RegExp(`(vec3|vec4)\\s+${fn}\\s*\\(`).test(finalSource),
          `${name} calls ${fn}() but the injected prelude never defines it — GLSL would fail to link and the canvas would stay blank`
        );
      }
    }
  });

  it('SMOKE-SHADER-03: every fragment shader carries the precision anchor', () => {
    // Without the anchor injectPrelude() prepends the prelude instead of splicing
    // it after the precision statement; keep the anchor so the contract holds.
    for (const [name, def] of Object.entries(SHADERS)) {
      assert.ok(def.fragmentShader.includes('precision highp float;'),
        `${name} fragment must declare precision highp float;`);
      assert.ok(def.vertexShader.includes('precision highp float;'),
        `${name} vertex must declare precision highp float;`);
    }
  });
});

// ─── Coverage: the two surfaces that render nothing when mis-slotted ────────

describe('Split-screen smoke: skybox and labels use a sampled slot', () => {
  it('SMOKE-COVER-01: starfield material samples the real catalog star texture', () => {
    assert.ok(STARFIELD_SRC.includes("setTexture('starTex', starTexture)"),
      'starfield shader must sample the catalog texture');
    assert.ok(!STARFIELD_SRC.includes('new BABYLON.StandardMaterial'),
      'a StandardMaterial rendered the skybox black');
  });

  it('SMOKE-COVER-01b: starfield material is a depth-write-free shader material', () => {
    assert.ok(STARFIELD_SRC.includes('new BABYLON.ShaderMaterial'),
      'starfield must use an explicit ShaderMaterial');
    assert.ok(STARFIELD_SRC.includes('disableDepthWrite = true'),
      'skybox must not write depth');
  });

  it('SMOKE-COVER-02: panel button + date surfaces sample a texture', () => {
    // Labels are baked into the button plate art now: one textured plane per
    // control, so the text can never float loose over the globe.
    assert.ok(SRC.includes('mat.diffuseTexture = artIdle'), 'button plates must sample the baked label texture');
    assert.ok(SRC.includes('dateMat.diffuseTexture = this._dateTex'), 'date readout must use diffuseTexture');
    assert.ok(SRC.includes('backing.isPickable  = false'), 'the backing plate must not swallow button clicks');
  });
});

// ─── Stereo geometry ────────────────────────────────────────────────────────

describe('Split-screen smoke: dual-viewport stereo activation', () => {
  it('SMOKE-STEREO-01: both eye cameras become active and tile the canvas', () => {
    const { inst, scene, engine } = makeScene();
    inst._activateStereo();

    assert.equal(scene.activeCameras.length, 2, 'exactly two eye cameras must be active');
    const [left, right] = scene.activeCameras;
    assert.equal(left.name, 'OrbitalLeft');
    assert.equal(right.name, 'OrbitalRight');

    const vp = (cam) => ({ x: cam.viewport.x, y: cam.viewport.y, w: cam.viewport.width, h: cam.viewport.height });
    assert.deepEqual(vp(left), { x: 0, y: 0, w: 0.5, h: 1 }, 'left eye must own the left half');
    assert.deepEqual(vp(right), { x: 0.5, y: 0, w: 0.5, h: 1 }, 'right eye must own the right half');
    assert.equal(vp(left).w + vp(right).w, 1, 'viewports must tile the full width with no gap or overlap');
    assert.equal(left.fov, inst.camera.fov, 'eyes must inherit the master FOV');
    assert.equal(right.fov, inst.camera.fov, 'eyes must inherit the master FOV');
    // Both eyes hang off the HEAD RIG (a rotation-only child of the master
    // camera) so a gyro quaternion can rotate the eyes without moving the seat.
    assert.ok(left.parent === inst._headNode && right.parent === inst._headNode, 'both eyes ride the head rig');
    assert.ok(inst._headNode.parent === inst.camera, 'head rig rides the master camera');

    engine.dispose();
  });

  it('SMOKE-STEREO-02: eyes are separated by ORBITAL_EYE_SEP and face the globe', () => {
    const { inst, engine } = makeScene();
    inst._activateStereo();
    const { _leftCam: left, _rightCam: right } = inst;

    const sep = BABYLON.Vector3.Distance(worldPositionOf(left), worldPositionOf(right));
    assert.ok(Math.abs(sep - ORBITAL_EYE_SEP) < 1e-4, `eye separation ${sep} must equal ${ORBITAL_EYE_SEP}`);

    // Regression: the parented setTarget() aimed both frusta ~90 degrees off, so
    // nothing was inside either frustum and the canvas stayed black.
    for (const [name, cam] of [['left', left], ['right', right]]) {
      const alignment = BABYLON.Vector3.Dot(forwardOf(cam), towardOrigin(cam));
      assert.ok(alignment > 0.999, `${name} eye forward must point at the globe centre (dot=${alignment.toFixed(4)})`);
    }

    engine.dispose();
  });

  it('SMOKE-STEREO-03: enterVR forces the stereo path and exitVR restores one camera', async () => {
    const { inst, scene, engine } = makeScene();

    await inst.enterVR({ forceStereo: true });
    assert.equal(inst.isVRActive, true, 'enterVR must mark VR active');
    assert.equal(inst._stereoActive, true, 'forceStereo must activate the dual-viewport path');
    assert.equal(scene.activeCameras.length, 2, 'both eyes must render');

    inst.exitVR();
    assert.equal(inst.isVRActive, false, 'exitVR must clear VR state');
    assert.equal(inst._stereoActive, false, 'exitVR must deactivate stereo');
    assert.equal(scene.activeCameras.length, 0, 'exitVR must drop the eye cameras');
    assert.ok(scene.activeCamera === inst.camera, 'exitVR must restore the master camera for the 2D dashboard');
    assert.equal(inst._leftCam, null);
    assert.equal(inst._rightCam, null);

    engine.dispose();
  });
});

// ─── Panel actions must respond ─────────────────────────────────────────────

describe('Split-screen smoke: panel actions change observable state', () => {
  it('SMOKE-PANEL-01: PLAY / PAUSE drive isPlaying', () => {
    const { inst, engine } = makeScene();
    assert.equal(inst.isPlaying, false);
    inst.actionPlay();
    assert.equal(inst.isPlaying, true, 'PLAY must start autoplay');
    inst.actionPause();
    assert.equal(inst.isPlaying, false, 'PAUSE must stop autoplay');
    engine.dispose();
  });

  it('SMOKE-PANEL-02: NEXT / PREV step exactly one year and clamp at the ends', () => {
    const { inst, engine } = makeScene();
    // Playback and the deck both step whole years now (12 monthly records).
    const year = 12.0 / (TOTAL_MONTHS - 1);

    inst.updateTimeline(0);
    inst.actionNext();
    assert.ok(Math.abs(inst.currentT - year) < 1e-9, `NEXT must step one year (got ${inst.currentT})`);

    inst.actionPrev();
    assert.ok(Math.abs(inst.currentT) < 1e-9, `PREV must step one year back (got ${inst.currentT})`);

    inst.updateTimeline(0);
    inst.actionPrev();
    assert.equal(inst.currentT, 0, 'PREV must clamp at the first year');

    inst.updateTimeline(1);
    inst.actionNext();
    assert.equal(inst.currentT, 1, 'NEXT must clamp at the last year');
    engine.dispose();
  });

  it('SMOKE-PANEL-03: ZOOM IN / ZOOM OUT step ORBITAL_ZOOM_STEP within limits', () => {
    const { inst, engine } = makeScene();
    assert.equal(inst.camera.radius, ORBITAL_INITIAL_RADIUS);

    inst.actionZoomIn();
    assert.equal(inst.camera.radius, ORBITAL_INITIAL_RADIUS - ORBITAL_ZOOM_STEP, 'ZOOM IN must pull the camera in');
    inst.actionZoomOut();
    assert.equal(inst.camera.radius, ORBITAL_INITIAL_RADIUS, 'ZOOM OUT must push the camera back out');

    inst.camera.radius = ORBITAL_MIN_RADIUS;
    inst.actionZoomIn();
    assert.equal(inst.camera.radius, ORBITAL_MIN_RADIUS, 'ZOOM IN must not clip inside the globe');

    inst.camera.radius = ORBITAL_MAX_RADIUS;
    inst.actionZoomOut();
    assert.equal(inst.camera.radius, ORBITAL_MAX_RADIUS, 'ZOOM OUT must not run past the far limit');
    engine.dispose();
  });

  it('SMOKE-PANEL-04: TEMP / CO2 / OCEAN / ICE each solo their own stem', () => {
    const { inst, engine } = makeScene();
    for (let k = 0; k < 4; k++) {
      assert.equal(inst.isStemMuted(k), false, `stem ${k} starts audible`);
      inst.actionToggleStem(k);
      assert.equal(inst.isStemMuted(k), false, `stem ${k} must stay audible when soloed`);
      for (let other = 0; other < 4; other++) {
        if (other !== k) assert.equal(inst.isStemMuted(other), true, `soloing stem ${k} must silence stem ${other}`);
      }
      inst.actionToggleStem(k);
      assert.deepEqual([0, 1, 2, 3].map((i) => inst.isStemMuted(i)), [false, false, false, false],
        `second tap on stem ${k} returns to the full mix`);
    }
    inst.actionToggleStem(4);
    inst.actionToggleStem(-1);
    assert.deepEqual([0, 1, 2, 3].map((i) => inst.isStemMuted(i)), [false, false, false, false],
      'out-of-range stem indices must be ignored');
    engine.dispose();
  });

  it('SMOKE-PANEL-06: deck layer buttons route audio to that stem only', () => {
    const { inst, engine } = makeScene();
    inst.actionSelectLayer(2); // OCEAN
    assert.equal(inst.activeLayerIndex, 2);
    assert.deepEqual([0, 1, 2, 3].map((i) => inst.isStemMuted(i)), [true, true, false, true],
      'OCEAN must leave only the ocean stem audible');
    inst.actionSelectLayer(2); // tap again -> back to the full mix
    assert.equal(inst.activeLayerIndex, null);
    assert.deepEqual([0, 1, 2, 3].map((i) => inst.isStemMuted(i)), [false, false, false, false],
      'deselecting the layer must restore all four stems');
    engine.dispose();
  });

  it('SMOKE-PANEL-05: EXIT routes to the VR teardown', () => {
    const { inst, engine } = makeScene();
    inst.isVRActive = true;
    inst._activateStereo();
    inst.actionExit();
    assert.equal(inst.isVRActive, false, 'EXIT must leave VR');
    assert.equal(inst._stereoActive, false, 'EXIT must dismantle the eye pair');
    engine.dispose();
  });
});

// ─── Picking: both eye halves ───────────────────────────────────────────────

describe('Split-screen smoke: button picking covers both eyes', () => {
  it('SMOKE-PICK-01: picking retries with the second eye camera when the first misses', () => {
    const faces = [{ name: 'FacePlay' }, { name: 'FaceZoomOut' }];
    const calls = [];
    let predicate = null;

    const fakeScene = {
      pointerX: 700,
      pointerY: 300,
      activeCameras: [{ name: 'OrbitalLeft' }, { name: 'OrbitalRight' }],
      activeCamera: { name: 'OrbitalCamera' },
      pick(x, y, pred, fastCheck, cam) {
        calls.push(cam.name);
        predicate = pred;
        // Only the right eye actually draws the button under this pointer.
        return cam.name === 'OrbitalRight' ? { hit: true, pickedMesh: faces[1] } : { hit: false };
      }
    };

    const resolved = OrbitalControlPanel.prototype._pickAtPointer.call({ _scene: fakeScene, _buttons: [{ face: faces[0] }, { face: faces[1] }] });

    assert.equal(resolved.pickedMesh, faces[1], 'pick must fall through to the eye that owns the pointer');
    assert.deepEqual(calls, ['OrbitalLeft', 'OrbitalRight'], 'both eyes must be tried before giving up');
    assert.equal(predicate(faces[0]), true, 'the ray test must accept button faces');
    assert.equal(predicate({ name: 'PanelBacking' }), false, 'the ray test must reject non-button meshes');
  });

  it('SMOKE-PICK-02: a miss in every camera returns an unhit pick instead of throwing', () => {
    const fakeScene = {
      pointerX: 10,
      pointerY: 10,
      activeCameras: [{ name: 'OrbitalLeft' }, { name: 'OrbitalRight' }],
      activeCamera: { name: 'OrbitalCamera' },
      pick: () => ({ hit: false })
    };
    const res = OrbitalControlPanel.prototype._pickAtPointer.call({ _scene: fakeScene, _buttons: [] });
    assert.equal(res.hit, false);
  });
});

// ─── Mouse navigation on the stereo canvas ──────────────────────────────────

function makeFakeCanvas() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    fire(type, event) {
      const fn = listeners.get(type);
      assert.ok(fn, `no ${type} listener attached`);
      return fn(event);
    }
  };
}

function makeNavTarget(camera) {
  return {
    _vrCanvas: makeFakeCanvas(),
    camera,
    _navHandlers: null
  };
}

describe('Split-screen smoke: drag-rotate and wheel-zoom listeners', () => {
  it('SMOKE-NAV-01: attach registers drag + wheel handlers and detach removes them', () => {
    const target = makeNavTarget({ alpha: 0, beta: Math.PI / 2, radius: 28 });
    OrbitalExamineScene.prototype._attachPointerNavigation.call(target);

    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) {
      assert.ok(target._vrCanvas.listeners.has(type), `${type} listener must be attached`);
    }

    const first = target._navHandlers;
    OrbitalExamineScene.prototype._attachPointerNavigation.call(target);
    assert.equal(target._navHandlers, first, 'attaching twice must not stack duplicate listeners');

    OrbitalExamineScene.prototype._detachPointerNavigation.call(target);
    assert.equal(target._navHandlers, null, 'detach must release the handler record');
    assert.equal(target._vrCanvas.listeners.size, 0, 'detach must remove every listener');
  });

  it('SMOKE-NAV-02: dragging rotates alpha/beta and clamps the poles', () => {
    const camera = { alpha: -1.5, beta: 1.2, radius: 28 };
    const target = makeNavTarget(camera);
    OrbitalExamineScene.prototype._attachPointerNavigation.call(target);
    const canvas = target._vrCanvas;

    canvas.fire('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    canvas.fire('pointermove', { pointerId: 1, clientX: 150, clientY: 140 });
    canvas.fire('pointerup', { pointerId: 1, clientX: 150, clientY: 140 });

    assert.ok(camera.alpha < -1.5, 'dragging right must orbit alpha');
    assert.ok(camera.beta < 1.2, 'dragging down must tilt beta');

    // Poles clamp so the camera never flips over the globe.
    canvas.fire('pointerdown', { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
    canvas.fire('pointermove', { pointerId: 2, clientX: 0, clientY: -5000 });
    canvas.fire('pointerup', { pointerId: 2, clientX: 0, clientY: -5000 });
    assert.ok(camera.beta <= Math.PI - 0.05 && camera.beta >= 0.05, 'beta must stay inside the pole clamp');

    // A move with no button held must not rotate.
    const alphaAtRest = camera.alpha;
    canvas.fire('pointermove', { pointerId: 2, clientX: 400, clientY: 400 });
    assert.equal(camera.alpha, alphaAtRest, 'pointer movement after pointerup must not rotate');

    OrbitalExamineScene.prototype._detachPointerNavigation.call(target);
  });

  it('SMOKE-NAV-03: the wheel zooms within the radius limits', () => {
    const camera = { alpha: 0, beta: 1, radius: 28 };
    const target = makeNavTarget(camera);
    OrbitalExamineScene.prototype._attachPointerNavigation.call(target);
    const canvas = target._vrCanvas;
    const wheel = (deltaY) => canvas.fire('wheel', { deltaY, preventDefault() {} });

    wheel(-100);
    assert.ok(camera.radius < 28, 'scrolling up must zoom in');
    wheel(100);
    wheel(100);
    assert.ok(camera.radius > 28, 'scrolling down must zoom out');

    for (let i = 0; i < 200; i++) wheel(-100);
    assert.ok(camera.radius >= ORBITAL_MIN_RADIUS - 1e-9, 'wheel must respect lowerRadiusLimit');
    for (let i = 0; i < 400; i++) wheel(100);
    assert.ok(camera.radius <= ORBITAL_MAX_RADIUS + 1e-9, 'wheel must respect upperRadiusLimit');

    OrbitalExamineScene.prototype._detachPointerNavigation.call(target);
  });

  it('SMOKE-NAV-04: enter/render loop attaches navigation, exit detaches it', () => {
    const startLoop = SRC.slice(SRC.indexOf('_startRenderLoop() {'), SRC.indexOf('_startRenderLoop() {') + 700);
    assert.match(startLoop, /_attachPointerNavigation\(\)/,
      'the render loop must attach drag/wheel navigation for the stereo canvas');

    const exitBody = SRC.slice(SRC.indexOf('exitVR() {'), SRC.indexOf('exitVR() {') + 1100);
    assert.match(exitBody, /_detachPointerNavigation\(\)/,
      'exitVR must detach the stereo navigation listeners');
    assert.match(exitBody, /_deactivateStereo\(\)/,
      'exitVR must dismantle the stereo eye pair');
  });
});
