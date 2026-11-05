// Record program as a standard MP4 at a steady frame rate.
//
// The browser's own recorder (MediaRecorder) stamps each frame with the time it happened to
// arrive, so a busy or hidden studio makes a file at a frame rate of its own (a class came out at
// 26.11), and its MP4 is fragmented with no index, which Windows' player can't scrub. This one
// encodes the program itself: one frame for every output frame the studio's clock says is due
// (a frame the studio was too late to draw is the same picture again, so time is kept), each
// stamped n / fps, with the live mix as AAC, into a normal MP4 with its index at the end.
// It writes to this browser's private file storage as it goes, not to memory, so a long show
// doesn't fill it. Nothing here is studio-specific: give it a canvas, a sound track, a rate.

import { renderSupport, mp4Timescale } from '/js/render.js';

const DIR = 'program-recordings';

/** What this browser can write a program recording with, or null (then use MediaRecorder). */
export async function programRecorderSupport(W, H, fps) {
  if (!window.MediaStreamTrackProcessor || !window.Mp4Muxer || !navigator.storage?.getDirectory) return null;
  if (!('createWritable' in (window.FileSystemFileHandle?.prototype || {}))) return null;
  const s = await renderSupport(W, H, Math.round(fps)).catch(() => null);
  return s?.video && s.audio ? s : null;
}

/** Program recordings left in this browser's file storage from before (kept a day, then removed). */
export async function tidyProgramRecordings(keepMs = 86400_000) {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== 'file') continue;
      const f = await h.getFile().catch(() => null);
      if (f && Date.now() - f.lastModified > keepMs) await dir.removeEntry(name).catch(() => {});
    }
  } catch {}
}

export class ProgramRecorder {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas  the program, drawn before each frame()
   * @param {MediaStreamTrack} o.audioTrack  the live mix
   * @param {number} o.fps  24, 25, 29.97, 30, 50, 60
   * @param {object} o.support  from programRecorderSupport()
   * @param {string} o.name  the file's name
   * @param {number} [o.sampleRate]  the sound's rate (the sound engine's), if the track doesn't say
   * @param {(e:Error)=>void} [o.onError]  the encoder failed: stop() still saves what was recorded
   */
  constructor(o) {
    Object.assign(this, { canvas: o.canvas, audioTrack: o.audioTrack, fps: o.fps, support: o.support, name: o.name, sampleRate: o.sampleRate, onError: o.onError || (() => {}) });
    this.W = o.canvas.width;
    this.H = o.canvas.height;
    this.n = 0; // video frames written
    this.dropped = 0; // frames the encoder couldn't take (its queue full)
    this.audioUs = 0; // the end of the sound written, in µs
    this.failed = null;
    this.stopping = false;
  }

  async start() {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    this.handle = await dir.getFileHandle(this.name, { create: true });
    this.writable = await this.handle.createWritable();
    const set = this.audioTrack.getSettings?.() || {};
    this.rate = this.sampleRate || set.sampleRate || 48000;
    const { Muxer, FileSystemWritableFileStreamTarget } = window.Mp4Muxer;
    this.muxer = new Muxer({
      target: new FileSystemWritableFileStreamTarget(this.writable),
      video: { codec: this.support.video.mux, width: this.W, height: this.H, frameRate: mp4Timescale(this.fps) },
      audio: { codec: this.support.audio.mux, numberOfChannels: 2, sampleRate: this.rate },
      fastStart: false, // (the index goes at the end: the file is written as it goes, never held whole)
      firstTimestampBehavior: 'cross-track-offset',
    });
    const fail = (e) => {
      if (this.failed) return;
      this.failed = e;
      this.onError(e);
    };
    this.venc = new VideoEncoder({ output: (c, m) => this.muxer.addVideoChunk(c, m), error: fail });
    const bitrate = this.H >= 1080 ? 10_000_000 : 6_000_000;
    const vcfg = { ...this.support.video.cfg, width: this.W, height: this.H, framerate: this.fps, bitrate };
    if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) throw new Error(`can't encode ${this.W}x${this.H} at ${this.fps}`);
    this.venc.configure(vcfg);
    this.aenc = new AudioEncoder({ output: (c, m) => this.muxer.addAudioChunk(c, m), error: fail });
    const acfg = { ...this.support.audio.cfg, sampleRate: this.rate, numberOfChannels: 2 };
    if (!(await AudioEncoder.isConfigSupported(acfg)).supported) throw new Error(`can't encode sound at ${this.rate} Hz`);
    this.aenc.configure(acfg);
    this.keyEvery = Math.max(1, Math.round(this.fps * 2));
    this.t0 = performance.now(); // the recording's zero, for the sound
    this.pump();
  }

  /** The sound: the live mix as it comes, timed from the recording's start. */
  async pump() {
    this.reader = new MediaStreamTrackProcessor({ track: this.audioTrack }).readable.getReader();
    let a0 = null, off = 0;
    for (;;) {
      let r;
      try {
        r = await this.reader.read();
      } catch {
        break;
      }
      if (r.done) break;
      const ad = r.value;
      try {
        if (this.failed || this.stopping) continue;
        if (a0 == null) {
          a0 = ad.timestamp;
          off = (performance.now() - this.t0) * 1000 - (ad.duration || 0); // (this block began a block's length ago)
        }
        const ts = Math.round(off + (ad.timestamp - a0));
        if (ts < 0) continue; // (from before the first frame)
        const out = toStereo(ad, ts);
        this.aenc.encode(out);
        out.close();
        this.audioUs = ts + Math.round((ad.numberOfFrames / ad.sampleRate) * 1e6);
      } finally {
        ad.close();
      }
    }
  }

  /** The program was just drawn: write it as `count` frames (more than one if the studio fell behind). */
  frame(count = 1) {
    if (this.failed || this.stopping) return;
    const dur = 1e6 / this.fps;
    const first = new VideoFrame(this.canvas, { timestamp: Math.round(this.n * dur), duration: Math.round(dur) });
    try {
      for (let i = 0; i < count; i++) {
        const f = i === 0 ? first : new VideoFrame(first, { timestamp: Math.round(this.n * dur), duration: Math.round(dur) });
        // the encoder far behind (a struggling computer): skip this frame rather than queue forever
        if (this.venc.encodeQueueSize > 90) this.dropped++;
        else this.venc.encode(f, { keyFrame: this.n % this.keyEvery === 0 });
        if (i > 0) f.close();
        this.n++;
      }
    } finally {
      first.close();
    }
  }

  /** How it's going (the show log): frames, skipped, encoder queue, and sound ahead (+) or behind the picture, ms. */
  stats() {
    const videoUs = (this.n * 1e6) / this.fps;
    return { frames: this.n, dropped: this.dropped, queue: this.venc?.encodeQueueSize || 0, drift: Math.round((this.audioUs - videoUs) / 1000) };
  }

  /** Finish the file (also after a failure: what was recorded is kept) and hand it back. */
  async stop() {
    this.stopping = true;
    await this.reader?.cancel().catch(() => {});
    for (const enc of [this.venc, this.aenc]) {
      if (enc?.state === 'configured') await enc.flush().catch(() => {});
      try { enc?.close(); } catch {}
    }
    this.muxer.finalize();
    await this.writable.close();
    return this.handle.getFile();
  }
}

/** A block of sound as two-channel float, timed `ts` µs (the encoder takes two channels). */
function toStereo(ad, ts) {
  const frames = ad.numberOfFrames, ch = ad.numberOfChannels;
  const data = new Float32Array(frames * 2);
  const plane = (i) => {
    const b = new Float32Array(frames);
    ad.copyTo(b, { planeIndex: i, format: 'f32-planar' });
    return b;
  };
  const L = plane(0), R = ch > 1 ? plane(1) : L;
  data.set(L, 0);
  data.set(R, frames);
  return new AudioData({ format: 'f32-planar', sampleRate: ad.sampleRate, numberOfFrames: frames, numberOfChannels: 2, timestamp: ts, data });
}
