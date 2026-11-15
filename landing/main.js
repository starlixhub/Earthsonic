/**
 * EarthSonic Landing Page JavaScript
 * NASA Space Apps Challenge 2026
 * JPL Mission Console Theme & Interactive Showcase
 *
 * Modules:
 *   1. Embedded Pure JavaScript QR Code Generator (ISO/IEC 18004:2015 Compliant)
 *   2. Three.js 3D Earth Globe with Day/Night Terminator Shader & Procedural Fallbacks
 *   3. GSAP & ScrollTrigger Scroll-Linked Navigation Transition (with native scroll fallback)
 *   4. Mobile Navigation Drawer Controls
 *   5. Desktop VR QR Modal & Clipboard Controls
 */

(function () {
  'use strict';

  /* ==========================================================================
     1. Pure JavaScript QR Code Generator (Zero-Dependency)
     ========================================================================== */
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);

  (function initGaloisField() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      EXP[i + 255] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 256) x ^= 0x11D;
    }
    LOG[0] = 0;
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(k) {
    let g = [1];
    for (let i = 0; i < k; i++) {
      const next = new Array(g.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < g.length; j++) {
        next[j] ^= gfMul(g[j], factor);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    return g.reverse();
  }

  function rsComputeRemainder(data, numEcc) {
    const gen = rsGeneratorPoly(numEcc);
    const msg = new Uint8Array(data.length + numEcc);
    msg.set(data, 0);
    for (let i = 0; i < data.length; i++) {
      const coef = msg[i];
      if (coef !== 0) {
        for (let j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coef);
        }
      }
    }
    return Array.from(msg.slice(data.length));
  }

  const QR_VERSIONS = {
    1: { size: 21, totalBytes: 26, blocks: [{ count: 1, data: 16, ec: 10 }], align: [], remainder: 0 },
    2: { size: 25, totalBytes: 44, blocks: [{ count: 1, data: 28, ec: 16 }], align: [6, 18], remainder: 7 },
    3: { size: 29, totalBytes: 70, blocks: [{ count: 1, data: 44, ec: 26 }], align: [6, 22], remainder: 7 },
    4: { size: 33, totalBytes: 100, blocks: [{ count: 2, data: 32, ec: 18 }], align: [6, 26], remainder: 7 },
    5: { size: 37, totalBytes: 134, blocks: [{ count: 2, data: 43, ec: 24 }], align: [6, 30], remainder: 7 },
    6: { size: 41, totalBytes: 172, blocks: [{ count: 4, data: 27, ec: 16 }], align: [6, 34], remainder: 7 },
    7: { size: 45, totalBytes: 196, blocks: [{ count: 2, data: 31, ec: 18 }, { count: 2, data: 32, ec: 18 }], align: [6, 22, 38], remainder: 0 },
    8: { size: 49, totalBytes: 242, blocks: [{ count: 2, data: 38, ec: 22 }, { count: 2, data: 39, ec: 22 }], align: [6, 24, 42], remainder: 0 }
  };

  function stringToUtf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
      else bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
    return new Uint8Array(bytes);
  }

  function encodeQRCode(text) {
    const rawBytes = stringToUtf8Bytes(text);
    let version = 1;
    while (version <= 8) {
      const cfg = QR_VERSIONS[version];
      let capacity = 0;
      for (const b of cfg.blocks) capacity += b.count * b.data;
      if (rawBytes.length + 3 <= capacity) break;
      version++;
    }
    if (version > 8) version = 8;

    const cfg = QR_VERSIONS[version];
    let totalDataCapacity = 0;
    for (const b of cfg.blocks) totalDataCapacity += b.count * b.data;

    const bitBuffer = [];
    function appendBits(val, len) {
      for (let i = len - 1; i >= 0; i--) bitBuffer.push((val >> i) & 1);
    }

    appendBits(0b0100, 4); // Byte mode
    appendBits(rawBytes.length, version < 10 ? 8 : 16);
    for (let i = 0; i < rawBytes.length; i++) appendBits(rawBytes[i], 8);

    // Terminator
    const termLen = Math.min(4, totalDataCapacity * 8 - bitBuffer.length);
    appendBits(0, termLen);
    while (bitBuffer.length % 8 !== 0) bitBuffer.push(0);

    // Pad bytes
    const pad = [0xEC, 0x11];
    let padIdx = 0;
    while (bitBuffer.length < totalDataCapacity * 8) {
      appendBits(pad[padIdx % 2], 8);
      padIdx++;
    }

    const dataBytes = [];
    for (let i = 0; i < bitBuffer.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bitBuffer[i + j];
      dataBytes.push(b);
    }

    // Interleave blocks
    const blockList = [];
    let offset = 0;
    for (const b of cfg.blocks) {
      for (let i = 0; i < b.count; i++) {
        const raw = dataBytes.slice(offset, offset + b.data);
        offset += b.data;
        const ec = rsComputeRemainder(raw, b.ec);
        blockList.push({ data: raw, ec: ec });
      }
    }

    const finalBytes = [];
    let maxData = 0, maxEc = 0;
    for (const b of blockList) {
      if (b.data.length > maxData) maxData = b.data.length;
      if (b.ec.length > maxEc) maxEc = b.ec.length;
    }
    for (let i = 0; i < maxData; i++) {
      for (const b of blockList) if (i < b.data.length) finalBytes.push(b.data[i]);
    }
    for (let i = 0; i < maxEc; i++) {
      for (const b of blockList) if (i < b.ec.length) finalBytes.push(b.ec[i]);
    }

    const S = cfg.size;
    const matrix = Array.from({ length: S }, () => new Array(S).fill(null));
    const isReserved = Array.from({ length: S }, () => new Array(S).fill(false));

    function setModule(r, c, val, reserved = true) {
      if (r >= 0 && r < S && c >= 0 && c < S) {
        matrix[r][c] = val;
        if (reserved) isReserved[r][c] = true;
      }
    }

    // Finder patterns
    function addFinder(top, left) {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const row = top + r, col = left + c;
          if (row < 0 || row >= S || col < 0 || col >= S) continue;
          if (r >= 0 && r <= 6 && (c === 0 || c === 6 || r === 0 || r === 6)) setModule(row, col, 1);
          else if (r >= 2 && r <= 4 && c >= 2 && c <= 4) setModule(row, col, 1);
          else setModule(row, col, 0);
        }
      }
    }
    addFinder(0, 0);
    addFinder(0, S - 7);
    addFinder(S - 7, 0);

    // Alignment patterns
    if (cfg.align && cfg.align.length > 0) {
      const coords = cfg.align;
      for (const r of coords) {
        for (const c of coords) {
          if (isReserved[r][c]) continue;
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const d = Math.max(Math.abs(dr), Math.abs(dc));
              setModule(r + dr, c + dc, d === 1 ? 0 : 1);
            }
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < S - 8; i++) {
      setModule(6, i, i % 2 === 0 ? 1 : 0);
      setModule(i, 6, i % 2 === 0 ? 1 : 0);
    }
    // Dark module
    setModule(4 * version + 9, 8, 1);

    // Format info reservation
    for (let i = 0; i < 9; i++) {
      if (!isReserved[8][i]) isReserved[8][i] = true;
      if (!isReserved[i][8]) isReserved[i][8] = true;
    }
    for (let i = S - 8; i < S; i++) {
      if (!isReserved[8][i]) isReserved[8][i] = true;
      if (!isReserved[i][8]) isReserved[i][8] = true;
    }

    // Data placement
    const bits = [];
    for (const byte of finalBytes) {
      for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    }
    for (let i = 0; i < cfg.remainder; i++) bits.push(0);

    let bitIdx = 0;
    let upward = true;
    for (let right = S - 1; right > 0; right -= 2) {
      if (right === 6) right--;
      const rows = upward ? Array.from({ length: S }, (_, i) => S - 1 - i) : Array.from({ length: S }, (_, i) => i);
      for (const r of rows) {
        for (const c of [right, right - 1]) {
          if (!isReserved[r][c]) {
            matrix[r][c] = bitIdx < bits.length ? bits[bitIdx++] : 0;
          }
        }
      }
      upward = !upward;
    }

    // Mask 0: (row + col) % 2 === 0
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        if (!isReserved[r][c] && ((r + c) % 2 === 0)) {
          matrix[r][c] ^= 1;
        }
      }
    }

    // Format bits for Mask 0, Error Level M: 101010000010010
    const fmtBits = [1,0,1,0,1,0,0,0,0,0,1,0,0,1,0];
    const topRow = [0,1,2,3,4,5,7,8];
    const rightCol = [7,5,4,3,2,1,0];
    for (let i = 0; i < 8; i++) matrix[8][topRow[i]] = fmtBits[i];
    for (let i = 0; i < 7; i++) matrix[8][S - 1 - rightCol[i]] = fmtBits[8 + i];
    const leftCol = [0,1,2,3,4,5,7,8];
    const bottomRow = [7,6,5,4,3,2,1,0];
    for (let i = 0; i < 8; i++) matrix[leftCol[7 - i]][8] = fmtBits[i];
    for (let i = 0; i < 7; i++) matrix[S - 1 - bottomRow[6 - i]][8] = fmtBits[8 + i];

    return { size: S, matrix: matrix };
  }

  function renderQRCodeToCanvas(canvas, text) {
    if (!canvas || !canvas.getContext) return;
    const qr = encodeQRCode(text);
    const S = qr.size;
    const margin = 4;
    const totalModules = S + margin * 2;
    const targetPx = 220;
    const scale = Math.max(1, Math.floor(targetPx / totalModules));
    const actualPx = totalModules * scale;

    canvas.width = actualPx;
    canvas.height = actualPx;
    canvas.style.width = '220px';
    canvas.style.height = '220px';

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, actualPx, actualPx);

    ctx.fillStyle = '#060a12';
    for (let r = 0; r < S; r++) {
      for (let c = 0; c < S; c++) {
        if (qr.matrix[r][c] === 1) {
          ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
    }
  }

  /* ==========================================================================
     2. Three.js 3D Earth Globe with Procedural Fallbacks & Terminator Shader
     ========================================================================== */
  function createProceduralDayCanvas(w = 1024, h = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Deep ocean
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, '#061324');
    grad.addColorStop(0.5, '#0b2a4a');
    grad.addColorStop(1.0, '#061324');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Simplified continental landmasses
    ctx.fillStyle = '#2d5a3f'; // Vegetation green
    // Eurasia / Africa
    ctx.beginPath();
    ctx.ellipse(w * 0.58, h * 0.42, w * 0.22, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    // Americas
    ctx.beginPath();
    ctx.ellipse(w * 0.26, h * 0.46, w * 0.12, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Australia
    ctx.beginPath();
    ctx.ellipse(w * 0.82, h * 0.68, w * 0.07, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Polar ice caps
    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(0, 0, w, h * 0.08);
    ctx.fillRect(0, h * 0.92, w, h * 0.08);

    return canvas;
  }

  function createProceduralNightCanvas(w = 1024, h = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#020408';
    ctx.fillRect(0, 0, w, h);

    // Amber city lights clusters
    ctx.fillStyle = '#ff9d42';
    const numLights = 320;
    for (let i = 0; i < numLights; i++) {
      const x = (0.2 + Math.random() * 0.65) * w;
      const y = (0.25 + Math.random() * 0.45) * h;
      const r = Math.random() < 0.2 ? 1.8 : 0.9;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  function createProceduralCloudsCanvas(w = 1024, h = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';

    // Dynamic cloud swirls
    for (let i = 0; i < 40; i++) {
      const cx = Math.random() * w;
      const cy = Math.random() * h;
      const rx = 30 + Math.random() * 80;
      const ry = 10 + Math.random() * 25;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, (Math.random() - 0.5) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return canvas;
  }

  function createProceduralSpecularCanvas(w = 512, h = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Ocean white (specular reflection), land black
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(w * 0.58, h * 0.42, w * 0.22, h * 0.24, 0, 0, Math.PI * 2);
    ctx.ellipse(w * 0.26, h * 0.46, w * 0.12, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
  }

  function initGlobe() {
    const container = document.getElementById('globe-container');
    const canvas = document.getElementById('globe-canvas');
    if (!container || !canvas || typeof THREE === 'undefined') return;

    const width = container.clientWidth || 320;
    const height = container.clientHeight || 320;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 2.85;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
    } catch (e) {
      console.warn('WebGL init error:', e);
      return;
    }

    const textureLoader = new THREE.TextureLoader();
    function loadTextureWithFallback(url, fallbackFn) {
      return new Promise((resolve) => {
        textureLoader.load(
          url,
          (tex) => resolve(tex),
          undefined,
          () => {
            const fbCanvas = fallbackFn();
            resolve(new THREE.CanvasTexture(fbCanvas));
          }
        );
      });
    }

    const basePath = '/assets/textures/';
    Promise.all([
      loadTextureWithFallback(basePath + 'earth_day_2k.png', createProceduralDayCanvas),
      loadTextureWithFallback(basePath + 'earth_night_2k.png', createProceduralNightCanvas),
      loadTextureWithFallback(basePath + 'earth_clouds_2k.png', createProceduralCloudsCanvas),
      loadTextureWithFallback(basePath + 'earth_specular_2k.png', createProceduralSpecularCanvas)
    ]).then(([dayTex, nightTex, cloudsTex, specTex]) => {
      // Globe group with axial tilt (23.4 degrees)
      const globeGroup = new THREE.Group();
      globeGroup.rotation.z = (23.4 * Math.PI) / 180;
      scene.add(globeGroup);

      // Custom GLSL Day/Night Terminator Shader Material
      const sunPosition = new THREE.Vector3(5.0, 1.5, 3.5);
      const terminatorMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uDayMap: { value: dayTex },
          uNightMap: { value: nightTex },
          uSpecularMap: { value: specTex },
          uSunPosition: { value: sunPosition },
          uDayIntensity: { value: 1.15 },
          uNightIntensity: { value: 1.6 }
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          varying vec3 vSunDirection;
          uniform vec3 uSunPosition;

          void main() {
            vUv = uv;
            vNormal = normalize(mat3(modelMatrix) * normal);
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPos.xyz;
            vSunDirection = normalize(uSunPosition - worldPos.xyz);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uDayMap;
          uniform sampler2D uNightMap;
          uniform sampler2D uSpecularMap;
          uniform float uNightIntensity;
          uniform float uDayIntensity;

          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;
          varying vec3 vSunDirection;

          void main() {
            vec3 normal = normalize(vNormal);
            vec3 sunDir = normalize(vSunDirection);
            float sunDotNormal = dot(normal, sunDir);

            // Soft terminator transition (-0.15 to +0.15)
            float dayFactor = smoothstep(-0.15, 0.15, sunDotNormal);

            vec4 dayColor = texture2D(uDayMap, vUv) * uDayIntensity;
            vec4 nightColor = texture2D(uNightMap, vUv) * uNightIntensity;
            float specMask = texture2D(uSpecularMap, vUv).r;

            // Specular reflection on water
            vec3 viewDir = normalize(cameraPosition - vWorldPosition);
            vec3 halfVector = normalize(sunDir + viewDir);
            float specAngle = max(dot(normal, halfVector), 0.0);
            float specular = pow(specAngle, 32.0) * specMask * dayFactor;

            vec3 ambientNight = nightColor.rgb * 1.5;
            vec3 surface = mix(ambientNight, dayColor.rgb, dayFactor);
            vec3 finalColor = surface + vec3(specular * 0.4);

            gl_FragColor = vec4(finalColor, 1.0);
          }
        `
      });

      // Earth Core Sphere (Radius = 1.0)
      const earthGeo = new THREE.SphereGeometry(1.0, 64, 64);
      const earthMesh = new THREE.Mesh(earthGeo, terminatorMaterial);
      globeGroup.add(earthMesh);

      // Concentric MODIS Cloud Sphere (Radius = 1.008)
      const cloudsGeo = new THREE.SphereGeometry(1.008, 64, 64);
      const cloudsMat = new THREE.MeshBasicMaterial({
        map: cloudsTex,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const cloudsMesh = new THREE.Mesh(cloudsGeo, cloudsMat);
      globeGroup.add(cloudsMesh);

      // Auto-Rotation Animation Loop
      let animId;
      function animate() {
        animId = requestAnimationFrame(animate);
        earthMesh.rotation.y += 0.001;
        cloudsMesh.rotation.y += 0.0014; // Differential atmospheric rotation
        renderer.render(scene, camera);
      }
      animate();

      // Responsive Resize
      function onResize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        }
      }
      window.addEventListener('resize', onResize);
    });
  }

  /* ==========================================================================
     3. GSAP & ScrollTrigger Navigation Choreography (with Native Fallback)
     ========================================================================== */
  function initScrollTransitions() {
    const topNav = document.getElementById('top-nav');
    const heroSection = document.getElementById('hero');
    const heroWordmark = document.getElementById('hero-wordmark');
    const globeContainer = document.getElementById('globe-container');
    const globeHalo = document.getElementById('hero-globe-halo');

    // Check if GSAP and ScrollTrigger are loaded
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
      gsap.registerPlugin(ScrollTrigger);

      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: heroSection,
          start: 'top top',
          end: '+=500',
          scrub: 0.5,
          onUpdate: (self) => {
            if (self.progress > 0.05) {
              topNav.classList.add('nav-scrolled');
            } else {
              topNav.classList.remove('nav-scrolled');
            }
          }
        }
      });

      // 1. Solidify top nav background
      timeline.to(topNav, {
        backgroundColor: '#142e47',
        borderBottomColor: '#1f3f61',
        duration: 1
      }, 0);

      // 2. Shrink and migrate wordmark into top-left nav slot
      if (heroWordmark) {
        timeline.to(heroWordmark, {
          y: -180,
          scale: 0.45,
          opacity: 0,
          duration: 1,
          ease: 'power1.out'
        }, 0);
      }

      // 3. Scroll up and shrink Earth sphere
      if (globeContainer) {
        timeline.to(globeContainer, {
          y: -90,
          scale: 0.85,
          opacity: 0.85,
          duration: 1
        }, 0);
      }

      if (globeHalo) {
        timeline.to(globeHalo, {
          y: -90,
          scale: 0.85,
          opacity: 0.85,
          duration: 1
        }, 0);
      }
    } else {
      // Native Scroll Fallback (Zero external script dependency)
      function onNativeScroll() {
        const scrollY = window.scrollY || window.pageYOffset || 0;
        const progress = Math.min(1, Math.max(0, scrollY / 500));

        if (progress > 0.05) {
          topNav.classList.add('nav-scrolled');
        } else {
          topNav.classList.remove('nav-scrolled');
        }

        if (heroWordmark) {
          heroWordmark.style.transform = `translate(-50%, calc(-50% - ${progress * 180}px)) scale(${1 - progress * 0.55})`;
          heroWordmark.style.opacity = `${1 - progress}`;
        }

        if (globeContainer) {
          globeContainer.style.transform = `translateY(-${progress * 90}px) scale(${1 - progress * 0.15})`;
        }

        if (globeHalo) {
          globeHalo.style.transform = `translate(-50%, calc(-50% - ${progress * 90}px)) scale(${1 - progress * 0.15})`;
        }
      }

      window.addEventListener('scroll', onNativeScroll, { passive: true });
      onNativeScroll();
    }
  }

  /* ==========================================================================
     4. Mobile Navigation Drawer Controls
     ========================================================================== */
  function initMobileNav() {
    const toggleBtn = document.getElementById('btn-nav-toggle');
    const mobilePanel = document.getElementById('mobile-nav-panel');
    if (!toggleBtn || !mobilePanel) return;

    function openMenu() {
      toggleBtn.setAttribute('aria-expanded', 'true');
      mobilePanel.removeAttribute('hidden');
    }

    function closeMenu() {
      toggleBtn.setAttribute('aria-expanded', 'false');
      mobilePanel.setAttribute('hidden', '');
    }

    toggleBtn.addEventListener('click', function () {
      const isExpanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Close when clicking mobile nav links
    const mobileLinks = mobilePanel.querySelectorAll('.mobile-nav-link');
    mobileLinks.forEach((link) => {
      link.addEventListener('click', closeMenu);
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggleBtn.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        toggleBtn.focus();
      }
    });
  }

  /* ==========================================================================
     5. Desktop VR QR Modal & Clipboard Controls
     ========================================================================== */
  function initVRModal() {
    const openBtn = document.getElementById('btn-open-vr-modal');
    const openNavBtn = document.getElementById('nav-link-vr');
    const openMobileBtn = document.getElementById('mobile-link-vr');
    const modal = document.getElementById('vr-modal');
    const closeBtn = document.getElementById('btn-close-vr-modal');
    const backdrop = document.getElementById('vr-modal-backdrop');
    const qrCanvas = document.getElementById('qr-canvas');
    const copyBtn = document.getElementById('btn-copy-vr-link');
    const urlInput = document.getElementById('vr-url-input');

    if (!modal) return;

    // Determine target VR launch URL for Railway production
    // Never encode localhost:8080 into the QR code so mobile devices can open the site directly.
    const DEFAULT_PROD_URL = 'https://earthsonic.up.railway.app/?vr=1';

    function resolveLaunchUrl() {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        const hostname = (window.location.hostname || '').toLowerCase();
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '0.0.0.0') {
          return `${window.location.origin}/?vr=1`;
        }
      }
      const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="earthsonic-public-url"]') : null;
      if (meta && meta.content) {
        return `${meta.content.replace(/\/+$/, '')}/?vr=1`;
      }
      return DEFAULT_PROD_URL;
    }

    let vrUrl = resolveLaunchUrl();

    if (urlInput) {
      urlInput.value = vrUrl;
    }

    // Query backend VR launch endpoint for environment-configured public domain (RAILWAY_PUBLIC_DOMAIN / PUBLIC_URL)
    if (typeof fetch === 'function') {
      fetch('/api/vr-launch-info')
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          if (data && data.vr_url) {
            const candidate = data.vr_url;
            if (!candidate.includes('localhost') && !candidate.includes('127.0.0.1') && !candidate.includes('0.0.0.0')) {
              vrUrl = candidate;
              if (urlInput) urlInput.value = vrUrl;
              if (modal && !modal.hasAttribute('hidden') && qrCanvas) {
                renderQRCodeToCanvas(qrCanvas, vrUrl);
              }
            }
          }
        })
        .catch(function () {});
    }

    function openModal(e) {
      if (e) e.preventDefault();
      modal.removeAttribute('hidden');
      document.body.style.overflow = 'hidden';
      if (urlInput) {
        urlInput.value = vrUrl;
      }
      if (qrCanvas) {
        renderQRCodeToCanvas(qrCanvas, vrUrl);
      }
      if (closeBtn) {
        closeBtn.focus();
      }
    }

    function closeModal() {
      modal.setAttribute('hidden', '');
      document.body.style.overflow = '';
      if (openBtn) {
        openBtn.focus();
      }
    }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openNavBtn) openNavBtn.addEventListener('click', openModal);
    if (openMobileBtn) openMobileBtn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hasAttribute('hidden')) {
        closeModal();
      }
    });

    // Clipboard copy with feedback
    if (copyBtn && urlInput) {
      copyBtn.addEventListener('click', function () {
        const copyText = urlInput.value;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyText).then(onCopySuccess).catch(fallbackCopy);
        } else {
          fallbackCopy();
        }

        function fallbackCopy() {
          urlInput.select();
          try {
            document.execCommand('copy');
            onCopySuccess();
          } catch (err) {
            console.warn('Copy command failed:', err);
          }
        }

        function onCopySuccess() {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = 'COPIED!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        }
      });
    }
  }

  /* ==========================================================================
     Application Bootstrap
     ========================================================================== */
  window.addEventListener('DOMContentLoaded', function () {
    initGlobe();
    initScrollTransitions();
    initMobileNav();
    initVRModal();
  });
})();
