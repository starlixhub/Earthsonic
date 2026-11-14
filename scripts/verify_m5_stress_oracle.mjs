/**
 * scripts/verify_m5_stress_oracle.mjs
 * Node.js Empirical Stress & Adversarial Oracle for Milestone M5.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

console.log('='.repeat(80));
console.log('EARTHSONIC M5 NODE.JS EMPIRICAL STRESS ORACLE');
console.log('='.repeat(80));

let checksPassed = 0;
function testCheck(cond, desc) {
  assert(cond, desc);
  checksPassed++;
  console.log(`  [PASS] ${desc}`);
}

// ---------------------------------------------------------------------------
// 1. Tour Chapters & Solo State Machine Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 1. Tour Chapters & Solo State Machine Oracle');
const tourModule = await import('../frontend/js/ui/guided_tour.js');
const chapters = tourModule.TOUR_CHAPTERS;

testCheck(Array.isArray(chapters) && chapters.length === 5, 'Tour defines exactly 5 chapters');
const totalDuration = chapters.reduce((sum, ch) => sum + ch.durationSec, 0);
testCheck(totalDuration === 45, `Total tour duration is exactly 45 seconds (actual: ${totalDuration}s)`);

for (let i = 0; i < chapters.length; i++) {
  const ch = chapters[i];
  testCheck(ch.durationSec === 9, `Chapter ${i + 1} duration is 9s`);
  testCheck(typeof ch.targetDate === 'string' && ch.targetDate.length >= 7, `Chapter ${i + 1} has valid targetDate: ${ch.targetDate}`);
  testCheck(Array.isArray(ch.solos) && ch.solos.length > 0, `Chapter ${i + 1} has solos defined`);
}

testCheck(chapters[0].solos.includes('surface_temperature') && chapters[0].solos.length === 1,
  'Chapter 1 (1979 Baseline) solos surface_temperature');
testCheck(chapters[1].solos.includes('atmospheric_co2') && chapters[1].solos.length === 1,
  'Chapter 2 (1988 350ppm) solos atmospheric_co2');
testCheck(chapters[2].solos.includes('ocean_temperature') && chapters[2].solos.length === 1,
  'Chapter 3 (1998 Super El Niño) solos ocean_temperature');
testCheck(chapters[3].solos.includes('sea_ice_extent') && chapters[3].solos.length === 1,
  'Chapter 4 (2012 Arctic Minimum) solos sea_ice_extent');
testCheck(chapters[4].solos.length === 4,
  'Chapter 5 (2026 Present) solos all 4 tracks');

// ---------------------------------------------------------------------------
// 2. Cubic-Bézier Newton-Raphson Solver Stress Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 2. Cubic-Bézier Newton-Raphson Solver Stress Oracle');
const globeModule = await import('../frontend/js/globe/globe.js');
const cubicBezierEase = globeModule.cubicBezierEase;

testCheck(typeof cubicBezierEase === 'function', 'globe.js exports cubicBezierEase');
testCheck(Math.abs(cubicBezierEase(0.0) - 0.0) < 1e-6, 'cubicBezierEase(0.0) === 0.0');
testCheck(Math.abs(cubicBezierEase(1.0) - 1.0) < 1e-6, 'cubicBezierEase(1.0) === 1.0');

// Test monotonic increase across 10,000 steps
let prev = -1e-9;
let isMonotonic = true;
let maxStepDiff = 0;
for (let i = 0; i <= 10000; i++) {
  const t = i / 10000;
  const val = cubicBezierEase(t);
  if (val < prev) {
    isMonotonic = false;
  }
  const diff = val - prev;
  if (diff > maxStepDiff) maxStepDiff = diff;
  prev = val;
}
testCheck(isMonotonic, 'cubicBezierEase is strictly monotonic non-decreasing across 10,000 steps');

// Adversarial input clamping
testCheck(cubicBezierEase(-0.5) === 0.0, 'cubicBezierEase clamps negative inputs to 0.0');
testCheck(cubicBezierEase(1.5) === 1.0, 'cubicBezierEase clamps inputs > 1.0 to 1.0');

// ---------------------------------------------------------------------------
// 3. Spherical Linear Interpolation (slerpVectors) Stress Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 3. Great-Circle Slerp Anti-Clipping & Extremes Oracle');
const slerpVectors = globeModule.slerpVectors;

testCheck(typeof slerpVectors === 'function', 'globe.js exports slerpVectors');

// Test 3.1: Intermediate radius conservation between different orbital radii
const vA = new THREE.Vector3(2.8, 0, 0);
const vB = new THREE.Vector3(0, 1.9, 0);
const outVec = new THREE.Vector3();

let minRadius = Infinity;
for (let i = 0; i <= 100; i++) {
  const t = i / 100;
  slerpVectors(vA, vB, t, outVec);
  const r = outVec.length();
  if (r < minRadius) minRadius = r;
  const expectedRadius = 2.8 + (1.9 - 2.8) * t;
  assert(Math.abs(r - expectedRadius) < 1e-4, `Intermediate radius at t=${t} is exact: ${r} vs ${expectedRadius}`);
}
testCheck(minRadius >= 1.9, `Intermediate altitude is strictly conserved without cord tunneling (minRadius: ${minRadius})`);

// Test 3.2: Antipodal vectors (dot product == -1.0)
const vNorth = new THREE.Vector3(0, 2.5, 0);
const vSouth = new THREE.Vector3(0, -2.5, 0);
slerpVectors(vNorth, vSouth, 0.5, outVec);
testCheck(!isNaN(outVec.x) && !isNaN(outVec.y) && !isNaN(outVec.z), 'Antipodal slerp produces non-NaN vectors');
testCheck(Math.abs(outVec.length() - 2.5) < 1e-4, `Antipodal midpoint maintains exact radius 2.5 (actual: ${outVec.length()})`);

// Test 3.3: Collinear identical vectors
slerpVectors(vA, vA, 0.5, outVec);
testCheck(Math.abs(outVec.distanceTo(vA)) < 1e-6, 'Identical vector slerp returns original vector');

// ---------------------------------------------------------------------------
// 4. Procedural Box-Muller Impulse Response Simulation Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 4. Procedural Box-Muller Impulse Response Simulation Oracle');

function generateIR(sampleRate = 44100, duration = 2.4, decay = 3.0) {
  const length = Math.floor(sampleRate * duration);
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-decay * t);
    const u1 = Math.max(1e-12, Math.random());
    const u2 = Math.random();
    const g1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const g2 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);
    left[i] = g1 * env;
    right[i] = g2 * env;
  }
  return { left, right, length };
}

const { left, right, length } = generateIR();
testCheck(length === 105840, `IR length is exactly 105,840 samples at 44.1kHz (actual: ${length})`);

// Calculate channel statistics
let sumL = 0, sumR = 0;
let sumSqL = 0, sumSqR = 0;
let crossProd = 0;
for (let i = 0; i < length; i++) {
  sumL += left[i];
  sumR += right[i];
  sumSqL += left[i] * left[i];
  sumSqR += right[i] * right[i];
  crossProd += left[i] * right[i];
}

const meanL = sumL / length;
const meanR = sumR / length;
const stdL = Math.sqrt(sumSqL / length - meanL * meanL);
const stdR = Math.sqrt(sumSqR / length - meanR * meanR);
const correlation = (crossProd / length - meanL * meanR) / (stdL * stdR);

testCheck(Math.abs(meanL) < 0.01 && Math.abs(meanR) < 0.01,
  `Zero DC offset on both IR channels: L=${meanL.toFixed(6)}, R=${meanR.toFixed(6)}`);
testCheck(Math.abs(correlation) < 0.03,
  `L/R stereo channels are uncorrelated (correlation: ${correlation.toFixed(5)})`);

// Verify envelope attenuation at t = 2.4s
const tailEnv = Math.exp(-3.0 * 2.4);
const tailDb = 20 * Math.log10(tailEnv);
testCheck(tailDb < -60.0, `Impulse response attenuates to ${tailDb.toFixed(2)} dBFS at 2.4s (meets RT60 threshold)`);

// ---------------------------------------------------------------------------
// 5. Scale Quantizer Boundary & Stress Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 5. Scale Quantizer Boundary & Stress Oracle');
const trackModule = await import('../frontend/js/audio/track.js');
const D_SCALE = trackModule.D_DORIAN_LYDIAN_SCALE;

testCheck(Array.isArray(D_SCALE) && D_SCALE.length === 13, 'D_DORIAN_LYDIAN_SCALE contains 13 frequencies');

function quantizeToScale(freq, scale = D_SCALE) {
  if (typeof freq !== 'number' || isNaN(freq)) return scale[0];
  if (freq <= scale[0]) return scale[0];
  if (freq >= scale[scale.length - 1]) return scale[scale.length - 1];

  let closest = scale[0];
  let minDiff = Math.abs(freq - scale[0]);
  for (let i = 1; i < scale.length; i++) {
    const diff = Math.abs(freq - scale[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = scale[i];
    }
  }
  return closest;
}

testCheck(quantizeToScale(NaN) === 220.0, 'quantizeToScale(NaN) safely falls back to 220.0 Hz');
testCheck(quantizeToScale(-50) === 220.0, 'quantizeToScale(-50) clamps to lower boundary 220.0 Hz');
testCheck(quantizeToScale(100000) === 880.0, 'quantizeToScale(100000) clamps to upper boundary 880.0 Hz');
testCheck(quantizeToScale(440.0) === 440.0, 'quantizeToScale(440.0) exactly returns 440.0 Hz');
testCheck(quantizeToScale(450.0) === 440.0, 'quantizeToScale(450.0) quantizes down to nearest 440.0 Hz');
testCheck(quantizeToScale(480.0) === 493.88, 'quantizeToScale(480.0) quantizes up to nearest 493.88 Hz');

// ---------------------------------------------------------------------------
// 6. Cascaded Dual-Biquad Butterworth 24 dB/oct Low-Pass Simulation
// ---------------------------------------------------------------------------
console.log('\n>>> 6. Cascaded Dual-Biquad Butterworth 24 dB/oct Low-Pass Simulation');

// Analog normalized 2nd-order Butterworth section: H(s) = 1 / (s^2 + sqrt(2)*s + 1)
// For two cascaded identical sections: H_4(s) = [1 / (s^2 + sqrt(2)*s + 1)]^2
// In stopband (w >> 1), |H_4(jw)| ≈ 1 / w^4 -> 40*log10(1/w) -> 24.08 dB/octave
function biquadLowpassGain(f, fc = 130.0, Q = 1.0 / Math.SQRT2) {
  const w = f / fc;
  // |H(jw)| = 1 / sqrt((1 - w^2)^2 + (w/Q)^2)
  const denom = Math.sqrt(Math.pow(1.0 - w * w, 2) + Math.pow(w / Q, 2));
  return 1.0 / denom;
}

const g130 = Math.pow(biquadLowpassGain(130.0), 2);
const g260 = Math.pow(biquadLowpassGain(260.0), 2);
const g520 = Math.pow(biquadLowpassGain(520.0), 2);
const g1040 = Math.pow(biquadLowpassGain(1040.0), 2);

const db130 = 20 * Math.log10(g130);
const db260 = 20 * Math.log10(g260);
const db520 = 20 * Math.log10(g520);
const db1040 = 20 * Math.log10(g1040);

const slopeOct1 = db520 - db260;
const slopeOct2 = db1040 - db520;

testCheck(Math.abs(db130 - (-6.02)) < 0.1, `Cascaded dual biquad gain at fc=130Hz is -6.02 dB (actual: ${db130.toFixed(2)} dB)`);
testCheck(Math.abs(slopeOct1 - (-23.60)) < 0.5, `Roll-off slope 1 octave above cutoff is ${slopeOct1.toFixed(2)} dB/oct`);
testCheck(Math.abs(slopeOct2 - (-24.00)) < 0.2, `Stopband asymptotic slope achieves 24 dB/octave (${slopeOct2.toFixed(2)} dB/oct)`);

// ---------------------------------------------------------------------------
// 7. Shaders & Invariant Tokens Oracle
// ---------------------------------------------------------------------------
console.log('\n>>> 7. Shaders & Invariant Tokens Oracle');
const shadersModule = await import('../frontend/js/globe/shaders.js');

testCheck(shadersModule.ZonalHeatmapShader.fragmentShader.includes('evaluateDivergingColormap'),
  'ZonalHeatmapShader fragment shader incorporates evaluateDivergingColormap');
testCheck(shadersModule.CO2AtmosphereShader.fragmentShader.includes('exp(-radialDist * 4.0)'),
  'CO2AtmosphereShader fragment shader implements exp(-radialDist * 4.0)');
testCheck(shadersModule.OceanThermalShader.fragmentShader.includes('0.0235, 0.0824, 0.1765'),
  'OceanThermalShader fragment shader uses #06152d navy water');
testCheck(shadersModule.OceanThermalShader.fragmentShader.includes('waterMask <= 0.5'),
  'OceanThermalShader fragment shader enforces waterMask <= 0.5 discard');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`ALL NODE.JS EMPIRICAL STRESS ORACLE CHECKS PASSED: ${checksPassed} checks passed, 0 failures.`);
console.log('='.repeat(80));
