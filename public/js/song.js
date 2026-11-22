// Song mode: a tempo and a meter under the edit, so the song is the clock.
//
// seq.song = { on, bpm, beats, at, click, countIn }
//   bpm      beats a minute
//   beats    beats in a bar (4 for 4/4, 3 for 3/4, 6 for 6/8 counted in eighths)
//   at       where bar 1 starts on the timeline (ms)
//   click    play a click while the edit plays
//   countIn  bars of click before recording starts
// Bars and beats count from 1, as musicians do. Times are timeline milliseconds.

export const SONG_DEFAULT = { on: false, bpm: 120, beats: 4, at: 0, click: false, countIn: 1 };
export const BPM_MIN = 30, BPM_MAX = 300;
export const METERS = [2, 3, 4, 5, 6, 7];

/** The song settings of an edit, with defaults filled in and kept in range. */
export function songOf(seq) {
  const s = { ...SONG_DEFAULT, ...(seq?.song || {}) };
  s.bpm = clampBpm(s.bpm);
  s.beats = Math.round(Math.min(12, Math.max(1, Number(s.beats) || 4)));
  s.at = Math.max(0, Number(s.at) || 0);
  s.countIn = Math.round(Math.min(4, Math.max(0, Number(s.countIn) || 0)));
  return s;
}

export const clampBpm = (b) => Math.round(Math.min(BPM_MAX, Math.max(BPM_MIN, Number(b) || SONG_DEFAULT.bpm)) * 10) / 10;
export const beatMs = (s) => 60000 / s.bpm;
export const barMs = (s) => beatMs(s) * s.beats;

/** Where t falls: bar and beat from 1, and how far into the beat (0–1). Before bar 1, the bar is 0 or less. */
export function posAt(s, t) {
  const n = (t - s.at) / beatMs(s); // beats since bar 1
  const whole = Math.floor(n + 1e-9);
  const bar = Math.floor(whole / s.beats) + 1;
  const beat = whole - (bar - 1) * s.beats + 1;
  return { bar, beat, frac: Math.max(0, n - whole) };
}

/** "12.3": bar 12, beat 3. */
export const fmtPos = (s, t) => {
  const p = posAt(s, t);
  return `${p.bar}.${p.beat}`;
};

/** The timeline time of a bar and beat (both from 1). */
export const timeOf = (s, bar, beat = 1) => s.at + ((bar - 1) * s.beats + (beat - 1)) * beatMs(s);

/** The beat nearest t (on the grid, never before 0). */
export function nearestBeat(s, t) {
  const b = beatMs(s);
  let g = s.at + Math.round((t - s.at) / b) * b;
  while (g < 0) g += b;
  return g;
}

/**
 * Grid lines for the ruler between a and b, as dense as px (pixels a second) allows:
 * every beat when beats are at least minPx apart, otherwise every bar, or every 2nd, 4th… bar.
 * Each line: { t, bar, beat, down } (down: the first beat of a bar, which is labelled).
 */
export function gridLines(s, a, b, px, minPx = 14) {
  const beatPx = (beatMs(s) / 1000) * px;
  const out = [];
  if (beatPx >= minPx) {
    for (let k = Math.ceil((Math.max(a, 0) - s.at) / beatMs(s) - 1e-9); ; k++) {
      const t = s.at + k * beatMs(s);
      if (t > b + 1e-6) break;
      if (t < 0) continue;
      const p = posAt(s, t);
      out.push({ t, bar: p.bar, beat: p.beat, down: p.beat === 1 });
    }
    return out;
  }
  let every = 1;
  while ((barMs(s) / 1000) * px * every < minPx * 2.5) every *= 2;
  const first = Math.ceil((Math.max(a, 0) - s.at) / barMs(s) / every - 1e-9) * every;
  for (let k = first; ; k += every) {
    const t = s.at + k * barMs(s);
    if (t > b + 1e-6) break;
    if (t >= 0) out.push({ t, bar: k + 1, beat: 1, down: true });
  }
  return out;
}

/** The clicks to sound from a up to (not including) b: [{ t, accent }], accent on each bar's first beat. Times may be before 0 (a count-in). */
export function clicks(s, a, b) {
  const bm = beatMs(s);
  const out = [];
  for (let k = Math.ceil((a - s.at) / bm - 1e-9); ; k++) {
    const t = s.at + k * bm;
    if (t >= b) break;
    out.push({ t, accent: ((k % s.beats) + s.beats) % s.beats === 0 });
  }
  return out;
}

/** Where a count-in starts, for recording from `from`: `countIn` whole bars before the next downbeat at or after it. */
export function countInStart(s, from) {
  if (!s.countIn) return from;
  const bm = barMs(s);
  const down = s.at + Math.ceil((from - s.at) / bm - 1e-9) * bm;
  return down - s.countIn * bm;
}

/**
 * Tempo from taps (performance.now() times). Uses the latest run of taps that keep a steady
 * pace (a gap over 2 s starts again), and the median gap, so one late tap doesn't throw it.
 * Returns null until there are at least 3 taps.
 */
export function tapTempo(taps) {
  const run = [];
  for (let i = taps.length - 1; i >= 0; i--) {
    if (run.length && run[0] - taps[i] > 2000) break;
    run.unshift(taps[i]);
  }
  if (run.length < 3) return null;
  const gaps = run.slice(1).map((t, i) => t - run[i]).sort((x, y) => x - y);
  const mid = gaps.length >> 1;
  const g = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return clampBpm(Math.round(60000 / g));
}
