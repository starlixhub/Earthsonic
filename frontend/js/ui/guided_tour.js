/**
 * frontend/js/ui/guided_tour.js
 * Autonomous Guided Mission & Cinematic Presentation Engine for NASA Space Apps Judges.
 * EARTHSONIC: The Earth Information Jukebox
 *
 * Coordinates:
 *   - Autonomous 5-chapter planetary narrative
 *   - Three.js camera flyTo transitions & coordinates
 *   - Audio orchestra playhead jumps, solo isolations, and un-mutes
 *   - Floating glass aerospace Mission Director HUD card
 *   - Interactive chapter skip, pause, and exit controls
 */

export const TOUR_CHAPTERS = [
  {
    id: 'ch1_baseline',
    chapterNum: 1,
    title: '1979 Baseline · Satellite-era reference',
    targetDate: '1980-01',
    camera: { lat: 20.0, lon: 0.0, distance: 2.3 },
    overlay: 'temperature',
    solos: ['surface_temperature'],
    durationSec: 9,
    narrative: 'January 1980. GISTEMP is still near the 1951–1980 climatology. September Arctic ice remains above 7 million km². Mauna Loa CO₂ is about 338 ppm, with a clear seasonal cycle from Northern Hemisphere photosynthesis.'
  },
  {
    id: 'ch2_co2_breach',
    chapterNum: 2,
    title: '1988 350ppm · Mauna Loa Keeling Threshold',
    targetDate: '1988-01',
    camera: { lat: 19.53, lon: -155.57, distance: 1.85 },
    overlay: 'co2',
    solos: ['atmospheric_co2'],
    durationSec: 9,
    narrative: 'The Keeling Curve at Mauna Loa Observatory reaches the 350 ppm region often cited as a long-term stability threshold. STRAUSS maps that rise as increasing harmonic saturation on the carbon-dioxide channel.'
  },
  {
    id: 'ch3_el_nino',
    chapterNum: 3,
    title: '1998 Super El Niño · Equatorial Pacific Warm Pool',
    targetDate: '1997-11',
    camera: { lat: 0.0, lon: -140.0, distance: 2.1 },
    overlay: 'ocean',
    solos: ['ocean_temperature'],
    durationSec: 9,
    narrative: 'A strong El Niño redistributes equatorial Pacific heat into the atmosphere. Ocean-heat sonification opens a Butterworth low-pass filter as NOAA sea-surface temperature anomalies climb, while GISTEMP records the global surface response.'
  },
  {
    id: 'ch4_arctic_collapse',
    chapterNum: 4,
    title: '2012 Arctic Minimum · Record Sea Ice Low',
    targetDate: '2012-09',
    camera: { lat: 82.0, lon: 0.0, distance: 1.85 },
    overlay: 'sea_ice',
    solos: ['sea_ice_extent'],
    durationSec: 9,
    narrative: 'NSIDC reports a satellite-era September minimum near 3.4 million km². As extent falls, the ice channel crossfades from high, sparse chimes into broadband wind noise that stands in for open water.'
  },
  {
    id: 'ch5_modern_climax',
    chapterNum: 5,
    title: '2026 Present · Coupled Biosphere Climax',
    targetDate: '2024-06',
    camera: { lat: 15.0, lon: 45.0, distance: 2.2 },
    overlay: 'all',
    solos: ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent'],
    durationSec: 9,
    narrative: 'Global surface anomalies exceed +1.4 °C relative to 1951–1980, and Mauna Loa CO₂ is above 420 ppm. All four verified NASA and NOAA records play together so the ear can hear the coupled Earth system.'
  }
];

export class GuidedMissionTour {
  /**
   * @param {Object} options
   * @param {Object} options.app Reference to EarthSonicApp instance
   * @param {Object} options.globe Reference to EarthGlobe instance
   * @param {Object} options.mixer Reference to EarthOrchestraMixer instance
   */
  constructor(options = {}) {
    this.app = options.app || null;
    this.globe = options.globe || null;
    this.mixer = options.mixer || null;

    this.isActive = false;
    this.isPaused = false;
    this.currentChapterIndex = 0;
    this.chapterTimer = null;
    this.progressInterval = null;
    this.chapterElapsedMs = 0;

    this.dom = {
      card: null,
      chapterBadge: null,
      title: null,
      narrative: null,
      progressBar: null,
      btnPrev: null,
      btnPause: null,
      btnNext: null,
      btnExit: null
    };

    this._initDom();
  }

  _initDom() {
    let card = document.getElementById('mission-tour-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'mission-tour-card';
      card.className = 'mission-tour-card hidden';
      card.innerHTML = `
        <div class="tour-card-header">
          <div class="tour-badge-row">
            <span class="tour-badge-pill" id="tour-chapter-badge">CHAPTER 1 OF 5</span>
            <span class="tour-status-tag">Earth Observatory briefing</span>
          </div>
          <button class="tour-close-btn" id="tour-btn-exit" title="End briefing">&times;</button>
        </div>
        <div class="tour-card-body">
          <div class="tour-title" id="tour-chapter-title">1980 · Satellite-era baseline</div>
          <div class="tour-narrative" id="tour-narrative-text"></div>
        </div>
        <div class="tour-card-footer">
          <div class="tour-progress-wrap">
            <div class="tour-progress-bar" id="tour-progress-bar"></div>
          </div>
          <div class="tour-controls">
            <button class="tour-ctrl-btn" id="tour-btn-prev" title="Previous chapter">Previous</button>
            <button class="tour-ctrl-btn" id="tour-btn-pause" title="Pause or resume briefing">Pause</button>
            <button class="tour-ctrl-btn" id="tour-btn-next" title="Next chapter">Next</button>
          </div>
        </div>
      `;
      document.body.appendChild(card);
    }

    this.dom.card = card;
    this.dom.chapterBadge = document.getElementById('tour-chapter-badge');
    this.dom.title = document.getElementById('tour-chapter-title');
    this.dom.narrative = document.getElementById('tour-narrative-text');
    this.dom.progressBar = document.getElementById('tour-progress-bar');
    this.dom.btnPrev = document.getElementById('tour-btn-prev');
    this.dom.btnPause = document.getElementById('tour-btn-pause');
    this.dom.btnNext = document.getElementById('tour-btn-next');
    this.dom.btnExit = document.getElementById('tour-btn-exit');

    // Bind controls
    if (this.dom.btnPrev) {
      this.dom.btnPrev.addEventListener('click', () => this.previousChapter());
    }
    if (this.dom.btnPause) {
      this.dom.btnPause.addEventListener('click', () => this.togglePause());
    }
    if (this.dom.btnNext) {
      this.dom.btnNext.addEventListener('click', () => this.nextChapter());
    }
    if (this.dom.btnExit) {
      this.dom.btnExit.addEventListener('click', () => this.stop());
    }
  }

  /**
   * Start autonomous guided tour from Chapter 1.
   */
  async start() {
    this.isActive = true;
    this.isPaused = false;
    this.currentChapterIndex = 0;
    this.dom.card.classList.remove('hidden');

    if (this.mixer) {
      await this.mixer.ensureAudioContext();
      if (!this.mixer.isPlaying) {
        await this.mixer.play();
      }
    }

    await this._playChapter(this.currentChapterIndex);
  }

  /**
   * Stop tour and restore standard free-exploration mode.
   */
  stop() {
    this.isActive = false;
    this.isPaused = false;
    this._clearTimers();
    if (this.dom.card) {
      this.dom.card.classList.add('hidden');
    }

    // Reset solos
    if (this.mixer) {
      for (const track of this.mixer.getAllTracks()) {
        track.isSoloed = false;
      }
      this.mixer.updateMuteSoloState();
    }

    // Restore temperature overlay
    if (this.globe && typeof this.globe.setActiveOverlay === 'function') {
      this.globe.setActiveOverlay('temperature');
    }

    // Restore globe auto-rotation
    if (this.globe && this.globe.controls) {
      this.globe.controls.autoRotate = false;
    }
  }

  togglePause() {
    if (!this.isActive) return;
    this.isPaused = !this.isPaused;
    if (this.dom.btnPause) {
      this.dom.btnPause.textContent = this.isPaused ? 'Resume' : 'Pause';
    }
    if (this.globe && this.globe.controls) {
      this.globe.controls.autoRotate = !this.isPaused;
    }
    if (this.mixer) {
      if (this.isPaused) this.mixer.pause();
      else this.mixer.play();
    }
  }

  async nextChapter() {
    if (this.currentChapterIndex < TOUR_CHAPTERS.length - 1) {
      this.currentChapterIndex++;
      await this._playChapter(this.currentChapterIndex);
    } else {
      this.stop();
    }
  }

  async previousChapter() {
    if (this.currentChapterIndex > 0) {
      this.currentChapterIndex--;
      await this._playChapter(this.currentChapterIndex);
    }
  }

  async _playChapter(index) {
    this._clearTimers();
    this.chapterElapsedMs = 0;
    const ch = TOUR_CHAPTERS[index];
    if (!ch) return;

    // Update Card UI
    if (this.dom.chapterBadge) {
      this.dom.chapterBadge.textContent = `CHAPTER ${ch.chapterNum} OF 5`;
    }
    if (this.dom.title) {
      this.dom.title.textContent = ch.title;
    }
    if (this.dom.narrative) {
      this.dom.narrative.textContent = ch.narrative;
    }
    if (this.dom.progressBar) {
      this.dom.progressBar.style.setProperty('--meter-fill', '0');
    }

    // 1. Jump timeline to chapter target date
    if (this.app && this.app.harmonizedData && this.app.harmonizedData.records) {
      const records = this.app.harmonizedData.records;
      const recIdx = records.findIndex(r => r.date.startsWith(ch.targetDate));
      if (recIdx !== -1) {
        if (this.app.elements.slider) this.app.elements.slider.value = recIdx;
        this.app.updateGlobeToRecordIndex(recIdx);

        // Sync audio seek position
        if (this.mixer && this.mixer.duration > 0) {
          const seekTime = (recIdx / records.length) * this.mixer.duration;
          this.mixer.seek(seekTime);
        }
      }
    }

    // 2. Camera flyTo & Auto-Rotate
    if (this.globe && typeof this.globe.flyTo === 'function') {
      this.globe.flyTo(ch.camera.lat, ch.camera.lon, ch.camera.distance, 2.2);
    }
    if (this.globe && this.globe.controls) {
      this.globe.controls.autoRotate = true;
      this.globe.controls.autoRotateSpeed = 0.8;
    }

    // 3. Switch overlay
    if (this.globe && typeof this.globe.setActiveOverlay === 'function') {
      this.globe.setActiveOverlay(ch.overlay);
    }

    // 4. Configure solos
    if (this.mixer) {
      for (const track of this.mixer.getAllTracks()) {
        track.isSoloed = ch.solos.includes(track.id);
      }
      this.mixer.updateMuteSoloState();
    }

    // 5. Update bottom channel strip solo buttons visually
    document.querySelectorAll('.btn-solo').forEach(btn => {
      const trackId = btn.getAttribute('data-track');
      btn.classList.toggle('active', ch.solos.includes(trackId));
    });

    // 6. Progress ticker
    const durationMs = ch.durationSec * 1000;
    const tickInterval = 100;
    this.progressInterval = setInterval(() => {
      if (!this.isPaused) {
        this.chapterElapsedMs += tickInterval;
        const pct = Math.min(100, (this.chapterElapsedMs / durationMs) * 100);
        if (this.dom.progressBar) {
          this.dom.progressBar.style.setProperty('--meter-fill', String(pct / 100));
        }
      }
    }, tickInterval);

    // 7. Auto advance timer
    this.chapterTimer = setTimeout(async () => {
      if (this.isActive && !this.isPaused) {
        await this.nextChapter();
      }
    }, durationMs);
  }

  _clearTimers() {
    if (this.chapterTimer) {
      clearTimeout(this.chapterTimer);
      this.chapterTimer = null;
    }
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }
}
