// Studio, part 7 of 23: this computer's cameras, mics, screen and sound; recording; moderation.
// Loads after mixer.js: that import comes first, so the parts run in order (see ../studio.js).
import './mixer.js';
import { api, toast, esc, now } from '/js/vm.js';
import { snapToCamera } from '/js/camctl.js';
import * as idb from '/js/idb.js';
import {
  $, EDIT_ONLY, KIOSK, REC_MIMES, black, clips, eventId, hub, isHost, key, live, liveActive, note,
  player, recMime, seq, setLiveActive,
} from './core.js';
import { addClip, noteAngle, rebuild } from './clips.js';
import { renderLive } from './live.js';
import { syncTally } from './onair.js';
import { mixAttach, renderMixer } from './mixer.js';
import { ccuSync } from './ccu.js';
import { myOs } from './stream.js';
import { mediaOn, onBreak } from './graphics.js';
import { progRec, pvw, setPreview, sw, swActive } from './switcher.js';
import { renderTimeline } from './edit.js';
import { renderMedia } from './library.js';

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
  const list = [...live].filter(([, l]) => l.local && !l.screen).map(([, l]) => ({ kind: l.role, deviceId: l.deviceId, label: l.deviceLabel, name: l.name, micId: l.micId || null, micLabel: l.micLabel || null, sound: l.role === 'cam' ? !!l.micId : undefined }));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}
// A camera on this computer brings its sound, as a phone does: the microphone in the same
// device (a USB webcam's own mic, which the browser groups with it), else one whose name
// matches, else the computer's own microphone (a built-in camera like the FaceTime camera has
// no mic of its own). The picker shows which, and it can be changed or turned off.
const MIC_OPTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
function soundFor(cam, devs) {
  const mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  const real = mics.filter((d) => d.deviceId !== 'default');
  const words = (s) => cleanLabel(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['camera', 'microphone', 'audio', 'video', 'webcam', 'usb', 'default'].includes(w));
  const camWords = words(cam.label);
  return (
    real.find((m) => cam.groupId && m.groupId === cam.groupId) ||
    real.find((m) => camWords.length && words(m.label).some((w) => camWords.includes(w))) ||
    mics.find((m) => m.deviceId === 'default') ||
    real.find((m) => /built-?in|internal|macbook/i.test(m.label)) ||
    real[0] ||
    null
  );
}
async function addLocalSource(kind, deviceId, name, quiet, micId) {
  if (kind === 'cam' && micId === undefined) {
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cam = devs.find((d) => d.deviceId === deviceId);
    micId = cam ? soundFor(cam, devs)?.deviceId || null : null;
  }
  const constraints = kind === 'mic'
    ? { audio: { deviceId: { exact: deviceId }, ...MIC_OPTS } }
    : { video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, ...(micId ? { audio: { deviceId: { exact: micId }, ...MIC_OPTS } } : {}) };
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
  track.addEventListener('ended', () => removeLocalSource(peer, 'unplugged'));
  mixAttach(peer);
  if (kind === 'cam') localCamState(peer);
  renderLive();
  renderMixer();
  saveLocalList();
  if (kind === 'mic') !KIOSK && startLocalRec(peer);
  else localRecFollow();
  note(`${label} added from this computer${micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : kind === 'cam' ? ', without sound' : ''}`);
  if (!quiet) toast(`${live.get(peer).name} is in the show${kind === 'mic' ? ' (recording)' : micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : ''}`);
  return peer;
}
export function removeLocalSource(peer, why) {
  const l = live.get(peer);
  if (!l?.local) return;
  stopLocalRec(peer, true);
  l.stream.getTracks().forEach((t) => t.stop());
  if (hub?.onLiveEnd) hub.onLiveEnd(peer, why || 'removed');
  else live.delete(peer);
  saveLocalList();
  renderLive();
  renderMixer();
}
export function renameLocal(peer) {
  const l = live.get(peer);
  const name = l && prompt('Name for this source', l.name);
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
const LOCAL_VIDEO_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm', ...REC_MIMES];
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
  const one = () => {
    const rec = new MediaRecorder(new MediaStream(kind === 'audio' ? l.stream.getAudioTracks() : [...l.stream.getVideoTracks(), ...l.stream.getAudioTracks()]), { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [], t0 = now(), began = performance.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) return;
      const s = l.stream.getVideoTracks()[0]?.getSettings?.() || {};
      const w = s.width || 0, h = s.height || 0;
      const meta = {
        id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, mime: blob.type || mime, cid: l.cid, name: l.name,
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
  return (peer === liveActive || (swActive() && peer === sw.to)) && !onBreak() && !mediaOn && !(black.target === 1 && black.cleared);
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
async function addScreenSource(soundOnly) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }, systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude' });
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
  $('#localList').insertAdjacentHTML('beforeend', `<h3>Screen and sound</h3><ul><li><span>A screen or window<small class="fine">with its sound, if the browser shares it</small></span><button type="button" data-share="screen">Share…</button></li><li><span>This computer\u2019s sound<small class="fine">${myOs === 'mac' ? 'on a Mac: a Chrome tab\u2019s sound (tick Share tab audio)' : 'pick Entire screen and tick Share system audio'}</small></span><button type="button" data-share="sound">Share…</button></li></ul>`);
  if (!dlg.open) dlg.showModal();
}
$('#addLocal').onclick = openLocalPicker;
$('#localList').addEventListener('click', async (e) => {
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
    else if (s.kind === 'cam' && (s.micId || s.micLabel)) micId = (devs.find((d) => d.deviceId === s.micId) || devs.find((d) => d.kind === 'audioinput' && cleanLabel(d.label) === s.micLabel))?.deviceId;
    await addLocalSource(s.kind, same.deviceId, s.name, true, micId).catch((e) => note(`${s.label || 'A source'} on this computer isn't available now: ${e.message}`));
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
