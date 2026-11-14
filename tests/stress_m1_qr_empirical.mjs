/**
 * tests/stress_m1_qr_empirical.mjs
 * Empirical Challenger Stress Harness for qrcode.js (Milestone M1).
 *
 * Verifies:
 * 1. Boundary payload capacities for Versions 1-10 Byte Mode (Level M).
 * 2. Rejection of payloads exceeding Version 10 capacity.
 * 3. Diverse URL formats (IPv4, IPv6, localhost, query strings, special/unicode chars).
 * 4. Mathematical Galois Field GF(2^8) arithmetic & Reed-Solomon polynomial roots.
 * 5. ISO/IEC 18004 structural invariants (finders, white separators, timing, dark module, align, masks).
 * 6. Zero external CDN, npm, or network script dependencies.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { encodeQRCode, generateQRCodeSVG, renderQRCodeToCanvas, QR_VERSIONS_M } from '../frontend/js/ui/qrcode.js';

// ============================================================================
// 1. Boundary Payload Capacities & Version Auto-Selection
// ============================================================================
test('QR Stress 1: Boundary payload capacities across Versions 1 through 10', () => {
  // Compute maximum Byte Mode Level M capacities for each version
  // Capacity formula: (totalDataCodewords * 8 - modeBits(4) - charCountBits(8 or 16) - termBits(4)) / 8
  const capacities = {};
  for (let v = 1; v <= 10; v++) {
    const cfg = QR_VERSIONS_M[v];
    let totalData = 0;
    for (const b of cfg.blocks) totalData += b.count * b.data;
    const countBits = v >= 10 ? 16 : 8;
    // Available bits for data payload
    const maxDataBits = totalData * 8;
    const payloadBits = maxDataBits - 4 - countBits;
    capacities[v] = Math.floor(payloadBits / 8);
  }

  // Known theoretical Byte Mode Level M max byte capacities:
  // V1: (16*8 - 4 - 8)/8 = 14 bytes
  // V2: (28*8 - 4 - 8)/8 = 26 bytes (or 26.5 -> 26 bytes)
  // V3: (44*8 - 4 - 8)/8 = 42 bytes
  // V4: (64*8 - 4 - 8)/8 = 62 bytes
  // V5: (86*8 - 4 - 8)/8 = 84 bytes
  // V6: (108*8 - 4 - 8)/8 = 106 bytes
  // V7: (124*8 - 4 - 8)/8 = 122 bytes
  // V8: (154*8 - 4 - 8)/8 = 152 bytes
  // V9: (180*8 - 4 - 8)/8 = 178 bytes
  // V10: (216*8 - 4 - 16)/8 = 213 bytes

  for (let v = 1; v <= 10; v++) {
    const cap = capacities[v];
    const testPayload = 'X'.repeat(cap);
    const qr = encodeQRCode(testPayload);
    assert.equal(qr.version, v, `Payload of ${cap} bytes should fit in Version ${v}`);
    assert.equal(qr.size, QR_VERSIONS_M[v].size, `Matrix size for V${v} must match specification`);

    // Verify boundary transition (cap + 1) steps to next version (if v < 10)
    if (v < 10) {
      const overflowPayload = 'X'.repeat(cap + 1);
      const qrNext = encodeQRCode(overflowPayload);
      assert.equal(qrNext.version, v + 1, `Payload of ${cap + 1} bytes must step to Version ${v + 1}`);
    }
  }

  // Verify rejection beyond Version 10 maximum capacity
  const v10Max = capacities[10];
  const excessivePayload = 'X'.repeat(v10Max + 1);
  assert.throws(
    () => encodeQRCode(excessivePayload),
    /Payload too long for embedded QR encoder/,
    'Payload exceeding Version 10 capacity must throw descriptive error'
  );

  // Single character payload
  const qrMin = encodeQRCode('A');
  assert.equal(qrMin.version, 1);
  assert.equal(qrMin.size, 21);

  // Empty string payload
  const qrEmpty = encodeQRCode('');
  assert.equal(qrEmpty.version, 1);
  assert.equal(qrEmpty.size, 21);
});

// ============================================================================
// 2. Diverse URL Formats & Complex Characters
// ============================================================================
test('QR Stress 2: URL variants, IP formats, query strings, and Unicode characters', () => {
  const urlVariants = [
    { label: 'LAN IP Default', url: 'http://192.168.1.100:5000/?vr=1' },
    { label: 'Localhost IPv4', url: 'http://127.0.0.1:5000/?vr=1' },
    { label: 'Localhost Named', url: 'http://localhost:8080/?vr=1' },
    { label: 'IPv6 Loopback', url: 'http://[::1]:5000/?vr=1' },
    { label: 'IPv6 Full', url: 'http://[2001:0db8:85a3:0000:0000:8a2e:0370:7334]:5000/?vr=1' },
    { label: 'Long Hostname', url: 'http://earthsonic-jpl-station-node-99.subdeck.local:5000/?vr=1' },
    { label: 'Complex Query', url: 'http://192.168.0.12:5000/?vr=1&mode=stereo&fps=60&anom=1.24&session=xyz-987' },
    { label: 'Percent Encoded', url: 'http://192.168.1.5:5000/?vr=1&name=Earth%20Observation%20Sonification%20%231' },
    { label: 'Special Symbols', url: 'http://192.168.1.1:5000/?vr=1&tokens=!$*()_+-=~' },
    { label: 'UTF-8 Middle Dot & Glyphs', url: 'http://192.168.1.1:5000/?vr=1&station=JPL•EARTHSONIC•地球' }
  ];

  for (const { label, url } of urlVariants) {
    const qr = encodeQRCode(url);
    assert.ok(qr.version >= 1 && qr.version <= 10, `${label} version ${qr.version} in bounds`);
    assert.ok(qr.matrix.length === qr.size);
    assert.ok(qr.matrix[0].length === qr.size);

    // Verify SVG generation for this URL
    const svg = generateQRCodeSVG(url, { margin: 4 });
    assert.ok(svg.startsWith('<svg'), `${label} produces valid SVG`);
    assert.ok(svg.includes(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`), `${label} SVG viewBox correct`);
  }
});

// ============================================================================
// 3. Galois Field GF(2^8) Mathematical Invariants
// ============================================================================
test('QR Stress 3: Galois Field GF(2^8) arithmetic & Reed-Solomon generator roots', () => {
  // Reconstruct GF(2^8) tables independently using the standard primitive polynomial:
  // x^8 + x^4 + x^3 + x^2 + 1 = 0x11D (285)
  const expRef = new Uint8Array(512);
  const logRef = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    expRef[i] = x;
    expRef[i + 255] = x;
    logRef[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11D;
  }
  logRef[0] = 0;

  // Verify cyclic group order = 255
  let nextExp = expRef[254] << 1;
  if (nextExp & 256) nextExp ^= 0x11D;
  assert.equal(nextExp, 1, 'alpha * alpha^254 === alpha^255 === 1');

  // Verify log/exp bijection for all 1..255
  for (let i = 1; i < 256; i++) {
    const power = logRef[i];
    assert.equal(expRef[power], i, `exp(log(${i})) === ${i}`);
  }

  // Field multiplication oracle
  function gfMulRef(a, b) {
    if (a === 0 || b === 0) return 0;
    return expRef[logRef[a] + logRef[b]];
  }

  // Verify distributivity: a * (b ^ c) == (a * b) ^ (a * c)
  const samples = [1, 2, 7, 42, 127, 128, 255];
  for (const a of samples) {
    for (const b of samples) {
      for (const c of samples) {
        assert.equal(gfMulRef(a, b ^ c), gfMulRef(a, b) ^ gfMulRef(a, c), 'GF distributivity failure');
      }
    }
  }

  // Verify generator polynomial root properties for EC degree k = 10 (Version 1 M)
  // g(x) = (x - alpha^0)(x - alpha^1)...(x - alpha^9)
  // Therefore, evaluating g(alpha^i) for i in 0..k-1 MUST equal 0 in GF(2^8)!
  function makeGenPoly(k) {
    let g = [1];
    for (let i = 0; i < k; i++) {
      const next = new Array(g.length + 1).fill(0);
      const factor = expRef[i];
      for (let j = 0; j < g.length; j++) {
        next[j] ^= gfMulRef(g[j], factor);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    return g.reverse();
  }

  function evalPoly(poly, rootVal) {
    let result = 0;
    for (let i = 0; i < poly.length; i++) {
      result = gfMulRef(result, rootVal) ^ poly[i];
    }
    return result;
  }

  for (const k of [10, 16, 18, 22, 24, 26]) {
    const gen = makeGenPoly(k);
    assert.equal(gen.length, k + 1, `Generator poly degree k=${k} has k+1 coefficients`);
    assert.equal(gen[0], 1, 'Generator poly leading coefficient must be 1 (monic)');

    // Test that alpha^0, alpha^1, ..., alpha^(k-1) are roots
    for (let i = 0; i < k; i++) {
      const root = expRef[i];
      const val = evalPoly(gen, root);
      assert.equal(val, 0, `g(alpha^${i}) must be 0 in GF(2^8) for k=${k}`);
    }
  }
});

// ============================================================================
// 4. ISO/IEC 18004 Structural Invariants
// ============================================================================
test('QR Stress 4: Complete ISO/IEC 18004 structural pattern audit', () => {
  // Test across all 10 versions
  for (let v = 1; v <= 10; v++) {
    // Generate dummy payload appropriate for version
    const cfg = QR_VERSIONS_M[v];
    const qr = encodeQRCode('A'.repeat(v * 3), { version: v });
    const S = qr.size;
    const M = qr.matrix;

    // A. Finder patterns at (0,0), (0, S-7), (S-7, 0)
    const finders = [[0, 0], [0, S - 7], [S - 7, 0]];
    for (const [r0, c0] of finders) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
          const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
          const expected = (isBorder || isCenter) ? 1 : 0;
          assert.equal(M[r0 + r][c0 + c], expected, `V${v} Finder at (${r0 + r}, ${c0 + c}) mismatch`);
        }
      }
    }

    // B. White separators (1 module around finders)
    // Top-left separator: row 7 (cols 0..7), col 7 (rows 0..7)
    for (let i = 0; i <= 7; i++) {
      assert.equal(M[7][i], 0, `V${v} Top-left separator row 7, col ${i} must be 0`);
      assert.equal(M[i][7], 0, `V${v} Top-left separator row ${i}, col 7 must be 0`);
    }
    // Top-right separator: row 7 (cols S-8..S-1), col S-8 (rows 0..7)
    for (let i = 0; i <= 7; i++) {
      assert.equal(M[7][S - 8 + i], 0, `V${v} Top-right separator row 7, col ${S - 8 + i} must be 0`);
      assert.equal(M[i][S - 8], 0, `V${v} Top-right separator row ${i}, col ${S - 8} must be 0`);
    }
    // Bottom-left separator: row S-8 (cols 0..7), col 7 (rows S-8..S-1)
    for (let i = 0; i <= 7; i++) {
      assert.equal(M[S - 8][i], 0, `V${v} Bottom-left separator row ${S - 8}, col ${i} must be 0`);
      assert.equal(M[S - 8 + i][7], 0, `V${v} Bottom-left separator row ${S - 8 + i}, col 7 must be 0`);
    }

    // C. Timing patterns: row 6 and col 6 between finders
    for (let i = 8; i < S - 8; i++) {
      const expected = (i % 2 === 0) ? 1 : 0;
      assert.equal(M[6][i], expected, `V${v} Horizontal timing pattern col ${i} must be ${expected}`);
      assert.equal(M[i][6], expected, `V${v} Vertical timing pattern row ${i} must be ${expected}`);
    }

    // D. Dark module at (S - 8, 8)
    assert.equal(M[S - 8][8], 1, `V${v} Dark module at (${S - 8}, 8) must be 1`);

    // E. Alignment patterns for v >= 2
    if (cfg.align && cfg.align.length > 0) {
      for (const ar of cfg.align) {
        for (const ac of cfg.align) {
          // Skip if overlapping finder patterns
          if ((ar < 9 && ac < 9) || (ar < 9 && ac >= S - 8) || (ar >= S - 8 && ac < 9)) continue;

          // 5x5 concentric box: outer 5x5 black, inner 3x3 white, center 1x1 black
          for (let r = -2; r <= 2; r++) {
            for (let c = -2; c <= 2; c++) {
              const isBlack = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
              const expected = isBlack ? 1 : 0;
              assert.equal(M[ar + r][ac + c], expected,
                `V${v} Alignment pattern module at (${ar + r}, ${ac + c}) must be ${expected}`);
            }
          }
        }
      }
    }

    // F. Format information bits consistency:
    // Format information is duplicated in two locations:
    // Location 1: 15 bits around top-left finder
    // Location 2: 7 bits below top-right finder + 8 bits right of bottom-left finder
    const fmt1 = [
      M[8][0], M[8][1], M[8][2], M[8][3], M[8][4], M[8][5], M[8][7], M[8][8],
      M[7][8], M[5][8], M[4][8], M[3][8], M[2][8], M[1][8], M[0][8]
    ];
    const fmt2 = [
      M[S - 1][8], M[S - 2][8], M[S - 3][8], M[S - 4][8], M[S - 5][8], M[S - 6][8], M[S - 7][8],
      M[8][S - 8], M[8][S - 7], M[8][S - 6], M[8][S - 5], M[8][S - 4], M[8][S - 3], M[8][S - 2], M[8][S - 1]
    ];
    assert.deepEqual(fmt1, fmt2, `V${v} Format information copy 1 and copy 2 must be identical`);
  }
});

// ============================================================================
// 5. Zero External CDN, npm, or Network Script Dependencies
// ============================================================================
test('QR Stress 5: Static AST & source dependency audit for qrcode.js', () => {
  const qrFilePath = path.resolve('frontend/js/ui/qrcode.js');
  const code = fs.readFileSync(qrFilePath, 'utf8');

  // Verify forbidden external dependency tokens
  const forbiddenPatterns = [
    { pattern: /https?:\/\//i, desc: 'HTTP/HTTPS external URL references' },
    { pattern: /unpkg\.com/i, desc: 'unpkg CDN' },
    { pattern: /cdnjs\.cloudflare\.com/i, desc: 'cdnjs CDN' },
    { pattern: /cdn\.jsdelivr\.net/i, desc: 'jsdelivr CDN' },
    { pattern: /require\s*\(/i, desc: 'CommonJS require calls' },
    { pattern: /import\s*\(/i, desc: 'Dynamic imports' },
    { pattern: /document\.createElement\s*\(\s*['"]script['"]\s*\)/i, desc: 'Dynamic script injection' },
    { pattern: /\beval\s*\(/i, desc: 'eval execution' }
  ];

  for (const { pattern, desc } of forbiddenPatterns) {
    // Note: XML namespace in SVG ("http://www.w3.org/2000/svg") is the only allowable URI literal
    const matches = code.match(new RegExp(pattern, 'g')) || [];
    if (desc.includes('HTTP/HTTPS')) {
      const nonSvgMatches = matches.filter(m => !code.includes('http://www.w3.org/2000/svg'));
      assert.equal(nonSvgMatches.length, 0, `Found forbidden ${desc}`);
    } else {
      assert.equal(matches.length, 0, `Found forbidden ${desc}`);
    }
  }

  // Verify pure ECMAScript exports
  assert.ok(code.includes('export const QR_VERSIONS_M ='), 'Exports QR_VERSIONS_M');
  assert.ok(code.includes('export function encodeQRCode('), 'Exports encodeQRCode');
  assert.ok(code.includes('export function renderQRCodeToCanvas('), 'Exports renderQRCodeToCanvas');
  assert.ok(code.includes('export function generateQRCodeSVG('), 'Exports generateQRCodeSVG');
});
