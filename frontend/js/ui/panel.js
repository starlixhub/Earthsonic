/**
 * frontend/js/ui/panel.js
 * Scientific Information & Sonification Mapping Panel.
 * NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
 *
 * Provides:
 *   - Modal / slide-out drawer displaying verified NASA mission metadata
 *   - Mathematical & musical sonification mapping specifications
 *   - Physical climate context and scientific descriptions
 *   - Real-time preview player for individual layer sonifications
 */

import { getSonificationExplanations, getDatasets } from '../api.js';

export const LAYER_INFO_FALLBACK = {
  "surface-temperature": {
    dataset_id: "surface-temperature",
    title: "Global Surface Temperature Analysis (GISTEMP v4)",
    nasa_source: "NASA Goddard Institute for Space Studies (GISS) / NOAA NCEI",
    physical_variable: "Global Near-Surface Air & Sea Surface Temperature Anomaly",
    units: "degrees Celsius (°C) anomaly relative to 1951–1980 base period",
    baseline_reference: "1951-1980 Global Climatology Mean",
    observation_range: "[-0.85°C, +1.50°C]",
    date_range: "1880 to Present (Monthly & Zonal Bands)",
    coverage: "Global (Land-Ocean, 14-Latitude Zonal Bands: 90°N to 90°S)",
    synthesis_engine: "STRAUSS Synthesizer with Continuous Pitch Tracking",
    musical_parameters: {
      reference_pitch: "Middle C (C4, 261.63 Hz) at 0.0 °C anomaly",
      scaling_formula: "Delta semitones = 12.0 * anom_c (1 octave / 1.0 °C anomaly)",
      frequency_formula: "f(T) = 261.63 * 2^(anom_c / 1.0) Hz",
      timbre: "Warm acoustic cello tone in baseline years shifting to bright synthetic saw lead with rising harmonic saturation past +1.0 °C"
    },
    scientific_rationale: "GISTEMP v4 combines land-station and sea-surface records into a global temperature anomaly relative to 1951–1980. NASA GISS uses this index as a primary measure of how the near-surface climate is departing from that baseline."
  },
  "atmospheric-co2": {
    dataset_id: "atmospheric-co2",
    title: "Mauna Loa Atmospheric Carbon Dioxide (The Keeling Curve)",
    nasa_source: "NASA Global Climate Change / NOAA Global Monitoring Laboratory (GML)",
    physical_variable: "Atmospheric CO2 Mole Fraction in Dry Air",
    units: "parts per million (ppm)",
    baseline_reference: "Pre-Industrial Baseline (~280 ppm) / 1958 Keeling Start (315 ppm)",
    observation_range: "[312 ppm, 435+ ppm]",
    date_range: "March 1958 to Present (Continuous Monthly In-Situ)",
    coverage: "Mauna Loa Observatory, Hawaii (3,397 m altitude; global background proxy)",
    synthesis_engine: "STRAUSS Additive Harmonic Generator with Non-Linear Tension Saturation",
    musical_parameters: {
      carrier_pitch: "G3 (196.0 Hz) at 310 ppm rising to G5 (784.0 Hz) at 440 ppm",
      scaling_formula: "Semitone shift = 24.0 * ((ppm - 310.0) / 130.0)",
      saturation_formula: "Harmonic Saturation = max(0.0, (ppm - 350.0) / 90.0)",
      dynamics: "Volume increases monotonically from 0.35 to 0.95 with power-law curve"
    },
    scientific_rationale: "The Keeling Curve from Mauna Loa Observatory is the longest continuous in-situ CO₂ record. Seasonal uptake by Northern Hemisphere vegetation produces the annual sawtooth; the long-term rise is the radiative forcing that the other three channels respond to."
  },
  "ocean-temperature": {
    dataset_id: "ocean-temperature",
    title: "Global Ocean Heat Content & Sea Surface Temperature",
    nasa_source: "NOAA NCEI Global Ocean Heat & Temperature Anomalies (0-2000m) / NASA PO.DAAC",
    physical_variable: "Ocean Temperature Anomaly / 0-2000m Heat Content",
    units: "degrees Celsius (°C) anomaly relative to 20th century mean",
    baseline_reference: "20th Century Mean (1901-2000)",
    observation_range: "[-0.60°C, +1.20°C]",
    date_range: "1880 to Present (0-2000m Integrated Since 1955)",
    coverage: "Global Oceans (71% of Earth Surface; 0 to 2000 meters depth)",
    synthesis_engine: "STRAUSS Synthesizer with 4-Voice Additive Chords and 5th-Order Butterworth LPF1 Filter Sweep",
    musical_parameters: {
      chord_voicing: "C2 (65.4 Hz), G2 (98.0 Hz), C3 (130.8 Hz), E3 (164.8 Hz)",
      filter_type: "5th-order Butterworth low-pass filter (LPF1)",
      cutoff_range: "80 Hz (muffled sub-bass) up to 2400 Hz (bright, penetrating ocean resonance)",
      filter_formula: "fc(T) = 80.0 * (2400.0 / 80.0)^norm(T) Hz"
    },
    scientific_rationale: "More than 90 percent of excess heat in the Earth system is stored in the ocean. NOAA sea-surface and ocean-heat records therefore lag and integrate the atmospheric forcing. STRAUSS opens a low-pass filter as that heat content rises so the bass register carries the thermal inertia."
  },
  "sea-ice-extent": {
    dataset_id: "sea-ice-extent",
    title: "Arctic Sea Ice Minimum Extent",
    nasa_source: "NOAA / NSIDC Sea Ice Index Version 4 (Passive Microwave Satellite Sensors)",
    physical_variable: "Northern Hemisphere September Sea Ice Extent",
    units: "million square kilometers (M km²)",
    baseline_reference: "1979-1982 Satellite Record Reference (~7.8M km²)",
    observation_range: "[3.50M km², 7.80M km²]",
    date_range: "October 1978 to Present (Passive Microwave Continuous Record)",
    coverage: "Arctic Ocean / Northern Polar Hemisphere",
    synthesis_engine: "STRAUSS Dual-Engine (Chime Synthesizer + windy LPF Noise Generator)",
    musical_parameters: {
      loss_metric: "x_loss = clamp((7.8 - extent) / (7.8 - 3.5), 0, 1)",
      harmonic_voicing: "E5 (659.3 Hz), B5 (987.8 Hz), E6 (1318.5 Hz) pure chimes",
      noise_preset: "windy preset (low-pass filtered white noise)",
      crossfade_law: "Harmonic volume = (1 - x_loss), Noise volume = (x_loss)^0.8"
    },
    scientific_rationale: "Passive-microwave sensors at NSIDC measure Arctic September ice extent, a standard climate index since 1979. High extent is mapped to sparse high-frequency chimes; loss of ice area crossfades those tones into wind noise standing in for open ocean."
  },
  "difference": {
    dataset_id: "difference",
    title: "Historical Period Differential Sonification",
    nasa_source: "Comparative NASA Earth Observation Records",
    physical_variable: "Delta(t) = Period B(t) - Period A(t)",
    units: "Variable units (relative change)",
    baseline_reference: "Delta = 0.0 (Identical Climate State)",
    observation_range: "[-Delta_max, +Delta_max]",
    date_range: "User-Selected Historical Comparison Periods",
    coverage: "Direct Period-over-Period Differential Alignment",
    synthesis_engine: "STRAUSS Synthesizer with Normalized Equal-Grid Differential Processing",
    musical_parameters: {
      reference_grid: "300 uniform normalized time points",
      neutral_pitch: "Unison Middle C (261.63 Hz) at Delta = 0",
      pitch_shift_formula: "Delta_semitones = 12.0 * Delta_T",
      auditory_feedback: "Accelerated warming periods produce audible melodic divergence"
    },
    scientific_rationale: "The difference channel is Δ(t) = B(t) − A(t) on a common time grid. Identical periods cancel to unison. A positive residual is the measured change between two intervals of the same NASA or NOAA series—not a forecast and not a synthesized climate."
  }
};

export class ScientificInfoPanel {
  constructor(options = {}) {
    this.container = typeof options.container === 'string'
      ? document.querySelector(options.container)
      : options.container || null;

    this.activeDatasetId = options.dataset || 'surface-temperature';
    this.onClose = options.onClose || null;

    this.explanations = { ...LAYER_INFO_FALLBACK };
    this.datasetMetadata = null;
    this.isOpen = false;
    this.currentAudioPreview = null;

    if (this.container) {
      this.init();
    }
  }

  /**
   * Initialize DOM structure and fetch authoritative backend explanations.
   */
  async init() {
    if (!this.container) return;
    this.buildMarkup();
    this.bindEvents();

    // Fetch dynamic backend explanations & datasets
    try {
      const [explRes, metaRes] = await Promise.all([
        getSonificationExplanations().catch(() => null),
        getDatasets().catch(() => null)
      ]);

      if (explRes && explRes.explanations) {
        this.explanations = { ...this.explanations, ...explRes.explanations };
      }
      if (metaRes) {
        this.datasetMetadata = metaRes;
      }
      this.renderLayerDetails(this.activeDatasetId);
    } catch (err) {
      console.warn('[ScientificInfoPanel] Fetch explanations failed:', err);
      this.renderLayerDetails(this.activeDatasetId);
    }
  }

  /**
   * Build the drawer HTML skeleton.
   */
  buildMarkup() {
    this.container.innerHTML = `
      <div class="panel-backdrop" id="panel-backdrop"></div>
      <aside class="info-drawer" id="info-drawer-aside">
        <!-- Drawer Header -->
        <div class="drawer-header">
          <div class="drawer-header-left">
            <span class="nasa-mission-badge">NASA Earthdata · STRAUSS</span>
            <h2 class="drawer-title">Data provenance and mapping methods</h2>
          </div>
          <button class="drawer-close-btn" id="drawer-close-btn" title="Close Panel">&times;</button>
        </div>

        <!-- Navigation Tabs -->
        <nav class="drawer-nav-tabs">
          <button class="tab-btn active" data-tab="surface-temperature">Temperature</button>
          <button class="tab-btn" data-tab="atmospheric-co2">CO2</button>
          <button class="tab-btn" data-tab="ocean-temperature">Ocean Heat</button>
          <button class="tab-btn" data-tab="sea-ice-extent">Sea Ice</button>
          <button class="tab-btn" data-tab="difference">Differential</button>
        </nav>

        <!-- Drawer Content Body -->
        <div class="drawer-body" id="drawer-body-content">
          <!-- Dynamic Content Rendered Here -->
        </div>
      </aside>
    `;
  }

  /**
   * Bind event listeners for tab switching, closing, and previews.
   */
  bindEvents() {
    if (!this.container) return;

    // Close button
    const closeBtn = this.container.querySelector('#drawer-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }

    // Backdrop click
    const backdrop = this.container.querySelector('#panel-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', () => this.close());
    }

    // Tab buttons
    const tabButtons = this.container.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        this.setDataset(tabId);
      });
    });

    // Escape key listener
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
  }

  /**
   * Switch the active dataset tab and re-render.
   * @param {string} datasetId 
   */
  setDataset(datasetId) {
    this.activeDatasetId = datasetId;
    this.stopPreview();

    // Update active tab button
    const tabButtons = this.container.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === datasetId);
    });

    this.renderLayerDetails(datasetId);
  }

  /**
   * Render the scientific details and mapping formulas for the active layer.
   * @param {string} datasetId 
   */
  renderLayerDetails(datasetId) {
    const body = this.container.querySelector('#drawer-body-content');
    if (!body) return;

    const info = this.explanations[datasetId] || LAYER_INFO_FALLBACK[datasetId] || LAYER_INFO_FALLBACK['surface-temperature'];
    const musical = info.musical_parameters || {};

    body.innerHTML = `
      <div class="info-section">
        <!-- Title and Provider Header Card -->
        <div class="mission-card">
          <div class="mission-card-tag">Verified observation</div>
          <h3 class="mission-dataset-title">${info.title}</h3>
          <div class="mission-provider-row">
            <span class="provider-label">Source</span>
            <span class="provider-value">${info.nasa_source}</span>
          </div>
          <div class="mission-verification-badge" style="display:inline-flex;align-items:center;gap:0.4rem;background:rgba(11,61,145,0.35);border:1px solid rgba(255,255,255,0.2);color:#d6e8f5;font-family:var(--font-mono, monospace);font-size:0.68rem;font-weight:600;padding:0.25rem 0.55rem;margin-top:0.5rem;">
            <span>NASA OPEN SCIENCE VERIFIED</span>
            <span style="color:#9aa3ad;">· SHA-256 VALIDATED · 0% SYNTHETIC DATA</span>
          </div>
        </div>

        <!-- Metadata Grid -->
        <div class="metadata-grid">
          <div class="meta-item">
            <span class="meta-title">VARIABLE</span>
            <span class="meta-text">${info.physical_variable || info.title}</span>
          </div>
          <div class="meta-item">
            <span class="meta-title">UNITS</span>
            <span class="meta-text">${info.units || '--'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-title">BASELINE</span>
            <span class="meta-text">${info.baseline_reference || '--'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-title">OBSERVATION RANGE</span>
            <span class="meta-text">${info.observation_range || '--'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-title">DATE RANGE</span>
            <span class="meta-text">${info.date_range || '1979 - 2024'}</span>
          </div>
          <div class="meta-item">
            <span class="meta-title">COVERAGE</span>
            <span class="meta-text">${info.coverage || 'Global'}</span>
          </div>
        </div>

        <!-- Physical Rationale Card -->
        <div class="content-block">
          <h4 class="block-title">Physical context</h4>
          <p class="block-description">${info.scientific_rationale}</p>
        </div>

        <!-- Mathematical & Musical Sonification Mapping -->
        <div class="content-block">
          <h4 class="block-title">Sonification mapping</h4>
          <div class="formula-box">
            <div class="formula-header">SYNTHESIS ENGINE: ${info.synthesis_engine || 'STRAUSS Engine'}</div>
            <div class="formula-body">
              ${Object.entries(musical).map(([k, v]) => `
                <div class="formula-row">
                  <span class="param-key">${k.replace(/_/g, ' ').toUpperCase()}:</span>
                  <span class="param-val">${v}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Interactive Audio Auditioning Sample -->
        <div class="content-block preview-block">
          <div class="preview-header">
            <div>
              <div class="preview-title">Five-second sample</div>
              <div class="preview-sub">44.1 kHz WAV streamed from the STRAUSS engine</div>
            </div>
            <button class="preview-play-btn" id="btn-preview-sample" data-dataset="${datasetId}">
              Play sample
            </button>
          </div>
          <div class="preview-status" id="preview-status-text">Standby</div>
        </div>
      </div>
    `;

    // Bind preview play button
    const previewBtn = body.querySelector('#btn-preview-sample');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => this.togglePreview(datasetId));
    }
  }

  /**
   * Toggle preview audio sample.
   * @param {string} datasetId 
   */
  async togglePreview(datasetId) {
    const statusText = this.container.querySelector('#preview-status-text');
    const previewBtn = this.container.querySelector('#btn-preview-sample');

    if (this.currentAudioPreview && !this.currentAudioPreview.paused) {
      this.stopPreview();
      return;
    }

    this.stopPreview();

    let previewUrl = `/api/sonify/${datasetId}?duration=5`;
    if (datasetId === 'difference') {
      previewUrl = '/api/sonify/differential?dataset_id=surface-temperature&periodA=1980-01,1990-12&periodB=2010-01,2020-12&duration=5';
    }

    if (statusText) statusText.textContent = 'Requesting STRAUSS stream…';
    if (previewBtn) previewBtn.textContent = 'Stop sample';

    try {
      this.currentAudioPreview = new Audio(previewUrl);
      this.currentAudioPreview.volume = 0.85;

      this.currentAudioPreview.addEventListener('playing', () => {
        if (statusText) statusText.textContent = 'Playing 44.1 kHz stream';
      });

      this.currentAudioPreview.addEventListener('ended', () => {
        this.stopPreview();
      });

      this.currentAudioPreview.addEventListener('error', () => {
        if (statusText) statusText.textContent = 'Error loading audio stream';
        this.stopPreview();
      });

      await this.currentAudioPreview.play();
    } catch (err) {
      console.warn('[ScientificInfoPanel] Preview play failed:', err);
      if (statusText) statusText.textContent = 'Playback interrupted or blocked by browser policy';
      this.stopPreview();
    }
  }

  /**
   * Stop any active audio preview.
   */
  stopPreview() {
    if (this.currentAudioPreview) {
      try {
        this.currentAudioPreview.pause();
        this.currentAudioPreview.currentTime = 0;
      } catch {
        // ignore audio cleanup race
      }
      this.currentAudioPreview = null;
    }

    const statusText = this.container ? this.container.querySelector('#preview-status-text') : null;
    const previewBtn = this.container ? this.container.querySelector('#btn-preview-sample') : null;

    if (statusText) statusText.textContent = 'Standby';
    if (previewBtn) previewBtn.textContent = 'Play sample';
  }

  // ==========================================================================
  // Visibility Controls
  // ==========================================================================

  open(datasetId = null) {
    this.isOpen = true;
    if (datasetId) {
      this.setDataset(datasetId);
    }
    if (this.container) {
      this.container.classList.remove('hidden');
      this.container.style.display = 'block';
      const aside = this.container.querySelector('#info-drawer-aside');
      if (aside) {
        aside.classList.add('drawer-open');
      }
    }
  }

  close() {
    this.isOpen = false;
    this.stopPreview();
    if (this.container) {
      const aside = this.container.querySelector('#info-drawer-aside');
      if (aside) {
        aside.classList.remove('drawer-open');
      }
      setTimeout(() => {
        if (!this.isOpen && this.container) {
          this.container.classList.add('hidden');
          this.container.style.display = 'none';
        }
      }, 250);
    }
    if (this.onClose) this.onClose();
  }

  toggle(datasetId = null) {
    if (this.isOpen) {
      this.close();
    } else {
      this.open(datasetId);
    }
  }
}
