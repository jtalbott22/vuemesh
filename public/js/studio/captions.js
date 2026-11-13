// Studio, part 27 of 29: live captions of the program's sound.
// Loads after pip.js: that import comes first, so the parts run in order (see ../studio.js).
//
// What's said on the program, as text, worked out on this computer by the browser's own
// speech recognition (on the device only: the sound is never sent anywhere; see /js/captions.js).
// The captions go on the program (so they're on TVs, the stream and the recording too, unless
// "On the program" is off), and Record program saves them beside the video as a WebVTT file.
import './pip.js';
import { LiveCaptions, captionSupport, installCaptions, toVtt, wrapLines } from '/js/captions.js';
import { announce, now, toast } from '/js/vm.js';
import { $, EDIT_ONLY, note, player } from './core.js';
import { mix, mixInit } from './mixer.js';
import { speakerNow } from './faces.js';

const KEY = 'vm_captions';
const LANGS = [
  ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)'],
  ['es-ES', 'Español (España)'], ['es-US', 'Español (EE. UU.)'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'], ['nl-NL', 'Nederlands'], ['pl-PL', 'Polski'],
  ['ja-JP', '日本語'], ['ko-KR', '한국어'], ['zh-CN', '中文（简体）'], ['hi-IN', 'हिन्दी'],
];
const langName = (l) => LANGS.find(([id]) => id === l)?.[1] || l;

let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* (unreadable: the defaults) */ }
const browserLang = () => {
  const l = navigator.language || 'en-US';
  return LANGS.find(([id]) => id === l)?.[0] || LANGS.find(([id]) => id.split('-')[0] === l.split('-')[0])?.[0] || l;
};
/** on: wanted; show: drawn on the program; engine: listening now; past: captions from earlier in this show. */
export var cap = { on: !!saved.on, show: saved.show !== false, lang: saved.lang || browserLang(), src: saved.src === 'mic' ? 'mic' : 'program', engine: null, past: [] };
const save = () => localStorage.setItem(KEY, JSON.stringify({ on: cap.on, show: cap.show, lang: cap.lang, src: cap.src }));

// (asking whether this browser can recognise speech is guarded there: some Chromium builds crash
// the page when asked, and then it isn't asked again; CRASHED below is that mark)
const CRASHED = 'vm_captions_crashed';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

const allCues = () => [...cap.past, ...(cap.engine?.cues || [])];
/** The captions heard between two moments (the studio's clock), as a WebVTT file timed from the first; null if none. */
export const captionsVtt = (from, to) => toVtt(allCues(), from, to);

// ---- on the program: up to two lines, centred near the bottom, under a lower third ----
let lastText = '', lastLines = [], lastFont = '';
export function drawCaptions(g, W, H) {
  if (!cap?.engine || !cap.show) return; // (cap: var, as a frame can be drawn before this part has loaded)
  const text = cap.engine.text();
  if (!text) return;
  const u = Math.min(W, H);
  const fs = Math.round(u * 0.045);
  const font = `600 ${fs}px Archivo, system-ui, sans-serif`;
  g.save();
  g.font = font;
  if (text !== lastText || font !== lastFont) {
    // (the newest two lines: older words roll off the top, as broadcast captions do)
    lastLines = wrapLines(text, W * 0.84, (s) => g.measureText(s).width).slice(-2);
    lastText = text;
    lastFont = font;
  }
  const lh = fs * 1.3, padX = fs * 0.5, padY = fs * 0.22;
  const bw = Math.max(...lastLines.map((l) => g.measureText(l).width)) + padX * 2;
  const bh = lastLines.length * lh + padY * 2;
  const bx = (W - bw) / 2, by = H - u * 0.04 - bh;
  g.fillStyle = '#000000cc';
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lastLines.forEach((l, i) => g.fillText(l, W / 2, by + padY + lh * (i + 0.5)));
  g.restore();
}

// ---- turning them on and off ----
const say = (s) => { const el = $('#capState'); if (el) el.textContent = s; };
const NOT_HERE = 'Captions need Chrome 139 or later, or Edge, on a computer, with on-device speech recognition for this language. Nothing is sent anywhere to make them.';

function stopEngine() {
  if (!cap.engine) return;
  const e = cap.engine;
  cap.engine = null;
  e.stop(); // (first: it keeps the phrase being heard as a caption)
  cap.past.push(...e.cues);
}

/** Start or stop live captions. byHand: from a click (the speech model can only be fetched then). */
async function setCaptions(on, byHand = false) {
  cap.on = on;
  save();
  if ($('#capOn')) $('#capOn').checked = on;
  if (!on) {
    if (cap.engine) {
      stopEngine();
      note('Captions off');
      announce('Captions off');
    }
    say('');
    return;
  }
  if (cap.engine) return;
  const lang = cap.lang;
  let st = await captionSupport(lang);
  if (st === 'downloadable' || st === 'downloading') {
    if (!byHand) {
      say(`Turn on Live captions to get the speech model for ${langName(lang)} (once; the browser keeps it).`);
      cap.on = false;
      if ($('#capOn')) $('#capOn').checked = false;
      return;
    }
    say(`Getting the speech model for ${langName(lang)} (once; the browser keeps it)…`);
    st = (await installCaptions(lang)) ? 'available' : await captionSupport(lang);
  }
  if (!cap.on || cap.engine || lang !== cap.lang) return; // (turned off, or another language picked, while it waited)
  if (st !== 'available') {
    cap.on = false;
    save();
    if ($('#capOn')) $('#capOn').checked = false;
    say(NOT_HERE);
    if (byHand) toast(`Live captions aren’t available in this browser for ${langName(lang)}`, 8000);
    return;
  }
  mixInit();
  player.ctx.resume?.().catch?.(() => {});
  // what it listens to: the program's sound (what's on air), or the microphone directly (the way
  // browsers have recognised speech for years: for a browser that hears nothing in the program's)
  const track = cap.src === 'mic' ? null : mix.dest.stream.getAudioTracks()[0];
  const what = cap.src === 'mic' ? 'this computer’s microphone' : 'the program’s sound';
  const engine = new LiveCaptions({
    lang, clock: now, speaker: speakerNow, // (face tracking's Speaker 1, 2… or their names: see faces.js)
    onState: (state, why) => {
      if (cap.engine !== engine) return;
      if (state === 'listening') say(`Listening to ${what}, in ${langName(lang)}, on this computer only.`);
      else if (state === 'log') note(`Captions: ${why}`);
      else if (state === 'error') {
        stopEngine();
        cap.on = false;
        save();
        if ($('#capOn')) $('#capOn').checked = false;
        say(`Captions stopped: ${why}.`);
        note(`Captions stopped: ${why}`);
        toast(`Live captions stopped: ${why}`, 8000);
      }
    },
  });
  cap.engine = engine;
  engine.start(track);
  note(`Captions on (${langName(lang)}, listening to ${what}, on this computer)`);
  announce('Captions on');
}

window.vmCaptions = () => ({ on: cap.on, show: cap.show, lang: cap.lang, src: cap.src, listening: !!cap.engine?.running, cues: allCues().length, text: cap.engine?.text() || '', stats: cap.engine?.stats || null }); // (tests and diagnostics)

// ---- listening, and nothing recognised: say so, and what to try ----
// (the program's sound, measured here: sound there and nothing recognised for 20 s is worth a word)
let progLevel = null, loudFor = 0, warned = false, lastSince = 0;
const lvBuf = new Float32Array(1024);
setInterval(() => {
  const e = cap?.engine;
  if (!e?.running) { loudFor = 0; warned = false; return; }
  if (!progLevel && mix.out) {
    progLevel = mix.out.context.createAnalyser();
    progLevel.fftSize = 1024;
    mix.out.connect(progLevel);
  }
  if (!progLevel) return;
  // (counted afresh from when it started, or the last words recognised)
  const since = Math.max(e.stats.startedAt, e.stats.lastResult);
  if (since !== lastSince) [lastSince, loudFor, warned] = [since, 0, false];
  progLevel.getFloatTimeDomainData(lvBuf);
  let ss = 0;
  for (let i = 0; i < lvBuf.length; i++) ss += lvBuf[i] * lvBuf[i];
  if (Math.sqrt(ss / lvBuf.length) > 0.01) loudFor++; // (about -40 dB: someone talking, not room noise)
  if (warned || now() - since < 20_000 || loudFor < 4) return;
  warned = true;
  const st = e.stats;
  const heard = st.speech ? 'it heard speech but recognised none' : st.sound ? 'it heard sound but no speech' : st.audio ? 'it got sound but heard nothing in it' : 'it hasn’t said it’s getting any sound';
  const tip = cap.src === 'mic' ? 'Check this computer’s microphone is the system’s default one.' : 'Try Listen to: this computer’s microphone.';
  say(`Nothing recognised in 20 s, though there’s sound on the program (${heard}). ${tip}`);
  note(`Captions: nothing recognised in 20 s with sound on the program; ${heard}`);
}, 2500);

if (!EDIT_ONLY && $('#capOn')) {
  const sel = $('#capLang');
  const opts = LANGS.some(([id]) => id === cap.lang) ? LANGS : [[cap.lang, cap.lang], ...LANGS];
  sel.replaceChildren(...opts.map(([id, name]) => Object.assign(document.createElement('option'), { value: id, textContent: name })));
  sel.value = cap.lang;
  $('#capShow').checked = cap.show;
  $('#capSrc').value = cap.src;
  $('#capSrc').addEventListener('change', (e) => {
    cap.src = e.target.value === 'mic' ? 'mic' : 'program';
    save();
    note(`Captions listen to ${cap.src === 'mic' ? 'this computer’s microphone' : 'the program’s sound'}`);
    if (cap.on) {
      stopEngine();
      setCaptions(true, true);
    }
  });
  $('#capOn').checked = cap.on;
  $('#capOn').addEventListener('change', (e) => setCaptions(e.target.checked, true));
  $('#capShow').addEventListener('change', (e) => {
    cap.show = e.target.checked;
    save();
    note(cap.show ? 'Captions shown on the program' : 'Captions kept off the program (still saved with Record program)');
  });
  sel.addEventListener('change', () => {
    cap.lang = sel.value;
    save();
    if (cap.on) {
      stopEngine();
      setCaptions(true, true);
    }
  });
  // (on last time: back on, if the model's already here; fetching it waits for a click)
  if (cap.on) setCaptions(true);
  else if (lsGet(CRASHED)) say(NOT_HERE);
}
