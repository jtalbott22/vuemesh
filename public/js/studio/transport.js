// Studio, part 18 of 26: program meters, Program out, layout, transport, tools, markers on the ruler.
// Loads after menus.js: that import comes first, so the parts run in order (see ../studio.js).
import './menus.js';
import { toast, esc, fmtDur, announce } from '/js/vm.js';
import * as S from '/js/sequence.js';
import { TOOLS } from '/js/timeline.js';
import {
  $, EDIT_ONLY, FRAME, eventId, fitMonitors, help, isHost, live, mode, note, player, selectedItem, seq,
  setSelectedItem, timeline,
} from './core.js';
import {
  angleCids, angleNo, angleOfCid, clipForAngle, clipOf, commit, redo, setMode, snapshot, undo,
} from './clips.js';
import { camOrder, fitTile, micKey, micPeers } from './live.js';
import { autoOn, setAuto } from './onair.js';
import { cycleCameraAudio, mix, mixInit, stereoMeters } from './mixer.js';
import { fitDock, peakOf, setStyleIfChanged } from './stream.js';
import {
  clipsOfMoment, deleteMoment, markMoment, media, momentsChanged, renameMoment, stepCue,
  toggleFullscreen,
} from './room.js';
import { toggleBlack, toggleBreak } from './graphics.js';
import { autoTransition, programVideoTrack, takeCut, takeSource } from './switcher.js';
import { recByHand } from './autopilot.js';
import { dissolveHere, renderTimeline, select, setRange } from './edit.js';
import { openMenu, place } from './menus.js';
import { addItem, cutTo, deleteSelected, trimToPlayhead } from './editops.js';
import {
  markIn, markOut, monTab, placeSource, selectMedia, setLeftTab, setMonTab, srcAudio, srcMon, srcSeek,
  srcToggle,
} from './library.js';
import { exporting } from './export.js';
import { togglePip } from './pip.js';

// ---- program sound meters beside the picture -------------------------------------------
// Left and right, in both rooms: Live reads the program mix, Edit reads the edit's output.
let editMeters = null;
const pmState = [{ v: 0, at: 0 }, { v: 0, at: 0 }];
function setMeters(on) {
  $('#pMeters').hidden = !on;
  $('#pMeters').closest('.monitor')?.classList.toggle('withmeters', on);
  $('#meterTgl').setAttribute('aria-pressed', String(on));
  $('#meterTgl').setAttribute('aria-label', on ? 'Hide program sound meters' : 'Show program sound meters');
  localStorage.setItem('vm_pmeters', on ? '1' : '0');
  fitMonitors();
}
$('#meterTgl').onclick = () => setMeters($('#pMeters').hidden);
setMeters(localStorage.getItem('vm_pmeters') !== '0');
// Browsers keep a page's sound paused until a click or key press, and some suspend it again
// (an audio device change, for one). Any click or key here wakes it; if it's still paused
// while something should be playing, a notice over the monitor says so and fixes it.
const wakeAudio = () => player.ctx.state !== 'running' && player.ctx.resume().catch(() => {});
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, wakeAudio, true));
$('#soundOff').onclick = () => player.ctx.resume().then(() => announce('Sound on')).catch(() => {});
// (first run on the next frame: it uses things defined further down this file)
requestAnimationFrame(function pmLoop() {
  requestAnimationFrame(pmLoop);
  const wantsSound = player.playing || !srcMon.v.paused || (mode === 'live' && $('#listen')?.checked);
  const off = wantsSound && player.ctx.state !== 'running';
  if ($('#soundOff').hidden === off) $('#soundOff').hidden = !off;
  if ($('#pMeters').hidden) return;
  let pair = null;
  if (mode === 'live') {
    if (mix.meterL) pair = [mix.meterL, mix.meterR];
  } else if (monTab === 'source') pair = srcAudio?.meters || null;
  else if (player.limit) pair = editMeters ||= stereoMeters(player.ctx, player.limit);
  // (read every frame, the loudest kept; drawn at most 30 times a second, and only what changed: see the mixer's meters)
  if (!pmBars[0]?.bar.isConnected) pmBars = [...document.querySelectorAll('#pMeters .pm')].map((bar) => ({ bar, fill: bar.querySelector('.fill'), peak: bar.querySelector('.peak'), loud: 0 }));
  const t = performance.now();
  const draw = t - pmAt >= 30;
  if (draw) pmAt = t;
  pmBars.forEach((b, ch) => {
    const an = pair?.[ch];
    b.loud = Math.max(b.loud, an ? peakOf(an) : 0);
    if (!draw) return;
    const peak = b.loud;
    b.loud = 0;
    const db = peak > 0 ? 20 * Math.log10(peak) : -60;
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    const st = pmState[ch];
    if (pct >= st.v || t - st.at > 1500) Object.assign(st, { v: pct, at: t });
    if (b.fill) setStyleIfChanged(b.fill, '--lvl', Math.round(pct * 2) / 2 + '%');
    if (b.peak) setStyleIfChanged(b.peak, '--pk', Math.round(st.v * 2) / 2 + '%');
    const { bar } = b;
    if (db > -1) {
      if (!bar.classList.contains('over')) bar.classList.add('over');
      bar.__over = t;
    } else if (bar.__over && t - bar.__over > 2000 && bar.classList.contains('over')) bar.classList.remove('over');
  });
});
let pmBars = [], pmAt = 0;

// ------------------------------------------------------------- program out ----
// A clean window with just the program, for a TV, projector, or OBS window capture. This
// tab hands it the picture and sound directly; nothing leaves the computer.
let outStream = null;
function programFeed() {
  if (outStream?.getVideoTracks()[0]?.readyState !== 'live') outStream = new MediaStream([programVideoTrack()]);
  let want = null;
  if (mode === 'live') {
    mixInit();
    want = mix.dest.stream.getAudioTracks()[0];
  } else want = player.audioStream().getAudioTracks()[0];
  const have = outStream.getAudioTracks()[0];
  if (want && have !== want) {
    if (have) outStream.removeTrack(have);
    outStream.addTrack(want);
  }
  return outStream;
}
window.vmProgramFeed = programFeed;
$('#progOutBtn').onclick = () => {
  const w = window.open(`/program?e=${eventId}`, 'vm-program-' + eventId, 'popup=yes,width=1280,height=760');
  if (!w) return toast('Your browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  w.focus();
  note('Program out opened');
  toast('Program out is open: click anywhere in it to fill the screen.', 5000);
  announce('Program out opened in a new window. Click it to go full screen.');
};

// ---------------------------------------------------------------- layout ----
// Panels are resizable: drag a divider (or focus it and use the arrow keys); double-click
// a side divider to hide or show that panel, or the timeline/mixer divider to reset it.
// Live and Edit each remember their own layout.
const LAYOUT_DEFAULT = { live: { left: 360, right: 300, dock: 230 }, edit: { left: 270, right: 320, tl: 300 } };
export const layout = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('vm_layout') || '{}');
    return { live: { ...LAYOUT_DEFAULT.live, ...(saved.live || {}) }, edit: { ...LAYOUT_DEFAULT.edit, ...(saved.edit || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(LAYOUT_DEFAULT));
  }
})();
const saveLayout = () => localStorage.setItem('vm_layout', JSON.stringify(layout));
// (the mixer can come right down to one row of strips: it never needs more when they lie flat)
const LIMITS = { left: [160, () => innerWidth * 0.55], right: [220, () => innerWidth * 0.45], tl: [120, () => innerHeight * 0.72], dock: [56, () => innerHeight * 0.6] };
export const clampL = (key, v) => Math.round(Math.max(LIMITS[key][0], Math.min(LIMITS[key][1](), v)));
export function applyLayout() {
  const L = layout[mode];
  const st = document.documentElement.style;
  st.setProperty('--left', (L.leftHidden ? 0 : clampL('left', L.left)) + 'px');
  st.setProperty('--right', (L.rightHidden ? 0 : clampL('right', L.right)) + 'px');
  if (mode === 'edit') st.setProperty('--tl', clampL('tl', L.tl) + 'px');
  if (mode === 'live') fitDock();
  document.body.classList.toggle('noleft', !!L.leftHidden);
  document.body.classList.toggle('noright', !!L.rightHidden);
  $('#togLeft')?.setAttribute('aria-pressed', String(!L.leftHidden));
  $('#togRight')?.setAttribute('aria-pressed', String(!L.rightHidden));
  for (const [id, key] of [['splitL', 'left'], ['splitR', 'right'], ['splitT', 'tl'], ['splitD', 'dock']]) {
    const el = $('#' + id);
    if (!el) continue;
    el.setAttribute('aria-valuemin', String(LIMITS[key][0]));
    el.setAttribute('aria-valuemax', String(Math.round(LIMITS[key][1]())));
    el.setAttribute('aria-valuenow', String(L[key + 'Hidden'] ? 0 : clampL(key, L[key] ?? LAYOUT_DEFAULT[mode][key] ?? LIMITS[key][0])));
  }
  fitMonitors();
  live.forEach(fitTile);
}
function splitter(id, key, axis, sign) {
  const el = $('#' + id);
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const L = layout[mode];
    const start = axis === 'x' ? e.clientX : e.clientY;
    // (the mixer starts from the height you see, which may be less than the one it was dragged to)
    const v0 = key === 'dock' ? (document.querySelector('.dock')?.getBoundingClientRect().height ?? 0) : L[key + 'Hidden'] ? LIMITS[key][0] : clampL(key, L[key]);
    const mv = (m) => {
      L[key] = clampL(key, v0 + sign * ((axis === 'x' ? m.clientX : m.clientY) - start));
      L[key + 'Hidden'] = false;
      if (key === 'dock') L.dockManual = true; // (you set its height: it stays there)
      applyLayout();
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      saveLayout();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => {
    const L = layout[mode];
    if (key === 'left' || key === 'right') L[key + 'Hidden'] = !L[key + 'Hidden'];
    else if (key === 'dock') L.dockManual = false; // fit the strips again
    else L[key] = LAYOUT_DEFAULT[mode][key];
    applyLayout();
    saveLayout();
  });
  el.addEventListener('keydown', (e) => {
    const L = layout[mode];
    const step = e.shiftKey ? 60 : 20;
    const more = axis === 'x' ? (sign > 0 ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
    const less = axis === 'x' ? (sign > 0 ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    if (e.key !== more && e.key !== less && e.key !== 'Home') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Home') L[key] = LAYOUT_DEFAULT[mode][key];
    else L[key] = clampL(key, (L[key] ?? LAYOUT_DEFAULT[mode][key]) + (e.key === more ? step : -step));
    if (key === 'dock') L.dockManual = e.key !== 'Home';
    L[key + 'Hidden'] = false;
    applyLayout();
    saveLayout();
  });
}
splitter('splitL', 'left', 'x', 1);
splitter('splitR', 'right', 'x', -1);
splitter('splitT', 'tl', 'y', -1);
splitter('splitD', 'dock', 'y', -1);
$('#togLeft')?.addEventListener('click', () => {
  layout[mode].leftHidden = !layout[mode].leftHidden;
  applyLayout();
  saveLayout();
});
$('#togRight')?.addEventListener('click', () => {
  layout[mode].rightHidden = !layout[mode].rightHidden;
  applyLayout();
  saveLayout();
});
window.addEventListener('resize', applyLayout);
// The inspector's cards: which are open is kept on this computer (all open the first time).
// Close all folds them; open the ones you use and they stay that way.
const CARDS_KEY = EDIT_ONLY ? 'vm_cards_edit' : 'vm_cards'; // (Edit has cards of its own)
const cards = () => [...document.querySelectorAll('.insp details.card')];
try {
  const open = JSON.parse(localStorage.getItem(CARDS_KEY) || 'null');
  if (Array.isArray(open)) for (const d of cards()) d.open = open.includes(d.id);
} catch {}
const saveCards = () => {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(cards().filter((d) => d.open).map((d) => d.id)));
  } catch {}
};
for (const d of cards()) d.addEventListener('toggle', saveCards);
$('#cardsFold')?.addEventListener('click', () => {
  const close = cards().some((d) => d.open && !d.hidden);
  for (const d of cards()) d.open = !close;
  $('#cardsFold').textContent = close ? 'Open all' : 'Close all';
  saveCards();
});
if ($('#cardsFold') && !cards().some((d) => d.open)) $('#cardsFold').textContent = 'Open all';

// ------------------------------------------------------------- transport ----

const setText = (el, v) => el && el.textContent !== v && (el.textContent = v);
player.on('tick', (t, ended) => {
  if (mode !== 'edit') return;
  const tc = fmtDur(t);
  setText($('#clock'), tc);
  setText($('#ptc'), tc);
  setText($('#tlTc'), tc);
  timeline.movePlayhead(t);
  const playing = player.playing;
  const pb = $('#playBtn'), use = pb.querySelector('use');
  if (use) use.setAttribute('href', playing ? '#i-pause' : '#i-play'); // (the Edit page's button is an icon)
  else pb.textContent = playing ? '❚❚' : '▶';
  pb.setAttribute('aria-label', playing ? (player.rate > 1 ? `Pause (${player.rate}× speed)` : 'Pause') : 'Play');
  if (playing) timeline.keepVisible(t);
  if (ended && exporting) exporting.stop();
  const prog = S.itemAt(S.program(seq), t);
  const c = prog && clipOf(prog.src);
  $('#progLabel').textContent = c ? `PROGRAM · ${angleNo(c.id)} ${c.name}` : 'PROGRAM';
  setText($('#progName'), c ? `${angleNo(c.id) || ''} ${c.name}`.trim() : prog ? labelText(prog) : 'Nothing on the Program track here');
  renderProgBar(t);
  document.querySelectorAll('.tile[data-angle]').forEach((tile) => {
    const n = +tile.dataset.angle;
    tile.classList.toggle('live', !!c && angleOfCid(c.cid) === n);
    tile.classList.toggle('off', !clipForAngle(n, t));
  });
});

const labelText = (it) => (it.type === 'title' ? `Title: ${it.text || ''}` : it.type === 'slate' ? 'Break slate' : it.type === 'image' ? 'Image' : 'Program');
/** The Program viewer's bar: where the playhead is in the whole edit, and the In to Out range Export renders. */
export function renderProgBar(t = player.t) {
  const bar = $('#pScrub');
  if (!bar) return;
  const end = Math.max(player.duration() || 0, S.end(seq), 1);
  const pct = (x) => Math.max(0, Math.min(100, (x / end) * 100));
  $('#pHeadBar').style.left = pct(t) + '%';
  bar.setAttribute('aria-valuenow', String(Math.round(pct(t))));
  const r = seq.range, rb = $('#pRangeBar');
  rb.hidden = !r;
  if (r) Object.assign(rb.style, { left: pct(r.in) + '%', width: Math.max(0.3, pct(r.out) - pct(r.in)) + '%' });
  setText($('#pRange'), r ? `In ${fmtDur(r.in)} · Out ${fmtDur(r.out)} · ${fmtDur(r.out - r.in)}` : '');
  setText($('#progDur'), fmtDur(S.end(seq)));
}
$('#pScrub')?.addEventListener('pointerdown', (e) => {
  const bar = $('#pScrub'), box = bar.getBoundingClientRect();
  const at = (x) => player.seek(Math.max(0, Math.min(1, (x - box.left) / box.width)) * Math.max(player.duration() || 0, S.end(seq)));
  player.pause();
  at(e.clientX);
  bar.setPointerCapture(e.pointerId);
  const mv = (m) => at(m.clientX);
  const up = () => (bar.removeEventListener('pointermove', mv), bar.removeEventListener('pointerup', up));
  bar.addEventListener('pointermove', mv);
  bar.addEventListener('pointerup', up);
});

$('#playBtn').onclick = () => {
  player.rate = 1;
  player.toggle();
};
// ---- the viewers' transport buttons (the same as their keys) ----
function stepProgram(frames) {
  player.pause();
  player.seek(player.t + frames * FRAME);
}
function toEdit(dir) {
  const pts = S.editPoints(seq);
  const t = player.t;
  const to = dir < 0 ? [...pts].reverse().find((p) => p < t - 1) : pts.find((p) => p > t + 1);
  if (to != null) player.seek(to);
}
function stepSource(frames) {
  srcMon.v.pause();
  srcSeek(srcMon.v.currentTime * 1000 + frames * FRAME);
}
$('#pStart')?.addEventListener('click', () => player.seek(0));
$('#pEnd')?.addEventListener('click', () => player.seek(player.duration()));
$('#pBack')?.addEventListener('click', (e) => stepProgram(e.shiftKey ? -5 : -1));
$('#pFwd')?.addEventListener('click', (e) => stepProgram(e.shiftKey ? 5 : 1));
$('#pPrev')?.addEventListener('click', () => toEdit(-1));
$('#pNext')?.addEventListener('click', () => toEdit(1));
$('#pIn')?.addEventListener('click', () => setRange('in'));
$('#pOut')?.addEventListener('click', () => setRange('out'));
$('#srcStart')?.addEventListener('click', () => srcSeek(srcMon.in));
$('#srcEnd')?.addEventListener('click', () => srcSeek(srcMon.out));
$('#srcBack')?.addEventListener('click', (e) => stepSource(e.shiftKey ? -5 : -1));
$('#srcFwd')?.addEventListener('click', (e) => stepSource(e.shiftKey ? 5 : 1));
$('#zoomIn')?.addEventListener('click', () => zoomBy(1.4));
$('#zoomOut')?.addEventListener('click', () => zoomBy(1 / 1.4));
$('#exportTop')?.addEventListener('click', () => $('#renderBtn').click());
$('#zoom').oninput = (e) => {
  timeline.px = +e.target.value;
  renderTimeline();
};

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog[open], summary')) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    return redo();
  }
  if (mod && k === 'k' && mode === 'edit') {
    e.preventDefault();
    return addEditAll();
  }
  if (mod) return;
  if (e.key === '?') {
    e.preventDefault();
    return help.showModal();
  }
  if (e.key === '`') return setMode(mode === 'live' ? 'edit' : 'live');
  if (k === 'f' && !e.shiftKey && !e.altKey) return toggleFullscreen();
  // Shifted digits are their own commands; read the physical key so any keyboard layout works.
  if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    if (mode === 'live') return cycleCameraAudio(+e.code.slice(5));
    if (e.code === 'Digit2') return setMonTab('source');
    if (e.code === 'Digit4') return setMonTab('program');
    return;
  }
  if (/^[1-9]$/.test(k)) {
    if (mode === 'live') {
      const cid = angleCids[+k - 1];
      const peer = camOrder().find((p) => live.get(p).cid === cid) || micPeers().find((p) => micKey(p) === +k);
      if (peer) takeSource(peer);
      else toast(cid ? `Camera ${k} isn't connected` : `Nothing on ${k}`);
    } else {
      const c = clipForAngle(+k, player.t);
      if (c) cutTo(c.id);
      else toast(angleCids[+k - 1] ? `Angle ${k} isn't recording at this moment` : `There's no angle ${k}`);
    }
    return;
  }
  if (mode === 'live') {
    if (k === 'b') toggleBreak();
    // the switcher: Enter = AUTO, Shift+Enter = CUT (not when Enter is pressing a focused button)
    else if (e.key === 'Enter' && !e.target.closest?.('button, a, select, [role="tab"]')) e.shiftKey ? takeCut() : autoTransition();
    else if (k === 'r') recByHand();
    else if (k === 'a') isHost && setAuto(!autoOn);
    else if (k === 'm') markMoment();
    else if (k === 't') $('#ltShow').click();
    else if (k === 'p' && !e.shiftKey) togglePip();
    else if (k === 'x') toggleBlack(!e.shiftKey);
    else if (k === '[' || k === ']') stepCue(k === ']' ? 1 : -1);
    return;
  }
  // ----- Edit: Premiere Pro keys
  if (k === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) return dissolveHere(); // (Dissolve, on the timeline)
  if (monTab === 'source') {
    // The Source monitor has focus: its own transport, In/Out, insert and overwrite.
    if (k === ' ' || k === 'k') {
      e.preventDefault();
      if (k === 'k') srcMon.v.pause();
      else srcToggle();
      return;
    }
    if (k === 'l') { player.pause(); srcMon.v.play().catch(() => {}); return; }
    if (k === 'j') return srcSeek(srcMon.v.currentTime * 1000 - 5000);
    if (k === 'arrowleft' || k === 'arrowright') {
      e.preventDefault();
      srcMon.v.pause();
      return srcSeek(srcMon.v.currentTime * 1000 + (e.shiftKey ? 5 * FRAME : FRAME) * (k === 'arrowleft' ? -1 : 1));
    }
    if (k === 'i') return markIn();
    if (k === 'o') return markOut();
    if (k === ',') return placeSource('insert');
    if (k === '.') return placeSource('overwrite');
    if (k === 'home') return srcSeek(srcMon.in);
    if (k === 'end') return srcSeek(srcMon.out);
  }
  if (k === ',' || k === '.') return toast('Open a clip in the Source monitor (Shift+2) to insert or overwrite');
  const tool = Object.entries(TOOLS).find(([, t]) => t.key === k && !e.shiftKey && !e.altKey);
  if (tool) return timeline.setTool(tool[0]);
  if (k === ' ') {
    e.preventDefault();
    player.rate = 1;
    player.toggle();
  } else if (k === 'j') player.seek(player.t - 5000);
  else if (k === 'k') {
    player.pause();
    player.rate = 1;
  } else if (k === 'l') {
    if (!player.playing) {
      player.rate = 1;
      player.play();
    } else player.rate = player.rate === 1 ? 2 : player.rate === 2 ? 4 : 1;
  } else if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    const step = (e.shiftKey ? 5 * FRAME : FRAME) * (k === 'arrowleft' ? -1 : 1);
    const f = selectedItem && S.findItem(seq, selectedItem);
    if (e.altKey && f) {
      // nudge the selected item, like Alt+arrow in Premiere
      snapshot();
      if (S.program(seq).items.includes(f.item)) seq.auto = false;
      if (!S.move(seq, f.item.id, f.item.start + step)) toast('No room there');
      commit();
    } else {
      player.pause();
      player.seek(player.t + step);
    }
  } else if (k === 'arrowup' || k === 'arrowdown') {
    e.preventDefault();
    toEdit(k === 'arrowup' ? -1 : 1);
  } else if (k === 'home') player.seek(0);
  else if (k === 'end') player.seek(player.duration());
  else if (k === 's') toggleSnap();
  else if (k === 'm') addMarkerHere();
  else if (k === 'i' && !e.altKey) setRange('in');
  else if (k === 'o' && !e.altKey) setRange('out');
  else if (e.altKey && e.code === 'KeyX') setRange(null);
  else if (k === 'q' || k === 'w') rippleTrimToPlayhead(k === 'q' ? 'start' : 'end');
  else if (k === '[' || k === ']') trimToPlayhead(k === '[' ? 'start' : 'end');
  else if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    if (e.shiftKey || e.altKey) rippleDeleteSelected();
    else deleteSelected();
  } else if (k === '=' || k === '+') zoomBy(1.4);
  else if (k === '-') zoomBy(1 / 1.4);
  else if (e.key === '\\') timeline.zoomToFit();
  else if (k === 't') addItem('lower');
  else if (k === 'p' && e.shiftKey) addItem('pip');
  else if (k === 'escape') select(null);
});

// ---- tool palette ----------------------------------------------------------------------------
export function renderTools(active = timeline.tool) {
  const icons = !!document.querySelector('#i-select'); // (the Edit page draws them as icons, as an editing suite's tool palette)
  $('#toolBtns').innerHTML = Object.entries(TOOLS)
    .map(([id, t]) => `<button type="button" ${icons ? 'class="icon" ' : ''}data-tool="${id}" aria-pressed="${id === active}" title="${t.name} (${t.key.toUpperCase()})" aria-label="${t.name}" aria-keyshortcuts="${t.key.toUpperCase()}">${icons ? `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>` : `${t.name.split(' ')[0]} <kbd>${t.key.toUpperCase()}</kbd>`}</button>`)
    .join('');
  const say = {
    select: 'Drag to move, drag edges to trim.',
    ripple: 'Drag an edge: trims and closes the gap on every track.',
    roll: 'Drag a cut point: moves it between the two clips.',
    razor: 'Click a clip to cut it there.',
    slip: 'Drag a clip: shows a different part of it, same place.',
    slide: 'Drag a clip between its neighbours; they trim to fit.',
    hand: 'Drag to scroll the timeline.',
  }[active];
  if (icons) $('#toolHelp').innerHTML = `<b>${esc(TOOLS[active].name)}</b> · ${esc(say)}`;
  else $('#toolHelp').textContent = say;
}
$('#toolBtns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) timeline.setTool(b.dataset.tool);
});
renderTools();

function toggleSnap() {
  timeline.snap = !timeline.snap;
  $('#snapBtn').setAttribute('aria-pressed', String(timeline.snap));
  announce(timeline.snap ? 'Snapping on' : 'Snapping off');
}
$('#snapBtn').onclick = toggleSnap;
function zoomBy(f) {
  timeline.px = Math.max(1, Math.min(240, timeline.px * f));
  $('#zoom').value = Math.round(Math.min(120, timeline.px));
  renderTimeline();
}
$('#fitBtnTl').onclick = () => timeline.zoomToFit();
function addMarkerHere() {
  snapshot();
  const m = S.addMarker(seq, player.t);
  if (!m) return toast('There’s already a marker here');
  m.abs = absAt(player.t, true) ?? undefined; // on footage: it stays with that footage through any edit
  commit();
  announce('Marker added');
}
$('#markerBtn').onclick = addMarkerHere;

// ---- markers and moments on the ruler: drag to move, double-click to rename, right-click --
// They hold on to the footage they were put on, not to a spot on the timeline: a moment
// keeps the event-clock time it was marked at, a marker the time of the footage under it.
// Wherever that footage now sits (after trims, moves, ripple deletes, Collapse gaps, speed
// changes), that's where they go. One where no camera was recording sits by the footage
// either side of it, faded.
function clipSpans() {
  const out = [];
  for (const tr of seq.tracks) {
    if (tr.follow) continue;
    for (const it of tr.items) {
      if (it.type !== 'clip') continue;
      const c = clipOf(it.src);
      if (!c) continue;
      const sp = it.speed || 1;
      const a = c.t0 + (it.in || 0) - (c.inBase || 0); // the event-clock time of the item's first frame
      out.push({ it, a, b: a + it.dur * sp, sp, prog: tr.program ? 1 : 0 });
    }
  }
  return out;
}
/** Event-clock time → {t: timeline time, gap: true if no footage covers it}, or null. */
export function timeOfAbs(abs) {
  if (abs == null) return null;
  const spans = clipSpans();
  const hit = spans.filter((x) => abs >= x.a && abs < x.b).sort((p, q) => q.prog - p.prog)[0];
  if (hit) return { t: hit.it.start + (abs - hit.a) / hit.sp, gap: false };
  let before = null, after = null;
  for (const x of spans) {
    if (x.b <= abs && (!before || x.b > before.b)) before = x;
    if (x.a > abs && (!after || x.a < after.a)) after = x;
  }
  if (!before && !after) return seq.origin != null ? { t: Math.max(0, abs - seq.origin), gap: true } : null;
  let t = before ? before.it.start + before.it.dur + (abs - before.b) : after.it.start - (after.a - abs);
  if (before && after) t = Math.min(t, after.it.start); // its gap was taken out: at the cut
  return { t: Math.max(0, t), gap: true };
}
/** Timeline time → the event-clock time of the footage there (null if `exact` and there's none). */
function absAt(t, exact = false) {
  const spans = clipSpans();
  const hit = spans.filter((x) => t >= x.it.start && t < x.it.start + x.it.dur).sort((p, q) => q.prog - p.prog)[0];
  if (hit) return hit.a + (t - hit.it.start) * hit.sp;
  if (exact) return null;
  let before = null, after = null;
  for (const x of spans) {
    const e = x.it.start + x.it.dur;
    if (e <= t && (!before || e > before.it.start + before.it.dur)) before = x;
    if (x.it.start > t && (!after || x.it.start < after.it.start)) after = x;
  }
  if (before) return before.b + (t - before.it.start - before.it.dur);
  if (after) return after.a - (after.it.start - t);
  return seq.origin != null ? seq.origin + t : null;
}
/** Put every anchored marker where its footage is now. */
export function resolveMarkers() {
  if (!seq.markers?.length) return;
  for (const m of seq.markers) {
    if (m.abs == null) continue;
    const at = timeOfAbs(m.abs);
    if (!at) continue;
    m.t = Math.round(at.t);
    m.gap = at.gap || undefined;
  }
  seq.markers.sort((a, b) => a.t - b.t);
}
const markerName = (m) => m.name || (m.moment ? 'Moment' : 'Marker');
const markerEl = (id) => document.querySelector(`[data-marker="${CSS.escape(id)}"]`);
export function moveMarker(m, t) {
  t = Math.max(0, Math.round(t));
  if (m.moment) {
    if (seq.origin == null) return;
    const abs = absAt(t);
    if (abs == null) return;
    media.updateMoment(m.id, { t: Math.round(abs) });
    momentsChanged();
  } else {
    const mk = (seq.markers || []).find((x) => x.id === m.id);
    if (!mk) return;
    snapshot();
    mk.t = t;
    mk.abs = absAt(t, true) ?? undefined;
    seq.markers.sort((a, b) => a.t - b.t);
    commit();
  }
  announce(`${markerName(m)} moved to ${fmtDur(t)}`);
  markerEl(m.id)?.focus();
}
export function renameMarker(m) {
  const el = markerEl(m.id);
  if (!el) return;
  renamePopover(el, m.name || '', m.moment ? 'Name this moment' : 'Name this marker', (v) => {
    if (m.moment) renameMoment(m.id, v);
    else {
      const mk = (seq.markers || []).find((x) => x.id === m.id);
      if (!mk || (mk.name || '') === v) return;
      snapshot();
      mk.name = v;
      commit();
      announce(v ? `Marker named ${v}` : 'Marker name cleared');
    }
    markerEl(m.id)?.focus();
  });
}
export function deleteMarker(m) {
  if (m.moment) return deleteMoment(m.id);
  snapshot();
  seq.markers = (seq.markers || []).filter((x) => x.id !== m.id);
  commit();
  announce(`${markerName(m)} deleted`);
}
export function markerMenu(m, x, y) {
  openMenu(x, y, [
    { label: 'Go to it', action: () => player.seek(m.t) },
    { label: 'Rename…', kbd: 'Enter', action: () => renameMarker(m) },
    { label: 'Move it to the playhead', disabled: Math.abs(player.t - m.t) < FRAME, action: () => moveMarker(m, player.t) },
    ...(m.moment ? [
      { label: 'Make clips from every angle', action: () => clipsOfMoment(m.id) },
      { label: 'Show it in Media', action: () => { setLeftTab('media'); selectMedia('moment', m.id); } },
    ] : []),
    { sep: true },
    { label: m.moment ? 'Delete this moment' : 'Delete this marker', kbd: 'Del', action: () => deleteMarker(m) },
  ], `${m.moment ? 'Moment' : 'Marker'} · ${markerName(m)} · ${fmtDur(m.t).slice(0, -3)}`);
}
/** A small text box under an element, for renaming. Enter or clicking away saves; Esc cancels. */
function renamePopover(anchor, value, label, onDone) {
  document.querySelector('.renamepop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'renamepop';
  pop.innerHTML = `<input type="text" maxlength="60" aria-label="${esc(label)}" placeholder="${esc(label)}">`;
  const input = pop.querySelector('input');
  input.value = value;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  place(pop, r.left - 8, r.bottom + 6);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    pop.remove();
    if (save && v !== value) onDone(v);
    else if (anchor.isConnected) anchor.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}
$('#turnsBtn').onclick = () => {
  snapshot();
  const n = S.splitAtOrientation(seq, (id) => clipOf(id)?.orient);
  if (!n) return toast('No clips change orientation inside the timeline');
  if (n) seq.auto = false;
  commit();
  toast(`Split ${n} time${n > 1 ? 's' : ''} where phones were turned`);
};

function addEditAll() {
  snapshot();
  const n = S.addEdit(seq, player.t);
  if (!n) return toast('Nothing under the playhead to cut');
  seq.auto = false;
  commit();
  announce(`Cut ${n} track${n > 1 ? 's' : ''}`);
}

/** Q / W: ripple trim the item under the playhead (on the selected item's track, or the Program). */
function rippleTrimToPlayhead(edge) {
  const f = selectedItem && S.findItem(seq, selectedItem);
  const tr = f?.track || S.program(seq);
  const it = S.itemAt(tr, player.t) || (f && f.item);
  if (!it) return toast('Nothing under the playhead on that track');
  snapshot();
  if (tr.program) seq.auto = false;
  const ok = S.rippleTrim(seq, it.id, edge, player.t, it.type === 'clip' ? clipOf(it.src)?.dur ?? Infinity : Infinity);
  if (!ok) return toast('Nothing to trim there');
  if (edge === 'start') player.seek(it.start);
  commit();
  announce(edge === 'start' ? 'Ripple trimmed the start' : 'Ripple trimmed the end');
}

export function rippleDeleteSelected() {
  if (!selectedItem) return toast('Select an item to ripple delete');
  snapshot();
  const f = S.findItem(seq, selectedItem);
  if (f?.track.program) seq.auto = false;
  if (!S.rippleDelete(seq, selectedItem)) return toast('That track is locked');
  setSelectedItem(null);
  commit();
  announce('Ripple deleted');
}
