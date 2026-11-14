/**
 * tests/test_challenger_m3_fix_orbital_zenith.mjs
 * Challenger M3 Fix 2: Adversarial Empirical Challenge Suite
 * Focus: Orbital Zenith Gaze Projection, DataGlyphs Dwell & Invariants
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  GAZE_HITBOX_RADIUS,
  GAZE_DECAY_RATE,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING
} from '../../frontend/js/globe/vr/vr_gaze.js';

import { TOTAL_MONTHS } from '../../frontend/js/globe/vr/vr_timeline.js';
import {
  createTimeSpline,
  getSplineFrame,
  SKIM_ALTITUDE
} from '../../frontend/js/globe/vr/vr_spline.js';

describe('Challenger M3 Fix 2: Orbital Zenith Gaze Projection & Gaze Dwell Audit', () => {

  // ==========================================================================
  // 1. Orbital Zenith Gaze Projection under CameraRig Rotations
  // ==========================================================================
  describe('1. Orbital Zenith Gaze Projection under Diverse CameraRig Orientations', () => {

    it('1.1 Orbital flight across TimeSpline: looking forward NEVER triggers zenith exit', () => {
      const timeSpline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
      const sampleT = [0.0, 0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 0.99, 1.0];

      for (const t of sampleT) {
        const frame = getSplineFrame(timeSpline, t, SKIM_ALTITUDE);

        const cameraRig = new THREE.Group();
        cameraRig.position.copy(frame.position);
        cameraRig.quaternion.copy(frame.quaternion);

        const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
        camera.position.set(0, 0, 0);
        camera.rotation.order = 'YXZ';
        camera.rotation.set(0, 0, 0); // straight forward along rig flight path
        cameraRig.add(camera);
        cameraRig.updateMatrixWorld(true);

        let exitTriggered = false;
        const mockVRScene = {
          dataGlyphs: [],
          cameraRig: cameraRig,
          exitVR: () => { exitTriggered = true; }
        };

        const gaze = new VRGazeController(mockVRScene, null, {
          onZenithExit: () => { exitTriggered = true; }
        });

        // Simulate 120 frames (2.0 seconds at 60 FPS) looking straight forward in orbit
        for (let f = 0; f < 120; f++) {
          gaze.update(camera, 1.0 / 60.0);
        }

        assert.equal(gaze.zenithDwell, 0.0, `Zenith dwell must be 0.0 at t=${t}, got ${gaze.zenithDwell}`);
        assert.equal(exitTriggered, false, `False positive zenith exit triggered at t=${t}!`);
        gaze.dispose();
      }
    });

    it('1.2 Orbital flight across TimeSpline: looking up (+80° pitch) reliably triggers exit', () => {
      const timeSpline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
      const sampleT = [0.0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];

      for (const t of sampleT) {
        const frame = getSplineFrame(timeSpline, t, SKIM_ALTITUDE);

        const cameraRig = new THREE.Group();
        cameraRig.position.copy(frame.position);
        cameraRig.quaternion.copy(frame.quaternion);

        const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
        camera.position.set(0, 0, 0);
        camera.rotation.order = 'YXZ';
        // Pitch up +80° relative to rig canopy
        camera.rotation.x = THREE.MathUtils.degToRad(80.0);
        camera.rotation.y = 0;
        camera.rotation.z = 0;
        cameraRig.add(camera);
        cameraRig.updateMatrixWorld(true);

        let exitCount = 0;
        const mockVRScene = {
          dataGlyphs: [],
          cameraRig: cameraRig,
          exitVR: () => { exitCount++; }
        };

        const gaze = new VRGazeController(mockVRScene, null, {
          onZenithExit: () => { exitCount++; }
        });

        // 1. Dwell for 1.48s (sub-threshold) -> no exit
        for (let f = 0; f < 74; f++) {
          gaze.update(camera, 0.020); // 74 * 0.02 = 1.48s
        }
        assert.equal(exitCount, 0, `Exit must not fire at 1.48s at t=${t}`);
        assert.ok(Math.abs(gaze.zenithDwell - 1.48) < 1e-3, `Zenith dwell should be ~1.48s at t=${t}`);

        // 2. Advance 0.04s to reach 1.52s (>= 1.50s threshold) -> triggers exit
        gaze.update(camera, 0.040);
        assert.equal(exitCount, 1, `Exit must trigger at 1.52s at t=${t}`);
        assert.equal(gaze.zenithTriggered, true);

        // 3. Sustained gaze over-dwell for additional 1.0s -> does not multi-fire
        for (let f = 0; f < 50; f++) {
          gaze.update(camera, 0.020);
        }
        assert.equal(exitCount, 1, `Exit must not multi-fire at t=${t}`);

        gaze.dispose();
      }
    });

    it('1.3 Comprehensive 3D rotation grid: pitch, roll, and yaw immunity to false exits', () => {
      // Extensive test grid across Euler pitch, roll, and yaw angles of CameraRig
      const testPitches = [-90, -60, -45, -30, 0, 30, 45, 60, 90];
      const testYaws = [0, 45, 90, 135, 180, 225, 270, 315];
      const testRolls = [-180, -90, -45, 0, 45, 90, 180];

      const cameraRig = new THREE.Group();
      const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
      cameraRig.add(camera);

      let exitCount = 0;
      const gaze = new VRGazeController({ dataGlyphs: [], cameraRig }, null, {
        onZenithExit: () => { exitCount++; }
      });

      for (const pitch of testPitches) {
        for (const yaw of testYaws) {
          for (const roll of testRolls) {
            // Set arbitrary rig orientation
            cameraRig.rotation.order = 'YXZ';
            cameraRig.rotation.set(
              THREE.MathUtils.degToRad(pitch),
              THREE.MathUtils.degToRad(yaw),
              THREE.MathUtils.degToRad(roll)
            );

            // Camera is looking forward in the rig's horizon plane: local pitch = 0, varying local yaw
            const cameraLocalYaws = [-60, -30, 0, 30, 60];
            for (const cYaw of cameraLocalYaws) {
              camera.rotation.order = 'YXZ';
              camera.rotation.set(0, THREE.MathUtils.degToRad(cYaw), 0);
              cameraRig.updateMatrixWorld(true);

              gaze.update(camera, 0.050);

              assert.equal(
                gaze.zenithDwell,
                0.0,
                `False zenith dwell (${gaze.zenithDwell}) detected with Rig(P=${pitch}, Y=${yaw}, R=${roll}) and Cam(Yaw=${cYaw})`
              );
              assert.equal(exitCount, 0, `False exit triggered with Rig(P=${pitch}, Y=${yaw}, R=${roll})`);
            }
          }
        }
      }
      gaze.dispose();
    });

    it('1.4 Inverted / Upside-down Rig: +80° local canopy pitch triggers exit; pointing to Earth nadir does not', () => {
      // Invert CameraRig (roll = 180° or pitch = 180°)
      const cameraRig = new THREE.Group();
      cameraRig.rotation.z = Math.PI; // upside down
      const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
      camera.rotation.order = 'YXZ';
      cameraRig.add(camera);

      let exitCount = 0;
      const gaze = new VRGazeController({ dataGlyphs: [], cameraRig }, null, {
        onZenithExit: () => { exitCount++; }
      });

      // 1. Point camera towards local canopy (+80° local pitch, which in world space is down towards -Y)
      camera.rotation.set(THREE.MathUtils.degToRad(80.0), 0, 0);
      cameraRig.updateMatrixWorld(true);

      gaze.update(camera, 1.51);
      assert.equal(exitCount, 1, 'Local canopy pitch +80° must trigger exit even when rig is inverted');

      // 2. Reset and point camera towards local floor (-80° local pitch, which in world space is up towards +Y)
      gaze.reset();
      exitCount = 0;
      camera.rotation.set(THREE.MathUtils.degToRad(-80.0), 0, 0);
      cameraRig.updateMatrixWorld(true);

      gaze.update(camera, 2.0);
      assert.equal(gaze.zenithDwell, 0.0, 'Local floor pitch (-80°) must never trigger zenith exit even if pointing at celestial north');
      assert.equal(exitCount, 0, 'No exit when looking at floor');

      gaze.dispose();
    });

    it('1.5 Standalone camera mocks (camera.parent === null) continue to function identically', () => {
      const standaloneCamera = new THREE.PerspectiveCamera(75, 1, 0.05, 250);
      assert.equal(standaloneCamera.parent, null);

      let exitCount = 0;
      const gaze = new VRGazeController({ dataGlyphs: [] }, null, {
        onZenithExit: () => { exitCount++; }
      });

      // A: Looking forward (pitch 0)
      standaloneCamera.rotation.set(0, 0, 0);
      standaloneCamera.updateMatrixWorld(true);
      gaze.update(standaloneCamera, 1.0);
      assert.equal(gaze.zenithDwell, 0.0);
      assert.equal(exitCount, 0);

      // B: Looking at +74.9° pitch (just below threshold)
      standaloneCamera.rotation.x = THREE.MathUtils.degToRad(74.9);
      standaloneCamera.updateMatrixWorld(true);
      gaze.update(standaloneCamera, 2.0);
      assert.equal(gaze.zenithDwell, 0.0);
      assert.equal(exitCount, 0);

      // C: Looking at +80° pitch for 1.49s
      standaloneCamera.rotation.x = THREE.MathUtils.degToRad(80.0);
      standaloneCamera.updateMatrixWorld(true);
      gaze.update(standaloneCamera, 1.49);
      assert.ok(Math.abs(gaze.zenithDwell - 1.49) < 1e-3);
      assert.equal(exitCount, 0);

      // D: Complete 1.50s threshold
      gaze.update(standaloneCamera, 0.02);
      assert.equal(exitCount, 1);

      gaze.dispose();
    });
  });

  // ==========================================================================
  // 2. DataGlyphs Gaze Dwell & Clearance Verification
  // ==========================================================================
  describe('2. DataGlyphs Gaze Dwell & Inter-Glyph Clearance', () => {

    it('2.1 Inter-glyph clearance exceeds 0.50m across all pairs', () => {
      const radius = 2.0;
      const pitchRad = (-18.0 * Math.PI) / 180.0;
      const glyphPositions = [];

      for (let i = 0; i < 4; i++) {
        const yawDeg = -45.0 + (i / 3.0) * 90.0;
        const yawRad = (yawDeg * Math.PI) / 180.0;
        const y = radius * Math.sin(pitchRad);
        const rHoriz = radius * Math.cos(pitchRad);
        const x = rHoriz * Math.sin(yawRad);
        const z = -rHoriz * Math.cos(yawRad);
        glyphPositions.push(new THREE.Vector3(x, y, z));
      }

      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const dist = glyphPositions[i].distanceTo(glyphPositions[j]);
          assert.ok(dist > 0.50, `Clearance between glyph ${i} and ${j} must exceed 0.50m, got ${dist.toFixed(4)}m`);
        }
      }
    });

    it('2.2 600ms dwell fills ring shader and triggers solo toggle exactly once', () => {
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

      let soloCalls = 0;
      let toggledTrack = null;
      let toggledState = null;

      const mockMixer = {
        getTrack: (id) => ({ isSoloed: false, isMuted: false }),
        setTrackSolo: (id, solo) => {
          soloCalls++;
          toggledTrack = id;
          toggledState = solo;
        },
        getAllTracks: () => []
      };

      const gaze = new VRGazeController({ dataGlyphs: glyphs, cameraRig }, mockMixer);
      gaze.init();

      // Aim at Glyph 3: yaw = +45°, pitch = -18°
      camera.rotation.order = 'YXZ';
      camera.rotation.x = pitchRad;
      camera.rotation.y = THREE.MathUtils.degToRad(-45.0);
      camera.rotation.z = 0;
      cameraRig.updateMatrixWorld(true);

      // Step A: 599ms (sub-threshold)
      gaze.update(camera, 0.599);
      const state = gaze.getGlyphState(3);
      assert.equal(gaze.getActiveGlyph(), 3);
      assert.ok(state.progress < 1.0, `Progress at 599ms must be < 1.0, got ${state.progress}`);
      assert.equal(state.hasTriggered, false);
      assert.equal(soloCalls, 0);

      // Step B: +2ms -> 601ms (threshold reached)
      gaze.update(camera, 0.002);
      assert.equal(state.progress, 1.0, `Progress must reach 1.0 at >=600ms, got ${state.progress}`);
      assert.equal(state.hasTriggered, true);
      assert.equal(soloCalls, 1, 'Solo toggle must trigger exactly once');
      assert.equal(toggledTrack, 'sea_ice_extent');
      assert.equal(toggledState, true);

      // Step C: Hold gaze for another 50 frames (over-dwell) -> does not trigger again
      for (let f = 0; f < 50; f++) {
        gaze.update(camera, 0.016);
      }
      assert.equal(soloCalls, 1, 'Solo toggle must NOT fire repeatedly during sustained dwell');
      assert.equal(state.progress, 1.0);

      // Step D: Look away and verify reset
      camera.rotation.set(0, 0, 0);
      cameraRig.updateMatrixWorld(true);
      gaze.update(camera, 0.1);
      assert.equal(gaze.getActiveGlyph(), -1);
      assert.equal(state.hasTriggered, false);

      gaze.dispose();
    });
  });
});
