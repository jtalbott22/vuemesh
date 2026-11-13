// Studio, part 22 of 29: render and export, wrap.
// Loads after sync.js: that import comes first, so the parts run in order (see ../studio.js).
import './sync.js';
import { api, toast, fmtDur } from '/js/vm.js';
import * as S from '/js/sequence.js';
import { renderSequence, RenderError } from '/js/render.js';
import { BRAND, FEATURES } from '/js/brand.js';
import { $, clips, ev, eventId, fit, key, note, player, program, rawBlobs, recMime, seq } from './core.js';
import { angleNo, clipOf, output, viewOf } from './clips.js';
import { reel } from './graphics.js';
import { credits, soundCredits } from './edit.js';

// ------------------------------------------------------ render and export ----

export function download(blob, base) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base.replace(/[^\w-]+/g, '-')}.${blob.type.includes('vtt') ? 'vtt' : blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

export let rendering = null;
const HINTS = {
  setup: 'This browser can’t write video files. Chrome or Edge on a computer can; Real-time export works everywhere.',
  'video-encode': 'The computer’s video encoder stopped. Try again (VUEMesh will pick another format), or use Real-time export.',
  'audio-encode': 'The audio encoder stopped. Real-time export will still work.',
  decode: 'One clip couldn’t be read. Its file may be damaged or in a format this browser can’t open. Real-time export may still play it.',
};
$('#renderBtn').onclick = () => runRender({});
export async function runRender({ s: renderSeq = seq, name = ev.title, wrapUp = true }) {
  if (renderSeq === seq && seq.range) {
    // only In to Out
    renderSeq = S.sliceRange(seq, seq.range.in, seq.range.out);
    name = `${name} (${fmtDur(seq.range.in).slice(0, -3).replace(/:/g, '.')}–${fmtDur(seq.range.out).slice(0, -3).replace(/:/g, '.')})`;
  }
  if (!S.end(renderSeq)) return toast('Nothing on the timeline yet');
  const [W, H] = [program.width, program.height];
  const dlg = $('#renderDlg');
  const ctrl = new AbortController();
  rendering = ctrl;
  $('#renderErr').hidden = true;
  $('#renderRealtime').hidden = true;
  $('#renderCopy').hidden = true;
  $('#renderCancel').textContent = 'Cancel';
  $('#renderCancel').onclick = () => (rendering ? ctrl.abort() : dlg.close());
  $('#renderText').textContent = 'Checking what this computer can encode…';
  $('#renderBar').value = 0;
  $('#renderFine').textContent = '';
  dlg.showModal();
  player.pause();
  const t0 = performance.now();
  let report = null;
  const describe = (r) => {
    if (!r) return '';
    const fast = r.sources.filter((x) => x.path === 'fast').length;
    const slow = r.sources.filter((x) => x.path !== 'fast');
    return `${r.video} video, ${r.audio} audio, ${W}×${H}.` +
      (r.sources.length ? ` ${fast} clip${fast === 1 ? '' : 's'} on the fast path` : '') +
      (slow.length ? `, ${slow.length} in compatibility mode (slower): ${slow.map((x) => `${x.clip}${x.why ? ` — ${x.why}` : ''}`).join('; ')}` : '') +
      (r.silent ? `. ${r.silent} recording(s) had no readable sound.` : '') +
      (r.unreadable?.length ? `. Couldn't read ${r.unreadable.join(', ')}: those moments show the layer below (or black).` : '');
  };
  try {
    let stream = null;
    if (S.end(renderSeq) > 20 * 60 * 1000 && window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: `${name.replace(/[^\w-]+/g, '-')}.mp4`, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      stream = await handle.createWritable();
    }
    const out = await renderSequence({
      seq: renderSeq, width: W, height: H, fps: output.fps, fit, title: ev.title,
      blobFor: (id) => rawBlobs.get(id),
      audioOf: (id) => clipOf(id)?.audio,
      nameOf: (id) => {
        const c = clipOf(id);
        return c ? `${c.name} (angle ${angleNo(id) || '?'})` : id;
      },
      imageFor: (asset) => reel.find((r) => r.id === asset)?.el || null,
      viewOf: (item, ms) => viewOf(item, ms),
      signal: ctrl.signal,
      stream,
      onReport: (r) => {
        report = r;
        $('#renderFine').textContent = describe(r);
      },
      onProgress: ({ phase, done, total }) => {
        const pct = phase === 'audio' ? (done / total) * 10 : 10 + (done / total) * 90;
        $('#renderBar').value = pct;
        const secs = (performance.now() - t0) / 1000;
        $('#renderText').textContent = phase === 'audio' ? 'Mixing sound…' : `Rendering picture · ${Math.round(pct)}% · ${(((done / 30) || 0) / Math.max(secs, 0.1)).toFixed(1)}× real time`;
      },
    });
    rendering = null;
    dlg.close();
    const took = ((performance.now() - t0) / 1000).toFixed(1);
    note(`Rendered ${name}: ${fmtDur(S.end(renderSeq)).slice(0, -3)} in ${took}s · ${describe(out.report)}`);
    if (out.blob) download(out.blob, name);
    if (renderSeq === seq && !seq.range) lastRender = { blob: out.blob, at: Date.now() };
    toast(out.report?.unreadable?.length ? `Rendered in ${took} s, but ${out.report.unreadable.length} clip(s) couldn't be read — see the event log` : `Rendered in ${took} s`, 6000);
    if (wrapUp) showWrap();
  } catch (e) {
    rendering = null;
    if (e.name === 'AbortError') return dlg.close();
    // Keep the dialog open and say exactly what went wrong.
    const stage = e instanceof RenderError ? e.stage : 'unknown';
    $('#renderText').textContent = 'The render stopped.';
    $('#renderErrText').textContent = e.message;
    $('#renderErrHint').textContent = HINTS[stage] || 'Real-time export will still make a file.';
    $('#renderErr').hidden = false;
    $('#renderRealtime').hidden = false;
    $('#renderCopy').hidden = false;
    $('#renderCancel').textContent = 'Close';
    const details = JSON.stringify({ stage, message: e.message, detail: e.detail || null, report, browser: navigator.userAgent, size: `${W}x${H}` }, null, 2);
    $('#renderCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(details);
        toast('Details copied');
      } catch {
        toast('Couldn’t copy; the details are in the event log');
      }
    };
    $('#renderRealtime').onclick = () => {
      dlg.close();
      $('#exportBtn').click();
    };
    note(`Render failed (${stage}): ${e.message}`);
    console.error('render failed', e, details);
  }
}
let lastRender = null;

// Real time: works in every browser that can record, at the cost of waiting the whole length.
export let exporting = null;
$('#exportBtn').onclick = async () => {
  if (exporting) return exporting.stop();
  if (!S.end(seq)) return toast('Nothing on the timeline yet');
  const tracks = [...program.captureStream(Math.round(output.fps)).getVideoTracks(), ...player.audioStream().getAudioTracks()];
  const mime = recMime();
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  exporting = { stop() { if (rec.state !== 'inactive') rec.stop(); player.pause(); } };
  $('#exportBtn').textContent = 'Stop';
  player.pause();
  player.rate = 1;
  player.seek(0);
  toast('Recording in real time. Keep this tab in front.', 5000);
  await new Promise((r) => setTimeout(r, 800));
  rec.start(1000);
  player.play();
  await stopped;
  exporting = null;
  $('#exportBtn').textContent = 'Real-time export';
  download(new Blob(chunks, { type: rec.mimeType }), `${ev.title}`);
  showWrap();
};

// Publishing (off in the beta): upload the rendered film and a signed manifest.
$('#publishBtn').onclick = async () => {
  if (!FEATURES.publish) return;
  if (!lastRender?.blob) return toast('Render MP4 first, then publish');
  const btn = $('#publishBtn');
  btn.disabled = true;
  try {
    btn.textContent = 'Uploading…';
    const urls = await api(`events/${eventId}/publish`, { method: 'POST', host: key, body: { ext: 'mp4' } });
    const used = new Set();
    for (const tr of seq.tracks) for (const it of tr.items) if (it.type === 'clip') used.add(it.src);
    const manifest = {
      v: 2,
      event: { id: eventId, terms: ev.terms, termsHash: ev.termsHash, poolPct: ev.poolPct }, // (not the show's name: that stays on the devices)
      credits: credits(),
      sound: soundCredits()[0] || null,
      clips: clips.filter((c) => used.has(c.id)).map(({ id, cid, name, jwk, joinSig, root, sig, t0, dur, kind }) => ({ id, cid, name, jwk, joinSig, root, sig, t0, dur, kind: kind || 'video' })),
      publishedAt: new Date().toISOString(),
    };
    await putTo(urls.film.put, lastRender.blob, 'video/mp4');
    await putTo(urls.manifest.put, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'application/json');
    await api(`events/${eventId}/published`, { method: 'POST', host: key, body: { filmUrl: urls.film.url, manifestUrl: urls.manifest.url, title: 'Main cut' } });
    toast('Published', 3000);
    showWrap(true);
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish';
  }
};

async function putTo(url, blob, type) {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

// ------------------------------------------------------------------ wrap ----

const wrap = $('#wrap');
wrap.querySelector('[data-close]').onclick = () => wrap.close();
$('#wrapPatreon').href = BRAND.patreon;
export function showWrap(published = false) {
  const url = `${location.origin}/watch?e=${eventId}`;
  $('#wrapText').textContent = published ? 'Your film is published.' : 'Your film is saved to this device.';
  $('#wrapWatch').href = url;
  $('#wrapShare').hidden = !published;
  $('#wrapWatch').hidden = !published;
  $('#wrapShare').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: ev.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Watch link copied');
      }
    } catch {}
  };
  if (!wrap.open) wrap.showModal();
}
