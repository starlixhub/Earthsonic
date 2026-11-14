/**
 * frontend/js/audio/track.js
 * Channel Strip module for EARTHSONIC Earth Orchestra.
 * Wraps AudioBufferSourceNode, GainNode, StereoPannerNode, AnalyserNode,
 * and maintains track state (volume, pan, mute, solo, buffer).
 */

/**
 * Convert linear fader position [0.0, 1.0] to logarithmic gain:
 * V_gain = val^2
 * Preserves human perceived loudness linearity.
 * @param {number} val - Fader value in [0.0, 1.0]
 * @returns {number} Logarithmic gain in [0.0, 1.0]
 */
export function linearToLogGain(val) {
  const clamped = Math.max(0.0, Math.min(1.0, Number(val) || 0.0));
  return clamped * clamped;
}

/**
 * Convert decibels (-60 dB to +6 dB) to linear gain.
 * Gain = 10^(dB / 20)
 * @param {number} db - Value in decibels
 * @returns {number} Linear gain multiplier
 */
export function dbToLinearGain(db) {
  if (db <= -60.0) return 0.0;
  return Math.pow(10.0, db / 20.0);
}

/**
 * Convert linear gain to decibels relative to full scale (dBFS).
 * @param {number} gain - Gain multiplier
 * @param {number} [floor=-100.0] - Floor clamping in dB
 * @returns {number} Value in dBFS
 */
export function linearGainToDb(gain, floor = -100.0) {
  if (gain <= 1e-5) return floor;
  return Math.max(floor, 20.0 * Math.log10(gain));
}

/**
 * NASA Psychoacoustic D Dorian / Lydian scale frequencies (220 Hz - 880 Hz).
 */
export const D_DORIAN_LYDIAN_SCALE = [
  220.0, 246.94, 277.18, 293.66, 329.63, 369.99,
  440.0, 493.88, 554.37, 587.33, 659.25, 739.99, 880.0
];

/**
 * Quantize continuous frequency to nearest pitch in D Dorian / Lydian scale.
 * @param {number} freq - Continuous frequency in Hz
 * @param {number[]} [scale=D_DORIAN_LYDIAN_SCALE]
 * @returns {number} Quantized frequency in Hz
 */
export function quantizeToScale(freq, scale = D_DORIAN_LYDIAN_SCALE) {
  let closest = scale[0];
  let minDiff = Math.abs(freq - closest);
  for (let i = 1; i < scale.length; i++) {
    const diff = Math.abs(freq - scale[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = scale[i];
    }
  }
  return closest;
}

/**
 * Generate soft clipping / harmonic saturation curve for atmospheric CO2.
 * @param {number} [k=20] - Saturation amount
 * @param {number} [samples=1024]
 * @returns {Float32Array}
 */
export function createSaturationCurve(k = 20, samples = 1024) {
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; ++i) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * TrackStrip: Represents a single channel in the Earth Orchestra DAW.
 */
export class TrackStrip {
  /**
   * @param {string} id - Unique identifier (e.g. 'surface_temperature')
   * @param {Object} [options]
   * @param {string} [options.name] - Human-readable label
   * @param {string} [options.color] - CSS accent color hex/rgb
   * @param {AudioContext} [options.audioCtx] - Web Audio API context
   * @param {number} [options.volume=0.8] - Linear volume in [0, 1]
   * @param {number} [options.pan=0.0] - Stereo pan in [-1, 1]
   * @param {boolean} [options.isMuted=false] - Initial mute state
   * @param {boolean} [options.isSoloed=false] - Initial solo state
   */
  constructor(id, options = {}) {
    this.id = id;
    this.name = options.name || id;
    this.color = options.color || '#00f0ff';
    this.audioCtx = options.audioCtx || null;

    this.volume = options.volume !== undefined ? Math.max(0.0, Math.min(1.0, options.volume)) : 0.8;
    this.pan = options.pan !== undefined ? Math.max(-1.0, Math.min(1.0, options.pan)) : 0.0;
    this.stereoWidened = Boolean(options.stereoWidened);
    this.isMuted = Boolean(options.isMuted);
    this.isSoloed = Boolean(options.isSoloed);
    this.effectiveGain = this.getLogGain();
    this._currentEnvelope = 0.0;

    this.buffer = null;
    this.duration = 0.0;

    // Web Audio Nodes
    this.sourceNode = null;
    this.gainNode = null;
    this.inputNode = null;
    this.butterworthLpf1 = null;
    this.butterworthLpf2 = null;
    this.saturationNode = null;
    this.pannerNode = null;
    this.widenerNode = null;
    this.analyserNode = null;
    this.outputNode = null;

    if (this.audioCtx) {
      this._initNodes();
    }
  }

  /**
   * Initialize Web Audio nodes.
   * Node graph: sourceNode -> [inputNode / DSP Filters] -> gainNode -> pannerNode -> [widenerNode] -> analyserNode -> outputNode
   */
  _initNodes() {
    if (!this.audioCtx) return;

    // Channel Gain Node
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.setValueAtTime(this.effectiveGain, this.audioCtx.currentTime);

    // Specialized NASA Psychoacoustic DSP Pre-Processing
    if ((this.id === 'ocean_temperature' || this.id === 'ocean') && typeof this.audioCtx.createBiquadFilter === 'function') {
      try {
        // Cascaded 24 dB/oct Butterworth Lowpass Filter (2 cascaded BiquadFilterNodes each Q=0.7071)
        this.butterworthLpf1 = this.audioCtx.createBiquadFilter();
        this.butterworthLpf1.type = 'lowpass';
        this.butterworthLpf1.Q.value = Math.SQRT1_2; // 0.7071 Butterworth Q
        this.butterworthLpf1.frequency.setValueAtTime(130.0, this.audioCtx.currentTime);

        this.butterworthLpf2 = this.audioCtx.createBiquadFilter();
        this.butterworthLpf2.type = 'lowpass';
        this.butterworthLpf2.Q.value = Math.SQRT1_2; // 0.7071 Butterworth Q
        this.butterworthLpf2.frequency.setValueAtTime(130.0, this.audioCtx.currentTime);

        this.butterworthLpf1.connect(this.butterworthLpf2);
        this.butterworthLpf2.connect(this.gainNode);
        this.inputNode = this.butterworthLpf1;
      } catch (e) {
        this.inputNode = this.gainNode;
      }
    } else if ((this.id === 'atmospheric_co2' || this.id === 'co2') && typeof this.audioCtx.createWaveShaper === 'function') {
      try {
        this.saturationNode = this.audioCtx.createWaveShaper();
        this.saturationNode.curve = createSaturationCurve(20);
        this.saturationNode.oversample = '2x';
        this.saturationNode.connect(this.gainNode);
        this.inputNode = this.saturationNode;
      } catch (e) {
        this.inputNode = this.gainNode;
      }
    } else {
      this.inputNode = this.gainNode;
    }

    // Channel Stereo Panner
    if (typeof this.audioCtx.createStereoPanner === 'function') {
      this.pannerNode = this.audioCtx.createStereoPanner();
      this.pannerNode.pan.setValueAtTime(this.pan, this.audioCtx.currentTime);
    } else {
      // Fallback for environments lacking StereoPannerNode
      this.pannerNode = this.audioCtx.createGain();
    }

    // Optional Stereo Widener (Haas psychoacoustic decorrelation)
    if (this.stereoWidened && typeof this.audioCtx.createDelay === 'function' && typeof this.audioCtx.createChannelSplitter === 'function') {
      try {
        const splitter = this.audioCtx.createChannelSplitter(2);
        const merger = this.audioCtx.createChannelMerger(2);
        const delayL = this.audioCtx.createDelay();
        const delayR = this.audioCtx.createDelay();
        delayL.delayTime.value = 0.0;
        delayR.delayTime.value = 0.012; // 12ms Haas delay for expansive Arctic stereo width
        this.pannerNode.connect(splitter);
        splitter.connect(delayL, 0);
        splitter.connect(delayR, 1);
        delayL.connect(merger, 0, 0);
        delayR.connect(merger, 0, 1);
        this.widenerNode = merger;
      } catch (e) {
        this.widenerNode = this.pannerNode;
      }
    } else {
      this.widenerNode = this.pannerNode;
    }

    // Channel Analyser for track-level metering
    this.analyserNode = this.audioCtx.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.5;

    // Wire internal chain
    this.gainNode.connect(this.pannerNode);
    if (this.widenerNode !== this.pannerNode) {
      this.widenerNode.connect(this.analyserNode);
    } else {
      this.pannerNode.connect(this.analyserNode);
    }
    this.outputNode = this.analyserNode;
  }

  /**
   * Set or update AudioContext if lazily created.
   * @param {AudioContext} ctx
   */
  setAudioContext(ctx) {
    if (this.audioCtx === ctx && this.gainNode) return;
    this.audioCtx = ctx;
    this._initNodes();
  }

  /**
   * Connect channel output to destination (e.g. Master Bus Gain).
   * @param {AudioNode} destinationNode
   */
  connect(destinationNode) {
    if (this.outputNode && destinationNode) {
      this.outputNode.connect(destinationNode);
    }
  }

  /**
   * Disconnect channel output.
   */
  disconnect() {
    if (this.outputNode) {
      try {
        this.outputNode.disconnect();
      } catch (e) {
        // Ignored
      }
    }
  }

  /**
   * Store decoded AudioBuffer.
   * @param {AudioBuffer} audioBuffer
   */
  setBuffer(audioBuffer) {
    this.buffer = audioBuffer;
    this.duration = audioBuffer ? audioBuffer.duration : 0.0;
  }

  /**
   * Calculate base logarithmic fader gain.
   * @returns {number}
   */
  getLogGain() {
    return linearToLogGain(this.volume);
  }

  /**
   * Set channel fader volume [0.0, 1.0].
   * @param {number} val
   */
  setVolume(val) {
    this.volume = Math.max(0.0, Math.min(1.0, Number(val) || 0.0));
  }

  /**
   * Set channel stereo panning [-1.0 (Left), +1.0 (Right)].
   * @param {number} val
   */
  setPan(val) {
    this.pan = Math.max(-1.0, Math.min(1.0, Number(val) || 0.0));
    if (this.pannerNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      if (this.pannerNode.pan && typeof this.pannerNode.pan.setValueAtTime === 'function') {
        this.pannerNode.pan.setValueAtTime(this.pan, now);
      }
    }
  }

  /**
   * Set channel mute state.
   * @param {boolean} muted
   */
  setMute(muted) {
    this.isMuted = Boolean(muted);
  }

  /**
   * Set channel solo state.
   * @param {boolean} soloed
   */
  setSolo(soloed) {
    this.isSoloed = Boolean(soloed);
  }

  /**
   * Apply calculated effective gain using 20 ms exponential anti-click ramp.
   * Prevents clicks/pops when soloing, muting, or adjusting faders in real time.
   * @param {number} targetGain - Calculated target gain
   * @param {number} [rampTime=0.02] - Exponential ramp duration in seconds (20ms)
   */
  setEffectiveGain(targetGain, rampTime = 0.02) {
    const clampedGain = Math.max(0.0, Math.min(2.0, Number(targetGain) || 0.0));
    this.effectiveGain = clampedGain;

    if (!this.gainNode || !this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const currentGain = this.gainNode.gain.value;

    try {
      this.gainNode.gain.cancelScheduledValues(now);

      if (clampedGain <= 0.0001) {
        // Ramp down to near-zero then zero to avoid clicks with exponentialRamp
        const safeStart = Math.max(currentGain, 0.0001);
        this.gainNode.gain.setValueAtTime(safeStart, now);
        this.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + rampTime);
        this.gainNode.gain.setValueAtTime(0.0, now + rampTime + 0.001);
      } else {
        const safeStart = Math.max(currentGain, 0.0001);
        this.gainNode.gain.setValueAtTime(safeStart, now);
        this.gainNode.gain.exponentialRampToValueAtTime(clampedGain, now + rampTime);
      }
    } catch (err) {
      // Fallback if context is in non-running state
      this.gainNode.gain.value = clampedGain;
    }
  }

  /**
   * Create and schedule an AudioBufferSourceNode at a synchronized time and playhead offset.
   * @param {number} [offset=0] - Playhead offset in seconds
   * @param {number} [startTime=0] - Web Audio clock time (audioCtx.currentTime)
   * @returns {AudioBufferSourceNode|null}
   */
  createSource(offset = 0, startTime = 0) {
    this.stopSource();

    if (!this.buffer || !this.audioCtx || !this.gainNode) return null;

    try {
      const source = this.audioCtx.createBufferSource();
      source.buffer = this.buffer;
      source.connect(this.inputNode || this.gainNode);

      const when = startTime > 0 ? startTime : this.audioCtx.currentTime;
      const safeOffset = Math.max(0.0, Math.min(offset, this.duration));

      source.start(when, safeOffset);
      this.sourceNode = source;
      return source;
    } catch (err) {
      console.warn(`[TrackStrip ${this.id}] Failed to create source node:`, err);
      return null;
    }
  }

  /**
   * Stop active source node and disconnect.
   */
  stopSource() {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch (e) {
        // May already be stopped or ended
      }
      try {
        this.sourceNode.disconnect();
      } catch (e) {}
      this.sourceNode = null;
    }
  }

  /**
   * Read real-time RMS amplitude and peak dB from track's AnalyserNode.
   * @returns {{ rms: number, rmsDb: number, peak: number, peakDb: number }}
   */
  getMeterLevel() {
    if (!this.analyserNode) {
      return { rms: 0.0, rmsDb: -100.0, peak: 0.0, peakDb: -100.0 };
    }

    const bufferLength = this.analyserNode.frequencyBinCount;
    const timeData = new Float32Array(bufferLength);
    this.analyserNode.getFloatTimeDomainData(timeData);

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
   * Extract normalized, smoothed time-domain amplitude envelope in [0.0, 1.0]
   * for driving live WebGL planetary shader reactions.
   * @param {number} [smoothing=0.25] - Single-pole EMA lowpass smoothing factor
   * @returns {number} Normalized envelope in [0.0, 1.0]
   */
  getAudioEnvelope(smoothing = 0.25) {
    if (!this.analyserNode) {
      return 0.0;
    }

    const bufferLength = this.analyserNode.frequencyBinCount;
    const timeData = new Float32Array(bufferLength);
    this.analyserNode.getFloatTimeDomainData(timeData);

    let sumSquares = 0.0;
    for (let i = 0; i < bufferLength; i++) {
      const val = timeData[i];
      sumSquares += val * val;
    }

    const rms = Math.sqrt(sumSquares / bufferLength);
    const target = Math.min(1.0, rms * 2.8); // 2.8x perceptual headroom gain

    if (this._currentEnvelope === undefined) {
      this._currentEnvelope = 0.0;
    }
    this._currentEnvelope += (target - this._currentEnvelope) * smoothing;
    return Math.max(0.0, Math.min(1.0, this._currentEnvelope));
  }

  setStereoWidened(widened) {
    this.stereoWidened = Boolean(widened);
  }

  /**
   * Adjust 24 dB/oct Butterworth filter cutoff frequency.
   * @param {number} freqHz - Frequency in Hz [36, 20000]
   * @param {number} [rampTime=0.03]
   */
  setFilterCutoff(freqHz, rampTime = 0.03) {
    const clamped = Math.max(20.0, Math.min(22000.0, Number(freqHz) || 130.0));
    if (this.butterworthLpf1 && this.butterworthLpf2 && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      try {
        this.butterworthLpf1.frequency.cancelScheduledValues(now);
        this.butterworthLpf2.frequency.cancelScheduledValues(now);
        this.butterworthLpf1.frequency.setTargetAtTime(clamped, now, rampTime);
        this.butterworthLpf2.frequency.setTargetAtTime(clamped, now, rampTime);
      } catch (e) {
        this.butterworthLpf1.frequency.value = clamped;
        this.butterworthLpf2.frequency.value = clamped;
      }
    }
  }

  /**
   * Synthesize procedural NASA psychoacoustic voice buffer.
   * Renders the authentic voice directly in Web Audio if offline or testing.
   * @param {number} [durationSec=20.0]
   * @param {number} [sampleRate=44100]
   * @returns {AudioBuffer|null}
   */
  synthesizeVoiceBuffer(durationSec = 20.0, sampleRate = 44100) {
    if (!this.audioCtx || typeof this.audioCtx.createBuffer !== 'function') return null;
    const numSamples = Math.floor(durationSec * sampleRate);
    const buffer = this.audioCtx.createBuffer(2, numSamples, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);

    const isTemp = this.id.includes('temperature') && !this.id.includes('ocean');
    const isCo2 = this.id.includes('co2');
    const isOcean = this.id.includes('ocean');
    const isSeaIce = this.id.includes('ice');

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const progress = t / durationSec;
      let sampleL = 0.0;
      let sampleR = 0.0;

      if (isTemp) {
        // Surface Temperature: D Dorian / Lydian scale (220 Hz - 880 Hz) FM string + bowed cello pad with 12-month pulse
        const freqTarget = 220.0 + (880.0 - 220.0) * progress;
        const quantized = quantizeToScale(freqTarget);
        const seasonalPulse = 1.0 + 0.12 * Math.sin(2.0 * Math.PI * (t / 1.0));
        const mod = Math.sin(2.0 * Math.PI * quantized * 2.0 * t) * 0.35;
        const carrier = Math.sin(2.0 * Math.PI * quantized * t + mod);
        const celloSaw = (2.0 * ((t * (quantized * 0.5)) % 1.0) - 1.0) * 0.25;
        sampleL = (carrier * 0.65 + celloSaw) * seasonalPulse * 0.7;
        sampleR = (Math.sin(2.0 * Math.PI * (quantized * 1.002) * t + mod) * 0.65 + celloSaw) * seasonalPulse * 0.7;
      } else if (isCo2) {
        // Atmospheric CO2: 110 Hz fundamental analog brass/organ drone breathing with annual cycle + saturation
        const baseFreq = 110.0 * (1.0 + progress * 0.5);
        const breath = 1.0 + 0.15 * Math.sin(2.0 * Math.PI * t);
        const saw1 = (2.0 * ((t * baseFreq) % 1.0) - 1.0);
        const saw2 = (2.0 * ((t * (baseFreq * 1.008)) % 1.0) - 1.0);
        const square = Math.sign(Math.sin(2.0 * Math.PI * (baseFreq * 2.0) * t)) * 0.2;
        let mix = (saw1 * 0.4 + saw2 * 0.4 + square) * breath * 0.6;
        if (progress > 0.4) {
          const drive = 1.0 + (progress - 0.4) * 2.5;
          mix = Math.tanh(mix * drive);
        }
        sampleL = mix;
        sampleR = mix;
      } else if (isOcean) {
        // Ocean Heat: Deep NOAA hydrophone sub-bass swell (36 Hz - 130 Hz) with Butterworth sweep
        const freq = 36.0 + (130.0 - 36.0) * progress;
        const swell = 0.5 + 0.5 * Math.sin(Math.PI * progress);
        const sub1 = Math.sin(2.0 * Math.PI * freq * t);
        const sub2 = Math.sin(2.0 * Math.PI * (freq * 1.5) * t) * 0.35;
        const sub3 = Math.sin(2.0 * Math.PI * (freq * 0.5) * t) * 0.4;
        const mono = (sub1 + sub2 + sub3) * swell * 0.75;
        sampleL = mono;
        sampleR = mono;
      } else if (isSeaIce) {
        // Sea Ice: 1200 Hz - 4200 Hz crystalline bell inharmonics crossfading into polar wind noise near 4.0 M km²
        const bellVolume = Math.max(0.0, 1.0 - progress * 1.2);
        const windVolume = Math.min(1.0, progress * 1.3);
        const bell = (
          Math.sin(2.0 * Math.PI * 1318.0 * t) * 0.35 +
          Math.sin(2.0 * Math.PI * 1975.0 * t) * 0.30 +
          Math.sin(2.0 * Math.PI * 2960.0 * t) * 0.20 +
          Math.sin(2.0 * Math.PI * 4186.0 * t) * 0.15
        ) * bellVolume;
        const noise = (Math.random() * 2.0 - 1.0) * windVolume * 0.35;
        sampleL = bell + noise;
        sampleR = bell + (Math.random() * 2.0 - 1.0) * windVolume * 0.35;
      } else {
        sampleL = Math.sin(2.0 * Math.PI * 440.0 * t) * 0.5;
        sampleR = sampleL;
      }

      left[i] = sampleL;
      right[i] = sampleR;
    }

    this.setBuffer(buffer);
    return buffer;
  }

  /**
   * Serialize track state for telemetry and UI.
   */
  getState() {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      volume: this.volume,
      logGain: this.getLogGain(),
      pan: this.pan,
      stereoWidened: this.stereoWidened,
      isMuted: this.isMuted,
      isSoloed: this.isSoloed,
      effectiveGain: this.effectiveGain,
      hasBuffer: Boolean(this.buffer),
      duration: this.duration
    };
  }
}
