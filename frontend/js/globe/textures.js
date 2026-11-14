/**
 * frontend/js/globe/textures.js
 * High-quality Earth texture loader and deterministic procedural Canvas fallback generator.
 * Guarantees 100% offline functionality with zero blank screens.
 */

// Major continental boundary polygons in [longitude, latitude] degrees
export const CONTINENTAL_POLYGONS = [
  // North America
  [
    [-168, 65], [-140, 70], [-130, 68], [-124, 48], [-120, 34],
    [-110, 23], [-105, 20], [-90, 16], [-83, 9], [-77, 8],
    [-80, 22], [-82, 25], [-80, 31], [-75, 35], [-70, 42],
    [-60, 46], [-55, 52], [-60, 60], [-80, 62], [-95, 69],
    [-115, 69], [-140, 68], [-165, 60], [-168, 65]
  ],
  // Greenland
  [
    [-55, 60], [-35, 65], [-20, 70], [-20, 82], [-40, 83], [-60, 82], [-55, 60]
  ],
  // South America
  [
    [-77, 8], [-60, 10], [-50, 4], [-35, -5], [-35, -10],
    [-40, -22], [-50, -30], [-55, -40], [-65, -55], [-72, -53],
    [-75, -45], [-72, -35], [-70, -20], [-80, -5], [-77, 8]
  ],
  // Eurasia
  [
    [-10, 36], [0, 38], [15, 40], [28, 41], [35, 32],
    [50, 26], [60, 25], [70, 20], [78, 8], [88, 22],
    [92, 10], [105, 10], [108, 18], [120, 23], [122, 30],
    [130, 42], [140, 50], [160, 55], [170, 65], [179, 66],
    [179, 72], [140, 74], [100, 78], [60, 74], [30, 71],
    [10, 60], [-5, 58], [-10, 44], [-10, 36]
  ],
  // British Isles
  [
    [-10, 50], [2, 50], [2, 58], [-5, 59], [-10, 55], [-10, 50]
  ],
  // Africa
  [
    [-17, 15], [-15, 30], [-5, 36], [10, 37], [25, 32],
    [32, 28], [43, 12], [51, 10], [40, -5], [35, -20],
    [30, -32], [20, -35], [15, -25], [10, 0], [0, 5], [-17, 15]
  ],
  // Australia
  [
    [114, -22], [115, -34], [135, -35], [150, -38], [153, -28],
    [145, -15], [142, -11], [130, -13], [122, -18], [114, -22]
  ],
  // Antarctica
  [
    [-179, -65], [-120, -70], [-70, -63], [-60, -65], [0, -68],
    [60, -65], [120, -64], [179, -65], [179, -89], [-179, -89], [-179, -65]
  ]
];

// Major metropolitan hubs for night lights [longitude, latitude, intensity]
export const METRO_CENTERS = [
  [-74.0, 40.7, 1.0],   // New York
  [-87.6, 41.8, 0.9],   // Chicago
  [-118.2, 34.0, 0.95], // Los Angeles
  [-122.4, 37.7, 0.9],  // San Francisco
  [-0.1, 51.5, 1.0],    // London
  [2.3, 48.8, 1.0],     // Paris
  [13.4, 52.5, 0.85],   // Berlin
  [139.6, 35.6, 1.0],   // Tokyo
  [121.4, 31.2, 1.0],   // Shanghai
  [116.4, 39.9, 0.95],  // Beijing
  [72.8, 18.9, 0.95],   // Mumbai
  [77.2, 28.6, 0.95],   // Delhi
  [-46.6, -23.5, 0.95], // São Paulo
  [31.2, 30.0, 0.9],    // Cairo
  [151.2, -33.8, 0.9]   // Sydney
];

/**
 * Coordinate conversion: (lon, lat) in degrees to equirectangular pixel coordinates.
 */
export function latLonToPixel(lon, lat, width, height) {
  const x = ((lon + 180.0) / 360.0) * width;
  const y = ((90.0 - lat) / 180.0) * height;
  return [x, y];
}

/**
 * Create an offscreen HTML5 canvas.
 */
function createCanvas(width, height) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/**
 * Procedural Day Map Generator
 * Draws ocean gradient, continental polygons, vegetation, and polar ice caps.
 */
export function createProceduralDayCanvas(width = 1024, height = 512) {
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // 1. Ocean gradient background
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0.0, '#081726'); // Arctic deep blue
  oceanGrad.addColorStop(0.35, '#0b2644');
  oceanGrad.addColorStop(0.5, '#0d3257');  // Equatorial vibrant ocean
  oceanGrad.addColorStop(0.65, '#0b2644');
  oceanGrad.addColorStop(1.0, '#081726'); // Antarctic deep blue
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Latitude graticule grid lines (subtle telemetry)
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = latLonToPixel(0, lat, width, height);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    const [x] = latLonToPixel(lon, 0, width, height);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // 3. Draw continents
  for (let i = 0; i < CONTINENTAL_POLYGONS.length; i++) {
    const poly = CONTINENTAL_POLYGONS[i];
    if (!poly || poly.length < 3) continue;

    ctx.beginPath();
    const [startX, startY] = latLonToPixel(poly[0][0], poly[0][1], width, height);
    ctx.moveTo(startX, startY);
    for (let p = 1; p < poly.length; p++) {
      const [px, py] = latLonToPixel(poly[p][0], poly[p][1], width, height);
      ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Color by region / biome
    if (i === 1 || i === 7) {
      // Greenland or Antarctica = Ice
      ctx.fillStyle = '#f0f9ff';
      ctx.strokeStyle = '#e0f2fe';
    } else if (i === 5) {
      // Africa (Sahara + savannah)
      ctx.fillStyle = '#9b804e';
      ctx.strokeStyle = '#b89960';
    } else if (i === 6) {
      // Australia (outback amber-red)
      ctx.fillStyle = '#a36d41';
      ctx.strokeStyle = '#c48753';
    } else {
      // Temperate / tropical landmass
      ctx.fillStyle = '#2d5a27';
      ctx.strokeStyle = '#3e7536';
    }
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  // 4. North Polar Ice Cap (Arctic)
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  const [ax0, ay0] = latLonToPixel(-180, 80, width, height);
  ctx.moveTo(ax0, ay0);
  ctx.lineTo(width, ay0);
  ctx.lineTo(width, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  return canvas;
}

/**
 * Procedural Night Map Generator
 * Draws pitch black oceans and luminous golden city lights.
 */
export function createProceduralNightCanvas(width = 1024, height = 512) {
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // Pitch black deep space ocean
  ctx.fillStyle = '#020509';
  ctx.fillRect(0, 0, width, height);

  // Very faint continent silhouette
  ctx.fillStyle = '#070d18';
  for (const poly of CONTINENTAL_POLYGONS) {
    if (!poly || poly.length < 3) continue;
    ctx.beginPath();
    const [startX, startY] = latLonToPixel(poly[0][0], poly[0][1], width, height);
    ctx.moveTo(startX, startY);
    for (let p = 1; p < poly.length; p++) {
      const [px, py] = latLonToPixel(poly[p][0], poly[p][1], width, height);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Metropolitan city light hubs with radial glow
  for (const [lon, lat, intensity] of METRO_CENTERS) {
    const [cx, cy] = latLonToPixel(lon, lat, width, height);
    const rad = 10 * intensity;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0.0, 'rgba(255, 245, 210, 0.95)');
    grad.addColorStop(0.3, 'rgba(255, 200, 90, 0.65)');
    grad.addColorStop(0.7, 'rgba(245, 158, 11, 0.25)');
    grad.addColorStop(1.0, 'rgba(245, 158, 11, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Linear city filaments (highways and population corridors)
  ctx.fillStyle = 'rgba(255, 215, 130, 0.7)';
  const sprinkleBoxes = [
    [-95, -70, 30, 45, 60],  // Eastern US
    [-5, 25, 42, 55, 70],    // Western Europe
    [72, 88, 12, 30, 50],    // India
    [110, 140, 25, 42, 70]   // East Asia
  ];
  for (const [lonMin, lonMax, latMin, latMax, count] of sprinkleBoxes) {
    for (let i = 0; i < count; i++) {
      // Deterministic pseudo-random distribution
      const lon = lonMin + ((i * 37) % 100) / 100 * (lonMax - lonMin);
      const lat = latMin + ((i * 53) % 100) / 100 * (latMax - latMin);
      const [px, py] = latLonToPixel(lon, lat, width, height);
      ctx.fillRect(px, py, 1.5, 1.5);
    }
  }

  return canvas;
}

/**
 * Procedural Bump Map Generator (Grayscale elevation)
 */
export function createProceduralBumpCanvas(width = 1024, height = 512) {
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // Ocean flat baseline (80)
  ctx.fillStyle = '#505050';
  ctx.fillRect(0, 0, width, height);

  // Plains elevation (135)
  ctx.fillStyle = '#878787';
  for (const poly of CONTINENTAL_POLYGONS) {
    if (!poly || poly.length < 3) continue;
    ctx.beginPath();
    const [startX, startY] = latLonToPixel(poly[0][0], poly[0][1], width, height);
    ctx.moveTo(startX, startY);
    for (let p = 1; p < poly.length; p++) {
      const [px, py] = latLonToPixel(poly[p][0], poly[p][1], width, height);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  // Mountain ranges (bright elevation ridges)
  ctx.fillStyle = '#dcdcdc';
  // Himalayas
  const [hx, hy] = latLonToPixel(85, 29, width, height);
  ctx.beginPath();
  ctx.ellipse(hx, hy, 40, 10, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // Andes
  const [ax, ay] = latLonToPixel(-70, -20, width, height);
  ctx.beginPath();
  ctx.ellipse(ax, ay, 8, 70, 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Rockies
  const [rx, ry] = latLonToPixel(-115, 45, width, height);
  ctx.beginPath();
  ctx.ellipse(rx, ry, 12, 60, -0.3, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

/**
 * Procedural Specular Map Generator (Water = 255 shiny, Land = 0 matte)
 */
export function createProceduralSpecularCanvas(width = 1024, height = 512) {
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // Oceans reflect 100% (White)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Land is matte (Black)
  ctx.fillStyle = '#000000';
  for (const poly of CONTINENTAL_POLYGONS) {
    if (!poly || poly.length < 3) continue;
    ctx.beginPath();
    const [startX, startY] = latLonToPixel(poly[0][0], poly[0][1], width, height);
    ctx.moveTo(startX, startY);
    for (let p = 1; p < poly.length; p++) {
      const [px, py] = latLonToPixel(poly[p][0], poly[p][1], width, height);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  return canvas;
}

/**
 * Procedural Clouds Map Generator
 */
export function createProceduralCloudsCanvas(width = 1024, height = 512) {
  const canvas = createCanvas(width, height);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Equatorial cloud band
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  for (let x = 0; x < width; x += 15) {
    const lon = (x / width) * 360 - 180;
    const wave = Math.sin(lon * 0.08) * 12 + Math.cos(lon * 0.2) * 6;
    const [, cy] = latLonToPixel(lon, 2 + wave / 4, width, height);
    ctx.beginPath();
    ctx.arc(x, cy, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mid-latitude swirling cyclones
  const cyclones = [[-140, 48], [-40, 52], [160, 45], [-120, -50], [20, -52], [100, -48]];
  for (const [lon, lat] of cyclones) {
    const [cx, cy] = latLonToPixel(lon, lat, width, height);
    for (let arm = 0; arm < 3; arm++) {
      const angleOffset = arm * (2 * Math.PI / 3);
      for (let r = 8; r < 40; r += 4) {
        const theta = angleOffset + r * 0.12;
        const px = cx + Math.cos(theta) * r * 1.4;
        const py = cy + Math.sin(theta) * r * 0.7;
        const alpha = 0.5 * (1.0 - r / 40.0);
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  return canvas;
}

/**
 * Load all 5 Earth textures.
 * Attempts to load static assets from `basePath`, with automatic fallback
 * to procedural CanvasTexture upon failure or in headless/offline tests.
 * 
 * @param {Object} THREE - Three.js module
 * @param {string} [basePath='/assets/textures/']
 * @returns {Promise<Object>} { dayMap, nightMap, bumpMap, specularMap, cloudsMap }
 */
export async function loadEarthTextures(THREE, basePath = '/assets/textures/') {
  const loader = new THREE.TextureLoader();

  function loadWithFallback(filename, fallbackGenerator) {
    return new Promise((resolve) => {
      const url = `${basePath}${filename}`;
      loader.load(
        url,
        (tex) => {
          if (THREE.SRGBColorSpace && (filename.includes('day') || filename.includes('night'))) {
            tex.colorSpace = THREE.SRGBColorSpace;
          }
          resolve(tex);
        },
        undefined,
        () => {
          // Fallback to procedural CanvasTexture
          const canvas = fallbackGenerator();
          if (canvas) {
            const tex = new THREE.CanvasTexture(canvas);
            if (THREE.SRGBColorSpace && (filename.includes('day') || filename.includes('night'))) {
              tex.colorSpace = THREE.SRGBColorSpace;
            }
            resolve(tex);
          } else {
            // Null or dummy texture if canvas is unsupported
            const dataTex = new THREE.DataTexture(new Uint8Array([11, 37, 69, 255]), 1, 1);
            dataTex.needsUpdate = true;
            resolve(dataTex);
          }
        }
      );
    });
  }

  const [dayMap, nightMap, bumpMap, specularMap, cloudsMap] = await Promise.all([
    loadWithFallback('earth_day_2k.png', () => createProceduralDayCanvas(1024, 512)),
    loadWithFallback('earth_night_2k.png', () => createProceduralNightCanvas(1024, 512)),
    loadWithFallback('earth_bump_2k.png', () => createProceduralBumpCanvas(1024, 512)),
    loadWithFallback('earth_specular_2k.png', () => createProceduralSpecularCanvas(1024, 512)),
    loadWithFallback('earth_clouds_2k.png', () => createProceduralCloudsCanvas(1024, 512)),
  ]);

  return { dayMap, nightMap, bumpMap, specularMap, cloudsMap };
}
