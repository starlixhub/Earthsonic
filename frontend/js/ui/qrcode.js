/**
 * frontend/js/ui/qrcode.js
 * Standalone Pure JavaScript QR Code Generator (ISO/IEC 18004:2015 Compliant).
 * NASA Space Apps Challenge / EARTHSONIC "Terminator Skim" Mobile VR Bridge.
 *
 * Capabilities:
 *   - Auto-selects QR Version (1 to 10) based on payload length
 *   - Byte-mode encoding with Reed-Solomon Error Correction (Level M standard)
 *   - Dynamic ISO penalty scoring across all 8 masks for maximum scan reliability
 *   - Direct rendering to HTML5 <canvas> or SVG output
 *   - Zero external runtime or network package dependencies
 */

// 1. Galois Field GF(2^8) Primitive Polynomial: x^8 + x^4 + x^3 + x^2 + 1 = 285 (0x11D)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    EXP[i + 255] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 256) x ^= 0x11D;
  }
  LOG[0] = 0; // Guard
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

// 2. Reed-Solomon Polynomial Generator & Remainder
function rsGeneratorPoly(k) {
  let g = [1];
  for (let i = 0; i < k; i++) {
    const next = new Array(g.length + 1).fill(0);
    const factor = EXP[i];
    for (let j = 0; j < g.length; j++) {
      next[j] ^= gfMul(g[j], factor);
      next[j + 1] ^= g[j];
    }
    g = next;
  }
  return g.reverse();
}

function rsComputeRemainder(data, numEcc) {
  const gen = rsGeneratorPoly(numEcc);
  const msg = new Uint8Array(data.length + numEcc);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return Array.from(msg.slice(data.length));
}

// 3. QR Code Configuration Tables (Versions 1 to 10, Error Correction Level M)
// Format: { size, totalBytes, blocks: [{ count, data, ec }], align: [], remainder }
export const QR_VERSIONS_M = {
  1:  { size: 21, totalBytes: 26,  blocks: [{ count: 1, data: 16, ec: 10 }], align: [], remainder: 0 },
  2:  { size: 25, totalBytes: 44,  blocks: [{ count: 1, data: 28, ec: 16 }], align: [6, 18], remainder: 7 },
  3:  { size: 29, totalBytes: 70,  blocks: [{ count: 1, data: 44, ec: 26 }], align: [6, 22], remainder: 7 },
  4:  { size: 33, totalBytes: 100, blocks: [{ count: 2, data: 32, ec: 18 }], align: [6, 26], remainder: 7 },
  5:  { size: 37, totalBytes: 134, blocks: [{ count: 2, data: 43, ec: 24 }], align: [6, 30], remainder: 7 },
  6:  { size: 41, totalBytes: 172, blocks: [{ count: 4, data: 27, ec: 16 }], align: [6, 34], remainder: 7 },
  7:  { size: 45, totalBytes: 196, blocks: [{ count: 2, data: 31, ec: 18 }, { count: 2, data: 32, ec: 18 }], align: [6, 22, 38], remainder: 0 },
  8:  { size: 49, totalBytes: 242, blocks: [{ count: 2, data: 38, ec: 22 }, { count: 2, data: 39, ec: 22 }], align: [6, 24, 42], remainder: 0 },
  9:  { size: 53, totalBytes: 292, blocks: [{ count: 3, data: 36, ec: 22 }, { count: 2, data: 37, ec: 22 }], align: [6, 26, 46], remainder: 0 },
  10: { size: 57, totalBytes: 346, blocks: [{ count: 4, data: 43, ec: 26 }, { count: 1, data: 44, ec: 26 }], align: [6, 28, 50], remainder: 0 }
};

// 4. UTF-8 String Encoder
function stringToUtf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    } else {
      i++;
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      bytes.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return new Uint8Array(bytes);
}

// 5. Version Info BCH(18, 6) for Versions 7+
const VERSION_BCH_GEN = 0x1F25;
function getVersionInfoBits(ver) {
  let rem = ver;
  for (let i = 0; i < 12; i++) {
    rem = (rem << 1) ^ ((rem >> 11) * VERSION_BCH_GEN);
  }
  return (ver << 12) | rem;
}

// 6. Format Info BCH(15, 5) with XOR Mask 0x5412
const FORMAT_BCH_GEN = 0x537;
const FORMAT_XOR_MASK = 0x5412;
function getFormatInfoBits(ecLevelBits, mask) {
  const data = (ecLevelBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ ((rem >> 9) * FORMAT_BCH_GEN);
  }
  return ((data << 10) | rem) ^ FORMAT_XOR_MASK;
}

// 7. Core Matrix Generator
export function encodeQRCode(text, options = {}) {
  const utf8 = stringToUtf8Bytes(text);
  const dataLen = utf8.length;

  // Find minimum version that fits data
  let version = options.version || 0;
  if (!version) {
    for (let v = 1; v <= 10; v++) {
      const cfg = QR_VERSIONS_M[v];
      let capacity = 0;
      for (const b of cfg.blocks) capacity += b.count * b.data;
      const countBits = v >= 10 ? 16 : 8;
      const requiredBits = 4 + countBits + (dataLen * 8);
      if (requiredBits <= capacity * 8) {
        version = v;
        break;
      }
    }
  }

  if (!version || version > 10) {
    throw new Error(`[QRCode] Payload too long for embedded QR encoder (${dataLen} bytes).`);
  }

  const cfg = QR_VERSIONS_M[version];
  let totalDataBytes = 0;
  for (const b of cfg.blocks) totalDataBytes += b.count * b.data;

  // Frame Bitstream
  const bits = [];
  function pushBits(val, len) {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  }

  // Byte mode indicator: 0100
  pushBits(0b0100, 4);
  // Character count indicator
  pushBits(dataLen, version >= 10 ? 16 : 8);
  // Data bytes
  for (let i = 0; i < dataLen; i++) pushBits(utf8[i], 8);

  // Terminator (up to 4 bits)
  const maxDataBits = totalDataBytes * 8;
  const termLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, termLen);

  // Align to byte boundary
  while (bits.length % 8 !== 0) bits.push(0);

  // Pad bytes 0xEC, 0x11
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (bits.length < maxDataBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Convert bits to data codewords
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    dataCodewords.push(b);
  }

  // Split into blocks and compute Reed-Solomon Error Correction
  const blockDataList = [];
  const blockEcList = [];
  let cwOffset = 0;
  for (const b of cfg.blocks) {
    for (let c = 0; c < b.count; c++) {
      const slice = dataCodewords.slice(cwOffset, cwOffset + b.data);
      cwOffset += b.data;
      blockDataList.push(slice);
      blockEcList.push(rsComputeRemainder(slice, b.ec));
    }
  }

  // Interleave Data Codewords
  const finalCodewords = [];
  const maxD = Math.max(...blockDataList.map(b => b.length));
  for (let i = 0; i < maxD; i++) {
    for (let b = 0; b < blockDataList.length; b++) {
      if (i < blockDataList[b].length) finalCodewords.push(blockDataList[b][i]);
    }
  }

  // Interleave EC Codewords
  const maxE = Math.max(...blockEcList.map(b => b.length));
  for (let i = 0; i < maxE; i++) {
    for (let b = 0; b < blockEcList.length; b++) {
      if (i < blockEcList[b].length) finalCodewords.push(blockEcList[b][i]);
    }
  }

  // Convert final codewords to bitstream + remainder bits
  const finalBits = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) finalBits.push((cw >> i) & 1);
  }
  for (let i = 0; i < cfg.remainder; i++) finalBits.push(0);

  // Create Matrix and Function Mask
  const S = cfg.size;
  const matrix = Array.from({ length: S }, () => new Array(S).fill(null));
  const isFunction = Array.from({ length: S }, () => new Array(S).fill(false));

  function setFunction(r, c, val) {
    matrix[r][c] = val;
    isFunction[r][c] = true;
  }

  // Finder Patterns + 1-Module White Separator
  function drawFinder(row, col) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr < 0 || mr >= S || mc < 0 || mc >= S) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBlack = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
          setFunction(mr, mc, isBlack ? 1 : 0);
        } else {
          setFunction(mr, mc, 0);
        }
      }
    }
  }
  drawFinder(0, 0);
  drawFinder(0, S - 7);
  drawFinder(S - 7, 0);

  // Alignment Patterns
  if (cfg.align && cfg.align.length > 0) {
    for (const ar of cfg.align) {
      for (const ac of cfg.align) {
        if ((ar < 9 && ac < 9) || (ar < 9 && ac >= S - 8) || (ar >= S - 8 && ac < 9)) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const isBlack = (Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
            setFunction(ar + r, ac + c, isBlack ? 1 : 0);
          }
        }
      }
    }
  }

  // Timing Patterns
  for (let i = 8; i < S - 8; i++) {
    if (!isFunction[6][i]) setFunction(6, i, i % 2 === 0 ? 1 : 0);
    if (!isFunction[i][6]) setFunction(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Dark Module
  setFunction(S - 8, 8, 1);

  // Reserve Format Information Areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) { matrix[8][i] = 0; isFunction[8][i] = true; }
    if (!isFunction[i][8]) { matrix[i][8] = 0; isFunction[i][8] = true; }
  }
  for (let i = S - 8; i < S; i++) {
    if (!isFunction[8][i]) { matrix[8][i] = 0; isFunction[8][i] = true; }
    if (!isFunction[i][8]) { matrix[i][8] = 0; isFunction[i][8] = true; }
  }

  // Reserve Version Info Areas (Versions 7+)
  if (version >= 7) {
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 3; c++) {
        setFunction(r, S - 11 + c, 0);
        setFunction(S - 11 + c, r, 0);
      }
    }
  }

  // Mask Pattern Definitions
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  // Evaluate All 8 Masks to Find Minimum Penalty
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestMatrix = null;

  for (let m = 0; m < 8; m++) {
    const testMatrix = matrix.map(row => [...row]);
    const maskFn = maskFns[m];
    let bitIdx = 0;
    let upward = true;

    for (let c = S - 1; c > 0; c -= 2) {
      if (c === 6) c--; // Skip vertical timing column
      const rows = upward
        ? Array.from({ length: S }, (_, i) => S - 1 - i)
        : Array.from({ length: S }, (_, i) => i);

      for (const r of rows) {
        for (const col of [c, c - 1]) {
          if (!isFunction[r][col]) {
            let bit = bitIdx < finalBits.length ? finalBits[bitIdx] : 0;
            if (maskFn(r, col)) bit ^= 1;
            testMatrix[r][col] = bit;
            bitIdx++;
          }
        }
      }
      upward = !upward;
    }

    // Write Format Information (Level M = 00)
    const fmt = getFormatInfoBits(0, m);

    // Around top-left
    testMatrix[8][0] = (fmt >> 0) & 1;
    testMatrix[8][1] = (fmt >> 1) & 1;
    testMatrix[8][2] = (fmt >> 2) & 1;
    testMatrix[8][3] = (fmt >> 3) & 1;
    testMatrix[8][4] = (fmt >> 4) & 1;
    testMatrix[8][5] = (fmt >> 5) & 1;
    testMatrix[8][7] = (fmt >> 6) & 1;
    testMatrix[8][8] = (fmt >> 7) & 1;
    testMatrix[7][8] = (fmt >> 8) & 1;
    testMatrix[5][8] = (fmt >> 9) & 1;
    testMatrix[4][8] = (fmt >> 10) & 1;
    testMatrix[3][8] = (fmt >> 11) & 1;
    testMatrix[2][8] = (fmt >> 12) & 1;
    testMatrix[1][8] = (fmt >> 13) & 1;
    testMatrix[0][8] = (fmt >> 14) & 1;

    // Split between bottom-left and top-right
    for (let i = 0; i < 7; i++) {
      testMatrix[S - 1 - i][8] = (fmt >> i) & 1;
    }
    for (let i = 0; i < 8; i++) {
      testMatrix[8][S - 8 + i] = (fmt >> (7 + i)) & 1;
    }

    // Write Version Information if Version >= 7
    if (version >= 7) {
      const vBits = getVersionInfoBits(version);
      let bitPos = 0;
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 3; c++) {
          const bitVal = (vBits >> bitPos) & 1;
          testMatrix[r][S - 11 + c] = bitVal;
          testMatrix[S - 11 + c][r] = bitVal;
          bitPos++;
        }
      }
    }

    // Calculate Penalty Score
    let penalty = 0;

    // N1: Runs of 5+ same color in rows and columns
    for (let r = 0; r < S; r++) {
      let runC = testMatrix[r][0], runL = 1;
      for (let c = 1; c < S; c++) {
        if (testMatrix[r][c] === runC) runL++;
        else {
          if (runL >= 5) penalty += 3 + (runL - 5);
          runC = testMatrix[r][c]; runL = 1;
        }
      }
      if (runL >= 5) penalty += 3 + (runL - 5);
    }
    for (let c = 0; c < S; c++) {
      let runC = testMatrix[0][c], runL = 1;
      for (let r = 1; r < S; r++) {
        if (testMatrix[r][c] === runC) runL++;
        else {
          if (runL >= 5) penalty += 3 + (runL - 5);
          runC = testMatrix[r][c]; runL = 1;
        }
      }
      if (runL >= 5) penalty += 3 + (runL - 5);
    }

    // N2: 2x2 blocks of same color
    for (let r = 0; r < S - 1; r++) {
      for (let c = 0; c < S - 1; c++) {
        const val = testMatrix[r][c];
        if (val === testMatrix[r + 1][c] && val === testMatrix[r][c + 1] && val === testMatrix[r + 1][c + 1]) {
          penalty += 3;
        }
      }
    }

    // N4: Balance of dark vs light modules
    let darkTotal = 0;
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        if (testMatrix[r][c] === 1) darkTotal++;
      }
    }
    const ratioPct = (darkTotal / (S * S)) * 100;
    penalty += Math.floor(Math.abs(ratioPct - 50) / 5) * 10;

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = m;
      bestMatrix = testMatrix;
    }
  }

  return {
    version,
    size: S,
    mask: bestMask,
    matrix: bestMatrix,
    isDark: (r, c) => bestMatrix[r][c] === 1
  };
}

// 8. Public Canvas Renderer
export function renderQRCodeToCanvas(canvas, text, options = {}) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new Error('[QRCode] Valid HTML5 <canvas> element required.');
  }

  const targetSize = options.size || 220;
  const margin = options.margin !== undefined ? options.margin : 4;
  const darkColor = options.darkColor || '#060a12';
  const lightColor = options.lightColor || '#ffffff';

  const qr = encodeQRCode(text, options);
  const totalModules = qr.size + (margin * 2);
  const scale = Math.max(1, Math.floor(targetSize / totalModules));
  const renderSize = totalModules * scale;

  canvas.width = renderSize;
  canvas.height = renderSize;
  canvas.style.width = `${targetSize}px`;
  canvas.style.height = `${targetSize}px`;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Background
  ctx.fillStyle = lightColor;
  ctx.fillRect(0, 0, renderSize, renderSize);

  // Modules
  ctx.fillStyle = darkColor;
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r][c] === 1) {
        ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
  }

  return qr;
}

// 9. Public SVG String Generator
export function generateQRCodeSVG(text, options = {}) {
  const margin = options.margin !== undefined ? options.margin : 4;
  const darkColor = options.darkColor || '#060a12';
  const lightColor = options.lightColor || '#ffffff';

  const qr = encodeQRCode(text, options);
  const totalModules = qr.size + (margin * 2);

  let pathData = '';
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.matrix[r][c] === 1) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges">
  <rect width="${totalModules}" height="${totalModules}" fill="${lightColor}"/>
  <path d="${pathData.trim()}" fill="${darkColor}"/>
</svg>`;
}
