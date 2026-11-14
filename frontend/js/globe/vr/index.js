/**
 * frontend/js/globe/vr/index.js
 * Normalized Planetary Scene Graph & VR Entry Point.
 * Milestones M2–M5 Subsystems (Babylon.js port, VR-MIGRATION-2026):
 *   - M2: Normalized Planetary Scale, Shaders, Spline, Starfield
 *   - M3: Glider Navigation, Diegetic Gaze Controller, 3D HRTF Spatial Audio
 *   - M4: Dual-Mode VR Renderer
 *   - M5: Orbital Examine Mode (ArcRotateCamera, NASA panel, full-globe view)
 *
 * The full export surface of the verified build is preserved 1:1 (every name
 * below was imported by tests / vr_launcher.js); Babylon-specific additions
 * (VRShaderMaterial, computeStereoViewports, DeltaTimer, createGlyphProgressRing,
 * generateTileableNoiseTexture) are appended at the end.
 * M5 additions: OrbitalExamineScene, OrbitalControlPanel, installOrbitalExamineVR.
 */

import {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  CAMERA_NEAR,
  CAMERA_FAR,
  HORIZON_DIP_DEG,
  VROnboardingController,
  VRLoadingController
} from './vr_scene.js';
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
  generateTileableNoiseTexture,
  updatePlanetaryShaders,
  setUniformValueOnMaterial
} from './vr_shaders.js';
import { createGaiaStarfieldMesh, STARFIELD_RADIUS, generateGaiaStarfieldCanvas } from './vr_starfield.js';
import { TOTAL_MONTHS, interpolateHarmonizedRecord } from './vr_timeline.js';
import { createTimeSpline, getSplineFrame, SKIM_ALTITUDE } from './vr_spline.js';
import {
  VRGliderNavigation,
  VRGlider,
  computeGliderStep,
  enforceZeroRoll,
  GLIDER_DEADZONE_DEG,
  GLIDER_ACCELERATION,
  GLIDER_DAMPING
} from './vr_glider.js';
import {
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  GAZE_HITBOX_RADIUS,
  GAZE_DECAY_RATE,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING
} from './vr_gaze.js';
import {
  VRSpatialAudio,
  PANNING_MODEL,
  DISTANCE_MODEL,
  REF_DISTANCE,
  ROLLOFF_FACTOR,
  MAX_DISTANCE
} from './vr_audio.js';
import {
  VRRenderer,
  computeScissorStereo,
  computeStereoViewports,
  DeltaTimer,
  cameraFovRad,
  DEFAULT_EYE_SEP,
  CAMERA_FOV
} from './vr_renderer.js';

export {
  TerminatorSkimVRScene,
  EARTH_RADIUS,
  SKIM_ALTITUDE,
  CAMERA_NEAR,
  CAMERA_FAR,
  HORIZON_DIP_DEG,
  TOTAL_MONTHS,
  STARFIELD_RADIUS,
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  DataGlyphShader,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  createGaiaStarfieldMesh,
  generateGaiaStarfieldCanvas,
  createTimeSpline,
  getSplineFrame,
  interpolateHarmonizedRecord,
  updatePlanetaryShaders,
  // Milestone M3 Exports
  VRGliderNavigation,
  VRGlider,
  computeGliderStep,
  enforceZeroRoll,
  GLIDER_DEADZONE_DEG,
  GLIDER_ACCELERATION,
  GLIDER_DAMPING,
  VRGazeController,
  GAZE_DWELL_THRESHOLD_SEC,
  GAZE_HITBOX_RADIUS,
  GAZE_DECAY_RATE,
  ZENITH_PITCH_THRESHOLD_DEG,
  ZENITH_DWELL_THRESHOLD_SEC,
  STEM_MAPPING,
  VRSpatialAudio,
  PANNING_MODEL,
  DISTANCE_MODEL,
  REF_DISTANCE,
  ROLLOFF_FACTOR,
  MAX_DISTANCE,
  // Milestone M4 Exports
  VRRenderer,
  computeScissorStereo,
  DEFAULT_EYE_SEP,
  CAMERA_FOV,
  VROnboardingController,
  VRLoadingController,
  // Babylon-port additions
  VRShaderMaterial,
  createGlyphProgressRing,
  generateTileableNoiseTexture,
  setUniformValueOnMaterial,
  computeStereoViewports,
  DeltaTimer,
  cameraFovRad
};

/**
 * Initialize and bind the global window.earthsonicVR interface contract.
 * @param {Object} [app] - Main EarthSonicApp coordinator
 * @returns {Object} window.earthsonicVR interface
 */
export function installEarthsonicVR(app = null) {
  const vrScene = new TerminatorSkimVRScene(app);

  const vrInterface = {
    sceneInstance: vrScene,
    get cameraRig() { return vrScene.cameraRig; },
    get camera() { return vrScene.camera; },
    get timeSpline() { return vrScene.timeSpline; },
    get dataGlyphs() { return vrScene.dataGlyphs; },
    get isVRActive() { return vrScene.isVRActive; },
    get currentT() { return vrScene.currentT; },
    get activeMonthRecord() { return vrScene.activeMonthRecord; },

    // Milestone M3 Subsystem Accessors
    get glider() { return vrScene.glider; },
    get gazeController() { return vrScene.gazeController; },
    get spatialAudio() { return vrScene.spatialAudio; },
    get panners() { return vrScene.spatialAudio ? vrScene.spatialAudio.panners : []; },
    get timelinePosition() { return vrScene.glider ? vrScene.glider.getTimelinePosition() : vrScene.currentT; },
    get timelineVelocity() { return vrScene.glider ? vrScene.glider.getTimelineVelocity() : 0.0; },

    // Milestone M4 Renderer & Controllers Accessors
    get vrRenderer() { return vrScene.vrRenderer; },
    get zenithRing() { return vrScene.zenithRing; },
    get zenithProgress() { return vrScene.gazeController ? vrScene.gazeController.getZenithProgress() : 0.0; },
    get onboardingController() { return vrScene.onboardingController; },
    get loadingController() { return vrScene.loadingController; },
    isWebXRActive: () => vrScene.vrRenderer ? vrScene.vrRenderer.isWebXRActive() : false,
    isStereoActive: () => vrScene.vrRenderer ? vrScene.vrRenderer.isStereoActive() : false,

    init: (renderer) => vrScene.init(renderer),
    enterVR: (opts) => vrScene.enterVR(opts),
    exitVR: () => vrScene.exitVR(),
    updateTimeline: (t) => vrScene.updateTimeline(t),
    updateAudioEnvelopes: (envs) => vrScene.updateAudioEnvelopes(envs),
    tick: (dt) => vrScene.tick(dt),
    update: (dt) => vrScene.update(dt),
    setMixer: (m) => vrScene.setMixer(m),

    // Milestone M3 Helper Methods
    getActiveGlyph: () => vrScene.gazeController ? vrScene.gazeController.getActiveGlyph() : -1,
    getGlyphState: (idx) => vrScene.gazeController ? vrScene.gazeController.getGlyphState(idx) : null,
    triggerGlyph: (idx) => vrScene.gazeController ? vrScene.gazeController.triggerGlyph(idx) : null,
    setLookAngles: (yaw, pitch) => vrScene.glider ? vrScene.glider.setLookAngles(yaw, pitch) : null,
    getLookAngles: () => vrScene.glider ? vrScene.glider.getLookAngles() : { yawDeg: 0, pitchDeg: 0, rollDeg: 0 },
    stepGlider: (yaw) => vrScene.glider ? vrScene.glider.stepPhysics(yaw) : null,
    syncPlayhead: (t) => vrScene.spatialAudio ? vrScene.spatialAudio.syncPlayhead(t) : null
  };

  if (typeof window !== 'undefined') {
    window.earthsonicVR = vrInterface;
  }

  return vrInterface;
}

// ============================================================================
// M5: Orbital Examine VR Mode exports
// ============================================================================

export {
  OrbitalExamineScene,
  OrbitalControlPanel,
  installOrbitalExamineVR,
  ORBITAL_EARTH_RADIUS,
  ORBITAL_CAMERA_NEAR,
  ORBITAL_CAMERA_FAR,
  ORBITAL_INITIAL_RADIUS,
  ORBITAL_MIN_RADIUS,
  ORBITAL_MAX_RADIUS,
  ORBITAL_ZOOM_STEP,
  ORBITAL_EYE_SEP,
  PANEL_DWELL_SEC,
  AUTOPLAY_INTERVAL_SEC
} from './orbital_examine.js';
