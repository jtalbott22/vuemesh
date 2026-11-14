// One device in a call: everything but the page. The call page (call.js), the studio (studio/callin.js)
// and another computer's screen (share.js) each join calls with this.
//
// Keeping people out who weren't asked (core.mjs, calls):
// - the link carries a room key after the # (…/call?e=K7Q2MX#k=…). Browsers never send that part to
//   any server; a device proves it has the key with its hash, and our server keeps only a hash of that.
// - typing the code needs the 6-digit PIN too (whoever started the call has it).
// - a waiting room: someone already in lets each newcomer in. Waiting, a device sees nobody; its name
//   goes to the people in the call with its knock, and isn't kept.
// - let in once, a tab comes back after a dropped connection without waiting: it made a pass for
//   that (sessionStorage), and our server keeps only the pass's hash.
// Names, pictures and sound go between the devices over WebRTC, encrypted end to end; never to us.
//
// The media: one RTCPeerConnection per other device. In each pair the one with the lower id makes every
// offer (the first, and any restart), the other only answers, so two offers never cross. Every
// connection has the same three places from the start (sound, camera, screen); what's sent changes
// with replaceTrack, never a new offer. A data channel on each says names and what's on.
import { api, meshSocket, ICE, iceReady, identity, thumbprint, sha256hex } from '/js/vm.js';
import { countRoute } from '/js/rtc.js';

export const MAX_PEOPLE = 6;
const te = new TextEncoder();
export const hex = (s) => sha256hex(te.encode(s));
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomKey = () => b64url(crypto.getRandomValues(new Uint8Array(18)));
const SLOTS = ['audio', 'camera', 'screen'];

/** A call's link, for sharing: the room key after the # */
export const callLink = (id, key) => `${location.origin}/call?e=${id}#k=${key}`;
/** What a pasted link or typed code says: { id, key } (key '' for a bare code) or null */
export function parseCall(text) {
  const s = String(text || '').trim();
  const m = /[?&]e=([A-Za-z0-9]{6})(?:[^#]*)(?:#(.*))?/.exec(s);
  if (m) return { id: m[1].toUpperCase(), key: new URLSearchParams(m[2] || '').get('k') || '' };
  const code = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 ? { id: code, key: '' } : null;
}
/** Start a call: { id, key, pin, hostKey }, all kept on this device (the key never leaves it).
 * @param studio { show, sk }: a studio starting it (its show's code and host key): then it's the studio's to run */
export async function startCall(studio = null) {
  const key = randomKey();
  const made = await api('events', { method: 'POST', body: { kind: 'call', kh: await hex(key), ...(studio || {}) } });
  localStorage.setItem('vm_host_' + made.id, made.hostKey);
  localStorage.setItem('vm_callkey_' + made.id, key);
  localStorage.setItem('vm_callpin_' + made.id, made.pin);
  return { id: made.id, key, pin: made.pin, hostKey: made.hostKey };
}

let cidCache = '';
async function deviceId() {
  if (!cidCache) {
    try { cidCache = (await thumbprint((await identity()).jwk)).slice(0, 16); } catch { cidCache = ''; }
  }
  return cidCache;
}

/**
 * @param o.id the call's code; o.key its room key ('' if typed with the PIN); o.pin the PIN typed
 * @param o.name this device's name, for the others
 * @param o.tracks () => ({ audio, camera, screen }): what this device sends in each place (null: nothing)
 * @param o.state () => ({ mic, cam, screen }): what it says is on (the camera's off, say)
 * @param o.on handlers: waiting(), in(), peer(id, p) new link, change(id, p), gone(id, p, why: 'left'|'lost'),
 *   knock(id, name), waitingChange(), locked(on, byMe), removed(block), full()
 * @param o.slot a tab's own pass key (two in one tab, the studio's and another, keep theirs apart)
 * @param o.studio { show, sk }: this is a studio (its show's code and host key): nobody can take it out,
 *   and a call it started is its to run. Also on: refused(why)
 */
export class CallMesh {
  constructor(o) {
    Object.assign(this, { id: o.id, key: o.key || localStorage.getItem('vm_callkey_' + o.id) || '', pin: o.pin || '', name: o.name || 'Guest', tracksOf: o.tracks, stateOf: o.state || (() => ({ mic: true, cam: true, screen: false })), on: o.on || {}, slot: o.slot || '', studio: o.studio || null });
    this.studioRules = false; // (a studio's call, with the studio in it: only it lets in, takes out, locks)
    if (this.key) localStorage.setItem('vm_callkey_' + this.id, this.key);
    this.peers = new Map(); // peer id → { pc, dc, offers, name, mic, cam, sharing, cam$, screen$, relayed }
    this.waiting = new Map(); // peer id → name (from their knock)
    this.left = new Map(); // peer id → when (a list from just before they left can't bring them back)
    this.inCall = false;
    this.locked = false;
    this.me = '';
    this.sock = null;
    this.netChanged = false;
    this.onNet = () => this.networkChanged();
  }
  get hostKey() { return localStorage.getItem('vm_host_' + this.id) || ''; }
  get myPin() { return localStorage.getItem('vm_callpin_' + this.id) || ''; }
  get link() { return this.key ? callLink(this.id, this.key) : ''; }
  /** May this device let people in, take them out and lock the call? (not a guest in a studio's call) */
  get canRun() { return !this.studioRules || !!this.studio; }
  pass() {
    const k = `vm_callpass${this.slot}_${this.id}`;
    let p = sessionStorage.getItem(k);
    if (!p) sessionStorage.setItem(k, (p = randomKey()));
    return p;
  }
  get passedOnce() { return sessionStorage.getItem(`vm_callin${this.slot}_${this.id}`) === '1'; }

  /** May this device come in? Throws with the server's reason (a wrong link or PIN, locked, full) */
  async enter() {
    return api(`events/${this.id}/enter`, { method: 'POST', body: { kh: this.key ? await hex(this.key) : '', pin: this.pin, pass: this.pass(), k: this.hostKey, cid: await deviceId() } });
  }

  async join() {
    await iceReady;
    const pass = this.pass(), ph = await hex(pass), kh = this.key ? await hex(this.key) : '';
    this.sock = meshSocket({
      eventId: this.id,
      role: this.hostKey ? 'host' : 'guest',
      hostKey: this.hostKey,
      cid: await deviceId(),
      // (the key's hash or the PIN to come in; once let in, this tab's pass brings it back without waiting)
      query: () => ({ kh, pin: this.pin, pass: this.passedOnce ? pass : '', ph, ...(this.studio || {}) }),
      onWaiting: (w) => (w ? this.toWaiting() : this.toCall()),
      onPeers: (list, you, msg) => {
        this.me = you || this.me;
        if (msg && 'studioRules' in msg) this.studioRules = !!msg.studioRules;
        this.syncPeers(list);
        // (back on the server after the network changed: now every link can start again)
        if (this.netChanged && this.inCall) {
          this.netChanged = false;
          for (const p of this.peers.values()) p.restart();
        }
      },
      pingMs: 20000, // (a call's server link checks itself often: after a network change it's back in seconds)
      onSignal: (from, data) => this.onSignal(from, data),
      onMessage: (m) => this.onServer(m),
    });
    this.me = this.sock.peer;
    window.addEventListener('online', this.onNet);
    navigator.connection?.addEventListener?.('change', this.onNet);
  }

  // The network changed under this device (Wi-Fi to mobile data, say): its server link is likely dead
  // though it doesn't know yet, so make a new one now, and start every link again once it's back.
  networkChanged() {
    if (!this.inCall || !this.sock) return;
    this.netChanged = true;
    this.sock.blip();
  }

  toWaiting() {
    if (this.inCall) return; // (the server's say-so on reconnecting: in already, by pass)
    this.on.waiting?.();
    this.sock?.send({ action: 'knock', name: this.name });
    clearInterval(this.knocking);
    this.knocking = setInterval(() => !this.inCall && this.sock?.send({ action: 'knock', name: this.name }), 15000); // (again, for anyone who came in since)
  }
  toCall() {
    clearInterval(this.knocking);
    if (this.inCall) return;
    this.inCall = true;
    this.joinedAt = Date.now();
    sessionStorage.setItem(`vm_callin${this.slot}_${this.id}`, '1');
    this.on.in?.();
  }

  onServer(m) {
    if (m.type === 'admitted') return this.toCall();
    if (m.type === 'knock') {
      const isNew = !this.waiting.has(m.from) || this.waiting.get(m.from) === 'Someone';
      this.waiting.set(m.from, m.name || 'Someone');
      if (isNew) this.on.knock?.(m.from, m.name || 'Someone');
      return this.on.waitingChange?.();
    }
    if (m.type === 'locked') {
      this.locked = !!m.on;
      return this.on.locked?.(this.locked, m.by === this.me);
    }
    if (m.type === 'removed') {
      sessionStorage.removeItem(`vm_callin${this.slot}_${this.id}`);
      this.close(false);
      return this.on.removed?.(!!m.block);
    }
    if (m.type === 'full') return this.on.full?.();
    if (m.type === 'refused') return this.on.refused?.(m.why || 'Not allowed');
    if (m.type === 'left') return this.leftCall(m.peer, 'left'); // (they said goodbye: the server passes it on)
  }

  /** Who's in the call: a link to each, none to anyone gone */
  syncPeers(list) {
    const inside = list.filter((p) => !p.waiting && p.peer !== this.me);
    for (const p of list) if (p.waiting && !this.waiting.has(p.peer)) this.waiting.set(p.peer, 'Someone');
    for (const id of [...this.waiting.keys()]) if (!list.some((p) => p.peer === id && p.waiting)) this.waiting.delete(id);
    for (const [id, at] of this.left) if (Date.now() - at > 15000) this.left.delete(id);
    for (const p of inside) if (!this.peers.has(p.peer) && !this.left.has(p.peer)) this.connectTo(p.peer);
    for (const p of inside) if (this.peers.has(p.peer)) this.peers.get(p.peer).studio = !!p.studio; // (a studio: nobody takes it out)
    // Not on the server's list isn't gone: a device whose network just changed is off it for the
    // seconds its server link takes to come back, while its link with this one is still up or coming
    // back. Someone leaving says so (bye, left); otherwise they go if their link isn't back in 10 s.
    for (const [id, p] of this.peers) {
      if (inside.some((x) => x.peer === id)) p.offList = 0;
      else if (!p.offList) p.offList = Date.now(); // (the watch lets them go)
    }
    this.on.waitingChange?.();
  }

  hello() {
    const s = this.stateOf();
    // (a studio says too whether it's recording or live: rec, live)
    return { t: 'hello', name: this.name, mic: !!s.mic, cam: !!s.cam, screen: !!s.screen, ...('rec' in s ? { rec: !!s.rec, live: !!s.live } : {}) };
  }
  /** Say something to everyone (what's on: { t: 'state', mic, cam, screen }) */
  say(m) {
    for (const p of this.peers.values()) if (p.dc?.readyState === 'open') try { p.dc.send(JSON.stringify(m)); } catch {}
  }
  /** What this device sends changed (a screen shared, a microphone swapped): into every link */
  refill() {
    for (const p of this.peers.values()) p.fill();
    this.say({ ...this.hello(), t: 'state' });
  }

  connectTo(id) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    countRoute(pc, 'call');
    const offers = this.me < id;
    const p = { pc, offers, early: [], name: '', mic: true, cam: true, sharing: false, cam$: new MediaStream(), screen$: new MediaStream(), relayed: false };
    this.peers.set(id, p);
    const signal = (data) => this.sock?.signal(id, data);
    // (a channel both sides make with the same id: no extra offer needed for it)
    p.dc = pc.createDataChannel('call', { negotiated: true, id: 0 });
    p.dc.onopen = () => p.dc.send(JSON.stringify(this.hello()));
    p.dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      // (leaving: said over the link itself, so everyone sees it at once)
      if (m.t === 'bye') return this.leftCall(id, 'left');
      // (they can't hear this device: put its tracks in again, and start the link again from this side too)
      if (m.t === 'resend') {
        this.resends = (this.resends || 0) + 1;
        return void p.fill().then(() => restart());
      }
      if (m.t === 'hello' || m.t === 'state') {
        const first = m.t === 'hello' && !p.greeted && m.name;
        if (first) p.greeted = true;
        if (typeof m.name === 'string') p.name = m.name.slice(0, 40);
        if ('mic' in m) p.mic = !!m.mic;
        if ('cam' in m) p.cam = !!m.cam;
        if ('screen' in m) p.sharing = !!m.screen;
        if ('rec' in m) p.rec = !!m.rec;
        if ('live' in m) p.live = !!m.live;
        p.joinedLate = first && Date.now() - (this.joinedAt || 0) > 3000;
        this.on.change?.(id, p, first ? 'hello' : 'state');
        return;
      }
      this.on.message?.(id, p, m); // (anything else: captions, say)
    };
    // (the offering side makes the three places; the answering side finds them in the offer, in order)
    if (offers) for (const slot of SLOTS) pc.addTransceiver(slot === 'audio' ? 'audio' : 'video', { direction: 'sendrecv' });
    pc.onicecandidate = ({ candidate }) => candidate && signal({ candidate });
    pc.ontrack = ({ track, transceiver }) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(transceiver)];
      const s = slot === 'screen' ? p.screen$ : p.cam$;
      for (const old of s.getTracks().filter((t) => t.kind === track.kind)) s.removeTrack(old);
      s.addTrack(track);
      track.onunmute = track.onmute = () => this.on.change?.(id, p, 'track');
      this.on.change?.(id, p, 'track');
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') restart();
      // (back after a restart: say who this is again, in case they started a new link to this one)
      if (pc.connectionState === 'connected' && p.dc.readyState === 'open') p.dc.send(JSON.stringify(this.hello()));
      if (pc.connectionState === 'connected') this.checkRoute(p);
      this.on.change?.(id, p, 'link');
    };
    // (a link that drops, as when a phone goes from Wi-Fi to mobile data: start again with fresh
    // candidates after 2 s, not the half minute a browser takes to call it failed)
    pc.oniceconnectionstatechange = () => {
      clearTimeout(p.drop);
      if (pc.iceConnectionState === 'disconnected') p.drop = setTimeout(() => ['disconnected', 'failed'].includes(pc.iceConnectionState) && restart(), 2000);
      this.on.change?.(id, p, 'link');
    };
    // a fresh start (new candidates): the offering side does it; the other asks
    const restart = () => (offers ? offer(true) : signal({ restart: true }));
    const offer = async (iceRestart = false) => {
      try {
        await fill();
        await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
        p.offeredAt = Date.now();
        signal({ description: pc.localDescription });
      } catch (e) {
        console.warn('call: offer', e);
      }
    };
    // what goes in each place: this device's sound, camera and (when shared) screen
    const fill = async () => {
      const tr = pc.getTransceivers(), mine = this.tracksOf() || {};
      for (const [i, slot] of SLOTS.entries()) {
        if (!tr[i]) continue;
        if (tr[i].direction !== 'sendrecv') tr[i].direction = 'sendrecv';
        const t = mine[slot] || null;
        if (tr[i].sender.track !== t) await tr[i].sender.replaceTrack(t).catch(() => {});
      }
    };
    Object.assign(p, { offer, restart, fill });
    // (agreed, but never started connecting: a message lost on the way. Start again with fresh candidates)
    const born = Date.now();
    p.watch = setInterval(() => {
      if (pc.connectionState === 'closed') return clearInterval(p.watch);
      // (off the server's list for 10 s, and their link not up: gone without a goodbye, a closed laptop)
      if (p.offList && Date.now() - p.offList > 10000 && pc.connectionState !== 'connected') return this.leftCall(id, 'lost');
      const stuck = pc.signalingState === 'stable' && pc.remoteDescription && (pc.iceConnectionState === 'new' || pc.connectionState === 'failed');
      if (stuck && Date.now() - born > 6000) restart();
      // (an offer nobody answered: it went while their server link was being remade. Again)
      else if (offers && pc.signalingState === 'have-local-offer' && Date.now() - (p.offeredAt || 0) > 8000) offer(true);
      else this.checkSound(id, p);
    }, 4000);
    if (offers) offer();
    this.on.peer?.(id, p);
  }

  async onSignal(from, { description, candidate, restart } = {}) {
    // (someone just let in can offer before the list saying they're in reaches this device, or before
    // this one hears it's in itself: the server only passes signals between people in the call, so a
    // signal means both are in. Link to them now rather than drop their offer)
    if (!this.peers.has(from) && from !== this.me && this.sock) this.connectTo(from);
    const p = this.peers.get(from);
    if (!p) return;
    const pc = p.pc;
    try {
      if (restart) return void (p.offers && p.offer(true));
      if (description) {
        if (description.type === 'offer' && p.offers) return; // (never: this side makes the offers)
        if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') return; // (an old one)
        await pc.setRemoteDescription(description);
        // (the candidates that came before it: each message is passed on by itself, so one can overtake another)
        for (const c of p.early.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (description.type === 'offer') {
          await p.fill();
          await pc.setLocalDescription(await pc.createAnswer());
          this.sock?.signal(from, { description: pc.localDescription });
        }
      } else if (candidate) {
        if (!pc.remoteDescription) return void p.early.push(candidate);
        await pc.addIceCandidate(candidate).catch(() => {});
      }
    } catch (e) {
      console.warn('call: signal', e);
    }
  }

  /** Their microphone's on, the link's up, and no sound has come for 8 s: ask them to send it again
   * (and start the link again), rather than sit there not hearing them. Once a minute at most. */
  async checkSound(id, p) {
    if (p.pc.connectionState !== 'connected' || !p.mic || p.dc?.readyState !== 'open') return void (p.quietChecks = 0);
    let packets = null;
    try {
      (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') packets = (packets || 0) + (r.packetsReceived || 0); });
    } catch { return; }
    if (packets === null || packets !== p.lastPackets) {
      p.lastPackets = packets;
      p.quietChecks = 0;
      p.hearing = packets !== null && packets > 0;
      return;
    }
    p.hearing = false;
    if (++p.quietChecks < 2 || Date.now() - (p.askedAgain || 0) < 60000) return;
    p.askedAgain = Date.now();
    p.quietChecks = 0;
    this.asked = (this.asked || 0) + 1;
    console.warn('call: no sound from', p.name || id, '- asking again');
    try { p.dc.send(JSON.stringify({ t: 'resend' })); } catch {}
    p.restart();
  }

  /** Whether a link goes through our relay (said on its tile) */
  async checkRoute(p) {
    try {
      const stats = await p.pc.getStats();
      let pair = null;
      stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      const loc = pair && stats.get(pair.localCandidateId), rem = pair && stats.get(pair.remoteCandidateId);
      p.relayed = loc?.candidateType === 'relay' || rem?.candidateType === 'relay';
    } catch {}
  }

  /** Someone left (they said so, or their link's gone for good) */
  leftCall(id, why) {
    const p = this.peers.get(id);
    if (!p) return;
    this.left.set(id, Date.now());
    this.drop(id);
    this.on.gone?.(id, p, why);
  }
  drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    clearInterval(p.watch);
    clearTimeout(p.drop);
    try { p.pc.close(); } catch {}
    this.peers.delete(id);
  }

  // ---- what anyone in the call can do ----
  admit(id) { this.sock?.send({ action: 'admit', peer: id }); this.waiting.delete(id); }
  turnAway(id) { this.sock?.send({ action: 'remove', peer: id }); this.waiting.delete(id); }
  takeOut(id) { this.sock?.send({ action: 'remove', peer: id, block: true }); }
  lock(on) { this.sock?.send({ action: 'lock', on: !!on }); }

  /** Leave: goodbye over every link (at once) and to the server (which tells anyone not yet linked) */
  leave() {
    this.say({ t: 'bye' });
    this.sock?.send({ action: 'leave' });
    this.close(true);
  }
  close(wait) {
    clearInterval(this.knocking);
    window.removeEventListener('online', this.onNet);
    navigator.connection?.removeEventListener?.('change', this.onNet);
    const s = this.sock;
    this.sock = null;
    if (wait) setTimeout(() => s?.close(), 300); // (a moment for the goodbyes to go)
    else s?.close();
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.inCall = false;
  }
}
