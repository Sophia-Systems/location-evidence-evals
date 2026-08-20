# PROMPT.md -- build specification for the evidence-evaluation visualization

You are building an interactive visualization of how signed new locationn evidence updates belief about a machine's location. Read `README.md` and other docs in this repository first; this page implements concepts described in those documents, it does not improvise on it. Where this spec and README.md disagree, README.md wins -- flag the conflict rather than silently choosing. The goal is to build a visualization / demo that communicates these concepts clearly so we can talk with more sophistication about the challenge and potential solutions.

## Purpose and audience

The page exists to make four results feel obvious to a technically literate but non-specialist viewer:

1. A ping does not point at a location -- it erases everything outside a circle. Belief concentrates by exclusion.
2. Anchor geometry is information: a second anchor at a different bearing collapses the region; a second anchor in the same city likely adds little spatial information.
3. Trust caps confidence: evidence from a distrusted anchor cannot concentrate the posterior past the `1/pi` ceiling, no matter how many pings it sends.
4. Over-subtracting the turnaround floor manufactures false proximity -- the one control that can make the system *wrong* rather than merely imprecise.

Every interaction below exists to teach exactly one of these. Resist adding controls that teach nothing.

## The world

- An abstract plane, 2,000 x 2,000 km, light neutral background with a subtle grid and a km scale bar. No real geography needed; if a decorative coastline helps legibility it must not imply real borders.
- A **claimed location** marker (distinct glyph, e.g. a star).
- The **true location** of the machine, secret by default, revealable by a toggle ("reveal truth") -- when revealed, shown as a crosshair so the viewer can check the posterior against it.
- 4 to 8 **anchor** markers, draggable. Each anchor has an operator identity: **neutral**, **ally** (of the prover), or **adversary** (of the prover), cycled by clicking a badge on the anchor.
- A **posterior heatmap** over a square grid (default 160 x 160 cells; must stay interactive at that size), rendered as translucent color over the plane. Include a small legend.

## The model to implement

Work in log-space per cell; renormalize after each update.

**Per-anchor evidence.** Each "send ping" action generates a burst from one anchor and reduces it to that anchor's minimum RTT (one observation per anchor per round, per README.md section 5):

```
rtt_min = 2 * d_true / v_fiber + turnaround + path_noise
```

where `d_true` is the distance from the anchor to the true location, `v_fiber = 200 km/ms`, `turnaround` defaults to 0.05 ms, and `path_noise` is a one-sided draw (exponential, mean 0.1 ms). Noise never subtracts.

**Honest likelihood for a cell at distance d from the anchor:**

```
bound:      d_max = v_c * (rtt_min - assumed_floor) / 2      with v_c = 300 km/ms
hard edge:  L = epsilon                                       if d > d_max
interior:   L = f(excess)                                     if d <= d_max
```

where `excess = rtt_min - 2 * d / v_fiber - assumed_floor` and `f` is the one-sided delay density (exponential, mean 0.1 ms) -- large excess is mildly unlikely under honest routing, so the interior is soft, never zero. `epsilon` is a small constant (e.g. 1e-6 relative) so the heatmap degrades gracefully instead of hard-clipping. `assumed_floor` defaults to 0 (see the turnaround control below).

**Trust mixture.** Each anchor's identity sets a compromise prior `pi`: neutral 0.10, ally 0.30, adversary 0.03. (Directional deception is an open question; v1 applies a single scalar `pi` regardless of the evidence's direction, and says so in the info panel.) The effective likelihood is:

```
L_eff(e | x) = (1 - pi) * L_honest(e | x) + pi * L_flat
```

with `L_flat` a constant (the fabricating anchor produces this evidence regardless of x). Apply the mixture at the level of the anchor's whole bundle, not per ping: implement by tracking, per anchor, the product of its honest likelihoods per cell, and mixing once per anchor when composing the posterior. This is what makes result 3 true on screen -- repeated pings from a distrusted anchor visibly saturate.

**Prior.** Uniform over the plane by default.

## Storyboard -- the page should guide the viewer through these in order

**Act 1: what a ping is.** One anchor, claimed location visible. Viewer clicks "send ping." The disk boundary draws, the outside of the disk visibly drains of probability, the inside barely changes. Caption teaches result 1.

**Act 2: geometry.** Viewer adds a second anchor. If placed at a different bearing, the posterior collapses to a lens; a "try it" hint suggests dragging the second anchor near the first to watch the update do almost nothing. Caption teaches result 2.

**Act 3: trust.** Viewer sets one anchor to ally (`pi = 0.30`) and hammers "send ping" repeatedly. The posterior refuses to concentrate past the cap; a small readout next to the anchor shows "max contribution: ~1.7 bits" updating with identity. Switching the same anchor to adversary shows the same measurements suddenly carrying more weight. Caption teaches result 3 and states the per-anchor (not per-ping) nature of the cap.

**Act 4: the turnaround lever.** A single slider, "assumed turnaround floor subtracted," default 0. As the viewer raises it above the true turnaround, disks shrink and -- with truth revealed -- the true location visibly falls outside a disk: the system is now confidently wrong. Caption teaches result 4 and states the rule: subtract only adversarial minima.

Acts are sections of one page (scroll or stepper), all driving the same canvas state; the viewer can also free-play after the storyboard.

## Controls (complete list -- nothing else)

- Send ping (per anchor, and a "ping all" button)
- Add / remove anchor (4 to 8); drag to move
- Anchor identity badge: neutral / ally / adversary
- Assumed-floor slider (0 to 0.5 ms), labeled in both ms and "meters of stolen proximity"
- Reveal truth toggle
- Reset

Deliberately excluded: any geofence overlay or `P(inside region)` readout. That is the geospatial policy layer, a separate step built later on top of this page's output (see README.md section 8). Do not add it.

## Readouts

- Per-anchor: latest min RTT (ms), implied distance bound (km), `pi`, max contribution in bits (`log2(1/pi)`).
- Global: number of evidence bundles applied; a one-line statement of the current variant's assumptions (mirrors Q, e.g. "assumes: floor policy = zero subtraction; trust priors as shown").

## Implementation constraints

- One self-contained HTML file at `viz/index.html`. No external network requests, no CDN libraries; inline all CSS and JS. Canvas rendering for the heatmap.
- All computation client-side; recompute the 160 x 160 grid in under ~50 ms on a typical laptop (precompute per-anchor distance fields on anchor move; ping updates then touch only likelihood arrays).
- Light and dark theme aware. Responsive down to a 13-inch laptop; mobile is a non-goal.
- Plain, restrained visual design: neutral background, a single accent hue for probability mass, distinct but quiet glyphs for claimed location, truth, and anchors. No decorative animation beyond the disk-draw and heatmap transitions, which should be fast (under 400 ms) and interruptible.

## Acceptance checklist

- [ ] A single ping visibly erases probability outside the disk and leaves the interior nearly flat.
- [ ] Two well-placed anchors produce a lens; two co-located anchors produce visibly negligible additional concentration.
- [ ] With one ally anchor and 20 pings, the posterior stops concentrating at the cap; the bits readout matches `log2(1/pi)`.
- [ ] Raising the assumed floor above the true turnaround makes the revealed true location fall outside at least one disk.
- [ ] All noise is one-sided: no generated RTT is ever below `2 * d_true / v_fiber`.
- [ ] The file makes zero network requests and works when opened from disk.
- [ ] No geofence, border, or compliance readout appears anywhere.
