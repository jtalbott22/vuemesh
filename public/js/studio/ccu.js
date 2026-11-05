// Studio, part 8 of 25: Camera control for the phones.
// Loads after sources.js: that import comes first, so the parts run in order (see ../studio.js).
import './sources.js';
import { toast, esc, announce } from '/js/vm.js';
import { eqOf, EQ_BANDS } from '/js/audiofx.js';
import { $, dbToGain, ev, eventId, gainToDb, hub, live, liveActive, mode, note, player } from './core.js';
import { angleOfCid, saveSeq } from './clips.js';
import { camOrder, cutLive } from './live.js';
import {
  MODES, MODE_LABEL, applyStripFx, conSig, conWin, fmtPan, mixSave, mixState, openConsole, renderMixer,
  setConSig, setConWin, setStripMode, stripNodes, toggleStripMono,
} from './mixer.js';
import { localCtl } from './sources.js';
import { mixRows } from './stream.js';
import { sendDm } from './room.js';
import { renderTimeline } from './edit.js';

// ---------------------------------------------------------- camera control ----
// The control room's camera control (a broadcast "CCU"): its own window with every live
// camera's picture, a histogram and a waveform for each, and the camera's controls. Zoom
// (the phone glides there), brightness (the camera's own exposure where it has it, else
// digital), contrast (digital), focus (click a point in the picture, like tapping the phone),
// focus/exposure lock, white balance lock, and Auto to put it all back. The scopes are worked
// out here, from the pictures this studio already receives: nothing extra is asked of phones.
var ccuWin = null, ccuSig = '', ccuFocus = null; // (var: renderLive can run before this line)
const CCU_CSS = `
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font-size:13px;overflow:hidden}
:root[data-theme="dark"] body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}
@media not all and (prefers-color-scheme: light){:root:not([data-theme]) body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--line);flex:none}
.logo{font-stretch:125%;font-weight:800}.sp{flex:1}.hint{color:var(--muted);font-size:.75rem}
main{flex:1;overflow:auto;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,var(--cw,300px));gap:8px;align-content:start;justify-content:start}
.cw{display:flex;align-items:center;gap:6px;font-size:.72rem;color:var(--text-2)}.cw input{width:120px;accent-color:#f2c037}
.empty{grid-column:1/-1;color:var(--muted);padding:40px;text-align:center}
.cam{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;gap:6px;position:relative;align-content:start}
.cam.air{border-color:var(--tally);box-shadow:0 0 0 1px var(--tally)}
.cam h3{margin:0;font-size:.9rem;display:flex;gap:8px;align-items:center}
.cam h3 .n{background:var(--surface-3);border-radius:4px;padding:0 .45em;font-family:var(--mono)}
.cam h3 .tag{margin-left:auto;font-size:.62rem;letter-spacing:.08em;padding:.15em .5em;border-radius:4px;background:var(--surface-3);color:var(--text-2)}
.cam.air h3 .tag{background:var(--tally);color:#fff}
.pic{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;cursor:crosshair}
.pic canvas{width:100%;height:100%;display:block}
.pic .ret{position:absolute;width:54px;height:54px;margin:-27px 0 0 -27px;border:2px solid #f2c037;border-radius:6px;pointer-events:none;animation:ret 1.2s forwards}
@keyframes ret{0%{transform:scale(1.5);opacity:1}25%{transform:scale(1)}100%{opacity:0}}
.pic .clipwarn{position:absolute;left:6px;bottom:6px;font:700 .62rem var(--mono);background:#000a;color:#fff;padding:1px 5px;border-radius:3px}
.pic .pz{position:absolute;inset:0;display:grid;place-items:center;background:#000a;color:#fff;font-weight:800;letter-spacing:.12em;font-size:.9rem;pointer-events:none}
.scopes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.scopes div{position:relative;background:#050608;border-radius:6px;overflow:hidden;height:72px}
.scopes canvas{width:100%;height:100%;display:block}
.scopes span{position:absolute;left:6px;top:3px;font-size:.6rem;letter-spacing:.08em;color:#8b8e97;pointer-events:none}
.k{display:grid;grid-template-columns:minmax(64px,auto) 1fr 44px;gap:6px;align-items:center;font-size:.64rem;font-weight:700;letter-spacing:.06em;color:var(--text-2)}
.msg{display:flex;gap:4px}.msg input{flex:1;min-width:0;font:inherit;font-size:.78rem;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--field);color:var(--text)}.msg button{font:inherit;font-size:.7rem;font-weight:800;padding:0 .7em;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}.msg .st{font-size:.66rem;color:var(--muted);align-self:center}
.k input{width:100%;accent-color:#f2c037}.k output{font-family:var(--mono);text-align:right;color:var(--text)}
.k small{font-weight:600;letter-spacing:0;color:var(--muted)}
.btns{display:flex;gap:6px;flex-wrap:wrap}
.lenses{display:flex;gap:4px;flex-wrap:wrap}
.lenses button{font:inherit;font-size:.7rem;font-weight:800;min-height:28px;padding:0 .75em;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}
.lenses button[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}
.btns button{font:inherit;font-size:.64rem;font-weight:800;letter-spacing:.04em;min-height:28px;padding:0 .6em;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}
.btns button[aria-pressed="true"]{background:#f2c037;color:#111;border-color:#f2c037}
.btns button:disabled{opacity:.4;cursor:default}
.btns .cut{margin-left:auto;background:var(--tally);border-color:var(--tally);color:#fff}
.off{position:absolute;inset:0;background:#000b;display:grid;place-items:center;text-align:center;padding:20px;border-radius:12px;color:#fff;font-weight:600}
`;
const ccuHtml = (theme) => `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8">
<title>Camera control · ${esc(ev?.title || 'VUEMesh')}</title>
<link rel="stylesheet" href="${location.origin}/css/vm.css"><style>${CCU_CSS}</style></head>
<body><header><b class="logo">Camera control</b><span>${esc(ev?.title || '')}</span><label class="cw">Strip width <input type="range" id="cw" min="220" max="560" step="10" value="${+localStorage.getItem('vm_ccu_w') || 300}" aria-label="Width of each camera's strip"></label><span class="sp"></span>
<span class="hint">Click the picture to focus there · double-click a control to reset it · histogram: R G B and brightness · waveform: brightness across the picture</span></header>
<main id="cams" aria-label="Cameras"></main></body></html>`;

export function openCcu(focusPeer) {
  ccuFocus = focusPeer || null;
  if (ccuWin && !ccuWin.closed) {
    ccuWin.focus();
    ccuSig = '';
    return ccuSync();
  }
  const w = window.open('', 'vuemesh-ccu-' + eventId, 'popup,width=1280,height=860');
  if (!w) return toast('The browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  ccuWin = w;
  ccuSig = '';
  w.document.open();
  w.document.write(ccuHtml(document.documentElement.dataset.theme || ''));
  w.document.close();
  bindCcu(w);
  ccuSync();
  w.requestAnimationFrame((t) => ccuFrame(w, t));
  note('Camera control opened');
}
window.addEventListener('pagehide', () => ccuWin?.close());

const ccuCams = () => camOrder().filter((p) => live.get(p)?.video);
const fmtEv = (v) => (v > 0 ? '+' : '') + (+v).toFixed(1);
function ccuCard(peer) {
  const l = live.get(peer), c = l.cam, n = angleOfCid(l.cid) || '';
  const k = (key, label, v, min, max, step, shown, how, off) => `<label class="k"><span>${label}<br><small>${how}</small></span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}" ${c && !off ? '' : 'disabled'} aria-label="${esc(l.name)}: ${label}"><output data-o="${key}">${shown}</output></label>`;
  return `<section class="cam${peer === liveActive ? ' air' : ''}" data-peer="${esc(peer)}" aria-label="${esc(l.name)}">
    <h3><span class="n">${n}</span>${esc(l.name)}<span class="tag">${peer === liveActive ? 'ON AIR' : 'READY'}</span></h3>
    <div class="pic" data-pic title="Click to focus there"><canvas data-v aria-label="${esc(l.name)}'s picture: click to focus there"></canvas></div>
    <div class="scopes"><div><span>HISTOGRAM</span><canvas data-h aria-hidden="true"></canvas></div><div><span>WAVEFORM</span><canvas data-w aria-hidden="true"></canvas></div></div>
    ${c?.lenses?.length > 1 ? `<div class="lenses" role="group" aria-label="${esc(l.name)}: camera">${c.lenses.map((x) => `<button type="button" data-lens="${esc(x.id)}" aria-pressed="${x.id === c.lens}">${esc(x.label)}</button>`).join('')}</div>` : ''}
    ${c ? `${k('z', 'ZOOM', c.z, c.zmin, c.zmax, 0.01, c.z.toFixed(1) + '×', c.zn ? 'lens' : c.local ? 'not on this camera' : 'digital', c.local && !c.zn)}
    ${k('ev', 'BRIGHTNESS', c.ev, c.evmin, c.evmax, 0.1, fmtEv(c.ev), c.evn ? (c.local ? 'camera' : 'exposure') : c.local ? 'not on this camera' : 'digital', c.local && !c.evn)}
    ${k('ct', 'CONTRAST', c.ct, 0.5, 1.6, 0.01, c.ct.toFixed(2), c.local ? (c.ctn ? 'camera' : 'not on this camera') : 'digital', c.local && !c.ctn)}
    <div class="btns"><button type="button" data-act="lock" aria-pressed="${c.lock}" ${c.canLock ? '' : 'disabled title="This camera can&#39;t lock from a browser"'}>AE/AF LOCK</button><button type="button" data-act="wb" aria-pressed="${c.wb}" ${c.canWb ? '' : 'disabled title="This camera can&#39;t lock white balance from a browser"'}>WB LOCK</button><button type="button" data-act="auto">AUTO</button><button type="button" class="cut" data-act="cut">CUT ${n}</button></div>
    ${l.local ? '<p class="hint" style="margin:0">A camera on this computer: on the studio\u2019s own clock, no beacon needed.</p>' : `<form class="msg" data-msg><input type="text" maxlength="140" placeholder="Message ${esc(l.name)}…" aria-label="Message ${esc(l.name)}"><button type="submit">Send</button></form>`}
    ${c.remote ? '' : `<div class="off">${esc(l.name)} has turned off remote control in the camera's settings.</div>`}`
    : '<p class="hint" style="margin:0">Waiting for this camera to send its settings (it needs VUEMesh 0.21 or later: reload the camera page).</p>'}
  </section>`;
}
export function ccuSync() {
  const w = ccuWin;
  if (!w || w.closed) return;
  const peers = ccuCams();
  const sig = peers.map((p) => `${p}:${!!live.get(p).cam}:${live.get(p).cam?.remote}:${live.get(p).cam?.zmax}:${live.get(p).cam?.evn}:${(live.get(p).cam?.lenses || []).map((x) => x.id).join(',')}`).join('|');
  const main = w.document.getElementById('cams');
  if (!main) return;
  if (sig !== ccuSig) {
    ccuSig = sig;
    main.innerHTML = peers.length ? peers.map(ccuCard).join('') : '<p class="empty">No cameras live yet. Phones show up here as they join.</p>';
    if (ccuFocus) main.querySelector(`[data-peer="${CSS.escape(ccuFocus)}"]`)?.scrollIntoView({ block: 'nearest' });
    ccuFocus = null;
  }
  // values and states, in place (not under a control being dragged)
  main.querySelectorAll('.cam').forEach((el) => {
    const l = live.get(el.dataset.peer), c = l?.cam;
    if (!l) return;
    el.classList.toggle('air', el.dataset.peer === liveActive);
    el.querySelector('.tag').textContent = el.dataset.peer === liveActive ? 'ON AIR' : 'READY';
    if (!c) return;
    for (const [key, v, shown] of [['z', c.z, c.z.toFixed(1) + '×'], ['ev', c.ev, fmtEv(c.ev)], ['ct', c.ct, c.ct.toFixed(2)]]) {
      const r = el.querySelector(`[data-k="${key}"]`);
      if (r && w.document.activeElement !== r && !(r.dataset.touched > Date.now() - 1500)) {
        r.value = String(v);
        el.querySelector(`[data-o="${key}"]`).textContent = shown;
      }
    }
    el.querySelectorAll('[data-lens]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lens === c.lens)));
    el.querySelector('[data-act="lock"]')?.setAttribute('aria-pressed', String(!!c.lock));
    el.querySelector('[data-act="wb"]')?.setAttribute('aria-pressed', String(!!c.wb));
  });
}
const ccuSend = (peer, msg) => (live.get(peer)?.local ? localCtl(peer, msg) : hub?.message(peer, { t: 'camctl', ...msg }));
function bindCcu(w) {
  const d = w.document, last = new Map();
  const send = (peer, key, v, now) => {
    const id = peer + key, t = Date.now();
    if (!now && t - (last.get(id) || 0) < 70) return; // a moving control: about 14 updates a second
    last.set(id, t);
    ccuSend(peer, { [key === 'z' ? 'zoom' : key]: v });
  };
  d.addEventListener('input', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (!r || !card) return;
    r.dataset.touched = Date.now();
    const v = +r.value, key = r.dataset.k;
    card.querySelector(`[data-o="${key}"]`).textContent = key === 'z' ? v.toFixed(1) + '×' : key === 'ev' ? fmtEv(v) : v.toFixed(2);
    send(card.dataset.peer, key, v, false);
  });
  d.addEventListener('change', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (r && card) send(card.dataset.peer, r.dataset.k, +r.value, true);
  });
  d.addEventListener('dblclick', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (!r || !card) return;
    r.value = String({ z: 1, ev: 0, ct: 1 }[r.dataset.k]);
    r.dispatchEvent(new w.Event('input', { bubbles: true }));
    send(card.dataset.peer, r.dataset.k, +r.value, true);
  });
  d.addEventListener('click', (e) => {
    const card = e.target.closest('.cam');
    if (!card) return;
    const peer = card.dataset.peer, l = live.get(peer);
    const lens = e.target.closest('[data-lens]')?.dataset.lens;
    if (lens) return ccuSend(peer, { lens });
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'lock') return ccuSend(peer, { lock: !l?.cam?.lock });
    if (act === 'wb') return ccuSend(peer, { wb: !l?.cam?.wb });
    if (act === 'auto') return ccuSend(peer, { auto: true });
    if (act === 'cut') return cutLive(peer);
    const pic = e.target.closest('[data-pic]');
    if (!pic || !l?.cam?.remote) return;
    // where in the picture: map the click through the letterboxing to the phone's live frame
    const cv = pic.querySelector('canvas'), box = cv.getBoundingClientRect(), dr = cv._drawn;
    if (!dr) return;
    const px = ((e.clientX - box.left) / box.width) * cv.width, py = ((e.clientY - box.top) / box.height) * cv.height;
    const cx = (px - dr.dx) / dr.dw, cy = (py - dr.dy) / dr.dh;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return;
    const r = l.view?.rect || { x: 0, y: 0, w: 1, h: 1 };
    ccuSend(peer, { focus: { u: r.x + cx * r.w, v: r.y + cy * r.h } });
    const ret = d.createElement('div');
    ret.className = 'ret';
    Object.assign(ret.style, { left: e.clientX - pic.getBoundingClientRect().left + 'px', top: e.clientY - pic.getBoundingClientRect().top + 'px' });
    pic.append(ret);
    setTimeout(() => ret.remove(), 1300);
  });
  // messages to the person on that camera (the same as the studio's message box under its tile)
  d.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-msg]'), card = e.target.closest('.cam');
    if (!form || !card) return;
    e.preventDefault();
    const inp = form.querySelector('input'), text = inp.value.trim();
    if (!text) return;
    const ok = sendDm(card.dataset.peer, text);
    inp.value = '';
    let st = form.querySelector('.st');
    if (!st) form.append((st = d.createElement('span'), st.className = 'st', st));
    st.textContent = ok ? 'Sent' : "Couldn't reach them";
    setTimeout(() => (st.textContent = ''), 4000);
  });
  // strip width: a bank of camera controls, as narrow or wide as you like (remembered)
  const cw = d.getElementById('cw');
  const applyCw = () => d.documentElement.style.setProperty('--cw', `${cw.value}px`);
  applyCw();
  cw.addEventListener('input', () => {
    applyCw();
    localStorage.setItem('vm_ccu_w', cw.value);
  });
  // the studio's keys keep working from here (cuts, black, break)
  d.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true }));
  });
}

// Scopes: each picture is shrunk to 160 wide and read back; the histogram counts R, G, B and
// brightness (Rec. 709 luma) in 256 steps; the waveform shows, for every column of the
// picture, how bright its pixels are (bottom black, top white), like a broadcast waveform.
const scopeCv = document.createElement('canvas'), scopeG = scopeCv.getContext('2d', { willReadFrequently: true });
const WAVE_ROWS = 100;
function measurePicture(l) {
  const v = l.video;
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
  const r = l.view?.rect?.w > 0 && l.view.rect.h > 0 ? l.view.rect : { x: 0, y: 0, w: 1, h: 1 };
  const sx = r.x * v.videoWidth, sy = r.y * v.videoHeight, sw = r.w * v.videoWidth, sh = r.h * v.videoHeight;
  if (!(sw >= 1 && sh >= 1)) return null;
  const W = 160, H = Math.max(16, Math.min(284, Math.round((W * sh) / sw)));
  if (scopeCv.width !== W || scopeCv.height !== H) Object.assign(scopeCv, { width: W, height: H });
  scopeG.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  const d = scopeG.getImageData(0, 0, W, H).data;
  const hist = new Uint32Array(1024), wave = new Uint16Array(W * WAVE_ROWS);
  let hi = 0, lo = 0;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2], Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
      hist[R]++;
      hist[256 + G]++;
      hist[512 + B]++;
      hist[768 + Y]++;
      wave[x * WAVE_ROWS + Math.min(WAVE_ROWS - 1, Math.floor((Y / 256) * WAVE_ROWS))]++;
      if (Y >= 250) hi++;
      else if (Y <= 5) lo++;
    }
  }
  return { W, H, hist, wave, hi: hi / (W * H), lo: lo / (W * H) };
}
function drawHistogram(cv, m) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff14';
  for (const f of [0.25, 0.5, 0.75]) g.strokeRect(Math.round(W * f) + 0.5, -1, 0, H + 2);
  if (!m) return;
  let peak = 1;
  for (let i = 0; i < 1024; i++) peak = Math.max(peak, m.hist[i]);
  const ys = (n) => H - Math.sqrt(n / peak) * (H - 12); // (square root: dim tones stay visible)
  g.globalCompositeOperation = 'lighter';
  [['#ff4d4d66', 0], ['#3ddc6b66', 256], ['#4d8dff66', 512]].forEach(([col, o]) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, ys(m.hist[o + i]));
    g.lineTo(W, H);
    g.fill();
  });
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#ffffffcc';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 256; i++) g[i ? 'lineTo' : 'moveTo']((i / 255) * W, ys(m.hist[768 + i]));
  g.stroke();
}
function drawWaveform(cv, m) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#050608';
  g.fillRect(0, 0, W, H);
  if (m) {
    const img = g.createImageData(m.W, WAVE_ROWS), px = img.data, scale = 255 / Math.max(4, (m.H / WAVE_ROWS) * 6);
    for (let x = 0; x < m.W; x++) {
      for (let r = 0; r < WAVE_ROWS; r++) {
        const n = m.wave[x * WAVE_ROWS + r];
        if (!n) continue;
        const a = Math.min(255, 50 + n * scale), o = ((WAVE_ROWS - 1 - r) * m.W + x) * 4;
        px[o] = 90;
        px[o + 1] = 255;
        px[o + 2] = 120;
        px[o + 3] = a;
      }
    }
    if (!cv._tmp) cv._tmp = cv.ownerDocument.createElement('canvas');
    Object.assign(cv._tmp, { width: m.W, height: WAVE_ROWS });
    cv._tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(cv._tmp, 0, 0, W, H);
  }
  // 0, 50 and 100 (black, middle, white)
  g.strokeStyle = '#ffffff22';
  g.fillStyle = '#8b8e97';
  g.font = '9px ui-monospace, monospace';
  for (const [f, label] of [[0, '0'], [0.5, '50'], [1, '100']]) {
    const y = Math.round(H - 2 - f * (H - 14)) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    g.fillText(label, W - 20, y - 2);
  }
}
let ccuLastScope = 0;
function ccuFrame(w, t) {
  if (w.closed || ccuWin !== w) return;
  // the next frame is booked first, and each camera is drawn on its own: one camera's
  // trouble (a picture that isn't ready, a phone that just left) can't stop the window
  w.requestAnimationFrame((t2) => ccuFrame(w, t2));
  const scopesDue = t - ccuLastScope > 120; // about 8 times a second
  if (scopesDue) ccuLastScope = t;
  w.document.querySelectorAll('.cam').forEach((el) => {
    try {
      ccuDrawCard(w, el, scopesDue);
    } catch (err) {
      if (!el._warned) console.warn('camera control: drawing', el.dataset.peer, err);
      el._warned = true;
    }
  });
}
function ccuDrawCard(w, el, scopesDue) {
  {
    const l = live.get(el.dataset.peer);
    const cv = el.querySelector('[data-v]');
    if (!l || !cv) return;
    const box = cv.getBoundingClientRect(), dpr = w.devicePixelRatio || 1;
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (cv.width !== W || cv.height !== H) Object.assign(cv, { width: W, height: H });
    const g = cv.getContext('2d'), v = l.video;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (v?.readyState >= 2 && v.videoWidth) {
      const r = l.view?.rect || { x: 0, y: 0, w: 1, h: 1 };
      const sw = r.w * v.videoWidth, sh = r.h * v.videoHeight, k = Math.min(W / sw, H / sh);
      const dw = sw * k, dh = sh * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
      g.drawImage(v, r.x * v.videoWidth, r.y * v.videoHeight, sw, sh, dx, dy, dw, dh);
      cv._drawn = { dx, dy, dw, dh };
    }
    // paused by the person on the camera: say so, as the studio's tile does
    let pz = el.querySelector('.pz');
    if (l.paused && !pz) {
      pz = w.document.createElement('span');
      pz.className = 'pz';
      pz.textContent = 'PAUSED';
      el.querySelector('[data-pic]').append(pz);
    } else if (!l.paused && pz) pz.remove();
    if (scopesDue) {
      const m = measurePicture(l);
      for (const [sel, fn] of [['[data-h]', drawHistogram], ['[data-w]', drawWaveform]]) {
        const sc = el.querySelector(sel), sb = sc.getBoundingClientRect();
        const SW = Math.round(sb.width * dpr), SH = Math.round(sb.height * dpr);
        if (sc.width !== SW || sc.height !== SH) Object.assign(sc, { width: SW, height: SH });
        fn(sc, m);
      }
      let warn = el.querySelector('.clipwarn');
      const say = m && (m.hi > 0.02 || m.lo > 0.2) ? [m.hi > 0.02 ? `${Math.round(m.hi * 100)}% clipped white` : '', m.lo > 0.2 ? `${Math.round(m.lo * 100)}% crushed black` : ''].filter(Boolean).join(' · ') : '';
      if (say && !warn) {
        warn = w.document.createElement('span');
        warn.className = 'clipwarn';
        el.querySelector('[data-pic]').append(warn);
      }
      if (warn) say ? (warn.textContent = say) : warn.remove();
    }
  }
}
$('#ccuBtn').onclick = () => openCcu();
document.querySelectorAll('[data-console]').forEach((b) => (b.onclick = openConsole));

const fmtEq = (v) => (v > 0 ? '+' : '') + (+v).toFixed(1);
function conStrip(r) {
  const st = r.st, eq = eqOf(st.eq), pan = st.pan || 0;
  const knob = (k, label, v, min, max, step, shown) => `<label class="k"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(r.name)}: ${label}"><output data-o="${k}">${shown}</output></label>`;
  const btns = r.live
    ? MODES.map((m) => `<button type="button" data-amode="${m}" aria-pressed="${st.mode === m}">${MODE_LABEL[m]}</button>`).join('') + `<button type="button" data-mono aria-pressed="${!!st.mono}" title="Play both channels as one (off: stereo)">MONO</button>`
    : `${r.track?.follow ? `<button type="button" data-duck aria-pressed="${!!r.track.duck}" title="Quiet while a microphone recording plays, on everywhere else">DUCK</button>` : ''}<button type="button" data-mono aria-pressed="${!!st.mono}" title="Play both channels as one">MONO</button><button type="button" data-mute aria-pressed="${!!st.muted}">MUTE</button>`;
  return `<div class="ch${r.live && r.open?.() ? ' open' : ''}" data-strip="${esc(r.id)}">
    <h3 title="${esc(r.name)}">${esc(r.name)}</h3>
    <div class="btns">${btns}</div>
    <div class="eq"><div class="lbl">EQ <button type="button" data-hp aria-pressed="${eq.hp}" title="High-pass at ${EQ_BANDS.hp} Hz: takes out rumble, wind and handling noise">HPF ${EQ_BANDS.hp}</button></div><canvas data-curve aria-hidden="true"></canvas></div>
    ${knob('high', 'HIGH', eq.high, -12, 12, 0.5, fmtEq(eq.high))}
    ${knob('mid', 'MID', eq.mid, -12, 12, 0.5, fmtEq(eq.mid))}
    ${knob('low', 'LOW', eq.low, -12, 12, 0.5, fmtEq(eq.low))}
    ${knob('pan', 'BAL', Math.round(pan * 100), -100, 100, 1, fmtPan(pan))}
    <div class="fd"><canvas data-meter aria-hidden="true"></canvas><input type="range" data-k="gain" min="-60" max="12" step="1" value="${gainToDb(st.gain ?? 1)}" aria-label="${esc(r.name)}: level"></div>
    <output class="db" data-o="gain">${gainToDb(st.gain ?? 1)} dB</output>
  </div>`;
}

/** Bring the console in line with the mixer (rebuilt when the channels change, else updated in place). */
export function consoleSync() {
  const w = conWin;
  if (!w) return;
  if (w.closed) return (setConWin(null));
  const d = w.document, box = d.getElementById('strips');
  if (!box) return;
  d.getElementById('room').textContent = mode === 'live' ? 'LIVE' : 'EDIT';
  d.getElementById('room').className = 'room' + (mode === 'edit' ? ' edit' : '');
  d.getElementById('cListenRow').hidden = mode !== 'live';
  d.getElementById('cListen').checked = $('#listen').checked;
  d.getElementById('outName').textContent = mode === 'live' ? 'Program' : 'Master';
  const rows = mixRows.filter((r) => !r.master);
  const sig = mode + '|' + rows.map((r) => `${r.id}:${r.name}:${r.live ? 'l' : 't'}`).join('|');
  if (sig !== conSig) {
    setConSig(sig);
    box.innerHTML = rows.length ? rows.map(conStrip).join('') : `<p class="empty">${mode === 'live' ? 'No phones with sound yet.' : 'No audio tracks yet.'}</p>`;
    return;
  }
  for (const r of rows) {
    const el = box.querySelector(`[data-strip="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    el.querySelectorAll('[data-amode]').forEach((b) => b.setAttribute('aria-pressed', String(r.st.mode === b.dataset.amode)));
    el.querySelector('[data-mute]')?.setAttribute('aria-pressed', String(!!r.st.muted));
    el.querySelector('[data-mono]')?.setAttribute('aria-pressed', String(!!r.st.mono));
    const eq = eqOf(r.st.eq);
    el.querySelector('[data-hp]')?.setAttribute('aria-pressed', String(eq.hp));
    const vals = { gain: gainToDb(r.st.gain ?? 1), high: eq.high, mid: eq.mid, low: eq.low, pan: Math.round((r.st.pan || 0) * 100) };
    for (const [k, v] of Object.entries(vals)) {
      const inp = el.querySelector(`input[data-k="${k}"]`);
      if (inp && d.activeElement !== inp) inp.value = String(v);
      const o = el.querySelector(`[data-o="${k}"]`);
      if (o) o.textContent = k === 'gain' ? `${v} dB` : k === 'pan' ? fmtPan(v / 100) : fmtEq(v);
    }
  }
}

/** Change one setting on one channel, from the console. */
export function conSet(r, k, v) {
  if (k === 'gain') {
    const g = dbToGain(v);
    if (r.track) {
      r.track.gain = g;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), gain: g });
      stripNodes(r)?.fader.gain.setTargetAtTime(g, player.ctx.currentTime, 0.02);
    }
  } else {
    const patch = k === 'pan' ? { pan: v / 100 } : { eq: { ...eqOf(r.st.eq), [k]: k === 'hp' ? !!v : v } };
    if (r.track) {
      Object.assign(r.track, patch);
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), ...patch });
      applyStripFx(stripNodes(r), mixState(r.id, r.role), true);
    }
  }
  renderMixer();
}

export function bindConsole(w) {
  const d = w.document;
  const rowOf = (el) => {
    const s = el.closest('[data-strip]');
    return s && mixRows.find((x) => x.id === s.dataset.strip);
  };
  d.addEventListener('input', (e) => {
    const inp = e.target.closest?.('input[data-k]');
    const r = inp && rowOf(inp);
    if (r) conSet(r, inp.dataset.k, +inp.value);
  });
  d.addEventListener('dblclick', (e) => {
    const inp = e.target.closest?.('input[data-k]');
    const r = inp && rowOf(inp);
    if (!r) return;
    inp.value = '0';
    conSet(r, inp.dataset.k, 0);
  });
  d.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    const r = b && rowOf(b);
    if (!r) return;
    if (b.dataset.amode) {
      setStripMode(r.id, r.role, b.dataset.amode);
      announce(`${r.name}: ${MODE_LABEL[b.dataset.amode]}`);
    } else if (b.hasAttribute('data-hp')) conSet(r, 'hp', !eqOf(r.st.eq).hp);
    else if (r.live && b.hasAttribute('data-mono')) toggleStripMono(r);
    else if (r.track && (b.hasAttribute('data-mute') || b.hasAttribute('data-mono') || b.hasAttribute('data-duck'))) {
      if (b.hasAttribute('data-mute')) {
        r.track.muted = !r.track.muted;
        r.track.touched = true;
      } else if (b.hasAttribute('data-duck')) {
        r.track.duck = !r.track.duck;
        r.track.touched = true;
      } else r.track.mono = !(r.track.mono !== false);
      saveSeq();
      player.refreshMix();
      renderMixer();
      renderTimeline();
    }
  });
  d.getElementById('cListen').addEventListener('change', (e) => {
    $('#listen').checked = e.target.checked;
    $('#listen').onchange({ target: $('#listen') });
  });
  // the studio's own keys work from here (cut with 1–9, B, X, T, M…)
  d.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, input[type=checkbox]')) return;
    if (e.target.matches?.('input[type=range]') && /^(Arrow|Page|Home|End)/.test(e.key)) return;
    const copy = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
    document.body.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  });
  w.addEventListener('pagehide', () => {
    if (conWin === w) setConWin(null);
  });
}
