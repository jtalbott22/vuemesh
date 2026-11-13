// Studio, part 29 of 29: a call's people as sources.
// Loads after faces.js: that import comes first, so the parts run in order (see ../studio.js).
//
// The studio joins a call (callmesh.js, the same as /call and another computer's /share) as one of
// its people: Add → People on a call. It starts one (its link and PIN to send the guests), or joins
// one by its link or its code and PIN. Then:
//   - each person in the call is a source, their camera with their sound, like a phone's; a screen
//     one of them shares is a source of its own. Their sound is ON in the mixer from the start
//     (they're talking), and they're recorded here as they arrive while they're on air, for Edit.
//   - the call sees the program, as the studio's camera, and hears the program without its own
//     people (they hear each other straight; sent back to them, they'd hear themselves late).
//   - the waiting room: the studio lets people in and takes them out like anyone in the call.
// Nobody in the call keeps anything for the show: everything they send is here, and it's the
// studio's to record.
import './faces.js';
import { announce, esc, toast } from '/js/vm.js';
import { CallMesh, MAX_PEOPLE, parseCall, startCall } from '/js/callmesh.js';
import { EDIT_ONLY, KIOSK, ev, eventId, hub, isHost, key as showKey, live, note } from './core.js';
import { renderLive } from './live.js';
import { callSoundTrack, mixAttach, mixSave, mixSaved, mixState, renderMixer } from './mixer.js';
import { programVideoTrack, progRec } from './switcher.js';
import { streamOut } from './stream.js';
import { callAsking, renderNotifs } from './showlog.js';
import { callFeed } from './screens.js';
import { crewHeard } from './room.js';

let mesh = null;
// Someone waiting to come in shows on the bell (Notifications) too, with Let in and Turn away, and as
// the system's own alert while the studio is hidden: the call panel may be closed, the studio behind
// a slideshow. (showlog.js draws it; this says who's waiting.)
const waitingSince = new Map(); // peer id → when first seen waiting
Object.assign(callAsking, {
  list: () => (mesh?.inCall ? [...mesh.waiting].map(([id, name]) => {
    if (!waitingSince.has(id)) waitingSince.set(id, Date.now());
    return { id, name, at: waitingSince.get(id) };
  }) : []),
  admit: (id) => { mesh?.admit(id); waitingChanged(); },
  deny: (id) => { mesh?.turnAway(id); waitingChanged(); },
});
function waitingChanged() {
  for (const id of [...waitingSince.keys()]) if (!mesh?.waiting.has(id)) waitingSince.delete(id);
  renderNotifs();
  if (dlg.open) render();
}
let out = null; // { camera, audio }: what the call gets from the studio
// What the call's people are told about the show: recording the program, streaming it. Said when it
// changes, so their page shows it as it happens.
const airState = () => ({ rec: !!progRec && !progRec.stopping, live: !!streamOut });
let saidAir = '';
setInterval(() => {
  if (!mesh?.inCall) return;
  const now = JSON.stringify(airState());
  if (now === saidAir) return;
  saidAir = now;
  mesh.say({ t: 'state', ...airState() });
}, 1500);
const keyOf = (id, screen) => `call-${id}${screen ? '-s' : ''}`;

// ---- the panel ---------------------------------------------------------------------------------
const dlg = document.createElement('dialog');
dlg.id = 'callDlg';
dlg.className = 'localdlg';
dlg.setAttribute('aria-labelledby', 'callH');
dlg.innerHTML = `<style>
  #callDlg { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 24px 64px #0009; }
  #callDlg header { display: flex; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; border-bottom: 1px solid var(--line); }
  #callDlg h2 { margin: 0 0 4px; font-size: 1.2rem; }
  #callDlg header p, #callDlg .fine { margin: 0; font-size: .8rem; line-height: 1.45; color: var(--text-2); }
  #callDlg .cbody { padding: 14px 20px 18px; display: grid; gap: 12px; }
  #callDlg .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #callDlg input { flex: 1; min-width: 10em; }
  #callDlg .link { font: .82rem/1.3 ui-monospace, Menlo, monospace; word-break: break-all; background: var(--surface-2); border-radius: 8px; padding: 8px 10px; }
  #callDlg ul { list-style: none; margin: 0; padding: 0; }
  #callDlg li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--line); }
  #callDlg li b { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #callDlg h3 { margin: 4px 0 0; font-size: .85rem; color: var(--text-2); }
  #callDlg .err { color: #ff8a80; font-size: .85rem; margin: 0; }
</style>
<header><div><h2 id="callH">People on a call</h2><p>Guests anywhere join on their own camera; each is a source here. The call sees the program and hears it without themselves.</p></div>
<form method="dialog"><button class="ldx" aria-label="Close">✕</button></form></header>
<div class="cbody" id="callBody"></div>`;
document.body.append(dlg);
const body = dlg.querySelector('#callBody');
const err = (t) => (body.querySelector('.err') ? (body.querySelector('.err').textContent = t || '') : null);

function render() {
  if (!mesh) {
    body.innerHTML = `
      <div class="row"><button type="button" class="primary" data-act="start">Start a call</button><span class="fine">Then send the guests its link.</span></div>
      <h3>Or join one</h3>
      <div class="row"><input id="callWhere" placeholder="The call's link, or its code" aria-label="The call's link or code" autocomplete="off" spellcheck="false">
      <input id="callPin" placeholder="PIN (with a code)" inputmode="numeric" maxlength="6" aria-label="The call's PIN" autocomplete="off" style="max-width:9em"></div>
      <div class="row"><button type="button" data-act="join">Join the call</button></div>
      <p class="err" role="alert"></p>`;
    return;
  }
  const n = mesh.peers.size, w = [...mesh.waiting];
  body.innerHTML = `
    <div class="row"><b>Call ${esc(mesh.id)}</b><span class="fine">${mesh.inCall ? `${n} ${n === 1 ? 'guest' : 'guests'} with the studio (${MAX_PEOPLE} at most)` : 'Waiting to be let in by someone in the call'}${mesh.locked ? ' · locked' : ''}</span></div>
    ${mesh.link ? `<p class="fine">Send the guests this link:</p><p class="link">${esc(mesh.link)}</p><div class="row"><button type="button" data-act="copy">Copy link</button>${mesh.myPin ? `<span class="fine">or the code <b>${esc(mesh.id)}</b> and PIN <b>${esc(mesh.myPin)}</b> at ${esc(location.host)}/call</span>` : ''}</div>` : ''}
    ${w.length ? `<h3>Waiting to come in</h3><ul>${w.map(([id, name]) => `<li><b>${esc(name)}</b><button type="button" class="primary" data-admit="${esc(id)}">Let in</button><button type="button" data-deny="${esc(id)}">Turn away</button></li>`).join('')}</ul>` : ''}
    ${n ? `<h3>In the call</h3><ul>${[...mesh.peers].map(([id, p]) => `<li><b>${esc(p.name || 'Joining…')}</b><span class="fine">${p.pc.connectionState === 'connected' ? (p.relayed ? 'through the relay' : '') : 'connecting…'}</span><button type="button" data-out="${esc(id)}">Take out</button></li>`).join('')}</ul>` : ''}
    <div class="row"><button type="button" data-act="lock" aria-pressed="${mesh.locked}">${mesh.locked ? 'Unlock the call' : 'Lock the call'}</button><button type="button" class="danger" data-act="leave">Leave the call</button></div>
    <p class="err" role="alert"></p>`;
}

/** Open the panel (Add → People on a call) */
export function openCall() {
  if (!isHost) return toast('Only the studio with the show’s key can bring a call in');
  render();
  if (!dlg.open) dlg.showModal();
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-call]')) return;
  document.getElementById('localDlg')?.close();
  openCall();
});

dlg.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    // (asked here, in a click: someone waiting then shows as the system's alert while the studio is hidden)
    if ((b.dataset.act === 'start' || b.dataset.act === 'join') && window.Notification?.permission === 'default') Notification.requestPermission().catch(() => {});
    if (b.dataset.act === 'start') {
      b.disabled = true;
      const c = await startCall({ show: eventId, sk: showKey }); // (the studio's: its to run)
      await join(c.id, c.key, '');
    } else if (b.dataset.act === 'join') {
      const where = parseCall(body.querySelector('#callWhere').value);
      const pin = body.querySelector('#callPin').value.replace(/\D/g, '');
      if (!where) return err('Paste the call’s link, or type its 6-letter code');
      if (!where.key && !localStorage.getItem('vm_callkey_' + where.id) && pin.length !== 6) return err('With a code, type the call’s 6-digit PIN too');
      b.disabled = true;
      await join(where.id, where.key, pin);
    } else if (b.dataset.act === 'copy') {
      await navigator.clipboard.writeText(mesh.link).then(() => toast('Link copied: send it to the guests'), () => toast('Copy it from the box'));
    } else if (b.dataset.act === 'lock') mesh.lock(!mesh.locked);
    else if (b.dataset.act === 'leave') {
      if (!confirm('Leave the call? Its people go from the show’s sources.')) return;
      leave();
    } else if (b.dataset.admit) callAsking.admit(b.dataset.admit);
    else if (b.dataset.deny) callAsking.deny(b.dataset.deny);
    else if (b.dataset.out) {
      const p = mesh.peers.get(b.dataset.out);
      if (!confirm(`Take ${p?.name || 'them'} out of the call? They can't come back to it.`)) return;
      mesh.takeOut(b.dataset.out);
    }
  } catch (x) {
    b.disabled = false;
    err(x.message);
    return;
  }
  render();
});

// ---- joining -----------------------------------------------------------------------------------
async function join(id, key, pin) {
  out = { camera: programVideoTrack(), audio: callSoundTrack() };
  const name = `${ev?.title || 'The studio'} (studio)`.slice(0, 40);
  mesh = new CallMesh({
    id, key, pin, name, slot: 'studio', studio: { show: eventId, sk: showKey }, // (a studio, proved with the show's key: nobody takes it out)
    tracks: () => ({ audio: out?.audio, camera: out?.camera, screen: null }),
    // (and whether it's recording the program or streaming it: the call's people are told)
    state: () => ({ mic: true, cam: true, screen: false, ...airState() }),
    on: {
      waiting: render,
      in: () => {
        note(`The studio is in call ${id}`);
        announce('The studio is in the call');
        render();
      },
      peer: (pid, p) => sync(pid, p),
      // (a guest saw or answered the studio's message: as a phone's would be, in the studio's messages)
      message: (pid, p, m) => {
        if (m.t === 'msgseen' || m.t === 'msgreply') crewHeard(keyOf(pid, false), { t: m.t === 'msgseen' ? 'seen' : 'reply', id: String(m.id || ''), text: String(m.text || '').slice(0, 200) });
      },
      change: (pid, p, why) => {
        sync(pid, p);
        if (why === 'hello' && p.joinedLate) toast(`${p.name} joined the call`);
        if (dlg.open) render();
      },
      gone: (pid, p) => {
        drop(pid);
        toast(`${p.name || 'Someone'} left the call`);
        if (dlg.open) render();
      },
      knock: (pid, who) => {
        toast(`${who} is waiting to come into the call: Let them in under Notifications (the bell)`, 8000);
        announce(`${who} is waiting to come into the call`);
      },
      waitingChange: waitingChanged,
      locked: (on, byMe) => {
        if (!byMe) toast(on ? 'The call was locked' : 'The call was unlocked');
        if (dlg.open) render();
      },
      removed: (block) => {
        toast(block ? 'Someone in the call took the studio out' : 'The studio wasn’t let into the call', 7000);
        leave(true);
      },
      full: () => toast(`The call is full (${MAX_PEOPLE})`),
    },
  });
  try {
    await mesh.enter();
    await mesh.join();
  } catch (x) {
    leave(true);
    throw x;
  }
}

function leave(already) {
  if (!already) mesh?.leave();
  for (const pid of [...(mesh?.peers.keys() || [])]) drop(pid);
  for (const [peer, l] of [...live]) if (l.call) end(peer);
  mesh = null;
  waitingChanged();
  out?.camera?.stop();
  out = null;
  render();
}

// ---- each person in the call: a source (and their screen, while they share one) -------------------
function sync(pid, p) {
  addOrUpdate(pid, p, false);
  if (p.sharing && p.screen$.getVideoTracks().length) addOrUpdate(pid, p, true);
  else if (live.has(keyOf(pid, true))) end(keyOf(pid, true));
}

function addOrUpdate(pid, p, screen) {
  const peer = keyOf(pid, screen);
  const stream = screen ? p.screen$ : p.cam$;
  const name = screen ? `${p.name || 'A guest'}’s screen` : p.name || 'A guest';
  const l = live.get(peer);
  if (l) {
    if (!l.renamed && l.name !== name) {
      l.name = l.phoneName = name;
      renderLive();
      renderMixer();
    }
    mixAttach(peer); // (their sound may have come after their picture)
    return;
  }
  if (!stream.getTracks().length || !hub) return; // (nothing yet: it's added when something comes)
  routeMessages();
  const cid = `C${pid.slice(0, 10)}${screen ? 's' : ''}`;
  // their sound is ON from the start: they're talking, not a camera's room sound
  if (!screen && !mixSaved()[cid]) mixSave(cid, { ...mixState(cid, 'cam'), mode: 'on' });
  // (marked a call's before it's added: its mixer channel then stays out of what the call hears)
  live.set(peer, { call: pid, screen, route: 'call', fixed: false });
  hub.known.set(peer, { peer, role: 'cam', name, cid, rec: false });
  hub.onLive(peer, stream, 'cam');
  const added = live.get(peer);
  if (added) Object.assign(added, { call: pid, screen, route: 'call' });
  renderLive();
}

// The studio's messages to a source go over its link to that phone (hub.message); a call's people
// have no such link, so to one of them they go over the call's own (its data channel), and the call
// page shows them with a reply box. Only messages: the rest (tally, rundown) are a phone's.
function routeMessages() {
  if (!hub || hub.callRouted) return;
  hub.callRouted = true;
  const phoneMessage = hub.message.bind(hub);
  hub.message = (peer, obj) => {
    const l = live.get(peer);
    if (!l?.call) return phoneMessage(peer, obj);
    if (obj?.t !== 'msg') return false;
    const p = mesh?.peers.get(l.call);
    if (p?.dc?.readyState !== 'open') return false;
    try {
      p.dc.send(JSON.stringify({ t: 'studiomsg', id: obj.id, text: String(obj.text || '').slice(0, 500), all: !!obj.all }));
      return true;
    } catch {
      return false;
    }
  };
}

function drop(pid) {
  for (const s of [false, true]) if (live.has(keyOf(pid, s))) end(keyOf(pid, s));
}
function end(peer) {
  hub?.known.delete(peer);
  if (hub?.onLiveEnd) hub.onLiveEnd(peer, 'left');
  else live.delete(peer);
}

// ---- for the Monitor: each guest's link coming in, and what goes out to the call -----------------
const lastBytes = new Map(); // what → { bytes, t }
function kbps(what, bytes) {
  const t = performance.now(), was = lastBytes.get(what);
  lastBytes.set(what, { bytes, t });
  return was && t > was.t && bytes >= was.bytes ? Math.round(((bytes - was.bytes) * 8) / (t - was.t)) : null; // (bytes × 8 / ms = kbit/s)
}
const codecOf = (stats, r) => stats.get(r?.codecId)?.mimeType?.split('/')[1] || null;
Object.assign(callFeed, {
  async peerStats(peer) {
    const l = live.get(peer), p = l && mesh?.peers.get(l.call);
    if (!p) return null;
    const stats = await p.pc.getStats(), mine = new Set((l.screen ? p.screen$ : p.cam$).getTracks().map((t) => t.id));
    let video = null, audio = null;
    stats.forEach((r) => {
      if (r.type !== 'inbound-rtp' || !mine.has(r.trackIdentifier)) return;
      if (r.kind === 'video') video = r;
      else audio = r;
    });
    return {
      route: p.relayed ? 'relay' : 'call',
      videoKbps: video ? kbps(`${peer}:v`, video.bytesReceived) : null, audioKbps: audio ? kbps(`${peer}:a`, audio.bytesReceived) : null,
      width: video?.frameWidth || null, height: video?.frameHeight || null, fps: video?.framesPerSecond ? Math.round(video.framesPerSecond) : null, codec: codecOf(stats, video),
    };
  },
  async out() {
    if (!mesh) return null;
    const to = [];
    for (const [id, p] of mesh.peers) {
      let bytes = 0, video = null;
      const stats = await p.pc.getStats();
      stats.forEach((r) => {
        if (r.type !== 'outbound-rtp') return;
        bytes += r.bytesSent || 0;
        if (r.kind === 'video' && r.frameWidth) video = r;
      });
      to.push({ name: p.name, kbps: kbps(`out:${id}`, bytes), w: video?.frameWidth || null, h: video?.frameHeight || null, codec: codecOf(stats, video), relayed: !!p.relayed, connected: p.pc.connectionState === 'connected' });
    }
    return { id: mesh.id, in: mesh.inCall, to };
  },
});

// the studio closing: a goodbye to the call
window.addEventListener('pagehide', () => mesh?.leave());

// (the studio is the call's only way into the show: not at a kiosk, or in the Edit window)
if (KIOSK || EDIT_ONLY) document.addEventListener('click', (e) => e.target.closest('[data-call]') && e.stopImmediatePropagation(), true);

window.vmStudioCall = () => mesh && { id: mesh.id, in: mesh.inCall, link: mesh.link, pin: mesh.myPin, waiting: [...mesh.waiting.values()], peers: [...mesh.peers].map(([id, p]) => ({ id, name: p.name, state: p.pc.connectionState })), sources: [...live].filter(([, l]) => l.call).map(([peer, l]) => ({ peer, name: l.name, screen: !!l.screen, sound: !!l.stream?.getAudioTracks().length, mode: mixState(l.cid, 'cam').mode, video: l.video?.videoWidth || l.tile?.querySelector('video')?.videoWidth || 0 })) }; // (tests)
