/**
 * frontend/js/comparison/comparison.js
 * Historical Climate Comparison Tool & 3-Way Audio Auditioning Player.
 * NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
 *
 * Provides:
 *   - Dual-period comparison analytics (Period A vs Period B)
 *   - Mathematical delta computation: Delta(t) = B(t) - A(t)
 *   - High-precision Canvas 2D comparative chart rendering
 *   - 3-Way synchronized audio auditioning (Period A, Period B, Difference)
 */

import { getComparison, getTimeSeries } from '../api.js';

// ============================================================================
// 1. Preset Epochs & Canonical Definitions
// ============================================================================

export const PRESET_COMPARISONS = [
  {
    id: '2000_vs_2020',
    name: '2000 versus 2020 (calendar years)',
    a: '2000-01,2000-12',
    b: '2020-01,2020-12',
    desc: 'Two complete calendar years from the same observational series.'
  },
  {
    id: 'baseline_vs_modern',
    name: '1980–1990 versus 2010–2020',
    a: '1980-01,1990-12',
    b: '2010-01,2020-12',
    desc: 'Satellite-era decade versus a recent decade of the same record.'
  },
  {
    id: 'nineties_vs_tens',
    name: '1990–1995 versus 2015–2020',
    a: '1990-01,1995-12',
    b: '2015-01,2020-12',
    desc: 'Two five-year windows separated by twenty-five years.'
  },
  {
    id: 'early_vs_latest',
    name: '1979–1984 versus 2019–2024',
    a: '1979-01,1984-12',
    b: '2019-01,2024-12',
    desc: 'First and latest five-year windows in the harmonized 1979–2026 archive.'
  }
];

export const DATASET_OPTIONS = [
  { id: 'surface-temperature', label: 'Global Surface Temperature (GISTEMP v4)', units: '°C anomaly' },
  { id: 'atmospheric-co2', label: 'Atmospheric CO2 (Mauna Loa Keeling Curve)', units: 'ppm' },
  { id: 'ocean-temperature', label: 'Global Ocean Temperature Anomaly (NOAA)', units: '°C anomaly' },
  { id: 'sea-ice-extent', label: 'Arctic Sea Ice Minimum Extent (NSIDC)', units: 'M km²' }
];

// ============================================================================
// 2. Pure Mathematical Helper Functions
// ============================================================================

/**
 * Resample an array of numeric values to targetLength using linear interpolation.
 * @param {Array<number|Object>} values - Source array of numbers or objects with .value
 * @param {number} targetLength - Output array length
 * @returns {Array<number>} Resampled values
 */
export function resampleSeries(values, targetLength) {
  if (!values || values.length === 0) return [];
  if (targetLength <= 0) return [];

  const raw = values.map(v => (typeof v === 'number' ? v : (v && typeof v.value === 'number' ? v.value : 0)));
  if (raw.length === targetLength) return [...raw];
  if (raw.length === 1) return new Array(targetLength).fill(raw[0]);

  const result = [];
  const scale = (raw.length - 1) / (targetLength - 1);

  for (let i = 0; i < targetLength; i++) {
    const srcIndex = i * scale;
    const lower = Math.floor(srcIndex);
    const upper = Math.min(raw.length - 1, lower + 1);
    const frac = srcIndex - lower;
    const interpolated = raw[lower] * (1 - frac) + raw[upper] * frac;
    result.push(interpolated);
  }
  return result;
}

/**
 * Compute the differential series Delta(t) = B(t) - A(t) on a normalized time grid.
 * @param {Array<number|Object>} seriesA - Time series for Period A
 * @param {Array<number|Object>} seriesB - Time series for Period B
 * @param {number} [numPoints=100] - Uniform grid size
 * @returns {Array<{ index: number, t: number, valA: number, valB: number, delta: number }>}
 */
export function calculateDeltaSeries(seriesA, seriesB, numPoints = 100) {
  const normA = resampleSeries(seriesA, numPoints);
  const normB = resampleSeries(seriesB, numPoints);

  const deltaSeries = [];
  for (let i = 0; i < numPoints; i++) {
    const a = normA[i] !== undefined ? normA[i] : 0;
    const b = normB[i] !== undefined ? normB[i] : 0;
    const delta = b - a;
    deltaSeries.push({
      index: i,
      t: numPoints > 1 ? i / (numPoints - 1) : 0,
      valA: a,
      valB: b,
      delta: delta
    });
  }
  return deltaSeries;
}

/**
 * Compute descriptive statistics and relative difference between two series.
 * @param {Array<number>} valsA 
 * @param {Array<number>} valsB 
 * @returns {Object} { meanA, meanB, minA, maxA, minB, maxB, deltaMean, percentChange }
 */
export function calculateComparisonStats(valsA, valsB) {
  const cleanA = (valsA || []).map(v => (typeof v === 'number' ? v : (v && v.value) || 0));
  const cleanB = (valsB || []).map(v => (typeof v === 'number' ? v : (v && v.value) || 0));

  const meanA = cleanA.length ? cleanA.reduce((a, b) => a + b, 0) / cleanA.length : 0;
  const meanB = cleanB.length ? cleanB.reduce((a, b) => a + b, 0) / cleanB.length : 0;
  const deltaMean = meanB - meanA;

  let percentChange = 0;
  if (Math.abs(meanA) > 1e-6) {
    percentChange = (deltaMean / Math.abs(meanA)) * 100;
  }

  const minA = cleanA.length ? Math.min(...cleanA) : 0;
  const maxA = cleanA.length ? Math.max(...cleanA) : 0;
  const minB = cleanB.length ? Math.min(...cleanB) : 0;
  const maxB = cleanB.length ? Math.max(...cleanB) : 0;

  return {
    meanA: Number(meanA.toFixed(4)),
    meanB: Number(meanB.toFixed(4)),
    minA: Number(minA.toFixed(4)),
    maxA: Number(maxA.toFixed(4)),
    minB: Number(minB.toFixed(4)),
    maxB: Number(maxB.toFixed(4)),
    deltaMean: Number(deltaMean.toFixed(4)),
    percentChange: Number(percentChange.toFixed(2))
  };
}

// ============================================================================
// 3. Historical Comparison Class
// ============================================================================

export class HistoricalComparison {
  constructor(options = {}) {
    this.container = typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container || null;

    this.datasetId = options.dataset || 'surface-temperature';
    this.periodA = options.periodA || '2000-01,2000-12';
    this.periodB = options.periodB || '2020-01,2020-12';
    this.duration = options.duration || 15.0;

    // Callbacks
    this.onAudioPlay = options.onAudioPlay || null;
    this.onAudioStop = options.onAudioStop || null;
    this.onDataLoaded = options.onDataLoaded || null;

    // Internal State
    this.comparisonData = null;
    this.timeseriesA = [];
    this.timeseriesB = [];
    this.deltaSeries = [];
    this.stats = null;
    this.isOpen = false;
    this.isLoading = false;

    // 3-Way Auditioning State
    this.activeAudition = 'none'; // 'a' | 'b' | 'diff' | 'none'
    this.currentAudio = null;
    this.audioVolume = 0.85;
    this.audioUrls = { a: null, b: null, diff: null };

    // Hover tooltip state for canvas
    this.hoverPoint = null;

    if (this.container) {
      this.init();
    }
  }

  /**
   * Initialize DOM elements, canvas, and event listeners.
   */
  init() {
    if (!this.container) return;
    this.buildMarkup();
    this.bindEvents();
    // Load initial comparison data
    this.loadComparison();
  }

  /**
   * Build the UI structure inside the container.
   */
  buildMarkup() {
    this.container.innerHTML = `
      <div class="comparison-card">
        <!-- Header -->
        <div class="comparison-header">
          <div class="comparison-title-wrap">
            <span class="comparison-badge">Period comparison</span>
            <h2 class="comparison-title">Compare two intervals of the same record</h2>
            <div class="comparison-subtitle">
              Means, Δ(t) = B(t) − A(t), and optional A / B / difference audio from STRAUSS
            </div>
          </div>
          <button class="comparison-close-btn" id="comp-close-btn" title="Close Panel">&times;</button>
        </div>

        <!-- Controls Bar -->
        <div class="comparison-controls">
          <!-- Dataset Select -->
          <div class="control-group">
            <label for="comp-dataset-select">Variable</label>
            <select id="comp-dataset-select" class="comp-select">
              ${DATASET_OPTIONS.map(d => `<option value="${d.id}" ${d.id === this.datasetId ? 'selected' : ''}>${d.label}</option>`).join('')}
            </select>
          </div>

          <!-- Presets -->
          <div class="control-group">
            <label for="comp-preset-select">Interval pair</label>
            <select id="comp-preset-select" class="comp-select">
              <option value="custom">Custom dates</option>
              ${PRESET_COMPARISONS.map(p => `<option value="${p.id}" ${p.id === '2000_vs_2020' ? 'selected' : ''}>${p.name}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Period Selectors Row -->
        <div class="comparison-period-grid">
          <!-- Period A Box -->
          <div class="period-box period-box-a">
            <div class="period-header">
              <span class="period-dot dot-a"></span>
              <span class="period-label">Period A · baseline</span>
            </div>
            <div class="period-inputs">
              <input type="text" id="comp-a-start" class="comp-input" placeholder="YYYY-MM" value="2000-01">
              <span class="period-sep">to</span>
              <input type="text" id="comp-a-end" class="comp-input" placeholder="YYYY-MM" value="2000-12">
            </div>
          </div>

          <!-- VS Indicator -->
          <div class="period-vs-indicator">
            <span>VS</span>
            <button id="comp-run-btn" class="comp-run-btn">Compare</button>
          </div>

          <!-- Period B Box -->
          <div class="period-box period-box-b">
            <div class="period-header">
              <span class="period-dot dot-b"></span>
              <span class="period-label">Period B · comparison</span>
            </div>
            <div class="period-inputs">
              <input type="text" id="comp-b-start" class="comp-input" placeholder="YYYY-MM" value="2020-01">
              <span class="period-sep">to</span>
              <input type="text" id="comp-b-end" class="comp-input" placeholder="YYYY-MM" value="2020-12">
            </div>
          </div>
        </div>

        <!-- Telemetry Metrics Cards -->
        <div class="comparison-metrics-grid">
          <div class="metric-card card-a">
            <div class="metric-card-title">Period A mean</div>
            <div class="metric-card-val" id="metric-mean-a">--</div>
            <div class="metric-card-sub" id="metric-sub-a">Range: -- to --</div>
          </div>
          <div class="metric-card card-b">
            <div class="metric-card-title">Period B mean</div>
            <div class="metric-card-val" id="metric-mean-b">--</div>
            <div class="metric-card-sub" id="metric-sub-b">Range: -- to --</div>
          </div>
          <div class="metric-card card-delta">
            <div class="metric-card-title">Difference (Δ = B − A)</div>
            <div class="metric-card-val" id="metric-delta">--</div>
            <div class="metric-card-sub" id="metric-pct">Relative Shift: --%</div>
          </div>
        </div>

        <!-- Comparative Chart Canvas -->
        <div class="comparison-chart-container">
          <div class="chart-legend-bar">
            <div class="legend-item"><span class="legend-swatch swatch-a"></span> Period A</div>
            <div class="legend-item"><span class="legend-swatch swatch-b"></span> Period B</div>
            <div class="legend-item"><span class="legend-swatch swatch-diff"></span> Difference &Delta;(t)</div>
            <div class="chart-status" id="comp-chart-status">Ready</div>
          </div>
          <div class="canvas-wrapper">
            <canvas id="comp-canvas" class="comp-canvas"></canvas>
            <div id="comp-tooltip" class="comp-tooltip hidden"></div>
          </div>
        </div>

        <!-- 3-Way Audio Auditioning Player -->
        <div class="comparison-audio-dock">
          <div class="audio-dock-header">
            <span class="audio-dock-title">Listen to A, B, or Δ</span>
            <span class="audio-dock-meta">STRAUSS · 44.1 kHz PCM</span>
          </div>
          <div class="audio-buttons-row">
            <button id="btn-audition-a" class="audition-btn btn-a" title="Play period A sonification">
              Period A
            </button>
            <button id="btn-audition-b" class="audition-btn btn-b" title="Play period B sonification">
              Period B
            </button>
            <button id="btn-audition-diff" class="audition-btn btn-diff" title="Play differential sonification">
              Difference Δ(t)
            </button>
            <button id="btn-audition-stop" class="audition-btn btn-stop" title="Stop playback">
              Stop
            </button>
          </div>
          <div class="audio-status-row">
            <div class="audio-status-badge" id="audition-status-badge">STANDBY</div>
            <div class="audio-vol-control">
              <span>VOL</span>
              <input type="range" id="comp-vol-slider" min="0" max="1" step="0.01" value="0.85">
              <span id="comp-vol-label">85%</span>
            </div>
          </div>
        </div>
      </div>
    `;

    this.canvas = this.container.querySelector('#comp-canvas');
    this.tooltip = this.container.querySelector('#comp-tooltip');
  }

  /**
   * Bind DOM event listeners.
   */
  bindEvents() {
    if (!this.container) return;

    // Close button
    const closeBtn = this.container.querySelector('#comp-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Dataset select
    const dsSelect = this.container.querySelector('#comp-dataset-select');
    if (dsSelect) {
      dsSelect.addEventListener('change', (e) => {
        this.datasetId = e.target.value;
        this.loadComparison();
      });
    }

    // Preset select
    const presetSelect = this.container.querySelector('#comp-preset-select');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val !== 'custom') {
          this.applyPreset(val);
        }
      });
    }

    // Run Comparison button
    const runBtn = this.container.querySelector('#comp-run-btn');
    if (runBtn) {
      runBtn.addEventListener('click', () => {
        const aStart = this.container.querySelector('#comp-a-start').value.trim();
        const aEnd = this.container.querySelector('#comp-a-end').value.trim();
        const bStart = this.container.querySelector('#comp-b-start').value.trim();
        const bEnd = this.container.querySelector('#comp-b-end').value.trim();

        if (aStart && aEnd && bStart && bEnd) {
          this.periodA = `${aStart},${aEnd}`;
          this.periodB = `${bStart},${bEnd}`;
          this.loadComparison();
        }
      });
    }

    // 3-Way Audition buttons
    const btnA = this.container.querySelector('#btn-audition-a');
    const btnB = this.container.querySelector('#btn-audition-b');
    const btnDiff = this.container.querySelector('#btn-audition-diff');
    const btnStop = this.container.querySelector('#btn-audition-stop');

    if (btnA) btnA.addEventListener('click', () => this.audition('a'));
    if (btnB) btnB.addEventListener('click', () => this.audition('b'));
    if (btnDiff) btnDiff.addEventListener('click', () => this.audition('diff'));
    if (btnStop) btnStop.addEventListener('click', () => this.stopAudio());

    // Volume slider
    const volSlider = this.container.querySelector('#comp-vol-slider');
    const volLabel = this.container.querySelector('#comp-vol-label');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.setVolume(val);
        if (volLabel) volLabel.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // Canvas resize and hover
    if (this.canvas) {
      window.addEventListener('resize', () => this.resizeAndRenderCanvas());
      this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));
      this.canvas.addEventListener('mouseleave', () => this.hideTooltip());
    }
  }

  /**
   * Apply a preset historical comparison.
   * @param {string} presetId 
   */
  applyPreset(presetId) {
    const preset = PRESET_COMPARISONS.find(p => p.id === presetId);
    if (!preset) return;

    this.periodA = preset.a;
    this.periodB = preset.b;

    const [aStart, aEnd] = preset.a.split(',');
    const [bStart, bEnd] = preset.b.split(',');

    const aStartInput = this.container.querySelector('#comp-a-start');
    const aEndInput = this.container.querySelector('#comp-a-end');
    const bStartInput = this.container.querySelector('#comp-b-start');
    const bEndInput = this.container.querySelector('#comp-b-end');

    if (aStartInput) aStartInput.value = aStart;
    if (aEndInput) aEndInput.value = aEnd;
    if (bStartInput) bStartInput.value = bStart;
    if (bEndInput) bEndInput.value = bEnd;

    this.loadComparison();
  }

  /**
   * Fetch comparison data from backend REST API and compute delta series.
   */
  async loadComparison() {
    this.isLoading = true;
    const statusEl = this.container ? this.container.querySelector('#comp-chart-status') : null;
    if (statusEl) statusEl.textContent = 'Fetching comparative observations...';

    const [aStart, aEnd] = this.periodA.split(',');
    const [bStart, bEnd] = this.periodB.split(',');

    try {
      const [compRes, tsA, tsB] = await Promise.all([
        getComparison(this.datasetId, this.periodA, this.periodB, this.duration),
        getTimeSeries(this.datasetId, { start: aStart, end: aEnd }).catch(() => null),
        getTimeSeries(this.datasetId, { start: bStart, end: bEnd }).catch(() => null)
      ]);

      this.comparisonData = compRes;
      this.audioUrls = {
        a: compRes.periodA ? compRes.periodA.audio_url : null,
        b: compRes.periodB ? compRes.periodB.audio_url : null,
        diff: compRes.difference ? compRes.difference.differential_audio_url : null
      };

      // Extract time series points
      this.timeseriesA = (tsA && (tsA.records || tsA.data)) || [];
      this.timeseriesB = (tsB && (tsB.records || tsB.data)) || [];

      // Compute Delta Series on a 100-point normalized grid
      this.deltaSeries = calculateDeltaSeries(this.timeseriesA, this.timeseriesB, 100);

      // Compute or update stats
      const valsA = this.timeseriesA.map(r => r.value !== undefined ? r.value : 0);
      const valsB = this.timeseriesB.map(r => r.value !== undefined ? r.value : 0);
      this.stats = calculateComparisonStats(valsA, valsB);

      // Update UI elements
      this.updateTelemetryCards();
      this.resizeAndRenderCanvas();

      if (statusEl) statusEl.textContent = 'Records aligned';
      if (this.onDataLoaded) this.onDataLoaded(this.comparisonData);
    } catch (err) {
      console.warn('[HistoricalComparison] Fetch failed:', err);
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Update the telemetry cards showing Period A, Period B, and Delta metrics.
   */
  updateTelemetryCards() {
    if (!this.container || !this.stats) return;

    const meanAEl = this.container.querySelector('#metric-mean-a');
    const subAEl = this.container.querySelector('#metric-sub-a');
    const meanBEl = this.container.querySelector('#metric-mean-b');
    const subBEl = this.container.querySelector('#metric-sub-b');
    const deltaEl = this.container.querySelector('#metric-delta');
    const pctEl = this.container.querySelector('#metric-pct');

    const dsMeta = DATASET_OPTIONS.find(d => d.id === this.datasetId);
    const units = dsMeta ? dsMeta.units : '';

    if (meanAEl) meanAEl.textContent = `${this.stats.meanA >= 0 ? '+' : ''}${this.stats.meanA} ${units}`;
    if (subAEl) subAEl.textContent = `Min: ${this.stats.minA} / Max: ${this.stats.maxA}`;

    if (meanBEl) meanBEl.textContent = `${this.stats.meanB >= 0 ? '+' : ''}${this.stats.meanB} ${units}`;
    if (subBEl) subBEl.textContent = `Min: ${this.stats.minB} / Max: ${this.stats.maxB}`;

    if (deltaEl) {
      const sign = this.stats.deltaMean >= 0 ? '+' : '';
      deltaEl.textContent = `${sign}${this.stats.deltaMean} ${units}`;
      deltaEl.style.color = this.stats.deltaMean >= 0 ? '#ef4444' : '#10b981';
    }

    if (pctEl) {
      const sign = this.stats.percentChange >= 0 ? '+' : '';
      pctEl.textContent = `Relative Shift: ${sign}${this.stats.percentChange}%`;
    }
  }

  /**
   * Handle canvas sizing and draw comparative curves.
   */
  resizeAndRenderCanvas() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);

    const ctx = this.canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    this.drawChart(ctx, rect.width, rect.height);
  }

  /**
   * Render the comparative graph: Period A curve, Period B curve, and Difference curve.
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} width 
   * @param {number} height 
   */
  drawChart(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, width, height);

    const padding = { top: 25, right: 30, bottom: 35, left: 55 };
    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    if (!this.deltaSeries || this.deltaSeries.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No comparative data available', width / 2, height / 2);
      return;
    }

    // Determine value bounds across Series A, Series B, and Delta
    const allVals = [];
    for (const pt of this.deltaSeries) {
      allVals.push(pt.valA, pt.valB, pt.delta);
    }
    let minVal = Math.min(...allVals);
    let maxVal = Math.max(...allVals);

    // Ensure zero is visible in range
    minVal = Math.min(minVal, 0.0);
    maxVal = Math.max(maxVal, 0.0);

    const span = (maxVal - minVal) || 1.0;
    const yPad = span * 0.15;
    const yMin = minVal - yPad;
    const yMax = maxVal + yPad;

    const mapX = (t) => padding.left + t * plotW;
    const mapY = (val) => padding.top + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

    // Draw grid lines
    const gridTicks = 5;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';

    for (let i = 0; i <= gridTicks; i++) {
      const frac = i / gridTicks;
      const v = yMin + frac * (yMax - yMin);
      const y = mapY(v);

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      ctx.fillText(v.toFixed(2), padding.left - 8, y + 3);
    }

    // Zero reference line
    const zeroY = mapY(0.0);
    if (zeroY >= padding.top && zeroY <= padding.top + plotH) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // X-Axis Ticks (Normalized Time: 0% to 100%)
    ctx.textAlign = 'center';
    const xTicks = [0, 0.25, 0.5, 0.75, 1.0];
    for (const t of xTicks) {
      const x = mapX(t);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, padding.top + plotH);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.fillText(`${Math.round(t * 100)}%`, x, height - padding.bottom + 18);
    }

    // 1. Draw Period A Curve (Crisp Off-White #F4F4F5)
    this.drawCurve(ctx, this.deltaSeries, pt => pt.valA, mapX, mapY, '#f4f4f5', 'rgba(255, 255, 255, 0.08)', false);

    // 2. Draw Period B Curve (Solar Amber #F59E0B)
    this.drawCurve(ctx, this.deltaSeries, pt => pt.valB, mapX, mapY, '#f59e0b', 'rgba(245, 158, 11, 0.08)', false);

    // 3. Draw Difference Curve Delta(t) (Dashed NASA Red #FC3D21)
    this.drawCurve(ctx, this.deltaSeries, pt => pt.delta, mapX, mapY, '#fc3d21', null, true);

    // If hover point active, draw indicator dot & vertical crosshair
    if (this.hoverPoint) {
      const hx = mapX(this.hoverPoint.t);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(hx, padding.top);
      ctx.lineTo(hx, padding.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw dots on curves
      const dots = [
        { y: mapY(this.hoverPoint.valA), color: '#f4f4f5' },
        { y: mapY(this.hoverPoint.valB), color: '#f59e0b' },
        { y: mapY(this.hoverPoint.delta), color: '#fc3d21' }
      ];

      for (const d of dots) {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.arc(hx, d.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  /**
   * Helper to draw a single smooth line/area on canvas.
   */
  drawCurve(ctx, data, valAccessor, mapX, mapY, strokeColor, fillColor, isDashed) {
    if (!data.length) return;

    ctx.save();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.2;
    if (isDashed) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.moveTo(mapX(data[0].t), mapY(valAccessor(data[0])));

    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(mapX(data[i].t), mapY(valAccessor(data[i])));
    }
    ctx.stroke();

    // Fill underneath if requested
    if (fillColor) {
      const lastX = mapX(data[data.length - 1].t);
      const firstX = mapX(data[0].t);
      const bottomY = mapY(0.0);

      ctx.lineTo(lastX, bottomY);
      ctx.lineTo(firstX, bottomY);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Handle hover interaction over canvas.
   */
  handleCanvasHover(e) {
    if (!this.canvas || !this.deltaSeries.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const paddingLeft = 55;
    const paddingRight = 30;
    const plotW = rect.width - paddingLeft - paddingRight;

    if (x < paddingLeft || x > rect.width - paddingRight) {
      this.hideTooltip();
      return;
    }

    const t = Math.max(0, Math.min(1, (x - paddingLeft) / plotW));
    const idx = Math.min(this.deltaSeries.length - 1, Math.floor(t * this.deltaSeries.length));
    this.hoverPoint = this.deltaSeries[idx];

    // Redraw canvas with cursor
    this.resizeAndRenderCanvas();

    // Show tooltip
    if (this.tooltip && this.hoverPoint) {
      const dsMeta = DATASET_OPTIONS.find(d => d.id === this.datasetId);
      const units = dsMeta ? dsMeta.units : '';

      this.tooltip.innerHTML = `
        <div style="font-weight:700;margin-bottom:4px;color:#f4f4f5;">Normalized Epoch: ${(this.hoverPoint.t * 100).toFixed(1)}%</div>
        <div style="color:#e4e4e7;">&bull; Period A: ${this.hoverPoint.valA.toFixed(3)} ${units}</div>
        <div style="color:#f59e0b;">&bull; Period B: ${this.hoverPoint.valB.toFixed(3)} ${units}</div>
        <div style="color:#fc3d21;font-weight:700;">&bull; Difference &Delta;: ${(this.hoverPoint.delta >= 0 ? '+' : '')}${this.hoverPoint.delta.toFixed(3)} ${units}</div>
      `;

      this.tooltip.classList.remove('hidden');
      this.tooltip.style.left = `${Math.min(rect.width - 180, Math.max(10, x + 15))}px`;
      this.tooltip.style.top = `20px`;
    }
  }

  hideTooltip() {
    this.hoverPoint = null;
    if (this.tooltip) this.tooltip.classList.add('hidden');
    this.resizeAndRenderCanvas();
  }

  // ==========================================================================
  // 4. 3-Way Audio Auditioning Methods
  // ==========================================================================

  /**
   * Audition selected mode: 'a', 'b', or 'diff'.
   * @param {'a'|'b'|'diff'} mode 
   */
  async audition(mode) {
    if (this.activeAudition === mode && this.currentAudio && !this.currentAudio.paused) {
      // Toggle pause
      this.stopAudio();
      return;
    }

    this.stopAudio();

    const url = this.audioUrls[mode];
    if (!url) {
      this.updateAudioBadge('NO AUDIO URL', 'error');
      return;
    }

    this.activeAudition = mode;
    this.updateActiveAuditionButton(mode);
    this.updateAudioBadge(`LOADING ${mode.toUpperCase()}...`, 'loading');

    try {
      this.currentAudio = new Audio(url);
      this.currentAudio.volume = this.audioVolume;

      this.currentAudio.addEventListener('playing', () => {
        const labels = { a: 'PLAYING PERIOD A', b: 'PLAYING PERIOD B', diff: 'PLAYING DIFFERENCE Δ(t)' };
        this.updateAudioBadge(labels[mode] || 'PLAYING', 'active');
        if (this.onAudioPlay) this.onAudioPlay(mode);
      });

      this.currentAudio.addEventListener('ended', () => {
        this.stopAudio();
      });

      this.currentAudio.addEventListener('error', (e) => {
        console.warn('[HistoricalComparison] Audio playback error:', e);
        this.updateAudioBadge('AUDIO PLAYBACK ERROR', 'error');
        this.stopAudio();
      });

      await this.currentAudio.play();
    } catch (err) {
      console.warn('[HistoricalComparison] play() rejected:', err);
      this.updateAudioBadge('CLICK TO PLAY', 'warning');
      this.stopAudio();
    }
  }

  /**
   * Stop active audition playback.
   */
  stopAudio() {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {
        // Ignore audio stop race
      }
      this.currentAudio = null;
    }

    this.activeAudition = 'none';
    this.updateActiveAuditionButton(null);
    this.updateAudioBadge('STANDBY', 'nominal');
    if (this.onAudioStop) this.onAudioStop();
  }

  /**
   * Crossfade / seamless transition to new audition mode.
   * @param {'a'|'b'|'diff'} targetMode 
   */
  crossfade(targetMode) {
    this.audition(targetMode);
  }

  /**
   * Set audition playback volume [0.0, 1.0].
   * @param {number} vol 
   */
  setVolume(vol) {
    this.audioVolume = Math.max(0, Math.min(1, vol));
    if (this.currentAudio) {
      this.currentAudio.volume = this.audioVolume;
    }
  }

  /**
   * Update active button styling.
   */
  updateActiveAuditionButton(activeMode) {
    if (!this.container) return;
    const btnA = this.container.querySelector('#btn-audition-a');
    const btnB = this.container.querySelector('#btn-audition-b');
    const btnDiff = this.container.querySelector('#btn-audition-diff');

    if (btnA) btnA.classList.toggle('active', activeMode === 'a');
    if (btnB) btnB.classList.toggle('active', activeMode === 'b');
    if (btnDiff) btnDiff.classList.toggle('active', activeMode === 'diff');
  }

  /**
   * Update status badge text and visual class.
   */
  updateAudioBadge(text, stateClass = 'nominal') {
    if (!this.container) return;
    const badge = this.container.querySelector('#audition-status-badge');
    if (badge) {
      badge.textContent = text;
      badge.className = `audio-status-badge badge-${stateClass}`;
    }
  }

  // ==========================================================================
  // 5. Visibility Controls
  // ==========================================================================

  open() {
    this.isOpen = true;
    if (this.container) {
      this.container.classList.remove('hidden');
      this.container.style.display = 'flex';
      setTimeout(() => this.resizeAndRenderCanvas(), 50);
    }
  }

  close() {
    this.isOpen = false;
    this.stopAudio();
    if (this.container) {
      this.container.classList.add('hidden');
      this.container.style.display = 'none';
    }
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
}
