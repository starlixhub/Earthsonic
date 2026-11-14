/**
 * frontend/js/globe/vr/vr_gaze.js
 * Diegetic Gaze Interaction Subsystem for EARTHSONIC Terminator Skim VR.
 * Requirement R4: Features 20 & 24. Babylon.js port (VR-MIGRATION-2026).
 *
 * Invariants (unchanged from the verified build):
 *   - Targets 4 DataGlyphs positioned along -18° horizon arc
 *   - 600ms sustained gaze dwell fills glyph shader ring (uProgress: 0.0 -> 1.0)
 *   - Sub-threshold diversion decays smoothly to 0.0
 *   - Trigger toggles stem GainNode solo/mute on EarthOrchestraMixer with visual pulse flare
 *   - Zenith Gaze Exit: sustained gaze at zenith (pitch >= +75.0°) for 1.5s triggers exitVR
 *
 * Port notes:
 *   - Camera-forward gaze probe uses Babylon's Vector3 math (same projection /
 *     sphere-distance math as the verified hand-rolled probe; the WebXR
 *     controller/gaze picking path additionally goes through Babylon GUI3D
 *     pointer events, see vr_scene.js DwellButton3D wiring).
 *   - Camera conventions: Babylon cameras look along LOCAL +Z
 *     (advancedUniversalCamera.getForwardRay()), while the rig-space pitch
 *     measurement (dot(forward, rigUp)) is sign-agnostic.
 *   - THREE `userData` maps to Babylon `metadata`.
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

export const GAZE_DWELL_THRESHOLD_SEC = 0.600; // 600ms dwell threshold
export const GAZE_HITBOX_RADIUS = 0.25;        // 0.25 unit hitbox sphere
export const GAZE_DECAY_RATE = 2.5;            // Smooth rollback multiplier
export const ZENITH_PITCH_THRESHOLD_DEG = 75.0;// +75° pitch for zenith exit
export const ZENITH_DWELL_THRESHOLD_SEC = 1.500;// 1.5s zenith dwell threshold

export const STEM_MAPPING = [
  { index: 0, id: 'surface_temperature', alias: 'temperature', name: 'Global Temperature Anomaly', color: 0x00f0ff },
  { index: 1, id: 'atmospheric_co2', alias: 'co2', name: 'Atmospheric CO2', color: 0xf59e0b },
  { index: 2, id: 'ocean_temperature', alias: 'ocean', name: 'Ocean Heat Content', color: 0x3b82f6 },
  { index: 3, id: 'sea_ice_extent', alias: 'sea_ice', name: 'Sea Ice Extent', color: 0xe0f2fe }
];

export class VRGazeController {
  /**
   * @param {Object} vrScene - Parent TerminatorSkimVRScene
   * @param {Object} [mixer] - EarthOrchestraMixer
   * @param {Object} [options]
   */
  constructor(vrScene, mixer = null, options = {}) {
    this.vrScene = vrScene;
    this.mixer = mixer;
    this.options = Object.assign({
      dwellTime: GAZE_DWELL_THRESHOLD_SEC,
      hitboxRadius: GAZE_HITBOX_RADIUS,
      decayRate: GAZE_DECAY_RATE,
      action: 'solo', // 'solo' or 'mute'
      onTrigger: null,
      onZenithExit: null
    }, options);

    // Preallocated scratch vectors (zero-GC update loop)
    this._rayOrigin = new BABYLON.Vector3(0, 0, 0);
    this._rayDirection = new BABYLON.Vector3(0, 0, 1);
    this._rigUp = new BABYLON.Vector3(0, 1, 0);
    this._toGlyph = new BABYLON.Vector3(0, 0, 0);
    this._closest = new BABYLON.Vector3(0, 0, 0);

    this.activeGlyphIndex = -1;
    this.zenithDwell = 0.0;
    this.zenithTriggered = false;

    // Per-glyph state tracking
    this.glyphStates = STEM_MAPPING.map(m => ({
      index: m.index,
      id: m.id,
      name: m.name,
      dwellTimer: 0.0,
      progress: 0.0,
      isHovered: false,
      hasTriggered: false,
      pulseIntensity: 0.0,
      isSoloed: false,
      isMuted: false
    }));

    this.hitboxMeshes = [];
  }

  setMixer(mixer) {
    this.mixer = mixer;
  }

  init() {
    if (!this.vrScene || !this.vrScene.dataGlyphs) return;

    this.hitboxMeshes = [];
    const glyphs = this.vrScene.dataGlyphs;

    for (let i = 0; i < glyphs.length; i++) {
      const glyphGroup = glyphs[i];

      // Orient glyphGroup to face the camera origin (0, 0, 0) in CameraRig space
      glyphGroup.lookAt(BABYLON.Vector3.Zero());

      // Reuse the hitbox created by vr_scene (wired into the Babylon GUI3D
      // dwell control), or create one when the scene omitted it (tests).
      let hitboxMesh = (glyphGroup.metadata && glyphGroup.metadata.hitbox) || null;
      if (!hitboxMesh) {
        const glyphScene = glyphGroup.getScene ? glyphGroup.getScene() : null;
        hitboxMesh = BABYLON.MeshBuilder.CreateSphere(`DataGlyph_Hitbox_${i}`, {
          diameter: this.options.hitboxRadius * 2.0,
          segments: 12
        }, glyphScene);
        hitboxMesh.visibility = 0.0;
        hitboxMesh.parent = glyphGroup;
      }
      hitboxMesh.name = `DataGlyph_Hitbox_${i}`;
      hitboxMesh.metadata = Object.assign(
        hitboxMesh.metadata || {}, { glyphIndex: i }
      );
      hitboxMesh.isPickable = true; // pickable for XR pointer/GUI3D interactions
      this.hitboxMeshes.push(hitboxMesh);

      // Attach state to group metadata (THREE userData equivalend)
      glyphGroup.metadata.hitbox = hitboxMesh;
      glyphGroup.metadata.stemIndex = i;
      glyphGroup.metadata.stemId = STEM_MAPPING[i].id;
    }
  }

  /**
   * Update gaze ray probing and dwell timers.
   * @param {BABYLON.Camera} camera
   * @param {number} deltaTime
   */
  update(camera, deltaTime = 0.016) {
    if (!camera) return;

    const dt = Math.max(0.0, Math.min(10.0, Number(deltaTime) || 0.016));

    // 1. Compute Camera World Direction + Origin
    if (typeof camera.computeWorldMatrix === 'function') {
      camera.computeWorldMatrix(true); // world matrices lazily computed in Babylon
    }
    // Safely obtain camera position (globalPosition may be undefined in headless tests)
    if (camera.globalPosition) {
      this._rayOrigin.copyFrom(camera.globalPosition);
    } else if (camera.position) {
      this._rayOrigin.copyFrom(camera.position);
    } else {
      this._rayOrigin.set(0, 0, 0);
    }
    // Safely obtain forward direction
    let forwardVec;
    if (typeof camera.getForwardRay === 'function') {
      const forwardRay = camera.getForwardRay(1.0);
      forwardVec = forwardRay && forwardRay.direction ? forwardRay.direction : new BABYLON.Vector3(0, 0, 1);
    } else if (camera.forward) {
      forwardVec = camera.forward;
    } else {
      forwardVec = new BABYLON.Vector3(0, 0, 1);
    }
    this._rayDirection.copyFrom(forwardVec);

    // 2. Zenith Gaze Exit Detection (Pitch >= +75° relative to parent CameraRig / Local Orbital Up)
    const rig = (camera && camera.parent) || (this.vrScene ? this.vrScene.cameraRig : null);
    if (rig && typeof rig.getWorldMatrix === 'function') {
      const wm = rig.getWorldMatrix();
      BABYLON.Vector3.TransformNormalToRef(BABYLON.Axis.Y, wm, this._rigUp);
      this._rigUp.normalize();
    } else {
      this._rigUp.set(0, 1, 0);
    }
    const sinPitch = Math.max(-1.0, Math.min(1.0, BABYLON.Vector3.Dot(this._rayDirection, this._rigUp)));
    const pitchDeg = Math.asin(sinPitch) * (180.0 / Math.PI);
    if (pitchDeg >= ZENITH_PITCH_THRESHOLD_DEG) {
      this.zenithDwell += dt;
      const zenithProgress = Math.min(1.0, this.zenithDwell / ZENITH_DWELL_THRESHOLD_SEC);
      if (this.vrScene && this.vrScene.zenithRing && this.vrScene.zenithRing.material && this.vrScene.zenithRing.material.uniforms && this.vrScene.zenithRing.material.uniforms.uProgress) {
        this.vrScene.zenithRing.material.uniforms.uProgress.value = zenithProgress;
      }
      if (this.zenithDwell >= ZENITH_DWELL_THRESHOLD_SEC && !this.zenithTriggered) {
        this.zenithTriggered = true;
        if (typeof this.options.onZenithExit === 'function') {
          this.options.onZenithExit();
        } else if (typeof window !== 'undefined' && window.earthsonicVR && typeof window.earthsonicVR.exitVR === 'function') {
          window.earthsonicVR.exitVR();
        } else if (this.vrScene && typeof this.vrScene.exitVR === 'function') {
          this.vrScene.exitVR();
        }
      }
    } else {
      this.zenithDwell = 0.0;
      this.zenithTriggered = false;
      if (this.vrScene && this.vrScene.zenithRing && this.vrScene.zenithRing.material && this.vrScene.zenithRing.material.uniforms && this.vrScene.zenithRing.material.uniforms.uProgress) {
        this.vrScene.zenithRing.material.uniforms.uProgress.value = 0.0;
      }
    }

    // 3. Find Intersected DataGlyph (camera-forward sphere probe, same math as
    //    the verified build: project glyph onto ray, check perpendicular dist)
    let intersectedIndex = -1;
    let closestDistanceSq = Infinity;
    const glyphs = this.vrScene.dataGlyphs || [];

    for (let i = 0; i < glyphs.length; i++) {
      const glyph = glyphs[i];
      const glyphWorld = glyph.getAbsolutePosition();
      if (!glyphWorld) continue;

      // Vector from ray origin to glyph center
      this._toGlyph.copyFrom(glyphWorld);
      this._toGlyph.subtractInPlace(this._rayOrigin);
      const proj = BABYLON.Vector3.Dot(this._toGlyph, this._rayDirection);

      if (proj > 0.0) { // Must be in front of camera
        this._closest.copyFrom(this._rayDirection);
        this._closest.scaleInPlace(proj);
        const distSq = BABYLON.Vector3.DistanceSquared(this._toGlyph, this._closest);
        const rSq = this.options.hitboxRadius * this.options.hitboxRadius;

        if (distSq <= rSq && distSq < closestDistanceSq) {
          closestDistanceSq = distSq;
          intersectedIndex = i;
        }
      }
    }

    this.activeGlyphIndex = intersectedIndex;

    // 4. Update Dwell States & Progress Rings
    for (let i = 0; i < this.glyphStates.length; i++) {
      const state = this.glyphStates[i];
      const glyphGroup = glyphs[i];
      const isHovered = (i === intersectedIndex);
      state.isHovered = isHovered;

      if (isHovered) {
        if (!state.hasTriggered) {
          state.dwellTimer += dt;
          state.progress = Math.max(0.0, Math.min(1.0, state.dwellTimer / this.options.dwellTime));

          if (state.dwellTimer >= this.options.dwellTime) {
            state.hasTriggered = true;
            state.progress = 1.0;
            state.pulseIntensity = 1.0;
            this.triggerGlyph(i);
          }
        } else {
          // Sustained hover after trigger holds ring at 1.0
          state.progress = 1.0;
        }
      } else {
        // Gaze diverted from glyph
        if (state.hasTriggered) {
          // Release trigger state once gaze leaves completely
          state.hasTriggered = false;
          state.dwellTimer = 0.0;
          state.progress = 0.0;
        } else if (state.dwellTimer > 0.0) {
          // Smooth sub-threshold decay
          state.dwellTimer = Math.max(0.0, state.dwellTimer - dt * this.options.decayRate);
          state.progress = Math.max(0.0, Math.min(1.0, state.dwellTimer / this.options.dwellTime));
        }
      }

      // Decay visual pulse
      if (state.pulseIntensity > 0.0) {
        state.pulseIntensity = Math.max(0.0, state.pulseIntensity - dt * 3.0);
      }

      // 5. Update Glyph Visual Representation
      if (glyphGroup) {
        // Update shader progress ring uniform
        if (glyphGroup.metadata && glyphGroup.metadata.ringUniform) {
          glyphGroup.metadata.ringUniform.value = state.progress;
        }

        // Visual feedback on mote mesh
        const moteMesh = glyphGroup.getChildMeshes()[0];
        if (moteMesh) {
          // Scale pulse flare upon activation
          const baseScale = 1.0;
          const scaleFlare = baseScale + state.pulseIntensity * 0.35;
          moteMesh.scaling.copyFromFloats(scaleFlare, scaleFlare, scaleFlare);

          // Rotate mote slowly
          moteMesh.rotation.x += dt * 0.8;
          moteMesh.rotation.y += dt * 1.2;

          // Emissive opacity modulation based on audio solo/mute status
          if (moteMesh.material && this.mixer) {
            const track = this.mixer.getTrack(state.id);
            if (track) {
              state.isSoloed = Boolean(track.isSoloed);
              state.isMuted = Boolean(track.isMuted);
              const anySolo = this.mixer.getAllTracks().some(t => Boolean(t.isSoloed));
              const isSilenced = track.isMuted || (anySolo && !track.isSoloed);
              moteMesh.material.alpha = isSilenced ? 0.30 : (0.85 + state.pulseIntensity * 0.15);
            }
          }
        }
      }
    }
  }

  triggerGlyph(index) {
    if (index < 0 || index >= STEM_MAPPING.length) return;
    const mapping = STEM_MAPPING[index];

    if (this.mixer) {
      if (this.options.action === 'solo') {
        const track = this.mixer.getTrack(mapping.id);
        const nextSolo = track ? !track.isSoloed : true;
        this.mixer.setTrackSolo(mapping.id, nextSolo);
      } else {
        const track = this.mixer.getTrack(mapping.id);
        const nextMute = track ? !track.isMuted : true;
        this.mixer.setTrackMute(mapping.id, nextMute);
      }
    }

    if (typeof this.options.onTrigger === 'function') {
      this.options.onTrigger(index, mapping);
    }
  }

  getActiveGlyph() {
    return this.activeGlyphIndex;
  }

  getGlyphState(index) {
    return this.glyphStates[index] || null;
  }

  getZenithProgress() {
    return Math.min(1.0, this.zenithDwell / ZENITH_DWELL_THRESHOLD_SEC);
  }

  reset() {
    this.activeGlyphIndex = -1;
    this.zenithDwell = 0.0;
    this.zenithTriggered = false;
    for (const s of this.glyphStates) {
      s.dwellTimer = 0.0;
      s.progress = 0.0;
      s.isHovered = false;
      s.hasTriggered = false;
      s.pulseIntensity = 0.0;
    }
    const glyphs = this.vrScene ? this.vrScene.dataGlyphs || [] : [];
    for (const g of glyphs) {
      if (g.metadata && g.metadata.ringUniform) {
        g.metadata.ringUniform.value = 0.0;
      }
    }
    if (this.vrScene && this.vrScene.zenithRing && this.vrScene.zenithRing.material && this.vrScene.zenithRing.material.uniforms && this.vrScene.zenithRing.material.uniforms.uProgress) {
      this.vrScene.zenithRing.material.uniforms.uProgress.value = 0.0;
    }
  }

  dispose() {
    this.reset();
    for (const mesh of this.hitboxMeshes) {
      if (mesh && typeof mesh.dispose === 'function') mesh.dispose();
    }
    this.hitboxMeshes = [];
  }
}
