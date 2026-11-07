// The timeline, with Premiere Pro's tools and keys:
//   V Selection  B Ripple Edit  N Rolling Edit  C Razor  Y Slip  U Slide  H Hand
// Tracks are listed top-down (the top track wins). Snapping (S), track locks,
// markers on the ruler, and a shape badge on every clip (▭ landscape, ▯ portrait).

import { esc, fmtDur } from '/js/vm.js';
import * as S from '/js/sequence.js';

const SNAP_PX = 8;
export const TOOLS = {
  select: { key: 'v', name: 'Selection', cursor: 'default' },
  ripple: { key: 'b', name: 'Ripple Edit', cursor: 'ew-resize' },
  roll: { key: 'n', name: 'Rolling Edit', cursor: 'col-resize' },
  razor: { key: 'c', name: 'Razor', cursor: 'crosshair' },
  slip: { key: 'y', name: 'Slip', cursor: 'ew-resize' },
  slide: { key: 'u', name: 'Slide', cursor: 'move' },
  hand: { key: 'h', name: 'Hand', cursor: 'grab' },
};

export class Timeline {
  /**
   * @param {object} o
   * @param {HTMLElement} o.heads @param {HTMLElement} o.tracks @param {HTMLElement} o.scroller
   * @param {() => object} o.seq
   * @param {(item) => {text:string, color:string, shape?:string, mismatch?:boolean}} o.label
   * @param {(item) => number} o.srcDur
   * @param {(item?) => void} o.begin      before any change (undo snapshot)
   * @param {(what:string) => void} o.changed
   * @param {(id:string|null) => void} o.select
   * @param {(t:number) => void} o.seek
   * @param {() => number} o.now
   * @param {(tool:string) => void} [o.toolChanged]
   */
  constructor(o) {
    Object.assign(this, o);
    this.px = 12;
    this.selected = null;
    this.tool = 'select';
    this.snap = true;
    this._bind();
  }

  x(t) {
    return (t / 1000) * this.px;
  }

  setTool(t) {
    if (!TOOLS[t]) return;
    this.tool = t;
    this.tracks.style.cursor = TOOLS[t].cursor;
    this.tracks.dataset.tool = t;
    this.toolChanged?.(t);
  }

  render() {
    const seq = this.seq();
    const endT = Math.max(S.end(seq), 10000);
    const width = Math.max(this.x(endT) + 240, this.scroller.clientWidth);
    const heads = [`<div class="head ruler-head"></div>`];
    const lanes = [];
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => s * this.px >= 70) || 600;
    let ticks = '';
    for (let s = 0; s <= endT / 1000 + step; s += step) ticks += `<span class="tick" style="left:${s * this.px}px">${fmtDur(s * 1000).slice(0, -3)}</span>`;
    const all = [...(seq.markers || []), ...(this.extraMarkers?.() || [])];
    const markers = all.map((m) => {
      const kind = m.moment ? 'Moment' : 'Marker';
      const btn = `<button type="button" class="marker${m.moment ? ' moment' : ''}${m.gap ? ' gap' : ''}" data-marker="${esc(m.id)}" style="left:${this.x(m.t)}px" title="${kind} at ${fmtDur(m.t)}${m.name ? ': ' + esc(m.name) : ''}${m.gap ? ', where no camera was recording' : ''} (drag to move, double-click to rename, right-click for more)" aria-label="${kind}${m.name ? ' ' + esc(m.name) : ''} at ${fmtDur(m.t)}. Enter renames it, Delete removes it."></button>`;
      return btn + (m.name ? `<span class="mtag" data-mtag="${esc(m.id)}" style="left:${this.x(m.t)}px" aria-hidden="true">${esc(m.name)}</span>` : '');
    }).join('');
    // the export range (In to Out), if one is marked
    const r = seq.range;
    const band = r ? `<span class="inout" style="left:${this.x(r.in)}px;width:${Math.max(2, this.x(r.out) - this.x(r.in))}px" title="Export range ${fmtDur(r.in)} – ${fmtDur(r.out)}" aria-hidden="true"></span>` : '';
    lanes.push(`<div class="trow ruler" data-ruler style="--minor:${(step * this.px) / 5}px">${band}${ticks}${markers}</div>`);
    const kinds = seq.tracks.map((t) => t.kind);
    // each track's name in an editing suite's terms: video counts up from the bottom (V1 under V2),
    // audio down from the top (A1 over A2)
    const vids = seq.tracks.filter((t) => t.kind === 'video'), auds = seq.tracks.filter((t) => t.kind !== 'video');
    const codeOf = (tr) => (tr.kind === 'video' ? 'V' + (vids.length - vids.indexOf(tr)) : 'A' + (auds.indexOf(tr) + 1));
    const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
    seq.tracks.forEach((tr, i) => {
      const canUp = i > 0 && kinds[i - 1] === tr.kind;
      const canDown = i < kinds.length - 1 && kinds[i + 1] === tr.kind;
      const code = codeOf(tr);
      const toggle = tr.kind === 'video'
        ? `<button type="button" class="hb" data-hide="${tr.id}" aria-pressed="${!tr.hidden}" aria-label="${tr.hidden ? 'Show' : 'Hide'} ${esc(tr.name)}" title="${tr.hidden ? 'Hidden: show this track' : 'Showing: hide this track'}">${icon(tr.hidden ? 'eyeoff' : 'eye')}</button>`
        : `<button type="button" class="hb" data-mute="${tr.id}" aria-pressed="${!!tr.muted}" aria-label="${tr.muted ? 'Unmute' : 'Mute'} ${esc(tr.name)}" title="${tr.muted ? 'Muted: turn this track back on' : 'Mute this track'}">M</button>`;
      // the targeted track of each kind is where Insert and Overwrite land (the Program track by default)
      const tgt = (seq.target?.[tr.kind] && seq.tracks.some((t) => t.id === seq.target[tr.kind]) ? seq.target[tr.kind] : tr.kind === 'video' ? seq.tracks.find((t) => t.program)?.id : seq.tracks.find((t) => t.kind === 'audio' && !t.follow)?.id) === tr.id;
      const target = tr.follow
        ? `<span class="tcode" title="Follows ${esc(seq.tracks.find((k) => k.id === tr.follow)?.name || 'Program')}">${code}</span>`
        : `<button type="button" class="tcode" data-target="${tr.id}" aria-pressed="${tgt}" aria-label="${code}: ${tgt ? 'targeted for Insert and Overwrite' : 'target for Insert and Overwrite'}, ${esc(tr.name)}" title="${tgt ? 'Insert and Overwrite land on this track' : 'Click to make Insert and Overwrite land on this track'}">${code}</button>`;
      const lock = tr.follow ? '' : `<button type="button" class="hb" data-lock="${tr.id}" aria-pressed="${!!tr.locked}" aria-label="${tr.locked ? 'Unlock' : 'Lock'} ${esc(tr.name)}" title="${tr.locked ? 'Locked: click to unlock' : 'Lock this track'}">${icon(tr.locked ? 'lock' : 'unlock')}</button>`;
      heads.push(`<div class="head ${tr.kind}${tr.program ? ' prog' : ''}${tr.locked ? ' locked' : ''}" data-track="${tr.id}">
        ${target}<span class="nm" title="${esc(tr.name)}">${esc(tr.name)}</span>
        <span class="hmore">
          <button type="button" data-up="${tr.id}" ${canUp ? '' : 'disabled'} aria-label="Move ${esc(tr.name)} up" title="Higher priority">▲</button>
          <button type="button" data-down="${tr.id}" ${canDown ? '' : 'disabled'} aria-label="Move ${esc(tr.name)} down" title="Lower priority">▼</button>
          ${tr.program || tr.follow ? '' : `<button type="button" data-rmtrack="${tr.id}" aria-label="Delete track ${esc(tr.name)}" title="Delete track">×</button>`}
        </span>
        ${lock}${toggle}
      </div>`);
      const items = (tr.follow ? [] : tr.items).map((it) => {
        const l = this.label(it);
        const cls = ['item', it.id === this.selected ? 'sel' : '', (l.pip ?? it.rect) ? 'pip' : '', l.mismatch ? 'mismatch' : ''].join(' ');
        return `<div class="${cls}" data-item="${it.id}"${tr.kind === 'video' && it.type === 'clip' && it.src ? ` data-src="${esc(it.src)}"` : ''} tabindex="0" role="button"
          aria-label="${esc(l.text)}${it.transIn?.dur > 0 ? `, dissolves in over ${it.transIn.dur / 1000} s` : ''}${l.shape ? ', ' + l.shape : ''}${l.mismatch ? ', wrong shape for the output' : ''}, starts ${fmtDur(it.start).slice(0, -3)}, ${Math.round(it.dur / 100) / 10} seconds"
          style="left:${this.x(it.start)}px;width:${Math.max(4, this.x(it.dur))}px;--c:${l.color}">
          ${it.transIn?.dur > 0 ? `<i class="xd" style="width:${Math.max(6, this.x(Math.min(it.transIn.dur, it.dur)))}px" title="Dissolve in: ${it.transIn.dur / 1000} s" aria-hidden="true"></i>` : ''}<span class="h l" data-edge="start" aria-hidden="true"></span><span class="lbl">${l.shape ? `<i class="shape" aria-hidden="true">${l.shape === 'portrait' ? '▯' : '▭'}</i>` : ''}${esc(l.text)}</span><span class="h r" data-edge="end" aria-hidden="true"></span></div>`;
      }).join('');
      const note = tr.follow ? `<span class="follow">follows ${esc(seq.tracks.find((k) => k.id === tr.follow)?.name || 'Program')}</span>` : '';
      lanes.push(`<div class="trow lane ${tr.kind}${tr.hidden ? ' hidden' : ''}${tr.muted ? ' muted' : ''}${tr.locked ? ' locked' : ''}" data-lane="${tr.id}">${note}${items}</div>`);
    });
    this.heads.innerHTML = heads.join('');
    this.tracks.style.width = width + 'px';
    this.tracks.innerHTML = lanes.join('') + `<div class="playhead" id="playhead"></div>`;
    this.movePlayhead(this.now());
  }

  movePlayhead(t) {
    const ph = this.tracks.querySelector('#playhead');
    if (ph) ph.style.left = this.x(t) + 'px';
  }

  keepVisible(t) {
    const px = this.x(t);
    const sc = this.scroller;
    if (px > sc.scrollLeft + sc.clientWidth - 40 || px < sc.scrollLeft) sc.scrollLeft = px - 60;
  }

  zoomToFit() {
    const total = Math.max(S.end(this.seq()), 1000);
    this.px = Math.max(1, Math.min(240, ((this.scroller.clientWidth - 40) / total) * 1000));
    this.render();
  }

  _snap(t, exclude, exMarker) {
    if (!this.snap) return null;
    const seq = this.seq();
    const pts = [0, this.now(), ...(seq.markers || []).filter((m) => m.id !== exMarker).map((m) => m.t)];
    for (const tr of seq.tracks) for (const it of tr.items) if (it.id !== exclude) pts.push(it.start, it.start + it.dur);
    const lim = (SNAP_PX / this.px) * 1000;
    let best = null;
    for (const p of pts) if (Math.abs(p - t) < lim && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
    return best;
  }

  _bind() {
    this.heads.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const seq = this.seq();
      const tr = seq.tracks.find((t) => t.id === (b.dataset.up || b.dataset.down || b.dataset.rmtrack || b.dataset.hide || b.dataset.mute || b.dataset.lock));
      if (!tr) return;
      if (b.dataset.rmtrack && tr.items.length && !confirm(`Delete "${tr.name}" and its ${tr.items.length} item(s)?`)) return;
      this.begin();
      if (b.dataset.up) S.reorder(seq, tr.id, -1);
      else if (b.dataset.down) S.reorder(seq, tr.id, 1);
      else if (b.dataset.rmtrack) S.removeTrack(seq, tr.id);
      else if (b.dataset.hide) tr.hidden = !tr.hidden;
      else if (b.dataset.mute) tr.muted = !tr.muted;
      else if (b.dataset.lock) tr.locked = !tr.locked;
      this.changed('tracks');
    });

    this.tracks.addEventListener('pointerdown', (e) => {
      const seq = this.seq();
      const box = this.tracks.getBoundingClientRect();
      const tAt = (cx) => Math.max(0, ((cx - box.left) / this.px) * 1000);
      const marker = e.target.closest('[data-marker]');
      if (marker) {
        // click: go there. Drag: move it (it snaps like everything else).
        if (e.button !== 0) return;
        const m = this._marker(marker.dataset.marker);
        if (!m) return;
        const x0 = e.clientX;
        const tag = this.tracks.querySelector(`[data-mtag="${CSS.escape(m.id)}"]`);
        let moved = false, t = m.t;
        this._drag((mv) => {
          if (!moved && Math.abs(mv.clientX - x0) < 4) return;
          moved = true;
          marker.classList.add('dragging');
          const raw = Math.max(0, m.t + ((mv.clientX - x0) / this.px) * 1000);
          t = this._snap(raw, null, m.id) ?? raw;
          marker.style.left = this.x(t) + 'px';
          if (tag) tag.style.left = this.x(t) + 'px';
        }, () => {
          marker.classList.remove('dragging');
          if (moved) this.moveMarker?.(m, t);
          else this.seek(m.t);
        });
        return;
      }
      const itemEl = e.target.closest('[data-item]');
      if (this.tool === 'hand' || (!itemEl && e.button === 1)) return this._pan(e);
      if (!itemEl) {
        this.select(null);
        const scrub = (m) => this.seek(tAt(m.clientX));
        scrub(e);
        this._drag(scrub);
        return;
      }
      e.preventDefault();
      const id = itemEl.dataset.item;
      const f = S.findItem(seq, id);
      if (!f) return;
      this.select(id);
      if (f.track.locked) return;
      const it = f.item;
      const edge = e.target.dataset.edge;
      const x0 = e.clientX;

      if (this.tool === 'razor') {
        const raw = tAt(e.clientX);
        const t = this._snap(raw, null) ?? raw;
        this.begin(it);
        if (S.splitAt(seq, id, t)) this.changed('razor');
        return;
      }

      // Every drag replays from the state at pointer-down, so edits never accumulate error.
      const base = S.clone(seq);
      const restore = () => {
        const b = S.clone(base);
        seq.tracks = b.tracks;
        seq.markers = b.markers;
      };
      const orig = { start: it.start, dur: it.dur };
      const neighbour = (side) => {
        const tr = S.track(seq, f.track.id);
        const self = tr.items.find((x) => x.id === id);
        return side === 'left'
          ? tr.items.find((o) => o !== self && Math.abs(o.start + o.dur - self.start) < 2)
          : tr.items.find((o) => o !== self && Math.abs(o.start - (self.start + self.dur)) < 2);
      };
      let began = false;
      const onMove = (m) => {
        const dt = ((m.clientX - x0) / this.px) * 1000;
        if (!began) {
          if (Math.abs(m.clientX - x0) < 3 && Math.abs(m.clientY - e.clientY) < 3) return;
          began = true;
          this.begin(it);
        }
        restore();
        const tool = this.tool;
        if (edge && (tool === 'select' || tool === 'ripple' || tool === 'roll')) {
          const raw = edge === 'start' ? orig.start + dt : orig.start + orig.dur + dt;
          const t = this._snap(raw, id) ?? raw;
          if (tool === 'ripple') S.rippleTrim(seq, id, edge, t, this.srcDur(it));
          else if (tool === 'roll') {
            const n = neighbour(edge === 'end' ? 'right' : 'left');
            if (n) edge === 'end' ? S.rollEdit(seq, id, n.id, t, this.srcDur) : S.rollEdit(seq, n.id, id, t, this.srcDur);
            else S.trim(seq, id, edge, t, this.srcDur(it));
          } else S.trim(seq, id, edge, t, this.srcDur(it));
        } else if (tool === 'slip') {
          S.slip(seq, id, -dt, this.srcDur(it)); // drag left to see later in the clip, like Premiere
        } else if (tool === 'slide') {
          S.slide(seq, id, dt, this.srcDur);
        } else if (tool === 'select') {
          let ns = orig.start + dt;
          const s1 = this._snap(ns, id), s2 = this._snap(ns + orig.dur, id);
          if (s1 !== null) ns = s1;
          else if (s2 !== null) ns = s2 - orig.dur;
          const under = document.elementFromPoint(m.clientX, m.clientY)?.closest('[data-lane]');
          S.move(seq, id, ns, under?.dataset.lane);
        }
        this.render();
      };
      this._drag(onMove, () => began && this.changed(this.tool));
    });

    this.tracks.addEventListener('dblclick', (e) => {
      const mk = e.target.closest('[data-marker]');
      const m = mk && this._marker(mk.dataset.marker);
      if (!m) return;
      e.preventDefault();
      this.renameMarker?.(m);
    });
    this.tracks.addEventListener('contextmenu', (e) => {
      const mk = e.target.closest('[data-marker]');
      const m = mk && this._marker(mk.dataset.marker);
      if (!m || !this.markerMenu) return;
      e.preventDefault();
      e.stopPropagation();
      this.markerMenu(m, e.clientX, e.clientY);
    });

    this.tracks.addEventListener('keydown', (e) => {
      const mk = e.target.closest('[data-marker]');
      if (mk) {
        const m = this._marker(mk.dataset.marker);
        if (!m) return;
        const take = () => (e.preventDefault(), e.stopPropagation());
        if (e.key === 'Delete' || e.key === 'Backspace') take(), this.deleteMarker?.(m);
        else if (e.key === 'Enter' || e.key === 'F2') take(), this.renameMarker?.(m);
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          take();
          const r = mk.getBoundingClientRect();
          this.markerMenu?.(m, r.left, r.bottom + 2);
        }
        return;
      }
      const el = e.target.closest('[data-item]');
      if (el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        this.select(el.dataset.item);
      }
    });
  }

  /** A marker or moment on the ruler, by id. */
  _marker(id) {
    return [...(this.seq().markers || []), ...(this.extraMarkers?.() || [])].find((x) => x.id === id) || null;
  }

  _drag(move, done) {
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      done?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  _pan(e) {
    const sc = this.scroller;
    const x0 = e.clientX, s0 = sc.scrollLeft;
    this.tracks.style.cursor = 'grabbing';
    this._drag((m) => (sc.scrollLeft = s0 - (m.clientX - x0)), () => (this.tracks.style.cursor = TOOLS[this.tool].cursor));
  }
}
