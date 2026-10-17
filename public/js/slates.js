// Break slates: what's on air during a break (and before the show starts).
// Each look draws its own background, then your message on top of it. Shared by the
// live program, the edit preview and the renderer, so it only uses the 2D context it's
// handed, and anything animated is driven by `t` (ms since the slate came up), never by
// a clock of its own: the same frame always draws the same picture.

const SANS = 'Archivo, system-ui, sans-serif';
const MONO = '"Courier New", ui-monospace, Menlo, monospace';
const TAU = Math.PI * 2;

export const SLATE_LOOKS = [
  ['bars', 'Color bars'],
  ['static', 'Static (snow)'],
  ['standby', 'Please stand by'],
  ['testcard', 'Test card'],
  ['vhs', 'VHS blue screen'],
  ['clock', 'Station clock'],
];
export const slateLookName = (k) => (SLATE_LOOKS.find(([id]) => id === k) || SLATE_LOOKS[0])[1];
/** The sound a look makes when Slate sound is on (the others are silent). */
export const SLATE_SOUND = { bars: 'tone', static: 'hiss' };

/**
 * @param o.message  your text (typed in the studio)
 * @param o.title    the event's name
 * @param o.look     one of SLATE_LOOKS
 * @param o.t        ms since the slate came up (drives static, flicker, counters)
 * @param o.now      wall-clock ms for the station clock and the VHS date
 */
export function drawSlate(g, W, H, o = {}) {
  const opts = {
    message: o.message ?? "We'll be right back",
    title: o.title || '',
    brand: o.brand || 'VUEMesh',
    t: Math.max(0, o.t ?? (typeof performance !== 'undefined' ? performance.now() : 0)),
    now: o.now ?? Date.now(),
  };
  g.save();
  g.textBaseline = 'middle';
  (LOOKS[o.look] || LOOKS.bars)(g, W, H, opts);
  g.restore();
}

// ---------------------------------------------------------------- helpers ----

function rr(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function footer(g, W, H, brand, align = 'right', color = '#ffffffb0', boxed = false) {
  const fs = Math.round(Math.max(11, Math.min(W, H) * 0.024));
  g.font = `600 ${fs}px ${SANS}`;
  g.textAlign = align;
  const x = align === 'center' ? W / 2 : W - 16, y = H - 18;
  if (boxed) {
    const w = g.measureText(`Made with ${brand}`).width + fs;
    g.fillStyle = '#000';
    g.fillRect(align === 'center' ? x - w / 2 : x - w + fs / 2, y - fs * 0.8, w, fs * 1.6);
  }
  g.fillStyle = color;
  g.fillText(`Made with ${brand}`, x, y);
}

function scanlines(g, W, H, a) {
  g.fillStyle = `rgba(0,0,0,${a})`;
  const step = Math.max(2, Math.round(H / 240));
  for (let y = 0; y < H; y += step * 2) g.fillRect(0, y, W, step);
}

function vignette(g, W, H, a) {
  const r = Math.hypot(W, H) / 2;
  const gr = g.createRadialGradient(W / 2, H / 2, r * 0.45, W / 2, H / 2, r);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}

/** A tiny repeatable random generator (xorshift32), so a given frame always looks the same. */
function rng(seed) {
  let s = Math.imul((seed | 0) + 0x632be5ab, 0x9e3779b1) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Snow is drawn small and scaled up, and only redrawn when the frame number changes.
const snowCache = new Map();
function surface(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
function snowImage(w, h, frame) {
  const key = w + 'x' + h;
  let n = snowCache.get(key);
  if (!n) {
    const c = surface(w, h);
    const x = c.getContext('2d');
    n = { c, x, img: x.createImageData(w, h), frame: -1 };
    snowCache.set(key, n);
  }
  if (n.frame !== frame) {
    n.frame = frame;
    const px = new Uint32Array(n.img.data.buffer);
    let s = Math.imul(frame + 1, 0x9e3779b1) >>> 0 || 1;
    for (let i = 0; i < px.length; i++) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      const v = (s >>> 24) & 255;
      px[i] = 0xff000000 | (v << 16) | (v << 8) | v;
    }
    n.x.putImageData(n.img, 0, 0);
  }
  return n.c;
}

// ------------------------------------------------------------------ looks ----

/** SMPTE-style color bars with a plate in the middle (the original VUEMesh slate). */
function bars(g, W, H, o) {
  const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
  const bw = W / 7;
  top.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, 0, bw + 1, H * 0.67); });
  mid.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * bw, H * 0.67, bw + 1, H * 0.08); });
  const base = ['#00214c', '#ffffff', '#32006a', '#131313', '#090909', '#131313', '#1d1d1d', '#131313'];
  const widths = [1.25, 1.25, 1.25, 1.25, 1 / 3, 1 / 3, 1 / 3, 1];
  let x = 0;
  base.forEach((c, i) => { const w = widths[i] * bw; g.fillStyle = c; g.fillRect(x, H * 0.75, w + 1, H * 0.25); x += w; });
  const cw = Math.min(W * 0.78, 900), ch = Math.min(H * 0.34, 260);
  const cx = (W - cw) / 2, cy = (H - ch) / 2 - H * 0.04;
  g.fillStyle = '#0d1226ee';
  g.fillRect(cx, cy, cw, ch);
  g.fillStyle = '#d93025';
  g.fillRect(cx, cy, cw, 6);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = `800 ${Math.round(ch * 0.2)}px ${SANS}`;
  g.fillText(o.message, W / 2, cy + ch * 0.42, cw - 40);
  g.font = `600 ${Math.round(ch * 0.1)}px ${SANS}`;
  g.fillStyle = '#b9bfd6';
  g.fillText(o.title, W / 2, cy + ch * 0.7, cw - 40);
  g.font = `600 ${Math.round(H * 0.022)}px ${SANS}`;
  g.textAlign = 'right';
  g.fillStyle = '#ffffffb0';
  g.fillText(`Made with ${o.brand}`, W - 16, H - 18);
}

/** A set with no signal: snow, a band rolling down, your message on a dark plate. */
function snow(g, W, H, o) {
  const u = Math.min(W, H);
  const nw = Math.max(64, Math.round(W / 4)), nh = Math.max(36, Math.round(H / 4));
  const smooth = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(snowImage(nw, nh, Math.floor(o.t / 40)), 0, 0, W, H);
  g.imageSmoothingEnabled = smooth;
  // a brighter band drifting down, like a picture that won't hold
  const bandH = H * 0.2;
  const y = ((o.t / 9) % (H + bandH * 2)) - bandH;
  const band = g.createLinearGradient(0, y, 0, y + bandH);
  band.addColorStop(0, 'rgba(255,255,255,0)');
  band.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band;
  g.fillRect(0, y, W, bandH);
  scanlines(g, W, H, 0.22);
  vignette(g, W, H, 0.6);
  // the plate, with a little color fringing like an old tube
  const cw = Math.min(W * 0.86, u * 1.5), ch = u * 0.3;
  const cx = (W - cw) / 2, cy = (H - ch) / 2;
  g.fillStyle = 'rgba(0,0,0,0.78)';
  rr(g, cx, cy, cw, ch, u * 0.02);
  g.fill();
  g.textAlign = 'center';
  g.font = `800 ${Math.round(ch * 0.26)}px ${SANS}`;
  const my = cy + ch * (o.title ? 0.4 : 0.5);
  const off = Math.max(1, u * 0.004);
  g.fillStyle = 'rgba(255,40,40,0.8)';
  g.fillText(o.message, W / 2 - off, my, cw - 40);
  g.fillStyle = 'rgba(40,255,255,0.8)';
  g.fillText(o.message, W / 2 + off, my, cw - 40);
  g.fillStyle = '#fff';
  g.fillText(o.message, W / 2, my, cw - 40);
  if (o.title) {
    g.font = `600 ${Math.round(ch * 0.12)}px ${SANS}`;
    g.fillStyle = '#c9cede';
    g.fillText(o.title, W / 2, cy + ch * 0.75, cw - 40);
  }
  footer(g, W, H, o.brand);
}

/** The old "technical difficulties" card: a television set saying PLEASE STAND BY. */
function standby(g, W, H, o) {
  const u = Math.min(W, H);
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#11465c');
  bg.addColorStop(1, '#061823');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  // soft diagonal stripes
  g.save();
  g.globalAlpha *= 0.06;
  g.fillStyle = '#fff';
  const st = u * 0.06;
  for (let x = -H; x < W + H; x += st * 2) {
    g.beginPath();
    g.moveTo(x, H);
    g.lineTo(x + H, 0);
    g.lineTo(x + H + st, 0);
    g.lineTo(x + st, H);
    g.closePath();
    g.fill();
  }
  g.restore();
  // the set: rabbit ears, a wooden cabinet, a warm screen
  const sw = Math.min(W * 0.8, u * 1.45), sh = Math.min(H * 0.6, sw * 0.62);
  const sx = (W - sw) / 2, sy = (H - sh) / 2 + u * 0.05;
  const ax = W / 2, ay = sy - u * 0.03;
  const ears = [[ax - sw * 0.17, ay - u * 0.15], [ax + sw * 0.2, ay - u * 0.13]];
  g.strokeStyle = '#d8c9a3';
  g.lineWidth = Math.max(2, u * 0.008);
  g.lineCap = 'round';
  g.beginPath();
  for (const [x, y] of ears) {
    g.moveTo(ax, ay);
    g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#d8c9a3';
  for (const [x, y] of ears) {
    g.beginPath();
    g.arc(x, y, u * 0.012, 0, TAU);
    g.fill();
  }
  const pad = u * 0.035;
  g.fillStyle = '#5b3a21';
  rr(g, sx - pad, sy - pad, sw + pad * 2, sh + pad * 2, u * 0.05);
  g.fill();
  g.fillStyle = '#3c2614';
  rr(g, sx - pad * 0.4, sy - pad * 0.4, sw + pad * 0.8, sh + pad * 0.8, u * 0.055);
  g.fill();
  const scr = g.createRadialGradient(W / 2, sy + sh / 2, u * 0.05, W / 2, sy + sh / 2, sw * 0.62);
  scr.addColorStop(0, '#f8efd6');
  scr.addColorStop(1, '#d6c296');
  g.fillStyle = scr;
  rr(g, sx, sy, sw, sh, u * 0.06);
  g.fill();
  // the words, flickering a touch
  const flick = 0.93 + 0.07 * Math.sin(o.t / 70) * Math.sin(o.t / 230);
  g.save();
  g.globalAlpha *= flick;
  g.textAlign = 'center';
  const head = 'PLEASE STAND BY';
  g.font = `900 ${Math.round(sh * 0.16)}px ${SANS}`;
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillText(head, W / 2 + u * 0.006, sy + sh * 0.3 + u * 0.006, sw * 0.88);
  g.fillStyle = '#b3261e';
  g.fillText(head, W / 2, sy + sh * 0.3, sw * 0.88);
  g.fillStyle = '#3a2a1a';
  g.fillRect(sx + sw * 0.22, sy + sh * 0.45, sw * 0.56, Math.max(2, u * 0.005));
  const msg = o.message.trim().toUpperCase() === head ? 'We are having technical difficulties' : o.message;
  g.font = `700 ${Math.round(sh * 0.085)}px ${SANS}`;
  g.fillStyle = '#2b2116';
  g.fillText(msg, W / 2, sy + sh * 0.6, sw * 0.84);
  if (o.title) {
    g.font = `600 ${Math.round(sh * 0.056)}px ${SANS}`;
    g.fillStyle = '#6b5638';
    g.fillText(o.title, W / 2, sy + sh * 0.78, sw * 0.84);
  }
  g.restore();
  g.save();
  rr(g, sx, sy, sw, sh, u * 0.06);
  g.clip();
  scanlines(g, W, H, 0.07);
  g.restore();
  vignette(g, W, H, 0.45);
  footer(g, W, H, o.brand);
}

/** A test card (our own): grid, castellated edges, and a big circle of test patterns. */
function testcard(g, W, H, o) {
  const u = Math.min(W, H);
  g.fillStyle = '#6f7378';
  g.fillRect(0, 0, W, H);
  const cell = u / 10;
  g.strokeStyle = '#e6e6e6';
  g.lineWidth = Math.max(1, u / 360);
  g.beginPath();
  for (let x = (W / 2) % cell; x <= W; x += cell) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = (H / 2) % cell; y <= H; y += cell) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  const bs = cell / 2, d = bs * 0.6;
  for (let x = 0, i = 0; x < W; x += bs, i++) { g.fillStyle = i % 2 ? '#111' : '#eee'; g.fillRect(x, 0, bs, d); g.fillRect(x, H - d, bs, d); }
  for (let y = 0, i = 0; y < H; y += bs, i++) { g.fillStyle = i % 2 ? '#eee' : '#111'; g.fillRect(0, y, d, bs); g.fillRect(W - d, y, d, bs); }
  // corner targets
  const cr = u * 0.08;
  for (const [x, y] of [[cr * 1.6, cr * 1.6], [W - cr * 1.6, cr * 1.6], [cr * 1.6, H - cr * 1.6], [W - cr * 1.6, H - cr * 1.6]]) {
    g.beginPath();
    g.arc(x, y, cr, 0, TAU);
    g.fillStyle = '#1a1a1a';
    g.fill();
    g.lineWidth = Math.max(2, u / 220);
    g.strokeStyle = '#eee';
    g.stroke();
    g.beginPath();
    g.moveTo(x - cr, y); g.lineTo(x + cr, y);
    g.moveTo(x, y - cr); g.lineTo(x, y + cr);
    g.stroke();
  }
  // the circle, in eight rows
  const R = u * 0.44, cx = W / 2, cy = H / 2, top = cy - R, row = (R * 2) / 8;
  const L = cx - R, BW = R * 2;
  g.save();
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.clip();
  g.fillStyle = '#262626';
  g.fillRect(L, top, BW, R * 2);
  ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((c, i) => {
    g.fillStyle = c;
    g.fillRect(L + (i * BW) / 7, top + row, BW / 7 + 1, row * 2);
  });
  for (let i = 0; i < 6; i++) {
    const v = Math.round((i / 5) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(L + (i * BW) / 6, top + row * 3, BW / 6 + 1, row);
  }
  for (let s = 0; s < 5; s++) {
    const x0 = L + (s * BW) / 5, w = BW / 5, lw = Math.max(1, (u / 60) / (s + 1));
    g.fillStyle = '#000';
    g.fillRect(x0, top + row * 4, w + 1, row);
    g.fillStyle = '#fff';
    for (let x = x0; x < x0 + w; x += lw * 2) g.fillRect(x, top + row * 4, lw, row);
  }
  g.strokeStyle = '#fff';
  g.lineWidth = Math.max(1, u / 300);
  g.beginPath();
  g.moveTo(L, cy); g.lineTo(L + BW, cy);
  g.moveTo(cx, top); g.lineTo(cx, top + R * 2);
  g.stroke();
  g.fillStyle = '#000';
  g.fillRect(L, top + row * 5, BW, row * 1.5);
  const ramp = g.createLinearGradient(L, 0, L + BW, 0);
  ramp.addColorStop(0, '#000');
  ramp.addColorStop(1, '#fff');
  g.fillStyle = ramp;
  g.fillRect(L, top + row * 6.5, BW, row * 0.8);
  g.fillStyle = '#b8b8b8';
  g.fillRect(L, top + row * 7.3, BW, row);
  // a clock box at the top, like a station's ident card
  const d0 = new Date(o.now);
  const hhmmss = [d0.getHours(), d0.getMinutes(), d0.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  g.fillStyle = '#000';
  g.fillRect(cx - R * 0.42, top + row * 0.3, R * 0.84, row * 0.66);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = `700 ${Math.round(row * 0.46)}px ${MONO}`;
  g.fillText(hhmmss, cx, top + row * 0.64, R * 0.8);
  g.restore();
  g.beginPath();
  g.arc(cx, cy, R, 0, TAU);
  g.lineWidth = Math.max(2, u / 160);
  g.strokeStyle = '#f0f0f0';
  g.stroke();
  // your message (and the event) in the black band
  const chord = (yy) => 2 * Math.sqrt(Math.max(0, R * R - (yy - cy) ** 2));
  const wide = chord(top + row * 6.5) * 0.86;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = `800 ${Math.round(row * (o.title ? 0.56 : 0.66))}px ${SANS}`;
  g.fillText(o.message, cx, top + row * (o.title ? 5.55 : 5.75), wide);
  if (o.title) {
    g.font = `600 ${Math.round(row * 0.3)}px ${SANS}`;
    g.fillStyle = '#c8c8c8';
    g.fillText(o.title, cx, top + row * 6.15, wide);
  }
  footer(g, W, H, o.brand, 'center', '#ffffffd0', true);
}

/** A VCR's blue screen: PLAY, a running counter, the date, tracking noise along the bottom. */
function vhs(g, W, H, o) {
  const u = Math.min(W, H);
  g.fillStyle = '#1531b8';
  g.fillRect(0, 0, W, H);
  const osd = (text, x, y, align, size) => {
    g.font = `700 ${Math.round(size)}px ${MONO}`;
    g.textAlign = align;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(text, x + size * 0.07, y + size * 0.07, W - u * 0.14);
    g.fillStyle = '#f4f4f4';
    g.fillText(text, x, y, W - u * 0.14);
  };
  const m = u * 0.08, fs = u * 0.055;
  const jitter = Math.sin(o.t / 37) > 0.97 ? u * 0.004 : 0; // a small hop now and then
  osd(Math.floor(o.t / 700) % 2 ? 'PLAY' : 'PLAY ▶', m + jitter, m, 'left', fs);
  osd('SP', W - m, m, 'right', fs);
  const s = Math.floor(o.t / 1000);
  osd(`${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, m, H - m, 'left', fs);
  const day = new Date(o.now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase().replace(',', '');
  osd(day, W - m, H - m, 'right', fs);
  osd(o.message.toUpperCase(), W / 2 + jitter, H * (o.title ? 0.45 : 0.5), 'center', u * 0.085);
  if (o.title) osd(o.title.toUpperCase(), W / 2, H * 0.57, 'center', u * 0.042);
  // tracking noise, wandering along the bottom
  const r = rng(Math.floor(o.t / 50));
  const ny = H * (0.84 + 0.035 * Math.sin(o.t / 900)), bandH = H * 0.05;
  for (let i = 0; i < 80; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)';
    g.fillRect(r() * W, ny + r() * bandH, W * (0.04 + r() * 0.3), Math.max(1, u * 0.003));
  }
  scanlines(g, W, H, 0.1);
  footer(g, W, H, o.brand, 'center', '#ffffff90');
}

/** A station clock: sixty dots that light up as the minute goes round, and a sweep hand. */
function stationClock(g, W, H, o) {
  const u = Math.min(W, H);
  const bg = g.createRadialGradient(W / 2, H * 0.4, u * 0.1, W / 2, H * 0.5, Math.hypot(W, H) * 0.6);
  bg.addColorStop(0, '#17223f');
  bg.addColorStop(1, '#04060d');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const R = u * (H > W ? 0.36 : 0.27);
  const cx = W / 2, cy = H * 0.4;
  const d = new Date(o.now);
  const sec = d.getSeconds() + d.getMilliseconds() / 1000;
  const min = d.getMinutes() + sec / 60, hr = (d.getHours() % 12) + min / 60;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU - Math.PI / 2;
    const big = i % 5 === 0;
    g.beginPath();
    g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, big ? u * 0.012 : u * 0.0065, 0, TAU);
    g.fillStyle = big ? '#ffffff' : i <= Math.floor(sec) ? '#f2c037' : '#33405f';
    g.fill();
  }
  const hand = (turn, len, wid, col) => {
    g.save();
    g.translate(cx, cy);
    g.rotate(turn * TAU);
    g.beginPath();
    g.moveTo(0, len * 0.14);
    g.lineTo(0, -len);
    g.lineWidth = wid;
    g.lineCap = 'round';
    g.strokeStyle = col;
    g.stroke();
    g.restore();
  };
  hand(hr / 12, R * 0.5, u * 0.018, '#fff');
  hand(min / 60, R * 0.78, u * 0.012, '#fff');
  hand(sec / 60, R * 0.86, u * 0.005, '#e0362b');
  g.beginPath();
  g.arc(cx, cy, u * 0.014, 0, TAU);
  g.fillStyle = '#e0362b';
  g.fill();
  g.textAlign = 'center';
  const ty = cy + R + u * 0.13;
  g.font = `800 ${Math.round(u * 0.075)}px ${SANS}`;
  g.fillStyle = '#fff';
  g.fillText(o.message, W / 2, ty, W * 0.9);
  if (o.title) {
    g.font = `600 ${Math.round(u * 0.038)}px ${SANS}`;
    g.fillStyle = '#9aa3c4';
    g.fillText(o.title, W / 2, ty + u * 0.075, W * 0.9);
  }
  footer(g, W, H, o.brand);
}

const LOOKS = { bars, static: snow, standby, testcard, vhs, clock: stationClock };
