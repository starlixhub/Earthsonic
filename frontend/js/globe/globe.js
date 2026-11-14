/**
 * frontend/js/globe/globe.js
 * Core Three.js 3D Earth Globe component for EARTHSONIC:
 *   - True axial tilt (23.44°)
 *   - Photorealistic concentric layers: Core sphere, Clouds, Atmospheric Fresnel glow
 *   - Smooth GLSL day/night terminator blend
 *   - Orbit controls with damping and distance limits
 *   - Scientific overlay integration (Temperature, Sea Ice, Ocean, CO2)
 *   - Geographic coordinate transforms & fly-to navigation
 *   - Responsive resize & click raycasting
 */

import * as THREE_MODULE from 'three';
import { OrbitControls as OrbitControlsModule } from 'three/addons/controls/OrbitControls.js';
import { TerminatorShader, AtmosphereShader, StarfieldShader } from './shaders.js';
import { loadEarthTextures } from './textures.js';
import { OverlayManager, latLonToVector3, MAUNA_LOA_COORDS } from './overlays.js';

// Planetary Constants
export const AXIAL_TILT_DEG = 23.44;
export const AXIAL_TILT_RAD = (23.44 * Math.PI) / 180.0; // 0.4091 rad

/**
 * Cubic-bezier(0.22, 1, 0.36, 1) easing evaluator.
 * Solves x(u) = t for u using Newton-Raphson, then computes y(u).
 * Control points: P0=(0,0), P1=(0.22, 1.0), P2=(0.36, 1.0), P3=(1,1).
 * @param {number} t - Normalized progress [0, 1]
 * @returns {number} Eased progress [0, 1]
 */
export function cubicBezierEase(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  const x1 = 0.22, y1 = 1.0;
  const x2 = 0.36, y2 = 1.0;

  let u = t;
  for (let i = 0; i < 8; i++) {
    const oneMinusU = 1.0 - u;
    const currentX = 3.0 * oneMinusU * oneMinusU * u * x1 +
                     3.0 * oneMinusU * u * u * x2 +
                     u * u * u;
    const diff = currentX - t;
    if (Math.abs(diff) < 1e-6) break;
    const dx = 3.0 * oneMinusU * oneMinusU * x1 +
               6.0 * oneMinusU * u * (x2 - x1) +
               3.0 * u * u * (1.0 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u -= diff / dx;
    u = Math.max(0.0, Math.min(1.0, u));
  }

  const oneMinusU = 1.0 - u;
  return 3.0 * oneMinusU * oneMinusU * u * y1 +
         3.0 * oneMinusU * u * u * y2 +
         u * u * u;
}

/**
 * Great-circle spherical linear interpolation between two 3D vectors.
 * Preserves orbital altitude and arcs smoothly across the planetary surface.
 * @param {THREE.Vector3} v1 - Start vector
 * @param {THREE.Vector3} v2 - End vector
 * @param {number} t - Interpolation factor [0, 1]
 * @param {THREE.Vector3} out - Target output vector
 * @returns {THREE.Vector3}
 */
export function slerpVectors(v1, v2, t, out) {
  const r1 = v1.length();
  const r2 = v2.length();
  const radius = r1 + (r2 - r1) * t;

  const u1 = v1.clone().normalize();
  const u2 = v2.clone().normalize();

  let dot = u1.dot(u2);
  dot = Math.max(-1.0, Math.min(1.0, dot));

  if (dot > 0.99995) {
    out.lerpVectors(v1, v2, t);
    return out;
  }

  if (dot < -0.99995) {
    let ortho = v1.clone().set(0, 1, 0).cross(u1);
    if (ortho.lengthSq() < 0.01) {
      ortho = v1.clone().set(1, 0, 0).cross(u1);
    }
    ortho.normalize();
    const angle = Math.PI * t;
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    out.copy(u1).multiplyScalar(cosA).add(ortho.multiplyScalar(sinA)).multiplyScalar(radius);
    return out;
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const w1 = Math.sin((1.0 - t) * theta) / sinTheta;
  const w2 = Math.sin(t * theta) / sinTheta;

  out.copy(u1).multiplyScalar(w1).add(u2.clone().multiplyScalar(w2)).normalize().multiplyScalar(radius);
  return out;
}

export class EarthGlobe {
  /**
   * @param {HTMLElement|string} container - DOM element or selector to host WebGL canvas
   * @param {Object} [options]
   */
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.options = Object.assign({
      baseTexturePath: '/assets/textures/',
      fov: 45,
      near: 0.1,
      far: 1000,
      initialDistance: 2.8,
      minDistance: 1.3,
      maxDistance: 8.0,
      sunPosition: [5.0, 3.0, 5.0],
      // The camera auto-orbits, so a sun fixed in world space swung the visible
      // hemisphere into night for half of every orbit and the dashboard showed
      // a black ball. Anchor the key light to the camera instead: the terminator
      // stays on the limb and Earth is always readable.
      sunFollowsCamera: true,
      autoRotate: true,
      autoRotateSpeed: 0.25,
      showStars: true,
      showAtmosphere: true,
      showClouds: true,
      THREE: THREE_MODULE,
      OrbitControls: OrbitControlsModule
    }, options);

    this.THREE = this.options.THREE;
    this.OrbitControls = this.options.OrbitControls;

    // State
    this.isRunning = false;
    this.animationFrameId = null;
    this.clock = new this.THREE.Clock();
    this.raycaster = new this.THREE.Raycaster();
    this.mouse = new this.THREE.Vector2();

    // Fly-to animation state
    this.flyToTarget = null;
    this.flyToStart = null;
    this.flyToProgress = 1.0;
    this.flyToDuration = 1.5;

    // Setup Three.js Subsystems
    this._initScene();
    this._initCamera();
    this._initRenderer();
    this._initControls();
    this._initLighting();
    this._initCelestialHierarchy();
    this._initStarfield();
    this._bindEvents();

    // Load textures and assemble globe meshes
    this.ready = this._loadAndBuildGlobe();
  }

  _initScene() {
    this.scene = new this.THREE.Scene();
    this.scene.background = new this.THREE.Color(0x05070e); // NASA deep space void
  }

  _initCamera() {
    const width = this.container ? this.container.clientWidth : 800;
    const height = this.container ? this.container.clientHeight : 600;
    const aspect = width / (height || 1);

    this.camera = new this.THREE.PerspectiveCamera(this.options.fov, aspect, this.options.near, this.options.far);
    this.camera.position.set(0, 0, this.options.initialDistance);
  }

  _initRenderer() {
    if (!this.container) return;

    this.renderer = new this.THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;

    this.renderer.setSize(width, height);
    if (typeof window !== 'undefined' && window.devicePixelRatio) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    if (this.THREE.SRGBColorSpace) {
      this.renderer.outputColorSpace = this.THREE.SRGBColorSpace;
    }

    this.renderer.domElement.className = "earthsonic-globe-canvas";
    this.container.appendChild(this.renderer.domElement);
  }

  _initControls() {
    if (!this.OrbitControls || !this.renderer) return;

    this.controls = new this.OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = this.options.minDistance;
    this.controls.maxDistance = this.options.maxDistance;
    this.controls.enablePan = false; // Keep globe centered
    this.controls.autoRotate = this.options.autoRotate;
    this.controls.autoRotateSpeed = this.options.autoRotateSpeed;
  }

  _initLighting() {
    // Deep space ambient fill
    this.ambientLight = new this.THREE.AmbientLight(0x0b132b, 0.25);
    this.scene.add(this.ambientLight);

    // Directional Sunlight
    const [sx, sy, sz] = this.options.sunPosition;
    this.sunLight = new this.THREE.DirectionalLight(0xffffff, 1.8);
    this.sunLight.position.set(sx, sy, sz);
    this.scene.add(this.sunLight);
  }

  _initCelestialHierarchy() {
    // Celestial pivot models Earth's 23.44° axial tilt relative to the ecliptic plane
    this.celestialPivot = new this.THREE.Group();
    this.celestialPivot.name = "CelestialPivot";
    this.celestialPivot.rotation.z = -AXIAL_TILT_RAD; // Axial tilt
    this.scene.add(this.celestialPivot);

    // Earth group spins around the tilted polar axis (Y-axis)
    this.earthGroup = new this.THREE.Group();
    this.earthGroup.name = "EarthGroup";
    this.celestialPivot.add(this.earthGroup);
  }

  _initStarfield() {
    if (!this.options.showStars) return;

    const count = 2200;
    const geometry = new this.THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      // Distribute stars on a distant sphere (R = 60 to 90)
      const r = 60.0 + Math.random() * 30.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2.0 * Math.random() - 1.0);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // Star color variation: subtle aerospace blue, warm solar white
      const c = 0.8 + Math.random() * 0.2;
      colors[i * 3] = c;
      colors[i * 3 + 1] = c * (0.9 + Math.random() * 0.1);
      colors[i * 3 + 2] = 1.0;

      // Reduce star size by 70%: 1.0px to 2.2px
      sizes[i] = 1.0 + Math.random() * 1.2;

      // Varied star opacity: 0.20 to 0.85
      opacities[i] = 0.20 + Math.random() * 0.65;
    }

    geometry.setAttribute('position', new this.THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new this.THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new this.THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aOpacity', new this.THREE.BufferAttribute(opacities, 1));

    const material = new this.THREE.ShaderMaterial({
      vertexShader: StarfieldShader.vertexShader,
      fragmentShader: StarfieldShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: this.THREE.AdditiveBlending,
      vertexColors: true
    });

    this.starfield = new this.THREE.Points(geometry, material);
    this.starfield.name = "DeepSpaceStarfield";
    this.scene.add(this.starfield);
  }

  _initGraticule() {
    const radius = 1.0008;
    const geometry = new this.THREE.BufferGeometry();
    const positions = [];

    // 1. Latitude parallels (every 15° from -75° to +75°)
    for (let lat = -75; lat <= 75; lat += 15) {
      const phi = (90.0 - lat) * (Math.PI / 180.0);
      const y = radius * Math.cos(phi);
      const r = radius * Math.sin(phi);
      const segments = 144;
      for (let i = 0; i < segments; i++) {
        const theta1 = (i / segments) * Math.PI * 2.0;
        const theta2 = ((i + 1) / segments) * Math.PI * 2.0;
        positions.push(
          -r * Math.cos(theta1), y, r * Math.sin(theta1),
          -r * Math.cos(theta2), y, r * Math.sin(theta2)
        );
      }
    }

    // 2. Longitude meridians (every 15° from -180° to 165°)
    for (let lon = -180; lon < 180; lon += 15) {
      const theta = (lon + 180.0) * (Math.PI / 180.0);
      const segments = 72;
      for (let i = 0; i < segments; i++) {
        const lat1 = -85.0 + (i / segments) * 170.0;
        const lat2 = -85.0 + ((i + 1) / segments) * 170.0;
        const phi1 = (90.0 - lat1) * (Math.PI / 180.0);
        const phi2 = (90.0 - lat2) * (Math.PI / 180.0);
        positions.push(
          -(radius * Math.sin(phi1) * Math.cos(theta)), radius * Math.cos(phi1), radius * Math.sin(phi1) * Math.sin(theta),
          -(radius * Math.sin(phi2) * Math.cos(theta)), radius * Math.cos(phi2), radius * Math.sin(phi2) * Math.sin(theta)
        );
      }
    }

    geometry.setAttribute('position', new this.THREE.Float32BufferAttribute(positions, 3));

    const material = new this.THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.06, // rgba(255, 255, 255, 0.06)
      depthWrite: false
    });

    this.graticuleMesh = new this.THREE.LineSegments(geometry, material);
    this.graticuleMesh.name = "Graticule15DegMesh";
    this.earthGroup.add(this.graticuleMesh);
  }

  async _loadAndBuildGlobe() {
    // 1. Load textures (with automatic procedural canvas fallback)
    this.textures = await loadEarthTextures(this.THREE, this.options.baseTexturePath);

    // 2. Earth Core Sphere with Day/Night Terminator Shader
    const coreGeo = new this.THREE.SphereGeometry(1.0, 96, 96);
    const [sx, sy, sz] = this.options.sunPosition;

    this.terminatorUniforms = {
      uSunPosition: { value: new this.THREE.Vector3(sx, sy, sz) },
      uDayMap: { value: this.textures.dayMap },
      uNightMap: { value: this.textures.nightMap },
      uSpecularMap: { value: this.textures.specularMap },
      uDayIntensity: { value: 1.1 },
      uNightIntensity: { value: 1.3 }
    };

    this.coreMaterial = new this.THREE.ShaderMaterial({
      uniforms: this.terminatorUniforms,
      vertexShader: TerminatorShader.vertexShader,
      fragmentShader: TerminatorShader.fragmentShader
    });

    this.earthCoreMesh = new this.THREE.Mesh(coreGeo, this.coreMaterial);
    this.earthCoreMesh.name = "EarthCoreMesh";
    this.earthGroup.add(this.earthCoreMesh);

    // 15-Degree Wireframe Graticule Overlay
    this._initGraticule();

    // 3. Atmospheric Cloud Layer (R = 1.008)
    if (this.options.showClouds && this.textures.cloudsMap) {
      const cloudGeo = new this.THREE.SphereGeometry(1.008, 64, 64);
      const cloudMat = new this.THREE.MeshStandardMaterial({
        map: this.textures.cloudsMap,
        transparent: true,
        opacity: 0.65,
        blending: this.THREE.AdditiveBlending,
        depthWrite: false
      });
      this.cloudMesh = new this.THREE.Mesh(cloudGeo, cloudMat);
      this.cloudMesh.name = "EarthCloudsMesh";
      this.earthGroup.add(this.cloudMesh);
    }

    // 4. Photorealistic Atmospheric Rim (R = 1.018 - subtle, zero neon)
    if (this.options.showAtmosphere) {
      const atmosGeo = new this.THREE.SphereGeometry(1.018, 64, 64);
      this.atmosUniforms = {
        uAtmosphereColor: { value: new this.THREE.Vector3(0.65, 0.70, 0.75) }, // Soft natural limb
        uGlowPower: { value: 4.0 },
        uGlowIntensity: { value: 0.35 }
      };

      this.atmosMaterial = new this.THREE.ShaderMaterial({
        uniforms: this.atmosUniforms,
        vertexShader: AtmosphereShader.vertexShader,
        fragmentShader: AtmosphereShader.fragmentShader,
        blending: this.THREE.AdditiveBlending,
        side: this.THREE.BackSide,
        transparent: true,
        depthWrite: false
      });

      this.atmosphereMesh = new this.THREE.Mesh(atmosGeo, this.atmosMaterial);
      this.atmosphereMesh.name = "AtmosphereHaloMesh";
      this.celestialPivot.add(this.atmosphereMesh);
    }

    // 5. Scientific Overlays Manager
    this.overlays = new OverlayManager(this.THREE, {
      specularTexture: this.textures.specularMap
    });
    if (this.overlays.temperature && this.textures.specularMap) {
      this.overlays.temperature.setSpecularMask(this.textures.specularMap);
    }
    this.earthGroup.add(this.overlays.rootGroup);

    // Start rendering loop if container exists
    if (this.container && !this.isRunning) {
      this.start();
    }

    return this;
  }

  _bindEvents() {
    this._onResize = this._handleResize.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onDblClick = this._handleDoubleClick.bind(this);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize);
    }
    // The stage is a grid cell: it changes size on a breakpoint or when a rail
    // reflows, not only on a window resize. Watching the container itself keeps
    // the canvas from being sized for a stale box (globe drawn off-centre).
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this._resizeObserver = new ResizeObserver(() => this._handleResize());
      this._resizeObserver.observe(this.container);
    }
    if (this.renderer) {
      this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
      this.renderer.domElement.addEventListener('dblclick', this._onDblClick);
    }
  }

  _handleResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / (height || 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  _handlePointerDown(event) {
    if (this.controls) {
      // Temporarily pause auto-rotate during user interaction
      this.controls.autoRotate = false;
    }
  }

  _handleDoubleClick(event) {
    if (!this.container || !this.earthCoreMesh) return;
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.earthCoreMesh);

    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      const { lat, lon } = this.vector3ToLatLon(hitPoint);
      this.flyTo(lat, lon, 2.0);
    } else {
      // Reset view to default
      this.resetView();
    }
  }

  /**
   * Convert 3D world vector back into Latitude and Longitude.
   */
  vector3ToLatLon(vec) {
    const v = vec.clone().normalize();
    const lat = 90.0 - Math.acos(Math.max(-1, Math.min(1, v.y))) * (180.0 / Math.PI);
    const lon = (Math.atan2(v.z, -v.x) * (180.0 / Math.PI)) - 180.0;
    const normalizedLon = ((lon + 180.0) % 360.0 + 360.0) % 360.0 - 180.0;
    return { lat, lon: normalizedLon };
  }

  /**
   * Smooth spherical fly-to navigation to geographic coordinates using 900ms cubic-bezier(0.22, 1, 0.36, 1) slerp.
   * @param {number} lat - Target latitude (-90 to +90)
   * @param {number} lon - Target longitude (-180 to +180)
   * @param {number} [distance=2.2] - Camera zoom distance
   * @param {number} [duration=0.9] - Transition duration in seconds (900ms default)
   */
  flyTo(lat, lon, distance = 2.2, duration = 0.9) {
    const targetDir = latLonToVector3(lat, lon, 1.0, this.THREE).normalize();
    const targetCamPos = targetDir.clone().multiplyScalar(distance);

    this.flyToStart = this.camera.position.clone();
    this.flyToTarget = targetCamPos;
    this.flyToProgress = 0.0;
    this.flyToDuration = duration || 0.9;

    if (this.controls) {
      this.controls.autoRotate = false;
    }
  }

  /**
   * Fly directly to Mauna Loa Observatory.
   */
  flyToMaunaLoa() {
    this.flyTo(MAUNA_LOA_COORDS.lat, MAUNA_LOA_COORDS.lon, 1.85, 0.9);
  }

  /**
   * Reset camera to default initial orbital view.
   */
  resetView() {
    this.flyToStart = this.camera.position.clone();
    this.flyToTarget = new this.THREE.Vector3(0, 0, this.options.initialDistance);
    this.flyToProgress = 0.0;
    this.flyToDuration = 1.2;
  }

  /**
   * Set active scientific overlay by dataset ID.
   * @param {string|null} datasetId - 'temperature', 'sea_ice', 'ocean', 'co2'
   */
  setActiveOverlay(datasetId) {
    if (this.overlays) {
      this.overlays.setActiveOverlay(datasetId);
    }
  }

  /**
   * Highlight specified overlays and attenuate non-selected overlays to 25% opacity.
   * @param {string|Array<string>|null} overlayIds 
   */
  highlightOverlay(overlayIds) {
    if (this.overlays) {
      this.overlays.highlightOverlay(overlayIds);
    }
  }

  /**
   * Reset visual-acoustic overlay highlighting back to normal.
   */
  resetHighlight() {
    if (this.overlays) {
      this.overlays.resetHighlight();
    }
  }

  /**
   * Update overlays with harmonized time series record and optional zonal record.
   * @param {Object} harmonizedRecord - { temperature_anomaly, co2_ppm, ocean_temp_anomaly, sea_ice_extent, normalized }
   * @param {Object} [zonalRecord] - Optional GISTEMP zonal record
   */
  updateData(harmonizedRecord, zonalRecord = null) {
    if (this.overlays) {
      this.overlays.updateFromRecord(harmonizedRecord, zonalRecord);
    }
  }

  /**
   * Set sunlight direction vector in space.
   */
  setSunPosition(x, y, z) {
    // An explicit sun wins over the presentation sun.
    this.options.sunFollowsCamera = false;
    this.sunLight.position.set(x, y, z);
    if (this.terminatorUniforms) {
      this.terminatorUniforms.uSunPosition.value.set(x, y, z);
    }
  }

  /**
   * Keep the day/night terminator on the limb of whatever view the camera has:
   * the sun sits ~49° to the left of the camera axis and slightly above it.
   */
  _updateSun() {
    if (!this.options.sunFollowsCamera || !this.terminatorUniforms || !this.camera) return;
    const THREE = this.THREE;
    const dir = this.camera.position.clone();
    if (dir.lengthSq() === 0) return;
    dir.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.85);
    dir.y += 0.32;
    dir.normalize().multiplyScalar(10);
    this.terminatorUniforms.uSunPosition.value.copy(dir);
    if (this.sunLight) this.sunLight.position.copy(dir);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this._loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  _loop() {
    if (!this.isRunning) return;
    this.animationFrameId = requestAnimationFrame(this._loop.bind(this));

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    this._update(delta, elapsedTime);
    this._render();
  }

  _update(delta, time) {
    // 1. Smooth Fly-to camera navigation with 900ms cubic-bezier(0.22, 1, 0.36, 1) slerp
    if (this.flyToTarget && this.flyToProgress < 1.0) {
      this.flyToProgress += delta / this.flyToDuration;
      const t = Math.min(1.0, this.flyToProgress);
      // Smooth cubic-bezier(0.22, 1, 0.36, 1) easing
      const ease = cubicBezierEase(t);
      slerpVectors(this.flyToStart, this.flyToTarget, ease, this.camera.position);
      this.camera.lookAt(0, 0, 0);

      if (t >= 1.0) {
        this.camera.position.copy(this.flyToTarget);
        this.camera.lookAt(0, 0, 0);
        this.flyToTarget = null;
        if (this.controls) {
          this.controls.target.set(0, 0, 0);
          this.controls.update();
        }
      }
    } else if (this.controls) {
      this.controls.update();
    }

    // 2. Earth diurnal rotation (subtle drift if auto-rotate is off)
    if (this.cloudMesh) {
      // Clouds rotate 15% faster than Earth surface to simulate atmospheric winds
      this.cloudMesh.rotation.y += delta * 0.02;
    }

    // 3. Presentation key light follows the camera
    this._updateSun();

    // 4. Scientific overlays animation tick
    if (this.overlays) {
      this.overlays.tick(delta, time);
    }
  }

  _render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    this.stop();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
    }
    if (this.renderer && this.renderer.domElement) {
      this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
      this.renderer.domElement.removeEventListener('dblclick', this._onDblClick);
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
      this.renderer.dispose();
    }
    if (this.controls) {
      this.controls.dispose();
    }
  }
}
