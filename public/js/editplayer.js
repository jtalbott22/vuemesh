// Plays a layered sequence: every visible layer is a real <video> kept in step
// with the timeline, drawn bottom-up into the program canvas. Sound runs through
// one bus per audio track (gain, mute, mono) into a master bus with meters.

import { eqChain, balance, channelFixer } from '/js/audiofx.js';
import { composeFrame, limiter } from '/js/compose.js';
import { audioItems, end, FRAME, micCover, dissolveOf, heldBefore } from '/js/sequence.js';

const PREROLL = 1500; // start loading the next item this long before it appears

export class EditPlayer {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {(clipId:string)=>string} o.urlFor
   * @param {(assetId:string)=>CanvasImageSource|null} o.imageFor
   * @param {()=>string} [o.title]
   * @param {(item, sourceMs)=>{rect, rot}|null} [o.viewOf] where the picture sits in a phone's square frame
   */
  constructor(o) {
    Object.assign(this, o);
    this.g = this.canvas.getContext('2d');
    this.seq = null;
    this.t = 0;
    this.playing = false;
    this.rate = 1;
    this.enabled = true;
    this.fit = 'fill';
    this.listeners = { tick: [] };
    this.els = new Map();
    this.buses = new Map();
    this.box = document.createElement('div');
    Object.assign(this.box.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', overflow: 'hidden', opacity: '0.01', pointerEvents: 'none' });
    document.body.append(this.box);

    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.limit = limiter(this.ctx);
    this.master.connect(this.limit);
    this.masterMeter = this.ctx.createAnalyser();
    this.masterMeter.fftSize = 1024;
    this.limit.connect(this.masterMeter);
    this.limit.connect(this.ctx.destination);
    this.out = this.ctx.createMediaStreamDestination();
    this.limit.connect(this.out);
    this.silent = this.ctx.createGain();
    this.silent.gain.value = 0;
    this.silent.connect(this.master);
    this.lastWall = performance.now();
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  on(name, fn) {
    this.listeners[name].push(fn);
  }

  setSequence(seq) {
    this.seq = seq;
    for (const tr of seq.tracks.filter((t) => t.kind === 'audio')) this._bus(tr);
    this._applyGains();
  }

  duration() {
    return this.seq ? end(this.seq) : 0;
  }

  // ------------------------------------------------------------------ audio --

  _bus(tr) {
    let b = this.buses.get(tr.id);
    if (!b) {
      // track level (and mono) → EQ → balance → meter and the master
      const gain = this.ctx.createGain();
      const eq = eqChain(this.ctx);
      const bal = balance(this.ctx);
      const meter = this.ctx.createAnalyser();
      meter.fftSize = 1024;
      gain.connect(eq.input);
      eq.output.connect(bal.input);
      bal.output.connect(meter);
      bal.output.connect(this.master);
      b = { gain, eq, bal, meter };
      this.buses.set(tr.id, b);
    }
    // Mono sums both channels, so a phone that only fills the left channel plays in both ears.
    const mono = tr.mono !== false;
    b.gain.channelCount = mono ? 1 : 2;
    b.gain.channelCountMode = mono ? 'explicit' : 'max';
    b.gain.channelInterpretation = 'speakers';
    return b;
  }

  _applyGains() {
    if (!this.seq) return;
    for (const tr of this.seq.tracks.filter((t) => t.kind === 'audio')) {
      const b = this._bus(tr);
      const v = tr.muted ? 0 : tr.gain ?? 1;
      b.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
      b.eq.set(tr.eq);
      b.bal.set(tr.pan || 0);
    }
  }

  refreshMix() {
    this._applyGains();
  }

  /** Peak levels 0..1 per audio track and for the master. */
  levels() {
    const peak = (an) => {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      let p = 0;
      for (const v of buf) p = Math.max(p, Math.abs(v));
      return p;
    };
    const out = { master: peak(this.masterMeter) };
    for (const [id, b] of this.buses) out[id] = peak(b.meter);
    return out;
  }

  audioStream() {
    return this.out.stream;
  }

  // --------------------------------------------------------------- elements --

  _key(trackId, src) {
    return trackId + '|' + src;
  }

  /** One element per (track, source). Program elements feed the camera-sound bus; overlay clips are silent. */
  _el(trackId, src, busTrackId) {
    const key = this._key(trackId, src);
    let e = this.els.get(key);
    if (e) return e;
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.muted = false;
    v.src = this.urlFor(src);
    this.box.append(v);
    const node = this.ctx.createMediaElementSource(v);
    // a recording that only filled the left side plays on both (a stereo one stays stereo)
    const fix = channelFixer(this.ctx, { stereo: this.audioOf?.(src) === 'stereo' });
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    node.connect(fix.input);
    fix.output.connect(gain);
    const bus = busTrackId ? this.buses.get(busTrackId) : null;
    gain.connect(bus ? bus.gain : this.silent);
    e = { key, v, gain, bus: busTrackId, wired: bus ? busTrackId : null };
    this.els.set(key, e);
    return e;
  }

  /**
   * Keep each clip's sound wired to the right bus. It used to be wired once, when the clip
   * was first loaded; if its bus didn't exist yet, the clip stayed silent for good.
   */
  _route(e, busTrackId) {
    if (busTrackId && !this.buses.get(busTrackId)) {
      const tr = this.seq?.tracks.find((t) => t.id === busTrackId);
      if (tr) {
        this._bus(tr);
        this._applyGains();
      }
    }
    const want = busTrackId && this.buses.get(busTrackId) ? busTrackId : null;
    if (e.wired === want) return;
    try { e.gain.disconnect(); } catch {}
    e.gain.connect(want ? this.buses.get(want).gain : this.silent);
    e.wired = want;
    e.bus = busTrackId;
  }

  /** Everything that should be sounding or showing (or loading) at time t. */
  _wanted(t) {
    const out = [];
    const seq = this.seq;
    const followBus = new Map(seq.tracks.filter((k) => k.follow).map((k) => [k.follow, k.id]));
    for (const tr of seq.tracks) {
      if (tr.kind === 'video') {
        if (tr.hidden && !followBus.has(tr.id)) continue;
        for (const it of tr.items) {
          if (it.type !== 'clip') continue;
          if (t >= it.start - PREROLL && t < it.start + it.dur) {
            out.push({ tr, it, key: this._key(tr.id, it.src), bus: followBus.get(tr.id), active: t >= it.start, visible: !tr.hidden });
          }
          // a dissolve into this shot: the one before carries on (past its end) underneath
          const xd = dissolveOf(it);
          if (xd && t >= it.start && t < it.start + xd) {
            const prev = heldBefore(tr, it);
            if (prev && prev.src !== it.src) out.push({ tr, it: prev, key: this._key(tr.id, prev.src), bus: followBus.get(tr.id), active: true, visible: !tr.hidden, held: 1 - (t - it.start) / xd });
          }
        }
      } else if (!tr.follow) {
        for (const it of audioItems(seq, tr)) {
          if (t >= it.start - PREROLL && t < it.start + it.dur) {
            out.push({ tr, it, key: this._key(tr.id, it.src), bus: tr.id, active: t >= it.start, audioOnly: true });
          }
        }
      }
    }
    return out;
  }

  /** Let go of every element playing a source (its recording was deleted). */
  forget(src) {
    for (const [key, e] of this.els) {
      if (!key.endsWith('|' + src)) continue;
      e.v.pause();
      e.v.removeAttribute('src');
      e.v.load();
      e.v.remove();
      try { e.gain.disconnect(); } catch {}
      this.els.delete(key);
    }
  }

  // ---------------------------------------------------------------- transport --

  play() {
    if (this.playing) return;
    if (this.t >= this.duration() - 50) this.t = 0;
    this.playing = true;
    this.lastWall = performance.now();
    this.ctx.resume();
  }

  pause() {
    this.playing = false;
    for (const e of this.els.values()) e.v.pause();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    this.t = Math.min(Math.max(0, t), this.duration());
    this._sync(true);
  }

  // ------------------------------------------------------------------ engine --

  _frame() {
    this.step();
    requestAnimationFrame(this._frame);
  }

  /** One frame of playback and drawing (also called by the studio's background clock). */
  step() {
    const wall = performance.now();
    if (this.enabled && this.seq) {
      if (this.playing) {
        // Lock to a sounding audio-track item when there is one, so picture follows sound.
        const m = this.master_;
        if (m && !m.v.paused && !m.v.seeking && m.v.readyState >= 3) {
          const tm = m.it.start + (m.v.currentTime * 1000 - (m.it.in || 0));
          this.t = Math.abs(tm - this.t) < 400 ? tm : this.t + (wall - this.lastWall) * this.rate;
        } else {
          this.t += (wall - this.lastWall) * this.rate;
        }
        if (this.t >= this.duration()) {
          this.t = this.duration();
          this.pause();
          this.listeners.tick.forEach((f) => f(this.t, true));
        }
      }
      this._sync(false);
      this._draw();
    }
    this.lastWall = wall;
    this.listeners.tick.forEach((f) => f(this.t, false));
  }

  _sync(hard) {
    if (!this.seq) return;
    const t = this.t;
    const wanted = this._wanted(t);
    // camera sound steps aside while a microphone recording plays (if its track ducks)
    const camTr = this.seq.tracks.find((k) => k.follow);
    const ducked = !!camTr?.duck && micCover(this.seq).some(([a, b]) => t >= a && t < b);
    const keys = new Set();
    this.master_ = null;
    for (const w of wanted) {
      const e = this._el(w.tr.id, w.it.src, w.bus);
      this._route(e, w.bus);
      keys.add(e.key);
      e.it = w.it;
      const sp = w.it.speed || 1;
      const local = ((w.it.in || 0) + Math.max(0, t - w.it.start) * sp) / 1000;
      const sounding = w.active && !!w.bus && sp === 1; // another speed: picture only
      // through a dissolve the sound crossfades with the picture
      const xd = dissolveOf(w.it), xf = w.held != null ? w.held : xd && heldBefore(w.tr, w.it) && t < w.it.start + xd ? Math.max(0, (t - w.it.start) / xd) : 1;
      const itemGain = (w.it.gain ?? 1) * (sounding ? 1 : 0) * (ducked && camTr && w.bus === camTr.id ? 0 : 1) * xf;
      if (Math.abs(e.gain.gain.value - itemGain) > 0.001) e.gain.gain.setTargetAtTime(itemGain, this.ctx.currentTime, 0.01);
      if (w.audioOnly && w.active && !this.master_) {
        const tr = w.tr;
        if (!tr.muted && (tr.gain ?? 1) > 0) this.master_ = e;
      }
      if (e.v.readyState < 1 || e.v.seeking) continue;
      const drift = e.v.currentTime - local;
      if (this.playing && w.active) {
        if (e.v.paused) e.v.play().catch(() => {});
        const limit = hard ? 0.034 : 0.25;
        if (Math.abs(drift) > limit * sp) {
          e.v.currentTime = Math.max(0, local);
          e.v.playbackRate = this.rate * sp;
        } else if (Math.abs(drift) > 0.03 * sp && e !== this.master_ && !w.audioOnly) {
          e.v.playbackRate = this.rate * sp * (drift > 0 ? 0.95 : 1.05);
        } else e.v.playbackRate = this.rate * sp;
      } else {
        if (!e.v.paused) e.v.pause();
        if (Math.abs(drift) > 0.02) e.v.currentTime = Math.max(0, local);
      }
    }
    for (const e of this.els.values()) {
      if (keys.has(e.key)) continue;
      if (!e.v.paused) e.v.pause();
      if (e.gain.gain.value > 0) e.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
    }
  }

  _draw() {
    const { canvas, g } = this;
    const trackOf = new Map();
    for (const tr of this.seq.tracks) for (const it of tr.items) trackOf.set(it.id, tr.id);
    composeFrame(g, canvas.width, canvas.height, this.seq, this.t, (item) => {
      if (item.type === 'image') return this.imageFor(item.asset);
      const e = this.els.get(this._key(trackOf.get(item.id), item.src));
      return e && e.v.readyState >= 2 ? e.v : null;
    }, { fit: this.fit, title: this.title?.(), viewOf: this.viewOf });
  }
}
