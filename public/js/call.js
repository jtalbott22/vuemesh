// A call (/call): a few people on cameras and screens, everyone connected to everyone. This is the
// page; joining, the waiting room and the links themselves are callmesh.js (shared with the studio,
// which can join a call too, and another computer's screen).
import { $, toast, esc, announce } from '/js/vm.js';
import { CallMesh, MAX_PEOPLE, startCall, callLink } from '/js/callmesh.js';
import { LiveCaptions, captionSupport, installCaptions } from '/js/captions.js';

// ---- what this page was opened with ----
const params = new URLSearchParams(location.search);
let callId = (params.get('e') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
let roomKey = new URLSearchParams(location.hash.slice(1)).get('k') || (callId && localStorage.getItem('vm_callkey_' + callId)) || '';
let pin = ''; // (typed, to come in with the code)
// (the key stays in the address so the link can be shared from it; the # never reaches a server)

const show = (id) => {
  for (const v of ['homeView', 'preView', 'waitView', 'callView', 'endView']) $('#' + v).hidden = v !== id;
};
const myPin = () => localStorage.getItem('vm_callpin_' + callId) || '';
const hostKey = () => localStorage.getItem('vm_host_' + callId) || '';
const pinLine = () => (myPin() ? `Or they open <b>${esc(location.host)}/call</b> and type the code <b>${esc(callId)}</b> and PIN <span class="pin">${esc(myPin())}</span>` : '');

// ---- 1. start a call, or join one with its code and PIN ----
$('#startBtn').onclick = async () => {
  const b = $('#startBtn');
  b.disabled = true;
  $('#homeErr').textContent = '';
  try {
    const c = await startCall();
    callId = c.id;
    roomKey = c.key;
    history.replaceState(null, '', `/call?e=${callId}#k=${roomKey}`);
    preJoin();
  } catch (e) {
    $('#homeErr').textContent = e.message;
    b.disabled = false;
  }
};
$('#codeForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#homeErr').textContent = '';
  callId = $('#code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  pin = $('#pin').value.replace(/\D/g, '');
  if (callId.length !== 6 || pin.length !== 6) return void ($('#homeErr').textContent = 'A call code is 6 letters and numbers, and its PIN 6 digits');
  try {
    await newMesh().enter();
    history.replaceState(null, '', `/call?e=${callId}`);
    preJoin();
  } catch (err) {
    $('#homeErr').textContent = err.message;
  }
};

// ---- 2. before joining: name, microphone and camera ----
let local = null; // MediaStream: microphone and camera
let screen = null; // MediaStream: this computer's screen, while shared
let micOn = localStorage.getItem('vm_call_mic') !== '0';
let camOn = localStorage.getItem('vm_call_cam') !== '0';
let myName = '';
let mesh = null;
const tiles = new Map(); // peer id → tile

function newMesh() {
  return (mesh = new CallMesh({
    id: callId, key: roomKey, pin, name: myName,
    tracks: () => ({ audio: soundOut(), camera: local?.getVideoTracks()[0], screen: screen?.getVideoTracks()[0] }),
    state: () => ({ mic: micOn, cam: camOn, screen: !!screen }),
    on: {
      waiting: () => show('waitView'),
      in: toCall,
      peer: () => renderAll(),
      message: (id, p, m) => onMessage(id, p, m),
      change: (id, p, why) => {
        // (someone new: what this device wants and can do about captions, said to them)
        if (why === 'hello') tellCaptions(p);
        if (why === 'hello' && p.joinedLate) {
          toast(`${p.name} joined`);
          announce(`${p.name} joined the call`);
        }
        renderAll();
      },
      gone: (id, p) => {
        tiles.get(id)?.remove();
        tiles.delete(id);
        toast(`${p.name || 'Someone'} left`);
        announce(`${p.name || 'Someone'} left the call`);
        renderAll();
        renderPeople();
      },
      refused: (why) => toast(why, 5000),
      knock: (id, name) => {
        if (!mesh?.canRun) return; // (the studio lets people into its call: it's told, not the guests)
        renderPeople(); // (the bar across the top, with Let in)
        toast(`${name} is waiting to come in`, 6000);
        announce(`${name} is waiting to come in`);
      },
      waitingChange: () => renderPeople(),
      locked: (on, byMe) => {
        $('#lockTag').hidden = !on;
        $('#lockBtn').setAttribute('aria-pressed', String(on));
        $('#lockBtn').textContent = on ? 'Unlock the call' : 'Lock the call';
        if (!byMe) toast(on ? 'The call was locked: nobody new can come in' : 'The call was unlocked');
      },
      removed: (block) => end(block ? 'You were taken out of the call' : 'You weren’t let in', block ? 'Someone in the call took you out, and you can’t come back to it.' : '', false),
      full: () => toast(`The call is full (${MAX_PEOPLE} people)`),
    },
  }));
}

// the picture asked of every camera: 16:9, 720p (a phone held upright gives its upright version)
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 }, frameRate: { ideal: 30 } };

async function preJoin() {
  show('preView');
  $('#preTitle').textContent = `Join call ${callId}`;
  $('#preSay').textContent = roomKey ? 'You have the link: you’ll be let in by someone in the call (or go straight in, if nobody’s there yet).' : 'Someone in the call will let you in.';
  $('#name').value = localStorage.getItem('vm_name') || '';
  if (roomKey && (hostKey() || myPin())) {
    $('#preInvite').hidden = false;
    $('#preLink').textContent = callLink(callId, roomKey);
    $('#prePin').innerHTML = pinLine();
  }
  await openMedia();
}
async function openMedia() {
  try {
    local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: VIDEO,
    });
  } catch (e) {
    try {
      local = await navigator.mediaDevices.getUserMedia({ audio: true }); // (no camera: sound alone)
      camOn = false;
      $('#preErr').textContent = 'No camera: you’ll be heard, not seen.';
    } catch {
      local = new MediaStream();
      micOn = camOn = false;
      $('#preErr').textContent = e.name === 'NotAllowedError' ? 'Allow the camera and microphone to be seen and heard (you can still watch).' : 'No camera or microphone found: you can still watch.';
    }
  }
  $('#preVideo').srcObject = local;
  applyToggles();
  showFlip(); // (the cameras' list is only full once one's allowed)
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => showFlip());
// A control's words: in its label when it has an icon (the call's bar), else the button itself
function setLabel(btn, text) {
  const lb = btn.querySelector('.lb');
  if (lb) lb.textContent = text;
  else btn.textContent = text;
}
function applyToggles() {
  for (const t of local?.getAudioTracks() || []) t.enabled = micOn;
  for (const t of local?.getVideoTracks() || []) t.enabled = camOn;
  for (const [id, on, what] of [['#preMic', micOn, 'Microphone'], ['#preCam', camOn, 'Camera'], ['#micBtn', micOn, 'Mic'], ['#camBtn', camOn, 'Camera']]) {
    $(id).setAttribute('aria-pressed', String(on));
    // (in the call's bar, the icon says on or off, slashed and red when off, and the button's pressed
    // state says it to a screen reader: the word stays short, so six fit across a phone)
    setLabel($(id), $(id).querySelector('.lb') ? what : `${what} ${on ? 'on' : 'off'}`);
  }
  localStorage.setItem('vm_call_mic', micOn ? '1' : '0');
  localStorage.setItem('vm_call_cam', camOn ? '1' : '0');
  mesh?.say({ t: 'state', mic: micOn, cam: camOn });
  renderSelf();
}
$('#preMic').onclick = $('#micBtn').onclick = () => { micOn = !micOn; applyToggles(); };
$('#preCam').onclick = $('#camBtn').onclick = () => { camOn = !camOn; applyToggles(); };

$('#joinForm').onsubmit = async (e) => {
  e.preventDefault();
  $('#preErr').textContent = '';
  myName = $('#name').value.trim().slice(0, 40) || 'Guest';
  localStorage.setItem('vm_name', myName);
  $('#joinBtn').disabled = true;
  try {
    const m = newMesh();
    await m.enter(); // (said here, why not: the socket can only say no)
    await m.join();
  } catch (err) {
    $('#preErr').textContent = err.message;
  } finally {
    $('#joinBtn').disabled = false;
  }
};

// ---- 3. the call ----
function toCall() {
  show('callView');
  $('#callCode').textContent = callId;
  announce('You’re in the call');
  renderSelf();
  renderAll();
  syncCaptioning();
}

// ---- share a screen: into everyone's third place (no new offer) ----
const canShare = !!navigator.mediaDevices?.getDisplayMedia;
const isMac = /Mac/.test(navigator.platform || navigator.userAgent), isLinux = /Linux/.test(navigator.platform || '') && !/Android/.test(navigator.userAgent);
const soundHow = isMac || isLinux
  ? `For sound, share a Chrome tab and tick Share tab audio (${isMac ? 'a Mac' : 'Linux'} shares a tab’s sound, not the whole computer’s).`
  : 'For sound, tick Share tab audio, or Share system audio for the whole screen.';
$('#shareBtn').title = `A screen, a window or a tab, with its sound. ${soundHow}`;

// A shared screen's sound, mixed with this microphone into the one sound everyone hears from you. A
// call has one place for each person's sound, so the screen's goes in with the voice: everyone (and a
// studio in the call, and pages from before this) hears it with nothing new to receive. Mic off still
// mutes only the voice: a muted microphone is silence going into the mix. It isn't played here: you
// already hear it from this computer.
let mix = null; // { ctx, mic, sa, track }
function soundOut() {
  const sa = screen?.getAudioTracks()[0], mic = local?.getAudioTracks()[0];
  if (!sa) {
    closeMix();
    return mic;
  }
  if (mix?.sa !== sa || mix?.mic !== mic) {
    closeMix();
    try {
      const ctx = new AudioContext();
      ctx.resume?.().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      for (const t of [mic, sa]) if (t) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest);
      mix = { ctx, mic, sa, track: dest.stream.getAudioTracks()[0] };
    } catch {
      return mic;
    }
  }
  return mix.track;
}
function closeMix() {
  mix?.ctx.close().catch(() => {});
  mix = null;
}
$('#shareBtn').hidden = !canShare;
$('#shareBtn').onclick = async () => {
  if (screen) return stopShare();
  try {
    // (with its sound, if they tick Share tab audio or Share system audio in the browser's picker; never
    // this tab, or the call's own sound, which would send everyone their own voices back)
    screen = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 15 } },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true },
      systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include',
    });
  } catch {
    return; // (they chose not to)
  }
  const v = screen.getVideoTracks()[0];
  if (v) v.contentHint = 'detail';
  v?.addEventListener('ended', stopShare);
  mesh?.refill();
  toast(screen.getAudioTracks().length ? 'Its sound goes to the call too.' : `No sound with it. ${soundHow}`, 6000);
  $('#shareBtn').setAttribute('aria-pressed', 'true');
  setLabel($('#shareBtn'), 'Stop');
  $('#shareBtn').setAttribute('aria-label', 'Stop sharing your screen');
  renderAll();
};
function stopShare() {
  if (!screen) return;
  for (const t of screen.getTracks()) t.stop();
  screen = null;
  mesh?.refill();
  closeMix();
  $('#shareBtn').setAttribute('aria-pressed', 'false');
  setLabel($('#shareBtn'), 'Share');
  $('#shareBtn').setAttribute('aria-label', 'Share your screen');
  renderAll();
}

// ---- the picture: everyone's camera in a grid, a shared screen above it ----
let selfTile = null;
function makeTile(id) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = id;
  el.innerHTML = '<video autoplay playsinline muted></video><div class="off" hidden></div><span class="state" hidden></span><span class="who"><span></span></span><p class="cc"></p><span class="ccnote" hidden></span><button type="button" class="fs" data-fs aria-label="Full screen">⛶</button>';
  return el;
}
// Pictures play muted, so a browser always lets them start; each one is given its tracks afresh
// when they change (a browser such as Safari doesn't take a track added to a stream it's already
// showing). The sound plays apart, below.
const trackKey = (tracks) => tracks.map((t) => t.id).join(',');
function setTracks(media, tracks) {
  if (media.dataset.tracks === trackKey(tracks)) return false;
  media.dataset.tracks = trackKey(tracks);
  media.srcObject = tracks.length ? new MediaStream(tracks) : null;
  media.play?.().catch(() => {});
  return true;
}
function fillTile(el, { stream, name, mic, cam, state, cc = '', ccNote = '', ccOk = false }) {
  // (their words, while captions are on here; and a small CC on their picture: plain when their
  // device captions them, struck through when it can't, the reason on hover and to a screen reader)
  const c = el.querySelector('.cc');
  const words = ccWant ? cc : '';
  if (c.textContent !== words) c.textContent = words;
  const n = el.querySelector('.ccnote');
  n.hidden = !ccWant || !(ccNote || ccOk);
  n.textContent = n.hidden ? '' : 'CC';
  n.classList.toggle('cant', !!ccNote);
  const why = ccNote ? ccNote[0].toUpperCase() + ccNote.slice(1) : 'Captions on';
  n.title = why;
  n.setAttribute('aria-label', why);
  n.setAttribute('role', 'img');
  const v = el.querySelector('video');
  setTracks(v, stream?.getVideoTracks() || []);
  v.muted = true;
  const showPic = cam && stream?.getVideoTracks().some((t) => t.readyState === 'live');
  v.hidden = !showPic;
  const off = el.querySelector('.off');
  off.hidden = showPic;
  off.textContent = (name || '?').trim().slice(0, 1).toUpperCase();
  el.querySelector('.who span').textContent = name || 'Joining…';
  // (muted: a struck microphone after the name, said in words to a screen reader)
  let mut = el.querySelector('.who .mut');
  if (!mic && !mut) {
    mut = document.createElement('i');
    mut.className = 'mut';
    mut.setAttribute('role', 'img');
    mut.setAttribute('aria-label', 'muted');
    mut.title = 'Muted';
    mut.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M3 3l18 18"/></svg>';
    el.querySelector('.who').append(mut);
  } else if (mic && mut) mut.remove();
  const st = el.querySelector('.state');
  st.hidden = !state;
  st.textContent = state || '';
}
function renderSelf() {
  if (!mesh?.inCall) return;
  if (!selfTile) {
    selfTile = makeTile('self');
    selfTile.classList.add('self');
    $('#grid').prepend(selfTile);
  }
  // (a back camera isn't shown as in a mirror)
  selfTile.classList.toggle('nomirror', local?.getVideoTracks()[0]?.getSettings?.().facingMode === 'environment');
  fillTile(selfTile, { stream: local, name: `${myName} (you)`, mic: micOn, cam: camOn, cc: ccSaid, ccNote: ccNoteOf(ccCan), ccOk: ccCan === 'yes' });
  markBig();
}

// ---- each person's sound: its own player, started by hand ----
// (if the browser won't start it without a tap, a button says so, and that tap starts them all)
const sounds = new Map(); // peer id → <audio>
function syncSound() {
  for (const [id, p] of mesh?.peers || []) {
    let a = sounds.get(id);
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true;
      a.setAttribute('playsinline', '');
      a.hidden = true;
      document.body.append(a);
      sounds.set(id, a);
    }
    if (setTracks(a, p.cam$.getAudioTracks()) || a.paused) a.play?.().then(() => tapNeeded(false), () => a.srcObject && tapNeeded(true));
  }
  for (const [id, a] of sounds) if (!mesh?.peers.has(id)) { a.srcObject = null; a.remove(); sounds.delete(id); }
}
function tapNeeded(on) {
  $('#hearBtn').hidden = !on;
}
$('#hearBtn').onclick = () => {
  for (const a of sounds.values()) a.play?.().catch(() => {});
  $('#screenVideo').play?.().catch(() => {});
  tapNeeded(false);
};

// ---- tap a picture: big, the others in a row under it; tap again, back to the grid ----
let big = null; // a peer id, 'self', or null
function markBig() {
  if (big && big !== 'self' && !tiles.has(big)) big = null;
  for (const el of $('#grid').children) el.classList.toggle('big', el.dataset.id === big);
  $('#grid').classList.toggle('has-big', !!big);
}
$('#stage').addEventListener('click', (e) => {
  const fs = e.target.closest('[data-fs]');
  if (fs) return void toggleFull(fs.closest('.tile, .screen'));
  if (e.target.closest('.fsfake')) return; // (a tap on a picture full screen leaves it as it is)
  const tile = e.target.closest('.tile');
  if (!tile || !tile.dataset.id) return;
  big = big === tile.dataset.id ? null : tile.dataset.id;
  markBig();
});
// Full screen: the browser's own where it has it for a page's element (a computer, Android); on an
// iPhone, which only has it for its video player (with its controls, and the picture left paused
// after), the picture fills the page instead: over everything, clear of the top blur. ⛶ again, or
// Escape, and it's back.
function toggleFull(box) {
  if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
  const on = document.querySelector('.fsfake');
  if (on) return void endFake(on);
  if (box.requestFullscreen && document.fullscreenEnabled) return void box.requestFullscreen().catch(() => startFake(box));
  startFake(box);
}
function startFake(box) {
  box.classList.add('fsfake');
  document.body.classList.add('fsfake-on');
  box.querySelector('[data-fs]')?.setAttribute('aria-label', 'Leave full screen');
  box.querySelector('video')?.play?.().catch(() => {});
}
function endFake(box) {
  box.classList.remove('fsfake');
  document.body.classList.remove('fsfake-on');
  box.querySelector('[data-fs]')?.setAttribute('aria-label', 'Full screen');
  box.querySelector('video')?.play?.().catch(() => {});
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelector('.fsfake') && endFake(document.querySelector('.fsfake')));
// (pictures keep playing: one paused by the system, coming back from full screen or from another app,
// starts again; they're muted, so a browser always lets them)
document.addEventListener('pause', (e) => {
  const v = e.target;
  if (v instanceof HTMLVideoElement && v.srcObject && !document.hidden) setTimeout(() => v.paused && v.play().catch(() => {}), 200);
}, true);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const v of document.querySelectorAll('video')) if (v.srcObject && v.paused) v.play().catch(() => {});
  for (const a of sounds.values()) if (a.srcObject && a.paused) a.play().catch(() => tapNeeded(true));
});

// ---- switch camera: the front and back of a phone, or the next camera on a computer ----
async function cameras() {
  return (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((d) => d.kind === 'videoinput');
}
async function showFlip() {
  const many = (await cameras()).length > 1;
  $('#flipBtn').hidden = $('#preFlip').hidden = !many;
}
async function flipCamera() {
  const old = local?.getVideoTracks()[0];
  if (!local || !old) return;
  const s = old.getSettings?.() || {};
  const cams = await cameras();
  const next = s.facingMode
    ? { facingMode: { exact: s.facingMode === 'user' ? 'environment' : 'user' } }
    : { deviceId: { exact: cams[(cams.findIndex((d) => d.deviceId === s.deviceId) + 1) % cams.length]?.deviceId } };
  old.stop(); // (a phone opens one camera at a time)
  let t = null;
  // (always the same picture as the first camera: asked for nothing but a camera, a phone gives a square)
  const soft = next.facingMode ? { facingMode: next.facingMode.exact } : { deviceId: next.deviceId?.exact };
  for (const video of [{ ...next, ...VIDEO }, { ...soft, ...VIDEO }, { deviceId: s.deviceId ? { exact: s.deviceId } : undefined, ...VIDEO }]) { // (or the one it had)
    try {
      t = (await navigator.mediaDevices.getUserMedia({ video })).getVideoTracks()[0];
      break;
    } catch {}
  }
  local.removeTrack(old);
  if (t) {
    t.enabled = camOn;
    local.addTrack(t);
  } else toast('The camera couldn’t be opened');
  $('#preVideo').srcObject = local;
  $('#preVideo').classList.toggle('nomirror', t?.getSettings?.().facingMode === 'environment');
  mesh?.refill(); // (into everyone's link: no new offer)
  renderSelf();
}
$('#flipBtn').onclick = $('#preFlip').onclick = () => flipCamera();
function renderAll() {
  if (!mesh?.inCall) return;
  renderSelf();
  let shown = null;
  for (const [id, p] of mesh.peers) {
    if (!tiles.has(id)) {
      tiles.set(id, makeTile(id));
      $('#grid').append(tiles.get(id));
    }
    const st = p.pc.connectionState;
    fillTile(tiles.get(id), { cc: p.cc && Date.now() - p.ccAt < 8000 ? p.cc : '', ccNote: ccNoteOf(p.ccCan), ccOk: p.ccCan === 'yes', stream: p.cam$, name: p.name, mic: p.mic, cam: p.cam, state: st === 'connected' ? [p.relayed ? 'relay' : '', p.mic && p.hearing === false ? 'no sound coming' : ''].filter(Boolean).join(' · ') : st === 'failed' ? 'no connection' : 'connecting…' });
    if (p.sharing && p.screen$.getVideoTracks().length) shown = { stream: p.screen$, who: p.name };
  }
  for (const [id, el] of tiles) if (!mesh.peers.has(id)) { el.remove(); tiles.delete(id); }
  syncSound();
  markBig();
  if (!shown && screen) shown = { stream: screen, who: 'You', self: true };
  $('#screenBox').hidden = !shown;
  $('#stage').classList.toggle('has-screen', !!shown);
  if (shown) {
    const v = $('#screenVideo');
    setTracks(v, shown.stream.getVideoTracks()); // (a screen's sound comes with its sharer's, in their player)
    // (its box takes the screen's own shape, once its picture says what it is)
    if (v.videoWidth && v.videoHeight) $('#screenBox').style.setProperty('--shape', `${v.videoWidth} / ${v.videoHeight}`);
    v.onresize ||= () => v.videoWidth && $('#screenBox').style.setProperty('--shape', `${v.videoWidth} / ${v.videoHeight}`);
    v.muted = true;
    $('#screenWho').textContent = `${shown.who || 'Someone'}’s screen`;
  }
  $('#callSay').textContent = `${mesh.peers.size + 1} in the call`;
  renderStudioNote();
}

// ---- a studio in the call: said plainly, and whether it's recording or live now ----
// (it's a studio by the server's word: it proved it with its show's key; what it's doing, by its own)
let studioSeen = false, studioSaid = '';
function renderStudioNote() {
  const st = [...(mesh?.peers.values() || [])].filter((p) => p.studio);
  const note = $('#studioNote');
  note.hidden = !st.length;
  if (!st.length) return void (studioSeen = false);
  const s = st[0], rec = st.some((p) => p.rec), live = st.some((p) => p.live);
  note.innerHTML = `<b>${esc(s.name || 'A studio')}</b> is in this call: what you send (your picture, sound and screen) can be put on its show, and recorded or streamed by it.${rec ? '<span class="tag rec">● Recording</span>' : ''}${live ? '<span class="tag live">● Live</span>' : ''}`;
  const said = `${rec}${live}`;
  if (!studioSeen || studioSaid !== said) announce(`${s.name || 'A studio'} is in this call${rec ? ', recording' : ''}${live ? ', live' : ''}`);
  studioSeen = true;
  studioSaid = said;
}

// ---- a message from the studio (as a phone gets its director's): seen at once, answered if you like ----
let dirMsg = null; // { p, id }
function showStudioMsg(p, m) {
  dirMsg = { p, id: String(m.id || '') };
  $('#dirFrom').textContent = `${p.name || 'The studio'}${m.all ? ' (to everyone)' : ''}:`;
  $('#dirText').textContent = String(m.text || '').slice(0, 500);
  $('#dirReply').value = '';
  $('#dirMsg').hidden = false;
  announce(`Message from ${p.name || 'the studio'}: ${m.text}`);
  navigator.vibrate?.(60);
  sendTo(p, { t: 'msgseen', id: dirMsg.id });
}
$('#dirForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#dirReply').value.trim();
  if (text && dirMsg) {
    sendTo(dirMsg.p, { t: 'msgreply', id: dirMsg.id, text: text.slice(0, 200) });
    toast('Sent to the studio');
  }
  $('#dirMsg').hidden = true;
};
$('#dirOk').onclick = () => ($('#dirMsg').hidden = true);

// ---- captions: each person's words, worked out on their own device ----
// Anyone who turns Captions on sees everyone's words on their pictures. For that, each device
// recognises its own microphone, on the device only (the browser's on-device speech model: the
// sound isn't sent to anyone for it), while anyone in the call wants captions, and sends the words
// to the others over the call's own encrypted links. Where a browser can't recognise speech on the
// device, its picture says so.
const ccLang = navigator.language || 'en-US';
let ccWant = localStorage.getItem('vm_call_cc') === '1';
let cc = null; // this device's recogniser, on its own microphone
let ccCan = null; // 'yes', 'download' (the speech model isn't here yet), 'no', 'nomic'
let ccSaid = '';
const ccNoteOf = (can) => ({ no: 'no captions from this browser', download: 'captions: speech model not downloaded', nomic: 'no microphone to caption' }[can] || '');
const sendTo = (p, m) => { if (p.dc?.readyState === 'open') try { p.dc.send(JSON.stringify(m)); } catch {} };
function tellCaptions(p) {
  sendTo(p, { t: 'ccwant', on: ccWant });
  if (ccCan) sendTo(p, { t: 'cccan', can: ccCan });
}
function onMessage(id, p, m) {
  // (a message from the studio's crew messages: only from a studio, by the server's word)
  if (m.t === 'studiomsg') return void (p.studio && showStudioMsg(p, m));
  if (m.t === 'ccwant') {
    p.ccWant = !!m.on;
    syncCaptioning();
  } else if (m.t === 'cccan') p.ccCan = String(m.can || '');
  else if (m.t === 'cc') {
    p.cc = String(m.text || '').slice(0, 300);
    p.ccAt = Date.now();
  } else return;
  renderAll();
}
async function ccSupport() {
  const s = await captionSupport(ccLang);
  return s === 'available' ? 'yes' : s === 'downloadable' || s === 'downloading' ? 'download' : 'no';
}
function setCcCan(can) {
  if (ccCan === can) return;
  ccCan = can;
  mesh?.say({ t: 'cccan', can });
  renderSelf();
}
/** Recognise this device's microphone while anyone in the call wants captions; stop when nobody does */
async function syncCaptioning() {
  const want = !!mesh?.inCall && (ccWant || [...mesh.peers.values()].some((p) => p.ccWant));
  if (!want) {
    if (cc) {
      cc.stop();
      cc = null;
    }
    return;
  }
  if (cc || syncCaptioning.busy) return;
  syncCaptioning.busy = true;
  try {
    const can = await ccSupport();
    if (!ccHere) {
      ccHere = can;
      applyCcView();
    }
    const track = local?.getAudioTracks()[0];
    if (can !== 'yes') return setCcCan(can);
    if (!track) return setCcCan('nomic');
    cc = new LiveCaptions({
      lang: ccLang,
      onState: (what, why) => {
        if (what !== 'error') return;
        console.warn('call: captions', why);
        cc = null;
        setCcCan('no');
      },
    });
    cc.start(track);
    setCcCan('yes');
  } finally {
    syncCaptioning.busy = false;
  }
}
// (what's recognised, to everyone: as it changes, nothing while the microphone's off)
setInterval(() => {
  if (!mesh?.inCall) return;
  const t = cc && micOn ? cc.text().slice(-240) : '';
  if (t === ccSaid) return;
  ccSaid = t;
  mesh.say({ t: 'cc', text: t });
  renderSelf();
}, 300);
setInterval(() => mesh?.inCall && ccWant && renderAll(), 2000); // (words from someone who's gone quiet clear)

// Can this browser make captions? Asked once, the first time anyone wants them (it doesn't change
// while the page is open, and asking early isn't safe everywhere: see captions.js). Captions
// are made on each person's own device, and only Chrome and Edge on a computer can (not an iPhone,
// Safari or Firefox). A device that can't still shows the words of anyone whose device can: so a
// tap there turns captions on only when someone in the call is making them, and otherwise says
// why and stays off, struck through. It never looks on with nothing coming.
let ccHere = null; // null: not asked yet; then 'yes', 'download' or 'no'
const CC_CANT = 'This browser can’t make captions: they’re made on each device, and only Chrome or Edge on a computer can.';
async function checkCcHere() {
  if (!ccHere) {
    ccHere = await ccSupport();
    // (left on from before, on a device that can't: off, until a tap finds someone making them)
    if (ccHere === 'no' && ccWant) {
      ccWant = false;
      localStorage.setItem('vm_call_cc', '0');
    }
    applyCcView();
  }
  return ccHere;
}
const othersCaption = () => [...(mesh?.peers.values() || [])].some((p) => p.ccCan === 'yes');
/** On a device that can't: ask the others, and wait a moment for any of them to say they're captioning */
async function anyoneCaptions() {
  if (othersCaption()) return true;
  mesh?.say({ t: 'ccwant', on: true });
  for (let i = 0; i < 16 && !othersCaption(); i++) await new Promise((r) => setTimeout(r, 250));
  if (!othersCaption()) mesh?.say({ t: 'ccwant', on: false });
  return othersCaption();
}
function applyCcView() {
  const cant = ccHere === 'no' && !ccWant;
  $('#ccBtn').classList.toggle('cant', cant);
  $('#ccBtn').setAttribute('aria-pressed', String(ccWant));
  $('#ccBtn').title = ccHere === 'no' ? `${CC_CANT} You see the words of anyone whose device makes them.` : 'Captions: each person’s words, worked out on their own device';
  setLabel($('#ccBtn'), cant ? 'No captions' : ccWant ? 'Captions on' : 'Captions');
  $('#ccSizeBtn').hidden = $('#ccPosBtn').hidden = !ccWant;
  const sizes = ['0.9rem', '1.05rem', '1.35rem', '1.7rem'];
  const i = Math.min(sizes.length - 1, Math.max(0, +(localStorage.getItem('vm_call_ccsize') ?? 1)));
  $('#stage').style.setProperty('--cc', sizes[i]);
  $('#ccSizeBtn').setAttribute('aria-label', `Caption size: ${['small', 'medium', 'large', 'largest'][i]}`);
  const top = localStorage.getItem('vm_call_ccpos') === 'top';
  $('#grid').classList.toggle('cc-top', top);
  $('#ccPosBtn').setAttribute('aria-label', `Captions at the ${top ? 'top' : 'bottom'} of each picture`);
}
$('#ccBtn').onclick = async () => {
  if (!ccWant && (await checkCcHere()) === 'no') {
    const b = $('#ccBtn');
    b.disabled = true;
    const some = await anyoneCaptions().finally(() => (b.disabled = false));
    const say = some ? `${CC_CANT} Your words won’t be captioned; you’ll see the others’.` : `No captions. ${CC_CANT} Nobody else in the call can make them right now.`;
    toast(say, 7000);
    announce(say);
    if (!some) return;
  }
  ccWant = !ccWant;
  localStorage.setItem('vm_call_cc', ccWant ? '1' : '0');
  applyCcView();
  mesh?.say({ t: 'ccwant', on: ccWant });
  // (this browser's speech model, the first time: it needs this click to be fetched)
  if (ccWant && (await ccSupport()) === 'download') {
    toast('Getting this browser’s speech model (once)…', 6000);
    if (await installCaptions(ccLang).catch(() => false)) ccCan = null;
  }
  announce(ccWant ? 'Captions on' : 'Captions off');
  syncCaptioning();
  renderAll();
};
$('#ccSizeBtn').onclick = () => {
  localStorage.setItem('vm_call_ccsize', String((+(localStorage.getItem('vm_call_ccsize') ?? 1) + 1) % 4));
  applyCcView();
};
$('#ccPosBtn').onclick = () => {
  localStorage.setItem('vm_call_ccpos', localStorage.getItem('vm_call_ccpos') === 'top' ? 'bottom' : 'top');
  applyCcView();
};
applyCcView();

// ---- people: who's in, who's waiting; let in, take out, lock ----
// Someone waiting: a bar across the top of the call, with their name, Let in and Turn away, for as
// long as they wait (only for whoever can let them in; in a studio's call that's the studio)
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
function renderKnocks() {
  const box = $('#knocks'), run = !!mesh?.canRun, list = run ? [...mesh.waiting] : [];
  box.hidden = !list.length;
  box.innerHTML = list.map(([id, name]) => `<div class="knock"><span class="bell">${BELL}</span><p><b>${esc(name)}</b> is waiting to come in</p><span class="acts"><button type="button" class="primary" data-admit="${esc(id)}">Let in</button><button type="button" data-deny="${esc(id)}">Turn away</button></span></div>`).join('');
}
$('#knocks').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || !mesh) return;
  if (b.dataset.admit) {
    announce(`Letting ${mesh.waiting.get(b.dataset.admit) || 'them'} in`);
    mesh.admit(b.dataset.admit);
  } else if (b.dataset.deny) mesh.turnAway(b.dataset.deny);
  renderPeople();
};
function renderPeople() {
  if (!mesh) return;
  renderKnocks();
  // (a studio's call, with the studio in it: the studio lets people in, takes them out and locks it;
  // the guests see who's waiting and who's in. Nobody takes a studio out. Anyone can leave)
  const n = mesh.waiting.size, run = mesh.canRun;
  $('#waitBadge').hidden = !n || !run;
  $('#waitBadge').textContent = String(n);
  $('#waitingPart').hidden = !n;
  $('#waitingList').innerHTML = [...mesh.waiting].map(([id, name]) => `<li><b>${esc(name)}</b>${run ? `<button type="button" class="primary" data-admit="${esc(id)}">Let in</button><button type="button" data-deny="${esc(id)}">Turn away</button>` : '<span class="fine">The studio lets them in</span>'}</li>`).join('');
  $('#inList').innerHTML = `<li><b>${esc(myName)} (you)</b></li>` + [...mesh.peers].map(([id, p]) => `<li><b>${esc(p.name || 'Joining…')}</b>${p.studio ? '<span class="fine">Studio</span>' : run ? `<button type="button" data-remove="${esc(id)}">Take out</button>` : ''}</li>`).join('');
  $('#lockBtn').hidden = !run;
  $('#peopleRule').textContent = run ? 'Locked: nobody new comes in, even with the link. Anyone in the call can let people in, take them out, or lock it. Nobody can take a studio out.' : 'This is the studio’s call: it lets people in, takes them out and locks it. You can leave whenever you like.';
}
$('#peopleBtn').onclick = () => { renderPeople(); $('#peopleBox').showModal(); };

// More (on a phone): the rest of the controls in a panel above the bar. It closes when one of them
// is used (but not caption size or place, which you tap through), on a tap anywhere else, or Escape.
const moreOpen = (on) => {
  $('#bar').classList.toggle('open', on);
  $('#moreBtn').setAttribute('aria-expanded', String(on));
};
$('#moreBtn').onclick = (e) => { e.stopPropagation(); moreOpen(!$('#bar').classList.contains('open')); };
$('#moreSheet').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.id !== 'ccSizeBtn' && b.id !== 'ccPosBtn') moreOpen(false);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#bar')) moreOpen(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') moreOpen(false); });
$('#peopleBox').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || !mesh) return;
  if (b.dataset.admit) {
    announce(`Letting ${mesh.waiting.get(b.dataset.admit) || 'them'} in`);
    mesh.admit(b.dataset.admit);
  } else if (b.dataset.deny) mesh.turnAway(b.dataset.deny);
  else if (b.dataset.remove) {
    const p = mesh.peers.get(b.dataset.remove);
    if (!confirm(`Take ${p?.name || 'them'} out of the call? They can't come back to it.`)) return;
    mesh.takeOut(b.dataset.remove);
  } else if (b.id === 'lockBtn') mesh.lock(!mesh.locked);
  else if (b.dataset.close !== undefined) return $('#peopleBox').close();
  renderPeople();
};

// ---- invite: the link (and the PIN, for whoever started the call) ----
$('#inviteBtn').onclick = () => {
  $('#inviteLink').textContent = roomKey ? callLink(callId, roomKey) : 'You came in with the code and PIN: ask whoever started the call for the link.';
  $('#invitePin').innerHTML = pinLine();
  // (another computer showing only its screen: the same link, on the share page)
  $('#inviteShare').innerHTML = roomKey ? `Another computer showing just its screen (slides, a demo): <b class="link" style="display:block;margin-top:4px">${esc(`${location.origin}/share?e=${callId}#k=${roomKey}`)}</b>` : '';
  document.querySelectorAll('[data-copy-link]').forEach((b) => (b.hidden = !roomKey));
  $('#inviteBox').showModal();
};
$('#inviteBox').onclick = (e) => { if (e.target.closest('[data-close]')) $('#inviteBox').close(); };
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-copy-link]')) return;
  try {
    await navigator.clipboard.writeText(callLink(callId, roomKey));
    toast('Link copied');
  } catch {
    toast('Copy it from the box above');
  }
});

// ---- leaving ----
function end(title, why = '', canRejoin = true) {
  if (canRejoin) mesh?.leave();
  mesh = null;
  for (const el of tiles.values()) el.remove();
  tiles.clear();
  for (const a of sounds.values()) { a.srcObject = null; a.remove(); }
  sounds.clear();
  tapNeeded(false);
  big = null;
  cc?.stop();
  cc = null;
  ccSaid = '';
  stopShare();
  for (const t of local?.getTracks() || []) t.stop();
  local = null;
  selfTile?.remove();
  selfTile = null;
  show('endView');
  $('#endTitle').textContent = title;
  $('#endSay').textContent = why;
  $('#rejoinBtn').hidden = !canRejoin;
}
$('#leaveBtn').onclick = () => end('You left the call', 'Join again while it’s still going: it ends a day after it started.');
$('#waitLeave').onclick = () => end('You left', '');
$('#rejoinBtn').onclick = () => preJoin();
window.addEventListener('pagehide', () => mesh?.leave()); // (closing the tab, or going elsewhere: the same goodbye)

// ---- start ----
if (!callId) show('homeView');
else if (!roomKey && !hostKey()) {
  // a code without the link: the PIN, on the home page
  show('homeView');
  $('#code').value = callId;
  $('#pin').focus();
} else preJoin();

window.vmCall = () => ({ ccWant, ccCan, ccSaid, studioNote: $('#studioNote').hidden ? '' : $('#studioNote').textContent, callId, inCall: !!mesh?.inCall, me: mesh?.me, big, studioRules: !!mesh?.studioRules, peers: [...(mesh?.peers || [])].map(([id, p]) => ({ id, name: p.name, studio: !!p.studio, state: p.pc.connectionState, offers: p.offers, streams: p.cam$.getTracks().length, screen: p.sharing, hearing: p.hearing ?? null, cc: p.cc || '', ccCan: p.ccCan || null, rec: !!p.rec, live: !!p.live, playing: !!sounds.get(id) && !sounds.get(id).paused && !!sounds.get(id).srcObject?.getAudioTracks().length })), waiting: [...(mesh?.waiting.values() || [])], locked: !!mesh?.locked, sharing: !!screen, screenSound: !!mix }); // (tests)
