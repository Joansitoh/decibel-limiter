/** Meter / ceiling number helpers shared by popup UI. */

export const METER_MIN_DB = -60;
export const METER_MAX_DB = 0;

export const clampDB = n => Math.max(METER_MIN_DB, Math.min(METER_MAX_DB, n));
export const dbToFrac = n => (clampDB(n) - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);

export const fmtDB = (n, unit = '') => {
  if (n === null || n === undefined || !isFinite(n)) return unit ? `−∞ ${unit}`.trim() : '−∞';
  const s = `${Math.round(n * 10) / 10}`.replace('-', '−');
  return unit ? `${s} ${unit}` : s;
};
