// Position projection.
//
// Data arrives every 12 seconds. Left alone, aircraft would sit still and then
// jump. Instead we project each aircraft forward from its last known heading
// and ground speed, so the marker keeps moving between polls.

const EARTH_RADIUS_NM = 3440.065;
const DEG = Math.PI / 180;

/**
 * Project a position forward along a constant heading.
 *
 * @param {number} lat      degrees
 * @param {number} lon      degrees
 * @param {number} headingDeg  degrees clockwise from true north
 * @param {number} speedKt  ground speed in knots (nautical miles per hour)
 * @param {number} seconds  how far ahead to project
 * @returns {{lat: number, lon: number}}
 */
export function project(lat, lon, headingDeg, speedKt, seconds) {
  if (!speedKt || !Number.isFinite(headingDeg) || seconds <= 0) {
    return { lat, lon };
  }

  const distanceNm = (speedKt * seconds) / 3600;
  const angularDistance = distanceNm / EARTH_RADIUS_NM;

  const lat1 = lat * DEG;
  const lon1 = lon * DEG;
  const bearing = headingDeg * DEG;

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing);
  const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)));

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: lat2 / DEG,
    lon: normaliseLongitude(lon2 / DEG),
  };
}

function normaliseLongitude(lon) {
  return ((lon + 540) % 360) - 180;
}

/**
 * How much of the old prediction error still applies.
 *
 * When real data arrives it rarely matches the prediction exactly. Snapping
 * straight to the new position looks like a twitch, so the error is faded to
 * zero over a short window and the aircraft slides into place.
 */
export function decayFactor(elapsedMs, windowMs = 1500) {
  if (elapsedMs >= windowMs) return 0;
  const t = 1 - elapsedMs / windowMs;
  return t * t; // ease out: fast at first, gentle at the end
}
