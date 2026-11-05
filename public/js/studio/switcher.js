// Studio, part 13 of 24: the live program and the switcher; running while covered.
// Loads after graphics.js: that import comes first, so the parts run in order (see ../studio.js).
import './graphics.js';
import { toast, now, announce } from '/js/vm.js';
import { drawFramed, drawSlate } from '/js/compose.js';
import { BRAND } from '/js/brand.js';
import {
  $, EDIT_ONLY, black, ev, fit, fitMonitors, isHost, live, liveActive, mode, player, progOutPeers,
  program,
} from './core.js';
import { angleOfCid, output } from './clips.js';
import { cutLive, drawSourcePreviews, isMic, micKey, micTileOpts, renderLive } from './live.js';
import { directorTick, syncTally } from './onair.js';
import { mix, mixGates, mixInit } from './mixer.js';
import {
  activeFrameOk, blackLevel, breakManual, cutMedia, drawBlack, drawBreak, drawLowerThird,
  drawMicVisual, drawSlatePreview, ensureProg, everLive, mediaOn, micNames, micOnlyUp, onBreak, reel,
  renderClips, setBreak, setEverLive, setSlateClock, slateLook, slateSound, slateText, toggleBlack,
  toggleBreak, updateAutoBreak,
} from './graphics.js';

// ---- the live program -----------------------------------------------------------------

const pg = program.getContext('2d');
let wasBreak = false, slateLayer = null;
function drawLiveFrame() {
  if (mode !== 'live') return;
  updateAutoBreak();
  const W = program.width, H = program.height;
  if (onBreak() !== wasBreak) {
    wasBreak = onBreak();
    setSlateClock(performance.now());
  }
  const clip = mediaOn && reel.find((r) => r.id === mediaOn.id);
  let slateUp = false;
  const micAir = liveActive && isMic(liveActive) && !onBreak();
  if (!breakManual && !clip && (micAir || micOnlyUp())) {
    setEverLive(true);
    drawMicVisual(pg, W, H);
    $('#progLabel').textContent = micAir ? `ON AIR · MIC ${micKey(liveActive) || ''} ${live.get(liveActive).name}` : `ON AIR · MIC · ${micNames()}`;
  } else if (onBreak()) {
    slateUp = drawBreak(pg, W, H);
    $('#progLabel').textContent = 'ON AIR · BREAK';
  } else if (clip) {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    const el = clip.prog || clip.el;
    if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) drawFramed(pg, el, W, H, 'fit');
    const p = clip.prog && clip.prog.duration ? clip.prog.currentTime / clip.prog.duration : 0;
    $('#progLabel').textContent = `ON AIR · CLIP ${clip.name}${clip.prog && !clip.loop ? ` · ${Math.max(0, Math.ceil(clip.prog.duration - clip.prog.currentTime))} s` : ''}`;
    const bar = document.querySelector(`[data-media="${clip.id}"] .prog`);
    if (bar) bar.style.width = Math.round(p * 100) + '%';
  } else if (liveActive && activeFrameOk()) {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    drawFramed(pg, live.get(liveActive).video, W, H, fit, null, live.get(liveActive).view?.rect || null);
    $('#progLabel').textContent = `ON AIR · ${angleOfCid(live.get(liveActive).cid)} ${live.get(liveActive).name}`;
  } else if (!everLive) {
    drawSlate(pg, W, H, { message: 'Starting soon', title: ev?.title || '', brand: BRAND.name, look: slateLook, t: performance.now(), now: now() });
    $('#progLabel').textContent = live.size ? 'STANDBY · click a source' : 'STANDBY · waiting for phones';
  } else {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    $('#progLabel').textContent = 'ON AIR';
  }
  // a transition in progress: the incoming source over the outgoing one, by how far it's gone
  if (swActive() && sw.p > 0.001) {
    const b = live.get(sw.to), r = reelOf(sw.toClip);
    pg.globalAlpha = sw.fromSpecial === 'black' ? 1 : Math.min(1, sw.p); // (from black: the black lifts off it)
    if (sw.toSpecial === 'break' && sw.fromSpecial !== 'black') {
      const c = (slateLayer ||= document.createElement('canvas'));
      if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
      drawSlate(c.getContext('2d'), W, H, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
      pg.drawImage(c, 0, 0);
    } else if (r) {
      const el = r.prog || r.el;
      if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) {
        pg.save();
        pg.globalAlpha = 1;
        pg.fillStyle = `rgba(0,0,0,${Math.min(1, sw.p)})`; // (behind the clip: black, so a letterboxed clip fades its bars in too)
        pg.fillRect(0, 0, W, H);
        pg.restore();
        drawFramed(pg, el, W, H, 'fit');
      }
    } else if (b && isMic(sw.to)) drawMicVisual(pg, W, H);
    else if (b?.video?.readyState >= 2) drawFramed(pg, b.video, W, H, fit, null, b.view?.rect || null);
    pg.globalAlpha = 1;
    const SPECIAL = { black: 'BLACK', break: 'BREAK' };
    const fromName = SPECIAL[sw.fromSpecial] || (sw.fromClip ? reelOf(sw.fromClip)?.name : live.get(liveActive)?.name);
    const toName = SPECIAL[sw.toSpecial] || (r ? r.name : b?.name);
    if (toName) $('#progLabel').textContent = `ON AIR · ${fromName || '—'} → ${toName} · ${Math.round(sw.p * 100)}%`;
  }
  drawLowerThird(pg, W, H);
  slateSound(slateUp);
  drawBlack(pg, W, H);
  drawSlatePreview();
  drawSourcePreviews();
  const clock = new Date(now()).toLocaleTimeString();
  $('#ptc').textContent = clock;
  $('#clock').textContent = clock;
}

// ---------------------------------------------------------------- switcher ---
// Preview and program, like a vision mixer. With "Tap: Preview", tapping a source (or its
// number) puts it in preview (green on the tile, the preview box, and the phone); CUT takes
// it straight to air, AUTO dissolves over the chosen time, and the T-bar dissolves by hand:
// push it from one end to the other. The bar glides (eased every frame, like the phones'
// zoom) so a mouse, a finger or a hardware fader (MIDI) gives a smooth dissolve, never steps.
// Once a source is on air, what was on air goes to preview (flip-flop). "Tap: Air" keeps the
// old way: tap a source and it's on air.
export var pvw = null; // (var: drawing starts before this line runs)
export function setPvw(v) { return (pvw = v); }
export var pvwClip = null; // a clip in preview (by id): cued, paused at its first frame
export function setPvwClip(v) { return (pvwClip = v); }
export var pvwSpecial = null; // the break or black in preview ('break' | 'black')
// (toSpecial / fromSpecial: a dissolve to or from the break or black)
export var sw = { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, target: 0, rest: 0, pos: 0, auto: null, midAt: null };
export let tapMode = localStorage.getItem('vm_tapmode') === 'preview' ? 'preview' : 'air';
export const swActive = () => !!(sw.to || sw.toClip || sw.toSpecial);
/** The break or black on air (taken by hand), if either is. */
const airSpecial = () => (black.target === 1 ? 'black' : breakManual ? 'break' : null);
/** Something covers the camera on air (a clip, the break, black): that camera can wait in preview. */
export const airCovered = () => !!mediaOn || onBreak() || black.target === 1;
const inPreview = () => !!(pvw || pvwClip || pvwSpecial);
export const reelOf = (id) => reel.find((x) => x.id === id);
export function takeSource(peer) {
  if (tapMode === 'preview' && (peer !== liveActive || airCovered())) setPreview(peer);
  else cutLive(peer);
}
// The break and black are sources too: Tap: Preview puts one in preview, for CUT, AUTO or the
// T-bar (a fade to black as long as you like); Tap: Air, or tapping the one on air, cuts
// straight to it or back. B and Shift+X still cut, X still fades.
export function takeSpecial(kind) {
  if (!isHost || mode !== 'live') return;
  const onAir = kind === 'black' ? black.target === 1 : breakManual;
  if (tapMode === 'preview' && !onAir) return setPreviewSpecial(kind);
  if (kind === 'black') toggleBlack(false);
  else toggleBreak();
}
function setPreviewSpecial(kind) {
  if (swActive()) return toast('Finish the transition first');
  pvw = null;
  pvwClip = null;
  pvwSpecial = kind;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
  announce(`Preview: ${kind === 'black' ? 'black' : 'the break'}`);
}
// Clips follow the switcher too: Tap: Preview cues a clip in preview, paused at its first
// frame; it starts playing as it goes on air (CUT) or as the dissolve to it begins.
export function takeClip(id) {
  if (tapMode === 'preview' && mediaOn?.id !== id) setPreviewClip(id);
  else cutMedia(id);
}
/** The clip's on-air player, made if needed, wound back to the start and paused. */
function cueClip(r) {
  if (!r?.type.startsWith('video/')) return;
  ensureProg(r);
  r.prog.pause();
  r.prog.currentTime = 0;
  r.prog.volume = 1;
}
export function setPreview(peer) {
  if (swActive()) return toast('Finish the transition first');
  pvw = peer && (peer !== liveActive || airCovered()) && live.has(peer) ? peer : null;
  if (pvw) pvwClip = pvwSpecial = null;
  if (!inPreview()) $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
  const l = live.get(pvw);
  if (l) announce(`Preview: ${l.name}`);
}
export function clearPreview() {
  pvw = null;
  pvwClip = null;
  pvwSpecial = null;
  $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
export function setPreviewClip(id) {
  if (swActive()) return toast('Finish the transition first');
  const r = reelOf(id);
  pvwClip = r && mediaOn?.id !== id ? id : null;
  if (pvwClip) {
    pvw = pvwSpecial = null;
    cueClip(r);
    announce(`Preview: ${r.name}, cued at the start`);
  }
  if (!inPreview()) $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function startTransition() {
  if (!isHost) return false;
  const fromSpecial = airSpecial();
  if (pvwSpecial) {
    if (pvwSpecial === fromSpecial) return false;
    Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: null, toClip: null, toSpecial: pvwSpecial, midAt: null, began: performance.now(), startAt: now(), breakUnder: false });
    // the break comes up from black: it goes on under the black, which then lifts
    if (pvwSpecial === 'break' && fromSpecial === 'black') {
      setBreak(true);
      sw.breakUnder = true;
    }
    return true;
  }
  if (pvwClip) {
    const r = reelOf(pvwClip);
    if (!r) return false;
    Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: null, toClip: r.id, toSpecial: null, midAt: null, breakUnder: false, began: performance.now(), startAt: now() });
    // it starts as the dissolve to it begins
    if (r.prog) {
      r.prog.loop = !!r.loop;
      r.prog.volume = 0;
      mixInit();
      player.ctx.resume();
      r.prog.play().catch(() => {});
    }
    return true;
  }
  if (!pvw || !live.has(pvw)) return false;
  const l = live.get(pvw);
  if (l.overflow || l.paused) return toast(`${l.name} can't go on air right now`), false;
  Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: pvw, toClip: null, toSpecial: null, midAt: null, breakUnder: false, began: performance.now(), startAt: now() });
  syncTally(); // (both on air through the dissolve: the incoming one's tally comes on now, and it starts recording)
  return true;
}
/** The T-bar moved (by hand, keys or a fader): 0..1 along its length. */
function setBar(pos) {
  pos = Math.min(1, Math.max(0, pos));
  if (!swActive() && Math.abs(pos - sw.rest) > 0.004 && !startTransition()) return;
  sw.auto = null;
  sw.pos = pos;
  sw.target = Math.abs(pos - sw.rest);
}
const NOTHING_IN_PREVIEW = 'Put a source, a clip, the break or black in preview first (Tap: Preview, or right-click a camera)';
export function autoTransition() {
  if (!swActive() && !startTransition()) return inPreview() ? null : toast(NOTHING_IN_PREVIEW);
  sw.auto = { t0: performance.now(), from: sw.target, dur: +$('#swDur').value * 1000 * (1 - sw.target) };
}
/** What was on air goes to preview, ready to come back: a clip cued at its start again. */
function flipFlop(fromPeer, fromClip) {
  if (fromClip && reelOf(fromClip)) {
    pvw = null;
    pvwClip = fromClip;
    cueClip(reelOf(fromClip));
  } else {
    pvwClip = null;
    pvw = fromPeer && live.has(fromPeer) && (fromPeer !== liveActive || airCovered()) ? fromPeer : null;
  }
  pvwSpecial = null;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
export function takeCut() {
  if (swActive()) return Object.assign(sw, { target: 1, p: 1, auto: null, pos: 1 - sw.rest });
  if (!inPreview()) return toast(NOTHING_IN_PREVIEW);
  // to or from black, or to the break: a dissolve that's already over (it lands the same way)
  if (pvwSpecial || airSpecial() === 'black') {
    if (startTransition()) Object.assign(sw, { target: 1, p: 1, auto: null, pos: 1 - sw.rest });
    return;
  }
  const fromPeer = liveActive, fromClip = mediaOn?.id || null, fromSpecial = airSpecial();
  if (pvwClip) {
    if (fromSpecial === 'break') setBreak(false);
    cutMedia(pvwClip); // (from the top: it starts now)
  } else cutLive(pvw);
  flipFlop(fromPeer, fromClip);
  if (fromSpecial) flipSpecial(fromSpecial);
}
/** Back from the break or black: it waits in preview, ready to go again (flip-flop). */
function flipSpecial(kind) {
  pvw = pvwClip = null;
  pvwSpecial = kind;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function finishTransition() {
  const fromPeer = sw.from, fromClip = sw.fromClip, to = sw.to, toClip = sw.toClip, startAt = sw.startAt ?? now();
  const toSpecial = sw.toSpecial, fromSpecial = sw.fromSpecial;
  sw.lastTook = Math.round(performance.now() - (sw.began || performance.now())); // (diagnostics: how long it took)
  const dissolveMs = now() - startAt;
  Object.assign(sw, { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, target: 0, auto: null, rest: sw.rest ? 0 : 1, breakUnder: false });
  sw.pos = sw.rest;
  const took = Math.max(1, Math.round(dissolveMs)); // (a fade that's already happened: black only lands)
  if (fromClip) {
    const r = reelOf(fromClip);
    if (r?.prog) r.prog.volume = 1;
  }
  if (toSpecial) {
    if (toSpecial === 'black') toggleBlack(true, took);
    else {
      setBreak(true);
      if (fromSpecial === 'black') toggleBlack(true, took); // (the black lifted off the break)
    }
    // what was on air waits in preview: the break or black it came from, else the camera (a clip comes off)
    return fromSpecial ? flipSpecial(fromSpecial) : flipFlop(fromClip ? null : fromPeer, null);
  }
  if (fromSpecial === 'break' && toClip) setBreak(false);
  if (toClip) {
    const r = reelOf(toClip);
    if (r?.prog) r.prog.volume = 1;
    cutMedia(toClip, { playing: true, at: startAt, dissolveMs }); // (already playing since the dissolve began)
  } else if (fromSpecial === 'black') {
    if (to !== liveActive) cutLive(to, null, { underBlack: true });
  } else cutLive(to, null, { dissolve: true, at: startAt, dissolveMs });
  if (fromSpecial === 'black') toggleBlack(true, took); // (up from black: the fade up puts it in the live cut)
  flipFlop(fromSpecial === 'black' ? null : fromPeer, fromClip !== toClip ? fromClip : null);
  if (fromSpecial) flipSpecial(fromSpecial);
}
let swLast = 0, swGates = 0;
function switcherTick(t) {
  const dt = Math.min(0.25, Math.max(0, (t - (swLast || t)) / 1000)); // (a slow frame doesn't stall the dissolve)
  swLast = t;
  if (!swActive()) return;
  if (sw.auto) {
    const a = sw.auto, k = Math.min(1, (t - a.t0) / Math.max(1, a.dur)), e = k * k * (3 - 2 * k);
    sw.target = a.from + (1 - a.from) * e;
    sw.pos = sw.rest ? 1 - sw.target : sw.target;
    if (k >= 1) sw.auto = null;
  }
  sw.p += (sw.target - sw.p) * (1 - Math.exp(-dt / 0.07));
  if (Math.abs(sw.target - sw.p) < 0.002) sw.p = sw.target;
  if (sw.p >= 0.5 && sw.midAt == null) sw.midAt = now();
  // a clip's own sound fades with its picture: in comes up, out goes down
  if (sw.toClip) {
    const r = reelOf(sw.toClip);
    if (r?.prog) r.prog.volume = Math.min(1, Math.max(0, sw.p));
  }
  if (sw.fromClip && sw.fromClip !== sw.toClip) {
    const r = reelOf(sw.fromClip);
    if (r?.prog) r.prog.volume = Math.min(1, Math.max(0, 1 - sw.p));
  }
  if (t - swGates > 45) {
    swGates = t;
    mixGates();
  }
  if ((sw.toSpecial === 'black' || sw.fromSpecial === 'black') && mix.ftb) {
    const g = mix.ftb.gain, t0 = player.ctx.currentTime;
    g.cancelScheduledValues(t0);
    g.setTargetAtTime(1 - blackLevel(), t0, 0.015);
  }
  if (sw.p >= 0.999 && sw.target >= 0.999) finishTransition();
  else if (sw.p <= 0.001 && sw.target <= 0.001 && !sw.auto) {
    // pulled back: nothing changed (a clip that had started goes back to its start, paused)
    const back = sw.toClip && reelOf(sw.toClip);
    if (sw.fromClip) {
      const r = reelOf(sw.fromClip);
      if (r?.prog) r.prog.volume = 1;
    }
    if (sw.breakUnder) setBreak(false);
    const blk = sw.toSpecial === 'black' || sw.fromSpecial === 'black';
    Object.assign(sw, { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, midAt: null, breakUnder: false });
    if (blk && mix.ftb) {
      const g = mix.ftb.gain, t0 = player.ctx.currentTime;
      g.cancelScheduledValues(t0);
      g.setTargetAtTime(1 - black.target, t0, 0.015);
    }
    if (back) cueClip(back);
    mixGates();
    syncTally();
  }
  renderBar();
}
function renderBar() {
  const active = swActive();
  const shown = active ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest;
  $('#tbarHandle').style.setProperty('--y', shown);
  $('#tbarFill').style.setProperty('--p', active ? sw.p : 0);
  $('#tbar').setAttribute('aria-valuenow', String(Math.round((active ? sw.p : 0) * 100)));
  const toName = sw.toSpecial || (sw.toClip ? reelOf(sw.toClip)?.name : live.get(sw.to)?.name);
  $('#tbar').setAttribute('aria-valuetext', active ? `${Math.round(sw.p * 100)}% to ${toName || 'preview'}` : 'at rest');
}
export function renderSwitcher() {
  document.querySelectorAll('#switcher [data-tap]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tap === tapMode)));
  const l = live.get(pvw), r = reelOf(pvwClip);
  $('#pvwBox').hidden = !l && !r && !pvwSpecial;
  $('#pvwLabel').textContent = pvwSpecial ? `PREVIEW · ${pvwSpecial === 'black' ? 'BLACK' : 'BREAK'}` : r ? `PREVIEW · CLIP ${r.name} · cued` : l ? `PREVIEW · ${isMic(pvw) ? `MIC ${micKey(pvw) || ''}` : angleOfCid(l.cid)} ${l.name}` : 'PREVIEW';
  renderBar();
}
// the preview box: the source in preview, drawn small in the corner of the program monitor
// (only on this screen: it's never in the program itself)
function drawPreviewBox() {
  const l = live.get(pvw), r = reelOf(pvwClip);
  const gone = pvwSpecial ? pvwSpecial === airSpecial() : (!l && !r) || (l && pvw === liveActive && !airCovered()) || (r && mediaOn?.id === pvwClip);
  if (gone || mode !== 'live') {
    if (!$('#pvwBox').hidden) $('#pvwBox').hidden = true; // (it went on air, left, or Tap: Air)
    return;
  }
  if ($('#pvwBox').hidden) return;
  const c = $('#pvwCanvas'), g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  if (pvwSpecial === 'break') drawSlate(g, c.width, c.height, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
  else if (pvwSpecial) return; // (black)
  else if (r) {
    const el = r.prog || r.el;
    if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) drawFramed(g, el, c.width, c.height, 'fit');
  } else if (isMic(pvw)) drawMicVisual(g, c.width, c.height, micTileOpts(pvw));
  else if (l.video?.readyState >= 2) drawFramed(g, l.video, c.width, c.height, fit, null, l.view?.rect || null);
}
document.querySelectorAll('#switcher [data-tap]').forEach((b) => (b.onclick = () => {
  tapMode = b.dataset.tap;
  localStorage.setItem('vm_tapmode', tapMode);
  if (tapMode === 'air' && inPreview() && !swActive()) clearPreview(); // (Tap: Air: nothing waits in preview)
  renderClips();
  renderSwitcher();
  announce(tapMode === 'preview' ? 'Tapping a source puts it in preview' : 'Tapping a source puts it on air');
}));
$('#swCut').onclick = takeCut;
window.vmClips = () => reel.map((r) => ({ id: r.id, name: r.name, t: r.prog ? Math.round(r.prog.currentTime * 100) / 100 : null, paused: r.prog ? r.prog.paused : null, volume: r.prog?.volume ?? null })); // (tests and diagnostics)
window.vmSwitcher = () => ({ ...sw, pvw, pvwClip, liveActive, mediaOn: mediaOn?.id || null, tapMode }); // (tests and diagnostics)
$('#swAuto').onclick = autoTransition;
// the T-bar by hand: drag the handle (or anywhere on the bar); keys move it in steps
{
  const bar = $('#tbar');
  let drag = null;
  const at = (e) => {
    const r = bar.querySelector('.ttrack').getBoundingClientRect();
    return 1 - (e.clientY - r.top) / r.height;
  };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    drag = { off: at(e) - (swActive() ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest) };
    bar.classList.add('held');
  });
  bar.addEventListener('pointermove', (e) => drag && setBar(at(e) - drag.off));
  const up = () => {
    drag = null;
    bar.classList.remove('held');
  };
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.2 : 0.05, cur = swActive() ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest;
    if (e.key === 'ArrowUp') setBar(cur + step);
    else if (e.key === 'ArrowDown') setBar(cur - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}
// a hardware fader (any MIDI controller): press MIDI, move the fader, and it's the T-bar
$('#swMidi').onclick = async () => {
  if (!navigator.requestMIDIAccess) return toast('This browser has no MIDI (Chrome and Edge do)');
  try {
    const midi = await navigator.requestMIDIAccess();
    let map = JSON.parse(localStorage.getItem('vm_tbar_midi') || 'null');
    toast(map ? `T-bar on MIDI fader ${map.cc}. Move another fader within 5 s to change it.` : 'Move the fader you want to use as the T-bar', 5000);
    const learnUntil = Date.now() + 5000;
    for (const input of midi.inputs.values()) {
      input.onmidimessage = (m) => {
        const [st, cc, v] = m.data;
        if ((st & 0xf0) !== 0xb0) return;
        if (Date.now() < learnUntil && (!map || map.cc !== cc)) {
          map = { cc, name: input.name };
          localStorage.setItem('vm_tbar_midi', JSON.stringify(map));
          toast(`T-bar: ${input.name}, fader ${cc}`);
        }
        if (map && cc === map.cc) setBar(v / 127);
      };
    }
    $('#swMidi').setAttribute('aria-pressed', 'true');
  } catch {
    toast('MIDI access was refused');
  }
};
function setSwitcher(on) {
  $('#switcher').hidden = !on;
  document.querySelector('.monitor')?.classList.toggle('withswitcher', on);
  if (!on && inPreview() && !swActive()) clearPreview(); // (no switcher, no preview)
  fitMonitors();
  $('#swTgl').setAttribute('aria-pressed', String(on));
  localStorage.setItem('vm_switcher', on ? '1' : '0');
  renderSwitcher();
}
$('#swTgl').onclick = () => setSwitcher($('#switcher').hidden);
// The row under the program stays on one line: when it doesn't fit, the key hints go (the keys
// still work, and the buttons' titles say them), then the clock gets smaller, then the labels get
// short (Auto, Fade, Record, Mark). Only if even that doesn't fit does it wrap: never cut off.
{
  const row = document.querySelector('.transport');
  const fit = () => {
    if (!row?.offsetParent) return;
    const steps = ['tight', 'tighter', 'tightest', 'wrap'];
    row.classList.remove(...steps);
    for (const s of steps) {
      if (row.scrollWidth <= row.clientWidth + 1) break;
      row.classList.add(s);
    }
  };
  if (row) {
    new ResizeObserver(fit).observe(row);
    new MutationObserver(fit).observe(row, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  }
}
// a short monitor (a small laptop, a tall mixer dock): the MIDI button goes, so the T-bar keeps its throw
new ResizeObserver(([e]) => $('#switcher').classList.toggle('tight', e.contentRect.height < 380)).observe(document.querySelector('.monitor') || document.body);
setSwitcher(localStorage.getItem('vm_switcher') === '1');

// ---- keep the program running when this window is covered or hidden ---------------------
// Browsers pause animation frames in a covered or background window, which would freeze
// the program (and Program out, and a program recording). So: animation frames while
// we're visible; otherwise Program out's own frames drive us (vmPump), and a worker clock
// (which browsers don't slow down) covers everything else, including the auto director.
let lastRaf = 0, lastPump = 0, lastDirector = 0;
export const stalled = () => document.hidden || performance.now() - lastRaf > 120;
// The program's own clock. A frame is due every 1000/fps ms (Output settings) counted from when
// it started, not from the last frame, so the rate holds on average whatever drives the loop:
// animation frames while the studio is showing, the worker clock while it's hidden. Behind by a
// frame or more, the missed frames still count (a recording gets one each, the same picture),
// so the output keeps its rate and its time; drawing faster than the output (60 on most
// screens) would only double the work.
let nextDue = 0;
function dueFrames(t) {
  const p = 1000 / output.fps;
  if (!nextDue || t - nextDue > 1000) nextDue = t; // (the first frame, or a second behind: start again from now)
  if (t < nextDue - Math.min(4, p / 4)) return 0; // (a few ms early is on time: animation frames fall on the screen's beat)
  const n = 1 + Math.floor((t - nextDue) / p);
  nextDue += n * p;
  return n;
}
// (above the drawing loop, which starts here) The show log reads and resets these once a second:
// output frames, repeats (frames the studio was too late to draw), and the longest wait between two draws.
export const progFrames = { n: 0, dup: 0, last: 0, gap: 0 };
// Whatever takes every output frame in order (Record program): called with how many are due.
export const frameSinks = new Set();
function frameTick() {
  const t = performance.now();
  if (EDIT_ONLY) {
    // the Edit page draws no live program (the studio does): only the edit's playback, which
    // it hands to Program out (Edit) as it goes
    if (mode === 'edit' && stalled()) player.step();
    const n = dueFrames(t);
    if (n) pushProgramFrame(n);
    return;
  }
  switcherTick(t);
  const n = dueFrames(t);
  if (n) {
    drawLiveFrame();
    drawPreviewBox();
    pushProgramFrame(n);
  }
  if (mode === 'edit' && stalled()) player.step();
}
(function rafLoop() {
  lastRaf = performance.now();
  frameTick();
  requestAnimationFrame(rafLoop);
})();
window.vmPump = () => {
  if (!stalled()) return;
  lastPump = performance.now();
  frameTick();
};
try {
  const ticker = new Worker('/js/ticker.js');
  ticker.postMessage({ ms: 5 }); // (fine-grained, so a hidden studio's frames are due on time, not up to a tick late)
  ticker.onmessage = () => {
    const t = performance.now();
    if (stalled() && t - lastPump > 60 && (!EDIT_ONLY || progOutPeers.size)) frameTick(); // (the Edit window only while Program out shows it)
    if (t - lastDirector >= 300 && !EDIT_ONLY) {
      lastDirector = t;
      directorTick();
    }
  };
} catch {
  setInterval(() => directorTick(), 300);
}

// Record the program to this laptop: picture plus the live mix. A file the moment you stop.
// One program picture for everything that takes it: Record program, the live cut, streaming
// and Program out. Its frames are pushed on every draw (requestFrame) rather than sampled by
// the canvas's own timer: that timer can stop when the studio window is hidden or covered
// (Program out full screen over it), which froze a second recording's picture while its
// sound went on. Each user gets a copy (clone) of the one track.
var progCapture = null; // (var: the drawing loop starts before this line runs)
export function programVideoTrack() {
  const t0 = progCapture?.getVideoTracks()[0];
  if (!t0 || t0.readyState !== 'live') {
    progCapture = program.captureStream(0);
    if (!progCapture.getVideoTracks()[0]?.requestFrame) progCapture = program.captureStream(Math.round(output.fps)); // (no push here: sampled)
  }
  return progCapture.getVideoTracks()[0].clone();
}
function pushProgramFrame(n = 1) {
  const t = performance.now();
  if (progFrames.last) progFrames.gap = Math.max(progFrames.gap, t - progFrames.last);
  progFrames.last = t;
  progFrames.n += n;
  progFrames.dup += n - 1;
  progCapture?.getVideoTracks()[0]?.requestFrame?.();
  for (const sink of frameSinks) {
    try {
      sink(n);
    } catch (e) {
      console.warn('a program frame was not taken', e?.message || e);
    }
  }
}

export let progRec = null;
export function setProgRec(v) { return (progRec = v); }
export const recFades = () => $('#recFades')?.checked;
$('#recFades').checked = localStorage.getItem('vm_recfades') === '1';
$('#recFades').onchange = (e) => localStorage.setItem('vm_recfades', e.target.checked ? '1' : '0');
