// /tv?direct: a TV that shows phones' cameras and shared screens itself, with no studio. Nothing
// is recorded and nothing is mixed: whoever joins is on the TV, tiled, as they come and go.
//
// The TV makes an event of its own (kind "tv") and keeps its code on this TV, so the code stays the
// same each time (it can go on a sticker). It joins that event's signalling as its host, with
// HostHub, the studio's own end of a phone's link: so /cam on a phone and /share on a computer
// connect to it exactly as they do to a studio, with no change to how they link. It tells each one:
// you're on (tally, so a phone's light is red), don't record (rec off) and keep your clips (no
// uploads), and how good a picture to send (the tier: full for one or two, less for a grid).
//
// One tile fills the screen; two side by side; three as one big and two small; then 2x2, 3x2, 3x3.
// Up to nine are shown (any more wait for a place). A click, OK on a remote, or 1 to 9 puts one
// full screen (the others then send a small picture); again, 0, or Back puts the grid back.
//
// Sound: one at a time. A shared screen's plays (the spotlit one, else the first that has sound).
// Cameras' sound stays off unless turned on: a phone's microphone in the same room as the TV's
// speakers feeds back. With it on, the spotlit camera's sound plays.
import { api, meshSocket, drawQR } from '/js/vm.js';
import { HostHub } from '/js/rtc.js';

const $ = (s) => document.querySelector(s);
const MAX_TILES = 9;
const SAVE_KEY = 'vm_tv_direct'; // { id, hostKey }: this TV's own code, kept for next time
const MODE_KEY = 'vm_tv_mode'; // 'direct' while this TV is showing cameras directly
const CAMSOUND_KEY = 'vm_tv_camsound';

let sock = null, hub = null, ev = null, onLeave = null, tallyTimer = null, quietTimer = null;
let spot = null; // the peer shown full screen, or null for the grid
const tiles = new Map(); // peer → { el, video, stream, name, screen, mic, at, info }
let base = location.origin;

const camSoundOn = () => {
  try { return localStorage.getItem(CAMSOUND_KEY) === '1'; } catch { return false; }
};

/** Whether this TV was left showing cameras directly (it goes back to that after a reload). */
export const directWanted = () => {
  try { return localStorage.getItem(MODE_KEY) === 'direct' || new URLSearchParams(location.search).has('direct'); } catch { return false; }
};

/** This TV's own event: the one it had, if it's still there, else a new one. */
async function ownEvent(fresh) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch {}
  if (saved?.id && saved?.hostKey && !fresh) {
    try {
      const e = await api(`events/${saved.id}`);
      if (e?.kind === 'tv') return { ...e, hostKey: saved.hostKey };
    } catch {} // (gone: a new one)
  }
  const name = (localStorage.getItem('vm_tv_name') || 'TV screen').slice(0, 60);
  const made = await api('events', { method: 'POST', body: { title: name, kind: 'tv' } });
  localStorage.setItem(SAVE_KEY, JSON.stringify({ id: made.id, hostKey: made.hostKey }));
  const e = await api(`events/${made.id}`);
  return { ...e, hostKey: made.hostKey };
}

/**
 * Starts showing cameras and screens directly.
 * @param {{fresh?: boolean, onLeave: () => void}} o  fresh: a new code; onLeave: back to the join screen
 */
export async function startDirect(o = {}) {
  onLeave = o.onLeave || onLeave;
  stopDirect({ keepMode: true });
  try { localStorage.setItem(MODE_KEY, 'direct'); } catch {}
  history.replaceState(null, '', '/tv?direct');
  showView();
  setJoinCard('Getting this TV’s code…');
  try {
    ev = await ownEvent(o.fresh);
  } catch (e) {
    setJoinCard(`Couldn’t get a code for this TV (${e.message || e}). Check its internet connection.`, true);
    return;
  }
  await lanBase();
  drawJoin();
  connect();
}

function connect() {
  const peer = localStorage.getItem('vm_tv_direct_peer') || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  localStorage.setItem('vm_tv_direct_peer', peer); // (the same id after a reload: phones link to it again at once)
  sock = meshSocket({
    eventId: ev.id, role: 'host', hostKey: ev.hostKey, peer, name: ev.title,
    onPeers: () => {
      hub?.syncPeers(sock.peers);
      renderJoining();
    },
    onSignal: (from, data, role) => hub?.onSignal(from, data, role),
  });
  hub = new HostHub({
    eventId: ev.id,
    termsHash: ev.termsHash,
    sock,
    onLive: (peer, stream, role) => addTile(peer, stream, role),
    onTracks: (peer, stream) => {
      const t = tiles.get(peer);
      if (!t) return;
      t.stream = stream;
      t.video.srcObject = stream;
      t.video.play().catch(() => {});
      layout();
    },
    onLiveEnd: (peer, why) => {
      if (why === 'reconnect') return void tiles.get(peer)?.el.classList.add('away'); // (it's coming straight back)
      removeTile(peer);
    },
    onRoute: () => {},
    onClip: async () => {}, // (nothing's recorded for a TV: the phones are told to keep their clips)
    onProgress: () => {},
    onPhoneMessage: () => {},
    onTelemetry: (peer, m) => {
      const t = tiles.get(peer);
      if (t && m.screen && !t.screen) {
        t.screen = true;
        t.el.classList.add('scr');
        layout();
      }
    },
  });
  window.vmTvDirect = () => ({ code: ev?.id, tiles: [...tiles.values()].map((t) => ({ name: t.name, screen: t.screen, mic: t.mic, playing: !!t.video.videoWidth })), spot: spot && tiles.get(spot)?.name, sound: soundFrom?.name || null }); // (tests)
  clearInterval(tallyTimer);
  tallyTimer = setInterval(tellAll, 4000); // (again now and then, in case one was lost: the studio does the same)
}

/** Stops it all; with keepMode, only to start again (a new code). */
export function stopDirect({ keepMode = false } = {}) {
  clearInterval(tallyTimer);
  for (const peer of [...tiles.keys()]) removeTile(peer, true);
  if (hub) for (const peer of [...hub.links.keys()]) hub.drop(peer);
  sock?.close();
  sock = hub = null;
  spot = null;
  setSound(null);
  if (!keepMode) {
    try { localStorage.removeItem(MODE_KEY); } catch {}
    $('#directView').hidden = true;
    document.body.classList.remove('direct');
  }
}

// ---- the join card: how to get on this TV ----------------------------------------------
// (on this computer's own dev server, localhost can't be opened from a phone: its https address on
// this network instead, as the studio does for /share)
async function lanBase() {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  try {
    const j = await (await fetch('/_dev/lan')).json();
    if (j?.https?.[0]) base = j.https[0];
  } catch {}
}
function setJoinCard(say, bad) {
  $('#dCode').textContent = ev?.id || '······';
  $('#dSay').textContent = say;
  $('#dSay').classList.toggle('err', !!bad);
}
function drawJoin() {
  const camUrl = `${base}/cam?e=${ev.id}`;
  drawQR($('#dQr'), camUrl, { size: 560, dark: '#000000', ecl: 'M' });
  $('#dCode').textContent = ev.id;
  $('#dShare').textContent = `${base.replace(/^https?:\/\//, '')}/share`;
  $('#dSay').textContent = '';
  $('#dSay').classList.remove('err');
}
/** Phones that have joined but whose picture isn't here yet. */
function renderJoining() {
  const coming = (sock?.peers || []).filter((p) => (p.role === 'cam' || p.role === 'mic') && !tiles.has(p.peer));
  const el = $('#dJoining');
  el.hidden = !coming.length;
  el.textContent = coming.length ? `Joining: ${coming.map((p) => p.name || 'a camera').join(', ')}…` : '';
}

// ---- tiles ------------------------------------------------------------------------------
function addTile(peer, stream, role) {
  const info = sock?.peers.find((p) => p.peer === peer) || hub?.known.get(peer) || {};
  let t = tiles.get(peer);
  if (!t) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'tile';
    const video = document.createElement('video');
    video.muted = true; // (sound plays from one place: see setSound)
    video.autoplay = true;
    video.playsInline = true;
    const label = document.createElement('span');
    label.className = 'tlabel';
    el.append(video, label);
    el.onclick = () => setSpot(spot === peer ? null : peer);
    el.classList.add('new'); // (it fades in where it lands; after that it slides as others come and go)
    setTimeout(() => el.classList.remove('new'), 500);
    video.addEventListener('resize', () => layout()); // (its shape: a phone turned, a screen's size)
    t = { el, video, label, at: Date.now() };
    tiles.set(peer, t);
    $('#dTiles').append(el);
  }
  Object.assign(t, {
    stream, info,
    name: info.name || (role === 'mic' ? 'Microphone' : 'Camera'),
    mic: role === 'mic',
    screen: t.screen || String(info.cid || '').endsWith('scr'), // (share.js gives a screen its own id, ending in "scr")
  });
  t.el.classList.remove('away');
  t.el.classList.toggle('scr', t.screen);
  t.el.classList.toggle('mic', t.mic);
  t.video.srcObject = stream;
  t.video.play().catch(() => {});
  // you're on (a phone's light goes red), don't record, keep your clips; again in case the link wasn't ready
  for (const ms of [300, 1500, 4000]) setTimeout(() => tiles.has(peer) && tell(peer), ms);
  renderJoining();
  layout();
}
function removeTile(peer, quiet) {
  const t = tiles.get(peer);
  if (!t) return;
  t.video.srcObject = null;
  t.el.remove();
  tiles.delete(peer);
  if (spot === peer) spot = null;
  if (!quiet) {
    renderJoining();
    layout();
  }
}

/** What each source is told: on (red light), not recording, and how good a picture to send. */
function tierOf(peer) {
  const shown = order().slice(0, MAX_TILES);
  if (spot) return peer === spot ? 'program' : 'idle';
  if (!shown.includes(peer)) return 'idle';
  return shown.length <= 2 ? 'program' : shown.length <= 4 ? 'preview' : 'idle';
}
function tell(peer) {
  if (!hub) return;
  hub.message(peer, { t: 'uploads', on: false });
  const shown = spot ? peer === spot : order().slice(0, MAX_TILES).includes(peer);
  hub.send(peer, { t: 'tally', on: shown, rec: false, tier: tierOf(peer) });
}
const tellAll = () => tiles.forEach((_, peer) => tell(peer));

/** Join order, cameras and screens before microphones (they've nothing to look at). */
const order = () => [...tiles.entries()].sort(([, a], [, b]) => (a.mic - b.mic) || (a.at - b.at)).map(([p]) => p);

function layout() {
  const box = $('#dTiles');
  const all = order();
  const shown = all.slice(0, MAX_TILES);
  const n = spot ? 1 : shown.length;
  box.dataset.n = String(Math.min(n, 9));
  box.classList.toggle('spotlit', !!spot);
  for (const [peer, t] of tiles) {
    const i = shown.indexOf(peer);
    t.el.hidden = spot ? peer !== spot : i < 0;
    t.el.classList.toggle('spot', peer === spot);
    t.el.classList.toggle('big', !spot && i === 0 && shown.length === 3); // (three: one big, two beside it)
    const k = i + 1;
    t.label.textContent = `${k > 0 && k <= 9 && shown.length > 1 ? `${k}  ` : ''}${t.name}${t.mic ? ' · sound only' : ''}`;
    t.el.setAttribute('aria-label', `${t.name}${t.screen ? ', a shared screen' : ''}. ${peer === spot ? 'Back to all' : 'Show full screen'}`);
    t.el.setAttribute('aria-pressed', String(peer === spot));
  }
  place(spot ? [spot] : shown);
  const waiting = all.length - shown.length;
  $('#dMore').hidden = !waiting || !!spot;
  $('#dMore').textContent = `${waiting} more waiting for a place`;
  // nothing on yet: the join card fills the screen; with something on, it goes to a corner
  document.body.classList.toggle('dempty', !tiles.size);
  $('#dHint').hidden = shown.length < 2;
  chooseSound();
  tellAll();
  wake();
}

/**
 * Where each tile goes: all 16:9, as large as they can be together, the whole group centered.
 * One fills the screen; three are one big and two small beside it; otherwise the rows and columns
 * that give the largest tiles (two side by side, four 2x2, six 3x2), a short last row centered.
 */
const GAP = 0.006; // (of the screen's smaller side)
function rects(n, W, H) {
  const g = GAP * Math.min(W, H);
  if (n <= 1) return [{ x: 0, y: 0, w: W, h: H }];
  if (n === 3) {
    // big on the left, two stacked on the right: the big one as tall as the two and the gap between
    const sw = Math.min((W - g - (g * 16) / 9) / 3, ((H - g) * 8) / 9), sh = (sw * 9) / 16;
    const bh = 2 * sh + g, bw = (bh * 16) / 9, x0 = (W - (bw + g + sw)) / 2, y0 = (H - bh) / 2;
    return [{ x: x0, y: y0, w: bw, h: bh }, { x: x0 + bw + g, y: y0, w: sw, h: sh }, { x: x0 + bw + g, y: y0 + sh + g, w: sw, h: sh }];
  }
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - g * (cols - 1)) / cols, ((H - g * (rows - 1)) / rows) * 16 / 9);
    if (!best || w > best.w + 0.5) best = { cols, rows, w };
  }
  const { cols, rows, w } = best, h = w * 9 / 16;
  const y0 = (H - (rows * h + (rows - 1) * g)) / 2;
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols;
    const x0 = (W - (inRow * w + (inRow - 1) * g)) / 2;
    return { x: x0 + (i % cols) * (w + g), y: y0 + r * (h + g), w, h };
  });
}
function place(peers) {
  const W = innerWidth, H = innerHeight;
  const rs = rects(peers.length, W, H);
  peers.forEach((peer, i) => {
    const t = tiles.get(peer), r = rs[i];
    if (!t || !r) return;
    Object.assign(t.el.style, { left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%` });
  });
}
addEventListener('resize', () => tiles.size && layout());

function setSpot(peer) {
  spot = peer && tiles.has(peer) ? peer : null;
  layout();
  if (spot) tiles.get(spot).el.focus({ preventScroll: true });
}

// ---- sound: one source at a time --------------------------------------------------------
let soundFrom = null;
function chooseSound() {
  const has = (t) => t && t.stream?.getAudioTracks().some((a) => a.readyState === 'live');
  const ok = (t) => has(t) && (t.screen || camSoundOn());
  const s = spot ? tiles.get(spot) : null;
  const pick = ok(s) ? s : !spot ? order().map((p) => tiles.get(p)).find((t) => has(t) && t.screen) || (camSoundOn() ? order().map((p) => tiles.get(p)).find(ok) : null) : null;
  setSound(pick || null);
  const camsWithSound = [...tiles.values()].some((t) => !t.screen && has(t));
  $('#dCamSound').hidden = !camsWithSound;
  $('#dCamSound').textContent = camSoundOn() ? 'Camera sound on' : 'Camera sound off';
  $('#dCamSound').setAttribute('aria-pressed', String(camSoundOn()));
}
function setSound(t) {
  const a = $('#dAudio');
  for (const x of tiles.values()) x.el.classList.toggle('sound', x === t);
  if (t === soundFrom && (!t || a.srcObject)) return;
  soundFrom = t;
  if (!t) {
    a.srcObject = null;
    $('#dTapSound').hidden = true;
    return;
  }
  a.srcObject = new MediaStream(t.stream.getAudioTracks());
  a.play().then(() => ($('#dTapSound').hidden = true)).catch(() => ($('#dTapSound').hidden = false)); // (after a reload, with no tap yet, the browser won't play sound)
}

// ---- the view, its controls, and the remote's keys -------------------------------------
function showView() {
  for (const id of ['joinView', 'waitView', 'browseView', 'beaconView']) $('#' + id).hidden = true;
  $('#out').hidden = true;
  $('#umd').hidden = true;
  $('#progCtl').hidden = true;
  $('#modes').hidden = true;
  $('#directView').hidden = false;
  document.body.classList.add('direct', 'dempty');
}

function wake() {
  document.body.classList.remove('dquiet');
  clearTimeout(quietTimer);
  // (with something on, the corner card and controls fade after a while; any key or movement brings them back)
  quietTimer = setTimeout(() => tiles.size && document.body.classList.add('dquiet'), 12000);
}

$('#dStop').onclick = () => {
  stopDirect();
  onLeave?.();
};
$('#dNew').onclick = () => startDirect({ fresh: true });
$('#dFull').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
$('#dFull').hidden = !document.documentElement.requestFullscreen;
document.addEventListener('fullscreenchange', () => ($('#dFull').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'));
$('#dCamSound').onclick = () => {
  try { localStorage.setItem(CAMSOUND_KEY, camSoundOn() ? '0' : '1'); } catch {}
  chooseSound();
};
$('#dTapSound').onclick = () => $('#dAudio').play().then(() => ($('#dTapSound').hidden = true)).catch(() => {});
for (const t of ['pointermove', 'pointerdown']) addEventListener(t, () => document.body.classList.contains('direct') && wake());
addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('direct') || e.target.closest?.('input')) return;
  wake();
  const shown = order().slice(0, MAX_TILES);
  if (/^[1-9]$/.test(e.key) && shown[+e.key - 1]) return setSpot(shown[+e.key - 1]);
  if ((e.key === '0' || e.key === 'Escape' || e.key === 'Backspace' || e.key === 'BrowserBack' || e.key === 'GoBack') && spot) {
    e.preventDefault();
    const was = spot;
    setSpot(null);
    tiles.get(was)?.el.focus({ preventScroll: true });
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) $('#dFull').click();
  // (a TV remote's arrows: from tile to tile, OK to spotlight; the browser moves focus between buttons)
  if (e.key.startsWith('Arrow') && !spot && shown.length) {
    const i = shown.findIndex((p) => tiles.get(p).el === document.activeElement);
    const cols = Math.ceil(Math.sqrt(shown.length));
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    const next = shown[Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i + step)))];
    tiles.get(next)?.el.focus();
    e.preventDefault();
  }
});
