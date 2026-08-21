// story.js -- the mobile scroll story: a step-through of the one key idea
// (belief concentrates by exclusion, so false location claims are
// detectable), told over the same engine and renderer as the full bench.
//
// Structure: one sticky full-viewport map canvas behind a column of step
// cards. Scrolling (or tapping "next") advances through six beats:
//   0 the claim        -- declared marker, uniform belief, anchors standing by
//   1 one receipt      -- a probe erases the outside of a circle
//   2 geometry         -- four bearings collapse belief onto the truth
//   3 trust            -- the same receipts from half-trusted anchors prove less
//   4 the lie          -- an evasive attester pads toward Tallinn; belief refuses
//   5 detection        -- truth revealed in St Petersburg; the claim is falsified
//
// Steps are CUMULATIVE engine operations replayed from a fixed-seed base, so
// any entry order (scroll down, up, jump via the rail) reproduces the exact
// same state: activating step i either plays step i's stages on top of step
// i-1's settled state (the natural forward path, with stagger) or silently
// rebuilds base + ops(0..i) and tweens the field once. The map takes no
// pointer input -- free exploration is the desktop bench's job, linked at
// the end.

import { createEngine } from "./engine.js";
import { createRenderer, computeViewFit } from "./render.js";

// Story timing
const FIELD_MS = 400; // posterior tween, matches the bench's feel
const CAMERA_MS = 750;

// Stage coordinates (mirrors of engine.js constants + FACILITIES entries;
// static so a step's framing never depends on engine timing). Namespaced in
// one object because the built page concatenates modules into a single
// scope where engine.js already declares CAMBRIDGE / TALLINN / etc.
const STORY_LOC = {
  cambridge: { lat: 52.205, lon: 0.119 },
  tallinn: { lat: 59.437, lon: 24.754 },
  stPetersburg: { lat: 59.934, lon: 30.335 },
  helsinki: { lat: 60.404, lon: 25.106 },
  falkenstein: { lat: 50.479, lon: 12.337 },
  paris: { lat: 48.928, lon: 2.353 },
  london: { lat: 51.512, lon: -0.003 },
  hamina: { lat: 60.537, lon: 27.198 },
  stockholm: { lat: 59.329, lon: 18.069 },
};

const BASE_STAGE = [
  STORY_LOC.cambridge,
  STORY_LOC.helsinki,
  STORY_LOC.falkenstein,
  STORY_LOC.paris,
  STORY_LOC.london,
];
const EVASIVE_STAGE = [
  STORY_LOC.tallinn,
  STORY_LOC.helsinki,
  STORY_LOC.hamina,
  STORY_LOC.stockholm,
];
const EVASIVE_TRUTH = [...EVASIVE_STAGE, STORY_LOC.stPetersburg];

// ---------------------------------------------------------------------------
// The script. Each step: card copy, cumulative engine stages (delay ms from
// step activation), the camera frame, and whether truth is revealed.
// ---------------------------------------------------------------------------

const STEPS = [
  {
    id: "claim",
    eyebrow: "the claim",
    frame: BASE_STAGE,
    reveal: false,
    stages: [
      {
        delay: 0,
        fn: (e) => {
          e.loadPreset("baseline");
          e.setSeed(7);
        },
      },
    ],
    card: `
      <div class="story-kicker">location evidence, in five steps</div>
      <h1>A machine says: I&rsquo;m&nbsp;in&nbsp;Cambridge.</h1>
      <p>Can anyone check, without taking its operator&rsquo;s word for it?
      The ringed marker is the claim. The colored wash is belief about where
      the machine <strong>really</strong> is &mdash; so far, anywhere. The
      green dots are <strong>anchors</strong>: machines at known locations,
      ready to test the claim.</p>
      <svg class="scroll-cue" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
  },
  {
    id: "receipt",
    eyebrow: "one receipt",
    frame: BASE_STAGE,
    reveal: false,
    stages: [{ delay: 250, fn: (e) => e.probe("hetzner-helsinki", 0) }],
    card: `
      <h2>Evidence that erases</h2>
      <p>The Helsinki anchor sends a probe; the machine answers; the round
      trip is timed and <strong>signed</strong>. Light has a speed limit, so
      one receipt proves the machine sits somewhere inside a circle &mdash;
      and erases everything outside it.</p>
      <p>A receipt never points at a location. It <strong>excludes</strong>.</p>`,
  },
  {
    id: "geometry",
    eyebrow: "geometry",
    frame: BASE_STAGE,
    reveal: false,
    stages: [
      { delay: 250, fn: (e) => e.probe("hetzner-falkenstein", 1) },
      { delay: 900, fn: (e) => e.probe("equinix-paris", 2) },
      { delay: 1550, fn: (e) => e.probe("equinix-london", 3) },
    ],
    card: `
      <h2>Circles that agree in one place</h2>
      <p>Anchors at different bearings each erase their own outside. The
      circles overlap in only one region, and belief collapses onto
      Cambridge.</p>
      <p>No anchor ever saw the machine. <strong>Exclusion alone found
      it.</strong></p>`,
  },
  {
    id: "trust",
    eyebrow: "trust",
    frame: BASE_STAGE,
    reveal: false,
    stages: [
      {
        delay: 250,
        fn: (e) => {
          for (const a of e.getAnchors()) e.setAnchorPi(a.id, 0.3);
        },
      },
    ],
    card: `
      <h2>Evidence is only as good as its witnesses</h2>
      <p>Suppose each anchor might be colluding with the machine&rsquo;s
      operator. The receipts haven&rsquo;t changed &mdash; but each one now
      proves less, because &ldquo;the anchor made it up&rdquo; partly explains
      it away. The map goes hazy.</p>
      <p>Strong assessments need <strong>independent, diverse anchors</strong>,
      not just more receipts.</p>`,
  },
  {
    id: "lie",
    eyebrow: "the lie",
    frame: EVASIVE_STAGE,
    reveal: false,
    stages: [
      {
        delay: 0,
        fn: (e) => {
          e.loadPreset("evasive");
          e.setSeed(21);
        },
      },
      { delay: 900, fn: (e) => e.probeAll(0) },
      { delay: 1600, fn: (e) => e.probeAll(1) },
      { delay: 2300, fn: (e) => e.probeAll(2) },
    ],
    card: `
      <h2>Now a machine lies</h2>
      <p>This one declares <strong>Tallinn</strong> &mdash; but it isn&rsquo;t
      there. It delays each answer by just enough to mimic the distances
      Tallinn would show.</p>
      <p>Watch where belief settles. Not on the claim.</p>`,
  },
  {
    id: "detection",
    eyebrow: "detection",
    frame: EVASIVE_TRUTH,
    reveal: true,
    stages: [],
    card: `
      <h2>The lie doesn&rsquo;t survive the physics</h2>
      <p>The machine was in <strong>St Petersburg</strong>. Padding can only
      ever <em>add</em> time &mdash; it makes a machine look farther from an
      anchor, never closer &mdash; so no padding schedule could satisfy every
      anchor at once. Belief settled on the truth: <strong>the false claim is
      detectable</strong>.</p>
      <p class="aside">This holds as long as the anchors are independent and
      the verifier doesn&rsquo;t write off too much of the measured time as
      &ldquo;processing.&rdquo; The full demo lets you break both and watch
      the assessment fail.</p>
      <div class="story-links">
        <a class="primary" href="./index.html?full">Explore the full demo (desktop)</a>
        <a class="secondary" href="https://johnx.co/research">About this research</a>
      </div>`,
  },
];

// ---------------------------------------------------------------------------

function buildStory(root) {
  root.innerHTML = `
  <div class="story">
    <div class="story-graphic">
      <canvas id="story-map"></canvas>
      <div class="story-attribution">&copy; OpenStreetMap contributors &copy; CARTO</div>
    </div>
    <div class="story-steps">
      ${STEPS.map(
        (s, i) => `
      <section class="story-step" data-step="${i}">
        <div class="story-card">
          <div class="story-eyebrow"><span class="n">${String(i + 1).padStart(2, "0")} / ${String(STEPS.length).padStart(2, "0")}</span> ${s.eyebrow}</div>
          ${s.card}
          ${
            i < STEPS.length - 1
              ? `<button class="story-next" data-next="${i + 1}">next &darr;</button>`
              : ""
          }
        </div>
      </section>`
      ).join("")}
    </div>
    <nav class="story-rail" aria-label="story progress">
      ${STEPS.map(
        (s, i) =>
          `<button data-goto="${i}" aria-label="step ${i + 1}: ${s.eyebrow}"></button>`
      ).join("")}
    </nav>
  </div>`;

  const canvas = root.querySelector("#story-map");
  const attributionEl = root.querySelector(".story-attribution");
  const sections = [...root.querySelectorAll(".story-step")];
  const railDots = [...root.querySelectorAll(".story-rail button")];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const engine = createEngine({ seed: 7 });
  const renderer = createRenderer(canvas);
  renderer.setGrid(engine.getGrid());
  renderer.setRedrawCallback(() => drawScene());
  // Full-strength overlay (the bench's own default since DECISIONS item 43):
  // the story narrates the wash, so it must be plainly visible.
  renderer.setOpacity(1);

  // ---- scene ---------------------------------------------------------------

  let currentStep = 0;

  function sceneData() {
    const sim = engine.getSimulator();
    const ro = engine.getReadouts();
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
          dishonest: false,
          hovered: false,
          dragging: false,
        };
      }),
      declared: sim.declared,
      truth: STEPS[currentStep].reveal ? sim.trueLocation : null,
      labels: true,
    };
  }

  function drawScene() {
    renderer.draw(sceneData());
    attributionEl.classList.toggle("hidden", renderer.isOffline());
  }

  // ---- posterior display tween --------------------------------------------
  // Mirrors ui.js (buildTargetT / presentField): structure on a log scale
  // relative to the brightest cell, intensity scaled by confidence, tweened
  // interruptibly. Copied rather than shared because ui.js keeps these
  // private to buildApp; noted in DECISIONS.md.

  let displayT = null;
  let animFrom = null;
  let animTarget = null;
  let animT0 = 0;
  let animating = false;

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
      // Story divergence from the bench's 0.22: the intro card points at the
      // uniform wash ("belief... could be anywhere"), so it must read as a
      // visible tint on a phone, not a whisper.
      t.fill(0.32);
      return t;
    }
    const decades = Math.log10(pmax / Math.max(pmin, pmax * 1e-6));
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
  const easeInOutCubic = (x) =>
    x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

  function presentField(target, animate) {
    if (!animate || reducedMotion.matches || !displayT || displayT.length !== target.length) {
      displayT = Float32Array.from(target);
      renderer.updateHeat(displayT);
      drawScene();
      animating = false;
      return;
    }
    animFrom = Float32Array.from(displayT);
    animTarget = Float32Array.from(target);
    animT0 = performance.now();
    if (!animating) {
      animating = true;
      requestAnimationFrame(fieldTick);
    }
  }

  function fieldTick(now) {
    if (!animating) return;
    const u = Math.min(1, (now - animT0) / FIELD_MS);
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
    requestAnimationFrame(fieldTick);
  }

  // The evaluation window recenters when a preset loads (baseline pins the
  // v1 center; evasive centers on Tallinn). A cell-indexed field has no
  // meaning across hypothesis spaces, so the heat layer snaps rather than
  // tweening across the move (same rule as the bench, DECISIONS.md item 37).
  let windowKey = "";

  function refresh({ animate = true } = {}) {
    const wc = engine.getWindowCenter();
    const key = `${wc.lat.toFixed(4)},${wc.lon.toFixed(4)}`;
    if (key !== windowKey) {
      windowKey = key;
      renderer.setWindow(wc);
      displayT = null; // snap across hypothesis spaces
    }
    presentField(buildTargetT(engine.computePosterior()), animate);
  }

  // ---- camera --------------------------------------------------------------

  let camAnimating = false;
  let camFrom = null;
  let camTo = null;
  let camT0 = 0;

  // The step card floats over the bottom of the viewport, so the fit runs on
  // the unobstructed top region (same idea as the bench's obstructRight for
  // its parameters column, turned vertical) and the framed stage is centered
  // there. Uses the CURRENT engine window center -- callers must apply a
  // step's state (in particular a preset's window recenter) before framing.
  function frameTargetView(points, stepIndex) {
    renderer.resize();
    const rect = canvas.getBoundingClientRect();
    const wCss = rect.width;
    const hCss = rect.height;
    if (!(wCss > 0) || !(hCss > 0)) return renderer.getView();
    const card = sections[stepIndex]?.querySelector(".story-card");
    const obstruct = card ? card.offsetHeight + 40 : 0;
    const effH = Math.max(hCss - obstruct, hCss * 0.4);
    const fit = computeViewFit(wCss, effH, engine.getWindowCenter(), points, null);
    const zoom = Math.log2(fit.scale);
    const s = Math.pow(2, zoom);
    const saved = renderer.getView();
    // Center the stage in the unobstructed top region: worldToCss puts wy at
    // css y = hCss/2 + (wy - viewCenter.wy) * s, and we want fit.cy at
    // effH/2, so viewCenter.wy = fit.cy + (hCss - effH) / (2s). setView
    // clamps zoom and center exactly like every renderer path.
    renderer.setView({ wx: fit.cx, wy: fit.cy + (hCss - effH) / (2 * s), zoom });
    const target = renderer.getView();
    renderer.setView(saved);
    return target;
  }

  function flyTo(points, stepIndex, { snap = false } = {}) {
    const target = frameTargetView(points, stepIndex);
    const cur = renderer.getView();
    const same =
      Math.abs(cur.zoom - target.zoom) < 1e-3 &&
      Math.abs(cur.wx - target.wx) < 1e-6 &&
      Math.abs(cur.wy - target.wy) < 1e-6;
    if (snap || reducedMotion.matches || same) {
      renderer.setView(target);
      camAnimating = false;
      drawScene();
      return;
    }
    camFrom = cur;
    camTo = target;
    camT0 = performance.now();
    if (!camAnimating) {
      camAnimating = true;
      requestAnimationFrame(camTick);
    }
  }

  function camTick(now) {
    if (!camAnimating) return;
    const u = Math.min(1, (now - camT0) / CAMERA_MS);
    const e = easeInOutCubic(u);
    renderer.setView({
      wx: camFrom.wx + (camTo.wx - camFrom.wx) * e,
      wy: camFrom.wy + (camTo.wy - camFrom.wy) * e,
      zoom: camFrom.zoom + (camTo.zoom - camFrom.zoom) * e,
    });
    drawScene();
    if (u >= 1) {
      camAnimating = false;
      return;
    }
    requestAnimationFrame(camTick);
  }

  // ---- step activation -----------------------------------------------------
  // settled = index whose full cumulative state the engine currently holds
  // (-1 while a staged timeline is mid-flight). Forward-by-one plays the
  // step's stages with their delays; any other jump rebuilds base + ops(0..i)
  // silently and tweens the field once. Both paths end in identical state
  // because stages replay from the same fixed-seed base in the same order.

  let settled = -1;
  let timers = [];

  function cancelTimers() {
    for (const t of timers) clearTimeout(t);
    timers = [];
  }

  function rebuildTo(i) {
    for (let k = 0; k <= i; k++) {
      for (const st of STEPS[k].stages) st.fn(engine);
    }
    settled = i;
  }

  function activate(i, { first = false } = {}) {
    if (i === currentStep && !first && settled === i) return;
    cancelTimers();
    const forward = settled === i - 1;
    currentStep = i;
    railDots.forEach((d, k) => d.classList.toggle("current", k === i));
    sections.forEach((s, k) => s.classList.toggle("active", k === i));

    if (forward && STEPS[i].stages.length) {
      // Natural forward path: play the step's stages with their stagger.
      // Delay-0 stages run synchronously first -- a preset load recenters
      // the evaluation window, and the camera fit must see the new window.
      const stages = STEPS[i].stages;
      let k = 0;
      while (k < stages.length && stages[k].delay === 0) {
        stages[k].fn(engine);
        k++;
      }
      settled = k === stages.length ? i : -1; // -1 while mid-flight
      flyTo(STEPS[i].frame, i, { snap: first });
      if (k > 0) refresh({ animate: true });
      for (; k < stages.length; k++) {
        const st = stages[k];
        const last = k === stages.length - 1;
        timers.push(
          setTimeout(
            () => {
              st.fn(engine);
              refresh({ animate: true });
              if (last) settled = i;
            },
            reducedMotion.matches ? 0 : st.delay
          )
        );
      }
    } else {
      rebuildTo(i);
      flyTo(STEPS[i].frame, i, { snap: first });
      refresh({ animate: !first });
    }
  }

  // ---- wiring --------------------------------------------------------------

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        activate(Number(entry.target.dataset.step));
      }
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );
  for (const s of sections) observer.observe(s);

  root.addEventListener("click", (ev) => {
    const next = ev.target.closest("[data-next]");
    const dot = ev.target.closest("[data-goto]");
    const idx = next ? Number(next.dataset.next) : dot ? Number(dot.dataset.goto) : null;
    if (idx == null) return;
    sections[idx].scrollIntoView({
      behavior: reducedMotion.matches ? "auto" : "smooth",
      block: "start",
    });
  });

  // Re-frame on viewport changes (rotation, browser chrome show/hide),
  // debounced and snapped -- a tween on every URL-bar collapse would jitter.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderer.resize();
      flyTo(STEPS[currentStep].frame, currentStep, { snap: true });
    }, 150);
  });

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      renderer.refreshTheme();
      drawScene();
    });

  activate(0, { first: true });
}

// ---- boot -----------------------------------------------------------------

function bootStory() {
  buildStory(document.getElementById("root"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootStory);
} else {
  bootStory();
}
