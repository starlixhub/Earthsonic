/**
 * tests/test_vr_gaze_node.mjs
 * Verification of Milestone M3: Diegetic Gaze Interaction Subsystem.
 * Babylon.js port (VR-MIGRATION-2026):
 *   - VR-GAZE-01: 1:1 port.
 *   - VR-GAZE-02: glyph arc geometry contract 1:1 (positions via
 *     BABYLON.TransformNode; pairwise distance via BABYLON.Vector3.Distance).
 *   - VR-GAZE-03 / VR-GAZE-04: camera orientation probes moved from three.js
 *     'YXZ' Euler to Babylon's verified left-handed conventions:
 *     zero-rotation forward = +Z, rotation.x = -asin(d.y) for world target y,
 *     rotation.y = atan2(d.x, d.z). Hit detection, the 600ms dwell machine,
 *     decay, trigger side-effects and the zenith 75°/1.5s exit contract are
 *     all asserted with the same values as the verified build.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

import {
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  GAZE_HITBOX_RADIUS,
  GAZE_DECAY_RATE,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING
} from '../frontend/js/globe/vr/vr_gaze.js';

const DEG_TO_RAD = Math.PI / 180.0;

/** Aim a Babylon camera at a world-space target (identity-rig context). */
function aimCameraAt(camera, target) {
  const d = new BABYLON.Vector3(target.x, target.y, target.z).normalize();
  camera.rotation.x = -Math.asin(d.y);
  camera.rotation.y = Math.atan2(d.x, d.z);
  camera.rotation.z = 0.0;
}

describe('Milestone M3: Diegetic Gaze Glyphs & Interaction', () => {

  it('VR-GAZE-01: Gaze Constants, Thresholds, and Stem Mapping Specification', () => {
    assert.equal(GAZE_DWELL_THRESHOLD_SEC, 0.600);
    assert.equal(GAZE_HITBOX_RADIUS, 0.25);
    assert.equal(GAZE_DECAY_RATE, 2.5);
    assert.equal(ZENITH_PITCH_THRESHOLD_DEG, 75.0);
    assert.equal(ZENITH_DWELL_THRESHOLD_SEC, 1.500);

    assert.equal(STEM_MAPPING.length, 4);
    assert.equal(STEM_MAPPING[0].id, 'surface_temperature');
    assert.equal(STEM_MAPPING[1].id, 'atmospheric_co2');
    assert.equal(STEM_MAPPING[2].id, 'ocean_temperature');
    assert.equal(STEM_MAPPING[3].id, 'sea_ice_extent');
  });

  it('VR-GAZE-02: DataGlyphs Spatial Horizon Arc Geometry & Separation', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const glyphs = [];
    const radius = 2.0;
    const pitchRad = (-18.0 * DEG_TO_RAD);

    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * DEG_TO_RAD);

      const y = radius * Math.sin(pitchRad);
      const rHoriz = radius * Math.cos(pitchRad);
      const x = rHoriz * Math.sin(yawRad);
      const z = -rHoriz * Math.cos(yawRad);

      const group = new BABYLON.TransformNode(`DataGlyph_${i}`, scene);
      group.position.set(x, y, z);
      glyphs.push(group);

      // Verify pitch down (-18 deg) and front field (-z)
      assert.ok(y < 0.0, `Glyph ${i} y must be negative (pitch down -18 deg)`);
      assert.ok(z < 0.0, `Glyph ${i} z must be negative (front field)`);

      // Verify exact Euclidean distance from camera origin
      const distToOrigin = Math.sqrt(x * x + y * y + z * z);
      assert.ok(Math.abs(distToOrigin - 2.0) < 1e-4);
    }

    // Verify pairwise spatial separation > 0.5m
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const d = BABYLON.Vector3.Distance(glyphs[i].position, glyphs[j].position);
        assert.ok(d > 0.5, `Separation between glyphs ${i} and ${j} must exceed 0.5m, got ${d.toFixed(3)}m`);
      }
    }

    engine.dispose();
  });

  it('VR-GAZE-03: Gaze Raycast Hit Detection & 600ms Dwell Progression', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    scene.activeCamera = null;

    // Setup camera and glyphs in a mock scene
    const camera = new BABYLON.UniversalCamera('Camera', BABYLON.Vector3.Zero(), scene);
    const cameraRig = new BABYLON.TransformNode('CameraRig', scene);
    camera.parent = cameraRig;

    const radius = 2.0;
    const pitchRad = (-18.0 * DEG_TO_RAD);
    const glyphs = [];

    for (let i = 0; i < 4; i++) {
      const yawDeg = -45.0 + (i / 3.0) * 90.0;
      const yawRad = (yawDeg * DEG_TO_RAD);
      const y = radius * Math.sin(pitchRad);
      const rHoriz = radius * Math.cos(pitchRad);
      const x = rHoriz * Math.sin(yawRad);
      const z = -rHoriz * Math.cos(yawRad);

      const group = new BABYLON.TransformNode(`DataGlyph_${i}`, scene);
      group.position.set(x, y, z);
      group.metadata = { ringUniform: { value: 0.0 } };

      // Add a dummy mesh child (mote position probe target)
      const mote = BABYLON.MeshBuilder.CreateBox('Mote_' + i, { size: 0.1 }, scene);
      mote.parent = group;
      group.parent = cameraRig;
      glyphs.push(group);
    }

    let soloToggled = null;
    const mockMixer = {
      getTrack: (id) => ({ isSoloed: false, isMuted: false }),
      setTrackSolo: (id, solo) => { soloToggled = { id, solo }; },
      getAllTracks: () => []
    };

    const mockVRScene = {
      dataGlyphs: glyphs,
      exitVR: () => {}
    };

    const gaze = new VRGazeController(mockVRScene, mockMixer);
    gaze.init();

    // 1. Point camera straight forward (pitch = 0, yaw = 0) -> no glyph hit.
    //    (Babylon zero-rotation forward = +Z; the glyph arc is in the -Z half.)
    camera.rotation.set(0, 0, 0);

    gaze.update(camera, 0.1);
    assert.equal(gaze.getActiveGlyph(), -1);

    // 2. Point camera directly at Glyph 2: yaw = +15 deg, pitch = -18 deg
    aimCameraAt(camera, glyphs[2].position);

    // Dwell 300ms (0.3s) -> sub-threshold
    gaze.update(camera, 0.3);
    assert.equal(gaze.getActiveGlyph(), 2);
    const stateMid = gaze.getGlyphState(2);
    assert.ok(Math.abs(stateMid.progress - 0.5) < 0.05);
    assert.equal(stateMid.hasTriggered, false);
    assert.equal(soloToggled, null);

    // 3. Divert gaze: look away (pitch = 0, yaw = 0)
    camera.rotation.set(0, 0, 0);
    gaze.update(camera, 0.1);
    assert.equal(gaze.getActiveGlyph(), -1);
    // Dwell should decay smoothly
    assert.ok(gaze.getGlyphState(2).dwellTimer < 0.3);

    // 4. Return gaze to Glyph 2 and sustain for full 600ms (0.6s)
    aimCameraAt(camera, glyphs[2].position);

    // Reset timer to test clean 600ms threshold
    gaze.reset();
    gaze.update(camera, 0.59);
    assert.equal(gaze.getGlyphState(2).hasTriggered, false);

    gaze.update(camera, 0.02); // total >= 0.61s >= 0.600s
    assert.equal(gaze.getGlyphState(2).hasTriggered, true);
    assert.equal(gaze.getGlyphState(2).progress, 1.0);
    assert.deepEqual(soloToggled, { id: 'ocean_temperature', solo: true });

    gaze.dispose();
    engine.dispose();
  });

  it('VR-GAZE-04: Zenith Gaze Exit Detection (+75 deg pitch for 1.5s)', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    scene.activeCamera = null;

    let exitTriggered = false;
    const mockVRScene = {
      dataGlyphs: [],
      exitVR: () => { exitTriggered = true; }
    };

    // Babylon convention: +pitch on screen = NEGATIVE rotation.x
    const lookUpDeg = (deg) => { camera.rotation.x = -(deg * DEG_TO_RAD); };
    const camera = new BABYLON.UniversalCamera('Camera', BABYLON.Vector3.Zero(), scene);
    const gaze = new VRGazeController(mockVRScene, null, {
      onZenithExit: () => { exitTriggered = true; }
    });

    // 1. Look forward (pitch 0 deg) -> zero zenith dwell
    camera.rotation.set(0, 0, 0);
    gaze.update(camera, 0.5);
    assert.equal(gaze.zenithDwell, 0.0);
    assert.equal(exitTriggered, false);

    // 2. Look up at 74 deg (below 75 deg threshold) -> zero zenith dwell
    lookUpDeg(74.0);
    gaze.update(camera, 0.5);
    assert.equal(gaze.zenithDwell, 0.0);
    assert.equal(exitTriggered, false);

    // 3. Look up at 80 deg (above 75 deg threshold) for 0.75s -> 50% dwell
    lookUpDeg(80.0);
    gaze.update(camera, 0.75);
    assert.ok(Math.abs(gaze.zenithDwell - 0.75) < 0.01);
    assert.equal(exitTriggered, false);

    // 4. Look away briefly (resets timer)
    camera.rotation.x = 0;
    gaze.update(camera, 0.1);
    assert.equal(gaze.zenithDwell, 0.0);

    // 5. Look up at 80 deg for sustained 1.5s -> triggers exitVR
    lookUpDeg(80.0);
    gaze.update(camera, 1.51);
    assert.equal(exitTriggered, true);

    gaze.dispose();
    engine.dispose();
  });
});
