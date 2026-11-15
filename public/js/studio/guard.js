// A show runs only while a person is at its studio.
//
// - Nobody here: with no phones, screens, TVs or call in, nothing recording or streaming, and nobody
//   using this page for 30 minutes, the studio lets the server go (it's not live, and nobody can join)
//   and says so, with Resume. Cameras plugged into this computer stay, recording nothing.
// - Every 12 hours: "Still running this show?" A person answers and it carries on; unanswered for 10
//   minutes, the show ends: recording and streaming stop (what's recorded is kept), every phone is told
//   and let go, and the studio stays shut until a person opens it again. The server ends it too, a
//   little after, if this page doesn't (core.mjs SHOW_LIMITS).
// - Admin's End show reaches here as the server's 'ended', and ends it the same way.
// Kiosks (a show that ends when its guests leave) don't ask; the Edit page has no connection.
import { announce, toast } from '/js/vm.js';
import { KIOSK, hub, live, note, sock } from './core.js';
import { progRec } from './switcher.js';
import { streamOut, stopStream } from './stream.js';
import { displayHub } from './screens.js';
import { toggleProgramRecording } from './autopilot.js';
import { stopLocalRec } from './sources.js';
import { leaveCall } from './callin.js';

export const GUARD = { idleMs: 30 * 60_000, confirmMs: 12 * 3600_000, answerMs: 10 * 60_000 };
// (tests: shorter times, from localStorage vm_guard_test; never longer than these)
try {
  const t = JSON.parse(localStorage.getItem('vm_guard_test') || '{}');
  for (const k of Object.keys(GUARD)) if (Number.isFinite(t[k]) && t[k] > 0) GUARD[k] = Math.min(GUARD[k], t[k]);
} catch {}

let confirmedAt = Date.now(), lastHand = Date.now(), quietSince = Date.now(), ended = false, asking = null;

/** Recording or streaming: what the studio tells the server with each ping (Admin's live) */
export const showBusy = () => !!(progRec && !progRec.stopping) || !!streamOut || [...live.values()].some((l) => l.recorder);
// Anything that makes this a show going on: a device in (a phone, a screen, a call), a TV, or busy
const showActive = () => showBusy() || [...live.values()].some((l) => !l.local) || !!displayHub?.links.size;

const dlg = (id, html) => {
  let d = document.getElementById(id);
  if (!d) {
    d = document.createElement('dialog');
    d.id = id;
    d.className = 'localdlg guarddlg';
    d.setAttribute('aria-labelledby', id + 'H');
    document.body.append(d);
  }
  d.innerHTML = html;
  return d;
};
const fmt = (ms) => (ms >= 3600_000 ? `${Math.round(ms / 3600_000)} hours` : `${Math.round(ms / 60_000)} minutes`);

// ---- nobody here: pause, and Resume ---------------------------------------------------------
function pause() {
  if (ended || sock.paused) return;
  sock.pause();
  note(`Paused: nobody here for ${fmt(GUARD.idleMs)} (no phones, nothing recording or streaming)`);
  const d = dlg('pauseDlg', `<h2 id="pauseDlgH">Paused: nobody's here</h2>
    <p class="fine">No phones, screens or TVs have been in this show, nothing has been recording or streaming, and nobody has used this page for ${fmt(GUARD.idleMs)}. So the studio has let go of the server: it isn't live, and nobody can join until you resume. Cameras on this computer are still here, recording nothing.</p>
    <form method="dialog"><button class="primary" value="resume" autofocus>Resume the show</button></form>`);
  d.onclose = () => resume();
  if (!d.open) d.showModal();
  announce("Paused: nobody's here. Resume the show to carry on.");
}
function resume() {
  if (ended || !sock.paused) return;
  quietSince = lastHand = confirmedAt = Date.now();
  sock.resume(); // (as a person opening it: the server confirms it again)
  note('Resumed');
  toast('Back on: phones can join again', 3000);
}

// ---- every 12 hours: still running? -----------------------------------------------------------
function ask() {
  if (asking || ended) return;
  const due = Date.now() + GUARD.answerMs;
  const d = dlg('stillDlg', `<h2 id="stillDlgH">Still running this show?</h2>
    <p class="fine">It's been ${fmt(GUARD.confirmMs)} since anyone said so. Shows end on their own unless a person is here, so nobody can be recorded for days with no one at the studio.</p>
    <p class="fine">If nobody answers in <b class="guardleft"></b>, the show ends: recording and streaming stop (what's recorded is kept) and every phone is let go.</p>
    <form method="dialog" class="row" style="justify-content:flex-end;gap:8px"><button value="end">End the show</button><button class="primary" value="keep" autofocus>Keep going</button></form>`);
  const left = d.querySelector('.guardleft');
  const tick = () => {
    const ms = Math.max(0, due - Date.now());
    left.textContent = `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`;
    if (!ms) d.close('timeout');
  };
  asking = setInterval(tick, 1000);
  tick();
  d.onclose = () => {
    clearInterval(asking);
    asking = null;
    if (d.returnValue === 'keep') return confirm();
    endShow(d.returnValue === 'end' ? 'host' : 'unconfirmed');
  };
  d.showModal();
  announce('Still running this show? Answer within 10 minutes or it ends.');
  // (a notification too, if this browser already lets the site send them: the studio may be in a tab behind others)
  try { if (Notification.permission === 'granted') new Notification('VUEMesh: still running this show?', { body: 'Answer in the studio within 10 minutes, or the show ends.' }); } catch {}
}
function confirm() {
  confirmedAt = lastHand = Date.now();
  if (sock.paused) return resume();
  sock.send({ action: 'confirm' });
  note('Still running: confirmed for another 12 hours');
}

// ---- the end ----------------------------------------------------------------------------------
const WHY = {
  unconfirmed: `Nobody said the show was still running after ${fmt(GUARD.confirmMs)}, so it ended by itself.`,
  admin: 'The show was ended by VUEMesh (an administrator).',
  host: 'You ended the show.',
};
export async function endShow(reason) {
  if (ended) return;
  ended = true;
  clearInterval(asking);
  document.getElementById('stillDlg')?.close('ended');
  note(`The show ended: ${reason}`);
  try { if (progRec && !progRec.stopping) await toggleProgramRecording(); } catch {}
  try { if (streamOut) await stopStream('The show ended.'); } catch {}
  for (const [peer, l] of [...live]) {
    if (l.local) { if (l.recorder) stopLocalRec(peer); continue; }
    if (l.call) continue;
    hub?.message(peer, { t: 'kick', ended: true });
    hub?.send(peer, { t: 'kick', ended: true });
  }
  try { leaveCall(); } catch {}
  for (const peer of [...(displayHub?.links.keys() || [])]) displayHub.close(peer);
  setTimeout(() => {
    for (const peer of [...(hub?.links.keys() || [])]) hub.drop(peer, 'removed');
    // (the server too: it tells any phone still connected, Admin stops showing it, and the studio
    // stays shut until a person opens it; the server's own 'ended' needs no answer)
    if (reason !== 'admin') sock.send({ action: 'end', reason });
    setTimeout(() => sock.close(), 300);
  }, 1500);
  const d = dlg('endedDlg', `<h2 id="endedDlgH">This show has ended</h2>
    <p class="fine">${WHY[reason] || WHY.admin} Recording and streaming stopped, and every phone was let go. What was recorded is kept here.</p>
    <form method="dialog" class="row" style="justify-content:flex-end;gap:8px"><button value="stay">Stay on this page</button><button class="primary" value="open">Open the studio again</button></form>`);
  d.onclose = () => d.returnValue === 'open' && location.reload();
  if (!d.open) d.showModal();
  announce('This show has ended.');
}

// ---- watching ---------------------------------------------------------------------------------
export function startGuard() {
  if (KIOSK || !sock) return;
  for (const e of ['pointerdown', 'keydown', 'wheel']) addEventListener(e, () => (lastHand = Date.now()), { capture: true, passive: true });
  setInterval(() => {
    if (ended) return;
    const now = Date.now();
    if (showActive()) quietSince = now;
    if (!sock.paused && now - quietSince >= GUARD.idleMs && now - lastHand >= GUARD.idleMs) pause();
    if (!sock.paused && now - confirmedAt >= GUARD.confirmMs) ask();
  }, Math.min(10_000, GUARD.idleMs / 3));
  window.vmGuard = () => ({ paused: !!sock.paused, ended, asking: !!asking, busy: showBusy(), active: showActive(), confirmedAt, quietSince, lastHand }); // (tests and diagnostics)
}
/** The server's word: the show ended (Admin's End show, or past the 12 hours) */
export function onServerMessage(m) {
  if (m.type === 'ended') return endShow(m.reason === 'unconfirmed' ? 'unconfirmed' : 'admin');
}
