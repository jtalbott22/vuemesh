// Peer-to-peer over the local network.
// Phones (CamLink) offer a connection to the host laptop (HostHub) through the
// signaling socket. Once connected, everything rides the LAN:
//   - a low-res live preview of the camera (for live cutting)
//   - finished clips, sent in 8 MB hashed parts over a data channel, verified
//     and signed-off on arrival
// Nothing but the handshake touches the cloud.

import { bitrateHints, LINK_MAX_KBPS, opusStereo, qualityFor, screenCodecs, sendStats } from '/js/quality.js';
import { ICE, sha256hex, hexConcat, thumbprint, verifyStatement } from '/js/vm.js';

export const PART_SIZE = 8 * 1024 * 1024;
const CHUNK = 64 * 1024;
const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1024 * 1024;

/** Paces a transfer to rate() bytes a second (Infinity: as fast as the channel takes it). */
function pacer(rate) {
  let t0 = performance.now(), sent = 0, lastRate = null, sinceBreath = 0;
  return async (bytes) => {
    const r = rate?.() ?? Infinity;
    if (r !== lastRate) {
      t0 = performance.now();
      sent = 0;
      lastRate = r;
    }
    sent += bytes;
    sinceBreath += bytes;
    // even at full speed, let the page breathe every half megabyte (the studio's picture,
    // sound and controls run on the same thread as the sending)
    if (sinceBreath >= 512 * 1024) {
      sinceBreath = 0;
      await new Promise((res) => setTimeout(res, 0));
    }
    if (!Number.isFinite(r) || r <= 0) return;
    const wait = t0 + (sent / r) * 1000 - performance.now();
    if (wait > 4) await new Promise((res) => setTimeout(res, Math.min(wait, 2000)));
  };
}

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.|fe80:|fc|fd)/i;
const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./; // carrier networks (cellular)
const isLocalAddr = (a) => !a || a.endsWith('.local') || PRIVATE.test(a);

/**
 * How a connection is really routed, judged by addresses as well as candidate types:
 *   lan      direct over the local network (includes peer-reflexive local addresses)
 *   nat      same network, but through the router's public address (hairpin)
 *   cellular the phone is on mobile data
 *   internet the phone is on another network
 *   relay    through a relay server
 */
export async function pathOf(pc) {
  try {
    const stats = await pc.getStats();
    let pairId;
    const locals = [];
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      if (s.type === 'local-candidate') locals.push(s);
    });
    let pair;
    stats.forEach((s) => {
      if ((pairId && s.id === pairId) || (!pairId && s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded')) pair = s;
    });
    const local = pair && stats.get(pair.localCandidateId);
    const remote = pair && stats.get(pair.remoteCandidateId);
    if (!local || !remote) return { route: 'unknown' };
    const la = local.address || local.ip || '';
    const ra = remote.address || remote.ip || '';
    const detail = { route: 'internet', local: { type: local.candidateType, address: la, protocol: local.protocol }, remote: { type: remote.candidateType, address: ra, protocol: remote.protocol } };
    const v6net = (a) => (a.includes(':') ? a.split(':').slice(0, 4).join(':') : null);
    const lt = local.candidateType, rt = remote.candidateType;
    if (lt === 'relay' || rt === 'relay') detail.route = 'relay';
    // A direct host-to-host pair is on the same network by definition (IPv6 home
    // addresses aren't "private", so don't judge those by address).
    else if (lt === 'host' && rt === 'host') detail.route = 'lan';
    // Peer-reflexive: an address learned during the handshake. Local if it's a private
    // address or in the same IPv6 network as ours.
    else if (lt !== 'srflx' && rt !== 'srflx' && ((isLocalAddr(la) && isLocalAddr(ra)) || (v6net(la) && v6net(la) === v6net(ra)))) detail.route = 'lan';
    else if (CGNAT.test(ra)) detail.route = 'cellular';
    else {
      const mine = locals.filter((c) => c.candidateType === 'srflx').map((c) => c.address || c.ip);
      detail.route = mine.includes(ra) ? 'nat' : 'internet';
    }
    return detail;
  } catch {
    return { route: 'unknown' };
  }
}

export async function routeOf(pc) {
  return (await pathOf(pc)).route;
}

/** How much sound the studio keeps in hand from each phone or computer, ms (see accept). */
export const JITTER_MS = 150;

/** Keep only local-network candidates (for "local only" mode). */
const isHostCandidate = (c) => / typ host( |$)/.test(typeof c === 'string' ? c : c?.candidate || '');
function localOnlySdp(sdp) {
  return { type: sdp.type, sdp: sdp.sdp.split('\r\n').filter((l) => !l.startsWith('a=candidate:') || isHostCandidate(l)).join('\r\n') };
}

/** Hash a finished recording into parts, compute its fingerprint and sign it off. */
export async function sealClip(blob, { eventId, clipId, termsHash, signingKey, sign }) {
  const parts = [];
  for (let off = 0, n = 1; off < blob.size || n === 1; off += PART_SIZE, n++) {
    const piece = blob.slice(off, off + PART_SIZE);
    parts.push({ n, size: piece.size, sha: await sha256hex(await piece.arrayBuffer()) });
    if (off + PART_SIZE >= blob.size) break;
  }
  const root = await sha256hex(hexConcat(parts.map((p) => p.sha)));
  const sig = await sign(signingKey, ['vuemesh-signoff-v1', eventId, clipId, root, termsHash]);
  return { parts, root, sig };
}

// ---------------------------------------------------------------- phone side --

const ANSWER_MS = 10000; // (how long a phone waits for the studio to answer before asking again)

export class CamLink {
  /**
   * @param {object} o
   * @param {object} o.sock        meshSocket
   * @param {() => MediaStream} o.stream
   * @param {(state:string)=>void} o.onState   'no-host' | 'connecting' | 'lan' | 'internet' | 'relay'
   * @param {(clip:object, sent:number, total:number)=>void} o.onProgress
   * @param {(clip:object)=>void} o.onSent
   */
  constructor(o) {
    Object.assign(this, o);
    this.host = null;
    this.pc = null;
    this.dc = null;
    this.queue = [];
    this.sending = false;
    this.acks = new Map();
  }

  setPeers(peers) {
    if (this.left) return;
    const host = peers.find((p) => p.role === 'host');
    if (!host) {
      // The studio's server connection dropped for a moment (it reconnects, and AWS cuts every
      // connection at two hours). The picture and sound go straight to the studio, not through the
      // server, so a link that's still connected stays; if it fails while the studio's away, retry() lets it go.
      if (this.pc?.connectionState === 'connected') return;
      if (this.host) this.close();
      this.host = null;
      this.onState('no-host');
      return;
    }
    const dead = !this.pc || ['failed', 'closed'].includes(this.pc.connectionState);
    if (host.peer !== this.host || dead) {
      this.host = host.peer;
      this.connect();
    }
  }

  close() {
    clearInterval(this.qTimer);
    clearTimeout(this.answerTimer);
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.pc = null;
    this.dc = null;
    this.retireOld();
  }

  /** The link being replaced (kept while its replacement is arranged over it): closed now. */
  retireOld() {
    const o = this.old;
    this.old = null;
    if (!o) return;
    try { o.pc.close(); } catch {}
  }

  /** The replacement didn't come up, and the old link still works: carry on with that. */
  fallBack() {
    const o = this.old;
    if (!o || o.pc.connectionState !== 'connected' || o.dc.readyState !== 'open') return false;
    this.old = null;
    clearTimeout(this.answerTimer);
    try { this.pc?.close(); } catch {}
    Object.assign(this, { pc: o.pc, dc: o.dc, ctl: o.ctl, remoteSet: true, pendingIce: [] });
    this.startQuality(o.pc);
    this.onState(this.route || 'lan');
    return true;
  }

  /** The studio asked for a fresh link (a stuck picture, a network setting changed). */
  restart() {
    if (this.old || Date.now() - (this.restartAt || 0) < 5000) return; // (asked both ways at once: once is enough)
    this.restartAt = Date.now();
    this.connect({ over: true });
  }

  /** A handshake message to the studio: over the old link while it's being replaced, or the QR-made one (no server needed), else through the server. */
  sig(data) {
    for (const via of [this.old?.dc, this.boot]) {
      if (via?.readyState !== 'open') continue;
      try {
        via.send(JSON.stringify({ t: 'sig', d: data }));
        return;
      } catch {}
    }
    this.sock.signal(this.host, data);
  }

  /**
   * Joined by QR code, with no server (qrjoin.js): the usual link is arranged over that small one.
   * @param {{pc: RTCPeerConnection, dc: RTCDataChannel}} boot  @param host the studio's id  @param who {role, name, cid}
   */
  useBoot(boot, host, who) {
    this.closeBoot();
    this.bootLink = boot;
    this.boot = boot.dc;
    this.host = host;
    this.left = false;
    boot.dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'sig') this.onSignal(this.host, m.d || {});
    };
    boot.dc.onclose = () => this.bootLink === boot && (this.boot = null);
    boot.dc.send(JSON.stringify({ t: 'who', peer: this.sock.peer, role: who.role, name: who.name, cid: who.cid }));
    this.connect();
  }

  closeBoot() {
    try { this.bootLink?.pc.close(); } catch {}
    this.bootLink = this.boot = null;
  }

  /** @param {{over?: boolean}} o  over: arrange the new link over the one that's working, keeping it until the new one's up */
  async connect(o = {}) {
    const keep = o.over && this.pc?.connectionState === 'connected' && this.dc?.readyState === 'open' ? { pc: this.pc, dc: this.dc, ctl: this.ctl } : null;
    if (keep) {
      clearInterval(this.qTimer);
      this.pc = this.dc = null;
    }
    this.close();
    this.old = keep;
    this.onState('connecting');
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    this.remoteSet = false;
    this.pendingIce = [];
    const stream = this.stream();
    for (const track of stream.getTracks()) {
      const init = { direction: 'sendonly', streams: [stream] };
      // The live picture's quality follows what this camera is doing in the show (on air, in
      // preview, or neither; see quality.js); the phone keeps its full-quality recording regardless.
      if (track.kind === 'video') {
        const [kbps, scale] = qualityFor(this.tier || 'idle', this.route || 'unknown', this.first);
        init.sendEncodings = [{ maxBitrate: kbps * 1000, scaleResolutionDownBy: scale, maxFramerate: 30 }];
      }
      const tr = pc.addTransceiver(track, init);
      // a shared screen: H.264 first where both ends have it (see screenCodecs)
      if (this.screen && track.kind === 'video') {
        try {
          const caps = RTCRtpReceiver.getCapabilities?.('video')?.codecs;
          if (caps?.length && tr.setCodecPreferences) tr.setCodecPreferences(screenCodecs(caps));
        } catch {}
      }
    }
    if (this.paused) {
      // Rejoining while paused: nothing leaves the phone until resumed.
      for (const sender of pc.getSenders()) {
        sender.__track = sender.track;
        sender.replaceTrack(null).catch(() => {});
      }
    }
    // Live control messages (quality, orientation, tally) ride their own lossy channel,
    // so they never wait behind a clip transfer.
    const ctl = pc.createDataChannel('ctl', { ordered: false, maxRetransmits: 0 });
    ctl.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      // (on air, the studio says whether it's on Quality first: the cap on air follows, see qualityFor)
      if (m?.t === 'tally') this.setFirst(!!(m.on && m.first));
      try { this.onControl?.(m); } catch {}
    };
    this.ctl = ctl;
    const dc = pc.createDataChannel('clips', { ordered: true });
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LOW_WATER;
    dc.onopen = () => {
      this.pump();
      this.sendTelemetry();
    };
    dc.onmessage = (e) => {
      if (typeof e.data !== 'string') return this.onHostBinary?.(e.data); // a file from the host
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'sig') return this.onSignal(this.host, m.d); // (a new link being arranged over this one)
      if (m.t === 'restart') return this.restart();
      if (m.t === 'ack') this.acks.get(m.id)?.(m);
      else this.onHostMessage?.(m); // director messages, rundown, cues, output shape
    };
    this.dc = dc;
    pc.onicecandidate = (e) => e.candidate && this.sig({ kind: 'ice', c: e.candidate.toJSON() });
    pc.onconnectionstatechange = async () => {
      if (pc !== this.pc) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        this.retireOld(); // (the new link is up: the one it replaced can go)
        if (this.bootLink) setTimeout(() => pc === this.pc && pc.connectionState === 'connected' && this.closeBoot(), 3000); // (and the QR-made one, its job done)
        this.onState(await routeOf(pc));
        this.startQuality(pc);
        if (this.paused) this.setPaused(true);
      }
      if (s === 'failed') setTimeout(() => pc === this.pc && this.retry('failed'), 2000);
      if (s === 'disconnected') setTimeout(() => pc === this.pc && pc.connectionState === 'disconnected' && this.retry('disconnected'), 6000);
    };
    const offer = await pc.createOffer();
    // (a shared screen's sound is stereo: say so; the studio answers that it takes it)
    if (this.screen) offer.sdp = opusStereo(offer.sdp);
    await pc.setLocalDescription(offer);
    if (pc !== this.pc) return;
    this.sig({ kind: 'offer', sdp: pc.localDescription.toJSON() });
    // (no answer: the offer was lost on the way, say while the studio was reconnecting. Ask again,
    // rather than wait for an answer that never comes)
    clearTimeout(this.answerTimer);
    this.answerTimer = setTimeout(() => pc === this.pc && !this.remoteSet && this.retry(), ANSWER_MS);
  }

  /** The link failed (or was never answered): connect again if the studio's here, else wait for it. */
  retry(why) {
    if (this.left) return;
    if (this.fallBack()) return; // (a replacement that didn't come up: the old link carries on)
    // With no server there's nothing to connect again through. A link that's only disconnected
    // usually comes back by itself once the Wi-Fi does (within about 30 s): let it.
    if (why === 'disconnected' && !this.sock.connected) return;
    if (this.boot?.readyState === 'open') return this.connect(); // (the QR-made link's still there: try again over it)
    if (this.sock.connected && this.host && this.sock.peers?.some((p) => p.peer === this.host)) return this.connect();
    this.close();
    this.host = null;
    this.onState('no-host');
  }

  /** Send a small live message to the host (dropped if the link isn't up). */
  control(obj) {
    if (this.ctl?.readyState === 'open') {
      try { this.ctl.send(JSON.stringify(obj)); } catch {}
    }
  }

  async onSignal(from, data) {
    if (from !== this.host || !this.pc) return;
    if (data.kind === 'restart') return this.restart();
    if (data.kind === 'answer') {
      // (start near a good picture, not at a few hundred kbit/s; the tier then sets the ceiling)
      const sdp = data.sdp && typeof data.sdp.sdp === 'string' ? { type: data.sdp.type, sdp: bitrateHints(data.sdp.sdp, { start: 2500, min: 250, max: LINK_MAX_KBPS }) } : data.sdp;
      await this.pc.setRemoteDescription(sdp);
      this.remoteSet = true;
      for (const c of this.pendingIce.splice(0)) await this.pc.addIceCandidate(c).catch(() => {});
    } else if (data.kind === 'ice' && data.c) {
      if (this.remoteSet) await this.pc.addIceCandidate(data.c).catch(() => {});
      else this.pendingIce.push(data.c);
    }
  }

  /** Tell the host about this phone (battery, storage, camera, queue) every few seconds. */
  /** What this camera is doing in the show (program, preview, idle): its live picture follows. */
  setTier(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    this.ceiling = null; // (a fresh start at this tier's target; the link check steps it down if it must)
    this.applyQuality();
  }

  /** The studio's Quality first, while on air (see qualityFor). */
  setFirst(first) {
    if (first === !!this.first) return;
    this.first = first;
    this.ceiling = null;
    this.applyQuality();
  }

  target() {
    return qualityFor(this.tier || 'idle', this.route || 'unknown', this.first);
  }

  async applyQuality() {
    const sender = this.pc?.getSenders().find((x) => x.track?.kind === 'video' || x.__track?.kind === 'video');
    if (!sender) return;
    const [kbps, scale] = this.target();
    const cap = Math.min(kbps, this.ceiling || kbps);
    try {
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      const pri = this.tier === 'program' ? 'high' : this.tier === 'preview' ? 'medium' : 'low';
      Object.assign(p.encodings[0], { maxBitrate: cap * 1000, scaleResolutionDownBy: scale, maxFramerate: 30, priority: pri, networkPriority: pri });
      // (on air: keep the picture's size, let the frame rate give a little first; otherwise balance;
      // a shared screen of slides and text keeps its size: they go unreadable long before they
      // stutter; a screen of video or motion keeps its frame rate, and its size gives way first)
      p.degradationPreference = this.screen ? (this.motion ? 'maintain-framerate' : 'maintain-resolution') : this.tier === 'program' ? 'maintain-resolution' : 'balanced';
      await sender.setParameters(p);
      this.applied = { kbps: cap, scale };
    } catch {}
  }

  /**
   * Every two seconds: how the link is doing. Loss, or the browser saying bandwidth is holding the
   * picture back with less available than asked for, steps the ceiling down a quarter; ten clean
   * seconds step it back up towards the target. (The browser's own congestion control works under
   * this ceiling; the ceiling keeps one camera from crowding the others on a busy network.)
   */
  startQuality(pc) {
    clearInterval(this.qTimer);
    let tick = 0, goodSince = performance.now();
    const check = async () => {
      if (pc !== this.pc) return clearInterval(this.qTimer);
      if (tick++ % 5 === 0) {
        const route = (await pathOf(pc)).route;
        if (route && route !== this.route) {
          this.route = route;
          this.ceiling = null;
          await this.applyQuality();
        }
      }
      const s = await sendStats(pc, this.sendLast);
      this.sendLast = s;
      const [target] = this.target(), cap = this.ceiling || target, now = performance.now();
      const congested = (s.lossPct ?? 0) > 5 || (s.limit === 'bandwidth' && s.availKbps && s.availKbps < cap * 0.7);
      if (congested) {
        this.ceiling = Math.max(300, Math.round(cap * 0.75));
        goodSince = now;
        await this.applyQuality();
      } else if (cap < target && (s.lossPct ?? 0) < 1 && s.limit !== 'bandwidth' && now - goodSince > 10000) {
        this.ceiling = Math.min(target, Math.round(cap * 1.25));
        goodSince = now;
        await this.applyQuality();
      }
      this.linkStats = { tier: this.tier || 'idle', route: this.route || 'unknown', targetKbps: target, capKbps: this.ceiling || target, kbps: s.kbps ?? null,
        w: s.w, h: s.h, fps: s.fps, limit: s.limit, enc: s.enc, hw: s.hw, availKbps: s.availKbps ?? null, rttMs: s.rttMs ?? null, lossPct: s.lossPct ?? null };
    };
    this.qTimer = setInterval(check, 2000);
    this.applyQuality();
  }

  async sendTelemetry() {
    clearTimeout(this.teleTimer);
    const dc = this.dc;
    if (dc?.readyState === 'open' && !this.sending) {
      const info = { t: 'tele', at: Date.now() };
      try {
        const b = await navigator.getBattery?.();
        if (b) Object.assign(info, { battery: Math.round(b.level * 100), charging: b.charging });
      } catch {}
      try {
        const est = await navigator.storage?.estimate?.();
        if (est?.quota) info.freeMB = Math.round((est.quota - est.usage) / 1048576);
      } catch {}
      const v = this.stream().getVideoTracks()[0]?.getSettings?.() || {};
      Object.assign(info, {
        camW: v.width || null, camH: v.height || null, camFps: v.frameRate ? Math.round(v.frameRate) : null,
        queue: this.queue.length, queueMB: Math.round(this.queue.reduce((s, c) => s + c.blob.size, 0) / 1048576),
        platform: navigator.userAgentData?.platform || (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : navigator.platform || ''),
        browser: /CriOS|Chrome/.test(navigator.userAgent) ? 'Chrome' : /Safari/.test(navigator.userAgent) ? 'Safari' : /Firefox/.test(navigator.userAgent) ? 'Firefox' : 'Browser',
        ...(this.extraTelemetry?.() || {}),
        link: this.linkStats || null, // (the live picture: what it's set to, what it's doing, what's holding it back)
      });
      try { dc.send(JSON.stringify(info)); } catch {}
    }
    this.teleTimer = setTimeout(() => this.sendTelemetry(), 5000);
  }

  /** A message to the host that must arrive (replies, read receipts). */
  say(obj) {
    if (this.dc?.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(obj));
        return true;
      } catch {}
    }
    return false;
  }

  /**
   * Pause or resume sending the live picture and sound. The link stays up, so clips
   * still deliver and messages still arrive; the host just can't see or hear you.
   * @param why 'watch': paused to watch the program (the studio shows WATCHING)
   */
  async setPaused(on, why = this.pauseWhy || '') {
    this.paused = on;
    this.pauseWhy = on ? why : '';
    const stream = this.stream();
    for (const sender of this.pc?.getSenders() || []) {
      try {
        if (on) {
          if (sender.track) sender.__track = sender.track;
          await sender.replaceTrack(null);
        } else {
          const kind = sender.__track?.kind;
          const t = stream.getTracks().find((k) => k.kind === kind) || sender.__track;
          if (t) await sender.replaceTrack(t);
        }
      } catch {}
    }
    const m = { t: 'paused', on, ...(this.pauseWhy === 'watch' ? { watching: true } : {}) };
    this.control(m);
    this.say(m);
  }

  /** Leave the event: stop connecting until rejoin(). Clips stay queued on the phone. */
  leave() {
    this.left = true;
    this.close();
    this.host = null;
  }

  rejoin() {
    this.left = false;
  }

  replaceStream(stream) {
    if (!this.pc) return;
    for (const sender of this.pc.getSenders()) {
      const kind = sender.track?.kind || sender.__track?.kind;
      const t = stream.getTracks().find((k) => k.kind === kind);
      if (!t) continue;
      sender.__track = t;
      if (!this.paused) sender.replaceTrack(t).catch(() => {});
    }
  }

  enqueue(clip) {
    if (!this.queue.some((c) => c.id === clip.id)) this.queue.push(clip);
    this.pump();
  }

  /** Take a clip out of the queue (deleted on the phone, say). */
  dequeue(id) {
    this.queue = this.queue.filter((c) => c.id !== id);
  }

  async pump() {
    if (this.sending) return;
    this.sending = true;
    try {
      while (this.queue.length && this.dc?.readyState === 'open') {
        const clip = this.queue[0];
        try {
          await this.sendClip(clip);
          this.queue.shift();
          this.onSent(clip);
        } catch (e) {
          // Link dropped mid-send: keep the clip at the front and pick up when it's back.
          if (this.dc?.readyState !== 'open') throw e;
          // The host refused it or never confirmed it: set it aside (the app retries it
          // later, or the person does) so one bad clip never holds up the ones behind it.
          this.queue.shift();
          this.onFailed?.(clip, e.message);
        }
      }
    } catch (e) {
      console.warn('clip send interrupted; will resume when the host is back', e);
    } finally {
      this.sending = false;
    }
  }

  async sendClip(clip) {
    const dc = this.dc;
    const acked = new Promise((resolve) => this.acks.set(clip.id, resolve));
    dc.send(JSON.stringify({ t: 'begin', clip: clip.meta }));
    const total = clip.blob.size;
    // paced by the phone: a trickle on air, the spare bandwidth when live, full speed otherwise
    const pace = pacer(() => this.uploadRate?.() ?? Infinity);
    let off = 0;
    while (off < total) {
      if (dc.readyState !== 'open') throw new Error('channel closed');
      const slab = await clip.blob.slice(off, Math.min(off + 1024 * 1024, total)).arrayBuffer();
      for (let i = 0; i < slab.byteLength; i += CHUNK) {
        if (dc.bufferedAmount > HIGH_WATER) await drained(dc);
        await pace(Math.min(CHUNK, slab.byteLength - i));
        if (dc.readyState !== 'open') throw new Error('channel closed');
        dc.send(slab.slice(i, Math.min(i + CHUNK, slab.byteLength)));
      }
      off += slab.byteLength;
      this.onProgress(clip, off, total);
    }
    dc.send(JSON.stringify({ t: 'end', id: clip.id }));
    // The host checks the clip (hashes and signature) before confirming. Give it time in
    // proportion to the size, but never wait forever: a lost confirmation used to stall the queue.
    const limit = 60000 + total / 20000;
    const timedOut = new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'The host didn’t confirm it in time' }), limit));
    const ack = await Promise.race([acked, closed(dc), timedOut]);
    this.acks.delete(clip.id);
    if (!ack?.ok) throw new Error(ack?.error || 'The host didn’t confirm the clip');
  }
}

function drained(dc) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('channel closed')); };
    const cleanup = () => { dc.removeEventListener('bufferedamountlow', ok); dc.removeEventListener('close', bad); };
    dc.addEventListener('bufferedamountlow', ok);
    dc.addEventListener('close', bad);
  });
}

function closed(dc) {
  return new Promise((resolve) => dc.addEventListener('close', () => resolve({ ok: false, error: 'channel closed' }), { once: true }));
}

// ----------------------------------------------------------------- host side --

const fromRoleOf = new Map();

export class HostHub {
  /**
   * @param {object} o
   * @param {string} o.eventId
   * @param {string} o.termsHash
   * @param {object} o.sock
   * @param {(peer:string, stream:MediaStream, info:object)=>void} o.onLive
   * @param {(peer:string)=>void} o.onLiveEnd
   * @param {(peer:string, route:string)=>void} o.onRoute
   * @param {(clip:object, blob:Blob)=>Promise<void>} o.onClip   verified clip arrived
   * @param {(peer:string, info:object)=>void} o.onProgress
   */
  constructor(o) {
    Object.assign(this, o);
    this.links = new Map();
    this.known = new Map(); // peer → { peer, role, name, cid }: phones that joined by QR code (not on the server's list)
    this.paths = new Map(); // peer → the channel of its QR-made link: the handshake's way while it lasts
  }

  /** A phone's QR-made link (qrjoin.js, no server): it says who it is, then arranges its usual link over it. */
  adoptBoot(pc, dc) {
    let peer = null;
    dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'who' && m.peer) {
        peer = String(m.peer).slice(0, 40);
        const role = m.role === 'mic' ? 'mic' : 'cam';
        this.known.set(peer, { peer, role, name: String(m.name || '').slice(0, 40), cid: String(m.cid || '').slice(0, 32), rec: false });
        fromRoleOf.set(peer, role);
        this.paths.set(peer, dc);
      } else if (m.t === 'sig' && peer) this.onSignal(peer, m.d || {}, fromRoleOf.get(peer), dc);
    };
    dc.onclose = () => {
      if (peer && this.paths.get(peer) === dc) this.paths.delete(peer);
      try { pc.close(); } catch {}
    };
  }

  syncPeers(peers) {
    for (const [peer, l] of [...this.links]) {
      if (peers.some((p) => p.peer === peer)) continue;
      // A phone's server connection can drop for a moment (it reconnects; AWS cuts each one at two
      // hours) while its picture and sound still come straight here: a link that's still connected
      // stays, and goes once it isn't (or its phone closes it) while the phone's still not back.
      if (l.pc.connectionState === 'connected' && l.ctl?.readyState !== 'closed') this.watchAway(peer, l);
      else this.drop(peer);
    }
  }

  /** @returns whether this phone is on the server's list (its server connection is up) */
  listed(peer) {
    return !!this.sock.peers?.some((p) => p.peer === peer);
  }

  watchAway(peer, l) {
    if (l.away) return;
    l.away = setInterval(() => {
      if (this.links.get(peer) !== l || this.listed(peer)) {
        clearInterval(l.away);
        l.away = null;
      } else if (l.pc.connectionState !== 'connected' || l.ctl?.readyState === 'closed') this.drop(peer);
    }, 2000);
  }

  /** @param why 'reconnect' when the phone is replacing its own link (it's coming straight back) */
  drop(peer, why) {
    const l = this.links.get(peer);
    if (!l) return;
    clearInterval(l.away);
    try { l.pc.close(); } catch {}
    try { l.prev?.pc.close(); } catch {}
    this.links.delete(peer);
    this.onLiveEnd(peer, why);
  }

  /** @param via the phone's old link, when the new one is being arranged over it (no server needed) */
  async onSignal(from, data, fromRole, via) {
    if (fromRole !== 'cam' && fromRole !== 'mic') return;
    fromRoleOf.set(from, fromRole);
    if (data.kind === 'offer') return this.accept(from, data, via);
    const l = this.links.get(from);
    if (!l || data.kind !== 'ice' || !data.c) return;
    if (this.localOnly?.() && !isHostCandidate(data.c)) return; // only local-network paths
    if (l.remoteSet) await l.pc.addIceCandidate(data.c).catch(() => {});
    else l.pendingIce.push(data.c);
  }

  async accept(peer, data, via) {
    // Arranged over the phone's old link, which still works: that one carries on (its picture in the
    // show) until the new one's up, and the handshake goes over it. Otherwise it goes now.
    const was = this.links.get(peer);
    const prev = via && was?.dc === via && was.pc.connectionState === 'connected' ? was : null;
    if (prev) clearInterval(prev.away);
    else this.drop(peer, 'reconnect');
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const link = { pc, pendingIce: [], remoteSet: false, stream: null, prev };
    this.links.set(peer, link);
    const sig = (d) => {
      const c = [link.prev?.dc, this.paths.get(peer)].find((x) => x?.readyState === 'open');
      if (c) {
        try {
          c.send(JSON.stringify({ t: 'sig', d }));
          return;
        } catch {}
      }
      this.sock.signal(peer, d);
    };
    // (the new link didn't come up: the old one is the phone's link again, as if nothing happened)
    const restore = () => {
      if (!current() || !link.prev) return false;
      this.links.set(peer, link.prev);
      link.prev = null;
      try { pc.close(); } catch {}
      return true;
    };
    if (prev) setTimeout(() => pc.connectionState !== 'connected' && restore(), 20000);
    // Every change to what this phone sends reaches the studio: the first track starts it
    // (onLive), and a track arriving later (sound after picture, say), ending, or swapped
    // calls onTracks, so the studio never keeps playing or listening to something stale.
    const current = () => this.links.get(peer) === link;
    const changed = () => current() && !link.prev && link.stream && this.onTracks?.(peer, link.stream);
    const announce = (stream) => {
      link.stream = stream;
      link.announced = true;
      stream.addEventListener?.('addtrack', changed);
      stream.addEventListener?.('removetrack', changed);
      this.onLive(peer, stream, fromRoleOf.get(peer));
    };
    pc.ontrack = (e) => {
      // (its sound keeps 150 ms in hand. When a phone or computer stalls for a moment and then sends
      // everything at once, the browser plays the backlog faster to catch up: a Mac's 2 s stall
      // sped up a video's sound on air. With more in hand, less is left over to hurry through.
      // The browser holds the picture back to match, which lines up with the studio's own
      // cameras' delay, about 110 ms.)
      if (e.track.kind === 'audio' && 'jitterBufferTarget' in e.receiver) {
        try { e.receiver.jitterBufferTarget = JITTER_MS; } catch {}
      }
      const stream = e.streams[0] || (link.stream ||= new MediaStream());
      if (!e.streams[0]) stream.addTrack(e.track);
      e.track.addEventListener('ended', changed);
      e.track.addEventListener('unmute', changed);
      if (link.prev) link.stream = stream; // (shown once the new link is up: the old one's picture carries on till then)
      else if (link.stream !== stream || !link.announced) announce(stream);
      else changed();
    };
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'ctl') {
        link.ctl = e.channel;
        // (the phone closed its link, and it isn't on the server's list: it has gone, not reconnecting)
        e.channel.onclose = () => current() && !this.listed(peer) && this.drop(peer);
        e.channel.onmessage = (m) => {
          try { this.onPhoneMessage?.(peer, JSON.parse(m.data)); } catch {}
        };
      } else this.receiveClips(peer, e.channel);
    };
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      if (this.localOnly?.() && !isHostCandidate(e.candidate)) return;
      sig({ kind: 'ice', c: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = async () => {
      if (this.links.get(peer)?.pc !== pc) return;
      if (pc.connectionState === 'connected' && link.prev) {
        // the new link is up: the old one goes, and the show takes the new picture (as a reconnect)
        const old = link.prev;
        link.prev = null;
        try { old.pc.close(); } catch {}
        this.onLiveEnd(peer, 'reconnect');
        if (link.stream) announce(link.stream);
      }
      if (pc.connectionState === 'connected') {
        this.onRoute(peer, await routeOf(pc));
        setTimeout(async () => this.links.get(peer)?.pc === pc && this.onRoute(peer, await routeOf(pc)), 3000); // the chosen path can change after a moment
      }
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && !restore()) this.drop(peer);
    };
    await pc.setRemoteDescription(this.localOnly?.() ? localOnlySdp(data.sdp) : data.sdp);
    link.remoteSet = true;
    for (const c of link.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    const made = await pc.createAnswer();
    // (a shared screen says its sound is stereo, sprop-stereo=1: answer that this side takes it, so
    // it's sent and decoded in stereo; phones don't say so, and stay as they were)
    if (/^a=fmtp:\d+ .*sprop-stereo=1/m.test(data.sdp?.sdp || '')) made.sdp = opusStereo(made.sdp);
    await pc.setLocalDescription(made);
    const answer = pc.localDescription.toJSON();
    sig({ kind: 'answer', sdp: this.localOnly?.() ? localOnlySdp(answer) : answer });
  }

  /** Send a small live message to one phone (tally light, say). */
  send(peer, obj) {
    const l = this.links.get(peer);
    const ctl = l?.ctl?.readyState === 'open' ? l.ctl : l?.prev?.ctl; // (while a new link's arranged, the old one)
    if (ctl?.readyState === 'open') {
      try { ctl.send(JSON.stringify(obj)); } catch {}
    }
  }

  /** Ask one phone to rebuild its link (a picture that's stuck). False if it isn't connected. */
  restart(peer) {
    if (!this.links.has(peer)) return false;
    // (over its own link, so it's arranged over that one with no server needed; through the server
    // too, for a phone on an older page: one that has both does it once)
    this.message(peer, { t: 'restart' });
    this.sock.signal(peer, { kind: 'restart' });
    return true;
  }

  /** How one phone's live picture is doing: bytes arriving and frames decoded so far. */
  async videoIn(peer) {
    const l = this.links.get(peer);
    if (!l) return null;
    const out = { state: l.pc.connectionState, bytes: 0, decoded: 0 };
    try {
      (await l.pc.getStats()).forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          out.bytes = r.bytesReceived || 0;
          out.decoded = r.framesDecoded || 0;
        }
      });
    } catch {}
    return out;
  }

  /** Ask every phone to reconnect (after the network setup changes). */
  restartAll() {
    for (const peer of this.links.keys()) this.restart(peer);
  }

  /** Network numbers for one phone's connection, for the monitor. */
  async stats(peer) {
    const l = this.links.get(peer);
    if (!l) return null;
    const path = await pathOf(l.pc);
    const out = { route: path.route, path };
    try {
      const st = await l.pc.getStats();
      const now = performance.now();
      st.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
          if (r.currentRoundTripTime != null) out.rttMs = Math.round(r.currentRoundTripTime * 1000);
          if (r.availableIncomingBitrate) out.availKbps = Math.round(r.availableIncomingBitrate / 1000);
        }
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          out.width = r.frameWidth; out.height = r.frameHeight; out.fps = r.framesPerSecond ? Math.round(r.framesPerSecond) : null;
          out.jitterMs = r.jitter != null ? Math.round(r.jitter * 1000) : null;
          const lost = r.packetsLost || 0, got = r.packetsReceived || 0;
          out.lossPct = got + lost ? Math.round((lost / (got + lost)) * 1000) / 10 : 0;
          out.framesDropped = r.framesDropped || 0;
          const codec = r.codecId && st.get(r.codecId);
          if (codec) out.codec = codec.mimeType?.split('/')[1];
          if (l.lastVideo) out.videoKbps = Math.round(((r.bytesReceived - l.lastVideo.bytes) * 8) / (now - l.lastVideo.at));
          l.lastVideo = { bytes: r.bytesReceived, at: now };
        }
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          if (l.lastAudio) out.audioKbps = Math.round(((r.bytesReceived - l.lastAudio.bytes) * 8) / (now - l.lastAudio.at));
          l.lastAudio = { bytes: r.bytesReceived, at: now };
          if (r.audioLevel != null) out.audioLevel = Math.round(r.audioLevel * 100);
          // the sound's own counters, as running totals (whoever asks works out what changed: the
          // show log and the monitor both ask): how much the browser played faster to catch up after
          // a rush, slower to stretch it, made up for sound that didn't arrive, and kept waiting
          const a = (out.audioIn ||= { jitterMs: 0, received: 0, removed: 0, inserted: 0, concealed: 0, bufS: 0, emitted: 0, rate: 48000 });
          if (r.jitter != null) a.jitterMs = Math.max(a.jitterMs, Math.round(r.jitter * 1000));
          a.received += r.totalSamplesReceived || 0;
          a.removed += r.removedSamplesForAcceleration || 0;
          a.inserted += r.insertedSamplesForDeceleration || 0;
          a.concealed += (r.concealedSamples || 0) - (r.silentConcealedSamples || 0); // (not a muted phone's silence)
          a.bufS += r.jitterBufferDelay || 0;
          a.emitted += r.jitterBufferEmittedCount || 0;
          const ac = r.codecId && st.get(r.codecId);
          if (ac?.clockRate) a.rate = ac.clockRate;
        }
      });
    } catch {}
    return out;
  }

  /**
   * Send a file to one phone over the reliable link (the direction clips don't use), with
   * the same flow control, and wait for the phone to confirm it saved it.
   */
  /**
   * Ask a phone whether it can take a file now. It answers ok, or not now and why
   * (recording, sending its own clips, short of space). A phone from before this was added
   * doesn't answer: after a few seconds, it's treated as ready.
   */
  offerFile(peer, head, size) {
    const link = this.links.get(peer);
    const dc = link?.dc;
    if (dc?.readyState !== 'open') return Promise.reject(new Error('not connected'));
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        link.fileOffers?.delete(head.id);
        resolve({ ok: true, unanswered: true });
      }, 4000);
      (link.fileOffers ||= new Map()).set(head.id, (m) => {
        clearTimeout(timer);
        link.fileOffers.delete(head.id);
        resolve(m);
      });
      dc.send(JSON.stringify({ t: 'file-offer', id: head.id, part: head.part, size }));
    });
  }

  /** opts.ask: check with the phone first; opts.rate(): bytes a second to hold to. */
  async sendFile(peer, head, blob, onProgress, opts = {}) {
    const link = this.links.get(peer);
    const dc = link?.dc;
    if (dc?.readyState !== 'open') throw new Error('not connected');
    if (opts.ask) {
      const a = await this.offerFile(peer, head, blob.size);
      if (!a.ok) throw Object.assign(new Error(a.why || 'busy'), { busy: true });
    }
    const pace = pacer(opts.rate);
    const confirmed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the phone didn’t confirm it')), 60000 + blob.size / 20000);
      (link.fileAcks ||= new Map()).set(head.id, (ok, why) => {
        clearTimeout(timer);
        link.fileAcks.delete(head.id);
        ok ? resolve() : reject(new Error(why ? `the phone ${why}` : 'the phone couldn’t save it'));
      });
    });
    dc.send(JSON.stringify({ t: 'file-begin', ...head, size: blob.size }));
    for (let off = 0; off < blob.size; off += 1 << 20) {
      if (dc.readyState !== 'open') throw new Error('channel closed');
      const slab = await blob.slice(off, off + (1 << 20)).arrayBuffer();
      for (let i = 0; i < slab.byteLength; i += CHUNK) {
        if (dc.bufferedAmount > HIGH_WATER) await drained(dc);
        await pace(Math.min(CHUNK, slab.byteLength - i));
        if (dc.readyState !== 'open') throw new Error('channel closed');
        dc.send(slab.slice(i, Math.min(i + CHUNK, slab.byteLength)));
      }
      onProgress?.(Math.min(blob.size, off + slab.byteLength), blob.size);
    }
    dc.send(JSON.stringify({ t: 'file-end', id: head.id }));
    return confirmed;
  }

  /** A message to one phone that must arrive (director messages, rundown, cues). */
  message(peer, obj) {
    const l = this.links.get(peer);
    const dc = l?.dc?.readyState === 'open' ? l.dc : l?.prev?.dc; // (while a new link's arranged, the old one)
    if (dc?.readyState === 'open') {
      try {
        dc.send(JSON.stringify(obj));
        return true;
      } catch {}
    }
    return false;
  }

  receiveClips(peer, dc) {
    dc.binaryType = 'arraybuffer';
    const link = this.links.get(peer);
    if (link) link.dc = dc;
    let rx = null;
    let chain = Promise.resolve();
    const reply = (m) => dc.readyState === 'open' && dc.send(JSON.stringify(m));

    const fail = (error) => {
      if (rx) reply({ t: 'ack', id: rx.meta.id, ok: false, error });
      rx = null;
    };

    const handle = async (msg) => {
      if (typeof msg === 'string') {
        const m = JSON.parse(msg);
        if (m.t === 'tele') {
          this.onTelemetry?.(peer, m);
          return;
        }
        // a new link being arranged over this one (no server needed)
        if (m.t === 'sig') return this.onSignal(peer, m.d || {}, fromRoleOf.get(peer), dc);
        if (m.t === 'file-ack') {
          this.links.get(peer)?.fileAcks?.get(m.id)?.(m.ok !== false, m.why);
          return;
        }
        if (m.t === 'file-answer') {
          this.links.get(peer)?.fileOffers?.get(m.id)?.(m);
          return;
        }
        if (m.t === 'reply' || m.t === 'seen' || m.t === 'paused' || m.t === 'leaving' || m.t === 'go') {
          this.onPhoneMessage?.(peer, m);
          return;
        }
        if (m.t === 'begin') {
          const meta = m.clip;
          if (!meta?.id || !Array.isArray(meta.parts) || !meta.parts.length) return;
          rx = { meta, part: 0, chunks: [], bytes: 0, got: 0, blobs: [], total: meta.parts.reduce((s, p) => s + p.size, 0) };
          this.onProgress(peer, { id: meta.id, name: meta.name, got: 0, total: rx.total });
        } else if (m.t === 'end' && rx && rx.meta.id === m.id) {
          await finish();
        }
        return;
      }
      if (!rx) return;
      let buf = msg;
      while (buf.byteLength && rx) {
        const want = rx.meta.parts[rx.part]?.size ?? 0;
        const take = Math.min(buf.byteLength, want - rx.bytes);
        if (take <= 0) return fail('More data than the clip declared');
        rx.chunks.push(take === buf.byteLength ? buf : buf.slice(0, take));
        rx.bytes += take;
        rx.got += take;
        buf = buf.slice(take);
        if (rx.bytes === want) {
          const blob = new Blob(rx.chunks);
          const sha = await sha256hex(await blob.arrayBuffer());
          if (sha !== rx.meta.parts[rx.part].sha) return fail(`Part ${rx.part + 1} was damaged in transit`);
          rx.blobs.push(blob);
          rx.chunks = [];
          rx.bytes = 0;
          rx.part++;
        }
      }
      if (rx) this.onProgress(peer, { id: rx.meta.id, name: rx.meta.name, got: rx.got, total: rx.total });
    };

    const finish = async () => {
      const meta = rx.meta;
      if (rx.part !== meta.parts.length) return fail('Clip ended early');
      const root = await sha256hex(hexConcat(meta.parts.map((p) => p.sha)));
      if (root !== meta.root) return fail('Clip fingerprint does not match');
      if ((await thumbprint(meta.jwk)) !== meta.cid) return fail('Contributor key mismatch');
      const joined = await verifyStatement(meta.jwk, meta.joinSig, ['vuemesh-join-v1', this.eventId, this.termsHash, meta.name]);
      const signed = await verifyStatement(meta.jwk, meta.sig, ['vuemesh-signoff-v1', this.eventId, meta.id, root, this.termsHash]);
      if (!joined || !signed) return fail('Signature check failed');
      const blob = new Blob(rx.blobs, { type: meta.mime });
      rx = null;
      await this.onClip(meta, blob);
      reply({ t: 'ack', id: meta.id, ok: true });
      this.onProgress(peer, { id: meta.id, name: meta.name, done: true });
    };

    dc.onmessage = (e) => {
      chain = chain.then(() => handle(e.data)).catch((err) => fail(err.message));
    };
  }
}
