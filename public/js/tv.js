// /tv: a screen that shows a studio's program. The same protocol as the Apple TV app, so it's the
// reference for it, and any TV or spare computer with a browser can be a program screen.
// The steps (docs/APPLE-TV.md): look the event up, join its signalling as a "display", say hello to
// the studio; wait to be let in (Accept in the studio, or a TV code typed here); then offer a
// receive-only connection, and show what the studio sends on it. All over the local network.

import { api, meshSocket, ICE, eventIdFromUrl } from '/js/vm.js';
import { pathOf } from '/js/rtc.js';

const $ = (s) => document.querySelector(s);
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const VERSION = 1;
const ROUTE_SAY = { lan: 'this network', nat: 'through the router', internet: 'over the internet', cellular: 'mobile data', relay: 'relayed' };

// This screen's id survives reloads (the studio remembers it by its key, kept per event).
const cid = localStorage.getItem('vm_tv_cid') || (() => {
  const v = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('vm_tv_cid', v);
  return v;
})();
$('#screenName').value = localStorage.getItem('vm_tv_name') || 'TV screen';

let eventId = '', ev = null, sock = null, host = null, pc = null, ctl = null;
let pingTimer = null, iceTimer = null, lastPong = 0, seq = 0;
const keyOf = (e) => localStorage.getItem('vm_tv_key_' + e) || '';

// ---- code entry: one cell per character ------------------------------------------
function cells(box, n) {
  box.innerHTML = '';
  const inputs = Array.from({ length: n }, (_, i) => {
    const el = document.createElement('input');
    el.autocomplete = 'off';
    el.autocapitalize = 'characters';
    el.spellcheck = false;
    el.setAttribute('aria-label', `Character ${i + 1} of ${n}`);
    box.append(el);
    return el;
  });
  const value = () => inputs.map((i) => i.value).join('');
  /** A run of characters (pasted, autofilled, typed fast) fills the cells from cell `from` on. */
  const fill = (from, v) => {
    [...v].slice(0, n - from).forEach((ch, k) => (inputs[from + k].value = ch));
    inputs[Math.min(n - 1, from + v.length)].focus();
    box.classList.remove('bad');
  };
  inputs.forEach((el, i) => {
    // (no maxLength on the cells: it cut a paste down to its first character before we saw it)
    el.addEventListener('paste', (e) => {
      const v = (e.clipboardData?.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!v) return;
      e.preventDefault();
      fill(v.length >= n ? 0 : i, v); // a whole code ("ABCD-EFGH" too) goes from the first cell
    });
    el.addEventListener('input', () => {
      const v = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.length > 1) {
        // typed over a filled cell: the new character is the one that counts
        if (v.length === 2 && el.selectionStart != null) return fill(i, el.selectionStart <= 1 ? v[0] : v[1]);
        return fill(i, v);
      }
      el.value = v;
      if (v && i < n - 1) inputs[i + 1].focus();
      box.classList.remove('bad');
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !el.value && i > 0) inputs[i - 1].focus();
      if (e.key === 'ArrowLeft' && i > 0) inputs[i - 1].focus();
      if (e.key === 'ArrowRight' && i < n - 1) inputs[i + 1].focus();
    });
  });
  return { inputs, value, set: (s) => inputs.forEach((el, i) => (el.value = s[i] || '')), clear: () => inputs.forEach((el) => (el.value = '')) };
}
const eventCode = cells($('#eventCells'), 6);
const pairCode = cells($('#pairCells'), 8);

function show(view) {
  for (const v of ['joinView', 'waitView']) $('#' + v).hidden = v !== view;
  $('#out').hidden = view !== 'program';
  $('#umd').hidden = view !== 'program';
  $('#progCtl').hidden = view !== 'program';
  if (view !== 'program' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function waiting(say, { pair = false } = {}) {
  show('waitView');
  $('#waitTitle').textContent = ev?.title || eventId;
  $('#waitSay').textContent = say;
  $('#pairBtn').hidden = !pair;
}

// ---- joining ----------------------------------------------------------------
$('#joinForm').onsubmit = async (e) => {
  e.preventDefault();
  const code = eventCode.value().toUpperCase();
  if (code.length !== 6 || [...code].some((c) => !CODE_CHARS.includes(c))) {
    $('#eventCells').classList.add('bad');
    $('#joinErr').textContent = 'Event codes are 6 letters and numbers.';
    return;
  }
  localStorage.setItem('vm_tv_name', $('#screenName').value.trim() || 'TV screen');
  join(code);
};

async function join(code) {
  $('#joinErr').textContent = '';
  try {
    ev = await api(`events/${code}`);
  } catch {
    $('#eventCells').classList.add('bad');
    $('#joinErr').textContent = 'No event with that code. Check it on the studio or a beacon.';
    show('joinView');
    return;
  }
  eventId = code;
  localStorage.setItem('vm_tv_event', code);
  history.replaceState(null, '', `/tv?e=${code}`);
  waiting('Looking for the studio…');
  sock?.close();
  sock = meshSocket({
    eventId, role: 'display', cid,
    name: localStorage.getItem('vm_tv_name') || 'TV screen',
    onPeers: (peers) => {
      const h = peers.find((p) => p.role === 'host');
      if (!h) {
        if (host) drop();
        host = null;
        return waiting('Waiting for the studio. Open the VUEMesh studio for this event.');
      }
      if (h.peer !== host) {
        drop();
        host = h.peer;
        hello();
      }
    },
    onSignal: (from, data) => {
      if (from !== host || !data) return;
      if (data.display) return onDisplay(data.display);
      onRtc(data);
    },
  });
}

function say(display) {
  if (host) sock?.signal(host, { display: { v: VERSION, ...display } });
}
function hello() {
  say({ t: 'hello', name: localStorage.getItem('vm_tv_name') || 'TV screen', model: 'Browser', appVersion: 'web', caps: ['program'], screen: { w: screen.width * devicePixelRatio, h: screen.height * devicePixelRatio, hdr: matchMedia('(dynamic-range: high)').matches }, key: keyOf(eventId) || undefined });
}

function onDisplay(m) {
  if (m.t === 'waiting') return waiting('Waiting for the studio to accept this screen. It shows up under TV screens.', { pair: true });
  if (m.t === 'paired') {
    localStorage.setItem('vm_tv_key_' + eventId, m.key);
    if (m.title) ev = { ...ev, title: m.title };
    $('#pairBox').hidden = true;
    waiting('Connecting to the studio…');
    return offer();
  }
  if (m.t === 'reject') {
    if (m.code === 'removed') localStorage.removeItem('vm_tv_key_' + eventId);
    $('#waitErr').textContent = m.message || 'The studio turned this screen away.';
    if (m.code === 'wrong_code' || m.code === 'code_expired') {
      $('#pairCells').classList.add('bad');
      return;
    }
    drop();
    waiting(m.code === 'removed' ? 'The studio removed this screen. It can ask again.' : 'Not connected.', { pair: true });
    if (m.code === 'removed') setTimeout(hello, 1500);
  }
}

// ---- the connection: receive only ----------------------------------------------
async function offer() {
  drop();
  pc = new RTCPeerConnection({ iceServers: ICE });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  ctl = pc.createDataChannel('ctl', { ordered: true });
  ctl.onopen = () => {
    lastPong = Date.now();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (Date.now() - lastPong > 15000) return restart('The studio stopped answering.');
      send({ t: 'ping', seq: ++seq });
    }, 5000);
  };
  ctl.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    lastPong = Date.now();
    if (m.t === 'mode') setMode(m.mode);
    else if (m.t === 'meta') $('#umdTitle').textContent = m.title || ev?.title || '';
  };
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    stream.addTrack(e.track);
    $('#out').srcObject = stream;
  };
  pc.onicecandidate = (e) => e.candidate && sock.signal(host, { kind: 'ice', c: e.candidate.toJSON() });
  pc.onconnectionstatechange = async () => {
    if (pc?.connectionState === 'connected') {
      clearTimeout(iceTimer);
      const r = (await pathOf(pc)).route;
      $('#umdRoute').textContent = ROUTE_SAY[r] ? `· ${ROUTE_SAY[r]}` : '';
    }
    if (pc?.connectionState === 'failed') notReachable();
  };
  // No connection in 10 s: almost always two different networks, or Wi-Fi that keeps devices apart.
  clearTimeout(iceTimer);
  iceTimer = setTimeout(() => pc?.connectionState !== 'connected' && notReachable(), 10000);
  await pc.setLocalDescription(await pc.createOffer());
  sock.signal(host, { kind: 'offer', sdp: pc.localDescription.toJSON() });
}

async function onRtc(data) {
  if (!pc) return;
  if (data.kind === 'answer') await pc.setRemoteDescription(data.sdp).catch(() => {});
  else if (data.kind === 'ice' && data.c) await pc.addIceCandidate(data.c).catch(() => {});
  else if (data.kind === 'restart') restart();
}

function send(obj) {
  if (ctl?.readyState === 'open') ctl.send(JSON.stringify(obj));
}
function state(status, extra = {}) {
  const m = { t: 'state', status, ...extra };
  if (ctl?.readyState === 'open') send(m);
  else say(m);
}

let mode = 'idle';
function setMode(m) {
  mode = m === 'program' ? 'program' : 'idle';
  if (mode === 'program') {
    show('program');
    $('#umd').classList.add('live');
    $('#out').play?.().catch(() => {});
  } else waiting('The studio has this screen on standby.');
  state('active', { mode });
  quietSoon();
}

function notReachable() {
  state('error', { detail: 'ice_failed_same_network' });
  waiting('This screen can’t reach the studio. Put both on the same Wi-Fi, or plug this screen into the studio’s router.');
  setTimeout(() => host && restart(), 8000);
}

function restart(why) {
  if (why) $('#waitErr').textContent = why;
  sock?.signal(host, { kind: 'restart' });
  setTimeout(() => host && offer(), 800);
}

function drop() {
  clearInterval(pingTimer);
  clearTimeout(iceTimer);
  try { ctl?.close(); } catch {}
  try { pc?.close(); } catch {}
  pc = null;
  ctl = null;
}

// ---- controls ---------------------------------------------------------------
$('#pairBtn').onclick = () => {
  $('#pairBox').hidden = false;
  pairCode.clear();
  pairCode.inputs[0].focus();
};
$('#pairForm').onsubmit = (e) => {
  e.preventDefault();
  $('#waitErr').textContent = '';
  $('#pairCells').classList.remove('bad');
  say({ t: 'pair', code: pairCode.value().toUpperCase(), name: localStorage.getItem('vm_tv_name') || 'TV screen', model: 'Browser' });
};
function leave() {
  drop();
  sock?.close();
  sock = null;
  host = null;
  localStorage.removeItem('vm_tv_event');
  history.replaceState(null, '', '/tv');
  eventCode.clear();
  show('joinView');
  eventCode.inputs[0].focus();
}
$('#leaveBtn').onclick = leave;
$('#exitBtn').onclick = leave;
// Full screen: the button, F, or a double-click on the picture.
const canFull = !!document.documentElement.requestFullscreen;
$('#fullBtn').hidden = !canFull;
function toggleFull() {
  if (!canFull) return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}
$('#fullBtn').onclick = toggleFull;
$('#out').addEventListener('dblclick', toggleFull);
addEventListener('keydown', (e) => {
  if (mode === 'program' && !$('#out').hidden && (e.key === 'f' || e.key === 'F') && !e.target.closest?.('input')) toggleFull();
});
document.addEventListener('fullscreenchange', () => ($('#fullBtn').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'));
$('#soundBtn').onclick = () => {
  const v = $('#out');
  v.muted = !v.muted;
  $('#soundBtn').textContent = v.muted ? 'Sound off' : 'Sound on';
};

// The label fades after a few quiet seconds and comes back on any movement or key.
let quietTimer = null;
function quietSoon() {
  document.body.classList.remove('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => mode === 'program' && document.body.classList.add('quiet'), 4000);
}
for (const t of ['pointermove', 'keydown']) addEventListener(t, quietSoon);

// ---- start: an event in the address, or the last one, or ask -------------------
const start = eventIdFromUrl() || localStorage.getItem('vm_tv_event') || '';
if (start) {
  eventCode.set(start);
  join(start);
} else {
  show('joinView');
  eventCode.inputs[0].focus();
}
