#!/usr/bin/env node
// make-map-data.mjs -- generator for viz/src/map-data.js and viz/tools/map-preview.svg.
//
// Fetches Natural Earth coastline + admin-0 boundary GeoJSON (network use is fine
// HERE; the runtime page makes zero requests), projects every vertex through
// project() from viz/src/geo.js, clips to the display square, simplifies with
// Douglas-Peucker, quantizes to 0.1 km integers, and emits a self-contained ESM
// module with polyline-encoded COAST and BORDERS.
//
// Usage: node viz/tools/make-map-data.mjs
//
// Natural Earth data is public domain (https://www.naturalearthdata.com/about/terms-of-use/).

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { project, HALF_EXTENT } from "../src/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_MODULE = path.join(HERE, "..", "src", "map-data.js");
const OUT_PREVIEW = path.join(HERE, "map-preview.svg");

// Clip square: small margin past the 1300 km domain so strokes reach the frame.
const CLIP = 1350; // km
// Drop projected points farther than this from center before clipping: on an
// azimuthal equidistant plane, rho is true distance from center, so anything
// beyond this cannot contribute geometry near the window; it also guards
// against spurious segments sweeping across the plane near the antipode.
const RHO_MAX = 5000; // km
const DP_TOLERANCE = 1.0; // km, Douglas-Peucker (item 3: finer detail for zoomed viewing)
const QUANTUM = 0.1; // km per integer unit
const MIN_FRAGMENT_KM = 8; // drop tinier fragments
const SIZE_BUDGET_BYTES = 250 * 1024; // item 3: raised from 150 KB for 10m-source detail

// item 3: switched from 50m to 10m sources so zoomed-in views (pan/zoom goes
// to 8x) show real coastline detail instead of the 50m simplification's
// facets. Same URL/host pattern family as before; 50m kept as a last-resort
// fallback (safer than dropping to 110m if 10m is ever unavailable).
const SOURCES = {
  coast: [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_coastline.geojson",
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/10m/physical/ne_10m_coastline.json",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_coastline.geojson",
  ],
  borders: [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_land.geojson",
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/10m/cultural/ne_10m_admin_0_boundary_lines_land.json",
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson",
  ],
  land: [
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson",
    "https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/physical/ne_50m_land.json",
  ],
};

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

// --- clipping (Liang-Barsky per segment, joined into runs) ----------------

function clipSegment(x0, y0, x1, y1, min, max) {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const checks = [
    [-dx, x0 - min],
    [dx, max - x0],
    [-dy, y0 - min],
    [dy, max - y0],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy, t0, t1];
}

// Clip a projected polyline ([{x,y},...]) to the square, returning an array of
// polylines (the clip can cut one line into several runs).
function clipPolyline(points, extent) {
  const runs = [];
  let run = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const seg = clipSegment(a.x, a.y, b.x, b.y, -extent, extent);
    if (!seg) {
      run = null;
      continue;
    }
    const [cx0, cy0, cx1, cy1, t0, t1] = seg;
    if (run === null || t0 > 0) {
      run = [[cx0, cy0]];
      runs.push(run);
    }
    run.push([cx1, cy1]);
    if (t1 < 1) run = null;
  }
  return runs.filter((r) => r.length >= 2);
}

// --- land polygons (item 3: optional quiet land-fill layer) ---------------

function* polygonRings(geojson) {
  for (const feature of geojson.features ?? []) {
    const g = feature.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) yield ring;
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) for (const ring of poly) yield ring;
    }
  }
}

// Sutherland-Hodgman: clip a (possibly huge, possibly concave) polygon ring
// against our small convex rectangle. Correct even when the subject ring
// spans the whole globe (a continent's coastline): points far outside the
// window need only be classified correctly as outside each of the four
// half-planes, which azimuthal-equidistant projection preserves everywhere
// except within the (here, irrelevant) mid-South-Pacific antipode of the
// projection center. The output may include zero-area boundary-hugging
// bridges where the ring dips in and out of the window multiple times; those
// render correctly under the evenodd fill rule used in render.js.
function clipEdge(poly, inside, intersect) {
  if (poly.length === 0) return poly;
  const out = [];
  let prev = poly[poly.length - 1];
  let prevIn = inside(prev);
  for (const cur of poly) {
    const curIn = inside(cur);
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersect(prev, cur));
    }
    prev = cur;
    prevIn = curIn;
  }
  return out;
}

function clipPolygonToRect(points, ext) {
  const xAt = (a, b, x) => [x, a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
  const yAt = (a, b, y) => [a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), y];
  let p = points;
  p = clipEdge(p, (pt) => pt[0] >= -ext, (a, b) => xAt(a, b, -ext));
  p = clipEdge(p, (pt) => pt[0] <= ext, (a, b) => xAt(a, b, ext));
  p = clipEdge(p, (pt) => pt[1] >= -ext, (a, b) => yAt(a, b, -ext));
  p = clipEdge(p, (pt) => pt[1] <= ext, (a, b) => yAt(a, b, ext));
  return p;
}

// Safe projection: real land vertices never land near the projection's
// antipodal singularity (mid South Pacific, antipodal to 54N 13E), but guard
// anyway so one freak coordinate can't corrupt a ring's structure.
function projectSafe(lat, lon) {
  const p = project(lat, lon);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { x: 1e7, y: 1e7 };
  return p;
}

function processLandPolygons(geojson, tolerance) {
  const encoded = [];
  const stats = { rings: 0, kept: 0, points: 0 };
  for (const ring of polygonRings(geojson)) {
    stats.rings++;
    const projected = ring.map(([lon, lat]) => {
      const p = projectSafe(lat, lon);
      return [p.x, p.y];
    });
    const clipped = clipPolygonToRect(projected, CLIP);
    if (clipped.length < 3) continue;
    const simplified = douglasPeucker(clipped, tolerance);
    const q = quantize(simplified);
    if (q.length < 3) continue;
    encoded.push(encodePolyline(q));
    stats.kept++;
    stats.points += q.length;
  }
  return { encoded, stats };
}

// --- Douglas-Peucker -------------------------------------------------------

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

function polylineLengthKm(qpoints) {
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
  const stats = { inputLines: 0, points: 0, km: 0 };
  for (const coords of lineStrings(geojson)) {
    stats.inputLines++;
    // Project; split wherever a vertex lands beyond RHO_MAX (far-side guard).
    let chunk = [];
    const chunks = [chunk];
    for (const [lon, lat] of coords) {
      const p = project(lat, lon);
      if (Math.hypot(p.x, p.y) > RHO_MAX) {
        if (chunk.length) chunks.push((chunk = []));
        continue;
      }
      chunk.push(p);
    }
    for (const ch of chunks) {
      if (ch.length < 2) continue;
      for (const run of clipPolyline(ch, CLIP)) {
        const simplified = douglasPeucker(run, tolerance);
        const q = quantize(simplified);
        if (q.length < 2) continue;
        const lenKm = polylineLengthKm(q);
        if (lenKm < MIN_FRAGMENT_KM) continue;
        encoded.push(encodePolyline(q));
        stats.points += q.length;
        stats.km += lenKm;
      }
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
    for (let i = 0; i < flat.length; i++) {
      const v = flat[i];
      if (!Number.isFinite(v)) throw new Error(`${label}: non-finite coordinate`);
      if (Math.abs(v) > CLIP + QUANTUM) {
        throw new Error(`${label}: coordinate ${v} outside +-${CLIP}`);
      }
    }
    points += flat.length / 2;
  }
  return points;
}

// --- preview SVG -----------------------------------------------------------

const CITIES = [
  ["London", 51.5074, -0.1278],
  ["Paris", 48.8566, 2.3522],
  ["Dublin", 53.3498, -6.2603],
  ["Frankfurt", 50.1109, 8.6821],
  ["Stockholm", 59.3293, 18.0686],
  ["Helsinki", 60.1699, 24.9384],
  ["Tallinn", 59.437, 24.7536],
  ["St Petersburg", 59.9311, 30.3609],
  ["Cambridge", 52.2053, 0.1218],
];

function svgPath(encodedList) {
  const parts = [];
  for (const str of encodedList) {
    const flat = decodePolyline(str);
    let d = "";
    for (let i = 0; i < flat.length; i += 2) {
      const sx = (flat[i] + CLIP).toFixed(1);
      const sy = (CLIP - flat[i + 1]).toFixed(1); // y north-up -> svg y down
      d += (i === 0 ? "M" : "L") + sx + " " + sy;
    }
    parts.push(d);
  }
  return parts.join("");
}

function makePreviewSvg(coast, borders, land = []) {
  const size = CLIP * 2;
  const cityMarks = CITIES.map(([name, lat, lon]) => {
    const p = project(lat, lon);
    const sx = p.x + CLIP;
    const sy = CLIP - p.y;
    return (
      `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="10" fill="#006a4e"/>` +
      `<text x="${(sx + 18).toFixed(1)}" y="${(sy + 8).toFixed(1)}" ` +
      `font-family="sans-serif" font-size="42" fill="#1a1a1a">${name}</text>`
    );
  }).join("\n  ");
  const domainOffset = CLIP - HALF_EXTENT;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="900" height="900">
  <!-- generated by make-map-data.mjs; units are km on the display plane, y flipped -->
  <rect x="0" y="0" width="${size}" height="${size}" fill="#fbfbf9"/>
  <path d="${svgPath(land)}" fill="#e4e6df" fill-rule="evenodd" stroke="none"/>
  <path d="${svgPath(coast)}" fill="none" stroke="#4a5a66" stroke-width="3"/>
  <path d="${svgPath(borders)}" fill="none" stroke="#b0a8a0" stroke-width="2.5" stroke-dasharray="12 10"/>
  <rect x="${domainOffset}" y="${domainOffset}" width="${HALF_EXTENT * 2}" height="${HALF_EXTENT * 2}" fill="none" stroke="#888" stroke-width="3" stroke-dasharray="24 16"/>
  <rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" fill="none" stroke="#333" stroke-width="1"/>
  ${cityMarks}
  <text x="30" y="${size - 30}" font-family="sans-serif" font-size="42" fill="#666">clip frame +-${CLIP} km; inner dashed frame: domain +-${HALF_EXTENT} km</text>
</svg>
`;
}

// --- module emission -------------------------------------------------------

function makeModule(coast, borders, land, meta) {
  const coastLines = coast.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const borderLines = borders.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const landLines = land.map((s) => `  ${JSON.stringify(s)},`).join("\n");
  const landBlock = land.length
    ? `
// Quiet land-fill polygons (item 3, optional): Natural Earth ne_50m_land,
// clipped to the same window with Sutherland-Hodgman (handles the
// continent-spanning subject rings; see make-map-data.mjs). Rings are
// EITHER exterior or hole -- render with the evenodd fill rule so lake/inland
// holes punch through correctly without tracking winding order.
export const LAND = [
${landLines}
];
`
    : "";
  return `// map-data.js -- GENERATED, do not edit by hand. Regenerate with:
//   node viz/tools/make-map-data.mjs
//
// Source: Natural Earth (public domain), ${meta.coastUrl}
//         and ${meta.bordersUrl}${meta.landUrl ? `\n//         and ${meta.landUrl} (land fill)` : ""}
// Pipeline: each vertex projected with project() from viz/src/geo.js
// (azimuthal equidistant, center ${meta.center}), clipped to x,y in
// [-${CLIP}, ${CLIP}] km, Douglas-Peucker simplified at ${meta.tolerance} km,
// quantized to ${QUANTUM} km integer units, fragments under ${MIN_FRAGMENT_KM} km dropped.
//
// Encoding: per polyline, a Google-polyline-style string -- signed integer
// deltas of the quantized (x, y) pairs, zigzag-encoded, 5 bits per char,
// char codes 63..126. decodePolylines() returns km on the display plane.
// Generated ${meta.date}.

export const COAST = [
${coastLines}
];

export const BORDERS = [
${borderLines}
];
${landBlock}

// Decode an array of encoded polylines to Array<Float32Array> of
// [x0, y0, x1, y1, ...] in km on the display plane.
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

// Land-fill layer (item 3, optional): implemented below (processLandPolygons,
// Sutherland-Hodgman clip) and it runs the full pipeline, but is NOT wired
// into the shipped module. Visual inspection of map-preview.svg with it
// enabled showed a real bug: Scandinavia and the British Isles rendered
// unfilled while continental Europe filled correctly. Root cause, most
// likely: Sutherland-Hodgman clipping the (huge, continent-spanning)
// Eurasian landmass ring against our small window produces zero-width
// "bridge" edges where the ring exits and re-enters the window; running
// Douglas-Peucker simplification AFTER clipping can collapse those bridges
// (their points sit near-collinear, so DP sees low perpendicular distance)
// in a way that changes the ring's effective winding and flips evenodd
// parity for some enclosed lobes. Fixing this properly needs either
// per-feature (not per-ring-blob) clipping with a real polygon-clipping
// library, or simplifying BEFORE clipping so the bridge geometry survives
// exactly. Out of scope for this pass -- shipping broken geometry would be
// worse than shipping quiet lines only. Kept here, disabled, so a future
// pass has the scaffolding. See viz/DECISIONS.md item 30.
const SHIP_LAND_FILL = false;

async function main() {
  const [coastSrc, bordersSrc, landSrc] = await Promise.all([
    fetchFirst(SOURCES.coast),
    fetchFirst(SOURCES.borders),
    SHIP_LAND_FILL
      ? fetchFirst(SOURCES.land).catch((err) => {
          console.warn(`land source fetch failed, skipping land fill: ${err.message}`);
          return null;
        })
      : Promise.resolve(null),
  ]);

  let tolerance = DP_TOLERANCE;
  let coast;
  let borders;
  let land = { encoded: [], stats: { rings: 0, kept: 0, points: 0 } };
  let includeLand = landSrc != null;
  let moduleText;
  for (;;) {
    coast = processGeojson(coastSrc.json, tolerance);
    borders = processGeojson(bordersSrc.json, tolerance);
    if (includeLand) land = processLandPolygons(landSrc.json, tolerance);
    moduleText = makeModule(coast.encoded, borders.encoded, land.encoded, {
      coastUrl: coastSrc.url,
      bordersUrl: bordersSrc.url,
      landUrl: includeLand ? landSrc.url : null,
      center: "54N 13E",
      tolerance,
      date: new Date().toISOString().slice(0, 10),
    });
    const bytes = Buffer.byteLength(moduleText);
    if (bytes <= SIZE_BUDGET_BYTES) break;
    if (includeLand) {
      console.warn(`module ${bytes} B over ${SIZE_BUDGET_BYTES} B budget; dropping the optional land-fill layer first`);
      includeLand = false;
      land = { encoded: [], stats: land.stats };
      continue;
    }
    tolerance *= 1.5;
    console.warn(`module ${bytes} B over ${SIZE_BUDGET_BYTES} B budget; raising tolerance to ${tolerance} km`);
    if (tolerance > 50) throw new Error("cannot meet size budget");
  }

  const coastPoints = verify(coast.encoded, "COAST");
  const borderPoints = verify(borders.encoded, "BORDERS");
  if (includeLand) verify(land.encoded, "LAND");

  await mkdir(path.dirname(OUT_MODULE), { recursive: true });
  await writeFile(OUT_MODULE, moduleText);
  await writeFile(OUT_PREVIEW, makePreviewSvg(coast.encoded, borders.encoded, land.encoded));

  const bytes = Buffer.byteLength(moduleText);
  console.log(`COAST:   ${coast.encoded.length} polylines, ${coastPoints} points, ${coast.stats.km.toFixed(0)} km`);
  console.log(`BORDERS: ${borders.encoded.length} polylines, ${borderPoints} points, ${borders.stats.km.toFixed(0)} km`);
  console.log(
    `LAND:    ${land.encoded.length} polygons, ${land.stats.points ?? 0} points` +
      (includeLand
        ? ""
        : ` (skipped: ${SHIP_LAND_FILL ? "fetch failed or over size budget" : "disabled, see SHIP_LAND_FILL comment"})`)
  );
  console.log(`tolerance: ${tolerance} km; module size: ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`wrote ${OUT_MODULE}`);
  console.log(`wrote ${OUT_PREVIEW}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
