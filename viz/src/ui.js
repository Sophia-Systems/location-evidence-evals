// ui.js -- DOM construction, controls, and orchestration for the
// evidence-evaluation viz. Composes the pure engine (engine.js) with the
// canvas renderer (render.js). All copy for info affordances lives here:
// every parameter gets plain language AND notation (PROMPT.md "Parameters").

import {
  createEngine,
  V_C,
  V_FIBER,
  PRESETS,
  FACILITIES,
  PI_PRESETS,
} from "./engine.js";
import { createRenderer } from "./render.js";
import { RAMP_NAMES, rampGradientCSS } from "./ramps.js";

const NOON = 12 * 3600 * 1000; // sim clock origin: 12:00:00 UTC, ms since midnight
const ANIM_MS = 350;

// ---------------------------------------------------------------------------
// Info affordance copy: plain language + notation, per PROMPT.md's example.
// ---------------------------------------------------------------------------
const INFO = {
  vc:
    "Exclusion radii are computed at lightspeed (v_c = 300 km/ms). Nothing physical outruns light, so a circle drawn at this speed is safe against any attester.",
  vfiber:
    "How fast signals actually travel in fiber: c/1.47 ≈ 204 km/ms. Used to simulate honest round trips and shape expectations inside a circle -- never for exclusion.",
  delta_att:
    "Time the attester's machine spends handling a probe before answering (δ_att). It sits inside every measurement; the verifier never observes it directly.",
  path_noise:
    "Extra delay from indirect routes and queueing. One-sided: it only ever adds time, so it can make a machine look farther away, never closer.",
  allowance:
    "Round-trip time the verifier writes off as processing before converting to distance (each 1 ms shrinks every radius by 150 km). Set it above the attester's true overhead and circles shrink below physics -- the assessment becomes wrong, not vague.",
  interior:
    "How quickly belief fades moving inward from a circle's edge. Kept deliberately slow: a receipt mostly says “not outside this circle”, and little about where inside it.",
  collusion:
    "The verifier's estimate of the chance this anchor colludes with the attester -- signing receipts for round trips it never measured. A risky anchor's evidence is partly explained away: its total influence caps at log2(1/risk) bits, however many receipts arrive.",
  grid:
    "The lattice holding the posterior over the region under evaluation (the dashed window). Display layout only -- every distance in the model is great-circle.",
  attack:
    "World truth: how the attester behaves. Inflating pads answers toward the declared location -- padding only adds time, so it cannot fake presence. Deflating answers faster than the verifier's allowance assumes -- the case that produces false presence.",
  floor:
    "Color is log-scaled relative to the brightest cell; a dim haze means the evidence discriminates little. Outside a circle, brightness never drops to zero -- residual doubt (collusion, forged signatures, faults) is kept explicit, and its depth is set by anchor trust.",
  posture:
    "The assumptions the current map is computed under -- they travel with any location assessment. This evaluator always assumes a compliant attester; the evasive scenario deliberately violates that so you can watch what it costs.",
};

// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const info = (key, extraClass = "") =>
  `<button class="info ${extraClass}" data-tip="${esc(INFO[key])}" aria-label="explain" type="button">i</button>`;

const fmtMsVal = (x, d = 3) => (x == null ? "—" : `${x.toFixed(d)} ms`);
const fmtKm = (x) => (x == null ? "—" : `${Math.round(x).toLocaleString("en-US")} km`);
function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600) % 24;
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

export function buildApp(root) {
  const engine = createEngine({ seed: (Date.now() % 100000) + 1 });

  const state = {
    presetId: "baseline",
    clockMs: NOON,
    revealTruth: false,
    ramp: "magma",
    opacity: 1,
    hoverId: null,
    dragId: null,
    dragMoved: false,
    placing: false,
    customSeq: 0,
    lastReadouts: null,
    minDist: new Map(), // anchor id -> min distance to any cell (impossible-receipt check)
  };

  // ---- scaffold -----------------------------------------------------------

  root.innerHTML = `
  <div id="app">
    <div class="map-pane">
      <canvas id="map"></canvas>

      <!-- left column: scenario card (the entry point) + evidence log -->
      <div class="left-col">
      <section class="card scenario-card">
        <div class="brand">
          <h1><span class="mark">◉</span> Location evidence</h1>
          <span class="sub">signed latency receipts → posterior belief · evidence evaluation, visualized</span>
        </div>
        <p class="blurb">Latency-based location verification asks machines at known
          locations -- <b>anchors</b> -- to probe a machine claiming to be somewhere,
          and to sign receipts of the round-trip time. Because nothing answers from
          farther away than light allows, each receipt bounds where the machine can
          be. The map shows the resulting <b>probability distribution over the
          machine's location</b>, updating as evidence accumulates.
          Part of ongoing research: <a href="https://johnx.co/research" target="_blank" rel="noopener">johnx.co/research</a>.</p>
        <details class="fold tutorial" id="tutorial-fold" open>
          <summary>how to use</summary>
          <div class="fold-body">
            <ol>
              <li>Pick a scenario below.</li>
              <li>Click an anchor (or “probe all”) to collect a signed receipt.</li>
              <li>Watch the probability distribution update on the map.</li>
              <li>Drag anchors to move them, or add new ones.</li>
              <li>Adjust parameters -- e.g. an anchor's collusion risk.</li>
            </ol>
          </div>
        </details>
        <div class="preset-chips" id="preset-chips"></div>
        <div class="preset-caption" id="preset-caption"></div>
        <div class="assumptions"><span id="assumptions-text"></span>${info("posture")}</div>
        <div class="scenario-actions">
          <label class="switch"><input type="checkbox" id="reveal-truth"><span>reveal truth</span></label>
          <button class="btn small" id="reset-btn" title="return to this preset's initial state">reset</button>
        </div>
      </section>

      <!-- evidence log: the accumulating set of signed receipts -->
      <section class="card evidence-card">
        <div class="evidence-head"><span>evidence</span><span class="evidence-count" id="evidence-count">no receipts yet</span></div>
        <div class="evidence-list" id="evidence-list"></div>
      </section>
      </div>

      <!-- parameters column: floating right side, collapsible, scrolls within itself -->
      <aside class="card params-card" id="params-card">
        <div class="params-head">
          <span>parameters</span>
          <button class="collapse-toggle" id="params-collapse" type="button" aria-label="collapse parameters" aria-expanded="true">▾</button>
        </div>
        <div class="params-scroll" id="params-scroll">
        <p class="params-intro">The anchors collecting evidence, the verifier's
          assumptions for interpreting it, and -- marked <b>simulation</b> -- the
          hidden world truth being measured, which no real verifier sees.</p>
        <section class="panel">
          <h2>anchors
            <span class="h-actions">
              <button class="btn small" id="probe-all">probe all</button>
              <span class="add-wrap">
                <button class="btn small primary" id="add-anchor">+ add</button>
                <div class="add-menu" id="add-menu"></div>
              </span>
            </span>
          </h2>
          <div class="anchor-list" id="anchor-list"></div>
          <div class="hint">click an anchor on the map to probe it · drag to move (moving clears its receipts)</div>
        </section>

        <section class="panel">
          <h2>verifier parameters</h2>
          <div class="row"><span class="lbl">allowance ${info("allowance")}</span>
            <input type="range" id="allowance" min="0" max="0.5" step="0.005" value="0">
            <span class="val" id="allowance-val"></span></div>
          <div class="row"><span class="lbl">interior fade μ ${info("interior")}</span>
            <input type="range" id="interior" min="0.2" max="5" step="0.1" value="1.2">
            <span class="val" id="interior-val"></span></div>
          <div class="row"><span class="lbl">v_c ${info("vc")}</span>
            <span class="fixed-val">300 km/ms · fixed (security bound)</span></div>
          <div class="row"><span class="lbl">v_fiber ${info("vfiber")}</span>
            <span class="fixed-val">204 km/ms · fixed (c/n, n = 1.47)</span></div>
        </section>

        <section class="panel">
          <h2>simulator · world truth <span class="h-actions"><span class="sim-tag" style="font:700 8.5px var(--font-mono);letter-spacing:.1em;color:var(--warn);border:1px solid var(--warn);border-radius:4px;padding:1px 5px;">simulation</span></span></h2>
          <div class="row"><span class="lbl">attester ${info("attack")}</span>
            <span class="seg" id="attack-seg"><button data-v="none">honest</button><button data-v="inflation">inflates</button><button data-v="deflation">deflates</button></span></div>
          <div class="row"><span class="lbl">δ_att (true) ${info("delta_att")}</span>
            <input type="range" id="delta-att" min="0" max="0.3" step="0.005" value="0.05">
            <span class="val" id="delta-att-val"></span></div>
          <div class="row"><span class="lbl">path noise mean ${info("path_noise")}</span>
            <input type="range" id="path-noise" min="0" max="0.5" step="0.01" value="0.1">
            <span class="val" id="path-noise-val"></span></div>
        </section>

        <section class="panel">
          <h2>display</h2>
          <div class="row"><span class="lbl">grid ${info("grid")}</span>
            <span class="seg" id="grid-seg"><button data-v="square">square</button><button data-v="hex">hex</button></span>
            <span class="val" id="grid-val"></span></div>
          <div class="row"><span class="lbl">resolution</span>
            <input type="range" id="grid-res" min="80" max="220" step="20" value="180">
            <span class="val" id="grid-res-val"></span></div>
          <div class="row" style="align-items:flex-start"><span class="lbl" style="padding-top:4px">color ramp</span>
            <span class="ramp-row" id="ramp-row" style="flex:1"></span></div>
          <div class="row"><span class="lbl">overlay opacity</span>
            <input type="range" id="opacity" min="10" max="100" step="5" value="100">
            <span class="val" id="opacity-val"></span></div>
        </section>

        <section class="panel">
          <h2>about</h2>
          <details class="fold" id="about-fold">
            <summary>about this model</summary>
            <div class="fold-body">
              <p>The posterior lives on the dashed ~3,600 km window -- the region under evaluation. Every distance is great-circle; country borders are drawn only to orient you.</p>
              <p>Everything here locates <i>the machine holding the attester's signing key</i>; binding that key to particular hardware is a separate, unsolved problem, and forged signatures would void every bound on this page.</p>
            </div>
          </details>
          <details class="fold probe-anatomy" id="anatomy-fold">
            <summary>anatomy of a probe</summary>
            <div class="fold-body">
              <p>One measurement is a four-packet exchange, timed on the <b>anchor's clock alone</b> -- no synchronization. The anchor signs the interval it measured; the attester relays the receipt but cannot alter it.</p>
              <svg viewBox="0 0 260 74" aria-label="round-trip delay budget">
                <line x1="10" y1="30" x2="250" y2="30" stroke="var(--line)" stroke-width="1"/>
                <line class="an-seg" x1="12" y1="30" x2="96" y2="30" stroke="#4f79b8"/>
                <line class="an-seg" x1="100" y1="30" x2="128" y2="30" stroke="var(--warn)"/>
                <line class="an-seg" x1="132" y1="30" x2="216" y2="30" stroke="#4f79b8"/>
                <line class="an-seg" x1="220" y1="30" x2="248" y2="30" stroke="var(--ink-faint)"/>
                <text class="an-lbl" x="14" y="16">path out</text>
                <text class="an-lbl" x="88" y="52">δ_att: wake, parse, sign</text>
                <text class="an-lbl" x="140" y="16">path back</text>
                <text class="an-lbl" x="212" y="52">queueing</text>
              </svg>
              <p>Every term besides propagation is <b>one-sided</b> -- it only adds time. So the minimum over many probes converges on true propagation from above, and honest noise fails safe: it loosens circles, never wrongly excludes the truth.</p>
            </div>
          </details>
        </section>
        </div>
      </aside>

      <div class="placing-note" id="placing-note">click the map to place the anchor · esc to cancel</div>

      <div class="hud">
        <button class="btn small view-btn" id="reset-view-btn" type="button" title="frame the region under evaluation">⤢ reset view</button>
        <div class="legend">
          <div class="title-row"><span>posterior probability</span>${info("floor")}</div>
          <div class="bar" id="legend-bar"></div>
          <div class="ends"><span>floor</span><span>log scale · dim = haze</span><span>peak</span></div>
        </div>
      </div>

      <div class="map-attribution" id="map-attribution">© OpenStreetMap contributors © CARTO</div>
      <div id="map-tip"></div>
    </div>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const canvas = $("#map");
  const attributionEl = $("#map-attribution");
  const renderer = createRenderer(canvas);
  renderer.setGrid(engine.getGrid());
  // async tile arrivals repaint the scene (coalesced to one per frame)
  renderer.setRedrawCallback(() => drawScene());

  // ---- display transform & animation --------------------------------------

  let displayT = null; // Float32Array, display-space [0,1] per cell
  let animFrom = null;
  let animTarget = null;
  let animT0 = 0;
  let animating = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Map the posterior to display values. Two jobs, deliberately separated:
  // spatial STRUCTURE (where belief sits, on a log scale relative to the
  // brightest cell) and overall CONFIDENCE (how much the evidence actually
  // discriminates). A fixed 6-decade window alone painted every
  // broad-but-not-flat field -- a trust-capped anchor's 1.5-decade ripple, a
  // continent-spanning single-receipt interior -- as a full-bleed
  // near-peak wash that read as confident signal. Now shallow fields have
  // their structure stretched over a minimum window so it stays visible,
  // and the whole field's intensity is scaled by confidence: vivid only when
  // the field is both DEEP (real dynamic range, not a capped ripple) and
  // CONCENTRATED (the bright end covers little of the domain). Haze reads
  // as haze; signal reads as signal.
  function buildTargetT(post) {
    const n = post.length;
    const t = new Float32Array(n);
    let pmax = 0;
    let pmin = Infinity;
    for (let i = 0; i < n; i++) {
      if (post[i] > pmax) pmax = post[i];
      if (post[i] < pmin) pmin = post[i];
    }
    if (!(pmax > 0) || pmax / Math.max(pmin, 1e-300) < 1.05) {
      // uniform belief carries no information: a barely-there tint that the
      // basemap clearly shows through -- saturation is earned by structure
      t.fill(0.22);
      return t;
    }
    // dynamic range in decades, capped at the model's 1e-6 relative floor.
    // Note the trust mixture bounds a single anchor's range at log10(1/pi)
    // (~1 decade at neutral trust): deep ranges only develop as multiple
    // anchors' floors multiply, which is exactly when confidence is earned.
    const decades = Math.log10(pmax / Math.max(pmin, pmax * 1e-6));
    // structure window: stretch shallow fields (a single receipt's 1-decade
    // drop, a trust-capped ripple) so their shape stays visible; the floor
    // keeps near-flat noise from being amplified into fake structure
    const W = Math.max(1.5, decades);
    const inv = 1 / pmax;
    const k = 1 / (W * Math.LN10);
    let bright = 0;
    for (let i = 0; i < n; i++) {
      const rel = post[i] * inv;
      const v = rel <= 1e-6 ? 0 : 1 + Math.log(rel) * k;
      const tv = v < 0 ? 0 : v;
      t[i] = tv;
      if (tv > 2 / 3) bright++;
    }
    const rangeConf = Math.min(1, decades / 5);
    const spanConf = (1 - bright / n) ** 2;
    const amp = 0.35 + 0.65 * rangeConf * spanConf;
    if (amp < 1) for (let i = 0; i < n; i++) t[i] *= amp;
    return t;
  }

  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

  function presentField(target, animate) {
    if (
      !animate ||
      reducedMotion.matches ||
      !displayT ||
      displayT.length !== target.length
    ) {
      displayT = Float32Array.from(target);
      renderer.updateHeat(displayT);
      drawScene();
      animating = false;
      return;
    }
    animFrom = Float32Array.from(displayT); // retarget from what is on screen
    animTarget = Float32Array.from(target);
    animT0 = performance.now();
    if (!animating) {
      animating = true;
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    if (!animating) return;
    const u = Math.min(1, (now - animT0) / ANIM_MS);
    const e = easeOutCubic(u);
    const n = animTarget.length;
    for (let i = 0; i < n; i++) {
      displayT[i] = animFrom[i] + (animTarget[i] - animFrom[i]) * e;
    }
    renderer.updateHeat(displayT);
    drawScene();
    if (u >= 1) {
      animating = false;
      return;
    }
    requestAnimationFrame(tick);
  }

  // ---- scene & refresh ----------------------------------------------------

  function computeMinDist(id) {
    const dist = engine.getAnchorDistField(id);
    let m = Infinity;
    for (let i = 0; i < dist.length; i++) if (dist[i] < m) m = dist[i];
    state.minDist.set(id, m);
  }

  function sceneData() {
    const sim = engine.getSimulator();
    const ro = state.lastReadouts ?? engine.getReadouts();
    const pos = new Map(engine.getAnchors().map((a) => [a.id, a]));
    return {
      anchors: ro.perAnchor.map((ra) => {
        const p = pos.get(ra.id);
        return {
          id: ra.id,
          name: ra.name,
          lat: p.lat,
          lon: p.lon,
          circleKm: ra.exclusionRadiusKm,
          dishonest: engine.isAnchorDishonest(ra.id),
          hovered: state.hoverId === ra.id,
          dragging: state.dragId === ra.id,
        };
      }),
      declared: sim.declared,
      truth: state.revealTruth ? sim.trueLocation : null,
      labels: true,
    };
  }

  function drawScene() {
    renderer.draw(sceneData());
    // tile attribution applies only while the tile basemap is in use; in
    // offline-fallback mode the geography is inlined Natural Earth (public
    // domain), so the credit line hides
    attributionEl.classList.toggle("hidden", renderer.isOffline());
  }

  function refresh({ animate = true } = {}) {
    const post = engine.computePosterior();
    state.lastReadouts = engine.getReadouts();
    presentField(buildTargetT(post), animate);
    updateAnchorCards();
    updateGlobalReadouts();
  }

  // ---- global readouts ----------------------------------------------------

  function updateGlobalReadouts() {
    const ro = state.lastReadouts;
    const ev = engine.getEvaluatorParams();
    const pis = ro.perAnchor.map((a) => a.pi);
    const piSummary = pis.length
      ? `collusion risk ${Math.min(...pis).toFixed(2)}–${Math.max(...pis).toFixed(2)}`
      : "no anchors";
    $("#assumptions-text").textContent =
      `assumes compliant attester · allowance ${ev.allowance.toFixed(3)} ms` +
      ` · ${piSummary} · uniform prior`;
    updateEvidenceLog();
  }

  // ---- clock & probing ----------------------------------------------------

  function advanceClock() {
    state.clockMs += 7000 + Math.floor(Math.random() * 6000);
  }

  function doProbe(anchorId) {
    engine.probe(anchorId, state.clockMs);
    advanceClock();
    refresh({ animate: true });
  }

  $("#probe-all").addEventListener("click", () => {
    engine.probeAll(state.clockMs);
    advanceClock();
    refresh({ animate: true });
  });

  // ---- evidence log -------------------------------------------------------
  // The accumulating evidence set: one row per signed receipt, newest first.
  // Rebuilt from engine state on every refresh, so rows vanish exactly when
  // their receipts do (preset load, reset, moving an anchor). Each row
  // expands to a simplified receipt modeled on location-proofs'
  // plugin-rtt-anchor LocationOffset -- key illustrative fields only, with
  // deterministic pseudo pubkeys/signatures standing in for the real ones.

  const evidenceOpen = new Set(); // keys of user-expanded rows
  let evidenceFingerprint = ""; // last-rendered receipt set; skip no-op rebuilds

  // Deterministic pseudo-hex (FNV-1a scramble) -- illustrative, not crypto.
  function fakeHex(str, len) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let out = "";
    while (out.length < len) {
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
      out += h.toString(16).padStart(8, "0");
    }
    return out.slice(0, len);
  }

  const receiptKey = (r) => `${r.anchorId}@${r.timestampMs}@${r.rtt}`;

  function receiptDetail(r, a) {
    return [
      `{`,
      `  anchor:        "${a.id}"`,
      `  anchor_pos:    [${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}]`,
      `  observed_at:   ${fmtClock(r.timestampMs)} UTC`,
      `  measured_rtt:  ${r.rtt.toFixed(3)} ms`,
      `  challenged:    true   // nonce echoed inside the measured window`,
      `  anchor_pubkey: ed25519:${fakeHex(a.id, 8)}…`,
      `  signature:     ed25519:${fakeHex(receiptKey(r), 8)}…   // over the fields above`,
      `}`,
    ].join("\n");
  }

  function updateEvidenceLog() {
    const rows = [];
    for (const a of engine.getAnchors()) {
      for (const r of engine.getAnchorReceipts(a.id)) rows.push({ r, a });
    }
    rows.sort((x, y) => y.r.timestampMs - x.r.timestampMs);
    $("#evidence-count").textContent =
      rows.length === 0
        ? "no receipts yet — probe an anchor"
        : `${rows.length} signed receipt${rows.length === 1 ? "" : "s"}`;
    const fingerprint = rows.map(({ r }) => receiptKey(r)).join("|");
    if (fingerprint === evidenceFingerprint) return;
    evidenceFingerprint = fingerprint;
    const live = new Set(rows.map(({ r }) => receiptKey(r)));
    for (const k of evidenceOpen) if (!live.has(k)) evidenceOpen.delete(k);
    $("#evidence-list").innerHTML = rows
      .map(({ r, a }) => {
        const key = receiptKey(r);
        return `<details class="receipt" data-key="${esc(key)}"${evidenceOpen.has(key) ? " open" : ""}>
          <summary><span class="r-time">${fmtClock(r.timestampMs)}</span><span class="r-name">${esc(a.name)}</span><span class="r-rtt">${r.rtt.toFixed(3)} ms</span></summary>
          <pre>${esc(receiptDetail(r, a))}</pre>
        </details>`;
      })
      .join("");
  }

  // rows are re-rendered wholesale, so open-state is tracked by key
  $("#evidence-list").addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLElement) || !d.dataset.key) return;
    if (d.open) evidenceOpen.add(d.dataset.key);
    else evidenceOpen.delete(d.dataset.key);
  }, true);

  // ---- anchor cards -------------------------------------------------------

  const cardRefs = new Map(); // id -> {el, stats, piSlider, piVal, bits, presetBtns, warnNote}

  function rebuildAnchorCards() {
    const list = $("#anchor-list");
    list.innerHTML = "";
    cardRefs.clear();
    for (const a of engine.getAnchors()) {
      if (!state.minDist.has(a.id)) computeMinDist(a.id);
      const el = document.createElement("div");
      el.className = "anchor-card";
      el.dataset.id = a.id;
      el.innerHTML = `
        <header>
          <span class="dot"></span>
          <span class="name">${esc(a.name)}</span>
          <button class="btn small primary probe-one" type="button">probe</button>
          <button class="btn small ghost remove-one" title="remove anchor" type="button">×</button>
        </header>
        <div class="stats">
          <span>latest RTT <b class="s-latest">—</b></span>
          <span>rtt_min <b class="s-min">—</b></span>
          <span>exclusion r <b class="s-radius">—</b></span>
          <span>receipts in T <b class="s-count">0</b></span>
        </div>
        <div class="pi-row">
          <span class="pi-lbl">collusion risk ${info("collusion")}</span>
          <input type="range" min="0.01" max="0.5" step="0.01" value="${a.pi}">
          <span class="pi-val">${a.pi.toFixed(2)}</span>
        </div>
        <div class="id-presets">
          <button data-pi="0.03" type="button">adversary 0.03</button>
          <button data-pi="0.10" type="button">neutral 0.10</button>
          <button data-pi="0.30" type="button">ally 0.30</button>
        </div>
        <div class="id-hint">an <b>adversary</b> of the attester's operator is least likely to cover for it — the most credible witness</div>
        <div class="bits">this anchor's influence caps at log2(1/risk) = <b class="s-bits"></b> bits</div>
        <div class="warn-note" hidden></div>`;
      list.appendChild(el);

      const refs = {
        el,
        latest: el.querySelector(".s-latest"),
        min: el.querySelector(".s-min"),
        radius: el.querySelector(".s-radius"),
        count: el.querySelector(".s-count"),
        piSlider: el.querySelector('input[type="range"]'),
        piVal: el.querySelector(".pi-val"),
        bits: el.querySelector(".s-bits"),
        presetBtns: [...el.querySelectorAll(".id-presets button")],
        warnNote: el.querySelector(".warn-note"),
      };
      cardRefs.set(a.id, refs);

      el.querySelector(".probe-one").addEventListener("click", () => doProbe(a.id));
      el.querySelector(".remove-one").addEventListener("click", () => {
        engine.removeAnchor(a.id);
        state.minDist.delete(a.id);
        if (state.hoverId === a.id) state.hoverId = null;
        rebuildAnchorCards();
        refresh({ animate: true });
        refreshAddMenu();
      });
      refs.piSlider.addEventListener("input", () => {
        engine.setAnchorPi(a.id, Number(refs.piSlider.value));
        refresh({ animate: false });
      });
      for (const b of refs.presetBtns) {
        b.addEventListener("click", () => {
          const v = Number(b.dataset.pi);
          engine.setAnchorPi(a.id, v);
          refs.piSlider.value = v;
          refresh({ animate: true });
        });
      }
      el.addEventListener("mouseenter", () => setHover(a.id));
      el.addEventListener("mouseleave", () => setHover(null));
    }
    updateAnchorCards();
    refreshAddMenu();
  }

  function updateAnchorCards() {
    const ro = state.lastReadouts ?? engine.getReadouts();
    for (const ra of ro.perAnchor) {
      const r = cardRefs.get(ra.id);
      if (!r) continue;
      r.latest.textContent = fmtMsVal(ra.latestRtt);
      r.min.textContent = fmtMsVal(ra.rttMin);
      r.radius.textContent = fmtKm(ra.exclusionRadiusKm);
      r.count.textContent = ra.receiptsInInterval;
      r.bits.textContent = ra.bitsCeiling.toFixed(1);
      if (Math.abs(Number(r.piSlider.value) - ra.pi) > 1e-9) r.piSlider.value = ra.pi;
      r.piVal.textContent = ra.pi.toFixed(2);
      for (const b of r.presetBtns) {
        b.classList.toggle("active", Math.abs(Number(b.dataset.pi) - ra.pi) < 1e-9);
      }
      r.el.classList.toggle("hovered", state.hoverId === ra.id);
      // impossible receipt: the bundle's floor excludes every cell (cells are
      // evaluated at the nearest point of their extent, hence the cellRadKm)
      const minD = state.minDist.get(ra.id) ?? 0;
      const impossible =
        ra.rttMin != null &&
        ra.exclusionRadiusKm != null &&
        ra.exclusionRadiusKm < minD - engine.getGrid().cellRadKm;
      r.warnNote.hidden = !impossible;
      if (impossible) {
        r.warnNote.textContent =
          "impossible receipt: the exclusion radius excludes every cell in the domain — this bundle contributes nothing (a physical impossibility under the honest model).";
      }
    }
  }

  // ---- add-anchor menu ----------------------------------------------------

  function refreshAddMenu() {
    const menu = $("#add-menu");
    const have = new Set(engine.getAnchors().map((a) => a.id));
    menu.innerHTML =
      FACILITIES.map(
        (f) =>
          `<button data-fid="${f.id}" ${have.has(f.id) ? "disabled" : ""} type="button">${esc(f.name)}</button>`
      ).join("") +
      `<div class="sep"></div><button data-place="1" type="button">click on the map…</button>`;
    for (const b of menu.querySelectorAll("button[data-fid]")) {
      b.addEventListener("click", () => {
        engine.addAnchor({ facility: b.dataset.fid });
        computeMinDist(b.dataset.fid);
        closeAddMenu();
        rebuildAnchorCards();
        refresh({ animate: true });
      });
    }
    menu.querySelector("button[data-place]").addEventListener("click", () => {
      closeAddMenu();
      setPlacing(true);
    });
  }

  const closeAddMenu = () => $("#add-menu").classList.remove("open");
  $("#add-anchor").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#add-menu").classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!$("#add-menu").contains(e.target)) closeAddMenu();
  });

  function setPlacing(on) {
    state.placing = on;
    canvas.classList.toggle("placing", on);
    $("#placing-note").classList.toggle("show", on);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setPlacing(false);
  });

  // ---- info popover -------------------------------------------------------
  // One shared, JS-positioned popover for every .info affordance. A pure-CSS
  // ::after popover gets clipped by its scrolling/overflow-hiding ancestors
  // (.controls scrolls, .map-pane hides overflow, .legend's backdrop-filter
  // forms a containing block), so the tip lives on <body> as position: fixed
  // and is placed from the icon's viewport rect, flipped and clamped to stay
  // fully on-screen.

  const infoPop = document.createElement("div");
  infoPop.id = "info-pop";
  infoPop.setAttribute("role", "tooltip");
  document.body.appendChild(infoPop);
  let infoBtn = null; // the .info button the popover is showing for
  let infoPinned = false; // opened by click/tap: survives pointer-out; closed by click/Escape/outside

  function positionInfoPop(btn) {
    const M = 8; // px viewport margin
    const r = btn.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const pw = infoPop.offsetWidth;
    const ph = infoPop.offsetHeight;
    // right-align the popover to the icon, then clamp into the viewport
    let left = r.right + 10 - pw;
    left = Math.max(M, Math.min(left, vw - pw - M));
    // prefer above the icon; flip below when there is no room, then clamp
    let top = r.top - 8 - ph;
    if (top < M) top = r.bottom + 8;
    top = Math.max(M, Math.min(top, vh - ph - M));
    infoPop.style.left = `${left}px`;
    infoPop.style.top = `${top}px`;
  }

  function showInfoPop(btn) {
    infoBtn = btn;
    infoPop.textContent = btn.dataset.tip;
    positionInfoPop(btn);
    infoPop.classList.add("show");
  }

  function hideInfoPop() {
    infoBtn = null;
    infoPinned = false;
    infoPop.classList.remove("show");
  }

  // Delegated: anchor cards are rebuilt wholesale, so per-button listeners
  // would leak or vanish. Hover and keyboard focus show the popover
  // transiently; a click PINS it (idempotent-show), a second click on the
  // same button -- or a click anywhere else, Escape, scroll, resize --
  // dismisses it. The pin flag is what keeps a tap from being a no-op: on
  // touch, pointerover fires immediately before click in the SAME tap, so a
  // plain toggle would hide what the tap's own hover just showed.
  document.addEventListener("pointerover", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".info") : null;
    if (btn) {
      if (btn !== infoBtn) {
        showInfoPop(btn);
        infoPinned = false;
      }
    } else if (infoBtn && !infoPinned) hideInfoPop();
  });
  document.addEventListener("focusin", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".info") : null;
    if (btn) {
      if (btn !== infoBtn) {
        showInfoPop(btn);
        infoPinned = false;
      }
    } else if (infoBtn && !infoPinned) hideInfoPop();
  });
  document.addEventListener("click", (e) => {
    // tap/click: idempotent-show that pins; a second click on the pinned
    // button (or any outside click) dismisses
    const btn = e.target instanceof Element ? e.target.closest(".info") : null;
    if (btn) {
      if (infoBtn === btn && infoPinned) hideInfoPop();
      else {
        showInfoPop(btn);
        infoPinned = true;
      }
    } else if (infoBtn) hideInfoPop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && infoBtn) hideInfoPop();
  });
  // scrolling or resizing invalidates the stored position
  document.addEventListener("scroll", () => hideInfoPop(), true);
  window.addEventListener("resize", () => hideInfoPop());

  // ---- map interaction ----------------------------------------------------

  const tip = $("#map-tip");

  function setHover(id) {
    if (state.hoverId === id) return;
    state.hoverId = id;
    canvas.classList.toggle("over-anchor", id != null && !state.placing);
    for (const [aid, r] of cardRefs) r.el.classList.toggle("hovered", aid === id);
    if (id == null) tip.classList.remove("show");
    drawScene();
  }

  function showTip(clientX, clientY, id) {
    const ro = state.lastReadouts ?? engine.getReadouts();
    const ra = ro.perAnchor.find((a) => a.id === id);
    if (!ra) return;
    tip.innerHTML = `
      <div class="tip-name">${esc(ra.name)}</div>
      <div class="tip-stats">latest RTT  ${fmtMsVal(ra.latestRtt)}
rtt_min     ${fmtMsVal(ra.rttMin)}
exclusion r ${fmtKm(ra.exclusionRadiusKm)}
collusion risk ${ra.pi.toFixed(2)}  ·  cap ${ra.bitsCeiling.toFixed(1)} bits</div>
      <div class="tip-hint">click to probe · drag to move</div>`;
    const pane = canvas.parentElement.getBoundingClientRect();
    tip.style.left = `${clientX - pane.left + 14}px`;
    tip.style.top = `${clientY - pane.top + 10}px`;
    tip.classList.add("show");
  }

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // Drag moves are throttled through requestAnimationFrame. The queued
  // callback must never trust its enqueue-time snapshot: it reads the LATEST
  // pointer position (dragLastX/Y, updated on every move) and bails out if the
  // drag ended before the frame fired -- pointerup in the same frame as the
  // last pointermove would otherwise call moveAnchor(null, ...) and throw.
  let movePending = null;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragDownX = 0;
  let dragDownY = 0;
  // Click-vs-drag threshold: pointer jitter of a few px during a click (mice,
  // trackpads) must still read as a click -- clicking IS the primary probe
  // interaction, and misreading it as a drag destructively clears the
  // anchor's receipts via moveAnchor. Only cumulative displacement beyond
  // this many px from the pointerdown position starts a drag.
  const DRAG_THRESHOLD_PX = 4;

  function cancelPendingDragMove() {
    if (movePending != null) {
      cancelAnimationFrame(movePending);
      movePending = null;
    }
  }

  function applyDragMove(animate) {
    const ll = renderer.cssToLatLon(dragLastX, dragLastY);
    engine.moveAnchor(state.dragId, ll.lat, ll.lon);
    computeMinDist(state.dragId);
    refresh({ animate });
  }

  // ---- pan (item 2) ---------------------------------------------------------
  // Drag-to-pan on empty map background. Anchor dragging above always wins:
  // pointerdown only starts a pan when anchorAt found nothing (or placing is
  // active). Pan only re-draws the view transform -- it never touches the
  // engine or recomputes the posterior, so it stays cheap at any zoom.
  let panning = false;
  let panMoved = false;
  let panDownX = 0;
  let panDownY = 0;
  let panLastX = 0;
  let panLastY = 0;
  let panDrawPending = null;

  function cancelPendingPanDraw() {
    if (panDrawPending != null) {
      cancelAnimationFrame(panDrawPending);
      panDrawPending = null;
    }
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (state.placing) return;
    const [px, py] = canvasPos(e);
    const id = renderer.anchorAt(px, py, sceneData().anchors);
    if (id) {
      state.dragId = id;
      state.dragMoved = false;
      dragDownX = px;
      dragDownY = py;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    panning = true;
    panMoved = false;
    panDownX = px;
    panDownY = py;
    panLastX = px;
    panLastY = py;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    const [px, py] = canvasPos(e);
    if (state.dragId) {
      if (!state.dragMoved) {
        // below the threshold this is still a click in progress, not a drag
        if (Math.hypot(px - dragDownX, py - dragDownY) < DRAG_THRESHOLD_PX) return;
        state.dragMoved = true;
        canvas.classList.add("dragging");
        tip.classList.remove("show");
      }
      dragLastX = px;
      dragLastY = py;
      if (movePending == null) {
        movePending = requestAnimationFrame(() => {
          movePending = null;
          if (state.dragId == null) return; // released before the frame fired
          applyDragMove(false);
        });
      }
      return;
    }
    if (panning) {
      if (!panMoved) {
        if (Math.hypot(px - panDownX, py - panDownY) < DRAG_THRESHOLD_PX) return;
        panMoved = true;
        canvas.classList.add("panning");
        tip.classList.remove("show");
      }
      // Applied immediately (cheap arithmetic, no recompute); only the
      // actual redraw is throttled to one per animation frame.
      renderer.panBy(px - panLastX, py - panLastY);
      panLastX = px;
      panLastY = py;
      if (panDrawPending == null) {
        panDrawPending = requestAnimationFrame(() => {
          panDrawPending = null;
          drawScene();
        });
      }
      return;
    }
    const id = renderer.anchorAt(px, py, sceneData().anchors);
    setHover(id);
    if (id) showTip(e.clientX, e.clientY, id);
    else tip.classList.remove("show");
  });

  canvas.addEventListener("pointerup", (e) => {
    if (state.dragId) {
      const id = state.dragId;
      const moved = state.dragMoved;
      cancelPendingDragMove();
      if (moved) {
        // flush the final movement segment at the release position
        const [px, py] = canvasPos(e);
        dragLastX = px;
        dragLastY = py;
        applyDragMove(true);
      }
      state.dragId = null;
      state.dragMoved = false;
      canvas.classList.remove("dragging");
      canvas.releasePointerCapture(e.pointerId);
      if (!moved) doProbe(id); // a click on an anchor IS the primary action
      return;
    }
    if (panning) {
      const moved = panMoved;
      cancelPendingPanDraw();
      panning = false;
      panMoved = false;
      canvas.classList.remove("panning");
      canvas.releasePointerCapture(e.pointerId);
      if (moved) drawScene(); // flush the final frame
      return; // an unmoved background click is a no-op, same as before
    }
    if (state.placing) {
      const [px, py] = canvasPos(e);
      const ll = renderer.cssToLatLon(px, py);
      const id = `custom-${++state.customSeq}`;
      engine.addAnchor({
        id,
        name: `Anchor @ ${ll.lat.toFixed(1)}°N ${ll.lon.toFixed(1)}°E`,
        lat: ll.lat,
        lon: ll.lon,
      });
      computeMinDist(id);
      setPlacing(false);
      rebuildAnchorCards();
      refresh({ animate: true });
    }
  });

  canvas.addEventListener("pointercancel", () => {
    if (state.dragId) {
      cancelPendingDragMove();
      const moved = state.dragMoved;
      state.dragId = null;
      state.dragMoved = false;
      canvas.classList.remove("dragging");
      if (moved) refresh({ animate: true }); // settle where the drag left it
      return;
    }
    if (panning) {
      cancelPendingPanDraw();
      panning = false;
      panMoved = false;
      canvas.classList.remove("panning");
    }
  });

  canvas.addEventListener("pointerleave", () => {
    if (!state.dragId && !panning) setHover(null);
  });

  // Cursor-centered wheel-zoom, 1x-8x (item 2). preventDefault so the page
  // never scrolls/pinch-zooms under the cursor instead. View-only: redraws
  // through the same transform pan uses, never recomputes the posterior.
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [px, py] = canvasPos(e);
      // Normalize deltaMode (0 = px, 1 = lines, 2 = pages) to a roughly
      // consistent feel across mice, trackpads, and browsers.
      const norm = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      renderer.zoomBy(px, py, Math.exp(-norm * 0.0015));
      drawScene();
    },
    { passive: false }
  );

  // ---- verifier parameter controls ----------------------------------------

  const allowanceEl = $("#allowance");
  function syncAllowanceLabel() {
    const v = Number(allowanceEl.value);
    $("#allowance-val").textContent = `${v.toFixed(3)} ms · −${Math.round(v * 150)} km`;
  }
  allowanceEl.addEventListener("input", () => {
    engine.setEvaluatorParams({ allowance: Number(allowanceEl.value) });
    syncAllowanceLabel();
    refresh({ animate: false });
  });

  const interiorEl = $("#interior");
  function syncInteriorLabel() {
    $("#interior-val").textContent = `${Number(interiorEl.value).toFixed(1)} ms`;
  }
  interiorEl.addEventListener("input", () => {
    engine.setEvaluatorParams({ assumed_interior_mean: Number(interiorEl.value) });
    syncInteriorLabel();
    refresh({ animate: false });
  });

  function wireSeg(sel, apply) {
    const seg = $(sel);
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      for (const x of seg.querySelectorAll("button")) x.classList.toggle("active", x === b);
      apply(b.dataset.v);
    });
    return {
      set(v) {
        for (const x of seg.querySelectorAll("button"))
          x.classList.toggle("active", x.dataset.v === v);
      },
    };
  }

  const attackSeg = wireSeg("#attack-seg", (v) => {
    engine.setSimulator({ attack: v });
  });

  const deltaEl = $("#delta-att");
  const syncDeltaLabel = () => {
    $("#delta-att-val").textContent = `${Number(deltaEl.value).toFixed(3)} ms`;
  };
  deltaEl.addEventListener("input", () => {
    engine.setSimulator({ delta_att: Number(deltaEl.value) });
    syncDeltaLabel();
  });

  const noiseEl = $("#path-noise");
  const syncNoiseLabel = () => {
    $("#path-noise-val").textContent = `${Number(noiseEl.value).toFixed(2)} ms`;
  };
  noiseEl.addEventListener("input", () => {
    engine.setSimulator({ path_noise_mean: Number(noiseEl.value) });
    syncNoiseLabel();
  });

  // ---- display controls ---------------------------------------------------

  const gridSeg = wireSeg("#grid-seg", (v) => {
    rebuildGrid(v, Number($("#grid-res").value));
  });

  const gridResEl = $("#grid-res");
  gridResEl.addEventListener("change", () => {
    rebuildGrid(currentShape(), Number(gridResEl.value));
  });
  gridResEl.addEventListener("input", () => syncGridLabels(Number(gridResEl.value)));

  const currentShape = () => engine.getGrid().shape;

  function syncGridLabels(n = engine.getGrid().n) {
    const g = engine.getGrid();
    $("#grid-res-val").textContent = `${n} × ${n}`;
    $("#grid-val").textContent = `${g.cellCount.toLocaleString("en-US")} cells`;
  }

  function rebuildGrid(shape, n) {
    engine.rebuildGrid({ shape, n });
    renderer.setGrid(engine.getGrid());
    displayT = null; // sizes changed: snap, don't tween across lattices
    for (const id of state.minDist.keys()) computeMinDist(id);
    syncGridLabels();
    gridSeg.set(shape);
    refresh({ animate: false });
  }

  // ramp selector
  {
    const row = $("#ramp-row");
    row.innerHTML = RAMP_NAMES.map(
      (name) =>
        `<button data-ramp="${name}" type="button"><span class="swatch" style="background:${rampGradientCSS(name)}"></span><span class="rname">${name}</span></button>`
    ).join("");
    row.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.ramp = b.dataset.ramp;
      for (const x of row.querySelectorAll("button"))
        x.classList.toggle("active", x === b);
      renderer.setRamp(state.ramp);
      $("#legend-bar").style.background = rampGradientCSS(state.ramp);
      if (displayT) {
        renderer.updateHeat(displayT);
        drawScene();
      }
    });
    row.querySelector(`button[data-ramp="${state.ramp}"]`).classList.add("active");
    renderer.setRamp(state.ramp);
    $("#legend-bar").style.background = rampGradientCSS(state.ramp);
  }

  // overlay opacity: a display preference (item 4), persists across presets
  {
    const el = $("#opacity");
    el.value = String(Math.round(state.opacity * 100));
    $("#opacity-val").textContent = `${el.value}%`;
    renderer.setOpacity(state.opacity);
    el.addEventListener("input", () => {
      state.opacity = Number(el.value) / 100;
      $("#opacity-val").textContent = `${el.value}%`;
      renderer.setOpacity(state.opacity);
      drawScene();
    });
  }

  // ---- scenario card --------------------------------------------------------

  $("#reveal-truth").addEventListener("change", (e) => {
    state.revealTruth = e.target.checked;
    drawScene();
  });

  $("#reset-btn").addEventListener("click", () => loadPreset(state.presetId));

  // ---- parameters column: collapsible (item 1) -----------------------------

  {
    const card = $("#params-card");
    const toggle = $("#params-collapse");
    toggle.addEventListener("click", () => {
      const collapsed = card.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "expand parameters" : "collapse parameters");
    });
  }

  // ---- view controls: reset pan/zoom (item 2) -------------------------------

  // Default-view framing (item 42): the default view frames the preset's
  // anchors plus the declared marker (current positions -- drags count) --
  // and the true location whenever it is revealed, so the evasive lesson's
  // two poles (claim and truth) are both on screen.
  const framePoints = () => {
    const sim = engine.getSimulator();
    const pts = [sim.declared, ...engine.getAnchors()];
    if (state.revealTruth) pts.push(sim.trueLocation);
    return pts;
  };
  // The parameters column floats over the canvas's right edge; a staged
  // anchor "on-canvas" underneath it is not visible, so framing targets the
  // unobstructed region (item 42).
  const frameObstruction = () => {
    const cardRect = $("#params-card").getBoundingClientRect();
    const mapRect = canvas.getBoundingClientRect();
    return Math.max(0, mapRect.right - cardRect.left);
  };

  $("#reset-view-btn").addEventListener("click", () => {
    renderer.frameWindow(framePoints(), frameObstruction());
    drawScene();
  });

  {
    const chips = $("#preset-chips");
    chips.innerHTML = PRESETS.map(
      (p, i) => `<button class="chip" data-preset="${p.id}" type="button">${i + 1} · ${esc(p.name)}</button>`
    ).join("");
    chips.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) loadPreset(b.dataset.preset);
    });
  }

  function loadPreset(id) {
    const preset = engine.loadPreset(id);
    state.presetId = id;
    state.clockMs = NOON;
    state.hoverId = null;
    state.minDist.clear();
    for (const a of engine.getAnchors()) computeMinDist(a.id);
    setPlacing(false);

    // reveal truth where the preset's lesson needs it (the evasive attester:
    // watching mass settle on the truth, not the claim, IS the lesson).
    // Set BEFORE framing: framePoints includes the truth when revealed.
    state.revealTruth = id === "evasive";
    $("#reveal-truth").checked = state.revealTruth;

    // the evaluation window recentered on the preset's staging (its pinned
    // windowCenter, or its declared location): sync the renderer's window
    // (boundary + heat raster) and frame all staged anchors plus the
    // declared marker, clamped inside the window (item 42)
    renderer.setWindow(engine.getWindowCenter());
    renderer.frameWindow(framePoints(), frameObstruction());

    // sync controls to engine state
    const ev = engine.getEvaluatorParams();
    allowanceEl.value = ev.allowance;
    syncAllowanceLabel();
    interiorEl.value = ev.assumed_interior_mean;
    syncInteriorLabel();
    const sim = engine.getSimulator();
    attackSeg.set(sim.attack);
    deltaEl.value = sim.delta_att;
    syncDeltaLabel();
    noiseEl.value = sim.path_noise_mean;
    syncNoiseLabel();

    // chips + caption
    for (const b of $("#preset-chips").querySelectorAll("button"))
      b.classList.toggle("active", b.dataset.preset === id);
    $("#preset-caption").textContent = preset.caption;

    // anatomy panel accompanies preset 1
    $("#anatomy-fold").style.display = id === "baseline" ? "" : "none";

    displayT = null; // fresh scenario: snap to its (uniform) prior
    rebuildAnchorCards();
    refresh({ animate: false });
  }

  // ---- environment listeners ----------------------------------------------

  const ro = new ResizeObserver(() => drawScene());
  ro.observe(canvas.parentElement);

  const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  const onTheme = () => {
    renderer.refreshTheme();
    drawScene();
  };
  if (darkMq.addEventListener) darkMq.addEventListener("change", onTheme);

  // ---- boot ---------------------------------------------------------------

  syncGridLabels();
  loadPreset("baseline");
}
