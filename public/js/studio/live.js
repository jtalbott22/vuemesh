// Studio, part 3 of 29: live mode: the camera tiles, break and black as sources, keeping pictures moving.
// Loads after clips.js: that import comes first, so the parts run in order (see ../studio.js).
import './clips.js';
import { toast, now, announce } from '/js/vm.js';
import { drawSlate } from '/js/compose.js';
import * as S from '/js/sequence.js';
import {
  $, KIOSK, LIVE_DELAY, black, clips, cut, eventId, fit, hub, isHost, live, liveActive, mode, note, player, seq,
  setLastLive, setLiveActive,
} from './core.js';
import { rebuild, saveCut, snapshot } from './clips.js';
import { renderQuality } from './usage.js';
import { autoOn, director, manualUntil, setDirectorBreak, setManualUntil, syncTally } from './onair.js';
import { mix, mixFollowCut, mixState } from './mixer.js';
import { ccuSync } from './ccu.js';
import { dmRemove, dmRow, renderBus } from './room.js';
import {
  blackHint, drawMicVisual, mediaOn, onBreak, setBreakManual, slateLook, slateText, stopMedia,
  syncBreakUi,
} from './graphics.js';
import { pvw, pvwSpecial, setPvw, stalled, sw, takeSource, takeSpecial, tapMode } from './switcher.js';
import { lastOnAir, renderOverflow } from './phones.js';
import { renderTimeline } from './edit.js';

// ---------------------------------------------------------------- live mode ---

// The sources' numbers in Live: on their tiles, the 1–9 keys, "camera 3" in the show log. Each
// source in the show holds the lowest number free when it came in, and keeps it while it stays: one
// that leaves frees its number for the next, and one that comes back gets its own again if it's
// free (kept across a reload). Cameras, screens and microphones share them. Edit keeps its own
// angle numbers, one per device for good (clips.js), since its clips are filed by them; in a show
// used again and again those climbed past 9, which no key could reach (a fifth source was 10).
const NOS_KEY = 'vm_liveno_' + eventId;
let lastNo = {};
try { lastNo = JSON.parse(localStorage.getItem(NOS_KEY) || '{}') || {}; } catch {}
const nos = new Map(); // a source's id → its number, for the sources in the show now
const noId = (peer) => live.get(peer)?.cid || peer;
const numbered = (l) => !l.overflow; // (a record-only overflow phone isn't shown live: no number, until it is)
function syncNos() {
  const here = new Set();
  const order = [...live].filter(([, l]) => numbered(l)).sort(([, a], [, b]) => (a.joinedAt || 0) - (b.joinedAt || 0));
  for (const [peer] of order) here.add(noId(peer));
  for (const id of [...nos.keys()]) if (!here.has(id)) nos.delete(id);
  const used = new Set(nos.values());
  let changed = false;
  for (const id of here) {
    if (nos.has(id)) continue;
    let n = lastNo[id];
    if (!(n >= 1) || used.has(n)) for (n = 1; used.has(n); n++);
    nos.set(id, n);
    used.add(n);
    if (lastNo[id] !== n) (lastNo[id] = n), (changed = true);
  }
  if (changed) try { localStorage.setItem(NOS_KEY, JSON.stringify(lastNo)); } catch {}
}
/** A source's number in Live (0: none, as for an overflow phone). */
export function liveNo(peer) {
  if (!live.has(peer)) return 0;
  syncNos();
  return nos.get(noId(peer)) || 0;
}
/** The source on a number key (1–9), or null. */
export function peerOfNo(n) {
  syncNos();
  return [...live.keys()].find((p) => numbered(live.get(p)) && nos.get(noId(p)) === n) || null;
}
window.vmLiveNos = () => Object.fromEntries([...live.keys()].map((p) => [live.get(p).name, liveNo(p)])); // (tests)

// cameras with a live picture (record-only overflow phones aren't shown live), by number
export const camOrder = () => [...live.keys()].filter((p) => live.get(p).role !== 'mic' && !live.get(p).overflow)
  .sort((a, b) => (liveNo(a) || 99) - (liveNo(b) || 99));
export const micPeers = () => [...live.keys()].filter((p) => live.get(p).role === 'mic');
/** A microphone's number key (0: none above 9). */
export const micKey = (peer) => {
  const n = live.get(peer)?.role === 'mic' ? liveNo(peer) : 0;
  return n > 9 ? 0 : n;
};
export const isMic = (peer) => live.get(peer)?.role === 'mic';
// How loud each microphone has been lately (smoothed over about half a second), from its
// own analyser before the fader, so a fader or AFV doesn't change who's "talking".
const micLoud = new Map(), micBuf = new Float32Array(512);
export function loudestMic() {
  let best = null, bestV = -1;
  for (const p of micPeers()) {
    const v = micLoud.get(p) || 0;
    if (v > bestV) [best, bestV] = [p, v];
  }
  return best;
}
setInterval(() => {
  for (const p of micPeers()) {
    const st = mix.strips?.get(p);
    if (!st?.pre) continue;
    st.pre.getFloatTimeDomainData(micBuf);
    let ss = 0;
    for (let i = 0; i < micBuf.length; i++) ss += micBuf[i] * micBuf[i];
    const rms = Math.sqrt(ss / micBuf.length);
    micLoud.set(p, (micLoud.get(p) || 0) * 0.6 + rms * 0.4);
  }
  // the auto director for sound: no cameras up, two or more microphones: whoever's talking
  if (!autoOn || mode !== 'live' || onBreak() || mediaOn || Date.now() < manualUntil) return;
  const camUp = camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; });
  if (camUp || micPeers().length < 2) return;
  const best = loudestMic(), cur = liveActive && isMic(liveActive) ? liveActive : null;
  const bv = micLoud.get(best) || 0, cv = cur ? micLoud.get(cur) || 0 : 0;
  const held = Date.now() - (lastOnAir.get(cur) || 0);
  // louder by about 4 dB, above room noise (about −46 dBFS), and the current one held 2.5 s
  if (best && best !== cur && bv > 0.005 && bv > cv * 1.6 && (!cur || held > 2500)) cutLive(best, 'speaking');
}, 150);

export function renderLive() {
  ccuSync();
  if (pvw && !live.has(pvw)) setPvw(null);
  if (sw.to && !live.has(sw.to)) Object.assign(sw, { from: null, to: null, toClip: null, fromClip: null, p: 0, target: 0, auto: null, pos: sw.rest });
  if (mode !== 'live') return;
  renderBus();
  for (const l of live.values()) if (l.overflow && l.card) l.card.style.display = 'none';
  if (typeof renderOverflow === 'function') renderOverflow();
  const box = $('#multi');
  const cams = camOrder();
  box.querySelector('.empty')?.remove();
  box.querySelectorAll('.tile[data-angle]').forEach((t) => t.remove());
  $('#srcCount').textContent = cams.length ? `${cams.length} live` : '';
  if (!cams.length && !micPeers().length) {
    box.insertAdjacentHTML('afterbegin', `<div class="empty">${KIOSK ? 'No cameras yet: scan the code to join.' : 'No phones yet. Put the QR Beacon on a screen; phones on this Wi-Fi that scan it show up here.'}</div>`);
  }
  cams.forEach((peer, i) => {
    const l = live.get(peer);
    if (!l.tile) {
      l.tile = document.createElement('button');
      l.tile.type = 'button';
      l.tile.className = 'tile';
      l.tile.dataset.peer = peer;
      l.video = document.createElement('video');
      l.video.muted = true;
      l.video.playsInline = true;
      l.video.autoplay = true;
      l.tile.append(l.video);
      l.tile.insertAdjacentHTML('beforeend', `<span class="n"></span><span class="who"></span><span class="route"></span><span class="dot rec" hidden></span><span class="aud" aria-hidden="true"></span>`);
      l.tile.onclick = () => takeSource(peer);
      l.card = document.createElement('div');
      l.card.className = 'cam';
      l.card.append(l.tile);
      box.append(l.card);
    }
    l.card.style.display = '';
    l.card.style.order = i;
    if (!l.card.isConnected) box.append(l.card);
    if (l.video.srcObject !== l.stream) {
      l.video.srcObject = l.stream;
      l.video.play().catch(() => {});
    } else if (l.video.paused) l.video.play().catch(() => {});
    fitTile(l);
    renderQuality(l);
    l.tile.style.display = '';
    l.tile.classList.toggle('paused', !!l.paused);
    let pz = l.tile.querySelector('.pz');
    if (l.paused && !pz) l.tile.insertAdjacentHTML('beforeend', '<span class="pz"></span>');
    else if (!l.paused) pz?.remove();
    pz = l.tile.querySelector('.pz');
    if (pz && pz.dataset.w !== String(!!l.watching)) {
      pz.dataset.w = String(!!l.watching);
      pz.innerHTML = l.watching ? 'WATCHING<small>click to call back</small>' : 'PAUSED'; // (watching the program, full screen on the phone)
    }
    if (isHost && !l.local && !l.screen) dmRow(peer, l, i);
    else dmRemove(peer); // (another computer's screen: no messages; its share page has nowhere to show them)
    l.tile.querySelector('.n').textContent = liveNo(peer) || i + 1;
    l.tile.querySelector('.who').textContent = l.name;
    // a camera that hasn't synced with the beacon: its clips would be placed by its own clock
    let ns = l.tile.querySelector('.nosync');
    const unsynced = l.tele?.synced === false;
    if (unsynced && !ns) l.tile.insertAdjacentHTML('beforeend', '<span class="nosync" title="This phone hasn’t synced with the QR Beacon yet: ask them to point it at the QR Beacon screen once">NO SYNC</span>');
    else if (!unsynced) ns?.remove();
    let pcTag = l.tile.querySelector('.pctag');
    if (l.fixed && !pcTag) l.tile.insertAdjacentHTML('beforeend', '<span class="pctag" title="A computer camera: fixed, no gyro">PC</span>');
    else if (!l.fixed) pcTag?.remove();
    const r = l.tile.querySelector('.route');
    r.textContent = { lan: 'LAN', nat: 'LAN·NAT', cellular: 'CELL', internet: 'NET', relay: 'RELAY', local: 'THIS PC' }[l.route] || '…';
    r.className = 'route ' + (l.route === 'nat' || l.route === 'local' ? 'lan' : l.route);
    r.title = { local: 'A camera on this computer: on the studio\u2019s own clock, no QR Beacon needed', lan: 'Direct over the local network', nat: 'Same network, through the router', cellular: 'On mobile data — ask this guest to join the venue Wi-Fi' }[l.route] || 'Not on the local network — ask this guest to join the venue Wi-Fi';
    l.tile.querySelector('.rec').hidden = !l.rec;
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Camera ${liveNo(peer) || i + 1}, ${l.name}${peer === liveActive ? ', on air' : ''}${l.rec ? ', recording' : ''}`);
  });
  // Microphones are live sources too: click one (or press its number) to put it on air, with
  // its sound on the program picture and the tally on the phone, like a camera.
  // Each one's name on its tile: what tells it apart first. Windows names every input "Microphone
  // (…)", so it's the part in brackets (without Windows' "2- "); one side of an input puts its
  // side first (Input 1 · Scarlett 2i2 4th Gen); two the same are numbered, as cameras are.
  const shortName = (name) => name.replace(/^Microphone \((?:\d+- )?(.+?)\)/, '$1').replace(/^(.*) · (Input \d)$/, '$2 · $1');
  const shorts = new Map(), seenShort = new Map();
  for (const peer of micPeers()) {
    const s = shortName(live.get(peer).name), k = (seenShort.get(s) || 0) + 1;
    seenShort.set(s, k);
    shorts.set(peer, k > 1 ? `${s} ${k}` : s);
  }
  micPeers().forEach((peer, i) => {
    const l = live.get(peer);
    if (!l.tile) {
      l.tile = document.createElement('button');
      l.tile.type = 'button';
      l.tile.className = 'mic';
      l.tile.dataset.peer = peer;
      // (its picture: what the program shows while it's on air, drawn from its own sound)
      l.tile.innerHTML = `<canvas class="mv" width="320" height="180" aria-hidden="true"></canvas><span class="glyph" aria-hidden="true">M</span><b></b><span class="meter" aria-hidden="true"><i></i></span>`;
      l.tile.onclick = () => takeSource(peer);
      box.prepend(l.tile);
    }
    l.tile.style.order = 1000 + i; // (after the cameras, as their numbers are)
    l.tile.classList.toggle('first', i === 0);
    l.tile.style.display = ''; // (Edit hides every source; bring microphones back too)
    const n = micKey(peer);
    l.tile.querySelector('.glyph').textContent = n || 'M';
    const short = shorts.get(peer);
    l.tile.querySelector('b').textContent = `${short}${short === l.name ? ' · mic' : ''}`;
    l.tile.title = `${l.name}${l.rec ? ' (recording)' : ''}`;
    l.tile.classList.toggle('on', mixState(l.cid || peer, 'mic').mode !== 'off');
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Microphone ${n}, ${l.name}${peer === liveActive ? ', on air' : ''}. Put it on air.`);
  });
  renderSpecials();
  fitSources();
}

// ---- every source in view, without scrolling ------------------------------------------------
// The sources panel shows every source at once if it can: pictures (the break, black, each
// camera) as large as the panel's height allows, in as many columns as that takes, and the
// microphones under them, as tiles if there's room, else as strips (number, name, level). With
// three cameras and five microphones on a 1024 x 768 screen, the panel was 306 px tall and its
// sources 1,216 px: one column of big tiles, scrolled. A grid of 12 lets pictures and microphones
// each have their own number across. A phone scrolls the page instead (one column).
const GRID = 12, SPANS = [1, 2, 3, 4, 6], GAP = 8, MIC_STRIP = 40, MIN_PIC = 76;
export function fitSources() {
  const box = $('#multi'), panel = box?.closest('.sources');
  if (!box || !panel || KIOSK || mode !== 'live' || innerWidth <= 640 || box.querySelector('.empty') || !panel.clientHeight) {
    box?.classList.remove('fitted', 'micstrips');
    return;
  }
  const shown = (el) => el.style.display !== 'none';
  const cards = [...box.querySelectorAll(':scope > .cam:not(.specials)')].filter(shown);
  const mics = [...box.querySelectorAll(':scope > button.mic')].filter(shown);
  const pics = cards.length + (box.querySelector('.specials') ? 2 : 0);
  const cs = getComputedStyle(box);
  const W = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  // the height the panel has for them: all of it, less everything else in it
  let other = 0;
  for (const el of panel.children) if (el !== box && el.offsetParent) other += el.offsetHeight;
  const H = panel.clientHeight - other - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  // a camera's card can hold more than its picture (a phone's sound mode under it)
  const extra = Math.max(0, ...cards.map((c) => c.offsetHeight - (c.querySelector('.tile')?.offsetHeight || c.offsetHeight)));
  const portrait = document.body.classList.contains('portrait');
  const picH = (w) => (portrait ? Math.min(220, (w * 16) / 9) : (w * 9) / 16);
  const rowsH = (n, per, h) => (n ? Math.ceil(n / per) * (h + GAP) - GAP : 0);
  const between = (a, b) => (a && b ? GAP : 0);
  let best = null;
  for (const strips of [false, true]) {
    for (const per of SPANS) {
      const w = (W + GAP) / per - GAP;
      if (w < MIN_PIC && per > 1) continue;
      const h = picH(w) + extra;
      let total;
      let micPer = 0;
      if (strips) {
        micPer = SPANS.filter((k) => (W + GAP) / k - GAP >= 120).at(-1) || 1; // (a strip: its number and enough of its name to tell it apart)
        total = rowsH(pics, per, h) + between(pics, mics.length) + rowsH(mics.length, micPer, MIC_STRIP);
      } else total = rowsH(pics, per, h) + between(pics, mics.length) + rowsH(mics.length, per, h); // (the microphones start a row of their own)
      const fits = total <= H;
      // the biggest pictures that fit (the microphones as tiles if the pictures can be as big that
      // way, strips if that makes them bigger); if nothing fits, the least scrolling
      const score = fits ? w : -total;
      if (!best || (fits && !best.fits) || (fits === best.fits && score > best.score + 0.5)) best = { per, micPer, strips, fits, score };
    }
  }
  box.classList.add('fitted');
  box.classList.toggle('micstrips', best.strips);
  box.style.setProperty('--pspan', String(GRID / best.per));
  box.style.setProperty('--mspan', String(GRID / (best.strips ? best.micPer : best.per)));
}
{
  const panel = $('#multi')?.closest('.sources');
  if (panel && !KIOSK) {
    let queued = false;
    const again = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fitSources();
        live.forEach(fitTile);
      });
    };
    new ResizeObserver(again).observe(panel);
  }
}

// ---- the break and black as sources: tiles beside the cameras -----------------------------
export function renderSpecials() {
  const box = $('#multi');
  if (KIOSK || !box || mode !== 'live') return;
  let row = box.querySelector('.specials');
  if (!row) {
    row = document.createElement('div');
    row.className = 'cam specials';
    row.innerHTML = [['break', 'Break', 'B', 'The break slate (B cuts to it)'], ['black', 'Black', '⇧X', 'Black (Shift+X cuts to it, X fades)']]
      .map(([k, name, key, title]) => `<button type="button" class="tile special" data-special="${k}" title="${title}"><canvas width="320" height="180" aria-hidden="true"></canvas><span class="n">${key}</span><span class="who">${name}</span></button>`).join('');
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-special]');
      if (b) takeSpecial(b.dataset.special);
    });
    box.append(row);
  }
  row.style.display = '';
  const air = { break: onBreak() && black.target !== 1, black: black.target === 1 };
  for (const b of row.querySelectorAll('[data-special]')) {
    const k = b.dataset.special;
    b.classList.toggle('live', air[k]);
    b.classList.toggle('pvw', pvwSpecial === k);
    b.setAttribute('aria-pressed', String(air[k]));
    b.setAttribute('aria-label', `${k === 'black' ? 'Black' : 'The break'}${air[k] ? ', on air. Tap to come back.' : tapMode === 'preview' ? '. Put it in preview.' : '. Put it on air.'}`);
  }
}
/** The source tiles that are pictures we draw (the break, black, each microphone): about 8 a second. */
let srcPrevAt = 0;
export function drawSourcePreviews() {
  if (document.hidden || stalled() || performance.now() - srcPrevAt < 125) return;
  srcPrevAt = performance.now();
  const brk = document.querySelector('#multi [data-special="break"] canvas');
  if (brk?.offsetParent) drawSlate(brk.getContext('2d'), brk.width, brk.height, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
  const blk = document.querySelector('#multi [data-special="black"] canvas');
  if (blk?.offsetParent && !blk.dataset.drawn) {
    const g = blk.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, blk.width, blk.height);
    blk.dataset.drawn = '1';
  }
  for (const peer of micPeers()) {
    const c = live.get(peer)?.tile?.querySelector('canvas.mv');
    if (c?.offsetParent) drawMicVisual(c.getContext('2d'), c.width, c.height, micTileOpts(peer));
  }
}
/** One microphone's own sound and name for its picture (its tile, the preview box). */
const micTile = new Map(); // peer → { env, at, caps }
export function micTileOpts(peer) {
  const an = mix.strips.get(peer)?.pre;
  let st = micTile.get(peer);
  if (!st) micTile.set(peer, (st = { env: new Float32Array(90), at: 0, caps: new Float32Array(64) }));
  return { an, spec: an, state: st, name: live.get(peer)?.name || '' };
}

/** Ask a camera that's watching the program (full screen on the phone, its picture paused) to come back to its camera. */
export function callBack(peer) {
  const l = live.get(peer);
  if (!l?.watching) return false;
  const ok = !!hub?.message(peer, { t: 'callback' });
  note(`Asked ${l.name} back to their camera`);
  toast(ok ? `Asked ${l.name} back to their camera` : `Couldn't reach ${l.name} right now`);
  return ok;
}

export function cutLive(peer, autoReason, opts = {}) {
  if (!isHost) return;
  const l = live.get(peer);
  if (!l) return;
  if (l.watching && !autoReason) return void callBack(peer); // (wanted on air: they're asked back first)
  if (l.overflow) return toast(`${l.name} is recording only (the live pictures are full). Swap them in first.`);
  if (l.paused) return toast(`${l.name} has paused their camera`);
  lastOnAir.set(peer, Date.now());
  if (liveActive) lastOnAir.set(liveActive, Date.now());
  if (!autoReason && autoOn) setManualUntil(Date.now() + 8000); // you took over; the director waits
  director.set(peer, Date.now());
  setBreakManual(false);
  setDirectorBreak(false);
  if (mediaOn) stopMedia();
  setLiveActive(peer);
  setLastLive(peer);
  // (the live cut that Edit starts from is pictures: a microphone on air doesn't change it)
  if (l.cid && l.role !== 'mic') {
    snapshot();
    // (from black, the fade up puts the camera in the live cut: see toggleBlack)
    if (!opts.underBlack) cut.edl.push({ t: (opts.at ?? now()) - LIVE_DELAY, cid: l.cid, ...(opts.dissolveMs >= 40 ? { dissolve: Math.round(opts.dissolveMs) } : {}) }); // (a dissolve: from when it began, as long as it took)
    saveCut();
    if (seq.auto && clips.length) {
      rebuild(false);
      player.setSequence(seq);
      renderTimeline();
    }
  }
  mixFollowCut();
  renderLive();
  syncBreakUi();
  syncTally();
  if (!autoReason && !opts.underBlack) blackHint();
  if (pvw === peer) setPvw(null);
  note(`${opts.dissolve ? 'Dissolve' : autoReason ? 'Auto' : 'Cut'}: ${l.role === 'mic' ? 'microphone' : 'camera'} ${liveNo(peer)} (${l.name})${autoReason ? ' — ' + autoReason : ''}`);
  announce(`Cut to ${l.role === 'mic' ? 'microphone' : 'camera'} ${liveNo(peer)}, ${l.name}`);
}

// Phones send a square picture with the shot somewhere inside it; size the tile's
// video so exactly the shot fills the tile.
export function fitTile(l) {
  const v = l.video, tile = l.tile;
  if (!v || !tile) return;
  const r = l.view?.rect;
  if (!r) {
    Object.assign(v.style, { width: '100%', height: '100%', left: '0', top: '0', objectFit: l.screen ? 'contain' : 'cover' }); // (a screen whole, as on the program)
    return;
  }
  // The rect is a part of the picture as sent, in fractions of its width and height. A phone's camera
  // page sends a square (the shot inside it); the remote's camera, and a camera page in a background
  // tab, send the whole frame. Taken as a square, a 16:9 frame was squeezed to one in the tile (the
  // program, drawn from its real size, was right). A = the frame's width for a height of 1.
  if (!v.__refit) {
    v.__refit = true;
    v.addEventListener('resize', () => fitTile(l)); // (its size comes with its first frame, and changes with a lens or a turn)
  }
  const A = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 1;
  const TW = tile.clientWidth, TH = tile.clientHeight;
  const k = fit === 'fit' ? Math.min(TW / (r.w * A), TH / r.h) : Math.max(TW / (r.w * A), TH / r.h);
  Object.assign(v.style, { objectFit: 'fill', width: A * k + 'px', height: k + 'px', left: (TW - r.w * A * k) / 2 - r.x * A * k + 'px', top: (TH - r.h * k) / 2 - r.y * k + 'px' });
  tile.dataset.shape = l.view.upright;
}
window.addEventListener('resize', () => live.forEach(fitTile));

// ---- keep live pictures moving ------------------------------------------------------------
// A live picture can stop in three places: this window's player (the tile), the decoder
// (video arrives but no frames come out of it), or the phone's sender (the phone is running
// and drawing, but no picture arrives). Reloading the studio fixed all three because it
// rebuilds every connection. Instead, every two seconds each camera is checked and only the
// stuck part is fixed: a fresh player for the tile (swapped in once it has a frame, so the
// program never blinks), or a reconnect for that one phone. Every fix goes in the log.
export const picHealth = new Map(); // peer → { fixes: [ms], reconnects: [ms], warned }
// Sound: every two seconds, each phone's muted player is kept playing, the audio engine
// kept running, and a sound source that has given nothing but exact zeros for 8 seconds
// (real microphones always hiss a little) is rebuilt from the phone's track.
export const preBuf = new Float32Array(512);
// What the edit is playing right now: each clip's player, whether it's running, where its
// sound goes, and the audio engine's state (diagnostics and tests).
window.vmEdit = () => ({
  ctx: player.ctx.state,
  playing: player.playing,
  t: Math.round(player.t),
  tracks: (seq.tracks || []).filter((t) => t.kind === 'audio').map((t) => ({ id: t.id, name: t.name, muted: !!t.muted, gain: t.gain ?? 1, items: S.audioItems ? undefined : undefined })),
  els: [...player.els.values()].map((e) => ({ key: e.key.slice(0, 40), paused: e.v.paused, ready: e.v.readyState, error: e.v.error?.code || null, muted: e.v.muted, gain: Math.round(e.gain.gain.value * 100) / 100, bus: e.wired || null })),
});
