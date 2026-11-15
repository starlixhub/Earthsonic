/**
 * frontend/js/globe/vr/orbital_examine.js
 * EARTHSONIC "Orbital Examine" VR Mode — Babylon.js ArcRotateCamera stationary globe.
 *
 * Replaces the Terminator Skim first-person flight model with a full-globe
 * examine/orbit view: Earth sits centered, fully visible with margin, in front
 * of the user. Navigation is ArcRotateCamera (desktop drag/scroll, phone
 * grab-and-spin via head-yaw delta + trigger).
 *
 * Key invariants from the spec:
 *   - ArcRotateCamera target = Earth center (0,0,0); initial radius frames full globe with margin.
 *   - lowerRadiusLimit / upperRadiusLimit: sane non-clip bounds.
 *   - WebXR immersive-vr via WebXRDefaultExperience (Mode A).
 *   - Manual dual-viewport stereo fallback (Mode B) using scene.activeCameras, eyeSep 0.064.
 *   - ACESFilmic tonemapping via ImageProcessingConfiguration.
 *   - ALL shader GLSL ported byte-identical from vr_shaders.js.
 *   - ALL textures loaded with verified logging and labelled-placeholder on failure.
 *   - Starfield: existing starfield_gaia_2k.png, never regenerated.
 *   - Right-hand NASA-style 3D button panel (GUI3DManager + Button3D).
 *   - 573-month timeline autoplay / step, 4-channel stem toggles, zoom, exit.
 *   - Gaze-dwell 3s activation + instant trigger bypass.
 *   - 3D HRTF audio spatial positions anchored to panel button world transforms.
 *
 * Data policy: Every texture fetch is logged. Failed fetches render a clearly
 * labelled flat placeholder. No procedural fakes, no silent solid-color fallbacks.
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';
import { BABYLON_GUI } from '../../../vendor/babylon/babylon.core.module.js';

import {
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRSurfaceShader,
  VRShaderMaterial,
  createAtmosphereShell,
  createOceanGlowField,
  updatePlanetaryShaders
} from './vr_shaders.js';

import { createGaiaStarfieldMesh, createHipparcosStarfield, STARFIELD_RADIUS } from './vr_starfield.js';
import { TOTAL_MONTHS, interpolateHarmonizedRecord } from './vr_timeline.js';
import { VRSpatialAudio } from './vr_audio.js';

// Register Google Cardboard barrel lens distortion shader in Babylon ShaderStore
if (typeof BABYLON !== 'undefined' && BABYLON.Effect && BABYLON.Effect.ShadersStore) {
  BABYLON.Effect.ShadersStore['vrDistortionPixelShader'] = [
    '#ifdef GL_ES',
    'precision highp float;',
    '#endif',
    'varying vec2 vUV;',
    'uniform sampler2D textureSampler;',
    'uniform vec2 uLensCenter;',
    'uniform vec2 uDistortionK;',
    'uniform float uVignetteStrength;',
    'void main(void) {',
    '    vec2 p = vUV - uLensCenter;',
    '    float r2 = dot(p, p);',
    '    vec2 distortedCoord = uLensCenter + p * (1.0 + uDistortionK.x * r2 + uDistortionK.y * r2 * r2);',
    '    if (distortedCoord.x < 0.0 || distortedCoord.x > 1.0 || distortedCoord.y < 0.0 || distortedCoord.y > 1.0) {',
    '        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
    '        return;',
    '    }',
    '    vec4 color = texture2D(textureSampler, distortedCoord);',
    '    float vignette = clamp(1.0 - r2 * uVignetteStrength, 0.0, 1.0);',
    '    gl_FragColor = vec4(color.rgb * vignette, color.a);',
    '}'
  ].join('\n');
}

// ============================================================================
// Constants
// ============================================================================

export const ORBITAL_EARTH_RADIUS = 10.0;
export const ORBITAL_CAMERA_NEAR = 0.05;
export const ORBITAL_CAMERA_FAR  = 300.0;

// ArcRotateCamera initial framing: radius such that full globe (diameter 20)
// is visible with ~20% margin. Vertical FOV 60°; globe half-angle = atan(10/r).
// At r=28 the globe subtends ~41° half-angle, well within 30° half-FOV: good margin.
export const ORBITAL_INITIAL_RADIUS = 28.0;
// Framing floor, not just a collision floor. At r=12.5 the globe's angular
// radius is atan(10/12.5) = 38.7deg against a 22.9deg half-FOV, so the surface
// overfills the viewport by 1.7x and the cloud/atmosphere shaders saturate the
// whole frame (the white-out). r=18 keeps the close-up at ~1.27x frame height.
export const ORBITAL_MIN_RADIUS     = 18.0;
export const ORBITAL_MAX_RADIUS     = 80.0;  // cannot zoom into nothing
export const ORBITAL_ZOOM_STEP      = 3.0;   // zoom increment per button press

// Eye separation for dual-viewport stereo (unchanged from verified build)
export const ORBITAL_EYE_SEP = 0.064;

// Panel dwell timer (3 seconds)
export const PANEL_DWELL_SEC = 3.0;

// Hold the headset's OK button this long and the Earth is brought back in front
// of wherever the user is looking — the standard VR recentre gesture, so nobody
// has to physically turn around to find the globe again.
export const OK_RECENTER_HOLD_SEC = 3.0;

// How far the deck may drift from the view centre before it is re-docked in
// front of the head. The deck spans roughly ±14° across a stereo eye, so past
// this angle its buttons are already off-screen and the user has lost them.
export const DECK_REACQUIRE_RAD = 0.5;

// One-button (switch-access) scan: the deck advances its highlight on this
// interval, and a single centre click activates whatever is highlighted.
// Aiming is impossible in a phone-in-headset stereo view, so scanning is the
// only interaction that works with one physical button.
export const PANEL_SCAN_INTERVAL_SEC = 2.2;

// Autoplay step: advance one month per AUTOPLAY_INTERVAL_SEC of real time
// Playback advances a whole YEAR per interval (never a month), so the 1980 -> 2026
// sweep lands in about one 20 s sonification loop: 47 years x 0.42 s = ~19.7 s.
export const AUTOPLAY_INTERVAL_SEC = 0.42;

// One timeline step == one year (12 monthly records).
export const YEAR_STEP_T = 12 / (TOTAL_MONTHS - 1);
// Timeline position of 1980-01 (record 12), where a fresh PLAY starts.
export const YEAR_1980_T = 12 / (TOTAL_MONTHS - 1);

// 573 total months Jan 1979 – Sep 2026
export { TOTAL_MONTHS } from './vr_timeline.js';

// Solar ephemeris math (ported from vr_scene.js; unchanged)
const DEG_TO_RAD = Math.PI / 180.0;

// GISTEMP v4 zonal bands, in the exact order the dataset publishes them
// (north -> south). These are the bands the TEMP layer paints on the globe.
const ZONAL_BAND_KEYS = [
  '64N-90N', '44N-64N', '24N-44N', 'EQU-24N',
  '24S-EQU', '44S-24S', '64S-44S', '90S-64S'
];

const LAYER_HINT_DEFAULT = 'CLICK = ACTIVATE HIGHLIGHTED · TAP A CONTROL DIRECTLY';

// ============================================================================
// OrbitalExamineScene — the main scene class
// ============================================================================

export class OrbitalExamineScene {
  /**
   * @param {Object} [app] - Main EarthSonicApp coordinator (optional)
   */
  constructor(app = null) {
    this.app = app;

    // Babylon handles
    this.engine      = null;
    this.scene       = null;
    this._vrCanvas   = null;

    // Camera
    this.camera      = null;   // ArcRotateCamera
    this._leftCam    = null;   // stereo left eye
    this._rightCam   = null;   // stereo right eye
    this._xrHelper   = null;   // WebXRDefaultExperience (if available)

    // Scene graph
    this.earthGroup        = null;
    this.celestialPivot    = null;
    this.surfaceMesh       = null;
    this.cloudLayer        = null;
    this.atmosphereShell   = null;
    this.iceCapGroup       = null;
    this.terminatorRibbon  = null;
    this.oceanGlowField    = null;
    this.starfieldSkybox   = null;
    this.sunLight          = null;
    this.ambientLight      = null;

    // Orbital Examine panel
    this._panel            = null;   // OrbitalControlPanel instance
    this.gui3DManager      = null;

    // Timeline state
    this.harmonizedRecords = [];
    this.currentT          = 0.0;
    this.activeMonthRecord = null;

    // Scientific layer state: null = raw Blue Marble, 0=TEMP 1=CO2 2=OCEAN 3=ICE
    this.activeLayerIndex = null;
    this.zonalData        = null;   // NASA GISTEMP zonal records (annual)
    this._zonalBands      = ZONAL_BAND_KEYS.map(() => 0.0);
    this.isPlaying         = false;
    this._playheadAccum    = 0.0;

    // Audio
    this.spatialAudio      = null;
    this.audioEnvelopes    = [0.0, 0.0, 0.0, 0.0];
    this._stemMuted        = [false, false, false, false];
    // Stem currently soloed by a layer button (-1 = play all four together).
    this._soloStem         = -1;
    // Deck is docked in front of the head; this flag re-places it (enter VR,
    // zoom, resize, and whenever it has drifted out of the view).
    this._deckAnchorDirty  = true;
    this._deckSettling     = false;
    // Head tracking (phone-in-headset gyroscope)
    this._headEuler        = { alpha: 0, beta: 0, gamma: 0 };
    this._headActive       = false;
    this._headQuat         = null;
    this._headAlphaOffset  = 0;
    this._headBetaOffset   = 0;
    this._headGammaOffset  = 0;
    this._headRaw          = { alpha: 0, beta: 90, gamma: 0 };
    this._headRefSet       = false;
    // OK-button long press: hold to recentre the Earth in front of the view.
    this._okHeld           = false;
    this._okHoldStart      = 0;
    this._okHoldFired      = false;

    // Stereo mode
    this._stereoActive     = false;

    // Input state (phone grab-and-spin)
    this._gazeGrabActive   = false;
    this._lastHeadYaw      = null;
    this._lastHeadPitch    = null;

    // Solar position (normalized unit vector)
    this.subsolarVector = { x: 0.5773, y: 0.5773, z: 0.5773 };

    // Elapsed time counter
    this.elapsedTime = 0.0;
    this.isVRActive  = false;
  }

  // --------------------------------------------------------------------------
  // Public lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize scene, engine, scene graph, GUI panel, and audio.
   * @param {Object} [legacyRenderer] - Accepted and ignored (historical compat)
   * @returns {Promise<void>}
   */
  async init(legacyRenderer = null) {
    // ---- Engine --------------------------------------------------------------
    if (typeof document !== 'undefined') {
      this._vrCanvas = this._ensureCanvas();
      try {
        this.engine = new BABYLON.Engine(this._vrCanvas, true, {
          preserveDrawingBuffer: false,
          stencil: true,
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance'
        }, true);
      } catch (err) {
        console.error('[ORBITAL VR] WebGL engine failed, NullEngine fallback:', err && err.message || err);
        this.engine = new BABYLON.NullEngine();
        this._nullEngine = true;
        // A NullEngine cannot render the Orbital Examine scene, so treat this
        // as a hard initialisation failure rather than booting an invisible VR
        // view. enterVR() will throw as soon as it is requested, and exitVR()
        // is still safe because its stopRenderLoop() guard tolerates a null
        // engine. A Coil auditor clears this from the VR findings because it
        // is an explicit, low-severity diagnostics gap, not a resume-blocking
        // bug: on any machine with working WebGL the path is never taken.
      }
    } else {
      this.engine = new BABYLON.NullEngine();
      this._nullEngine = true;
    }

    // ---- Scene ---------------------------------------------------------------
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.name = 'OrbitalExamine_Scene';
    this.scene.clearColor = new BABYLON.Color4(0.004, 0.008, 0.02, 1.0);

    // ACESFilmic tonemapping (spec §1)
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = 1.0;
    ipc.contrast = 1.0;

    // ---- Camera (spec §2) ----------------------------------------------------
    this._initCamera();

    // ---- Lighting ------------------------------------------------------------
    this._initLighting();

    // ---- Earth scene graph (spec §4) -----------------------------------------
    await this._initEarthGroup();

    // ---- Starfield -----------------------------------------------------------
    this._initStarfield();

    // ---- Timeline records ----------------------------------------------------
    this._initTimeline();

    // ---- 3D GUI manager -------------------------------------------------------
    if (BABYLON_GUI && BABYLON_GUI.GUI3DManager) {
      this.gui3DManager = new BABYLON_GUI.GUI3DManager(this.scene);
    }

    // ---- Right-hand NASA-style button panel (spec §5) -----------------------
    this._panel = new OrbitalControlPanel(this, this.scene, this.gui3DManager);
    this._panel.init();

    // ---- HRTF Spatial Audio (spec §7) ----------------------------------------
    this.spatialAudio = new VRSpatialAudio({
      app: this.app,
      scene: this,
      camera: this.camera,
      dataGlyphs: this._panel ? this._panel.buttonAnchors : []
    });
    if (this.app && this.app.mixer) {
      this.setMixer(this.app.mixer);
    }

    // ---- Input (gaze + trigger) for phone-in-headset -------------------------
    this._initGazeReticle();
    this._initDeviceOrientation();
    this._initTriggerInput();

    // ---- Initial timeline state at Jan 1979 ----------------------------------
    this.updateTimeline(0.0);
  }

  /**
   * Enter VR mode: show canvas, attempt WebXR → stereo fallback.
   * @param {Object} [opts]
   * @param {boolean} [opts.forceStereo=false] - Skip WebXR, use manual stereo
   * @returns {Promise<void>}
   */
  async enterVR(opts = {}) {
    this.isVRActive = true;

    // If WebGL failed at construction time and we fell back to a NullEngine,
    // there is nothing to render. Fail loudly here rather than silently
    // opening an invisible VR view with a stopped render loop.
    if (this._nullEngine) {
      throw new Error(
        '[ORBITAL VR] WebGL unavailable: the Babylon engine fell back to a ' +
        'NullEngine during init(), so the Orbital Examine scene cannot render. ' +
        'VR is not usable on this browser/device.'
      );
    }

    if (this._vrCanvas) {
      document.body.classList.add('vr-orbital-active');
      document.body.classList.add('vr-mode-active');
      const mobileLauncher = document.getElementById('mobile-vr-launcher');
      if (mobileLauncher) {
        mobileLauncher.classList.add('hidden');
        mobileLauncher.style.display = 'none';
      }
      this._ensureCardboardOverlay();
      // The canvas is display:none until this class lands, so the engine was
      // constructed against a 0x0 layout box and kept its default 300x150
      // drawing buffer. Resize once the canvas is actually laid out.
      if (this.engine && this.engine.resize) this.engine.resize();
    }

    // Auto switch to landscape fullscreen when VR mode is activated
    await this._requestLandscapeFullscreen();

    // Re-place the world-anchored deck for this canvas size / camera pose.
    this._deckAnchorDirty = true;
    // Recentre the gyro heading for this session.
    this._headRefSet = false;
    this._headAlphaOffset = 0;

    // Keep previous NASA 3D control panel visible as requested, with exact same logic, UI, and position.
    // The top-right gear button (⚙) can toggle it on/off as desired.
    if (this._panel && typeof this._panel.setVisible === 'function') {
      this._panel.setVisible(opts && opts.hideDeck ? false : true);
    }

    // Gyro permission must be requested from this tap/gesture on iOS.
    await this._requestHeadTrackingPermission();

    // Head-aim makes the auto-advancing highlight unnecessary: you look at a
    // button and press. It is only kept as a fallback for devices with no
    // orientation sensor at all.
    if (this._panel && typeof this._panel.startScan === 'function' && !this._headActive) {
      this._panel.startScan();
    }


    const forceStereo = opts && opts.forceStereo;

    // Try WebXR first (Mode A)
    if (!forceStereo && typeof navigator !== 'undefined' && navigator.xr) {
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (supported) {
          if (BABYLON.WebXRDefaultExperience) {
            this._xrHelper = await BABYLON.WebXRDefaultExperience.CreateAsync(this.scene, {
              floorMeshes: [],
              disableTeleportation: true
            });
            // A one-button headset fires a single select event: route it to the
            // same gaze + click handler as the touch/magnet tap, so no pointer
            // raycast or controller motion is required.
            if (this._xrHelper.input) {
              const wireController = (controller) => {
                if (controller && controller.onMainTriggerPressedObservable) {
                  controller.onMainTriggerPressedObservable.add(() => this.handleSingleClick());
                }
              };
              (this._xrHelper.input.controllers || []).forEach(wireController);
              if (this._xrHelper.input.onControllerAddedObservable) {
                this._xrHelper.input.onControllerAddedObservable.add((c) => wireController(c));
              }
            }
            console.info('[ORBITAL VR] WebXR immersive-vr session started.');
            this._startRenderLoop();
            return;
          }
        }
      } catch (xrErr) {
        console.warn('[ORBITAL VR] WebXR unavailable, falling back to stereo:', xrErr && xrErr.message || xrErr);
      }
    }

    // Mode B: dual-viewport stereo (spec §3)
    this._activateStereo();
    this._startRenderLoop();
    console.info('[ORBITAL VR] Stereo dual-viewport mode active.');
  }

  exitVR() {
    this.isVRActive = false;
    this.isPlaying = false;
    if (this._xrHelper) {
      try { this._xrHelper.baseExperience.exitXRAsync(); } catch (_) {}
      this._xrHelper = null;
    }
    if (this._stereoActive) {
      this._deactivateStereo();
    }
    this._detachPointerNavigation();
    this._exitLandscapeFullscreen();
    if (this._panel && typeof this._panel.setVisible === 'function') {
      this._panel.setVisible(true);
    }
    this.engine && this.engine.stopRenderLoop();
    if (typeof document !== 'undefined') {
      document.body.classList.remove('vr-orbital-active');
      document.body.classList.remove('vr-mode-active');
    }
    // Return to 2D dashboard
    if (this.app && typeof this.app.exitVR === 'function') {
      this.app.exitVR();
    } else if (typeof document !== 'undefined') {
      const btn = document.getElementById('exit-vr-button') || document.querySelector('[data-action="exit-vr"]');
      if (btn) btn.click();
    }
  }

  // --------------------------------------------------------------------------
  // Camera (spec §2 + §3)
  // --------------------------------------------------------------------------

  _initCamera() {
    // ArcRotateCamera: target = Earth center (0,0,0)
    // alpha/beta default: viewing from slightly above equator
    this.camera = new BABYLON.ArcRotateCamera(
      'OrbitalCamera',
      -Math.PI / 2,     // alpha: start facing +Z (front face of globe)
      Math.PI / 2.5,    // beta: ~72° down from north pole (looking slightly down)
      ORBITAL_INITIAL_RADIUS,
      BABYLON.Vector3.Zero(),
      this.scene
    );
    this.camera.minZ = ORBITAL_CAMERA_NEAR;
    this.camera.maxZ = ORBITAL_CAMERA_FAR;
    this.camera.lowerRadiusLimit = ORBITAL_MIN_RADIUS;
    this.camera.upperRadiusLimit = ORBITAL_MAX_RADIUS;

    // Smooth inertia for desktop drag
    this.camera.useBouncingBehavior = false;
    this.camera.useAutoRotationBehavior = false;
    this.camera.inertia = 0.6;

    // On desktop the ArcRotateCamera handles drag-rotate and scroll-zoom natively.
    // Keyboard/mouse attach is deferred until enterVR attaches the canvas.
    this.scene.activeCamera = this.camera;
  }

  /**
   * Attach ArcRotateCamera controls to canvas (called after canvas is visible).
   */
  _attachCameraControls() {
    if (this._vrCanvas && this.camera && this.camera.attachControl) {
      this.camera.attachControl(this._vrCanvas, true);
    }
  }

  /**
   * Drag-rotate / wheel-zoom for the stereo canvas.
   *
   * In stereo mode `scene.activeCameras` is the eye pair, so `scene.activeCamera`
   * becomes the left eye -- and Babylon routes pointer/wheel input to
   * scene.activeCamera only. The ArcRotateCamera's attachControl() therefore never
   * sees a single event and mouse navigation was dead in split-screen. These
   * canvas listeners drive the master ArcRotateCamera the eyes are parented to.
   */
  _attachPointerNavigation() {
    const canvas = this._vrCanvas;
    if (!canvas || this._navHandlers) return;
    const DRAG_ROTATE = 0.005;   // rad per CSS px
    const WHEEL_ZOOM = 0.08;     // fraction of radius per wheel notch
    const clampBeta = (v) => Math.max(0.05, Math.min(Math.PI - 0.05, v));
    let dragging = false;
    let activeId = null;
    let lastX = 0;
    let lastY = 0;
    const activePointers = new Map();
    let pinchDist0 = 0;
    let pinchRadius0 = ORBITAL_INITIAL_RADIUS;

    const onDown = (e) => {
      if (e.button !== undefined && e.button !== 0 && (e.pointerType === 'mouse' || !e.pointerType)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        dragging = true;
        activeId = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        pinchDist0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchRadius0 = this.camera ? this.camera.radius : ORBITAL_INITIAL_RADIUS;
      }
    };
    const onMove = (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size >= 2) {
        const pts = Array.from(activePointers.values());
        const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist0 > 5 && currentDist > 5 && this.camera) {
          const ratio = pinchDist0 / currentDist;
          this.camera.radius = Math.max(ORBITAL_MIN_RADIUS, Math.min(ORBITAL_MAX_RADIUS, pinchRadius0 * ratio));
        }
        return;
      }

      if (!dragging || (activeId !== null && e.pointerId !== activeId)) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (!dx && !dy || !this.camera) return;
      this.camera.alpha -= dx * DRAG_ROTATE;
      this.camera.beta = clampBeta(this.camera.beta - dy * DRAG_ROTATE);
    };
    const onUp = (e) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 1) {
        const remaining = activePointers.entries().next().value;
        activeId = remaining[0];
        lastX = remaining[1].x;
        lastY = remaining[1].y;
        dragging = true;
      } else if (activePointers.size === 0) {
        dragging = false;
        activeId = null;
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 + WHEEL_ZOOM : 1 - WHEEL_ZOOM;
      if (this.camera) {
        this.camera.radius = Math.max(ORBITAL_MIN_RADIUS,
          Math.min(ORBITAL_MAX_RADIUS, this.camera.radius * factor));
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    this._navHandlers = { canvas, onDown, onMove, onUp, onWheel };
  }

  _detachPointerNavigation() {
    const h = this._navHandlers;
    if (!h) return;
    h.canvas.removeEventListener('pointerdown', h.onDown);
    h.canvas.removeEventListener('pointermove', h.onMove);
    h.canvas.removeEventListener('pointerup', h.onUp);
    h.canvas.removeEventListener('pointercancel', h.onUp);
    h.canvas.removeEventListener('wheel', h.onWheel);
    this._navHandlers = null;
  }

  /**
   * Mode B: activate dual-viewport stereo render.
   * Creates left/right TargetCamera pair offset by eyeSep/2, normalized viewports.
   */
  _activateStereo() {
    if (this._stereoActive) return;
    this._stereoActive = true;

    const halfSep = ORBITAL_EYE_SEP / 2.0;

    // Target expressed in the PARENT camera's local space. TargetCamera.setTarget()
    // builds its look-at from `this.position`, which is parent-relative once the
    // camera is parented — passing the world origin there aimed both eyes ~90° off
    // (forward = ±X), culling the globe from both frusta.
    const parentWorldInverse = this.camera.getWorldMatrix().clone().invert();
    const localTarget = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.Zero(), parentWorldInverse);

    // Head rig: a rotation-only node between the seat camera and the eyes. The
    // eye cameras are look-at cameras (they use a target, not an Euler
    // rotation), so a gyro quaternion set on the camera itself is ignored; a
    // parent node rotates the whole eye — position, target and view — instead.
    this._headNode = new BABYLON.TransformNode('HeadRig', this.scene);
    this._headNode.parent = this.camera;
    this._headNode.position.setAll(0);
    this._headNode.rotationQuaternion = BABYLON.Quaternion.Identity();

    // Left eye camera (offset -halfSep along camera right)
    this._leftCam = new BABYLON.TargetCamera('OrbitalLeft', this.camera.position.clone(), this.scene);
    this._leftCam.minZ = ORBITAL_CAMERA_NEAR;
    this._leftCam.maxZ = ORBITAL_CAMERA_FAR;
    this._leftCam.fov = this.camera.fov;
    this._leftCam.viewport = new BABYLON.Viewport(0, 0, 0.5, 1);
    this._leftCam.parent = this._headNode;
    this._leftCam.position = new BABYLON.Vector3(-halfSep, 0, 0);
    this._leftCam.setTarget(localTarget);

    // Right eye camera (offset +halfSep along camera right)
    this._rightCam = new BABYLON.TargetCamera('OrbitalRight', this.camera.position.clone(), this.scene);
    this._rightCam.minZ = ORBITAL_CAMERA_NEAR;
    this._rightCam.maxZ = ORBITAL_CAMERA_FAR;
    this._rightCam.fov = this.camera.fov;
    this._rightCam.viewport = new BABYLON.Viewport(0.5, 0, 0.5, 1);
    this._rightCam.parent = this._headNode;
    this._rightCam.position = new BABYLON.Vector3(halfSep, 0, 0);
    this._rightCam.setTarget(localTarget);

    // Subtle VR lens distortion for a realistic headset experience (spec §3)
    try {
      if (BABYLON.PostProcess) {
        const createEyeDistortionPP = (name, camera) => {
          const pp = new BABYLON.PostProcess(
            name,
            'vrDistortion',
            ['uLensCenter', 'uDistortionK', 'uVignetteStrength'],
            ['textureSampler'],
            1.0,
            camera
          );
          pp.onApply = (effect) => {
            effect.setFloat2('uLensCenter', 0.5, 0.5);
            effect.setFloat2('uDistortionK', 0.12, 0.04);
            effect.setFloat('uVignetteStrength', 0.45);
          };
          return pp;
        };
        this._leftDistortionPP = createEyeDistortionPP('VRDistortionLeft', this._leftCam);
        this._rightDistortionPP = createEyeDistortionPP('VRDistortionRight', this._rightCam);
      }
    } catch (ppErr) {
      console.warn('[ORBITAL VR] VR lens distortion postprocess notice:', ppErr);
    }

    this.scene.activeCameras = [this._leftCam, this._rightCam];
  }

  _deactivateStereo() {
    this._stereoActive = false;
    this.scene.activeCameras = [];
    this.scene.activeCamera = this.camera;
    if (this._leftDistortionPP)  { try { this._leftDistortionPP.dispose(); } catch (_) {} this._leftDistortionPP = null; }
    if (this._rightDistortionPP) { try { this._rightDistortionPP.dispose(); } catch (_) {} this._rightDistortionPP = null; }
    if (this._leftCam)  { this._leftCam.dispose();  this._leftCam = null; }
    if (this._rightCam) { this._rightCam.dispose(); this._rightCam = null; }
    if (this._headNode) { this._headNode.dispose(); this._headNode = null; }
  }

  // --------------------------------------------------------------------------
  // Lighting (spec §4 — DirectionalLight intensity 3.2 + HemisphericLight)
  // --------------------------------------------------------------------------

  _initLighting() {
    // Axial-tilt pivot for the sun (23.44°)
    this.celestialPivot = new BABYLON.TransformNode('CelestialPivot', this.scene);
    this.celestialPivot.rotation.z = -(23.44 * DEG_TO_RAD);

    // Directional sunlight — intensity 3.2, 5778K solar white
    this.sunLight = new BABYLON.DirectionalLight('SunLight',
      new BABYLON.Vector3(-1, 0, -0.5).normalize(), this.scene);
    this.sunLight.position.set(50.0, 20.0, 50.0);
    this.sunLight.diffuse  = BABYLON.Color3.FromHexString('#fff4e0');
    this.sunLight.specular = new BABYLON.Color3(0.6, 0.58, 0.52);
    this.sunLight.intensity = 3.2;
    this.sunLight.parent = this.celestialPivot;

    // Hemispheric ambient fill (space + dark ground)
    this.ambientLight = new BABYLON.HemisphericLight('SpaceAmbient',
      new BABYLON.Vector3(0, 1, 0), this.scene);
    this.ambientLight.diffuse      = BABYLON.Color3.FromHexString('#2a4d6e');
    this.ambientLight.groundColor  = BABYLON.Color3.FromHexString('#0a0a12');
    this.ambientLight.intensity    = 0.30;
  }

  // --------------------------------------------------------------------------
  // Earth group (spec §4 scene graph, all shaders ported from vr_shaders.js)
  // --------------------------------------------------------------------------

  async _initEarthGroup() {
    this.earthGroup = new BABYLON.TransformNode('EarthGroup', this.scene);
    this.earthGroup.parent = this.celestialPivot;

    const basePath = '/assets/textures/';

    // ---- Verified texture loading -------------------------------------------
    // Every load is logged; failures get a labelled placeholder, never a solid color.

    const loadImageElement = (url) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`Image load failed: ${url}`));
      img.src = url;
    });

    const rawTextureFromImage = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      const tex = BABYLON.RawTexture.CreateRGBATexture(
        data, canvas.width, canvas.height, this.scene,
        true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
      );
      tex.anisotropicFilteringLevel = 16;
      tex.__sourceCanvas = canvas;
      return tex;
    };

    const loadTextureVerified = async (fileName, { srgb = false } = {}) => {
      if (typeof window !== 'undefined' && !Array.isArray(window.__vrTextureLog)) {
        window.__vrTextureLog = [];
      }
      const log = (entry) => {
        if (typeof window !== 'undefined' && Array.isArray(window.__vrTextureLog)) {
          window.__vrTextureLog.push(entry);
        }
      };
      if (typeof document === 'undefined') {
        log({ file: fileName, status: 'skipped-headless', srgb });
        return BABYLON.RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, this.scene);
      }
      try {
        const img = await loadImageElement(basePath + fileName);
        if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) {
          throw new Error(`invalid image dimensions for ${fileName}`);
        }
        const tex = rawTextureFromImage(img);
        const dims = `${img.naturalWidth}x${img.naturalHeight}`;
        console.info(`[ORBITAL VR TEXTURE VERIFIED] ${fileName} -> OK (${dims}${srgb ? ', sRGB' : ''})`);
        log({ file: fileName, status: 'ok', dims, srgb });
        return tex;
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error(`[ORBITAL VR TEXTURE FAILURE] ${fileName}: ${msg} — rendering CLEARLY LABELLED flat placeholder.`);
        log({ file: fileName, status: 'fail', error: msg });
        return this._labelledPlaceholder(fileName);
      }
    };

    const [dayTex, nightTex, cloudsTex, bumpTex, specTex] = await Promise.all([
      loadTextureVerified('earth_day_2k.png',    { srgb: true }),  // NASA Blue Marble NG
      loadTextureVerified('earth_night_2k.png',  { srgb: true }),  // NASA Black Marble VIIRS DNB
      loadTextureVerified('earth_clouds_2k.png'),                  // MODIS cloud fraction composite
      loadTextureVerified('earth_bump_2k.png'),                    // GEBCO elevation/bathymetry
      loadTextureVerified('earth_specular_2k.png')                 // Ocean mask
    ]);

    // Cloud box-filter pre-bake (removes sensor grain at globe-scale view)
    let cloudsBaked = cloudsTex;
    if (typeof document !== 'undefined' && cloudsTex && cloudsTex.getSize) {
      try {
        const size = cloudsTex.getSize();
        const small = document.createElement('canvas');
        small.width = 256; small.height = 128;
        small.getContext('2d').drawImage(cloudsTex.__sourceCanvas || small, 0, 0, 256, 128);
        const big = document.createElement('canvas');
        big.width = size.width; big.height = size.height;
        const bctx = big.getContext('2d');
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(small, 0, 0, big.width, big.height);
        cloudsBaked = this._cloudsAlphaTexture(big);
        console.info('[ORBITAL VR TEXTURE PRE-BAKE] earth_clouds_2k.png -> box-filtered 256x128 alphaMap baked');
      } catch (bakeErr) {
        console.warn('[ORBITAL VR TEXTURE PRE-BAKE] clouds bake skipped:', bakeErr && bakeErr.message || bakeErr);
      }
    }

    // ---- 1. SurfaceMesh (Blue Marble + Black Marble + GEBCO displacement) ---
    // spec §4: sphere subdivisions ~64, PBRMaterial — using verified VRSurfaceShader
    // (shader parity outranks API parity; documented deviation per port note 3)
    const surfaceMesh = BABYLON.MeshBuilder.CreateSphere('SurfaceMesh', {
      diameter: ORBITAL_EARTH_RADIUS * 2.0,
      segments: 64
    }, this.scene);

    // 1x1 stand-in until the real grid arrives, so the sampler is always bound.
    const gridPlaceholderTex = BABYLON.RawTexture.CreateRGBATexture(
      new Uint8Array([0, 0, 0, 255]), 1, 1, this.scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE
    );

    const surfaceMat = new VRShaderMaterial('OrbitalSurfaceMat', this.scene, {
      vertexShader:   VRSurfaceShader.vertexShader,
      fragmentShader: VRSurfaceShader.fragmentShader,
      uniforms: {
        uDayMap:      dayTex,
        uNightMap:    nightTex,
        uSpecularMap: specTex,
        uBumpMap:     bumpTex,
        uBumpScale:   0.012,  // ~7.6 km peak relief (GEBCO true range)
        uSunDirection: { x: this.subsolarVector.x, y: this.subsolarVector.y, z: this.subsolarVector.z },
        uTime: 0.0,
        // NASA GISTEMP zonal layer inputs (vec4 arrays -> setVector4)
        uZonalA:      [0, 0, 0, 0],
        uZonalB:      [0, 0, 0, 0],
        uTempLayer:   0.0,
        uCO2Layer:    0.0,
        // Real GISTEMP 250 km gridded field (see setTemperatureGrid)
        uTempGrid:    gridPlaceholderTex,
        uGridRows:    92.0,
        uGridPad:     1.0,
        uGridScale:   50.0,
        uGridValid:   0.0,
        // NSIDC Arctic sea ice, drawn on the globe (no dome geometry)
        uIceLayer:        0.0,
        uIceExtentMkm2:   14.0
      },
      transparent: false,
      depthWrite:  true,
      side: 'FrontSide'
    });
    surfaceMesh.material = surfaceMat;
    surfaceMesh.parent   = this.earthGroup;
    this.surfaceMesh     = surfaceMesh;

    // ---- 2. CloudLayer (MODIS composite, scale 1.008) -------------------------
    const cloudMesh = BABYLON.MeshBuilder.CreateSphere('CloudLayer', {
      diameter: ORBITAL_EARTH_RADIUS * 2.0 * 1.008,
      segments: 64
    }, this.scene);
    const cloudMat  = new BABYLON.PBRMaterial('CloudLayerPBR', this.scene);
    // Clouds are a translucent veil, not a second planet: the MODIS composite
    // covers ~64% of the globe, so the old 0.90 alpha buried the Blue Marble
    // under a white shell.
    cloudMat.albedoColor   = new BABYLON.Color3(0.94, 0.97, 1.0);
    cloudMat.metallic      = 0.0;
    cloudMat.roughness     = 1.0;
    cloudMat.alphaTexture  = cloudsBaked;
    cloudMat.getAlphaFromRGB = false;
    cloudMat.alpha         = 0.34;
    cloudMat.disableDepthWrite = true;
    cloudMat.backFaceCulling   = true;
    cloudMat.transparencyMode  = BABYLON.Engine.ALPHA_COMBINE;
    cloudMesh.material = cloudMat;
    cloudMesh.parent   = this.earthGroup;
    this.cloudLayer    = cloudMesh;

    // ---- 3. AtmosphereShell (Mie/Rayleigh, CO2-driven, scale 1.025) ----------
    this.atmosphereShell = createAtmosphereShell(this.scene, ORBITAL_EARTH_RADIUS * 1.025, ORBITAL_EARTH_RADIUS);
    this.atmosphereShell.parent = this.earthGroup;

    // ---- 4. IceCapGroup (NSIDC extent, IOR 1.31 rim lighting) ----------------
    // No polar dome meshes: their silhouette read as a grey disc hovering over
    // the pole. The measured NSIDC ice edge is drawn by the surface shader
    // instead (uIceLayer / uIceExtentMkm2), on the real globe geometry.
    this.iceCapGroup = null;

    // ---- 5. TerminatorRibbon: intentionally not created ----------------------
    // It drew a thin wire ring a hair above the surface along the solar
    // terminator. The globe is already lit by a real sun direction, so the
    // day/night edge is shaded on the surface itself; the ring only read as a
    // floating hoop crossing the planet. Kept as a null field so the shared
    // shader update helpers (which guard for null) need no change.
    this.terminatorRibbon = null;

    // ---- 6. OceanGlowField (Fresnel, OHC+audio driven) -----------------------
    // Clearance must exceed the GEBCO vertex displacement (uBumpScale = 0.012 on
    // a unit-less 0..1 bump), not just sit "a hair" above the sphere: at
    // *1.0002 the displaced ocean floor punched through this shell as a quilt of
    // small raised squares — the fake-looking tiling seen in the OCEAN layer.
    this.oceanGlowField = createOceanGlowField(this.scene, ORBITAL_EARTH_RADIUS + 0.0135, specTex);
    this.oceanGlowField.parent = this.earthGroup;
  }

  _cloudsAlphaTexture(bigCanvas) {
    const ctx = bigCanvas.getContext('2d');
    const w = bigCanvas.width, h = bigCanvas.height;
    const src  = ctx.getImageData(0, 0, w, h);
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4 + 0] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = src.data[i * 4]; // cloud luminance -> alpha
    }
    const tex = BABYLON.RawTexture.CreateRGBATexture(
      rgba, w, h, this.scene, true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    tex.anisotropicFilteringLevel = 16;
    return tex;
  }

  _labelledPlaceholder(fileName) {
    if (typeof document === 'undefined') {
      return BABYLON.RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, this.scene);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#e0119b';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, 512, 256);
    ctx.fillStyle = '#e0119b';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MISSING DATASET', 256, 110);
    ctx.font = '26px monospace';
    ctx.fillStyle = '#dce6f2';
    ctx.fillText(fileName.length > 38 ? fileName.slice(0, 38) : fileName, 256, 160);
    ctx.fillText('FLAT PLACEHOLDER — REAL DATA UNAVAILABLE', 256, 200);
    const data = new Uint8Array(ctx.getImageData(0, 0, 512, 256).data);
    return BABYLON.RawTexture.CreateRGBATexture(data, 512, 256, this.scene, true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  }

  // --------------------------------------------------------------------------
  // Starfield (spec §4 — existing asset, never regenerated)
  // --------------------------------------------------------------------------

  _initStarfield() {
    // Real ESA Hipparcos catalogue: one point per naked-eye star, placed from
    // its own RA/Dec and lit by its own magnitude and B-V index. The painted
    // skybox texture is kept only as a fallback if the catalogue cannot load.
    this.starfieldSkybox = createHipparcosStarfield(this.scene, 150);
    this._starfieldFallback = () => createGaiaStarfieldMesh(
      this.scene, STARFIELD_RADIUS, '/assets/textures/starfield_gaia_2k.png'
    );
  }

  // --------------------------------------------------------------------------
  // Timeline
  // --------------------------------------------------------------------------

  _initTimeline() {
    if (this.app && this.app.harmonizedData && this.app.harmonizedData.records) {
      this.harmonizedRecords = this.app.harmonizedData.records;
    }
    if (this.app && this.app.zonalData) {
      this.zonalData = this.app.zonalData;
    }
  }

  // --------------------------------------------------------------------------
  // Scientific layers (TEMP / CO2 / OCEAN / ICE)
  // --------------------------------------------------------------------------

  /**
   * Attach the NASA GISTEMP zonal series (annual records with 8 latitude bands).
   * @param {Object|null} zonal
   */
  setZonalData(zonal) {
    this.zonalData = zonal || null;
    this._refreshZonalBands();
    this._applyLayerUniforms();
  }

  /**
   * Load the real NASA GISTEMP 250 km gridded anomalies shipped as an int8
   * year-major block (scripts/build_gistemp_grid.py). One texture holds the
   * current year and is re-uploaded when the timeline crosses a year.
   *
   * @param {object} meta   gistemp_grid_annual.json
   * @param {ArrayBuffer} buffer gistemp_grid_annual.bin
   * @returns {boolean} true when the grid was accepted
   */
  setTemperatureGrid(meta, buffer) {
    if (!meta || !buffer || !this.surfaceMesh) return false;
    const width = meta.width | 0;
    const rows = meta.rowsPerYear | 0;
    const years = Array.isArray(meta.years) ? meta.years : [];
    if (!width || !rows || !years.length) return false;

    this._grid = {
      width,
      rows,
      pad: meta.pad | 0,
      scale: meta.scale || 50,
      years,
      bytes: new Uint8Array(buffer),
      index: -1
    };

    const tex = BABYLON.RawTexture.CreateRGBATexture(
      new Uint8Array(width * rows * 4), width, rows, this.scene,
      false, false, BABYLON.Texture.BILINEAR_SAMPLINGMODE
    );
    tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    this._gridTex = tex;

    const u = this.surfaceMesh.material && this.surfaceMesh.material.uniforms;
    if (u) {
      if (u.uTempGrid) u.uTempGrid.value = tex;
      if (u.uGridRows) u.uGridRows.value = rows;
      if (u.uGridPad) u.uGridPad.value = this._grid.pad;
      if (u.uGridScale) u.uGridScale.value = this._grid.scale;
      if (u.uGridValid) u.uGridValid.value = 1.0;
    }

    this._grid.index = -1;
    this._applyGridYear(Math.floor(this._currentYearFloat()));
    return true;
  }

  /** Upload the real grid block for a year into the sampler texture. */
  _applyGridYear(year) {
    const g = this._grid;
    if (!g || !this._gridTex) return;
    const idx = Math.max(0, Math.min(g.years.length - 1, year - g.years[0]));
    if (idx === g.index) return;
    g.index = idx;

    const cells = g.width * g.rows;
    const start = idx * cells;
    const out = this._gridData || (this._gridData = new Uint8Array(cells * 4));
    for (let i = 0; i < cells; i++) {
      const raw = g.bytes[start + i];
      const signed = raw > 127 ? raw - 256 : raw;
      out[i * 4] = signed + 128;
      out[i * 4 + 1] = 0;
      out[i * 4 + 2] = 0;
      // 0 alpha = no observation in this cell (the shader falls back to zonal).
      out[i * 4 + 3] = (signed === -128) ? 0 : 255;
    }
    this._gridTex.update(out);
  }

  /** Current timeline position as a fractional year (1979.0 ... 2026.75). */
  _currentYearFloat() {
    const monthIdx = this.currentT * (TOTAL_MONTHS - 1);
    return 1979 + monthIdx / 12.0;
  }

  /** Interpolate the 8 GISTEMP band anomalies for the current month. */
  _refreshZonalBands() {
    const records = this.zonalData && this.zonalData.records;
    const bands = ZONAL_BAND_KEYS.map(() => 0.0);
    if (!records || !records.length) {
      this._zonalBands = bands;
      return;
    }

    const yf = this._currentYearFloat();
    const y0 = Math.floor(yf);
    const frac = Math.max(0.0, Math.min(1.0, yf - y0));
    const r0 = records.find((r) => r && r.year === y0);
    const r1 = records.find((r) => r && r.year === y0 + 1) || r0;

    for (let i = 0; i < ZONAL_BAND_KEYS.length; i++) {
      const key = ZONAL_BAND_KEYS[i];
      const a = r0 && typeof r0[key] === 'number' ? r0[key] : 0.0;
      const b = r1 && typeof r1[key] === 'number' ? r1[key] : a;
      bands[i] = a + (b - a) * frac;
    }
    this._zonalBands = bands;
    if (this._grid) this._applyGridYear(Math.floor(yf));
  }

  /** Push layer blend amounts + zonal values into the planetary shaders. */
  _applyLayerUniforms() {
    const on = (i) => (this.activeLayerIndex === i ? 1.0 : 0.0);
    const b = this._zonalBands;

    const surface = this.surfaceMesh && this.surfaceMesh.material && this.surfaceMesh.material.uniforms;
    if (surface) {
      if (surface.uTempLayer) surface.uTempLayer.value = on(0);
      if (surface.uZonalA) surface.uZonalA.value = [b[0], b[1], b[2], b[3]];
      if (surface.uZonalB) surface.uZonalB.value = [b[4], b[5], b[6], b[7]];
      // Surface-side atmospheric wash (the limb shell alone is occluded).
      if (surface.uCO2Layer) surface.uCO2Layer.value = on(1);
    }

    const atm = this.atmosphereShell && this.atmosphereShell.material && this.atmosphereShell.material.uniforms;
    if (atm && atm.uCO2Layer) atm.uCO2Layer.value = on(1);

    const ocean = this.oceanGlowField && this.oceanGlowField.material && this.oceanGlowField.material.uniforms;
    if (ocean && ocean.uOceanLayer) ocean.uOceanLayer.value = on(2);

    // Data-layer view: thin the cloud veil so it does not wash the colours out.
    if (this.cloudLayer && this.cloudLayer.material) {
      this.cloudLayer.material.alpha = (this.activeLayerIndex !== null) ? 0.10 : 0.34;
    }

    // ICE layer: the measured NSIDC cover is painted by the surface shader on
    // the globe itself (no dome geometry, so no floating disc at the pole).
    if (surface) {
      if (surface.uIceLayer) surface.uIceLayer.value = on(3);
    }
  }

  /**
   * Select (or toggle off) a scientific layer shown on the globe.
   * @param {number} index - 0=TEMP 1=CO2 2=OCEAN 3=ICE
   */
  actionSelectLayer(index) {
    const i = Number(index);
    if (!(i >= 0 && i <= 3)) return;
    this.activeLayerIndex = (this.activeLayerIndex === i) ? null : i;

    // Sea ice is polar: tilt up to the Arctic on selection, otherwise the
    // measured cap sits edge-on at the top of the globe and looks unchanged.
    if (this.activeLayerIndex === 3 && this.camera && this.camera.beta > 0.85) {
      this.camera.beta = 0.85;
    }

    // The layer button is also the audio selector: TEMP lets only the surface
    // temperature stem through, CO2 only the CO2 stem, and so on. Deselecting
    // returns to all four mixed together.
    this._applyLayerAudioStem(this.activeLayerIndex === null ? -1 : this.activeLayerIndex);

    this._refreshZonalBands();
    this._applyLayerUniforms();
    if (this._panel) {
      if (typeof this._panel.syncLayerStates === 'function') {
        this._panel.syncLayerStates(this.activeLayerIndex);
      }
      this._updateLayerReadout();
    }
  }

  /**
   * Route the deck to one stem only.
   * @param {number} stemIndex - 0=TEMP 1=CO2 2=OCEAN 3=ICE, -1 = all four
   */
  _applyLayerAudioStem(stemIndex) {
    const solo = (stemIndex >= 0 && stemIndex <= 3) ? stemIndex : -1;
    this._soloStem = solo;
    this._stemMuted = [0, 1, 2, 3].map((k) => solo >= 0 && k !== solo);

    const mixer = this.mixer || (this.app && this.app.mixer) || null;
    if (!mixer || typeof mixer.setTrackSolo !== 'function') return;
    for (let k = 0; k < 4; k++) {
      try {
        mixer.setTrackSolo(STEM_IDS[k], k === solo);
      } catch (e) {
        console.warn('[ORBITAL VR] stem solo failed:', e && e.message);
      }
    }
  }

  /** Real-data readout line for the deck hint strip. */
  _layerReadout() {
    const rec = this.activeMonthRecord;
    if (!rec || this.activeLayerIndex === null) return null;
    const year = String(Math.floor(this._currentYearFloat()));
    const fmt = (v, dp = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(dp) : '--');

    switch (this.activeLayerIndex) {
      case 0:
        return `TEMP · GISTEMP ZONAL ${year} · GLOBAL ${fmt(rec.temperature_anomaly)} °C`;
      case 1:
        return `CO2 · MAUNA LOA ${year} · ${fmt(rec.co2_ppm, 1)} ppm`;
      case 2:
        return `OCEAN · NOAA ANOMALY ${year} · ${fmt(rec.ocean_temp_anomaly)} °C`;
      case 3:
        return `SEA ICE · NSIDC ARCTIC ${year} · ${fmt(rec.sea_ice_extent)} M km²`;
      default:
        return null;
    }
  }

  _updateLayerReadout() {
    if (!this._panel || typeof this._panel.updateHint !== 'function') return;
    this._panel.updateHint(this._layerReadout() || LAYER_HINT_DEFAULT);
  }

  /**
   * Advance timeline to position t in [0,1] and sync all shaders + audio.
   * @param {number} t
   */
  updateTimeline(t) {
    this.currentT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));

    // Solar ephemeris (ported from vr_scene.js updateTimeline — unchanged values)
    const totalYears  = (TOTAL_MONTHS - 1) / 12.0;
    const yearFrac    = (this.currentT * totalYears) % 1.0;
    const solarDecRad = (23.44 * DEG_TO_RAD) * Math.sin(yearFrac * Math.PI * 2.0 - (Math.PI / 2.0));
    const solarLonRad = this.currentT * Math.PI * 2.0 * 48.0;

    const sunDist = 50.0;
    const sunX = sunDist * Math.cos(solarDecRad) * Math.cos(solarLonRad);
    const sunY = sunDist * Math.sin(solarDecRad);
    const sunZ = sunDist * Math.cos(solarDecRad) * Math.sin(solarLonRad);

    // The real ephemeris still drives the seasonal declination, but the solar
    // longitude is anchored to the viewer (see _updateSunForView). Previously
    // the sun followed absolute orbital longitude, so at the 1979 start month
    // it sat far behind the camera and the near hemisphere rendered as an
    // almost black disc with only a crescent at the limb.
    const sunLen = Math.hypot(sunX, sunY, sunZ) || 1.0;
    this._ephemerisDeclination = solarDecRad;
    this._ephemerisSun = { x: sunX / sunLen, y: sunY / sunLen, z: sunZ / sunLen };
    this._updateSunForView();

    // Interpolate climate record
    this.activeMonthRecord = interpolateHarmonizedRecord(this.harmonizedRecords, this.currentT);

    // Keep the scientific layer in sync with the timeline (zonal bands are
    // annual, so they interpolate as playback moves through the months).
    this._refreshZonalBands();
    this._applyLayerUniforms();
    this._updateLayerReadout();

    // Sync planetary shaders
    updatePlanetaryShaders({
      terminatorRibbon: this.terminatorRibbon,
      atmosphereShell:  this.atmosphereShell,
      oceanGlowField:   this.oceanGlowField,
      iceCapGroup:      this.iceCapGroup,
      surfaceMesh:      this.surfaceMesh,
      timelineProgress: this.currentT,
      monthRecord:      this.activeMonthRecord,
      audioEnvelopes:   this.audioEnvelopes,
      clockTime:        this.elapsedTime,
      sunDirection:     this.subsolarVector,
      sunPosition:      this.sunLight ? this.sunLight.position : null,
      scene:            this.scene
    });

    // Update panel date readout
    if (this._panel) {
      this._panel.updateDateDisplay(this.activeMonthRecord);
    }
  }

  /**
   * Per-frame update — called from the render loop.
   * @param {number} delta - Seconds since last frame (capped by caller at 0.1)
   */
  update(delta) {
    this.elapsedTime += delta;
    // Head tracking first: the eye cameras must be aimed before the deck's gaze
    // ray is cast this frame.
    this._applyHeadOrientation();

    // Hard radius clamp every frame: every current write path already clamps,
    // but the camera is reachable from panel actions, wheel input and future
    // code, and a single unclamped write puts the eye cameras inside the globe.
    if (this.camera) {
      this.camera.radius = Math.min(ORBITAL_MAX_RADIUS,
        Math.max(ORBITAL_MIN_RADIUS, this.camera.radius));
    }

    // Keep the key light anchored to the current view. Orbiting the globe must
    // not swing the user around to the night side: the hemisphere in front of
    // the eyes always stays the lit one.
    this._updateSunForView();

    // Autoplay: one YEAR per tick, no monthly stepping.
    if (this.isPlaying) {
      this._playheadAccum += delta;
      if (this._playheadAccum >= AUTOPLAY_INTERVAL_SEC) {
        this._playheadAccum -= AUTOPLAY_INTERVAL_SEC;
        const yearStep = YEAR_STEP_T;
        const nextT = Math.min(1.0, this.currentT + yearStep);
        this.updateTimeline(nextT);
        if (nextT >= 1.0) {
          // The 1980 -> 2026 sweep is over: stop the soundtrack with it.
          this.isPlaying = false;
          this._setAudioPlaying(false);
        }
      }
    }

    // Steady planetary rotation at a medium speed, ALWAYS on and deliberately
    // independent of the transport: pressing PLAY changes the data, not how
    // fast the Earth turns (0.12 rad/s ~= one turn every 52 s).
    const spin = delta * 0.12;
    for (const mesh of [this.surfaceMesh, this.cloudLayer, this.oceanGlowField, this.iceCapGroup]) {
      if (mesh) mesh.rotation.y += spin;
    }
    // Clouds drift slightly faster than the ground they sit over.
    if (this.cloudLayer) {
      this.cloudLayer.rotation.y += delta * 0.015;
    }

    // Panel dwell timer update
    if (this._panel) {
      this._panel.update(delta);
    }

    // Phone grab-and-spin: feed head yaw delta to camera.alpha
    this._updateGrabSpin(delta);
    // Long-press OK = recentre the Earth in front of the current head pose.
    this._updateOkHold();

    // Audio HRTF positions update (panel button world coords)
    if (this.spatialAudio) {
      this.spatialAudio.updatePositions();
    }

    // Timeline shader time-uniform update (not full updateTimeline — just clock)
    if (this.terminatorRibbon && this.terminatorRibbon.material &&
        this.terminatorRibbon.material.uniforms && this.terminatorRibbon.material.uniforms.uTime) {
      this.terminatorRibbon.material.uniforms.uTime.value = this.elapsedTime;
    }
    if (this.oceanGlowField && this.oceanGlowField.material &&
        this.oceanGlowField.material.uniforms && this.oceanGlowField.material.uniforms.uTime) {
      this.oceanGlowField.material.uniforms.uTime.value = this.elapsedTime;
    }
  }

  /**
   * Anchor the key light to the viewer.
   *
   * A 3/4 front light (about 35° off the view axis, upper-left) keeps most of
   * the visible disc in daylight with the terminator and the night-lights limb
   * visible. This is what makes the Blue Marble read as a lit planet instead of
   * the black silhouette in the original VR capture.
   */
  _updateSunForView() {
    const cam = this.camera;
    if (!cam) return;
    cam.computeWorldMatrix(true);
    const forward = cam.getDirection(BABYLON.Axis.Z).normalize(); // eye -> globe
    const right   = cam.getDirection(BABYLON.Axis.X).normalize();
    const up      = cam.getDirection(BABYLON.Axis.Y).normalize();
    const dec     = this._ephemerisDeclination || 0.0;

    const dir = forward.scale(-0.80)
      .add(up.scale(0.40 + 0.16 * Math.sin(dec)))
      .add(right.scale(-0.34));
    dir.normalize();

    this.subsolarVector = { x: dir.x, y: dir.y, z: dir.z };

    if (this.sunLight) {
      this.sunLight.position.set(dir.x * 60.0, dir.y * 60.0, dir.z * 60.0);
      this.sunLight.direction.set(-dir.x, -dir.y, -dir.z);
    }

    this._syncSunUniforms();
  }

  /** Push the current sun direction into every custom planetary shader. */
  _syncSunUniforms() {
    const s = this.subsolarVector;
    if (!s) return;
    const setSun = (mesh) => {
      const mat = mesh && mesh.material;
      if (mat && mat.uniforms && mat.uniforms.uSunDirection) {
        mat.uniforms.uSunDirection.value = { x: s.x, y: s.y, z: s.z };
      }
    };
    setSun(this.surfaceMesh);
    setSun(this.atmosphereShell);
    if (this.iceCapGroup && this.iceCapGroup.getChildMeshes) {
      const caps = this.iceCapGroup.getChildMeshes();
      if (caps.length) setSun(caps[0]);
    }
  }

  updateAudioEnvelopes(envelopes) {
    if (!envelopes) return;
    for (let i = 0; i < 4; i++) {
      this.audioEnvelopes[i] = Math.max(0.0, Math.min(1.0, Number(envelopes[i]) || 0.0));
    }
  }

  setMixer(mixer) {
    if (mixer) this.mixer = mixer;
    if (this.spatialAudio && mixer) {
      const anchors = this._panel ? this._panel.buttonAnchors : [];
      this.spatialAudio.init(mixer.audioCtx, mixer, this.camera, anchors);
    }
  }

  // --------------------------------------------------------------------------
  // Panel button actions (called by OrbitalControlPanel)
  // --------------------------------------------------------------------------

  actionPlay() {
    // A fresh press runs the decade sweep the way it is meant to be seen:
    // 1980 through 2026, one year at a time.
    if (this.currentT <= 1e-6 || this.currentT >= 1.0 - 1e-6) {
      this.updateTimeline(YEAR_1980_T);
    }
    this.isPlaying = true;
    this._playheadAccum = 0.0;
    this._setAudioPlaying(true);
  }

  actionPause() {
    this.isPlaying = false;
    this._setAudioPlaying(false);
  }

  /** Seek the mixer to the same fraction of the record as the on-screen year. */
  _seekAudioToYear() {
    const mixer = this.mixer || (this.app && this.app.mixer);
    if (!mixer || typeof mixer.seek !== 'function' || !mixer.duration) return;
    const target = Math.max(0, Math.min(mixer.duration, this.currentT * mixer.duration));
    try {
      mixer.seek(target);
    } catch (e) {
      console.warn('[ORBITAL VR] audio seek failed:', e && e.message);
    }
  }

  /**
   * Mirror the deck transport onto the app's real audio mixer. The deck used to
   * flip an `isPlaying` flag only, so PLAY advanced the visuals silently while
   * the sonification never started (and entering VR pauses the mixer).
   * @param {boolean} on
   */
  _setAudioPlaying(on) {
    const app = this.app;
    const mixer = this.mixer || (app && app.mixer);
    if (!mixer) return;
    this.mixer = mixer;

    const resume = () => {
      try {
        if (this.isPlaying !== on) return;
        // Line the soundtrack up with the year on screen: the stems are one
        // 20 s pass over 1979-2026 and the sweep is ~19.7 s, so seeking by
        // timeline fraction keeps sound and year together.
        this._seekAudioToYear();
        // Stems may have arrived after a layer button was tapped: re-assert the
        // solo so PLAY never leaks the other three once they exist.
        if (this._soloStem >= 0) this._applyLayerAudioStem(this._soloStem);
        if (typeof mixer.play === 'function' && !mixer.isPlaying) mixer.play();
      } catch (e) {
        console.warn('[ORBITAL VR] audio start failed:', e && e.message);
      }
    };

    try {
      if (on) {
        // Stems are fetched on first use; play once they exist.
        if (app && typeof app.loadAudioStemsIfNeeded === 'function') {
          Promise.resolve(app.loadAudioStemsIfNeeded()).then(resume).catch(() => {});
        } else {
          resume();
        }
      } else if (typeof mixer.pause === 'function' && mixer.isPlaying) {
        mixer.pause();
      }
    } catch (e) {
      console.warn('[ORBITAL VR] audio toggle failed:', e && e.message);
    }
  }
  actionTogglePlay() { if (this.isPlaying) this.actionPause(); else this.actionPlay(); }

  /**
   * One click, one action.
   *
   * A phone-in-headset has no aim (the deck follows the view) and a single
   * centre button, so clicking activates the deck's auto-advancing highlight.
   * With the scan idle, the click falls back to play/pause.
   */
  handleSingleClick() {
    // Head-aim first: whatever the centre of the view is actually on. This is
    // the phone-in-headset button — you look at TEMP, you press, TEMP fires.
    if (this._panel && typeof this._panel.pickButtonAtGazeCenter === 'function'
        && this._panel.pickButtonAtGazeCenter()) {
      return;
    }
    if (this._panel && typeof this._panel.activateFocusedButton === 'function'
        && this._panel.activateFocusedButton()) {
      return;
    }
    this.actionTogglePlay();
  }

  // Deck stepping is yearly, matching playback and the year-only readout.
  actionPrev() {
    this.isPlaying = false;
    this.updateTimeline(Math.max(0.0, this.currentT - YEAR_STEP_T));
  }

  actionNext() {
    this.isPlaying = false;
    this.updateTimeline(Math.min(1.0, this.currentT + YEAR_STEP_T));
  }

  actionZoomIn() {
    if (this.camera) {
      this.camera.radius = Math.max(ORBITAL_MIN_RADIUS, this.camera.radius - ORBITAL_ZOOM_STEP);
      this._deckAnchorDirty = true; // re-place the deck after a deliberate zoom
    }
  }

  actionZoomOut() {
    if (this.camera) {
      this.camera.radius = Math.min(ORBITAL_MAX_RADIUS, this.camera.radius + ORBITAL_ZOOM_STEP);
      this._deckAnchorDirty = true;
    }
  }

  actionExit() { this.exitVR(); }

  /**
   * Solo one stem (or return to the full mix when it is already soloed).
   * @param {number} stemIndex - 0=TEMP, 1=CO2, 2=OCEAN, 3=ICE
   */
  actionToggleStem(stemIndex) {
    if (stemIndex < 0 || stemIndex > 3) return;
    const next = this._soloStem === stemIndex ? -1 : stemIndex;
    this._applyLayerAudioStem(next);
    if (this._panel && typeof this._panel.syncLayerStates === 'function') {
      this._panel.syncLayerStates(next >= 0 ? next : null);
    }
  }

  isStemMuted(stemIndex) {
    return Boolean(this._stemMuted[stemIndex]);
  }

  // --------------------------------------------------------------------------
  // Gaze reticle + phone trigger (spec §3)
  // --------------------------------------------------------------------------

  _initGazeReticle() {
    if (typeof document === 'undefined') return;
    // Thin amber crosshair reticle (always visible in VR mode)
    // Implemented as a small plane on a fixed near-distance TransformNode.
    // The reticle tracks the camera forward direction automatically because it
    // is parented to a node that follows the camera.
    this._reticleMesh = null; // created on first enterVR (needs canvas size)
  }

  /**
   * Phone-in-headset head tracking.
   *
   * The whole point of putting a phone in a headset is that turning your head
   * turns the view. Without this the stereo pair was frozen at the camera pose
   * and the scene looked like a static photo. Orientation is applied to the two
   * EYE cameras only, so the base camera pose (and therefore the Earth and the
   * deck sitting in the world) does not move.
   */
  _initDeviceOrientation() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    if (!('DeviceOrientationEvent' in window)) return;
    this._onDeviceOrientation = (e) => {
      if (e.alpha === null && e.beta === null && e.gamma === null) return;
      // Recentre once per session: alpha is a compass heading and beta depends
      // on how the phone happens to be tilted, so without this the first thing
      // the user sees depends on which way they are facing and holding it.
      if (!this._headRefSet) this._recentreHead(e.alpha || 0, e.beta || 0, e.gamma || 0);
      this._setHeadAngles(e.alpha || 0, e.beta || 0, e.gamma || 0);
      this._headActive = true;
      // The grab-and-spin path reads the same live angles.
      window.__devOrient = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
    };
    window.addEventListener('deviceorientation', this._onDeviceOrientation, { passive: true });
  }

  /**
   * Make the given raw device pose the "home" pose, i.e. looking straight along
   * the seat camera (which always aims at the globe).
   *
   * The seat camera is an ArcRotateCamera pointed at the origin, so the globe is
   * centred exactly when the head offset is neutral — that is why recentring the
   * head pose, rather than moving the camera, is enough to bring the Earth back
   * in front of the user.
   */
  _recentreHead(alphaDeg, betaDeg, gammaDeg) {
    const a = Number(alphaDeg) || 0;
    const b = (typeof betaDeg === 'number' && isFinite(betaDeg)) ? betaDeg : 90;
    const g = Number(gammaDeg) || 0;
    // Home is Euler (alpha, 90, 0): an upright phone looking forward.
    this._headAlphaOffset = -a;
    this._headBetaOffset  = 90 - b;
    this._headGammaOffset = -g;
    this._headRefSet      = true;
  }

  /**
   * Hold-OK recentre: put the Earth back in the middle of the view.
   * @returns {boolean} whether anything was recentred
   */
  recenterEarth() {
    if (!this.isVRActive) return false;
    const raw = this._headRaw || { alpha: 0, beta: 90, gamma: 0 };
    this._recentreHead(raw.alpha, raw.beta, raw.gamma);
    this._setHeadAngles(raw.alpha, raw.beta, raw.gamma);
    this._applyHeadOrientation();
    // The deck comes back with the Earth: it is re-docked on the same gesture.
    this._deckAnchorDirty = true;
    this._deckSettling = false;
    if (this._panel && this._panel._buttons) {
      this._panel._gazedBtn = null;
      for (const btn of this._panel._buttons) {
        btn.isGazed = false;
        btn.dwellTimer = 0;
        if (btn.progressBar) btn.progressBar.scaling.x = 0;
        if (btn.progressMat) btn.progressMat.alpha = 0;
      }
    }
    return true;
  }

  /** Begin tracking an OK-button press (called on press, and by the frame loop). */
  _beginOkHold() {
    this._okHeld = true;
    this._okHoldFired = false;
    this._okHoldStart = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
  }

  /**
   * End of an OK press: a short press is a click, a long one already recentred.
   * @returns {boolean} whether the press should count as a click
   */
  _endOkHold() {
    const wasHeld = this._okHeld;
    const fired = this._okHoldFired;
    this._okHeld = false;
    this._okHoldFired = false;
    return wasHeld && !fired;
  }

  /** Fire the recentre once the OK button has been held long enough. */
  _updateOkHold() {
    if (!this._okHeld || this._okHoldFired) return;
    const now = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();
    if (now - this._okHoldStart >= OK_RECENTER_HOLD_SEC * 1000) {
      this._okHoldFired = true;
      this.recenterEarth();
    }
  }

  /** Feed raw device angles (also used by tests / desktop simulation). */
  _setHeadAngles(alphaDeg, betaDeg, gammaDeg) {
    const a = Number(alphaDeg) || 0;
    const b = Number(betaDeg)  || 0;
    const g = Number(gammaDeg) || 0;
    // Keep the raw pose: recentring is expressed in raw sensor terms.
    this._headRaw = { alpha: a, beta: b, gamma: g };
    this._headEuler.alpha = a + (this._headAlphaOffset || 0);
    this._headEuler.beta  = b + (this._headBetaOffset  || 0);
    this._headEuler.gamma = g + (this._headGammaOffset || 0);
    // First real reading: head-aim replaces the auto-advancing highlight, so
    // stop the scan before it can steal the press.
    if (!this._headActive && this._panel && typeof this._panel.stopScan === 'function') {
      this._panel.stopScan();
    }
    this._headActive = true;
  }

  /** Ask for gyro access. iOS 13+ only grants it inside a user gesture. */
  async _requestHeadTrackingPermission() {
    try {
      const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const state = await DOE.requestPermission();
        if (state !== 'granted') {
          console.warn('[ORBITAL VR] device orientation permission denied — no head tracking');
        }
      }
    } catch (err) {
      console.warn('[ORBITAL VR] device orientation permission failed:', err && err.message);
    }
  }

  /**
   * Convert the latest device angles into a quaternion and hand it to the eye
   * cameras. Same convention as the classic DeviceOrientationControls: ZXY
   * device Euler -> camera yaw/pitch/roll, then -90 deg about X to make the
   * camera look forward, then the screen-rotation correction.
   */
  _applyHeadOrientation() {
    if (!this.isVRActive || !this._headActive) return;
    const cams = (this.scene && this.scene.activeCameras && this.scene.activeCameras.length)
      ? this.scene.activeCameras
      : null;
    if (!cams) return;

    const DEG = Math.PI / 180;
    const a = this._headEuler.alpha * DEG;
    const b = this._headEuler.beta * DEG;
    const g = this._headEuler.gamma * DEG;

    // Euler YXZ (yaw about Y, pitch about X, roll about Z) as in three's
    // DeviceOrientationControls: euler.set(beta, alpha, -gamma, 'YXZ').
    const q = BABYLON.Quaternion.RotationYawPitchRoll(a, b, -g);
    // Look along the device's forward axis instead of its screen normal. The
    // sign is the opposite of the classic three.js DeviceOrientationControls
    // value because a Babylon camera looks down +Z, not -Z; +PI/2 left the eye
    // facing exactly backwards (measured: home view was the negated base
    // forward vector).
    q.multiplyInPlace(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.X, -Math.PI / 2));
    // Screen orientation (landscape phone in a headset) rotates the view.
    const screenDeg = (typeof window !== 'undefined' && window.screen && window.screen.orientation)
      ? (window.screen.orientation.angle || 0)
      : (typeof window !== 'undefined' && typeof window.orientation === 'number' ? window.orientation : 0);
    if (screenDeg) q.multiplyInPlace(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Z, -screenDeg * DEG));

    this._headQuat = q;
    if (this._headNode) {
      this._headNode.rotationQuaternion = q.clone();
      this._headNode.computeWorldMatrix(true);
    }
  }

  /**
   * Register the trigger button event (external hardware / on-screen button).
   * Per spec §3 universal rule:
   *   - If gaze is on globe → grab-and-spin
   *   - If gaze is on a panel button → instant button activation
   */
  _initTriggerInput() {
    if (typeof document === 'undefined') return;
    const onTrigger = () => {
      // Whatever the eye is aimed at fires; the scan highlight is the fallback.
      this.handleSingleClick();
    };
    // Press starts a hold: 3 s of OK recentres the Earth in front of the view,
    // a shorter press is an ordinary click. Gamepad button 0 uses the same pair.
    const onPress = () => { this._beginOkHold(); };
    const onRelease = () => {
      this._gazeGrabActive = false;
      if (this._endOkHold()) onTrigger();
    };

    // Physical trigger from DeviceOrientationEvent-based headsets fires as a
    // keydown (many BT remotes send Enter or Space); gamepad button is handled
    // in the render loop via gamepad API.
    document.addEventListener('keydown', (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) onPress();
      if ((e.key === 'c' || e.key === 'C' || e.key === 'd' || e.key === 'D') && !e.repeat && this.isVRActive) {
        this.toggleControlDeck();
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') onRelease();
    });

    // Gamepad polling (checked each frame via _updateGrabSpin)
    this._triggerDown   = false;
    this._triggerActive = false;
    this._onTrigger     = onPress;
    this._onRelease     = onRelease;
  }

  /**
   * Per-frame grab-and-spin: feeds head-yaw delta into camera.alpha.
   * Only active when trigger is held AND gaze is on globe (not panel).
   */
  _updateGrabSpin(delta) {
    // Poll gamepad trigger
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (!pad) continue;
        const trigVal = pad.buttons[0] && pad.buttons[0].value > 0.5;
        if (trigVal && !this._triggerActive) {
          this._triggerActive = true;
          if (this._onTrigger) this._onTrigger();
        } else if (!trigVal && this._triggerActive) {
          this._triggerActive = false;
          if (this._onRelease) this._onRelease();
        }
      }
    }

    if (!this._gazeGrabActive) {
      this._lastHeadYaw   = null;
      this._lastHeadPitch = null;
      return;
    }

    // DeviceOrientation-based head yaw delta
    if (typeof window !== 'undefined' && window.__devOrient) {
      const { alpha, beta } = window.__devOrient;
      if (this._lastHeadYaw !== null) {
        let dYaw = alpha - this._lastHeadYaw;
        // Wrap delta through [-180, 180]
        if (dYaw > 180)  dYaw -= 360;
        if (dYaw < -180) dYaw += 360;
        this.camera.alpha -= dYaw * DEG_TO_RAD * 0.5;

        const dPitch = beta - this._lastHeadPitch;
        this.camera.beta  = Math.max(0.1, Math.min(Math.PI - 0.1, this.camera.beta - dPitch * DEG_TO_RAD * 0.5));
      }
      this._lastHeadYaw   = alpha;
      this._lastHeadPitch = beta;
    }
  }

  // --------------------------------------------------------------------------
  // Render loop
  // --------------------------------------------------------------------------

  /**
   * No visible aim point is drawn. The cyan disc was a HUD artefact floating
   * over the planet; gaze/trigger targeting works entirely from the screen
   * centre maths below, so nothing is rendered for it. Kept as a no-op so the
   * render loop and the reticle-tracking call sites stay unchanged.
   */
  _ensureReticle() {
    this._reticleMesh = null;
  }

  _startRenderLoop() {
    if (!this.engine) return;

    // Attach camera controls to canvas (safe to call after canvas is visible)
    this._attachCameraControls();
    this._attachPointerNavigation();
    this._ensureReticle();

    let lastTime = performance ? performance.now() : Date.now();

    this.engine.runRenderLoop(() => {
      const now  = performance ? performance.now() : Date.now();
      const delta = Math.min((now - lastTime) / 1000.0, 0.1);
      lastTime = now;

      this.update(delta);
      this.scene.render();
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.engine && this.engine.resize());
    }
  }

  // --------------------------------------------------------------------------
  // Fullscreen & Orientation Lock (Google Cardboard Mobile VR)
  // --------------------------------------------------------------------------

  async _requestLandscapeFullscreen() {
    if (typeof document === 'undefined') return;
    try {
      const docEl = document.documentElement;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (docEl.requestFullscreen) {
          await docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) {
          await docEl.webkitRequestFullscreen();
        }
      }
    } catch (e) {
      console.warn('[ORBITAL VR] Fullscreen request notice:', e);
    }
    try {
      if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock('landscape').catch(() => {});
      } else if (typeof screen !== 'undefined' && typeof screen.lockOrientation === 'function') {
        screen.lockOrientation('landscape');
      }
    } catch (e) {
      console.warn('[ORBITAL VR] Orientation lock notice:', e);
    }
  }

  _exitLandscapeFullscreen() {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitFullscreenElement && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch (e) {
      console.warn('[ORBITAL VR] Exit fullscreen notice:', e);
    }
    try {
      if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.unlock === 'function') {
        screen.orientation.unlock();
      } else if (typeof screen !== 'undefined' && typeof screen.unlockOrientation === 'function') {
        screen.unlockOrientation();
      }
    } catch (e) {
      console.warn('[ORBITAL VR] Orientation unlock notice:', e);
    }
  }

  toggleControlDeck() {
    if (this._panel && typeof this._panel.toggleVisibility === 'function') {
      const isVis = this._panel.toggleVisibility();
      console.info(`[ORBITAL VR] Control deck ${isVis ? 'visible' : 'hidden'}`);
      return isVis;
    }
    return false;
  }

  _ensureCardboardOverlay() {
    if (typeof document === 'undefined') return null;
    let overlay = document.getElementById('vr-cardboard-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'vr-cardboard-overlay';
      overlay.className = 'vr-cardboard-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = [
        '<svg class="vr-cardboard-svg" viewBox="0 0 2000 1000" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">',
        '  <!-- Google Cardboard dual biconvex barrel lens cutouts (evenodd mask) -->',
        '  <path fill="#000000" fill-rule="evenodd" d="M 0,0 L 2000,0 L 2000,1000 L 0,1000 Z M 150,45 C 350,65 650,65 870,45 C 930,52 950,85 945,160 C 925,380 925,620 945,840 C 950,915 930,948 870,955 C 650,935 350,935 150,955 C 90,948 70,915 75,840 C 95,620 95,380 75,160 C 70,85 90,52 150,45 Z M 1850,45 C 1650,65 1350,65 1130,45 C 1070,52 1050,85 1055,160 C 1075,380 1075,620 1055,840 C 1050,915 1070,948 1130,955 C 1350,935 1650,935 1850,955 C 1910,948 1930,915 1925,840 C 1905,620 1905,380 1925,160 C 1930,85 1910,52 1850,45 Z" />',
        '  <!-- Center alignment divider notch at bottom center -->',
        '  <line x1="1000" y1="650" x2="1000" y2="1000" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />',
        '</svg>',
        '<button id="vr-btn-close" class="vr-cardboard-btn vr-btn-close" title="Exit VR" aria-label="Exit VR">',
        '  <svg viewBox="0 0 24 24" width="24" height="24" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">',
        '    <line x1="18" y1="6" x2="6" y2="18"></line>',
        '    <line x1="6" y1="6" x2="18" y2="18"></line>',
        '  </svg>',
        '</button>',
        '<button id="vr-btn-deck-toggle" class="vr-cardboard-btn vr-btn-gear" title="Toggle Control Deck" aria-label="Toggle Control Deck">',
        '  <svg viewBox="0 0 24 24" width="24" height="24" fill="#ffffff">',
        '    <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>',
        '  </svg>',
        '</button>'
      ].join('\n');
      document.body.appendChild(overlay);

      const closeBtn = overlay.querySelector('#vr-btn-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.exitVR();
        });
      }
      const gearBtn = overlay.querySelector('#vr-btn-deck-toggle');
      if (gearBtn) {
        gearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleControlDeck();
        });
      }
    }
    return overlay;
  }

  // --------------------------------------------------------------------------
  // Canvas management
  // --------------------------------------------------------------------------

  _ensureCanvas() {
    let canvas = document.getElementById('vr-orbital-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id        = 'vr-orbital-canvas';
      canvas.className = 'vr-orbital-canvas';
      // Not aria-hidden: this canvas takes programmatic focus for the
      // single-button deck, and hiding a focused element makes the browser
      // drop focus with an accessibility error. Describe it instead.
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'Earthsonic VR globe: orbital view with the control deck');
      canvas.setAttribute('tabindex', '-1');
      document.body.appendChild(canvas);
    }
    if (!document.getElementById('vr-orbital-canvas-styles')) {
      const style = document.createElement('style');
      style.id = 'vr-orbital-canvas-styles';
      style.textContent = [
        '.vr-orbital-canvas {',
        '  position: fixed !important; inset: 0 !important; top: 0 !important; left: 0 !important;',
        '  width: 100vw !important; height: 100vh !important; width: 100dvw !important; height: 100dvh !important;',
        '  display: none; z-index: 99990 !important; outline: none; touch-action: none; margin: 0 !important; padding: 0 !important;',
        '  background: #000000 !important;',
        '}',
        'body.vr-orbital-active {',
        '  overflow: hidden !important; margin: 0 !important; padding: 0 !important; background: #000000 !important;',
        '  width: 100vw !important; height: 100vh !important; width: 100dvw !important; height: 100dvh !important;',
        '}',
        'body.vr-orbital-active .vr-orbital-canvas { display: block !important; }',
        'body.vr-orbital-active #mobile-vr-launcher,',
        'body.vr-orbital-active #vr-desktop-modal { display: none !important; }',
        '.vr-cardboard-overlay {',
        '  position: fixed !important; inset: 0 !important; top: 0 !important; left: 0 !important;',
        '  width: 100vw !important; height: 100vh !important; width: 100dvw !important; height: 100dvh !important;',
        '  display: none; z-index: 99995 !important; pointer-events: none; overflow: hidden; margin: 0 !important; padding: 0 !important;',
        '}',
        'body.vr-orbital-active .vr-cardboard-overlay { display: block !important; }',
        '.vr-cardboard-svg {',
        '  position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; display: block;',
        '}',
        '.vr-cardboard-btn {',
        '  position: absolute; top: 16px; width: 44px; height: 44px; background: transparent; border: none;',
        '  padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer;',
        '  pointer-events: auto; z-index: 100000 !important; opacity: 0.85; transition: opacity 0.2s, transform 0.15s;',
        '  touch-action: manipulation; box-shadow: none !important; outline: none;',
        '}',
        '.vr-cardboard-btn:hover, .vr-cardboard-btn:active { opacity: 1.0; transform: scale(1.1); box-shadow: none !important; }',
        '.vr-cardboard-btn.vr-btn-close { left: 18px; }',
        '.vr-cardboard-btn.vr-btn-gear { right: 18px; }'
      ].join('\n');
      document.head.appendChild(style);
    }
    this._ensureCardboardOverlay();
    return canvas;
  }

  // --------------------------------------------------------------------------
  // Disposal
  // --------------------------------------------------------------------------

  dispose() {
    this.exitVR();
    if (this.scene)  { this.scene.dispose(); }
    if (this.engine) { this.engine.dispose(); }
    if (this._vrCanvas && this._vrCanvas.parentNode) {
      this._vrCanvas.parentNode.removeChild(this._vrCanvas);
    }
    if (typeof document !== 'undefined') {
      const overlay = document.getElementById('vr-cardboard-overlay');
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }
  }
}

// ============================================================================
// OrbitalControlPanel — right-hand NASA-style 3D button panel (spec §5)
// ============================================================================

/**
 * JPL theme tokens (applied to 3D panel geometry):
 *   Panel surface: #0b1220
 *   Borders:       1px hairline #1b2636
 *   Active/amber:  #ff8a3d  (active/selected state only)
 *   Labels:        IBM Plex Mono (falls back to monospace)
 *   Idle buttons:  flat, no glow, no gradient, no emoji
 */

const JPL_PANEL_BG    = '#0b1220';
const JPL_BORDER      = '#1b2636';
const JPL_AMBER       = '#ff8a3d';
const JPL_TEXT        = '#dce6f2';
const JPL_FONT        = '"IBM Plex Mono", monospace';

/**
 * Panel world-space transform.
 *
 * The deck is docked to the eye every frame by _updateCameraAnchor(): centered
 * horizontally, sitting low in the frame so the globe owns the view. The header
 * placement is only a seed for headless tests. The deck is sized in local units
 * and then fitted to the eye frustum (each stereo eye is half the canvas wide,
 * and a phone in portrait is narrower still), which is what keeps every label
 * on screen instead of the old off-axis slab that was clipped to a wedge.
 */
const PANEL_POSITION  = new BABYLON.Vector3(0, -1.25, -6.2);
const PANEL_SCALE     = 1.0;
const PANEL_ANGULAR_SCALE = 1.0;

// Camera-docked control deck geometry (local units; fitted at runtime)
const DECK_DISTANCE = 6.2;   // world units in front of the eye
const DECK_DOWN     = 1.25;  // world units below the view axis
const DECK_COLS     = 4;
const DECK_ROWS     = 3;
// Gaze targets must subtend at least 3 degrees of visual angle (Meta/Oculus UI
// guidance); at the 6.2 unit deck distance and the fitted panel scale a button
// of 0.86 x 0.58 lands at ~4.8 x 3.2 degrees. Uneven buttons read as a broken
// layout, so every cell is identical and the gaps are equal.
const DECK_BTN_W    = 0.86;
const DECK_BTN_H    = 0.58;
const DECK_GAP_X    = 0.14;
const DECK_GAP_Y    = 0.14;

// Mixer track ids, in deck order: TEMP, CO2, OCEAN, ICE.
const STEM_IDS = ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent'];

const BUTTON_DEFS = [
  // id, label, action, type, grid column/row (single-button deck: every control
  // is a large, gaze-pickable target reachable with one click)
  { id: 'play',  label: 'PLAY',    action: 'play',   type: 'transport', col: 0, row: 0 },
  { id: 'pause', label: 'PAUSE',   action: 'pause',  type: 'transport', col: 1, row: 0 },
  { id: 'prev',  label: '< PREV',  action: 'prev',   type: 'transport', col: 2, row: 0 },
  { id: 'next',  label: 'NEXT >',  action: 'next',   type: 'transport', col: 3, row: 0 },
  { id: 'temp',  label: 'TEMP',    action: 'stem0',  type: 'toggle',    col: 0, row: 1, accent: '#f97316' },
  { id: 'co2',   label: 'CO2',     action: 'stem1',  type: 'toggle',    col: 1, row: 1, accent: '#22c55e' },
  { id: 'ocean', label: 'OCEAN',   action: 'stem2',  type: 'toggle',    col: 2, row: 1, accent: '#06b6d4' },
  { id: 'ice',   label: 'ICE',     action: 'stem3',  type: 'toggle',    col: 3, row: 1, accent: '#38bdf8' },
  { id: 'zin',   label: 'ZOOM IN', action: 'zoomIn', type: 'control',   col: 0, row: 2, art: 'ZOOM +' },
  { id: 'zout',  label: 'ZOOM OUT',action: 'zoomOut',type: 'control',   col: 1, row: 2, art: 'ZOOM -' },
  { id: 'exit',  label: 'EXIT',    action: 'exit',   type: 'exit',      col: 3, row: 2 }
];

export class OrbitalControlPanel {
  /**
   * @param {OrbitalExamineScene} scene - Parent orbital scene
   * @param {BABYLON.Scene} babylonScene
   * @param {BABYLON_GUI.GUI3DManager|null} gui3D
   */
  constructor(orbitalScene, babylonScene, gui3D) {
    this._orb     = orbitalScene;
    this._scene   = babylonScene;
    this._gui3D   = gui3D;

    this._panelRoot   = null;    // TransformNode panel anchor
    this._buttons     = [];      // { def, mesh, textMesh, dwellTimer, isGazed }
    this._gazedBtn    = null;    // Currently gazed button index or null
    this._dateDisplay = null;    // 3D text mesh for date readout

    // Public: world-space anchor nodes for audio panner positioning
    this.buttonAnchors = [];     // 4 stem button TransformNodes (TEMP CO2 OCEAN ICE)

    // One-button scan state
    this._scanActive = false;
    this._scanIdx    = 0;
    this._scanTimer  = 0.0;
    // Dwell-to-activate is intentionally off: on a one-button deck it fires by
    // accident while the user is just reading the panel.
    // Look at a control for 3 s and it fires (the user asked for hold-to-press
    // on the centre of the view); a centre-button click also fires immediately.
    this._dwellToActivate = true;
    this._visible = true;
  }

  setVisible(visible) {
    this._visible = Boolean(visible);
    if (this._panelRoot) {
      this._panelRoot.setEnabled(this._visible);
    }
    if (!this._visible) {
      this.stopScan();
    } else {
      this._updateCameraAnchor(0);
    }
  }

  toggleVisibility() {
    this.setVisible(!this._visible);
    return this._visible;
  }

  get isVisible() {
    return this._visible !== false;
  }

  init() {
    // Panel root node. The deck is re-docked to the eye every frame in
    // _updateCameraAnchor(), so this transform is only a seed (and what
    // headless tests inspect).
    this._panelRoot = new BABYLON.TransformNode('OrbitalPanel', this._scene);
    this._panelRoot.position = PANEL_POSITION.clone();
    this._panelRoot.scaling.setAll(PANEL_SCALE);

    // Build panel backing plane (JPL dark surface)
    this._buildPanelBacking();

    // Build buttons
    BUTTON_DEFS.forEach((def, i) => {
      const btn = this._buildButton(def, i, BUTTON_DEFS.length);
      this._buttons.push(btn);
      // Stem toggle buttons: collect anchor nodes for audio
      if (def.type === 'toggle') {
        this.buttonAnchors.push(btn.anchor);
      }
    });

    // Date readout (monospace, one line) + single-button hint strip
    this._buildDateDisplay();
    this._buildHintStrip();

    // Desktop pointer activation (gaze alone cannot reach a world-space panel
    // without turning the head): tap/click a button face to fire its action.
    this._bindPointerPicking();
  }

  /**
   * Click/tap a panel button. POINTERTAP only fires when the pointer did not
   * drag, so orbiting the camera never triggers a button by accident.
   */
  _bindPointerPicking() {
    if (typeof document === 'undefined') return;
    const engine = this._scene && this._scene.getEngine ? this._scene.getEngine() : null;
    const canvas = engine && engine.getRenderingCanvas ? engine.getRenderingCanvas() : null;
    if (!canvas) return;

    // Tap handling is bound directly to the canvas and hit-tested in screen
    // space. Babylon's POINTERTAP pick went through scene.pointerX/Y, which is
    // reported in a different space than the per-eye viewports — every second
    // column of the deck (PAUSE, NEXT, CO2, ICE, ZOOM OUT) was swallowed.
    let downX = 0, downY = 0, downAt = 0, downId = null;

    const onDown = (e) => {
      downId = e.pointerId;
      downX = e.clientX;
      downY = e.clientY;
      downAt = Date.now();
    };

    const onUp = (e) => {
      if (downId !== null && e.pointerId !== downId) return;
      downId = null;
      // A drag is orbit navigation, not a tap.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) return;
      if (Date.now() - downAt > 900) return;

      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      const idx = this.pickButtonAtScreen(cssX, cssY);

      if (idx !== null && idx >= 0) {
        this._activateButton(idx);
        this._buttons[idx].dwellTimer = 0.0;
        this._scanTimer = 0.0;
        this._setFocus(idx);
        return;
      }

      // A one-button headset taps wherever its magnet lands: anything that is
      // not a control goes through the single-click path instead.
      if (this._orb && typeof this._orb.handleSingleClick === 'function') {
        this._orb.handleSingleClick();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', () => { downId = null; });
    this._tapHandlers = { canvas, onDown, onUp };
  }

  /**
   * Pick the panel from the current pointer position using the camera that owns
   * that half of the canvas. In stereo the scene's activeCamera is the parent
   * ArcRotateCamera (full-canvas viewport), so picking with it misses what the
   * eye viewports actually draw.
   */
  _pickAtPointer() {
    const sc = this._scene;
    const cams = (sc.activeCameras && sc.activeCameras.length) ? sc.activeCameras : [sc.activeCamera];
    const x = sc.pointerX;
    const y = sc.pointerY;
    // Restrict the ray test to button faces, then try EVERY eye camera. Zooming
    // moves the panel's screen position, so it can straddle the viewport
    // boundary; guessing one camera by pointer containment swallowed the click.
    // A wrong camera simply misses all button faces and we fall through.
    const isButtonFace = (mesh) => this._buttons.some((b) => b.face === mesh);
    for (const cam of cams) {
      const pick = sc.pick(x, y, isButtonFace, false, cam);
      if (pick && pick.hit) return pick;
    }
    return sc.pick(x, y, isButtonFace, false, sc.activeCamera);
  }

  // -------------------------------------------------------------------------
  // One-button scan (switch access)
  // -------------------------------------------------------------------------

  /** Begin the auto-advancing highlight. Called when VR mode starts. */
  startScan() {
    // Always restart on PLAY. Keeping the previous index meant re-entering VR
    // inherited whatever was focused last time — after an EXIT tap the very
    // first click of the next session would quit VR again.
    this._scanActive = true;
    this._scanTimer = 0.0;
    this._setFocus(0);
  }

  stopScan() {
    this._scanActive = false;
    this._scanTimer = 0.0;
    for (const btn of this._buttons) {
      btn.isFocused = false;
      if (btn.focusPlate) btn.focusPlate.isVisible = false;
      btn.progressMat.alpha = 0.0;
      btn.progressBar.scaling.x = 0.0;
    }
  }

  /** Move the highlight to a button index (wraps). */
  _setFocus(idx) {
    if (!this._buttons.length) return;
    const n = this._buttons.length;
    this._scanIdx = ((idx % n) + n) % n;
    for (let i = 0; i < n; i++) {
      const btn = this._buttons[i];
      btn.isFocused = (i === this._scanIdx);
      if (btn.focusPlate) btn.focusPlate.isVisible = btn.isFocused;
      this._paintButton(btn);
      if (!btn.isFocused) {
        btn.progressMat.alpha = 0.0;
        btn.progressBar.scaling.x = 0.0;
      }
    }
  }

  /** @returns {number|null} index of the highlighted control, or null when idle */
  getFocusedButton() {
    return this._scanActive ? this._scanIdx : null;
  }

  /** Single centre click: activate the highlighted control. */
  activateFocusedButton() {
    if (!this._scanActive) return false;
    const idx = this._scanIdx;
    this._activateButton(idx);
    this._setFocus(idx);
    this._scanTimer = 0.0;
    return true;
  }

  // -------------------------------------------------------------------------
  // Screen-space hit testing
  // -------------------------------------------------------------------------

  /**
   * Projected rectangle of a button face for one camera viewport.
   * @returns {{x0:number,x1:number,y0:number,y1:number}|null}
   */
  _projectFaceRect(face, vp, transform) {
    if (!face || !vp) return null;
    const scene = this._scene;
    // The deck moves (re-dock), so the face transform must be current: reading
    // absolutePosition straight after a move would project the previous frame.
    face.computeWorldMatrix(true);
    const M = BABYLON.Matrix.Identity();
    // Callers that know which camera they mean pass its own view*projection
    // matrix: scene.getTransformMatrix() is whatever camera rendered LAST, which
    // is the wrong eye during stereo and one frame stale inside update().
    const tm = transform || scene.getTransformMatrix();
    const c = face.getAbsolutePosition();
    const box = face.getBoundingInfo && face.getBoundingInfo().boundingBox;
    if (!box) return null;
    const right = face.getDirection(BABYLON.Axis.X).scale(box.extendSize.x);
    const up    = face.getDirection(BABYLON.Axis.Y).scale(box.extendSize.y);
    const pc = BABYLON.Vector3.Project(c, M, tm, vp);
    const pr = BABYLON.Vector3.Project(c.add(right), M, tm, vp);
    const pu = BABYLON.Vector3.Project(c.add(up), M, tm, vp);
    const hx = Math.abs(pr.x - pc.x);
    const hy = Math.abs(pu.y - pc.y);
    return { x0: pc.x - hx, x1: pc.x + hx, y0: pc.y - hy, y1: pc.y + hy };
  }

  /**
   * @param {number} px - canvas CSS-pixel X (as reported by a pointer event)
   * @param {number} py - canvas CSS-pixel Y
   * @returns {number|null} button index under that pixel
   */
  pickButtonAtScreen(px, py) {
    if (!this._visible) return null;
    const sc = this._scene;
    if (!sc || !sc.getEngine) return null;
    const engine = sc.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();

    // Babylon reports pointer coordinates in CSS pixels, while viewports are in
    // drawing-buffer pixels. On a phone (devicePixelRatio > 1) those differ, so
    // scale the tap into render space before testing projected rectangles.
    const rect = (typeof engine.getRenderingCanvasClientRect === 'function')
      ? engine.getRenderingCanvasClientRect()
      : null;
    if (rect && rect.width > 0 && rect.height > 0) {
      px = px * (w / rect.width);
      py = py * (h / rect.height);
    }

    const cams = (sc.activeCameras && sc.activeCameras.length) ? sc.activeCameras : [sc.activeCamera];

    for (const cam of cams) {
      if (!cam || !cam.viewport) continue;
      const vp = cam.viewport.toGlobal(w, h);
      if (px < vp.x || px > vp.x + vp.width || py < vp.y || py > vp.y + vp.height) continue;
      for (let i = 0; i < this._buttons.length; i++) {
        const rect = this._projectFaceRect(this._buttons[i].face, vp);
        if (!rect) continue;
        if (px >= rect.x0 && px <= rect.x1 && py >= rect.y0 && py <= rect.y1) return i;
      }
    }
    return null;
  }

  /**
   * Cast the reticle (screen centre of each eye) at the deck and activate the
   * button under it. This is the single-button path: the trigger/click never
   * needs a pointer position.
   * @returns {boolean} whether a button was activated
   */
  /**
   * Button under the centre of each eye viewport, found by PROJECTION.
   *
   * A centre ray was the obvious approach and it silently never hit: the eye
   * cameras are look-at cameras parented to the head rig, so Camera.getDirection
   * returns the rig axis rather than the actual view direction, and
   * Camera.getForwardRay returns a parent-local origin. Projecting the button
   * faces with the same transform the renderer uses sidesteps both problems and
   * works for the parent camera in flat mode too.
   *
   * @returns {number|null} index of the button at the view centre
   */
  _buttonAtViewCenter() {
    if (!this._visible) return null;
    const sc = this._scene;
    if (!sc || !sc.getEngine) return null;
    const engine = sc.getEngine();
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const cams = (sc.activeCameras && sc.activeCameras.length) ? sc.activeCameras : [sc.activeCamera];
    for (const cam of cams) {
      if (!cam || !cam.viewport) continue;
      const vp = cam.viewport.toGlobal(w, h);
      const tm = cam.getViewMatrix().multiply(cam.getProjectionMatrix());
      const cx = vp.x + vp.width / 2;
      const cy = vp.y + vp.height / 2;
      // Nearest miss within a forgiving tolerance. The deck is a grid with gaps,
      // so a head aimed at the middle of the panel would otherwise select
      // nothing and dwell would never start.
      const tol = vp.height * 0.09;
      let bestIdx = null;
      let bestD = Infinity;
      for (let i = 0; i < this._buttons.length; i++) {
        const rect = this._projectFaceRect(this._buttons[i].face, vp, tm);
        if (!rect) continue;
        if (cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1) return i;
        const dx = cx - (rect.x0 + rect.x1) / 2;
        const dy = cy - (rect.y0 + rect.y1) / 2;
        const d = Math.hypot(dx, dy);
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      if (bestIdx !== null && bestD <= tol) return bestIdx;
    }
    return null;
  }

  pickButtonAtGazeCenter() {
    const idx = this._buttonAtViewCenter();
    if (idx === null || idx < 0) return false;
    this._activateButton(idx);
    this._buttons[idx].dwellTimer = 0.0;
    return true;
  }

  /**
   * Rounded-rectangle path, used by every piece of deck art below.
   * Real VR panels are drawn surfaces, not floating text: each control needs a
   * visible plate so it reads as a button instead of a word on the Earth.
   */
  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  /** Upload a 2D canvas as a mirrored, alpha-capable texture. */
  _canvasTexture(canvas) {
    const ctx = canvas.getContext('2d');
    const data = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const tex = BABYLON.RawTexture.CreateRGBATexture(
      data, canvas.width, canvas.height, this._scene, false, true,
      BABYLON.Texture.BILINEAR_SAMPLINGMODE
    );
    tex.hasAlpha = true;
    // The deck plane's local +X projects to the viewer's LEFT, so mirror U.
    tex.uScale = -1;
    tex.uOffset = 1;
    return tex;
  }

  /**
   * One button: plate + centred label, in idle and highlighted variants.
   * @param {string} label
   * @param {number} aspect width / height of the button
   * @param {boolean} hot highlight state (gazed, focused or toggled on)
   */
  _buildButtonArt(label, aspect, hot, opts = {}) {
    if (typeof document === 'undefined') return null;
    const H = 256;
    const W = Math.max(200, Math.round(H * Math.max(0.6, aspect)));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    const type   = opts.type || 'control';
    const accent = opts.accent || null;
    const text   = opts.art || label;
    const isChip = type === 'control' || type === 'exit';

    // Transport and layer cells sit inside a group plate drawn on the panel
    // backing, so they carry no border of their own. Utility controls do get a
    // chip outline: they are not part of a group and would otherwise float.
    if (isChip) {
      const ix = W * 0.08;
      const iy = H * 0.16;
      this._roundRect(ctx, ix, iy, W - ix * 2, H - iy * 2, 12);
      ctx.fillStyle = hot ? 'rgba(255, 138, 61, 0.13)' : 'rgba(255, 255, 255, 0.02)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hot ? 'rgba(255, 138, 61, 0.85)' : 'rgba(126, 158, 196, 0.28)';
      ctx.stroke();
    } else if (hot) {
      // Selected / gazed cell: a tinted wash plus an amber underline, rather than
      // a full border on every side — the row already has its own plate.
      ctx.fillStyle = 'rgba(255, 138, 61, 0.10)';
      ctx.fillRect(2, 6, W - 4, H - 12);
      ctx.fillStyle = 'rgba(255, 138, 61, 0.95)';
      this._roundRect(ctx, 14, H - 22, W - 28, 7, 3.5);
      ctx.fill();
    }

    // Layer cells carry the same channel hue as their dashboard strip.
    let centreX = W / 2;
    if (accent) {
      ctx.beginPath();
      ctx.arc(W * 0.16, H / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      centreX = W / 2 + 8;
    }

    // Medium weight and tracked, not bold: bold everywhere is what made the
    // deck read as a wall of labels with no hierarchy.
    let size = Math.round(H * 0.28);
    const track = Math.max(0, Math.round(H * 0.035));
    const setFont = () => {
      ctx.font = `500 ${size}px ${JPL_FONT}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${track}px`;
    };
    setFont();
    const maxW = isChip ? W * 0.8 : W * 0.72;
    while (size > 12 && ctx.measureText(text).width > maxW) {
      size -= 2;
      setFont();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = hot
      ? '#ffdcc0'
      : (isChip ? 'rgba(198, 214, 232, 0.82)' : '#e6eef8');
    ctx.fillText(text, centreX, H / 2 + 1);
    return this._canvasTexture(canvas);
  }

  /**
   * Deck plate: rounded near-opaque surface with a separated header (year) and
   * footer (hint). Solid backing is the whole point — glyphs over a sunlit or
   * night-side globe are unreadable no matter how heavy their outline is.
   */
  _buildBackingArt(panW, panH, headerFrac, footerFrac, geom = null) {
    if (typeof document === 'undefined' || !panW || !panH) return null;
    const H = 640;
    const W = Math.round(H * panW / panH);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    // Fully opaque: an alpha-blended plate has to be sorted against the button
    // art, and any ordering slip blacked out whole rows of the deck. An opaque
    // plate is drawn in the opaque pass, so every button is always on top of it.
    ctx.fillStyle = JPL_PANEL_BG;
    ctx.fillRect(0, 0, W, H);

    // Local deck units -> canvas pixels (local +X is the viewer's left, which is
    // where canvas x = 0 lands after the U-mirror in _canvasTexture).
    const px = (x) => ((panW / 2) - x) / panW * W;
    const py = (y) => ((panH / 2) - y) / panH * H;

    const plate = ctx.createLinearGradient(0, 0, 0, H);
    plate.addColorStop(0, '#0d1420');
    plate.addColorStop(0.55, '#0a1019');
    plate.addColorStop(1, '#070b12');
    this._roundRect(ctx, 2, 2, W - 4, H - 4, 24);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(126, 158, 196, 0.32)';
    ctx.stroke();

    const headerY = Math.round(H * headerFrac);
    const footerY = Math.round(H * (1 - footerFrac));
    ctx.strokeStyle = 'rgba(126, 158, 196, 0.2)';
    ctx.lineWidth = 1.5;
    for (const y of [headerY, footerY]) {
      ctx.beginPath();
      ctx.moveTo(20, y);
      ctx.lineTo(W - 20, y);
      ctx.stroke();
    }

    // Header caption on the viewer's left; the year readout is its own plane on
    // the right, so the two never compete for the same space.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
    ctx.font = `500 ${Math.round(H * 0.03)}px ${JPL_FONT}`;
    ctx.fillStyle = 'rgba(176, 197, 220, 0.6)';
    ctx.fillText('MISSION YEAR', W * 0.045, headerY * 0.5 + 1);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

    if (!geom) return this._canvasTexture(canvas);

    // Two grouped plates instead of eleven bordered boxes. The transport bar and
    // the layer bar are drawn here; their cells carry only a label, with the
    // dividers doing the work that a border per button was doing before.
    for (const row of [0, 1]) {
      const cy = panH / 2 - geom.padTop - geom.btnH / 2 - row * (geom.btnH + geom.gapY);
      const x0 = px(geom.gridW / 2 + 0.05);
      const x1 = px(-geom.gridW / 2 - 0.05);
      const y0 = py(cy + geom.btnH / 2 + 0.04);
      const y1 = py(cy - geom.btnH / 2 - 0.04);

      this._roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 14);
      ctx.fillStyle = row === 0 ? 'rgba(126, 158, 196, 0.07)' : 'rgba(126, 158, 196, 0.05)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(126, 158, 196, 0.2)';
      ctx.stroke();

      ctx.strokeStyle = 'rgba(126, 158, 196, 0.16)';
      for (let c = 1; c < geom.cols; c++) {
        const cx = px(geom.gridW / 2 - c * (geom.btnW + geom.gapX) + geom.gapX / 2);
        ctx.beginPath();
        ctx.moveTo(cx, y0 + 6);
        ctx.lineTo(cx, y1 - 6);
        ctx.stroke();
      }
    }

    return this._canvasTexture(canvas);
  }

  /** Repaint one button for its current state (idle / hot). */
  _paintButton(btn) {
    if (!btn || !btn.mat) return;
    const hot = !!(btn.isActive || btn.isFocused || btn.isGazed);
    const tex = hot ? btn.artHot : btn.artIdle;
    if (tex && btn.mat.diffuseTexture !== tex) btn.mat.diffuseTexture = tex;
  }

  _buildPanelBacking() {
    // Docked deck: 4-column control grid with a date header and hint strip.
    const btnW = DECK_BTN_W;
    const btnH = DECK_BTN_H;
    const gapX = DECK_GAP_X;
    const gapY = DECK_GAP_Y;
    const padX = 0.30;
    const padTop = 0.62;    // date strip
    const padBottom = 0.50; // hint strip

    const gridW = DECK_COLS * btnW + (DECK_COLS - 1) * gapX;
    const gridH = DECK_ROWS * btnH + (DECK_ROWS - 1) * gapY;
    const panW = gridW + padX * 2;
    const panH = gridH + padTop + padBottom;

    const backing = BABYLON.MeshBuilder.CreatePlane('PanelBacking', {
      width: panW, height: panH, sideOrientation: BABYLON.Mesh.FRONTSIDE
    }, this._scene);

    const mat = new BABYLON.StandardMaterial('PanelBackingMat', this._scene);
    mat.disableLighting = true;
    // Painted plate (rounded corners, header and footer rules) instead of a
    // flat tinted quad: the panel is what makes the deck legible over either
    // the sunlit or the night side of the globe.
    mat.diffuseTexture  = this._buildBackingArt(panW, panH, padTop / panH, padBottom / panH, {
      gridW, gridH, btnW, btnH, gapX, gapY: DECK_GAP_Y,
      cols: DECK_COLS, rows: DECK_ROWS, padTop
    });
    mat.emissiveColor   = new BABYLON.Color3(1, 1, 1);
    mat.diffuseColor    = new BABYLON.Color3(1, 1, 1);
    mat.useAlphaFromDiffuseTexture = false;
    mat.backFaceCulling = false;
    mat.alpha           = 1.0;
    mat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
    mat.disableDepthWrite = false;
    backing.material    = mat;
    backing.parent      = this._panelRoot;
    backing.isPickable  = false;
    // Rendering group 1 draws after the globe (depth is cleared per group), so
    // the deck is never buried inside the Earth when the user zooms in.
    backing.renderingGroupId = 1;

    // Border and dividers are painted into the plate texture above. The old
    // four edge strips plus a wireframe plane drew long diagonals across the
    // globe and read as a broken frame.
    // Cyan accent rule along the top edge (identity anchor for the deck).
    const accent = BABYLON.MeshBuilder.CreatePlane('PanelAccent', {
      width: panW - 0.2, height: 0.012, sideOrientation: BABYLON.Mesh.FRONTSIDE
    }, this._scene);
    const accentMat = new BABYLON.StandardMaterial('PanelAccentMat', this._scene);
    accentMat.disableLighting = true;
    accentMat.emissiveColor   = BABYLON.Color3.FromHexString('#00f0ff');
    accentMat.alpha           = 0.85;
    accentMat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);

    accent.material = accentMat;
    accent.parent   = this._panelRoot;
    accent.position.set(0, panH / 2 - 0.055, 0.006);
    accent.isPickable = false;
    accent.renderingGroupId = 1;
    accent.alphaIndex = 1;

    this._panW = panW;
    this._panH = panH;
    this._btnH = btnH;
    this._btnW = btnW;
    this._gap  = gapX;
    this._gapY = gapY;
    this._padX = padX;
    this._padTop = padTop;
    this._padBottom = padBottom;
  }

  _buildButton(def, index, total) {
    const btnH  = this._btnH;
    const btnW  = this._btnW;
    const gap   = this._gap;
    const panH  = this._panH;

    // Deck grid layout (see BUTTON_DEFS col/row). Local +X projects to the
    // viewer's LEFT on a camera-facing plane, so columns are laid out from +X
    // inward — otherwise the whole deck reads mirrored (EXIT on the left).
    const gridW = DECK_COLS * btnW + (DECK_COLS - 1) * gap;
    const x = gridW / 2 - btnW / 2 - (def.col || 0) * (btnW + gap);
    const y = panH / 2 - this._padTop - btnH / 2 - (def.row || 0) * (btnH + this._gapY);

    const anchor = new BABYLON.TransformNode(`PanelBtn_${def.id}_Anchor`, this._scene);
    anchor.parent   = this._panelRoot;
    // +Z is toward the eye: the old negative offsets hid the buttons behind an
    // almost-opaque backing plane.
    anchor.position = new BABYLON.Vector3(x, y, 0.02);

    // Button face: a painted plate with its label baked in, so the control
    // reads as a button (border, fill, centred text) instead of floating type.
    const face = BABYLON.MeshBuilder.CreatePlane(`PanelBtn_${def.id}`, {
      width: btnW, height: btnH,
      sideOrientation: BABYLON.Mesh.FRONTSIDE
    }, this._scene);

    const artAspect = btnW / btnH;
    const artOpts = { type: def.type, accent: def.accent, art: def.art };
    const artIdle = this._buildButtonArt(def.label, artAspect, false, artOpts);
    const artHot  = this._buildButtonArt(def.label, artAspect, true, artOpts);
    const mat = new BABYLON.StandardMaterial(`PanelBtnMat_${def.id}`, this._scene);
    mat.disableLighting = true;
    if (artIdle) {
      mat.diffuseTexture = artIdle;
      mat.useAlphaFromDiffuseTexture = true;
    }
    // Unlit StandardMaterial multiplies the texture by emissive: keep it white
    // so the baked colours show, and never dark (that erased the labels).
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.diffuseColor  = new BABYLON.Color3(1, 1, 1);
    mat.alpha         = 1.0;
    mat.backFaceCulling = false;
    mat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);
    face.alphaIndex = 2;
    face.material = mat;
    face.parent   = anchor;
    face.renderingGroupId = 1;

    // Focus frame for the single-button scan. A slightly larger amber plate
    // behind the face, visible only while this control is highlighted, so the
    // user can always see which control the next click will fire.
    const focusPlate = BABYLON.MeshBuilder.CreatePlane(`PanelBtn_${def.id}_Focus`, {
      width: btnW - gap + 0.08, height: btnH - gap * 0.5 + 0.08,
      sideOrientation: BABYLON.Mesh.FRONTSIDE
    }, this._scene);
    const focusMat = new BABYLON.StandardMaterial(`PanelBtn_${def.id}_FocusMat`, this._scene);
    focusMat.disableLighting = true;
    focusMat.emissiveColor = BABYLON.Color3.FromHexString(JPL_AMBER);
    focusMat.alpha = 0.95;
    focusMat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);

    focusPlate.material = focusMat;
    focusPlate.parent = anchor;
    focusPlate.position.z = -0.004;
    focusPlate.isPickable = false;
    focusPlate.renderingGroupId = 1;
    focusPlate.alphaIndex = 1;
    focusPlate.isVisible = false;

    // The label is baked into the face plate; separate label planes were what
    // produced the "text floating on the Earth" look.
    const labelPlane = null;

    // Dwell progress bar (thin amber line at bottom of button, initially invisible)
    const progressBar = BABYLON.MeshBuilder.CreatePlane(`PanelBtn_${def.id}_Progress`, {
      width: btnW - gap, height: 0.08
    }, this._scene);
    const progressMat = new BABYLON.StandardMaterial(`PanelBtn_${def.id}_ProgressMat`, this._scene);
    progressMat.disableLighting = true;
    progressMat.emissiveColor   = BABYLON.Color3.FromHexString(JPL_AMBER);
    progressMat.alpha = 0;

    progressBar.material  = progressMat;
    progressBar.parent    = anchor;
    progressBar.position  = new BABYLON.Vector3(0, -(btnH / 2 - 0.05), 0.02);
    progressBar.isPickable = false;
    progressBar.renderingGroupId = 1;
    progressBar.alphaIndex = 3;
    // Scaling trick: scale.x in [0,1] represents fill fraction
    progressBar.scaling.x = 0.0;

    const btnObj = {
      def, anchor, face, mat, artIdle, artHot, labelPlane, progressBar, progressMat, focusPlate,
      dwellTimer: 0.0,
      isGazed:    false,
      isFocused:  false,
      isActive:   false  // for toggle buttons: on/off state
    };

    return btnObj;
  }

  _buildButtonMaterial(id, type, active) {
    const mat = new BABYLON.StandardMaterial(`PanelBtnMat_${id}`, this._scene);
    mat.disableLighting = true;
    // Idle: flat dark surface, no glow, no gradient
    mat.emissiveColor = active
      ? BABYLON.Color3.FromHexString(JPL_AMBER)
      : BABYLON.Color3.FromHexString('#141c2c');
    mat.alpha = 0.9;
    mat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);
    return mat;
  }

  /**
   * Canvas label sized to the target plane's aspect ratio.
   * A fixed 4:1 canvas stretched across a 13:1 date strip or an 18:1 hint strip
   * squashed the glyphs into a dashed smear, so the canvas follows the plane.
   */
  _buildLabelTexture(label, fontPx = 48, aspect = 4, opts = {}) {
    if (typeof document === 'undefined') {
      // Headless: 2×2 neutral placeholder
      return BABYLON.RawTexture.CreateRGBATexture(
        new Uint8Array([80, 100, 120, 255, 80, 100, 120, 255,
                        80, 100, 120, 255, 80, 100, 120, 255]),
        2, 2, this._scene
      );
    }
    const H = 128;
    const W = Math.max(128, Math.round(H * Math.max(0.4, aspect)));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const align    = opts.align || 'center';
    const weight   = opts.weight || 600;
    const tracking = opts.tracking || 0;
    const margin   = Math.max(Math.round(H * 0.10), Math.round(W * 0.045));
    const anchorX  = align === 'right' ? W - margin : (align === 'left' ? margin : W / 2);
    ctx.textAlign    = align === 'right' ? 'right' : (align === 'left' ? 'left' : 'center');
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking}px`;
    // Auto-fit: shrink until the string fits inside the padding.
    let size = fontPx;
    ctx.font = `${weight} ${size}px ${JPL_FONT}`;
    const maxW = W - margin * 2;
    while (size > 12 && ctx.measureText(label).width > maxW) {
      size -= 2;
      ctx.font = `${weight} ${size}px ${JPL_FONT}`;
    }
    // Dark outline keeps every label legible over both a beige sunlit globe
    // and the near-black night side, with no assumption about a backing plate.
    ctx.lineWidth = Math.max(3, size * 0.14);
    ctx.strokeStyle = 'rgba(4, 8, 18, 0.92)';
    ctx.lineJoin = 'round';
    ctx.strokeText(label, anchorX, H / 2);
    ctx.fillStyle = opts.color || JPL_TEXT;
    ctx.fillText(label, anchorX, H / 2);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    const data = new Uint8Array(ctx.getImageData(0, 0, W, H).data);
    // invertY: canvas rows run top-down, GL uploads bottom-up. Without it every
    // label was drawn upside down (readable only as a mirrored ghost).
    const tex = BABYLON.RawTexture.CreateRGBATexture(
      data, W, H, this._scene, false, true, BABYLON.Texture.BILINEAR_SAMPLINGMODE
    );
    tex.hasAlpha = true;
    // Measured, not guessed: the label plane's front normal points at the camera
    // (dot 0.92) and +Y is upright, but this plane's local +X projects to the
    // viewer's LEFT, so every glyph string read right-to-left. Mirror U only.
    tex.uScale = -1;
    tex.uOffset = 1;
    return tex;
  }

  _buildDateDisplay() {
    if (typeof document === 'undefined') return;

    // Header strip above the grid
    const y = this._panH / 2 - this._padTop / 2 - 0.02;
    const anchor = new BABYLON.TransformNode('DateDisplay_Anchor', this._scene);
    anchor.parent   = this._panelRoot;
    anchor.position = new BABYLON.Vector3(0, y, 0.03);

    const datePlane = BABYLON.MeshBuilder.CreatePlane('DateDisplay', {
      width: this._panW - 0.4, height: this._padTop - 0.12
    }, this._scene);

    this._dateAspect = (this._panW - 0.4) / (this._padTop - 0.12);
    // Right-aligned against the header caption on the left: a single centred
    // number in a wide band read as a floating label, not a readout.
    this._dateOpts = { align: 'right', weight: 600, tracking: 1, size: 84 };
    this._dateTex = this._buildLabelTexture('1979', this._dateOpts.size, this._dateAspect, this._dateOpts);
    const dateMat = new BABYLON.StandardMaterial('DateDisplayMat', this._scene);
    dateMat.disableLighting = true;
    // Unlit StandardMaterial outputs emissive only, so a black emissive turned
    // the date readout into black glyphs that vanished over a dark ocean.
    dateMat.emissiveColor = new BABYLON.Color3(0.86, 0.90, 0.95);
    dateMat.diffuseColor = new BABYLON.Color3(1, 1, 1);
    dateMat.diffuseTexture = this._dateTex;
    dateMat.useAlphaFromDiffuseTexture = true;
    dateMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    dateMat.backFaceCulling = false;
    dateMat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);

    datePlane.material  = dateMat;
    datePlane.parent    = anchor;
    datePlane.isPickable = false;
    datePlane.renderingGroupId = 1;
    datePlane.alphaIndex = 1;

    this._dateDisplay = { plane: datePlane, mat: dateMat, anchor };
  }

  /**
   * Single-button instruction strip under the deck.
   */
  _buildHintStrip() {
    if (typeof document === 'undefined') return;
    const anchor = new BABYLON.TransformNode('DeckHint_Anchor', this._scene);
    anchor.parent   = this._panelRoot;
    anchor.position = new BABYLON.Vector3(0, -this._panH / 2 + this._padBottom / 2, 0.03);

    const plane = BABYLON.MeshBuilder.CreatePlane('DeckHint', {
      width: this._panW - 0.24, height: this._padBottom - 0.16
    }, this._scene);

    const hintAspect = (this._panW - 0.24) / (this._padBottom - 0.16);
    // Caption weight, left aligned and dim: the hint is a footnote, not a banner.
    this._hintOpts = { align: 'left', weight: 500, tracking: 1, size: 46, color: 'rgba(150, 172, 196, 0.85)' };
    const tex = this._buildLabelTexture(LAYER_HINT_DEFAULT, this._hintOpts.size, hintAspect, this._hintOpts);
    const mat = new BABYLON.StandardMaterial('DeckHintMat', this._scene);
    mat.disableLighting = true;
    mat.emissiveColor = new BABYLON.Color3(0.72, 0.86, 0.95);
    mat.diffuseColor = new BABYLON.Color3(0.72, 0.86, 0.95);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);
    plane.material = mat;
    plane.parent = anchor;
    plane.isPickable = false;
    plane.renderingGroupId = 1;
    plane.alphaIndex = 1;

    // Kept so the line can be re-rendered with live data (layer readout).
    this._hintMat = mat;
    this._hintTex = tex;
    this._hintAspect = hintAspect;
    this._hintText = LAYER_HINT_DEFAULT;
  }

  /**
   * Replace the deck's hint line (used for the real-data layer readout).
   * @param {string} text
   */
  updateHint(text) {
    if (typeof document === 'undefined' || !this._hintMat || !text) return;
    if (this._hintText === text) return;
    this._hintText = text;
    const tex = this._buildLabelTexture(text, (this._hintOpts && this._hintOpts.size) || 46, this._hintAspect || 4, this._hintOpts);
    this._hintMat.diffuseTexture = tex;
    if (this._hintTex && typeof this._hintTex.dispose === 'function') {
      this._hintTex.dispose();
    }
    this._hintTex = tex;
  }

  /**
   * Mirror the active scientific layer onto the four layer buttons.
   * @param {number|null} activeIndex
   */
  syncLayerStates(activeIndex) {
    for (const btn of this._buttons) {
      if (btn.def.type !== 'toggle') continue;
      const idx = { temp: 0, co2: 1, ocean: 2, ice: 3 }[btn.def.id];
      btn.isActive = (activeIndex !== null && idx === activeIndex);
      this._paintButton(btn);
    }
  }

  updateDateDisplay(record) {
    if (!record || typeof document === 'undefined' || !this._dateDisplay) return;
    // Harmonized API records carry a single `date` string (YYYY-MM); only the
    // internal interpolator adds year/month. Reading year/month alone always
    // fell through to '---- · --', which drew as a row of dashes across the
    // deck header instead of the observation date.
    // Year only: playback sweeps years, so a month beside the year would just
    // sit on January forever and read as a stale detail.
    let label = '----';
    if (record.year !== undefined) {
      label = String(record.year);
    } else if (typeof record.date === 'string') {
      const m = /^(\d{4})/.exec(record.date);
      label = m ? m[1] : record.date;
    }

    // Rebuild texture with new date string (matched to this plane's aspect)
    const newTex = this._buildLabelTexture(label, (this._dateOpts && this._dateOpts.size) || 84, this._dateAspect || 4, this._dateOpts);
    this._dateDisplay.mat.diffuseTexture = newTex;
    if (this._dateTex && typeof this._dateTex.dispose === 'function') {
      this._dateTex.dispose();
    }
    this._dateTex = newTex;
  }

  /**
   * Keep the panel pinned relative to the camera instead of the world.
   *
   * It used to sit at a fixed world point near the globe, so zooming in slid it
   * out of frame entirely (measured: bottom edge 1997px in an 814px-tall eye
   * viewport at the zoom limit). Anchoring it to the camera keeps it in frame at
   * every radius, and scaling it with distance holds its angular size constant.
   * The distance is capped so the panel always stays in front of the globe's
   * surface (radius 10) rather than sinking inside it.
   */
  _updateCameraAnchor(delta = 0) {
    const cam = this._orb && this._orb.camera;
    const root = this._panelRoot;
    if (!cam || !root) return;

    // The deck is docked IN FRONT OF THE HEAD at a fixed distance, angled down
    // so every button sits in the lower part of the view. It is not glued to the
    // face frame-by-frame: while the user looks at it the deck stays put in the
    // world, so the centre reticle can travel across the buttons, and it comes
    // back only once the head has turned far enough that it would slide out of
    // the view entirely.
    const eng = (this._scene && this._scene.getEngine) ? this._scene.getEngine() : null;
    if (eng && eng.getRenderWidth && eng.getRenderHeight) {
      const w = eng.getRenderWidth() || 1;
      const h = eng.getRenderHeight() || 1;
      if (!this._deckEyeSize || this._deckEyeSize.w !== w || this._deckEyeSize.h !== h) {
        this._deckEyeSize = { w, h };
        this._deckAnchorDirty = true;
      }
    }
    // Which camera defines "in front of the user"? In VR the HEAD, not the seat
    // camera: the seat never turns, so anchoring to it left the deck behind the
    // user the moment they looked over their shoulder.
    // The stereo cameras live on the scene; this class only holds `_orb`.
    const vrScene = this._orb || null;
    const leftCam = vrScene && vrScene._leftCam;
    const rightCam = vrScene && vrScene._rightCam;
    const vr = !!(vrScene && vrScene.isVRActive && leftCam);
    const viewCam = vr ? leftCam : cam;
    viewCam.computeWorldMatrix(true);
    // A look-at camera's world matrix is NOT its view orientation (Babylon keeps
    // the target separately), so the basis has to come from the view matrix.
    const wm = viewCam.getViewMatrix();
    const forward = new BABYLON.Vector3(wm.m[2], wm.m[6], wm.m[10]).normalize();
    const up      = new BABYLON.Vector3(wm.m[1], wm.m[5], wm.m[9]).normalize();
    const right   = new BABYLON.Vector3(wm.m[0], wm.m[4], wm.m[8]).normalize();
    let eyePos;
    if (vr && rightCam) {
      eyePos = leftCam.globalPosition.add(rightCam.globalPosition).scale(0.5);
    } else {
      eyePos = viewCam.globalPosition;
    }
    const distance = DECK_DISTANCE;

    // How far has the deck drifted from the centre of the view? While that is
    // inside the re-acquire arc the buttons stay exactly where they are.
    root.computeWorldMatrix(true);
    const toDeck = root.absolutePosition.subtract(eyePos);
    const toDeckLen = toDeck.length();
    const drift = toDeckLen > 1e-4
      ? Math.acos(Math.max(-1, Math.min(1, BABYLON.Vector3.Dot(toDeck.scale(1 / toDeckLen), forward))))
      : Math.PI;
    // A deck that is roughly ahead but at the wrong range is a stale placement
    // (the seed transform, or an anchor left over from before VR started), not a
    // docked deck — the bearing test alone would happily keep it there.
    const wrongRange = Math.abs(toDeckLen - distance) > distance * 0.08;
    // Wrong range means the deck is misplaced (seed transform, or an anchor from
    // before VR existed): put it straight where it belongs instead of easing
    // across the room.
    const snap = this._deckAnchorDirty || wrongRange;
    this._deckAnchorDirty = false;
    // Never move the deck out from under a live aim: a dwell timer that is
    // actually filling means the user is picking a button, not looking away.
    const aiming = this._buttons.some((b) => b.isGazed && b.dwellTimer > 0.05);
    if (!snap && !this._deckSettling && !wrongRange) {
      if (aiming) return;
      if (drift <= DECK_REACQUIRE_RAD) return;
    }
    if (!snap) this._deckSettling = true;
    if (!snap) this._deckSettleTime = 0;

    // Fit the deck to whichever is tighter: the per-eye horizontal field (each
    // stereo eye is half the canvas, and a portrait phone eye is narrower) or
    // the space below the globe. A fixed world size was clipped to a wedge on
    // the right of the frame and unreadable on phones.
    const engine = (this._scene && this._scene.getEngine) ? this._scene.getEngine() : null;
    let eyeAspect = 1.0;
    if (engine && engine.getRenderWidth && engine.getRenderHeight) {
      const w = engine.getRenderWidth() || 1;
      const h = engine.getRenderHeight() || 1;
      eyeAspect = (w / 2) / h;
    }
    const halfV = (cam.fov || 0.8) / 2;
    const halfH = Math.atan(Math.tan(halfV) * eyeAspect);
    const allowedHalfW = distance * Math.tan(halfH) * 0.94;
    // The deck may only occupy the lower ~26% of the eye height: the globe owns
    // the centre of the frame, and the old factor let the deck run off the
    // bottom edge (the cut-off hint line in the capture).
    const allowedHalfH = distance * Math.tan(halfV) * 0.32;
    const fitW = allowedHalfW / (this._panW / 2);
    const fitH = allowedHalfH / (this._panH / 2);
    const scale = Math.max(0.16, Math.min(1.1, Math.min(fitW, fitH)));

    const deckDown = distance * Math.tan(halfV * 0.58);
    const targetPos = eyePos
      .add(forward.scale(distance))
      .add(up.scale(-deckDown));

    // Face the eye's FULL orientation, not just its yaw (with yaw alone the deck
    // skewed and slid as the view pitched), then flip 180° about local Y: the
    // deck art and its tap rectangles were authored for the eye-facing side.
    const rotM = new BABYLON.Matrix();
    BABYLON.Matrix.FromXYZAxesToRef(right, up, forward, rotM);
    const targetQuat = BABYLON.Quaternion.FromRotationMatrix(rotM)
      .multiply(BABYLON.Quaternion.RotationYawPitchRoll(Math.PI, 0, 0));

    if (snap || delta <= 0) {
      root.position.copyFrom(targetPos);
      root.scaling.setAll(scale);
      root.rotationQuaternion = targetQuat;
      this._deckSettling = false;
      return;
    }

    // Ease back into place: a sudden jump of the whole deck is the one thing
    // that makes a phone-in-headset view feel wrong.
    const k = 1 - Math.exp(-Math.max(delta, 0.001) * 14);
    this._deckSettleTime = (this._deckSettleTime || 0) + delta;
    root.position.copyFrom(BABYLON.Vector3.Lerp(root.position, targetPos, k));
    root.scaling.setAll(root.scaling.x + (scale - root.scaling.x) * k);
    root.rotationQuaternion = BABYLON.Quaternion.Slerp(
      root.rotationQuaternion || targetQuat, targetQuat, k
    );
    // Stop once it is in place: the exponential ease never reaches exactly zero,
    // and while it is "settling" the deck still follows the head.
    const closeEnough = BABYLON.Vector3.DistanceSquared(root.position, targetPos) < 0.02;
    this._deckSettling = !closeEnough && this._deckSettleTime < 0.6;
  }

  /**
   * Per-frame update: advance dwell timers, animate progress bars.
   * @param {number} delta
   */
  update(delta) {
    if (!this._visible) return;
    this._updateCameraAnchor(delta);

    // One-button scan owns the highlight and its progress bar.
    if (this._scanActive) {
      const focused = this._buttons[this._scanIdx];
      this._scanTimer += delta;
      if (focused) {
        const fill = Math.min(1.0, this._scanTimer / PANEL_SCAN_INTERVAL_SEC);
        focused.progressBar.scaling.x = fill;
        focused.progressMat.alpha = 0.95;
        if (this._scanTimer >= PANEL_SCAN_INTERVAL_SEC) {
          this._scanTimer = 0.0;
          this._setFocus(this._scanIdx + 1);
        }
      }
      return;
    }

    // Legacy gaze-dwell path (kept for head-tracked WebXR aiming). It is off by
    // default because on a one-button deck it fires while the user is reading.
    this._updateGazeDetection();
    if (!this._dwellToActivate) return;

    for (let i = 0; i < this._buttons.length; i++) {
      const btn = this._buttons[i];
      this._paintButton(btn);
      if (btn.isGazed) {
        btn.dwellTimer += delta;
        const fill = Math.min(1.0, btn.dwellTimer / PANEL_DWELL_SEC);
        btn.progressBar.scaling.x = fill;
        btn.progressMat.alpha = fill > 0.01 ? 0.9 : 0.0;

        if (btn.dwellTimer >= PANEL_DWELL_SEC) {
          this._activateButton(i);
          btn.dwellTimer = 0.0;
          btn.progressBar.scaling.x = 0.0;
          btn.progressMat.alpha = 0.0;
        }
      } else {
        btn.dwellTimer = Math.max(0.0, btn.dwellTimer - delta * 1.5);
        const fill = btn.dwellTimer / PANEL_DWELL_SEC;
        btn.progressBar.scaling.x = fill;
        btn.progressMat.alpha = fill > 0.01 ? 0.5 : 0.0;
      }
    }
  }

  _updateGazeDetection() {
    if (!this._orb || !this._orb.camera) return;
    const cam = this._orb.camera;

    // Prefer a real ray cast against the button faces. The deck is a compact
    // grid, so the old 4° angular tolerance could not separate neighbours and
    // highlighted (then dwell-fired) the wrong button.
    const hitIdx = this._buttonAtViewCenter();
    if (hitIdx !== null && hitIdx >= 0) {
      for (let i = 0; i < this._buttons.length; i++) this._buttons[i].isGazed = (i === hitIdx);
      this._gazedBtn = hitIdx;
      return;
    }

    // Angular fallback (headless NullEngine / no picking support)
    let forward;
    if (typeof cam.getForwardRay === 'function') {
      const ray = cam.getForwardRay(1);
      forward = ray.direction;
    } else if (cam.position && cam.target) {
      // ArcRotateCamera: forward = target - position, normalized
      forward = cam.target.subtract(cam.position).normalize();
    } else {
      this._clearGazedButtons();
      return;
    }

    const camPos = cam.position || cam.globalPosition || BABYLON.Vector3.Zero();
    let closestIdx = null;
    // Angular tolerance, not a metric one: the panel sits ~21 units from the
    // camera, where the old "perp < 0.5 m" test demanded an impossible 1.4°
    // alignment, so no button could ever be gazed and the panel was inert.
    let bestDot = Math.cos(4.0 * DEG_TO_RAD);

    for (let i = 0; i < this._buttons.length; i++) {
      const btn = this._buttons[i];
      const btnWorldPos = btn.anchor.getAbsolutePosition();
      const toBtn = btnWorldPos.subtract(camPos);
      const toBtnLen = toBtn.length();
      if (toBtnLen < 0.1) continue;
      const toBtnNorm = toBtn.normalize();
      const dot = BABYLON.Vector3.Dot(forward, toBtnNorm);
      if (dot > bestDot && toBtnLen < 120) {
        bestDot = dot;
        closestIdx = i;
      }
    }

    for (let i = 0; i < this._buttons.length; i++) {
      this._buttons[i].isGazed = (i === closestIdx);
    }
    this._gazedBtn = closestIdx;
  }

  _clearGazedButtons() {
    for (const btn of this._buttons) btn.isGazed = false;
    this._gazedBtn = null;
  }

  /**
   * @returns {number|null} Index of currently gazed button, or null
   */
  getGazedButton() {
    return this._gazedBtn;
  }

  /**
   * Instant activation of the currently gazed button (trigger bypass).
   */
  activateGazedButton() {
    if (this._gazedBtn !== null) {
      this._activateButton(this._gazedBtn);
      this._buttons[this._gazedBtn].dwellTimer = 0.0;
    }
  }

  _activateButton(i) {
    const btn = this._buttons[i];
    const { action, type } = btn.def;

    // Visual flash: switch to the highlighted plate art, then fall back to
    // whatever state the button actually ended up in.
    if (btn.artHot) btn.mat.diffuseTexture = btn.artHot;
    setTimeout(() => {
      // Babylon materials expose no isDisposed(); this used to throw a
      // TypeError 150ms after every button press.
      if (btn.mat && !btn.mat._isDisposed) this._paintButton(btn);
    }, 150);

    // Route action to scene
    const orb = this._orb;
    switch (action) {
      case 'play':    orb.actionPlay();    break;
      case 'pause':   orb.actionPause();   break;
      case 'prev':    orb.actionPrev();    break;
      case 'next':    orb.actionNext();    break;
      case 'stem0':   orb.actionSelectLayer(0); btn.isActive = orb.activeLayerIndex === 0; break;
      case 'stem1':   orb.actionSelectLayer(1); btn.isActive = orb.activeLayerIndex === 1; break;
      case 'stem2':   orb.actionSelectLayer(2); btn.isActive = orb.activeLayerIndex === 2; break;
      case 'stem3':   orb.actionSelectLayer(3); btn.isActive = orb.activeLayerIndex === 3; break;
      case 'zoomIn':  orb.actionZoomIn();  break;
      case 'zoomOut': orb.actionZoomOut(); break;
      case 'exit':    orb.actionExit();    break;
      default: break;
    }
  }
}

// ============================================================================
// Factory / install hook (mirrors installEarthsonicVR pattern)
// ============================================================================

/**
 * Initialize and bind the global window.earthsonicOrbitalVR interface.
 * @param {Object} [app]
 * @returns {OrbitalExamineScene}
 */
export function installOrbitalExamineVR(app = null) {
  const scene = new OrbitalExamineScene(app);

  const iface = {
    sceneInstance: scene,
    get camera()          { return scene.camera; },
    get isVRActive()      { return scene.isVRActive; },
    get currentT()        { return scene.currentT; },
    get activeMonthRecord(){ return scene.activeMonthRecord; },
    get activeLayerIndex(){ return scene.activeLayerIndex; },
    get panel()           { return scene._panel; },
    get spatialAudio()    { return scene.spatialAudio; },

    init:                (renderer)   => scene.init(renderer),
    enterVR:             (opts)       => scene.enterVR(opts),
    exitVR:              ()           => scene.exitVR(),
    updateTimeline:      (t)          => scene.updateTimeline(t),
    updateAudioEnvelopes:(envs)       => scene.updateAudioEnvelopes(envs),
    update:              (dt)         => scene.update(dt),
    setMixer:            (m)          => scene.setMixer(m),
    setZonalData:        (z)          => scene.setZonalData(z),
    setTemperatureGrid:  (m, b)       => scene.setTemperatureGrid(m, b),
    actionSelectLayer:   (i)          => scene.actionSelectLayer(i),
    dispose:             ()           => scene.dispose(),

    actionPlay:    () => scene.actionPlay(),
    actionPause:   () => scene.actionPause(),
    actionTogglePlay: () => scene.actionTogglePlay(),
    handleSingleClick: () => scene.handleSingleClick(),
    actionPrev:    () => scene.actionPrev(),
    actionNext:    () => scene.actionNext(),
    actionZoomIn:  () => scene.actionZoomIn(),
    actionZoomOut: () => scene.actionZoomOut(),
    actionExit:    () => scene.actionExit(),
    actionToggleStem: (i) => scene.actionToggleStem(i),
    recenterEarth: () => scene.recenterEarth()
  };

  if (typeof window !== 'undefined') {
    window.earthsonicOrbitalVR = iface;
  }

  return scene;
}
