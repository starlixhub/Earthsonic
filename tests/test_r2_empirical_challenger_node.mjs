/**
 * tests/test_r2_empirical_challenger_node.mjs
 * Standalone Node.js verification harness for Requirement R2 (Flight-Deck UI Polish & Telemetry Controls).
 * Executed by challenger_overhaul_2.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = path.resolve();

const indexHtml = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'index.html'), 'utf-8');
const appJs = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'js', 'app.js'), 'utf-8');
const telemetryJs = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'js', 'ui', 'telemetry.js'), 'utf-8');
const mainCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'main.css'), 'utf-8');
const orchCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'orchestra.css'), 'utf-8');
const visCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'visualizer.css'), 'utf-8');
const tokensCss = fs.readFileSync(path.join(ROOT_DIR, 'frontend', 'css', 'tokens.css'), 'utf-8');
/** The slider colours live in tokens.css now; resolve the token to its value. */
const tokenValue = (name) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
  return m ? m[1].trim() : null;
};

test('R2 Node Challenge 1: Header status badge contains • character and zero &bull;', () => {
  const match = indexHtml.match(/<span\s+id="telemetry-status">([^<]+)<\/span>/);
  assert.ok(match, '<span id="telemetry-status"> must exist in index.html');
  const inner = match[1];
  assert.ok(inner.includes('•'), 'Must contain literal • character');
  assert.ok(!inner.includes('&bull;'), 'Must not contain &bull;');
  assert.equal(inner.trim(), 'FLIGHT DECK ONLINE • 23.44° TILT');

  // Verify app.js passes literal •
  assert.ok(appJs.includes("updateTelemetryStatus('FLIGHT DECK ONLINE • 23.44° TILT')"));
  assert.ok(!appJs.includes("updateTelemetryStatus('FLIGHT DECK ONLINE &bull;"));

  // Verify telemetry.js sanitizer regex
  assert.ok(telemetryJs.includes('.replace(/&bull;/g, \'•\')'));
});

test('R2 Node Challenge 2: Top-right HUD card eliminates GLSL terminator and hosts 4-var matrix', () => {
  assert.ok(!indexHtml.includes('DAY / NIGHT GLSL TERMINATOR'), 'DAY / NIGHT GLSL TERMINATOR must be removed');
  assert.ok(!appJs.includes('DAY / NIGHT GLSL TERMINATOR'));

  // #hud-matrix-card structure
  assert.ok(indexHtml.includes('id="hud-matrix-card"'), '#hud-matrix-card exists');
  assert.ok(indexHtml.includes('id="telemetry-matrix-grid"'), '#telemetry-matrix-grid exists');

  for (const layer of ['temperature', 'co2', 'ocean', 'sea_ice']) {
    assert.ok(indexHtml.includes(`id="matrix-cell-${layer}"`), `Cell matrix-cell-${layer} exists`);
    assert.ok(indexHtml.includes(`id="matrix-val-${layer}"`), `Val matrix-val-${layer} exists`);
    assert.ok(indexHtml.includes(`data-layer="${layer}"`), `data-layer="${layer}" exists`);
  }

  // Active layer highlight styling in main.css
  for (const layer of ['temperature', 'co2', 'ocean', 'sea_ice']) {
    assert.ok(mainCss.includes(`.matrix-cell.active[data-layer="${layer}"]`));
  }
});

test('R2 Node Challenge 3: Range input sliders custom styling, zero circular thumbs, dynamic fill', () => {
  // Appearance none
  assert.ok(mainCss.includes('-webkit-appearance: none'));
  assert.ok(mainCss.includes('appearance: none'));

  // 4px recessed track #18181b
  const trackMatch = mainCss.match(/(?:^|\n)\s*input\[type=["']?range["']?\]\s*\{([^}]+)\}/);
  assert.ok(trackMatch, 'Global input[type="range"] selector present');
  assert.ok(trackMatch[1].includes('height: 4px'));
  assert.ok(
    trackMatch[1].includes('#18181b') ||
      (trackMatch[1].includes('var(--track)') && tokenValue('--track') === '#18181b'),
    'Recessed #18181b track, direct or via --track'
  );

  // Precision 6x14px thumbs #f4f4f5 with border-radius: 1px
  const thumbMatch = mainCss.match(/input\[type="range"\]::-webkit-slider-thumb\s*\{([^}]+)\}/);
  assert.ok(thumbMatch, '::-webkit-slider-thumb rule present');
  const tbody = thumbMatch[1];
  assert.ok(tbody.includes('width: 6px'));
  assert.ok(tbody.includes('height: 14px'));
  assert.ok(tbody.includes('border-radius: 1px'));
  assert.ok(
    tbody.includes('background: #f4f4f5') ||
      (tbody.includes('background: var(--paper)') && tokenValue('--paper') === '#f4f4f5'),
    'Thumb #f4f4f5, direct or via --paper'
  );

  // Zero circular white thumbs
  const combinedCss = mainCss + '\n' + orchCss + '\n' + visCss;
  const thumbRules = combinedCss.match(/[^}]*thumb\s*\{[^}]+\}/gi) || [];
  for (const rule of thumbRules) {
    assert.ok(!rule.includes('border-radius: 50%'), `Circular thumb detected: ${rule}`);
    assert.ok(!rule.includes('border-radius: 100%'), `Circular thumb detected: ${rule}`);
  }

  // Layer fill colors: four distinct channel tokens, resolved from tokens.css.
  const channelTokens = ['--c-temp', '--c-co2', '--c-ocean', '--c-ice'];
  const channelValues = channelTokens.map((t) => tokenValue(t));
  for (let i = 0; i < channelTokens.length; i++) {
    assert.ok(channelValues[i], `${channelTokens[i]} defined in tokens.css`);
    assert.ok(mainCss.includes(`var(${channelTokens[i]})`), `${channelTokens[i]} used in main.css`);
  }
  assert.equal(new Set(channelValues).size, 4, 'The four channel hues are distinct');
});

test('R2 Node Challenge 4: Orchestra channel cards have zero pan rows and contain equation badges in headers', () => {
  assert.ok(!indexHtml.includes('strip-pan-slider'), 'strip-pan-slider absent');
  assert.ok(!indexHtml.includes('strip-pan-row'), 'strip-pan-row absent');
  assert.ok(!orchCss.includes('.strip-pan-slider'), 'CSS .strip-pan-slider absent');
  assert.ok(!orchCss.includes('.strip-pan-row'), 'CSS .strip-pan-row absent');

  // Verify all 4 channel badges
  for (const cid of ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent']) {
    assert.ok(indexHtml.includes(`id="eq-badge-${cid}"`), `eq-badge-${cid} present`);
    assert.ok(indexHtml.includes(`id="eq-text-${cid}"`), `eq-text-${cid} present`);
  }

  // Verify live equation function in app.js
  assert.ok(appJs.includes('updateLiveEquationBadges(rec)'));
  assert.ok(appJs.includes('eq-text-surface_temperature'));
  assert.ok(appJs.includes('eq-text-atmospheric_co2'));
  assert.ok(appJs.includes('eq-text-ocean_temperature'));
  assert.ok(appJs.includes('eq-text-sea_ice_extent'));
});

test('R2 Node Challenge 5: Visualizer HUD height reduction 35%, oscilloscope grid, frequency axis, decade ticks', () => {
  // Height reduction to 58px
  const gridMatch = visCss.match(/\.visualizer-canvas-grid\s*\{([^}]+)\}/);
  assert.ok(gridMatch, '.visualizer-canvas-grid rule present');
  assert.ok(gridMatch[1].includes('height: 58px'), 'Height must be exactly 58px (35% reduction from 90px)');

  // Oscilloscope grid
  assert.ok(visCss.includes('background-size: 24px 20px'), 'visualizer.css oscilloscope grid 24px 20px present');
  assert.ok(orchCss.includes('background-size: 24px 20px'), 'orchestra.css spectrum grid 24px 20px present');

  // 5-point frequency axis labels
  for (const freq of ['60Hz', '250Hz', '1kHz', '4kHz', '16kHz']) {
    assert.ok(indexHtml.includes(`<span>${freq}</span>`), `Frequency label ${freq} present`);
  }

  // Decade tick labels
  for (const decade of ['1980', '1990', '2000', '2010', '2020', '2026']) {
    assert.ok(indexHtml.includes(`<span>${decade}</span>`), `Decade label ${decade} present`);
  }

  // Tick marks styling in orchestra.css
  assert.ok(orchCss.includes('.timeline-decade-ticks span::before'), 'Decade tick markers defined in CSS');
});
