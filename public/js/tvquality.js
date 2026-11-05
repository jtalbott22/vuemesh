// What a TV says it's getting, and what the studio sends it: the arithmetic (display-hub.js uses
// it; Node tests it). A TV reports every few seconds how many frames it showed, froze, dropped.
// Falling behind (fewer than 80% of the frames sent it, a freeze, or more than 3% dropped), its picture's
// bitrate comes down by 30%, no more than every 10 s and not below MIN; steady for 30 s, it goes
// back up a quarter at a time, as far as where it started. So a TV on weak Wi-Fi gets a softer
// picture that keeps moving, instead of a sharp one that stops.

export const MIN_KBPS = 600;

/** A TV's link, from its first report: { cap (kbps), max, lastDown, goodSince }. */
export const tvLink = (max, now = Date.now()) => ({ cap: max, max, lastDown: 0, goodSince: now });

/** Was this report a TV falling behind? (fps it showed, frames it should have, freezes and drops in the period) */
export function behind(q, fps) {
  const want = (q.secs || 5) * fps;
  return (q.fps != null && q.fps < fps * 0.8) || (q.freezes || 0) > 0 || (q.dropped || 0) > want * 0.03;
}

/** The cap after a report: { cap, changed: 'down' | 'up' | null } (the link is updated). */
export function adapt(link, q, fps, now = Date.now()) {
  if (behind(q, fps)) {
    link.goodSince = now;
    if (now - link.lastDown < 10_000 || link.cap <= MIN_KBPS) return { cap: link.cap, changed: null };
    link.cap = Math.max(MIN_KBPS, Math.round(link.cap * 0.7));
    link.lastDown = now;
    return { cap: link.cap, changed: 'down' };
  }
  if (link.cap < link.max && now - link.goodSince >= 30_000) {
    link.cap = Math.min(link.max, Math.round(link.cap * 1.25));
    link.goodSince = now;
    return { cap: link.cap, changed: 'up' };
  }
  return { cap: link.cap, changed: null };
}
