// Drawing shared by the live program, the edit preview, and the offline renderer.
// Layers draw bottom-up, so the top track in the timeline wins, like Photoshop.

import { drawSlate } from './slates.js';
export { drawSlate };

export const PIP = {
  full: null,
  'top-right': { x: 0.66, y: 0.04, w: 0.3, h: 0.3 },
  'top-left': { x: 0.04, y: 0.04, w: 0.3, h: 0.3 },
  'bottom-right': { x: 0.66, y: 0.66, w: 0.3, h: 0.3 },
  'bottom-left': { x: 0.04, y: 0.66, w: 0.3, h: 0.3 },
  'left-half': { x: 0, y: 0, w: 0.5, h: 1 },
  'right-half': { x: 0.5, y: 0, w: 0.5, h: 1 },
};

/**
 * Draw a frame source (video element, image, VideoFrame) into a rect.
 * @param fit   'fill' crops to fill the rect, 'fit' shows everything with bars
 * @param rect  destination, normalised {x,y,w,h} (null = whole output)
 * @param src   part of the source to use, normalised {x,y,w,h} (null = all of it).
 *              VUEMesh phones record into a square; this is where the picture sits in it.
 * @param rot   extra clockwise rotation in degrees (0, 90, 180, 270)
 */
export function drawFramed(g, frame, W, H, fit = 'fill', rect = null, src = null, rot = 0) {
  const fw = frame.displayWidth || frame.videoWidth || frame.naturalWidth || frame.width;
  const fh = frame.displayHeight || frame.videoHeight || frame.naturalHeight || frame.height;
  if (!fw || !fh) return;
  const sx = src ? src.x * fw : 0, sy = src ? src.y * fh : 0;
  const sw = src ? src.w * fw : fw, sh = src ? src.h * fh : fh;
  const turned = rot % 180 !== 0;
  const cw = turned ? sh : sw, ch = turned ? sw : sh; // size once rotated
  const rx = rect ? rect.x * W : 0, ry = rect ? rect.y * H : 0;
  const rw = rect ? rect.w * W : W, rh = rect ? rect.h * H : H;
  const k = fit === 'fit' ? Math.min(rw / cw, rh / ch) : Math.max(rw / cw, rh / ch);
  g.save();
  g.beginPath();
  g.rect(rx, ry, rw, rh);
  g.clip();
  if (fit === 'fit' && rect) {
    g.fillStyle = '#000';
    g.fillRect(rx, ry, rw, rh);
  }
  g.translate(rx + rw / 2, ry + rh / 2);
  if (rot) g.rotate((rot * Math.PI) / 180);
  g.drawImage(frame, sx, sy, sw, sh, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
  g.restore();
  if (rect) {
    g.strokeStyle = '#ffffffcc';
    g.lineWidth = Math.max(2, W / 640);
    g.strokeRect(rx, ry, rw, rh);
  }
}

/** A clip's transform, with defaults: centre (x, y as 0..1 of the output), scale, rotation (°), crop (0..1 of the picture per side), opacity. */
export const DEFAULT_TF = { x: 0.5, y: 0.5, s: 1, r: 0, crop: { l: 0, t: 0, r: 0, b: 0 }, o: 1 };
export const tfOf = (item) => ({ ...DEFAULT_TF, ...(item.tf || {}), crop: { ...DEFAULT_TF.crop, ...(item.tf?.crop || {}) } });

/** Ready-made layouts, as transforms. */
export const TF_PRESETS = {
  full: { x: 0.5, y: 0.5, s: 1 },
  'top-right': { x: 0.81, y: 0.19, s: 0.3 },
  'top-left': { x: 0.19, y: 0.19, s: 0.3 },
  'bottom-right': { x: 0.81, y: 0.81, s: 0.3 },
  'bottom-left': { x: 0.19, y: 0.81, s: 0.3 },
  'left-half': { x: 0.25, y: 0.5, s: 0.5 },
  'right-half': { x: 0.75, y: 0.5, s: 0.5 },
};

/**
 * Where a transformed picture lands in the output. Scale is measured on the whole picture
 * (fill at scale 1 covers the frame, as in every editor); crop then trims its edges in
 * place, revealing whatever is underneath. Returns the visible box (centre, size, angle)
 * in output pixels, shared by drawing and by the on-screen handles so they always agree.
 * @param sw, sh   picture size before cropping (after the phone's square is trimmed to the shot)
 * @param baseRot  rotation already needed to make the picture upright (from the phone or the file)
 */
export function transformBox(tf, W, H, sw, sh, fit, baseRot = 0) {
  const turned = baseRot % 180 !== 0;
  const uw = turned ? sh : sw, uh = turned ? sw : sh; // upright size of the whole picture
  const k = (fit === 'fit' ? Math.min(W / uw, H / uh) : Math.max(W / uw, H / uh)) * tf.s;
  const c = tf.crop;
  const cw = sw * (1 - c.l - c.r), ch = sh * (1 - c.t - c.b); // visible part, in picture pixels
  // centre of the visible part relative to the picture's centre, in picture pixels, then
  // turned into output pixels (by the upright correction and the clip's own rotation)
  const ox = ((c.l - c.r) / 2) * sw * k, oy = ((c.t - c.b) / 2) * sh * k;
  const a = ((tf.r + baseRot) * Math.PI) / 180;
  const cx = tf.x * W + ox * Math.cos(a) - oy * Math.sin(a);
  const cy = tf.y * H + ox * Math.sin(a) + oy * Math.cos(a);
  const vw = cw * k, vh = ch * k;
  return { cx, cy, w: turned ? vh : vw, h: turned ? vw : vh, angle: tf.r, k, cw, ch, ox, oy };
}

/** Draw with a full transform: position, scale, rotation, crop (trims in place), opacity. */
export function drawTransformed(g, frame, W, H, fit, src, baseRot, tf) {
  const fw = frame.displayWidth || frame.videoWidth || frame.naturalWidth || frame.width;
  const fh = frame.displayHeight || frame.videoHeight || frame.naturalHeight || frame.height;
  if (!fw || !fh) return;
  const sx = src ? src.x * fw : 0, sy = src ? src.y * fh : 0;
  const sw = src ? src.w * fw : fw, sh = src ? src.h * fh : fh;
  const b = transformBox(tf, W, H, sw, sh, fit, baseRot);
  if (b.cw < 1 || b.ch < 1 || tf.o <= 0) return;
  g.save();
  g.globalAlpha *= tf.o;
  g.translate(tf.x * W, tf.y * H);
  g.rotate(((tf.r + baseRot) * Math.PI) / 180);
  // the whole picture is centred here at scale k; draw only its uncropped part, in place
  g.drawImage(frame, sx + sw * tf.crop.l, sy + sh * tf.crop.t, b.cw, b.ch,
    (-sw * b.k) / 2 + sw * tf.crop.l * b.k, (-sh * b.k) / 2 + sh * tf.crop.t * b.k, b.cw * b.k, b.ch * b.k);
  g.restore();
}

export function drawTitle(g, W, H, item) {
  const u = Math.min(W, H);
  g.textBaseline = 'middle';
  if (item.style === 'card') {
    g.fillStyle = '#0d1226';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.fillStyle = '#fff';
    g.font = `800 ${Math.round(u * 0.09)}px Archivo, system-ui, sans-serif`;
    g.fillText(item.text || '', W / 2, H * 0.46, W * 0.9);
    g.fillStyle = '#b9bfd6';
    g.font = `600 ${Math.round(u * 0.045)}px Archivo, system-ui, sans-serif`;
    g.fillText(item.sub || '', W / 2, H * 0.58, W * 0.9);
    return;
  }
  // lower third
  const pad = u * 0.03;
  g.font = `800 ${Math.round(u * 0.055)}px Archivo, system-ui, sans-serif`;
  const tw = g.measureText(item.text || '').width;
  g.font = `600 ${Math.round(u * 0.032)}px Archivo, system-ui, sans-serif`;
  const sw = g.measureText(item.sub || '').width;
  const bw = Math.max(tw, sw) + pad * 2;
  const bh = u * (item.sub ? 0.15 : 0.1);
  const bx = W * 0.05, by = H * 0.8 - bh;
  g.fillStyle = '#0d1226e6';
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = '#d93025';
  g.fillRect(bx, by, u * 0.008, bh);
  g.textAlign = 'left';
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(u * 0.055)}px Archivo, system-ui, sans-serif`;
  g.fillText(item.text || '', bx + pad, by + (item.sub ? bh * 0.36 : bh / 2));
  if (item.sub) {
    g.fillStyle = '#b9bfd6';
    g.font = `600 ${Math.round(u * 0.032)}px Archivo, system-ui, sans-serif`;
    g.fillText(item.sub, bx + pad, by + bh * 0.72);
  }
}

/** Opacity for fades in and out at the item's edges. */
export function fadeAlpha(item, t) {
  const a = item.fadeIn ? Math.min(1, (t - item.start) / item.fadeIn) : 1;
  const b = item.fadeOut ? Math.min(1, (item.start + item.dur - t) / item.fadeOut) : 1;
  return Math.max(0, Math.min(a, b));
}

/**
 * Composite one output frame.
 * @param getSource (item, sourceMs) => drawable | null
 */
export function composeFrame(g, W, H, seq, t, getSource, opts = {}) {
  g.globalAlpha = 1;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const tracks = seq.tracks.filter((k) => k.kind === 'video' && !k.hidden);
  for (let i = tracks.length - 1; i >= 0; i--) {
    const item = tracks[i].items.find((it) => t >= it.start && t < it.start + it.dur);
    if (!item) continue;
    let alpha = fadeAlpha(item, t);
    if (alpha <= 0) continue;
    // a dissolve into this shot: the one before it carries on underneath, this fades in over it
    const xd = item.type === 'clip' && item.transIn?.dur > 0 ? Math.min(item.transIn.dur, item.dur) : 0;
    if (xd && t < item.start + xd) {
      const prev = tracks[i].items.find((o) => o !== item && o.type === 'clip' && Math.abs(o.start + o.dur - item.start) < 34);
      if (prev) {
        g.globalAlpha = 1;
        drawClip(g, W, H, prev, t, getSource, opts);
        alpha *= Math.max(0, Math.min(1, (t - item.start) / xd));
      }
    }
    g.globalAlpha = alpha;
    if (item.type === 'title') drawTitle(g, W, H, item);
    else if (item.type === 'slate') drawSlate(g, W, H, { message: item.text || "We'll be right back", title: opts.title || '', look: item.look, t: t - item.start, now: seq.origin != null ? seq.origin + t : undefined });
    else drawClip(g, W, H, item, t, getSource, opts);
    g.globalAlpha = 1;
  }
}
/** One clip (or image) at time t (a held shot, past its end, too: its recording carries on). */
function drawClip(g, W, H, item, t, getSource, opts) {
  const ms = (item.in || 0) + (t - item.start) * (item.speed || 1);
  const src = getSource(item, ms);
  const view = item.type === 'clip' && opts.viewOf ? opts.viewOf(item, ms) : null; // {rect, rot} from the phone's orientation log
  const rot = ((view?.rot || 0) + (item.rot || 0)) % 360;
  // digital exposure and contrast the phone used while shooting (set there, or by the director)
  const look = [view?.ev ? `brightness(${(2 ** (view.ev * 0.5)).toFixed(3)})` : '', view?.ct ? `contrast(${view.ct})` : ''].filter(Boolean).join(' ');
  if (look) g.filter = look;
  if (src && item.tf) drawTransformed(g, src, W, H, item.fit || opts.fit || 'fill', view?.rect || null, rot, tfOf(item));
  else if (src) drawFramed(g, src, W, H, item.fit || opts.fit || 'fill', item.rect || null, view?.rect || null, rot);
  if (look) g.filter = 'none';
}

/** A brick-wall-ish limiter so several sources summed together never clip. */
export function limiter(ctx) {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -3;
  c.knee.value = 3;
  c.ratio.value = 20;
  c.attack.value = 0.003;
  c.release.value = 0.2;
  return c;
}
