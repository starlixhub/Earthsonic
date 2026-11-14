/**
 * frontend/js/globe/vr/vr_timeline.js
 * Harmonized Climate Dataset Timeline & Monthly Indexing / Record Interpolation.
 * Requirements R2, R3, R4 & Milestone M2.
 *
 * Dedicated module for timeline parameterization, month-indexing, and
 * climate record interpolation across the 573-month dataset (Jan 1979 - Sep 2026).
 * Decoupled from 3D spline and camera-path math.
 */

export const TOTAL_MONTHS = 573; // Jan 1979 to Sep 2026

/**
 * Maps a normalized timeline progress t in [0.0, 1.0] to a continuous or discrete month index.
 * @param {number} t - Timeline progress parameter in [0.0, 1.0]
 * @param {number} [totalMonths=TOTAL_MONTHS] - Total monthly records in timeline
 * @returns {number} Integer month index in [0, totalMonths - 1]
 */
export function timelineToMonthIndex(t, totalMonths = TOTAL_MONTHS) {
  const clampedT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));
  return Math.round(clampedT * (totalMonths - 1));
}

/**
 * Maps a discrete month index to a normalized timeline parameter t in [0.0, 1.0].
 * @param {number} index - Month index in [0, totalMonths - 1]
 * @param {number} [totalMonths=TOTAL_MONTHS] - Total monthly records in timeline
 * @returns {number} Normalized timeline progress t in [0.0, 1.0]
 */
export function monthIndexToTimeline(index, totalMonths = TOTAL_MONTHS) {
  if (totalMonths <= 1) return 0.0;
  const clampedIdx = Math.max(0, Math.min(totalMonths - 1, Number(index) || 0));
  return clampedIdx / (totalMonths - 1);
}

/**
 * Calculates fractional annual progress (0.0 to 1.0) for seasonal solar declination cycles.
 * @param {number} t - Timeline progress parameter in [0.0, 1.0]
 * @param {number} [totalMonths=TOTAL_MONTHS] - Total monthly records in timeline
 * @returns {number} Fractional year progress in [0.0, 1.0)
 */
export function timelineToYearFraction(t, totalMonths = TOTAL_MONTHS) {
  const clampedT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));
  const totalYears = (totalMonths - 1) / 12.0;
  return (clampedT * totalYears) % 1.0;
}

/**
 * Linearly interpolates harmonized climate records for timeline parameter t in [0.0, 1.0].
 * Safely clamps inputs and handles boundary, empty, or hostile arguments.
 *
 * @param {Array<Object>} records - 573 harmonized monthly records
 * @param {number} t - Timeline parameter in [0.0, 1.0]
 * @returns {Object} Interpolated climate record
 */
export function interpolateHarmonizedRecord(records, t) {
  if (!records || records.length === 0) {
    return {
      date: '1979-01',
      temperature_anomaly: 0.08,
      co2_ppm: 336.14,
      ocean_temp_anomaly: 0.25,
      sea_ice_extent: 15.41,
      normalized_temperature: 0.0,
      normalized_co2: 0.0,
      normalized_ocean_temp: 0.47,
      normalized_sea_ice_extent: 0.91
    };
  }

  const clampedT = Math.max(0.0, Math.min(1.0, Number(t) || 0.0));
  const count = records.length;
  const floatIdx = clampedT * (count - 1);
  const idx = Math.floor(floatIdx);
  const frac = floatIdx - idx;
  const nextIdx = Math.min(count - 1, idx + 1);

  const r1 = records[idx];
  const r2 = records[nextIdx];

  const lerp = (a, b) => (1.0 - frac) * (a !== undefined ? a : 0) + frac * (b !== undefined ? b : 0);

  return {
    date: frac < 0.5 ? r1.date : r2.date,
    year: frac < 0.5 ? r1.year : r2.year,
    month: frac < 0.5 ? r1.month : r2.month,
    temperature_anomaly: lerp(r1.temperature_anomaly, r2.temperature_anomaly),
    co2_ppm: lerp(r1.co2_ppm, r2.co2_ppm),
    ocean_temp_anomaly: lerp(r1.ocean_temp_anomaly, r2.ocean_temp_anomaly),
    sea_ice_extent: lerp(r1.sea_ice_extent, r2.sea_ice_extent),
    normalized_temperature: lerp(r1.normalized_temperature, r2.normalized_temperature),
    normalized_co2: lerp(r1.normalized_co2, r2.normalized_co2),
    normalized_ocean_temp: lerp(r1.normalized_ocean_temp, r2.normalized_ocean_temp),
    normalized_sea_ice_extent: lerp(r1.normalized_sea_ice_extent, r2.normalized_sea_ice_extent)
  };
}
