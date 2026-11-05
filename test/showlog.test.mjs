// The show log's own logic (public/js/showlog.js): the sound watch's alerts, the summary's
// numbers and words, and the log's limits. No browser needed.
import assert from 'node:assert/strict';
import { ShowLog, SoundWatch, summarize, spans, dbOf, FLOOR_DB, joinChunks, sessionFile } from '../public/js/showlog.js';

const ok = (m) => console.log('ok  ' + m);
const T0 = Date.UTC(2026, 10, 4, 15, 0, 0);
const at = (s) => T0 + s * 1000;

// ---- the sound watch ----
{
  const w = new SoundWatch();
  const mic = (a, db, open = true) => ({ id: 'm1', n: 'Focusrite', open, a, db });
  const prog = (db, expect = true) => ({ db, expect });
  let r = w.update(at(0), { program: prog(-20), sources: [mic('live', -18)] });
  assert.equal(r.raised.length, 0);
  r = w.update(at(1), { program: prog(-99), sources: [mic('ended', null)] });
  assert.deepEqual(r.raised.map((a) => a.kind), ['source-ended'], 'a source whose sound ends is raised at once');
  r = w.update(at(2), { program: prog(-99), sources: [mic('ended', null)] });
  assert.equal(r.raised.length, 0, 'not raised twice');
  r = w.update(at(4), { program: prog(-99), sources: [mic('ended', null)] });
  assert.deepEqual(r.raised.map((a) => a.kind), ['program-silent'], 'the program silent for 3 s is raised');
  assert.equal(r.active.length, 2);
  r = w.update(at(5), { program: prog(-30), sources: [mic('live', -25)] });
  assert.deepEqual(r.cleared.map((a) => a.kind).sort(), ['program-silent', 'source-ended'], 'both clear when the sound is back');
  ok('sound watch: a source that stops is raised at once, the silent program after 3 s, both clear when sound returns');
}
{
  const w = new SoundWatch();
  // muted in the mixer (not open): its device stopping is no alert, and nor is the program's silence if nothing is open
  let r = w.update(at(0), { program: { db: -99, expect: false }, sources: [{ id: 'a', n: 'A', open: false, a: 'live', db: -20 }] });
  r = w.update(at(1), { program: { db: -99, expect: false }, sources: [{ id: 'a', n: 'A', open: false, a: 'ended' }] });
  r = w.update(at(10), { program: { db: -99, expect: false }, sources: [{ id: 'a', n: 'A', open: false, a: 'ended' }] });
  assert.equal(r.active.length, 0, r.active);
  // a camera that never had sound isn't "stopped"
  r = w.update(at(11), { program: { db: -20, expect: true }, sources: [{ id: 'c', n: 'Cam', open: true, a: 'none' }] });
  assert.equal(r.active.length, 0);
  ok("sound watch: nothing raised for sources that aren't in the mix, or a camera that never had sound");
}
{
  const w = new SoundWatch();
  const live = (s, db) => w.update(at(s), { program: { db: -20, expect: true }, sources: [{ id: 'm', n: 'Mic', open: true, a: 'live', db }] });
  live(0, -20);
  assert.equal(live(1, -95).raised.length, 0);
  assert.equal(live(5, -95).raised.length, 0, 'four seconds of silence is not yet an alert');
  assert.deepEqual(live(6, -95).raised.map((a) => a.kind), ['source-silent'], 'five is');
  live(7, -95);
  assert.deepEqual(live(8, -40).cleared.map((a) => a.kind), ['source-silent']);
  // muted (the device stopped delivering) after 2 s; a blip shorter than that is nothing
  const m = (s, a) => w.update(at(s), { program: { db: -20, expect: true }, sources: [{ id: 'm', n: 'Mic', open: true, a, db: -99 }] });
  assert.equal(m(10, 'muted').raised.length, 0);
  assert.equal(m(11, 'live').raised.length, 0);
  assert.equal(m(12, 'muted').raised.length, 0, 'the wait starts again after it came back');
  assert.deepEqual(m(14, 'muted').raised.map((a) => a.kind), ['source-muted']);
  ok('sound watch: a source silent 5 s, or muted by its device 2 s, is raised; shorter blips are not');
}

{
  // the only microphone in the mix leaves (the studio takes a dropped USB device as unplugged)
  const w = new SoundWatch();
  const cam = { id: 'c', n: 'Cam', open: false, a: 'live', db: -30 };
  w.update(at(0), { program: { db: -20, expect: true }, sources: [{ id: 'f', n: 'Focusrite', open: true, a: 'live', db: -20 }, cam] });
  let r = w.update(at(1), { program: { db: -99, expect: false }, sources: [cam] });
  assert.deepEqual(r.raised.map((a) => a.kind), ['source-gone'], 'raised the moment it goes');
  r = w.update(at(4), { program: { db: -99, expect: false }, sources: [cam] });
  assert.deepEqual(r.raised.map((a) => a.kind), ['program-silent'], 'and the program counts as silent, though nothing is in the mix now');
  r = w.update(at(5), { program: { db: -25, expect: true }, sources: [{ ...cam, open: true }] });
  assert.deepEqual(r.cleared.map((a) => a.kind).sort(), ['program-silent', 'source-gone'], 'both clear once something is heard');
  // as the studio sees it: the sound ends first, and a moment later the source is removed
  const w2 = new SoundWatch();
  w2.update(at(0), { program: { db: -20, expect: true }, sources: [{ id: 'f', n: 'Focusrite', open: true, a: 'live', db: -20 }] });
  assert.deepEqual(w2.update(at(1), { program: { db: -99, expect: true }, sources: [{ id: 'f', n: 'Focusrite', open: true, a: 'ended' }] }).raised.map((a) => a.kind), ['source-ended']);
  r = w2.update(at(2), { program: { db: -6, expect: false }, sources: [] }); // (the meter still holds its last sound)
  assert.deepEqual(r.active.map((a) => a.kind), ['source-gone'], 'its alert carries on as gone once it leaves');
  w2.update(at(4), { program: { db: -99, expect: false }, sources: [] });
  r = w2.update(at(7), { program: { db: -99, expect: false }, sources: [] });
  assert.deepEqual(r.raised.map((a) => a.kind), ['program-silent'], 'silent 3 s after its last sound');
  // a source that leaves while it isn't in the mix is just someone leaving
  w.update(at(6), { program: { db: -25, expect: true }, sources: [{ ...cam, open: true }, { id: 'x', n: 'X', open: false, a: 'live' }] });
  r = w.update(at(7), { program: { db: -25, expect: true }, sources: [{ ...cam, open: true }] });
  assert.equal(r.raised.length, 0);
  ok('sound watch: the only microphone in the mix leaving (unplugged) is raised at once, and its silence after 3 s; both clear when sound returns');
}

// ---- spans and the summary ----
{
  const rows = [0, 1, 2, 5, 6, 10].map((s) => ({ t: at(s) }));
  assert.deepEqual(spans(rows, () => true).map((x) => [(x.from - T0) / 1000, (x.to - T0) / 1000]), [[0, 3], [5, 7], [10, 11]]);
  ok('spans: rows a second apart join, over one missing second too; two or more missing start a new span');
}
{
  const rows = [];
  for (let s = 0; s < 120; s++) {
    const quiet = s >= 60 && s < 75; // the Focusrite stopped for 15 s
    rows.push({
      t: at(s), vis: s >= 30 ? 'h' : 'v', drv: s >= 30 ? 'tick' : 'raf', fps: s >= 30 ? 26 : 30, pk: quiet ? -99 : -18, air: 'Cam 1',
      s: [
        { id: 'f', n: 'Focusrite', k: 'mic', open: 1, a: quiet ? 'ended' : 'live', db: quiet ? null : -18, ad: s === 40 ? 120 : 0 },
        { id: 'c1', n: 'C930e', k: 'cam', open: 0, a: 'live', mic: 'Microphone (C930e)' },
        { id: 'c2', n: 'C930e 2', k: 'cam', open: 0, a: 'live', mic: 'Microphone (C930e)' },
      ],
    });
  }
  const sum = summarize(rows, [{ t: at(61), kind: 'alert', alert: 'source-ended', id: 'f', text: 'Focusrite: its sound stopped' }, { t: at(75), kind: 'alert-clear', alert: 'source-ended', id: 'f', text: 'Cleared' }, { t: at(64), kind: 'alert', alert: 'program-silent', text: 'The program has no sound' }], 30);
  assert.equal(sum.seconds, 120);
  assert.equal(sum.program.fpsMin, 26);
  assert.equal(sum.program.slowSeconds, 90);
  assert.equal(sum.program.hiddenSeconds, 90);
  assert.equal(sum.program.silentSeconds, 15);
  assert.equal(sum.program.fpsAvg, 27);
  const text = sum.lines.join('\n');
  for (const want of ['27 frames a second on average', 'hidden or covered for 1 min 30 s', 'no sound while something was in the mix 1 time(s), 15 s', 'Focusrite: its sound stopped at', 'Focusrite: 120 ms of its sound', 'C930e and C930e 2 both take their sound from Microphone (C930e)', '2 sound alert(s):', `${new Date(at(61)).toTimeString().slice(0, 8)} Focusrite: its sound stopped (for 14 s)`, 'The program has no sound (until the end of the log)'])
    assert.ok(text.includes(want), `summary should say "${want}":\n${text}`);
  ok('summary: average and slowest frame rate, time hidden, silent stretches, a stopped source, dropped sound, cameras sharing a mic, alerts');
}

{
  // a camera here that delivered 18 frames a second of 30
  const rows = Array.from({ length: 30 }, (_, i) => ({ t: at(i), fps: 30, s: [{ id: 'c', n: 'C930e 2', k: 'cam', loc: 1, vf: 18 }, { id: 'd', n: 'Desk', k: 'cam', loc: 1, vf: 30 }] }));
  const text = summarize(rows, [], 30).lines.join('\n');
  assert.ok(text.includes('C930e 2 delivered 18 frames a second on average') && !text.includes('Desk delivered'), text);
  ok("summary: a camera here delivering fewer frames than it should (USB or the computer not keeping up)");
}

// ---- the log ----
{
  let t = T0;
  const log = new ShowLog({ maxRows: 5, maxEvents: 3, now: () => t });
  for (let i = 0; i < 8; i++) log.add({ t: at(i), fps: 30 });
  for (let i = 0; i < 5; i++) log.event('note', `n${i}`);
  assert.equal(log.rows.length, 5);
  assert.equal(log.rows[0].t, at(3), 'the oldest rows go first');
  assert.deepEqual(log.events.map((e) => e.text), ['n2', 'n3', 'n4']);
  t = at(9);
  const j = JSON.parse(JSON.stringify(log.toJSON({ eventId: 'ABC123', fps: 30 })));
  assert.equal(j.kind, 'vuemesh-showlog');
  assert.equal(j.eventId, 'ABC123');
  assert.equal(j.rows.length, 5);
  assert.ok(j.summary.lines.length > 0);
  assert.equal(dbOf(1), 0);
  assert.equal(dbOf(0), -99);
  assert.equal(dbOf(0.1), -20);
  assert.ok(FLOOR_DB < -60);
  ok('log: keeps the newest rows and events within its limits; saves as one JSON with its summary');
}

// ---- kept a minute at a time, put back together ----
{
  const chunks = [
    { eventId: 'E', session: 'b', n: 1, startedAt: at(100), at: at(220), rows: [{ t: at(160) }], events: [] },
    { eventId: 'E', session: 'a', n: 0, startedAt: at(0), at: at(60), rows: [{ t: at(0) }], events: [{ t: at(1), kind: 'note', text: 'x' }], meta: { title: 'Class', fps: 30 } },
    { eventId: 'E', session: 'b', n: 0, startedAt: at(100), at: at(160), rows: [{ t: at(100) }], events: [], meta: { title: 'Class 2', fps: 25 } },
    { eventId: 'E', session: 'a', n: 1, startedAt: at(0), at: at(120), rows: [{ t: at(60) }], events: [] },
  ];
  const ss = joinChunks(chunks);
  assert.deepEqual(ss.map((s) => s.session), ['b', 'a'], 'newest session first');
  assert.deepEqual(ss[1].rows.map((r) => (r.t - T0) / 1000), [0, 60], 'chunks in order');
  assert.equal(ss[0].meta.title, 'Class 2');
  assert.equal(ss[0].at, at(220));
  const f = sessionFile(ss[1]);
  assert.equal(f.kind, 'vuemesh-showlog');
  assert.equal(f.title, 'Class');
  assert.equal(f.rows.length, 2);
  ok('kept chunks: put back together into one log per studio session, newest first, saved as the same file');
}

console.log('\nAll show log tests passed.');
