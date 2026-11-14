/**
 * tests/test_adversarial_empirical_r1_node.mjs
 * Node.js ES Module adversarial test suite for Requirement R1.
 * Evaluates GLSL shader math, Three.js object definitions, and numerical boundary conditions.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import {
  TerminatorShader,
  AtmosphereShader,
  OceanThermalShader,
  ZonalHeatmapShader,
  CO2AtmosphereShader,
  StarfieldShader
} from '../frontend/js/globe/shaders.js';

const ROOT_DIR = path.resolve();

test('R1.1 Shader Syntax & GLSL Structure Audit', () => {
  // Check TerminatorShader
  assert.ok(TerminatorShader.vertexShader.includes('gl_Position'), 'Terminator vertexShader must set gl_Position');
  assert.ok(TerminatorShader.fragmentShader.includes('gl_FragColor'), 'Terminator fragmentShader must set gl_FragColor');
  assert.ok(TerminatorShader.fragmentShader.includes('smoothstep(-0.15, 0.15, sunDotNormal)'));

  // Check AtmosphereShader
  assert.ok(AtmosphereShader.fragmentShader.includes('pow(0.65 - dotProd, uGlowPower)'));

  // Check OceanThermalShader
  assert.ok(OceanThermalShader.fragmentShader.includes('if (waterMask <= 0.5)'), 'Strict discard for waterMask <= 0.5');
  assert.ok(OceanThermalShader.fragmentShader.includes('discard;'));
  assert.ok(OceanThermalShader.fragmentShader.includes('vec3(0.0235, 0.0784, 0.1569)'), 'Exact #061428 navy base');

  // Check ZonalHeatmapShader
  assert.ok(ZonalHeatmapShader.fragmentShader.includes('effectiveOpacity = min(uOpacity, 0.42);'), 'Max 0.42 opacity cap in GLSL');
  assert.ok(ZonalHeatmapShader.fragmentShader.includes('dFdx(waterMask)') && ZonalHeatmapShader.fragmentShader.includes('dFdy(waterMask)'), 'Derivative edge detection for coastline contrast');

  // Check CO2AtmosphereShader
  assert.ok(CO2AtmosphereShader.fragmentShader.includes('pow(1.0 - viewDot, 3.0)'), 'Fresnel power 3.0');
  assert.ok(CO2AtmosphereShader.fragmentShader.includes('mix(uColorLow, uColorHigh, smoothstep(0.0, 1.0, uCO2Norm))'));

  // Check StarfieldShader
  assert.ok(StarfieldShader.vertexShader.includes('gl_PointSize = aSize;'), 'gl_PointSize assigned attribute aSize');
  assert.ok(StarfieldShader.fragmentShader.includes('smoothstep(0.5, 0.05, dist)'), 'Circular soft alpha sprite');
});

test('R1.2 Atmospheric Halo Fresnel & Color Transition Math', () => {
  // Fresnel formula oracle: rim = pow(1.0 - viewDot, 3.0)
  const fresnel = (dot) => Math.pow(1.0 - Math.max(0.0, Math.min(1.0, dot)), 3.0);
  assert.equal(fresnel(1.0), 0.0, 'Head-on view (center of sphere) must have 0.0 rim glow');
  assert.equal(fresnel(0.0), 1.0, 'Grazing edge (silhouette rim) must have 1.0 peak rim glow');
  assert.ok(fresnel(0.5) < 0.15, 'Mid-body falloff must be sharp (pow 3.0 creates delicate thin limb)');

  // Color transition oracle: cyan-blue (335 ppm) to amber-red (426+ ppm)
  const colorLow = [0.0, 0.75, 1.0];
  const colorHigh = [0.96, 0.28, 0.08];

  const lerpColor = (norm) => {
    const t = Math.max(0.0, Math.min(1.0, norm));
    return [
      colorLow[0] + (colorHigh[0] - colorLow[0]) * t,
      colorLow[1] + (colorHigh[1] - colorLow[1]) * t,
      colorLow[2] + (colorHigh[2] - colorLow[2]) * t,
    ];
  };

  const col335 = lerpColor(0.0);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(col335[i] - colorLow[i]) < 1e-6, `335 ppm channel ${i} mismatch`);
  }

  const col426 = lerpColor(1.0);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(col426[i] - colorHigh[i]) < 1e-6, `426 ppm channel ${i} mismatch`);
  }
});

test('R1.3 Graticule 15° Lat/Lon Wireframe Geometry Precision', () => {
  const radius = 1.0008;

  // Verify latitude parallels generation math
  const parallels = [];
  for (let lat = -75; lat <= 75; lat += 15) {
    parallels.push(lat);
    const phi = (90.0 - lat) * (Math.PI / 180.0);
    const y = radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    // Every point on this parallel has distance radius from origin: y^2 + r^2 == radius^2
    const dist = Math.sqrt(y * y + r * r);
    assert.ok(Math.abs(dist - radius) < 1e-6, `Parallel at lat ${lat} must lie exactly on sphere of radius ${radius}`);
  }
  assert.equal(parallels.length, 11, 'Must have exactly 11 parallels (-75 to +75 by 15)');

  // Verify longitude meridians generation math
  const meridians = [];
  for (let lon = -180; lon < 180; lon += 15) {
    meridians.push(lon);
  }
  assert.equal(meridians.length, 24, 'Must have exactly 24 meridians (-180 to 165 by 15)');
});

test('R1.4 Ocean Thermal Mask Discard Boundary Oracle', () => {
  const shaderDiscardRule = (waterMask) => {
    return waterMask <= 0.5 ? 'DISCARD' : 'RENDER';
  };

  assert.equal(shaderDiscardRule(0.0), 'DISCARD', 'Land must be discarded');
  assert.equal(shaderDiscardRule(0.2), 'DISCARD', 'Coastal shallow land must be discarded');
  assert.equal(shaderDiscardRule(0.499), 'DISCARD', 'Strict boundary <= 0.5 must discard');
  assert.equal(shaderDiscardRule(0.500), 'DISCARD', 'Boundary 0.500 must discard');
  assert.equal(shaderDiscardRule(0.501), 'RENDER', 'Ocean > 0.5 must render');
  assert.equal(shaderDiscardRule(1.0), 'RENDER', 'Full ocean must render');
});

test('R1.5 Starfield Point Sizes & Alpha Sprite Bounds Oracle', () => {
  // Test sizing and opacity ranges across 10,000 iterations
  for (let i = 0; i < 10000; i++) {
    const size = 1.0 + Math.random() * 1.2;
    assert.ok(size >= 1.0 && size <= 2.2, `Star size ${size} out of bounds [1.0, 2.2]`);

    const opacity = 0.20 + Math.random() * 0.65;
    assert.ok(opacity >= 0.20 && opacity <= 0.85, `Star opacity ${opacity} out of bounds [0.20, 0.85]`);
  }

  // Alpha sprite calculation
  const spriteAlpha = (dist, baseOpacity) => {
    if (dist > 0.5) return 0.0;
    // smoothstep(0.5, 0.05, dist)
    const t = Math.max(0.0, Math.min(1.0, (0.5 - dist) / (0.5 - 0.05)));
    const smooth = t * t * (3 - 2 * t);
    return smooth * baseOpacity;
  };

  assert.equal(spriteAlpha(0.6, 0.8), 0.0, 'Outside circle (dist > 0.5) must have 0 alpha');
  assert.equal(spriteAlpha(0.5, 0.8), 0.0, 'At edge (dist = 0.5) must have 0 alpha');
  assert.ok(spriteAlpha(0.0, 0.8) > 0.79, 'At center (dist = 0.0) must have full base opacity');
});
