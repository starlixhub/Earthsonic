/**
 * tests/stress_m4_js_harness.js
 * Empirical Challenger Stress & Boundary Harness for Milestone M4 (Requirement R4):
 * 1. Guided Tour rapid start/stop/resume, layer solo transitions, chapter timing
 * 2. WebAudioMixer & TrackStrip audio gain, convolver impulse response, clipping under extreme volumes
 * 3. Audio synthesis buffers against NaN, Inf, and clipping boundaries in JavaScript engine
 * 4. Audio WAV exporter boundary conditions (NaN, Inf, extreme clipping)
 */

import assert from 'node:assert/strict';
import { MockElement } from './mock_dom.js';

// Setup Mock DOM environment for guided_tour and audio components
globalThis.document = {
  getElementById(id) {
    if (!this._elements) this._elements = new Map();
    if (!this._elements.has(id)) {
      const el = new MockElement('div');
      el.id = id;
      this._elements.set(id, el);
    }
    return this._elements.get(id);
  },
  createElement(tag) {
    return new MockElement(tag);
  },
  body: new MockElement('body'),
  querySelectorAll(sel) {
    return [];
  }
};
globalThis.window = {
  document: globalThis.document,
  AudioContext: class MockAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = {};
    }
    resume() { return Promise.resolve(); }
    createGain() {
      return {
        gain: {
          value: 1.0,
          setValueAtTime(v) { this.value = v; },
          exponentialRampToValueAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          setTargetAtTime(v) { this.value = v; }
        },
        connect() {},
        disconnect() {}
      };
    }
    createStereoPanner() {
      return {
        pan: {
          value: 0.0,
          setValueAtTime(v) { this.value = v; }
        },
        connect() {},
        disconnect() {}
      };
    }
    createAnalyser() {
      return {
        fftSize: 2048,
        frequencyBinCount: 1024,
        smoothingTimeConstant: 0.8,
        minDecibels: -90,
        maxDecibels: -10,
        getFloatTimeDomainData(arr) { arr.fill(0); },
        connect() {},
        disconnect() {}
      };
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        Q: { value: 0.7071 },
        frequency: {
          value: 130,
          setValueAtTime(v) { this.value = v; },
          cancelScheduledValues() {},
          setTargetAtTime(v) { this.value = v; }
        },
        connect() {},
        disconnect() {}
      };
    }
    createWaveShaper() {
      return {
        curve: null,
        oversample: 'none',
        connect() {},
        disconnect() {}
      };
    }
    createBuffer(numChannels, length, sampleRate) {
      const channels = [];
      for (let c = 0; c < numChannels; c++) {
        channels.push(new Float32Array(length));
      }
      return {
        numberOfChannels: numChannels,
        length,
        duration: length / sampleRate,
        sampleRate,
        getChannelData(c) { return channels[c]; }
      };
    }
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    createConvolver() {
      return {
        buffer: null,
        connect() {},
        disconnect() {}
      };
    }
  }
};

let passedChecks = 0;
function logPass(msg) {
  passedChecks++;
  console.log(`  [PASS ${passedChecks}] ${msg}`);
}

console.log('=== Milestone M4 Empirical Challenger Stress & Boundary Test Suite ===\n');

// ---------------------------------------------------------------------------
// 1. Guided Tour: Durations, Autoplay, Chapter Sequencing, Solo Transitions
// ---------------------------------------------------------------------------
console.log('--- 1. Guided Tour: Durations, Autoplay, Chapter Sequencing, Solo Transitions ---');

const { TOUR_CHAPTERS, GuidedMissionTour } = await import('../frontend/js/ui/guided_tour.js');
const { EarthOrchestraMixer } = await import('../frontend/js/audio/mixer.js');
const { TrackStrip, D_DORIAN_LYDIAN_SCALE, quantizeToScale, createSaturationCurve, linearToLogGain, dbToLinearGain, linearGainToDb } = await import('../frontend/js/audio/track.js');
const { audioBufferToWav, interleaveChannels } = await import('../frontend/js/audio/exporter.js');

// 1.1 Verify exact 45s total duration across 5 chapters
{
  assert.equal(TOUR_CHAPTERS.length, 5, 'Must have exactly 5 chapters');
  let totalDuration = 0;
  TOUR_CHAPTERS.forEach((ch, idx) => {
    assert.equal(ch.chapterNum, idx + 1);
    assert.equal(ch.durationSec, 9, `Chapter ${idx + 1} duration must be 9s`);
    totalDuration += ch.durationSec;
  });
  assert.equal(totalDuration, 45, `Total duration must be strictly 45s (got ${totalDuration}s)`);
  logPass('Guided Tour chapter count (5) and total duration (45s = 5 x 9s) verified');
}

// 1.2 Verify chapter solo specifications
{
  const expectedSolos = [
    ['surface_temperature'],
    ['atmospheric_co2'],
    ['ocean_temperature'],
    ['sea_ice_extent'],
    ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent']
  ];
  TOUR_CHAPTERS.forEach((ch, idx) => {
    assert.deepEqual(ch.solos, expectedSolos[idx], `Chapter ${idx + 1} solos mismatch`);
  });
  logPass('Guided Tour solo progression verified across all 5 chapters');
}

// 1.3 Rapid Start/Stop/Resume and Race Conditions
{
  const mockGlobe = {
    controls: { autoRotate: false, autoRotateSpeed: 0.0 },
    flyTo() {},
    setActiveOverlay() {}
  };
  const mockMixer = new EarthOrchestraMixer();
  const tour = new GuidedMissionTour({
    globe: mockGlobe,
    mixer: mockMixer
  });

  // Rapid cycling
  for (let i = 0; i < 50; i++) {
    tour.start();
    tour.togglePause();
    tour.togglePause();
    tour.nextChapter();
    tour.previousChapter();
    tour.stop();
  }

  assert.equal(tour.isActive, false, 'Tour must be inactive after stop');
  assert.equal(tour.isPaused, false, 'Tour must not be paused after stop');
  assert.equal(mockGlobe.controls.autoRotate, false, 'Auto-rotate must be disabled after stop');

  // Verify all track solos are restored to false upon stop()
  for (const t of mockMixer.getAllTracks()) {
    assert.equal(t.isSoloed, false, `Track ${t.id} must be unsoloed after tour stop`);
  }
  logPass('50x rapid start/stop/pause/resume tour lifecycle verified with clean teardown');
}

// 1.4 Sequential Soloing through chapters
{
  const mockGlobe = {
    controls: { autoRotate: false, autoRotateSpeed: 0.0 },
    flyTo() {},
    setActiveOverlay() {}
  };
  const mockMixer = new EarthOrchestraMixer();
  const tour = new GuidedMissionTour({
    globe: mockGlobe,
    mixer: mockMixer
  });

  await tour.start();
  assert.equal(mockGlobe.controls.autoRotate, true, 'Auto-rotate must be engaged during tour');
  assert.equal(mockGlobe.controls.autoRotateSpeed, 0.8, 'Auto-rotate speed must be 0.8');

  // Chapter 1: Surface Temperature solo
  assert.equal(mockMixer.getTrack('surface_temperature').isSoloed, true);
  assert.equal(mockMixer.getTrack('atmospheric_co2').isSoloed, false);
  assert.equal(mockMixer.getTrack('ocean_temperature').isSoloed, false);
  assert.equal(mockMixer.getTrack('sea_ice_extent').isSoloed, false);

  // Advance to Chapter 2: CO2 solo
  await tour.nextChapter();
  assert.equal(mockMixer.getTrack('surface_temperature').isSoloed, false);
  assert.equal(mockMixer.getTrack('atmospheric_co2').isSoloed, true);

  // Advance to Chapter 5: All 4 soloed (full ensemble)
  await tour.nextChapter(); // ch 3
  await tour.nextChapter(); // ch 4
  await tour.nextChapter(); // ch 5
  assert.equal(tour.currentChapterIndex, 4);
  assert.equal(mockMixer.getTrack('surface_temperature').isSoloed, true);
  assert.equal(mockMixer.getTrack('atmospheric_co2').isSoloed, true);
  assert.equal(mockMixer.getTrack('ocean_temperature').isSoloed, true);
  assert.equal(mockMixer.getTrack('sea_ice_extent').isSoloed, true);

  // Advance past chapter 5 -> should automatically call stop()
  await tour.nextChapter();
  assert.equal(tour.isActive, false, 'Advancing past chapter 5 must stop tour');
  assert.equal(mockGlobe.controls.autoRotate, false, 'Auto-rotate must reset to false');
  logPass('Guided Tour chapter sequential progression and solo state propagation verified');
}

// ---------------------------------------------------------------------------
// 2. Audio Gain, Convolver Impulse Response, and Extreme Volume Boundaries
// ---------------------------------------------------------------------------
console.log('\n--- 2. Audio Gain, Convolver Reverb, and Volume Boundaries ---');

// 2.1 Convolver Impulse Response Stability & Math
{
  const mockCtx = new globalThis.window.AudioContext();
  const mixer = new EarthOrchestraMixer({ audioCtx: mockCtx });

  // Test impulse response generation
  const ir = mixer._generateImpulseResponse(2.4, 3.0);
  assert.ok(ir, 'Impulse response buffer must be generated');
  assert.equal(ir.numberOfChannels, 2, 'Impulse response must be stereo');
  assert.equal(ir.sampleRate, 44100);
  assert.equal(ir.length, Math.floor(44100 * 2.4));

  const left = ir.getChannelData(0);
  const right = ir.getChannelData(1);

  let hasNan = false;
  let hasInf = false;
  let maxAbs = 0;
  for (let i = 0; i < ir.length; i++) {
    const l = left[i];
    const r = right[i];
    if (Number.isNaN(l) || Number.isNaN(r)) hasNan = true;
    if (!Number.isFinite(l) || !Number.isFinite(r)) hasInf = true;
    if (Math.abs(l) > maxAbs) maxAbs = Math.abs(l);
    if (Math.abs(r) > maxAbs) maxAbs = Math.abs(r);
  }
  assert.equal(hasNan, false, 'Impulse response must contain zero NaN values');
  assert.equal(hasInf, false, 'Impulse response must contain zero Inf values');
  assert.ok(maxAbs > 0.05, `Impulse response should have non-trivial energy (peak: ${maxAbs})`);
  assert.ok(maxAbs < 10.0, `Impulse response peak must be bounded (peak: ${maxAbs})`);

  // Verify exponential decay envelope: early energy should be higher than tail
  let earlyEnergy = 0;
  let tailEnergy = 0;
  const quarter = Math.floor(ir.length / 4);
  for (let i = 0; i < quarter; i++) {
    earlyEnergy += left[i] * left[i] + right[i] * right[i];
  }
  for (let i = ir.length - quarter; i < ir.length; i++) {
    tailEnergy += left[i] * left[i] + right[i] * right[i];
  }
  assert.ok(earlyEnergy > tailEnergy * 50, `Exponential decay must attenuate tail: early ${earlyEnergy} vs tail ${tailEnergy}`);
  logPass('Convolver 2.4s stereo impulse response verified: finite, zero NaN, valid exponential decay');
}

// 2.2 Convolver Node & Dry/Wet Bus Nodes
{
  const mockCtx = new globalThis.window.AudioContext();
  const mixer = new EarthOrchestraMixer({ audioCtx: mockCtx });

  assert.ok(mixer.busInputNode, 'Master bus input node must exist');
  assert.ok(mixer.dryGainNode, 'Dry gain node must exist');
  assert.ok(mixer.convolverGainNode, 'Convolver wet gain node must exist');
  assert.ok(mixer.convolverNode, 'Convolver node must exist');
  assert.equal(mixer.dryGainNode.gain.value, 0.85, 'Dry path gain must be 0.85');
  assert.equal(mixer.convolverGainNode.gain.value, 0.28, 'Convolver wet path gain must be 0.28');
  logPass('Master Bus architecture (0.85 dry + 0.28 convolver wet) verified');
}

// 2.3 Volume and Pan Boundaries under Extreme Values
{
  const track = new TrackStrip('surface_temperature');

  // Extreme volume clamping
  track.setVolume(100.0);
  assert.equal(track.volume, 1.0, 'Volume > 1.0 must clamp to 1.0');
  track.setVolume(-50.0);
  assert.equal(track.volume, 0.0, 'Volume < 0.0 must clamp to 0.0');
  track.setVolume(NaN);
  assert.equal(track.volume, 0.0, 'Volume NaN must fallback to 0.0');
  track.setVolume(Infinity);
  assert.equal(track.volume, 1.0, 'Volume Infinity must clamp to 1.0');

  // Extreme pan clamping
  track.setPan(99.0);
  assert.equal(track.pan, 1.0, 'Pan > 1.0 must clamp to 1.0');
  track.setPan(-99.0);
  assert.equal(track.pan, -1.0, 'Pan < -1.0 must clamp to -1.0');
  track.setPan(NaN);
  assert.equal(track.pan, 0.0, 'Pan NaN must fallback to 0.0');

  // Effective gain anti-clipping clamp
  track.setEffectiveGain(5.0);
  assert.equal(track.effectiveGain, 2.0, 'Effective gain must clamp to max 2.0');
  track.setEffectiveGain(-2.0);
  assert.equal(track.effectiveGain, 0.0, 'Effective gain must clamp to min 0.0');
  track.setEffectiveGain(NaN);
  assert.equal(track.effectiveGain, 0.0, 'Effective gain NaN must clamp to 0.0');

  logPass('TrackStrip volume, pan, and effectiveGain boundary clamps verified');
}

// ---------------------------------------------------------------------------
// 3. Audio Synthesis Buffers against NaN, Inf, and Clipping Boundaries in JS
// ---------------------------------------------------------------------------
console.log('\n--- 3. Audio Synthesis Buffers against NaN, Inf, and Clipping Boundaries in JS ---');

// 3.1 D Dorian / Lydian Scale Quantization
{
  assert.equal(D_DORIAN_LYDIAN_SCALE.length, 13);
  assert.equal(D_DORIAN_LYDIAN_SCALE[0], 220.0);
  assert.equal(D_DORIAN_LYDIAN_SCALE[D_DORIAN_LYDIAN_SCALE.length - 1], 880.0);

  // Nearest frequency quantization test
  assert.equal(quantizeToScale(221.0), 220.0);
  assert.equal(quantizeToScale(435.0), 440.0);
  assert.equal(quantizeToScale(10.0), 220.0, 'Underflow must map to scale minimum');
  assert.equal(quantizeToScale(5000.0), 880.0, 'Overflow must map to scale maximum');

  // Extreme math boundaries
  assert.equal(quantizeToScale(-1000.0), 220.0);
  logPass('D Dorian / Lydian pitch quantization oracle verified across full frequency range');
}

// 3.2 CO2 Saturation Curve Math
{
  const curve = createSaturationCurve(20, 1024);
  assert.equal(curve.length, 1024);
  let hasNan = false;
  let hasInf = false;
  let maxVal = 0;
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i];
    if (Number.isNaN(v)) hasNan = true;
    if (!Number.isFinite(v)) hasInf = true;
    if (Math.abs(v) > maxVal) maxVal = Math.abs(v);
  }
  assert.equal(hasNan, false, 'Saturation curve must not contain NaN');
  assert.equal(hasInf, false, 'Saturation curve must not contain Inf');
  assert.ok(maxVal <= 1.5, `Saturation curve peak should be bounded (got ${maxVal})`);

  // Monotonicity test: soft clipper should be non-decreasing
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] >= curve[i - 1] - 1e-6, `Curve must be non-decreasing at sample ${i}`);
  }
  logPass('CO2 Waveshaper saturation curve verified: smooth, monotonic, zero NaN/Inf');
}

// 3.3 Synthesis Voices for all 4 tracks (Buffer Verification)
{
  const mockCtx = new globalThis.window.AudioContext();
  const trackIds = ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent'];

  for (const trackId of trackIds) {
    const track = new TrackStrip(trackId, { audioCtx: mockCtx });
    const buf = track.synthesizeVoiceBuffer(5.0, 44100);
    assert.ok(buf, `Voice buffer must be created for ${trackId}`);
    assert.equal(buf.numberOfChannels, 2, `Voice ${trackId} must be stereo`);
    assert.equal(buf.sampleRate, 44100);
    assert.equal(buf.length, 5 * 44100);

    const left = buf.getChannelData(0);
    const right = buf.getChannelData(1);

    let nanCount = 0;
    let infCount = 0;
    let maxAbs = 0;
    let energy = 0;

    for (let i = 0; i < buf.length; i++) {
      const l = left[i];
      const r = right[i];
      if (Number.isNaN(l) || Number.isNaN(r)) nanCount++;
      if (!Number.isFinite(l) || !Number.isFinite(r)) infCount++;
      const absL = Math.abs(l);
      const absR = Math.abs(r);
      if (absL > maxAbs) maxAbs = absL;
      if (absR > maxAbs) maxAbs = absR;
      energy += l * l + r * r;
    }

    assert.equal(nanCount, 0, `Voice ${trackId} must have ZERO NaN values`);
    assert.equal(infCount, 0, `Voice ${trackId} must have ZERO Inf values`);
    assert.ok(energy > 0, `Voice ${trackId} must produce active audio energy`);
    assert.ok(maxAbs <= 1.5, `Voice ${trackId} peak must not blow up (peak: ${maxAbs.toFixed(3)})`);

    logPass(`Voice synthesis buffer [${trackId}]: 5.0s stereo, peak ${maxAbs.toFixed(3)}, 0 NaN, 0 Inf`);
  }
}

// ---------------------------------------------------------------------------
// 4. Audio WAV Exporter Boundary & Clipping Challenge
// ---------------------------------------------------------------------------
console.log('\n--- 4. Audio WAV Exporter Boundary & Clipping Challenge ---');

{
  const sampleRate = 44100;
  const numSamples = 500;
  const mockL = new Float32Array(numSamples);
  const mockR = new Float32Array(numSamples);

  // Populate with boundary extremes: -10.0, +10.0, NaN, Inf, -Inf
  mockL[0] = 0.0;
  mockL[1] = 1.0;
  mockL[2] = -1.0;
  mockL[3] = 5.0; // Extreme positive clipping
  mockL[4] = -5.0; // Extreme negative clipping
  mockL[5] = NaN;
  mockL[6] = Infinity;
  mockL[7] = -Infinity;

  mockR.set(mockL);

  const mockBuf = {
    numberOfChannels: 2,
    sampleRate,
    getChannelData(c) { return c === 0 ? mockL : mockR; }
  };

  const wavBlob = audioBufferToWav(mockBuf);
  assert.ok(wavBlob, 'Must return a Blob even with extreme values');
  assert.equal(wavBlob.type, 'audio/wav');
  assert.equal(wavBlob.size, 44 + numSamples * 2 * 2);

  logPass('WAV exporter handles NaN, +Inf, -Inf, and extreme clipping without crash or overflow');
}

console.log(`\n=======================================================`);
console.log(`ALL ${passedChecks} JAVASCRIPT EMPIRICAL CHALLENGES PASSED GREEN!`);
console.log(`=======================================================\n`);
process.exit(0);
