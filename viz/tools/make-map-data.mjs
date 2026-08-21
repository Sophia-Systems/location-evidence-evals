#!/usr/bin/env node
// make-map-data.mjs -- generator for viz/src/map-data.js and viz/tools/map-preview.svg.
//
// v2 (global display): fetches Natural Earth 50m coastline + admin-0 boundary
// GeoJSON, simplifies with Douglas-Peucker in lon/lat degrees, quantizes, and
// emits a self-contained ESM module with polyline-encoded global COAST and
// BORDERS plus a small MAJOR-CITY set. Coordinates are stored as lon/lat
// degrees (documented choice: projection-agnostic; the renderer converts to
// Web Mercator world units once at startup). This layer is the OFFLINE
// FALLBACK under the tile basemap -- small matters more than detail, so the
// tolerance auto-raises until the module fits the size budget.
//
// Usage: node viz/tools/make-map-data.mjs
//
// Natural Earth data is public domain (https://www.naturalearthdata.com/about/terms-of-use/).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_MODULE = path.join(HERE, "..", "src", "map-data.js");
const OUT_PREVIEW = path.join(HERE, "map-preview.svg");

const DP_TOLERANCE = 0.05; // degrees, Douglas-Peucker starting tolerance
const QUANTUM = 0.01; // degrees per integer unit (~1.1 km N-S)
const MIN_FRAGMENT_DEG = 0.15; // drop tinier fragments (~17 km)
const SIZE_BUDGET_BYTES = 350 * 1024; // v2 brief: <= ~350 KB, raise tolerance until under

// 50m sources (v2 brief): the offline fallback trades the 10m detail of the
// v1 window map for global coverage at a small size; tiles carry detail when
// online. 110m kept as a last-resort fallback.
const SOURCES = {
  coast: [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson",
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_coastline.json",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_coastline.geojson",
  ],
  borders: [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson",
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_boundary_lines_land.json",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson",
  ],
};

// Major-city set for the offline fallback ONLY (Positron tiles carry their
// own labels; never double-label). The current facility cities plus obvious
// global ones, ~40 total, favoring wide geographic spread.
const MAJOR_CITIES = [
  // facility / demo cities (the measurement testbed's geography)
  ["London", 51.507, -0.128],
  ["Paris", 48.857, 2.352],
  ["Dublin", 53.35, -6.26],
  ["Frankfurt", 50.111, 8.682],
  ["Stockholm", 59.329, 18.069],
  ["Helsinki", 60.17, 24.938],
  ["Tallinn", 59.437, 24.754],
  ["St Petersburg", 59.931, 30.361],
  // Europe
  ["Madrid", 40.417, -3.703],
  ["Rome", 41.893, 12.483],
  ["Berlin", 52.52, 13.405],
  ["Warsaw", 52.23, 21.011],
  ["Kyiv", 50.45, 30.523],
  ["Moscow", 55.756, 37.617],
  ["Istanbul", 41.008, 28.978],
  ["Reykjavik", 64.147, -21.942],
  // Middle East & Africa
  ["Dubai", 25.204, 55.271],
  ["Cairo", 30.044, 31.236],
  ["Lagos", 6.524, 3.379],
  ["Nairobi", -1.292, 36.822],
  ["Johannesburg", -26.204, 28.047],
  // Asia
  ["Mumbai", 19.076, 72.878],
  ["Delhi", 28.614, 77.209],
  ["Singapore", 1.352, 103.82],
  ["Bangkok", 13.756, 100.502],
  ["Jakarta", -6.208, 106.846],
  ["Hong Kong", 22.319, 114.169],
  ["Shanghai", 31.23, 121.474],
  ["Beijing", 39.904, 116.407],
  ["Seoul", 37.566, 126.978],
  ["Tokyo", 35.676, 139.65],
  // Oceania
  ["Sydney", -33.869, 151.209],
  ["Auckland", -36.849, 174.763],
  ["Perth", -31.95, 115.86],
  // Americas
  ["New York", 40.713, -74.006],
  ["Toronto", 43.653, -79.383],
  ["Chicago", 41.878, -87.63],
  ["San Francisco", 37.775, -122.419],
  ["Los Angeles", 34.052, -118.244],
  ["Mexico City", 19.433, -99.133],
  ["Bogota", 4.711, -74.072],
  ["Lima", -12.046, -77.043],
  ["Sao Paulo", -23.551, -46.633],
  ["Buenos Aires", -34.604, -58.382],
  ["Santiago", -33.449, -70.669],
];

async function fetchFirst(urls) {
  let lastErr;
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const json = await res.json();
      console.log(`fetched ${url}`);
      return { json, url };
    } catch (err) {
      lastErr = err;
      console.warn(`failed ${url}: ${err.message}`);
    }
  }
  throw lastErr;
}

// --- GeoJSON -> raw lon/lat polylines -------------------------------------

function* lineStrings(geojson) {
  for (const feature of geojson.features ?? []) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "LineString") yield g.coordinates;
    else if (g.type === "MultiLineString") yield* g.coordinates;
    else if (g.type === "Polygon") yield* g.coordinates;
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates) yield* poly;
  }
}

// Split a lon/lat polyline wherever consecutive vertices jump more than 180
// degrees of longitude (an antimeridian wrap): the renderer draws in a single
// Mercator world copy, so a wrapping segment would streak across the map.
// Natural Earth lines are already cut at +-180; this is a safety net.
function splitAntimeridian(coords) {
  const chunks = [];
  let chunk = [coords[0]];
  for (let i = 1; i < coords.length; i++) {
    if (Math.abs(coords[i][0] - coords[i - 1][0]) > 180) {
      if (chunk.length >= 2) chunks.push(chunk);
      chunk = [];
    }
    chunk.push(coords[i]);
  }
  if (chunk.length >= 2) chunks.push(chunk);
  return chunks;
}

// --- Douglas-Peucker (in degrees) ------------------------------------------

function perpDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxDist = -1;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx], [maxIdx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

// --- quantize + encode -----------------------------------------------------

function quantize(points) {
  const out = [];
  let prevX = null;
  let prevY = null;
  for (const [x, y] of points) {
    const qx = Math.round(x / QUANTUM);
    const qy = Math.round(y / QUANTUM);
    if (qx === prevX && qy === prevY) continue; // collapse duplicates
    out.push([qx, qy]);
    prevX = qx;
    prevY = qy;
  }
  return out;
}

function polylineLengthDeg(qpoints) {
  let len = 0;
  for (let i = 1; i < qpoints.length; i++) {
    len += Math.hypot(
      (qpoints[i][0] - qpoints[i - 1][0]) * QUANTUM,
      (qpoints[i][1] - qpoints[i - 1][1]) * QUANTUM,
    );
  }
  return len;
}

// Google-polyline-style signed varint encoding of integer deltas: chars 63..126.
function encodeValue(v) {
  let value = v < 0 ? ~(v << 1) : v << 1;
  let out = "";
  while (value >= 0x20) {
    out += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>= 5;
  }
  return out + String.fromCharCode(value + 63);
}

function encodePolyline(qpoints) {
  let out = "";
  let px = 0;
  let py = 0;
  for (const [x, y] of qpoints) {
    out += encodeValue(x - px) + encodeValue(y - py);
    px = x;
    py = y;
  }
  return out;
}

// Reference decoder (mirrors the one emitted into map-data.js) for verification.
function decodePolyline(str) {
  const vals = [];
  let i = 0;
  while (i < str.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    vals.push(result & 1 ? ~(result >> 1) : result >> 1);
  }
  const out = new Float32Array(vals.length);
  let px = 0;
  let py = 0;
  for (let j = 0; j < vals.length; j += 2) {
    px += vals[j];
    py += vals[j + 1];
    out[j] = px * QUANTUM;
    out[j + 1] = py * QUANTUM;
  }
  return out;
}

// --- pipeline --------------------------------------------------------------

function processGeojson(geojson, tolerance) {
  const encoded = [];
  const stats = { inputLines: 0, points: 0 };
  for (const coords of lineStrings(geojson)) {
    stats.inputLines++;
    for (const chunk of splitAntimeridian(coords)) {
      const simplified = douglasPeucker(chunk, tolerance);
      const q = quantize(simplified);
      if (q.length < 2) continue;
      if (polylineLengthDeg(q) < MIN_FRAGMENT_DEG) continue;
      encoded.push(encodePolyline(q));
      stats.points += q.length;
    }
  }
  return { encoded, stats };
}

function verify(encodedList, label) {
  let points = 0;
  for (const str of encodedList) {
    const flat = decodePolyline(str);
    if (flat.length < 4 || flat.length % 2 !== 0) {
      throw new Error(`${label}: bad decoded length ${flat.length}`);
    }
    for (let i = 0; i < flat.length; i += 2) {
      const lon = flat[i];
      const lat = flat[i + 1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`${label}: non-finite coordinate`);
      if (Math.abs(lon) > 180 + QUANTUM || Math.abs(lat) > 90 + QUANTUM) {
        throw new Error(`${label}: coordinate (${lon}, ${lat}) out of range`);
      }
    }
    points += flat.length / 2;
  }
  return points;
}

// --- preview SVG (plate carree, for eyeballing) ----------------------------

function svgPath(encodedList, scale) {
  const parts = [];
  for (const str of encodedList) {
    const flat = decodePolyline(str);
    let d = "";
    for (let i = 0; i < flat.length; i += 2) {
      const sx = ((flat[i] + 180) * scale).toFixed(1);
      const sy = ((90 - flat[i + 1]) * scale).toFixed(1);
      d += (i === 0 ? "M" : "L") + sx + " " + sy;
    }
    parts.push(d);
  }
  return parts.join("");
}

function makePreviewSvg(coast, borders) {
  const scale = 8; // px per degree
  const w = 360 * scale;
  const h = 180 * scale;
  const cityMarks = MAJOR_CITIES.map(([name, lat, lon]) => {
    const sx = (lon + 180) * scale;
    const sy = (90 - lat) * scale;
    return (
      `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4" fill="#006a4e"/>` +
      `<text x="${(sx + 7).toFixed(1)}" y="${(sy + 4).toFixed(1)}" ` +
      `font-family="sans-serif" font-size="14" fill="#1a1a1a">${name}</text>`
    );
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="1440" height="720">
  <!-- generated by make-map-data.mjs; plate carree, ${scale} px per degree -->
  <rect x="0" y="0" width="${w}" height="${h}" fill="#fbfbf9"/>
  <path d="${svgPath(coast, scale)}" fill="none" stroke="#4a5a66" stroke-width="1"/>
  <path d="${svgPath(borders, scale)}" fill="none" stroke="#b0a8a0" stroke-width="0.8"/>
  ${cityMarks}
</svg>
`;
}

// --- module emission -------------------------------------------------------

function makeModule(coast, borders, meta) {
  const coastLines = coast.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const borderLines = borders.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const cityLines = MAJOR_CITIES.map(
    ([name, lat, lon]) => `  { name: ${JSON.stringify(name)}, lat: ${lat}, lon: ${lon} },`
  ).join("\n");
  return `// map-data.js -- GENERATED, do not edit by hand. Regenerate with:
//   node viz/tools/make-map-data.mjs
//
// Source: Natural Earth (public domain), ${meta.coastUrl}
//         and ${meta.bordersUrl}
// Pipeline: global lon/lat polylines, split at the antimeridian,
// Douglas-Peucker simplified at ${meta.tolerance} degrees, quantized to
// ${QUANTUM} degree integer units, fragments under ${MIN_FRAGMENT_DEG} degrees dropped.
//
// This layer is the OFFLINE FALLBACK beneath the tile basemap (and the
// placeholder while tiles load): coordinates are stored as lon/lat degrees
// -- projection-agnostic; the renderer converts to its display projection
// once at startup. Encoding: per polyline, a Google-polyline-style string --
// signed integer deltas of the quantized (lon, lat) pairs, zigzag-encoded,
// 5 bits per char, char codes 63..126.
// Generated ${meta.date}.

export const COAST = [
${coastLines}
];

export const BORDERS = [
${borderLines}
];

// Major cities, rendered as subtle dot+label ONLY in offline-fallback mode
// (the tile basemap carries its own labels; never double-label).
export const CITIES = [
${cityLines}
];

// Decode an array of encoded polylines to Array<Float32Array> of
// [lon0, lat0, lon1, lat1, ...] in degrees.
export function decodePolylines(encoded) {
  return encoded.map((str) => {
    const vals = [];
    let i = 0;
    while (i < str.length) {
      let result = 0;
      let shift = 0;
      let b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      vals.push(result & 1 ? ~(result >> 1) : result >> 1);
    }
    const out = new Float32Array(vals.length);
    let px = 0;
    let py = 0;
    for (let j = 0; j < vals.length; j += 2) {
      px += vals[j];
      py += vals[j + 1];
      out[j] = px * ${QUANTUM};
      out[j + 1] = py * ${QUANTUM};
    }
    return out;
  });
}
`;
}

// --- main ------------------------------------------------------------------

async function main() {
  const [coastSrc, bordersSrc] = await Promise.all([
    fetchFirst(SOURCES.coast),
    fetchFirst(SOURCES.borders),
  ]);

  let tolerance = DP_TOLERANCE;
  let coast;
  let borders;
  let moduleText;
  for (;;) {
    coast = processGeojson(coastSrc.json, tolerance);
    borders = processGeojson(bordersSrc.json, tolerance);
    moduleText = makeModule(coast.encoded, borders.encoded, {
      coastUrl: coastSrc.url,
      bordersUrl: bordersSrc.url,
      tolerance,
      date: new Date().toISOString().slice(0, 10),
    });
    const bytes = Buffer.byteLength(moduleText);
    if (bytes <= SIZE_BUDGET_BYTES) break;
    tolerance *= 1.5;
    console.warn(`module ${bytes} B over ${SIZE_BUDGET_BYTES} B budget; raising tolerance to ${tolerance} deg`);
    if (tolerance > 5) throw new Error("cannot meet size budget");
  }

  const coastPoints = verify(coast.encoded, "COAST");
  const borderPoints = verify(borders.encoded, "BORDERS");

  await mkdir(path.dirname(OUT_MODULE), { recursive: true });
  await writeFile(OUT_MODULE, moduleText);
  await writeFile(OUT_PREVIEW, makePreviewSvg(coast.encoded, borders.encoded));

  const bytes = Buffer.byteLength(moduleText);
  console.log(`COAST:   ${coast.encoded.length} polylines, ${coastPoints} points`);
  console.log(`BORDERS: ${borders.encoded.length} polylines, ${borderPoints} points`);
  console.log(`CITIES:  ${MAJOR_CITIES.length}`);
  console.log(`tolerance: ${tolerance} deg; module size: ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`wrote ${OUT_MODULE}`);
  console.log(`wrote ${OUT_PREVIEW}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
