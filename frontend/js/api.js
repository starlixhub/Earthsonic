/**
 * frontend/js/api.js
 * REST client for NASA Earth Science Observation APIs.
 * Interfaces with EARTHSONIC backend:
 *   - GET /api/datasets
 *   - GET /api/datasets/<id>
 *   - GET /api/timeseries/<id>
 *   - GET /api/timeseries/harmonized
 *   - GET /api/timeseries/zonal
 */

const API_BASE = '';

// In-memory cache for API responses
const cache = new Map();

/**
 * Helper to fetch with caching and error handling.
 */
async function fetchCachedJson(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const cacheKey = `${url}?${JSON.stringify(options)}`;

  if (cache.has(cacheKey) && !options.forceReload) {
    return cache.get(cacheKey);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
    }
    const data = await res.json();
    cache.set(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`[EarthSonic API] Request failed for ${url}:`, err.message);
    throw err;
  }
}

/**
 * Fetch list of all available NASA datasets with metadata.
 * @returns {Promise<Array>} Array of dataset metadata objects.
 */
export async function getDatasets() {
  const data = await fetchCachedJson('/api/datasets');
  return data.datasets || [];
}

/**
 * Fetch detailed metadata for a specific dataset ID.
 * @param {string} datasetId 
 * @returns {Promise<Object>} Dataset metadata.
 */
export async function getDataset(datasetId) {
  const data = await fetchCachedJson(`/api/datasets/${encodeURIComponent(datasetId)}`);
  return data.dataset || data;
}

/**
 * Fetch time series data for a specific dataset.
 * @param {string} datasetId 
 * @param {Object} [params] - { start, end, resolution }
 * @returns {Promise<Object>} Time series payload { dataset_id, units, records, data }
 */
export async function getTimeSeries(datasetId, params = {}) {
  const query = new URLSearchParams();
  if (params.start) query.set('start', params.start);
  if (params.end) query.set('end', params.end);
  if (params.resolution) query.set('resolution', params.resolution);

  const qs = query.toString();
  const endpoint = `/api/timeseries/${encodeURIComponent(datasetId)}${qs ? '?' + qs : ''}`;
  return fetchCachedJson(endpoint);
}

/**
 * Fetch harmonized multi-track time series covering all 4 core variables.
 * @param {Object} [params] - { start, end }
 * @returns {Promise<Object>} Harmonized time series payload.
 */
export async function getHarmonizedTimeSeries(params = {}) {
  const query = new URLSearchParams();
  if (params.start) query.set('start', params.start);
  if (params.end) query.set('end', params.end);

  const qs = query.toString();
  const endpoint = `/api/timeseries/harmonized${qs ? '?' + qs : ''}`;
  return fetchCachedJson(endpoint);
}

/**
 * Fetch annual zonal temperature anomalies across 14 latitude bands (GISTEMP).
 * @param {Object} [params] - { start, end } (e.g. 1950, 2024)
 * @returns {Promise<Object>} Zonal data { bands, records, count }
 */
export async function getZonalTimeSeries(params = {}) {
  const query = new URLSearchParams();
  if (params.start) query.set('start', params.start);
  if (params.end) query.set('end', params.end);

  const qs = query.toString();
  const endpoint = `/api/timeseries/zonal${qs ? '?' + qs : ''}`;
  return fetchCachedJson(endpoint);
}

/**
 * Find closest record in time series by YYYY-MM or YYYY.
 * @param {Array} records - Array of records with date or year
 * @param {string|number} targetDate - e.g. "2005-06" or 2005
 * @returns {Object|null}
 */
export function findRecordByDate(records, targetDate) {
  if (!records || !records.length) return null;
  const targetStr = String(targetDate);

  // Exact match
  const exact = records.find(r => r.date === targetStr || String(r.year) === targetStr);
  if (exact) return exact;

  // Prefix match (e.g. "2005" matches "2005-01")
  const prefixMatch = records.find(r => (r.date && r.date.startsWith(targetStr)) || String(r.year) === targetStr);
  if (prefixMatch) return prefixMatch;

  // Find chronologically closest
  let closest = records[0];
  let minDiff = Infinity;
  const targetVal = parseDateToFloat(targetStr);

  for (const r of records) {
    const rVal = parseDateToFloat(r.date || String(r.year));
    const diff = Math.abs(rVal - targetVal);
    if (diff < minDiff) {
      minDiff = diff;
      closest = r;
    }
  }
  return closest;
}

function parseDateToFloat(str) {
  if (!str) return 0;
  if (str.includes('-')) {
    const [y, m] = str.split('-').map(Number);
    return y + (m - 1) / 12.0;
  }
  return parseFloat(str) || 0;
}

/**
 * Fetch comparative analysis between two distinct historical periods.
 * @param {string} datasetId - e.g. "surface-temperature"
 * @param {string} periodA - e.g. "1980-01,1990-12"
 * @param {string} periodB - e.g. "2010-01,2020-12"
 * @param {number} [duration=15.0] - audio length in seconds
 * @returns {Promise<Object>} Comparison payload { periodA, periodB, difference }
 */
export async function getComparison(datasetId, periodA, periodB, duration = 15.0) {
  const query = new URLSearchParams({
    dataset_id: datasetId,
    periodA: periodA,
    periodB: periodB,
    duration: String(duration)
  });
  const endpoint = `/api/comparison?${query.toString()}`;
  return fetchCachedJson(endpoint);
}

/**
 * Fetch detailed mathematical and musical sonification explanations.
 * @param {string} [datasetId] - Optional dataset ID filter
 * @returns {Promise<Object>} Sonification explanations catalog or single layer
 */
export async function getSonificationExplanations(datasetId = null) {
  const endpoint = datasetId
    ? `/api/sonification/explanations?dataset_id=${encodeURIComponent(datasetId)}`
    : '/api/sonification/explanations';
  return fetchCachedJson(endpoint);
}
