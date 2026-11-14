/**
 * tests/test_orchestra_node.mjs
 * Node.js ES module unit test runner for EARTHSONIC Orchestra & Visualizer modules.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// Test 1: TrackStrip and gain mapping math
test('TrackStrip: Logarithmic fader gain curve and decibel math', async () => {
  const { linearToLogGain, dbToLinearGain, linearGainToDb, TrackStrip } = await import('../frontend/js/audio/track.js');

  // Linear to log gain (val^2)
  assert.equal(linearToLogGain(0.0), 0.0);
  assert.equal(linearToLogGain(1.0), 1.0);
  assert.ok(Math.abs(linearToLogGain(0.5) - 0.25) < 1e-6);
  assert.ok(Math.abs(linearToLogGain(0.8) - 0.64) < 1e-6);

  // Clamping
  assert.equal(linearToLogGain(-0.5), 0.0);
  assert.equal(linearToLogGain(1.5), 1.0);

  // Decibel to linear
  assert.ok(Math.abs(dbToLinearGain(0.0) - 1.0) < 1e-6);
  assert.ok(Math.abs(dbToLinearGain(-20.0) - 0.1) < 1e-6);
  assert.equal(dbToLinearGain(-65.0), 0.0);

  // Linear to dB
  assert.ok(Math.abs(linearGainToDb(1.0) - 0.0) < 1e-6);
  assert.ok(Math.abs(linearGainToDb(0.1) - (-20.0)) < 1e-6);
  assert.equal(linearGainToDb(0.0), -100.0);

  // TrackStrip instance without audioCtx (headless mode)
  const track = new TrackStrip('surface_temperature', {
    name: 'Global Temperature',
    color: '#00f0ff',
    volume: 0.8
  });

  assert.equal(track.id, 'surface_temperature');
  assert.equal(track.name, 'Global Temperature');
  assert.equal(track.volume, 0.8);
  assert.ok(Math.abs(track.getLogGain() - 0.64) < 1e-6);
  assert.equal(track.isMuted, false);
  assert.equal(track.isSoloed, false);

  // State mutation
  track.setVolume(0.5);
  assert.equal(track.volume, 0.5);
  assert.ok(Math.abs(track.getLogGain() - 0.25) < 1e-6);

  track.setPan(0.5);
  assert.equal(track.pan, 0.5);

  track.setMute(true);
  assert.equal(track.isMuted, true);

  track.setSolo(true);
  assert.equal(track.isSoloed, true);

  const state = track.getState();
  assert.equal(state.id, 'surface_temperature');
  assert.equal(state.isMuted, true);
  assert.equal(state.isSoloed, true);
});

// Test 2: Mixer Solo/Mute logic matrix & transport
test('Mixer: Solo/Mute logic matrix evaluation and transport time formatting', async () => {
  const { calculateEffectiveGain, formatTimeMMSS, formatTimeDetailed, EarthOrchestraMixer, TRACK_CONFIGS } = await import('../frontend/js/audio/mixer.js');

  assert.equal(TRACK_CONFIGS.length, 4, 'Must define 4 standard NASA science tracks');

  // Time formatting
  assert.equal(formatTimeMMSS(0), '00:00');
  assert.equal(formatTimeMMSS(15), '00:15');
  assert.equal(formatTimeMMSS(75), '01:15');
  assert.equal(formatTimeDetailed(15.25), '00:15.2');

  // Test calculateEffectiveGain truth table
  const tracks = [
    { id: 't1', volume: 0.8, isMuted: false, isSoloed: false, getLogGain: () => 0.64 },
    { id: 't2', volume: 0.8, isMuted: false, isSoloed: false, getLogGain: () => 0.64 },
    { id: 't3', volume: 0.8, isMuted: false, isSoloed: false, getLogGain: () => 0.64 },
    { id: 't4', volume: 0.8, isMuted: false, isSoloed: false, getLogGain: () => 0.64 },
  ];

  // Normal state: all active
  for (const t of tracks) {
    assert.equal(calculateEffectiveGain(t, tracks), 0.64);
  }

  // Mute track 0
  tracks[0].isMuted = true;
  assert.equal(calculateEffectiveGain(tracks[0], tracks), 0.0);
  assert.equal(calculateEffectiveGain(tracks[1], tracks), 0.64);

  // Solo track 1 -> tracks 2 and 3 should become silent, track 0 is muted anyway
  tracks[1].isSoloed = true;
  assert.equal(calculateEffectiveGain(tracks[0], tracks), 0.0);
  assert.equal(calculateEffectiveGain(tracks[1], tracks), 0.64);
  assert.equal(calculateEffectiveGain(tracks[2], tracks), 0.0);
  assert.equal(calculateEffectiveGain(tracks[3], tracks), 0.0);

  // Solo AND Mute track 1 -> Mute takes precedence!
  tracks[1].isMuted = true;
  assert.equal(calculateEffectiveGain(tracks[1], tracks), 0.0);

  // Headless mixer initialization
  const mixer = new EarthOrchestraMixer({ masterVolume: 0.9, loop: true });
  assert.equal(mixer.getAllTracks().length, 4);
  assert.ok(mixer.getTrack('surface_temperature'));
  assert.ok(mixer.getTrack('temperature')); // alias
  assert.ok(mixer.getTrack('atmospheric_co2'));
  assert.ok(mixer.getTrack('co2')); // alias
  assert.ok(mixer.getTrack('ocean_temperature'));
  assert.ok(mixer.getTrack('sea_ice_extent'));

  mixer.setMasterVolume(0.5);
  assert.equal(mixer.masterVolume, 0.5);
  mixer.setLoop(false);
  assert.equal(mixer.isLooping, false);
});

// Test 3: Visualizer math (FFT Bands, Zero-Crossing, RMS, Peak dBFS)
test('Visualizer: 64-band logarithmic FFT bins, zero-crossing, and RMS decibels', async () => {
  const {
    computeLogarithmicBands,
    findZeroCrossingTrigger,
    calculateRMS,
    calculatePeak,
    calculateDbFS,
    AudioVisualizer
  } = await import('../frontend/js/visualizer/visualizer.js');

  // 1. Logarithmic 64-band calculation
  const bands = computeLogarithmicBands(64, 20.0, 20000.0, 2048, 44100);
  assert.equal(bands.length, 64);
  assert.ok(bands[0].startFreq >= 19.9 && bands[0].startFreq <= 20.1);
  assert.ok(bands[63].endFreq >= 19999.0 && bands[63].endFreq <= 20001.0);

  for (let i = 0; i < 64; i++) {
    const b = bands[i];
    assert.ok(b.startBin >= 0 && b.endBin <= 1024);
    assert.ok(b.endBin > b.startBin, `Band ${i} must have endBin > startBin`);
    if (i > 0) {
      assert.ok(b.startFreq >= bands[i - 1].startFreq, 'Frequencies must increase monotonically');
    }
  }

  // 2. Zero-crossing trigger
  const testBuffer = new Float32Array([-0.5, -0.3, -0.1, 0.2, 0.6, 0.9]);
  const triggerIdx = findZeroCrossingTrigger(testBuffer);
  assert.equal(triggerIdx, 2, 'Zero-crossing trigger should locate buffer[2] <= 0 and buffer[3] > 0');

  // Flat buffer
  const flatBuf = new Float32Array([0, 0, 0, 0]);
  assert.equal(findZeroCrossingTrigger(flatBuf), 0);

  // 3. RMS and Peak calculations
  const zeros = new Float32Array(512);
  assert.equal(calculateRMS(zeros), 0.0);
  assert.equal(calculatePeak(zeros), 0.0);
  assert.equal(calculateDbFS(0.0), -100.0);

  // DC at full scale
  const dcOnes = new Float32Array(512).fill(1.0);
  assert.ok(Math.abs(calculateRMS(dcOnes) - 1.0) < 1e-6);
  assert.ok(Math.abs(calculatePeak(dcOnes) - 1.0) < 1e-6);
  assert.ok(Math.abs(calculateDbFS(1.0) - 0.0) < 1e-6);

  // Square wave alternating +1.0 and -1.0
  const squareWave = new Float32Array(512);
  for (let i = 0; i < 512; i++) {
    squareWave[i] = i % 2 === 0 ? 1.0 : -1.0;
  }
  assert.ok(Math.abs(calculateRMS(squareWave) - 1.0) < 1e-6);
  assert.ok(Math.abs(calculatePeak(squareWave) - 1.0) < 1e-6);

  // Headless Visualizer constructor
  const vis = new AudioVisualizer({ gravity: 0.005 });
  assert.equal(vis.numBands, 64);
  assert.equal(vis.bands.length, 64);
  assert.equal(vis.isRunning, false);
});
