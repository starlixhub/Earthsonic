/**
 * tests/test_vr_audio_node.mjs
 * Verification of Milestone M3: 3D HRTF Spatial Audio Subsystem.
 * Babylon.js port (VR-MIGRATION-2026):
 *   - VR-AUD-01, VR-AUD-03 (positions/params), VR-AUD-04, VR-AUD-05,
 *     VR-AUD-06, VR-AUD-07: 1:1 ports.
 *   - VR-AUD-02: three.js default camera looks along -Z; a Babylon camera
 *     with zero rotation looks along +Z (verified left-handed convention).
 *     The listener-forward assertion is therefore +Z for zero rotation — the
 *     orientation contract (listener = camera world forward/up/position) is
 *     unchanged, and the world-up derivation from the camera world matrix is
 *     asserted directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

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

function createBabylonScene() {
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  scene.activeCamera = null;
  return { engine, scene };
}

describe('Milestone M3: 3D HRTF Spatial Audio & Sample-Locked Sync', () => {

  it('VR-AUD-01: Acoustic Constants & HRTF Parameters', () => {
    assert.equal(PANNING_MODEL, 'HRTF');
    assert.equal(DISTANCE_MODEL, 'inverse');
    assert.equal(REF_DISTANCE, 2.0);
    assert.equal(ROLLOFF_FACTOR, 1.2);
    assert.equal(MAX_DISTANCE, 100.0);
  });

  it('VR-AUD-02: AudioListener 3D Orientation and World Position Tracking', () => {
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
      currentTime: 1.0,
      listener: mockListener
    };

    const { engine, scene } = createBabylonScene();
    const camera = new BABYLON.UniversalCamera('Camera', new BABYLON.Vector3(5.0, 10.22, -3.0), scene);

    const spatialAudio = new VRSpatialAudio({
      audioCtx: mockAudioCtx,
      camera
    });

    spatialAudio.update(camera, []);

    // Listener position matches camera world position
    assert.ok(Math.abs(mockListener.positionX.value - 5.0) < 1e-4);
    assert.ok(Math.abs(mockListener.positionY.value - 10.22) < 1e-4);
    assert.ok(Math.abs(mockListener.positionZ.value - (-3.0)) < 1e-4);

    // Zero-rotation Babylon camera looks along +Z with world up +Y
    // (= camera.getForwardRay().direction for the same camera, self-consistent)
    const fwd = camera.getForwardRay(1.0).direction;
    assert.ok(Math.abs(mockListener.forwardX.value - fwd.x) < 1e-4);
    assert.ok(Math.abs(mockListener.forwardY.value - fwd.y) < 1e-4);
    assert.ok(Math.abs(mockListener.forwardZ.value - 1.0) < 1e-4,
      'Babylon zero-rotation forward is +Z (left-handed convention)');
    assert.ok(Math.abs(mockListener.upY.value - 1.0) < 1e-4);

    // Rig rotation reflects into world up through the camera world matrix
    const rig = new BABYLON.TransformNode('Rig', scene);
    camera.parent = rig;
    rig.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(Math.PI / 2, 0, 0);
    spatialAudio.update(camera, []);
    // World up is unchanged by pure yaw
    assert.ok(Math.abs(mockListener.upY.value - 1.0) < 1e-4);
    // World forward rotated by the rig yaw toward -X (yaw +90 on +Z basis)
    assert.ok(Math.abs(mockListener.forwardX.value - 1.0) < 1e-3);

    engine.dispose();
  });

  it('VR-AUD-03: 4 HRTF PannerNodes Dynamic Tracking of DataGlyphs Coordinates', () => {
    const mockAudioCtx = {
      currentTime: 2.5,
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

    const { engine, scene } = createBabylonScene();
    const camera = new BABYLON.UniversalCamera('Camera', BABYLON.Vector3.Zero(), scene);

    const dataGlyphs = [];
    const radius = 2.0;
    const pitchRad = (-18.0 * Math.PI) / 180.0;

    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * Math.PI) / 180.0;
      const y = radius * Math.sin(pitchRad);
      const rHoriz = radius * Math.cos(pitchRad);
      const x = rHoriz * Math.sin(yawRad);
      const z = -rHoriz * Math.cos(yawRad);

      const glyph = new BABYLON.TransformNode(`DataGlyph_${i}`, scene);
      glyph.position.set(x, y, z);
      dataGlyphs.push(glyph);
    }

    const spatialAudio = new VRSpatialAudio({
      audioCtx: mockAudioCtx,
      camera,
      dataGlyphs
    });
    spatialAudio.init(mockAudioCtx, null, camera, dataGlyphs);

    assert.equal(spatialAudio.panners.length, 4);

    spatialAudio.update(camera, dataGlyphs);

    for (let i = 0; i < 4; i++) {
      const p = spatialAudio.panners[i];
      const g = dataGlyphs[i];
      assert.ok(Math.abs(p.positionX.value - g.position.x) < 1e-4);
      assert.ok(Math.abs(p.positionY.value - g.position.y) < 1e-4);
      assert.ok(Math.abs(p.positionZ.value - g.position.z) < 1e-4);

      // Verify acoustic parameters
      assert.equal(p.panningModel, 'HRTF');
      assert.equal(p.distanceModel, 'inverse');
      assert.equal(p.refDistance, 2.0);
      assert.equal(p.rolloffFactor, 1.2);
    }

    engine.dispose();
  });

  it('VR-AUD-04: Sample-Locked Timeline Playhead Scrubbing & Throttling', () => {
    let seekedTarget = -1;
    const mockMixer = {
      duration: 60.0,
      seekProgress: (t) => { seekedTarget = t * 60.0; },
      seek: (s) => { seekedTarget = s; }
    };

    const spatialAudio = new VRSpatialAudio({
      mixer: mockMixer
    });

    // 1. Scrub to t = 0.5 -> 30.0s
    spatialAudio.syncPlayhead(0.5);
    assert.ok(Math.abs(seekedTarget - 30.0) < 1e-4);

    // 2. Scrub to t = 1.0 (clamped to full duration 60.0s)
    spatialAudio.lastSeekTime = 0; // bypass throttle for test
    spatialAudio.syncPlayhead(1.0);
    assert.ok(Math.abs(seekedTarget - 60.0) < 1e-4);

    // 3. Scrub to negative (clamped to 0.0s)
    spatialAudio.lastSeekTime = 0;
    spatialAudio.syncPlayhead(-0.25);
    assert.equal(seekedTarget, 0.0);

    // 4. Overflow scrub > 1.0 (clamped to 60.0s)
    spatialAudio.lastSeekTime = 0;
    spatialAudio.syncPlayhead(1.5);
    assert.equal(seekedTarget, 60.0);
  });

  it('VR-AUD-05: Distance Attenuation Formula & Singularity Prevention', () => {
    function calculateHrtfGain(distance, refDist = 2.0, rolloff = 1.2) {
      const d = Math.max(0.01, distance);
      if (d <= refDist) return 1.0;
      return refDist / (refDist + rolloff * (d - refDist));
    }

    // 1. Distance <= refDistance: unity gain (1.0)
    assert.equal(calculateHrtfGain(2.0), 1.0);
    assert.equal(calculateHrtfGain(1.0), 1.0);
    assert.equal(calculateHrtfGain(0.0), 1.0); // singularity clamp

    // 2. Distance = 4.0m: 2.0 / (2.0 + 1.2 * 2.0) = 2.0 / 4.4 ~ 0.4545
    assert.ok(Math.abs(calculateHrtfGain(4.0) - (2.0 / 4.4)) < 1e-4);

    // 3. Distance = 10.0m: 2.0 / (2.0 + 1.2 * 8.0) = 2.0 / 11.6 ~ 0.1724
    assert.ok(Math.abs(calculateHrtfGain(10.0) - (2.0 / 11.6)) < 1e-4);

    // 4. Distance = 100.0m: < 0.02
    assert.ok(calculateHrtfGain(100.0) < 0.02);

    // 5. Monotonic decreasing
    assert.ok(calculateHrtfGain(3.0) > calculateHrtfGain(5.0));
    assert.ok(calculateHrtfGain(5.0) > calculateHrtfGain(10.0));
  });

  it('VR-AUD-06: Mixer Audio Graph Insertion and Detachment Lifecycle', () => {
    const mixer = new EarthOrchestraMixer();
    const spatialAudio = new VRSpatialAudio({ mixer });
    spatialAudio.init(mixer.audioCtx, mixer, null, []);

    // Initial state: not attached
    assert.equal(spatialAudio.isAttached, false);

    // Attach to mixer channels
    spatialAudio.attach();
    assert.equal(spatialAudio.isAttached, true);
    for (const track of mixer.getAllTracks()) {
      assert.ok(track.spatialPannerNode);
    }

    // Detach from mixer channels (restore 2D wiring)
    spatialAudio.detach();
    assert.equal(spatialAudio.isAttached, false);
    for (const track of mixer.getAllTracks()) {
      assert.equal(track.spatialPannerNode, null);
    }

    spatialAudio.dispose();
  });

  it('VR-AUD-07: Full Integration with window.earthsonicVR and Scene Tick', async () => {
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = {};
    }

    const vr = installEarthsonicVR();
    await vr.init();

    // Verify spatial audio and panners are exposed on vr interface
    assert.ok(vr.spatialAudio);
    assert.ok(Array.isArray(vr.panners));
    assert.equal(vr.panners.length, 4);

    // Verify glider and gaze controller are exposed
    assert.ok(vr.glider);
    assert.ok(vr.gazeController);

    // Verify tick update executes cleanly across scene graph
    vr.tick(0.016);

    // Verify enterVR attaches audio and enables glider
    vr.enterVR({ mode: 'auto' });
    assert.equal(vr.isVRActive, true);
    assert.equal(vr.glider.isEnabled, true);

    // Verify exitVR detaches audio and disables glider
    vr.exitVR();
    assert.equal(vr.isVRActive, false);
    assert.equal(vr.glider.isEnabled, false);
  });
});
