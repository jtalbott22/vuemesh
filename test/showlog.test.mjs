// The show log's own logic (public/js/showlog.js): the sound watch's alerts, the summary's
// numbers and words, and the log's limits. No browser needed.
import assert from 'node:assert/strict';
import { ShowLog, SoundWatch, summarize, spans, dbOf, FLOOR_DB, joinChunks, sessionFile, mixerWatch, soundIn } from '../public/js/showlog.js';

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
  // a camera whose person paused it, or is watching the program on the phone, sends silence on purpose
  const w = new SoundWatch();
  const cam = (db, pz) => ({ id: 'p', n: '13 Pro X', k: 'cam', open: 1, a: 'live', db, ...(pz ? { pz: 1 } : {}) });
  let r = w.update(at(0), { program: { db: -20, expect: true }, sources: [cam(-30)] });
  for (let s = 1; s <= 12; s++) r = w.update(at(s), { program: { db: -20, expect: true }, sources: [cam(-99, true)] });
  assert.equal(r.active.length, 0, r.active);
  r = w.update(at(13), { program: { db: -20, expect: true }, sources: [cam(-30)] });
  for (let s = 14; s <= 20; s++) r = w.update(at(s), { program: { db: -20, expect: true }, sources: [cam(-99)] });
  assert.deepEqual(r.active.map((a) => a.kind), ['source-silent'], 'not paused, its silence is still raised');
  ok("sound watch: a camera paused by its person (or watching the program) isn't \"gone silent\"; back live and silent, it is");
}
{
  // a shared screen (here, or another computer's over /share) is silent whenever nothing on it plays
  const w = new SoundWatch();
  const screen = (db, a = 'live') => ({ id: 's', n: 'Josh Mac', k: 'screen', open: 1, a, db });
  let r;
  for (let s = 0; s <= 12; s++) r = w.update(at(s), { program: { db: -20, expect: true }, sources: [screen(-99)] });
  assert.equal(r.active.length, 0, 'a silent screen raises nothing');
  r = w.update(at(13), { program: { db: -20, expect: true }, sources: [screen(-99, 'ended')] });
  r = w.update(at(14), { program: { db: -20, expect: true }, sources: [] });
  assert.equal(r.active.length, 0, 'nor its sound stopping, nor the screen going while its sound was in the mix');
  ok('sound watch: a shared screen going silent, losing its sound or leaving raises nothing');
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
  // a microphone on the studio's own computer (an interface) that stops: its alerts say what to try,
  // Easy Start first (a Scarlett's small drive, which Dell TechHub looked at and stopped its sound),
  // and the USB note only beside cameras there at 1080p (flagged usb)
  const sc = (a, db, { usb, loc = true, dv, k = 'mic' } = {}) => ({ id: 's', n: 'Scarlett', k, loc: loc ? 1 : undefined, open: true, a, db, ...(usb ? { usb: 1 } : {}), ...(dv != null ? { dv } : {}) });
  const run = (o) => {
    const w = new SoundWatch();
    w.update(at(0), { program: { db: -40, expect: true }, sources: [sc('live', -46, o)] });
    w.update(at(1), { program: { db: -99, expect: true }, sources: [sc('live', -99, o)] });
    const r = w.update(at(7), { program: { db: -99, expect: true }, sources: [sc('live', -99, o)] });
    const ended = w.update(at(8), { program: { db: -99, expect: true }, sources: [sc('ended', null, o)] }).raised.find((a) => a.kind === 'source-ended')?.text;
    return { silent: r.active.find((a) => a.kind === 'source-silent')?.text, ended };
  };
  // nothing arriving from it (Chrome counted no sound delivered): that's what the Scarlett did
  let t = run({ dv: 0 });
  assert.match(t.silent, /^Scarlett: no sound is arriving from the device\. If it also shows up as a small drive \(a Scarlett’s Easy Start\), turn that off/);
  assert.ok(/open Focusrite Control 2, or hold 48V while plugging it in, then unplug it and plug it in again/.test(t.silent) && !/1080p/.test(t.silent), t.silent);
  assert.match(t.ended, /^Scarlett: its sound stopped \(the device let go of it\)\. If it also shows up/);
  // sending silence (about a second of sound counted, all of it quiet): its cable, gain or mute, not the drive
  t = run({ dv: 1000 });
  assert.equal(t.silent, 'Scarlett: it has gone silent (the device is sending silence: check its cable, its gain and any mute)');
  // not known which (no count from Chrome): the hint, as for one that stopped
  assert.match(run({}).silent, /^Scarlett: it has gone silent\. If it also shows up/);
  // beside 1080p cameras on this computer: the USB note too, after the drive
  t = run({ dv: 0, usb: true });
  assert.ok(/Easy Start.*Its USB also carries cameras at 1080p: if it keeps happening, try Output at 720p, or another USB port\.$/.test(t.silent), t.silent);
  // a phone's microphone: no advice about this computer's drives or USB, and its delivered sound
  // isn't taken as "sending silence" (a phone's keeps arriving, as silence, when its network drops)
  assert.equal(run({ loc: false }).ended, 'Scarlett: its sound stopped (the device let go of it)');
  assert.equal(run({ loc: false, dv: 1000 }).silent, 'Scarlett: it has gone silent');
  // a shared screen's or this computer's sound: silent whenever nothing on it plays, so no alert at all
  assert.equal(run({ k: 'screen', dv: 1000 }).silent, undefined);
  assert.equal(run({ k: 'screen', dv: 0 }).silent, undefined);
  // the show log keeps all of an alert's advice, after a long device name (it was cut at 300)
  const log = new ShowLog();
  const long = 'Analogue 1 + 2 (Focusrite USB Audio) · Input 1 left the show while its sound was in the program (unplugged, or the device stopped)' + run({ dv: 0, usb: true }).silent.slice('Scarlett: no sound is arriving from the device'.length);
  assert.ok(long.length > 300);
  assert.equal(log.event('alert', long).text, long);
  assert.equal(log.event('note', long).text.length, 300);
  ok('sound watch: an interface here that stops says what to try (Easy Start first; the USB note beside 1080p cameras); one sending silence says check its cable, gain and mute');
}
{
  // the summary: how long nothing arrived from a device, and how many times
  const rows = [];
  const gap = (i) => (i >= 10 && i < 22) || (i >= 30 && i < 33);
  for (let i = 0; i < 40; i++) rows.push({ t: at(i), fps: 30, pk: -30, s: [{ id: 'f', n: 'Focusrite', k: 'mic', loc: 1, open: 1, a: 'live', db: gap(i) ? -99 : -30, dv: gap(i) ? 0 : 1000 }, { id: 'p', n: 'Phone', k: 'mic', open: 1, a: 'live', db: -30, dv: gap(i) ? 0 : 1000 }] });
  const text = summarize(rows, [], 30).lines.join('\n');
  assert.ok(text.includes('Focusrite: nothing arrived from the device for 15 s in all, 2 time(s) (it stopped sending, rather than sending silence).'), text);
  assert.ok(!text.includes('Phone: nothing arrived'), 'only this computer’s own devices are counted');
  ok('summary: how long nothing arrived from a device (stopped sending, not silence), and how many times');
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

{
  // another computer's screen arriving slowly: its own word on why (what it sent, what held it back)
  const t0 = Date.UTC(2026, 10, 7, 13, 46, 0);
  const row = (i, src) => ({ t: t0 + i * 1000, vis: 'v', fps: 30, s: [src] });
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row(i, { id: 'm', n: 'Mac', k: 'screen', fps: 30, tx: 30, tier: 'program' }));
  for (let i = 10; i < 25; i++) rows.push(row(i, { id: 'm', n: 'Mac', k: 'screen', fps: 11, tx: 12, lim: 'cpu', enc: 'VideoToolbox', hw: true, tier: 'program' }));
  for (let i = 25; i < 30; i++) rows.push(row(i, { id: 'm', n: 'Mac', k: 'screen', fps: 30, tx: 30, tier: 'program' }));
  // off air (idle) it may be sent smaller and slower on purpose: not a problem
  for (let i = 30; i < 50; i++) rows.push(row(i, { id: 'm', n: 'Mac', k: 'screen', fps: 8, tier: 'idle' }));
  // a phone that never says: still named, with no word from its side
  for (let i = 0; i < 50; i++) rows[i].s.push({ id: 'p', n: 'Phone', k: 'cam', fps: i < 12 ? 10 : 30 });
  const lines = summarize(rows, [], 30).lines;
  const mac = lines.filter((l) => l.startsWith("Mac's picture"));
  assert.equal(mac.length, 1, lines.join('\n'));
  assert.match(mac[0], /arrived at 11 frames a second \(of 30\) from .* for 15 s: it sent 12, held back by its processor \(encoding VideoToolbox on its graphics hardware\)\./);
  assert.ok(lines.some((l) => /^Phone's picture arrived at 10 frames a second .* for 12 s: no word from its side\.$/.test(l)), lines.join('\n'));
  ok("a remote picture arriving slowly for 10 s or more: when, how slowly, what it says it sent and what held it back; not while it's off air");
}

// ---- the mixer's watch: a source whose sound stopped reaching the mixer is put back ----
{
  // the watch looks every 2 s; the show log's look marks heardAt 20 times a second
  const run = (w, from, to, heardAt = () => false) => {
    const out = [];
    for (let s = from; s <= to; s += 2) {
      if (heardAt(s)) w.heardAt = at(s - 0.1);
      const r = mixerWatch(w, at(s), false);
      if (r) out.push([s, r.say]);
    }
    return out;
  };
  // a beep a second (another computer's screen): every 2 s look lands in the silence between, but
  // the show log hears each beep, so it's never put back (it was, every 12 s)
  let w = {};
  assert.deepEqual(run(w, 0, 120, () => true), [], 'sound with silence between is reaching the mixer');
  // nothing at all for 2 minutes (a shared screen with nothing playing, or sound that stopped
  // reaching the mixer): put back once 8 s on, then after 16 s, 32 s, then once a minute; said once
  w = {};
  const silent = run(w, 0, 240);
  assert.deepEqual(silent.map(([, say]) => say), [true, false, false, false, false], JSON.stringify(silent));
  const gaps = silent.slice(1).map(([s], i) => s - silent[i][0]);
  assert.ok(gaps[0] >= 16 && gaps[0] <= 20 && gaps[1] >= 32 && gaps[1] <= 36 && gaps[2] >= 60 && gaps[3] <= 64, JSON.stringify(silent));
  // its sound comes back: the watch starts over, and a later stop is put back at 8 s and said again
  assert.deepEqual(run(w, 242, 250, () => true), []);
  const again = run(w, 252, 270);
  assert.equal(again.length, 1, JSON.stringify(again));
  assert.ok(again[0][1] && again[0][0] - 252 >= 8 && again[0][0] - 252 <= 12, JSON.stringify(again));
  // just listened to (a new link): silent from the start, it's put back 2 s on, not 8; after that
  // as before (16 s). Listened to over 30 s ago: 8 s, as before
  w = { attachedAt: at(0) };
  const fresh = run(w, 0, 40);
  assert.ok(fresh.length >= 2 && fresh[0][1] && fresh[0][0] >= 4 && fresh[0][0] <= 6 && fresh[1][0] - fresh[0][0] >= 16, JSON.stringify(fresh));
  w = { attachedAt: at(-60) };
  const old = run(w, 0, 12);
  assert.ok(old.length === 1 && old[0][0] >= 8, JSON.stringify(old));
  // the look itself finding sound counts too (the show log not running: Edit, a context not started)
  w = {};
  for (let s = 0; s <= 60; s += 2) assert.equal(mixerWatch(w, at(s), true), null);
  ok("the mixer's watch: sound with true silence between (a shared screen's) isn't put back every 12 s; one that stays silent is put back after 8, 16, 32 s, then once a minute, said once; said again after it comes back and stops; a new link's silent sound is put back after 2 s");
}

// ---- a phone's sound as the studio plays it: hurried after a rush, made up where it didn't arrive ----
{
  const tot = (sec, o = {}) => ({ jitterMs: 5, rate: 48000, received: sec * 48000, removed: 0, inserted: 0, concealed: 0, bufS: sec * 50 * 0.15, emitted: sec * 50, ...o });
  assert.deepEqual(soundIn(null, tot(10)), { ajit: 5 }, 'the first reading: only what holds now');
  assert.deepEqual(soundIn(tot(10), tot(15)), { ajit: 5, abuf: 150, fast: 0, slow: 0, fill: 0, got: 5000 }, 'a steady 5 s: 150 ms waiting, nothing hurried');
  // the Mac's 2 s stall: 1.9 s made up, then the backlog arriving at once and hurried through
  const v = soundIn(tot(15), tot(20, { jitterMs: 179, removed: 1.4 * 48000, concealed: 1.9 * 48000 }));
  assert.equal(v.fast, 1400); assert.equal(v.fill, 1900); assert.equal(v.ajit, 179);
  assert.deepEqual(soundIn(tot(20, { removed: 48000 }), tot(3)), { ajit: 5 }, 'its link made again (totals went back): no numbers from the old one');
  assert.equal(soundIn(tot(10), null), null);
  ok('soundIn: from two readings of a link, its sound\'s wait (150 ms), and ms hurried, made up and arrived; a first reading or a new link gives only what holds now');

  // the summary: said once per source, with when and how much, and nothing for a steady phone
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const s = [{ id: 'mac', n: 'Mac screen', k: 'screen', open: 1, a: 'live', ajit: 5 }, { id: 'pix', n: 'Pixel', k: 'cam', open: 1, a: 'live', ajit: 4 }];
    if (i % 5 === 0) {
      Object.assign(s[0], i === 30 ? { fast: 1400, fill: 1900, ajit: 179 } : i === 35 ? { fast: 300, fill: 0 } : { fast: 3, fill: 0 });
      Object.assign(s[1], { fast: 2, fill: 0 });
    }
    rows.push({ t: at(i), fps: 30, pk: -20, air: 'Mac screen', s });
  }
  const sum = summarize(rows, [], 30);
  const text = sum.lines.join('\n');
  const line = sum.lines.find((l) => l.startsWith("Mac screen's sound was played faster"));
  assert.ok(line, text);
  assert.match(line, /2 time\(s\)/); assert.match(line, /2 s of it in all/); assert.match(line, /1400 ms/); assert.match(line, /jitter 179 ms/); assert.match(line, /1900 ms made up/);
  assert.match(line, new RegExp(new Date(at(30)).toTimeString().slice(0, 8)));
  assert.match(text, /Mac screen: 2 s of its sound didn't arrive in time/);
  assert.ok(!/Pixel's sound/.test(text) && !/Pixel: .* made up/.test(text), text);
  ok('summary: a source hurried after a stall is said once (how often, how much, the worst moment with its jitter and what was made up); a steady phone isn\'t');
}

console.log('\nAll show log tests passed.');
