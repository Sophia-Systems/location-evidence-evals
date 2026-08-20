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
