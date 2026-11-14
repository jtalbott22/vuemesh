// /tv: a screen that shows a studio's program. The same protocol as the Apple TV app, so it's the
// reference for it, and any TV or spare computer with a browser can be a program screen.
// The steps (docs/APPLE-TV.md): look the event up, join its signalling as a "display", say hello to
// the studio; wait to be let in (Accept in the studio); then offer a
// receive-only connection, and show what the studio sends on it. All over the local network.
// Once in, it shows one of: the program; Browse (the event's recordings, pulled from the studio
// over the "media" data channel and played here); the Beacon (drawn on the studio's clock, led by
// this screen's lag); or the event card. The studio chooses, or this screen does (the bar at the
// top); PIP puts the live program in a corner while browsing or beaconing.

import { api, meshSocket, ICE, eventIdFromUrl, now, drawQR, timecodeUrl, fmtClock, fmtDur, esc, showName } from '/js/vm.js';
import { pathOf, countRoute } from '/js/rtc.js';
import { ProgramSound } from '/js/progsound.js';
import { listen, stopListening } from '/js/tvdirect.js';

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

let eventId = '', ev = null, sock = null, host = null, pc = null, ctl = null, media = null, linked = false;
let pingTimer = null, iceTimer = null, lastPong = 0, seq = 0;
let lastTry = 0; // (the last hello or offer: the watchdog leaves a fresh attempt alone)
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

const SHOWS = ['program', 'browse', 'beacon'];
function show(view) {
  $('#joinView').hidden = view !== 'joinView';
  $('#waitView').hidden = view !== 'waitView';
  $('#browseView').hidden = view !== 'browse';
  $('#beaconView').hidden = view !== 'beacon';
  // the program: full screen, or small in a corner (PIP) over the recordings or the beacon
  const pic = view === 'program' || ((view === 'browse' || view === 'beacon') && pip);
  $('#out').hidden = !pic;
  document.body.classList.toggle('pip', pic && view !== 'program');
  if (pic) $('#out').play?.().catch(() => {});
  $('#umd').hidden = view !== 'program';
  $('#progCtl').hidden = !SHOWS.includes(view);
  $('#soundBtn').hidden = view !== 'program';
  $('#modes').hidden = !linked || view === 'joinView';
  if (view === 'joinView' && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function waiting(say) {
  show('waitView');
  $('#waitTitle').textContent = ev?.title || eventId;
  $('#waitSay').textContent = say;
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
    ev = { ...ev, title: showName(code) || undefined }; // (the name: the studio says it; the server never has it)
    // (a TV's own code, this one's or another's: that's for phones and computers to show on a TV)
    if (ev?.kind === 'tv') throw Object.assign(new Error('tv'), { tv: true });
    tvSound.setMeta(ev?.title || code, 'Live program');
  } catch (e) {
    $('#eventCells').classList.add('bad');
    $('#joinErr').textContent = e.tv ? 'That’s a TV’s code, for phones and computers to show on a TV. Here, enter the code from the studio.' : 'No event with that code. Check it on the studio or a QR Beacon.';
    localStorage.removeItem('vm_tv_event');
    show('joinView');
    startListening(); // (still listening on this TV's own code, as the landing page always is)
    return;
  }
  eventId = code;
  stopListening(); // (a studio's program now: phones on this TV's own code wait until it's left)
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
        // (the studio's server connection dropped a moment; the program comes straight from the
        // studio, so a link that's still connected stays. If it goes, the watchdog asks again.)
        if (host && pc?.connectionState === 'connected') return;
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
  lastTry = Date.now();
  say({ t: 'hello', name: localStorage.getItem('vm_tv_name') || 'TV screen', model: 'Browser', appVersion: 'web', caps: ['program', 'browse', 'beacon', 'pip'], screen: { w: screen.width * devicePixelRatio, h: screen.height * devicePixelRatio, hdr: matchMedia('(dynamic-range: high)').matches }, key: keyOf(eventId) || undefined });
}

function onDisplay(m) {
  if (m.t === 'waiting') return waiting('Waiting for the studio to accept this screen. It shows up under TV screens.');
  if (m.t === 'paired') {
    localStorage.setItem('vm_tv_key_' + eventId, m.key);
    if (m.title) ev = { ...ev, title: m.title };
    $('#bTitle').textContent = ev?.title || eventId;
    $('#bJoin').innerHTML = `Or go to <strong>${esc(location.host)}/cam</strong> and enter <strong>${esc(eventId)}</strong>`;
    waiting('Connecting to the studio…');
    return offer();
  }
  if (m.t === 'reject') {
    if (m.code === 'removed') localStorage.removeItem('vm_tv_key_' + eventId);
    $('#waitErr').textContent = m.message || 'The studio turned this screen away.';
    drop();
    waiting(m.code === 'removed' ? 'The studio removed this screen. It can ask again.' : 'Not connected.');
    if (m.code === 'removed') setTimeout(hello, 1500);
  }
}

// ---- staying joined: after the lid closes, or the network drops ---------------------------
// Every 3 s: a studio there but no picture link, and nothing tried for 12 s, says hello again
// (the studio knows this screen's key, so that's straight back to the picture). A gap in the
// clock means this computer slept: the link is gone whatever it says, so start it again at
// once; and when the page shows again, or the network comes back, check straight away.
let beat = Date.now();
async function keepJoined(why) {
  const slept = Date.now() - beat > 10_000;
  beat = Date.now();
  if (!eventId || !host) return;
  if (slept && (linked || pc)) {
    // (a phone in a pocket, playing the sound: its clock was only held back, and the picture and
    // sound are still coming; carry on. A computer that really slept gets nothing: start again.)
    if (await flowing()) return ping();
    state('reconnecting', { detail: 'woke' });
    return restart('This screen was asleep: joining again.');
  }
  const open = linked && ctl?.readyState === 'open' && pc?.connectionState === 'connected';
  if (!open && Date.now() - lastTry > 12_000) {
    if (why) $('#waitErr').textContent = why;
    hello();
  }
}
setInterval(() => keepJoined(), 3000);
// Is the picture or sound still arriving? (bytes in, over a second and a half)
let stalled = false; // (tests: as a computer that slept)
async function flowing() {
  if (stalled) return (stalled = false);
  if (!pc || pc.connectionState !== 'connected') return false;
  const bytes = async () => {
    let n = 0;
    try {
      (await pc?.getStats())?.forEach((r) => r.type === 'inbound-rtp' && (n += r.bytesReceived || 0));
    } catch {}
    return n;
  };
  const a = await bytes();
  await new Promise((r) => setTimeout(r, 1500));
  return (await bytes()) > a;
}
// (tests: the link dying, this computer waking from sleep, and a report of falling behind)
window.vmTvBreak = () => {
  try { pc?.close(); } catch {}
};
window.vmTvSleep = () => {
  beat -= 20_000;
  stalled = true;
};
window.vmTvReport = (q) => ctl?.send(JSON.stringify({ t: 'quality', secs: 5, ...q }));
window.vmTvLinked = () => !!(linked && ctl?.readyState === 'open' && pc?.connectionState === 'connected');
document.addEventListener('visibilitychange', () => !document.hidden && keepJoined());
addEventListener('online', () => keepJoined('The network is back: joining again.'));
addEventListener('pageshow', () => keepJoined());

// Keep the screen awake while it shows the program or the beacon (it may not turn itself off
// then). A closed lid still sleeps the computer: joining again is the part above.
let wake = null;
async function stayAwake(on) {
  if (on && !wake && !document.hidden && navigator.wakeLock) {
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => (wake = null));
    } catch {}
  } else if (!on && wake) {
    wake.release().catch(() => {});
    wake = null;
  }
}
document.addEventListener('visibilitychange', () => !document.hidden && stayAwake(mode === 'program' || mode === 'beacon'));

// ---- what this screen is getting, to the studio every 5 s ---------------------------------
// Frames shown (counted as they reach the screen), dropped and frozen, and the size: the studio
// lowers this screen's picture if it's falling behind, and it's in the studio's show log.
let shown = 0, lastQ = null;
(function countShown() {
  const v = $('#out');
  if (v?.requestVideoFrameCallback) {
    const each = () => {
      shown++;
      v.requestVideoFrameCallback(each);
    };
    v.requestVideoFrameCallback(each);
  }
})();
setInterval(async () => {
  if (!linked || ctl?.readyState !== 'open' || !pc || mode !== 'program' && !pip) return;
  let s = null;
  try {
    (await pc.getStats()).forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') s = r;
    });
  } catch {}
  if (!s) return;
  const now = performance.now();
  const cur = { at: now, shown, decoded: s.framesDecoded || 0, dropped: s.framesDropped || 0, freezes: s.freezeCount || 0, freezeMs: (s.totalFreezesDuration || 0) * 1000, lost: s.packetsLost || 0 };
  if (lastQ) {
    const secs = (now - lastQ.at) / 1000;
    const shownFps = (cur.shown - lastQ.shown) / secs, decodedFps = (cur.decoded - lastQ.decoded) / secs;
    ctl.send(JSON.stringify({
      t: 'quality', secs: Math.round(secs * 10) / 10, fps: Math.round((shownFps > 0 ? shownFps : decodedFps) * 10) / 10,
      dropped: cur.dropped - lastQ.dropped, freezes: cur.freezes - lastQ.freezes, freezeMs: Math.round(cur.freezeMs - lastQ.freezeMs), lost: cur.lost - lastQ.lost,
      w: s.frameWidth || null, h: s.frameHeight || null,
    }));
  }
  lastQ = cur;
}, 5000);

// ---- the connection: receive only ----------------------------------------------
async function offer() {
  lastTry = Date.now();
  drop();
  pc = new RTCPeerConnection({ iceServers: ICE });
  countRoute(pc, 'tv');
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  ctl = pc.createDataChannel('ctl', { ordered: true });
  // recordings for Browse come in on their own channel, so a big one never holds up ctl
  media = pc.createDataChannel('media', { ordered: true });
  media.binaryType = 'arraybuffer';
  media.onmessage = onMedia;
  ctl.onopen = () => {
    linked = true;
    lastPong = Date.now();
    clearInterval(pingTimer);
    syncClock();
    pingTimer = setInterval(async () => {
      if (Date.now() - lastPong > 15000) {
        // (answers held up, as on a locked phone, while the program still comes: not a dead link)
        if (await flowing()) lastPong = Date.now();
        else return restart('The studio stopped answering.');
      }
      ping();
    }, 5000);
  };
  ctl.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    lastPong = Date.now();
    if (m.t === 'mode') setMode(m.mode, m.pip, m.params);
    else if (m.t === 'meta') {
      $('#umdTitle').textContent = m.title || ev?.title || '';
      tvSound.setMeta(m.title || ev?.title || eventId, 'Live program');
    }
    else if (m.t === 'pong') onPong(m);
    else if (m.t === 'list') onList(m.items || []);
    else if (m.t === 'thumb') onThumb(m.id, m.data);
    else if (m.t === 'error') fetchFailed(m.id, m.message);
  };
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') return tvSound.setTrack(e.track); // (its own player: on with the screen locked)
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

let mode = 'idle', pip = false, lag = null;
function setMode(m, p, params = {}) {
  stayAwake(m === 'program' || m === 'beacon');
  const was = mode;
  mode = SHOWS.includes(m) ? m : 'idle';
  pip = !!p;
  lag = Number.isFinite(params?.lag) ? params.lag : null;
  if (mode !== 'browse') closeClip();
  if (mode === 'idle') waiting('The studio has this screen on standby.');
  else show(mode);
  if (mode === 'program') $('#umd').classList.add('live');
  if (mode === 'browse' && was !== 'browse') send({ t: 'list' });
  if (mode === 'beacon') {
    if (was !== 'beacon') syncClock();
    $('#beaconHint').hidden = lag != null;
    if (!beaconRaf) beaconTick();
  }
  renderModes();
  state('active', { mode });
  quietSoon();
}
/** Ask the studio for a mode or PIP from here (it answers with the mode, and remembers it). */
function want(m, p = pip) {
  send({ t: 'want', mode: m, pip: p });
}
function renderModes() {
  document.querySelectorAll('#modes [data-want]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.want === mode)));
  $('#pipBtn').hidden = mode !== 'browse' && mode !== 'beacon';
  $('#pipBtn').setAttribute('aria-pressed', String(pip));
  document.querySelectorAll('#modes button:not([data-want="program"])').forEach((b) => {
    b.disabled = !studioModes;
    b.title = studioModes ? '' : 'The studio runs an older VUEMesh: Browse, QR Beacon and PIP need it updated to 0.51 or later';
  });
}
$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.want) want(b.dataset.want);
  else if (b.id === 'pipBtn') want(mode, !pip);
});

// ---- the studio's clock: from ctl pings (the round trip on this network is a few ms) -------
// offset = studio clock − this screen's; the reading with the shortest round trip is the best.
let clockOff = 0;
const clockSamples = [];
function ping() {
  send({ t: 'ping', seq: ++seq, at: now() });
}
function syncClock() {
  for (let i = 0; i < 8; i++) setTimeout(ping, i * 150);
}
let studioModes = true; // (an older studio, before 0.51, ignores modes: its pongs carry no clock)
function onPong(m) {
  if (studioModes !== Number.isFinite(m.now)) {
    studioModes = Number.isFinite(m.now);
    renderModes();
  }
  const t = now(), rtt = t - m.at;
  if (!Number.isFinite(m.now) || !(rtt >= 0)) return;
  clockSamples.push({ rtt, off: m.now + rtt / 2 - t });
  if (clockSamples.length > 20) clockSamples.shift();
  clockOff = clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off;
}
window.vmTv = () => ({ mode, pip, lag, clockOff, samples: clockSamples.length, items: items.length, cached: [...cache.keys()], open: clipOpen }); // (tests and diagnostics)

// ---- Beacon: phones sync to it as to any beacon, so their clips line up with the studio ----
// It draws the studio's clock (not this screen's), and leads it by this screen's lag (measured
// with Calibrate in the studio), so the code shows each time as it really is when it lights up.
let beaconLast = 0, beaconRaf = 0;
function beaconTick() {
  beaconRaf = 0;
  if (mode !== 'beacon') return;
  const t = now() + clockOff + (lag || 0);
  if (t - beaconLast >= 1000 / 15) {
    beaconLast = t;
    drawQR($('#bq'), timecodeUrl(eventId, t), { size: 900 });
  }
  $('#bClock').textContent = fmtClock(t);
  beaconRaf = requestAnimationFrame(beaconTick);
}

// ---- Browse: the event's recordings, pulled from the studio and played here --------------
let items = [], rx = null, wantId = null, clipOpen = null, cacheBytes = 0;
const cache = new Map(); // id → { url, size }: what's here already (up to about 1.5 GB)
const thumbsBy = new Map();
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
function onList(list) {
  items = list;
  const box = $('#items');
  box.innerHTML = items.length
    ? items.map((x) => `<button type="button" class="item" data-id="${esc(x.id)}"><span class="th">${x.kind === 'audio' ? '🎙' : ''}</span><b>${esc(x.name)}</b><small>${fmtDur(x.dur)} · ${mb(x.size)}<span class="here"${cache.has(x.id) ? '' : ' hidden'}> · here</span></small></button>`).join('')
    : '<p class="say">No recordings yet. They show up here as they reach the studio.</p>';
  for (const [id, data] of thumbsBy) onThumb(id, data);
  box.querySelector('button')?.focus();
}
function onThumb(id, data) {
  thumbsBy.set(id, data);
  const th = $(`#items [data-id="${CSS.escape(id)}"] .th`);
  if (th && /^data:image\//.test(data)) th.style.backgroundImage = `url("${data}")`;
}
$('#items').addEventListener('click', (e) => {
  const id = e.target.closest('[data-id]')?.dataset.id;
  if (id) openClip(id);
});
$('#refreshList').onclick = () => send({ t: 'list' });
function openClip(id) {
  if (cache.has(id)) return playClip(id);
  if (rx && rx.id !== id) send({ t: 'cancel', id: rx.id });
  rx = null;
  wantId = id;
  const x = items.find((i) => i.id === id);
  $('#fetchName').textContent = x?.name || '';
  $('#fetchBar').value = 0;
  $('#fetchSay').textContent = 'Asking the studio…';
  $('#fetch').hidden = false;
  $('#browseErr').textContent = '';
  send({ t: 'get', id });
}
let progressAt = 0;
function onMedia(e) {
  if (typeof e.data === 'string') {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'file') {
      if (m.id !== wantId) return;
      rx = { id: m.id, size: m.size || 0, mime: m.mime || '', parts: [], got: 0 };
      progress();
    } else if (m.t === 'end' && rx?.id === m.id) {
      const blob = new Blob(rx.parts, { type: rx.mime });
      remember(rx.id, blob);
      const id = rx.id;
      rx = null;
      $('#fetch').hidden = true;
      if (wantId === id) playClip(id);
    }
    return;
  }
  if (!rx) return; // (one we stopped wanting)
  rx.parts.push(e.data);
  rx.got += e.data.byteLength;
  if (performance.now() - progressAt > 200) progress();
}
function progress() {
  progressAt = performance.now();
  if (!rx) return;
  $('#fetchBar').value = rx.size ? Math.round((rx.got / rx.size) * 100) : 0;
  $('#fetchSay').textContent = `${mb(rx.got)} of ${mb(rx.size)} from the studio`;
}
function fetchFailed(id, message) {
  if (id !== wantId) return;
  $('#fetch').hidden = true;
  $('#browseErr').textContent = message || 'The studio couldn’t send that one.';
  wantId = null;
}
function remember(id, blob) {
  cache.set(id, { url: URL.createObjectURL(blob), size: blob.size });
  cacheBytes += blob.size;
  for (const [k, v] of cache) {
    if (cacheBytes <= 1.5e9 || k === id) break;
    if (k === clipOpen) continue;
    URL.revokeObjectURL(v.url);
    cacheBytes -= v.size;
    cache.delete(k);
  }
  document.querySelectorAll('#items [data-id]').forEach((b) => (b.querySelector('.here').hidden = !cache.has(b.dataset.id)));
}
function playClip(id) {
  const c = cache.get(id);
  if (!c) return;
  clipOpen = id;
  wantId = null;
  const v = $('#clip');
  v.src = c.url;
  $('#playerName').textContent = items.find((i) => i.id === id)?.name || '';
  $('#player').hidden = false;
  v.play().catch(() => {});
  v.focus();
  quietSoon();
}
function closeClip() {
  if (!clipOpen && $('#player').hidden) return;
  const v = $('#clip');
  v.pause();
  v.removeAttribute('src');
  v.load();
  clipOpen = null;
  $('#player').hidden = true;
  $(`#items [data-id]`)?.focus();
}
$('#playerBack').onclick = closeClip;
addEventListener('keydown', (e) => {
  if ((e.key === 'Escape' || e.key === 'Backspace') && clipOpen && !e.target.closest?.('input')) {
    e.preventDefault();
    closeClip();
  }
});

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
  lastQ = null; // (a new link counts its frames from nothing)
  clearInterval(pingTimer);
  clearTimeout(iceTimer);
  try { ctl?.close(); } catch {}
  try { media?.close(); } catch {}
  try { pc?.close(); } catch {}
  pc = null;
  ctl = null;
  media = null;
  linked = false;
  rx = null;
  $('#fetch').hidden = true;
  $('#modes').hidden = true;
}

// ---- controls ---------------------------------------------------------------
function leave() {
  drop();
  tvSound.stop();
  sock?.close();
  sock = null;
  host = null;
  localStorage.removeItem('vm_tv_event');
  history.replaceState(null, '', '/tv');
  eventCode.clear();
  show('joinView');
  eventCode.inputs[0].focus();
  startListening();
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
// The program's sound: off to start with, on with a tap (remembered). It plays as a music app's
// does (progsound.js): on a phone, with the screen locked, behind other apps and in the car, with
// the show in Now Playing; its play and pause there are Sound on and off here.
const tvSound = new ProgramSound({
  store: 'vm_tv_sound',
  onChange: () => {
    const b = $('#soundBtn');
    b.textContent = tvSound.on ? 'Sound on' : tvSound.waiting ? 'Tap for sound' : 'Sound off';
    b.setAttribute('aria-pressed', String(tvSound.on));
  },
});
tvSound.changed();
$('#soundBtn').onclick = () => tvSound.set(!tvSound.on);
window.vmTvSound = () => ({ on: tvSound.on, waiting: tvSound.waiting, track: !!tvSound.track, nowPlaying: navigator.mediaSession?.metadata?.title || null }); // (tests)

// The label fades after a few quiet seconds and comes back on any movement or key.
let quietTimer = null;
function quietSoon() {
  document.body.classList.remove('quiet');
  clearTimeout(quietTimer);
  // (quiet over the program, the beacon, and a recording playing; not over the list you're choosing from)
  quietTimer = setTimeout(() => (mode === 'program' || mode === 'beacon' || clipOpen) && document.body.classList.add('quiet'), 4000);
}
for (const t of ['pointermove', 'keydown']) addEventListener(t, quietSoon);

// ---- phones and screens straight to this TV, with no studio (tvdirect.js) --------
// The landing page has both: a studio's code on the left, this TV's own code on the right, already
// listening. When the last phone or screen leaves the tiles, it's the landing page again.
function landing() {
  if (sock) return; // (showing a studio's event: that carries on)
  history.replaceState(null, '', '/tv');
  show('joinView');
  if (!document.activeElement?.closest?.('#joinForm')) eventCode.inputs[0].focus();
}
const startListening = () => listen({ onLanding: landing });

// ---- start: an event in the address, or the last one, or the landing page (listening) ----
const start = eventIdFromUrl() || localStorage.getItem('vm_tv_event') || '';
if (start) {
  eventCode.set(start);
  join(start);
} else {
  show('joinView');
  eventCode.inputs[0].focus();
  startListening();
}
