// Faces and speakers (public/js/faces.js) and the auto director's cuts with them (director.js):
// faces followed from picture to picture, mouths that move like talking, Speaker 1 and 2 kept the
// same across cameras with no face recognition, an operator's framing, and cutting to whoever's
// talking. Also: the bundled MediaPipe sends nothing anywhere. No browser needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FRAME, FaceTracker, Follow, SPEAKERS, Search, Speakers, TILES, faceScore, fromRegion, iou, mergeHeads, talkScore, within } from '../public/js/faces.js';
import { Director } from '../public/js/director.js';

const ok = (m) => console.log('ok  ' + m);
const face = (x, y, size = 0.2, mouth = 0.1, extra = {}) => ({ box: { x: x - size / 2, y: y - size / 2, w: size, h: size }, eyes: { x, y: y - size * 0.1 }, mouth, eyesOpen: 1, yaw: 0, ...extra });

// ---- following faces ----
{
  assert.equal(iou({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 0.1, h: 0.1 }, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }), 0);
  const tr = new FaceTracker();
  tr.update(0, [face(0.3, 0.5), face(0.7, 0.5)]);
  assert.equal(tr.visible(0).length, 0, 'one sighting is not yet a face');
  tr.update(100, [face(0.31, 0.5), face(0.69, 0.51)]);
  const [a, b] = tr.visible(100).sort((p, q) => p.box.x - q.box.x);
  assert.deepEqual([a.id, b.id], [1, 2], 'the same two faces, not new ones');
  // they swap order in the list, one moves a little: still the same ids
  tr.update(200, [face(0.72, 0.5), face(0.32, 0.5)]);
  assert.equal(tr.visible(200).find((x) => x.box.x < 0.5).id, 1);
  // one leaves: gone after a moment, not at once
  tr.update(300, [face(0.32, 0.5)]);
  assert.equal(tr.tracks.length, 2);
  const lost = tr.update(2000, [face(0.32, 0.5)]);
  assert.deepEqual(lost.map((x) => x.id), [2]);
  ok('faces are followed from picture to picture (the same id as they move and swap places), and a face is gone only after 1.5 s unseen');
}

// ---- looking for small faces: the whole shot, then parts of it; then around who was found ----
{
  const se = new Search();
  const seen = [];
  for (let i = 0; i < 9; i++) seen.push(se.next(i * 100));
  assert.ok(seen.filter((r) => r.w === 1).length >= 3, 'the whole shot every third look');
  assert.ok(seen.some((r) => r.w < 1 && r.y < 0.3), 'and parts of it, the upper ones first');
  assert.ok(TILES.every((r) => r.x + r.w <= 1 && r.y + r.h <= 1));
  // a small face found in a part: from then on, a region around it (the whole shot now and then)
  const tile = TILES[4];
  const inTile = fromRegion([face(0.5, 0.4, 0.2)], tile);
  assert.ok(Math.abs(inTile[0].box.h - 0.2 * tile.h) < 1e-9 && Math.abs(inTile[0].eyes.x - (tile.x + 0.5 * tile.w)) < 1e-9);
  se.found(1000, inTile, tile);
  const looks = [1100, 1200, 1300, 1400, 1500].map((t) => se.next(t));
  const roi = looks.find((r) => r.w < 1);
  assert.ok(roi.w >= 0.3 && roi.w <= 0.5, `a region about four faces across: ${roi.w}`);
  assert.ok(roi.x <= inTile[0].box.x && roi.x + roi.w >= inTile[0].box.x + inTile[0].box.w, 'around the face');
  assert.ok(looks.some((r) => r.w === 1), 'and the whole shot now and then');
  // nobody for 3 s: back to searching, and where they were is looked at again
  const later = [4200, 4300, 4400, 4500, 4600, 4700].map((t) => se.next(t));
  assert.ok(later.some((r) => r === se.last));
  // a big face in the whole shot: the whole shot it stays
  const big = new Search();
  big.found(0, [face(0.5, 0.5, 0.3)], { x: 0, y: 0, w: 1, h: 1 });
  assert.ok([100, 200, 300, 400, 500, 600].every((t) => big.next(t).w === 1));
  // looking at one part, a face elsewhere isn't lost
  const tr = new FaceTracker();
  tr.update(0, [face(0.2, 0.3), face(0.8, 0.3)]);
  tr.update(100, [face(0.2, 0.3), face(0.8, 0.3)]);
  const wob = (t) => face(0.2 + (t % 300) / 20000, 0.3); // (a person is never quite still)
  for (let t = 200; t < 3000; t += 100) tr.update(t, [wob(t)], { x: 0, y: 0, w: 0.5, h: 0.6 });
  assert.equal(tr.visible(2900).length, 2);
  tr.update(3000, [wob(3000)]);
  tr.update(4600, [wob(4600)]);
  assert.equal(tr.visible(4600).length, 1, 'gone once the whole shot is looked at and it isn\u2019t there');
  // a face that never moves (a painting on the wall) isn't someone in the shot; a person is
  const wall = new FaceTracker();
  for (let t = 0; t <= 6000; t += 200) wall.update(t, [face(0.1, 0.2, 0.1), face(0.6 + Math.sin(t / 700) * 0.01, 0.4, 0.2)]);
  const left = wall.visible(6000);
  assert.equal(left.length, 1);
  assert.ok(left[0].box.x > 0.4, 'the person, not the painting');
  ok('small faces: the whole shot and its parts in turn, then a region around who was found (the whole shot now and then), back where they were when lost; a big face keeps the whole shot; a face outside the part looked at is kept; a face that never moves (a painting) isn\u2019t a person');
}

// ---- heads from poses: where someone is when their face can't be seen ----
{
  const head = (x, y, size = 0.2) => ({ ...face(x, y, size), mouth: null, eyesOpen: null, pose: true });
  // a head where a face was found is the same person: the face is kept; a head elsewhere is added
  const m = mergeHeads([face(0.3, 0.4)], [head(0.31, 0.42), head(0.8, 0.4)]);
  assert.equal(m.length, 2);
  assert.ok(m[0].mouth === 0.1 && m[1].pose);
  // one track, face and head in turn (looking down at a guitar, then up): its mouth only from the face
  const tr = new FaceTracker();
  let t = 0;
  for (let i = 0; i < 20; i++, t += 125) tr.update(t, [i % 4 < 2 ? face(0.5, 0.4, 0.2, i % 2 ? 0.05 : 0.3) : head(0.5, 0.41)]);
  assert.equal(tr.tracks.length, 1, 'the same person throughout');
  assert.equal(tr.tracks[0].mouth.length, 10, 'mouth readings from the face only');
  assert.ok(tr.tracks[0].eyesOpen === 1, 'the eyes as the face last said');
  ok('heads from poses: kept only where no face was found, followed as the same person as their face, with mouth and eyes from the face alone');
}

// ---- talking ----
{
  const tr = new FaceTracker();
  let t = 0;
  for (let i = 0; i < 12; i++, t += 100) tr.update(t, [face(0.5, 0.5, 0.2, 0.3)]); // mouth open, still: a smile, a yawn
  assert.equal(talkScore(tr.tracks[0], t - 100), 0);
  for (let i = 0; i < 12; i++, t += 100) tr.update(t, [face(0.5, 0.5, 0.2, i % 2 ? 0.05 : 0.25)]); // opening and closing
  assert.ok(talkScore(tr.tracks[0], t - 100) > 0.9);
  // three pictures a second (a camera off air) still tells
  const slow = new FaceTracker();
  for (let i = 0, u = 0; i < 6; i++, u += 333) slow.update(u, [face(0.5, 0.5, 0.2, i % 2 ? 0.04 : 0.22)]);
  assert.ok(talkScore(slow.tracks[0], 1665) > 0.5);
  // facing: towards the camera beats turned away
  assert.ok(faceScore({ ...face(0.5, 0.5), yaw: 0 }) > faceScore({ ...face(0.5, 0.5), yaw: 0.9 }));
  ok('talking is a mouth opening and closing (not just open), seen at 10 or 3 pictures a second');
}

// ---- Speaker 1, Speaker 2, across cameras ----
// two cameras, two people: A is on the left of camera 1 and the right of camera 2; B the other way round
function scene() {
  const sp = new Speakers();
  const mk = (cam, id, x) => ({ id, box: { x: x - 0.1, y: 0.4, w: 0.2, h: 0.2 }, eyes: { x, y: 0.45 }, talk: 0, talkMs: 0 });
  const c1 = { cam: 'p1', place: 'cam1', tracks: [mk('p1', 1, 0.3), mk('p1', 2, 0.7)] };
  const c2 = { cam: 'p2', place: 'cam2', tracks: [mk('p2', 1, 0.7), mk('p2', 2, 0.3)] };
  return { sp, c1, c2 };
}
{
  const { sp, c1, c2 } = scene();
  let t = 0;
  const run = (ms, who, heard = true, mic = null) => {
    for (let e = 0; e < ms; e += 250, t += 250) {
      c1.tracks[0].talk = c2.tracks[0].talk = who === 'A' ? 0.9 : 0;
      c1.tracks[1].talk = c2.tracks[1].talk = who === 'B' ? 0.9 : 0;
      sp.observe(t, 250, [c1, c2], heard, mic);
    }
  };
  // A's mouth moves, but nothing is heard (eating, say): nobody is a speaker
  run(4000, 'A', false);
  assert.equal(sp.people.length, 0);
  // A talks: both cameras' faces of A are one person
  run(SPEAKERS.pairMs + 500, 'A');
  assert.equal(sp.people.length, 1);
  assert.equal(sp.personOf('p1', 1), 1);
  assert.equal(sp.personOf('p2', 1), 1, 'camera 2 sees the same Speaker 1');
  assert.equal(sp.current, 1);
  assert.equal(sp.label(1), 'Speaker 1');
  // B talks: Speaker 2 (numbered once matched across cameras), and a moment later B is the speaker
  run(SPEAKERS.pairMs + SPEAKERS.changeMs + 500, 'B');
  assert.equal(sp.people.length, 2);
  assert.equal(sp.personOf('p1', 2), 2);
  assert.equal(sp.personOf('p2', 2), 2);
  assert.equal(sp.current, 2);
  // a short pause doesn't lose the speaker; a long one does
  run(1500, null);
  assert.equal(sp.current, 2);
  run(SPEAKERS.quietMs + 500, null);
  assert.equal(sp.current, null);
  // named
  sp.rename(1, '  Rosa Martinez ');
  assert.equal(sp.label(1), 'Rosa Martinez');
  // A turns away from camera 1 (lost) and comes back to the same place: still Speaker 1
  c1.tracks[0] = { ...c1.tracks[0], id: 9, talk: 0, talkMs: 0 };
  sp.observe(t, 250, [c1, c2], false);
  assert.equal(sp.personOf('p1', 9), 1);
  // kept for a reload: numbers, names, places; nothing about what anyone looks like
  const kept = JSON.parse(JSON.stringify(sp));
  assert.deepEqual(Object.keys(kept.people[0]).sort(), ['last', 'n', 'name']);
  const again = new Speakers(kept);
  const back = { ...c1, tracks: [{ ...c1.tracks[0], id: 1 }] };
  again.observe(t + 1000, 250, [back], false);
  assert.equal(again.personOf('p1', 1), 1, 'after a reload, someone back in their place is still Speaker 1');
  assert.equal(again.label(1), 'Rosa Martinez');
  ok('Speaker 1 and 2: the same person across cameras (their mouths move together while someone is heard), held through a short pause, named, back in their place after leaving the shot or a reload; nothing kept but numbers, names and places');
}
{
  // a microphone loud while one person talks is theirs; then the mic says who's talking, even off camera
  const { sp, c1, c2 } = scene();
  let t = 0;
  for (let e = 0; e < SPEAKERS.pairMs + SPEAKERS.micMs + 500; e += 250, t += 250) { // (numbered first, then the mic counted)
    c1.tracks[0].talk = c2.tracks[0].talk = 0.9;
    sp.observe(t, 250, [c1, c2], true, 'mic-rosa');
  }
  assert.equal(sp.get(1).mic, 'mic-rosa');
  c1.tracks[0].talk = c2.tracks[0].talk = 0;
  for (let e = 0; e < 1500; e += 250, t += 250) sp.observe(t, 250, [c1, c2], true, 'mic-rosa');
  assert.equal(sp.current, 1);
  // a talker seen by one camera only, a while: a speaker of their own
  const solo = new Speakers();
  const one = { cam: 'p3', place: 'cam3', tracks: [{ id: 1, box: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, eyes: { x: 0.5, y: 0.45 }, talk: 0.9, talkMs: 0 }] };
  for (let u = 0; u < SPEAKERS.soloMs + 500; u += 250) solo.observe(u, 250, [one], true);
  assert.equal(solo.people.length, 1);
  // two numbers that turn out to be one person (seen alone first, then matched): kept as the first
  const m = new Speakers();
  m.join(['a|1'], 0);
  m.join(['b|1'], 0);
  m.rename(2, 'Sam');
  m.join(['a|1', 'b|1'], 0);
  assert.equal(m.people.length, 1);
  assert.equal(m.label(1), 'Sam');
  assert.equal(m.nextN, 2, 'the next new person is Speaker 2 again');
  ok('a microphone becomes its talker’s, and then says who’s talking; someone on one camera only is a speaker too; one person given two numbers is merged, keeping a name');
}

// ---- framing ----
{
  const f = new Follow();
  // a 16:9 shot, a 16:9 program, one face on the left third
  let r = f.update(0, [face(0.3, 0.5, 0.15)], 16 / 9, 16 / 9, 2, true);
  const eyesAt = (0.5 - 0.015 - r.y) / r.h;
  assert.ok(Math.abs(eyesAt - FRAME.eyeLine) < 0.02, `eyes ${eyesAt.toFixed(2)} down the frame`);
  assert.ok(Math.abs(0.15 / r.h - FRAME.faceH) < 0.02, 'a medium close-up');
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, 'inside the shot');
  assert.ok(Math.abs(r.w / r.h - 1) < 1e-9, 'the program’s shape (16:9 of a 16:9 shot: same proportions)');
  // a small move: the frame holds still
  const held = f.update(100, [face(0.31, 0.505, 0.15)], 16 / 9, 16 / 9, 2);
  assert.deepEqual(held, r);
  // a big move: it eases there, not in one jump
  const step1 = f.update(200, [face(0.6, 0.5, 0.15)], 16 / 9, 16 / 9, 2);
  assert.ok(step1.x > r.x && step1.x + step1.w / 2 < 0.6, 'on its way');
  for (let t = 300; t < 4000; t += 33) r = f.update(t, [face(0.6, 0.5, 0.15)], 16 / 9, 16 / 9, 2);
  assert.ok(Math.abs(r.x + r.w / 2 - 0.6) < 0.01, 'and there');
  // a face looking to the right gets room on the right
  const lead = new Follow().update(0, [face(0.5, 0.5, 0.15, 0.1, { yaw: 0.8 })], 16 / 9, 16 / 9, 2, true);
  assert.ok(lead.x + lead.w / 2 > 0.5);
  // never past the shot's own resolution
  const capped = new Follow().update(0, [face(0.5, 0.5, 0.02)], 16 / 9, 16 / 9, 1.25, true);
  assert.ok(Math.abs(capped.h - 1 / 1.25) < 1e-9);
  // a 16:9 shot in a portrait program: the full height, panned to the face
  const tall = new Follow().update(0, [face(0.8, 0.5, 0.3)], 16 / 9, 9 / 16, 1, true);
  assert.ok(Math.abs(tall.h - 1) < 1e-9 && tall.x > 0.5, 'a portrait slice, over the face');
  // a group: room for all of them
  const g = new Follow().update(0, [face(0.25, 0.5, 0.12), face(0.75, 0.5, 0.12)], 16 / 9, 16 / 9, 2, true);
  assert.ok(g.x <= 0.19 && g.x + g.w >= 0.81);
  // nobody for a while: back to the whole shot, slowly
  const h = new Follow();
  h.update(0, [face(0.3, 0.5, 0.15)], 16 / 9, 16 / 9, 2, true);
  let e = null;
  for (let t = 33; t < 8000; t += 33) e = h.update(t, [], 16 / 9, 16 / 9, 2);
  assert.ok(e.w > 0.97);
  // inside the phone's own square
  assert.deepEqual(within({ x: 0.2, y: 0, w: 0.6, h: 1 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }), { x: 0.5, y: 0.5, w: 0.3, h: 0.5 });
  ok('framing: eyes a third of the way down, a medium close-up, still while close enough, eased when the subject moves, room to look into, no further in than it\u2019s allowed, a portrait slice of a wide shot, the whole group, and back to the whole shot when nobody’s there');
}

// ---- the director, cutting with faces ----
{
  const d = new Director();
  const src = (id, speaker, extra = {}) => ({ id, score: 0.8, sees: { speaker, faces: 0.8, size: 0.2, blink: false, ...extra } });
  let now = 0;
  d.set('c1', now);
  // Speaker 2 starts talking; c1 doesn't show them, c2 does: not at once (they've just started)...
  const ctx = (extra = {}) => ({ speaker: 2, since: 2000, name: 'Sam', pause: false, ...extra });
  now = 2500;
  assert.equal(d.step(now, [src('c1', 0), src('c2', 0.9)], 'landscape', ctx()).cut, undefined);
  // ...a second after they started, it cuts to them
  now = 3100;
  let r = d.step(now, [src('c1', 0), src('c2', 0.9)], 'landscape', ctx());
  assert.equal(r.cut, 'c2');
  assert.equal(r.reason, 'Sam is talking');
  // they keep talking: it stays, even past the usual hold, until there's a pause
  now += 13_000;
  assert.equal(d.step(now, [src('c2', 0.9), src('c3', 0.8, { size: 0.4 }), src('c1', 0)], 'landscape', ctx()).cut, undefined);
  r = d.step(now + 100, [src('c2', 0.9), src('c3', 0.8, { size: 0.4 }), src('c1', 0)], 'landscape', ctx({ pause: true }));
  assert.equal(r.cut, 'c3');
  assert.match(r.reason, /Another angle on Sam/);
  // a new speaker whose camera is blinking: it waits a moment for their eyes
  const d2 = new Director();
  d2.set('c1', 0);
  const c = { speaker: 1, since: 0, name: 'Rosa', pause: false };
  assert.equal(d2.step(5000, [src('c1', 0), src('c2', 0.9, { blink: true })], 'landscape', c).cut, undefined);
  assert.equal(d2.step(5200, [src('c1', 0), src('c2', 0.9, { blink: true })], 'landscape', c).cut, undefined);
  assert.equal(d2.step(5450, [src('c1', 0), src('c2', 0.9, { blink: true })], 'landscape', c).cut, 'c2', 'not forever');
  // a shot gone bad on the speaker is still cut away from
  const d3 = new Director();
  d3.set('c1', 0);
  const bad = { id: 'c1', score: 0.1, parts: { exposure: 0.1 }, sees: { speaker: 0.9, faces: 0.9, size: 0.2 } };
  d3.step(5000, [bad, src('c2', 0)], 'landscape', c);
  assert.equal(d3.step(6000, [bad, src('c2', 0)], 'landscape', c).cut, 'c2');
  // with nobody talking (or face tracking off), the director is as it was
  const d4 = new Director();
  d4.set('c1', 0);
  assert.equal(d4.step(13_000, [{ id: 'c1', score: 0.8 }, { id: 'c2', score: 0.8 }], 'landscape').cut, 'c2');
  ok('the director: to whoever’s talking a second after they start, staying on them, another angle at a pause, not on a blink (for long), still away from a bad shot, and as before without faces');
}

// ---- the bundled MediaPipe sends nothing ----
{
  const js = readFileSync(join(import.meta.dirname, '..', 'public', 'vendor', 'mediapipe', 'vision_bundle.js'), 'utf8');
  assert.ok(!js.includes('odml.pa.googleapis.com'), 'its usage logger’s address is gone');
  assert.ok(js.includes('this.h=void 0') && js.includes('flush(t,e){if(this.i=[],1)t?.()'), 'its timer and its sending are taken out');
  const urls = [...js.matchAll(/https?:\/\/[\w.-]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, [], `no addresses at all: ${urls.join(', ')}`);
  ok('the bundled MediaPipe has no address to send to, and its usage logger never sends');
}

console.log('\nAll faces tests passed.');
