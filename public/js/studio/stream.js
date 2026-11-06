// Studio, part 10 of 26: Stream out (WHIP and RTMP).
// Loads after console-draw.js: that import comes first, so the parts run in order (see ../studio.js).
import './console-draw.js';
import { toast, esc, announce } from '/js/vm.js';
import { STREAM_SERVICES, startWhip } from '/js/whip.js';
import { startRtmp, relayHello, rtmpTarget, RELAY_DEFAULT } from '/js/rtmp.js';
import { $, dbToGain, isHost, live, mode, note, player } from './core.js';
import { saveSeq } from './clips.js';
import { micPeers } from './live.js';
import { addUsage } from './usage.js';
import {
  MODE_LABEL, mix, mixInit, mixSave, mixState, renderMixer, setStripMode, stripNodes, toggleStripMono,
  twoSides,
} from './mixer.js';
import { conSet } from './ccu.js';
import { programVideoTrack } from './switcher.js';
import { renderTimeline } from './edit.js';
import { clampL, layout } from './transport.js';

// ---- stream the program out (WHIP) -------------------------------------------------------
// One output: the program (picture and mix) straight from this browser to a streaming
// service over WebRTC (WHIP). Templates fill in what each service needs; the key stays on
// this computer. RTMP-only services (YouTube, Facebook) go through one that restreams.
const streamCfg = JSON.parse(localStorage.getItem('vm_stream') || '{}');
export let streamOut = null, streamTimer = null, streamSince = 0;
const svcOf = (id) => STREAM_SERVICES.find((s) => s.id === id) || STREAM_SERVICES[0];
$('#stSvc').innerHTML = [['whip', 'Straight from this browser (WHIP)'], ['rtmp', 'RTMP: through the VUEMesh relay on this computer'], ['vcam', 'Video calls: as a camera on this computer (relay)']]
  .map(([k, label]) => `<optgroup label="${label}">${STREAM_SERVICES.filter((s) => (k === 'vcam' ? s.vcam : s.kind === k && !s.vcam)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
$('#stRelay').value = streamCfg.relay || RELAY_DEFAULT;
$('#stSvc').value = svcOf(streamCfg.svc).id;
$('#stRate').value = String(streamCfg.kbps || 4500);
function renderStreamForm() {
  const s = svcOf($('#stSvc').value), saved = (streamCfg.per || {})[s.id] || {};
  $('#stHelp').textContent = s.help;
  $('#stUrlLbl').textContent = s.urlLabel || 'WHIP URL';
  $('#stUrl').hidden = $('#stUrlLbl').hidden = !!s.fixedUrl;
  $('#stKeyLbl').textContent = s.keyLabel || 'Key';
  $('#stKey').hidden = $('#stKeyLbl').hidden = !!s.noKey;
  $('#stUrl').value = saved.url || s.url || '';
  $('#stKey').value = saved.key || '';

  $('#stUrl').placeholder = s.kind === 'rtmp' ? 'rtmp://… or rtmps://…' : 'https://…';
  $('#stRelayRow').hidden = s.kind !== 'rtmp';
  if (s.kind === 'rtmp') {
    checkRelay();
    renderRelaySteps();
  }
}
// RTMP goes through the VUEMesh relay on this computer: is it there, with ffmpeg?
let relayOk = false;
async function checkRelay() {
  const url = $('#stRelay').value.trim() || RELAY_DEFAULT;
  $('#stRelayState').textContent = 'Looking for the relay on this computer…';
  try {
    const hi = await relayHello(url);
    relayOk = !!hi.ffmpeg;
    $('#stRelayState').textContent = hi.ffmpeg ? `Relay ready, with ffmpeg ${hi.ffmpeg}.` : "The relay is running, but ffmpeg isn't installed on this computer. Install it, then restart the relay.";
  } catch {
    relayOk = false;
    $('#stRelayState').textContent = `No relay at ${url} yet. Start it (see below), then check again.`;
  }
  $('#stRelayState').classList.toggle('ok', relayOk);
}
$('#stRelayCheck').onclick = checkRelay;
// Setting the relay up, for the computer this is (any other with a tab).
const RELAY_STEPS = {
  win: [
    ['Install Node.js and ffmpeg. Open PowerShell (Start, then type PowerShell) and run these two (or get them from nodejs.org and ffmpeg.org):', 'winget install -e --id OpenJS.NodeJS.LTS', 'winget install -e --id Gyan.FFmpeg'],
    ['Close PowerShell and open a new one, so it finds them. Then start the relay from your Downloads folder:', 'cd $HOME\\Downloads; node vuemesh-relay.mjs'],
    ['Leave that window open while you stream, and press Check for the relay above.'],
  ],
  mac: [
    ['Install Homebrew if you haven\u2019t (the one command at brew.sh, pasted into Terminal), then install Node.js and ffmpeg:', 'brew install node ffmpeg'],
    ['Start the relay from your Downloads folder:', 'cd ~/Downloads && node vuemesh-relay.mjs'],
    ['Leave that Terminal window open while you stream, and press Check for the relay above.'],
  ],
  linux: [
    ['Install Node.js (18 or later) and ffmpeg. Ubuntu or Debian: (if node --version says below 18, get Node from nodejs.org or with sudo snap install node --classic; on Fedora, enable RPM Fusion and use dnf)', 'sudo apt install -y nodejs ffmpeg'],
    ['Start the relay from your Downloads folder:', 'cd ~/Downloads && node vuemesh-relay.mjs'],
    ['Leave that terminal open while you stream, and press Check for the relay above.'],
  ],
  cros: [
    ['Turn on Linux: Settings, About ChromeOS, Developers, Linux development environment, Set up. Then, in the Files app, move vuemesh-relay.mjs from Downloads into Linux files.'],
    ['Open the Terminal app (Linux) and install Node.js and ffmpeg:', 'sudo apt update && sudo apt install -y nodejs ffmpeg'],
    ['Start the relay:', 'node vuemesh-relay.mjs'],
    ['Leave the Terminal open and press Check for the relay above. If it isn\u2019t found, add port 8935 under the Linux development environment\u2019s Port forwarding in Settings.'],
  ],
};
// Then, for video calls: making the program a camera the call can pick (once per computer).
const VCAM_STEPS = {
  win: [
    ['Install OBS Studio (it makes the camera):', 'winget install -e --id OBSProject.OBSStudio'],
    ['In OBS: Sources, +, Media Source. Untick Local File. Input: the line below. Input Format: mpegts. OK.', 'udp://127.0.0.1:9998'],
    ['In OBS: Start Virtual Camera. In Zoom or Teams, pick the camera "OBS Virtual Camera".'],
    ['For sound: install VB-CABLE (vb-audio.com/Cable). In OBS: Settings, Audio, Monitoring Device: CABLE Input; then the Media Source\u2019s Advanced Audio Properties: Monitor and Output. In the call, pick the microphone "CABLE Output".'],
  ],
  mac: [
    ['Install OBS Studio (it makes the camera) and BlackHole (for the sound):', 'brew install --cask obs blackhole-2ch'],
    ['In OBS: Sources, +, Media Source. Untick Local File. Input: the line below. Input Format: mpegts. OK.', 'udp://127.0.0.1:9998'],
    ['In OBS: Start Virtual Camera. In Zoom, Teams or Meet, pick the camera "OBS Virtual Camera".'],
    ['For sound: OBS Settings, Audio, Monitoring Device: BlackHole 2ch; the Media Source\u2019s Advanced Audio Properties: Monitor and Output. In the call, pick the microphone "BlackHole 2ch".'],
  ],
  linux: [
    ['Make a VUEMesh camera and microphone (no OBS needed): install the loopback camera, then load both (again after a restart):', 'sudo apt install -y v4l2loopback-dkms', 'sudo modprobe v4l2loopback video_nr=10 card_label=VUEMesh exclusive_caps=1', 'pactl load-module module-null-sink sink_name=VUEMesh sink_properties=device.description=VUEMesh'],
    ['Start (or restart) the relay. In the call, pick the camera "VUEMesh" and the microphone "Monitor of VUEMesh".'],
  ],
  cros: [
    ['ChromeOS can\u2019t give video calls a camera from Linux. Instead: open Program out, then in the call Share screen, pick the Program out window, and include its sound.'],
  ],
};
export const myOs = (() => {
  const ua = navigator.userAgent, p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/CrOS/.test(ua) || p.includes('chrome os') || p.includes('chromeos')) return 'cros';
  if (/Windows/.test(ua) || p.startsWith('win')) return 'win';
  if (/Mac OS X|Macintosh/.test(ua) || p.startsWith('mac')) return 'mac';
  return 'linux';
})();
function renderRelaySteps(os = myOs) {
  document.querySelectorAll('.ostabs [data-os]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.os === os));
    b.textContent = { win: 'Windows', mac: 'Mac', linux: 'Linux', cros: 'ChromeOS' }[b.dataset.os] + (b.dataset.os === myOs ? ' •' : '');
    b.title = b.dataset.os === myOs ? 'This computer' : '';
  });
  const li = ([text, ...cmds]) => `<li><span>${esc(text)}</span>${cmds.map((c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" data-copy="${esc(c)}">Copy</button></div>`).join('')}</li>`;
  const vcam = svcOf($('#stSvc').value).vcam;
  $('#relaySteps').innerHTML = RELAY_STEPS[os].map(li).join('') + (vcam ? `<li class="vcamhead"><b>Then, to use it as a camera in video calls:</b></li>${VCAM_STEPS[os].map(li).join('')}<li class="fine">No install at all: open Program out, then in the call Share screen, pick that window, and include its sound.</li>` : '');
}
document.querySelector('.ostabs')?.addEventListener('click', (e) => { // (the stream-out panel is the Live page's)
  const b = e.target.closest('[data-os]');
  if (b) renderRelaySteps(b.dataset.os);
});
$('#relaySteps').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy'), 1500);
  } catch {
    toast('Select the command and copy it');
  }
});
renderRelaySteps();
function saveStreamCfg() {
  const s = svcOf($('#stSvc').value);
  streamCfg.svc = s.id;
  streamCfg.kbps = +$('#stRate').value;
  (streamCfg.per ||= {})[s.id] = { url: $('#stUrl').value.trim(), key: $('#stKey').value.trim() };
  streamCfg.relay = $('#stRelay').value.trim();
  localStorage.setItem('vm_stream', JSON.stringify(streamCfg));
}
$('#stSvc').onchange = () => {
  renderStreamForm();
  saveStreamCfg();
};
['#stUrl', '#stKey', '#stRate'].forEach((id) => $(id).addEventListener('change', saveStreamCfg));
$('#stRelay').addEventListener('change', () => {
  saveStreamCfg();
  checkRelay();
});
renderStreamForm();
function streamState(text, on = false) {
  $('#stState').textContent = text;
  $('#stGo').textContent = on ? 'Stop streaming' : 'Go live';
  $('#stGo').classList.toggle('danger', on);
  $('#streamDot').hidden = !on;
}
$('#stGo').onclick = async () => {
  if (!isHost) return;
  if (streamOut) return stopStream('Stream stopped.');
  const s = svcOf($('#stSvc').value);
  const url = s.fixedUrl ? s.url : $('#stUrl').value.trim();
  const key = s.noKey ? '' : $('#stKey').value.trim();
  if (s.vcam) {
    // (no address or key: the relay makes the camera)
  } else if (s.kind === 'rtmp') {
    if (!url) return toast('Paste the server URL first');
    if (!/^rtmps?:\/\//i.test(url)) return toast('The server URL should start with rtmp:// or rtmps://');
    if (!key && s.id !== 'rtmp') return toast('Paste the stream key first');
  } else {
    if (!url || (/\/$/.test(url) && s.id === 'dolby')) return toast(s.id === 'dolby' ? 'Add your stream name to the end of the URL' : 'Paste the WHIP URL first');
    if (s.id === 'twitch' && !key) return toast('Paste your Twitch stream key first');
  }
  saveStreamCfg();
  mixInit();
  $('#stGo').disabled = true;
  streamState(s.kind === 'rtmp' ? `Connecting to ${s.name} through the relay…` : `Connecting to ${s.name}…`);
  let stream = null;
  try {
    stream = new MediaStream([programVideoTrack(), ...mix.dest.stream.getAudioTracks()]);
    const onState = (st, why) => {
      if (st === 'failed' && streamOut) stopStream(why ? `${why} Press Go live to start again.` : `The connection to ${s.name} dropped. Press Go live to start again.`);
    };
    streamOut = s.kind === 'rtmp'
      ? await startRtmp({ relay: $('#stRelay').value.trim() || RELAY_DEFAULT, target: s.vcam ? 'vcam:' : rtmpTarget(url, key), stream, kbps: +$('#stRate').value, onState })
      : await startWhip({ url, token: key, stream, kbps: +$('#stRate').value, onState });
    Object.assign(streamOut, { name: s.name, stream });
    streamSince = Date.now();
    streamState(`Live on ${s.name}`, true);
    if (s.vcam) {
      const v = streamOut.vcam;
      const where = v?.way === 'v4l2' ? `Pick the camera "VUEMesh" (${v.device})${v.sink ? ' and the microphone "Monitor of VUEMesh"' : ''} in your call.` : `In OBS: a Media Source on ${v?.udp || 'udp://127.0.0.1:9998'}, then Start Virtual Camera; in your call pick "OBS Virtual Camera".`;
      note(`The program is a camera on this computer. ${where}`);
      toast(where, 9000);
    }
    note(`Streaming the program to ${s.name}`);
    toast(`Live on ${s.name}`);
    streamTimer = setInterval(async () => {
      if (!streamOut) return;
      const k = await streamOut.rate().catch(() => 0);
      const sec = Math.floor((Date.now() - streamSince) / 1000);
      // through the relay: say so if this computer can't keep up (ffmpeg below real time, or data piling up)
      const sp = streamOut.stats?.().speed, behind = streamOut.backlog?.() > 8e6;
      const slow = streamOut.kind === 'rtmp' && ((sp && sp < 0.9) || behind) ? ` · this computer is struggling to keep up${sp ? ` (${sp}×)` : ''}: try a lower quality` : '';
      streamState(streamOut.vcam ? `On as a camera${streamOut.vcam.way === 'v4l2' ? ` (${streamOut.vcam.device})` : ' (to OBS)'} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${slow}` : `Live on ${streamOut.name}${streamOut.kind === 'rtmp' ? ' (RTMP)' : ''} · ${(k / 1000).toFixed(1)} Mbit/s · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${slow}`, true);
    }, 2000);
  } catch (e) {
    streamOut = null;
    stream?.getVideoTracks().forEach((t) => t.stop()); // (its copy of the program picture: in use by nothing now, it kept the program's capture running)
    streamState(e.message);
    toast(e.message, 7000);
    note(`Stream to ${s.name} didn't start: ${e.message}`);
  } finally {
    $('#stGo').disabled = false;
  }
};
async function stopStream(why) {
  if (streamSince) addUsage('streamSec', (Date.now() - streamSince) / 1000);
  const s = streamOut;
  streamOut = null;
  clearInterval(streamTimer);
  s?.stream?.getVideoTracks().forEach((t) => t.stop());
  await s?.stop();
  streamState(why || 'Not streaming.');
  if (s) note(`Stopped streaming to ${s.name}`);
}
window.addEventListener('pagehide', () => streamOut?.stop());

// The mixer never keeps empty space. Short, its strips lie flat, one row each, and it is
// exactly as tall as those rows (whatever height it was dragged to: anything more would be
// empty). Dragged tall (175 px or more), the strips stand up and fill it, faders upright.
// Double-click its edge to go back to fitting.
const DOCK_TALL = 175;
const dockFlat = () => !layout.live.dockManual || clampL('dock', layout.live.dock) < DOCK_TALL;
if (document.querySelector('.dock')) new ResizeObserver(() => document.querySelector('.dock')?.classList.toggle('horiz', dockFlat())).observe(document.querySelector('.dock')); // (the mixer dock is the Live page's)
/** How tall the mixer needs to be with its strips lying flat. */
function dockNeed() {
  const dock = document.querySelector('.dock'), bridge = $('#bridge');
  const wasHoriz = dock.classList.contains('horiz');
  dock.classList.add('horiz');
  const keep = bridge.style.cssText;
  bridge.style.flex = 'none';
  bridge.style.height = 'auto';
  const need = Math.ceil(dock.querySelector('.dockhead').offsetHeight + bridge.offsetHeight + 2);
  bridge.style.cssText = keep;
  if (!wasHoriz) dock.classList.remove('horiz');
  return need;
}
export function fitDock() {
  const dock = document.querySelector('.dock'), bridge = $('#bridge');
  if (mode !== 'live' || !dock || !bridge || !dock.offsetParent) return;
  // flat strips: exactly as tall as their rows (never empty space, never cut off);
  // upright strips (dragged tall): the height it was dragged to
  const flat = dockFlat();
  // (at most a third of the window: on a 768-px laptop with six strips it took 40%, and the sources
  // above had room for one tile; past that its strips scroll)
  const h = flat ? Math.min(Math.round(innerHeight * (innerHeight < 1000 ? 0.34 : 0.45)), dockNeed()) : clampL('dock', layout.live.dock);
  document.documentElement.style.setProperty('--dock', h + 'px');
  dock.classList.toggle('horiz', flat);
  $('#splitD')?.setAttribute('aria-valuenow', String(h));
}
window.addEventListener('resize', () => fitDock());

// One listener per panel: works whenever the strips were drawn.
for (const box of [$('#mixer'), $('#bridge')]) {
  box.addEventListener('input', (e) => {
    const range = e.target.closest('input[type=range]');
    const el = range?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (!r || r.master) return;
    if (range.hasAttribute('data-pan')) return conSet(r, 'pan', +range.value);
    const g = dbToGain(+range.value);
    document.querySelectorAll(`[data-strip="${CSS.escape(r.id)}"]`).forEach((x) => {
      const rr = x.querySelector('input[type=range]:not([data-pan])');
      if (rr && rr !== range) rr.value = range.value;
      const out = x.querySelector('.db');
      if (out) out.textContent = `${range.value} dB`;
    });
    if (r.track) {
      r.track.gain = g;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), gain: g });
      stripNodes(r)?.fader.gain.setTargetAtTime(g, player.ctx.currentTime, 0.02);
    }
  });
  box.addEventListener('dblclick', (e) => {
    const pan = e.target.closest('input[data-pan]');
    const el = pan?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (r) conSet(r, 'pan', 0);
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const el = b?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (!r || r.master) return;
    if (b.dataset.amode) {
      setStripMode(r.id, r.role, b.dataset.amode);
      announce(`${r.name}: ${MODE_LABEL[b.dataset.amode]}`);
    } else if (b.hasAttribute('data-mono') && r.live) toggleStripMono(r);
    else if (b.hasAttribute('data-mute') && r.track) {
      r.track.muted = !r.track.muted;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
      renderMixer();
      renderTimeline();
      announce(`${r.name} ${r.track.muted ? 'muted' : 'unmuted'}`);
    } else if (b.hasAttribute('data-mono') && r.track) {
      r.track.mono = !(r.track.mono !== false);
      saveSeq();
      player.refreshMix();
      renderMixer();
    } else if (b.hasAttribute('data-duck') && r.track) {
      r.track.duck = !r.track.duck;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
      renderMixer();
      announce(`${r.name}: ${r.track.duck ? 'quiet while a microphone plays' : 'always on'}`);
    }
  });
}

export let mixRows = [];
export function setMixRows(v) { return (mixRows = v); }
// (one buffer per meter, kept: a new one every frame for every meter was garbage 60 times a second)
export const peakOf = (an) => {
  if (!an) return 0;
  const buf = an.__buf?.length === an.fftSize ? an.__buf : (an.__buf = new Float32Array(an.fftSize));
  an.getFloatTimeDomainData(buf);
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]);
    if (v > p) p = v;
  }
  return p;
};
const toPct = (p) => Math.max(0, Math.min(100, (((p > 0 ? 20 * Math.log10(p) : -60) + 60) / 60) * 100));
/** Set a style property only when it changes: an unchanged write still costs the page a restyle and a repaint. */
export function setStyleIfChanged(el, prop, value) {
  const k = '__' + prop;
  if (el[k] === value) return;
  el[k] = value;
  if (prop.startsWith('--')) el.style.setProperty(prop, value);
  else el.style[prop] = value;
}
// Meters: -60 dB to 0 dB, with a peak hold that falls after 1.5 s and a clip light. The sound is
// read every frame (a peak between two reads isn't missed: each meter shows the loudest since it
// was last drawn), the meters are drawn at most 30 times a second, and only what changed is
// written: 60 writes a second to every meter, each finding its strips by searching the whole page,
// kept the studio's page restyling and repainting all of them on every frame.
const holds = new Map();
const loud = new Map(); // key → the loudest since the meter was last drawn
let stripEls = new Map(), stripRows = null, stripsAt = 0, metersAt = 0;
function stripsOf(id) {
  let s = stripEls.get(id);
  if (!s) {
    s = [...document.querySelectorAll(`[data-strip="${CSS.escape(id)}"]`)].map((el) => ({ el, by: new Map() }));
    stripEls.set(id, s);
  }
  return s;
}
const partOf = (strip, sel) => {
  if (!strip.by.has(sel)) strip.by.set(sel, strip.el.querySelector(sel));
  return strip.by.get(sel);
};
(function meters() {
  requestAnimationFrame(meters);
  const t = performance.now();
  // (the mixer drew its strips again, or a strip left the page: find them again; and twice a second anyway)
  if (stripRows !== mixRows || t - stripsAt > 500 || [...stripEls.values()].some((s) => s.some((x) => !x.el.isConnected))) {
    stripEls = new Map();
    stripRows = mixRows;
    stripsAt = t;
  }
  const draw = t - metersAt >= 30;
  if (draw) metersAt = t;
  for (const r of mixRows) {
    const levels = twoSides(r) ? (r.meters?.() || []).map(peakOf) : [peakOf(r.meter?.())];
    levels.forEach((p0, ch) => {
      const k = r.id + ':' + ch;
      const p = Math.max(p0, loud.get(k) || 0);
      if (!draw) return void loud.set(k, p);
      loud.delete(k);
      const pct = toPct(p);
      const h = holds.get(k) || { v: 0, at: 0, clipAt: 0 };
      if (pct >= h.v || t - h.at > 1500) Object.assign(h, { v: pct, at: t });
      if (p >= 0.99) h.clipAt = t;
      holds.set(k, h);
      const lvl = Math.round(pct * 2) / 2 + '%', pk = Math.round(h.v * 2) / 2 + '%', clip = t - h.clipAt < 2000;
      for (const s of stripsOf(r.id)) {
        const fill = partOf(s, `.fill[data-ch="${ch}"]`);
        if (fill) setStyleIfChanged(fill, '--lvl', lvl);
        else {
          const bar = partOf(s, `.lvl i[data-ch="${ch}"]`);
          if (bar) setStyleIfChanged(bar, 'width', lvl);
        }
        const peak = partOf(s, `.peak[data-ch="${ch}"]`);
        if (peak) setStyleIfChanged(peak, '--pk', pk);
        const c = partOf(s, `.clip[data-ch="${ch}"]`);
        if (c && c.classList.contains('on') !== clip) c.classList.toggle('on', clip);
      }
    });
    if (draw && r.live) {
      const open = !!r.open?.();
      for (const s of stripsOf(r.id)) if (s.el.classList.contains('vstrip') && s.el.classList.contains('open') !== open) s.el.classList.toggle('open', open);
    }
  }
  for (const peer of micPeers()) {
    const k = 'tile:' + peer, p = Math.max(peakOf(mix.strips.get(peer)?.meter), loud.get(k) || 0);
    if (!draw) {
      loud.set(k, p);
      continue;
    }
    loud.delete(k);
    const l = live.get(peer);
    if (l && !l.meterBar?.isConnected) l.meterBar = l.tile?.querySelector('.meter i') || null;
    if (l?.meterBar) setStyleIfChanged(l.meterBar, 'width', Math.round(toPct(p)) + '%');
  }
  // (what wasn't read this time: a strip gone mono, a microphone that left; its last loudest isn't kept for when it comes back)
  if (draw) loud.clear();
})();
