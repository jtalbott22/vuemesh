// Lining clips up by their sound. Two recordings of the same moment on different phones
// share their sound; cross-correlating them finds how far apart they are, to a fraction of
// a millisecond. GCC-PHAT (each frequency weighted equally) keeps the peak sharp even when
// the microphones, distances and room echo differ, which is the usual case at an event.
// The beacon gets every clip within a few hundred milliseconds; this does the rest.

/** In-place radix-2 FFT (length a power of two). */
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/**
 * How far `b` is from `a`, in samples: b[i] matches a[i + lag]. Both are the same stretch of
 * time as the clocks have it. Looks within ±maxLag. `score` is the peak against the
 * average (about 4–6 for unrelated sound); `clarity` is the peak against the next best one
 * (about 1–1.3 for unrelated sound). A real match is well above both.
 */
export function offsetBetween(a, b, maxLag) {
  const n0 = Math.min(a.length, b.length);
  let n = 1;
  while (n < 2 * n0) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  const prep = (src, dst) => {
    let m = 0;
    for (let i = 0; i < n0; i++) m += src[i];
    m /= n0;
    for (let i = 0; i < n0; i++) dst[i] = (src[i] - m) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n0 - 1)));
  };
  prep(a, ar);
  prep(b, br);
  fft(ar, ai);
  fft(br, bi);
  for (let k = 0; k < n; k++) {
    const re = ar[k] * br[k] + ai[k] * bi[k];
    const im = ai[k] * br[k] - ar[k] * bi[k];
    const mag = Math.hypot(re, im) + 1e-12;
    ar[k] = re / mag;
    ai[k] = im / mag;
  }
  fft(ar, ai, true);
  const L = Math.min(maxLag, n0 - 1);
  let best = -Infinity, at = 0, sum = 0;
  for (let k = -L; k <= L; k++) {
    const v = ar[(k + n) % n];
    if (v > best) { best = v; at = k; }
    sum += Math.abs(v);
  }
  const mean = sum / (2 * L + 1);
  // the next best peak, away from this one: a real match stands well clear of it
  let second = 0;
  for (let k = -L; k <= L; k++) if (Math.abs(k - at) > 40) second = Math.max(second, ar[(k + n) % n]);
  const y0 = ar[(at - 1 + n) % n], y2 = ar[(at + 1 + n) % n];
  const den = y0 - 2 * best + y2;
  const frac = den ? (0.5 * (y0 - y2)) / den : 0; // a parabola through the peak: a fraction of a sample
  return { lag: at + (Math.abs(frac) < 1 ? frac : 0), score: best / (mean || 1e-12), clarity: best / (second || 1e-12) };
}

/** Enough sound in a stretch to go on (not silence or a hiss floor). */
export function hasSound(x) {
  let s = 0;
  for (let i = 0; i < x.length; i += 4) s += x[i] * x[i];
  return Math.sqrt(s / (x.length / 4)) > 0.002;
}
