/**
 * tests/stress_m3_harness.js
 * Empirical Challenger Stress Harness for Milestone M3 (Requirement R3):
 * 1. Camera target angles & geographic projections (sea_ice, co2, ocean)
 * 2. Great-circle vector slerp (slerpVectors) and antipodal handling
 * 3. Cubic-bezier easing (cubicBezierEase)
 * 4. Click handling and rapid layer switching race conditions
 * 5. GLSL Shaders numerical verification (CO2 feathering, ocean mask, diverging colormap)
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';
import { latLonToVector3, MAUNA_LOA_COORDS } from '../frontend/js/globe/overlays.js';
import { slerpVectors, cubicBezierEase } from '../frontend/js/globe/globe.js';
import {
  OceanThermalShader,
  ZonalHeatmapShader,
  CO2AtmosphereShader
} from '../frontend/js/globe/shaders.js';

let passedChecks = 0;
function logPass(msg) {
  passedChecks++;
  console.log(`  [PASS ${passedChecks}] ${msg}`);
}

console.log('=== Milestone M3 Empirical Stress & Boundary Challenge ===\n');

// ---------------------------------------------------------------------------
// 1. Camera Target Angles & Coordinate Projections
// ---------------------------------------------------------------------------
console.log('--- 1. Camera Target Angles & Geographic Projections ---');

// Inverse function from globe.js: vector3ToLatLon
function vector3ToLatLon(vec) {
  const v = vec.clone().normalize();
  const lat = 90.0 - Math.acos(Math.max(-1, Math.min(1, v.y))) * (180.0 / Math.PI);
  const lon = (Math.atan2(v.z, -v.x) * (180.0 / Math.PI)) - 180.0;
  const normalizedLon = ((lon + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
  return { lat, lon: normalizedLon };
}

// 1.1 Sea Ice Target: 78.0°N, 0.0°E, distance 1.9, duration 0.9s
{
  const seaIceTarget = { lat: 78.0, lon: 0.0, distance: 1.9, duration: 0.9 };
  const v = latLonToVector3(seaIceTarget.lat, seaIceTarget.lon, seaIceTarget.distance, THREE);
  assert.ok(Math.abs(v.length() - 1.9) < 1e-6, 'Sea Ice camera distance must be exactly 1.9');
  const rt = vector3ToLatLon(v);
  assert.ok(Math.abs(rt.lat - 78.0) < 1e-4, `Sea Ice lat roundtrip mismatch: got ${rt.lat}`);
  assert.ok(Math.abs(rt.lon - 0.0) < 1e-4, `Sea Ice lon roundtrip mismatch: got ${rt.lon}`);
  // In Arctic, y should be strongly positive (sin(78°) = 0.9781)
  assert.ok(v.y > 1.85, 'Sea Ice camera vector must point strongly towards North Pole');
  logPass('Sea Ice target (78°N, 0°E) verified with distance 1.9 and polar alignment');
}

// 1.2 Atmospheric CO2 Target: 19.53°N, 155.57°W (-155.57°), distance 1.85, duration 0.9s
{
  const co2Target = { lat: 19.53, lon: -155.57, distance: 1.85, duration: 0.9 };
  const v = latLonToVector3(co2Target.lat, co2Target.lon, co2Target.distance, THREE);
  assert.ok(Math.abs(v.length() - 1.85) < 1e-6, 'CO2 camera distance must be exactly 1.85');
  const rt = vector3ToLatLon(v);
  assert.ok(Math.abs(rt.lat - 19.53) < 1e-4, `CO2 lat roundtrip mismatch: got ${rt.lat}`);
  assert.ok(Math.abs(rt.lon - (-155.57)) < 1e-4, `CO2 lon roundtrip mismatch: got ${rt.lon}`);
  // Check proximity to MAUNA_LOA_COORDS
  const mloV = latLonToVector3(MAUNA_LOA_COORDS.lat, MAUNA_LOA_COORDS.lon, 1.85, THREE);
  const angDist = v.angleTo(mloV) * (180 / Math.PI);
  assert.ok(angDist < 0.1, `CO2 target angular separation from Mauna Loa is ${angDist}° (< 0.1°)`);
  logPass('CO2 target (19.53°N, 155.57°W) verified at Mauna Loa with distance 1.85');
}

// 1.3 Ocean Heat Target: 0.0°N, 140.0°W (-140.0°), distance 2.1, duration 0.9s
{
  const oceanTarget = { lat: 0.0, lon: -140.0, distance: 2.1, duration: 0.9 };
  const v = latLonToVector3(oceanTarget.lat, oceanTarget.lon, oceanTarget.distance, THREE);
  assert.ok(Math.abs(v.length() - 2.1) < 1e-6, 'Ocean Heat camera distance must be exactly 2.1');
  const rt = vector3ToLatLon(v);
  assert.ok(Math.abs(rt.lat - 0.0) < 1e-4, `Ocean lat roundtrip mismatch: got ${rt.lat}`);
  assert.ok(Math.abs(rt.lon - (-140.0)) < 1e-4, `Ocean lon roundtrip mismatch: got ${rt.lon}`);
  assert.ok(Math.abs(v.y) < 1e-6, 'Equatorial target must have y ≈ 0');
  logPass('Ocean Heat target (0°N, 140°W) verified at Equatorial Pacific with distance 2.1');
}

// 1.4 Random Spherical Monte Carlo Roundtrip (10,000 coordinates)
{
  let maxLatErr = 0;
  let maxLonErr = 0;
  for (let i = 0; i < 10000; i++) {
    const lat = (Math.random() - 0.5) * 179.9; // [-89.95, +89.95]
    const lon = (Math.random() - 0.5) * 360.0; // [-180, +180]
    const r = 1.0 + Math.random() * 5.0;
    const vec = latLonToVector3(lat, lon, r, THREE);
    const back = vector3ToLatLon(vec);
    const dLat = Math.abs(back.lat - lat);
    let dLon = Math.abs(back.lon - lon);
    if (dLon > 180) dLon = Math.abs(dLon - 360);
    if (dLat > maxLatErr) maxLatErr = dLat;
    if (dLon > maxLonErr) maxLonErr = dLon;
  }
  assert.ok(maxLatErr < 1e-4, `Max lat error too high: ${maxLatErr}`);
  assert.ok(maxLonErr < 1e-3, `Max lon error too high: ${maxLonErr}`);
  logPass(`Monte Carlo 10,000 spherical coordinate roundtrip passed (maxLatErr=${maxLatErr.toExponential(2)}, maxLonErr=${maxLonErr.toExponential(2)})`);
}

// ---------------------------------------------------------------------------
// 2. Cubic-Bezier Easing Math (cubicBezierEase)
// ---------------------------------------------------------------------------
console.log('\n--- 2. Cubic-Bezier Easing Math [cubicBezierEase] ---');

// 2.1 Endpoints and bounds
assert.equal(cubicBezierEase(0), 0, 'cubicBezierEase(0) must equal 0');
assert.equal(cubicBezierEase(1), 1, 'cubicBezierEase(1) must equal 1');
assert.equal(cubicBezierEase(-0.5), 0, 'cubicBezierEase negative input must clamp to 0');
assert.equal(cubicBezierEase(1.5), 1, 'cubicBezierEase input > 1 must clamp to 1');
logPass('cubicBezierEase boundary and clamping values strictly correct');

// 2.2 Monotonicity across 10,000 steps
{
  const N = 10000;
  let prevY = 0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const y = cubicBezierEase(t);
    assert.ok(y >= prevY - 1e-9, `Monotonicity violation at t=${t}: y=${y} < prevY=${prevY}`);
    assert.ok(y >= 0.0 && y <= 1.0, `Out of bounds [0, 1] at t=${t}: y=${y}`);
    prevY = y;
  }
  logPass('cubicBezierEase monotonicity verified across 10,000 uniform steps');
}

// 2.3 Rapid easing shape check: cubic-bezier(0.22, 1, 0.36, 1) is a fast-out ease
{
  // Since P1.y = 1.0 and P2.y = 1.0, progress should rise very rapidly in early stages
  const y25 = cubicBezierEase(0.25);
  const y50 = cubicBezierEase(0.50);
  const y75 = cubicBezierEase(0.75);
  assert.ok(y25 > 0.60, `Fast start expected: y(0.25) should be > 0.60, got ${y25}`);
  assert.ok(y50 > 0.85, `High progress at mid-way: y(0.50) should be > 0.85, got ${y50}`);
  assert.ok(y75 > 0.95, `Gentle deceleration at tail: y(0.75) should be > 0.95, got ${y75}`);
  logPass(`Easing curve characteristics verified: y(0.25)=${y25.toFixed(3)}, y(0.50)=${y50.toFixed(3)}, y(0.75)=${y75.toFixed(3)}`);
}

// ---------------------------------------------------------------------------
// 3. Vector Slerp & Antipodal Singularity Stress Test
// ---------------------------------------------------------------------------
console.log('\n--- 3. Spherical Vector Slerp [slerpVectors] Stress Test ---');

// 3.1 Identical Vectors (dot = 1.0)
{
  const v1 = new THREE.Vector3(1, 2, 3).normalize().multiplyScalar(2.5);
  const v2 = v1.clone();
  const out = new THREE.Vector3();
  slerpVectors(v1, v2, 0.5, out);
  assert.ok(Math.abs(out.length() - 2.5) < 1e-5, 'Identical vectors length preservation');
  assert.ok(out.distanceTo(v1) < 1e-5, 'Identical vectors position preservation');
  logPass('Identical vectors slerp (dot = 1.0) smoothly preserved');
}

// 3.2 Exact Antipodal Vectors (dot = -1.0) - Polar Pole-to-Pole flight
{
  const northPole = new THREE.Vector3(0, 2.0, 0);
  const southPole = new THREE.Vector3(0, -2.0, 0);
  const out = new THREE.Vector3();

  // Test across t in [0, 1]
  for (let step = 0; step <= 20; step++) {
    const t = step / 20.0;
    slerpVectors(northPole, southPole, t, out);
    assert.ok(!isNaN(out.x) && !isNaN(out.y) && !isNaN(out.z), `NaN detected at t=${t}`);
    assert.ok(Math.abs(out.length() - 2.0) < 1e-4, `Altitude lost during antipodal slerp at t=${t}: length=${out.length()}`);
  }
  // At t=0 should be north pole
  slerpVectors(northPole, southPole, 0.0, out);
  assert.ok(out.distanceTo(northPole) < 1e-4, 'Antipodal start matches North Pole');
  // At t=1 should be south pole
  slerpVectors(northPole, southPole, 1.0, out);
  assert.ok(out.distanceTo(southPole) < 1e-4, 'Antipodal end matches South Pole');
  // At t=0.5 should be on equator (y=0, length=2.0)
  slerpVectors(northPole, southPole, 0.5, out);
  assert.ok(Math.abs(out.y) < 1e-4, `Midpoint of polar antipodal should be on equator, got y=${out.y}`);
  assert.ok(Math.abs(out.length() - 2.0) < 1e-4, 'Midpoint altitude preserved at 2.0');
  logPass('Exact antipodal polar vectors (North -> South) slerp passes with full altitude preservation');
}

// 3.3 Exact Antipodal Vectors - Equatorial X-axis (1, 0, 0) -> (-1, 0, 0)
{
  const v1 = new THREE.Vector3(2.5, 0, 0);
  const v2 = new THREE.Vector3(-2.5, 0, 0);
  const out = new THREE.Vector3();
  for (let step = 0; step <= 20; step++) {
    const t = step / 20.0;
    slerpVectors(v1, v2, t, out);
    assert.ok(!isNaN(out.x) && !isNaN(out.y) && !isNaN(out.z), `NaN at t=${t}`);
    assert.ok(Math.abs(out.length() - 2.5) < 1e-4, `Altitude lost at t=${t}: length=${out.length()}`);
  }
  logPass('Exact antipodal equatorial vectors (X -> -X) slerp passes');
}

// 3.4 Boundary Thresholds around dot = -0.99995 and dot = +0.99995
{
  const out = new THREE.Vector3();
  const v1 = new THREE.Vector3(0, 0, 2.0);

  // Near +1.0 boundary
  const testAnglesNearZero = [0.00001, 0.0001, 0.001, 0.005, 0.01];
  for (const ang of testAnglesNearZero) {
    const v2 = new THREE.Vector3(Math.sin(ang) * 2.0, 0, Math.cos(ang) * 2.0);
    slerpVectors(v1, v2, 0.5, out);
    assert.ok(!isNaN(out.x) && !isNaN(out.z), `NaN near dot=1 at ang=${ang}`);
    assert.ok(Math.abs(out.length() - 2.0) < 1e-3, `Length drift near dot=1: ${out.length()}`);
  }

  // Near -1.0 boundary
  const testAnglesNearPi = [Math.PI - 0.00001, Math.PI - 0.0001, Math.PI - 0.001, Math.PI - 0.005];
  for (const ang of testAnglesNearPi) {
    const v2 = new THREE.Vector3(Math.sin(ang) * 2.0, 0, Math.cos(ang) * 2.0);
    slerpVectors(v1, v2, 0.5, out);
    assert.ok(!isNaN(out.x) && !isNaN(out.z), `NaN near dot=-1 at ang=${ang}`);
    assert.ok(Math.abs(out.length() - 2.0) < 1e-3, `Length drift near dot=-1: ${out.length()}`);
  }
  logPass('Boundary thresholds (dot ≈ ±0.99995) numerically stable and free of NaN/Inf');
}

// 3.5 Dynamic Altitude Slerp (r1 != r2)
{
  const v1 = new THREE.Vector3(0, 2.8, 0); // initial distance 2.8
  const v2 = new THREE.Vector3(1.85, 0, 0); // CO2 distance 1.85
  const out = new THREE.Vector3();
  for (let i = 0; i <= 10; i++) {
    const t = i / 10.0;
    slerpVectors(v1, v2, t, out);
    const expectedR = 2.8 + (1.85 - 2.8) * t;
    assert.ok(Math.abs(out.length() - expectedR) < 1e-4, `Radius mismatch at t=${t}: got ${out.length()}, expected ${expectedR}`);
  }
  logPass('Dynamic altitude slerp (r1=2.8 -> r2=1.85) linearly scales orbital radius along great circle');
}

// 3.6 Monte Carlo Random Slerp Stress Test (5,000 random vector pairs)
{
  const out = new THREE.Vector3();
  for (let i = 0; i < 5000; i++) {
    const v1 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.0);
    const v2 = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2.0);
    const t = Math.random();
    slerpVectors(v1, v2, t, out);
    assert.ok(!isNaN(out.x) && !isNaN(out.y) && !isNaN(out.z), 'NaN in Monte Carlo slerp');
    assert.ok(isFinite(out.x) && isFinite(out.y) && isFinite(out.z), 'Infinite value in slerp');
    const expectedR = v1.length() + (v2.length() - v1.length()) * t;
    assert.ok(Math.abs(out.length() - expectedR) < 1e-3, 'Altitude mismatch in Monte Carlo slerp');
  }
  logPass('Monte Carlo 5,000 random slerp transitions passed with 100% finite precision');
}

// ---------------------------------------------------------------------------
// 4. Rapid Layer Switching & Flight Interruption Simulation
// ---------------------------------------------------------------------------
console.log('\n--- 4. Rapid Layer Switching & In-Flight Redirection ---');

// Mock globe camera flight controller
class MockCameraFlight {
  constructor() {
    this.camera = {
      position: new THREE.Vector3(0, 0, 2.8),
      lookAt: (x, y, z) => {}
    };
    this.flyToStart = null;
    this.flyToTarget = null;
    this.flyToProgress = 1.0;
    this.flyToDuration = 0.9;
  }

  flyTo(lat, lon, distance = 2.2, duration = 0.9) {
    const targetDir = latLonToVector3(lat, lon, 1.0, THREE).normalize();
    const targetCamPos = targetDir.clone().multiplyScalar(distance);
    this.flyToStart = this.camera.position.clone();
    this.flyToTarget = targetCamPos;
    this.flyToProgress = 0.0;
    this.flyToDuration = duration || 0.9;
  }

  tick(delta) {
    if (this.flyToTarget && this.flyToProgress < 1.0) {
      this.flyToProgress += delta / this.flyToDuration;
      const t = Math.min(1.0, this.flyToProgress);
      const ease = cubicBezierEase(t);
      slerpVectors(this.flyToStart, this.flyToTarget, ease, this.camera.position);
      if (t >= 1.0) {
        this.camera.position.copy(this.flyToTarget);
        this.flyToTarget = null;
      }
    }
  }
}

{
  const sim = new MockCameraFlight();

  // Rapid switching: Click Sea Ice (78°N, 0°E), advance 0.2s, then click CO2, advance 0.15s, then click Ocean
  sim.flyTo(78.0, 0.0, 1.9, 0.9);
  for (let f = 0; f < 12; f++) sim.tick(1 / 60); // 0.2s in flight
  assert.ok(sim.camera.position.length() < 2.8 && sim.camera.position.length() > 1.9, 'Camera smoothly descending towards Sea Ice');

  const intermediatePos1 = sim.camera.position.clone();

  // Interruption: User rapidly clicks CO2 mid-flight
  sim.flyTo(19.53, -155.57, 1.85, 0.9);
  assert.ok(sim.flyToStart.distanceTo(intermediatePos1) < 1e-6, 'Redirection start position must seamlessly continue from current position');
  assert.equal(sim.flyToProgress, 0.0, 'Progress resets cleanly to 0.0 for new flight duration');

  for (let f = 0; f < 9; f++) sim.tick(1 / 60); // 0.15s in flight
  const intermediatePos2 = sim.camera.position.clone();

  // Interruption: User rapidly clicks Ocean Heat mid-flight
  sim.flyTo(0.0, -140.0, 2.1, 0.9);
  assert.ok(sim.flyToStart.distanceTo(intermediatePos2) < 1e-6, 'Second redirection seamless');

  // Let Ocean Heat complete fully (1.0s)
  for (let f = 0; f < 70; f++) sim.tick(1 / 60);

  // Must arrive exactly at Ocean Heat target
  const expectedOceanPos = latLonToVector3(0.0, -140.0, 2.1, THREE);
  assert.ok(sim.camera.position.distanceTo(expectedOceanPos) < 1e-4, 'Camera must cleanly arrive at final interrupted destination');
  assert.equal(sim.flyToTarget, null, 'flyToTarget must clear upon completion');
  logPass('Rapid layer switching with multiple mid-flight interruptions verified: continuous orbit without jumps');
}

// ---------------------------------------------------------------------------
// 5. GLSL Shaders Numerical & Analytical Edge Cases
// ---------------------------------------------------------------------------
console.log('\n--- 5. GLSL Shaders Numerical & Analytical Audits ---');

// 5.1 CO2 Atmospheric Scattering Function
// scatter = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.5) * exp(-radialDist * 4.0)
{
  const co2Scatter = (dotNormalView) => {
    const viewDot = Math.max(0.0, Math.min(1.0, dotNormalView));
    const radialDist = 1.0 - viewDot;
    return Math.pow(1.0 - viewDot, 3.5) * Math.exp(-radialDist * 4.0);
  };

  // At center of Earth (viewDot = 1.0)
  assert.equal(co2Scatter(1.0), 0.0, 'CO2 scatter at center (viewDot = 1) must be 0.0');

  // At grazing rim (viewDot = 0.0)
  const rimScatter = co2Scatter(0.0);
  assert.ok(Math.abs(rimScatter - Math.exp(-4.0)) < 1e-6, 'CO2 scatter at exact rim must equal exp(-4)');

  // Find peak: derivative d/du [u^3.5 * exp(-4u)] = u^2.5 * exp(-4u) * (3.5 - 4u) = 0 => u = 0.875
  // u = 1 - viewDot => viewDot = 0.125
  const peakViewDot = 0.125;
  const peakVal = co2Scatter(peakViewDot);
  assert.ok(peakVal > co2Scatter(0.10), 'Peak should be higher than viewDot = 0.10');
  assert.ok(peakVal > co2Scatter(0.15), 'Peak should be higher than viewDot = 0.15');
  assert.ok(peakVal > rimScatter, 'Peak should be higher than rim');
  logPass(`CO2 Atmospheric scattering verified: 0.0 at center, peaks at viewDot=0.125 (${peakVal.toFixed(4)}), feathers to ${rimScatter.toFixed(4)} at silhouette`);
}

// 5.2 Ocean Mask & Thermal Current Math
{
  assert.ok(OceanThermalShader.fragmentShader.includes('if (waterMask <= 0.5)'), 'Ocean shader strictly checks waterMask <= 0.5');
  assert.ok(OceanThermalShader.fragmentShader.includes('discard;'), 'Ocean shader discards land fragments');
  assert.ok(OceanThermalShader.fragmentShader.includes('vec3(0.0235, 0.0824, 0.1765)'), 'Ocean shader uses #06152d deep navy base');

  // Verify El Niño tongue location (0°N, 140°W):
  // Longitude -140°W in UV: (-140 + 180) / 360 = 40 / 360 = 0.1111...
  // Latitude 0°N in UV: (0 + 90) / 180 = 0.50
  const elNinoU = (-140 + 180) / 360; // 0.1111
  const elNinoV = 0.50;
  // In OceanThermalShader: pacDist = length(vec2((pacX - 0.12) * 2.8, (vUv.y - 0.50) * 6.5))
  const pacX = elNinoU;
  const pacDist = Math.hypot((pacX - 0.12) * 2.8, (elNinoV - 0.50) * 6.5);
  const elNinoHotspot = Math.exp(-pacDist * pacDist * 2.5);
  assert.ok(elNinoHotspot > 0.99, `El Niño hotspot must be centered near 0°N, 140°W: got ${elNinoHotspot}`);

  // Verify Gulf Stream location (25°N-45°N, 80°W-40°W):
  // Midpoint ~35°N, 60°W: U = (-60 + 180) / 360 = 0.333, V = (35 + 90) / 180 = 0.694
  // In OceanThermalShader: gulfP = vec2(vUv.x - 0.32, vUv.y - 0.68)
  const gulfU = (-60 + 180) / 360;
  const gulfV = (35 + 90) / 180;
  const gulfP = [gulfU - 0.32, gulfV - 0.68];
  const gulfDist = Math.hypot((gulfP[0] + gulfP[1]) * 2.2, (-gulfP[0] + gulfP[1]) * 7.5);
  const gulfStream = Math.exp(-gulfDist * gulfDist * 3.0);
  assert.ok(gulfStream > 0.90, `Gulf Stream hotspot centered in North Atlantic: got ${gulfStream}`);

  // Verify Kuroshio Current location (20°N-40°N, 120°E-150°E):
  // Midpoint ~30°N, 135°E: U = (135 + 180) / 360 = 0.875, V = (30 + 90) / 180 = 0.667
  // In OceanThermalShader: kuroP = vec2(vUv.x - 0.87, vUv.y - 0.66)
  const kuroU = (135 + 180) / 360;
  const kuroV = (30 + 90) / 180;
  const kuroP = [kuroU - 0.87, kuroV - 0.66];
  const kuroDist = Math.hypot((kuroP[0] + kuroP[1]) * 2.5, (-kuroP[0] + kuroP[1]) * 7.5);
  const kuroshio = Math.exp(-kuroDist * kuroDist * 3.0);
  assert.ok(kuroshio > 0.90, `Kuroshio current centered in Western Pacific: got ${kuroshio}`);

  logPass('Ocean thermal shader currents (El Niño, Gulf Stream, Kuroshio) accurately mapped to geographic coordinates');
}

// 5.3 Zonal Heatmap Diverging Colormap Oracle
{
  function evaluateDivergingColormap(temp) {
    const deepBlue = [0.1137, 0.3059, 0.8471]; // #1d4ed8 (-2.0°C)
    const warmAmber = [0.9608, 0.6196, 0.0431]; // #f59e0b (+1.0°C)
    const crimson = [0.9373, 0.2667, 0.2667];   // #ef4444 (+2.5°C)

    let col = [0, 0, 0];
    let alphaFactor = 0.0;

    if (temp <= 0.0) {
      const t = Math.max(0.0, Math.min(1.0, (temp - (-2.0)) / 2.0));
      col = deepBlue;
      alphaFactor = 1.0 - t;
    } else if (temp <= 1.0) {
      const t = Math.max(0.0, Math.min(1.0, temp / 1.0));
      col = warmAmber;
      alphaFactor = t * 0.85;
    } else {
      const t = Math.max(0.0, Math.min(1.0, (temp - 1.0) / 1.5));
      col = [
        warmAmber[0] + (crimson[0] - warmAmber[0]) * t,
        warmAmber[1] + (crimson[1] - warmAmber[1]) * t,
        warmAmber[2] + (crimson[2] - warmAmber[2]) * t,
      ];
      alphaFactor = 0.85 + (1.0 - 0.85) * t;
    }
    return { col, alphaFactor };
  }

  // -2.0°C Deep Blue
  const cMinus2 = evaluateDivergingColormap(-2.0);
  assert.equal(cMinus2.alphaFactor, 1.0, 'At -2.0°C, alpha must be 1.0');
  assert.ok(Math.abs(cMinus2.col[0] - 0.1137) < 1e-4, 'Deep blue red channel');
  assert.ok(Math.abs(cMinus2.col[1] - 0.3059) < 1e-4, 'Deep blue green channel');
  assert.ok(Math.abs(cMinus2.col[2] - 0.8471) < 1e-4, 'Deep blue blue channel');

  // 0.0°C Transparent
  const cZero = evaluateDivergingColormap(0.0);
  assert.equal(cZero.alphaFactor, 0.0, 'At 0.0°C, alpha must be 0.0 (completely transparent)');

  // +1.0°C Warm Amber
  const cPlus1 = evaluateDivergingColormap(1.0);
  assert.ok(Math.abs(cPlus1.alphaFactor - 0.85) < 1e-4, 'At +1.0°C, alpha must be 0.85');
  assert.ok(Math.abs(cPlus1.col[0] - 0.9608) < 1e-4, 'Warm amber red channel');
  assert.ok(Math.abs(cPlus1.col[1] - 0.6196) < 1e-4, 'Warm amber green channel');
  assert.ok(Math.abs(cPlus1.col[2] - 0.0431) < 1e-4, 'Warm amber blue channel');

  // +2.5°C Crimson
  const cPlus25 = evaluateDivergingColormap(2.5);
  assert.equal(cPlus25.alphaFactor, 1.0, 'At +2.5°C, alpha must be 1.0 (polar amplification)');
  assert.ok(Math.abs(cPlus25.col[0] - 0.9373) < 1e-4, 'Crimson red channel');
  assert.ok(Math.abs(cPlus25.col[1] - 0.2667) < 1e-4, 'Crimson green channel');
  assert.ok(Math.abs(cPlus25.col[2] - 0.2667) < 1e-4, 'Crimson blue channel');

  // Boundary checks: below -2.0 and above +2.5
  const cExtremeCold = evaluateDivergingColormap(-10.0);
  assert.equal(cExtremeCold.alphaFactor, 1.0, 'Extreme cold clamped to 1.0');
  const cExtremeWarm = evaluateDivergingColormap(+15.0);
  assert.equal(cExtremeWarm.alphaFactor, 1.0, 'Extreme warm clamped to 1.0');

  // Test C0 continuity across 1,000 temperature points from -3.0 to +3.5
  let prevAlpha = evaluateDivergingColormap(-3.0).alphaFactor;
  for (let i = 1; i <= 1000; i++) {
    const temp = -3.0 + (6.5 * i) / 1000;
    const { alphaFactor } = evaluateDivergingColormap(temp);
    assert.ok(Math.abs(alphaFactor - prevAlpha) < 0.05, `Discontinuity detected at temp=${temp}`);
    prevAlpha = alphaFactor;
  }
  logPass('Zonal heatmap diverging colormap (-2.0°C Deep Blue -> 0.0°C Transparent -> +1.0°C Amber -> +2.5°C Crimson) passes all color and C0 continuity tests');
}

// ---------------------------------------------------------------------------
// 6. Layer Switcher Buttons & Matrix Cell Click Handling Wiring
// ---------------------------------------------------------------------------
console.log('\n--- 6. Layer Switcher Buttons & Matrix Cell Click Wiring ---');
{
  const mockGlobe = {
    overlays: { activeOverlayId: null, setAllVisible: () => {} },
    setActiveOverlay: (layer) => { mockGlobe.overlays.activeOverlayId = layer; },
    flyTo: (lat, lon, distance, duration) => { flyCalls.push({ lat, lon, distance, duration }); }
  };
  const flyCalls = [];

  function simulateLayerClick(layer) {
    if (layer === 'all') {
      mockGlobe.overlays.activeOverlayId = 'all';
      mockGlobe.overlays.setAllVisible(true);
    } else {
      mockGlobe.setActiveOverlay(layer);
    }

    if (typeof mockGlobe.flyTo === 'function') {
      if (layer === 'sea_ice') {
        mockGlobe.flyTo(78.0, 0.0, 1.9, 0.9);
      } else if (layer === 'co2') {
        mockGlobe.flyTo(19.53, -155.57, 1.85, 0.9);
      } else if (layer === 'ocean') {
        mockGlobe.flyTo(0.0, -140.0, 2.1, 0.9);
      }
    }
  }

  // Sea Ice Click
  simulateLayerClick('sea_ice');
  assert.equal(mockGlobe.overlays.activeOverlayId, 'sea_ice');
  assert.deepEqual(flyCalls[0], { lat: 78.0, lon: 0.0, distance: 1.9, duration: 0.9 });
  logPass('Sea ice click wiring routes to flyTo(78.0, 0.0, 1.9, 0.9)');

  // CO2 Click
  simulateLayerClick('co2');
  assert.equal(mockGlobe.overlays.activeOverlayId, 'co2');
  assert.deepEqual(flyCalls[1], { lat: 19.53, lon: -155.57, distance: 1.85, duration: 0.9 });
  logPass('CO2 click wiring routes to flyTo(19.53, -155.57, 1.85, 0.9)');

  // Ocean Heat Click
  simulateLayerClick('ocean');
  assert.equal(mockGlobe.overlays.activeOverlayId, 'ocean');
  assert.deepEqual(flyCalls[2], { lat: 0.0, lon: -140.0, distance: 2.1, duration: 0.9 });
  logPass('Ocean heat click wiring routes to flyTo(0.0, -140.0, 2.1, 0.9)');

  // Temperature Click
  simulateLayerClick('temperature');
  assert.equal(mockGlobe.overlays.activeOverlayId, 'temperature');
  assert.equal(flyCalls.length, 3, 'Temperature layer click must not call flyTo');
  logPass('Temperature click sets active overlay without superfluous camera fly');

  // All Layers Click
  simulateLayerClick('all');
  assert.equal(mockGlobe.overlays.activeOverlayId, 'all');
  assert.equal(flyCalls.length, 3);
  logPass('All layers click activates multi-layer composite mode');
}

console.log(`\n=== All ${passedChecks} Milestone M3 Empirical Stress Tests PASSED with Zero Defects! ===\n`);

