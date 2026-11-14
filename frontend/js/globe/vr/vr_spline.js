/**
 * @file vr_spline.js
 * @deprecated This module is DEPRECATED as of VR-AUDIT-2026.
 *
 * Catmull-Rom camera path and horizon-lock orbital frame calculations will be
 * migrated to dedicated path/orbit controllers.
 *
 * NOTE: Month-lookup logic and climate record interpolation (TOTAL_MONTHS,
 * interpolateHarmonizedRecord) have been extracted to `vr_timeline.js`.
 * DO NOT re-export timeline/month functions from this module.
 *
 * 573-Month TimeSpline (Centripetal Catmull-Rom) & Horizon-Lock Orbital Frame.
 * Milestone M2 / Requirements R2 & R4 (Features 17 & 19).
 *
 * Babylon.js migration note (VR-AUDIT-2026):
 *   The task brief suggested Babylon's `Curve3.CreateCatmullRomSpline`, but that
 *   API is (a) uniformly parameterized (no centripetal mode) and (b) has no
 *   arc-length `getPointAt` mapping — both of which the verified build relies
 *   on ("Centripetal parameterization prevents looping, cusps, or velocity
 *   overshoot" — vr_spline.js invariant). A silent swap would change the 573
 *   -month camera trajectory formula. This port therefore reproduces the exact
 *   numerics of the verified Three.js build (`THREE.CatmullRomCurve3`, curveType
 *   'centripetal', closed=false, arcLengthDivisions=200) in engine-agnostic
 *   pure JS, cross-verified against the Three.js oracle in the test suites.
 *
 * Exports (Catmull-Rom / camera-path only):
 *   SKIM_ALTITUDE, SplineVector3, crossVectors, CentripetalCatmullRomSpline,
 *   createTimeSpline, getSplineFrame
 */

import { TOTAL_MONTHS } from './vr_timeline.js';

/**
 * @deprecated Stratospheric skim altitude constant.
 */
export const SKIM_ALTITUDE = 10.22;

// ============================================================================
// Lightweight engine-agnostic vector math with the method surface used by the
// VR scene and the test oracles (THREE.Vector3-compatible property read access:
// tests may pass these objects into THREE.Vector3 arithmetic freely).
// ============================================================================

/**
 * @deprecated Vector3 math retained for legacy Catmull-Rom spline compatibility.
 */
export class SplineVector3 {
  constructor(x = 0.0, y = 0.0, z = 0.0) {
    this.x = Number(x) || 0.0;
    this.y = Number(y) || 0.0;
    this.z = Number(z) || 0.0;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new SplineVector3(this.x, this.y, this.z);
  }

  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSq());
  }

  distanceTo(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceToSquared(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  normalize() {
    return this.divideScalar(this.length() || 1.0);
  }

  divideScalar(s) {
    const inv = (s !== 0.0) ? 1.0 / s : 0.0;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    return this;
  }

  negate() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }
}

export function crossVectors(a, b) {
  const vx = a.y * b.z - a.z * b.y;
  const vy = a.z * b.x - a.x * b.z;
  const vz = a.x * b.y - a.y * b.x;
  return new SplineVector3(vx, vy, vz);
}

/**
 * Basis matrix to quaternion. Numerically identical to
 * THREE.Quaternion.setFromRotationMatrix(makeBasis(right, up, back)) for an
 * orthonormal right-handed basis (Shepperd's method branch selection however
 * equals three's implementation for a rotation matrix).
 */
function quaternionFromBasis(rightC, upC, backC) {
  const m11 = rightC.x, m21 = rightC.y, m31 = rightC.z; // column 0
  const m12 = upC.x, m22 = upC.y, m32 = upC.z;          // column 1
  const m13 = backC.x, m23 = backC.y, m33 = backC.z;    // column 2

  // THREE.Quaternion.setFromRotationMatrix branches
  const trace = m11 + m22 + m33;
  let x, y, z, w;

  if (trace > 0.0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }

  return { x, y, z, w };
}

// ============================================================================
// Centripetal Catmull-Rom spline (exact numerics of THREE.CatmullRomCurve3,
// closed = false, curveType = 'centripetal', tension 0.5, arcLengthDivisions =
// 200).
// ============================================================================

/** Cubic polynomial coefficient editor: p(s) = c0 + c1*s + c2*s^2 + c3*s^3 */
function makeCubicPoly() {
  let c0 = 0.0, c1 = 0.0, c2 = 0.0, c3 = 0.0;

  function init(x0, x1, t0, t1) {
    c0 = x0;
    c1 = t0;
    c2 = -3.0 * x0 + 3.0 * x1 - 2.0 * t0 - t1;
    c3 = 2.0 * x0 - 2.0 * x1 + t0 + t1;
  }

  return {
    initCatmullRom(x0, x1, x2, x3, tension) {
      init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
    },
    initNonuniformCatmullRom(x0, x1, x2, x3, dt0, dt1, dt2) {
      let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
      let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
      t1 *= dt1;
      t2 *= dt1;
      init(x1, x2, t1, t2);
    },
    calc(t) {
      const t2 = t * t;
      const t3 = t2 * t;
      return c0 + c1 * t + c2 * t2 + c3 * t3;
    }
  };
}

const ARC_LENGTH_DIVISIONS = 200; // THREE.Curve default

/**
 * @deprecated Centripetal Catmull-Rom curve implementation for camera path.
 */
export class CentripetalCatmullRomSpline {
  constructor(points = [], closed = false) {
    this.isCatmullRomCurve3 = true;
    this.type = 'CatmullRomCurve3';
    this.points = points;
    this.closed = closed;
    this.curveType = 'centripetal';
    this.tension = 0.5;
    this.arcLengthDivisions = ARC_LENGTH_DIVISIONS;
    this._cacheArcLengths = null;
    this._needsUpdate = true;
  }

  updateArcLengths() {    this._needsUpdate = true;
    this._getLengths();
  }

  _getLengths() {
    if (this._cacheArcLengths && this._cacheArcLengths.length === this.arcLengthDivisions + 1 && !this._needsUpdate) {
      return this._cacheArcLengths;
    }
    this._needsUpdate = false;

    const cache = [];
    let last = this.getPoint(0.0);
    let sum = 0.0;
    cache.push(0.0);
    for (let p = 1; p <= this.arcLengthDivisions; p++) {
      const current = this.getPoint(p / this.arcLengthDivisions);
      sum += current.distanceTo(last);
      cache.push(sum);
      last = current;
    }
    this._cacheArcLengths = cache;
    return cache;
  }

  /** THREE.Curve.getUtoTmapping: equidistant parameter mapping via binary search */
  getUtoTmapping(u) {
    const arcLengths = this._getLengths();
    const il = arcLengths.length;
    const targetArcLength = u * arcLengths[il - 1];

    let low = 0;
    let high = il - 1;
    let i = 0;
    while (low <= high) {
      i = Math.floor(low + (high - low) / 2);
      const comparison = arcLengths[i] - targetArcLength;
      if (comparison < 0) {
        low = i + 1;
      } else if (comparison > 0) {
        high = i - 1;
      } else {
        high = i;
        break;
      }
    }

    i = high;
    if (arcLengths[i] === targetArcLength) {
      return i / (il - 1);
    }

    const lengthBefore = arcLengths[i];
    const lengthAfter = arcLengths[i + 1];
    const segmentLength = lengthAfter - lengthBefore;
    const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;
    const t = (i + segmentFraction) / (il - 1);
    return t;
  }

  /** Exact PORT of THREE.CatmullRomCurve3.getPoint (closed = false, centripetal) */
  getPoint(t, optionalTarget = null) {
    const out = optionalTarget || new SplineVector3();
    const points = this.points;
    const l = points.length;

    const p = (l - (this.closed ? 0 : 1)) * t;
    let intPoint = Math.floor(p);
    let weight = p - intPoint;

    if (this.closed) {
      intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
    } else if (weight === 0 && intPoint === l - 1) {
      intPoint = l - 2;
      weight = 1.0;
    }

    let p0;
    let p3;

    if (this.closed || intPoint > 0) {
      p0 = points[(intPoint - 1) % l];
    } else {
      // extrapolate first point
      p0 = points[0].clone().sub(points[1]).add(points[0]);
    }

    const p1 = points[intPoint % l];
    const p2 = points[(intPoint + 1) % l];

    if (this.closed || intPoint + 2 < l) {
      p3 = points[(intPoint + 2) % l];
    } else {
      // extrapolate last point
      p3 = points[l - 1].clone().sub(points[l - 2]).add(points[l - 1]);
    }

    // Centripetal: three.js uses pow(distanceToSquared, 0.25)
    let dt0 = Math.pow(p0.distanceToSquared(p1), 0.25);
    let dt1 = Math.pow(p1.distanceToSquared(p2), 0.25);
    let dt2 = Math.pow(p2.distanceToSquared(p3), 0.25);

    // safety check for repeated points
    if (dt1 < 1e-4) dt1 = 1.0;
    if (dt0 < 1e-4) dt0 = dt1;
    if (dt2 < 1e-4) dt2 = dt1;

    const px = makeCubicPoly();
    const py = makeCubicPoly();
    const pz = makeCubicPoly();
    px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
    py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
    pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);

    out.set(px.calc(weight), py.calc(weight), pz.calc(weight));
    return out;
  }

  /** THREE.Curve.getPointAt via equidistant mapping */
  getPointAt(u, optionalTarget = null) {
    const t = this.getUtoTmapping(u);
    return this.getPoint(t, optionalTarget);
  }

  /** THREE.Curve.getTangent: finite-difference derivative (delta = 1e-4) */
  getTangent(t, optionalTarget = null) {
    const delta = 0.0001;
    let t1 = t - delta;
    let t2 = t + delta;

    if (t1 < 0.0) t1 = 0.0;
    if (t2 > 1.0) t2 = 1.0;

    const pt1 = this.getPoint(t1);
    const pt2 = this.getPoint(t2);

    const out = optionalTarget || new SplineVector3();
    out.copy(pt2).sub(pt1).normalize();
    return out;
  }

  /** THREE.Curve.getTangentAt via equidistant mapping */
  getTangentAt(u, optionalTarget = null) {
    const t = this.getUtoTmapping(u);
    return this.getTangent(t, optionalTarget);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * @deprecated Trajectory generation along 573-month path.
 *
 * Builds the 573-waypoint centripetal Catmull-Rom trajectory at orbital skim
 * altitude. Numerically identical to the previous build's
 * THREE.CatmullRomCurve3(points, false, 'centripetal').
 *
 * @param {number} [altitude=10.22] - Orbital distance from planet origin
 * @param {number} [numPoints=TOTAL_MONTHS] - Total monthly records
 * @returns {CentripetalCatmullRomSpline}
 */
export function createTimeSpline(altitude = SKIM_ALTITUDE, numPoints = TOTAL_MONTHS) {
  const points = [];
  const inclinationRad = (23.44 * Math.PI) / 180.0; // Axial tilt match

  for (let k = 0; k < numPoints; k++) {
    const u = k / (numPoints - 1);
    // 12 full orbital revolutions across the 47.75-year timeline
    const lon = u * Math.PI * 2.0 * 12.0 - Math.PI;
    const lat = inclinationRad * Math.sin(u * Math.PI * 2.0 * 24.0);

    const x = altitude * Math.cos(lat) * Math.cos(lon);
    const y = altitude * Math.sin(lat);
    const z = altitude * Math.cos(lat) * Math.sin(lon);

    points.push(new SplineVector3(x, y, z));
  }

  return new CentripetalCatmullRomSpline(points, false);
}

/**
 * @deprecated CameraRig frame calculations with zero-roll horizon lock.
 *
 * Calculates orthonormal position, quaternion, and basis vectors for CameraRig
 * with 100% locked horizontal horizon (roll === 0.0° invariant).
 *
 * Shape-compatible with the previous build: { position, quaternion, up,
 * forward, right } with a subset of THREE.Vector3 methods so test oracles can
 * compose THREE.Vector3 arithmetic directly against these members.
 *
 * @param {CentripetalCatmullRomSpline} spline
 * @param {number} t - Timeline progress parameter in [0.0, 1.0]
 * @param {number} [altitude=10.22]
 * @returns {{ position: SplineVector3, quaternion: {x,y,z,w}, up: SplineVector3, forward: SplineVector3, right: SplineVector3 }}
 */
export function getSplineFrame(spline, t, altitude = SKIM_ALTITUDE) {
  const clampedT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));

  // 1. Position on sphere surface at exact skim altitude
  const rawPoint = spline.getPointAt(clampedT);
  const position = rawPoint.clone().normalize().multiplyScalar(altitude);

  // 2. Planet zenith up normal
  const up = position.clone().normalize();

  // 3. Raw flight tangent along curve
  const rawTangent = spline.getTangentAt(clampedT).normalize();

  // 4. Starboard lateral vector (orthogonal to flight tangent and planet normal)
  let right = crossVectors(rawTangent, up);
  if (right.lengthSq() < 1e-6) {
    // Polar singularity fallback
    right = new SplineVector3(1, 0, 0);
  } else {
    right.normalize();
  }

  // 5. Pure horizon forward direction (boresight line of sight, roll === 0.0°)
  const forward = crossVectors(up, right).normalize();

  // 6. Camera look rotation quaternion: X=Right, Y=Up, Z=-Forward
  //    (numerically identical to THREE.Matrix4.makeBasis(right, up, forward.negate())
  //    followed by THREE.Quaternion.setFromRotationMatrix)
  const back = forward.clone().negate();
  const quaternion = quaternionFromBasis(right, up, back);

  return {
    position,
    quaternion,
    up,
    forward,
    right
  };
}

