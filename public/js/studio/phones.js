// Studio, part 15 of 26: the live cut sent to the crew, iPhone playback, overflow, capacity, diagnostics, incoming clips.
// Loads after autopilot.js: that import comes first, so the parts run in order (see ../studio.js).
import './autopilot.js';
import { toast, esc, fmtDur, now, announce, diag, codecsOf, diagnosticsDialog } from '/js/vm.js';
import * as S from '/js/sequence.js';
import * as idb from '/js/idb.js';
import {
  $, EDIT_ONLY, black, clips, editCh, ev, eventId, help, hub, isHost, live, liveActive, log, mode,
  note, orientation, player, rawBlobs, recMime, seq, setSeq,
} from './core.js';
import { loadSeq } from './clips.js';
import { camOrder, renderLive } from './live.js';
import { renderMixer } from './mixer.js';
import { fileHasSound, localAired } from './sources.js';
import { onBreak } from './graphics.js';
import { progRec } from './switcher.js';
import { select } from './edit.js';

// ---- the live cut, sent to the crew ----------------------------------------------------
// While the program records, a second, lighter recorder cuts it into pieces of a few
// minutes. Each finished piece goes to every camera and microphone person who was
// connected during it (over the local link, nothing via the cloud), so they have the live
// cut of what they shot right away. Anyone away when a piece finishes gets it on return.
// It runs only while there's someone to give it to: with only this computer's own cameras
// and screens it was a second encoder of the whole program for nobody, and on a laptop that
// was enough to make Record program skip frames and the program repeat them.

const PIECE_MS = Number(localStorage.getItem('vm_piece_ms')) || 5 * 60 * 1000;
const PIECE_OVERLAP = 500;
const presKey = 'vm_presence_' + eventId, sentKey = 'vm_pgmsent_' + eventId;
const presence = JSON.parse(localStorage.getItem(presKey) || '{}'); // cid → [[from, to], …]
const pgmSent = JSON.parse(localStorage.getItem(sentKey) || '{}');   // cid → [piece ids]
let sendPgm = (localStorage.getItem('vm_sendpgm_' + eventId) ?? localStorage.getItem('vm_sendpgm_default') ?? '1') !== '0';
$('#sendPgm').checked = sendPgm;
$('#sendPgm').onchange = (e) => {
  sendPgm = e.target.checked;
  localStorage.setItem('vm_sendpgm_' + eventId, sendPgm ? '1' : '0');
  localStorage.setItem('vm_sendpgm_default', sendPgm ? '1' : '0');
  if (sendPgm) sendProgramParts();
  piecesWanted();
  renderPgmState();
};
const savePresence = () => localStorage.setItem(presKey, JSON.stringify(presence));
export function presenceOn(cid) {
  if (!cid) return;
  const t = now();
  (presence[cid] ||= []).push([t, t]);
  savePresence();
  piecesWanted(); // (the first person to join a recording: the live cut starts now, for them)
}
export function presenceOff(cid) {
  const iv = cid && presence[cid]?.[presence[cid].length - 1];
  if (iv) (iv[1] = now()), savePresence();
}
// while someone is connected, their latest stretch keeps growing
setInterval(() => {
  const t = now();
  let changed = false;
  for (const l of live.values()) {
    if (l.leaving) continue;
    const iv = l.cid && presence[l.cid]?.[presence[l.cid].length - 1];
    if (iv) (iv[1] = t), (changed = true);
  }
  if (changed) savePresence();
}, 5000);
const wasThere = (cid, t0, t1) => (presence[cid] || []).some(([a, b]) => a < t1 && b > t0);

let pieceRec = null, pieceN = 0, pieceTimer = null, pieceTracks = null;
const finishing = new Set(); // pieces stopped but not saved yet
const pieces = []; // {id, part, t0, t1} (blobs stay in the browser's storage)
idb.list('program', eventId).then((rs) => {
  for (const r of rs) if (r.kind === 'piece') pieces.push({ id: r.id, part: r.part, t0: r.t0, t1: r.t1, mime: r.mime });
  pieces.sort((a, b) => a.t0 - b.t0);
  pieceN = pieces.length;
  renderPgmState();
});
// someone to give the live cut to: a person's camera or microphone (not this computer's own)
const anyoneFor = () => sendPgm && [...live.values()].some((l) => !l.local && l.cid && !l.leaving);
const recording = () => progRec && !progRec.stopping;
export function startPieces(tracks) {
  pieceTracks = tracks;
  if (anyoneFor()) rollPiece();
}
/** Start the live cut if the program is recording, it isn't running, and someone's there for it. */
function piecesWanted() {
  if (recording() && pieceTracks && !pieceRec && anyoneFor()) rollPiece();
}
function rollPiece() {
  const mime = recMime();
  const rec = new MediaRecorder(new MediaStream(pieceTracks()), { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
  const chunks = [];
  const piece = { id: `${eventId}-${Math.round(now())}`, part: ++pieceN, t0: now(), mime: rec.mimeType };
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    piece.t1 = now();
    const blob = new Blob(chunks, { type: rec.mimeType });
    const f = await codecsOf(blob).catch(() => null);
    if (f) piece.codecs = `${f.container} · ${f.video} + ${f.audio}`;
    await idb.put('program', { eventId, kind: 'piece', ...piece, blob }).catch(() => {});
    diag('event', `Live cut part ${piece.part}: ${piece.codecs || piece.mime}, ${Math.round(blob.size / 1048576)} MB`);
    pieces.push(piece);
    finishing.delete(piece);
    renderPgmState();
    sendProgramParts();
  };
  rec.piece = piece;
  rec.start(1000);
  const prev = pieceRec;
  pieceRec = rec;
  if (prev) {
    finishing.add(prev.piece);
    setTimeout(() => prev.state !== 'inactive' && prev.stop(), PIECE_OVERLAP);
  }
  clearTimeout(pieceTimer);
  // the next piece, or (everyone gone) this one finished and no next: it starts again with the next person
  pieceTimer = setTimeout(() => recording() && (anyoneFor() ? rollPiece() : stopPieces()), PIECE_MS);
}
export function stopPieces() {
  clearTimeout(pieceTimer);
  if (pieceRec?.piece) finishing.add(pieceRec.piece);
  if (pieceRec?.state !== 'inactive') pieceRec?.stop();
  pieceRec = null;
}

let sending = false, sendAgain = false;
// Sending the live cut to the phones, without getting in the way of the show:
//  - one transfer at a time, and the phone is asked first: one that's recording, sending
//    its own clips or short of space says "not now", and gets it on a later pass
//  - the camera on air gets it slowest (its picture comes first)
//  - while the show is live, transfers are held to 2 Mbit/s so the live pictures keep the Wi-Fi;
//    after it, full speed
//  - someone leaving goes first, at full speed: the piece being recorded is finished early if
//    they were in it, and their phone waits for it (they can leave anyway)
export const leavingPeers = new Set();
let lastLeaveRoll = 0;
const owedTo = (cid) => pieces.filter((pc) => pc.t1 && wasThere(cid, pc.t0, pc.t1) && !(pgmSent[cid] || []).includes(pc.id));
const comingFor = (cid) => ([...finishing].some((p) => wasThere(cid, p.t0, now())) ? 1 : 0); // a piece about to be saved
const showIsOn = () => mode === 'live' && black.target !== 1 && camOrder().some((p) => !live.get(p)?.paused);
// bytes per second: during the show, 2 Mbit/s (1 to the camera on air); after it, full speed
const partRate = (peer) => (leavingPeers.size ? Infinity : !showIsOn() ? Infinity : peer === liveActive && !onBreak() ? 125_000 : 250_000);
export function prepareLeaving(peer) {
  const l = live.get(peer);
  if (!l?.cid || !sendPgm || !hub) return hub?.message(peer, { t: 'owed', n: 0 });
  const open = pieceRec?.piece;
  if (progRec && open && wasThere(l.cid, open.t0, now()) && Date.now() - lastLeaveRoll > 15000) {
    lastLeaveRoll = Date.now();
    rollPiece(); // their part of what's being recorded now: finish it so it can go with them
  }
  const n = owedTo(l.cid).length + comingFor(l.cid);
  hub.message(peer, { t: 'owed', n });
  if (!n) return;
  note(`${l.name} is leaving: sending them ${n} part${n > 1 ? 's' : ''} of the live cut first`);
  leavingPeers.add(peer);
  setTimeout(() => leavingPeers.delete(peer), 300000);
  sendProgramParts();
}
export async function sendProgramParts() {
  if (!sendPgm || !isHost || !hub) return;
  // one pass at a time; anything that finishes meanwhile gets sent right after (not in 30 s)
  if (sending) return (sendAgain = true);
  sending = true;
  sendAgain = false;
  try {
    const peers = [...live.keys()].filter((p) => !live.get(p)?.local).sort((a, b) => leavingPeers.has(b) - leavingPeers.has(a));
    // (a snapshot: parts finished during this pass are picked up by the next one; and someone
    // starting to leave cuts in at the next part, rather than waiting for this pass to end)
    const todo = [...pieces];
    pass: for (const peer of peers) {
      const l = live.get(peer);
      if (!l?.cid) continue;
      const urgent = leavingPeers.has(peer);
      for (const pc of todo) {
        if (!urgent && leavingPeers.size) {
          sendAgain = true;
          break pass;
        }
        if (!pc.t1 || (pgmSent[l.cid] || []).includes(pc.id) || !wasThere(l.cid, pc.t0, pc.t1)) continue;
        const rec = (await idb.list('program', eventId)).find((r) => r.id === pc.id);
        if (!rec?.blob) continue;
        try {
          const oid = `${peer}:${pc.id}`;
          try {
            await hub.sendFile(peer, { id: pc.id, part: pc.part, t0: pc.t0, t1: pc.t1, mime: pc.mime, codecs: pc.codecs || rec.codecs, title: ev.title }, rec.blob, (got, total) => outgoing.set(oid, { id: oid, name: l.name, part: pc.part, got, total, at: outgoing.get(oid)?.at || Date.now() }), { ask: !urgent, rate: () => partRate(peer) });
            sentLog.unshift({ at: Date.now(), name: l.name, part: pc.part, size: rec.blob.size, secs: Math.round((pc.t1 - pc.t0) / 1000) });
            sentLog.length = Math.min(sentLog.length, 60);
          } finally {
            outgoing.delete(oid);
          }
          (pgmSent[l.cid] ||= []).push(pc.id);
          localStorage.setItem(sentKey, JSON.stringify(pgmSent));
          l.pgmWait = null;
          note(`Sent part ${pc.part} of the live cut to ${l.name}`);
          renderPgmState();
          if (urgent) hub.message(peer, { t: 'owed', n: owedTo(l.cid).length + comingFor(l.cid) });
        } catch (e) {
          if (e.busy && l.pgmWait !== e.message) {
            l.pgmWait = e.message;
            note(`Live cut for ${l.name}: waiting (their phone is ${e.message})`);
            renderPgmState();
          } else if (!e.busy) {
            // say why in the event log (and Monitor), once per reason: it's tried again next round
            console.warn('program part not sent', e);
            if (l.pgmFail !== e.message) {
              l.pgmFail = e.message;
              note(`Live cut part ${pc.part} didn't reach ${l.name}: ${e.message}. Trying again.`);
            }
          }
          break; // try this person again later
        }
      }
      if (urgent && !owedTo(l.cid).length && !comingFor(l.cid)) {
        leavingPeers.delete(peer);
        hub.message(peer, { t: 'owed', n: 0 });
      }
    }
  } finally {
    sending = false;
    if (sendAgain) setTimeout(sendProgramParts, 0);
  }
}
setInterval(sendProgramParts, 30000);

function renderPgmState() {
  const el = $('#pgmState');
  if (!el) return;
  const cids = Object.keys(presence);
  const owed = pieces.reduce((n, pc) => n + cids.filter((c) => pc.t1 && wasThere(c, pc.t0, pc.t1)).length, 0);
  const sent = cids.reduce((n, c) => n + (pgmSent[c] || []).length, 0);
  el.textContent = !pieces.length ? 'Each camera gets the live cut of the time they were here, a few minutes at a time.'
    : `${pieces.length} part${pieces.length > 1 ? 's' : ''} of the live cut · sent ${sent} of ${owed}${sendPgm ? '' : ' (sending is off)'}` + pgmWaiting();
}
/** Who's still owed some of the live cut, and why it hasn't gone yet. */
function pgmWaiting() {
  const here = new Map([...live.values()].filter((l) => l.cid).map((l) => [l.cid, l]));
  const away = [], busy = [];
  for (const cid of Object.keys(presence)) {
    if (!owedTo(cid).length) continue;
    const l = here.get(cid);
    const name = l?.name || clips.find((c) => c.cid === cid || c.contributorId === cid)?.name || 'a camera';
    if (!l) away.push(name);
    else if (l.pgmWait) busy.push(`${name} (${l.pgmWait})`);
  }
  return (busy.length ? ` · waiting on ${busy.join(', ')}` : '') + (away.length ? ` · ${away.join(', ')} left before ${away.length > 1 ? 'their parts were' : 'their part was'} ready: it goes when they rejoin` : '');
}

// ---- can iPhones play what this browser records? ---------------------------------------
// Some browsers (Chromium and Chrome on Linux, for one) can't record H.264, so the program,
// the live cut and renders come out as VP9: fine on Android and computers, not on iPhones.
// A half-second test recording at startup finds out, and the studio says so plainly.
let pgmFormat = null;
async function probeProgramFormat() {
  if (!window.MediaRecorder) return;
  if (!isHost) {
    // the studio may not know it's the host yet on a slow connection: try again shortly
    if ((probeProgramFormat.tries = (probeProgramFormat.tries || 0) + 1) < 12) setTimeout(probeProgramFormat, 1500);
    return;
  }
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    const g = c.getContext('2d');
    const draw = setInterval(() => { g.fillStyle = `hsl(${Date.now() % 360},60%,50%)`; g.fillRect(0, 0, 64, 36); }, 30);
    const mime = recMime();
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime });
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    await new Promise((resolve) => {
      rec.onstop = resolve;
      rec.start(100);
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), 700);
    });
    clearInterval(draw);
    const f = await codecsOf(new Blob(parts, { type: rec.mimeType || mime }));
    // a video-only test has no sound track: read the sound codec from the format instead
    if (f.audio === '?') f.audio = /mp4a/.test(mime) ? 'AAC' : /opus/.test(mime) || /webm/.test(mime) ? 'Opus' : MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') ? 'AAC' : 'Opus';
    pgmFormat = { ...f, mime };
    diag('event', `Program recording format: ${f.container} · ${f.video} + ${f.audio} (${mime})`);
  } catch (e) {
    diag('warn', `Couldn't test the recording format: ${e.message}`);
  }
  renderFormatNote();
}
function renderFormatNote() {
  const el = $('#pgmFormat');
  if (!el || !pgmFormat) return;
  el.hidden = pgmFormat.iphone;
  el.innerHTML = `This browser records the program as <b>${pgmFormat.video} video with ${pgmFormat.audio} sound</b>. Android phones and computers play it, but <b>iPhones can't</b> (that goes for the live cut sent to phones, too). For files every phone plays, run the studio in Chrome or Edge on a Mac or Windows PC, or Safari on a Mac.`;
}
setTimeout(probeProgramFormat, 1500);

// ---- record-only overflow ----------------------------------------------------------------
// The studio shows up to a set number of live pictures. Phones past that join recording
// only: no live picture or sound (lighter for the Wi-Fi and the laptop), but they record and
// send every clip. When a live camera leaves, the first one waiting moves up; Swap in trades
// a waiting phone for the live camera that's been off air longest.
export let liveLimit = Math.max(1, Math.min(24, Number(localStorage.getItem('vm_livelimit_' + eventId) || localStorage.getItem('vm_livelimit_default') || 12)));
export const lastOnAir = new Map();
$('#liveLimit').value = liveLimit;
$('#liveLimit').onchange = (e) => {
  liveLimit = Math.max(1, Math.min(24, Math.round(+e.target.value || 12)));
  e.target.value = liveLimit;
  localStorage.setItem('vm_livelimit_' + eventId, liveLimit);
  localStorage.setItem('vm_livelimit_default', liveLimit);
  note(`Live pictures: up to ${liveLimit}`);
  rebalanceSlots();
};
export function sendSlot(peer, tries = 0) {
  const l = live.get(peer);
  if (!l) return;
  if (!hub?.message(peer, { t: 'slot', live: !l.overflow }) && tries < 15) setTimeout(() => sendSlot(peer, tries + 1), 1000);
}
function setSlot(peer, isLive) {
  const l = live.get(peer);
  if (!l || !!l.overflow === !isLive) return;
  l.overflow = !isLive;
  sendSlot(peer);
  note(isLive ? `${l.name} is live again` : `${l.name} is recording only`);
}
export function rebalanceSlots() {
  const cams = [...live].filter(([, l]) => l.role !== 'mic').sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  let shown = cams.filter(([, l]) => !l.overflow).length;
  // limit lowered: the most recent joiners that aren't on air step back first
  for (const [peer, l] of cams.slice().reverse()) {
    if (shown <= liveLimit) break;
    if (!l.overflow && peer !== liveActive) (setSlot(peer, false), shown--);
  }
  // room again: whoever has waited longest comes up
  for (const [peer, l] of cams) {
    if (shown >= liveLimit) break;
    if (l.overflow) (setSlot(peer, true), shown++);
  }
  renderLive();
  renderMixer();
}
function swapIn(peer) {
  const out = camOrder().filter((p) => p !== liveActive).sort((a, b) => (lastOnAir.get(a) || 0) - (lastOnAir.get(b) || 0))[0];
  if (camOrder().length >= liveLimit) {
    if (!out) return toast('Every live camera is on air right now');
    setSlot(out, false);
  }
  setSlot(peer, true);
  announce(`${live.get(peer)?.name} is live${out ? `; ${live.get(out)?.name} records only` : ''}`);
  renderLive();
  renderMixer();
}
export function renderOverflow() {
  const waiting = [...live].filter(([, l]) => l.overflow).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  $('#overflowBox').hidden = !waiting.length;
  $('#ovCount').textContent = waiting.length ? `${waiting.length}` : '';
  $('#ovList').innerHTML = waiting.map(([peer, l]) => {
    const rec = l.tele?.rec ?? l.rec;
    return `<li><span class="nm">${esc(l.name)}</span><span class="rs ${rec ? 'on' : ''}">${rec ? '● recording' : 'standing by'}</span><button type="button" data-swap="${esc(peer)}" aria-label="Swap ${esc(l.name)} in to the live pictures">Swap in</button></li>`;
  }).join('');
}
$('#ovList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-swap]');
  if (b) swapIn(b.dataset.swap);
});
setInterval(() => mode === 'live' && renderOverflow(), 2000);

// ---- how many phones one studio can carry ------------------------------------------------
// Each phone's live picture is about 1.2 Mbps; the real limits are the laptop decoding them
// all and the Wi-Fi carrying full-quality clips too. Past about a dozen, say so (they still
// record and send their clips).
const COMFORTABLE_CAMERAS = 12;
let warnedCrowd = false;
export function checkCrowd() {
  const cams = camOrder().length;
  if (cams > COMFORTABLE_CAMERAS && !warnedCrowd) {
    warnedCrowd = true;
    toast(`${cams} cameras live. One device shows about ${COMFORTABLE_CAMERAS} smoothly; more can stutter. Everyone still records and sends their clips. See Help → Network and capacity.`, 8000);
    note(`${cams} cameras live (more than about ${COMFORTABLE_CAMERAS} can stutter on one device)`);
  }
}

// ---- diagnostics for this studio ---------------------------------------------------------
async function studioDiagSections() {
  const phones = [...live.values()].map((l) => `${l.name} · ${l.role}${l.fixed ? ' (computer)' : ''} · ${l.route || '?'}${l.paused ? ' · paused' : ''}`);
  return [
    ['Studio', [
      `Event ${eventId} "${ev?.title || ''}" · ${isHost ? 'host' : 'viewer'} · ${mode} · output ${orientation}`,
      `Sound engine: ${player.ctx.state} · editing ${seq.tracks.length} tracks, ${S.end(seq) ? fmtDur(S.end(seq)) : 'empty'}`,
      `Program recording format: ${pgmFormat ? `${pgmFormat.container} · ${pgmFormat.video} + ${pgmFormat.audio} (${pgmFormat.mime})${pgmFormat.iphone ? '' : ' — iPhones can\'t play this'}` : 'not tested yet'}`,
      `Recordings received: ${clips.length} (${clips.filter((c) => c.kind === 'audio').length} sound only)`,
      `Live cut: ${$('#pgmState')?.textContent || '—'}`,
    ]],
    ['Phones connected', phones.length ? phones : ['none']],
    ['Edit sound', [
      ...seq.tracks.filter((t) => t.kind === 'audio').map((t) => `${t.name}: ${t.muted ? 'muted' : `${Math.round(20 * Math.log10(Math.max(1e-6, t.gain ?? 1)))} dB`}${t.follow ? ` · follows the picture${t.duck ? ' · ducks under microphones' : ''}` : ''}${t.mic ? ` · ${t.items.length} recording${t.items.length === 1 ? '' : 's'}` : ''}`),
      `Microphone recordings cover ${Math.round(S.micCover(seq).reduce((s, [a, b]) => s + b - a, 0) / 1000)} s of the film (camera sound ducks there)`,
      ...(await Promise.all(clips.filter((c) => c.kind !== 'audio').slice(-8).map(async (c) => `${c.name} ${new Date(c.t0).toTimeString().slice(0, 8)}${c.local ? ' (this computer)' : ''}: ${c.mime || '?'} · sound ${({ true: 'yes', false: 'NONE', null: '?' })[String(typeof c.sound === 'boolean' ? c.sound : rawBlobs.get(c.id) ? await fileHasSound(rawBlobs.get(c.id)) : null)]}`))),
    ]],
    ['Event log (newest first)', log.slice(0, 30).map((x) => `${new Date(x.at).toTimeString().slice(0, 8)} ${x.text}`)],
  ];
}
const openStudioDiag = diagnosticsDialog(studioDiagSections);
window.vmDiag = studioDiagSections; // (tests and diagnostics)
window.vmProgram = () => (seq.tracks.find((t) => t.id === 't-prog')?.items || []).map((it) => { const c = clips.find((k) => k.id === it.src); return { id: it.id, name: c?.name, local: !!c?.local, reel: !!c?.reel, program: !!c?.program, start: Math.round(it.start), dur: Math.round(it.dur), dissolve: it.transIn?.dur || 0, fadeIn: it.fadeIn || 0, fadeOut: it.fadeOut || 0, type: it.type }; });
window.vmSeek = (ms) => player.seek(ms); // (tests and diagnostics)
window.vmSelect = (id) => select(id);
if (!EDIT_ONLY) {
  // in the studio (tests and diagnostics): the timeline as the Edit window last saved it, and
  // seek and select asked of it over the channel (it's in its own process)
  const programOf = window.vmProgram;
  window.vmProgram = () => {
    const saved = loadSeq();
    if (!saved) return [];
    const mine = seq;
    setSeq(saved);
    try {
      return programOf();
    } finally {
      setSeq(mine);
    }
  };
  window.vmSeek = (ms) => editCh?.postMessage({ t: 'seek', ms });
  window.vmSelect = (id) => editCh?.postMessage({ t: 'select', id });
}
window.vmNotes = () => log.slice(0, 30).map((x) => x.text); // (tests and diagnostics: the event log, newest first)
window.vmLocal = () => [...live].filter(([, l]) => l.local).map(([p, l]) => ({ peer: p, rec: !!l.rec, recorder: l.recorder?.state || null, aired: localAired(p), black: black.target, cleared: black.cleared }));
window.vmClipList = () => clips.map((c) => ({ name: c.name, kind: c.kind, local: !!c.local, reel: !!c.reel, program: !!c.program, dur: c.dur }));
help.querySelector('.bd').insertAdjacentHTML('beforeend', '<h3>Something not working?</h3><p>Copy a diagnostics report and send it along: it describes this computer, its browser and what just happened (not your recordings).</p><p><button type="button" id="diagBtn">Copy diagnostics…</button></p>');
help.querySelector('#diagBtn').onclick = () => { help.close(); openStudioDiag(); };

// ---------------------------------------------------------------- incoming ----

export const incoming = new Map();
// Transfers live in the Monitor (coming in, going out, received, sent), not in the studio's
// layout; the Monitor button's light shows when something's moving and when there's news.
export const outgoing = new Map(), sentLog = [];
export function renderIncoming(p) {
  if (p.done) incoming.delete(p.id);
  else incoming.set(p.id, { ...p, at: incoming.get(p.id)?.at || Date.now() });
  monitorLight();
}
export let monitorSeenAt = Date.now(), lastLight = '';
export function setMonitorSeenAt(v) { return (monitorSeenAt = v); }
export function monitorLight() {
  const busy = incoming.size + outgoing.size > 0;
  const news = log.filter((x) => x.at > monitorSeenAt).length;
  const sig = `${busy}|${news}`;
  if (sig === lastLight) return;
  lastLight = sig;
  const b = $('#monitorBtn');
  b.classList.toggle('busy', busy);
  b.classList.toggle('news', news > 0);
  b.title = [busy ? `${incoming.size ? `${incoming.size} coming in` : ''}${incoming.size && outgoing.size ? ', ' : ''}${outgoing.size ? `${outgoing.size} going out` : ''}` : '', news ? `${news} new in the event log` : '', 'Open the monitor: phones, transfers and the event log'].filter(Boolean).join(' · ');
}
setInterval(monitorLight, 1000);
