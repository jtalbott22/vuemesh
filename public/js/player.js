// MeshPlayer: plays every angle of an event on one clock.
// Time is "event time" in ms on the beacon clock. A cut is an edit list
// [{t, clip}] — data, not a render — so it replays on any device.

export class MeshPlayer {
  /**
   * @param {object} o
   * @param {string} o.eventId
   * @param {HTMLCanvasElement} [o.canvas]  draw the program into a canvas (studio, export)
   * @param {HTMLElement} [o.stage]         or show the active <video> directly (watch, mobile)
   * @param {boolean} [o.playAll]           keep every angle playing (multiview)
   * @param {boolean} [o.webAudio]          route sound through Web Audio (enables export mixing)
   * @param {(clip:object)=>string} o.urlFor where each clip's video lives (a local blob URL on the host)
   */
  constructor(o) {
    Object.assign(this, { playAll: false, webAudio: false }, o);
    this.g = this.canvas?.getContext('2d');
    this.entries = new Map();
    this.order = [];
    this.edl = [];
    this.cutStart = null;
    this.cutEnd = null;
    this.audio = null;
    this.mode = 'cut';
    this.free = null;
    this.t = 0;
    this.playing = false;
    this.rate = 1;
    this.lastWall = performance.now();
    this.activeId = null;
    this.audioId = null;
    this.listeners = { tick: [], active: [] };
    this.enabled = true;
    this.fit = 'fill'; // 'fill' crops to the output shape; 'fit' shows the whole shot
    if (this.webAudio) {
      this.ctx = new AudioContext();
      this.out = this.ctx.createMediaStreamDestination();
    }
    this._frame = this._frame.bind(this);
    requestAnimationFrame(this._frame);
  }

  on(name, fn) {
    this.listeners[name].push(fn);
  }

  // ------------------------------------------------------------- content ----

  setClips(clips) {
    const ready = clips.filter((c) => c.status === 'ready');
    const keep = new Set(ready.map((c) => c.id));
    for (const [id, e] of this.entries) {
      if (!keep.has(id)) {
        e.v.remove();
        this.entries.delete(id);
      }
    }
    for (const clip of ready) {
      let e = this.entries.get(clip.id);
      if (!e) {
        const v = document.createElement('video');
        v.playsInline = true;
        v.muted = !this.webAudio;
        v.preload = this.playAll ? 'auto' : 'metadata';
        v.src = this.urlFor(clip);
        v.dataset.clip = clip.id;
        e = { clip, v };
        if (this.webAudio) {
          e.gain = this.ctx.createGain();
          e.gain.gain.value = 0;
          this.ctx.createMediaElementSource(v).connect(e.gain);
          e.gain.connect(this.ctx.destination);
          e.gain.connect(this.out);
        }
        v.addEventListener('loadedmetadata', () => {
          if (!e.clip.dur && Number.isFinite(v.duration)) e.clip.dur = v.duration * 1000;
        });
        if (this.stage) this.stage.append(v);
        this.entries.set(clip.id, e);
      }
      e.clip = { ...clip, dur: clip.dur || e.clip.dur || 0 };
    }
    this.order = ready.slice().sort((a, b) => a.t0 - b.t0).map((c) => c.id);
    if (!this.t) this.t = this.range().start;
  }

  setCut(cut) {
    this.edl = (cut?.edl || []).slice().sort((a, b) => a.t - b.t);
    this.cutStart = cut?.start ?? null;
    this.cutEnd = cut?.end ?? null;
    this.audio = cut?.audio ?? null;
  }

  clip(id) {
    return this.entries.get(id)?.clip;
  }

  video(id) {
    return this.entries.get(id)?.v;
  }

  clips() {
    return this.order.map((id) => this.entries.get(id).clip);
  }

  /** Camera angles (cuttable). */
  videoClips() {
    return this.clips().filter((c) => c.kind !== 'audio');
  }

  /** Microphone-only recordings. */
  audioClips() {
    return this.clips().filter((c) => c.kind === 'audio');
  }

  isVideo(id) {
    const c = this.clip(id);
    return !!c && c.kind !== 'audio';
  }

  range() {
    const cs = this.clips();
    const start = this.cutStart ?? (cs.length ? Math.min(...cs.map((c) => c.t0)) : 0);
    const end = this.cutEnd ?? (cs.length ? Math.max(...cs.map((c) => c.t0 + c.dur)) : 0);
    return { start, end: Math.max(end, start) };
  }

  covers(id, t = this.t) {
    const c = this.clip(id);
    return !!c && t >= c.t0 && t < c.t0 + c.dur;
  }

  // Which angle is on screen at time t.
  activeAt(t = this.t) {
    if (this.mode === 'free' && this.isVideo(this.free) && this.covers(this.free, t)) return this.free;
    let pick = null;
    for (const e of this.edl) {
      if (e.t <= t) pick = e.clip;
      else break;
    }
    if (pick && this.isVideo(pick) && this.covers(pick, t)) return pick;
    // Nothing cut here (or that angle stopped recording): fall back to the
    // longest-running angle that covers this moment.
    let best = null;
    for (const id of this.order) {
      if (!this.isVideo(id) || !this.covers(id, t)) continue;
      const c = this.clip(id);
      if (!best || c.dur > this.clip(best).dur) best = id;
    }
    return best;
  }

  // ------------------------------------------------------------ transport ----

  /** Call from a click/tap handler so phones allow sound. */
  play() {
    if (this.playing) return;
    const { end, start } = this.range();
    if (this.t >= end - 50) this.t = start;
    this.playing = true;
    this.lastWall = performance.now();
    this.ctx?.resume();
    // Unlock every element inside the user gesture (iOS needs this).
    for (const e of this.entries.values()) {
      const p = e.v.play();
      p?.then(() => {
        if (!this._needed(e)) e.v.pause();
      }).catch(() => {});
    }
  }

  pause() {
    this.playing = false;
    for (const e of this.entries.values()) e.v.pause();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    const { start, end } = this.range();
    this.t = Math.min(Math.max(t, start), end);
    this._sync(true);
  }

  // --------------------------------------------------------------- engine ----

  _needed(e) {
    const inRange = this.covers(e.clip.id);
    return inRange && (this.playAll || e.clip.id === this.activeId || e.clip.id === this.audioId);
  }

  _frame() {
    const wall = performance.now();
    if (this.playing) {
      // The sound angle is the master clock whenever it's rolling.
      const m = this.entries.get(this.audioId);
      if (m && !m.v.paused && !m.v.seeking && m.v.readyState >= 3) {
        const tm = m.clip.t0 + m.v.currentTime * 1000;
        this.t = Math.abs(tm - this.t) < 400 ? tm : this.t + (wall - this.lastWall) * this.rate;
      } else {
        this.t += (wall - this.lastWall) * this.rate;
      }
      const { end } = this.range();
      if (this.t >= end) {
        this.t = end;
        this.pause();
        this.listeners.tick.forEach((f) => f(this.t, true));
      }
    }
    this.lastWall = wall;
    if (this.enabled) {
      this._sync(false);
      this._draw();
    }
    this.listeners.tick.forEach((f) => f(this.t, false));
    requestAnimationFrame(this._frame);
  }

  _sync(hard) {
    const active = this.activeAt();
    if (active !== this.activeId) {
      this.activeId = active;
      this.listeners.active.forEach((f) => f(active));
      hard = true;
    }
    const audio = this.resolveAudio(this.t) || active;
    this.audioId = audio;

    for (const e of this.entries.values()) {
      const { clip, v } = e;
      const local = (this.t - clip.t0) / 1000;
      const isActive = clip.id === active;
      if (this.webAudio) {
        const target = clip.id === audio && this.playing ? 1 : 0;
        if (e.gain.gain.value !== target) e.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
      } else {
        v.muted = clip.id !== audio;
      }
      if (this.stage) v.classList.toggle('on', isActive);

      if (!this._needed(e)) {
        if (!v.paused) v.pause();
        continue;
      }
      if (v.readyState < 1 || v.seeking) continue;
      const drift = v.currentTime - local;
      if (this.playing) {
        if (v.paused) v.play().catch(() => {});
        // Hard-seek big errors; steer small ones with playback rate so the
        // picture never jumps. The active angle is held to about a frame.
        const limit = isActive && hard ? 0.034 : 0.3;
        if (Math.abs(drift) > limit) {
          v.currentTime = Math.max(0, local);
          v.playbackRate = this.rate;
        } else if (Math.abs(drift) > 0.03 && clip.id !== audio) {
          v.playbackRate = this.rate * (drift > 0 ? 0.94 : 1.06);
        } else {
          v.playbackRate = this.rate;
        }
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(drift) > 0.02) v.currentTime = Math.max(0, local);
      }
    }
  }

  _draw() {
    if (!this.g) return;
    const { width: W, height: H } = this.canvas;
    const g = this.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const v = this.video(this.activeId);
    if (v && v.readyState >= 2 && v.videoWidth) {
      drawFramed(g, v, W, H, this.fit);
    } else {
      g.fillStyle = '#7c84a3';
      g.font = `600 ${Math.round(H / 22)}px Archivo, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillText(this.activeId ? 'Loading angle…' : 'No angle recording here', W / 2, H / 2);
    }
  }

  /**
   * The sound for time t. `audio` is a clip id, or "cid:<contributor>" meaning
   * "that phone's microphone, whichever of its recordings covers this moment".
   */
  resolveAudio(t = this.t) {
    const a = this.audio;
    if (!a) return null;
    if (a.startsWith('cid:')) {
      const cid = a.slice(4);
      let best = null;
      for (const id of this.order) {
        const c = this.clip(id);
        if (c.cid !== cid && c.contributorId !== cid) continue;
        if (!this.covers(id, t)) continue;
        if (!best || c.t0 > this.clip(best).t0) best = id; // overlapping segments: take the newer one
      }
      return best;
    }
    return this.covers(a, t) ? a : null;
  }

  /** Audio stream for export (webAudio mode only). */
  audioStream() {
    return this.out?.stream || null;
  }
}

/** Draw a video into a frame: 'fill' crops to fill it, 'fit' letterboxes. */
export function drawFramed(g, v, W, H, fit = 'fill') {
  const vw = v.videoWidth, vh = v.videoHeight;
  const s = fit === 'fit' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  g.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
}
