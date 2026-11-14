/**
 * frontend/js/audio/mixer.js
 * 4-Channel Synchronized DAW Mixer for EARTHSONIC Earth Orchestra.
 * 
 * Hardware-scheduled playback on audioCtx.currentTime to eliminate HTML5 audio drift.
 * Orchestrates:
 *   - Track 1: Global Surface Temperature Anomaly
 *   - Track 2: Atmospheric CO2 Concentration
 *   - Track 3: Global Ocean Heat Content
 *   - Track 4: Cryospheric Sea Ice Extent
 */

import { TrackStrip, linearToLogGain, dbToLinearGain, linearGainToDb } from './track.js';

export const TRACK_CONFIGS = [
  {
    id: 'surface_temperature',
    name: 'Global Temperature Anomaly',
    alias: 'temperature',
    color: '#00f0ff', // NASA Cyan
    datasetId: 'surface-temperature',
    defaultVol: 0.85,
    defaultPan: 0.0,
    stereoWidened: false
  },
  {
    id: 'atmospheric_co2',
    name: 'Atmospheric CO2',
    alias: 'co2',
    color: '#f59e0b', // Solar Amber
    datasetId: 'atmospheric-co2',
    defaultVol: 0.80,
    defaultPan: -0.15,
    stereoWidened: false
  },
  {
    id: 'ocean_temperature',
    name: 'Ocean Heat Content',
    alias: 'ocean',
    color: '#3b82f6', // Deep Blue
    datasetId: 'ocean-temperature',
    defaultVol: 0.85,
    defaultPan: 0.0,
    stereoWidened: false
  },
  {
    id: 'sea_ice_extent',
    name: 'Sea Ice Extent',
    alias: 'sea_ice',
    color: '#e0f2fe', // Crystalline Ice Blue
    datasetId: 'sea-ice-extent',
    defaultVol: 0.75,
    defaultPan: 0.0,
    stereoWidened: true
  }
];

/**
 * Solo / Mute Logic Matrix:
 * Pure evaluation function for digital audio workstation mixing.
 * 
 * Truth Table:
 * 1. If track is muted -> Gain = 0.0
 * 2. If ANY track in the mixer is soloed, only tracks that are soloed are audible
 * 3. Otherwise -> Gain = track.getLogGain() (fader^2)
 * 
 * @param {TrackStrip|Object} track - The channel being evaluated
 * @param {Array<TrackStrip|Object>} allTracks - All channels in the mixer
 * @returns {number} Effective gain multiplier [0.0, 1.0]
 */
export function calculateEffectiveGain(track, allTracks) {
  if (track.isMuted) {
    return 0.0;
  }

  const anySolo = allTracks.some(t => Boolean(t.isSoloed));
  if (anySolo) {
    if (!track.isSoloed) {
      return 0.0;
    }
  }

  return typeof track.getLogGain === 'function'
    ? track.getLogGain()
    : linearToLogGain(track.volume !== undefined ? track.volume : 0.8);
}

/**
 * Format elapsed seconds into MM:SS format.
 * @param {number} sec - Time in seconds
 * @returns {string} e.g. "00:15"
 */
export function formatTimeMMSS(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const totalSec = Math.floor(sec);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Format elapsed seconds into MM:SS.ms format for telemetry.
 * @param {number} sec
 * @returns {string} e.g. "00:15.2"
 */
export function formatTimeDetailed(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const totalSec = Math.floor(sec);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const tenths = Math.floor((sec % 1) * 10);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${mm}:${ss}.${tenths}`;
}

/**
 * EarthOrchestraMixer: 4-Channel Sample-Locked Web Audio DAW Engine.
 */
export class EarthOrchestraMixer {
  /**
   * @param {Object} [options]
   * @param {AudioContext} [options.audioCtx]
   * @param {number} [options.masterVolume=0.85]
   * @param {boolean} [options.loop=true]
   */
  constructor(options = {}) {
    this.audioCtx = options.audioCtx || null;
    this.masterVolume = options.masterVolume !== undefined ? options.masterVolume : 0.85;
    this.isLooping = options.loop !== undefined ? Boolean(options.loop) : true;

    // Transport states
    this.isPlaying = false;
    this.isPaused = false;
    this.playStartTime = 0.0;
    this.pauseOffset = 0.0;
    this.duration = 20.0; // Default 20-second sonification
    this.isLoading = false;

    // Channels map: id -> TrackStrip
    this.tracks = new Map();

    // Event listeners
    this._listeners = new Map();
    this._rafId = null;

    // Web Audio Master Bus & Convolver Reverb
    this.busInputNode = null;
    this.dryGainNode = null;
    this.convolverGainNode = null;
    this.convolverNode = null;
    this.masterGainNode = null;
    this.masterAnalyserNode = null;

    if (this.audioCtx) {
      this._initMasterBus();
    }

    // Initialize 4 default channels
    this._initTracks();
  }

  /**
   * Procedural stereo exponential decay impulse response generator.
   * 2.4s stereo impulse response shaped by e^(-3.0 * t) with Gaussian white noise.
   * @param {number} [durationSec=2.4]
   * @param {number} [decay=3.0]
   * @returns {AudioBuffer|null}
   */
  _generateImpulseResponse(durationSec = 2.4, decay = 3.0) {
    if (!this.audioCtx || typeof this.audioCtx.createBuffer !== 'function') return null;
    try {
      const sampleRate = this.audioCtx.sampleRate || 44100;
      const length = Math.floor(sampleRate * durationSec);
      const impulse = this.audioCtx.createBuffer(2, length, sampleRate);
      const left = impulse.getChannelData(0);
      const right = impulse.getChannelData(1);

      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-decay * t);
        // Box-Muller transform for true Gaussian noise
        const u1 = Math.max(1e-12, Math.random());
        const u2 = Math.random();
        const g1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        const g2 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

        left[i] = g1 * envelope;
        right[i] = g2 * envelope;
      }
      return impulse;
    } catch (err) {
      console.warn('[EarthOrchestraMixer] Failed to generate impulse response:', err);
      return null;
    }
  }

  /**
   * Initialize or resume Web Audio API Context.
   * Complies with browser user-interaction security policies.
   */
  async ensureAudioContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
        this._initMasterBus();
        for (const track of this.tracks.values()) {
          track.setAudioContext(this.audioCtx);
          track.connect(this.busInputNode || this.masterGainNode);
        }
      }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    return this.audioCtx;
  }

  /**
   * Setup master output bus:
   * Channels -> Bus Input -> Dry Path (0.85) -----------------------------> Master Gain -> Analyser -> Destination
   *                       -> Convolver Reverb (2.4s) -> Wet Path (0.28) ->
   */
  _initMasterBus() {
    if (!this.audioCtx) return;

    // Intermediate summing bus for all track outputs
    this.busInputNode = this.audioCtx.createGain();
    this.busInputNode.gain.setValueAtTime(1.0, this.audioCtx.currentTime);

    // Dry gain node (0.85)
    this.dryGainNode = this.audioCtx.createGain();
    this.dryGainNode.gain.setValueAtTime(0.85, this.audioCtx.currentTime);

    // Wet convolver gain node (0.28)
    this.convolverGainNode = this.audioCtx.createGain();
    this.convolverGainNode.gain.setValueAtTime(0.28, this.audioCtx.currentTime);

    // Master Gain Node
    this.masterGainNode = this.audioCtx.createGain();
    const initialLogGain = linearToLogGain(this.masterVolume);
    this.masterGainNode.gain.setValueAtTime(initialLogGain, this.audioCtx.currentTime);

    // ConvolverNode hall reverb
    if (typeof this.audioCtx.createConvolver === 'function') {
      try {
        this.convolverNode = this.audioCtx.createConvolver();
        const ir = this._generateImpulseResponse(2.4, 3.0);
        if (ir) {
          this.convolverNode.buffer = ir;
        }
      } catch (err) {
        console.warn('[EarthOrchestraMixer] Convolver creation fallback:', err);
      }
    }

    // Connect dry path: busInputNode -> dryGainNode -> masterGainNode
    this.busInputNode.connect(this.dryGainNode);
    this.dryGainNode.connect(this.masterGainNode);

    // Connect wet path: busInputNode -> convolverNode -> convolverGainNode -> masterGainNode
    if (this.convolverNode) {
      try {
        this.busInputNode.connect(this.convolverNode);
        this.convolverNode.connect(this.convolverGainNode);
        this.convolverGainNode.connect(this.masterGainNode);
      } catch (err) {
        console.warn('[EarthOrchestraMixer] Convolver wiring fallback:', err);
      }
    }

    // Master Analyser Node configured for 64-band visualizer
    this.masterAnalyserNode = this.audioCtx.createAnalyser();
    this.masterAnalyserNode.fftSize = 2048;
    this.masterAnalyserNode.smoothingTimeConstant = 0.8;
    this.masterAnalyserNode.minDecibels = -90.0;
    this.masterAnalyserNode.maxDecibels = -10.0;

    // Connect chain: masterGainNode -> masterAnalyserNode -> destination
    this.masterGainNode.connect(this.masterAnalyserNode);
    this.masterAnalyserNode.connect(this.audioCtx.destination);
  }

  /**
   * Initialize the 4 standard NASA science tracks.
   */
  _initTracks() {
    for (const cfg of TRACK_CONFIGS) {
      const track = new TrackStrip(cfg.id, {
        name: cfg.name,
        color: cfg.color,
        audioCtx: this.audioCtx,
        volume: cfg.defaultVol,
        pan: cfg.defaultPan !== undefined ? cfg.defaultPan : 0.0,
        stereoWidened: Boolean(cfg.stereoWidened),
        isMuted: false,
        isSoloed: false
      });

      if (this.busInputNode) {
        track.connect(this.busInputNode);
      } else if (this.masterGainNode) {
        track.connect(this.masterGainNode);
      }
      this.tracks.set(cfg.id, track);
    }
  }

  /**
   * Get track by ID or alias.
   * @param {string} idOrAlias
   * @returns {TrackStrip|null}
   */
  getTrack(idOrAlias) {
    if (this.tracks.has(idOrAlias)) return this.tracks.get(idOrAlias);
    for (const [id, track] of this.tracks.entries()) {
      const cfg = TRACK_CONFIGS.find(c => c.id === id);
      if (cfg && (cfg.alias === idOrAlias || cfg.datasetId === idOrAlias)) {
        return track;
      }
    }
    return null;
  }

  /**
   * Get all tracks as an Array.
   * @returns {TrackStrip[]}
   */
  getAllTracks() {
    return Array.from(this.tracks.values());
  }

  /**
   * Get AnalyserNode for track by ID, alias, or 0-3 index.
   * Milestone M2 requirement for live shader reactivity.
   * @param {string|number} idOrIndex
   * @returns {AnalyserNode|null}
   */
  getTrackAnalyser(idOrIndex) {
    if (typeof idOrIndex === 'number') {
      const all = this.getAllTracks();
      const track = all[idOrIndex];
      return track ? track.analyserNode : null;
    }
    const track = this.getTrack(idOrIndex);
    return track ? track.analyserNode : null;
  }

  /**
   * Extract 4-channel audio envelopes [env0, env1, env2, env3] in [0.0, 1.0].
   * @param {number} [smoothing=0.25]
   * @returns {number[]}
   */
  getAudioEnvelopes(smoothing = 0.25) {
    const all = this.getAllTracks();
    const envs = [0.0, 0.0, 0.0, 0.0];
    for (let i = 0; i < 4; i++) {
      if (all[i] && typeof all[i].getAudioEnvelope === 'function') {
        envs[i] = all[i].getAudioEnvelope(smoothing);
      }
    }
    return envs;
  }

  /**
   * Recalculate and apply effective gain matrix to all channels with 20ms anti-click ramps.
   */
  updateSoloMuteMatrix() {
    const all = this.getAllTracks();
    for (const track of all) {
      const effectiveGain = calculateEffectiveGain(track, all);
      track.setEffectiveGain(effectiveGain, 0.02);
    }
    this.emit('trackupdate', { tracks: this.getTracksState() });
  }

  /**
   * Alias updateMuteSoloState to updateSoloMuteMatrix to fix runtime guided tour bug.
   */
  updateMuteSoloState() {
    return this.updateSoloMuteMatrix();
  }

  /**
   * Set track volume fader [0.0, 1.0].
   */
  setTrackVolume(trackId, val) {
    const track = this.getTrack(trackId);
    if (!track) return;
    track.setVolume(val);
    this.updateSoloMuteMatrix();
  }

  /**
   * Set track pan [-1.0, +1.0].
   */
  setTrackPan(trackId, val) {
    const track = this.getTrack(trackId);
    if (!track) return;
    track.setPan(val);
    this.emit('trackupdate', { tracks: this.getTracksState() });
  }

  /**
   * Toggle or set track mute.
   */
  setTrackMute(trackId, muted) {
    const track = this.getTrack(trackId);
    if (!track) return;
    track.setMute(muted);
    this.updateSoloMuteMatrix();
  }

  /**
   * Toggle or set track solo.
   */
  setTrackSolo(trackId, soloed) {
    const track = this.getTrack(trackId);
    if (!track) return;
    track.setSolo(soloed);
    this.updateSoloMuteMatrix();
  }

  /**
   * Toggle track solo state.
   * Milestone M3 Gaze interaction method.
   * @param {string} trackId
   * @returns {boolean} New solo state
   */
  toggleTrackSolo(trackId) {
    const track = this.getTrack(trackId);
    if (!track) return false;
    this.setTrackSolo(trackId, !track.isSoloed);
    return track.isSoloed;
  }

  /**
   * Toggle track mute state.
   * Milestone M3 Gaze interaction method.
   * @param {string} trackId
   * @returns {boolean} New mute state
   */
  toggleTrackMute(trackId) {
    const track = this.getTrack(trackId);
    if (!track) return false;
    this.setTrackMute(trackId, !track.isMuted);
    return track.isMuted;
  }

  /**
   * Set Master volume [0.0, 1.0] with 20ms anti-click ramp.
   * @param {number} val
   */
  setMasterVolume(val) {
    this.masterVolume = Math.max(0.0, Math.min(1.0, Number(val) || 0.0));
    const targetGain = linearToLogGain(this.masterVolume);

    if (this.masterGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      try {
        this.masterGainNode.gain.cancelScheduledValues(now);
        const cur = this.masterGainNode.gain.value;
        const safeStart = Math.max(cur, 0.0001);
        this.masterGainNode.gain.setValueAtTime(safeStart, now);
        this.masterGainNode.gain.exponentialRampToValueAtTime(Math.max(targetGain, 0.0001), now + 0.02);
        if (targetGain <= 0.0001) {
          this.masterGainNode.gain.setValueAtTime(0.0, now + 0.021);
        }
      } catch (e) {
        this.masterGainNode.gain.value = targetGain;
      }
    }
    this.emit('statechange', this.getState());
  }

  /**
   * Set looping mode.
   * @param {boolean} loop
   */
  setLoop(loop) {
    this.isLooping = Boolean(loop);
    this.emit('statechange', this.getState());
  }

  /**
   * Load all 4 stems from the backend orchestra manifest or specific URLs.
   * @param {string} [manifestUrl='/api/sonify/orchestra?duration=20']
   */
  async loadManifest(manifestUrl = '/api/sonify/orchestra?duration=20') {
    this.isLoading = true;
    this.emit('loading', { loading: true });

    try {
      await this.ensureAudioContext();

      const res = await fetch(manifestUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching orchestra manifest`);
      const data = await res.json();

      const manifest = data.manifest || {};
      if (data.synchronized_duration_sec) {
        this.duration = data.synchronized_duration_sec;
      }

      // Fetch and decode audio buffers concurrently
      const fetchPromises = Object.entries(manifest).map(async ([key, url]) => {
        const track = this.getTrack(key);
        if (!track) return null;

        const audioRes = await fetch(url);
        if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status} fetching audio for ${key}`);
        const arrayBuf = await audioRes.arrayBuffer();
        const decodedBuf = await this.audioCtx.decodeAudioData(arrayBuf);
        track.setBuffer(decodedBuf);
        return { key, duration: decodedBuf.duration };
      });

      const loadedStems = await Promise.all(fetchPromises);
      
      // Compute maximum duration among decoded buffers
      let maxDur = this.duration;
      for (const item of loadedStems) {
        if (item && item.duration > maxDur) {
          maxDur = item.duration;
        }
      }
      this.duration = maxDur;

      this.isLoading = false;
      this.emit('loading', { loading: false });
      this.emit('loaded', { duration: this.duration, tracks: this.getTracksState() });
      return true;
    } catch (err) {
      this.isLoading = false;
      this.emit('loading', { loading: false, error: err.message });
      console.error("[EarthOrchestraMixer] Failed to load stems:", err);
      throw err;
    }
  }

  /**
   * Master Transport: Play
   * Microsecond sample-locked scheduling on audioCtx.currentTime.
   * @param {number} [seekOffset] - Optional offset in seconds
   */
  async play(seekOffset = null) {
    await this.ensureAudioContext();

    if (seekOffset !== null) {
      this.pauseOffset = Math.max(0.0, Math.min(seekOffset, this.duration));
    }

    // Stop any existing sources before scheduling new ones
    this._stopAllSources();

    const targetOffset = this.pauseOffset >= this.duration ? 0.0 : this.pauseOffset;
    const lookahead = 0.05; // 50ms scheduling lookahead for hardware clock lockstep
    const scheduleTime = this.audioCtx.currentTime + lookahead;

    for (const track of this.tracks.values()) {
      track.createSource(targetOffset, scheduleTime);
    }

    this.playStartTime = scheduleTime - targetOffset;
    this.isPlaying = true;
    this.isPaused = false;
    this.pauseOffset = targetOffset;

    this._startProgressLoop();
    this.emit('statechange', this.getState());
  }

  /**
   * Master Transport: Pause
   */
  pause() {
    if (!this.isPlaying) return;

    this.pauseOffset = this.getCurrentTime();
    this._stopAllSources();
    this.isPlaying = false;
    this.isPaused = true;

    this._stopProgressLoop();
    this.emit('statechange', this.getState());
  }

  /**
   * Master Transport: Stop
   */
  stop() {
    this._stopAllSources();
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseOffset = 0.0;

    this._stopProgressLoop();
    this.emit('statechange', this.getState());
    this.emit('timeupdate', { currentTime: 0.0, duration: this.duration, progress: 0.0 });
  }

  /**
   * Master Transport: Seek
   * Instant lockstep scrubbing across all 4 tracks without phase offset.
   * @param {number} targetTime - Position in seconds [0, duration]
   */
  seek(targetTime) {
    const clamped = Math.max(0.0, Math.min(targetTime, this.duration));
    this.pauseOffset = clamped;

    if (this.isPlaying) {
      // Re-trigger play from target seek timestamp immediately
      this.play(clamped);
    } else {
      this.emit('timeupdate', {
        currentTime: clamped,
        duration: this.duration,
        progress: this.duration > 0 ? clamped / this.duration : 0.0
      });
      this.emit('statechange', this.getState());
    }
  }

  /**
   * Seek audio playhead to normalized progress parameter in [0.0, 1.0].
   * Milestone M3 Glider scrubbing sync method.
   * @param {number} progressT
   */
  seekProgress(progressT) {
    const clamped = Math.max(0.0, Math.min(1.0, Number(progressT) || 0.0));
    this.seek(clamped * this.duration);
  }

  /**
   * Synchronize mixer playhead to VR glider timeline progress.
   * @param {number} t - Timeline progress parameter in [0.0, 1.0]
   */
  syncToTimeline(t) {
    this.seekProgress(t);
  }

  /**
   * Get current playback position in seconds [0.0, duration].
   * @returns {number}
   */
  getCurrentTime() {
    if (this.isPlaying && this.audioCtx) {
      const elapsed = this.audioCtx.currentTime - this.playStartTime;
      return Math.max(0.0, Math.min(elapsed, this.duration));
    }
    return Math.max(0.0, Math.min(this.pauseOffset, this.duration));
  }

  /**
   * Get current playback progress in [0.0, 1.0].
   * @returns {number}
   */
  getProgress() {
    return this.duration > 0 ? this.getCurrentTime() / this.duration : 0.0;
  }

  /**
   * Get Master AnalyserNode for external visualizers.
   * @returns {AnalyserNode|null}
   */
  getMasterAnalyser() {
    return this.masterAnalyserNode;
  }

  /**
   * Read real-time Master RMS and peak dBFS.
   */
  getMasterMeter() {
    if (!this.masterAnalyserNode) {
      return { rms: 0.0, rmsDb: -100.0, peak: 0.0, peakDb: -100.0 };
    }

    const bufferLength = this.masterAnalyserNode.frequencyBinCount;
    const timeData = new Float32Array(bufferLength);
    this.masterAnalyserNode.getFloatTimeDomainData(timeData);

    let sumSquares = 0.0;
    let peak = 0.0;

    for (let i = 0; i < bufferLength; i++) {
      const val = timeData[i];
      const absVal = Math.abs(val);
      if (absVal > peak) peak = absVal;
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / bufferLength);
    const rmsDb = linearGainToDb(rms);
    const peakDb = linearGainToDb(peak);

    return { rms, rmsDb, peak, peakDb };
  }

  /**
   * Internal source stopper.
   */
  _stopAllSources() {
    for (const track of this.tracks.values()) {
      track.stopSource();
    }
  }

  /**
   * Background tick loop for progress updates and loop handling.
   */
  _startProgressLoop() {
    this._stopProgressLoop();

    const tick = () => {
      if (!this.isPlaying) return;

      const curTime = this.getCurrentTime();

      // Check for playback completion
      if (curTime >= this.duration) {
        if (this.isLooping) {
          this.play(0.0);
        } else {
          this.stop();
          return;
        }
      }

      this.emit('timeupdate', {
        currentTime: curTime,
        duration: this.duration,
        progress: this.getProgress()
      });

      if (typeof requestAnimationFrame === 'function') {
        this._rafId = requestAnimationFrame(tick);
      } else {
        this._rafId = setTimeout(tick, 33);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(tick);
    } else {
      this._rafId = setTimeout(tick, 33);
    }
  }

  _stopProgressLoop() {
    if (this._rafId) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._rafId);
      } else {
        clearTimeout(this._rafId);
      }
      this._rafId = null;
    }
  }

  /**
   * Event Observer methods.
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(handler);
    }
  }

  emit(event, payload) {
    if (this._listeners.has(event)) {
      for (const fn of this._listeners.get(event)) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[EarthOrchestraMixer] Event '${event}' handler threw:`, err);
        }
      }
    }
  }

  /**
   * Serialize current mixer and track state for UI.
   */
  getState() {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      isLooping: this.isLooping,
      currentTime: this.getCurrentTime(),
      duration: this.duration,
      progress: this.getProgress(),
      masterVolume: this.masterVolume,
      formattedTime: formatTimeMMSS(this.getCurrentTime()),
      formattedDuration: formatTimeMMSS(this.duration),
      tracks: this.getTracksState()
    };
  }

  getTracksState() {
    const result = {};
    for (const [id, track] of this.tracks.entries()) {
      result[id] = track.getState();
    }
    return result;
  }
}

/**
 * WebAudioMixer alias for EarthOrchestraMixer.
 */
export const WebAudioMixer = EarthOrchestraMixer;

