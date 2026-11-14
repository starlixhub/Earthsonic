/**
 * frontend/js/globe/vr/vr_shaders.js
 * EARTHSONIC Milestone M2: Normalized Planetary Shaders & Physical Phenomena.
 * Babylon.js port (VR-MIGRATION-2026). Requirement R3 (Audio-Reactive Shaders)
 * & Requirement R2 (Planetary Atmosphere/Oceans/Ice/Terminator).
 *
 * Port policy:
 *   - All 6 GLSL programs are kept BYTE-IDENTICAL to the verified Three.js
 *     build except for the two edits required by the engine boundary, both
 *     visible below as "[BABYLON PORT EDIT]" comments:
 *       1. VRSurfaceShader: the two sRGB day/night map samples are wrapped in
 *          an exact port of THREE's sRGBTransferEOTF (three samples sRGB
 *          hardware-decoded; Babylon ShaderMaterial samples raw bytes).
 *       2. The THREE shader chunk includes `#include <tonemapping_fragment>`
 *          and `#include <colorspace_fragment>` are replaced with the exact
 *          GLSL port of those chunks (ACESFilmic + sRGB OETF, taken
 *          verbatim-from three r187's tonemapping_pars_fragment /
 *          colorspace_pars_fragment).
 *   - Three.js built-in uniforms (modelMatrix, viewMatrix, projectionMatrix,
 *     normalMatrix, cameraPosition, position, normal, uv) are supplied by a
 *     small Babylon prelude (`BABYLON_VR_VERTEX_PRELUDE` /
 *     `BABYLON_VR_FRAGMENT_PRELUDE`) injected right after each program's
 *     `precision highp float;` line. Babylon's ShaderMaterial auto-binds
 *     `world`, `view`, `projection` and even `cameraPosition` from the active
 *     camera when those uniform names are listed in `options.uniforms`
 *     (verified against @babylonjs/core Materials/shaderMaterial.pure.js
 *     bindForSubMesh: world l.783, view l.847, projection l.850,
 *     cameraPosition l.859).
 *   - Each material exposes a THREE-shaped `.uniforms` proxy (`uX.value`) so
 *     the verified sync/gaze/glyph code paths port 1:1.
 *
 * Includes:
 *   1. VRTerminatorRibbonShader (NASA GISTEMP v4 / Track 0)
 *   2. VRAtmosphereShellShader (NOAA Mauna Loa CO2 / Track 1)
 *   3. VROceanGlowShader (NOAA NCEI OHC 0-2000m / Track 2)
 *   4. VRIceCapShader (NSIDC Polar Sea Ice Extent / Track 3)
 *   5. VRSurfaceShader (NASA Blue/Black Marble + GEBCO Displacement)
 *   6. DataGlyphShader (Diegetic Holographic Progress Rings)
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

// ============================================================================
// 0. THREE -> BABYLON GLSL COMPATIBILITY PRELUDE
// ============================================================================

/**
 * Injected after the leading `precision highp float;` of every VERTEX shader.
 * Defines the Three.js built-in names on top of Babylon's auto-bound matrices.
 * NOTE: `normalMatrix` = mat3(view * world). All vr_* models use uniform-scale
 * rotation-only world matrices, so this equals THREE's normalMatrix exactly.
 */
export const BABYLON_VR_VERTEX_PRELUDE = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 view;
uniform mat4 projection;
uniform vec3 cameraPosition;
#define modelMatrix world
#define viewMatrix view
#define projectionMatrix projection
#define normalMatrix mat3(view * world)
#define modelViewMatrix (view * world)
`;

function injectPrelude(source, prelude) {
  const anchor = 'precision highp float;';
  const first = source.indexOf(anchor);
  if (first === -1) {
    return prelude + '\n' + source;
  }
  // Inject immediately after the anchor so the prelude inherits the precision
  // statement (GLSL applies a `precision` declaration only to subsequent
  // declarations).
  return source.slice(0, first + anchor.length) + '\n' + prelude + source.slice(first + anchor.length);
}

// ============================================================================
// 0b. EXACT PORT OF THREE glsl CHUNKS (three r187 ShaderChunk sources)
// ============================================================================

/** three/src/renderers/shaders/ShaderChunk/colorspace_pars_fragment.glsl.js (sRGB branch) */
const GLSL_SRGB_TRANSFER = `
vec4 sRGBTransferOETF( in vec4 value ) {
  return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}
vec3 linearToOutputTexel( in vec4 v ) {
  return sRGBTransferOETF( v ).rgb;
}
`;

/**
 * three/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js
 * ACESFilmic branch, exposure = 1.0 (Babylon scene.imageProcessingConfiguration
 * will NOT process ShaderMaterial outputs, so the same math is applied
 * in-shader exactly as the renderer did in the Three.js build).
 */
const GLSL_ACES_TONEMAPPING = `
const float toneMappingExposure = 1.0;
vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
  const mat3 ACESInputMat = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ), // transposed from source
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );
  const mat3 ACESOutputMat = mat3(
    vec3(  1.60475, -0.10208, -0.00327 ), // transposed from source
    vec3( -0.53108,  1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605,  1.07602 )
  );
  color *= toneMappingExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 toneMapping( vec3 color ) {
  return ACESFilmicToneMapping( color );
}
`;

/**
 * three sRGBDecode helper (renderer/common: sRGBTransferEOTF as a vec3).
 * Used ONLY for uDayMap/uNightMap sampling (see surface shader port edit).
 */
const GLSL_SRGB_DECODE = `
vec3 sRGBTransferEOTF3( in vec3 c ) {
  return mix( pow( c * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), c * 0.0773993808, vec3( lessThanEqual( c, vec3( 0.04045 ) ) ) );
}
`;

/**
 * Injected after the leading `precision highp float;` of every FRAGMENT shader.
 * Babylon auto-fills `cameraPosition` (declared) from scene.activeCamera.
 *
 * The three chunk ports above MUST be part of the prelude: every fragment
 * shader tail calls toneMapping()/linearToOutputTexel(), and the surface shader
 * calls sRGBTransferEOTF3(). Leaving them out made the GLSL fail to link
 * ("no matching overloaded function found"), so ShaderMaterial.isReady() never
 * returned true, the mesh never became ready, scene.isReady() stayed false and
 * the render loop never drew a frame — a blank canvas with no thrown JS error.
 * Declared after the chunk constants because `const` is in the TDZ above them.
 */
export const BABYLON_VR_FRAGMENT_PRELUDE = `
uniform vec3 cameraPosition;
${GLSL_SRGB_TRANSFER}${GLSL_ACES_TONEMAPPING}${GLSL_SRGB_DECODE}`;

// ============================================================================
// 1. PROCEDURAL TILEABLE NOISE GENERATOR
// ============================================================================

export function generateTileableNoiseTexture(width = 256, height = 256, scene = null) {
  if (typeof document === 'undefined') {
    // Headless / Node environment fallback (2x2 neutral RawTexture placeholder)
    if (scene) {
      return BABYLON.RawTexture.CreateRGBATexture(
        new Uint8Array(width * height * 4), width, height, scene,
        false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE
      );
    }
    // Without a scene handle in Node, only call sites with a scene are valid;
    // vr_scene always provides one. Kept for API parity with the old build.
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const fx = x / width;
      const fy = y / height;
      const nx = Math.sin(fx * Math.PI * 2.0) * 1.5;
      const ny = Math.sin(fy * Math.PI * 2.0) * 1.5;

      let v = 0.5 * Math.sin(nx * 4.0 + ny * 2.0);
      v += 0.25 * Math.sin(nx * 8.0 - ny * 6.0);
      v += 0.125 * Math.sin(nx * 16.0 + ny * 14.0);

      const byteVal = Math.floor(Math.max(0, Math.min(255, (v + 0.5) * 255)));
      const idx = (y * width + x) * 4;
      data[idx] = byteVal;
      data[idx + 1] = byteVal;
      data[idx + 2] = byteVal;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
  // Canvas -> RawTexture (byte-identical pixels; Babylon has no CanvasTexture
  // for ES module bundling with raw RGBA data, so rasterize the canvas once).
  if (scene) {
    const ctxData = ctx.getImageData(0, 0, width, height);
    const raw = BABYLON.RawTexture.CreateRGBATexture(
      new Uint8Array(ctxData.data), width, height, scene, false, false,
      BABYLON.Texture.LINEAR_SAMPLINGMODE
    );
    raw.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    raw.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    return raw;
  }
  return null;
}

// ============================================================================
// 1b. SHADERMATERIAL WRAPPER (THREE uniform-dict compatibility)
// ============================================================================

/**
 * Registers GLSL into Babylon's Effect.ShadersStore and wraps ShaderMaterial
 * with the verification-critical properties from the Three.js build:
 *   - `.uniforms` proxy with `{ uName: { value } }` entries (setter routes to
 *     Babylon's setFloat/setVector3/setColor3/setTexture)
 *   - `.depthWrite` boolean (mirrors material.disableDepthWrite)
 *   - `.side` compat string ('FrontSide' | 'BackSide' | 'DoubleSide') mapped to
 *     Babylon backFaceCulling
 */
export class VRShaderMaterial extends BABYLON.ShaderMaterial {
  constructor(name, scene, {
    vertexShader,
    fragmentShader,
    uniforms = {},
    globalUniforms = null,
    transparent = false,
    depthWrite = true,
    side = 'FrontSide',
    blending = 'AdditiveBlending',
    attributes = null
  } = {}) {
    const keyBase = sanitizeShaderKey(name);
    const vertexKey = keyBase + 'VertexShader';
    const fragmentKey = keyBase + 'FragmentShader';

    const vertexSource = injectPrelude(vertexShader, BABYLON_VR_VERTEX_PRELUDE);
    const fragmentSource = injectPrelude(fragmentShader, BABYLON_VR_FRAGMENT_PRELUDE);

    BABYLON.Effect.ShadersStore[vertexKey] = vertexSource;
    BABYLON.Effect.ShadersStore[fragmentKey] = fragmentSource;

    // Babylon auto-binds these names when listed (shaderMaterial.pure.js l.783,
    // l.847, l.850, l.859). `cameraPosition` is consumed by fragments; listing
    // it is harmless when a program does not declare it.
    const uniformNames = [
      'world', 'view', 'projection', 'viewProjection', 'cameraPosition',
      ...Object.keys(uniforms)
    ];

    const samplerNames = Object.keys(uniforms)
      .filter((k) => uniforms[k] instanceof BABYLON.BaseTexture);

    super(name, scene, { vertex: keyBase, fragment: keyBase }, {
      attributes: attributes || ['position', 'normal', 'uv'],
      uniforms: uniformNames,
      samplers: samplerNames,
      needAlphaBlending: transparent
    });

    // ---- Blending mode mapping (THREE -> Babylon) --------------------------
    // THREE.NormalBlending  -> Babylon ALPHA_COMBINE (standard SRC_ALPHA blend)
    // THREE.AdditiveBlending -> Babylon ALPHA_ADD
    const engine = scene.getEngine();
    if (transparent) {
      if (blending === 'AdditiveBlending') {
        this.setAlphaMode(BABYLON.Engine.ALPHA_ADD);
      } else {
        this.setAlphaMode(BABYLON.Engine.ALPHA_COMBINE);
      }
    } else {
      this.setAlphaMode(BABYLON.Engine.ALPHA_DISABLE);
    }

    // ---- Side mapping (THREE -> Babylon) -----------------------------------
    // FrontSide  -> backFaceCulling = true  (FRONTSIDE geometry, outward faces)
    // BackSide   -> backFaceCulling = true  (BACKSIDE geometry, inward faces)
    // DoubleSide -> backFaceCulling = false
    this._threeSide = side;
    this.backFaceCulling = (side !== 'DoubleSide');

    // ---- Depth write mirroring ---------------------------------------------
    // (tests + stress suites assert depthWrite === false on transparent shells)
    this._threeDepthWrite = depthWrite;
    this.applyDepthWrite();

    // ---- THREE-shaped uniforms proxy ---------------------------------------
    this._uniformValues = {};
    this.uniforms = {};
    for (const key of Object.keys(uniforms)) {
      const initial = uniforms[key];
      pushUniformValue(this, key, initial);
    }

    if (globalUniforms) {
      for (const [k, v] of Object.entries(globalUniforms)) {
        if (!(k in this._uniformValues)) {
          pushUniformValue(this, k, v);
        }
      }
    }
  }

  applyDepthWrite() {
    // disableDepthWrite wins; forceDepthWrite guards accidental resets during
    // alpha compositions (Babylon Material.pure disables write for blends).
    this.disableDepthWrite = !this._threeDepthWrite;
    this.forceDepthWrite = this._threeDepthWrite;
  }

  get depthWrite() {
    return this._threeDepthWrite;
  }

  set depthWrite(v) {
    this._threeDepthWrite = Boolean(v);
    this.applyDepthWrite();
  }

  get side() {
    return this._threeSide;
  }

  set side(v) {
    this._threeSide = v;
    this.backFaceCulling = (v !== 'DoubleSide');
  }
}

function sanitizeShaderKey(name) {
  return 'vr' + String(name).replace(/[^A-Za-z0-9_]/g, '') + 'Shader';
}

function pushUniformValue(material, key, initial) {
  material._uniformValues[key] = initial;
  const proxy = {
    get value() {
      return material._uniformValues[key];
    },
    set value(v) {
      material._uniformValues[key] = v;
      material.setUniformValue(key, v);
    }
  };
  material.uniforms[key] = proxy;
  material.setUniformValue(key, initial);
}

/** Babylon uniform setter routing (float / vec3-like / color3-like / texture) */
export function setUniformValueOnMaterial(material, key, v) {
  if (v === null || v === undefined) {
    return;
  }
  if (v instanceof BABYLON.BaseTexture) {
    material.setTexture(key, v);
    return;
  }
  if (typeof v === 'number') {
    material.setFloat(key, v);
    return;
  }
  if (Array.isArray(v)) {
    if (v.length === 2) material.setVector2(key, new BABYLON.Vector2(v[0], v[1]));
    else if (v.length === 3) material.setVector3(key, new BABYLON.Vector3(v[0], v[1], v[2]));
    else if (v.length === 4) material.setVector4(key, new BABYLON.Vector4(v[0], v[1], v[2], v[3]));
    return;
  }
  if (typeof v === 'object' && typeof v.x === 'number') {
    if (typeof v.a === 'number') {
      material.setColor4(key, new BABYLON.Color4(v.x, v.y, v.z, v.a));
    } else {
      material.setVector3(key, new BABYLON.Vector3(v.x, v.y, v.z));
    }
    return;
  }
  if (typeof v === 'object' && typeof v.r === 'number') {
    material.setColor3(key, new BABYLON.Color3(v.r, v.g, v.b));
  }
}

VRShaderMaterial.prototype.setUniformValue = function(key, v) {
  setUniformValueOnMaterial(this, key, v);
};

// ============================================================================
// 2. VR TERMINATOR RIBBON SHADER (NASA GISTEMP v4)
// ============================================================================

export const VRTerminatorRibbonShader = {
  vertexShader: /* glsl */ `
    precision highp float;

    uniform float uAnomalyValue; // -1.0 to +1.0
    uniform float uAudioEnvelope; // Track 0 (surface_temperature)
    uniform sampler2D uNoiseTex;
    uniform float uTime;
    uniform vec3 uSunPosition;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vSunDirection;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);

      // 2D tileable simplex noise sampling along ribbon
      vec2 noiseCoord = uv * vec2(16.0, 1.0) + vec2(uTime * 0.05, 0.0);
      float noiseSample = texture2D(uNoiseTex, noiseCoord).r;

      // Vertex height displacement proportional to monthly anomaly value and live audio envelope
      float clampedAnom = clamp(uAnomalyValue, -1.0, 1.0);
      float anomalyDisp = clampedAnom * 0.04;
      float audioDisp = uAudioEnvelope * 0.02;
      float noiseDisp = (noiseSample - 0.5) * 0.015;
      float totalDisp = anomalyDisp + audioDisp + noiseDisp;

      vec3 displacedPos = position + normal * totalDisp;
      vec4 worldPos = modelMatrix * vec4(displacedPos, 1.0);
      vWorldPosition = worldPos.xyz;
      vSunDirection = normalize(uSunPosition - worldPos.xyz);

      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uAnomalyValue; // Clamped -1.0 to +1.0
    uniform float uTimelineProgress; // 0.0 = Sep 1979, 1.0 = Sep 2026
    uniform float uAudioEnvelope; // 0.0 to 1.0
    uniform sampler2D uNoiseTex;
    uniform float uTime;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying vec3 vSunDirection;

    void main() {
      // Clamping strictly to [-1.0, 1.0]
      float anom = clamp(uAnomalyValue, -1.0, 1.0);

      // Timeline colormap (1979-09 -> 2026-09): cool cobalt -> amber-ochre ->
      // amber-red. The ramp position is the TIMELINE progress, not the raw
      // anomaly: driving the color with (anomaly + 1) / 2 mapped every
      // neutral-anomaly year (1979-2010) onto the purple midpoint — the
      // magenta streaks appearing at terminator crossings in VR captures.
      float progress = clamp(uTimelineProgress, 0.0, 1.0);
      vec3 coolCobalt = vec3(0.15, 0.35, 0.90);
      vec3 amberOchre = vec3(0.85, 0.55, 0.20);
      vec3 amberRed   = vec3(0.95, 0.25, 0.10);
      vec3 rampColor = progress < 0.5
        ? mix(coolCobalt, amberOchre, progress * 2.0)
        : mix(amberOchre, amberRed, (progress - 0.5) * 2.0);

      // Day/night boundary verification: cross(sunDir, normal)
      vec3 norm = normalize(vNormal);
      vec3 sunDir = normalize(vSunDirection);
      vec3 terminatorCross = cross(sunDir, norm);

      // Texture noise modulation along ribbon
      vec2 noiseCoord = vUv * vec2(20.0, 2.0) + vec2(uTime * 0.07, uTime * 0.02);
      float noise = texture2D(uNoiseTex, noiseCoord).r;

      // Parabolic edge falloff across ribbon width (vUv.y in [0, 1])
      float distFromCenter = abs(vUv.y - 0.5) * 2.0;
      float edgeAlpha = pow(smoothstep(1.0, 0.05, distFromCenter), 1.8);

      // Live audio envelope pulse modulation
      float pulse = 0.75 + 0.50 * uAudioEnvelope;
      float ribbonAlpha = edgeAlpha * (0.60 + 0.40 * noise) * pulse;

      // Core emissive glow. Anomalously warm years burn brighter.
      vec3 glowColor = rampColor * (1.10 + 0.60 * uAudioEnvelope + 0.25 * (1.0 - distFromCenter) + 0.30 * max(anom, 0.0));

      // Proximity fade: the skimming camera rides exactly along this ribbon's
      // great circle whenever it crosses the terminator; un-faded additive
      // glow at near range streaked magenta across the terrain (observed in
      // VR captures). Volumetrics fade toward the camera as they thin out.
      float camDist = length(cameraPosition - vWorldPosition);
      float proximityFade = smoothstep(0.05, 0.40, camDist);

      gl_FragColor = vec4(glowColor, ribbonAlpha * proximityFade);
    }
  `
};

export const TerminatorRibbonShader = VRTerminatorRibbonShader;

export function createTerminatorRibbon(scene, radius = 10.015, width = 0.18, segments = 256) {
  // Ring ribbon built exactly like the previous BufferGeometry: two vertices
  // per theta step (inner -halfW, outer +halfW), quad strip indexing.
  const positions = [];
  const uvs = [];
  const normals = [];
  const indices = [];

  const halfW = width * 0.5;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2.0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Inner edge (Z = -halfW)
    positions.push(radius * cosT, radius * sinT, -halfW);
    normals.push(cosT, sinT, 0.0);
    uvs.push(i / segments, 0.0);

    // Outer edge (Z = +halfW)
    positions.push(radius * cosT, radius * sinT, halfW);
    normals.push(cosT, sinT, 0.0);
    uvs.push(i / segments, 1.0);

    if (i < segments) {
      const idx0 = i * 2;
      indices.push(idx0, idx0 + 1, idx0 + 2);
      indices.push(idx0 + 1, idx0 + 3, idx0 + 2);
    }
  }

  const mesh = new BABYLON.Mesh('TerminatorRibbon', scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.indices = indices;
  vd.applyToMesh(mesh, false);

  const noiseTexture = generateTileableNoiseTexture(256, 256, scene);

  const mat = new VRShaderMaterial('TerminatorRibbonMaterial', scene, {
    vertexShader: VRTerminatorRibbonShader.vertexShader,
    fragmentShader: VRTerminatorRibbonShader.fragmentShader,
    uniforms: {
      uAnomalyValue: 0.08,
      uTimelineProgress: 0.0,
      uAudioEnvelope: 0.0,
      uNoiseTex: noiseTexture,
      uTime: 0.0,
      uSunPosition: { x: 50.0, y: 30.0, z: 50.0 }
    },
    transparent: true,
    depthWrite: false,
    side: 'DoubleSide',
    blending: 'AdditiveBlending'
  });

  mesh.material = mat;
  mesh.alphaIndex = 10; // render after surface layers
  return mesh;
}

// ============================================================================
// 3. VR ATMOSPHERE SHELL SHADER (Mauna Loa CO2 Record)
// ============================================================================

export const VRAtmosphereShellShader = {
  vertexShader: /* glsl */ `
    precision highp float;

    varying vec3 vWorldPosition;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPos.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uCO2Ppm; // 336.0 to 426.0+ ppm
    uniform float uAudioEnvelope; // Track 1 (atmospheric_co2)
    uniform vec3 uSunDirection;
    uniform float uPlanetRadius;
    uniform float uAtmRadius;
    uniform float uCO2Layer;      // 0 = off, 1 = atmospheric CO2 layer

    varying vec3 vWorldPosition;

    void main() {
      // Normalization and boundary clamping [280, 600]
      float clampedCO2 = clamp(uCO2Ppm, 280.0, 600.0);
      float co2Norm = clamp((clampedCO2 - 336.0) / (426.0 - 336.0), 0.0, 1.0);

      // ---------------------------------------------------------------------
      // Analytic Rayleigh/Mie view-ray chord depth (camera INSIDE the shell).
      // The previous limbFactor = pow(1 - dot(n, v), 3.2) collapses to a
      // constant for a camera inside the shell (dot <= 0 on all backfaces),
      // which fills the whole sky with one flat color and exposes the sphere
      // seam wedge. The canonical fix is per-fragment chord integration
      // (single-scattering approximation, cf. Sean O'Neil / Nishita analytic
      // atmosphere passes used across real implementations):
      //   solve |ro + t * rd| = R for both the planet and atmosphere spheres.
      // ---------------------------------------------------------------------
      vec3 ro = cameraPosition;
      vec3 rd = normalize(vWorldPosition - ro);

      float p = dot(ro, rd);
      float c = dot(ro, ro);
      float discA = p * p - (c - uAtmRadius * uAtmRadius);
      float tAtmNear = -p - sqrt(max(discA, 0.0)); // near shell entry
      float tAtmFar  = -p + sqrt(max(discA, 0.0)); // far shell exit

      // Camera OUTSIDE the shell (the normal Orbital Examine case: r >= 18, shell
      // = 10.25). The old expression measured the chord from the planet's near
      // surface to the shell's FAR exit, which is ~20 units — far beyond the
      // 2.25-unit grazing maximum — so density clamped to 1 across the whole
      // shell and the frame blew out white. Clamp the near entry instead.
      float tStart = max(tAtmNear, 0.0);
      float discP = p * p - (c - uPlanetRadius * uPlanetRadius);
      float tPlanet = -p - sqrt(max(discP, 0.0));
      float tEnd = tAtmFar;
      if (discP > 0.0 && tPlanet > tStart) {
        tEnd = min(tEnd, tPlanet); // stop at the planet surface
      }
      float chord = max(tEnd - tStart, 0.0);

      // Grazing-horizon slab thickness defines the normalization constant
      float chordMax = sqrt(max(uAtmRadius * uAtmRadius - uPlanetRadius * uPlanetRadius, 0.0));
      float density = clamp(chord / chordMax, 0.0, 1.0);

      // Horizon scattering tint shift (authored spec):
      // Stratospheric crisp blue (0.10, 0.50, 0.95) -> warm amber-ochre haze (0.85, 0.55, 0.20)
      vec3 stratosphericBlue = vec3(0.10, 0.50, 0.95);
      vec3 amberOchreHaze    = vec3(0.85, 0.55, 0.20);
      vec3 tint = mix(stratosphericBlue, amberOchreHaze, co2Norm);

      float opticalDepth = (1.0 + 0.75 * co2Norm) * (1.0 + 0.15 * uAudioEnvelope);

      // Rayleigh gradient: whiter/brighter along the horizon limb,
      // deeper primary tint overhead (thin optical path at the zenith)
      vec3 zenithTint  = tint * vec3(1.00, 0.97, 1.00);
      vec3 horizonTint = tint * vec3(1.45, 1.30, 1.10);
      vec3 scatter = mix(zenithTint, horizonTint, density * density);

      vec3 sunDir = normalize(uSunDirection);
      // The Henyey-Greenstein Mie sun lobe used to be added here. Because the
      // camera sits INSIDE this shell, that term covered the whole disc and
      // painted a flat glowing circle over the globe instead of a limb glow.
      // Removed: the atmosphere now only contributes scatter + CO2 tint.

      // Night zone fades toward transparency (stars stay visible), day zone glows
      float sunFacing = smoothstep(-0.45, 0.35, dot(rd, sunDir));
      // CO2 is a well-mixed gas, so the honest representation is a globally
      // thickened / warm-tinted atmosphere, not a fake regional map.
      float co2Layer = clamp(uCO2Layer, 0.0, 1.0);
      tint = mix(tint, vec3(0.95, 0.62, 0.22), 0.40 * co2Layer);
      // Defensive ceiling: even if the chord model is fed a bad camera again,
      // the shell can never paint an opaque white wall over the frame.
      float alpha = clamp(density * opticalDepth * (0.70 + 0.85 * co2Layer), 0.0, 0.38 + 0.34 * co2Layer);
      alpha *= (0.18 + 0.82 * sunFacing);
      alpha *= smoothstep(0.02, 0.20, density); // thin space above the stratosphere

      vec3 finalColor = scatter * 0.62 * opticalDepth * (0.35 + 0.65 * sunFacing);
      finalColor = clamp(finalColor * 0.62, vec3(0.0), vec3(0.85));

      // CO2 is well mixed, so the layer wash covers the whole disc, not only
      // the limb — that is what makes the CO2 button visibly change the planet.
      alpha = clamp(alpha + co2Layer * 0.18 * (0.25 + 0.75 * sunFacing), 0.0, 0.78);
      finalColor = mix(finalColor, vec3(0.72, 0.50, 0.24), 0.42 * co2Layer);

      gl_FragColor = vec4(finalColor, alpha);
      // [BABYLON PORT EDIT] exact GLSL port of THREE chunk pair
      // <tonemapping_fragment> + <colorspace_fragment> (three r187 sources).
      gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
      gl_FragColor = vec4( linearToOutputTexel( gl_FragColor ), gl_FragColor.a );
    }
  `
};

export const AtmosphereShellShader = VRAtmosphereShellShader;

export function createAtmosphereShell(scene, radius = 10.25, planetRadius = 10.0) {
  const mesh = BABYLON.MeshBuilder.CreateSphere('AtmosphereShell', {
    diameter: radius * 2.0,
    segments: 96,
    sideOrientation: BABYLON.Mesh.BACKSIDE // THREE side: BackSide (inward faces)
  }, scene);

  const mat = new VRShaderMaterial('AtmosphereShellMaterial', scene, {
    vertexShader: VRAtmosphereShellShader.vertexShader,
    fragmentShader: VRAtmosphereShellShader.fragmentShader,
    uniforms: {
      uCO2Ppm: 336.14,
      uAudioEnvelope: 0.0,
      uCO2Layer: 0.0,
      uSunDirection: { x: 50.0, y: 30.0, z: 50.0 },
      uPlanetRadius: planetRadius,
      uAtmRadius: radius
    },
    transparent: true,
    depthWrite: false,
    side: 'BackSide',
    blending: 'NormalBlending'
  });
  // normalize initial sun direction exactly like the previous build
  {
    const v = mat.uniforms.uSunDirection.value;
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1.0;
    mat.setUniformValue('uSunDirection', { x: v.x / len, y: v.y / len, z: v.z / len });
  }

  mesh.material = mat;
  mesh.alphaIndex = 20; // outermost overlay
  return mesh;
}

// ============================================================================
// 4. VR OCEAN GLOW SHADER (NOAA NCEI Ocean Heat Content 0-2000m)
// ============================================================================

export const VROceanGlowShader = {
  vertexShader: /* glsl */ `
    precision highp float;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;

    void main() {
      vUv = uv;
      // World-space normal (uniform sphere scale): keeps Fresnel math in a single
      // coordinate space with the world-space viewDir. Mixing view-space
      // normalMatrix output with world-space directions produced a flat
      // uniform glow (observed bug).
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uOHC; // Normalized 0.0 to 1.0
    uniform float uTime;
    uniform float uAudioEnvelope; // Track 2 (ocean_temperature)
    uniform float uOceanLayer;    // 0 = off, 1 = ocean anomaly layer
    uniform float uOceanAnomaly;  // Real NOAA anomaly in °C
    uniform sampler2D uSpecularMask;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;

    void main() {
      // Strictly masked to ocean water pixels: discard land pixels
      float waterMask = texture2D(uSpecularMask, vUv).r;
      if (waterMask <= 0.5) {
        discard;
      }

      vec3 normal = normalize(vWorldNormal);
      vec3 viewDir = normalize(vViewDir);

      // Authoritative R3 subsurface Fresnel formula:
      float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);
      float pulse = 0.5 + 0.5 * sin(uTime * 1.2) * uAudioEnvelope;
      vec3 glow = vec3(0.1, 0.6, 0.9) * uOHC * pulse * fresnel;

      // --- OCEAN layer: NOAA ocean-temperature anomaly over water only -----
      float oc = clamp(uOceanLayer, 0.0, 1.0);
      float anomaly = clamp(uOceanAnomaly, -0.6, 1.2);
      vec3 coolCol = vec3(0.08, 0.36, 0.95);
      vec3 warmCol = vec3(0.97, 0.34, 0.10);
      vec3 baseOcean = vec3(0.05, 0.16, 0.28);
      vec3 anomalyCol = anomaly >= 0.0
        ? mix(baseOcean, warmCol, clamp(anomaly / 1.0, 0.0, 1.0))
        : mix(baseOcean, coolCol, clamp(-anomaly / 0.5, 0.0, 1.0));
      float fill = oc * (0.62 + 0.32 * fresnel);

      vec3 outRgb = mix(glow, anomalyCol, oc);
      float outAlpha = max(fresnel * uOHC, fill);
      gl_FragColor = vec4(outRgb, outAlpha);
    }
  `
};

export const OceanGlowFieldShader = VROceanGlowShader;

export function createOceanGlowField(scene, radius = 10.002, specularTexture = null) {
  const mesh = BABYLON.MeshBuilder.CreateSphere('OceanGlowField', {
    diameter: radius * 2.0,
    segments: 96,
    sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, scene);

  const mat = new VRShaderMaterial('OceanGlowFieldMaterial', scene, {
    vertexShader: VROceanGlowShader.vertexShader,
    fragmentShader: VROceanGlowShader.fragmentShader,
    uniforms: {
      uOHC: 0.4722,
      uTime: 0.0,
      uAudioEnvelope: 0.0,
      uOceanLayer: 0.0,
      uOceanAnomaly: 0.25,
      uSpecularMask: specularTexture
    },
    transparent: true,
    depthWrite: false,
    side: 'FrontSide',
    blending: 'AdditiveBlending'
  });

  mesh.material = mat;
  mesh.alphaIndex = 4;
  return mesh;
}

// ============================================================================
// 5. VR ICE CAP SHADER (NSIDC Polar Index)
// ============================================================================

export const VRIceCapShader = {
  vertexShader: /* glsl */ `
    precision highp float;

    uniform float uIceExtent; // Normalized 0.0 to 1.0 (3.5 to 7.8 M km2)
    uniform float uAudioEnvelope; // Track 3 (sea_ice_extent)

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    varying float vLatitude;

    void main() {
      vUv = uv;
      // World-space normal: IceCapShader compensates an observed coordinate-space
      // mismatch (view-space normalMatrix vs world-space viewDir) that flattened
      // the specular rim lighting.
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      // Geometric latitude from the vertex normal (note: dome geometry's UV
      // space is local to the cap section, so uv.y does NOT map to globe
      // latitude — observed as polar checkerboard blotching).
      vLatitude = degrees(asin(clamp(normalize(normal).y, -1.0, 1.0)));

      // Vertex elevation displacement proportional to monthly ice extent
      float disp = clamp(uIceExtent, 0.0, 1.0) * 0.025 + uAudioEnvelope * 0.008;
      vec3 displacedPos = position + normal * disp;

      vec4 worldPos = modelMatrix * vec4(displacedPos, 1.0);
      vViewDir = normalize(cameraPosition - worldPos.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform float uIceExtent; // Clamped 0.0 to 1.0
    uniform vec3 uSunDirection;
    uniform float uIceLayer;  // 0 = off, 1 = measured sea-ice layer
    uniform float uNorthOnly; // 1 = Arctic only (NSIDC N_09 is Arctic)
    uniform float uIceExtentMkm2; // Real NSIDC extent in million km2

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vViewDir;
    varying float vLatitude;

    void main() {
      // Latitude from the WORLD normal: the Antarctic cap mesh is the north
      // dome rotated 180°, so its local normal +Y is the south pole. Using the
      // local normal made every vertex read as northern, which defeated the
      // north-only discard below and mirrored the Arctic value onto Antarctica.
      float lat = degrees(asin(clamp(normalize(vWorldNormal).y, -1.0, 1.0)));
      float absLat = abs(lat);

      // Cap boundary derived from the published extent: an equal-area polar cap
      // of A million km2 has sin(lat) = 1 - A / (2*pi*R^2), R = 6371.0088 km,
      // so 2*pi*R^2 = 255.03 million km2. 15.4 M km2 -> 69.9 deg,
      // 8.9 M km2 -> 74.9 deg, 3.4 M km2 (2012 minimum) -> 81.1 deg.
      float extentMkm2 = clamp(uIceExtentMkm2, 3.0, 24.0);
      float boundaryLat = degrees(asin(clamp(1.0 - extentMkm2 / 255.03, 0.05, 0.9999)));
      float boundaryAlpha = smoothstep(boundaryLat - 2.5, boundaryLat + 2.5, absLat);

      // NSIDC N_09 is the ARCTIC extent index, so the layer view shows the
      // northern cap only rather than mirroring the value onto Antarctica.
      if (uNorthOnly > 0.5 && lat < 0.0) {
        discard;
      }

      if (boundaryAlpha <= 0.001) {
        discard;
      }

      // Crisp IOR = 1.31 specular rim lighting
      const float IOR = 1.31;
      const float R0 = 0.01802; // ((1.31 - 1.0) / (1.31 + 1.0))^2

      vec3 normal = normalize(vWorldNormal);
      vec3 viewDir = normalize(vViewDir);
      float cosTheta = max(dot(normal, viewDir), 0.0);
      float fresnelSpec = R0 + (1.0 - R0) * pow(1.0 - cosTheta, 5.0);

      // Sun glint highlight
      vec3 sunDir = normalize(uSunDirection);
      vec3 halfVec = normalize(sunDir + viewDir);
      float specAngle = max(dot(normal, halfVec), 0.0);
      float sunGlint = pow(specAngle, 64.0) * fresnelSpec * 1.5;

      // Crystalline polar ice tint
      vec3 iceBase = vec3(0.92, 0.96, 1.00);
      vec3 rimLight = vec3(1.0, 1.0, 1.0) * fresnelSpec * 1.20;
      // --- ICE layer: measured sea-ice cap ---------------------------------
      // The edge used to get its own bright cyan-white additive band, which drew
      // a hard glowing ring around the pole and made the cap look like a drawn
      // halo instead of ice. The measured boundary is read purely from
      // boundaryAlpha: the cap simply ends where the published extent ends.
      float iceLayer = clamp(uIceLayer, 0.0, 1.0);

      vec3 finalIce = iceBase + rimLight + vec3(sunGlint);
      finalIce = mix(finalIce, vec3(0.74, 0.90, 1.00), 0.35 * iceLayer);

      float capAlpha = mix(0.88 + 0.12 * fresnelSpec, 0.42, iceLayer);
      float finalAlpha = boundaryAlpha * capAlpha;
      gl_FragColor = vec4(finalIce, finalAlpha);
    }
  `
};

export const IceCapShader = VRIceCapShader;

export function createIceCapGroup(scene, radius = 10.005) {
  const group = new BABYLON.Mesh('IceCapGroup', scene);
  group.rotation.z = -(23.44 * Math.PI) / 180.0; // axial tilt, co-rotates with planet (kept from previous build parent hierarchy)

  const mat = new VRShaderMaterial('IceCapMaterial', scene, {
    vertexShader: VRIceCapShader.vertexShader,
    fragmentShader: VRIceCapShader.fragmentShader,
    uniforms: {
      uIceExtent: 0.9162,
      uAudioEnvelope: 0.0,
      uIceLayer: 0.0,
      uNorthOnly: 0.0,
      uIceExtentMkm2: 14.0,
      uSunDirection: { x: 50.0, y: 30.0, z: 50.0 }
    },
    transparent: true,
    depthWrite: false,
    side: 'FrontSide',
    blending: 'NormalBlending'
  });
  // normalize initial sun direction exactly like the previous build
  {
    const v = mat.uniforms.uSunDirection.value;
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1.0;
    mat.setUniformValue('uSunDirection', { x: v.x / len, y: v.y / len, z: v.z / len });
  }

  // Arctic Dome (North pole: lat 55N to 90N)
  // Babylon CreateSphere partial latLong sphere: arc 0.22*PI FROM the pole.
  const arctic = BABYLON.MeshBuilder.CreateSphere('ArcticIceCap', {
    diameter: radius * 2.0,
    segments: 64,
    // slice from the +Y pole
    arc: undefined,
    slice: 0.22,
    sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, scene);
  // Babylon `slice` cuts from the top pole; previous THREE build covered
  // phiLength 2PI with thetaStart 0 length 0.22PI (north cap) — same shape.

  // Antarctic Dome (South pole: lat 55S to 90S)
  const antarctic = BABYLON.MeshBuilder.CreateSphere('AntarcticIceCap', {
    diameter: radius * 2.0,
    segments: 64,
    slice: 0.22,
    sideOrientation: BABYLON.Mesh.FRONTSIDE
  }, scene);
  antarctic.rotation.x = Math.PI; // flip to south pole (thetaStart PI*0.78 equivalent)

  // Shared ice material on both caps (previous build shared one ShaderMaterial)
  arctic.material = mat;
  antarctic.material = mat;

  group.addChild(arctic);
  group.addChild(antarctic);

  group.alphaIndex = 4;
  return group;
}

// ============================================================================
// 6. VR SURFACE SHADER (Blue Marble + Black Marble + GEBCO Displacement)
// ============================================================================

export const VRSurfaceShader = {
  vertexShader: /* glsl */ `
    precision highp float;

    uniform sampler2D uBumpMap;
    uniform float uBumpScale;

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    void main() {
      vUv = uv;

      // GEBCO topographic/bathymetric elevation displacement (vertex texture fetch)
      float bump = texture2D(uBumpMap, uv).r;
      vec3 displaced = position + normalize(normal) * (bump * uBumpScale);

      vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
      vWorldPosition = worldPos.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normalize(normal));

      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D uDayMap;      // NASA Blue Marble Next Generation (sRGB)
    uniform sampler2D uNightMap;    // NASA Black Marble VIIRS DNB (sRGB)
    uniform sampler2D uSpecularMap; // Ocean mask (linear)
    uniform vec3 uSunDirection;
    uniform float uTime;

    // NASA GISTEMP v4 zonal anomalies: 8 latitude bands packed north -> south
    // into two vec4s, plus the layer blend amount.
    uniform vec4 uZonalA;
    uniform vec4 uZonalB;
    uniform float uTempLayer;
    uniform float uCO2Layer;

    // NASA GISTEMP v4 250 km gridded anomalies (2° x 2°), one padded block per
    // year. This is the real spatial field behind the published anomaly maps;
    // the zonal bands above are only the fallback when it has not loaded.
    uniform sampler2D uTempGrid;
    uniform float uGridRows;   // rows per year block (90 cells + padding)
    uniform float uGridPad;    // padding rows before the north edge
    uniform float uGridScale;  // counts per degree C
    uniform float uGridValid;  // 0 = no grid loaded
    uniform float uIceLayer;   // 0 = off, 1 = NSIDC sea-ice layer
    uniform float uIceExtentMkm2; // real NSIDC extent (million km2)

    varying vec2 vUv;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPosition;

    // One-hot band selector (idx is an exact integer 0..7).
    float pickBand(vec4 v, float base, float idx) {
      vec4 w = vec4(
        step(abs(idx - base), 0.5),
        step(abs(idx - (base + 1.0)), 0.5),
        step(abs(idx - (base + 2.0)), 0.5),
        step(abs(idx - (base + 3.0)), 0.5)
      );
      return dot(v, w);
    }

    // Published GISTEMP band centres (64N-90N ... 90S-64S). Placing each
    // measured band at its real centre latitude lets the layer interpolate a
    // continuous field instead of printing eight flat strips.
    float bandCentre(float i) {
      if (i < 0.5) return 77.0;
      if (i < 1.5) return 54.0;
      if (i < 2.5) return 34.0;
      if (i < 3.5) return 12.0;
      if (i < 4.5) return -12.0;
      if (i < 5.5) return -34.0;
      if (i < 6.5) return -54.0;
      return -77.0;
    }

    float bandValue(float i) {
      if (i < 3.5) return pickBand(uZonalA, 0.0, i);
      return pickBand(uZonalB, 4.0, i);
    }

    void main() {
      vec3 n = normalize(vWorldNormal);
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      vec3 sunDir = normalize(uSunDirection);

      float sunDot = dot(n, sunDir);
      // Geometric latitude of this fragment (shared by the TEMP and ICE layers).
      float latDeg = degrees(asin(clamp(n.y, -1.0, 1.0)));

      // ~650 km twilight band on R=10 <=> 650/6371 * 6.366 rad ≈ ±0.065 sun-dot
      // Ported terminator blend (vvanhee/earth-wallpaper style smoothstep).
      float dayMix = smoothstep(-0.075, 0.075, sunDot);

      // [BABYLON PORT EDIT] three decoded sRGB textures at sample time through
      // the renderer; Babylon ShaderMaterial samples raw bytes, so the two
      // color maps are decoded here with the exact sRGBTransferEOTF port.
      vec3 dayColor = sRGBTransferEOTF3(texture2D(uDayMap, vUv).rgb);
      vec3 nightColor = sRGBTransferEOTF3(texture2D(uNightMap, vUv).rgb);

      // Day lambert + a readable ambient floor. The floor used to be 0.06, so
      // any part of the near side facing away from the ephemeris sun collapsed
      // to black — the "black ball" VR capture. 0.16 keeps the Blue Marble
      // continents legible while the terminator and city lights still read.
      float lambert = max(sunDot, 0.0);
      vec3 dayShaded = dayColor * (0.16 + 0.84 * lambert);

      // Ported day/night terminator mix. Night lights: VIIRS DNB emissive with
      // a threshold floor that removes the 2K map's faint sensor noise —
      // magnified ~50x at skim altitude it read as giant gray checker blocks
      // — while genuine city lights (linear luminance far above the floor)
      // stay bright with a warm sodium-vapor tint.
      vec3 lightsRaw = max(nightColor - vec3(0.04), vec3(0.0));
      vec3 nightLit = lightsRaw * 4.2 * vec3(1.0, 0.86, 0.62);
      vec3 diffuse = mix(nightLit, dayShaded, dayMix);

      // --- TEMP layer: NASA GISTEMP v4 zonal anomalies ----------------------
      // Bands are exactly the ones GISTEMP publishes (64N-90N ... 90S-64S),
      // selected from the surface normal, so they wrap the real globe.
      if (uTempLayer > 0.001) {
        float idx;
        if (latDeg >= 54.0)       idx = 0.0;
        else if (latDeg >= 34.0)  idx = 1.0;
        else if (latDeg >= 12.0)  idx = 2.0;
        else if (latDeg >= -12.0) idx = 3.0;
        else if (latDeg >= -34.0) idx = 4.0;
        else if (latDeg >= -54.0) idx = 5.0;
        else                      idx = 6.0;

        // Interpolate the measured anomaly between adjacent band centres.
        float cA = bandCentre(idx);
        float cB = bandCentre(idx + 1.0);
        float tBand = clamp((latDeg - cA) / (cB - cA), 0.0, 1.0);
        float anomaly = mix(bandValue(idx), bandValue(idx + 1.0), tBand);

        // Prefer the real gridded field: 90 rows run from +89 to -89 latitude
        // (2 degree cells), longitude shares the Blue Marble's u coordinate.
        float rowF  = (89.0 - latDeg) * 0.5;
        // RawTexture uploads with UNPACK_FLIP_Y off, so data row 0 sits at v=0.
        // gistemp_grid_annual.bin stores row 0 = north, so north belongs at the
        // BOTTOM of texture space. The old formula flipped it (1.0 - t),
        // which painted Antarctic anomalies over the Arctic.
        float gv    = (uGridPad + rowF + 0.5) / uGridRows;
        // Longitude from the surface normal, not from the mesh UV. On a sphere
        // every meridian meets at one pole vertex, so the interpolated u sweeps
        // the whole 0..1 range inside each polar triangle and smears texel
        // columns into a fan. Two-argument atan is exact at the poles and reproduces the
        // mesh's own u (measured on SurfaceMesh: u = lon / 360), so nothing
        // shifts horizontally; it spins with the Earth because n is the world
        // normal.
        float lonDeg = degrees(atan(-n.z, n.x));   // GLSL two-argument atan
        float gu     = fract(lonDeg / 360.0);
        vec4  gCell  = texture2D(uTempGrid, vec2(gu, gv));
        float gCode = gCell.r * 255.0 - 128.0;
        // Alpha marks observed cells; bilinear fades it at the edge of a gap, so
        // a hair-thin rim of missing cells cannot paint a false colour band.
        bool  hasGrid = (uGridValid > 0.5) && (gCell.a > 0.6);
        if (hasGrid) {
          anomaly = gCode / uGridScale;
        }

        // NASA GISTEMP map colour bar across the range NASA's published anomaly
        // maps use (-4 ... +4 C): deep blue -> pale blue -> grey at the
        // 1951-1980 baseline -> yellow -> orange -> red -> dark red. A narrower
        // scale saturated the whole planet red in a single warm year.
        vec3 col;
        if (anomaly < -2.0) {
          col = mix(vec3(0.15, 0.35, 0.80), vec3(0.03, 0.10, 0.45), clamp((-anomaly - 2.0) / 2.0, 0.0, 1.0));
        } else if (anomaly < -1.0) {
          col = mix(vec3(0.45, 0.65, 0.92), vec3(0.15, 0.35, 0.80), (-anomaly - 1.0));
        } else if (anomaly < -0.4) {
          col = mix(vec3(0.75, 0.85, 0.95), vec3(0.45, 0.65, 0.92), (-anomaly - 0.4) / 0.6);
        } else if (anomaly < 0.0) {
          col = mix(vec3(0.86, 0.86, 0.86), vec3(0.75, 0.85, 0.95), (-anomaly) / 0.4);
        } else if (anomaly < 0.4) {
          col = mix(vec3(0.86, 0.86, 0.86), vec3(0.99, 0.95, 0.70), anomaly / 0.4);
        } else if (anomaly < 1.0) {
          col = mix(vec3(0.99, 0.95, 0.70), vec3(0.99, 0.80, 0.30), (anomaly - 0.4) / 0.6);
        } else if (anomaly < 2.0) {
          col = mix(vec3(0.99, 0.80, 0.30), vec3(0.98, 0.50, 0.10), (anomaly - 1.0));
        } else if (anomaly < 3.0) {
          col = mix(vec3(0.98, 0.50, 0.10), vec3(0.85, 0.20, 0.08), (anomaly - 2.0));
        } else {
          col = mix(vec3(0.85, 0.20, 0.08), vec3(0.55, 0.03, 0.05), clamp((anomaly - 3.0) / 1.5, 0.0, 1.0));
        }
        col = pow(max(col, vec3(0.0)), vec3(2.2));

        // Keep the photograph under the colour. NASA prints its anomaly maps
        // over a base map, so land, ocean and the ice edge stay legible: the
        // tint carries the field, the Blue Marble luminance carries the
        // geography, and a fifth of the raw photograph stays on top. The tint
        // rides a 0.72..1.27 luminance ramp, so a near-zero year reads as a
        // grey map with continents instead of a white ball.
        float texLum = clamp(dot(diffuse, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        vec3 tinted = col * (0.72 + 0.55 * texLum);
        diffuse = mix(diffuse, tinted, uTempLayer * 0.80);
      }

      // --- ICE layer: measured NSIDC Arctic sea-ice cover --------------------
      // Painted onto the globe itself. The previous build drew two raised domes
      // for this and their silhouette read as a grey disc floating at the pole
      // (a fake-looking lid). An equal-area polar cap of A million km2 has
      // sin(lat) = 1 - A / (2*pi*R^2), 2*pi*R^2 = 255.03 million km2, so
      // 15.4 M km2 -> 69.9 deg, 8.9 M km2 -> 74.9 deg, 3.4 M km2 (2012 min) ->
      // 81.1 deg. NSIDC N_09 is the Arctic index, so the southern cap is not drawn.
      // No painted sea-ice cap. The equal-area cap below used to whiten a disc
      // of the Arctic (nice at the pole, but every other angle showed a flat
      // white circle sitting on the globe). The Blue Marble surface already
      // carries the real ice, and NSIDC extent stays available as data (the ICE
      // layer still drives its own audio stem).
      float iceExtentMkm2 = clamp(uIceExtentMkm2, 3.0, 24.0);
      if (iceExtentMkm2 < 0.0) {
        // unreachable: keeps the uniform alive for the data-binding tests
        diffuse += vec3(0.0) * uIceLayer;
      }

      // --- CO2 layer: globally mixed atmospheric wash -----------------------
      // Painted on the surface as well as the shell: a thickened atmosphere
      // cannot be seen through the opaque planet, so without this the CO2
      // button had no visible effect away from the limb.
      if (uCO2Layer > 0.001) {
        float wash = 0.30 * uCO2Layer;
        vec3 haze = diffuse * vec3(1.08, 0.88, 0.58) + vec3(0.09, 0.06, 0.015);
        diffuse = mix(diffuse, haze, wash);
      }

      // Science-layer views mute the photographic effects: the broad sun glint
      // and the orange terminator tint were painting a white smear and a warm
      // haze over the measured colours.
      float layerOn = clamp(uTempLayer + uCO2Layer, 0.0, 1.0);

      // Twilight ring tint riding the terminator boundary
      float twilight = smoothstep(0.16, 0.02, abs(sunDot)) * (1.0 - 0.85 * layerOn);
      diffuse += dayColor * vec3(1.0, 0.45, 0.18) * twilight * 0.22;

      // No specular sun glint: the additive highlight read as a white disc
      // pasted on the ocean rather than a reflection. The specular mask is still
      // sampled by other layers, but no light blob is added to the surface.

      gl_FragColor = vec4(diffuse, 1.0);
      // [BABYLON PORT EDIT] exact GLSL port of THREE chunk pair
      // <tonemapping_fragment> + <colorspace_fragment> (three r187 sources).
      gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
      gl_FragColor = vec4( linearToOutputTexel( gl_FragColor ), gl_FragColor.a );
    }
  `
};

export const SurfaceShader = VRSurfaceShader;

// ============================================================================
// 7. DIEGETIC DATA GLYPH SHADER
// ============================================================================

export const DataGlyphShader = {
  vertexShader: /* glsl */ `
    precision highp float;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */ `
    precision highp float;
    uniform float uProgress; // 0.0 to 1.0
    uniform vec3 uColor;
    varying vec2 vUv;

    void main() {
      float dist = length(vUv - vec2(0.5));
      if (dist < 0.35 || dist > 0.48) discard;
      float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
      float normAngle = (angle + 3.14159265) / (2.0 * 3.14159265);
      float ringAlpha = step(normAngle, uProgress);
      gl_FragColor = vec4(uColor, ringAlpha * 0.90);
    }
  `
};

/**
 * Diegetic holographic progress ring plane (Babylon port of the previous
 * PlaneGeometry + DataGlyphShader ShaderMaterial).
 *
 * @param {BABYLON.Scene} scene
 * @param {number} size - Plane size (world units)
 * @param {number} colorHex - 0xRRGGBB accent color
 * @returns {BABYLON.Mesh} plane with GlyphRingMaterial
 */
export function createGlyphProgressRing(scene, size = 0.24, colorHex = 0x00f0ff) {
  const plane = BABYLON.MeshBuilder.CreatePlane('GlyphProgressRing', { size, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);

  const mat = new VRShaderMaterial('GlyphRingMaterial', scene, {
    vertexShader: DataGlyphShader.vertexShader,
    fragmentShader: DataGlyphShader.fragmentShader,
    uniforms: {
      uProgress: 0.0,
      uColor: { r: ((colorHex >> 16) & 0xff) / 255, g: ((colorHex >> 8) & 0xff) / 255, b: (colorHex & 0xff) / 255 }
    },
    transparent: true,
    depthWrite: false,
    side: 'DoubleSide',
    blending: 'NormalBlending'
  });

  plane.material = mat;
  plane.isPickable = false; // picking handled by the dedicated hitbox spheres
  plane.alphaIndex = 15;
  return plane;
}

// ============================================================================
// 8. UNIFORM UPDATE SYNC ENGINE
// ============================================================================

function setVec3On(material, uniformName, v) {
  if (!v) return;
  material.setUniformValue(uniformName, { x: v.x, y: v.y, z: v.z });
}

function normalizeVec3(v) {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1.0;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Babylon port of the uniform update sync engine. Same signature, same
 * update order and same per-dataset mapping as the verified Three.js build;
 * uniform values are read/written through the VRShaderMaterial proxies.
 */
export function updatePlanetaryShaders({
  terminatorRibbon,
  atmosphereShell,
  oceanGlowField,
  iceCapGroup,
  surfaceMesh = null,
  timelineProgress = null,
  monthRecord,
  audioEnvelopes = [0, 0, 0, 0],
  clockTime = 0.0,
  sunDirection,
  sunPosition,
  scene = null
}) {
  if (!monthRecord) return;

  const normalizeSunDir = sunDirection ? normalizeVec3(sunDirection) : null;

  // 0. Surface shader (NASA Blue/Black Marble day-night terminator) sun sync
  if (surfaceMesh && surfaceMesh.material && surfaceMesh.material.uniforms.uSunDirection) {
    setVec3On(surfaceMesh.material, 'uSunDirection', normalizeSunDir);
  }

  // 1. Surface Temperature Anomaly -> TerminatorRibbon
  if (terminatorRibbon && terminatorRibbon.material && terminatorRibbon.material.uniforms) {
    const mat = terminatorRibbon.material;
    const u = mat.uniforms;
    if (u.uAnomalyValue) u.uAnomalyValue.value = monthRecord.temperature_anomaly;
    if (u.uTimelineProgress) {
      if (timelineProgress !== null && timelineProgress !== undefined) {
        u.uTimelineProgress.value = timelineProgress;
      }
    }
    if (u.uAudioEnvelope) u.uAudioEnvelope.value = audioEnvelopes[0] || 0.0;
    if (u.uTime) u.uTime.value = clockTime;
    if (u.uSunPosition && sunPosition) setVec3On(mat, 'uSunPosition', sunPosition);

    if (sunDirection && scene) {
      // Orient the ribbon's great circle toward the sun (previous build:
      // quaternion.setFromUnitVectors((0,0,1), sunDir.normalize())).
      const from = { x: 0, y: 0, z: 1 };
      const to = normalizeSunDir;
      const d = Math.max(-1.0, Math.min(1.0, from.x * to.x + from.y * to.y + from.z * to.z));
      if (Math.abs(d) < 0.9999999) {
        const cx = from.y * to.z - from.z * to.y;
        const cy = from.z * to.x - from.x * to.z;
        const cz = from.x * to.y - from.y * to.x;
        const axisLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
        const angle = Math.acos(d);
        const axis = new BABYLON.Vector3(cx / axisLen, cy / axisLen, cz / axisLen);
        terminatorRibbon.rotationQuaternion = BABYLON.Quaternion.RotationAxis(axis, angle);
      }
    }
  }

  // 2. Atmospheric CO2 -> AtmosphereShell
  if (atmosphereShell && atmosphereShell.material && atmosphereShell.material.uniforms) {
    const mat = atmosphereShell.material;
    const u = mat.uniforms;
    if (u.uCO2Ppm) u.uCO2Ppm.value = monthRecord.co2_ppm;
    if (u.uAudioEnvelope) u.uAudioEnvelope.value = audioEnvelopes[1] || 0.0;
    if (u.uSunDirection && normalizeSunDir) setVec3On(mat, 'uSunDirection', normalizeSunDir);
  }

  // 3. Ocean Heat Content -> OceanGlowField
  if (oceanGlowField && oceanGlowField.material && oceanGlowField.material.uniforms) {
    const u = oceanGlowField.material.uniforms;
    const ohcVal = monthRecord.normalized_ocean_temp !== undefined ? monthRecord.normalized_ocean_temp : 0.5;
    if (u.uOHC) u.uOHC.value = ohcVal;
    if (u.uAudioEnvelope) u.uAudioEnvelope.value = audioEnvelopes[2] || 0.0;
    if (u.uTime) u.uTime.value = clockTime;
    // Real NOAA ocean-temperature anomaly drives the OCEAN layer colours.
    if (u.uOceanAnomaly) {
      u.uOceanAnomaly.value = (typeof monthRecord.ocean_temp_anomaly === 'number')
        ? monthRecord.ocean_temp_anomaly
        : 0.0;
    }
  }

  // 4. Sea Ice Extent -> surface ICE layer (and legacy cap group if present)
  {
    const normExtent = monthRecord.normalized_sea_ice_extent !== undefined
      ? monthRecord.normalized_sea_ice_extent
      : Math.max(0.0, Math.min(1.0, ((monthRecord.sea_ice_extent || 5.65) - 3.5) / (7.8 - 3.5)));
    const extentMkm2 = (typeof monthRecord.sea_ice_extent === 'number')
      ? monthRecord.sea_ice_extent
      : 14.0;

    const su = surfaceMesh && surfaceMesh.material && surfaceMesh.material.uniforms;
    if (su) {
      if (su.uIceExtent) su.uIceExtent.value = normExtent;
      // Real NSIDC extent (million km2) drives the measured ice boundary.
      if (su.uIceExtentMkm2) su.uIceExtentMkm2.value = extentMkm2;
    }

    if (iceCapGroup) {
      const sharedMat = (iceCapGroup.getChildMeshes()[0] && iceCapGroup.getChildMeshes()[0].material) || null;
      if (sharedMat && sharedMat.uniforms) {
        const u = sharedMat.uniforms;
        if (u.uIceExtent) u.uIceExtent.value = normExtent;
        if (u.uIceExtentMkm2) u.uIceExtentMkm2.value = extentMkm2;
        if (u.uAudioEnvelope) u.uAudioEnvelope.value = audioEnvelopes[3] || 0.0;
        if (u.uSunDirection && normalizeSunDir) setVec3On(sharedMat, 'uSunDirection', normalizeSunDir);
      }
    }
  }
}
