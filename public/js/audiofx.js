// Audio building blocks shared by the phone, the studio's live mixer, the edit player, the
// renderer and the audio console:
//   - an EQ: a high-pass (rumble, handling noise) and low / mid / high bands
//   - a balance control that keeps the centre at full level
//   - a fix for recordings that only fill the left channel (some phone browsers hand a
//     mono microphone over as "stereo" with a silent right side): until a real right
//     channel shows up, the left plays on both sides
// Everything here is plain Web Audio, so it works the same live and in an offline render.

export const EQ_BANDS = { hp: 80, low: 120, mid: 1500, high: 8000 };
export const EQ_DEFAULT = { hp: false, low: 0, mid: 0, high: 0 };
export const eqOf = (e) => ({ ...EQ_DEFAULT, ...(e || {}) });
export const eqFlat = (e) => {
  const q = eqOf(e);
  return !q.hp && !q.low && !q.mid && !q.high;
};

const offline = (ctx) => typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
/** Set a parameter: glide in a live mix (no zipper noise), jump in an offline render. */
function put(ctx, param, v, smooth) {
  if (!smooth || offline(ctx)) param.value = v;
  else param.setTargetAtTime(v, ctx.currentTime, 0.02);
}

/** High-pass + three bands, in series. */
export function eqChain(ctx) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.Q.value = Math.SQRT1_2;
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = EQ_BANDS.low;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = EQ_BANDS.mid;
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = EQ_BANDS.high;
  hp.connect(low);
  low.connect(mid);
  mid.connect(high);
  const chain = {
    input: hp,
    output: high,
    filters: [hp, low, mid, high],
    eq: eqOf(),
    set(e, smooth = true) {
      const q = eqOf(e);
      chain.eq = q;
      put(ctx, hp.frequency, q.hp ? EQ_BANDS.hp : 10, smooth); // off: 10 Hz, which only takes away DC
      put(ctx, low.gain, q.low, smooth);
      put(ctx, mid.gain, q.mid, smooth);
      put(ctx, high.gain, q.high, smooth);
    },
  };
  chain.set(null, false);
  return chain;
}

/** The EQ's response in dB at each frequency, for drawing its curve. */
let curveCtx = null, curveChain = null;
export function eqCurve(e, freqs) {
  if (!curveCtx) {
    curveCtx = new OfflineAudioContext(1, 128, 48000);
    curveChain = eqChain(curveCtx);
  }
  curveChain.set(e, false);
  const total = new Float32Array(freqs.length);
  const mag = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
  for (const f of curveChain.filters) {
    f.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < freqs.length; i++) total[i] += 20 * Math.log10(mag[i] || 1e-6);
  }
  return total;
}

/**
 * Balance: −1 (all left) … 0 (centre, both sides at full level) … +1 (all right).
 * Takes mono or stereo; mono is spread to both sides first.
 */
export function balance(ctx) {
  const pre = ctx.createGain();
  pre.channelCount = 2;
  pre.channelCountMode = 'explicit';
  pre.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const gl = ctx.createGain(), gr = ctx.createGain();
  pre.connect(split);
  split.connect(gl, 0);
  split.connect(gr, 1);
  gl.connect(merge, 0, 0);
  gr.connect(merge, 0, 1);
  const b = {
    input: pre,
    output: merge,
    pan: 0,
    set(p = 0, smooth = true) {
      const v = Math.max(-1, Math.min(1, +p || 0));
      b.pan = v;
      put(ctx, gl.gain, v > 0 ? 1 - v : 1, smooth);
      put(ctx, gr.gain, v < 0 ? 1 + v : 1, smooth);
    },
  };
  return b;
}

// ---- recordings that only fill the left channel ------------------------------------------
const watching = new Set();
let watchTimer = null;
const rms = (an, buf) => {
  an.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
};
function checkFixers() {
  for (const f of watching) {
    if (f.ctx.state !== 'running') continue;
    const l = rms(f.aL, f.buf), r = rms(f.aR, f.buf);
    // A real right channel: sound there, not far below the left. Twice in a row, then it stays stereo.
    if (r > 0.003 && r > l * 0.25) {
      if (++f.hits >= 2) f.setStereo(true);
    } else f.hits = 0;
  }
}

/**
 * Left channel on both sides until the source proves it has a right channel of its own;
 * then true stereo (and it stays that way). `stereo: true` skips the wait.
 */
export function channelFixer(ctx, { stereo = false } = {}) {
  const input = ctx.createGain(); // takes one channel or two, as they come
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const rFromR = ctx.createGain(), rFromL = ctx.createGain();
  const aL = ctx.createAnalyser(), aR = ctx.createAnalyser();
  aL.fftSize = aR.fftSize = 2048;
  input.connect(split);
  split.connect(merge, 0, 0);
  split.connect(rFromR, 1);
  rFromR.connect(merge, 0, 1);
  split.connect(rFromL, 0);
  rFromL.connect(merge, 0, 1);
  split.connect(aL, 0);
  split.connect(aR, 1);
  const f = {
    ctx, input, output: merge, aL, aR, buf: new Float32Array(2048), stereo: false, hits: 0,
    setStereo(on) {
      f.stereo = !!on;
      put(ctx, rFromR.gain, on ? 1 : 0, false);
      put(ctx, rFromL.gain, on ? 0 : 1, false);
      if (on) watching.delete(f);
      else watching.add(f);
    },
    /** A new source on the same input (another microphone, another clip). */
    reset(stereoHint = false) {
      f.hits = 0;
      f.setStereo(!!stereoHint);
    },
    dispose() {
      watching.delete(f);
    },
  };
  f.setStereo(stereo);
  if (!watchTimer) watchTimer = setInterval(checkFixers, 500);
  return f;
}

/** The same fix for a decoded recording (the renderer): an empty right side gets the left. */
export function fixBufferChannels(buf, hint) {
  if (!buf || buf.numberOfChannels < 2 || hint === 'stereo') return buf;
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const step = Math.max(1, Math.floor(L.length / 200000));
  let l = 0, r = 0;
  for (let i = 0; i < L.length; i += step) {
    l += L[i] * L[i];
    r += R[i] * R[i];
  }
  if (l > 0 && r < l * 0.0025) R.set(L); // the right is 26 dB or more below the left: it's empty
  return buf;
}
