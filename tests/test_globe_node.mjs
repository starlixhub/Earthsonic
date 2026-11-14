/**
 * tests/test_globe_node.mjs
 * Node.js ES module unit test runner for EARTHSONIC Globe & API modules.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// Test 1: Shaders
test('Shaders: Exports valid GLSL definitions and uniforms', async () => {
  const { TerminatorShader, AtmosphereShader, OceanThermalShader, ZonalHeatmapShader } = await import('../frontend/js/globe/shaders.js');

  assert.ok(TerminatorShader.vertexShader.includes('vSunDirection'), 'Terminator vertex shader must calculate vSunDirection');
  assert.ok(TerminatorShader.fragmentShader.includes('smoothstep(-0.15, 0.15'), 'Terminator fragment shader must blend with smoothstep(-0.15, 0.15)');
  assert.ok(TerminatorShader.fragmentShader.includes('uSpecularMap'), 'Terminator shader must sample specular map');

  assert.ok(AtmosphereShader.fragmentShader.includes('uAtmosphereColor'), 'Atmosphere shader must use uAtmosphereColor');
  assert.ok(AtmosphereShader.fragmentShader.includes('uGlowPower'), 'Atmosphere shader must use uGlowPower');

  assert.ok(OceanThermalShader.fragmentShader.includes('uThermalAnomaly'), 'Ocean shader must use uThermalAnomaly');
  assert.ok(OceanThermalShader.vertexShader.includes('uWaveHeight'), 'Ocean shader must displace with uWaveHeight');

  assert.ok(ZonalHeatmapShader.fragmentShader.includes('uBandAnomalies[14]'), 'Zonal shader must have 14 band uniforms');
});

// Test 2: Textures & Procedural generator exports
test('Textures: Geographic polygons and coordinate transforms', async () => {
  const { CONTINENTAL_POLYGONS, METRO_CENTERS, latLonToPixel } = await import('../frontend/js/globe/textures.js');

  assert.ok(CONTINENTAL_POLYGONS.length >= 7, 'Must have at least 7 continental polygons defined');
  assert.ok(METRO_CENTERS.length >= 10, 'Must have metropolitan light centers defined');

  // Test pixel mapping
  // North Pole (lat 90, lon -180) -> (0, 0)
  const [x0, y0] = latLonToPixel(-180, 90, 1024, 512);
  assert.equal(x0, 0);
  assert.equal(y0, 0);

  // South Pole (lat -90, lon 180) -> (1024, 512)
  const [x1, y1] = latLonToPixel(180, -90, 1024, 512);
  assert.equal(x1, 1024);
  assert.equal(y1, 512);

  // Equator, Prime Meridian (lat 0, lon 0) -> (512, 256)
  const [xc, yc] = latLonToPixel(0, 0, 1024, 512);
  assert.equal(xc, 512);
  assert.equal(yc, 256);
});

// Test 3: Overlays & Mauna Loa Coordinates
test('Overlays: Mauna Loa coordinates and GISTEMP bands', async () => {
  const { MAUNA_LOA_COORDS, GISTEMP_BANDS, TemperatureOverlay, SeaIceOverlay, OceanThermalOverlay, CO2Overlay, OverlayManager } = await import('../frontend/js/globe/overlays.js');

  assert.equal(MAUNA_LOA_COORDS.lat, 19.5362, 'Mauna Loa latitude must be 19.5362°N');
  assert.equal(MAUNA_LOA_COORDS.lon, -155.5763, 'Mauna Loa longitude must be -155.5763°W');
  assert.equal(GISTEMP_BANDS.length, 14, 'Must have 14 GISTEMP latitude bands');

  // Verify class constructors exist
  assert.ok(typeof TemperatureOverlay === 'function');
  assert.ok(typeof SeaIceOverlay === 'function');
  assert.ok(typeof OceanThermalOverlay === 'function');
  assert.ok(typeof CO2Overlay === 'function');
  assert.ok(typeof OverlayManager === 'function');
});

// Test 4: API Client helper methods
test('API: findRecordByDate exact and prefix matching', async () => {
  const { findRecordByDate } = await import('../frontend/js/api.js');

  const records = [
    { date: '1980-01', val: 0.1 },
    { date: '1980-02', val: 0.2 },
    { date: '2000-06', val: 0.5 },
    { date: '2024-12', val: 1.2 }
  ];

  // Exact match
  const r1 = findRecordByDate(records, '1980-02');
  assert.equal(r1.val, 0.2);

  // Prefix match (year string)
  const r2 = findRecordByDate(records, '2000');
  assert.equal(r2.date, '2000-06');

  // Closest match
  const r3 = findRecordByDate(records, '1985-05');
  assert.ok(r3 !== null);
});
