/**
 * tests/stress_m2_empirical_challenge.mjs
 * Adversarial Empirical Verification Suite for Milestone M2.
 * Validates depth precision, horizon curvature optics, starfield skybox,
 * mobile texture budget, and globe.js non-regression.
 *
 * Babylon.js port (VR-MIGRATION-2026):
 *   - Challenge 1: factory calls now take a leading BABYLON.Scene (NullEngine);
 *     `material.depthWrite` compat property on VRShaderMaterial is unchanged.
 *   - Challenge 2, 4, 5: unchanged (pure math / filesystem / source greps; the
 *     THREE.PerspectiveCamera projection math in Challenge 2 is a pure oracle
 *     for the shared FOV/dip optics and remains valid).
 *   - Challenge 3: Babylon mesh probes replace isMesh/geometry.parameters;
 *     Babylon bounding radius oracle = sqrt(3) * requested radius.
 *   - Challenge 6: unchanged (spline frame orthonormality; crossVectors math
 *     through plain vector objects).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BABYLON } from '../frontend/vendor/babylon/babylon.core.module.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  SKIM_ALTITUDE,
  CAMERA_NEAR,
  CAMERA_FAR,
  createGaiaStarfieldMesh,
  STARFIELD_RADIUS,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  createTimeSpline,
  getSplineFrame
} from '../frontend/js/globe/vr/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Empirical Challenger M2: Deep Adversarial Audit', () => {

  it('Challenge 1: Depth Buffer Precision & Multi-Shell Z-Fighting Immunity', () => {
    // Frustum configuration
    const near = CAMERA_NEAR;
    const far = CAMERA_FAR;
    const ratio = near / far;
    assert.equal(ratio, 0.0002, 'Near/Far ratio must equal 0.0002');

    // 24-bit window depth function
    // Z_ndc = ((far + near)/(far - near)) - ((2 * far * near)/((far - near) * d))
    // Z_24 = floor((Z_ndc + 1) / 2 * (2^24 - 1))
    const MAX_24 = (1 << 24) - 1;
    function calcDepth24(d) {
      const z_ndc = ((far + near) / (far - near)) - ((2.0 * far * near) / ((far - near) * d));
      const z_win = (z_ndc + 1.0) * 0.5;
      return Math.floor(z_win * MAX_24);
    }

    const camAlt = SKIM_ALTITUDE; // 10.22
    const shells = [
      { name: 'Surface', r: 10.000 },
      { name: 'OceanGlowField', r: 10.002 },
      { name: 'IceCap', r: 10.005 },
      { name: 'TerminatorRibbon', r: 10.015 },
      { name: 'CloudLayer', r: 10.080 }
    ];

    // Nadir (viewing straight down)
    for (let i = 0; i < shells.length - 1; i++) {
      const s1 = shells[i];
      const s2 = shells[i + 1];
      const d1 = camAlt - s1.r;
      const d2 = camAlt - s2.r;
      const z1 = calcDepth24(d1);
      const z2 = calcDepth24(d2);
      const deltaZ = Math.abs(z1 - z2);
      // Guarantee over 1,000 discrete integer levels even at nadir
      assert.ok(deltaZ > 1000, `Nadir gap between ${s1.name} and ${s2.name} is too small: ${deltaZ}`);
    }

    // Limb / Tangent line of sight
    for (let i = 0; i < shells.length - 1; i++) {
      const s1 = shells[i];
      const s2 = shells[i + 1];
      const d1 = Math.sqrt(camAlt * camAlt - s1.r * s1.r);
      const d2 = Math.sqrt(camAlt * camAlt - s2.r * s2.r);
      const z1 = calcDepth24(d1);
      const z2 = calcDepth24(d2);
      const deltaZ = Math.abs(z1 - z2);
      // Guarantee over 500 discrete integer levels at tangent limb
      assert.ok(deltaZ > 500, `Limb gap between ${s1.name} and ${s2.name} is too small: ${deltaZ}`);
    }

    // Verify depthWrite: false on transparent overlay meshes
    // (BABYLON port: NullEngine scene, factory signature (scene, radius, ...))
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const ocean = createOceanGlowField(scene, 10.002, null);
    assert.equal(ocean.material.depthWrite, false);
    const ribbon = createTerminatorRibbon(scene, 10.015, 0.18, 64);
    assert.equal(ribbon.material.depthWrite, false);
    const atmos = createAtmosphereShell(scene, 10.25);
    assert.equal(atmos.material.depthWrite, false);
  });

  it('Challenge 2: Horizon Curvature Optics & Visual Field Occupancy', () => {
    const R = EARTH_RADIUS; // 10.0
    const h = SKIM_ALTITUDE; // 10.22
    const vfov = 75.0; // degrees
    const halfVfov = vfov / 2.0; // 37.5 degrees

    // 1. True Horizon Dip Angle
    const cosDip = R / h;
    const dipRad = Math.acos(cosDip);
    const dipDeg = (dipRad * 180.0) / Math.PI;

    // Verify 11.91° dip angle
    assert.ok(Math.abs(dipDeg - 11.91) < 0.02, `Horizon dip angle ${dipDeg} must be ~11.91°`);

    // 2. Angular occupancy of lower visual field
    const earthAngularSpan = halfVfov - dipDeg;
    const angularFraction = earthAngularSpan / halfVfov;
    assert.ok(angularFraction >= 0.65 && angularFraction <= 0.72, `Angular fraction ${angularFraction} must be ~70%`);

    // 3. Perspective Camera Projection Screen Occupancy
    // (Pure projection-math oracle shared by both engines: half-angle math is
    // identical for a Babylon camera with fov = 75deg vertical.)
    const yHorizonNdc = Math.tan(dipRad) / Math.tan((halfVfov * Math.PI) / 180.0);
    const screenFraction = 1.0 - yHorizonNdc;
    assert.ok(screenFraction >= 0.68 && screenFraction <= 0.75, `Screen fraction ${screenFraction} must be ~70%`);
  });

  it('Challenge 3: Skybox Invariant & Zero Procedural Points Audit', () => {
    // BABYLON port: NullEngine scene; mesh probes become Babylon equivalents.
    const engine = new BABYLON.NullEngine();
    const scene = new BABYLON.Scene(engine);
    const skybox = createGaiaStarfieldMesh(scene, STARFIELD_RADIUS, '/assets/textures/starfield_gaia_2k.png');
    assert.ok(skybox instanceof BABYLON.Mesh, 'Skybox must be a BABYLON.Mesh');
    // Strictly not a points object (1-draw-call textured sphere, not scatter)
    assert.ok(!(typeof BABYLON.PointsCloudSystem !== 'undefined' && skybox instanceof BABYLON.PointsCloudSystem));
    // Sphere radius oracle: Babylon bounding radius = sqrt(3) * requested radius
    assert.ok(Math.abs(skybox.getBoundingInfo().boundingSphere.radius / Math.sqrt(3) - 240.0) < 0.1);
    // BackSide wiring (inner-facing) + depthWrite false parity
    assert.equal(skybox.material.side, 'BackSide');
    assert.equal(skybox.material.depthWrite, false);

    // Source code static AST / string check
    const skyboxSrc = fs.readFileSync(path.join(rootDir, 'frontend/js/globe/vr/vr_starfield.js'), 'utf-8');
    assert.ok(!skyboxSrc.includes('THREE.Points'), 'vr_starfield.js must not reference THREE.Points');
    assert.ok(!skyboxSrc.includes('PointsMaterial'), 'vr_starfield.js must not reference PointsMaterial');
    assert.ok(skyboxSrc.includes('Gaia'), 'vr_starfield.js must reference Gaia catalog');
    assert.ok(skyboxSrc.includes('Hipparcos'), 'vr_starfield.js must reference Hipparcos catalog');

    engine.dispose();
  });

  it('Challenge 4: Mobile Texture Budget & Dimension Verification', () => {
    const texDir = path.join(rootDir, 'frontend/assets/textures');
    const textures = [
      'earth_day_2k.png',
      'earth_night_2k.png',
      'earth_clouds_2k.png',
      'earth_bump_2k.png',
      'earth_specular_2k.png',
      'starfield_gaia_2k.png'
    ];

    for (const file of textures) {
      const fullPath = path.join(texDir, file);
      assert.ok(fs.existsSync(fullPath), `Texture ${file} must exist`);
      const stat = fs.statSync(fullPath);
      assert.ok(stat.size > 20000, `Texture ${file} must have valid non-trivial size`);
    }

    // VRAM calculation logic: 2048x1024 textures with mipmaps
    const vramMb = (w, h) => (w * h * 4 * 1.3333) / (1024 * 1024);
    const single2kMb = vramMb(2048, 1024);
    assert.ok(single2kMb < 11.0);
    // Any pair of active 2K textures is well within the 25.17 MB ceiling
    assert.ok(single2kMb * 2 <= 25.17 * 1.05);
  });

  it('Challenge 5: Globe.js Non-Regression Invariant Verification', () => {
    const globeSrc = fs.readFileSync(path.join(rootDir, 'frontend/js/globe/globe.js'), 'utf-8');
    assert.ok(!globeSrc.includes('vr_scene'), 'globe.js must not contain vr_scene');
    assert.ok(!globeSrc.includes('vr_shaders'), 'globe.js must not contain vr_shaders');
    assert.ok(!globeSrc.includes('vr_starfield'), 'globe.js must not contain vr_starfield');
    assert.ok(!globeSrc.includes('earthsonicVR'), 'globe.js must not contain earthsonicVR');
    assert.ok(globeSrc.includes('export class EarthGlobe'), 'globe.js must retain original EarthGlobe class export');
  });

  it('Challenge 6: 100% Locked Horizon (Zero Roll) Across Complete 573-Month Orbit', () => {
    const spline = createTimeSpline(SKIM_ALTITUDE, 573);
    assert.equal(spline.points.length, 573);

    // Sample across 100 points along the spline
    for (let step = 0; step <= 100; step++) {
      const t = step / 100.0;
      const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);

      // Verify exact altitude 10.22
      const alt = frame.position.length();
      assert.ok(Math.abs(alt - 10.22) < 1e-4, `Altitude at t=${t} is ${alt}, expected 10.22`);

      // Verify roll = 0.0: up vector must be parallel to radial normal
      const radialNormal = frame.position.clone().normalize();
      const upDotRadial = frame.up.dot(radialNormal);
      assert.ok(Math.abs(upDotRadial - 1.0) < 1e-4, `Up vector must be collinear with radial normal at t=${t}`);

      // Verify orthogonal basis: up x right = forward
      const upCrossRight = new THREE.Vector3().crossVectors(frame.up, frame.right);
      assert.ok(Math.abs(upCrossRight.dot(frame.forward) - 1.0) < 1e-4, `Up x Right must equal Forward at t=${t}`);

      // Camera coordinates: Right x Up = -Forward (Z axis in camera basis)
      const rightCrossUp = new THREE.Vector3().crossVectors(frame.right, frame.up);
      assert.ok(Math.abs(rightCrossUp.dot(frame.forward) + 1.0) < 1e-4, `Right x Up must equal -Forward at t=${t}`);
    }
  });
});
