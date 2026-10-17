// Render the sequence to an MP4 as fast as the computer can go, not in real time.
// Video: demux each source, decode with WebCodecs, composite each output frame
// (layers, picture-in-picture, titles, slates, fades), encode H.264 (or VP9).
// Audio: decode each source, mix offline in chunks, encode AAC (or Opus).

import { composeFrame, limiter } from '/js/compose.js';
import { eqChain, balance, fixBufferChannels } from '/js/audiofx.js';
import { audioItems, end, micCover, dissolveOf, heldBefore } from '/js/sequence.js';
import { demux } from '/js/demux.js';

const RATE = 48000;
const CHUNK_S = 20;

const VIDEO_CANDIDATES = [
  { codec: 'avc1.640028', mux: 'avc', label: 'H.264 High' },
  { codec: 'avc1.4d0028', mux: 'avc', label: 'H.264 Main' },
  { codec: 'avc1.420028', mux: 'avc', label: 'H.264 Baseline' }, // what Chrome's software encoder (Linux) can do
  { codec: 'vp09.00.40.08', mux: 'vp9', label: 'VP9' },
];
const AUDIO_CANDIDATES = [
  { codec: 'mp4a.40.2', mux: 'aac', label: 'AAC' },
  { codec: 'opus', mux: 'opus', label: 'Opus' },
];
const supportCache = new Map();

/** Encode a couple of real frames: "isConfigSupported" can say yes and still fail at start-up. */
async function probeVideo(c, W, H, fps) {
  const cfg = { codec: c.codec, width: W, height: H, bitrate: 8e6, framerate: fps, ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}) };
  try {
    if (!(await VideoEncoder.isConfigSupported(cfg)).supported) return null;
  } catch {
    return null;
  }
  let chunks = 0, failed = null;
  const enc = new VideoEncoder({ output: () => chunks++, error: (e) => (failed = e) });
  try {
    enc.configure(cfg);
    const cv = new OffscreenCanvas(W, H);
    cv.getContext('2d').fillRect(0, 0, W, H);
    for (let i = 0; i < 2; i++) {
      const f = new VideoFrame(cv, { timestamp: i * 33333 });
      enc.encode(f, { keyFrame: i === 0 });
      f.close();
    }
    await Promise.race([enc.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
  } catch (e) {
    failed ||= e;
  } finally {
    try { enc.close(); } catch {}
  }
  return !failed && chunks > 0 ? { ...c, cfg } : null;
}

async function probeAudio(c) {
  const cfg = { codec: c.codec, sampleRate: RATE, numberOfChannels: 2, bitrate: 160000 };
  try {
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) return null;
  } catch {
    return null;
  }
  let chunks = 0, failed = null;
  const enc = new AudioEncoder({ output: () => chunks++, error: (e) => (failed = e) });
  try {
    enc.configure(cfg);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: 4096, numberOfChannels: 2, timestamp: 0, data: new Float32Array(8192) });
    enc.encode(ad);
    ad.close();
    await Promise.race([enc.flush(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
  } catch (e) {
    failed ||= e;
  } finally {
    try { enc.close(); } catch {}
  }
  return !failed && chunks > 0 ? { ...c, cfg } : null;
}

/** Which codecs this browser can really write, best first. */
export async function renderSupport(W, H, fps) {
  if (!window.VideoEncoder || !window.AudioEncoder || !window.Mp4Muxer || !window.VideoFrame) return null;
  const key = `${W}x${H}@${fps}`;
  if (supportCache.has(key)) return supportCache.get(key);
  const videos = [];
  for (const c of VIDEO_CANDIDATES) {
    const ok = await probeVideo(c, W, H, fps);
    if (ok) videos.push(ok);
  }
  let audio = null;
  for (const c of AUDIO_CANDIDATES) {
    audio = await probeAudio(c);
    if (audio) break;
  }
  const out = videos.length ? { video: videos[0], videos, audio } : null;
  supportCache.set(key, out);
  return out;
}

/** p, or a rejection with `why` after ms. */
function within(p, ms, why) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(why)), ms)))]).finally(() => clearTimeout(t));
}

/** Stage-labelled errors, so a failure says what actually went wrong. */
export class RenderError extends Error {
  constructor(stage, message, detail = {}) {
    super(message);
    this.stage = stage;
    this.detail = detail;
  }
}

/**
 * @param {object} o
 * @param {object} o.seq
 * @param {number} o.width
 * @param {number} o.height
 * @param {number} [o.fps]
 * @param {(clipId:string)=>Blob} o.blobFor
 * @param {(assetId:string)=>CanvasImageSource|null} o.imageFor
 * @param {string} [o.fit]
 * @param {string} [o.title]
 * @param {(p:{phase:string, done:number, total:number})=>void} [o.onProgress]
 * @param {AbortSignal} [o.signal]
 * @param {FileSystemWritableFileStream} [o.stream]  write straight to disk (long films)
 * @param {(item, sourceMs)=>{rect, rot}|null} [o.viewOf]  where the picture sits in a phone's square frame
 */
export async function renderSequence(o) {
  const fps = o.fps || 30;
  const W = o.width, H = o.height;
  const dur = end(o.seq);
  if (dur <= 0) throw new Error('Nothing on the timeline to render');
  const support = await renderSupport(W, H, fps);
  if (!support) throw new RenderError('setup', 'This browser can’t write video files. Use Chrome or Edge on a computer, or use Real-time export.');
  const report = { video: support.video.label, audio: support.audio?.label || 'none', sources: [] };
  o.onReport?.(report);
  const { Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget } = window.Mp4Muxer;
  const target = o.stream ? new FileSystemWritableFileStreamTarget(o.stream) : new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: support.video.mux, width: W, height: H, frameRate: fps },
    ...(support.audio ? { audio: { codec: support.audio.mux, numberOfChannels: 2, sampleRate: RATE } } : {}),
    fastStart: o.stream ? false : 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  const progress = (phase, done, total) => o.onProgress?.({ phase, done, total });
  const check = () => { if (o.signal?.aborted) throw new DOMException('Render cancelled', 'AbortError'); };

  // ------------------------------------------------------------ audio first --
  if (support.audio) {
    let err = null;
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (err = e) });
    aenc.configure(support.audio.cfg);
    const events = [];
    const cover = micCover(o.seq);
    // the parts of [a, b) no microphone covers (camera sound ducks under the microphones)
    const uncovered = (a, b) => {
      const out = [];
      let at = a;
      for (const [x, y] of cover) {
        if (y <= at || x >= b) continue;
        if (x > at) out.push([at, x]);
        at = Math.max(at, y);
      }
      if (at < b) out.push([at, b]);
      return out;
    };
    for (const tr of o.seq.tracks.filter((t) => t.kind === 'audio' && !t.muted && (t.gain ?? 1) > 0)) {
      for (const it of audioItems(o.seq, tr)) {
        if ((it.speed || 1) !== 1) continue; // a clip at another speed plays without its sound
        if (it.type !== 'clip') continue;
        const ev = { src: it.src, start: it.start, end: it.start + it.dur, in: it.in || 0, gain: (tr.gain ?? 1) * (it.gain ?? 1), mono: tr.mono !== false, track: tr.id, eq: tr.eq, pan: tr.pan || 0, xfIn: it.xfIn || 0, xfOut: it.xfOut || 0, x0: it.start, x1: it.start + it.dur };
        if (tr.follow && tr.duck && cover.length) for (const [a, b] of uncovered(ev.start, ev.end)) events.push({ ...ev, start: a, end: b, in: ev.in + (a - ev.start) });
        else events.push(ev);
      }
    }
    const buffers = new Map();
    const decoder = new OfflineAudioContext(2, RATE, RATE);
    for (const src of new Set(events.map((e) => e.src))) {
      check();
      try {
        // (a recording that only filled the left side gets it on both)
        buffers.set(src, fixBufferChannels(await decoder.decodeAudioData(await o.blobFor(src).arrayBuffer()), o.audioOf?.(src)));
      } catch {
        buffers.set(src, null); // no sound in that recording, or a format this browser can't read
        report.silent = (report.silent || 0) + 1;
      }
    }
    const chunks = Math.ceil(dur / 1000 / CHUNK_S);
    for (let c = 0; c < chunks; c++) {
      check();
      const c0 = c * CHUNK_S * 1000;
      const c1 = Math.min(dur, c0 + CHUNK_S * 1000);
      const frames = Math.round(((c1 - c0) / 1000) * RATE);
      if (frames <= 0) break;
      const ctx = new OfflineAudioContext(2, frames, RATE);
      const out0 = limiter(ctx);
      out0.connect(ctx.destination);
      // each audio track: its level (and mono) → EQ → balance, as in the edit player
      const trackIn = new Map();
      const inputFor = (e) => {
        let n = trackIn.get(e.track);
        if (n) return n;
        n = ctx.createGain();
        if (e.mono) {
          n.channelCount = 1;
          n.channelCountMode = 'explicit';
          n.channelInterpretation = 'speakers';
        }
        const eq = eqChain(ctx), bal = balance(ctx);
        eq.set(e.eq, false);
        bal.set(e.pan, false);
        n.connect(eq.input);
        eq.output.connect(bal.input);
        bal.output.connect(out0);
        trackIn.set(e.track, n);
        return n;
      };
      for (const e of events) {
        const buf = buffers.get(e.src);
        if (!buf || e.end <= c0 || e.start >= c1) continue;
        const from = Math.max(e.start, c0), to = Math.min(e.end, c1);
        const offset = (e.in + (from - e.start)) / 1000;
        if (offset >= buf.duration) continue;
        const node = ctx.createBufferSource();
        node.buffer = buf;
        const g = ctx.createGain();
        g.gain.value = e.gain;
        // a dissolve's crossfade: up over xfIn from the shot's start, down over xfOut to its end
        if (e.xfIn || e.xfOut) {
          const env = (x) => e.gain * Math.max(0, Math.min(1, e.xfIn ? (x - e.x0) / e.xfIn : 1, e.xfOut ? (e.x1 - x) / e.xfOut : 1));
          const pts = [from, e.x0 + e.xfIn, e.x1 - e.xfOut, to].filter((x) => x >= from && x <= to).sort((a, b) => a - b);
          g.gain.setValueAtTime(env(from), 0);
          for (const x of pts.slice(1)) g.gain.linearRampToValueAtTime(env(x), (x - c0) / 1000);
        }
        node.connect(g).connect(inputFor(e));
        node.start((from - c0) / 1000, offset, (to - from) / 1000);
      }
      const out = await ctx.startRendering();
      const planar = new Float32Array(frames * 2);
      planar.set(out.getChannelData(0), 0);
      planar.set(out.getChannelData(1), frames);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: RATE, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round(c0 * 1000), data: planar });
      aenc.encode(ad);
      ad.close();
      if (err) throw new RenderError('audio-encode', `The ${support.audio.label} audio encoder failed: ${err.message}`);
      progress('audio', c + 1, chunks);
    }
    await aenc.flush();
    aenc.close();
    buffers.clear();
  }

  // ------------------------------------------------------------------ video --
  let verr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (verr = e) });
  venc.configure(support.video.cfg);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  // One decoder per (track, source), so the same camera used twice (say, full frame
  // and picture-in-picture at another moment) never fights over one decoder.
  const sources = new Map();
  const sourceFor = async (trackId, src) => {
    const key = trackId + '|' + src;
    if (!sources.has(key)) {
      const s = await openSource(o.blobFor(src));
      report.sources.push({ clip: o.nameOf?.(src) || src, path: s.kind, codec: s.codec || null, why: s.why || null });
      o.onReport?.(report);
      sources.set(key, s);
    }
    return sources.get(key);
  };
  // If fast decoding a clip fails part-way, switch just that clip to the compatible path.
  const frameFrom = async (trackId, src, us) => {
    const key = trackId + '|' + src;
    const s = await sourceFor(trackId, src);
    if (s.kind === 'broken') return null;
    // Neither path can read it: leave it out (whatever is underneath shows) and say so.
    const unreadable = (src2, s2, e) => {
      const name = o.nameOf?.(src2) || src2;
      try { s2.close(); } catch {}
      sources.set(key, { kind: 'broken', rotation: 0, frameAt: async () => null, close() {} });
      const r = report.sources.find((x) => x.clip === name);
      if (r) Object.assign(r, { path: 'unreadable', why: e.message });
      report.unreadable = [...new Set([...(report.unreadable || []), name])];
      o.onReport?.(report);
      return null;
    };
    try {
      // (no frame may take for ever: a damaged recording mustn't stall, or freeze, the whole export)
      return await within(s.frameAt(us), 8000, 'decoding stalled (the clip may be damaged)');
    } catch (e) {
      if (s.kind !== 'fast') return unreadable(src, s, e);
      console.warn('fast decode failed, switching clip to the compatible path', e);
      s.close();
      const slow = new ElementSource(o.blobFor(src));
      sources.set(key, slow);
      const r = report.sources.find((x) => x.clip === (o.nameOf?.(src) || src) && x.path === 'fast');
      if (r) Object.assign(r, { path: 'compatible', why: e.message });
      o.onReport?.(report);
      try {
        return await within(slow.frameAt(us), 8000, 'decoding stalled (the clip may be damaged)');
      } catch (e2) {
        return unreadable(src, slow, e2); // (and the compatible path can't either)
      }
    }
  };
  const rotOf = new Map();
  const total = Math.ceil((dur / 1000) * fps);
  try {
    for (let n = 0; n < total; n++) {
      check();
      if (verr) throw new RenderError('video-encode', `The ${support.video.label} video encoder failed: ${verr.message}`, { codec: support.video.codec });
      const t = (n * 1000) / fps;
      // fetch every visible clip's frame for this moment
      const frames = new Map();
      for (const tr of o.seq.tracks) {
        if (tr.kind !== 'video' || tr.hidden) continue;
        const it = tr.items.find((x) => t >= x.start && t < x.start + x.dur);
        if (!it || it.type !== 'clip') continue;
        // a dissolve into it: the shot before carries on underneath (past its end)
        const xd = dissolveOf(it), prev = xd && t < it.start + xd ? heldBefore(tr, it) : null;
        for (const x of prev ? [prev, it] : [it]) {
          const us = ((x.in || 0) + (t - x.start) * (x.speed || 1)) * 1000;
          const f = await frameFrom(tr.id, x.src, us);
          if (f) frames.set(x.id, f);
          rotOf.set(x.id, sources.get(tr.id + '|' + x.src)?.rotation || 0);
        }
      }
      composeFrame(g, W, H, o.seq, t, (item) => (item.type === 'image' ? o.imageFor(item.asset) : frames.get(item.id) || null), {
        fit: o.fit,
        title: o.title,
        // the phone's orientation log, plus any rotation flag the file itself carries
        viewOf: (item, ms) => {
          const v = o.viewOf?.(item, ms);
          const r = ((v?.rot || 0) + (rotOf.get(item.id) || 0)) % 360;
          return v || r ? { rect: v?.rect || null, rot: r, ev: v?.ev || 0 } : null;
        },
      });
      const vf = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: n % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (n % 5 === 0) progress('video', n, total);
    }
    await venc.flush();
    if (verr) throw new RenderError('video-encode', `The ${support.video.label} video encoder failed: ${verr.message}`, { codec: support.video.codec });
  } finally {
    venc.close();
    for (const s of sources.values()) s.close();
  }
  muxer.finalize();
  progress('video', total, total);
  if (o.stream) {
    await o.stream.close();
    return { blob: null, codecs: support, report };
  }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), codecs: support, report };
}

// ------------------------------------------------------------ source decoders --

async function openSource(blob) {
  let why = null;
  try {
    const d = await demux(blob);
    if (!d) why = 'not an MP4 or WebM file this decoder understands';
    else if (!d.samples.length) why = 'no video in the file';
    else {
      const cfg = { codec: d.codec, codedWidth: d.width, codedHeight: d.height, ...(d.description ? { description: d.description } : {}) };
      let ok = false;
      try {
        ok = (await VideoDecoder.isConfigSupported(cfg)).supported;
      } catch (e) {
        why = e.message;
      }
      if (ok) {
        const fs = new FrameSource(d, cfg);
        const probe = await fs.probe();
        if (probe === true) return fs;
        fs.close();
        why = `decoder test failed (${probe})`;
      } else why ||= `this browser can't decode ${d.codec}`;
      const slow = new ElementSource(blob);
      slow.codec = d.codec;
      slow.rotation = 0; // the <video> element applies the file's rotation itself
      slow.why = why;
      return slow;
    }
  } catch (e) {
    why = e.message;
  }
  const slow = new ElementSource(blob);
  slow.why = why;
  return slow;
}

/** Frame-accurate decoding with WebCodecs, reading forward and resetting at keyframes on jumps. */
class FrameSource {
  constructor(d, cfg) {
    this.kind = 'fast';
    this.codec = d.codec;
    this.rotation = d.rotation || 0;
    this.s = d.samples;
    this.cfg = cfg;
    this.failed = null;
    this.frames = [];
    this.dec = null;
    this.next = 0;
    this.flushed = false;
    this.notify = null;
    this._open();
  }

  _open() {
    this.dec?.close?.();
    this.dec = new VideoDecoder({
      output: (f) => {
        this.frames.push(f);
        this.notify?.();
      },
      error: (e) => {
        this.failed = e;
        this.notify?.();
      },
    });
    this.dec.configure(this.cfg);
    this.flushed = false;
  }

  /** Decode the first keyframe; true if a picture comes out. */
  async probe() {
    try {
      const f = await Promise.race([this.frameAt(this.s[0].ts), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 5000))]);
      if (this.failed) return this.failed.message;
      if (!f) return 'no picture';
      this._seekTo(0);
      return true;
    } catch (e) {
      return e.message;
    }
  }

  _seekTo(us) {
    for (const f of this.frames) f.close();
    this.frames = [];
    let k = 0;
    for (let i = 0; i < this.s.length; i++) {
      if (this.s[i].ts > us) break;
      if (this.s[i].key) k = i;
    }
    if (this.dec.state === 'closed' || this.flushed) this._open();
    else {
      this.dec.reset();
      this.dec.configure(this.cfg);
    }
    this.flushed = false;
    this.next = k;
  }

  _feed() {
    const smp = this.s[this.next++];
    this.dec.decode(new EncodedVideoChunk({ type: smp.key ? 'key' : 'delta', timestamp: Math.round(smp.ts), duration: Math.round(smp.dur), data: smp.data }));
  }

  _wait() {
    return new Promise((r) => {
      this.notify = r;
      setTimeout(r, 25);
    });
  }

  async frameAt(us) {
    const tol = 1000; // 1 ms
    const first = this.frames[0];
    const lastFed = this.s[this.next - 1]?.ts ?? -Infinity;
    // Backwards, or far ahead of what we've read: jump to the keyframe before it.
    if ((first && us + tol < first.timestamp) || (!first && this.next > 0 && us < this.s[Math.max(0, this.next - 1)].ts - 40000) || us > lastFed + 3e6) this._seekTo(us);
    for (;;) {
      if (this.failed || this.dec.state === 'closed') throw new Error(this.failed?.message || 'decoder closed');
      const beyond = this.frames.some((f) => f.timestamp > us + tol);
      if (beyond) break;
      if (this.next < this.s.length && !this.flushed) {
        this._feed();
        if (this.dec.decodeQueueSize > 3) await this._wait();
        continue;
      }
      if (!this.flushed) {
        await this.dec.flush();
        this.flushed = true;
        continue;
      }
      break; // end of the recording
    }
    let pick = null;
    for (const f of this.frames) if (f.timestamp <= us + tol) pick = f;
    if (!pick) return this.frames[0] || null;
    // drop frames we've moved past
    const keep = [];
    for (const f of this.frames) {
      if (f.timestamp < pick.timestamp) f.close();
      else keep.push(f);
    }
    this.frames = keep;
    return pick;
  }

  close() {
    for (const f of this.frames) f.close();
    this.frames = [];
    try { this.dec.close(); } catch {}
  }
}

/** Slow fallback: seek a video element to each frame. */
class ElementSource {
  constructor(blob) {
    this.kind = 'compatible';
    this.rotation = 0;
    this.v = document.createElement('video');
    this.v.muted = true;
    this.v.preload = 'auto';
    this.url = URL.createObjectURL(blob);
    this.v.src = this.url;
    this.ready = new Promise((r, rej) => {
      this.v.addEventListener('loadeddata', r, { once: true });
      this.v.addEventListener('error', () => rej(new Error('this browser can’t play the clip')), { once: true });
    });
  }

  async frameAt(us) {
    await Promise.race([this.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('this browser can’t play the clip')), 10000))]);
    const s = us / 1e6;
    if (Math.abs(this.v.currentTime - s) > 0.001) {
      this.v.currentTime = s;
      // (a damaged file can leave a seek unfinished for ever: give up on it, rather than the export)
      await within(new Promise((r) => this.v.addEventListener('seeked', r, { once: true })), 4000, 'the clip stops partway (it may be damaged)');
    }
    return this.v.readyState >= 2 ? this.v : null;
  }

  close() {
    URL.revokeObjectURL(this.url);
  }
}
