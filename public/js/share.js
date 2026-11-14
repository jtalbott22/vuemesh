// Another computer's screen, into the studio as a source (/share?e=CODE): open it on the
// presenter's laptop, name it, share a screen, window or tab with the browser's own picker, and
// the studio has it as a source like a phone's camera (marked a screen, so picture-in-picture
// and the show log treat it as one). Its sound comes too when the browser shares it. It joins
// the way a phone does (the event's signalling, then a direct link to the studio) but sends
// only the live picture: nothing is recorded here, so there are no clips to send. The studio
// records it as it arrives while it's on air (see recordedHere in studio/sources.js), for Edit.
//
// Or into a call (/share?e=CODE#k=KEY, the call's link with /share: callmesh.js): one more in the
// call, sending only its screen (and the screen's sound), let in from the waiting room like anyone.
import { CamLink } from '/js/rtc.js';
import { api, identity, meshSocket, thumbprint, showName, keepShowName, themeButton } from '/js/vm.js';
import { CallMesh, MAX_PEOPLE } from '/js/callmesh.js';

const $ = (s) => document.querySelector(s);
themeButton($('#themeBtn'));
const q = new URLSearchParams(location.search);
let eventId = (q.get('e') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
let ev = null, sock = null, link = null, stream = null, cid = null, name = '', sendTimer = null;
const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
const isLinux = /Linux/.test(navigator.platform || '') && !/Android/.test(navigator.userAgent);
const canShare = !!navigator.mediaDevices?.getDisplayMedia;

const err = (t) => ($('#joinErr').textContent = t || '');
// (a TV's own code, with no studio: tvdirect.js. The words say where the screen goes)
const toTv = () => ev?.kind === 'tv';
const toCall = () => ev?.kind === 'call';
const callKey = new URLSearchParams(location.hash.slice(1)).get('k') || '';
let mesh = null;
const place = () => (toCall() ? 'the call' : toTv() ? 'the TV' : 'the studio');
const Place = () => (toCall() ? 'The call' : toTv() ? 'The TV' : 'The studio');
function sayWhere() {
  if (!ev) return;
  if (toCall()) {
    $('#joinWhat').textContent = `Into call ${eventId}, for everyone in it to see: slides, a demo, a video. Someone in the call lets it in.`;
    $('#pinBox').hidden = !!(callKey || localStorage.getItem('vm_callkey_' + eventId));
    for (const el of document.querySelectorAll('[data-place]')) el.textContent = el.dataset.place === 'P' ? Place() : place();
    return;
  }
  $('#joinWhat').textContent = toTv()
    ? `Onto ${ev.title ? `“${ev.title}”` : 'the TV'}, live for the room: slides, a demo, a video. Nothing is recorded.`
    : `Into ${ev.title ? `“${ev.title}”` : 'the studio'}, as a source the director can cut to: slides, a demo, a video.`;
  for (const el of document.querySelectorAll('[data-place]')) el.textContent = el.dataset.place === 'P' ? Place() : place();
}
// What's on it, worked out from the picture and its sound, so nobody has to choose: a still
// picture (slides, a document, a page) is sent sharp, every word readable (frames give way first);
// a moving one (a video, a demo, scrolling) is sent smooth, 30 frames a second (the size gives
// way first). It used to be a choice on this page, and people didn't know which to pick.
let mode = 'detail', modeWhy = '';
const modeOf = () => mode;
try { localStorage.removeItem('vm_share_mode'); } catch {} // (what the old choice kept)
const applyMode = () => {
  const v = stream?.getVideoTracks()[0];
  if (v && 'contentHint' in v) v.contentHint = modeOf();
  if (link) {
    link.motion = modeOf() === 'motion';
    link.applyQuality();
  }
};
function sayMode() {
  const el = $('#modeSay');
  if (el) el.textContent = mode === 'motion' ? `Sent smooth, 30 frames a second: ${modeWhy}.` : 'Sent sharp, so every word stays readable. It turns smooth by itself when a video plays.';
}
function setMode(m, why = '') {
  modeWhy = why;
  if (m !== mode) {
    mode = m;
    applyMode();
  }
  sayMode();
}

// The watch: twice a second, the picture small (64 × 36) against the one before, and the sound's
// level. Moving most of 3 seconds, or sound for 3 (a share playing sound is almost always a video:
// sent sharp, a Mac's encoder once spent a minute at 2 frames a second on one), and it's sent
// smooth; still for 10 seconds with no sound, sharp again. By the clock, not by counting ticks, so
// it still decides (more slowly) when the browser slows this tab's timers behind the slides.
let watch = null;
function stopWatch() {
  if (!watch) return;
  clearInterval(watch.timer);
  watch.ctx?.close().catch(() => {});
  watch = null;
}
function watchContent(s) {
  stopWatch();
  setMode('detail');
  const w = { timer: 0, ctx: null, an: null, buf: null, loud: 0, prev: null, seen: [], picAt: 0, switchAt: Date.now() };
  const a = s.getAudioTracks()[0];
  if (a) {
    try {
      w.ctx = new AudioContext();
      w.ctx.resume?.().catch(() => {});
      w.an = w.ctx.createAnalyser();
      w.an.fftSize = 2048;
      w.ctx.createMediaStreamSource(new MediaStream([a])).connect(w.an);
      w.buf = new Float32Array(w.an.fftSize);
    } catch {
      w.an = null;
    }
  }
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  const v = $('#preview');
  w.timer = setInterval(() => {
    if (stream !== s) return stopWatch();
    const now = Date.now();
    if (w.an) {
      w.an.getFloatTimeDomainData(w.buf);
      let pk = 0;
      for (const x of w.buf) pk = Math.max(pk, Math.abs(x));
      w.loud = pk > 0.01 ? Math.min(w.loud + 1, 40) : Math.max(0, w.loud - 1); // (above -40 dB: sound, not a quiet room)
    }
    if (now - w.picAt >= 450 && v.readyState >= 2) {
      w.picAt = now;
      g.drawImage(v, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      if (w.prev) {
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 - (w.prev[i] * 0.3 + w.prev[i + 1] * 0.59 + w.prev[i + 2] * 0.11)) > 12) n++;
        }
        w.seen.push({ t: now, moving: n > 9 }); // (more than a mouse pointer or a blinking cursor)
      }
      w.prev = d;
      while (w.seen.length && now - w.seen[0].t > 10000) w.seen.shift();
    }
    if (now - w.switchAt < 4000) return; // (no flicking back and forth)
    const last3 = w.seen.filter((x) => now - x.t <= 3000);
    const movingNow = last3.length >= 3 && last3.filter((x) => x.moving).length >= last3.length * 0.8;
    const sound = w.loud >= 12;
    if (mode === 'detail' && (sound || movingNow)) {
      w.switchAt = now;
      setMode('motion', sound ? 'it’s playing sound' : 'the picture is moving');
    } else if (mode === 'motion' && !sound && w.loud === 0 && w.seen.length >= 5 && now - w.seen[0].t >= 8000 && w.seen.filter((x) => x.moving).length <= w.seen.length * 0.15) {
      w.switchAt = now;
      setMode('detail');
    } else if (mode === 'motion') {
      const why = sound ? 'it’s playing sound' : 'the picture is moving';
      if (why !== modeWhy && (sound || movingNow)) setMode('motion', why);
    }
  }, 250);
  watch = w;
}
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
      ev = { ...e, title: showName(eventId) }; // (the name: this computer's, or the link's; the studio says it once connected)
      sayWhere();
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
      ev = { ...ev, title: showName(code) };
      eventId = code;
      sayWhere();
      history.replaceState(null, '', `${location.pathname}?e=${code}`);
    } catch {
      return err('No event, call or TV with that code. Check it against the studio, the call or the TV.');
    }
    // (a call's code typed: it needs the call's PIN too)
    if (toCall() && !$('#pin').value.trim()) return err('That’s a call: type its PIN too (whoever started the call has it).');
  }
  if (toCall() && !callKey && !localStorage.getItem('vm_callkey_' + eventId) && $('#pin').value.replace(/\D/g, '').length !== 6) return err('Type the call’s 6-digit PIN');
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
  await revealAddress();
  showStream();
  watchContent(stream);
  show('liveView');
  $('#liveName').textContent = ev?.title ? `${name} \u2192 ${ev.title}` : name;
  wakeLock(true);
  if (toCall()) return joinCall();
  if (!sock) connect();
  else if (link) {
    link.rejoin();
    link.setPeers(sock.peers);
  }
}

/**
 * Let the browser give the studio this computer's real address. Without camera or microphone
 * permission a browser hides it behind a random name.local, which the studio has to look up over
 * multicast, and multicast often doesn't cross from Wi-Fi to a wired studio computer. Then the
 * studio never sends first, its firewall drops what comes in, and the screen stays black (with
 * Local network only on there's no other way in). A shared screen gives no such permission; a
 * microphone one does, so it's asked once and let go at once: nothing from it is kept or sent.
 */
async function revealAddress() {
  try {
    if ((await navigator.permissions?.query({ name: 'microphone' }))?.state === 'granted') return;
  } catch {}
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {} // (said no: it may still connect, through the router)
}

function showStream() {
  $('#preview').srcObject = new MediaStream(stream.getVideoTracks());
  const a = stream.getAudioTracks().length;
  $('#soundSay').textContent = a ? `Its sound goes to ${place()} too${toTv() ? '' : ', in stereo'}.` : 'No sound with it (the browser didn’t share any). ' + (isMac || isLinux ? 'For sound, share a Chrome tab with Share tab audio.' : 'For sound, tick Share system audio or Share tab audio.');
}

function connect() {
  sock = meshSocket({
    eventId, role: 'cam', name, cid,
    query: () => ({ src: 'screen' }), // (counted as a screen shared, not a camera)
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
      $('#linkSay').textContent = s === 'no-host' ? (toTv() ? 'Waiting for the TV: is it showing its code?' : 'Waiting for the studio to open…') : s === 'connecting' ? `Connecting to ${place()}…` : `${toTv() ? 'On the TV' : 'In the studio'}${s === 'lan' ? ' (on this network)' : s === 'relay' ? ' (through a relay)' : ''}`;
    },
    onControl: (m) => {
      if (m.t === 'kick') return stopped(toTv() ? 'The TV took this screen off.' : 'The studio took this screen out of the show.');
      if (m.t === 'pvw') pvw = !!m.on;
      if (m.t === 'tally') air = !!m.on;
      if (m.t === 'pvw' || m.t === 'tally') {
        tier();
        $('#pv').className = 'pv vm-monitor' + (air ? ' air' : pvw ? ' pvw' : '');
        $('#tag').textContent = toTv() ? (air ? 'ON THE TV' : 'Waiting for a place') : air ? 'ON AIR' : pvw ? 'Up next' : 'In the studio';
      }
    },
    // the show's name, from the studio over this link (the server never has it)
    onHostMessage: (m) => {
      if (m.t !== 'show' || !m.title || !ev) return;
      ev = { ...ev, title: String(m.title).slice(0, 120) };
      keepShowName(eventId, ev.title);
      sayWhere();
      $('#liveName').textContent = `${name} → ${ev.title}`;
    },
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
    el.textContent = `Sending ${s.w} × ${s.h} at ${s.fps ?? '?'} frames a second${link.codec ? ` (${link.codec}${s.hw ? ', on the graphics hardware' : ''})` : ''}${s.tier === 'idle' ? ', smaller until the studio needs it' : ''}${held ? `. Held back: ${held}.` : '.'}`;
    el.hidden = false;
  }, 2000);
}

/** Into a call: one more in it, sending this screen (and its sound), let in like anyone */
async function joinCall() {
  const say = (t, on = false) => {
    $('#linkSay').textContent = t;
    $('#conn').className = 'dot' + (on ? ' on' : '');
  };
  $('#tag').textContent = 'Waiting';
  say('Asking to come into the call…');
  mesh = new CallMesh({
    id: eventId, key: callKey, pin: $('#pin').value.replace(/\D/g, ''), name, slot: 'scr',
    tracks: () => ({ audio: stream?.getAudioTracks()[0], camera: null, screen: stream?.getVideoTracks()[0] }),
    state: () => ({ mic: !!stream?.getAudioTracks().length, cam: false, screen: true }),
    on: {
      waiting: () => say('Waiting to be let in: someone in the call lets this screen in'),
      in: () => { $('#tag').textContent = 'IN THE CALL'; say('In the call', true); },
      change: () => mesh?.inCall && say(`In the call, with ${mesh.peers.size} other${mesh.peers.size === 1 ? '' : 's'}${[...mesh.peers.values()].some((p) => p.relayed) ? ' (some through a relay)' : ''}`, true),
      gone: () => mesh?.inCall && say(`In the call, with ${mesh.peers.size} other${mesh.peers.size === 1 ? '' : 's'}`, true),
      removed: (block) => stopped(block ? 'Someone in the call took this screen out.' : 'It wasn’t let into the call.'),
      full: () => say(`The call is full (${MAX_PEOPLE})`),
    },
  });
  try {
    await mesh.enter();
    await mesh.join();
  } catch (x) {
    stopped(x.message);
  }
}

function stopped(why) {
  for (const t of stream?.getTracks() || []) t.stop();
  stream = null;
  stopWatch();
  mesh?.leave();
  mesh = null;
  link?.leave();
  // (off the event's signalling too: left on it, the studio's and a TV's lists still had this
  // computer, and a TV said "Joining: Josh's Mac" after it had gone. Share again joins afresh.)
  sock?.close();
  sock = link = null;
  clearInterval(sendTimer);
  wakeLock(false);
  $('#stoppedWhy').textContent = why;
  show('stoppedView');
}

$('#joinForm').addEventListener('submit', start);
$('#resumeBtn').onclick = () => start();
$('#stopBtn').onclick = () => stopped(`${Place()} no longer has this screen.`);
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
  watchContent(s);
  if (mesh) return mesh.refill(); // (a call: into the same places, no new link)
  // (the same kinds of track: swap them in place; a sound that wasn't there before needs a new link)
  const same = !!old?.getAudioTracks().length === !!s.getAudioTracks().length;
  if (same) link?.replaceStream(s);
  else link?.connect();
};
setup();
