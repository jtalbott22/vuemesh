// Record program's millisecond corrections to the sound (public/js/splice.js): taken out or put
// in, the join is smooth (no click), and the length changes by exactly the samples asked.
// No browser needed.
import assert from 'node:assert/strict';
import { cut, stretch } from '../public/js/splice.js';

const ok = (m) => console.log('ok  ' + m);
const RATE = 48000, K = 48, N = 2048; // (1 ms at 48 kHz, in one of the tap's blocks)

const tone = (hz, n = N) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / RATE));
const biggestStep = (x) => {
  let m = 0;
  for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
  return m;
};

for (const hz of [110, 440, 1000, 3000]) {
  const a = tone(hz);
  const own = biggestStep(a);
  const s = stretch(a, K), c = cut(a, K);
  assert.equal(s.length, N + K);
  assert.equal(c.length, N - K);
  // a crossfade between two points of the same tone can dip, but never jumps: within twice the
  // tone's own largest step from one sample to the next (the old stretch jumped 1.44 at 440 Hz)
  assert.ok(biggestStep(s) <= 2 * own + 1e-6, `stretch at ${hz} Hz: step ${biggestStep(s).toFixed(3)}, tone's own ${own.toFixed(3)}`);
  assert.ok(biggestStep(c) <= 2 * own + 1e-6, `cut at ${hz} Hz: step ${biggestStep(c).toFixed(3)}, tone's own ${own.toFixed(3)}`);
}
ok('a millisecond put in or taken out joins smoothly (110 Hz to 3 kHz), and the length changes by exactly that');

{
  // what's either side of the splice is the block's own sound, untouched
  const a = tone(440);
  const s = stretch(a, K), at = Math.floor((N - K) / 2);
  assert.deepEqual(s.subarray(0, at + K), a.subarray(0, at + K));
  assert.deepEqual(s.subarray(at + 2 * K), a.subarray(at + K));
  const c = cut(a, K), ct = Math.floor((N - 2 * K) / 2);
  assert.deepEqual(c.subarray(0, ct), a.subarray(0, ct));
  assert.deepEqual(c.subarray(ct + K), a.subarray(ct + 2 * K));
}
ok('the sound either side of the splice is the block as it was');

{
  // silence stays silent, and a steady level stays that level (no bump at the join)
  const s = stretch(new Float32Array(N).fill(0.5), K);
  assert.ok(s.every((v) => Math.abs(v - 0.5) < 1e-6));
  assert.ok(stretch(new Float32Array(N), K).every((v) => v === 0));
}
ok('a steady level is unchanged by a splice');
