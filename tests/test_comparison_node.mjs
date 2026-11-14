/**
 * tests/test_comparison_node.mjs
 * Node.js ES module unit tests for Milestone 5:
 * Historical Comparison Tool, Scientific Panel, and Telemetry.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ============================================================================
// 1. Historical Comparison Math: Resampling & Delta Calculation
// ============================================================================

test('Comparison: resampleSeries linear interpolation', async () => {
  const { resampleSeries } = await import('../frontend/js/comparison/comparison.js');

  // Empty and zero target length
  assert.deepEqual(resampleSeries([], 10), []);
  assert.deepEqual(resampleSeries([1, 2, 3], 0), []);

  // Single element expands uniformly
  assert.deepEqual(resampleSeries([5.0], 4), [5.0, 5.0, 5.0, 5.0]);

  // Same length returns exact copy
  const identical = [10.0, 20.0, 30.0];
  assert.deepEqual(resampleSeries(identical, 3), identical);

  // Linear ramp upsampling (2 points -> 5 points)
  // [0.0, 100.0] -> [0.0, 25.0, 50.0, 75.0, 100.0]
  const upsampled = resampleSeries([0.0, 100.0], 5);
  assert.equal(upsampled.length, 5);
  assert.ok(Math.abs(upsampled[0] - 0.0) < 1e-6);
  assert.ok(Math.abs(upsampled[1] - 25.0) < 1e-6);
  assert.ok(Math.abs(upsampled[2] - 50.0) < 1e-6);
  assert.ok(Math.abs(upsampled[3] - 75.0) < 1e-6);
  assert.ok(Math.abs(upsampled[4] - 100.0) < 1e-6);

  // Object array with .value property
  const objects = [{ value: 10 }, { value: 30 }];
  const resampledObjs = resampleSeries(objects, 3);
  assert.deepEqual(resampledObjs, [10, 20, 30]);
});

test('Comparison: calculateDeltaSeries B(t) - A(t) on uniform grid', async () => {
  const { calculateDeltaSeries } = await import('../frontend/js/comparison/comparison.js');

  // Identical series yields Delta = 0 across entire grid
  const seriesA = [0.2, 0.4, 0.6, 0.8];
  const seriesB = [0.2, 0.4, 0.6, 0.8];
  const deltasZero = calculateDeltaSeries(seriesA, seriesB, 10);

  assert.equal(deltasZero.length, 10);
  for (const pt of deltasZero) {
    assert.ok(Math.abs(pt.delta) < 1e-6, `Expected zero delta but got ${pt.delta}`);
    assert.ok(pt.t >= 0.0 && pt.t <= 1.0);
  }

  // Consistent warming offset (+0.5 °C everywhere)
  const warmA = [0.1, 0.2, 0.3];
  const warmB = [0.6, 0.7, 0.8];
  const deltasWarming = calculateDeltaSeries(warmA, warmB, 5);

  assert.equal(deltasWarming.length, 5);
  for (const pt of deltasWarming) {
    assert.ok(Math.abs(pt.delta - 0.5) < 1e-6, `Expected 0.5 delta but got ${pt.delta}`);
  }

  // First and last time normalized points
  assert.equal(deltasWarming[0].t, 0.0);
  assert.equal(deltasWarming[4].t, 1.0);
});

test('Comparison: calculateComparisonStats metrics and edge cases', async () => {
  const { calculateComparisonStats } = await import('../frontend/js/comparison/comparison.js');

  const valsA = [1.0, 2.0, 3.0]; // mean = 2.0, min = 1.0, max = 3.0
  const valsB = [3.0, 4.0, 5.0]; // mean = 4.0, min = 3.0, max = 5.0

  const stats = calculateComparisonStats(valsA, valsB);
  assert.equal(stats.meanA, 2.0);
  assert.equal(stats.meanB, 4.0);
  assert.equal(stats.minA, 1.0);
  assert.equal(stats.maxA, 3.0);
  assert.equal(stats.minB, 3.0);
  assert.equal(stats.maxB, 5.0);
  assert.equal(stats.deltaMean, 2.0); // 4.0 - 2.0 = +2.0
  assert.equal(stats.percentChange, 100.0); // (2.0 / 2.0) * 100 = 100%

  // Zero mean A handles division by zero safely
  const zeroMeanStats = calculateComparisonStats([0.0, 0.0], [1.0, 1.0]);
  assert.equal(zeroMeanStats.deltaMean, 1.0);
  assert.equal(zeroMeanStats.percentChange, 0.0); // Protected from NaN / Infinity
});

test('Comparison: PRESET_COMPARISONS and DATASET_OPTIONS catalog', async () => {
  const { PRESET_COMPARISONS, DATASET_OPTIONS } = await import('../frontend/js/comparison/comparison.js');

  assert.ok(PRESET_COMPARISONS.length >= 4);
  const presetIds = PRESET_COMPARISONS.map(p => p.id);
  assert.ok(presetIds.includes('2000_vs_2020'));
  assert.ok(presetIds.includes('baseline_vs_modern'));

  for (const preset of PRESET_COMPARISONS) {
    assert.ok(preset.id && preset.name && preset.a && preset.b);
    assert.ok(preset.a.includes(','));
    assert.ok(preset.b.includes(','));
  }

  assert.ok(DATASET_OPTIONS.length === 4);
  const dsIds = DATASET_OPTIONS.map(d => d.id);
  assert.ok(dsIds.includes('surface-temperature'));
  assert.ok(dsIds.includes('atmospheric-co2'));
  assert.ok(dsIds.includes('ocean-temperature'));
  assert.ok(dsIds.includes('sea-ice-extent'));
});

// ============================================================================
// 2. Scientific Information Panel Catalog Structure
// ============================================================================

test('ScientificPanel: LAYER_INFO_FALLBACK contains complete specifications', async () => {
  const { LAYER_INFO_FALLBACK } = await import('../frontend/js/ui/panel.js');

  const requiredLayers = [
    'surface-temperature',
    'atmospheric-co2',
    'ocean-temperature',
    'sea-ice-extent',
    'difference'
  ];

  for (const layerId of requiredLayers) {
    assert.ok(layerId in LAYER_INFO_FALLBACK, `Missing layer info for ${layerId}`);
    const info = LAYER_INFO_FALLBACK[layerId];

    assert.ok(info.title, `Missing title for ${layerId}`);
    assert.ok(info.nasa_source, `Missing nasa_source for ${layerId}`);
    assert.ok(info.units, `Missing units for ${layerId}`);
    assert.ok(info.scientific_rationale, `Missing scientific_rationale for ${layerId}`);
    assert.ok(info.synthesis_engine, `Missing synthesis_engine for ${layerId}`);
    assert.ok(info.musical_parameters, `Missing musical_parameters for ${layerId}`);
  }

  // Verify authentic citations
  assert.ok(LAYER_INFO_FALLBACK['surface-temperature'].nasa_source.includes('GISS'));
  assert.ok(LAYER_INFO_FALLBACK['atmospheric-co2'].nasa_source.includes('Global Monitoring Laboratory') || LAYER_INFO_FALLBACK['atmospheric-co2'].nasa_source.includes('GML'));
  assert.ok(LAYER_INFO_FALLBACK['ocean-temperature'].nasa_source.includes('NCEI'));
  assert.ok(LAYER_INFO_FALLBACK['sea-ice-extent'].nasa_source.includes('NSIDC'));
});

// ============================================================================
// 3. Telemetry Formatter
// ============================================================================

test('Telemetry: Mission time format and UTC structure', async () => {
  const { getFormattedMissionTime } = await import('../frontend/js/ui/telemetry.js');

  const formatted = getFormattedMissionTime();
  assert.ok(formatted.endsWith('UTC'), 'Mission time must end with UTC');
  assert.match(formatted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/);
});
