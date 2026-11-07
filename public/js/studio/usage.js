// Studio, part 4 of 26: anonymous usage counts.
// Loads after live.js: that import comes first, so the parts run in order (see ../studio.js).
import './live.js';
import { api, toast, diag } from '/js/vm.js';
import { shotScore, whatsWrong } from '/js/director.js';
import { KIOSK, clips, eventId, hub, isHost, key, live, mode, note, orientation, player } from './core.js';
import { angleOfCid } from './clips.js';
import { fitTile, picHealth, preBuf } from './live.js';
import { mix, mixAttach } from './mixer.js';
import { progRec } from './switcher.js';
import { bgInterval } from '/js/bgclock.js';
import { mixerWatch } from '/js/showlog.js';

// ---- usage, anonymously ----
// This event's running totals (recordings, footage, live cut and streaming time) go to the
// server now and then, which adds what's new to the day's anonymous counts (Admin, Growth).
// Totals only: no names, pictures or sound, nothing about anyone.
var usageAcc = null, usageTimer = null, usageSent = ''; // (var: used before this line runs)
function usageStore() {
  usageAcc ||= JSON.parse(localStorage.getItem('vm_usage_' + eventId) || '{"liveCutSec":0,"streamSec":0}');
  return usageAcc;
}
export function addUsage(k, sec) {
  if (!(sec > 0)) return;
  const u = usageStore();
  u[k] = (u[k] || 0) + sec;
  localStorage.setItem('vm_usage_' + eventId, JSON.stringify(u));
  reportUsageSoon(5000);
}
export function reportUsageSoon(delay = 60000) {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => reportUsage(), delay);
}
async function reportUsage(leaving) {
  if (!isHost || !eventId) return;
  const u = usageStore();
  // (a recording's length counts if it's plausible: one with a nonsense length, 83 days once,
  // is left out of the footage and named in the event log, so the cause can be found)
  const recs = clips.filter((c) => !c.program && !c.reel);
  for (const c of recs) if (!(c.dur > 0 && c.dur <= 6 * 3600e3) && !c.durNoted) {
    c.durNoted = true;
    note(`${c.name}'s recording says it's ${Math.round((c.dur || 0) / 1000)} s long, which can't be right: left out of the footage count`);
    diag('clip', `implausible length: ${c.id} ${c.name} dur=${c.dur} t0=${c.t0} mime=${c.mime} src=${c.t0Source || ''}`);
  }
  const body = {
    clips: recs.length, footageSec: Math.round(recs.reduce((s, c) => s + (c.dur > 0 && c.dur <= 6 * 3600e3 ? c.dur : 0), 0) / 1000),
    liveCutSec: Math.round(u.liveCutSec || 0), streamSec: Math.round(u.streamSec || 0),
    liveSec: Math.round(u.liveSec || 0), editSec: Math.round(u.editSec || 0), kioskSec: Math.round(u.kioskSec || 0),
  };
  const sig = JSON.stringify(body);
  if (sig === usageSent || !Object.values(body).some(Boolean)) return;
  try {
    if (leaving) fetch(`${(window.VM_CONFIG?.api || '/api').replace(/\/$/, '')}/events/${eventId}/usage`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Host-Key': key }, body: sig });
    else await api(`events/${eventId}/usage`, { method: 'POST', host: key, body });
    usageSent = sig;
  } catch {}
}
setInterval(() => reportUsage(), 10 * 60000);
// Time used, by what the studio was doing: live, editing, or running a kiosk (while it's on
// screen, or has phones in, or is recording). Counted per event (Admin shows it).
setInterval(() => {
  if (!isHost || !eventId || !(document.visibilityState === 'visible' || live.size || progRec)) return;
  const u = usageStore(), k = KIOSK ? 'kioskSec' : mode === 'edit' ? 'editSec' : 'liveSec';
  u[k] = (u[k] || 0) + 10;
  localStorage.setItem('vm_usage_' + eventId, JSON.stringify(u));
}, 10000);
window.vmReportUsage = () => reportUsage(); // (tests and diagnostics: report now)
window.addEventListener('pagehide', () => reportUsage(true));

// What the studio is playing and hearing from each phone right now (diagnostics and tests).
window.vmMedia = () =>
  [...live].map(([peer, l]) => {
    const st = mix.strips?.get(peer), v = l.video;
    let level = null;
    if (st?.pre) {
      st.pre.getFloatTimeDomainData(preBuf);
      level = Math.max(...preBuf.map(Math.abs));
    }
    return {
      peer, name: l.name, videoFrames: v?.getVideoPlaybackQuality?.().totalVideoFrames ?? null, videoTime: v?.currentTime ?? null,
      videoTracks: l.stream?.getVideoTracks().map((t) => t.readyState) || [], audioTracks: l.stream?.getAudioTracks().map((t) => t.readyState + (t.muted ? ' muted' : '')) || [],
      hearing: !!st?.src && st.trackId === l.stream?.getAudioTracks()[0]?.id, level,
      control: l.cam ? { remote: l.cam.remote, lenses: (l.cam.lenses || []).map((x) => x.label), lens: l.cam.lens } : null,
      recording: l.recorder ? { fps: (l.recTrack || l.stream?.getVideoTracks()[0])?.getSettings?.().frameRate ?? null, copy: !!l.recTrack } : null,
    };
  });
// (on the worker clock: a microphone whose sound stopped reaching the mixer is put back while the
// studio is hidden too; when, and when it's said, is mixerWatch's: see /js/showlog.js)
bgInterval(() => {
  if (!mix.strips?.size) return;
  if (player.ctx?.state === 'suspended') player.ctx.resume().catch(() => {});
  for (const [peer, st] of mix.strips) {
    const l = live.get(peer);
    const pre = st.preAll || st.pre; // (one side of a split input: the watch hears the whole input)
    if (!l || !st.src || !pre) continue;
    if (st.sink?.paused) st.sink.play().catch(() => {});
    const at = l.stream?.getAudioTracks().find((t) => t.id === st.trackId);
    if (!at || at.readyState !== 'live' || at.muted || !at.enabled || l.paused) {
      st.silentSince = 0;
      if (!at || at.readyState !== 'live') mixAttach(peer);
      continue;
    }
    pre.getFloatTimeDomainData(preBuf);
    const back = mixerWatch(st, Date.now(), preBuf.some((v) => v !== 0));
    if (back) {
      if (back.say) note(`${l.name}'s sound had stopped reaching the mixer: reconnected it`);
      st.trackId = null;
      mixAttach(peer);
    }
  }
}, 2000);
let picBusy = false;
const tileShowing = (l) => mode === 'live' && !document.hidden && !!l.tile?.isConnected && l.card?.style.display !== 'none' && l.tile.offsetParent !== null;
const healthOf = (peer) => {
  if (!picHealth.has(peer)) picHealth.set(peer, { fixes: [], reconnects: [] });
  return picHealth.get(peer);
};

async function watchPictures() {
  if (!hub || picBusy) return;
  picBusy = true;
  try {
    for (const [peer, l] of [...live]) {
      if (l.role === 'mic' || l.local || !l.video || !l.stream) continue; // (this computer's own cameras: no link to fix)
      if (l.video.srcObject !== l.stream) {
        l.video.srcObject = l.stream;
        l.video.play().catch(() => {});
      } else if (l.video.paused && l.tile?.isConnected) l.video.play().catch(() => {});
      const st = await hub.videoIn(peer);
      if (live.get(peer) !== l) continue;
      const w = (l.wd ||= { el: 0, dec: 0, send: 0, last: null });
      const cur = { bytes: st?.bytes || 0, dec: st?.decoded || 0, frames: l.video.getVideoPlaybackQuality?.().totalVideoFrames || 0, ct: l.video.currentTime, at: performance.now() };
      const prev = w.last;
      w.last = cur;
      const track = l.stream.getVideoTracks()[0];
      if (!prev || !st || st.state !== 'connected' || !track || track.readyState !== 'live' || l.paused || l.overflow || l.leaving) {
        w.el = w.dec = w.send = 0;
        continue;
      }
      const dt = cur.at - prev.at;
      const arriving = cur.bytes > prev.bytes, decoding = cur.dec > prev.dec;
      const shown = cur.frames > prev.frames || cur.ct !== prev.ct;
      const drawing = !!l.qa && Date.now() - l.qa.at < 3000 && l.qa.pv > 0; // the phone says it's drawing its preview
      w.el = decoding && !shown && tileShowing(l) ? w.el + dt : 0;
      w.dec = arriving && !decoding ? w.dec + dt : 0;
      w.send = !arriving && drawing ? w.send + dt : 0;
      const h = healthOf(peer);
      const t = Date.now();
      h.fixes = h.fixes.filter((x) => t - x < 60000);
      if (w.el >= 4000) {
        w.el = 0;
        if (h.fixes.length >= 2) reconnectPhone(peer, 'its picture kept freezing in this window', true);
        else {
          h.fixes.push(t);
          freshPlayer(peer, 'its picture froze in this window');
        }
      } else if (w.dec >= 4000 || w.send >= 6000) {
        const why = w.dec >= 4000 ? 'its video arrived but stopped decoding' : 'the phone stopped getting its picture through';
        w.dec = w.send = 0;
        reconnectPhone(peer, why, true);
      }
    }
  } finally {
    picBusy = false;
  }
}
setInterval(watchPictures, 2000);

/** Give a camera's tile a new player, swapped in once it has a frame (the program keeps the old one till then). */
export function freshPlayer(peer, why) {
  const l = live.get(peer);
  if (!l?.stream || !l.video) return;
  const old = l.video;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = l.stream;
  let done = false;
  const swap = () => {
    if (done || live.get(peer) !== l || l.video !== old) return;
    done = true;
    v.style.cssText = old.style.cssText;
    if (old.parentNode) old.replaceWith(v);
    else l.tile?.prepend(v);
    old.srcObject = null;
    l.video = v;
    l.lastMove = performance.now();
    if (l.wd) l.wd.last = null;
    fitTile(l);
  };
  v.addEventListener('loadeddata', swap, { once: true });
  setTimeout(swap, 3000);
  v.play().catch(() => {});
  note(`Camera ${angleOfCid(l.cid) || '?'} (${l.name}): ${why}, so it got a fresh picture`);
}

/** Ask one phone to rebuild its link. Automatic ones are spaced out and give up after three in five minutes. */
export function reconnectPhone(peer, why, auto = false) {
  const l = live.get(peer);
  if (!l || !hub) return;
  const h = healthOf(peer);
  const t = Date.now();
  const n = angleOfCid(l.cid) || '?';
  h.reconnects = h.reconnects.filter((x) => t - x < 300000);
  if (auto) {
    if (h.reconnects.length && t - h.reconnects[h.reconnects.length - 1] < 45000) return;
    if (h.reconnects.length >= 3) {
      if (!h.warned) {
        h.warned = true;
        note(`Camera ${n} (${l.name}): ${why}, again. Not reconnecting it automatically any more.`);
        toast(`Camera ${n} (${l.name}) keeps losing its picture. Check the phone: screen on, VUEMesh in front, good Wi-Fi. Right-click its tile to reconnect it.`, 9000);
      }
      return;
    }
  }
  if (!hub.restart(peer)) return;
  h.reconnects.push(t);
  note(`Camera ${n} (${l.name}): ${why}, so it's reconnecting`);
  if (!auto) toast(`Reconnecting ${l.name}…`);
}

export const scoreOfLive = (l) => (l.qa && Date.now() - l.qa.at < 3000 ? shotScore(l.qa.base ?? 0.5, l.qa.upright, orientation, l.qa.fixed) : null);
export function renderQuality(l) {
  if (!l.tile || l.role === 'mic') return;
  let q = l.tile.querySelector('.q');
  if (!q) {
    l.tile.insertAdjacentHTML('beforeend', '<span class="q" aria-hidden="true"><i></i></span><span class="why" hidden></span>');
    q = l.tile.querySelector('.q');
  }
  const sc = scoreOfLive(l);
  q.querySelector('i').style.width = Math.round((sc ?? 0) * 100) + '%';
  q.classList.toggle('bad', sc != null && sc < 0.35);
  const why = sc != null && sc < 0.5 ? whatsWrong(l.qa.parts, l.qa.upright, orientation, l.qa.fixed) : null;
  const w = l.tile.querySelector('.why');
  w.hidden = !why;
  w.textContent = why || '';
}
