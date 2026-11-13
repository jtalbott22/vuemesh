// Studio, part 28 of 29: faces and speakers, live.
// Loads after captions.js: that import comes first, so the parts run in order (see ../studio.js).
//
// With Face tracking on, the studio looks for faces in the cameras' pictures, on this computer
// (faces-worker.js, MediaPipe; nothing is sent anywhere). With that:
//   - Keep faces framed: the camera on air (and in preview) is cropped to frame its subject, the
//     person talking or the group, and the crop moves the way an operator would: still while
//     they're about where they should be, eased when they move, straight there on a cut.
//   - Cut to whoever's talking: the auto director goes to a camera that shows the person talking,
//     a moment after they start; while they go on, it changes to another camera on them, or for
//     a moment a listener, at a pause in the talking, and never on a blink.
//   - Speaker 1, Speaker 2…: people seen talking, kept the same across cameras (faces.js says
//     how, with no face recognition). The host can name them; captions and lower thirds use it.
import './captions.js';
import { FaceTracker, Follow, Search, Speakers, faceScore, fromRegion, mergeHeads, talkScore, within } from '/js/faces.js';
import { announce, esc, toast } from '/js/vm.js';
import { $, EDIT_ONLY, eventId, live, liveActive, note, program } from './core.js';
import { isMic, liveNo } from './live.js';
import { lt, ltUi } from './graphics.js';
import { mix } from './mixer.js';
import { pvw, sw } from './switcher.js';

const KEY = 'vm_faces', SPK_KEY = 'vm_speakers_' + eventId;
const MAX_CAMS = 8;
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* (unreadable: the defaults) */ }
let savedSpk = null;
try { savedSpk = JSON.parse(localStorage.getItem(SPK_KEY) || 'null'); } catch { /* (none) */ }

/** on: face tracking; follow: keep faces framed on air; talk: cut to whoever's talking; names: a lower third the first time a named speaker's on air. */
export var faces = {
  on: !!saved.on, follow: saved.follow !== false, talk: saved.talk !== false, names: !!saved.names,
  worker: null, ready: false, delegate: null, error: null,
  trackers: new Map(), searches: new Map(), regions: new Map(), follows: new Map(), drawn: new Map(), asked: new Map(), inFlight: null, ms: 0,
  speakers: new Speakers(savedSpk), heard: false, quietSince: 0, mic: null, named: new Set(),
};
const save = () => localStorage.setItem(KEY, JSON.stringify({ on: faces.on, follow: faces.follow, talk: faces.talk, names: faces.names }));
const saveSpeakers = () => localStorage.setItem(SPK_KEY, JSON.stringify(faces.speakers));

// ---- which cameras, how often ----
const watchable = (peer) => {
  const l = live.get(peer);
  return l && !l.screen && !isMic(peer) && !l.paused && !l.overflow && l.video?.readyState >= 2 && l.video.videoWidth > 0;
};
const camsNow = () => [...live.keys()].filter(watchable).slice(0, MAX_CAMS);
/** How often a camera's looked at (ms): what's on air or about to be, often; the rest, enough to know who's talking. */
const everyFor = (peer) => (peer === liveActive || peer === pvw || peer === sw.to ? 100 : 250) * (faces.ms > 30 ? 2 : 1);

async function sendNext() {
  if (!faces.ready || faces.inFlight) return;
  const t = performance.now();
  let pick = null, late = 0;
  for (const peer of camsNow()) {
    const over = t - (faces.asked.get(peer) || 0) - everyFor(peer);
    if (over > late) [pick, late] = [peer, over];
  }
  if (!pick) return;
  const l = live.get(pick), v = l.video;
  // (where in the shot: all of it, or a part, to find a face that's small in a wide shot: see Search)
  let se = faces.searches.get(pick);
  if (!se) faces.searches.set(pick, (se = new Search()));
  const region = se.next(t);
  const r = within(l.view?.rect, region);
  const sx = r.x * v.videoWidth, sy = r.y * v.videoHeight;
  const sw0 = r.w * v.videoWidth, sh0 = r.h * v.videoHeight;
  if (sw0 < 16 || sh0 < 16) return;
  const k = Math.min(1, 640 / Math.max(sw0, sh0));
  faces.asked.set(pick, t);
  faces.inFlight = pick;
  faces.regions.set(pick, region);
  try {
    // (the shot only, smaller: faces come back in the shot's own 0..1)
    const bmp = await createImageBitmap(v, sx, sy, sw0, sh0, { resizeWidth: Math.round(sw0 * k), resizeHeight: Math.round(sh0 * k), resizeQuality: 'low' });
    // (poses on the whole shot only: a pose finds a person small in it; a part is for a face)
    faces.worker?.postMessage({ frame: bmp, cam: pick, t, pose: region.w === 1 }, [bmp]);
    if (!faces.worker) bmp.close();
  } catch {
    faces.inFlight = null;
  }
}

function onResult(m) {
  if (m.ready) {
    faces.ready = true;
    faces.delegate = m.delegate;
    faces.pose = !!m.pose;
    renderFaces();
    note(`Face tracking on (on this computer, ${m.delegate === 'GPU' ? 'the graphics card' : 'the processor'}${m.pose ? ', with people\u2019s poses' : ', faces only'})`);
    return;
  }
  if (m.error && m.cam == null) {
    faces.error = m.error;
    stopWorker();
    faces.on = false;
    save();
    renderFaces();
    note(`Face tracking couldn't start: ${m.error}`);
    toast('Face tracking couldn’t start on this computer', 8000);
    return;
  }
  faces.inFlight = null;
  if (!m.faces || !live.has(m.cam)) return;
  faces.ms = faces.ms * 0.9 + (m.ms || 0) * 0.1;
  let tr = faces.trackers.get(m.cam);
  if (!tr) faces.trackers.set(m.cam, (tr = new FaceTracker()));
  const region = faces.regions.get(m.cam) || { x: 0, y: 0, w: 1, h: 1 };
  const found = fromRegion(mergeHeads(m.faces, m.heads), region);
  tr.update(m.t, found, region.w < 1 ? region : null);
  faces.searches.get(m.cam)?.found(m.t, found, region);
}

function startWorker() {
  if (faces.worker) return;
  faces.error = null;
  faces.worker = new Worker('/js/faces-worker.js');
  faces.worker.onmessage = (e) => onResult(e.data);
  faces.worker.onerror = (e) => onResult({ error: e.message || 'the face finder stopped' });
  faces.worker.postMessage({ init: { base: '/vendor/mediapipe/wasm', model: '/vendor/mediapipe/face_landmarker.task', pose: '/vendor/mediapipe/pose_landmarker_lite.task' } });
}
function stopWorker() {
  faces.worker?.terminate();
  Object.assign(faces, { worker: null, ready: false, inFlight: null });
  faces.trackers.clear();
  faces.searches.clear();
  faces.follows.clear();
}

// ---- is anyone talking? Any camera or microphone above its own room noise ----
const floors = new Map(), buf = new Float32Array(1024);
let heardAt = 0;
function listen(t) {
  let any = false, micBest = null, micV = 0;
  for (const [peer, st] of mix.strips || []) {
    if (!st?.pre) continue;
    const n = Math.min(buf.length, st.pre.fftSize);
    const b = buf.subarray(0, n);
    st.pre.getFloatTimeDomainData(b);
    let ss = 0;
    for (let i = 0; i < n; i++) ss += b[i] * b[i];
    const rms = Math.sqrt(ss / n);
    // the room's own noise: follows quieter moments at once, louder ones only slowly
    const f = floors.get(peer) ?? rms;
    floors.set(peer, rms < f ? rms : f * 1.002 + 1e-6);
    const loud = rms > Math.max(0.004, f * 2.5);
    if (loud) any = true;
    if (loud && isMic(peer) && rms > micV) [micBest, micV] = [live.get(peer)?.cid || peer, rms];
  }
  if (any) heardAt = t;
  faces.heard = t - heardAt < 300; // (between words is still talking)
  if (faces.heard) faces.quietSince = 0;
  else faces.quietSince ||= t;
  faces.mic = micBest;
}

// ---- every quarter second: who's talking, who's who ----
let lastObs = 0, lastSpeaker = null, lastRender = 0;
setInterval(() => {
  if (!faces.on || !faces.ready) return;
  const t = performance.now();
  listen(t);
  for (const peer of faces.trackers.keys()) if (!live.has(peer)) { faces.trackers.delete(peer); faces.searches.delete(peer); }
  const cams = [];
  for (const [peer, tr] of faces.trackers) {
    const l = live.get(peer);
    const tracks = tr.visible(t);
    for (const x of tracks) x.talk = talkScore(x, t);
    cams.push({ cam: peer, place: l.cid || peer, tracks });
  }
  const before = faces.speakers.people.length;
  faces.speakers.observe(t, lastObs ? t - lastObs : 250, cams, faces.heard, faces.mic);
  lastObs = t;
  const cur = faces.speakers.current;
  if (cur !== lastSpeaker) {
    lastSpeaker = cur;
    if (cur != null) note(`Talking: ${faces.speakers.label(cur)}`);
  }
  if (faces.speakers.people.length !== before) saveSpeakers();
  else if (t - lastRender > 5000) saveSpeakers(); // (where each was last seen)
  if (faces.names) nameOnAir();
  if (t - lastRender > 500) {
    lastRender = t;
    renderSpeakers();
    renderTileTags();
  }
}, 250);
setInterval(() => faces.on && sendNext(), 30);

/** The first time a named speaker is on air, talking: their name on a lower third (not over one already up). */
function nameOnAir() {
  const n = faces.speakers.current, p = n != null && faces.speakers.get(n);
  if (!p?.name || faces.named.has(n) || lt.on) return;
  if (!sees(liveActive)?.speaker) return;
  faces.named.add(n);
  const at = performance.now();
  Object.assign(lt, { on: true, at, off: at + 6000, text: p.name, sub: '' });
  ltUi(true);
  note(`Lower third: ${p.name} (first time on air)`);
}

// ---- for the director ----
function sees(peer) {
  const tr = faces.trackers.get(peer);
  if (!tr) return null;
  const t = performance.now();
  const vis = tr.visible(t);
  const cur = faces.speakers.current;
  const them = cur != null ? vis.find((x) => faces.speakers.personOf(peer, x.id) === cur) : null;
  const best = vis.reduce((a, x) => Math.max(a, faceScore(x)), 0);
  const blinkFace = them || vis.slice().sort((a, b) => faceScore(b) - faceScore(a))[0];
  // (eyes from a face seen lately; a head from a pose alone isn't taken as blinking)
  return {
    speaker: them ? Math.min(1, 0.3 + faceScore(them)) : 0,
    faces: best,
    size: them ? them.box.h : 0,
    blink: !!blinkFace && !blinkFace.pose && (blinkFace.eyesOpen ?? 1) < 0.35,
  };
}
/** What a camera shows, for the auto director (undefined when face tracking isn't cutting). */
export function facesSees(peer) {
  if (!faces?.on || !faces.ready || !faces.talk) return undefined;
  return sees(peer) || { speaker: 0, faces: 0, size: 0, blink: false };
}
/** Who's talking, for the auto director (null when face tracking isn't cutting). */
export function facesCtx() {
  if (!faces?.on || !faces.ready || !faces.talk) return null;
  const s = faces.speakers, n = s.current;
  return { speaker: n, since: s.since ? Date.now() - (performance.now() - s.since) : 0, name: n != null ? s.label(n) : '', pause: !faces.heard && performance.now() - faces.quietSince >= 250 };
}
/** The speaker's name now, for captions ('' when face tracking is off or nobody is). */
export function speakerNow() {
  if (!faces?.on || !faces.ready) return '';
  const n = faces.speakers.current;
  return n != null ? faces.speakers.label(n) : '';
}

// ---- framing: what part of a camera's picture goes on air ----
/**
 * The part of a camera's frame to draw (0..1 of the frame), for the program and the preview:
 * its shot (view.rect), and with Keep faces framed, the crop that frames its subject.
 */
export function shotRect(peer, fit = 'fill') {
  const l = live.get(peer);
  const vr = l?.view?.rect || null;
  if (!faces?.on || !faces.ready || !faces.follow || fit !== 'fill' || !l || l.screen || isMic(peer)) return vr;
  const v = l.video;
  if (!v?.videoWidth) return vr;
  const t = performance.now();
  const sw0 = v.videoWidth * (vr?.w ?? 1), sh0 = v.videoHeight * (vr?.h ?? 1);
  // (in as far as the camera's own resolution allows, and up to 1.4 times past it, as a camera's
  // digital zoom goes: a 720p phone in a 720p show can still frame a face; 2 at most)
  const maxZoom = Math.max(1, Math.min(2, 1.4 * Math.min(sh0 / program.height, sw0 / program.width)));
  let f = faces.follows.get(peer);
  if (!f) faces.follows.set(peer, (f = new Follow()));
  // (not drawn a moment ago: it's just been cut to, or taken to preview; straight to its framing)
  const snap = t - (faces.drawn.get(peer) || 0) > 500;
  faces.drawn.set(peer, t);
  const tr = faces.trackers.get(peer);
  const vis = tr ? tr.visible(t) : [];
  const cur = faces.speakers.current;
  const them = cur != null && vis.find((x) => faces.speakers.personOf(peer, x.id) === cur);
  const subject = pickSubject(them, vis);
  const r = f.update(t, subject, sw0 / sh0, program.width / program.height, maxZoom, snap);
  f.last = { rect: r, maxZoom, subject: subject.length };
  return within(vr, r);
}

/** Who to frame: the person talking; else everyone facing this way (the largest three); else the most prominent person (side-on, say). */
export function pickSubject(them, vis) {
  if (them) return [them];
  const facing = vis.filter((x) => faceScore(x) >= 0.3).sort((a, b) => b.box.h - a.box.h).slice(0, 3);
  if (facing.length) return facing;
  const big = vis.slice().sort((a, b) => b.box.h - a.box.h)[0];
  return big ? [big] : [];
}

// ---- the card ----
function renderFaces() {
  if (!$('#facesOn')) return;
  $('#facesOn').checked = faces.on;
  $('#facesFollow').checked = faces.follow;
  $('#facesTalk').checked = faces.talk;
  $('#facesNames').checked = faces.names;
  $('#facesOpts').hidden = !faces.on;
  $('#facesState').textContent = faces.error ? `Couldn’t start: ${faces.error}`
    : !faces.on ? ''
    : !faces.ready ? 'Starting the face finder…'
    : `Watching ${camsNow().length || 'no'} camera${camsNow().length === 1 ? '' : 's'}, on this computer (${faces.delegate === 'GPU' ? 'graphics card' : 'processor'}${faces.pose ? '; faces, and people by their pose' : '; faces only'}).`;
  renderSpeakers();
}

let spkSig = '';
function renderSpeakers() {
  const box = $('#speakers');
  if (!box) return;
  const s = faces.speakers;
  const camsOf = (n) => [...faces.trackers.entries()].filter(([peer, tr]) => tr.visible(performance.now()).some((x) => s.personOf(peer, x.id) === n)).map(([peer]) => liveNo(peer)).filter(Boolean).sort((a, b) => a - b);
  const rows = s.people.slice().sort((a, b) => a.n - b.n).map((p) => ({ n: p.n, name: p.name, cams: camsOf(p.n), talking: p.n === s.current }));
  const sig = JSON.stringify(rows);
  if (sig === spkSig) return;
  spkSig = sig;
  // (don't redraw over a name being typed: only what's beside it)
  const typing = box.contains(document.activeElement) && document.activeElement.matches('input');
  if (typing) {
    for (const r of rows) {
      const el = box.querySelector(`[data-spk="${r.n}"] .spkw`);
      if (el) el.textContent = where(r);
    }
    return;
  }
  box.innerHTML = rows.length ? rows.map((r) => `<div class="spk${r.talking ? ' on' : ''}" data-spk="${r.n}">
      <label for="spk${r.n}" class="spkn">Speaker ${r.n}</label>
      <input type="text" id="spk${r.n}" maxlength="40" placeholder="Name (optional)" value="${esc(r.name)}" autocomplete="off">
      <span class="spkw fine">${esc(where(r))}</span>
    </div>`).join('') : '<p class="fine" style="margin:0">Nobody yet: people are numbered as they’re seen talking.</p>';
}
const where = (r) => `${r.talking ? 'Talking · ' : ''}${r.cams.length ? `on ${r.cams.map((n) => 'CAM ' + n).join(', ')}` : 'not in a shot'}`;

let tagSig = '';
function renderTileTags() {
  const t = performance.now(), s = faces.speakers;
  const tags = new Map();
  for (const [peer, tr] of faces.trackers) {
    const ns = [...new Set(tr.visible(t).map((x) => s.personOf(peer, x.id)).filter((n) => n != null))].sort((a, b) => a - b);
    if (ns.length) tags.set(peer, ns.map((n) => (n === s.current ? '● ' : '') + s.label(n)).join(' · '));
  }
  const sig = JSON.stringify([...tags]);
  if (sig === tagSig) return;
  tagSig = sig;
  for (const [peer, l] of live) {
    if (!l.tile) continue;
    let el = l.tile.querySelector('.spktag');
    const text = faces.on ? tags.get(peer) || '' : '';
    if (!text) { el?.remove(); continue; }
    if (!el) l.tile.insertAdjacentHTML('beforeend', '<span class="spktag" aria-hidden="true"></span>');
    el = l.tile.querySelector('.spktag');
    el.textContent = text;
  }
}

function setFaces(on) {
  faces.on = on;
  save();
  if (on) {
    startWorker();
    announce('Face tracking on');
  } else {
    stopWorker();
    note('Face tracking off');
    announce('Face tracking off');
    tagSig = '';
    renderTileTags();
  }
  renderFaces();
}

window.vmFaces = () => ({ on: faces.on, ready: faces.ready, delegate: faces.delegate, error: faces.error, ms: Math.round(faces.ms), heard: faces.heard, speaker: faces.speakers.current, people: faces.speakers.toJSON().people.map((p) => ({ n: p.n, name: p.name })), cams: [...faces.trackers].map(([peer, tr]) => ({ peer, faces: tr.visible(performance.now()).length, framing: faces.follows.get(peer)?.last || null })) }); // (tests and diagnostics)

if (!EDIT_ONLY && $('#facesOn')) {
  $('#facesOn').addEventListener('change', (e) => setFaces(e.target.checked));
  for (const [id, k, words] of [['#facesFollow', 'follow', 'Keep faces framed'], ['#facesTalk', 'talk', 'Cut to whoever’s talking'], ['#facesNames', 'names', 'Name speakers on air']]) {
    $(id).addEventListener('change', (e) => {
      faces[k] = e.target.checked;
      save();
      note(`${words} ${faces[k] ? 'on' : 'off'}`);
    });
  }
  $('#speakers').addEventListener('change', (e) => {
    const row = e.target.closest('[data-spk]');
    if (!row || !e.target.matches('input')) return;
    const n = +row.dataset.spk;
    faces.speakers.rename(n, e.target.value);
    faces.named.delete(n);
    saveSpeakers();
    note(`Speaker ${n} named ${faces.speakers.get(n)?.name || '(no name)'}`);
    spkSig = '';
  });
  $('#speakersClear').addEventListener('click', () => {
    faces.speakers.clear();
    faces.named.clear();
    saveSpeakers();
    spkSig = tagSig = '';
    renderSpeakers();
    renderTileTags();
    note('Speakers forgotten: numbering starts again');
  });
  setInterval(() => faces.on && renderFaces(), 3000);
  if (faces.on) setFaces(true);
  else renderFaces();
}
