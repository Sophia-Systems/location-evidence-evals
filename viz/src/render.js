// render.js -- canvas rendering for the evidence-evaluation viz.
//
// v2 display plane: a hand-rolled global Web Mercator slippy map. Owns the
// view transform (wheel-zoom ~z2..z10, drag-pan anywhere on Earth), the
// vector tile basemap (MVT geometry decoded by vector-tiles.js and styled
// here from the page's own theme tokens, LRU cache), the inlined
// vector geography (offline fallback + placeholder while tiles load), the
// probability field (rasterized once per posterior update into an offscreen
// canvas in Mercator world space covering the evaluation window, then
// affine-blitted per frame), exclusion circles (geodesic polylines, split at
// the antimeridian), markers, the window boundary, and the km scale bar
// (latitude-local at the view center). All Mercator math comes from geo.js;
// the renderer never touches the model -- every distance that feeds physics
// stays great-circle inside the engine.

import {
  HALF_EXTENT,
  CENTER,
  WORLD,
  projectAt,
  unprojectAt,
  destination,
  lonToWorldX,
  latToWorldY,
  worldXToLon,
  worldYToLat,
} from "./geo.js";
import { COAST, BORDERS, CITIES, decodePolylines } from "./map-data.js";
import { RAMPS } from "./ramps.js";
import { createTileSource, STYLE, TILE_MAX_ZOOM } from "./vector-tiles.js";

const EARTH_CIRC_KM = 40075.017; // equatorial circumference, km

// Basemap road classes, drawn in this order (widest first). Each fades in
// over the zoom unit above the zoom its geometry starts arriving at, so a
// whole road class never pops onto the map at full weight.
const ROAD_CLASSES = ["motorway", "trunk", "primary", "secondary"];
const ROAD_FADE_IN = { motorway: 5, trunk: 6, primary: 8, secondary: 10 };
const LABEL_FONT = "'Avenir Next', 'Seravek', ui-sans-serif, system-ui, sans-serif";

// ---------------------------------------------------------------------------
// Default-view fit (DECISIONS.md item 42, superseding item 41's rule).
// Pure Mercator math, exported so the test suite can verify the framing
// geometry per preset without a DOM.
// ---------------------------------------------------------------------------

// Target margin between the framed points' bbox and the viewport edge, as a
// fraction of the viewport span per side. Compresses adaptively (down to
// FRAME_MIN via the cover clamp) when the window boundary would otherwise
// intrude -- see computeViewFit.
export const FRAME_MARGIN = 0.15;
// Inset factor on the boundary-cover clamp while framing points: the nearest
// window-boundary point ends up ~2.5% of the viewport span beyond the edge.
// Tighter than WINDOW_INSET because it competes with anchor visibility.
export const FRAME_INSET = 1.05;
// Item-41 inset for the no-points cover fit ("evaluate here", free framing):
// nearest boundary ~7.5% of the viewport span beyond the edge.
export const WINDOW_INSET = 1.15;

// Sample the evaluation window's boundary (the HALF_EXTENT square on the
// azimuthal plane around `center`) into Mercator world-unit points. The
// square's edges bow inward in Mercator near the corners, so every fit is
// computed against these samples, never against a bbox.
export function sampleWindowBoundary(center) {
  const SAMPLES = 48; // per edge
  const pts = [];
  const edge = (x0, y0, x1, y1) => {
    for (let i = 0; i < SAMPLES; i++) {
      const t = i / SAMPLES;
      const ll = unprojectAt(center, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      pts.push([lonToWorldX(ll.lon), latToWorldY(ll.lat)]);
    }
  };
  const E = HALF_EXTENT;
  edge(-E, E, E, E); // north edge, west->east
  edge(E, E, E, -E); // east edge
  edge(E, -E, -E, -E); // south edge
  edge(-E, -E, -E, E); // west edge
  return pts;
}

// Compute the default view for a wCss x hCss viewport over the window at
// `center`. With `points` (framed lat/lons: the preset's anchors plus the
// declared marker), the view centers on their bbox midpoint at scale
//   s = min(max(frame@FRAME_MARGIN, cover x FRAME_INSET), frame@0)
// -- frame the points with the target margin; if the window boundary would
// intrude at that scale, zoom in just enough to hide it (the margin
// compresses); never past the zero-margin frame, so the points themselves
// stay on-screen. Without points, the item-41 inset cover fit on the window
// center. `cover` is, per boundary sample, the minimal scale pushing it
// off-screen -- min(w/2|dx|, h/2|dy|) -- maximized over samples: the exact
// inscribed cover for any viewport aspect.
export function computeViewFit(wCss, hCss, center, points, boundarySamples) {
  const bPts = boundarySamples || sampleWindowBoundary(center);
  let cx = lonToWorldX(center.lon);
  let cy = latToWorldY(center.lat);
  let frame = null;
  let frame0 = null;
  if (points && points.length) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      const wx = lonToWorldX(p.lon);
      const wy = latToWorldY(p.lat);
      if (wx < x0) x0 = wx;
      if (wy < y0) y0 = wy;
      if (wx > x1) x1 = wx;
      if (wy > y1) y1 = wy;
    }
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
    const bw = Math.max(x1 - x0, 1e-9);
    const bh = Math.max(y1 - y0, 1e-9);
    frame = Math.min(
      (wCss * (1 - 2 * FRAME_MARGIN)) / bw,
      (hCss * (1 - 2 * FRAME_MARGIN)) / bh
    );
    frame0 = Math.min(wCss / bw, hCss / bh);
  }
  let cover = 0;
  for (const [wx, wy] of bPts) {
    const need = Math.min(
      wCss / (2 * Math.abs(wx - cx)),
      hCss / (2 * Math.abs(wy - cy))
    );
    if (need > cover) cover = need;
  }
  const scale =
    frame == null
      ? cover * WINDOW_INSET
      : Math.min(Math.max(frame, cover * FRAME_INSET), frame0);
  return { cx, cy, scale, frame, frame0, cover };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  // ---- theme ---------------------------------------------------------------
  let theme = {};
  let mapStyle = STYLE.light;
  function refreshTheme() {
    const cs = getComputedStyle(document.body);
    const v = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
    theme = {
      water: v("--map-water", "#f4f2ec"),
      coast: v("--map-coast", "#b9b4a6"),
      border: v("--map-border", "#cdc8ba"),
      ink: v("--ink", "#20241f"),
      inkFaint: v("--ink-faint", "#8a8f88"),
      accent: v("--accent", "#006a4e"),
      warn: v("--warn", "#b3591e"),
      halo: v("--surface", "#faf9f5"),
    };
    // The basemap style follows the page theme. Vector tiles carry geometry
    // only, so this is a pure repaint -- no refetch, no second tile set, and
    // the palette is the page's own rather than a vendor's.
    mapStyle = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? STYLE.dark
      : STYLE.light;
  }
  refreshTheme();

  // ---- view: Mercator world coords + zoom ----------------------------------
  // screen px = (world - viewCenter) * 2^zoom + canvasCenter. Pure affine, so
  // per-frame drawing is cheap: everything is either a Path2D stroked through
  // a canvas transform or an offscreen canvas blitted through drawImage.
  let wCss = 0;
  let hCss = 0;
  let dpr = 1;

  const ZOOM_FLOOR = 2; // "world view"
  const MAX_ZOOM = 10;
  let zoom = 4;
  let viewCenter = { wx: lonToWorldX(CENTER.lon), wy: latToWorldY(CENTER.lat) };

  // The world must always cover the viewport (single world copy, no wrap):
  // the effective minimum zoom rises with viewport size. On a typical laptop
  // this lands near z2.5 -- the whole Earth in view.
  const minZoom = () =>
    Math.max(ZOOM_FLOOR, Math.log2(Math.max(wCss, hCss, 1) / WORLD));

  const scaleNow = () => Math.pow(2, zoom); // css px per world unit

  function clampView() {
    if (zoom < minZoom()) zoom = minZoom();
    if (zoom > MAX_ZOOM) zoom = MAX_ZOOM;
    const s = scaleNow();
    const halfW = wCss / (2 * s);
    const halfH = hCss / (2 * s);
    viewCenter.wx = Math.max(halfW, Math.min(WORLD - halfW, viewCenter.wx));
    viewCenter.wy = Math.max(halfH, Math.min(WORLD - halfH, viewCenter.wy));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    wCss = rect.width;
    hCss = rect.height;
    dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(wCss * dpr));
    const ph = Math.max(1, Math.round(hCss * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    clampView();
  }

  const worldToCss = (wx, wy) => {
    const s = scaleNow();
    return [wCss / 2 + (wx - viewCenter.wx) * s, hCss / 2 + (wy - viewCenter.wy) * s];
  };
  const cssToWorld = (px, py) => {
    const s = scaleNow();
    return [viewCenter.wx + (px - wCss / 2) / s, viewCenter.wy + (py - hCss / 2) / s];
  };
  const latLonToCss = (lat, lon) => worldToCss(lonToWorldX(lon), latToWorldY(lat));
  const cssToLatLon = (px, py) => {
    const [wx, wy] = cssToWorld(px, py);
    return { lat: worldYToLat(wy), lon: worldXToLon(wx) };
  };

  // Cursor-centered zoom: the world point under (px, py) stays put.
  function setZoomAt(px, py, targetZoom) {
    const newZoom = Math.max(minZoom(), Math.min(MAX_ZOOM, targetZoom));
    if (newZoom === zoom) return;
    const [wx, wy] = cssToWorld(px, py);
    zoom = newZoom;
    const s = scaleNow();
    viewCenter = { wx: wx - (px - wCss / 2) / s, wy: wy - (py - hCss / 2) / s };
    clampView();
  }

  function zoomBy(px, py, factor) {
    setZoomAt(px, py, zoom + Math.log2(factor));
  }

  function panBy(dxPx, dyPx) {
    const s = scaleNow();
    viewCenter = { wx: viewCenter.wx - dxPx / s, wy: viewCenter.wy - dyPx / s };
    clampView();
  }

  const getZoom = () => zoom;
  const getViewCenterLatLon = () => ({
    lat: worldYToLat(viewCenter.wy),
    lon: worldXToLon(viewCenter.wx),
  });

  // ---- evaluation window ---------------------------------------------------
  // The engine's hypothesis space: a HALF_EXTENT-radius square on an
  // azimuthal plane centered on windowCenter. The renderer needs it three
  // ways: as a boundary path (the "region under evaluation" outline), as the
  // Mercator bbox its heat raster covers, and as the pixel->cell map that
  // rasterizes the posterior.
  let windowCenter = { ...CENTER };
  let boundaryPts = null; // world-unit [wx, wy] samples around the square
  let heatBox = null; // {wx0, wy0, wx1, wy1}

  function buildBoundary() {
    const pts = sampleWindowBoundary(windowCenter);
    boundaryPts = pts;
    let wx0 = Infinity;
    let wy0 = Infinity;
    let wx1 = -Infinity;
    let wy1 = -Infinity;
    for (const [wx, wy] of pts) {
      if (wx < wx0) wx0 = wx;
      if (wy < wy0) wy0 = wy;
      if (wx > wx1) wx1 = wx;
      if (wy > wy1) wy1 = wy;
    }
    heatBox = { wx0, wy0, wx1, wy1 };
  }

  // ---- probability field ---------------------------------------------------
  // Rasterized ONCE per posterior update: heatPixMap maps each offscreen
  // pixel (covering the window's Mercator bbox) to its grid cell, so
  // updateHeat is a straight per-pixel LUT write -- no projection math on the
  // hot path -- and draw() just affine-blits the offscreen through the view
  // transform. The map is rebuilt only when the grid or the window moves.
  let grid = null;
  const heatCanvas = document.createElement("canvas");
  const heatCtx = heatCanvas.getContext("2d");
  let heatImage = null;
  let heatPixMap = null; // Int32Array pixel -> cell index, -1 = outside window
  let rampName = "magma";
  let overlayOpacity = 0.75; // display preference: 0.1..1, persists across presets

  const HEAT_W = 640;

  function setRamp(name) {
    rampName = name;
  }

  function setOpacity(v) {
    overlayOpacity = Math.max(0, Math.min(1, v));
  }

  function setGrid(g) {
    grid = g;
    rebuildHeatLayer();
  }

  function setWindow(center) {
    windowCenter = { lat: center.lat, lon: center.lon };
    buildBoundary();
    rebuildHeatLayer();
  }

  buildBoundary();

  // Nearest-cell lookup for hex lattices via coarse buckets (square grids
  // index directly).
  function buildHexBuckets(g) {
    const { xs, ys, cellCount, stepKm } = g;
    const bs = stepKm;
    const nb = Math.ceil((2 * HALF_EXTENT) / bs) + 1;
    const buckets = new Array(nb * nb);
    for (let i = 0; i < cellCount; i++) {
      const bx = Math.min(nb - 1, Math.max(0, Math.floor((xs[i] + HALF_EXTENT) / bs)));
      const by = Math.min(nb - 1, Math.max(0, Math.floor((ys[i] + HALF_EXTENT) / bs)));
      const b = bx + nb * by;
      (buckets[b] || (buckets[b] = [])).push(i);
    }
    return { buckets, nb, bs };
  }

  function rebuildHeatLayer() {
    if (!grid || !heatBox) return;
    const bw = heatBox.wx1 - heatBox.wx0;
    const bh = heatBox.wy1 - heatBox.wy0;
    const w = HEAT_W;
    const h = Math.max(64, Math.min(1024, Math.round((HEAT_W * bh) / bw)));
    heatCanvas.width = w;
    heatCanvas.height = h;
    heatImage = heatCtx.createImageData(w, h);
    heatPixMap = new Int32Array(w * h).fill(-1);
    const { shape, n, xs, ys, stepKm } = grid;
    const hexB = shape === "hex" ? buildHexBuckets(grid) : null;
    const E = HALF_EXTENT;
    const lons = new Float64Array(w);
    for (let px = 0; px < w; px++) {
      lons[px] = worldXToLon(heatBox.wx0 + ((px + 0.5) / w) * bw);
    }
    for (let py = 0; py < h; py++) {
      const lat = worldYToLat(heatBox.wy0 + ((py + 0.5) / h) * bh);
      const row = py * w;
      for (let px = 0; px < w; px++) {
        const p = projectAt(windowCenter, lat, lons[px]);
        if (p.x < -E || p.x > E || p.y < -E || p.y > E) continue;
        if (shape === "square") {
          const i = Math.min(n - 1, Math.floor((p.x + E) / stepKm));
          const j = Math.min(n - 1, Math.floor((p.y + E) / stepKm));
          heatPixMap[row + px] = j * n + i;
        } else {
          const { buckets, nb, bs } = hexB;
          const bx = Math.min(nb - 1, Math.max(0, Math.floor((p.x + E) / bs)));
          const by = Math.min(nb - 1, Math.max(0, Math.floor((p.y + E) / bs)));
          let best = -1;
          let bestD = Infinity;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const gx = bx + ox;
              const gy = by + oy;
              if (gx < 0 || gy < 0 || gx >= nb || gy >= nb) continue;
              const list = buckets[gx + nb * gy];
              if (!list) continue;
              for (const i of list) {
                const dx = xs[i] - p.x;
                const dy = ys[i] - p.y;
                const d = dx * dx + dy * dy;
                if (d < bestD) {
                  bestD = d;
                  best = i;
                }
              }
            }
          }
          heatPixMap[row + px] = best;
        }
      }
    }
  }

  // tArr: display-space value per cell in [0, 1]. The alpha curve is
  // deliberately quiet through the low-mid range (zero-structure fields and
  // single-receipt interiors sit there) so the basemap reads through the
  // wash, and only climbs steeply toward t = 1 -- saturation is earned by
  // concentration (ui.js buildTargetT scales t by confidence).
  function updateHeat(tArr) {
    if (!heatImage) return;
    const lut = RAMPS[rampName];
    const data = heatImage.data;
    const nPix = heatPixMap.length;
    for (let p = 0; p < nPix; p++) {
      const cell = heatPixMap[p];
      const o = p * 4;
      if (cell < 0) {
        data[o + 3] = 0;
        continue;
      }
      const t = tArr[cell];
      const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
      data[o] = lut[k];
      data[o + 1] = lut[k + 1];
      data[o + 2] = lut[k + 2];
      data[o + 3] = Math.round(255 * (0.045 + 0.875 * Math.pow(t, 1.8)));
    }
    heatCtx.putImageData(heatImage, 0, 0);
  }

  // ---- vector base map (offline fallback / while-tiles-load) ---------------
  // Built once: global lon/lat polylines decoded into Path2D in Mercator
  // world units. Drawn through a canvas CTM (same affine map as worldToCss)
  // so stroking stays fast.
  function buildWorldPath(encoded) {
    const path = new Path2D();
    for (const line of decodePolylines(encoded)) {
      for (let i = 0; i < line.length / 2; i++) {
        const wx = lonToWorldX(line[2 * i]);
        const wy = latToWorldY(line[2 * i + 1]);
        if (i === 0) path.moveTo(wx, wy);
        else path.lineTo(wx, wy);
      }
    }
    return path;
  }
  const coastPath = buildWorldPath(COAST);
  const borderPath = buildWorldPath(BORDERS);

  // ---- vector tile layer ----------------------------------------------------
  // Carto's carto.streets MVT source, decoded and drawn by vector-tiles.js.
  // Offline detection keeps the raster layer's contract: the first failure
  // with zero successes flips to the inlined-geography fallback, and a single
  // later success clears it for good.
  let onRedraw = null;
  let redrawPending = false;

  function setRedrawCallback(fn) {
    onRedraw = fn;
  }

  function scheduleRedraw() {
    if (redrawPending || !onRedraw) return;
    redrawPending = true;
    requestAnimationFrame(() => {
      redrawPending = false;
      if (onRedraw) onRedraw();
    });
  }

  const tiles = createTileSource({ onTileReady: scheduleRedraw });
  const isOffline = () => tiles.isOffline();

  // The tiles covering the viewport at the current zoom, as
  // {tile, wx, wy, span} in world units. `wx` is the UNWRAPPED origin so a
  // tile fetched from the wrapped column still draws in the right place.
  function visibleTiles() {
    const tileZ = Math.max(0, Math.min(TILE_MAX_ZOOM, Math.round(zoom)));
    const across = Math.pow(2, tileZ);
    const span = WORLD / across;
    const [w0x, w0y] = cssToWorld(0, 0);
    const [w1x, w1y] = cssToWorld(wCss, hCss);
    const txMin = Math.floor(w0x / span);
    const txMax = Math.floor(w1x / span);
    const tyMin = Math.max(0, Math.floor(w0y / span));
    const tyMax = Math.min(across - 1, Math.floor(w1y / span));
    const out = [];
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const wrapped = ((tx % across) + across) % across;
        const entry = tiles.get(tileZ, wrapped, ty);
        if (entry.state !== "ready") continue;
        out.push({ t: entry.tile, wx: (tx - wrapped) * span, wy: 0, span });
      }
    }
    return out;
  }

  // Draw one style pass across ALL visible tiles before moving to the next.
  // Passing per-tile instead would let a neighbour's road casing overdraw the
  // road fill this tile already painted, leaving dark stubs at every seam --
  // tile geometry carries a buffer beyond the tile edge precisely so adjacent
  // tiles agree there, and drawing by layer is what makes that agreement show.
  function drawVectorTiles() {
    const list = visibleTiles();
    if (!list.length) return;
    const s = scaleNow();
    const m = mapStyle;

    ctx.save();
    ctx.translate(wCss / 2 - viewCenter.wx * s, hCss / 2 - viewCenter.wy * s);
    ctx.scale(s, s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Loaded tiles paint their own opaque ground, so the inlined vector
    // geography beneath keeps showing wherever a tile has not arrived yet.
    ctx.fillStyle = m.land;
    for (const { wx, wy, span } of list) {
      // a hair of overlap avoids hairline seams between neighbours
      ctx.fillRect(wx, wy, span * 1.002, span * 1.002);
    }

    const forEachPath = (get, fn) => {
      for (const item of list) {
        const path = get(item.t);
        if (!path) continue;
        ctx.save();
        ctx.translate(item.wx, item.wy);
        fn(path);
        ctx.restore();
      }
    };

    // green (parks, woodland) sits directly on the land ground
    ctx.fillStyle = m.green;
    forEachPath((t) => t.green, (p) => ctx.fill(p, "nonzero"));

    // water: fill only -- see the note in vector-tiles.js on why the
    // shoreline is a tonal step and not a stroke
    ctx.fillStyle = m.sea;
    forEachPath((t) => t.water, (p) => ctx.fill(p, "nonzero"));

    ctx.strokeStyle = m.waterway;
    ctx.lineWidth = 0.7 / s;
    forEachPath((t) => t.waterway, (p) => ctx.stroke(p));

    // roads: every casing first, then every fill (see the note above)
    const roadWidth = (cls) => {
      const base = { motorway: 2.6, trunk: 2.2, primary: 1.7, secondary: 1.2 }[cls];
      // taper the network in as it appears so a class never pops on at full weight
      const fade = Math.min(1, Math.max(0, zoom - ROAD_FADE_IN[cls]));
      return { w: base * fade, on: fade > 0.02 };
    };
    for (const cls of ROAD_CLASSES) {
      const { w, on } = roadWidth(cls);
      if (!on) continue;
      ctx.strokeStyle = m.roadCase;
      ctx.lineWidth = (w + 1.1) / s;
      forEachPath((t) => t.roads[cls], (p) => ctx.stroke(p));
    }
    for (const cls of ROAD_CLASSES) {
      const { w, on } = roadWidth(cls);
      if (!on) continue;
      ctx.strokeStyle = m.roadFill;
      ctx.lineWidth = w / s;
      forEachPath((t) => t.roads[cls], (p) => ctx.stroke(p));
    }

    // boundaries last of the linework, so they read over everything
    ctx.strokeStyle = m.boundaryState;
    ctx.lineWidth = 0.7 / s;
    ctx.globalAlpha = 0.8;
    ctx.setLineDash([3 / s, 3 / s]);
    forEachPath((t) => t.boundaryState, (p) => ctx.stroke(p));
    ctx.setLineDash([]);
    ctx.strokeStyle = m.boundary;
    ctx.lineWidth = 1.1 / s;
    ctx.globalAlpha = 1;
    forEachPath((t) => t.boundary, (p) => ctx.stroke(p));

    ctx.restore();
  }

  // Place labels from the tiles, drawn ABOVE the heat wash for legibility --
  // the same call the offline city labels get, and for the same reason. Names
  // render in the page's own UI typeface: the source's glyph atlases are SDF
  // PBFs we deliberately do not load.
  function drawTileLabels() {
    const list = visibleTiles();
    if (!list.length) return;
    const s = scaleNow();
    const cands = [];
    const seen = new Set();
    for (const item of list) {
      for (const l of item.t.labels) {
        if (zoom < l.minZoom) continue;
        if (seen.has(l.name)) continue; // tile buffers repeat names at seams
        const px = wCss / 2 + (l.wx + item.wx - viewCenter.wx) * s;
        const py = hCss / 2 + (l.wy + item.wy - viewCenter.wy) * s;
        if (px < -60 || px > wCss + 60 || py < -20 || py > hCss + 20) continue;
        seen.add(l.name);
        cands.push({ ...l, px, py });
      }
    }
    // most prominent first, so decluttering drops the minor names
    cands.sort((a, b) => a.minZoom - b.minZoom || a.rank - b.rank);

    ctx.save();
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const placed = [];
    for (const l of cands) {
      const isCountry = l.cls === "country";
      const size = isCountry ? 11 : l.cls === "state" ? 10 : l.capital > 0 ? 11 : 10;
      ctx.font = `${isCountry ? 600 : 500} ${size}px ${LABEL_FONT}`;
      const dot = l.cls === "city" || l.cls === "town";
      ctx.textAlign = dot ? "left" : "center";
      const w = ctx.measureText(l.name).width;
      const tx = dot ? l.px + 6 : l.px;
      const x0 = dot ? tx : tx - w / 2;
      const box = [x0 - 2, l.py - size * 0.7, x0 + w + 2, l.py + size * 0.7];
      let clash = false;
      for (const r of placed) {
        if (box[0] < r[2] && box[2] > r[0] && box[1] < r[3] && box[3] > r[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push(box);
      if (dot) {
        ctx.beginPath();
        ctx.arc(l.px, l.py, l.capital > 0 ? 2.6 : 2, 0, Math.PI * 2);
        ctx.fillStyle = mapStyle.label;
        ctx.fill();
      }
      ctx.lineWidth = 3;
      ctx.strokeStyle = mapStyle.labelHalo;
      ctx.fillStyle = mapStyle.label;
      if (isCountry) {
        ctx.letterSpacing = "0.06em";
      }
      ctx.strokeText(l.name, tx, l.py);
      ctx.fillText(l.name, tx, l.py);
      ctx.letterSpacing = "0px";
    }
    ctx.restore();
  }

  // ---- overlay helpers -----------------------------------------------------

  // Geodesic exclusion circle: ~180 points at fixed great-circle radius,
  // projected to Mercator. Longitudes are UNWRAPPED (each point shifted by a
  // multiple of the world width to stay adjacent to its predecessor) so a
  // circle crossing the antimeridian stays one continuous path; draw() then
  // strokes it again shifted a world-width left/right when it overflows,
  // which paints the wrapped half on the correct side.
  function circlePath(lat, lon, radiusKm) {
    const path = new Path2D();
    let firstWx = null;
    let prevWx = null;
    let minWx = Infinity;
    let maxWx = -Infinity;
    for (let b = 0; b <= 360; b += 2) {
      const p = destination(lat, lon, b, radiusKm);
      let wx = lonToWorldX(p.lon);
      const wy = latToWorldY(p.lat);
      if (prevWx != null) {
        while (wx - prevWx > WORLD / 2) wx -= WORLD;
        while (wx - prevWx < -WORLD / 2) wx += WORLD;
      }
      prevWx = wx;
      if (wx < minWx) minWx = wx;
      if (wx > maxWx) maxWx = wx;
      const [px, py] = worldToCss(wx, wy);
      if (firstWx == null) {
        firstWx = wx;
        path.moveTo(px, py);
      } else path.lineTo(px, py);
    }
    // A circle that ENCLOSES a pole winds once around all longitudes: its
    // unwrapped endpoints sit a world-width apart, and closing the path
    // would draw a spurious straight chord across the map. Leave wound
    // circles open (the shifted re-strokes make them visually continuous);
    // close ordinary ones.
    const wound = Math.abs(prevWx - firstWx) > WORLD / 2;
    if (!wound) path.closePath();
    return { path, wraps: wound || minWx < 0 || maxWx > WORLD };
  }

  function strokeWrapped(circle) {
    ctx.stroke(circle.path);
    if (circle.wraps) {
      const shift = WORLD * scaleNow();
      ctx.save();
      ctx.translate(shift, 0);
      ctx.stroke(circle.path);
      ctx.translate(-2 * shift, 0);
      ctx.stroke(circle.path);
      ctx.restore();
    }
  }

  // The declared marker is a translucent-filled circle, moderately larger
  // than an anchor dot, ringed in ink so it reads as "the claim under test"
  // rather than another anchor. Translucent so the posterior field stays
  // readable beneath it -- the evasive demo's peak sits within a few cells of
  // the declared spot, and an opaque marker would hide exactly the evidence
  // the demo exists to show. When declared == true, the truth crosshair's
  // graticule overlays it cleanly (crosshair r > this r). The mobile story
  // opts into a solid fill instead (scene.declaredSolid): its guided camera
  // keeps the peak visible around the marker, and the light interior read as
  // a rendering mistake there.
  function drawDeclared(px, py, r, color, solid) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.globalAlpha = solid ? 1 : 0.25;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = theme.halo;
    ctx.lineWidth = 4.5;
    ctx.stroke(); // halo pass keeps the ring legible on any field
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawCrosshair(px, py, r) {
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      ctx.moveTo(px + dx * r * 0.25, py + dy * r * 0.25);
      ctx.lineTo(px + dx * r, py + dy * r);
    }
    ctx.stroke();
    ctx.restore();
  }

  // km per css px at the view-center latitude. Mercator scale varies with
  // latitude, so the scale bar is LATITUDE-LOCAL: exact at the view center,
  // approximate away from it (stated in its label).
  function kmPerPxNow() {
    const lat = worldYToLat(viewCenter.wy);
    return (EARTH_CIRC_KM * Math.cos((lat * Math.PI) / 180)) / (WORLD * scaleNow());
  }

  function niceScaleKm() {
    const target = Math.min(wCss, hCss) * 0.16; // px
    const raw = target * kmPerPxNow();
    const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    let best = steps[0];
    for (const s of steps) if (Math.abs(s - raw) < Math.abs(best - raw)) best = s;
    return best;
  }

  // ---- main draw -----------------------------------------------------------
  // scene: { anchors: [{id, name, lat, lon, dishonest, circleKm, hovered,
  //          dragging}], declared: {lat,lon}, truth: {lat,lon}|null,
  //          labels: bool }
  function draw(scene) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, wCss, hCss);

    ctx.fillStyle = theme.water;
    ctx.fillRect(0, 0, wCss, hCss);

    const offline = isOffline();
    const s = scaleNow();

    // vector geography: beneath everything -- the offline fallback, and the
    // placeholder wherever a tile has not (yet) loaded, so the map is never
    // blank. The same affine map as worldToCss, expressed as a canvas CTM so
    // Path2D stroking stays fast.
    ctx.save();
    ctx.translate(wCss / 2 - viewCenter.wx * s, hCss / 2 - viewCenter.wy * s);
    ctx.scale(s, s);
    ctx.lineJoin = "round";
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 0.75 / s;
    ctx.globalAlpha = 0.55;
    ctx.stroke(borderPath);
    ctx.strokeStyle = theme.coast;
    ctx.lineWidth = 1 / s;
    ctx.globalAlpha = 0.9;
    ctx.stroke(coastPath);
    ctx.restore();
    ctx.globalAlpha = 1;

    // vector tile basemap over the inlined layer (loaded tiles paint their
    // own ground and cover it; failed or pending tiles leave it showing)
    if (!offline) drawVectorTiles();

    // probability field: the heat offscreen covers exactly the window's
    // Mercator bbox, blitted through the view transform. Smoothing stays on
    // so it reads as a field, not pixels (the grid-resolution slider is the
    // control for real detail).
    if (heatBox) {
      const [hx0, hy0] = worldToCss(heatBox.wx0, heatBox.wy0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.save();
      ctx.globalAlpha = overlayOpacity;
      ctx.drawImage(
        heatCanvas,
        hx0,
        hy0,
        (heatBox.wx1 - heatBox.wx0) * s,
        (heatBox.wy1 - heatBox.wy0) * s
      );
      ctx.restore();
    }

    // place labels, drawn above the heat wash so they stay legible -- they
    // are orientation furniture, like the window boundary. Online they come
    // from the tiles' `place` layer; offline, from the inlined MAJOR_CITIES
    // set. Never both: one source of names, so nothing is double-labelled.
    if (offline) drawCities();
    else drawTileLabels();

    // window boundary: the region under evaluation, quiet but present
    drawWindowBoundary(scene.labels);

    // exclusion circles -- crisp, per anchor, geodesic
    for (const a of scene.anchors) {
      if (a.circleKm == null || a.circleKm <= 0) continue;
      const circle = circlePath(a.lat, a.lon, a.circleKm);
      ctx.save();
      if (a.hovered) {
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.95;
      } else {
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 1.25;
        ctx.globalAlpha = 0.45;
      }
      if (a.dishonest) ctx.setLineDash([6, 4]);
      strokeWrapped(circle);
      ctx.restore();
    }

    // anchors
    for (const a of scene.anchors) {
      const [px, py] = latLonToCss(a.lat, a.lon);
      const r = a.hovered || a.dragging ? 7 : 5.5;
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = a.dishonest ? theme.warn : theme.accent;
      ctx.strokeStyle = theme.halo;
      ctx.lineWidth = 2;
      ctx.shadowColor = "rgba(0,0,0,0.3)";
      ctx.shadowBlur = a.hovered ? 6 : 3;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      if (a.dishonest) {
        // simulation marker: small dashed halo
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = theme.warn;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
      }
      ctx.restore();
    }

    // declared marker
    if (scene.declared) {
      const [px, py] = latLonToCss(scene.declared.lat, scene.declared.lon);
      drawDeclared(px, py, 9, theme.accent, !!scene.declaredSolid);
      if (scene.labels) tinyLabel(px, py + 18, "declared");
    }

    // truth crosshair
    if (scene.truth) {
      const [px, py] = latLonToCss(scene.truth.lat, scene.truth.lon);
      // sized so its graticule sits cleanly over the declared ring (r 9)
      // when declared == true: inner circle inside the ring, arms beyond it
      drawCrosshair(px, py, 14);
      // label above the crosshair so it never collides with the declared
      // label when declared == truth
      if (scene.labels) tinyLabel(px, py - 18, "true location");
    }

    drawScaleBar();
  }

  function drawWindowBoundary(withLabel) {
    if (!boundaryPts) return;
    const path = new Path2D();
    let topIdx = 0;
    for (let i = 0; i < boundaryPts.length; i++) {
      const [px, py] = worldToCss(boundaryPts[i][0], boundaryPts[i][1]);
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
      if (boundaryPts[i][1] < boundaryPts[topIdx][1]) topIdx = i;
    }
    path.closePath();
    ctx.save();
    ctx.strokeStyle = theme.inkFaint;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([2, 5]);
    ctx.globalAlpha = 0.85;
    ctx.stroke(path);
    ctx.restore();
    if (withLabel) {
      // label sits just above the boundary's northernmost sampled point
      const [px, py] = worldToCss(boundaryPts[topIdx][0], boundaryPts[topIdx][1]);
      if (py > -20 && py < hCss + 20) {
        ctx.save();
        ctx.font = "600 10px 'Avenir Next', 'Seravek', ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.halo;
        ctx.fillStyle = theme.inkFaint;
        ctx.strokeText("region under evaluation", px, py - 8);
        ctx.fillText("region under evaluation", px, py - 8);
        ctx.restore();
      }
    }
  }

  function drawCities() {
    ctx.save();
    ctx.font = "500 10px 'Avenir Next', 'Seravek', ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "left";
    const placed = [];
    for (const c of CITIES) {
      const [px, py] = latLonToCss(c.lat, c.lon);
      if (px < -40 || px > wCss + 40 || py < -20 || py > hCss + 20) continue;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = theme.inkFaint;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      // greedy declutter: skip the label (keep the dot) on overlap
      const lw = ctx.measureText(c.name).width;
      const rect = [px + 5, py - 8, px + 5 + lw, py + 4];
      let clash = false;
      for (const r of placed) {
        if (rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      placed.push(rect);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 3;
      ctx.strokeStyle = theme.halo;
      ctx.fillStyle = theme.inkFaint;
      ctx.strokeText(c.name, px + 5, py + 3);
      ctx.fillText(c.name, px + 5, py + 3);
    }
    ctx.restore();
  }

  function tinyLabel(px, py, text) {
    ctx.save();
    ctx.font =
      "500 10px 'Avenir Next', 'Seravek', ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.halo;
    ctx.fillStyle = theme.ink;
    ctx.strokeText(text, px, py);
    ctx.fillText(text, px, py);
    ctx.restore();
  }

  function drawScaleBar() {
    const km = niceScaleKm();
    const w = km / kmPerPxNow();
    const x = 18;
    // sit clear of the assumptions readout, which floats bottom-left over
    // the canvas (bottom: 16px, ~30px tall)
    const y = hCss - 58;
    const lat = worldYToLat(viewCenter.wy);
    const latLabel = `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? "N" : "S"}`;
    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.fillStyle = theme.ink;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y - 4);
    ctx.stroke();
    ctx.font = "500 10px 'SF Mono', 'Menlo', ui-monospace, monospace";
    ctx.textAlign = "center";
    // Mercator scale is latitude-dependent: state where this bar is true
    ctx.fillText(`${km} km at ${latLabel}`, x + w / 2, y - 7);
    ctx.restore();
  }

  // ---- view framing --------------------------------------------------------
  // Default view (item 42, superseding item 41's rule): with `points` (the
  // preset's staged anchors plus the declared marker), frame them all with a
  // comfortable margin, clamped -- via computeViewFit -- so the visible
  // viewport still sits strictly inside the evaluation window and the
  // window boundary / heat edge stay off-screen. Without points ("evaluate
  // here", free recentering), the item-41 inset cover fit on the window
  // center. Points outside the window can never be framed within it, so
  // they are dropped; if none survive, fall back to the cover fit. Used by
  // the initial view, preset loads, "evaluate here", and reset-view.
  //
  // `obstructRight` (css px) is the width of opaque UI overlaying the
  // canvas's right edge (the parameters column): the fit runs on the
  // unobstructed region -- a point "on-canvas" under the card is not
  // visible, and a boundary segment under the card cannot be seen either --
  // and the framed staging is centered in that region, not the full canvas.
  // Capped so a very narrow canvas never collapses the frame region.
  function frameWindow(points, obstructRight = 0, obstructLeft = 0) {
    resize();
    if (!boundaryPts || !(wCss > 0)) return;
    let framed = null;
    if (points && points.length) {
      framed = points.filter((p) => {
        const q = projectAt(windowCenter, p.lat, p.lon);
        return Math.abs(q.x) <= HALF_EXTENT && Math.abs(q.y) <= HALF_EXTENT;
      });
      if (!framed.length) framed = null;
    }
    const cutR = Math.max(0, obstructRight);
    const cutL = Math.max(0, obstructLeft);
    const effW = framed ? Math.max(wCss - cutR - cutL, wCss * 0.45) : wCss;
    const fit = computeViewFit(effW, hCss, windowCenter, framed, boundaryPts);
    zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, Math.log2(fit.scale)));
    const s = Math.pow(2, zoom);
    // place the fit center at the middle of the unobstructed region
    // (canvas center minus region center, in world units)
    viewCenter = { wx: fit.cx + (wCss / 2 - cutL - effW / 2) / s, wy: fit.cy };
    clampView();
  }

  // ---- hit testing ---------------------------------------------------------
  function anchorAt(px, py, anchors) {
    let best = null;
    let bestD = 12 * 12; // px radius
    for (const a of anchors) {
      const [ax, ay] = latLonToCss(a.lat, a.lon);
      const d = (ax - px) ** 2 + (ay - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    return best;
  }

  // Raw view accessors, for callers that tween the camera themselves (the
  // mobile story animates between frameWindow fits): read the view, restore
  // it, interpolate zoom linearly (log-space scale) and the center in world
  // units, calling setView per frame. setView clamps like every other path.
  const getView = () => ({ wx: viewCenter.wx, wy: viewCenter.wy, zoom });
  function setView(v) {
    zoom = v.zoom;
    viewCenter = { wx: v.wx, wy: v.wy };
    clampView();
  }

  return {
    resize,
    refreshTheme,
    setGrid,
    setWindow,
    setRamp,
    setOpacity,
    updateHeat,
    draw,
    anchorAt,
    cssToLatLon,
    latLonToCss,
    getSizeCss: () => Math.min(wCss, hCss),
    // pan/zoom
    getZoom,
    getViewCenterLatLon,
    setZoomAt,
    zoomBy,
    panBy,
    getView,
    setView,
    resetView: frameWindow,
    frameWindow,
    // tiles
    setRedrawCallback,
    isOffline,
  };
}
