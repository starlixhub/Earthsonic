/**
 * frontend/js/ui/dimensional_spec.js
 * Production Integration Touchpoint for enesozturk/dimensional-drawing in EARTHSONIC.
 *
 * Provides an authentic NASA Hardware Sensor Architecture Specification Drawer
 * using 2D SVG DOM rendering and 2.5D parallel oblique axonometric CAD projection.
 *
 * License: MIT (conforming to enesozturk/dimensional-drawing upstream terms)
 * Copyright (c) 2026 Enes Ozturk (Upstream Architectural CAD Engine)
 * Copyright (c) 2026 EARTHSONIC Development Team
 */

export class DimensionalSpecDrawer {
  /**
   * @param {Object} options Configuration parameters
   * @param {Object} options.globe Reference to EarthGlobe instance (globe.js)
   * @param {Object} options.mixer Reference to EarthOrchestraMixer instance (mixer.js)
   * @param {HTMLElement} [options.mountPoint=document.body] Target DOM parent
   */
  constructor(options = {}) {
    if (!options.globe) {
      console.warn('[DimensionalSpecDrawer] EarthGlobe reference not supplied. Camera coupling disabled.');
    }
    this.globe = options.globe || null;
    this.mixer = options.mixer || null;
    this.mountPoint = options.mountPoint || document.body;

    this.isOpen = false;
    this.currentSensorId = 'OCO-2';
    this.animationFrameId = null;
    this.animationStartTime = null;

    // DOM Element References
    this.container = null;
    this.viewport = null;
    this.selectEl = null;
    this.closeBtn = null;

    // Bound event handlers for clean removal
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onWindowResize = this._onWindowResize.bind(this);
    this._onSensorChange = this._onSensorChange.bind(this);

    // Sensor Mission Definitions
    this.sensors = {
      'OCO-2': {
        name: 'NASA OCO-2 High-Resolution Grating Spectrometer',
        dwgNo: 'NASA-ESON-OCO2-01',
        rev: 'C',
        coords: { lat: 19.5362, lon: -155.5763, alt: 1.85 }, // Mauna Loa Observatory
        units: 'MM',
        variables: [
          { code: 'W1', name: 'Optical Bench Width', val: '460 mm', formula: 'Nominal Cavity' },
          { code: 'H1', name: 'Cryocooler Housing Depth', val: '340 mm', formula: 'Nominal Envelope' },
          { code: 'D1', name: 'Spectrometer Slit Length', val: '12.5 mm', formula: 'Focal Plane' },
          { code: 'R1', name: 'Thermal Radiator Corner Radius', val: '16.0 mm', formula: 'Milled Edge' },
          { code: 'T1', name: 'Cold Head Thermal Margin', val: '120 K', formula: 'Active Pulse Tube' }
        ]
      },
      'MODIS-TEMP': {
        name: 'Terra/Aqua MODIS Surface Thermal Radiometer',
        dwgNo: 'NASA-ESON-MODIS-02',
        rev: 'B',
        coords: { lat: 0.0, lon: 20.0, alt: 2.1 }, // Equatorial view
        units: 'MM',
        variables: [
          { code: 'W1', name: 'Scan Mirror Aperture Width', val: '580 mm', formula: 'Primary Baffle' },
          { code: 'H1', name: 'Radiative Cooler Depth', val: '420 mm', formula: 'Passive Housing' },
          { code: 'B1', name: 'LWIR Channel Bandwidth', val: '11.0 µm', formula: '10.78 - 11.28 µm' },
          { code: 'R1', name: 'Aperture Flange Radius', val: '24.0 mm', formula: 'Mounting Ring' }
        ]
      },
      'AMSR2-ICE': {
        name: 'JAXA/NASA AMSR2 Cryospheric Microwave Radiometer',
        dwgNo: 'JAXA-ESON-AMSR2-03',
        rev: 'D',
        coords: { lat: 82.0, lon: 0.0, alt: 1.9 }, // Arctic Polar Cap
        units: 'MM',
        variables: [
          { code: 'W1', name: 'Main Reflector Diameter', val: '2000 mm', formula: 'Offset Parabolic' },
          { code: 'H1', name: 'Feedhorn Cluster Height', val: '850 mm', formula: 'Multifrequency Array' },
          { code: 'F1', name: 'Primary Sea-Ice Band', val: '89.0 GHz', formula: 'Vertical/Horiz Pol' },
          { code: 'R1', name: 'Gimbal Swivel Clearance', val: '35.0 mm', formula: 'Spin Mechanism' }
        ]
      },
      'JASON3-OHT': {
        name: 'Sentinel-6 / Jason-3 Poseidon-4 Radar Altimeter',
        dwgNo: 'ESA-NASA-JASON3-04',
        rev: 'A',
        coords: { lat: -25.0, lon: -130.0, alt: 2.2 }, // South Pacific Gyre
        units: 'MM',
        variables: [
          { code: 'W1', name: 'Dual-Frequency Antenna Width', val: '1200 mm', formula: 'Honeycomb Carbon' },
          { code: 'H1', name: 'Transceiver Electronics Depth', val: '310 mm', formula: 'Pressurized Bay' },
          { code: 'Ku', name: 'Primary Tracking Frequency', val: '13.575 GHz', formula: 'Synthetic Aperture' },
          { code: 'C',  name: 'Ionospheric Correction Band', val: '5.3 GHz', formula: 'Dual-Channel' }
        ]
      }
    };

    this._initDOM();
  }

  /**
   * Construct DOM elements and inject base stylesheet rules.
   * @private
   */
  _initDOM() {
    this.container = document.createElement('div');
    this.container.id = 'dimensional-spec-drawer';
    this.container.className = 'dimensional-spec-drawer hidden';
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-label', 'NASA Sensor Architecture Specification');
    this.container.setAttribute('aria-modal', 'true');

    this.container.style.cssText = `
      position: fixed;
      top: 3.8rem;
      left: 1.5rem;
      right: 1.5rem;
      bottom: calc(185px + 1.2rem);
      background: rgba(10, 15, 29, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      z-index: 200;
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85);
      pointer-events: auto;
    `;

    this.container.innerHTML = `
      <header class="spec-drawer-header" style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        background: #0d121f;
        user-select: none;
      ">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;"></span>
          <span style="font-family:'Space Grotesk',sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:0.08em;color:#f1f5f9;text-transform:uppercase;">
            NASA SENSOR ARCHITECTURE // DIMENSIONAL BLUEPRINT
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <label for="sensor-spec-select" style="font-family:monospace;font-size:0.75rem;color:#94a3b8;">PAYLOAD:</label>
          <select id="sensor-spec-select" style="
            background: #1e293b;
            color: #f8fafc;
            border: 1px solid #475569;
            font-family: monospace;
            font-size: 0.75rem;
            padding: 0.25rem 0.6rem;
            border-radius: 4px;
            cursor: pointer;
            outline: none;
          ">
            <option value="OCO-2">NASA OCO-2 Grating Spectrometer (CO2)</option>
            <option value="MODIS-TEMP">Terra/Aqua MODIS Surface Radiometer (Temp)</option>
            <option value="AMSR2-ICE">JAXA/NASA AMSR2 Microwave Sensor (Sea Ice)</option>
            <option value="JASON3-OHT">Sentinel-6 / Jason-3 Radar Altimeter (Ocean)</option>
          </select>
          <button id="btn-close-spec-drawer" style="
            background: transparent;
            border: 1px solid rgba(255,255,255,0.2);
            color: #cbd5e1;
            font-size: 1.1rem;
            line-height: 1;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
          " title="Close Specification Drawer (Esc)">&times;</button>
        </div>
      </header>
      <div id="spec-viewport-container" style="
        flex: 1;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 1.5rem;
        background: #05070e;
      ">
        <!-- SVG Document Injected Dynamically -->
      </div>
    `;

    this.mountPoint.appendChild(this.container);

    this.viewport = this.container.querySelector('#spec-viewport-container');
    this.selectEl = this.container.querySelector('#sensor-spec-select');
    this.closeBtn = this.container.querySelector('#btn-close-spec-drawer');

    this._bindEvents();
  }

  /**
   * Bind event listeners for DOM controls and keyboard navigation.
   * @private
   */
  _bindEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.close());
    }
    if (this.selectEl) {
      this.selectEl.addEventListener('change', this._onSensorChange);
    }
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('resize', this._onWindowResize);
  }

  _onKeyDown(e) {
    if (e.key === 'Escape' && this.isOpen) {
      this.close();
    }
  }

  _onWindowResize() {
    if (this.isOpen) {
      // Force SVG layout recalculation if needed
      const svg = this.viewport.querySelector('svg');
      if (svg) {
        svg.style.maxHeight = `${this.viewport.clientHeight - 32}px`;
      }
    }
  }

  _onSensorChange(e) {
    this.loadSensorBlueprint(e.target.value);
  }

  /**
   * Open the specification drawer and isolate 3D globe camera controls.
   * @param {string} [sensorId] Optional initial sensor ID
   */
  open(sensorId) {
    if (this.isOpen) return;
    this.isOpen = true;

    if (sensorId && this.sensors[sensorId]) {
      this.currentSensorId = sensorId;
      if (this.selectEl) this.selectEl.value = sensorId;
    }

    this.container.classList.remove('hidden');
    this.container.style.display = 'flex';

    // 1. ISOLATE ORBITCONTROLS: Prevent camera rotation during inspection
    if (this.globe && this.globe.controls) {
      this.globe.controls.enabled = false;
    }

    this.loadSensorBlueprint(this.currentSensorId);
  }

  /**
   * Close the specification drawer and restore 3D globe camera controls.
   */
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;

    this.container.classList.add('hidden');
    this.container.style.display = 'none';

    // Cancel any active animation frame
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // 2. RESTORE ORBITCONTROLS
    if (this.globe && this.globe.controls) {
      this.globe.controls.enabled = true;
    }
  }

  /**
   * Render the dimensional CAD specification sheet for a given sensor payload.
   * @param {string} sensorId
   */
  loadSensorBlueprint(sensorId) {
    const spec = this.sensors[sensorId];
    if (!spec) return;
    this.currentSensorId = sensorId;

    // Connect blueprint inspection to 3D Globe camera focus
    if (this.globe && spec.coords) {
      if (typeof this.globe.flyTo === 'function') {
        this.globe.flyTo(spec.coords.lat, spec.coords.lon, spec.coords.alt, 1.6);
      }
    }

    // Render pure SVG sheet conforming to dimensional-drawing specifications
    this.viewport.innerHTML = this._generateSheetSVG(spec);
    this._onWindowResize();
  }

  /**
   * Procedural SVG CAD Generator conforming to dimensional-drawing rules.
   * @private
   * @param {Object} spec Sensor specification metadata
   * @returns {string} Raw SVG XML string
   */
  _generateSheetSVG(spec) {
    // 2.5D Affine oblique transformation constants from enesozturk/dimensional-drawing
    const sc = 0.45, TX = 360, TY = 620, gap = 48;
    const ia = 0.94 * sc, ib = 0.17 * sc, ic = -0.34 * sc, id = 0.47 * sc;

    // Determinant stroke invariant compensation factor --u
    const det = Math.abs(ia * id - ib * ic);
    const u = 1 / Math.sqrt(det);

    // Format variable table rows
    let tableRows = '';
    spec.variables.forEach((v, idx) => {
      const y = 230 + idx * 24;
      tableRows += `
        <text x="1140" y="${y}" font-family="monospace" font-size="11" font-weight="700" fill="#111">${v.code}</text>
        <text x="1190" y="${y}" font-family="monospace" font-size="10" fill="#333">${v.name}</text>
        <text x="1440" y="${y}" font-family="monospace" font-size="10" font-weight="600" fill="#000">${v.val}</text>
        <text x="1530" y="${y}" font-family="monospace" font-size="9" fill="#666">${v.formula}</text>
        <line x1="1130" y1="${y + 6}" x2="1620" y2="${y + 6}" stroke="#e2e8f0" stroke-width="0.8" />
      `;
    });

    return `
      <svg id="dw-sheet-svg" viewBox="0 0 1700 1060" style="
        width: 100%;
        max-width: 1360px;
        height: auto;
        background: #ffffff;
        border-radius: 6px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
        display: block;
        --u: ${u.toFixed(4)};
      " xmlns="http://www.w3.org/2000/svg">
        <defs>
          <!-- Architectural Arrowhead Marker -->
          <marker id="dwar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#111111" />
          </marker>
          <!-- 45-degree CAD Hatch Pattern -->
          <pattern id="cad-hatch" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#cbd5e1" stroke-width="1.2" />
          </pattern>
        </defs>

        <!-- Outer Sheet Border & Coordinate Grid Frame -->
        <rect x="24" y="24" width="1652" height="1012" rx="10" fill="none" stroke="#111111" stroke-width="1.8" />
        <rect x="28" y="28" width="1644" height="1004" rx="8" fill="none" stroke="#64748b" stroke-width="0.6" stroke-dasharray="8 4" />

        <!-- Title Block (Upper Left Quadrant) -->
        <rect x="48" y="48" width="520" height="136" fill="#f8fafc" stroke="#111111" stroke-width="1.4" />
        <line x1="48" y1="96" x2="568" y2="96" stroke="#111111" stroke-width="0.8" />
        <text x="64" y="76" font-family="'Space Grotesk', Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="0.05em" fill="#111111">
          ${spec.name.toUpperCase()}
        </text>
        <text x="64" y="118" font-family="monospace" font-size="11" fill="#333333">
          DWG NO: ${spec.dwgNo} · REV ${spec.rev} · UNITS: ${spec.units}
        </text>
        <text x="64" y="136" font-family="monospace" font-size="10" fill="#666666">
          CLASSIFICATION: UNRESTRICTED NASA SCIENTIFIC TELEMETRY
        </text>
        <text x="64" y="164" font-family="monospace" font-size="9" fill="#0f172a" font-weight="600">
          HOUSE RULE: MONOCHROME CAD; SYMBOLIC VARIABLES; DO NOT SCALE
        </text>

        <!-- Quadrant 1: 2D Orthographic Plan View -->
        <g id="orthographic-plan">
          <text x="600" y="70" font-family="monospace" font-size="12" font-weight="700" fill="#111111">VIEW A · TOP PLAN (SCALE 1.0)</text>
          
          <!-- Outer Chassis Outline -->
          <rect x="600" y="88" width="460" height="340" rx="16" fill="none" stroke="#111111" stroke-width="1.6" />
          
          <!-- Inset Optical Cavity / Detector Well -->
          <rect x="650" y="138" width="360" height="240" rx="8" fill="url(#cad-hatch)" stroke="#111111" stroke-width="1.0" />
          
          <!-- Focal Slot / Aperture Array -->
          <line x1="680" y1="258" x2="980" y2="258" stroke="#111111" stroke-width="0.8" stroke-dasharray="4 3" />
          <circle cx="830" cy="258" r="4.5" fill="#111111" />
          
          <!-- Horizontal Dimension Line W1 -->
          <line x1="600" y1="56" x2="600" y2="82" stroke="#64748b" stroke-width="0.75" />
          <line x1="1060" y1="56" x2="1060" y2="82" stroke="#64748b" stroke-width="0.75" />
          <line x1="600" y1="62" x2="1060" y2="62" stroke="#111111" stroke-width="0.8" marker-start="url(#dwar)" marker-end="url(#dwar)" />
          <rect x="804" y="52" width="52" height="18" fill="#ffffff" />
          <text x="830" y="65" font-family="monospace" font-size="11" font-weight="700" text-anchor="middle" fill="#111111">W1</text>

          <!-- Vertical Dimension Line H1 -->
          <line x1="1068" y1="88" x2="1094" y2="88" stroke="#64748b" stroke-width="0.75" />
          <line x1="1068" y1="428" x2="1094" y2="428" stroke="#64748b" stroke-width="0.75" />
          <line x1="1086" y1="88" x2="1086" y2="428" stroke="#111111" stroke-width="0.8" marker-start="url(#dwar)" marker-end="url(#dwar)" />
          <rect x="1076" y="248" width="20" height="22" fill="#ffffff" />
          <text x="1086" y="263" font-family="monospace" font-size="11" font-weight="700" text-anchor="middle" fill="#111111" transform="rotate(-90 1086 263)">H1</text>

          <!-- Radial Callout R1 -->
          <path d="M 616 104 L 560 64 L 510 64" fill="none" stroke="#111111" stroke-width="0.8" marker-start="url(#dwar)" />
          <text x="500" y="60" font-family="monospace" font-size="10" font-weight="700" text-anchor="end" fill="#111111">R1 TYP</text>
        </g>

        <!-- Quadrant 2: Variable Specifications Table -->
        <g id="spec-table">
          <rect x="1120" y="160" width="520" height="280" fill="#fafafa" stroke="#111111" stroke-width="1.2" />
          <rect x="1120" y="160" width="520" height="38" fill="#f1f5f9" stroke="#111111" stroke-width="0.8" />
          <text x="1140" y="184" font-family="'Space Grotesk', sans-serif" font-size="12" font-weight="700" fill="#0f172a">VARIABLE SPECIFICATIONS TABLE</text>
          <text x="1140" y="210" font-family="monospace" font-size="9" font-weight="700" fill="#64748b">CODE</text>
          <text x="1190" y="210" font-family="monospace" font-size="9" font-weight="700" fill="#64748b">PARAMETER NAME</text>
          <text x="1440" y="210" font-family="monospace" font-size="9" font-weight="700" fill="#64748b">VALUE</text>
          <text x="1530" y="210" font-family="monospace" font-size="9" font-weight="700" fill="#64748b">FORMULA / NOTES</text>
          <line x1="1120" y1="216" x2="1640" y2="216" stroke="#cbd5e1" stroke-width="1.0" />
          ${tableRows}
        </g>

        <!-- Quadrant 3 & 4: 2.5D Parallel Oblique Axonometric Exploded View -->
        <g id="axonometric-exploded-view">
          <text x="80" y="490" font-family="monospace" font-size="12" font-weight="700" fill="#111111">
            VIEW B · 2.5D AXONOMETRIC EXPLODED LAYER STACK (PARALLEL OBLIQUE)
          </text>

          <!-- Layer 0: Viewport Ground Footprint -->
          <g transform="matrix(${ia.toFixed(5)}, ${ib.toFixed(5)}, ${ic.toFixed(5)}, ${id.toFixed(5)}, ${TX}, ${TY})">
            <rect x="0" y="0" width="460" height="340" rx="16" fill="none" stroke="#94a3b8" stroke-width="calc(1.2px * var(--u))" stroke-dasharray="calc(6px * var(--u)) calc(4px * var(--u))" />
            <text x="230" y="170" font-family="monospace" font-size="18" text-anchor="middle" fill="#94a3b8">L0 · GROUND DATUM</text>
          </g>

          <!-- Layer 1: Thermal Radiator Scrim (Elevated -1 * gap) -->
          <g transform="matrix(${ia.toFixed(5)}, ${ib.toFixed(5)}, ${ic.toFixed(5)}, ${id.toFixed(5)}, ${TX}, ${TY - gap * 1})">
            <rect x="20" y="20" width="420" height="300" rx="12" fill="url(#cad-hatch)" stroke="#475569" stroke-width="calc(1.2px * var(--u))" />
            <text x="40" y="60" font-family="monospace" font-size="14" font-weight="700" fill="#334155">L1 · THERMAL SCRIM</text>
          </g>

          <!-- Layer 2: Main Chassis Enclosure (Elevated -2 * gap) -->
          <g transform="matrix(${ia.toFixed(5)}, ${ib.toFixed(5)}, ${ic.toFixed(5)}, ${id.toFixed(5)}, ${TX}, ${TY - gap * 2})">
            <rect x="0" y="0" width="460" height="340" rx="16" fill="#ffffff" fill-opacity="0.85" stroke="#111111" stroke-width="calc(1.6px * var(--u))" />
            <text x="40" y="60" font-family="monospace" font-size="14" font-weight="700" fill="#111111">L2 · MAIN CHASSIS</text>
          </g>

          <!-- Layer 3: Optical Bench & Spectrometer Well (Elevated -3 * gap) -->
          <g transform="matrix(${ia.toFixed(5)}, ${ib.toFixed(5)}, ${ic.toFixed(5)}, ${id.toFixed(5)}, ${TX}, ${TY - gap * 3})">
            <rect x="50" y="50" width="360" height="240" rx="8" fill="#f8fafc" stroke="#111111" stroke-width="calc(1.4px * var(--u))" />
            <line x1="80" y1="170" x2="380" y2="170" stroke="#111111" stroke-width="calc(1.0px * var(--u))" stroke-dasharray="calc(4px * var(--u)) calc(3px * var(--u))" />
            <circle cx="230" cy="170" r="6" fill="#111111" />
            <text x="70" y="90" font-family="monospace" font-size="14" font-weight="700" fill="#111111">L3 · OPTICAL BENCH</text>
          </g>

          <!-- Layer 4: Cryocooler & Sensor Array (Elevated -4 * gap) -->
          <g transform="matrix(${ia.toFixed(5)}, ${ib.toFixed(5)}, ${ic.toFixed(5)}, ${id.toFixed(5)}, ${TX}, ${TY - gap * 4})">
            <rect x="120" y="90" width="220" height="160" rx="6" fill="#ffffff" stroke="#111111" stroke-width="calc(1.8px * var(--u))" />
            <circle cx="230" cy="170" r="28" fill="none" stroke="#111111" stroke-width="calc(1.2px * var(--u))" />
            <text x="140" y="130" font-family="monospace" font-size="13" font-weight="700" fill="#111111">L4 · CRYO SENSOR</text>
          </g>

          <!-- Exploded Stack Alignment Leader Lines -->
          <line x1="${TX}" y1="${TY}" x2="${TX}" y2="${TY - gap * 4}" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="3 3" />
          <line x1="${TX + ia * 460}" y1="${TY + ib * 460}" x2="${TX + ia * 460}" y2="${TY + ib * 460 - gap * 4}" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="3 3" />
        </g>

        <!-- Technical Specification Notes Block -->
        <g id="engineering-notes" transform="translate(1120, 500)">
          <rect x="0" y="0" width="520" height="200" fill="#f8fafc" stroke="#111111" stroke-width="1.0" />
          <text x="20" y="28" font-family="'Space Grotesk', sans-serif" font-size="11" font-weight="700" fill="#111111">GENERAL ENGINEERING NOTES</text>
          <text x="20" y="52" font-family="monospace" font-size="9" fill="#333333">1. ALL DIMENSIONS APPLY TO UNCOATED ALUMINUM FLANGES.</text>
          <text x="20" y="70" font-family="monospace" font-size="9" fill="#333333">2. GEOMETRIC TOLERANCING CONFORMS TO ASME Y14.5M-2024.</text>
          <text x="20" y="88" font-family="monospace" font-size="9" fill="#333333">3. SURFACES MARKED WITH HATCH REPRESENT CRITICAL HEAT RADIATORS.</text>
          <text x="20" y="106" font-family="monospace" font-size="9" fill="#333333">4. MAXIMUM ALLOWABLE OUTGASSING: TML &lt; 1.0%, CVCM &lt; 0.1%.</text>
          <text x="20" y="124" font-family="monospace" font-size="9" fill="#333333">5. SONIFICATION CHANNEL MAPPED VIA STRAUSS SYNTHESIS ENGINE.</text>
          <text x="20" y="152" font-family="monospace" font-size="9" font-weight="700" fill="#0f172a">
            EARTHSONIC WORKSTATION · FLIGHT DECK CAD SUBSYSTEM
          </text>
        </g>
      </svg>
    `;
  }

  /**
   * Complete memory cleanup and event listener teardown.
   */
  destroy() {
    this.close();

    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('resize', this._onWindowResize);

    if (this.selectEl) {
      this.selectEl.removeEventListener('change', this._onSensorChange);
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    this.container = null;
    this.viewport = null;
    this.selectEl = null;
    this.closeBtn = null;
    this.globe = null;
    this.mixer = null;
  }
}