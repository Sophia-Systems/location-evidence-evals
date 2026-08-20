# PROMPT.md -- build specification for the evidence-evaluation visualization

You are building an interactive visualization of how signed location evidence updates belief about a machine's location. Read `paper/evidence-evaluation.md` and the other docs in this repository first; this page implements concepts described in those documents, it does not improvise on them. Where this spec and the paper disagree, the paper wins -- flag the conflict rather than silently choosing. The goal is to build a visualization / demo that communicates these concepts clearly so we can talk with more sophistication about the challenge and potential solutions.

## Purpose and audience

The page exists to make five results feel obvious to a technically literate but non-specialist viewer:

1. A receipt does not point at a location -- it erases nearly everything outside a circle. Belief concentrates by exclusion.
2. Anchor geometry is information: a second anchor at a different bearing collapses the region; a second anchor in the same city likely adds little spatial information.
3. Trust caps confidence: evidence from a distrusted anchor cannot concentrate the posterior past the `1/pi` ceiling, no matter how many receipts it signs.
4. Over-subtracting the processing-delay floor manufactures false proximity -- the one control that can make the system *wrong* rather than merely imprecise.
5. Evasion is asymmetric: an evasive attester can only push its apparent location *away* from honest anchors, so appearing somewhere it is not requires a dishonest anchor or an exploited floor -- added delay alone never fakes presence at the declared location.

Every interaction below exists to teach exactly one of these. Resist adding controls that teach nothing.

## The world

- A map of Europe: simplified coastline and light country boundaries, inlined as data (no tile services -- the page makes zero network requests). Geography is context, not claim: keep boundaries visually quiet, with a km scale bar. Grid extent roughly 2,500 x 2,500 km centered to cover the UK through Finland.
- The **declared location** marker (distinct glyph, e.g. a star), default at Cambridge, UK -- the location under test.
- The **true location** of the attester, secret by default, revealable by a toggle ("reveal truth") -- when revealed, shown as a crosshair so the viewer can check the posterior probability map against it. In the default scenario the true location matches the declaration; the evasive scenario (Act 5) separates them.
- 4 to 8 **anchor** markers, draggable; defaults at Helsinki, Falkenstein, Paris, and London (mirroring the measurement testbed's geography). Each anchor has an operator identity: **neutral**, **ally** (of the attester's operator), or **adversary** (of the attester's operator), cycled by clicking a badge on the anchor.
- The **posterior probability map** over a square grid (default 160 x 160 cells; must stay interactive at that size), rendered as translucent color over the map. Include a small legend.

## The model to implement

Work in log-space per cell; renormalize after each update.

**Per-anchor evidence.** Each "probe" action generates a burst from one anchor and reduces it to that anchor's minimum observed RTT -- one `RTT_min` observation per anchor per round (redundancy discounting, paper section 6):

```
rtt_min = 2 * d_true / v_fiber + delta_proc + path_noise
```

where `d_true` is the distance from the anchor to the true location, `v_fiber = 204 km/ms` (c/n, n = 1.47), `delta_proc` (the attester processing delay) defaults to 0.05 ms, and `path_noise` is a one-sided draw (exponential, mean 0.1 ms). Noise never subtracts.

**Honest likelihood for a cell at distance d from the anchor:**

```
exclusion radius:  r = v_c * (rtt_min - assumed_floor) / 2      with v_c = 300 km/ms
outside:           L = epsilon                                   if d > r
interior:          L = f(excess)                                 if d <= r
```

where `excess = rtt_min - 2 * d / v_fiber - assumed_floor` and `f` is the one-sided delay density (exponential, mean 0.1 ms) -- large excess latency is mildly unlikely under compliant routing, so the interior is soft, never zero. `epsilon` is a small constant (e.g. 1e-6 relative), because likelihood beyond the exclusion radius is small but never exactly zero (paper section 4) -- and so the map degrades gracefully instead of hard-clipping. `assumed_floor` defaults to 0 (see the floor control below).

**Trust mixture.** Each anchor's identity sets a compromise prior `pi`: neutral 0.10, ally 0.30, adversary 0.03. (Directional deception is an open question; v1 applies a single scalar `pi` regardless of the evidence's direction, and says so in the info panel.) The effective likelihood is:

```
L_eff(bundle | x) = (1 - pi) * L_honest(bundle | x) + pi * L_flat
```

with `L_flat` a constant (a dishonest anchor signs this evidence regardless of x). Apply the mixture at the level of the anchor's whole bundle, not per receipt: track, per anchor, the product of its honest likelihoods per cell, and mix once per anchor when composing the posterior. This is what makes result 3 true on screen -- repeated probes from a distrusted anchor visibly saturate.

**Evasive attester.** In the evasive scenario the attester adds a per-anchor artificial delay of its choosing (non-negative, by physics) before responding. Model as `rtt_min = 2 * d_true / v_fiber + delta_proc + artificial_delay_a + path_noise`, with `artificial_delay_a >= 0` chosen per anchor by a simple built-in strategy (e.g. pad every anchor so all RTTs are consistent with the declared location's distances, where possible).

**Prior.** Uniform over the plane by default.

## Storyboard -- the page should guide the viewer through these in order

**Act 1: what a receipt is.** One anchor, declared location visible. Viewer clicks "probe." The exclusion-radius circle draws, the outside of the circle visibly drains of probability, the inside barely changes. Caption teaches result 1.

**Act 2: geometry.** Viewer adds a second anchor. If placed at a different bearing, the posterior collapses to a lens; a "try it" hint suggests dragging the second anchor near the first to watch the update do almost nothing. Caption teaches result 2.

**Act 3: trust.** Viewer sets one anchor to ally (`pi = 0.30`) and probes repeatedly. The posterior refuses to concentrate past the cap; a small readout next to the anchor shows "max contribution: ~1.7 bits" updating with identity. Switching the same anchor to adversary shows the same measurements suddenly carrying more weight. Caption teaches result 3 and states the per-anchor (not per-receipt) nature of the cap.

**Act 4: the floor lever.** A single slider, "assumed processing-delay floor subtracted," default 0. As the viewer raises it above the true `delta_proc`, exclusion radii shrink and -- with truth revealed -- the true location visibly falls outside a circle: the system is now confidently wrong. Caption teaches result 4 and states the rule: subtract only adversarial minima.

**Act 5: the evasive attester.** A scenario preset: the declaration still says Cambridge, but the true location is far to the east, near the Russian border. The attester pads its responses to mimic Cambridge-consistent delays. The viewer probes and watches what physics allows: anchors east of the truth see RTTs too *short* to be Cambridge unless padded, but padding only ever moves apparent location *away* -- with honest anchors the posterior refuses to settle on Cambridge, and the exclusion circles betray the inconsistency. Then the viewer flips the Helsinki anchor to ally (dishonest) or raises the assumed floor, and watches the evaluation get fooled. Caption teaches result 5: delay games alone cannot fake presence; deception requires a dishonest anchor or an unsound floor.

Acts are sections of one page (scroll or stepper), all driving the same canvas state; the viewer can also free-play after the storyboard.

## Controls (complete list -- nothing else)

- Probe (per anchor, and a "probe all" button)
- Add / remove anchor (4 to 8); drag to move
- Anchor identity badge: neutral / ally / adversary
- Assumed-floor slider (0 to 0.5 ms), labeled in both ms and "km of stolen proximity"
- Scenario toggle: compliant / evasive (Act 5 preset)
- Reveal truth toggle
- Reset

Deliberately excluded: any geofence overlay or `P(inside region)` readout. That is the geospatial policy layer, a separate step built later on top of this page's output (paper section 10). Do not add it. The country boundaries on the base map are context for the viewer, never inputs to the computation.

## Readouts

- Per-anchor: latest `RTT_min` (ms), exclusion radius (km), `pi`, max contribution in bits (`log2(1/pi)`).
- Global: number of evidence bundles applied; a one-line statement of the current variant's assumptions (mirrors Q, e.g. "assumes: compliant attester; floor policy = zero subtraction; trust priors as shown").

## Implementation constraints

- One self-contained HTML file at `viz/index.html`. No external network requests, no CDN libraries; inline all CSS, JS, and map data. Canvas rendering for the probability map.
- All computation client-side; recompute the 160 x 160 grid in under ~50 ms on a typical laptop (precompute per-anchor distance fields on anchor move; probe updates then touch only likelihood arrays).
- Light and dark theme aware. Responsive down to a 13-inch laptop; mobile is a non-goal.
- Plain, restrained visual design: quiet base map, a single accent hue for probability mass, distinct but subdued glyphs for declared location, truth, and anchors. No decorative animation beyond the circle-draw and map transitions, which should be fast (under 400 ms) and interruptible.

## Acceptance checklist

- [ ] A single probe visibly erases probability outside the exclusion radius and leaves the interior nearly flat.
- [ ] Two well-placed anchors produce a lens; two co-located anchors produce visibly negligible additional concentration.
- [ ] With one ally anchor and 20 probes, the posterior stops concentrating at the cap; the bits readout matches `log2(1/pi)`.
- [ ] Raising the assumed floor above the true `delta_proc` makes the revealed true location fall outside at least one exclusion radius.
- [ ] In the evasive scenario with all-honest anchors and floor at zero, the posterior never concentrates on the declared location; with a dishonest anchor or an over-subtracted floor, it can.
- [ ] All noise is one-sided: no generated RTT is ever below `2 * d_true / v_fiber`.
- [ ] The file makes zero network requests and works when opened from disk.
- [ ] No geofence, border, or compliance readout appears anywhere in the computation or readouts.
