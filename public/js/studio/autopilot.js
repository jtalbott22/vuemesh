// Studio, part 14 of 25: autopilot and the kiosk.
// Loads after switcher.js: that import comes first, so the parts run in order (see ../studio.js).
import './switcher.js';
import { api, toast, esc, now, announce, drawQR, timecodeUrl } from '/js/vm.js';
import * as idb from '/js/idb.js';
import {
  $, EDIT_ONLY, KIOSK, KIOSK_PAGE, LIVE_DELAY, black, clips, ev, eventId, hub, isHost, key, live,
  liveActive, mode, note, player, program, recMime,
} from './core.js';
import { addClip, output, renderOutput } from './clips.js';
import { camOrder, cutLive, renderLive } from './live.js';
import { addUsage } from './usage.js';
import { autoOn, manualUntil, recOnAirChanged, setAuto, setManualUntil, syncTally } from './onair.js';
import { mix, mixInit } from './mixer.js';
import { flushRecordings } from './sources.js';
import { cutMedia, lt, ltUi, mediaOn, reel, toggleBlack } from './graphics.js';
import {
  autoTransition, clearPreview, frameSinks, programVideoTrack, progRec, pvw, renderSwitcher,
  setProgRec, setPvw, setPvwClip, swActive,
} from './switcher.js';
import { incoming, outgoing, startPieces, stopPieces } from './phones.js';
import { download, showWrap } from './export.js';
import { setLeaveQuietly } from './screens.js';
import { ProgramRecorder, programRecorderSupport, tidyProgramRecordings } from '/js/progrec.js';

// ---------------------------------------------------------------- autopilot ---
// A show that runs itself. With no camera, the program sits at black. When a camera arrives
// (its picture steady for 3 s): the intro clip, if one's chosen, fades up and plays, the
// program records, and the auto director takes over. Each camera that arrives later is put
// in preview (green: PREVIEW on its phone), then dissolves to air with its name on a lower
// third. When no camera's been here for the time chosen, the program fades to black, the
// recording stops (kept here and in Media), and each phone gets its part of the live cut.
export var ap = { on: false, state: 'idle', emptySince: 0, ready: new Map(), seen: new Set(), handsFree: false }; // (var: used early)
const apEndMs = () => (+$('#apEnd').value || 30) * 1000;
const apCams = () => camOrder().filter((p) => {
  const l = live.get(p);
  return l && !l.local && !l.paused && !l.overflow && l.video?.readyState >= 2; // (this computer's own cameras don't start a show: they join the rotation)
});
function setAutopilot(on, quiet) {
  ap.on = on;
  $('#apOn').checked = on;
  localStorage.setItem('vm_autopilot', on ? '1' : '0');
  document.body.classList.toggle('autopilot', on);
  if (on) {
    ap.seen = new Set(apCams()); // (who's here already isn't "new")
    if (apCams().length) {
      ap.state = 'running';
      if (!autoOn) setAuto(true);
      if (black.target === 1) toggleBlack(true);
    } else {
      ap.state = 'idle';
      if (black.target !== 1) toggleBlack(false);
    }
  } else ap.state = 'idle';
  renderApIntro();
  if (!quiet) {
    note(on ? 'Autopilot on: the show runs itself' : 'Autopilot off');
    toast(on ? 'Autopilot on: the show starts when a camera arrives, and ends when they\u2019ve all gone' : 'Autopilot off');
  }
}
export function apIdle() {
  ap.state = 'idle';
  ap.seen.clear();
  ap.emptySince = 0;
  note('Autopilot: the show ended; waiting for the next camera');
}
function apLowerThird(peer, sub) {
  const l = live.get(peer);
  if (!l) return;
  Object.assign(lt, { on: true, at: performance.now(), off: performance.now() + 6000, text: l.name, sub });
  ltUi(true);
}
// Go live from the first phone: a 3-2-1 count-in, here and on the phone, then the show.
export function apCountIn(peer) {
  if (ap.state !== 'idle' || ap.counting) return;
  ap.counting = true;
  const box = $('#kCount'), b = box.querySelector('b');
  box.hidden = false;
  let n = 3;
  const step = () => {
    if (n === 0) {
      box.hidden = true;
      ap.counting = false;
      if (live.has(peer)) apStart(peer);
      return;
    }
    b.textContent = n;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    n--;
    setTimeout(step, 1000);
  };
  step();
  note(`Kiosk: ${live.get(peer)?.name} tapped Go live`);
}
function apStart(first) {
  if (ap.starter && live.has(ap.starter)) hub?.message(ap.starter, { t: 'starter', on: false });
  ap.starter = null;
  ap.state = 'running';
  ap.emptySince = 0;
  ap.seen.add(first);
  ap.handsFree = true;
  cutLive(first, 'autopilot');
  if (black.target === 1) toggleBlack(true); // (fading up starts the recording)
  else if (!progRec) toggleProgramRecording();
  const intro = reel.find((r) => r.id === $('#apIntro').value && r.type.startsWith('video/'));
  if (intro) {
    intro.loop = false;
    setTimeout(() => ap.on && cutMedia(intro.id), 50); // (plays once, then back to the camera)
    setTimeout(() => apLowerThird(first, 'is on'), (intro.prog?.duration || 5) * 1000 + 600);
  } else apLowerThird(first, 'is on');
  if (!autoOn) setAuto(true);
  note(`Autopilot: ${live.get(first)?.name || 'a camera'} arrived: the show is on${intro ? ` (intro: ${intro.name})` : ''}`);
}
function apWelcome(peer) {
  ap.seen.add(peer);
  (ap.welcomed ||= []).push(live.get(peer)?.name);
  if (swActive()) return;
  // queued: in preview for a moment (PREVIEW on their phone), then on air with a dissolve and their name
  setPvw(peer);
  setPvwClip(null);
  renderSwitcher();
  renderLive();
  syncTally();
  note(`Autopilot: ${live.get(peer)?.name} arrived: in preview, on air next`);
  setTimeout(() => {
    if (!ap.on || ap.state !== 'running' || pvw !== peer || !live.has(peer) || mediaOn) return;
    autoTransition();
    apLowerThird(peer, 'joined the show');
    setManualUntil(Date.now() + 8000); // (the auto director leaves them on for a moment)
  }, 2500);
}
function apTick() {
  if (!ap.on || !isHost || mode !== 'live') return;
  const t = Date.now(), cams = apCams();
  for (const p of cams) if (!ap.ready.has(p)) ap.ready.set(p, t);
  for (const p of [...ap.ready.keys()]) if (!cams.includes(p)) ap.ready.delete(p);
  const steady = cams.filter((p) => t - ap.ready.get(p) >= 3000);
  if (ap.state === 'idle') {
    if (!steady.length) return;
    if (!KIOSK) return apStart(steady[0]);
    // At a kiosk, the first phone in starts the show: it gets Go live (after it's locked in to
    // the code), and the count-in. If it leaves, the next phone gets it; after 3 minutes, it starts anyway.
    const starter = ap.starter && steady.includes(ap.starter) ? ap.starter : steady[0];
    if (starter !== ap.starter) {
      if (ap.starter && live.has(ap.starter)) hub?.message(ap.starter, { t: 'starter', on: false });
      ap.starter = starter;
      ap.starterSince = t;
      hub?.message(starter, { t: 'starter', on: true });
      note(`Kiosk: ${live.get(starter)?.name} can start the show (Go live on their phone)`);
    }
    if (t - ap.starterSince > 180000) apStart(starter);
    return;
  }
  if (ap.state !== 'running') return; // ('ended': waits for Start again)
  if (!cams.length) {
    ap.emptySince ||= t;
    if (t - ap.emptySince >= apEndMs()) {
      ap.state = 'ending';
      setAuto(false);
      if (pvw) clearPreview();
      if (black.target !== 1) toggleBlack(true);
      note('Autopilot: everyone has gone: fading to black, stopping the recording; each phone gets its part of the live cut');
    }
    return;
  }
  ap.emptySince = 0;
  const fresh = steady.find((p) => !ap.seen.has(p) && p !== liveActive);
  if (fresh && !mediaOn && !swActive() && t >= manualUntil) apWelcome(fresh);
  for (const p of steady) if (p === liveActive) ap.seen.add(p);
}
setInterval(apTick, 1000);
function renderApIntro() {
  const sel = $('#apIntro'), cur = sel.value || localStorage.getItem('vm_ap_intro') || '';
  sel.innerHTML = `<option value="">None</option>${reel.filter((r) => r.type.startsWith('video/')).map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}`;
}
$('#apOn').onchange = (e) => setAutopilot(e.target.checked);
$('#apIntro').onfocus = renderApIntro;
$('#apIntro').onchange = (e) => localStorage.setItem('vm_ap_intro', e.target.value);
$('#apEnd').value = localStorage.getItem('vm_ap_end') || '30';
$('#apEnd').onchange = (e) => localStorage.setItem('vm_ap_end', e.target.value);
setTimeout(() => (KIOSK || localStorage.getItem('vm_autopilot') === '1') && isHost && !EDIT_ONLY && setAutopilot(true, true), 1500);
// ------------------------------------------------------------------ kiosk ---
// /kiosk starts a show and opens it here with ?kiosk=1: the program, the cameras, the join
// code (the beacon, beside them), what's coming in and going out, and two big buttons. The
// autopilot runs it. Nothing pops up and nothing downloads. Delete show deletes it now
// (phones keep what they recorded); a show left alone deletes itself after 12 hours, and
// this screen goes back to the start once nobody's been here for half an hour.
if (KIOSK && eventId) { // (with no show yet, the launcher is still finding one)
  document.body.classList.add('kiosk');
  document.documentElement.dataset.theme = 'dark'; // (a sign: dark, whatever this browser chose before)
  let ran = false, endedAt = 0, rolling = false, lastTitle = '';
  // its own join code, moving like the beacon's (the time in it syncs the phones)
  const qr = $('#kQr');
  $('#kHost').textContent = `${location.host}/cam`;
  $('#kCode').textContent = eventId;
  let qrLast = 0;
  (function drawCode() {
    const t = now();
    if (t - qrLast >= 1000 / 15) {
      qrLast = t;
      drawQR(qr, timecodeUrl(eventId, t), { size: 720 });
    }
    requestAnimationFrame(drawCode);
  })();
  const setTitle = (e) => {
    if (!e) return; // (the event is still loading)
    const named = !e.kiosk || e.titled !== false;
    $('#kCall').textContent = named ? 'Scan to join' : 'Scan to start a show';
    $('#kTitle').textContent = named ? e.title : 'The first to scan names it';
    if (named && e.title !== lastTitle) {
      lastTitle = e.title;
      if (ev) ev.title = e.title;
      $('#title').textContent = e.title;
      document.title = `${e.title} · VUEMesh`;
      if (lastTitle) note(`The show is called \u201c${e.title}\u201d`);
    }
  };
  setTitle(ev);
  // the show's name comes from the first phone; a show that's gone (12 hours) makes way for a new one
  setInterval(async () => {
    try {
      setTitle(await api(`events/${eventId}`));
    } catch (e) {
      if (/404|No event/.test(e.message)) nextShow('the show expired');
    }
  }, 4000);
  // When a show has ended (everyone gone, faded out, recording stopped) and nothing is still
  // going out or coming in, the screen thanks them and starts a fresh show with a new code.
  // The old one is deleted (phones keep what they recorded).
  async function nextShow(why) {
    if (rolling) return;
    rolling = true;
    note(`Kiosk: starting a new show (${why})`);
    try {
      const fresh = await api('events', { method: 'POST', body: { kiosk: true, orientation: ev?.orientation || 'landscape' } });
      localStorage.setItem('vm_kiosk', JSON.stringify({ id: fresh.id, hostKey: fresh.hostKey, at: Date.now() }));
      await api(`events/${eventId}`, { method: 'DELETE', host: key }).catch(() => {});
      await idb.wipe(eventId).catch(() => {});
      for (const k of Object.keys(localStorage)) if (k.includes(eventId)) localStorage.removeItem(k);
      setLeaveQuietly(true);
      location.replace(KIOSK_PAGE ? `/kiosk?e=${fresh.id}#k=${fresh.hostKey}` : `/studio?e=${fresh.id}&kiosk=1#k=${fresh.hostKey}`);
    } catch (e) {
      rolling = false;
      note(`Kiosk: couldn't start a new show yet (${e.message}); trying again`);
    }
  }
  setInterval(() => {
    // (phones: the kiosk's own cameras don't keep a show going, or count as people here)
    const cams = camOrder().filter((p) => !live.get(p)?.local).length, clipsIn = clips.filter((c) => !c.program && !c.reel && !c.local).length, busy = incoming.size + outgoing.size;
    if (ap.state === 'running') {
      ran = true;
      endedAt = 0;
    }
    if (ran && ap.state === 'idle' && !cams && !progRec) endedAt ||= Date.now();
    if (cams) endedAt = 0;
    $('#kCams').textContent = cams;
    $('#kClips').textContent = clipsIn;
    $('#kXfer').textContent = busy;
    document.body.classList.toggle('onair', ap.state === 'running');
    const recFor = progRec?.startedAt ? Math.floor((Date.now() - progRec.startedAt) / 1000) : 0;
    const st = $('#kState');
    st.classList.toggle('on', ap.state === 'running');
    st.textContent = ap.counting ? 'Here we go\u2026' : ap.state === 'idle' && ap.starter && live.has(ap.starter) ? `${live.get(ap.starter).name}: tap Go live on your phone to start` : ap.state === 'running' ? `\u25cf On air \u00b7 recording ${Math.floor(recFor / 60)}:${String(recFor % 60).padStart(2, '0')}`
      : ap.state === 'ending' ? 'That\u2019s a wrap\u2026'
      : endedAt ? (busy ? `Thanks! Finishing ${busy} transfer${busy > 1 ? 's' : ''}, then a new show starts` : 'Thanks! A new show starts in a moment')
      : 'Waiting for cameras';
    // a new show: once this one's over and its transfers are done (or after 3 minutes regardless)
    if (endedAt && ((!busy && Date.now() - endedAt > 15000) || Date.now() - endedAt > 180000)) nextShow('the last show ended');
  }, 1000);
  // hands-free: nothing to press; no pointer, no menus
  let idleT = null;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  ['pointermove', 'pointerdown'].forEach((t) => addEventListener(t, wake));
  addEventListener('contextmenu', (e) => e.preventDefault(), true);
  wake();
  navigator.wakeLock?.request('screen').catch(() => {});
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && navigator.wakeLock?.request('screen').catch(() => {}));
}

window.vmAutopilot = () => ({ on: ap.on, state: ap.state, seen: ap.seen.size, welcomed: ap.welcomed || [], recording: !!progRec, black: black.target === 1, auto: autoOn, pvw, liveActive }); // (tests and diagnostics)

export function toggleProgramRecording() {
  if (!isHost) return;
  if (progRec) {
    // the cameras hear at once that the show's no longer being recorded (saving it can take a while)
    progRec.stopping = true;
    recOnAirChanged();
    return progRec.stop();
  }
  mixInit();
  player.ctx.resume();
  const tracks = [programVideoTrack(), ...mix.dest.stream.getAudioTracks()];
  const startedAt = now();
  const saved = (blob) => {
    addUsage('liveCutSec', (Date.now() - (rec.startedAt || Date.now())) / 1000);
    setProgRec(null);
    renderOutput();
    recOnAirChanged();
    setTimeout(() => tracks[0].stop(), 3000); // (its own copy, once the last live-cut part is done: the program picture goes on for everything else)
    $('#recProgBtn').setAttribute('aria-pressed', 'false');
    if (!blob?.size) {
      note('Program recording: nothing was recorded');
      return;
    }
    const mime = blob.type || rec.mimeType;
    if (!KIOSK && !ap?.handsFree) download(blob, `${ev.title}-live`); // (hands-free: it's kept here and in Media, no download)
    // ...and keep a copy in this browser too
    idb.put('program', { eventId, id: 'master-' + Math.round(startedAt), kind: 'master', t0: startedAt, t1: now(), mime, blob }).catch(() => {});
    // ...and in Edit's Media, on the cameras' clock: everything that aired, to use by hand
    const pmeta = { id: 'PGM-' + Math.round(startedAt), kind: 'video', mime, cid: 'PGM', name: 'Program (as aired)', t0: startedAt - LIVE_DELAY, dur: Math.round(now() - startedAt), w: program.width, h: program.height, local: true, program: true, t0Source: 'studio', native: true, audio: 'stereo', orient: [{ t: 0, rot: 0, rect: null, upright: program.width >= program.height ? 'landscape' : 'portrait', ev: 0, ct: 0 }] };
    idb.put('clips', { eventId, ...pmeta, receivedAt: Date.now(), blob }).then(() => addClip({ eventId, ...pmeta, receivedAt: Date.now() }, blob, true)).catch(() => {});
    flushRecordings('Record program ended');
    stopPieces();
    note(`Program recording saved (downloaded, and kept in this browser)${rec.steady ? `: ${rec.steady}` : ''}`);
    announce('Program recording saved');
    if (!KIOSK && !ap?.handsFree) showWrap();
  };
  const rec = startProgramRecorder(tracks, saved);
  startPieces(tracks);
  setProgRec(rec);
  renderOutput();
  rec.startedAt = Date.now();
  recOnAirChanged();
  $('#recProgBtn').setAttribute('aria-pressed', 'true');
  note('Program recording started');
  toast('Recording the program to this device');
  announce('Recording the program');
}

// The recorder behind Record program: a steady-rate MP4 where the browser can (progrec.js),
// otherwise the browser's own recorder. It starts at once and works out which while it goes.
// Either way it's { stop(), stopping, startedAt, mimeType }, and calls saved(file) at the end.
function startProgramRecorder(tracks, saved) {
  const rec = { stopping: false, mimeType: 'video/mp4', steady: null, stats: () => cfr?.stats() || null };
  let cfr = null, mr = null, asked = false, finished = false;
  const sink = (n) => cfr?.frame(n);
  const finishSteady = async () => {
    if (finished) return;
    finished = true;
    frameSinks.delete(sink);
    const st = cfr.stats();
    let file = null;
    try {
      file = await cfr.stop();
    } catch (e) {
      note(`Program recording: the file couldn't be finished (${e?.message || e})`);
    }
    rec.steady = `${st.frames} frames at a steady ${output.fps} a second${st.dropped ? `, ${st.dropped} skipped (the computer was too busy)` : ''}`;
    saved(file);
  };
  const startBrowserRecorder = () => {
    mr = new MediaRecorder(new MediaStream(tracks), { mimeType: recMime(), videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => saved(new Blob(chunks, { type: mr.mimeType }));
    mr.start(1000);
    rec.mimeType = mr.mimeType;
    if (asked) mr.stop();
  };
  rec.stop = () => {
    asked = true;
    if (cfr) finishSteady();
    else if (mr && mr.state !== 'inactive') mr.stop();
    // (still starting: it stops as soon as it has)
  };
  (async () => {
    const support = await programRecorderSupport(program.width, program.height, output.fps);
    if (support && !asked) {
      const r = new ProgramRecorder({
        canvas: program, audioTrack: tracks[1], fps: output.fps, support, sampleRate: player.ctx.sampleRate,
        name: `${eventId}-${Math.round(Date.now())}.mp4`,
        onError: (e) => {
          note(`Program recording stopped: the encoder failed (${e?.message || e}); what was recorded is saved`);
          toast('Record program stopped (the encoder failed): what was recorded is saved', 8000);
          rec.stopping = true;
          recOnAirChanged();
          finishSteady();
        },
      });
      try {
        await r.start();
        cfr = r;
        frameSinks.add(sink);
        note(`Recording the program at a steady ${output.fps} frames a second, ${program.width}x${program.height} (${support.video.label}, ${support.audio.label}, MP4)`);
        if (asked) finishSteady();
        return;
      } catch (e) {
        note(`Steady-rate recording couldn't start (${e?.message || e}): using the browser's recorder`);
      }
    }
    startBrowserRecorder();
  })();
  return rec;
}
if (!EDIT_ONLY) setTimeout(() => tidyProgramRecordings(), 20_000); // (yesterday's recordings, from this browser's file storage)
// by hand: it downloads and shows the wrap-up as usual (only hands-free shows skip those)
export const recByHand = () => {
  ap.handsFree = false;
  toggleProgramRecording();
};
$('#recProgBtn').onclick = recByHand;
