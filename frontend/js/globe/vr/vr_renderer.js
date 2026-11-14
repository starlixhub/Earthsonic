/**
 * frontend/js/globe/vr/vr_renderer.js
 * Dual-Mode VR Renderer Subsystem for EARTHSONIC Terminator Skim VR.
 * Requirement R2 & R6: Feature 27. Babylon.js port (VR-MIGRATION-2026).
 *
 * Capabilities:
 *   - Mode A: WebXR `immersive-vr` session (Babylon WebXRDefaultExperience)
 *       * Feature check: navigator.xr && navigator.xr.isSessionSupported('immersive-vr')
 *       * Session entry: xrHelper.baseExperience.enterXRAsync('immersive-vr', 'local-floor')
 *       * Per-eye stereo projections and XR poses are handled by the Babylon
 *         WebXR pipeline (native, replaces hand-rolled Three.js xr glue)
 *   - Mode B: Manual dual-eye side-by-side stereo pass
 *       * Fallback when WebXR is unsupported or explicitly selected (mobile
 *         cardboards, URL /?vr=1)
 *       * Parameter: eyeSep = 0.064 (left eye offset: -0.032 along camera local
 *         right; right eye: +0.032) — UNCHANGED
 *       * Rendering technique: Babylon native multi-camera rendering —
 *         scene.activeCameras = [left, right] with normalized viewports
 *         left(0, 0, 0.5, 1) / right(0.5, 0, 0.5, 1). Babylon scissors/renders
 *         each active camera into its viewport (the engine-internal equivalent
 *         of the previous setScissorTest pass). Camera projection: vertical
 *         FOV 75 deg, near 0.05, far 250.0, aspect = halfW / height.
 *   - Render loop coordination (all modes): engine-driven rAF loop
 *       * Updates each frame: vr_scene.update(delta), vr_glider.update(delta),
 *         vr_gaze.update(camera, delta), vr_audio.updatePositions()
 *   - Canvas resize handling: engine.resize() + eye viewport recompute
 *   - Headless / Node.js test friendly: zero crash on missing WebXR or window
 *
 * Deviations from the Three.js build (documented for the migration audit):
 *   1. computeScissorStereo is kept BYTE-IDENTICAL as the pure math oracle
 *      (and is used to derive eye offsets), but the pixel-space
 *      setViewport/setScissor calls are replaced by Babylon Viewport objects —
 *      same halves, same aspect, same eye offsets.
 *   2. THREE.Timer -> internal DeltaTimer (rAF-timestamp based, same getDelta
 *      semantics: seconds since previous update, capped by callers at 0.1).
 *   3. renderer.setAnimationLoop / manual rAF -> a unified rAF loop calling
 *      scene.render() once per frame (Babylon resolves activeCameras / WebXR).
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

export const DEFAULT_EYE_SEP = 0.064; // 64mm adult interpupillary distance (IPD)
export const CAMERA_FOV = 75;
export const CAMERA_NEAR = 0.05;
export const CAMERA_FAR = 250.0;

/** Babylon vertical FOV in radians for CAMERA_FOV degrees. */
export function cameraFovRad() {
  return (CAMERA_FOV * Math.PI) / 180.0;
}

/**
 * Pure oracle function for dual-eye side-by-side stereo pass.
 * Exact mathematical parity with test oracle oracle_scissor_stereo.
 * (BYTE-IDENTICAL port of the verified build.)
 *
 * @param {number} canvasW - Total canvas width in pixels
 * @param {number} canvasH - Total canvas height in pixels
 * @param {number} [eyeSep=0.064] - Interpupillary distance in meters
 * @returns {{
 *   leftEye: { scissor: [number, number, number, number], viewport: [number, number, number, number], camOffsetX: number },
 *   rightEye: { scissor: [number, number, number, number], viewport: [number, number, number, number], camOffsetX: number },
 *   eyeSep: number
 * }}
 */
export function computeScissorStereo(canvasW, canvasH, eyeSep = DEFAULT_EYE_SEP) {
  const w = Math.max(1, Math.floor(Number(canvasW) || 1920));
  const h = Math.max(1, Math.floor(Number(canvasH) || 1080));
  const sep = Number(eyeSep) !== undefined && !isNaN(eyeSep) ? Number(eyeSep) : DEFAULT_EYE_SEP;

  const halfW = Math.floor(w / 2);
  const remW = w - halfW;
  const leftOffsetX = sep === 0 ? 0.0 : -sep / 2.0;
  const rightOffsetX = sep === 0 ? 0.0 : sep / 2.0;

  return {
    leftEye: {
      scissor: [0, 0, halfW, h],
      viewport: [0, 0, halfW, h],
      camOffsetX: leftOffsetX
    },
    rightEye: {
      scissor: [halfW, 0, remW, h],
      viewport: [halfW, 0, remW, h],
      camOffsetX: rightOffsetX
    },
    eyeSep: sep
  };
}

/**
 * Babylon normalized multi-camera viewports for the stereo pass, derived from
 * the same math as computeScissorStereo (documented engine mapping).
 */
export function computeStereoViewports(canvasW, canvasH, eyeSep = DEFAULT_EYE_SEP) {
  const stereo = computeScissorStereo(canvasW, canvasH, eyeSep);
  const w = Math.max(1, Math.floor(Number(canvasW) || 1920));
  const h = Math.max(1, Math.floor(Number(canvasH) || 1080));
  const halfW = Math.floor(w / 2);
  const remW = w - halfW;
  return {
    left: new BABYLON.Viewport(0, 0, halfW / w, 1.0),
    right: new BABYLON.Viewport(halfW / w, 0, remW / w, 1.0),
    eyeSep: stereo.eyeSep,
    leftAspect: halfW / h,
    rightAspect: remW / h
  };
}

/** rAF-timestamp delta timer (seconds), THREE.Timer-equivalent for the port. */
export class DeltaTimer {
  constructor() {
    this._lastMs = null;
    this._last = null;
  }

  update(timestampMs) {
    const now = (timestampMs !== undefined && timestampMs !== null)
      ? Number(timestampMs)
      : ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    if (this._lastMs === null) {
      this._lastMs = now;
      this._last = 0;
      return 0;
    }
    this._last = Math.max(0, (now - this._lastMs) / 1000.0);
    this._lastMs = now;
    return this._last;
  }

  getDelta() {
    return this._last || 0;
  }

  // Backward compatibility for tests (THREE.Timer alias surface)
  get tick() {
    return null;
  }
}

export class VRRenderer {
  /**
   * @param {Object} [options]
   * @param {number} [options.eyeSep=0.064]
   * @param {Object} [options.vrScene]
   * @param {Object} [options.glider]
   * @param {Object} [options.gaze]
   * @param {Object} [options.audio]
   * @param {Function} [options.onStart]
   * @param {Function} [options.onStop]
   */
  constructor(options = {}) {
    this.eyeSep = options.eyeSep !== undefined ? Number(options.eyeSep) : DEFAULT_EYE_SEP;
    this.vrScene = options.vrScene || null;
    this.glider = options.glider || null;
    this.gaze = options.gaze || null;
    this.audio = options.audio || null;
    this.onStart = options.onStart || null;
    this.onStop = options.onStop || null;

    // Babylon Core Handles
    this.scene = null;
    this.cameraRig = null;
    this.camera = null;
    this.engine = null;

    // Stereo Eye Cameras
    this.cameraLeft = null;
    this.cameraRight = null;

    // Babylon WebXR_DEFAULT EXPERIENCE helper
    this.xrHelper = null;

    // Timing & Loop
    this.timer = new DeltaTimer();
    this.clock = this.timer; // Backward compatibility for tests
    this.activeMode = 'inactive'; // 'inactive' | 'webxr' | 'stereo'
    this._animationFrameId = null;
    this._isWebXRActive = false;
    this._isStereoActive = false;
    this._xrSession = null;

    // Scratchpad variables for zero-GC updates
    this._tempSize = { x: 1920, y: 1080 };
    this._boundResize = this.handleResize.bind(this);
  }

  /**
   * Initialize rendering subsystem with scene graph handles.
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.TransformNode} cameraRig
   * @param {BABYLON.Camera} camera
   * @param {BABYLON.Engine} engine
   * @returns {VRRenderer} this
   */
  init(scene, cameraRig, camera, engine) {
    this.scene = scene;
    this.cameraRig = cameraRig;
    this.camera = camera;
    this.engine = engine;

    // Create stereo eye cameras (TargetCamera: manually-oriented orbit-free)
    this.cameraLeft = new BABYLON.TargetCamera('Stereo_CameraLeft', new BABYLON.Vector3(0, 0, 0), scene);
    this.cameraLeft.fov = cameraFovRad();
    this.cameraLeft.minZ = CAMERA_NEAR;
    this.cameraLeft.maxZ = CAMERA_FAR;

    this.cameraRight = new BABYLON.TargetCamera('Stereo_CameraRight', new BABYLON.Vector3(0, 0, 0), scene);
    this.cameraRight.fov = cameraFovRad();
    this.cameraRight.minZ = CAMERA_NEAR;
    this.cameraRight.maxZ = CAMERA_FAR;

    // Position eye cameras along camera local X axis (local right vector)
    this._updateEyeCameraOffsets();

    // Attach eye cameras as children of main camera
    if (this.camera) {
      this.cameraLeft.parent = this.camera;
      this.cameraRight.parent = this.camera;
    }

    // Bind window resize
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', this._boundResize);
    }

    return this;
  }

  _updateEyeCameraOffsets() {
    const halfSep = this.eyeSep / 2.0;
    if (this.cameraLeft) {
      this.cameraLeft.position.set(-halfSep, 0, 0);
    }
    if (this.cameraRight) {
      this.cameraRight.position.set(halfSep, 0, 0);
    }
  }

  setEyeSeparation(sep) {
    this.eyeSep = Number(sep) || 0.0;
    this._updateEyeCameraOffsets();
  }

  getEyeSeparation() {
    return this.eyeSep;
  }

  /**
   * Check if WebXR immersive-vr is supported by browser/hardware.
   * @returns {Promise<boolean>}
   */
  async isWebXRSupported() {
    if (typeof navigator !== 'undefined' && navigator.xr && typeof navigator.xr.isSessionSupported === 'function') {
      try {
        return await navigator.xr.isSessionSupported('immersive-vr');
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  /**
   * Start rendering in selected mode ('auto' | 'webxr' | 'stereo').
   * @param {string} [mode='auto']
   * @returns {Promise<string>} Activated mode ('webxr' or 'stereo')
   */
  async start(mode = 'auto') {
    if (this.activeMode !== 'inactive') {
      this.stop();
    }

    let targetMode = mode;
    if (targetMode === 'auto') {
      const supported = await this.isWebXRSupported();
      targetMode = supported ? 'webxr' : 'stereo';
    }

    if (targetMode === 'webxr') {
      try {
        await this._startWebXR();
        this.activeMode = 'webxr';
      } catch (err) {
        console.warn('[VRRenderer] WebXR start failed, falling back to stereo viewports:', err);
        if (this.vrScene && this.vrScene.isVRActive === false) {
          this.activeMode = 'inactive';
          return 'inactive';
        }
        this._startStereo();
        this.activeMode = 'stereo';
      }
    } else {
      this._startStereo();
      this.activeMode = 'stereo';
    }

    this._ensureLoop();

    if (typeof this.onStart === 'function') {
      this.onStart(this.activeMode);
    }

    return this.activeMode;
  }

  async _ensureXRHelper() {
    if (this.xrHelper) return this.xrHelper;
    if (!this.scene || typeof this.scene.createDefaultXRExperienceAsync !== 'function') {
      throw new Error('scene.createDefaultXRExperienceAsync not available');
    }
    this.xrHelper = await this.scene.createDefaultXRExperienceAsync({
      floorMeshes: [],
      // Full immersion: no teleportation, no snap-height, no hand tracking UI.
      // (§6 invariant: console-free VR view — Babylon adds no HTML/overlay UI.)
      disableTeleportation: true,
      disableHandTracking: true,
      disableGaze: false // keep gaze-style input profile for controller-less strapons
    });
    return this.xrHelper;
  }

  async _startWebXR() {
    if (typeof navigator === 'undefined' || !navigator.xr || typeof navigator.xr.requestSession !== 'function') {
      throw new Error('navigator.xr.requestSession not available');
    }

    const supported = await this.isWebXRSupported();
    if (!supported) {
      throw new Error('immersive-vr session not supported by this device');
    }

    const helper = await this._ensureXRHelper();
    await helper.baseExperience.enterXRAsync('immersive-vr', 'local-floor', {
      optionalFeatures: ['bounded-floor']
    });

    this._xrSession = helper.baseExperience.session || null;
    if (this._xrSession && typeof this._xrSession.addEventListener === 'function') {
      this._xrSession.addEventListener('end', () => {
        this._handleSessionEnd();
      });
    }

    // The XR pipeline renders per-eye via the session; disable the stereo
    // activeCameras array so Babylon's XR camera takes over.
    if (this.scene) {
      this.scene.activeCameras = [];
    }

    this._isWebXRActive = true;
    this._isStereoActive = false;
  }

  _startStereo() {
    if (this.vrScene && this.vrScene.isVRActive === false) {
      return;
    }

    this._isStereoActive = true;
    this._isWebXRActive = false;

    // Exit any XR session first (Babylon handles session end internally)
    if (this.xrHelper && this.xrHelper.baseExperience && this.xrHelper.state === BABYLON.WebXRState.IN_XR) {
      try {
        this.xrHelper.baseExperience.exitXRAsync().catch(() => {});
      } catch (e) {}
    }

    this.handleResize();

    // Activate the dual-eye multi-camera stereo pass
    if (this.scene && this.cameraLeft && this.cameraRight) {
      this.scene.activeCameras = [this.cameraLeft, this.cameraRight];
    }
  }

  _ensureLoop() {
    if (this._animationFrameId !== null) return;

    const raf = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (cb) => {
          const timer = setTimeout(() => cb(Date.now()), 16);
          if (typeof timer.unref === 'function') timer.unref();
          return timer;
        };

    const loop = (timestamp) => {
      if (!this._isStereoActive && !this._isWebXRActive) {
        this._animationFrameId = null;
        return;
      }
      if (this.vrScene && this.vrScene.isVRActive === false) {
        this.stop();
        return;
      }
      this.timer.update(timestamp);
      const delta = Math.min(this.timer.getDelta(), 0.1);
      this._renderFrame(delta);
      this._animationFrameId = raf(loop);
    };

    this._animationFrameId = raf(loop);
  }

  /**
   * Unified frame: update subsystems, then render once per frame.
   * (WebXR: the session's per-eye views replace the mono projection inside
   * Babylon's XR pipeline; stereo: activeCameras drive the dual-viewport pass.)
   */
  _renderFrame(delta) {
    if (!this.scene) return;

    this._updateSubsystems(delta);

    if (this._isStereoActive) {
      // Re-sync eye viewports/projections for the current canvas size
      this.renderStereoPass();
    }

    // Render exactly once per frame. In WebXR mode scene.activeCamera is the
    // WebXRCamera (per-eye views from the session); in stereo mode the
    // activeCameras array drives the dual-viewport pass.
    this.scene.render();
  }

  _renderWebXRFrame(timestamp, frame) {
    if (!this._isWebXRActive) return;
    const delta = Math.min(this.timer.update(timestamp), 0.1);
    this._updateSubsystems(delta);
  }

  _renderStereoFrame(timestamp) {
    if (!this._isStereoActive) return;
    const delta = Math.min(this.timer.update(timestamp), 0.1);
    this._updateSubsystems(delta);
    this.renderStereoPass();
  }

  /**
   * Pure single-frame stereo pass configuration (Babylon multi-camera path).
   * Eye cameras: fov/near/far re-asserted, local offsets re-applied, viewports
   * derived from computeScissorStereo's math (same halves + aspect as before).
   */
  renderStereoPass() {
    if (!this.scene || !this.cameraLeft || !this.cameraRight) return;

    const size = this._getCanvasSize();
    const stereo = computeScissorStereo(size.x, size.y, this.eyeSep);

    // --- LEFT EYE PASS ---
    this.cameraLeft.fov = cameraFovRad();
    this.cameraLeft.minZ = CAMERA_NEAR;
    this.cameraLeft.maxZ = CAMERA_FAR;
    this.cameraLeft.viewport = new BABYLON.Viewport(
      stereo.leftEye.viewport[0] / size.x,
      0,
      stereo.leftEye.viewport[2] / size.x,
      1.0
    );

    // --- RIGHT EYE PASS ---
    this.cameraRight.fov = cameraFovRad();
    this.cameraRight.minZ = CAMERA_NEAR;
    this.cameraRight.maxZ = CAMERA_FAR;
    this.cameraRight.viewport = new BABYLON.Viewport(
      stereo.rightEye.viewport[0] / size.x,
      0,
      stereo.rightEye.viewport[2] / size.x,
      1.0
    );

    // Babylon's activeCameras stereo rendering performs the scissored dual
    // pass internally when the scene renders.
  }

  _updateSubsystems(delta) {
    // 1. vr_scene update (cloud drift, atmosphere, shader uniforms)
    if (this.vrScene) {
      if (typeof this.vrScene.update === 'function') {
        this.vrScene.update(delta);
      } else if (typeof this.vrScene.tick === 'function') {
        this.vrScene.tick(delta);
      }
    }

    // 2. vr_glider update (inertial yaw timeline navigation, TimeSpline position, cameraRig position)
    const glider = this.glider || (this.vrScene && this.vrScene.glider);
    if (glider && typeof glider.update === 'function') {
      glider.update(delta);
    }

    // 3. vr_gaze update (raycasting, progress ring fill, zenith exit detection)
    const gaze = this.gaze || (this.vrScene && this.vrScene.gazeController);
    if (gaze && typeof gaze.update === 'function' && this.camera) {
      gaze.update(this.camera, delta);
    }

    // 4. vr_audio updatePositions (HRTF PannerNodes tracked to DataGlyphs world coordinates)
    const audio = this.audio || (this.vrScene && this.vrScene.spatialAudio);
    if (audio) {
      if (typeof audio.updatePositions === 'function') {
        audio.updatePositions();
      } else if (typeof audio.update === 'function') {
        const glyphs = (this.vrScene && this.vrScene.dataGlyphs) || [];
        audio.update(this.camera, glyphs);
      }
    }
  }

  _handleSessionEnd() {
    this._xrSession = null;
    this.stop();
  }

  stop() {
    const wasActive = this.activeMode !== 'inactive';

    if (this._isWebXRActive) {
      if (this.xrHelper && this.xrHelper.baseExperience) {
        try {
          const state = this.xrHelper.state;
          if (state === BABYLON.WebXRState.IN_XR && typeof this.xrHelper.baseExperience.exitXRAsync === 'function') {
            this.xrHelper.baseExperience.exitXRAsync().catch(() => {});
          }
        } catch (e) {}
      }
      if (this.xrHelper && this.xrHelper.baseExperience && typeof this.xrHelper.baseExperience.dispose === 'function') {
        this.xrHelper.baseExperience.dispose();
      }
      this.xrHelper = null;
      this._xrSession = null;
      this._isWebXRActive = false;
    }

    if (this._isStereoActive) {
      this._isStereoActive = false;

      // Restore full-canvas active camera
      if (this.scene) {
        this.scene.activeCameras = [];
      }
    }

    if (this._animationFrameId !== null) {
      const caf = typeof cancelAnimationFrame !== 'undefined'
        ? cancelAnimationFrame
        : (id) => clearTimeout(id);
      caf(this._animationFrameId);
      this._animationFrameId = null;
    }

    this.activeMode = 'inactive';

    if (wasActive && typeof this.onStop === 'function') {
      this.onStop();
    }
  }

  isWebXRActive() {
    return Boolean(this._isWebXRActive);
  }

  isStereoActive() {
    return Boolean(this._isStereoActive);
  }

  getMode() {
    return this.activeMode;
  }

  handleResize() {
    const size = this._getCanvasSize();

    if (this.engine && typeof this.engine.resize === 'function') {
      this.engine.resize();
    }

    // Eye camera viewports/projections re-derived from same oracle math.
    // (Configured unconditionally, mirroring the verified build's resize
    // behavior — the eye cams are inert unless bound as activeCameras.)
    this.renderStereoPass();

    if (this.camera && typeof this.camera.fov === 'number') {
      // Babylon v9 computes aspect from the viewport/canvas automatically
      this.camera.fov = cameraFovRad();
      this.camera.minZ = CAMERA_NEAR;
      this.camera.maxZ = CAMERA_FAR;
    }
  }

  _getCanvasSize() {
    if (this.engine && typeof this.engine.getRenderWidth === 'function') {
      try {
        const w = this.engine.getRenderWidth();
        const h = this.engine.getRenderHeight();
        if (w > 0 && h > 0) {
          this._tempSize.x = w;
          this._tempSize.y = h;
          return this._tempSize;
        }
      } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
      this._tempSize.x = window.innerWidth;
      this._tempSize.y = window.innerHeight;
      return this._tempSize;
    }
    this._tempSize.x = 1920;
    this._tempSize.y = 1080;
    return this._tempSize;
  }

  dispose() {
    this.stop();

    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('resize', this._boundResize);
    }

    if (this.cameraLeft) {
      this.cameraLeft.parent = null;
      this.cameraLeft.dispose();
    }
    if (this.cameraRight) {
      this.cameraRight.parent = null;
      this.cameraRight.dispose();
    }

    this.cameraLeft = null;
    this.cameraRight = null;
    this.scene = null;
    this.cameraRig = null;
    this.camera = null;
    this.engine = null;
    this.vrScene = null;
    this.glider = null;
    this.gaze = null;
    this.audio = null;
  }
}
