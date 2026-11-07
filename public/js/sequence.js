// The edit, as data. Tracks are listed top-down: the topmost video track wins.
//
// seq = { v:2, origin, auto, tracks:[ {id, kind:'video'|'audio', name, items:[...], program?, follow?, hidden, gain, muted, mono} ] }
// item = { id, type:'clip'|'image'|'title'|'slate', start, dur, in?, src?, asset?, rect?, fit?, text?, sub?, style?, fadeIn?, fadeOut?, gain? }
// Times are milliseconds on the timeline; timeline 0 is `origin` on the event clock.

export const FRAME = 1000 / 30;
const uid = () => Math.random().toString(36).slice(2, 10);

export function newSequence() {
  return {
    v: 2,
    origin: null,
    auto: true,
    tracks: [
      { id: 't-ov1', kind: 'video', name: 'Overlay 1', items: [], hidden: false },
      { id: 't-prog', kind: 'video', name: 'Program', program: true, items: [], hidden: false },
      { id: 't-cam', kind: 'audio', name: 'Camera sound', follow: 't-prog', items: [], gain: 1, muted: false, mono: true },
    ],
  };
}

export const program = (seq) => seq.tracks.find((t) => t.program);
// A dissolve into a shot: item.transIn = { dur } (ms). For that long from the shot's start,
// the shot before it carries on underneath (past its own end, from its recording) while this
// one fades in over it, as a live dissolve does; camera sound crossfades the same way.
export const dissolveOf = (it) => (it?.type === 'clip' && it.transIn?.dur > 0 ? Math.min(it.transIn.dur, it.dur) : 0);
/** The shot right before an item on its track (ending where it starts), if there is one. */
export function heldBefore(tr, it) {
  return tr.items.find((o) => o !== it && o.type === 'clip' && Math.abs(o.start + o.dur - it.start) < FRAME) || null;
}
export const track = (seq, id) => seq.tracks.find((t) => t.id === id);
export const itemAt = (tr, t) => tr.items.find((it) => t >= it.start && t < it.start + it.dur);
export const sortItems = (tr) => tr.items.sort((a, b) => a.start - b.start);

export function end(seq) {
  let e = 0;
  for (const tr of seq.tracks) for (const it of tr.items) e = Math.max(e, it.start + it.dur);
  return e;
}

export function findItem(seq, id) {
  for (const tr of seq.tracks) {
    const it = tr.items.find((x) => x.id === id);
    if (it) return { track: tr, item: it };
  }
  return null;
}

/** Items the audio engine should hear. Follow tracks mirror the clips of the video track they follow. */
/** Where a microphone recording is playing: merged [start, end) spans in timeline ms. */
export function micCover(seq) {
  const spans = [];
  for (const t of seq.tracks) {
    if (!t.mic || t.muted || (t.gain ?? 1) <= 0) continue;
    for (const it of t.items) if (it.type === 'clip' && (it.gain ?? 1) > 0) spans.push([it.start, it.start + it.dur]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}
export function audioItems(seq, tr) {
  if (tr.follow) {
    // the pictures' sound, crossfading through each dissolve: the shot going out carries on
    // under the one coming in for the dissolve's length
    const src = track(seq, tr.follow);
    const clips = (src?.items || []).filter((it) => it.type === 'clip');
    return clips.map((it) => {
      const next = clips.find((o) => o !== it && dissolveOf(o) && Math.abs(it.start + it.dur - o.start) < FRAME);
      const xOut = next ? dissolveOf(next) : 0, xIn = dissolveOf(it) && heldBefore(src, it) ? dissolveOf(it) : 0;
      return { ...it, id: 'f-' + it.id, followOf: it.id, dur: it.dur + xOut, ...(xIn ? { xfIn: xIn } : {}), ...(xOut ? { xfOut: xOut } : {}) };
    });
  }
  return tr.items;
}

/**
 * Rebuild the Program track (and microphone tracks) from the multicam cut log.
 * @param edl   resolved cuts [{t, clip}] on the event clock; {t, missing: true} is a cut to a
 *              camera whose recording isn't here (yet, or at all)
 * @param clips all clip records ({id, t0, dur, kind, cid, name})
 * @param fills the program as aired ({id, t0, dur}): where a cut's camera has no footage (a phone
 *              still sending its clip, a source nothing recorded), Edit shows what aired there,
 *              not black. When the real clip arrives, the next rebuild uses it instead.
 */
export function rebuildFromCuts(seq, edl, clips, fills = []) {
  const videos = clips.filter((c) => c.kind !== 'audio');
  const audios = clips.filter((c) => c.kind === 'audio');
  if (!clips.length && !fills.length) return seq;
  // The edit spans the cameras' own recordings, as it did: the program as aired only fills inside
  // it, or past it when the show began or ended on a source with no footage (then it moves).
  const own = clips.length ? clips : fills;
  seq.origin = Math.min(...own.map((c) => c.t0));
  const endT = Math.max(...own.map((c) => c.t0 + c.dur));
  const fillEnd = fills.length ? Math.max(endT, ...fills.map((c) => c.t0 + c.dur)) : endT;
  const prog = program(seq);
  prog.items = [];
  let cuts = edl.slice().sort((a, b) => a.t - b.t);
  if (!cuts.some((e) => !e.missing) && videos.length) {
    // No cuts yet: use the longest angle so there's always something to watch.
    const longest = videos.slice().sort((a, b) => b.dur - a.dur)[0];
    cuts = [{ t: longest.t0, clip: longest.id }];
  }
  // A cut can land a moment before that phone's recording actually began; it takes
  // effect when the clip starts, and the previous shot holds until then (no black gap).
  const eff = cuts.map((e) => {
    if (e.slate) return e.t < endT ? { slate: e.slate, t: e.t } : null; // (a break in the show)
    if (e.black) return e.t < endT ? { black: true, fade: e.fade || 0, t: e.t } : null; // (to black)
    // (no footage of that camera: what aired fills it; with nothing to fill it, the shot before holds as it did)
    if (e.missing) return fills.length && e.t < fillEnd ? { miss: true, t: e.t, x: e.dissolve || 0 } : null;
    const c = videos.find((k) => k.id === e.clip);
    return c ? { c, t: Math.max(e.t, c.t0), x: e.dissolve || 0, fadeIn: e.fadeIn || 0 } : null;
  }).filter(Boolean);
  // the program as aired, from a to b (on the cameras' clock), where it was recording
  const fillIn = (a, b, first) => {
    for (const f of fills.slice().sort((x, y) => x.t0 - y.t0)) {
      const s = Math.max(a, f.t0), t = Math.min(b, f.t0 + f.dur);
      if (t - s < FRAME) continue;
      const it = { id: uid(), type: 'clip', src: f.id, start: s - seq.origin, dur: t - s, in: s - f.t0 + (f.inBase || 0), fill: true };
      if (first && s === first.t && first.x >= FRAME && prog.items.length) it.transIn = { dur: Math.min(4000, Math.round(first.x)) };
      prog.items.push(it);
    }
  };
  eff.forEach((e, i) => {
    const end = eff[i + 1]?.t ?? (e.miss ? fillEnd : endT);
    if (e.miss) return fillIn(e.t, end, e);
    // Black: nothing on air until the next cut; a fade to black fades the shot before it out.
    if (e.black) {
      const last = prog.items[prog.items.length - 1];
      if (e.fade >= FRAME && last && Math.abs(last.start + last.dur - (e.t - seq.origin)) < 1000) last.fadeOut = Math.min(e.fade, last.dur);
      return;
    }
    // A break in the show is its own item: the break slate, drawn here at full quality (what
    // it said, its look, the clock as it was), to keep or delete like any other.
    if (e.slate) {
      if (end - e.t < FRAME) return;
      const text = e.slate.message || "We'll be right back", last = prog.items[prog.items.length - 1];
      // (one break that flickered on and off is one item)
      if (last?.type === 'slate' && last.fromLive && last.text === text && last.look === e.slate.look && Math.abs(last.start + last.dur - (e.t - seq.origin)) < 1000) last.dur = end - seq.origin - last.start;
      else prog.items.push({ id: uid(), type: 'slate', text, look: e.slate.look, start: e.t - seq.origin, dur: end - e.t, fromLive: true });
      return;
    }
    // Stay on this camera until the next cut. If its phone rolled to a new clip (it was
    // turned, or changed lens), follow it into that clip from the moment it starts; and if it
    // stopped recording and started again while still on air (a break, a second take), pick
    // it up again where it did. What aired in between (and after its recording stopped, while
    // it was still on air) comes from the program as aired, when there is one; without one, the
    // time between is a gap, which Collapse gaps takes out.
    let a = e.t, c = e.c;
    while (c && a < end) {
      const next = videos
        .filter((k) => k !== c && k.cid && k.cid === c.cid && k.t0 > c.t0 && k.t0 < end && k.t0 + k.dur > a)
        .sort((x, y) => x.t0 - y.t0)[0];
      const b = Math.min(end, c.t0 + c.dur, next ? Math.max(a, next.t0) : Infinity);
      if (b - a >= FRAME) {
        const it = { id: uid(), type: 'clip', src: c.id, start: a - seq.origin, dur: b - a, in: a - c.t0 + (c.inBase || 0) };
        if (e.fadeIn >= FRAME && a === e.t) it.fadeIn = Math.min(e.fadeIn, it.dur); // (it faded up from black)
        // a dissolve live is a dissolve here (on the first piece of that shot, if one came before)
        if (e.x >= FRAME && a === e.t && prog.items.length) it.transIn = { dur: Math.min(4000, Math.round(e.x)) };
        prog.items.push(it);
      }
      if (!next || b >= end) {
        if (b < end) fillIn(b, end); // (its recording stopped while it was still on air)
        break;
      }
      a = Math.max(b, next.t0);
      if (a > b) fillIn(b, a); // (between two of its recordings)
      c = next;
    }
  });
  // (the show began on a source with no footage: the edit starts with what aired there)
  const lo = Math.min(0, ...prog.items.map((it) => it.start));
  if (lo < 0) {
    for (const it of prog.items) it.start -= lo;
    seq.origin += lo;
  }
  // One audio track per microphone phone, its pieces laid where they were recorded.
  const mics = [...new Set(audios.map((c) => c.cid))];
  seq.tracks = seq.tracks.filter((t) => !t.mic || mics.includes(t.mic));
  for (const cid of mics) {
    let tr = seq.tracks.find((t) => t.mic === cid);
    if (!tr) {
      const name = audios.find((c) => c.cid === cid)?.name || 'Guest';
      tr = { id: 't-mic-' + cid, kind: 'audio', name: `Mic · ${name}`, mic: cid, items: [], gain: 1, muted: false, mono: true };
      // a dedicated microphone goes first, and camera sound steps aside wherever it's playing
      const firstAudio = seq.tracks.findIndex((t) => t.kind === 'audio');
      seq.tracks.splice(firstAudio < 0 ? seq.tracks.length : firstAudio, 0, tr);
      const cam = seq.tracks.find((t) => t.follow);
      if (cam && !cam.touched) cam.duck = true;
    }
    tr.items = audios.filter((c) => c.cid === cid).sort((a, b) => a.t0 - b.t0)
      .map((c) => ({ id: uid(), type: 'clip', src: c.id, start: c.t0 - seq.origin, dur: c.dur, in: c.inBase || 0 }));
  }
  // Camera sound used to go silent for the whole film once a microphone joined, so anything
  // the microphone didn't cover had no sound at all. Now it ducks: quiet only while a
  // microphone recording plays. (Edits saved that way are moved over, unless you'd set it.)
  const camTr = seq.tracks.find((t) => t.follow);
  if (camTr && mics.length && !camTr.touched && camTr.gain === 0) Object.assign(camTr, { gain: 1, duck: true });
  // Every Program item gets a single shape: slice where a phone turned.
  const wasLocked = prog.locked;
  prog.locked = false;
  splitAtOrientation(seq, (id) => (videos.find((c) => c.id === id) || fills.find((c) => c.id === id))?.orient, [prog.id]);
  prog.locked = wasLocked;
  seq.liveTail = endT; // (how far the live footage reaches, on the cameras' clock: see appendLive)
  return seq;
}

/**
 * Live footage that came in after the timeline was edited by hand (trims, Collapse gaps...):
 * the live cut's pictures, and microphone sound, for the time after the last footage already
 * placed (seq.liveTail) go on the end of the timeline, after a gap as long as the real time
 * between them, so Collapse gaps can take it out again. Hand edits stay as they are.
 * Returns { from, to, gap, at } (cameras' clock, and where it went), or null if nothing new.
 */
export function appendLive(seq, edl, clips, fills = []) {
  const tail = seq.liveTail ?? (seq.origin != null ? seq.origin + end(seq) : -Infinity);
  const fresh = newSequence();
  rebuildFromCuts(fresh, edl, clips, fills);
  if (fresh.origin == null) return null;
  const picks = [];
  for (const tr of fresh.tracks) {
    if (!tr.program && !tr.mic) continue;
    for (const it of tr.items) {
      const a = it.start + fresh.origin, b = a + it.dur;
      if (b <= tail + FRAME) continue;
      const skip = Math.max(0, tail - a); // (a piece that started before the tail: only what's new)
      if (b - (a + skip) < FRAME) continue;
      picks.push({ tr, it, a: a + skip, b, skip });
    }
  }
  if (!picks.length) return null;
  const first = Math.min(...picks.map((p) => p.a)), last = Math.max(...picks.map((p) => p.b));
  const gap = Number.isFinite(tail) ? Math.max(0, first - tail) : 0;
  const at = end(seq) > 0 ? end(seq) + gap : 0;
  for (const p of picks) {
    let tr = track(seq, p.tr.id) || (p.tr.mic && seq.tracks.find((t) => t.mic === p.tr.mic));
    if (!tr) {
      tr = { ...p.tr, items: [] };
      const firstAudio = seq.tracks.findIndex((t) => t.kind === 'audio');
      seq.tracks.splice(firstAudio < 0 ? seq.tracks.length : firstAudio, 0, tr);
    }
    const added = { ...p.it, id: uid(), start: at + (p.a - first), dur: p.b - p.a, in: (p.it.in || 0) + p.skip * rate(p.it) };
    if (p.skip || p.a === first) delete added.transIn; // (nothing before it on the end to dissolve from)
    tr.items.push(added);
    sortItems(tr);
  }
  seq.liveTail = last;
  return { from: first, to: last, gap, at };
}

/** Cut the Program to another angle at time t (the multicam number keys, once the edit is hand-made). */
export function cutProgramAt(seq, t, clip) {
  const prog = program(seq);
  const srcAt = t + seq.origin - clip.t0; // where that angle is at this moment
  if (srcAt < 0 || srcAt >= clip.dur) return false;
  const cur = itemAt(prog, t);
  const clipEnd = clip.t0 + clip.dur - seq.origin;
  if (!cur) {
    const next = prog.items.filter((it) => it.start > t).sort((a, b) => a.start - b.start)[0];
    const until = Math.min(next ? next.start : clipEnd, clipEnd);
    prog.items.push({ id: uid(), type: 'clip', src: clip.id, start: t, dur: until - t, in: srcAt });
    sortItems(prog);
    return true;
  }
  const curEnd = cur.start + cur.dur;
  let right;
  if (t - cur.start < FRAME) right = cur; // cutting at an item's very start: just change its angle
  else {
    right = { ...cur, id: uid(), start: t, dur: curEnd - t, in: (cur.in || 0) + (t - cur.start) * rate(cur) };
    cur.dur = t - cur.start;
    prog.items.push(right);
  }
  right.src = clip.id;
  right.type = 'clip';
  right.in = srcAt;
  right.dur = Math.min(curEnd, clipEnd) - right.start;
  sortItems(prog);
  return true;
}

export function splitAt(seq, itemId, t) {
  const f = findItem(seq, itemId);
  if (!f || f.track.locked) return null;
  const { track: tr, item } = f;
  if (t - item.start < FRAME || item.start + item.dur - t < FRAME) return null;
  const right = { ...item, id: uid(), start: t, dur: item.start + item.dur - t, fadeIn: 0 };
  delete right.transIn;
  if (item.in != null) right.in = item.in + (t - item.start) * rate(item);
  item.dur = t - item.start;
  item.fadeOut = 0;
  tr.items.push(right);
  sortItems(tr);
  return right;
}

/** Free space around an item on its track: [lo, hi] it may occupy. */
function room(tr, item) {
  let lo = -Infinity, hi = Infinity;
  for (const o of tr.items) {
    if (o === item) continue;
    if (o.start + o.dur <= item.start + 1) lo = Math.max(lo, o.start + o.dur);
    else if (o.start >= item.start + item.dur - 1) hi = Math.min(hi, o.start);
  }
  return [lo, hi];
}

/**
 * Trim an edge to time t. Clips can't be trimmed past their source media.
 * @param srcDur length of the underlying media (Infinity for stills and titles)
 */
export function trim(seq, itemId, edge, t, srcDur = Infinity) {
  const f = findItem(seq, itemId);
  if (!f) return;
  const { track: tr, item } = f;
  if (tr.locked) return;
  const [lo, hi] = room(tr, item);
  if (edge === 'start') {
    const endT = item.start + item.dur;
    let ns = Math.min(t, endT - FRAME);
    ns = Math.max(ns, lo, 0);
    if (item.in != null) ns = Math.max(ns, item.start - item.in / rate(item)); // can't go before the media starts
    const d = ns - item.start;
    item.start = ns;
    item.dur -= d;
    if (item.in != null) item.in += d * rate(item);
  } else {
    let ne = Math.max(t, item.start + FRAME);
    ne = Math.min(ne, hi);
    if (item.in != null) ne = Math.min(ne, item.start + (srcDur - item.in));
    item.dur = ne - item.start;
  }
}

/** Move an item to a new start (and optionally another track of the same kind). Returns false if it won't fit. */
export function move(seq, itemId, start, toTrackId) {
  const f = findItem(seq, itemId);
  if (!f) return false;
  const dest = toTrackId ? track(seq, toTrackId) : f.track;
  if (!dest || dest.kind !== f.track.kind || dest.follow || dest.locked || f.track.locked) return false;
  const s = Math.max(0, start);
  const clash = dest.items.some((o) => o !== f.item && s < o.start + o.dur && o.start < s + f.item.dur);
  if (clash) return false;
  if (dest !== f.track) {
    f.track.items = f.track.items.filter((x) => x !== f.item);
    dest.items.push(f.item);
  }
  f.item.start = s;
  sortItems(dest);
  return true;
}

export function remove(seq, itemId) {
  for (const tr of seq.tracks) if (!tr.locked) tr.items = tr.items.filter((x) => x.id !== itemId);
}

/** Put a new item on the topmost video overlay track that has room, adding a track if needed. */
export function addOverlay(seq, item) {
  item.id ||= uid();
  const overlays = seq.tracks.filter((t) => t.kind === 'video' && !t.program);
  for (const tr of overlays) {
    if (!tr.items.some((o) => item.start < o.start + o.dur && o.start < item.start + item.dur)) {
      tr.items.push(item);
      sortItems(tr);
      return tr;
    }
  }
  const tr = { id: 't-' + uid(), kind: 'video', name: `Overlay ${overlays.length + 1}`, items: [item], hidden: false };
  seq.tracks.unshift(tr);
  return tr;
}

export function addTrack(seq, kind) {
  const n = seq.tracks.filter((t) => t.kind === kind).length + 1;
  const tr = kind === 'video'
    ? { id: 't-' + uid(), kind, name: `Overlay ${n}`, items: [], hidden: false }
    : { id: 't-' + uid(), kind, name: `Audio ${n}`, items: [], gain: 1, muted: false, mono: true };
  if (kind === 'video') seq.tracks.unshift(tr);
  else seq.tracks.push(tr);
  return tr;
}

/** Move a track up (-1) or down (+1) among tracks of its kind. The Program can move too. */
export function reorder(seq, trackId, dir) {
  const i = seq.tracks.findIndex((t) => t.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= seq.tracks.length) return false;
  if (seq.tracks[j].kind !== seq.tracks[i].kind) return false;
  [seq.tracks[i], seq.tracks[j]] = [seq.tracks[j], seq.tracks[i]];
  return true;
}

export function removeTrack(seq, trackId) {
  const tr = track(seq, trackId);
  if (!tr || tr.program || tr.follow) return false;
  seq.tracks = seq.tracks.filter((t) => t !== tr);
  return true;
}

export const clone = (seq) => JSON.parse(JSON.stringify(seq));

// ------------------------------------------------- Premiere-style editing ---
// Ripple, roll, slip, slide, ripple delete, add edit, markers, edit points.
// Locked tracks are never changed. When an edit ripples, every other unlocked
// track shifts too, so overlays stay in sync with the Program.

const editable = (tr) => !tr.locked && !tr.follow;

/** Shift everything at or after `from` by `delta` on each unlocked track that has room. */
function ripple(seq, from, delta, except) {
  for (const tr of seq.tracks) {
    if (!editable(tr)) continue;
    const later = tr.items.filter((it) => it !== except && it.start >= from - 1);
    if (!later.length) continue;
    if (delta < 0) {
      // don't slide anything into an item that sits across the gap
      const before = tr.items.filter((it) => it !== except && !later.includes(it));
      const limit = Math.max(0, ...before.map((it) => it.start + it.dur));
      const first = Math.min(...later.map((it) => it.start));
      if (first + delta < limit - 1) continue;
    }
    for (const it of later) it.start += delta;
  }
}

/** Ripple trim: change one edge and close (or open) the gap after it on every track. */
export function rippleTrim(seq, itemId, edge, t, srcDur = Infinity) {
  const f = findItem(seq, itemId);
  if (!f || !editable(f.track)) return false;
  const { item } = f;
  const oldEnd = item.start + item.dur;
  if (edge === 'end') {
    let ne = Math.max(t, item.start + FRAME);
    if (item.in != null) ne = Math.min(ne, item.start + (srcDur - item.in));
    const delta = ne - oldEnd;
    if (Math.abs(delta) < 1) return false;
    ripple(seq, oldEnd, delta, item);
    item.dur += delta;
  } else {
    // In-point ripple: the item stays where it starts, its content and everything after move.
    let d = t - item.start; // positive = trim off the head
    d = Math.min(d, item.dur - FRAME);
    if (item.in != null) d = Math.max(d, -item.in / rate(item));
    if (Math.abs(d) < 1) return false;
    if (item.in != null) item.in += d * rate(item);
    item.dur -= d;
    ripple(seq, oldEnd, -d, item);
  }
  sortAll(seq);
  return true;
}

/** Roll edit: move the cut between two touching items; the total length doesn't change. */
export function rollEdit(seq, leftId, rightId, t, srcDurOf = () => Infinity) {
  const L = findItem(seq, leftId), R = findItem(seq, rightId);
  if (!L || !R || L.track !== R.track || !editable(L.track)) return false;
  const left = L.item, right = R.item;
  const old = right.start;
  let nt = Math.max(t, left.start + FRAME);
  nt = Math.min(nt, right.start + right.dur - FRAME);
  if (left.in != null) nt = Math.min(nt, left.start + (srcDurOf(left) - left.in));
  if (right.in != null) nt = Math.max(nt, right.start - right.in);
  const d = nt - old;
  if (Math.abs(d) < 1) return false;
  left.dur += d;
  right.start += d;
  right.dur -= d;
  if (right.in != null) right.in += d * rate(right);
  return true;
}

/** Slip: keep the item where it is on the timeline but show a different part of its media. */
export function slip(seq, itemId, delta, srcDur = Infinity) {
  const f = findItem(seq, itemId);
  if (!f || !editable(f.track) || f.item.in == null) return false;
  // (delta is timeline time; at another speed the clip covers dur × speed of its source)
  const max = Math.max(0, srcDur - f.item.dur * rate(f.item));
  f.item.in = Math.min(max, Math.max(0, f.item.in + delta * rate(f.item)));
  return true;
}

/** Slide: move the item between its neighbours, which trim to keep the track gap-free. */
export function slide(seq, itemId, delta, srcDurOf = () => Infinity) {
  const f = findItem(seq, itemId);
  if (!f || !editable(f.track)) return false;
  const { track: tr, item } = f;
  const L = tr.items.find((o) => o !== item && Math.abs(o.start + o.dur - item.start) < 2);
  const R = tr.items.find((o) => o !== item && Math.abs(o.start - (item.start + item.dur)) < 2);
  let d = delta;
  if (L) {
    d = Math.max(d, FRAME - L.dur);
    if (L.in != null) d = Math.min(d, srcDurOf(L) - L.in - L.dur);
  } else {
    const [lo] = room(tr, item);
    d = Math.max(d, Math.max(0, lo === -Infinity ? 0 : lo) - item.start);
  }
  if (R) {
    d = Math.min(d, R.dur - FRAME);
    if (R.in != null) d = Math.max(d, -R.in);
  } else {
    const [, hi] = room(tr, item);
    if (hi !== Infinity) d = Math.min(d, hi - (item.start + item.dur));
  }
  if (Math.abs(d) < 1) return false;
  item.start += d;
  if (L) L.dur += d;
  if (R) {
    R.start += d;
    R.dur -= d;
    if (R.in != null) R.in += d * rate(R);
  }
  return true;
}

/** Ripple delete: remove the item and pull everything after it back. */
export function rippleDelete(seq, itemId) {
  const f = findItem(seq, itemId);
  if (!f || !editable(f.track)) return false;
  const { track: tr, item } = f;
  tr.items = tr.items.filter((x) => x !== item);
  ripple(seq, item.start + item.dur, -item.dur, null);
  sortAll(seq);
  return true;
}

/** Add edit (Ctrl/⌘ K): cut every unlocked track's item under the playhead. */
export function addEdit(seq, t, trackIds = null) {
  let n = 0;
  for (const tr of seq.tracks) {
    if (!editable(tr) || (trackIds && !trackIds.includes(tr.id))) continue;
    const it = itemAt(tr, t);
    if (it && splitAt(seq, it.id, t)) n++;
  }
  return n;
}

/** Every cut point and marker, for jumping with ↑ / ↓. */
export function editPoints(seq) {
  const pts = new Set([0]);
  for (const tr of seq.tracks) for (const it of tr.items) pts.add(Math.round(it.start)), pts.add(Math.round(it.start + it.dur));
  for (const m of seq.markers || []) pts.add(Math.round(m.t));
  return [...pts].sort((a, b) => a - b);
}

export function addMarker(seq, t, name = '') {
  seq.markers ||= [];
  if (seq.markers.some((m) => Math.abs(m.t - t) < FRAME)) return null;
  const m = { id: uid(), t, name };
  seq.markers.push(m);
  seq.markers.sort((a, b) => a.t - b.t);
  return m;
}

/**
 * Slice clips where the phone changed orientation, so every item has one shape.
 * @param orientOf (clipId) => [{t: seconds into the clip, upright}]
 */
export function splitAtOrientation(seq, orientOf, trackIds = null) {
  let n = 0;
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' || !editable(tr) || (trackIds && !trackIds.includes(tr.id))) continue;
    for (const it of tr.items.slice()) {
      if (it.type !== 'clip') continue;
      const log = orientOf(it.src) || [];
      // The range this item covered before any cuts; each cut lands in whichever piece holds that moment.
      const lo = it.in || 0, hi = lo + it.dur, src = it.src;
      for (const e of log) {
        const ms = e.t * 1000;
        if (ms <= lo + FRAME || ms >= hi - FRAME) continue;
        const piece = tr.items.find((x) => x.src === src && (x.in || 0) + FRAME < ms && (x.in || 0) + x.dur * rate(x) - FRAME > ms);
        if (piece && splitAt(seq, piece.id, piece.start + (ms - (piece.in || 0)) / rate(piece))) n++;
      }
    }
  }
  return n;
}

// ------------------------------------------------- source → timeline -------
// Premiere's two ways of putting source footage on the timeline:
//   Overwrite (.)  replaces whatever is on the target track for that stretch
//   Insert (,)     opens a gap at the playhead on every unlocked track and drops it in

/** Clear [t, t+dur) on one track, cutting items that cross the edges. */
function clearRange(seq, tr, t, dur) {
  const end = t + dur;
  for (const it of tr.items.slice()) {
    const a = it.start, b = it.start + it.dur;
    if (b <= t + 1 || a >= end - 1) continue;
    if (a < t && b > end) {
      // spans the whole range: split around it
      const right = { ...it, id: uid(), start: end, dur: b - end, fadeIn: 0 };
      if (it.in != null) right.in = it.in + (end - a) * rate(it);
      it.dur = t - a;
      tr.items.push(right);
    } else if (a < t) it.dur = t - a;
    else if (b > end) {
      const cut = end - a;
      it.start = end;
      it.dur -= cut;
      if (it.in != null) it.in += cut * rate(it);
    } else tr.items = tr.items.filter((x) => x !== it);
  }
}

export function overwrite(seq, trackId, t, item) {
  const tr = track(seq, trackId);
  if (!tr || !editable(tr)) return null;
  const it = { ...item, id: item.id || uid(), start: t };
  clearRange(seq, tr, t, it.dur);
  tr.items.push(it);
  sortItems(tr);
  return it;
}

export function insertAt(seq, trackId, t, item) {
  const tr = track(seq, trackId);
  if (!tr || !editable(tr)) return null;
  for (const k of seq.tracks) {
    if (!editable(k)) continue;
    const under = itemAt(k, t);
    if (under && t - under.start >= FRAME) splitAt(seq, under.id, t);
  }
  for (const k of seq.tracks) if (editable(k)) for (const it of k.items) if (it.start >= t - 1) it.start += item.dur;
  const it = { ...item, id: item.id || uid(), start: t };
  tr.items.push(it);
  sortAll(seq);
  return it;
}

/** Remove every use of a source (when its recording is deleted). Returns how many items went. */
export function removeSource(seq, src) {
  let n = 0;
  for (const tr of seq.tracks) {
    const before = tr.items.length;
    tr.items = tr.items.filter((it) => it.src !== src);
    n += before - tr.items.length;
  }
  return n;
}

function sortAll(seq) {
  for (const tr of seq.tracks) sortItems(tr);
}

// ---- speed ---------------------------------------------------------------------------------
/** How fast a clip plays (1 = normal; 0.5 = half speed, twice as long on the timeline). */
export const rate = (it) => it.speed || 1;
/** The moment in the source shown at timeline time t. */
export const srcAt = (it, t) => (it.in || 0) + (t - it.start) * rate(it);

/** Play a clip faster or slower: same content, stretched or squeezed (up to the next clip). */
export function setSpeed(seq, id, speed) {
  const f = findItem(seq, id);
  if (!f || !(speed > 0)) return null;
  const it = f.item;
  const span = it.dur * rate(it); // how much of the source it shows
  let dur = span / speed;
  const next = f.track.items.filter((x) => x !== it && x.start >= it.start + 1).sort((a, b) => a.start - b.start)[0];
  const capped = next && it.start + dur > next.start;
  if (capped) dur = next.start - it.start;
  if (speed === 1) delete it.speed;
  else it.speed = speed;
  it.dur = Math.max(FRAME, dur);
  return { capped: !!capped };
}

// ---- ranges: export part of the timeline, take out empty time ----------------------------

/** Keep the parts of an item outside [a, b) (or inside it, for slices), with the source offset right. */
function cutItem(it, s, e) {
  const cut = s - it.start;
  return {
    ...it, start: s, dur: e - s,
    ...(it.type === 'clip' ? { in: (it.in || 0) + cut * rate(it) } : {}),
    ...(cut > 0 ? { fadeIn: 0 } : {}),
    ...(e < it.start + it.dur ? { fadeOut: 0 } : {}),
  };
}

/** Just the part of the timeline between a and b, as a new sequence starting at zero (for exporting In to Out). */
export function sliceRange(seq, a, b) {
  const out = JSON.parse(JSON.stringify(seq));
  for (const tr of out.tracks) {
    tr.items = tr.items
      .filter((it) => it.start < b && it.start + it.dur > a)
      .map((it) => {
        const p = cutItem(it, Math.max(it.start, a), Math.min(it.start + it.dur, b));
        return { ...p, start: p.start - a };
      });
  }
  out.markers = (out.markers || []).filter((m) => m.t >= a && m.t < b).map((m) => ({ ...m, t: m.t - a }));
  delete out.range;
  if (out.origin != null) out.origin += a;
  return out;
}

/** Take the time between a and b out of every track, pulling everything after it left. */
export function extractRange(seq, a, b) {
  const d = b - a;
  if (d <= 0) return;
  for (const tr of seq.tracks) {
    const out = [];
    for (const it of tr.items) {
      const s = it.start, e = it.start + it.dur;
      if (e <= a) out.push(it);
      else if (s >= b) out.push({ ...it, start: s - d });
      else {
        if (s < a) out.push(cutItem(it, s, a));
        if (e > b) out.push({ ...cutItem(it, b, e), id: s < a ? uid() : it.id, start: a });
      }
    }
    tr.items = out;
  }
  seq.markers = (seq.markers || []).filter((m) => m.t < a || m.t >= b).map((m) => (m.t >= b ? { ...m, t: m.t - d } : m));
  if (seq.range) {
    const shift = (t) => (t >= b ? t - d : t > a ? a : t);
    seq.range = { in: shift(seq.range.in), out: shift(seq.range.out) };
    if (seq.range.out - seq.range.in < FRAME) delete seq.range;
  }
}

/** Stretches where no video track shows anything (from the start of the timeline to its end). */
export function videoGaps(seq) {
  const spans = seq.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.items.map((it) => [it.start, it.start + it.dur])).sort((x, y) => x[0] - y[0]);
  const gaps = [];
  let covered = 0;
  for (const [s, e] of spans) {
    if (s > covered + 0.5) gaps.push({ start: covered, end: s });
    covered = Math.max(covered, e);
  }
  return gaps;
}

/** Remove every stretch where no camera was recording, on all tracks at once (so sound stays in sync). */
export function collapseGaps(seq, minGap = FRAME) {
  const gaps = videoGaps(seq).filter((g) => g.end - g.start >= minGap);
  for (const g of gaps.slice().reverse()) extractRange(seq, g.start, g.end);
  return gaps;
}
