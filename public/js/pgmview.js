// Program out on the phone remote: the program's picture as a TV gets it (display-hub.js), on
// its own link, so the remote shows what's on air right where it cuts. The studio let this
// screen in when the phone was paired as a remote (no Accept), and sends it the picture at half
// size, with the program's sound (the remote starts it muted: see remote.js). It joins again by
// itself, as a TV does (tv.js), and says what it's showing, only while it's on screen: a phone
// that's locked or in the background shows nothing, and isn't falling behind.
// A camera watching the program uses it too (cam.js), without the sound, asking for its box's
// small picture, full screen, or nothing (want()).
import { meshSocket, ICE } from '/js/vm.js';

export class ProgramView {
  /** @param o.eventId  @param o.key  the screen key from the studio  @param o.name  @param o.video  a <video> to show it in  @param o.onState? (text)  @param o.onSound? (track) the program's sound, to play apart from the picture (progsound.js)
   *  @param o.sound? false: picture only (a camera)  @param o.label? what the studio calls it  @param o.model? 'remote' | 'camera'
   *  @param o.onBlocked? (on) the phone won't show the picture until the page is touched (or now it does) */
  constructor(o) {
    Object.assign(this, { sound: true, label: `${o.name || 'Phone remote'} (Program out)`, model: 'remote' }, o);
    this.wanted = null; // (a camera: { mode, big }, sent again whenever the link comes back)
    this.host = null;
    this.pc = null;
    this.ctl = null;
    this.lastTry = 0;
    this.shown = 0;
    this.lastQ = null;
    this.say = (t) => this.onState?.(t);
    this.sock = meshSocket({
      eventId: o.eventId, role: 'display', name: this.label, cid: 'pgm-' + Math.random().toString(36).slice(2, 10),
      onPeers: (peers) => {
        const h = peers.find((p) => p.role === 'host')?.peer || null;
        if (h === this.host) return;
        // (the studio's server connection dropped a moment: the program comes straight from it, so a
        // link that's still connected stays; tick() asks again if it goes)
        if (!h && this.linked) return;
        this.drop();
        this.host = h;
        if (h) this.hello();
        else this.say('Waiting for the studio');
      },
      onSignal: (from, data) => {
        if (from !== this.host || !data) return;
        if (data.display) return this.onDisplay(data.display);
        if (!this.pc) return;
        if (data.kind === 'answer') this.pc.setRemoteDescription(data.sdp).catch(() => {});
        else if (data.kind === 'ice' && data.c) this.pc.addIceCandidate(data.c).catch(() => {});
        else if (data.kind === 'restart') this.offer();
      },
    });
    const v = this.video;
    if (v.requestVideoFrameCallback) {
      const each = () => {
        this.shown++;
        v.requestVideoFrameCallback(each);
      };
      v.requestVideoFrameCallback(each);
    }
    this.timer = setInterval(() => this.tick(), 3000);
    // (back on screen: its count starts again, so the time it was away isn't reported as frozen; and
    // its picture plays again, if the phone paused it meanwhile)
    this.onVis = () => {
      this.lastQ = null;
      if (!document.hidden) this.resume();
    };
    document.addEventListener('visibilitychange', this.onVis);
    // A phone that won't start a video by itself until the page is touched (an iPhone in Low Power
    // Mode; some browsers until any tap): the link is up and the picture arriving, but nothing shows.
    // Opened from the studio's code, a remote may never be tapped before someone taps + This phone,
    // so Program out looked like it waited for that. Now the first touch anywhere starts it (inside
    // that touch, which the phone allows), and until then onBlocked says so.
    this.blocked = false;
    this.onPlaying = () => this.setBlocked(false);
    v.addEventListener('playing', this.onPlaying);
    this.onTouch = () => {
      if (!this.blocked || !v.srcObject) return;
      v.play().then(() => this.setBlocked(false)).catch(() => {});
    };
    for (const t of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(t, this.onTouch, true);
    // (scrolled off screen, a phone stops drawing it, Safari pauses it if muted: not reported either)
    this.inView = true;
    this.seen = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => {
      this.inView = es[es.length - 1].isIntersecting;
      if (!this.inView) this.lastQ = null;
    }) : null;
    this.seen?.observe(v);
  }
  /** Is the program's sound coming in? */
  get hasSound() {
    return !!this.pc?.getReceivers().some((r) => r.track?.kind === 'audio' && r.track.readyState === 'live');
  }
  signal(data) {
    if (this.host) this.sock.signal(this.host, data);
  }
  hello() {
    this.lastTry = Date.now();
    this.say('Joining…');
    this.signal({ display: { v: 1, t: 'hello', name: this.label, model: this.model, appVersion: 'web', caps: ['program'], screen: { w: screen.width * devicePixelRatio, h: screen.height * devicePixelRatio }, key: this.key } });
  }
  onDisplay(m) {
    if (m.t === 'paired') return this.offer();
    if (m.t === 'reject' || m.t === 'waiting') {
      this.drop();
      this.say(m.t === 'waiting' ? 'The studio needs this phone paired again' : m.message || 'The studio turned it away');
    }
  }
  async offer() {
    this.lastTry = Date.now();
    this.tryingSince ||= Date.now(); // (since the first try, not this one: it asks again every 12 s)
    this.drop();
    const pc = (this.pc = new RTCPeerConnection({ iceServers: ICE }));
    pc.addTransceiver('video', { direction: 'recvonly' });
    if (this.sound) pc.addTransceiver('audio', { direction: 'recvonly' });
    this.ctl = pc.createDataChannel('ctl', { ordered: true });
    this.ctl.onopen = () => {
      this.tryingSince = null;
      this.say('');
      if (this.wanted) this.want(this.wanted.mode, this.wanted.big);
      this.onOpen?.();
    };
    this.ctl.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this.onCtl?.(m);
    };
    const stream = new MediaStream();
    pc.ontrack = (e) => {
      if (e.track.kind === 'audio' && this.onSound) return this.onSound(e.track);
      stream.addTrack(e.track);
      this.video.srcObject = stream;
      this.play();
    };
    pc.onicecandidate = (e) => e.candidate && this.signal({ kind: 'ice', c: e.candidate.toJSON() });
    pc.onconnectionstatechange = () => pc.connectionState === 'failed' && this.say("Can't reach the studio's picture on this network");
    await pc.setLocalDescription(await pc.createOffer());
    this.signal({ kind: 'offer', sdp: pc.localDescription.toJSON() });
  }
  /** What to send this screen: 'program' (big: full size, else small) or 'idle' (nothing). Kept, and sent again on every new link. */
  want(mode, big = false) {
    this.wanted = { mode, big: !!big };
    if (this.ctl?.readyState !== 'open') return;
    try {
      this.ctl.send(JSON.stringify({ t: 'want', mode, big: !!big }));
    } catch {}
  }
  /** Send something on the link (false if it isn't up). */
  tell(obj) {
    if (this.ctl?.readyState !== 'open') return false;
    try {
      this.ctl.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }
  /** Asked for the picture over 5 s ago and still not linked (see reveal). */
  get stuck() {
    return !!this.pc && !this.linked && !!this.tryingSince && Date.now() - this.tryingSince > 5000;
  }
  /**
   * A phone hides its own address from a page that hasn't been allowed its camera or microphone
   * (an iPhone always; Chrome too), giving a made-up name.local the studio has to find on the
   * network, which from a Wi-Fi phone to a wired studio computer it usually can't. Then the picture
   * never connects: the remote's Program out waited for its camera to be added, which allowed it.
   * The camera and microphone asked for (the camera page asks the same when it joins), let go at
   * once (nothing from them is kept or sent), and the picture asked for again, now with the phone's
   * real address. (A page keeps that for as long as it's open.) A device without a camera: the
   * microphone alone. @returns false if they were turned down (or need a tap first)
   */
  async reveal() {
    let ok = false;
    for (const ask of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia(ask);
        s.getTracks().forEach((t) => t.stop());
        ok = true;
        break;
      } catch (e) {
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') break; // (said no, or not without a tap: asked again on one)
      }
    }
    this.revealed = true;
    if (this.host) this.offer();
    return ok;
  }
  get linked() {
    return this.ctl?.readyState === 'open' && this.pc?.connectionState === 'connected';
  }
  /**
   * Its picture paused by the phone, with the link fine and the picture still arriving: play it again.
   * An iPhone pauses a page's video for a confirm() box (the remote's Stop recording had one), a call
   * or Siri, and nothing here started it again: the link never dropped, so no new track came to
   * start it. Program out froze until the page was reloaded, while the studio still sent 30 a second.
   */
  resume() {
    const v = this.video;
    if (v.srcObject && v.paused && !document.hidden) this.play();
  }
  /** Play it; a phone that won't without a touch first: blocked, until one (see onTouch). */
  play() {
    this.video.play().then(() => this.setBlocked(false)).catch((e) => e?.name === 'NotAllowedError' && !document.hidden && this.setBlocked(true));
  }
  setBlocked(on) {
    if (this.blocked === on) return;
    this.blocked = on;
    this.onBlocked?.(on);
    this.sayBlocked();
  }
  /** (the studio's show log says so: the picture's arriving, the phone isn't showing it; once the link's up, if it wasn't) */
  sayBlocked() {
    if (this.blocked !== !!this.saidBlocked && this.tell({ t: 'blocked', on: this.blocked })) this.saidBlocked = this.blocked;
  }
  async tick() {
    // stay joined (the studio closes a screen it hasn't heard from in 20 s), and say what it's showing
    if (this.linked) {
      this.resume();
      this.sayBlocked();
      const now = performance.now();
      const msg = { t: 'ping', seq: 0, at: Date.now() };
      try {
        this.ctl.send(JSON.stringify(msg));
      } catch {}
      // what it's getting, as a TV says it (tv.js): frames shown, dropped and frozen, packets lost, the size
      let s = null;
      try {
        (await this.pc.getStats()).forEach((r) => {
          if (r.type === 'inbound-rtp' && r.kind === 'video') s = r;
        });
      } catch {}
      if (document.hidden || !this.inView) {
        this.lastQ = null;
        return;
      }
      const cur = { at: now, shown: this.shown, decoded: s?.framesDecoded || 0, dropped: s?.framesDropped || 0, freezes: s?.freezeCount || 0, freezeMs: (s?.totalFreezesDuration || 0) * 1000, lost: s?.packetsLost || 0 };
      if (this.lastQ && now - this.lastQ.at > 15_000) this.lastQ = cur; // (the phone was asleep: timers stopped)
      else if (this.lastQ && now - this.lastQ.at >= 4500) {
        const q = this.lastQ, secs = (now - q.at) / 1000;
        const shownFps = (cur.shown - q.shown) / secs, decodedFps = (cur.decoded - q.decoded) / secs;
        try {
          this.ctl.send(JSON.stringify({
            t: 'quality', secs: Math.round(secs * 10) / 10, fps: Math.round((shownFps > 0 ? shownFps : decodedFps) * 10) / 10,
            dropped: Math.max(0, cur.dropped - q.dropped), freezes: Math.max(0, cur.freezes - q.freezes), freezeMs: Math.max(0, Math.round(cur.freezeMs - q.freezeMs)), lost: Math.max(0, cur.lost - q.lost),
            w: s?.frameWidth || null, h: s?.frameHeight || null,
          }));
        } catch {}
        this.lastQ = cur;
      } else if (!this.lastQ) this.lastQ = cur;
    } else if (this.host && Date.now() - this.lastTry > 12_000) this.hello();
  }
  drop() {
    this.lastQ = null;
    this.saidBlocked = false; // (a new link is told again)
    try { this.ctl?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.pc = null;
    this.ctl = null;
  }
  stop() {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVis);
    this.video.removeEventListener('playing', this.onPlaying);
    for (const t of ['pointerdown', 'touchend', 'keydown']) document.removeEventListener(t, this.onTouch, true);
    this.seen?.disconnect();
    this.drop();
    this.sock.close();
    this.video.srcObject = null;
  }
}
