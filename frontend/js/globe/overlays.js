/**
 * frontend/js/globe/overlays.js
 * The 4 Scientific Data Visualization Overlays for EARTHSONIC:
 *   1. TemperatureOverlay: 14-latitude zonal thermal heatmap bands (GISTEMP)
 *   2. SeaIceOverlay: NSIDC extent as a data layer (no drawn polar caps)
 *   3. OceanThermalOverlay: Sea surface wave & thermal displacement shader (NOAA)
 *   4. CO2Overlay: Atmospheric particle cloud & Mauna Loa beacon (Keeling Curve)
 */

import { ZonalHeatmapShader, OceanThermalShader, CO2AtmosphereShader } from './shaders.js';
import { LAYER_REGISTRY, getLayer } from './layers.js';

// Mauna Loa Observatory exact coordinates
export const MAUNA_LOA_COORDS = {
  lat: 19.5362,
  lon: -155.5763,
  elevation_m: 3397,
  name: "Mauna Loa Observatory, Hawaii"
};

// 14 GISTEMP Zonal Bands
export const GISTEMP_BANDS = [
  "Glob", "NHem", "SHem",
  "24N-90N", "24S-24N", "90S-24S",
  "64N-90N", "44N-64N", "24N-44N", "EQU-24N",
  "24S-EQU", "44S-24S", "64S-44S", "90S-64S"
];

/**
 * Geographic helper: Convert (lat, lon) in degrees to 3D Cartesian Vector3
 */
export function latLonToVector3(lat, lon, radius, THREE) {
  const phi = (90.0 - lat) * (Math.PI / 180.0);
  const theta = (lon + 180.0) * (Math.PI / 180.0);

  const x = -(radius * Math.sin(phi) * Math.cos(theta));
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);

  return new THREE.Vector3(x, y, z);
}

/**
 * 1. Temperature Overlay
 * Displays 14-latitude band thermal coloration on 3D globe reflecting GISTEMP zonal data.
 * Blends at maximum 0.42 opacity (mix(earthColor, thermalColor, 0.42)) preserving sharp coastline contrast.
 */
export class TemperatureOverlay {
  constructor(THREE, radius = 1.002) {
    this.THREE = THREE;
    this.radius = radius;
    this.visible = false;
    // Zonal bands tint the Blue Marble. The ocean is dark, so a warm wash
    // reads as brown at much above ~0.15 and the globe stops looking like Earth.
    const tempConfig = getLayer('temperature');
    this.opacity = (tempConfig && tempConfig.overlayOpacity !== undefined) ? tempConfig.overlayOpacity : 0.14;
    this.bandAnomalies = new Float32Array(14).fill(0.0);

    const geometry = new THREE.SphereGeometry(this.radius, 64, 64);
    this.uniforms = {
      uBandAnomalies: { value: this.bandAnomalies },
      uOpacity: { value: this.opacity },
      uSpecularMask: { value: null }
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: ZonalHeatmapShader.vertexShader,
      fragmentShader: ZonalHeatmapShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "TemperatureHeatmapMesh";
    this.mesh.visible = this.visible;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.mesh.visible = this.visible;
  }

  setOpacity(opacity) {
    // Clamp to max 0.42 opacity
    this.opacity = Math.max(0.0, Math.min(0.42, opacity));
    this.uniforms.uOpacity.value = this.opacity;
  }

  setSpecularMask(texture) {
    if (this.uniforms.uSpecularMask) {
      this.uniforms.uSpecularMask.value = texture;
    }
  }

  /**
   * Update zonal heatmap using a GISTEMP record or band dictionary.
   * @param {Object} record - Record containing keys for bands: 'Glob', '64N-90N', etc.
   */
  updateData(record) {
    if (!record) return;
    for (let i = 0; i < GISTEMP_BANDS.length; i++) {
      const bandName = GISTEMP_BANDS[i];
      if (record[bandName] !== undefined && record[bandName] !== null) {
        this.bandAnomalies[i] = parseFloat(record[bandName]);
      }
    }
    this.uniforms.uBandAnomalies.value = this.bandAnomalies;
  }
}

/**
 * 2. Sea Ice Overlay
 * The NSIDC extent stays a data layer (telemetry, audio stem, button state)
 * but draws nothing on the globe. It used to add two spherical-cap domes at
 * r = 1.003: from the front they read as a big white disc floating over the
 * Arctic, from the night side they went black because a MeshStandardMaterial
 * has no light there, and the pair swept across the sphere as it rotated.
 * The Blue Marble already carries the real ice, so the caps were pure noise.
 */
export class SeaIceOverlay {
  constructor(THREE, radius = 1.003) {
    this.THREE = THREE;
    this.radius = radius;
    this.visible = false;
    this.group = new THREE.Group();
    this.group.name = "SeaIceOverlayGroup";
    this.group.visible = false;

    // No meshes: the group is kept so the overlay manager's show/hide contract
    // and the saved state bookkeeping stay intact.
    this.currentScale = 1.0;
    this.normalizedExtent = 0.8;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = false;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.0, Math.min(1.0, opacity));
  }

  /**
   * Track the measured extent. Nothing is drawn, so this only records value.
   * @param {number} normalizedExtent - Value from 0.0 (historic minimum) to 1.0 (historic maximum).
   */
  updateData(normalizedExtent) {
    const norm = Math.max(0.0, Math.min(1.0, normalizedExtent ?? 0.8));
    this.normalizedExtent = norm;
    this.currentScale = 0.60 + 0.40 * norm;
  }
}

/**
 * 3. Ocean Thermal Overlay
 * Animated sea surface wave shader reflecting global ocean thermal anomaly.
 */
export class OceanThermalOverlay {
  constructor(THREE, specularTexture = null, radius = 1.001) {
    this.THREE = THREE;
    this.radius = radius;
    this.visible = false;

    // Fallback specular mask if none provided
    const specMask = specularTexture || new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    specMask.needsUpdate = true;

    this.uniforms = {
      uTime: { value: 0.0 },
      uWaveHeight: { value: 0.0035 },
      uThermalAnomaly: { value: 0.5 }, // 0.0 = cold, 0.5 = neutral, 1.0 = warm
      uOpacity: { value: 0.65 },
      uSpecularMask: { value: specMask }
    };

    const geometry = new THREE.SphereGeometry(this.radius, 96, 96);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: OceanThermalShader.vertexShader,
      fragmentShader: OceanThermalShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "OceanThermalMesh";
    this.mesh.visible = this.visible;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.mesh.visible = this.visible;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.0, Math.min(1.0, opacity));
    if (this.uniforms && this.uniforms.uOpacity) {
      this.uniforms.uOpacity.value = this.opacity;
    }
  }

  setSpecularMask(texture) {
    if (texture) {
      this.uniforms.uSpecularMask.value = texture;
    }
  }

  /**
   * Update ocean thermal anomaly.
   * @param {number} normalizedAnomaly - Value [0.0 to 1.0]
   */
  updateData(normalizedAnomaly) {
    const val = Math.max(0.0, Math.min(1.0, normalizedAnomaly ?? 0.5));
    this.uniforms.uThermalAnomaly.value = val;
    // Increase wave intensity during higher thermal energy states
    this.uniforms.uWaveHeight.value = 0.0025 + 0.0030 * val;
  }

  tick(delta, time) {
    this.uniforms.uTime.value = time;
  }
}

/**
 * 4. Atmospheric CO2 Overlay
 * Smooth custom GLSL atmospheric halo mesh (BackSide sphere scaled to 1.06)
 * using Fresnel rim lighting (pow(1.0 - dot(vNormal, vViewPosition), 3.0))
 * that smoothly shifts color and thickness from thin cyan-blue (335 ppm) to dense amber-red haze (426+ ppm),
 * with pulsing telemetry beacon anchored at Mauna Loa Observatory.
 */
export class CO2Overlay {
  constructor(THREE, radius = 1.00) {
    this.THREE = THREE;
    this.radius = radius;
    this.visible = false;
    this.opacity = 0.85;
    this.group = new THREE.Group();
    this.group.name = "CO2OverlayGroup";
    this.group.visible = this.visible;

    this.co2Ppm = 335.0; // Baseline
    this.normalizedCO2 = 0.0;

    // --- Atmospheric CO2 Halo Envelope (Smooth BackSide sphere scaled to 1.06) ---
    const haloGeo = new THREE.SphereGeometry(this.radius, 64, 64);
    this.haloUniforms = {
      uColorLow: { value: new THREE.Vector3(0.0, 0.75, 1.0) },   // Thin cyan-blue (335 ppm)
      uColorHigh: { value: new THREE.Vector3(0.96, 0.28, 0.08) }, // Dense amber-red haze (426+ ppm)
      uCO2Norm: { value: 0.0 },
      uOpacity: { value: this.opacity }
    };

    this.haloMaterial = new THREE.ShaderMaterial({
      uniforms: this.haloUniforms,
      vertexShader: CO2AtmosphereShader.vertexShader,
      fragmentShader: CO2AtmosphereShader.fragmentShader,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    });

    this.haloMesh = new THREE.Mesh(haloGeo, this.haloMaterial);
    this.haloMesh.name = "CO2AtmosphereHaloMesh";
    this.haloMesh.scale.setScalar(1.06); // BackSide sphere scaled to 1.06
    this.group.add(this.haloMesh);

    // --- Mauna Loa Telemetry Beacon ---
    this.beaconGroup = new THREE.Group();
    this.beaconGroup.name = "MaunaLoaBeacon";

    const mloPos = latLonToVector3(MAUNA_LOA_COORDS.lat, MAUNA_LOA_COORDS.lon, this.radius, THREE);

    // Telemetry Pin Cylinder
    const pinGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.06, 12);
    pinGeo.translate(0, 0.03, 0); // Origin at base
    pinGeo.rotateX(Math.PI / 2);
    this.pinMaterial = new THREE.MeshBasicMaterial({ color: 0x00bfff });
    this.pinMesh = new THREE.Mesh(pinGeo, this.pinMaterial);
    this.pinMesh.position.copy(mloPos);
    this.pinMesh.lookAt(0, 0, 0);
    this.pinMesh.rotateX(Math.PI); // Point outward
    this.beaconGroup.add(this.pinMesh);

    // Pulsing Telemetry Ring
    const ringGeo = new THREE.RingGeometry(0.015, 0.022, 32);
    this.ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x00bfff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85
    });
    this.pulseRing = new THREE.Mesh(ringGeo, this.ringMaterial);
    this.pulseRing.position.copy(mloPos.clone().multiplyScalar(1.005));
    this.pulseRing.lookAt(0, 0, 0);
    this.beaconGroup.add(this.pulseRing);

    // Hot Core Dot
    const dotGeo = new THREE.SphereGeometry(0.01, 16, 16);
    this.dotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const dotMesh = new THREE.Mesh(dotGeo, this.dotMaterial);
    dotMesh.position.copy(mloPos.clone().multiplyScalar(1.05));
    this.beaconGroup.add(dotMesh);

    this.group.add(this.beaconGroup);
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.0, Math.min(1.0, opacity));
    if (this.haloUniforms) {
      this.haloUniforms.uOpacity.value = this.opacity;
    }
  }

  /**
   * Update CO2 values: alters atmospheric halo (cyan-blue 335 ppm -> amber-red 426+ ppm) and beacon intensity.
   * @param {number} ppm - Atmospheric CO2 in ppm (e.g. 335 to 426)
   * @param {number} normalized - Normalized value [0.0 to 1.0]
   */
  updateData(ppm, normalized) {
    if (ppm !== undefined && ppm !== null) this.co2Ppm = ppm;
    // Normalize CO2 smoothly from 335 ppm (early baseline) to 426+ ppm (modern record peak)
    this.normalizedCO2 = Math.max(0.0, Math.min(1.0, normalized !== undefined ? normalized : ((this.co2Ppm - 335.0) / (426.0 - 335.0))));
    const norm = this.normalizedCO2;

    if (this.haloUniforms) {
      this.haloUniforms.uCO2Norm.value = norm;
    }

    // Shift Mauna Loa beacon color to match atmospheric envelope
    const r = 0.0 * (1 - norm) + 0.96 * norm;
    const g = 0.75 * (1 - norm) + 0.28 * norm;
    const b = 1.0 * (1 - norm) + 0.08 * norm;
    this.pinMaterial.color.setRGB(r, g, b);
    this.ringMaterial.color.setRGB(r, g, b);
  }

  tick(delta, time) {
    if (!this.visible) return;
    // Pulse Mauna Loa beacon ring
    if (this.pulseRing) {
      const pulseFactor = 0.6 + 0.4 * Math.sin(time * 3.5);
      const ringScale = 0.9 + 0.6 * ((time * 0.8) % 1.0);
      this.pulseRing.scale.set(ringScale, ringScale, 1.0);
      this.ringMaterial.opacity = (1.0 - ((time * 0.8) % 1.0)) * pulseFactor;
    }
  }
}

/**
 * 5. Satellite Textured Overlay
 * Renders high-resolution satellite imagery on a spherical Three.js mesh (radius 1.002).
 * Supports Night Lights A/B cross-fade blending between 2012 and 2023 textures.
 */
export class SatelliteTexturedOverlay {
  constructor(THREE, layerConfig, radius = 1.002) {
    this.THREE = THREE;
    this.id = layerConfig.id;
    this.radius = radius;
    this.visible = false;
    this.baseOpacity = layerConfig.overlayOpacity !== undefined ? layerConfig.overlayOpacity : 0.8;
    this.opacity = this.baseOpacity;
    this._abBlend = 0.5;

    this.group = new THREE.Group();
    this.group.name = `SatelliteOverlayGroup_${this.id}`;

    const geometry = new THREE.SphereGeometry(this.radius, 64, 64);
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: this.opacity,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = `SatelliteOverlayMesh_${this.id}`;
    this.group.add(this.mesh);

    // If night lights, setup dual meshes for 2012 and 2023 cross-fade
    if (this.id === 'night_lights') {
      this.material2012 = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: this.baseOpacity * 0.5,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      this.mesh2012 = new THREE.Mesh(geometry, this.material2012);
      this.mesh2012.name = "NightLights2012Mesh";

      this.material2023 = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: this.baseOpacity * 0.5,
        depthWrite: false,
        blending: THREE.NormalBlending
      });
      this.mesh2023 = new THREE.Mesh(geometry, this.material2023);
      this.mesh2023.name = "NightLights2023Mesh";

      this.group.remove(this.mesh);
      this.group.add(this.mesh2012);
      this.group.add(this.mesh2023);
    }

    if (typeof THREE.TextureLoader === 'function') {
      const loader = new THREE.TextureLoader();
      if (layerConfig.texture && this.id !== 'night_lights') {
        loader.load(layerConfig.texture, (tex) => {
          this.material.map = tex;
          this.material.needsUpdate = true;
        });
      } else if (this.id === 'night_lights') {
        loader.load('/assets/layers/night_lights_2012.jpg', (tex) => {
          this.material2012.map = tex;
          this.material2012.needsUpdate = true;
        });
        loader.load('/assets/layers/night_lights_2023.jpg', (tex) => {
          this.material2023.map = tex;
          this.material2023.needsUpdate = true;
        });
      }
    }

    this.group.visible = this.visible;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.group.visible = this.visible;
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.0, Math.min(1.0, opacity));
    if (this.material) this.material.opacity = this.opacity;
    if (this.material2012 && this.material2023) {
      this.material2012.opacity = this.opacity * (1.0 - this._abBlend);
      this.material2023.opacity = this.opacity * this._abBlend;
    }
  }

  setABBlend(blendRatio) {
    this._abBlend = Math.max(0.0, Math.min(1.0, Number(blendRatio) || 0));
    if (this.material2012 && this.material2023) {
      this.material2012.opacity = this.opacity * (1.0 - this._abBlend);
      this.material2023.opacity = this.opacity * this._abBlend;
    }
  }
}

/**
 * OverlayManager
 * Master coordinator managing all 4 scientific overlays in the Three.js scene.
 */
export class OverlayManager {
  constructor(THREE, options = {}) {
    this.THREE = THREE;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = "ScientificOverlayGroup";

    // Initialize all 4 overlays
    this.temperature = new TemperatureOverlay(THREE, 1.002);
    this.seaIce = new SeaIceOverlay(THREE, 1.003);
    this.ocean = new OceanThermalOverlay(THREE, options.specularTexture, 1.001);
    this.co2 = new CO2Overlay(THREE, 1.00);

    // Attach meshes to root group
    this.rootGroup.add(this.temperature.mesh);
    this.rootGroup.add(this.seaIce.group);
    this.rootGroup.add(this.ocean.mesh);
    this.rootGroup.add(this.co2.group);

    // Initialize satellite overlays
    this.satelliteOverlays = new Map();
    const satConfigs = [
      getLayer('night_lights'),
      getLayer('lightning'),
      getLayer('gedi_forest'),
      getLayer('co2_dyamond')
    ];
    for (const cfg of satConfigs) {
      if (cfg) {
        const satOverlay = new SatelliteTexturedOverlay(THREE, cfg, 1.002);
        this.satelliteOverlays.set(cfg.id, satOverlay);
        this.rootGroup.add(satOverlay.group);
      }
    }

    // Active overlay tracking
    this.activeOverlayId = null;
  }

  /**
   * Set active overlay by dataset ID or alias.
   * Can also show all overlays or multiple overlays.
   * @param {string|null} datasetId - e.g. 'global_surface_temperature', 'sea_ice_extent', etc.
   */
  setActiveOverlay(datasetId) {
    this.activeOverlayId = datasetId;

    if (!datasetId) {
      this.temperature.setVisible(false);
      this.seaIce.setVisible(false);
      this.ocean.setVisible(false);
      this.co2.setVisible(false);
      for (const sat of this.satelliteOverlays.values()) {
        sat.setVisible(false);
      }
      return;
    }

    const id = datasetId.toLowerCase();

    // Check if matching any satellite overlay
    let matchedSat = null;
    for (const [satId, satOverlay] of this.satelliteOverlays.entries()) {
      const isMatch = (id === satId) ||
        (satId === 'night_lights' && id.includes('night')) ||
        (satId === 'lightning' && id.includes('lightning')) ||
        (satId === 'gedi_forest' && (id.includes('gedi') || id.includes('forest') || id.includes('canopy'))) ||
        (satId === 'co2_dyamond' && (id.includes('dyamond') || (id.includes('co2') && id.includes('sat'))));

      if (isMatch) {
        matchedSat = satId;
        satOverlay.setVisible(true);
      } else {
        satOverlay.setVisible(false);
      }
    }

    if (matchedSat) {
      this.temperature.setVisible(false);
      this.seaIce.setVisible(false);
      this.ocean.setVisible(false);
      this.co2.setVisible(false);
      return;
    }

    // Climate overlays
    this.temperature.setVisible(id.includes('temp') && !id.includes('ocean'));
    this.seaIce.setVisible(id.includes('ice'));
    this.ocean.setVisible(id.includes('ocean'));
    this.co2.setVisible((id.includes('co2') || id.includes('carbon')) && !id.includes('dyamond'));
  }

  /**
   * Show/hide all overlays simultaneously.
   */
  setAllVisible(visible) {
    this.temperature.setVisible(visible);
    this.seaIce.setVisible(visible);
    this.ocean.setVisible(visible);
    this.co2.setVisible(visible);
    for (const sat of this.satelliteOverlays.values()) {
      sat.setVisible(visible);
    }
  }

  getSatelliteOverlay(id) {
    return this.satelliteOverlays.get(id) || null;
  }

  setNightLightsBlend(ratio) {
    const nl = this.satelliteOverlays.get('night_lights');
    if (nl && typeof nl.setABBlend === 'function') {
      nl.setABBlend(ratio);
    }
  }

  triggerLightningFlash(lat, lon, intensity = 1.0) {
    if (!this.lightningSpriteGroup) {
      this.lightningSpriteGroup = new this.THREE.Group();
      this.lightningSpriteGroup.name = "LightningFlashGroup";
      this.rootGroup.add(this.lightningSpriteGroup);
    }
    const pos = latLonToVector3(lat, lon, 1.006, this.THREE);
    const flashGeom = new this.THREE.BufferGeometry();
    flashGeom.setAttribute('position', new this.THREE.Float32BufferAttribute([pos.x, pos.y, pos.z], 3));
    const flashMat = new this.THREE.PointsMaterial({
      color: 0xffffff,
      size: 16 * Math.max(0.4, intensity),
      transparent: true,
      opacity: 1.0,
      blending: this.THREE.AdditiveBlending,
      depthWrite: false
    });
    const flashPoint = new this.THREE.Points(flashGeom, flashMat);
    this.lightningSpriteGroup.add(flashPoint);

    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const fade = () => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const elapsed = now - startTime;
      const progress = elapsed / 250;
      if (progress >= 1.0) {
        this.lightningSpriteGroup.remove(flashPoint);
        flashGeom.dispose();
        flashMat.dispose();
      } else {
        flashMat.opacity = 1.0 - progress;
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(fade);
        }
      }
    };
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(fade);
    }
  }

  /**
   * Update all overlays from harmonized multi-track record.
   * @param {Object} harmonizedRecord - { temperature_anomaly, co2_ppm, ocean_temp_anomaly, sea_ice_extent, normalized }
   * @param {Object} [zonalRecord] - Optional GISTEMP zonal record
   */
  updateFromRecord(harmonizedRecord, zonalRecord = null) {
    if (!harmonizedRecord) return;

    // 1. Temperature: update zonal if available, or broadcast global anomaly
    if (zonalRecord) {
      this.temperature.updateData(zonalRecord);
    } else if (harmonizedRecord.temperature_anomaly !== undefined) {
      const glob = harmonizedRecord.temperature_anomaly;
      const mockZonal = { Glob: glob };
      for (const b of GISTEMP_BANDS) mockZonal[b] = glob;
      this.temperature.updateData(mockZonal);
    }

    // 2. Sea Ice
    const iceNorm = harmonizedRecord.normalized?.sea_ice_extent ??
      (harmonizedRecord.sea_ice_extent ? (harmonizedRecord.sea_ice_extent - 3.5) / (7.8 - 3.5) : 0.8);
    this.seaIce.updateData(iceNorm);

    // 3. Ocean Thermal
    const oceanNorm = harmonizedRecord.normalized?.ocean_temp ??
      (harmonizedRecord.ocean_temp_anomaly ? (harmonizedRecord.ocean_temp_anomaly + 0.6) / 1.8 : 0.5);
    this.ocean.updateData(oceanNorm);

    // 4. CO2
    const co2Ppm = harmonizedRecord.co2_ppm ?? 380.0;
    const co2Norm = harmonizedRecord.normalized?.co2 ?? ((co2Ppm - 312.0) / (435.0 - 312.0));
    this.co2.updateData(co2Ppm, co2Norm);
  }

  tick(delta, time) {
    if (this.ocean.visible) {
      this.ocean.tick(delta, time);
    }
    if (this.co2.visible) {
      this.co2.tick(delta, time);
    }
  }

  /**
   * Highlight specified overlays and attenuate non-selected overlays to 25% opacity.
   * Visual-Acoustic Coupling for Solo states and Channel Strip hovering.
   * @param {string|Array<string>|null} overlayIds - Overlay ID or list of IDs
   */
  highlightOverlay(overlayIds) {
    if (!overlayIds || (Array.isArray(overlayIds) && overlayIds.length === 0)) {
      this.resetHighlight();
      return;
    }

    if (!this._isHighlighted) {
      this._savedState = {
        temperature: this.temperature.visible,
        seaIce: this.seaIce.visible,
        ocean: this.ocean.visible,
        co2: this.co2.visible
      };
      this._isHighlighted = true;
    }

    const ids = Array.isArray(overlayIds) ? overlayIds : [overlayIds];
    const normalized = ids.map(id => {
      const s = String(id).toLowerCase();
      if (s.includes('temp') && !s.includes('ocean')) return 'temperature';
      if (s.includes('co2') || s.includes('carbon')) return 'co2';
      if (s.includes('ocean')) return 'ocean';
      if (s.includes('ice')) return 'seaIce';
      return s;
    });

    const isSel = (key) => normalized.includes(key);

    // Make all overlays visible so user sees the highlighted vs attenuated relationship
    this.temperature.setVisible(true);
    this.seaIce.setVisible(true);
    this.ocean.setVisible(true);
    this.co2.setVisible(true);

    // Set opacities: 100% baseline for selected, 25% attenuated for non-selected
    this.temperature.setOpacity(isSel('temperature') ? 0.42 : 0.42 * 0.25);
    this.seaIce.setOpacity(isSel('seaIce') ? 0.92 : 0.92 * 0.25);
    this.ocean.setOpacity(isSel('ocean') ? 0.65 : 0.65 * 0.25);
    this.co2.setOpacity(isSel('co2') ? 0.75 : 0.75 * 0.25);
  }

  /**
   * Reset highlight state back to normal opacities and previous layer visibility.
   */
  resetHighlight() {
    if (!this._isHighlighted) return;
    this._isHighlighted = false;

    // Restore baseline opacities
    this.temperature.setOpacity(0.42);
    this.seaIce.setOpacity(0.92);
    this.ocean.setOpacity(0.65);
    this.co2.setOpacity(0.75);

    // Restore previous visibility
    if (this._savedState) {
      this.temperature.setVisible(this._savedState.temperature);
      this.seaIce.setVisible(this._savedState.seaIce);
      this.ocean.setVisible(this._savedState.ocean);
      this.co2.setVisible(this._savedState.co2);
    } else {
      this.setActiveOverlay(this.activeOverlayId);
    }
  }
}
