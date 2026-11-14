/**
 * tests/vr_timeline.test.mjs
 * Automated Node.js test runner suite for vr_timeline.js and vr_spline.js deprecation.
 *
 * Discovered automatically by bare `node --test` invocation.
 * Contains 11 test assertions verifying:
 * - Pure JS month-lookup logic and record interpolation
 * - Boundary conditions, clamps, empty records, and NaN robustness
 * - Zero Catmull-Rom or camera-path dependencies in vr_timeline.js
 * - vr_spline.js deprecation annotations
 * - Strict non-re-export invariant (vr_spline does NOT export TOTAL_MONTHS or interpolateHarmonizedRecord)
 * - Retention of Catmull-Rom and zero-roll frame calculations in vr_spline.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TOTAL_MONTHS,
  interpolateHarmonizedRecord,
  timelineToMonthIndex,
  monthIndexToTimeline,
  timelineToYearFraction
} from '../frontend/js/globe/vr/vr_timeline.js';

import * as vrSpline from '../frontend/js/globe/vr/vr_spline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('vr_timeline.js: Month-Lookup and Timeline Logic', () => {
  it('TIMELINE-01: Exports TOTAL_MONTHS constant equal to 573', () => {
    assert.strictEqual(typeof TOTAL_MONTHS, 'number');
    assert.strictEqual(TOTAL_MONTHS, 573);
  });

  it('TIMELINE-02: Exports interpolateHarmonizedRecord function', () => {
    assert.strictEqual(typeof interpolateHarmonizedRecord, 'function');
  });

  it('TIMELINE-03: Boundary checks at t=0.0 (Jan 1979) and t=1.0 (Sep 2026)', () => {
    const records = [
      { date: '1979-01', year: 1979, month: 1, temperature_anomaly: -0.08, co2_ppm: 336.14, ocean_temp_anomaly: 0.25, sea_ice_extent: 15.41 },
      { date: '2026-09', year: 2026, month: 9, temperature_anomaly: 1.00, co2_ppm: 426.50, ocean_temp_anomaly: 1.00, sea_ice_extent: 10.41 }
    ];

    const start = interpolateHarmonizedRecord(records, 0.0);
    assert.strictEqual(start.date, '1979-01');
    assert.strictEqual(start.year, 1979);
    assert.ok(Math.abs(start.temperature_anomaly - (-0.08)) < 1e-5);
    assert.ok(Math.abs(start.co2_ppm - 336.14) < 1e-4);

    const end = interpolateHarmonizedRecord(records, 1.0);
    assert.strictEqual(end.date, '2026-09');
    assert.strictEqual(end.year, 2026);
    assert.ok(Math.abs(end.temperature_anomaly - 1.00) < 1e-5);
    assert.ok(Math.abs(end.co2_ppm - 426.50) < 1e-4);
  });

  it('TIMELINE-04: Fractional interpolation at t=0.5', () => {
    const records = [
      { date: '1979-01', year: 1979, month: 1, temperature_anomaly: 0.0, co2_ppm: 300.0 },
      { date: '2026-09', year: 2026, month: 9, temperature_anomaly: 1.0, co2_ppm: 400.0 }
    ];
    const mid = interpolateHarmonizedRecord(records, 0.5);
    assert.ok(Math.abs(mid.temperature_anomaly - 0.5) < 1e-5);
    assert.ok(Math.abs(mid.co2_ppm - 350.0) < 1e-4);
  });

  it('TIMELINE-05: Robustness under negative t, overflow t, NaN, and empty records', () => {
    const records = [{ date: '1979-01', temperature_anomaly: 0.1, co2_ppm: 336.0 }];
    const neg = interpolateHarmonizedRecord(records, -10.0);
    assert.strictEqual(neg.date, '1979-01');

    const over = interpolateHarmonizedRecord(records, 5.0);
    assert.strictEqual(over.date, '1979-01');

    const nanRec = interpolateHarmonizedRecord(records, NaN);
    assert.ok(!isNaN(nanRec.co2_ppm));

    const empty = interpolateHarmonizedRecord([], 0.5);
    assert.strictEqual(empty.date, '1979-01');
    assert.strictEqual(empty.co2_ppm, 336.14);
  });

  it('TIMELINE-06: vr_timeline.js has ZERO Catmull-Rom or camera-path dependencies', () => {
    const timelineSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'js', 'globe', 'vr', 'vr_timeline.js'), 'utf8');
    assert.ok(!timelineSrc.includes('CentripetalCatmullRomSpline'));
    assert.ok(!timelineSrc.includes('createTimeSpline'));
    assert.ok(!timelineSrc.includes('getSplineFrame'));
    assert.ok(!timelineSrc.includes('SplineVector3'));
    assert.ok(!timelineSrc.includes('SKIM_ALTITUDE'));
  });
});

describe('vr_spline.js: Deprecation & Catmull-Rom Boundary Invariants', () => {
  it('SPLINE-01: vr_spline.js is clearly marked @deprecated in header docblock', () => {
    const splineSrc = fs.readFileSync(path.join(rootDir, 'frontend', 'js', 'globe', 'vr', 'vr_spline.js'), 'utf8');
    assert.ok(splineSrc.includes('@deprecated'), 'vr_spline.js must contain @deprecated annotation');
  });

  it('SPLINE-02: vr_spline.js does NOT export TOTAL_MONTHS (no re-export)', () => {
    assert.strictEqual(vrSpline.TOTAL_MONTHS, undefined, 'vr_spline.js must NOT export TOTAL_MONTHS');
  });

  it('SPLINE-03: vr_spline.js does NOT export interpolateHarmonizedRecord (no re-export)', () => {
    assert.strictEqual(vrSpline.interpolateHarmonizedRecord, undefined, 'vr_spline.js must NOT export interpolateHarmonizedRecord');
  });

  it('SPLINE-04: vr_spline.js retains Catmull-Rom & camera path exports', () => {
    assert.strictEqual(typeof vrSpline.SKIM_ALTITUDE, 'number');
    assert.strictEqual(typeof vrSpline.createTimeSpline, 'function');
    assert.strictEqual(typeof vrSpline.getSplineFrame, 'function');
    assert.strictEqual(typeof vrSpline.CentripetalCatmullRomSpline, 'function');
    assert.strictEqual(typeof vrSpline.SplineVector3, 'function');
  });

  it('SPLINE-05: createTimeSpline constructs 573-point curve with roll = 0.0 frame', () => {
    const spline = vrSpline.createTimeSpline();
    assert.strictEqual(spline.points.length, 573);
    const frame = vrSpline.getSplineFrame(spline, 0.5);
    assert.ok(Math.abs(frame.position.length() - 10.22) < 1e-4);
    assert.ok(Math.abs(frame.up.dot(frame.forward)) < 1e-5);
  });
});
