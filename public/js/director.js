// The AI technical director. Pure logic, no DOM, so it runs the same live and in post.
//
// Each phone measures its own shot a couple of times a second and reports "parts",
// each 0..1 where 1 is good:
//   steady   gyroscope: not shaking
//   level    gravity: not pointed at the floor or the ceiling
//   pan      compass: not whipping around
//   calm     picture: not a blur of motion
//   exposure picture: not black, not blown out
//   detail   picture: not blank, covered, or out of focus
// The studio adds `orient`: does the shot's shape match the output?

const v = (x) => (x == null ? 1 : x);

/** One number for a shot, before orientation. Black or blank frames gate everything to ~0. */
export function baseScore(p) {
  const gate = Math.min(v(p.exposure), v(p.detail));
  const comfort = 0.4 * v(p.steady) + 0.25 * v(p.level) + 0.2 * v(p.pan) + 0.15 * v(p.calm);
  return clamp01(gate * comfort);
}

/**
 * Final score: a shot in the wrong shape still works (cropped or with bars), but less well.
 * A fixed camera (a computer's webcam) can't be turned, so it isn't marked down as hard
 * as a phone someone is simply holding the wrong way.
 */
export function shotScore(base, upright, output, fixed = false) {
  return clamp01(base * (upright && output && upright !== output ? (fixed ? 0.8 : 0.6) : 1));
}

const PROBLEMS = {
  steady: 'shaking',
  level: 'pointed at the floor or ceiling',
  pan: 'panning fast',
  calm: 'blurry with motion',
  exposure: 'too dark or too bright',
  detail: 'blank or covered',
};

/** Plain words for what's wrong with a shot (or null if nothing much). */
export function whatsWrong(p, upright, output, fixed = false) {
  const worst = Object.keys(PROBLEMS).map((k) => [k, v(p?.[k])]).sort((a, b) => a[1] - b[1])[0];
  if (upright && output && upright !== output) {
    if (!worst || worst[1] > 0.5) return fixed ? `a ${upright} camera in a ${output} film` : `held ${upright}`;
  }
  return worst && worst[1] < 0.5 ? PROBLEMS[worst[0]] : null;
}

/**
 * A coaching line for the person behind the camera. On a computer (`fixed`), there's no
 * point asking anyone to turn the camera.
 */
export function hintFor(p, upright, output, luma, { fixed = false } = {}) {
  if (v(p.exposure) < 0.3) return luma != null && luma > 128 ? 'Too bright: avoid pointing at the lights' : 'Too dark: find some light';
  if (v(p.detail) < 0.3) return 'Is the lens covered?';
  // Orientation advice only for phones; motion advice (below) only ever comes from a real
  // gyro or compass, so a computer without one never sees it, and a 2-in-1 with one still does.
  if (!fixed && upright && output && upright !== output) return output === 'landscape' ? 'Turn your phone sideways' : 'Hold your phone upright';
  if (v(p.level) < 0.4) return 'Point the camera at the action';
  if (v(p.steady) < 0.4) return 'Hold steady';
  if (v(p.pan) < 0.4) return 'Pan more slowly';
  return null;
}

export const DEFAULTS = {
  minHold: 3000,   // never cut faster than this unless the shot goes bad
  maxHold: 12000,  // after this, move on if there's anything comparable
  badBelow: 0.35,  // a shot this bad...
  badFor: 700,     // ...for this long gets cut away from
  margin: 0.12,    // a better shot must beat the current one by this much...
  betterFor: 1500, // ...steadily, for this long (scores are noisy; no twitchy cuts)
  goodAbove: 0.75, // a shot this good is fine on air: it isn't cut away from just because another is better
  breakBelow: 0.2, // if nothing is above this, go to the break slate
};

export class Director {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.current = null;
    this.since = 0;
    this.badSince = null;
    this.better = null; // {id, since}: a candidate that has been clearly better
    this.lastOn = new Map();
  }

  /** Tell the director what's on air (after a manual cut, say). */
  set(id, now) {
    if (id === this.current) return;
    if (this.current) this.lastOn.set(this.current, now);
    this.current = id;
    this.since = now;
    this.badSince = null;
    this.better = null;
  }

  /**
   * @param now ms
   * @param sources [{id, score, parts?, upright?}]
   * @returns {{cut?:string, reason?:string, breakOn?:boolean}}
   */
  step(now, sources, output) {
    const o = this.o;
    const usable = sources.filter((s) => s.score >= o.breakBelow);
    if (!usable.length) return { breakOn: true, reason: 'No camera is usable right now' };
    const cur = sources.find((s) => s.id === this.current);
    const curScore = cur ? cur.score : -1;
    if (cur && curScore < o.badBelow) this.badSince ??= now;
    else this.badSince = null;
    const variety = (id) => Math.min(0.1, ((now - (this.lastOn.get(id) ?? now - 60000)) / 60000) * 0.1);
    const ranked = usable
      .filter((s) => s.id !== this.current)
      .map((s) => ({ ...s, adj: s.score + variety(s.id) }))
      .sort((a, b) => b.adj - a.adj);
    let best = ranked[0];
    const held = now - this.since;
    // For variety: any good shot (or one about as good as what's on air), the one off air longest
    // first. Not just one that scores as well: a phone that measures itself near-perfect would
    // otherwise hold the air for good against cameras and screens that score a little lower.
    const offFor = (id) => now - (this.lastOn.get(id) ?? -Infinity);
    const fresh = ranked
      .filter((s) => s.score >= o.goodAbove || s.score >= curScore - 0.05)
      .sort((a, b) => offFor(b.id) - offFor(a.id) || b.score - a.score)[0];
    let reason = null;
    if (!cur) reason = best ? 'Starting on the best shot' : null;
    else if (best && this.badSince !== null && now - this.badSince >= o.badFor && best.score > curScore) {
      reason = `Cut away: on-air camera is ${whatsWrong(cur.parts, cur.upright, output, cur.fixed) || 'struggling'}`;
    } else if (fresh && held >= o.maxHold) {
      best = fresh;
      reason = 'Changing angle for variety';
    } else if (best && held >= o.minHold && curScore < o.goodAbove && best.adj > curScore + o.margin) {
      if (this.better?.id !== best.id) this.better = { id: best.id, since: now };
      if (now - this.better.since >= o.betterFor) {
        // say what's wrong when the shot on air has gone bad, not just that another is better
        reason = curScore < o.badBelow ? `Cut away: on-air camera is ${whatsWrong(cur.parts, cur.upright, output, cur.fixed) || 'struggling'}` : 'A better shot is available';
      }
    }
    if (!(best && best.adj > curScore + o.margin)) this.better = null;
    if (!reason || !best) return { breakOn: false };
    this.set(best.id, now);
    return { cut: best.id, reason, breakOn: false };
  }
}

/**
 * Plan a whole cut after the fact from each clip's recorded quality log.
 * @param angles [{id, t0, dur, scoreAt(absMs)->{score, parts, upright}|null}]
 * @returns [{t, clip, reason}]
 */
export function planCuts(angles, start, end, output, opts = {}) {
  const d = new Director({ maxHold: 9000, ...opts });
  const cuts = [];
  for (let t = start; t < end; t += 250) {
    const sources = [];
    for (const a of angles) {
      if (t < a.t0 || t >= a.t0 + a.dur) continue;
      const q = a.scoreAt(t);
      sources.push({ id: a.id, score: q ? shotScore(q.score, q.upright, output, a.fixed) : 0.5, parts: q?.parts, upright: q?.upright, fixed: a.fixed });
    }
    if (!sources.length) {
      d.current = null;
      continue;
    }
    if (!sources.some((s) => s.id === d.current)) d.current = null;
    const r = d.step(t, sources, output);
    if (r.cut) cuts.push({ t, clip: r.cut, reason: r.reason });
  }
  return cuts;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
