// Studio, part 12 of 26: break slate, black, clips on air, lower thirds, the slate look, the mics-only picture.
// Loads after room.js: that import comes first, so the parts run in order (see ../studio.js).
import './room.js';
import { toast, esc, now, announce } from '/js/vm.js';
import { drawFramed, drawSlate, drawTitle } from '/js/compose.js';
import { SLATE_LOOKS, SLATE_SOUND, slateLookName } from '/js/slates.js';
import { BRAND } from '/js/brand.js';
import * as idb from '/js/idb.js';
import {
  $, EDIT_ONLY, LIVE_DELAY, STALL_MS, black, cut, ev, eventId, isHost, lastLive, live, liveActive,
  mode, note, orientation, player, setLiveActive,
} from './core.js';
import { addClip, angleOfCid, saveCut, snapshot } from './clips.js';
import { camOrder, cutLive, isMic, loudestMic, micPeers, renderLive, renderSpecials } from './live.js';
import { director, directorBreak, setDirectorBreak, syncTally } from './onair.js';
import { mix, mixFollowCut, mixGates, mixInit, mixState, renderMixer } from './mixer.js';
import { localRecFollow } from './sources.js';
import { mixRows } from './stream.js';
import {
  progRec, pvwClip, recFades, reelOf, setPreviewClip, setPvwClip, stalled, sw, swActive, takeClip,
  tapMode,
} from './switcher.js';
import { ap, apIdle, toggleProgramRecording } from './autopilot.js';
import { openMenu } from './menus.js';
import { camSending } from './picsync.js';

// ---- break slate --------------------------------------------------------------------

export let breakManual = false;
export function setBreakManual(v) { return (breakManual = v); }
let autoBreak = false;
export let everLive = false;
export function setEverLive(v) { return (everLive = v); }
export const onBreak = () => breakManual || autoBreak || directorBreak;

export function activeFrameOk() {
  const l = live.get(liveActive);
  if (l?.role === 'mic') return !!l.stream?.getAudioTracks().some((t) => t.readyState === 'live');
  const v = l?.video;
  const track = l?.stream?.getVideoTracks()[0];
  // a camera here: is it sending? (its own frames, which go on while the studio is hidden; the
  // page's video element stops showing new ones then, which looked like a dropped camera)
  const sending = camSending(liveActive, STALL_MS);
  if (sending != null) return sending && !!track && track.readyState !== 'ended';
  if (!v || v.readyState < 2 || !v.videoWidth) return false;
  if (!track || track.readyState === 'ended' || track.muted) return false;
  const t = v.currentTime;
  if (t !== l.lastTime) {
    l.lastTime = t;
    l.lastMove = performance.now();
  }
  return performance.now() - (l.lastMove || performance.now()) < STALL_MS;
}

export function updateAutoBreak() {
  if (liveActive) everLive = true;
  if (mediaOn) {
    // a clip is on air: a camera hiccup underneath doesn't matter
    if (autoBreak) {
      autoBreak = false;
      syncBreakUi();
    }
    return;
  }
  // A podcast is microphones: with no camera to show, an open microphone is what's on air
  // (its sound and its picture), so there's no "dropped" to cover with the break slate.
  const camUp = camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; });
  const soundOnly = !camUp && micPeers().some((p) => mixState(live.get(p).cid || p, 'mic').mode !== 'off');
  if (!camUp && soundOnly && (!liveActive || !activeFrameOk())) {
    const mic = loudestMic();
    if (mic && mic !== liveActive && !breakManual) cutLive(mic, 'sound only');
  }
  const ok = (liveActive && activeFrameOk()) || soundOnly;
  const wasAuto = autoBreak;
  if (!$('#autoSlate').checked) autoBreak = false;
  else if (!ok && everLive) autoBreak = true;
  else if (ok) autoBreak = false;
  if (!liveActive && lastLive && live.has(lastLive) && !breakManual) {
    if (live.get(lastLive).role === 'mic' || live.get(lastLive).video?.readyState >= 2) {
      setLiveActive(lastLive);
      renderLive();
    }
  }
  if (wasAuto !== autoBreak) {
    syncBreakUi();
    mixFollowCut();
    note(autoBreak ? 'Camera dropped — break slate on air' : 'Back on camera');
    announce(autoBreak ? 'Camera dropped. Break slate is on air.' : 'Back on camera');
  }
}

export function syncBreakUi() {
  $('#slateTag').hidden = !onBreak();
  $('#slateTag').textContent = breakManual ? 'BREAK' : 'AUTO BREAK';
  syncTally();
  renderLive();
}

export function toggleBreak() {
  setBreak(!breakManual);
}
export function setBreak(on) {
  if (!isHost || on === breakManual) return;
  breakManual = on;
  if (!breakManual && !liveActive && lastLive && live.has(lastLive)) setLiveActive(lastLive);
  syncBreakUi();
  mixFollowCut();
  if (breakManual) blackHint();
  note(breakManual ? 'Break called' : 'Break over');
  announce(breakManual ? 'Break slate on air' : 'Break over');
}

// ---- black: cut or fade the whole program to black, picture and sound ---------------------
// Like a vision mixer's FTB: a layer over everything (the program recording and Program out
// go black too). Once it's fully black the lower third, any clip and the break come off, so
// coming back up lands on the camera you were on.
$('#ftbTime').value = localStorage.getItem('vm_ftb_ms') || '1000';
$('#ftbTime').onchange = (e) => localStorage.setItem('vm_ftb_ms', e.target.value);
const ftbMs = () => +$('#ftbTime').value || 1000;
export function blackLevel() {
  // the T-bar fading to black, or up from it
  if (swActive() && sw.toSpecial === 'black') return sw.p;
  if (swActive() && sw.fromSpecial === 'black') return 1 - sw.p;
  if (!black.dur) return black.target;
  const k = Math.min(1, Math.max(0, (performance.now() - black.start) / black.dur));
  return black.from + (black.target - black.from) * k;
}
/** `took`: the T-bar (or AUTO) already faded it over this many ms; it only needs to land. */
export function toggleBlack(fade, took = 0) {
  if (!isHost || mode !== 'live') return;
  const on = black.target !== 1;
  const dur = took ? 0 : fade ? ftbMs() : 0;
  Object.assign(black, { from: took ? (on ? 1 : 0) : blackLevel(), target: on ? 1 : 0, start: performance.now(), dur, cleared: !on });
  mixInit();
  const gn = mix.ftb.gain, t0 = player.ctx.currentTime;
  gn.cancelScheduledValues(t0);
  gn.setValueAtTime(1 - black.from, t0);
  if (dur) gn.linearRampToValueAtTime(on ? 0 : 1, t0 + dur / 1000);
  else gn.setValueAtTime(on ? 0 : 1, t0);
  const fadeMs = took || dur;
  player.ctx.resume();
  if (!on && !liveActive && lastLive && live.has(lastLive) && !breakManual) setLiveActive(lastLive);
  // the live cut keeps the fade: to black (the shot before fades out in Edit), and back (the next fades in)
  if (cut?.edl) {
    const t = now() - LIVE_DELAY, l = live.get(liveActive);
    if (on) cut.edl.push({ t: t + dur, black: true, fade: fadeMs }); // (black from when the fade ends: the shot fades out to it)
    else if (l?.cid && l.role !== 'mic' && !mediaOn) cut.edl.push({ t: t - took, cid: l.cid, fadeIn: fadeMs });
    saveCut();
  }
  // coming up from black starts the recording (with "Record the program with the fades", or on autopilot)
  if (!on && (recFades() || ap?.on) && !progRec) {
    toggleProgramRecording();
    note('Recording the program (it came up from black)');
  }
  syncBlackUi();
  syncTally();
  renderLive();
  if (took) fade = true;
  note(on ? (fade ? 'Fade to black' : 'Cut to black') : fade ? 'Fade up from black' : 'Cut up from black');
  announce(on ? (fade ? 'Fading to black' : 'Black') : 'Back from black');
}
function syncBlackUi() {
  const on = black.target === 1;
  $('#ftbBtn').setAttribute('aria-pressed', String(on));
  if ($('#ftbBtn').firstChild) $('#ftbBtn').firstChild.textContent = on ? 'Fade up ' : 'Fade to black ';
  renderSpecials();
}
/** Fully black: take everything else off air. */
function atBlack() {
  black.cleared = true;
  localRecFollow(); // (at black nothing's on air: this computer's cameras stop recording, 5 s on)
  // ...and a fade to black ends the recording (with "Record the program with the fades", or on autopilot)
  if ((recFades() || ap?.on) && progRec) {
    if (ap) ap.handsFree = ap.on;
    toggleProgramRecording();
    note('Recording stopped (the program faded to black)');
  }
  if (ap?.state === 'ending') apIdle();
  else if (ap?.state === 'stopping') {
    ap.state = 'ended';
    note('The show was ended by hand');
  }
  const off = [];
  if (lt.on) {
    lt.on = false;
    lt.off = 0;
    ltUi(false);
    off.push('lower third');
  }
  if (mediaOn) {
    stopMedia(false);
    off.push('clip');
  }
  if (breakManual) {
    breakManual = false;
    if (!liveActive && lastLive && live.has(lastLive)) setLiveActive(lastLive);
    syncBreakUi();
    off.push('break');
  }
  note(`Program is black${off.length ? ` (took the ${off.join(', ')} off air)` : ''}`);
}
/** Black over the program, by how far it's faded; the program's label for it (or null), which the caller writes. */
export function drawBlack(g, W, H) {
  const a = blackLevel();
  if (a > 0) {
    g.save();
    g.globalAlpha = Math.min(1, a);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.restore();
  }
  if (black.target === 1 && a >= 1 && !black.cleared) atBlack();
  const showing = a > 0.001 || black.target === 1;
  $('#progLabel').classList.toggle('black', showing);
  $('#progFrame').classList.toggle('black', a >= 1);
  const down = swActive() && (sw.toSpecial === 'black' || sw.fromSpecial === 'black') ? sw.toSpecial === 'black' : black.target === 1; // (the T-bar's way, while it's moving)
  return showing ? (a >= 1 ? 'BLACK' : down ? 'FADING TO BLACK' : 'FADING UP') : null;
}
let blackHintAt = 0;
export function blackHint() {
  if (black.target !== 1 || performance.now() - blackHintAt < 4000) return;
  blackHintAt = performance.now();
  toast('The program is black. Press X to fade up (Shift+X to cut up).', 4000);
}
$('#ftbBtn').onclick = () => toggleBlack(true);

// Media reel: sponsor spots for breaks, and images for the edit.
export const reel = [];
export function addReel(r, persist = true) {
  const item = { ...r, url: URL.createObjectURL(r.blob) };
  if (r.type.startsWith('video/')) {
    item.el = document.createElement('video');
    item.el.muted = true;
    item.el.loop = true;
    item.el.playsInline = true;
    item.el.src = item.url;
  } else {
    item.el = new Image();
    item.el.src = item.url;
  }
  reel.push(item);
  if (persist) idb.put('reel', { eventId, id: r.id, name: r.name, link: r.link || '', type: r.type, blob: r.blob, loop: !!r.loop });
  renderReel();
  renderClips();
  if (typeof mixRows !== 'undefined') renderMixer();
  return item;
}
function renderReel() {
  $('#reel').innerHTML = reel
    .map((r, i) => `<li><${r.type.startsWith('video/') ? 'video muted' : 'img alt=""'} src="${r.url}"></${r.type.startsWith('video/') ? 'video' : 'img'}>
      <input type="text" value="${esc(r.name)}" data-i="${i}" aria-label="Sponsor name for reel item ${i + 1}" placeholder="Sponsor name">
      <button type="button" data-rm="${i}" aria-label="Remove reel item ${i + 1}">Remove</button></li>`)
    .join('');
}
export const fileToReel = (f) => addReel({ id: Math.random().toString(36).slice(2, 12), name: f.name.replace(/\.[^.]+$/, ''), type: f.type, blob: f });
$('#reelFiles').onchange = (e) => {
  for (const f of e.target.files) fileToReel(f);
  e.target.value = '';
};
$('#reel').addEventListener('change', (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  reel[i].name = e.target.value;
  idb.patch('reel', eventId, reel[i].id, { name: e.target.value });
});
$('#reel').addEventListener('click', (e) => {
  const i = e.target.dataset.rm;
  if (i === undefined) return;
  const [r] = reel.splice(+i, 1);
  idb.remove('reel', eventId, r.id);
  renderReel();
});

// ---- clips: b-roll, commercials, logos — always ready in the Sources panel -----------------
// Each clip loops silently in its tile, so you can see it's ready. Click to put it on air
// (from the top, with its sound on the Clips strip). Loop keeps it going until you cut
// away; otherwise it plays once and returns to the camera you were on.
export let mediaOn = null; // {id}
// A clip that airs goes into Edit where it aired: a cut to it in the live cut, and a copy of
// its file placed at that time (one per time round, if it loops). Stills aren't in Edit yet.
let mediaAir = null; // { id, t (when the clip's start aired, on the cameras' clock), cid }
async function finishMediaAir() {
  const a = mediaAir;
  mediaAir = null;
  const r = a && reelOf(a.id);
  if (!r?.type.startsWith('video/') || !r.blob) return;
  const end = now() - LIVE_DELAY;
  if (end - a.t < 300) return;
  const fileDur = r.prog && Number.isFinite(r.prog.duration) && r.prog.duration > 0 ? r.prog.duration * 1000 : end - a.t;
  for (let t = a.t, k = 0; t < end - 100 && k < 60; t += fileDur, k++) {
    const meta = {
      id: `R${a.id}-${Math.round(a.t)}-${k}`, kind: 'video', mime: r.type, cid: a.cid, name: r.name, t0: Math.round(t), dur: Math.round(Math.min(fileDur, end - t)),
      w: r.prog?.videoWidth || 0, h: r.prog?.videoHeight || 0, local: true, reel: true, t0Source: 'studio', native: true, audio: 'stereo',
      orient: [{ t: 0, rot: 0, rect: null, upright: (r.prog?.videoWidth || 16) >= (r.prog?.videoHeight || 9) ? 'landscape' : 'portrait', ev: 0, ct: 0 }],
    };
    const rec = { eventId, ...meta, receivedAt: Date.now() };
    await idb.put('clips', { ...rec, blob: r.blob }).catch(() => {});
    addClip(rec, r.blob, true);
  }
}
function startMediaAir(r, at, dissolveMs) {
  if (mediaAir) finishMediaAir();
  if (!r.type.startsWith('video/')) return;
  const cid = `REEL-${r.id}-${Math.round(now())}`;
  mediaAir = { id: r.id, t: now() - LIVE_DELAY - (r.prog?.currentTime || 0) * 1000, cid };
  snapshot();
  cut.edl.push({ t: (at ?? now()) - LIVE_DELAY, cid, ...(dissolveMs >= 40 ? { dissolve: Math.round(dissolveMs) } : {}) });
  saveCut();
}
export function renderClips() {
  const box = $('#clips');
  if (!box) return;
  $('#clipsEmpty').hidden = reel.length > 0;
  for (const r of reel) {
    let card = box.querySelector(`[data-card="${r.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'clipcard';
      card.dataset.card = r.id;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile media';
      tile.dataset.media = r.id;
      const preview = r.type.startsWith('video/') ? Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, autoplay: true, src: r.url }) : Object.assign(new Image(), { src: r.url, alt: '' });
      tile.append(preview);
      tile.insertAdjacentHTML('beforeend', `<span class="who"></span><span class="kind"></span><i class="prog" aria-hidden="true"></i>`);
      tile.onclick = () => takeClip(r.id);
      card.append(tile);
      card.insertAdjacentHTML('beforeend', `<div class="clipctl">${r.type.startsWith('video/') ? '<button type="button" data-loop aria-pressed="false" title="Loop until you cut away, or play once and go back to the camera">Loop</button>' : ''}<button type="button" data-rmclip aria-label="Remove ${esc(r.name)}">Remove</button></div>`);
      card.querySelector('[data-loop]')?.addEventListener('click', () => {
        r.loop = !r.loop;
        if (r.prog) r.prog.loop = r.loop;
        idb.patch('reel', eventId, r.id, { loop: r.loop });
        renderClips();
      });
      card.querySelector('[data-rmclip]').addEventListener('click', () => {
        if (mediaOn?.id === r.id) stopMedia(true);
        if (pvwClip === r.id) setPreviewClip(null);
        reel.splice(reel.indexOf(r), 1);
        idb.remove('reel', eventId, r.id);
        card.remove();
        renderReel();
        renderClips();
        renderMixer();
      });
      box.append(card);
      preview.play?.().catch(() => {});
    }
    const tile = card.querySelector('.tile');
    tile.querySelector('.who').textContent = r.name;
    tile.querySelector('.kind').textContent = r.type.startsWith('video/') ? (r.loop ? 'LOOP' : 'ONCE') : 'STILL';
    tile.classList.toggle('live', mediaOn?.id === r.id && !onBreak());
    tile.classList.toggle('pvw', pvwClip === r.id);
    tile.setAttribute('aria-label', `${tapMode === 'preview' ? 'Cue' : 'Put'} ${r.name} ${tapMode === 'preview' ? 'in preview' : 'on air'}${mediaOn?.id === r.id ? ' (on air now)' : pvwClip === r.id ? ' (in preview, cued at the start)' : ''}`);
    card.querySelector('[data-loop]')?.setAttribute('aria-pressed', String(!!r.loop));
  }
  for (const card of box.querySelectorAll('[data-card]')) if (!reel.some((r) => r.id === card.dataset.card)) card.remove();
}

/** A clip's on-air player: it plays with sound, through the Clips strip of the mixer. */
export function ensureProg(r) {
  if (r.prog || !r.type.startsWith('video/')) return r.prog;
  r.prog = Object.assign(document.createElement('video'), { playsInline: true, preload: 'auto', src: r.url });
  mixInit();
  player.ctx.createMediaElementSource(r.prog).connect(mix.media.mono);
  r.prog.addEventListener('ended', () => {
    if (mediaOn?.id === r.id && !r.loop) stopMedia(true);
  });
  return r.prog;
}
export function cutMedia(id, opts = {}) {
  if (!isHost) return;
  const r = reel.find((x) => x.id === id);
  if (!r) return;
  breakManual = false;
  setDirectorBreak(false);
  if (pvwClip === id) setPvwClip(null);
  if (r.type.startsWith('video/')) {
    ensureProg(r);
    r.prog.loop = !!r.loop;
    r.prog.volume = 1;
    player.ctx.resume();
    if (!opts.playing) {
      r.prog.currentTime = 0;
      r.prog.play().catch(() => {});
    } else if (r.prog.paused) r.prog.play().catch(() => {});
  }
  if (mediaOn && mediaOn.id !== id) reel.find((x) => x.id === mediaOn.id)?.prog?.pause();
  if (mediaOn?.id !== id) startMediaAir(r, opts.at, opts.dissolveMs);
  mediaOn = { id };
  mixGates();
  syncBreakUi();
  syncTally();
  renderClips();
  renderLive();
  note(`Clip on air: ${r.name}${r.type.startsWith('video/') ? (r.loop ? ' (loop)' : ' (plays once)') : ''}`);
  announce(`${r.name} on air`);
}

/** Take the clip off air; if it ended by itself, go back to the camera we were on. */
export function stopMedia(returnToCamera = false) {
  const r = mediaOn && reel.find((x) => x.id === mediaOn.id);
  r?.prog?.pause();
  mediaOn = null;
  finishMediaAir();
  // back to the camera under it: the live cut says so from here
  if (liveActive && live.get(liveActive)?.cid && live.get(liveActive).role !== 'mic') {
    cut.edl.push({ t: now() - LIVE_DELAY, cid: live.get(liveActive).cid });
    saveCut();
  }
  if (returnToCamera && liveActive && live.has(liveActive)) {
    director.set(liveActive, Date.now());
    note(`Clip finished: back to camera ${angleOfCid(live.get(liveActive).cid)}`);
    announce('Back to camera');
  }
  mixGates();
  syncTally();
  renderClips();
  renderLive();
}

$('#clipFiles').onchange = (e) => {
  for (const f of e.target.files) fileToReel(f);
  e.target.value = '';
};

// ---- a live lower third: type it, show it, it fades in and out --------------------------
export const lt = { on: false, at: 0, off: 0, text: '', sub: '' };
let ltRecent = JSON.parse(localStorage.getItem('vm_lt_' + eventId) || '[]');
let ltEditing = null; // the saved one loaded for editing: showing the edit replaces it
const saveLt = () => localStorage.setItem('vm_lt_' + eventId, JSON.stringify(ltRecent));
const ltShowing = () => lt.on && (!lt.off || performance.now() < lt.off);
function renderLtRecent() {
  const on = ltShowing();
  $('#ltRecent').innerHTML = ltRecent.map((x, i) => {
    const what = `${esc(x.text)}${x.sub ? ' · ' + esc(x.sub) : ''}`;
    const isOn = on && x.text === lt.text && (x.sub || '') === lt.sub;
    return `<span class="ltpill${isOn ? ' on' : ''}"><button type="button" data-lt="${i}" title="Show: ${what} (right-click to edit it without showing it)">${esc(x.text)}</button><button type="button" class="ltx" data-ltdel="${i}" aria-label="Delete the lower third ${what}" title="Delete">×</button></span>`;
  }).join('');
}
export function ltUi(on) {
  $('#ltShow').setAttribute('aria-pressed', String(on));
  if ($('#ltShow').firstChild) $('#ltShow').firstChild.textContent = on ? 'Hide ' : 'Show ';
  renderLtRecent();
}
function showLowerThird(on) {
  if (on) {
    const text = $('#ltText').value.trim(), sub = $('#ltSub').value.trim();
    if (!text) {
      $('#ltText').focus();
      return toast('Type a name or headline first');
    }
    Object.assign(lt, { on: true, at: performance.now(), off: $('#ltAuto').checked ? performance.now() + 8000 : 0, text, sub });
    const same = (x, y) => y && x.text === y.text && (x.sub || '') === (y.sub || '');
    ltRecent = [{ text, sub }, ...ltRecent.filter((x) => !same(x, { text, sub }) && !same(x, ltEditing))].slice(0, 16);
    ltEditing = null;
    saveLt();
    note(`Lower third: ${text}${sub ? ' · ' + sub : ''}`);
    blackHint();
  } else if (lt.on) {
    lt.off = performance.now();
  }
  ltUi(on);
  announce(on ? 'Lower third on' : 'Lower third off');
}
$('#ltShow').onclick = () => showLowerThird(!ltShowing());
function loadLt(i, editing = false) {
  const x = ltRecent[i];
  if (!x) return;
  $('#ltText').value = x.text;
  $('#ltSub').value = x.sub || '';
  ltEditing = editing ? { ...x } : null;
}
function deleteLt(i) {
  const x = ltRecent[i];
  if (!x) return;
  ltRecent.splice(i, 1);
  saveLt();
  renderLtRecent();
  note(`Deleted the lower third ${x.text}`);
  announce(`Deleted ${x.text}`);
  ($('#ltRecent').querySelectorAll('[data-ltdel]')[Math.min(i, ltRecent.length - 1)] || $('#ltText')).focus();
}
$('#ltRecent').addEventListener('click', (e) => {
  const del = e.target.closest('[data-ltdel]');
  if (del) return deleteLt(+del.dataset.ltdel);
  const b = e.target.closest('[data-lt]');
  if (!b) return;
  loadLt(+b.dataset.lt);
  showLowerThird(true);
});
$('#ltRecent').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-lt], [data-ltdel]');
  if (!b) return;
  e.preventDefault();
  const i = +(b.dataset.lt ?? b.dataset.ltdel);
  const x = ltRecent[i];
  if (!x) return;
  openMenu(e.clientX, e.clientY, [
    { label: 'Show it now', action: () => { loadLt(i); showLowerThird(true); } },
    { label: 'Edit it (not on air)', action: () => { loadLt(i, true); $('#ltText').focus(); } },
    { sep: true },
    { label: 'Delete', action: () => deleteLt(i) },
  ], x.text);
});
renderLtRecent();
export function drawLowerThird(g, W, H) {
  if (!lt.on) return;
  const t = performance.now();
  const FADE = 300;
  let a = Math.min(1, (t - lt.at) / FADE);
  if (lt.off) a = Math.min(a, (lt.off - t) / FADE + 1);
  if (lt.off && t >= lt.off + FADE) {
    lt.on = false;
    ltUi(false);
    return;
  }
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, a));
  drawTitle(g, W, H, { style: 'lower', text: lt.text, sub: lt.sub });
  g.restore();
}

function drawReelItem(g, W, H, item) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  drawFramed(g, item.el, W, H, 'fit');
  if (item.name) {
    g.font = `700 ${Math.round(H * 0.028)}px Archivo, system-ui, sans-serif`;
    const label = `Presented by ${item.name}`;
    const tw = g.measureText(label).width;
    g.fillStyle = '#000b';
    g.fillRect(16, H - 16 - H * 0.055, tw + 28, H * 0.055);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 30, H - 16 - H * 0.0275);
  }
}

// ---- the break slate: its look, a preview, and (if you want it) its sound ----------------
$('#slateLook').innerHTML = SLATE_LOOKS.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
export let slateLook = localStorage.getItem('vm_slatelook_' + eventId) || localStorage.getItem('vm_slatelook_default') || 'bars';
// Breaks go in the live cut: the slate (what it said, its look) from when the break began,
// and the camera again when it ended. In Edit each break is its own item.
// (A break goes in once it has lasted 1.5 s, and ends once it has been off 1 s: a flicker,
// a frame or two late on a busy computer, isn't a break, and doesn't flood the live cut.)
let edlBreak = false, brkChange = 0, brkSeen = false;
setInterval(() => {
  if (!isHost || !cut?.edl || EDIT_ONLY) return;
  const on = onBreak() && black.target !== 1;
  if (on !== brkSeen) {
    brkSeen = on;
    brkChange = performance.now();
  }
  if (on === edlBreak || performance.now() - brkChange < (on ? 1500 : 1000)) return;
  edlBreak = on;
  const t = now() - LIVE_DELAY - (on ? 1500 : 1000); // (from when it really began or ended)
  if (on) cut.edl.push({ t, slate: { ...slateText(), look: slateLook } });
  else {
    const l = live.get(liveActive);
    if (mediaOn || !l?.cid || l.role === 'mic') return;
    cut.edl.push({ t, cid: l.cid });
  }
  saveCut();
}, 250);
if (!SLATE_LOOKS.some(([id]) => id === slateLook)) slateLook = 'bars';
$('#slateLook').value = slateLook;
$('#slateLook').onchange = (e) => {
  slateLook = e.target.value;
  localStorage.setItem('vm_slatelook_' + eventId, slateLook);
  localStorage.setItem('vm_slatelook_default', slateLook);
  note(`Break slate look: ${slateLookName(slateLook)}`);
};
$('#slateSound').checked = localStorage.getItem('vm_slatesound') === '1';
$('#slateSound').onchange = (e) => localStorage.setItem('vm_slatesound', e.target.checked ? '1' : '0');
export const slateText = () => ({ message: $('#slateMsg').value || "We'll be right back", title: ev?.title || '', brand: BRAND.name });
let slatePrevAt = 0;
export function drawSlatePreview() {
  if (document.hidden || stalled() || performance.now() - slatePrevAt < 100) return; // (nobody can see it)
  slatePrevAt = performance.now();
  const c = $('#slatePrev');
  if (!c || c.offsetParent === null) return;
  const [w, h] = orientation === 'portrait' ? [180, 320] : [320, 180];
  if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
  drawSlate(c.getContext('2d'), w, h, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
}
// Slate sound: the 1 kHz line-up tone with bars, hiss with static. Into the program mix
// (so it's recorded and fades with black); only while the slate itself is on air.
const slateAudio = { cur: null };
export function slateSound(showing) {
  const want = showing && $('#slateSound').checked ? SLATE_SOUND[slateLook] || null : null;
  if (want === slateAudio.cur) return;
  slateAudio.cur = want;
  if (!want && !slateAudio.out) return;
  if (!slateAudio.out) {
    mixInit();
    const ctx = player.ctx;
    const out = ctx.createGain();
    out.connect(mix.bus);
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const tone = ctx.createGain();
    tone.gain.value = 0;
    osc.connect(tone).connect(out);
    osc.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    src.connect(hp).connect(lp).connect(hiss).connect(out);
    src.start();
    Object.assign(slateAudio, { out, tone, hiss });
    ctx.resume();
  }
  const t = player.ctx.currentTime;
  slateAudio.tone.gain.setTargetAtTime(want === 'tone' ? 0.1 : 0, t, 0.015); // −20 dBFS, the broadcast line-up level
  slateAudio.hiss.gain.setTargetAtTime(want === 'hiss' ? 0.16 : 0, t, 0.015);
}

// ---- only microphones on air: a picture for the sound ------------------------------------
// With no camera picture to show and a microphone open, the program shows the sound itself:
// a rolling waveform, spectrum bars or a ring, with the event and who's talking.
const MIC_LOOKS = [['wave', 'Rolling waveform'], ['bars', 'Spectrum bars'], ['ring', 'Ring']];
$('#micLook').innerHTML = MIC_LOOKS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
let micLook = localStorage.getItem('vm_miclook') || 'wave';
$('#micLook').value = micLook;
$('#micLook').onchange = (e) => {
  micLook = e.target.value;
  localStorage.setItem('vm_miclook', micLook);
};
const micEnv = new Float32Array(180), micT = new Float32Array(4096), micF = new Float32Array(8192), micCaps = new Float32Array(64);
export function micOnlyUp() {
  if (!mix.bus || !mix.meterL || !mix.spec) return false;
  if (camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; })) return false;
  for (const [peer, st] of mix.strips) if (live.get(peer)?.role === 'mic' && st.open) return true;
  return false;
}
export const micNames = () => [...live.values()].filter((l) => l.role === 'mic').map((l) => l.name).join(' · ');
/** The sound as a picture: the program's (on air), or `o` one microphone's (an, spec, state, name). */
const programMic = { env: micEnv, at: 0, caps: micCaps };
export function drawMicVisual(g, W, H, o = {}) {
  const u = Math.min(W, H), t = performance.now();
  const an = o.an || mix.meterL, sp = o.spec || mix.spec, st = o.state || programMic, env = st.env;
  const bg = g.createRadialGradient(W / 2, H * 0.45, u * 0.1, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  bg.addColorStop(0, '#15203f');
  bg.addColorStop(1, '#04060c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (!an || !sp) return; // (no sound yet)
  const td = micT.subarray(0, an.fftSize);
  an.getFloatTimeDomainData(td);
  let ss = 0;
  for (let i = 0; i < td.length; i++) ss += td[i] * td[i];
  const lvl = Math.min(1, Math.sqrt(Math.sqrt(ss / td.length)) * 1.6);
  if (t - st.at > 50) {
    st.at = t;
    env.copyWithin(0, 1);
    env[env.length - 1] = lvl;
  }
  const grad = g.createLinearGradient(0, H * 0.22, 0, H * 0.78);
  grad.addColorStop(0, '#ff6b9a');
  grad.addColorStop(0.5, '#7b8cff');
  grad.addColorStop(1, '#3ad1c5');
  if (micLook === 'wave') {
    const n = env.length, x0 = W * 0.08, bw = (W * 0.84) / n, cy = H * 0.5, hmax = H * 0.27;
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, env[i] * hmax);
      g.globalAlpha = 0.3 + 0.7 * (i / n);
      g.fillRect(x0 + i * bw + bw * 0.15, cy - h, bw * 0.7, h * 2);
    }
    g.globalAlpha = 1;
  } else {
    const fd = micF.subarray(0, sp.frequencyBinCount), ny = sp.context.sampleRate / 2, caps = st.caps;
    sp.getFloatFrequencyData(fd);
    const nb = micLook === 'ring' ? 64 : 48;
    const band = (i) => {
      const f0 = 60 * Math.pow(8000 / 60, i / nb), f1 = 60 * Math.pow(8000 / 60, (i + 1) / nb);
      let v = -140;
      for (let k = Math.floor((f0 / ny) * fd.length); k <= Math.ceil((f1 / ny) * fd.length) && k < fd.length; k++) v = Math.max(v, fd[k]);
      return Math.max(0, Math.min(1, (v + 95) / 70));
    };
    if (micLook === 'bars') {
      const x0 = W * 0.1, bw = (W * 0.8) / nb, base = H * 0.72, hmax = H * 0.46;
      for (let i = 0; i < nb; i++) {
        const v = band(i);
        caps[i] = Math.max(v, caps[i] - 0.012);
        g.fillStyle = grad;
        g.fillRect(x0 + i * bw + bw * 0.12, base - v * hmax, bw * 0.76, v * hmax);
        g.fillStyle = '#ffffffcc';
        g.fillRect(x0 + i * bw + bw * 0.12, base - caps[i] * hmax - 3, bw * 0.76, 3);
      }
    } else {
      const cx = W / 2, cy = H * 0.49, r0 = u * 0.16, rl = u * 0.16;
      g.strokeStyle = grad;
      g.lineCap = 'round';
      g.lineWidth = Math.max(2, ((2 * Math.PI * r0) / (nb * 2)) * 0.55);
      for (let i = 0; i < nb * 2; i++) {
        const v = band(i < nb ? i : 2 * nb - 1 - i), a = (i / (nb * 2)) * Math.PI * 2 - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r0 + 4 + v * rl), cy + Math.sin(a) * (r0 + 4 + v * rl));
        g.stroke();
      }
      g.beginPath();
      g.arc(cx, cy, r0 * (0.84 + lvl * 0.12), 0, Math.PI * 2);
      g.fillStyle = '#ffffff12';
      g.fill();
    }
  }
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(u * 0.06)}px Archivo, system-ui, sans-serif`;
  g.fillText(ev?.title || '', W / 2, H * 0.12, W * 0.9);
  g.fillStyle = '#b9c2e6';
  g.font = `600 ${Math.round(u * 0.04)}px Archivo, system-ui, sans-serif`;
  g.fillText(`🎙 ${o.name ?? (liveActive && isMic(liveActive) ? live.get(liveActive).name : micNames())}`, W / 2, H * 0.87, W * 0.9);
  g.fillStyle = Math.floor(t / 600) % 2 ? '#e0362b77' : '#e0362b';
  g.beginPath();
  g.arc(W / 2 - u * 0.085, H * 0.2, u * 0.012, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
  g.fillStyle = '#e8ebf5';
  g.font = `800 ${Math.round(u * 0.03)}px Archivo, system-ui, sans-serif`;
  g.fillText('LIVE AUDIO', W / 2 - u * 0.06, H * 0.2);
  g.textAlign = 'right';
  g.fillStyle = '#ffffffb0';
  g.font = `600 ${Math.round(Math.max(11, u * 0.024))}px Archivo, system-ui, sans-serif`;
  g.fillText(`Made with ${BRAND.name}`, W - 16, H - 18);
}

export let slateClock = 0;
export function setSlateClock(v) { return (slateClock = v); }
let playingReel = null;
/** Draws the break: the slate, alternating with the sponsor reel. True while the slate itself is up. */
export function drawBreak(g, W, H) {
  const cycle = 6000 + reel.length * 8000;
  const pos = (performance.now() - slateClock) % cycle;
  if (pos < 6000 || !reel.length) {
    if (playingReel) { playingReel.el.pause?.(); playingReel = null; }
    drawSlate(g, W, H, { ...slateText(), look: slateLook, t: performance.now() - slateClock, now: now() });
    return true;
  }
  const item = reel[Math.floor((pos - 6000) / 8000)];
  if (playingReel !== item) {
    playingReel?.el.pause?.();
    playingReel = item;
    if (item.el.play) { item.el.currentTime = 0; item.el.play().catch(() => {}); }
  }
  drawReelItem(g, W, H, item);
  return false;
}
