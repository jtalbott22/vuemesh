// Studio, part 24 of 26: the show log and the sound watch.
// Loads after screens.js: that import comes first, so the parts run in order (see ../studio.js).
import './screens.js';
import { toast, esc, announce } from '/js/vm.js';
import { APP_VERSION } from '/js/brand.js';
import * as idb from '/js/idb.js';
import { ShowLog, SoundWatch, dbOf, joinChunks } from '/js/showlog.js';
import {
  $, black, EDIT_ONLY, ev, eventId, help, hub, isHost, live, liveActive, log, orientation, player,
  program, sock,
} from './core.js';
import { mix, setStripMode } from './mixer.js';
import { streamOut } from './stream.js';
import { mediaOn, onBreak } from './graphics.js';
import { progFrames, progRec, reelOf, stalled } from './switcher.js';
import { displayHub } from './screens.js';
import { output } from './clips.js';
import { buffers, latencyOf, pictureDelay } from './picsync.js';

// What happened during the show, second by second, kept on this computer (see /js/showlog.js
// for what a sample holds). It runs on the background clock (a worker), which browsers don't
// slow down when the studio is hidden behind a slideshow, so a hidden studio is logged too.
// A minute at a time goes into this browser's storage; Save show log makes one file of it.

const CHUNK_MS = 60_000;
const KEEP_DAYS = 30;
export const showLog = new ShowLog();
const session = Date.now().toString(36);
let chunkNo = 0;
export const soundWatch = new SoundWatch();
export let soundAlerts = []; // (what's raised now: Notifications, the bell in the top bar)

// ---- what each tick measures (the loudest moments between samples) ----
const bufs = new Map(); // size → a buffer to read meters into
const peakOf = (an) => {
  if (!an) return 0;
  if (!bufs.has(an.fftSize)) bufs.set(an.fftSize, new Float32Array(an.fftSize));
  const b = bufs.get(an.fftSize);
  an.getFloatTimeDomainData(b);
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
  return p;
};
let progPeak = 0, tickGap = 0, lastTick = 0;
const srcPeak = new Map(); // peer → loudest since the last sample
function measure() {
  const t = performance.now();
  if (lastTick) tickGap = Math.max(tickGap, t - lastTick);
  lastTick = t;
  if (player.ctx?.state !== 'running') return;
  progPeak = Math.max(progPeak, peakOf(mix.meterL), peakOf(mix.meterR));
  for (const [peer, st] of mix.strips) {
    if (!st.pre || !st.src) continue;
    const p = peakOf(st.pre);
    srcPeak.set(peer, Math.max(srcPeak.get(peer) || 0, p));
    if (p > 0) st.heardAt = Date.now(); // (its sound is reaching the mixer: see mixerWatch in /js/showlog.js)
    // an input of this computer in stereo (an interface's Input 1 left, Input 2 right): each side on its own
    if (live.get(peer)?.stereo && st.fix?.aL) {
      const [l, r] = sidePeak.get(peer) || [0, 0];
      sidePeak.set(peer, [Math.max(l, peakOf(st.fix.aL)), Math.max(r, peakOf(st.fix.aR))]);
    }
  }
}
const sidePeak = new Map(); // peer → [left, right], loudest since the last sample

// ---- one sample a second ----
const prevStats = new WeakMap(); // track or video → its counters a second ago
const delta = (obj, key, now) => {
  const p = prevStats.get(obj)?.[key];
  prevStats.set(obj, { ...(prevStats.get(obj) || {}), [key]: now });
  return p == null || now == null || now < p ? null : now - p;
};
const linkStats = new Map(); // peer → the phone link's last stats (every few seconds)
let tvStats = [];
const soundOf = (t) => (!t ? 'none' : t.readyState === 'ended' ? 'ended' : t.muted ? 'muted' : !t.enabled ? 'off' : 'live');
const kindOf = (l) => (l.screen ? 'screen' : l.role === 'mic' ? 'mic' : 'cam');
function onAir() {
  if (black.target === 1) return 'Black';
  if (onBreak()) return 'Break';
  if (mediaOn) return `Clip: ${reelOf(mediaOn.id)?.name || 'a clip'}`;
  return live.get(liveActive)?.name || null;
}
/** Two or more of this computer's own cameras at 1080p: enough to take the USB from an interface beside them. */
function usbBusy() {
  let n = 0;
  for (const l of live.values()) if (l.local && l.role !== 'mic' && !l.screen && (l.stream?.getVideoTracks()[0]?.getSettings?.().height || 0) >= 1080) n++;
  return n >= 2;
}
function sources() {
  const out = [];
  for (const [peer, l] of live) {
    const st = mix.strips.get(peer);
    const at = l.stream?.getAudioTracks().at(-1), vt = l.stream?.getVideoTracks().at(-1);
    const s = { id: peer, n: l.name || 'Source', k: kindOf(l), open: st?.open ? 1 : 0, a: soundOf(at) };
    if (l.local) s.loc = 1;
    if (l.paused) s.pz = 1; // (its person paused it, or is watching the program: silent on purpose)
    if (l.local && at && !l.screen && usbBusy()) s.usb = 1; // (its sound and 1080p cameras on this computer's USB: see SoundWatch)
    if (srcPeak.has(peer)) s.db = dbOf(srcPeak.get(peer));
    if (at) {
      const set = at.getSettings?.() || {};
      if (set.sampleRate) s.sr = set.sampleRate;
      // how many sides it opened with (an interface's two inputs come as two), each side's level,
      // and whether the mixer hears it as stereo yet; a split input says which side it is
      if (l.local) {
        s.ch = set.channelCount || 1;
        const sp = sidePeak.get(peer);
        if (sp) Object.assign(s, { dbL: dbOf(sp[0]), dbR: dbOf(sp[1]), st2: st?.fix?.stereo ? 1 : 0 });
        if (l.side) s.side = l.side;
      }
      // (Chrome counts sound the device delivered and what it had to drop on the way in: delivered,
      // about 1000 ms a second, silence included, and none when nothing arrives from it, so a log
      // can tell a device that stopped sending from one sending silence. Counted per source: the two
      // sides of a split input share one track)
      const as = at.stats;
      if (as && 'totalFramesDuration' in as) {
        const lost = delta(at, `lost:${peer}`, as.totalFramesDuration - as.deliveredFramesDuration);
        if (lost) s.ad = Math.round(lost);
        // (this computer's own devices only: a phone's sound keeps "arriving" as silence when its network
        // drops, and a shared screen's or this computer's sound is no device to check)
        const got = l.local && !l.screen ? delta(at, `got:${peer}`, as.deliveredFramesDuration) : null;
        if (got != null) s.dv = Math.round(got);
        if (as.latency != null) s.lat = Math.round(as.latency);
      }
    }
    if (vt && vt.readyState === 'live') {
      const vs = vt.stats;
      if (vs && 'deliveredFrames' in vs) s.vf = delta(vt, 'frames', vs.deliveredFrames);
    } else if (s.k !== 'mic') s.vt = vt ? vt.readyState : 'none';
    const q = l.video?.getVideoPlaybackQuality?.();
    if (q) s.vp = delta(l.video, 'shown', q.totalVideoFrames);
    if (l.micLabel && s.k === 'cam') s.mic = l.micLabel;
    // one timeline: a camera here, its own delay and its delivery's spread; any source, how long its sound waits (ms)
    const fb = buffers.get(peer);
    if (fb) Object.assign(s, { pl: Math.round(latencyOf(l)), sp: Math.round(fb.spread), held: fb.silentFor() > 1000 ? 1 : 0 });
    if (st?.delayMs) s.sd = st.delayMs;
    const ls = linkStats.get(peer);
    if (ls && !l.local) Object.assign(s, { fps: ls.fps ?? null, loss: ls.lossPct ?? null, jit: ls.jitterMs ?? null, rtt: ls.rttMs ?? null });
    // what a phone or another computer says about its own sending (every few seconds): frames sent,
    // kbit/s, what's holding it back, its encoder; a slow picture then says whose end it was
    const tx = !l.local && l.tele?.link && Date.now() - (l.tele.at || 0) < 15000 ? l.tele.link : null;
    if (tx) Object.assign(s, { tx: tx.fps ?? null, txk: tx.kbps ?? null, lim: tx.limit || null, enc: tx.enc || null, hw: tx.hw ?? null, tier: tx.tier || null });
    out.push(s);
  }
  srcPeak.clear();
  sidePeak.clear();
  return out;
}
let lastSample = 0, lastFrames = 0;
function sample() {
  const t = performance.now();
  const secs = lastSample ? (t - lastSample) / 1000 : null; // (the first sample has no second before it)
  lastSample = t;
  const s = sources();
  const row = {
    t: Date.now(), vis: document.visibilityState === 'visible' ? 'v' : 'h', drv: stalled() ? 'tick' : 'raf',
    fps: secs ? Math.round(((progFrames.n - lastFrames) / secs) * 10) / 10 : null,
    ...(progFrames.dup ? { dup: progFrames.dup } : {}), gap: Math.round(progFrames.gap), lag: Math.round(tickGap),
    ctx: player.ctx?.state || 'none', pk: dbOf(progPeak), rec: progRec ? 1 : 0, str: streamOut ? 1 : 0, sock: sock?.connected ? 1 : 0,
    air: onAir(), s,
  };
  if (tvStats.length) row.tv = tvStats;
  if (pictureDelay != null) row.pd = pictureDelay; // (every camera here held to this: see picsync.js)
  // Record program's own progress: frames written, skipped, the encoder's queue, sound vs picture (ms)
  const rs = progRec?.stats?.();
  if (rs) row.rs = rs;
  lastFrames = progFrames.n;
  progFrames.gap = 0;
  progFrames.dup = 0;
  progPeak = 0;
  tickGap = 0;
  tvStats = [];
  showLog.add(row);
  watchSound(row);
  noticeChanges(row);
}

// ---- events: what changed ----
const seenNotes = new WeakSet();
let last = null;
const seenTracks = new WeakSet();
function noticeChanges(row) {
  // the studio's own event log (joins, cuts by the director, recordings landing)
  for (const x of [...log].reverse()) if (!seenNotes.has(x)) {
    seenNotes.add(x);
    if (last) showLog.event('note', x.text);
  }
  if (last) {
    if (row.air !== last.air) showLog.event('air', `On air: ${row.air || 'nothing'}`);
    if (row.rec !== last.rec) showLog.event('rec', row.rec ? 'Record program started' : 'Record program stopped');
    if (row.str !== last.str) showLog.event('stream', row.str ? 'Streaming out' : 'Stopped streaming');
    if (row.sock !== last.sock) showLog.event('server', row.sock ? 'Connected to the server again' : 'Lost the server connection');
    if (row.ctx !== last.ctx) showLog.event('sound', `Sound engine: ${row.ctx}`);
    const before = new Map(last.s.map((x) => [x.id, x]));
    for (const x of row.s) if (!before.has(x.id)) showLog.event('source', joinedText(x));
    for (const x of last.s) if (!row.s.some((y) => y.id === x.id)) showLog.event('source', `${x.n} left`);
  } else {
    for (const x of row.s) showLog.event('source', joinedText(x));
  }
  // each track's own news: the device stopped it, or stopped sending for a while
  for (const [, l] of live) for (const tr of l.stream?.getTracks() || []) {
    if (seenTracks.has(tr)) continue;
    seenTracks.add(tr);
    const what = `${l.name}'s ${tr.kind === 'audio' ? 'sound' : 'picture'} (${tr.label || 'no label'})`;
    tr.addEventListener('ended', () => showLog.event('track', `${what} ended`));
    tr.addEventListener('mute', () => showLog.event('track', `${what} stopped coming in`));
    tr.addEventListener('unmute', () => showLog.event('track', `${what} is coming in again`));
  }
  last = row;
}
/** A camera here as it really captures: its size and frame rate, and whether Chrome is shrinking a bigger picture (then its USB still carries the bigger one). */
function captureOf(l) {
  const v = l?.local && !l.screen ? l.stream?.getVideoTracks()[0]?.getSettings?.() : null;
  if (!v?.width) return '';
  return `${v.width}x${v.height}${v.frameRate ? `, ${Math.round(v.frameRate)} frames a second` : ''}${v.resizeMode === 'crop-and-scale' ? ', shrunk by the browser from a bigger picture' : ''}`;
}
function joinedText(x) {
  const l = live.get(x.id);
  const where = x.loc ? ' (this computer)' : '';
  const cap = captureOf(l);
  if (x.k === 'cam') return `${x.n}${where} joined as a camera${l?.deviceLabel ? `: ${l.deviceLabel}` : ''}${cap ? ` at ${cap}` : ''}, sound from ${l?.micLabel || (x.a === 'none' ? 'nothing' : 'its own microphone')}${x.sr ? ` at ${x.sr} Hz` : ''}`;
  return `${x.n}${where} joined as ${x.k === 'mic' ? 'a microphone' : 'a shared screen'}${l?.deviceLabel ? `: ${l.deviceLabel}` : ''}${x.sr ? ` at ${x.sr} Hz` : ''}${x.k === 'mic' && x.ch ? (x.side ? `, its ${x.side === 'L' ? 'left' : 'right'} side` : x.ch > 1 ? `, in stereo (${x.ch} sides: an interface's Input 1 left, Input 2 right)` : ', mono') : ''}`;
}
let devicesBefore = null, namesHidden = false;
async function devices() {
  const all = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) || [];
  const ins = all.filter((d) => d.kind !== 'audiooutput');
  namesHidden = ins.some((d) => !d.label); // (cameras or microphones not allowed yet: those come without names)
  return ins.filter((d) => d.label).map((d) => `${d.kind === 'videoinput' ? 'camera' : 'microphone'}: ${d.label}`);
}
navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
  const now = await devices();
  if (devicesBefore) {
    // (counted, not just looked up: one of three webcams of the same name unplugged is still one less)
    const count = (list) => list.reduce((m, d) => m.set(d, (m.get(d) || 0) + 1), new Map());
    const was = count(devicesBefore), is = count(now);
    let changed = 0;
    for (const [d, n] of is) for (let i = was.get(d) || 0; i < n; i++, changed++) showLog.event('device', `Plugged in: ${d}`);
    for (const [d, n] of was) for (let i = is.get(d) || 0; i < n; i++, changed++) showLog.event('device', `Unplugged: ${d}`);
    // (every time the computer says so: a device reset under the same name left no trace before)
    // (speakers and headphones count too, and aren't listed: so it says only what it knows)
    if (!changed) showLog.event('device', `The computer said its devices changed (${namesHidden ? 'some names are hidden until cameras and microphones are allowed' : 'no camera or microphone changed'})`);
  }
  devicesBefore = now;
});
document.addEventListener('visibilitychange', () => showLog.event('window', document.hidden ? 'The studio window was hidden' : 'The studio window is showing again'));

// ---- the sound watch: say so when the program or a source in it goes silent ----
// Under Notifications (the bell in the top bar), not over the program: the bell's count turns
// red until they've been looked at. What has cleared stays there, under Earlier.
const seen = new Set(); // alerts looked at in Notifications (until they clear and come back)
let earlier = []; // cleared alerts, newest first: { text, at, until }
const raisedAt = new Map(); // alert key → when it was raised
function watchSound(row) {
  const expect = row.s.some((x) => x.open) && row.air !== 'Black' && row.air !== 'Break';
  const t = Date.now();
  const r = soundWatch.update(t, { program: { db: row.pk, expect }, sources: row.s });
  for (const a of r.raised) {
    showLog.event('alert', a.text, { alert: a.kind, id: a.id || null });
    raisedAt.set(a.key, t);
    notify(a);
  }
  // (one announcement for all of them: a second would replace the first before it's read)
  if (r.raised.length) announce(`Notification: ${r.raised.map((a) => a.text).join('. ')}`);
  for (const a of r.cleared) {
    showLog.event('alert-clear', `Cleared: ${a.text}`, { alert: a.kind, id: a.id || null });
    earlier = [{ text: a.text, at: raisedAt.get(a.key) || a.since || t, until: t }, ...earlier].slice(0, 20);
    raisedAt.delete(a.key);
    seen.delete(a.key);
  }
  soundAlerts = r.active;
  if (r.raised.length || r.cleared.length) renderNotifs();
}
/** Sources that could stand in: in the show, with sound, but not in the mix now. */
export function backupMics() {
  const out = [];
  for (const [peer, l] of live) {
    const st = mix.strips.get(peer), at = l.stream?.getAudioTracks().at(-1);
    if (!st || st.open || soundOf(at) !== 'live') continue;
    out.push({ peer, name: l.name || 'Microphone', mic: l.role === 'mic' });
  }
  return out.sort((a, b) => b.mic - a.mic);
}
/** Put a source's sound in the program (ON in the mixer): from Notifications. */
export function soundOn(peer) {
  const l = live.get(peer);
  if (!l) return 'That source has gone';
  setStripMode(l.cid || peer, l.role, 'on');
  showLog.event('alert-action', `Turned on ${l.name}'s sound`);
  return '';
}
const hms = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const notifOpen = () => !!$('#notifPop')?.matches(':popover-open');
function renderNotifs() {
  const btn = $('#notifBtn'), count = $('#notifCount'), list = $('#notifList');
  if (!btn) return;
  // (the program first: it's the one that matters most)
  const now = [...soundAlerts].sort((a, b) => (b.kind === 'program-silent') - (a.kind === 'program-silent'));
  if (notifOpen()) for (const a of now) seen.add(a.key);
  const fresh = now.filter((a) => !seen.has(a.key)).length;
  count.hidden = !now.length;
  count.textContent = String(now.length);
  count.classList.toggle('new', fresh > 0);
  btn.setAttribute('aria-label', now.length ? `Notifications: ${now.length} sound alert${now.length === 1 ? '' : 's'}${fresh ? ', new' : ''}` : 'Notifications');
  btn.title = now.length ? `Notifications: ${now.map((a) => a.text).join(' · ')}` : 'Notifications';
  $('#notifClear').hidden = !earlier.length;
  if (!notifOpen()) return; // (drawn when it opens)
  const backups = now.length ? backupMics().slice(0, 3) : [];
  list.innerHTML = (now.length
    ? `<h3>Now</h3><ul>${now.map((a) => `<li class="now"><span class="nico" aria-hidden="true">⚠</span><span>${esc(a.text)}</span><small>Since ${esc(hms(raisedAt.get(a.key) || a.since || Date.now()))}</small></li>`).join('')}</ul>`
      + (backups.length ? `<div class="nacts"><span>Sound from another source:</span>${backups.map((b) => `<button type="button" data-sound-on="${esc(b.peer)}">Turn on ${esc(b.name)}</button>`).join('')}</div>` : '')
    : '<p class="nempty">Nothing needs you right now. If a microphone or the program goes silent, it shows here.</p>')
    + (earlier.length ? `<h3>Earlier</h3><ul>${earlier.map((e) => `<li class="was"><span class="nico" aria-hidden="true">✓</span><span>${esc(e.text)}</span><small>${esc(hms(e.at))} to ${esc(hms(e.until))}</small></li>`).join('')}</ul>` : '');
}
$('#notifPop')?.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  // (just under the bell, wherever the top bar put it)
  const b = $('#notifBtn').getBoundingClientRect(), pop = e.target;
  pop.style.top = `${Math.round(b.bottom + 8)}px`;
  // (lined up with the bell's right edge, but never past the left of the window: on a phone it's most of the width)
  const w = Math.min(380, innerWidth - 16);
  pop.style.right = `${Math.max(8, Math.min(Math.round(innerWidth - b.right), innerWidth - w - 8))}px`;
});
$('#notifPop')?.addEventListener('toggle', (e) => e.newState === 'open' && renderNotifs());
$('#notifList')?.addEventListener('click', (e) => {
  const on = e.target.closest('[data-sound-on]')?.dataset.soundOn;
  if (!on) return;
  const err = soundOn(on);
  if (err) toast(err);
  renderNotifs();
});
$('#notifClear')?.addEventListener('click', () => {
  earlier = [];
  renderNotifs();
});
window.vmNotifs = () => ({ now: soundAlerts.map((a) => a.text), earlier: earlier.map((e) => e.text), badge: $('#notifCount')?.hidden ? 0 : +$('#notifCount').textContent, fresh: !!$('#notifCount')?.classList.contains('new') }); // (tests and diagnostics)
function notify(a) {
  // on this computer while the studio is hidden (behind a slideshow): the system's own alert
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(a.kind === 'program-silent' ? 'VUEMesh: the program has no sound' : `VUEMesh: ${a.n || 'a source'} has no sound`, { body: a.text, tag: `vm-sound-${a.key}`, requireInteraction: true });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {}
}
function renderAlertSetting() {
  const b = $('#slAlerts'), p = $('#slAlertState');
  if (!b) return;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  b.hidden = perm === 'granted' || perm === 'unsupported';
  if (p) p.textContent = perm === 'granted' ? 'Sound alerts show under Notifications (the bell at the top), and on this computer while the studio is hidden.'
    : perm === 'denied' ? 'Sound alerts show under Notifications (the bell at the top). This browser blocks its alerts for this site: allow notifications in its site settings to see them while the studio is hidden.'
    : 'Sound alerts show under Notifications (the bell at the top). Allow alerts to see them on this computer while the studio is hidden too.';
}
$('#slAlerts')?.addEventListener('click', async () => {
  await Notification.requestPermission().catch(() => {});
  renderAlertSetting();
});

// ---- keeping it: a minute at a time in this browser, and as one file ----
const meta = () => ({
  eventId, title: ev?.title || '', app: APP_VERSION, session, fps: output.fps, size: `${program.width}x${program.height}`, orientation,
  device: { browser: navigator.userAgent, platform: navigator.userAgentData?.platform || navigator.platform, cores: navigator.hardwareConcurrency || null, memoryGb: navigator.deviceMemory || null, screen: `${screen.width}x${screen.height}@${devicePixelRatio}` },
  sound: { sampleRate: player.ctx?.sampleRate || null, baseLatency: player.ctx?.baseLatency ?? null, outputLatency: player.ctx?.outputLatency ?? null },
  devices: devicesBefore || [],
});
const savedEvents = new WeakSet();
let savedRowT = 0;
async function flush() {
  if (!isHost || EDIT_ONLY) return;
  const rows = showLog.rows.filter((r) => r.t > savedRowT);
  const events = showLog.events.filter((e) => !savedEvents.has(e));
  if (!rows.length && !events.length) return;
  if (rows.length) savedRowT = rows.at(-1).t;
  for (const e of events) savedEvents.add(e);
  const rec = { eventId, id: `${session}-${String(chunkNo).padStart(4, '0')}`, session, n: chunkNo, startedAt: showLog.startedAt, at: Date.now(), rows, events, ...(chunkNo === 0 ? { meta: meta() } : {}) };
  chunkNo++;
  await idb.put('showlog', rec).catch((e) => console.warn('show log not kept', e?.message || e));
}
async function tidy() {
  const old = Date.now() - KEEP_DAYS * 86400_000;
  for (const r of await idb.listAll('showlog').catch(() => [])) if ((r.at || 0) < old) await idb.remove('showlog', r.eventId, r.id).catch(() => {});
}
export function showLogFile() {
  return showLog.toJSON(meta());
}
/** Save the show log (this session; the earlier ones are in Monitor) as a file. */
export async function saveShowLog() {
  await flush();
  const j = showLogFile();
  const blob = new Blob([JSON.stringify(j)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `vuemesh-showlog-${eventId}-${new Date(j.startedAt).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  showLog.event('saved', 'Show log saved');
  return j;
}
$('#slSave')?.addEventListener('click', () => saveShowLog());
/** For Monitor (every two seconds): the last ten minutes of frame rate and sound, the summary, the alerts. */
export function showLogBrief() {
  return {
    session, recent: showLog.rows.slice(-600).map((r) => [r.t, r.fps, r.pk, r.drv === 'tick' ? 1 : 0]),
    lines: showLog.summary(output.fps).lines, fps: output.fps, alerts: soundAlerts.map((a) => a.text), events: showLog.events.slice(-12).reverse().map((e) => ({ t: e.t, kind: e.kind, text: e.text })),
  };
}
window.vmShowLog = () => ({ rows: showLog.rows, events: showLog.events, summary: showLog.summary(), alerts: soundAlerts }); // (tests and diagnostics)
window.vmShowLogFlush = flush;
// (tests: a device letting go of its sound, as a USB interface does when it drops out)
window.vmEndSound = (peer) => live.get(peer)?.stream?.getAudioTracks().forEach((t) => {
  t.stop();
  t.dispatchEvent(new Event('ended'));
});
window.vmSessions = async () => joinChunks(await idb.list('showlog', eventId));

// ---- running it: on the background clock, so a hidden studio is logged too ----
let lastSampleAt = 0, lastStatsAt = 0, lastFlushAt = Date.now(), statsBusy = false;
async function slowStats() {
  // the phone links and TVs, every five seconds (asking for them takes a moment)
  if (statsBusy) return;
  statsBusy = true;
  try {
    for (const [peer, l] of live) if (!l.local && hub) {
      const st = await hub.stats(peer).catch(() => null);
      if (st) linkStats.set(peer, st);
    }
    for (const p of linkStats.keys()) if (!live.has(p)) linkStats.delete(p);
    tvStats = ((await displayHub?.stats().catch(() => [])) || []).map((x) => ({ n: x.name, st: x.status, fps: x.fps ?? null, kbps: x.kbps ?? null, lim: x.lim || null, w: x.w || null, h: x.h || null, cap: x.cap || null, ...(x.remote ? { remote: 1 } : {}), ...(x.rx ? { rfps: x.rx.fps, frz: x.rx.freezes, drop: x.rx.dropped } : {}) }));
  } finally {
    statsBusy = false;
  }
}
function tick() {
  measure();
  if (!isHost) return;
  const t = Date.now();
  if (t - lastSampleAt >= 1000) {
    lastSampleAt = t;
    try {
      sample();
    } catch (e) {
      console.warn('show log sample failed', e?.message || e);
    }
  }
  if (t - lastStatsAt >= 5000) {
    lastStatsAt = t;
    slowStats();
  }
  if (t - lastFlushAt >= CHUNK_MS) {
    lastFlushAt = t;
    flush();
  }
}
if (!EDIT_ONLY) {
  try {
    const clock = new Worker('/js/ticker.js');
    clock.onmessage = tick;
  } catch {
    setInterval(tick, 50);
  }
  devices().then((d) => (devicesBefore ||= d));
  addEventListener('pagehide', () => flush());
  tidy();
  renderAlertSetting();
  renderNotifs();
  help.querySelector('.bd')?.insertAdjacentHTML('beforeend', '<p><button type="button" id="slHelpSave">Save show log…</button> A second-by-second record of this show (frame rate, sound, devices), to send along with the diagnostics.</p>');
  help.querySelector('#slHelpSave')?.addEventListener('click', () => saveShowLog());
}
