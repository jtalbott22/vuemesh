// Studio, part 7 of 26: this computer's cameras, mics, screen and sound; recording; moderation.
// Loads after mixer.js: that import comes first, so the parts run in order (see ../studio.js).
import './mixer.js';
import { api, toast, esc, now } from '/js/vm.js';
import { snapToCamera } from '/js/camctl.js';
import * as idb from '/js/idb.js';
import {
  $, askName, black, clips, EDIT_ONLY, eventId, hub, isHost, key, KIOSK, live, liveActive, note,
  player, REC_MIMES, recMime, seq, setLiveActive,
} from './core.js';
import { addClip, noteAngle, rebuild } from './clips.js';
import { renderLive } from './live.js';
import { syncTally } from './onair.js';
import { mixAttach, mixDetach, renderMixer } from './mixer.js';
import { ccuSync } from './ccu.js';
import { myOs } from './stream.js';
import { mediaOn, onBreak } from './graphics.js';
import { progRec, pvw, setPreview, sw, swActive } from './switcher.js';
import { renderTimeline } from './edit.js';
import { renderMedia } from './library.js';
import { pipAir } from './pip.js';

// ------------------------------------------------- sources on this computer ---
// The studio computer's own cameras (the built-in FaceTime camera, USB cameras, capture
// cards) and microphones are sources like any phone: a tile with a number, on air or in
// preview, Camera control (through the camera's own controls, where it has them), the
// mixer, and recordings that land in Edit. They need no beacon: they run on the studio's
// own clock, so they're in sync from the start. A camera records while it's on air (with
// "Cameras record while they're on air"), or from its menu until you stop it; a microphone
// records the whole time it's in the show. Recordings roll every 5 minutes so nothing big
// waits in memory. The ones you add come back next time this studio opens.
const LOCAL_KEY = 'vm_local_sources';
const hashStr = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
};
const cleanLabel = (s) => String(s || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^Default - /, '').trim();
function saveLocalList() {
  const list = [...live].filter(([, l]) => l.local && !l.screen && !l.splitOf).map(([p, l]) => ({ kind: l.role, deviceId: l.deviceId, label: l.deviceLabel, name: l.wholeName || l.name, micId: l.micId || null, micLabel: l.micLabel || null, sound: l.role === 'cam' ? !!l.micId : undefined, ...(l.side ? { split: { L: l.name, R: live.get(halfOf(p))?.name || null } } : {}) }));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}
// A camera on this computer brings its sound, as a phone does: the microphone in the same
// device (a USB webcam's own mic, which the browser groups with it), else one whose name
// matches, else the computer's own microphone (a built-in camera like the FaceTime camera has
// no mic of its own). The picker shows which, and it can be changed or turned off.
// Always a microphone by name, never the computer's "Default": that follows whatever was plugged
// in last, so a USB interface plugged in mid-show became the webcam's sound behind its back (and
// on Linux, two inputs of one interface open at once leaves one silent: see sharedInterface).
const MIC_OPTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
function soundFor(cam, devs) {
  const mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  const real = mics.filter((d) => d.deviceId !== 'default');
  const words = (s) => cleanLabel(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['camera', 'microphone', 'audio', 'video', 'webcam', 'usb', 'default'].includes(w));
  const camWords = words(cam.label);
  // the device "Default" is right now, where the browser says (a Mac and Windows: "Default - MacBook Pro Microphone"; Linux doesn't)
  const def = mics.find((m) => m.deviceId === 'default');
  const defLabel = def && cleanLabel(def.label);
  const isDefault = def && real.find((m) => (defLabel && defLabel !== 'Default' && cleanLabel(m.label) === defLabel) || (def.groupId && m.groupId === def.groupId));
  return (
    real.find((m) => cam.groupId && m.groupId === cam.groupId) ||
    real.find((m) => camWords.length && words(m.label).some((w) => camWords.includes(w))) ||
    isDefault ||
    real.find((m) => /built-?in|internal|macbook/i.test(m.label)) ||
    real[0] ||
    def ||
    null
  );
}
// How big this computer's cameras capture (per computer): 1080p, or 720p, which is far lighter on
// USB (three webcams at 1080p can be more than a computer's USB takes, and sound from the same
// ports suffers first). Changed, the cameras in the show change at once.
const CAMSIZE_KEY = 'vm_localcamsize';
export const camCapture = () => (localStorage.getItem(CAMSIZE_KEY) === '720' ? 720 : 1080);
const camSize = () => {
  const h = camCapture();
  return { width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate: { ideal: 30 } };
};
export async function setCamCapture(h) {
  localStorage.setItem(CAMSIZE_KEY, String(h === 720 ? 720 : 1080));
  for (const [, l] of live) {
    if (!l.local || l.role === 'mic' || l.screen) continue;
    const t = l.stream.getVideoTracks()[0];
    await t?.applyConstraints(camSize()).catch(() => {});
  }
  renderCamCapture();
  note(`This computer's cameras capture at ${camCapture()}p`);
}
export function renderCamCapture() {
  const sel = $('#camSize'), hint = $('#camSizeHint');
  if (!sel) return;
  sel.value = String(camCapture());
  const n = [...live.values()].filter((l) => l.local && l.role !== 'mic' && !l.screen).length;
  if (hint) hint.textContent = n >= 3 && camCapture() === 1080 ? `${n} cameras at 1080p is a lot for one computer's USB: if pictures stutter or the sound crackles, try 720p.` : '';
}
$('#camSize')?.addEventListener('change', (e) => setCamCapture(Number(e.target.value)));
renderCamCapture();

// Which microphone a camera here takes its sound from, once chosen in the mixer (Sound from):
// kept per camera on this computer, and used whenever that camera is added again.
const CAMSOUND_KEY = 'vm_camsound';
const camSoundSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(CAMSOUND_KEY) || '{}');
  } catch {
    return {};
  }
};
async function addLocalSource(kind, deviceId, name, quiet, micId) {
  if (kind === 'cam' && micId === undefined) {
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cam = devs.find((d) => d.deviceId === deviceId);
    const chosen = camSoundSaved()[deviceId];
    const kept = chosen && (chosen.micId === null ? { deviceId: null } : devs.find((d) => d.kind === 'audioinput' && (d.deviceId === chosen.micId || (chosen.label && cleanLabel(d.label) === chosen.label))));
    micId = kept ? kept.deviceId : cam ? soundFor(cam, devs)?.deviceId || null : null;
  }
  const constraints = kind === 'mic'
    ? { audio: { deviceId: { exact: deviceId }, ...MIC_OPTS } }
    : { video: { deviceId: { exact: deviceId }, ...camSize() }, ...(micId ? { audio: { deviceId: { exact: micId }, ...MIC_OPTS } } : {}) };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (kind !== 'cam' || !micId) throw e;
    // the camera without its sound, rather than not at all (the mic may be busy or gone)
    stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video });
    toast(`Added without sound: its microphone isn't available (${e.message})`, 6000);
    micId = null;
  }
  return registerLocal(kind, stream, { deviceId, name, quiet, micId });
}
/** A source on this computer, from a stream already open (a camera, a microphone, a shared screen or the computer's sound). */
function registerLocal(kind, stream, { deviceId, name, quiet, micId, screen, label: given } = {}) {
  const track = kind === 'mic' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  const label = given || cleanLabel(track.label) || (kind === 'mic' ? 'Microphone' : 'Camera');
  const peer = `local-${kind}-${hashStr(deviceId)}`;
  if (live.has(peer)) {
    stream.getTracks().forEach((t) => t.stop());
    return quiet ? null : toast(`${label} is already in the show`);
  }
  // its identity comes from the device itself, not its name: three of the same webcam are three
  // cameras (named Logitech BRIO, Logitech BRIO 2, Logitech BRIO 3)
  const cid = 'L' + hashStr(`${kind}:${deviceId}`).slice(0, 10);
  if (!name) {
    const same = [...live.values()].filter((x) => x.local && x.deviceLabel === label).length;
    if (same) name = `${label} ${same + 1}`;
  }
  const micTrack = kind === 'cam' ? stream.getAudioTracks()[0] : null;
  live.set(peer, { stream, role: kind, name: name || label, cid, local: true, screen: !!screen, deviceId, deviceLabel: label, micId: micTrack ? micId : null, micLabel: micTrack ? cleanLabel(micTrack.label) : null, route: 'local', fixed: true, joinedAt: Date.now() });
  if (kind !== 'mic') noteAngle(cid);
  // a device that stops (a USB interface dropping out, a camera's driver hiccuping) is opened
  // again into the same source, so its mixer channel, sound mode and recording carry on
  watchLocal(peer, track, 'main');
  if (micTrack) watchLocal(peer, micTrack, 'sound');
  mixAttach(peer);
  if (kind === 'cam') localCamState(peer);
  renderLive();
  renderMixer();
  saveLocalList();
  if (kind === 'mic') !KIOSK && startLocalRec(peer);
  else localRecFollow();
  note(`${label} added from this computer${micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : kind === 'cam' ? ', without sound' : ''}`);
  if (!quiet) toast(`${live.get(peer).name} is in the show${kind === 'mic' ? ` (recording)${canSplit(live.get(peer)) ? '. An interface with two inputs? Right-click it: Two microphones' : ''}` : micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : ''}`, kind === 'mic' && canSplit(live.get(peer)) ? 7000 : undefined);
  refreshLocalMics(); // (the microphones' names, now the browser has said yes)
  checkRate(peer);
  sharedInterface(peer);
  renderCamCapture();
  return peer;
}
// A microphone at another sample rate from the studio's sound: Chrome converts it, but an
// interface and Windows set to different rates is a common cause of crackling and dropouts
// (the interface's own app, and Windows' sound settings for it, should both say 48000 Hz).
const rateWarned = new Set();
function checkRate(peer) {
  const l = live.get(peer), t = l?.stream.getAudioTracks()[0];
  const rate = t?.getSettings?.().sampleRate, engine = player.ctx?.sampleRate;
  if (!rate || !engine || rate === engine) return;
  const label = l.role === 'mic' ? l.deviceLabel : l.micLabel;
  if (rateWarned.has(label)) return;
  rateWarned.add(label);
  note(`${label} is at ${rate} Hz, the studio's sound at ${engine} Hz`);
  toast(`${label} runs at ${rate / 1000} kHz and the studio at ${engine / 1000} kHz. If it crackles, set it to ${engine / 1000} kHz in its own app and in Windows' sound settings.`, 12000);
}
// Two inputs of one audio interface open at once (a Scarlett's Input 1 and Input 2, which Linux
// lists as two microphones): Chrome on Linux reads only one of them, and the other gets no sound
// at all (measured with a Scarlett 2i2 4th Gen: the one opened first went silent, its sound piled
// up for 10 s and was thrown away). The same input twice is fine (Chrome shares it), and so are
// two separate devices. Said once for each pair, here and in the show log.
const sharedWarned = new Set();
export function sharedInterface(peer) {
  if (myOs !== 'linux') return;
  const inputs = (l) => (l?.local ? l.stream.getAudioTracks().filter((t) => t.readyState === 'live').map((t) => ({ t, s: t.getSettings?.() || {} })) : []);
  for (const { t, s } of inputs(live.get(peer))) {
    if (!s.groupId || !s.deviceId || s.deviceId === 'default') continue;
    for (const [p2, l2] of live) {
      if (p2 === peer) continue;
      const o = inputs(l2).find((x) => x.s.groupId === s.groupId && x.s.deviceId && x.s.deviceId !== 'default' && x.s.deviceId !== s.deviceId);
      if (!o) continue;
      const key = [s.deviceId, o.s.deviceId].sort().join('|');
      if (sharedWarned.has(key)) continue;
      sharedWarned.add(key);
      const a = cleanLabel(o.t.label), b = cleanLabel(t.label);
      note(`${a} and ${b} are two inputs of one interface: Chrome on Linux hears only one of them at a time`);
      toast(`${a} and ${b} are two inputs of one interface. Chrome on Linux hears only one of them at a time: the other goes silent. Keep one, or set the interface to Pro Audio in the computer's sound settings, add it once, and right-click it: Two microphones.`, 15000);
    }
  }
}

/** A camera here takes its sound from another microphone (or none): from the mixer's Sound from. Kept for that camera. */
export async function setLocalSound(peer, micId) {
  const l = live.get(peer);
  if (!l?.local || l.role === 'mic' || l.screen) return;
  let track = null;
  if (micId) {
    try {
      track = (await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micId }, ...MIC_OPTS } })).getAudioTracks()[0];
    } catch (e) {
      return void toast(`That microphone wouldn't open (${e.message})`);
    }
  }
  if (live.get(peer) !== l) return void track?.stop();
  const was = l.micLabel;
  for (const t of l.stream.getAudioTracks()) {
    l.stream.removeTrack(t);
    t.stop();
  }
  if (track) {
    l.stream.addTrack(track);
    watchLocal(peer, track, 'sound');
  }
  l.micId = track ? micId : null;
  l.micLabel = track ? cleanLabel(track.label) : null;
  const all = camSoundSaved();
  all[l.deviceId] = { micId: l.micId, label: l.micLabel };
  localStorage.setItem(CAMSOUND_KEY, JSON.stringify(all));
  if (l.recorder) {
    stopLocalRec(peer, true); // (its recording so far, with the old sound; the next has the new)
    localRecFollow();
  }
  mixAttach(peer);
  saveLocalList();
  renderMixer();
  note(`${l.name}: sound from ${l.micLabel || 'nothing'}${was ? ` (was ${was})` : ''}`);
  sharedInterface(peer);
}
/** The microphones on this computer, for Sound from (labels, once the browser has said yes). */
export let localMics = [];
export async function refreshLocalMics() {
  const devs = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
  localMics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications' && d.deviceId !== 'default' && d.label).map((d) => ({ id: d.deviceId, label: cleanLabel(d.label) }));
  renderMixer();
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshLocalMics());

// ---- a device that stops is opened again ----------------------------------------------------
// Try it again at once and then for half a minute (sooner when the computer says a device was
// plugged in), the source kept in the show meanwhile (the sound watch says the sound has stopped);
// opened, the new track takes the old one's place. Only if it doesn't come back does the source go.
const REOPEN_MS = 30_000;
const REOPEN_AT = [300, 1000, 2000, 3500, 5500, 8000, 12000, 17000, 23000, 30000];
const reopenWake = new Set(); // (a device was plugged in: try now)
function watchLocal(peer, track, part) {
  track.addEventListener('ended', () => {
    const l = live.get(peer);
    if (!l || l.removing || !l.stream.getTracks().includes(track)) return;
    reopenLocal(peer, part, track);
  });
}
async function reopenLocal(peer, part, old) {
  const l = live.get(peer);
  l.reopening ||= {};
  if (l.reopening[part]) return;
  const since = Date.now();
  l.reopening[part] = since;
  const what = part === 'sound' ? `${l.name}'s sound (${l.micLabel || 'its microphone'})` : l.name;
  note(`${what}: the device stopped; opening it again`);
  if (l.role === 'mic') stopLocalRec(peer, true);
  if (live.has(halfOf(peer))) stopLocalRec(halfOf(peer), true); // (a split input: its other side is the same device)
  renderLive();
  const kind = part === 'sound' ? 'mic' : l.role;
  const id = part === 'sound' ? l.micId : l.deviceId;
  const label = part === 'sound' ? l.micLabel : l.deviceLabel;
  for (const at of REOPEN_AT) {
    const wait = since + at - Date.now();
    if (wait > 0) {
      let wake;
      await new Promise((r) => {
        const t = setTimeout(r, wait);
        wake = () => (clearTimeout(t), r());
        reopenWake.add(wake);
      });
      reopenWake.delete(wake);
    }
    if (live.get(peer) !== l || l.removing) return;
    const track = await openAgain(kind, id, label).catch(() => null);
    if (!track) continue;
    if (live.get(peer) !== l) return void track.stop();
    l.stream.removeTrack(old);
    l.stream.addTrack(track);
    if (part === 'sound') l.micLabel = cleanLabel(track.label);
    watchLocal(peer, track, part);
    delete l.reopening[part];
    if (l.video && part === 'main') {
      l.video.srcObject = l.stream;
      l.video.play().catch(() => {});
    }
    mixAttach(peer);
    if (l.role === 'mic') !KIOSK && startLocalRec(peer);
    else localRecFollow();
    if (live.has(halfOf(peer))) {
      mixAttach(halfOf(peer));
      if (!KIOSK) startLocalRec(halfOf(peer));
    }
    renderLive();
    renderMixer();
    const secs = Math.max(1, Math.round((Date.now() - since) / 1000));
    note(`${what} is back: its device opened again after ${secs} s`);
    toast(`${what} is back`, 5000);
    return;
  }
  delete l.reopening[part];
  note(`${what}: its device didn't come back in ${REOPEN_MS / 1000} s`);
  if (part === 'main') removeLocalSource(peer, 'unplugged');
  else {
    l.micId = null;
    toast(`${l.name} has no sound now: its microphone didn't come back`, 8000);
    mixAttach(peer);
    renderMixer();
  }
}
/** The same device as a fresh track: by its id, or (plugged back in somewhere else) by its name. */
async function openAgain(kind, id, label) {
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const want = kind === 'mic' ? 'audioinput' : 'videoinput';
  const d = devs.find((x) => x.kind === want && x.deviceId === id) || devs.find((x) => x.kind === want && label && cleanLabel(x.label) === label);
  if (!d) return null;
  const s = await navigator.mediaDevices.getUserMedia(kind === 'mic'
    ? { audio: { deviceId: { exact: d.deviceId }, ...MIC_OPTS } }
    : { video: { deviceId: { exact: d.deviceId }, ...camSize() } });
  return (kind === 'mic' ? s.getAudioTracks() : s.getVideoTracks())[0] || null;
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  const wake = [...reopenWake];
  reopenWake.clear();
  wake.forEach((f) => f());
});
window.vmReopening = () => [...live].filter(([, l]) => l.reopening && Object.keys(l.reopening).length).map(([p, l]) => ({ peer: p, parts: Object.keys(l.reopening) })); // (tests and diagnostics)

export function removeLocalSource(peer, why) {
  const l = live.get(peer);
  if (!l?.local) return;
  l.removing = true; // (its tracks ending now is no reason to open it again)
  if (l.splitOf) {
    // one side of a split input: the other side still uses the device
    dropHalf(peer, why);
    saveLocalList();
    return;
  }
  if (live.has(halfOf(peer))) dropHalf(halfOf(peer), why);
  stopLocalRec(peer, true);
  l.stream.getTracks().forEach((t) => t.stop());
  if (hub?.onLiveEnd) hub.onLiveEnd(peer, why || 'removed');
  else live.delete(peer);
  saveLocalList();
  renderLive();
  renderMixer();
}
// ---- one interface, two microphones -----------------------------------------------------
// An interface with two inputs opened once, in stereo (a Scarlett on Pro Audio in Linux's sound
// settings; on a Mac it's always one two-input device): Input 1 is its left side, Input 2 its
// right. Split, each side is a microphone of its own (its own strip, mode, fader and recording)
// from the one stream. Chrome on Linux can't open an interface's two inputs separately: the
// first goes silent (see sharedInterface).
function halfOf(peer) {
  return `${peer}-R`;
}
/** A microphone here that opened with two sides, not split yet. */
export function canSplit(l) {
  return !!l?.local && l.role === 'mic' && !l.side && !l.splitOf && (l.stream.getAudioTracks()[0]?.getSettings?.().channelCount ?? 2) > 1;
}
export function splitLocalMic(peer, names = {}) {
  const l = live.get(peer), r = halfOf(peer);
  if (!canSplit(l) || live.has(r)) return null;
  stopLocalRec(peer, true); // (its recording so far has both sides; from now each records its own)
  const base = l.name;
  l.wholeName = base;
  l.side = 'L';
  l.name = names.L || `${base} · Input 1`;
  live.set(r, { stream: l.stream, role: 'mic', name: names.R || `${base} · Input 2`, cid: l.cid + 'R', local: true, deviceId: l.deviceId, deviceLabel: l.deviceLabel, side: 'R', splitOf: peer, route: 'local', fixed: true, joinedAt: Date.now() });
  for (const p of [peer, r]) {
    mixAttach(p);
    if (!KIOSK) startLocalRec(p);
  }
  renderLive();
  renderMixer();
  saveLocalList();
  note(`${base}: two microphones, ${l.name} (its left side) and ${live.get(r).name} (its right)`);
  return r;
}
/** Both sides as one microphone again. */
export function joinLocalMic(peer) {
  const p = live.get(peer)?.splitOf || peer, l = live.get(p);
  if (!l?.side) return;
  if (live.has(halfOf(p))) dropHalf(halfOf(p), 'joined');
  stopLocalRec(p, true);
  l.side = null;
  l.name = l.wholeName || l.deviceLabel;
  l.wholeName = null;
  mixAttach(p);
  if (!KIOSK) startLocalRec(p);
  renderLive();
  renderMixer();
  saveLocalList();
  note(`${l.name}: one microphone again (both sides)`);
}
/** The second side of a split input leaves the show (its stream stays: it's the first side's). */
function dropHalf(peer, why) {
  if (!live.get(peer)?.splitOf) return;
  stopLocalRec(peer, true);
  if (hub?.onLiveEnd) hub.onLiveEnd(peer, why || 'removed');
  else {
    mixDetach(peer);
    live.delete(peer);
  }
  renderLive();
  renderMixer();
}
export async function renameLocal(peer) {
  const l = live.get(peer);
  const name = l && (await askName('Name for this source', l.name));
  if (!name?.trim()) return;
  l.name = name.trim().slice(0, 40);
  saveLocalList();
  renderLive();
  renderMixer();
  ccuSync();
}
// ---- recording: on the studio's clock, rolling every 5 minutes
// A camera's recording with its sound: WebM with Opus first (the steadiest way a browser
// records a live microphone; it plays in Edit and exports the same), then the studio's other
// formats. A format that comes out without the sound isn't used again this session.
// VP8 before VP9: these are encoded on the processor beside Record program, and VP9 took
// almost a whole core more for a 720p webcam (a 4-core laptop: 2.6 cores busy recording
// with VP8, 3.6 with VP9), for a file Edit only reads back. At 8 Mbps VP8 looks the same.
const LOCAL_VIDEO_MIMES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=h264,opus', 'video/webm', ...REC_MIMES];
const localMimeNoSound = new Set();
function localVideoMime(l) {
  const sound = l.stream.getAudioTracks().length > 0;
  return LOCAL_VIDEO_MIMES.find((m) => MediaRecorder.isTypeSupported(m) && !(sound && localMimeNoSound.has(m))) || recMime();
}
/** Does a recording have sound in it? (null: can't tell) */
export function fileHasSound(blob) {
  return new Promise((res) => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob);
    const done = (x) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      res(x);
    };
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const s = v.captureStream?.();
      if (!s) return done(null);
      setTimeout(() => done(s.getAudioTracks().length > 0), 60);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    v.src = url;
  });
}
function startLocalRec(peer) {
  const l = live.get(peer);
  if (!l?.local || l.recorder) return;
  const kind = l.role === 'mic' ? 'audio' : 'video';
  const mime = kind === 'audio' ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) : localVideoMime(l);
  // A shared screen is recorded at most 1080p and 15 frames a second (slides and demos need no
  // more), from its own copy of the picture: encoding a full-size screen at 30 on the processor,
  // beside the program recording, was more than a laptop could do (the program skipped frames).
  if (l.screen && kind === 'video' && !l.recTrack) {
    const t = l.stream.getVideoTracks()[0]?.clone();
    if (t) {
      t.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 15 } }).catch(() => {});
      l.recTrack = t;
    }
  }
  const one = () => {
    const vids = l.recTrack?.readyState === 'live' ? [l.recTrack] : l.stream.getVideoTracks();
    const rec = new MediaRecorder(new MediaStream(kind === 'audio' ? (l.side && l.recAudio ? [l.recAudio] : l.stream.getAudioTracks()) : [...vids, ...l.stream.getAudioTracks()]), { mimeType: mime, videoBitsPerSecond: l.screen ? 3_000_000 : 8_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [], t0 = now(), began = performance.now();
    const name = l.name; // (named as it was when it started: a split or a rename can come before it's saved)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) return;
      const s = (l.recTrack || l.stream.getVideoTracks()[0])?.getSettings?.() || {};
      const w = s.width || 0, h = s.height || 0;
      const meta = {
        id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, mime: blob.type || mime, cid: l.cid, name,
        t0, t0Source: 'studio', dur: Math.round(performance.now() - began), w, h, local: true,
        ...(kind === 'video' ? { native: true, audio: (l.stream.getAudioTracks()[0]?.getSettings?.().channelCount || 1) > 1 ? 'stereo' : 'mono', orient: [{ t: 0, rot: 0, rect: null, upright: w >= h ? 'landscape' : 'portrait', ev: 0, ct: 0 }] } : {}),
      };
      const rec2 = { eventId, ...meta, receivedAt: Date.now() };
      await idb.put('clips', { ...rec2, blob }).catch((e) => note(`Couldn't keep ${l.name}'s recording: ${e.message}`));
      addClip(rec2, blob, true);
      // the camera had sound: is it in the file? (if a format drops it, the next ones use another)
      if (kind === 'video' && hadSound) {
        const has = await fileHasSound(blob);
        // kept with the recording, so the Edit window (and later visits) know without checking again
        if (has !== null) {
          await idb.patch('clips', eventId, meta.id, { sound: has }).catch(() => {});
          const c = clips.find((x) => x.id === meta.id);
          if (c) c.sound = has;
        }
        if (has === false) {
          localMimeNoSound.add(mime);
          note(`${l.name}'s recording came out without sound in ${mime}: the next ones use ${localVideoMime(l)}`);
          toast(`${l.name}'s last recording has no sound (the browser's ${mime.split(';')[0]} recorder dropped it). The next ones record differently.`, 7000);
        } else if (has) note(`${l.name}'s recording has its sound (${mime.split(';')[0]})`);
      }
    };
    const hadSound = kind === 'video' && l.stream.getAudioTracks().some((t) => t.readyState === 'live');
    rec.start(1000);
    return rec;
  };
  l.recorder = one();
  l.nextRecorder = one;
  l.rec = true;
  l.recRoll = setInterval(() => {
    const old = l.recorder;
    l.recorder = one();
    setTimeout(() => old.state !== 'inactive' && old.stop(), 400); // (a short overlap: nothing lost at the seam)
  }, 5 * 60000);
  renderLive();
  note(`Recording ${l.name} (this computer)`);
}
function rollLocalRec(peer) {
  const l = live.get(peer);
  if (!l?.recorder || !l.nextRecorder) return false;
  if (l.role !== 'mic' && !localShouldRec(peer, l)) {
    stopLocalRec(peer); // (off air, at black: finish it, and don't start another)
    return true;
  }
  const old = l.recorder;
  l.recorder = l.nextRecorder();
  setTimeout(() => old.state !== 'inactive' && old.stop(), 400); // (a short overlap: nothing lost at the seam)
  return true;
}
function stopLocalRec(peer, now_) {
  const l = live.get(peer);
  if (!l?.recorder) return;
  clearInterval(l.recRoll);
  clearTimeout(l.offAirStop);
  const r = l.recorder;
  l.recorder = null;
  l.rec = false;
  if (r.state !== 'inactive') r.stop();
  if (l.recTrack) {
    const t = l.recTrack;
    l.recTrack = null;
    setTimeout(() => t.stop(), 500); // (after the recorder's last piece)
  }
  renderLive();
}
export function setLocalManualRec(peer, on) {
  const l = live.get(peer);
  if (!l) return;
  l.recManual = on;
  if (on) startLocalRec(peer);
  else localRecFollow();
}
// cameras on this computer record while they're on air (if that's on), plus 5 s after
/** Is this computer's camera on air (a dissolve's incoming one too)? Not at black, in a break, or under a clip. */
export function localAired(peer) {
  return (peer === liveActive || (swActive() && peer === sw.to) || pipAir()?.peer === peer) && !onBreak() && !mediaOn && !(black.target === 1 && black.cleared);
}
// Whether this computer's camera should be recording: whenever it's on air (anything aired
// makes Edit), or by hand. Not at a kiosk: a kiosk never edits, so it records no clips of its
// own (only the program, which goes back to the phones).
const localShouldRec = (peer, l) => !KIOSK && (l.recManual || (localAired(peer) && !!progRec && !progRec.stopping)); // (the phones' storage setting doesn't apply to this computer's cameras)
export function localRecFollow() {
  for (const [peer, l] of live) {
    if (!l.local || l.role === 'mic') continue;
    const want = localShouldRec(peer, l);
    if (want) {
      clearTimeout(l.offAirStop);
      l.offAirStop = null;
      startLocalRec(peer);
    } else if (l.recorder && !l.offAirStop) l.offAirStop = setTimeout(() => {
      l.offAirStop = null;
      if (!localShouldRec(peer, l)) stopLocalRec(peer);
    }, 5000);
  }
}
// ---- Camera control for this computer's cameras: the camera's own settings, where it has them
function localCamState(peer) {
  const l = live.get(peer), t = l?.stream?.getVideoTracks()[0];
  if (!t) return;
  const c = t.getCapabilities?.() || {}, s = t.getSettings?.() || {};
  l.camDefaults ||= { zoom: s.zoom, brightness: s.brightness, contrast: s.contrast, exposureCompensation: s.exposureCompensation };
  l.cam = {
    t: 'camstate', local: true, remote: true,
    z: Math.round((s.zoom ?? 1) * 100) / 100, zmin: c.zoom?.min ?? 1, zmax: c.zoom?.max ?? 1, zn: !!c.zoom && c.zoom.max > c.zoom.min,
    ev: l.localEv ?? 0, evmin: -2, evmax: 2, evn: !!(c.exposureCompensation || c.brightness),
    ct: l.localCt ?? 1, ctn: !!c.contrast,
    focus: false, lock: false, canLock: false, wb: false, canWb: false, lenses: [], lens: null,
  };
  ccuSync();
}
export async function localCtl(peer, m) {
  const l = live.get(peer), t = l?.stream?.getVideoTracks()[0];
  if (!t) return;
  const c = t.getCapabilities?.() || {}, d = l.camDefaults || {}, set = {};
  const span = (cap, mid, k) => Math.min(cap.max, Math.max(cap.min, mid + k * (cap.max - cap.min) / 4)); // ±2 → ±half the range
  if (m.zoom != null && c.zoom) set.zoom = Math.min(c.zoom.max, Math.max(c.zoom.min, +m.zoom));
  if (m.ev != null) {
    l.localEv = +m.ev;
    if (c.exposureCompensation) set.exposureCompensation = span(c.exposureCompensation, d.exposureCompensation ?? 0, l.localEv);
    else if (c.brightness) set.brightness = span(c.brightness, d.brightness ?? (c.brightness.min + c.brightness.max) / 2, l.localEv);
  }
  if (m.ct != null && c.contrast) {
    l.localCt = +m.ct;
    const mid = d.contrast ?? (c.contrast.min + c.contrast.max) / 2;
    set.contrast = Math.min(c.contrast.max, Math.max(c.contrast.min, mid + (l.localCt - 1) * (c.contrast.max - c.contrast.min) / 2.2));
  }
  if (m.auto) {
    Object.assign(l, { localEv: 0, localCt: 1 });
    for (const k of ['zoom', 'brightness', 'contrast', 'exposureCompensation']) if (c[k] && d[k] != null) set[k] = d[k];
  }
  if (Object.keys(set).length) {
    const want = snapToCamera(c, set);
    await t.applyConstraints({ advanced: [want] }).catch((e) => note(`${l.name}: ${e.message}`));
    // (some cameras ignore a setting quietly: say so, rather than seem to do nothing)
    const got = t.getSettings?.() || {};
    const missed = Object.keys(want).filter((k) => typeof want[k] === 'number' && typeof got[k] === 'number' && Math.abs(got[k] - want[k]) > (c[k]?.step || 0.01) * 1.5);
    if (missed.length) note(`${l.name} didn't take ${missed.map((k) => `${k} ${want[k]} (it's at ${got[k]})`).join(', ')}`);
  }
  localCamState(peer);
}
// ---- anything aired makes Edit ----
// Going to Edit (or ending Record program) finishes the recordings in progress, so what's
// been on air is there now: this computer's cameras and microphones roll to a new recording,
// and phones that are recording are asked to do the same (each keeps recording).
let lastFlush = 0;
export function flushRecordings(why) {
  if (!isHost || Date.now() - lastFlush < 3000) return; // (not twice in a moment)
  lastFlush = Date.now();
  let n = 0;
  for (const [peer, l] of live) {
    if (l.local) n += rollLocalRec(peer) ? 1 : 0;
    else if (l.rec && l.role !== 'mic' && hub?.message(peer, { t: 'roll' })) n++;
  }
  if (n) note(`${why}: ${n} recording${n > 1 ? 's' : ''} in progress finished so ${n > 1 ? 'they reach' : 'it reaches'} Edit now (still recording)`);
}

// ---- a screen, a window, or this computer's sound ----
// Shared through the browser's own picker (it asks each time, so these aren't brought back
// next time). A screen or window is a source like a camera, with its sound if the browser
// shares it; "This computer's sound" keeps just the sound, as a microphone. Which sound the
// browser can share: Windows and ChromeOS, the whole computer's (pick Entire screen, tick
// Share system audio); Mac, a Chrome tab's (pick the tab, tick Share tab audio).
// At most 1080p: left to itself the browser captures a screen at its full size (a Retina iMac's
// is 5120x2880), and every frame of that was copied and shrunk 4x on the page (slow, and the
// text came out jagged) and recorded on air at full size (the computer's whole effort). The
// browser shrinks it as it captures, smoothly; 'detail' keeps it sharp over smooth motion.
const SCREEN_MAX = { width: 1920, height: 1080 };
async function addScreenSource(soundOnly) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: SCREEN_MAX.width }, height: { max: SCREEN_MAX.height }, frameRate: { ideal: 30 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }, systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude' });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Couldn't share: ${e.message}`, 6000);
    return null;
  }
  const n = Date.now().toString(36);
  if (soundOnly) {
    const a = stream.getAudioTracks()[0];
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!a) {
      toast(myOs === 'mac' ? 'No sound came with it. On a Mac, share a Chrome tab and tick Share tab audio.' : 'No sound came with it. Pick Entire screen and tick Share system audio (or a tab, with Share tab audio).', 8000);
      return null;
    }
    return registerLocal('mic', new MediaStream([a]), { deviceId: 'sound-' + n, screen: true, label: 'Computer sound' });
  }
  const v = stream.getVideoTracks()[0];
  try {
    v.contentHint = 'detail';
  } catch {}
  const surface = v.getSettings?.().displaySurface;
  const label = surface === 'monitor' ? 'Screen' : surface === 'browser' ? 'Browser tab' : cleanLabel(v.label) || 'Window';
  return registerLocal('cam', stream, { deviceId: 'screen-' + n, screen: true, label: `${label}${stream.getAudioTracks().length ? '' : ''}` });
}
async function openLocalPicker() {
  const dlg = $('#localDlg');
  let devs = await navigator.mediaDevices.enumerateDevices();
  const named = devs.some((d) => d.label);
  const inShow = new Set([...live.values()].filter((l) => l.local).map((l) => l.deviceId));
  const cams = devs.filter((d) => d.kind === 'videoinput' && d.deviceId), mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const sound = (d) => {
    const pick = soundFor(d, devs), pickId = pick?.deviceId === 'default' ? mics.find((m) => m.groupId === pick.groupId)?.deviceId || 'default' : pick?.deviceId;
    return `<label class="snd">Sound <select data-snd="${esc(d.deviceId)}" aria-label="Sound for ${esc(cleanLabel(d.label))}">${mics.map((m) => `<option value="${esc(m.deviceId)}" ${m.deviceId === pickId ? 'selected' : ''}>${esc(cleanLabel(m.label))}</option>`).join('')}${pickId === 'default' ? '<option value="default" selected>This computer\u2019s microphone</option>' : ''}<option value="" ${pick ? '' : 'selected'}>No sound</option></select></label>`;
  };
  const row = (d, kind) => `<li><span>${esc(cleanLabel(d.label) || (kind === 'mic' ? 'Microphone' : 'Camera'))}${kind === 'cam' && !inShow.has(d.deviceId) ? sound(d) : ''}</span>${inShow.has(d.deviceId) ? '<span class="fine">in the show</span>' : `<button type="button" data-add="${kind}" data-dev="${esc(d.deviceId)}">Add</button>`}</li>`;
  $('#localList').innerHTML = !named
    ? '<p>To list them, the browser needs your OK to use this computer\u2019s cameras and microphones.</p><button type="button" class="primary" id="localAllow">Allow cameras and microphones</button>'
    : `<h3>Cameras</h3><ul>${cams.map((d) => row(d, 'cam')).join('') || '<li class="fine">None found</li>'}</ul><h3>Microphones</h3><ul>${mics.map((d) => row(d, 'mic')).join('') || '<li class="fine">None found</li>'}</ul>`;
  $('#localList').insertAdjacentHTML('beforeend', `<h3>Screen and sound</h3><ul><li><span>A screen or window<small class="fine">with its sound, if the browser shares it</small></span><button type="button" data-share="screen">Share…</button></li><li><span>This computer\u2019s sound<small class="fine">${myOs === 'mac' ? 'on a Mac: a Chrome tab\u2019s sound (tick Share tab audio)' : 'pick Entire screen and tick Share system audio'}</small></span><button type="button" data-share="sound">Share…</button></li><li><span>Another computer\u2019s screen<small class="fine">open <b id="shareUrl">${esc(shareUrl())}</b> on it, name it, share</small></span><button type="button" data-copy-share>Copy link</button></li></ul>`);
  if (!dlg.open) dlg.showModal();
}
$('#addLocal').onclick = openLocalPicker;
/** The page another computer opens to share its screen into this show (see share.js). */
export const shareUrl = () => `${location.origin}/share?e=${eventId}`;
$('#localList').addEventListener('click', async (e) => {
  if (e.target.closest('[data-copy-share]')) {
    try {
      await navigator.clipboard.writeText(shareUrl());
      toast('Link copied: open it on the other computer');
    } catch {
      toast(`Open ${shareUrl()} on the other computer`, 8000);
    }
    return;
  }
  const sh = e.target.closest('[data-share]');
  if (sh) {
    sh.disabled = true;
    const peer = await addScreenSource(sh.dataset.share === 'sound');
    sh.disabled = false;
    if (peer) {
      $('#localDlg').close();
      toast(`${live.get(peer)?.name} is in the show${live.get(peer)?.stream.getAudioTracks().length ? ', with its sound' : ''}`);
    }
    return;
  }
  if (e.target.id === 'localAllow') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      return toast('The browser said no: allow the camera and microphone for this site in its settings (the icon left of the address)', 7000);
    }
    return openLocalPicker();
  }
  const b = e.target.closest('[data-add]');
  if (!b || b.disabled) return;
  $('#localList').querySelectorAll(`[data-dev="${CSS.escape(b.dataset.dev)}"]`).forEach((x) => (x.disabled = true)); // (one add at a time)
  const snd = b.dataset.add === 'cam' ? $('#localList').querySelector(`[data-snd="${CSS.escape(b.dataset.dev)}"]`)?.value ?? undefined : undefined;
  try {
    await addLocalSource(b.dataset.add, b.dataset.dev, undefined, false, snd === undefined ? undefined : snd || null);
  } catch (err) {
    toast(err.name === 'NotReadableError' ? 'That device is busy (another app may be using it)' : err.message, 6000);
  }
  openLocalPicker();
});
// the ones added before come back (when the browser still allows it)
setTimeout(async () => {
  const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  if (!saved.length || !isHost || EDIT_ONLY) return; // (the Edit page uses no cameras)
  const cam = await navigator.permissions?.query({ name: 'camera' }).then((p) => p.state).catch(() => null);
  const mic = await navigator.permissions?.query({ name: 'microphone' }).then((p) => p.state).catch(() => null);
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const taken = new Set(); // (by name, each saved one gets a different device: three of the same webcam stay three)
  for (const s of saved) {
    if ((s.kind === 'mic' ? mic : cam) !== 'granted') continue;
    // by its id, or (ids can change) by its name
    const same = devs.find((d) => d.deviceId === s.deviceId && !taken.has(d.deviceId)) || devs.find((d) => d.kind === (s.kind === 'mic' ? 'audioinput' : 'videoinput') && cleanLabel(d.label) === s.label && !taken.has(d.deviceId) && !saved.some((o) => o !== s && o.deviceId === d.deviceId));
    if (same) taken.add(same.deviceId);
    if (!same) {
      note(`${s.label || 'A source'} on this computer isn't plugged in now`);
      continue;
    }
    let micId;
    if (s.kind === 'cam' && s.sound === false) micId = null;
    // (a camera saved with "Default" as its sound, from before: it picks a microphone by name again)
    else if (s.kind === 'cam' && s.micId !== 'default' && (s.micId || s.micLabel)) micId = (devs.find((d) => d.deviceId === s.micId) || devs.find((d) => d.kind === 'audioinput' && cleanLabel(d.label) === s.micLabel))?.deviceId;
    const peer = await addLocalSource(s.kind, same.deviceId, s.name, true, micId).catch((e) => note(`${s.label || 'A source'} on this computer isn't available now: ${e.message}`));
    if (peer && s.split) splitLocalMic(peer, s.split);
  }
  if (saved.some((s) => (s.kind === 'mic' ? mic : cam) !== 'granted')) toast('This computer\u2019s cameras and microphones are off until you allow them: + This computer', 7000);
}, 1500);
window.addEventListener('pagehide', () => { for (const [peer, l] of live) if (l.local) stopLocalRec(peer); });

// --------------------------------------------------------------- moderation ---
// A camera or microphone that's misbehaving can be removed: the phone is told and leaves
// (it can rejoin). Or removed and blocked: it can't rejoin this event (the server turns it
// away), and its recordings stay out of the automatic edit (they're still in Media, marked
// Blocked, if you want a shot by hand). Blocked ones are listed in the Live inspector, where
// they can be let back in. (Blocking goes by the phone's identity for this event: someone
// who wipes their browser's data comes back as a new phone.)
const blockedCids = new Set(JSON.parse(localStorage.getItem('vm_blocked_' + eventId) || '[]'));
export const isBlocked = (cid) => !!cid && blockedCids.has(cid);
function saveBlocked() {
  localStorage.setItem('vm_blocked_' + eventId, JSON.stringify([...blockedCids]));
  if (isHost) api(`events/${eventId}`, { method: 'PATCH', host: key, body: { blocked: [...blockedCids] } }).catch((e) => note(`Couldn't save the blocked list: ${e.message}`));
  renderBlocked();
  if (seq.auto && clips.length) {
    rebuild(false);
    player.setSequence(seq);
    renderTimeline();
  }
  renderMedia?.();
}
export function askRemove(peer) {
  const l = live.get(peer);
  if (!l) return;
  $('#kickWho').textContent = l.name;
  const dlg = $('#kickDlg');
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue === 'remove') removeContributor(peer, false);
    else if (dlg.returnValue === 'block') removeContributor(peer, true);
  };
  dlg.showModal();
}
function removeContributor(peer, block) {
  const l = live.get(peer);
  if (!l) return;
  if (block && l.cid) {
    blockedCids.add(l.cid);
    blockedNames.set(l.cid, l.name);
    localStorage.setItem('vm_blocked_names_' + eventId, JSON.stringify([...blockedNames]));
    saveBlocked();
  }
  hub?.message(peer, { t: 'kick', block: !!block });
  hub?.send(peer, { t: 'kick', block: !!block });
  if (peer === liveActive) {
    setLiveActive(null);
    syncTally();
  }
  if (pvw === peer) setPreview(null);
  setTimeout(() => hub?.drop(peer, 'removed'), 1200);
  note(`${l.name} removed by the host${block ? ' and blocked from this event' : ''}`);
  toast(`${l.name} removed${block ? ' and blocked: they can\u2019t rejoin, and their clips are out of the automatic edit' : ' (they can rejoin)'}`, 5000);
}
const blockedNames = new Map(JSON.parse(localStorage.getItem('vm_blocked_names_' + eventId) || '[]'));
function renderBlocked() {
  const box = $('#blockedBox');
  if (!box) return;
  box.hidden = !blockedCids.size;
  $('#blockedList').innerHTML = [...blockedCids].map((cid) => `<li><span>${esc(blockedNames.get(cid) || clips.find((c) => c.cid === cid)?.name || 'A phone')}</span><button type="button" class="small" data-unblock="${esc(cid)}">Let back in</button></li>`).join('');
}
$('#blockedList')?.addEventListener('click', (e) => {
  const cid = e.target.closest('[data-unblock]')?.dataset.unblock;
  if (!cid) return;
  blockedCids.delete(cid);
  saveBlocked();
  toast(`${blockedNames.get(cid) || 'They'} can rejoin, and their clips are back in the automatic edit`);
});
setTimeout(renderBlocked, 500);
