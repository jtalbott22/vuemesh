// The phone remote: pairs with the studio using the one-time code it shows (from its QR, or typed),
// then shows what's on air and the cameras, and sends the studio commands with this phone's own
// session key (kept on this phone for this show, so it carries on after a reload). The studio
// checks every command; see remote-host.js.
import { meshSocket } from '/js/vm.js';

const $ = (s) => document.querySelector(s);
const q = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
let eventId = (q.get('e') || '').toUpperCase();
let code = (hash.get('p') || '').toUpperCase();
if (hash.has('p')) history.replaceState(null, '', location.pathname + location.search); // (the code doesn't stay in the address)
const keyStore = (id) => `vm_remote_${id}`;
let key = eventId ? localStorage.getItem(keyStore(eventId)) : null;
let sock = null, host = null, state = null, recSince = null, wanted = null, wake = null, lastState = 0;
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
const send = (data) => host && sock?.signal(host, { remote: data });

function connect() {
  if (sock) return;
  sock = meshSocket({
    eventId,
    role: 'remote',
    name: ($('#name').value || 'Phone remote').slice(0, 40),
    onPeers: (peers) => {
      const h = peers.find((p) => p.role === 'host')?.peer || null;
      $('#conn').className = 'dot' + (h ? ' on' : '');
      $('#conn').setAttribute('aria-label', h ? 'Connected to the studio' : 'The studio is not open');
      if (h !== host) {
        host = h;
        if (!host) {
          $('#onAir').textContent = 'Waiting for the studio…';
          return;
        }
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
  if (m.t === 'paired') {
    key = m.key;
    localStorage.setItem(keyStore(eventId), key);
    localStorage.setItem('vm_remote_name', m.name || '');
    wanted = null;
    showControls();
    toast('This phone is now a remote for the show');
  } else if (m.t === 'denied') {
    wanted = null;
    say(m.why || "The studio didn't accept that code", true);
    $('#pairBtn').disabled = false;
  } else if (m.t === 'removed') {
    key = null;
    localStorage.removeItem(keyStore(eventId));
    showPairing();
    say('This phone was removed as a remote in the studio. Add it again there to carry on.', true);
  } else if (m.t === 'state') {
    lastState = Date.now();
    if (m.s.rec && !state?.rec) recSince = Date.now();
    if (!m.s.rec) recSince = null;
    state = m.s;
    render();
  } else if (m.t === 'thumb') {
    thumbs.set(m.peer, m.src);
    const img = document.querySelector(`.cam[data-peer="${CSS.escape(m.peer)}"] img`);
    if (img) img.src = m.src;
    else render();
  } else if (m.t === 'done' && !m.ok) {
    toast(m.why || "The studio couldn't do that");
  }
}

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
function render() {
  if (!state) return;
  $('#title').textContent = state.title || 'Remote';
  const air = state.cams.find((c) => c.onAir), snd = (state.sound || []).find((s) => s.onAir);
  const what = state.black ? 'Black' : state.brk ? 'On a break' : state.media ? `On air · ${state.media}` : air ? `On air · ${air.name}` : snd ? `On air · ${snd.name} · sound only` : 'Nothing on air';
  $('#onAir').textContent = what;
  $('#status').className = 'status' + (!state.black && !state.brk && (air || snd || state.media) ? ' air' : '');
  $('#cams').innerHTML = state.cams.map((c) => {
    const src = thumbs.get(c.peer);
    return `<button type="button" class="cam${c.onAir ? ' air' : c.preview ? ' pvw' : ''}" data-peer="${esc(c.peer)}" aria-label="Cut to ${esc(c.name)}${c.onAir ? ' (on air)' : ''}">
      ${src ? `<img alt="" src="${src}">` : '<span class="nopic">picture in a moment</span>'}
      ${c.onAir ? '<span class="tag">ON AIR</span>' : ''}${c.rec ? '<span class="rdot" title="Recording"></span>' : ''}<b>${esc(c.name)}</b></button>`;
  }).join('');
  $('#noCams').hidden = state.cams.length > 0;
  // sound-only sources: cut to one and the program shows its sound picture
  const sound = state.sound || [];
  $('#soundH').hidden = $('#sound').hidden = !sound.length;
  $('#sound').innerHTML = sound.map((s) => `<button type="button" class="cam${s.onAir ? ' air' : ''}" data-peer="${esc(s.peer)}" aria-label="Cut to ${esc(s.name)}, sound only${s.onAir ? ' (on air)' : ''}">
      <span class="snd" aria-hidden="true">🔊</span>${s.onAir ? '<span class="tag">ON AIR</span>' : ''}<b>${esc(s.name)}</b></button>`).join('');
  $('#autoBtn').setAttribute('aria-pressed', String(!!state.auto));
  $('#blackBtn').setAttribute('aria-pressed', String(!!state.black));
  $('#blackBtn').textContent = state.black ? 'Fade up' : 'Fade to black';
  $('#breakBtn').setAttribute('aria-pressed', String(!!state.brk));
  $('#breakBtn').textContent = state.brk ? 'End break' : 'Break';
  $('#recBtn').setAttribute('aria-pressed', String(!!state.rec));
  $('#recBtn').textContent = state.rec ? 'Stop recording' : 'Record program';
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
  navigator.vibrate?.(15);
};
for (const id of ['#cams', '#sound']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.cam');
    if (b) act('cut', b.dataset.peer);
  });
}
$('#autoBtn').onclick = () => act('auto', !state?.auto);
$('#blackBtn').onclick = () => act('black');
$('#breakBtn').onclick = () => act('break');
$('#recBtn').onclick = () => {
  if (state?.rec && !confirm('Stop recording the program?')) return;
  act('rec', !state?.rec);
};

// A phone's connection drops now and then (the screen sleeps, it goes to the background, the Wi-Fi
// blips); the studio lets go of a remote it can't see, and isn't told when it's back. So every five
// seconds the remote checks in (which binds it again), and if nothing has come for twelve, it asks
// for everything: a camera that joined meanwhile shows up without a reload.
setInterval(() => {
  if (!key || !host) return;
  if (Date.now() - lastState > 12000) send({ t: 'resume', key });
  else send({ t: 'vis', key, on: !document.hidden });
}, 5000);

async function keepAwake() {
  try {
    wake = await navigator.wakeLock?.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  // (pictures only while this is on screen; the screen kept awake while it is)
  if (key) send({ t: 'vis', key, on: !document.hidden });
  if (!document.hidden && key) keepAwake();
});

function pair() {
  eventId = ($('#show').value || eventId).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const c = ($('#code').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{6}$/.test(eventId)) return say('The show is the six-letter code the studio shows', true);
  if (c.length !== 8) return say('The code is eight letters and numbers (ABCD-EFGH)', true);
  const prior = localStorage.getItem(keyStore(eventId));
  if (prior) {
    key = prior;
    showControls();
    connect();
    return;
  }
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
$('#name').value = localStorage.getItem('vm_remote_name') || 'Phone remote';
$('#show').value = eventId;
if (code) $('#code').value = `${code.slice(0, 4)}-${code.slice(4)}`;

if (key && eventId) {
  showControls();
  connect();
} else if (code && eventId) {
  pair();
}
