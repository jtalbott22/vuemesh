// Record program's small corrections to the sound (progrec.js): a millisecond taken out of a block
// or put into it, so the sound keeps its place against the picture when the sound engine's clock
// and the page's drift apart. Each is crossfaded so the join can't be heard. No browser needed:
// test/splice.test.mjs checks the joins.

/** A block with `k` samples taken out of its middle, crossfaded over k (a millisecond: unheard). */
export function cut(a, k) {
  const at = Math.floor((a.length - 2 * k) / 2), out = new Float32Array(a.length - k);
  out.set(a.subarray(0, at), 0);
  // (fades from the sound as it goes on into the sound k later, which then carries on)
  for (let i = 0; i < k; i++) {
    const w = i / k;
    out[at + i] = a[at + i] * (1 - w) + a[at + k + i] * w;
  }
  out.set(a.subarray(at + 2 * k), at + k);
  return out;
}

/**
 * A block with `k` samples put into its middle (its own, again), crossfaded over k. The sound
 * plays on to the middle, then fades from the sound as it goes on into the sound k earlier, which
 * then carries on: so it's the same sound at both ends of the fade. (Until 0.66.10 the fade ran
 * the other way, a jump back of k samples at its start and again at its end: two clicks for every
 * millisecond put in. A busy show's recording put in 478 in 70 s, and its music crackled.)
 */
export function stretch(a, k) {
  const at = Math.floor((a.length - k) / 2), out = new Float32Array(a.length + k);
  out.set(a.subarray(0, at + k), 0);
  for (let i = 0; i < k; i++) {
    const w = i / k;
    out[at + k + i] = a[at + k + i] * (1 - w) + a[at + i] * w;
  }
  out.set(a.subarray(at + k), at + 2 * k);
  return out;
}
