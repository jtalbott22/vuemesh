// Studio, part 31 of 31: recording takes over the edit (overdubbing).
// Loads after song.js: that import comes first, so the parts run in order (see ../studio.js).
//
// One person, one part at a time: guitar, then voice while hearing the guitar, then harmonica…
// ● Record (in Edit's timeline bar) records a microphone on this computer from the playhead, while
// the edit plays in your headphones, with a count-in in song mode. When it stops, the take goes on
// a track of its own, "Guitar · take 2", lined up with what you heard: the timeline runs on the
// sound engine's clock while recording, the microphone is captured on that clock (the recording
// tap), and the delay there and back (the latency) is taken off. A new take of a part mutes its
// earlier ones; a stacked take (a double or a harmony) plays with them.
//
// Takes are recordings like any other: kept in this browser with the event's clips (IndexedDB),
// as WAV files, and played from memory to the sample (EditPlayer.bufferFor). The microphone chosen
// and the latency measured for it are kept in this browser too (vm_overdub).
import './song.js';
import { toast, now, announce } from '/js/vm.js';
import * as idb from '/js/idb.js';
import * as G from '/js/song.js';
import * as O from '/js/overdub.js';
import { $, player, seq, clips, rawBlobs, eventId, note } from './core.js';
import { addClip, commit, snapshot } from './clips.js';

const KEY = 'vm_overdub';
const box = $('#takeMenu');

// ---- takes play from memory, on the engine's clock ------------------------------------------
const bufs = new Map(); // clip id → AudioBuffer (or a promise while it decodes)
player.bufferFor = (id) => {
  const b = bufs.get(id);
  if (b instanceof AudioBuffer) return b;
  if (b) return null;
  const c = clips.find((x) => x.id === id);
  const blob = c?.take && rawBlobs.get(id);
  if (!blob) return null;
  bufs.set(id, blob.arrayBuffer().then((ab) => player.ctx.decodeAudioData(ab)).then((buf) => {
    bufs.set(id, buf);
    player.rescheduleBuffers();
  }, () => bufs.delete(id)));
  return null;
};

if (box) {
  const ui = {
    sum: $('#takeSum'), part: $('#takePart'), parts: $('#takeParts'), input: $('#takeInput'), level: $('#takeLevel'),
    stack: $('#takeStack'), count: $('#takeCount'), lat: $('#takeLat'), measure: $('#takeMeasure'), go: $('#takeGo'), note: $('#takeNote'),
  };
  const saved = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
  };
  const save = (patch) => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...saved(), ...patch })); } catch {}
  };

  // ---- the microphone: opened while this menu is open (for its level) or a take records -----
  let mic = null; // { stream, src, tap, sink, analyser, deviceId }
  let tapLoaded = null;
  async function openMic() {
    const want = ui.input.value || saved().input || '';
    // (nothing chosen: the one that's open will do)
    if (mic && (!want || mic.deviceId === want) && mic.stream.getAudioTracks()[0]?.readyState === 'live') return mic;
    closeMic();
    // as it is: no echo cancelling, noise suppression or level riding, which change an instrument's sound
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, ...(want ? { deviceId: { exact: want } } : {}) };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (e) {
      if (want && e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: undefined } });
      else throw e;
    }
    const ctx = player.ctx;
    tapLoaded ||= ctx.audioWorklet.addModule('/js/rectap-worklet.js');
    await tapLoaded;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);
    const deviceId = stream.getAudioTracks()[0]?.getSettings?.().deviceId || want;
    mic = { stream, src, analyser, sink, deviceId, tap: null };
    await listInputs();
    showLatency();
    return mic;
  }
  function closeMic() {
    if (!mic) return;
    stopTap();
    try { mic.src.disconnect(); mic.sink.disconnect(); } catch {}
    mic.stream.getTracks().forEach((t) => t.stop());
    mic = null;
    ui.level.style.width = '0';
  }
  /** Start capturing the microphone on the engine's clock: blocks of { frame, L, R }. */
  function startTap() {
    stopTap();
    const tap = new AudioWorkletNode(player.ctx, 'vm-rec-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'discrete' });
    const blocks = [];
    tap.port.onmessage = (e) => blocks.push(e.data);
    mic.src.connect(tap);
    tap.connect(mic.sink);
    mic.tap = tap;
    return blocks;
  }
  function stopTap() {
    if (!mic?.tap) return;
    mic.tap.port.postMessage('stop');
    try { mic.src.disconnect(mic.tap); mic.tap.disconnect(); } catch {}
    mic.tap = null;
  }

  async function listInputs() {
    const devs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'audioinput' && d.deviceId);
    const cur = mic?.deviceId || ui.input.value || saved().input || '';
    ui.input.innerHTML = devs.length
      ? devs.map((d, i) => `<option value="${d.deviceId.replace(/[<&>"]/g, '')}">${(d.label || `Microphone ${i + 1}`).replace(/[<&>"]/g, '')}</option>`).join('')
      : `<option value="">This computer's</option>`;
    if (devs.some((d) => d.deviceId === cur)) ui.input.value = cur;
  }

  // ---- latency: measured for each microphone, or the browser's own estimate -------------------
  function latencyMs() {
    const m = saved().lat?.[mic?.deviceId || ui.input.value];
    if (m != null) return { ms: m, measured: true };
    const ctx = player.ctx;
    const inLat = mic?.stream.getAudioTracks()[0]?.getSettings?.().latency || 0;
    return { ms: Math.round(((ctx.outputLatency || 0) + (ctx.baseLatency || 0) + inLat) * 1000), measured: false };
  }
  function showLatency() {
    const l = latencyMs();
    ui.lat.textContent = `${l.ms} ms${l.measured ? '' : ' (estimated)'}`;
    ui.lat.title = l.measured ? 'Measured for this microphone' : 'The browser’s estimate: Measure for the real figure';
  }
  ui.measure.onclick = async () => {
    if (rec) return;
    ui.measure.disabled = true;
    ui.measure.textContent = 'Listening…';
    try {
      await openMic();
      await player.ctx.resume();
      const ctx = player.ctx, sr = ctx.sampleRate;
      const blocks = startTap();
      // six clicks at uneven gaps, from half a second from now
      const c0 = ctx.currentTime + 0.5, times = O.MEASURE_AT.map((s) => c0 + s);
      const b = O.burst(sr);
      for (const at of times) player.soundAt(at, b);
      const last = times[times.length - 1];
      await new Promise((r) => setTimeout(r, (last - ctx.currentTime + 0.8) * 1000));
      stopTap();
      const F = Math.round((c0 - 0.2) * sr), N = Math.round((last - c0 + 0.8) * sr);
      const played = O.burstTrain(times.map((at) => Math.round(at * sr) - F), N, sr);
      const heard = O.cutTake(blocks, { c0: F / sr, t0: 0, sr, latencyMs: 0 }, 0, (N / sr) * 1000).channels[0];
      const m = O.measureLatency(played, heard, sr);
      if (!m.sure) {
        toast('Couldn’t hear the clicks clearly. Turn the sound up, hold the microphone near the speakers (or a headphone up to it), and try again.', 7000);
        return;
      }
      save({ lat: { ...(saved().lat || {}), [mic.deviceId]: m.ms } });
      showLatency();
      announce(`Delay measured: ${m.ms} milliseconds`);
      note(`Take latency measured for this microphone: ${m.ms} ms`);
    } catch (e) {
      toast(`Couldn’t measure: ${e.message}`);
    } finally {
      ui.measure.disabled = false;
      ui.measure.textContent = 'Measure';
    }
  };

  // ---- recording a take -------------------------------------------------------------------------
  let rec = null; // { part, from, startT, blocks, anchor, began, latency }
  ui.go.onclick = () => (rec ? stopTake() : startTake());

  async function startTake() {
    const part = ui.part.value.trim() || 'Take';
    try {
      await openMic();
    } catch (e) {
      return toast(e.name === 'NotAllowedError' ? 'The microphone wasn’t allowed: allow it in the browser’s address bar and try again.' : `Couldn’t open the microphone: ${e.message}`, 7000);
    }
    save({ input: mic.deviceId });
    const s = G.songOf(seq);
    const from = player.t;
    const countFrom = s.on ? G.countInStart(s, from) : from;
    player.pause();
    player.keepGoing = true;
    const blocks = startTap();
    rec = { part, from, startT: Math.max(0, countFrom), blocks, anchor: null, began: now(), latency: latencyMs().ms, stack: ui.stack.checked };
    player.play({ from: countFrom, countTo: s.on && s.countIn ? Math.max(from, countFrom + s.countIn * G.barMs(s)) : null });
    box.toggleAttribute('data-rec', true);
    box.open = false;
    showState();
    announce(`Recording ${part}${countFrom < from ? ', after the count-in' : ''}`);
  }

  async function stopTake(why) {
    const r = rec;
    if (!r) return;
    rec = null;
    const anchor = r.anchor || player.anchor;
    const stopT = player.t;
    player.pause();
    player.keepGoing = false;
    box.removeAttribute('data-rec');
    showState();
    // the last moment's sound is still on its way (the latency, and a part-filled block)
    await new Promise((res) => setTimeout(res, 300 + r.latency));
    stopTap();
    if (!box.open) closeMic();
    if (!anchor || stopT - r.from < 250) {
      if (why) toast(why);
      player.seek(r.from);
      return;
    }
    const sr = player.ctx.sampleRate;
    const take = O.cutTake(r.blocks, { c0: anchor.c, t0: anchor.t, sr, latencyMs: r.latency }, r.startT, stopT);
    const peak = O.peakOf(take.channels);
    const buf = player.ctx.createBuffer(take.channels.length, take.frames, sr);
    take.channels.forEach((ch, i) => buf.copyToChannel(ch, i));
    const blob = new Blob([O.encodeWav(take.channels, sr)], { type: 'audio/wav' });
    const n = Math.max(0, ...seq.tracks.filter((t) => t.take === r.part).map((t) => t.takeNo || 0)) + 1;
    const meta = {
      id: `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'audio', mime: 'audio/wav',
      cid: 'take', name: `${r.part} · take ${n}`, take: r.part, t0: r.began, dur: Math.round((take.frames / sr) * 1000), local: true,
      ...(take.channels.length > 1 ? { audio: 'stereo' } : {}),
    };
    const record = { eventId, ...meta, receivedAt: Date.now() };
    try {
      await idb.put('clips', { ...record, blob });
    } catch (e) {
      toast(`Couldn’t keep the take in this browser: ${e.message}. It's in the edit until the page closes; Export keeps a copy.`, 8000);
    }
    addClip(record, blob, false);
    bufs.set(meta.id, buf);
    snapshot();
    O.placeTake(seq, { part: r.part, src: meta.id, start: r.from, dur: stopT - r.from, in: r.from - r.startT, stack: r.stack });
    seq.auto = false; // (an edit made by hand now)
    commit();
    player.seek(r.from);
    listParts();
    note(`Recorded ${meta.name}: ${(meta.dur / 1000).toFixed(1)} s, ${r.latency} ms latency taken off, peak ${Math.round(peak * 100)}%`);
    if (peak >= 0.999) toast(`${meta.name} clipped (too loud): turn the microphone or instrument down and record again.`, 7000);
    else if (peak < 0.01) toast(`${meta.name} is nearly silent: is the right microphone chosen?`, 7000);
    else announce(`${meta.name} recorded`);
  }

  // the take follows the timeline: a seek or a change of speed while recording ends it
  player.on('tick', (t) => {
    if (!rec) return;
    if (!rec.anchor && player.anchor) rec.anchor = player.anchor;
    else if (rec.anchor && player.anchor !== rec.anchor) return void stopTake('The take stopped: the playhead moved.');
    if (!player.playing) return void stopTake();
    showState(t);
  });
  window.addEventListener('keydown', (e) => {
    if (rec && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopTake();
    }
  }, true);

  function showState(t = player.t) {
    if (rec) {
      const counting = player.countTo != null && t < player.countTo;
      ui.sum.textContent = counting ? `● ${Math.ceil((player.countTo - t) / G.beatMs(G.songOf(seq)))}…` : `■ Stop · ${rec.part} ${Math.max(0, Math.floor((t - rec.from) / 1000))} s`;
      ui.go.textContent = '■ Stop';
    } else {
      ui.sum.textContent = '● Record';
      ui.go.textContent = '● Record from the playhead';
    }
  }
  // the summary stops a take with one click, rather than opening the menu
  ui.sum.addEventListener('click', (e) => {
    if (!rec) return;
    e.preventDefault();
    stopTake();
  });

  function listParts() {
    const parts = O.partsOf(seq);
    ui.parts.innerHTML = [...new Set([...parts, 'Guitar', 'Voice', 'Harmony', 'Bass', 'Piano', 'Harmonica', 'Drums'])].map((p) => `<option value="${p.replace(/[<&>"]/g, '')}">`).join('');
  }

  // ---- the menu ---------------------------------------------------------------------------------
  ui.count.onchange = () => {
    snapshot();
    seq.song = { ...G.songOf(seq), countIn: +ui.count.value };
    commit();
  };
  ui.input.onchange = async () => {
    save({ input: ui.input.value });
    try { await openMic(); } catch (e) { toast(`Couldn’t open that microphone: ${e.message}`); }
  };
  box.addEventListener('toggle', async () => {
    if (!box.open) {
      if (!rec) closeMic();
      return;
    }
    const s = G.songOf(seq);
    ui.count.value = String(Math.min(2, s.countIn));
    ui.count.disabled = !s.on;
    ui.count.title = s.on ? '' : 'Turn on Song → Bars and beats for a count-in';
    listParts();
    showLatency();
    try {
      await openMic();
    } catch (e) {
      ui.note.textContent = e.name === 'NotAllowedError' ? 'Allow the microphone (in the address bar) to record.' : `No microphone: ${e.message}`;
    }
  });
  box.querySelector('.takebox').addEventListener('keydown', (e) => {
    e.stopPropagation(); // (Space and letters type here, not play the timeline)
    if (e.key === 'Escape') box.open = false;
  });

  // the input level, while the menu's open or a take records
  const lvl = new Float32Array(1024);
  (function meter() {
    if (mic && (box.open || rec)) {
      mic.analyser.getFloatTimeDomainData(lvl);
      let p = 0;
      for (const v of lvl) p = Math.max(p, Math.abs(v));
      ui.level.style.width = `${Math.min(100, Math.round(Math.sqrt(p) * 100))}%`;
      ui.level.parentElement.toggleAttribute('data-hot', p >= 0.98);
    }
    requestAnimationFrame(meter);
  })();
  showState();
}
