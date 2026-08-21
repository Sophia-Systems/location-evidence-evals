// render.js -- canvas rendering for the evidence-evaluation viz.
//
// v2 display plane: a hand-rolled global Web Mercator slippy map. Owns the
// view transform (wheel-zoom ~z2..z10, drag-pan anywhere on Earth), the tile
// basemap (Carto Positron light/dark, LRU cache, blank-on-404), the inlined
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

const EARTH_CIRC_KM = 40075.017; // equatorial circumference, km

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  // ---- theme ---------------------------------------------------------------
  let theme = {};
  let tileStyle = "light_all";
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
    // Carto style follows the page theme: Positron for light, dark_all for
    // dark. The tile cache is keyed by style, so a theme flip just fetches
    // (or re-uses) the other set.
    tileStyle = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark_all"
      : "light_all";
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
    const SAMPLES = 48; // per edge
    const pts = [];
    const edge = (x0, y0, x1, y1) => {
      for (let i = 0; i < SAMPLES; i++) {
        const t = i / SAMPLES;
        const ll = unprojectAt(windowCenter, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        pts.push([lonToWorldX(ll.lon), latToWorldY(ll.lat)]);
      }
    };
    const E = HALF_EXTENT;
    edge(-E, E, E, E); // north edge, west->east
    edge(E, E, E, -E); // east edge
    edge(E, -E, -E, -E); // south edge
    edge(-E, -E, -E, E); // west edge
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

  // ---- tile layer -----------------------------------------------------------
  // Carto Positron light_all / dark_all @2x with subdomain rotation, an LRU
  // cache, and blank-on-404 (the vector layer shows through). Offline is
  // detected from the first failure with zero successes; a single later
  // success clears it for good.
  const TILE_CACHE_MAX = 400;
  const tileCache = new Map(); // key -> {img, loaded, failed}
  const SUBDOMAINS = "abcd";
  let tileOk = 0;
  let tileFail = 0;
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

  const isOffline = () => tileFail > 0 && tileOk === 0;

  function getTile(style, z, x, y) {
    const key = `${style}/${z}/${x}/${y}`;
    let entry = tileCache.get(key);
    if (entry) {
      tileCache.delete(key); // LRU refresh
      tileCache.set(key, entry);
      return entry;
    }
    entry = { img: null, loaded: false, failed: false };
    tileCache.set(key, entry);
    if (tileCache.size > TILE_CACHE_MAX) {
      for (const [k, e] of tileCache) {
        if (e.loaded || e.failed) {
          tileCache.delete(k);
          break;
        }
      }
    }
    const sub = SUBDOMAINS[Math.abs(x + y) % SUBDOMAINS.length];
    const img = new Image();
    img.onload = () => {
      entry.loaded = true;
      tileOk++;
      scheduleRedraw();
    };
    img.onerror = () => {
      entry.failed = true;
      const wasOffline = isOffline();
      tileFail++;
      if (!wasOffline && isOffline()) scheduleRedraw(); // flip to fallback promptly
    };
    img.src = `https://${sub}.basemaps.cartocdn.com/${style}/${z}/${x}/${y}@2x.png`;
    entry.img = img;
    return entry;
  }

  function drawTiles() {
    const tileZ = Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom)));
    const tilesAcross = Math.pow(2, tileZ);
    const span = WORLD / tilesAcross; // world units per tile
    const [w0x, w0y] = cssToWorld(0, 0);
    const [w1x, w1y] = cssToWorld(wCss, hCss);
    const txMin = Math.floor(w0x / span);
    const txMax = Math.floor(w1x / span);
    const tyMin = Math.max(0, Math.floor(w0y / span));
    const tyMax = Math.min(tilesAcross - 1, Math.floor(w1y / span));
    for (let ty = tyMin; ty <= tyMax; ty++) {
      for (let tx = txMin; tx <= txMax; tx++) {
        const wrapped = ((tx % tilesAcross) + tilesAcross) % tilesAcross;
        const tile = getTile(tileStyle, tileZ, wrapped, ty);
        if (!tile.loaded) continue;
        const [px0, py0] = worldToCss(tx * span, ty * span);
        const [px1, py1] = worldToCss((tx + 1) * span, (ty + 1) * span);
        // a hair of overlap avoids seams from rounding
        ctx.drawImage(
          tile.img,
          Math.floor(px0),
          Math.floor(py0),
          Math.ceil(px1 - px0) + 1,
          Math.ceil(py1 - py0) + 1
        );
      }
    }
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

  // The declared star is translucent-filled and outline-defined so the
  // posterior field stays readable beneath it: in the fabrication demo the
  // fooled posterior's peak sits within a few cells of the declared spot,
  // and an opaque marker would hide exactly the evidence the demo exists to
  // show.
  function drawStar(px, py, r, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? r : r * 0.42;
      const x = px + rr * Math.cos(ang);
      const y = py + rr * Math.sin(ang);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = theme.halo;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.9;
    ctx.stroke(); // halo pass keeps the glyph legible on any field
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
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

    // tile basemap over the vector layer (loaded tiles cover it; failed or
    // pending tiles leave it showing)
    if (!offline) drawTiles();

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

    // offline fallback only: major-city dots + labels for orientation (tiles
    // carry their own labels; never double-label). Drawn above the heat wash
    // so they stay legible -- they are orientation furniture, like the
    // window boundary. Greedy label decluttering.
    if (offline) drawCities();

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

    // declared star
    if (scene.declared) {
      const [px, py] = latLonToCss(scene.declared.lat, scene.declared.lon);
      drawStar(px, py, 9, theme.accent);
      if (scene.labels) tinyLabel(px, py + 18, "declared");
    }

    // truth crosshair
    if (scene.truth) {
      const [px, py] = latLonToCss(scene.truth.lat, scene.truth.lon);
      drawCrosshair(px, py, 12);
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
  // Cover-fit the evaluation window with an inset (item 41): the visible
  // viewport sits strictly INSIDE the region under evaluation, centered on
  // the window center, so the window boundary and the heat's hard edge are
  // just off-screen by default and only appear on a deliberate zoom-out.
  // The fit is computed against the sampled boundary polygon, not its
  // Mercator bbox: the square's edges bow inward in Mercator near the
  // corners, so a bbox cover-fit would leave the corners poking into the
  // viewport. For each boundary point the minimal scale that pushes it
  // off-screen is min(w/2|dx|, h/2|dy|) (either axis suffices); the max
  // over all points is the exact inscribed cover for either viewport
  // aspect, and the 1.15 inset keeps the nearest boundary ~7.5% of the
  // viewport span beyond the edge. Used by the initial view, preset loads,
  // "evaluate here", and the reset-view control.
  function frameWindow() {
    resize();
    if (!boundaryPts || !(wCss > 0)) return;
    const cx = lonToWorldX(windowCenter.lon);
    const cy = latToWorldY(windowCenter.lat);
    let fit = 0;
    for (const [wx, wy] of boundaryPts) {
      const need = Math.min(
        wCss / (2 * Math.abs(wx - cx)),
        hCss / (2 * Math.abs(wy - cy))
      );
      if (need > fit) fit = need;
    }
    fit *= 1.15;
    zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, Math.log2(fit)));
    viewCenter = { wx: cx, wy: cy };
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
    resetView: frameWindow,
    frameWindow,
    // tiles
    setRedrawCallback,
    isOffline,
  };
}
