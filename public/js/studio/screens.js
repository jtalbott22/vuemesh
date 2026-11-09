// Studio, part 23 of 26: the Monitor, the phone remote, TV screens.
// Loads after export.js: that import comes first, so the parts run in order (see ../studio.js).
import './export.js';
import { toast, esc, now, drawQR, decodeQR } from '/js/vm.js';
import { studioAnswer, decode as decodeJoin } from '/js/qrjoin.js';
import { RemoteHost } from '/js/remote-host.js';
import { DisplayHub } from '/js/display-hub.js';
import * as S from '/js/sequence.js';
import { whatsWrong } from '/js/director.js';
import {
  $, black, clips, connectLocal, EDIT_ONLY, ev, eventId, gainToDb, hub, isHost, key, live, liveActive, log, note,
  isRemoteCam, orientation, pressTwice, program, rawBlobs, seq, sock, thumbs,
} from './core.js';
import { audioClips, output } from './clips.js';
import { camOrder, cutLive, liveNo, micPeers } from './live.js';
import { scoreOfLive } from './usage.js';
import { autoOn, directorBreak, setAuto } from './onair.js';
import { mix, mixState, MODE_LABEL, MODES, setStripGain, setStripMode } from './mixer.js';
import { streamOut } from './stream.js';
import {
  blackLevel, breakManual, cutMedia, mediaOn, onBreak, reel, toggleBlack, toggleBreak,
} from './graphics.js';
import { progRec, programVideoTrack, pvw, reelOf } from './switcher.js';
import { recByHand } from './autopilot.js';
import { incoming, monitorLight, outgoing, sentLog, setMonitorSeenAt } from './phones.js';
import { clipTitle, deleteRecording } from './library.js';
import { exporting, rendering } from './export.js';
import { renderNotifs, showLogBrief } from './showlog.js';
import { pipAir, pipSettings, setPip } from './pip.js';

// ---------------------------------------------------------------- monitor ----
// The Monitor tab (same browser) listens here: network, device and transfer
// details for every phone, plus the event log. Nothing leaves this computer.

const monitorChannel = 'BroadcastChannel' in window ? new BroadcastChannel('vuemesh-monitor-' + eventId) : null;
// the Monitor says when someone is looking at it: the button's news light goes out
if (monitorChannel) monitorChannel.onmessage = (e) => {
  // Monitor deletes a recording (it asked there): from this computer and the editor
  if (e.data?.type === 'delete' && e.data.id && isHost && !EDIT_ONLY) return void deleteRecording(e.data.id, { confirmed: true });
  // a Monitor that's on screen wants the program's small picture (it asks again every 2 s)
  if (e.data?.type === 'pgmWant') return void (pgmWantAt = Date.now());
  if (e.data?.type === 'seen') {
    setMonitorSeenAt(Date.now());
    monitorLight();
  }
};
// The program's small picture, for the Monitor's top bar: a still a few times a second, only
// while a Monitor on screen asks for it: a 384-wide JPEG, encoded off the page's own thread;
// no video encoder and nothing on the network, so it costs next to nothing.
let pgmWantAt = 0, pgmBusy = false, pgmCanvas = null;
export async function pushPgmFrame() {
  if (!monitorChannel || pgmBusy || Date.now() - pgmWantAt > 5000 || !program?.width) return;
  const s = Math.min(1, 384 / Math.max(program.width, program.height));
  const w = Math.round(program.width * s), h = Math.round(program.height * s);
  if (typeof OffscreenCanvas !== 'function') return;
  if (!pgmCanvas || pgmCanvas.width !== w || pgmCanvas.height !== h) pgmCanvas = new OffscreenCanvas(w, h);
  pgmBusy = true;
  try {
    pgmCanvas.getContext('2d').drawImage(program, 0, 0, w, h);
    const blob = await pgmCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
    monitorChannel.postMessage({ type: 'pgm', blob, w, h });
  } catch {} finally {
    pgmBusy = false;
  }
}
window.vmStreamOut = () => streamOut; // (diagnostics and tests: the stream out, while live)
export async function pushMonitor() {
  if (!monitorChannel || !hub) return;
  const peers = [];
  for (const [peer, l] of live) {
    const st = l.local ? null : await hub.stats(peer);
    if (st) l.stats = st;
    if (l.local && l.role === 'mic') {
      // this computer's own microphone or sound: no link to measure; it goes straight in
      const tier = peer === liveActive && !onBreak() ? 'program' : 'idle';
      l.stats = { route: 'local', codec: 'raw' };
      l.tele = { ...(l.tele || {}), platform: 'This computer', browser: l.deviceLabel || l.micLabel || l.name || 'Microphone', link: { local: true, audio: true, tier } };
    }
    if (l.local && l.role !== 'mic') {
      // a camera plugged into this computer: no link to measure; its own picture, straight in
      const s = l.stream?.getVideoTracks()[0]?.getSettings?.() || {};
      const w = l.video?.videoWidth || s.width || null, h = l.video?.videoHeight || s.height || null, fps = s.frameRate ? Math.round(s.frameRate) : null;
      const tier = peer === liveActive && !onBreak() ? 'program' : peer === pvw ? 'preview' : 'idle';
      l.stats = { route: 'local', width: w, height: h, fps, codec: 'raw' };
      l.tele = { ...(l.tele || {}), camW: s.width || w, camH: s.height || h, camFps: fps, platform: 'This computer', browser: l.deviceLabel || 'Camera', link: { local: true, tier, w, h, fps } };
    }
    const sc = scoreOfLive(l);
    peers.push({
      peer, name: l.name, role: l.role, rec: !!l.rec, onAir: peer === liveActive && !onBreak(), joinedAt: l.joinedAt,
      ...(l.stats || {}), tele: l.tele || null,
      score: sc, problem: sc != null && sc < 0.5 ? whatsWrong(l.qa?.parts, l.qa?.upright, orientation, l.qa?.fixed) : null, shape: l.view?.upright || null,
    });
  }
  const bytes = [...rawBlobs.values()].reduce((s, b) => s + b.size, 0);
  monitorChannel.postMessage({
    type: 'stats', at: Date.now(), event: { id: eventId, title: ev.title, orientation },
    program: { onBreak: onBreak(), black: blackLevel() >= 1 ? 'black' : black.target === 1 ? 'fading' : null, active: live.get(liveActive)?.name || null, recording: !!progRec, auto: autoOn },
    totals: { clips: clips.length, audio: audioClips().length, bytes, incoming: [...incoming.values()], seconds: Math.round(S.end(seq) / 1000) },
    outgoing: [...outgoing.values()], sent: sentLog.slice(0, 40),
    received: [...clips].sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0)).slice(0, 30).map((c) => ({ id: c.id, name: c.name, kind: c.kind, size: rawBlobs.get(c.id)?.size || 0, at: c.receivedAt || c.t0, dur: c.dur, mime: c.mime, thumb: thumbs?.get?.(c.id) || null })),
    peers, log: log.slice(0, 80),
    stream: streamOut?.link ? { name: streamOut.name, ...(await streamOut.link().catch(() => ({}))) } : null,
    displays: (await displayHub?.stats().catch(() => [])) || [],
    remotes: remoteHost?.links?.() || [],
    showlog: showLogBrief(),
  });
}

export let leaveQuietly = false; // (the kiosk starting its next show: no "Leave site?")
export function setLeaveQuietly(v) { return (leaveQuietly = v); }
window.addEventListener('beforeunload', (e) => {
  if (leaveQuietly) return;
  if (exporting || progRec || incoming.size || rendering) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ------------------------------------------------------------- phone remote --
// A phone that runs the show while you step away (cut, auto-director, fade, break, record).
// Only a phone added here, with the one-time code this shows, can; see remote-host.js.
export let remoteHost = null, remoteTick = null;
function remoteState() {
  const brk = breakManual || directorBreak;
  const atBlack = black.target === 1;
  const cams = camOrder().map((p) => {
    const l = live.get(p);
    if (!l || l.role === 'mic') return null;
    return { peer: p, name: l.name || 'Guest', rec: !!l.rec, onAir: p === liveActive && !mediaOn && !brk && !atBlack, preview: p === pvw, screen: !!l.screen, inset: pipAir()?.peer === p };
  }).filter(Boolean);
  // sound-only sources (microphones, this computer's sound): cut to one and the program shows
  // its sound picture, as it does from the studio
  const sound = [...live].filter(([, l]) => l.role === 'mic').map(([p, l]) => ({ peer: p, name: l.name || 'Microphone', onAir: p === liveActive && !mediaOn && !brk && !atBlack, local: !!l.local }));
  const mics = sound.map((s) => s.name);
  // the clips loaded in the studio (the Clips panel): cut to one, as clicking it there does
  const clips = reel.map((r) => ({ id: r.id, name: r.name, kind: r.type.startsWith('video/') ? 'video' : 'image', onAir: mediaOn?.id === r.id && !brk && !atBlack }));
  return {
    title: $('#title')?.textContent || 'Studio', cams, sound, clips, mics, auto: !!autoOn, black: atBlack, brk,
    media: mediaOn ? reelOf(mediaOn.id)?.name || 'A clip' : null, rec: !!(progRec && !progRec.stopping),
    // (sound alerts stay in the studio, under Notifications: the remote doesn't show them)
    mix: remoteMix(),
    pip: pipSettings(),
  };
}
window.vmRemoteState = () => remoteState(); // (diagnostics and tests)
window.vmRemoteHost = () => remoteHost;
// The mixer for the remote: each live channel's mode, level and how loud it is now, and the program's
const meterDb = (an) => {
  if (!an) return -99;
  const b = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(b);
  let p = 0;
  for (const v of b) p = Math.max(p, Math.abs(v));
  return p > 1e-5 ? Math.max(-99, Math.round(20 * Math.log10(p))) : -99;
};
function remoteMix() {
  if (!mix.bus) return null;
  const rows = [];
  for (const peer of [...micPeers(), ...camOrder()]) {
    const l = live.get(peer), st = mix.strips.get(peer);
    if (!l || !st) continue;
    const id = l.cid || peer, ms = mixState(id, l.role);
    rows.push({ id, role: l.role, name: l.role === 'mic' ? l.name : `${liveNo(peer) || ''} ${l.name}`.trim(), mode: ms.mode, db: gainToDb(ms.gain ?? 1), open: !!st.open, level: meterDb(st.meter) });
  }
  return { rows, program: Math.max(meterDb(mix.meterL), meterDb(mix.meterR)) };
}
function remoteAct(a, arg) {
  if (a === 'cut') {
    if (!live.has(arg)) return 'That camera has gone';
    cutLive(arg);
    return '';
  }
  if (a === 'clip') {
    if (!reelOf(arg)) return 'That clip has gone';
    cutMedia(arg);
    return '';
  }
  if (a === 'auto') { setAuto(!!arg); return ''; }
  if (a === 'black') { toggleBlack(true); return ''; }
  if (a === 'break') { toggleBreak(); return ''; }
  if (a === 'rec') {
    const on = !!(progRec && !progRec.stopping);
    if (!!arg !== on) recByHand();
    return '';
  }
  if (a === 'pip') {
    setPip({ on: !!arg }, `Phone remote: picture-in-picture ${arg ? 'on' : 'off'}`);
    return '';
  }
  if (a === 'mixMode' || a === 'mixGain') {
    const known = remoteMix()?.rows.find((r) => r.id === arg?.id);
    if (!known) return 'That channel has gone';
    if (a === 'mixMode') {
      if (!MODES.includes(arg.mode)) return 'Not a sound mode';
      setStripMode(known.id, known.role, arg.mode);
      note(`Phone remote: ${known.name}'s sound ${MODE_LABEL[arg.mode]}`);
    } else setStripGain(known.id, known.role, arg.db);
    return '';
  }
  return 'Not something a remote can do';
}
export function startRemoteHost() {
  remoteHost = new RemoteHost({
    eventId,
    send: (peer, data) => sock?.signal(peer, data),
    state: remoteState,
    act: remoteAct,
    thumbs: () => camOrder().map((p) => ({ peer: p, video: live.get(p)?.role !== 'mic' ? live.get(p)?.video : null })),
    changed: renderRemotes,
    note,
    // Program out on the remote: its own screen link, let in without Accept (it's paired already)
    tvKey: (rk, name) => displayHub?.trustRemote(rk, name) || null,
    untrust: (rk) => displayHub?.untrustRemote(rk),
  });
  renderRemotes();
}
function renderRemotes() {
  const ul = $('#remoteList');
  if (!ul || !remoteHost) return;
  const list = remoteHost.list();
  ul.innerHTML = list.map((r) => `<li><span class="dot${r.connected ? ' live' : ''}" aria-hidden="true"></span> ${esc(r.name)} <span class="fine">${r.connected ? 'connected' : 'not connected'}</span> <button type="button" class="small" data-remote-del="${esc(r.key)}">Remove</button></li>`).join('');
  $('#remoteNone').hidden = list.length > 0;
  if (!remoteHost.pairing && $('#remoteDlg')?.open) $('#remoteDlg').close();
}
function openRemotePairing() {
  if (!remoteHost) return toast('A phone remote needs the studio to be live first');
  const p = remoteHost.startPairing();
  const code = `${p.code.slice(0, 4)}-${p.code.slice(4)}`;
  const url = `${location.origin}/remote?e=${eventId}#p=${p.code}`;
  drawQR($('#remoteQr'), url, { size: 360, ecl: 'M' });
  $('#remoteCode').textContent = code;
  $('#remoteLink').textContent = `${location.host}/remote · show ${eventId}`;
  $('#remoteDlg').showModal();
  clearInterval(remoteTick);
  const tick = () => {
    const left = remoteHost.pairingLeft();
    $('#remoteLeft').textContent = left ? `This code works once, for ${Math.ceil(left / 1000)} more seconds.` : 'The code has run out.';
    if (!left) {
      clearInterval(remoteTick);
      $('#remoteDlg').close();
    }
  };
  tick();
  remoteTick = setInterval(tick, 1000);
}
$('#remoteAdd')?.addEventListener('click', openRemotePairing);
$('#remoteCancel')?.addEventListener('click', () => {
  remoteHost?.stopPairing();
  $('#remoteDlg').close();
});
$('#remoteDlg')?.addEventListener('close', () => {
  clearInterval(remoteTick);
  if (remoteHost?.pairing) remoteHost.stopPairing(); // (closing the dialog takes the code away)
});
$('#remoteList')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-remote-del]'), key = b?.dataset.remoteDel;
  if (key && pressTwice(b, 'Sure? Remove')) remoteHost?.remove(key);
});

// --------------------------------------------------------------- TV screens --
// The program on a TV: the Apple TV app, or /tv in any browser on this network. A TV joins with
// the event code and waits here until it's accepted; then it's
// remembered and comes back on its own. Its picture comes straight from this computer over the
// local network; see display-hub.js.
export let displayHub = null;
function programForTv({ sound: withSound = true } = {}) {
  const out = [programVideoTrack()];
  const sound = withSound && mix.dest?.stream.getAudioTracks()[0];
  if (sound) out.push(sound.clone());
  return out;
}

// ---- cameras watching the program ----------------------------------------------------------
// A camera in the show can get its own screen key over its link, so it can show the program in a
// small box beside its record button (tap: full screen, its live picture paused while it watches).
// Picture only, small: see display-hub.js. Each is a picture this computer encodes, so only so
// many cameras get it (TV screens: up to 4 to start with; 0, none): the lowest camera numbers
// first. When one leaves, the next in line gets it.
const WATCH_DEFAULT = 4;
let watchMax = (() => {
  const n = localStorage.getItem('vm_camwatch_max');
  if (n !== null && Number.isFinite(+n)) return Math.max(0, Math.min(24, Math.round(+n)));
  return localStorage.getItem('vm_camwatch') === '0' ? 0 : WATCH_DEFAULT; // (it was on or off, before 0.63.0 shipped)
})();
const watchable = (l) => l && l.role !== 'mic' && !l.local && !l.screen && !!l.cid && !l.leaving && !isRemoteCam(l);
/** The cameras that can watch the program now: the first watchMax, by camera number (then who joined first). */
function watchers() {
  return [...live.entries()].filter(([, l]) => watchable(l))
    .sort(([pa, a], [pb, b]) => (liveNo(pa) || 99) - (liveNo(pb) || 99) || (a.joinedAt || 0) - (b.joinedAt || 0))
    .slice(0, watchMax).map(([peer]) => peer);
}
/** Tell one camera whether it can watch the program (its key, or none), when that changes. Again until its link is up. */
function offerProgram(peer, tries = 0) {
  const l = live.get(peer);
  if (!l || l.role === 'mic' || l.local) return;
  if (!l.cid || !displayHub) {
    // (who it is can come a moment after its picture: then everyone's place is looked at again)
    if (tries < 15) setTimeout(() => (live.get(peer)?.cid && displayHub ? rebalanceWatch() : offerProgram(peer, tries + 1)), 1000);
    return;
  }
  const key = watchers().includes(peer) ? displayHub.trustCam(l.cid, l.name) : null;
  if (!key) displayHub.untrustCam(l.cid);
  if (l.pgmKey === key || l.screen) return;
  if (hub?.message(peer, { t: 'pgm', key })) l.pgmKey = key;
  else if (tries < 15) setTimeout(() => offerProgram(peer, tries + 1), 1000);
}
/** Which cameras can watch the program, for everyone (a camera joined or left, or the number changed). */
export function rebalanceWatch() {
  for (const [peer, l] of live) if (l.role !== 'mic' && !l.local) offerProgram(peer);
}
/** A camera left the show: its program screen goes with it, and the next camera in line may get it. */
export function camLeft(cid) {
  if (cid && ![...live.values()].some((l) => l.cid === cid)) displayHub?.untrustCam(cid);
  rebalanceWatch();
}
if ($('#camsWatch')) {
  $('#camsWatch').value = watchMax;
  $('#camsWatch').onchange = (e) => {
    watchMax = Math.max(0, Math.min(24, Math.round(+e.target.value || 0)));
    e.target.value = watchMax;
    localStorage.setItem('vm_camwatch_max', watchMax);
    note(watchMax ? `Cameras watching the program: up to ${watchMax}` : 'Cameras can no longer watch the program');
    rebalanceWatch();
  };
}
export function startDisplayHub() {
  displayHub = new DisplayHub({
    eventId,
    title: () => $('#title')?.textContent || ev?.title || '',
    send: (peer, data) => sock?.signal(peer, data),
    program: programForTv,
    changed: () => (renderTvs(), renderNotifs()), // (an asking TV is under Notifications too)
    note,
    localOnly: () => !!$('#localOnly')?.checked,
    // Browse: the recordings on this computer, newest first
    media: () => clips.filter((c) => rawBlobs.has(c.id)).sort((a, b) => (b.t0 || 0) - (a.t0 || 0)).map((c) => ({ id: c.id, name: c.program ? c.name : clipTitle(c), kind: c.kind, mime: rawBlobs.get(c.id).type || c.mime, dur: c.dur, t0: c.t0, size: rawBlobs.get(c.id).size })),
    blob: (id) => rawBlobs.get(id),
    thumb: (id) => thumbs.get(id) || null,
    fps: () => output.fps,
    camOk: (cid) => watchers().some((peer) => live.get(peer)?.cid === cid),
    // a phone remote talking over its Program out link (no server needed)
    onRemote: (from, m, via) => {
      if (!remoteHost || !m || typeof m !== 'object') return;
      remoteHost.direct.set(from, via);
      remoteHost.onMessage(from, { remote: m });
    },
  });
  window.vmDisplayHub = () => displayHub; // (diagnostics and tests)
  const code = $('#tvEventCode');
  if (code) code.textContent = eventId;
  renderTvs();
}
const TV_STATUS = { active: 'showing', starting: 'starting', connecting: 'connecting', joining: 'joining', away: 'not connected', error: 'can’t connect' };
function renderTvs() {
  const ul = $('#tvList');
  if (!ul || !displayHub) return;
  const { paired, waiting } = displayHub.list();
  const say = (t) => (t.detail === 'ice_failed_same_network' ? 'not on this network' : TV_STATUS[t.status] || t.status);
  if (ul.contains(document.activeElement) && document.activeElement.matches('select')) return; // (not under someone choosing)
  const opt = (t, v, label) => `<option value="${v}"${t.mode === v ? ' selected' : ''}>${label}</option>`;
  ul.innerHTML =
    waiting.map((w) => `<li class="tvwait"><span class="dot" aria-hidden="true"></span> ${esc(w.name)} <span class="fine">wants to show the program</span> <button type="button" class="small" data-tv-accept="${esc(w.peer)}">Accept</button> <button type="button" class="small" data-tv-decline="${esc(w.peer)}">Decline</button></li>`).join('') +
    paired.map((t) => `<li class="tvrow"><span class="dot${t.connected ? ' live' : ''}" aria-hidden="true"></span> ${esc(t.name)} <span class="fine">${esc(say(t))}</span>
      <select class="small" data-tv-mode="${esc(t.key)}" aria-label="What ${esc(t.name)} shows">${opt(t, 'program', 'Program')}${opt(t, 'browse', 'Browse recordings')}${opt(t, 'beacon', 'Beacon')}${opt(t, 'idle', 'Event card')}</select>
      ${t.mode === 'browse' || t.mode === 'beacon' ? `<label class="check tvpip"><input type="checkbox" data-tv-pip="${esc(t.key)}"${t.pip ? ' checked' : ''}> PIP</label>` : ''}
      ${t.mode === 'beacon' ? `<span class="fine">${t.lag == null ? 'lag not measured' : `${t.lag} ms ahead`}</span> <button type="button" class="small" data-tv-cal="${esc(t.key)}" title="Measure this TV's display lag with a phone, so phones synced to it line up with this computer">Calibrate</button>` : ''}
      <button type="button" class="small" data-tv-del="${esc(t.key)}">Remove</button></li>`).join('');
  $('#tvNone').hidden = paired.length + waiting.length > 0;
}
$('#tvList')?.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.tvAccept) displayHub?.accept(t.dataset.tvAccept);
  else if (t.dataset.tvDecline) displayHub?.decline(t.dataset.tvDecline);
  else if (t.dataset.tvCal) openTvCal(t.dataset.tvCal);
  else if (t.dataset.tvDel && pressTwice(t, 'Sure? Remove')) displayHub?.remove(t.dataset.tvDel);
});
$('#tvList')?.addEventListener('change', (e) => {
  const { tvMode, tvPip } = e.target.dataset;
  if (tvMode) {
    e.target.blur();
    displayHub?.setMode(tvMode, e.target.value);
  } else if (tvPip) {
    const k = displayHub?.keys.get(tvPip);
    if (k) displayHub.setMode(tvPip, k.mode, e.target.checked);
  }
});

// ---- a TV's display lag, measured with a phone ---------------------------------------------
// A TV shows a picture some time after it's sent (20 ms in game mode, often 100 ms or more
// without). A TV beacon draws this computer's clock, so phones synced to it would be that much
// behind. Calibrate: this screen shows a beacon of its own (little lag), the TV shows its beacon,
// and a phone (/tvcal, opened by scanning this one) reads both. The difference is the TV's lag
// beyond this screen's; the TV's beacon then draws that far ahead.
let tvCal = null; // { key, id, timer }
function openTvCal(key) {
  if (!displayHub?.keys.has(key)) return;
  const id = Math.random().toString(36).slice(2, 10);
  tvCal = { key, id };
  if (displayHub.keys.get(key).mode !== 'beacon') displayHub.setMode(key, 'beacon');
  $('#tvCalName').textContent = displayHub.keys.get(key).name;
  $('#tvCalSay').textContent = 'Waiting for the phone…';
  const c = $('#tvCalQr');
  const draw = () => drawQR(c, `${location.origin}/tvcal?e=${eventId}&c=${id}#t=${Math.round(now())}`, { size: 360, ecl: 'L' });
  draw();
  tvCal.timer = setInterval(draw, 1000 / 15); // (the beacon's own rate)
  $('#tvCalDlg').showModal();
}
function closeTvCal() {
  clearInterval(tvCal?.timer);
  tvCal = null;
  if ($('#tvCalDlg').open) $('#tvCalDlg').close();
}
$('#tvCalDlg')?.addEventListener('close', () => {
  clearInterval(tvCal?.timer);
  tvCal = null;
});
$('#tvCalCancel')?.addEventListener('click', closeTvCal);
/** The phone's result: how much later the TV's beacon showed than this screen's (ms). */
export function onTvCal(m) {
  if (!tvCal || m?.c !== tvCal.id) return;
  if (m.progress) return void ($('#tvCalSay').textContent = String(m.progress).slice(0, 120)); // (what the phone sees so far)
  const k = displayHub?.keys.get(tvCal.key);
  if (!k || !Number.isFinite(m.ms)) return;
  const lag = Math.max(0, (k.lag || 0) + m.ms);
  displayHub.setLag(tvCal.key, lag);
  note(`TV display lag measured: ${k.name}, ${Math.round(lag)} ms (its beacon now draws that far ahead)`);
  toast(`${k.name}: ${Math.round(lag)} ms lag. Its beacon is lined up with this screen.`, 5000);
  closeTvCal();
}

// ------------------------------------------------------------- join by QR --
// A phone with no internet can't find the studio through the server. It shows a QR code instead
// (qrjoin.js); a camera here reads it (this computer's, or any camera in the show), and the studio
// shows its answer for the phone to scan. That makes a small link straight between the two, and the
// phone's usual link is arranged over it.
const qj = { stream: null, own: false, timer: null, busy: false, seen: new Set(), answer: null };
function qjSources() {
  const cams = camOrder().map((p) => [p, live.get(p)]).filter(([, l]) => l?.stream?.getVideoTracks().length && l.role !== 'mic');
  return [['computer', "This computer's camera"], ...cams.map(([p, l]) => [p, `${l.local ? '' : 'Camera: '}${l.name}`])];
}
async function qjUse(src) {
  if (qj.own) qj.stream?.getTracks().forEach((t) => t.stop());
  qj.own = false;
  qj.stream = null;
  if (src === 'computer') {
    try {
      qj.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      qj.own = true;
    } catch {
      $('#qjSay').textContent = "This computer's camera isn't available: pick a camera in the show.";
    }
  } else qj.stream = live.get(src)?.stream ? new MediaStream(live.get(src).stream.getVideoTracks()) : null;
  $('#qjVideo').srcObject = qj.stream;
}
function qjRead() {
  $('#qjRead').hidden = false;
  $('#qjShow').hidden = true;
  $('#qjSay').textContent = 'Looking for the phone’s code…';
  clearInterval(qj.timer);
  const c = document.createElement('canvas');
  qj.timer = setInterval(async () => {
    const v = $('#qjVideo');
    if (qj.busy || !v.videoWidth) return;
    qj.busy = true;
    try {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0);
      const text = await decodeQR(c).catch(() => null);
      if (text) await qjHandle(text);
    } finally {
      qj.busy = false;
    }
  }, 300);
}
/** A code read (or, in tests, given): answer it and show the answer. */
async function qjHandle(text) {
  const c = decodeJoin(text);
  if (!c) return false;
  if (c.show !== eventId) {
    $('#qjSay').textContent = `That phone is joining another show (${c.show}): open ${eventId} on it.`;
    return false;
  }
  if (qj.seen.has(c.nonce)) return false; // (still in front of the camera: answered already)
  qj.seen.add(c.nonce);
  clearInterval(qj.timer);
  const r = await studioAnswer(text, eventId);
  if (!r) return false;
  qj.answer = r.code;
  $('#qjRead').hidden = true;
  $('#qjShow').hidden = false;
  drawQR($('#qjQr'), r.code, { size: 360, ecl: 'L' });
  $('#qjSay2').textContent = 'Waiting for the phone to scan it…';
  r.link.then(({ pc, dc }) => {
    hub.adoptBoot(pc, dc);
    // (which show this is, and the studio's id: the phone joins as it would through the server)
    dc.send(JSON.stringify({ t: 'hello', show: eventId, host: sock.peer, ev }));
    note('A phone joined by QR code (no server)');
    $('#qjSay2').textContent = 'Connected: the phone is joining. Next phone?';
    qj.answer = null;
    setTimeout(() => $('#qrJoinDlg').open && qjRead(), 2500);
  }, () => {
    if ($('#qrJoinDlg').open && qj.answer === r.code) {
      $('#qjSay2').textContent = 'The phone didn’t connect. Is it on this Wi-Fi? Try again.';
      qj.answer = null;
      setTimeout(() => $('#qrJoinDlg').open && qjRead(), 2500);
    }
  });
  return true;
}
function openQrJoin() {
  if (!isHost) return;
  localCheck(true);
  $('#qjCode').textContent = eventId;
  const srcs = qjSources();
  $('#qjSrc').innerHTML = srcs.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  // (a camera in the show first, if there's one: this computer's may be busy, or not there)
  const first = srcs.find(([v]) => v !== 'computer')?.[0] || 'computer';
  $('#qjSrc').value = first;
  qjUse(first);
  qjRead();
  $('#qrJoinDlg').showModal();
}
$('#qrJoinBtn')?.addEventListener('click', openQrJoin);
$('#localDot')?.addEventListener('click', openQrJoin);
$('#offlineDot')?.addEventListener('click', openQrJoin);
$('#qjSrc')?.addEventListener('change', (e) => qjUse(e.target.value));
$('#qjCancel')?.addEventListener('click', () => $('#qrJoinDlg').close());
$('#qrJoinDlg')?.addEventListener('close', () => {
  clearInterval(qj.timer);
  if (qj.own) qj.stream?.getTracks().forEach((t) => t.stop());
  qj.stream = null;
  qj.own = false;
  $('#qjVideo').srcObject = null;
});
window.vmQrJoin = { open: openQrJoin, read: (text) => qjHandle(text), answer: () => qj.answer }; // (tests: a code as a camera would read it)

// --------------------------------------------------- the show on this computer's own Wi-Fi --
// The local show helper (public/relay/vuemesh-local.mjs), run on this computer, makes its Wi-Fi a
// hotspot and serves the app and the joining on it, at the show's own https address. The studio
// tells it the show (and its key, so it can let the studio in as the host), and joins it as a second
// server: phones on the hotspot join there. Two QR codes for them: the Wi-Fi, then the show.
const localUrl = () => localStorage.getItem('vm_local') || 'http://localhost:8936';
const local = { st: null, sock: null, shown: false, busy: false };
async function localFetch(path, body) {
  const r = await fetch(localUrl() + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) } : { signal: AbortSignal.timeout(2000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `The helper said ${r.status}`), { st: j });
  return j;
}
/** Is the helper there? Then the show's on it, and the studio connected to it. @param say  redraw the dialog */
async function localCheck(say = false) {
  if (!isHost || local.busy) return;
  local.busy = true;
  try {
    let st = await localFetch('/status').catch(() => null);
    if (st && !st.shows?.some((x) => x.id === eventId)) st = await localFetch('/event', { ev, hostKey: key }).catch(() => st);
    if (st) localStorage.setItem('vm_local_seen', '1');
    if (st && !local.sock && connectLocal) {
      local.sock = connectLocal(localUrl().replace(/^http/, 'ws') + '/ws');
      note(`This computer's local show helper is running: phones on its Wi-Fi join the show at ${st.url}`);
    }
    local.st = st;
  } finally {
    local.busy = false;
  }
  if (say || $('#qrJoinDlg')?.open) renderLocal();
}
function renderLocal() {
  const st = local.st, say = $('#qjLocalSay');
  if (!say) return;
  $('#qjHotspot').hidden = !st?.hotspot?.can;
  $('#qjLocalCodes').hidden = true;
  if (!st) {
    say.innerHTML = `Run the show on this computer's own Wi-Fi, with no router and no internet: download the <a href="/relay/vuemesh-local.mjs" download>local show helper</a> and run it, on Linux with <code>sudo node vuemesh-local.mjs</code>, on Windows with <code>node vuemesh-local.mjs</code> in a PowerShell opened as administrator. Once online, the first time.`;
    return;
  }
  const show = st.shows?.find((x) => x.id === eventId);
  const h = st.hotspot || {};
  $('#qjHotspot').textContent = h.on ? 'Stop the hotspot' : 'Start the hotspot';
  $('#qjHotspot').title = h.on ? '' : "This computer's Wi-Fi becomes the show's (it leaves the network it's on now)";
  const certSay = st.https ? '' : st.cert === 'getting' ? ' Getting its certificate (a minute or so)…' : st.cert === 'error' ? ` No certificate yet: ${st.certError || 'it needs the internet once'}.` : ' Its certificate comes once it’s online.';
  say.textContent = `The helper is running.${h.on ? ` Hotspot on: “${h.ssid}”.` : h.can ? ' Start the hotspot, and phones join its Wi-Fi.' : ` No hotspot here (${h.why || 'not on this computer'}): phones join this computer's network as it is.`}${certSay}`;
  if (!st.https || !show) return;
  $('#qjLocalCodes').hidden = false;
  $('#qjWifiFig').hidden = !h.on;
  if (h.on) {
    drawQR($('#qjWifiQr'), h.qr, { size: 220, ecl: 'M' });
    $('#qjSsid').textContent = h.ssid;
    $('#qjPass').textContent = `password ${h.pass}`;
  }
  drawQR($('#qjShowQr'), show.link, { size: 220, ecl: 'M' });
  $('#qjShowLink').textContent = show.link;
}
$('#qjLocalCheck')?.addEventListener('click', () => localCheck(true));
$('#qjHotspot')?.addEventListener('click', async () => {
  const on = !local.st?.hotspot?.on;
  $('#qjHotspot').disabled = true;
  $('#qjLocalSay').textContent = on ? 'Starting the hotspot…' : 'Stopping the hotspot…';
  try {
    local.st = await localFetch('/hotspot', { on });
    note(on ? `Hotspot on: “${local.st.hotspot.ssid}”` : 'Hotspot off');
  } catch (e) {
    local.st = e.st?.local ? e.st : local.st;
    toast(e.message, 8000);
  } finally {
    $('#qjHotspot').disabled = false;
    renderLocal();
  }
});
// (the helper may be running already: the studio joins it straight away, so its phones get in. Only
// on a computer that has used it: else the browser could ask about this computer's network for nothing)
// (isHost is known once the studio has opened, after this runs: so it's asked each time)
if (!EDIT_ONLY) {
  const seen = () => !!localStorage.getItem('vm_local_seen');
  let n = 0;
  setInterval(() => {
    if (!isHost) return;
    if ($('#localDot')) $('#localDot').hidden = !sock?.local;
    if ((n++ === 1 || n % 3 === 0) && !local.sock && !document.hidden && seen() && connectLocal) localCheck();
  }, 2000);
}
window.vmLocalShow = () => ({ st: local.st, connected: !!sock?.local }); // (tests)
