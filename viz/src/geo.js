// geo.js -- shared coordinate contract for the evidence-evaluation viz.
//
// Every module (map data, engine, rendering) composes against this file.
//
// Display plane: azimuthal equidistant projection centered on CENTER.
//   x = km east of center, y = km north of center.
//   Domain: x, y in [-HALF_EXTENT, +HALF_EXTENT] (~2,500 x 2,500 km,
//   UK through western Russia).
//
// Distances that feed the model (anchor-to-cell, anchor-to-truth) are ALWAYS
// great-circle via haversineKm on the sphere -- the projection is for display
// and grid layout only, never for physics.

export const R_EARTH = 6371; // km, mean Earth radius
export const CENTER = { lat: 54, lon: 13 };
export const HALF_EXTENT = 1300; // km (domain sized so AWS Dublin and St Petersburg both fit)

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

// Great-circle distance in km between {lat, lon} points (degrees).
export function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

// {lat, lon} degrees -> {x, y} km on the display plane.
export function project(lat, lon) {
  const phi = lat * RAD;
  const lam = (lon - CENTER.lon) * RAD;
  const phi0 = CENTER.lat * RAD;
  const cosC =
    Math.sin(phi0) * Math.sin(phi) +
    Math.cos(phi0) * Math.cos(phi) * Math.cos(lam);
  const c = Math.acos(Math.min(1, Math.max(-1, cosC)));
  const k = c === 0 ? 1 : c / Math.sin(c);
  return {
    x: R_EARTH * k * Math.cos(phi) * Math.sin(lam),
    y:
      R_EARTH *
      k *
      (Math.cos(phi0) * Math.sin(phi) -
        Math.sin(phi0) * Math.cos(phi) * Math.cos(lam)),
  };
}

// {x, y} km -> {lat, lon} degrees. Inverse of project.
export function unproject(x, y) {
  const rho = Math.hypot(x, y);
  if (rho === 0) return { lat: CENTER.lat, lon: CENTER.lon };
  const c = rho / R_EARTH;
  const phi0 = CENTER.lat * RAD;
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const lat = Math.asin(cosC * Math.sin(phi0) + (y * sinC * Math.cos(phi0)) / rho);
  const lon =
    CENTER.lon * RAD +
    Math.atan2(x * sinC, rho * Math.cos(phi0) * cosC - y * Math.sin(phi0) * sinC);
  return { lat: lat * DEG, lon: lon * DEG };
}
