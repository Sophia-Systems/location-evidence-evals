// render.js -- canvas rendering for the evidence-evaluation viz.
//
// Owns: base map (quiet linework), the probability field (offscreen canvas at
// grid resolution, scaled up with smoothing), exclusion circles (crisp
// great-circle loci), markers (anchors, declared star, truth crosshair), and
// the km scale bar. All display-plane math comes from geo.js; the renderer
// never touches the model.

import { HALF_EXTENT, project, unproject, destination } from "./geo.js";
import { COAST, BORDERS, decodePolylines } from "./map-data.js";
import { RAMPS } from "./ramps.js";

const DOMAIN = 2 * HALF_EXTENT; // km

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  // ---- theme ---------------------------------------------------------------
  let theme = {};
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
  }
  refreshTheme();

  // ---- geometry --------------------------------------------------------
  // The canvas is full-bleed and generally NOT square (item 1: the map
  // extends to all four viewport edges). wCss/hCss are its css-px extent;
  // kmToCss/cssToKm compose a COVER-fit baseline (at zoom 1x the square
  // domain covers the whole viewport, cropping its top/bottom or sides as
  // the aspect ratio requires -- no dead bands, ever) with a pan/zoom view
  // transform (item 2) -- a pure 2D affine map, no reprojection. Every
  // caller (heat layer, coastlines/borders, exclusion circles, anchors,
  // declared star, truth crosshair, hover hit-testing, click-to-place)
  // goes through these two functions, so all of them transform together.
  let wCss = 0; // css px
  let hCss = 0; // css px
  let dpr = 1;

  const MIN_ZOOM = 1; // 1x = cover-fit: domain covers the viewport
  const MAX_ZOOM = 8;
  let viewScale = 1;
  let viewCenter = { x: 0, y: 0 }; // km, domain point at canvas center

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
    // a viewport resize changes the cover-fit scale, so the visible window
    // may now poke past the domain edge: re-clamp
    clampCenter();
  }

  // km per css px at the current zoom, cover-fit baseline against the
  // LONGER canvas dimension (so the domain covers the viewport at 1x,
  // whatever the aspect ratio -- the shorter dimension crops the domain).
  const pxPerKmNow = () => (Math.max(wCss, hCss) / DOMAIN) * viewScale;

  const kmToCss = (x, y) => {
    const s = pxPerKmNow();
    return [wCss / 2 + (x - viewCenter.x) * s, hCss / 2 - (y - viewCenter.y) * s];
  };
  const cssToKm = (px, py) => {
    const s = pxPerKmNow();
    return [viewCenter.x + (px - wCss / 2) / s, viewCenter.y - (py - hCss / 2) / s];
  };
  const latLonToCss = (lat, lon) => {
    const p = project(lat, lon);
    return kmToCss(p.x, p.y);
  };
  const cssToLatLon = (px, py) => {
    const [x, y] = cssToKm(px, py);
    return unproject(x, y);
  };

  // Tight pan clamp: the visible window must stay inside the domain square
  // at every zoom (cover-fit guarantees the window fits; this pins it), so
  // no outside-the-domain space -- dead background past the posterior grid
  // -- is ever on screen. On the axis the viewport exactly spans at the
  // current zoom the play is zero and the center pins to 0.
  function clampCenter() {
    const s = pxPerKmNow();
    if (!(s > 0)) return; // pre-layout: nothing to clamp against yet
    const playX = Math.max(0, HALF_EXTENT - wCss / (2 * s));
    const playY = Math.max(0, HALF_EXTENT - hCss / (2 * s));
    viewCenter.x = Math.max(-playX, Math.min(playX, viewCenter.x));
    viewCenter.y = Math.max(-playY, Math.min(playY, viewCenter.y));
  }

  // Cursor-centered zoom: the km point currently under (px, py) stays under
  // the cursor after the scale change.
  function setZoomAt(px, py, targetScale) {
    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetScale));
    if (newScale === viewScale) return;
    const [kx, ky] = cssToKm(px, py);
    viewScale = newScale;
    const s = pxPerKmNow();
    viewCenter = { x: kx - (px - wCss / 2) / s, y: ky + (py - hCss / 2) / s };
    clampCenter();
  }

  function zoomBy(px, py, factor) {
    setZoomAt(px, py, viewScale * factor);
  }

  // Drag-to-pan: dxPx/dyPx are the pointer's css-px movement since the last
  // frame (content should track the pointer, hence the sign choices below).
  function panBy(dxPx, dyPx) {
    const s = pxPerKmNow();
    viewCenter = { x: viewCenter.x - dxPx / s, y: viewCenter.y + dyPx / s };
    clampCenter();
  }

  function resetView() {
    viewScale = 1;
    viewCenter = { x: 0, y: 0 };
  }

  const getZoom = () => viewScale;
  const isDefaultView = () => viewScale === 1 && viewCenter.x === 0 && viewCenter.y === 0;

  // ---- base map (Path2D in km space, built once) ---------------------------
  function buildPaths(encoded) {
    const path = new Path2D();
    for (const line of decodePolylines(encoded)) {
      path.moveTo(line[0], -line[1]);
      for (let i = 1; i < line.length / 2; i++) path.lineTo(line[2 * i], -line[2 * i + 1]);
    }
    return path;
  }
  const coastPath = buildPaths(COAST);
  const borderPath = buildPaths(BORDERS);

  // ---- probability field ---------------------------------------------------
  let grid = null;
  let heatCanvas = document.createElement("canvas");
  let heatCtx = heatCanvas.getContext("2d");
  let heatImage = null;
  let hexMap = null; // Uint32Array pixel -> cell index (hex grids only)
  let hexBuf = 0;
  let rampName = "magma";
  let overlayOpacity = 0.75; // display preference (item 4): 0.1..1, persists across presets

  function setRamp(name) {
    rampName = name;
  }

  function setOpacity(v) {
    overlayOpacity = Math.max(0, Math.min(1, v));
  }

  function setGrid(g) {
    grid = g;
    if (g.shape === "square") {
      heatCanvas.width = g.n;
      heatCanvas.height = g.n;
      heatImage = heatCtx.createImageData(g.n, g.n);
      hexMap = null;
    } else {
      hexBuf = 512;
      heatCanvas.width = hexBuf;
      heatCanvas.height = hexBuf;
      heatImage = heatCtx.createImageData(hexBuf, hexBuf);
      buildHexMap(g);
    }
  }

  // Nearest-cell pixel map via coarse buckets (one-time per grid rebuild).
  function buildHexMap(g) {
    const { xs, ys, cellCount, stepKm } = g;
    const bs = stepKm; // bucket size km
    const nb = Math.ceil(DOMAIN / bs) + 1;
    const buckets = new Array(nb * nb);
    const bIdx = (x, y) =>
      Math.min(nb - 1, Math.max(0, Math.floor((x + HALF_EXTENT) / bs))) +
      nb * Math.min(nb - 1, Math.max(0, Math.floor((y + HALF_EXTENT) / bs)));
    for (let i = 0; i < cellCount; i++) {
      const b = bIdx(xs[i], ys[i]);
      (buckets[b] || (buckets[b] = [])).push(i);
    }
    hexMap = new Uint32Array(hexBuf * hexBuf);
    for (let py = 0; py < hexBuf; py++) {
      const y = HALF_EXTENT - ((py + 0.5) / hexBuf) * DOMAIN;
      for (let px = 0; px < hexBuf; px++) {
        const x = ((px + 0.5) / hexBuf) * DOMAIN - HALF_EXTENT;
        const bx = Math.floor((x + HALF_EXTENT) / bs);
        const by = Math.floor((y + HALF_EXTENT) / bs);
        let best = 0;
        let bestD = Infinity;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const gx = bx + ox;
            const gy = by + oy;
            if (gx < 0 || gy < 0 || gx >= nb || gy >= nb) continue;
            const list = buckets[gx + nb * gy];
            if (!list) continue;
            for (const i of list) {
              const dx = xs[i] - x;
              const dy = ys[i] - y;
              const d = dx * dx + dy * dy;
              if (d < bestD) {
                bestD = d;
                best = i;
              }
            }
          }
        }
        hexMap[px + hexBuf * py] = best;
      }
    }
  }

  // tArr: display-space value per cell in [0, 1]. The alpha curve is
  // deliberately quiet through the low-mid range (zero-structure fields and
  // single-receipt interiors sit there) so the basemap reads through the
  // wash, and only climbs steeply toward t = 1 -- saturation is earned by
  // concentration (ui.js buildTargetT scales t by confidence).
  function updateHeat(tArr) {
    const lut = RAMPS[rampName];
    const data = heatImage.data;
    const alphaFor = (t) => Math.round(255 * (0.045 + 0.875 * Math.pow(t, 1.8)));
    if (grid.shape === "square") {
      const n = grid.n;
      for (let j = 0; j < n; j++) {
        const row = (n - 1 - j) * n; // image row 0 = north
        for (let i = 0; i < n; i++) {
          const t = tArr[j * n + i];
          const k = (Math.max(0, Math.min(255, Math.round(t * 255)))) * 3;
          const o = (row + i) * 4;
          data[o] = lut[k];
          data[o + 1] = lut[k + 1];
          data[o + 2] = lut[k + 2];
          data[o + 3] = alphaFor(t);
        }
      }
    } else {
      const nPix = hexBuf * hexBuf;
      for (let p = 0; p < nPix; p++) {
        const t = tArr[hexMap[p]];
        const k = (Math.max(0, Math.min(255, Math.round(t * 255)))) * 3;
        const o = p * 4;
        data[o] = lut[k];
        data[o + 1] = lut[k + 1];
        data[o + 2] = lut[k + 2];
        data[o + 3] = alphaFor(t);
      }
    }
    heatCtx.putImageData(heatImage, 0, 0);
  }

  // ---- overlay helpers -----------------------------------------------------
  function circlePath(lat, lon, radiusKm) {
    const path = new Path2D();
    let first = true;
    for (let b = 0; b <= 360; b += 3) {
      const p = destination(lat, lon, b, radiusKm);
      const [px, py] = latLonToCss(p.lat, p.lon);
      if (first) {
        path.moveTo(px, py);
        first = false;
      } else path.lineTo(px, py);
    }
    path.closePath();
    return path;
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

  function niceScaleKm() {
    const target = Math.min(wCss, hCss) * 0.16; // px
    const kmPerPx = 1 / pxPerKmNow();
    const raw = target * kmPerPx;
    const steps = [50, 100, 200, 250, 500, 1000];
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

    // water / ground -- fills the full-bleed canvas. With cover-fit + the
    // tight pan clamp the visible area is always inside the domain, so this
    // never shows as a dead band; it is the ground under the heat layer.
    ctx.fillStyle = theme.water;
    ctx.fillRect(0, 0, wCss, hCss);

    // probability field: the heat canvas covers exactly the domain square
    // [-HALF_EXTENT, HALF_EXTENT]^2, drawn at its current view-transformed
    // position/size. Smoothing stays on so it doesn't pixelate harshly at
    // 8x (the grid-resolution slider is the control for real detail).
    const s = pxPerKmNow();
    const domainPx = DOMAIN * s;
    const [htlx, htly] = kmToCss(-HALF_EXTENT, HALF_EXTENT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.save();
    ctx.globalAlpha = overlayOpacity;
    ctx.drawImage(heatCanvas, htlx, htly, domainPx, domainPx);
    ctx.restore();

    // base linework above the field, kept quiet. Coast/border Path2D are
    // built in km space (y pre-negated); this transform is the same affine
    // map as kmToCss, expressed as a canvas CTM so Path2D stroking stays
    // fast (no per-vertex JS re-projection).
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(wCss / (2 * s) - viewCenter.x, hCss / (2 * s) + viewCenter.y);
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

    // exclusion circles -- crisp, per anchor
    for (const a of scene.anchors) {
      if (a.circleKm == null || a.circleKm <= 0) continue;
      const path = circlePath(a.lat, a.lon, a.circleKm);
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
      ctx.stroke(path);
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
    const w = km * pxPerKmNow();
    const x = 18;
    const y = hCss - 20;
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
    ctx.fillText(`${km} km`, x + w / 2, y - 7);
    ctx.restore();
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
    setRamp,
    setOpacity,
    updateHeat,
    draw,
    anchorAt,
    cssToLatLon,
    latLonToCss,
    getSizeCss: () => Math.min(wCss, hCss),
    // pan/zoom (item 2)
    getZoom,
    isDefaultView,
    setZoomAt,
    zoomBy,
    panBy,
    resetView,
  };
}
