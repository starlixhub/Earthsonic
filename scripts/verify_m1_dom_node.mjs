import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(PROJECT_ROOT, 'frontend', 'index.html');

test('Milestone M1 DOM Invariants - Node.js Empirical Verification', async (t) => {
  const html = fs.readFileSync(INDEX_PATH, 'utf-8');

  await t.test('Title contract verification', () => {
    assert.match(
      html,
      /<title>EARTHSONIC \/\/ 3D EARTH GLOBE \| NASA Earth Science · Space Apps Challenge 2026<\/title>/,
      'Title tag must match contract exactly'
    );
  });

  await t.test('Globe viewport container contract verification', () => {
    const mainMatch = html.match(/<main\s+([^>]*id="globe-viewport-container"[^>]*)>/);
    assert.ok(mainMatch, '<main id="globe-viewport-container"> must exist');
    const attrs = mainMatch[1];
    assert.ok(attrs.includes('class="globe-viewport"'), 'Must have class="globe-viewport"');
    assert.ok(attrs.includes('width: 100vw;'), 'Must have inline style width: 100vw;');
    assert.ok(attrs.includes('height: 100vh;'), 'Must have inline style height: 100vh;');
    assert.ok(attrs.includes('background: #070709;'), 'Must have inline style background: #070709;');
    assert.ok(attrs.includes('tabindex="-1"'), 'Must have tabindex="-1"');
  });

  await t.test('Live Earth Telemetry Matrix header contract verification', () => {
    assert.ok(html.includes('id="hud-matrix-card"'), '#hud-matrix-card must exist');
    const matrixSnippet = html.match(/<div class="hud-panel hud-matrix-panel" id="hud-matrix-card">([\s\S]*?)<\/div>\s*<\/div>/);
    assert.ok(matrixSnippet, '#hud-matrix-card structure must be intact');
    assert.ok(matrixSnippet[1].includes('<div class="hud-title">Live Earth Telemetry Matrix</div>'));
    assert.ok(!matrixSnippet[1].includes('DAY / NIGHT GLSL TERMINATOR'), 'Must not contain old terminator label');
  });

  await t.test('Live Earth Telemetry Matrix variables and labels verification', () => {
    assert.ok(html.includes('data-layer="temperature"'));
    assert.ok(html.includes('data-layer="co2"'));
    assert.ok(html.includes('data-layer="ocean"'));
    assert.ok(html.includes('data-layer="sea_ice"'));

    // Check ASCII CO2 in telemetry matrix
    const co2Match = html.match(/<div class="matrix-cell[^"]*"\s+data-layer="co2"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(co2Match, 'CO2 cell must exist');
    assert.ok(co2Match[1].includes('<span class="matrix-label">CO2</span>'), 'CO2 matrix-label must be ASCII CO2');
  });

  await t.test('Visualizer frequency axis spans contract verification', () => {
    const axisMatch = html.match(/<div class="spectrum-freq-axis">([\s\S]*?)<\/div>/);
    assert.ok(axisMatch, '.spectrum-freq-axis must exist');
    const spans = [...axisMatch[1].matchAll(/<span>(.*?)<\/span>/g)].map(m => m[1]);
    assert.deepEqual(spans, ['60Hz', '250Hz', '1kHz', '4kHz', '16kHz']);
    assert.ok(!axisMatch[1].includes('60 Hz'), 'Must not have spaced "60 Hz"');
  });
});
