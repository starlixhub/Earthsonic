/**
 * frontend/js/app.js
 * Main Coordinator for EARTHSONIC.
 * NASA Space Apps Challenge 2026: "The Earth Information Jukebox"
 *
 * Orchestrates:
 *   - Three.js 3D Earth Globe with GLSL Day/Night Terminator & Overlays
 *   - Tone.js / Web Audio 4-Channel Synchronized Orchestra Mixer
 *   - Real-Time 64-Band FFT Spectrum & Zero-Crossing Waveform Visualizer
 *   - Historical Climate Comparison Tool & 3-Way Differential Auditioning
 *   - Scientific Information & Mathematical Sonification Mapping Panel
 *   - Flight-Deck Telemetry Bar & Aerospace HUD Notifications
 */

import { EarthGlobe } from './globe/globe.js';
import { getHarmonizedTimeSeries, getZonalTimeSeries } from './api.js';
import { EarthOrchestraMixer, formatTimeMMSS } from './audio/mixer.js';
import { AudioVisualizer } from './visualizer/visualizer.js';
import { HistoricalComparison } from './comparison/comparison.js';
import { ScientificInfoPanel } from './ui/panel.js';
import { GuidedMissionTour } from './ui/guided_tour.js';
import { DimensionalSpecDrawer } from './ui/dimensional_spec.js';
import { exportMixerToWav } from './audio/exporter.js';
import { showToast, updateTelemetryStatus, getFormattedMissionTime } from './ui/telemetry.js';
import { VRLauncher } from './ui/vr_launcher.js';
import { installEarthsonicVR, installOrbitalExamineVR } from './globe/vr/index.js';
import { SweepController } from './audio/sweep.js';
import { getLayer } from './globe/layers.js';

/**
 * Universal slider fill percentage calculator for aerospace range controls.
 * @param {HTMLInputElement} slider
 */
export function updateSliderFill(slider) {
  if (!slider) return;
  const min = parseFloat(slider.min) !== undefined && !isNaN(parseFloat(slider.min)) ? parseFloat(slider.min) : 0;
  const max = parseFloat(slider.max) !== undefined && !isNaN(parseFloat(slider.max)) ? parseFloat(slider.max) : 1;
  const val = parseFloat(slider.value) !== undefined && !isNaN(parseFloat(slider.value)) ? parseFloat(slider.value) : 0;
  const range = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((val - min) / range) * 100));
  slider.style.setProperty('--fill-pct', `${pct.toFixed(2)}%`);
}

export const MISSION_PRESETS = {
  PRESET_1988_CO2: {
    id: 'PRESET_1988_CO2',
    name: '1988 Mauna Loa CO2 Inversion',
    targetDate: '1988-01',
    camera: { lat: 19.53, lon: -155.57, distance: 1.85 },
    solos: ['atmospheric_co2'],
    soloDurationSec: 4.0
  },
  PRESET_1998_EL_NINO: {
    id: 'PRESET_1998_EL_NINO',
    name: '1997-98 Super El Niño Event',
    targetDate: '1997-11',
    camera: { lat: 0.0, lon: -140.0, distance: 2.1 },
    solos: ['surface_temperature', 'ocean_temperature']
  },
  PRESET_2012_ARCTIC: {
    id: 'PRESET_2012_ARCTIC',
    name: '2012 Arctic Sea Ice Record Minimum',
    targetDate: '2012-09',
    camera: { lat: 82.0, lon: 0.0, distance: 1.9 },
    solos: ['sea_ice_extent', 'surface_temperature']
  },
  PRESET_DELTA_1980_2025: {
    id: 'PRESET_DELTA_1980_2025',
    name: 'Historical A/B Delta (1980 vs 2025)',
    isDelta: true,
    periodA: '1980-01,1980-12',
    periodB: '2025-01,2025-12'
  }
};

export class EarthSonicApp {
  constructor(options = {}) {
    this.options = options;

    // Subsystem Instances
    this.globe = null;
    this.mixer = null;
    this.visualizer = null;
    this.comparison = null;
    this.infoPanel = null;
    this.guidedTour = null;
    this.specDrawer = null;
    this.vrLauncher = null;
    // M5: Orbital Examine is the active VR mode; legacy TerminatorSkim kept on
    // window.earthsonicVR for backward compat (vr_launcher.js prefers orbital).
    this.vr = installEarthsonicVR(this);
    this.orbitalVR = installOrbitalExamineVR(this); // sets window.earthsonicOrbitalVR

    // Data Caches
    this.harmonizedData = null;
    this.zonalData = null;
    this.isStemsLoaded = false;
    this.isInitialized = false;

    // Interactive coupling and preset state
    this.hoveredTrackId = null;
    this._presetTimer = null;
    this._recordIndex = 0;
    this._loadingSafetyTimer = null;

    // Satellite & Sweep state
    this.mode = 'climate'; // 'climate' | 'layers'
    this.activeSatLayer = 'night_lights';
    this.sweepController = null;
    this._lastClimateLayer = 'temperature';

    // DOM Elements Cache
    this.elements = {};
  }

  /**
   * Main bootstrap entry point.
   */
  async init() {
    if (this.isInitialized) return;
    this.cacheElements();

    this._loadingSafetyTimer = setTimeout(() => {
      console.warn('[EarthSonicApp] Loading overlay dismissed by the 20s safety net — initialization never reported ready.');
      this.hideLoadingScreen();
    }, 20000);

    try {
      // 1. Initialize Flight Deck Telemetry
      this.initTelemetry();

      // 2. Initialize Multi-Track Orchestra & Real-Time Visualizer
      this.initAudioAndVisualizer();

      // 3. Initialize Historical Comparison Tool & Scientific Info Drawer
      this.initComparisonAndInfoPanel();

      // 4. Bind UI Controls & Keyboard Shortcuts IMMEDIATELY so buttons are responsive
      this.bindUserInterface();
      this.bindKeyboardShortcuts();

      // 5. Initialize 3D Earth Globe
      await this.initGlobe();

      // 6. Fetch NASA Observation Data
      await this.loadNasaObservations();

      this.isInitialized = true;
      this.hideLoadingScreen();
      showToast('Earthsonic ready · NASA / NOAA observations loaded', 'success', 3500);
      updateTelemetryStatus('FLIGHT DECK ONLINE • 23.44° TILT');
    } catch (err) {
      console.error('[EarthSonicApp] Fatal initialization error:', err);
      showToast(`Initialization failed: ${err.message}`, 'error', 5000);
      if (this.elements.loadingScreen) {
        this.elements.loadingScreen.innerHTML = `
          <div style="color:#ef4444;font-family:monospace;padding:1.5rem;text-align:center;">
            System Initialization Failure: ${err.message}
          </div>
        `;
      }
    }
  }

  /**
   * Dismiss the loading overlay once initialization has actually finished.
   *
   * It used to be dismissed by a hardcoded 1800ms timer in index.html, which
   * either lifted early (empty globe, no data) or lied on a slow network. The
   * safety net below only fires if something hangs, and says so in the console.
   */
  hideLoadingScreen() {
    if (this._loadingSafetyTimer) {
      clearTimeout(this._loadingSafetyTimer);
      this._loadingSafetyTimer = null;
    }
    const el = this.elements.loadingScreen;
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => {
      if (el) el.style.display = 'none';
    }, 500);
  }

  /**
   * Cache references to essential DOM elements.
   */
  cacheElements() {
    this.elements = {
      globeContainer: document.getElementById('globe-viewport-container'),
      loadingScreen: document.getElementById('loading-screen'),
      seekSlider: document.getElementById('orchestra-seek-slider'),
      timeDisplay: document.getElementById('orchestra-time-display'),
      dateLabel: document.getElementById('timeline-date-label'),
      btnMasterPlay: document.getElementById('btn-master-play'),
      btnMasterPause: document.getElementById('btn-master-pause'),
      btnMasterStop: document.getElementById('btn-master-stop'),
      btnMasterLoop: document.getElementById('btn-master-loop'),
      masterVolSlider: document.getElementById('master-vol-slider'),
      masterVolLabel: document.getElementById('master-vol-label'),
      hudSubtitle: document.getElementById('hud-observation-subtitle'),
      hudVal: document.getElementById('hud-var-value'),
      hudMeta: document.getElementById('hud-var-meta'),
      thermalLegend: document.getElementById('thermal-legend'),
      btnOpenComparison: document.getElementById('btn-open-comparison'),
      btnOpenInfo: document.getElementById('btn-open-info'),
      comparisonModal: document.getElementById('comparison-modal'),
      infoDrawer: document.getElementById('info-drawer'),
      missionClock: document.getElementById('mission-clock'),
      presetSelect: document.getElementById('mission-preset-select'),
      btnJudgeTour: document.getElementById('btn-judge-tour'),
      btnOpenSensors: document.getElementById('btn-open-sensors'),
      btnExportWav: document.getElementById('btn-export-wav'),
      btnEnterVr: document.getElementById('btn-enter-vr'),
      btnModeClimate: document.getElementById('btn-mode-climate'),
      btnModeLayers: document.getElementById('btn-mode-layers'),
      satellitePicker: document.getElementById('satellite-layer-picker'),
      nightLightsAbContainer: document.getElementById('night-lights-ab-container'),
      nightLightsAbSlider: document.getElementById('night-lights-ab-slider'),
      orchestraGrid: document.getElementById('orchestra-channels-grid')
    };
  }

  /**
   * Start mission clock and telemetry ticker.
   */
  initTelemetry() {
    const updateClock = () => {
      if (this.elements.missionClock) {
        this.elements.missionClock.textContent = getFormattedMissionTime();
      }
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  /**
   * Initialize Three.js 3D Earth Globe with Day/Night shaders.
   */
  async initGlobe() {
    if (!this.elements.globeContainer) return;

    try {
      this.globe = new EarthGlobe(this.elements.globeContainer, {
        baseTexturePath: '/assets/textures/',
        autoRotate: true,
        autoRotateSpeed: 0.2
      });

      // Race with a 2.5-second timeout so procedural textures never block UI
      await Promise.race([
        this.globe.ready,
        new Promise(resolve => setTimeout(resolve, 2500))
      ]);

      if (this.globe && typeof this.globe.setActiveOverlay === 'function') {
        this.globe.setActiveOverlay('temperature');
      }

      if (this.vr && this.globe && this.globe.renderer) {
        this.vr.init(this.globe.renderer).catch(e => console.warn('[VR] VR Scene init notice:', e));
      }
      // M5: Orbital Examine init (owns its own canvas; does not need globe.renderer)
      if (this.orbitalVR && typeof this.orbitalVR.init === 'function') {
        this.orbitalVR.init().catch(e => console.warn('[Orbital VR] Scene init notice:', e));
      }
    } catch (err) {
      console.warn('[EarthSonicApp] Globe initialization warning (continuing):', err);
    }
  }

  /**
   * Load harmonized multi-track and zonal observations from REST API.
   */
  async loadNasaObservations() {
    const [harm, zonal] = await Promise.all([
      getHarmonizedTimeSeries().catch(() => null),
      getZonalTimeSeries().catch(() => null)
    ]);

    this.harmonizedData = harm;
    this.zonalData = zonal;

    if (this.harmonizedData && this.harmonizedData.records) {
      if (this.vr && this.vr.sceneInstance) {
        this.vr.sceneInstance.harmonizedRecords = this.harmonizedData.records;
      }
      // M5: feed records into the Orbital Examine scene. installOrbitalExamineVR
      // returns the SCENE, not the window interface object, so the records must
      // be written here — the old `.sceneInstance` path was undefined and the
      // VR globe kept running on interpolator fallbacks instead of NASA data.
      const orbitalScene = this.orbitalVR;
      if (orbitalScene) {
        orbitalScene.harmonizedRecords = this.harmonizedData.records;
        if (this.zonalData && typeof orbitalScene.setZonalData === 'function') {
          orbitalScene.setZonalData(this.zonalData);
        }
        if (typeof orbitalScene.updateTimeline === 'function') {
          orbitalScene.updateTimeline(orbitalScene.currentT || 0);
        }
        // Real GISTEMP 250 km grid: the spatial field behind the NASA anomaly
        // maps, so the TEMP layer shows actual regions, not latitude bands.
        fetch('/assets/data/gistemp_grid_annual.json')
          .then((r) => (r.ok ? r.json() : null))
          .then((meta) => {
            if (!meta) return null;
            return fetch('/assets/data/gistemp_grid_annual.bin')
              .then((r) => (r.ok ? r.arrayBuffer() : null))
              .then((buf) => {
                if (buf && typeof orbitalScene.setTemperatureGrid === 'function') {
                  orbitalScene.setTemperatureGrid(meta, buf);
                }
              });
          })
          .catch((e) => console.warn('[Orbital VR] GISTEMP grid unavailable:', e));
      }
      this._recordIndex = this.harmonizedData.records.length - 1;
      this.updateGlobeToRecordIndex(this._recordIndex);
    }
  }

  /**
   * Initialize Tone.js / Web Audio Multi-Track Mixer & Audio Visualizer HUD.
   */
  initAudioAndVisualizer() {
    this.mixer = new EarthOrchestraMixer({
      masterVolume: 0.85,
      loop: true
    });

    this.visualizer = new AudioVisualizer({
      spectrumCanvas: 'spectrum-canvas',
      waveformCanvas: 'waveform-canvas',
      rmsMeterElement: 'rms-meter-bar',
      rmsTextElement: 'rms-db-text',
      peakTextElement: 'peak-db-text'
    });

    // Initialize Earth Jukebox Sweep Controller
    this.initSweepController();

    // Milestone M3: Connect VR Subsystems with Web Audio Mixer
    if (this.vr && typeof this.vr.setMixer === 'function') {
      this.vr.setMixer(this.mixer);
    }
    // M5: Orbital Examine mixer
    if (this.orbitalVR && typeof this.orbitalVR.setMixer === 'function') {
      this.orbitalVR.setMixer(this.mixer);
    }

    if (this.vr && this.vr.sceneInstance && this.vr.sceneInstance.glider) {
      this.vr.sceneInstance.glider.onTimelineScrub = (progressT) => {
        if (this.harmonizedData && this.harmonizedData.records && this.harmonizedData.records.length > 0) {
          const totalRecs = this.harmonizedData.records.length;
          const idx = Math.min(totalRecs - 1, Math.floor(progressT * totalRecs));
          this._recordIndex = idx;
          this.updateGlobeToRecordIndex(idx);
        }
        if (this.vr.sceneInstance.spatialAudio) {
          this.vr.sceneInstance.spatialAudio.syncPlayhead(progressT);
        } else if (this.mixer) {
          this.mixer.seekProgress(progressT);
        }
      };
    }

    // Synchronize multi-track playhead with 3D Globe & VR Glider
    this.mixer.on('timeupdate', ({ currentTime, duration, progress }) => {
      if (this.elements.seekSlider) {
        this.elements.seekSlider.value = currentTime;
        updateSliderFill(this.elements.seekSlider);
      }
      if (this.elements.timeDisplay) {
        this.elements.timeDisplay.textContent = `${formatTimeMMSS(currentTime)} / ${formatTimeMMSS(duration)}`;
      }

      if (this.harmonizedData && this.harmonizedData.records && this.harmonizedData.records.length > 0) {
        const totalRecs = this.harmonizedData.records.length;
        const idx = Math.min(totalRecs - 1, Math.floor(progress * totalRecs));
        this._recordIndex = idx;
        this.updateGlobeToRecordIndex(idx);
      }

      if (this.vr) {
        if (this.vr.sceneInstance && this.vr.sceneInstance.glider) {
          if (Math.abs(this.vr.sceneInstance.glider.getTimelineVelocity()) < 1e-6) {
            this.vr.sceneInstance.glider.setTimelinePosition(progress);
          }
        }
        this.vr.updateTimeline(progress);
        if (this.mixer && typeof this.mixer.getAudioEnvelopes === 'function') {
          this.vr.updateAudioEnvelopes(this.mixer.getAudioEnvelopes());
        }
      }

      this.updateTrackMeters();
    });

    this.mixer.on('trackupdate', () => {
      document.querySelectorAll('.btn-mute').forEach(btn => {
        const tid = btn.getAttribute('data-track');
        const trk = this.mixer && this.mixer.getTrack(tid);
        if (trk) btn.classList.toggle('active', trk.isMuted);
      });
      document.querySelectorAll('.btn-solo').forEach(btn => {
        const tid = btn.getAttribute('data-track');
        const trk = this.mixer && this.mixer.getTrack(tid);
        if (trk) btn.classList.toggle('active', trk.isSoloed);
      });
      this.updateStripSilencedState();
      this.updateVisualAcousticCoupling();
    });

    this.mixer.on('statechange', (state) => {
      if (this.elements.btnMasterPlay) {
        if (state.isPlaying) {
          this.elements.btnMasterPlay.classList.add('active');
          this.elements.btnMasterPlay.textContent = 'Playing';
        } else {
          this.elements.btnMasterPlay.classList.remove('active');
          this.elements.btnMasterPlay.textContent = 'Play';
        }
      }
      if (this.elements.btnMasterLoop) {
        this.elements.btnMasterLoop.classList.toggle('active', state.isLooping);
      }
    });
  }

  /**
   * Initialize Earth Jukebox Longitude Sweep Controller.
   */
  initSweepController() {
    this.sweepController = new SweepController({
      audioCtx: this.mixer ? this.mixer.audioCtx : null,
      overlayManager: this.globe ? this.globe.overlays : null,
      duration: 20.0,
      width: 720
    });

    this.sweepController.on('tick', ({ time, duration, col, lon }) => {
      if (this.mode !== 'layers') return;
      if (this.elements.seekSlider) {
        this.elements.seekSlider.value = time;
        updateSliderFill(this.elements.seekSlider);
      }
      if (this.elements.timeDisplay) {
        this.elements.timeDisplay.textContent = `${formatTimeMMSS(time)} / ${formatTimeMMSS(duration)}`;
      }
      if (this.elements.dateLabel) {
        const ew = lon >= 0 ? `${lon.toFixed(1)}°E` : `${Math.abs(lon).toFixed(1)}°W`;
        this.elements.dateLabel.textContent = `LONGITUDE: ${ew} (COL ${col})`;
      }
    });

    this.sweepController.on('play', () => {
      if (this.mode !== 'layers') return;
      if (this.elements.btnMasterPlay) {
        this.elements.btnMasterPlay.classList.add('active');
        this.elements.btnMasterPlay.textContent = 'Playing';
      }
      if (this.elements.btnMasterPause) this.elements.btnMasterPause.classList.remove('active');
    });

    this.sweepController.on('pause', () => {
      if (this.mode !== 'layers') return;
      if (this.elements.btnMasterPlay) {
        this.elements.btnMasterPlay.classList.remove('active');
        this.elements.btnMasterPlay.textContent = 'Play';
      }
      if (this.elements.btnMasterPause) this.elements.btnMasterPause.classList.add('active');
    });

    this.sweepController.on('stop', () => {
      if (this.mode !== 'layers') return;
      if (this.elements.btnMasterPlay) {
        this.elements.btnMasterPlay.classList.remove('active');
        this.elements.btnMasterPlay.textContent = 'Play';
      }
      if (this.elements.btnMasterPause) this.elements.btnMasterPause.classList.remove('active');
    });

    this.loadSatelliteLayerData(this.activeSatLayer || 'night_lights');
  }

  async loadSatelliteLayerData(layerId) {
    try {
      const res = await fetch(`/api/layers/${layerId}`);
      if (res.ok) {
        const data = await res.json();
        if (this.sweepController) {
          this.sweepController.setLayerData(layerId, data);
        }
      }
    } catch {
      // ignore
    }
  }

  /**
   * Initialize Historical Comparison Tool and Scientific Info Panel.
   */
  initComparisonAndInfoPanel() {
    // 1. Comparison Tool
    if (this.elements.comparisonModal) {
      this.comparison = new HistoricalComparison({
        container: this.elements.comparisonModal,
        dataset: 'surface-temperature',
        onAudioPlay: (mode) => {
          showToast(`Playing ${mode.toUpperCase()} interval`, 'info', 2000);
        }
      });
    }

    // 2. Scientific Info Panel Drawer
    if (this.elements.infoDrawer) {
      this.infoPanel = new ScientificInfoPanel({
        container: this.elements.infoDrawer,
        dataset: 'surface-temperature'
      });
    }

    // 3. Autonomous Guided Mission Presentation for Judges
    this.guidedTour = new GuidedMissionTour({
      app: this,
      globe: this.globe,
      mixer: this.mixer
    });

    // 4. NASA Sensor CAD Blueprint Specification Drawer
    this.specDrawer = new DimensionalSpecDrawer({
      globe: this.globe,
      mixer: this.mixer
    });

    // 5. Milestone M1: VR Launcher Bridge & Mobile Headset Coordinator
    this.vrLauncher = new VRLauncher(this);
    this.vrLauncher.init();
  }

  /**
   * Update channel meters in DAW mixer dock.
   */
  updateTrackMeters() {
    if (!this.mixer) return;
    for (const track of this.mixer.getAllTracks()) {
      const meterEl = document.getElementById(`meter-${track.id}`);
      if (meterEl) {
        const { rmsDb } = track.getMeterLevel();
        const pct = Math.max(0, Math.min(100, ((rmsDb + 60.0) / 60.0) * 100));
        meterEl.style.width = `${pct}%`;
      }
    }
    if (this.vr && typeof this.mixer.getAudioEnvelopes === 'function') {
      this.vr.updateAudioEnvelopes(this.mixer.getAudioEnvelopes());
    }
  }

  /**
   * Ensure audio context is started and stems are preloaded.
   */
  async loadAudioStemsIfNeeded() {
    if (this.isStemsLoaded || !this.mixer) return;
    try {
      await this.mixer.ensureAudioContext();
      if (this.vr && typeof this.vr.setMixer === 'function') {
        this.vr.setMixer(this.mixer);
      }
      const analyser = this.mixer.getMasterAnalyser();
      if (analyser && this.visualizer) {
        this.visualizer.connect(analyser);
        this.visualizer.start();
      }
      showToast('Loading four STRAUSS observation stems…', 'info', 2500);
      await this.mixer.loadManifest('/api/sonify/orchestra?duration=20');

      if (this._activeSoloTrack) {
        for (const track of this.mixer.getAllTracks()) {
          track.isSoloed = (track.id === this._activeSoloTrack);
        }
        this.mixer.updateSoloMuteMatrix();
      }

      if (this.elements.seekSlider) this.elements.seekSlider.max = this.mixer.duration;
      if (this.elements.timeDisplay) {
        this.elements.timeDisplay.textContent = `00:00 / ${formatTimeMMSS(this.mixer.duration)}`;
      }
      this.isStemsLoaded = true;
      showToast('Four synchronized stems ready', 'success', 2500);
    } catch (e) {
      console.warn('[EarthSonicApp] Could not preload audio stems automatically:', e);
      showToast('Audio loads when you press Play', 'warning', 2500);
    }
  }

  /**
   * Update 3D Globe overlays and HUD telemetry for a specific month index.
   * @param {number} idx 
   */
  updateGlobeToRecordIndex(idx) {
    if (!this.harmonizedData || !this.harmonizedData.records || !this.harmonizedData.records[idx]) return;
    const rec = this.harmonizedData.records[idx];
    if (this.elements.dateLabel) this.elements.dateLabel.textContent = rec.date;

    const year = parseInt(rec.date.split('-')[0], 10);
    const zonalRec = this.zonalData && this.zonalData.records
      ? this.zonalData.records.find(z => z.year === year)
      : null;

    if (this.globe) {
      this.globe.updateData(rec, zonalRec);
    }

    if (this.vr && this.harmonizedData && this.harmonizedData.records) {
      const maxIdx = this.harmonizedData.records.length - 1;
      const progressT = maxIdx > 0 ? idx / maxIdx : 0.0;
      this.vr.updateTimeline(progressT);
    }

    // Update Live Earth Telemetry Matrix (all 4 variables simultaneously)
    this.updateTelemetryMatrix(rec);

    // Update HUD telemetry
    const activeLayer = (this.globe && this.globe.overlays.activeOverlayId) || 'temperature';
    if (this.elements.hudSubtitle) {
      const hudSubtextId = 'hud-subtext-channels-head';
      const hudSubtextEl = document.getElementById(hudSubtextId);
      let subtitle = 'Surface temperature anomaly';
      if (activeLayer === 'co2' || activeLayer.slice(-5) === '_co2') {
        subtitle = 'Atmospheric CO2 concentration';
      } else if (activeLayer === 'ocean' || activeLayer.includes('ocean')) {
        subtitle = 'Global ocean heat anomaly (0-2000m)';
      } else if (activeLayer === 'sea_ice' || activeLayer.includes('sea_ice')) {
        subtitle = 'Arctic sea-ice extent';
      }
      this.elements.hudSubtitle.textContent = subtitle;
      if (hudSubtextEl) hudSubtextEl.textContent = subtitle;
    }

    if (this.elements.hudVal && this.elements.hudMeta) {
      if (activeLayer === 'temperature') {
        this.elements.hudVal.textContent = `${rec.temperature_anomaly >= 0 ? '+' : ''}${rec.temperature_anomaly.toFixed(2)} °C`;
        this.elements.hudMeta.textContent = `NASA GISS GISTEMP v4 · ${rec.date}`;
      } else if (activeLayer === 'co2') {
        this.elements.hudVal.textContent = `${rec.co2_ppm.toFixed(1)} ppm`;
        this.elements.hudMeta.textContent = `NOAA GML Mauna Loa CO₂ · ${rec.date}`;
      } else if (activeLayer === 'ocean') {
        this.elements.hudVal.textContent = `${rec.ocean_temp_anomaly >= 0 ? '+' : ''}${rec.ocean_temp_anomaly.toFixed(2)} °C`;
        this.elements.hudMeta.textContent = `NOAA ocean temperature anomaly · ${rec.date}`;
      } else if (activeLayer === 'sea_ice') {
        this.elements.hudVal.textContent = `${rec.sea_ice_extent.toFixed(2)} M km²`;
        this.elements.hudMeta.textContent = `NSIDC Arctic sea-ice extent · ${rec.date}`;
      } else {
        this.elements.hudVal.textContent = `${rec.date}`;
        this.elements.hudMeta.textContent = `Four-layer composite · ${rec.date}`;
      }
    }

    // Update real-time Physical Value -> Audio Parameter equation badges
    this.updateLiveEquationBadges(rec);
  }

  /**
   * Update Live Earth Telemetry Matrix card for all 4 variables.
   * @param {Object} rec - Harmonized monthly observation record
   */
  updateTelemetryMatrix(rec) {
    if (!rec) return;

    const elTemp = document.getElementById('matrix-val-temperature');
    if (elTemp && rec.temperature_anomaly !== undefined) {
      elTemp.textContent = `${rec.temperature_anomaly >= 0 ? '+' : ''}${rec.temperature_anomaly.toFixed(2)}°C`;
    }
    const elCo2 = document.getElementById('matrix-val-co2');
    if (elCo2 && rec.co2_ppm !== undefined) {
      elCo2.textContent = `${rec.co2_ppm.toFixed(1)} ppm`;
    }
    const elOcean = document.getElementById('matrix-val-ocean');
    if (elOcean && rec.ocean_temp_anomaly !== undefined) {
      elOcean.textContent = `${rec.ocean_temp_anomaly >= 0 ? '+' : ''}${rec.ocean_temp_anomaly.toFixed(2)}°C`;
    }
    const elIce = document.getElementById('matrix-val-sea_ice');
    if (elIce && rec.sea_ice_extent !== undefined) {
      elIce.textContent = `${rec.sea_ice_extent.toFixed(2)} M km²`;
    }

    // Highlight active layer
    const activeLayer = (this.globe && this.globe.overlays.activeOverlayId) || 'temperature';
    document.querySelectorAll('.matrix-cell').forEach(cell => {
      const cellLayer = cell.getAttribute('data-layer');
      cell.classList.toggle('active', cellLayer === activeLayer || activeLayer === 'all');
    });
  }

  /**
   * Point the legend at whatever the globe is currently encoding.
   *
   * It was a fixed "Zonal temperature anomaly" ramp that stayed on screen and
   * kept that label even with CO2, ocean heat or sea ice selected.
   * @param {string} layer - temperature | co2 | ocean | sea_ice | all
   */
  updateLayerLegend(layer) {
    const el = this.elements.thermalLegend;
    if (!el) return;

    const specs = {
      temperature: {
        title: 'Zonal temperature anomaly',
        labels: ['−2.0 °C', '0.0 °C', '+1.0 °C', '+2.5 °C'],
        ramp: 'linear-gradient(to right, #0060e6, #00e0ff, #f0f0ff, #f8b800, #e62010)'
      },
      co2: {
        title: 'Atmospheric CO₂ concentration',
        labels: ['350 ppm', '385 ppm', '415 ppm', '450 ppm'],
        ramp: 'linear-gradient(to right, #16323f, #2f7d8c, #f59e0b, #ffb366)'
      },
      ocean: {
        title: 'Ocean heat anomaly · 0–2000 m',
        labels: ['−0.5 °C', '0.0 °C', '+0.5 °C', '+1.5 °C'],
        ramp: 'linear-gradient(to right, #0b2a4a, #0ea5e9, #6fe3ff, #f0f9ff)'
      },
      sea_ice: {
        title: 'Arctic sea-ice extent',
        labels: ['3 M km²', '5 M km²', '7 M km²', '9 M km²'],
        ramp: 'linear-gradient(to right, #1b2636, #4d6a80, #cfe9f5, #f4f4f5)'
      },
      all: {
        title: 'All layers · temperature ramp',
        labels: ['−2.0 °C', '0.0 °C', '+1.0 °C', '+2.5 °C'],
        ramp: 'linear-gradient(to right, #0060e6, #00e0ff, #f0f0ff, #f8b800, #e62010)'
      }
    };

    const spec = specs[layer] || specs.temperature;
    const title = el.querySelector('.legend-title');
    const bar = el.querySelector('.legend-bar');
    const labels = el.querySelectorAll('.legend-labels span');

    if (title) title.textContent = spec.title;
    if (bar) bar.style.background = spec.ramp;
    labels.forEach((span, i) => {
      if (spec.labels[i]) span.textContent = spec.labels[i];
    });
    el.classList.add('active');
  }

  /**
   * Update inline live equation badges showing Physical Value -> Audio Parameter in real time.
   * @param {Object} rec - Harmonized monthly observation record
   */
  updateLiveEquationBadges(rec) {
    if (!rec) return;

    // CH1 Surface Temp: f(T) = 261.63 * 2^(anom / 1.0) Hz
    const anom = rec.temperature_anomaly !== undefined ? rec.temperature_anomaly : 0.0;
    const hz1 = Math.round(261.63 * Math.pow(2.0, anom / 1.0));
    const sign1 = anom >= 0 ? '+' : '';
    const text1 = `${sign1}${anom.toFixed(2)}°C → ${hz1} Hz`;
    const el1 = document.getElementById('eq-text-surface_temperature');
    if (el1) el1.textContent = text1;

    // CH2 Atmospheric CO2: Drive = clamp(((ppm - 350) / 90) * 100, 0, 100)
    const ppm = rec.co2_ppm !== undefined ? rec.co2_ppm : 315.0;
    const drive = Math.max(0, Math.min(100, Math.round(((ppm - 350.0) / 90.0) * 100)));
    const text2 = `${ppm.toFixed(1)} ppm → ${drive}% Drive`;
    const el2 = document.getElementById('eq-text-atmospheric_co2');
    if (el2) el2.textContent = text2;

    // CH3 Ocean Heat: Butterworth LPF Cutoff fc(T) = 80 * (2400 / 80)^norm Hz
    const oceanAnom = rec.ocean_temp_anomaly !== undefined ? rec.ocean_temp_anomaly : 0.0;
    const normO = Math.max(0.0, Math.min(1.0, (oceanAnom + 0.6) / 1.8));
    const fc = Math.round(80.0 * Math.pow(2400.0 / 80.0, normO));
    const sign3 = oceanAnom >= 0 ? '+' : '';
    const text3 = `${sign3}${oceanAnom.toFixed(2)}°C → ${fc} Hz LPF`;
    const el3 = document.getElementById('eq-text-ocean_temperature');
    if (el3) el3.textContent = text3;

    // CH4 Sea Ice Extent: Wind Mix
    const iceExt = rec.sea_ice_extent !== undefined ? rec.sea_ice_extent : 7.8;
    const text4 = `${iceExt.toFixed(2)} M km² → Wind Mix`;
    const el4 = document.getElementById('eq-text-sea_ice_extent');
    if (el4) el4.textContent = text4;
  }

  /**
   * Bind event listeners for all UI controls.
   */
  bindUserInterface() {
    // Mission Presets Selector
    if (this.elements.presetSelect) {
      this.elements.presetSelect.addEventListener('change', async (e) => {
        const val = e.target.value;
        if (val) {
          await this.applyMissionPreset(val);
        }
      });
    }

    // High-Impact NASA Space Apps Autonomous Guided Mission Tour (90s)
    if (this.elements.btnJudgeTour) {
      this.elements.btnJudgeTour.addEventListener('click', async () => {
        if (this.guidedTour) {
          await this.guidedTour.start();
          showToast('90-second observational briefing started', 'success', 3500);
        }
      });
    }

    // NASA Satellite Sensor CAD Blueprint Specification Drawer
    if (this.elements.btnOpenSensors) {
      this.elements.btnOpenSensors.addEventListener('click', () => {
        if (this.specDrawer) {
          const activeLayer = (this.globe && this.globe.overlays.activeOverlayId) || 'temperature';
          const sensorMap = {
            co2: 'OCO-2',
            temperature: 'MODIS-TEMP',
            sea_ice: 'AMSR2-ICE',
            ocean: 'JASON3-OHT'
          };
          this.specDrawer.open(sensorMap[activeLayer] || 'OCO-2');
        }
      });
    }

    // Broadcast-Quality Audio WAV Exporter
    if (this.elements.btnExportWav) {
      this.elements.btnExportWav.addEventListener('click', async () => {
        try {
          showToast('Rendering 44.1 kHz stereo mix…', 'info', 3000);
          const result = await exportMixerToWav(this.mixer);
          showToast(`Export Complete: ${result.filename} (${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB)`, 'success', 4000);
        } catch (err) {
          console.error('[Export WAV Error]:', err);
          showToast(`Audio export failed: ${err.message}`, 'error', 4000);
        }
      });
    }

    // Header Tool Buttons: Compare & Info
    if (this.elements.btnOpenComparison) {
      this.elements.btnOpenComparison.addEventListener('click', () => {
        if (this.comparison) this.comparison.open();
      });
    }

    if (this.elements.btnOpenInfo) {
      this.elements.btnOpenInfo.addEventListener('click', () => {
        if (this.infoPanel) {
          const activeLayer = (this.globe && this.globe.overlays.activeOverlayId) || 'surface-temperature';
          const layerMap = {
            temperature: 'surface-temperature',
            co2: 'atmospheric-co2',
            ocean: 'ocean-temperature',
            sea_ice: 'sea-ice-extent',
            night_lights: 'night_lights',
            lightning: 'lightning',
            gedi_forest: 'gedi_forest',
            co2_dyamond: 'co2_dyamond'
          };
          this.infoPanel.open(layerMap[activeLayer] || activeLayer || 'surface-temperature');
        }
      });
    }

    // Master Transport: Play
    if (this.elements.btnMasterPlay) {
      this.elements.btnMasterPlay.addEventListener('click', async () => {
        if (this.mode === 'layers' && this.sweepController) {
          if (this.sweepController.isPlaying) {
            this.sweepController.pause();
          } else {
            this.sweepController.play();
          }
          return;
        }
        await this.loadAudioStemsIfNeeded();
        if (this.mixer.isPlaying) {
          this.mixer.pause();
        } else {
          this.mixer.play();
        }
      });
    }

    // Master Transport: Pause
    if (this.elements.btnMasterPause) {
      this.elements.btnMasterPause.addEventListener('click', () => {
        if (this.mode === 'layers' && this.sweepController) {
          this.sweepController.pause();
          return;
        }
        if (this.mixer) this.mixer.pause();
      });
    }

    // Master Transport: Stop
    if (this.elements.btnMasterStop) {
      this.elements.btnMasterStop.addEventListener('click', () => {
        if (this.mode === 'layers' && this.sweepController) {
          this.sweepController.stop();
          if (this.elements.seekSlider) {
            this.elements.seekSlider.value = 0;
            updateSliderFill(this.elements.seekSlider);
          }
          if (this.elements.timeDisplay) {
            this.elements.timeDisplay.textContent = `00:00 / ${formatTimeMMSS(this.sweepController.duration)}`;
          }
          return;
        }
        if (this.mixer) {
          this.mixer.stop();
          if (this.elements.seekSlider) {
            this.elements.seekSlider.value = 0;
            updateSliderFill(this.elements.seekSlider);
          }
          if (this.elements.timeDisplay) {
            this.elements.timeDisplay.textContent = `00:00 / ${formatTimeMMSS(this.mixer.duration)}`;
          }
        }
      });
    }

    // Master Transport: Loop
    if (this.elements.btnMasterLoop) {
      this.elements.btnMasterLoop.addEventListener('click', () => {
        if (this.mixer) this.mixer.setLoop(!this.mixer.isLooping);
      });
    }

    // Master Volume
    if (this.elements.masterVolSlider) {
      this.elements.masterVolSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.mixer) this.mixer.setMasterVolume(val);
        if (this.elements.masterVolLabel) {
          this.elements.masterVolLabel.textContent = `${Math.round(val * 100)}%`;
        }
        updateSliderFill(this.elements.masterVolSlider);
      });
    }

    // Scrubber Seeking
    if (this.elements.seekSlider) {
      this.elements.seekSlider.addEventListener('input', async (e) => {
        const targetSec = parseFloat(e.target.value);
        if (this.mode === 'layers' && this.sweepController) {
          this.sweepController.seek(targetSec);
          updateSliderFill(this.elements.seekSlider);
          return;
        }
        await this.loadAudioStemsIfNeeded();
        if (this.mixer) this.mixer.seek(targetSec);
        updateSliderFill(this.elements.seekSlider);
      });
    }

    // Channel Controls (Mute, Solo, Volume)
    document.querySelectorAll('.btn-mute').forEach(btn => {
      btn.addEventListener('click', () => {
        const trackId = btn.getAttribute('data-track');
        const track = this.mixer && this.mixer.getTrack(trackId);
        if (track) {
          this.mixer.setTrackMute(trackId, !track.isMuted);
          btn.classList.toggle('active', track.isMuted);
          this.updateStripSilencedState();
        }
      });
    });

    document.querySelectorAll('.btn-solo').forEach(btn => {
      btn.addEventListener('click', () => {
        const trackId = btn.getAttribute('data-track');
        const track = this.mixer && this.mixer.getTrack(trackId);
        if (track) {
          this.mixer.setTrackSolo(trackId, !track.isSoloed);
          btn.classList.toggle('active', track.isSoloed);
          this.updateStripSilencedState();
          this.updateVisualAcousticCoupling();

          // Two-way sync: update left rail active layer button if soloed
          const TRACK_TO_LAYER = {
            surface_temperature: 'temperature',
            atmospheric_co2: 'co2',
            ocean_temperature: 'ocean',
            sea_ice_extent: 'sea_ice'
          };
          const layerKey = TRACK_TO_LAYER[trackId];
          if (track.isSoloed && layerKey) {
            document.querySelectorAll('.layer-btn').forEach(b => {
              const match = b.getAttribute('data-layer') === layerKey;
              b.classList.toggle('active', match);
              b.setAttribute('aria-pressed', match ? 'true' : 'false');
            });
            this._lastClimateLayer = layerKey;
            this._activeSoloTrack = trackId;
            if (this.globe) this.globe.setActiveOverlay(layerKey);
            this.updateLayerLegend(layerKey);
            this.updateGlobeToRecordIndex(this._recordIndex);
          } else if (this.mixer && !this.mixer.getAllTracks().some(t => t.isSoloed)) {
            this._activeSoloTrack = null;
          }
        }
      });
    });

    // Channel Strip Hover Coupling
    document.querySelectorAll('.channel-strip').forEach(strip => {
      strip.addEventListener('mouseenter', () => {
        this.hoveredTrackId = strip.getAttribute('data-track');
        this.updateVisualAcousticCoupling();
      });
      strip.addEventListener('mouseleave', () => {
        this.hoveredTrackId = null;
        this.updateVisualAcousticCoupling();
      });
    });

    document.querySelectorAll('.strip-vol-slider').forEach(input => {
      input.addEventListener('input', (e) => {
        const trackId = input.getAttribute('data-track');
        const val = parseFloat(e.target.value);
        if (this.mixer) this.mixer.setTrackVolume(trackId, val);
        const label = document.querySelector(`[data-vol-label="${trackId}"]`);
        if (label) label.textContent = `${Math.round(val * 100)}%`;
        updateSliderFill(input);
      });
    });

    // The telemetry matrix is a readout, not a control: it highlights the active
    // layer but duplicates the layer rail when clicked, so it no longer takes input.

    // Universal range sliders fill initialization
    document.querySelectorAll('input[type="range"]').forEach(slider => {
      updateSliderFill(slider);
      slider.addEventListener('input', () => updateSliderFill(slider));
    });

    // Layer Switcher buttons
    document.querySelectorAll('.layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.getAttribute('data-layer');
        const LAYER_TO_TRACK = {
          temperature: 'surface_temperature',
          co2: 'atmospheric_co2',
          ocean: 'ocean_temperature',
          sea_ice: 'sea_ice_extent'
        };
        const targetTrack = LAYER_TO_TRACK[layer];

        // Check if this layer's stem is already the only soloed track
        let isAlreadySoloed = false;
        if (this.mixer && targetTrack) {
          const allTracks = this.mixer.getAllTracks();
          const anySolo = allTracks.some(t => t.isSoloed);
          isAlreadySoloed = anySolo && allTracks.every(t => (t.id === targetTrack ? t.isSoloed : !t.isSoloed));
        }

        if (isAlreadySoloed) {
          // Toggle: restore full 4-instrument orchestra
          if (this.mixer) {
            for (const track of this.mixer.getAllTracks()) {
              track.isSoloed = false;
            }
            this.mixer.updateSoloMuteMatrix();
          }
          this._activeSoloTrack = null;
          showToast('Full Orchestra · all four channels active', 'info', 2000);
        } else {
          // Solo the selected layer's stem so the user hears its distinct instrument
          this._activeSoloTrack = targetTrack || null;
          if (this.mixer && targetTrack) {
            for (const track of this.mixer.getAllTracks()) {
              track.isSoloed = (track.id === targetTrack);
            }
            this.mixer.updateSoloMuteMatrix();
          }
        }

        document.querySelectorAll('.layer-btn').forEach(b => {
          const active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        this._lastClimateLayer = layer;
        if (this.mode === 'layers') {
          this.setObservationMode('climate');
        }

        if (layer === 'all') {
          if (this.globe) {
            this.globe.overlays.activeOverlayId = 'all';
            this.globe.overlays.setAllVisible(true);
          }
          this.updateLayerLegend('all');
        } else {
          if (this.globe) this.globe.setActiveOverlay(layer);
          this.updateLayerLegend(layer);
        }

        // Camera auto-slerp navigation: 900ms cubic-bezier(0.22, 1, 0.36, 1)
        if (this.globe && typeof this.globe.flyTo === 'function') {
          if (layer === 'sea_ice') {
            this.globe.flyTo(78.0, 0.0, 1.9, 0.9); // Arctic polar ice cap centered
          } else if (layer === 'co2') {
            this.globe.flyTo(19.53, -155.57, 1.85, 0.9); // Mauna Loa centered
          } else if (layer === 'ocean') {
            this.globe.flyTo(0.0, -140.0, 2.1, 0.9); // Equatorial Pacific centered
          } else if (layer === 'temperature') {
            this.globe.flyTo(20.0, 0.0, 2.3, 0.9); // Overview
          }
        }

        this.updateGlobeToRecordIndex(this._recordIndex);
      });
    });

    // Observation mode toggle buttons
    if (this.elements.btnModeClimate && this.elements.btnModeLayers) {
      this.elements.btnModeClimate.addEventListener('click', () => this.setObservationMode('climate'));
      this.elements.btnModeLayers.addEventListener('click', () => this.setObservationMode('layers'));
    }

    // Satellite layer switcher buttons
    document.querySelectorAll('.sat-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sat-layer-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');

        const layer = btn.getAttribute('data-layer');
        this.selectSatelliteLayer(layer);
      });
    });

    // Night lights A/B cross-fade wipe slider
    if (this.elements.nightLightsAbSlider) {
      this.elements.nightLightsAbSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.globe && this.globe.overlays) {
          this.globe.overlays.setNightLightsBlend(val);
        }
        if (this.sweepController) {
          this.sweepController.setNightLightsBlend(val);
        }
      });
    }

    // Geographic Navigation Quick-Links
    const flyMlo = document.getElementById('btn-fly-mlo');
    if (flyMlo) flyMlo.addEventListener('click', () => this.globe && this.globe.flyToMaunaLoa());

    const flyArc = document.getElementById('btn-fly-arctic');
    if (flyArc) flyArc.addEventListener('click', () => this.globe && this.globe.flyTo(85, -45, 1.9));

    const flyAnt = document.getElementById('btn-fly-antarctic');
    if (flyAnt) flyAnt.addEventListener('click', () => this.globe && this.globe.flyTo(-85, 0, 1.9));

    const resetCam = document.getElementById('btn-reset-cam');
    if (resetCam) resetCam.addEventListener('click', () => this.globe && this.globe.resetView());
  }

  /**
   * Apply one of the 4 One-Click "Sonic Story" Mission Presets.
   * @param {string} presetId - PRESET_1988_CO2 | PRESET_1998_EL_NINO | PRESET_2012_ARCTIC | PRESET_DELTA_1980_2025
   */
  async applyMissionPreset(presetId) {
    const preset = MISSION_PRESETS[presetId];
    if (!preset) return;

    if (this._presetTimer) {
      clearTimeout(this._presetTimer);
      this._presetTimer = null;
    }

    if (preset.isDelta) {
      if (this.mixer && this.mixer.isPlaying) {
        this.mixer.pause();
      }
      if (this.comparison) {
        this.comparison.open();
        this.comparison.periodA = preset.periodA;
        this.comparison.periodB = preset.periodB;
        const aStartInput = document.querySelector('#comp-a-start');
        const aEndInput = document.querySelector('#comp-a-end');
        const bStartInput = document.querySelector('#comp-b-start');
        const bEndInput = document.querySelector('#comp-b-end');
        if (aStartInput) aStartInput.value = '1980-01';
        if (aEndInput) aEndInput.value = '1980-12';
        if (bStartInput) bStartInput.value = '2025-01';
        if (bEndInput) bEndInput.value = '2025-12';
        await this.comparison.loadComparison();
        await this.comparison.audition('diff');
      }
      showToast('Playing Δ(t) = B(t) − A(t) for 1980 versus 2025', 'info', 3500);
      return;
    }

    // 1. Jump currentMonthIndex
    if (this.harmonizedData && this.harmonizedData.records) {
      const idx = this.harmonizedData.records.findIndex(r => r.date.startsWith(preset.targetDate));
      if (idx !== -1) {
        this._recordIndex = idx;
        this.updateGlobeToRecordIndex(idx);

        await this.loadAudioStemsIfNeeded();
        if (this.mixer) {
          const targetSec = (idx / this.harmonizedData.records.length) * this.mixer.duration;
          this.mixer.seek(targetSec);
          if (this.elements.seekSlider) this.elements.seekSlider.value = targetSec;
          if (!this.mixer.isPlaying) {
            this.mixer.play();
          }
        }
      }
    }

    // 2. Tween Three.js camera
    if (this.globe && preset.camera) {
      this.globe.flyTo(preset.camera.lat, preset.camera.lon, preset.camera.distance, 1.8);
    }

    // 3. Configure solo/mute states
    if (this.mixer) {
      for (const track of this.mixer.getAllTracks()) {
        const shouldSolo = preset.solos.includes(track.id);
        this.mixer.setTrackSolo(track.id, shouldSolo);
        this.mixer.setTrackMute(track.id, false);
      }
      document.querySelectorAll('.btn-mute').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.btn-solo').forEach(btn => {
        const tid = btn.getAttribute('data-track');
        btn.classList.toggle('active', preset.solos.includes(tid));
      });
      this.updateStripSilencedState();
      this.updateVisualAcousticCoupling();
    }

    // 4. Temporary solo duration (e.g. 1988 CO2 solo for 4s then full orchestra)
    if (preset.soloDurationSec && this.mixer) {
      showToast(`Event record: ${preset.name} · solo channel for 4 s`, 'info', 3000);
      this._presetTimer = setTimeout(() => {
        if (this.mixer) {
          for (const track of this.mixer.getAllTracks()) {
            this.mixer.setTrackSolo(track.id, false);
          }
        }
        document.querySelectorAll('.btn-solo').forEach(btn => btn.classList.remove('active'));
        this.updateStripSilencedState();
        this.updateVisualAcousticCoupling();
        showToast('All four observation channels restored', 'success', 3500);
      }, preset.soloDurationSec * 1000);
    } else {
      showToast(`Event record: ${preset.name}`, 'info', 3000);
    }
  }

  /**
   * Toggle observation mode ('climate' vs 'layers').
   * @param {string} mode
   */
  setObservationMode(mode) {
    this.mode = mode;
    if (mode === 'climate') {
      if (this.elements.btnModeClimate) {
        this.elements.btnModeClimate.classList.add('active');
        this.elements.btnModeClimate.setAttribute('aria-pressed', 'true');
      }
      if (this.elements.btnModeLayers) {
        this.elements.btnModeLayers.classList.remove('active');
        this.elements.btnModeLayers.setAttribute('aria-pressed', 'false');
      }
      if (this.elements.satellitePicker) {
        this.elements.satellitePicker.classList.add('hidden');
      }
      if (this.elements.orchestraGrid) {
        this.elements.orchestraGrid.classList.remove('hidden');
      }
      if (this.sweepController && this.sweepController.isPlaying) {
        this.sweepController.pause();
      }
      const activeClimate = this._lastClimateLayer || 'temperature';
      if (this.globe) this.globe.setActiveOverlay(activeClimate);
      this.updateLayerLegend(activeClimate);
      showToast('Switched to Climate Time Series mode', 'info', 2500);
    } else {
      if (this.elements.btnModeLayers) {
        this.elements.btnModeLayers.classList.add('active');
        this.elements.btnModeLayers.setAttribute('aria-pressed', 'true');
      }
      if (this.elements.btnModeClimate) {
        this.elements.btnModeClimate.classList.remove('active');
        this.elements.btnModeClimate.setAttribute('aria-pressed', 'false');
      }
      if (this.elements.satellitePicker) {
        this.elements.satellitePicker.classList.remove('hidden');
      }
      if (this.mixer && this.mixer.isPlaying) {
        this.mixer.pause();
      }
      this.selectSatelliteLayer(this.activeSatLayer || 'night_lights');
      showToast('Switched to Satellite Layers mode ("Earth Jukebox")', 'info', 2500);
    }
  }

  /**
   * Activate satellite layer by ID.
   * @param {string} layerId
   */
  selectSatelliteLayer(layerId) {
    this.activeSatLayer = layerId;
    if (this.elements.nightLightsAbContainer) {
      if (layerId === 'night_lights') {
        this.elements.nightLightsAbContainer.classList.remove('hidden');
      } else {
        this.elements.nightLightsAbContainer.classList.add('hidden');
      }
    }
    if (this.globe) {
      this.globe.setActiveOverlay(layerId);
    }
    this.loadSatelliteLayerData(layerId);
    this.updateSatelliteHud(layerId);
  }

  /**
   * Update flight-deck HUD with satellite mission metadata.
   * @param {string} layerId
   */
  updateSatelliteHud(layerId) {
    const config = getLayer(layerId);
    if (!config) return;
    if (this.elements.hudSubtitle) {
      this.elements.hudSubtitle.textContent = config.name.toUpperCase();
    }
    if (this.elements.hudVal) {
      this.elements.hudVal.textContent = config.agency || 'NASA SVS / EIC';
    }
    if (this.elements.hudMeta) {
      this.elements.hudMeta.textContent = `UNITS: ${config.units} · ${config.colormap}`;
    }
  }

  /**
   * Visual-Acoustic Coupling:
   * When a channel's Solo [S] button is active or a user hovers over a channel strip in the Bottom Dock,
   * highlight the corresponding shader overlay on the 3D Earth Globe and attenuate non-selected overlays to 25% opacity.
   */
  updateVisualAcousticCoupling() {
    if (!this.globe) return;

    const TRACK_TO_OVERLAY = {
      surface_temperature: 'temperature',
      atmospheric_co2: 'co2',
      ocean_temperature: 'ocean',
      sea_ice_extent: 'seaIce'
    };

    // Hover takes preview precedence
    if (this.hoveredTrackId) {
      const overlayKey = TRACK_TO_OVERLAY[this.hoveredTrackId];
      if (overlayKey) {
        this.globe.highlightOverlay(overlayKey);
        return;
      }
    }

    // Active Solo states
    if (this.mixer) {
      const soloed = this.mixer.getAllTracks()
        .filter(t => t.isSoloed)
        .map(t => TRACK_TO_OVERLAY[t.id])
        .filter(Boolean);

      if (soloed.length > 0) {
        this.globe.highlightOverlay(soloed);
        return;
      }
    }

    // Reset back to user's selected layer view
    this.globe.resetHighlight();
  }

  /**
   * Update visual silenced states for all channel strips in DAW mixer.
   */
  updateStripSilencedState() {
    if (!this.mixer) return;
    const all = this.mixer.getAllTracks();
    const anySolo = all.some(t => t.isSoloed);
    for (const track of all) {
      const strip = document.getElementById(`strip-${track.id}`);
      if (strip) {
        const isSilenced = track.isMuted || (anySolo && !track.isSoloed);
        strip.classList.toggle('silenced', isSilenced);
      }
    }
  }

  /**
   * Bind global keyboard shortcuts.
   */
  bindKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept when user is typing in text input
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (this.elements.btnMasterPlay) this.elements.btnMasterPlay.click();
      } else if (e.key === 'c' || e.key === 'C') {
        if (this.comparison) this.comparison.toggle();
      } else if (e.key === 'i' || e.key === 'I') {
        if (this.infoPanel) this.infoPanel.toggle();
      } else if (e.key === 'Escape') {
        if (this.comparison && this.comparison.isOpen) this.comparison.close();
        if (this.infoPanel && this.infoPanel.isOpen) this.infoPanel.close();
        if (this.specDrawer && this.specDrawer.isOpen) this.specDrawer.close();
        if (this.guidedTour && this.guidedTour.isActive) this.guidedTour.stop();
      } else if (['1', '2', '3', '4', '0'].includes(e.key)) {
        const layerMap = {
          '1': 'temperature',
          '2': 'co2',
          '3': 'ocean',
          '4': 'sea_ice',
          '0': 'all'
        };
        const layerBtn = document.querySelector(`.layer-btn[data-layer="${layerMap[e.key]}"]`);
        if (layerBtn) layerBtn.click();
      }
    });
  }
}

/**
 * Publish the fixed header's measured height as --nasa-header-h.
 *
 * Every HUD overlay offsets itself by that variable, but it was a hardcoded
 * 92px while the real two-row rail measures 116px on desktop and ~133px once
 * the command row wraps — so the HUD panels rendered underneath the header.
 */
export function syncHeaderHeightVar() {
  if (typeof document === 'undefined') return;
  const header = document.querySelector('header.mission-header');
  if (!header) return;
  const height = Math.round(header.getBoundingClientRect().height);
  if (height > 0) {
    document.documentElement.style.setProperty('--nasa-header-h', `${height}px`);
  }
}

let headerObserver = null;

/**
 * Watch the header's box instead of the window: a resize event fires before the
 * new layout settles, so measuring from it leaves the variable one breakpoint
 * stale (which is exactly how the HUD ended up underneath the header again).
 */
export function observeHeaderHeight() {
  syncHeaderHeightVar();
  if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
  const header = document.querySelector('header.mission-header');
  if (!header) return;
  if (!headerObserver) {
    headerObserver = new ResizeObserver(() => syncHeaderHeightVar());
    headerObserver.observe(header);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', syncHeaderHeightVar);
  window.addEventListener('load', observeHeaderHeight);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncHeaderHeightVar).catch(() => {});
  }
}

// Global bootstrap handler
export async function bootstrapApp() {
  if (window._earthSonicBootstrapped) return window.EarthSonicApp;
  window._earthSonicBootstrapped = true;
  observeHeaderHeight();
  const app = new EarthSonicApp();
  window.EarthSonicApp = app;
  await app.init();
  return app;
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      bootstrapApp().catch(err => console.error('[EARTHSONIC Bootstrap] Failed:', err));
    });
  } else {
    // DOM is already ready
    bootstrapApp().catch(err => console.error('[EARTHSONIC Bootstrap] Failed:', err));
  }
}
