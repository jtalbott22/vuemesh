// Keeping every camera on one timeline (public/js/framesync.js): the running least delivery,
// the program's picture delay (up at once, down only between shows), picking each camera's
// frame for a moment (a stalled camera held), and the sync check's clap in sound and picture.
import assert from 'node:assert/strict';
import { WindowMin, PictureDelay, momentOf, pick, soundOnset, pictureOnset, latencyFromCheck, DEFAULT_LATENCY } from '../public/js/framesync.js';

const ok = (m) => console.log('ok  ' + m);

{
  const w = new WindowMin(1000);
  [[0, 50], [100, 40], [200, 45], [300, 60]].forEach(([t, v]) => w.push(t, v));
  assert.equal(w.value, 40);
  w.push(1150, 70); // (40 is now more than a second old)
  assert.equal(w.value, 45);
  w.push(1300, 30);
  assert.equal(w.value, 30);
  ok('a camera\'s quickest delivery over the last few seconds, a hiccup ignored');
}
{
  const d = new PictureDelay({ fps: 30 });
  assert.deepEqual(d.update([70, 110, 90]), { P: 143, raised: false }, 'the slowest camera plus a frame');
  assert.deepEqual(d.update([70, 100, 90]), { P: 143, raised: false }, "it doesn't come down during a show");
  assert.deepEqual(d.update([70, 150, 90]), { P: 183, raised: true }, 'it goes up at once when a camera needs it');
  assert.equal(d.reset([70, 100]).P, 133, 'and settles between shows');
  ok('the picture delay: the slowest camera and a frame; up at once, down only between shows');
}
{
  // three cameras with different delays: the same moment on air from each
  const frames = (lat) => Array.from({ length: 10 }, (_, i) => ({ moment: momentOf(1000 + i * 33.3, lat + 5, lat), i }));
  const a = frames(60), b = frames(130);
  assert.equal(pick(a, 1200).frame.i, pick(b, 1200).frame.i, 'both cameras show the frame of the same moment');
  const r = pick(a, 1800); // (its last frame shows 1305: nothing for half a second)
  assert.ok(r.stalled && r.frame.i === 9, 'a camera that stopped sending: its last frame, held, and stalled');
  const early = pick(a, 900);
  assert.ok(!early.stalled && early.frame.i === 0 && early.late > 0, 'nothing that old yet: its oldest');
  assert.deepEqual(pick([], 0), { frame: null, stalled: true, late: 0 });
  ok('each camera shows its frame of the same moment; one that stops sending is held at its last frame');
}
{
  // a clap at 1.2345 s in a second of room hiss
  const rate = 48000, n = rate;
  const x = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < n; i++) x[i] = rnd() * 0.01;
  const at = Math.round(0.2345 * rate);
  for (let i = at; i < at + 2400; i++) x[i] += Math.exp(-(i - at) / 300) * (rnd() * 1.6);
  const o = soundOnset(x, rate, 1000);
  assert.ok(Math.abs(o.t - 1234.5) < 6 && o.strength > 20, o);
  ok(`sync check, sound: the clap's attack found within ${Math.abs(o.t - 1234.5).toFixed(1)} ms (strength ${Math.round(o.strength)})`);
}
{
  const series = Array.from({ length: 60 }, (_, i) => ({ moment: 1000 + i * 33.33, change: i === 31 ? 40 : 1 + (i % 3) }));
  const p = pictureOnset(series, 2030);
  assert.ok(Math.abs(p.t - (1000 + 30.5 * 33.33)) < 0.1 && p.strength > 10, p);
  assert.equal(pictureOnset(series, 9000, 500), null, 'nothing near: null');
  ok('sync check, picture: the frame with the most change (hands meeting), between it and the one before');
}
{
  // a camera thought to be 70 ms late saw the clap 45 ms after it was heard: it's really 115 ms late
  assert.equal(latencyFromCheck(DEFAULT_LATENCY, 2045, 2000), 115);
  ok('sync check: a camera that saw the clap 45 ms after it was heard is 45 ms later than thought');
}
console.log('\nAll frame sync tests passed.');
