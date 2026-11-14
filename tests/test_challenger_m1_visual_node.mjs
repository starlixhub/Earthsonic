/**
 * tests/test_challenger_m1_visual_node.mjs
 * Node.js Empirical Challenger Test Suite for Milestone M1 Visual Theme & UI Invariants.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const CSS_DIR = path.join(FRONTEND_DIR, 'css');
const JS_DIR = path.join(FRONTEND_DIR, 'js');
const INDEX_HTML = path.join(FRONTEND_DIR, 'index.html');

// Helper: WCAG 2.1 Luminance and Contrast
function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

test('Challenger M1: Zero Non-None Box Shadows in CSS', () => {
  const cssFiles = ['main.css', 'globe.css', 'orchestra.css', 'visualizer.css'];
  let totalShadowDeclarations = 0;
  const nonNoneDeclarations = [];

  for (const filename of cssFiles) {
    const filePath = path.join(CSS_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    const regex = /([-\w]*box-shadow)\s*:\s*([^;]+);/gi;
    let match;

    while ((match = regex.exec(content)) !== null) {
      totalShadowDeclarations++;
      const val = match[2].replace('!important', '').trim().toLowerCase();
      if (val !== 'none') {
        const line = content.slice(0, match.index).split('\n').length;
        nonNoneDeclarations.push(`${filename}:${line} -> ${match[1]}: ${match[2]}`);
      }
    }
  }

  assert.ok(totalShadowDeclarations >= 20, `Expected >= 20 box-shadow: none declarations, found ${totalShadowDeclarations}`);
  assert.strictEqual(
    nonNoneDeclarations.length,
    0,
    `Found non-none box-shadow declarations:\n${nonNoneDeclarations.join('\n')}`
  );
});

test('Challenger M1: Zero Emoji Glyphs Across HTML, CSS, and JS', () => {
  const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{10000}-\u{10FFFF}]/gu;
  const filesToScan = [INDEX_HTML];

  for (const f of fs.readdirSync(CSS_DIR)) {
    if (f.endsWith('.css')) filesToScan.push(path.join(CSS_DIR, f));
  }

  function walkJs(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walkJs(full);
      else if (ent.name.endsWith('.js') || ent.name.endsWith('.mjs')) filesToScan.push(full);
    }
  }
  walkJs(JS_DIR);

  const emojiViolations = [];
  for (const fpath of filesToScan) {
    const rel = path.relative(ROOT_DIR, fpath);
    const content = fs.readFileSync(fpath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const matches = lines[i].match(emojiRegex);
      if (matches) {
        emojiViolations.push(`${rel}:${i + 1} -> ${matches.join(', ')}`);
      }
    }
  }

  assert.strictEqual(
    emojiViolations.length,
    0,
    `Found emoji characters in frontend files:\n${emojiViolations.join('\n')}`
  );
});

test('Challenger M1: Interactive Touch Target Minimum (>= 44px)', () => {
  const mainCss = fs.readFileSync(path.join(CSS_DIR, 'main.css'), 'utf-8');
  const globeCss = fs.readFileSync(path.join(CSS_DIR, 'globe.css'), 'utf-8');
  const orchCss = fs.readFileSync(path.join(CSS_DIR, 'orchestra.css'), 'utf-8');

  // 1. Header controls
  for (const cls of ['.header-tool-btn', '.header-tour-btn', '.header-blueprint-btn']) {
    const m = mainCss.match(new RegExp(`${cls.replace('.', '\\.')}[^}]*min-height:\\s*(\\d+)px`));
    assert.ok(m, `Missing min-height on ${cls}`);
    assert.ok(parseInt(m[1], 10) >= 44, `${cls} min-height < 44px: ${m[1]}px`);
  }

  // 2. Globe layers & navigation
  for (const cls of ['.layer-btn', '.nav-target-btn']) {
    const m = globeCss.match(new RegExp(`${cls.replace('.', '\\.')}[^}]*min-height:\\s*(\\d+)px`));
    assert.ok(m, `Missing min-height on ${cls}`);
    assert.ok(parseInt(m[1], 10) >= 44, `${cls} min-height < 44px: ${m[1]}px`);
  }

  // 3. Transport buttons
  const transportMatch = orchCss.match(/\.transport-btn[^}]*min-height:\s*(\d+)px/);
  assert.ok(transportMatch, 'Missing min-height on .transport-btn');
  assert.ok(parseInt(transportMatch[1], 10) >= 44);

  // 4. DAW Mute / Solo ::after touch target
  const pseudoMatch = orchCss.match(/\.btn-mute::after,\s*\.btn-solo::after[^}]*min-width:\s*(\d+)px[^}]*min-height:\s*(\d+)px/);
  assert.ok(pseudoMatch, 'Missing .btn-mute::after / .btn-solo::after hit area');
  assert.ok(parseInt(pseudoMatch[1], 10) >= 44);
  assert.ok(parseInt(pseudoMatch[2], 10) >= 44);

  // 5. VR Modal buttons
  assert.ok(mainCss.match(/\.vr-modal-close-btn[^}]*width:\s*44px[^}]*height:\s*44px/));
  assert.ok(mainCss.match(/\.vr-copy-btn[^}]*min-height:\s*44px/));
  assert.ok(mainCss.match(/\.btn-pc-stereo[^}]*min-height:\s*44px/));

  // 6. Mobile VR tap launcher button (fills fullscreen overlay)
  assert.ok(mainCss.match(/\.mobile-vr-tap-btn[^}]*width:\s*100%[^}]*height:\s*100%/));
});

test('Challenger M1: WCAG AAA Contrast Ratios (> 7:1)', () => {
  const textWhite = '#dce6f2';
  const pageBg = '#060a12';
  const panelBg = '#0b1220';
  const labelMuted = '#7b8ba3';

  const crPage = contrastRatio(textWhite, pageBg);
  const crPanel = contrastRatio(textWhite, panelBg);
  const crLabelPage = contrastRatio(labelMuted, pageBg);
  const crLabelPanel = contrastRatio(labelMuted, panelBg);

  // WCAG AAA requires > 7.0:1
  assert.ok(crPage >= 7.0, `Text on page bg contrast ${crPage.toFixed(2)}:1 < 7.0:1`);
  assert.ok(crPanel >= 7.0, `Text on surface contrast ${crPanel.toFixed(2)}:1 < 7.0:1`);

  // Authentic JPL values are ~15.7:1 and ~14.9:1
  assert.ok(crPage > 14.0, `Expected > 14:1 contrast on page bg, got ${crPage.toFixed(2)}:1`);
  assert.ok(crPanel > 13.0, `Expected > 13:1 contrast on surface, got ${crPanel.toFixed(2)}:1`);

  // Secondary text meets WCAG AA (>= 4.5:1)
  assert.ok(crLabelPage >= 4.5, `Label on page bg contrast ${crLabelPage.toFixed(2)}:1 < 4.5:1`);
  assert.ok(crLabelPanel >= 4.5, `Label on surface contrast ${crLabelPanel.toFixed(2)}:1 < 4.5:1`);
});

test('Challenger M1: Baseline DOM Invariants & Slider Geometry Preservation', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf-8');
  const mainCss = fs.readFileSync(path.join(CSS_DIR, 'main.css'), 'utf-8');
  const orchCss = fs.readFileSync(path.join(CSS_DIR, 'orchestra.css'), 'utf-8');

  // 1. #telemetry-matrix-grid
  assert.ok(html.includes('id="telemetry-matrix-grid"'));
  for (const layer of ['temperature', 'co2', 'ocean', 'sea_ice']) {
    assert.ok(html.includes(`data-layer="${layer}"`));
    assert.ok(html.includes(`id="matrix-val-${layer}"`));
  }

  // 2. Unicode bullet • (U+2022) and zero &bull;
  assert.ok(html.includes('FLIGHT DECK ONLINE • 23.44° TILT'));
  assert.ok(!html.includes('&bull;'));
  assert.ok(!html.includes('&bull'));

  // 3. The globe stage sits inside the four-zone instrument frame and keeps
  //    the void-black ground (now a token in frame.css instead of an inline
  //    style, because the stage is a grid cell rather than a fixed 100vw box).
  const frameCss = fs.readFileSync(path.join(CSS_DIR, 'frame.css'), 'utf-8');
  assert.ok(html.includes('id="globe-viewport-container"'));
  assert.ok(html.includes('class="frame"'), 'index.html hosts the frame grid');
  assert.ok(frameCss.includes('grid-template-areas'), 'frame.css defines the four zones');
  assert.ok(frameCss.includes('.frame .globe-viewport'), 'stage styling lives in frame.css');
  assert.ok(/--ink:\s*#05070b/.test(fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf-8')), 'void ground token present');

  // 4. Slider tracks #18181b. The value is declared once in tokens.css as
  //    --track and every slider references it.
  const tokensCss = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf-8');
  const tokenValue = (name) => {
    const m = new RegExp(`${name}:\\s*([^;]+);`).exec(tokensCss);
    return m ? m[1].trim() : null;
  };
  assert.equal(tokenValue('--track'), '#18181b');
  assert.equal(tokenValue('--paper'), '#f4f4f5');
  assert.ok(mainCss.includes('::-moz-range-track'));
  assert.ok(mainCss.includes('var(--track)'), 'main.css slider track uses --track');
  assert.ok(orchCss.includes('var(--track)'), 'orchestra.css slider track uses --track');

  // 5. Slider thumbs 6x14px #f4f4f5 border-radius 1px
  const thumbRegex = /::-webkit-slider-thumb\s*\{[^}]*width:\s*6px;[^}]*height:\s*14px;[^}]*border-radius:\s*1px;[^}]*background:\s*(?:#f4f4f5|var\(--paper\));/;
  assert.ok(thumbRegex.test(mainCss), 'Missing 6x14px #f4f4f5 thumb in main.css');
  assert.ok(thumbRegex.test(orchCss), 'Missing 6x14px #f4f4f5 thumb in orchestra.css');
});

test('Challenger M1: Zero-CDN Pure JS QR Generator & Desktop Modal', async () => {
  const { encodeQRCode, generateQRCodeSVG } = await import('../frontend/js/ui/qrcode.js');
  assert.ok(typeof encodeQRCode === 'function');
  assert.ok(typeof generateQRCodeSVG === 'function');

  // Verify Version 3 encoding for a representative LAN IP URL
  const testUrl = 'http://192.168.1.100:5000/?vr=1';
  const qr = encodeQRCode(testUrl);
  assert.strictEqual(qr.version, 3);
  assert.strictEqual(qr.size, 29); // Version 3 is 29x29

  // Verify SVG markup output
  const svg = generateQRCodeSVG(testUrl, { size: 220 });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox="0 0 37 37"')); // 29 + 4*2 margin = 37

  // Verify zero external CDN strings in qrcode.js
  const qrSource = fs.readFileSync(path.join(JS_DIR, 'ui', 'qrcode.js'), 'utf-8');
  assert.ok(!qrSource.includes('unpkg.com'));
  assert.ok(!qrSource.includes('cdnjs.cloudflare.com'));
  assert.ok(!qrSource.includes('jsdelivr.net'));
});
