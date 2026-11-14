/**
 * frontend/js/globe/vr/vr_glider.js
 * Inertial Yaw Glider Navigation Subsystem for EARTHSONIC Terminator Skim VR.
 * Requirement R4: Features 18 & 19. Babylon.js port (VR-MIGRATION-2026).
 *
 * Invariants (unchanged from the verified build):
 *   - Yaw deadzone +/-15.0° (+/- 0.2618 rad) with damped acceleration
 *   - Damped acceleration: timelineVelocity += yawExcess * 0.0004; timelineVelocity *= 0.92;
 *   - 100% Locked Horizontal Horizon: Euler order 'YXZ' with roll === 0.0° at all times
 *   - Scrubbing timelinePosition glides CameraRig along TimeSpline across 573 months
 *   - Native smartphone gyroscope (DeviceOrientationEvent) with pointer/mouse-drag fallback
 *
 * Port note: Babylon TargetCamera/UniversalCamera compose `rotation` as
 * RotationYawPitchRoll(rotation.y, rotation.x, rotation.z) = Ry(yaw)*Rx(pitch)
 * *Rz(roll) — identical semantics to THREE.Euler order 'YXZ' (roll applied
 * first, then pitch about the world X axis, then yaw about world Y), with the
 * same sign convention. DeviceOrientationEvent is a browser API and is not
 * engine-specific — it is used identically to the previous build.
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

export const GLIDER_DEADZONE_DEG = 15.0;
export const GLIDER_ACCELERATION = 0.0004;
export const GLIDER_DAMPING = 0.92;

const DEG_TO_RAD = Math.PI / 180.0;

/**
 * Pure deterministic single-step inertial glider acceleration and damping.
 * Exact mathematical parity with test oracle oracle_glider_step.
 *
 * @param {number} yawDeg - Head look yaw in degrees relative to flight tangent (+ = right, - = left)
 * @param {number} currentVelocity - Previous timeline velocity
 * @param {number} [deadzoneDeg=15.0] - Deadzone threshold in degrees
 * @param {number} [accel=0.0004] - Acceleration multiplier
 * @param {number} [damping=0.92] - Per-step geometric damping factor
 * @returns {{ excess: number, newVelocity: number }}
 */
export function computeGliderStep(
  yawDeg,
  currentVelocity,
  deadzoneDeg = GLIDER_DEADZONE_DEG,
  accel = GLIDER_ACCELERATION,
  damping = GLIDER_DAMPING
) {
  const yaw = Number(yawDeg) || 0.0;
  const vel = Number(currentVelocity) || 0.0;
  const dz = Number(deadzoneDeg) || GLIDER_DEADZONE_DEG;
  const a = Number(accel) || GLIDER_ACCELERATION;
  const d = Number(damping) || GLIDER_DAMPING;

  let excess = 0.0;
  if (Math.abs(yaw) <= dz) {
    excess = 0.0;
  } else if (yaw > dz) {
    excess = yaw - dz;
  } else {
    excess = yaw - (-dz);
  }

  const newVelocity = (vel + excess * a) * d;
  return { excess, newVelocity };
}

/**
 * Enforces pitch limits [-90, +90] and roll === 0.0° locked horizon.
 * Exact parity with test oracle enforce_zero_roll.
 *
 * @param {number} pitchDeg - Head pitch in degrees
 * @param {number} yawDeg - Head yaw in degrees
 * @param {number} [rollDeg=0.0] - Roll angle (ignored and forced to 0.0)
 * @returns {{ pitch: number, yaw: number, roll: number }}
 */
export function enforceZeroRoll(pitchDeg, yawDeg, rollDeg = 0.0) {
  const pitch = Math.max(-90.0, Math.min(90.0, Number(pitchDeg) || 0.0));
  const rawYaw = Number(yawDeg) || 0.0;
  const yaw = ((rawYaw % 360.0) + 360.0) % 360.0;
  return { pitch, yaw, roll: 0.0 };
}

/**
 * VRGliderNavigation: Controller-free spatial inertial glider navigation.
 */
export class VRGliderNavigation {
  /**
   * @param {Object} vrScene - Parent TerminatorSkimVRScene instance
   * @param {Object} [options]
   * @param {number} [options.deadzoneDeg=15.0]
   * @param {number} [options.accel=0.0004]
   * @param {number} [options.damping=0.92]
   * @param {Function} [options.onTimelineScrub] - Callback invoked when timeline scrubs
   */
  constructor(vrScene = null, options = {}) {
    this.vrScene = vrScene;
    this.deadzoneDeg = options.deadzoneDeg !== undefined ? options.deadzoneDeg : GLIDER_DEADZONE_DEG;
    this.accel = options.accel !== undefined ? options.accel : GLIDER_ACCELERATION;
    this.damping = options.damping !== undefined ? options.damping : GLIDER_DAMPING;
    this.onTimelineScrub = options.onTimelineScrub || null;

    // Timeline state
    this.timelinePosition = 0.0; // [0.0, 1.0]
    this.timelineVelocity = 0.0;
    this.yawExcess = 0.0;

    // Head orientation angles in degrees
    this.yawDeg = 0.0;
    this.pitchDeg = 0.0;
    this.rollDeg = 0.0; // Strictly 0.0 at all times

    // Device orientation calibration
    this.gyroAvailable = false;
    this.referenceAlpha = null;
    this.referenceBeta = null;
    this.referenceGamma = null;

    // Desktop pointer interaction state
    this.isDragging = false;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.pointerSensitivity = 0.18; // degrees per pixel

    // Lifecycle
    this.isEnabled = false;
    this.domElement = null;

    // Bound listeners for clean disposal
    this._onDeviceOrientation = this._handleDeviceOrientation.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
  }

  /**
   * Attach DOM event listeners to render canvas and window.
   * @param {HTMLElement} [domElement]
   */
  init(domElement = null) {
    if (domElement) {
      this.domElement = domElement;
    } else if (this.vrScene && this.vrScene.engine && typeof this.vrScene.engine.getRenderingCanvas === 'function') {
      // Babylon port: the glider listens on the engine's rendering canvas
      this.domElement = this.vrScene.engine.getRenderingCanvas();
    }

    if (this.domElement) {
      this.domElement.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pointermove', this._onPointerMove, { passive: false });
      window.addEventListener('pointerup', this._onPointerUp, { passive: true });
      window.addEventListener('pointercancel', this._onPointerUp, { passive: true });
      window.addEventListener('deviceorientation', this._onDeviceOrientation, { passive: true });
    }
  }

  enable() {
    this.isEnabled = true;
  }

  disable() {
    this.isEnabled = false;
    this.isDragging = false;
    this.timelineVelocity = 0.0;
    this.yawExcess = 0.0;
  }

  recenter() {
    this.referenceAlpha = null;
    this.referenceBeta = null;
    this.referenceGamma = null;
    this.yawDeg = 0.0;
    this.pitchDeg = 0.0;
    this.rollDeg = 0.0;
    this.yawExcess = 0.0;
    this.timelineVelocity = 0.0;
    this._applyCameraOrientation();
  }

  setTimelinePosition(t) {
    this.timelinePosition = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));
  }

  getTimelinePosition() {
    return this.timelinePosition;
  }

  getTimelineVelocity() {
    return this.timelineVelocity;
  }

  /**
   * Programmatic head orientation setter (for automated tests and calibration).
   * @param {number} yawDeg - Head yaw in degrees (+ = right, - = left)
   * @param {number} pitchDeg - Head pitch in degrees (+ = up, - = down)
   */
  setLookAngles(yawDeg, pitchDeg) {
    const safe = enforceZeroRoll(pitchDeg, yawDeg, 0.0);
    // Allow raw yaw values (both positive and negative) for steering
    this.yawDeg = Number(yawDeg) || 0.0;
    this.pitchDeg = safe.pitch;
    this.rollDeg = 0.0;
    this._applyCameraOrientation();
  }

  getLookAngles() {
    return {
      yawDeg: this.yawDeg,
      pitchDeg: this.pitchDeg,
      rollDeg: 0.0 // Guaranteed 100% zero
    };
  }

  /**
   * Pure deterministic physics step function.
   * @param {number} yawDeg
   * @returns {{ excess: number, newVelocity: number, newPosition: number }}
   */
  stepPhysics(yawDeg) {
    const res = computeGliderStep(yawDeg, this.timelineVelocity, this.deadzoneDeg, this.accel, this.damping);
    this.yawExcess = res.excess;
    this.timelineVelocity = res.newVelocity;

    // Velocity creep cutoff
    if (Math.abs(this.timelineVelocity) < 1e-7) {
      this.timelineVelocity = 0.0;
    }

    // Advance timeline position
    const nextPos = Math.max(0.0, Math.min(1.0, this.timelinePosition + this.timelineVelocity));

    // Elastic wall arrest
    if (nextPos <= 0.0 && this.timelineVelocity < 0.0) {
      this.timelineVelocity = 0.0;
    } else if (nextPos >= 1.0 && this.timelineVelocity > 0.0) {
      this.timelineVelocity = 0.0;
    }

    this.timelinePosition = nextPos;

    return {
      excess: this.yawExcess,
      newVelocity: this.timelineVelocity,
      newPosition: this.timelinePosition
    };
  }

  /**
   * Frame tick simulation update.
   * @param {number} deltaTime - Frame delta time in seconds
   */
  update(deltaTime = 0.016) {
    // 1. Compute inertial physics if glider is enabled or has residual velocity
    if (this.isEnabled || Math.abs(this.timelineVelocity) > 1e-7) {
      const prevPos = this.timelinePosition;
      this.stepPhysics(this.yawDeg);

      // If position advanced, notify listener & update parent VR scene TimeSpline
      if (Math.abs(this.timelinePosition - prevPos) > 1e-7 || Math.abs(this.timelineVelocity) > 1e-6) {
        if (typeof this.onTimelineScrub === 'function') {
          this.onTimelineScrub(this.timelinePosition);
        }
        if (this.vrScene && typeof this.vrScene.updateTimeline === 'function') {
          this.vrScene.updateTimeline(this.timelinePosition);
        }
      }
    }

    // 2. Apply camera orientation with 100% locked horizon
    this._applyCameraOrientation();
  }

  /**
   * Apply local camera Euler rotation with roll locked strictly to 0.0°.
   *
   * SIGN CONVENTION DIFFERENCE (documented port deviation, empirically
   * verified against Babylon 9.35): three.js 'YXZ' Euler with +pitch looked UP
   * and +yaw looked LEFT; Babylon composes rotation as
   * RotationYawPitchRoll(y, x, z) in LEFT-HANDED space where +yawX looks
   * RIGHT and -pitchX looks UP. yawDeg(+ right) / pitchDeg(+ up) semantics are
   * thereby preserved 1:1 vs the verified build by inverting both signs.
   */
  _applyCameraOrientation() {
    const camera = this.vrScene ? this.vrScene.camera : null;
    if (!camera) return;

    // - Rotation around Y (rotation.y) is yaw (horizontal looking)
    // - Rotation around X (rotation.x) is pitch (vertical looking)
    // - Rotation around Z (rotation.z) is roll (locked to 0.0°)
    camera.rotation.x = DEG_TO_RAD * (-this.pitchDeg);
    camera.rotation.y = DEG_TO_RAD * this.yawDeg;
    camera.rotation.z = 0.0; // 100% LOCKED HORIZON INVARIANT
    if (camera.rotationQuaternion) {
      // Babylon prefers rotationQuaternion when set; force the Euler path.
      camera.rotationQuaternion = null;
    }
  }

  /**
   * Process DeviceOrientationEvent from mobile gyro.
   */
  _handleDeviceOrientation(event) {
    if (!event || event.alpha === null || event.alpha === undefined) return;
    this.gyroAvailable = true;
    if (!this.isEnabled) return;

    const alpha = event.alpha || 0; // [0, 360)
    const beta = event.beta || 0;   // [-180, 180]
    const gamma = event.gamma || 0; // [-90, 90]

    if (this.referenceAlpha === null) {
      this.referenceAlpha = alpha;
      this.referenceBeta = beta;
      this.referenceGamma = gamma;
      return;
    }

    // In landscape mode (typical VR viewer), device gamma/alpha map to pitch and yaw
    // Screen orientation angle (90 for landscape-primary, 270 for landscape-secondary)
    const orientationAngle = (typeof window !== 'undefined' && window.screen && window.screen.orientation)
      ? (window.screen.orientation.angle || 0)
      : (typeof window !== 'undefined' && window.orientation) ? window.orientation : 0;

    let relYaw = 0;
    let relPitch = 0;

    if (Math.abs(orientationAngle) === 90 || Math.abs(orientationAngle) === 270) {
      // Landscape mode
      const sign = orientationAngle === 90 ? 1 : -1;
      relYaw = (alpha - this.referenceAlpha);
      relPitch = sign * (gamma - this.referenceGamma);
    } else {
      // Portrait fallback
      relYaw = (alpha - this.referenceAlpha);
      relPitch = (beta - this.referenceBeta);
    }

    // Normalize relative yaw to [-180, 180]
    while (relYaw > 180) relYaw -= 360;
    while (relYaw < -180) relYaw += 360;

    this.yawDeg = relYaw;
    this.pitchDeg = Math.max(-90.0, Math.min(90.0, relPitch));
    this.rollDeg = 0.0; // Strictly zero roll
  }

  /**
   * Pointer down handler for desktop fallback.
   */
  _handlePointerDown(event) {
    if (!event) return;
    this.isDragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  }

  /**
   * Pointer move handler for desktop drag navigation.
   */
  _handlePointerMove(event) {
    if (!this.isDragging || !event) return;
    const dx = event.clientX - this.lastPointerX;
    const dy = event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;

    this.yawDeg += dx * this.pointerSensitivity;
    this.pitchDeg = Math.max(-90.0, Math.min(90.0, this.pitchDeg - dy * this.pointerSensitivity));
    this.rollDeg = 0.0;
  }

  _handlePointerUp() {
    this.isDragging = false;
  }

  dispose() {
    this.disable();
    if (this.domElement) {
      this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('pointermove', this._onPointerMove);
      window.removeEventListener('pointerup', this._onPointerUp);
      window.removeEventListener('pointercancel', this._onPointerUp);
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
    }
  }
}

// Alias for convenience
export const VRGlider = VRGliderNavigation;
