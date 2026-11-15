/**
 * frontend/js/audio/sweep.js
 * Longitude Playhead Sweep & Sonification Controller ("Earth Jukebox").
 *
 * Core responsibilities:
 *   1. Pure mapping functions (longitude <-> column <-> time).
 *   2. West-to-east longitude sweep playhead driving mixer channels.
 *   3. Lightning event trigger detection, point sprite flashes, and percussive audio hits.
 *   4. Night lights A/B comparison blend calculations and differential audio routing.
 */

import { calculateDeltaSeries } from '../comparison/comparison.js';

// ============================================================================
// 1. Pure Coordinate & Time Mapping Functions
// ============================================================================

/**
 * Maps a longitude [-180.0, 180.0] to a column index [0, width - 1].
 * @param {number} lon - Longitude in degrees
 * @param {number} [width=720] - Number of equirectangular columns
 * @returns {number} Column index [0, width - 1]
 */
export function longitudeToColumn(lon, width = 720) {
  if (typeof lon !== 'number' || Number.isNaN(lon)) return 0;
  if (!Number.isFinite(lon) || lon <= -180.0) return 0;
  if (lon >= 180.0) return Math.max(0, width - 1);

  const rawCol = Math.floor(((lon + 180.0) / 360.0) * width);
  return Math.max(0, Math.min(width - 1, rawCol));
}

// Alias for convenience
export const lonToColumn = longitudeToColumn;

/**
 * Maps a column index [0, width - 1] to center longitude in degrees [-180.0, 180.0].
 * @param {number} col - Column index
 * @param {number} [width=720] - Number of columns
 * @returns {number} Longitude in degrees
 */
export function columnToLongitude(col, width = 720) {
  if (typeof col !== 'number' || Number.isNaN(col) || !Number.isFinite(col)) return -180.0;
  const clampedCol = Math.max(0, Math.min(width - 1, col));
  const lon = -180.0 + ((clampedCol + 0.5) / width) * 360.0;
  return Math.max(-180.0, Math.min(180.0, lon));
}

// Alias for convenience
export const columnToLon = columnToLongitude;

/**
 * Maps elapsed time to column index across a sweep duration.
 * @param {number} t - Elapsed time in seconds
 * @param {number} [duration=20.0] - Total duration in seconds
 * @param {number} [width=720] - Total column count
 * @returns {number} Column index [0, width - 1]
 */
export function timeToColumn(t, duration = 20.0, width = 720) {
  if (typeof t !== 'number' || Number.isNaN(t) || !Number.isFinite(t) || t <= 0.0) return 0;
  const dur = (typeof duration === 'number' && duration > 0) ? duration : 20.0;
  if (t >= dur) return Math.max(0, width - 1);

  const rawCol = Math.floor((t / dur) * width);
  return Math.max(0, Math.min(width - 1, rawCol));
}

/**
 * Maps elapsed time to sweep longitude [-180.0, 180.0].
 * @param {number} t - Elapsed time in seconds
 * @param {number} [duration=20.0] - Total duration in seconds
 * @returns {number} Longitude in degrees
 */
export function timeToLongitude(t, duration = 20.0) {
  if (typeof t !== 'number' || Number.isNaN(t) || !Number.isFinite(t) || t <= 0.0) return -180.0;
  const dur = (typeof duration === 'number' && duration > 0) ? duration : 20.0;
  if (t >= dur) return 180.0;

  const lon = -180.0 + (t / dur) * 360.0;
  return Math.max(-180.0, Math.min(180.0, lon));
}

/**
 * Calculates cross-fade weights for Night Lights 2012 vs 2023 A/B slider.
 * @param {number} sliderValue - Slider position [0.0, 1.0]
 * @returns {{ weight2012: number, weight2023: number }}
 */
export function calculateNightLightsBlend(sliderValue) {
  const v = (typeof sliderValue !== 'number' || Number.isNaN(sliderValue))
    ? 0.5
    : Math.max(0.0, Math.min(1.0, sliderValue));
  return {
    weight2012: Number((1.0 - v).toFixed(4)),
    weight2023: Number(v.toFixed(4))
  };
}

// Pentatonic pitch classes (C, D, E, G, A) across 3 octaves (C3..A5)
const PENTATONIC_FREQUENCIES = [
  130.81, 146.83, 164.81, 196.00, 220.00, // C3, D3, E3, G3, A3
  261.63, 293.66, 329.63, 392.00, 440.00, // C4, D4, E4, G4, A4
  523.25, 587.33, 659.25, 783.99, 880.00  // C5, D5, E5, G5, A5
];

// ============================================================================
// 2. SweepController ("Earth Jukebox" Playhead)
// ============================================================================

export class SweepController {
  /**
   * @param {Object} [options]
   * @param {AudioContext} [options.audioCtx]
   * @param {Object} [options.overlayManager]
   * @param {number} [options.duration=20.0]
   * @param {number} [options.width=720]
   */
  constructor(options = {}) {
    this.audioCtx = options.audioCtx || null;
    this.overlayManager = options.overlayManager || null;
    this.duration = options.duration || 20.0;
    this.width = options.width || 720;

    this.isPlaying = false;
    this.isPaused = false;
    this.currentTime = 0.0;
    this.currentCol = 0;
    this.currentLon = -180.0;

    this._startTime = 0.0;
    this._pauseOffset = 0.0;
    this._rafId = null;

    // Active layer data { meta, columns, events }
    this.activeLayerId = null;
    this.activeLayerData = null;

    // Triggered event indices to prevent multiple fires per sweep pass
    this._triggeredEventIndices = new Set();

    // Callbacks
    this._listeners = new Map();

    // Dedicated sweep synthesizer bus
    this.sweepGainNode = null;
    if (this.audioCtx) {
      try {
        this.sweepGainNode = this.audioCtx.createGain();
        this.sweepGainNode.gain.setValueAtTime(0.7, this.audioCtx.currentTime);
        this.sweepGainNode.connect(this.audioCtx.destination);
      } catch {
        // audioCtx not yet running
      }
    }
  }

  setAudioContext(audioCtx) {
    this.audioCtx = audioCtx;
    if (this.audioCtx && !this.sweepGainNode) {
      try {
        this.sweepGainNode = this.audioCtx.createGain();
        this.sweepGainNode.gain.setValueAtTime(0.7, this.audioCtx.currentTime);
        this.sweepGainNode.connect(this.audioCtx.destination);
      } catch {
        // ignore
      }
    }
  }

  setOverlayManager(overlayManager) {
    this.overlayManager = overlayManager;
  }

  setLayerData(layerId, data) {
    this.activeLayerId = layerId;
    this.activeLayerData = data;
    this._triggeredEventIndices.clear();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  _emit(event, payload) {
    const handlers = this._listeners.get(event);
    if (handlers) {
      for (const fn of handlers) {
        try {
          fn(payload);
        } catch (e) {
          console.warn(`[SweepController] Event error in ${event}:`, e);
        }
      }
    }
  }

  play() {
    if (this.isPlaying) return;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.isPlaying = true;
    this.isPaused = false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    this._startTime = now - this.currentTime;

    this._runLoop();
    this._emit('play', { time: this.currentTime, lon: this.currentLon, col: this.currentCol });
  }

  pause() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.isPaused = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emit('pause', { time: this.currentTime, lon: this.currentLon, col: this.currentCol });
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    this.currentTime = 0.0;
    this.currentCol = 0;
    this.currentLon = -180.0;
    this._triggeredEventIndices.clear();

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._emit('stop', { time: 0, lon: -180.0, col: 0 });
  }

  seek(timeInSec) {
    const clamped = Math.max(0, Math.min(this.duration, timeInSec));
    this.currentTime = clamped;
    this.currentCol = timeToColumn(this.currentTime, this.duration, this.width);
    this.currentLon = timeToLongitude(this.currentTime, this.duration);

    if (this.isPlaying) {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      this._startTime = now - this.currentTime;
    }

    this._emit('seek', { time: this.currentTime, lon: this.currentLon, col: this.currentCol });
  }

  _runLoop() {
    if (!this.isPlaying) return;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const elapsed = now - this._startTime;

    if (elapsed >= this.duration) {
      // Loop or stop
      this.currentTime = 0.0;
      this._startTime = now;
      this._triggeredEventIndices.clear();
    } else {
      this.currentTime = elapsed;
    }

    this.currentCol = timeToColumn(this.currentTime, this.duration, this.width);
    this.currentLon = timeToLongitude(this.currentTime, this.duration);

    // Check lightning events or discrete triggers
    this._checkEvents();

    // Drive audio synthesis for active column
    this._synthesizeColumnSound();

    this._emit('tick', {
      time: this.currentTime,
      duration: this.duration,
      col: this.currentCol,
      lon: this.currentLon,
      progress: this.currentTime / this.duration
    });

    if (typeof requestAnimationFrame !== 'undefined') {
      this._rafId = requestAnimationFrame(() => this._runLoop());
    }
  }

  _checkEvents() {
    if (!this.activeLayerData || !Array.isArray(this.activeLayerData.events)) return;

    const events = this.activeLayerData.events;
    for (let i = 0; i < events.length; i++) {
      if (this._triggeredEventIndices.has(i)) continue;

      const ev = events[i];
      const eventCol = longitudeToColumn(ev.lon, this.width);

      // Trigger if current playhead reaches or passes event column within a small window
      if (Math.abs(this.currentCol - eventCol) <= 1) {
        this._triggeredEventIndices.add(i);
        this._triggerLightningHit(ev);
      }
    }
  }

  _triggerLightningHit(event) {
    const intensity = event.intensity !== undefined ? event.intensity : 0.8;
    const lat = event.lat !== undefined ? event.lat : 0.0;
    const lon = event.lon !== undefined ? event.lon : 0.0;

    // 1. Globe point sprite flash
    if (this.overlayManager && typeof this.overlayManager.triggerLightningFlash === 'function') {
      this.overlayManager.triggerLightningFlash(lat, lon, intensity);
    }

    // 2. Audio strike synthesis
    if (this.audioCtx && this.sweepGainNode) {
      try {
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const noiseGen = this.audioCtx.createBufferSource();
        const burstGain = this.audioCtx.createGain();
        const panner = this.audioCtx.createStereoPanner
          ? this.audioCtx.createStereoPanner()
          : null;

        // Bandpass click / snap
        osc.type = 'triangle';
        // Map latitude [-90, 90] to pitch [180Hz, 880Hz]
        const pitch = 180 + ((lat + 90) / 180) * 700;
        osc.frequency.setValueAtTime(pitch, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);

        burstGain.gain.setValueAtTime(intensity * 0.85, now);
        burstGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        if (panner) {
          const panVal = Math.max(-1.0, Math.min(1.0, lon / 180.0));
          panner.pan.setValueAtTime(panVal, now);
          osc.connect(burstGain);
          burstGain.connect(panner);
          panner.connect(this.sweepGainNode);
        } else {
          osc.connect(burstGain);
          burstGain.connect(this.sweepGainNode);
        }

        osc.start(now);
        osc.stop(now + 0.16);
      } catch {
        // audio synthesis fallback
      }
    }

    this._emit('lightningEvent', event);
  }

  _synthesizeColumnSound() {
    if (!this.activeLayerData || !Array.isArray(this.activeLayerData.columns)) return;
    const colData = this.activeLayerData.columns[this.currentCol];
    if (!colData) return;

    // Only synthesize periodic tonal pulse if web audio context active
    if (!this.audioCtx || this.activeLayerId === 'lightning') return;

    // Modulate pitch and volume based on column luminance and hue
    const luminance = colData.luminance !== undefined ? colData.luminance : 0.0;
    const hue = colData.hue !== undefined ? colData.hue : 0.0;
    const centroid = colData.vertical_centroid !== undefined ? colData.vertical_centroid : 0.5;

    // Pick pentatonic note from hue
    const noteIdx = Math.floor(hue * PENTATONIC_FREQUENCIES.length) % PENTATONIC_FREQUENCIES.length;
    const freq = PENTATONIC_FREQUENCIES[noteIdx];

    // Every 4 columns (~110ms), trigger short tone if luminance > 0.05
    if (this.currentCol % 4 === 0 && luminance > 0.05) {
      try {
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        const panner = this.audioCtx.createStereoPanner
          ? this.audioCtx.createStereoPanner()
          : null;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        // Volume derived from luminance
        const vol = Math.min(0.4, luminance * 0.4);
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        // Pan derived from vertical centroid (latitude)
        const pan = (centroid - 0.5) * 1.8;

        if (panner) {
          panner.pan.setValueAtTime(Math.max(-1.0, Math.min(1.0, pan)), now);
          osc.connect(gain);
          gain.connect(panner);
          panner.connect(this.sweepGainNode);
        } else {
          osc.connect(gain);
          gain.connect(this.sweepGainNode);
        }

        osc.start(now);
        osc.stop(now + 0.09);
      } catch {
        // ignore audio synthesis error
      }
    }
  }

  /**
   * Adjusts Night Lights 2012 vs 2023 A/B slider balance.
   * @param {number} blendRatio - [0.0, 1.0]
   */
  setNightLightsBlend(blendRatio) {
    const blend = calculateNightLightsBlend(blendRatio);
    if (this.overlayManager && typeof this.overlayManager.setNightLightsBlend === 'function') {
      this.overlayManager.setNightLightsBlend(blendRatio);
    }
    this._emit('nightLightsBlend', blend);
  }
}
