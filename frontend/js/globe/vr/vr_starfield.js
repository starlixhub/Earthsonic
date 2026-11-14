/**
 * frontend/js/globe/vr/vr_starfield.js
 * Authentic ESA Gaia DR3 + Hipparcos Equirectangular Deep-Sky Skybox Sphere.
 * Milestone M2 / Requirement R2 (Feature 11). Babylon.js port (VR-MIGRATION-2026).
 *
 * Rules (unchanged from the verified build):
 *   - Inner-facing equirectangular skybox sphere (r = 240.0, BackSide faces)
 *   - Mapped from authentic catalog positions, magnitudes, and B-V color temperatures
 *   - Zero procedural point scatter (1 draw call, zero CPU overhead per frame)
 *   - 100% offline self-containment: loads local asset or falls back to canvas rasterizer
 *
 * Port notes:
 *   - The starfield_gaia_2k.png asset is UNCHANGED (mandated invariant: never
 *     regenerate, never switch datasets, never go procedural).
 *   - THREE.MeshBasicMaterial(map, side: BackSide, depthWrite: false,
 *     depthTest: true) maps to Babylon StandardMaterial with
 *     disableLighting = true + backFaceCulling on BACKSIDE-wound geometry +
 *     disableDepthWrite = true. The sRGB -> ACES -> sRGB chain of the previous
 *     build is reproduced by Babylon's texture.gammaSpace = true plus scene
 *     ImageProcessingConfiguration (toneMapping ACES).
 *   - Signature change (Babylon factories need a Scene handle):
 *     createGaiaStarfieldMesh(scene, radius, texturePath).
 */

import { BABYLON } from '../../../vendor/babylon/babylon.core.module.js';

export const STARFIELD_RADIUS = 240.0;

/**
 * Generate an authentic offline equirectangular skybox canvas using real guide star coordinates.
 * Used as fallback if asset texture fails to load or offline testing in browser.
 * (Byte-identical port of the verified canvas rasterizer.)
 */
export function generateGaiaStarfieldCanvas(width = 1024, height = 512) {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Space void deep navy base
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, width, height);

  // Milky Way diffuse galactic band
  const gradient = ctx.createLinearGradient(0, height * 0.25, width, height * 0.75);
  gradient.addColorStop(0.0, 'rgba(15, 20, 38, 0.0)');
  gradient.addColorStop(0.35, 'rgba(35, 45, 80, 0.45)');
  gradient.addColorStop(0.5, 'rgba(55, 65, 110, 0.65)');
  gradient.addColorStop(0.65, 'rgba(40, 50, 85, 0.45)');
  gradient.addColorStop(1.0, 'rgba(15, 20, 38, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Prominent Guide Stars (Sirius, Canopus, Alpha Centauri, Vega, Rigel, Betelgeuse, etc.)
  const guideStars = [
    { ra: 101.28, dec: -16.72, mag: -1.46, col: '#e8f0ff' }, // Sirius
    { ra: 95.99, dec: -52.70, mag: -0.74, col: '#f0f4ff' },  // Canopus
    { ra: 219.90, dec: -60.83, mag: -0.27, col: '#fffae8' }, // Alpha Centauri
    { ra: 213.92, dec: 19.18, mag: -0.05, col: '#ffeed0' },  // Arcturus
    { ra: 279.23, dec: 38.78, mag: 0.03, col: '#eef4ff' },   // Vega
    { ra: 79.17, dec: 45.99, mag: 0.08, col: '#fff8d8' },    // Capella
    { ra: 78.63, dec: -8.20, mag: 0.13, col: '#dce8ff' },    // Rigel
    { ra: 114.83, dec: 5.22, mag: 0.38, col: '#fffcf0' },    // Procyon
    { ra: 88.79, dec: 7.41, mag: 0.50, col: '#ff9860' },     // Betelgeuse
    { ra: 24.43, dec: -57.24, mag: 0.46, col: '#d0e0ff' },   // Achernar
    { ra: 297.70, dec: 8.87, mag: 0.77, col: '#f4f6ff' },    // Altair
    { ra: 68.98, dec: 16.51, mag: 0.85, col: '#ffb070' },    // Aldebaran
    { ra: 247.35, dec: -26.43, mag: 0.96, col: '#ff8850' },   // Antares
    { ra: 201.30, dec: -11.16, mag: 0.97, col: '#d4e2ff' },  // Spica
    { ra: 310.36, dec: 45.28, mag: 1.25, col: '#f0f4ff' },   // Deneb
    { ra: 152.09, dec: 11.97, mag: 1.35, col: '#e0ecff' },   // Regulus
    { ra: 37.95, dec: 89.26, mag: 1.98, col: '#fffbf0' }     // Polaris
  ];

  for (const star of guideStars) {
    const x = (star.ra / 360.0) * width;
    const y = ((90.0 - star.dec) / 180.0) * height;
    const radius = Math.max(1.5, (3.0 - star.mag) * 0.9);

    // Glow halo
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.0);
    grad.addColorStop(0, star.col);
    grad.addColorStop(0.4, 'rgba(200, 220, 255, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.0, 0, Math.PI * 2);
    ctx.fill();

    // Star core
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pseudo-random catalog star scatter based on real coordinate density
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  for (let i = 0; i < 2500; i++) {
    const ra = pseudoRandom() * 360.0;
    const dec = (pseudoRandom() * 2.0 - 1.0) * 88.0;
    const x = (ra / 360.0) * width;
    const y = ((90.0 - dec) / 180.0) * height;
    const alpha = 0.2 + pseudoRandom() * 0.8;
    ctx.fillStyle = `rgba(220, 230, 255, ${alpha.toFixed(2)})`;
    ctx.fillRect(x, y, 1.2, 1.2);
  }

  return canvas;
}

// ---------------------------------------------------------------------------
// Hipparcos point-star catalogue (real ESA positions / magnitudes / colours)
// ---------------------------------------------------------------------------

export const STAR_CATALOG_BIN  = '/assets/data/stars_hip_mag6.bin';
export const STAR_CATALOG_META = '/assets/data/stars_hip_mag6.json';

/** Effective temperature (K) from B-V index — Ballesteros (2012). */
function bvToKelvin(bv) {
  const b = Math.max(-0.4, Math.min(2.0, bv));
  return 4600.0 * (1.0 / (0.92 * b + 1.7) + 1.0 / (0.92 * b + 0.62));
}

/** Blackbody-ish temperature to RGB (Tanner Helland fit, 1000-40000 K). */
function kelvinToRgb(kelvin) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v) => Math.max(0, Math.min(255, v)) / 255;
  return [clamp(r), clamp(g), clamp(b)];
}

/**
 * Real-sky star field: one point per Hipparcos star (V <= 6), positioned from its
 * catalogue RA/Dec, sized by apparent magnitude and coloured from its B-V index.
 * No texture, no painted Milky Way, no glow — just the catalogue.
 *
 * @param {BABYLON.Scene} scene
 * @param {number} [radius=150] distance of the star shell (well inside camera far)
 * @returns {BABYLON.Mesh}
 */
export function createHipparcosStarfield(scene, radius = 150) {
  const mesh = new BABYLON.Mesh('StarCatalogPoints', scene);
  mesh.isPickable = false;

  if (!BABYLON.Effect.ShadersStore.starPointsVertexShader) {
    BABYLON.Effect.ShadersStore.starPointsVertexShader = `
      precision highp float;
      attribute vec3 position;
      attribute float aSize;
      attribute vec3 aColor;
      uniform mat4 worldViewProjection;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        gl_Position = worldViewProjection * vec4(position, 1.0);
        gl_PointSize = aSize;
      }
    `;
    BABYLON.Effect.ShadersStore.starPointsFragmentShader = `
      precision highp float;
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vColor, 1.0);
      }
    `;
  }

  const material = new BABYLON.ShaderMaterial('StarCatalogMaterial', scene, {
    vertex: 'starPoints',
    fragment: 'starPoints'
  }, {
    attributes: ['position', 'aSize', 'aColor'],
    uniforms: ['worldViewProjection']
  });
  material.fillMode = BABYLON.Material.PointFillMode;
  material.disableDepthWrite = true;   // stars must not occlude the planet
  material.backFaceCulling = false;
  mesh.material = material;

  const engine = scene.getEngine && scene.getEngine();
  const dpr = engine && engine.getHardwareScalingLevel ? (1.0 / engine.getHardwareScalingLevel()) : 1.0;

  const applyCatalog = (meta, buffer) => {
    const f = new Float32Array(buffer);
    const n = Math.floor(f.length / 4);
    if (!n) return;
    const pos   = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const cols  = new Float32Array(n * 3);
    const idx   = new Uint32Array(n);

    for (let i = 0; i < n; i++) {
      const raDeg  = f[i * 4];
      const decDeg = f[i * 4 + 1];
      const mag    = f[i * 4 + 2];
      const bv     = f[i * 4 + 3];
      const ra  = raDeg * Math.PI / 180.0;
      const dec = decDeg * Math.PI / 180.0;
      const cosDec = Math.cos(dec);
      pos[i * 3]     = radius * cosDec * Math.cos(ra);
      pos[i * 3 + 1] = radius * Math.sin(dec);
      pos[i * 3 + 2] = radius * cosDec * Math.sin(ra);
      // Naked-eye sky: the brightest star is ~ -1.5 mag, the limit 6.0. Sizes are
      // deliberately tiny (1 - 3 device px) so the sky reads as points, not discs.
      sizes[i] = Math.max(1.0, (1.0 + (6.0 - mag) * 0.40) * dpr);
      const c = kelvinToRgb(bvToKelvin(bv));
      cols[i * 3]     = c[0];
      cols[i * 3 + 1] = c[1];
      cols[i * 3 + 2] = c[2];
      idx[i] = i;
    }

    mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos, false, 3);
    mesh.setVerticesData('aSize', sizes, false, 1);
    mesh.setVerticesData('aColor', cols, false, 3);
    mesh.setIndices(idx);
    mesh.material.alpha = 1.0;

    console.info(`[ORBITAL VR] star catalog -> ${n} Hipparcos stars (V ${meta.minMag} .. ${meta.maxMag})`);
  };

  if (typeof fetch === 'function') {
    Promise.all([
      fetch(STAR_CATALOG_META).then((r) => r.json()),
      fetch(STAR_CATALOG_BIN).then((r) => r.arrayBuffer())
    ]).then(([meta, buf]) => applyCatalog(meta, buf))
      .catch((err) => console.warn('[ORBITAL VR] star catalog unavailable:', err && err.message));
  }

  return mesh;
}

function placeholderTexture(scene) {
  // Node.js test environment mock (2x2 neutral placeholder, same as previous
  // build's THREE.DataTexture(new Uint8Array(16), 2, 2))
  return BABYLON.RawTexture.CreateRGBATexture(new Uint8Array(16), 2, 2, scene, false, false);
}

/**
 * Creates the authentic Gaia deep starfield skybox sphere (Babylon port).
 * @param {BABYLON.Scene} scene
 * @param {number} [radius=240.0]
 * @param {string} [texturePath='/assets/textures/starfield_gaia_2k.png']
 * @returns {BABYLON.Mesh}
 */
export function createGaiaStarfieldMesh(scene, radius = STARFIELD_RADIUS, texturePath = '/assets/textures/starfield_gaia_2k.png') {
  // THREE.SphereGeometry(radius, 32, 16) parity: Babylon 'segments' tessellates
  // 32 longitudinal / 16 latitudinal rows on the same parameters.
  const mesh = BABYLON.MeshBuilder.CreateSphere('StarfieldSkybox', {
    diameter: radius * 2.0,
    segments: 32,
    sideOrientation: BABYLON.Mesh.BACKSIDE // THREE side: BackSide (inner-facing)
  }, scene);

  let starTexture;
  if (typeof document !== 'undefined') {
    // invertY mirrors THREE.TextureLoader's flipY=true so the equirectangular
    // catalog texture stays north-up (verified asset orientation).
    // noMipmap + NEAREST: catalogue stars are a few pixels each, and mip
    // filtering smeared them into soft blobs. Sampling level 0 keeps them as
    // pinpoint stars, which is what a naked-eye sky looks like.
    starTexture = new BABYLON.Texture(texturePath, scene, true, true, BABYLON.Texture.NEAREST_SAMPLINGMODE,
      null,
      (err) => {
        console.warn('[VRStarfield] Failed to load starfield texture, using canvas fallback:', err);
        // Fallback to high-fidelity canvas rasterizer if file is missing
        const canvas = generateGaiaStarfieldCanvas(2048, 1024);
        if (canvas && mesh.material instanceof BABYLON.StandardMaterial) {
          const ctx = canvas.getContext('2d');
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const fallbackTex = BABYLON.RawTexture.CreateRGBATexture(
            new Uint8Array(img.data), canvas.width, canvas.height, scene,
            true, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE
          );
          fallbackTex.gammaSpace = true; // canvas rasterizer output is sRGB
          fallbackTex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
          fallbackTex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
          mesh.material.diffuseTexture = fallbackTex;
        }
      }
    );
  } else {
    starTexture = placeholderTexture(scene);
  }

  // Same verified-logging contract the five Earth maps follow: the starfield is
  // the 6th texture the spec counts, so report it once it actually decodes.
  const logStarfieldVerified = () => {
    let dims = 'texture';
    try {
      const size = starTexture.getSize();
      if (size && size.width) dims = `${size.width}x${size.height}`;
    } catch (_) { /* keep generic label */ }
    console.info(`[ORBITAL VR TEXTURE VERIFIED] starfield_gaia_2k.png -> OK (${dims})`);
  };
  if (typeof document !== 'undefined') {
    if (starTexture.isReady && starTexture.isReady()) {
      logStarfieldVerified();
    } else if (starTexture.onLoadObservable) {
      starTexture.onLoadObservable.addOnce(logStarfieldVerified);
    }
  }

  // A StandardMaterial in this scene never sampled the star texture: measured on
  // the live canvas, the skybox came out pure black (max luminance 2/255) at
  // every scale while the same mesh with a flat emissive colour did draw. A
  // tiny ShaderMaterial that samples the catalog texture directly puts the real
  // star map on screen instead of another unlit-colour sphere.
  if (!BABYLON.Effect.ShadersStore.starfieldSkyVertexShader) {
    BABYLON.Effect.ShadersStore.starfieldSkyVertexShader = `
      precision highp float;
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = worldViewProjection * vec4(position, 1.0);
      }
    `;
    BABYLON.Effect.ShadersStore.starfieldSkyFragmentShader = `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D starTex;
      void main() {
        // Only stellar cores survive. The catalogue texture also carries a
        // diffuse Milky-Way wash and anti-aliased halos around each star; those
        // are what read as a fake painted sky. Thresholding to the cores leaves
        // a dark sky with the real catalogue stars as tiny points.
        vec3 c = texture2D(starTex, vUv).rgb;
        float lum = max(max(c.r, c.g), c.b);
        float core = smoothstep(0.34, 0.62, lum);
        if (core <= 0.001) discard;
        gl_FragColor = vec4(c * 1.5, 1.0);
      }
    `;
  }
  const material = new BABYLON.ShaderMaterial('StarfieldSkyboxMaterial', scene, {
    vertex: 'starfieldSky',
    fragment: 'starfieldSky'
  }, {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection'],
    samplers: ['starTex']
  });
  material.setTexture('starTex', starTexture);
  // starfield_gaia_2k.png is sRGB content sampled straight to the sRGB canvas.
  starTexture.gammaSpace = true;
  material.backFaceCulling = true; // BACKSIDE geometry exposes inner faces
  material.disableDepthWrite = true; // THREE depthWrite: false
  if (starTexture) {
    starTexture.anisotropicFilteringLevel = 16;
  }

  mesh.material = material;
  mesh.isPickable = false;
  return mesh;
}
