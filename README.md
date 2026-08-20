# location-evidence-evals

Evidence evaluation for latency-based location verification -- how signed round-trip-time measurements update belief about where a machine is.

Coordination on steering advanced AI rests on frontier organizations making credible declarations about their compute: what accelerators they operate, and where. Verifying the location component of such declarations is a way to detect defection from declared arrangements early enough to respond. Hardware-enabled assurance mechanisms are the natural near-term home for this capability; export-control enforcement is one concrete application among several.

This repository develops the **evidence evaluation** layer of the [location verification framework](https://www.johnx.co/research/location-verification-framework): the function that turns a stream of signed anchor receipts into a posterior probability map over locations for a stated temporal range, together with qualifiers `Q` recording assumptions and limitations. It sits between the measurement layer ([location-proofs/experiments](https://github.com/location-proofs/experiments), which establishes what one signed receipt is worth in nanoseconds) and geospatial policy evaluation (geofencing, change detection, co-location -- which consumes this layer's output and is out of scope here).

The output contract:

```
evaluate(receipts, anchor_metadata, prior, variant, temporal_range)
    -> (posterior probability map, Q)
```

The substance lives in the paper draft: [`paper/evidence-evaluation.md`](paper/evidence-evaluation.md).

## Layout

- [`paper/evidence-evaluation.md`](paper/evidence-evaluation.md) -- the working draft: measurement primitive, exclusion radii, the floor subtraction rule, the Bayesian engine, anchor trust and the trust cap, qualifiers Q, and the three nested variants of the evaluation function
- [`PROMPT.md`](PROMPT.md) -- build specification for the interactive visualization
- [`open-questions.md`](open-questions.md) -- running list of open questions
- `src/` (planned) -- reference implementation of `evaluate(...)`
- `viz/` (planned) -- the visualization, built to PROMPT.md
