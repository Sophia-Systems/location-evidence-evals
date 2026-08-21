// geo.js -- shared coordinate contract for the evidence-evaluation viz.
//
// Every module (map data, engine, rendering) composes against this file.
//
// Window plane (the model's hypothesis space): azimuthal equidistant
// projection centered on a movable WINDOW CENTER (default CENTER, 54N 13E).
//   x = km east of center, y = km north of center.
//   Domain: x, y in [-HALF_EXTENT, +HALF_EXTENT] (~3,600 x 3,600 km).
// The window is where the posterior grid lives -- the "region under
// evaluation" -- decoupled from the display, which since v2 is a global
// Web Mercator map. projectAt/unprojectAt take the window center explicitly;
// the CENTER-bound project/unproject wrappers keep the v1 contract (and the
// map-data generation pipeline) working unchanged.
//
// Distances that feed the model (anchor-to-cell, anchor-to-truth) are ALWAYS
// great-circle via haversineKm on the sphere -- the projection is for grid
// layout only, never for physics.

export const R_EARTH = 6371; // km, mean Earth radius
export const CENTER = { lat: 54, lon: 13 };
// Window sized comfortably larger than any preset's anchor spread (Cambridge
// to Helsinki is ~1,760 km), so the default view can frame every staged
// anchor while still sitting strictly inside the window -- see DECISIONS.md
// item 42. AWS Dublin and St Petersburg both fit with room to spare.
export const HALF_EXTENT = 1800; // km

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

// {lat, lon} degrees -> {x, y} km on the window plane centered on `center`.
export function projectAt(center, lat, lon) {
  const phi = lat * RAD;
  const lam = (lon - center.lon) * RAD;
  const phi0 = center.lat * RAD;
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

// Great-circle destination: from {lat, lon} (degrees), travel distKm along
// initial bearing bearingDeg (0 = north, clockwise). Used to draw exclusion
// circles as true great-circle loci rather than projected-plane circles.
export function destination(lat, lon, bearingDeg, distKm) {
  const phi1 = lat * RAD;
  const lam1 = lon * RAD;
  const theta = bearingDeg * RAD;
  const d = distKm / R_EARTH;
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(d) + Math.cos(phi1) * Math.sin(d) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const lam2 =
    lam1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(d) * Math.cos(phi1),
      Math.cos(d) - Math.sin(phi1) * sinPhi2
    );
  return { lat: phi2 * DEG, lon: ((lam2 * DEG + 540) % 360) - 180 };
}

// {x, y} km -> {lat, lon} degrees. Inverse of projectAt.
export function unprojectAt(center, x, y) {
  const rho = Math.hypot(x, y);
  if (rho === 0) return { lat: center.lat, lon: center.lon };
  const c = rho / R_EARTH;
  const phi0 = center.lat * RAD;
  const sinC = Math.sin(c);
  const cosC = Math.cos(c);
  const lat = Math.asin(cosC * Math.sin(phi0) + (y * sinC * Math.cos(phi0)) / rho);
  const lon =
    center.lon * RAD +
    Math.atan2(x * sinC, rho * Math.cos(phi0) * cosC - y * Math.sin(phi0) * sinC);
  return { lat: lat * DEG, lon: ((lon * DEG + 540) % 360) - 180 };
}

// v1-contract wrappers, bound to the default CENTER. The map-data generator
// and any center-agnostic caller keep using these.
export function project(lat, lon) {
  return projectAt(CENTER, lat, lon);
}

export function unproject(x, y) {
  return unprojectAt(CENTER, x, y);
}

// ---------------------------------------------------------------------------
// Web Mercator world coordinates (the v2 DISPLAY plane; never physics).
// The world is a WORLD x WORLD square: x 0..WORLD spans lon -180..180,
// y 0..WORLD spans lat +85.051..-85.051 (north at y = 0). At display zoom z
// one world unit is 2^z css px -- the slippy-tile convention with 256 px
// tiles, so tile (tx, ty) at tile-zoom tz covers world x in
// [tx, tx+1] * WORLD / 2^tz.
// ---------------------------------------------------------------------------

export const WORLD = 256;
export const MAX_MERC_LAT = 85.05113; // Mercator singularity clamp

export function lonToWorldX(lon) {
  return ((lon + 180) / 360) * WORLD;
}

export function latToWorldY(lat) {
  const clamped = Math.max(-MAX_MERC_LAT, Math.min(MAX_MERC_LAT, lat));
  const s = Math.sin(clamped * RAD);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
}

export function worldXToLon(x) {
  return (x / WORLD) * 360 - 180;
}

export function worldYToLat(y) {
  const n = Math.PI - (2 * Math.PI * y) / WORLD;
  return DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
