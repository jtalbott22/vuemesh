// The studio's side of the phone remote. A phone becomes a remote only when someone at the studio
// asks for it (Phone remote > Add a phone): the studio shows a one-time code, good for two minutes
// and one phone, and stops after five wrong tries. The phone that brings it gets its own session
// key, which every command has to carry; nobody else in the show can control it (a camera can't,
// and the code is no use once it's been used or has expired). Paired phones are remembered on this
// computer, for every show it runs: a phone paired once joins the next show with just the show's
// code (its key is its own, from this computer; the show's code alone, which every camera person
// has, never lets a phone in). A reload doesn't unpair them; Remove unpairs one.
//
// Messages go through the event's signalling (only between the studio and the phone): the phone
// sends {remote: {t: 'pair' | 'resume' | 'do' | 'vis', ...}}; the studio answers with 'paired' or
// 'denied', and sends 'state' (what's on air, the cameras) and, while the remote is open and on
// screen, a small picture of each camera every few seconds ('thumb').
import { bgInterval, bgTimeout } from '/js/bgclock.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // (no 0/O, 1/I/L: read off a screen)
const rand = (n, chars = CODE_CHARS) => {
  const a = new Uint32Array(n);
  crypto.getRandomValues(a);
  return [...a].map((x) => chars[x % chars.length]).join('');
};
const PAIR_MS = 120000, TRIES = 5, THUMB_MS = 5000;

export class RemoteHost {
  /**
   * @param o.eventId
   * @param o.send (peer, data) → the studio's signal to one connection
   * @param o.state () → what the remote shows (plain data)
   * @param o.act (action, arg) → do it; returns a reason it couldn't, or nothing
   * @param o.thumbs () → [{ peer, video }] for the cameras' pictures
   * @param o.changed () → the paired list or the pairing changed (redraw the studio's panel)
   * @param o.note (text) → a line in the studio's event log
   * @param o.tvKey? (remoteKey, name) → a screen key for the remote's Program out (a TV link it can open)
   * @param o.untrust? (remoteKey) → that remote was removed: its screen goes too
   */
  constructor(o) {
    Object.assign(this, o);
    // (what goes to each phone, counted for the Monitor: state and the cameras' pictures)
    const send = o.send;
    this.sent = new Map(); // peer → bytes
    this.send = (peer, data) => {
      try {
        this.sent.set(peer, (this.sent.get(peer) || 0) + JSON.stringify(data).length);
      } catch {}
      return send(peer, data);
    };
    this.store = 'vm_remotes'; // (every show on this computer; each show's own list before 0.61.1)
    this.keys = new Map(); // key → { name, at }
    for (const k of [this.store, `vm_remotes_${o.eventId}`]) {
      try {
        for (const r of JSON.parse(localStorage.getItem(k) || '[]')) if (!this.keys.has(r.key)) this.keys.set(r.key, { name: r.name, at: r.at });
      } catch {}
    }
    this.save();
    this.bound = new Map(); // peer → { key, visible }
    this.pairing = null; // { code, until, tries }
    this.lastState = '';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 192;
    this.canvas.height = 108;
    // (on the worker clock: the remote keeps up while the studio is hidden behind a slideshow)
    bgInterval(() => this.push(), 1000);
    bgInterval(() => this.pushThumbs(), THUMB_MS);
  }

  save() {
    try {
      localStorage.setItem(this.store, JSON.stringify([...this.keys].map(([key, v]) => ({ key, ...v }))));
    } catch {}
  }

  /** A new one-time code (shown in the studio's dialog until a phone uses it, or it runs out). */
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
    if (this.pairing && Date.now() > this.pairing.until) this.stopPairing();
    return this.pairing ? Math.max(0, this.pairing.until - Date.now()) : 0;
  }

  /** Paired phones, for the studio's list. */
  list() {
    const on = new Set([...this.bound.values()].map((b) => b.key));
    return [...this.keys].map(([key, v]) => ({ key, name: v.name, connected: on.has(key) }));
  }

  /** Each phone remote joined now, for the Monitor: open on its screen or not, since when, and what's sent it (kbps since last asked). */
  links() {
    const now = Date.now(), out = [];
    this.lastLinks ||= new Map();
    for (const [peer, b] of this.bound) {
      const bytes = this.sent.get(peer) || 0, was = this.lastLinks.get(peer);
      out.push({ name: this.keys.get(b.key)?.name || 'Phone remote', visible: !!b.visible, since: b.since || null, heard: b.heard || null, kbps: was && now > was.at ? Math.round(((bytes - was.bytes) * 8) / (now - was.at)) : null });
      this.lastLinks.set(peer, { bytes, at: now });
    }
    for (const peer of [...this.lastLinks.keys()]) if (!this.bound.has(peer)) this.lastLinks.delete(peer);
    return out;
  }

  remove(key) {
    for (const [peer, b] of this.bound) {
      if (b.key === key) {
        this.send(peer, { remote: { t: 'removed' } });
        this.bound.delete(peer);
      }
    }
    const name = this.keys.get(key)?.name;
    this.keys.delete(key);
    this.untrust?.(key);
    this.save();
    this.note?.(`${name || 'A phone'} is no longer a remote`);
    this.changed?.();
  }

  /** A phone left the show (its connection went). */
  gone(peer) {
    this.sent.delete(peer);
    if (this.bound.delete(peer)) this.changed?.();
  }

  /** A message from a phone. Anything without the right code or key is turned away. */
  onMessage(peer, msg) {
    const m = msg?.remote;
    if (!m || typeof m !== 'object') return;
    const reply = (data) => this.send(peer, { remote: data });
    if (m.t === 'pair') {
      const p = this.pairing;
      const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!p || Date.now() > p.until) return reply({ t: 'denied', why: 'That code has run out. Ask for a new one in the studio (Phone remote > Add a phone).' });
      if (code !== p.code) {
        p.tries++;
        if (p.tries >= TRIES) {
          this.stopPairing();
          this.note?.('Adding a phone remote stopped: too many wrong codes');
        }
        return reply({ t: 'denied', why: "That code isn't right. Check it against the studio's screen." });
      }
      const key = rand(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789');
      const name = String(m.name || 'Phone remote').slice(0, 40);
      this.keys.set(key, { name, at: Date.now() });
      this.save();
      this.bound.set(peer, { key, visible: true, since: Date.now(), heard: Date.now() });
      this.pairing = null;
      this.lastState = '';
      reply({ t: 'paired', key, name, tv: this.tvKey?.(key, name) || null });
      this.note?.(`${name} is now a remote for this show`);
      this.changed?.();
      this.push(true);
      this.pushThumbs(true);
      return;
    }
    // everything else needs a key this studio gave out
    if (!this.keys.has(m.key)) return reply({ t: 'removed', unknown: m.t === 'resume' });
    const was = this.bound.get(peer);
    if (!was || was.key !== m.key) {
      this.bound.set(peer, { key: m.key, visible: true, since: Date.now(), heard: Date.now() });
      this.changed?.();
    }
    const b = this.bound.get(peer);
    b.heard = Date.now();
    if (m.t === 'resume') {
      if (!was) this.note?.(`${this.keys.get(m.key)?.name || 'A phone remote'} joined this show as a remote`);
      reply({ t: 'tv', tv: this.tvKey?.(m.key, this.keys.get(m.key)?.name) || null });
      this.lastState = '';
      this.push(true);
      this.pushThumbs(true);
    } else if (m.t === 'vis') {
      b.visible = !!m.on;
      if (b.visible) this.pushThumbs(true);
    } else if (m.t === 'do') {
      const why = this.act(String(m.a || ''), m.arg);
      reply({ t: 'done', a: m.a, ok: !why, why: why || '' });
      this.lastState = '';
      bgTimeout(() => this.push(), 150);
    }
  }

  /** What's on air and the cameras, to every paired phone (when it changes; at least every 10 s). */
  push(force) {
    if (!this.bound.size) return;
    const s = JSON.stringify(this.state());
    const stale = Date.now() - (this.pushedAt || 0) > 10000;
    if (!force && s === this.lastState && !stale) return;
    this.lastState = s;
    this.pushedAt = Date.now();
    for (const peer of this.bound.keys()) this.send(peer, { remote: { t: 'state', s: JSON.parse(s) } });
  }

  /** A small picture of each camera, to the remotes that are open and on screen. */
  pushThumbs(force) {
    const watching = [...this.bound].filter(([, b]) => b.visible).map(([peer]) => peer);
    if (!watching.length) return;
    const g = this.canvas.getContext('2d');
    for (const { peer, video } of this.thumbs()) {
      if (!video || video.readyState < 2 || !video.videoWidth) continue;
      const vw = video.videoWidth, vh = video.videoHeight, s = Math.max(192 / vw, 108 / vh);
      g.fillStyle = '#000';
      g.fillRect(0, 0, 192, 108);
      g.drawImage(video, (192 - vw * s) / 2, (108 - vh * s) / 2, vw * s, vh * s);
      let src;
      try {
        src = this.canvas.toDataURL('image/jpeg', 0.55);
      } catch {
        continue;
      }
      for (const to of watching) this.send(to, { remote: { t: 'thumb', peer, src } });
    }
  }
}
