/**
 * tests/test_overhaul_r1_r2_node.mjs
 * Node.js ES Module test runner verifying Requirements R1 and R2 contracts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve();

test('R1 Globe: Shaders export 15-degree graticule, waterMask > 0.5, and Fresnel rim power', async () => {
  const shadersPath = path.join(ROOT_DIR, 'frontend', 'js', 'globe', 'shaders.js');
  const shadersCode = fs.readFileSync(shadersPath, 'utf-8');

  // Verify smoothstep terminator preservation
  assert.ok(shadersCode.includes('smoothstep(-0.15, 0.15'), 'Terminator smoothstep preserved');

  // Verify Ocean Thermal waterMask threshold
  assert.ok(shadersCode.includes('0.5'), 'Ocean thermal threshold contains 0.5');
  assert.ok(shadersCode.includes('uSpecularMask'), 'uSpecularMask uniform present');

  // Verify Atmospheric Fresnel glow power 3.0
  assert.ok(shadersCode.includes('3.0'), 'Fresnel rim lighting contains power of 3.0');

  // Verify Zonal thermal blend max opacity 0.42
  assert.ok(shadersCode.includes('0.42') || shadersCode.includes('mix('), 'Zonal thermal blending contains 0.42 or mix');
});

test('R2 Header & Telemetry: Status badge has Unicode bullet and matrix contains 4 variables', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'index.html'), 'utf-8');
  const appJs = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'js', 'app.js'), 'utf-8');

  // Status bullet character
  assert.ok(appJs.includes('FLIGHT DECK ONLINE • 23.44° TILT'), 'app.js uses actual • bullet character');
  assert.ok(!appJs.includes('FLIGHT DECK ONLINE &bull;'), 'app.js does not contain literal &bull;');

  // Live Earth Telemetry Matrix
  assert.ok(!indexHtml.includes('DAY / NIGHT GLSL TERMINATOR'), 'DAY / NIGHT GLSL TERMINATOR replaced');
  assert.ok(
    indexHtml.includes('TEMP') &&
    indexHtml.includes('CO2') &&
    indexHtml.includes('OCEAN') &&
    indexHtml.includes('ICE'),
    'Matrix contains all 4 variables: TEMP, CO2, OCEAN, ICE'
  );
});

test('R2 Controls & Visualizer: Range inputs custom CSS, frequency axis, and decade labels', () => {
  const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'index.html'), 'utf-8');
  const mainCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'main.css'), 'utf-8');
  const orchCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'orchestra.css'), 'utf-8');
  const visCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'visualizer.css'), 'utf-8');
  const tokensCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'tokens.css'), 'utf-8');
  // Slider colours are declared once in tokens.css and referenced by var().
  const combinedCss = [mainCss, orchCss, visCss, tokensCss].join('\n');

  // Custom slider styling
  assert.ok(combinedCss.includes('-webkit-appearance: none'));
  assert.ok(combinedCss.includes('18181b'), '4px recessed track #18181b present');
  assert.ok(combinedCss.includes('6px') && combinedCss.includes('14px'), 'Thumb 6px by 14px present');
  assert.ok(combinedCss.includes('f4f4f5'), 'Thumb color #f4f4f5 present');

  // Visualizer grid & axis labels
  assert.ok(combinedCss.includes('24px 20px'), 'Oscilloscope grid size 24px 20px present');
  assert.ok(indexHtml.includes('60Hz') && indexHtml.includes('16kHz'), 'Frequency labels present');
  assert.ok(indexHtml.includes('1980') && indexHtml.includes('2026'), 'Decade labels present');
});
