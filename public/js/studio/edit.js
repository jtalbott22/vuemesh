// Studio, part 16 of 26: Edit mode, transforms, Program monitor handles, dissolves, the export range.
// Loads after phones.js: that import comes first, so the parts run in order (see ../studio.js).
import './phones.js';
import { toast, esc, fmtDur, announce } from '/js/vm.js';
import { PIP, tfOf, TF_PRESETS, transformBox } from '/js/compose.js';
import { SLATE_LOOKS } from '/js/slates.js';
import * as S from '/js/sequence.js';
import {
  $, COLORS, FRAME, dbToGain, fit, gainToDb, isHost, mode, note, orientation, player, program,
  selectedItem, seq, setSelectedItem, thumbs, timeline,
} from './core.js';
import {
  angleOfCid, clipForAngle, clipOf, commit, editAngles, isInset, labelOf, saveSeq, shapeOf, snapshot,
  videoClips, viewOf,
} from './clips.js';
import { reel } from './graphics.js';
import { resolveMarkers } from './transport.js';
import { cutTo, deleteSelected, splitSelected } from './editops.js';
import { monTab } from './library.js';

// ---------------------------------------------------------------- edit mode ---

export function renderMulti() {
  const box = $('#multi');
  box.querySelector('.empty')?.remove();
  box.querySelectorAll('.cam, [data-peer]').forEach((t) => (t.style.display = 'none'));
  box.querySelectorAll('.tile[data-angle]').forEach((t) => t.remove());
  const cids = editAngles();
  $('#srcCount').textContent = cids.length ? `${cids.length} angle${cids.length > 1 ? 's' : ''}` : '';
  if (!cids.length) {
    box.insertAdjacentHTML('afterbegin', `<div class="empty">No clips yet. When a phone stops recording, its full-quality clip comes straight to this device and appears here.</div>`);
    return;
  }
  for (const cid of cids) {
    const n = angleOfCid(cid);
    const list = videoClips().filter((c) => c.cid === cid);
    const shown = clipForAngle(n, player.t) || list[0];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.dataset.angle = String(n);
    tile.innerHTML = `${thumbs.get(shown.id) ? `<img src="${thumbs.get(shown.id)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}<span class="n" style="color:${COLORS[(n - 1) % COLORS.length]}">${n}</span><span class="who">${esc(shown.name)} · ${list.length} clip${list.length > 1 ? 's' : ''}</span>`;
    tile.style.order = n;
    tile.onclick = () => {
      const c = clipForAngle(n, player.t);
      if (c) cutTo(c.id);
      else toast(`Angle ${n} isn't recording at this moment`);
    };
    tile.setAttribute('aria-label', `Cut the Program to angle ${n}, ${shown.name}, at the playhead`);
    tile.classList.toggle('off', !clipForAngle(n, player.t));
    box.append(tile);
  }
}

export function renderTimeline() {
  resolveMarkers();
  renderRangeInfo();
  timeline.selected = selectedItem;
  timeline.render();
}

export function select(id) {
  setSelectedItem(id);
  document.querySelectorAll('.item.sel').forEach((el) => el.classList.remove('sel'));
  if (id) document.querySelector(`[data-item="${id}"]`)?.classList.add('sel');
  timeline.selected = id;
  renderInspector();
}

export function renderInspector() {
  const box = $('#selPanel');
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f) {
    box.innerHTML = `<h2>Selection</h2><p class="fine" style="margin:0">Click an item on the timeline to trim, move, or change it. ${seq.auto ? 'The Program follows your live cuts until you edit it by hand.' : 'The Program is hand-edited; “Rebuild cuts” starts it over from your live cuts.'}</p>`;
    return;
  }
  const { item: it, track: tr } = f;
  const l = labelOf(it);
  const posOpts = '<option value="">Custom</option>' + Object.keys(TF_PRESETS).map((k) => `<option value="${k}" ${presetOf(it) === k ? 'selected' : ''}>${{ full: 'Full frame', 'top-right': 'Top right', 'top-left': 'Top left', 'bottom-right': 'Bottom right', 'bottom-left': 'Bottom left', 'left-half': 'Left half', 'right-half': 'Right half' }[k]}</option>`).join('');
  const fades = [0, 300, 500, 1000];
  const fadeSel = (name, v) => `<select data-f="${name}" aria-label="${name === 'fadeIn' ? 'Fade in' : 'Fade out'}">${fades.map((x) => `<option value="${x}" ${x === (v || 0) ? 'selected' : ''}>${x ? x / 1000 + ' s' : 'None'}</option>`).join('')}</select>`;
  const isVideo = tr.kind === 'video';
  box.innerHTML = `<h2>Selection</h2>
    <div class="sel">
      <div class="kv"><span>Item</span><b>${esc(l.text)}</b><span>Track</span><span>${esc(tr.name)}</span><span>Starts</span><span class="tc">${fmtDur(it.start)}</span><span>Length</span><span class="tc">${fmtDur(it.dur)}</span></div>
      ${it.type === 'title' ? `<label for="selText">Text</label><input type="text" id="selText" value="${esc(it.text || '')}"><label for="selSub">Second line</label><input type="text" id="selSub" value="${esc(it.sub || '')}">` : ''}
      ${it.type === 'slate' ? `<label for="selText">Message</label><input type="text" id="selText" value="${esc(it.text || '')}"><label for="selLook">Look</label><select id="selLook">${SLATE_LOOKS.map(([id, nm]) => `<option value="${id}" ${(it.look || 'bars') === id ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select>` : ''}
      ${isVideo && it.type === 'clip' ? `<label for="selRot">Rotation</label><select id="selRot">${[0, 90, 180, 270].map((r) => `<option value="${r}" ${(it.rot || 0) === r ? 'selected' : ''}>${r ? r + '° clockwise' : 'As recorded'}</option>`).join('')}</select>${shapeOf(it) ? `<p class="fine" style="margin:4px 0 0">This shot is ${shapeOf(it)}${shapeOf(it) !== orientation ? ` — the output is ${orientation}, so it's ${it.fit === 'fit' ? 'shown whole with bars' : 'cropped to fill'}.` : '.'}</p>` : ''}` : ''}
      ${isVideo && (it.type === 'clip' || it.type === 'image') ? `<label for="selPos">Layout</label><select id="selPos">${posOpts}</select>${transformFields(it)}
        <label for="selFit">Framing</label><select id="selFit"><option value="" ${!it.fit ? 'selected' : ''}>Same as output</option><option value="fill" ${it.fit === 'fill' ? 'selected' : ''}>Fill</option><option value="fit" ${it.fit === 'fit' ? 'selected' : ''}>Whole shot</option></select>` : ''}
      ${isVideo && it.type === 'clip' && S.heldBefore(tr, it) ? `<label for="selDissolve">Dissolve in</label><select id="selDissolve">${[...DISSOLVES, ...(it.transIn?.dur && !DISSOLVES.some(([ms]) => ms === it.transIn.dur) ? [[it.transIn.dur, `${(it.transIn.dur / 1000).toFixed(2)} s (as it was live)`]] : [])].map(([ms, nm]) => `<option value="${ms}" ${(it.transIn?.dur || 0) === ms ? 'selected' : ''}>${ms ? nm : 'Cut (no dissolve)'}</option>`).join('')}</select>` : ''}
      ${isVideo ? `<div class="row" style="gap:8px;margin-top:8px"><label style="margin:0">Fade in ${fadeSel('fadeIn', it.fadeIn)}</label><label style="margin:0">Fade out ${fadeSel('fadeOut', it.fadeOut)}</label></div>` : `<label for="selGain">Clip level</label><input type="range" id="selGain" min="-30" max="12" value="${gainToDb(it.gain ?? 1)}" aria-label="Clip level in decibels">`}
      <div class="row" style="margin-top:10px;gap:6px"><button type="button" id="selSplit">Split</button><button type="button" id="selDup">Duplicate</button><button type="button" id="selDel">Delete</button></div>
    </div>`;
  const edit = (fn) => {
    snapshot();
    if (S.program(seq).items.includes(it)) seq.auto = false;
    fn();
    commit();
  };
  box.querySelector('#selText')?.addEventListener('change', (e) => edit(() => (it.text = e.target.value)));
  box.querySelector('#selSub')?.addEventListener('change', (e) => edit(() => (it.sub = e.target.value)));
  box.querySelector('#selLook')?.addEventListener('change', (e) => edit(() => (it.look = e.target.value)));
  box.querySelector('#selPos')?.addEventListener('change', (e) => {
    if (!TF_PRESETS[e.target.value]) return;
    edit(() => {
      delete it.rect;
      it.tf = { ...tfOf(it), ...TF_PRESETS[e.target.value], r: 0, crop: { l: 0, t: 0, r: 0, b: 0 } };
    });
  });
  bindTransformFields(box, it);
  box.querySelector('#selFit')?.addEventListener('change', (e) => edit(() => (it.fit = e.target.value || null)));
  box.querySelector('#selDissolve')?.addEventListener('change', (e) => setDissolve(it, tr, +e.target.value));
  box.querySelector('#selRot')?.addEventListener('change', (e) => edit(() => (it.rot = +e.target.value || 0)));
  box.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', (e) => edit(() => (it[e.target.dataset.f] = +e.target.value))));
  box.querySelector('#selGain')?.addEventListener('change', (e) => edit(() => (it.gain = dbToGain(+e.target.value))));
  box.querySelector('#selSplit').onclick = () => splitSelected();
  box.querySelector('#selDel').onclick = () => deleteSelected();
  box.querySelector('#selDup').onclick = () => {
    const copy = { ...it, id: undefined, start: it.start + it.dur };
    edit(() => {
      if (tr.kind === 'video' && !tr.program) S.addOverlay(seq, copy);
      else {
        copy.id = Math.random().toString(36).slice(2, 10);
        if (!tr.items.some((o) => copy.start < o.start + o.dur && o.start < copy.start + copy.dur)) tr.items.push(copy), S.sortItems(tr);
        else toast('No room after it on this track');
      }
    });
  };
}

export function credits() {
  // Screen time: whoever's clip is the topmost full-frame picture, sampled 10× a second.
  const ms = new Map();
  let total = 0;
  const endT = S.end(seq);
  const vtracks = seq.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  for (let t = 0; t < endT; t += 100) {
    for (const tr of vtracks) {
      const it = S.itemAt(tr, t);
      if (!it || isInset(it)) continue;
      if (it.type !== 'clip') break; // a title card or slate covers everything below
      const c = clipOf(it.src);
      if (c) {
        ms.set(c.cid, { name: c.name, ms: (ms.get(c.cid)?.ms || 0) + 100 });
        total += 100;
      }
      break;
    }
  }
  return [...ms.entries()]
    .map(([cid, v]) => ({ cid, name: v.name, ms: v.ms, share: total ? v.ms / total : 0 }))
    .sort((a, b) => b.ms - a.ms);
}

export function soundCredits() {
  return seq.tracks.filter((t) => t.mic && !t.muted && (t.gain ?? 1) > 0).map((t) => t.name.replace(/^Mic · /, ''));
}

export function renderCredits() {
  const box = $('#credits');
  const list = credits();
  const sound = soundCredits();
  box.hidden = !list.length && !sound.length;
  if (box.hidden) return;
  box.innerHTML = `<h2>Shot by</h2><table>${list
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${(c.share * 100).toFixed(0)}%</td></tr>`)
    .join('')}${sound.map((n) => `<tr><td>${esc(n)}</td><td>sound</td></tr>`).join('')}</table>`;
}

// ------------------------------------------------------------- transforms ----
// Any picture layer can be moved, scaled, rotated, cropped and faded: drag the handles on
// the Program monitor, or type exact values in the inspector. Layers stack like any
// editor: the top track draws last, so a smaller or cropped clip shows the one below.

function presetOf(it) {
  if (!it.tf) return it.rect ? Object.keys(PIP).find((k) => JSON.stringify(PIP[k]) === JSON.stringify(it.rect)) || '' : 'full';
  const t = tfOf(it);
  if (t.r || t.crop.l || t.crop.t || t.crop.r || t.crop.b) return '';
  return Object.keys(TF_PRESETS).find((k) => {
    const p = TF_PRESETS[k];
    return Math.abs(p.x - t.x) < 0.005 && Math.abs(p.y - t.y) < 0.005 && Math.abs(p.s - t.s) < 0.005;
  }) || '';
}

/** Give an item an explicit transform (converting an old picture-in-picture box). */
function ensureTf(it) {
  if (it.tf) return it.tf;
  const r = it.rect;
  it.tf = r ? { ...tfOf({}), x: r.x + r.w / 2, y: r.y + r.h / 2, s: Math.min(r.w, r.h) } : tfOf({});
  delete it.rect;
  return it.tf;
}

function transformFields(it) {
  const t = tfOf(it);
  const n = (id, label, v, min, max, step, unit) => `<label class="tfl" for="${id}">${label}<span><input type="number" id="${id}" value="${v}" min="${min}" max="${max}" step="${step}">${unit}</span></label>`;
  return `<div class="tfgrid" role="group" aria-label="Transform">
    ${n('tfX', 'X', Math.round(t.x * 1000) / 10, -100, 200, 0.5, '%')}${n('tfY', 'Y', Math.round(t.y * 1000) / 10, -100, 200, 0.5, '%')}
    ${n('tfS', 'Scale', Math.round(t.s * 1000) / 10, 1, 1000, 1, '%')}${n('tfR', 'Rotate', Math.round(t.r * 10) / 10, -360, 360, 1, '°')}
    ${n('tfO', 'Opacity', Math.round(t.o * 100), 0, 100, 1, '%')}
  </div>
  <div class="tfgrid" role="group" aria-label="Crop">
    ${n('tfCl', 'Crop L', Math.round(t.crop.l * 100), 0, 90, 1, '%')}${n('tfCr', 'Crop R', Math.round(t.crop.r * 100), 0, 90, 1, '%')}
    ${n('tfCt', 'Crop T', Math.round(t.crop.t * 100), 0, 90, 1, '%')}${n('tfCb', 'Crop B', Math.round(t.crop.b * 100), 0, 90, 1, '%')}
  </div>
  <button type="button" id="tfReset" class="small">Reset transform</button>
  <p class="fine" id="tfHint" hidden>Move the playhead over this clip to drag it on the viewer.</p>`;
}

function bindTransformFields(box, it) {
  const map = { tfX: ['x', 0.01], tfY: ['y', 0.01], tfS: ['s', 0.01], tfR: ['r', 1], tfO: ['o', 0.01] };
  const crop = { tfCl: 'l', tfCr: 'r', tfCt: 't', tfCb: 'b' };
  let snapped = false;
  box.querySelectorAll('.tfgrid input').forEach((inp) => {
    inp.addEventListener('input', () => {
      if (!snapped) {
        snapshot();
        snapped = true;
        if (S.program(seq).items.includes(it)) seq.auto = false;
      }
      const tf = ensureTf(it);
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) return;
      if (map[inp.id]) tf[map[inp.id][0]] = v * map[inp.id][1];
      else {
        tf.crop = { ...tfOf(it).crop, [crop[inp.id]]: Math.max(0, Math.min(0.9, v / 100)) };
        const c = tf.crop;
        if (c.l + c.r > 0.95) c[crop[inp.id]] = Math.max(0, 0.95 - (c.l + c.r - c[crop[inp.id]]));
        if (c.t + c.b > 0.95) c[crop[inp.id]] = Math.max(0, 0.95 - (c.t + c.b - c[crop[inp.id]]));
      }
      if (tf.s < 0.01) tf.s = 0.01;
      tf.o = Math.max(0, Math.min(1, tf.o));
    });
    inp.addEventListener('change', () => {
      snapped = false;
      saveSeq();
      renderTimeline();
    });
  });
  box.querySelector('#tfReset')?.addEventListener('click', () => {
    snapshot();
    delete it.rect;
    it.tf = tfOf({});
    commit();
  });
}

// ---- handles on the Program monitor ----
const xf = $('#xform');
function itemFrameSize(tr, it) {
  if (it.type === 'image') {
    const im = reel.find((r) => r.id === it.asset)?.el;
    return im ? { w: im.naturalWidth || im.videoWidth || 0, h: im.naturalHeight || im.videoHeight || 0, rot: 0 } : null;
  }
  const e = player.els.get(tr.id + '|' + it.src);
  const vw = e?.v.videoWidth, vh = e?.v.videoHeight;
  if (!vw || !vh) return null;
  const view = viewOf(it, S.srcAt(it, player.t));
  const r = view?.rect;
  return { w: vw * (r ? r.w : 1), h: vh * (r ? r.h : 1), rot: ((view?.rot || 0) + (it.rot || 0)) % 360 };
}
function selectedLayer() {
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f || f.track.kind !== 'video' || f.track.hidden || !['clip', 'image'].includes(f.item.type)) return null;
  const t = player.t;
  if (t < f.item.start || t >= f.item.start + f.item.dur) return null;
  return f;
}
/** The selected layer's visible box in CSS pixels over the program canvas. */
function layerBoxCss(f) {
  const size = itemFrameSize(f.track, f.item);
  if (!size) return null;
  const it = f.item;
  const W = program.width, H = program.height;
  let tf = tfOf(it);
  if (!it.tf && it.rect) tf = { ...tf, x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2, s: Math.min(it.rect.w, it.rect.h) };
  const b = transformBox(tf, W, H, size.w, size.h, it.fit || fit, size.rot);
  const k = program.clientWidth / W;
  return { left: program.offsetLeft + (b.cx - b.w / 2) * k, top: program.offsetTop + (b.cy - b.h / 2) * k, w: b.w * k, h: b.h * k, angle: b.angle, cx: program.offsetLeft + b.cx * k, cy: program.offsetTop + b.cy * k, k };
}
let xfDrag = null;
(function xformLoop() {
  const f = mode === 'edit' && monTab === 'program' && isHost ? selectedLayer() : null;
  // A clip is selected but the playhead isn't over it: say why there are no handles.
  const hint = document.querySelector('#tfHint');
  if (hint) {
    const sel = mode === 'edit' && selectedItem ? S.findItem(seq, selectedItem) : null;
    hint.hidden = !(sel && !f && sel.track.kind === 'video' && ['clip', 'image'].includes(sel.item.type));
  }
  const b = f && layerBoxCss(f);
  xf.hidden = !b;
  if (b && !xfDrag?.live) {
    Object.assign(xf.style, { left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px', transform: `rotate(${b.angle}deg)` });
  } else if (b && xfDrag?.live) {
    Object.assign(xf.style, { left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px', transform: `rotate(${b.angle}deg)` });
  }
  requestAnimationFrame(xformLoop);
})();

xf.addEventListener('pointerdown', (e) => {
  const f = selectedLayer();
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();
  xf.setPointerCapture(e.pointerId);
  snapshot();
  if (S.program(seq).items.includes(f.item)) seq.auto = false;
  const tf = ensureTf(f.item);
  const fr = $('#progFrame').getBoundingClientRect();
  const b = layerBoxCss(f);
  const center = { x: fr.left + b.cx, y: fr.top + b.cy };
  const W = program.width, k = program.clientWidth / W;
  xfDrag = { live: true, h: e.target.dataset.h || 'move', x0: e.clientX, y0: e.clientY, tf0: JSON.parse(JSON.stringify(tf)), center, k,
    d0: Math.hypot(e.clientX - center.x, e.clientY - center.y) || 1, a0: Math.atan2(e.clientY - center.y, e.clientX - center.x) };
});
xf.addEventListener('pointermove', (e) => {
  if (!xfDrag) return;
  const f = selectedLayer();
  if (!f) return;
  const tf = f.item.tf, d = xfDrag;
  if (d.h === 'move') {
    const W = program.width, H = program.height;
    tf.x = d.tf0.x + (e.clientX - d.x0) / (W * d.k);
    tf.y = d.tf0.y + (e.clientY - d.y0) / (H * d.k);
    const near = 8 / (W * d.k);
    if (Math.abs(tf.x - 0.5) < near) tf.x = 0.5; // snap to the centre lines
    if (Math.abs(tf.y - 0.5) < near * (W / H)) tf.y = 0.5;
  } else if (d.h === 'rot') {
    let deg = d.tf0.r + ((Math.atan2(e.clientY - d.center.y, e.clientX - d.center.x) - d.a0) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    else {
      const q = Math.round(deg / 90) * 90;
      if (Math.abs(deg - q) < 3) deg = q; // snap to square
    }
    tf.r = Math.round(deg * 10) / 10;
  } else {
    const dist = Math.hypot(e.clientX - d.center.x, e.clientY - d.center.y);
    tf.s = Math.max(0.03, Math.min(10, d.tf0.s * (dist / d.d0)));
    if (Math.abs(tf.s - 1) < 0.02) tf.s = 1; // snap to full size
  }
});
const xfEnd = () => {
  if (!xfDrag) return;
  xfDrag = null;
  commit();
};
xf.addEventListener('pointerup', xfEnd);
xf.addEventListener('pointercancel', xfEnd);

// Click the picture to select the layer under the pointer (top track first).
program.addEventListener('pointerdown', (e) => {
  if (mode !== 'edit' || monTab !== 'program') return;
  const fr = $('#progFrame').getBoundingClientRect();
  const px = e.clientX - fr.left, py = e.clientY - fr.top;
  const t = player.t;
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    const it = S.itemAt(tr, t);
    if (!it || !['clip', 'image'].includes(it.type)) continue;
    const b = layerBoxCss({ track: tr, item: it });
    if (!b) continue;
    const a = (-b.angle * Math.PI) / 180;
    const dx = px - b.cx, dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) {
      select(it.id);
      renderTimeline();
      return;
    }
  }
});

// ---- dissolves in the edit ----
// A dissolve into a shot: the shot before carries on underneath while this one fades in (its
// sound crossfades too). Live dissolves arrive this way in the automatic edit; any cut can
// be made one, or a dissolve made a cut again, from the clip's menu or the Selection panel.
export const DISSOLVES = [[0, 'Cut'], [250, '¼ s'], [500, '½ s'], [1000, '1 s'], [2000, '2 s']];
export function setDissolve(it, tr, ms) {
  snapshot();
  if (tr.program) seq.auto = false;
  if (ms > 0) it.transIn = { dur: ms };
  else delete it.transIn;
  commit();
  announce(ms ? `Dissolves in over ${ms / 1000} seconds` : 'Cuts in (no dissolve)');
}

// ---- export range (In to Out) and collapsing gaps ------------------------------------------
// I and O on the timeline mark what Render exports, so a long day doesn't have to be
// rendered end to end. Collapse gaps takes out every stretch where no camera was recording. After that (or any hand edit), new live footage goes on the end of the timeline, after a gap as long as the real time since the last part.

export function setRange(which) {
  if (which === null) {
    if (!seq.range) return;
    snapshot();
    delete seq.range;
    commit();
    return announce('In and out cleared: Render exports the whole timeline');
  }
  snapshot();
  const t = Math.round(player.t);
  const r = seq.range || { in: 0, out: S.end(seq) };
  r[which] = t;
  if (r.out - r.in < FRAME) which === 'in' ? (r.out = S.end(seq)) : (r.in = 0);
  seq.range = r;
  commit();
  announce(`${which === 'in' ? 'In' : 'Out'} at ${fmtDur(t)}`);
}
function renderRangeInfo() {
  const r = seq.range;
  $('#rangeInfo').innerHTML = r
    ? `Renders <b>${fmtDur(r.in).slice(0, -3)} – ${fmtDur(r.out).slice(0, -3)}</b> (${fmtDur(r.out - r.in).slice(0, -3)}) of the timeline.`
    : 'Renders the whole timeline. Press <kbd>I</kbd> and <kbd>O</kbd> on the timeline to render just part of it.';
  $('#rangeClear').hidden = !r;
  $('#renderBtn').textContent = r ? 'Render In to Out' : 'Render MP4';
}
$('#rangeClear').onclick = () => setRange(null);

// Dissolve (D): into the selected clip, or else the Program shot at the playhead; again takes it off.
export function dissolveHere() {
  let f = selectedItem && S.findItem(seq, selectedItem);
  if (!f || f.item.type !== 'clip' || f.track.kind !== 'video') {
    const prog = S.program(seq), t = player.t;
    const it = prog.items.filter((x) => x.type === 'clip' && x.start <= t + 1).sort((a, b) => b.start - a.start)[0];
    f = it ? { item: it, track: prog } : null;
  }
  if (!f) return toast('Pick a clip on the timeline first');
  if (!S.heldBefore(f.track, f.item)) return toast('Nothing right before this clip to dissolve from');
  setDissolve(f.item, f.track, f.item.transIn?.dur ? 0 : 500);
  select(f.item.id);
}
$('#xdBtn').onclick = dissolveHere;
$('#gapsBtn').onclick = () => {
  const gaps = S.videoGaps(seq).filter((g) => g.end - g.start >= FRAME);
  if (!gaps.length) return toast('No gaps: there\'s picture all the way through');
  snapshot();
  seq.auto = false; // the program no longer follows the live cuts by itself
  const total = gaps.reduce((n, g) => n + g.end - g.start, 0);
  S.collapseGaps(seq);
  commit();
  note(`Collapsed ${gaps.length} gap${gaps.length > 1 ? 's' : ''} (${fmtDur(total).slice(0, -3)} of empty time); new live footage will go on the end`);
  toast(`Took out ${gaps.length} gap${gaps.length > 1 ? 's' : ''}: ${fmtDur(total).slice(0, -3)} of empty time (Undo brings it back)`, 5000);
};
