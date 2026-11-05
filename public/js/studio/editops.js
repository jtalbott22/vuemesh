// Studio, part 19 of 25: edit operations.
// Loads after transport.js: that import comes first, so the parts run in order (see ../studio.js).
import './transport.js';
import { toast, announce } from '/js/vm.js';
import { tfOf, TF_PRESETS } from '/js/compose.js';
import * as S from '/js/sequence.js';
import { planCuts } from '/js/director.js';
import {
  $, FRAME, cut, ev, isHost, note, orientation, player, selectedItem, seq, setSelectedItem,
} from './core.js';
import {
  angleNo, clipOf, commit, labelOf, orientAt, rebuild, saveCut, snapshot, videoClips,
} from './clips.js';
import { media } from './room.js';
import { fileToReel, reel, slateLook } from './graphics.js';
import { select } from './edit.js';
import { clipTitle, srcMon } from './library.js';

// -------------------------------------------------------------- edit ops ----

/** Number keys in Edit: switch the Program's angle at the playhead. */
export function cutTo(id) {
  if (!isHost) return toast('Open your studio link to cut');
  const c = clipOf(id);
  const t = player.t;
  if (seq.origin == null || t + seq.origin < c.t0 || t + seq.origin >= c.t0 + c.dur) return toast(`Angle ${angleNo(id)} isn't recording at this moment`);
  snapshot();
  if (seq.auto) {
    // still following the cut log: record the decision there and rebuild
    const abs = t + seq.origin;
    cut.edl = cut.edl.filter((e) => Math.abs(e.t - abs) > FRAME);
    cut.edl.push({ t: abs, clip: id });
    saveCut();
    rebuild(false);
  } else {
    S.cutProgramAt(seq, t, c);
  }
  commit();
  announce(`Cut to angle ${angleNo(id)}`);
}

export function splitSelected() {
  let id = selectedItem;
  if (!id) id = S.itemAt(S.program(seq), player.t)?.id;
  if (!id) return toast('Nothing under the playhead to split');
  snapshot();
  const f = S.findItem(seq, id);
  if (f && S.program(seq).items.includes(f.item)) seq.auto = false;
  const right = S.splitAt(seq, id, player.t);
  if (!right) return toast('Move the playhead inside the item to split it');
  commit();
  announce('Split');
}

export function trimToPlayhead(edge) {
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f) return toast('Select an item to trim');
  snapshot();
  if (S.program(seq).items.includes(f.item)) seq.auto = false;
  S.trim(seq, f.item.id, edge, player.t, f.item.type === 'clip' ? clipOf(f.item.src)?.dur ?? Infinity : Infinity);
  commit();
  announce(edge === 'start' ? 'Trimmed start' : 'Trimmed end');
}

export function deleteSelected() {
  if (!selectedItem) return toast('Select an item to delete');
  snapshot();
  const f = S.findItem(seq, selectedItem);
  if (f && S.program(seq).items.includes(f.item)) seq.auto = false;
  S.remove(seq, selectedItem);
  setSelectedItem(null);
  commit();
  announce('Deleted');
}

export function addItem(kind) {
  if (!isHost) return;
  document.querySelector('.addmenu')?.removeAttribute('open');
  const t = player.t;
  const room = Math.max(1000, (S.end(seq) || 10000) - t);
  if (kind === 'vtrack' || kind === 'atrack') {
    snapshot();
    S.addTrack(seq, kind === 'vtrack' ? 'video' : 'audio');
    return commit();
  }
  let item;
  if (kind === 'lower') item = { type: 'title', style: 'lower', text: 'Name', sub: 'What they do', start: t, dur: Math.min(5000, room), fadeIn: 300, fadeOut: 300 };
  else if (kind === 'card') item = { type: 'title', style: 'card', text: ev.title, sub: new Date(ev.createdAt || Date.now()).toLocaleDateString(), start: t, dur: Math.min(4000, room), fadeIn: 500, fadeOut: 500 };
  else if (kind === 'slate') item = { type: 'slate', text: "We'll be right back", look: slateLook, start: t, dur: Math.min(5000, room) };
  else if (kind === 'image') {
    const pickImage = (asset) => {
      snapshot();
      const tr = S.addOverlay(seq, { type: 'image', asset: asset.id, start: t, dur: Math.min(5000, room), tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fit: 'fit', fadeIn: 300, fadeOut: 300 });
      commit();
      select(tr.items.find((x) => x.asset === asset.id && x.start === t)?.id);
    };
    const img = reel.find((r) => r.type.startsWith('image/'));
    if (img && confirm(`Use "${img.name}" from your media? (Cancel to choose a new image.)`)) return pickImage(img);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => input.files[0] && pickImage(fileToReel(input.files[0]));
    return input.click();
  } else if (kind === 'pip') {
    // The clip in the Source monitor (from its In) if there is one; otherwise another camera
    // rolling right now. Right-click it afterwards to swap the media.
    if (srcMon.clip && srcMon.clip.kind !== 'audio') {
      item = { type: 'clip', src: srcMon.clip.id, start: t, dur: Math.max(FRAME, Math.min(10000, srcMon.out - srcMon.in)), in: srcMon.in, tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fadeIn: 300, fadeOut: 300 };
      toast(`Picture-in-picture from the Source monitor: ${clipTitle(srcMon.clip)}. Right-click it to swap.`, 4000);
    } else {
      const abs = t + (seq.origin ?? 0);
      const onProg = S.itemAt(S.program(seq), t)?.src;
      const onCid = clipOf(onProg)?.cid;
      const c = videoClips().find((k) => k.cid !== onCid && abs >= k.t0 && abs < k.t0 + k.dur);
      if (!c) return toast('Load a clip in the Source monitor (click it in Media), or put the playhead where another camera was rolling');
      item = { type: 'clip', src: c.id, start: t, dur: Math.min(10000, c.t0 + c.dur - abs), in: abs - c.t0, tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fadeIn: 300, fadeOut: 300 };
      toast(`Picture-in-picture from camera ${angleNo(c.id)} (${c.name}). Right-click it to swap the media.`, 4000);
    }
  }
  snapshot();
  S.addOverlay(seq, item);
  commit();
  select(item.id);
  announce(`Added ${labelOf(item).text}`);
}
document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => addItem(b.dataset.add)));
$('#splitBtn').onclick = splitSelected;

$('#rebuildBtn').onclick = () => {
  if (!seq.auto && !confirm('Rebuild the Program track from your live cuts? Hand edits to the Program (not overlays) will be replaced.')) return;
  snapshot();
  seq.auto = true;
  rebuild();
  commit();
};

// Auto-cut in post: the same AI director, reading the quality each phone recorded
// with its clip (steady, level, exposed, right shape for the output).
$('#autoCutBtn').onclick = () => {
  const list = videoClips();
  if (!list.length) return toast('No clips to cut yet');
  if (cut.edl.length && !confirm('Replace your cuts with an automatic cut?')) return;
  snapshot();
  const start = Math.min(...list.map((c) => c.t0));
  const endT = Math.max(...list.map((c) => c.t0 + c.dur));
  const angles = list.map((c) => ({
    id: c.id, t0: c.t0 + media.range(c).in, dur: media.range(c).out - media.range(c).in, fixed: c.device === 'computer',
    scoreAt: (abs) => {
      const ms = abs - c.t0;
      const q = c.qa;
      if (!q?.length) return null;
      let lo = 0, hi = q.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (q[mid][0] <= ms) lo = mid;
        else hi = mid - 1;
      }
      const [, score, sh] = q[lo];
      return { score: score ?? 0.5, upright: sh === 'p' ? 'portrait' : sh === 'l' ? 'landscape' : orientAt(c, ms)?.upright };
    },
  }));
  const planned = planCuts(angles, start, endT, orientation);
  cut.edl = planned.map((p) => ({ t: p.t, clip: p.clip }));
  saveCut();
  seq.auto = true;
  rebuild(false);
  commit();
  const withQa = list.filter((c) => c.qa?.length).length;
  note(`Auto-cut: ${planned.length} cuts from ${withQa} of ${list.length} clips' quality logs`);
  toast(withQa ? `Auto-cut made ${planned.length} cuts, avoiding shaky, dark, or sideways moments.` : `Auto-cut made ${planned.length} cuts. (These clips have no quality log, so it cut for variety.)`, 6000);
};
