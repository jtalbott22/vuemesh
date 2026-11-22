// Unit tests for song mode: the tempo grid, clicks, count-in and tap tempo (pure, no browser).
import assert from 'node:assert/strict';
import * as G from '../public/js/song.js';

const ok = (m) => console.log('ok  ' + m);
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m}: ${a} ≠ ${b}`);

// defaults and clamping
let s = G.songOf({});
assert.deepEqual([s.on, s.bpm, s.beats, s.at, s.click, s.countIn], [false, 120, 4, 0, false, 1]);
s = G.songOf({ song: { bpm: 9999, beats: 0, at: -50, countIn: 9 } });
assert.deepEqual([s.bpm, s.beats, s.at, s.countIn], [G.BPM_MAX, 4, 0, 4]);
assert.equal(G.songOf({ song: { bpm: 'x' } }).bpm, 120, 'nonsense falls back to 120');
ok('song settings fill in defaults and stay in range');

// 120 bpm in 4/4: a beat is 500 ms, a bar 2 s
s = G.songOf({ song: { bpm: 120, beats: 4, at: 1000 } });
assert.equal(G.beatMs(s), 500);
assert.equal(G.barMs(s), 2000);
assert.deepEqual(G.posAt(s, 1000), { bar: 1, beat: 1, frac: 0 });
assert.equal(G.fmtPos(s, 1000 + 500 * 6 + 250), '2.3');
assert.equal(G.posAt(s, 1000 + 500 * 6 + 250).frac, 0.5);
assert.equal(G.posAt(s, 500).bar, 0, 'before bar 1 is bar 0');
assert.equal(G.posAt(s, 500).beat, 4, '…on its last beat');
assert.equal(G.timeOf(s, 3, 2), 1000 + 2000 * 2 + 500);
ok('bars and beats count from 1, from where bar 1 starts');

// a fractional position mustn't round onto the next beat
assert.equal(G.posAt(G.songOf({ song: { bpm: 90 } }), G.timeOf(G.songOf({ song: { bpm: 90 } }), 5, 3)).beat, 3);
ok('beats land exactly at non-round tempos');

// snapping to the nearest beat, never before 0
assert.equal(G.nearestBeat(s, 1240), 1000);
assert.equal(G.nearestBeat(s, 1260), 1500);
assert.equal(G.nearestBeat(G.songOf({ song: { at: 300 } }), 10), 300, 'the grid before 0 moves forward onto it');
ok('nearest beat');

// the ruler: every beat when there's room, else bars, thinning by powers of two
s = G.songOf({ song: { bpm: 120, beats: 4 } });
let g = G.gridLines(s, 0, 4000, 60); // 30 px a beat
assert.equal(g.length, 9);
assert.deepEqual(g.filter((l) => l.down).map((l) => l.bar), [1, 2, 3]);
assert.deepEqual(g.slice(0, 4).map((l) => l.beat), [1, 2, 3, 4]);
g = G.gridLines(s, 0, 20000, 10); // 5 px a beat, 20 px a bar: too tight for every bar at minPx 14 (needs 35)
assert.ok(g.every((l) => l.down));
assert.deepEqual(g.slice(0, 3).map((l) => l.bar), [1, 3, 5], 'every second bar');
g = G.gridLines(G.songOf({ song: { at: 3000 } }), 0, 4000, 60);
assert.ok(g.every((l) => l.t >= 0) && g[0].t === 0, 'no lines before 0');
assert.deepEqual(g.find((l) => l.t === 3000), { t: 3000, bar: 1, beat: 1, down: true }, 'bar 1 is where it was set');
assert.deepEqual([g.find((l) => l.t === 1000).bar, g.find((l) => l.t === 1000).beat], [0, 1], 'lines before bar 1 count back from it');
ok('ruler grid follows the zoom');

// clicks, with the accent on each downbeat, and a count-in before the start
s = G.songOf({ song: { bpm: 120, beats: 3, countIn: 1 } });
const c = G.clicks(s, 0, 3000);
assert.deepEqual(c.map((x) => x.t), [0, 500, 1000, 1500, 2000, 2500]);
assert.deepEqual(c.map((x) => x.accent), [true, false, false, true, false, false]);
assert.equal(G.countInStart(s, 0), -1500, 'one bar of 3/4 before 0');
assert.equal(G.countInStart(s, 1600), 3000 - 1500, 'a start mid-bar counts in to the next downbeat');
const pre = G.clicks(s, G.countInStart(s, 0), 0);
assert.deepEqual(pre.map((x) => [x.t, x.accent]), [[-1500, true], [-1000, false], [-500, false]]);
assert.equal(G.countInStart(G.songOf({ song: { countIn: 0 } }), 1234), 1234, 'no count-in starts right away');
ok('clicks, accents and count-in');

// tap tempo: median of a steady run; a long pause starts again
assert.equal(G.tapTempo([0, 500]), null);
assert.equal(G.tapTempo([0, 500, 1000, 1500]), 120);
assert.equal(G.tapTempo([0, 500, 1000, 1700, 2200, 2700]), 120, 'one late tap is ignored');
assert.equal(G.tapTempo([0, 300, 600, 9000, 9750, 10500]), 80, 'only taps since the pause count');
near(G.clampBpm(87.04), 87, 'tempo keeps one decimal');
ok('tap tempo');
