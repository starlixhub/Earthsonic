/**
 * frontend/js/visualizer/visualizer.js
 * Real-Time Audio Visualizer for EARTHSONIC.
 * 
 * Features:
 *   1. 64-Band Logarithmic FFT Spectrum with Falling Gravity Peak-Hold Caps
 *   2. Zero-Crossing Triggered Oscilloscope Waveform (Anti-Jitter)
 *   3. Real-Time RMS Sound Intensity & Peak Decibel (dBFS) Meter
 */

import { linearGainToDb } from '../audio/track.js';

/**
 * Compute logarithmic frequency band boundaries for 64 audio bands.
 * Frequencies geometrically spaced from fMin to fMax.
 * @param {number} numBands - Number of bands (64)
 * @param {number} [fMin=20.0] - Minimum frequency in Hz
 * @param {number} [fMax=20000.0] - Maximum frequency in Hz
 * @param {number} [fftSize=2048] - FFT size
 * @param {number} [sampleRate=44100] - Sample rate in Hz
 * @returns {Array<{ startFreq: number, endFreq: number, startBin: number, endBin: number }>}
 */
export function computeLogarithmicBands(
  numBands = 64,
  fMin = 20.0,
  fMax = 20000.0,
  fftSize = 2048,
  sampleRate = 44100
) {
  const bands = [];
  const binResolution = sampleRate / fftSize; // ~21.53 Hz per bin
  const nyquist = sampleRate / 2.0;
  const clampedFMax = Math.min(fMax, nyquist);
  const totalBins = fftSize / 2;

  for (let k = 0; k < numBands; k++) {
    const startFreq = fMin * Math.pow(clampedFMax / fMin, k / numBands);
    const endFreq = fMin * Math.pow(clampedFMax / fMin, (k + 1) / numBands);

    let startBin = Math.floor(startFreq / binResolution);
    let endBin = Math.ceil(endFreq / binResolution);

    // Clamp to valid FFT bin indices
    startBin = Math.max(0, Math.min(startBin, totalBins - 1));
    endBin = Math.max(startBin + 1, Math.min(endBin, totalBins));

    bands.push({
      bandIndex: k,
      startFreq,
      endFreq,
      startBin,
      endBin
    });
  }

  return bands;
}

/**
 * Detect the first positive-slope zero crossing to stabilize oscilloscope trace.
 * Prevents jitter and strobing on periodic signals.
 * @param {Float32Array} buffer - Time domain audio buffer
 * @param {number} [maxSearch=1024] - Maximum sample offset to search
 * @returns {number} Sample index of the stabilized trigger point
 */
export function findZeroCrossingTrigger(buffer, maxSearch = 1024) {
  if (!buffer || buffer.length < 2) return 0;
  const limit = Math.min(buffer.length - 1, maxSearch);

  for (let i = 0; i < limit; i++) {
    // Zero crossing: transitioning from negative/zero to positive
    if (buffer[i] <= 0.0 && buffer[i + 1] > 0.0) {
      return i;
    }
  }

  return 0; // Fallback to start if no zero crossing is found
}

/**
 * Compute Root Mean Square (RMS) amplitude of audio buffer.
 * RMS = sqrt( (1/N) * sum(x[i]^2) )
 * @param {Float32Array|Array<number>} buffer
 * @returns {number} Linear RMS amplitude [0.0, 1.0]
 */
export function calculateRMS(buffer) {
  if (!buffer || buffer.length === 0) return 0.0;
  let sumSquares = 0.0;
  const len = buffer.length;

  for (let i = 0; i < len; i++) {
    const val = buffer[i];
    sumSquares += val * val;
  }

  return Math.sqrt(sumSquares / len);
}

/**
 * Compute peak absolute amplitude of audio buffer.
 * @param {Float32Array|Array<number>} buffer
 * @returns {number} Peak amplitude [0.0, 1.0]
 */
export function calculatePeak(buffer) {
  if (!buffer || buffer.length === 0) return 0.0;
  let peak = 0.0;
  const len = buffer.length;

  for (let i = 0; i < len; i++) {
    const absVal = Math.abs(buffer[i]);
    if (absVal > peak) peak = absVal;
  }

  return peak;
}

/**
 * Compute decibels relative to full scale (dBFS):
 * dBFS = 20 * log10(val)
 * @param {number} linearVal - Linear amplitude
 * @param {number} [floor=-100.0] - Silence floor in dB
 * @returns {number} Decibels in [floor, 0.0]
 */
export function calculateDbFS(linearVal, floor = -100.0) {
  if (linearVal <= 1e-5) return floor;
  const db = 20.0 * Math.log10(linearVal);
  return Math.max(floor, Math.min(0.0, db));
}

/**
 * AudioVisualizer: Canvas 2D Flight-Deck Visualizer Suite.
 */
export class AudioVisualizer {
  /**
   * @param {Object} [options]
   * @param {AnalyserNode} [options.analyserNode] - Master Analyser Node
   * @param {HTMLCanvasElement|string} [options.spectrumCanvas] - Canvas element or ID
   * @param {HTMLCanvasElement|string} [options.waveformCanvas] - Canvas element or ID
   * @param {HTMLElement|string} [options.rmsMeterElement] - Optional RMS bar element
   * @param {HTMLElement|string} [options.rmsTextElement] - Optional RMS text element
   * @param {HTMLElement|string} [options.peakTextElement] - Optional Peak text element
   * @param {number} [options.gravity=0.004] - Gravity acceleration for falling peak caps
   */
  constructor(options = {}) {
    this.analyserNode = options.analyserNode || null;
    this.gravity = options.gravity !== undefined ? options.gravity : 0.004;

    // DOM Elements
    this.spectrumCanvas = this._resolveElement(options.spectrumCanvas || 'spectrum-canvas');
    if (this.spectrumCanvas) {
      if (!this.spectrumCanvas.width) this.spectrumCanvas.width = 220;
      if (!this.spectrumCanvas.height) this.spectrumCanvas.height = 36;
    }
    this.waveformCanvas = this._resolveElement(options.waveformCanvas || 'waveform-canvas');
    this.rmsMeterElement = this._resolveElement(options.rmsMeterElement || 'rms-meter-bar');
    this.rmsTextElement = this._resolveElement(options.rmsTextElement || 'rms-db-text');
    this.peakTextElement = this._resolveElement(options.peakTextElement || 'peak-db-text');

    // 2D Canvas contexts
    this.spectrumCtx = this.spectrumCanvas ? this.spectrumCanvas.getContext('2d') : null;
    this.waveformCtx = this.waveformCanvas ? this.waveformCanvas.getContext('2d') : null;

    // Visualizer state
    this.isRunning = false;
    this._rafId = null;
    this.numBands = 64;

    // Precomputed 64 logarithmic bands
    this.bands = computeLogarithmicBands(this.numBands, 20.0, 20000.0, 2048, 44100);

    // Peak-hold caps state for 64 bands
    this.peakHoldValues = new Float32Array(this.numBands);
    this.peakHoldVelocities = new Float32Array(this.numBands);

    // Internal buffers
    this.freqData = null;
    this.timeData = null;

    if (this.analyserNode) {
      this._initBuffers();
    }

    // Auto-resize canvas resolution
    this._setupResizeHandlers();
  }

  _resolveElement(elOrId) {
    if (typeof elOrId === 'string') {
      return typeof document !== 'undefined' ? document.getElementById(elOrId) : null;
    }
    return elOrId || null;
  }

  /**
   * Connect an AnalyserNode to the visualizer.
   * @param {AnalyserNode} analyserNode
   */
  connect(analyserNode) {
    this.analyserNode = analyserNode;
    this._initBuffers();
  }

  _initBuffers() {
    if (!this.analyserNode) return;
    const fftSize = this.analyserNode.fftSize || 2048;
    const sampleRate = (this.analyserNode.context && this.analyserNode.context.sampleRate) || 44100;
    
    this.bands = computeLogarithmicBands(this.numBands, 20.0, 20000.0, fftSize, sampleRate);
    this.freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.timeData = new Float32Array(fftSize);
  }

  /**
   * Adjust canvas resolution to match client display dimensions with DPR.
   */
  _setupResizeHandlers() {
    if (typeof window === 'undefined') return;

    const resizeCanvases = () => {
      this.resizeCanvas(this.spectrumCanvas, this.spectrumCtx);
      this.resizeCanvas(this.waveformCanvas, this.waveformCtx);
    };

    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
  }

  resizeCanvas(canvas, ctx) {
    if (!canvas || !ctx) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1.0;
    const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    const isSpectrum = canvas.id === 'spectrum-canvas';
    const w = isSpectrum ? 220 : Math.floor((rect && rect.width) || canvas.width || 300);
    const h = isSpectrum ? 36 : Math.floor((rect && rect.height) || canvas.height || 100);

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      if (ctx.setTransform) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }
  }

  /**
   * Start 60 FPS real-time rendering loop.
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const loop = () => {
      if (!this.isRunning) return;
      this.render();
      if (typeof requestAnimationFrame === 'function') {
        this._rafId = requestAnimationFrame(loop);
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(loop);
    }
  }

  /**
   * Stop rendering loop.
   */
  stop() {
    this.isRunning = false;
    if (this._rafId) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this._rafId);
      }
      this._rafId = null;
    }
  }

  /**
   * Render single frame across Spectrum, Oscilloscope, and VU Meter.
   */
  render() {
    if (!this.analyserNode) {
      this._renderIdleState();
      return;
    }

    if (!this.freqData || !this.timeData) {
      this._initBuffers();
    }

    // Fetch frequency and time domain data from Web Audio Analyser
    this.analyserNode.getByteFrequencyData(this.freqData);
    this.analyserNode.getFloatTimeDomainData(this.timeData);

    // 1. Render Logarithmic 64-Band Spectrum
    this.renderSpectrum();

    // 2. Render Oscilloscope Waveform with Zero-Crossing Trigger
    this.renderWaveform();

    // 3. Compute and Render RMS & Peak dB Telemetry
    this.renderMeters();
  }

  /**
   * Render 64-Band Logarithmic FFT Spectrum with Gravity Peak Caps.
   */
  renderSpectrum() {
    if (!this.spectrumCanvas || !this.spectrumCtx || !this.freqData) return;

    const ctx = this.spectrumCtx;
    const rect = this.spectrumCanvas.getBoundingClientRect ? this.spectrumCanvas.getBoundingClientRect() : null;
    const width = (rect && rect.width) || this.spectrumCanvas.width || 220;
    const height = (rect && rect.height) || this.spectrumCanvas.height || 36;

    // Clear with transparent dark background
    ctx.clearRect(0, 0, width, height);

    const gap = 1.0;
    const barWidth = Math.max(1.0, (width - (this.numBands - 1) * gap) / this.numBands);

    for (let k = 0; k < this.numBands; k++) {
      const band = this.bands[k];
      let sum = 0;
      let count = 0;

      for (let b = band.startBin; b < band.endBin; b++) {
        sum += this.freqData[b];
        count++;
      }

      const avg = count > 0 ? sum / count : 0;
      const normalized = Math.min(1.0, avg / 255.0);
      const barHeight = Math.max(1.0, normalized * height);

      // Peak Hold with Gravity Acceleration
      if (normalized >= this.peakHoldValues[k]) {
        this.peakHoldValues[k] = normalized;
        this.peakHoldVelocities[k] = 0.0;
      } else {
        this.peakHoldVelocities[k] += this.gravity;
        const decayed = this.peakHoldValues[k] - this.peakHoldVelocities[k];
        if (decayed <= normalized) {
          this.peakHoldValues[k] = normalized;
          this.peakHoldVelocities[k] = 0.0;
        } else {
          this.peakHoldValues[k] = decayed;
        }
      }

      const x = k * (barWidth + gap);
      const y = height - barHeight;

      // Visible logarithmic frequency bars colored across #E03C31 (low freqs) to #38BDF8 (high freqs)
      const t = this.numBands > 1 ? k / (this.numBands - 1) : 0;
      // Low: #E03C31 (224, 60, 49) -> High: #38BDF8 (56, 189, 248)
      const r = Math.round(224 * (1 - t) + 56 * t);
      const g = Math.round(60 * (1 - t) + 189 * t);
      const b = Math.round(49 * (1 - t) + 248 * t);
      const alpha = 0.75 + 0.25 * normalized;

      // Draw Main Spectrum Bar
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Draw Falling Gravity Peak-Hold Cap
      const peakY = height - (this.peakHoldValues[k] * height);
      if (peakY < height - 1.0) {
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.95)`;
        ctx.shadowBlur = 0;
        ctx.fillRect(x, Math.max(0, peakY - 2), barWidth, 2);
      }
    }
  }

  /**
   * Render Zero-Crossing Triggered Oscilloscope Waveform.
   */
  renderWaveform() {
    if (!this.waveformCanvas || !this.waveformCtx || !this.timeData) return;

    const ctx = this.waveformCtx;
    const rect = this.waveformCanvas.getBoundingClientRect();
    const width = rect.width || this.waveformCanvas.width;
    const height = rect.height || this.waveformCanvas.height;

    ctx.clearRect(0, 0, width, height);

    // Center Reference Line (Subtle neutral gray)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Detect first positive-slope zero crossing for jitter-free trace
    const triggerIdx = findZeroCrossingTrigger(this.timeData, 512);
    const traceLength = Math.min(1024, this.timeData.length - triggerIdx);

    if (traceLength <= 0) return;

    // Clean Minimalist Monochrome Oscilloscope Trace (Zero neon, zero blue)
    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 0;

    ctx.beginPath();
    for (let j = 0; j < traceLength; j++) {
      const sample = this.timeData[triggerIdx + j];
      const x = (j / (traceLength - 1)) * width;
      // Invert Y and scale: -1.0 maps to bottom, +1.0 maps to top
      const y = (0.5 - 0.45 * sample) * height;

      if (j === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /**
   * Compute and display RMS and Peak dB meters.
   */
  renderMeters() {
    if (!this.timeData) return;

    const rms = calculateRMS(this.timeData);
    const peak = calculatePeak(this.timeData);
    const rmsDb = calculateDbFS(rms);
    const peakDb = calculateDbFS(peak);

    // Clean threshold logic: neutral silver, amber warning, red peak
    let meterColor = '#e4e4e7';
    if (rmsDb > -3.0 || peakDb > -1.0) {
      meterColor = '#ef4444';
    } else if (rmsDb > -18.0) {
      meterColor = '#f59e0b';
    }

    // Update DOM Meter Bar
    if (this.rmsMeterElement) {
      // Map [-60 dB, 0 dB] -> [0%, 100%]
      const pct = Math.max(0, Math.min(100, ((rmsDb + 60.0) / 60.0) * 100));
      // The bar is scaled, not widened, so a 60 fps meter costs no layout.
      this.rmsMeterElement.style.setProperty('--meter-fill', String(pct / 100));
      this.rmsMeterElement.style.backgroundColor = meterColor;
    }

    // Update DOM Telemetry Texts
    if (this.rmsTextElement) {
      this.rmsTextElement.textContent = `${rmsDb.toFixed(1)} dB`;
      this.rmsTextElement.style.color = meterColor;
    }

    if (this.peakTextElement) {
      this.peakTextElement.textContent = `${peakDb.toFixed(1)} dB`;
    }
  }

  /**
   * Draw baseline idle state when audio is stopped or not connected.
   */
  _renderIdleState() {
    if (this.spectrumCtx && this.spectrumCanvas) {
      const rect = this.spectrumCanvas.getBoundingClientRect ? this.spectrumCanvas.getBoundingClientRect() : null;
      const w = (rect && rect.width) || this.spectrumCanvas.width || 220;
      const h = (rect && rect.height) || this.spectrumCanvas.height || 36;
      this.spectrumCtx.clearRect(0, 0, w, h);
    }

    if (this.waveformCtx && this.waveformCanvas) {
      const rect = this.waveformCanvas.getBoundingClientRect();
      const w = rect.width || this.waveformCanvas.width;
      const h = rect.height || this.waveformCanvas.height;
      this.waveformCtx.clearRect(0, 0, w, h);

      // Center flat line
      this.waveformCtx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      this.waveformCtx.lineWidth = 1;
      this.waveformCtx.beginPath();
      this.waveformCtx.moveTo(0, h / 2);
      this.waveformCtx.lineTo(w, h / 2);
      this.waveformCtx.stroke();
    }
  }
}
