// Shared client helpers for every VUEMesh page.
import { bgClear, bgInterval, bgTimeout } from '/js/bgclock.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/** High-resolution wall clock in ms (same basis as the beacon's timecode). */
export const now = () => performance.timeOrigin + performance.now();

export const params = new URLSearchParams(location.search);
export const eventIdFromUrl = () => (params.get('e') || '').toUpperCase();

// --- config -------------------------------------------------------------------
// config.js (written at deploy time) points the app at the AWS endpoints.

const CFG = window.VM_CONFIG || {};
const API = (CFG.api || '/api').replace(/\/$/, '');
const WS = CFG.ws || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// Public STUN only. No TURN: media stays on the local network, so there is no relay bill.
export const ICE = CFG.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }];

// The app kept on this device (sw.js): opened again with no internet, it still works, and can join
// a show by QR code. (Online nothing changes: everything still comes from the network.)
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // (the first time, this page and what it loaded came before the worker was there to keep them: it keeps them now)
  navigator.serviceWorker.ready.then((r) => setTimeout(() => r.active?.postMessage({ t: 'keep', urls: [location.href, ...performance.getEntriesByType('resource').map((x) => x.name)] }), 2000)).catch(() => {});
}

// --- API ---------------------------------------------------------------------

// ---- web traffic: one anonymous page view per page load (no cookies, nothing stored here).
// Not on the admin pages, and not for anyone whose browser asks not to be tracked.
const TRACK = !/^\/admin/.test(location.pathname) && navigator.doNotTrack !== '1' && !navigator.globalPrivacyControl;
function send(body) {
  if (!TRACK) return;
  const data = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.(API + '/hit', data)) return;
  } catch {}
  fetch(API + '/hit', { method: 'POST', body: data, keepalive: true }).catch(() => {});
}
/** Something worth counting happened on this page (a film played, say): `film:wedding:play`. */
export function trackEvent(ev) {
  send({ p: location.pathname, ev });
}
if (!window.__vmViewed) {
  window.__vmViewed = true; // (once per page, however many modules load this)
  const q = new URLSearchParams(location.search);
  send({ p: location.pathname, r: document.referrer || '', u: q.get('utm_source') || q.get('ref') || '' });
}

export async function api(path, { method = 'GET', body, host, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  if (host) h['X-Host-Key'] = host;
  const res = await fetch(`${API}/${path}`, { method, body, headers: h });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}


// --- host keys (kept on the device that created the event) --------------------

export function hostKey(eventId) {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  if (fromHash) {
    localStorage.setItem('vm_host_' + eventId, fromHash);
    history.replaceState(null, '', location.pathname + location.search);
  }
  return localStorage.getItem('vm_host_' + eventId);
}

/** Remember an event on this device (as its host, or as a guest who shot at it). */
export function rememberEvent(ev, role = 'host') {
  const all = JSON.parse(localStorage.getItem('vm_events') || '[]');
  const old = all.find((x) => x.id === ev.id);
  const list = all.filter((x) => x.id !== ev.id);
  list.unshift({ id: ev.id, title: ev.title, at: Date.now(), createdAt: ev.createdAt || old?.createdAt || null, role: old?.role === 'host' ? 'host' : role, archived: !!old?.archived });
  localStorage.setItem('vm_events', JSON.stringify(list.slice(0, 100)));
}

export function updateRemembered(id, fields) {
  const list = JSON.parse(localStorage.getItem('vm_events') || '[]').map((x) => (x.id === id ? { ...x, ...fields } : x));
  localStorage.setItem('vm_events', JSON.stringify(list));
}

/** Forget an event on this device: the list entry and every setting saved under its code. */
export function forgetEventLocally(id) {
  localStorage.setItem('vm_events', JSON.stringify(myEvents().filter((x) => x.id !== id)));
  for (const store of [localStorage, sessionStorage]) {
    for (const k of Object.keys(store)) if (k.startsWith('vm_') && k.endsWith('_' + id)) store.removeItem(k);
  }
}

export const myEvents = () => JSON.parse(localStorage.getItem('vm_events') || '[]');

// --- contributor identity: an ECDSA P-256 key that lives on this phone --------

export async function identity() {
  const stored = localStorage.getItem('vm_identity');
  if (stored) {
    const { priv, pub } = JSON.parse(stored);
    const key = await crypto.subtle.importKey('jwk', priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { key, jwk: pub };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const full = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pub = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
  localStorage.setItem('vm_identity', JSON.stringify({ priv, pub }));
  return { key: pair.privateKey, jwk: pub };
}

export async function signStatement(key, statement) {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(JSON.stringify(statement)),
  );
  return b64url(new Uint8Array(sig));
}

export async function sha256hex(data) {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexConcat(hexes) {
  const out = new Uint8Array(hexes.length * 32);
  hexes.forEach((h, i) => {
    for (let j = 0; j < 32; j++) out[i * 32 + j] = parseInt(h.substr(j * 2, 2), 16);
  });
  return out;
}

export function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- QR ----------------------------------------------------------------------

/** Draw a QR code into a canvas at a fixed pixel size (quiet zone included). */
export function drawQR(canvas, text, { size = 512, dark = '#1a2038', light = '#ffffff', ecl = 'L' } = {}) {
  const qr = window.qrcode(0, ecl);
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = Math.floor(size / (n + quiet * 2));
  const px = cell * (n + quiet * 2);
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  const g = canvas.getContext('2d');
  g.fillStyle = light;
  g.fillRect(0, 0, px, px);
  g.fillStyle = dark;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
}

/** The beacon QR is a join link that also carries the beacon clock: …/cam?e=ID#t=ms */
export function timecodeUrl(eventId, t) {
  return `${location.origin}/cam?e=${eventId}#t=${Math.round(t)}`;
}

export function parseTimecode(text) {
  const m = /[?&]e=([A-Z0-9]{6}).*#t=(\d{12,14})/i.exec(text || '');
  return m ? { e: m[1].toUpperCase(), t: Number(m[2]) } : null;
}

let detector;
let worker = null;
let nextId = 0;
const waiting = new Map();
function qrWorker() {
  if (worker === null) {
    try {
      worker = new Worker('/js/qrworker.js');
      worker.onmessage = (e) => {
        waiting.get(e.data.id)?.(e.data.text);
        waiting.delete(e.data.id);
      };
    } catch {
      worker = false;
    }
  }
  return worker;
}

/**
 * Decode a QR from a canvas. Uses the native BarcodeDetector when there is one,
 * otherwise jsQR in a background worker (so the camera never stutters), and only
 * falls back to the main thread if workers aren't available.
 */
export async function decodeQR(canvas) {
  if ('BarcodeDetector' in window) {
    try {
      detector ||= new window.BarcodeDetector({ formats: ['qr_code'] });
      const found = await detector.detect(canvas);
      return found[0]?.rawValue || null;
    } catch {
      detector = null;
    }
  }
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, canvas.width, canvas.height);
  const w = qrWorker();
  if (w) {
    const id = ++nextId;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      w.postMessage({ id, data: img.data.buffer, width: img.width, height: img.height }, [img.data.buffer]);
      setTimeout(() => waiting.has(id) && (waiting.delete(id), resolve(null)), 2000);
    });
  }
  const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  return res?.data || null;
}

// --- formatting ----------------------------------------------------------------

export function fmtClock(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function fmtDur(ms) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const f = Math.floor((ms % 1000) / (1000 / 30));
  const p = (n) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${h ? h + ':' : ''}${p(m)}:${p(sec)}:${p(f)}`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let toastTimer;
export function toast(msg, ms = 2600) {
  diag('message', msg);
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

// --- signaling socket ------------------------------------------------------------
// The only always-on link to the cloud: who's here, and WebRTC handshakes.

/**
 * @param {object} o
 * @param {string} o.eventId
 * @param {'host'|'cam'|'beacon'|'viewer'} o.role
 * @param {(peers:object[], you:string)=>void} [o.onPeers]
 * @param {(from:string, data:object, fromRole:string)=>void} [o.onSignal]
 */
/** @param o.url another server's address (this computer's local show, vuemesh-local.mjs) @param o.peer this one's id, the same on both */
export function meshSocket({ eventId, role, name = '', cid = '', hostKey = '', onPeers, onSignal, url = WS, peer = crypto.randomUUID().replace(/-/g, '').slice(0, 16) }) {
  let ws;
  let closed = false;
  let delay = 1000;
  let pingTimer;
  let heardTimer;
  let status = null;
  const self = {
    peer,
    peers: [],
    connected: false,
    opens: 0, // (how many times it has connected: a page that must say who it is again after each)
    send(obj) {
      if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
    },
    signal(to, data) {
      self.send({ action: 'signal', to, data });
    },
    setRecording(rec) {
      status = rec;
      self.send({ action: 'status', rec });
    },
    close() {
      closed = true;
      bgClear(pingTimer);
      bgClear(heardTimer);
      ws?.close();
      globalThis.vmSockets = globalThis.vmSockets.filter((s) => s !== self);
    },
    /** Tests: as if the server dropped this connection (AWS cuts every one at two hours); it comes back. */
    blip() {
      ws?.close();
    },
  };
  (globalThis.vmSockets ||= []).push(self); // (tests: every server connection on the page, to drop one)
  // Connected, but the server doesn't answer: it has no record of this connection (an older server
  // took it for gone), so nobody can reach it. Connect again rather than sit there unreachable.
  const expectAnswer = () => {
    bgClear(heardTimer);
    heardTimer = bgTimeout(() => ws?.readyState === 1 && abandon(), 10000);
  };
  // (let it go now and connect again: on a connection that has died on the way, close() waits for an
  // answer that won't come, and a reconnect after it could be a minute off)
  const abandon = () => {
    const old = ws;
    old.onopen = old.onmessage = old.onclose = null;
    try { old.close(); } catch {}
    lost();
  };
  // A studio checks its connection every 30 s, not only every 4 minutes: one that has quietly died (a
  // network blip, and this side never heard it close) leaves the server with no studio, and phones
  // joining meanwhile wait at "Host not here yet". The server answers each ping (one that says so,
  // in its first list: the local show helper may keep an older copy that doesn't), and no answer in
  // 10 s means connect again. Anything else stays at 4 minutes (API Gateway idles out at 10).
  const PING_MS = role === 'host' ? 30 * 1000 : 4 * 60 * 1000;
  let answers = false;
  const ping = () => {
    self.send({ action: 'ping' });
    if (answers && ws?.readyState === 1) expectAnswer();
  };
  const open = () => {
    const q = new URLSearchParams({ e: eventId, role, peer, name, cid });
    if (hostKey) q.set('k', hostKey);
    ws = new WebSocket(`${url}?${q}`);
    ws.onopen = () => {
      delay = 1000;
      self.connected = true;
      self.opens++;
      self.send({ action: 'hello' });
      expectAnswer();
      if (status !== null) self.send({ action: 'status', rec: status });
      bgClear(pingTimer);
      pingTimer = bgInterval(ping, PING_MS);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'rejoin') return ws.close(); // (the server lost this connection: connect again)
      bgClear(heardTimer); // (anything from the server: it knows this connection)
      if (msg.type === 'peers') {
        if (msg.pong) answers = true;
        self.peers = msg.peers;
        onPeers?.(msg.peers, msg.you);
      } else if (msg.type === 'signal') {
        onSignal?.(msg.from, msg.data, msg.fromRole);
      }
    };
    ws.onclose = lost;
  };
  function lost() {
    self.connected = false;
    bgClear(pingTimer);
    bgClear(heardTimer);
    // (on the worker clock: a hidden studio reconnects at once, not a minute later, so a TV finds it)
    if (!closed) bgTimeout(open, (delay = Math.min(delay * 2, 15000)));
  }
  open();
  return self;
}

/**
 * One studio, two servers: the cloud's, and this computer's own on its hotspot (vuemesh-local.mjs).
 * A phone is on one or the other; what the studio says to it goes where it is.
 */
export function joinSockets(main) {
  const extra = [];
  const all = () => [main, ...extra];
  return {
    get peer() { return main.peer; },
    get connected() { return all().some((s) => s.connected); },
    get cloud() { return main.connected; },
    get local() { return extra.some((s) => s.connected); },
    get peers() {
      const seen = new Set(), out = [];
      for (const s of all()) for (const p of s.peers) if (!seen.has(p.peer)) (seen.add(p.peer), out.push(p));
      return out;
    },
    signal(to, data) {
      const s = all().find((x) => x.connected && x.peers.some((p) => p.peer === to));
      if (s) return s.signal(to, data);
      for (const x of all()) x.signal(to, data);
    },
    send(obj) { for (const s of all()) s.send(obj); },
    setRecording(rec) { for (const s of all()) s.setRecording(rec); },
    close() { for (const s of all()) s.close(); },
    add(s) { extra.push(s); },
    remove(s) {
      const i = extra.indexOf(s);
      if (i >= 0) extra.splice(i, 1);
      s.close();
    },
  };
}

// --- signatures (verified on the host laptop, no server needed) ---------------------

export async function thumbprint(jwk) {
  const canon = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return b64url(new Uint8Array(d)).slice(0, 16);
}

export async function verifyStatement(jwk, sig, statement) {
  try {
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const bin = atob(String(sig).replace(/-/g, '+').replace(/_/g, '/'));
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Uint8Array.from(bin, (c) => c.charCodeAt(0)), new TextEncoder().encode(JSON.stringify(statement)));
  } catch {
    return false;
  }
}

export async function wakeLock() {
  try {
    return await navigator.wakeLock?.request('screen');
  } catch {
    return null;
  }
}

// --- theme ---------------------------------------------------------------------------
// Auto follows the device; the button cycles Auto → Light → Dark.

const THEMES = ['auto', 'light', 'dark'];
export function currentTheme() {
  return localStorage.getItem('vm_theme') || 'auto';
}
export function setTheme(t) {
  if (t === 'auto') {
    localStorage.removeItem('vm_theme');
    delete document.documentElement.dataset.theme;
  } else {
    localStorage.setItem('vm_theme', t);
    document.documentElement.dataset.theme = t;
  }
  document.querySelectorAll('[data-theme-btn]').forEach(label);
}
// A small symbol button (◐ follows the device, ☀ light, ☾ dark) so it never crowds a title.
function label(btn) {
  const t = currentTheme();
  const name = { auto: 'Auto (follows this device)', light: 'Light', dark: 'Dark' }[t];
  btn.innerHTML = `<span aria-hidden="true">${{ auto: '◐', light: '☀', dark: '☾' }[t]}</span>`;
  btn.setAttribute('aria-label', `Color theme: ${name}. Activate to change.`);
  btn.title = `Theme: ${name}`;
}
export function themeButton(btn) {
  btn.dataset.themeBtn = '';
  btn.classList.add('theme-btn');
  label(btn);
  btn.addEventListener('click', () => setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]));
  return btn;
}

// --- screen-reader announcements -------------------------------------------------------

let live;
export function announce(msg) {
  if (!live) {
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('role', 'status');
    document.body.append(live);
  }
  live.textContent = '';
  requestAnimationFrame(() => (live.textContent = msg));
}

// --- help dialog (shortcuts and how-tos) ---------------------------------------------------

/**
 * @param {string} title
 * @param {{heading:string, rows?:[string,string][], text?:string}[]} sections  rows: [keys, what it does]
 */
export function helpDialog(title, sections) {
  const d = document.createElement('dialog');
  d.className = 'help';
  d.setAttribute('aria-labelledby', 'helpTitle');
  const keys = (k) => k.split(' ').map((x) => (['/', 'or', '+', '–'].includes(x) ? ` ${x} ` : `<kbd>${esc(x)}</kbd>`)).join('');
  d.innerHTML = `<div class="hd"><h2 id="helpTitle">${esc(title)}</h2><button type="button" class="ghost" data-close>Close</button></div>
    <div class="bd">${sections
      .map((s) => `<h3>${esc(s.heading)}</h3>${s.text ? `<p>${s.text}</p>` : ''}${s.rows ? `<table>${s.rows.map(([k, v]) => `<tr><td>${keys(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}`)
      .join('')}</div>`;
  d.querySelector('[data-close]').onclick = () => d.close();
  d.addEventListener('click', (e) => e.target === d && d.close());
  document.body.append(d);
  return d;
}

// ---- diagnostics: a report to copy and send when something goes wrong ------------------
// Keeps the last errors, warnings and on-screen messages, and describes this device:
// browser, which video formats it can record and play, network, storage. Nothing leaves
// the device unless the person copies or shares the report.

const diagLog = [];
export function diag(kind, text) {
  diagLog.unshift({ at: new Date().toTimeString().slice(0, 8), kind, text: String(text).slice(0, 400) });
  diagLog.length = Math.min(diagLog.length, 80);
}
(() => {
  if (typeof window === 'undefined' || window.__vmDiag) return;
  window.__vmDiag = true;
  addEventListener('error', (e) => diag('error', `${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno || '?'})`));
  addEventListener('unhandledrejection', (e) => diag('error', `Unhandled: ${e.reason?.message || e.reason}`));
  for (const k of ['warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => {
      diag(k, a.map((x) => (x instanceof Error ? x.message : typeof x === 'object' ? (() => { try { return JSON.stringify(x).slice(0, 200); } catch { return String(x); } })() : String(x))).join(' '));
      orig(...a);
    };
  }
})();

const FORMATS = [
  ['MP4 · H.264 + AAC', 'video/mp4;codecs=avc1.42E01F,mp4a.40.2'],
  ['MP4 · H.264 + Opus', 'video/mp4;codecs=avc1,opus'],
  ['MP4 · VP9 + Opus', 'video/mp4;codecs=vp09.00.10.08,opus'],
  ['MP4 (browser\'s choice)', 'video/mp4'],
  ['WebM · VP9 + Opus', 'video/webm;codecs=vp9,opus'],
  ['WebM · H.264 + Opus', 'video/webm;codecs=h264,opus'],
];
/** What this browser can record (MediaRecorder) and play (<video>). */
export function mediaSupport() {
  const v = document.createElement('video');
  return FORMATS.map(([name, mime]) => `${name}: record ${window.MediaRecorder?.isTypeSupported?.(mime) ? 'yes' : 'no'}, play ${v.canPlayType(mime) || 'no'}`);
}

/** Read which video and audio codecs a recorded file actually uses (from its header). */
export async function codecsOf(blob) {
  const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer());
  let s = '';
  for (let i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
  const video = /avc1|avc3/.test(s) ? 'H.264' : /hvc1|hev1/.test(s) ? 'HEVC' : /vp09|V_VP9/.test(s) ? 'VP9' : /vp08|V_VP8/.test(s) ? 'VP8' : /av01|V_AV1/.test(s) ? 'AV1' : '?';
  const audio = /mp4a/.test(s) ? 'AAC' : /Opus|A_OPUS/.test(s) ? 'Opus' : '?';
  const container = /ftyp/.test(s.slice(0, 64)) ? 'MP4' : s.charCodeAt(0) === 0x1a ? 'WebM' : '?';
  // iPhones play H.264 or HEVC in MP4 (with AAC, or Opus on recent iOS)
  return { container, video, audio, iphone: container === 'MP4' && (video === 'H.264' || video === 'HEVC') };
}

/** The full report. `sections` is [heading, [lines]] pairs from the page. */
export async function diagnosticsReport(sections = []) {
  const { APP_VERSION } = await import('/js/brand.js');
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const c = navigator.connection;
  const lines = [
    `VUEMesh ${APP_VERSION} diagnostics · ${new Date().toISOString()}`,
    `Page: ${location.pathname}${location.search}`,
    `Browser: ${navigator.userAgent}`,
    `Screen: ${screen.width}×${screen.height} @${devicePixelRatio}x · touch ${navigator.maxTouchPoints} · cores ${navigator.hardwareConcurrency || '?'} · memory ${navigator.deviceMemory || '?'} GB`,
    `Network: ${c ? `${c.effectiveType || '?'}${c.downlink ? `, ~${c.downlink} Mbps` : ''}` : 'unknown'} · online ${navigator.onLine}`,
    `Storage: ${est ? `${Math.round(est.usage / 1048576)} MB used of ${Math.round(est.quota / 1048576)} MB` : 'unknown'}`,
    '',
    'Video formats (record / play):',
    ...mediaSupport().map((l) => '  ' + l),
  ];
  for (const [h, ls] of sections) lines.push('', h + ':', ...ls.map((l) => '  ' + l));
  lines.push('', 'Recent messages, warnings and errors (newest first):', ...(diagLog.length ? diagLog.map((e) => `  ${e.at} ${e.kind}: ${e.text}`) : ['  (none)']));
  return lines.join('\n');
}

/** A dialog showing the report, with Copy (and Share on phones). */
export function diagnosticsDialog(getSections) {
  let d = document.querySelector('#diagDlg');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'diagDlg';
    d.className = 'help';
    d.setAttribute('aria-labelledby', 'diagTitle');
    d.innerHTML = `<div class="hd"><h2 id="diagTitle">Diagnostics</h2><button type="button" class="ghost" data-close>Close</button></div>
      <div class="bd"><p>Copy this and send it to whoever helps you with VUEMesh. It describes this device and what just happened; it doesn't include your recordings.</p>
      <textarea id="diagText" readonly rows="14" style="width:100%;font:12px/1.4 var(--mono, monospace)" aria-label="Diagnostics report"></textarea>
      <div class="row" style="gap:8px;margin-top:8px"><button type="button" id="diagCopy" class="primary">Copy</button><button type="button" id="diagShare" hidden>Share…</button></div></div>`;
    document.body.append(d);
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelector('#diagCopy').onclick = async () => {
      const t = d.querySelector('#diagText');
      try { await navigator.clipboard.writeText(t.value); toast('Copied'); } catch { t.select(); document.execCommand('copy'); toast('Copied'); }
    };
    const sh = d.querySelector('#diagShare');
    sh.hidden = !navigator.share;
    sh.onclick = () => navigator.share({ title: 'VUEMesh diagnostics', text: d.querySelector('#diagText').value }).catch(() => {});
  }
  return async () => {
    d.querySelector('#diagText').value = 'Gathering…';
    d.showModal();
    d.querySelector('#diagText').value = await diagnosticsReport(await getSections());
  };
}
