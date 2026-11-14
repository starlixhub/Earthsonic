/**
 * tests/test_qrcode_node.mjs
 * Verification of pure ECMAScript ISO/IEC 18004 Zero-CDN QR generator.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQRCode, generateQRCodeSVG, renderQRCodeToCanvas, QR_VERSIONS_M } from '../frontend/js/ui/qrcode.js';

test('QR Code: LAN IP VR URL generates valid Version 3 matrix', () => {
  const payload = 'http://192.168.1.100:5000/?vr=1';
  const qr = encodeQRCode(payload);

  assert.equal(qr.version, 3, 'Payload of length 33 must fit into QR Version 3 Level M');
  assert.equal(qr.size, 29, 'Version 3 size must be exactly 29x29');
  assert.ok(qr.mask >= 0 && qr.mask <= 7, 'Mask index must be in range 0..7');
  assert.equal(qr.matrix.length, 29);
  assert.equal(qr.matrix[0].length, 29);

  // Verify Finder Patterns (7x7) at (0,0), (0, 22), (22, 0)
  const S = qr.size;
  const finders = [
    [0, 0],
    [0, S - 7],
    [S - 7, 0]
  ];

  for (const [r0, c0] of finders) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        const expected = (isBorder || isCenter) ? 1 : 0;
        assert.equal(qr.matrix[r0 + r][c0 + c], expected,
          `Finder module mismatch at (${r0 + r}, ${c0 + c})`);
      }
    }
  }

  // Verify Timing Patterns on row 6 and column 6 (between finders: indices 8 to S-9)
  for (let i = 8; i < S - 8; i++) {
    const expected = (i % 2 === 0) ? 1 : 0;
    assert.equal(qr.matrix[6][i], expected, `Horizontal timing pattern mismatch at col ${i}`);
    assert.equal(qr.matrix[i][6], expected, `Vertical timing pattern mismatch at row ${i}`);
  }

  // Dark module at (S - 8, 8)
  assert.equal(qr.matrix[S - 8][8], 1, 'Dark module at (S-8, 8) must be 1');
});

test('QR Code: Auto-versioning and multi-block capacity', () => {
  // Version 1 short payload
  const qr1 = encodeQRCode('TEST');
  assert.equal(qr1.version, 1);
  assert.equal(qr1.size, 21);

  // Version 4 payload requiring multi-block interleaving
  const longPayload = 'https://earthsonic.nasa.gov/mission/deep-space-sonification-stream?session=alpha-omega-99';
  const qr4 = encodeQRCode(longPayload);
  assert.ok(qr4.version >= 4, `Expected version >= 4 for payload length ${longPayload.length}, got ${qr4.version}`);
  assert.equal(qr4.size, QR_VERSIONS_M[qr4.version].size);
});

test('QR Code: generateQRCodeSVG produces compliant SVG markup', () => {
  const svg = generateQRCodeSVG('http://192.168.1.100:5000/?vr=1', { margin: 4 });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'SVG must start with svg tag');
  assert.ok(svg.includes('viewBox="0 0 37 37"'), 'Version 3 (29) + 2*margin (8) = 37 modules');
  assert.ok(svg.includes('<rect width="37" height="37" fill="#ffffff"/>'), 'Light background rect required');
  assert.ok(svg.includes('<path d="M'), 'Dark module path data required');
  assert.ok(svg.endsWith('</svg>'), 'SVG must close cleanly');
});

test('QR Code: renderQRCodeToCanvas draws to canvas context with high contrast', () => {
  const operations = [];
  const mockCanvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: (type) => {
      if (type === '2d') {
        return {
          imageSmoothingEnabled: true,
          set fillStyle(val) {
            operations.push({ op: 'fillStyle', val });
          },
          fillRect: (x, y, w, h) => {
            operations.push({ op: 'fillRect', x, y, w, h });
          }
        };
      }
      return null;
    }
  };

  const qr = renderQRCodeToCanvas(mockCanvas, 'http://127.0.0.1:5000/?vr=1', {
    size: 220,
    margin: 4,
    darkColor: '#060a12',
    lightColor: '#ffffff'
  });

  assert.ok(qr);
  assert.ok(mockCanvas.width > 0, 'Canvas width set');
  assert.ok(mockCanvas.height > 0, 'Canvas height set');
  assert.equal(mockCanvas.style.width, '220px');
  assert.equal(mockCanvas.style.height, '220px');

  // Verify background fill was lightColor
  const bgFill = operations.find(o => o.op === 'fillStyle' && o.val === '#ffffff');
  assert.ok(bgFill, 'Background light color fill applied');

  // Verify dark modules were drawn with #060a12
  const darkFill = operations.find(o => o.op === 'fillStyle' && o.val === '#060a12');
  assert.ok(darkFill, 'Module dark color fill applied');

  const moduleRects = operations.filter(o => o.op === 'fillRect');
  assert.ok(moduleRects.length > 50, 'All dark modules rendered to canvas');
});
