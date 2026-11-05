// Studio, part 3 of 23: live mode: the camera tiles, break and black as sources, keeping pictures moving.
// Loads after clips.js: that import comes first, so the parts run in order (see ../studio.js).
import './clips.js';
import { toast, now, announce } from '/js/vm.js';
import { drawSlate } from '/js/compose.js';
import * as S from '/js/sequence.js';
import {
  $, KIOSK, LIVE_DELAY, black, clips, cut, fit, isHost, live, liveActive, mode, note, player, seq,
  setLastLive, setLiveActive,
} from './core.js';
import { angleCids, angleOfCid, rebuild, saveCut, snapshot } from './clips.js';
import { renderQuality } from './usage.js';
import { autoOn, director, manualUntil, setDirectorBreak, setManualUntil, syncTally } from './onair.js';
import { mix, mixFollowCut, mixState } from './mixer.js';
import { ccuSync } from './ccu.js';
import { dmRow, renderBus } from './room.js';
import {
  blackHint, drawMicVisual, mediaOn, onBreak, setBreakManual, slateLook, slateText, stopMedia,
  syncBreakUi,
} from './graphics.js';
import { pvw, pvwSpecial, setPvw, stalled, sw, takeSource, takeSpecial, tapMode } from './switcher.js';
import { lastOnAir, renderOverflow } from './phones.js';
import { renderTimeline } from './edit.js';

// ---------------------------------------------------------------- live mode ---

// cameras with a live picture (record-only overflow phones aren't shown live)
export const camOrder = () => [...live.keys()].filter((p) => live.get(p).role !== 'mic' && !live.get(p).overflow)
  .sort((a, b) => (angleOfCid(live.get(a).cid) || 99) - (angleOfCid(live.get(b).cid) || 99));
export const micPeers = () => [...live.keys()].filter((p) => live.get(p).role === 'mic');
/** A microphone's number key: they come after the cameras' numbers (cameras 1–3, microphones 4, 5…). */
export const micKey = (peer) => {
  const i = micPeers().indexOf(peer);
  const n = angleCids.length + i + 1;
  return i < 0 || n > 9 ? 0 : n;
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
    box.insertAdjacentHTML('afterbegin', `<div class="empty">${KIOSK ? 'No cameras yet: scan the code to join.' : 'No phones yet. Put the beacon on a screen; phones on this Wi-Fi that scan it show up here.'}</div>`);
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
    if (l.paused && !pz) l.tile.insertAdjacentHTML('beforeend', '<span class="pz">PAUSED</span>');
    else if (!l.paused) pz?.remove();
    if (isHost && !l.local) dmRow(peer, l, i);
    l.tile.querySelector('.n').textContent = angleOfCid(l.cid) || i + 1;
    l.tile.querySelector('.who').textContent = l.name;
    // a camera that hasn't synced with the beacon: its clips would be placed by its own clock
    let ns = l.tile.querySelector('.nosync');
    const unsynced = l.tele?.synced === false;
    if (unsynced && !ns) l.tile.insertAdjacentHTML('beforeend', '<span class="nosync" title="This phone hasn’t synced with the beacon yet: ask them to point it at the beacon screen once">NO SYNC</span>');
    else if (!unsynced) ns?.remove();
    let pcTag = l.tile.querySelector('.pctag');
    if (l.fixed && !pcTag) l.tile.insertAdjacentHTML('beforeend', '<span class="pctag" title="A computer camera: fixed, no gyro">PC</span>');
    else if (!l.fixed) pcTag?.remove();
    const r = l.tile.querySelector('.route');
    r.textContent = { lan: 'LAN', nat: 'LAN·NAT', cellular: 'CELL', internet: 'NET', relay: 'RELAY', local: 'THIS PC' }[l.route] || '…';
    r.className = 'route ' + (l.route === 'nat' || l.route === 'local' ? 'lan' : l.route);
    r.title = { local: 'A camera on this computer: on the studio\u2019s own clock, no beacon needed', lan: 'Direct over the local network', nat: 'Same network, through the router', cellular: 'On mobile data — ask this guest to join the venue Wi-Fi' }[l.route] || 'Not on the local network — ask this guest to join the venue Wi-Fi';
    l.tile.querySelector('.rec').hidden = !l.rec;
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Camera ${angleOfCid(l.cid) || i + 1}, ${l.name}${peer === liveActive ? ', on air' : ''}${l.rec ? ', recording' : ''}`);
  });
  // Microphones are live sources too: click one (or press its number) to put it on air, with
  // its sound on the program picture and the tally on the phone, like a camera.
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
    l.tile.style.order = -10 + i;
    l.tile.style.display = ''; // (Edit hides every source; bring microphones back too)
    const n = micKey(peer);
    l.tile.querySelector('.glyph').textContent = n || 'M';
    l.tile.querySelector('b').textContent = `${l.name} · mic${l.rec ? ' · recording' : ''}`;
    l.tile.classList.toggle('on', mixState(l.cid || peer, 'mic').mode !== 'off');
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Microphone ${n}, ${l.name}${peer === liveActive ? ', on air' : ''}. Put it on air.`);
  });
  renderSpecials();
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

export function cutLive(peer, autoReason, opts = {}) {
  if (!isHost) return;
  const l = live.get(peer);
  if (!l) return;
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
  note(`${opts.dissolve ? 'Dissolve' : autoReason ? 'Auto' : 'Cut'}: ${l.role === 'mic' ? `microphone ${micKey(peer) || ''}` : `camera ${angleOfCid(l.cid)}`} (${l.name})${autoReason ? ' — ' + autoReason : ''}`);
  announce(`Cut to camera ${angleOfCid(l.cid)}, ${l.name}`);
}

// Phones send a square picture with the shot somewhere inside it; size the tile's
// video so exactly the shot fills the tile.
export function fitTile(l) {
  const v = l.video, tile = l.tile;
  if (!v || !tile) return;
  const r = l.view?.rect;
  if (!r) {
    Object.assign(v.style, { width: '100%', height: '100%', left: '0', top: '0', objectFit: 'cover' });
    return;
  }
  const TW = tile.clientWidth, TH = tile.clientHeight;
  const k = fit === 'fit' ? Math.min(TW / r.w, TH / r.h) : Math.max(TW / r.w, TH / r.h);
  Object.assign(v.style, { objectFit: 'fill', width: k + 'px', height: k + 'px', left: (TW - r.w * k) / 2 - r.x * k + 'px', top: (TH - r.h * k) / 2 - r.y * k + 'px' });
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
