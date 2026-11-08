// What the phone's own sensors say about the shot.
//   gravity  → which way is really up (works with rotation lock on), and tilt
//   gyro     → shake
//   compass  → how fast the shooter is panning
// iPhones need permission, asked inside a tap: call requestPermission() first thing.

const TAU = 360;
const norm = (a) => ((a % TAU) + TAU) % TAU;
const diff = (a, b) => {
  const d = norm(a - b);
  return d > 180 ? d - 360 : d;
};

export function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return norm(screen.orientation.angle);
  if (typeof window.orientation === 'number') return norm(window.orientation);
  return 0;
}

export class Sensors {
  constructor() {
    this.g = null;            // latest gravity reading {x,y,z}
    this.physical = null;     // 0 / 90 / 180 / 270: how far the phone is turned (counter-clockwise) from upright portrait
    this.pending = null;
    this.inverted = /iPhone|iPad|iPod/.test(navigator.userAgent) ? null : false; // iOS reports gravity with flipped signs on some versions; we calibrate
    this.gyro = [];           // [time, deg/s]
    this.heading = [];        // [time, degrees]
    this.listeners = new Set();
    this.hasMotion = false;
    this.settleMs = 1000; // a turn has to hold this long (and the phone be steady) before it counts
  }

  /** Must run inside a tap on iPhones. Harmless elsewhere. */
  static async requestPermission() {
    const asks = [];
    if (window.DeviceMotionEvent?.requestPermission) asks.push(window.DeviceMotionEvent.requestPermission().catch(() => 'denied'));
    if (window.DeviceOrientationEvent?.requestPermission) asks.push(window.DeviceOrientationEvent.requestPermission().catch(() => 'denied'));
    const out = await Promise.all(asks);
    return out.every((x) => x === 'granted');
  }

  start() {
    window.addEventListener('devicemotion', (e) => this._motion(e));
    const onOri = (e) => this._orientation(e);
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOri);
    else window.addEventListener('deviceorientation', onOri);
    const onScreen = () => this._calibrate(true);
    screen.orientation?.addEventListener?.('change', onScreen);
    window.addEventListener('orientationchange', onScreen);
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _motion(e) {
    const a = e.accelerationIncludingGravity;
    if (a && a.x != null) {
      this.hasMotion = true;
      this.g = { x: a.x, y: a.y, z: a.z };
      this._orient();
    }
    const r = e.rotationRate;
    if (r && r.alpha != null) {
      const now = performance.now();
      this.gyro.push([now, Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0)]);
      while (this.gyro.length && now - this.gyro[0][0] > 1000) this.gyro.shift();
    }
  }

  _orientation(e) {
    let h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : e.absolute || e.type === 'deviceorientationabsolute' ? 360 - (e.alpha ?? 0) : null;
    if (h == null || Number.isNaN(h)) return;
    const now = performance.now();
    this.heading.push([now, norm(h)]);
    while (this.heading.length && now - this.heading[0][0] > 1000) this.heading.shift();
  }

  /** Raw angle the phone is turned, from gravity (0 = upright portrait, 90 = turned counter-clockwise). */
  rawAngle() {
    if (!this.g) return null;
    const s = this.inverted ? -1 : 1;
    const { x, y, z } = this.g;
    const flat = Math.abs(z) > 0.8 * Math.hypot(x, y, z);
    if (flat) return null; // lying flat: up is ambiguous, keep the last answer
    return norm((Math.atan2(s * x, s * y) * 180) / Math.PI);
  }

  _orient() {
    if (this.inverted === null) this._calibrate(false);
    const raw = this.rawAngle();
    if (raw == null) return;
    const snapped = norm(Math.round(raw / 90) * 90);
    if (this.physical === null) {
      this.physical = snapped;
      this._emit();
      return;
    }
    if (snapped === this.physical) {
      this.pending = null;
      return;
    }
    // Only switch when clearly in the new quadrant (within 35°), held there for a second,
    // and not mid-swing: a phone waved about or tipped for a moment doesn't count.
    const now = performance.now();
    if (Math.abs(diff(raw, snapped)) > 35) {
      this.pending = null;
      return;
    }
    const swinging = (this.shake() ?? 0) > 150;
    if (!this.pending || this.pending.to !== snapped || swinging) this.pending = { to: snapped, since: now };
    else if (now - this.pending.since >= this.settleMs) {
      this.physical = snapped;
      this.pending = null;
      this._emit();
    }
  }

  /** If the screen rotated with the phone, gravity should agree with it; if it's 180° off, flip the sign convention. */
  _calibrate(screenMoved) {
    if (!this.g) return;
    const save = this.inverted;
    this.inverted = false;
    const raw = this.rawAngle();
    this.inverted = save;
    if (raw == null) return;
    const sa = screenAngle();
    const off = Math.abs(diff(raw, sa));
    if (this.inverted === null || screenMoved) {
      if (off > 135) this.inverted = true;
      else if (off < 45) this.inverted = false;
    }
  }

  _emit() {
    for (const fn of this.listeners) fn(this.physical);
  }

  /**
   * How far to rotate the camera picture (counter-clockwise, degrees) to make it
   * world-upright. The browser already rotates the picture to match the screen, so
   * this is only non-zero when the screen didn't follow the phone (rotation lock).
   */
  correction() {
    if (this.physical === null) return 0;
    return norm(this.physical - screenAngle());
  }

  /** Degrees the camera points above or below the horizon (0 = level, 90 = straight down or up). */
  tilt() {
    if (!this.g) return null;
    const { x, y, z } = this.g;
    const m = Math.hypot(x, y, z) || 1;
    return (Math.asin(Math.min(1, Math.abs(z) / m)) * 180) / Math.PI;
  }

  shake() {
    if (!this.gyro.length) return null;
    return Math.sqrt(this.gyro.reduce((s, [, v]) => s + v * v, 0) / this.gyro.length);
  }

  panRate() {
    if (this.heading.length < 2) return null;
    const [t0] = this.heading[0];
    const [t1] = this.heading[this.heading.length - 1];
    let travel = 0;
    for (let i = 1; i < this.heading.length; i++) travel += Math.abs(diff(this.heading[i][1], this.heading[i - 1][1]));
    return t1 > t0 ? (travel / (t1 - t0)) * 1000 : null;
  }
}

/** Turn sensor readings and picture statistics into the director's 0..1 parts. */
export function partsFrom(sensors, pic) {
  const ramp = (x, bad, good) => (x == null ? undefined : Math.max(0, Math.min(1, (x - bad) / (good - bad))));
  const p = {};
  const shake = sensors?.shake();
  if (shake != null) p.steady = ramp(shake, 175, 25);
  const tilt = sensors?.tilt();
  if (tilt != null) p.level = ramp(tilt, 75, 35);
  const pan = sensors?.panRate();
  if (pan != null) p.pan = ramp(pan, 160, 40);
  if (pic) {
    const m = pic.luma;
    p.exposure = m < 55 ? ramp(m, 18, 55) : ramp(m, 245, 215);
    p.detail = Math.min(ramp(pic.std, 6, 22), ramp(pic.sharp, 1.2, 5));
    if (pic.diff != null) p.calm = ramp(pic.diff, 45, 12);
  }
  return p;
}

/** Cheap picture statistics from a tiny copy of the frame: brightness, contrast, sharpness, motion. */
export class PictureMeter {
  constructor(size = 48) {
    this.c = document.createElement('canvas');
    this.c.width = this.c.height = size;
    this.g = this.c.getContext('2d', { willReadFrequently: true });
    this.prev = null;
  }

  measure(source, rect) {
    const n = this.c.width;
    const sw = source.width || source.videoWidth, sh = source.height || source.videoHeight;
    if (!sw || !sh) return null;
    const r = rect || { x: 0, y: 0, w: 1, h: 1 };
    this.g.drawImage(source, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, n, n);
    const d = this.g.getImageData(0, 0, n, n).data;
    const L = new Float32Array(n * n);
    let sum = 0;
    for (let i = 0; i < n * n; i++) {
      L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      sum += L[i];
    }
    const mean = sum / (n * n);
    let v = 0, lap = 0, dif = 0;
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        lap += Math.abs(4 * L[i] - L[i - 1] - L[i + 1] - L[i - n] - L[i + n]);
      }
    }
    for (let i = 0; i < n * n; i++) {
      v += (L[i] - mean) ** 2;
      if (this.prev) dif += Math.abs(L[i] - this.prev[i]);
    }
    const out = { luma: mean, std: Math.sqrt(v / (n * n)), sharp: lap / ((n - 2) * (n - 2)), diff: this.prev ? dif / (n * n) : null };
    this.prev = L;
    return out;
  }
}
