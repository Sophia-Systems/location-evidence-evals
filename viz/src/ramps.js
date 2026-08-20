// ramps.js -- inline color ramps for the probability map. No d3, no network.
//
// viridis and magma are evaluated from the widely used degree-6 polynomial
// fits by Matt Zucker (public domain, https://www.shadertoy.com/view/WlfXRN),
// accurate to ~1/255 per channel against matplotlib's tables. cividis is a
// piecewise-linear interpolation of commonly cited control stops of the
// matplotlib table (close approximation, adequate for display).
//
// Each ramp is a 256-entry LUT of [r, g, b] bytes, exported as a flat
// Uint8Array of length 768 via RAMPS[name].

function polyRamp(c) {
  // c: 7 coefficient triples [r,g,b]; evaluate sum c[i] * t^i, t in [0,1].
  const lut = new Uint8Array(768);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    for (let ch = 0; ch < 3; ch++) {
      let v = 0;
      let tp = 1;
      for (let i = 0; i < 7; i++) {
        v += c[i][ch] * tp;
        tp *= t;
      }
      lut[k * 3 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  return lut;
}

function stopRamp(stops) {
  // stops: [[t, '#rrggbb'], ...] sorted by t; linear interpolation.
  const parsed = stops.map(([t, hex]) => [
    t,
    [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)],
  ]);
  const lut = new Uint8Array(768);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    let i = 0;
    while (i < parsed.length - 2 && parsed[i + 1][0] < t) i++;
    const [t0, a] = parsed[i];
    const [t1, b] = parsed[i + 1];
    const f = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;
    for (let ch = 0; ch < 3; ch++) {
      lut[k * 3 + ch] = Math.round(a[ch] + (b[ch] - a[ch]) * f);
    }
  }
  return lut;
}

const VIRIDIS_COEFFS = [
  [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
  [0.1050930431085774, 1.404613529898575, 1.384590162594685],
  [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
  [-4.634230498983486, -5.799100973351585, -19.33244095627987],
  [6.228269936347081, 14.17993336680509, 56.69055260068105],
  [4.776384997670288, -13.74514537774601, -65.35303263337234],
  [-5.435455855934631, 4.645852612178535, 26.3124352495832],
];

const MAGMA_COEFFS = [
  [-0.002136485053939582, -0.000749655052795221, -0.005386127855323933],
  [0.2516605407371642, 0.6775232436837668, 2.494026599312351],
  [8.353717279216625, -3.577719514958484, 0.3144679030132573],
  [-27.66873308576866, 14.26473078096533, -13.64921318813922],
  [52.17613981234068, -27.94360607168351, 12.94416944238394],
  [-50.76852536473588, 29.04658282127291, 4.23415299384598],
  [18.65570506591883, -11.48977351997711, -5.601961508734096],
];

const CIVIDIS_STOPS = [
  [0.0, "#00224e"],
  [0.2, "#35456c"],
  [0.4, "#666970"],
  [0.6, "#948e77"],
  [0.8, "#c8b866"],
  [1.0, "#fee838"],
];

export const RAMPS = {
  viridis: polyRamp(VIRIDIS_COEFFS),
  magma: polyRamp(MAGMA_COEFFS),
  cividis: stopRamp(CIVIDIS_STOPS),
};

export const RAMP_NAMES = ["viridis", "magma", "cividis"];

// CSS gradient string for legend swatches.
export function rampGradientCSS(name, steps = 12) {
  const lut = RAMPS[name];
  const parts = [];
  for (let i = 0; i < steps; i++) {
    const k = Math.round((i / (steps - 1)) * 255) * 3;
    parts.push(`rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]}) ${((i / (steps - 1)) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
}
