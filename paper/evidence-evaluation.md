# Evidence evaluation for latency-based location verification

Working draft. This document specifies how signed round-trip-time evidence updates belief about where a machine is -- the evidence evaluation function. It supports the reference implementation (`src/`) and the interactive visualization (`viz/`, build spec in `../PROMPT.md`). Open questions are tracked in [`../open-questions.md`](../open-questions.md).

## 1. Motivation

Coordination on steering advanced AI rests on frontier organizations making credible declarations about their compute: what accelerators they operate, and where. Verifying the location component of such a declaration is a small, concrete piece of that problem -- a way to detect defection from declared arrangements early enough to respond, before dangerous capabilities are developed outside the terms parties agreed to. Hardware-enabled assurance mechanisms are the natural near-term home for this capability; export-control enforcement is one concrete application among several.

This document addresses one layer of that verification: given a stream of signed latency measurements, what should a verifier believe about where the attester is, and with what confidence?

## 2. Setting and vocabulary

Three parties, following the terminology of the measurement program:
<!--AI speak, no. Use full sentences ftlog-->
- **Anchor.** A fixed host at known, declared coordinates that responds to probes and signs receipts. (The literature also refers to this role as "landmark" or "watchtower" nodes.)
- **Attester.** The machine whose location is being measured. 
- **Verifier.** The service that evaluates evidence and location-based policy conformance.

The measurement objects: a **probe** is a measurement packet; the **challenge** is the nonce inside it; a **receipt** is the anchor's signed, timestamped response. The **declared location** is the coordinates asserted by the operator or a registry -- the thing under test. The **evaluated location** is the output of this layer: a posterior over locations with confidence. <!--this last one is misleading, it is more the "assessment" in the framework https://www.johnx.co/research/location-verification-framework. We should align to that but it should be clearer language imo. maybe location assessment, or spatial probability assessment? -->

More generally, the object under evaluation is an **event**, claimed to have occurred within a spacetime envelope: here, "this chip was present" within a spatial region and a temporal range. The framework is deliberately flexible about what event is claimed; the machinery below is written for presence of an attester key, which is what RTT evidence can speak to.<!--Just saying "The framework" is a bit presumptuous, we should introduce it humbly given that we wrote it ...-->

A standing caveat that belongs in every artifact built on this document: RTT locates the **keyholder**, not the GPU. Until a hardware binding layer exists, all of this is evidence about where the attester's signing key answers from.
<!--This should be stated as an assumption or depenency, not "until a hardware binding layer exists". We also maybe should mention quantum ? i.e. depending on the digital signature algorithm used ...-->
### Where this layer sits
<!--I'm kind of allergic to you using the word "layer" ... it is very rarely clear to me what that actually means. -->
**Evidence evaluation** (this document). Input: receipts, anchor metadata, a prior. Output: `(posterior probability map, Q)` -- a posterior distribution over locations for a stated temporal range, plus qualifiers recording assumptions and limitations. This layer deliberately ignores policy questions involving geofences, borders, or time-series analysis.
**Geospatial policy evaluation** (downstream, out of scope). Consumes `(posterior probability map, Q)` and applies a policy: geofencing (containment in a policy zone), change detection (deviation in a time series), co-location likelihood (crossover-distance quantification). For geofencing, the core operation is nearly trivial -- `P(inside geofence)` is the sum of posterior mass in the cells inside the polygon -- and turning that number plus Q into a yes/no requires a threshold that encodes tolerance for false accusations versus missed evasions. That threshold is a policy judgment, which is why it does not belong in the evidence layer. This split follows [Cankaya's](https://www.lesswrong.com/posts/fgvmKqRGvBteKeDoc/a-system-overview-for-near-term-low-trust-ai-compute) principle of separating evidence capture and commitment from evaluation.

### Two attester postures

The likelihood model must declare which world it is computed in:

- A **compliant attester** answers probes as fast as its hardware and software allow. It does not manipulate its own delay.
- An **evasive attester** plays games with its own delay -- inserting artificial latency, optimizing its response path beyond calibrated expectations, or answering selectively -- to move the evaluated location away from the areas that appear likelier.
<!--"plays games" no, i want to be serious-->
Nothing an evasive attester does can make it appear *closer* to an honest anchor than it is (section 4). Everything else about the likelihood -- the informativeness of large delays, the safety of floor subtraction -- depends on which posture is assumed, and the assumption is recorded in Q.
<!--this last paragraph lost me-->
---
TODO:
## 3. The measurement primitive

In the [RTT protocol under investigation](https://github.com/location-proofs/plugin-rtt-anchor), one measurement is a four-packet exchange. The anchor times the interval from its own transmission of a challenge to its own receipt of the signed challenge nonce -- one clock, one machine, no synchronization. The anchor then signs the interval it measured, so the verifier receives the number exactly as the anchor produced it; the attester relays the receipt but cannot alter it. This design resists a dishonest attester by construction -- the attester never reports a measurement, only the anchor does -- and it concentrates the trust question on the anchor, which section 7 takes up.

The measured interval contains the network path anchor-to-attester, the **attester processing delay** (symbol `δ_proc`: kernel delivery, scheduler wake-up, parsing, signing), and the path back. The defining property of everything in the interval besides propagation is that it is one-sided -- queueing, scheduling, and signing only ever add time:

```
measured RTT = propagation + δ_proc + queueing,    every term >= 0
```

Because all noise is additive, the estimator of the floor is **RTT_min**, the minimum over a large sample: each probe is a draw, and the minimum converges on true propagation plus irreducible processing from above, never undershooting. For the same reason honest noise fails safe -- it can only loosen the bounds below, never wrongly exclude the true location. (How each nanosecond of the interval is spent, and how RTT_min converges, is the subject of the ongoing [measurement program](https://github.com/location-proofs/experiments/tree/main/plugin-rtt-anchor); this document takes the signed interval as given.)

## 4. What one receipt does to belief

This is the core of the document. A receipt from an anchor at known coordinates carries two very different kinds of information about the attester's position.

**A hard outer bound: the exclusion radius.** The attester cannot be farther from the anchor than signal propagation allows:

```
exclusion radius = v x (RTT - floor) / 2
```

where `floor` is whatever fixed delay the verifier is entitled to subtract (section 5) and `v` is a propagation speed. Two conversions serve different purposes:

- At `v = c` (vacuum, ~300,000 km/s), the exclusion radius is safe against any physically possible attester: no medium and no route beats light. This is the conversion for security claims.
- At `v = c/n ≈ 204,000 km/s` (fiber, n = 1.47), the radius is tighter and realistic for honest infrastructure -- but an evasive attester with straighter routing or faster media (microwave links approach c) could sit outside it. This is the conversion for precision expectations, never for exclusion.

Against an honest anchor, no attester strategy produces an RTT below true propagation, so the region beyond the exclusion radius is nearly ruled out. Nearly, not absolutely: the likelihood out there is small but never zero -- a cloned or stolen attester key answering from elsewhere, a dishonest anchor, or an equipment fault can each produce a receipt that physics alone could not. The hard bound is a statement conditional on the cryptographic and honesty assumptions holding, and the evaluation keeps that residual explicit rather than rounding it to zero. Geometrically: a steep cliff in likelihood at the exclusion radius, with a floor beyond it, not an abyss.

**Almost nothing on the inner side.** A machine next to the anchor can trivially show a 200 ms RTT by delaying its response, so a large RTT is weak evidence of distance. How weak depends on the attester posture. For a compliant attester, excess latency beyond the propagation floor follows empirical path-inflation statistics (Spring et al. 2003; Bozkurt et al. 2017) -- honest routes have bounded path stretch, so "very close but very slow" can be softly down-weighted. For an evasive attester, delay is free to manufacture, and the interior of the disk carries essentially no gradient. The likelihood model must use the compliant-attester interior only when that assumption is defensible, and Q records the choice.

The picture to hold: a receipt does not point at a location. It erases nearly everything outside a circle and says little inside it. The evaluated location emerges from the intersection of many such circles.

## 5. The floor subtraction rule

`δ_proc` sits inside every measured interval, and the verifier must decide how much of the interval to attribute to it before converting the remainder to distance. That choice is a security parameter.

**Subtract only adversarial minima -- what the fastest physically possible attester could achieve -- never calibrated typicals.** Every microsecond of assumed floor above the true adversarial minimum is a microsecond an evasive attester can reclaim as apparent proximity: sandbag during calibration so the assumed floor is generous, then respond at proof time through an optimized path (kernel bypass, fast signing hardware), and appear closer by the reclaimed time multiplied by the conversion speed. Over-subtraction is the one error that makes the evaluation confidently wrong rather than imprecise: the true cell can fall outside the computed exclusion radius entirely. Subtracting zero is always sound. Subtracting the provable minimum cost of the forced signature is sound only if that minimum is genuinely hardware-independent. Subtracting a measured typical `δ_proc` is an attack surface.

The same rule closes a tempting refinement. Because every anchor's receipt about one attester contains the same host's `δ_proc`, these errors are shared rather than independent, and a verifier could in principle estimate the shared component jointly across anchors and subtract it -- tightening every exclusion radius at once, the way a GPS receiver solves for its own clock bias. Against a compliant attester this works. Against an evasive one it is unsafe: by answering one favored anchor quickly and the rest slowly, the attester inflates the estimated shared delay and manufactures proximity to the favored anchor. Joint estimation of `δ_proc` is admissible only under the compliant-attester assumption, and its use is recorded in Q.

Beyond this rule, this document treats `δ_proc` minimally: it is a variable in the model whose distribution -- its floor, its tail, its behavior under GPU load -- is the subject of ongoing empirical work in the measurement program. Rigorous quantification belongs there, not here.

## 6. The engine

Grid the region of interest into cells. The posterior is computed for a stated temporal range `T`, from the receipts whose anchor timestamps fall within `T`. Each receipt is a point-in-time observation by the anchor's clock; the collection of them is evidence about whether the attester was present in a given cell during `T`. The output is a **posterior probability map**: for each cell `x`,

```
posterior(x) ∝ prior(x) × product over anchors of L(bundle_a | x)
```

where `bundle_a` is anchor `a`'s receipts within `T`, and `L(bundle_a | x)` is the likelihood of that bundle if the attester were in cell `x`. Multiply, renormalize; that is the entire engine. Every subtlety in this document lives inside the likelihood terms, plus the bookkeeping in Q.

Three commitments make the semantics precise:

- **The existential reading.** The map answers: with what probability was the attester present in cell `x` at some moment within `T`. Containment *throughout* a range -- the universal reading -- is a claim about a trajectory across successive spacetime envelopes, which is time-series analysis and belongs to the policy layer.
- **Stationarity within the range.** Combining receipts from across `T` into one map assumes the attester did not move within `T`. The assumption is recorded in Q alongside the range itself; choosing ranges short enough that movement is implausible is part of evaluation design.
- **The declared location is a hypothesis, not the prior.** The prior represents where the machine could plausibly be before this evidence -- for example, uniform over viable datacenter locations. Reported probabilities depend on it, so the prior is recorded in Q, and the exclusion-only variant (section 9) exists to give a prior-free statement alongside the Bayesian one.

Per-anchor bundling implements **redundancy discounting**, one of the framework's [design properties](https://www.johnx.co/research/location-verification-framework#design-properties): evidence that carries the same information must not be counted twice. Receipts from one anchor share a path, and their information about distance is nearly exhausted by the smallest of them -- so a bundle contributes through its RTT_min, not through its count. Receipts from different anchors traverse different paths and genuinely multiply; geometrically, each anchor contributes its own circle, and the posterior mass concentrates where the circles intersect. Shared components across anchors -- `δ_proc` above all -- are the limit of that independence, and section 5 governs how they may be treated.

## 7. Anchor trust

The receipt design (section 3) concentrates trust in the anchor: the anchor's signed interval is the only number the verifier relies on, so a **dishonest anchor** -- one that signs intervals it did not measure, whether through collusion, key theft, or coercion -- can fabricate arbitrary evidence. Most latency-based location verification designs assume honest anchors outright; Sheng et al.'s [BFT-PoLoc](https://arxiv.org/abs/2403.13230) (2024) instead tolerates a Byzantine fraction of anchors through fortified multilateration. This document takes a complementary route: rather than assuming honesty or bounding the dishonest fraction, quantify each anchor's trustworthiness and carry it through the evaluation. Trust-minimized anchor-network design remains an open question.

Give each anchor a compromise probability `pi`: the prior probability that it is dishonest. Its bundle's likelihood becomes a mixture:

```
L(bundle | x) = (1 - pi) × L_honest(bundle | x) + pi × L_dishonest(bundle | x)
```

A dishonest anchor can sign anything regardless of where the attester is, so `L_dishonest` carries no location information -- approximately flat in `x`.

**The trust cap.** The mixture bounds what any one anchor can contribute. However precise the measurements, the hypothesis "this anchor is dishonest" retains its prior probability `pi`, so the odds an anchor's bundle can generate in favor of the declared location saturate near `1/pi`. An anchor with `pi = 0.1` contributes at most about 3.3 bits toward the declaration; `pi = 0.01` caps near 6.6 bits. Past that ceiling, measurement precision changes nothing -- only trust does. Anchor governance, not measurement engineering, sets the limit on achievable confidence.

The cap binds per anchor, not per receipt. Receipts from one anchor are conditionally independent given that anchor's honesty, but they all share the single event "this anchor is dishonest." The mixture therefore applies once, to the anchor's whole bundle: additional receipts tighten the exclusion radius under the honest branch, and leave the `pi` term untouched.

**Correlated compromise.** Compromise events are not independent across anchors. Anchors sharing an operator, a jurisdiction, or a legal exposure can fail together -- one court order, one key-management breach, one shared motive. Five same-operator anchors provide five anchors' worth of geometry but roughly one anchor's worth of trust, so the joint compromise model needs common-cause structure, and operator and jurisdictional diversity become axes of evidence quality separate from geographic spread. A well-supported evaluation needs all of them; this is the framework's heterogeneity argument made quantitative. Prior work on quantifying exactly these axes for node networks exists in [GEOBEAT](https://geobeat.xyz) (physical distribution, jurisdictional diversity, infrastructure heterogeneity); a credible diversity measure for anchor sets will need harder effort and is tracked as an open question.

**Directionality (open).** Whether a dishonest anchor would fabricate evidence *for* or *against* a declaration depends on its interests relative to that declaration, and evidence against the signer's interest is the most credible kind. Specifying this requires fixing the claim structure and is parked in [`../open-questions.md`](../open-questions.md). For simulation, three anchor-operator identities -- ally, adversary, neutral -- each carrying a compromise prior are a sufficient simplification.

## 8. Qualifiers Q

A posterior probability map is a summary, and like any summary it leaves things out. Q records what the map does not quantify: the assumptions it was computed under, and the properties of the evidence behind it that a consumer needs in order to weigh it. Q travels alongside the map rather than being folded into it -- discounting the probability by robustness inside the evidence layer would smuggle policy weighting into the evidence math, exactly what the two-layer split exists to prevent.

The dimensions below are a working draft, not a settled schema. Identifying the right, preferably irreducible set of qualifier dimensions is one of the open problems of the broader research program (see [technical risks and open unknowns](https://www.johnx.co/research/location-verification-research-agenda#technical-risks-and-open-unknowns)); this draft exists to be argued with.

- **Attester posture and threat model.** Which variant produced the map (section 9): compliant or evasive attester assumed; anchors assumed honest or mixed over compromise.
- **Floor policy.** What was subtracted from measured intervals and its provenance: zero, provable signature minimum, calibrated typical (with the attack surface that implies), joint estimate (compliant-attester only).
- **Anchor set.** Operators, jurisdictions, and geometry of the contributing anchors, and the compromise priors used. Note that reporting this presumes anchors are identified -- a registry or equivalent.
- **Forgery cost.** The framework's forgery-cost condition makes this dimension load-bearing: the expected cost of forging all contributing evidence should exceed the value the verification underwrites. What a credible, non-gameable quantification looks like -- in what units, computed how -- is open research; this draft records the dimension's importance without pretending to a number.
- **Prior.** The prior used, ideally with the exclusion-only region reported alongside, so consumers see what stands without it.
- **Temporal range and freshness.** The range `T` the map covers, the stationarity assumption, and staleness at evaluation time.
- **Privacy and decentralization.** What the evidence reveals beyond the claim, and how concentrated the parties producing it are.

The policy layer's weighting scheme consumes `(posterior probability map, Q)` and produces the decision. How that weighting should work is out of scope here; this layer's obligation is to make Q complete enough that the weighting never has to guess.

## 9. Three nested variants

1. **Exclusion-only.** Intersect exclusion radii at `v = c`, floor policy zero, anchors assumed honest. Output is a feasible region -- no prior, no probabilities, nothing to argue with except physics and signatures. The conservative statement, suitable where every assumption must be defensible in front of an adversary.
2. **Bayesian, compliant attester.** Adds the one-sided noise model, the path-inflation interior, a prior, and optionally joint `δ_proc` estimation. Produces the full posterior probability map. Assumes honest anchors and a compliant attester.
3. **Robust Bayesian.** Adds the trust mixture with per-anchor compromise priors and correlated compromise across operators and jurisdictions. The trust caps bind. This is the variant the visualization exists to make people feel.

Each variant is strictly weaker in assumptions than the next, and Q records which one was run. Publishing variant 1 alongside variant 3 is the honest default.

## 10. Output contract

```
evaluate(receipts, anchor_metadata, prior, variant, temporal_range)
    -> (posterior probability map, Q)
```

Everything downstream -- geofences, thresholds, change detection, co-location -- consumes this pair and lives in the policy layer. Nothing in this document imports a border.
