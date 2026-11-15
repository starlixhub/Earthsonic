/**
 * frontend/js/globe/layers.js
 * Master Registry for EARTHSONIC Scientific & Satellite Visual Overlays.
 *
 * Unifies the 4 climate time-series overlays with the 4 NASA SVS/EIC satellite layers:
 *   Climate:
 *     - temperature: Surface Temperature Anomaly (GISTEMP v4, zonal bands, opacity 0.14)
 *     - co2: Atmospheric CO2 (Mauna Loa Keeling curve, opacity 0.85)
 *     - ocean: Ocean Heat Content (NOAA NCEI, opacity 0.65)
 *     - sea_ice: Arctic Sea Ice Extent (NSIDC, opacity 0.80)
 *   Satellite:
 *     - night_lights: Black Marble Night Lights Change 2012 vs 2023 (NASA SVS 5218, opacity 0.80)
 *     - lightning: ISS Lightning Events 2017–2023 (NASA SVS 5122, opacity 0.85)
 *     - gedi_forest: GEDI Forest Canopy Height (NASA SVS 5088, opacity 0.75)
 *     - co2_dyamond: DYAMOND Global Carbon Dioxide (NASA SVS 5115, opacity 0.70)
 */

export const LAYER_REGISTRY = {
  temperature: {
    id: 'temperature',
    name: 'Surface Temperature Anomaly',
    category: 'climate',
    texture: null,
    overlayOpacity: 0.14,
    colormap: 'zonal_thermal',
    units: '°C anomaly',
    agency: 'NASA GISS / NOAA NCEI'
  },
  co2: {
    id: 'co2',
    name: 'Atmospheric CO2',
    category: 'climate',
    texture: null,
    overlayOpacity: 0.85,
    colormap: 'cyan_amber',
    units: 'ppm',
    agency: 'NOAA GML / NASA'
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean Heat Content',
    category: 'climate',
    texture: null,
    overlayOpacity: 0.65,
    colormap: 'thermal_waves',
    units: '10^22 J / °C',
    agency: 'NOAA NCEI / NASA PO.DAAC'
  },
  sea_ice: {
    id: 'sea_ice',
    name: 'Sea Ice Extent',
    category: 'climate',
    texture: null,
    overlayOpacity: 0.80,
    colormap: 'ice_extent',
    units: 'M km²',
    agency: 'NSIDC / NASA'
  },
  night_lights: {
    id: 'night_lights',
    name: 'Night Lights Change 2012 vs 2023',
    category: 'satellite',
    texture: '/assets/layers/night_lights.jpg',
    overlayOpacity: 0.80,
    colormap: 'bipolar_difference',
    units: 'relative radiance diff',
    agency: 'NASA SVS / EIC',
    svs_id: 5218
  },
  lightning: {
    id: 'lightning',
    name: 'ISS Lightning Events (2017–2023)',
    category: 'satellite',
    texture: '/assets/layers/lightning.jpg',
    overlayOpacity: 0.85,
    colormap: 'lightning_density',
    units: 'flashes / km² / yr',
    agency: 'NASA SVS / ISS LIS',
    svs_id: 5122
  },
  gedi_forest: {
    id: 'gedi_forest',
    name: 'GEDI Forest Canopy Height',
    category: 'satellite',
    texture: '/assets/layers/gedi_forest.jpg',
    overlayOpacity: 0.75,
    colormap: 'canopy_height',
    units: 'meters (canopy height)',
    agency: 'NASA SVS / GEDI',
    svs_id: 5088
  },
  co2_dyamond: {
    id: 'co2_dyamond',
    name: 'DYAMOND Global Carbon Dioxide',
    category: 'satellite',
    texture: '/assets/layers/co2_dyamond.jpg',
    overlayOpacity: 0.70,
    colormap: 'co2_density',
    units: 'ppm (3D simulated field)',
    agency: 'NASA SVS / GMAO',
    svs_id: 5115
  }
};

/**
 * Normalizes input ID and retrieves layer configuration.
 * @param {string} id - Layer identifier or alias
 * @returns {Object|null}
 */
export function getLayer(id) {
  if (!id) return null;
  const key = String(id).toLowerCase().trim();
  if (LAYER_REGISTRY[key]) return LAYER_REGISTRY[key];

  // Alias lookups
  if (key.includes('temp') && !key.includes('ocean')) return LAYER_REGISTRY.temperature;
  if (key.includes('co2_d') || key.includes('dyamond')) return LAYER_REGISTRY.co2_dyamond;
  if (key.includes('co2') || key.includes('carbon')) return LAYER_REGISTRY.co2;
  if (key.includes('ocean')) return LAYER_REGISTRY.ocean;
  if (key.includes('ice')) return LAYER_REGISTRY.sea_ice;
  if (key.includes('night') || key.includes('light_')) return LAYER_REGISTRY.night_lights;
  if (key.includes('lightning') || key.includes('flash')) return LAYER_REGISTRY.lightning;
  if (key.includes('gedi') || key.includes('forest') || key.includes('canopy')) return LAYER_REGISTRY.gedi_forest;

  return null;
}

/**
 * Returns all layer definitions.
 * @returns {Array<Object>}
 */
export function getAllLayers() {
  return Object.values(LAYER_REGISTRY);
}

/**
 * Filters layers by category ('climate' or 'satellite').
 * @param {string} category 
 * @returns {Array<Object>}
 */
export function getLayersByCategory(category) {
  if (!category) return getAllLayers();
  const cat = String(category).toLowerCase().trim();
  return Object.values(LAYER_REGISTRY).filter(layer => layer.category === cat);
}

/**
 * Registers or updates a layer configuration.
 * @param {Object} config - { id, name, category, texture, overlayOpacity, colormap, ... }
 */
export function registerLayer(config) {
  if (!config || !config.id) {
    throw new Error('Layer configuration must provide an id');
  }
  LAYER_REGISTRY[config.id] = {
    ...config,
    overlayOpacity: config.overlayOpacity !== undefined ? config.overlayOpacity : 0.8
  };
  return LAYER_REGISTRY[config.id];
}
