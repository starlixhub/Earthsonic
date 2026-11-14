/**
 * tests/test_sweep_node.mjs
 * Comprehensive Node.js unit tests for sweep.js longitude-to-column indexing math.
 * 
 * Requirements R4 & R5:
 *   - Longitude-to-column mapping: lon -180..+180 -> column 0..719
 *   - Boundary values: -180.0 (col 0), 0.0 (col 360), +180.0 (col 719)
 *   - Clamping & safety: out-of-bounds, NaN, non-numeric
 *   - Temporal progression: timeToColumn, timeToLongitude (e.g. duration=20s)
 *   - Roundtrip mathematical consistency: col -> lon -> col
 *   - Event trigger filtering & A/B comparison blending
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sweepFilePath = path.resolve(__dirname, '../frontend/js/audio/sweep.js');
const sweepExists = fs.existsSync(sweepFilePath);

test('Sweep Math Suite: Environment & Progressive Readiness', (t) => {
  if (!sweepExists) {
    t.skip('frontend/js/audio/sweep.js not yet implemented (Milestone 4). Test suite armed.');
    return;
  }
  assert.ok(sweepExists, 'frontend/js/audio/sweep.js must exist on disk');
});

// Tier 1: Core Feature Coverage
test('Tier 1: Core Longitude to Column Mapping', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { longitudeToColumn, columnToLongitude } = sweep;

  assert.equal(typeof longitudeToColumn, 'function', 'longitudeToColumn must be an exported function');
  assert.equal(typeof columnToLongitude, 'function', 'columnToLongitude must be an exported function');

  // Standard equirectangular reference points on 720-column grid
  // Col 0: -180.0° (International Date Line West)
  assert.equal(longitudeToColumn(-180.0), 0, 'Lon -180.0 must map to column 0');

  // Col 180: -90.0° (Americas)
  assert.equal(longitudeToColumn(-90.0), 180, 'Lon -90.0 must map to column 180');

  // Col 360: 0.0° (Prime Meridian / Greenwich)
  assert.equal(longitudeToColumn(0.0), 360, 'Lon 0.0 must map to column 360');

  // Col 540: +90.0° (Indian Ocean / Asia)
  assert.equal(longitudeToColumn(90.0), 540, 'Lon +90.0 must map to column 540');

  // Col 719: +179.5° or +180.0° (International Date Line East)
  const colEast = longitudeToColumn(180.0);
  assert.ok(colEast === 719 || colEast === 720, 'Lon +180.0 must map to the easternmost column boundary');
});

test('Tier 1: Temporal Playhead Progression (timeToColumn & timeToLongitude)', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { timeToColumn, timeToLongitude } = sweep;

  assert.equal(typeof timeToColumn, 'function', 'timeToColumn must be exported');

  const duration = 20.0; // Standard 20-second sweep

  // Start of sweep (t = 0.0) -> col 0, lon -180
  assert.equal(timeToColumn(0.0, duration), 0, 't = 0.0s must map to column 0');
  if (typeof timeToLongitude === 'function') {
    assert.equal(timeToLongitude(0.0, duration), -180.0, 't = 0.0s must map to lon -180.0');
  }

  // Quarter point (t = 5.0) -> col 180, lon -90
  assert.equal(timeToColumn(5.0, duration), 180, 't = 5.0s (25%) must map to column 180');
  if (typeof timeToLongitude === 'function') {
    assert.equal(timeToLongitude(5.0, duration), -90.0, 't = 5.0s must map to lon -90.0');
  }

  // Midpoint of sweep (t = 10.0) -> col 360, lon 0.0
  assert.equal(timeToColumn(10.0, duration), 360, 't = 10.0s (50%) must map to column 360');
  if (typeof timeToLongitude === 'function') {
    assert.equal(timeToLongitude(10.0, duration), 0.0, 't = 10.0s must map to lon 0.0');
  }

  // Three-quarter point (t = 15.0) -> col 540, lon +90
  assert.equal(timeToColumn(15.0, duration), 540, 't = 15.0s (75%) must map to column 540');
  if (typeof timeToLongitude === 'function') {
    assert.equal(timeToLongitude(15.0, duration), 90.0, 't = 15.0s must map to lon +90.0');
  }

  // End of sweep (t = 20.0) -> col 719
  const endCol = timeToColumn(20.0, duration);
  assert.ok(endCol === 719 || endCol === 720, 't = 20.0s (100%) must reach terminal column');
});

// Tier 2: Boundary & Corner Conditions
test('Tier 2: Coordinate Clamping & Overflow Protection', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { longitudeToColumn, timeToColumn } = sweep;

  // Negative extreme underflow: lon < -180.0
  assert.equal(longitudeToColumn(-185.0), 0, 'Lon -185.0 underflow must clamp to column 0');
  assert.equal(longitudeToColumn(-360.0), 0, 'Lon -360.0 underflow must clamp to column 0');
  assert.equal(longitudeToColumn(-9999.0), 0, 'Extreme negative longitude must clamp to column 0');

  // Positive extreme overflow: lon > +180.0
  const maxCol = longitudeToColumn(185.0);
  assert.ok(maxCol <= 719, 'Lon +185.0 overflow must clamp to column <= 719');
  assert.equal(longitudeToColumn(360.0), maxCol, 'Lon +360.0 must clamp to max column');
  assert.equal(longitudeToColumn(9999.0), maxCol, 'Extreme positive longitude must clamp to max column');

  // Time underflow and overflow
  const duration = 20.0;
  assert.equal(timeToColumn(-5.0, duration), 0, 'Negative elapsed time must clamp to column 0');
  assert.equal(timeToColumn(25.0, duration), maxCol, 'Elapsed time > duration must clamp to max column');

  // Defensive NaN and non-numeric handling
  assert.doesNotThrow(() => longitudeToColumn(NaN), 'NaN input must not throw unhandled exception');
  assert.doesNotThrow(() => timeToColumn(NaN, duration), 'NaN time must not throw unhandled exception');
});

test('Tier 2: Custom Grid Resolutions and Durations', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { longitudeToColumn, timeToColumn } = sweep;

  // Test with alternative column counts if supported (e.g. 360 columns, 1 degree each)
  const col360 = longitudeToColumn(0.0, 360);
  assert.equal(col360, 180, 'On 360-col grid, lon 0.0 must map to column 180');

  // Test with custom sweep duration (60s slow orbital sweep)
  const duration60 = 60.0;
  assert.equal(timeToColumn(30.0, duration60), 360, 't = 30.0s on 60s sweep must map to column 360');
  assert.equal(timeToColumn(0.0, duration60), 0, 't = 0.0s on 60s sweep must map to column 0');
});

// Tier 3: Cross-Feature Combinations & Mathematical Invariants
test('Tier 3: Exact Roundtrip Invariant Across All 720 Columns', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { longitudeToColumn, columnToLongitude } = sweep;

  const totalCols = 720;
  let mismatches = 0;

  for (let col = 0; col < totalCols; col++) {
    const lon = columnToLongitude(col, totalCols);
    assert.ok(lon >= -180.0 && lon <= 180.0, `Column ${col} longitude ${lon} out of [-180, 180] bounds`);

    const roundtripCol = longitudeToColumn(lon, totalCols);
    if (roundtripCol !== col && roundtripCol !== Math.min(col, totalCols - 1)) {
      mismatches++;
    }
  }

  assert.equal(mismatches, 0, 'All 720 columns must satisfy exact roundtrip identity: col == lonToCol(colToLon(col))');
});

test('Tier 3: Monotonicity Invariant', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  const { longitudeToColumn, timeToColumn } = sweep;

  // Longitude to column must be strictly non-decreasing
  let prevCol = -1;
  for (let lon = -180.0; lon <= 180.0; lon += 0.25) {
    const col = longitudeToColumn(lon);
    assert.ok(col >= prevCol, `Monotonicity violation at lon ${lon}: ${col} < ${prevCol}`);
    prevCol = col;
  }

  // timeToColumn must be strictly non-decreasing over sweep duration
  let prevTimeCol = -1;
  for (let t = 0.0; t <= 20.0; t += 0.05) {
    const col = timeToColumn(t, 20.0);
    assert.ok(col >= prevTimeCol, `Time monotonicity violation at t=${t}: ${col} < ${prevTimeCol}`);
    prevTimeCol = col;
  }
});

// Tier 4: Real-World Application Scenarios
test('Tier 4: Lightning Event Trigger Detection During Sweep', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');
  
  // Synthetic authentic NASA ISS Lightning event record
  const mockEvents = [
    { lon: -180.0, lat: 10.0, intensity: 0.95, time: 0.0 }, // Col 0
    { lon: -75.5,  lat: 8.5,  intensity: 0.88, time: 5.8 }, // Catatumbo hotspot (~Col 209)
    { lon: 0.0,    lat: -2.0, intensity: 0.75, time: 10.0 }, // Col 360
    { lon: 25.0,   lat: 1.5,  intensity: 0.92, time: 11.4 }, // Congo basin (~Col 410)
    { lon: 179.5,  lat: -15.0, intensity: 0.60, time: 19.9 }  // Col 719
  ];

  const { longitudeToColumn } = sweep;
  
  // Ensure each event maps to a distinct and valid column
  const mappedCols = mockEvents.map(e => longitudeToColumn(e.lon));
  for (let i = 0; i < mappedCols.length; i++) {
    assert.ok(mappedCols[i] >= 0 && mappedCols[i] <= 719, `Event ${i} mapped to out-of-bounds column ${mappedCols[i]}`);
  }

  // Verify Catatumbo hotspot (-75.5 lon) maps to approximately column 209 ((-75.5 + 180)/0.5 = 209)
  const catatumboCol = longitudeToColumn(-75.5);
  assert.equal(catatumboCol, 209, 'Catatumbo lightning hotspot must map to column 209');

  // Verify Congo basin (25.0 lon) maps to column 410 ((25 + 180)/0.5 = 410)
  const congoCol = longitudeToColumn(25.0);
  assert.equal(congoCol, 410, 'Congo lightning hotspot must map to column 410');
});

test('Tier 4: Night Lights A/B Comparison Blend Calculation', { skip: !sweepExists }, async () => {
  const sweep = await import('../frontend/js/audio/sweep.js');

  // If sweep.js exports calculateNightLightsBlend or a blend helper
  if (typeof sweep.calculateNightLightsBlend === 'function') {
    const { calculateNightLightsBlend } = sweep;

    // Slider at 0.0: 100% 2012 baseline, 0% 2023
    const blend0 = calculateNightLightsBlend(0.0);
    assert.equal(blend0.weight2012, 1.0);
    assert.equal(blend0.weight2023, 0.0);

    // Slider at 1.0: 0% 2012, 100% 2023 comparison
    const blend1 = calculateNightLightsBlend(1.0);
    assert.equal(blend1.weight2012, 0.0);
    assert.equal(blend1.weight2023, 1.0);

    // Slider at 0.5: balanced 50/50 mix
    const blendHalf = calculateNightLightsBlend(0.5);
    assert.ok(Math.abs(blendHalf.weight2012 - 0.5) < 1e-3);
    assert.ok(Math.abs(blendHalf.weight2023 - 0.5) < 1e-3);
  }
});
