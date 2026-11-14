/**
 * tests/test_vr_renderer_node.mjs
 * Verification of Milestone M4 Feature 27: Dual-Mode VR Renderer Subsystem.
 * Babylon.js port (VR-MIGRATION-2026):
 *   - VR-REND-01 (pure math oracle), VR-REND-02 (API contract), VR-REND-05
 *     (lifecycle), VR-REND-06 (fallback), VR-REND-08 (subsystem coordination)
 *     are 1:1 ports.
 *   - VR-REND-03: Three.js spy-renderer probes replaced by Babylon scene-graph
 *     parentage + local offsets on NullEngine.
 *   - VR-REND-04: the manual setScissorTest/setScissor/setViewport call
 *     sequence is now Babylon-internal multi-camera rendering (documented
 *     deviation); the test verifies the equivalent contract: both eye cameras
 *     live in activeCameras, normalized half viewports, eye offsets, and a
 *     single scene.render() per frame.
 *   - VR-REND-07: aspect handling is engine-internal in Babylon; the test
 *     verifies viewport rects + the pure computeStereoViewports aspect math.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

import {
  VRRenderer,
  computeScissorStereo,
  computeStereoViewports,
  DEFAULT_EYE_SEP,
  CAMERA_FOV,
  cameraFovRad
} from '../frontend/js/globe/vr/vr_renderer.js';

const FOV_RAD = (75.0 * Math.PI) / 180.0;

function createBabylonScene() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  return { engine, scene };
}

describe('Milestone M4: Dual-Mode VR Renderer (Feature 27)', () => {

  it('VR-REND-01: Mathematical Parity of computeScissorStereo with Test Oracle', () => {
    // 1080p Standard
    const s1080 = computeScissorStereo(1920, 1080);
    assert.equal(s1080.eyeSep, 0.064);
    assert.deepEqual(s1080.leftEye.scissor, [0, 0, 960, 1080]);
    assert.deepEqual(s1080.rightEye.scissor, [960, 0, 960, 1080]);
    assert.equal(s1080.leftEye.camOffsetX, -0.032);
    assert.equal(s1080.rightEye.camOffsetX, 0.032);

    // Odd Pixel Width (1921px)
    const sOdd = computeScissorStereo(1921, 1080);
    assert.equal(sOdd.leftEye.scissor[2], 960);
    assert.equal(sOdd.rightEye.scissor[2], 961);
    assert.equal(sOdd.leftEye.scissor[2] + sOdd.rightEye.scissor[2], 1921);
    assert.equal(sOdd.rightEye.scissor[0], 960);

    // Mono Check (eyeSep = 0.0)
    const sMono = computeScissorStereo(1920, 1080, 0.0);
    assert.equal(sMono.leftEye.camOffsetX, 0.0);
    assert.equal(sMono.rightEye.camOffsetX, 0.0);

    // Extreme 4K (3840x1080)
    const s4k = computeScissorStereo(3840, 1080);
    assert.equal(s4k.leftEye.scissor[2], 1920);
    assert.equal(s4k.rightEye.scissor[2], 1920);

    // Minimum Canvas (100x100)
    const sMin = computeScissorStereo(100, 100);
    assert.equal(sMin.leftEye.scissor[2], 50);
  });

  it('VR-REND-02: Class Instantiation and Complete API Contract', () => {
    const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
    assert.equal(typeof vrRenderer.init, 'function');
    assert.equal(typeof vrRenderer.start, 'function');
    assert.equal(typeof vrRenderer.stop, 'function');
    assert.equal(typeof vrRenderer.isWebXRActive, 'function');
    assert.equal(typeof vrRenderer.isStereoActive, 'function');
    assert.equal(typeof vrRenderer.dispose, 'function');
    assert.equal(typeof vrRenderer.setEyeSeparation, 'function');
    assert.equal(typeof vrRenderer.renderStereoPass, 'function');

    assert.equal(vrRenderer.getEyeSeparation(), 0.064);
    assert.equal(vrRenderer.isWebXRActive(), false);
    assert.equal(vrRenderer.isStereoActive(), false);
    assert.equal(vrRenderer.getMode(), 'inactive');
  });

  it('VR-REND-03: Scene Graph Attachment & Camera Local Offsets (BABYLON)', () => {
    const { scene } = createBabylonScene();
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);
    camera.fov = FOV_RAD;
    camera.minZ = 0.05;
    camera.maxZ = 250.0;
    camera.parent = cameraRig;

    const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
    vrRenderer.init(scene, cameraRig, camera, scene.getEngine());

    assert.ok(vrRenderer.cameraLeft);
    assert.ok(vrRenderer.cameraRight);
    assert.equal(vrRenderer.cameraLeft.parent, camera);
    assert.equal(vrRenderer.cameraRight.parent, camera);

    // Offsets along camera local X axis
    assert.equal(vrRenderer.cameraLeft.position.x, -0.032);
    assert.equal(vrRenderer.cameraLeft.position.y, 0.0);
    assert.equal(vrRenderer.cameraLeft.position.z, 0.0);

    assert.equal(vrRenderer.cameraRight.position.x, 0.032);
    assert.equal(vrRenderer.cameraRight.position.y, 0.0);
    assert.equal(vrRenderer.cameraRight.position.z, 0.0);

    // Dynamic eye separation update
    vrRenderer.setEyeSeparation(0.070);
    assert.equal(vrRenderer.cameraLeft.position.x, -0.035);
    assert.equal(vrRenderer.cameraRight.position.x, 0.035);

    vrRenderer.dispose();
  });

  it('VR-REND-04: Single Frame Stereo Pass (BABYLON activeCameras dual-viewport)', () => {
    const { engine, scene } = createBabylonScene();
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);
    camera.parent = cameraRig;

    const vrRenderer = new VRRenderer({ eyeSep: 0.064 });
    vrRenderer.init(scene, cameraRig, camera, engine);

    // Render spy: exactly ONE scene render per frame (engine renders both
    // activeCameras with their viewports internally)
    let renderCount = 0;
    const origRender = scene.render.bind(scene);
    scene.render = (...args) => { renderCount++; return origRender(...args); };

    vrRenderer._isStereoActive = true;
    vrRenderer._renderFrame(0.016);

    assert.equal(renderCount, 1, 'Babylon renders both eye viewports inside ONE scene.render()');

    // Both eye cameras configured for the stereo pass
    vrRenderer.renderStereoPass();
    assert.equal(vrRenderer.cameraLeft.viewport.x, 0);
    assert.ok(Math.abs(vrRenderer.cameraLeft.viewport.width - 0.5) < 1e-6);
    assert.ok(Math.abs(vrRenderer.cameraRight.viewport.x - 0.5) < 1e-6);
    assert.ok(Math.abs(vrRenderer.cameraRight.viewport.width - 0.5) < 1e-6);
    assert.ok(Math.abs(vrRenderer.cameraLeft.viewport.height - 1.0) < 1e-6);

    // Projection parameters: FOV 75 deg, near 0.05, far 250 (Babylon radians)
    assert.ok(Math.abs(vrRenderer.cameraLeft.fov - FOV_RAD) < 1e-9);
    assert.equal(vrRenderer.cameraLeft.minZ, 0.05);
    assert.equal(vrRenderer.cameraLeft.maxZ, 250.0);
    assert.ok(Math.abs(vrRenderer.cameraRight.fov - FOV_RAD) < 1e-9);
    assert.equal(vrRenderer.cameraRight.minZ, 0.05);
    assert.equal(vrRenderer.cameraRight.maxZ, 250.0);

    // Eye positions re-derived from the same oracle math
    assert.equal(vrRenderer.cameraLeft.position.x, -0.032);
    assert.equal(vrRenderer.cameraRight.position.x, 0.032);

    const stereo = computeScissorStereo(1920, 1080, 0.064);
    assert.equal(stereo.leftEye.camOffsetX, vrRenderer.cameraLeft.position.x);
    assert.equal(stereo.rightEye.camOffsetX, vrRenderer.cameraRight.position.x);

    vrRenderer.stop();
    vrRenderer.dispose();
  });

  it('VR-REND-05: Stereo Mode Lifecycle and Animation Loop Stop', async () => {
    const { engine, scene } = createBabylonScene();
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);

    let startedMode = null;
    let stopped = false;

    const vrRenderer = new VRRenderer({
      eyeSep: 0.064,
      onStart: (m) => { startedMode = m; },
      onStop: () => { stopped = true; }
    });
    vrRenderer.init(scene, cameraRig, camera, engine);

    const mode = await vrRenderer.start('stereo');
    assert.equal(mode, 'stereo');
    assert.equal(startedMode, 'stereo');
    assert.equal(vrRenderer.isStereoActive(), true);
    assert.equal(vrRenderer.isWebXRActive(), false);
    assert.equal(vrRenderer.getMode(), 'stereo');

    // activeCameras drives the dual-viewport pass
    assert.ok(Array.isArray(scene.activeCameras) && scene.activeCameras.length === 2);
    assert.equal(scene.activeCameras[0], vrRenderer.cameraLeft);
    assert.equal(scene.activeCameras[1], vrRenderer.cameraRight);

    vrRenderer.stop();
    assert.equal(vrRenderer.isStereoActive(), false);
    assert.equal(vrRenderer.getMode(), 'inactive');
    assert.equal(stopped, true);
    // Stereo cameras detached from render after stop
    assert.equal(scene.activeCameras.length === 0, true);

    vrRenderer.dispose();
  });

  it('VR-REND-06: WebXR Fallback to Stereo when Unsupported', async () => {
    // In standard Node.js without navigator.xr, start('auto') or start('webxr') falls back to stereo
    const { engine, scene } = createBabylonScene();
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);

    const vrRenderer = new VRRenderer();
    vrRenderer.init(scene, cameraRig, camera, engine);

    const mode = await vrRenderer.start('auto');
    assert.equal(mode, 'stereo');
    assert.equal(vrRenderer.isStereoActive(), true);

    vrRenderer.stop();
    vrRenderer.dispose();
  });

  it('VR-REND-07: Canvas Resize Recomputes Viewport Halves and Aspect Math', () => {
    const engine2 = new BABYLON.NullEngine({ renderWidth: 1600, renderHeight: 900 });
    const scene = new BABYLON.Scene(engine2);
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);

    const vrRenderer = new VRRenderer();
    vrRenderer.init(scene, cameraRig, camera, engine2);

    vrRenderer.handleResize();

    // Viewport halves re-derived in normalized space
    assert.ok(Math.abs(vrRenderer.cameraLeft.viewport.width - 0.5) < 1e-6);
    assert.ok(Math.abs(vrRenderer.cameraLeft.viewport.x - 0) < 1e-6);
    assert.ok(Math.abs(vrRenderer.cameraRight.viewport.x - 0.5) < 1e-6);

    // Aspect math oracle preserved (half-width / height)
    const sv = computeStereoViewports(1600, 900, vrRenderer.getEyeSeparation());
    assert.ok(Math.abs(sv.leftAspect - 800 / 900) < 1e-6);
    assert.ok(Math.abs(sv.rightAspect - 800 / 900) < 1e-6);
    assert.equal(DEFAULT_EYE_SEP, 0.064);
    assert.equal(CAMERA_FOV, 75);

    vrRenderer.dispose();
  });

  it('VR-REND-08: Subsystem Update Coordination', () => {
    const { engine, scene } = createBabylonScene();
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    const camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera', BABYLON.Vector3.Zero(), scene);

    let vrSceneUpdated = false;
    let gliderUpdated = false;
    let gazeUpdated = false;
    let audioUpdated = false;

    const mockVrScene = {
      update: (dt) => { vrSceneUpdated = true; }
    };
    const mockGlider = {
      update: (dt) => { gliderUpdated = true; }
    };
    const mockGaze = {
      update: (cam, dt) => { gazeUpdated = true; }
    };
    const mockAudio = {
      updatePositions: () => { audioUpdated = true; }
    };

    const vrRenderer = new VRRenderer({
      vrScene: mockVrScene,
      glider: mockGlider,
      gaze: mockGaze,
      audio: mockAudio
    });
    vrRenderer.init(scene, cameraRig, camera, engine);

    vrRenderer._updateSubsystems(0.016);

    assert.equal(vrSceneUpdated, true);
    assert.equal(gliderUpdated, true);
    assert.equal(gazeUpdated, true);
    assert.equal(audioUpdated, true);

    vrRenderer.dispose();
    assert.equal(vrRenderer.cameraLeft, null);
    assert.equal(vrRenderer.cameraRight, null);
  });
});
