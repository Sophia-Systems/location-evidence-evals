# Open questions

Running list for the evidence-evaluation layer. Section references point at [`paper/evidence-evaluation.md`](paper/evidence-evaluation.md).

## 1. Anonymous mutual pinging as collusion detection

If anchors also measure each other, and probes are unlinkable so an anchor cannot behave differently when it suspects it is being audited, then a dishonest anchor's signed receipts must stay consistent with the whole mesh of honest cross-measurements of the network. Collusion stops being a private act between two parties and becomes a lie maintained against everyone. How much detection power does this actually buy, what does "unlinkable" require at the protocol level, and what does a colluder's optimal consistent-lying strategy look like? (Section 7.)

## 2. Directional collusion

Whether a dishonest anchor would fabricate evidence for or against a declaration depends on its interests relative to that declaration -- and the direction of helpful lying depends on what the attester's operator wants to appear true (inside a region, outside one, stationary). The general principle is "discount evidence in the direction its signer would plausibly want to fake," but making that concrete requires fixing the claim structure. Until then the model carries a single scalar compromise prior per anchor. (Section 7.)

## 3. Safety of joint attester-processing-delay estimation

Solving for the shared `δ_proc` across anchors (GPS clock-bias style) tightens every exclusion radius under the compliant-attester assumption, but an evasive attester can answer one favored anchor quickly and the rest slowly, inflating the estimate and manufacturing proximity. Is there an estimator that captures some of the tightening while bounding the manufactured-proximity attack -- for example, using only the fastest anchor as reference, or capping the subtraction at a provable minimum? (Section 5.)

## 4. Prior selection and sensitivity

Reported posterior probabilities depend on the prior over locations. What priors are defensible (uniform over viable datacenter sites, power-availability-weighted, adversary relocation models), and should the layer report prior sensitivity explicitly alongside the exclusion-only region? (Section 6.)

## 5. Modeling correlated compromise

Common-cause structure across anchors (operator, jurisdiction, key-management vendor, legal exposure) determines how much trust a portfolio of anchors actually carries. What is the right formalism (common-cause factors, copulas, explicit compromise scenarios), and where do the correlation estimates come from? (Section 7.)

## 6. Quantifying anchor-set diversity

Q's anchor-set entry wants a credible measure of physical, jurisdictional, and infrastructural diversity for a set of anchors. [GEOBEAT](https://geobeat.xyz) is prior work quantifying exactly these axes for node networks (physical distribution, jurisdictional diversity, infrastructure heterogeneity), but a measure fit to bear weight in verification needs rigorous construction and validation. (Sections 7, 8.)

## 7. Trust-minimized anchor-network design

Most latency-based designs assume honest anchors; [BFT-PoLoc](https://arxiv.org/abs/2403.13230) (Sheng et al. 2024) instead tolerates a Byzantine fraction. The route taken here -- quantify per-anchor trust and carry it through the evaluation -- raises its own design question: what anchor-network topology, operator mix, and incentive structure minimizes the trust any single party must extend? Optimal spatial distribution of anchors belongs here too. (Sections 2, 7.)

## 8. Path-inflation and effective-speed models

The compliant-attester interior and all precision expectations rest on empirical route statistics: fiber speed, path stretch relative to great-circle, regional variation, submarine versus terrestrial paths. What datasets ground these (building on Spring et al. 2003; Bozkurt et al. 2017), and how are they kept honest per region? (Section 4.)

## 9. Quantifying forgery cost

The framework's forgery-cost condition makes the dimension load-bearing: forging all contributing evidence should cost more than the value the verification underwrites. What a credible, non-gameable quantification looks like -- in what units, computed how, resistant to what gaming -- is open. (Section 8.)

## 10. Formalizing Q and the policy weighting interface

The qualifier schema in the paper's section 8 is a working draft, and identifying the right, preferably irreducible dimension set is an open problem of the broader research program ([technical risks and open unknowns](https://www.johnx.co/research/location-verification-research-agenda#technical-risks-and-open-unknowns)). What does the policy layer's weighting scheme actually need from Q, and in what machine-readable form, so the two layers can be developed against a stable interface?
