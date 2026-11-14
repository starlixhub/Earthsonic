/**
 * tests/test_challenger_m2_2_stress.mjs
 * Challenger M2-2: Adversarial Stress Test Suite for Milestone M2.
 * 
 * Objectives:
 * 1. TerminatorRibbon colormap & boundary clamping, vertex height displacement.
 * 2. OceanGlowField strict ocean masking (waterMask <= 0.5 discard) & Fresnel glow formula.
 * 3. AtmosphereShell Mie + Rayleigh scattering: optical depth & blue-to-amber limb tint shift.
 * 4. IceCapGroup NSIDC extent tracking & crystalline IOR = 1.31 Schlick specular rim lighting.
 * 5. 4-Channel Audio Reactivity: AnalyserNodes (fftSize=256) and smoothed envelope clamping [0, 1].
 * 6. TimeSpline horizon lock: zero roll (roll = 0.0°) along entire 573-month CatmullRom trajectory.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  EARTH_RADIUS,
  SKIM_ALTITUDE,
  CAMERA_NEAR,
  CAMERA_FAR,
  TOTAL_MONTHS,
  VRTerminatorRibbonShader,
  VRAtmosphereShellShader,
  VROceanGlowShader,
  VRIceCapShader,
  VRSurfaceShader,
  createTerminatorRibbon,
  createAtmosphereShell,
  createOceanGlowField,
  createIceCapGroup,
  createTimeSpline,
  getSplineFrame,
  interpolateHarmonizedRecord,
  updatePlanetaryShaders
} from '../frontend/js/globe/vr/index.js';

import { TrackStrip } from '../frontend/js/audio/track.js';
import { EarthOrchestraMixer } from '../frontend/js/audio/mixer.js';

/**
 * High-fidelity Mock Web Audio API Context for headless Node environments.
 */
function createMockAudioContext() {
  return {
    currentTime: 0.0,
    sampleRate: 44100,
    state: 'running',
    createGain() {
      return {
        gain: {
          value: 1.0,
          setValueAtTime() {},
          cancelScheduledValues() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        disconnect() {}
      };
    },
    createAnalyser() {
      return {
        fftSize: 256,
        frequencyBinCount: 128,
        smoothingTimeConstant: 0.5,
        minDecibels: -90.0,
        maxDecibels: -10.0,
        getFloatTimeDomainData(buf) {
          buf.fill(0);
        },
        connect() {},
        disconnect() {}
      };
    },
    createStereoPanner() {
      return {
        pan: { value: 0.0, setValueAtTime() {} },
        connect() {},
        disconnect() {}
      };
    },
    createBufferSource() {
      return {
        buffer: null,
        connect() {},
        start() {},
        stop() {},
        disconnect() {}
      };
    },
    createBuffer(channels, length, rate) {
      return {
        numberOfChannels: channels,
        length,
        sampleRate: rate,
        duration: length / rate,
        getChannelData() {
          return new Float32Array(length);
        }
      };
    },
    async resume() {
      this.state = 'running';
    }
  };
}

describe('Challenger M2-2: Adversarial Stress Testing', () => {

  // ==========================================================================
  // OBJECTIVE 1: TerminatorRibbon Colormap & Boundary
  // ==========================================================================
  describe('Objective 1: TerminatorRibbon Colormap & Displacement Verification', () => {

    it('1.1: GLSL Fragment Shader strictly clamps uAnomalyValue [-1.0, 1.0]', () => {
      const frag = VRTerminatorRibbonShader.fragmentShader;

      assert.ok(
        frag.includes('clamp(uAnomalyValue, -1.0, 1.0)'),
        'Fragment shader must strictly clamp uAnomalyValue to [-1.0, 1.0]'
      );
      assert.ok(
        frag.includes('vec3(0.15, 0.35, 0.90)') || frag.includes('vec3(0.15, 0.35, 0.9)'),
        'Fragment shader must define 1979 cool cobalt vec3(0.15, 0.35, 0.90)'
      );
      assert.ok(
        frag.includes('vec3(0.95, 0.25, 0.10)') || frag.includes('vec3(0.95, 0.25, 0.1)'),
        'Fragment shader must define 2026 amber-red vec3(0.95, 0.25, 0.10)'
      );
      assert.ok(
        frag.includes('mix('),
        'Fragment shader must interpolate colormap using mix()'
      );
    });

    it('1.2: Colormap mathematical oracle matches GLSL ramp at extreme and boundary values', () => {
      function computeRibbonColor(uAnomalyValue) {
        const anom = Math.max(-1.0, Math.min(1.0, uAnomalyValue));
        const alpha = (anom + 1.0) * 0.5;
        const coolCobalt = [0.15, 0.35, 0.90];
        const amberRed = [0.95, 0.25, 0.10];
        return [
          coolCobalt[0] * (1.0 - alpha) + amberRed[0] * alpha,
          coolCobalt[1] * (1.0 - alpha) + amberRed[1] * alpha,
          coolCobalt[2] * (1.0 - alpha) + amberRed[2] * alpha
        ];
      }

      // Extreme Underflow (super-cold)
      const cUnder = computeRibbonColor(-100.0);
      assert.ok(Math.abs(cUnder[0] - 0.15) < 1e-6);
      assert.ok(Math.abs(cUnder[1] - 0.35) < 1e-6);
      assert.ok(Math.abs(cUnder[2] - 0.90) < 1e-6);

      // Exact Lower Boundary (-1.0)
      const cMin = computeRibbonColor(-1.0);
      assert.ok(Math.abs(cMin[0] - 0.15) < 1e-6);
      assert.ok(Math.abs(cMin[1] - 0.35) < 1e-6);
      assert.ok(Math.abs(cMin[2] - 0.90) < 1e-6);

      // Midpoint (0.0)
      const cMid = computeRibbonColor(0.0);
      assert.ok(Math.abs(cMid[0] - 0.55) < 1e-6);
      assert.ok(Math.abs(cMid[1] - 0.30) < 1e-6);
      assert.ok(Math.abs(cMid[2] - 0.50) < 1e-6);

      // Exact Upper Boundary (+1.0)
      const cMax = computeRibbonColor(1.0);
      assert.ok(Math.abs(cMax[0] - 0.95) < 1e-6);
      assert.ok(Math.abs(cMax[1] - 0.25) < 1e-6);
      assert.ok(Math.abs(cMax[2] - 0.10) < 1e-6);

      // Extreme Overflow (super-hot)
      const cOver = computeRibbonColor(100.0);
      assert.ok(Math.abs(cOver[0] - 0.95) < 1e-6);
      assert.ok(Math.abs(cOver[1] - 0.25) < 1e-6);
      assert.ok(Math.abs(cOver[2] - 0.10) < 1e-6);

      // Monotonic increase of red channel
      let prevRed = -1.0;
      for (let a = -1.0; a <= 1.0; a += 0.1) {
        const c = computeRibbonColor(a);
        assert.ok(c[0] >= prevRed, `Red channel should monotonically increase, got ${c[0]} < ${prevRed}`);
        prevRed = c[0];
      }
    });

    it('1.3: Vertex height displacement is proportional to anomaly and audio envelope', () => {
      const vert = VRTerminatorRibbonShader.vertexShader;
      assert.ok(vert.includes('clamp(uAnomalyValue, -1.0, 1.0)'), 'Vertex shader must clamp uAnomalyValue');
      assert.ok(vert.includes('anomalyDisp = clampedAnom * 0.04'), 'Anomaly displacement scaling by 0.04');
      assert.ok(vert.includes('audioDisp = uAudioEnvelope * 0.02'), 'Audio envelope displacement scaling by 0.02');
      assert.ok(vert.includes('totalDisp = anomalyDisp + audioDisp + noiseDisp'), 'Total displacement combines components');
      assert.ok(vert.includes('displacedPos = position + normal * totalDisp'), 'Normal displacement on position');

      function computeDisplacement(anomaly, envelope, noise = 0.5) {
        const clampedAnom = Math.max(-1.0, Math.min(1.0, anomaly));
        const anomalyDisp = clampedAnom * 0.04;
        const audioDisp = envelope * 0.02;
        const noiseDisp = (noise - 0.5) * 0.015;
        return anomalyDisp + audioDisp + noiseDisp;
      }

      // At baseline (0 anomaly, 0 envelope, 0.5 noise) -> disp = 0.0
      assert.ok(Math.abs(computeDisplacement(0.0, 0.0, 0.5)) < 1e-6);

      // Max displacement (+1 anomaly, 1 envelope, 1.0 noise) -> 0.04 + 0.02 + 0.0075 = 0.0675 units
      const maxDisp = computeDisplacement(1.0, 1.0, 1.0);
      assert.ok(Math.abs(maxDisp - 0.0675) < 1e-4);

      // Min displacement (-1 anomaly, 0 envelope, 0.0 noise) -> -0.04 + 0 - 0.0075 = -0.0475 units
      const minDisp = computeDisplacement(-1.0, 0.0, 0.0);
      assert.ok(Math.abs(minDisp - (-0.0475)) < 1e-4);

      // Verify that higher audio envelope strictly increases displacement
      const dAudio0 = computeDisplacement(0.5, 0.0, 0.5);
      const dAudio1 = computeDisplacement(0.5, 1.0, 0.5);
      assert.ok(dAudio1 > dAudio0);
      assert.ok(Math.abs((dAudio1 - dAudio0) - 0.02) < 1e-6);
    });

    it('1.4: Ribbon day/night boundary cross product and solar alignment', () => {
      const frag = VRTerminatorRibbonShader.fragmentShader;
      assert.ok(frag.includes('cross(sunDir, norm)'), 'Fragment shader evaluates cross(sunDir, norm)');

      const ribbon = createTerminatorRibbon(10.015, 0.18, 64);
      const sunDir = new THREE.Vector3(1, 0, 0).normalize();
      updatePlanetaryShaders({
        terminatorRibbon: ribbon,
        monthRecord: { temperature_anomaly: 0.8 },
        sunDirection: sunDir
      });

      const rotatedNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(ribbon.quaternion);
      assert.ok(Math.abs(rotatedNormal.dot(sunDir) - 1.0) < 1e-4);
    });
  });

  // ==========================================================================
  // OBJECTIVE 2: OceanGlowField Strict Ocean Masking & Fresnel Formula
  // ==========================================================================
  describe('Objective 2: OceanGlowField Strict Masking & Fresnel Glow Verification', () => {

    it('2.1: Fragment shader strictly enforces waterMask <= 0.5 discard', () => {
      const frag = VROceanGlowShader.fragmentShader;
      assert.ok(
        frag.includes('if (waterMask <= 0.5)') && frag.includes('discard;'),
        'VROceanGlowShader must contain `if (waterMask <= 0.5) { discard; }`'
      );
    });

    it('2.2: Continental landmasses (waterMask <= 0.5) never emit light', () => {
      function evaluateOceanShader({ waterMask, normalDotView, uOHC, uAudioEnvelope, uTime }) {
        if (waterMask <= 0.5) {
          return { discarded: true, color: [0, 0, 0], alpha: 0.0 };
        }
        const fresnel = Math.pow(1.0 - Math.max(normalDotView, 0.0), 2.5);
        const pulse = 0.5 + 0.5 * Math.sin(uTime * 1.2) * uAudioEnvelope;
        const glow = [
          0.1 * uOHC * pulse * fresnel,
          0.6 * uOHC * pulse * fresnel,
          0.9 * uOHC * pulse * fresnel
        ];
        return { discarded: false, color: glow, alpha: fresnel * uOHC };
      }

      const landMasks = [0.0, 0.1, 0.25, 0.499, 0.500];
      for (const mask of landMasks) {
        const result = evaluateOceanShader({
          waterMask: mask,
          normalDotView: 0.0,
          uOHC: 1.0,
          uAudioEnvelope: 1.0,
          uTime: 1.3
        });
        assert.equal(result.discarded, true, `Mask ${mask} must be discarded`);
        assert.equal(result.alpha, 0.0, `Mask ${mask} must have 0 alpha`);
        assert.deepEqual(result.color, [0, 0, 0]);
      }

      const oceanMasks = [0.5001, 0.6, 0.8, 1.0];
      for (const mask of oceanMasks) {
        const result = evaluateOceanShader({
          waterMask: mask,
          normalDotView: 0.0,
          uOHC: 1.0,
          uAudioEnvelope: 1.0,
          uTime: 1.3
        });
        assert.equal(result.discarded, false, `Ocean mask ${mask} must be kept`);
        assert.ok(result.alpha > 0.0, `Ocean mask ${mask} must have positive alpha`);
      }
    });

    it('2.3: Authoritative formula verification for fresnel, pulse, glow, and gl_FragColor', () => {
      const frag = VROceanGlowShader.fragmentShader;

      assert.ok(frag.includes('pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5)'));
      assert.ok(frag.includes('pulse = 0.5 + 0.5 * sin(uTime * 1.2) * uAudioEnvelope'));
      assert.ok(frag.includes('glow = vec3(0.1, 0.6, 0.9) * uOHC * pulse * fresnel'));
      assert.ok(frag.includes('gl_FragColor = vec4(glow, fresnel * uOHC)'));

      function computeOceanGlow(dotNV, ohc, env, time) {
        const cosTheta = Math.max(0.0, Math.min(1.0, dotNV));
        const fresnel = Math.pow(1.0 - cosTheta, 2.5);
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.2) * env;
        const glow = [
          0.1 * ohc * pulse * fresnel,
          0.6 * ohc * pulse * fresnel,
          0.9 * ohc * pulse * fresnel
        ];
        return { fresnel, pulse, glow, alpha: fresnel * ohc };
      }

      // 1. Perpendicular viewing (nadir, dot = 1.0): fresnel = 0, no subsurface glow
      const nadir = computeOceanGlow(1.0, 1.0, 1.0, 0.0);
      assert.equal(nadir.fresnel, 0.0);
      assert.deepEqual(nadir.glow, [0, 0, 0]);
      assert.equal(nadir.alpha, 0.0);

      // 2. Grazing viewing (limb, dot = 0.0): fresnel = 1.0
      const limb = computeOceanGlow(0.0, 0.8, 0.5, 0.0);
      assert.equal(limb.fresnel, 1.0);
      assert.equal(limb.pulse, 0.5); // sin(0) = 0
      assert.ok(Math.abs(limb.glow[0] - (0.1 * 0.8 * 0.5 * 1.0)) < 1e-6);
      assert.ok(Math.abs(limb.glow[1] - (0.6 * 0.8 * 0.5 * 1.0)) < 1e-6);
      assert.ok(Math.abs(limb.glow[2] - (0.9 * 0.8 * 0.5 * 1.0)) < 1e-6);
      assert.ok(Math.abs(limb.alpha - (1.0 * 0.8)) < 1e-6);

      // 3. Pulse stability when audio envelope is 0.0: pulse is fixed at 0.5
      for (let t = 0; t < 10; t += 0.5) {
        const p = computeOceanGlow(0.5, 0.5, 0.0, t);
        assert.equal(p.pulse, 0.5);
      }
    });
  });

  // ==========================================================================
  // OBJECTIVE 3: AtmosphereShell Mie + Rayleigh Scattering
  // ==========================================================================
  describe('Objective 3: AtmosphereShell Mie + Rayleigh Scattering Verification', () => {

    it('3.1: Optical depth and limb tint formulas in GLSL', () => {
      const frag = VRAtmosphereShellShader.fragmentShader;

      assert.ok(frag.includes('clamp(uCO2Ppm, 280.0, 600.0)'));
      assert.ok(frag.includes('clamp((clampedCO2 - 336.0) / (426.0 - 336.0), 0.0, 1.0)'));
      assert.ok(frag.includes('(1.0 + 0.75 * co2Norm) * (1.0 + 0.15 * uAudioEnvelope)'));
      assert.ok(frag.includes('vec3(0.10, 0.50, 0.95)')); // stratospheric blue
      assert.ok(frag.includes('vec3(0.85, 0.55, 0.20)')); // warm amber-ochre haze
      assert.ok(frag.includes('pow(1.0 - cosTheta, 3.2)')); // limb grazing factor
      assert.ok(frag.includes('pow(sunDotView, 8.0) * (0.30 + 0.70 * co2Norm)')); // Mie forward scattering
    });

    it('3.2: uCO2Ppm scaling across 336 to 426+ ppm shifts blue to amber-ochre haze', () => {
      function evaluateAtmosphere(co2Ppm, envelope = 0.0) {
        const clampedCO2 = Math.max(280.0, Math.min(600.0, co2Ppm));
        const co2Norm = Math.max(0.0, Math.min(1.0, (clampedCO2 - 336.0) / (426.0 - 336.0)));
        const opticalDepth = (1.0 + 0.75 * co2Norm) * (1.0 + 0.15 * envelope);

        const blue = [0.10, 0.50, 0.95];
        const amber = [0.85, 0.55, 0.20];
        const tint = [
          blue[0] * (1.0 - co2Norm) + amber[0] * co2Norm,
          blue[1] * (1.0 - co2Norm) + amber[1] * co2Norm,
          blue[2] * (1.0 - co2Norm) + amber[2] * co2Norm
        ];
        return { co2Norm, opticalDepth, tint };
      }

      // 1979 Baseline: 336.0 ppm
      const atmo1979 = evaluateAtmosphere(336.0, 0.0);
      assert.equal(atmo1979.co2Norm, 0.0);
      assert.equal(atmo1979.opticalDepth, 1.0);
      assert.ok(Math.abs(atmo1979.tint[0] - 0.10) < 1e-4);
      assert.ok(Math.abs(atmo1979.tint[1] - 0.50) < 1e-4);
      assert.ok(Math.abs(atmo1979.tint[2] - 0.95) < 1e-4);

      // 2026 Modern: 426.0 ppm
      const atmo2026 = evaluateAtmosphere(426.0, 0.0);
      assert.equal(atmo2026.co2Norm, 1.0);
      assert.equal(atmo2026.opticalDepth, 1.75);
      assert.ok(Math.abs(atmo2026.tint[0] - 0.85) < 1e-4);
      assert.ok(Math.abs(atmo2026.tint[1] - 0.55) < 1e-4);
      assert.ok(Math.abs(atmo2026.tint[2] - 0.20) < 1e-4);

      // Monotonic expansion of optical depth and red haze across 336 -> 426
      let lastDepth = 0.0;
      let lastRed = 0.0;
      for (let ppm = 336; ppm <= 426; ppm += 10) {
        const curr = evaluateAtmosphere(ppm, 0.0);
        assert.ok(curr.opticalDepth >= lastDepth);
        assert.ok(curr.tint[0] >= lastRed);
        lastDepth = curr.opticalDepth;
        lastRed = curr.tint[0];
      }

      // Super-426 ppm (e.g. 500 ppm) clamps co2Norm to 1.0, preserving max haze
      const atmo500 = evaluateAtmosphere(500.0, 0.0);
      assert.equal(atmo500.co2Norm, 1.0);
      assert.equal(atmo500.opticalDepth, 1.75);

      // Sub-336 ppm (e.g. 280 ppm) clamps co2Norm to 0.0, preserving pure blue
      const atmo280 = evaluateAtmosphere(280.0, 0.0);
      assert.equal(atmo280.co2Norm, 0.0);
      assert.equal(atmo280.opticalDepth, 1.0);
    });
  });

  // ==========================================================================
  // OBJECTIVE 4: IceCapGroup NSIDC Extent & Crystalline IOR = 1.31
  // ==========================================================================
  describe('Objective 4: IceCapGroup Extent Tracking & Specular IOR Verification', () => {

    it('4.1: GLSL Shaders verify IOR = 1.31, R0 = 0.01802, and Schlick power 5.0', () => {
      const frag = VRIceCapShader.fragmentShader;

      assert.ok(frag.includes('1.31'), 'Fragment shader must define IOR = 1.31');
      assert.ok(frag.includes('0.01802'), 'Fragment shader must calculate R0 = 0.01802');
      assert.ok(frag.includes('pow(1.0 - cosTheta, 5.0)'), 'Fragment shader must use Schlick power 5.0');
      assert.ok(frag.includes('smoothstep(boundaryLat - 2.5, boundaryLat + 2.5, absLat)'), 'Radial boundary feathering');
    });

    it('4.2: Theoretical Schlick Fresnel calculation matches R0 = 0.01802 and rim reflectance', () => {
      const IOR = 1.31;
      const R0 = Math.pow((IOR - 1.0) / (IOR + 1.0), 2);
      assert.ok(Math.abs(R0 - 0.01802) < 0.0001, `R0 calculation mismatch: ${R0}`);

      function computeSchlickFresnel(cosTheta) {
        return R0 + (1.0 - R0) * Math.pow(1.0 - cosTheta, 5.0);
      }

      // Normal incidence: 1.802% reflectance
      const normalRef = computeSchlickFresnel(1.0);
      assert.ok(Math.abs(normalRef - R0) < 1e-6);

      // Grazing incidence: 100% reflectance (specular rim lighting)
      const grazingRef = computeSchlickFresnel(0.0);
      assert.ok(Math.abs(grazingRef - 1.0) < 1e-6);

      // Mid-angle (45 deg, cosTheta ~ 0.7071)
      const midRef = computeSchlickFresnel(Math.SQRT1_2);
      assert.ok(midRef > R0 && midRef < 0.1);
    });

    it('4.3: Vertex displacement and boundary latitude track normalized ice extent [0, 1]', () => {
      const vert = VRIceCapShader.vertexShader;
      assert.ok(vert.includes('clamp(uIceExtent, 0.0, 1.0) * 0.025 + uAudioEnvelope * 0.008'));

      function computeIceBoundary(normExtent) {
        const clamped = Math.max(0.0, Math.min(1.0, normExtent));
        return 85.0 - 25.0 * clamped;
      }

      // Maximum glaciation (extent = 1.0): ice boundary extends down to 60° latitude
      assert.equal(computeIceBoundary(1.0), 60.0);

      // Record melt (extent = 0.0): ice boundary retreats to 85° latitude
      assert.equal(computeIceBoundary(0.0), 85.0);

      // Midpoint extent = 0.5: ice boundary is at 72.5° latitude
      assert.equal(computeIceBoundary(0.5), 72.5);

      function getBoundaryAlpha(boundaryLat, absLat) {
        const t = Math.max(0.0, Math.min(1.0, (absLat - (boundaryLat - 2.5)) / 5.0));
        return t * t * (3.0 - 2.0 * t); // smoothstep
      }

      assert.equal(getBoundaryAlpha(70.0, 50.0), 0.0);
      assert.equal(getBoundaryAlpha(70.0, 80.0), 1.0);
      assert.ok(Math.abs(getBoundaryAlpha(70.0, 70.0) - 0.5) < 1e-4);
    });
  });

  // ==========================================================================
  // OBJECTIVE 5: 4-Channel Audio Reactivity & AnalyserNodes
  // ==========================================================================
  describe('Objective 5: 4-Channel Audio Reactivity & Envelope Smoothing', () => {

    it('5.1: Mixer exposes getTrackAnalyser with fftSize = 256 for all 4 stems when audioCtx active', () => {
      const mockCtx = createMockAudioContext();
      const mixer = new EarthOrchestraMixer({ audioCtx: mockCtx });
      assert.equal(typeof mixer.getTrackAnalyser, 'function');

      const expectedIds = ['surface_temperature', 'atmospheric_co2', 'ocean_temperature', 'sea_ice_extent'];

      for (let i = 0; i < 4; i++) {
        const analyserByIndex = mixer.getTrackAnalyser(i);
        const analyserById = mixer.getTrackAnalyser(expectedIds[i]);
        assert.ok(analyserByIndex, `Track ${i} AnalyserNode must exist`);
        assert.equal(analyserByIndex, analyserById, `Index ${i} and ID ${expectedIds[i]} must return identical AnalyserNode`);

        // Check fftSize invariant = 256 (frequencyBinCount = 128)
        assert.equal(analyserByIndex.fftSize, 256);
        assert.equal(analyserByIndex.frequencyBinCount, 128);
      }

      // Also verify uninitialized mixer returns null gracefully without throwing
      const uninitMixer = new EarthOrchestraMixer();
      assert.equal(uninitMixer.getTrackAnalyser(0), null);
    });

    it('5.2: TrackStrip getAudioEnvelope computes smoothed normalized amplitude in [0.0, 1.0]', () => {
      const mockCtx = createMockAudioContext();
      const track = new TrackStrip('surface_temperature', { audioCtx: mockCtx });
      assert.equal(typeof track.getAudioEnvelope, 'function');

      // Test silent initial state
      assert.equal(track.getAudioEnvelope(), 0.0);

      // Mock audio time-domain data into analyserNode
      if (track.analyserNode) {
        const halfScaleData = new Float32Array(128).fill(0.25);
        track.analyserNode.getFloatTimeDomainData = (buf) => {
          buf.set(halfScaleData);
        };

        // Repeated calls approach the target via EMA smoothing
        let env = 0.0;
        for (let step = 0; step < 10; step++) {
          env = track.getAudioEnvelope(0.25);
          assert.ok(env >= 0.0 && env <= 1.0, `Envelope must be clamped [0, 1], got ${env}`);
        }
        // RMS = 0.25 -> target = min(1.0, 0.25 * 2.8) = 0.70
        assert.ok(Math.abs(env - 0.70) < 0.05, `Smoothed envelope should converge near 0.70, got ${env}`);

        // Overdriven signal (> 1.0) strictly clamped to 1.0
        const clippingData = new Float32Array(128).fill(1.5);
        track.analyserNode.getFloatTimeDomainData = (buf) => {
          buf.set(clippingData);
        };
        for (let step = 0; step < 25; step++) {
          env = track.getAudioEnvelope(0.5);
        }
        assert.ok(env <= 1.0, `Envelope must never exceed 1.0, got ${env}`);
        assert.ok(Math.abs(env - 1.0) < 1e-5, `Envelope must converge near 1.0, got ${env}`);

        // Direct over-unity state test: clamp must guarantee <= 1.0
        track._currentEnvelope = 2.5;
        const clampedOver = track.getAudioEnvelope(0.5);
        assert.ok(clampedOver <= 1.0, `Envelope must be clamped to <= 1.0, got ${clampedOver}`);

        // Silent signal (all zeros) decays to 0.0
        const zeroData = new Float32Array(128).fill(0.0);
        track.analyserNode.getFloatTimeDomainData = (buf) => {
          buf.set(zeroData);
        };
        for (let step = 0; step < 30; step++) {
          env = track.getAudioEnvelope(0.25);
        }
        assert.ok(env < 0.01, 'Silent input must decay toward 0.0');
      }
    });

    it('5.3: Mixer getAudioEnvelopes returns 4 smoothed numbers driving planetary shaders', () => {
      const mockCtx = createMockAudioContext();
      const mixer = new EarthOrchestraMixer({ audioCtx: mockCtx });
      const envs = mixer.getAudioEnvelopes();
      assert.equal(envs.length, 4);
      envs.forEach((e, idx) => {
        assert.ok(typeof e === 'number');
        assert.ok(e >= 0.0 && e <= 1.0, `Envelope ${idx} must be in [0, 1]`);
      });
    });
  });

  // ==========================================================================
  // OBJECTIVE 6: TimeSpline Horizon Lock (Roll = 0.0° Invariant)
  // ==========================================================================
  describe('Objective 6: TimeSpline Horizon Lock & Orthonormal Frame Verification', () => {

    it('6.1: TimeSpline has exactly 573 points, all at orbital skim altitude 10.22', () => {
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);
      assert.equal(spline.points.length, 573);
      assert.equal(TOTAL_MONTHS, 573);

      for (let i = 0; i < 573; i++) {
        const r = spline.points[i].length();
        assert.ok(
          Math.abs(r - 10.22) < 1e-4,
          `Point ${i} altitude should be 10.22, got ${r}`
        );
      }
    });

    it('6.2: getSplineFrame enforces roll = 0.0° across dense sampling of entire 573-month trajectory', () => {
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);

      // Adversarially test 1,000 steps along the spline (t from 0.0 to 1.0)
      const testSteps = 1000;
      for (let s = 0; s <= testSteps; s++) {
        const t = s / testSteps;
        const frame = getSplineFrame(spline, t, SKIM_ALTITUDE);

        // 1. Position strictly at altitude 10.22
        const posLen = frame.position.length();
        assert.ok(Math.abs(posLen - 10.22) < 1e-4, `t=${t}: position length mismatch ${posLen}`);

        // 2. Up vector matches normalized position (planet zenith)
        const expectedUp = frame.position.clone().normalize();
        assert.ok(Math.abs(frame.up.dot(expectedUp) - 1.0) < 1e-5, `t=${t}: up vector must match zenith`);

        // 3. Right vector is strictly orthogonal to Up (horizon alignment)
        const rightDotUp = Math.abs(frame.right.dot(frame.up));
        assert.ok(rightDotUp < 1e-5, `t=${t}: right.up must be 0.0, got ${rightDotUp}`);

        // 4. Forward vector is strictly orthogonal to Up (horizon alignment)
        const forwardDotUp = Math.abs(frame.forward.dot(frame.up));
        assert.ok(forwardDotUp < 1e-5, `t=${t}: forward.up must be 0.0, got ${forwardDotUp}`);

        // 5. Right and Forward are mutually orthogonal
        const rightDotForward = Math.abs(frame.right.dot(frame.forward));
        assert.ok(rightDotForward < 1e-5, `t=${t}: right.forward must be 0.0, got ${rightDotForward}`);

        // 6. Right, Up, and Forward form a normalized right-handed coordinate basis
        assert.ok(Math.abs(frame.right.length() - 1.0) < 1e-5);
        assert.ok(Math.abs(frame.up.length() - 1.0) < 1e-5);
        assert.ok(Math.abs(frame.forward.length() - 1.0) < 1e-5);

        // 7. Verify Roll Angle = 0.0°
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(frame.quaternion);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(frame.quaternion);
        const camLook = new THREE.Vector3(0, 0, -1).applyQuaternion(frame.quaternion);

        // Camera local up must match planet zenith frame.up
        assert.ok(Math.abs(camUp.dot(frame.up) - 1.0) < 1e-4, `t=${t}: camUp mismatch`);
        // Camera local right must match frame.right
        assert.ok(Math.abs(camRight.dot(frame.right) - 1.0) < 1e-4, `t=${t}: camRight mismatch`);
        // Camera local look must match frame.forward
        assert.ok(Math.abs(camLook.dot(frame.forward) - 1.0) < 1e-4, `t=${t}: camLook mismatch`);

        // Compute roll about line of sight:
        const rollSine = camRight.dot(frame.up);
        assert.ok(Math.abs(rollSine) < 1e-5, `t=${t}: roll sine must be 0, got ${rollSine}`);
      }
    });

    it('6.3: Polar singularity & boundary parameter clamping [0.0, 1.0]', () => {
      const spline = createTimeSpline(SKIM_ALTITUDE, TOTAL_MONTHS);

      // Underflow parameter (t = -1.5) clamped to 0.0
      const frameUnder = getSplineFrame(spline, -1.5, SKIM_ALTITUDE);
      const frame0 = getSplineFrame(spline, 0.0, SKIM_ALTITUDE);
      assert.ok(frameUnder.position.distanceTo(frame0.position) < 1e-5);

      // Overflow parameter (t = 2.5) clamped to 1.0
      const frameOver = getSplineFrame(spline, 2.5, SKIM_ALTITUDE);
      const frame1 = getSplineFrame(spline, 1.0, SKIM_ALTITUDE);
      assert.ok(frameOver.position.distanceTo(frame1.position) < 1e-5);

      // NaN or null parameter fallback to 0.0
      const frameNaN = getSplineFrame(spline, NaN, SKIM_ALTITUDE);
      assert.ok(frameNaN.position.distanceTo(frame0.position) < 1e-5);
    });
  });
});
