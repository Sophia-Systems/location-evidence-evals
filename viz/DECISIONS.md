# Viz build decisions

Adjudications made while building `viz/index.html`, recorded so they can be
reviewed and overruled. Sources: `../PROMPT.md` (build spec),
`../paper/evidence-evaluation.md` (working draft; sections 1-2 closely
reviewed, the rest not yet), and the Phase 1 audit. "Adjudicated by John"
marks calls he made directly; everything else is an orchestrator call
following those.

## Adjudicated by John

1. **Bundle composition.** Both modes implemented, switchable; default is
   `rtt-min` (paper section 6 redundancy discounting: a bundle's honest
   likelihood comes from its minimum RTT). `product` follows PROMPT.md's
   product-of-per-receipt-likelihoods reading.
2. **Precedence.** PROMPT.md's "the paper wins" clause is suspended: only
   paper sections 1-2 are treated as reviewed. Elsewhere, PROMPT.md governs
   implementation detail and every divergence is recorded here.

## Model calls (orchestrator)

3. **L_flat and the trust cap.** Per anchor, the dishonest branch's constant
   is set to the bundle's honest-likelihood maximum (equivalently: normalize
   the bundle field to max 1 and set L_flat = 1). Consequence: the per-anchor
   log-likelihood ratio between any two cells caps at log2(1/pi) bits exactly,
   in both bundle modes, independent of receipt count and units -- the bits
   readout is exact rather than approximate.
4. **The cap is per anchor, not global.** Paper section 7 caps the per-anchor
   Bayes factor; PROMPT.md's result-3 wording ("concentrate the posterior past
   the ceiling") risks reading as a posterior cap. Multiple anchors' capped
   contributions still multiply. UI copy must say "this anchor's contribution
   caps at log2(1/pi) bits."
5. **The fiber-to-lightspeed annulus.** PROMPT.md's interior formula is
   undefined for cells between the fiber ring and the lightspeed ring
   (negative excess). Implemented: log-linear decay from the interior peak at
   the fiber ring down to exactly the epsilon floor at the lightspeed ring, so
   the hard cliff lands on the residual floor precisely at the v_c bound
   (paper section 4's narrative). Neither text specifies this shape.
6. **Epsilon floor.** `1e-6 relative` is anchored to the interior peak f(0),
   applied per receipt and per bundle (~19.9 bits deep -- safely deeper than
   any trust cap, so the pi mixture is what binds, never the floor).
7. **Evaluator interior is deliberately conservative.** The evaluator's
   assumed excess mean is a separate parameter from the simulator's true
   noise, defaulting well above it (tuned in Phase 2 so acceptance item 1's
   "interior stays nearly flat" reads on screen). Rationale: paper section 4
   says the interior carries "almost nothing"; PROMPT.md's literal
   mean = path_noise + delta_att (0.15 ms ~ 15 km) makes single-receipt
   posteriors render as thin rings hugging the fiber circle, contradicting
   the acceptance checklist. The parameters panel exposes it with an info
   affordance; the divergence from PROMPT.md's formula line is deliberate.
8. **Simulator-side anchor dishonesty (fabrication) added.** Paper section 7:
   a dishonest anchor "can fabricate arbitrary evidence." The evaluator-side
   pi slider alone cannot make preset 5's assessment get fooled (discounting a
   truthful anchor shifts odds ~2.8x but three honest anchors still favor the
   truth -- the mixture resisting one bad anchor, as designed). The working
   demo of "fooled by a dishonest anchor" is: the anchor fabricates
   declared-consistent receipts while the verifier still trusts it (low pi);
   raising pi is then the defense. Added as a per-anchor simulator toggle,
   clearly labeled as simulation, not a verifier control.
9. **Allowance slider stays 0-0.5 ms** (PROMPT.md's range), labeled in km as
   exclusion-radius reduction at v_c: 150 km/ms, so full scale reads 75 km.
   Consequence: in preset 5 the allowance branch alone cannot flip a 315 km
   Tallinn/St-Petersburg separation (that needs ~3 ms); the fooling branch is
   carried by fabrication (8). The allowance's own lesson (result 4) lives in
   preset 4, where London-Cambridge (~90 km) flips within the slider's range.
10. **Correlated compromise is not modeled** (independent per-anchor pi only),
    matching PROMPT.md and open-questions item 5 (formalism unsettled). The
    Trust preset stages the same-operator lesson by hand: clustered
    same-operator anchors get correlated-looking pi values and the caption
    cites the paper's common-cause argument. Divergence from paper sections
    7/9 (variant 3's correlated compromise), recorded.
11. **No exclusion-only overlay / variant switcher** in v1 (paper section 9's
    "publish variant 1 alongside" default). The per-receipt v_c circles PROMPT
    already requires give the viewer the variant-1 intersection implicitly.
    Cheap candidate for v2.
12. **No attester-posture toggle.** The evaluator always uses the
    compliant-attester interior, even in evasive presets -- the assumptions
    readout says so, which is itself the lesson (the verifier's stated
    assumption being violated on screen). Paper section 4's "must use ...
    only when defensible" is recorded as diverged-from.
13. **Naming.** Code and UI use `pi` per PROMPT.md; the paper reserves pi for
    the posterior and calls the compromise prior epsilon_a. Info copy notes
    the paper's symbol.

## Semantics defaults (audit-proposed, adopted)

14. Time interval: closed [start, end]; editing it refilters receipts and
    triggers full recompute; an anchor with no in-interval receipts
    contributes nothing (L = 1); an empty interval yields the prior.
15. Moving an anchor clears its receipts (measured under old geometry);
    moving the true location does not (the verifier cannot know).
16. Anchors may sit anywhere on the plane, including off-grid; all distances
    are haversine. A receipt whose floor excludes every cell renormalizes to
    no update and is surfaced in the anchor panel as an impossible receipt.
17. Hex grid: equal-area hex lattice on the display plane, likelihood sampled
    at hex centers; resolution slider preserves total cell count parity with
    the square grid. Display-layout only; physics unchanged.
18. Deflation simulation: evasive attester's true processing delay is a fixed
    0.005 ms (below the honest 0.05 ms default); no extra control -- the
    viewer's allowance slider remains the single live attack surface.
19. Assumptions readout (mirrors Q): posture assumed (always "compliant"),
    allowance, trust summary, interval, prior. Hardware binding and signature
    soundness live in the static info panel.

## Phase 2 (build) refinements

20. **Interior mean lands at 1.2 ms, not the hoped-for flatter value.** Item
    7's target ("interior likelihood ratio between the fiber ring and a cell
    500 km inside it modest, say < 3x") is mathematically incompatible with
    the evasive preset's honest-branch truth preference: < 3x needs
    mu >= 4.5 ms, at which point the four honest anchors' combined
    Tallinn-vs-St-Petersburg discrimination drops under the mass thresholds
    the tests (and result 5's honest branch) require. Measured sweep over
    mu in [0.5, 3.0]: `assumed_interior_mean = 1.2 ms` is the compromise --
    single-receipt interior decays with an e-fold length of
    mu*v_fiber/2 ~ 122 km (broad glow, ~59x over 500 km, vs ~10^14 under the
    old effective 0.15 ms), while the evasive-preset orderings survive. The
    parameter replaces the evaluator-side `assumed_delta_att` +
    `assumed_path_noise_mean` pair, which had no other role.
21. **Preset 5 trust staging carries the fabrication demo.** Telia Tallinn is
    staged at adversary pi 0.03 (the verifier's most credible witness --
    believed adverse to the attester's operator, hence unlikely to fabricate
    in its favor) and the three regional anchors at ally pi 0.30. This
    concentrates honest discrimination in the anchor the fabrication flips,
    so the fooled posterior clears the remaining honest anchors' truth
    preference. Without the staging (all anchors neutral 0.10), fabrication
    cannot win the mass comparison at any interior mean that keeps the honest
    branch intact. PROMPT.md's own preset-5 text puts pi staging in play
    ("or use the ally preset").
22. **Two Phase-1 evasive margins recalibrated for the flat interior** (the
    behavioral claims are unchanged): honest-branch truth preference
    threshold 10x -> 5x (measured ~7x); allowance-flip odds threshold
    20x -> 10x (measured ~17x); the branch-B side clause
    `massDeclB > 2 * massDecl0` dropped -- with a flat interior the honest
    posterior already spreads mass near declared, so the flip is measured by
    the odds ratio and the decl > true ordering, not by absolute mass growth.
23. **Fabrication semantics.** A dishonest anchor's probe never measures the
    attester: it draws `rtt = 2 * d_declared / v_fiber + delta_att_true +
    Exp(path_noise_mean)` -- an honest-looking receipt for the declared spot.
    One-sidedness applies to the fabricated story, not to true propagation;
    fabricated receipts may (and in the test provably do) fall below
    `2 * d_true / v_fiber`. Simulator-side flag (`setAnchorDishonest`),
    cleared by `loadPreset`; attack modes (inflation/deflation) do not apply
    to a fabricating anchor, whose receipt ignores the attester entirely.
24. **Grid-resolution caveat on the fabrication demo.** A fabricating anchor
    ~3 km from the declared spot invents receipts so small that its v_c
    exclusion circle is ~10-25 km -- near the 160x160 grid's 16.25 km cell
    pitch. With many fabricated probes rtt_min can shrink the circle below
    the largest cell-center gap, leaving zero interior cells; the anchor's
    field then degrades to uninformative (all-floor, mixture flat) rather
    than misleading. Harmless in the staged demo (8 probes), but Phase 3
    should sanity-check heavy repeated probing of the dishonest anchor in
    the UI at coarse resolutions. *Resolved by item 25.*

## Phase 3 (review) refinements

25. **Cell-extent likelihood evaluation.** The Phase 3 review confirmed item
    24's degeneracy surfaces immediately: one fabricated Telia probe yields a
    ~20-30 km circle spanning at most a couple of 16.25 km cells, and heavy
    probing under rtt-min can leave zero interior cell centers, silently
    turning the anchor's evidence uninformative. Fix: every cell is evaluated
    at the NEAREST point of its extent -- `d_eff = max(0, d_center -
    cellRadKm)` (half-diagonal for square cells, Voronoi circumradius for
    hex) -- so an exclusion circle that intersects any part of a cell credits
    that cell, at every resolution. The shift is at most one cell radius and
    strictly conservative (keeps cells in, never wrongly excludes), so the
    hard cliff still lands at the v_c bound, one cell radius anti-aliased
    outward. Consequence: the honest-optimum ring sits ~one cell radius
    beyond the fiber ring in center-distance terms; the trust-cap test now
    measures at the posterior argmax rather than the declared cell center.
    Measured over 30 seeds, the staged fabrication demo (toggle + probe all
    x8) lands the fooled peak within 50 km of declared with near-declared
    mass above near-truth mass in 30/30 runs; preset 5's caption now steers
    the viewer to "probe all a few times" -- the staged, test-verified
    interaction.
26. **Preset trust staging: erasure lessons get high-trust anchors.** Live
    feedback (John): in the baseline preset, visible probability mass sat
    OUTSIDE the smallest exclusion circle, muddying result 1's "a receipt
    erases nearly everything outside a circle." Root cause: neutral pi = 0.10
    caps each anchor's outside suppression at 1/pi = 10x -- the trust ceiling
    correctly rendered, but that is preset 3's lesson, not preset 1's.
    Adjudication: presets 1 (baseline), 2 (geometry), and 4 (allowance) stage
    all anchors at pi = 0.02 (~5.6-bit ceiling, ~50x per-anchor outside
    suppression) with a caption note; the trust haze debuts in preset 3, which
    keeps neutral 0.10 starting points; preset 5 keeps its staging (item 21).
    The legend's floor copy now states that residual outside brightness is set
    by anchor trust, not physics. A numeric test pins the single-anchor
    peak/outside posterior ratio to ~1/pi at both 0.02 and 0.10.

## Phase 4 (rework): full-bleed layout, pan/zoom, finer geography

27. **Hand-added anchor trust inheritance.** *(Adjudicated by John.)*
    PROMPT.md/Phase 1-3 had every anchor added via the facility library or
    map click default to neutral pi = 0.10, regardless of scenario. John: a
    hand-added anchor should read as part of the loaded scenario, not
    silently dilute it with a neutral-trust outlier next to a staged
    high-trust set (or vice versa). Adjudication: new anchors inherit the
    loaded preset's trust staging -- HIGH_TRUST_PI (0.02) in presets 1/2/4
    (baseline, geometry, allowance -- the erasure lessons), neutral 0.10 in
    presets 3/5 (trust, evasive) and in any non-preset (free-play) state. An
    explicit `pi` passed to `addAnchor` still overrides inheritance. Engine
    tracks this as `defaultAnchorPi`, set in `loadPreset`; exposed as
    `getDefaultAnchorPi()` for the UI and tests.
28. **Heat overlay opacity slider + magma default ramp.** *(Adjudicated by
    John.)* PROMPT.md specifies viridis as the default color ramp and does
    not mention an opacity control. John, reviewing the live page: add an
    overlay-opacity slider (10-100%) directly under the ramp selector, and
    make magma the default ramp instead of viridis. (The default was 100%
    -- the prior fixed behavior -- lowered to 75% in the item-33 retune.) Ramp and opacity are display preferences (like
    grid shape/resolution) that persist across presets rather than resetting
    on `loadPreset`. Implemented as a single `ctx.globalAlpha` around the
    heat-canvas `drawImage` in render.js -- the per-cell alpha the field
    already encodes (structure/confidence, see ui.js `buildTargetT`) is
    untouched; opacity is a pure display multiplier on top of it.
29. **Map geometry refresh; land-fill layer attempted and deliberately
    skipped.** Regenerated `map-data.js` from Natural Earth 10m coastline /
    admin-0-boundary-lines-land sources (was 50m) at Douglas-Peucker
    tolerance 1.0 km (was 2.5 km), so zoomed-in views (up to 8x) show real
    coastline detail instead of the 50m simplification's facets: 316 coast +
    676 border polylines, 55.7 KB total, comfortably under the 250 KB budget
    (raised from 150 KB). Also built the optional quiet land-fill layer
    (`tools/make-map-data.mjs`: `processLandPolygons`, Sutherland-Hodgman
    rectangle clip against `ne_50m_land`) end to end and rendered it to
    `map-preview.svg` for visual review. It has a real bug: continental
    Europe filled correctly but Scandinavia and the British Isles rendered
    unfilled. Likely cause: clipping the (continent-spanning) Eurasian
    landmass ring against the small display window produces zero-width
    "bridge" edges where the ring exits and re-enters the window; running
    Douglas-Peucker simplification AFTER clipping can collapse a bridge
    (near-collinear points read as low perpendicular distance) in a way that
    flips evenodd fill parity for an enclosed lobe. A correct fix needs
    either a real polygon-clipping library with proper hole/winding
    handling, or simplifying before clipping so bridge geometry survives
    exactly -- out of scope for this pass. Per the build brief's own
    guidance ("if clipping proves fiddly, skip the fill, keep lines"): the
    land-fill code path is left in `make-map-data.mjs`, gated off by a
    `SHIP_LAND_FILL = false` constant with the bug written up inline, and
    `map-data.js` ships coastlines/borders only, no `LAND` export.
30. **Full-bleed map with floating panels.** *(Adjudicated by John.)* John,
    reviewing the live page: replace the fixed top-ribbon + right-sidebar
    layout with a full-bleed map canvas (`#map` now `position:absolute;
    inset:0` inside `.map-pane`, no more square-letterboxed centering) and
    floating overlay cards -- a scenario card top-left (brand, preset chips,
    caption, reveal-truth/reset -- the entry point, must not get lost), a
    collapsible parameters column floating on the right (scrollable within
    itself via `.params-scroll`, independent of the page), the legend
    bottom-right, the assumptions readout along the bottom, and a small
    reset-view control stacked above the legend. Kept every existing
    element id/class the JS wiring depends on; only the surrounding
    containers and CSS positioning changed. render.js's `resize()` and
    `kmToCss`/`cssToKm` were generalized in the same pass to support a
    non-square canvas (previously always square, centered, letterboxed) --
    this groundwork is shared with item 31 (pan/zoom), which reuses the same
    two functions for its view transform.
31. **Pan and zoom.** *(Adjudicated by John.)* Wheel-zoom centered on the
    cursor and drag-to-pan on empty map background, 1x (originally
    full-domain contain-fit; cover-fit since item 32) to 8x, on the
    existing azimuthal-equidistant plane -- a pure 2D affine view
    transform (`viewScale`/`viewCenter` in render.js), no reprojection.
    Everything reads it through `kmToCss`/`cssToKm`: heat layer, coastlines/
    borders, exclusion circles, anchors, declared star, truth crosshair,
    hover hit-testing, click-to-place. Anchor dragging wins over panning
    because `pointerdown` checks `anchorAt` first and only starts a pan when
    it finds nothing (or when not in placing mode); the existing 4 px
    click-vs-drag threshold is reused unmodified for pan's own click-vs-drag
    distinction, so an unmoved background click stays a no-op. Panning
    applies each pointer delta immediately (cheap arithmetic) but throttles
    the actual `drawScene()` to one per animation frame; wheel and pan never
    call `engine.computePosterior()`, only the view-transformed redraw --
    the posterior stays fixed while navigating. `viewCenter` was initially
    clamped loosely (±1.3x the domain half-extent); item 32's cover-fit
    pass replaced that with a tight visible-window-inside-domain clamp.
    Browser-verified: wheel-zoom into Denmark shows visibly finer
    10m coastline detail than the 1x overview; pan, anchor-drag-at-zoom, and
    probe-at-zoom all keep the heat layer/circles/anchors aligned; reset-view
    returns to the exact 1x/centered state.

## Phase 4 polish (orchestrator-confirmed visual defects)

32. **Cover-fit replaces contain-fit at 1x.** The item-30/31 layout still
    letterboxed the square ±1,300 km domain inside a wide viewport: the 1x
    baseline scaled the domain to the SHORTER canvas dimension, leaving
    dead background bands flanking it and the uniform-prior wash ending at
    an abrupt straight edge mid-screen -- not actually full-bleed. Now the
    1x baseline is COVER-fit (domain scaled to the longer dimension, its
    top/bottom or sides cropped as the aspect requires), initial view and
    reset-view use it, and the pan clamp is exact: the visible window stays
    inside the domain square at every zoom, so no outside-the-domain space
    is ever on screen and visible area ⊆ posterior grid always holds.
    `resize()` re-clamps because the cover scale changes with the viewport.
    Consequence accepted: at 1x on a 16:10 viewport the domain's far north
    (e.g. the Helsinki anchor) starts off-screen -- panning reaches it, and
    its receipts still update the map. The base-map vector clip's ±1,350 km
    overscan margin is now unreachable (harmless; left as data slack).
    Also: the canvas-drawn km scale bar was fully occluded by the floating
    assumptions readout (both bottom-left); the bar now draws just above it.
33. **Zero-structure posteriors render as a whisper, not a slab.** At magma
    + 100% opacity the uniform prior painted an opaque purple sheet over
    the basemap, contradicting the buildTargetT intent (dim haze until the
    evidence discriminates). Retuned as three coordinated display changes:
    uniform-belief display value 0.35 -> 0.22, heat alpha curve
    0.06 + 0.82·t^1.3 -> 0.045 + 0.875·t^1.8 (quieter through the low-mid
    range, still steep toward t = 1), and default overlay opacity
    100% -> 75%. Screenshot-verified progression in both themes: uniform
    prior = barely-there tint with the basemap clearly through it; one
    probe = bounded glow with readable coastlines; four-anchor lens =
    vivid peak. Coast/border stroke contrast over the (now lighter) wash
    was judged legible in both themes with the existing theme neutrals --
    no stroke-color change needed.
34. **Scenario captions wrap fully; length governed at the source.** The
    two-line clamp ellipsized the trust-note parentheticals mid-sentence
    ("(Anchors here are hig…"). The clamp and ellipsis are gone; each
    preset caption in engine.js is kept to one crisp sentence plus a short
    parenthetical trust note (the evasive caption was tightened), so the
    longest runs ~3 lines at the card's width.
