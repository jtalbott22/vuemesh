// Studio, part 20 of 25: the media manager, Source monitor, media inspector.
// Loads after editops.js: that import comes first, so the parts run in order (see ../studio.js).
import './editops.js';
import { toast, esc, fmtDur, announce } from '/js/vm.js';
import { drawFramed } from '/js/compose.js';
import { channelFixer } from '/js/audiofx.js';
import * as S from '/js/sequence.js';
import * as idb from '/js/idb.js';
import { QUICK_TAGS } from '/js/media.js';
import {
  $, EDIT_ONLY, FRAME, blobs, clips, cut, editCh, ev, eventId, fitMonitors, mode, note, player,
  program, rawBlobs, selectedItem, seq, thumbs,
} from './core.js';
import {
  angleNo, clipOf, commit, orientAt, rebuild, saveCut, snapshot, undoStack, videoClips,
} from './clips.js';
import { stereoMeters } from './mixer.js';
import { clipsOfMoment, deleteMoment, media, renameMoment } from './room.js';
import { renderMulti } from './edit.js';
import { timeOfAbs } from './transport.js';
import { syncLabel, syncState } from './sync.js';
import { download, runRender } from './export.js';

// ------------------------------------------------------------ media manager ----
// Every recording, subclip and marked moment: search, filter, tag, star, trim,
// delete, and a Source monitor to mark In/Out, make subclips, and insert or
// overwrite onto the timeline (Premiere's , and . keys).

export let leftTab = 'angles';
export let monTab = 'program';
export let mediaSel = null;           // {kind: 'clip'|'subclip'|'moment', id}
export function setMediaSel(v) { return (mediaSel = v); }
export let mediaFilter = 'all';
export function setMediaFilter(v) { return (mediaFilter = v); }
let mediaQuery = '';

export function setLeftTab(t) {
  leftTab = t;
  $('#anglesTab').setAttribute('aria-selected', String(t === 'angles'));
  $('#mediaTab').setAttribute('aria-selected', String(t === 'media'));
  $('#multi').hidden = t === 'media' && mode === 'edit';
  $('#mediaPanel').hidden = !(t === 'media' && mode === 'edit');
  $('#srcHead').textContent = mode === 'edit' && t === 'media' ? 'Media' : 'Sources';
  if (t === 'media') renderMedia();
  renderMediaInsp();
}
$('#anglesTab').onclick = () => setLeftTab('angles');
$('#mediaTab').onclick = () => setLeftTab('media');

export function setMonTab(t) {
  monTab = t;
  $('#progTab').setAttribute('aria-selected', String(t === 'program'));
  $('#srcTab').setAttribute('aria-selected', String(t === 'source'));
  $('#progFrame').hidden = t === 'source';
  $('#srcFrame').hidden = t !== 'source';
  $('#srcBar').hidden = t !== 'source' || mode !== 'edit';
  if (t === 'source') player.pause();
  else srcMon.v.pause();
}
$('#progTab').onclick = () => setMonTab('program');
$('#srcTab').onclick = () => setMonTab('source');

const fmtMB = (b) => (b >= 1e9 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 10 * 1048576 ? Math.round(b / 1048576) + ' MB' : (b / 1048576).toFixed(1) + ' MB');
export const clipTitle = (c) => (c.kind === 'audio' ? `Mic · ${c.name}` : `${angleNo(c.id) || '?'} ${c.name}`);
export const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function mediaItems() {
  const items = [];
  for (const c of clips.slice().sort((a, b) => a.t0 - b.t0)) {
    const m = media.meta(c.id);
    const shapes = [...new Set((c.orient || []).map((o) => o.upright))];
    items.push({ kind: 'clip', id: c.id, title: clipTitle(c), sub: `${fmtClock(c.t0)} · ${fmtDur(c.dur).slice(0, -3)}${shapes.length ? ' · ' + shapes.join('/') : ''}${m.trim ? ' · trimmed' : ''}${syncState(c) === 'clock' ? ' · not synced' : ''}`, tags: m.tags, star: m.star, thumb: thumbs.get(c.id), audio: c.kind === 'audio', search: `${c.name} ${m.tags.join(' ')} ${m.notes}` });
  }
  for (const sc of media.subclips) {
    const c = clipOf(sc.src);
    if (!c) continue;
    items.push({ kind: 'subclip', id: sc.id, title: sc.name, sub: `${clipTitle(c)} · ${fmtDur(sc.out - sc.in).slice(0, -3)}`, tags: sc.tags, star: sc.star, thumb: thumbs.get(c.id), audio: c.kind === 'audio', search: `${sc.name} ${c.name} ${sc.tags.join(' ')}` });
  }
  for (const mo of media.moments) {
    const rolling = videoClips().filter((c) => mo.t >= c.t0 && mo.t < c.t0 + c.dur).length;
    items.push({ kind: 'moment', id: mo.id, title: mo.label, sub: `${fmtClock(mo.t)} · ${rolling} angle${rolling === 1 ? '' : 's'} rolling`, tags: mo.tags || [], search: `${mo.label} ${(mo.tags || []).join(' ')}` });
  }
  return items;
}

export function renderMedia() {
  if (mode !== 'edit' || leftTab !== 'media') return;
  const tags = media.allTags();
  const filters = [['all', 'All'], ['video', 'Video'], ['audio', 'Audio'], ['subclip', 'Subclips'], ['moment', 'Moments'], ['star', '★']]
    .concat(tags.slice(0, 12).map((t) => ['tag:' + t.tag, `#${t.tag}`]));
  $('#mediaFilters').innerHTML = filters.map(([k, l]) => `<button type="button" data-filter="${esc(k)}" aria-pressed="${mediaFilter === k}">${esc(l)}</button>`).join('');
  const q = mediaQuery.toLowerCase();
  const list = mediaItems().filter((it) => {
    if (q && !`${it.title} ${it.search}`.toLowerCase().includes(q)) return false;
    if (mediaFilter === 'video') return it.kind === 'clip' && !it.audio;
    if (mediaFilter === 'audio') return it.audio && it.kind !== 'moment';
    if (mediaFilter === 'subclip') return it.kind === 'subclip';
    if (mediaFilter === 'moment') return it.kind === 'moment';
    if (mediaFilter === 'star') return it.star;
    if (mediaFilter.startsWith('tag:')) return (it.tags || []).includes(mediaFilter.slice(4));
    return true;
  });
  $('#mediaEmpty').hidden = !!list.length;
  $('#mediaEmpty').textContent = clips.length ? 'Nothing matches.' : 'Recordings appear here as they arrive. Press M during the event to mark moments.';
  $('#mediaList').hidden = !list.length;
  $('#mediaList').innerHTML = list.length
    ? list.map((it) => {
        const sel = mediaSel && mediaSel.kind === it.kind && mediaSel.id === it.id;
        const th = it.kind === 'moment' ? '<span class="th mom">★</span>' : it.audio ? `<span class="th aud${it.kind === 'subclip' ? ' sub' : ''}">MIC</span>` : `<span class="th${it.kind === 'subclip' ? ' sub' : ''}" style="${it.thumb ? `background-image:url(${it.thumb})` : ''}"></span>`;
        return `<li role="option" tabindex="0" aria-selected="${sel}" data-kind="${it.kind}" data-id="${esc(it.id)}">
          ${th}<span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small>${it.tags?.length ? `<span class="tg">${it.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}</span>
          ${it.kind === 'moment' ? '<span></span>' : `<button type="button" class="star" data-star aria-pressed="${!!it.star}" aria-label="${it.star ? 'Unstar' : 'Star'} ${esc(it.title)}">★</button>`}
        </li>`;
      }).join('')
    : '';
}

$('#mediaSearch').oninput = (e) => {
  mediaQuery = e.target.value;
  renderMedia();
};
$('#mediaFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  mediaFilter = b.dataset.filter;
  renderMedia();
});
$('#mediaList').addEventListener('click', (e) => {
  const li = e.target.closest('[data-kind]');
  if (!li) return;
  const { kind, id } = li.dataset;
  if (e.target.closest('[data-star]')) {
    if (kind === 'clip') media.setMeta(id, { star: !media.meta(id).star });
    else media.updateSubclip(id, { star: !media.subclips.find((x) => x.id === id).star });
    return renderMedia();
  }
  selectMedia(kind, id);
});
$('#mediaList').addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-kind]');
  if (!li) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectMedia(li.dataset.kind, li.dataset.id);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus();
  }
});

export function selectMedia(kind, id) {
  mediaSel = { kind, id };
  renderMedia();
  renderMediaInsp();
  if (kind === 'clip') loadSource(id, null);
  else if (kind === 'subclip') {
    const sc = media.subclips.find((x) => x.id === id);
    loadSource(sc.src, { in: sc.in, out: sc.out });
  } else {
    const mo = media.moments.find((x) => x.id === id);
    { const at = timeOfAbs(mo.t); if (at) player.seek(at.t); }
    setMonTab('program');
  }
}

// ---- source monitor ----
export const srcMon = { v: document.createElement('video'), clip: null, in: 0, out: 0 };
srcMon.v.playsInline = true;
srcMon.v.preload = 'auto';
Object.assign(srcMon.v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
document.body.append(srcMon.v);

export function loadSource(clipId, range) {
  const c = clipOf(clipId);
  if (!c) return;
  srcMon.clip = c;
  srcAudio?.fix?.reset(c.audio === 'stereo');
  const r = range || media.range(c);
  srcMon.in = r.in;
  srcMon.out = r.out;
  srcMon.v.src = blobs.get(c.id);
  srcMon.v.addEventListener('loadedmetadata', () => (srcMon.v.currentTime = srcMon.in / 1000), { once: true });
  $('#srcLabel').textContent = `SOURCE · ${clipTitle(c)}`;
  setMonTab('source');
  renderSrcBar();
}

const srcG = $('#srcCanvas').getContext('2d');
(function drawSource() {
  if (monTab === 'source' && mode === 'edit') {
    const cv = $('#srcCanvas');
    if (cv.width !== program.width || cv.height !== program.height) {
      cv.width = program.width;
      cv.height = program.height;
      fitMonitors();
    }
    srcG.fillStyle = '#000';
    srcG.fillRect(0, 0, cv.width, cv.height);
    const c = srcMon.clip;
    const ms = srcMon.v.currentTime * 1000;
    if (c && c.kind === 'audio') {
      srcG.fillStyle = '#6fd39a';
      srcG.font = '700 42px Archivo, system-ui, sans-serif';
      srcG.textAlign = 'center';
      srcG.fillText(clipTitle(c), cv.width / 2, cv.height / 2);
    } else if (c && srcMon.v.readyState >= 2) {
      drawFramed(srcG, srcMon.v, cv.width, cv.height, 'fit', null, orientAt(c, ms)?.rect || null);
    }
    if (c) {
      if (!srcMon.v.paused && ms >= srcMon.out) srcMon.v.pause();
      $('#srcTc').textContent = fmtDur(ms);
      const pct = (x) => (c.dur ? (x / c.dur) * 100 : 0);
      $('#srcHeadBar').style.left = pct(ms) + '%';
      $('#srcScrub').setAttribute('aria-valuenow', String(Math.round(pct(ms))));
      $('#srcPlay').textContent = srcMon.v.paused ? 'Play' : 'Pause';
    }
  }
  requestAnimationFrame(drawSource);
})();

function renderSrcBar() {
  const c = srcMon.clip;
  if (!c) return;
  const pct = (x) => (x / c.dur) * 100;
  Object.assign($('#srcRangeBar').style, { left: pct(srcMon.in) + '%', width: Math.max(0.3, pct(srcMon.out - srcMon.in)) + '%' });
  $('#srcRange').textContent = `In ${fmtDur(srcMon.in)} · Out ${fmtDur(srcMon.out)} · ${fmtDur(srcMon.out - srcMon.in)}`;
  $('#srcTicks').innerHTML = media.moments.filter((m) => m.t >= c.t0 && m.t < c.t0 + c.dur).map((m) => `<i class="tick" style="left:${pct(m.t - c.t0)}%" title="${esc(m.label)}"></i>`).join('');
}

export function srcSeek(ms) {
  const c = srcMon.clip;
  if (!c) return;
  srcMon.v.currentTime = Math.max(0, Math.min(c.dur, ms)) / 1000;
}
$('#srcScrub').addEventListener('pointerdown', (e) => {
  const box = $('#srcScrub').getBoundingClientRect();
  const at = (x) => srcSeek(((x - box.left) / box.width) * (srcMon.clip?.dur || 0));
  at(e.clientX);
  const mv = (m) => at(m.clientX);
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
});
// The Source monitor's sound goes through the audio engine too (still to the speakers), so
// the meters can show it while the Source monitor is up.
export let srcAudio = null;
function routeSource() {
  if (srcAudio) return;
  try {
    const ctx = player.ctx;
    const node = ctx.createMediaElementSource(srcMon.v);
    // a recording that only filled the left side plays (and meters) on both
    const fix = channelFixer(ctx, { stereo: srcMon.clip?.audio === 'stereo' });
    const gain = ctx.createGain();
    node.connect(fix.input);
    fix.output.connect(gain);
    gain.connect(ctx.destination);
    srcAudio = { meters: stereoMeters(ctx, gain), fix };
  } catch (e) {
    console.warn('Source monitor meters unavailable', e);
    srcAudio = { meters: null };
  }
}
export function srcToggle() {
  if (!srcMon.clip) return;
  routeSource();
  player.ctx.resume();
  if (srcMon.v.paused) {
    if (srcMon.v.currentTime * 1000 >= srcMon.out - 30) srcSeek(srcMon.in);
    player.pause();
    srcMon.v.play().catch(() => {});
  } else srcMon.v.pause();
}
export function markIn() {
  if (!srcMon.clip) return;
  srcMon.in = Math.round(srcMon.v.currentTime * 1000);
  if (srcMon.out <= srcMon.in) srcMon.out = srcMon.clip.dur;
  renderSrcBar();
  announce(`In at ${fmtDur(srcMon.in)}`);
}
export function markOut() {
  if (!srcMon.clip) return;
  srcMon.out = Math.round(srcMon.v.currentTime * 1000);
  if (srcMon.out <= srcMon.in) srcMon.in = 0;
  renderSrcBar();
  announce(`Out at ${fmtDur(srcMon.out)}`);
}
$('#srcPlay').onclick = srcToggle;
$('#srcIn').onclick = markIn;
$('#srcOut').onclick = markOut;

function srcItem() {
  const c = srcMon.clip;
  if (!c || srcMon.out - srcMon.in < FRAME) return null;
  return { type: 'clip', src: c.id, in: srcMon.in, dur: srcMon.out - srcMon.in };
}
/** Where source footage lands: the selected item's track if it fits the kind, else the Program (or first audio track). */
function targetTrack(kind) {
  // the track you targeted (◉ on its header) wins; otherwise the selected clip's track, then the defaults
  const tg = seq.target?.[kind] && seq.tracks.find((t) => t.id === seq.target[kind] && !t.locked && !t.follow);
  if (tg) return tg;
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (f && f.track.kind === kind && !f.track.follow && !f.track.locked) return f.track;
  if (kind === 'video') return S.program(seq);
  return seq.tracks.find((t) => t.kind === 'audio' && !t.follow && !t.locked) || S.addTrack(seq, 'audio');
}
export function placeSource(how) {
  const item = srcItem();
  if (!item) return toast('Mark an In and Out on a clip first');
  snapshot();
  const tr = targetTrack(srcMon.clip.kind === 'audio' ? 'audio' : 'video');
  if (tr.program) seq.auto = false;
  const t = player.t;
  const placed = how === 'insert' ? S.insertAt(seq, tr.id, t, item) : S.overwrite(seq, tr.id, t, item);
  if (!placed) return toast('That track is locked');
  commit();
  player.seek(t + item.dur); // like Premiere: the playhead moves past what you added
  note(`${how === 'insert' ? 'Inserted' : 'Overwrote'} ${fmtDur(item.dur).slice(0, -3)} of ${clipTitle(srcMon.clip)} on ${tr.name}`);
  announce(`${how === 'insert' ? 'Inserted' : 'Overwrote'} on ${tr.name}`);
}
$('#srcInsert').onclick = () => placeSource('insert');
$('#srcOverwrite').onclick = () => placeSource('overwrite');

function makeSubclip() {
  const item = srcItem();
  if (!item) return toast('Mark an In and Out first');
  const name = prompt('Name this clip', `${srcMon.clip.name} · ${fmtDur(srcMon.in).slice(0, -3)}`);
  if (name === null) return;
  const sc = media.addSubclip({ src: srcMon.clip.id, in: srcMon.in, out: srcMon.out, name: name || 'Subclip' });
  setLeftTab('media');
  mediaSel = { kind: 'subclip', id: sc.id };
  renderMedia();
  renderMediaInsp();
  announce(`Subclip ${sc.name} made`);
}
$('#srcSubclip').onclick = makeSubclip;

/** Render just this range as its own film (for sharing a moment). */
function exportRange(clipId, a, b, name) {
  const c = clipOf(clipId);
  const one = {
    v: 2, origin: 0, auto: false,
    tracks: c.kind === 'audio'
      ? [{ id: 'v', kind: 'video', items: [] }, { id: 'a', kind: 'audio', items: [{ id: 'x', type: 'clip', src: c.id, start: 0, dur: b - a, in: a }], gain: 1, mono: true }]
      : [{ id: 'p', kind: 'video', program: true, items: [{ id: 'x', type: 'clip', src: c.id, start: 0, dur: b - a, in: a }] }, { id: 'a', kind: 'audio', follow: 'p', items: [], gain: 1, mono: true }],
  };
  return runRender({ s: one, name, wrapUp: false });
}
$('#srcExport').onclick = () => {
  if (!srcItem()) return toast('Mark an In and Out first');
  exportRange(srcMon.clip.id, srcMon.in, srcMon.out, `${ev.title}-${srcMon.clip.name}-${fmtDur(srcMon.in).slice(0, -3).replace(/:/g, '')}`);
};

// ---- media inspector ----
function tagEditor(tags, onChange) {
  const wrap = document.createElement('div');
  const draw = () => {
    wrap.innerHTML = `<label>Tags</label><div class="tagedit">${tags.map((t, i) => `<span>${esc(t)}<button type="button" data-rm="${i}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}</div>
      <input type="text" placeholder="Add a tag and press Enter" aria-label="Add a tag">
      <div class="quicktags">${QUICK_TAGS.filter((q) => !tags.includes(q)).map((q) => `<button type="button" data-q="${esc(q)}">+ ${esc(q)}</button>`).join('')}</div>`;
    wrap.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { tags.splice(+b.dataset.rm, 1); onChange(tags); draw(); }));
    wrap.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { tags.push(b.dataset.q); onChange(tags); draw(); }));
    const input = wrap.querySelector('input');
    input.onkeydown = (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      const t = input.value.trim().slice(0, 30);
      if (!tags.includes(t)) tags.push(t);
      onChange(tags);
      draw();
      wrap.querySelector('input').focus();
    };
  };
  draw();
  return wrap;
}

export function renderMediaInsp() {
  const box = $('#mediaInsp');
  const show = mode === 'edit' && mediaSel && (leftTab === 'media' || monTab === 'source');
  box.hidden = !show;
  if (!show) return;
  const changed = () => { renderMedia(); };
  if (mediaSel.kind === 'clip') {
    const c = clipOf(mediaSel.id);
    if (!c) return (box.hidden = true);
    const m = media.meta(c.id);
    const r = media.range(c);
    const shapes = (c.orient || []).map((o) => o.upright);
    const turns = Math.max(0, shapes.length - 1);
    const qa = c.qa?.length ? Math.round((c.qa.reduce((s, q) => s + (q[1] ?? 0), 0) / c.qa.length) * 100) : null;
    const uses = seq.tracks.reduce((n, tr) => n + tr.items.filter((it) => it.src === c.id).length, 0);
    box.innerHTML = `<h2>Recording</h2><div class="sel"><div class="kv">
      <span>From</span><b>${esc(clipTitle(c))}</b>
      <span>Recorded</span><span>${fmtClock(c.t0)}</span>
      <span>Sync</span><span>${esc(syncLabel(c))}</span>
      <span>Length</span><span class="tc">${fmtDur(c.dur)}</span>
      <span>File</span><span>${fmtMB(rawBlobs.get(c.id)?.size || 0)} · signed by the phone</span>
      ${shapes.length ? `<span>Shape</span><span>${shapes[0]}${turns ? `, turned ${turns}×` : ''}</span>` : ''}
      ${qa != null ? `<span>Shot quality</span><span>${qa}% average</span>` : ''}
      <span>Usable</span><span class="tc">${m.trim ? `${fmtDur(r.in)} – ${fmtDur(r.out)}` : 'all of it'}</span>
      <span>On timeline</span><span>${uses} time${uses === 1 ? '' : 's'}</span>
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <button type="button" id="mTrim" title="Use only the In–Out range of this recording (the file is kept)">Trim to In/Out</button>
      ${m.trim ? '<button type="button" id="mUntrim">Use all of it</button>' : ''}
    </div>
    <div id="mTags"></div>
    <label for="mNotes">Notes</label><textarea id="mNotes" rows="2">${esc(m.notes || '')}</textarea>
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <button type="button" id="mDownload">Download original</button>
      <button type="button" id="mDelete" class="danger">Delete recording</button>
    </div></div>`;
    box.querySelector('#mTags').append(tagEditor([...m.tags], (tags) => { media.setMeta(c.id, { tags }); changed(); }));
    box.querySelector('#mNotes').onchange = (e) => media.setMeta(c.id, { notes: e.target.value });
    box.querySelector('#mTrim').onclick = () => {
      if (srcMon.clip?.id !== c.id) return toast('Open it in the Source monitor and mark In and Out first');
      snapshot();
      media.setMeta(c.id, { trim: { in: srcMon.in, out: srcMon.out } });
      if (seq.auto) rebuild(false);
      commit();
      renderMedia();
      renderMediaInsp();
      announce('Trimmed');
    };
    box.querySelector('#mUntrim')?.addEventListener('click', () => {
      snapshot();
      media.setMeta(c.id, { trim: null });
      if (seq.auto) rebuild(false);
      commit();
      renderMedia();
      renderMediaInsp();
    });
    box.querySelector('#mDownload').onclick = () => download(rawBlobs.get(c.id), `${ev.title}-${c.name}-${c.id}`);
    box.querySelector('#mDelete').onclick = () => deleteRecording(c.id);
  } else if (mediaSel.kind === 'subclip') {
    const sc = media.subclips.find((x) => x.id === mediaSel.id);
    if (!sc) return (box.hidden = true);
    const c = clipOf(sc.src);
    box.innerHTML = `<h2>Subclip</h2><div class="sel">
      <label for="scName">Name</label><input type="text" id="scName" value="${esc(sc.name)}">
      <div class="kv" style="margin-top:8px"><span>From</span><span>${esc(clipTitle(c))}</span><span>Range</span><span class="tc">${fmtDur(sc.in)} – ${fmtDur(sc.out)}</span><span>Length</span><span class="tc">${fmtDur(sc.out - sc.in)}</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" id="scUpdate" title="Set this subclip to the Source monitor's In and Out">Update from In/Out</button></div>
      <div id="scTags"></div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <button type="button" id="scExport">Export clip</button>
        <button type="button" id="scDelete" class="danger">Delete subclip</button>
      </div></div>`;
    box.querySelector('#scName').onchange = (e) => { media.updateSubclip(sc.id, { name: e.target.value || 'Subclip' }); changed(); };
    box.querySelector('#scTags').append(tagEditor([...sc.tags], (tags) => { media.updateSubclip(sc.id, { tags }); changed(); }));
    box.querySelector('#scUpdate').onclick = () => {
      if (srcMon.clip?.id !== sc.src) return toast('Open this subclip first');
      media.updateSubclip(sc.id, { in: srcMon.in, out: srcMon.out });
      renderMedia();
      renderMediaInsp();
    };
    box.querySelector('#scExport').onclick = () => exportRange(sc.src, sc.in, sc.out, `${ev.title}-${sc.name}`);
    box.querySelector('#scDelete').onclick = () => {
      media.removeSubclip(sc.id);
      mediaSel = null;
      renderMedia();
      renderMediaInsp();
      announce('Subclip deleted');
    };
  } else {
    const mo = media.moments.find((x) => x.id === mediaSel.id);
    if (!mo) return (box.hidden = true);
    const rolling = videoClips().filter((c) => mo.t >= c.t0 && mo.t < c.t0 + c.dur);
    box.innerHTML = `<h2>Moment</h2><div class="sel">
      <label for="moName">Name</label><input type="text" id="moName" value="${esc(mo.label)}">
      <div class="kv" style="margin-top:8px"><span>When</span><span>${fmtClock(mo.t)}</span><span>Rolling</span><span>${rolling.map((c) => esc(c.name)).join(', ') || 'no cameras'}</span></div>
      <button type="button" id="moClips" class="primary" style="width:100%" ${rolling.length ? '' : 'disabled'}>Make clips from every angle</button>
      <p class="fine">Ten seconds before to five after, one clip per camera that was rolling, tagged Moment.</p>
      <div id="moTags"></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button type="button" id="moGo">Go to it on the timeline</button>
        <button type="button" id="moDelete" class="danger">Delete moment</button>
      </div></div>`;
    box.querySelector('#moName').onchange = (e) => { if (!renameMoment(mo.id, e.target.value)) e.target.value = mo.label; };
    box.querySelector('#moTags').append(tagEditor([...(mo.tags || [])], (tags) => { media.updateMoment(mo.id, { tags }); changed(); }));
    box.querySelector('#moClips').onclick = () => clipsOfMoment(mo.id);
    box.querySelector('#moGo').onclick = () => {
      const at = timeOfAbs(mo.t);
      if (at) player.seek(at.t);
      setMonTab('program');
    };
    box.querySelector('#moDelete').onclick = () => deleteMoment(mo.id);
  }
}

/** Delete a recording for good: the file, every use on the timeline, its subclips. */
export async function deleteRecording(id, { confirmed = false, elsewhere = false } = {}) {
  const c = clipOf(id);
  if (!c) return;
  const uses = seq.tracks.reduce((n, tr) => n + tr.items.filter((it) => it.src === id).length, 0);
  const subs = media.subclips.filter((x) => x.src === id).length;
  const mb = fmtMB(rawBlobs.get(id)?.size || 0);
  if (!confirmed && !confirm(`Delete ${clipTitle(c)}'s recording (${fmtDur(c.dur).slice(0, -3)}, ${mb})?${uses ? `\n\nIt's used ${uses} time${uses === 1 ? '' : 's'} on the timeline; those pieces will be removed.` : ''}${subs ? `\n${subs} subclip${subs === 1 ? '' : 's'} will go too.` : ''}\n\nThe file is deleted from this computer. This can't be undone.`)) return;
  if (!elsewhere) await idb.remove('clips', eventId, id); // (deleted in the other window: the file's gone already)
  if (!EDIT_ONLY && !elsewhere) editCh?.postMessage({ t: 'deleted', id }); // (the Edit page, if open, drops it too)
  if (srcMon.clip?.id === id) {
    srcMon.v.pause();
    srcMon.v.removeAttribute('src');
    srcMon.clip = null;
  }
  player.forget(id);
  URL.revokeObjectURL(blobs.get(id));
  blobs.delete(id);
  rawBlobs.delete(id);
  thumbs.delete(id);
  clips.splice(clips.findIndex((x) => x.id === id), 1);
  media.forgetSource(id);
  S.removeSource(seq, id);
  cut.edl = cut.edl.filter((e) => e.clip !== id);
  saveCut();
  undoStack.length = 0; // undo can't bring a deleted file back
  if (seq.auto) rebuild(false);
  mediaSel = null;
  commit();
  renderMedia();
  renderMediaInsp();
  renderMulti();
  note(`Deleted ${c.name}'s recording (${mb})`);
  toast(`Deleted ${c.name}'s recording`);
}
