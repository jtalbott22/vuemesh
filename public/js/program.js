// Program out: a clean feed for a TV, projector, or OBS window capture. The studio that
// opened this window hands over its program picture and sound directly (same browser,
// same computer); nothing goes over the network.
const video = document.querySelector('#out');
let current = null, sig = '';
// What this window shows: the live program (the studio that opened it), or the edit as it
// plays in the Edit window (which the studio opened too). Remembered.
let source = localStorage.getItem('vm_progout_src') === 'edit' ? 'edit' : 'live';
const studio = () => (window.opener && !window.opener.closed ? window.opener : null);
// The Edit window runs in its own browser process, so its picture and sound come over a WebRTC
// connection on this computer, set up over a channel; nothing leaves the computer.
const eventId = (() => {
  try {
    return window.opener?.vmEventId || null;
  } catch {
    return null;
  }
})() || new URLSearchParams(location.search).get('e');
const pch = eventId && typeof BroadcastChannel === 'function' ? new BroadcastChannel('vm-progout-' + eventId) : null;
let pc = null, editStream = null, session = null, asked = 0;
if (pch) pch.onmessage = async (e) => {
  const m = e.data || {};
  if (!pc || m.id !== session) return;
  if (m.t === 'offer') {
    await pc.setRemoteDescription(m.sdp);
    await pc.setLocalDescription(await pc.createAnswer());
    pch.postMessage({ t: 'answer', id: session, sdp: pc.localDescription.toJSON() });
  } else if (m.t === 'ice' && m.from === 'edit') pc.addIceCandidate(m.cand).catch(() => {});
};
function dropEdit() {
  if (pc) {
    pch?.postMessage({ t: 'bye', id: session });
    pc.close();
  }
  pc = editStream = session = null;
}
function askEdit() {
  dropEdit();
  session = Math.random().toString(36).slice(2);
  asked = Date.now();
  pc = new RTCPeerConnection({ iceServers: [] });
  editStream = new MediaStream();
  pc.ontrack = (ev) => editStream.addTrack(ev.track);
  pc.onicecandidate = (ev) => ev.candidate && pch.postMessage({ t: 'ice', id: session, from: 'out', cand: ev.candidate.toJSON() });
  pch.postMessage({ t: 'want', id: session });
}
function editFeed() {
  if (!pch) return null;
  const live = editStream?.getVideoTracks().some((t) => t.readyState === 'live');
  const dead = !pc || ['failed', 'closed', 'disconnected'].includes(pc.connectionState);
  // (no Edit window yet, or it went away: ask again every few seconds)
  if (dead || (!live && Date.now() - asked > 3000)) askEdit();
  return live ? editStream : null;
}
addEventListener('pagehide', dropEdit);

function feed() {
  try {
    return source === 'edit' ? editFeed() : studio()?.vmProgramFeed?.() || null;
  } catch {
    return null;
  }
}
function setSource(s) {
  source = s;
  if (s !== 'edit') dropEdit();
  localStorage.setItem('vm_progout_src', s);
  document.querySelectorAll('[data-src]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.src === s)));
  document.body.classList.toggle('edit', s === 'edit');
  document.querySelector('#srcTag').textContent = s === 'edit' ? 'EDIT' : 'PROGRAM';
  current = null;
  attach();
}
document.querySelectorAll('[data-src]').forEach((b) => (b.onclick = () => setSource(b.dataset.src)));

function attach() {
  const s = feed();
  const nsig = s ? s.getTracks().map((t) => t.id).join(',') : '';
  if (s && (s !== current || nsig !== sig)) {
    current = s;
    sig = nsig;
    video.srcObject = s;
    video.play().catch(() => {});
  }
  document.querySelector('#wait').hidden = !!s;
  if (!s) video.srcObject = null;
  if (!s) document.querySelector('#waitText').innerHTML = source === 'edit' && studio() ? 'Waiting for the edit. Open <strong>Edit ↗</strong> in the studio, and play the edit there: this window shows it, with its sound. Or switch to <strong>Live</strong> below.' : 'Waiting for the studio. Open <strong>Program out</strong> from the VUEMesh studio in this same browser; this window shows exactly what the program shows, with its sound.';
  try {
    document.title = `${source === 'edit' ? 'Edit out' : 'Program out'} — ${window.opener?.document?.title?.replace(/ — studio$/, '') || 'VUEMesh'}`;
  } catch {}
}
setSource(source);
setInterval(attach, 1000);

// This window is visible even when it covers the studio, so it keeps the studio drawing:
// browsers pause a covered window's animation frames, which would freeze the program.
(function pump() {
  try {
    window.opener?.vmPump?.(); // (the Edit window keeps itself drawing while this shows it)
  } catch {}
  requestAnimationFrame(pump);
})();

// Browsers start a new window muted; one click turns the sound on.
const sound = document.querySelector('#sound');
sound.onclick = () => {
  video.muted = !video.muted;
  if (!video.muted) video.play().catch(() => {});
  sound.setAttribute('aria-pressed', String(!video.muted));
  sound.textContent = video.muted ? 'Sound off' : 'Sound on';
};
const toggleFs = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
document.querySelector('#fs').onclick = toggleFs;
// One click anywhere on the picture fills the screen (browsers only allow it after a click);
// Esc, F or the button come back out.
video.onclick = () => !document.fullscreenElement && toggleFs();
document.addEventListener('fullscreenchange', () => {
  const on = !!document.fullscreenElement;
  document.body.classList.toggle('full', on);
  document.querySelector('#fs').textContent = on ? 'Exit full screen' : 'Full screen';
});
document.documentElement.requestFullscreen?.().catch(() => {}); // (in case this browser allows it straight away)
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFs();
  if (e.key === 'm' || e.key === 'M') sound.click();
});

// Controls fade away so the picture is clean; move the mouse to bring them back.
let idle;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 2500);
};
['mousemove', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, wake));
wake();
