// The phone remote's own camera (remote.js): Add this phone's camera, and the phone running the show
// is one of its cameras too. It joins the show as a camera of its own, as the camera page does
// (cam.js) and a shared screen does (share.js): the studio cuts to it, records it in the program and
// shows it on every remote like any other. The remote stays as it is.
// - The camera's own picture goes, the whole frame, upright as the phone is held (the studio is told
//   so). The camera page's upright square, zoom, the look and the shot coach aren't on it.
// - Live only: nothing is recorded on the phone (the camera page records its own clip for Edit).
// - Lenses: the ones the phone has, as a camera app names them (0.5×, 1×, 2×, Front), one tap each.
// - Its microphone goes with it, and can be turned off here (the studio's mixer has it too).
// - It doesn't watch the program: the remote has Program out already (the studio is told, and keeps
//   that place for another camera).

import { CamLink } from '/js/rtc.js';
import { CameraKit, lensButtons, preferredCamera } from '/js/camctl.js';
import { identity, meshSocket, thumbprint } from '/js/vm.js';

const WHOLE = { x: 0, y: 0, w: 1, h: 1 };
// (the phone's audio session, Safari 17+: "play-and-record" while the microphone is open)
const session = (type) => {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
  } catch {}
};
const LIVE = ['lan', 'nat', 'cellular', 'internet', 'relay', 'unknown'];

export class RemoteCamera {
  /**
   * @param {object} o
   * @param {string} o.eventId
   * @param {string} o.name  what the studio calls this camera
   * @param {HTMLVideoElement} o.video  this phone's own picture, small, to frame the shot
   * @param {() => void} o.onChange  something here changed: the page redraws (this.view())
   * @param {(why: string) => void} [o.onEnded]  the studio took it out of the show, or the camera stopped for good
   */
  constructor(o) {
    Object.assign(this, { eventId: o.eventId, name: o.name, video: o.video, onChange: o.onChange || (() => {}), onEnded: o.onEnded || (() => {}) });
    this.kit = null;
    this.mic = null; // the microphone's track (null: none, or not allowed)
    this.micOn = true;
    this.lenses = [];
    this.state = 'off'; // 'starting' | 'connecting' | 'no-host' | a route (live) | 'off'
    this.air = false;
    this.pvw = false;
    this.sock = null;
    this.link = null;
    this.timer = null;
  }

  /** This camera's id in the show (what the studio's cameras list calls it), once it's joined. */
  get peer() {
    return this.sock?.peer || null;
  }
  get on() {
    return this.state !== 'off';
  }
  get live() {
    return LIVE.includes(this.state);
  }

  /** Open the camera and the microphone (the phone asks, the first time), then join the show. */
  async start() {
    if (this.on) return;
    this.state = 'starting';
    this.micOn = true; // (its microphone goes with it each time it's added: the program's sound is held off from now)
    this.onChange();
    try {
      this.kit = new CameraKit();
      await this.kit.open({ facing: 'environment' });
      // (the names come once the camera's allowed: then the plain 1× on the back, as a camera app opens,
      // if the phone gave another; an iPhone's "back" can be its combined triple camera)
      this.lenses = lensButtons((await this.kit.devices()).cams);
      const plain = preferredCamera(this.lenses, 'back');
      if (plain && plain.deviceId !== this.kit.deviceId) await this.kit.open({ deviceId: plain.deviceId }).catch(() => {});
    } catch (e) {
      this.kit?.track?.stop();
      this.kit = null;
      this.state = 'off';
      this.onChange();
      throw e;
    }
    // (the microphone didn't open: the picture goes on its own, and Mic off is a tap to try again;
    // a tap is a better time to ask, as a page's first request can be turned down without one)
    this.canMic = !!navigator.mediaDevices?.getUserMedia;
    if (!(await this.openMic().catch(() => null))) {
      this.micOn = false;
      this.micMissed = true;
    }
    this.stream = new MediaStream([this.kit.track, ...(this.mic ? [this.mic] : [])]);
    this.showSelf();
    const id = await identity();
    // (its own: not this phone's camera page, if it's a camera in the show too)
    const cid = (await thumbprint(id.jwk)).slice(0, 13) + 'rmc';
    this.sock = meshSocket({
      eventId: this.eventId, role: 'cam', name: this.name, cid,
      onPeers: (peers) => this.link?.setPeers(peers),
      onSignal: (from, data) => this.link?.onSignal(from, data),
    });
    const tier = () => this.link?.setTier?.(this.air ? 'program' : this.pvw ? 'preview' : 'idle');
    this.link = new CamLink({
      sock: this.sock,
      stream: () => this.stream,
      onState: (s) => {
        this.state = s === 'left' ? 'connecting' : s;
        if (this.live) this.orient(true);
        this.onChange();
      },
      onControl: (m) => {
        if (m.t === 'kick') return this.stop("The studio took this phone's camera out of the show");
        if (m.t === 'pvw') this.pvw = !!m.on;
        if (m.t === 'tally') this.air = !!m.on;
        if (m.t === 'pvw' || m.t === 'tally') {
          tier();
          this.onChange();
        }
      },
      // (director's notes, the rundown: the remote has its own. A program screen isn't offered it: noted, for tests)
      onHostMessage: (m) => m?.t === 'pgm' && (this.pgmOffered = this.pgmOffered || !!m.key),
      extraTelemetry: () => ({ role: 'cam', kind: 'phone', rec: false, remoteCam: true, lens: this.kit?.track?.label || null, mic: this.mic?.label || null }),
      onProgress: () => {},
      onSent: () => {},
      onFailed: () => {},
    });
    this.state = 'connecting';
    // (the shape again now and then, in case a message was lost; and the camera, should it have stopped)
    this.timer = setInterval(() => {
      this.orient(true);
      this.revive();
    }, 3000);
    this.video.addEventListener('resize', (this.onResize = () => this.orient()));
    document.addEventListener('visibilitychange', (this.onVis = () => !document.hidden && this.revive()));
    this.onChange();
  }

  /** The picture here, to frame the shot (the front camera as a mirror, as a camera app shows it). */
  showSelf() {
    this.video.srcObject = new MediaStream([this.kit.track]);
    this.video.classList.toggle('mirror', this.lens()?.lens === 'front');
    this.video.play?.().catch(() => {});
  }

  lens() {
    return this.lenses.find((l) => l.deviceId === this.kit?.deviceId) || null;
  }

  /** Tell the studio the whole picture is the shot, and which way up it is (as this phone holds it). */
  orient(again) {
    const w = this.video.videoWidth || this.kit?.track?.getSettings?.().width || 16;
    const h = this.video.videoHeight || this.kit?.track?.getSettings?.().height || 9;
    const upright = w >= h ? 'landscape' : 'portrait';
    if (!again && upright === this.upright) return;
    this.upright = upright;
    this.link?.control({ t: 'orient', rect: WHOLE, upright });
  }

  /** Another lens (a tap on its button): the studio's picture changes over with it. */
  async useLens(deviceId) {
    if (!this.kit || deviceId === this.kit.deviceId || this.switching) return;
    this.switching = true;
    this.onChange();
    try {
      await this.kit.open({ deviceId });
      this.swapIn();
    } finally {
      this.switching = false;
      this.onChange();
    }
  }

  swapIn() {
    this.stream = new MediaStream([this.kit.track, ...(this.mic ? [this.mic] : [])]);
    this.showSelf();
    this.link?.replaceStream(this.stream);
    this.upright = null;
    setTimeout(() => this.orient(), 300);
  }

  /**
   * Open the microphone. While it's open, an iPhone plays sound as a phone call does, from the
   * earpiece (the program's is held off meanwhile, see remote.js); so it's opened only while it's on.
   */
  async openMic() {
    // The phone set for recording first, then asked: an iPhone playing the program's sound has its
    // audio session on "playback" (progsound.js), and in that it won't open the microphone (the
    // first + This phone asked, then came in without sound; removed and added again, the session
    // was back on "auto" and it worked). Changed while the microphone's open, it can go silent.
    // (the program's sound is held off already: remote.js holds it while Mic is on)
    session('play-and-record');
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      session('auto');
      throw e;
    }
    this.mic = s.getAudioTracks()[0] || null;
    if (!this.mic) session('auto');
    else this.micMissed = false;
    return this.mic;
  }

  /** The link's sender for the sound (found by its transceiver: with nothing sending, it has no track to say). */
  soundSender() {
    return this.link?.pc?.getTransceivers?.().find((t) => t.receiver?.track?.kind === 'audio' && !t.stopped)?.sender || null;
  }

  /**
   * The microphone on or off. Off lets go of it altogether (silence goes, the picture carries on):
   * only muted, it stayed open, and with the program's sound back on, an iPhone played it from the
   * earpiece, not the speaker. On opens it again.
   */
  async setMic(on) {
    on = !!on;
    if (on === this.micOn && !!this.mic === on) return;
    this.micOn = on;
    if (!on) {
      this.mic?.stop();
      this.mic = null;
      this.soundSender()?.replaceTrack(null).catch(() => {});
      session('auto');
      this.stream = new MediaStream([this.kit.track]);
      return this.onChange();
    }
    this.onChange();
    try {
      await this.openMic();
    } catch (e) {
      this.micOn = false;
      this.onChange();
      throw new Error(e?.name === 'NotAllowedError' ? 'Allow the microphone for this page to use it (Settings > Safari > Microphone on an iPhone)' : "The microphone didn't open");
    }
    if (!this.on) return this.mic?.stop(); // (removed meanwhile)
    this.stream = new MediaStream([this.kit.track, this.mic]);
    const sender = this.soundSender();
    if (sender) {
      sender.__track = this.mic;
      sender.replaceTrack(this.mic).catch(() => {});
    } else this.link?.connect({ over: true }); // (linked again while it was off: a link with sound)
    this.onChange();
  }

  /**
   * Back on screen after the phone was locked or another app was in front: an iPhone stops the
   * camera meanwhile, and sometimes ends it. Ended, it's opened again, the same lens.
   */
  async revive() {
    if (!this.kit || this.switching || document.hidden) return;
    if (this.kit.track?.readyState === 'ended') {
      this.switching = true;
      try {
        await this.kit.open({ deviceId: this.kit.deviceId });
        this.swapIn();
      } catch {} finally {
        this.switching = false;
      }
    }
    if (this.micOn && this.mic?.readyState === 'ended') {
      try {
        await this.openMic();
        this.swapIn();
      } catch {}
    }
  }

  /** Out of the show: the studio's told, the camera and microphone let go. */
  stop(why) {
    if (!this.on) return;
    clearInterval(this.timer);
    this.video.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
    this.link?.say({ t: 'leaving' });
    this.link?.leave();
    const sock = this.sock;
    setTimeout(() => sock?.close(), 500); // (after the studio's heard it's leaving)
    for (const t of [this.kit?.track, this.mic]) t?.stop();
    this.video.srcObject = null;
    this.kit = this.mic = this.sock = this.link = null;
    this.state = 'off';
    this.air = this.pvw = false;
    this.upright = null;
    session('auto');
    this.onChange();
    if (why) this.onEnded(why);
  }
}
