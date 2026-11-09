// Studio, part 2 of 26: output shape, clips, the cut log, the channel to the Edit page, Live/Edit modes.
// Loads after core.js: that import comes first, so the parts run in order (see ../studio.js).
import './core.js';
import { api, toast, fmtDur, announce } from '/js/vm.js';
import { drawFramed, tfOf } from '/js/compose.js';
import * as S from '/js/sequence.js';
import * as idb from '/js/idb.js';
import {
  $, COLORS, EDIT_ONLY, blobs, clips, cut, editCh, editPageAt, eventId, fit, fitMonitors, hub, isHost,
  key, live, mode, note, orientation, player, program, rawBlobs, seq, setCut, setFitValue,
  setModeValue, setOrientationValue, setSeq, thumbs, timeline,
} from './core.js';
import { fitTile, renderLive } from './live.js';
import { reportUsageSoon } from './usage.js';
import { renderMixer } from './mixer.js';
import { fileHasSound, flushRecordings, isBlocked } from './sources.js';
import { media } from './room.js';
import { reel } from './graphics.js';
import { progRec } from './switcher.js';
import { incoming } from './phones.js';
import { renderCredits, renderInspector, renderMulti, renderTimeline } from './edit.js';
import { applyLayout } from './transport.js';
import { leftTab, monTab, renderMedia, setLeftTab, setMonTab } from './library.js';

// ------------------------------------------------------------ output shape ---

// Output settings: the program's frame rate and size, which Record program, the TVs, the
// stream and Render MP4 are all made at. Kept per event on this computer; fixed while Record
// program runs (a recording is one rate from start to end).
export const FRAME_RATES = [24, 25, 29.97, 30, 50, 60];
const outSaved = (() => {
  try {
    return JSON.parse(localStorage.getItem('vm_output_' + eventId) || '{}');
  } catch {
    return {};
  }
})();
export const output = { fps: FRAME_RATES.includes(outSaved.fps) ? outSaved.fps : 30, height: outSaved.height === 1080 ? 1080 : 720 };
// Quality first: for a studio computer with power to spare. Record program and this computer's own
// recordings at about twice the bitrate, and the camera on air allowed more on the local network
// (see qualityFor). Kept on this computer, for every show.
export const qualityFirst = () => {
  try {
    return localStorage.getItem('vm_quality_first') === '1';
  } catch {
    return false;
  }
};
/** Record program's bitrate, bits a second: Quality first doubles it (12 Mbit/s at 720p, 20 at 1080p). */
export const programBitrate = (h) => (qualityFirst() ? (h >= 1080 ? 20_000_000 : 12_000_000) : h >= 1080 ? 10_000_000 : 6_000_000);
export const outputLabel = () => `${output.height}p at ${output.fps} frames a second`;
export function setOutput(change) {
  if (progRec) return void toast('Stop Record program first: a recording keeps one frame rate and size');
  Object.assign(output, change);
  localStorage.setItem('vm_output_' + eventId, JSON.stringify(output));
  setOrientation(orientation, false);
  renderOutput();
  note(`Output: ${outputLabel()}`);
  announce(`Output is now ${outputLabel()}`);
}
export function renderOutput() {
  const fps = $('#outFps'), size = $('#outSize');
  if (!fps || !size) return;
  if (!fps.options.length) fps.innerHTML = FRAME_RATES.map((f) => `<option value="${f}">${f}</option>`).join('');
  fps.value = String(output.fps);
  size.value = String(output.height);
  fps.disabled = size.disabled = !!progRec;
  if ($('#qualityFirst')) $('#qualityFirst').disabled = !!progRec; // (a recording keeps its bitrate)
  const hint = $('#outHint');
  if (hint) hint.textContent = progRec ? 'Fixed while Record program runs.' : `${output.height === 1080 ? 'Sharper, and about twice the work: for one or two cameras here, or a computer with its own graphics card. With three cameras and a screen, a laptop can fall behind and Record program skips frames.' : 'Smooth on most computers, with several cameras and a screen.'} 30 for most shows; 25 where TV is 25 (Europe); 29.97 to match broadcast video in North America.`;
}
$('#outFps')?.addEventListener('change', (e) => setOutput({ fps: Number(e.target.value) }));
$('#outSize')?.addEventListener('change', (e) => setOutput({ height: Number(e.target.value) }));
if ($('#qualityFirst')) $('#qualityFirst').checked = qualityFirst();
$('#qualityFirst')?.addEventListener('change', (e) => {
  try { localStorage.setItem('vm_quality_first', e.target.checked ? '1' : '0'); } catch {}
  note(`Quality first: ${e.target.checked ? 'on' : 'off'}`);
  document.dispatchEvent(new Event('vm-quality-first')); // (the camera on air hears at once: see onair.js)
});

export function setOrientation(o, persist = true) {
  setOrientationValue(o === 'portrait' ? 'portrait' : 'landscape');
  const long = Math.round((output.height * 16) / 9);
  const [w, h] = orientation === 'portrait' ? [output.height, long] : [long, output.height];
  if (program.width !== w || program.height !== h) {
    program.width = w;
    program.height = h;
  }
  document.body.classList.toggle('portrait', orientation === 'portrait');
  fitMonitors();
  $('#landBtn').setAttribute('aria-pressed', String(orientation === 'landscape'));
  $('#portBtn').setAttribute('aria-pressed', String(orientation === 'portrait'));
  if (typeof timeline !== 'undefined' && mode === 'edit') renderTimeline();
  if (!persist) return;
  localStorage.setItem('vm_orient_' + eventId, orientation);
  if (isHost) api(`events/${eventId}`, { method: 'PATCH', host: key, body: { orientation } }).catch(() => {});
  for (const peer of live.keys()) hub?.message(peer, { t: 'output', orientation });
  announce(`Output is now ${orientation}`);
}
$('#landBtn').onclick = () => setOrientation('landscape');
$('#portBtn').onclick = () => setOrientation('portrait');

export function setFit(f) {
  setFitValue(f === 'fit' ? 'fit' : 'fill');
  player.fit = fit;
  document.body.classList.toggle('fit', fit === 'fit');
  $('#fillBtn').setAttribute('aria-pressed', String(fit === 'fill'));
  $('#fitBtn').setAttribute('aria-pressed', String(fit === 'fit'));
  localStorage.setItem('vm_fit_' + eventId, fit);
  live.forEach(fitTile);
}
$('#fillBtn').onclick = () => setFit('fill');
$('#fitBtn').onclick = () => setFit('fit');

// ------------------------------------------------------------------ clips ----

export function addClip(rec, blob, fresh) {
  if (clips.some((c) => c.id === rec.id)) return;
  const { blob: _b, key: _k, ...meta } = rec;
  clips.push(meta);
  if (meta.kind !== 'audio' && !meta.reel && !meta.program) noteAngle(meta.cid);
  rawBlobs.set(meta.id, blob);
  blobs.set(meta.id, URL.createObjectURL(blob));
  if (meta.kind !== 'audio') makeThumb(meta.id);
  if (EDIT_ONLY && meta.kind === 'video' && typeof meta.sound !== 'boolean' && !meta.program && !meta.reel) checkSound(meta.id, blob);
  if (fresh) {
    const what = meta.kind === 'audio' ? 'microphone recording' : 'clip';
    note(`${meta.name}'s ${what} arrived (${Math.round(blob.size / 1048576)} MB, verified)`);
    announce(`${meta.name}'s ${what} arrived`); // (no pop-up: it's in the Monitor)
    window.vmLastArrival = Date.now(); // (for tests and diagnostics)
    reportUsageSoon();
    if (!EDIT_ONLY) editCh?.postMessage({ t: 'clip', id: meta.id }); // (the Edit page, if one's open, takes it)
    seqFromEditPage();
    if (editElsewhere()) {
      // the Edit page puts it in the timeline
    } else if (seq.auto) rebuild(false);
    else appendLiveSoon(); // (an edit made by hand: new live footage goes on the end)
    player.setSequence(seq);
    renderAll();
    renderMedia();
  }
}

// Has a recording sound in it? Recordings made before 0.62.3 didn't say when they had none (a
// webcam or screen added without sound): Edit looks once, keeps the answer with the recording,
// and plays the sound as aired under the silent ones (see rebuildFromCuts).
let soundRebuild = null;
async function checkSound(id, blob) {
  const has = await fileHasSound(blob);
  if (has === null) return;
  const c = clips.find((x) => x.id === id);
  if (!c) return;
  c.sound = has;
  idb.patch('clips', eventId, id, { sound: has }).catch(() => {});
  if (has || !seq.auto) return;
  clearTimeout(soundRebuild);
  soundRebuild = setTimeout(() => {
    rebuild(false);
    player.setSequence(seq);
    renderAll();
  }, 300);
}

// Footage that aired after the timeline was edited by hand goes on its end, after a gap as
// long as the real time since the last part (Collapse gaps takes that out). It waits until
// the clips have stopped arriving, so a camera's part and a phone's land together.
let appendTimer = null;
export function appendLiveSoon(delay = 3000) {
  if (!EDIT_ONLY) return; // (the Edit page builds the timeline)
  clearTimeout(appendTimer);
  appendTimer = setTimeout(() => {
    if (incoming.size) return appendLiveSoon(); // (more on the way)
    const edl = resolvedEdl().filter((c) => !isBlocked(c.cid));
    const use = clips.filter((c) => !isBlocked(c.cid) && !c.program).map(usable), fills = asAired();
    if (seq.auto || !S.appendLive(S.clone(seq), edl, use, fills)) return;
    snapshot();
    const r = S.appendLive(seq, edl, use, fills);
    saveSeq();
    player.setSequence(seq);
    renderTimeline();
    if (mode === 'edit') timeline.zoomToFit();
    const len = fmtDur(r.to - r.from).slice(0, -3), gap = fmtDur(r.gap).slice(0, -3);
    note(`New live footage (${len}) added to the end of the timeline, ${gap} after the last part`);
    toast(`New live footage (${len}) is on the end of the timeline, ${gap} after the last part. Collapse gaps takes the empty time out.`, 6000);
  }, delay);
}

function makeThumb(id) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = blobs.get(id);
  v.addEventListener('loadeddata', () => {
    v.currentTime = Math.min(1, (v.duration || 2) / 2) || 0.5;
  }, { once: true });
  v.addEventListener('seeked', () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#000';
    g2.fillRect(0, 0, 320, 180);
    drawFramed(g2, v, 320, 180, 'fill', null, orientAt(clipOf(id), v.currentTime * 1000)?.rect || null);
    thumbs.set(id, c.toDataURL('image/jpeg', 0.7));
    v.removeAttribute('src');
    v.load();
    if (mode === 'edit') renderMulti();
  }, { once: true });
}

// An angle is a phone. Angles are numbered in the order phones first appeared,
// and the numbers mean the same thing live and in the edit.
export let angleCids = JSON.parse(localStorage.getItem('vm_angles_' + eventId) || '[]');
export function noteAngle(cid) {
  if (!cid || angleCids.includes(cid)) return;
  angleCids.push(cid);
  localStorage.setItem('vm_angles_' + eventId, JSON.stringify(angleCids));
}
export const videoClips = () => clips.filter((c) => c.kind !== 'audio').sort((a, b) => a.t0 - b.t0);
export const audioClips = () => clips.filter((c) => c.kind === 'audio');
export const clipOf = (id) => clips.find((c) => c.id === id);
export const angleOfCid = (cid) => angleCids.indexOf(cid) + 1;
export const angleNo = (id) => angleOfCid(clipOf(id)?.cid);
const color = (id) => COLORS[(angleNo(id) - 1) % COLORS.length] || '#888';
/** The clip from angle n that's rolling at timeline time t (or null). */
export function clipForAngle(n, t) {
  const cid = angleCids[n - 1];
  if (!cid || seq.origin == null) return null;
  const abs = t + seq.origin;
  return videoClips().find((c) => {
    const r = media.range(c);
    return c.cid === cid && abs >= c.t0 + r.in && abs < c.t0 + r.out;
  }) || null;
}
export const editAngles = () => angleCids.filter((cid) => videoClips().some((c) => c.cid === cid));

/** Where the picture sits in a phone's square frame at a moment of the clip, from its orientation log. */
export function orientAt(clip, ms) {
  const log = clip?.orient;
  if (!log?.length) return null;
  let e = log[0];
  for (const x of log) {
    if (x.t * 1000 <= ms) e = x;
    else break;
  }
  return e;
}
export function viewOf(item, ms) {
  const c = clipOf(item.src), e = orientAt(c, ms);
  // Square recordings (before 0.12): where the shot sits in the square. Native recordings:
  // how to turn the camera's picture upright, plus any digital zoom or exposure the phone used.
  // A screen's recording is shown whole, as it was live (unless this item says otherwise).
  const fit = c?.screen ? 'fit' : undefined;
  return e ? { rect: e.rect || null, rot: e.rot || 0, ev: e.ev || 0, ct: e.ct || 0, fit } : fit ? { rect: null, rot: 0, fit } : null;
}
/** The shape a clip item shows, after any manual rotation. */
export function shapeOf(item) {
  const e = orientAt(clipOf(item.src), (item.in || 0) + 1);
  if (!e) return null;
  const turned = (item.rot || 0) % 180 !== 0;
  return turned ? (e.upright === 'landscape' ? 'portrait' : 'landscape') : e.upright;
}

/** Is this layer smaller than the frame (picture-in-picture, scaled down, or cropped)? */
export function isInset(it) {
  if (it.rect) return true;
  if (!it.tf) return false;
  const t = tfOf(it);
  return t.s < 0.999 || t.crop.l > 0 || t.crop.r > 0 || t.crop.t > 0 || t.crop.b > 0;
}

export function labelOf(it) {
  if (it.type === 'title') return { text: `${it.style === 'card' ? 'Card' : 'Title'}: ${it.text || ''}`, color: '#e6e9f2' };
  if (it.type === 'slate') return { text: `Break${it.fromLive ? ' (live)' : ' slate'}: ${it.text || ''}`, color: '#f0a82b' };
  if (it.type === 'image') return { text: `Image: ${reel.find((r) => r.id === it.asset)?.name || ''}`, color: '#b9bfd6' };
  const c = clipOf(it.src);
  if (!c) return { text: 'Missing clip', color: '#888' };
  if (c.kind === 'audio') return { text: `Mic · ${c.name}`, color: '#6fd39a' };
  const shape = shapeOf(it);
  const inset = isInset(it);
  return { text: `${angleNo(c.id) ? angleNo(c.id) + ' ' : ''}${c.name}${inset ? ' · PiP' : ''}${it.speed && it.speed !== 1 ? ` · ${Math.round(it.speed * 100)}%` : ''}`, color: color(c.id), shape, pip: inset, mismatch: !!shape && !inset && shape !== orientation && it.fit !== 'fit' };
}

export async function saveClipFields(id, fields) {
  const c = clipOf(id);
  Object.assign(c, fields);
  await idb.patch('clips', eventId, id, fields);
}

// ------------------------------------------------------ cut log + sequence ----
// Live cuts are logged on the shared clock as {t, cid} (the phone's full clip
// may not exist yet) and resolved to real clips as they arrive. While the
// sequence is in "auto", the Program track is rebuilt from that log.

export function loadCut() {
  try {
    const c = JSON.parse(localStorage.getItem('vm_cut_' + eventId));
    return c && Array.isArray(c.edl) ? c : { edl: [] };
  } catch {
    return { edl: [] };
  }
}
export function saveCut() {
  localStorage.setItem('vm_cut_' + eventId, JSON.stringify(cut));
  if (!EDIT_ONLY) editCh?.postMessage({ t: 'cut' }); // (the Edit page, if one's open, follows)
}
export function loadSeq() {
  try {
    const s = JSON.parse(localStorage.getItem('vm_seq_' + eventId));
    if (s?.v === 2) return s;
  } catch {}
  return S.newSequence();
}
export function saveSeq() {
  if (editElsewhere()) return; // (the Edit page owns the timeline while it's open)
  localStorage.setItem('vm_seq_' + eventId, JSON.stringify(seq));
}
// ---- the live studio and the Edit page, on this computer (the channel is made at the top)
// The timeline belongs to the Edit page, always: the studio records (the recordings, the live
// cut) and tells the Edit page, which builds the timeline from them, when it opens and as things
// arrive. The studio never builds or saves it.
function editElsewhere() {
  return !EDIT_ONLY;
}
function seqFromEditPage() {}

function resolvedEdl() {
  const vids = videoClips();
  return cut.edl
    .map((e) => {
      if (e.slate) return { t: e.t, slate: e.slate }; // (a break: the slate, in Edit)
      if (e.black) return { t: e.t, black: true, fade: e.fade || 0 }; // (black: nothing, the shot before fading out)
      if (e.clip && vids.some((c) => c.id === e.clip)) return { t: e.t, clip: e.clip, ...(e.dissolve ? { dissolve: e.dissolve } : {}), ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}) };
      if (!e.cid) return null;
      // a cut up to 5 s before that phone's recording started still belongs to it
      // Of the clips rolling at the moment of the cut, the newest (a phone that rolled to a
      // new clip wins the overlap). If none was rolling yet, the first to start. (Taking the
      // newest of everything within 5 s skipped a first clip when the phone rolled quickly.)
      const near = vids.filter((k) => k.cid === e.cid && e.t >= k.t0 - 5000 && e.t < k.t0 + k.dur);
      const rolling = near.filter((k) => e.t >= k.t0).sort((a, b) => b.t0 - a.t0);
      const c = rolling[0] || near.sort((a, b) => a.t0 - b.t0)[0];
      // (none: its recording isn't here, yet or at all: the program as aired fills it, see rebuildFromCuts)
      return c ? { t: Math.max(e.t, c.t0), clip: c.id, ...(e.dissolve ? { dissolve: e.dissolve } : {}), ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}) } : { t: e.t, cid: e.cid, missing: true, ...(e.dissolve ? { dissolve: e.dissolve } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

/** A recording as the edit sees it: only its usable (trimmed) range. */
function usable(c) {
  const r = media.range(c);
  return r.in === 0 && r.out === c.dur ? c : { ...c, t0: c.t0 + r.in, dur: r.out - r.in, inBase: r.in };
}
/** The program as aired (Record program's recordings), to fill a cut whose camera has no footage. */
const asAired = () => clips.filter((c) => c.program && c.kind !== 'audio').map(usable);
export function rebuild(announceIt = true) {
  if (!EDIT_ONLY) return; // (the Edit page builds the timeline)
  S.rebuildFromCuts(seq, resolvedEdl().filter((c) => !isBlocked(c.cid)), clips.filter((c) => !isBlocked(c.cid) && !c.program).map(usable), asAired());
  saveSeq();
  if (announceIt) announce('Program rebuilt from your cuts');
}

// Undo: snapshots of the sequence and the cut log.
export const undoStack = [];
const redoStack = [];
export function snapshot() {
  undoStack.push(JSON.stringify({ seq, cut }));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function restore(stateJson) {
  const st = JSON.parse(stateJson);
  setSeq(st.seq);
  setCut(st.cut);
  saveCut();
  commit(false);
}
export function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  redoStack.push(JSON.stringify({ seq, cut }));
  restore(undoStack.pop());
  announce('Undone');
}
export function redo() {
  if (!redoStack.length) return toast('Nothing to redo');
  undoStack.push(JSON.stringify({ seq, cut }));
  restore(redoStack.pop());
  announce('Redone');
}
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;

/** After any edit: save, refresh the player, redraw. */
export function commit() {
  saveSeq();
  player.setSequence(seq);
  renderTimeline();
  renderInspector();
  renderCredits();
  renderMixer();
  if (leftTab === 'media') renderMedia();
}

// ------------------------------------------------------------------- modes ----

let fittedOnce = false, lastFitEnd = 0;
export function setMode(m) {
  if (EDIT_ONLY && m !== 'edit') return; // (the Edit page only edits)
  if (!EDIT_ONLY && m === 'edit') return void openEditWindow(); // (and the studio never does: Edit is its own window)
  if (m === 'edit') seqFromEditPage();
  setModeValue(m);
  document.body.dataset.mode = m;
  $('#liveTab').setAttribute('aria-selected', String(m === 'live'));
  $('#editTab').setAttribute('aria-selected', String(m === 'edit'));
  player.enabled = m === 'edit';
  if (m === 'live') player.pause();
  else flushRecordings('Edit');
  renderAll();
  setLeftTab(leftTab);
  setMonTab(m === 'edit' ? monTab : 'program');
  applyLayout();
  if (m === 'edit' && S.end(seq) > 0 && (!fittedOnce || S.end(seq) > lastFitEnd + 1000)) {
    fittedOnce = true;
    lastFitEnd = S.end(seq);
    timeline.zoomToFit(); // (new footage since you were last here: show all of it)
  }
  announce(m === 'live' ? 'Live mode' : 'Edit mode');
}
$('#liveTab').onclick = () => setMode('live');
$('#editTab').onclick = () => openEditWindow();
// Edit in its own window, beside the live studio: it rebuilds as recordings land
/** Edit is its own window, in its own browser process (opened without a link back, so a heavy
 *  export there can't hold up the live show here). Open, it's asked to come forward over the
 *  channel, and gets what's recording so far; otherwise a new one opens. */
function openEditWindow() {
  if (EDIT_ONLY) return;
  localStorage.setItem('vm_edit_last', eventId);
  if (Date.now() - editPageAt < 5000) {
    editCh?.postMessage({ t: 'focus' });
    flushRecordings('Edit window');
    toast('Edit is open in its own window');
    return;
  }
  window.open(`/edit?e=${eventId}`, '_blank', 'noopener');
  // (opened without a link back, so a blocked pop-up can't be seen directly: if no Edit window says hello, say how)
  const asked = Date.now();
  setTimeout(() => editPageAt < asked && toast('If Edit didn\u2019t open, allow pop-ups for this site', 6000), 6000);
}

function renderAll() {
  syncSoundAsAired();
  if (mode === 'live') renderLive();
  else renderMulti();
  renderMixer();
  renderTimeline();
  renderInspector();
  renderCredits();
}

// ---- Edit: the program's sound under the whole edit, or each shot's own (see applySoundAsAired)
// (shown once there's a Record program recording to take it from)
function syncSoundAsAired() {
  const row = EDIT_ONLY && document.querySelector('#soundAsAiredRow');
  if (!row) return;
  row.hidden = !asAired().length;
  row.querySelector('input').checked = seq.soundAsAired !== false;
}
document.querySelector('#soundAsAired')?.addEventListener('change', (e) => {
  if (!EDIT_ONLY) return;
  snapshot();
  seq.soundAsAired = e.target.checked;
  S.applySoundAsAired(seq, clips.filter((c) => !isBlocked(c.cid) && !c.program && c.kind !== 'audio').map(usable), asAired());
  saveSeq();
  player.setSequence(seq);
  player.refreshMix();
  renderAll();
  announce(e.target.checked ? "The program's sound as aired plays under the whole edit; the shots' own sound is at nothing until you turn it up" : "Each shot plays its own sound; the program's only under shots with none");
});
