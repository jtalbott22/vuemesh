// Camera-operator controls for the phone. Each one uses the phone's real feature when
// the browser offers it (Android Chrome offers most; iPhones offer some) and a digital
// stand-in when it doesn't, so the buttons always do something sensible:
//   zoom        native zoom → else a crop in the recorded picture
//   exposure    exposure compensation → else brightness in the recorded picture
//   focus       tap a point to focus and expose there (native only)
//   AE/AF lock  hold focus and exposure (native only)
//   torch, white-balance lock (native only)
// Lenses and microphones are separate choices, and both can change mid-recording.

export const QUALITY = {
  '720p30': { w: 1280, h: 720, fps: 30, label: '720p · 30' },
  '1080p30': { w: 1920, h: 1080, fps: 30, label: '1080p · 30' },
  '1080p60': { w: 1920, h: 1080, fps: 60, label: '1080p · 60' },
  '4k30': { w: 3840, h: 2160, fps: 30, label: '4K · 30' },
};

/** Which kind of lens a camera is, from its name. */
export function lensOf(label = '') {
  const l = label.toLowerCase();
  if (/front|user|facetime|selfie|truedepth/.test(l)) return 'front';
  if (/ultra ?wide|0\.5|ultrawide/.test(l)) return 'ultra';
  if (/tele/.test(l)) return 'tele';
  if (/triple|dual wide|dual/.test(l)) return 'multi';
  if (/back|rear|environment|wide|camera2 0|camera 0/.test(l)) return 'wide';
  return 'other';
}

/**
 * The plain 1× camera on a side, the way a camera app opens: on the back, the main
 * wide lens (not ultra-wide, telephoto, or a combined "dual/triple" camera); on the
 * front, the regular selfie camera (not an ultra-wide one).
 * @param cams [{deviceId, label}]   @param side 'back' | 'front'
 */
export function preferredCamera(cams, side) {
  const l = (c) => c.label.toLowerCase();
  const isFront = (c) => lensOf(c.label) === 'front';
  const pool = cams.filter((c) => (side === 'front' ? isFront(c) : !isFront(c)));
  if (!pool.length) return null;
  const plain = pool.filter((c) => !/ultra|tele|dual|triple|depth|infrared|ir camera|desk view|continuity/.test(l(c)));
  if (side === 'front') {
    return plain.sort((a, b) => a.label.length - b.label.length)[0] || pool.find((c) => !/ultra/.test(l(c))) || pool[0];
  }
  return plain.find((c) => /back camera|rear camera|back|rear/.test(l(c))) || plain[0] || pool.find((c) => lensOf(c.label) === 'multi') || pool[0];
}
const LENS_LABEL = { ultra: '0.5×', wide: '1×', tele: '2×', front: 'Front', multi: 'Auto', other: 'Cam' };
// (the lenses' order on the buttons: as a camera app has them, the front one last)
const LENS_ORDER = { ultra: 0, wide: 1, multi: 2, tele: 3, other: 4, front: 5 };
/** A phone's cameras (enumerateDevices' videoinputs, in its order), each with its lens, side and short name. */
export function labelCams(inputs) {
  const cams = inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}`, lens: lensOf(d.label) }));
  // Short lens names for the zoom rail; fall back to numbers when names say nothing.
  const counts = {};
  for (const c of cams) c.side = c.lens === 'front' ? 'front' : 'back';
  for (const c of cams) {
    counts[c.lens] = (counts[c.lens] || 0) + 1;
    const n = counts[c.lens];
    // Android names cameras "camera2 0, facing back": the first back one is the main 1×;
    // the others can't be told apart by name, so they're simply numbered.
    c.short = n === 1 ? LENS_LABEL[c.lens] : c.lens === 'wide' ? `Cam ${n}` : `${LENS_LABEL[c.lens]} ${n}`;
  }
  return cams;
}
/**
 * The remote's lens buttons, from a phone's cameras (devices(), in the order the phone lists them):
 * each plain back lens as a camera app names it (0.5×, 1×, 2×), and one front camera, "Front".
 * - An iPhone also lists its combined cameras, "Back Dual Wide" and "Back Triple": the phone picks a
 *   lens itself in those, so they're left off when it has plain ones to choose.
 * - An iPhone 17 lists two front cameras, and a second button, "Front 2", said nothing. The one kept
 *   is the first the phone lists, the one it opens itself for a selfie. Keeping the shortest name, as
 *   0.66.12 did, kept the second on an iPhone 17 Pro: its only front button said "Front 2", and the
 *   usual selfie camera wasn't there to choose.
 */
export function lensButtons(cams) {
  const all = [...cams].sort((a, b) => LENS_ORDER[a.lens] - LENS_ORDER[b.lens]);
  const plainOnes = all.filter((l) => l.lens !== 'multi');
  const list = plainOnes.some((l) => l.side === 'back') ? plainOnes : all;
  const fronts = cams.filter((l) => l.side === 'front');
  const front = fronts.find((l) => !/ultra|infrared/i.test(l.label)) || fronts[0];
  return list.filter((l) => l.side !== 'front' || l.deviceId === front?.deviceId).map((l) => (l.side === 'front' ? { ...l, short: 'Front' } : l));
}

/**
 * Camera settings a camera will take: each number put inside the camera's range and on its own
 * step (exposure in 1/3 or 1/6 EV, brightness in whole numbers, and so on). Asked as "advanced"
 * constraints, a set with one value the camera can't do exactly is dropped whole, silently: a
 * brightness of 159.4 on a camera that steps by 1 did nothing at all.
 */
export function snapToCamera(caps, set) {
  const out = {};
  for (const [k, v] of Object.entries(set || {})) {
    const c = caps?.[k];
    if (typeof v !== 'number' || !c || typeof c.min !== 'number' || typeof c.max !== 'number') {
      out[k] = v;
      continue;
    }
    let x = Math.min(c.max, Math.max(c.min, v));
    if (c.step > 0) x = Math.min(c.max, c.min + Math.round((x - c.min) / c.step) * c.step);
    out[k] = Math.round(x * 1e6) / 1e6;
  }
  return out;
}

export class CameraKit {
  constructor({ portrait = false } = {}) {
    this.portrait = portrait;
    this.track = null;
    this.deviceId = null;
    this.facing = 'environment';
    this.quality = '1080p30';
    this.zoom = 1;
    this.digitalZoom = 1;
    this.ev = 0;
    this.digitalEV = 0;
    this.locked = false;
    this.torch = false;
    this.wbLocked = false;
  }

  /** Cameras and microphones, labelled the way a camera app would. */
  async devices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    return { cams: labelCams(all.filter((d) => d.kind === 'videoinput')), mics };
  }

  constraints() {
    const q = QUALITY[this.quality] || QUALITY['1080p30'];
    // Always ask in the sensor's own landscape shape. The phone turns the picture to
    // match how it's held; asking for a portrait shape makes iPhones crop the sensor,
    // which looks like a hard zoom-in. Shape for the output is handled downstream.
    return {
      ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : { facingMode: { ideal: this.facing } }),
      width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps },
      resizeMode: { ideal: 'none' },
    };
  }

  /** Open (or switch to) a camera. Returns the new video track. */
  async open(opts = {}) {
    const before = { deviceId: this.deviceId, facing: this.facing };
    Object.assign(this, opts);
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: this.constraints() });
    } catch (e) {
      // Many Android phones can't run two cameras at once, so opening the next lens
      // while this one is live fails. Let go of the current camera and try again; if
      // that fails too, put the previous camera back. (iPhones never get here: they
      // hand over between cameras by themselves.)
      if (!this.track || this.track.readyState === 'ended') throw e;
      this.track.stop();
      try {
        s = await navigator.mediaDevices.getUserMedia({ video: this.constraints() });
      } catch (e2) {
        Object.assign(this, before);
        const back = await navigator.mediaDevices.getUserMedia({ video: this.constraints() }).catch(() => null);
        this.track = back?.getVideoTracks()[0] || null;
        this.restored = !!this.track;
        throw e2;
      }
    }
    const old = this.track;
    this.track = s.getVideoTracks()[0];
    if (old && old !== this.track) old.stop();
    const set = this.track.getSettings?.() || {};
    this.deviceId = set.deviceId || this.deviceId;
    if (set.facingMode) this.facing = set.facingMode;
    // Carry zoom and exposure over to the new lens where we can.
    this.digitalZoom = 1;
    this.digitalEV = 0;
    await this.setZoom(this.zoom).catch(() => {});
    await this.setExposure(this.ev).catch(() => {});
    return this.track;
  }

  caps() {
    try {
      return this.track?.getCapabilities?.() || {};
    } catch {
      return {};
    }
  }

  can(name) {
    const c = this.caps()[name];
    return c !== undefined && !(Array.isArray(c) && !c.length);
  }

  async apply(advanced) {
    await this.track.applyConstraints({ advanced: [snapToCamera(this.caps(), advanced)] });
  }

  zoomRange() {
    const z = this.caps().zoom;
    return z ? { min: z.min, max: Math.min(z.max, 10), step: z.step || 0.1, native: true } : { min: 1, max: 4, step: 0.05, native: false };
  }

  async setZoom(z) {
    const r = this.zoomRange();
    this.zoom = Math.min(r.max, Math.max(r.min, z));
    if (r.native) {
      this.digitalZoom = 1;
      await this.apply({ zoom: this.zoom });
    } else this.digitalZoom = this.zoom;
    return this.zoom;
  }

  async setExposure(ev) {
    this.ev = Math.max(-2, Math.min(2, ev));
    const c = this.caps().exposureCompensation;
    if (c) {
      this.digitalEV = 0;
      await this.apply({ exposureCompensation: Math.max(c.min, Math.min(c.max, this.ev)) });
    } else this.digitalEV = this.ev;
    return this.ev;
  }

  /** Focus and expose on a point (0..1 in the picture). */
  async focusAt(x, y) {
    if (!this.can('pointsOfInterest') && !this.can('focusMode')) return false;
    const adv = {};
    if (this.can('pointsOfInterest')) adv.pointsOfInterest = [{ x, y }];
    const modes = this.caps().focusMode || [];
    if (modes.includes('single-shot')) adv.focusMode = 'single-shot';
    else if (modes.includes('continuous')) adv.focusMode = 'continuous';
    if ((this.caps().exposureMode || []).includes('continuous')) adv.exposureMode = 'continuous';
    try {
      await this.apply(adv);
      this.locked = false;
      return true;
    } catch {
      return false;
    }
  }

  /** AE/AF lock: hold focus and exposure where they are. */
  async setLock(on) {
    const fm = this.caps().focusMode || [], em = this.caps().exposureMode || [];
    const adv = {};
    if (fm.includes(on ? 'manual' : 'continuous')) adv.focusMode = on ? 'manual' : 'continuous';
    if (em.includes(on ? 'manual' : 'continuous')) adv.exposureMode = on ? 'manual' : 'continuous';
    if (!Object.keys(adv).length) return false;
    try {
      await this.apply(adv);
      this.locked = on;
      return true;
    } catch {
      return false;
    }
  }

  async setTorch(on) {
    if (!this.can('torch')) return false;
    await this.apply({ torch: on });
    this.torch = on;
    return true;
  }

  async setWhiteBalanceLock(on) {
    const modes = this.caps().whiteBalanceMode || [];
    if (!modes.includes(on ? 'manual' : 'continuous')) return false;
    await this.apply({ whiteBalanceMode: on ? 'manual' : 'continuous' });
    this.wbLocked = on;
    return true;
  }
}
