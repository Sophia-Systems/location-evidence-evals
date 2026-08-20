// engine-test.mjs -- plain-Node test suite for viz/src/engine.js.
// Run: node viz/test/engine-test.mjs
// No dependencies. Deterministic (seeded PRNG). Exit code 1 on any failure.

import {
  createEngine,
  V_C,
  V_FIBER,
  PRESETS,
  FACILITIES,
} from "../src/engine.js";
import { haversineKm } from "../src/geo.js";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `  -- ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title}`);
}

const fmt = (x, d = 3) => (x == null ? "null" : Number(x).toFixed(d));

// ---------------------------------------------------------------------------
section("grid construction");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 7 });
  const g = eng.getGrid();
  check("square grid is 160x160 by default", g.cellCount === 160 * 160, `got ${g.cellCount}`);
  check(
    "cell centers span the domain",
    Math.abs(g.xs[0] + 1300 - g.stepKm / 2) < 1e-3 && Math.abs(g.ys[g.cellCount - 1] - 1300 + g.stepKm / 2) < 1e-3
  );
  const squareArea = g.cellAreaKm2;

  // rebuild timing (with 8 anchors' distance fields recomputed)
  for (const f of FACILITIES.slice(0, 8)) eng.addAnchor({ facility: f.id });
  let t0 = performance.now();
  eng.rebuildGrid({ shape: "hex", n: 160 });
  const hexMs = performance.now() - t0;
  const gh = eng.getGrid();
  check("hex rebuild under 100 ms (incl. 8 distance fields)", hexMs < 100, `${fmt(hexMs, 1)} ms`);
  check(
    "hex lattice has equivalent cell area",
    Math.abs(gh.cellAreaKm2 - squareArea) / squareArea < 1e-9,
    `${fmt(gh.cellAreaKm2, 2)} vs ${fmt(squareArea, 2)}`
  );
  check(
    "hex cell count within 3% of square count",
    Math.abs(gh.cellCount - 25600) / 25600 < 0.03,
    `got ${gh.cellCount}`
  );
  check(
    "hex cells carry precomputed lat/lon",
    gh.lats.length === gh.cellCount && Number.isFinite(gh.lats[0]) && Number.isFinite(gh.lons[0])
  );
  t0 = performance.now();
  eng.rebuildGrid({ shape: "square", n: 160 });
  const sqMs = performance.now() - t0;
  check("square rebuild under 100 ms (incl. 8 distance fields)", sqMs < 100, `${fmt(sqMs, 1)} ms`);

  // distance field sanity: haversine to each cell center
  const a = eng.getAnchors()[0];
  const dist = eng.getAnchorDistField(a.id);
  const gg = eng.getGrid();
  const i = 12345;
  const want = haversineKm({ lat: a.lat, lon: a.lon }, { lat: gg.lats[i], lon: gg.lons[i] });
  check("distance field matches haversineKm", Math.abs(dist[i] - want) < 0.5, `${fmt(dist[i])} vs ${fmt(want)}`);
}

// ---------------------------------------------------------------------------
section("one-sidedness: 10k receipts never below 2*d_true/v_fiber");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 11 });
  let bad = 0;
  let total = 0;
  const runProbes = (n) => {
    const sim = eng.getSimulator();
    for (const a of eng.getAnchors()) {
      const dTrue = haversineKm({ lat: a.lat, lon: a.lon }, sim.trueLocation);
      const floor = (2 * dTrue) / V_FIBER;
      for (let k = 0; k < n; k++) {
        const rec = eng.probe(a.id, 1000 + k);
        total++;
        if (rec.rtt < floor - 1e-9) bad++;
      }
    }
  };
  eng.loadPreset("baseline"); // attack: none
  runProbes(1500);
  eng.loadPreset("evasive"); // attack: inflation (padding toward declared)
  runProbes(800);
  eng.setSimulator({ attack: "deflation" }); // evasive fast responder
  runProbes(200);
  check(`no receipt below the light-in-fiber floor (${total} receipts)`, bad === 0 && total === 10000, `bad=${bad} total=${total}`);
}

// ---------------------------------------------------------------------------
section("exclusion geometry");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 13 });
  eng.loadPreset("baseline");
  const sim = eng.getSimulator();
  for (let k = 0; k < 5; k++) eng.probeAll(1000 + k);

  const g = eng.getGrid();
  const trueIdx = eng.nearestCellIndex(sim.trueLocation.lat, sim.trueLocation.lon);
  const mu = eng.getEvaluatorParams().assumed_interior_mean;
  const logFloor = Math.log(1e-6) - Math.log(mu);

  let floorOk = true;
  let interiorAboveFloor = 0;
  let outsideCount = 0;
  const readouts = eng.getReadouts();
  for (const ra of readouts.perAnchor) {
    const dist = eng.getAnchorDistField(ra.id);
    const { S } = eng.getAnchorField(ra.id);
    const r = ra.exclusionRadiusKm;
    for (let i = 0; i < g.cellCount; i++) {
      if (dist[i] > r) {
        outsideCount++;
        if (Math.abs(S[i] - logFloor) > 1e-9) floorOk = false;
      } else if (S[i] > logFloor + 1e-9) {
        interiorAboveFloor++;
      }
    }
  }
  check("every cell beyond the exclusion radius sits exactly on the epsilon floor", floorOk, `outside cells checked: ${outsideCount}`);
  check("interior cells rise above the floor", interiorAboveFloor > 1000, `got ${interiorAboveFloor}`);

  // allowance <= true delta_att: the true cell is never excluded, by any anchor
  let trueCellInside = true;
  for (const ra of readouts.perAnchor) {
    const dist = eng.getAnchorDistField(ra.id);
    if (dist[trueIdx] > ra.exclusionRadiusKm) trueCellInside = false;
  }
  check("true cell inside every exclusion radius when allowance = 0 <= delta_att", trueCellInside);

  // same holds with allowance exactly equal to true delta_att
  eng.setEvaluatorParams({ allowance: 0.05 });
  const r2 = eng.getReadouts();
  let stillInside = true;
  for (const ra of r2.perAnchor) {
    const dist = eng.getAnchorDistField(ra.id);
    if (dist[trueIdx] > ra.exclusionRadiusKm) stillInside = false;
  }
  check("true cell still inside every exclusion radius when allowance = delta_att", stillInside);
}

// ---------------------------------------------------------------------------
section("interval filtering");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 17 });
  eng.loadPreset("baseline");
  eng.setAssessmentInterval(0, 1000);
  for (let k = 0; k < 3; k++) eng.probeAll(500 + k);
  const p1 = Float32Array.from(eng.computePosterior());
  const n1 = eng.getReadouts().receiptsInInterval;
  eng.probeAll(5000); // outside T
  const p2 = eng.computePosterior();
  const n2 = eng.getReadouts().receiptsInInterval;
  let maxDiff = 0;
  for (let i = 0; i < p1.length; i++) maxDiff = Math.max(maxDiff, Math.abs(p1[i] - p2[i]));
  check("receipts outside T do not change the count", n1 === 12 && n2 === 12, `n1=${n1} n2=${n2}`);
  check("receipts outside T do not change the posterior", maxDiff === 0, `maxDiff=${maxDiff}`);
}

// ---------------------------------------------------------------------------
section("trust cap: pi = 0.3 saturates near log2(1/0.3) bits (both bundle modes)");
// ---------------------------------------------------------------------------
{
  const cap = Math.log2(1 / 0.3); // ~1.737 bits
  const eng = createEngine({ seed: 19 });
  eng.addAnchor({ facility: "equinix-london", pi: 0.3 });
  const london = eng.getAnchors()[0];
  // Put declared = true at an exact cell center so the declared cell is the
  // honest model's own best explanation (no quantization drift).
  const g = eng.getGrid();
  const idx = eng.nearestCellIndex(52.205, 0.119);
  const declared = { lat: g.lats[idx], lon: g.lons[idx] };
  eng.setSimulator({
    trueLocation: declared,
    declared,
    delta_att: 0, // trust-cap physics does not depend on delta; 0 keeps the
    path_noise_mean: 0.1, // declared cell at the honest optimum under 'product'
    attack: "none",
  });
  eng.setEvaluatorParams({
    allowance: 0,
    assumed_interior_mean: 2.0, // conservative verifier: slow assumed tail
  });
  const refIdx = eng.nearestCellIndex(60.404, 25.106); // ~1800 km away: always excluded

  const gainBits = () => {
    const post = eng.computePosterior();
    return Math.log2(post[idx] / post[refIdx]);
  };

  const gains = { "rtt-min": [], product: [] };
  let everExceeded = false;
  for (let k = 0; k < 80; k++) {
    eng.probe(london.id, 1000 + k);
    if ((k + 1) % 10 === 0) {
      for (const mode of ["rtt-min", "product"]) {
        eng.setEvaluatorParams({ bundleMode: mode });
        const gb = gainBits();
        gains[mode].push(gb);
        if (gb > cap + 1e-6) everExceeded = true;
      }
    }
  }
  eng.setEvaluatorParams({ bundleMode: "rtt-min" });

  for (const mode of ["rtt-min", "product"]) {
    const gs = gains[mode];
    const final = gs[gs.length - 1];
    const mid = gs[3]; // after 40 probes
    check(
      `${mode}: declared-cell log-odds gain saturates near the cap (${fmt(final)} vs cap ${fmt(cap)})`,
      final > cap - 0.3 && final <= cap + 1e-6,
      `gains: ${gs.map((x) => fmt(x, 2)).join(", ")}`
    );
    check(`${mode}: gain plateaus under repeated probing`, Math.abs(final - mid) < 0.15, `|${fmt(final)} - ${fmt(mid)}|`);
  }
  check("gain never exceeds the log2(1/pi) ceiling in either mode", !everExceeded);
}

// ---------------------------------------------------------------------------
section("allowance attack: allowance > true delta_att excludes the truth");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 23 });
  eng.loadPreset("baseline"); // true delta_att = 0.05 ms
  const sim = eng.getSimulator();
  for (let k = 0; k < 20; k++) eng.probeAll(1000 + k);

  const trueIdx = eng.nearestCellIndex(sim.trueLocation.lat, sim.trueLocation.lon);
  eng.setEvaluatorParams({ allowance: 0.4 }); // >> true delta_att = 0.05
  const readouts = eng.getReadouts();
  let excludedBy = null;
  for (const ra of readouts.perAnchor) {
    const dist = eng.getAnchorDistField(ra.id);
    const dTruePoint = haversineKm(
      eng.getAnchors().find((a) => a.id === ra.id),
      sim.trueLocation
    );
    if (dist[trueIdx] > ra.exclusionRadiusKm && dTruePoint > ra.exclusionRadiusKm) {
      excludedBy = ra;
      break;
    }
  }
  check(
    "true cell falls outside at least one anchor's exclusion radius",
    excludedBy != null,
    excludedBy
      ? ""
      : readouts.perAnchor.map((ra) => `${ra.id}: r=${fmt(ra.exclusionRadiusKm, 0)} km`).join("; ")
  );
  if (excludedBy) {
    console.log(
      `        (excluded by ${excludedBy.id}: exclusion radius ${fmt(excludedBy.exclusionRadiusKm, 1)} km ` +
        `vs true distance ${fmt(eng.getAnchorDistField(excludedBy.id)[trueIdx], 1)} km)`
    );
  }
}

// ---------------------------------------------------------------------------
section("evasive preset: declared Tallinn, true St Petersburg");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 29 });
  const preset = eng.loadPreset("evasive");
  const declared = preset.declared;
  const trueLoc = preset.trueLocation;
  for (let k = 0; k < 15; k++) eng.probeAll(1000 + k);

  const R = 150; // km, "near" radius for mass readouts
  const post0 = eng.computePosterior();
  const massDecl0 = eng.massNear(declared.lat, declared.lon, R, post0);
  const massTrue0 = eng.massNear(trueLoc.lat, trueLoc.lon, R, post0);
  console.log(
    `        honest anchors, allowance 0, inflation padding: mass(decl)=${fmt(massDecl0, 4)} mass(true)=${fmt(massTrue0, 4)}`
  );
  check(
    "honest anchors + allowance 0: padding cannot concentrate mass near declared",
    massDecl0 < 0.05,
    `mass near declared = ${fmt(massDecl0, 4)}`
  );
  // Margin recalibrated in Phase 2: the conservative interior (DECISIONS.md
  // item 7, assumed_interior_mean 1.2 ms vs the old effective 0.15 ms)
  // deliberately flattens single-anchor discrimination, so the honest-branch
  // truth preference is ~7x rather than the >10x the sharp interior gave.
  check(
    "honest anchors + allowance 0: posterior prefers the truth",
    massTrue0 > 5 * massDecl0,
    `true ${fmt(massTrue0, 4)} vs decl ${fmt(massDecl0, 4)}`
  );

  // Branch A -- distrust the nearest anchor (Telia Tallinn) with high pi.
  // Its capped contradiction is neutralized, so mass near declared rises,
  // but the remaining honest anchors' (capped) contradictions still hold the
  // declared region below the truth -- the trust mixture working as designed.
  eng.setAnchorPi("telia-tallinn", 0.5);
  const postA = eng.computePosterior();
  const massDeclA = eng.massNear(declared.lat, declared.lon, R, postA);
  const massTrueA = eng.massNear(trueLoc.lat, trueLoc.lon, R, postA);
  const odds0 = massDecl0 / massTrue0;
  const oddsA = massDeclA / massTrueA;
  console.log(
    `        nearest anchor at pi=0.5: mass(decl)=${fmt(massDeclA, 4)} mass(true)=${fmt(massTrueA, 4)} ` +
      `decl:true odds ${fmt(oddsA, 4)} (honest ${fmt(odds0, 4)})`
  );
  check(
    "distrusting the nearest anchor materially shifts the declared:true odds toward declared",
    oddsA > 2 * odds0,
    `odds ${fmt(oddsA, 4)} vs honest ${fmt(odds0, 4)}`
  );

  // Branch B -- crank the allowance (deflation attack surface): write off so
  // much time that the far anchors' receipts are wholly consumed and the
  // near anchor's circle shrinks onto the declared city. The assessment is
  // now fooled: it prefers declared over the truth.
  eng.setAnchorPi("telia-tallinn", 0.1);
  eng.setEvaluatorParams({ allowance: 3.0 });
  const postB = eng.computePosterior();
  const massDeclB = eng.massNear(declared.lat, declared.lon, R, postB);
  const massTrueB = eng.massNear(trueLoc.lat, trueLoc.lon, R, postB);
  console.log(`        allowance 3.0 ms: mass(decl)=${fmt(massDeclB, 4)} mass(true)=${fmt(massTrueB, 4)}`);
  check(
    "raising the allowance lets the posterior concentrate near declared (mass(decl) > mass(true))",
    massDeclB > massTrueB,
    `decl ${fmt(massDeclB, 4)} vs true ${fmt(massTrueB, 4)}`
  );
  const oddsB = massDeclB / massTrueB;
  // Margin recalibrated in Phase 2 (see above): with the flat interior the
  // honest posterior already spreads more mass near declared, so the
  // allowance's odds flip is ~17x rather than >20x, and the absolute
  // mass-near-declared comparison (massDeclB > 2 * massDecl0) no longer
  // measures the flip -- the odds ratio and the decl > true ordering do.
  check(
    "raising the allowance flips the declared:true odds by more than 10x",
    oddsB > 10 * odds0,
    `odds ${fmt(oddsB, 4)} vs honest ${fmt(odds0, 4)}; mass ${fmt(massDeclB, 4)} vs ${fmt(massDecl0, 4)}`
  );
}

// ---------------------------------------------------------------------------
section("anchor dishonesty: fabrication fools a trusting evaluator (DECISIONS 8)");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 43 });
  const preset = eng.loadPreset("evasive");
  const declared = preset.declared;
  const trueLoc = preset.trueLocation;

  // The preset stages the trust story: Telia Tallinn rated an adversary of
  // the attester's operator (pi 0.03 -- the verifier's most trusted witness),
  // the three regional anchors rated allies (pi 0.30).
  const telia = eng.getAnchors().find((a) => a.id === "telia-tallinn");
  check("preset stages Telia Tallinn at adversary pi 0.03", Math.abs(telia.pi - 0.03) < 1e-9);

  // Flip the world: Telia secretly fabricates receipts consistent with the
  // DECLARED location. The evaluator still trusts it at pi 0.03.
  eng.setAnchorDishonest("telia-tallinn", true);
  check("dishonesty flag reads back", eng.isAnchorDishonest("telia-tallinn"));
  for (let k = 0; k < 8; k++) eng.probeAll(1000 + k);

  // Fabricated receipts violate the true-distance floor -- that is the point:
  // physics binds honest measurement, not invention.
  const dTrueTelia = haversineKm({ lat: telia.lat, lon: telia.lon }, trueLoc);
  const floorTelia = (2 * dTrueTelia) / V_FIBER;
  const teliaRtts = eng.getAnchorReceipts("telia-tallinn").map((r) => r.rtt);
  check(
    "fabricated receipts fall below 2*d_true/v_fiber (impossible for honest measurement)",
    Math.min(...teliaRtts) < floorTelia,
    `min rtt ${fmt(Math.min(...teliaRtts))} vs floor ${fmt(floorTelia)}`
  );

  // The assessment is fooled: the posterior's peak sits on the declared city
  // and near-declared mass beats near-truth mass.
  const post = eng.computePosterior();
  const g = eng.getGrid();
  let pk = 0;
  for (let i = 0; i < post.length; i++) if (post[i] > post[pk]) pk = i;
  const peakToDecl = haversineKm({ lat: g.lats[pk], lon: g.lons[pk] }, declared);
  check("posterior peak lands on the declared city", peakToDecl < 50, `${fmt(peakToDecl, 0)} km from declared`);
  const mD = eng.massNear(declared.lat, declared.lon, 25, post);
  const mT = eng.massNear(trueLoc.lat, trueLoc.lon, 25, post);
  check(
    "mass near declared exceeds mass near the truth (evaluator fooled)",
    mD > mT,
    `decl ${fmt(mD, 4)} vs true ${fmt(mT, 4)}`
  );

  // The defense: stop trusting the fabricator. Raising its pi to 0.3 caps its
  // contribution at log2(1/0.3) bits and the honest anchors' truth preference
  // reasserts itself.
  eng.setAnchorPi("telia-tallinn", 0.3);
  const post3 = eng.computePosterior();
  const mD50 = eng.massNear(declared.lat, declared.lon, 50, post3);
  const mT50 = eng.massNear(trueLoc.lat, trueLoc.lon, 50, post3);
  const mD150 = eng.massNear(declared.lat, declared.lon, 150, post3);
  const mT150 = eng.massNear(trueLoc.lat, trueLoc.lon, 150, post3);
  check(
    "raising the fabricator's pi to 0.3 restores the truth ordering",
    mT50 > mD50 && mT150 > mD150,
    `R50 decl ${fmt(mD50, 4)} vs true ${fmt(mT50, 4)}; R150 decl ${fmt(mD150, 4)} vs true ${fmt(mT150, 4)}`
  );

  // Presets describe worlds: reloading one resets simulator-side dishonesty.
  eng.loadPreset("evasive");
  check("loadPreset clears the dishonesty flag", !eng.isAnchorDishonest("telia-tallinn"));
}

// ---------------------------------------------------------------------------
section("conservative interior: single receipt reads as a broad glow (DECISIONS 7)");
// ---------------------------------------------------------------------------
{
  // One receipt, one anchor. The interior likelihood between the fiber ring
  // and a cell 500 km inside it must be a gentle gradient, not a cliff: under
  // the old effective mean (0.15 ms) this ratio was ~e^33 (~10^14); with the
  // conservative assumed_interior_mean (1.2 ms) it is e^(4.9/1.2) ~ 59.
  // (A literally flat interior, < 3x over 500 km, would need mu >= 4.5 ms and
  // erase the evasive preset's honest truth preference -- see DECISIONS.md.)
  const eng = createEngine({ seed: 47 });
  eng.addAnchor({ facility: "hetzner-falkenstein" });
  const rtt = 6.0; // ms -> fiber ring at 612 km, lightspeed ring at 900 km
  eng.addReceipt({ anchorId: "hetzner-falkenstein", rtt, timestampMs: 1000 });
  const { S } = eng.getAnchorField("hetzner-falkenstein");
  const dist = eng.getAnchorDistField("hetzner-falkenstein");
  const rFiber = (V_FIBER * rtt) / 2;
  const pick = (target) => {
    let best = -1;
    let bestErr = Infinity;
    for (let i = 0; i < dist.length; i++) {
      const err = Math.abs(dist[i] - target);
      if (err < bestErr) {
        bestErr = err;
        best = i;
      }
    }
    return best;
  };
  const iRing = pick(rFiber - 10);
  const iDeep = pick(rFiber - 510);
  const mu = eng.getEvaluatorParams().assumed_interior_mean;
  const logFloor = Math.log(1e-6) - Math.log(mu);
  const ratio = Math.exp(S[iRing] - S[iDeep]);
  check(
    "interior ratio over 500 km stays under 100x",
    ratio > 1 && ratio < 100,
    `ratio ${fmt(ratio, 1)} (ring d=${fmt(dist[iRing], 0)} km, deep d=${fmt(dist[iDeep], 0)} km)`
  );
  check(
    "both interior cells sit far above the epsilon floor",
    S[iRing] > logFloor + 5 && S[iDeep] > logFloor + 5
  );
}

// ---------------------------------------------------------------------------
section("rtt-min vs product bundling");
// ---------------------------------------------------------------------------
{
  const eng = createEngine({ seed: 31 });
  eng.loadPreset("baseline");
  const london = "equinix-london";
  for (let k = 0; k < 10; k++) eng.probe(london, 1000 + k);
  const rttMin = eng.getReadouts().perAnchor.find((a) => a.id === london).rttMin;

  // rtt-min (default): a same-anchor receipt that does not lower rtt_min
  // leaves the posterior untouched.
  const p1 = Float32Array.from(eng.computePosterior());
  eng.addReceipt({ anchorId: london, rtt: rttMin + 0.5, timestampMs: 1100 });
  const p2 = eng.computePosterior();
  let diffMin = 0;
  for (let i = 0; i < p1.length; i++) diffMin = Math.max(diffMin, Math.abs(p1[i] - p2[i]));
  check("rtt-min: extra receipt above rtt_min leaves the posterior unchanged", diffMin === 0, `maxDiff=${diffMin}`);

  // ...but a receipt that lowers rtt_min does move it.
  const p2b = Float32Array.from(p2);
  eng.addReceipt({ anchorId: london, rtt: rttMin - 0.03, timestampMs: 1101 });
  const p2c = eng.computePosterior();
  let diffLower = 0;
  for (let i = 0; i < p2b.length; i++) diffLower = Math.max(diffLower, Math.abs(p2b[i] - p2c[i]));
  check("rtt-min: a receipt that lowers rtt_min does move the posterior", diffLower > 1e-9, `maxDiff=${diffLower}`);

  // product: every extra receipt changes the posterior.
  eng.setEvaluatorParams({ bundleMode: "product" });
  const p3 = Float32Array.from(eng.computePosterior());
  eng.addReceipt({ anchorId: london, rtt: rttMin + 0.5, timestampMs: 1102 });
  const p4 = eng.computePosterior();
  let diffProd = 0;
  for (let i = 0; i < p3.length; i++) diffProd = Math.max(diffProd, Math.abs(p3[i] - p4[i]));
  check("product: the same extra receipt changes the posterior", diffProd > 1e-9, `maxDiff=${diffProd}`);
}

// ---------------------------------------------------------------------------
section("performance");
// ---------------------------------------------------------------------------
let reportedRecomputeMs = null;
{
  const eng = createEngine({ seed: 37 });
  eng.loadPreset("baseline"); // 4 anchors
  for (const fid of ["aws-frankfurt", "aws-dublin", "aws-stockholm", "gcp-hamina"])
    eng.addAnchor({ facility: fid });
  check("8 anchors configured", eng.getAnchors().length === 8);
  for (let k = 0; k < 50; k++) eng.probeAll(1000 + k); // 400 receipts
  check("400 receipts in interval", eng.getReadouts().receiptsInInterval === 400);

  const timeFull = () => {
    eng.setEvaluatorParams({}); // marks every anchor dirty: full recompute
    const t0 = performance.now();
    eng.computePosterior();
    return performance.now() - t0;
  };
  const runs = [];
  for (let k = 0; k < 7; k++) runs.push(timeFull());
  runs.sort((a, b) => a - b);
  const median = runs[3];
  reportedRecomputeMs = median;
  console.log(`        rtt-min full recompute (median of 7): ${fmt(median, 1)} ms  [${runs.map((x) => fmt(x, 1)).join(", ")}]`);
  check("full recompute (N=160, 8 anchors, 400 receipts, rtt-min) under 50 ms", median < 50, `${fmt(median, 1)} ms`);

  eng.setEvaluatorParams({ bundleMode: "product" });
  const pruns = [];
  for (let k = 0; k < 5; k++) {
    eng.setEvaluatorParams({});
    const t0 = performance.now();
    eng.computePosterior();
    pruns.push(performance.now() - t0);
  }
  pruns.sort((a, b) => a - b);
  console.log(`        product full recompute (median of 5): ${fmt(pruns[2], 1)} ms (reported, not asserted)`);

  // probe update touches only that anchor's arrays: should be much cheaper
  eng.setEvaluatorParams({ bundleMode: "rtt-min" });
  eng.computePosterior();
  const t0 = performance.now();
  eng.probe("equinix-london", 2000);
  eng.computePosterior();
  const probeMs = performance.now() - t0;
  console.log(`        probe + incremental recompute: ${fmt(probeMs, 2)} ms`);
  check("probe update is cheap (< 25 ms)", probeMs < 25, `${fmt(probeMs, 2)} ms`);
}

// ---------------------------------------------------------------------------
section("presets");
// ---------------------------------------------------------------------------
{
  check("five presets defined", PRESETS.length === 5, `got ${PRESETS.length}`);
  check(
    "every preset carries a caption, declared, true location, and attack mode",
    PRESETS.every((p) => p.caption && p.declared && p.trueLocation && ["none", "inflation", "deflation"].includes(p.attack))
  );
  const eng = createEngine({ seed: 41 });
  for (const p of PRESETS) {
    eng.loadPreset(p.id);
    const anchors = eng.getAnchors();
    if (anchors.length < 4 || anchors.length > 8) {
      check(`preset ${p.id} has 4-8 anchors`, false, `got ${anchors.length}`);
    }
  }
  check("all presets load and populate 4-8 anchors", true);
  check("facility library has the 10 PROMPT.md facilities", FACILITIES.length === 10);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`failures:\n  - ${failures.join("\n  - ")}`);
  process.exit(1);
}
