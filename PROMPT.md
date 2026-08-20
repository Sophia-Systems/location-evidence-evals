# PROMPT.md -- build specification for the evidence-evaluation visualization

You are building an interactive visualization of how signed location evidence updates belief about a machine's location. Read `paper/evidence-evaluation.md` and the other docs in this repository first; this page implements concepts described in those documents, it does not improvise on them. Where this spec and the paper disagree, the paper wins -- flag the conflict rather than silently choosing. The goal is to build a visualization / demo that communicates these concepts clearly so we can talk with more sophistication about the challenge and potential solutions.

Vocabulary follows the paper: anchor, attester, verifier; probe / receipt; declared location; location credibility assessment; posterior probability map; evidence evaluation function; delay allowance; `δ_att` (write `delta_att` in code); per-anchor compromise probability `ε_a` (write `eps_a` in code).

## Purpose and audience

The page exists to make five results feel obvious to a technically literate but non-specialist viewer:

1. A receipt does not point at a location -- it erases nearly everything outside a circle. Belief concentrates by exclusion.
2. Anchor geometry is information: a second anchor at a different bearing collapses the region; a second anchor in the same city likely adds little spatial information.
3. Trust scales influence: evidence from a distrusted anchor moves the map less, and no amount of it can concentrate the posterior past the `1/eps_a` ceiling. A geographically and institutionally heterogeneous anchor set produces the best-supported assessment.
4. The delay allowance is the deflation attack surface: writing off too much measured time as "processing" shrinks the circles below what physics justifies, and the true location can fall outside them -- the assessment becomes wrong, not just vague. The rule: write off only time no attester could avoid spending.
5. Inflation is asymmetric: added delay only ever pushes the apparent location *away* from honest anchors. Faking presence at a declared location requires a dishonest anchor or an exploited allowance, never padding alone.

Every interaction below exists to teach one of these. Resist adding controls that teach nothing.

## The world

- A map of Europe: simplified coastline and light country boundaries, inlined as data (no tile services -- the page makes zero network requests). Geography is context, not claim: keep boundaries visually quiet, with a km scale bar. Grid extent roughly 2,500 x 2,500 km covering the UK through western Russia. (In principle the domain is the whole Earth and truly 3D; v1 renders a flat 2D European window and says so in its info panel.)
- The **declared location** marker (distinct glyph, e.g. a star) -- the location under test.
- The **true location** of the attester, secret by default, revealable by a toggle ("reveal truth") -- when revealed, shown as a crosshair so the viewer can check the posterior probability map against it.
- 4 to 8 **anchor** markers, draggable. New anchors come from a small library of real facility locations (e.g. Hetzner Helsinki, Hetzner Falkenstein, AWS Frankfurt, AWS Dublin, AWS Stockholm, GCP Hamina, GCP St. Ghislain, Equinix London, Equinix Paris, Telia Tallinn) or from clicking anywhere on the map.
- The **posterior probability map** over the grid, rendered as translucent color over the base map, with a small legend. Grid is square-celled by default with a hex option (toggle), and a resolution control (cell size slider; default equivalent to ~160 x 160; must stay interactive at that size).
- A visible **time interval** for the assessment (e.g. "receipts from 12:00-12:05 UTC contribute"), settable; receipts are timestamped and only those inside the interval contribute. One interval per assessment -- this mirrors the paper's stationarity assumption and is displayed, not buried.

## Parameters -- all tunable, all explained

Every model parameter below appears in a parameters panel with an info affordance (hover/tap icon) giving BOTH a plain-language explanation and the technical notation. Example for `delta_att`: "Time the attester's machine spends handling a probe before answering -- waking the process, parsing, signing. Sits inside every measurement. Symbol: δ_att." Parameters:

- `v_c = 300 km/ms` -- lightspeed conversion for exclusion radii (security bound; fixed, shown not editable)
- `v_fiber = 204 km/ms` -- fiber propagation (c/n, n = 1.47), used to generate honest RTTs and for the soft interior
- `delta_att` (default 0.05 ms) -- true attester processing delay used by the simulator
- `path_noise` mean (default 0.1 ms) -- one-sided route/queueing excess, exponential
- `allowance` (default 0) -- the slice of RTT the verifier writes off before converting to distance; slider 0 to 0.5 ms, labeled in both ms and km of apparent-proximity effect
- per-anchor `eps_a` -- compromise probability, continuous slider 0.01 to 0.5, with identity presets (neutral 0.10, ally 0.30, adversary 0.03) as starting points

## The model to implement

Work in log-space per cell; renormalize after each update. The math must match the paper (sections 4-7); the paper wins on any conflict.

**Evidence.** Each "probe" action yields one signed receipt from one anchor -- a single RTT measurement. (Real deployments take the best of a burst; the burst is the measurement program's concern and is abstracted to one number here.) Simulator:

```
rtt = 2 * d_true / v_fiber + delta_att + path_noise_draw
```

where `d_true` is the anchor-to-true-location distance and `path_noise_draw >= 0` (exponential). No generated RTT is ever below `2 * d_true / v_fiber`.

**Honest likelihood for a cell at distance d from the anchor:**

```
exclusion radius:  r = v_c * (rtt - allowance) / 2
outside (d > r):   L = L_min
interior (d <= r): L = f(excess),   excess = rtt - 2 * d / v_fiber - allowance
```

`f` is the one-sided delay density (exponential, mean = path_noise mean + delta_att) -- large excess latency is mildly unlikely under compliant routing, so the interior is soft, never zero. `L_min` is a small constant (e.g. 1e-6 relative; not to be confused with `eps_a`, the compromise probability): the likelihood hits a hard cliff at the lightspeed bound but lands on a tiny residual floor rather than zero, because a cloned key, a broken signature scheme, a dishonest anchor, or an equipment fault could each produce a physically impossible-looking receipt. The info affordance on the map legend states this.

**Trust mixture.** Per anchor, with `eps_a` from its slider:

```
L_eff(bundle | x) = (1 - eps_a) * L_honest(bundle | x) + eps_a * L_flat
```

Here `x` is a candidate cell, and `L(bundle | x)` asks: how plausible is this anchor's evidence if the machine were in this cell? `L_flat` is a constant -- a dishonest anchor signs whatever it likes regardless of where the machine is, so its evidence carries no location information. The plain-language reading, which the info affordance should state: each anchor's evidence moves the map in proportion to how much we trust that anchor, because a distrusted anchor's receipts are partly explained away by "it may have fabricated them."

Apply the mixture to the anchor's whole bundle, not per receipt: track, per anchor, the product of its honest likelihoods per cell, and mix once per anchor when composing the posterior. This is what makes the trust ceiling real on screen -- evidence from a distrusted anchor visibly saturates.

**Evasive attester -- two attack classes, both simulated:**

- *Inflation (easy, weak):* the attester adds a chosen artificial delay per anchor before responding: `rtt = 2 * d_true / v_fiber + delta_att + artificial_delay_a + path_noise_draw`, `artificial_delay_a >= 0`. Built-in strategy: pad each anchor toward consistency with the declared location's distances, where physics permits.
- *Deflation (hard, dangerous):* the attester responds faster than the verifier's allowance assumes -- simulated by letting the evasive attester's true `delta_att` drop below the `allowance` the viewer has set (sandbagged calibration, optimized responder). This is what makes the allowance slider a live attack surface rather than an abstract control.

**Prior.** Uniform over the grid by default.

## Scenario presets

A preset picker loads configurations; each preset has a one-line caption stating what it demonstrates. The storyboard is these presets in a suggested order with brief captions -- brisk, skippable, free-play always available. Do not force a slow tutorial.

1. **Baseline** -- declared = true at Cambridge; anchors Helsinki, Falkenstein, Paris, London (the measurement testbed's geography). Step probe-by-probe and watch the map update smoothly: each receipt erases the outside of a circle (result 1). Includes an optional, collapsed "anatomy of a probe" panel -- what contributes to delay across the four-packet exchange -- as an extra feature, not a gate.
2. **Geometry** -- same, prompting the viewer to drag anchors: different bearing collapses the lens; co-located anchors add little (result 2).
3. **Trust** -- open an anchor's panel, drag its `eps_a` slider, probe: the same receipts move the map less as trust falls; the per-anchor readout shows the bits ceiling `log2(1/eps_a)`; a diverse-network arrangement visibly beats a same-operator cluster (result 3).
4. **The allowance** -- raise the allowance slider past the attester's true `delta_att` with truth revealed: circles shrink until the true location falls outside one -- the assessment is now wrong, not vague (result 4).
5. **Evasive attester** -- declared Tallinn, actually St Petersburg (close enough that the anchor geometry can resolve the difference). With honest anchors and allowance zero, padding cannot make the posterior settle on Tallinn -- the circles betray the inconsistency. Flip the nearest anchor dishonest (high `eps_a` -- or use the ally preset) or crank the allowance, and watch the assessment get fooled (result 5).

## Controls (revised, complete)

- Probe (per anchor) -- stepping one probe at a time is the primary interaction; "probe all" exists but is secondary
- Add anchor (from the facility library or by clicking the map); remove; drag to move
- Per-anchor panel: `eps_a` slider with identity presets, latest RTT, exclusion radius, bits ceiling
- Allowance slider (as specified above)
- Scenario preset picker (the five presets)
- Grid shape toggle (square / hex) and resolution slider
- Time interval control (display + set)
- Color ramp selector -- default viridis, plus magma and cividis; implement as inline lookup tables or closed-form approximations (no d3 dependency, no network)
- Reveal truth toggle
- Reset (returns to current preset's initial state)

Deliberately excluded: any geofence overlay or `P(inside region)` readout. That is the policy-evaluation stage, built later on top of this page's output (paper section 10). Do not add it. The country boundaries on the base map are context for the viewer, never inputs to the computation.

## Readouts

- Per-anchor (in its panel and on hover): latest RTT (ms), exclusion radius (km), `eps_a`, bits ceiling (`log2(1/eps_a)`).
- Global: receipts in the current interval; a one-line statement of the current assumptions, mirroring Q (e.g. "assumes: compliant attester; allowance = 0; trust as shown").

## Visual direction and implementation constraints

- This should be a slick spatial visualization: smooth, buttery animation, desktop-optimized. Mobile only if it costs nothing; when in doubt, desktop only.
- The one animation that matters most: new evidence arrives and the probability map transitions smoothly to its updated state (interpolate cell values over ~300-400 ms, interruptible). The exclusion circle draws crisply; the map settles fluidly. Respect `prefers-reduced-motion`.
- UI elements color: `#006a4e`. Probability mass uses the selected color ramp; keep the base map quiet so the ramp carries the information.
- One self-contained HTML file at `viz/index.html`. No external network requests, no CDN libraries; inline all CSS, JS, and map data. Canvas (or WebGL) rendering for the probability map.
- All computation client-side; a full grid recompute in under ~50 ms at default resolution (precompute per-anchor distance fields on anchor move; probe updates touch only likelihood arrays).
- Light and dark theme aware.

## Acceptance checklist

- [ ] A single probe animates a smooth map update: probability visibly drains outside the exclusion radius, the interior stays nearly flat.
- [ ] Two well-placed anchors produce a lens; two co-located anchors produce visibly negligible additional concentration.
- [ ] Dragging an anchor's `eps_a` slider visibly scales how much its evidence moves the map; with `eps_a = 0.3`, repeated probing saturates and the bits readout matches `log2(1/eps_a)`.
- [ ] Raising the allowance above the simulator's `delta_att` makes the revealed true location fall outside at least one exclusion radius.
- [ ] In the evasive preset with honest anchors and allowance zero, the posterior never concentrates on the declared location; with a dishonest anchor or an inflated allowance, it can.
- [ ] All noise is one-sided: no generated RTT is ever below `2 * d_true / v_fiber`.
- [ ] Every parameter has an info affordance with plain language plus notation.
- [ ] Grid shape toggle, resolution slider, time-interval control, and color ramp selector all function.
- [ ] The file makes zero network requests and works when opened from disk.
- [ ] No geofence, border, or compliance readout appears anywhere in the computation or readouts.
