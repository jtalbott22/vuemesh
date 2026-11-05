// Studio, part 6 of 25: the live mixer, its strips and meter bridge, the pop-out audio console.
// Loads after onair.js: that import comes first, so the parts run in order (see ../studio.js).
import './onair.js';
import { toast, esc, announce } from '/js/vm.js';
import { limiter } from '/js/compose.js';
import { eqChain, balance, channelFixer } from '/js/audiofx.js';
import { $, EDIT_ONLY, ev, eventId, gainToDb, live, liveActive, mode, note, player, seq } from './core.js';
import { angleCids, angleOfCid } from './clips.js';
import { camOrder, micPeers } from './live.js';
import { bindConsole, consoleSync } from './ccu.js';
import { consoleFrame } from './console-draw.js';
import { fitDock, mixRows, setMixRows } from './stream.js';
import { renderBusAudio } from './room.js';
import { blackLevel, mediaOn, onBreak, reel } from './graphics.js';
import { sw, swActive } from './switcher.js';
import { bgInterval } from '/js/bgclock.js';
import { syncedSoundDelay } from './picsync.js';
import { localMics, setLocalSound } from './sources.js';

// ---- live mixer ------------------------------------------------------------------------
// One strip per phone, like a broadcast mixer. Each has a level and a mode:
//   AFV  audio follows video: heard only while that camera is on air
//   ON   always in the mix (a microphone phone, or a camera near the speeches)
//   OFF  never in the mix
// So pictures and sound switch independently. Everything feeds the program bus
// (recorded with the program), through a limiter, with stereo meters.
// A channel is mono or stereo (its Mono switch): phones are mono to start with; this
// computer's sound, a shared screen, a stereo input and the Clips keep both sides. Balance
// pans a mono channel and balances a stereo one.

export const mix = { strips: new Map(), bus: null, dest: null, out: null, listen: null, meterL: null, meterR: null };
const mixSaved = () => JSON.parse(localStorage.getItem('vm_livemix_' + eventId) || '{}');
export const MODES = ['afv', 'on', 'off'];
export const MODE_LABEL = { afv: 'AFV', on: 'ON', off: 'OFF' };
/** Whether a channel's source has two sides of its own (see mixAttach). */
function srcStereo(id) {
  if (id === 'media') return true;
  const l = live.get(id) || [...live.values()].find((x) => x.cid === id);
  return !!l?.stereo;
}
function mixDefault(role, id) {
  if (role === 'media') return { gain: 1, mode: 'afv', mono: false };
  const micHere = [...live.values()].some((l) => l.role === 'mic');
  return { gain: 1, mode: role === 'mic' ? 'on' : micHere ? 'off' : 'afv', mono: !srcStereo(id) };
}
export function mixState(id, role = 'cam') {
  return { ...mixDefault(role, id), ...(mixSaved()[id] || {}) };
}
export function mixSave(id, st) {
  const all = mixSaved();
  all[id] = { ...st, touched: true };
  localStorage.setItem('vm_livemix_' + eventId, JSON.stringify(all));
}

export function stereoMeters(ctx, node) {
  // spread mono across both sides first (phones record mono), as speakers do
  const up = ctx.createGain();
  up.channelCount = 2;
  up.channelCountMode = 'explicit';
  up.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2);
  const L = ctx.createAnalyser(), R = ctx.createAnalyser();
  L.fftSize = R.fftSize = 1024;
  node.connect(up);
  up.connect(split);
  split.connect(L, 0);
  split.connect(R, 1);
  return [L, R];
}

export function mixInit() {
  if (mix.bus) return;
  const ctx = player.ctx;
  mix.bus = ctx.createGain();
  mix.dest = ctx.createMediaStreamDestination();
  mix.listen = ctx.createGain();
  mix.listen.gain.value = 0;
  const lim = limiter(ctx);
  mix.ftb = ctx.createGain(); // fade to black, for the sound
  mix.ftb.gain.value = 1 - blackLevel();
  mix.bus.connect(mix.ftb);
  mix.ftb.connect(lim);
  lim.connect(mix.dest);
  mix.out = lim; // (the program's sound, for Record program's tap on the sound thread)
  lim.connect(mix.listen).connect(ctx.destination);
  [mix.meterL, mix.meterR] = stereoMeters(ctx, lim);
  mix.spec = ctx.createAnalyser(); // for the audio console's spectrum
  mix.spec.fftSize = 4096;
  mix.spec.smoothingTimeConstant = 0.75;
  lim.connect(mix.spec);
  // one strip for clips played from the Clips panel
  mix.media = { ...liveChain(ctx, false), open: false };
  applyStripFx(mix.media, mixState('media', 'media'));
}

/** A live channel: input (one side or two: the Mono switch) → EQ → fader → meter; fader → balance → L/R meters, gate (AFV / ON / OFF) → program bus. */
function liveChain(ctx, mono = true) {
  const input = ctx.createGain();
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const eq = eqChain(ctx), fader = ctx.createGain(), meter = ctx.createAnalyser(), bal = balance(ctx), gate = ctx.createGain();
  const delay = ctx.createDelay(1); // (lip sync: this computer's own sound waits for its cameras' pictures)
  meter.fftSize = 1024;
  gate.gain.value = 0;
  input.connect(delay);
  delay.connect(eq.input);
  eq.output.connect(fader);
  fader.connect(meter);
  fader.connect(bal.input);
  bal.output.connect(gate);
  gate.connect(mix.bus);
  const nodes = {
    mono: input, delay, eq, fader, meter, bal, gate, meters: stereoMeters(ctx, bal.output),
    /** Both sides as one (folded to the middle, then placed by the balance), or each side its own. */
    setMono(on) {
      input.channelCount = on ? 1 : 2;
    },
  };
  nodes.setMono(mono);
  return nodes;
}
export function applyStripFx(nodes, st, smooth = false) {
  if (!nodes) return;
  if (smooth) nodes.fader.gain.setTargetAtTime(st.gain ?? 1, player.ctx.currentTime, 0.02);
  else nodes.fader.gain.value = st.gain ?? 1;
  nodes.eq.set(st.eq, smooth);
  nodes.bal.set(st.pan || 0, smooth);
  nodes.setMono(st.mono !== false);
}
export const stripNodes = (r) => (r.id === 'media' ? mix.media : mix.strips.get(r.peer));
/** A live channel's Mono switch. */
export function toggleStripMono(r) {
  const st = { ...mixState(r.id, r.role), mono: !r.st.mono };
  mixSave(r.id, st);
  applyStripFx(stripNodes(r), st);
  renderMixer();
  announce(`${r.name}: ${st.mono ? 'mono' : 'stereo'}`);
}

export function mixAttach(peer) {
  mixInit();
  const l = live.get(peer);
  // The mixer listens to the phone's sound track itself (not the stream it came in), so a
  // sound track that arrives after the picture, or is replaced, is always the one heard.
  const at = l?.stream?.getAudioTracks().find((t) => t.readyState === 'live');
  if (!at) {
    const st0 = mix.strips.get(peer);
    if (st0?.src) {
      try { st0.src.disconnect(); } catch {}
      st0.src = null;
      st0.trackId = null;
    }
    return;
  }
  const ctx = player.ctx;
  let st = mix.strips.get(peer);
  if (!st) {
    st = { peer, ...liveChain(ctx), fix: channelFixer(ctx), src: null, pre: ctx.createAnalyser() };
    st.pre.fftSize = 512;
    st.fix.output.connect(st.mono); // a phone that only fills the left side still counts at full level
    mix.strips.set(peer, st);
  }
  if (st.trackId !== at.id || !st.src) {
    try { st.src?.disconnect(); } catch {}
    // Two sides of its own: this computer's sound or a shared screen, or an input of this
    // computer that opened in stereo. A phone's sound starts mono (Mono off makes it stereo).
    l.stereo = !!l.local && (!!l.screen || (at.getSettings?.().channelCount || 1) > 1);
    const only = new MediaStream([at]);
    st.src = ctx.createMediaStreamSource(only);
    st.src.connect(st.fix.input);
    st.src.connect(st.pre);
    st.fix.reset(!!l.screen); // a stereo input of this computer may still be one mic on the left: the fix finds out
    st.trackId = at.id;
    st.stream = l.stream;
    st.silentSince = 0;
    // Chrome only hands a phone's sound to the mixer while a media element is playing that
    // stream. Cameras had their video tile; a microphone had nothing, so on its own it was
    // silent until a camera joined. Every stream gets a muted player of its own.
    st.sink ||= Object.assign(new Audio(), { muted: true, autoplay: true });
    st.sink.srcObject = only;
    st.sink.play().catch(() => {});
  }
  const id = l.cid || peer;
  applyStripFx(st, mixState(id, l.role));
  // A microphone phone just arrived: cameras nobody has set yet go quiet.
  if (l.role === 'mic') {
    let quieted = 0;
    for (const [p2, l2] of live) {
      if (l2.role === 'mic' || !l2.cid || mixSaved()[l2.cid]?.touched) continue;
      if (mixState(l2.cid, 'cam').mode !== 'off') quieted++;
    }
    if (quieted) toast('A microphone joined: camera sound is off. Turn any camera to AFV or ON in the mixer.', 5000);
  }
  mixGates();
}

export function mixDetach(peer) {
  const st = mix.strips.get(peer);
  if (st) {
    try { st.src?.disconnect(); st.gate.disconnect(); } catch {}
    st.fix?.dispose();
    if (st.sink) st.sink.srcObject = null;
    mix.strips.delete(peer);
  }
}

/** Open or close each strip's gate from its mode and what's on air. */
export function mixGates() {
  if (!mix.bus) return;
  const now = player.ctx.currentTime;
  for (const [peer, st] of mix.strips) {
    const l = live.get(peer);
    if (!l) continue;
    const { mode, follow } = mixState(l.cid || peer, l.role);
    // AFV follows the picture (its own, or a camera it's set to follow), through a dissolve
    // too: out goes down as in comes up
    const tr = swActive();
    const target = (follow && peerOfCid(follow)) || peer;
    // (through a dissolve out of the break, the incoming camera's sound comes up with its picture)
    const brk = onBreak() && !(tr && sw.fromSpecial === 'break');
    let afv = 0;
    if (mode === 'afv' && !brk) {
      if (tr && target === sw.to) afv = sw.p;
      else if (target === liveActive && !mediaOn && !(tr && sw.fromSpecial === 'break')) afv = tr ? 1 - sw.p : 1;
    }
    const level = mode === 'on' ? 1 : afv;
    const open = level > 0.001;
    st.open = open;
    st.gate.gain.setTargetAtTime(level, now, 0.015);
  }
  if (mix.media) {
    const { mode } = mixState('media', 'media');
    mix.media.open = mode === 'on' || (mode === 'afv' && (!!mediaOn || !!sw.toClip) && !onBreak());
    mix.media.gate.gain.setTargetAtTime(mix.media.open ? 1 : 0, now, 0.015);
  }
  renderBusAudio();
}
export const mixFollowCut = mixGates;

const peerOfCid = (cid) => [...live].find(([, x]) => x.cid === cid)?.[0] || null;
/** AFV for a channel follows this camera's picture (its cid), or its own (null). Kept with the channel. */
export function setStripFollow(id, role, follow) {
  mixSave(id, { ...mixState(id, role), follow: follow || null });
  mixGates();
  renderMixer();
  const name = follow ? live.get(peerOfCid(follow))?.name || 'a camera' : null;
  const own = [...live.values()].find((x) => (x.cid || '') === id)?.name || id;
  note(`${own}'s sound follows ${name ? `${name}'s picture` : 'its own picture'}`);
}
export function setStripMode(id, role, mode) {
  const st = { ...mixState(id, role), mode };
  mixSave(id, st);
  mixGates();
  renderMixer();
}

/** Shift + number: step that camera's sound through AFV → ON → OFF (a "breakaway"). */
export function cycleCameraAudio(n) {
  const cid = angleCids[n - 1];
  const peer = [...live.keys()].find((p) => live.get(p).cid === cid);
  if (!peer) return toast(`Camera ${n} isn't connected`);
  const l = live.get(peer);
  const cur = mixState(cid, l.role).mode;
  const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
  setStripMode(cid, l.role, next);
  announce(`Camera ${n} sound ${MODE_LABEL[next]}`);
  note(`Camera ${n} (${l.name}) sound: ${MODE_LABEL[next]}`);
}

$('#listen').onchange = (e) => {
  mixInit();
  mix.listen.gain.setTargetAtTime(e.target.checked ? 1 : 0, player.ctx.currentTime, 0.02);
  player.ctx.resume();
};

// ---- lip sync: this computer's own sound waits as long as its pictures --------------------
// Every camera here is held to one picture delay (picsync.js), so the sound from this computer
// waits that long too (less the time its own sound takes to get here, and how far it is behind
// the main microphone by their sound). Or by hand, or straight in, per computer. Phones are left
// as they are (their sound and picture come together over their link).
const LIP_KEY = 'vm_lipsync';
export const lipSync = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(LIP_KEY) || '{}');
    return { mode: ['auto', 'manual', 'off'].includes(v.mode) ? v.mode : 'auto', ms: Math.max(0, Math.min(800, Number(v.ms) || 0)) };
  } catch {
    return { mode: 'auto', ms: 0 };
  }
})();
/** How long this computer's sound from `peer` waits (ms). */
export function soundDelayFor(peer) {
  const l = live.get(peer);
  if (!l?.local || l.screen || lipSync.mode === 'off') return 0;
  if (lipSync.mode === 'manual') return lipSync.ms;
  return syncedSoundDelay(peer) ?? 0;
}
function applyLipSync() {
  if (!player.ctx) return;
  for (const [peer, st] of mix.strips) {
    if (!st.delay) continue;
    const ms = soundDelayFor(peer);
    if (Math.abs((st.delayMs || 0) - ms) < 15 && !(ms === 0 && st.delayMs)) continue; // (small changes aren't worth a wobble)
    st.delayMs = ms;
    st.delay.delayTime.setTargetAtTime(ms / 1000, player.ctx.currentTime, 0.3);
  }
  renderLipSync();
}
function renderLipSync() {
  const mode = $('#lipMode'), ms = $('#lipMs'), hint = $('#lipHint');
  if (!mode) return;
  mode.value = lipSync.mode;
  ms.hidden = lipSync.mode !== 'manual';
  if (document.activeElement !== ms) ms.value = String(lipSync.ms);
  const used = [...mix.strips].filter(([, st]) => st.delayMs).map(([p, st]) => `${live.get(p)?.name || 'a source'} ${st.delayMs} ms`);
  hint.textContent = lipSync.mode === 'off' ? 'Their sound goes straight in, ahead of the pictures.' : used.length ? `Sound waits: ${used.join(', ')}.` : '';
}
$('#lipMode')?.addEventListener('change', (e) => {
  lipSync.mode = e.target.value;
  localStorage.setItem(LIP_KEY, JSON.stringify(lipSync));
  note(`Lip sync for this computer's sound: ${lipSync.mode === 'manual' ? `${lipSync.ms} ms` : lipSync.mode}`);
  applyLipSync();
});
$('#lipMs')?.addEventListener('change', (e) => {
  lipSync.ms = Math.max(0, Math.min(800, Math.round(Number(e.target.value) || 0)));
  localStorage.setItem(LIP_KEY, JSON.stringify(lipSync));
  note(`Lip sync for this computer's sound: ${lipSync.ms} ms`);
  applyLipSync();
});
if (!EDIT_ONLY) bgInterval(applyLipSync, 1000);

// ---- mixer UI: horizontal strips in the inspector, vertical meter bridge in full screen ----

function mixerRows() {
  const rows = [];
  if (mode === 'live') {
    mixInit();
    const order = [...micPeers(), ...camOrder()];
    for (const peer of order) {
      const l = live.get(peer);
      const st = mix.strips.get(peer);
      if (!st) continue;
      const id = l.cid || peer;
      const n = l.role === 'mic' ? null : angleOfCid(l.cid);
      rows.push({ id, peer, role: l.role, name: l.role === 'mic' ? `Mic · ${l.name}` : `${n} ${l.name}`, meter: () => st.meter, meters: () => st.meters, st: mixState(id, l.role), live: true, open: () => st.open });
    }
    if (reel.some((r) => r.type.startsWith('video/'))) rows.push({ id: 'media', role: 'media', name: 'Clips', meter: () => mix.media.meter, meters: () => mix.media.meters, st: mixState('media', 'media'), live: true, open: () => mix.media?.open });
    rows.push({ id: 'master', name: 'Program', meters: () => [mix.meterL, mix.meterR], master: true });
  } else {
    for (const tr of seq.tracks.filter((t) => t.kind === 'audio')) {
      rows.push({ id: tr.id, name: tr.name, meter: () => player.buses.get(tr.id)?.meter, st: { gain: tr.gain ?? 1, muted: !!tr.muted, mono: tr.mono !== false, eq: tr.eq, pan: tr.pan || 0 }, track: tr });
    }
    if (!player.meterLR) player.meterLR = stereoMeters(player.ctx, player.limit);
    rows.push({ id: 'master', name: 'Master', meters: () => player.meterLR, master: true });
  }
  return rows;
}

let mixSig = '';
// A channel's routing: where a camera here takes its sound from, and (AFV) whose picture it follows.
function routeLine(r, compact = false) {
  const l = live.get(r.peer);
  if (!l) return '';
  const parts = [];
  const lab = (text, sel) => (compact ? sel : `<label>${text} ${sel}</label>`);
  if (l.local && l.role !== 'mic' && !l.screen) {
    const mics = localMics.length ? localMics : l.micId ? [{ id: l.micId, label: l.micLabel || 'Its microphone' }] : [];
    const pre = compact ? 'Sound: ' : '';
    parts.push(lab('Sound from', `<select data-sndfrom="${esc(r.peer)}" aria-label="${esc(r.name)}: sound from" title="Where this camera's sound comes from">${mics.map((m) => `<option value="${esc(m.id)}"${m.id === l.micId ? ' selected' : ''}>${esc(pre + m.label)}</option>`).join('')}<option value=""${!l.micId ? ' selected' : ''}>${pre}none</option></select>`));
  }
  if (r.st.mode === 'afv') {
    const cams = camOrder().filter((p) => p !== r.peer).map((p) => live.get(p));
    const pre = compact ? 'With: ' : '';
    if (cams.length) parts.push(lab('Follows', `<select data-follow="${esc(r.id)}" data-role="${esc(r.role)}" aria-label="${esc(r.name)}: AFV follows" title="AFV: heard while this is on air">${`<option value="">${pre}${l.role === 'mic' ? 'itself' : 'its own picture'}</option>`}${cams.map((x) => `<option value="${esc(x.cid)}"${x.cid === r.st.follow ? ' selected' : ''}>${esc(`${pre}${angleOfCid(x.cid)} ${x.name}`)}</option>`).join('')}</select>`));
  }
  return parts.length ? (compact ? `<div class="vroute">${parts.join('')}</div>` : `<span class="route">${parts.join('')}</span>`) : '';
}
const onRoute = (e) => {
  const sf = e.target.closest('[data-sndfrom]');
  if (sf) return void setLocalSound(sf.dataset.sndfrom, sf.value || null);
  const fo = e.target.closest('[data-follow]');
  if (fo) setStripFollow(fo.dataset.follow, fo.dataset.role, fo.value || null);
};
$('#mixer')?.addEventListener('change', onRoute);
$('#bridge')?.addEventListener('change', onRoute);
export const fmtPan = (p) => (Math.abs(p) < 0.005 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));
/** A live channel in stereo shows both sides (its meters are after the balance). */
export const twoSides = (r) => r.master || (r.live && !r.st.mono);
export function renderMixer() {
  setMixRows(mixerRows());
  const sig = mode + '|' + localMics.map((m) => m.id).join(',') + '|' + mixRows.map((r) => `${r.id}:${r.name}:${r.master ? 'm' : r.live ? 'l' : 't'}${twoSides(r) ? '2' : ''}:${r.st?.mode || ''}:${r.st?.follow || ''}:${live.get(r.peer)?.micId || ''}`).join('|');
  if (sig === mixSig && $('#mixer').childElementCount) {
    // Same sources as before: update the strips in place, so a click never lands on a strip that's being replaced.
    for (const r of mixRows) {
      if (r.master) continue;
      document.querySelectorAll(`[data-strip="${CSS.escape(r.id)}"]`).forEach((el) => {
        el.querySelectorAll('[data-amode]').forEach((b) => b.setAttribute('aria-pressed', String(r.st.mode === b.dataset.amode)));
        el.querySelector('[data-mute]')?.setAttribute('aria-pressed', String(!!r.st.muted));
        el.querySelector('[data-mono]')?.setAttribute('aria-pressed', String(!!r.st.mono));
        el.querySelector('[data-duck]')?.setAttribute('aria-pressed', String(!!r.track?.duck));
        const range = el.querySelector('input[type=range]:not([data-pan])');
        if (range && document.activeElement !== range) range.value = String(gainToDb(r.st.gain));
        const pan = el.querySelector('input[data-pan]');
        if (pan && document.activeElement !== pan) pan.value = String(Math.round((r.st.pan || 0) * 100));
        const po = el.querySelector('.pano');
        if (po) po.textContent = fmtPan(r.st.pan || 0);
        const out = el.querySelector('.db');
        if (out) out.textContent = `${gainToDb(r.st.gain)} dB`;
        if (r.live) el.classList.toggle('open', !!r.open?.());
      });
    }
    renderBusAudio();
    consoleSync();
    fitDock();
    return;
  }
  mixSig = sig;
  const modeBtns = (r) => MODES.map((m) => `<button type="button" data-amode="${m}" aria-pressed="${r.st.mode === m}" title="${{ afv: 'Audio follows video: heard only while on air', on: 'Always in the mix', off: 'Never in the mix' }[m]}">${MODE_LABEL[m]}</button>`).join('');
  const monoBtn = (r, label = 'Mono') => `<button type="button" data-mono aria-pressed="${!!r.st.mono}" title="Play both channels as one (off: stereo)" aria-label="${esc(r.name)}: mono">${label}</button>`;
  const panIn = (r, cls = '') => `<input type="range" data-pan${cls ? ` class="${cls}"` : ''} min="-100" max="100" step="1" value="${Math.round((r.st.pan || 0) * 100)}" title="Balance (double-click: centre)" aria-label="${esc(r.name)} balance">`;
  // inspector: horizontal strips
  $('#mixer').innerHTML = mixRows.map((r) => `<div class="strip${r.master ? ' master' : ''}" data-strip="${esc(r.id)}">
      <span class="nm">${esc(r.name)}</span>
      ${r.master ? '<span></span>' : `<span class="btns">${r.live ? modeBtns(r) + monoBtn(r) : `${r.track?.follow ? `<button type="button" data-duck aria-pressed="${!!r.track.duck}" title="Quiet while a microphone recording plays, on everywhere else">Duck</button>` : ''}${monoBtn(r)}<button type="button" data-mute aria-pressed="${r.st.muted}" aria-label="Mute ${esc(r.name)}">Mute</button>`}</span>`}
      ${r.live && r.peer ? routeLine(r) : ''}
      ${(twoSides(r) ? [0, 1] : [0]).map((c) => `<span class="lvl" aria-hidden="true"><i data-ch="${c}"></i></span>`).join('')}
      ${r.master ? '' : `<input type="range" min="-60" max="12" step="1" value="${gainToDb(r.st.gain)}" aria-label="${esc(r.name)} level in decibels"><output class="db">${gainToDb(r.st.gain)} dB</output>
      ${panIn(r)}<output class="db pano">${fmtPan(r.st.pan || 0)}</output>`}
    </div>`).join('');
  // full screen: vertical meter bridge
  const scale = [0, -6, -12, -18, -24, -36, -48].map((db) => `<span style="--p:${((db + 60) / 60) * 100}%">${db}</span>`).join('');
  $('#bridge').innerHTML = mixRows.map((r) => `<div class="vstrip${r.master ? ' master' : ''}${r.live && r.open?.() ? ' open' : ''}" data-strip="${esc(r.id)}">
      <div class="vname" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="vmeters">
        <div class="vscale" aria-hidden="true">${scale}</div>
        ${(twoSides(r) ? [0, 1] : [0]).map((c) => `<div class="vmeter" aria-hidden="true"><i class="fill" data-ch="${c}"></i><i class="peak" data-ch="${c}"></i><span class="clip" data-ch="${c}"></span></div>`).join('')}
        ${r.master ? '' : `<input type="range" class="vfader" min="-60" max="12" step="1" value="${gainToDb(r.st.gain)}" aria-label="${esc(r.name)} level in decibels">`}
      </div>
      <output class="db">${r.master ? 'L R' : gainToDb(r.st.gain) + ' dB'}</output>
      ${r.master ? '' : `<div class="vpan">${panIn(r, 'vpanr')}${monoBtn(r, 'MONO')}</div>`}
      ${r.master ? '' : `<div class="vbtns">${r.live ? modeBtns(r) : `<button type="button" data-mute aria-pressed="${r.st.muted}" aria-label="Mute ${esc(r.name)}">M</button>`}</div>`}
      ${r.live && r.peer ? routeLine(r, true) : ''}
    </div>`).join('');
  renderBusAudio();
  consoleSync();
  fitDock();
}

// ---- the audio console: a pop-out window for mixing ----------------------------------------
// The same channels as the mixer (Live: each phone and the Clips; Edit: each audio track)
// with room to work: a high-pass and three-band EQ with its curve, balance, big meters, and
// the output's spectrum, waveform, stereo picture and phase. It's a window this page draws
// into, so every control drives the same sound engine (and the program recording), and
// closing it loses nothing. The studio's keys (1–9, B, X, T…) work from it too.
export let conWin = null, conSig = '';
export function setConSig(v) { return (conSig = v); }
export function setConWin(v) { return (conWin = v); }
export const conHolds = new Map();
const CONSOLE_CSS = `
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font-size:13px;overflow:hidden}
:root[data-theme="dark"] body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}
@media not all and (prefers-color-scheme: light){:root:not([data-theme]) body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--line);flex:none}
.logo{font-stretch:125%;font-weight:800}
.room{font-size:.68rem;font-weight:800;letter-spacing:.08em;padding:.15em .6em;border-radius:4px;background:var(--tally);color:#fff}
.room.edit{background:var(--text);color:var(--bg)}
.ev{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp{flex:1}.hint{color:var(--muted);font-size:.75rem}
.chk{display:inline-flex;gap:6px;align-items:center;font-size:.8rem;margin:0;font-weight:600}
main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:0}
.strips{display:flex;gap:8px;padding:10px;overflow:auto;align-items:stretch}
.empty{color:var(--text-2);padding:20px;margin:0}
.ch{flex:0 0 158px;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px;min-height:420px;max-height:100%;box-sizing:border-box;overflow:hidden}
.ch.open{box-shadow:inset 0 0 0 2px var(--tally)}
.ch h3{margin:0;font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btns{display:flex;gap:3px}
button{font:inherit}
.btns button,.lbl button{flex:1;min-height:24px;padding:0 .3em;font-size:.64rem;font-weight:800;border-radius:4px}
button[aria-pressed="true"][data-amode="afv"]{background:#f2c037;color:#2b1d00}
button[aria-pressed="true"][data-amode="on"]{background:#2bd36b;color:#002910}
button[aria-pressed="true"][data-amode="off"],button[aria-pressed="true"][data-mute]{background:#ff3b30;color:#fff}
button[aria-pressed="true"][data-mono],button[aria-pressed="true"][data-hp]{background:var(--preview);color:#fff}
.lbl{font-size:.6rem;font-weight:800;letter-spacing:.08em;color:var(--text-2);display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px}
.lbl button{flex:none}
.eq canvas{display:block;width:100%;height:52px;background:#000;border-radius:4px}
.k{display:grid;grid-template-columns:30px minmax(0,1fr) 38px;gap:4px;align-items:center;font-size:.62rem;font-weight:800;color:var(--text-2);margin:0}
.k input{width:100%;margin:0;min-height:0;padding:0}
.k output{font-family:var(--mono);text-align:right;color:var(--text);font-weight:600}
.fd{flex:1 1 0;display:grid;grid-template-columns:minmax(0,1fr) 26px;grid-template-rows:minmax(0,1fr);gap:6px;min-height:150px}
.fd canvas{width:100%;height:100%;min-height:0;background:#000;border-radius:4px;display:block;contain:size}
.fd input{writing-mode:vertical-lr;direction:rtl;width:26px;height:100%;margin:0;min-height:0;padding:0}
.db{font-family:var(--mono);font-size:.74rem;text-align:center}
.out{border-left:1px solid var(--line);background:var(--surface);display:grid;grid-template-rows:auto 150px minmax(0,1fr) minmax(0,1fr) 180px;gap:8px;padding:10px;min-height:0}
.out h2{margin:0;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--text-2)}
.lr{display:grid;grid-template-columns:64px 1fr;grid-template-rows:minmax(0,1fr);gap:10px;min-height:0}
.lr canvas{width:100%;height:100%;min-height:0;background:#000;border-radius:4px;display:block;contain:size}
.read{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start}
.read div{background:var(--surface-2);border-radius:6px;padding:6px 8px;display:grid}
.read span{font-size:.6rem;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.read b{font-family:var(--mono);font-size:1rem}
.vis{position:relative;background:#000;border-radius:6px;min-height:0;overflow:hidden}
.vis span{position:absolute;left:8px;top:6px;font-size:.6rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b8e97;z-index:1;pointer-events:none}
.vis canvas{display:block;width:100%;height:100%;contain:size}
`;
const consoleHtml = (theme) => `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8">
<title>Audio console · ${esc(ev?.title || 'VUEMesh')}</title>
<link rel="stylesheet" href="${location.origin}/css/vm.css"><style>${CONSOLE_CSS}</style></head>
<body><header><b class="logo">Audio console</b><span class="room" id="room"></span><span class="ev">${esc(ev?.title || '')}</span><span class="sp"></span>
<label class="chk" id="cListenRow"><input type="checkbox" id="cListen"> Listen on this computer</label><span class="hint">Double-click a control to reset it</span></header>
<main><section class="strips" id="strips" aria-label="Channels"></section>
<aside class="out" aria-label="Output"><h2 id="outName">Program</h2>
<div class="lr"><canvas id="cMeters" aria-hidden="true"></canvas><div class="read"><div><span>Peak</span><b id="rPeak">−∞</b></div><div><span>Level (RMS)</span><b id="rRms">−∞</b></div><div><span>Balance</span><b id="rBal">C</b></div><div><span>Phase</span><b id="rCorr">–</b></div></div></div>
<div class="vis"><span>Spectrum</span><canvas id="cSpec" aria-hidden="true"></canvas></div>
<div class="vis"><span>Waveform · L green, R amber</span><canvas id="cScope" aria-hidden="true"></canvas></div>
<div class="vis"><span>Stereo</span><canvas id="cVec" aria-hidden="true"></canvas></div>
</aside></main></body></html>`;

export function openConsole() {
  if (conWin && !conWin.closed) return conWin.focus();
  const w = window.open('', 'vuemesh-console-' + eventId, 'popup,width=1240,height=780');
  if (!w) return toast('The browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  conWin = w;
  conSig = '';
  w.document.open();
  w.document.write(consoleHtml(document.documentElement.dataset.theme || ''));
  w.document.close();
  bindConsole(w);
  renderMixer();
  w.requestAnimationFrame(() => consoleFrame(w));
  note('Audio console opened');
}
window.addEventListener('pagehide', () => conWin?.close());
