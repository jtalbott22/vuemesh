// Studio, part 17 of 26: right-click menus.
// Loads after edit.js: that import comes first, so the parts run in order (see ../studio.js).
import './edit.js';
import { toast, esc, announce } from '/js/vm.js';
import { tfOf, TF_PRESETS } from '/js/compose.js';
import * as S from '/js/sequence.js';
import { $, FRAME, isHost, live, mode, note, player, seq } from './core.js';
import { angleCids, angleNo, clipForAngle, clipOf, commit, labelOf, saveSeq, snapshot, videoClips } from './clips.js';
import { callBack, camOrder, cutLive, liveNo } from './live.js';
import { freshPlayer, reconnectPhone } from './usage.js';
import { askRemove, canSplit, joinLocalMic, removeLocalSource, renameLocal, renameSource, setLocalManualRec, splitLocalMic } from './sources.js';
import { openCcu } from './ccu.js';
import { media } from './room.js';
import { setPreview } from './switcher.js';
import { DISSOLVES, renderTimeline, select, setDissolve } from './edit.js';
import { rippleDeleteSelected } from './transport.js';
import { addItem, deleteSelected, splitSelected } from './editops.js';
import { clipTitle, loadSource, placeSource, selectMedia, setMonTab, srcMon, srcSeek } from './library.js';

// ---- right-click menus ------------------------------------------------------------------
// Like any editor: right-click a clip on the timeline, a camera tile or a media item for
// what you can do with it. Shift+F10 or the Menu key opens it from the keyboard.
const ctxEl = Object.assign(document.createElement('div'), { className: 'ctxmenu', hidden: true });
ctxEl.setAttribute('role', 'menu');
const ctxSubEl = Object.assign(document.createElement('div'), { className: 'ctxmenu', hidden: true });
ctxSubEl.setAttribute('role', 'menu');
document.body.append(ctxEl, ctxSubEl);
let ctxItems = [], ctxSubItems = [], ctxReturn = null;

function menuHtml(items, title) {
  return (title ? `<div class="ctxtitle">${esc(title)}</div>` : '') + items.map((it, i) => (it.sep ? '<hr>'
    : `<button type="button" role="menuitem" data-i="${i}" tabindex="-1" ${it.disabled ? 'aria-disabled="true"' : ''} ${it.sub ? 'aria-haspopup="menu" aria-expanded="false"' : ''}><span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.sub ? '<b aria-hidden="true">▸</b>' : ''}</button>`)).join('');
}
export function place(el, x, y) {
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
export function openMenu(x, y, items, title) {
  closeMenu();
  ctxReturn = document.activeElement;
  ctxItems = items;
  ctxEl.innerHTML = menuHtml(items, title);
  ctxEl.setAttribute('aria-label', title || 'Menu');
  place(ctxEl, x, y);
  ctxEl.querySelector('button:not([aria-disabled="true"])')?.focus();
}
function openSub(btn) {
  const it = ctxItems[+btn.dataset.i];
  if (!it?.sub) return;
  ctxEl.querySelectorAll('.open').forEach((b) => (b.classList.remove('open'), b.setAttribute('aria-expanded', 'false')));
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  ctxSubItems = it.sub;
  ctxSubEl.innerHTML = menuHtml(it.sub);
  const r = btn.getBoundingClientRect();
  place(ctxSubEl, r.right + 2, r.top - 4);
  if (ctxSubEl.getBoundingClientRect().left < r.right) place(ctxSubEl, r.left - ctxSubEl.offsetWidth - 2, r.top - 4);
}
function closeMenu(restore = false) {
  if (ctxEl.hidden) return;
  ctxEl.hidden = ctxSubEl.hidden = true;
  if (restore) ctxReturn?.focus?.();
}
function runItem(list, btn) {
  const it = list[+btn.dataset.i];
  if (!it || it.disabled) return;
  if (it.sub) return openSub(btn), ctxSubEl.querySelector('button:not([aria-disabled="true"])')?.focus();
  closeMenu();
  it.action?.();
}
ctxEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) runItem(ctxItems, b); });
ctxSubEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) runItem(ctxSubItems, b); });
ctxEl.addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  if (ctxItems[+b.dataset.i]?.sub) openSub(b);
  else if (!ctxSubEl.hidden) (ctxSubEl.hidden = true), ctxEl.querySelectorAll('.open').forEach((x) => x.classList.remove('open'));
});
for (const [el, list, isSub] of [[ctxEl, () => ctxItems, false], [ctxSubEl, () => ctxSubItems, true]]) {
  el.addEventListener('keydown', (e) => {
    const btns = [...el.querySelectorAll('button:not([aria-disabled="true"])')];
    const i = btns.indexOf(document.activeElement);
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement?.dataset.i) runItem(list(), document.activeElement);
    } else if (e.key === 'ArrowRight' && !isSub && document.activeElement?.getAttribute('aria-haspopup')) {
      e.preventDefault();
      runItem(list(), document.activeElement);
    } else if ((e.key === 'ArrowLeft' && isSub) || (e.key === 'Escape' && isSub)) {
      e.preventDefault();
      ctxSubEl.hidden = true;
      ctxEl.querySelector('.open')?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    }
  });
}
document.addEventListener('pointerdown', (e) => { if (!ctxEl.hidden && !e.target.closest('.ctxmenu')) closeMenu(); }, true);
window.addEventListener('blur', () => closeMenu());

/** Swap a clip's media, keeping its place on the timeline (and its transform). */
function replaceMedia(f, c, how) {
  const it = f.item;
  snapshot();
  if (how === 'source') {
    it.src = c.id;
    it.in = srcMon.in;
    it.dur = Math.max(FRAME, Math.min(it.dur, srcMon.out - srcMon.in));
  } else {
    // the same moment from another camera, so it stays in sync
    const abs = it.start + (seq.origin ?? 0);
    it.src = c.id;
    it.in = abs - c.t0 + (c.inBase || 0);
    it.dur = Math.max(FRAME, Math.min(it.dur, c.t0 + c.dur - abs));
  }
  if (f.track.program) seq.auto = false;
  commit();
  select(it.id);
  note(`Replaced the media with ${clipTitle(c)}`);
  announce(`Media replaced with ${clipTitle(c)}`);
}
function setItemSpeed(f, v) {
  snapshot();
  const r = S.setSpeed(seq, f.item.id, v);
  if (f.track.program) seq.auto = false;
  commit();
  const pct = Math.round(v * 100);
  const msg = v === 1 ? 'Back to normal speed' : `Speed ${pct}%${r?.capped ? ', trimmed to fit before the next clip' : ''}. Its sound is off at this speed.`;
  toast(msg, 4000);
  announce(msg);
}
function applyPreset(f, k) {
  snapshot();
  delete f.item.rect;
  f.item.tf = { ...tfOf({}), ...TF_PRESETS[k] };
  if (f.track.program) seq.auto = false;
  commit();
}

function itemMenu(f, x, y) {
  const it = f.item, tr = f.track;
  const items = [];
  if (it.type === 'clip' && tr.kind === 'video') {
    const abs = it.start + (seq.origin ?? 0);
    const alts = videoClips().filter((c) => c.id !== it.src && abs >= c.t0 && abs < c.t0 + c.dur);
    const sub = alts.map((c) => ({ label: `Camera ${angleNo(c.id)} · ${c.name} (same moment)`, action: () => replaceMedia(f, c, 'sync') }));
    if (srcMon.clip && srcMon.clip.kind !== 'audio' && srcMon.clip.id !== it.src) {
      if (sub.length) sub.push({ sep: true });
      sub.push({ label: `Source monitor: ${clipTitle(srcMon.clip)} (from its In)`, action: () => replaceMedia(f, srcMon.clip, 'source') });
    }
    if (!sub.length) sub.push({ label: 'No other camera was rolling here. Load a clip in the Source monitor to use it.', disabled: true });
    items.push({ label: 'Replace media with', sub });
    items.push({ label: 'Open in Source monitor', action: () => { loadSource(it.src, { in: it.in || 0, out: (it.in || 0) + it.dur * S.rate(it) }); setMonTab('source'); } });
    const sp = S.rate(it);
    items.push({ label: `Speed${sp !== 1 ? ` (${Math.round(sp * 100)}%)` : ''}`, sub: [[0.25, '25% · quarter speed'], [0.5, '50% · slow motion'], [1, '100% · normal'], [2, '200% · double speed'], [4, '400%']].map(([v, l]) => ({ label: (v === sp ? '✓ ' : '') + l, action: () => setItemSpeed(f, v) })) });
    items.push({ sep: true });
  }
  const inside = player.t > it.start + 1 && player.t < it.start + it.dur - 1;
  items.push({ label: 'Split at playhead', kbd: '⌘K', disabled: !inside, action: () => { select(it.id); splitSelected(); } });
  if (tr.kind === 'video' && ['clip', 'image'].includes(it.type)) {
    items.push({ label: 'Picture-in-picture', sub: [['Top right', 'top-right'], ['Top left', 'top-left'], ['Bottom right', 'bottom-right'], ['Bottom left', 'bottom-left'], ['Left half', 'left-half'], ['Right half', 'right-half']].map(([l, k]) => ({ label: l, action: () => applyPreset(f, k) })).concat([{ sep: true }, { label: 'Full frame', action: () => applyPreset(f, 'full') }]) });
    items.push({ label: 'Reset transform', disabled: !it.tf && !it.rect, action: () => { snapshot(); delete it.rect; delete it.tf; commit(); } });
    items.push({ label: it.fit === 'fit' ? 'Fill the frame (crop)' : 'Show the whole shot (bars)', action: () => { snapshot(); it.fit = it.fit === 'fit' ? 'fill' : 'fit'; if (tr.program) seq.auto = false; commit(); } });
  }
  if (it.type === 'clip') items.push({ label: it.gain === 0 ? 'Unmute this clip\'s sound' : 'Mute this clip\'s sound', action: () => { snapshot(); it.gain = it.gain === 0 ? 1 : 0; commit(); } });
  if (it.type === 'clip' && tr.kind === 'video') {
    const before = S.heldBefore(tr, it), cur = it.transIn?.dur || 0;
    items.push({
      label: `Dissolve in${cur ? ` (${cur / 1000} s)` : ''}`,
      sub: before ? DISSOLVES.map(([ms, nm]) => ({ label: `${ms ? nm : 'Cut (no dissolve)'}${ms === cur ? ' ✓' : ''}`, action: () => setDissolve(it, tr, ms) })) : [{ label: 'Nothing right before it to dissolve from', disabled: true }],
    });
  }
  items.push({ sep: true });
  items.push({ label: 'Delete', kbd: 'Del', action: () => { select(it.id); deleteSelected(); } });
  items.push({ label: 'Ripple delete', kbd: '⇧Del', action: () => { select(it.id); rippleDeleteSelected(); } });
  openMenu(x, y, items, labelOf(it).text);
}

/** A clip from the left panel: open it, place it at the playhead, or make it a picture-in-picture. */
function sourceMenu(c, x, y, at = null, extra = []) {
  const open = () => {
    loadSource(c.id, null);
    if (at != null) setTimeout(() => srcSeek(Math.max(0, at)), 50);
    setMonTab('source');
  };
  openMenu(x, y, [
    { label: 'Open in Source monitor', action: open },
    { sep: true },
    { label: 'Insert at playhead (whole clip, or its In–Out)', kbd: ',', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, null); placeSource('insert'); } },
    { label: 'Overwrite at playhead', kbd: '.', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, null); placeSource('overwrite'); } },
    ...(c.kind !== 'audio' ? [{ label: 'Add as picture-in-picture here', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, at != null ? { in: Math.max(0, at), out: c.dur } : null); addItem('pip'); } }] : []),
    ...extra,
  ], clipTitle(c));
}

$('#timeline').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-item]');
  if (!el || mode !== 'edit') return;
  const f = S.findItem(seq, el.dataset.item);
  if (!f) return;
  e.preventDefault();
  select(f.item.id);
  itemMenu(f, e.clientX, e.clientY);
});
$('#timeline').addEventListener('keydown', (e) => {
  if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
  const el = e.target.closest('[data-item]');
  const f = el && S.findItem(seq, el.dataset.item);
  if (!f) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  itemMenu(f, r.left + 8, r.bottom + 2);
});
// track targets
$('#timeline').addEventListener('click', (e) => {
  const b = e.target.closest('[data-target]');
  if (!b) return;
  const tr = seq.tracks.find((t) => t.id === b.dataset.target);
  if (!tr) return;
  seq.target = { ...(seq.target || {}), [tr.kind]: tr.id };
  saveSeq();
  renderTimeline();
  announce(`Insert and Overwrite now land on ${tr.name}`);
  document.querySelector(`[data-target="${CSS.escape(tr.id)}"]`)?.focus();
});
// camera tiles (Edit) and the media list
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('.tile[data-angle]');
  if (!tile || mode !== 'edit') return;
  const n = +tile.dataset.angle;
  const c = clipForAngle(n, player.t) || videoClips().find((k) => k.cid === angleCids[n - 1]);
  if (!c) return;
  e.preventDefault();
  const at = seq.origin != null ? player.t + seq.origin - c.t0 : 0;
  sourceMenu(c, e.clientX, e.clientY, at >= 0 && at < c.dur ? at : null, [{ sep: true }, { label: 'Cut the Program to this camera here', kbd: String(n), action: () => tile.click() }]);
});
// microphones on this computer: rename or remove
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('button.mic[data-peer]');
  const l = tile && live.get(tile.dataset.peer);
  if (!tile || !l || mode !== 'live' || !isHost) return;
  e.preventDefault();
  if (!l?.local) {
    e.preventDefault();
    return openMenu(e.clientX, e.clientY, [
      { label: 'Put on air', action: () => cutLive(tile.dataset.peer) },
      { label: 'Rename…', action: () => renameSource(tile.dataset.peer) },
      { sep: true },
      { label: 'Remove from the event…', action: () => askRemove(tile.dataset.peer) },
    ], `${l?.name || 'Microphone'}`);
  }
  openMenu(e.clientX, e.clientY, [
    { label: 'Put on air', action: () => cutLive(tile.dataset.peer) },
    { label: 'Rename…', action: () => renameLocal(tile.dataset.peer) },
    // an interface's two inputs, opened once: each side its own microphone, or both as one again
    ...(canSplit(l) ? [{ label: 'Two microphones (Input 1 left, Input 2 right)', action: () => splitLocalMic(tile.dataset.peer) }] : []),
    ...(l.side ? [{ label: 'One microphone (both sides)', action: () => joinLocalMic(tile.dataset.peer) }] : []),
    { label: 'Remove from the show', action: () => removeLocalSource(tile.dataset.peer, 'removed') },
  ], `${l.name} · this computer`);
});
// live camera tiles: cut, or fix a stuck picture by hand
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('.tile[data-peer]');
  if (!tile || mode !== 'live' || !isHost) return;
  const peer = tile.dataset.peer, l = live.get(peer);
  if (!l) return;
  e.preventDefault();
  const n = liveNo(peer);
  openMenu(e.clientX, e.clientY, [
    ...(l.watching ? [{ label: 'Call back to camera', action: () => callBack(peer) }, { sep: true }] : []),
    { label: 'Cut to this camera', kbd: n && n <= 9 ? String(n) : '', action: () => cutLive(peer) },
    { label: 'Put in preview', action: () => setPreview(peer) },
    { sep: true },
    { label: 'Camera control…', action: () => openCcu(peer) },
    ...(l.local
      ? [
          { label: l.recManual ? 'Stop recording' : 'Record (until you stop it)', action: () => setLocalManualRec(peer, !l.recManual) },
          { label: 'Rename…', action: () => renameLocal(peer) },
          { label: 'Remove from the show', action: () => removeLocalSource(peer, 'removed') },
        ]
      : [
          { label: 'Rename…', action: () => renameSource(peer) },
          { label: 'Refresh picture', action: () => freshPlayer(peer, 'refreshed by hand') },
          { label: 'Reconnect phone', action: () => reconnectPhone(peer, 'reconnected by hand') },
          { sep: true },
          { label: 'Remove from the event…', action: () => askRemove(peer) },
        ]),
  ], `Camera ${n || '?'} · ${l.name}${l.local ? ' · this computer' : ''}`);
});
$('#refreshPics').onclick = () => {
  const cams = camOrder();
  if (!cams.length) return toast('No live cameras');
  cams.forEach((p) => freshPlayer(p, 'refreshed by hand'));
  toast(`Refreshed ${cams.length} live picture${cams.length > 1 ? 's' : ''}`);
};
document.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('#mediaList [data-kind="clip"][data-id], #mediaList [data-kind="subclip"][data-id]');
  if (!li || mode !== 'edit') return;
  e.preventDefault();
  selectMedia(li.dataset.kind, li.dataset.id);
  const c = clipOf(li.dataset.kind === 'clip' ? li.dataset.id : media.subclips.find((x) => x.id === li.dataset.id)?.src);
  if (c) sourceMenu(c, e.clientX, e.clientY);
});
