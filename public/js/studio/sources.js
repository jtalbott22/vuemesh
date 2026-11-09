// Studio, part 7 of 26: this computer's cameras, mics, screen and sound; recording; moderation.
// Loads after mixer.js: that import comes first, so the parts run in order (see ../studio.js).
import './mixer.js';
import { api, toast, esc, now } from '/js/vm.js';
import { snapToCamera } from '/js/camctl.js';
import { cleanLabel, matchSaved, renamed, usbIdOf } from '/js/devmatch.js';
import { defaultOutputOf } from '/js/showlog.js';
import * as idb from '/js/idb.js';
import {
  $, askTitle, black, clips, EDIT_ONLY, eventId, hub, isHost, key, KIOSK, live, LIVE_DELAY, liveActive, note,
  player, REC_MIMES, recMime, seq, setLiveActive, setTitle,
} from './core.js';
import { addClip, noteAngle, output, qualityFirst, rebuild } from './clips.js';
import { renderLive } from './live.js';
import { autoRecOn, syncTally } from './onair.js';
import { applyStripFx, mix, mixAttach, mixDetach, mixSave, mixState, renderMixer } from './mixer.js';
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
// (each one as it's saved: with its USB id, where the browser gives one, so it's found again under
// another name; see devmatch.js)
const savedOf = (p, l) => ({ kind: l.role, deviceId: l.deviceId, label: l.deviceLabel, name: l.wholeName || l.name, micId: l.micId || null, micLabel: l.micLabel || null, sound: l.role === 'cam' ? !!l.micId : undefined, ...(l.usb ? { usb: l.usb } : {}), ...(l.as && !l.side ? { as: l.as } : {}), ...(l.side ? { split: { L: l.name, R: live.get(halfOf(p))?.name || null } } : {}) });
// Saved ones that aren't plugged in (or that the browser hasn't allowed yet, or that wouldn't open)
// stay saved, and come back when they can: they were dropped from the list the next time it was
// saved, so a Scarlett whose new driver renamed it was gone for good from every show after. One
// leaves this list only by being itself again: brought back, in the show under its own id, added
// by hand as the one it is (consumeFor), or forgotten. Never because something like it is in the
// show: two of the same mic, two Focusrites, or two inputs of one interface are different devices.
let missing = [];
let pending = []; // (the saved ones the startup restore hasn't got to yet: kept if the studio closes meanwhile)
const inflight = new Map(); // (one being brought back, with the device it's going to: kept until it's in the show)
const forgotten = new Set(); // (forgotten while it was being brought back: not kept if that fails)
const notListed = new Set(); // (missing ones whose device wasn't listed the last time it was looked for)
const keyOf = (s) => `${s.kind}:${s.deviceId}`;
function saveLocalList() {
  const list = [...live].filter(([, l]) => l.local && !l.screen && !l.splitOf && !l.removing).map(([p, l]) => savedOf(p, l));
  const here = new Set(list.map(keyOf));
  missing = missing.filter((s) => !here.has(keyOf(s)));
  const going = [...inflight].filter(([s, to]) => !here.has(keyOf(s)) && !here.has(`${s.kind}:${to}`)).map(([s]) => s);
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...list, ...missing, ...going, ...pending.filter((s) => !here.has(keyOf(s)))]));
}
/** The saved ones not in the show now (for + This computer). */
export const missingSaved = () => missing.slice();
// Devices removed from the show by hand: a missing one never takes one of these but by its own id
// (a third webcam of the same kind, unplugged, would otherwise bring back the second one, removed)
const REMOVED_KEY = 'vm_local_removed';
const removedByHand = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(REMOVED_KEY) || '[]'));
  } catch {
    return new Set();
  }
};
function setRemovedByHand(deviceId, on) {
  if (!deviceId) return;
  const ids = removedByHand();
  if (on) ids.add(deviceId);
  else if (!ids.delete(deviceId)) return;
  localStorage.setItem(REMOVED_KEY, JSON.stringify([...ids].slice(-30)));
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
// How big this computer's cameras capture (per computer): as big as the show's output, or 720p,
// which is far lighter on USB (sound from the same ports suffers first). Never bigger than the
// output: the live picture is drawn at the output's size, and three 1080p webcams shrunk to a
// 720p show on every frame were more than a laptop's graphics could take (Record program skipped
// half its frames, where the same show with 720p webcams skipped none). A 1080p chosen before
// follows the output now. Changed, the cameras in the show change at once.
const CAMSIZE_KEY = 'vm_localcamsize';
const camChoice = () => (localStorage.getItem(CAMSIZE_KEY) === '720' ? 720 : 'auto');
export const camCapture = () => (camChoice() === 720 || output.height !== 1080 ? 720 : 1080);
const sizeFor = (h) => ({ width: { ideal: Math.round((h * 16) / 9) }, height: { ideal: h }, frameRate: { ideal: 30 } });
// A camera that won't start at the size asked is opened smaller (720p, then 360p) rather than not
// at all, and says so. On Windows a USB port without room for the picture says "Timeout starting
// video source", after 10 s: two Logitech C930e on the same USB controller as a Focusrite Scarlett
// opened at 360p and timed out at 720p and 1080p, with nothing else open.
const wontStart = (e) => e?.name === 'AbortError' || e?.name === 'NotReadableError' || /timeout|could not start/i.test(e?.message || '');
async function openVideo(deviceId, label, quiet) {
  const steps = [...new Set([camCapture(), 720, 360])].filter((h) => h <= camCapture());
  let last;
  for (const h of steps) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, ...sizeFor(h) } });
      // (opened smaller than asked though the camera can do it: still held at another size somewhere
      // a moment ago, as by its preview in the add list; asked once more)
      const t = s.getVideoTracks()[0], got = t?.getSettings?.().height || h;
      if (got < h && (t.getCapabilities?.().height?.max || 0) >= h) await t.applyConstraints(sizeFor(h)).catch(() => {});
      if (h !== steps[0]) {
        const why = `its USB port had no room for ${steps[0]}p (an audio interface or other cameras on the same port take some; another USB port, ideally one on the computer itself, may give it more)`;
        note(`${label} opened at ${h}p: ${why}`);
        s.smaller = `at ${h}p: ${why}`; // (said when it's in the show: see registerLocal)
      }
      return s;
    } catch (e) {
      last = e;
      if (!wontStart(e)) throw e;
      if (h === steps[0] && h > 360 && !quiet) toast(`${label} didn't start at ${h}p: trying smaller…`, 10000);
    }
  }
  throw last;
}
export async function setCamCapture(h) {
  if (h === 720) localStorage.setItem(CAMSIZE_KEY, '720');
  else localStorage.removeItem(CAMSIZE_KEY); // (as big as the output)
  await syncCamSizes();
}
// ---- each camera at its size ----
// A camera's size can't be changed as it runs: its picture comes from the size the device was
// opened at, and with its frame buffer's copy open too, Windows keeps it at that size (asked for
// less, the browser only scaled one copy: the camera, its USB port and the program stayed at the
// old size; asked for more, 720p cameras stayed 720p in a show changed to 1080p). So a camera at
// another size than it should be is opened again at that size, as one that stopped is (a moment
// without a picture on its tile), but only while nothing shows or records it: not on the
// program, in a dissolve or picture-in-picture, in preview, or recording. Those wait, and are
// done as soon as they're free (localRecFollow). One that can't be that size (it tried, or its USB
// port had no room) is left as it is. One pass at a time; a change during one is
// picked up by another straight after.
const busyCam = (peer, l) => peer === liveActive || (swActive() && peer === sw.to) || pipAir()?.peer === peer || peer === pvw || !!l.recorder || !!l.reopening?.main;
let appliedCam = null, sizing = null, sizeAgain = false;
export function syncCamSizes() {
  if (sizing) {
    sizeAgain = true;
    return sizing;
  }
  sizing = (async () => {
    do {
      sizeAgain = false;
      const h = camCapture();
      for (const [peer, l] of [...live]) {
        if (!l.local || l.role === 'mic' || l.removing || live.get(peer) !== l) continue;
        const t = l.stream.getVideoTracks()[0];
        if (!t || t.readyState !== 'live') continue;
        if (l.screen) {
          await sizeScreen(peer, l);
          continue;
        }
        const cur = t.getSettings().height || 0;
        if (cur === h) {
          l.sizeTried = null;
          continue;
        }
        if (l.sizeTried === h) continue; // (opened again for this size and it came up another: it stays)
        // (it can't be bigger: it was opened smaller for its USB port. A camera's own most isn't asked: the
        // browser's figure for it can be less than the camera does. One that tries and can't is left, above)
        if (cur < h && l.stream.smaller) continue;
        if (busyCam(peer, l)) continue; // (when it's free)
        await reopenAtSize(peer, l, h);
      }
      if (h !== appliedCam) {
        if (appliedCam != null) note(`This computer's cameras capture at ${h}p${camChoice() === 'auto' ? ' (the output’s size)' : ''}`);
        appliedCam = h;
      }
    } while (sizeAgain);
    renderCamCapture();
  })().finally(() => {
    sizing = null;
  });
  return sizing;
}
async function reopenAtSize(peer, l, h) {
  const old = l.stream.getVideoTracks()[0];
  (l.reopening ||= {}).main = Date.now();
  let s = null;
  try {
    const { buffers } = await import('./picsync.js'); // (loaded long since: imported here, it would load before its turn)
    const b = buffers.get(peer);
    if (b) {
      b.stop(); // (its copy of the camera, let go: picsync makes a new one from the new track)
      buffers.delete(peer);
    }
    old.stop(); // (stopping a track doesn't say it ended: it isn't taken for unplugged)
    await new Promise((r) => setTimeout(r, 350)); // (Windows lets go of a camera a moment after)
    s = await openVideo(l.deviceId, l.deviceLabel || l.name, true).catch(() => null);
  } finally {
    delete l.reopening.main;
  }
  const track = s?.getVideoTracks()[0] || null;
  if (live.get(peer) !== l || l.removing) return void track?.stop();
  if (!track) return void reopenLocal(peer, 'main', old); // (it didn't open: tried again, as one that stopped)
  l.stream.removeTrack(old);
  l.stream.addTrack(track);
  l.stream.smaller = s.smaller || null;
  watchLocal(peer, track, 'main');
  if (l.video) {
    l.video.srcObject = l.stream;
    l.video.play().catch(() => {});
  }
  if ((track.getSettings().height || 0) !== h) l.sizeTried = h;
  const set = track.getSettings();
  note(`${l.name} opened again at ${set.height || '?'}p${set.width ? ` (${set.width}x${set.height}${set.frameRate ? `, ${Math.round(set.frameRate)} frames a second` : ''}${set.resizeMode === 'crop-and-scale' ? ', shrunk by the browser from a bigger picture' : ''})` : ''}${s.smaller ? ` (${s.smaller})` : ''}`);
  // (what was set in Camera control, on the new track; a camera nobody touched keeps its own)
  const z = l.cam?.zn && l.cam.z !== 1 ? { zoom: l.cam.z } : {};
  if ((l.localEv ?? 0) !== 0 || (l.localCt ?? 1) !== 1 || z.zoom) await localCtl(peer, { ev: l.localEv ?? 0, ct: l.localCt ?? 1, ...z });
  else localCamState(peer);
  renderLive();
  localRecFollow(); // (a recording that was wanted meanwhile starts now, on the new track)
}
// A shared screen: its track and its frame buffer's copy both (one alone only scales that copy)
async function sizeScreen(peer, l) {
  const { buffers } = await import('./picsync.js');
  for (const t of [l.stream.getVideoTracks()[0], buffers.get(peer)?.track]) if (t?.readyState === 'live') await t.applyConstraints(screenSize()).catch(() => {});
}
// (the output's size or frame rate changed: cameras and screens that follow it change with it, after clips.js has set it)
$('#outSize')?.addEventListener('change', () => setTimeout(syncCamSizes));
$('#outFps')?.addEventListener('change', () => setTimeout(syncCamSizes));
export function renderCamCapture() {
  const sel = $('#camSize'), hint = $('#camSizeHint');
  if (!sel) return;
  const auto = sel.querySelector('option[value="auto"]');
  if (auto) auto.textContent = `As the output (${output.height === 1080 ? 1080 : 720}p)`;
  sel.value = String(camChoice());
  const pics = [...live.values()].filter((l) => l.local && l.role !== 'mic');
  const n = pics.filter((l) => !l.screen).length, scr = pics.length - n;
  // (a shared screen counts: three webcams and a screen, all at 1080p, were more than one laptop's
  // graphics could draw, and the program stuttered where three webcams alone didn't)
  const what = `${n} camera${n === 1 ? '' : 's'}${scr ? ` and ${scr === 1 ? 'a shared screen' : `${scr} shared screens`}` : ''}`;
  if (hint) hint.textContent = n && n + scr >= 3 && camCapture() === 1080 ? `${what} at 1080p is a lot for one computer${scr ? '' : "'s USB"}: if pictures stutter or the sound crackles, try a 720p output, or 720p here.` : '';
}
$('#camSize')?.addEventListener('change', (e) => setCamCapture(e.target.value === '720' ? 720 : 'auto'));
setTimeout(() => {
  // (once clips.js has run too: it and this file import each other, and the output is set there)
  appliedCam = camCapture();
  renderCamCapture();
});

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
async function addLocalSource(kind, deviceId, name, quiet, micId, as) {
  if (kind === 'cam' && micId === undefined) {
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cam = devs.find((d) => d.deviceId === deviceId);
    const chosen = camSoundSaved()[deviceId];
    const kept = chosen && (chosen.micId === null ? { deviceId: null } : devs.find((d) => d.kind === 'audioinput' && (d.deviceId === chosen.micId || (chosen.label && cleanLabel(d.label) === chosen.label))));
    micId = kept ? kept.deviceId : cam ? soundFor(cam, devs)?.deviceId || null : null;
  }
  if (kind === 'mic') {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, ...MIC_OPTS } });
    return registerLocal(kind, stream, { deviceId, name, quiet, micId, as });
  }
  // the picture (smaller if it has to be), then its sound
  const label = cleanLabel((await navigator.mediaDevices.enumerateDevices().catch(() => [])).find((d) => d.deviceId === deviceId)?.label) || 'The camera';
  const stream = await openVideo(deviceId, label, quiet);
  if (micId) {
    try {
      stream.addTrack((await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: micId }, ...MIC_OPTS } })).getAudioTracks()[0]);
    } catch (e) {
      // the camera without its sound, rather than not at all (the mic may be busy or gone)
      toast(`Added without sound: its microphone isn't available (${e.message})`, 6000);
      micId = null;
    }
  }
  return registerLocal(kind, stream, { deviceId, name, quiet, micId, as });
}
/** A source on this computer, from a stream already open (a camera, a microphone, a shared screen or the computer's sound). */
function registerLocal(kind, stream, { deviceId, name, quiet, micId, screen, label: given, as } = {}) {
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
  // (a name given to this device before comes back with it: added again by hand, or after it dropped out)
  if (!name) name = localNames()[`${kind}:${deviceId}`] || null;
  if (!name) {
    const same = [...live.values()].filter((x) => x.local && x.deviceLabel === label).length;
    if (same) name = `${label} ${same + 1}`;
  }
  const micTrack = kind === 'cam' ? stream.getAudioTracks()[0] : null;
  // (with its USB id, to find it again if a driver renames it)
  const ids = screen ? {} : { rawLabel: track.label || null, usb: usbIdOf(track.label) };
  live.set(peer, { stream, role: kind, name: name || label, cid, local: true, screen: !!screen, deviceId, deviceLabel: label, ...ids, micId: micTrack ? micId : null, micLabel: micTrack ? cleanLabel(micTrack.label) : null, route: 'local', fixed: true, joinedAt: Date.now() });
  if (kind !== 'mic') noteAngle(cid);
  // a device that stops (a USB interface dropping out, a camera's driver hiccuping) is opened
  // again into the same source, so its mixer channel, sound mode and recording carry on
  watchLocal(peer, track, 'main');
  if (micTrack) watchLocal(peer, micTrack, 'sound');
  mixAttach(peer);
  if (kind === 'mic' && as) setMicAs(peer, as, quiet); // (before its recording starts: two tracks record one each)
  if (kind === 'cam') localCamState(peer);
  renderLive();
  renderMixer();
  saveLocalList();
  if (kind === 'mic') !KIOSK && startLocalRec(peer);
  else localRecFollow();
  note(`${label} added from this computer${micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : kind === 'cam' ? ', without sound' : ''}`);
  if (!quiet && stream.smaller) toast(`${live.get(peer).name} is in the show, ${stream.smaller}`, 14000);
  else if (!quiet) toast(`${live.get(peer).name} is in the show${kind === 'mic' ? ` (recording)${!as && canSplit(live.get(peer)) ? '. An interface with two inputs? Right-click it: Two microphones' : ''}` : micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : ''}`, kind === 'mic' && !as && canSplit(live.get(peer)) ? 7000 : undefined);
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
    // A shared screen (or this computer's sound) that ends was stopped (the browser's Stop sharing,
    // or the window shared was closed): only the browser's picker can share it again, so it goes
    // now, and says how. (It was tried again for 30 s, as a camera is, and never could be.)
    if (l.screen) {
      note(`${l.name}: sharing ended`);
      toast(`${l.name} stopped sharing. To share again: + This computer, then Share…`, 8000);
      removeLocalSource(peer, 'sharing ended');
      return;
    }
    reopenLocal(peer, part, track);
  });
}
async function reopenLocal(peer, part, old) {
  const l = live.get(peer);
  if (!l || l.removing) return;
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
    const track = await openAgain(kind, id, label, part === 'sound').catch(() => null);
    if (!track) continue;
    if (live.get(peer) !== l) return void track.stop();
    l.stream.removeTrack(old);
    l.stream.addTrack(track);
    if (part === 'sound') l.micLabel = cleanLabel(track.label);
    // Found by its name under another id (a webcam moved to another USB port): it's that device
    // now, so nothing else (a saved one coming back, another that dropped) takes it, and it's saved so.
    const nowId = track.getSettings?.().deviceId;
    if (nowId && nowId !== id) {
      if (part === 'sound') l.micId = nowId;
      else {
        l.deviceId = nowId;
        l.rawLabel = track.label || l.rawLabel;
        l.usb = usbIdOf(track.label) || l.usb;
        const half = live.get(halfOf(peer));
        if (half) half.deviceId = nowId;
      }
      saveLocalList();
    }
    watchLocal(peer, track, part);
    delete l.reopening[part];
    if (part === 'main' && l.soundAgain) {
      const was = l.soundAgain;
      l.soundAgain = null;
      reopenLocal(peer, 'sound', was); // (its sound gave up while the picture was away: once more, now it's back)
    }
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
    // (its picture is being opened again too, as when a webcam is unplugged: that decides. If the
    // picture comes back, its sound is tried again; if it goes, it's kept with the sound it had,
    // not saved as a camera without sound)
    if (l.removing || live.get(peer) !== l) return;
    if (l.reopening?.main) return void (l.soundAgain = old);
    l.micId = null;
    toast(`${l.name} has no sound now: its microphone didn't come back`, 8000);
    mixAttach(peer);
    renderMixer();
  }
}
/** The same device as a fresh track: by its id, or (plugged back in somewhere else) by its name, but never one of the same name that's already in the show (one of three webcams that dropped mustn't show another's picture). */
async function openAgain(kind, id, label, sharable = false) {
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const want = kind === 'mic' ? 'audioinput' : 'videoinput';
  // (a camera's sound can come from a microphone another camera uses too: that's the one exception)
  const used = new Set(sharable ? [] : [...live.values()].filter((x) => x.local && x.deviceId && x.deviceId !== id).map((x) => x.deviceId));
  const d = devs.find((x) => x.kind === want && x.deviceId === id) || devs.find((x) => x.kind === want && label && cleanLabel(x.label) === label && !used.has(x.deviceId));
  if (!d) return null;
  const s = kind === 'mic'
    ? await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: d.deviceId }, ...MIC_OPTS } })
    : await openVideo(d.deviceId, label || cleanLabel(d.label), true);
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
  // Unplugged (it didn't come back in 30 s): it stays saved, and comes back when it can. Looked for
  // at once too: a driver installed mid-show brings it back under a new name, already listed, with
  // no device change to come. Removed by hand: it isn't taken by a saved one that's like it.
  if (!l.splitOf && !l.screen) {
    if (why === 'unplugged') {
      const s = savedOf(peer, l);
      for (const set of [couldntOpen, notListed, forgotten]) set.delete(keyOf(s)); // (a fresh start for this one)
      missing.push(s);
      setTimeout(restoreMissing, 2000);
    } else setRemovedByHand(l.deviceId, true);
  }
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
  renderCamCapture();
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
  l.as = 'split';
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
  l.as = 'stereo'; // (both sides, as they are)
  l.name = l.wholeName || l.deviceLabel;
  l.wholeName = null;
  mixAttach(p);
  if (!KIOSK) startLocalRec(p);
  renderLive();
  renderMixer();
  saveLocalList();
  note(`${l.name}: one microphone again (both sides)`);
}
// ---- added as: stereo, two mono tracks, or mono ----
// Chosen when it's added (+ This computer, beside each microphone), and remembered for that
// device. Stereo: one track with both sides, from the start (a stereo mic, a pair on Input 1 and
// 2, a mixer's stereo out); its Mono switch folds it later. Two mono tracks: Input 1 and Input 2,
// each its own track to pan or mute. Mono: one track, both sides folded to the middle. A device
// that opens with one side is mono whatever was chosen.
export const MIC_AS = { stereo: 'Stereo (one track)', split: 'Two mono tracks (Input 1, Input 2)', mono: 'Mono (one track)' };
const MICAS_KEY = 'vm_micas';
const micAsSaved = () => {
  try {
    return JSON.parse(localStorage.getItem(MICAS_KEY) || '{}');
  } catch {
    return {};
  }
};
/** How a microphone of this computer is in the show: 'stereo', 'split' or 'mono'. */
export function setMicAs(peer, as, quiet = false) {
  const p = live.get(peer)?.splitOf || peer, l = live.get(p);
  if (!l?.local || l.role !== 'mic' || l.screen || !MIC_AS[as]) return;
  const all = micAsSaved();
  all[l.deviceId] = all[`label:${l.deviceLabel}`] = as;
  localStorage.setItem(MICAS_KEY, JSON.stringify(all));
  const ch = l.stream.getAudioTracks()[0]?.getSettings?.().channelCount || 1;
  if (ch < 2 && as !== 'mono') {
    if (!quiet) toast(`${l.name} opened with one side only, so it's one mono track${myOs === 'linux' ? ' (an interface on Linux: Pro Audio in the computer’s sound settings gives both inputs)' : ''}`, 8000);
    as = 'mono';
  }
  if (as === 'split') {
    if (!l.side) splitLocalMic(p);
    return;
  }
  if (l.side) joinLocalMic(p);
  l.as = as;
  // (brought back after a reload: a Mono switch changed since stays as it was)
  const cur = mixState(l.cid, 'mic');
  const st = quiet && cur.touched ? cur : { ...cur, mono: as === 'mono' };
  if (st !== cur) mixSave(l.cid, st);
  const nodes = mix.strips.get(p);
  applyStripFx(nodes, st);
  nodes?.fix?.setStereo(true); // (both sides as they are: the right isn't filled from the left)
  saveLocalList();
  renderMixer();
  note(`${l.name}: ${as === 'stereo' ? 'one stereo track' : 'one mono track (both sides)'}`);
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
// Each device's name here, by the device (not only in the list of what's in the show): a camera
// that dropped out and was added again kept its device name and lost the one it was given.
const LOCALNAMES_KEY = 'vm_local_names';
const localNames = () => {
  try {
    return JSON.parse(localStorage.getItem(LOCALNAMES_KEY) || '{}');
  } catch {
    return {};
  }
};
function setLocalName(kind, deviceId, name) {
  if (!deviceId) return;
  const all = localNames();
  if (name) all[`${kind}:${deviceId}`] = name;
  else delete all[`${kind}:${deviceId}`];
  localStorage.setItem(LOCALNAMES_KEY, JSON.stringify(all));
}
/** Any source's name, from the name picker: this computer's keep it with the source, a phone's is kept for that phone. */
export async function renameSource(peer) {
  const l = live.get(peer);
  if (!l) return;
  const original = l.local ? (l.side ? `${l.wholeName || l.deviceLabel} · Input ${l.side === 'L' ? 1 : 2}` : l.deviceLabel) : l.phoneName || '';
  const name = await askTitle({ heading: `Name ${l.name}`, value: l.name, original, kind: l.role === 'mic' ? 'mic' : 'cam' });
  if (name === null || live.get(peer) !== l) return;
  const was = l.name;
  l.name = name || original || l.name;
  if (l.local) {
    if (!l.side && !l.screen) setLocalName(l.role, l.deviceId, name || null);
    saveLocalList();
  } else setTitle(l.cid, name || null);
  renderLive();
  renderMixer();
  ccuSync();
  if (l.name !== was) note(`${was} is now ${l.name}`);
}
export const renameLocal = renameSource;
// a strip's name in the mixer, double-clicked: the same picker (the strip is the source's identity, or its peer)
for (const box of [$('#mixer'), $('#bridge')]) {
  box?.addEventListener('dblclick', (e) => {
    const nm = e.target.closest('.nm, .vname'), id = nm?.closest('[data-strip]')?.dataset.strip;
    const peer = id && [...live].find(([p, l]) => (l.cid || p) === id)?.[0];
    if (!peer || !isHost) return;
    e.preventDefault();
    renameSource(peer);
  });
}
// ---- recording: on the studio's clock, rolling every 5 minutes
// A camera's recording with its sound: with Opus (the steadiest way a browser records a live
// microphone; it plays in Edit and exports the same), in the first format this computer's
// graphics card encodes, else VP8 on the processor. A format that comes out without the sound
// isn't used again this session.
// On the processor VP8 is the lightest (VP9 took almost a whole core more for a 720p webcam on a
// 4-core laptop), but it's still a lot: a 1080p webcam's recording took 29% of a core on a
// 14-thread PC, and the frames were copied off the graphics card for it. On that PC's Intel
// graphics VP9, H.264 and H.265 were encoded on the card for nothing measurable (AV1 and VP8 weren't).
// VP9 keeps WebM; H.264 goes in MP4, as Android phones record it (Chrome writes H.264 asked for in
// WebM as Matroska, whose name the file's extension is chosen from). Which the card encodes is
// asked once (WebCodecs: MediaRecorder uses the same encoders).
const HW_VIDEO_MIMES = { vp9: ['video/webm;codecs=vp9,opus'], h264: ['video/mp4;codecs=avc1.640028,opus', 'video/mp4;codecs=avc1,opus'] };
const LOCAL_VIDEO_MIMES = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=h264,opus', 'video/webm', ...REC_MIMES];
const localMimeNoSound = new Set();
export const hwVideo = { vp9: false, h264: false, asked: false };
(async () => {
  if (!window.VideoEncoder?.isConfigSupported) return;
  const ask = (codec) => VideoEncoder.isConfigSupported({ codec, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30, hardwareAcceleration: 'prefer-hardware' }).then((r) => !!r.supported, () => false);
  [hwVideo.vp9, hwVideo.h264] = await Promise.all([ask('vp09.00.41.08'), ask('avc1.640028')]);
  hwVideo.asked = true;
})();
const hwMimeOf = (m) => (hwVideo.vp9 && HW_VIDEO_MIMES.vp9.includes(m)) || (hwVideo.h264 && HW_VIDEO_MIMES.h264.includes(m));
// The format for this source's recording. The browser's recorder uses the graphics card only for a
// picture of at least 640x480: smaller (a camera that opened at 360p for its USB port), VP9 or
// H.264 would be encoded on the processor, heavier than VP8 there.
function localVideoMime(l) {
  const sound = !l || l.stream.getAudioTracks().length > 0;
  const t = l && (l.recTrack?.readyState === 'live' ? l.recTrack : l.stream.getVideoTracks()[0]);
  const s = t?.getSettings?.() || {};
  const big = !l || ((s.width || 0) >= 640 && (s.height || 0) >= 480);
  const hw = big ? [...(hwVideo.vp9 ? HW_VIDEO_MIMES.vp9 : []), ...(hwVideo.h264 ? HW_VIDEO_MIMES.h264 : [])] : [];
  return [...hw, ...LOCAL_VIDEO_MIMES].find((m) => MediaRecorder.isTypeSupported(m) && !(sound && localMimeNoSound.has(m))) || recMime();
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
// Recorded here: this computer's cameras, microphones and screens, and another computer's screen
// (from /share). That page sends only the live picture and records nothing itself, so without
// this its time on air had no footage in Edit (black there). It's recorded as it arrives, as
// aired: at the size and rate it's sent, the output's.
export const recordedHere = (l) => !!l && (l.local || (!!l.screen && l.role !== 'mic'));
function startLocalRec(peer) {
  const l = live.get(peer);
  if (!recordedHere(l) || l.recorder) return;
  if (l.role !== 'mic' && !l.stream.getVideoTracks().some((t) => t.readyState === 'live')) return; // (being opened again: it starts when it's back)
  const kind = l.role === 'mic' ? 'audio' : 'video';
  const mime = kind === 'audio' ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) : localVideoMime(l);
  // A shared screen is recorded at most 1080p and 15 frames a second (slides and demos need no
  // more), from its own copy of the picture: encoding a full-size screen at 30 on the processor,
  // beside the program recording, was more than a laptop could do (the program skipped frames).
  // (another computer's screen comes already at the output's size, and a received picture can't be
  // made smaller here: it's recorded as it arrives, from the stream itself, so new tracks are used)
  if (l.screen && l.local && kind === 'video' && !l.recTrack) {
    const t = l.stream.getVideoTracks()[0]?.clone();
    if (t) {
      // (the same rate as on air: Chrome reconfigures a shared screen's one capture for any of its
      // tracks, so 15 here held the live screen at 15 as well)
      t.applyConstraints({ width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: screenFps() } }).catch(() => {});
      l.recTrack = t;
    }
  }
  const one = () => {
    const vids = l.recTrack?.readyState === 'live' ? [l.recTrack] : l.stream.getVideoTracks();
    const rec = new MediaRecorder(new MediaStream(kind === 'audio' ? (l.side && l.recAudio ? [l.recAudio] : l.stream.getAudioTracks()) : [...vids, ...l.stream.getAudioTracks()]), { mimeType: mime, videoBitsPerSecond: l.screen ? (qualityFirst() ? 8_000_000 : 3_000_000) : qualityFirst() ? 16_000_000 : 8_000_000, audioBitsPerSecond: 160_000 });
    // (another computer's screen arrives about as late as a phone's picture: on the cameras' clock, as the cuts are)
    const chunks = [], t0 = now() - (l.local ? 0 : LIVE_DELAY), began = performance.now();
    const name = l.name; // (named as it was when it started: a split or a rename can come before it's saved)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) return;
      const s = (l.recTrack || l.stream.getVideoTracks()[0])?.getSettings?.() || {};
      const w = s.width || 0, h = s.height || 0;
      const meta = {
        id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, mime: blob.type || mime, cid: l.cid, name, ...(l.screen && kind === 'video' ? { screen: true } : {}),
        t0, t0Source: 'studio', dur: Math.round(performance.now() - began), w, h, local: true,
        ...(kind === 'video' ? { native: true, audio: (l.stream.getAudioTracks()[0]?.getSettings?.().channelCount || 1) > 1 ? 'stereo' : 'mono', orient: [{ t: 0, rot: 0, rect: null, upright: w >= h ? 'landscape' : 'portrait', ev: 0, ct: 0 }] } : {}),
        // (a camera or screen added without sound: Edit plays the sound as aired under it, see rebuildFromCuts)
        ...(kind === 'video' && !hadSound ? { sound: false } : {}),
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
  note(`Recording ${l.name} (${l.local ? 'this computer' : 'here, as it arrives'}${kind === 'video' ? `, ${mime}${hwMimeOf(mime) ? ' on the graphics card' : ''}` : ''})`);
}
export function rollLocalRec(peer) {
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
export function stopLocalRec(peer, now_) {
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
  if (l.role !== 'mic' && !l.screen) setTimeout(() => localRecFollow(), 700); // (a camera waiting to be its size, after the recorder's last piece)
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
// Whether this computer's camera should be recording: while it's on air during Record program
// (anything aired makes Edit), as the phones do, or by hand. With "Cameras record their time on
// air" off, only by hand: a show log from a 6-core desktop at 1080p had it off, and this
// computer's cameras still recorded each cut at 1080p beside the program, which skipped a fifth of
// its frames. Not at a kiosk: a kiosk never edits, so it records no clips of its own (only the
// program, which goes back to the phones). (The phones' storage setting doesn't apply here.)
const localShouldRec = (peer, l) => !KIOSK && (l.recManual || (autoRecOn() && localAired(peer) && !!progRec && !progRec.stopping));
export function localRecFollow() {
  for (const [peer, l] of live) {
    if (!recordedHere(l) || l.role === 'mic') continue;
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
  // (a camera waiting to be its size, now that it may be free: see syncCamSizes)
  if ([...live.values()].some((l) => l.local && l.role !== 'mic' && !l.screen && (l.stream.getVideoTracks()[0]?.getSettings().height || 0) !== camCapture() && l.sizeTried !== camCapture())) syncCamSizes();
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
    if (recordedHere(l)) n += rollLocalRec(peer) ? 1 : 0;
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
// At most the output's size: left to itself the browser captures a screen at its full size (a
// Retina iMac's is 5120x2880), and every frame of that was copied and shrunk 4x on the page (slow,
// and the text came out jagged) and recorded on air at full size (the computer's whole effort).
// The browser shrinks it as it captures, smoothly; 'detail' keeps it sharp over smooth motion.
// A 1080p screen in a 720p show was shrunk again on every frame, for nothing on air. In a 720p
// show it's the output's frame rate: beside three 720p webcams and Record program, a 720p screen
// at 30 was as smooth as at 15, with the motion on it (a video, the pointer) smooth too. In a
// 1080p show it's 15 a second: a shared screen is the heaviest picture there is for a laptop's
// graphics (Windows copies the desktop for it, and the browser converts it), and at 1080p and 30
// beside three 1080p webcams the graphics were 75-90% busy and Record program skipped up to half
// its frames; at 15, 60% busy and none skipped. 1080p at 15 is about what 720p at 30 costs.
// A desktop-class computer (12 or more cores: a 24-core studio PC held Record program at 30 with
// none dropped) keeps the output's frame rate at 1080p too.
const strongComputer = () => (navigator.hardwareConcurrency || 0) >= 12;
const screenMax = () => (output.height === 1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 });
const screenFps = () => (output.height === 1080 && !strongComputer() ? 15 : Math.min(30, Math.round(output.fps)));
const screenSize = () => ({ width: { max: screenMax().width }, height: { max: screenMax().height }, frameRate: { ideal: screenFps(), max: screenFps() } });
const SCREEN_SOUND = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };

// ---- a shared screen's sound and Windows' default speaker ----
// "System Audio" is what plays on the speaker that was Windows' default when the screen was shared, and
// Chrome keeps it on that speaker. Move Windows to another one during the show and everything plays
// there, while the share hears exact silence with its track still live: a show's Record program had no
// sound from a video on the screen, and neither did the screen's own recording, after Windows went from
// the Focusrite to the Realtek 30 s before. Only Chrome's picker can open it again, which takes a click,
// so the studio says so at once (the show log, Notifications) and offers that click.
export let outputNow = null; // the default speaker's name (known once a camera or microphone is allowed)
async function readOutput() {
  const name = defaultOutputOf(await navigator.mediaDevices?.enumerateDevices?.().catch(() => null));
  if (name && outputNow && name !== outputNow) note(`Windows moved this computer's sound to ${name} (it was ${outputNow})`);
  if (name) outputNow = name;
}
readOutput();
navigator.mediaDevices?.addEventListener?.('devicechange', readOutput);
/** A source just shared: if its sound is Windows' system sound, which speaker it hears. */
async function hearOutput(peer) {
  const l = live.get(peer), a = l?.stream.getAudioTracks()[0];
  if (!l?.screen || !/system audio/i.test(a?.label || '')) {
    if (l) l.sharedOn = null;
    return peer;
  }
  await readOutput();
  l.sharedOn = outputNow;
  if (outputNow) note(`${l.name}'s sound is what plays on ${outputNow}`);
  return peer;
}
/** A shared screen's sound again, from Chrome's picker, for the speaker in use now. Its picture carries on as it is. From Notifications. */
export async function reshareSound(peer) {
  const l = live.get(peer);
  if (!l?.local || !l.screen) return;
  let s;
  try {
    s = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 640 }, height: { max: 360 }, frameRate: { max: 5 } }, audio: SCREEN_SOUND, systemAudio: 'include', windowAudio: 'system', selfBrowserSurface: 'exclude' });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Couldn't share: ${e.message}`, 6000);
    return;
  }
  const a = s.getAudioTracks()[0];
  s.getVideoTracks().forEach((t) => t.stop());
  if (!a) return void toast('No sound came with it. Pick Entire screen and turn on Also share system audio.', 8000);
  if (live.get(peer) !== l) return void a.stop();
  const old = l.stream.getAudioTracks();
  old.forEach((t) => l.stream.removeTrack(t));
  l.stream.addTrack(a);
  l.micLabel = cleanLabel(a.label);
  watchLocal(peer, a, 'sound');
  mixAttach(peer);
  rollLocalRec(peer); // (its recording goes on, with the new sound)
  setTimeout(() => old.forEach((t) => t.stop()), 1000); // (after the last piece of the recording that had it)
  await hearOutput(peer);
  renderMixer();
}
async function addScreenSource(soundOnly) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: screenSize(), audio: SCREEN_SOUND, systemAudio: 'include', windowAudio: 'system', surfaceSwitching: 'include', selfBrowserSurface: 'exclude' });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Couldn't share: ${e.message}`, 6000);
    return null;
  }
  const n = Date.now().toString(36);
  // (a screen with no sound: Chrome's picker has the sound switch off unless it's turned on, and the
  // studio only noted it. Say how, so the next share has it)
  if (!soundOnly && !stream.getAudioTracks().length) {
    toast(myOs === 'mac' ? 'Shared without sound. For a video\'s sound on a Mac, share a Chrome tab and turn on Also share tab audio.' : 'Shared without sound. To bring its sound, share again: pick Entire screen and turn on Also share system audio.', 9000);
  }
  if (soundOnly) {
    const a = stream.getAudioTracks()[0];
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!a) {
      toast(myOs === 'mac' ? 'No sound came with it. On a Mac, share a Chrome tab and tick Share tab audio.' : 'No sound came with it. Pick Entire screen and tick Share system audio (or a tab, with Share tab audio).', 8000);
      return null;
    }
    return hearOutput(registerLocal('mic', new MediaStream([a]), { deviceId: 'sound-' + n, screen: true, label: 'Computer sound' }));
  }
  const v = stream.getVideoTracks()[0];
  try {
    v.contentHint = 'detail';
  } catch {}
  const surface = v.getSettings?.().displaySurface;
  const label = surface === 'monitor' ? 'Screen' : surface === 'browser' ? 'Browser tab' : cleanLabel(v.label) || 'Window';
  return hearOutput(registerLocal('cam', stream, { deviceId: 'screen-' + n, screen: true, label: `${label}${stream.getAudioTracks().length ? '' : ''}` }));
}
// the add list's icons (24-px line drawings, in the text's colour)
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const LICON = {
  cam: svg('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
  screen: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  sound: svg('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  pen: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
// ---- previews in the add list: each camera's picture, each microphone's sound ----
// So you can see what you're adding: a camera in the show shows its own picture; one that isn't is
// opened small (320 x 180, 15 a second) just for the list, and let go before it's added (and when
// the list closes). A microphone's sound is drawn as it comes, each side on its own (an
// interface's Input 1 above, Input 2 below), so a stereo input shows which side has what. On Linux,
// a second input of an interface that's already open isn't opened for its preview: Chrome there
// reads only one of them at a time (the other goes silent; see sharedInterface).
const pendingNames = new Map(); // device → the name it'll be added with
const previews = new Map(); // 'cam:id' / 'mic:id' → { stream, own, inShow, an: [L, R], ch, hist, skip, opening }
let pvCtx = null, pvRaf = 0, pvGen = 0;
async function stopPreview(key, wait) {
  const p = previews.get(key);
  if (!p) return;
  previews.delete(key);
  // (still opening: wait for it, then let go. Added meanwhile, a camera was opened while its
  // 320 x 180 preview was, and Windows gave both that size: it came into the show at 320 x 180, 15 a second)
  if (p.own && p.opening && p.pending) p.stream = await p.pending.catch(() => null);
  if (p.own) p.stream?.getTracks().forEach((t) => t.stop());
  try {
    p.src?.disconnect();
  } catch {}
  if (wait && p.own && p.stream) await new Promise((r) => setTimeout(r, 350)); // (Windows lets go of a camera a moment after)
}
function stopPreviews() {
  pvGen++;
  for (const k of [...previews.keys()]) stopPreview(k);
  cancelAnimationFrame(pvRaf);
  pvRaf = 0;
  pvCtx?.close().catch(() => {});
  pvCtx = null;
  $('#localList')?.querySelectorAll('.lthumb video').forEach((v) => (v.srcObject = null)); // (the cameras in the show go on; the list stops showing them)
}
$('#localDlg')?.addEventListener('close', stopPreviews);
function meterOf(p, track) {
  pvCtx ||= new AudioContext();
  pvCtx.resume().catch(() => {});
  p.ch = track.getSettings?.().channelCount || 1;
  p.src = pvCtx.createMediaStreamSource(new MediaStream([track]));
  const split = pvCtx.createChannelSplitter(2);
  p.src.connect(split);
  p.an = [0, 1].map((i) => {
    const a = pvCtx.createAnalyser();
    a.fftSize = 1024;
    split.connect(a, i);
    return a;
  });
  p.hist = [[], []];
}
async function attachPreviews(cams, mics, inShowPeer) {
  const gen = pvGen;
  const want = [...cams.map((d) => ['cam', d]), ...mics.map((d) => ['mic', d])];
  const openGroups = new Set([...live.values()].filter((l) => l.local).flatMap((l) => l.stream.getAudioTracks().map((t) => t.getSettings?.().groupId)).filter(Boolean));
  // the ones already showing first (no wait), then each new one in turn (opening them all at once is a lot for USB)
  for (const [kind, d] of want) showPreview(`${kind}:${d.deviceId}`);
  for (const [kind, d] of want) {
    if (gen !== pvGen) return;
    const key = `${kind}:${d.deviceId}`, peer = inShowPeer.get(d.deviceId), l = peer && live.get(peer);
    let p = previews.get(key);
    // in the show: its own picture or sound (a preview of its own, if it had one, lets go)
    if (l && !p?.inShow) {
      if (p) await stopPreview(key);
      const track = kind === 'cam' ? l.stream.getVideoTracks()[0] : l.stream.getAudioTracks()[0];
      p = { stream: track ? new MediaStream([track]) : null, own: false, inShow: true };
      if (kind === 'mic' && track) meterOf(p, track);
      previews.set(key, p);
    } else if (!l && p?.inShow) {
      previews.delete(key); // (it left the show: a preview of its own)
      p = null;
    }
    if (!p) {
      if (kind === 'mic' && myOs === 'linux' && d.groupId && openGroups.has(d.groupId)) {
        previews.set(key, { skip: 'Its sound shows once it’s added' });
      } else {
        p = { own: true, opening: true };
        previews.set(key, p);
        showPreview(key);
        try {
          p.pending = navigator.mediaDevices.getUserMedia(kind === 'cam'
            ? { video: { deviceId: { exact: d.deviceId }, width: { ideal: 320 }, height: { ideal: 180 }, frameRate: { max: 15 } } }
            : { audio: { deviceId: { exact: d.deviceId }, ...MIC_OPTS } });
          const s = await p.pending;
          if (gen !== pvGen || previews.get(key) !== p) {
            s.getTracks().forEach((t) => t.stop());
            continue;
          }
          p.stream = s;
          if (kind === 'mic') {
            meterOf(p, s.getAudioTracks()[0]);
            if (d.groupId) openGroups.add(d.groupId);
          }
        } catch (e) {
          p.skip = /timeout|could not start|NotReadable/i.test(`${e.name} ${e.message}`) ? 'In use, or its USB port is full' : 'No preview';
        }
        p.opening = false;
      }
    }
    showPreview(key);
    if (!pvRaf && [...previews.values()].some((x) => x.an)) pvRaf = requestAnimationFrame(drawPreviews);
  }
}
function showPreview(key) {
  const p = previews.get(key), el = $('#localList')?.querySelector(`[data-pv="${CSS.escape(key)}"]`);
  if (!el) return;
  const v = el.querySelector('video');
  if (v && p?.stream && v.srcObject !== p.stream) {
    v.srcObject = p.stream;
    v.play().catch(() => {});
  }
  el.classList.toggle('live', !!p?.stream);
  el.querySelector('.lpvs').textContent = !p ? '' : p.skip || (p.opening ? 'Opening…' : key.startsWith('mic:') && p.ch ? (p.ch > 1 ? 'Stereo' : 'Mono') : '');
}
const pvBuf = new Float32Array(1024);
function drawPreviews() {
  pvRaf = 0;
  if (!$('#localDlg')?.open) return;
  for (const [key, p] of previews) {
    if (!p.an) continue;
    const el = $('#localList').querySelector(`[data-pv="${CSS.escape(key)}"] canvas`);
    if (!el) continue;
    const sides = p.ch > 1 ? 2 : 1;
    for (let i = 0; i < sides; i++) {
      p.an[i].getFloatTimeDomainData(pvBuf);
      let m = 0;
      for (const x of pvBuf) m = Math.max(m, Math.abs(x));
      const h = p.hist[i];
      h.push(Math.min(1, Math.max(0, (20 * Math.log10(m || 1e-6) + 60) / 60))); // (-60 dB to 0, as the meters)
      if (h.length > 64) h.shift();
    }
    const g = el.getContext('2d'), W = el.width, H = el.height, bw = W / 64;
    g.fillStyle = '#04060c';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < sides; i++) {
      const mid = sides === 2 ? (i === 0 ? H * 0.28 : H * 0.72) : H / 2, amp = sides === 2 ? H * 0.2 : H * 0.4;
      const h = p.hist[i];
      h.forEach((v, j) => {
        const bh = Math.max(1, v * amp);
        g.fillStyle = v > 0.9 ? '#ff5a52' : v > 0.75 ? '#ffb21e' : '#2fd56b';
        g.fillRect(W - (h.length - j) * bw, mid - bh, bw - 1, bh * 2);
      });
      if (sides === 2) {
        g.fillStyle = '#ffffffb3';
        g.font = '700 18px system-ui, sans-serif';
        g.fillText(i === 0 ? 'L' : 'R', 8, mid + 6);
      }
    }
  }
  pvRaf = requestAnimationFrame(drawPreviews);
}
async function openLocalPicker(o) {
  const dlg = $('#localDlg');
  let devs = await navigator.mediaDevices.enumerateDevices();
  const named = devs.some((d) => d.label);
  const inShow = new Set([...live.values()].filter((l) => l.local).map((l) => l.deviceId));
  const cams = devs.filter((d) => d.kind === 'videoinput' && d.deviceId), mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const sound = (d) => {
    const pick = soundFor(d, devs), pickId = pick?.deviceId === 'default' ? mics.find((m) => m.groupId === pick.groupId)?.deviceId || 'default' : pick?.deviceId;
    return `<label class="lopt"><span>Sound</span><select data-snd="${esc(d.deviceId)}" aria-label="Sound for ${esc(nameOf(d))}">${mics.map((m) => `<option value="${esc(m.deviceId)}" ${m.deviceId === pickId ? 'selected' : ''}>${esc(nameOf(m))}</option>`).join('')}${pickId === 'default' ? '<option value="default" selected>This computer’s microphone</option>' : ''}<option value="" ${pick ? '' : 'selected'}>No sound</option></select></label>`;
  };
  const asSel = (d) => {
    const v = micAsSaved()[d.deviceId] || micAsSaved()[`label:${cleanLabel(d.label)}`] || 'stereo';
    return `<label class="lopt"><span>As</span><select data-as="${esc(d.deviceId)}" aria-label="Add ${esc(nameOf(d))} as">${Object.entries(MIC_AS).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  };
  // two of the same webcam are told apart as the show names them (Logitech Webcam C930e, … 2)
  const seen = new Map(), names = new Map();
  for (const d of [...cams, ...mics]) {
    const base = cleanLabel(d.label).replace(/\(\d+- /, '(') || (d.kind === 'audioinput' ? 'Microphone' : 'Camera');
    const k = `${d.kind}:${base}`, n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    names.set(d.deviceId + d.kind, n > 1 ? `${base} ${n}` : base);
  }
  function nameOf(d) {
    return names.get(d.deviceId + d.kind) || cleanLabel(d.label);
  }
  const row = (icon, title, sub, opts, action, cls = '', thumb = '') => `<li class="ldev ${cls}${thumb ? ' hasthumb' : ''}">${thumb || `<span class="lico" aria-hidden="true">${LICON[icon]}</span>`}<span class="lmain"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}${opts ? `<span class="lopts">${opts}</span>` : ''}</span><span class="lact">${action}</span></li>`;
  const inShowPeer = new Map([...live].filter(([, l]) => l.local && !l.splitOf).map(([p, l]) => [l.deviceId, p]));
  const dev = (d, kind) => {
    const inn = inShow.has(d.deviceId), peer = inShowPeer.get(d.deviceId), l = peer && live.get(peer);
    const thumb = `<span class="lthumb ${kind}" data-pv="${kind}:${esc(d.deviceId)}" aria-hidden="true">${kind === 'cam' ? '<video muted playsinline autoplay></video>' : '<canvas width="256" height="144"></canvas>'}<i class="lpvi">${LICON[kind]}</i><em class="lpvs"></em></span>`;
    const given = !l && (pendingNames.get(d.deviceId) || localNames()[`${kind}:${d.deviceId}`]); // (the name it'll come in with)
    const shown = l ? (l.side ? `${l.wholeName || l.deviceLabel} (two microphones)` : l.name) : given || nameOf(d);
    const nameBtn = l?.side ? '' : `<button type="button" class="lname" data-name-dev="${esc(d.deviceId)}" data-kind="${kind}" data-own="${esc(nameOf(d))}"${l ? ` data-peer="${esc(peer)}"` : ''} title="Name it" aria-label="Name ${esc(shown)}">${LICON.pen}</button>`;
    const title = `<span class="lt">${esc(shown)}</span>${nameBtn}${given ? `<small class="lown">${esc(nameOf(d))}</small>` : ''}`;
    return row(kind, title, '', inn ? '' : kind === 'cam' ? sound(d) : asSel(d), inn ? '<span class="lbadge">In the show</span>' : `<button type="button" class="ladd" data-add="${kind}" data-dev="${esc(d.deviceId)}">Add</button>`, inn ? 'in' : '', thumb);
  };
  const sec = (title, items, empty, count = true) => `<section class="lsec"><h3>${title}${count && items.length ? ` <span class="n">${items.length}</span>` : ''}</h3><ul class="ldevs">${items.join('') || `<li class="lnone">${empty}</li>`}</ul></section>`;
  // saved ones not in the show: they come back when they can, or can be forgotten (each says why:
  // the browser asks for cameras and microphones separately)
  const perm = { cam: await devState('camera'), mic: await devState('microphone') };
  const tries = (s) => couldntOpen.get(keyOf(s)) || 0;
  // (stopped trying: each time this list opens, it's tried once more, with its saved settings)
  const stuck = missing.filter((s) => tries(s) > RETRIES && !notListed.has(keyOf(s)));
  const why = (s) => (perm[s.kind] !== 'granted' ? `Kept: it comes back once this computer’s ${s.kind === 'mic' ? 'microphones are' : 'cameras are'} allowed`
    : !tries(s) || notListed.has(keyOf(s)) ? 'Not plugged in: it comes back into the show when it is'
    : tries(s) <= RETRIES ? 'Plugged in, but it couldn’t be opened (another app may be using it): it’s tried again'
    : 'Plugged in, but it couldn’t be opened: close any other app using it. It’s tried again each time this list opens');
  const gone = (kind) => missing.filter((s) => s.kind === kind).map((s) => row(kind, `<span class="lt">${esc(s.name || s.label)}</span>${s.name && s.name !== s.label ? `<small class="lown">${esc(s.label)}</small>` : ''}`, why(s), '', `<button type="button" class="ladd lforget" data-forget="${esc(`${s.kind}:${s.deviceId}`)}" title="Stop bringing it back">Forget</button>`, 'gone'));
  const shares = [
    row('screen', 'A screen or window', 'With its sound, if the browser shares it', '', '<button type="button" class="ladd" data-share="screen">Share…</button>'),
    row('sound', 'This computer’s sound', myOs === 'mac' ? 'On a Mac: a Chrome tab’s sound (tick Share tab audio)' : 'Pick Entire screen and tick Share system audio', '', '<button type="button" class="ladd" data-share="sound">Share…</button>'),
    row('link', 'Another computer’s screen', `Open <b id="shareUrl">${esc(shareUrl())}</b> on it, name it, share`, '', '<button type="button" class="ladd" data-copy-share>Copy link</button>'),
  ];
  // (the OK asked for when nothing is listed, or a kind with saved ones waiting isn't allowed yet)
  const allow = !named || missing.some((s) => perm[s.kind] !== 'granted');
  $('#localList').innerHTML = (allow ? `<div class="lallow"><span class="lico" aria-hidden="true">${LICON.cam}</span><p>To list this computer’s cameras and microphones, the browser needs your OK.</p><button type="button" class="primary" id="localAllow">Allow cameras and microphones</button></div>` : '')
    + (named
      ? sec('Cameras', [...cams.map((d) => dev(d, 'cam')), ...gone('cam')], 'None found') + sec('Microphones', [...mics.map((d) => dev(d, 'mic')), ...gone('mic')], 'None found')
      : missing.length ? sec('Kept from before', [...gone('cam'), ...gone('mic')], '') : '')
    + sec('Screen and sound', shares, '', false);
  if (!dlg.open) {
    pvGen++;
    dlg.showModal();
    $('#localList').focus({ preventScroll: true }); // (the list, not the close button, has the focus when it opens)
  }
  if (named) attachPreviews(cams, mics, inShowPeer);
  if (stuck.length && !o?.noRetry) {
    for (const s of stuck) couldntOpen.set(keyOf(s), RETRIES); // (one more try each: no more timers after it)
    restoreMissing().then(() => $('#localDlg').open && openLocalPicker({ noRetry: true })); // (redrawn once: not tried again by that)
  }
}
$('#addLocal').onclick = openLocalPicker;
/** The page another computer opens to share its screen into this show (see share.js). */
export const shareUrl = () => `${shareBase}/share?e=${eventId}`;
// On this computer's own dev server (localhost), the link said localhost, which another computer
// can't open, and sharing a screen needs a secure address: the dev server's https address on this
// network instead, when it has one (see dev/server.mjs).
let shareBase = location.origin;
if (/^(localhost|127.0.0.1|[::1])$/.test(location.hostname)) {
  fetch('/_dev/lan').then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j?.https?.[0]) return;
    shareBase = j.https[0];
    const el = document.getElementById('shareUrl');
    if (el) el.textContent = shareUrl();
  }).catch(() => {});
}
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
    await restoreMissing(); // (the saved ones, now they're allowed)
    return openLocalPicker();
  }
  const fg = e.target.closest('[data-forget]');
  if (fg) {
    const s = missing.find((x) => keyOf(x) === fg.dataset.forget) || [...inflight.keys()].find((x) => keyOf(x) === fg.dataset.forget);
    missing = missing.filter((x) => x !== s);
    if (s && inflight.has(s)) forgotten.add(fg.dataset.forget); // (being opened right now: not kept if that fails)
    couldntOpen.delete(fg.dataset.forget);
    notListed.delete(fg.dataset.forget);
    saveLocalList();
    if (s) note(`${s.name || s.label}: forgotten (not brought back when it's plugged in)`);
    return void openLocalPicker();
  }
  const nb = e.target.closest('[data-name-dev]');
  if (nb) {
    const peer = nb.dataset.peer;
    if (peer) return void renameSource(peer).then(() => openLocalPicker());
    const dev = nb.dataset.nameDev;
    const name = await askTitle({ heading: `Name ${nb.dataset.own}`, value: pendingNames.get(dev) || localNames()[`${nb.dataset.kind}:${dev}`] || nb.dataset.own, original: nb.dataset.own, kind: nb.dataset.kind });
    if (name === null) return;
    if (name) pendingNames.set(dev, name);
    else {
      pendingNames.delete(dev);
      setLocalName(nb.dataset.kind, dev, null); // (its own name: the one it was given before goes too)
    }
    return void openLocalPicker();
  }
  const b = e.target.closest('[data-add]');
  if (!b || b.disabled) return;
  $('#localList').querySelectorAll(`[data-dev="${CSS.escape(b.dataset.dev)}"]`).forEach((x) => (x.disabled = true)); // (one add at a time)
  b.textContent = 'Opening';
  b.title = 'Opening it at full size (a camera that has to go smaller takes about 20 s)';
  const row = b.closest('.ldev');
  row?.classList.add('busy');
  // (its preview has let go of it for the show: say so where the picture was)
  const th = row?.querySelector('.lthumb');
  if (th) {
    th.classList.remove('live');
    th.querySelector('.lpvs').textContent = 'Opening…';
  }
  const snd = b.dataset.add === 'cam' ? $('#localList').querySelector(`[data-snd="${CSS.escape(b.dataset.dev)}"]`)?.value ?? undefined : undefined;
  const as = b.dataset.add === 'mic' ? $('#localList').querySelector(`[data-as="${CSS.escape(b.dataset.dev)}"]`)?.value : undefined;
  // (its preview lets go of the device first: Windows opens a camera that's still open only at the size it's open at)
  await stopPreview(`${b.dataset.add}:${b.dataset.dev}`, true);
  try {
    const was = missingFor(b.dataset.add, b.dataset.dev); // (before it's added: its save comes first)
    const peer = await addLocalSource(b.dataset.add, b.dataset.dev, pendingNames.get(b.dataset.dev) || undefined, false, snd === undefined ? undefined : snd || null, as);
    if (peer) consumeFor(peer, was); // (a saved one that's this device isn't missing now)
    if (pendingNames.has(b.dataset.dev)) setLocalName(b.dataset.add, b.dataset.dev, pendingNames.get(b.dataset.dev));
    pendingNames.delete(b.dataset.dev);
  } catch (err) {
    toast(err.name === 'NotReadableError' ? 'That device is busy (another app may be using it)' : err.message, 6000);
  }
  openLocalPicker();
});
// the ones added before come back (when the browser still allows it): by their id, or (ids and
// names can change) their name, their USB id or, an interface whose maker's driver renamed it, the
// one device of that maker on the other driver (see devmatch.js)
const devState = (kind) => navigator.permissions?.query({ name: kind }).then((p) => p.state).catch(() => null);
/** Device ids a saved one mustn't take by anything but its own id: in the show, another saved one's, or removed by hand. */
function claimedFor(s, saved, devs, taken) {
  const ids = new Set([...taken, ...removedByHand()]);
  for (const l of live.values()) if (l.local && l.deviceId) ids.add(l.deviceId);
  for (const o of saved) if (o !== s && devs.some((d) => d.deviceId === o.deviceId)) ids.add(o.deviceId);
  return ids;
}
// Missing ones whose device is listed but didn't open (another app holding it, a camera that timed
// out): no device change is coming for those, so they're tried again a few times, and + This
// computer says so rather than "not plugged in".
const couldntOpen = new Map(); // key → tries
const RETRY_MS = 15_000, RETRIES = 6;
let retryTimer = null; // (one for all of them: each failing one counts its own tries)
function openFailed(s) {
  const n = (couldntOpen.get(keyOf(s)) || 0) + 1;
  couldntOpen.set(keyOf(s), n);
  if (n <= RETRIES && !retryTimer) retryTimer = setTimeout(() => {
    retryTimer = null;
    restoreMissing();
  }, RETRY_MS);
}
/** It failed to open: kept, and tried again (unless it was forgotten meanwhile). */
function keepFailed(s) {
  if (forgotten.delete(keyOf(s))) return;
  missing.push(s);
  openFailed(s);
}
/** The missing one a device added by hand is, looked for before it's added (its save comes first): its own entry, by its id, and nothing else (a guess by name took a twin's). */
function missingFor(kind, deviceId) {
  return missing.find((x) => x.kind === kind && x.deviceId === deviceId) || null;
}
/** Added by hand: the missing one it is (found by missingFor before it was added) is in the show now, and the device isn't "removed by hand" any more. */
function consumeFor(peer, s) {
  const l = live.get(peer);
  if (!l?.local || l.screen) return;
  setRemovedByHand(l.deviceId, false);
  if (!s) return;
  missing = missing.filter((x) => x !== s);
  couldntOpen.delete(keyOf(s));
  notListed.delete(keyOf(s));
  forgotten.delete(keyOf(s));
  saveLocalList();
}
/** A saved one, found as m ({ d, how }), into the show again; under a new name, its own name, mixer settings and given names come with it. */
async function bringBack(s, m, devs) {
  const now = cleanLabel(m.d.label), moved = m.how !== 'id' && now !== s.label;
  let micId;
  if (s.kind === 'cam' && s.sound === false) micId = null;
  // (a camera saved with "Default" as its sound, from before: it picks a microphone by name again)
  else if (s.kind === 'cam' && s.micId !== 'default' && (s.micId || s.micLabel)) micId = (devs.find((d) => d.deviceId === s.micId) || devs.find((d) => d.kind === 'audioinput' && cleanLabel(d.label) === s.micLabel))?.deviceId;
  if (moved || m.d.deviceId !== s.deviceId) carryOver(s, m.d.deviceId);
  const name = moved && (!s.name || s.name === s.label) ? undefined : s.name; // (named after the device: after its new name)
  inflight.set(s, m.d.deviceId); // (kept in the saved list while it opens: a camera stepping down can take 30 s)
  const pid = `local-${s.kind}-${hashStr(m.d.deviceId)}`;
  let peer = null, already = false;
  try {
    peer = (await addLocalSource(s.kind, m.d.deviceId, name, true, micId, s.split ? undefined : s.as).catch((e) => void note(`${s.label || 'A source'} on this computer isn't available now: ${e.message}`))) || null;
    // (already in the show, added by hand meanwhile: that's it back, as it was added)
    if (!peer && live.has(pid)) [peer, already] = [pid, true];
  } finally {
    inflight.delete(s);
  }
  if (!peer) return null;
  forgotten.delete(keyOf(s)); // (in the show again: nothing to forget)
  if (already) return peer;
  if (s.split) splitLocalMic(peer, moved ? renamed(s.split, s.label, now) : s.split);
  if (moved) note(`${s.label} is here under another name: ${now} (found by its ${{ usb: 'USB id', driver: 'maker, whose driver renamed it', name: 'name' }[m.how] || m.how}). Its settings came with it.`);
  return peer;
}
/** A saved one under a new device id: the name it was given here and its mixer settings in this show go with it. */
function carryOver(s, toId) {
  const names = localNames(), was = names[`${s.kind}:${s.deviceId}`];
  if (was && !names[`${s.kind}:${toId}`]) setLocalName(s.kind, toId, was);
  const cid = (id) => 'L' + hashStr(`${s.kind}:${id}`).slice(0, 10);
  for (const side of ['', 'R']) {
    const { touched, ...st } = mixState(cid(s.deviceId) + side, s.kind);
    if (touched && !mixState(cid(toId) + side, s.kind).touched) mixSave(cid(toId) + side, st);
  }
}
let restoredOnce = false; // (a device plugged in while the saved ones are still opening waits for them)
setTimeout(async () => {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    saved = [];
  }
  if (!saved.length || !isHost || EDIT_ONLY) return void (restoredOnce = true); // (the Edit page uses no cameras)
  pending = saved.slice(); // (each leaves as it's looked at: a save meanwhile keeps the rest)
  try {
    const cam = await devState('camera'), mic = await devState('microphone');
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const taken = new Set(); // (each saved one gets a different device: three of the same webcam stay three)
    for (const s of saved) {
      pending = pending.filter((x) => x !== s);
      if ((s.kind === 'mic' ? mic : cam) !== 'granted') {
        missing.push(s); // (kept: back once they're allowed)
        continue;
      }
      const m = matchSaved(s, devs, claimedFor(s, saved, devs, taken));
      if (!m) {
        missing.push(s);
        notListed.add(keyOf(s));
        note(`${s.label || 'A source'} on this computer isn't plugged in now: it's kept, and comes back when it's plugged in`);
        continue;
      }
      notListed.delete(keyOf(s));
      taken.add(m.d.deviceId);
      if (!(await bringBack(s, m, devs))) keepFailed(s);
    }
    if (saved.some((s) => (s.kind === 'mic' ? mic : cam) !== 'granted')) toast('This computer\u2019s cameras and microphones are off until you allow them: + This computer', 7000);
  } finally {
    missing.push(...pending); // (only if something went wrong on the way)
    pending = [];
    saveLocalList(); // (with the ones still missing)
    restoredOnce = true;
    if (restoreAgain) restoreMissing(); // (one plugged in meanwhile)
  }
}, 1500);
// A missing one plugged in (or found under a new name) comes back into the show then and there.
// Asked again while it's looking (a hub's devices arrive one by one, each with its own device
// change) or before the startup restore is done, it looks once more when it's done.
let restoring = null, restoreAgain = false;
export function restoreMissing() {
  if (!isHost || EDIT_ONLY) return Promise.resolve();
  if (!restoredOnce || restoring) {
    restoreAgain = true;
    return restoring || Promise.resolve();
  }
  if (!missing.length) return Promise.resolve();
  restoring = (async () => {
    do {
      restoreAgain = false;
      const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      const taken = new Set();
      for (const s of [...missing]) {
        if (!missing.includes(s)) continue; // (forgotten meanwhile)
        if ((await devState(s.kind === 'mic' ? 'microphone' : 'camera')) !== 'granted') continue;
        const m = matchSaved(s, devs, claimedFor(s, missing, devs, taken));
        // (not listed this time: its tries aren't reset, so two of the same name taking turns at one
        // device that won't open still run out of tries)
        if (!m) {
          notListed.add(keyOf(s));
          continue;
        }
        notListed.delete(keyOf(s));
        taken.add(m.d.deviceId);
        missing = missing.filter((x) => x !== s);
        const peer = await bringBack(s, m, devs);
        if (!peer) keepFailed(s);
        else {
          const stuck = couldntOpen.delete(keyOf(s)); // (listed all along: it opened this time)
          note(`${live.get(peer)?.name || s.label} ${stuck ? 'opened this time' : 'is plugged in again'}: back in the show`);
          toast(`${live.get(peer)?.name || s.label} is back in the show`, 5000);
        }
      }
      saveLocalList();
    } while (restoreAgain);
  })().finally(() => {
    restoring = null;
  });
  return restoring;
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => setTimeout(restoreMissing, 1500)); // (once Windows has it ready)
window.vmMissingSaved = missingSaved; // (tests and diagnostics)
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
