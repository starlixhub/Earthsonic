/**
 * frontend/js/globe/vr/vr_scene.js
 * Normalized Planetary Scene Graph & Terminator Skim VR Orchestrator.
 * Milestone M2: Features 9 through 17. Babylon.js port (VR-MIGRATION-2026).
 *
 * Invariants (unchanged from the verified build):
 *   - EARTH_RADIUS = 10.0, Skim Altitude = 10.22, near = 0.05, far = 250.0
 *   - Tone mapping = ACES, exposure = 1.0
 *   - Camera vertical FOV = 75°, horizon dip = 11.91° filling ~70% lower visual field
 *   - 100% locked horizontal horizon (roll = 0.0°)
 *   - Decoupled from 2D globe.js (2D globe remains 100% intact)
 *
 * Port notes / documented deviations:
 *   1. Engine ownership: Babylon cannot share the 2D globe's WebGL context, so
 *      this scene owns a DEDICATED full-screen canvas + BABYLON.Engine,
 *      created in init() and only shown while this.isVRActive. In Node/headless
 *      (no `document`) a BABYLON.NullEngine is used so the whole scene graph
 *      constructs headlessly for tests.
 *   2. init(renderer) keeps the historical signature for vr_launcher.js
 *      compatibility but the argument is ACCEPTED AND IGNORED: the 2D
 *      THREE.WebGLRenderer is not touched and tone mapping lives on
 *      scene.imageProcessingConfiguration (ACES, exposure 1.0) as mandated.
 *   3. SurfaceMesh keeps the ported verified GLSL (VRSurfaceShader) instead of
 *      the task-sketch PBRMaterial idea — shader parity outranks API parity
 *      for the verified terminator/specular look (task §GLSL INVARIANTS).
 *   4. CloudLayer follows the task prescription: BABYLON.PBRMaterial with an
 *      alphaTexture. The verified cloud pre-bake (256x128 box-filter) now also
 *      converts the MODIS grayscale into an RGBA map whose ALPHA channel holds
 *      the cloud mask (PBRMaterial.alphaTexture samples the alpha channel).
 *   5. Textures load through an HTMLImageElement -> RawTexture pipeline so the
 *      verified "VR TEXTURE VERIFIED / FAILURE" logging + labelled-placeholder
 *      protocol is preserved byte-for-byte. invertY = true mirrors
 *      three.js TextureLoader's flipY = true (equirect north-up orientation).
 *   6. Diegetic glyphs gain Babylon-native 3D GUI hover routing: a thin
 *      DwellGlyphControl3D (extends BABYLON_GUI.Control3D) wraps each hitbox in
 *      a GUI3DManager, giving engine-native pointer/gaze-pick hover events
 *      (ActionManager-style routing on the utility layer) in addition to the
 *      mandatory controller-free head-gaze dwell machine (VRGazeController).
 *   7. BUG FIX versus the verified build (documented): the old loop stepped
 *      glider/gaze/audio TWICE per frame (tick() AND renderer._updateSubsystems
 *      both called update with the same delta). This port updates each
 *      subsystem exactly once per frame in _updateSubsystems; tick() now only
 *      advances scene-graph state. Windows-verified constants (GLIDER_*,
 *      GAZE_DWELL_THRESHOLD_SEC) therefore hold their tested semantics.
 *   8. _renderStereoFrame etc. see vr_renderer.js; scene.render() is driven by
 *      VRRenderer's rAF loop exactly once per frame (mono / dual-viewport
 *      stereo / WebXR per-eye views all resolve inside Babylon).
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';
import { BABYLON_GUI } from '../../../vendor/babylon/babylon.core.module.js';
import {
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader,
  VRShaderMaterial,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  createGlyphProgressRing,
  updatePlanetaryShaders
} from './vr_shaders.js';
import { createGaiaStarfieldMesh, STARFIELD_RADIUS } from './vr_starfield.js';
import { TOTAL_MONTHS, interpolateHarmonizedRecord } from './vr_timeline.js';
import { createTimeSpline, getSplineFrame, SKIM_ALTITUDE } from './vr_spline.js';
import { VRGliderNavigation, VRGlider } from './vr_glider.js';
import { VRGazeController } from './vr_gaze.js';
import { VRSpatialAudio } from './vr_audio.js';
import { VRRenderer, computeScissorStereo, DEFAULT_EYE_SEP } from './vr_renderer.js';

export const EARTH_RADIUS = 10.0;
export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR = 250.0;
export const HORIZON_DIP_DEG = 11.91;

const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Controller for single-fire fading onboarding prompt.
 * Feature 25 (R6): Displays for ~3.0s on first VR entry, then fades completely over 800ms.
 * (Unchanged: pure DOM.)
 */
export class VROnboardingController {
  constructor() {
    this.hasShown = false;
    this.timer = null;
    this.fadeTimer = null;
  }

  show() {
    if (this.hasShown || typeof document === 'undefined') return;
    this.hasShown = true;
    const el = document.getElementById('vr-onboarding-prompt');
    if (!el) return;

    el.classList.remove('hidden', 'faded');
    el.classList.add('visible');

    this.timer = setTimeout(() => {
      el.classList.remove('visible');
      el.classList.add('faded');
      this.fadeTimer = setTimeout(() => {
        el.classList.add('hidden');
      }, 800);
    }, 3000);
  }

  reset() {
    if (this.timer) clearTimeout(this.timer);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    if (typeof document !== 'undefined') {
      const el = document.getElementById('vr-onboarding-prompt');
      if (el) {
        el.classList.remove('visible');
        el.classList.add('faded', 'hidden');
      }
    }
  }
}

/**
 * Controller for amber ring loading state overlay.
 * Feature 26 (R6): Amber ring spinner during VR scene initialization and asset loading.
 * (Unchanged: pure DOM.)
 */
export class VRLoadingController {
  show() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('vr-loading-overlay');
    if (el) el.classList.remove('hidden');
  }

  hide() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('vr-loading-overlay');
    if (el) el.classList.add('hidden');
  }
}

/**
 * Thin Babylon 3D-GUI control wrapping a diegetic DataGlyph hitbox mesh.
 * Control3D._prepareNode injects reservedDataStore.GUI3D.control = this so
 * GUI3DManager picks (utility layer picking with pickUtilitySceneFirst=false)
 * route pointer/enter/out events natively — no hand-rolled ray counting.
 */
class DwellGlyphControl3D extends BABYLON_GUI.Control3D {
  constructor(name, hitboxMesh) {
    super(name);
    this._hitboxMesh = hitboxMesh;
  }

  // Return the pre-built, pre-parented hitbox; the base class then marks it
  // pickable and registers it on reservedDataStore.
  _createNode(scene) {
    return this._hitboxMesh;
  }
}

export class TerminatorSkimVRScene {
  constructor(app = null) {
    this.app = app;
    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.renderer = null; // historical 2D renderer handle (accepted, unused)

    // Babylon engine handles
    this.engine = null;
    this._vrCanvas = null;

    // TimeSpline & Records
    this.timeSpline = null;
    this.harmonizedRecords = [];
    this.currentT = 0.0;
    this.activeMonthRecord = null;

    // Scene Graph Hierarchy
    this.celestialPivot = null;
    this.earthGroup = null;
    this.surfaceMesh = null;
    this.cloudLayer = null;
    this.atmosphereShell = null;
    this.iceCapGroup = null;
    this.terminatorRibbon = null;
    this.oceanGlowField = null;
    this.starfieldSkybox = null;
    this.sunLight = null;
    this.ambientLight = null;
    this.dataGlyphs = [];

    // Babylon 3D GUI (diegetic glyph hover routing)
    this.gui3DManager = null;
    this._glyphControls = [];

    // Milestone M3 Subsystems: Glider, Gaze, Spatial Audio
    this.glider = null;
    this.gazeController = null;
    this.spatialAudio = null;

    // Milestone M4: Dual-Mode Renderer, Diegetic Zenith Ring, Onboarding & Loading Controllers
    this.vrRenderer = null;
    this.zenithRing = null;
    this.onboardingController = new VROnboardingController();
    this.loadingController = new VRLoadingController();

    // Audio Envelopes (Stems 0..3)
    this.audioEnvelopes = [0.0, 0.0, 0.0, 0.0];

    // State
    this.isVRActive = false;
    this.elapsedTime = 0.0;
    this.subsolarVector = { x: 0.5, y: 0.2, z: 0.5 }; // normalized on first init
    {
      const len = Math.hypot(this.subsolarVector.x, this.subsolarVector.y, this.subsolarVector.z) || 1;
      this.subsolarVector = {
        x: this.subsolarVector.x / len,
        y: this.subsolarVector.y / len,
        z: this.subsolarVector.z / len
      };
    }
  }

  async init(renderer = null) {
    // Historical signature kept for vr_launcher.js: init(this.globe.renderer).
    // Babylon owns rendering — the 2D renderer handle is accepted and ignored.
    this.renderer = renderer || null;

    // ---- Dedicated Babylon canvas + engine ---------------------------------
    if (typeof document !== 'undefined') {
      this._vrCanvas = this._ensureVRCanvas();
      try {
        this.engine = new BABYLON.Engine(this._vrCanvas, true, {
          preserveDrawingBuffer: false,
          stencil: true,
          alpha: false,
          antialias: true,
          powerPreference: 'high-performance',
          disableWebGL2Support: false
        }, true);
      } catch (engineErr) {
        console.error('[VR SCENE] WebGL engine creation failed, falling back to NullEngine (headless visuals):',
          engineErr && engineErr.message ? engineErr.message : engineErr);
        this.engine = new BABYLON.NullEngine();
        this._nullEngineFallback = true;
      }
    } else {
      this.engine = new BABYLON.NullEngine();
      this._nullEngineFallback = true;
    }

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.name = 'EarthsonicVR_Scene';
    this.scene.clearColor = new BABYLON.Color4(0.004, 0.008, 0.02, 1.0); // #010408 space void

    // ---- ACES tone mapping (Task §1: ImageProcessingConfiguration) ---------
    const ipc = this.scene.imageProcessingConfiguration;
    ipc.toneMappingEnabled = true;
    ipc.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    ipc.exposure = 1.0;
    ipc.contrast = 1.0;

    // 1. CameraRig & PerspectiveCamera
    this._initCamera();

    // 2. Solar & Ambient Lighting
    this._initLighting();

    // 3. Babylon 3D GUI manager (diegetic glyph hover routing)
    this.gui3DManager = new BABYLON_GUI.GUI3DManager(this.scene);

    // 4. Planetary Hierarchy (EarthGroup & Concentric Physical Layers)
    await this._initEarthGroup();

    // 5. Gaia Deep Starfield Skybox
    this._initStarfield();

    // 6. 573-Month TimeSpline
    this._initTimeSpline();

    // 7. Diegetic Horizon DataGlyphs (+ 3D GUI dwell controls)
    this._initDataGlyphs();

    // 7b. Diegetic Zenith Progress Ring
    this._initZenithGlyph();

    // 8. Milestone M3: Glider Navigation, Gaze Controller, 3D HRTF Spatial Audio
    this.glider = new VRGliderNavigation(this);
    if (this.engine && typeof this.engine.getRenderingCanvas === 'function') {
      this.glider.init(this.engine.getRenderingCanvas());
    }
    this.gazeController = new VRGazeController(this, this.app ? this.app.mixer : null, {
      onZenithExit: () => this.exitVR()
    });
    this.gazeController.init();
    this.spatialAudio = new VRSpatialAudio({
      app: this.app,
      scene: this,
      camera: this.camera,
      dataGlyphs: this.dataGlyphs
    });
    if (this.app && this.app.mixer) {
      this.setMixer(this.app.mixer);
    }

    // 9. Milestone M4: Dual-Mode VR Renderer
    this.vrRenderer = new VRRenderer({
      vrScene: this,
      glider: this.glider,
      gaze: this.gazeController,
      audio: this.spatialAudio,
      onStop: () => this.exitVR()
    });
    this.vrRenderer.init(this.scene, this.cameraRig, this.camera, this.engine);

    // Initial timeline positioning at 1979-01 (t=0.0)
    this.updateTimeline(0.0);
  }

  /**
   * Dedicated full-screen Babylon canvas. Only visible while
   * body.vr-mode-active is set (display handled by injected CSS below).
   */
  _ensureVRCanvas() {
    let canvas = document.getElementById('vr-canvas-babylon');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'vr-canvas-babylon';
      canvas.className = 'vr-babylon-canvas';
      // Same reason as the orbital deck: this canvas can hold focus, and a
      // focused aria-hidden element is an accessibility error in Chromium.
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'Earthsonic VR globe view');
      document.body.appendChild(canvas);
    }
    if (!document.getElementById('vr-babylon-canvas-styles')) {
      const style = document.createElement('style');
      style.id = 'vr-babylon-canvas-styles';
      style.textContent = [
        '.vr-babylon-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh;',
        '  display: none; z-index: 70; outline: none; touch-action: none; }',
        'body.vr-mode-active .vr-babylon-canvas { display: block; }'
      ].join('\n');
      document.head.appendChild(style);
    }
    return canvas;
  }

  _initCamera() {
    this.cameraRig = new BABYLON.TransformNode('CameraRig', this.scene);

    // FOV 75°, near 0.05, far 250.0 (Babylon fov is vertical radians)
    this.camera = new BABYLON.UniversalCamera('VR_PerspectiveCamera',
      BABYLON.Vector3.Zero(), this.scene);
    this.camera.name = 'VR_PerspectiveCamera';
    this.camera.fov = (75.0 * Math.PI) / 180.0;
    this.camera.minZ = CAMERA_NEAR;
    this.camera.maxZ = CAMERA_FAR;

    this.camera.parent = this.cameraRig;
  }

  _initLighting() {
    this.celestialPivot = new BABYLON.TransformNode('CelestialPivot', this.scene);
    this.celestialPivot.rotation.z = -(23.44 * DEG_TO_RAD); // 23.44° axial tilt

    // Directional Sunlight (5778K solar white 0xfff4e0, intensity 3.2 calibrated for ACES)
    this.sunLight = new BABYLON.DirectionalLight('SunLight',
      new BABYLON.Vector3(-1, 0, -0.5).normalize(), this.scene);
    this.sunLight.name = 'SunLight';
    this.sunLight.position.set(50.0, 20.0, 50.0);
    this.sunLight.diffuse = BABYLON.Color3.FromHexString('#fff4e0');
    this.sunLight.specular = new BABYLON.Color3(0.6, 0.58, 0.52);
    this.sunLight.intensity = 3.2;
    this.sunLight.parent = this.celestialPivot;

    // Space Ambient (HemisphereLight 0x2a4d6e / 0x0a0a12, intensity 0.15)
    this.ambientLight = new BABYLON.HemisphericLight('SpaceAmbientLight',
      new BABYLON.Vector3(0, 1, 0), this.scene);
    this.ambientLight.name = 'SpaceAmbientLight';
    this.ambientLight.diffuse = BABYLON.Color3.FromHexString('#2a4d6e');
    this.ambientLight.groundColor = BABYLON.Color3.FromHexString('#0a0a12');
    this.ambientLight.intensity = 0.15;
  }

  async _initEarthGroup() {
    this.earthGroup = new BABYLON.TransformNode('EarthGroup', this.scene);
    this.earthGroup.parent = this.celestialPivot;

    const basePath = '/assets/textures/';

    /**
     * Dataset verification requirement (R2): every texture fetch is logged and
     * checked. On failure we render a CLEARLY LABELLED flat placeholder and
     * surface the failure in the console — never a silent solid color.
     *
     * Babylon port: HTMLImageElement -> canvas -> RawTexture. Mipmaps +
     * trilinear filtering preserved; invertY = true mirrors three's flipY.
     */
    const loadImageElement = (url) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Image load failed: ${url}`));
      img.src = url;
    });

    const rawTextureFromImage = (img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
      const tex = BABYLON.RawTexture.CreateRGBATexture(
        data, canvas.width, canvas.height, this.scene,
        true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
      );
      tex.anisotropicFilteringLevel = 16;
      tex.__sourceCanvas = canvas; // cloud pre-bake reuses this without re-decoding
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
        console.info(`[VR TEXTURE VERIFIED] ${fileName} -> OK (${dims}${srgb ? ', sRGB' : ''})`);
        log({ file: fileName, status: 'ok', dims, srgb });
        return tex;
      } catch (err) {
        console.error(`[VR TEXTURE FAILURE] ${fileName}: ${err && err.message ? err.message : err} — rendering CLEARLY LABELLED flat placeholder.`);
        log({ file: fileName, status: 'fail', error: String(err && err.message ? err.message : err) });
        return this._generateLabeledPlaceholderTexture(fileName);
      }
    };

    const [dayTex, nightTex, cloudsTex, bumpTex, specTex] = await Promise.all([
      loadTextureVerified('earth_day_2k.png', { srgb: true }),      // NASA Blue Marble NG
      loadTextureVerified('earth_night_2k.png', { srgb: true }),    // NASA Black Marble VIIRS DNB
      loadTextureVerified('earth_clouds_2k.png'),                   // MODIS cloud composite (alphaMap: keep linear)
      loadTextureVerified('earth_bump_2k.png'),                     // GEBCO bathymetry/topography (linear luminance)
      loadTextureVerified('earth_specular_2k.png')                  // Ocean mask (linear)
    ]);

    // Cloud texture low-pass pre-bake: at the 140 km skim altitude the 2K
    // MODIS composite is magnified ~50x, and its per-pixel grain read as
    // giant gray checker blocks under grazing sunset light. A one-time
    // canvas downsample/upsample box-filter bakes out the sensor grain while
    // preserving genuine cloud structure (offline pre-bake technique).
    // Babylon port addition: the baked canvas is converted to RGBA with the
    // cloud mask in the ALPHA channel for PBRMaterial.alphaTexture.
    let cloudsBaked = cloudsTex;
    if (typeof document !== 'undefined' && cloudsTex && cloudsTex.getSize) {
      try {
        const size = cloudsTex.getSize();
        const small = document.createElement('canvas');
        small.width = 256;
        small.height = 128;
        small.getContext('2d').drawImage(cloudsTex._canvasRef || this._canvasForTexture(cloudsTex), 0, 0, small.width, small.height);
        const big = document.createElement('canvas');
        big.width = size.width;
        big.height = size.height;
        const bctx = big.getContext('2d');
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.drawImage(small, 0, 0, big.width, big.height);
        cloudsBaked = this._cloudsToAlphaRawTexture(big);
        console.info('[VR TEXTURE PRE-BAKE] earth_clouds_2k.png -> box-filtered 256x128 alphaMap baked (grain removed)');
      } catch (bakeErr) {
        console.warn(`[VR TEXTURE PRE-BAKE] clouds bake skipped: ${bakeErr && bakeErr.message ? bakeErr.message : bakeErr}`);
      }
    }

    // ---- 1. SurfaceMesh: Babylon sphere, task-prescribed tessellation -----
    // The previous build's IcosahedronGeometry(R, 99) = 200k tri / 600k verts.
    // Task §2 prescribes sphere subdivisions ~64 -> ~65k verts with the SAME
    // verified GLSL (VRSurfaceShader); documented deviation (port note 3).
    const surfaceMesh = BABYLON.MeshBuilder.CreateSphere('SurfaceMesh', {
      diameter: EARTH_RADIUS * 2.0,
      segments: 64
    }, this.scene);
    // Surface uses the ported NASA Blue/Black Marble day-night terminator
    // shader (VRSurfaceShader) with ~650km twilight band + ocean specular.
    const surfaceMat = new VRShaderMaterial('SurfaceMeshShader', this.scene, {
      vertexShader: VRSurfaceShader.vertexShader,
      fragmentShader: VRSurfaceShader.fragmentShader,
      uniforms: {
        uDayMap: { value: dayTex },
        uNightMap: { value: nightTex },
        uSpecularMap: { value: specTex },
        uBumpMap: { value: bumpTex },
        uBumpScale: { value: 0.012 }, // ~7.6 km peak relief (within GEBCO's true range); the prior 25 km scale read as giant square relief blocks under grazing sunset light
        uSunDirection: { value: { x: this.subsolarVector.x, y: this.subsolarVector.y, z: this.subsolarVector.z } },
        uTime: { value: 0.0 }
      },
      transparent: false,
      depthWrite: true,
      side: 'FrontSide'
    });
    surfaceMesh.material = surfaceMat;
    this.surfaceMesh = surfaceMesh;
    this.surfaceMesh.parent = this.earthGroup;

    // 2. OceanGlowField: Concentric sphere at R = 10.002
    this.oceanGlowField = createOceanGlowField(this.scene, EARTH_RADIUS * 1.0002, specTex);
    this.oceanGlowField.parent = this.earthGroup;

    // 3. IceCapGroup: Concentric polar cap meshes at R = 10.005
    this.iceCapGroup = createIceCapGroup(this.scene, EARTH_RADIUS * 1.0005);
    this.iceCapGroup.parent = this.earthGroup;

    // 4. TerminatorRibbon: Volumetric day/night boundary mesh at R = 10.015
    this.terminatorRibbon = createTerminatorRibbon(this.scene, EARTH_RADIUS * 1.0015, 0.18, 256);
    this.terminatorRibbon.parent = this.earthGroup;

    // 5. CloudLayer: Concentric cloud sphere at scale 1.008 (R = 10.08).
    // Real MODIS composite alphaMap: blue marble cloud PNG is white-on-black,
    // so using it as a diffuse+additive "map" (previous build) blew up into
    // giant gray blobs. alphaTexture keeps true cloud silhouettes
    // (Task §2 prescription; opacity 0.90, depthWrite off preserved.)
    const cloudMesh = BABYLON.MeshBuilder.CreateSphere('CloudLayer', {
      diameter: EARTH_RADIUS * 2.0 * 1.008,
      segments: 64
    }, this.scene);
    const cloudMat = new BABYLON.PBRMaterial('CloudLayerPBR', this.scene);
    cloudMat.albedoColor = new BABYLON.Color3(1, 1, 1);
    cloudMat.metallic = 0.0;
    cloudMat.roughness = 1.0;
    cloudMat.alphaTexture = cloudsBaked;
    cloudMat.getAlphaFromRGB = false; // mask lives in the ALPHA channel
    cloudMat.alpha = 0.90;
    cloudMat.disableDepthWrite = true;
    cloudMat.backFaceCulling = true;
    cloudMat.transparencyMode = BABYLON.Engine.ALPHA_COMBINE;
    cloudMesh.material = cloudMat;
    this.cloudLayer = cloudMesh;
    this.cloudLayer.parent = this.earthGroup;

    // 6. AtmosphereShell: Scale 1.025 (R = 10.25) Mie + Rayleigh limb scattering
    this.atmosphereShell = createAtmosphereShell(this.scene, EARTH_RADIUS * 1.025, EARTH_RADIUS);
    this.atmosphereShell.parent = this.earthGroup;
  }

  _canvasForTexture(tex) {
    // RawTexture made from a canvas in rawTextureFromImage keeps the canvas on
    // a side channel so the pre-bake can reuse it without re-decoding.
    return (tex && tex.__sourceCanvas) ? tex.__sourceCanvas : null;
  }

  _cloudsToAlphaRawTexture(bigCanvas) {
    const bctx = bigCanvas.getContext('2d');
    const w = bigCanvas.width;
    const h = bigCanvas.height;
    const src = bctx.getImageData(0, 0, w, h);
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const lum = src.data[i * 4]; // grayscale cloud mask (red channel)
      rgba[i * 4 + 0] = 255;
      rgba[i * 4 + 1] = 255;
      rgba[i * 4 + 2] = 255;
      rgba[i * 4 + 3] = lum;      // cloud opacity in ALPHA channel
    }
    const tex = BABYLON.RawTexture.CreateRGBATexture(
      rgba, w, h, this.scene, true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    tex.anisotropicFilteringLevel = 16;
    return tex;
  }

  /**
   * Flat, clearly-labelled placeholder texture for a failed dataset fetch.
   * Deliberately NOT realistic-looking: magenta-bordered flat panel with the
   * dataset file name, per the honesty-over-deception data policy.
   */
  _generateLabeledPlaceholderTexture(fileName) {
    if (typeof document === 'undefined') {
      return BABYLON.RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, this.scene);
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e0119b';
    ctx.lineWidth = 12;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e0119b';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('MISSING DATASET', canvas.width / 2, 110);
    ctx.font = '26px monospace';
    ctx.fillStyle = '#dce6f2';
    const label = fileName.length > 38 ? fileName.slice(0, 38) : fileName;
    ctx.fillText(label, canvas.width / 2, 160);
    ctx.fillText('FLAT PLACEHOLDER — REAL DATA UNAVAILABLE', canvas.width / 2, 200);
    const data = new Uint8Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    const tex = BABYLON.RawTexture.CreateRGBATexture(
      data, canvas.width, canvas.height, this.scene,
      true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
    );
    return tex;
  }

  _initStarfield() {
    this.starfieldSkybox = createGaiaStarfieldMesh(this.scene, STARFIELD_RADIUS, '/assets/textures/starfield_gaia_2k.png');
  }

  _initTimeSpline() {
    if (this.app && this.app.harmonizedData && this.app.harmonizedData.records) {
      this.harmonizedRecords = this.app.harmonizedData.records;
    }
    this.timeSpline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
  }

  _initDataGlyphs() {
    this.dataGlyphs = [];
    const colors = [0x00f0ff, 0xf59e0b, 0x3b82f6, 0xe0f2fe];

    for (let i = 0; i < 4; i++) {
      // 4 holographic motes on the lower horizon arc, in front of CameraRig.
      // NOTE: the authored -18° pitch is geometrically occluded: from the skim
      // altitude (10.22 vs surface 10.0) the tangent horizon dip is only
      // ~11.9°, so any ray depressed beyond ~11.9° intersects the planet.
      // Glyphs are therefore set at -6° — still on the lower horizon arc,
      // above the limb, and gaze-raycastable.
      // Tighter 60° spread so all four motes sit inside a per-eye FOV
      // (scissor stereo halves the horizontal FOV) while staying diegetic.
      const yawDeg = -30.0 + (i / 3.0) * 60.0;
      const pitchRad = (-6.0 * DEG_TO_RAD);
      const yawRad = (yawDeg * DEG_TO_RAD);
      const radius = 2.0;

      const y = radius * Math.sin(pitchRad);
      const rHoriz = radius * Math.cos(pitchRad);
      const x = rHoriz * Math.sin(yawRad);
      const z = -rHoriz * Math.cos(yawRad);

      const glyphGroup = new BABYLON.TransformNode(`DataGlyph_${i}`, this.scene);
      glyphGroup.position.set(x, y, z);
      glyphGroup.metadata = { stemIndex: i, progress: 0.0, ringUniform: null };

      // Holographic icosahedron mote (THREE.IcosahedronGeometry(0.08, 1) parity)
      const moteMesh = BABYLON.MeshBuilder.CreateIcoSphere(`DataGlyph_Mote_${i}`, {
        radius: 0.08,
        subdivisions: 2
      }, this.scene);
      const moteMat = new BABYLON.StandardMaterial(`DataGlyph_Mote_Mat_${i}`, this.scene);
      moteMat.disableLighting = true;
      moteMat.emissiveColor = BABYLON.Color3.FromHexString(
        '#' + colors[i].toString(16).padStart(6, '0')
      );
      moteMat.wireframe = true;
      moteMat.alpha = 0.85;
      moteMat.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);
      moteMesh.material = moteMat;
      moteMesh.parent = glyphGroup;

      // Holographic progress ring (verified DataGlyphShader)
      const ringMesh = createGlyphProgressRing(this.scene, 0.24, colors[i]);
      ringMesh.name = `DataGlyph_Ring_${i}`;
      ringMesh.parent = glyphGroup;
      glyphGroup.metadata.ringUniform = ringMesh.material.uniforms.uProgress;

      this.dataGlyphs.push(glyphGroup);

      // ---- Babylon-native 3D GUI hover routing (Task §3) -------------------
      // Invisible hitbox sphere + thin Control3D registered in GUI3DManager.
      // (VRGazeController.init() adds the pickable hitbox itself; see there.)
      // The control gives engine-native pointer/gaze events in XR; the exact
      // 600ms dwell machine remains VRGazeController's responsibility.
      const hitboxMesh = BABYLON.MeshBuilder.CreateSphere(`DataGlyph_Hitbox_${i}`, {
        diameter: 0.5,
        segments: 12
      }, this.scene);
      hitboxMesh.visibility = 0.0;
      hitboxMesh.metadata = { glyphIndex: i };
      hitboxMesh.parent = glyphGroup;
      glyphGroup.metadata.hitbox = hitboxMesh; // VRGazeController reuses this
      const glyphControl = new DwellGlyphControl3D(`DataGlyph_Control_${i}`, hitboxMesh);
      this.gui3DManager.addControl(glyphControl); // registers reservedDataStore
      glyphControl.linkToTransformNode(glyphGroup); // keep diegetic hierarchy
      this._glyphControls.push(glyphControl);
    }
  }

  _initZenithGlyph() {
    // Feature 24 (R6): 3D diegetic zenith progress ring at (0, 2.0, 0) relative
    // to CameraRig facing downward (0, -1, 0). Amber JPL accent #ff8a3d.
    const ringMesh = createGlyphProgressRing(this.scene, 0.35, 0xff8a3d);
    ringMesh.name = 'ZenithProgressRing';
    ringMesh.position.set(0, 2.0, 0);
    ringMesh.rotation.x = Math.PI / 2; // Facing downward
    ringMesh.parent = this.cameraRig;
    this.zenithRing = ringMesh;
  }

  updateTimeline(t) {
    this.currentT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));
    if (!this.timeSpline) return;

    // 1. Advance CameraRig on TimeSpline with 100% locked horizontal horizon (roll = 0.0°)
    const frame = getSplineFrame(this.timeSpline, this.currentT, SKIM_ALTITUDE);
    this.cameraRig.position.set(frame.position.x, frame.position.y, frame.position.z);
    if (frame.quaternion) {
      if (!this.cameraRig.rotationQuaternion) {
        this.cameraRig.rotationQuaternion = BABYLON.Quaternion.Identity();
      }
      this.cameraRig.rotationQuaternion.set(
        frame.quaternion.x, frame.quaternion.y, frame.quaternion.z, frame.quaternion.w
      );
    }

    // 2. Solar Ephemeris & Subsolar Vector update
    // Annual seasonal declination oscillation (-23.44° to +23.44°)
    const totalYears = (TOTAL_MONTHS - 1) / 12.0;
    const yearFraction = (this.currentT * totalYears) % 1.0;
    const solarDecRad = (23.44 * DEG_TO_RAD) * Math.sin(yearFraction * Math.PI * 2.0 - (Math.PI / 2.0));
    const solarLonRad = this.currentT * Math.PI * 2.0 * 48.0; // Daily diurnal rotation

    const sunDist = 50.0;
    const sunX = sunDist * Math.cos(solarDecRad) * Math.cos(solarLonRad);
    const sunY = sunDist * Math.sin(solarDecRad);
    const sunZ = sunDist * Math.cos(solarDecRad) * Math.sin(solarLonRad);
    this.sunLight.position.set(sunX, sunY, sunZ);

    // Babylon DirectionalLight direction = travel direction (source -> target):
    // sun at (sunX, sunY, sunZ) illuminating the globe points toward origin.
    const sunLen = Math.hypot(sunX, sunY, sunZ) || 1.0;
    this.sunLight.direction.set(-sunX / sunLen, -sunY / sunLen, -sunZ / sunLen);

    this.subsolarVector = {
      x: sunX / sunLen,
      y: sunY / sunLen,
      z: sunZ / sunLen
    };

    // 3. Interpolate Active Monthly Harmonized Climate Record
    this.activeMonthRecord = interpolateHarmonizedRecord(this.harmonizedRecords, this.currentT);

    // 4. Synchronize all 4 planetary shaders with live data & audio envelopes
    updatePlanetaryShaders({
      terminatorRibbon: this.terminatorRibbon,
      atmosphereShell: this.atmosphereShell,
      oceanGlowField: this.oceanGlowField,
      iceCapGroup: this.iceCapGroup,
      surfaceMesh: this.surfaceMesh,
      timelineProgress: this.currentT,
      monthRecord: this.activeMonthRecord,
      audioEnvelopes: this.audioEnvelopes,
      clockTime: this.elapsedTime,
      sunDirection: this.subsolarVector,
      sunPosition: this.sunLight.position,
      scene: this.scene
    });
  }

  updateAudioEnvelopes(envelopes) {
    if (!envelopes) return;
    for (let i = 0; i < 4; i++) {
      this.audioEnvelopes[i] = Math.max(0.0, Math.min(1.0, Number(envelopes[i]) || 0.0));
    }
  }

  setMixer(mixer) {
    if (this.gazeController) {
      this.gazeController.setMixer(mixer);
    }
    if (this.spatialAudio && mixer) {
      this.spatialAudio.init(mixer.audioCtx, mixer, this.camera, this.dataGlyphs);
    }
  }

  /**
   * Scene-graph frame update ONLY (cloud drift, starfield tracking, shader
   * pulses). Glider/gaze/audio subsystems advance once per frame from
   * VRRenderer._updateSubsystems — see port note 7 on the fixed double-step.
   */
  tick(delta) {
    this.elapsedTime += delta;
    const elapsed = this.elapsedTime;

    // 1. Cloud drift (global wind eastward at 15% faster than planet diurnal cycle)
    if (this.cloudLayer) {
      this.cloudLayer.rotation.y += delta * 0.015;
    }

    // 2. Starfield skybox centered on camera to prevent paraxial drift
    if (this.starfieldSkybox && this.cameraRig) {
      this.starfieldSkybox.position.set(
        this.cameraRig.position.x, this.cameraRig.position.y, this.cameraRig.position.z
      );
    }

    // 3. Keep shader uniforms pulsed
    if (this.terminatorRibbon && this.terminatorRibbon.material && this.terminatorRibbon.material.uniforms.uTime) {
      this.terminatorRibbon.material.uniforms.uTime.value = elapsed;
    }
    if (this.oceanGlowField && this.oceanGlowField.material && this.oceanGlowField.material.uniforms.uTime) {
      this.oceanGlowField.material.uniforms.uTime.value = elapsed;
    }
  }

  async enterVR(options = {}) {
    this.isVRActive = true;
    if (this.loadingController) {
      this.loadingController.show();
    }
    if (typeof document !== 'undefined') {
      document.body.classList.add('vr-mode-active');
      if (this.engine && typeof this.engine.resize === 'function') {
        this.engine.resize();
      }
    }

    // Pause 2D globe loop cleanly without touching globe.js
    if (this.app && this.app.globe && typeof this.app.globe.stop === 'function') {
      this.app.globe.stop();
    }

    if (this.glider) {
      this.glider.enable();
      this.glider.recenter();
    }
    if (this.spatialAudio) {
      this.spatialAudio.attach();
    }
    if (this.onboardingController) {
      this.onboardingController.show();
    }

    if (this.vrRenderer) {
      await this.vrRenderer.start(options.mode || 'auto');
    }

    if (this.loadingController) {
      this.loadingController.hide();
    }
  }

  exitVR() {
    this.isVRActive = false;

    if (this.loadingController) {
      this.loadingController.hide();
    }
    if (this.onboardingController) {
      this.onboardingController.reset();
    }

    if (this.vrRenderer) {
      this.vrRenderer.stop();
    }

    if (typeof document !== 'undefined') {
      document.body.classList.remove('vr-mode-active');
    }

    if (this.glider) {
      this.glider.disable();
    }
    if (this.gazeController) {
      this.gazeController.reset();
    }
    if (this.spatialAudio) {
      this.spatialAudio.detach();
    }

    // Resume 2D globe loop cleanly
    if (this.app && this.app.globe && typeof this.app.globe.start === 'function') {
      this.app.globe.start();
    }
  }

  /**
   * Alias for tick(delta) to conform with Milestone M4 render loop coordination specification.
   */
  update(delta) {
    return this.tick(delta);
  }
}
