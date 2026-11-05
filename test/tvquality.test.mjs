// What a TV gets (public/js/tvquality.js): a TV falling behind gets a lower bitrate, at most every
// 10 s and not below the floor; steady for 30 s, it goes back up, as far as where it started.
import assert from 'node:assert/strict';
import { tvLink, adapt, behind, MIN_KBPS } from '../public/js/tvquality.js';
const ok = (m) => console.log('ok  ' + m);
const T = 1_000_000;
{
  assert.equal(behind({ fps: 29, secs: 5 }, 30), false);
  assert.equal(behind({ fps: 20, secs: 5 }, 30), true, 'fewer than 80% of the frames');
  assert.equal(behind({ fps: 30, freezes: 1, secs: 5 }, 30), true, 'a freeze');
  assert.equal(behind({ fps: 30, dropped: 6, secs: 5 }, 30), true, 'more than 3% dropped');
  assert.equal(behind({ fps: 30, dropped: 2, secs: 5 }, 30), false);
  ok('behind: fewer than 80% of the frames, a freeze, or more than 3% dropped');
}
{
  const l = tvLink(6000, T);
  assert.deepEqual(adapt(l, { fps: 18, secs: 5 }, 30, T + 5000), { cap: 4200, changed: 'down' });
  assert.deepEqual(adapt(l, { fps: 18, secs: 5 }, 30, T + 10000), { cap: 4200, changed: null }, 'not again within 10 s');
  assert.deepEqual(adapt(l, { fps: 18, secs: 5 }, 30, T + 15000), { cap: 2940, changed: 'down' });
  for (let t = T + 25000; t < T + 120000; t += 10000) adapt(l, { fps: 10, secs: 5 }, 30, t);
  assert.equal(l.cap, MIN_KBPS, 'not below the floor');
  ok('a TV falling behind: 6000 → 4200 → 2940 kbps, no more than every 10 s, down to 600 and no lower');
}
{
  const l = tvLink(6000, T);
  adapt(l, { fps: 10, secs: 5 }, 30, T);
  assert.equal(l.cap, 4200);
  assert.equal(adapt(l, { fps: 30, secs: 5 }, 30, T + 20000).changed, null, 'steady 20 s: not yet');
  assert.deepEqual(adapt(l, { fps: 30, secs: 5 }, 30, T + 31000), { cap: 5250, changed: 'up' });
  assert.deepEqual(adapt(l, { fps: 30, secs: 5 }, 30, T + 62000), { cap: 6000, changed: 'up' }, 'back as far as where it started');
  assert.equal(adapt(l, { fps: 30, secs: 5 }, 30, T + 95000).changed, null);
  ok('steady for 30 s: back up a quarter at a time, as far as where it started');
}
console.log('\nAll TV quality tests passed.');
