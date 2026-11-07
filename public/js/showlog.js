// The show log: what happened during a show, second by second, kept on this computer so a
// problem can be traced afterwards (a frame rate that sagged, a microphone that stopped, a TV
// that dropped out). The studio samples once a second (studio/showlog.js); this file is the
// part with no page in it: the log itself, its summary, and the sound watch. Node can test it.
//
// A sample (one a second) has short keys, because a three-hour show is ten thousand of them:
//   t     time (ms since 1970)        vis   'v' visible or 'h' hidden     drv  'raf' or 'tick'
//   fps   program frames drawn that second       gap  the longest wait between two (ms)
//   lag   the longest wait between two ticks of the background clock (ms: the computer busy)
//   ctx   the sound engine's state     pk    the program's loudest moment that second (dBFS)
//   rec   Record program on (1/0)     str   streaming out (1/0)        sock  connected to the server
//   air   what's on air (a name, 'Break', 'Black', or a clip)
//   s     each source: id, n (name), k (cam/mic/screen), loc (this computer), open (in the mix),
//         db (its loudest, before the fader), a (its sound: live/muted/ended/off/none),
//         vf (frames its camera delivered that second), vp (frames shown on its tile),
//         ad (sound dropped that second, ms), dv (sound the device delivered that second, ms: about
//         1000, silence included; none when nothing arrives from it), lat (sound latency, ms), sr (sample rate),
//         mic (the microphone a camera's sound comes from), pl (a camera here: its own delay, sensor to
//         arrival, ms), sp (how much later than that its frames come, ms), held (stopped sending: its last
//         picture held), sd (how long its sound waits, ms), ch (this computer's: sides it opened with),
//         dbL / dbR (a stereo input here: each side's loudest), st2 (the mixer hears both sides), side
//         (one side of a split input: L or R), and from a phone's link every few
//         seconds: fps, loss (%), jit (jitter ms), rtt (ms); and what it says about its own sending:
//         tx (frames it sent a second), txk (kbit/s), lim (what held it back: cpu, bandwidth, other,
//         none), enc (its encoder), hw (on its graphics hardware), tier (program, preview, idle)
//   tv    each TV, every few seconds: n, st (link state), fps, kbps, lim (why it's held back), cap
//         (its bitrate cap, kbps), and what it says it gets: rfps (frames shown a second), frz
//         (freezes), drop (frames dropped), remote (a phone remote's Program out)
//   pd    the program's picture delay: every camera here shows the moment this long ago (ms)
//   dup   frames the studio was too late to draw that second (the same picture again)
//   rs    Record program: frames written, dropped (skipped), held (frames the studio was late for, written as
//         the picture before held longer, when the encoder had no room for copies), queue (the encoder's),
//         enc ([mean, longest] ms the encoder took a frame given to it with nothing waiting, that second)
//         and out (frames it gave back that second), drift (sound minus picture, ms),
//         clamped (frames asked for past the recording's time, not written), fixes (the sound: ms taken
//         out, put in, silence for gaps, overMs: past the recording's time, left out)

export const FLOOR_DB = -90; // quieter than this is no sound: a live microphone's own hiss is louder (a room at low gain sits near -80)

export const dbOf = (peak) => (peak > 1e-5 ? Math.max(-99, Math.round(20 * Math.log10(peak))) || 0 : -99);

export class ShowLog {
  constructor({ maxRows = 8 * 3600, maxEvents = 5000, now = () => Date.now() } = {}) {
    this.rows = [];
    this.events = [];
    this.maxRows = maxRows;
    this.maxEvents = maxEvents;
    this.now = now;
    this.startedAt = now();
  }

  add(row) {
    this.rows.push(row);
    if (this.rows.length > this.maxRows) this.rows.splice(0, this.rows.length - this.maxRows);
  }

  /** Something that happened: kind is a short word (note, window, sound, source, alert, ...). */
  event(kind, text, extra) {
    // (an alert keeps all of its advice: a long device name and what to try ran past 300)
    const e = { t: this.now(), kind, text: String(text).slice(0, kind.startsWith('alert') ? 700 : 300), ...(extra || {}) };
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return e;
  }

  summary(target = 30) {
    return summarize(this.rows, this.events, target);
  }

  toJSON(meta = {}) {
    return { kind: 'vuemesh-showlog', version: 1, startedAt: this.startedAt, savedAt: this.now(), ...meta, summary: this.summary(meta.fps || 30), events: this.events, rows: this.rows };
  }
}

const clock = (t) => new Date(t).toTimeString().slice(0, 8);
const mmss = (ms) => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};

/** Stretches of rows where test(row) holds: [{ from, to }] (to is the last row's time + 1 s). */
export function spans(rows, test) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    if (test(r)) {
      if (cur && r.t - cur.to <= 1500) cur.to = r.t + 1000;
      else out.push((cur = { from: r.t, to: r.t + 1000 }));
    } else cur = null;
  }
  return out;
}

/** The show in numbers and in plain words: what to look at first. */
export function summarize(rows, events = [], target = 30) {
  const out = { from: rows[0]?.t ?? null, to: rows.length ? rows.at(-1).t + 1000 : null, seconds: rows.length, lines: [] };
  if (!rows.length) {
    out.lines.push('Nothing logged yet.');
    return out;
  }
  const fpsRows = rows.filter((r) => typeof r.fps === 'number');
  const slow = (r) => typeof r.fps === 'number' && r.fps < target * 0.9;
  const fpsAvg = fpsRows.length ? Math.round((fpsRows.reduce((s, r) => s + r.fps, 0) / fpsRows.length) * 100) / 100 : null;
  const worst = fpsRows.reduce((w, r) => (!w || r.fps < w.fps ? r : w), null);
  const hidden = rows.filter((r) => r.vis === 'h').length;
  const ticked = rows.filter((r) => r.drv === 'tick').length;
  const expectSound = (r) => (r.s || []).some((s) => s.open) && r.air !== 'Black' && r.air !== 'Break';
  const silent = spans(rows, (r) => expectSound(r) && typeof r.pk === 'number' && r.pk < FLOOR_DB);
  const slowSpans = spans(rows, slow);
  out.program = {
    fpsAvg, fpsMin: worst?.fps ?? null, fpsMinAt: worst?.t ?? null,
    slowSeconds: fpsRows.filter(slow).length, hiddenSeconds: hidden, backgroundSeconds: ticked,
    silentSeconds: silent.reduce((s, x) => s + (x.to - x.from), 0) / 1000, silent,
    slow: slowSpans,
  };
  out.lines.push(`Logged ${mmss(out.to - out.from)}, ${clock(out.from)} to ${clock(out.to)}.`);
  if (fpsAvg != null) {
    out.lines.push(`Program picture: ${fpsAvg} frames a second on average (aiming for ${target}); the slowest second was ${worst.fps} at ${clock(worst.t)}.`);
    if (slowSpans.length) {
      const longest = slowSpans.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
      out.lines.push(`Below ${Math.round(target * 0.9)} frames a second for ${mmss(out.program.slowSeconds * 1000)} in all, ${slowSpans.length} time(s); the longest from ${clock(longest.from)} for ${mmss(longest.to - longest.from)}.`);
    }
  }
  if (hidden || ticked) out.lines.push(`The studio window was hidden or covered for ${mmss(Math.max(hidden, ticked) * 1000)} (then the background clock draws the program).`);
  if (silent.length) {
    const longest = silent.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
    out.lines.push(`The program had no sound while something was in the mix ${silent.length} time(s), ${mmss(out.program.silentSeconds * 1000)} in all; the longest from ${clock(longest.from)} for ${mmss(longest.to - longest.from)}.`);
  }
  // sources: when each went quiet, stopped or dropped sound
  const src = new Map();
  for (const r of rows) for (const s of r.s || []) {
    let x = src.get(s.id);
    if (!x) src.set(s.id, (x = { id: s.id, n: s.n, k: s.k, loc: !!s.loc, first: r.t, last: r.t, ended: null, droppedMs: 0, mic: s.mic || null, starvedSeconds: 0, starvedTimes: 0 }));
    x.last = r.t;
    x.n = s.n;
    if (s.mic) x.mic = s.mic;
    if ((s.a === 'ended' || s.a === 'none') && x.hadSound && !x.ended) x.ended = r.t;
    if (s.a === 'live') x.hadSound = true;
    x.droppedMs += s.ad || 0;
    // nothing arriving from the device while its track was live (it stopped sending: not silence)
    const starved = s.loc && s.k !== 'screen' && s.a === 'live' && typeof s.dv === 'number' && s.dv < STARVED_MS;
    if (starved) {
      x.starvedSeconds++;
      if (!x.wasStarved) x.starvedTimes++;
    }
    x.wasStarved = starved;
  }
  // a camera here delivering fewer frames than it should (USB or the computer not keeping up)
  const camFps = new Map();
  for (const r of rows) for (const s of r.s || []) if (s.k === 'cam' && s.loc && typeof s.vf === 'number') {
    const a = camFps.get(s.id) || { n: s.n, sum: 0, k: 0 };
    a.sum += s.vf;
    a.k++;
    camFps.set(s.id, a);
  }
  out.sources = [...src.values()].map(({ hadSound, wasStarved, ...x }) => x);
  for (const [, a] of camFps) {
    const avg = a.sum / a.k;
    if (a.k >= 10 && avg < target * 0.8) out.lines.push(`${a.n} delivered ${Math.round(avg * 10) / 10} frames a second on average (of about ${target}): ${avg >= target * 0.4 && avg <= target * 0.6 ? 'about half, as most webcams do in dim light (they slow down to let in more light): more light on the subject brings it back' : "the camera, its USB port or the computer wasn't keeping up"}.`);
  }
  // a phone's or another computer's picture arriving slowly for 10 s or more: when, how slowly, and
  // whose end it was (what it says it sent, and what held it back)
  for (const x of out.sources) {
    if (x.loc || x.k === 'mic') continue;
    const mine = (r) => (r.s || []).find((s) => s.id === x.id);
    const slowIn = spans(rows, (r) => { const s = mine(r); return typeof s?.fps === 'number' && s.fps < target * 0.8 && s.tier !== 'idle'; });
    for (const sp of slowIn) {
      if (sp.to - sp.from < 10000) continue;
      const during = rows.filter((r) => r.t >= sp.from && r.t < sp.to).map(mine).filter(Boolean);
      const avg = (k) => { const v = during.map((s) => s[k]).filter((n) => typeof n === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      const lims = during.map((s) => s.lim).filter((l) => l && l !== 'none');
      const lim = lims.length ? lims.sort((a, b) => lims.filter((l) => l === b).length - lims.filter((l) => l === a).length)[0] : null;
      const enc = during.map((s) => s.enc).find(Boolean), hw = during.some((s) => s.hw === true);
      const why = lim === 'cpu' ? `held back by its processor${enc ? ` (encoding ${enc}${hw ? ' on its graphics hardware' : ''})` : ''}`
        : lim === 'bandwidth' ? `held back by the network${avg('txk') ? ` (sending ${avg('txk')} kbit/s)` : ''}`
        : lim ? `held back (${lim})` : avg('tx') != null ? 'nothing held back on its side' : 'no word from its side';
      out.lines.push(`${x.n}'s picture arrived at ${avg('fps')} frames a second (of ${target}) from ${clock(sp.from)} for ${mmss(sp.to - sp.from)}: ${avg('tx') != null ? `it sent ${avg('tx')}, ` : ''}${why}.`);
    }
  }
  for (const x of out.sources) {
    if (x.ended) out.lines.push(`${x.n}: its sound stopped at ${clock(x.ended)}.`);
    if (x.droppedMs >= 100) out.lines.push(`${x.n}: ${mmss(x.droppedMs)} of its sound was dropped on the way in (the device or the computer couldn't keep up).`);
    if (x.starvedSeconds >= 2) out.lines.push(`${x.n}: nothing arrived from the device for ${mmss(x.starvedSeconds * 1000)} in all, ${x.starvedTimes} time(s) (it stopped sending, rather than sending silence).`);
  }
  // cameras sharing one microphone, or on the computer's default one
  const byMic = new Map();
  for (const x of out.sources) if (x.k === 'cam' && x.mic) byMic.set(x.mic, [...(byMic.get(x.mic) || []), x.n]);
  for (const [mic, names] of byMic) if (names.length > 1) out.lines.push(`${names.join(' and ')} ${names.length === 2 ? 'both' : 'all'} take their sound from ${mic}.`);
  // sound alerts, each with how long it lasted (until its clearing, or the end of the log)
  const alerts = events.filter((e) => e.kind === 'alert');
  if (alerts.length) out.lines.push(`${alerts.length} sound alert(s):`);
  for (const a of alerts.slice(0, 12)) {
    const clear = events.find((e) => e.kind === 'alert-clear' && e.t >= a.t && e.alert === a.alert && (e.id ?? null) === (a.id ?? null));
    out.lines.push(`  ${clock(a.t)} ${a.text} (${clear ? `for ${mmss(clear.t - a.t)}` : 'until the end of the log'})`);
  }
  if (alerts.length > 12) out.lines.push(`  and ${alerts.length - 12} more.`);
  // TVs: what each said it got
  const tvs = new Map();
  for (const r of rows) for (const t of r.tv || []) {
    if (t.rfps == null) continue;
    const a = tvs.get(t.n) || { n: t.n, sum: 0, k: 0, frz: 0, low: Infinity };
    a.sum += t.rfps;
    a.k++;
    a.frz += t.frz || 0;
    if (t.cap) a.low = Math.min(a.low, t.cap);
    tvs.set(t.n, a);
  }
  for (const [, a] of tvs) {
    const avg = Math.round((a.sum / a.k) * 10) / 10;
    if (avg < target * 0.9 || a.frz) out.lines.push(`${a.n} showed ${avg} frames a second on average${a.frz ? `, froze ${a.frz} time(s)` : ''}${Number.isFinite(a.low) ? `; its picture went as low as ${(a.low / 1000).toFixed(1)} Mbps` : ''}.`);
  }
  // one timeline: the picture delay every camera here was held to, and cameras that stalled or slowed
  const pds = rows.map((r) => r.pd).filter((x) => typeof x === 'number');
  if (pds.length) out.lines.push(`Pictures from this computer's cameras were held to ${Math.min(...pds) === Math.max(...pds) ? `${pds[0]} ms` : `${Math.min(...pds)} to ${Math.max(...pds)} ms`} behind the moment${events.some((e) => e.kind === 'sync-check') ? ' (sync checked)' : ' (no sync check: each camera at a usual figure)'}.`);
  const stalls = events.filter((e) => e.kind === 'picture' && /stopped/.test(e.text));
  for (const e of stalls.slice(0, 6)) out.lines.push(`  ${clock(e.t)} ${e.text}`);
  const slowed = events.filter((e) => e.kind === 'note' && /A camera slowed down/.test(e.text));
  for (const e of slowed.slice(0, 6)) out.lines.push(`  ${clock(e.t)} ${e.text}`);
  const drops = events.filter((e) => e.kind === 'server' && /lost/.test(e.text));
  if (drops.length) out.lines.push(`Lost the server connection ${drops.length} time(s).`);
  return out;
}

/**
 * Watches the program's sound and each source's, and says when to raise an alert and when it
 * has cleared. Feed it once a second: update(t, { program: { db, expect }, sources: [...] }),
 * where expect is whether the program should have sound (something in the mix, not black or a
 * break) and each source is { id, n, open, db, a } (a: live/muted/ended/off/none).
 */
// A microphone or interface on the studio's own computer that stops and comes back on its own. A
// Focusrite Scarlett 2i2 4th Gen did that every minute, three minutes in a row, every 15 minutes:
// nothing at all arrived from it (not silence: no sound), and about 12 s later Chrome gave up on it.
// It had been put down to 1080p webcams taking its USB, but with Easy Start off (the small drive it
// shows when new) it ran clean at 1080p and at 720p: the computer's maker's software (Dell TechHub)
// looked at that drive every 15 minutes, and then every minute for three, and its sound stopped each
// time. The USB note is kept, second, for a computer whose cameras do run at 1080p (usb).
const DRIVE_HINT = ' If it also shows up as a small drive (a Scarlett’s Easy Start), turn that off (open Focusrite Control 2, or hold 48V while plugging it in, then unplug it and plug it in again): software that checks the drives, such as Dell TechHub, stops its sound.';
const USB_HINT = ' Its USB also carries cameras at 1080p: if it keeps happening, try Output at 720p, or another USB port.';
/** What to try, after a source's alert: for a microphone on this computer, and its USB beside 1080p cameras. */
const hintFor = (s) => {
  const h = (s.loc && s.k === 'mic' ? DRIVE_HINT : '') + (s.usb ? USB_HINT : '');
  return h ? `.${h}` : '';
};
// (Chrome's count of the sound a device delivered that second, in ms: about 1000 when it's sending,
// silence included; none when nothing arrives from it)
const STARVED_MS = 50;
export class SoundWatch {
  constructor({ programAfterMs = 3000, sourceAfterMs = 5000, mutedAfterMs = 2000, floorDb = FLOOR_DB } = {}) {
    Object.assign(this, { programAfterMs, sourceAfterMs, mutedAfterMs, floorDb });
    this.active = new Map(); // key → alert
    this.since = new Map(); // key → when its condition started
    this.hadSound = new Set(); // sources that have had a live sound track
    this.before = new Map(); // id → the source as it was a second ago
    this.gone = new Map(); // key → alert, for sources that left while their sound was in the mix
  }

  update(t, { program = {}, sources = [] } = {}) {
    const want = new Map(); // key → alert, for every condition holding now (after its wait)
    const hold = (key, after, alert) => {
      if (!this.since.has(key)) this.since.set(key, t);
      if (t - this.since.get(key) >= after) want.set(key, { key, since: this.since.get(key), ...alert });
    };
    const holding = new Set();
    const check = (key, cond, after, alert) => {
      if (!cond) return;
      holding.add(key);
      hold(key, after, alert);
    };
    for (const s of sources) {
      if (s.a === 'live') this.hadSound.add(s.id);
      const had = this.hadSound.has(s.id), hint = hintFor(s);
      check(`ended:${s.id}`, s.open && had && (s.a === 'ended' || s.a === 'none'), 0, { kind: 'source-ended', id: s.id, n: s.n, text: `${s.n}: its sound stopped (the device let go of it)${hint}` });
      check(`muted:${s.id}`, s.open && s.a === 'muted', this.mutedAfterMs, { kind: 'source-muted', id: s.id, n: s.n, text: `${s.n}: no sound is coming from the device${hint}` });
      // silent: nothing arriving from the device (it stopped sending), or the device sending silence
      // (its cable, gain or mute), where Chrome says which (dv); else as before
      // (this computer's own devices only: a phone's sound keeps arriving, as silence, when its network drops)
      const dv = s.loc && s.k !== 'screen' && typeof s.dv === 'number' ? s.dv : null;
      const starved = dv != null && dv < STARVED_MS, quiet = dv != null && !starved;
      check(`silent:${s.id}`, s.open && s.a === 'live' && typeof s.db === 'number' && s.db < this.floorDb, this.sourceAfterMs, {
        kind: 'source-silent', id: s.id, n: s.n,
        text: starved ? `${s.n}: no sound is arriving from the device${hint}` : quiet ? `${s.n}: it has gone silent (the device is sending silence: check its cable, its gain and any mute)` : `${s.n}: it has gone silent${hint}`,
      });
    }
    // A source that leaves while its sound is in the mix (a USB interface dropping out is
    // taken as unplugged, and the source goes): say so, and keep expecting the program's sound,
    // so that losing the only microphone isn't silence with nothing said. It clears when the
    // program has sound again, or the source comes back.
    const now = new Map(sources.map((x) => [x.id, x]));
    for (const [id, was] of this.before) if (!now.has(id) && was.open && this.hadSound.has(id)) {
      const key = `gone:${id}`;
      if (this.gone.has(key)) continue;
      this.gone.set(key, { key, since: t, kind: 'source-gone', id, n: was.n, text: `${was.n} left the show while its sound was in the program (unplugged, or the device stopped)${hintFor(was)}` });
    }
    this.before = now;
    const heard = typeof program.db === 'number' && program.db >= this.floorDb;
    // (heard counts from two seconds on: the second it left, the meter still holds its last sound)
    for (const [key, a] of [...this.gone]) if ((heard && t - a.since >= 2000) || now.has(a.id)) this.gone.delete(key);
    for (const [key, a] of this.gone) {
      holding.add(key);
      want.set(key, a);
    }
    const expect = program.expect || this.gone.size > 0;
    check('program', expect && typeof program.db === 'number' && program.db < this.floorDb, this.programAfterMs, { kind: 'program-silent', text: 'The program has no sound' });
    for (const key of [...this.since.keys()]) if (!holding.has(key)) this.since.delete(key);
    const raised = [], cleared = [];
    for (const [key, a] of want) if (!this.active.has(key)) {
      this.active.set(key, a);
      raised.push(a);
    }
    for (const [key, a] of [...this.active]) if (!want.has(key)) {
      this.active.delete(key);
      cleared.push(a);
    }
    return { raised, cleared, active: [...this.active.values()] };
  }
}

/**
 * The mixer's watch over one source's sound, every 2 s (studio/usage.js): whether its sound has
 * stopped reaching the mixer, so it's put back (reconnected), and whether the event log says so.
 * w is the source's watch ({ heardAt, silentSince, retries }), changed here; heard is whether the
 * look just now found anything at all. heardAt is also set by the show log's own look, 20 times a
 * second: one look every 2 s missed sound with true silence between (another computer's shared
 * screen: a ding, a video's quiet moments), and put it back every 12 s while it played.
 * When putting it back brings nothing, it's most likely just silent (a shared screen with nothing
 * playing sends exact silence, which looks the same as a sound that stopped reaching the mixer):
 * it's tried again after 16 s, 32 s, then once a minute, and said once.
 * Returns null, or { say } when it's to be put back now.
 */
export function mixerWatch(w, now, heard) {
  if (heard) w.heardAt = now;
  if (now - (w.heardAt || 0) < 2500) {
    w.silentSince = 0;
    w.retries = 0;
    return null;
  }
  if (!w.silentSince) {
    w.silentSince = now;
    return null;
  }
  if (now - w.silentSince <= Math.min(60000, 8000 * 2 ** (w.retries || 0))) return null;
  const say = !w.retries;
  w.retries = (w.retries || 0) + 1;
  w.silentSince = 0;
  return { say };
}

/**
 * The chunks kept in this browser's storage (a minute each), put back together: one show log
 * per studio session, newest first, each { session, startedAt, at, meta, rows, events }.
 */
export function joinChunks(chunks) {
  const by = new Map();
  for (const c of [...chunks].sort((a, b) => (a.n ?? 0) - (b.n ?? 0))) {
    let s = by.get(c.session);
    if (!s) by.set(c.session, (s = { session: c.session, eventId: c.eventId, startedAt: c.startedAt, at: c.at, meta: null, rows: [], events: [] }));
    if (c.meta) s.meta = c.meta;
    s.rows.push(...(c.rows || []));
    s.events.push(...(c.events || []));
    s.at = Math.max(s.at || 0, c.at || 0);
  }
  return [...by.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** One kept session as the file Save show log makes. */
export function sessionFile(s) {
  return { kind: 'vuemesh-showlog', version: 1, startedAt: s.startedAt, savedAt: s.at, ...(s.meta || {}), summary: summarize(s.rows, s.events, s.meta?.fps || 30), events: s.events, rows: s.rows };
}
