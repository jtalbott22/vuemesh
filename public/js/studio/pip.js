// Studio, part 26 of 26: picture-in-picture, live: a camera in a corner of the program.
// Loads after picsync.js: that import comes first, so the parts run in order (see ../studio.js).
//
// A shared screen (slides, a demo) on air with the presenter in a corner, live: the camera
// that was on air just before (or one chosen), in time with the screen (its frames come from
// picsync, like any camera's), its sound with it (AFV hears it as on air), its tally on. It
// comes in and goes out with a quick fade, and through a dissolve it goes with the picture it
// belongs to. "Over every shot" puts it over any source, not only screens. P turns it on and off.
import './picsync.js';
import { drawFramed } from '/js/compose.js';
import { esc } from '/js/vm.js';
import { $, hub, live, liveActive, mode, note } from './core.js';
import { camOrder, isMic, liveNo } from './live.js';
import { mediaOn, onBreak } from './graphics.js';
import { sw, swActive } from './switcher.js';
import { mixGates } from './mixer.js';
import { localRecFollow } from './sources.js';
import { picOf } from './picsync.js';

const KEY = 'vm_pip';
const CORNERS = { br: 'Bottom right', bl: 'Bottom left', tr: 'Top right', tl: 'Top left' };
const SIZES = [20, 25, 33];
const FADE_MS = 200;
// (var: the program draws from its first frame, before this part has run)
var pip = (() => {
  const d = { on: true, over: 'screens', cam: 'auto', corner: 'br', size: 25 };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return d;
  }
})();
var shown = { peer: null, a: 0, at: 0 }; // what's in the corner now, and how much of it
var recent = new Map(); // camera peer → when it was last on air (the auto choice: the latest)
var tallied = null;
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(pip));
  } catch {}
};

const isScreen = (peer) => !!live.get(peer)?.screen;
const isCamera = (peer) => !!peer && live.has(peer) && !isMic(peer) && !isScreen(peer);
const hasPicture = (peer) => !!picOf(peer) || live.get(peer)?.video?.readyState >= 2;
/** Would a corner camera go over this source? */
const wants = (peer) => pip.on && !!peer && live.has(peer) && !isMic(peer) && (pip.over === 'always' || isScreen(peer));

/** The camera for the corner over `under`: the one chosen, or the one most lately on air. */
function cameraFor(under) {
  const ok = (p) => isCamera(p) && p !== under && hasPicture(p);
  if (pip.cam !== 'auto') {
    const p = [...live.keys()].find((x) => (live.get(x).cid || x) === pip.cam);
    return ok(p) ? p : null;
  }
  let best = null, at = -1;
  for (const [p, t] of recent) if (ok(p) && t > at) [best, at] = [p, t];
  return best || camOrder().find(ok) || null;
}

/** What the corner should show this frame: { peer, a } (a: 0 hidden … 1 full). */
function target() {
  if (onBreak() || mediaOn) return { peer: null, a: 0 };
  if (swActive() && !sw.toClip && !sw.toSpecial && !sw.fromSpecial) {
    // through a dissolve: it goes with the picture it belongs to
    const from = wants(liveActive) ? cameraFor(liveActive) : null;
    const to = wants(sw.to) ? cameraFor(sw.to) : null;
    const peer = to || from;
    const a = (from === peer ? 1 - sw.p : 0) + (to === peer ? sw.p : 0);
    return { peer, a, direct: true };
  }
  if (swActive()) return { peer: shown.peer, a: 0 };
  const peer = wants(liveActive) ? cameraFor(liveActive) : null;
  return { peer, a: peer ? 1 : 0 };
}

/** The corner camera on the program (after the shot and any dissolve, under the graphics). */
export function drawPip(g, W, H) {
  if (!pip || mode !== 'live') return;
  const t = performance.now();
  if (isCamera(liveActive)) recent.set(liveActive, t);
  const want = target();
  const dt = Math.min(100, t - (shown.at || t));
  shown.at = t;
  if (want.direct) {
    shown.peer = want.peer;
    shown.a = want.a;
  } else if (want.peer && want.peer !== shown.peer && shown.a > 0.01) {
    shown.a = Math.max(0, shown.a - dt / FADE_MS); // (a different camera: out, then in)
  } else {
    if (want.peer) shown.peer = want.peer;
    shown.a = want.a > shown.a ? Math.min(want.a, shown.a + dt / FADE_MS) : Math.max(want.a, shown.a - dt / FADE_MS);
  }
  if (shown.a <= 0.001 && !want.peer) shown.peer = null;
  const peer = shown.a > 0.001 ? shown.peer : null;
  if (peer !== tallied) changed(peer);
  else if (peer && shown.a < 1) mixGates(); // (its sound fades with it)
  if (!peer) return;
  const l = live.get(peer), frame = picOf(peer) || l?.video;
  if (!frame) return;
  const w = Math.round((W * pip.size) / 100), h = Math.round((w * 9) / 16), m = Math.round(W * 0.025);
  const x = pip.corner.endsWith('l') ? m : W - w - m, y = pip.corner.startsWith('t') ? m : H - h - m;
  g.save();
  g.globalAlpha = shown.a;
  g.fillStyle = '#000';
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.translate(x, y);
  drawFramed(g, frame, w, h, 'fill', null, l.view?.rect || null);
  g.restore();
}

/** The preview monitor (Tap: Preview): the corner camera this source would get on air, drawn
 *  the same as on the program (what CUT or AUTO will look like), and nothing else changed. */
export function drawPipPreview(g, W, H, under) {
  if (!pip || mode !== 'live' || onBreak() || !wants(under)) return;
  // (on air now: the camera it would take the corner from, when that's a camera; else the usual choice)
  const peer = isCamera(liveActive) && liveActive !== under && hasPicture(liveActive) && pip.cam === 'auto' ? liveActive : cameraFor(under);
  const l = peer && live.get(peer), frame = l && (picOf(peer) || l.video);
  if (!frame) return;
  const w = Math.round((W * pip.size) / 100), h = Math.round((w * 9) / 16), m = Math.round(W * 0.025);
  const x = pip.corner.endsWith('l') ? m : W - w - m, y = pip.corner.startsWith('t') ? m : H - h - m;
  g.save();
  g.fillStyle = '#000';
  g.fillRect(x - 1, y - 1, w + 2, h + 2);
  g.translate(x, y);
  drawFramed(g, frame, w, h, 'fill', null, l.view?.rect || null);
  g.restore();
}

/** The corner camera now (for AFV, tally, the remote), or null. */
export function pipAir() {
  return tallied && shown.a > 0.001 ? { peer: tallied, a: shown.a } : null;
}

function changed(peer) {
  const was = tallied;
  tallied = peer;
  if (was && was !== liveActive) hub?.send(was, { t: 'tally', on: false });
  if (peer) hub?.send(peer, { t: 'tally', on: true });
  for (const p of [was, peer]) live.get(p)?.tile?.classList.toggle('pipair', p === peer && !!p);
  mixGates();
  localRecFollow(); // (this computer's camera in the corner records, as on air)
  renderPipState();
}
setInterval(() => tallied && hub?.send(tallied, { t: 'tally', on: true }), 4000); // (in case one was lost)

// ---- the controls: the inspector's card, the P key, the remote ----

export function setPip(patch, why) {
  Object.assign(pip, patch);
  save();
  renderPip();
  if (why) note(why);
}
export function pipSettings() {
  return { on: pip.on, over: pip.over, now: tallied ? live.get(tallied)?.name || null : null };
}
export function togglePip() {
  setPip({ on: !pip.on }, `Picture-in-picture ${pip.on ? 'off' : 'on'}`);
  return pip.on;
}

function renderPipState() {
  const s = $('#pipState');
  if (!s) return;
  const l = live.get(tallied);
  s.textContent = !pip.on ? 'Off. Press P to turn it on.'
    : l ? `In the corner now: ${liveNo(tallied) || ''} ${l.name}`.replace(/\s+/g, ' ')
      : pip.over === 'screens' ? 'Shows when a screen is on air (shared here, or from another computer at /share).' : 'Shows over the shot on air.';
  const b = $('#pipBtn');
  if (b) b.setAttribute('aria-pressed', String(pip.on));
}
export function renderPip() {
  if (!$('#pipOver')) return;
  $('#pipOn').checked = pip.on;
  $('#pipOver').value = pip.over;
  const cams = [...live.keys()].filter(isCamera);
  $('#pipCam').innerHTML = `<option value="auto">The camera on air before it</option>${cams.map((p) => {
    const l = live.get(p), id = l.cid || p;
    return `<option value="${esc(id)}"${id === pip.cam ? ' selected' : ''}>${esc(`${liveNo(p) || ''} ${l.name}`.trim())}</option>`;
  }).join('')}${pip.cam !== 'auto' && !cams.some((p) => (live.get(p).cid || p) === pip.cam) ? `<option value="${esc(pip.cam)}" selected>(the chosen camera, not here now)</option>` : ''}`;
  $('#pipCam').value = pip.cam;
  $('#pipCorner').innerHTML = Object.entries(CORNERS).map(([k, v]) => `<option value="${k}"${k === pip.corner ? ' selected' : ''}>${v}</option>`).join('');
  $('#pipSize').innerHTML = SIZES.map((n) => `<option value="${n}"${n === pip.size ? ' selected' : ''}>${n}% wide</option>`).join('');
  renderPipState();
}
$('#pipOn')?.addEventListener('change', (e) => setPip({ on: e.target.checked }));
$('#pipOver')?.addEventListener('change', (e) => setPip({ over: e.target.value }));
$('#pipCam')?.addEventListener('change', (e) => setPip({ cam: e.target.value }));
$('#pipCorner')?.addEventListener('change', (e) => setPip({ corner: e.target.value }));
$('#pipSize')?.addEventListener('change', (e) => setPip({ size: +e.target.value }));
$('#pipBtn')?.addEventListener('click', togglePip);
// (the camera list follows who's here)
let camSig = '';
setInterval(() => {
  const sig = [...live.keys()].filter(isCamera).map((p) => p + live.get(p).name).join('|');
  if (sig !== camSig) {
    camSig = sig;
    renderPip();
  }
}, 1000);
renderPip();
window.vmPip = () => ({ ...pipSettings(), peer: tallied, a: Math.round(shown.a * 100) / 100 });
