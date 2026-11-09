// The phone remote: pairs with the studio using the one-time code it shows (from its QR, or typed),
// then shows what's on air and the cameras, and sends the studio commands with this phone's own
// session key (kept on this phone, so it carries on after a reload). The studio checks every
// command; see remote-host.js. Paired once with a studio computer, the phone joins its next shows
// with just the show's code (it tries the keys it has; the studio knows its own). Saved to the
// home screen, it opens on the last show. Its own camera can scan the studio's code too: a
// home-screen app can't be opened by the camera app's scan.
import { ProgramView } from '/js/pgmview.js';
import { ProgramSound } from '/js/progsound.js';
import { decodeQR, meshSocket } from '/js/vm.js';
import { RemoteCamera } from '/js/remotecam.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const LAST = 'vm_remote_last', KEYS = 'vm_remote_keys';
let eventId = (q.get('e') || localStorage.getItem(LAST) || '').toUpperCase();
let code = (hash.get('p') || '').toUpperCase();
if (hash.has('p')) history.replaceState(null, '', location.pathname + location.search); // (the code doesn't stay in the address)
const keyStore = (id) => `vm_remote_${id}`;
const knownKeys = () => {
  try {
    return JSON.parse(localStorage.getItem(KEYS) || '[]');
  } catch {
    return [];
  }
};
let key = eventId ? localStorage.getItem(keyStore(eventId)) : null;
let trying = []; // keys from other shows, to try on this one (the newest first)
/** This show's key, worked: keep it for this show, as the last show, and among the keys to try. */
function keep(k) {
  localStorage.setItem(keyStore(eventId), k);
  localStorage.setItem(LAST, eventId);
  localStorage.setItem(KEYS, JSON.stringify([k, ...knownKeys().filter((x) => x !== k)].slice(0, 6)));
}
let sock = null, host = null, state = null, recSince = null, wanted = null, lastState = 0;
const thumbs = new Map();

function toast(text, ms = 3500) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), ms);
}
const say = (text, err) => {
  $('#pairSay').textContent = text;
  $('#pairSay').className = 'say' + (err ? ' err' : '');
};
// (straight to the studio on this phone's Program out link when it's up, so the remote keeps working
// with no server once it's in; else through the server)
const send = (data) => {
  if (pgm?.tell({ t: 'remote', from: sock?.peer, m: data })) return;
  if (host) sock?.signal(host, { remote: data });
};

let opens = 0; // (the socket's connections seen: each new one says who it is)
function connect() {
  if (sock) return;
  noStudio(); // (until the studio's there)
  sock = meshSocket({
    eventId,
    role: 'remote',
    name: ($('#name').value || 'Phone remote').slice(0, 40),
    onPeers: (peers) => {
      // (the studio's server connection dropped a moment, or the server's gone: its own link to this
      // phone still works, so it's still here)
      const h = peers.find((p) => p.role === 'host')?.peer || (pgm?.linked ? host : null);
      $('#conn').className = 'dot' + (h ? ' on' : '');
      $('#conn').setAttribute('aria-label', h ? 'Connected to the studio' : 'The studio is not open');
      // (this phone's own server connection came back: the studio let it go meanwhile, so say who it is again)
      const back = sock.opens !== opens;
      opens = sock.opens;
      if (h !== host || (h && back)) {
        host = h;
        if (!host) {
          $('#onAir').textContent = 'Waiting for the studio…';
          noStudio();
          return;
        }
        clearTimeout(noStudio.t);
        // (a studio here, or back after a reload: carry on, or finish pairing)
        if (key) send({ t: 'resume', key });
        else if (wanted) send({ t: 'pair', code: wanted, name: $('#name').value });
      }
    },
    onSignal: (from, data) => from === host && onMessage(data?.remote),
  });
}

function onMessage(m) {
  if (!m) return;
  if ((m.t === 'tv' || m.t === 'state') && key && trying.length) {
    trying = [];
    keep(key);
    showControls();
    toast('Joined this show as its remote');
  }
  if (m.t === 'paired' || m.t === 'tv') {
    if (m.tv) startProgram(m.tv);
    if (m.t === 'tv') return;
  }
  if (m.t === 'paired') {
    key = m.key;
    keep(key);
    localStorage.setItem('vm_remote_name', m.name || '');
    wanted = null;
    showControls();
    toast('This phone is now a remote for the show');
  } else if (m.t === 'denied') {
    wanted = null;
    say(m.why || "The studio didn't accept that code", true);
    $('#pairBtn').disabled = false;
  } else if (m.t === 'removed' && m.unknown && trying.length) {
    // (not a key this studio gave out: the next one, or pair with its code)
    trying.shift();
    key = trying[0] || null;
    if (key) send({ t: 'resume', key });
    else {
      showPairing();
      $('#pairBtn').disabled = false;
      say("This studio doesn't know this phone yet. In the studio: Phone remote > Add a phone, then scan its code or type it here. Once is enough: next time, just the show's code.", true);
      $('#code').focus();
    }
  } else if (m.t === 'removed') {
    rcam?.stop();
    pgm?.stop();
    pgm = null;
    psound.stop();
    fullProgram(false);
    $('#pgmBox').hidden = $('#pgmRow').hidden = true;
    key = null;
    localStorage.removeItem(keyStore(eventId));
    showPairing();
    say('This phone was removed as a remote in the studio. Add it again there to carry on.', true);
  } else if (m.t === 'state') {
    lastState = Date.now();
    if (key && !$('#pairView').hidden && !trying.length && !wanted) showControls(); // (its studio opened after all)
    if (m.s.rec && !state?.rec) recSince = Date.now();
    if (!m.s.rec) recSince = null;
    state = m.s;
    render();
  } else if (m.t === 'thumb') {
    thumbs.set(m.peer, m.src);
    const img = document.querySelector(`.cam[data-peer="${CSS.escape(m.peer)}"] img`);
    if (img) setThumb(img, m.src);
    else render();
  } else if (m.t === 'done' && !m.ok) {
    toast(m.why || "The studio couldn't do that");
  }
}

// Program out: what's on air, right above the cameras (its own link from the studio; off to save battery)
let pgm = null, pgmKey = null;
const pgmOn = () => localStorage.getItem('vm_remote_pgm') !== '0';
function startProgram(tvKey) {
  pgmKey = tvKey;
  $('#pgmRow').hidden = false;
  $('#pgmTgl').setAttribute('aria-pressed', String(pgmOn()));
  $('#pgmBox').hidden = !pgmOn();
  showSound();
  if (pgm?.key === tvKey) return;
  pgm?.stop();
  pgm = new ProgramView({
    eventId, key: tvKey, name: localStorage.getItem('vm_remote_name') || 'Phone remote', video: $('#pgm'), onState: (t) => ($('#pgmSay').textContent = t), onSound: (t) => psound.setTrack(t),
    onCtl: (m) => m.t === 'remote' && onMessage(m.d?.remote),
  });
  // (turned off, it stays connected and is sent nothing: the remote's buttons go on this link)
  pgm.want(pgmOn() ? 'program' : 'idle');
}
$('#pgmTgl').onclick = () => {
  const on = !pgmOn();
  localStorage.setItem('vm_remote_pgm', on ? '1' : '0');
  if (!on) psound.stop();
  pgm?.want(on ? 'program' : 'idle');
  // (on again, on the same link: its sound is the same track, given back to the player)
  const snd = on && pgm?.pc?.getReceivers().find((r) => r.track?.kind === 'audio')?.track;
  if (snd) psound.setTrack(snd);
  if (!on) fullProgram(false);
  $('#pgmTgl').setAttribute('aria-pressed', String(on));
  $('#pgmBox').hidden = !on;
  showSound();
  if (on && pgmKey && !pgm) startProgram(pgmKey);
  if (on) pgm?.resume(); // (on again: its picture plays again, if anything had paused it)
};

// The program's sound, with the picture: off to start with (a phone in the studio's room would
// play it back into the microphones), on with a tap, and remembered. It plays as a music app's
// does (progsound.js): with the screen locked, behind other apps, in earbuds or the car, with
// what's on air in Now Playing.
const psound = new ProgramSound({ store: 'vm_remote_sound', onChange: () => showSound() });
function showSound() {
  const b = $('#sndBtn'), on = psound.on, waiting = psound.waiting;
  b.hidden = !pgmOn();
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('wait', waiting);
  const held = !!psound.held;
  b.disabled = held;
  b.classList.toggle('held', held);
  b.querySelector('span').textContent = held ? 'Sound off: mic live' : on ? 'Sound on' : waiting ? 'Tap for sound' : 'Sound off';
  b.setAttribute('aria-label', held ? "Program sound is off while this phone's microphone is in the show" : on ? 'Program sound on: tap to mute' : 'Program sound off: tap to hear it');
}
$('#sndBtn').onclick = () => psound.set(!psound.on);

// Program out full screen, to just watch: a tap on it, and a tap anywhere to go back. It's the same
// video made to fill the screen (nothing stops or reconnects). Where the browser can, the page goes
// full screen too (an iPad, Android); an iPhone can't for a page, so there it fills the page.
function fullProgram(on) {
  const box = $('#pgmBox');
  on = !!on && !box.hidden;
  if (box.classList.contains('full') === on) return;
  box.classList.toggle('full', on);
  document.body.classList.toggle('pgmfull', on);
  box.setAttribute('aria-pressed', String(on));
  box.setAttribute('aria-label', on ? 'Program out, full screen: tap to go back to the remote' : "Program out: tap to watch it full screen");
  if (on) {
    const h = $('#fsHint');
    h.style.animation = 'none';
    void h.offsetWidth; // (the hint shows again each time)
    h.style.animation = '';
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
  } else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  pgm?.resume(); // (should anything have paused it)
}
$('#pgmBox').addEventListener('click', () => fullProgram(!$('#pgmBox').classList.contains('full')));
$('#pgmBox').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fullProgram(!$('#pgmBox').classList.contains('full'));
  } else if (e.key === 'Escape') fullProgram(false);
});
// (left the browser's full screen another way, a swipe or Esc: back to the remote too)
document.addEventListener('fullscreenchange', () => !document.fullscreenElement && fullProgram(false));
window.vmProgramFull = () => $('#pgmBox').classList.contains('full'); // (tests)
window.vmProgramView = () => pgm && { linked: pgm.linked, shown: pgm.shown, w: $('#pgm').videoWidth, h: $('#pgm').videoHeight, sound: pgm.hasSound, muted: !psound.on, nowPlaying: navigator.mediaSession?.metadata?.title || null }; // (tests)

// Opened on a show whose studio isn't open (last week's, from the home screen): after a few
// seconds, the show's code can be changed (still listening, in case it's only opening late).
function noStudio() {
  clearTimeout(noStudio.t);
  noStudio.t = setTimeout(() => {
    if (host || $('#ctlView').hidden) return;
    showPairing();
    say(`The studio for ${eventId} isn't open. Another show? Type its code.`);
    $('#show').select();
  }, 8000);
}
$('#changeShow').onclick = () => {
  showPairing();
  say("Type the show's code.");
  $('#show').select();
};
function showPairing() {
  $('#pairView').hidden = false;
  $('#ctlView').hidden = true;
  $('#title').textContent = 'Remote';
}
function showControls() {
  $('#pairView').hidden = true;
  $('#ctlView').hidden = false;
  keepAwake();
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The mixer: AFV / ON / OFF and a fader for each live channel, with how loud it is now.
// Built once per set of channels (so a finger on a fader isn't replaced), then kept up.
let mixSig = '', dragging = null;
const MODE_TEXT = { afv: 'AFV', on: 'ON', off: 'OFF' };
const pct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
function renderMix() {
  const m = state.mix;
  $('#mixH').hidden = $('#mix').hidden = !m?.rows?.length;
  if (!m?.rows?.length) return;
  const sig = m.rows.map((r) => `${r.id}:${r.name}`).join('|');
  if (sig !== mixSig) {
    mixSig = sig;
    $('#mix').innerHTML = m.rows.map((r) => `<div class="mixrow" data-ch="${esc(r.id)}">
        <span class="nm">${esc(r.name)}</span><span class="db"></span>
        <span class="lv" aria-hidden="true"><i></i></span>
        <input type="range" min="-60" max="12" step="1" aria-label="${esc(r.name)} level in decibels">
        <span class="modes">${Object.entries(MODE_TEXT).map(([k, t]) => `<button type="button" data-mode="${k}" aria-pressed="false" aria-label="${esc(r.name)}: ${t}">${t}</button>`).join('')}</span>
      </div>`).join('') + `<div class="mixrow prog"><span class="nm">Program</span><span class="db"></span><span class="lv" aria-hidden="true"><i></i></span></div>`;
  }
  for (const r of m.rows) {
    const el = $('#mix').querySelector(`[data-ch="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    el.classList.toggle('open', !!r.open);
    el.querySelector('.lv i').style.width = `${pct(r.level)}%`;
    const range = el.querySelector('input');
    if (dragging !== r.id) {
      range.value = String(r.db);
      el.querySelector('.db').textContent = `${r.db} dB`;
    }
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === r.mode)));
  }
  const prog = $('#mix').querySelector('.prog');
  prog.querySelector('.lv i').style.width = `${pct(m.program)}%`;
  prog.querySelector('.db').textContent = m.program > -99 ? `${m.program} dB` : 'silent';
}
let gainTimer = null;
$('#mix').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]'), row = b?.closest('[data-ch]');
  if (row) act('mixMode', { id: row.dataset.ch, mode: b.dataset.mode });
});
$('#mix').addEventListener('input', (e) => {
  const range = e.target.closest('input[type=range]'), row = range?.closest('[data-ch]');
  if (!row) return;
  dragging = row.dataset.ch;
  row.querySelector('.db').textContent = `${range.value} dB`;
  if (gainTimer) return; // (as it moves, a few times a second; and where it stops)
  gainTimer = setTimeout(() => {
    gainTimer = null;
    act('mixGain', { id: row.dataset.ch, db: Number(range.value) });
  }, 150);
});
$('#mix').addEventListener('change', (e) => {
  const range = e.target.closest('input[type=range]'), row = range?.closest('[data-ch]');
  if (!row) return;
  act('mixGain', { id: row.dataset.ch, db: Number(range.value) });
  setTimeout(() => (dragging = null), 1500);
});
// The studio sends what's on air every second (the mixer's levels change that often): a grid is
// drawn again only when something in it changed, and a camera's picture only when it's a new one.
// Drawing every camera's picture again each second made the program above them stutter on a phone.
function setHtml(el, html) {
  if (el.vmHtml === html) return;
  el.vmHtml = html;
  el.innerHTML = html;
}
function setThumb(img, src) {
  if (!src || img.vmSrc === src) return;
  img.vmSrc = src;
  img.src = src;
}
function render() {
  if (!state) return;
  $('#title').textContent = state.title || 'Remote';
  const air = state.cams.find((c) => c.onAir), snd = (state.sound || []).find((s) => s.onAir);
  const what = state.black ? 'Black' : state.brk ? 'On a break' : state.media ? `On air · ${state.media}` : air ? `On air · ${air.name}` : snd ? `On air · ${snd.name} · sound only` : 'Nothing on air';
  $('#onAir').textContent = what;
  psound.setMeta(what.replace(/^On air · /, ''), state.title || 'VUEMesh');
  $('#status').className = 'status' + (!state.black && !state.brk && (air || snd || state.media) ? ' air' : '');
  const mine = rcam?.peer, inShow = !!mine && state.cams.some((c) => c.peer === mine);
  setHtml($('#cams'), state.cams.map((c) => {
    const me = c.peer === mine;
    return `<button type="button" class="cam${c.onAir ? ' air' : c.preview ? ' pvw' : ''}${me ? ' mine' : ''}" data-peer="${esc(c.peer)}" aria-label="Cut to ${me ? "this phone's camera" : esc(c.name)}${c.onAir ? ' (on air)' : ''}">
      ${thumbs.has(c.peer) ? '<img alt="">' : '<span class="nopic">picture in a moment</span>'}
      ${c.onAir ? '<span class="tag">ON AIR</span>' : c.inset ? '<span class="tag">IN CORNER</span>' : me ? '<span class="tag me">THIS PHONE</span>' : ''}${c.screen ? '<span class="scr" aria-hidden="true">🖥</span>' : ''}${c.rec ? '<span class="rdot" title="Recording"></span>' : ''}<b>${esc(c.name)}</b></button>`;
  }).join('') + addTile(inShow));
  for (const img of $('#cams').querySelectorAll('.cam img')) setThumb(img, thumbs.get(img.closest('.cam').dataset.peer));
  $('#noCams').hidden = state.cams.length > 0 || !!rcam?.on;
  renderMyCam();
  // sound-only sources: cut to one and the program shows its sound picture
  const sound = state.sound || [];
  $('#soundH').hidden = $('#sound').hidden = !sound.length;
  setHtml($('#sound'), sound.map((s) => `<button type="button" class="cam${s.onAir ? ' air' : ''}" data-peer="${esc(s.peer)}" aria-label="Cut to ${esc(s.name)}, sound only${s.onAir ? ' (on air)' : ''}">
      <span class="snd" aria-hidden="true">🔊</span>${s.onAir ? '<span class="tag">ON AIR</span>' : ''}<b>${esc(s.name)}</b></button>`).join(''));
  // the clips loaded in the studio: cut to one and it plays on air
  const clips = state.clips || [];
  $('#clipsH').hidden = $('#clips').hidden = !clips.length;
  setHtml($('#clips'), clips.map((c) => `<button type="button" class="cam${c.onAir ? ' air' : ''}" data-clip="${esc(c.id)}" aria-label="Cut to the clip ${esc(c.name)}${c.onAir ? ' (on air)' : ''}">
      <span class="snd" aria-hidden="true">${c.kind === 'image' ? '🖼' : '🎞'}</span>${c.onAir ? '<span class="tag">ON AIR</span>' : ''}<b>${esc(c.name)}</b></button>`).join(''));
  renderMix();
  $('#autoBtn').setAttribute('aria-pressed', String(!!state.auto));
  $('#blackBtn').setAttribute('aria-pressed', String(!!state.black));
  $('#blackBtn').textContent = state.black ? 'Fade up' : 'Fade to black';
  $('#breakBtn').setAttribute('aria-pressed', String(!!state.brk));
  $('#breakBtn').textContent = state.brk ? 'End break' : 'Break';
  $('#recBtn').setAttribute('aria-pressed', String(!!state.rec));
  if (!recArmed) $('#recBtn').textContent = state.rec ? 'Stop recording' : 'Record program';
  $('#pipBtn').hidden = !state.pip;
  $('#pipBtn').setAttribute('aria-pressed', String(!!state.pip?.on));
  // (its label: a long one upright, a short one sideways, with the camera in the corner under it. As one
  // line, "Corner camera: Josh's iPhone" took three on a phone held sideways, and when a screen went
  // on air the row of buttons grew and Program out shrank)
  const pip = state.pip, now = pip?.on && pip.now;
  setHtml($('#pipBtn'), `<span class="lg">${pip?.on ? `Corner camera${now ? '' : ' on'}` : 'Camera in the corner'}</span><span class="sh">${pip?.on ? 'Corner on' : 'Corner cam'}</span>${now ? `<small>${esc(now)}</small>` : ''}`);
  $('#pipBtn').setAttribute('aria-label', pip?.on ? `Camera in the corner: on${now ? `, ${now}` : ''}` : 'Camera in the corner: off');
}
setInterval(() => {
  const t = $('#recTime');
  t.hidden = !recSince;
  if (recSince) {
    const s = Math.floor((Date.now() - recSince) / 1000);
    t.textContent = `● REC ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}, 500);

const act = (a, arg) => {
  if (!host) return toast('The studio is not open');
  send({ t: 'do', key, a, arg });
  if (a !== 'mixGain') navigator.vibrate?.(15); // (not all the way along a fader)
};
for (const id of ['#cams', '#sound']) {
  $(id).addEventListener('click', (e) => {
    if (e.target.closest('.camadd[data-add]')) return addCamera();
    const b = e.target.closest('.cam');
    if (b) act('cut', b.dataset.peer);
  });
}

// ---- this phone's own camera ----------------------------------------------------------------
// "+ This phone" at the end of the cameras: a tap, and the phone joins the show as a camera too
// (remotecam.js), its picture among the others' with THIS PHONE on it, a tap on it to cut to it.
// Under the cameras, its own picture (to frame the shot), its lenses, its microphone and Remove.
// While its microphone is live, the program's sound is held off here (it would go back into it).
let rcam = null;
const camName = () => {
  const n = (localStorage.getItem('vm_remote_name') || $('#name').value || '').trim();
  return !n || n === 'Phone remote' ? 'Remote camera' : `${n} camera`.slice(0, 40);
};
function addTile(inShow) {
  if (!rcam?.on) return `<button type="button" class="camadd" data-add aria-label="Add this phone's camera to the show"><span class="plus" aria-hidden="true">+</span><b>This phone</b></button>`;
  if (inShow) return '';
  const what = rcam.state === 'starting' ? 'Starting the camera…' : rcam.state === 'no-host' ? 'Waiting for the studio…' : 'Joining the show…';
  return `<button type="button" class="camadd wait" disabled aria-label="This phone's camera: ${what}"><span class="nopic">${what}</span><b>This phone</b></button>`;
}
async function addCamera() {
  if (!host && !pgm?.linked) return toast('The studio is not open');
  if (rcam?.on) return;
  rcam ||= new RemoteCamera({
    eventId, name: camName(), video: $('#myCamVideo'),
    onChange: () => (render(), renderMyCam()),
    onEnded: (why) => toast(why, 5000),
  });
  rcam.eventId = eventId;
  rcam.name = camName();
  try {
    await rcam.start();
    navigator.vibrate?.(30);
    toast("This phone's camera is in the show. Tap its picture to cut to it.");
  } catch (e) {
    toast(e?.name === 'NotAllowedError' ? 'Allow the camera for this page to add it (Settings > Safari > Camera on an iPhone)' : `The camera didn't open: ${e?.message || e}`, 6000);
  }
}
let lensSig = '';
function renderMyCam() {
  const on = !!rcam?.on, bar = $('#myCam');
  bar.hidden = !on;
  psound.hold(on && rcam.canMic && rcam.micOn);
  showSound();
  if (!on) return;
  bar.classList.toggle('air', rcam.air);
  bar.classList.toggle('pvw', !rcam.air && rcam.pvw);
  $('#myCamSay').textContent = rcam.air ? 'ON AIR' : rcam.pvw ? 'Up next' : rcam.live ? 'In the show' : rcam.state === 'starting' ? 'Starting…' : rcam.state === 'no-host' ? 'Waiting for the studio…' : 'Joining…';
  const sig = rcam.lenses.map((l) => l.deviceId).join('|');
  if (sig !== lensSig) {
    lensSig = sig;
    // (one camera only: nothing to choose between)
    $('#lenses').innerHTML = rcam.lenses.length > 1 ? rcam.lenses.map((l) => `<button type="button" data-lens="${esc(l.deviceId)}" aria-pressed="false" aria-label="${esc(l.label)}">${esc(l.short)}</button>`).join('') : '';
  }
  for (const b of $('#lenses').querySelectorAll('[data-lens]')) {
    b.setAttribute('aria-pressed', String(b.dataset.lens === rcam.kit?.deviceId));
    b.disabled = !!rcam.switching;
  }
  const mic = $('#myMicBtn');
  mic.hidden = !rcam.canMic;
  mic.setAttribute('aria-pressed', String(rcam.micOn));
  mic.textContent = rcam.micOn ? 'Mic on' : 'Mic off';
}
$('#lenses').addEventListener('click', (e) => {
  const b = e.target.closest('[data-lens]');
  if (b && rcam) rcam.useLens(b.dataset.lens).catch(() => toast("That lens didn't open"));
});
$('#myMicBtn').onclick = () => rcam?.setMic(!rcam.micOn).catch((e) => toast(e.message));
// (on air, Remove takes a second tap: the studio would put up its break slate until the next cut)
let offArmed = null;
$('#myCamOff').onclick = () => {
  if (rcam?.air && !offArmed) {
    $('#myCamOff').textContent = 'On air: tap again';
    offArmed = setTimeout(() => {
      offArmed = null;
      $('#myCamOff').textContent = 'Remove';
    }, 3000);
    navigator.vibrate?.(15);
    return;
  }
  clearTimeout(offArmed);
  offArmed = null;
  $('#myCamOff').textContent = 'Remove';
  rcam?.stop();
  toast("This phone's camera left the show");
};
window.vmRemoteCam = () => rcam && { on: rcam.on, state: rcam.state, peer: rcam.peer, air: rcam.air, lens: rcam.kit?.deviceId || null, lenses: rcam.lenses.map((l) => l.short), mic: !!rcam.canMic, micOn: rcam.micOn, micOpen: rcam.mic?.readyState === 'live', soundSent: rcam.soundSender()?.track?.readyState === 'live', held: !!psound.held, pgmOffered: !!rcam.pgmOffered, w: $('#myCamVideo').videoWidth, h: $('#myCamVideo').videoHeight }; // (tests)
$('#clips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-clip]');
  if (b) act('clip', b.dataset.clip);
});
$('#autoBtn').onclick = () => act('auto', !state?.auto);
$('#pipBtn').onclick = () => act('pip', !state?.pip?.on);
$('#blackBtn').onclick = () => act('black');
$('#breakBtn').onclick = () => act('break');
// Stopping asks for a second tap, not a confirm() box: on an iPhone that box pauses the page's
// video, and Program out stayed frozen after it (its link fine, the picture still arriving).
let recArmed = null;
const disarmRec = () => {
  clearTimeout(recArmed);
  recArmed = null;
  $('#recBtn').classList.remove('armed');
  if (state) $('#recBtn').textContent = state.rec ? 'Stop recording' : 'Record program';
};
$('#recBtn').onclick = () => {
  if (state?.rec && !recArmed) {
    $('#recBtn').textContent = 'Tap again to stop';
    $('#recBtn').classList.add('armed');
    recArmed = setTimeout(disarmRec, 3000);
    navigator.vibrate?.(15);
    return;
  }
  disarmRec();
  act('rec', !state?.rec);
};

// A phone's connection drops now and then (the screen sleeps, it goes to the background, the Wi-Fi
// blips); the studio lets go of a remote it can't see, and isn't told when it's back. So every five
// seconds the remote checks in (which binds it again), and if nothing has come for twelve, it asks
// for everything: a camera that joined meanwhile shows up without a reload.
setInterval(() => {
  if (!key || (!host && !pgm?.linked)) return;
  if (Date.now() - lastState > 12000) send({ t: 'resume', key });
  else send({ t: 'vis', key, on: !document.hidden });
}, 5000);

async function keepAwake() {
  try {
    await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  // (pictures only while this is on screen; the screen kept awake while it is)
  if (key) send({ t: 'vis', key, on: !document.hidden });
  if (!document.hidden && key) keepAwake();
});

function pair() {
  const was = eventId;
  eventId = ($('#show').value || eventId).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (sock && was !== eventId) {
    // (another show: its own signalling, and this phone's camera leaves the last one)
    rcam?.stop();
    sock.close();
    sock = host = null;
    opens = 0;
    key = null;
    state = null;
  }
  const c = ($('#code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(eventId)) return say('The show is the six-letter code the studio shows', true);
  localStorage.setItem(LAST, eventId);
  const prior = localStorage.getItem(keyStore(eventId));
  if (prior && !c) {
    key = prior;
    showControls();
    connect();
    return;
  }
  if (!c) {
    // just the show's code: a phone paired with this studio before is let in by its key
    trying = knownKeys();
    if (!trying.length) return say('The first time, this phone needs the code from the studio too (Phone remote > Add a phone).', true);
    key = trying[0];
    $('#pairBtn').disabled = true;
    say('Connecting to the studio…');
    history.replaceState(null, '', `/remote?e=${eventId}`);
    if (sock && host) send({ t: 'resume', key });
    else connect();
    setTimeout(() => {
      if (trying.length) {
        trying = [];
        key = null;
        say("The studio didn't answer. Is it open, with this show?", true);
        $('#pairBtn').disabled = false;
      }
    }, 12000);
    return;
  }
  if (c.length !== 8) return say('The code is eight letters and numbers (ABCD-EFGH)', true);
  wanted = c;
  $('#pairBtn').disabled = true;
  say('Connecting to the studio…');
  history.replaceState(null, '', `/remote?e=${eventId}`);
  if (sock && host) send({ t: 'pair', code: c, name: $('#name').value });
  else connect();
  setTimeout(() => {
    if (wanted) {
      say("The studio didn't answer. Is it open, with this show?", true);
      $('#pairBtn').disabled = false;
    }
  }, 12000);
}
$('#pairBtn').onclick = pair;

// What was typed, pasted or scanned: the studio's whole link, "show code", or each on its own.
function takeText(t) {
  t = String(t || '').trim();
  let e = null, c = null;
  try {
    const u = new URL(t);
    e = u.searchParams.get('e');
    c = new URLSearchParams(u.hash.slice(1)).get('p');
  } catch {
    const bits = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (bits.length === 14) [e, c] = [bits.slice(0, 6), bits.slice(6)];
    else if (bits.length === 6) e = bits;
    else if (bits.length === 8) c = bits;
  }
  if (!e && !c) return false;
  if (e) $('#show').value = e.toUpperCase();
  if (c) $('#code').value = `${c.toUpperCase().slice(0, 4)}-${c.toUpperCase().slice(4)}`;
  return true;
}
for (const id of ['#show', '#code']) {
  $(id).addEventListener('paste', (e) => {
    const t = e.clipboardData?.getData('text');
    if (t && t.length > 9 && takeText(t)) {
      e.preventDefault();
      pair();
    }
  });
}
$('#show').addEventListener('input', () => {
  const v = $('#show').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length > 6 && takeText(v)) return;
  if (v.length === 6) $('#code').focus();
});
$('#code').addEventListener('input', () => {
  if ($('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').length === 8) pair();
});
$('#show').addEventListener('keydown', (e) => e.key === 'Enter' && pair());
$('#code').addEventListener('keydown', (e) => e.key === 'Enter' && pair());

// Scan the studio's code with this phone's camera (Add a phone shows it)
let scan = null;
async function startScan() {
  if (scan) return stopScan();
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  } catch {
    return say('The camera didn\u2019t open. Allow it for this page, or type the codes.', true);
  }
  const v = $('#scanVideo'), c = document.createElement('canvas');
  v.srcObject = s;
  await v.play().catch(() => {});
  $('#scanBox').hidden = false;
  $('#scanBtn').textContent = 'Stop scanning';
  say('Point the camera at the code in the studio\u2019s Add a phone.');
  scan = { s, timer: setInterval(async () => {
    if (!v.videoWidth) return;
    const k = Math.min(1, 720 / v.videoWidth);
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, c.width, c.height);
    const t = await decodeQR(c).catch(() => null);
    if (t && scan && takeText(t)) {
      stopScan();
      navigator.vibrate?.(60);
      pair();
    }
  }, 300) };
}
function stopScan() {
  if (!scan) return;
  clearInterval(scan.timer);
  scan.s.getTracks().forEach((t) => t.stop());
  scan = null;
  $('#scanBox').hidden = true;
  $('#scanBtn').textContent = 'Scan the studio\u2019s code';
}
$('#scanBtn').onclick = startScan;
window.vmRemoteTake = takeText; // (tests: as if scanned)
$('#name').value = localStorage.getItem('vm_remote_name') || 'Phone remote';
$('#show').value = eventId;
if (code) $('#code').value = `${code.slice(0, 4)}-${code.slice(4)}`;

if (key && eventId && !code) {
  showControls();
  connect();
} else if (code && eventId) {
  pair();
} else if (eventId && knownKeys().length) {
  pair(); // (the last show, or a new one by its link: try the keys this phone has)
}
