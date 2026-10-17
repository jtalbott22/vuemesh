// The studio's side of a TV screen (the "display" role): the Apple TV app, or /tv in any browser.
// See docs/APPLE-TV.md for the whole protocol.
//
// A TV joins the event with its code, like a phone, but knowing the code (it's on every beacon)
// doesn't let it show anything. The studio lets it in: Accept in TV screens, or a one-time code
// typed on the TV (8 characters, two minutes, five tries, as for the phone remote). Either way the
// TV gets its own key, remembered on both sides, so it comes back on its own after a reload.
//
// Messages go through the event's signalling only between the studio and the TV, inside
// data.display ({t: 'hello' | 'pair' | 'state'} up; {t: 'waiting' | 'paired' | 'reject'} down).
// Then the TV offers a receive-only connection (the usual offer / answer / ice), the studio puts
// the program's picture and sound on it, and everything else (mode, ping) rides its "ctl" channel
// over the local network. Nothing but the handshake touches the cloud.

import { ICE } from '/js/vm.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no 0/O, 1/I/L: read off a screen)
const rand = (n, chars = CODE_CHARS) => {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => chars[x % chars.length]).join('');
};
const newKey = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const PAIR_MS = 120000, TRIES = 5;
const PROGRAM_KBPS = 6000; // 1080p30 program on the local network
export const DISPLAY_MODES = ['program', 'idle'];

export class DisplayHub {
  /**
   * @param o.eventId
   * @param o.title () → the event's name, for the TV's screen
   * @param o.send (peer, data) → the studio's signal to one connection
   * @param o.program () → MediaStreamTrack[] for one TV: the program picture (a copy) and its sound
   * @param o.changed () → the list changed (redraw TV screens)
   * @param o.note (text) → a line in the studio's event log
   * @param o.localOnly? () → true: keep only local-network candidates
   */
  constructor(o) {
    Object.assign(this, o);
    this.store = `vm_displays_${o.eventId}`;
    this.keys = new Map(); // key → { name, model, mode, at }
    try {
      for (const r of JSON.parse(localStorage.getItem(this.store) || '[]')) this.keys.set(r.key, { name: r.name, model: r.model, mode: r.mode || 'program', at: r.at });
    } catch {}
    this.waiting = new Map(); // peer → { name, model, at }
    this.links = new Map(); // peer → { key, pc, ctl, state, tracks, pendingIce, remoteSet, lastSeen }
    this.pairing = null; // { code, until, tries }
    this.timer = setInterval(() => this.sweep(), 5000);
  }

  save() {
    try {
      localStorage.setItem(this.store, JSON.stringify([...this.keys].map(([key, v]) => ({ key, ...v }))));
    } catch {}
  }

  // ---- pairing ---------------------------------------------------------------

  startPairing() {
    this.pairing = { code: rand(8), until: Date.now() + PAIR_MS, tries: 0 };
    this.changed?.();
    return this.pairing;
  }
  stopPairing() {
    this.pairing = null;
    this.changed?.();
  }
  pairingLeft() {
    return this.pairing ? Math.max(0, this.pairing.until - Date.now()) : 0;
  }

  /** Let a waiting TV in (Accept in TV screens). */
  accept(peer) {
    const w = this.waiting.get(peer);
    if (!w) return;
    this.waiting.delete(peer);
    this.bind(peer, this.remember(w));
    this.note?.(`TV screen added: ${w.name}`);
  }
  /** Turn a waiting TV away for now (it can ask again). */
  decline(peer) {
    if (!this.waiting.delete(peer)) return;
    this.reply(peer, { t: 'reject', code: 'declined', message: 'The studio didn’t let this TV in.' });
    this.changed?.();
  }

  remember(w) {
    const key = newKey();
    this.keys.set(key, { name: w.name || 'TV', model: w.model || '', mode: 'program', at: Date.now() });
    this.save();
    return key;
  }

  /** Forget a TV: it stops showing the program at once and has to be let in again. */
  remove(key) {
    if (!this.keys.delete(key)) return;
    this.save();
    for (const [peer, l] of [...this.links]) {
      if (l.key !== key) continue;
      this.reply(peer, { t: 'reject', code: 'removed', message: 'The studio removed this TV.' });
      this.close(peer);
    }
    this.changed?.();
  }

  bind(peer, key) {
    const prev = this.links.get(peer);
    if (prev && prev.key !== key) this.close(peer);
    if (!this.links.has(peer)) this.links.set(peer, { key, pc: null, ctl: null, state: { status: 'joining' }, tracks: [], pendingIce: [], remoteSet: false, lastSeen: Date.now() });
    this.reply(peer, { t: 'paired', key, label: this.keys.get(key)?.name || 'TV', title: this.title?.() || '' });
    this.changed?.();
  }

  // ---- signalling ------------------------------------------------------------

  reply(peer, display) {
    this.send(peer, { display: { v: 1, ...display } });
  }

  async onSignal(from, data, fromRole) {
    if (fromRole !== 'display' || !data) return;
    if (data.display) return this.onMessage(from, data.display);
    const l = this.links.get(from);
    if (!l) return; // (a TV that hasn't been let in gets no connection)
    if (data.kind === 'offer') return this.answer(from, data);
    if (data.kind === 'restart') return this.close(from, true);
    if (data.kind === 'ice' && data.c) {
      if (this.localOnly?.() && !/ typ host( |$)/.test(data.c.candidate || '')) return;
      if (l.remoteSet) await l.pc.addIceCandidate(data.c).catch(() => {});
      else l.pendingIce.push(data.c);
    }
  }

  onMessage(peer, m) {
    if (m.v !== 1) return this.reply(peer, { t: 'reject', code: 'unsupported_version', message: 'Update the TV app or the studio: they speak different versions.' });
    if (m.t === 'hello') {
      const name = String(m.name || 'TV').slice(0, 40), model = String(m.model || '').slice(0, 40);
      if (m.key && this.keys.has(m.key)) {
        const k = this.keys.get(m.key);
        k.name = name;
        k.model = model;
        k.at = Date.now();
        this.save();
        return this.bind(peer, m.key);
      }
      this.waiting.set(peer, { name, model, at: Date.now() });
      this.reply(peer, { t: 'waiting' });
      this.note?.(`A TV is asking to show the program: ${name}`);
      return this.changed?.();
    }
    if (m.t === 'pair') {
      const p = this.pairing;
      if (!p || Date.now() > p.until) return this.reply(peer, { t: 'reject', code: 'code_expired', message: 'That code has run out. Ask the studio for a new one.' });
      if (String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '') !== p.code) {
        if (++p.tries >= TRIES) this.stopPairing();
        return this.reply(peer, { t: 'reject', code: 'wrong_code', message: 'That code isn’t right.' });
      }
      const w = this.waiting.get(peer) || { name: String(m.name || 'TV').slice(0, 40), model: String(m.model || '').slice(0, 40) };
      this.waiting.delete(peer);
      this.stopPairing();
      this.bind(peer, this.remember(w));
      return this.note?.(`TV screen added with a code: ${w.name}`);
    }
    if (m.t === 'state') {
      const l = this.links.get(peer);
      if (l) {
        l.state = { status: m.status, mode: m.mode, detail: m.detail };
        this.changed?.();
      }
    }
  }

  // ---- the connection -----------------------------------------------------------

  async answer(peer, data) {
    const l = this.links.get(peer);
    this.teardown(l);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    Object.assign(l, { pc, ctl: null, pendingIce: [], remoteSet: false, lastSeen: Date.now(), state: { status: 'connecting' } });
    pc.ondatachannel = (e) => {
      if (e.channel.label !== 'ctl') return;
      l.ctl = e.channel;
      e.channel.onopen = () => this.sendMode(peer);
      e.channel.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        l.lastSeen = Date.now();
        if (m.t === 'ping') this.ctl(peer, { t: 'pong', seq: m.seq });
        else if (m.t === 'state') {
          l.state = { status: m.status, mode: m.mode, detail: m.detail };
          this.changed?.();
        }
      };
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (this.localOnly?.() && !/ typ host( |$)/.test(e.candidate.candidate)) return;
      this.send(peer, { kind: 'ice', c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(peer)?.pc !== pc) return;
      if (pc.connectionState === 'connected') this.tune(pc);
      if (pc.connectionState === 'failed') l.state = { status: 'error', detail: 'ice_failed_same_network' };
      this.changed?.();
    };
    await pc.setRemoteDescription(data.sdp);
    l.remoteSet = true;
    for (const c of l.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    // The TV asked to receive a picture and sound: those transceivers send from here.
    l.tracks = this.program?.() || [];
    for (const tr of pc.getTransceivers()) {
      const kind = tr.receiver.track?.kind;
      tr.direction = 'sendonly';
      if (kind === 'video') {
        // H.264 first: the Apple TV decodes it in hardware.
        try {
          const caps = RTCRtpReceiver.getCapabilities?.('video')?.codecs || [];
          const h264 = caps.filter((c) => /h264/i.test(c.mimeType));
          if (h264.length) tr.setCodecPreferences([...h264, ...caps.filter((c) => !/h264/i.test(c.mimeType))]);
        } catch {}
      }
      const track = l.tracks.find((t) => t.kind === kind) || null;
      await tr.sender.replaceTrack(this.modeOf(l) === 'program' ? track : null).catch(() => {});
    }
    await pc.setLocalDescription(await pc.createAnswer());
    this.send(peer, { kind: 'answer', sdp: pc.localDescription.toJSON() });
    this.changed?.();
  }

  async tune(pc) {
    for (const s of pc.getSenders()) {
      if (s.track?.kind !== 'video') continue;
      try {
        const p = s.getParameters();
        p.encodings = p.encodings?.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = PROGRAM_KBPS * 1000;
        p.encodings[0].maxFramerate = 30;
        await s.setParameters(p);
      } catch {}
    }
  }

  modeOf(l) {
    return this.keys.get(l?.key)?.mode || 'program';
  }

  ctl(peer, obj) {
    const c = this.links.get(peer)?.ctl;
    if (c?.readyState === 'open') {
      try { c.send(JSON.stringify(obj)); } catch {}
    }
  }

  sendMode(peer) {
    const l = this.links.get(peer);
    if (!l) return;
    const mode = this.modeOf(l);
    this.ctl(peer, { t: 'mode', mode, params: {} });
    this.ctl(peer, { t: 'meta', source: 'live', title: this.title?.() || '' });
  }

  /** Program or idle, for every connection this TV has (remembered for next time). */
  async setMode(key, mode) {
    if (!DISPLAY_MODES.includes(mode) || !this.keys.has(key)) return;
    this.keys.get(key).mode = mode;
    this.save();
    for (const [peer, l] of this.links) {
      if (l.key !== key || !l.pc) continue;
      for (const tr of l.pc.getTransceivers()) {
        const kind = tr.sender.track?.kind || tr.receiver.track?.kind;
        const track = l.tracks.find((t) => t.kind === kind) || null;
        await tr.sender.replaceTrack(mode === 'program' ? track : null).catch(() => {});
      }
      this.sendMode(peer);
    }
    this.changed?.();
  }

  /** New program tracks (the sound started after a TV joined, say): swap them in. */
  async refreshTracks() {
    for (const [, l] of this.links) {
      if (!l.pc) continue;
      for (const t of l.tracks) t.stop?.();
      l.tracks = this.program?.() || [];
      const on = this.modeOf(l) === 'program';
      for (const tr of l.pc.getTransceivers()) {
        const kind = tr.sender.track?.kind || tr.receiver.track?.kind;
        await tr.sender.replaceTrack(on ? l.tracks.find((t) => t.kind === kind) || null : null).catch(() => {});
      }
    }
  }

  teardown(l) {
    if (!l) return;
    try { l.ctl?.close(); } catch {}
    try { l.pc?.close(); } catch {}
    for (const t of l.tracks || []) t.stop?.();
    l.pc = null;
    l.ctl = null;
    l.tracks = [];
  }

  /** @param keepBinding the TV is rebuilding its connection (restart): keep it let in */
  close(peer, keepBinding = false) {
    const l = this.links.get(peer);
    this.teardown(l);
    if (!keepBinding) this.links.delete(peer);
    this.changed?.();
  }

  syncPeers(peers) {
    const here = new Set(peers.map((p) => p.peer));
    for (const peer of [...this.links.keys()]) if (!here.has(peer)) this.close(peer);
    for (const peer of [...this.waiting.keys()]) if (!here.has(peer)) this.waiting.delete(peer);
    this.changed?.();
  }

  sweep() {
    // A TV that stopped pinging for 20 s is gone (asleep, unplugged); its key stays.
    const now = Date.now();
    for (const [peer, l] of [...this.links]) if (l.ctl && now - l.lastSeen > 20000) this.close(peer, true);
  }

  /** For the TV screens panel. */
  list() {
    const out = [];
    for (const [key, k] of this.keys) {
      const link = [...this.links.values()].find((l) => l.key === key);
      out.push({ key, name: k.name, model: k.model, mode: k.mode || 'program', connected: link?.pc?.connectionState === 'connected', status: link ? link.state?.status || 'joining' : 'away', detail: link?.state?.detail || '' });
    }
    return { paired: out, waiting: [...this.waiting].map(([peer, w]) => ({ peer, ...w })) };
  }
}
