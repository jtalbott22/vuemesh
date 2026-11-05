// Studio, part 25 of 25: one timeline for every camera and microphone on this computer.
// Loads after showlog.js: that import comes first, so the parts run in order (see ../studio.js).
import './showlog.js';
import { toast, esc } from '/js/vm.js';
import { bgInterval } from '/js/bgclock.js';
import { DEFAULT_LATENCY, PictureDelay, latencyFromCheck, pictureOnset, pick, soundOnset } from '/js/framesync.js';
import { FrameBuffer, SoundTap, TAP_RATE } from '/js/framebuffer.js';
import { offsetBetween } from '/js/audiosync.js';
import { $, EDIT_ONLY, live, note, player, program } from './core.js';
import { output } from './clips.js';
import { progRec } from './switcher.js';
import { streamOut } from './stream.js';
import { showLog } from './showlog.js';

// See /js/framesync.js. Every camera and screen on this computer is held back to one picture
// delay (P), so a cut never moves the program in time and it lines up with any other recording
// of the room at one offset; sound from this computer waits P too. P is set from the slowest
// camera's measured delay with a frame to spare; it only goes up during a show (logged), and
// settles between shows. Each camera's own delay (inside it: sensor, compression) starts at a
// usual figure and the sync check measures it (a clap); it's kept per camera, on this computer.
// Microphones are lined up with each other by their sound, all the time (GCC-PHAT on what they
// all hear), against the main microphone.

const LAT_KEY = 'vm_camlatency';
const SOUND_IN_MS = 10; // a microphone's sound into the mixer, after it's taken
const SETTLE_MS = 15_000; // the first seconds: the measurements settle (not news)
let since = 0, settled = false;
const latSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(LAT_KEY) || '{}');
  } catch {
    return {};
  }
};
const deviceKey = (l) => l.deviceId || l.deviceLabel || l.name;
/** A camera's own delay, sensor to arrival (ms): measured by the sync check, or a usual figure. */
export const latencyOf = (l) => latSaved()[deviceKey(l)] ?? (l.screen ? 1000 / output.fps : DEFAULT_LATENCY);

export const buffers = new Map(); // peer → FrameBuffer
const taps = new Map(); // peer → SoundTap
const delay = new PictureDelay({ fps: output.fps });
export let pictureDelay = null; // P (ms), once there's a camera here
const soundOffset = new Map(); // peer → how much later its sound comes than the main mic's (ms)
const stalledSince = new Map();

const isCam = (l) => l.local && l.role !== 'mic' && l.stream?.getVideoTracks().some((t) => t.readyState === 'live');
const liveAudio = (l) => l.stream?.getAudioTracks().find((t) => t.readyState === 'live');

/** The picture to put on air for a camera now (its frame of the moment now - P), or null to use its video element. */
export function picOf(peer) {
  const b = buffers.get(peer), l = live.get(peer);
  if (!b || !l || pictureDelay == null || !b.frames.length) return null;
  const lat = latencyOf(l), lag = b.lag;
  if (lag == null) return null;
  const target = performance.now() - pictureDelay;
  const r = pick(b.frames.map((f) => ({ moment: f.ts + lag - lat, f })), target);
  return r.frame?.f.bmp || null;
}
/** A camera here is still sending pictures (for the break slate: the page's video element stops showing new frames while hidden). */
export function camSending(peer, stallMs) {
  const b = buffers.get(peer);
  return b ? b.silentFor() < stallMs : null;
}

/** How long this computer's sound from `peer` waits to stay with the pictures (ms), or null (not lined up here). */
export function syncedSoundDelay(peer) {
  if (pictureDelay == null) return null;
  const l = live.get(peer);
  if (!l?.local || l.screen) return null;
  // (the mixer hears a microphone on the sound thread, a few ms after it's taken, however busy
  // the page is; how far it is behind the main mic comes from their sound)
  return Math.round(Math.max(0, Math.min(800, pictureDelay - SOUND_IN_MS - (soundOffset.get(peer) || 0))));
}

function keepUp() {
  // a buffer for every camera here, a tap for every microphone (and camera with sound)
  for (const [peer, l] of live) {
    if (isCam(l) && !buffers.has(peer)) {
      const track = l.stream.getVideoTracks().find((t) => t.readyState === 'live');
      buffers.set(peer, new FrameBuffer(track.clone(), { size: () => ({ w: program.width, h: program.height }) }));
    }
    const at = l.local && !l.screen ? liveAudio(l) : null;
    if (at && taps.get(peer)?.track?.readyState !== 'live') {
      taps.get(peer)?.stop();
      taps.set(peer, new SoundTap(at.clone()));
    }
  }
  for (const [peer, b] of buffers) if (!live.has(peer) || b.track.readyState === 'ended') {
    b.stop();
    buffers.delete(peer);
  }
  for (const [peer, t] of taps) if (!live.has(peer)) {
    t.stop();
    taps.delete(peer);
  }
  if (!buffers.size) {
    pictureDelay = null;
    settled = false;
    return;
  }
  // the program's picture delay: the slowest camera's, a frame to spare
  delay.fps = output.fps;
  const need = [...buffers].map(([p, b]) => latencyOf(live.get(p)) + b.spread);
  const quiet = !progRec && !streamOut;
  const was = pictureDelay;
  if (was == null) since = performance.now();
  const settling = performance.now() - since < SETTLE_MS;
  const r = quiet && was != null && Math.max(...need) + 1000 / output.fps < was - 10 ? delay.reset(need) : delay.update(need);
  pictureDelay = r.P;
  for (const [, b] of buffers) b.keepMs = pictureDelay + 120; // (the moment on air and a few frames either side: at 1080p a frame is 8 MB)
  if (settling) {
    if (!settled && performance.now() - since >= SETTLE_MS - 600) {
      settled = true;
      note(`Pictures from this computer's cameras line up at ${pictureDelay} ms behind the moment (sound waits the same)`);
    }
  } else if (!settled) {
    settled = true;
    note(`Pictures from this computer's cameras line up at ${pictureDelay} ms behind the moment (sound waits the same)`);
  } else if (r.raised) note(`A camera slowed down: every picture now ${pictureDelay} ms behind (was ${was} ms)`);
  else if (pictureDelay < was) note(`Between shows: pictures now ${pictureDelay} ms behind (was ${was} ms)`);
  // a camera that's stopped sending: held at its last picture, and said once
  for (const [peer, b] of buffers) {
    const l = live.get(peer), quietMs = b.silentFor();
    if (quietMs > 1000 && !stalledSince.has(peer)) {
      stalledSince.set(peer, Date.now());
      showLog.event('picture', `${l.name} stopped sending pictures: holding its last one`);
    } else if (quietMs < 300 && stalledSince.has(peer)) {
      showLog.event('picture', `${l.name} is sending pictures again (${Math.round((Date.now() - stalledSince.get(peer)) / 1000)} s without)`);
      stalledSince.delete(peer);
    }
  }
}

// ---- microphones lined up by their sound, against the main one ----
function mainMic() {
  const mics = [...taps].filter(([p]) => live.get(p)?.role === 'mic');
  return (mics.length ? mics : [...taps])[0] || null;
}
function matchSound() {
  const main = mainMic();
  if (!main) return;
  const [refPeer, ref] = main;
  const to = Math.min(...[...taps.values()].map((t) => t.newest ?? 0)) - 200;
  const from = to - 6000;
  if (!(to > 0)) return;
  const a = ref.slice(from, to);
  for (const [peer, tap] of taps) {
    if (peer === refPeer) {
      soundOffset.set(peer, 0);
      continue;
    }
    const b = tap.slice(from, to);
    const m = offsetBetween(a, b, Math.round(0.3 * TAP_RATE));
    if (m.score < 12 || m.clarity < 1.4) continue; // (not the same sound clearly enough: keep what we had)
    const ms = (-m.lag * 1000) / TAP_RATE;
    const was = soundOffset.get(peer);
    const now = was == null ? ms : was * 0.7 + ms * 0.3;
    soundOffset.set(peer, now);
    if (was == null || Math.abs(now - was) > 15) showLog.event('sound-sync', `${live.get(peer)?.name}'s sound is ${Math.round(now)} ms ${now >= 0 ? 'behind' : 'ahead of'} ${live.get(refPeer)?.name}'s`);
  }
}

// ---- the sync check: clap once where every camera can see it ----
let checking = null, lastCheck = null;
export function syncCheck() {
  if (checking) return checking;
  if (!buffers.size) return void toast('The sync check is for cameras plugged into this computer: none yet');
  const main = mainMic();
  if (!main) return void toast('The sync check needs a microphone on this computer to hear the clap');
  const box = $('#soundAlert');
  const say = (html) => {
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<span class="sa-text">${html}</span>`;
  };
  checking = (async () => {
    const start = performance.now();
    for (const b of buffers.values()) {
      b.series = [];
      b.watching = true;
    }
    for (let s = 3; s > 0; s--) {
      say(`Sync check: clap once, sharply, where every camera can see your hands. Listening… ${s}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    say('Sync check: clap now');
    await new Promise((r) => setTimeout(r, 4000));
    const end = performance.now();
    const [refPeer, ref] = main;
    const heard = soundOnset(ref.slice(start, end), TAP_RATE, start);
    const results = [];
    if (heard.strength < 15) {
      say('Sync check: no clap heard. Try again, closer to the microphone.');
      setTimeout(() => box && (box.hidden = true), 5000);
      return null;
    }
    // the clap's moment: when the main microphone took it (its sound's own stamps are capture times)
    const moment = heard.t;
    const saved = latSaved();
    lastCheck = { heard: Math.round(heard.t), strength: Math.round(heard.strength), cams: [] }; // (diagnostics: what the check saw)
    for (const [peer, b] of buffers) {
      const l = live.get(peer);
      const was = latencyOf(l), lag = b.lag;
      const series = b.series.map((x) => ({ moment: x.ts + lag - was, change: x.change }));
      // (a camera sees it from a little before it's heard (its old figure too high) to half a second after (too low): only there)
      const seen = pictureOnset(series.filter((x) => x.moment >= moment - 150 && x.moment <= moment + 600), moment + 225, 400);
      if (!seen || seen.strength < 4) {
        results.push(`${esc(l.name)}: didn't see it`);
        continue;
      }
      const lat = Math.max(0, Math.min(1000, latencyFromCheck(was, seen.t, moment)));
      lastCheck.cams.push({ name: l.name, was: Math.round(was), seen: Math.round(seen.t), strength: Math.round(seen.strength), latency: lat });
      saved[deviceKey(l)] = lat;
      results.push(`${esc(l.name)} ${lat} ms`);
    }
    localStorage.setItem(LAT_KEY, JSON.stringify(saved));
    if (!progRec && !streamOut) delay.reset([...buffers].map(([p, b]) => latencyOf(live.get(p)) + b.spread));
    keepUp();
    const text = `Sync check (heard by ${live.get(refPeer)?.name}): ${results.join(', ')}. Pictures line up at ${pictureDelay} ms.`;
    note(text.replace(/<[^>]+>/g, ''));
    showLog.event('sync-check', text.replace(/<[^>]+>/g, ''));
    say(`✓ ${text}`);
    setTimeout(() => box && (box.hidden = true), 8000);
    renderSync();
    return results;
  })().finally(() => {
    checking = null;
    for (const b of buffers.values()) b.watching = false;
  });
  return checking;
}
function renderSync() {
  const p = $('#syncState');
  if (!p) return;
  const cams = [...buffers.keys()].map((peer) => live.get(peer)).filter(Boolean);
  const saved = latSaved();
  p.textContent = !cams.length ? 'For cameras plugged into this computer; none yet.'
    : `Every picture is ${pictureDelay} ms behind the moment, from every camera, so a cut never jumps. Each camera: ${cams.map((l) => `${l.name} ${Math.round(latencyOf(l))} ms${saved[deviceKey(l)] == null ? ' (usual; run the sync check)' : ''}`).join(', ')}.`;
}
$('#syncBtn')?.addEventListener('click', () => syncCheck());
window.vmSync = () => ({ P: pictureDelay, check: lastCheck, cams: [...buffers].map(([p, b]) => ({ peer: p, name: live.get(p)?.name, lag: b.lag, spread: b.spread, latency: latencyOf(live.get(p)), frames: b.frames.length, count: b.count, quiet: Math.round(b.silentFor()) })), sound: [...soundOffset].map(([p, ms]) => ({ peer: p, ms: Math.round(ms), delay: syncedSoundDelay(p) })) }); // (tests and diagnostics)
window.vmSyncCheck = syncCheck;
window.vmEngine = () => player.ctx; // (tests: the sound engine, to pause it as a device change can)
window.vmSyncClear = () => localStorage.removeItem(LAT_KEY);

if (!EDIT_ONLY) {
  bgInterval(() => {
    keepUp();
    renderSync();
  }, 500);
  bgInterval(matchSound, 10_000);
}
