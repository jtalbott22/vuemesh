// Another computer's screen, into the studio as a source (/share?e=CODE): open it on the
// presenter's laptop, name it, share a screen, window or tab with the browser's own picker, and
// the studio has it as a source like a phone's camera (marked a screen, so picture-in-picture
// and the show log treat it as one). Its sound comes too when the browser shares it. It joins
// the way a phone does (the event's signalling, then a direct link to the studio) but sends
// only the live picture: nothing is recorded here, so there are no clips to send. The studio
// records it as it arrives while it's on air (see recordedHere in studio/sources.js), for Edit.
import { CamLink } from '/js/rtc.js';
import { api, identity, meshSocket, thumbprint } from '/js/vm.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
let eventId = (q.get('e') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let ev = null, sock = null, link = null, stream = null, cid = null, name = '', sendTimer = null;
const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
const isLinux = /Linux/.test(navigator.platform || '') && !/Android/.test(navigator.userAgent);
const canShare = !!navigator.mediaDevices?.getDisplayMedia;

const err = (t) => ($('#joinErr').textContent = t || '');
// What's on it: slides and text keep every word sharp (frames give way first); video and motion
// keep 30 frames a second (the size gives way first). Remembered on this computer.
const modeOf = () => document.querySelector('input[name="mode"]:checked')?.value === 'motion' ? 'motion' : 'detail';
try {
  const m = localStorage.getItem('vm_share_mode');
  if (m === 'motion' || m === 'detail') document.querySelector(`input[name="mode"][value="${m}"]`).checked = true;
} catch {}
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
  try { localStorage.setItem('vm_share_mode', modeOf()); } catch {}
  const v = stream?.getVideoTracks()[0];
  if (v && 'contentHint' in v) v.contentHint = modeOf();
  if (link) {
    link.motion = modeOf() === 'motion';
    link.applyQuality();
  }
}));
const show = (v) => {
  for (const id of ['joinView', 'liveView', 'stoppedView']) $('#' + id).hidden = id !== v;
};

// (the screen this runs on mustn't sleep while it's shared: a presenter may not touch it for an hour)
let lock = null;
async function wakeLock(on) {
  try {
    if (on && !lock) lock = await navigator.wakeLock?.request('screen');
    if (!on) {
      await lock?.release();
      lock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && stream && lock?.released !== false) {
    lock = null;
    wakeLock(true);
  }
});

function setup() {
  $('#name').value = localStorage.getItem('vm_share_name') || '';
  if (eventId) {
    $('#codeBox').hidden = true;
    $('#code').required = false;
    api(`events/${eventId}`).then((e) => {
      ev = e;
      $('#joinWhat').textContent = `Into ${e.title ? `“${e.title}”` : 'the studio'}, as a source the director can cut to: slides, a demo, a video.`;
    }).catch(() => {});
  }
  $('#soundTip').textContent = isMac || isLinux
    ? `To send its sound too: share a Chrome tab and tick Share tab audio (${isMac ? 'a Mac' : 'Linux'} shares a tab’s sound, not the whole computer’s).`
    : 'To send its sound too: pick Entire screen and tick Share system audio (or a tab, with Share tab audio).';
  if (!canShare) {
    $('#joinForm').hidden = true;
    $('#cantShare').hidden = false;
    // (over plain http on another computer's address, the browser can't share a screen at all: say so,
    // not that this browser can't)
    if (!window.isSecureContext) $('#cantShare').textContent = `Sharing a screen needs a secure address (https://), and this page was opened at ${location.origin}. Open the link the studio shows for another computer: it starts with https://.`;
  }
}

/** The browser's picker: a screen, a window or a tab (with its sound, if it shares that). */
async function pick() {
  const s = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
    systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude',
  });
  const v = s.getVideoTracks()[0];
  if (v && 'contentHint' in v) v.contentHint = modeOf(); // (slides and text: sharp; video: smooth)
  v?.addEventListener('ended', () => stream === s && stopped('You stopped sharing from the browser.'));
  return s;
}

async function start(e) {
  e?.preventDefault();
  err('');
  name = $('#name').value.trim() || 'Shared screen';
  if (!eventId) {
    const code = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    try {
      ev = await api(`events/${code}`);
      eventId = code;
      history.replaceState(null, '', `${location.pathname}?e=${code}`);
    } catch {
      return err('No event with that code. Check it against the studio.');
    }
  }
  $('#shareBtn').disabled = true;
  try {
    stream = await pick();
  } catch (x) {
    $('#shareBtn').disabled = false;
    if (x.name !== 'NotAllowedError' && x.name !== 'AbortError') err(`Couldn't share: ${x.message}`);
    return;
  }
  $('#shareBtn').disabled = false;
  localStorage.setItem('vm_share_name', name);
  if (!cid) {
    const id = await identity();
    cid = (await thumbprint(id.jwk)).slice(0, 13) + 'scr'; // (its own: a screen isn't this computer's camera)
  }
  showStream();
  show('liveView');
  $('#sendSay').after($('#modeBox')); // (the choice comes along: it can change while sharing)
  $('#liveName').textContent = ev?.title ? `${name} \u2192 ${ev.title}` : name;
  wakeLock(true);
  if (!sock) connect();
  else if (link) {
    link.rejoin();
    link.setPeers(sock.peers);
  }
}

function showStream() {
  $('#preview').srcObject = new MediaStream(stream.getVideoTracks());
  const a = stream.getAudioTracks().length;
  $('#soundSay').textContent = a ? 'Its sound goes to the studio too, in stereo.' : 'No sound with it (the browser didn’t share any). ' + (isMac || isLinux ? 'For sound, share a Chrome tab with Share tab audio.' : 'For sound, tick Share system audio or Share tab audio.');
}

function connect() {
  sock = meshSocket({
    eventId, role: 'cam', name, cid,
    onPeers: (peers) => link?.setPeers(peers),
    onSignal: (from, data) => link?.onSignal(from, data),
  });
  let air = false, pvw = false;
  const tier = () => link.setTier?.(air ? 'program' : pvw ? 'preview' : 'idle');
  link = new CamLink({
    sock,
    screen: true,
    motion: modeOf() === 'motion',
    stream: () => stream,
    onState: (s) => {
      $('#conn').className = 'dot' + (s === 'lan' || s === 'internet' || s === 'relay' ? ' on' : '');
      $('#linkSay').textContent = s === 'no-host' ? 'Waiting for the studio to open…' : s === 'connecting' ? 'Connecting to the studio…' : `In the studio${s === 'lan' ? ' (on this network)' : s === 'relay' ? ' (through a relay)' : ''}`;
    },
    onControl: (m) => {
      if (m.t === 'kick') return stopped('The studio took this screen out of the show.');
      if (m.t === 'pvw') pvw = !!m.on;
      if (m.t === 'tally') air = !!m.on;
      if (m.t === 'pvw' || m.t === 'tally') {
        tier();
        $('#pv').className = 'pv' + (air ? ' air' : pvw ? ' pvw' : '');
        $('#tag').textContent = air ? 'ON AIR' : pvw ? 'Up next' : 'In the studio';
      }
    },
    onHostMessage: () => {},
    extraTelemetry: () => ({ role: 'cam', screen: true, kind: 'computer', rec: false }),
    onProgress: () => {},
    onSent: () => {},
    onFailed: () => {},
  });
  window.vmShare = () => ({ linked: link?.pc?.connectionState === 'connected', stats: link?.linkStats || null, sound: !!stream?.getAudioTracks().length, codec: link?.codec || null });
  // What it's sending, as the link measures it every two seconds: size, frame rate, the codec,
  // and what's holding it back (so a presenter can see, not guess, if it's not smooth)
  clearInterval(sendTimer);
  sendTimer = setInterval(async () => {
    const s = link?.linkStats, el = $('#sendSay');
    if (!s?.w || link?.pc?.connectionState !== 'connected') return void (el.hidden = true);
    if (link.codecPc !== link.pc) Object.assign(link, { codec: null, codecPc: link.pc }); // (a new link may pick another codec)
    if (!link.codec) {
      try {
        (await link.pc.getStats()).forEach((r) => { if (r.type === 'codec' && /^video\//.test(r.mimeType)) link.codec = r.mimeType.slice(6); });
      } catch {}
    }
    const held = { cpu: "this computer's processor is busy", bandwidth: 'the network is busy', other: 'the browser' }[s.limit];
    const tip = held && modeOf() === 'detail' && s.fps != null && s.fps < 24 ? ' Showing a video? Choose Video and motion for smoother pictures.' : '';
    el.textContent = `Sending ${s.w} × ${s.h} at ${s.fps ?? '?'} frames a second${link.codec ? ` (${link.codec}${s.hw ? ', on the graphics hardware' : ''})` : ''}${s.tier === 'idle' ? ', smaller until the studio needs it' : ''}${held ? `. Held back: ${held}.` : '.'}${tip}`;
    el.hidden = false;
  }, 2000);
}

function stopped(why) {
  for (const t of stream?.getTracks() || []) t.stop();
  stream = null;
  link?.leave();
  wakeLock(false);
  $('#stoppedWhy').textContent = why;
  show('stoppedView');
}

$('#joinForm').addEventListener('submit', start);
$('#resumeBtn').onclick = () => start();
$('#stopBtn').onclick = () => stopped('The studio no longer has this screen.');
$('#againBtn').onclick = async () => {
  let s;
  try {
    s = await pick();
  } catch {
    return;
  }
  const old = stream;
  stream = s;
  for (const t of old?.getTracks() || []) t.stop();
  showStream();
  // (the same kinds of track: swap them in place; a sound that wasn't there before needs a new link)
  const same = !!old?.getAudioTracks().length === !!s.getAudioTracks().length;
  if (same) link?.replaceStream(s);
  else link?.connect();
};
setup();
