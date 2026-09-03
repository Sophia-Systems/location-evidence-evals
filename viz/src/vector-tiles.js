// vector-tiles.js -- a minimal Mapbox Vector Tile (MVT) decoder and tile
// source, plus the style table the renderer draws them with.
//
// Why hand-rolled: the build ships two self-contained HTML files with no
// dependencies (build.mjs), so MapLibre GL is not an option. What we need is
// a small slice of the format -- decode the protobuf, walk the geometry
// command stream, build Path2D in Mercator world units -- and that slice is
// about 200 lines.
//
// Why vector at all (superseding the v2 raster basemap, DECISIONS.md item 35):
// the basemap is the GROUND for a probability field, so it has to recede on
// command. Raster tiles arrive pre-colored -- Positron in light, Dark Matter
// in dark -- and the viz had to accept whatever palette they carried. Vector
// tiles carry geometry only, so STYLE.LIGHT/STYLE.DARK below derive the whole
// basemap from the page's own theme tokens: the map is quiet in exactly the
// warm-paper / green-black the rest of the bench is quiet in, and labels
// render in the page's typeface rather than baked-in glyph bitmaps.
//
// Coordinates: tile-local ints on a 0..extent grid (extent 4096 here) map to
// Mercator world units by  world = (tile + local/extent) * span,  where
// span = WORLD / 2^z. Paths are built ONCE per tile in world units and drawn
// through the renderer's canvas CTM, exactly like the inlined vector
// geography, so per-frame cost is a stroke/fill, not a reprojection.

import { WORLD } from "./geo.js";

// ---------------------------------------------------------------------------
// protobuf wire decoding
// ---------------------------------------------------------------------------

// Field numbers from the MVT spec (version 2). Only what we read is named.
const F_TILE_LAYER = 3;
const F_LAYER_NAME = 1;
const F_LAYER_FEATURE = 2;
const F_LAYER_KEY = 3;
const F_LAYER_VALUE = 4;
const F_LAYER_EXTENT = 5;
const F_FEAT_TAGS = 2;
const F_FEAT_TYPE = 3;
const F_FEAT_GEOM = 4;

const utf8 = new TextDecoder();

// A tiny cursor-based reader. Varints are decoded with multiplication rather
// than << so values above 2^31 (rare but legal in tag/length fields) do not
// wrap through JS's 32-bit bitwise coercion.
function createReader(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const r = {
    pos: 0,
    end: buf.length,
    varint() {
      let v = 0;
      let shift = 1;
      for (;;) {
        const b = buf[r.pos++];
        v += (b & 0x7f) * shift;
        if (b < 0x80) return v;
        shift *= 128;
      }
    },
    // zigzag: MVT stores signed deltas as unsigned
    svarint() {
      const v = r.varint();
      return v % 2 === 1 ? -(v + 1) / 2 : v / 2;
    },
    string(len) {
      const s = utf8.decode(buf.subarray(r.pos, r.pos + len));
      r.pos += len;
      return s;
    },
    f32() {
      const v = view.getFloat32(r.pos, true);
      r.pos += 4;
      return v;
    },
    f64() {
      const v = view.getFloat64(r.pos, true);
      r.pos += 8;
      return v;
    },
    skip(wire) {
      if (wire === 0) r.varint();
      else if (wire === 1) r.pos += 8;
      else if (wire === 2) r.pos += r.varint();
      else if (wire === 5) r.pos += 4;
      else throw new Error(`mvt: unsupported wire type ${wire}`);
    },
  };
  return r;
}

// A Value message carries exactly one of several typed fields.
function readValue(r, end) {
  let out = null;
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === 1 && wire === 2) out = r.string(r.varint());
    else if (field === 2 && wire === 5) out = r.f32();
    else if (field === 3 && wire === 1) out = r.f64();
    else if (field === 4 || field === 5) out = r.varint();
    else if (field === 6) out = r.svarint();
    else if (field === 7) out = r.varint() !== 0;
    else r.skip(wire);
  }
  r.pos = end;
  return out;
}

function readFeature(r, end) {
  const f = { type: 0, tags: null, geom: null };
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === F_FEAT_TAGS && wire === 2) {
      const len = r.varint();
      const stop = r.pos + len;
      const tags = [];
      while (r.pos < stop) tags.push(r.varint());
      f.tags = tags;
    } else if (field === F_FEAT_TYPE && wire === 0) {
      f.type = r.varint();
    } else if (field === F_FEAT_GEOM && wire === 2) {
      const len = r.varint();
      const stop = r.pos + len;
      const g = [];
      while (r.pos < stop) g.push(r.varint());
      f.geom = g;
    } else r.skip(wire);
  }
  r.pos = end;
  return f;
}

function readLayer(r, end) {
  const layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  while (r.pos < end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === F_LAYER_NAME && wire === 2) layer.name = r.string(r.varint());
    else if (field === F_LAYER_FEATURE && wire === 2) {
      // read the length BEFORE taking r.pos: the varint advances the cursor,
      // and `r.pos + r.varint()` would capture the pre-advance position
      const len = r.varint();
      layer.features.push(readFeature(r, r.pos + len));
    } else if (field === F_LAYER_KEY && wire === 2) layer.keys.push(r.string(r.varint()));
    else if (field === F_LAYER_VALUE && wire === 2) {
      const len = r.varint();
      layer.values.push(readValue(r, r.pos + len));
    } else if (field === F_LAYER_EXTENT && wire === 0) layer.extent = r.varint();
    else r.skip(wire);
  }
  r.pos = end;
  return layer;
}

export function decodeTile(bytes) {
  const r = createReader(bytes);
  const layers = {};
  while (r.pos < r.end) {
    const tag = r.varint();
    const field = tag >> 3;
    const wire = tag & 7;
    if (field === F_TILE_LAYER && wire === 2) {
      const len = r.varint();
      const l = readLayer(r, r.pos + len);
      layers[l.name] = l;
    } else r.skip(wire);
  }
  return layers;
}

function featureProps(layer, feature) {
  const p = {};
  if (!feature.tags) return p;
  for (let i = 0; i < feature.tags.length; i += 2) {
    p[layer.keys[feature.tags[i]]] = layer.values[feature.tags[i + 1]];
  }
  return p;
}

// ---------------------------------------------------------------------------
// geometry: command stream -> Path2D in Mercator world units
// ---------------------------------------------------------------------------

const CMD_MOVE = 1;
const CMD_LINE = 2;
const CMD_CLOSE = 7;

// Append a feature's geometry to `path`, transformed straight into world
// units. `ox`/`oy` are the tile's world-unit origin and `k` the world units
// per tile-local unit, so no intermediate arrays are allocated.
function addGeometry(path, geom, ox, oy, k, closeRings) {
  let x = 0;
  let y = 0;
  let i = 0;
  const n = geom.length;
  while (i < n) {
    const cmdInt = geom[i++];
    const cmd = cmdInt & 7;
    const count = cmdInt >> 3;
    if (cmd === CMD_MOVE) {
      for (let c = 0; c < count; c++) {
        const dx = geom[i++];
        const dy = geom[i++];
        x += dx % 2 === 1 ? -(dx + 1) / 2 : dx / 2;
        y += dy % 2 === 1 ? -(dy + 1) / 2 : dy / 2;
        path.moveTo(ox + x * k, oy + y * k);
      }
    } else if (cmd === CMD_LINE) {
      for (let c = 0; c < count; c++) {
        const dx = geom[i++];
        const dy = geom[i++];
        x += dx % 2 === 1 ? -(dx + 1) / 2 : dx / 2;
        y += dy % 2 === 1 ? -(dy + 1) / 2 : dy / 2;
        path.lineTo(ox + x * k, oy + y * k);
      }
    } else if (cmd === CMD_CLOSE) {
      if (closeRings) path.closePath();
    } else {
      return; // malformed stream: keep what we have rather than throwing
    }
  }
}

// First point of a feature, in world units -- the anchor for a point label.
function firstPoint(geom, ox, oy, k) {
  if (!geom || geom.length < 3) return null;
  const dx = geom[1];
  const dy = geom[2];
  const x = dx % 2 === 1 ? -(dx + 1) / 2 : dx / 2;
  const y = dy % 2 === 1 ? -(dy + 1) / 2 : dy / 2;
  return [ox + x * k, oy + y * k];
}

// ---------------------------------------------------------------------------
// style
// ---------------------------------------------------------------------------
//
// Every color is the page's own token, not CARTO's. The basemap has one job
// here: read as quiet ground beneath a magma probability field, in both
// themes. Roads are deliberately sparse -- motorways and trunk roads only,
// and only once zoomed past the continental view -- because at the zooms this
// viz lives at (z2..z10) a full road network is noise, not information.

export const STYLE = {
  light: {
    land: "#f4f2ea",
    // Land/sea separation has to survive the probability wash painted on top
    // (uniform belief is a ~4% alpha tint, but a concentrated posterior is
    // far heavier), so the sea sits a clear step cooler and darker than the
    // paper land rather than a hair away from it.
    sea: "#d3dee1",
    coast: "#9fadb2",
    green: "#eaefe6",
    waterway: "#c2cfd3",
    boundary: "#c6c1af",
    boundaryState: "#d9d4c6",
    roadCase: "#e7e3d8",
    roadFill: "#fffefa",
    label: "#7c8279",
    labelHalo: "rgba(255,255,255,0.92)",
  },
  dark: {
    land: "#161e1a",
    sea: "#0a1114",
    coast: "#38474c",
    green: "#141c17",
    waterway: "#243033",
    boundary: "#303a32",
    boundaryState: "#232c26",
    roadCase: "#1a221c",
    roadFill: "#2b342d",
    label: "#7b837b",
    labelHalo: "rgba(0,0,0,0.75)",
  },
};

// Zoom at which each road class starts drawing. Mirrors Positron's ordering
// (motorways first, then trunk, then primary) but starts later and stops
// earlier -- see the note above.
const ROAD_MIN_ZOOM = { motorway: 5, trunk: 6, primary: 8, secondary: 10 };

// Minimum zoom for a place label, from its class and rank. `rank` in the
// carto.streets schema runs 1 (most prominent) upward.
//
// These thresholds sit a good deal higher than a general-purpose basemap's.
// The map's subject is the probability field and the anchors on top of it, so
// place names are orientation furniture only: enough to know where you are,
// never enough to read as content. Minor cities and towns stay off until the
// view is genuinely local.
function placeMinZoom(cls, rank, capital) {
  const r = typeof rank === "number" ? rank : 10;
  // Country rank does not cleanly separate size: rank 3 holds Netherlands and
  // Estonia alongside Monaco and San Marino, so it cannot gate microstates on
  // its own. Rank 5+ is unambiguous though (Malta, Jersey, Isle of Man), and
  // those are the ones that read as noise over a continental view.
  if (cls === "country") return r <= 2 ? 2.5 : r <= 3 ? 4 : r <= 5 ? 6.5 : 8;
  if (cls === "state") return 7.5;
  if (cls === "city") {
    // `capital` is graded, not a flag: 2 is a national capital, 4 a regional
    // one. Only 2 earns early promotion -- treating any capital > 0 as
    // national pulls every county seat (Uppsala, Pskov, Linköping) onto a
    // continental view.
    if (capital > 0 && capital <= 2) return r <= 2 ? 3.5 : 4.5;
    if (r <= 2) return 4.5;
    if (r <= 3) return 6;
    if (r <= 5) return 7.5;
    return 9;
  }
  if (cls === "town") return 10;
  return Infinity;
}

// Build the render-ready form of one decoded tile: a handful of Path2Ds in
// world units plus a label list. Everything zoom-dependent that is cheap to
// re-decide per frame (which labels to show) stays as data; everything
// expensive (geometry) is baked into paths here, once.
function buildTile(layers, z, x, y) {
  const span = WORLD / Math.pow(2, z);
  const ox = x * span;
  const oy = y * span;

  const out = {
    water: new Path2D(),
    green: new Path2D(),
    waterway: new Path2D(),
    boundary: new Path2D(),
    boundaryState: new Path2D(),
    roads: { motorway: new Path2D(), trunk: new Path2D(), primary: new Path2D(), secondary: new Path2D() },
    labels: [],
    hasRoads: false,
  };

  const each = (name, fn) => {
    const l = layers[name];
    if (!l) return;
    const k = span / l.extent;
    for (const f of l.features) fn(f, featureProps(l, f), k, l);
  };

  // Water is FILL ONLY, never stroked. Polygons arrive clipped to the tile's
  // bounds, so a ring carries artificial edges running along the tile
  // boundary; stroking those paints a straight line down every seam in the
  // viewport. The shoreline instead comes from the land/sea tonal step, which
  // is why that pair is a clear step apart in STYLE. (Positron does the same:
  // its water layer is a fill with no outline layer anywhere.)
  each("water", (f, p, k) => {
    if (f.type !== 3) return;
    addGeometry(out.water, f.geom, ox, oy, k, true);
  });

  each("park", (f, p, k) => {
    if (f.type !== 3) return;
    addGeometry(out.green, f.geom, ox, oy, k, true);
  });

  each("landcover", (f, p, k) => {
    if (f.type !== 3) return;
    if (p.class !== "wood" && p.class !== "grass" && p.class !== "forest") return;
    addGeometry(out.green, f.geom, ox, oy, k, true);
  });

  each("waterway", (f, p, k) => {
    if (z < 7) return;
    addGeometry(out.waterway, f.geom, ox, oy, k, false);
  });

  each("boundary", (f, p, k) => {
    // maritime boundaries are the ocean-side halves of a country outline:
    // drawing them scribbles lines across open water
    if (p.maritime === 1) return;
    if (p.admin_level === 2) addGeometry(out.boundary, f.geom, ox, oy, k, false);
    else if (p.admin_level === 4 && z >= 5)
      addGeometry(out.boundaryState, f.geom, ox, oy, k, false);
  });

  each("transportation", (f, p, k) => {
    const cls = p.class;
    const min = ROAD_MIN_ZOOM[cls];
    if (min == null || z < min) return;
    addGeometry(out.roads[cls], f.geom, ox, oy, k, false);
    out.hasRoads = true;
  });

  each("place", (f, p, k) => {
    if (f.type !== 1) return;
    const name = p.name_en || p.name;
    if (!name) return;
    const pt = firstPoint(f.geom, ox, oy, k);
    if (!pt) return;
    const capital = typeof p.capital === "number" ? p.capital : 0;
    out.labels.push({
      wx: pt[0],
      wy: pt[1],
      name,
      cls: p.class,
      capital,
      rank: typeof p.rank === "number" ? p.rank : 10,
      minZoom: placeMinZoom(p.class, p.rank, capital),
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// tile source
// ---------------------------------------------------------------------------

// Subdomain rotation only -- the host and path stay literal in the template
// below so build.mjs's network-surface whitelist can see them by inspection.
const TILE_SUBS = ["a", "b", "c", "d"];
// The source's own max zoom. Past it we keep drawing z14 tiles scaled up
// (overzoom), which is exactly what a vector basemap is good at -- the
// geometry stays sharp, only the level of detail stops increasing.
export const TILE_MAX_ZOOM = 14;

export function createTileSource({ onTileReady, cacheMax = 220 } = {}) {
  const cache = new Map(); // key -> {state, tile}
  let okCount = 0;
  let failCount = 0;

  // Offline is the same contract the raster layer had: the first failure with
  // zero successes flips the page to its inlined-geography fallback, and a
  // single later success clears it for good.
  const isOffline = () => failCount > 0 && okCount === 0;

  function evict() {
    if (cache.size <= cacheMax) return;
    for (const [k, e] of cache) {
      if (e.state !== "pending") {
        cache.delete(k);
        break;
      }
    }
  }

  function get(z, x, y) {
    const key = `${z}/${x}/${y}`;
    const hit = cache.get(key);
    if (hit) {
      cache.delete(key); // LRU refresh
      cache.set(key, hit);
      return hit;
    }
    const entry = { state: "pending", tile: null };
    cache.set(key, entry);
    evict();

    const sub = TILE_SUBS[Math.abs(x + y) % TILE_SUBS.length];
    const url = `https://tiles-${sub}.basemaps.cartocdn.com/vectortiles/carto.streets/v1/${z}/${x}/${y}.mvt`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((ab) => {
        // An empty body is a legitimate "nothing here" (ocean at high zoom),
        // not a failure: bake an empty tile so we never refetch it.
        const bytes = new Uint8Array(ab);
        entry.tile = buildTile(bytes.length ? decodeTile(bytes) : {}, z, x, y);
        entry.state = "ready";
        okCount++;
        if (onTileReady) onTileReady();
      })
      .catch(() => {
        const wasOffline = isOffline();
        entry.state = "failed";
        failCount++;
        if (!wasOffline && isOffline() && onTileReady) onTileReady();
      });
    return entry;
  }

  return { get, isOffline, stats: () => ({ ok: okCount, failed: failCount, cached: cache.size }) };
}
