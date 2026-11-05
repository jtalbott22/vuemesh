// Studio, part 11 of 23: the full screen control room, crew messages and rundown, moments.
// Loads after stream.js: that import comes first, so the parts run in order (see ../studio.js).
import './stream.js';
import { toast, esc, now, announce } from '/js/vm.js';
import { MediaLibrary } from '/js/media.js';
import {
  $, LIVE_DELAY, clips, eventId, hub, isHost, live, liveActive, mode, note, orientation,
} from './core.js';
import { angleOfCid } from './clips.js';
import { camOrder, cutLive, fitTile } from './live.js';
import { scoreOfLive } from './usage.js';
import { MODE_LABEL, mixState, renderMixer } from './mixer.js';
import { onBreak } from './graphics.js';
import { renderTimeline } from './edit.js';
import { fmtClock, mediaSel, renderMedia, renderMediaInsp, setMediaFilter, setMediaSel } from './library.js';

// ---- full screen control room ------------------------------------------------------------
// F (or the button): the whole screen becomes the control surface — program, switcher
// bus, multiview, and a vertical meter bridge with faders. Esc leaves.

function setFullscreenUi(on) {
  document.body.classList.toggle('fs', on);
  $('#fsBtn').setAttribute('aria-pressed', String(on));
  if ($('#fsBtn').firstChild) $('#fsBtn').firstChild.textContent = on ? 'Exit full screen ' : 'Full screen ';
  renderMixer();
  renderBus();
  live.forEach(fitTile);
}
export async function toggleFullscreen() {
  const on = !document.body.classList.contains('fs');
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // The browser said no (some don't allow it): use the layout anyway.
  }
  setFullscreenUi(on);
  announce(on ? 'Full screen control room' : 'Left full screen');
}
$('#fsBtn').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('fs')) setFullscreenUi(false);
});

// The switcher bus: one big button per camera, red when on air, with its sound mode.
export function renderBus() {
  if (!$('#bus')) return;
  const cams = camOrder();
  $('#bus').innerHTML = cams.length
    ? cams.map((peer) => {
        const l = live.get(peer);
        const n = angleOfCid(l.cid) || '?';
        const sc = scoreOfLive(l);
        return `<button type="button" class="busbtn${peer === liveActive && !onBreak() ? ' live' : ''}${sc != null && sc < 0.35 ? ' bad' : ''}" data-bus="${peer}" aria-pressed="${peer === liveActive && !onBreak()}" aria-label="Cut to camera ${n}, ${esc(l.name)}">
          <b>${n}</b><small>${esc(l.name)}</small><span class="aud" data-aud="${esc(l.cid || peer)}"></span></button>`;
      }).join('')
    : '<p class="fine" style="margin:0">No cameras yet.</p>';
  renderBusAudio();
}
export function renderBusAudio() {
  document.querySelectorAll('.tile[data-peer] .aud').forEach((el) => {
    const peer = el.closest('[data-peer]').dataset.peer;
    const l = live.get(peer);
    if (l) el.textContent = `♪ ${MODE_LABEL[mixState(l.cid || peer, l.role).mode]}`;
  });
}
$('#bus')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bus]');
  if (b) cutLive(b.dataset.bus);
});

// ---- crew: messages to phones, a rundown with cues --------------------------------------
// Short messages go to one phone (the box under its tile) or all of them. Phones show
// a small banner with quick replies; the rundown shows as one line ("Now · Next").
// Messages ride the reliable link to each phone; nothing goes through the cloud.

const crew = { rundown: [], cue: -1, ended: false, cleared: false, ...JSON.parse(localStorage.getItem('vm_crew_' + eventId) || '{}') };
const saveCrew = () => localStorage.setItem('vm_crew_' + eventId, JSON.stringify({ rundown: crew.rundown, cue: crew.cue, ended: crew.ended, cleared: crew.cleared }));
const dmLast = new Map(); // peer → {id, text, status, reply}
const msgId = () => Math.random().toString(36).slice(2, 10);

export function dmRow(peer, l, i) {
  let row = document.querySelector(`[data-dm="${CSS.escape(peer)}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'dmrow';
    row.dataset.dm = peer;
    row.innerHTML = `<input type="text" maxlength="140" aria-label="Message ${esc(l.name)}" placeholder="Message ${esc(l.name)}…"><button type="button">Send</button><span class="dmstat" aria-live="polite"></span>`;
    const input = row.querySelector('input');
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      if (sendDm(peer, text)) input.value = '';
    };
    row.querySelector('button').onclick = send;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    };
    (l.card || l.tile.parentNode).append(row);
  }
  renderDmStat(peer);
}

function renderDmStat(peer) {
  const st = document.querySelector(`[data-dm="${CSS.escape(peer)}"] .dmstat`);
  const d = dmLast.get(peer);
  if (!st) return;
  st.classList.toggle('reply', d?.status === 'reply');
  st.textContent = !d ? '' : d.status === 'reply' ? `↩ ${d.reply}` : `${d.status === 'seen' ? '✓✓ seen' : d.status === 'sent' ? '✓ sent' : '… not delivered'}: ${d.text}`;
}

export function sendDm(peer, text, all = false) {
  const l = live.get(peer);
  const id = msgId();
  const ok = hub?.message(peer, { t: 'msg', id, text, all });
  dmLast.set(peer, { id, text, status: ok ? 'sent' : 'failed' });
  renderDmStat(peer);
  if (!all) note(`To ${l?.name}: ${text}`);
  if (!ok && !all) toast(`Couldn't reach ${l?.name} right now`);
  return ok;
}

$('#dmAllBtn').onclick = () => {
  const text = $('#dmAll').value.trim();
  if (!text) return;
  const cams = camOrder();
  if (!cams.length) return toast('No cameras connected');
  const n = cams.filter((p) => sendDm(p, text, true)).length;
  note(`To all cameras: ${text}`);
  toast(`Sent to ${n} of ${cams.length} camera${cams.length > 1 ? 's' : ''}`);
  $('#dmAll').value = '';
};
$('#dmAll').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#dmAllBtn').click();
  }
};

export function crewHeard(peer, m) {
  const l = live.get(peer);
  const d = dmLast.get(peer);
  if (m.t === 'seen' && d && d.id === m.id && d.status !== 'reply') d.status = 'seen';
  if (m.t === 'reply') {
    if (d && d.id === m.id) Object.assign(d, { status: 'reply', reply: m.text });
    else dmLast.set(peer, { id: m.id, text: '', status: 'reply', reply: m.text });
    note(`${l?.name}: ${m.text}`);
    toast(`${l?.name}: ${m.text}`);
    announce(`${l?.name} replied: ${m.text}`);
  }
  renderDmStat(peer);
}

function broadcast(obj) {
  for (const peer of live.keys()) hub?.message(peer, obj);
}
/** The rundown as phones get it. An ended one comes off their screens but they keep it (and where it got to). */
const rundownMsg = () => ({ t: 'rundown', items: crew.rundown, cue: crew.ended ? -1 : crew.cue, last: crew.cue, ended: !!crew.ended });
function renderCueState() {
  const now = crew.rundown[crew.cue];
  const next = crew.rundown[crew.cue + 1];
  $('#cueState').textContent = !crew.rundown.length ? 'No rundown yet. Phones show the current item as one small line.'
    : crew.ended ? "Rundown ended: it's off the cameras. ◀ Prev or Next ▶ picks it back up; Send starts a new one."
    : now ? `Now: ${now}${next ? ` · Next: ${next}` : ' · last item (Next ▶ ends the rundown)'}` : `${crew.rundown.length} items sent. Press Next ▶ (or ]) to cue the first.`;
  $('#rundownEnd').disabled = !crew.rundown.length || !!crew.ended;
}
$('#rundownText').value = crew.rundown.join('\n');
renderCueState();
$('#rundownSend').onclick = () => {
  crew.rundown = $('#rundownText').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40);
  crew.cue = Math.min(crew.cue, crew.rundown.length - 1);
  crew.ended = false;
  crew.cleared = !crew.rundown.length;
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note(`Rundown sent (${crew.rundown.length} items)`);
  toast(`Rundown sent to ${live.size} phone${live.size === 1 ? '' : 's'}`);
};
export function stepCue(d) {
  if (!crew.rundown.length) return toast('Send a rundown first');
  if (crew.ended) {
    // picking an ended rundown back up, at the item it ended on
    crew.ended = false;
    crew.cue = Math.max(0, crew.cue);
  } else if (d > 0 && crew.cue >= crew.rundown.length - 1) return endRundown();
  else crew.cue = Math.max(-1, Math.min(crew.rundown.length - 1, crew.cue + d));
  saveCrew();
  broadcast({ t: 'cue', i: crew.cue });
  renderCueState();
  if (crew.rundown[crew.cue]) {
    note(`Cue: ${crew.rundown[crew.cue]}`);
    announce(`Cue: ${crew.rundown[crew.cue]}`);
  }
}
$('#cuePrev').onclick = () => stepCue(-1);
$('#cueNext').onclick = () => stepCue(1);

/** The show's past the last item (or off script): take the rundown off every camera. */
function endRundown() {
  if (!isHost || !crew.rundown.length || crew.ended) return;
  crew.ended = true;
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note('Rundown ended: off the cameras');
  toast("Rundown ended. It's off the cameras.");
  announce('Rundown ended');
}
function clearRundown() {
  if (!isHost) return;
  if ((crew.rundown.length || $('#rundownText').value.trim()) && !confirm('Clear the rundown? It comes off every camera and the list here is emptied.')) return;
  Object.assign(crew, { rundown: [], cue: -1, ended: false, cleared: true });
  $('#rundownText').value = '';
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note('Rundown cleared');
  toast('Rundown cleared from every camera');
  announce('Rundown cleared');
}
$('#rundownEnd').onclick = endRundown;
$('#rundownClear').onclick = clearRundown;

/** A phone that just joined gets the rundown, current cue and output shape (once its link opens). */
export function welcomePhone(peer, tries = 0) {
  const ok = hub?.message(peer, { t: 'output', orientation });
  if (!ok) {
    if (tries < 15 && live.has(peer)) setTimeout(() => welcomePhone(peer, tries + 1), 1000);
    return;
  }
  // (after a Clear, a phone that missed it still has the old one, so it hears about that too)
  if (crew.rundown.length || crew.cleared) hub.message(peer, rundownMsg());
}

// ---- moments: mark the crazy stuff live, make clips of it later ---------------------------
export const media = new MediaLibrary(eventId);
export function markMoment() {
  if (!isHost) return;
  const m = media.addMoment(now() - LIVE_DELAY);
  note(`Marked ${m.label}`);
  toast(`${m.label} marked. Rename it under Moments.`);
  announce(`${m.label} marked`);
  renderMoments();
  if (mode === 'edit') renderMedia();
}
$('#markBtn').onclick = markMoment;

// The Moments list (Live): rename in place, × to delete. Newest first.
export function renderMoments() {
  const box = $('#momList');
  if (document.activeElement?.matches?.('#momList input')) return; // don't pull the text box out from under someone typing (it re-renders on change)
  const list = media.moments.slice().reverse();
  $('#momEmpty').hidden = !!list.length;
  box.hidden = !list.length;
  box.innerHTML = list.map((m) => `<li data-mo="${esc(m.id)}"><time>${fmtClock(m.t)}</time><input type="text" maxlength="60" value="${esc(m.label)}" aria-label="Name of the moment at ${fmtClock(m.t)}" title="Click to rename"><button type="button" class="ltx" data-momdel aria-label="Delete ${esc(m.label)}" title="Delete">×</button></li>`).join('');
}
export function momentsChanged() {
  renderMoments();
  renderMedia();
  renderTimeline();
  if (mediaSel?.kind === 'moment') renderMediaInsp();
}
export function renameMoment(id, label) {
  const m = media.moments.find((x) => x.id === id);
  const v = String(label || '').trim().slice(0, 60);
  if (!m || !v || v === m.label) return false;
  const was = m.label;
  media.updateMoment(id, { label: v });
  note(`Renamed ${was} to ${v}`);
  announce(`Renamed to ${v}`);
  momentsChanged();
  return true;
}
export function deleteMoment(id) {
  const m = media.moments.find((x) => x.id === id);
  if (!m) return;
  media.removeMoment(id);
  if (mediaSel?.kind === 'moment' && mediaSel.id === id) setMediaSel(null);
  momentsChanged();
  note(`Deleted ${m.label}`);
  toast(`Deleted ${m.label}`);
  announce(`Deleted ${m.label}`);
}
export function clipsOfMoment(id) {
  const mo = media.moments.find((x) => x.id === id);
  if (!mo) return;
  const made = media.clipsFromMoment(id, clips.map((c) => c));
  setMediaFilter('subclip');
  renderMedia();
  toast(made.length ? `Made ${made.length} clip${made.length === 1 ? '' : 's'} of ${mo.label}` : `No camera was recording at ${mo.label}`);
  note(`Made ${made.length} clips of ${mo.label}`);
}
$('#momList').addEventListener('change', (e) => {
  const li = e.target.closest('[data-mo]');
  if (!li || !e.target.matches('input')) return;
  if (!renameMoment(li.dataset.mo, e.target.value)) e.target.value = media.moments.find((x) => x.id === li.dataset.mo)?.label || '';
  setTimeout(renderMoments);
});
$('#momList').addEventListener('keydown', (e) => {
  if (!e.target.matches('input')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.target.value = media.moments.find((x) => x.id === e.target.closest('[data-mo]').dataset.mo)?.label || '';
    e.target.blur();
  }
});
$('#momList').addEventListener('focusout', () => setTimeout(renderMoments));
$('#momList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-momdel]');
  if (b) deleteMoment(b.closest('[data-mo]').dataset.mo);
});
