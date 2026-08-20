# location-evidence-evals

Evidence evaluation for latency-based location verification -- how signed round-trip-time measurements update belief about where a machine is.
<!--I think we need to really motivate why we're doing this: Coordination on steering advanced AI rests on frontier organizations declaring the nature and location of their compute resources; detecting cheating or defection from this declared whatever is a way of identifying potential dangerous capability development and intervening before dangerous models can be devleoped. (there's a more elegant and inclusiave way of saying this -- it may be more than just training dangerous models -- but this is the setup imo-->
An attester (an AI accelerator host) collects signed round-trip-time (RTT) observations from anchor nodes at known locations. This repository specifies and implements the function that turns that stream of evidence into a posterior probability surface over spacetime, together with qualifiers recording assumptions and limitations. It is the middle layer of the [location verification framework](https://www.johnx.co/research/location-verification-framework), sitting between the measurement layer (developed in [location-proofs/experiments](https://github.com/location-proofs/experiments), which establishes what one signed ping is worth in nanoseconds) and geospatial policy evaluation (which decides what to do about it).

Planned artifacts: this outline, a short paper, a reference implementation of the evaluation function for this specific latency measurement protocol, and an interactive visualization (build spec in [PROMPT.md](PROMPT.md)). Open questions are tracked in [open-questions.md](open-questions.md).

## Where this sits: two layers, one interface

**Evidence evaluation** (this repo). Input: signed pings, anchor metadata, a prior. Output: `(posterior, Q)` -- a probability distribution over locations + time interval, plus qualifiers. This layer deliberately ignores policy questions involving geofences, borders or time series analysis.

**Geospatial policy evaluation** (not this repo). Various policies can be considered, including geofencing (containment in policy zone), change detection (deviation in time series), likelihood of co-location of GPUs (crossover distance quantification). The geofencing example: Input: `(posterior, Q)`, a geofence, and a weighting scheme. Output: a compliance probability or a boolean. With a gridded posterior, the core operation is nearly trivial: `P(inside geofence)` is the sum of probability mass in the cells that fall inside the polygon. Turning that number plus Q into a yes/no requires a threshold, and the threshold encodes tolerance for false accusations versus missed evasions -- a policy judgment, which is why it does not belong in the evidence layer. This design aligns with [Cankaya's](https://www.lesswrong.com/posts/fgvmKqRGvBteKeDoc/a-system-overview-for-near-term-low-trust-ai-compute) principle of separating evidence capture + commitment from evaluation. 

Keeping these separate keeps the evidence math neutral and auditable. The evidence layer answers "where does the weight of evidence place this machine, and under what assumptions." The policy layer answers "is that acceptable."

## 1. The measurement primitive

In the [RTT protocol under investication](https://github.com/location-proofs/plugin-rtt-anchor), one measurement is a four-packet exchange (specified in the experiments repo). The anchor times the interval from its own transmission of a challenge to its own receipt of the signed challenge nonce. That interval travels back inside the anchor's signature. <!--<<< wtf does this sentence mean? --> 

Given that our trust model is designed to resist a dishonest attester, latency measurements must be taken by anchor nodes. That said, the anchor's honesty is trust assumption that can be quantified and incorporated into evidence evaluation. Optimal network design -- the spatial distribution of anchor nodes, and the institutional diversity of their operators -- is an open question well worth investigation. Again aligned with Cankaya's principles, there should be no need for mutually-trusted nodes; instead we envision a heterogeneous network operated by different parties to the agreement and neutral third party verifiers; collecting evidence from this diverse anchor set strengthens claims.

The interval contains: the network path anchor-to-prover, the prover's turnaround (scheduler wake-up, parsing, signing), and the path back. The defining property of all the non-propagation content is that it is **one-sided**: queueing, scheduling, and signing only ever add time. Nothing can make a packet arrive earlier than propagation allows. So:

```
measured RTT = true propagation time + junk,    junk >= 0 always
```

(The specifics of how each step in the lifecycle of a ping is a topic of experimental investigation [here](https://github.com/location-proofs/experiments/tree/main/plugin-rtt-anchor).)

Two consequences of this design:

1. **The right estimator is the minimum over a burst.** Each probe is a draw for "minimum latency"; the minimum converges on true propagation from above and can never undershoot it.
2. **Honest noise fails safe.** Junk only inflates RTT, and inflated RTT only loosens the distance bound. Noise costs precision; it cannot wrongly exclude the true location. Only dishonesty -- a lying anchor, or an unsound floor subtraction (section 4) -- can deceive.
<!--yeah this bit i'm like whatever, not sure it adds much-->

## 2. What one ping does to belief
<!--3. THIS is the section we are really focused on here ...-->

A single signed RTT from an anchor at a known location gives two very different pieces of information:

**A hard outer bound.** The attester cannot be farther from the anchor than light allows: `distance <= speed x (RTT - floor) / 2`<!--we need caveats here: barring key cloning or extremely unlikely random noise. Also this whole thing needs to align with our vocabulary. attester is what we're using instead of prover-->. Against an honest anchor, no prover strategy can fake being closer than it is. Geometrically this is a step: likelihood approximately zero <!--not zero. approx is ok but i really need to emphasize that it is never 0, ever, anywhere in the universe through all time--> outside a disk centered on the anchor.

**Almost nothing on the inner side.** A machine next door to the anchor can trivially show a 200 ms RTT by delaying its response. Large RTT is therefore weak evidence of distance. Against a non-strategic attester, empirical path-inflation statistics ("honest routes are rarely more than about twice great-circle distance") justify softly down-weighting "very close but very slow." Against a strategic prover the inner side is worth nothing, and the evaluation function must say which assumption it is making.
<!--this is not clear to me but i get what you're driving at. I think we need to get concrete about different trust assumptions, namely what you're saying "strategic" vs "non-strategic" attesters. it's unclear to the reader unfamiliar with what strategic might mean. -->
Conversion factors, kept distinct because they serve different masters:

- **Security bound:** speed of light in vacuum. An adversary cannot beat c, so the safe outer bound converts at roughly 150 m of distance per microsecond of RTT. Using fiber speed here would let a shortcut-capable adversary (microwave links, straighter routes) sit outside the disk.
- **Honest expectation:** light in fiber travels at about 2c/3, and real routes are longer than great circles. Precision expectations and the soft interior use these empirical numbers; the hard edge never does.

Two facts worth internalizing early, because the visualization is built to teach them:

- A ping does not point at a location; it **erases everything outside a circle**. The posterior concentrates by exclusion.
- A ping's value is the prior mass it excludes. An anchor whose disk covers half a continent adds almost nothing even if the measurement is perfect. Anchor geometry relative to the claim is as important as anchor quality: three anchors surrounding the claimed site from different bearings beat ten anchors in one city.
<!--These are covered in more depth by our experiment and writeup, I don't think we should overdo it here. I really want to keep our focus on the evidence evaluation step and how new evidence update our beliefs-->
## 3. The engine

Grid the region into cells. Maintain `p(x)`: the probability the machine is in cell x. For each piece of evidence `e`, compute the likelihood `L(e | x)` -- how plausible this measurement would be if the machine were in cell x -- then multiply and renormalize:

```
posterior(x)  ∝  prior(x) x product over evidence of L(e | x)
```
<!--this is good. there needs to be a time interval dimension, without it i don't think it makes sense. so we're saying likelihood that this device was present in this cell in this time interval. Probably should also say something about how measuring ∀ -- this will define sampling frequency, and we will need to interpolate / infer this based on realistic possible speed of transporting a device -- so let's just keep the focus on ∃-->
That is the entire engine. Every subtlety in this document lives inside the likelihood function; the evidence evaluation function *is* the likelihood model plus the bookkeeping in Q.

The claimed location is a **hypothesis, not the prior**. The prior should represent where the machine could plausibly be before this evidence -- for example, uniform over viable datacenter locations. Because reported probabilities depend on the prior, the prior itself is recorded in Q, and the exclusion-only variant (section 9) exists precisely to give a prior-free statement alongside the Bayesian one.
<!--I really like this alignment with Bayesian statistics, it will be very familiar to readers, I think we should really make sure our explanation is grounded here-->
## 4. The turnaround lever

The turnaround is the time the prover's machine spends inside the measured window doing non-propagation work: kernel delivery, scheduler wake-up, parsing, signing. It sits inside every anchor's measurement of the same prover, and how the evaluation function accounts for it is a security parameter, not a calibration detail.
<!--I don't think this is what we are going to call it (turnaround). As I said, I think we should be pretty minimal about this here, it's a deep subject of research and we should basically represent it in our distribution as a variable, and say that quantification of it should be more rigorously defined and empirically grounded .... right? -->
The rule: **only subtract adversarial minima -- what the fastest physically possible prover could achieve -- never calibrated typicals.** The bound `distance <= speed x (RTT - assumed_floor) / 2` means every microsecond of assumed floor is a microsecond a strategic attester can steal as apparent proximity: sandbag during calibration so the assumed floor is generous, then respond at proof time with an optimized responder (kernel bypass, fast signing hardware), and appear roughly 150 m closer per microsecond of the gap. Subtracting zero is always sound; subtracting the provable minimum cost of the forced signature is sound if the minimum is truly hardware-independent; subtracting a measured typical turnaround is an attack surface.
<!--OK this is alright, I think again we are trying to get a mvp evaluation function with these terms incorporated and further research acknowledged. A thorough analysis of the latency budget and where an attacker could manipulate it, and what they could do with that (make the chip seem like it's closer to the anchor than it really is, basically? i.e. it actually is in a cell that is more improbable?) ... -->
The same logic constrains a tempting refinement. Because all anchors measuring one attester share the same turnaround, a verifier with several anchors could in principle estimate the shared component jointly -- the same way a GPS receiver solves for its own clock bias -- and subtract it, tightening every disk at once. Against honest noise this works. Against a strategic prover it is unsafe: by responding fast to one favored anchor and slowly to the rest, the prover inflates the estimated common mode and manufactures proximity to the favored anchor. Joint turnaround estimation is therefore admissible only in the honest-noise variant, and its use is recorded in Q.
<!--this is good, though again "turnaround" i don't think is the right term. but cool-->
Measured turnaround distributions (the current experimental phase) inform *precision expectations for honest hosts* -- how loose the disks will be in practice, especially under GPU load. They never tighten the security bound.

## 5. Combining pings

Naive independent multiplication overstates confidence. Three corrections:
<!--This doesn't legibly explain what we need to say, it's too pithy and short. Let's be clear please-->
- **Same anchor, repeated pings.** Probes from one anchor share the path and mostly refine the minimum. Treat the per-anchor minimum RTT over a burst (at the convergence knee measured in the experiments repo) as one observation, not N.
<!--- This is Redundancy discounting in the framework https://www.johnx.co/research/location-verification-framework#design-properties-->
- **Different anchors.** Independent paths justify multiplying likelihoods, and the posterior becomes the intersection of disks -- a lens. This is where geometry pays.
<!--- Too ai speak, what are we really saying? -->
- **Shared turnaround.** All anchors share the prover's turnaround as a common-mode error. In the honest-noise variant it can be jointly estimated (section 4); in the adversarial variant it is left inside the one-sided junk, where it only loosens bounds.
<!--This is not how i understand common-mode error / failure but if it is fine but this is generally meh-->
Evidence is also stamped in time: a ping proves where the signing key was at a moment. This phase treats claims as stationary over the evidence window; sequences, movement, and cherry-picking of favorable windows are out of scope here and must be addressed in the verification regime's broader design.

A standing caveat that belongs in every artifact: RTT locates the **keyholder**, not the GPU. Without a hardware binding layer, all of this is evidence about where the signing key answers from.

## 6. Anchor trust

Give each anchor a compromise probability `pi`: the prior probability that it would sign fabricated measurements (collusion, key theft, coercion). The likelihood becomes a mixture:

```
L(e | x) = (1 - pi) x L_honest(e | x)  +  pi x L_fabricated(e | x)
```

A fabricating anchor can sign anything regardless of where the machine is, so its component carries no location information -- approximately flat in x.
<!--"fabricating anchor"? Can we just say "dishonest anchor"? we need to define this-->
**The trust cap.** The mixture yields the sharpest statement in this document: evidence from an anchor with compromise probability pi can shift the odds toward the claim by a factor of at most about `1 / pi`, no matter how clean the measurement. The explanation "the anchor fabricated it" always retains its prior weight, and no measurement quality squeezes it out. In log terms, an anchor you trust 90 percent contributes at most about 3.3 bits toward the claim; 99 percent trust caps at about 6.6 bits. Measurement precision buys nothing past the trust ceiling -- anchor governance is the load-bearing wall, not a detail.
<!--OK this needs to be more clearly stated. What are we really saying? Something about the trust model. Most latency-based location verification systems assume honest anchor nodes. Some (Sheng) has explored BFT networks. We want to incorporate anchor trustworthiness into the evidence evaluation design ... we should also say that trust-minimized network designs are a topic of interest and open question ...-->
The cap applies **per anchor, not per ping**: every ping from one anchor shares the same "is it fabricating" event, so the anchor's whole evidence bundle is jointly capped. More pings from a trusted anchor buy precision; they never buy trust.
<!--ok. this sounds claude generated. "buy precision, buy trust". Say it more precisely and technically without sounding like an ass.-->
**Correlated compromise.** Compromise events are not independent across anchors. Anchors sharing an operator, a jurisdiction, or a legal exposure fail together -- one court order, one key-management breach, one shared motive. Five same-operator anchors provide five anchors of geometry but roughly one anchor of trust. The joint compromise model needs common-cause terms, which makes operator and jurisdictional diversity a separate axis from geographic diversity; a well-supported claim needs both. This is the heterogeneity argument at the center of the framework, made quantitative.
<!--I've done a bit of work quantifying this that might be relevant -- geobeat.xyz-->
**Directionality (open).** Whether an anchor would fabricate evidence *for* or *against* a claim depends on its interests relative to that claim, and evidence against the signer's interest is the most credible kind. Specifying this properly requires fixing the claim structure and is parked in [open-questions.md](open-questions.md). For simulation, three anchor-operator identities -- ally, adversary, neutral -- each carrying a compromise prior (and eventually a deception direction) are a sufficient simplification.

## 7. Qualifiers Q

The posterior is a number-surface that is only valid conditional on a bundle of assumptions <!--we need to make this concrete so it is understandable. -->. Q records what the surface compresses away <!--what the hell does this mean? Can you please just say it plainly. Q records what is not quantified in the probability distribution? -->, and it travels with the posterior rather than being folded into it -- folding robustness into the probability would repeat, inside the evidence layer, exactly the muddying the two-layer split exists to prevent.

Draft schema, one entry per line of what a consumer needs in order to weigh the number:

- **Threat model.** Which variant produced the surface <!--imo "surface" is a very vague and ambiguous term for the probability distribution. what is the statistical term for this? look at spatial stats literature, give me a couple options-->(section 9), and therefore which adversaries it resists: none, strategic attester, compromised anchors, both.
- **Floor policy.** What was subtracted from RTTs and its provenance: zero, provable signature minimum, calibrated typical (with the attack surface that implies), joint common-mode estimate (honest-noise only).
- **Anchor diversity.** Count of distinct operators and jurisdictions, geometry of the anchor set relative to the posterior mass, and the trust priors used.
<!--- good. note that this entails identifying anchors and perhaps having some registry ...-->
- **Forgery cost.** The cheapest set of compromises that could have produced this same evidence bundle -- typically the cheapest sufficient subset of anchors. This is the security margin of the claim in one number.
<!---  mm i like this but quantifying this in ... dollar terms? ... feels like a rabbit hole -->
- **Prior.** What prior was used, and ideally the exclusion-only region alongside, so consumers can see what stands without it.
- **Freshness.** The time window the evidence spans and its staleness at evaluation time.
- **Privacy and decentralization.** What the evidence reveals beyond the claim, and how concentrated the parties producing it are.
<!--overall this is solid but i don't think we should just yeet the q dimensions on a whim. I want to think this through carefully ... so let's be very circumspect about this set of dimensions directly and honestly here, let's say it is a very important piece of open research (which i have documented. https://www.johnx.co/research/location-verification-research-agenda#technical-risks-and-open-unknowns-->
The policy layer's weighting scheme consumes `(posterior, Q)` and produces the decision. How that weighting should work is a policy-layer question and out of scope here; the evidence layer's obligation is to make Q complete enough that the weighting never has to guess.

## 8. Output contract

```
evaluate(pings, anchor_metadata, prior, variant)  ->  (posterior surface, Q)
```

Downstream, and outside this repo: `P(inside geofence) = sum of posterior mass in the polygon`, then threshold by policy. Nothing in this repo imports a border.

## 9. Three nested variants

1. **Exclusion-only.** Intersect hard disks from anchors assumed honest, floor policy zero. Output is a feasible region -- no prior, no probabilities, nothing to argue with except the physics and the anchor signatures. The conservative, treaty-grade statement.
2. **Bayesian, honest noise.** Adds the one-sided noise model, the soft interior from path-inflation statistics, a prior, and optionally joint turnaround estimation. Produces the full surface. Assumes honest anchors and a non-strategic prover.
3. **Robust Bayesian.** Adds the trust mixture with per-anchor compromise priors and correlated compromise across operators and jurisdictions. Confidence caps bind. This is the variant the visualization exists to make people feel.
<!--This is cool-->
Each variant is strictly weaker in assumptions and weaker in claimed precision than the next; Q records which one was run. Publishing variant 1 alongside variant 3 is the honest default.

## Repository layout (planned)

- `README.md` -- this outline
- `PROMPT.md` -- build specification for the interactive visualization
- `open-questions.md` -- running list
- `paper/` -- the written note, developed from this outline
- `src/` -- reference implementation of `evaluate(...)`
- `viz/` -- the visualization, built to PROMPT.md
