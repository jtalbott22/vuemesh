// The studio's face finder, off the page's own thread (a busy page would stutter the program).
// MediaPipe's face landmarker (public/vendor/mediapipe: on this computer, its usage logging taken
// out), one picture at a time from any camera: for each face, where it is, where its eyes are,
// how open its mouth and eyes are, and which way it's turned. Nothing else leaves here, and
// nothing leaves this computer. A classic worker: MediaPipe's loader needs importScripts.
/* global Vision */
importScripts('/vendor/mediapipe/vision_bundle.js');

let lm = null, pose = null, delegate = null, busy = false;

async function make(base, model, only, poseModel) {
  const fileset = await Vision.FilesetResolver.forVisionTasks(base);
  const buf = new Uint8Array(await (await fetch(model)).arrayBuffer());
  // (a worker has no page: MediaPipe draws each picture onto a canvas of its own, for either delegate)
  const opts = (d) => ({
    canvas: new OffscreenCanvas(1, 1),
    baseOptions: { modelAssetBuffer: buf, delegate: d },
    runningMode: 'IMAGE', // (pictures from several cameras, one after another: no tracking between them; faces.js follows them)
    numFaces: 4,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
  });
  // (MediaPipe takes pictures in through WebGL, on the graphics card or the processor alike)
  const g = new OffscreenCanvas(1, 1).getContext('webgl2');
  if (!g) throw new Error('this browser has WebGL turned off (graphics acceleration), which face tracking needs');
  // (WebGL drawn by the processor, with no graphics card: MediaPipe's own processor path is several times faster)
  const dbg = g.getExtension('WEBGL_debug_renderer_info');
  const soft = /swiftshader|llvmpipe|software|basic render/i.test(g.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : g.RENDERER) || '');
  try {
    if (only === 'CPU' || soft) throw new Error('the processor');
    lm = await Vision.FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    delegate = 'GPU';
  } catch {
    lm = await Vision.FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    delegate = 'CPU';
  }
  // people's poses: where a head is when its face can't be seen (turned away, looking down at a
  // guitar, small in a wide shot). Without it, faces alone.
  if (poseModel) {
    try {
      const pbuf = new Uint8Array(await (await fetch(poseModel)).arrayBuffer());
      pose = await Vision.PoseLandmarker.createFromOptions(fileset, {
        canvas: new OffscreenCanvas(1, 1),
        baseOptions: { modelAssetBuffer: pbuf, delegate },
        runningMode: 'IMAGE', numPoses: 4, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5,
      });
    } catch {
      pose = null;
    }
  }
}

/**
 * A head from a pose (33 points, 0..1 of the picture's width and height): where it is, about
 * how big, where the eyes are, and which way it's turned. No mouth or eyes open: a pose can't say.
 * (0 nose, 2 and 5 the eyes, 7 and 8 the ears, 9 and 10 the mouth, 11 and 12 the shoulders)
 */
function headFrom(pts, W, H) {
  const ok = (i) => pts[i] && (pts[i].visibility ?? 1) > 0.5;
  const px = (i) => ({ x: pts[i].x * W, y: pts[i].y * H });
  const head = [0, 2, 5, 7, 8, 9, 10].filter(ok).map(px);
  if (head.length < 3) return null;
  // (a person, upright: the head above the shoulders, and the hips, when seen, below them. The
  // pose finder sometimes sees an upside-down "person" in an arm along a guitar's neck)
  const mean = (ps) => ps.reduce((a, p) => a + p.y, 0) / ps.length;
  const sh = [11, 12].filter(ok).map(px), hips = [23, 24].filter(ok).map(px);
  if (!sh.length || mean(head) >= mean(sh)) return null;
  if (hips.length && mean(hips) <= mean(sh)) return null;
  const d = (a, b) => (ok(a) && ok(b) ? Math.hypot(px(a).x - px(b).x, px(a).y - px(b).y) : 0);
  // how big: ears apart, eyes apart (both small side-on), nose to ear (side-on), shoulders apart
  const w = Math.max(d(7, 8) * 1.15, d(2, 5) * 2.6, Math.max(d(0, 7), d(0, 8)) * 1.6, d(11, 12) * 0.42);
  if (!w) return null;
  const h = w * 1.25;
  const cx = head.reduce((a, p) => a + p.x, 0) / head.length;
  const eyes = [2, 5].filter(ok).map(px);
  const ey = eyes.length ? eyes.reduce((a, p) => a + p.y, 0) / eyes.length : ok(0) ? px(0).y - h * 0.08 : head[0].y;
  let yaw = 0;
  if (ok(0) && ok(7) && ok(8)) yaw = clamp(((px(0).x - (px(7).x + px(8).x) / 2) / (d(7, 8) || 1)) * 2.2, -1, 1);
  else if (ok(0) && (ok(7) || ok(8))) yaw = Math.sign(px(0).x - px(ok(7) ? 7 : 8).x) * 0.9; // (one ear: side-on)
  const r = (v) => Math.round(v * 1000) / 1000;
  const x0 = clamp(cx - w / 2, 0, W), y0 = clamp(ey - h * 0.42, 0, H);
  return {
    box: { x: r(x0 / W), y: r(y0 / H), w: r((clamp(cx + w / 2, 0, W) - x0) / W), h: r((clamp(y0 + h, 0, H) - y0) / H) },
    eyes: { x: r(cx / W), y: r(ey / H) }, mouth: null, eyesOpen: null, yaw: r(yaw), pose: true,
  };
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** One face, in the shot's own 0..1. */
function summarise(pts, shapes) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const s = {};
  for (const c of shapes?.categories || []) s[c.categoryName] = c.score;
  // eyes: the irises' centres (468, 473); turned: the nose tip (1) against the eyes' outer corners (33, 263)
  const a = pts[468] || pts[33], b = pts[473] || pts[263];
  const ca = pts[33], cb = pts[263], nose = pts[1];
  const eyeDist = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1e-3;
  const yaw = clamp(((nose.x - (ca.x + cb.x) / 2) / eyeDist) * 2.2, -1, 1);
  // mouth: the jaw's opening, or the gap between the lips (13, 14) against the face's height
  const gap = Math.abs(pts[14].y - pts[13].y) / Math.max(1e-3, y1 - y0);
  const mouth = clamp(Math.max(s.jawOpen ?? 0, gap * 3), 0, 1);
  const eyesOpen = 1 - Math.max(s.eyeBlinkLeft ?? 0, s.eyeBlinkRight ?? 0);
  const r = (v) => Math.round(v * 1000) / 1000;
  return {
    box: { x: r(clamp(x0, 0, 1)), y: r(clamp(y0, 0, 1)), w: r(clamp(x1, 0, 1) - clamp(x0, 0, 1)), h: r(clamp(y1, 0, 1) - clamp(y0, 0, 1)) },
    eyes: { x: r((a.x + b.x) / 2), y: r((a.y + b.y) / 2) },
    mouth: r(mouth), eyesOpen: r(eyesOpen), yaw: r(yaw),
  };
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.init) {
    try {
      await make(m.init.base, m.init.model, m.init.delegate, m.init.pose);
      self.postMessage({ ready: true, delegate, pose: !!pose });
    } catch (err) {
      self.postMessage({ error: String(err?.message || err) });
    }
    return;
  }
  if (m.frame) {
    const bmp = m.frame;
    if (!lm || busy) {
      bmp.close();
      return self.postMessage({ cam: m.cam, t: m.t, skipped: true });
    }
    busy = true;
    const t0 = performance.now();
    try {
      const r = lm.detect(bmp);
      const faces = (r.faceLandmarks || []).map((pts, i) => summarise(pts, r.faceBlendshapes?.[i]));
      const heads = m.pose && pose ? (pose.detect(bmp).landmarks || []).map((pts) => headFrom(pts, bmp.width, bmp.height)).filter(Boolean) : [];
      self.postMessage({ cam: m.cam, t: m.t, faces, heads, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      self.postMessage({ cam: m.cam, t: m.t, error: String(err?.message || err) });
    } finally {
      bmp.close();
      busy = false;
    }
  }
};
