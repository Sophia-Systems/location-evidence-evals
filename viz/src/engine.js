// engine.js -- pure, DOM-free model engine for the evidence-evaluation viz.
//
// Implements the model of paper/evidence-evaluation.md sections 3-9 as
// concretized by PROMPT.md ("The model to implement"). Composes against the
// coordinate contract in ./geo.js: the display plane is only for grid layout;
// every distance that feeds physics is great-circle via haversineKm.
//
// Structure:
//   - grid          square N x N (default 160) or hex lattice of equal cell area
//   - anchors       {id, name, lat, lon, pi} + per-anchor Float32Array distance field
//   - simulator     the world's truth: true location, true delta_att, attack mode.
//                   probe() draws signed receipts. Never consulted by the evaluator.
//   - evaluator     sees only receipts + its own parameters. Produces per-anchor
//                   honest log-likelihood fields, applies the trust mixture once
//                   per anchor bundle, accumulates the posterior in log space.
//
// Units: km, ms, km/ms throughout.

import { HALF_EXTENT, haversineKm, unproject, project } from "./geo.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const V_C = 300; // km/ms -- lightspeed; conversion for exclusion radii (security bound)
export const V_FIBER = 204; // km/ms -- c/n, n = 1.47; honest generation + soft interior

// Identity presets for the per-anchor compromise probability (PROMPT.md
// "Parameters"). NOTE ON NAMING: the paper reserves pi for the posterior and
// names this quantity eps_a; the build adjudication fixed the anchor field
// name as `pi`, so `pi` here IS the paper's eps_a (compromise probability).
export const PI_PRESETS = { neutral: 0.1, ally: 0.3, adversary: 0.03 };

// Facility library (PROMPT.md "The world"). Coordinates are APPROXIMATE public
// locations of the named facilities/campuses -- close enough for a teaching
// viz, not authoritative.
export const FACILITIES = [
  { id: "hetzner-helsinki", name: "Hetzner Helsinki", lat: 60.404, lon: 25.106 },
  { id: "hetzner-falkenstein", name: "Hetzner Falkenstein", lat: 50.479, lon: 12.337 },
  { id: "aws-frankfurt", name: "AWS Frankfurt", lat: 50.11, lon: 8.682 },
  { id: "aws-dublin", name: "AWS Dublin", lat: 53.349, lon: -6.26 },
  { id: "aws-stockholm", name: "AWS Stockholm", lat: 59.329, lon: 18.069 },
  { id: "gcp-hamina", name: "GCP Hamina", lat: 60.537, lon: 27.198 },
  { id: "gcp-st-ghislain", name: "GCP St. Ghislain", lat: 50.454, lon: 3.819 },
  { id: "equinix-london", name: "Equinix London", lat: 51.512, lon: -0.003 },
  { id: "equinix-paris", name: "Equinix Paris", lat: 48.928, lon: 2.353 },
  { id: "telia-tallinn", name: "Telia Tallinn", lat: 59.423, lon: 24.799 },
];

const CAMBRIDGE = { lat: 52.205, lon: 0.119 };
const TALLINN = { lat: 59.437, lon: 24.754 };
const ST_PETERSBURG = { lat: 59.934, lon: 30.335 };

// Scenario presets (PROMPT.md "Scenario presets") as data. `anchors` lists
// facility ids with optional per-anchor pi overrides (default: neutral).
//
// Trust staging (DECISIONS.md item 26): presets whose lesson is ERASURE
// (baseline, geometry, allowance) stage every anchor highly trusted at
// pi = 0.02 (~5.6-bit ceiling, ~50x per-anchor outside suppression), so the
// outside of a circle visibly drains. At the neutral 0.10 each anchor could
// suppress outside cells by only 1/pi = 10x -- a trust haze that muddied
// result 1. That haze is the TRUST preset's lesson, so preset 3 keeps
// neutral 0.10 starting points; preset 5 keeps its own staging.
const HIGH_TRUST_PI = 0.02;
export const PRESETS = [
  {
    id: "baseline",
    name: "Baseline",
    caption:
      "Declared = true at Cambridge. Each receipt erases the outside of a circle; belief concentrates by exclusion. (Anchors here are highly trusted -- trust is what preset 3 explores.)",
    declared: CAMBRIDGE,
    trueLocation: CAMBRIDGE,
    attack: "none",
    allowance: 0,
    anchors: [
      { facility: "hetzner-helsinki", pi: HIGH_TRUST_PI },
      { facility: "hetzner-falkenstein", pi: HIGH_TRUST_PI },
      { facility: "equinix-paris", pi: HIGH_TRUST_PI },
      { facility: "equinix-london", pi: HIGH_TRUST_PI },
    ],
  },
  {
    id: "geometry",
    name: "Geometry",
    caption:
      "Drag anchors: a different bearing collapses the lens; a co-located anchor adds almost nothing. (Anchors here are highly trusted -- trust is what preset 3 explores.)",
    declared: CAMBRIDGE,
    trueLocation: CAMBRIDGE,
    attack: "none",
    allowance: 0,
    anchors: [
      { facility: "hetzner-helsinki", pi: HIGH_TRUST_PI },
      { facility: "hetzner-falkenstein", pi: HIGH_TRUST_PI },
      { facility: "equinix-paris", pi: HIGH_TRUST_PI },
      { facility: "equinix-london", pi: HIGH_TRUST_PI },
    ],
  },
  {
    id: "trust",
    name: "Trust",
    caption:
      "Lower an anchor's trust and the same receipts move the map less; no amount of probing beats the log2(1/pi) ceiling.",
    declared: CAMBRIDGE,
    trueLocation: CAMBRIDGE,
    attack: "none",
    allowance: 0,
    anchors: [
      { facility: "hetzner-helsinki" },
      { facility: "hetzner-falkenstein" },
      { facility: "equinix-paris" },
      { facility: "equinix-london" },
    ],
  },
  {
    id: "allowance",
    name: "The allowance",
    caption:
      "Raise the allowance past the attester's true delta_att: circles shrink below physics and the true location falls outside one. (Anchors here are highly trusted -- trust is what preset 3 explores.)",
    declared: CAMBRIDGE,
    trueLocation: CAMBRIDGE,
    attack: "none",
    allowance: 0,
    anchors: [
      { facility: "hetzner-helsinki", pi: HIGH_TRUST_PI },
      { facility: "hetzner-falkenstein", pi: HIGH_TRUST_PI },
      { facility: "equinix-paris", pi: HIGH_TRUST_PI },
      { facility: "equinix-london", pi: HIGH_TRUST_PI },
    ],
  },
  {
    id: "evasive",
    name: "Evasive attester",
    caption:
      "Declared Tallinn, actually St Petersburg. Honest anchors + zero allowance: padding cannot fake Tallinn. Flip the trusted Tallinn anchor to fabricate, probe all a few times, and the assessment is fooled -- raising its pi is the defense.",
    declared: TALLINN,
    trueLocation: ST_PETERSBURG,
    attack: "inflation",
    allowance: 0,
    // Trust staging (Phase 2, DECISIONS.md item 8): the verifier rates the
    // Telia Tallinn anchor an adversary of the attester's operator -- the most
    // credible kind of witness, pi 0.03 -- while the three regional anchors
    // are rated allies (pi 0.30). The demo: Telia is secretly colluding; flip
    // its fabrication toggle and the verifier's own trust allocation sells the
    // lie. The staging also concentrates honest discrimination in the anchor
    // the fabrication removes, which is what lets the fooled posterior clear
    // the honest anchors' remaining truth preference.
    anchors: [
      { facility: "telia-tallinn", pi: 0.03 },
      { facility: "hetzner-helsinki", pi: 0.3 },
      { facility: "gcp-hamina", pi: 0.3 },
      { facility: "aws-stockholm", pi: 0.3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

// Deterministic 32-bit PRNG (mulberry32) so tests are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function logaddexp(a, b) {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  return a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b));
}

const clampPi = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createEngine(options = {}) {
  const { seed = 1, gridN = 160, gridShape = "square" } = options;

  let rng = mulberry32(seed);

  // ---- grid ---------------------------------------------------------------

  let grid = null; // {shape, n, cellCount, xs, ys, lats, lons, stepKm, cellAreaKm2}

  function buildGrid(shape, n) {
    const step = (2 * HALF_EXTENT) / n; // km, square cell pitch
    let xs, ys;
    if (shape === "square") {
      const count = n * n;
      xs = new Float32Array(count);
      ys = new Float32Array(count);
      let k = 0;
      for (let j = 0; j < n; j++) {
        const y = -HALF_EXTENT + (j + 0.5) * step;
        for (let i = 0; i < n; i++) {
          xs[k] = -HALF_EXTENT + (i + 0.5) * step;
          ys[k] = y;
          k++;
        }
      }
    } else if (shape === "hex") {
      // Hex lattice with cell area equal to the square grid's step^2:
      // horizontal pitch dx, row pitch dy = dx*sqrt(3)/2, area dx*dy = step^2.
      const dx = step * Math.sqrt(2 / Math.sqrt(3));
      const dy = (dx * Math.sqrt(3)) / 2;
      const txs = [];
      const tys = [];
      let row = 0;
      for (let y = -HALF_EXTENT + dy / 2; y <= HALF_EXTENT; y += dy, row++) {
        const x0 = -HALF_EXTENT + dx / 2 + (row % 2) * (dx / 2);
        for (let x = x0; x <= HALF_EXTENT; x += dx) {
          txs.push(x);
          tys.push(y);
        }
      }
      xs = Float32Array.from(txs);
      ys = Float32Array.from(tys);
    } else {
      throw new Error(`unknown grid shape: ${shape}`);
    }
    const count = xs.length;
    const lats = new Float32Array(count);
    const lons = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const ll = unproject(xs[i], ys[i]);
      lats[i] = ll.lat;
      lons[i] = ll.lon;
    }
    // Circumradius of one cell (half-diagonal of the square; circumradius of
    // the Voronoi hexagon, nearest-neighbor pitch / sqrt(3)). Likelihood
    // fields evaluate each cell at the nearest point of its extent, so an
    // exclusion circle that intersects any part of a cell credits it -- see
    // accumulateReceiptField.
    const cellRadKm =
      shape === "square" ? (step * Math.SQRT2) / 2 : (step * Math.sqrt(2 / Math.sqrt(3))) / Math.sqrt(3);
    return {
      shape,
      n,
      cellCount: count,
      xs,
      ys,
      lats,
      lons,
      stepKm: step,
      cellAreaKm2: step * step,
      cellRadKm,
    };
  }

  // ---- anchors ------------------------------------------------------------

  // id -> anchor record. Public fields: id, name, lat, lon, pi.
  // Private fields: dist (Float32Array), receipts (all, any timestamp),
  // S (honest log-likelihood field over cells for the current evaluator
  // params/interval/bundle mode), maxS, mixed (trust-mixed log field),
  // sDirty / mixDirty flags, cached in-interval stats.
  const anchors = new Map();
  let anchorSeq = 0;

  // Default pi for hand-added anchors (facility library or map click),
  // per user adjudication (see viz/DECISIONS.md): a hand-added anchor should
  // read as part of the loaded scenario, not silently dilute it with a
  // neutral-trust outlier. Tracks the loaded preset's trust staging -- the
  // erasure presets (baseline/geometry/allowance) stage HIGH_TRUST_PI; the
  // trust preset and evasive preset (and no-preset free play) stay neutral.
  let defaultAnchorPi = PI_PRESETS.neutral;
  const HIGH_TRUST_PRESET_IDS = new Set(["baseline", "geometry", "allowance"]);

  function computeDistField(a) {
    const { lats, lons, cellCount } = grid;
    const dist = a.dist && a.dist.length === cellCount ? a.dist : new Float32Array(cellCount);
    const p = { lat: a.lat, lon: a.lon };
    const q = { lat: 0, lon: 0 };
    for (let i = 0; i < cellCount; i++) {
      q.lat = lats[i];
      q.lon = lons[i];
      dist[i] = haversineKm(p, q);
    }
    a.dist = dist;
  }

  function addAnchor(spec) {
    let { id, name, lat, lon, pi, facility } = spec;
    if (facility) {
      const f = FACILITIES.find((x) => x.id === facility);
      if (!f) throw new Error(`unknown facility: ${facility}`);
      id = id ?? f.id;
      name = name ?? f.name;
      lat = lat ?? f.lat;
      lon = lon ?? f.lon;
    }
    if (id == null) id = `anchor-${++anchorSeq}`;
    if (anchors.has(id)) throw new Error(`duplicate anchor id: ${id}`);
    const a = {
      id,
      name: name ?? id,
      lat,
      lon,
      pi: clampPi(pi ?? defaultAnchorPi),
      dist: null,
      receipts: [],
      S: null,
      maxS: 0,
      mixed: null,
      sDirty: true,
      mixDirty: true,
      // in-interval stats, refreshed alongside S
      rttMin: null,
      latestRtt: null,
      inIntervalCount: 0,
    };
    computeDistField(a);
    anchors.set(id, a);
    return publicAnchor(a);
  }

  function removeAnchor(id) {
    anchors.delete(id);
    sim.dishonestAnchors.delete(id);
  }

  // Moving an anchor invalidates the geometry its old receipts were measured
  // under, so a move clears that anchor's receipts (judgment call, documented).
  function moveAnchor(id, lat, lon) {
    const a = mustGet(id);
    a.lat = lat;
    a.lon = lon;
    computeDistField(a);
    a.receipts = [];
    a.sDirty = true;
    a.mixDirty = true;
  }

  function setAnchorPi(id, pi) {
    const a = mustGet(id);
    a.pi = clampPi(pi);
    a.mixDirty = true; // honest field S is unaffected
  }

  function mustGet(id) {
    const a = anchors.get(id);
    if (!a) throw new Error(`unknown anchor: ${id}`);
    return a;
  }

  const publicAnchor = (a) => ({ id: a.id, name: a.name, lat: a.lat, lon: a.lon, pi: a.pi });

  // ---- simulator (the world's truth; never read by the evaluator) --------

  const sim = {
    trueLocation: { ...CAMBRIDGE },
    declared: { ...CAMBRIDGE },
    delta_att: 0.05, // ms, true attester processing delay
    path_noise_mean: 0.1, // ms, mean of one-sided exponential route/queueing excess
    attack: "none", // 'none' | 'inflation' | 'deflation'
    deflation_delta_att: 0.005, // ms, evasive attester's optimized processing delay
    dishonestAnchors: new Set(), // anchor ids that FABRICATE receipts (paper s.7)
  };

  function setSimulator(patch) {
    if (patch.trueLocation) sim.trueLocation = { ...patch.trueLocation };
    if (patch.declared) sim.declared = { ...patch.declared };
    if (patch.delta_att != null) sim.delta_att = patch.delta_att;
    if (patch.path_noise_mean != null) sim.path_noise_mean = patch.path_noise_mean;
    if (patch.attack != null) {
      if (!["none", "inflation", "deflation"].includes(patch.attack))
        throw new Error(`unknown attack mode: ${patch.attack}`);
      sim.attack = patch.attack;
    }
    if (patch.deflation_delta_att != null) sim.deflation_delta_att = patch.deflation_delta_att;
  }

  // Simulator-side anchor dishonesty (paper s.7: a dishonest anchor "can
  // fabricate arbitrary evidence"). A dishonest anchor never measures the
  // attester at all: its probe INVENTS a receipt that looks like an honest
  // measurement of the DECLARED location --
  //   rtt = 2 * d_declared / v_fiber + delta_att_true + Exp(path_noise_mean)
  // The one-sidedness invariant applies to its fabricated story, not to true
  // propagation: a fabricated receipt MAY fall below 2 * d_true / v_fiber.
  // That violation of physics is exactly what makes anchor honesty a standing
  // assumption rather than a measured quantity. This is a SIMULATOR control
  // (world truth), never a verifier input; the evaluator's only defense is pi.
  function setAnchorDishonest(id, dishonest) {
    mustGet(id); // validate
    if (dishonest) sim.dishonestAnchors.add(id);
    else sim.dishonestAnchors.delete(id);
  }

  // One probe -> one signed receipt. rtt = 2 d_true / v_fiber + delta_att_eff
  // + artificial_delay + Exp(path_noise_mean); artificial_delay >= 0, so no
  // receipt is ever below 2 d_true / v_fiber (one-sidedness).
  function probe(anchorId, timestampMs) {
    const a = mustGet(anchorId);
    const anchorPos = { lat: a.lat, lon: a.lon };
    if (sim.dishonestAnchors.has(anchorId)) {
      // Fabrication: an honest-looking receipt for the DECLARED spot.
      const dDecl = haversineKm(anchorPos, sim.declared);
      const noise = -sim.path_noise_mean * Math.log(1 - rng());
      const rtt = (2 * dDecl) / V_FIBER + sim.delta_att + noise;
      const receipt = { anchorId, rtt, timestampMs, fabricated: true };
      ingestReceipt(receipt);
      return receipt;
    }
    const dTrue = haversineKm(anchorPos, sim.trueLocation);
    let delta = sim.delta_att;
    let artificial = 0;
    if (sim.attack === "deflation") {
      // Evasive attester answers faster than the verifier's allowance assumes.
      delta = Math.min(delta, sim.deflation_delta_att);
    } else if (sim.attack === "inflation") {
      // Pad toward consistency with the declared location where physics
      // permits: target rtt = 2 d_declared / v_fiber + delta_att_true.
      // Padding can only ADD time, so the pad clamps at zero.
      const dDecl = haversineKm(anchorPos, sim.declared);
      artificial = Math.max(0, (2 * (dDecl - dTrue)) / V_FIBER);
    }
    const noise = -sim.path_noise_mean * Math.log(1 - rng());
    const rtt = (2 * dTrue) / V_FIBER + delta + artificial + noise;
    const receipt = { anchorId, rtt, timestampMs };
    ingestReceipt(receipt);
    return receipt;
  }

  function probeAll(timestampMs) {
    return [...anchors.keys()].map((id) => probe(id, timestampMs));
  }

  // ---- evaluator ----------------------------------------------------------

  // Evaluator defaults. A preset may override any of them (presets so far
  // only set `allowance`); loadPreset restores EVERY evaluator parameter to
  // the preset's value or this default, so a preset's lesson never inherits
  // leftover state from the previous scenario.
  //
  // assumed_interior_mean: mean of the one-sided interior excess (route
  // stretch + queueing + processing), ms. DELIBERATELY CONSERVATIVE and
  // decoupled from the simulator's true noise (DECISIONS.md item 7): the
  // paper (s.4) says the interior carries "almost nothing", so the evaluator
  // assumes a slow tail rather than sharpening belief onto the fiber ring.
  // Default tuned numerically (Phase 2): large enough that a single receipt's
  // interior reads as a broad glow rather than a thin ring (e-fold length
  // mu * v_fiber / 2 ~ 120 km against typical 300-500 km circles), small
  // enough that multi-anchor discrimination in the evasive preset survives.
  // A literally flat interior (< 3x over 500 km) needs mu >= 4.5 ms, which
  // erases the honest-anchor truth preference the evasive preset teaches;
  // 1.2 ms is the measured compromise (see viz/DECISIONS.md item 7).
  const EV_DEFAULTS = {
    allowance: 0, // ms
    assumed_interior_mean: 1.2, // ms (see above)
    bundleMode: "rtt-min", // 'rtt-min' (default; paper s.6 redundancy discounting) | 'product' (PROMPT.md)
    floorRel: 1e-6, // exclusion floor, relative to the interior peak f(0)
  };

  const ev = {
    ...EV_DEFAULTS,
    interval: { startMs: -Infinity, endMs: Infinity }, // assessment interval T
  };

  function setEvaluatorParams(patch) {
    if (patch.bundleMode != null && !["rtt-min", "product"].includes(patch.bundleMode))
      throw new Error(`unknown bundle mode: ${patch.bundleMode}`);
    Object.assign(ev, patch);
    markAllDirty();
  }

  function setAssessmentInterval(startMs, endMs) {
    ev.interval = { startMs, endMs };
    markAllDirty();
  }

  function markAllDirty() {
    for (const a of anchors.values()) {
      a.sDirty = true;
      a.mixDirty = true;
    }
  }

  const inInterval = (t) => t >= ev.interval.startMs && t <= ev.interval.endMs;

  // External receipt ingestion (receipts are data; the simulator's probe() is
  // just one source of them). Used by tests to inject synthetic receipts.
  function addReceipt(receipt) {
    ingestReceipt({ ...receipt });
    return receipt;
  }

  function ingestReceipt(receipt) {
    const a = mustGet(receipt.anchorId);
    a.receipts.push(receipt);
    if (!inInterval(receipt.timestampMs)) return; // outside T: no effect on fields
    if (a.sDirty || !a.S) return; // field stale anyway; lazily rebuilt later
    // Incremental update: touch only this anchor's arrays.
    a.inIntervalCount++;
    a.latestRtt = receipt.rtt;
    if (ev.bundleMode === "rtt-min") {
      if (a.rttMin == null || receipt.rtt < a.rttMin) {
        a.sDirty = true; // new minimum: rebuild this anchor's field
        a.mixDirty = true;
      }
      // otherwise the bundle's honest field is unchanged (rtt-min plateau)
    } else {
      // product: multiply in this receipt's honest likelihood (add in log)
      if (a.rttMin == null || receipt.rtt < a.rttMin) a.rttMin = receipt.rtt;
      accumulateReceiptField(a.S, a.dist, receipt.rtt, true);
      let m = -Infinity;
      const S = a.S;
      for (let i = 0; i < S.length; i++) if (S[i] > m) m = S[i];
      a.maxS = m;
      a.mixDirty = true;
    }
  }

  // Honest log-likelihood of ONE receipt against every cell.
  //   exclusion radius r = v_c * (rtt - allowance) / 2   (security conversion)
  //   outside (d > r):  log L = log(floorRel) + log f(0)   -- epsilon floor,
  //                     1e-6 relative to the interior peak f(0) = 1/mu
  //   inside  (d <= r): L = f(excess), excess = rtt - 2 d / v_fiber - allowance
  // f: for excess >= 0 the one-sided exponential density with mean
  // mu = assumed_interior_mean (floored at the epsilon floor so no single
  // receipt drives a cell below the residual).
  //
  // Negative excess -- cells between the fiber ring and the lightspeed ring,
  // reachable only by straighter-than-assumed routes or faster media (paper
  // s.4: fiber is "never for exclusion") -- decays LOG-LINEARLY from the peak
  // at the fiber ring down to exactly the epsilon floor at d = r. This keeps
  // the paper's picture intact: the likelihood hits its hard cliff at the
  // lightspeed bound, landing on the tiny residual floor, while the fiber
  // conversion shapes precision expectations inside it. (PROMPT.md leaves
  // f(excess<0) unspecified; a strict exponential would zero the annulus and
  // make the v_c radius dead code, and clamping the annulus to the peak
  // breaks the trust-cap saturation under 'product' bundling. Documented as a
  // judgment call.)
  //
  // Cell extent (DECISIONS.md item 25): every cell is evaluated at the
  // NEAREST point of its extent -- d_eff = max(0, d_center - cellRadKm) --
  // not at its center. A receipt whose exclusion circle intersects any part
  // of a cell credits that cell. Without this, an exclusion radius smaller
  // than the lattice's largest center-to-point gap (a fabricating anchor in
  // the declared city, or an honest anchor beside the attester) can leave
  // ZERO cell centers inside the circle: the field degrades to all-floor and
  // the anchor's evidence silently becomes uninformative -- exactly the
  // degeneracy DECISIONS.md item 24 flagged for the fabrication demo. The
  // shift is at most one cell radius (~11.5 km at the default grid), a
  // conservative widening: it can only keep cells IN, never wrongly exclude.
  function accumulateReceiptField(S, dist, rtt, accumulate) {
    const cellRad = grid.cellRadKm;
    const mu = ev.assumed_interior_mean;
    const logPeak = -Math.log(mu);
    const logFloorOff = Math.log(ev.floorRel); // negative, e.g. -13.8
    const logFloor = logFloorOff + logPeak;
    const c1 = rtt - ev.allowance; // ms
    const n = S.length;
    if (c1 <= 0) {
      // allowance swallows the whole measurement: exclusion radius <= 0,
      // every cell sits on the floor -- the receipt carries no information.
      if (accumulate) for (let i = 0; i < n; i++) S[i] += logFloor;
      else S.fill(logFloor);
      return;
    }
    const r = (V_C * c1) / 2;
    const invMu = 1 / mu;
    const twoOverVf = 2 / V_FIBER;
    // slope for the negative-excess (super-fiber) side, chosen so the decay
    // reaches the floor exactly at the lightspeed ring, where
    // excess = -(v_c/v_fiber - 1) * c1:
    const negSlope = -logFloorOff / ((V_C / V_FIBER - 1) * c1);
    for (let i = 0; i < n; i++) {
      const dc = dist[i] - cellRad;
      const d = dc > 0 ? dc : 0; // nearest point of the cell's extent
      let v;
      if (d > r) v = logFloor;
      else {
        const ex = c1 - d * twoOverVf;
        v = ex >= 0 ? logPeak - ex * invMu : logPeak + ex * negSlope;
        if (v < logFloor) v = logFloor;
      }
      if (accumulate) S[i] += v;
      else S[i] = v;
    }
  }

  // Rebuild anchor a's honest bundle field S from its in-interval receipts.
  function ensureAnchorS(a) {
    if (!a.sDirty && a.S && a.S.length === grid.cellCount) return;
    const n = grid.cellCount;
    if (!a.S || a.S.length !== n) {
      a.S = new Float64Array(n);
      a.mixed = new Float64Array(n);
    }
    const rtts = [];
    let latest = null;
    let latestT = -Infinity;
    for (const rec of a.receipts) {
      if (!inInterval(rec.timestampMs)) continue;
      rtts.push(rec.rtt);
      if (rec.timestampMs >= latestT) {
        latestT = rec.timestampMs;
        latest = rec.rtt;
      }
    }
    a.inIntervalCount = rtts.length;
    a.latestRtt = latest;
    a.rttMin = rtts.length ? Math.min(...rtts) : null;
    if (rtts.length === 0) {
      a.S.fill(0); // no evidence: log-likelihood identically 0 (uninformative)
      a.maxS = 0;
    } else if (ev.bundleMode === "rtt-min") {
      // Redundancy discounting (paper s.6): a bundle's honest likelihood is
      // computed from its minimum RTT -- same-path receipts share their
      // information, nearly exhausted by the smallest of them.
      accumulateReceiptField(a.S, a.dist, a.rttMin, false);
      let m = -Infinity;
      for (let i = 0; i < n; i++) if (a.S[i] > m) m = a.S[i];
      a.maxS = m;
    } else {
      // product of per-receipt honest likelihoods (PROMPT.md)
      a.S.fill(0);
      for (const rtt of rtts) accumulateReceiptField(a.S, a.dist, rtt, true);
      let m = -Infinity;
      for (let i = 0; i < n; i++) if (a.S[i] > m) m = a.S[i];
      a.maxS = m;
    }
    a.sDirty = false;
    a.mixDirty = true;
  }

  // Trust mixture, applied ONCE per anchor bundle, in log space:
  //   mixed = logaddexp(log(1 - pi) + S, log(pi) + logLflat)
  // Choice of L_flat (documented): logLflat = maxS = max over cells of the
  // bundle's honest log-likelihood. Reading: a dishonest anchor fabricates
  // receipts that look exactly as plausible as the most plausible honest
  // explanation of this bundle (it signs a self-consistent story), while
  // carrying no information about x. Consequence: for any two cells x, y,
  //   L_eff(x)/L_eff(y) <= [(1-pi)maxS' + pi maxS'] / (pi maxS') = 1/pi,
  // so the per-anchor evidence in favor of any cell -- and against any cell --
  // saturates at log2(1/pi) bits, under both bundle modes, however many
  // receipts arrive. This is the paper's trust cap (s.7) made exact.
  function ensureAnchorMixed(a) {
    ensureAnchorS(a);
    if (!a.mixDirty) return;
    const n = grid.cellCount;
    const log1mPi = Math.log(1 - a.pi);
    const logPiFlat = Math.log(a.pi) + a.maxS;
    const S = a.S;
    const mixed = a.mixed;
    for (let i = 0; i < n; i++) {
      mixed[i] = logaddexp(log1mPi + S[i], logPiFlat);
    }
    a.mixDirty = false;
  }

  // ---- prior & posterior --------------------------------------------------

  let logPrior = null; // null => uniform (log-prior constant, drops out)

  function setPrior(prior) {
    if (prior === "uniform" || prior == null) {
      logPrior = null;
      return;
    }
    if (prior.length !== grid.cellCount)
      throw new Error(`prior length ${prior.length} != cellCount ${grid.cellCount}`);
    logPrior = new Float64Array(grid.cellCount);
    for (let i = 0; i < grid.cellCount; i++) {
      logPrior[i] = prior[i] > 0 ? Math.log(prior[i]) : -Infinity;
    }
  }

  let accBuf = null;
  let posterior = null;

  // Full posterior: log-space accumulation over anchors, renormalize.
  // Returns a Float32Array of cell probabilities (sums to 1).
  function computePosterior() {
    const n = grid.cellCount;
    if (!accBuf || accBuf.length !== n) accBuf = new Float64Array(n);
    if (!posterior || posterior.length !== n) posterior = new Float32Array(n);
    const acc = accBuf;
    if (logPrior) acc.set(logPrior);
    else acc.fill(0);
    for (const a of anchors.values()) {
      ensureAnchorMixed(a);
      const mixed = a.mixed;
      for (let i = 0; i < n; i++) acc[i] += mixed[i];
    }
    let m = -Infinity;
    for (let i = 0; i < n; i++) if (acc[i] > m) m = acc[i];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = Math.exp(acc[i] - m);
      posterior[i] = p;
      sum += p;
    }
    const inv = 1 / sum;
    for (let i = 0; i < n; i++) posterior[i] *= inv;
    return posterior;
  }

  // ---- grid rebuild -------------------------------------------------------

  function rebuildGrid({ shape = grid.shape, n = grid.n } = {}) {
    grid = buildGrid(shape, n);
    logPrior = null; // prior resets to uniform on grid change (documented)
    accBuf = null;
    posterior = null;
    for (const a of anchors.values()) {
      computeDistField(a);
      a.S = null;
      a.mixed = null;
      a.sDirty = true;
      a.mixDirty = true;
    }
    return getGrid();
  }

  grid = buildGrid(gridShape, gridN);

  // ---- readouts -----------------------------------------------------------

  function getReadouts() {
    const perAnchor = [];
    let total = 0;
    for (const a of anchors.values()) {
      // refresh in-interval stats without forcing a field rebuild
      let count = 0;
      let rttMin = null;
      let latest = null;
      let latestT = -Infinity;
      for (const rec of a.receipts) {
        if (!inInterval(rec.timestampMs)) continue;
        count++;
        if (rttMin == null || rec.rtt < rttMin) rttMin = rec.rtt;
        if (rec.timestampMs >= latestT) {
          latestT = rec.timestampMs;
          latest = rec.rtt;
        }
      }
      total += count;
      perAnchor.push({
        id: a.id,
        name: a.name,
        pi: a.pi,
        latestRtt: latest,
        rttMin,
        exclusionRadiusKm:
          rttMin == null ? null : Math.max(0, (V_C * (rttMin - ev.allowance)) / 2),
        bitsCeiling: Math.log2(1 / a.pi),
        receiptsInInterval: count,
      });
    }
    return { perAnchor, receiptsInInterval: total };
  }

  // ---- presets ------------------------------------------------------------

  function loadPreset(presetOrId) {
    const preset =
      typeof presetOrId === "string" ? PRESETS.find((p) => p.id === presetOrId) : presetOrId;
    if (!preset) throw new Error(`unknown preset: ${presetOrId}`);
    anchors.clear();
    sim.dishonestAnchors.clear();
    defaultAnchorPi = HIGH_TRUST_PRESET_IDS.has(preset.id) ? HIGH_TRUST_PI : PI_PRESETS.neutral;
    for (const spec of preset.anchors) {
      addAnchor({ facility: spec.facility, pi: spec.pi });
    }
    setSimulator({
      trueLocation: preset.trueLocation,
      declared: preset.declared,
      attack: preset.attack,
      delta_att: preset.delta_att ?? 0.05,
      path_noise_mean: preset.path_noise_mean ?? 0.1,
    });
    // Restore EVERY evaluator parameter to the preset's value or the default
    // (previously only allowance was restored and bundleMode was preserved
    // across presets; leftover interior-fade / bundle / floor settings from
    // free play then silently reshaped the next preset's lesson). The
    // assessment interval resets to the engine default; the UI immediately
    // narrows it to the preset's display window.
    setEvaluatorParams({
      allowance: preset.allowance ?? EV_DEFAULTS.allowance,
      assumed_interior_mean: preset.assumed_interior_mean ?? EV_DEFAULTS.assumed_interior_mean,
      bundleMode: preset.bundleMode ?? EV_DEFAULTS.bundleMode,
      floorRel: preset.floorRel ?? EV_DEFAULTS.floorRel,
      interval: { startMs: -Infinity, endMs: Infinity },
    });
    return preset;
  }

  // ---- helpers for callers (rendering, tests) -----------------------------

  function nearestCellIndex(lat, lon) {
    const { x, y } = project(lat, lon);
    const { xs, ys, cellCount } = grid;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < cellCount; i++) {
      const dx = xs[i] - x;
      const dy = ys[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // Sum of posterior mass within radiusKm of a point (great-circle).
  function massNear(lat, lon, radiusKm, post = computePosterior()) {
    const { lats, lons, cellCount } = grid;
    const p = { lat, lon };
    const q = { lat: 0, lon: 0 };
    let sum = 0;
    for (let i = 0; i < cellCount; i++) {
      q.lat = lats[i];
      q.lon = lons[i];
      if (haversineKm(p, q) <= radiusKm) sum += post[i];
    }
    return sum;
  }

  function getGrid() {
    return grid;
  }

  return {
    // constants passthrough for convenience
    V_C,
    V_FIBER,
    // grid
    getGrid,
    rebuildGrid,
    nearestCellIndex,
    // anchors
    addAnchor,
    removeAnchor,
    moveAnchor,
    setAnchorPi,
    getDefaultAnchorPi: () => defaultAnchorPi,
    getAnchors: () => [...anchors.values()].map(publicAnchor),
    getAnchorDistField: (id) => mustGet(id).dist,
    getAnchorField: (id) => {
      const a = mustGet(id);
      ensureAnchorMixed(a);
      return { S: a.S, mixed: a.mixed, maxS: a.maxS, rttMin: a.rttMin };
    },
    getAnchorReceipts: (id) => mustGet(id).receipts.slice(),
    // simulator
    setSimulator,
    getSimulator: () => ({
      ...sim,
      trueLocation: { ...sim.trueLocation },
      declared: { ...sim.declared },
      dishonestAnchors: [...sim.dishonestAnchors],
    }),
    setAnchorDishonest,
    isAnchorDishonest: (id) => sim.dishonestAnchors.has(id),
    probe,
    probeAll,
    setSeed: (s) => {
      rng = mulberry32(s);
    },
    // evaluator
    setEvaluatorParams,
    getEvaluatorParams: () => ({ ...ev, interval: { ...ev.interval } }),
    setAssessmentInterval,
    addReceipt,
    setPrior,
    computePosterior,
    getReadouts,
    massNear,
    // presets
    loadPreset,
  };
}
