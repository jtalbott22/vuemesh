#!/usr/bin/env python3
"""VUEMesh WHIP receiver: take the studio's program on this computer, watch it, record it.

    pip install aiortc aiohttp
    python whip_receiver.py            (then paste the URL and token it shows into VUEMesh:
                                        Stream out > Another WHIP service)

The studio streams its program here over WHIP (WebRTC). This shows it in a dashboard (only for
whoever has the dashboard's key: the link it opens and prints), and records it to MP4.

Why it's built the way it is:
  * aiortc, the WebRTC library this uses, sends the browser its own estimate of the link's
    bandwidth (REMB, from the abs-send-time header), and that estimate is far too low: the
    studio's encoder was told 5 Mbit/s, then 0.5 within three seconds. So the answer here
    leaves those two out, and the browser's own congestion control (with VUEMesh's start and
    floor hints) sets the rate. On a local network it then runs at what you chose.
  * The incoming video is always being read (decoded and let go), so it can't pile up in memory
    while nobody's watching, and the dashboard and a recording each get the newest frame.
  * aiortc re-encodes for the dashboard's preview, at 0.5 Mbit/s by default (1.5 at most): raised
    here (4, up to 8), so the preview is worth looking at.
"""
import argparse
import asyncio
import datetime
import json
import logging
import os
import secrets
import socket
import ssl
import subprocess
import sys
import time
import uuid
import webbrowser

from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder, MediaRelay

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("whip")
logging.getLogger("aiortc").setLevel(logging.WARNING)
logging.getLogger("aioice").setLevel(logging.WARNING)

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- settings --

parser = argparse.ArgumentParser(description="VUEMesh WHIP receiver: the studio's program, on this computer")
parser.add_argument("-p", "--port", type=int, default=8080, help="port (default 8080)")
parser.add_argument("--host", default="0.0.0.0", help="address to listen on (default: all)")
parser.add_argument("--recordings", default=os.path.join(HERE, "recordings"), help="where recordings go")
parser.add_argument("--cert", default=os.path.join(HERE, "cert.pem"), help="TLS certificate (made for you if missing)")
parser.add_argument("--key", default=os.path.join(HERE, "key.pem"), help="TLS key (made for you if missing)")
parser.add_argument("--new-token", action="store_true", help="make a new bearer token and dashboard key")
parser.add_argument("--no-browser", action="store_true", help="don't open the dashboard")
args = parser.parse_args()


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))  # (no packet is sent: this only picks the outgoing interface)
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


LOCAL_IP = local_ip()
CONFIG = os.path.join(HERE, "whip_receiver.json")


def credentials():
    """The bearer token (for the studio) and the dashboard key, kept between runs so the studio's
    settings stay right. --new-token makes new ones."""
    try:
        c = json.load(open(CONFIG))
        if c.get("token") and c.get("key") and not args.new_token:
            return c["token"], c["key"]
    except (OSError, ValueError):
        pass
    c = {"token": secrets.token_urlsafe(18), "key": secrets.token_urlsafe(12)}
    with open(CONFIG, "w") as f:
        json.dump(c, f)
    try:
        os.chmod(CONFIG, 0o600)
    except OSError:
        pass
    return c["token"], c["key"]


TOKEN, DASH_KEY = credentials()


def ensure_cert():
    """A self-signed certificate for this computer, if there isn't one (the studio's page is on
    https, so the WHIP URL has to be too)."""
    if os.path.exists(args.cert) and os.path.exists(args.key):
        return
    log.info("No certificate: making a self-signed one for localhost and %s", LOCAL_IP)
    san = f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{LOCAL_IP}"
    try:
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", args.key, "-out", args.cert,
                        "-days", "825", "-subj", "/CN=VUEMesh WHIP receiver", "-addext", san], check=True, capture_output=True)
        return
    except (OSError, subprocess.CalledProcessError):
        pass
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
        import ipaddress
        k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "VUEMesh WHIP receiver")])
        now = datetime.datetime.now(datetime.timezone.utc)
        alt = x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1")), x509.IPAddress(ipaddress.ip_address(LOCAL_IP))])
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now).not_valid_after(now + datetime.timedelta(days=825)).add_extension(alt, critical=False).sign(k, hashes.SHA256()))
        open(args.key, "wb").write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
        open(args.cert, "wb").write(cert.public_bytes(serialization.Encoding.PEM))
    except ImportError:
        sys.exit("No certificate, and no way to make one here. Install OpenSSL, or: pip install cryptography")


# ------------------------------------------------- aiortc, tuned for a good picture --

# (the dashboard's preview is re-encoded by aiortc; its defaults are for a video call)
try:
    import aiortc.codecs.vpx as _vpx
    import aiortc.codecs.h264 as _h264
    _vpx.DEFAULT_BITRATE, _vpx.MAX_BITRATE = 4_000_000, 8_000_000
    _h264.DEFAULT_BITRATE, _h264.MAX_BITRATE = 4_000_000, 8_000_000
except Exception:  # (another aiortc version: the defaults stand)
    log.warning("Couldn't raise the preview's bitrate on this aiortc version")

# A bigger jitter buffer for video. aiortc's holds 128 packets (about 150 KB): a frame bigger than
# that (the first frame after a cut to something busy, a sharp screen, any keyframe at a good
# rate) loses its start, can't be decoded, and the keyframe it asks for is bigger still, so the
# picture sticks or breaks up. 4096 packets is about 5 MB: room for any frame.
JITTER_PACKETS = int(os.environ.get("VM_RX_JITTER", "4096"))
try:
    import aiortc.rtcrtpreceiver as _rxmod
    _JB = _rxmod.JitterBuffer

    class _RoomyJitterBuffer(_JB):
        def __init__(self, capacity, prefetch=0, is_video=False):
            if is_video:
                capacity = max(capacity, JITTER_PACKETS)
            super().__init__(capacity=capacity, prefetch=prefetch, is_video=is_video)

    _rxmod.JitterBuffer = _RoomyJitterBuffer
except Exception:
    log.warning("Couldn't enlarge the video jitter buffer on this aiortc version: busy cuts may stick")

# Incoming bytes, counted as they arrive (aiortc's stats don't count bytes).
received = {"bytes": 0}
try:
    from aiortc.rtcrtpreceiver import RTCRtpReceiver as _Rx
    _orig_rtp = _Rx._handle_rtp_packet

    async def _counted(self, packet, *a, **kw):
        if getattr(self, "_vm_counted", False):
            received["bytes"] += len(packet.payload) + 12
        return await _orig_rtp(self, packet, *a, **kw)

    _Rx._handle_rtp_packet = _counted
except Exception:
    log.warning("Couldn't count incoming bytes on this aiortc version (the rate won't show)")


def without_bandwidth_report(sdp):
    """The answer, less what lets aiortc tell the browser its (far too low) bandwidth estimate:
    the abs-send-time header and goog-remb. Everything else stays."""
    keep = [l for l in sdp.splitlines() if not ("abs-send-time" in l and l.startswith("a=extmap")) and not (l.startswith("a=rtcp-fb") and "goog-remb" in l)]
    return "\r\n".join(keep) + "\r\n"


# ------------------------------------------------------------------------- the state --

relay = MediaRelay()
state = {
    "pc": None, "session": None, "since": None, "tracks": {}, "w": None, "h": None, "fps": None,
    "kbps": None, "recorder": None, "rec_file": None, "rec_since": None, "readers": [],
}
viewers = set()
os.makedirs(args.recordings, exist_ok=True)


async def read_frames(track):
    """Always read the incoming picture (so nothing piles up), and keep its size and frame rate."""
    sub = relay.subscribe(track, buffered=False)
    n, t0 = 0, time.monotonic()
    try:
        while True:
            f = await sub.recv()
            if track.kind == "video":
                size = (getattr(f, "width", None), getattr(f, "height", None))
                if size != (state["w"], state["h"]):
                    log.info("Picture: %sx%s", *size)
                state["w"], state["h"] = size
                n += 1
                if time.monotonic() - t0 >= 2:
                    state["fps"] = round(n / (time.monotonic() - t0))
                    n, t0 = 0, time.monotonic()
    except Exception:
        pass  # (the stream ended)


async def rate_meter():
    last, t = received["bytes"], time.monotonic()
    while True:
        await asyncio.sleep(2)
        now = time.monotonic()
        b = received["bytes"]
        state["kbps"] = round((b - last) * 8 / 1000 / (now - t)) if state["pc"] else None
        last, t = b, now


async def end_stream(why):
    """The studio stopped (or the link went): close it, finish any recording, tell the viewers."""
    pc = state["pc"]
    if not pc:
        return
    log.info("Stream ended (%s)", why)
    state.update(pc=None, session=None, since=None, tracks={}, w=None, h=None, fps=None, kbps=None)
    for t in state["readers"]:
        t.cancel()
    state["readers"] = []
    await stop_recording()
    for v in list(viewers):
        await v.close()
    viewers.clear()
    await pc.close()


async def stop_recording():
    rec, name = state["recorder"], state["rec_file"]
    if not rec:
        return None
    state.update(recorder=None, rec_file=None, rec_since=None)
    try:
        await rec.stop()
        log.info("Recording saved: %s", name)
    except Exception as e:
        log.warning("Recording didn't finish cleanly: %s", e)
    return os.path.basename(name)


# ------------------------------------------------------------------- the endpoints --

def authorised_dashboard(request):
    k = request.headers.get("X-Key") or request.query.get("k", "")
    return secrets.compare_digest(k, DASH_KEY)


CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, DELETE, PATCH, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, If-Match",
    "Access-Control-Expose-Headers": "Location, ETag",
    # (Chrome asks before a page on the internet, like vuemesh.com, reaches a local address)
    "Access-Control-Allow-Private-Network": "true",
}


@web.middleware
async def cors(request, handler):
    resp = web.Response(status=204) if request.method == "OPTIONS" else await handler(request)
    resp.headers.update(CORS)
    return resp


async def whip_publish(request):
    """WHIP: the studio's offer in, our answer out. One stream at a time: a new one replaces it."""
    if not secrets.compare_digest(request.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
        log.warning("A stream was turned away: wrong or missing token (from %s)", request.remote)
        return web.Response(status=401, text="Wrong or missing bearer token")
    if request.content_type != "application/sdp":
        return web.Response(status=415, text="Expected application/sdp")
    offer = await request.text()
    await end_stream("a new stream replaced it")
    pc = RTCPeerConnection()
    session = uuid.uuid4().hex
    state.update(pc=pc, session=session, since=time.time())

    @pc.on("track")
    def on_track(track):
        log.info("Receiving %s", track.kind)
        state["tracks"][track.kind] = track
        state["readers"].append(asyncio.ensure_future(read_frames(track)))

    @pc.on("connectionstatechange")
    async def on_state():
        log.info("Stream connection: %s", pc.connectionState)
        # ('disconnected' can come back on its own; failed or closed can't)
        if pc.connectionState in ("failed", "closed") and state["pc"] is pc:
            await end_stream(pc.connectionState)

    await pc.setRemoteDescription(RTCSessionDescription(sdp=offer, type="offer"))
    await pc.setLocalDescription(await pc.createAnswer())
    for t in pc.getTransceivers():
        t.receiver._vm_counted = True
    log.info("Stream starting from %s", request.remote)
    return web.Response(status=201, text=without_bandwidth_report(pc.localDescription.sdp), content_type="application/sdp",
                        headers={"Location": f"/program/whip/{session}"})


async def whip_stop(request):
    """WHIP: the studio stopping (it DELETEs the Location it was given)."""
    if request.match_info["session"] != state["session"]:
        return web.Response(status=404, text="No such stream")
    await end_stream("the studio stopped streaming")
    return web.Response(status=200)


async def viewer(request):
    """The dashboard's preview: a WebRTC link of its own, re-encoded from the newest frame."""
    if not authorised_dashboard(request):
        return web.json_response({"error": "This dashboard needs its key"}, status=403)
    if not state["tracks"]:
        return web.json_response({"error": "Nothing coming in yet"}, status=404)
    p = await request.json()
    pc = RTCPeerConnection()
    viewers.add(pc)

    @pc.on("connectionstatechange")
    async def on_state():
        if pc.connectionState in ("failed", "closed"):
            viewers.discard(pc)

    for kind in ("video", "audio"):
        if kind in state["tracks"]:
            pc.addTrack(relay.subscribe(state["tracks"][kind], buffered=False))
    await pc.setRemoteDescription(RTCSessionDescription(sdp=p["sdp"], type=p["type"]))
    await pc.setLocalDescription(await pc.createAnswer())
    return web.json_response({"sdp": pc.localDescription.sdp, "type": pc.localDescription.type})


async def status(request):
    if not authorised_dashboard(request):
        return web.json_response({"error": "This dashboard needs its key"}, status=403)
    files = sorted((f for f in os.listdir(args.recordings) if f.endswith(".mp4")), reverse=True)[:20]
    return web.json_response({
        "live": bool(state["tracks"]), "since": state["since"], "w": state["w"], "h": state["h"], "fps": state["fps"], "kbps": state["kbps"],
        "audio": "audio" in state["tracks"], "recording": bool(state["recorder"]), "rec_since": state["rec_since"],
        "recordings": [{"name": f, "mb": round(os.path.getsize(os.path.join(args.recordings, f)) / 1048576, 1)} for f in files],
        "url": f"https://{LOCAL_IP}:{args.port}/program/whip", "token": TOKEN,
    })


async def record(request):
    """Start recording the program to MP4, or stop and say where it went."""
    if not authorised_dashboard(request):
        return web.json_response({"error": "This dashboard needs its key"}, status=403)
    if state["recorder"]:
        return web.json_response({"recording": False, "file": await stop_recording()})
    if not state["tracks"]:
        return web.json_response({"error": "Nothing coming in to record"}, status=409)
    name = os.path.join(args.recordings, f"vuemesh-program-{datetime.datetime.now():%Y-%m-%d_%H-%M-%S}.mp4")
    rec = MediaRecorder(name)
    for kind in ("video", "audio"):
        if kind in state["tracks"]:
            rec.addTrack(relay.subscribe(state["tracks"][kind]))
    # aiortc's recorder takes the picture's size from its first frame, but with sound the MP4's
    # header is often written (by an audio packet) before that, and says 640x480. The size is
    # known here, so it's set first; and a better quality than libx264's default.
    try:
        from av.video.stream import VideoStream
        for ctx in getattr(rec, "_MediaRecorder__tracks", {}).values():
            if isinstance(ctx.stream, VideoStream) and state["w"]:
                ctx.stream.width, ctx.stream.height = state["w"], state["h"]
                ctx.stream.codec_context.options = {"crf": "18", "preset": "veryfast"}
    except Exception as e:
        log.warning("Couldn't set the recording's size up front (%s): it may say 640x480", e)
    await rec.start()
    state.update(recorder=rec, rec_file=name, rec_since=time.time())
    log.info("Recording to %s", name)
    return web.json_response({"recording": True})


async def download(request):
    if not authorised_dashboard(request):
        return web.Response(status=403, text="This dashboard needs its key")
    name = os.path.basename(request.match_info["name"])
    path = os.path.join(args.recordings, name)
    if not name.endswith(".mp4") or not os.path.isfile(path):
        return web.Response(status=404, text="No such recording")
    return web.FileResponse(path, headers={"Content-Disposition": f'attachment; filename="{name}"'})


async def index(request):
    return web.Response(content_type="text/html", text=PAGE)


# --------------------------------------------------------------------- the dashboard --

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VUEMesh · WHIP receiver</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; --bg: #0f1013; --panel: #17191e; --line: #2a2e36; --ink: #f3f4f6; --dim: #9aa1ad; --tally: #ff2f2a; --preview: #2fd56b; --amber: #ffb21e;
    --cond: 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif; --body: Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 var(--body); }
  .bars { height: 6px; background: linear-gradient(90deg, #c0c0c0 0 14.28%, #c0c000 0 28.57%, #00c0c0 0 42.85%, #00c000 0 57.14%, #c000c0 0 71.42%, #c00000 0 85.71%, #0000c0 0); }
  header { display: flex; align-items: center; gap: 14px; padding: 14px 24px; border-bottom: 1px solid var(--line); }
  .mark { font: 700 1.25rem var(--cond); letter-spacing: .02em; }
  .mark i { display: inline-block; width: .62em; height: .62em; border-radius: 50%; background: var(--tally); margin-right: .32em; vertical-align: .02em; }
  header h1 { font: 500 1.25rem var(--cond); color: var(--dim); margin: 0; flex: 1; }
  .chip { font: 700 .95rem var(--cond); letter-spacing: .04em; padding: .2em .7em; border-radius: 2px; background: #2a2e36; color: var(--dim); }
  .chip.air { background: var(--tally); color: #fff; }
  .chip.rec { background: transparent; color: var(--tally); border: 1px solid var(--tally); }
  main { max-width: 1180px; margin: 0 auto; padding: 20px 24px 40px; display: grid; gap: 18px; }
  .monitor { position: relative; aspect-ratio: 16 / 9; background: #000; border-radius: 2px; box-shadow: 0 0 0 3px #2a2e36; overflow: hidden; }
  .monitor.air { box-shadow: 0 0 0 3px var(--tally); }
  .monitor video { width: 100%; height: 100%; object-fit: contain; display: block; }
  .monitor .lbl { position: absolute; top: 12px; left: 12px; }
  .monitor .tc { position: absolute; top: 12px; right: 12px; font: 700 1rem ui-monospace, Menlo, monospace; color: var(--amber); background: #000a; padding: 2px 8px; }
  .monitor .wait { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; color: var(--dim); font: 500 1.3rem var(--cond); }
  .monitor .wait[hidden], [hidden] { display: none !important; }
  .monitor:fullscreen { aspect-ratio: auto; width: 100vw; height: 100vh; border-radius: 0; box-shadow: none; background: #000; }
  .monitor:fullscreen.air { box-shadow: inset 0 0 0 4px var(--tally); }
  .monitor:-webkit-full-screen { width: 100vw; height: 100vh; background: #000; }
  .monitor:fullscreen .lbl, .monitor:fullscreen .tc { top: 18px; }
  .monitor:fullscreen .lbl { left: 18px; } .monitor:fullscreen .tc { right: 18px; }
  .monitor video { cursor: zoom-in; } .monitor:fullscreen video { cursor: zoom-out; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  .tile { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px 14px; }
  .tile b { display: block; font: 700 1.7rem/1.1 var(--cond); }
  .tile span { color: var(--dim); font-size: .85rem; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button { font: 700 1.05rem var(--cond); letter-spacing: .03em; border: 1px solid #0008; border-radius: 4px; padding: .55em 1.3em; background: linear-gradient(#2b313b, #1c2027); color: var(--ink); cursor: pointer; }
  button.red { background: var(--tally); color: #fff; }
  button:disabled { opacity: .45; cursor: default; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 16px 18px; }
  .card h2 { font: 700 1.05rem var(--cond); letter-spacing: .06em; text-transform: uppercase; color: var(--dim); margin: 0 0 10px; }
  .field { display: grid; grid-template-columns: 9em 1fr auto; gap: 8px; align-items: center; margin: 6px 0; }
  .field label { color: var(--dim); font-size: .85rem; }
  .field input { font: 500 .9rem ui-monospace, Menlo, monospace; color: #8ec5ff; background: #0b0c0f; border: 1px solid var(--line); border-radius: 4px; padding: 8px 10px; min-width: 0; }
  .fine { color: var(--dim); font-size: .85rem; }
  ul.recs { list-style: none; margin: 0; padding: 0; }
  ul.recs li { display: flex; gap: 10px; padding: 6px 0; border-top: 1px solid var(--line); }
  ul.recs a { color: #8ec5ff; }
  ul.recs span { color: var(--dim); margin-left: auto; }
  .lock { max-width: 460px; margin: 12vh auto; text-align: center; }
</style>
</head>
<body>
<div class="bars" aria-hidden="true"></div>
<header><span class="mark"><i aria-hidden="true"></i>VUEMesh</span><h1>WHIP receiver</h1><span class="chip" id="state">STANDBY</span><span class="chip rec" id="recChip" hidden>● REC</span></header>
<main id="main">
  <div class="monitor" id="mon">
    <video id="v" autoplay playsinline muted></video>
    <span class="chip lbl" id="lbl">PROGRAM</span><span class="tc" id="tc">00:00:00</span>
    <div class="wait" id="wait">Waiting for the studio<br><small class="fine">VUEMesh studio: Stream out › Another WHIP service, with the URL and token below</small></div>
  </div>
  <div class="tiles">
    <div class="tile"><b id="tRate">—</b><span>Coming in (Mbit/s)</span></div>
    <div class="tile"><b id="tPic">—</b><span>Picture</span></div>
    <div class="tile"><b id="tUp">—</b><span>Live for</span></div>
    <div class="tile"><b id="tRec">—</b><span>Recording</span></div>
  </div>
  <div class="row">
    <button type="button" class="red" id="recBtn" disabled>Record</button>
    <button type="button" id="soundBtn" disabled>Sound on</button>
    <button type="button" id="fsBtn" title="Full screen (F, or double-click the picture). Esc to leave.">Full screen</button>
    <span class="fine" id="say" role="status"></span>
  </div>
  <div class="card">
    <h2>In the studio</h2>
    <div class="field"><label for="url">WHIP URL</label><input id="url" readonly><button type="button" data-copy="url">Copy</button></div>
    <div class="field"><label for="tok">Bearer token</label><input id="tok" readonly><button type="button" data-copy="tok">Copy</button></div>
    <p class="fine">In VUEMesh: <b>Stream out</b> › Service <b>Another WHIP service</b> › paste these › Go live. The first time, open this page from the studio's computer once and accept its certificate (it's this computer's own), or the studio can't reach it.</p>
  </div>
  <div class="card"><h2>Recordings</h2><ul class="recs" id="recs"><li class="fine">None yet.</li></ul></div>
</main>
<script>
const $ = (s) => document.querySelector(s);
const key = new URLSearchParams(location.search).get('k') || sessionStorage.getItem('vm_rx_key') || '';
if (key) { sessionStorage.setItem('vm_rx_key', key); history.replaceState(null, '', location.pathname); }
const H = { 'X-Key': key };
let pc = null, live = false, since = null, recSince = null, connecting = false;
const fmt = (s) => [Math.floor(s / 3600), Math.floor(s / 60) % 60, Math.floor(s % 60)].map((n) => String(n).padStart(2, '0')).join(':');
const say = (t) => { $('#say').textContent = t; clearTimeout(say.t); say.t = setTimeout(() => ($('#say').textContent = ''), 4000); };

function locked() {
  $('#main').outerHTML = '<div class="lock card"><h2>This dashboard needs its key</h2><p class="fine">Open the link the receiver printed when it started (it ends in <code>?k=…</code>), on this computer or one you trust.</p></div>';
}

async function watch() {
  if (connecting || pc) return;
  connecting = true;
  try {
    pc = new RTCPeerConnection();
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => { if ($('#v').srcObject !== e.streams[0]) $('#v').srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc?.connectionState)) drop(); };
    await pc.setLocalDescription(await pc.createOffer());
    const r = await fetch('/viewer', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(pc.localDescription) });
    if (!r.ok) throw new Error();
    await pc.setRemoteDescription(await r.json());
  } catch { drop(); } finally { connecting = false; }
}
function drop() { try { pc?.close(); } catch {} pc = null; $('#v').srcObject = null; }

async function poll() {
  let s;
  try {
    const r = await fetch('/api/status', { headers: H });
    if (r.status === 403) return locked();
    s = await r.json();
  } catch { return setTimeout(poll, 2000); }
  if (!$('#url').value) { $('#url').value = s.url; $('#tok').value = s.token; }
  live = s.live; since = s.since; recSince = s.rec_since;
  $('#state').textContent = live ? 'ON AIR' : 'STANDBY';
  $('#state').className = 'chip' + (live ? ' air' : '');
  $('#mon').classList.toggle('air', live);
  $('#wait').hidden = live;
  $('#tRate').textContent = s.kbps != null ? (s.kbps / 1000).toFixed(1) : '—';
  $('#tPic').textContent = s.w ? `${s.w}×${s.h}${s.fps ? ' @' + s.fps : ''}` : '—';
  $('#recChip').hidden = !s.recording;
  $('#recBtn').disabled = !live && !s.recording;
  $('#recBtn').textContent = s.recording ? 'Stop recording' : 'Record';
  $('#soundBtn').disabled = !live;
  $('#recs').innerHTML = s.recordings.length ? s.recordings.map((f) => `<li><a href="/recordings/${encodeURIComponent(f.name)}?k=${encodeURIComponent(key)}" download>${f.name}</a><span>${f.mb} MB</span></li>`).join('') : '<li class="fine">None yet.</li>';
  if (live && !pc) watch();
  if (!live && pc) drop();
  setTimeout(poll, 1000);
}
setInterval(() => {
  const now = Date.now() / 1000;
  $('#tc').textContent = live && since ? fmt(now - since) : '00:00:00';
  $('#tUp').textContent = live && since ? fmt(now - since) : '—';
  $('#tRec').textContent = recSince ? fmt(now - recSince) : '—';
}, 500);
$('#recBtn').onclick = async () => {
  const r = await (await fetch('/api/record', { method: 'POST', headers: H })).json();
  if (r.error) say(r.error);
  else if (r.file) say(`Saved: ${r.file}`);
};
// Full screen: the monitor (picture, label and timecode) fills the screen. The button, F, or a
// double-click on the picture; Esc (or any of those again) to leave. (iPhones only let a video
// itself go full screen.)
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen() {
  const mon = $('#mon'), v = $('#v');
  if (fsEl()) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  if (mon.requestFullscreen) return mon.requestFullscreen().catch(() => {});
  if (mon.webkitRequestFullscreen) return mon.webkitRequestFullscreen();
  if (v.webkitEnterFullscreen) return v.webkitEnterFullscreen();
}
const fsLabel = () => ($('#fsBtn').textContent = fsEl() ? 'Exit full screen' : 'Full screen');
document.addEventListener('fullscreenchange', fsLabel);
document.addEventListener('webkitfullscreenchange', fsLabel);
$('#fsBtn').onclick = toggleFullscreen;
$('#mon').addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    toggleFullscreen();
  }
});
$('#soundBtn').onclick = () => {
  $('#v').muted = !$('#v').muted;
  $('#soundBtn').textContent = $('#v').muted ? 'Sound on' : 'Sound off';
};
document.addEventListener('click', async (e) => {
  const id = e.target.dataset?.copy;
  if (!id) return;
  await navigator.clipboard?.writeText($('#' + id).value).catch(() => {});
  e.target.textContent = 'Copied';
  setTimeout(() => (e.target.textContent = 'Copy'), 1500);
});
poll();
</script>
</body>
</html>
"""

# ------------------------------------------------------------------------------ run --

async def on_startup(app):
    app["meter"] = asyncio.ensure_future(rate_meter())


async def on_shutdown(app):
    app["meter"].cancel()
    await end_stream("the receiver is stopping")


def main():
    ensure_cert()
    app = web.Application(middlewares=[cors])
    app.router.add_get("/", index)
    app.router.add_post("/program/whip", whip_publish)
    app.router.add_delete("/program/whip/{session}", whip_stop)
    app.router.add_post("/viewer", viewer)
    app.router.add_get("/api/status", status)
    app.router.add_post("/api/record", record)
    app.router.add_get("/recordings/{name}", download)
    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)
    tls = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    tls.load_cert_chain(certfile=args.cert, keyfile=args.key)
    dash = f"https://localhost:{args.port}/?k={DASH_KEY}"
    bar = "=" * 64
    print(f"\n{bar}\n  VUEMesh WHIP receiver\n  In the studio (Stream out › Another WHIP service):\n    WHIP URL      https://{LOCAL_IP}:{args.port}/program/whip\n"
          f"    Bearer token  {TOKEN}\n  Dashboard (keep this link to yourself):\n    {dash}\n  Recordings     {args.recordings}\n{bar}\n", flush=True)
    if not args.no_browser:
        webbrowser.open_new_tab(dash)
    web.run_app(app, host=args.host, port=args.port, ssl_context=tls, print=None)


if __name__ == "__main__":
    main()
