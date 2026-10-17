"""The screens: VUEMesh on the white screens in the films, and on-air tags on the action shots.

The stills were made with every screen plain white (the kiosk, phones, laptops, the LED wall, the
big board), so here each one is found in every frame of its clip, tracked as the camera drifts,
and the real thing drawn into it: the join code, a phone's view, the studio's multiviewer, the
crew's camera control, a fan cam, the finished film. It's warped to the screen's angle, shaded
like the white it replaces, and only drawn where that white is, so a hand in front of a phone
stays in front. A shot's "screen" in shots.json says what goes there.

Needs: numpy, opencv-python-headless, pillow, segno (pip install numpy opencv-python-headless pillow segno).
"""
import math
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
INK, PAPER, TALLY, PREVIEW, AMBER = (243, 244, 246), (15, 16, 19), (255, 47, 42), (47, 213, 107), (255, 178, 30)
_fonts = {}


def font(size, bold=True):
    key = (size, bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(os.path.join(FONTS, "BarlowCondensed-Bold.ttf" if bold else "BarlowCondensed-Medium.ttf"), max(8, int(size)))
    return _fonts[key]


# ------------------------------------------------------------ frames to draw from --

class Frames:
    """A clip's frames, small, for drawing into screens (looping)."""
    cache = {}

    def __init__(self, path, width=420):
        self.frames = []
        if path and os.path.exists(path):
            if path in Frames.cache:
                self.frames = Frames.cache[path]
                return
            cap = cv2.VideoCapture(path)
            while len(self.frames) < 240:
                ok, f = cap.read()
                if not ok:
                    break
                h = int(f.shape[0] * width / f.shape[1])
                self.frames.append(cv2.cvtColor(cv2.resize(f, (width, h), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB))
            cap.release()
            Frames.cache[path] = self.frames

    def at(self, i):
        if not self.frames:
            return None
        return Image.fromarray(self.frames[i % len(self.frames)])


def cover(img, w, h):
    """img scaled to fill w x h, cropped to fit."""
    if img is None:
        return Image.new("RGB", (w, h), (30, 34, 40))
    s = max(w / img.width, h / img.height)
    img = img.resize((max(1, int(img.width * s)), max(1, int(img.height * s))), Image.BILINEAR)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def chip(d, xy, text, size, fill=TALLY, ink=(255, 255, 255), pad=0.35):
    f = font(size)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    x, y = xy
    p = int(size * pad)
    d.rectangle((x, y, x + (r - l) + 2 * p, y + (b - t) + 2 * p), fill=fill)
    d.text((x + p - l, y + p - t), text, font=f, fill=ink)
    return x + (r - l) + 2 * p


def centred(d, w, y, text, size, fill=INK, bold=True):
    f = font(size, bold)
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    while r - l > w * 0.92 and size > 10:
        size *= 0.9
        f = font(size, bold)
        l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((w - (r - l)) / 2 - l, y - t), text, font=f, fill=fill)
    return y + (b - t)


# ------------------------------------------------------------------ the screens --

def qr_image(data, px):
    import segno
    q = segno.make(data, error="m")
    n = q.symbol_size(border=2)[0]
    img = Image.new("RGB", (n, n), (255, 255, 255))
    pix = img.load()
    for y, row in enumerate(q.matrix_iter(border=2)):
        for x, on in enumerate(row):
            if on:
                pix[x, y] = (20, 22, 30)
    return img.resize((px, px), Image.NEAREST)


def draw_kiosk(spec, w, h, i, fps, src):
    """The join screen: the code (pulsing, as the kiosk's does), what to do, and the show's name."""
    t = i / fps
    img = Image.new("RGB", (w, h), PAPER)
    d = ImageDraw.Draw(img)
    pulse = 0.5 + 0.5 * math.sin(t * 2 * math.pi / 1.6)
    code = "VRQ664"
    wide = w / h > 1.25
    q = int(min(h * 0.62, w * (0.42 if wide else 0.62)))
    qr = qr_image(f"https://vuemesh.com/cam?e={code}", q)
    if wide:
        qx, qy = int(w * 0.06), (h - q) // 2
        tx, tw = qx + q + int(w * 0.05), w - (qx + q + int(w * 0.09))
    else:
        qx, qy = (w - q) // 2, int(h * 0.2)
        tx, tw = int(w * 0.05), int(w * 0.9)
    b = max(3, int(q * 0.035))
    ring = tuple(int(PREVIEW[k] * (0.55 + 0.45 * pulse) + PAPER[k] * (0.45 - 0.45 * pulse)) for k in range(3))
    d.rectangle((qx - b * 2, qy - b * 2, qx + q + b * 2, qy + q + b * 2), fill=ring)
    d.rectangle((qx - b, qy - b, qx + q + b, qy + q + b), fill=(255, 255, 255))
    img.paste(qr, (qx, qy))
    if wide:
        sub = Image.new("RGB", (tw, h), PAPER)
        sd = ImageDraw.Draw(sub)
        y = centred(sd, tw, int(h * 0.22), spec.get("call", "Scan to join"), h * 0.13) + h * 0.06
        y = centred(sd, tw, y, spec.get("title", ""), h * 0.1, AMBER) + h * 0.07
        centred(sd, tw, y, f"or vuemesh.com/cam · {code}", h * 0.055, (195, 198, 207), bold=False)
        img.paste(sub, (tx, 0))
    else:
        centred(d, w, int(h * 0.05), spec.get("call", "Scan to join"), h * 0.08)
        y = centred(d, w, qy + q + int(h * 0.05), spec.get("title", ""), h * 0.06, AMBER) + h * 0.03
        centred(d, w, y, f"or vuemesh.com/cam · {code}", h * 0.035, (195, 198, 207), bold=False)
    # the VUEMesh mark
    r = max(4, int(h * 0.018))
    d.ellipse((int(w * 0.03), int(h * 0.04), int(w * 0.03) + 2 * r, int(h * 0.04) + 2 * r), fill=TALLY)
    d.text((int(w * 0.03) + 3 * r, int(h * 0.04) - r * 0.6), "VUEMesh", font=font(r * 3), fill=INK)
    return img


def draw_phone(spec, w, h, i, fps, src):
    """A guest's phone, in: what it sees, recording, on air."""
    img = cover(src(spec.get("from")).at(i), w, h)
    d = ImageDraw.Draw(img)
    s = min(w, h)
    chip(d, (int(s * 0.05), int(s * 0.05)), "● REC", s * 0.07)
    chip(d, (int(s * 0.05), int(h - s * 0.17)), spec.get("label", "You're in"), s * 0.065, fill=(0, 0, 0))
    if (i // int(fps * 0.6)) % 2 == 0:
        chip(d, (int(w - s * 0.32), int(s * 0.05)), "ON AIR", s * 0.07)
    return img


def draw_studio(spec, w, h, i, fps, src):
    """The studio's multiviewer: the program (cutting between the cameras), and the cameras."""
    img = Image.new("RGB", (w, h), (11, 12, 15))
    d = ImageDraw.Draw(img)
    tiles = spec.get("tiles", [])[:4]
    names = spec.get("names", [])
    bar = int(h * 0.08)
    d.rectangle((0, 0, w, bar), fill=(20, 22, 27))
    chip(d, (int(bar * 0.3), int(bar * 0.18)), "●", bar * 0.5, fill=(20, 22, 27), ink=TALLY, pad=0.1)
    d.text((int(bar * 1.0), int(bar * 0.12)), f"VUEMesh · {spec.get('title', '')}", font=font(bar * 0.62), fill=INK)
    on = int((i / fps) // 2.2) % max(1, len(tiles))
    g = int(h * 0.012)
    pw = int(w * 0.68)
    ph = h - bar - 2 * g
    img.paste(cover(src(tiles[on] if tiles else None).at(i), pw - 2 * g, ph - 2 * g), (g * 2, bar + g * 2))
    d.rectangle((g, bar + g, pw, bar + g + ph), outline=TALLY, width=g)
    chip(d, (g * 3, bar + g * 3), "PROGRAM", h * 0.045)
    tw, th = w - pw - 3 * g, (ph - 3 * g) // 4
    for k, clip in enumerate(tiles):
        x, y = pw + 2 * g, bar + g + k * (th + g)
        img.paste(cover(src(clip).at(i + 17 * k), tw, th), (x, y))
        d.rectangle((x, y, x + tw, y + th), outline=TALLY if k == on else (60, 66, 76), width=max(2, g // 2))
        chip(d, (x + g, y + th - int(h * 0.05)), f"{k + 1} {names[k] if k < len(names) else ''}", h * 0.035, fill=(0, 0, 0))
    return img


def draw_ccu(spec, w, h, i, fps, src):
    """Camera control: a strip per camera (its picture, exposure and colour), one being adjusted."""
    img = Image.new("RGB", (w, h), (14, 16, 20))
    d = ImageDraw.Draw(img)
    tiles = spec.get("tiles", [])[:3]
    names = spec.get("names", [])
    n = max(1, len(tiles))
    g = int(w * 0.02)
    sw = (w - (n + 1) * g) // n
    active = int((i / fps) // 1.8) % n
    for k, clip in enumerate(tiles):
        x = g + k * (sw + g)
        d.rectangle((x, g, x + sw, h - g), fill=(24, 27, 33), outline=PREVIEW if k == active else (50, 56, 66), width=max(2, g // 3))
        th = int(sw * 9 / 16)
        img.paste(cover(src(clip).at(i + 11 * k), sw - 2 * g, th), (x + g, 2 * g))
        d.text((x + g, 3 * g + th), names[k] if k < len(names) else f"CAM {k + 1}", font=font(h * 0.06), fill=INK)
        for j, (label, base) in enumerate((("IRIS", 0.55), ("WB", 0.4), ("GAIN", 0.3))):
            y = int(3 * g + th + h * 0.12 + j * h * 0.13)
            v = base + (0.18 * math.sin(i / fps * 2.4) if k == active and j == 0 else 0)
            d.text((x + g, y - h * 0.045), label, font=font(h * 0.04, False), fill=(170, 176, 186))
            d.rectangle((x + g, y, x + sw - g, y + max(3, int(h * 0.018))), fill=(50, 56, 66))
            d.rectangle((x + g, y, x + g + int((sw - 2 * g) * v), y + max(3, int(h * 0.018))), fill=PREVIEW if k == active else (140, 148, 160))
    return img


def draw_film(spec, w, h, i, fps, src):
    """The finished film on a phone: the cut, with who shot it."""
    clips = spec.get("from", [])
    k = int((i / fps) // 2.5) % max(1, len(clips))
    img = cover(src(clips[k] if clips else None).at(i), w, h)
    d = ImageDraw.Draw(img)
    s = min(w, h)
    d.rectangle((0, int(h - s * 0.2), w, h), fill=(0, 0, 0))
    d.rectangle((int(s * 0.05), int(h - s * 0.16), int(s * 0.07), int(h - s * 0.05)), fill=TALLY)
    d.text((int(s * 0.1), int(h - s * 0.17)), spec.get("credit", ""), font=font(s * 0.085), fill=INK)
    d.rectangle((0, int(h - s * 0.012), int(w * ((i / fps) % 10) / 10), h), fill=TALLY)
    return img


def draw_fancam(spec, w, h, i, fps, src):
    """The big board's fan cam: a phone in the crowd, live."""
    img = cover(src(spec.get("from")).at(i), w, h)
    d = ImageDraw.Draw(img)
    s = min(w, h)
    d.rectangle((0, 0, w - 1, h - 1), outline=TALLY, width=max(3, int(s * 0.02)))
    x = chip(d, (int(s * 0.05), int(h - s * 0.2)), "LIVE", s * 0.08)
    chip(d, (x + int(s * 0.02), int(h - s * 0.2)), spec.get("label", "Fan cam"), s * 0.08, fill=(0, 0, 0))
    return img


DRAW = {"kiosk": draw_kiosk, "phone": draw_phone, "studio": draw_studio, "ccu": draw_ccu, "film": draw_film, "fancam": draw_fancam}


# ------------------------------------------------------------ finding the screen --

def white_mask(frame):
    """Where the frame is screen-white: bright and colourless (relative to this frame)."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    v, s = hsv[:, :, 2], hsv[:, :, 1]
    bright = max(165, int(np.percentile(v, 99.5)) - 45)
    m = ((v >= bright) & (s <= 55)).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))


def order(pts):
    pts = np.array(pts, dtype=np.float32).reshape(4, 2)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.array([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]], dtype=np.float32)


def find_screen(frame, prev=None):
    """The screen's four corners (TL, TR, BR, BL), or None: the biggest bright, colourless,
    four-sided shape (near where it was last frame, when there was one)."""
    m = white_mask(frame)
    h, w = m.shape
    best, best_score = None, 0
    for c in cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[0]:
        area = cv2.contourArea(c)
        if area < 0.0035 * w * h:
            continue
        hull = cv2.convexHull(c)
        peri = cv2.arcLength(hull, True)
        quad = None
        for eps in (0.02, 0.035, 0.05, 0.08):
            a = cv2.approxPolyDP(hull, eps * peri, True)
            if len(a) == 4:
                quad = a
                break
        if quad is None:
            quad = cv2.boxPoints(cv2.minAreaRect(hull))
        quad = order(quad)
        solidity = area / max(1.0, cv2.contourArea(hull))
        score = area * solidity ** 2
        if prev is not None:
            dist = np.linalg.norm(quad.mean(0) - prev.mean(0)) / math.hypot(w, h)
            score *= max(0.05, 1 - 4 * dist)
        if score > best_score:
            best, best_score = quad, score
    return best


def track(path):
    """The screen's corners in every frame, smoothed (gaps filled from the nearest frames found)."""
    cap = cv2.VideoCapture(path)
    quads, prev = [], None
    while True:
        ok, f = cap.read()
        if not ok:
            break
        q = find_screen(f, prev)
        if q is not None and prev is not None:
            # a sudden jump is a mistake (a bright shirt, a light): ignore it
            if np.linalg.norm(q.mean(0) - prev.mean(0)) > 0.12 * math.hypot(*f.shape[:2][::-1]):
                q = None
        quads.append(q)
        if q is not None:
            prev = q
    cap.release()
    found = [k for k, q in enumerate(quads) if q is not None]
    if not found:
        return None, 0.0
    for k in range(len(quads)):
        if quads[k] is None:
            quads[k] = quads[min(found, key=lambda j: abs(j - k))]
    arr = np.stack(quads)
    smooth = arr.copy()
    for k in range(len(arr)):
        a, b = max(0, k - 3), min(len(arr), k + 4)
        smooth[k] = np.median(arr[a:b], axis=0)
    return smooth, len(found) / len(quads)


# ------------------------------------------------------------------ compositing --

def composite(frame, overlay, quad):
    """overlay (PIL) into frame (BGR) at quad: warped, shaded like the white it replaces, only
    where that white is (so whatever's in front stays in front), edges softened."""
    h, w = frame.shape[:2]
    ov = cv2.cvtColor(np.array(overlay), cv2.COLOR_RGB2BGR).astype(np.float32)
    oh, ow = ov.shape[:2]
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [ow, 0], [ow, oh], [0, oh]]), quad)
    warped = cv2.warpPerspective(ov, M, (w, h), flags=cv2.INTER_LINEAR)
    inside = cv2.warpPerspective(np.ones((oh, ow), np.float32), M, (w, h))
    white = cv2.dilate(white_mask(frame), np.ones((3, 3), np.uint8)).astype(np.float32) / 255
    # the screen's edge pixels blend into the bezel: grow the white a little inside the screen
    inside_core = cv2.erode((inside > 0.5).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    alpha = np.clip(np.maximum(white, inside_core * 0.0) * inside, 0, 1)
    alpha = cv2.GaussianBlur(alpha, (5, 5), 0)
    # shading: the white's own brightness (glare, falloff) carried onto the screen's picture
    v = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)[:, :, 2].astype(np.float32)
    sel = v[alpha > 0.5]
    ref = np.percentile(sel, 90) if sel.size else 255
    shade = np.clip(cv2.GaussianBlur(v, (0, 0), 9) / max(1.0, ref), 0.55, 1.08)
    warped = cv2.GaussianBlur(warped, (3, 3), 0) * shade[:, :, None]
    # a screen glows: lift its darks a touch, as a lit display does
    warped = warped * 0.92 + 14
    out = frame.astype(np.float32) * (1 - alpha[:, :, None]) + warped * alpha[:, :, None]
    return np.clip(out, 0, 255).astype(np.uint8)


def draw_tag(frame, text, i, fps):
    """An on-air tag: which guest's camera this is."""
    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    s = frame.shape[0]
    a = min(1.0, i / (fps * 0.4))   # (fades in)
    if a > 0.05:
        x = chip(d, (int(s * 0.04), int(s * 0.04)), "●", s * 0.042, fill=(0, 0, 0), ink=TALLY, pad=0.3)
        chip(d, (x, int(s * 0.04)), text, s * 0.042, fill=(0, 0, 0), ink=INK, pad=0.3)
        img = Image.blend(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), img, a)
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def render_shot(clip_path, out_path, spec, src, ffmpeg, log=print):
    """One shot's clip with its screen (or tag): written to out_path (H.264, the clip's sound kept)."""
    import subprocess
    import tempfile
    cap = cv2.VideoCapture(clip_path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    kind = spec.get("type")
    quads, seen = (None, 1.0)
    if kind != "tag":
        quads, seen = track(clip_path)
        if quads is None:
            cap.release()
            return False, "no white screen found (name its corners in shots.json: \"corners\")"
        if spec.get("corners"):
            c = np.float32(spec["corners"]) * np.float32([w, h])
            quads = np.repeat(order(c)[None], len(quads), axis=0)
    tmp = tempfile.mktemp(suffix=".mp4")
    vw = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        if kind == "tag":
            f = draw_tag(f, spec.get("text", ""), i, fps)
        else:
            q = quads[min(i, len(quads) - 1)]
            qw = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
            qh = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
            ow = 960
            oh = max(120, int(ow * qh / max(1, qw)))
            f = composite(f, DRAW[kind](spec, ow, oh, i, fps, src), q)
        vw.write(f)
        i += 1
    cap.release()
    vw.release()
    r = subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", tmp, "-i", clip_path, "-map", "0:v", "-map", "1:a?",
                        "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "copy", "-shortest", "-movflags", "+faststart", out_path],
                       capture_output=True, text=True)
    os.remove(tmp)
    if r.returncode:
        return False, r.stderr.strip()[-300:]
    return True, "" if kind == "tag" else f"screen found in {seen:.0%} of frames"
