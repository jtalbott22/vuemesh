// The studio's side of a TV screen (the "display" role): the Apple TV app, or /tv in any browser.
// See docs/APPLE-TV.md for the whole protocol.
//
// A TV joins the event with its code, like a phone, but knowing the code (it's on every beacon)
// doesn't let it show anything: the studio lets it in with Accept in TV screens. Then the TV gets
// its own key, remembered on both sides, so it comes back on its own after a reload.
//
// Messages go through the event's signalling only between the studio and the TV, inside
// data.display ({t: 'hello' | 'state'} up; {t: 'waiting' | 'paired' | 'reject'} down).
// Then the TV offers a receive-only connection (the usual offer / answer / ice), the studio puts
// the program's picture and sound on it, and everything else (mode, ping) rides its "ctl" channel
// over the local network. Nothing but the handshake touches the cloud.
//
// What a TV shows (its mode, chosen here or on the TV itself):
//   program  the live program, picture and sound
//   browse   the event's recordings: the TV asks for the list, then pulls the one it wants over
//            its "media" data channel (the same peer-to-peer beam phones send clips on), and plays
//            it itself. PIP: the live program, small, in a corner (picture only)
//   beacon   the sync beacon, drawn by the TV on the studio's clock (learnt from ctl pings) and led
//            by the TV's own display lag, so phones synced to it line up with this computer.
//            PIP as in browse
//   idle     the event card

import { ICE, now } from '/js/vm.js';
import { pathOf } from '/js/rtc.js';
import { bgInterval } from '/js/bgclock.js';
import { tvLink, adapt } from '/js/tvquality.js';

const newKey = () => {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const PROGRAM_KBPS = 6000; // 1080p30 program on the local network
const REMOTE_KBPS = 1200; // the phone remote's Program out: half size, enough to see the cut
export const DISPLAY_MODES = ['program', 'browse', 'beacon', 'idle'];
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const FILE_CHUNK = 64 * 1024, FILE_HIGH = 4 * 1024 * 1024;

export class DisplayHub {
  /**
   * @param o.eventId
   * @param o.title () → the event's name, for the TV's screen
   * @param o.send (peer, data) → the studio's signal to one connection
   * @param o.program () → MediaStreamTrack[] for one TV: the program picture (a copy) and its sound
   * @param o.changed () → the list changed (redraw TV screens)
   * @param o.note (text) → a line in the studio's event log
   * @param o.localOnly? () → true: keep only local-network candidates
   * @param o.media? () → [{id, name, kind, mime, dur, t0, size}] the recordings a TV can browse
   * @param o.blob? (id) → Blob of one recording
   * @param o.thumb? (id) → a data URL of its picture, or null
   * @param o.fps? () → the program's frame rate (Output settings)
   */
  constructor(o) {
    Object.assign(this, o);
    this.store = `vm_displays_${o.eventId}`;
    this.keys = new Map(); // key → { name, model, mode, at }
    try {
      for (const r of JSON.parse(localStorage.getItem(this.store) || '[]')) this.keys.set(r.key, { name: r.name, model: r.model, mode: DISPLAY_MODES.includes(r.mode) ? r.mode : 'program', pip: !!r.pip, lag: Number.isFinite(r.lag) ? r.lag : null, at: r.at, ...(r.remote ? { remote: r.remote } : {}) });
    } catch {}
    this.waiting = new Map(); // peer → { name, model, at }
    this.links = new Map(); // peer → { key, pc, ctl, state, tracks, pendingIce, remoteSet, lastSeen }
    this.timer = bgInterval(() => this.sweep(), 5000); // (the worker clock: kept while the studio is hidden)
  }

  save() {
    try {
      localStorage.setItem(this.store, JSON.stringify([...this.keys].map(([key, v]) => ({ key, ...v }))));
    } catch {}
  }

  // ---- letting a TV in ------------------------------------------------------------

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
    this.keys.set(key, { name: w.name || 'TV', model: w.model || '', mode: 'program', pip: false, lag: null, at: Date.now() });
    this.save();
    return key;
  }

  /** A phone remote's own screen (Program out on the remote): let in without Accept, as the remote already was. Same key for the same remote. */
  trustRemote(remoteKey, name) {
    for (const [key, k] of this.keys) if (k.remote === remoteKey) return key;
    const key = newKey();
    this.keys.set(key, { name: `${name || 'Phone remote'} (Program out)`, model: 'remote', mode: 'program', pip: false, lag: null, at: Date.now(), remote: remoteKey });
    this.save();
    return key;
  }
  /** A remote removed: its screen goes too. */
  untrustRemote(remoteKey) {
    for (const [key, k] of [...this.keys]) if (k.remote === remoteKey) this.remove(key);
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
      if (e.channel.label === 'media') {
        // (recordings for Browse go out on this one: the TV opened it, reliable and in order)
        l.media = e.channel;
        l.media.binaryType = 'arraybuffer';
        l.media.bufferedAmountLowThreshold = FILE_CHUNK * 8;
        return;
      }
      if (e.channel.label !== 'ctl') return;
      l.ctl = e.channel;
      e.channel.onopen = () => this.sendMode(peer);
      e.channel.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        l.lastSeen = Date.now();
        this.onCtl(peer, l, m);
      };
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (this.localOnly?.() && !/ typ host( |$)/.test(e.candidate.candidate)) return;
      this.send(peer, { kind: 'ice', c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (this.links.get(peer)?.pc !== pc) return;
      if (pc.connectionState === 'connected') this.tune(pc, l);
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
    }
    await this.applyTracks(l);
    await pc.setLocalDescription(await pc.createAnswer());
    this.send(peer, { kind: 'answer', sdp: pc.localDescription.toJSON() });
    this.changed?.();
  }

  /** The picture's limits for one TV: its bitrate (lowered when it falls behind), the program's frame rate, and half size for a phone remote. */
  async tune(pc, l) {
    const remote = !!this.keys.get(l?.key)?.remote;
    const fps = Math.round(this.fps?.() || 30);
    l && (l.q ||= tvLink(remote ? REMOTE_KBPS : PROGRAM_KBPS));
    for (const s of pc.getSenders()) {
      if (s.track?.kind !== 'video') continue;
      try {
        const p = s.getParameters();
        p.encodings = p.encodings?.length ? p.encodings : [{}];
        p.encodings[0].maxBitrate = (l?.q?.cap || PROGRAM_KBPS) * 1000;
        p.encodings[0].maxFramerate = fps;
        if (remote) p.encodings[0].scaleResolutionDownBy = 2;
        await s.setParameters(p);
      } catch {}
    }
  }

  modeOf(l) {
    return this.keys.get(l?.key)?.mode || 'program';
  }

  /** The program's picture goes to a TV showing it, full screen or in its corner (PIP); its sound only full screen. */
  async applyTracks(l) {
    if (!l?.pc) return;
    const k = this.keys.get(l.key) || {}, mode = k.mode || 'program';
    const want = { video: mode === 'program' || (k.pip && (mode === 'browse' || mode === 'beacon')), audio: mode === 'program' }; // (a phone remote too: its sound starts off there, so it can't echo into the room until someone turns it on)
    for (const tr of l.pc.getTransceivers()) {
      const kind = tr.sender.track?.kind || tr.receiver.track?.kind;
      if (!kind) continue;
      await tr.sender.replaceTrack(want[kind] ? l.tracks.find((t) => t.kind === kind) || null : null).catch(() => {});
    }
  }

  /** What a TV says on its ctl channel. */
  onCtl(peer, l, m) {
    if (m.t === 'ping') return this.ctl(peer, { t: 'pong', seq: m.seq, at: m.at, now: now() }); // (the TV learns this computer's clock from these)
    if (m.t === 'state') {
      l.state = { status: m.status, mode: m.mode, detail: m.detail };
      return this.changed?.();
    }
    // the TV asked for a mode, or PIP, from its own remote
    if (m.t === 'want') return this.setMode(l.key, DISPLAY_MODES.includes(m.mode) ? m.mode : this.modeOf(l), m.pip);
    // what the TV is getting, every few seconds: lower its bitrate if it's falling behind (tvquality.js)
    if (m.t === 'quality') {
      const q = { fps: num(m.fps), secs: num(m.secs) || 5, freezes: num(m.freezes) || 0, freezeMs: num(m.freezeMs) || 0, dropped: num(m.dropped) || 0, lost: num(m.lost) || 0, w: num(m.w), h: num(m.h), at: Date.now() };
      l.rx = q;
      l.q ||= tvLink(this.keys.get(l.key)?.remote ? REMOTE_KBPS : PROGRAM_KBPS);
      // (judged against what's being sent it, not the program's rate: a slow camera isn't the TV's fault)
      const r = adapt(l.q, q, l.sentFps || this.fps?.() || 30);
      const name = this.keys.get(l.key)?.name || 'A TV';
      if (q.freezes) this.note?.(`${name} froze ${q.freezes} time${q.freezes === 1 ? '' : 's'} (${Math.round(q.freezeMs)} ms) in the last ${q.secs} s`);
      if (r.changed) {
        this.note?.(r.changed === 'down' ? `${name} is falling behind (${q.fps ?? '?'} frames a second): its picture down to ${(r.cap / 1000).toFixed(1)} Mbps` : `${name} is steady: its picture back up to ${(r.cap / 1000).toFixed(1)} Mbps`);
        if (l.pc) this.tune(l.pc, l);
      }
      return;
    }
    if (m.t === 'list') return this.sendList(peer);
    if (m.t === 'get') return this.sendFile(peer, l, String(m.id || ''));
    if (m.t === 'cancel') l.sending = null;
  }

  /** The recordings a TV can browse: names, lengths, then each picture in a message of its own. */
  sendList(peer) {
    const items = (this.media?.() || []).map((x) => ({ id: x.id, name: x.name, kind: x.kind, mime: x.mime || '', dur: Math.round(x.dur || 0), t0: x.t0 || 0, size: x.size || 0 }));
    this.ctl(peer, { t: 'list', items });
    for (const x of items) {
      const th = this.thumb?.(x.id);
      if (th && th.length < 200000) this.ctl(peer, { t: 'thumb', id: x.id, data: th });
    }
  }

  /** One recording to a TV on its media channel: {t:'file'}, the bytes in 64 KB pieces, {t:'end'}. One at a time. */
  async sendFile(peer, l, id) {
    const dc = l.media, blob = this.blob?.(id);
    if (dc?.readyState !== 'open') return this.ctl(peer, { t: 'error', id, message: 'The TV’s media channel isn’t open' });
    if (!blob) return this.ctl(peer, { t: 'error', id, message: 'That recording isn’t on the studio computer' });
    const job = (l.sending = { id });
    dc.send(JSON.stringify({ t: 'file', id, size: blob.size, mime: blob.type || '' }));
    try {
      for (let off = 0; off < blob.size; off += 1 << 20) {
        const slab = await blob.slice(off, off + (1 << 20)).arrayBuffer();
        for (let i = 0; i < slab.byteLength; i += FILE_CHUNK) {
          if (l.sending !== job || dc.readyState !== 'open') return; // (cancelled, another asked for, or gone)
          if (dc.bufferedAmount > FILE_HIGH) {
            await new Promise((r) => {
              dc.addEventListener('bufferedamountlow', r, { once: true });
              dc.addEventListener('close', r, { once: true });
            });
          }
          dc.send(slab.slice(i, Math.min(i + FILE_CHUNK, slab.byteLength)));
        }
      }
      dc.send(JSON.stringify({ t: 'end', id }));
      this.note?.(`Sent a recording to a TV: ${(this.media?.() || []).find((x) => x.id === id)?.name || id}`);
    } catch {}
    if (l.sending === job) l.sending = null;
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
    const k = this.keys.get(l.key) || {};
    // (lag: how far ahead of this computer's clock the TV's beacon draws, its own display lag; null: not measured)
    this.ctl(peer, { t: 'mode', mode: this.modeOf(l), pip: !!k.pip, params: { lag: k.lag ?? null, event: this.eventId } });
    this.ctl(peer, { t: 'meta', source: 'live', title: this.title?.() || '' });
  }

  /** Program, browse, beacon or idle, and PIP, for every connection this TV has (remembered for next time). */
  async setMode(key, mode, pip) {
    const k = this.keys.get(key);
    if (!DISPLAY_MODES.includes(mode) || !k) return;
    k.mode = mode;
    if (pip !== undefined) k.pip = !!pip;
    this.save();
    for (const [peer, l] of this.links) {
      if (l.key !== key || !l.pc) continue;
      if (mode !== 'browse') l.sending = null;
      await this.applyTracks(l);
      this.sendMode(peer);
    }
    this.changed?.();
  }

  /** The TV's display lag, measured (Calibrate) or set by hand: its beacon draws this far ahead. */
  setLag(key, ms) {
    const k = this.keys.get(key);
    if (!k) return;
    k.lag = ms == null ? null : Math.max(0, Math.min(500, Math.round(ms)));
    this.save();
    for (const [peer, l] of this.links) if (l.key === key) this.sendMode(peer);
    this.changed?.();
  }

  /** New program tracks (the sound started after a TV joined, say): swap them in. */
  async refreshTracks() {
    for (const [, l] of this.links) {
      if (!l.pc) continue;
      for (const t of l.tracks) t.stop?.();
      l.tracks = this.program?.() || [];
      await this.applyTracks(l);
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

  /** What each connected TV is being sent (for Monitor's Transfers): rate, codec, size, route. */
  async stats() {
    const out = [];
    for (const [, l] of this.links) {
      if (!l.pc) continue;
      const r = { name: this.keys.get(l.key)?.name || 'TV', mode: this.modeOf(l), pip: !!this.keys.get(l.key)?.pip, remote: !!this.keys.get(l.key)?.remote, sending: l.sending?.id || null, status: l.pc.connectionState, kbps: null, codec: null, w: null, h: null, fps: null, lim: null, route: null, cap: l.q?.cap || null, rx: l.rx && Date.now() - l.rx.at < 15000 ? { fps: l.rx.fps, freezes: l.rx.freezes, dropped: l.rx.dropped, lost: l.rx.lost, w: l.rx.w, h: l.rx.h } : null };
      try {
        const st = await l.pc.getStats(), now = performance.now();
        let bytes = 0;
        st.forEach((x) => {
          if (x.type === 'data-channel' && x.label === 'media') bytes += x.bytesSent || 0; // (a recording going over to Browse)
          if (x.type !== 'outbound-rtp') return;
          bytes += x.bytesSent || 0;
          if (x.kind === 'video') {
            r.w = x.frameWidth || null;
            r.h = x.frameHeight || null;
            r.fps = x.framesPerSecond != null ? Math.round(x.framesPerSecond) : null;
            if (r.fps) l.sentFps = r.fps;
            r.lim = x.qualityLimitationReason && x.qualityLimitationReason !== 'none' ? x.qualityLimitationReason : null; // (cpu, bandwidth)
            const c = x.codecId && st.get(x.codecId);
            if (c) r.codec = c.mimeType?.split('/')[1] || null;
          }
        });
        if (l.lastOut) r.kbps = Math.max(0, Math.round(((bytes - l.lastOut.bytes) * 8) / (now - l.lastOut.at)));
        l.lastOut = { bytes, at: now };
        if (r.status === 'connected') r.route = (await pathOf(l.pc)).route;
      } catch {}
      out.push(r);
    }
    return out;
  }

  /** For the TV screens panel. */
  list() {
    const out = [];
    for (const [key, k] of this.keys) {
      if (k.remote) continue; // (a phone remote's Program out isn't a TV screen)
      const link = [...this.links.values()].find((l) => l.key === key);
      out.push({ key, name: k.name, model: k.model, mode: k.mode || 'program', pip: !!k.pip, lag: k.lag ?? null, connected: link?.pc?.connectionState === 'connected', status: link ? link.state?.status || 'joining' : 'away', detail: link?.state?.detail || '' });
    }
    return { paired: out, waiting: [...this.waiting].map(([peer, w]) => ({ peer, ...w })) };
  }
}
