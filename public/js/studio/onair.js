// Studio, part 5 of 26: tally, the AI technical director, direct links to phones.
// Loads after usage.js: that import comes first, so the parts run in order (see ../studio.js).
import './usage.js';
import { toast, announce } from '/js/vm.js';
import { Director } from '/js/director.js';
import { $, black, eventId, hub, isHost, live, liveActive, mode, note, orientation } from './core.js';
import { camOrder, cutLive } from './live.js';
import { scoreOfLive } from './usage.js';
import { mixFollowCut } from './mixer.js';
import { localRecFollow } from './sources.js';
import { qualityFirst } from './clips.js';
import { renderBus } from './room.js';
import { breakManual, mediaOn, onBreak, syncBreakUi } from './graphics.js';
import { airCovered, progRec, pvw, sw, swActive } from './switcher.js';
import { ap } from './autopilot.js';

// ---- tally: the phone that's on air lights up --------------------------------------------
let tallied = null;
let pvwTallied = null, swTallied = null;
export function syncTally() {
  renderBus();
  // through a dissolve, the incoming camera is on air too (tally on, and it starts recording)
  const inc = swActive() && sw.to && live.has(sw.to) && sw.to !== liveActive ? sw.to : null;
  if (inc !== swTallied) {
    if (swTallied && swTallied !== liveActive) hub?.send(swTallied, { t: 'tally', on: false });
    if (inc) hub?.send(inc, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
    swTallied = inc;
  }
  localRecFollow();
  const pv = pvw && live.has(pvw) && (pvw !== liveActive || airCovered()) ? pvw : null;
  if (pv !== pvwTallied) {
    if (pvwTallied) hub?.send(pvwTallied, { t: 'pvw', on: false });
    if (pv) hub?.send(pv, { t: 'pvw', on: true });
    pvwTallied = pv;
  }
  const on = onBreak() || mediaOn || black.target === 1 ? null : liveActive;
  if (on === tallied) return;
  if (tallied) hub?.send(tallied, { t: 'tally', on: false });
  if (on) hub?.send(on, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
  tallied = on;
}
document.addEventListener('vm-quality-first', () => tallied && hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() }));
setInterval(() => {
  // resend now and then, in case a message was lost
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
}, 4000);
// Cameras record their time on air while the director is recording the show (Record program):
// just cutting around shows the cameras live and records nothing. (With the setting on; it is
// by default.) A camera person's own recording is theirs, and runs as they choose.
const recOnAir = () => autoRec && !!progRec && !progRec.stopping;
/** Whether cameras record their time on air (the Recording card's setting): this computer's cameras follow it too. */
export const autoRecOn = () => autoRec;
export function recOnAirChanged() {
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
  if (swTallied) hub?.send(swTallied, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
  localRecFollow();
}
// Cameras record while they're on air (if they weren't already): on unless the host turns it off.
// (the host's last choice carries over to new events)
let autoRec = (localStorage.getItem('vm_autorec_' + eventId) ?? localStorage.getItem('vm_autorec_default') ?? '1') !== '0';
$('#autoRec').checked = autoRec;
$('#autoRec').onchange = (e) => {
  autoRec = e.target.checked;
  localStorage.setItem('vm_autorec_' + eventId, autoRec ? '1' : '0');
  localStorage.setItem('vm_autorec_default', autoRec ? '1' : '0');
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir(), first: qualityFirst() });
  localRecFollow(); // (this computer's cameras on air start or stop as the phones do)
  note(autoRec ? 'Cameras now record their time on air while you Record program' : 'Cameras no longer record automatically when on air');
};

// ---- the AI technical director -------------------------------------------------------------
// Phones rate their own shots (steady, level, not black, not covered, right way round);
// the director holds a shot at least 3 s, cuts away from a bad one within a second,
// changes angle for variety, and goes to the break slate if nothing is usable.

export const director = new Director();
export let autoOn = false;
export let manualUntil = 0;
export function setManualUntil(v) { return (manualUntil = v); }
export let directorBreak = false;
export function setDirectorBreak(v) { return (directorBreak = v); }
export function setAuto(on) {
  autoOn = on;
  $('#autoBtn').setAttribute('aria-pressed', String(on));
  director.set(liveActive, Date.now());
  if (!on && directorBreak) {
    directorBreak = false;
    syncBreakUi();
  }
  $('#directorNote').textContent = on ? 'Auto director is cutting. Press a number to take over for 8 seconds.' : 'Press 1–9 to cut, or let the auto director cut for you.';
  note(on ? 'Auto director on' : 'Auto director off');
  announce(on ? 'Auto director on' : 'Auto director off');
}
$('#autoBtn').onclick = () => isHost && setAuto(!autoOn);
export function directorTick() {
  if (!autoOn || mode !== 'live' || breakManual || mediaOn || Date.now() < manualUntil) return;
  // (on autopilot, a camera that's just arrived waits to be welcomed: preview, then on air with its name)
  const sources = camOrder().filter((peer) => !live.get(peer).paused && (!ap?.on || ap.seen.has(peer) || peer === liveActive)).map((peer) => {
    const l = live.get(peer);
    // (nothing measured, ever: this computer's own camera, or a shared screen. Neither shakes, so
    // it's taken as a good shot, not a middling one the phones always beat. A phone whose
    // reports have stopped coming is middling until they're back.)
    return { id: peer, score: scoreOfLive(l) ?? (l.qa ? 0.5 : 0.8), parts: l.qa?.parts, upright: l.qa?.upright, fixed: !!l.qa?.fixed };
  });
  if (!sources.length) return;
  const r = director.step(Date.now(), sources, orientation);
  if (r.breakOn !== directorBreak) {
    directorBreak = r.breakOn;
    syncBreakUi();
    mixFollowCut();
    syncTally();
    if (r.breakOn) note(`Auto director: ${r.reason}`);
  }
  if (r.cut && r.cut !== liveActive) cutLive(r.cut, r.reason);
}

// ---- network: get phones talking to this computer directly -------------------------------
// Browsers hide a computer's local address unless the page has microphone or camera
// permission. With it, phones on the same Wi-Fi can connect straight to this laptop.
async function micPermission() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return 'prompt';
  }
}
$('#localOnly').checked = localStorage.getItem('vm_localonly') === '1';
$('#localOnly').onchange = (e) => {
  localStorage.setItem('vm_localonly', e.target.checked ? '1' : '0');
  hub?.restartAll();
  note(e.target.checked ? 'Local network only: on' : 'Local network only: off');
};
$('#directBtn').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    toast('Thanks. Reconnecting phones on the local network…');
    note('Microphone permission granted: this computer now shares its local address');
    hub?.restartAll();
    updateNetwork();
  } catch {
    toast('Without that permission, phones may connect through the router or internet instead of directly.', 6000);
  }
};
export async function updateNetwork() {
  const cams = [...live.values()];
  const direct = cams.filter((l) => l.route === 'lan').length;
  const perm = await micPermission();
  $('#directBtn').hidden = perm === 'granted';
  $('#netState').textContent = cams.length
    ? `${direct} of ${cams.length} phone${cams.length > 1 ? 's' : ''} connected directly on the local network.${cams.some((l) => l.route === 'cellular') ? ' One or more is on mobile data.' : ''}`
    : 'No phones yet.';
}
