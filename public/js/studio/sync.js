// Studio, part 21 of 29: optical sync and lining clips up by sound.
// Loads after library.js: that import comes first, so the parts run in order (see ../studio.js).
import './library.js';
import { toast, decodeQR, parseTimecode } from '/js/vm.js';
import { offsetBetween, hasSound } from '/js/audiosync.js';
import { $, FRAME, blobs, clips, eventId, note, rawBlobs, seq } from './core.js';
import { clipOf, commit, rebuild, saveClipFields, snapshot, videoClips } from './clips.js';
import { fmtClock } from './library.js';

// ---------------------------------------------------------- optical sync ----

// Every phone syncs once, when it scans the beacon, and keeps that lock: each clip it sends
// is already placed on the beacon's clock (and says when the lock was read). So Auto-sync
// checks that every clip is locked, fine-tunes any that happen to have the beacon in shot,
// and names the phones that never synced (those clips are placed by the phone's own clock).
export const syncState = (c) => (c.t0Source === 'optical' ? 'optical' : c.t0Source === 'audio' ? 'audio' : c.t0Source === 'phone' || c.t0Source === 'studio' ? 'locked' : 'clock');
export function syncLabel(c) {
  const s = syncState(c);
  if (s === 'optical') return 'Locked to the QR Beacon, fine-tuned from the QR Beacon in shot';
  if (s === 'audio') return `Locked to the QR Beacon, then lined up by sound with ${clipOf(c.syncRef)?.name || 'another clip'}`;
  if (s === 'locked') return c.t0Source === 'studio' ? 'On the studio\u2019s own clock (recorded on this computer)' : c.sync?.at ? `Locked to the QR Beacon (read at ${fmtClock(c.sync.at)})` : 'Locked to the QR Beacon by the phone';
  return "Not synced: placed by the phone's own clock";
}
$('#syncBtn').onclick = async () => {
  const all = videoClips();
  if (!all.length) return toast('No clips yet.');
  const list = all.filter((c) => c.syncHints?.length && c.t0Source !== 'optical');
  $('#syncBtn').disabled = true;
  let fixed = 0;
  for (const [i, c] of list.entries()) {
    $('#syncBtn').textContent = `Syncing ${i + 1}/${list.length}`;
    try {
      const t0 = await opticalT0(c);
      if (t0 !== null) {
        await saveClipFields(c.id, { t0, t0Source: 'optical' });
        fixed++;
      }
    } catch (e) {
      console.warn('sync failed', c.id, e);
    }
  }
  if (seq.auto) rebuild(false);
  commit();
  // then every clip that shares sound with one already lined up gets lined up by it
  const sound = await alignBySound((i, n) => ($('#syncBtn').textContent = `Listening ${i}/${n}`)).catch((e) => (console.warn('sound sync', e), { moves: [], lined: 0 }));
  if (sound.moves.length) {
    snapshot();
    if (seq.auto) rebuild(false);
    else shiftItemsBy(sound.moves);
    commit();
  }
  $('#syncBtn').textContent = 'Auto-sync';
  $('#syncBtn').disabled = false;
  const all2 = clips.filter((c) => c.t0Source && !c.program && !c.reel);
  const loose = all2.filter((c) => syncState(c) === 'clock');
  const who = [...new Set(loose.map((c) => c.name))];
  const how = [fixed && `${fixed} fine-tuned from the QR Beacon in shot`, sound.lined && `${sound.lined} lined up by sound${sound.moves.length ? `, ${sound.moves.length} of them moved` : ''}`].filter(Boolean).join('; ');
  const msg = `${all2.length - loose.length} of ${all2.length} clip${all2.length === 1 ? ' is' : 's are'} locked to the QR Beacon${how ? ` (${how})` : ''}.` +
    (loose.length ? ` ${loose.length} ${loose.length === 1 ? "isn't" : "aren't"}: ${who.join(', ')} hadn't synced, so ${loose.length === 1 ? 'it is' : 'those are'} placed by the phone's own clock.` : ' Nothing to fix.');
  toast(msg, 8000);
  note(`Auto-sync: ${msg}`);
};

// ---- lining clips up by their sound --------------------------------------------------------
// The beacon puts every clip within a few hundred milliseconds (phones start recording at
// slightly different speeds; a microphone-only recorder starts faster than a camera's).
// Clips that overlap share sound, so each is cross-correlated with one already lined up and
// moved by the difference. It starts from what's most trustworthy: clips with the beacon in
// shot, then a beacon-synced microphone, then the longest beacon-synced clip.
const SYNC_SR = 8000;
async function pcmOf(c, cache) {
  if (cache.has(c.id)) return cache.get(c.id);
  let out = null;
  const blob = rawBlobs.get(c.id);
  if (blob) {
    try {
      const buf = await new OfflineAudioContext(1, 1, SYNC_SR).decodeAudioData(await blob.arrayBuffer());
      out = new Float32Array(buf.length);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) out[i] += d[i];
      }
    } catch {}
  }
  cache.set(c.id, out);
  return out;
}
async function soundOffset(ref, c, cache) {
  const a0 = Math.max(ref.t0, c.t0), a1 = Math.min(ref.t0 + ref.dur, c.t0 + c.dur);
  if (a1 - a0 < 4000) return null;
  const win = Math.min(20000, a1 - a0 - 500), w0 = (a0 + a1) / 2 - win / 2;
  const pa = await pcmOf(ref, cache), pb = await pcmOf(c, cache);
  if (!pa || !pb) return null;
  const n = Math.round((win / 1000) * SYNC_SR);
  const cut = (pcm, clip) => {
    const s = Math.max(0, Math.round(((w0 - clip.t0 + (clip.inBase || 0)) / 1000) * SYNC_SR));
    return pcm.subarray(s, s + n);
  };
  const A = cut(pa, ref), B = cut(pb, c);
  if (Math.min(A.length, B.length) < SYNC_SR * 3 || !hasSound(A) || !hasSound(B)) return null;
  const m = Math.min(A.length, B.length);
  const wide = c.t0Source === 'clock' || ref.t0Source === 'clock';
  const r = offsetBetween(A.subarray(0, m), B.subarray(0, m), Math.round((wide ? 8 : 2) * SYNC_SR));
  return r.score >= 8 && r.clarity >= 1.4 ? { shift: (r.lag / SYNC_SR) * 1000, score: r.score } : null;
}
async function alignBySound(onStep) {
  const cands = clips.filter((c) => c.t0Source && !c.program && !c.reel && (c.dur || 0) >= 4000 && rawBlobs.has(c.id));
  if (cands.length < 2) return { moves: [], lined: 0 };
  const tier = (c) => (c.t0Source === 'optical' ? 0 : c.kind === 'audio' && c.t0Source !== 'clock' ? 1 : c.t0Source !== 'clock' ? 2 : 3);
  const done = new Set(cands.filter((c) => c.t0Source === 'optical').map((c) => c.id));
  if (!done.size) done.add(cands.slice().sort((a, b) => tier(a) - tier(b) || b.dur - a.dur)[0].id);
  const queue = [...done], tries = new Map(), moves = [], cache = new Map();
  let lined = 0;
  while (queue.length) {
    const ref = clipOf(queue.shift());
    for (const c0 of cands) {
      if (done.has(c0.id)) continue;
      const c = clipOf(c0.id);
      if (c.t0 + c.dur <= ref.t0 || c.t0 >= ref.t0 + ref.dur || (tries.get(c.id) || 0) >= 3) continue;
      tries.set(c.id, (tries.get(c.id) || 0) + 1);
      onStep?.(done.size, cands.length);
      await new Promise((r) => setTimeout(r));
      const r = await soundOffset(ref, c, cache);
      if (!r) continue;
      done.add(c.id);
      queue.push(c.id);
      lined++;
      if (Math.abs(r.shift) >= 1) moves.push({ id: c.id, shift: r.shift });
      await saveClipFields(c.id, { t0: Math.round(c.t0 + r.shift), t0Source: 'audio', syncRef: ref.id, syncScore: Math.round(r.score) });
      note(`Lined up ${c.name}'s ${c.kind === 'audio' ? 'sound' : 'clip'} by sound with ${ref.name}: moved ${Math.round(r.shift)} ms`);
    }
  }
  cache.clear();
  return { moves, lined };
}
/** In an edit you've cut yourself, keep each moved clip's pieces showing the same moments. */
function shiftItemsBy(moves) {
  for (const tr of seq.tracks) {
    for (const it of tr.items) {
      const m = it.type === 'clip' && moves.find((x) => x.id === it.src);
      if (!m) continue;
      const sp = it.speed || 1, c = clipOf(it.src);
      let ni = (it.in || 0) - m.shift;
      if (ni < 0) {
        it.start += -ni / sp;
        it.dur = Math.max(FRAME, it.dur + ni / sp);
        ni = 0;
      }
      it.in = Math.round(ni);
      if (c?.dur) it.dur = Math.max(FRAME, Math.min(it.dur, (c.dur + (c.inBase || 0) - it.in) / sp));
    }
  }
}

async function opticalT0(clip) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = blobs.get(clip.id);
  Object.assign(v.style, { position: 'fixed', left: '0', bottom: '0', width: '160px', opacity: '0.01', pointerEvents: 'none' });
  document.body.append(v);
  const samples = [];
  try {
    await once(v, 'loadedmetadata');
    const cv = document.createElement('canvas');
    const grab = async (mediaTime) => {
      cv.width = 640;
      cv.height = Math.round((v.videoHeight / v.videoWidth) * 640) || 360;
      cv.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, cv.width, cv.height);
      const tc = parseTimecode(await decodeQR(cv));
      if (tc && tc.e === eventId) samples.push(tc.t - mediaTime * 1000);
    };
    for (const h of clip.syncHints) {
      const from = Math.max(0, h - 1.5);
      const to = h + 2;
      v.currentTime = from;
      await once(v, 'seeked');
      if ('requestVideoFrameCallback' in v) {
        await new Promise((resolve) => {
          let stop = false;
          const finish = () => {
            if (stop) return;
            stop = true;
            v.pause();
            resolve();
          };
          const onFrame = async (_n, meta) => {
            if (stop) return;
            await grab(meta.mediaTime);
            if (meta.mediaTime >= to || v.ended || samples.length >= 16) return finish();
            v.requestVideoFrameCallback(onFrame);
          };
          v.requestVideoFrameCallback(onFrame);
          v.play().catch(finish);
          setTimeout(finish, 7000);
        });
      } else {
        for (let t = from; t < to; t += 1 / 15) {
          v.currentTime = t;
          await once(v, 'seeked');
          await grab(v.currentTime);
        }
      }
    }
  } finally {
    v.remove();
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)];
  return Math.max(...samples.filter((s) => Math.abs(s - med) < 150));
}

function once(el, name) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('Video failed to load')); };
    const cleanup = () => { el.removeEventListener(name, ok); el.removeEventListener('error', bad); };
    el.addEventListener(name, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}
