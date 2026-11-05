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
const tapModules = new WeakMap(); // AudioContext → its tap module, loading

/** What this browser can write a program recording with, or null (then use MediaRecorder). */
const MAX_QUEUE = 6; // frames waiting for the encoder (a fifth of a second at 30)

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
   * @param {AudioContext} [o.ctx]  with o.audioNode: take the sound on the sound thread (nothing dropped)
   * @param {AudioNode} [o.audioNode]  the program's sound, in o.ctx
   * @param {(e:Error)=>void} [o.onError]  the encoder failed: stop() still saves what was recorded
   */
  constructor(o) {
    Object.assign(this, { canvas: o.canvas, audioTrack: o.audioTrack, fps: o.fps, support: o.support, name: o.name, sampleRate: o.sampleRate, ctx: o.ctx, audioNode: o.audioNode, onError: o.onError || (() => {}) });
    this.fixes = { dropped: 0, added: 0, gapMs: 0 }; // (the sound kept with the picture: ms taken out, put in, and silence for gaps)
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
    this.warmOut = 0; // outputs still to come from the warm-up frame (not written)
    this.venc = new VideoEncoder({
      output: (c, m) => {
        if (this.warmOut > 0) {
          this.warmOut--;
          this.decoderConfig = m?.decoderConfig || this.decoderConfig; // (the first output carries how to decode the rest)
          return;
        }
        if (this.decoderConfig && !m?.decoderConfig) m = { ...m, decoderConfig: this.decoderConfig };
        this.decoderConfig = null;
        this.muxer.addVideoChunk(c, m);
      },
      error: fail,
    });
    const bitrate = this.H >= 1080 ? 10_000_000 : 6_000_000;
    // Live, the encoder has to keep up with the show, not make the best file it can: the graphics
    // card's encoder if there is one (it costs the computer almost nothing), and real-time mode
    // (a software encoder takes its quicker settings). An offline render keeps the defaults.
    const base = { ...this.support.video.cfg, width: this.W, height: this.H, framerate: this.fps, bitrate };
    let vcfg = null;
    for (const extra of [{ hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime' }, { latencyMode: 'realtime' }, {}]) {
      const c = { ...base, ...extra };
      if ((await VideoEncoder.isConfigSupported(c).catch(() => ({})))?.supported) {
        vcfg = c;
        break;
      }
    }
    if (!vcfg) throw new Error(`can't encode ${this.W}x${this.H} at ${this.fps}`);
    this.venc.configure(vcfg);
    this.encoderKind = vcfg.hardwareAcceleration === 'prefer-hardware' ? 'hardware' : 'software';
    this.realtime = vcfg.latencyMode === 'realtime';
    await this.warmUp();
    this.aenc = new AudioEncoder({ output: (c, m) => this.muxer.addAudioChunk(c, m), error: fail });
    const acfg = { ...this.support.audio.cfg, sampleRate: this.rate, numberOfChannels: 2 };
    if (!(await AudioEncoder.isConfigSupported(acfg)).supported) throw new Error(`can't encode sound at ${this.rate} Hz`);
    this.aenc.configure(acfg);
    this.keyEvery = Math.max(1, Math.round(this.fps * 2));
    this.t0 = performance.now(); // the recording's zero, for the sound
    if (this.ctx && this.audioNode && this.ctx.audioWorklet) {
      try {
        await this.startTap();
        return;
      } catch (e) {
        console.warn('sound-thread tap unavailable, reading the track', e?.message || e);
      }
    }
    this.pump();
  }

  /**
   * One frame through the encoder before the recording's clock starts, not written. Starting a
   * graphics card's encoder can take seconds (a Mac took 4.5 s, and the camera stalled with it):
   * started with the recording, every frame meanwhile was skipped (141, a frozen first few
   * seconds). Now that wait comes before the first frame, at most 8 s.
   */
  async warmUp(ms = 8000) {
    const f = new VideoFrame(this.canvas, { timestamp: 0 });
    try {
      this.warmOut = 1;
      this.venc.encode(f, { keyFrame: true });
    } finally {
      f.close();
    }
    let timer;
    await Promise.race([this.venc.flush().catch(() => {}), new Promise((r) => (timer = setTimeout(r, ms)))]);
    clearTimeout(timer);
  }

  /**
   * The sound on the sound thread (rectap-worklet.js): every sample, queued, never dropped;
   * timed by counting them. The sound engine's clock and the computer's drift apart a little
   * (a few hundred ms over two hours); held within 15 ms of the picture by taking out or
   * putting in a millisecond at a time, crossfaded, and a real gap (the engine stopped) is
   * silence of its length.
   */
  async startTap() {
    const ctx = this.ctx;
    if (!tapModules.has(ctx)) tapModules.set(ctx, ctx.audioWorklet.addModule('/js/rectap-worklet.js'));
    await tapModules.get(ctx);
    this.tap = new AudioWorkletNode(ctx, 'vm-rec-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    this.silent = ctx.createGain();
    this.silent.gain.value = 0;
    this.audioNode.connect(this.tap);
    this.tap.connect(this.silent).connect(ctx.destination);
    this.t0 = performance.now();
    this.f0 = Math.round(ctx.currentTime * this.rate); // the engine's sample at the recording's zero
    this.out = null; // samples written so far
    this.fixMs = 0; // ms the corrections have put in (-) or taken out (+)
    this.ts0 = ctx.getOutputTimestamp();
    this.tap.port.onmessage = (e) => this.block(e.data);
  }

  block({ frame, L, R }) {
    if (this.failed || this.stopping) return;
    const rate = this.rate;
    let start = frame - this.f0;
    if (start + L.length <= 0) return;
    if (start < 0) {
      L = L.subarray(-start);
      R = R.subarray(-start);
      start = 0;
    }
    if (this.out == null) this.out = start;
    // How far the sound is from the picture: the engine's clock against the page's, from the
    // engine's own reading of both (not when blocks reach the page: a busy page takes them late).
    const drift = this.clockDrift() - this.fixMs;
    const step = Math.round(rate / 1000); // 1 ms
    if (drift < -250) {
      // the engine stopped (its clock stood still while the page's went on): silence for the gap,
      // so everything after keeps its place against the picture
      const gap = Math.round((-drift / 1000) * rate);
      this.write(new Float32Array(gap), new Float32Array(gap));
      this.fixMs -= (gap / rate) * 1000;
      this.fixes.gapMs += Math.round((gap / rate) * 1000);
    } else if (drift > 15 && L.length > 4 * step) {
      [L, R] = [cut(L, step), cut(R, step)];
      this.fixMs += 1;
      this.fixes.dropped++;
    } else if (drift < -15) {
      [L, R] = [stretch(L, step), stretch(R, step)];
      this.fixMs -= 1;
      this.fixes.added++;
    }
    this.write(L, R);
  }

  /** The engine's clock ahead (+) of the page's since the start, ms (0 until the engine says). */
  clockDrift() {
    const ts = this.ctx.getOutputTimestamp();
    if (!ts.performanceTime || !this.ts0?.performanceTime) {
      if (ts.performanceTime) this.ts0 = ts;
      return 0;
    }
    return (ts.contextTime - this.ts0.contextTime) * 1000 - (ts.performanceTime - this.ts0.performanceTime);
  }

  write(L, R) {
    const n = L.length;
    if (!n) return;
    const data = new Float32Array(n * 2);
    data.set(L, 0);
    data.set(R, n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: this.rate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((this.out / this.rate) * 1e6), data });
    try {
      this.aenc.encode(ad);
    } finally {
      ad.close();
    }
    this.out += n;
    this.audioUs = Math.round((this.out / this.rate) * 1e6);
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
        // the encoder behind (a struggling computer): skip this frame rather than let a queue
        // build. A short queue skips a frame here and there (a little less smooth); a long
        // one held seconds of frames and then skipped them all at once (a freeze).
        if (this.venc.encodeQueueSize > MAX_QUEUE) this.dropped++;
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
    return { frames: this.n, dropped: this.dropped, queue: this.venc?.encodeQueueSize || 0, drift: Math.round((this.audioUs - videoUs) / 1000), ...(this.tap ? { fixes: { ...this.fixes } } : {}) };
  }

  /** Finish the file (also after a failure: what was recorded is kept) and hand it back. */
  async stop() {
    this.stopping = true;
    await this.reader?.cancel().catch(() => {});
    if (this.tap) {
      this.tap.port.postMessage('stop');
      try {
        this.audioNode.disconnect(this.tap);
        this.tap.disconnect();
      } catch {}
    }
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

/** A block with `k` samples taken out of its middle, crossfaded over k (a millisecond: unheard). */
function cut(a, k) {
  const at = Math.floor((a.length - 2 * k) / 2), out = new Float32Array(a.length - k);
  out.set(a.subarray(0, at), 0);
  for (let i = 0; i < k; i++) {
    const w = i / k;
    out[at + i] = a[at + i] * (1 - w) + a[at + k + i] * w;
  }
  out.set(a.subarray(at + 2 * k), at + k);
  return out;
}
/** A block with `k` samples put into its middle (its own, again), crossfaded. */
function stretch(a, k) {
  const at = Math.floor((a.length - k) / 2), out = new Float32Array(a.length + k);
  out.set(a.subarray(0, at + k), 0);
  for (let i = 0; i < k; i++) {
    const w = i / k;
    out[at + k + i] = a[at + i] * (1 - w) + a[at + k + i] * w;
  }
  out.set(a.subarray(at + k), at + 2 * k);
  return out;
}
