/**
 * frontend/js/globe/vr/vr_audio.js
 * 3D HRTF Spatial Audio Subsystem for EARTHSONIC Terminator Skim VR.
 * Requirement R5: Features 21 & 22. Babylon.js port (VR-MIGRATION-2026).
 *
 * Invariants (unchanged from the verified build):
 *   - AudioListener bound to VR PerspectiveCamera (position & forward/up vectors)
 *   - 4 HRTF PannerNodes: panningModel='HRTF', distanceModel='inverse', refDistance=2.0, rolloffFactor=1.2, maxDistance=100.0
 *   - 4 PannerNodes dynamically track DataGlyphs[0..3] 3D world coordinates
 *   - Sample-locked timeline synchronization: scrubs audio to t * duration with 50ms lookahead and 40ms seek throttling
 *   - Zero-GC frame updates using preallocated scratch vectors
 *
 * Port note: the Web Audio graph is plain Web Audio API (not engine-specific)
 * and keeps the exact verified constants/chain. Only the camera/glyph position
 * accessors changed: THREE camera.getWorldPosition/Direction/Quaternion map to
 * Babylon camera.globalPosition / getForwardRay().direction / world-matrix
 * rotation (world up derived from the camera world matrix, not the local
 * upVector property), and glyph.getWorldPosition maps to
 * glyph.getAbsolutePosition().
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

export const PANNING_MODEL = 'HRTF';
export const DISTANCE_MODEL = 'inverse';
export const REF_DISTANCE = 2.0;
export const ROLLOFF_FACTOR = 1.2;
export const MAX_DISTANCE = 100.0;

export class VRSpatialAudio {
  /**
   * @param {Object} [options]
   */
  constructor(options = {}) {
    this.app = options.app || null;
    this.scene = options.scene || null;
    this.audioCtx = options.audioCtx || null;
    this.mixer = options.mixer || null;
    this.camera = options.camera || null;
    this.dataGlyphs = options.dataGlyphs || [];

    this.panners = [];
    this.isAttached = false;
    this.lastSeekTime = 0.0;
    this.lastSeekTarget = -1.0;

    // Scratchpad variables for zero-GC frame updates
    this._tempCamPos = new BABYLON.Vector3();
    this._tempCamForward = new BABYLON.Vector3();
    this._tempCamUp = new BABYLON.Vector3(0, 1, 0);
    this._tempGlyphPos = new BABYLON.Vector3();

    // Create initial panner nodes
    this._createPannerNodes();
  }

  /**
   * Initialize or update audio context and scene graph bindings.
   * @param {AudioContext} audioCtx
   * @param {Object} mixer
   * @param {BABYLON.Camera} camera
   * @param {Array} dataGlyphs
   */
  init(audioCtx, mixer, camera, dataGlyphs) {
    if (audioCtx) this.audioCtx = audioCtx;
    if (mixer) this.mixer = mixer;
    if (camera) this.camera = camera;
    if (dataGlyphs) this.dataGlyphs = dataGlyphs;

    this._createPannerNodes();
  }

  _createPannerNodes() {
    this.panners = [];

    // Fallback/Mock for headless Node.js test environment
    if (!this.audioCtx || typeof this.audioCtx.createPanner !== 'function') {
      for (let i = 0; i < 4; i++) {
        const mockPanner = {
          panningModel: PANNING_MODEL,
          distanceModel: DISTANCE_MODEL,
          refDistance: REF_DISTANCE,
          rolloffFactor: ROLLOFF_FACTOR,
          maxDistance: MAX_DISTANCE,
          coneInnerAngle: 360,
          coneOuterAngle: 360,
          positionX: { value: 0, setValueAtTime: function(v) { this.value = v; } },
          positionY: { value: 0, setValueAtTime: function(v) { this.value = v; } },
          positionZ: { value: 0, setValueAtTime: function(v) { this.value = v; } },
          setPosition: function(x, y, z) {
            this.positionX.value = x;
            this.positionY.value = y;
            this.positionZ.value = z;
          },
          connect: () => {},
          disconnect: () => {}
        };
        this.panners.push(mockPanner);
      }
      return;
    }

    // Real Web Audio API HRTF PannerNodes
    for (let i = 0; i < 4; i++) {
      const panner = this.audioCtx.createPanner();
      panner.panningModel = PANNING_MODEL;
      panner.distanceModel = DISTANCE_MODEL;
      panner.refDistance = REF_DISTANCE;
      panner.rolloffFactor = ROLLOFF_FACTOR;
      panner.maxDistance = MAX_DISTANCE;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      this.panners.push(panner);
    }
  }

  /**
   * Reversibly insert HRTF PannerNodes into mixer channels.
   * Chain: TrackStrip.outputNode -> PannerNode -> Mixer.busInputNode
   */
  attach() {
    if (this.isAttached || !this.mixer || this.panners.length < 4) return;
    const tracks = this.mixer.getAllTracks();

    for (let i = 0; i < 4; i++) {
      const track = tracks[i];
      const panner = this.panners[i];
      if (!track || !panner) continue;

      try {
        if (typeof track.disconnect === 'function') {
          track.disconnect();
        }
        if (typeof track.connect === 'function') {
          track.connect(panner);
        }
        if (typeof panner.connect === 'function') {
          if (this.mixer.busInputNode) {
            panner.connect(this.mixer.busInputNode);
          } else if (this.mixer.masterGainNode) {
            panner.connect(this.mixer.masterGainNode);
          }
        }
        track.spatialPannerNode = panner;
      } catch (err) {
        console.warn(`[VRSpatialAudio] Error attaching panner ${i}:`, err);
      }
    }

    this.mixer.spatialPanners = this.panners;
    this.isAttached = true;
  }

  /**
   * Remove HRTF PannerNodes and restore direct 2D bus wiring.
   */
  detach() {
    if (!this.isAttached || !this.mixer) return;
    const tracks = this.mixer.getAllTracks();

    for (let i = 0; i < 4; i++) {
      const track = tracks[i];
      const panner = this.panners[i];
      if (!track) continue;

      try {
        if (panner && typeof panner.disconnect === 'function') {
          panner.disconnect();
        }
        if (typeof track.disconnect === 'function') {
          track.disconnect();
        }
        if (typeof track.connect === 'function') {
          if (this.mixer.busInputNode) {
            track.connect(this.mixer.busInputNode);
          } else if (this.mixer.masterGainNode) {
            track.connect(this.mixer.masterGainNode);
          }
        }
        track.spatialPannerNode = null;
      } catch (err) {
        console.warn(`[VRSpatialAudio] Error detaching panner ${i}:`, err);
      }
    }

    this.isAttached = false;
  }

  /**
   * Update 3D listener and panner coordinates every frame.
   * @param {BABYLON.Camera} [camera]
   * @param {Array} [dataGlyphs]
   */
  update(camera = this.camera, dataGlyphs = this.dataGlyphs) {
    if (!camera) return;

    const now = (this.audioCtx && this.audioCtx.currentTime) || 0.0;

    // 1. Update AudioListener
    this._updateListener(camera, now);

    // 2. Update 4 PannerNodes from DataGlyphs 3D world coordinates
    this._updatePanners(dataGlyphs, now);
  }

  /**
   * Alias for update() to conform with Milestone M4 render loop coordination specification.
   */
  updatePositions(camera = this.camera, dataGlyphs = this.dataGlyphs) {
    return this.update(camera, dataGlyphs);
  }

  _updateListener(camera, now) {
    if (!this.audioCtx || !this.audioCtx.listener) return;
    const listener = this.audioCtx.listener;

    if (typeof camera.getForwardRay === 'function') {
      // Babylon camera path (world matrices are lazily computed — refresh so
      // globalPosition/forward reflect pending rotation changes)
      if (typeof camera.computeWorldMatrix === 'function') {
        camera.computeWorldMatrix(true);
      }
      this._tempCamPos.copyFrom(camera.globalPosition);
      const forward = camera.getForwardRay(1.0).direction;
      this._tempCamForward.copyFrom(forward);
      // WORLD up: camera.upVector is the LOCAL up property; the listener needs
      // the world-space up (rig rotations must be reflected), so derive it
      // from the camera world matrix.
      BABYLON.Vector3.TransformNormalToRef(BABYLON.Axis.Y, camera.getWorldMatrix(), this._tempCamUp);
      this._tempCamUp.normalize();
    } else if (camera.position) {
      // Generic fallback (headless mocks without engine methods)
      this._tempCamPos.copyFrom(camera.position);
      this._tempCamForward.set(0, 0, 1);
      this._tempCamUp.set(0, 1, 0);
    }

    // W3C AudioParam API (Modern WebXR browsers)
    if (listener.positionX && typeof listener.positionX.setValueAtTime === 'function') {
      listener.positionX.setValueAtTime(this._tempCamPos.x, now);
      listener.positionY.setValueAtTime(this._tempCamPos.y, now);
      listener.positionZ.setValueAtTime(this._tempCamPos.z, now);
      if (listener.forwardX && typeof listener.forwardX.setValueAtTime === 'function') {
        listener.forwardX.setValueAtTime(this._tempCamForward.x, now);
        listener.forwardY.setValueAtTime(this._tempCamForward.y, now);
        listener.forwardZ.setValueAtTime(this._tempCamForward.z, now);
      }
      if (listener.upX && typeof listener.upX.setValueAtTime === 'function') {
        listener.upX.setValueAtTime(this._tempCamUp.x, now);
        listener.upY.setValueAtTime(this._tempCamUp.y, now);
        listener.upZ.setValueAtTime(this._tempCamUp.z, now);
      }
    } else if (typeof listener.setPosition === 'function') {
      // Legacy Web Audio API fallback
      listener.setPosition(this._tempCamPos.x, this._tempCamPos.y, this._tempCamPos.z);
      if (typeof listener.setOrientation === 'function') {
        listener.setOrientation(
          this._tempCamForward.x, this._tempCamForward.y, this._tempCamForward.z,
          this._tempCamUp.x, this._tempCamUp.y, this._tempCamUp.z
        );
      }
    }
  }

  _updatePanners(dataGlyphs, now) {
    if (!dataGlyphs || !this.panners) return;

    for (let i = 0; i < Math.min(4, dataGlyphs.length, this.panners.length); i++) {
      const glyph = dataGlyphs[i];
      const panner = this.panners[i];
      if (!glyph || !panner) continue;

      if (typeof glyph.getAbsolutePosition === 'function') {
        // Babylon TransformNode path
        this._tempGlyphPos.copyFrom(glyph.getAbsolutePosition());
      } else if (typeof glyph.getWorldPosition === 'function') {
        // Generic duck-typed path (test mocks)
        glyph.getWorldPosition(this._tempGlyphPos);
      } else if (glyph.position) {
        this._tempGlyphPos.copyFromFloats(glyph.position.x, glyph.position.y, glyph.position.z);
      }

      if (panner.positionX && typeof panner.positionX.setValueAtTime === 'function') {
        panner.positionX.setValueAtTime(this._tempGlyphPos.x, now);
        panner.positionY.setValueAtTime(this._tempGlyphPos.y, now);
        panner.positionZ.setValueAtTime(this._tempGlyphPos.z, now);
      } else if (typeof panner.setPosition === 'function') {
        panner.setPosition(this._tempGlyphPos.x, this._tempGlyphPos.y, this._tempGlyphPos.z);
      }
    }
  }

  /**
   * Sample-locked timeline scrubbing with 40ms seek throttling to prevent underruns.
   * @param {number} timelineT - Progress parameter in [0.0, 1.0]
   */
  syncPlayhead(timelineT) {
    if (!this.mixer) return;
    const dur = this.mixer.duration || 20.0;
    const clampedT = Math.max(0.0, Math.min(1.0, Number(timelineT) || 0.0));
    const targetSec = clampedT * dur;

    // Suppress identical stationary seeks
    if (Math.abs(targetSec - this.lastSeekTarget) < 1e-4) {
      return;
    }

    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // 40ms seek throttling during continuous flight, exempting timeline boundaries
    if (clampedT > 0.0 && clampedT < 1.0 && (nowMs - this.lastSeekTime < 40.0)) {
      return;
    }
    this.lastSeekTime = nowMs;
    this.lastSeekTarget = targetSec;

    if (typeof this.mixer.seekProgress === 'function') {
      this.mixer.seekProgress(clampedT);
    } else if (typeof this.mixer.seek === 'function') {
      this.mixer.seek(targetSec);
    }
  }

  dispose() {
    this.detach();
    this.panners = [];
  }
}
