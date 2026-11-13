// Faces on the cameras: who's in each shot, who's talking, and a camera operator's framing.
// Pure logic, no DOM, no model: the studio's face worker (faces-worker.js) finds the faces; this
// follows them from picture to picture, works out who's talking, keeps "Speaker 1, Speaker 2" the
// same people across cameras, and frames the shot on air. Tested in test/faces.test.mjs.
//
// No face recognition. Nothing here describes what a face looks like (no face print, no voice
// print), and nothing is kept but a number, a name if the host types one, and where each person
// was last seen in each camera's picture. Two cameras are taken to show the same person when that
// person's mouth moves in both, at the same moments, while someone is heard talking; a person who
// leaves a shot and comes back to the same place is taken as the same person.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clamp01 = (x) => clamp(x, 0, 1);

/** Overlap of two boxes {x, y, w, h}: 0 (apart) to 1 (the same). */
export function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - i;
  return u > 0 ? i / u : 0;
}

export const TRACK = {
  lostAfter: 1500, // ms unseen before a face is gone
  shownAfter: 2,   // seen this many times before it counts (one stray detection isn't a person)
  talkWin: 1200,   // ms of mouth movement looked at
  stillFor: 4000,  // a face that hasn't moved at all this long is a picture (a painting, a poster), not a person
};

/** A face that hasn't moved at all (well under a hundredth of the shot) for TRACK.stillFor: a picture of one. */
export function still(tr, t) {
  if (t - tr.born < TRACK.stillFor || tr.path.length < 6 || tr.path[0][0] > t - TRACK.stillFor + 600) return false;
  const xs = tr.path.map((p) => p[1]), ys = tr.path.map((p) => p[2]);
  return Math.max(...xs) - Math.min(...xs) < 0.006 && Math.max(...ys) - Math.min(...ys) < 0.006;
}

/**
 * One camera's faces, followed from picture to picture.
 * A face from the worker: { box: {x, y, w, h} (0..1 of the shot), eyes: {x, y}, mouth (0..1, open),
 * eyesOpen (0..1), yaw (-1 looking to the picture's left .. 1 to its right) }.
 */
export class FaceTracker {
  constructor() {
    this.tracks = [];
    this.next = 1;
  }

  /**
   * New faces seen at time t (ms), looking at `region` of the shot (all of it if none). A face
   * outside the region looked at isn't missing, just not looked at: it's kept as it was.
   * Returns the tracks that were lost.
   */
  update(t, faces, region = null) {
    if (region) {
      const inside = (tr) => { const cx = tr.box.x + tr.box.w / 2, cy = tr.box.y + tr.box.h / 2; return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h; };
      // (not one the whole shot was looked at for since it was last seen, and it wasn't there)
      for (const tr of this.tracks) if (!inside(tr) && !tr.missed) tr.seen = Math.max(tr.seen, t - 400);
    }
    const free = new Set(this.tracks);
    const pairs = [];
    for (const f of faces) {
      for (const tr of this.tracks) {
        const o = iou(f.box, tr.box);
        const d = Math.hypot(f.box.x + f.box.w / 2 - (tr.box.x + tr.box.w / 2), f.box.y + f.box.h / 2 - (tr.box.y + tr.box.h / 2));
        const near = d < Math.max(f.box.w, tr.box.w) * 0.6;
        if (o > 0.15 || near) pairs.push({ f, tr, s: o + (near ? 0.2 - d : 0) });
      }
    }
    pairs.sort((a, b) => b.s - a.s);
    const used = new Set();
    for (const { f, tr, s } of pairs) {
      if (used.has(f) || !free.has(tr) || s <= 0) continue;
      used.add(f);
      free.delete(tr);
      const a = 0.5; // (smoothed: a face box from a detector wobbles a little each picture)
      for (const k of ['x', 'y', 'w', 'h']) tr.box[k] += (f.box[k] - tr.box[k]) * a;
      tr.eyes = { x: tr.eyes.x + (f.eyes.x - tr.eyes.x) * a, y: tr.eyes.y + (f.eyes.y - tr.eyes.y) * a };
      // (a head from a pose says nothing of the mouth or eyes: what the face said last stands)
      Object.assign(tr, { eyesOpen: f.eyesOpen ?? tr.eyesOpen, yaw: tr.yaw + (f.yaw - tr.yaw) * a, seen: t, hits: tr.hits + 1, pose: !!f.pose, missed: false });
      tr.path.push([t, f.eyes.x, f.eyes.y]);
      if (f.mouth != null) tr.mouth.push([t, f.mouth]);
    }
    if (!region) for (const tr of free) tr.missed = true; // (the whole shot, and not in it)
    for (const f of faces) {
      if (used.has(f)) continue;
      this.tracks.push({ id: this.next++, box: { ...f.box }, eyes: { ...f.eyes }, eyesOpen: f.eyesOpen ?? 0.6, yaw: f.yaw, born: t, seen: t, hits: 1, mouth: f.mouth != null ? [[t, f.mouth]] : [], talkMs: 0, pose: !!f.pose, path: [[t, f.eyes.x, f.eyes.y]] });
    }
    for (const tr of this.tracks) {
      while (tr.mouth.length && tr.mouth[0][0] < t - TRACK.talkWin * 2) tr.mouth.shift();
      while (tr.path.length > 2 && tr.path[0][0] < t - TRACK.stillFor) tr.path.shift();
    }
    const lost = this.tracks.filter((tr) => t - tr.seen > TRACK.lostAfter);
    this.tracks = this.tracks.filter((tr) => t - tr.seen <= TRACK.lostAfter);
    return lost;
  }

  /** The faces in the shot now (not one in a picture on the wall). */
  visible(t) {
    return this.tracks.filter((tr) => tr.hits >= TRACK.shownAfter && t - tr.seen <= 1000 && !still(tr, t));
  }
}

/**
 * Where in a shot to look for faces next. The face finder sees each picture shrunk to about
 * 128 pixels, so a face that's small in a wide shot (across a room) isn't found in the whole
 * picture. With nobody found, it looks at the whole shot, then at parts of it in turn, the upper
 * parts first (faces are rarely at the bottom); with someone found, at a region around them,
 * and at the whole shot every few pictures for anyone new.
 */
export const TILES = (() => {
  const t = [];
  for (const [size, steps, rows] of [[0.5, [0, 0.25, 0.5], [0, 0.25]], [0.35, [0, 0.22, 0.44, 0.65], [0, 0.22, 0.44]]]) {
    for (const y of rows) for (const x of steps) t.push({ x, y, w: size, h: size });
  }
  return t;
})();
const FULL = { x: 0, y: 0, w: 1, h: 1 };
export class Search {
  constructor() {
    this.roi = null;    // a region around who was found
    this.roiAt = 0;     // when someone was last found
    this.last = null;   // where someone was found last (kept a while, to look there again)
    this.k = 0;
    this.n = 0;
  }

  /** The part of the shot (0..1) to look at now. */
  next(t) {
    this.n++;
    // someone found lately (a face looking down at a guitar comes and goes): around them, and
    // every fifth picture the whole shot, for anyone else
    if (this.roi && t - this.roiAt < 3000) return this.n % 5 === 0 ? FULL : this.roi;
    // nobody: the whole shot, where they were last (for 20 s), and the parts in turn
    const turn = this.n % 3;
    if (turn === 0) return FULL;
    if (turn === 1 && this.last && t - this.roiAt < 20_000) return this.last;
    return TILES[this.k++ % TILES.length];
  }

  /** What was found looking at `region` (faces in the shot's 0..1). */
  found(t, faces, region) {
    if (!faces.length) return;
    this.roiAt = t;
    const x0 = Math.min(...faces.map((f) => f.box.x)), x1 = Math.max(...faces.map((f) => f.box.x + f.box.w));
    const y0 = Math.min(...faces.map((f) => f.box.y)), y1 = Math.max(...faces.map((f) => f.box.y + f.box.h));
    // big enough in the whole shot: keep looking at all of it
    if (region.w === 1 && Math.min(...faces.map((f) => f.box.h)) >= 0.14) {
      this.roi = FULL;
      return;
    }
    // a region about four faces across, around them (more headroom below: shoulders, a guitar)
    const size = clamp(Math.max((y1 - y0) * 4, (x1 - x0) * 3), 0.3, 1);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2 + size * 0.1;
    this.roi = { x: clamp(cx - size / 2, 0, 1 - size), y: clamp(cy - size / 2, 0, 1 - size), w: size, h: size };
    this.last = this.roi;
  }
}

/**
 * Faces and heads (from poses) together: a head is kept only where no face was found, as a face
 * (it says where someone is; only a face says how their mouth and eyes are).
 */
export function mergeHeads(faces, heads = []) {
  const out = [...faces];
  for (const hd of heads) {
    const near = faces.some((f) => {
      const cx = f.box.x + f.box.w / 2, cy = f.box.y + f.box.h / 2;
      return iou(f.box, hd.box) > 0.15 || (cx > hd.box.x - hd.box.w * 0.3 && cx < hd.box.x + hd.box.w * 1.3 && cy > hd.box.y - hd.box.h * 0.3 && cy < hd.box.y + hd.box.h * 1.3);
    });
    if (!near) out.push(hd);
  }
  return out;
}

/** Faces found in a region (0..1 of it), as 0..1 of the whole shot. */
export function fromRegion(faces, r) {
  return faces.map((f) => ({ ...f, box: { x: r.x + f.box.x * r.w, y: r.y + f.box.y * r.h, w: f.box.w * r.w, h: f.box.h * r.h }, eyes: { x: r.x + f.eyes.x * r.w, y: r.y + f.eyes.y * r.h } }));
}

/**
 * How much a face's mouth is moving the way talking moves it: 0..1. Talking opens and closes the
 * jaw several times a second; a smile or an open mouth holds still. (The spread of how open the
 * mouth has been over the last second or so: the same at 3 pictures a second as at 10.)
 */
export function talkScore(tr, t) {
  // (a few sightings say little, their spread is mostly chance: at least five, from up to 2 s back
  // when the face is looked at less often, off air or coming and going)
  let m = tr.mouth.filter(([u]) => u >= t - TRACK.talkWin).map(([, v]) => v);
  if (m.length < 5) m = tr.mouth.filter(([u]) => u >= t - 2000).map(([, v]) => v);
  if (m.length < 5 || t - tr.seen > 1000) return 0;
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  const sd = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
  return clamp01((sd - 0.025) / 0.06);
}

/** How good a face is to cut to: looking towards the camera, eyes open, big enough to see. */
export function faceScore(tr) {
  const facing = 1 - Math.min(1, Math.abs(tr.yaw) * 1.4);
  const size = clamp01((tr.box.h - 0.06) / 0.14);
  return clamp01(0.5 * facing + 0.2 * clamp01(tr.eyesOpen * 1.5) + 0.3 * size);
}

export const SPEAKERS = {
  talkOn: 0.45,       // a mouth moving this much is talking
  pairMs: 2000,       // two cameras' faces talking together this long are the same person...
  pairAgree: 0.75,    // ...if they agree (both talking, or both not) this much of the time
  soloMs: 2600,       // a face talking this long, matched with no other camera, is a speaker of its own
  placeNear: 0.12,    // a face back within this distance of where someone was...
  placeFor: 120_000,  // ...this recently (ms), in the same camera, is them
  micMs: 3000,        // a microphone loud while one person's mouth moves, this long, is theirs
  changeMs: 700,      // someone else talking this long is the new speaker
  quietMs: 2500,      // nobody talking this long: nobody is the speaker
};

/**
 * Speaker 1, Speaker 2…: the people seen talking, across cameras, with names if the host gives them.
 * `observe()` every quarter-second or so with what each camera sees and whether talking is heard.
 */
export class Speakers {
  constructor(saved = null) {
    this.people = (saved?.people || []).map((p) => ({ n: p.n, name: p.name || '', last: { ...(p.last || {}) }, mic: null, seenAt: 0, talking: false }));
    this.nextN = saved?.nextN || this.people.reduce((m, p) => Math.max(m, p.n), 0) + 1;
    this.link = new Map();   // "cam|track" → person n
    this.pair = new Map();   // "a|b" (sorted keys) → { co, anti }
    this.micCo = new Map();  // mic → Map(n → ms)
    this.current = null;     // the speaker now (stays through a short pause)
    this.since = 0;          // when the current speaker began
    this.cand = null;        // { n, since }: someone else talking, not yet the speaker
    this.lastTalk = 0;
    this.talkNow = null;     // who's moving their mouth right now (no hold)
  }

  /** Who's person n. */
  get(n) { return this.people.find((p) => p.n === n) || null; }
  label(n) { const p = this.get(n); return p ? p.name || `Speaker ${p.n}` : ''; }
  rename(n, name) { const p = this.get(n); if (p) p.name = String(name || '').trim().slice(0, 40); }
  personOf(cam, trackId) { return this.link.get(cam + '|' + trackId) ?? null; }

  /** What to keep (for a reload): numbers, names, where each was last seen. */
  toJSON() { return { nextN: this.nextN, people: this.people.map((p) => ({ n: p.n, name: p.name, last: p.last })) }; }

  /** Forget everyone. */
  clear() {
    Object.assign(this, new Speakers());
  }

  /**
   * @param t ms
   * @param dt ms since the last call
   * @param cams [{ cam, place, tracks: [{ id, box, eyes, talk }] }]: place is a name for the camera
   *   that stays the same if it reconnects (where someone sits is remembered per place)
   * @param heard true when someone is heard talking (the sound is above the room's own noise)
   * @param mic the microphone that's loudest now (when one is), or null
   */
  observe(t, dt, cams, heard, mic = null) {
    const S = SPEAKERS;
    const key = (c, tr) => c.cam + '|' + tr.id;
    const live = new Set();
    for (const c of cams) for (const tr of c.tracks) live.add(key(c, tr));
    for (const k of [...this.link.keys()]) if (!live.has(k)) this.link.delete(k);
    for (const k of [...this.pair.keys()]) if (!k.split('#').every((x) => live.has(x))) this.pair.delete(k);

    // back where someone was: them (each person once per camera)
    for (const c of cams) {
      const taken = new Set(c.tracks.map((tr) => this.link.get(key(c, tr))).filter((n) => n != null));
      for (const tr of c.tracks) {
        if (this.link.has(key(c, tr))) continue;
        let best = null, bestD = S.placeNear;
        for (const p of this.people) {
          const at = p.last[c.place];
          if (!at || taken.has(p.n) || t - at.t > S.placeFor) continue;
          const d = Math.hypot(at.x - tr.eyes.x, at.y - tr.eyes.y);
          if (d < bestD) [best, bestD] = [p, d];
        }
        if (best) {
          this.link.set(key(c, tr), best.n);
          taken.add(best.n);
        }
      }
    }

    // who's talking, in each camera
    const talking = cams.map((c) => c.tracks.filter((tr) => tr.talk >= S.talkOn));
    for (const c of cams) for (const tr of c.tracks) tr.talkMs = heard && tr.talk >= S.talkOn ? (tr.talkMs || 0) + dt : Math.max(0, (tr.talkMs || 0) - dt / 2);

    if (heard) {
      // the same person in two cameras: their mouths move together
      for (let i = 0; i < cams.length; i++) {
        for (let j = i + 1; j < cams.length; j++) {
          for (const a of cams[i].tracks) {
            for (const b of cams[j].tracks) {
              const ta = a.talk >= S.talkOn, tb = b.talk >= S.talkOn;
              if (!ta && !tb) continue;
              // (only when it's clear who's talking in each: one face at a time)
              if ((ta && talking[i].length !== 1) || (tb && talking[j].length !== 1)) continue;
              const k = [key(cams[i], a), key(cams[j], b)].sort().join('#');
              const pr = this.pair.get(k) || { co: 0, anti: 0 };
              if (ta && tb) pr.co += dt;
              else pr.anti += dt;
              this.pair.set(k, pr);
              if (pr.co >= S.pairMs && pr.co / (pr.co + pr.anti) >= S.pairAgree) this.join(k.split('#'), t);
            }
          }
        }
      }
      // a face that's been talking a while on its own: a new speaker
      for (const c of cams) {
        for (const tr of c.tracks) {
          if (!this.link.has(key(c, tr)) && tr.talkMs >= S.soloMs) this.join([key(c, tr)], t);
        }
      }
    }

    // where each person is (for coming back), and whether they're talking
    for (const p of this.people) p.talking = false;
    let top = null, topTalk = 0;
    for (const c of cams) {
      for (const tr of c.tracks) {
        const n = this.link.get(key(c, tr));
        if (n == null) continue;
        const p = this.get(n);
        p.last[c.place] = { x: +tr.eyes.x.toFixed(3), y: +tr.eyes.y.toFixed(3), t };
        p.seenAt = t;
        if (heard && tr.talk >= S.talkOn) {
          p.talking = true;
          if (tr.talk > topTalk) [top, topTalk] = [n, tr.talk];
        }
      }
    }

    // a microphone that's loud while one person talks is theirs; then it says who's talking
    if (mic && heard) {
      const who = this.people.filter((p) => p.talking);
      if (who.length === 1) {
        const m = this.micCo.get(mic) || new Map();
        m.set(who[0].n, (m.get(who[0].n) || 0) + dt);
        this.micCo.set(mic, m);
        const [[n, ms], second] = [...m].sort((a, b) => b[1] - a[1]).concat([[null, 0]]);
        if (ms >= S.micMs && ms > 2 * (second?.[1] || 0)) {
          for (const p of this.people) if (p.mic === mic) p.mic = null;
          this.get(n).mic = mic;
        }
      }
      const owner = this.people.find((p) => p.mic === mic);
      if (owner) {
        top = owner.n;
        owner.talking = true;
      }
    }
    this.talkNow = top;

    // the speaker: held through short pauses, changed when someone else has talked a moment
    if (top != null) this.lastTalk = t;
    if (top == null) {
      this.cand = null;
      if (this.current != null && t - this.lastTalk > S.quietMs) this.current = null;
    } else if (top === this.current) this.cand = null;
    else {
      if (this.cand?.n !== top) this.cand = { n: top, since: t };
      if (this.current == null || t - this.cand.since >= S.changeMs) {
        this.since = this.cand.since;
        this.current = top;
        this.cand = null;
      }
    }
    return this.current;
  }

  /** Link these faces ("cam|track") as one person: someone they're already linked to, or someone new. */
  join(keys, t) {
    const ns = [...new Set(keys.map((k) => this.link.get(k)).filter((n) => n != null))].sort((a, b) => a - b);
    let n = ns[0];
    if (n == null) {
      n = this.nextN++;
      this.people.push({ n, name: '', last: {}, mic: null, seenAt: t, talking: false });
    }
    // (two numbers for one person: kept as the first; a name given to either is kept)
    for (const m of ns.slice(1)) {
      const a = this.get(n), b = this.get(m);
      if (!a.name && b.name) a.name = b.name;
      for (const [place, at] of Object.entries(b.last)) if (!a.last[place] || a.last[place].t < at.t) a.last[place] = at;
      a.mic ||= b.mic;
      this.people = this.people.filter((p) => p !== b);
      for (const [k, v] of this.link) if (v === m) this.link.set(k, n);
      if (this.current === m) this.current = n;
      if (m === this.nextN - 1) this.nextN--;
    }
    for (const k of keys) this.link.set(k, n);
    return n;
  }
}

// ---- framing: a camera operator's moves, on a crop of the shot ------------------------------
export const FRAME = {
  faceH: 0.3,      // one face: about this much of the frame's height (a medium close-up)
  eyeLine: 0.38,   // eyes this far down the frame
  lead: 0.1,       // room in front of a face looking to one side (of the frame's width)
  holdX: 0.07,     // the frame stays put while the subject is within this of where it'd go...
  holdY: 0.05,
  holdZoom: 0.12,  // ...and the size is within this
  panS: 0.7,       // seconds to most of the way there, moving
  zoomS: 1.4,      // seconds to most of the way there, zooming
  homeAfter: 2500, // ms with nobody in the shot before it eases back to the whole shot
};

/**
 * A crop of the shot that keeps its subject well framed, moving like a person on the camera would:
 * it holds still while the subject is near where they should be, then eases (no sudden jumps),
 * and snaps to the framing when the shot is cut to.
 */
export class Follow {
  constructor() {
    this.c = null;   // { x, y, z }: centre (0..1 of the shot) and zoom (1: the widest crop of the output's shape)
    this.goal = null;
    this.t = 0;
    this.lastSubject = 0;
  }

  /**
   * @param t ms
   * @param faces the faces to frame: [{ box, eyes, yaw }] (the speaker alone, or the group)
   * @param shotAspect the shot's width / height in pixels
   * @param outAspect the program's width / height
   * @param maxZoom how far in it may go (from the shot's own resolution: see shotRect in studio/faces.js)
   * @param snap true to go straight there (a cut)
   * @returns { x, y, w, h }: the crop, 0..1 of the shot
   */
  update(t, faces, shotAspect, outAspect, maxZoom = 1.5, snap = false) {
    const F = FRAME;
    // the widest crop of the program's shape that fits in the shot
    const baseW = shotAspect > outAspect ? outAspect / shotAspect : 1;
    const baseH = shotAspect > outAspect ? 1 : shotAspect / outAspect;
    const dt = this.t ? Math.min(0.5, (t - this.t) / 1000) : 0;
    this.t = t;
    let goal = null;
    if (faces.length) {
      this.lastSubject = t;
      const x0 = Math.min(...faces.map((f) => f.box.x)), x1 = Math.max(...faces.map((f) => f.box.x + f.box.w));
      const y0 = Math.min(...faces.map((f) => f.box.y)), y1 = Math.max(...faces.map((f) => f.box.y + f.box.h));
      const faceH = Math.max(...faces.map((f) => f.box.h));
      // how big: one face at faceH of the frame; a group with room around it
      let h = faces.length === 1 ? faceH / F.faceH : Math.max((y1 - y0) * 2.6, ((x1 - x0) * 1.5 * baseH) / baseW);
      h = clamp(h, baseH / maxZoom, baseH);
      const z = baseH / h, w = baseW / z;
      const eyesY = faces.reduce((a, f) => a + f.eyes.y, 0) / faces.length;
      const yaw = faces.length === 1 ? faces[0].yaw : 0;
      const x = (x0 + x1) / 2 + yaw * F.lead * w;
      const y = eyesY - F.eyeLine * h + h / 2;
      goal = { x: clamp(x, w / 2, 1 - w / 2), y: clamp(y, h / 2, 1 - h / 2), z };
    } else if (!this.c || t - this.lastSubject > F.homeAfter) goal = { x: 0.5, y: 0.5, z: 1 };
    if (goal) {
      // hold still while close enough: a frame that hunts after every small move is worse than none
      const g = this.goal;
      const w = baseW / (g?.z || 1), h = baseH / (g?.z || 1);
      const far = !g || Math.abs(goal.x - g.x) > F.holdX * w || Math.abs(goal.y - g.y) > F.holdY * h || Math.abs(goal.z / g.z - 1) > F.holdZoom;
      if (far) this.goal = goal;
    }
    const G = this.goal || { x: 0.5, y: 0.5, z: 1 };
    if (snap || !this.c) this.c = { ...G };
    else {
      // eased, like a fluid head: about 95% of the way in panS (zoomS) seconds
      const kp = 1 - Math.exp((-3 * dt) / F.panS), kz = 1 - Math.exp((-3 * dt) / F.zoomS);
      this.c.x += (G.x - this.c.x) * kp;
      this.c.y += (G.y - this.c.y) * kp;
      this.c.z += (G.z - this.c.z) * kz;
    }
    const z = clamp(this.c.z, 1, Math.max(1, maxZoom));
    const w = baseW / z, h = baseH / z;
    const x = clamp(this.c.x, w / 2, 1 - w / 2), y = clamp(this.c.y, h / 2, 1 - h / 2);
    return { x: x - w / 2, y: y - h / 2, w, h };
  }
}

/** A crop (0..1 of the shot) inside the shot's own part of the picture (0..1 of the frame). */
export function within(outer, inner) {
  const o = outer || { x: 0, y: 0, w: 1, h: 1 };
  return { x: o.x + inner.x * o.w, y: o.y + inner.y * o.h, w: inner.w * o.w, h: inner.h * o.h };
}
