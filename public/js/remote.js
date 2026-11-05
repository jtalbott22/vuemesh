// The phone remote: pairs with the studio using the one-time code it shows (from its QR, or typed),
// then shows what's on air and the cameras, and sends the studio commands with this phone's own
// session key (kept on this phone for this show, so it carries on after a reload). The studio
// checks every command; see remote-host.js.
import { ProgramView } from '/js/pgmview.js';
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
  if (m.t === 'paired' || m.t === 'tv') {
    if (m.tv) startProgram(m.tv);
    if (m.t === 'tv') return;
  }
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
    pgm?.stop();
    pgm = null;
    $('#pgmBox').hidden = $('#pgmTgl').hidden = true;
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

// Program out: what's on air, right above the cameras (its own link from the studio; off to save battery)
let pgm = null, pgmKey = null;
const pgmOn = () => localStorage.getItem('vm_remote_pgm') !== '0';
function startProgram(tvKey) {
  pgmKey = tvKey;
  $('#pgmTgl').hidden = false;
  $('#pgmTgl').setAttribute('aria-pressed', String(pgmOn()));
  $('#pgmBox').hidden = !pgmOn();
  if (!pgmOn() || pgm?.key === tvKey) return;
  pgm?.stop();
  pgm = new ProgramView({ eventId, key: tvKey, name: localStorage.getItem('vm_remote_name') || 'Phone remote', video: $('#pgm'), onState: (t) => ($('#pgmSay').textContent = t) });
}
$('#pgmTgl').onclick = () => {
  const on = !pgmOn();
  localStorage.setItem('vm_remote_pgm', on ? '1' : '0');
  if (!on) {
    pgm?.stop();
    pgm = null;
  }
  $('#pgmTgl').setAttribute('aria-pressed', String(on));
  $('#pgmBox').hidden = !on;
  if (on && pgmKey) startProgram(pgmKey);
};
window.vmProgramView = () => pgm && { linked: pgm.linked, shown: pgm.shown, w: $('#pgm').videoWidth, h: $('#pgm').videoHeight }; // (tests)

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
let alertBuzzed = false;
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
  // a sound alert from the studio, with the sources that could stand in
  const alerts = state.alerts || [];
  $('#alert').hidden = !alerts.length;
  if (alerts.length) {
    const head = alerts.find((a) => a.kind === 'program-silent') || alerts[0];
    const more = alerts.filter((a) => a !== head);
    $('#alert').innerHTML = `⚠ ${esc(head.text)}${more.length ? `<small>${more.map((a) => esc(a.text)).join(' · ')}</small>` : ''}`
      + ((state.backups || []).length ? `<div class="row">${state.backups.map((b) => `<button type="button" data-sound-on="${esc(b.peer)}">Turn on ${esc(b.name)}</button>`).join('')}</div>` : '');
    if (!alertBuzzed) navigator.vibrate?.([200, 100, 200]);
  }
  alertBuzzed = alerts.length > 0;
  $('#noCams').hidden = state.cams.length > 0;
  // sound-only sources: cut to one and the program shows its sound picture
  const sound = state.sound || [];
  $('#soundH').hidden = $('#sound').hidden = !sound.length;
  $('#sound').innerHTML = sound.map((s) => `<button type="button" class="cam${s.onAir ? ' air' : ''}" data-peer="${esc(s.peer)}" aria-label="Cut to ${esc(s.name)}, sound only${s.onAir ? ' (on air)' : ''}">
      <span class="snd" aria-hidden="true">🔊</span>${s.onAir ? '<span class="tag">ON AIR</span>' : ''}<b>${esc(s.name)}</b></button>`).join('');
  // the clips loaded in the studio: cut to one and it plays on air
  const clips = state.clips || [];
  $('#clipsH').hidden = $('#clips').hidden = !clips.length;
  $('#clips').innerHTML = clips.map((c) => `<button type="button" class="cam${c.onAir ? ' air' : ''}" data-clip="${esc(c.id)}" aria-label="Cut to the clip ${esc(c.name)}${c.onAir ? ' (on air)' : ''}">
      <span class="snd" aria-hidden="true">${c.kind === 'image' ? '🖼' : '🎞'}</span>${c.onAir ? '<span class="tag">ON AIR</span>' : ''}<b>${esc(c.name)}</b></button>`).join('');
  renderMix();
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
  if (a !== 'mixGain') navigator.vibrate?.(15); // (not all the way along a fader)
};
for (const id of ['#cams', '#sound']) {
  $(id).addEventListener('click', (e) => {
    const b = e.target.closest('.cam');
    if (b) act('cut', b.dataset.peer);
  });
}
$('#alert').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound-on]');
  if (b) act('soundOn', b.dataset.soundOn);
});
$('#clips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-clip]');
  if (b) act('clip', b.dataset.clip);
});
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
