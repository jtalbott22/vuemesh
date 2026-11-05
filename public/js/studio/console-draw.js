// Studio, part 9 of 24: the audio console's drawing.
// Loads after ccu.js: that import comes first, so the parts run in order (see ../studio.js).
import './ccu.js';
import { eqOf, eqFlat, eqCurve } from '/js/audiofx.js';
import { mode, player } from './core.js';
import { conHolds, conWin, mix, mixInit, stereoMeters } from './mixer.js';
import { mixRows } from './stream.js';

// ---- console drawing (on the console window's own animation frames) ----
const dbOf = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
const conL = new Float32Array(4096), conR = new Float32Array(4096), conSpec = new Float32Array(8192);
let conText = 0, conRms = -120, conZoom = 1;
function timeData(an, buf) {
  const b = buf.subarray(0, an.fftSize);
  an.getFloatTimeDomainData(b);
  return b;
}
const peakIn = (b) => {
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
  return p;
};
function hold(id, i, v, t) {
  const h = conHolds.get(id) || [];
  conHolds.set(id, h);
  const x = h[i] || { v: 0, at: 0 };
  if (v >= x.v || t - x.at > 1500) h[i] = { v, at: t };
  else h[i] = { v: x.v * 0.995, at: x.at };
  return h[i].v;
}
function drawBars(g, W, H, levels, holds) {
  g.clearRect(0, 0, W, H);
  const n = levels.length, gap = Math.max(2, W * 0.06), bw = (W - gap * (n - 1)) / n;
  const y = (db) => H - Math.max(0, Math.min(1, (db + 60) / 60)) * H;
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, '#2bd36b');
  grad.addColorStop(0.69, '#2bd36b');
  grad.addColorStop(0.8, '#f2c037');
  grad.addColorStop(0.95, '#ff3b30');
  levels.forEach((lv, i) => {
    const x = i * (bw + gap);
    g.fillStyle = '#111';
    g.fillRect(x, 0, bw, H);
    const top = y(dbOf(lv));
    g.fillStyle = grad;
    g.fillRect(x, top, bw, H - top);
    g.fillStyle = '#fff';
    g.fillRect(x, y(dbOf(holds[i])) - 1, bw, 2);
  });
  g.fillStyle = '#ffffff40';
  for (const db of [-6, -12, -18, -24, -36, -48]) g.fillRect(0, y(db), W, 1);
}
function drawCurve(g, W, H, eq) {
  const n = Math.max(32, Math.round(W / 2));
  const freqs = new Float32Array(n);
  for (let i = 0; i < n; i++) freqs[i] = 20 * Math.pow(1000, i / (n - 1)); // 20 Hz … 20 kHz
  const db = eqCurve(eq, freqs);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const y = (v) => H / 2 - (Math.max(-15, Math.min(15, v)) / 15) * (H / 2 - 3);
  g.fillStyle = '#ffffff1f';
  for (const f of [100, 1000, 10000]) g.fillRect((Math.log10(f / 20) / 3) * W, 0, 1, H);
  g.fillRect(0, H / 2, W, 1);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    i ? g.lineTo(x, y(db[i])) : g.moveTo(x, y(db[i]));
  }
  g.strokeStyle = eqFlat(eq) ? '#8b8e97' : '#6d9cf0';
  g.lineWidth = Math.max(1.5, H / 30);
  g.stroke();
  g.lineTo(W, H / 2);
  g.lineTo(0, H / 2);
  g.closePath();
  g.fillStyle = '#6d9cf033';
  g.fill();
}
function drawSpectrum(g, W, H, an, dpr) {
  const n = an.frequencyBinCount, arr = conSpec.subarray(0, n), ny = an.context.sampleRate / 2;
  an.getFloatFrequencyData(arr);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const xOf = (f) => (Math.log(f / 20) / Math.log(ny / 20)) * W;
  g.fillStyle = '#ffffff30';
  g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
  for (const [f, lab] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    g.fillRect(xOf(f), 0, 1, H);
    g.fillText(lab, xOf(f) + 3 * dpr, H - 4 * dpr);
  }
  g.beginPath();
  g.moveTo(0, H);
  const step = Math.max(1, Math.round(2 * dpr));
  for (let x = 0; x <= W; x += step) {
    const f0 = 20 * Math.pow(ny / 20, x / W), f1 = 20 * Math.pow(ny / 20, (x + step) / W);
    const b0 = Math.floor((f0 / ny) * n), b1 = Math.max(b0 + 1, Math.floor((f1 / ny) * n));
    let v = -160;
    for (let b = b0; b < b1 && b < n; b++) v = Math.max(v, arr[b]);
    g.lineTo(x, H - Math.max(0, Math.min(1, (v + 100) / 90)) * H);
  }
  g.lineTo(W, H);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ff3b30');
  grad.addColorStop(0.3, '#f2c037');
  grad.addColorStop(1, '#2bd36b');
  g.fillStyle = grad;
  g.globalAlpha = 0.85;
  g.fill();
  g.globalAlpha = 1;
}
function drawScope(g, W, H, L, R, zoom, dpr) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff22';
  g.fillRect(0, H / 2, W, 1);
  if (zoom > 1.05) {
    g.fillStyle = '#8b8e97';
    g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
    g.textAlign = 'right';
    g.fillText(`×${zoom.toFixed(zoom < 10 ? 1 : 0)}`, W - 6 * dpr, 14 * dpr);
    g.textAlign = 'left';
  }
  for (const [buf, col] of [[L, '#2bd36b'], [R, '#f2c037']]) {
    g.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const x = (i / (buf.length - 1)) * W, y = H / 2 - Math.max(-1, Math.min(1, buf[i] * zoom)) * (H / 2 - 2);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.stroke();
  }
}
function drawVector(g, W, H, L, R, zoom, dpr) {
  g.fillStyle = 'rgba(0,0,0,0.28)'; // phosphor: the last few frames fade out
  g.fillRect(0, 0, W, H);
  const s = Math.min(W, H) / 2 - 8 * dpr, cx = W / 2, cy = H / 2;
  g.strokeStyle = '#ffffff1f';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, cy - s); g.lineTo(cx, cy + s);
  g.moveTo(cx - s * 0.7, cy - s * 0.7); g.lineTo(cx + s * 0.7, cy + s * 0.7);
  g.moveTo(cx + s * 0.7, cy - s * 0.7); g.lineTo(cx - s * 0.7, cy + s * 0.7);
  g.stroke();
  g.fillStyle = '#ffffff55';
  g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
  g.fillText('L', cx - s * 0.74, cy - s * 0.74);
  g.fillText('R', cx + s * 0.7, cy - s * 0.74);
  g.fillText('M', cx + 4 * dpr, cy - s + 10 * dpr);
  g.fillStyle = '#6fd0ef';
  const k = s * Math.SQRT1_2 * zoom, dot = Math.max(1.5, dpr * 1.2);
  for (let i = 0; i < L.length; i += 2) g.fillRect(cx + (R[i] - L[i]) * k, cy - (L[i] + R[i]) * k, dot, dot);
}
export function consoleFrame(w) {
  if (w.closed || conWin !== w) return;
  w.requestAnimationFrame(() => consoleFrame(w));
  const d = w.document, dpr = w.devicePixelRatio || 1, t = performance.now();
  const ctxOf = (cv) => {
    const W = Math.min(4096, Math.round(cv.clientWidth * dpr)), H = Math.min(4096, Math.round(cv.clientHeight * dpr)); // (never runaway)
    if (W && H && (cv.width !== W || cv.height !== H)) Object.assign(cv, { width: W, height: H });
    return cv.getContext('2d');
  };
  for (const r of mixRows) {
    if (r.master) continue;
    const el = d.querySelector(`[data-strip="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    el.classList.toggle('open', !!(r.live && r.open?.()));
    const cc = el.querySelector('[data-curve]');
    const sig = JSON.stringify(eqOf(r.st.eq)) + cc.clientWidth;
    if (cc.dataset.sig !== sig) {
      cc.dataset.sig = sig;
      drawCurve(ctxOf(cc), cc.width, cc.height, r.st.eq);
    }
    const an = r.meter?.();
    const lv = an ? peakIn(timeData(an, conL)) : 0;
    const mc = el.querySelector('[data-meter]');
    drawBars(ctxOf(mc), mc.width, mc.height, [lv], [hold(r.id, 0, lv, t)]);
  }
  // the output: meters, readouts, spectrum, waveform, stereo picture
  if (mode === 'live') mixInit();
  const pair = mode === 'live' ? [mix.meterL, mix.meterR] : (player.meterLR ||= stereoMeters(player.ctx, player.limit));
  if (mode !== 'live' && !player.spec) {
    player.spec = player.ctx.createAnalyser();
    player.spec.fftSize = 4096;
    player.spec.smoothingTimeConstant = 0.75;
    player.limit.connect(player.spec);
  }
  const L = timeData(pair[0], conL), R = timeData(pair[1], conR);
  let sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < L.length; i++) {
    sl += L[i] * L[i];
    sr += R[i] * R[i];
    slr += L[i] * R[i];
  }
  const pl = peakIn(L), pr = peakIn(R);
  const mc = d.getElementById('cMeters');
  drawBars(ctxOf(mc), mc.width, mc.height, [pl, pr], [hold('out', 0, pl, t), hold('out', 1, pr, t)]);
  const rmsDb = dbOf(Math.sqrt((sl + sr) / (2 * L.length)));
  conRms = rmsDb > conRms ? rmsDb : conRms * 0.9 + rmsDb * 0.1;
  if (t - conText > 120) {
    conText = t;
    const pk = dbOf(Math.max(conHolds.get('out')?.[0]?.v || 0, conHolds.get('out')?.[1]?.v || 0));
    d.getElementById('rPeak').textContent = pk <= -100 ? '−∞' : `${pk.toFixed(1)} dB`;
    d.getElementById('rRms').textContent = conRms <= -100 ? '−∞' : `${conRms.toFixed(1)} dB`;
    const diff = dbOf(Math.sqrt(sl / L.length)) - dbOf(Math.sqrt(sr / R.length));
    d.getElementById('rBal').textContent = sl + sr < 1e-9 || Math.abs(diff) < 0.5 ? 'C' : `${diff > 0 ? 'L' : 'R'} ${Math.abs(diff).toFixed(1)} dB`;
    d.getElementById('rCorr').textContent = sl * sr > 1e-12 ? (slr / Math.sqrt(sl * sr)).toFixed(2) : '–';
  }
  const spec = mode === 'live' ? mix.spec : player.spec;
  const sc = d.getElementById('cSpec'), oc = d.getElementById('cScope'), vc = d.getElementById('cVec');
  drawSpectrum(ctxOf(sc), sc.width, sc.height, spec, dpr);
  // quiet sound is scaled up to be seen (the waveform says by how much)
  const want = Math.max(1, Math.min(40, 0.8 / Math.max(1e-4, pl, pr)));
  conZoom = want < conZoom ? want : conZoom * 0.97 + want * 0.03;
  drawScope(ctxOf(oc), oc.width, oc.height, L, R, conZoom, dpr);
  drawVector(ctxOf(vc), vc.width, vc.height, L, R, conZoom, dpr);
}
