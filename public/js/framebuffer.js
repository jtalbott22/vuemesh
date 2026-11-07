// A camera's frames and a microphone's sound, kept a moment, each with its time (studio/picsync.js).
//
// FrameBuffer reads a camera's track itself (MediaStreamTrackProcessor), not a video element,
// so it goes on while the studio is hidden behind a slideshow (a hidden page's video elements
// stop showing new frames). Each frame is copied (so the camera's own buffers go straight back
// to it: holding them can stall a camera) and kept for a fraction of a second, with its
// capture stamp and arrival time, and how different it is from the one before (for the sync
// check). SoundTap keeps the last few seconds of a microphone at 16 kHz, timed on the page's clock.

import { WindowMin } from '/js/framesync.js';

const THUMB_W = 32, THUMB_H = 18;

export class FrameBuffer {
  /**
   * @param {MediaStreamTrack} track  a live camera (or screen) track of its own (a clone): stop() stops it
   * @param {object} [o]
   * @param {() => {w:number, h:number}} [o.size]  the program's size (frames are kept at most this big)
   * @param {'low'|'medium'|'high'} [o.quality]  how smoothly a frame bigger than that is shrunk
   */
  constructor(track, o = {}) {
    this.track = track;
    this.size = o.size || (() => ({ w: 1920, h: 1080 }));
    this.quality = o.quality || 'medium';
    this.frames = []; // { ts, arr, bmp } oldest first
    this.series = []; // { ts, arr, change } for the last 15 s (the sync check)
    this.lagMin = new WindowMin(5000);
    this.over = []; // how far each recent frame came after the quickest delivery (ms)
    this.keepMs = 600;
    this.count = 0; // frames taken
    this.lastArr = 0;
    this.prevLuma = null;
    this.stopped = false;
    this.watching = false; // (the sync check sets it: see take)
    this.thumb = new OffscreenCanvas(THUMB_W, THUMB_H).getContext('2d', { willReadFrequently: true });
    this.run();
  }

  /** The least time from capture stamp to arrival (ms), and how much more a frame usually takes (90th percentile). */
  get lag() {
    return this.lagMin.value;
  }
  get spread() {
    if (!this.over.length) return 0;
    const s = [...this.over].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.9)];
  }

  async run() {
    let reader;
    try {
      reader = new MediaStreamTrackProcessor({ track: this.track, maxBufferSize: 2 }).readable.getReader();
    } catch (e) {
      this.error = e;
      return;
    }
    this.reader = reader;
    while (!this.stopped) {
      let r;
      try {
        r = await reader.read();
      } catch {
        break;
      }
      if (r.done) break;
      const f = r.value;
      const arr = performance.now(), ts = f.timestamp / 1000;
      let bmp = null;
      try {
        const { w, h } = this.size();
        const fw = f.displayWidth, fh = f.displayHeight;
        const k = Math.min(1, Math.max(w, h) / Math.max(fw, fh));
        bmp = await createImageBitmap(f, k < 1 ? { resizeWidth: Math.round(fw * k), resizeHeight: Math.round(fh * k), resizeQuality: this.quality } : {});
      } catch {
        bmp = null;
      } finally {
        f.close();
      }
      if (!bmp || this.stopped) {
        bmp?.close();
        continue;
      }
      this.take(ts, arr, bmp);
    }
  }

  take(ts, arr, bmp) {
    this.count++;
    this.lastArr = arr;
    this.lagMin.push(arr, arr - ts);
    this.over.push(arr - ts - this.lagMin.value);
    if (this.over.length > 150) this.over.shift();
    // how different from the frame before (the sync check looks for the sharpest one): only
    // while it's watching, as reading a picture back from the graphics card costs the page
    let change = 0;
    if (this.watching) try {
      this.thumb.drawImage(bmp, 0, 0, THUMB_W, THUMB_H);
      const d = this.thumb.getImageData(0, 0, THUMB_W, THUMB_H).data;
      const luma = new Float32Array(THUMB_W * THUMB_H);
      for (let i = 0, j = 0; j < luma.length; i += 4, j++) luma[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (this.prevLuma) {
        let s = 0;
        for (let j = 0; j < luma.length; j++) s += Math.abs(luma[j] - this.prevLuma[j]);
        change = s / luma.length;
      }
      this.prevLuma = luma;
    } catch {}
    if (this.watching) this.series.push({ ts, arr, change });
    else this.prevLuma = null;
    while (this.series.length && this.series[0].arr < arr - 15000) this.series.shift();
    this.frames.push({ ts, arr, bmp });
    while (this.frames.length > 2 && this.frames[1].arr < arr - this.keepMs) this.frames.shift().bmp.close();
  }

  /** Nothing new for this long (ms): the camera has stopped sending. */
  silentFor(now = performance.now()) {
    return this.lastArr ? now - this.lastArr : Infinity;
  }

  stop() {
    this.stopped = true;
    this.reader?.cancel().catch(() => {});
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
    this.track?.stop(); // (its own copy of the camera's track: left open, it kept the camera open after the camera left the show)
  }
}

export const TAP_RATE = 16000;

export class SoundTap {
  /** @param {MediaStreamTrack} track  a live microphone track; keeps the last `keepS` seconds */
  constructor(track, keepS = 12) {
    this.track = track;
    this.keepS = keepS;
    this.chunks = []; // { t0 (ms, page clock), data: Float32Array at TAP_RATE }
    this.lagMin = new WindowMin(5000);
    this.stopped = false;
    this.run();
  }
  /** Least time from a block's stamp to its arrival (ms): how long the sound takes to get here, at best. */
  get lag() {
    return this.lagMin.value ?? 0;
  }
  async run() {
    let reader;
    try {
      reader = new MediaStreamTrackProcessor({ track: this.track }).readable.getReader();
    } catch (e) {
      this.error = e;
      return;
    }
    this.reader = reader;
    while (!this.stopped) {
      let r;
      try {
        r = await reader.read();
      } catch {
        break;
      }
      if (r.done) break;
      const ad = r.value;
      try {
        const arr = performance.now(), t0 = ad.timestamp / 1000;
        this.lagMin.push(arr, arr - t0);
        const n = ad.numberOfFrames, rate = ad.sampleRate;
        const mono = new Float32Array(n);
        const tmp = new Float32Array(n);
        const ch = ad.numberOfChannels;
        for (let c = 0; c < ch; c++) {
          ad.copyTo(tmp, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < n; i++) mono[i] += tmp[i] / ch;
        }
        // to 16 kHz (linear between samples: enough for timing)
        const m = Math.floor((n * TAP_RATE) / rate);
        const out = new Float32Array(m);
        const step = rate / TAP_RATE;
        for (let i = 0; i < m; i++) {
          const x = i * step, k = Math.floor(x), fr = x - k;
          out[i] = mono[k] * (1 - fr) + (mono[Math.min(n - 1, k + 1)] || 0) * fr;
        }
        this.chunks.push({ t0, data: out });
        while (this.chunks.length && this.chunks[0].t0 < t0 - this.keepS * 1000) this.chunks.shift();
      } catch {
      } finally {
        ad.close();
      }
    }
  }
  /** The sound from `from` to `to` (ms, page clock) at TAP_RATE; gaps are silence. */
  slice(from, to) {
    const n = Math.max(0, Math.round(((to - from) * TAP_RATE) / 1000));
    const out = new Float32Array(n);
    for (const c of this.chunks) {
      const at = Math.round(((c.t0 - from) * TAP_RATE) / 1000);
      for (let i = Math.max(0, -at); i < c.data.length && at + i < n; i++) out[at + i] = c.data[i];
    }
    return out;
  }
  get newest() {
    const c = this.chunks.at(-1);
    return c ? c.t0 + (c.data.length * 1000) / TAP_RATE : null;
  }
  stop() {
    this.stopped = true;
    this.reader?.cancel().catch(() => {});
    this.track?.stop(); // (its own copy of the track, as a FrameBuffer's)
  }
}
