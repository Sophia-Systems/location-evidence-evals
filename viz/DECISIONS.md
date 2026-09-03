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

## v2: global Mercator display, tile basemap, windowed posterior

35. **Network calls allowed; tile basemap adopted.** *(Adjudicated by
    John.)* Supersedes PROMPT.md's zero-network clause (PROMPT.md itself is
    untouched -- it is the author's file). The display is a hand-rolled
    Web Mercator slippy map: Carto Positron `light_all` @2x tiles
    (`dark_all` under `prefers-color-scheme: dark`), subdomain rotation
    a-d, 400-entry LRU cache, blank-on-404, attribution "© OpenStreetMap
    contributors © CARTO" along the bottom edge while tiles are in use. No
    map library -- the no-dependency single-file build stands. build.mjs's
    verification changed from "zero http(s) URLs" to a whitelist of
    exactly the Carto tile host; imports/fetch/XHR/link/src remain
    forbidden, so the page's entire network surface is tile GETs.
36. **Offline fallback: small global vector layer + city labels.**
    *(Adjudicated by John: small matters more than detail -- tiles carry
    detail when online.)* map-data.js regenerated as GLOBAL Natural Earth
    50m coastline + admin-0 boundary lines, Douglas-Peucker 0.05 deg,
    quantized 0.01 deg, antimeridian-split, 97.8 KB against the <=350 KB
    budget. Coordinates are stored as lon/lat degrees (projection-agnostic;
    the renderer converts to Mercator world units once at startup --
    documented in the generated header). The vector layer ALWAYS draws
    beneath the tiles, so the map is never blank while tiles load; when
    the first tile failure arrives with zero successes the page flips to
    fallback-only (a single later success clears the flag for good). A
    ~45-entry MAJOR_CITIES set renders as subtle dot+label ONLY in
    offline mode (tiles carry their own labels; never double-label), with
    greedy label decluttering. Judgment calls: city labels and the window
    boundary draw ABOVE the heat wash for legibility (the "beneath
    everything" rule is applied to the geography linework); the
    attribution line hides in offline mode since the fallback geography
    is public-domain Natural Earth, not OSM/CARTO.
37. **Windowed posterior -- "region under evaluation."** *(Adjudicated by
    John.)* The hypothesis space stays the finite ~2,600 km square window
    (the engine grid; widened to ~3,600 km by item 42), now decoupled from
    the display. geo.js is
    parameterized by window center (projectAt/unprojectAt; the
    CENTER-bound wrappers keep the v1 contract, so the default center
    54N 13E leaves every legacy test's geometry unchanged). Presets
    recenter the window on their declared location (the Cambridge presets
    pin CENTER instead since item 42); a small "evaluate
    here" control recenters it on the current view center. Moving the
    window RETAINS every receipt -- evidence is evidence; the hypothesis
    space moved -- and recomputes cell lat/lons plus per-anchor distance
    fields (all haversine, so anchors may sit anywhere on Earth). The
    cell-indexed prior resets to uniform on a move (it has no meaning
    over a different region); the display snaps rather than tweening
    across hypothesis spaces. Tests cover recentering round-trips
    (posterior reproduced exactly from retained receipts) and the
    far-away anchor (Tokyo probing a Cambridge attester: ~14,000 km
    circle, window wholly interior, tilt bounded by 1/pi -- result 2 at
    global scale).
38. **Heat rendering: pixel->cell map instead of per-update quad
    rasterization.** The brief suggested projecting ~26k cell quads per
    posterior update; implemented instead as a precomputed Int32Array
    mapping each offscreen pixel (640 px wide, covering the window's
    Mercator bbox; -1 outside the window) to its grid cell -- rebuilt
    only on grid or window change, exactly the pattern the v1 hex path
    already used. Rationale: the posterior tween calls updateHeat every
    animation frame for ~350 ms, and a straight per-pixel LUT write
    (~300k pixels) beats 26k Path2D fills per frame by an order of
    magnitude while producing the identical image (each pixel gets its
    cell's color; cell boundaries are exact at the raster's resolution).
    Square grids index directly; hex grids go through coarse buckets.
39. **Single world copy; no horizontal wrap except geodesic circles.**
    The effective minimum zoom rises with viewport size
    (max(2, log2(viewport/256))) so one Mercator world always covers the
    screen, and the view clamps inside it -- tiles, vector paths, heat,
    and markers never need wraparound copies. Cost: the date-line seam
    cannot be panned across (the Pacific view splits there), acceptable
    for a viz whose subjects live on continents. Exclusion circles are
    the one genuinely wrapping geometry: their ~181 sampled bearings are
    longitude-unwrapped into a continuous path which is re-stroked a
    world-width left/right when it overflows, so a Tokyo-sized circle
    crosses the antimeridian without streaks (browser-verified).
40. **Scale bar is latitude-local.** Mercator meters-per-pixel varies
    with latitude, so the bar re-derives from the view-center latitude
    and states it ("500 km at 53°N") -- exact at center, approximate
    toward the top and bottom of the viewport.
41. **Default view is inset cover-fit ON the evaluation window.**
    *(Adjudicated by John.)* Amends the view-fit semantics of items 32/36:
    after the v2 move to a global map, the contain-fit default put the
    whole window inside the viewport, so the posterior heat -- which
    exists only within the window -- visibly cut off at the window
    boundary mid-screen and looked broken to a first-time viewer. The
    default view (initial load, preset load/recenter, "evaluate here",
    and reset-view) is now inset cover-fit, centered on the window center
    (the preset's declared location). The fit is computed against the
    sampled boundary polygon, not its Mercator bbox -- the square's edges
    bow inward in Mercator near the corners, so a bbox cover-fit left the
    corners poking into the viewport (browser-caught). Per boundary point
    the minimal scale pushing it off-screen is min(w/2|dx|, h/2|dy|); the
    max over all points is the exact inscribed cover for any viewport
    aspect (wide and tall alike), then x 1.15 inset. The viewport
    therefore sits strictly inside the window with the nearest boundary
    ~7.5% of the viewport span beyond the edge; boundary and heat edge
    are just off-screen and appear
    only when the viewer deliberately zooms out -- exactly when the
    "region under evaluation" framing helps rather than confuses. Pan and
    zoom limits are unchanged (world view remains reachable). "Evaluate
    here" now re-frames as well, so the new window position gets the same
    default framing; the latitude-local scale bar (item 40) needs no
    change since it re-derives per draw.
42. **Wider window; default view frames the preset's staging, clamped
    inside the window.** *(Adjudicated by John; centering geometry
    corrected during the build.)* Supersedes item 41's fit rule and
    amends the window size stated in items 35-41. The author's conflict:
    item 41's inset cover fit hid the evaluation-window edge, but in the
    Cambridge presets it also pushed Hetzner Helsinki off-screen -- the
    staging spans ~1,760 km, so "window edge off-screen" implied "far
    anchors off-screen". Both matter: every staged anchor visible at
    load AND no heat edge visible.

    The adjudicated remedy: HALF_EXTENT 1,300 -> 1,800 km (~3,600 km
    window), default grid 160 -> 180 so the cell pitch stays 20 km
    (full recompute measured 9.1 ms median at 180x180, 8 anchors, 400
    receipts -- budget 50 ms), and a new default view: frame ALL of the
    preset's anchors plus the declared marker with a ~15% margin,
    clamped so the viewport still sits strictly inside the window.

    Build-measured correction: the adjudication predicted the clamp
    would never bite, but for a window centered on the DECLARED location
    that is geometrically false at any window size the build could
    justify -- Cambridge sits at the corner of its own staging, so the
    window's usable interior beyond Helsinki was ~330 km and the sampled
    boundary-cover fit exceeded the zero-margin anchor frame at wide
    viewport aspects (infeasible for any view center up to a ~5,600 km
    window). Two amendments deliver the adjudication's intent within its
    numbers: (a) the four Cambridge presets pin `windowCenter: CENTER`
    (54N 13E -- the v1 domain center, which is the staging's midpoint;
    the preset schema already carried the pin for exactly this), so the
    window regains symmetric slack around the staging; (b) the fit rule
    is s = min(max(frame@15%, cover x 1.05), frame@0%) -- frame the
    staging at 15% margin, zoom in just enough to hide the boundary when
    it would intrude (the margin compresses adaptively, e.g. to ~13.8%
    at 1600x1000; anchors themselves never leave the screen while the
    cover fit stays below the zero-margin frame, test-asserted per
    preset), with the clamp inset softened from item 41's 1.15 to 1.05
    since it now competes with anchor visibility. "Evaluate here" and
    other non-preset framings keep the item-41 cover fit at 1.15 (no
    natural anchor frame); reset-view re-frames the current staging,
    anchor drags included. The evasive preset's tight Tallinn staging is
    frame-bound (~z7.4 over the Gulf of Finland), asserted in tests. The
    fit math is a pure exported function (computeViewFit) so the node
    suite verifies all five presets at 1600x1000: staging framed with
    >=10% margin, boundary entirely off-screen.

## v3: simplification pass (adjudicated by John)

43. **Two scenarios, less chrome, evidence made visible.** John reviewed the
    five-preset build and directed a simplification: the demo teaches best
    with just **Baseline** (erasure: belief concentrates by exclusion) and
    **Evasive attester** (padding cannot fake presence; reveal-truth defaults
    on and the true location joins the default frame). Removed from the UI --
    engine capabilities and tests retained -- were the geometry / trust /
    allowance presets, the anchor fabrication toggle, the assessment-interval
    panel (the interval is now always all receipts), the bundle-mode switch
    (rtt-min only), and the "evaluate here" control. The per-anchor `pi` is
    surfaced as **collusion risk** (the chance the anchor colludes with the
    attester), which resolves the apparent inversion of the identity presets:
    an ally of the attester's operator carries HIGH risk (0.30), an adversary
    the LOWEST (0.03) -- the most credible witness -- now stated in a hint
    under the preset chips. Added: an orienting blurb (the map is the
    probability distribution over the machine's location, updated as receipts
    arrive; links johnx.co/research -- a nav-only href whitelisted in
    build.mjs), a five-step "how to use" list, an evidence log under the
    scenario card (one row per signed receipt, expanding to a simplified
    plugin-rtt-anchor-style record with pseudo keys/signatures), the
    assumptions line relocated into the scenario card, every info tip cut to
    one or two sentences, overlay opacity defaulting to 100%, and the
    declared star replaced by an ink-ringed translucent circle the truth
    graticule overlays cleanly when declared = true.

44. **Second review round (adjudicated by John).** The scenario card leads
    with policy motivation (AI-chip location verification as a check on
    declared use and proliferation risk) in John's own copy, then mechanism
    (anchor nodes probe attester nodes with governed GPUs; signed challenges;
    lightspeed bounds), then what the demo shows (evidence updating the
    spatial probability distribution) with the research link; the subtitle
    line is gone. "How to use" is now "Instructions". The simulator panel is
    removed outright -- free-play world-truth knobs (attack mode, true
    delta_att, path noise) confused more than they taught; the scenario
    defines the world, and a new read-only **Attester** card on the left
    (declared location, behavior, true location hidden behind "Reveal true
    location") organizes the story: attester and evidence left, anchors
    right. The collusion-risk tip is one line ("Higher risk means this
    anchor's evidence carries less weight"). Natural-language UI copy is
    sentence-cased throughout (parameter/variable names stay as symbols).
    Evidence rows no longer shrink when several are expanded (flex: none;
    receipt fields wrap). Credits added to "About this model".

45. **Third review round (adjudicated by John).** Title is "Verifying
    compute location" (page <title> too). Blurb: attester nodes "operating
    sensitive GPUs"; the research link reads as a link (weight + tasteful
    underline). The attester block moved inside the scenario card under a
    "Scenario" header (chips + Reset + attester rows); behavior wording is
    simply "Evasive -- manipulates responses". The preset caption and the
    assumptions line (compliant attester / allowance / uniform prior) are
    gone -- jargon without a reader. Credits link John Hoopes ->
    johnx.co/research and CAISH Hardware Assurance Programme ->
    caish.org/hardware (both whitelisted as nav-only hrefs). The map
    tooltip sizes to its content (width: max-content) so the risk/cap line
    no longer spills past the box, and default framing now subtracts the
    LEFT column's obstruction as well as the right's, so the staging
    centers in the visible gap (frameWindow gained an obstructLeft).

## v4: the mobile story

46. **Small screens get a scroll story, not a squeezed bench.** *(Adjudicated
    by John: a very simplified mobile experience -- "a step through or scroll
    story visualizing the key idea".)* The bench pins `min-width: 1080px` and
    PROMPT.md says desktop-optimized, mobile only if free; instead of a
    responsive retrofit, a second self-contained page `viz/story.html`
    (build.mjs now emits both) tells the one idea in six beats over the same
    engine and renderer: the claim (uniform belief), one receipt (erasure),
    geometry (the lens on Cambridge), trust (the same receipts prove less at
    collusion risk 0.30), the lie (evasive preset, padding toward Tallinn),
    detection (truth revealed in St Petersburg -- the false claim falsified;
    the allowance and anchor-independence caveats close as an aside, per
    John's correction that the story must END on detection, result 5, not on
    the allowance failure, result 4). Mechanics: a sticky full-viewport map
    behind scroll-driven cards (IntersectionObserver, plus per-card "next"
    buttons and a progress rail); steps are CUMULATIVE engine ops replayed
    from a fixed-seed base, so scrolling in any order reproduces identical
    state -- forward-by-one plays the step's staged probes, any other jump
    rebuilds silently and tweens once. The camera fit reuses computeViewFit
    with the bench's obstruction idea turned vertical (the card floats over
    the viewport bottom; the stage centers in the unobstructed region), via
    new raw view accessors (getView/setView) on the renderer. Two display
    divergences from the bench, both because the cards narrate the wash:
    uniform-belief tint 0.22 -> 0.32 and overlay opacity 100%.
    buildTargetT/presentField are copied from ui.js rather than shared --
    ui.js keeps them private to buildApp, and extracting them mid-flight was
    judged worse than a noted duplication. story.css mirrors the theme
    tokens for the same reason (render.js reads them off document.body).
    index.html redirects viewports <= 760 px to the story; `?full` is the
    escape hatch, and the story's own "full demo" link uses it so the pages
    never bounce.

47. **Story pared to five calibrated steps.** *(Adjudicated by John,
    reviewing item 46's build.)* Directions applied: eyebrows and the kicker
    removed (cards open with their heading; the progress rail alone carries
    position); the OPERATOR declares, the DEVICE is measured -- wording fixed
    throughout; the "locations inside stay roughly equally plausible" claim
    cut (it contradicts the on-screen ring-shaped interior); the trust beat
    REMOVED entirely (anchor trust is not a concept the mobile story should
    introduce); the padding/inflation mechanism no longer narrated in the
    false-declaration beat (the story shows only that probability mass
    settles away from the declared location -- lacing in the latency nuance
    was judged a mistake); and the closing claim recalibrated from "the
    declaration is falsified" to "the declaration is improbable ... grounds
    to flag it for scrutiny," with an explicit "simplified, illustrative
    simulation" aside -- John's standing rule: never overstate; humble,
    accurate, understated language over persuasion. Framing fix recorded
    with it: both false-declaration steps frame the ACTUAL location too, and
    the story's camera fit dropped computeViewFit's boundary-cover clamp
    (which compressed margins to zero on narrow viewports and cropped the
    truth crosshair) for a plain bbox frame fit at a fixed margin -- the
    story's framings sit well inside the window, so the clamp bought
    nothing.

48. **Title slide opens the story with the desktop intro.** *(Adjudicated by
    John: the opening was abrupt -- lead with "Verifying compute location"
    and the intro he added to the desktop scenario card, then scroll into
    the map.)* New centered step 0 reuses the desktop blurbs near-verbatim
    (its third paragraph adapted to name this page a walkthrough); its map
    is backdrop, so the fit COVER-fits the staged region on the full
    viewport (a contain fit on a tall phone stretched to the window
    boundary and north Africa), while story steps keep the contain fit
    above the card. The declaration card is cut to what is on screen --
    marker, anchors, uniform overlay -- with "without relying on the
    operator's word" and the aim statement dropped as overexplanation. The
    closing aside now says the desktop version "has more features" instead
    of "the full demo," and its link reads "Open the desktop version."

49. **Orientation beat, solid declared marker, research link first.**
    *(Adjudicated by John.)* The false-declaration sequence split in two:
    the scenario jump lands on an orientation step (new area, uniform
    field, declared Tallinn, no evidence yet), and the next scroll expands
    the frame to include the actual location while the staged probes render
    the heatmap ("The anchors probe it"). The story's declared marker is a
    solid fill via a new scene.declaredSolid flag -- the bench keeps its
    deliberately translucent interior (item 43), which on the story read as
    a rendering mistake; the story's guided camera keeps the peak visible
    around the marker anyway. The closing card leads with "About this
    research" as the primary action (driving phone readers to the site
    beats sending them to a desktop-only page); the desktop link is
    secondary. The declaration card also drops its "Before any
    measurements..." sentence.

## v5: vector tile basemap

50. **Vector tiles replace the raster basemap; the style is the page's own.**
    *(Adjudicated by John: "the main should be nice vector tiles, fallback you
    shouldn't have to touch.")* Supersedes item 35's raster choice. The source
    is Carto's `carto.streets` MVT tileset (`tiles-{a-d}.basemaps.cartocdn.com`,
    z0-14) decoded by a new dependency-free `src/vector-tiles.js`: a ~200-line
    protobuf reader, the geometry command-stream walker, and a style table.
    The no-dependency single-file build stands -- MapLibre GL was never an
    option under it, and the slice of the format this needs is small.

    The point is not sharpness, it is CONTROL. Raster tiles arrive
    pre-colored, so item 35's basemap was Positron's palette in light and Dark
    Matter's in dark, and the viz had to accept both. Vector tiles carry
    geometry only, so `STYLE.light` / `STYLE.dark` derive the whole basemap
    from the page's own tokens -- warm paper and green-black, the same
    quiet the rest of the bench is quiet in. A theme flip is now a repaint,
    not a second tile fetch. Labels render in the page's UI typeface (the
    source's SDF glyph PBFs are deliberately not loaded), which is why they
    match the bench's type rather than sitting inside the image.

    Three calls worth recording, each caught in the browser:
    (a) **Water is fill-only, never stroked.** Tile polygons arrive clipped to
    the tile bounds, so a ring carries artificial edges along the boundary;
    stroking them painted a straight line down every seam in the viewport.
    The shoreline is instead the land/sea tonal step, which is why that pair
    sits a clear step apart. Positron does the same -- its water layer has no
    outline anywhere.
    (b) **Every style pass runs across all visible tiles before the next.**
    Drawing tile-by-tile lets a neighbour's road casing overdraw the fill an
    earlier tile already painted, leaving dark stubs at each seam.
    (c) **Labels are gated far above a general-purpose basemap's thresholds.**
    The map's subject is the probability field, so place names are orientation
    furniture only. `capital` is graded rather than boolean (2 national, 4
    regional): promoting every `capital > 0` pulled every county seat onto a
    continental view. Country `rank` does not separate size cleanly either --
    rank 3 holds Netherlands and Estonia beside Monaco and San Marino -- but
    rank 5+ is unambiguously the Jersey / Isle of Man tier.

    Roads are motorway and trunk only until z8, each fading in over the zoom
    unit above its threshold so a class never pops on at full weight.

    **The offline fallback is untouched**, as directed: `map-data.js`, the
    inlined coastlines/borders, `MAJOR_CITIES`, and `drawCities` are all
    unchanged, and `isOffline()` keeps the raster layer's exact contract
    (first failure with zero successes flips to fallback; one later success
    clears it for good). Browser-verified against a dead tile host.

51. **build.mjs's fetch ban narrows to a budget.** MVT tiles are
    ArrayBuffers, so the vector basemap must `fetch` them -- the raster layer
    could use `new Image()`, which is why the blanket ban held until now.
    Dropping the check outright would have given up a real guarantee, so it
    is replaced by: exactly ONE fetch call site, and it must be the tile
    fetch. Combined with the unchanged URL whitelist (every http(s) literal in
    the bundle points at the tile host), a lone fetch cannot reach anywhere
    else -- there is no other absolute URL in the file for it to build. The
    tile host and path are kept as literals in the URL template for exactly
    this reason: the whitelist works by inspection, and a host assembled from
    variables would defeat it.

## v6: one source for the deployed demo

52. **The deployed demo's edits come back into `viz/src`; the site repo is
    deploy-only.** After the built pages were copied into the personal-site
    repo on 21 August, the next six changes were made to the built
    `index.html` there rather than here: the framework link in the blurb,
    the auto-run stepper with the instructions fold closed by default, the
    one-row scenario header with short chip labels, the inline eye toggle,
    and the declared-marker rings that PR #11 had already proposed on this
    side. That left this repository unable to rebuild what was deployed.

    Each of those is now a source change here (one commit per site commit,
    each naming the site commit it ports). A rebuild from `viz/src`
    reproduces the deployed bench byte-for-byte apart from three comment
    lines the build strips. The rule going forward: `viz/src` is the only
    place the demo is edited; deploying is `node viz/build.mjs` and a copy
    of the two built pages into the site repo. Editing the built page is a
    one-way street, and this is the second time it has cost a
    reconciliation.

    The vector tile basemap (items 50 and 51) is merged on the same branch,
    so the next deploy also carries it; the site copy still draws the
    raster basemap until then.
