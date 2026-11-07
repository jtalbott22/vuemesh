// The program's sound on a phone, played the way a music app plays it: on with the screen locked,
// in the background behind other apps, in the car, with the show in Now Playing (the lock screen,
// Control Center, CarPlay) and its play and pause buttons working. Used by /tv and the phone
// remote's Program out.
//
// What makes that work on an iPhone, as in a music player:
// - The sound plays through a plain <audio> element of its own, never Web Audio (iOS stops Web
//   Audio when the screen locks, and over wireless CarPlay any Web Audio context alive beside
//   playback stutters) and never the <video> (iOS pauses a video in the background).
// - The audio session is "playback" while it's on (Safari 17+): it plays with the ring switch on
//   silent, into earbuds or the car, and carries on in the background.
// - Now Playing has the show (title, what's on air, the app's icon), and its play and pause are
//   this page's Sound on and Sound off.
// A page plays sound only after a tap, so turned on once (remembered), it starts by itself where the
// browser allows, or else with the first tap or key anywhere on the page.

const ART = [
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
];

// (a moment of silence, to start the element inside a tap before the program's sound has come)
let silentUrl = null;
function silence() {
  if (silentUrl) return silentUrl;
  const n = 800, b = new ArrayBuffer(44 + n), v = new DataView(b);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return (silentUrl = URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
}

export class ProgramSound {
  /**
   * @param o.store     localStorage key that remembers Sound on
   * @param o.onChange? () → the page redraws its button (this.on, this.waiting)
   */
  constructor(o) {
    this.store = o.store;
    this.onChange = o.onChange;
    this.track = null;
    this.meta = { title: 'Program', artist: 'VUEMesh' };
    const el = (this.el = document.createElement('audio'));
    el.setAttribute('playsinline', '');
    el.hidden = true;
    document.body.append(el);
    // (paused or played by the phone itself: a call, Siri, earbuds taken out, the car's buttons)
    el.addEventListener('pause', () => this.changed());
    el.addEventListener('playing', () => this.changed());
    // turned on before, and the browser wouldn't let it start: the first tap or key anywhere
    const gesture = () => this.wanted && !this.on && this.track && this.start();
    for (const t of ['click', 'touchend', 'keydown']) document.addEventListener(t, gesture, true);
    const ms = navigator.mediaSession;
    if (ms) {
      const act = (a, f) => {
        try {
          ms.setActionHandler(a, f);
        } catch {}
      };
      act('play', () => this.set(true));
      act('pause', () => this.set(false));
      act('stop', () => this.set(false));
      // (live: nothing to seek or skip)
      for (const a of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) act(a, null);
    }
  }

  get wanted() {
    try {
      return localStorage.getItem(this.store) === '1';
    } catch {
      return false;
    }
  }
  /** Playing the program's sound now. */
  get on() {
    return !!this.track && this.el.srcObject?.getAudioTracks()[0] === this.track && !this.el.paused;
  }
  /** Turned on, but waiting for a tap (or for the sound to arrive). */
  get waiting() {
    return this.wanted && !this.on;
  }

  /** The program's sound track from the studio (null: none now). Plays at once if it's on. */
  setTrack(track) {
    if (track === this.track) return;
    this.track = track;
    if (!track) {
      this.el.pause();
      this.el.srcObject = null;
      return this.changed();
    }
    this.el.srcObject = new MediaStream([track]);
    if (this.wanted) this.start(true);
    this.changed();
  }

  /** Sound on or off (the page's button, or Now Playing's play and pause): remembered. */
  set(on) {
    try {
      localStorage.setItem(this.store, on ? '1' : '0');
    } catch {}
    if (on) this.start();
    else {
      this.el.pause();
      this.changed();
    }
  }

  start(quiet) {
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {}
    const el = this.el;
    if (!this.track) {
      // (in a tap before the sound has come: start the element now, so it may play it later)
      if (quiet || el.srcObject || el.getAttribute('src')) return this.changed();
      el.src = silence();
      el.play().then(() => !el.srcObject && el.pause()).catch(() => {}).finally(() => {
        if (el.srcObject) return; // (the sound came meanwhile: setTrack started it)
        el.removeAttribute('src');
        el.load();
      });
      return this.changed();
    }
    if (el.srcObject?.getAudioTracks()[0] !== this.track) el.srcObject = new MediaStream([this.track]);
    el.muted = false;
    el.play().then(() => this.changed()).catch(() => this.changed()); // (not allowed yet: the first tap)
    this.changed();
  }

  /** What Now Playing shows: the title (what's on air) and the artist (the show). */
  setMeta(title, artist) {
    if (title === this.meta.title && artist === this.meta.artist) return;
    this.meta = { title, artist };
    this.publish();
  }

  publish() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      if (this.on) {
        ms.metadata = new MediaMetadata({ title: this.meta.title, artist: this.meta.artist, album: 'VUEMesh · live', artwork: ART });
        ms.playbackState = 'playing';
      } else ms.playbackState = this.track ? 'paused' : 'none';
    } catch {}
  }

  changed() {
    this.publish();
    this.onChange?.();
  }

  stop() {
    this.setTrack(null);
  }
}
