// Overdubbing: recording a take while the edit plays, one part at a time (guitar, then voice…).
// The pure parts, with no browser needed: where a take's sound lands on the timeline, the
// latency trim, measuring that latency from recorded clicks, the WAV file, and the take tracks.
//
// Clocks: the sound engine (AudioContext) counts frames. While a take records, the timeline runs
// on that clock: timeline t0 is engine time c0 (seconds), at rate 1. A captured frame carries the
// engine's frame number when it reached the page, which is later than the musician played it by
// the input's delay; and the musician played along to what they heard, which left the engine
// earlier than they heard it by the output's delay. Together that's the round-trip latency L:
// what was played along to timeline position p sits at engine frame (c(p) + L) · rate.

import { offsetBetween } from './audiosync.js';

/** The engine frame that holds what was played along to timeline position t. */
export const frameFor = ({ c0, t0, sr, latencyMs }, t) => Math.round((c0 + (t - t0) / 1000 + latencyMs / 1000) * sr);

/**
 * Cut a take out of the captured blocks ({ frame, L, R } from the recording tap, in order): from
 * timeline position `from` to `to`, latency taken off. Missing frames (before the tap started) are
 * silence. Keeps the channel with more in it (one microphone on an interface's second input still
 * records), or both when `stereo` and both have sound.
 * @returns {{ channels: Float32Array[], frames: number }}
 */
export function cutTake(blocks, clock, from, to, { stereo = false } = {}) {
  const f0 = frameFor(clock, from), f1 = frameFor(clock, to);
  const n = Math.max(0, f1 - f0);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const b of blocks) {
    const a = Math.max(f0, b.frame), z = Math.min(f1, b.frame + b.L.length);
    for (let f = a; f < z; f++) {
      L[f - f0] = b.L[f - b.frame];
      R[f - f0] = (b.R || b.L)[f - b.frame];
    }
  }
  const energy = (x) => {
    let s = 0;
    for (let i = 0; i < x.length; i += 8) s += x[i] * x[i];
    return s;
  };
  const eL = energy(L), eR = energy(R);
  if (stereo && eL > 0 && eR > 0 && !sameSignal(L, R)) return { channels: [L, R], frames: n };
  return { channels: [eR > eL * 1.5 ? R : L], frames: n };
}
function sameSignal(a, b) {
  for (let i = 0; i < a.length; i += 16) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

/** A WAV file (24-bit PCM) of one or two channels. */
export function encodeWav(channels, sr) {
  const nch = channels.length, n = channels[0].length, bps = 3;
  const data = n * nch * bps;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + data, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, 24, true);
  w(36, 'data'); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff) & 0xffffff;
      v.setUint8(o, x & 0xff); v.setUint8(o + 1, (x >> 8) & 0xff); v.setUint8(o + 2, (x >> 16) & 0xff);
      o += 3;
    }
  }
  return buf;
}

/** The loudest a take gets (0–1), to warn about one that clipped or caught nothing. */
export function peakOf(channels) {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

/** When to play the measuring clicks (seconds from the first): uneven gaps, so an echo can't pass for one. */
export const MEASURE_AT = [0, 0.37, 0.9, 1.31, 1.92, 2.39];

/**
 * The measuring click: 2 ms of noise, the same every time. Not the song's click, which is a short
 * tone: a tone matches itself a cycle early or late almost as well, so it can't be timed to the sample.
 */
export function burst(sr) {
  const n = Math.max(16, Math.round(sr * 0.002));
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 16807) % 2147483647;
    out[i] = ((seed / 2147483647) * 2 - 1) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return out;
}

/** The measuring clicks as sent: the burst at each of `frames`, in a stretch of n frames. */
export function burstTrain(frames, n, sr) {
  const b = burst(sr), out = new Float32Array(n);
  for (const f of frames) for (let i = 0; i < b.length && f + i < n; i++) if (f + i >= 0) out[f + i] += b[i];
  return out;
}

/**
 * The round-trip latency, from clicks played out and heard back by the microphone.
 * @param played  the clicks as sent (burstTrain at the frames they were scheduled), same length as heard
 * @param heard   what the microphone recorded over the same frames
 * @returns {{ ms, sure }} sure: the match stood clear of everything else (else measure again, louder)
 */
export function measureLatency(played, heard, sr, maxMs = 500) {
  const r = offsetBetween(played, heard, Math.round((maxMs / 1000) * sr));
  // heard[i] matches played[i + lag]: heard is late by -lag
  const ms = (-r.lag / sr) * 1000;
  return { ms: Math.round(ms * 10) / 10, sure: ms >= 0 && r.clarity > 1.6 && r.score > 8 };
}

/** The part names in an edit (the tracks of takes), in the order first recorded. */
export const partsOf = (seq) => [...new Set(seq.tracks.filter((t) => t.take).map((t) => t.take))];

/**
 * Put a take on the timeline, as a track of its own: "Guitar · take 2". A new take of a part
 * mutes the earlier ones (it replaces them) unless it's stacked (a double or a harmony: they
 * all play). The newest take of a part goes under its earlier ones.
 * @param o { part, src, start, dur, in, stack }
 * @returns the new track
 */
export function placeTake(seq, o) {
  const mine = seq.tracks.filter((t) => t.take === o.part);
  const n = Math.max(0, ...mine.map((t) => t.takeNo || 0)) + 1;
  if (!o.stack) for (const t of mine) t.muted = true;
  const id = 't-take-' + Math.random().toString(36).slice(2, 9);
  const tr = {
    id, kind: 'audio', name: `${o.part} · take ${n}`, take: o.part, takeNo: n, ...(o.stack ? { stack: true } : {}),
    items: [{ id: Math.random().toString(36).slice(2, 10), type: 'clip', src: o.src, start: o.start, dur: o.dur, in: o.in || 0 }],
    gain: 1, muted: false, mono: true,
  };
  const at = mine.length ? seq.tracks.indexOf(mine[mine.length - 1]) + 1 : seq.tracks.length;
  seq.tracks.splice(at, 0, tr);
  return tr;
}
