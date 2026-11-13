// Live captions: what's said on the program, as text, worked out on this computer.
//
// The browser's own speech recognition, on the device only (processLocally): the sound never
// leaves this computer, and nothing is sent to Google or anyone else. Where the browser can't
// promise that, there are no captions (there's no fallback to a server). Chrome 139 and later,
// and Edge, on a computer: the speech model is a one-time download the browser keeps (it runs
// on the processor, or the NPU where the browser's speech model can use one).
//
// It listens to a MediaStreamTrack (the program's sound), not a microphone. Each phrase gets a
// time from when its first words were heard, so the captions file (WebVTT) lines up with the
// recording; on the program itself the words appear as they're recognised.
//
// The parts with no browser in them (cutting phrases into captions, wrapping lines, the file)
// are plain functions, tested in test/captions.test.mjs.

/** Words appear a little after they're said: a phrase's first words, heard, were said about this much earlier (ms). */
export const LEAD = 400;
/** One caption: two lines of about 42 characters, as broadcast captions are. */
export const CUE_CHARS = 84;
/** On screen, a caption stays at least this long: about 15 characters a second, and at least 1.2 s. */
export const readMs = (text) => Math.max(1200, text.length * 66);

const SR = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

/**
 * Can this browser caption on the device, in this language?
 * 'available' (ready), 'downloadable' / 'downloading' (the model isn't here yet: install() gets it),
 * or 'unavailable' (not in this language, or not on the device: no captions here).
 */
// Some Chromium builds crash the whole page when asked whether they can recognise speech on the
// device (Playwright's, for one; Chrome itself answers). So a mark is left while asking: a page that
// died asking finds it on its next load and never asks again in this browser (the studio's
// captions and a call's both ask through here).
const PROBE = 'vm_captions_probe', CRASHED = 'vm_captions_crashed';
const lsGet = (k) => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const lsSet = (k, v) => { try { v == null ? globalThis.localStorage?.removeItem(k) : globalThis.localStorage?.setItem(k, v); } catch { /* (storage off) */ } };
if (lsGet(PROBE)) {
  lsSet(PROBE, null);
  lsSet(CRASHED, '1');
}
async function guarded(ask, no) {
  if (lsGet(CRASHED)) return no;
  lsSet(PROBE, '1');
  try {
    return await ask();
  } finally {
    lsSet(PROBE, null);
  }
}
export const captionSupport = (lang) => guarded(() => askSupport(lang), 'unavailable');
async function askSupport(lang) {
  const R = SR();
  if (!R || typeof R.available !== 'function') return 'unavailable';
  try {
    return await R.available({ langs: [lang], processLocally: true });
  } catch {
    return 'unavailable';
  }
}

/** Fetch the speech model for a language (once; the browser keeps it). Needs a click. True when it's ready. */
export const installCaptions = (lang) => guarded(() => askInstall(lang), false);
async function askInstall(lang) {
  const R = SR();
  if (!R || typeof R.install !== 'function') return false;
  try {
    return !!(await R.install({ langs: [lang], processLocally: true }));
  } catch {
    return false;
  }
}

/**
 * Cut one recognised phrase into captions of at most `max` characters, at word boundaries
 * (after a sentence's end or a comma where one falls in the second half), sharing out its time
 * by length.
 */
export function splitCue(text, t0, t1, max = CUE_CHARS) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks = [];
  let cur = [];
  const len = (ws) => ws.join(' ').length;
  for (const w of words) {
    if (cur.length && len([...cur, w]) > max) {
      // a better place to break, in the second half of what's here: after . ! ? or ,
      let at = -1;
      for (let i = cur.length - 1; i > 0 && len(cur.slice(0, i + 1)) > max / 2; i--) {
        if (/[.!?,;:]$/.test(cur[i])) { at = i + 1; break; }
      }
      if (at > 0) {
        chunks.push(cur.slice(0, at));
        cur = cur.slice(at);
      } else {
        chunks.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) chunks.push(cur);
  const texts = chunks.map((c) => c.join(' '));
  const total = texts.reduce((n, s) => n + s.length, 0);
  const out = [];
  let t = t0;
  for (const s of texts) {
    const d = ((t1 - t0) * s.length) / total;
    out.push({ t0: Math.round(t), t1: Math.round(t + d), text: s });
    t += d;
  }
  return out;
}

/** 00:01:02.345 */
export function vttTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000), m = Math.floor(t / 60_000) % 60, s = Math.floor(t / 1000) % 60, f = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
}

/**
 * A WebVTT file of the captions heard between `from` and `to` (on the same clock as the cues),
 * timed from `from`: the recording's first frame. Null if there are none.
 */
export function toVtt(cues, from, to = Infinity) {
  const inRange = cues.filter((c) => c.t1 > from && c.t0 < to && c.text.trim());
  if (!inRange.length) return null;
  const body = inRange.map((c, i) => {
    const a = Math.max(0, c.t0 - from), b = Math.max(a + 100, Math.min(c.t1, to) - from);
    // (a line of only "-->" or a blank line would break the file: neither can come from speech, but text is text)
    // (cue text is markup: & and < escaped; a voice tag says who's talking, when it's known)
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const said = esc(c.text.replace(/\n\s*\n/g, '\n'));
    const text = c.speaker ? `<v ${esc(c.speaker).replace(/[\n]/g, ' ')}>${said}` : said;
    return `${i + 1}\n${vttTime(a)} --> ${vttTime(b)}\n${text}`;
  });
  return `WEBVTT\n\n${body.join('\n\n')}\n`;
}

/** Wrap text into lines no wider than maxW, as measured by measure(text) (a canvas's measureText width). */
export function wrapLines(text, maxW, measure) {
  const lines = [];
  let line = '';
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? line + ' ' + w : w;
    if (line && measure(next) > maxW) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Live captions from a sound track. `clock()` is the studio's clock (ms); cues are on it.
 * onState(state, detail): 'listening', 'stopped', or 'error' (detail: what went wrong, in words).
 */
export class LiveCaptions {
  constructor({ lang, clock = () => performance.timeOrigin + performance.now(), onState = () => {}, speaker = () => '' }) {
    this.lang = lang;
    this.speaker = speaker; // who's talking now ('' if not known): face tracking's Speaker 1, or a name
    this.clock = clock;
    this.onState = onState;
    this.cues = [];          // finished captions: { t0, t1, text }
    this.recent = [];        // what's on screen: { text, at } (finished phrases, newest last)
    this.interim = '';       // the phrase being heard now, as recognised so far
    this.changed = 0;        // when what's on screen last changed (clock)
    this.running = false;
    this.rec = null;
    this.quickEnds = 0;
    // what the recogniser has said it's doing, for the show log: a recogniser that hears nothing
    // says nothing, so each first is logged (onState('log', words))
    this.stats = { sessions: 0, audio: 0, sound: 0, speech: 0, results: 0, startedAt: 0, lastResult: 0, errors: {} };
  }

  /** Start listening to a track (the program's sound), or with none, to the browser's own microphone. */
  start(track) {
    if (this.running) return;
    this.track = track;
    this.running = true;
    this.quickEnds = 0;
    this.listen();
  }

  stop() {
    this.running = false;
    clearTimeout(this.again);
    const r = this.rec;
    this.rec = null;
    try { r?.abort(); } catch { /* (already ended) */ }
    this.flushInterim();
    this.onState('stopped');
  }

  /** Forget everything heard (a new show). */
  clear() {
    this.cues = [];
    this.recent = [];
    this.interim = '';
    this.changed = this.clock();
  }

  /** What to show now: the last phrases and the one being heard, or '' once nothing's been said for holdMs. */
  text(holdMs = 4000) {
    const t = this.clock();
    if (!this.interim && t - this.changed > holdMs) return '';
    this.recent = this.recent.filter((r) => t - r.at < 8000).slice(-3);
    // (a new speaker's words start with their name, as broadcast captions mark a change of speaker)
    const parts = [...this.recent, ...(this.interim ? [{ text: this.interim, speaker: this.speaker() }] : [])];
    let who = null;
    return parts.map((r, i) => {
      const s = r.speaker || '';
      const tag = s && (i === 0 || s !== who) ? `${s}: ` : '';
      who = s;
      return tag + r.text;
    }).filter(Boolean).join(' ');
  }

  // ---- one session of the recogniser; it ends now and then by itself, and starts again ----
  listen() {
    const R = SR();
    if (!R) return this.fail('this browser has no speech recognition');
    const rec = new R();
    this.rec = rec;
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.processLocally = true; // (on this computer only: never sent to a server)
    const first = new Map(); // result index → when its first words were heard
    const done = new Set();
    const began = this.clock();
    const st = this.stats;
    st.sessions++;
    st.startedAt ||= began;
    const firstTime = (k, words) => {
      if (rec !== this.rec) return;
      if (!st[k]++) this.onState('log', words);
    };
    rec.onaudiostart = () => firstTime('audio', 'the recogniser is getting sound');
    rec.onsoundstart = () => firstTime('sound', 'the recogniser hears sound');
    rec.onspeechstart = () => firstTime('speech', 'the recogniser hears speech');
    rec.onresult = (e) => {
      if (rec !== this.rec) return;
      const t = this.clock();
      if (!st.results++) this.onState('log', 'the first words are recognised');
      st.lastResult = t;
      let interim = '', from = null;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const said = (res[0]?.transcript || '').trim();
        if (!first.has(i)) first.set(i, t);
        if (res.isFinal) {
          if (done.has(i)) continue;
          done.add(i);
          if (said) this.addPhrase(said, first.get(i) - LEAD, t);
        } else {
          interim += (interim ? ' ' : '') + said;
          from ??= first.get(i);
        }
      }
      if (interim !== this.interim) {
        this.interim = interim;
        this.interimAt = from ?? t;
        this.changed = t;
      }
    };
    rec.onerror = (e) => {
      if (rec !== this.rec) return;
      const n = (st.errors[e.error] = (st.errors[e.error] || 0) + 1);
      if (n === 1 || n === 10 || n === 100) this.onState('log', `the recogniser says "${e.error}"${e.message ? ` (${e.message})` : ''}${n > 1 ? `, ${n} times now` : ''}`);
      const why = {
        'not-allowed': 'the browser didn’t allow speech recognition here',
        'service-not-allowed': 'the browser can’t recognise speech on this computer',
        'language-not-supported': `the speech model for ${this.lang} isn’t here`,
        'audio-capture': 'the program’s sound couldn’t be read',
      }[e.error];
      if (why) this.fail(why); // ('no-speech', 'network', 'aborted': it starts again, below)
    };
    rec.onend = () => {
      if (rec !== this.rec || !this.running) return;
      if (st.sessions <= 3) this.onState('log', `the recogniser stopped after ${Math.round((this.clock() - began) / 1000)} s${st.results ? '' : ', with nothing recognised'}: starting it again`);
      this.flushInterim();
      // (ends straight away, again and again: something's wrong; don't spin)
      this.quickEnds = this.clock() - began < 1500 ? this.quickEnds + 1 : 0;
      if (this.quickEnds >= 5) return this.fail('speech recognition keeps stopping');
      this.again = setTimeout(() => this.running && this.listen(), this.quickEnds ? 1000 : 50);
    };
    try {
      if (this.track) rec.start(this.track);
      else rec.start(); // (the browser's own microphone: its default one)
      this.onState('listening');
    } catch (e) {
      this.fail(e?.message || String(e));
    }
  }

  addPhrase(text, t0, t1) {
    const prev = this.cues.at(-1);
    const chunks = splitCue(text, Math.max(t0, prev ? prev.t0 + 100 : t0), Math.max(t1, t0 + 100));
    for (const c of chunks) {
      // shown long enough to read, but not still up when the next caption starts
      c.t1 = Math.max(c.t1, c.t0 + readMs(c.text));
      const last = this.cues.at(-1);
      if (last && last.t1 > c.t0) last.t1 = Math.max(last.t0 + 700, c.t0);
      const who = this.speaker();
      if (who) c.speaker = who;
      this.cues.push(c);
    }
    const t = this.clock();
    this.recent.push({ text, at: t, speaker: this.speaker() });
    if (this.interim) this.interim = '';
    this.changed = t;
  }

  /** A phrase cut off by the recogniser ending: kept as it was heard. */
  flushInterim() {
    if (!this.interim) return;
    const t = this.clock();
    this.addPhrase(this.interim, (this.interimAt ?? t) - LEAD, t);
  }

  fail(why) {
    this.running = false;
    clearTimeout(this.again);
    const r = this.rec;
    this.rec = null;
    try { r?.abort(); } catch { /* (already ended) */ }
    this.onState('error', why);
  }
}
