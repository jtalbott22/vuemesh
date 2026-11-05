// Keeping every camera and microphone on one timeline: the arithmetic, with no page in it
// (studio/picsync.js uses it; Node tests it).
//
// Each camera plugged into the studio computer takes its own time to get a picture in (its
// sensor and compression, then USB and decoding). Cut from a quick camera to a slow one and the
// program jumps back in time; line the program up with another recording and it holds for one
// camera, not the next. So every camera is held back to one delay, the program's picture delay
// (P): the picture on air at time T shows what happened at T - P, whichever camera it is. The
// sound from this computer waits P too, so it stays with the pictures.
//
// Times: the page's clock (performance.now, ms). A camera frame carries its capture time on
// the browser's own capture clock, which is the same for every camera here but offset from the
// page's by an unknown constant; so for each camera we keep `lag`, the least time between a
// frame's capture stamp and its arrival here (that offset plus its quickest delivery), and its
// `latency`, how long after the moment itself a frame arrives at best. Then the moment a frame
// shows is   ts + lag - latency   on the page's clock. latency starts at a usual figure for a
// USB camera and the sync check (a clap) measures it; it's kept per camera.

export const DEFAULT_LATENCY = 70; // ms: a USB webcam, sensor to arrival, at best (measured by the sync check)
export const MARGIN = 1.0; // frames of slack in P, so a frame a little late is still in time

/** A running least value over the last `ms` (a camera's quickest delivery, ignoring hiccups). */
export class WindowMin {
  constructor(ms = 5000) {
    this.ms = ms;
    this.q = []; // [t, v], increasing v
  }
  push(t, v) {
    while (this.q.length && this.q.at(-1)[1] >= v) this.q.pop();
    this.q.push([t, v]);
    while (this.q.length && this.q[0][0] < t - this.ms) this.q.shift();
  }
  get value() {
    return this.q.length ? this.q[0][1] : null;
  }
}

/**
 * The program's picture delay from each camera's latency and how much its delivery varies:
 * P covers the slowest camera with a frame of slack. It goes up at once when a camera needs
 * more (so nothing runs late), and comes down only when asked (between shows), so a show's
 * timing never moves under it.
 */
export class PictureDelay {
  constructor({ fps = 30, margin = MARGIN, floor = 0 } = {}) {
    Object.assign(this, { fps, margin, floor });
    this.P = null;
  }
  /** need: for each camera, latency + its delivery spread (ms). Returns { P, raised } */
  update(need) {
    const want = Math.round(Math.max(this.floor, ...need, 0) + (this.margin * 1000) / this.fps);
    if (this.P == null || want > this.P) {
      const raised = this.P != null;
      this.P = want;
      return { P: this.P, raised };
    }
    return { P: this.P, raised: false };
  }
  /** Between shows: settle back to what the cameras need now. */
  reset(need) {
    this.P = null;
    return this.update(need);
  }
}

/** The moment (page clock, ms) a camera frame shows. */
export const momentOf = (tsMs, lag, latency) => tsMs + lag - latency;

/**
 * From a camera's frames (oldest first, each { moment }), the one to put on air at `target`
 * (the moment the program should show): the newest no later than it. If the camera has nothing
 * that old yet, its oldest; if it has stopped sending (nothing within `stallMs` of target), its
 * newest, held, and stalled is true.
 */
export function pick(frames, target, stallMs = 400) {
  if (!frames.length) return { frame: null, stalled: true, late: 0 };
  let f = null;
  for (const x of frames) {
    if (x.moment <= target) f = x;
    else break;
  }
  const newest = frames.at(-1);
  if (!f) return { frame: frames[0], stalled: false, late: frames[0].moment - target };
  return { frame: f, stalled: target - newest.moment > stallMs, late: 0 };
}

// ---- the sync check: a clap (or anything sharp you can see and hear) ----

/**
 * When the sound had its sharpest attack: the time (ms) of the biggest jump in short-term
 * energy. samples at `rate`, the first at t0 (ms). Returns { t, strength } (strength: that jump
 * against the median one; a clap is many times it).
 */
export function soundOnset(samples, rate, t0, winMs = 5) {
  const win = Math.max(1, Math.round((rate * winMs) / 1000));
  const e = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let s = 0;
    for (let j = i; j < i + win; j++) s += samples[j] * samples[j];
    e.push(Math.sqrt(s / win));
  }
  let best = -1, at = 0;
  const rises = [];
  for (let k = 1; k < e.length; k++) {
    const r = e[k] - Math.max(e[k - 1], k > 1 ? e[k - 2] : 0);
    rises.push(Math.max(0, r));
    if (r > best) {
      best = r;
      at = k;
    }
  }
  const sorted = [...rises].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  // the attack's start: back to where the energy began to climb from the floor before it
  const floor = e.slice(Math.max(0, at - 20), at).reduce((a, b) => Math.min(a, b), Infinity);
  let k = at;
  while (k > 0 && e[k - 1] > floor + (e[at] - floor) * 0.1) k--;
  return { t: t0 + (k * win * 1000) / rate, strength: best / Math.max(med, 1e-6) };
}

/**
 * When a camera saw it: the frame with the most change from the one before (hands meeting,
 * a flash) within ±`within` ms of `near`. series: [{ moment, change }] oldest first; the change
 * belongs between that frame and the one before, so the time is their midpoint. Returns
 * { t, strength } (strength: that change against the median), or null.
 */
export function pictureOnset(series, near, within = 1000) {
  let best = null, prev = null;
  const changes = [];
  for (const x of series) {
    if (prev && Math.abs(x.moment - near) <= within) {
      changes.push(x.change);
      if (!best || x.change > best.change) best = { change: x.change, t: (x.moment + prev.moment) / 2 };
    }
    prev = x;
  }
  if (!best) return null;
  const sorted = changes.sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  return { t: best.t, strength: best.change / Math.max(med, 1e-6) };
}

/**
 * A camera's latency from the sync check: it saw the clap at `seen` (its moments worked out
 * with its old latency `was`) and it was heard at `heard` (both page clock): the picture was
 * really (seen - heard) later than thought.
 */
export const latencyFromCheck = (was, seen, heard) => Math.round(was + (seen - heard));
