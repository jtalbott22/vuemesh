// Unit tests for the edit model and the AI director (pure modules, no browser needed).
import assert from 'node:assert/strict';
import * as S from '../public/js/sequence.js';
import { Director, planCuts, baseScore, shotScore, hintFor, whatsWrong } from '../public/js/director.js';

const ok = (m) => console.log('ok  ' + m);
const F = S.FRAME;
const mk = () => {
  const seq = S.newSequence();
  seq.origin = 0;
  const p = S.program(seq);
  p.items = [
    { id: 'a', type: 'clip', src: 'A', start: 0, dur: 4000, in: 1000 },
    { id: 'b', type: 'clip', src: 'B', start: 4000, dur: 4000, in: 4000 },
    { id: 'c', type: 'clip', src: 'A', start: 8000, dur: 4000, in: 9000 },
  ];
  S.track(seq, 't-ov1').items = [{ id: 'o', type: 'title', start: 9000, dur: 2000 }];
  return seq;
};
const get = (seq, id) => S.findItem(seq, id).item;
const SRC = { A: 20000, B: 20000 };
const durOf = (it) => SRC[it.src] ?? Infinity;

// ripple trim end: shorten a by 1 s → everything after on every track moves 1 s earlier
let seq = mk();
S.rippleTrim(seq, 'a', 'end', 3000, SRC.A);
assert.equal(get(seq, 'a').dur, 3000);
assert.equal(get(seq, 'b').start, 3000);
assert.equal(get(seq, 'c').start, 7000);
assert.equal(get(seq, 'o').start, 8000, 'overlay rippled too, staying in sync');
ok('ripple trim (end) closes the gap on every track');

// ripple trim start: trim 500 ms off b's head; b stays put, content and later items move
seq = mk();
S.rippleTrim(seq, 'b', 'start', 4500, SRC.B);
assert.deepEqual([get(seq, 'b').start, get(seq, 'b').in, get(seq, 'b').dur], [4000, 4500, 3500]);
assert.equal(get(seq, 'c').start, 7500);
ok('ripple trim (start) keeps the item in place and pulls the rest back');

// roll: move the a|b cut 600 ms later, total length unchanged
seq = mk();
S.rollEdit(seq, 'a', 'b', 4600, durOf);
assert.deepEqual([get(seq, 'a').dur, get(seq, 'b').start, get(seq, 'b').in, get(seq, 'b').dur], [4600, 4600, 4600, 3400]);
assert.equal(S.end(seq), 12000);
ok('roll edit moves the cut point, nothing else moves');

// roll is limited by media: a can't run past the end of its source
seq = mk();
S.rollEdit(seq, 'a', 'b', 30000, durOf);
assert.ok(get(seq, 'b').dur >= F - 1e-6 && get(seq, 'a').in + get(seq, 'a').dur <= SRC.A + 1e-6);
ok('roll edit respects the media and minimum lengths');

// slip: same place on the timeline, different part of the media
seq = mk();
S.slip(seq, 'b', 2000, SRC.B);
assert.deepEqual([get(seq, 'b').start, get(seq, 'b').in], [4000, 6000]);
S.slip(seq, 'b', -99999, SRC.B);
assert.equal(get(seq, 'b').in, 0);
ok('slip changes the source in-point only, clamped to the media');

// slide: move b 1 s later between its neighbours
seq = mk();
S.slide(seq, 'b', 1000, durOf);
assert.deepEqual([get(seq, 'a').dur, get(seq, 'b').start, get(seq, 'c').start, get(seq, 'c').in, get(seq, 'c').dur], [5000, 5000, 9000, 10000, 3000]);
ok('slide moves the item and trims its neighbours, no gaps');

// ripple delete
seq = mk();
S.rippleDelete(seq, 'b');
assert.equal(get(seq, 'c').start, 4000);
assert.equal(get(seq, 'o').start, 5000);
ok('ripple delete removes and pulls everything after it back');

// add edit cuts every unlocked track under the playhead
seq = mk();
S.track(seq, 't-ov1').locked = true;
assert.equal(S.addEdit(seq, 10000), 1, 'locked overlay not cut');
assert.equal(S.program(seq).items.length, 4);
S.rippleTrim(seq, 'a', 'end', 3000, SRC.A);
assert.equal(get(seq, 'o').start, 9000, 'locked track is never rippled');
ok('add edit and ripple skip locked tracks');

// edit points and markers
seq = mk();
S.addMarker(seq, 2500, 'speech');
assert.deepEqual(S.editPoints(seq), [0, 2500, 4000, 8000, 9000, 11000, 12000]);
ok('edit points include cuts and markers');

// orientation slicing: clip A turned portrait 2.5 s into its media and back at 10 s
seq = mk();
const n = S.splitAtOrientation(seq, (id) => (id === 'A' ? [{ t: 0, upright: 'landscape' }, { t: 2.5, upright: 'portrait' }, { t: 10, upright: 'landscape' }] : []));
assert.equal(n, 2);
const prog = S.program(seq).items.map((it) => [it.start, it.in]);
assert.deepEqual(prog, [[0, 1000], [1500, 2500], [4000, 4000], [8000, 9000], [9000, 10000]]);
ok('clips are sliced exactly where the phone turned');

// one item turned twice: landscape → portrait → landscape inside a single shot
const s3 = S.newSequence();
s3.origin = 0;
S.program(s3).items = [{ id: 'z', type: 'clip', src: 'A', start: 0, dur: 7000, in: 0 }];
assert.equal(S.splitAtOrientation(s3, () => [{ t: 0, upright: 'landscape' }, { t: 2.2, upright: 'portrait' }, { t: 5.4, upright: 'landscape' }]), 2);
assert.deepEqual(S.program(s3).items.map((i) => [i.start, i.dur, i.in]), [[0, 2200, 0], [2200, 3200, 2200], [5400, 1600, 5400]]);
ok('a shot turned twice is sliced at both turns');

// overwrite: replaces 2 s in the middle of b, nothing else moves
seq = mk();
S.overwrite(seq, 't-prog', 5000, { type: 'clip', src: 'C', in: 300, dur: 2000 });
assert.deepEqual(S.program(seq).items.map((i) => [i.src, i.start, i.dur, i.in]), [['A', 0, 4000, 1000], ['B', 4000, 1000, 4000], ['C', 5000, 2000, 300], ['B', 7000, 1000, 7000], ['A', 8000, 4000, 9000]]);
assert.equal(S.end(seq), 12000);
ok('overwrite (.) replaces a stretch of the target track; length unchanged');

// insert: opens a 2 s gap at 5 s on every unlocked track
seq = mk();
S.insertAt(seq, 't-prog', 5000, { type: 'clip', src: 'C', in: 0, dur: 2000 });
assert.deepEqual(S.program(seq).items.map((i) => [i.src, i.start, i.dur]), [['A', 0, 4000], ['B', 4000, 1000], ['C', 5000, 2000], ['B', 7000, 3000], ['A', 10000, 4000]]);
assert.equal(get(seq, 'o').start, 11000, 'overlay pushed along too');
ok('insert (,) ripples everything after the playhead and drops the clip in');

// deleting a recording removes every use of it
seq = mk();
assert.equal(S.removeSource(seq, 'A'), 2);
assert.deepEqual(S.program(seq).items.map((i) => i.src), ['B']);
ok('removing a source takes every use of it off the timeline');

// a non-destructively trimmed clip builds from its usable range
const s4 = S.newSequence();
S.rebuildFromCuts(s4, [{ t: 1000, clip: 'T' }], [{ id: 'T', t0: 1000, dur: 3000, inBase: 2000, kind: 'video' }]);
assert.deepEqual(S.program(s4).items.map((i) => [i.start, i.dur, i.in]), [[0, 3000, 2000]]);
ok('trimmed sources are used from their usable range only');

// director: scores
assert.ok(baseScore({ exposure: 0 }) === 0, 'black frame scores zero');
assert.ok(baseScore({}) === 1, 'no complaints = perfect');
assert.ok(shotScore(1, 'portrait', 'landscape') < shotScore(1, 'landscape', 'landscape'));
assert.equal(hintFor({ steady: 0.1 }, 'landscape', 'landscape'), 'Hold steady');
assert.equal(hintFor({}, 'portrait', 'landscape'), 'Turn your phone sideways');
assert.equal(whatsWrong({ level: 0.1 }), 'pointed at the floor or ceiling');
ok('shot scoring, coaching hints, and plain-language problems');

// director: holds at least 3 s, cuts away from a bad shot quickly, breaks when nothing is usable
const d = new Director();
let r = d.step(0, [{ id: 'x', score: 0.9 }, { id: 'y', score: 0.8 }], 'landscape');
assert.equal(r.cut, 'x');
r = d.step(1000, [{ id: 'x', score: 0.5 }, { id: 'y', score: 0.95 }], 'landscape');
assert.equal(r.cut, undefined, 'no cut before the minimum hold');
r = d.step(1200, [{ id: 'x', score: 0.1, parts: { steady: 0.05 } }, { id: 'y', score: 0.9 }], 'landscape');
assert.equal(r.cut, undefined, 'a bad shot has to stay bad a moment');
r = d.step(2000, [{ id: 'x', score: 0.1, parts: { steady: 0.05 } }, { id: 'y', score: 0.9 }], 'landscape');
assert.equal(r.cut, 'y');
assert.match(r.reason, /shaking/);
r = d.step(3000, [{ id: 'x', score: 0.05 }, { id: 'y', score: 0.1 }], 'landscape');
assert.equal(r.breakOn, true);
ok('director: minimum hold, quick escape from a bad shot with a reason, break when nothing works');

// a slightly better shot must stay better for 1.5 s before the director cuts to it
{
  const d2 = new Director();
  d2.step(0, [{ id: 'x', score: 0.7 }, { id: 'y', score: 0.6 }], 'landscape');
  assert.equal(d2.step(3500, [{ id: 'x', score: 0.7 }, { id: 'y', score: 0.95 }], 'landscape').cut, undefined, 'a momentary blip is not enough');
  assert.equal(d2.step(4000, [{ id: 'x', score: 0.7 }, { id: 'y', score: 0.7 }], 'landscape').cut, undefined);
  assert.equal(d2.step(4300, [{ id: 'x', score: 0.7 }, { id: 'y', score: 0.95 }], 'landscape').cut, undefined, 'the clock restarts');
  const r2 = d2.step(5900, [{ id: 'x', score: 0.7 }, { id: 'y', score: 0.95 }], 'landscape');
  assert.equal(r2.cut, 'y');
  ok('director: a better shot has to stay better for 1.5 s (no twitchy cuts on noisy scores)');
}

// planning a whole cut from recorded quality
const cuts = planCuts([
  { id: 'A', t0: 0, dur: 20000, scoreAt: (t) => ({ score: t > 6000 && t < 9000 ? 0.1 : 0.9, upright: 'landscape', parts: { steady: t > 6000 && t < 9000 ? 0.1 : 1 } }) },
  { id: 'B', t0: 0, dur: 20000, scoreAt: () => ({ score: 0.7, upright: 'landscape' }) },
  { id: 'C', t0: 0, dur: 20000, scoreAt: () => ({ score: 0.95, upright: 'portrait' }) },
], 0, 20000, 'landscape');
assert.equal(cuts[0].clip, 'A');
const shakyCovered = cuts.find((c) => c.t > 6000 && c.t < 7500);
assert.ok(shakyCovered && shakyCovered.clip !== 'A', JSON.stringify(cuts));
ok(`post auto-cut avoids the shaky stretch: ${cuts.map((c) => `${c.clip}@${(c.t / 1000).toFixed(1)}s`).join(' ')}`);
// a live cut pressed just before that phone's recording started
const s2 = S.newSequence();
S.rebuildFromCuts(s2, [{ t: 0, clip: 'A' }, { t: 3000, clip: 'B' }], [
  { id: 'A', t0: 0, dur: 10000, kind: 'video' },
  { id: 'B', t0: 4200, dur: 6000, kind: 'video' },
]);
assert.deepEqual(S.program(s2).items.map((i) => [i.src, i.start, i.dur, i.in]), [['A', 0, 4200, 0], ['B', 4200, 6000, 0]]);
ok('a cut made just before a phone started recording lands when its clip begins, with no gap');
console.log('\nAll sequence and director tests passed.');

// ---------------------------------------------------------------- media library
import { MediaLibrary } from '../public/js/media.js';
{
  const mem = new Map();
  const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const lib = new MediaLibrary('EVT', store);
  const clips = [
    { id: 'A', t0: 0, dur: 30000, kind: 'video', name: 'Rosa' },
    { id: 'B', t0: 12000, dur: 30000, kind: 'video', name: 'Dev' },
    { id: 'M', t0: 0, dur: 60000, kind: 'audio', name: 'Table' },
  ];
  lib.setMeta('A', { tags: ['Speech'], star: true });
  const sc = lib.addSubclip({ src: 'A', in: 9000, out: 4000, name: 'Uncle falls over', tags: ['Blooper', 'Blooper'] });
  assert.deepEqual([sc.in, sc.out, sc.tags], [4000, 9000, ['Blooper']], 'in/out ordered, tags deduped');
  const m = lib.addMoment(20000, 'Cake smash');
  lib.updateMoment(m.id, { tags: ['Funny'] });
  const made = lib.clipsFromMoment(m.id, clips);
  assert.deepEqual(made.map((x) => [x.src, x.in, x.out]), [['A', 10000, 25000], ['B', 0, 13000]], 'one subclip per rolling angle, clipped to the recording');
  assert.ok(made.every((x) => x.tags.includes('Moment') && x.tags.includes('Funny')));
  lib.setMeta('B', { trim: { in: 5000, out: 20000 } });
  assert.deepEqual(lib.range(clips[1]), { in: 5000, out: 20000 });
  const again = new MediaLibrary('EVT', store);
  assert.equal(again.subclips.length, 3, 'saved and reloaded');
  assert.deepEqual(again.allTags().slice(0, 2).map((t) => t.tag), ['Funny', 'Moment']);
  assert.equal(again.forgetSource('A'), 2, 'deleting a recording drops its subclips');
  assert.equal(again.meta('A').star, false);
  ok('media library: tags, stars, subclips, moments → clips from every angle, trims, persistence, forgetting a source');
}
console.log('All media library tests passed.');

// ---------------------------------------------------------------- lens choice
import { preferredCamera, lensOf } from '../public/js/camctl.js';
{
  const iphone = ['Front Camera', 'Front Ultra Wide Camera', 'Back Camera', 'Back Ultra Wide Camera', 'Back Telephoto Camera', 'Back Dual Wide Camera', 'Back Triple Camera', 'Back Dual Camera']
    .map((label, i) => ({ deviceId: 'd' + i, label }));
  assert.equal(preferredCamera(iphone, 'back').label, 'Back Camera');
  assert.equal(preferredCamera(iphone, 'front').label, 'Front Camera');
  const iphone2 = [{ deviceId: 'a', label: 'Front TrueDepth Camera' }, { deviceId: 'b', label: 'Back Triple Camera' }, { deviceId: 'c', label: 'Back Telephoto Camera' }];
  assert.equal(preferredCamera(iphone2, 'back').label, 'Back Triple Camera', 'only a combined camera: use it');
  assert.equal(preferredCamera(iphone2, 'front').label, 'Front TrueDepth Camera');
  const android = ['camera2 1, facing front', 'camera2 0, facing back', 'camera2 2, facing back'].map((label, i) => ({ deviceId: 'x' + i, label }));
  assert.equal(preferredCamera(android, 'back').label, 'camera2 0, facing back');
  assert.equal(preferredCamera(android, 'front').label, 'camera2 1, facing front');
  assert.equal(lensOf('Back Ultra Wide Camera'), 'ultra');
  ok('first-time lens choice: the plain 1× camera on each side (iPhone and Android names)');
}
console.log('All lens tests passed.');

// ---------------------------------------------------------------- transforms
import { transformBox, tfOf, TF_PRESETS } from '../public/js/compose.js';
{
  const W = 1280, H = 720;
  // a 16:9 picture filling a 16:9 frame at scale 1 covers it exactly
  let b = transformBox(tfOf({}), W, H, 1920, 1080, 'fill', 0);
  assert.deepEqual([Math.round(b.w), Math.round(b.h), b.cx, b.cy], [1280, 720, 640, 360]);
  // picture-in-picture preset: a third of the size, top right
  b = transformBox(tfOf({ tf: TF_PRESETS['top-right'] }), W, H, 1920, 1080, 'fill', 0);
  assert.deepEqual([Math.round(b.w), Math.round(b.h), Math.round(b.cx), Math.round(b.cy)], [384, 216, 1037, 137]);
  // cropping 25% off each side trims the picture in place (the layer below shows around it);
  // scale is what zooms in
  b = transformBox(tfOf({ tf: { crop: { l: 0.25, r: 0.25, t: 0.25, b: 0.25 } } }), W, H, 1920, 1080, 'fill', 0);
  assert.deepEqual([Math.round(b.w), Math.round(b.h), b.cw, b.ch, b.cx, b.cy], [640, 360, 960, 540, 640, 360]);
  // cropping only the left: the visible part keeps its place, so its centre moves right
  b = transformBox(tfOf({ tf: { crop: { l: 0.25 } } }), W, H, 1920, 1080, 'fill', 0);
  assert.deepEqual([Math.round(b.w), Math.round(b.cx)], [960, 800]);
  // a portrait phone picture made upright by a 90° turn, fitted whole into landscape
  b = transformBox(tfOf({}), W, H, 1920, 1080, 'fit', 90);
  assert.deepEqual([Math.round(b.w), Math.round(b.h)], [405, 720]);
  ok('transforms: fill, picture-in-picture, crop trims in place, and rotation fitting');
}

// ---------------------------------------------------------------- computers as cameras
import { shotScore as ss2, hintFor as hf2, whatsWrong as ww2 } from '../public/js/director.js';
{
  assert.equal(hf2({}, 'landscape', 'portrait', 100, { fixed: true }), null, 'no "hold your phone upright" for a webcam');
  assert.equal(hf2({}, 'landscape', 'portrait', 100), 'Hold your phone upright', 'phones still get it');
  assert.equal(hf2({ exposure: 0.1 }, 'landscape', 'portrait', 10, { fixed: true }), 'Too dark: find some light', 'picture problems still coach');
  assert.equal(hf2({ steady: 0.1 }, 'landscape', 'portrait', 100, { fixed: true }), 'Hold steady', 'a 2-in-1 with a real gyro still gets motion advice');
  assert.ok(ss2(1, 'landscape', 'portrait', true) > ss2(1, 'landscape', 'portrait', false), 'a webcam that can\'t turn is marked down less');
  assert.equal(ww2({}, 'landscape', 'portrait', true), 'a landscape camera in a portrait film');
  ok('computers as cameras: no orientation coaching, gentler scoring, plain wording');
}
console.log('All computer-camera tests passed.');

// ---------------------------------------------------------------- rolled clips
import { rebuildFromCuts as rb2, newSequence as ns2, program as pg2 } from '../public/js/sequence.js';
{
  // camera A was turned mid-take: its phone rolled from a1 into a2 (overlapping 300 ms)
  const clips = [
    { id: 'a1', cid: 'A', kind: 'video', t0: 0, dur: 10300 },
    { id: 'a2', cid: 'A', kind: 'video', t0: 10000, dur: 10000 },
    { id: 'b1', cid: 'B', kind: 'video', t0: 0, dur: 30000 },
  ];
  const s2 = rb2(ns2(), [{ t: 0, clip: 'a1' }, { t: 15000, clip: 'b1' }], clips);
  const items = pg2(s2).items.map((i) => [i.src, i.start, i.dur]);
  assert.deepEqual(items, [['a1', 0, 10000], ['a2', 10000, 5000], ['b1', 15000, 15000]], JSON.stringify(items));
  ok('a cut stays on its camera across a roll: a1 hands over to a2 where a2 starts (no gap, no sliver)');
}
console.log('All rolled-clip tests passed.');

// ---------------------------------------------------------------- ranges and gaps
import { sliceRange, extractRange, collapseGaps, videoGaps, newSequence as ns3, program as pg3 } from '../public/js/sequence.js';
{
  const mk = () => {
    const s = ns3();
    pg3(s).items = [
      { id: 'a', type: 'clip', src: 'A', start: 10000, dur: 5000, in: 0 },
      { id: 'b', type: 'clip', src: 'B', start: 60000, dur: 5000, in: 2000 },
    ];
    s.tracks.push({ id: 'mic', kind: 'audio', name: 'Mic', items: [{ id: 'm', type: 'clip', src: 'M', start: 0, dur: 70000, in: 0 }] });
    s.markers = [{ id: 'k', t: 62000 }];
    return s;
  };
  // gaps: 0–10 s and 15–60 s have no picture
  const s1 = mk();
  assert.deepEqual(videoGaps(s1).map((g) => [g.start, g.end]), [[0, 10000], [15000, 60000]]);
  const removed = collapseGaps(s1);
  assert.equal(removed.length, 2);
  assert.deepEqual(pg3(s1).items.map((i) => [i.src, i.start, i.dur, i.in]), [['A', 0, 5000, 0], ['B', 5000, 5000, 2000]]);
  // the mic kept exactly the sound under each picture, so it's still in sync
  const mic = s1.tracks.find((t) => t.id === 'mic').items.map((i) => [i.start, i.dur, i.in]);
  // (sound after the last picture isn't a gap between footage, so it stays)
  assert.deepEqual(mic, [[0, 5000, 10000], [5000, 10000, 60000]]);
  assert.equal(s1.markers[0].t, 7000);
  ok('collapse gaps: empty stretches gone on every track; the mic keeps the sound under each picture (in sync)');

  // export In to Out: a copy starting at zero, clips cut with the right source offset
  const s2 = mk();
  const part = sliceRange(s2, 12000, 63000);
  assert.deepEqual(pg3(part).items.map((i) => [i.src, i.start, i.dur, i.in]), [['A', 0, 3000, 2000], ['B', 48000, 3000, 2000]]);
  assert.equal(part.markers[0].t, 50000);
  assert.deepEqual(pg3(s2).items.map((i) => i.start), [10000, 60000], 'the timeline itself is untouched');
  ok('export In to Out: just that range, starting at zero, with clips cut at the right source frames');

  const s3 = mk();
  extractRange(s3, 12000, 13000);
  assert.deepEqual(pg3(s3).items.map((i) => [i.start, i.dur, i.in]), [[10000, 2000, 0], [12000, 2000, 3000], [59000, 5000, 2000]]);
  ok('extract a range: a clip spanning it is split around it, later items move left');
}
console.log('All range tests passed.');

// ---------------------------------------------------------------- speed
import { setSpeed, srcAt, rate, splitAt as split4, sliceRange as slice4, rippleTrim as rtrim4, newSequence as ns4, program as pg4 } from '../public/js/sequence.js';
{
  const mk = () => { const s = ns4(); pg4(s).items = [{ id: 'a', type: 'clip', src: 'A', start: 0, dur: 4000, in: 1000 }, { id: 'b', type: 'clip', src: 'B', start: 10000, dur: 2000, in: 0 }]; return s; };
  const s1 = mk();
  setSpeed(s1, 'a', 0.5);
  const a = pg4(s1).items[0];
  assert.deepEqual([a.dur, a.speed, srcAt(a, 0), srcAt(a, 8000)], [8000, 0.5, 1000, 5000], 'half speed: twice as long, same content (1–5 s of the source)');
  const capped = setSpeed(s1, 'a', 0.25);
  assert.deepEqual([pg4(s1).items[0].dur, capped.capped], [10000, true], 'quarter speed would run into the next clip: stops there');
  setSpeed(s1, 'a', 1);
  assert.equal(rate(pg4(s1).items[0]), 1);
  ok('speed: slower stretches the same content; never runs over the next clip; back to normal');

  const s2 = mk();
  setSpeed(s2, 'a', 2); // 2 s on the timeline, 1–5 s of the source
  split4(s2, 'a', 1000);
  const [l, r] = pg4(s2).items.filter((x) => x.src === 'A');
  assert.deepEqual([l.dur, r.start, r.dur, r.in], [1000, 1000, 1000, 3000], 'split at double speed: the right half starts 2 s further into the source');
  const s3 = mk();
  setSpeed(s3, 'a', 0.5);
  const part = slice4(s3, 2000, 6000);
  assert.deepEqual(pg4(part).items.map((x) => [x.start, x.dur, x.in]), [[0, 4000, 2000]], 'a range through a slowed clip starts at the right source frame');
  ok('speed: split and export-range cut the source at the right frame');
  const { slip: slip4 } = await import('../public/js/sequence.js');
  const s5 = mk();
  setSpeed(s5, 'a', 2);           // 2 s on the timeline showing 4 s of a 6 s source
  slip4(s5, 'a', 500, 6000);     // slip by half a second of timeline
  assert.equal(pg4(s5).items[0].in, 2000, 'slip moves the source by delta × speed');
  slip4(s5, 'a', 5000, 6000);
  assert.equal(pg4(s5).items[0].in, 2000, 'and stops where the source runs out (6 s − 4 s shown)');
  ok('speed: slip moves through the source at the clip\'s speed and stops at its end');
}
// dissolves: live dissolves come through the automatic edit; sound crossfades; a split's right half cuts
{
  const T = 2_000_000;
  const cl = [{ id: 'a', kind: 'video', cid: 'A', t0: T, dur: 20000 }, { id: 'b', kind: 'video', cid: 'B', t0: T, dur: 20000 }];
  const sq = S.newSequence();
  S.rebuildFromCuts(sq, [{ t: T, clip: 'a' }, { t: T + 8000, clip: 'b', dissolve: 1000 }], cl);
  const [p1, p2] = S.program(sq).items;
  assert.deepEqual([p1.transIn, p2.transIn], [undefined, { dur: 1000 }], 'the live dissolve is on the shot it went into');
  assert.equal(S.heldBefore(S.program(sq), p2), p1);
  const cam = S.audioItems(sq, sq.tracks.find((t) => t.follow));
  assert.deepEqual([cam[0].dur, cam[0].xfOut, cam[1].xfIn], [p1.dur + 1000, 1000, 1000], 'camera sound: the outgoing shot carries on under the incoming one, both crossfading');
  const right = S.splitAt(sq, p2.id, p2.start + 3000);
  assert.ok(p2.transIn && !right.transIn, 'a split keeps the dissolve on the left half only');
  assert.equal(S.dissolveOf({ type: 'clip', dur: 300, transIn: { dur: 1000 } }), 300, 'never longer than the shot');
  ok('dissolves: a live dissolve lands on the shot it went into; camera sound crossfades; a split’s right half cuts; capped at the shot');
}

// breaks: a break in the live cut is its own slate item, then the camera again
{
  const T = 3_000_000;
  const cl = [{ id: 'a', kind: 'video', cid: 'A', t0: T, dur: 30000 }];
  const sq = S.newSequence();
  S.rebuildFromCuts(sq, [{ t: T, clip: 'a' }, { t: T + 10000, slate: { message: 'Back soon', look: 'bars' } }, { t: T + 16000, clip: 'a' }], cl);
  const items = S.program(sq).items.map((i) => [i.type, i.start, i.dur, i.text || i.src]);
  assert.deepEqual(items, [['clip', 0, 10000, 'a'], ['slate', 10000, 6000, 'Back soon'], ['clip', 16000, 14000, 'a']]);
  assert.equal(S.program(sq).items[1].look, 'bars');
  const s2 = S.newSequence();
  S.rebuildFromCuts(s2, [{ t: T, clip: 'a' }, { t: T + 10000, slate: { message: 'Back soon', look: 'bars' } }, { t: T + 12000, clip: 'a' }, { t: T + 12010, slate: { message: 'Back soon', look: 'bars' } }, { t: T + 16000, clip: 'a' }], cl);
  assert.deepEqual(S.program(s2).items.map((i) => [i.type, i.start, i.dur]), [['clip', 0, 10000], ['slate', 10000, 6000], ['clip', 16000, 14000]], 'a break that flickered is one item');
  ok('breaks: a break in the live cut is its own slate item (what it said, its look), then the camera picks up again; one that flickered is one item');
}

// fades to black: the shot before fades out, the time at black is empty, the next shot fades in
{
  const T = 4_000_000;
  const cl = [{ id: 'a', kind: 'video', cid: 'A', t0: T, dur: 30000 }];
  const sq = S.newSequence();
  S.rebuildFromCuts(sq, [{ t: T, clip: 'a' }, { t: T + 10000, black: true, fade: 1500 }, { t: T + 14000, clip: 'a', fadeIn: 1000 }], cl);
  const items = S.program(sq).items.map((i) => [i.start, i.dur, i.fadeOut || 0, i.fadeIn || 0]);
  assert.deepEqual(items, [[0, 10000, 1500, 0], [14000, 16000, 0, 1000]]);
  ok('fades to black: the shot before fades out (1.5 s), black is empty, the next shot fades in (1 s)');
}

// live footage after the timeline was edited by hand goes on the end
{
  const T = 1_000_000;
  const clipsA = [{ id: 'a', kind: 'video', cid: 'X', t0: T, dur: 10000 }];
  const edl = [{ t: T, clip: 'a' }];
  const sq = S.newSequence();
  S.rebuildFromCuts(sq, edl, clipsA);
  assert.equal(sq.liveTail, T + 10000);
  sq.auto = false;
  S.trim(sq, S.program(sq).items[0].id, 'start', 2000); // (a hand edit: the first 2 s trimmed off)
  // a second take, 50 s later, then a microphone over part of it
  const clipsB = [...clipsA, { id: 'b', kind: 'video', cid: 'X', t0: T + 60000, dur: 8000 }, { id: 'm', kind: 'audio', cid: 'M', t0: T + 61000, dur: 5000 }];
  const r = S.appendLive(sq, [...edl, { t: T + 60000, clip: 'b' }], clipsB);
  const items = S.program(sq).items;
  assert.equal(items.length, 2, 'the hand-trimmed first take stays, the new one is added');
  assert.equal(items[0].start, 2000, 'hand edit untouched');
  assert.deepEqual([items[1].src, items[1].start, items[1].dur, items[1].in], ['b', 10000 + 50000, 8000, 0], 'after a gap as long as the real one');
  const mic = sq.tracks.find((t) => t.mic === 'M');
  assert.deepEqual([mic.items.length, mic.items[0].start], [1, 60000 + 1000], 'its microphone sound lines up with it');
  assert.equal(r.gap, 50000);
  assert.equal(S.appendLive(sq, [...edl, { t: T + 60000, clip: 'b' }], clipsB), null, 'nothing new: nothing added');
  S.collapseGaps(sq);
  assert.equal(S.end(sq), 8000 + 8000 + 2000 - 2000 + 0 + (S.end(sq) - 16000), 'collapse gaps');
  assert.equal(S.program(sq).items[1].start, S.program(sq).items[0].start + S.program(sq).items[0].dur, 'Collapse gaps closes it up');
  // a camera still recording across the end: only the new part goes on
  const clipsC = [...clipsB, { id: 'c', kind: 'video', cid: 'X', t0: T + 66000, dur: 6000 }];
  const before = S.end(sq);
  const r2 = S.appendLive(sq, [...edl, { t: T + 60000, clip: 'b' }], clipsC);
  assert.ok(r2 && Math.abs(r2.from - (T + 68000)) < 40 && Math.abs(S.end(sq) - (before + 4000)) < 40, JSON.stringify([r2, before, S.end(sq)]));
  ok('live after hand edits: a second take goes on the end after the real gap (hand edits kept, its mic lined up), nothing twice, only the part after what\'s there, and Collapse gaps closes it');
}
console.log('All speed tests passed.');
