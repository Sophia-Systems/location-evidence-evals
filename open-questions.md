# Open questions

Running list for the evidence-evaluation layer. Section references point at README.md.

## 1. Anonymous mutual pinging as collusion detection

If anchors also measure each other, and pings are unlinkable so an anchor cannot behave differently when it suspects it is being audited, then a fabricating anchor's signed measurements must stay consistent with the whole mesh of honest cross-measurements of the network. Collusion stops being a private act between two parties and becomes a lie maintained against everyone. How much detection power does this actually buy, what does "unlinkable" require at the protocol level, and what does a colluder's optimal consistent-lying strategy look like? (Section 6.)

## 2. Directional collusion

Whether an anchor would fabricate evidence for or against a claim depends on its interests relative to that claim -- and the direction of "helpful lying" depends on what the prover wants to appear true (inside a region, outside one, stationary). The general principle is "discount evidence in the direction its signer would plausibly want to fake," but making that concrete requires fixing the claim structure. Until then the model carries a single scalar compromise prior per anchor. (Section 6.)

## 3. Safety of joint turnaround estimation

Solving for the shared turnaround across anchors (GPS clock-bias style) tightens every bound under honest noise, but a strategic prover can respond fast to a favored anchor and slowly to the rest, inflating the common-mode estimate and manufacturing proximity. Is there an estimator that captures some of the tightening while bounding the manufactured-proximity attack -- for example, using only the fastest anchor as reference, or bounding the subtraction by a provable minimum? (Section 4.)

## 4. Prior selection and sensitivity

Reported posterior probabilities depend on the prior over locations. What priors are defensible (uniform over viable datacenter sites, power-availability-weighted, adversary relocation models), and should the layer report prior sensitivity explicitly alongside the exclusion-only region? (Section 3.)

## 5. Modeling correlated compromise

Common-cause structure across anchors (operator, jurisdiction, key-management vendor, legal exposure) determines how much trust a portfolio of anchors actually carries. What is the right formalism (common-cause factors, copulas, explicit compromise scenarios), and where do the correlation estimates come from? (Section 6.)

## 6. Path-inflation and effective-speed models

The soft interior and all precision expectations rest on empirical route statistics: fiber speed, circuity relative to great-circle, regional variation, submarine versus terrestrial paths. What datasets ground these, and how are they kept honest per region? (Section 2.)

## 7. Defining forgery cost

Q's forgery-cost entry wants to be "the cheapest set of compromises that could have produced this same evidence bundle." Cheapest in what currency (dollars, number of parties, jurisdictions crossed), and computed how -- exact minimal sufficient subset, or a bound? (Section 7.)

## 8. Formalizing Q and the policy weighting interface

The qualifier schema in README.md section 7 is a draft. What does the policy layer's weighting scheme actually need from Q, and in what machine-readable form, so the two layers can be developed against a stable interface?
