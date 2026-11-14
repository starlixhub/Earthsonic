/**
 * tests/test_challenger_m3_fix_verification.mjs
 * Empirical Challenger Verification & Stress Harness for Milestone M3 Fix.
 *
 * Evaluates:
 * 1. Challenge 3.1 Reproduction: 60 FPS continuous scrubbing throttling (<= 26 seeks, >= 20 seeks, end ~30s).
 * 2. Continuous fast scrubbing across entire timeline [0, 1] across varying durations (10s, 30s, 60s).
 * 3. Rapid zigzag scrubbing back and forth (frequency stress, reversal tracking, rate limiting).
 * 4. Discrete instant jumps (inter-jump latency, boundary transition).
 * 5. Boundary hits (t=0.0 and t=1.0 throttle bypass, subsequent stationary hold idempotency).
 * 6. Stationary hold (zero duplicate seeks dispatched when position does not change).
 * 7. Exhaustive non-finite / invalid input fuzzing (NaN, Inf, -Inf, negatives, strings, null, undefined).
 * 8. Dual mixer API verification (seekProgress vs seek, fallback durations).
 * 9. Globe.js pristine invariant verification.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VRSpatialAudio } from '../frontend/js/globe/vr/vr_audio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to create mock mixer with telemetry capture
function createMockMixer({ duration = 30.0, mode = 'both' } = {}) {
  const seekCalls = [];
  const seekProgressCalls = [];

  const mixer = {
    duration,
    getAllTracks: () => []
  };

  if (mode === 'both' || mode === 'progress') {
    mixer.seekProgress = (t) => {
      seekProgressCalls.push({ t, time: mixer._now ? mixer._now() : 0 });
    };
  }

  if (mode === 'both' || mode === 'seconds') {
    mixer.seek = (s) => {
      seekCalls.push({ s, time: mixer._now ? mixer._now() : 0 });
    };
  }

  return { mixer, seekCalls, seekProgressCalls };
}

describe('Challenger M3 Fix: Empirical Verification & Stress Harness', () => {

  // --------------------------------------------------------------------------
  // 1. Challenge 3.1 Strict Verification
  // --------------------------------------------------------------------------
  it('Verification 1: Challenge 3.1 Throttling Invariant (<= 26 seeks, >= 20 seeks, final seek ~30.0s)', () => {
    let seekCount = 0;
    let lastSeekSeconds = -1;
    const seekLog = [];

    const mockMixer = {
      duration: 30.0,
      seekProgress: (t) => {
        seekCount++;
        lastSeekSeconds = t * 30.0;
        seekLog.push({ t, s: lastSeekSeconds });
      },
      seek: (s) => {
        seekCount++;
        lastSeekSeconds = s;
        seekLog.push({ t: s / 30.0, s });
      }
    };

    const spatialAudio = new VRSpatialAudio({ mixer: mockMixer });
    let simulatedNow = 1000.0;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simulatedNow };

    for (let frame = 0; frame < 60; frame++) {
      simulatedNow += 16.6667; // 60 FPS step
      const progress = frame / 59.0;
      spatialAudio.syncPlayhead(progress);
    }

    globalThis.performance = origPerformance;
    spatialAudio.dispose();

    assert.ok(seekCount <= 26, `Expected <= 26 seeks, got ${seekCount}`);
    assert.ok(seekCount >= 20, `Expected >= 20 seeks, got ${seekCount}`);
    assert.ok(Math.abs(lastSeekSeconds - 30.0) < 1.0, `Final seek should be ~30.0s, got ${lastSeekSeconds}`);

    // Verify all logged seeks are monotonically non-decreasing
    for (let i = 1; i < seekLog.length; i++) {
      assert.ok(seekLog[i].s >= seekLog[i - 1].s, `Seek at index ${i} (${seekLog[i].s}) < previous (${seekLog[i - 1].s})`);
    }
  });

  // --------------------------------------------------------------------------
  // 2. 60 FPS Continuous Fast Scrubbing Across Diverse Durations
  // --------------------------------------------------------------------------
  it('Verification 2: 60 FPS Continuous Scrubbing Across Entire Timeline [0, 1] (Durations: 10s, 30s, 60s, 120s)', () => {
    const durations = [10.0, 30.0, 60.0, 120.0];

    for (const dur of durations) {
      const { mixer, seekProgressCalls } = createMockMixer({ duration: dur, mode: 'progress' });
      const spatialAudio = new VRSpatialAudio({ mixer });

      let simTime = 1000.0;
      mixer._now = () => simTime;
      spatialAudio.lastSeekTime = 0.0;
      spatialAudio.lastSeekTarget = -1.0;

      const origPerformance = globalThis.performance;
      globalThis.performance = { now: () => simTime };

      // 60 frames across 1000ms
      for (let f = 0; f < 60; f++) {
        simTime += 16.66667;
        const progress = f / 59.0;
        spatialAudio.syncPlayhead(progress);
      }

      globalThis.performance = origPerformance;
      spatialAudio.dispose();

      const count = seekProgressCalls.length;
      assert.ok(count >= 20 && count <= 26, `For dur=${dur}, expected 20..26 seeks, got ${count}`);

      // Final seek must be exactly 1.0 (end of timeline)
      const lastCall = seekProgressCalls[seekProgressCalls.length - 1];
      assert.equal(lastCall.t, 1.0, `Final progress must be 1.0, got ${lastCall.t}`);

      // All calls must be within [0, 1]
      for (const call of seekProgressCalls) {
        assert.ok(call.t >= 0.0 && call.t <= 1.0, `Call ${call.t} out of range [0, 1]`);
      }
    }
  });

  // --------------------------------------------------------------------------
  // 3. Rapid Zigzag Scrubbing Back and Forth
  // --------------------------------------------------------------------------
  it('Verification 3: Rapid Zigzag Scrubbing Back and Forth (Rate Limiting & Boundary Adherence)', () => {
    const { mixer, seekProgressCalls } = createMockMixer({ duration: 30.0, mode: 'progress' });
    const spatialAudio = new VRSpatialAudio({ mixer });

    let simTime = 1000.0;
    mixer._now = () => simTime;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simTime };

    // Simulate 180 frames (3 seconds at 60 FPS) oscillating sinusoidally between t=0.15 and t=0.85
    const totalFrames = 180;
    for (let f = 0; f < totalFrames; f++) {
      simTime += 16.66667;
      // High frequency zigzag: 3 full cycles in 3 seconds (omega = 2*pi*1.0)
      const t = 0.50 + 0.35 * Math.sin((f / 60.0) * 2.0 * Math.PI);
      spatialAudio.syncPlayhead(t);
    }

    globalThis.performance = origPerformance;
    spatialAudio.dispose();

    // In 3000ms with 40ms throttling interval, maximum possible seeks = 3000 / 40 = 75 seeks (+1 initial)
    const count = seekProgressCalls.length;
    assert.ok(count <= 76, `Zigzag scrubbing exceeded 40ms throttle limit: got ${count} seeks (max 76)`);
    assert.ok(count >= 60, `Zigzag scrubbing under-reported: got ${count} seeks (min 60)`);

    // Verify all dispatches are valid finite numbers in [0.14, 0.86]
    for (const call of seekProgressCalls) {
      assert.ok(Number.isFinite(call.t), `Dispatched progress must be finite: ${call.t}`);
      assert.ok(call.t >= 0.14 && call.t <= 0.86, `Dispatched progress out of zigzag bounds: ${call.t}`);
    }
  });

  // --------------------------------------------------------------------------
  // 4. Discrete Instant Jumps
  // --------------------------------------------------------------------------
  it('Verification 4: Discrete Instant Jumps (Idle Jump vs Rapid Sequential Jumps)', () => {
    const { mixer, seekProgressCalls } = createMockMixer({ duration: 30.0, mode: 'progress' });
    const spatialAudio = new VRSpatialAudio({ mixer });

    let simTime = 1000.0;
    mixer._now = () => simTime;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simTime };

    // Jump 1: Initial jump from 0.0 to 0.2 after idle
    simTime += 100.0; // 100ms idle
    spatialAudio.syncPlayhead(0.2);
    assert.equal(seekProgressCalls.length, 1, 'Initial jump after idle must dispatch immediately');
    assert.ok(Math.abs(seekProgressCalls[0].t - 0.2) < 1e-4);

    // Jump 2: Sub-40ms rapid jump to 0.8 (e.g. 15ms later)
    simTime += 15.0; // Only 15ms elapsed
    spatialAudio.syncPlayhead(0.8);
    assert.equal(seekProgressCalls.length, 1, 'Rapid jump within 15ms (< 40ms) must be throttled');

    // Jump 3: Render frame resumes at 50ms total elapsed (35ms later) -> should seek to 0.8
    simTime += 35.0; // Total 50ms elapsed since jump 1 (> 40ms)
    spatialAudio.syncPlayhead(0.8);
    assert.equal(seekProgressCalls.length, 2, 'Settled jump at 50ms elapsed must dispatch target 0.8');
    assert.ok(Math.abs(seekProgressCalls[1].t - 0.8) < 1e-4);

    // Jump 4: Jump to 0.4 after 200ms idle
    simTime += 200.0;
    spatialAudio.syncPlayhead(0.4);
    assert.equal(seekProgressCalls.length, 3, 'Jump after 200ms idle must dispatch immediately');
    assert.ok(Math.abs(seekProgressCalls[2].t - 0.4) < 1e-4);

    globalThis.performance = origPerformance;
    spatialAudio.dispose();
  });

  // --------------------------------------------------------------------------
  // 5. Boundary Hits (t=0.0 and t=1.0)
  // --------------------------------------------------------------------------
  it('Verification 5: Boundary Hits (Immediate Dispatch & Zero Subsequent Redundant Seeks)', () => {
    const { mixer, seekProgressCalls } = createMockMixer({ duration: 30.0, mode: 'progress' });
    const spatialAudio = new VRSpatialAudio({ mixer });

    let simTime = 1000.0;
    mixer._now = () => simTime;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simTime };

    // Establish interior seek at t=0.5
    simTime += 100.0;
    spatialAudio.syncPlayhead(0.5);
    assert.equal(seekProgressCalls.length, 1);
    assert.equal(seekProgressCalls[0].t, 0.5);

    // Sudden boundary hit to t=0.0 ONLY 5ms later (<40ms throttle)
    simTime += 5.0;
    spatialAudio.syncPlayhead(0.0);
    // Boundary t=0.0 MUST NOT be throttled by the 40ms interior throttle!
    assert.equal(seekProgressCalls.length, 2, 'Boundary hit t=0.0 must bypass 40ms throttle');
    assert.equal(seekProgressCalls[1].t, 0.0);

    // Now hold at t=0.0 for 60 consecutive frames
    for (let f = 0; f < 60; f++) {
      simTime += 16.6667;
      spatialAudio.syncPlayhead(0.0);
    }
    // Must NOT fire any duplicate seeks
    assert.equal(seekProgressCalls.length, 2, 'Subsequent frames held at t=0.0 must dispatch zero seeks');

    // Move to interior t=0.7 after 100ms
    simTime += 100.0;
    spatialAudio.syncPlayhead(0.7);
    assert.equal(seekProgressCalls.length, 3);
    assert.equal(seekProgressCalls[2].t, 0.7);

    // Sudden boundary hit to t=1.0 ONLY 5ms later (<40ms throttle)
    simTime += 5.0;
    spatialAudio.syncPlayhead(1.0);
    // Boundary t=1.0 MUST NOT be throttled!
    assert.equal(seekProgressCalls.length, 4, 'Boundary hit t=1.0 must bypass 40ms throttle');
    assert.equal(seekProgressCalls[3].t, 1.0);

    // Hold at t=1.0 for 60 consecutive frames
    for (let f = 0; f < 60; f++) {
      simTime += 16.6667;
      spatialAudio.syncPlayhead(1.0);
    }
    assert.equal(seekProgressCalls.length, 4, 'Subsequent frames held at t=1.0 must dispatch zero seeks');

    globalThis.performance = origPerformance;
    spatialAudio.dispose();
  });

  // --------------------------------------------------------------------------
  // 6. Stationary Hold (Zero Seeks Dispatched)
  // --------------------------------------------------------------------------
  it('Verification 6: Stationary Hold (Zero Seeks Dispatched Over Extended Inactive Durations)', () => {
    const { mixer, seekProgressCalls } = createMockMixer({ duration: 30.0, mode: 'progress' });
    const spatialAudio = new VRSpatialAudio({ mixer });

    let simTime = 1000.0;
    mixer._now = () => simTime;
    spatialAudio.lastSeekTime = 0.0;
    spatialAudio.lastSeekTarget = -1.0;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simTime };

    // Initial position t=0.333
    simTime += 50.0;
    spatialAudio.syncPlayhead(0.333);
    assert.equal(seekProgressCalls.length, 1);

    // Simulate 300 frames (5.0 seconds at 60 FPS) of stationary idle
    for (let f = 0; f < 300; f++) {
      simTime += 16.6667;
      spatialAudio.syncPlayhead(0.333);
    }

    assert.equal(seekProgressCalls.length, 1, 'Stationary hold over 300 frames must dispatch exactly 0 additional seeks');

    globalThis.performance = origPerformance;
    spatialAudio.dispose();
  });

  // --------------------------------------------------------------------------
  // 7. Exhaustive Zero NaN, Inf, or Negative Times Oracle
  // --------------------------------------------------------------------------
  it('Verification 7: Zero NaN, Inf, or Negative Times Passed to mixer.seekProgress or mixer.seek', () => {
    const { mixer, seekProgressCalls, seekCalls } = createMockMixer({ duration: 40.0, mode: 'both' });
    const spatialAudio = new VRSpatialAudio({ mixer });

    let simTime = 1000.0;
    mixer._now = () => simTime;

    const origPerformance = globalThis.performance;
    globalThis.performance = { now: () => simTime };

    const adversarialInputs = [
      NaN,
      Infinity,
      -Infinity,
      -0.0,
      -0.0001,
      -1.0,
      -999999.0,
      1.0001,
      2.0,
      999999.0,
      null,
      undefined,
      '0.5',
      'invalid_string',
      '',
      'NaN',
      'Infinity',
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_VALUE,
      Number.EPSILON,
      {},
      [],
      [0.75],
      () => 0.5
    ];

    for (const input of adversarialInputs) {
      simTime += 100.0; // Ensure 100ms idle so throttle allows evaluation
      spatialAudio.lastSeekTarget = -999.0; // Force delta check to pass

      // Call with adversarial input
      spatialAudio.syncPlayhead(input);
    }

    globalThis.performance = origPerformance;
    spatialAudio.dispose();

    // Audit every call to seekProgress
    for (const call of seekProgressCalls) {
      assert.equal(typeof call.t, 'number', `seekProgress must receive number, got ${typeof call.t}`);
      assert.ok(!Number.isNaN(call.t), `seekProgress received NaN: ${call.t}`);
      assert.ok(Number.isFinite(call.t), `seekProgress received non-finite: ${call.t}`);
      assert.ok(call.t >= 0.0, `seekProgress received negative value: ${call.t}`);
      assert.ok(call.t <= 1.0, `seekProgress received value > 1.0: ${call.t}`);
    }

    // Audit every call to seek
    for (const call of seekCalls) {
      assert.equal(typeof call.s, 'number', `seek must receive number, got ${typeof call.s}`);
      assert.ok(!Number.isNaN(call.s), `seek received NaN: ${call.s}`);
      assert.ok(Number.isFinite(call.s), `seek received non-finite: ${call.s}`);
      assert.ok(call.s >= 0.0, `seek received negative time: ${call.s}`);
      assert.ok(call.s <= 40.0, `seek received time > duration: ${call.s}`);
    }
  });

  // --------------------------------------------------------------------------
  // 8. Mixer API Fallbacks & Missing Duration Resilience
  // --------------------------------------------------------------------------
  it('Verification 8: Mixer Fallback Modes (seek only, missing duration, null mixer)', () => {
    // 8a. Mixer with seek only (no seekProgress)
    const { mixer: mixerSeekOnly, seekCalls } = createMockMixer({ duration: 50.0, mode: 'seconds' });
    const audioA = new VRSpatialAudio({ mixer: mixerSeekOnly });
    audioA.syncPlayhead(0.5);
    assert.equal(seekCalls.length, 1);
    assert.equal(seekCalls[0].s, 25.0, 'seek(seconds) must be called with clampedT * duration');
    audioA.dispose();

    // 8b. Mixer with missing duration (default 20.0s)
    const mockNoDur = {
      seek: (s) => {
        assert.ok(Number.isFinite(s) && s >= 0.0 && s <= 20.0);
      }
    };
    const audioB = new VRSpatialAudio({ mixer: mockNoDur });
    audioB.syncPlayhead(0.5);
    audioB.dispose();

    // 8c. Null mixer (must be safe NO-OP)
    const audioC = new VRSpatialAudio({ mixer: null });
    assert.doesNotThrow(() => audioC.syncPlayhead(0.5));
    audioC.dispose();
  });

  // --------------------------------------------------------------------------
  // 9. Architectural Invariant: globe.js Untouched
  // --------------------------------------------------------------------------
  it('Verification 9: Architectural Invariant: frontend/js/globe/globe.js 100% Untouched & Clean', () => {
    const globePath = path.join(rootDir, 'frontend', 'js', 'globe', 'globe.js');
    assert.ok(fs.existsSync(globePath), 'globe.js must exist');

    const stat = fs.statSync(globePath);
    assert.equal(stat.size, 22015, `globe.js size must be exactly 22015 bytes, got ${stat.size}`);

    const raw = fs.readFileSync(globePath, 'utf8');
    assert.ok(raw.includes('export class EarthGlobe'), 'globe.js must export EarthGlobe');
    assert.ok(!raw.includes('vr_'), 'globe.js must not reference vr_ modules');
    assert.ok(!raw.includes('earthsonicVR'), 'globe.js must not reference earthsonicVR');
    assert.ok(!raw.includes('TerminatorSkimVRScene'), 'globe.js must not reference TerminatorSkimVRScene');
  });

});
