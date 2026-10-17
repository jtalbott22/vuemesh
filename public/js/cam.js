import {
  $, api, now, identity, signStatement, decodeQR, parseTimecode,
  meshSocket, wakeLock, toast, eventIdFromUrl, thumbprint, themeButton, helpDialog, announce, betaBanner, esc, rememberEvent, myEvents, fmtDur, diag, codecsOf, diagnosticsDialog,
} from '/js/vm.js';
import { TERMS_VERSION } from '/js/brand.js';
import { CamLink, sealClip } from '/js/rtc.js';
import { Sensors, PictureMeter, partsFrom } from '/js/sensors.js';
import { baseScore, hintFor } from '/js/director.js';
import { CameraKit, QUALITY, preferredCamera } from '/js/camctl.js';
import { withRotation } from '/js/mp4rot.js';
import { channelFixer } from '/js/audiofx.js';

// Phone or computer? Computers usually have no gyro or compass and a webcam that can't
// be turned, so they get different coaching and wording. (iPads report as Macs; touch tells.)
const IS_PHONE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const DEVICE = IS_PHONE ? 'phone' : 'device'; // (a tablet or a computer: "this device")
document.documentElement.dataset.device = DEVICE;
import * as idb from '/js/idb.js';

let eventId = eventIdFromUrl();
let ev, me, ident, socket, link;
let role = 'cam';

// ---------------------------------------------------------------- entry ----

betaBanner(true);
themeButton($('#themeBtn'));
if (localStorage.getItem('vm_terms') === TERMS_VERSION) $('#agreeGuest').checked = true;
const guestHelp = helpDialog('Shooting tips', [
  { heading: 'Camera', text: IS_PHONE ? 'Hold your phone the way the event asks (the prompt at the top tells you). Point it at the beacon screen once, when you join: the pill turns green (Synced), and from then on every clip lines up with everyone else\'s. Shoot steady, and keep this page open until your clips say delivered.' : 'Point this computer\'s camera at the action and keep it still. When you start recording, show it the beacon screen for a second so your clip lines up with everyone else\'s. Keep this page open until your clips say delivered.' },
  { heading: 'Camera controls', rows: [
    ['Zoom', 'Pinch the picture, drag the slider on the right, or tap a lens (0.5×, 1×, 2×)'],
    ['Tap', `Focus and expose on that spot (where the ${DEVICE} allows it)`],
    ['Hold', 'Lock focus and exposure (AE/AF LOCK)'],
    ['⚙', 'Choose the camera and the microphone separately, quality, exposure, mic level, grid, level and zebras'],
    ['⚡ / ⛶', 'Torch (if your phone has one) / full screen'],
    ['Left meter', 'Your microphone level: aim for yellow on the loud parts, never the red light'],
  ] },
  { heading: 'On air', text: 'A red frame and ON AIR mean the host is showing your camera right now: hold steady. The yellow line under the top bar coaches you if the shot needs help.' },
  { heading: 'The event button', text: 'Tap the event name (top left; its dot is green when you\'re live) to pause sending your camera, see the rundown and messages, or leave the event. Leaving takes you back to the camera\'s home, where Rejoin is one tap; clips you shot wait on this phone and send when you\'re back. If the director owes you part of the live cut, it arrives before you go (or skip it and get it next time).' },
  { heading: 'Messages', text: 'The director can send you short notes. They appear near the top for a few seconds: answer with 👍 or Can\'t, or tap × to dismiss. The line that starts NOW is the running order: what\'s happening and what\'s next.' },
  { heading: 'Microphone', text: 'Point the phone at the beacon to sync, lock it in, then set it face-up between the people talking. You can dim the screen; keep the phone plugged in for long events. Leave the event from the microphone screen; Rejoin brings you back as the microphone.' },
  { heading: 'If something goes wrong', text: (IS_PHONE ? 'Your clips wait safely on this phone until' : 'Your clips wait safely on this computer until') + ' the host gets them, even if you reload. Use Save to keep your own copy. If the pill says "Host not here yet", check that you\'re on the venue Wi-Fi shown on the beacon.' },
  { heading: 'Keys (with a keyboard)', rows: [['Space', 'Start or stop recording'], ['?', 'This help']] },
]);
$('#camHelp')?.addEventListener('click', () => guestHelp.showModal());

const SOLO_ID = 'SOLO';

// ---- the guided setup ----
// The browser's own permission questions come one at a time, each after a screen that says
// what it's for, so they never all pop up at once: camera and microphone; then (iPhones
// only) motion; then, the first time, what the director may do with this phone. All of it
// is remembered (Settings has the same choices), and a phone whose browser remembers its
// permissions goes straight to the camera next time.
// (only on a phone or tablet: some computers' browsers offer the motion permission too, but there's no
// motion sensor worth asking about, and the step would only stand in the way of the camera)
const MOTION_ASKS = IS_PHONE && !!(window.DeviceMotionEvent?.requestPermission || window.DeviceOrientationEvent?.requestPermission);
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(msg), { name: 'TimeoutError' })), ms))]);
async function guidedSetup(lastErr) {
  const first = !prefs.setupDone, view = $('#setupView');
  const steps = ['perm', ...(role === 'cam' && MOTION_ASKS && prefs.motion !== 'off' ? ['motion'] : [])];
  const show = (step) => {
    view.querySelectorAll('[data-step]').forEach((c) => (c.hidden = c.dataset.step !== step));
    view.querySelectorAll('[data-dot]').forEach((d) => {
      d.hidden = !steps.includes(d.dataset.dot) || steps.length < 2;
      d.classList.toggle('on', d.dataset.dot === step);
    });
    view.querySelector(`[data-step="${step}"] button`)?.focus();
  };
  $('#joinView').hidden = true;
  view.hidden = false;
  // 1. camera and microphone (a microphone: just the microphone)
  $('#setupTitle').textContent = role === 'mic' ? 'Your microphone' : 'Your camera and microphone';
  $('#setupWhy').textContent = role === 'mic' ? 'VUEMesh uses it to send your sound to the director and record it. Nothing goes anywhere but this event.' : 'VUEMesh uses them to show the director your shot and to record your clips. Nothing goes anywhere but this event, and you can pause any time.';
  $('#setupAllow').textContent = role === 'mic' ? 'Allow the microphone' : 'Allow camera and microphone';
  show('perm');
  if (lastErr) {
    $('#setupErr').hidden = false;
    $('#setupErr').textContent = lastErr.name === 'NotAllowedError' ? 'This phone has stopped letting VUEMesh use the camera. Tap below to allow it again.' : 'The camera didn\u2019t start. Tap below to try again.';
    $('#setupReload').hidden = false;
  }
  await new Promise((resolve) => {
    $('#setupAllow').disabled = false;
    $('#setupAllow').onclick = async () => {
      $('#setupAllow').disabled = true;
      $('#setupErr').hidden = true;
      try {
        if (role !== 'mic') makeAudio(); // (sound can only start inside a tap)
        await withTimeout(openCamera(), 10000, 'The camera didn\u2019t start');
        resolve();
      } catch (err) {
        $('#setupErr').hidden = false;
        $('#setupErr').textContent = err.name === 'NotAllowedError' ? 'The browser said no. Open the site settings next to the address (aA on iPhone), allow the camera and microphone, and tap again.' : err.name === 'TimeoutError' ? 'The camera still didn\u2019t start. Reload VUEMesh below (or close the app fully and open it again).' : err.message;
        $('#setupReload').hidden = false;
        $('#setupAllow').disabled = false;
      }
    };
  });
  // 2. motion (iPhone and iPad ask; other phones just have it)
  if (steps.includes('motion')) {
    show('motion');
    await new Promise((resolve) => {
      $('#setupMotion').onclick = async () => {
        prefs.motion = (await Sensors.requestPermission().catch(() => false)) ? 'on' : 'denied';
        resolve();
      };
      $('#setupMotionSkip').onclick = () => {
        prefs.motion = 'skipped';
        resolve();
      };
    });
  }
  // 3. what the director can do (the first time; Settings has it after)
  if (steps.includes('choose')) {
    show('choose');
    await renderLensChoices($('#setupLenses'));
    $('#setupRemote').checked = prefs.remoteCtl !== false;
    await new Promise((resolve) => {
      $('#setupDone').onclick = () => {
        prefs.remoteCtl = $('#setupRemote').checked;
        $('#tgRemote').checked = prefs.remoteCtl;
        resolve();
      };
    });
  }
  prefs.setupDone = true;
  savePrefs();
  view.hidden = true;
}

// Which of this phone's cameras the director may switch to. The front camera is off unless
// you turn it on: nobody gets put on screen by surprise. (Kept by kind of lens, not by the
// browser's device id, which can change between visits.)
const lensAllowed = (kind) => prefs.directorLens?.[kind] ?? kind !== 'front';
// The first time on the camera: what the director can do, and where to change it.
function controlNote() {
  if (prefs.ctlNoteSeen || role !== 'cam') return;
  const card = $('#ctlNote');
  card.hidden = false;
  // it doesn't stay in the way: it goes by itself after 20 s (and counts as seen)
  setTimeout(() => {
    if (card.hidden) return;
    prefs.ctlNoteSeen = true;
    savePrefs();
    card.hidden = true;
  }, 20000);
  $('#ctlNoteOk').onclick = () => {
    prefs.ctlNoteSeen = true;
    savePrefs();
    card.hidden = true;
  };
  $('#ctlNoteChange').onclick = () => {
    $('#ctlNoteOk').click();
    $('#camSettings').showModal();
  };
}
async function renderLensChoices(box) {
  const { cams } = await kit.devices().catch(() => ({ cams: [] }));
  const kinds = [...new Map(cams.map((c) => [c.lens === 'multi' ? 'wide' : c.lens, c])).keys()];
  const name = { ultra: 'Ultra wide', wide: 'Back camera', tele: 'Telephoto', front: 'Front camera (selfie)', other: 'Camera' };
  box.innerHTML = kinds.length
    ? kinds.map((k) => `<label class="check"><input type="checkbox" data-lens-kind="${k}" ${lensAllowed(k) ? 'checked' : ''}> ${name[k] || k}</label>`).join('')
    : '<p class="fine">No cameras found yet.</p>';
  box.onchange = (e) => {
    const k = e.target.dataset.lensKind;
    if (!k) return;
    prefs.directorLens = { ...(prefs.directorLens || {}), [k]: e.target.checked };
    savePrefs();
    sendCamState();
  };
}

// ---- watching the show: where it's streaming, while it's live ----
// The join page shows it to anyone who scans in; once you're in, a small red pill on the
// camera (and the microphone) screen opens it, so the crew can see what's going out.
function showWatch(w) {
  if (ev) ev.watch = w;
  for (const [sel, small] of [['#joinWatch', false], ['#camWatch', true], ['#micWatch', true]]) {
    const a = $(sel);
    if (!a) continue;
    a.hidden = !w?.url;
    if (!w?.url) continue;
    a.href = w.url;
    a.textContent = small ? `Live${w.label ? ` on ${w.label}` : ''}: watch` : `This event is live${w.label ? ` on ${w.label}` : ''}: watch it`;
    a.classList.toggle('small', small);
  }
}

// ---- the director's camera control ----
// From the studio's Camera control window the director can zoom (it glides here too), set
// brightness (the camera's exposure, or digital), contrast (digital), focus on a point they
// tap in the picture, lock focus and exposure, lock white balance, or put it all back to
// auto: what the person holding the phone can do, from the control room. This phone shows
// each change, and can turn remote control off in its settings.
let wbLocked = false, ctlSaid = 0, lensChoices = [];
function camState() {
  const zr = kit.zoomRange(), c = kit.caps(), ec = c.exposureCompensation;
  return {
    t: 'camstate', remote: prefs.remoteCtl !== false,
    z: Math.round((zoomGoal ?? kit.zoom ?? 1) * 100) / 100, zmin: zr.min, zmax: zr.max, zn: !!zr.native,
    ev: Math.round((kit.ev || 0) * 10) / 10, evmin: Math.max(-3, ec?.min ?? -2), evmax: Math.min(3, ec?.max ?? 2), evn: !!ec,
    ct: Math.round((kit.contrast || 1) * 100) / 100,
    focus: kit.can('pointsOfInterest') || kit.can('focusMode'),
    lenses: lensChoices.filter((c) => lensAllowed(c.kind)), lens: kit.deviceId || null, facing: kit.facing,
    lock: !!kit.locked, canLock: (c.focusMode || []).includes('manual') || (c.exposureMode || []).includes('manual'),
    wb: wbLocked, canWb: (c.whiteBalanceMode || []).includes('manual'),
  };
}
function sendCamState() {
  if (role === 'cam' && link && !link.left) link.control?.(camState());
}
setInterval(sendCamState, 3000);
/** A point in the live picture (0..1 of what the studio receives) as a point in the camera's own picture. */
function liveToCamera(u, v) {
  if (!upright?.S || !video.videoWidth) return { x: 0.5, y: 0.5 };
  const S = upright.S, phi = sensors.correction(), vw = video.videoWidth, vh = video.videoHeight;
  const turned = phi % 180 !== 0, k = S / Math.max(turned ? vh : vw, turned ? vw : vh);
  const px = u * S - S / 2, py = v * S - S / 2, a = (phi * Math.PI) / 180;
  const qx = px * Math.cos(a) - py * Math.sin(a), qy = px * Math.sin(a) + py * Math.cos(a);
  const z = kit.digitalZoom || 1, c01 = (x) => Math.min(1, Math.max(0, x));
  return { x: c01((1 - 1 / z) / 2 + (qx + (vw * k) / 2) / (vw * k) / z), y: c01((1 - 1 / z) / 2 + (qy + (vh * k) / 2) / (vh * k) / z) };
}
async function onCamCtl(m) {
  if (role !== 'cam' || prefs.remoteCtl === false) return sendCamState();
  const said = [];
  if (m.lens) {
    const c = lensChoices.find((x) => x.id === m.lens);
    if (c && !lensAllowed(c.kind)) {
      toast(`The director asked for your ${c.label.toLowerCase()} camera: it's kept private (Settings).`, 4000);
      return sendCamState();
    }
    if (c && c.id !== kit.deviceId) {
      await switchCamera(c.id, c.front ? 'user' : 'environment');
      await renderZoomRail();
      said.push(c.label);
    }
  }
  if (m.zoom != null) {
    setZoom(+m.zoom);
    said.push(`zoom ${(+m.zoom).toFixed(1)}×`);
  }
  if (m.ev != null) {
    await kit.setExposure(Math.max(-3, Math.min(3, +m.ev))).catch(() => {});
    prefs.ev = kit.ev;
    $('#evSlider').value = String(kit.ev);
    $('#evOut').textContent = kit.ev.toFixed(1);
    said.push(`brightness ${kit.ev > 0 ? '+' : ''}${kit.ev.toFixed(1)}`);
  }
  if (m.ct != null) {
    kit.contrast = Math.max(0.5, Math.min(1.6, +m.ct));
    prefs.ct = kit.contrast;
    said.push(`contrast ${kit.contrast.toFixed(2)}`);
  }
  if (m.focus) {
    const p = liveToCamera(+m.focus.u, +m.focus.v);
    await kit.focusAt(p.x, p.y).catch(() => {});
    if (kit.locked) kit.locked = false;
    said.push('focus');
  }
  if (m.lock != null) {
    await kit.setLock(!!m.lock).catch(() => {});
    said.push(kit.locked ? 'focus and exposure locked' : 'focus and exposure unlocked');
  }
  if (m.wb != null) {
    wbLocked = !!(await kit.setWhiteBalanceLock(!!m.wb).catch(() => false)) && !!m.wb;
    $('#tgWb').checked = wbLocked;
    said.push(wbLocked ? 'white balance locked' : 'white balance on auto');
  }
  if (m.auto) {
    await kit.setExposure(0).catch(() => {});
    await kit.setLock(false).catch(() => {});
    if (wbLocked) await kit.setWhiteBalanceLock(false).catch(() => {});
    Object.assign(kit, { contrast: 1, locked: false });
    Object.assign(prefs, { ev: 0, ct: 1 });
    wbLocked = false;
    $('#tgWb').checked = false;
    $('#evSlider').value = '0';
    $('#evOut').textContent = '0.0';
    said.push('everything back to auto');
  }
  $('#aeLock').hidden = !kit.locked;
  applyLook();
  savePrefs();
  sendCamState();
  // tell the person holding the phone, now and then (a fader moving sends many of these)
  if (said.length && Date.now() - ctlSaid > 2500) {
    ctlSaid = Date.now();
    toast(`The director adjusted this camera: ${said.join(', ')}`, 2500);
  }
}

// ---- browsers that keep asking for the camera ----
// A page can't give itself permanent permission: the browser decides. Chrome, Edge and
// Firefox remember once you choose to (Chrome: "Allow while visiting the site", not "Allow
// this time"). Safari on iPhone and iPad asks on every visit until the site is set to Allow
// in its Website Settings. So someone coming back whose browser is still going to ask gets
// the steps for theirs, on the join screen, once.
async function permState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return null; // this browser won't say
  }
}
async function permissionTip() {
  if (localStorage.getItem('vm_permtip_done') || !+(localStorage.getItem('vm_joins') || 0)) return; // (first visit: the question is expected)
  const [cam, mic] = [await permState('camera'), await permState('microphone')];
  if (cam === 'granted' && mic === 'granted') return; // already remembered
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let text;
  if (cam === 'denied' || mic === 'denied') text = 'The camera or microphone is blocked for this site. Open the site settings next to the address (the icon at its left), and set Camera and Microphone to Allow.';
  else if (ios && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) text = "On iPhone and iPad, only Safari can remember camera permission for a site. Open this page in Safari, then: the page menu next to the address (aA), Website Settings, Camera and Microphone: Allow. It won't ask again.";
  else if (ios) text = "Tired of tapping Allow? Safari asks every visit until you tell it not to: tap the page menu next to the address (aA), then Website Settings, and set Camera and Microphone to Allow. It won't ask again. (iPhones still ask about motion each visit; that one can't be kept.)";
  else if (/Firefox\//.test(ua)) text = 'Tired of tapping Allow? When Firefox asks, tick "Remember this decision" first, and it won\u2019t ask again.';
  else text = 'Tired of tapping Allow? When the browser asks, choose "Allow while visiting the site" (or "Allow on every visit"), not "Allow this time", and it won\u2019t ask again.';
  $('#permTipText').textContent = text;
  $('#permTip').hidden = false;
  $('#permTipDone').onclick = () => {
    localStorage.setItem('vm_permtip_done', '1');
    $('#permTip').hidden = true;
  };
}
// The camera's home: join by code or by scanning, the camera on your own, My events, and
// (after you leave, or when you come back later) a one-tap Rejoin for the last event.
let homeReady = false;
function setupHome() {
  if (homeReady) return;
  homeReady = true;
  $('#scanJoinBtn').onclick = scanToJoin;
  $('#soloBtn').onclick = startSolo;
  // the code: capitals and digits only, as you type (no spaces, dashes or autocorrect slipping in)
  const ci = $('#codeInput');
  ci.addEventListener('input', () => {
    const at = ci.selectionStart, clean = ci.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (clean !== ci.value) {
      const lost = ci.value.length - clean.length;
      ci.value = clean;
      ci.setSelectionRange(Math.max(0, at - lost), Math.max(0, at - lost));
    }
    ci.setCustomValidity('');
  });
  $('#codeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = ci.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 6) {
      ci.setCustomValidity('Event codes are 6 letters and numbers');
      return ci.reportValidity();
    }
    location.href = `/cam?e=${code}`;
  });
}
const lastEvent = () => {
  const l = JSON.parse(localStorage.getItem('vm_last') || 'null');
  return l && Date.now() - (l.at || 0) < 24 * 3600e3 ? l : null;
};
if (!eventId) {
  setupHome();
  $('#codeView').hidden = false;
  const last = lastEvent();
  if (last) {
    $('#rejoinCard').hidden = false;
    $('#rejoinLabel').textContent = 'Last event';
    $('#rejoinTitle').textContent = last.title;
    $('#rejoinText').textContent = last.role === 'mic' ? 'You were the microphone.' : 'You were a camera.';
    rejoinUi(last.role);
  }
} else {
  boot().catch((e) => {
    $('#codeView').hidden = false;
    toast(e.message, 5000);
  });
}

async function boot() {
  ev = await api(`events/${eventId}`);
  await keepEventsApart(ev);
  showFirstBox();

  permissionTip();
  showWatch(ev.watch);
  ident = await identity();
  ident.cid = await thumbprintOf(ident.jwk);
  document.title = `${ev.title} — camera`;
  $('#camTitleText').textContent = ev.title;
  setupOrientationHint();
  const saved = JSON.parse(localStorage.getItem('vm_joined_' + eventId) || 'null');
  // removed and blocked by the host: say so, and don't offer to join
  if (localStorage.getItem('vm_blocked_' + eventId) || (saved && (ev.blocked || []).includes(saved.contributorId))) {
    $('#joinView').hidden = false;
    $('#joinTitle').textContent = ev.title;
    $('#joinForm').hidden = true;
    $('#blockedNote').hidden = false;
    return;
  }
  if (saved && saved.termsHash === ev.termsHash) {
    me = saved;
    // Camera access needs a tap on most phones, so show a one-button resume.
    $('#joinView').hidden = false;
    $('#joinTitle').textContent = ev.title;
    $('#name').value = me.name;
    $('#terms').textContent = ev.terms;
    // coming back: as what you asked to rejoin as (Rejoin as camera / microphone), else as last time
    const as = new URLSearchParams(location.search).get('as');
    const want = as === 'mic' || as === 'cam' ? as : lastEvent()?.id === eventId ? lastEvent().role : null;
    const r = want && document.querySelector(`input[name=role][value=${want}]`);
    if (r) {
      r.checked = true;
      r.dispatchEvent(new Event('change', { bubbles: true }));
      if (as) setTimeout(() => $('#joinForm button[type=submit]')?.focus(), 300);
    }
  } else {
    $('#joinView').hidden = false;
    $('#joinTitle').textContent = ev.title;
    $('#terms').textContent = ev.terms;
    $('#name').value = localStorage.getItem('vm_name') || '';
  }
  $('#joinForm').addEventListener('submit', onJoin);
  $('#joinForm').addEventListener('change', (e) => {
    if (e.target.name !== 'role') return;
    $('#joinForm button[type=submit]').textContent = e.target.value === 'mic' ? 'Accept and set up the microphone' : 'Accept and open camera';
  });
}

async function onJoin(e) {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  const asMic = new FormData($('#joinForm')).get('role') === 'mic';
  // Straight in when nothing will be asked (set up before, and this browser remembers);
  // otherwise the guided setup: one question at a time, each with its reason.
  const [cp, mp] = [await permState('camera'), await permState('microphone')];
  const remembered = mp === 'granted' && (asMic || cp === 'granted');
  const motionAsk = remembered && !asMic && MOTION_ASKS && prefs.motion !== 'off' ? Sensors.requestPermission() : Promise.resolve(false); // (iPhones only allow this inside the tap)
  if (remembered && !asMic) makeAudio(); // so is starting sound
  try {
    // first at a kiosk show: name it (once; if someone else just did, join theirs)
    if (ev.kiosk && !ev.titled) {
      const title = $('#showName').value.trim();
      if (!title) {
        $('#showName').focus();
        throw Object.assign(new Error('Name the show first'), { name: 'NeedName' });
      }
      try {
        ev = { ...ev, ...(await api(`events/${eventId}/name`, { method: 'POST', body: { title } })) };
      } catch {
        ev = await api(`events/${eventId}`);
        toast(`Someone just named it \u201c${ev.title}\u201d: you're joining that show`, 6000);
      }
      $('#joinTitle').textContent = ev.title;
      $('#terms').textContent = ev.terms;
      showFirstBox();
    }
    const name = $('#name').value.trim();
    if (!me || me.name !== name || !me.joinSig) {
      // Accepting the terms = signing them with this phone's key. The host checks it.
      const joinSig = await signStatement(ident.key, ['vuemesh-join-v1', eventId, ev.termsHash, name]);
      me = { contributorId: ident.cid, name, termsHash: ev.termsHash, joinSig };
      localStorage.setItem('vm_joined_' + eventId, JSON.stringify(me));
      localStorage.setItem('vm_name', name);
    }
    localStorage.setItem('vm_terms', TERMS_VERSION);
    rememberEvent(ev, 'guest');
    role = new FormData($('#joinForm')).get('role') === 'mic' ? 'mic' : 'cam';
    localStorage.setItem('vm_last', JSON.stringify({ id: eventId, title: ev.title, role, at: Date.now() }));
    localStorage.setItem('vm_joins', String(+(localStorage.getItem('vm_joins') || 0) + 1));
    if (remembered) {
      // the browser remembers its OK, but a phone back from the background (or a home-screen
      // app reopened) can refuse, or never answer: then ask again, inside a tap
      try {
        await withTimeout(openCamera(), 8000, 'The camera didn\u2019t start');
      } catch (e) {
        diag('error', `Camera didn't open on join (${e.name || ''} ${e.message}): asking again`);
        await guidedSetup(e);
      }
    } else await guidedSetup();
    await motionAsk.catch(() => false);
    sensors.start();
    if (role === 'cam') {
      audio.ctx?.resume();
      makeUpright();
      setupCameraControls();
    }
    $('#joinView').hidden = true;
    keepAwake();
    if (role === 'mic') {
      connectMesh();
      startMic();
      return;
    }
    $('#camView').classList.add('on');
    connectMesh();
    if (!synced()) startScanning(); // (already locked in, after a reload: no need)
    controlNote();
  } catch (err) {
    toast(err.name === 'NotAllowedError' ? 'Allow camera and microphone access to shoot' : err.message, 5000);
    btn.disabled = false;
  }
}
function showFirstBox() {
  const first = !!(ev?.kiosk && !ev.titled);
  $('#nameShowBox').hidden = !first;
  $('#showName').required = first;
  if (first) $('#joinTitle').textContent = 'A new show';
}

// ---- events with the same name, or a code used again ----
// Events are kept apart by their code and when they were made. Codes are reused after an
// event's gone: if this phone has things from an older event with this code, they're moved
// aside (still in My events, by its date) so the new event starts clean.
async function keepEventsApart(e) {
  const old = myEvents().find((x) => x.id === e.id);
  if (!old?.createdAt || !e.createdAt || old.createdAt === e.createdAt) return;
  const to = `${e.id}~${old.createdAt}`;
  for (const r of await idb.list('outbox', e.id).catch(() => [])) {
    await idb.put('outbox', { ...r, eventId: to }).catch(() => {});
    await idb.remove('outbox', e.id, r.id).catch(() => {});
  }
  for (const k of Object.keys(localStorage)) if (k.endsWith('_' + e.id)) {
    localStorage.setItem(k.slice(0, -e.id.length) + to, localStorage.getItem(k));
    localStorage.removeItem(k);
  }
  const list = myEvents().map((x) => (x.id === e.id ? { ...x, id: to, archived: true } : x));
  localStorage.setItem('vm_events', JSON.stringify(list));
  diag('event', `The code ${e.id} was used before by another event: its things here moved aside`);
}
/** How an event shows in My events: its name, when it was, and its code (names repeat). */
function eventLabel(id) {
  if (id === SOLO_ID) return 'On my own';
  const r = myEvents().find((e) => e.id === id), code = String(id).split('~')[0];
  const when = r?.createdAt || r?.at;
  const date = when ? new Date(when).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return [eventTitle(id), date, code].filter(Boolean).join(' · ');
}

// --------------------------------------------------------------- camera ----

const video = $('#preview');
let stream;
let facing = 'environment';

// Camera and microphone are opened separately, so either can change on its own —
// even mid-recording (the recording takes its picture from the upright canvas and its
// sound from a mixer node, which stay the same while the inputs behind them change).
const kit = new CameraKit();
const audio = { ctx: null, src: null, gain: null, meter: null, dest: null };
let micTrack = null;
const prefs = JSON.parse(localStorage.getItem('vm_camprefs') || '{}');
const savePrefs = () => localStorage.setItem('vm_camprefs', JSON.stringify(prefs));
// Two channels if the phone has stereo microphones; one otherwise (the phone's mixer below fills both sides either way).
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };

async function openCamera() {
  kit.quality = prefs.quality && QUALITY[prefs.quality] ? prefs.quality : kit.quality;
  const side = facing === 'user' ? 'front' : 'back';
  const saved = prefs.cams?.[side] || (side === 'back' ? prefs.camId : null);
  let vt;
  try {
    vt = await kit.open({ facing, deviceId: saved || null, zoom: 1 });
  } catch {
    vt = await kit.open({ facing, deviceId: null }); // the saved camera is gone
  }
  if (!saved) {
    // First time: a camera app opens on the plain 1× lens, not whatever the browser picks.
    const { cams } = await kit.devices();
    const want = preferredCamera(cams, side);
    if (want && want.deviceId !== kit.deviceId) vt = await kit.open({ deviceId: want.deviceId }).catch(() => vt);
  }
  await kit.setExposure(prefs.ev || 0).catch(() => {});
  kit.contrast = prefs.ct || 1;
  applyLook();
  video.srcObject = new MediaStream([vt]);
  await video.play().catch(() => {});
  await openMic(prefs.micId || null);
  stream = new MediaStream([vt, micTrack]);
  link?.replaceStream(upright?.stream || stream);
}

async function openMic(deviceId) {
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
  } catch {
    s = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
  }
  const old = micTrack;
  micTrack = s.getAudioTracks()[0];
  if (audio.ctx) {
    try { audio.src?.disconnect(); } catch {}
    audio.src = audio.ctx.createMediaStreamSource(new MediaStream([micTrack]));
    audio.src.connect(audio.fix?.input || audio.gain);
    audio.fix?.reset(false); // a different microphone: find out again whether it's really stereo
  }
  if (old && old !== micTrack) old.stop();
  if (stream) {
    stream.getAudioTracks().forEach((t) => stream.removeTrack(t));
    stream.addTrack(micTrack);
  }
}

/**
 * The phone's own little mixer: mic → both channels → level → meter → the track that gets
 * recorded and sent. Some phone browsers hand a mono microphone over as "stereo" with a
 * silent right side, so recordings came out left-only; the fixer plays the left on both
 * sides until the microphone shows it really has a right channel (then it's true stereo).
 */
function makeAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || audio.ctx) return;
  audio.ctx = new AC();
  audio.fix = channelFixer(audio.ctx);
  audio.gain = audio.ctx.createGain();
  audio.fix.output.connect(audio.gain);
  audio.gain.gain.value = 10 ** ((prefs.micGain || 0) / 20);
  audio.meter = audio.ctx.createAnalyser();
  audio.meter.fftSize = 1024;
  audio.dest = audio.ctx.createMediaStreamDestination();
  Object.assign(audio.dest, { channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
  audio.gain.connect(audio.meter);
  audio.gain.connect(audio.dest);
}
const outAudioTracks = () => (audio.dest ? audio.dest.stream.getAudioTracks() : stream.getAudioTracks());

// ------------------------------------------------------------- the mesh ----
// The cloud tells us who the host is; after that the phone talks to the host
// laptop directly over the local network.

function connectMesh() {
  socket = meshSocket({
    eventId,
    role,
    name: me.name,
    cid: me.contributorId,
    onPeers: (peers) => link.setPeers(peers),
    onSignal: (from, data) => link.onSignal(from, data),
  });
  const liveTier = { air: false, pvw: false };
  window.vmLink = () => link?.linkStats || null; // (diagnostics and tests: this phone's live picture)
  link = new CamLink({
    sock: socket,
    stream: () => (role === 'mic' ? new MediaStream(stream.getAudioTracks()) : upright?.stream || stream),
    onControl: (m) => {
      if (m.t === 'kick') return onKicked(!!m.block);
      // the director has this camera in preview: next to go on air
      if (m.t === 'pvw') {
        const on = !!m.on && role === 'cam';
        if ($('#pvwTag').hidden === on) announce(on ? "You're in preview: up next" : 'Out of preview');
        $('#pvwTag').hidden = !on;
        liveTier.pvw = on;
        link.setTier?.(liveTier.air ? 'program' : on ? 'preview' : 'idle');
        return;
      }
      if (m.t === 'tally') {
        // the live picture follows: full and generous on air, full in preview, small otherwise
        liveTier.air = !!m.on && role === 'cam';
        link.setTier?.(liveTier.air ? 'program' : liveTier.pvw ? 'preview' : 'idle');
        if (m.on) $('#pvwTag').hidden = true;
        if (role === 'mic') return micTally(!!m.on);
        setTally(!!m.on && !paused);
        onAirRecording(!!m.on && !paused, !!m.rec);
      }
    },
    onHostMessage,
    onHostBinary: (buf) => {
      if (inbound) {
        inbound.parts.push(buf);
        inbound.got += buf.byteLength;
      }
    },
    onState: setLinkState,
    extraTelemetry: () => ({ role, upKbps: Math.round((pace.rate * 8) / 1000), rec: !!recorder || !!mic, synced: offset !== null && samples.length >= 3, outbox: outbox.size, kind: DEVICE, lens: kit.track?.label || null, mic: micTrack?.label || null, zoom: Math.round(kit.zoom * 10) / 10 }),
    onProgress: (clip, sent, total) => {
      clip.sent = sent;
      renderOutbox();
    },
    onSent: async (clip) => {
      // Keep a copy (marked delivered) so the camera person can watch, resend or save it later.
      if (keepCopies()) await idb.patch('outbox', eventId, clip.id, { status: 'delivered', deliveredAt: Date.now(), error: null }).catch(() => {});
      else await idb.remove('outbox', eventId, clip.id);
      outbox.delete(clip.id);
      renderLibrary();
      lastBlob = { blob: clip.blob, name: clip.id };
      renderOutbox();
      toast('Clip delivered to the host');
    },
    onFailed: (clip, error) => clipFailed(clip, error),
  });
  link.uploadRate = uploadRate;
  setTimeout(feedBtnUi);
  // Anything shot earlier (even before a reload) goes out as soon as the host is reachable.
  idb.list('outbox', eventId).then((recs) => {
    for (const r of recs) {
      if (r.status === 'delivered' || r.status === 'received' || r.status === 'saved') continue; // with the host already, from the host, or kept here
      if (uploadsOff()) continue;
      const clip = { id: r.id, blob: r.blob, meta: r.meta, sent: 0 };
      outbox.set(clip.id, clip);
      link.enqueue(clip);
    }
    renderOutbox();
  });
}

let linkState = 'no-host';
const outbox = new Map(); // clips waiting to reach the host (also kept in IndexedDB)
function setLinkState(state) {
  if (state !== linkState) statusShownAt = 0; // a change is worth showing again
  linkState = state;
  renderOutbox();
}

// The status line shows itself when something changes, then fades after a few
// seconds; tap it to dismiss sooner. A dot by the event name always shows the state.
let statusShownAt = 0, statusText = '', statusDismissed = false, fadeTimer = null;
const LIVE = ['lan', 'nat', 'cellular', 'internet', 'relay', 'unknown'];
function renderOutbox() {
  const pill = $('#upPill');
  const waiting = [...outbox.values()];
  const label = paused
    ? 'Paused · the host can’t see or hear you'
    : studioHold ? 'Recording only · the studio is full. Your clips still go to the host.'
    : { lan: 'Connected to host on local Wi-Fi', nat: 'Connected to host (same network, through the router)', cellular: 'Connected over mobile data — join the venue Wi-Fi', internet: 'Connected to host over the internet', relay: 'Connected to host', unknown: 'Connected to host', connecting: 'Finding the host…', 'no-host': 'Host not here yet — keep shooting', left: 'Not connected', solo: 'On your own · clips are saved to My events' }[linkState];
  let text, sticky = false;
  if (waiting.length) {
    const total = waiting.reduce((s, c) => s + c.blob.size, 0);
    const sent = waiting.reduce((s, c) => s + (c.sent || 0), 0);
    text = LIVE.includes(linkState)
      ? `Sending ${waiting.length} clip${waiting.length > 1 ? 's' : ''} to the host · ${Math.round((sent / total) * 100)}%`
      : `${waiting.length} clip${waiting.length > 1 ? 's' : ''} waiting for the host · ${label}`;
    sticky = LIVE.includes(linkState); // keep progress visible while it's moving
  } else text = label;
  const dot = $('#linkDot');
  dot.className = 'ldot ' + (paused ? 'paused' : LIVE.includes(linkState) ? 'live' : linkState === 'left' ? 'off' : 'wait');
  renderLeftText();
  $('#lsState').textContent = label;
  if (!pill) return;
  const changed = text.replace(/\d+%/, '') !== statusText.replace(/\d+%/, '');
  statusText = text;
  pill.textContent = text;
  if (changed) {
    statusDismissed = false;
    statusShownAt = performance.now();
  }
  if (statusDismissed && !changed) return;
  pill.hidden = false;
  pill.classList.remove('fade');
  clearTimeout(fadeTimer);
  if (!sticky) fadeTimer = setTimeout(() => pill.classList.add('fade'), Math.max(0, 4000 - (performance.now() - statusShownAt)));
}
$('#upPill').onclick = () => {
  statusDismissed = true;
  $('#upPill').classList.add('fade');
};

// ---- the event sheet: live on/off, rundown, messages, leave ----
let paused = false;
$('#camTitle').onclick = () => {
  renderSheetLists();
  $('#linkSheet').showModal();
};
$('#lsClose').onclick = () => $('#linkSheet').close();
$('#cue').onclick = () => $('#camTitle').click();
// Not sending a live picture: because you paused, or because the studio is full (record only).
let studioHold = false;
function applyPause() {
  const off = paused || studioHold;
  link?.setPaused(off);
  $('#pausedTag').hidden = !off;
  $('#pausedTag').textContent = studioHold && !paused ? 'RECORDING ONLY · studio full' : "PAUSED · host can't see you";
  if (off) setTally(false);
  renderOutbox();
}
$('#liveSwitch').onchange = async (e) => {
  paused = !e.target.checked;
  applyPause();
  feedBtnUi();
  if (paused) setTally(false);
  renderOutbox();
  announce(paused ? 'Paused. The host can’t see or hear you.' : 'Live again');
};

let savingOnLeave = false;
$('#leaveBtn').onclick = async () => {
  if (recorder && !confirm('Stop recording and leave the event? Your clip is kept and sends when you rejoin.')) return;
  if (recorder) {
    savingOnLeave = outbox.size + 1; // done once the clip is sealed and queued
    stopRecording();
  }
  $('#linkSheet').close();
  await leaveEvent();
};

// The host removed this phone from the event (blocked: for good). What was recorded is kept
// in My events; the phone goes home and says so.
let kicked = false, kickedText = '';
async function onKicked(block) {
  if (kicked) return;
  kicked = true;
  kickedText = block ? "The host removed you from this event, and you can't rejoin it. What you recorded is still in My events." : 'The host removed you from this event. You can rejoin if they ask you back.';
  if (block) localStorage.setItem('vm_blocked_' + eventId, '1');
  if (recorder) stopRecording();
  if (mic) stopMic?.();
  await leaveEvent();
  $('#rejoinLabel').textContent = 'Removed by the host';
  $('#rejoinText').textContent = kickedText;
  document.querySelector('.rejoinpair').hidden = !!block;
  announce(block ? 'The host removed you from this event' : 'The host removed you from this event; you can rejoin');
}
async function leaveEvent() {
  // tell the studio first, so it knows exactly when we left (it sends the live cut by who was
  // there), and take any of the live cut that's owed before going (or skip it)
  link?.say({ t: 'leaving' });
  if (!kicked) await waitForCut();
  link?.leave();
  socket?.close();
  stopScanning?.();
  setTally(false);
  for (const t of [...(stream?.getTracks() || []), kit.track, micTrack]) t?.stop?.();
  video.srcObject = null;
  try { lock?.release?.(); } catch {}
  linkState = 'left';
  $('#camView').classList.remove('on');
  $('#micView').classList.remove('on');
  $('#pocket').classList.remove('on');
  localStorage.setItem('vm_last', JSON.stringify({ id: eventId, title: ev.title, role, at: Date.now() }));
  // back to the camera's home, with Rejoin at the top
  setupHome();
  $('#codeView').hidden = false;
  $('#rejoinCard').hidden = false;
  $('#rejoinLabel').textContent = 'You left';
  $('#rejoinTitle').textContent = ev.title;
  rejoinUi(role);
  renderLeftText();
  refreshLibButtons();
  window.scrollTo(0, 0);
  $(role === 'mic' ? '#rejoinMicBtn' : '#rejoinBtn').focus();
  announce(`You left ${ev.title}`);
}

// Rejoin as either: a camera or a microphone, whichever you were before. The one you were is
// highlighted; picking it again is one tap. Picking the other (or after a reload) opens the
// event's join screen with that chosen, and Join takes you in.
function rejoinUi(was) {
  $('#rejoinBtn').classList.toggle('primary', was !== 'mic');
  $('#rejoinMicBtn').classList.toggle('primary', was === 'mic');
}
$('#rejoinBtn').onclick = () => rejoinAs('cam');
$('#rejoinMicBtn').onclick = () => rejoinAs('mic');
async function rejoinAs(want) {
  kicked = false; // (a fresh start: if they were removed, they've been asked back)
  kickedText = '';
  $('#rejoinLabel').textContent = 'You left';
  const last = lastEvent();
  const here = ev && me && linkState === 'left' && !(last && last.id !== eventId);
  if (!here || want !== role) {
    const id = here ? eventId : last?.id;
    if (id) location.href = `/cam?e=${id}&as=${want}`;
    return;
  }
  const btn = $(want === 'mic' ? '#rejoinMicBtn' : '#rejoinBtn');
  btn.disabled = true;
  try {
    await openCamera();
    $('#codeView').hidden = true;
    $('#rejoinCard').hidden = true;
    if (role === 'mic') {
      keepAwake();
      studioHold = false;
      connectMesh();
      startMic();
      // still synced with the beacon: lock straight back in
      if (synced()) setTimeout(() => !$('#micGo').disabled && $('#micGo').click(), 600);
      announce(`Back in ${ev.title} as the microphone`);
      return;
    }
    if (upright) {
      // the recorded sound comes from the phone's own mixer, which kept running
      upright.stream.getAudioTracks().forEach((t) => upright.stream.removeTrack(t));
      outAudioTracks().forEach((t) => upright.stream.addTrack(t));
    }
    $('#camView').classList.add('on');
    keepAwake();
    studioHold = false; // the studio decides again
    connectMesh();
    if (paused) link.paused = true;
    announce(`Back in ${ev.title}`);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

function renderLeftText() {
  if ($('#rejoinCard').hidden || linkState !== 'left') return;
  if (kickedText) return void ($('#rejoinText').textContent = kickedText); // (removed by the host: that's the news)
  const n = outbox.size;
  if (savingOnLeave && n < savingOnLeave) {
    $('#rejoinText').textContent = `Saving your clip on this ${DEVICE}…`;
    return;
  }
  savingOnLeave = false;
  const owed = +(localStorage.getItem('vm_owed_' + eventId) || 0);
  $('#rejoinText').textContent = (n ? `${n} clip${n > 1 ? 's are' : ' is'} kept on this ${DEVICE} and will send when you rejoin.` : 'Everything you shot reached the host.') + (owed ? ` The studio still has ${owed} part${owed > 1 ? 's' : ''} of the live cut for you: rejoin (and keep this screen on) to get ${owed > 1 ? 'them' : 'it'}.` : '');
}

// ---- before leaving: the live cut that's owed to you ----
// The studio answers "leaving" with how many parts of the live cut it still owes this phone
// (it finishes the part being recorded if you were in it). The phone waits for them, with a
// Leave now button; anything skipped comes next time you join.
let owedWait = null;
async function waitForCut() {
  if (!link || ev?.solo) return;
  keepAwake(); // (a phone that locks while waiting stops receiving)
  const box = $('#cutWait'), bar = $('#cutWait progress');
  // (a busy studio can take a moment to answer: say what's happening, and Leave now works throughout)
  const asking = setTimeout(() => {
    $('#cutWaitText').textContent = 'Checking with the studio for your copy of the show…';
    bar.removeAttribute('value');
    box.hidden = false;
  }, 400);
  let n = await new Promise((resolve) => {
    owedWait = resolve;
    $('#cutWaitGo').onclick = () => resolve(0);
    setTimeout(() => resolve(0), 10000); // a studio that's very busy, or an older one, may not answer
  });
  clearTimeout(asking);
  if (!n) {
    box.hidden = true;
    return (owedWait = null);
  }
  const say = () => {
    // how far the part arriving now has got
    const pct = inbound?.head?.size ? Math.min(100, Math.round((inbound.got / inbound.head.size) * 100)) : null;
    $('#cutWaitText').textContent = `${n} part${n > 1 ? 's' : ''} of the director's cut to go${pct != null ? ` · this one ${pct}%` : ''}. It's yours to keep, in My events.`;
    if (pct != null) Object.assign(bar, { max: 100, value: pct });
    else bar.removeAttribute('value');
  };
  say();
  box.hidden = false;
  $('#cutWaitGo').focus();
  // Keep waiting while something's happening (an answer, or a part arriving). If the studio
  // goes quiet for 45 s (still finishing the part, or too busy), go: it comes on rejoin.
  let lastSign = Date.now(), lastGot = -1, quiet = false;
  const tick = setInterval(say, 500);
  await new Promise((resolve) => {
    owedWait = (k) => {
      n = k;
      lastSign = Date.now();
      say();
      if (!k) resolve();
    };
    $('#cutWaitGo').onclick = resolve;
    const idle = setInterval(() => {
      const got = inbound?.got ?? -1;
      if (got !== lastGot) [lastGot, lastSign] = [got, Date.now()];
      if (Date.now() - lastSign > 45000) {
        quiet = true;
        clearInterval(idle);
        resolve();
      }
    }, 1000);
    setTimeout(resolve, 5 * 60000);
  });
  clearInterval(tick);
  owedWait = null;
  box.hidden = true;
  // anything still owed comes when this phone rejoins: say so on the home screen
  if (n > 0) localStorage.setItem('vm_owed_' + eventId, String(n));
  else localStorage.removeItem('vm_owed_' + eventId);
  if (quiet) toast("The studio is still finishing your part of the show. It'll come next time you join.", 6000);
}

// ---- the studio asks before sending a file ----
async function answerFileOffer(m) {
  let ok = true, why = '';
  if (recorder) [ok, why] = [false, 'recording'];
  else if (link?.sending) [ok, why] = [false, 'sending its own clips'];
  else {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est?.quota && est.quota - est.usage < m.size * 1.3 + 50e6) [ok, why] = [false, 'short of space'];
  }
  link?.say({ t: 'file-answer', id: m.id, ok, why });
  if (!ok) diag('event', `Live cut part ${m.part}: asked the studio to wait (${why})`);
}

// ---- uploads share the Wi-Fi with the live picture ----
// Smart pacing, like the internet's own congestion control but watching the live picture:
// while a clip is uploading, it speeds up a little every second as long as the live
// picture stays healthy, and backs off fast the moment it shows strain: the connection's
// round trip grows (the router's queue is filling), packets go missing, or the browser
// says it's holding the picture back for lack of bandwidth. So clips go as fast as the
// network allows without hurting the picture, with nothing to switch by hand. Not sending a
// live picture (paused, recording only, microphone), clips go at full speed.
const pace = { rate: 500_000, calmSince: 0, rtts: [], strainedAt: 0 }; // bytes a second
const PACE_MIN = 40_000, PACE_MAX = 12_000_000;
setInterval(async () => {
  const pc = link?.pc;
  if (!pc || link.left) return;
  const st = await pc.getStats().catch(() => null);
  if (!st) return;
  let rttPair = null, rttRtcp = null, lost = null, limited = false;
  st.forEach((r) => {
    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.currentRoundTripTime != null) rttPair = r.currentRoundTripTime * 1000;
    if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
      if (r.roundTripTime != null) rttRtcp = r.roundTripTime * 1000;
      if (r.fractionLost != null) lost = r.fractionLost;
    }
    if (r.type === 'outbound-rtp' && r.kind === 'video' && r.qualityLimitationReason === 'bandwidth') limited = true;
  });
  const rtt = rttRtcp ?? rttPair, t = Date.now();
  // the quietest round trip in the last minute is the line's own delay; above it is queueing
  if (rtt != null) pace.rtts.push([t, rtt]);
  pace.rtts = pace.rtts.filter(([at]) => t - at < 60000);
  const base = pace.rtts.length ? Math.min(...pace.rtts.map(([, v]) => v)) : null;
  if (!link.sending) return;
  const strained = limited || (lost != null && lost > 0.02) || (rtt != null && base != null && rtt > base + (onAirSince ? 60 : 120));
  if (strained) {
    pace.rate = Math.max(PACE_MIN, pace.rate * 0.6);
    pace.calmSince = t;
    if (t - pace.strainedAt > 30000) diag('event', `Clip uploads eased off to keep the live picture healthy (round trip ${Math.round(rtt ?? 0)} ms, line ${Math.round(base ?? 0)} ms${limited ? ', picture held back' : ''}${lost ? `, ${Math.round(lost * 100)}% lost` : ''})`);
    pace.strainedAt = t;
  } else if (t - pace.calmSince > 2000) pace.rate = Math.min(PACE_MAX, pace.rate * 1.15 + 64_000);
}, 1000);
function uploadRate() {
  if (!link || paused || studioHold || role !== 'cam') return Infinity;
  return pace.rate;
}

// ---- messages from the director ----
// Kept on this device (not just this tab) so they show in My events after the show.
const msgs = JSON.parse(localStorage.getItem('vm_msgs_' + eventId) || sessionStorage.getItem('vm_msgs_' + eventId) || '[]');
let rundown = JSON.parse(localStorage.getItem('vm_rundown_' + eventId) || sessionStorage.getItem('vm_rundown_' + eventId) || 'null');
let dmTimer = null, dmId = null;
// A part of the live program cut, sent by the studio: saved to My events.
let inbound = null;
async function onHostFile(m) {
  if (m.t === 'file-begin') {
    inbound = { head: m, parts: [], got: 0 };
    return;
  }
  if (!inbound || inbound.head.id !== m.id) return;
  const h = inbound.head;
  const blob = new Blob(inbound.parts, { type: h.mime || 'video/mp4' });
  inbound = null;
  if (blob.size !== h.size) {
    diag('error', `Live cut part ${h.part} arrived incomplete (${blob.size} of ${h.size} bytes)`);
    return link?.say({ t: 'file-ack', id: h.id, ok: false, why: `arrived incomplete (${blob.size} of ${h.size} bytes)` });
  }
  try {
    const f = await codecsOf(blob).catch(() => null);
    const codecs = h.codecs || (f ? `${f.container} · ${f.video} + ${f.audio}` : h.mime);
    const meta = { kind: 'program', part: h.part, t0: h.t0, dur: h.t1 - h.t0, title: h.title, codecs };
    await idb.put('outbox', { eventId, id: 'pgm-' + h.id, blob, status: 'received', createdAt: Date.now(), meta });
    // confirm as soon as it's safely saved, so the studio can send the next part right away
    link?.say({ t: 'file-ack', id: h.id, ok: true });
    const owedLeft = +(localStorage.getItem('vm_owed_' + eventId) || 0) - 1;
    if (owedLeft > 0) localStorage.setItem('vm_owed_' + eventId, String(owedLeft));
    else localStorage.removeItem('vm_owed_' + eventId);
    renderLibrary();
    // then check this phone can actually play it (some studio browsers only make VP9, which iPhones can't)
    const playable = await canPlay(blob);
    await idb.patch('outbox', eventId, 'pgm-' + h.id, { meta: { ...meta, playable } }).catch(() => {});
    diag('event', `Live cut part ${h.part} received: ${Math.round(blob.size / 1048576)} MB, ${codecs}, ${playable ? 'plays here' : "this phone can't play it"}`);
    renderLibrary();
    toast(playable ? `The director sent you part ${h.part} of the live cut. It's in My events.` : `Part ${h.part} of the live cut arrived, but this phone can't play its format (${codecs}). Save it to watch on a computer.`, 6000);
    announce(`Part ${h.part} of the live cut received`);
  } catch (e) {
    diag('error', `Couldn't save live cut part ${h.part}: ${e.name || ''} ${e.message || e}`);
    link?.say({ t: 'file-ack', id: h.id, ok: false, why: `couldn't save it here: ${e.message || e.name || e}`.slice(0, 160) });
  }
}

// A kiosk show doesn't collect clips (nobody edits there): they stay on the phone, in My
// events; the live cut still comes to it. (Anything already waiting stays put too.)
const uploadsOff = () => localStorage.getItem('vm_noupload_' + eventId) === '1';
async function setUploads(on) {
  if (on) return localStorage.removeItem('vm_noupload_' + eventId);
  localStorage.setItem('vm_noupload_' + eventId, '1');
  for (const [id] of outbox) {
    link?.queue && (link.queue = link.queue.filter((c) => c.id !== id));
    await idb.patch('outbox', eventId, id, { status: 'saved' }).catch(() => {});
    outbox.delete(id);
  }
  renderOutbox();
  renderLibrary();
}

// ---- the first phone at a kiosk starts the show ----
// The kiosk asks this phone to start it: once the phone's locked in to the code (or after 20 s),
// a big Go live button; a tap counts in 3-2-1 (on the kiosk too), then the program fades up.
let starter = false;
function setStarter(on) {
  starter = on;
  if (!on) {
    $('#goLive').hidden = true;
    return;
  }
  const show = () => {
    if (!starter) return;
    $('#goLive').hidden = false;
    $('#goLiveBtn').disabled = false;
    $('#goLiveCount').hidden = true;
    $('#goLiveBtn').focus();
    announce('You can start the show: point your camera, then tap Go live');
  };
  if (synced()) show();
  else {
    const since = Date.now();
    const wait = setInterval(() => {
      if (!starter) return clearInterval(wait);
      if (synced() || Date.now() - since > 20000) {
        clearInterval(wait);
        show();
      }
    }, 500);
  }
}
$('#goLiveBtn').onclick = () => {
  $('#goLiveBtn').disabled = true;
  link?.say({ t: 'go' });
  const box = $('#goLiveCount'), b = box.querySelector('b');
  box.hidden = false;
  let n = 3;
  const step = () => {
    if (n === 0) {
      b.textContent = 'LIVE';
      b.className = 'live';
      navigator.vibrate?.(200);
      setTimeout(() => {
        $('#goLive').hidden = true;
        b.className = '';
      }, 900);
      return;
    }
    b.textContent = n--;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    navigator.vibrate?.(40);
    setTimeout(step, 1000);
  };
  step();
};

function onHostMessage(m) {
  if (m.t === 'kick') return onKicked(!!m.block);
  if (m.t === 'uploads') return void setUploads(!!m.on);
  if (m.t === 'starter') return setStarter(!!m.on);
  // the studio wants what's been recorded so far (for Edit): finish this clip, keep recording
  if (m.t === 'roll') return void (recorder && rollRecording());
  if (m.t === 'watch') return showWatch(m.url ? m : null);
  if (m.t === 'camctl') return onCamCtl(m);
  if (m.t === 'file-begin' || m.t === 'file-end') return onHostFile(m);
  if (m.t === 'file-offer') return answerFileOffer(m);
  if (m.t === 'owed') return owedWait?.(m.n || 0);
  if (m.t === 'slot') {
    // the studio decides whether it can show this camera live (it holds a set number)
    const hold = !m.live;
    if (hold !== studioHold) {
      studioHold = hold;
      applyPause();
      toast(hold ? "The studio's live pictures are full, so you're recording only. Keep shooting: your clips still go to the host." : "You're live again: the director can see you.", 6000);
      announce(hold ? 'Recording only: the studio is full' : 'Live again');
    }
    return;
  }
  if (m.t === 'msg') {
    msgs.unshift({ id: m.id, text: String(m.text).slice(0, 200), at: Date.now(), all: !!m.all });
    msgs.length = Math.min(msgs.length, 30);
    localStorage.setItem('vm_msgs_' + eventId, JSON.stringify(msgs));
    link?.say({ t: 'seen', id: m.id });
    showDm(m.id, msgs[0].text, m.all);
  } else if (m.t === 'rundown') {
    const items = (m.items || []).slice(0, 40).map((x) => String(x).slice(0, 120));
    if (!items.length) {
      // the director cleared it
      rundown = null;
      localStorage.removeItem('vm_rundown_' + eventId);
      sessionStorage.removeItem('vm_rundown_' + eventId);
    } else {
      // an ended rundown leaves the screen but stays in My events, showing where it got to
      rundown = { items, cue: m.ended ? (m.last ?? m.cue ?? -1) : (m.cue ?? -1), ended: !!m.ended };
      localStorage.setItem('vm_rundown_' + eventId, JSON.stringify(rundown));
    }
    renderCue(false);
  } else if (m.t === 'cue' && rundown) {
    rundown.cue = m.i;
    rundown.ended = false;
    localStorage.setItem('vm_rundown_' + eventId, JSON.stringify(rundown));
    renderCue(true);
  } else if (m.t === 'output' && (m.orientation === 'portrait' || m.orientation === 'landscape')) {
    if (ev.orientation !== m.orientation) {
      ev.orientation = m.orientation;
      showDm('out', !IS_PHONE ? `The film is now ${m.orientation}. Your camera stays as it is; the studio crops it to fit.` : m.orientation === 'portrait' ? 'The film is now portrait: hold your phone upright.' : 'The film is now landscape: turn your phone sideways.');
      pcNoted = m.orientation; // the message above already explained it
    }
  }
  renderSheetLists();
}

function showDm(id, text, all) {
  dmId = id;
  $('#dm .from').textContent = all ? 'Director · to everyone' : 'Director';
  $('#dmText').textContent = text;
  $('#dm').querySelectorAll('[data-reply]').forEach((b) => (b.hidden = id === 'out' || id === 'info'));
  $('#dm .from').textContent = id === 'info' ? 'Note' : all ? 'Director · to everyone' : 'Director';
  $('#dm').hidden = false;
  $('#ctlNote').hidden = true; // (a message from the director comes first)
  navigator.vibrate?.(40);
  clearTimeout(dmTimer);
  dmTimer = setTimeout(() => ($('#dm').hidden = true), 12000);
}
$('#dm').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b?.dataset.reply && dmId) {
    link?.say({ t: 'reply', id: dmId, text: b.dataset.reply });
    const m = msgs.find((x) => x.id === dmId);
    if (m) m.reply = b.dataset.reply;
    localStorage.setItem('vm_msgs_' + eventId, JSON.stringify(msgs));
    toast('Sent');
  }
  if (b) $('#dm').hidden = true;
});

function renderCue(flash) {
  const c = $('#cue');
  if (!rundown || rundown.ended || rundown.cue < 0 || !rundown.items[rundown.cue]) {
    c.hidden = true;
    return;
  }
  $('#cueNow').textContent = rundown.items[rundown.cue];
  const next = rundown.items[rundown.cue + 1];
  $('#cueNext').textContent = next ? `· Next: ${next}` : '';
  c.hidden = false;
  if (flash) {
    c.classList.remove('flash');
    void c.offsetWidth;
    c.classList.add('flash');
    navigator.vibrate?.(25);
    announce(`Now: ${rundown.items[rundown.cue]}`);
  }
}

function renderSheetLists() {
  $('#lsRundown').hidden = !rundown?.items?.length;
  if (rundown) $('#rundownList').innerHTML = rundown.items.map((x, i) => `<li class="${rundown.ended || i < rundown.cue ? 'done' : i === rundown.cue ? 'now' : ''}">${esc(x)}</li>`).join('');
  const rh = $('#lsRundown h3');
  if (rh) rh.textContent = rundown?.ended ? 'Rundown · ended' : 'Rundown';
  $('#lsMsgs').hidden = !msgs.length;
  $('#msgList').innerHTML = msgs.map((m) => `<li><time>${new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${m.all ? ' · to everyone' : ''}</time>${esc(m.text)}${m.reply ? `<em>You: ${esc(m.reply)}</em>` : ''}</li>`).join('');
}
renderCue(false);


$('#flip').onclick = async () => {
  if (!IS_PHONE) {
    // computers: step through the cameras plugged in
    const { cams } = await kit.devices();
    const i = cams.findIndex((c) => c.deviceId === kit.deviceId);
    const next = cams[(i + 1) % cams.length];
    if (next) await switchCamera(next.deviceId);
    return;
  }
  facing = kit.facing === 'user' ? 'environment' : 'user';
  const side = facing === 'user' ? 'front' : 'back';
  const { cams } = await kit.devices();
  // Back to the lens this person last used on that side, else the plain 1× one.
  const want = cams.find((c) => c.deviceId === prefs.cams?.[side]) || preferredCamera(cams, side);
  await switchCamera(want ? want.deviceId : null, facing);
};

// ------------------------------------------------------------ optical sync --
// offset = beacon clock − this phone's clock. Every sample underestimates it by
// display + camera latency, so the largest sample is the best estimate.

//
// Once synced, the timing is locked in for as long as this page runs: new clips, going off
// and on air, leaving and rejoining never ask for the beacon again. It's only forgotten if
// this phone's clock slips (it slept, or the browser froze the page in the background),
// because then it can't be trusted; the phone then asks once. A reload keeps it, carried
// across on the wall clock. Tapping the Synced pill takes a fresh reading.

const samples = [];
let scanning = false;
let scanTimer;
let quietScan = false;   // looking for the beacon in the background, without asking anyone to aim
let fresh = null;        // a re-sync in progress: new readings replace the old ones once there are three
const scanCanvas = document.createElement('canvas');
const clockGap = () => Date.now() - now(); // wall clock minus this page's clock: steady unless the page's clock stops
const synced = () => offset !== null && samples.length >= 3;
let lockAt = null; // when the beacon was last read (wall clock), carried on every clip
function saveLock() {
  lockAt = Date.now();
  sessionStorage.setItem('vm_off_' + eventId, JSON.stringify({ offset, gap: clockGap(), at: lockAt }));
}
let offset = (() => {
  try {
    const v = JSON.parse(sessionStorage.getItem('vm_off_' + eventId) || 'null');
    if (typeof v === 'number') return v || null; // saved by an earlier version
    if (v && Number.isFinite(v.offset)) {
      lockAt = v.at || null;
      return v.offset - v.gap + clockGap(); // carried across a reload
    }
  } catch {}
  return null;
})();
// Watch for the clock slipping: a sudden jump between the wall clock and this page's clock
// means the phone slept or the page was frozen. (Ordinary clock drift is far smaller.)
let lastGap = clockGap();
function checkClock() {
  const g = clockGap();
  const slip = g - lastGap;
  lastGap = g;
  if (Math.abs(slip) > 50 && offset !== null) forgetSync(slip);
}
setInterval(checkClock, 2000);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkClock());
window.addEventListener('pageshow', checkClock);
document.addEventListener('resume', checkClock);
function forgetSync(slip) {
  offset = null;
  lockAt = null;
  samples.length = 0;
  fresh = null;
  sessionStorage.removeItem('vm_off_' + eventId);
  diag('event', `This ${DEVICE}'s clock jumped ${Math.round(slip)} ms (it slept or was paused), so the beacon timing was reset`);
  setSyncPill();
  if (role === 'mic' && $('#micView').classList.contains('on')) {
    setMicState?.('The phone slept, so its timing reset. Tap Re-sync and point it at the beacon once.');
  } else if ($('#camView').classList.contains('on') && !ev?.solo) {
    toast(`Your ${DEVICE} slept, so its timing reset. Point it at the beacon once to sync again.`, 6000);
    startScanning();
  }
}

// Scan quickly while the beacon is in view, slow down when it isn't, and give up
// after a while (tap the sync pill to try again). Decoding runs off the main thread.
function startScanning(limitMs = 20000, { quiet = false } = {}) {
  if (scanning) {
    if (!quiet) quietScan = false; // someone asked: show it
    return;
  }
  scanning = true;
  quietScan = quiet;
  showAim(!recorder && !quiet);
  setSyncPill();
  const startedAt = performance.now();
  let lastHit = 0;
  loop();
  async function loop() {
    if (!scanning) return;
    const t = await scanOnce();
    if (t) {
      lastHit = performance.now();
      onSighting(t);
    }
    if (!scanning) return;
    const since = performance.now() - Math.max(startedAt, lastHit);
    if (since > limitMs) {
      stopScanning();
      setSyncPill();
      if (offset === null) showAimText(null);
      return;
    }
    scanTimer = setTimeout(loop, since < 3000 ? 120 : 450);
  }
}

function stopScanning() {
  scanning = false;
  quietScan = false;
  clearTimeout(scanTimer);
  showAim(false);
}

async function scanOnce() {
  // Microphone phones sync from their own preview; cameras from the viewfinder.
  const src = role === 'mic' ? $('#micPreview') : video;
  if (src.readyState < 2) return null;
  // 720 px wide keeps a beacon across the room readable (~3 px per QR module).
  // Big enough to read a beacon across a room; the decoder works in the background.
  const w = 'BarcodeDetector' in window ? 720 : 560;
  const h = Math.round((src.videoHeight / src.videoWidth) * w) || 315;
  scanCanvas.width = w;
  scanCanvas.height = h;
  const localT = now();
  scanCanvas.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, w, h);
  const text = await decodeQR(scanCanvas);
  const tc = parseTimecode(text);
  if (!tc || tc.e !== eventId) return null;
  return { beacon: tc.t, local: localT };
}

function onSighting({ beacon, local }) {
  if (fresh) {
    // re-syncing: keep the locked timing until the new readings can take over
    fresh.push(beacon - local);
    if (fresh.length >= 3) {
      samples.splice(0, samples.length, ...fresh);
      fresh = null;
      toast('Timing refreshed');
    }
  } else samples.push(beacon - local);
  if (samples.length > 40) samples.shift();
  if (samples.length >= 3 && !fresh) {
    offset = Math.max(...samples);
    saveLock();
  }
  setSyncPill();
  if (!quietScan) {
    $('#aim').classList.add('hit');
    setTimeout(() => $('#aim').classList.remove('hit'), 250);
  }

  if (recorder && current?.recStartLocal) {
    const mediaSec = (local - current.recStartLocal) / 1000;
    if (current.syncHints.length < 8 && !current.syncHints.some((s) => Math.abs(s - mediaSec) < 2)) {
      current.syncHints.push(+mediaSec.toFixed(2));
      if (current.syncHints.length === 1 && !quietScan) toast('Clip synced — shoot away');
    }
    if (current.syncHints.length && !fresh) stopScanning();
  } else if (samples.length >= 3 && !recorder && !fresh) {
    stopScanning();
    showAimText("Synced with the beacon. That's it: record whenever you like.");
    setTimeout(() => showAimText(null), 3500);
  }
}

function setSyncPill() {
  const pill = $('#syncPill');
  const ok = synced();
  pill.className = 'pill ' + (ok ? 'synced' : 'unsynced');
  pill.textContent = ok ? (fresh ? 'Synced · refreshing…' : 'Synced') : samples.length ? 'Syncing…' : scanning ? 'Looking for the beacon…' : 'Not synced · tap to sync';
  pill.title = ok ? 'Timing locked in with the beacon. Tap to take a fresh reading.' : 'Point at the beacon screen to sync';
}
if (offset !== null) samples.push(offset, offset, offset);
setSyncPill();

function showAim(on) {
  $('#aim').classList.toggle('show', on);
  showAimText(on ? 'Point at the beacon screen' : null);
}
function showAimText(t) {
  $('#aimText').textContent = t || '';
  $('#aimText').classList.toggle('show', !!t);
}

/** The pill: sync, or (already synced) take a fresh reading without losing the lock meanwhile. */
function syncNow() {
  if (synced() && !scanning) fresh = [];
  startScanning();
  setSyncPill();
}
$('#syncPill').onclick = syncNow;

// ------------------------------------------------------------- recording ----

let recorder = null;
let current = null;
let lastBlob = null;

function pickMime() {
  const options = [
    'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return options.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

$('#shutter').onclick = () => {
  // a tap is always the shooter's call: it overrides recording the director started
  // (stopping while on air, whoever started it, holds until the camera has been off air)
  if (recorder && $('#camView').classList.contains('onair')) remoteOptOut = true;
  remoteRec = false;
  clearTimeout(offAirTimer);
  recorder ? stopRecording() : startRecording();
};

// ---- recording while on air ---------------------------------------------------------------
// If the director puts this camera on air and it isn't recording, it starts, so the best
// shots are always in full quality. When it goes off air, a recording the director started
// stops after a few seconds (quick cuts back don't chop it up); one the shooter started
// keeps going. If the shooter stops it while on air, it stays stopped until next time.
let remoteRec = false, remoteOptOut = false, offAirTimer = null, optOutTimer = null;
const OFF_AIR_GRACE = 8000;
// The director's recording and the person's own: on air while the director is recording the
// show, the phone records (if it wasn't already). If its person was already recording, that
// recording carries on, and the phone starts a new clip there, so the director's cut has its
// own in-point; when the director cuts away (or stops recording), that clip ends there too,
// and the person's recording carries on until they stop it. The person always comes first.
let directorIn = false, directorRecording = false;
window.vmRec = () => ({ recording: !!recorder, remoteRec, directorRecording, directorIn, offAirTimer: !!offAirTimer }); // (tests and diagnostics)
function onAirRecording(on, rec) {
  if (role !== 'cam' || ev?.solo || !$('#camView').classList.contains('on')) return;
  directorRecording = !!rec; // (is the director recording the show? when they stop, so does their recording here)
  if (on && rec) {
    clearTimeout(offAirTimer);
    offAirTimer = null;
    clearTimeout(optOutTimer);
    if (!recorder && !remoteOptOut) {
      remoteRec = true;
      startRecording();
      toast('Recording: you\'re on air', 3000);
      announce('Recording started because you are on air');
    } else if (recorder && !remoteRec && !directorIn) {
      directorIn = true;
      rollRecording(); // (a new clip from the director's cut; your recording carries on)
    }
  } else if (!on || !rec) {
    if (directorIn && recorder && !remoteRec) {
      directorIn = false;
      rollRecording(); // (the director's clip ends here; your recording carries on)
    }
    // A stop the shooter chose holds until they've really been off air for a while. A blip
    // off air (the break slate flashing up during a Wi-Fi hiccup) used to clear it, and the
    // studio would restart the recording they had just stopped.
    clearTimeout(optOutTimer);
    optOutTimer = setTimeout(() => (remoteOptOut = false), OFF_AIR_GRACE);
    if (remoteRec && recorder && !offAirTimer) {
      offAirTimer = setTimeout(() => {
        offAirTimer = null;
        if (remoteRec && recorder && !($('#camView').classList.contains('onair') && directorRecording)) {
          remoteRec = false;
          stopRecording();
          toast(directorRecording ? 'Off air: recording stopped. Tap record to keep shooting.' : 'The director stopped recording the show: recording stopped. Tap record to keep shooting.', 4000);
        }
      }, OFF_AIR_GRACE);
    }
  }
}
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog[open], button')) return;
  if (e.key === '?') return guestHelp.showModal();
  if (e.key === ' ' && role === 'cam' && $('#camView').classList.contains('on')) {
    e.preventDefault();
    $('#shutter').click();
  }
});
$('#syncPill').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), syncNow()));

// What gets recorded: the camera's own picture, at the resolution and frame rate chosen in
// settings (like any camera app), plus this phone's sound. The upright square below only
// feeds the live view to the host. If the phone is turned with rotation lock on, the
// picture is stored as the sensor gives it and the clip's log says how to turn it upright;
// the studio straightens it, and Save writes it into the file for Photos.
function recordSource() {
  if (kit.track?.readyState === 'live') return { native: true, stream: new MediaStream([kit.track, ...outAudioTracks()]) };
  return { native: false, stream: upright?.stream || stream }; // very old browsers: the square, as before
}
function videoBitrate() {
  const q = QUALITY[kit.quality] || QUALITY['1080p30'];
  return Math.round(Math.min(60e6, Math.max(4e6, q.w * q.h * q.fps * 0.2))); // ~12 Mbps at 1080p30
}

async function startRecording({ roll = false } = {}) {
  if (!window.MediaRecorder) return toast('This browser cannot record video. Try Safari or Chrome.');
  const mime = pickMime();
  const src = recordSource();
  const rec = new MediaRecorder(src.stream, { mimeType: mime || undefined, videoBitsPerSecond: videoBitrate(), audioBitsPerSecond: 160_000 });
  const clip = new ClipUpload(rec.mimeType || mime || 'video/mp4');
  clip.native = src.native;
  clip.key = src.native ? nativeKey() : null;
  current = clip;
  recorder = rec;
  rec.ondataavailable = (e) => e.data.size && clip.push(e.data);
  rec.onstart = () => {
    clip.recStartLocal = now();
    clip.begin(offset);
    const v = src.native ? nativeView() : upright?.view;
    if (v) clip.orient.push({ t: 0, ...v });
  };
  rec.onstop = () => {
    clip.recStopLocal = now();
    clip.finish();
  };
  // (when it was told to stop: on a busy phone the stop event can come a while later)
  const stopNow = rec.stop.bind(rec);
  rec.stop = () => {
    clip.stopCalledAt ??= now();
    return stopNow();
  };
  clip.startCalledAt = now();
  rec.start(1000);
  if (roll) return rec;
  $('#shutter').classList.add('rec');
  $('#shutter').setAttribute('aria-label', 'Stop recording');
  $('#timer').hidden = false;
  feedBtnUi();
  tickTimer();
  socket?.setRecording(true);
  if (ev?.solo) return;
  // Timing locked in: don't ask. Still glance for the beacon quietly in the first moments,
  // in case it's in shot (that sharpens the studio's Auto-sync), with nothing on screen.
  if (synced()) return startScanning(8000, { quiet: true });
  startScanning(8000);
  showAimText('Aim at the beacon for a second');
  setTimeout(() => { if (current === clip && !clip.syncHints.length) showAimText(null); }, 6000);
}

/**
 * Carry on recording in a new clip: when the phone settles into a new orientation, the
 * picture changes shape, or the lens changes. Each clip then has one shape and one turn,
 * so it saves upright and lines up back-to-back in the studio. The new recording starts
 * before the old one stops, so nothing is missed.
 */
function rollRecording() {
  if (!recorder) return;
  const old = recorder;
  const stopOld = () => old.state !== 'inactive' && old.stop();
  startRecording({ roll: true }).then((rec) => {
    if (!rec) return stopOld();
    // Stop the old clip only once the new one is really recording (a phone can take a
    // moment to start), plus a little, so the two always overlap rather than leave a gap.
    if (rec.state === 'recording' && current?.recStartLocal) setTimeout(stopOld, 300);
    else rec.addEventListener('start', () => setTimeout(stopOld, 300), { once: true });
    setTimeout(stopOld, 3000); // whatever happens, never leave the old one running
  });
}

function stopRecording() {
  directorIn = false; // (the person stopped: no director's clip open either)
  recorder.stop();
  recorder = null;
  setTimeout(feedBtnUi);
  stopScanning();
  $('#shutter').classList.remove('rec');
  $('#shutter').setAttribute('aria-label', 'Start recording');
  $('#timer').hidden = true;
  socket?.setRecording(false);
}

function tickTimer() {
  if (!recorder || !current?.recStartLocal) return recorder && requestAnimationFrame(tickTimer);
  const s = Math.floor((now() - current.recStartLocal) / 1000);
  $('#timerText').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  setTimeout(tickTimer, 250);
}

// Pause feed: stop sending this camera's picture and sound to the director for a moment
// (the same as Live off in the event sheet). Only offered while this camera isn't on air
// and isn't recording; going on air brings the feed straight back.
function feedBtnUi() {
  const b = $('#feedBtn');
  if (!b) return;
  b.hidden = role !== 'cam' || !!ev?.solo || !link;
  b.setAttribute('aria-pressed', String(paused));
  b.textContent = paused ? 'Resume feed' : 'Pause feed';
}
$('#feedBtn').onclick = () => {
  paused = !paused;
  $('#liveSwitch').checked = !paused;
  applyPause();
  feedBtnUi();
  announce(paused ? 'Feed paused. The director can’t see or hear you.' : 'Feed back on');
};

window.addEventListener('beforeunload', (e) => {
  if (recorder) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ------------------------------------------------------------ clips ------------
// A finished clip is hashed, signed off, saved to this phone's outbox, then sent
// to the host over the LAN. It leaves the outbox only when the host confirms it.

/** How long a recording really is, from the file (WebM from a recorder has no length in its header: seek to the end to find it). */
function mediaSeconds(blob) {
  return new Promise((resolve) => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob);
    let done = false;
    const end = (s) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      resolve(Number.isFinite(s) && s > 0 ? s : null);
    };
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) return end(v.duration);
      v.ontimeupdate = () => Number.isFinite(v.duration) && end(v.duration);
      v.ondurationchange = () => Number.isFinite(v.duration) && v.duration > 0 && end(v.duration);
      v.currentTime = 1e9;
    };
    v.onerror = () => end(null);
    setTimeout(() => end(null), 4000);
    v.src = url;
  });
}
const deletedEvents = new Set(); // events deleted on this phone in this visit
class ClipUpload {
  constructor(mime, kind = 'video') {
    this.mime = mime;
    this.kind = kind;
    this.all = [];
    this.syncHints = [];
    this.orient = []; // [{t: seconds into the clip, rect, upright}] — where the picture sits in the square, and its shape
    this.qa = [];     // [[ms into the clip, score, 'l'|'p']] — the shot's quality as it was recorded
    this.id = [...crypto.getRandomValues(new Uint8Array(10))].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  }

  begin(off) {
    this.synced = off !== null;
    this.t0Est = this.recStartLocal + (off ?? 0);
  }

  push(blob) {
    this.all.push(blob);
  }

  async finish() {
    const blob = new Blob(this.all, { type: this.mime });
    this.all = [];
    if (!blob.size) return;
    // A clip's length comes from the recording itself. The recorder's start and stop events
    // can arrive late on a busy phone (a take stopped a second after a turn once came out
    // 0 s long); the media can't be wrong. It ends when it was told to stop.
    const end = this.stopCalledAt ?? this.recStopLocal ?? now();
    const real = await mediaSeconds(blob);
    if (this.recStartLocal == null) {
      this.recStartLocal = real ? end - real * 1000 : this.startCalledAt ?? end;
      this.begin(offset);
    } else if (real && Math.abs(end - this.recStartLocal - real * 1000) > 250) {
      const shift = end - real * 1000 - this.recStartLocal;
      this.recStartLocal += shift;
      this.t0Est = (this.t0Est ?? 0) + shift;
      for (const o of this.orient || []) if (o.t) o.t = Math.max(0, Math.round((o.t - shift / 1000) * 1000) / 1000);
    }
    this.recStopLocal = end;
    // Use the best clock offset we have by now (the phone may have synced mid-clip).
    if (offset !== null) {
      this.t0Est = this.recStartLocal + offset;
      this.synced = true;
    }
    const { parts, root, sig } = await sealClip(blob, { eventId, clipId: this.id, termsHash: ev.termsHash, signingKey: ident.key, sign: signStatement });
    const dims = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const meta = {
      id: this.id,
      kind: this.kind,
      mime: blob.type || this.mime,
      parts,
      root,
      sig,
      cid: me.contributorId,
      name: me.name,
      jwk: ident.jwk,
      joinSig: me.joinSig,
      t0: this.t0Est,
      t0Source: this.synced || this.syncHints.length ? 'phone' : 'clock',
      // the beacon lock this clip's timing comes from: when it was read, and from how many readings
      ...(this.synced && lockAt ? { sync: { at: lockAt, readings: samples.length } } : {}),
      dur: Math.round(this.recStopLocal - this.recStartLocal),
      w: this.kind === 'audio' ? 0 : this.native ? video.videoWidth || dims.width || 0 : upright?.S || video.videoWidth || dims.width || 0,
      h: this.kind === 'audio' ? 0 : this.native ? video.videoHeight || dims.height || 0 : upright?.S || video.videoHeight || dims.height || 0,
      syncHints: this.syncHints,
      ...(this.kind === 'video' ? { audio: audio.fix?.stereo ? 'stereo' : 'mono' } : {}), // mono = the same sound on both sides
      ...(this.kind === 'video' && this.native ? { native: true, orient: this.orient, qa: this.qa, device: DEVICE } : {}),
      ...(this.kind === 'video' && !this.native && upright ? { square: upright.S, orient: this.orient, qa: this.qa, device: DEVICE } : {}),
    };
    if (deletedEvents.has(eventId)) return; // the event was deleted while this clip was being finished
    const keepHere = ev?.solo || uploadsOff();
    await idb.put('outbox', { eventId, id: this.id, blob, meta, status: keepHere ? 'saved' : 'waiting', createdAt: Date.now() }).catch(() => {});
    if (keepHere && !ev?.solo) {
      lastBlob = { blob, name: this.id };
      renderLibrary();
      toast('Saved on this phone (this show keeps clips on the phones)');
      return;
    }
    if (ev?.solo) {
      // On your own: nothing to send; it's saved on this device, in My events.
      lastBlob = { blob, name: this.id };
      renderLibrary();
      toast('Saved to My events');
      return;
    }
    const clip = { id: this.id, blob, meta, sent: 0 };
    outbox.set(clip.id, clip);
    lastBlob = { blob, name: clip.id };
    renderOutbox();
    link.enqueue(clip);
  }
}

const thumbprintOf = (jwk) => thumbprint(jwk);

// ------------------------------------------------------------ stay awake ----
// Browsers stop recording when the screen sleeps. Hold a wake lock for the whole
// session and take it back whenever the page becomes visible again.

let lock = null;
async function keepAwake() {
  lock = await wakeLock();
  if (!lock && !keepAwake.warned) {
    keepAwake.warned = true;
    toast('Keep this screen on — this browser can\'t hold it awake by itself', 6000);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (role === 'mic' || $('#camView').classList.contains('on'))) keepAwake();
  if (document.visibilityState === 'visible') setTimeout(checkCameraAlive, 600);
});
// Phones can turn the camera off while the browser is in the background (or another app takes
// it). Then the picture freezes and the director sees nothing: show a one-tap way back.
function checkCameraAlive() {
  if (role !== 'cam' || !$('#camView').classList.contains('on')) return;
  const dead = !kit.track || kit.track.readyState === 'ended' || (micTrack && micTrack.readyState === 'ended');
  if (!dead) return;
  diag('error', 'The camera stopped while VUEMesh was in the background');
  $('#camBack').hidden = false;
  $('#camBackGo').focus();
}
setInterval(() => document.visibilityState === 'visible' && checkCameraAlive(), 5000);
$('#camBackGo').onclick = async () => {
  $('#camBackGo').disabled = true;
  $('#camBackErr').hidden = true;
  try {
    makeAudio();
    await withTimeout(openCamera(), 10000, 'The camera didn\u2019t start');
    audio.ctx?.resume();
    $('#camBack').hidden = true; // (opening the camera hands the new picture to the director too)
    toast('Camera back on');
  } catch (e) {
    $('#camBackErr').hidden = false;
    $('#camBackErr').textContent = e.name === 'NotAllowedError' ? 'The phone said no: allow the camera for this site in its settings (aA on iPhone), then tap again.' : 'It still didn\u2019t start: Reload VUEMesh below (your clips are kept), or close the app fully and open it again.';
  }
  $('#camBackGo').disabled = false;
};
$('#camBackReload').onclick = () => location.reload();
$('#setupReload') && ($('#setupReload').onclick = () => location.reload());

// --------------------------------------------------------- orientation hint ----

function setupOrientationHint() {
  const portraitEvent = ev.orientation === 'portrait';
  const pill = $('#rotate');
  const mq = matchMedia('(orientation: portrait)');
  const update = () => {
    if (upright) {
      pill.hidden = true; // the sensor-based coaching line covers this, and knows the real orientation
      return;
    }
    const wrong = portraitEvent ? !mq.matches : mq.matches;
    pill.hidden = !wrong;
    pill.textContent = portraitEvent ? 'Hold your phone upright for this event' : 'Turn your phone sideways for this event';
  };
  mq.addEventListener('change', update);
  update();
}

// --------------------------------------------------------------- microphone ----
// A phone as the room microphone: sync with the beacon once (camera on), lock in,
// then the camera turns off and the phone records sound for the whole event in
// overlapping 10-minute pieces, each sent to the host as soon as it closes.

const SEGMENT_MS = 10 * 60 * 1000;
const OVERLAP_MS = 1000;
let mic = null;

function pickAudioMime() {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
}

// ---- choosing the microphone in microphone mode (a lav, a USB mic, a headset...) ----
async function fillMicPick() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const cur = micTrack?.getSettings?.().deviceId || stream?.getAudioTracks()[0]?.getSettings?.().deviceId;
  $('#micPick').innerHTML = devs.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('');
  $('#micPick').closest('.micpick').hidden = devs.length < 2;
}
$('#micPick').onchange = (e) => switchMicLive(e.target.value);
navigator.mediaDevices?.addEventListener?.('devicechange', () => role === 'mic' && fillMicPick());

/**
 * Switch microphones in microphone mode. While recording, the recording carries on in a
 * new piece from the new microphone; the old piece stops only once the new one is running,
 * so nothing is lost.
 */
async function switchMicLive(deviceId) {
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: { ...RAW_AUDIO, deviceId: { exact: deviceId } } });
  } catch (e) {
    fillMicPick();
    return toast(`Couldn't use that microphone: ${e.message}`, 5000);
  }
  const fresh = s.getAudioTracks()[0];
  const oldTrack = stream.getAudioTracks()[0];
  micTrack = fresh;
  prefs.micId = deviceId;
  savePrefs();
  stream = new MediaStream([...stream.getVideoTracks(), fresh]);
  if ($('#micPreview').srcObject) $('#micPreview').srcObject = stream;
  link?.replaceStream(role === 'mic' ? new MediaStream([fresh]) : stream);
  const old = mic?.current;
  if (old) {
    clearTimeout(old.timer);
    startSegment();
    const stopOld = () => {
      if (old.rec.state !== 'inactive') old.rec.stop();
      setTimeout(() => oldTrack?.stop(), 1500);
    };
    mic.current.rec.addEventListener('start', () => setTimeout(stopOld, OVERLAP_MS), { once: true });
    setTimeout(stopOld, 4000);
  } else oldTrack?.stop();
  announce(`Microphone: ${fresh.label || 'switched'}`);
  setMicState?.(`Using ${fresh.label || 'the new microphone'}`);
}

// The director put this microphone on air (or took it off): say so on its screen.
function micTally(on) {
  const was = $('#micView').classList.contains('onair');
  $('#micView').classList.toggle('onair', on);
  $('#micOnAir').hidden = !on;
  if (on !== was) announce(on ? 'Your microphone is on air' : 'Off air');
}
function startMic() {
  fillMicPick();
  // (fresh, also when rejoining)
  $('#micPreview').hidden = false;
  ['#micGo', '#micSkip'].forEach((sel) => ($(sel).hidden = false));
  ['#micDim', '#micResync', '#micStop', '#micLeave', '#micElapsed'].forEach((sel) => ($(sel).hidden = true));
  $('#micGo').disabled = true;
  $('#micGo').textContent = 'Waiting for the beacon…';
  $('#micView').classList.add('on');
  $('#micPreview').srcObject = stream;
  $('#micPreview').play().catch(() => {});
  micMeter();
  startScanning();
  const waitSync = setInterval(() => {
    if (offset !== null && samples.length >= 3) {
      clearInterval(waitSync);
      stopScanning();
      $('#micGo').disabled = false;
      $('#micGo').textContent = 'Synced · lock in and start recording';
      $('#micStep').textContent = 'Step 2 of 2 · Record';
      $('#micHead').textContent = 'Synced. Lock it in.';
      $('#micSub').textContent = 'The camera turns off and this phone becomes the microphone. Set it down near the people talking.';
      announce('Synced with the beacon. Ready to lock in.');
    }
  }, 300);
  $('#micGo').onclick = () => { clearInterval(waitSync); lockMic(true); };
  $('#micSkip').onclick = () => {
    if (!confirm('Record without syncing? The host will have to line your sound up by hand.')) return;
    clearInterval(waitSync);
    lockMic(false);
  };
}

let micCtx = null;
function micMeter() {
  try {
    const ctx = (micCtx = new AudioContext());
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    let src = ctx.createMediaStreamSource(stream);
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    const bar = $('#micLevel');
    const meter = bar.parentElement;
    let lastStream = stream;
    const tick = () => {
      if (stream !== lastStream) {
        try { src.disconnect(); } catch {}
        src = ctx.createMediaStreamSource(stream);
        src.connect(an);
        lastStream = stream;
      }
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      const pct = Math.min(100, Math.round(Math.sqrt(peak) * 100));
      bar.style.width = pct + '%';
      meter.setAttribute('aria-valuenow', pct);
      requestAnimationFrame(tick);
    };
    ctx.resume();
    tick();
  } catch {}
}

async function lockMic(synced) {
  micCtx?.resume();
  // Camera off; only the microphone stays.
  stream.getVideoTracks().forEach((t) => t.stop());
  stream = new MediaStream(stream.getAudioTracks());
  link?.replaceStream(stream);
  $('#micPreview').hidden = true;
  ['#micGo', '#micSkip'].forEach((sel) => ($(sel).hidden = true));
  ['#micDim', '#micResync', '#micStop', '#micLeave'].forEach((sel) => ($(sel).hidden = false));
  $('#micElapsed').hidden = false;
  $('#micStep').textContent = 'Recording';
  $('#micHead').textContent = 'This phone is the microphone';
  $('#micSub').textContent = synced ? 'Synced with the beacon. Set it down; you can dim the screen.' : 'Not synced — the host will line it up by hand.';
  mic = { started: now(), current: null, previous: null, pausedFor: 0 };
  socket?.setRecording(true);
  startSegment();
  tickMic();
  announce('Recording. This phone is the microphone.');
}

function startSegment() {
  const mime = pickAudioMime();
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 128_000 });
  const clip = new ClipUpload(rec.mimeType || mime || 'audio/mp4', 'audio');
  rec.ondataavailable = (e) => e.data.size && clip.push(e.data);
  rec.onstart = () => {
    clip.recStartLocal = now();
    clip.begin(offset);
  };
  rec.onstop = () => {
    clip.recStopLocal = now();
    clip.finish();
  };
  rec.onerror = () => setMicState('The recorder stopped unexpectedly — starting a new piece.');
  rec.start(1000);
  const seg = { rec, clip, timer: null };
  // Next piece starts a second before this one ends, so there's never a gap.
  seg.timer = setTimeout(() => {
    const old = mic.current;
    startSegment();
    setTimeout(() => old.rec.state !== 'inactive' && old.rec.stop(), OVERLAP_MS);
  }, SEGMENT_MS);
  mic.current = seg;
}

function tickMic() {
  if (!mic) return;
  const s = Math.floor((now() - mic.started) / 1000);
  const txt = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  $('#micElapsed').textContent = txt;
  $('#pocketTime').textContent = txt;
  // The phone may have killed the recorder or the mic while the screen was off.
  const track = stream.getAudioTracks()[0];
  if (mic.current && (mic.current.rec.state !== 'recording' || track?.readyState === 'ended') && document.visibilityState === 'visible') recoverMic();
  setTimeout(tickMic, 500);
}

let recovering = false;
async function recoverMic() {
  if (recovering) return;
  recovering = true;
  try {
    clearTimeout(mic.current.timer);
    if (mic.current.rec.state !== 'inactive') mic.current.rec.stop();
    if (stream.getAudioTracks()[0]?.readyState === 'ended') {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO });
      stream = fresh;
      link?.replaceStream(stream);
    }
    startSegment();
    setMicState('Recording was interrupted while the screen was off. It\'s running again; keep the screen on for no gaps.');
  } catch (e) {
    setMicState('Tap anywhere to restart the microphone.');
  } finally {
    recovering = false;
  }
}

function setMicState(t) {
  $('#micState').textContent = t;
}

function stopMic() {
  if (!mic) return;
  clearTimeout(mic.current.timer);
  mic.current.rec.stop();
  mic = null;
  socket?.setRecording(false);
  ['#micDim', '#micResync', '#micStop'].forEach((sel) => ($(sel).hidden = true));
  $('#micLeave').hidden = false;
  $('#micHead').textContent = 'Stopped';
  $('#micSub').textContent = 'The last pieces are on their way to the host. Leave whenever you like: anything not sent yet goes when you rejoin.';
  announce('Recording stopped');
}
$('#micStop').onclick = () => {
  if (!confirm('Stop recording? Everything so far will be sent to the host.')) return;
  stopMic();
};
$('#micLeave').onclick = async () => {
  if (mic && !confirm('Stop recording and leave the event? Everything so far is kept and sends when you rejoin.')) return;
  if (mic) {
    savingOnLeave = outbox.size + 1;
    stopMic();
  }
  await leaveEvent();
};

$('#micDim').onclick = () => {
  $('#pocket').classList.add('on');
  $('#pocket').focus();
};
$('#pocket').onclick = () => $('#pocket').classList.remove('on');
$('#pocket').onkeydown = (e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && $('#pocket').classList.remove('on');

// Re-sync: clocks drift a little over hours. Open the camera briefly and read the beacon again.
$('#micResync').onclick = async () => {
  $('#micResync').disabled = true;
  setMicState('Point the phone at the beacon…');
  try {
    const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    $('#micPreview').srcObject = cam;
    await $('#micPreview').play().catch(() => {});
    $('#micPreview').hidden = false;
    samples.length = 0;
    offset = null;
    startScanning();
    const until = Date.now() + 20000;
    while ((offset === null || samples.length < 3) && Date.now() < until) await new Promise((r) => setTimeout(r, 300));
    stopScanning();
    cam.getTracks().forEach((t) => t.stop());
    $('#micPreview').hidden = true;
    setMicState(offset !== null ? 'Re-synced. The next piece uses the new timing.' : 'Couldn\'t see the beacon. Still recording with the old timing.');
  } catch {
    setMicState('Camera unavailable. Still recording.');
  } finally {
    $('#micResync').disabled = false;
  }
};

// --------------------------------------------------------- upright pipeline ----
// The camera picture is redrawn onto a square canvas, always world-upright, using
// gravity to undo any turn the screen didn't follow (rotation lock). That canvas is
// what gets recorded and what the host sees live, so every clip arrives the right
// way up, whichever way the phone was held — and it can turn mid-shot. A log of
// every turn travels with the clip so the studio can slice exactly there.

const sensors = new Sensors();
const meter = new PictureMeter();
let upright = null;

/** How to show the camera's own picture upright right now (for the recording's log). */
function nativeView() {
  const vw = video.videoWidth || 0, vh = video.videoHeight || 0;
  const phi = sensors.correction(); // counter-clockwise degrees the picture is off by
  const rot = (360 - phi) % 360;    // the studio turns clockwise
  const z = kit.digitalZoom || 1;
  const turned = rot % 180 !== 0;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  return {
    rot,
    rect: z > 1.001 ? { x: r3((1 - 1 / z) / 2), y: r3((1 - 1 / z) / 2), w: r3(1 / z), h: r3(1 / z) } : null,
    upright: (turned ? vh > vw : vw >= vh) ? 'landscape' : 'portrait',
    ev: kit.digitalEV ? Math.round(kit.digitalEV * 10) / 10 : 0,
    ct: Math.abs((kit.contrast || 1) - 1) > 0.005 ? Math.round(kit.contrast * 100) / 100 : 0,
  };
}
/** What makes a clip one shape: its turn, its picture size, and which camera. */
const nativeKey = () => `${nativeView().rot}|${video.videoWidth}x${video.videoHeight}|${kit.deviceId || ''}`;
let pendingRoll = null;
let lastSizeChange = 0;
function trackNative() {
  if (!recorder || !current?.native || !current.recStartLocal) return;
  const key = nativeKey();
  if (key === current.key) {
    pendingRoll = null;
    // same shape and turn: log digital zoom or exposure changes within this clip
    const v = nativeView();
    const last = current.orient[current.orient.length - 1];
    const t = Math.round(now() - current.recStartLocal) / 1000;
    // (a smooth zoom changes every frame: log it up to 30 times a second, which plays back smooth)
    if (!last || last.ev !== v.ev || last.ct !== v.ct || (JSON.stringify(last.rect) !== JSON.stringify(v.rect) && t - last.t >= 0.033)) current.orient.push({ t, ...v });
    return;
  }
  // The shape or turn changed: carry on in a new clip (nothing more is logged into this one).
  // With rotation lock on, only the turn changes, and the sensor already waited a second for
  // it to settle: roll now. If the picture itself changed size (rotation unlocked), wait until
  // things settle so a phone being turned rolls once, not three times.
  const t = performance.now();
  const [, size] = current.key.split('|'), [, nowSize] = key.split('|');
  if (size !== nowSize) lastSizeChange = t;
  if (size === nowSize && t - lastSizeChange > 1500) {
    pendingRoll = null;
    return rollRecording();
  }
  if (!pendingRoll || pendingRoll.key !== key) pendingRoll = { key, since: t };
  else if (t - pendingRoll.since > 600) {
    pendingRoll = null;
    rollRecording();
  }
}

function makeUpright() {
  const st = stream.getVideoTracks()[0]?.getSettings?.() || {};
  const big = Math.max(st.width || 0, st.height || 0, video.videoWidth || 0, video.videoHeight || 0) || 1280;
  const S = big >= 1280 ? 1080 : 720; // only the live view now, so it can be lighter
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
  document.body.append(canvas);
  if (!canvas.captureStream) {
    canvas.remove();
    return; // very old browser: record the camera as-is
  }
  const g = canvas.getContext('2d', { alpha: false });
  const cs = canvas.captureStream(30);
  $('#rotate').hidden = true; // the sensor-based coaching knows the real orientation; the old screen-shape guess goes
  upright = { S, canvas, g, stream: new MediaStream([...cs.getVideoTracks(), ...outAudioTracks()]), view: null, drawn: 0 };
  // The loop runs on the viewfinder's own frames. If those stop coming (it can happen after
  // a lens change or an interruption), the keep-alive below restarts it, so the director's
  // picture doesn't freeze on one frame.
  let chain = 0, lastDraw = performance.now();
  const draw = (id = chain) => {
    if (id !== chain) return; // an older loop the keep-alive replaced
    lastDraw = performance.now();
    if (video.readyState >= 2 && video.videoWidth) {
      upright.drawn++;
      const phi = sensors.correction(); // counter-clockwise degrees to undo
      const vw = video.videoWidth, vh = video.videoHeight;
      const turned = phi % 180 !== 0;
      const uw = turned ? vh : vw, uh = turned ? vw : vh;
      const k = S / Math.max(uw, uh);
      g.fillStyle = '#000';
      g.fillRect(0, 0, S, S);
      g.save();
      g.translate(S / 2, S / 2);
      if (phi) g.rotate((-phi * Math.PI) / 180);
      // Digital zoom crops the middle of the picture; digital exposure brightens it.
      const z = kit.digitalZoom || 1;
      const sw = vw / z, sh = vh / z;
      const look = CANVAS_FILTER ? lookFilter() : '';
      if (look) g.filter = look;
      g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, (-vw * k) / 2, (-vh * k) / 2, vw * k, vh * k);
      g.filter = 'none';
      g.restore();
      // Safari has no canvas filters: brightness and contrast with blending instead, over the picture only
      if (!CANVAS_FILTER) lookByBlending(g, canvas, ((S - uw * k) / 2), ((S - uh * k) / 2), uw * k, uh * k);
      const r3 = (x) => Math.round(x * 1000) / 1000;
      const rect = { x: r3((S - uw * k) / 2 / S), y: r3((S - uh * k) / 2 / S), w: r3((uw * k) / S), h: r3((uh * k) / S) };
      const shape = uw >= uh ? 'landscape' : 'portrait';
      const v = upright.view;
      if (!v || v.upright !== shape || Math.abs(v.rect.w - rect.w) > 0.005 || Math.abs(v.rect.h - rect.h) > 0.005) {
        upright.view = { rect, upright: shape };
        link?.control({ t: 'orient', ...upright.view });
        if (recorder && current?.recStartLocal && !current.native) current.orient.push({ t: Math.round(now() - current.recStartLocal) / 1000, ...upright.view });
      }
      trackNative();
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => draw(id));
    else setTimeout(() => draw(id), 33);
  };
  draw();
  setInterval(() => {
    if (document.hidden || performance.now() - lastDraw < 700) return;
    if (!video.srcObject?.getVideoTracks?.().some((t) => t.readyState === 'live')) return;
    if (video.paused) video.play().catch(() => {});
    chain++;
    draw(chain);
  }, 500);
  setInterval(measureShot, 500);
  setInterval(() => upright?.view && link?.control({ t: 'orient', ...upright.view }), 3000); // in case a message was lost
}

// Twice a second: how good is this shot? Tell the host, keep a log, coach the shooter.
let drawnAtQa = 0;
function measureShot() {
  if (!upright?.view) return;
  // pv: preview frames drawn since the last report, so the studio can tell a phone that's
  // drawing but not getting through (worth reconnecting) from one that has stopped drawing
  const pv = upright.drawn - drawnAtQa;
  drawnAtQa = upright.drawn;
  const pic = meter.measure(upright.canvas, upright.view.rect);
  const parts = partsFrom(sensors, pic);
  const base = baseScore(parts);
  const r2 = (x) => (x == null ? undefined : Math.round(x * 100) / 100);
  link?.control({ t: 'qa', pv, base: r2(base), upright: upright.view.upright, fixed: !IS_PHONE, parts: Object.fromEntries(Object.entries(parts).map(([k, x]) => [k, r2(x)])) });
  if (recorder && current?.recStartLocal) current.qa.push([Math.round(now() - current.recStartLocal), r2(base), upright.view.upright[0]]);
  updateHint(hintFor(parts, upright.view.upright, ev?.orientation, pic?.luma, { fixed: !IS_PHONE }));
  // A computer's camera can't be turned: say once how its picture will be used instead.
  if (!IS_PHONE && ev?.orientation && upright.view.upright !== ev.orientation && pcNoted !== ev.orientation) {
    pcNoted = ev.orientation;
    showDm('info', `This computer's camera is ${upright.view.upright} and the film is ${ev.orientation}, so the studio will crop your picture to fit. Nothing to change here.`);
  }
}

// A hint has to hold steadily before it appears (orientation advice 1.5 s, the rest
// 1.8 s), and stays until things have been fine for 1.2 s, so it never flickers.
let pcNoted = null;
// Messages (toasts) sit just below the stack of top notices, however tall it is right now.
new ResizeObserver(() => document.documentElement.style.setProperty('--stack-h', $('#topstack').offsetHeight + 'px')).observe($('#topstack'));
const HINT = { candidate: null, since: 0, shown: null };
function updateHint(hint) {
  const t = performance.now();
  if (hint !== HINT.candidate) {
    HINT.candidate = hint;
    HINT.since = t;
  }
  const held = t - HINT.since;
  if (hint && hint !== HINT.shown && held >= (/sideways|upright/i.test(hint) ? 1500 : 1800)) {
    HINT.shown = hint;
    $('#hint').textContent = hint;
    $('#hint').hidden = false;
  } else if (!hint && HINT.shown && held >= 1200) {
    HINT.shown = null;
    $('#hint').hidden = true;
  }
}

// The host can light this phone's tally: you're on air.
let onAirSince = null;
function setTally(on) {
  // keep a tally of time on air, for the Show tab in My events
  if (on && !onAirSince) onAirSince = Date.now();
  if (!on && onAirSince) {
    const k = 'vm_onair_' + eventId;
    const t = JSON.parse(localStorage.getItem(k) || '{"ms":0,"times":0}');
    t.ms += Date.now() - onAirSince;
    t.times += 1;
    localStorage.setItem(k, JSON.stringify(t));
    onAirSince = null;
  }
  $('#camView').classList.toggle('onair', on);
  $('#tally').hidden = !on;
  if (on) announce('Your camera is on air');
  feedBtnUi();
}

// ----------------------------------------------------- camera-operator controls ----
// Lenses and zoom (rail, presets, pinch), tap to focus and expose, hold for AE/AF lock,
// exposure, torch, white balance, grid, level, zebras, a vertical microphone meter, the
// settings sheet, and full screen. Real camera features where the phone offers them,
// sensible digital stand-ins where it doesn't.

async function switchCamera(deviceId, wantFacing) {
  try {
    const vt = await kit.open({ deviceId, facing: wantFacing || kit.facing });
    video.srcObject = new MediaStream([vt]);
    await video.play().catch(() => {});
    if (stream) {
      stream.getVideoTracks().forEach((t) => stream.removeTrack(t));
      stream.addTrack(vt);
    }
    prefs.cams = { ...(prefs.cams || {}), [kit.facing === 'user' ? 'front' : 'back']: kit.deviceId };
    savePrefs();
    setZoom(1, true); // a new lens starts at 1×
    if (upright && !recorder) resizeUpright();
    // Mid-take: the old camera has stopped, so carry on in a new clip from the new one now.
    if (recorder && current?.native) {
      pendingRoll = null;
      rollRecording();
    }
    await renderZoomRail();
    applyViewfinderTransform();
    $('#torchBtn').hidden = !kit.can('torch');
    $('#torchBtn').setAttribute('aria-pressed', 'false');
    announce(`Camera: ${vt.label || 'switched'}`);
  } catch (e) {
    if (kit.restored && kit.track) {
      video.srcObject = new MediaStream([kit.track]);
      await video.play().catch(() => {});
    }
    toast(`Couldn't switch to that camera${e.name === 'NotReadableError' ? ' (another app may be using it)' : ''}: ${e.message}`, 5000);
  }
}

async function switchMic(deviceId) {
  try {
    await openMic(deviceId);
    prefs.micId = deviceId;
    savePrefs();
    announce(`Microphone: ${micTrack.label || 'switched'}`);
  } catch (e) {
    toast(`Couldn't switch microphone: ${e.message}`);
  }
}

/** Resize the upright square to suit a new camera resolution (only between takes). */
function resizeUpright() {
  const st = kit.track?.getSettings?.() || {};
  const big = Math.max(st.width || 0, st.height || 0) || 1280;
  const S = big >= 1280 ? 1080 : 720; // only the live view now, so it can be lighter
  if (S === upright.S) return;
  upright.S = S;
  upright.canvas.width = upright.canvas.height = S;
  upright.view = null; // re-announce the shape
}

// The viewfinder shows digital zoom too, and mirrors the front camera like every camera app.
// Digital brightness (when the camera has no exposure control of its own) and contrast: drawn
// into the live picture, shown on the viewfinder, and logged with native recordings so the
// edit shows them too (the recording itself stays as shot).
function lookFilter() {
  const f = [];
  if (kit.digitalEV) f.push(`brightness(${(2 ** (kit.digitalEV * 0.5)).toFixed(3)})`);
  if (Math.abs((kit.contrast || 1) - 1) > 0.005) f.push(`contrast(${kit.contrast.toFixed(3)})`);
  return f.join(' ');
}
// Can this browser filter a canvas (Chrome, Firefox)? Safari can't: it gets lookByBlending().
const CANVAS_FILTER = (() => {
  try {
    const g = document.createElement('canvas').getContext('2d');
    if (typeof g.filter !== 'string') return false;
    g.filter = 'brightness(2)';
    return g.filter === 'brightness(2)';
  } catch {
    return false;
  }
})();
/** Brightness (exact: add the picture to itself, or darken over it) and contrast (less: mix toward
 * middle grey, exact; more: overlay the picture on itself, close to a straight contrast) by blending. */
function lookByBlending(g, canvas, x, y, w, h) {
  const b = kit.digitalEV ? 2 ** (kit.digitalEV * 0.5) : 1, c = kit.contrast || 1;
  if (Math.abs(b - 1) < 0.005 && Math.abs(c - 1) < 0.005) return;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (b > 1.005) {
    g.globalCompositeOperation = 'lighter';
    for (let left = b - 1; left > 0.005; left -= 1) {
      g.globalAlpha = Math.min(1, left);
      g.drawImage(canvas, 0, 0);
    }
  } else if (b < 0.995) {
    g.globalAlpha = 1 - b;
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
  }
  g.globalCompositeOperation = 'source-over';
  if (c < 0.995) {
    g.globalAlpha = 1 - c;
    g.fillStyle = '#808080';
    g.fillRect(x, y, w, h);
  } else if (c > 1.005) {
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = Math.min(1, (c - 1) * 2); // (matched to a straight contrast: within a few levels across the range)
    g.drawImage(canvas, 0, 0);
  }
  g.restore();
}
function applyLook() {
  video.style.filter = lookFilter() || 'none';
}
function applyViewfinderTransform() {
  const z = kit.digitalZoom || 1;
  const mirror = kit.facing === 'user' ? ' scaleX(-1)' : '';
  const t = `scale(${z})${mirror}`;
  video.style.transform = t;
  $('#zebra').style.transform = t;
}

// ---- zoom rail ----
async function renderZoomRail() {
  const r = kit.zoomRange();
  const slider = $('#zoomSlider');
  slider.min = String(r.min);
  slider.max = String(r.max);
  slider.step = String(r.step);
  slider.value = String(kit.zoom);
  $('#zoomOut').textContent = `${kit.zoom.toFixed(1)}×`;
  const { cams } = await kit.devices();
  const back = cams.filter((c) => c.lens !== 'front');
  // every camera on this phone, for the director's Camera control (front last)
  const lensOrder = { ultra: 0, wide: 1, multi: 1, tele: 2, other: 3, front: 9 };
  lensChoices = cams
    .slice()
    .sort((a, b) => (lensOrder[a.lens] ?? 5) - (lensOrder[b.lens] ?? 5))
    .map((c) => ({ id: c.deviceId, label: c.lens === 'front' ? 'Front' : c.short || 'Camera', front: c.lens === 'front', kind: c.lens === 'multi' ? 'wide' : c.lens }));
  setTimeout(sendCamState);
  let chips;
  if (r.native && r.min < 1) {
    // one camera that zooms across its lenses (iPhone "triple camera"): presets are zoom levels
    const wide = r.min <= 0.55 ? 0.5 : Math.round(r.min * 10) / 10; // e.g. 0.6× on many Android phones
    chips = [wide, 1, 2, 3].filter((z, i, a) => z >= r.min - 0.001 && z <= r.max && a.indexOf(z) === i).map((z) => ({ zoom: z, label: `${z}×` }));
  } else if (kit.facing !== 'user' && back.filter((c) => c.lens !== 'multi').length > 1) {
    // separate lenses: presets switch cameras
    const order = { ultra: 0, wide: 1, tele: 2, other: 3 };
    chips = back.filter((c) => c.lens !== 'multi').sort((a, b) => (order[a.lens] ?? 4) - (order[b.lens] ?? 4)).map((c) => ({ deviceId: c.deviceId, label: c.short }));
  } else {
    chips = [1, 2, 3].filter((z) => z <= r.max).map((z) => ({ zoom: z, label: `${z}×` }));
  }
  $('#lenses').innerHTML = chips.map((c, i) => `<button type="button" data-i="${i}" aria-pressed="${c.deviceId ? c.deviceId === kit.deviceId : Math.abs(c.zoom - kit.zoom) < 0.05}" aria-label="${c.deviceId ? 'Lens ' + c.label : 'Zoom ' + c.label}">${c.label}</button>`).join('');
  $('#lenses').onclick = async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const c = chips[+b.dataset.i];
    if (c.deviceId) await switchCamera(c.deviceId);
    else await setZoom(c.zoom);
    renderZoomRail();
  };
}

// ---- smooth zoom ----
// Every zoom (the rail, a pinch, a lens chip, the director) sets a goal, and the picture glides
// there, eased every frame in equal steps of magnification, like a real zoom lens: never in
// notches. A native zoom is sent to the camera as fast as it takes it (one request at a
// time, always the latest); a digital zoom moves with every frame.
let zoomGoal = null, zoomNow = 1, zoomT = 0, zoomBusy = false, zoomWant = null;
function setZoom(z, instant = false) {
  const r = kit.zoomRange();
  const goal = Math.min(r.max, Math.max(r.min, +z || 1));
  if (instant) {
    zoomGoal = null;
    zoomNow = goal;
    return zoomStep(goal, true);
  }
  if (!zoomGlide.on) {
    zoomNow = kit.zoom || 1;
    zoomT = performance.now();
    zoomGlide.on = true;
    requestAnimationFrame(zoomGlide);
  }
  zoomGoal = goal;
}
function zoomGlide(t) {
  if (zoomGoal == null) return (zoomGlide.on = false);
  const dt = Math.min(0.1, Math.max(0, (t - zoomT) / 1000));
  zoomT = t;
  const lc = Math.log(zoomNow), lg = Math.log(zoomGoal);
  let next = Math.exp(lc + (lg - lc) * (1 - Math.exp(-dt / 0.16)));
  const done = Math.abs(lg - Math.log(next)) < 0.002;
  if (done) next = zoomGoal;
  zoomNow = next;
  zoomStep(next, done);
  if (done) {
    zoomGoal = null;
    zoomGlide.on = false;
  } else requestAnimationFrame(zoomGlide);
}
function zoomStep(z, final) {
  if (kit.zoomRange().native) {
    zoomWant = z;
    if (!zoomBusy) {
      zoomBusy = true;
      (async () => {
        while (zoomWant != null) {
          const v = zoomWant;
          zoomWant = null;
          await kit.setZoom(v).catch(() => {});
        }
        zoomBusy = false;
      })();
    }
  } else kit.setZoom(z).catch(() => {});
  zoomUi(z, final);
}
function zoomUi(z, final) {
  $('#zoomSlider').value = String(z);
  $('#zoomOut').textContent = `${z.toFixed(1)}×`;
  $('#zoomSlider').setAttribute('aria-valuetext', `${z.toFixed(1)} times`);
  $('#lenses').querySelectorAll('button').forEach((b) => {
    const t = parseFloat(b.textContent);
    if (!Number.isNaN(t) && b.textContent.includes('×') && !b.getAttribute('aria-label').startsWith('Lens')) b.setAttribute('aria-pressed', String(Math.abs(t - z) < 0.05));
  });
  applyViewfinderTransform();
  if (final) {
    clearTimeout(setZoom.t);
    setZoom.t = setTimeout(savePrefs, 400);
    sendCamState();
  }
}
// The rail's touch area is much wider than the slider you see: put a thumb anywhere along it
// and drag (up to zoom in). Double-tap it for 1×.
function setupZoomPad() {
  const pad = $('#zoomPad');
  let grab = null;
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    pad.setPointerCapture(e.pointerId);
    grab = { y: e.clientY, z: zoomGoal ?? kit.zoom ?? 1, h: Math.max(80, pad.getBoundingClientRect().height) };
    $('#zoomRail').classList.add('grabbed');
  });
  pad.addEventListener('pointermove', (e) => {
    if (!grab) return;
    e.stopPropagation();
    const r = kit.zoomRange();
    setZoom(grab.z * Math.exp(((grab.y - e.clientY) / grab.h) * Math.log(r.max / r.min)));
  });
  const release = (e) => {
    if (!grab) return;
    e.stopPropagation();
    grab = null;
    $('#zoomRail').classList.remove('grabbed');
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    setZoom(1);
  });
}

// ---- touch on the viewfinder: pinch to zoom, tap to focus, hold for AE/AF lock ----
function setupViewfinderTouch() {
  const view = $('#camView');
  const pts = new Map();
  let pinch = null, holdTimer = null, moved = false, downAt = null;
  const isControl = (el) => el.closest('button, input, select, .bar, .zoomrail, .vu, [role=button], dialog, a');
  view.addEventListener('pointerdown', (e) => {
    if (isControl(e.target) || role !== 'cam') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    downAt = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: kit.zoom };
      clearTimeout(holdTimer);
    } else {
      holdTimer = setTimeout(() => toggleLock(e.clientX, e.clientY), 700);
    }
  });
  view.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 10) {
      moved = true;
      clearTimeout(holdTimer);
    }
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    }
  });
  const end = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    clearTimeout(holdTimer);
    if (pinch) {
      if (pts.size < 2) pinch = null;
      return;
    }
    if (!moved && e.type === 'pointerup' && holdTimer !== 'held') focusTap(e.clientX, e.clientY);
    holdTimer = null;
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  async function toggleLock(x, y) {
    holdTimer = 'held';
    const on = !kit.locked;
    showFocusBox(x, y);
    const ok = await kit.setLock(on);
    sendCamState();
    if (!ok && on) return toast(`This ${DEVICE}'s camera doesn’t let the browser lock focus and exposure`);
    $('#aeLock').hidden = !kit.locked;
    announce(kit.locked ? 'Focus and exposure locked' : 'Focus and exposure unlocked');
  }
}

/** Where on the picture a screen point is (0..1), allowing for cover-fit, zoom and mirroring. */
function pictureAt(cx, cy) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  // The element is transformed (zoom, mirror) around its centre; undo that first.
  const z = kit.digitalZoom || 1;
  const mx = r.left + r.width / 2, my = r.top + r.height / 2;
  let x = (cx - mx) / z, y = (cy - my) / z;
  if (kit.facing === 'user') x = -x;
  const W = r.width / z, H = r.height / z;
  const k = Math.max(W / vw, H / vh); // object-fit: cover
  return { x: Math.min(1, Math.max(0, (x + (vw * k) / 2) / (vw * k))), y: Math.min(1, Math.max(0, (y + (vh * k) / 2) / (vh * k))) };
}

async function focusTap(x, y) {
  if (!$('#camView').classList.contains('on')) return;
  showFocusBox(x, y);
  const p = pictureAt(x, y);
  if (p) await kit.focusAt(p.x, p.y);
  if (kit.locked) {
    kit.locked = false;
    $('#aeLock').hidden = true;
  }
}

function showFocusBox(x, y) {
  const b = $('#focusBox');
  b.hidden = false;
  b.style.left = x + 'px';
  b.style.top = y + 'px';
  b.style.animation = 'none';
  void b.offsetWidth;
  b.style.animation = '';
  clearTimeout(showFocusBox.t);
  showFocusBox.t = setTimeout(() => (b.hidden = true), 1600);
}

// ---- overlays: grid, level, zebras ----
function setOverlay(name, on) {
  prefs[name] = on;
  savePrefs();
  $({ grid: '#grid3', level: '#levelLine', zebra: '#zebra' }[name]).hidden = !on;
}

(function levelLoop() {
  if (prefs.level && role === 'cam') {
    const raw = sensors.rawAngle();
    if (raw != null) {
      const dev = ((((raw - Math.round(raw / 90) * 90) % 360) + 540) % 360) - 180; // degrees off level
      const line = $('#levelLine');
      line.querySelector('i').style.transform = `rotate(${-dev}deg)`;
      line.classList.toggle('level', Math.abs(dev) < 1);
    }
  }
  setTimeout(levelLoop, 80);
})();

// Zebras: stripes over anything blown out (luma above ~95%), drawn over the viewfinder.
const zc = document.createElement('canvas');
const zg = zc.getContext('2d', { willReadFrequently: true });
(function zebraLoop() {
  const cv = $('#zebra');
  if (prefs.zebra && role === 'cam' && video.readyState >= 2 && !cv.hidden) {
    const r = video.getBoundingClientRect();
    const W = 96, H = Math.max(1, Math.round((96 * r.height) / r.width));
    zc.width = W;
    zc.height = H;
    const vw = video.videoWidth, vh = video.videoHeight;
    const k = Math.max(W / vw, H / vh);
    zg.drawImage(video, (W - vw * k) / 2, (H - vh * k) / 2, vw * k, vh * k);
    const d = zg.getImageData(0, 0, W, H).data;
    if (cv.width !== r.width || cv.height !== r.height) {
      cv.width = Math.round(r.width);
      cv.height = Math.round(r.height);
    }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const sx = cv.width / W, sy = cv.height / H;
    const phase = (performance.now() / 60) % 12;
    g.save();
    g.beginPath();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] > 242) g.rect(x * sx, y * sy, sx + 0.5, sy + 0.5);
      }
    }
    g.clip();
    g.strokeStyle = '#000000b0';
    g.lineWidth = 3;
    for (let k2 = -cv.height; k2 < cv.width + cv.height; k2 += 12) {
      g.beginPath();
      g.moveTo(k2 + phase, 0);
      g.lineTo(k2 + phase - cv.height, cv.height);
      g.stroke();
    }
    g.restore();
  }
  setTimeout(zebraLoop, 140);
})();

// ---- vertical microphone meter: -60 to 0 dB, peak hold, clip light ----
const vuHold = { v: 0, at: 0, clipAt: 0 };
(function vuLoop() {
  if (audio.meter && role === 'cam') {
    const buf = new Float32Array(audio.meter.fftSize);
    audio.meter.getFloatTimeDomainData(buf);
    let p = 0;
    for (const x of buf) p = Math.max(p, Math.abs(x));
    const db = p > 0 ? Math.max(-60, 20 * Math.log10(p)) : -60;
    const pct = ((db + 60) / 60) * 100;
    const t = performance.now();
    if (pct >= vuHold.v || t - vuHold.at > 1500) Object.assign(vuHold, { v: pct, at: t });
    if (p >= 0.99) vuHold.clipAt = t;
    const vu = $('#camVu');
    vu.querySelector('.fill').style.height = pct + '%';
    vu.querySelector('.peak').style.bottom = vuHold.v + '%';
    vu.querySelector('.clip').classList.toggle('on', t - vuHold.clipAt < 2000);
    $('#camVuDb').textContent = db <= -59 ? '-∞' : Math.round(db);
    vu.setAttribute('aria-valuenow', String(Math.round(db)));
  }
  requestAnimationFrame(vuLoop);
})();

// ---- settings sheet ----
async function openSettings() {
  const { cams, mics } = await kit.devices();
  $('#camSel').innerHTML = cams.map((c) => `<option value="${esc(c.deviceId)}" ${c.deviceId === kit.deviceId ? 'selected' : ''}>${esc(c.label)}${c.lens !== 'other' ? ` (${c.short})` : ''}</option>`).join('');
  const curMic = micTrack?.getSettings?.().deviceId;
  $('#micSel').innerHTML = mics.map((m) => `<option value="${esc(m.deviceId)}" ${m.deviceId === curMic ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
  $('#qualSel').innerHTML = Object.entries(QUALITY).map(([k, q]) => `<option value="${k}" ${k === kit.quality ? 'selected' : ''}>${q.label}</option>`).join('');
  $('#qualSel').disabled = !!recorder;
  $('#evSlider').value = String(kit.ev);
  $('#evOut').textContent = kit.ev.toFixed(1);
  $('#micGain').value = String(prefs.micGain || 0);
  $('#micGainOut').textContent = `${prefs.micGain || 0} dB`;
  ['grid', 'level', 'zebra'].forEach((n) => ($('#tg' + n[0].toUpperCase() + n.slice(1)).checked = !!prefs[n]));
  const wbModes = kit.caps().whiteBalanceMode || [];
  $('#wbWrap').hidden = !wbModes.includes('manual');
  $('#tgWb').checked = kit.wbLocked;
  const notes = [];
  if (!kit.zoomRange().native) notes.push(`Zoom is digital on this ${DEVICE} (it crops the picture).`);
  if (!kit.caps().exposureCompensation) notes.push('Exposure is adjusted digitally.');
  if (recorder) notes.push('Quality can change between takes.');
  $('#csNote').textContent = notes.join(' ');
  $('#camSettings').showModal();
}

function setupCameraControls() {
  if (!IS_PHONE) {
    $('#tgLevel').closest('label').hidden = true; // no gyro on a computer
    kit.devices().then(({ cams }) => ($('#flip').hidden = cams.length < 2));
    $('#flip').setAttribute('aria-label', 'Next camera');
  }
  setupViewfinderTouch();
  renderZoomRail();
  applyViewfinderTransform();
  $('#torchBtn').hidden = !kit.can('torch');
  ['grid', 'level', 'zebra'].forEach((n) => setOverlay(n, !!prefs[n]));
  $('#setBtn').onclick = openSettings;
  $('#csClose').onclick = () => $('#camSettings').close();
  $('#camSel').onchange = (e) => switchCamera(e.target.value);
  $('#micSel').onchange = (e) => switchMic(e.target.value);
  $('#qualSel').onchange = async (e) => {
    if (recorder) return toast('Change quality between takes');
    kit.quality = e.target.value;
    prefs.quality = kit.quality;
    savePrefs();
    await switchCamera(kit.deviceId);
    const st = kit.track.getSettings?.() || {};
    toast(`Camera now ${st.width || '?'}×${st.height || '?'} at ${Math.round(st.frameRate || 0) || '?'} fps`);
  };
  $('#evSlider').oninput = async (e) => {
    await kit.setExposure(+e.target.value).catch(() => {});
    prefs.ev = kit.ev;
    savePrefs();
    $('#evOut').textContent = kit.ev.toFixed(1);
    applyLook();
    sendCamState();
  };
  $('#tgRemote').checked = prefs.remoteCtl !== false;
  $('#camSettings').addEventListener('toggle', (e) => e.newState === 'open' && renderLensChoices($('#setLenses')));
  renderLensChoices($('#setLenses'));
  $('#tgRemote').onchange = (e) => {
    prefs.remoteCtl = e.target.checked;
    savePrefs();
    sendCamState();
  };
  $('#micGain').oninput = (e) => {
    prefs.micGain = +e.target.value;
    savePrefs();
    $('#micGainOut').textContent = `${prefs.micGain} dB`;
    if (audio.gain) audio.gain.gain.setTargetAtTime(10 ** (prefs.micGain / 20), audio.ctx.currentTime, 0.02);
  };
  $('#tgGrid').onchange = (e) => setOverlay('grid', e.target.checked);
  $('#tgLevel').onchange = (e) => setOverlay('level', e.target.checked);
  $('#tgZebra').onchange = (e) => setOverlay('zebra', e.target.checked);
  $('#tgWb').onchange = async (e) => {
    if (!(await kit.setWhiteBalanceLock(e.target.checked))) e.target.checked = false;
    wbLocked = e.target.checked;
    sendCamState();
  };
  $('#zoomSlider').oninput = (e) => setZoom(+e.target.value);
  setupZoomPad();
  $('#torchBtn').onclick = async () => {
    const on = $('#torchBtn').getAttribute('aria-pressed') !== 'true';
    if (await kit.setTorch(on).catch(() => false)) $('#torchBtn').setAttribute('aria-pressed', String(on));
  };
  document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fs', !!document.fullscreenElement || document.body.classList.contains('immersive')));
}

// Full screen: Android and iPad can; iPhone browsers can't, so offer the home-screen app.
async function toggleCamFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    document.body.classList.remove('fs', 'immersive');
    return;
  }
  try {
    if (!req) throw new Error('unsupported');
    await req.call(el, { navigationUI: 'hide' });
    document.body.classList.add('fs');
  } catch {
    document.body.classList.toggle('immersive');
    document.body.classList.toggle('fs', document.body.classList.contains('immersive'));
    if (document.body.classList.contains('immersive')) toast('For true full screen on iPhone: Share → Add to Home Screen, then open VUEMesh from there', 6000);
  }
}

// ------------------------------------------------------------- my footage ----
// Everything this device shot, at this event and others: watch it, see whether the host
// got it, send it again, save it, delete it. Plus the director's messages, the rundown,
// and time on air. Clips are kept after delivery unless the person turns that off.

const keepCopies = () => prefs.keepCopies !== false;
const attempts = new Map();
const libUrls = new Map();
let libEvent = eventId;

function clipFailed(clip, error) {
  const n = (attempts.get(clip.id) || 0) + 1;
  attempts.set(clip.id, n);
  idb.patch('outbox', eventId, clip.id, { status: 'failed', error, attempts: n }).catch(() => {});
  outbox.delete(clip.id);
  renderOutbox();
  renderLibrary();
  toast(`A clip didn't reach the host (${error}).${n < 3 ? ' Trying again shortly.' : ''} You can resend it from My events.`, 6000);
  // A few automatic retries, further apart each time; after that it's the person's call.
  if (n < 3) setTimeout(async () => {
    const rec = (await idb.list('outbox', eventId)).find((r) => r.id === clip.id);
    if (rec && rec.status === 'failed') retryClip(rec, true);
  }, 20000 * n);
}

/** Put a clip back in line for the host (failed, or delivered but wanted again). */
async function retryClip(rec, automatic = false) {
  if (rec.eventId !== eventId || !link || link.left) return toast('Join that event to send its clips');
  await idb.patch('outbox', eventId, rec.id, { status: 'waiting', error: null }).catch(() => {});
  const clip = { id: rec.id, blob: rec.blob, meta: rec.meta, sent: 0 };
  outbox.set(clip.id, clip);
  link.enqueue(clip);
  renderOutbox();
  renderLibrary();
  if (!automatic) toast('Sending again');
}

// My media is everything recorded on this device: this camera's clips (and its parts of live
// cuts), and the recordings a studio on this device made or received (each camera's, the
// program as aired). Media files dropped into the studio aren't recordings: they stay there.
async function libRecords(evId) {
  const [mine, studio] = await Promise.all([idb.listAll('outbox').catch(() => []), idb.listAll('clips').catch(() => [])]);
  const fromStudio = studio.filter((c) => c.blob && !c.reel).map((c) => ({
    id: c.id, eventId: c.eventId, blob: c.blob, status: 'studio', name: c.name, program: !!c.program,
    createdAt: c.t0 || c.at || 0, meta: { t0: c.t0, dur: c.dur, kind: c.kind === 'audio' ? 'audio' : 'video' },
  }));
  const all = [...mine, ...fromStudio];
  return evId ? all.filter((r) => r.eventId === evId) : all;
}
/** A studio recording deleted here: gone from storage, from the studio's editor if it's open, and from its saved timeline. */
async function deleteStudioRecording(r) {
  await idb.remove('clips', r.eventId, r.id).catch(() => {});
  try {
    const ch = new BroadcastChannel('vuemesh-monitor-' + r.eventId);
    ch.postMessage({ type: 'delete', id: r.id });
    setTimeout(() => ch.close(), 500);
  } catch {}
  const key = 'vm_seq_' + r.eventId, seq = JSON.parse(localStorage.getItem(key) || 'null');
  if (seq?.tracks) {
    for (const t of seq.tracks) t.items = (t.items || []).filter((i) => i.src !== r.id);
    localStorage.setItem(key, JSON.stringify(seq));
  }
}

function eventTitle(id) {
  if (id === SOLO_ID) return 'On my own';
  return (id === eventId && ev?.title) || myEvents().find((e) => e.id === id)?.title || `Event ${id}`;
}

async function openLibrary(evId = libEvent) {
  const all = await libRecords();
  // no event open (the room-code screen): start on the most recent event with footage
  libEvent = evId || all.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0]?.eventId || myEvents().find((e) => e.role === 'guest')?.id || null;
  const ids = [...new Set([eventId, ...all.map((r) => r.eventId), ...myEvents().filter((e) => e.role === 'guest').map((e) => e.id)])].filter(Boolean); // (studio shows with recordings come in through all)
  const when = (id) => myEvents().find((e) => e.id === id)?.createdAt || myEvents().find((e) => e.id === id)?.at || 0;
  $('#libEvent').innerHTML = ids.sort((a, b) => (a === SOLO_ID) - (b === SOLO_ID) || when(b) - when(a)).map((id) => `<option value="${id}" ${id === libEvent ? 'selected' : ''}>${esc(eventLabel(id))}</option>`).join('');
  $('#keepCopies').checked = keepCopies();
  $('#library').hidden = false;
  $('#linkSheet').open && $('#linkSheet').close();
  await renderLibrary();
  $('#libClose').focus();
}
document.querySelectorAll('.openLib').forEach((b) => b.addEventListener('click', () => openLibrary(eventId)));
// Straight from the home page, no event needed: ?go=solo is the camera on your own (it starts
// at once if the browser already allows the camera, else one tap); ?go=media is My media.
{
  const go = new URLSearchParams(location.search).get('go');
  if (!eventId && go === 'media') setTimeout(() => openLibrary(), 0);
  if (!eventId && go === 'solo') {
    setTimeout(async () => {
      const cam = await navigator.permissions?.query({ name: 'camera' }).then((p) => p.state).catch(() => null);
      if (cam === 'granted') return startSolo();
      const b = $('#soloBtn');
      b.classList.add('primary', 'callout');
      b.textContent = 'Start the camera';
      b.scrollIntoView({ block: 'center' });
      b.focus();
    }, 0);
  }
}
$('#libClose').onclick = () => {
  closePlayer();
  $('#library').hidden = true;
};
$('#libEvent').onchange = (e) => {
  libEvent = e.target.value;
  renderLibrary();
};
$('#keepCopies').onchange = (e) => {
  prefs.keepCopies = e.target.checked;
  savePrefs();
};
for (const [tab, panel] of [['#tabClips', '#libClips'], ['#tabShow', '#libShow']]) {
  $(tab).onclick = () => {
    $('#tabClips').setAttribute('aria-selected', String(tab === '#tabClips'));
    $('#tabShow').setAttribute('aria-selected', String(tab === '#tabShow'));
    $('#libClips').hidden = tab !== '#tabClips';
    $('#libShow').hidden = tab !== '#tabShow';
  };
}

const sizeOf = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1048576)) + ' MB');
function statusOf(r) {
  if (r.status === 'studio') return ['ok', r.program ? 'The program as aired, in the studio on this device' : 'In the studio on this device'];
  const p = outbox.get(r.id);
  if (r.status === 'delivered') return ['ok', '✓ Delivered'];
  if (r.status === 'saved') return ['ok', uploadsOff() && r.eventId === eventId ? `Kept on this ${DEVICE} (this show keeps clips on the phones)` : `Saved on this ${DEVICE}`];
  if (r.status === 'received' && r.meta?.playable === false) return ['bad', "Can't play on this phone"];
  if (r.status === 'received') return ['ok', 'From the director'];
  if (r.status === 'failed') return ['bad', `Didn't arrive: ${r.error || 'unknown'}`];
  if (p && p.sent > 0 && link?.sending) return ['send', `Sending ${Math.round((p.sent / r.blob.size) * 100)}%`];
  return ['wait', r.eventId === eventId && LIVE.includes(linkState) ? 'Waiting to send' : 'Waiting for the host'];
}

async function renderLibrary() {
  if ($('#library').hidden) return;
  eventTotals().then((t) => ($('#libTotals').textContent = `${t.text} on this ${DEVICE}`));
  $('#delEvent').textContent = `Delete this event from this ${DEVICE}`;
  const recs = (await libRecords(libEvent)).sort((a, b) => (a.meta?.t0 || a.createdAt || 0) - (b.meta?.t0 || b.createdAt || 0));
  const here = libEvent === eventId && link && !link.left;
  const delivered = recs.filter((r) => r.status === 'delivered').length;
  const bytes = recs.reduce((n, r) => n + (r.blob?.size || 0), 0);
  $('#libSummary').textContent = recs.length
    ? `${recs.length} clip${recs.length > 1 ? 's' : ''} on this ${DEVICE} · ${delivered} delivered · ${sizeOf(bytes)}`
    : `No clips from this event on this ${DEVICE}.`;
  $('#delDelivered').hidden = !delivered;
  $('#libList').innerHTML = recs.map((r, i) => {
    const [cls, label] = statusOf(r);
    const when = new Date(r.meta?.t0 || r.createdAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const kind = r.meta?.kind === 'audio' ? 'Sound' : r.meta?.kind === 'program' ? 'Live cut' : 'Clip';
    const title = r.status === 'studio' ? (r.program ? 'Program (as aired)' : `${r.name || 'Camera'} · ${kind === 'Sound' ? 'sound' : 'camera'}`) : r.meta?.kind === 'program' ? `Live cut · part ${r.meta.part}` : `${kind} ${i + 1}`;
    return `<li data-clip="${r.id}">
      <button type="button" class="thumb" data-act="play" aria-label="Play ${esc(title)}" data-thumb="${r.id}"></button>
      <div class="info"><b>${esc(title)} · ${when}</b><small>${r.meta?.dur ? fmtDur(r.meta.dur).slice(0, -3) + ' · ' : ''}${sizeOf(r.blob?.size || 0)}</small><br><span class="st ${cls}">${esc(label)}</span>${r.meta?.playable === false ? `<span class="why">Made as ${esc(r.meta.codecs || 'a format')} by the studio's browser. Save it and watch on a computer, or ask the director to run the studio in Chrome on a Mac or Windows PC.</span>` : ''}</div>
      <div class="acts">
        ${r.eventId === SOLO_ID || r.status === 'received' || r.status === 'studio' ? '' : `<button type="button" data-act="send" ${here ? '' : 'disabled title="Join this event to send"'}>${r.status === 'delivered' ? 'Send again' : r.status === 'failed' ? 'Retry' : 'Send now'}</button>`}
        <button type="button" data-act="save">Save</button>
        <button type="button" data-act="delete" class="danger">Delete</button>
      </div></li>`;
  }).join('');
  for (const r of recs) thumbFor(r);
  // the Show tab
  const msgsHere = JSON.parse(localStorage.getItem('vm_msgs_' + libEvent) || '[]');
  const rd = JSON.parse(localStorage.getItem('vm_rundown_' + libEvent) || 'null');
  const onair = JSON.parse(localStorage.getItem('vm_onair_' + libEvent) || '{"ms":0,"times":0}');
  const extra = libEvent === eventId && onAirSince ? Date.now() - onAirSince : 0;
  const shot = recs.reduce((n, r) => n + (r.meta?.dur || 0), 0);
  $('#showStats').innerHTML = [
    [recs.length, recs.length === 1 ? 'clip' : 'clips'], [fmtDur(shot).slice(0, -3), 'recorded'], [fmtDur(onair.ms + extra).slice(0, -3), `on air (${onair.times + (extra ? 1 : 0)}×)`], [msgsHere.length, msgsHere.length === 1 ? 'message' : 'messages'],
  ].map(([v, k]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('#libMsgs').innerHTML = msgsHere.length
    ? msgsHere.map((m) => `<li><time>${new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${m.all ? ' · to everyone' : ''}</time>${esc(m.text)}${m.reply ? `<em>You: ${esc(m.reply)}</em>` : ''}</li>`).join('')
    : '<li>No messages.</li>';
  $('#libRundown').innerHTML = rd?.items?.length ? rd.items.map((x, i) => `<li class="${rd.ended || i < rd.cue ? 'done' : i === rd.cue ? 'now' : ''}">${esc(x)}</li>`).join('') : '<li>No rundown.</li>';
}

const thumbs2 = new Map();
function thumbFor(r) {
  const el = document.querySelector(`[data-thumb="${r.id}"]`);
  if (!el || r.meta?.kind === 'audio') return;
  if (thumbs2.has(r.id)) return (el.style.backgroundImage = `url(${thumbs2.get(r.id)})`);
  const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', src: urlOf(r) });
  v.addEventListener('loadeddata', () => (v.currentTime = Math.min(0.5, (v.duration || 1) / 2)), { once: true });
  v.addEventListener('seeked', () => {
    const c = document.createElement('canvas');
    c.width = 224;
    c.height = 126;
    const g = c.getContext('2d');
    const e0 = r.meta?.orient?.[0];
    const rect = e0?.rect, rot = e0?.rot || 0;
    const vw = v.videoWidth, vh = v.videoHeight;
    const sx = rect ? rect.x * vw : 0, sy = rect ? rect.y * vh : 0, sw = rect ? rect.w * vw : vw, sh = rect ? rect.h * vh : vh;
    const turned = rot % 180 !== 0;
    const k = Math.max(224 / (turned ? sh : sw), 126 / (turned ? sw : sh));
    g.translate(112, 63);
    g.rotate((rot * Math.PI) / 180);
    g.drawImage(v, sx, sy, sw, sh, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
    thumbs2.set(r.id, c.toDataURL('image/jpeg', 0.7));
    const now = document.querySelector(`[data-thumb="${r.id}"]`);
    if (now) now.style.backgroundImage = `url(${thumbs2.get(r.id)})`;
    v.removeAttribute('src');
    v.load();
  }, { once: true });
}

function urlOf(r) {
  if (!libUrls.has(r.id)) libUrls.set(r.id, URL.createObjectURL(r.blob));
  return libUrls.get(r.id);
}

$('#libList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('[data-clip]').dataset.clip;
  const r = (await libRecords(libEvent)).find((x) => x.id === id);
  if (!r) return;
  const act = b.dataset.act;
  if (act === 'play') return openPlayer(r);
  if (act === 'send') return retryClip(r);
  if (act === 'save') return saveClip(r);
  if (act === 'delete' && r.status === 'studio') {
    if (!confirm(`Delete this recording from this ${DEVICE}? It goes from the studio's editor too, everywhere it's used. This can't be undone.`)) return;
    await deleteStudioRecording(r);
    URL.revokeObjectURL(libUrls.get(r.id));
    libUrls.delete(r.id);
    renderLibrary();
    return toast('Deleted');
  }
  if (act === 'delete') {
    if (r.status === 'received' && !confirm(`Delete this part of the live cut from this ${DEVICE}?`)) return;
    if (r.status !== 'delivered' && r.status !== 'received' && !confirm(`This clip hasn't reached the host yet. Delete it from this ${DEVICE} anyway? It can't be recovered.`)) return;
    if (r.status === 'delivered' && !confirm(`Delete this clip from this ${DEVICE}? The host already has it.`)) return;
    await idb.remove('outbox', r.eventId, r.id);
    outbox.delete(r.id);
    link?.dequeue(r.id);
    URL.revokeObjectURL(libUrls.get(r.id));
    libUrls.delete(r.id);
    renderOutbox();
    renderLibrary();
    toast('Deleted');
  }
});

// Delete a whole event from this device: its clips, the live cut, messages, rundown and the
// rest, so old events don't sit in storage (and in the list) for good.
$('#delEvent').onclick = async () => {
  const id = libEvent;
  if (!id) return;
  if (id === eventId && link && !link.left) return toast('Leave the event first, then delete it here.', 5000);
  const title = eventTitle(id);
  const recs = await libRecords(id);
  const unsent = recs.filter((r) => id !== SOLO_ID && !['delivered', 'received', 'saved'].includes(r.status)).length;
  const bytes = recs.reduce((n, r) => n + (r.blob?.size || 0), 0);
  if (!confirm(`Delete "${title}" from this ${DEVICE}? That's ${recs.length} item${recs.length === 1 ? '' : 's'} (${sizeOf(bytes)}), the messages and the rundown.${unsent ? ` ${unsent} clip${unsent > 1 ? "s haven't" : " hasn't"} reached the host yet and will be lost.` : ''}`)) return;
  deletedEvents.add(id); // (a clip still being finished from it isn't saved afterwards)
  for (const r of recs) await idb.remove('outbox', r.eventId, r.id).catch(() => {});
  for (const k of ['vm_msgs_', 'vm_rundown_', 'vm_onair_', 'vm_joined_']) localStorage.removeItem(k + id);
  sessionStorage.removeItem('vm_off_' + id);
  localStorage.setItem('vm_events', JSON.stringify(JSON.parse(localStorage.getItem('vm_events') || '[]').filter((e) => e.id !== id)));
  if (JSON.parse(localStorage.getItem('vm_last') || 'null')?.id === id) {
    localStorage.removeItem('vm_last');
    if (linkState === 'left' || !eventId) $('#rejoinCard').hidden = true;
  }
  toast(`Deleted ${title}`);
  announce(`Deleted ${title}`);
  refreshLibButtons();
  const rest = await libRecords();
  if (!rest.length && !myEvents().some((e) => e.role === 'guest')) {
    $('#library').hidden = true;
    return;
  }
  openLibrary(null);
};
$('#delDelivered').onclick = async () => {
  const recs = (await libRecords(libEvent)).filter((r) => r.status === 'delivered');
  if (!recs.length || !confirm(`Delete ${recs.length} delivered clip${recs.length > 1 ? 's' : ''} from this ${DEVICE}? The host already has them.`)) return;
  for (const r of recs) await idb.remove('outbox', r.eventId, r.id);
  renderLibrary();
  toast(`Deleted ${recs.length} clip${recs.length > 1 ? 's' : ''}`);
};

async function saveClip(r) {
  const ext = r.blob.type.includes('webm') ? 'webm' : r.blob.type.startsWith('audio/') ? 'm4a' : 'mp4';
  const name = `vuemesh-${r.eventId}-${r.id}.${ext}`;
  // Native recordings made with the phone turned (rotation lock on) get their turn written
  // into the file, so Photos shows them upright.
  const turn = r.meta?.native ? r.meta.orient?.[0]?.rot || 0 : 0;
  const blob = turn && ext === 'mp4' ? await withRotation(r.blob, turn).catch(() => r.blob) : r.blob;
  const file = new File([blob], name, { type: r.blob.type || 'video/mp4' });
  // On phones, the share sheet saves straight to Photos or Files.
  if (IS_PHONE && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: eventTitle(r.eventId) });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = blob === r.blob ? urlOf(r) : URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

// ---- the player shows just the shot (the recording is a square with the shot inside) ----
let playing = null;
function openPlayer(r) {
  playing = r;
  const v = $('#playVideo');
  $('#playErr').hidden = true;
  v.onerror = () => {
    const what = r.meta?.codecs ? ` It's ${r.meta.codecs}.` : '';
    $('#playErr').textContent = `This phone can't play this file.${what} Use Save to keep it and watch it on a computer.`;
    $('#playErr').hidden = false;
    diag('error', `Player couldn't play ${r.id} (${r.blob?.type || '?'}, ${Math.round((r.blob?.size || 0) / 1048576)} MB): ${v.error?.message || v.error?.code || 'unsupported'}`);
  };
  v.src = urlOf(r);
  $('#playInfo').textContent = `${eventTitle(r.eventId)} · ${new Date(r.meta?.t0 || r.createdAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  $('#player').hidden = false;
  v.play().catch(() => {});
  $('#playClose').focus();
}
function closePlayer() {
  const v = $('#playVideo');
  v.pause();
  v.removeAttribute('src');
  v.load();
  $('#player').hidden = true;
  playing = null;
}
$('#playClose').onclick = closePlayer;
function fitPlayer() {
  const v = $('#playVideo'), box = $('#playBox');
  if (!playing || !v.videoWidth) return;
  const log = playing.meta?.orient || [];
  let e = log[0];
  for (const x of log) if (x.t <= v.currentTime + 0.05) e = x;
  const r = e?.rect || { x: 0, y: 0, w: 1, h: 1 };
  const rot = e?.rot || 0;
  const BW = box.clientWidth, BH = box.clientHeight;
  // show just the shot (cropping any square or digital zoom), turned upright, letterboxed
  const sw = r.w * v.videoWidth, sh = r.h * v.videoHeight, turned = rot % 180 !== 0;
  const k = Math.min(BW / (turned ? sh : sw), BH / (turned ? sw : sh));
  const W = v.videoWidth * k, H = v.videoHeight * k;
  const cx = (r.x + r.w / 2) * W, cy = (r.y + r.h / 2) * H;
  Object.assign(v.style, {
    width: W + 'px', height: H + 'px', left: BW / 2 - cx + 'px', top: BH / 2 - cy + 'px',
    transformOrigin: `${cx}px ${cy}px`, transform: rot ? `rotate(${rot}deg)` : 'none',
    clipPath: `inset(${r.y * H}px ${(1 - r.x - r.w) * W}px ${(1 - r.y - r.h) * H}px ${r.x * W}px)`,
  });
}
['loadedmetadata', 'timeupdate', 'seeked'].forEach((ev2) => $('#playVideo').addEventListener(ev2, fitPlayer));
window.addEventListener('resize', fitPlayer);

// The join screen and the home offer My events when this device has some.
async function eventTotals() {
  const all = await libRecords();
  const events = new Set(all.map((r) => r.eventId)).size;
  const clipsN = all.filter((r) => r.meta?.kind !== 'program').length;
  return { all, events, clipsN, text: `${events} event${events === 1 ? '' : 's'} · ${clipsN} clip${clipsN === 1 ? '' : 's'}` };
}
async function refreshLibButtons() {
  const t = await eventTotals();
  for (const b of [$('#joinLib'), $('#codeLib')]) {
    if (!b) continue;
    b.hidden = !t.all.length;
    b.textContent = `My events (${t.text})`;
  }
}
refreshLibButtons();
// Opened from the home page: go straight to it.
if (location.hash === '#footage') setTimeout(() => openLibrary(eventId), 300);
// Keep statuses current without rebuilding the list (so a tap never lands on a replaced row).
setInterval(async () => {
  if ($('#library').hidden) return;
  const recs = await libRecords(libEvent);
  if (recs.length !== $('#libList').children.length) return renderLibrary();
  for (const r of recs) {
    const st = document.querySelector(`[data-clip="${r.id}"] .st`);
    if (!st) continue;
    const [cls, label] = statusOf(r);
    st.className = 'st ' + cls;
    st.textContent = label;
    const send = document.querySelector(`[data-clip="${r.id}"] [data-act="send"]`);
    if (send) send.textContent = r.status === 'delivered' ? 'Send again' : r.status === 'failed' ? 'Retry' : 'Send now';
    // (clips shot on your own have no Send button)
  }
}, 1000);

// ---------------------------------------------------- scan the beacon to join ----
// The beacon's code is a join link (…/cam?e=CODE#t=…), so pointing at it is all it takes.
let scanStream = null;
function codeFromScan(text) {
  if (!text) return null;
  try {
    const e = new URL(text, location.origin).searchParams.get('e');
    if (e && /^[A-Z0-9]{4,8}$/i.test(e)) return e.toUpperCase();
  } catch {}
  return /^[A-Z0-9]{6}$/i.test(text.trim()) ? text.trim().toUpperCase() : null;
}
async function scanToJoin() {
  $('#scanJoin').hidden = false;
  $('#scanMsg').textContent = 'Looking for its code…';
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    $('#scanMsg').textContent = e.name === 'NotAllowedError' ? 'Allow the camera to scan the code, or type it instead.' : `Couldn't open the camera: ${e.message}`;
    return;
  }
  const v = $('#scanVideo');
  v.srcObject = scanStream;
  await v.play().catch(() => {});
  const c = document.createElement('canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if ($('#scanJoin').hidden || !scanStream) return;
    if (v.videoWidth) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      g.drawImage(v, 0, 0);
      const code = codeFromScan(await decodeQR(c).catch(() => null));
      if (code) {
        $('#scanMsg').textContent = `Found ${code}. Joining…`;
        navigator.vibrate?.(30);
        stopScanJoin();
        joinInPlace(code);
        return;
      }
    }
    setTimeout(tick, 200);
  };
  tick();
}
// Join the scanned event on this same page. A new page would mean the iPhone asking for the
// camera a second time; staying here, the camera this page already has is enough.
async function joinInPlace(code) {
  history.replaceState(null, '', `/cam?e=${code}`);
  eventId = code;
  msgs.splice(0, msgs.length, ...JSON.parse(localStorage.getItem('vm_msgs_' + code) || '[]'));
  rundown = JSON.parse(localStorage.getItem('vm_rundown_' + code) || 'null');
  $('#scanJoin').hidden = true;
  $('#codeView').hidden = true;
  try {
    await boot();
  } catch (e) {
    $('#codeView').hidden = false;
    toast(e.message, 5000);
  }
}
function stopScanJoin() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
}
$('#scanClose').onclick = () => {
  stopScanJoin();
  $('#scanJoin').hidden = true;
  $('#scanJoinBtn').focus();
};

// ------------------------------------------------------- the camera on its own ----
// The same camera app, with no event: every control works, and clips are saved to
// My events ("On my own"). People get used to it before they shoot at an event.
async function startSolo() {
  const btn = $('#soloBtn');
  btn.disabled = true;
  const motionAsk = Sensors.requestPermission(); // iPhones only allow this inside the tap
  makeAudio();
  try {
    eventId = SOLO_ID;
    ev = { id: SOLO_ID, title: 'On my own', orientation: null, termsHash: 'solo', solo: true };
    ident = await identity();
    ident.cid = await thumbprintOf(ident.jwk);
    me = { contributorId: ident.cid, name: localStorage.getItem('vm_name') || 'Me', termsHash: 'solo', joinSig: null };
    role = 'cam';
    document.title = 'Camera — VUEMesh';
    $('#camTitleText').textContent = 'On my own';
    await openCamera();
    await motionAsk.catch(() => false);
    sensors.start();
    audio.ctx?.resume();
    makeUpright();
    setupCameraControls();
    $('#codeView').hidden = true;
    $('#camView').classList.add('on');
    keepAwake();
    $('#syncPill').hidden = true;
    // the event menu: no live switch or leaving; My events and joining an event instead
    $('#liveSwitch').closest('.switchrow').hidden = true;
    $('#lsTitle').textContent = 'On my own';
    $('#leaveBtn').textContent = 'Join an event';
    $('#leaveBtn').classList.remove('danger');
    $('#leaveBtn').onclick = () => {
      if (recorder && !confirm('Stop recording? Your clip is saved to My events.')) return;
      if (recorder) stopRecording();
      location.href = '/cam';
    };
    linkState = 'solo';
    renderOutbox();
    announce('Camera on your own. Clips are saved to My events.');
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Allow camera and microphone access to shoot' : e.message, 5000);
    btn.disabled = false;
  }
}

// ---- can this device play a file? (load it and see) ----
function canPlay(blob) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    const url = URL.createObjectURL(blob);
    const done = (ok) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(ok); };
    const timer = setTimeout(() => done(v.readyState >= 1), 8000);
    v.onloadeddata = () => done(true);
    v.onerror = () => done(false);
    v.src = url;
  });
}

// ---- diagnostics for this phone ----
async function camDiagSections() {
  const recs = await idb.listAll('outbox').catch(() => []);
  const s = kit.track?.getSettings?.() || {};
  return [
    ['This phone', [
      `${DEVICE} · ${role || 'not joined'} · event ${eventId || '—'} "${ev?.title || ''}"${ev?.solo ? ' (on my own)' : ''}`,
      `Link: ${linkState}${paused ? ' (paused)' : ''} · recording ${recorder ? 'yes' : 'no'}`,
      `Camera: ${kit.track?.label || '—'} ${s.width ? `${s.width}×${s.height} @${Math.round(s.frameRate || 0)}fps` : ''} · quality ${kit.quality} · zoom ${kit.zoom ?? 1}`,
      `Motion sensors: ${sensors.hasMotion ? 'yes' : 'no'} · wake lock ${lock ? 'held' : 'no'}`,
    ]],
    ['Recordings on this device (newest first)', recs.length ? recs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 25).map((r) =>
      `${r.meta?.kind === 'program' ? `live cut part ${r.meta.part}` : r.meta?.kind || 'clip'} ${r.id} · event ${r.eventId} · ${r.status || 'waiting'}${r.error ? ` (${r.error})` : ''} · ${Math.round((r.blob?.size || 0) / 1048576)} MB · ${r.blob?.type || '?'}${r.meta?.codecs ? ` · ${r.meta.codecs}` : ''}${r.meta?.playable === false ? ' · NOT PLAYABLE HERE' : ''}`) : ['none']],
  ];
}
const openCamDiag = diagnosticsDialog(camDiagSections);
document.querySelectorAll('.diagOpen').forEach((b) => b.addEventListener('click', () => {
  $('#linkSheet').open && $('#linkSheet').close();
  openCamDiag();
}));
