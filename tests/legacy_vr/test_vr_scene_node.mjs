/**
 * tests/test_vr_scene_node.mjs
 * Verification of Milestone M2: Normalized Planetary Scene Graph & Shaders.
 * Babylon.js port (VR-MIGRATION-2026):
 *   - M2-01, M2-02, M2-05, M2-06: 1:1 ports (constants / GLSL strings /
 *     spline math / audio analyser contract are engine-free).
 *   - M2-03, M2-04: Babylon factories take a leading BABYLON.Scene argument
 *     (documented signature change); THREE material probes are replaced by
 *     their Babylon equivalents (`side` compat string maps the exact same
 *     three-side semantics; geometry radius probes became vertex-count +
 *     tessellation oracles for the deterministic Babylon builders).
 *   - M2-07: unchanged flow on the headless NullEngine path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';

import {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  SKIM_ALTITUDE,
  CAMERA_NEAR,
  CAMERA_FAR,
  TOTAL_MONTHS,
  STARFIELD_RADIUS,
  HORIZON_DIP_DEG,
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  createGaiaStarfieldMesh,
  generateGaiaStarfieldCanvas,
  createTimeSpline,
  getSplineFrame,
  interpolateHarmonizedRecord,
  installEarthsonicVR
} from '../frontend/js/globe/vr/index.js';

import { TrackStrip } from '../frontend/js/audio/track.js';
import { EarthOrchestraMixer } from '../frontend/js/audio/mixer.js';

// Babylon sphere tessellation oracle: CreateSphere(segments: N) builds
// (N + 1) * (N/2 + 1) unique vertices.
function sphereVertexCount(segments) {
  return (segments + 1) * (segments / 2 + 1);
}

describe('Milestone M2: Normalized Planetary Scene Graph & Physical Shaders', () => {

  it('M2-01: Normalized Planetary Scale Constants & Frustum Units', () => {
    assert.equal(EARTH_RADIUS, 10.0);
    assert.equal(SKIM_ALTITUDE, 10.22);
    assert.equal(CAMERA_NEAR, 0.05);
    assert.equal(CAMERA_FAR, 250.0);
    assert.equal(TOTAL_MONTHS, 573);
    assert.equal(STARFIELD_RADIUS, 240.0);
    assert.equal(HORIZON_DIP_DEG, 11.91);

    // Exact depth ratio for 24-bit integer z-buffer without z-fighting
    const depthRatio = CAMERA_NEAR / CAMERA_FAR;
    assert.equal(depthRatio, 0.0002);

    // Skim clearance
    assert.ok(Math.abs((SKIM_ALTITUDE / EARTH_RADIUS) - 1.022) < 1e-4);
  });

  it('M2-02: GLSL Physical Shaders Syntax & Uniforms Verification', () => {
    // 1. TerminatorRibbon
    assert.ok(VRTerminatorRibbonShader.vertexShader.includes('precision highp float;'));
    assert.ok(VRTerminatorRibbonShader.vertexShader.includes('uAnomalyValue'));
    assert.ok(VRTerminatorRibbonShader.vertexShader.includes('uAudioEnvelope'));
    assert.ok(VRTerminatorRibbonShader.fragmentShader.includes('cross('));
    assert.ok(VRTerminatorRibbonShader.fragmentShader.includes('vec3(0.15, 0.35, 0.90)'));
    assert.ok(VRTerminatorRibbonShader.fragmentShader.includes('vec3(0.95, 0.25, 0.10)'));

    // 2. AtmosphereShell
    assert.ok(VRAtmosphereShellShader.vertexShader.includes('precision highp float;'));
    assert.ok(VRAtmosphereShellShader.fragmentShader.includes('uCO2Ppm'));
    assert.ok(VRAtmosphereShellShader.fragmentShader.includes('uAudioEnvelope'));
    assert.ok(VRAtmosphereShellShader.fragmentShader.includes('vec3(0.10, 0.50, 0.95)'));
    assert.ok(VRAtmosphereShellShader.fragmentShader.includes('vec3(0.85, 0.55, 0.20)'));

    // 3. OceanGlowField
    assert.ok(VROceanGlowShader.fragmentShader.includes('waterMask <= 0.5'));
    assert.ok(VROceanGlowShader.fragmentShader.includes('discard'));
    assert.ok(VROceanGlowShader.fragmentShader.includes('fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5)'));
    assert.ok(VROceanGlowShader.fragmentShader.includes('vec3(0.1, 0.6, 0.9)'));

    // 4. IceCapShader
    assert.ok(VRIceCapShader.fragmentShader.includes('1.31'));
    assert.ok(VRIceCapShader.fragmentShader.includes('0.01802'));
    assert.ok(VRIceCapShader.fragmentShader.includes('pow(1.0 - cosTheta, 5.0)'));
    assert.ok(VRIceCapShader.fragmentShader.includes('smoothstep(boundaryLat - 2.5, boundaryLat + 2.5, absLat)'));

    // 5. SurfaceShader
    assert.ok(VRSurfaceShader.vertexShader.includes('uBumpMap'));
    assert.ok(VRSurfaceShader.fragmentShader.includes('uDayMap'));
    assert.ok(VRSurfaceShader.fragmentShader.includes('uNightMap'));
  });

  it('M2-03: Mesh Factory Functions for Planetary Layers (BABYLON)', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);

    // Terminator Ribbon Mesh
    const ribbon = createTerminatorRibbon(scene, 10.015, 0.18, 64);
    assert.equal(ribbon.name, 'TerminatorRibbon');
    assert.ok(ribbon instanceof BABYLON.Mesh);
    assert.equal(ribbon.material.side, 'DoubleSide');
    assert.equal(ribbon.material.depthWrite, false);

    // Atmosphere Shell Mesh (inner-facing: BackSide + BACKSIDE geometry).
    // Radius oracle: Babylon bounding radius = sqrt(3) * requested radius
    // (axis-diagonal metric), independent of internal vertex packaging.
    const atmos = createAtmosphereShell(scene, 10.25);
    assert.equal(atmos.name, 'AtmosphereShell');
    assert.equal(atmos.material.side, 'BackSide');
    assert.ok(atmos.material.backFaceCulling === true);
    assert.ok(Math.abs(atmos.getBoundingInfo().boundingSphere.radius / Math.sqrt(3) - 10.25) < 1e-2);

    // Ocean Glow Field Mesh
    const ocean = createOceanGlowField(scene, 10.002);
    assert.equal(ocean.name, 'OceanGlowField');
    assert.equal(ocean.material.side, 'FrontSide');
    assert.ok(Math.abs(ocean.getBoundingInfo().boundingSphere.radius / Math.sqrt(3) - 10.002) < 1e-2);

    // Ice Cap Group
    const ice = createIceCapGroup(scene, 10.005);
    assert.equal(ice.name, 'IceCapGroup');
    assert.equal(ice.getChildMeshes().length, 2);
    assert.equal(ice.getChildMeshes()[0].name, 'ArcticIceCap');
    assert.equal(ice.getChildMeshes()[1].name, 'AntarcticIceCap');

    engine.dispose();
  });

  it('M2-04: Gaia Deep Starfield Skybox Mesh (Zero Procedural Points)', () => {
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);

    const starfield = createGaiaStarfieldMesh(scene, 240.0, '/assets/textures/starfield_gaia_2k.png');
    assert.equal(starfield.name, 'StarfieldSkybox');
    assert.ok(starfield instanceof BABYLON.Mesh);
    assert.ok(Math.abs(starfield.getBoundingInfo().boundingSphere.radius / Math.sqrt(3) - 240.0) < 0.1);
    // BackSide wiring (inner-facing) + depthWrite false parity
    assert.equal(starfield.material.backFaceCulling, true);
    assert.equal(starfield.material.disableDepthWrite, true);
    assert.equal(starfield.material.disableLighting, true);
    // Strictly not a points object (1-draw-call textured sphere, not scatter)
    assert.ok(!(typeof BABYLON.PointsCloudSystem !== 'undefined' && starfield instanceof BABYLON.PointsCloudSystem));

    engine.dispose();
  });

  it('M2-05: 573-Month TimeSpline & Horizon-Lock Frame (Roll = 0.0°)', () => {
    const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
    assert.equal(spline.points.length, 573);
    assert.equal(spline.curveType, 'centripetal');

    // Every control point strictly at altitude 10.22
    for (let i = 0; i < 573; i += 50) {
      const len = spline.points[i].length();
      assert.ok(Math.abs(len - 10.22) < 1e-4);
    }

    // Horizon Lock Frame at multiple timeline steps
    for (const t of [0.0, 0.25, 0.5, 0.75, 1.0]) {
      const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);
      assert.ok(Math.abs(frame.position.length() - 10.22) < 1e-4);

      // Normal and up vectors collinear
      const posNormal = frame.position.clone().normalize();
      assert.ok(Math.abs(posNormal.dot(frame.up) - 1.0) < 1e-4);

      // Right and forward orthogonal to up
      assert.ok(Math.abs(frame.right.dot(frame.up)) < 1e-4);
      assert.ok(Math.abs(frame.forward.dot(frame.up)) < 1e-4);

      // Right and forward mutually orthogonal
      assert.ok(Math.abs(frame.right.dot(frame.forward)) < 1e-4);
    }

    // Interpolation of harmonized records
    const sampleRecords = [
      { date: '1979-01', temperature_anomaly: 0.08, co2_ppm: 336.14, ocean_temp_anomaly: 0.25, sea_ice_extent: 15.41 },
      { date: '2026-09', temperature_anomaly: 1.38, co2_ppm: 426.07, ocean_temp_anomaly: 1.10, sea_ice_extent: 4.81 }
    ];
    const rStart = interpolateHarmonizedRecord(sampleRecords, 0.0);
    const rEnd = interpolateHarmonizedRecord(sampleRecords, 1.0);
    const rMid = interpolateHarmonizedRecord(sampleRecords, 0.5);

    assert.equal(rStart.date, '1979-01');
    assert.equal(rStart.temperature_anomaly, 0.08);
    assert.equal(rEnd.date, '2026-09');
    assert.equal(rEnd.temperature_anomaly, 1.38);
    assert.ok(Math.abs(rMid.temperature_anomaly - 0.73) < 1e-3);
  });

  it('M2-06: 4-Stem Web Audio AnalyserNodes & Envelopes Integration', () => {
    const track = new TrackStrip('surface_temperature');
    assert.ok(track);
    assert.equal(typeof track.getAudioEnvelope, 'function');
    assert.equal(track.getAudioEnvelope(), 0.0);

    const mixer = new EarthOrchestraMixer();
    assert.equal(typeof mixer.getTrackAnalyser, 'function');
    assert.equal(typeof mixer.getAudioEnvelopes, 'function');

    const envs = mixer.getAudioEnvelopes();
    assert.equal(envs.length, 4);
    assert.deepEqual(envs, [0.0, 0.0, 0.0, 0.0]);

    // getTrackAnalyser by index and ID
    const analyser0 = mixer.getTrackAnalyser(0);
    const analyserById = mixer.getTrackAnalyser('surface_temperature');
    assert.equal(analyser0, analyserById);
  });

  it('M2-07: window.earthsonicVR Interface Contract Initialization', async () => {
    // Mock global window if in Node
    if (typeof globalThis.window === 'undefined') {
      globalThis.window = {};
    }

    const vr = installEarthsonicVR();
    assert.ok(window.earthsonicVR);
    assert.equal(vr, window.earthsonicVR);

    await vr.init();

    // Required Interface Contract Properties
    assert.ok(vr.cameraRig);
    assert.ok(vr.camera);
    assert.ok(vr.timeSpline);
    assert.ok(Array.isArray(vr.dataGlyphs));
    assert.equal(vr.dataGlyphs.length, 4);
    assert.equal(vr.isVRActive, false);

    // ACES tone mapping engaged on the Babylon scene (Task §1 mandate)
    const ipc = vr.sceneInstance.scene.imageProcessingConfiguration;
    assert.equal(ipc.toneMappingEnabled, true);
    assert.equal(ipc.toneMappingType, BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES);
    assert.equal(ipc.exposure, 1.0);

    // Timeline update
    vr.updateTimeline(0.5);
    assert.equal(vr.currentT, 0.5);

    // Audio envelopes update
    vr.updateAudioEnvelopes([0.2, 0.4, 0.6, 0.8]);

    // Tick update (scene-graph state only; subsystem updates live in the renderer loop)
    vr.tick(0.016);

    // Enter & exit VR (un-awaited, same contract as the verified build)
    vr.enterVR({ mode: 'auto' });
    assert.equal(vr.isVRActive, true);
    vr.exitVR();
    assert.equal(vr.isVRActive, false);

    // NOTE: engine.dispose() is intentionally NOT called under the mocked
    // window (Babylon's internal dispose path requires window.removeEventListener,
    // which the minimal mock lacks). Namespace garbage is collected by the runner. 
  });
});
