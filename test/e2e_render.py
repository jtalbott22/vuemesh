# The offline renderer under stress: an encoder that says yes then fails, a corrupted
# clip, and an iPhone-style rotation flag. Needs ffmpeg for the fixtures and checks.
# Run: node dev/server.mjs &  then  python3 test/e2e_render.py
import base64, os, subprocess, sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
def step(m): print('ok  ' + m, flush=True)
def b64(path): return base64.b64encode(open(path, 'rb').read()).decode()


def fixtures():
    # The sample videos, in VP9 (every Chromium decodes it, so the damaged clip really gets decoded):
    # a good one, the same with 4000 bytes zeroed in the middle, and one with a rotation flag.
    ff = lambda *a: subprocess.run(['ffmpeg', '-v', 'error', '-y', *a], check=True)
    src = ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '3']
    try:
        codec = ['-c:v', 'libvpx-vp9', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus']
        ff(*src, *codec, '-shortest', '/tmp/good.mp4')
    except subprocess.CalledProcessError:
        codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']   # (an ffmpeg without VP9)
        ff(*src, *codec, '-shortest', '/tmp/good.mp4')
    d = bytearray(open('/tmp/good.mp4', 'rb').read())
    n = len(d)
    d[n // 2:n // 2 + 4000] = bytes(4000)
    open('/tmp/corrupt.mp4', 'wb').write(bytes(d))
    try:
        ff('-display_rotation', '90', '-i', '/tmp/good.mp4', '-c', 'copy', '/tmp/rot.mp4')
    except subprocess.CalledProcessError:
        ff('-i', '/tmp/good.mp4', '-c', 'copy', '-metadata:s:v:0', 'rotate=90', '/tmp/rot.mp4')


fixtures()


# A watchdog: if one export runs past two minutes, stop the test's browser (only Playwright's own
# browsers, never yours), so a stuck export fails the test instead of tying up the computer.
import threading
class Watchdog:
    def __init__(self, seconds=120):
        self.seconds, self.timer = seconds, None
    def __enter__(self):
        def stop():
            print(f'WATCHDOG: an export ran past {self.seconds} s; stopping the test browser', flush=True)
            subprocess.run("pkill -f 'ms-playwright|pw-browsers'", shell=True)
        self.timer = threading.Timer(self.seconds, stop)
        self.timer.start()
        return self
    def __exit__(self, *a):
        self.timer.cancel()

RUN = """async ([clips, sabotage]) => {
  if (sabotage) {
    // H.264 "supported", then fails as soon as it starts — the generic codec error on Linux
    const real = VideoEncoder;
    window.VideoEncoder = class extends real {
      constructor(init) { super({ ...init, error: init.error }); this._err = init.error; }
      configure(cfg) { if (cfg.codec.startsWith('avc1')) { setTimeout(() => this._err(new DOMException('Encoder creation error.', 'EncodingError'))); return; } return super.configure(cfg); }
    };
    window.VideoEncoder.isConfigSupported = async (cfg) => ({ supported: true, config: cfg });
  }
  const { renderSequence } = await import('/js/render.js');
  const blobs = Object.fromEntries(clips.map(([id, b]) => [id, new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: 'video/mp4' })]));
  const seq = { v: 2, origin: 0, tracks: [
    { id: 'p', kind: 'video', program: true, items: clips.map(([id], i) => ({ id: 'i' + i, type: 'clip', src: id, start: i * 1500, dur: 1500, in: 200 })) },
    { id: 'a', kind: 'audio', follow: 'p', items: [], gain: 1 },
  ] };
  try {
    const out = await renderSequence({ seq, width: 640, height: 360, fps: 30, blobFor: (id) => blobs[id], nameOf: (id) => id, imageFor: () => null });
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { ok: true, report: out.report, file: btoa(s) };
  } catch (e) {
    return { ok: false, stage: e.stage, message: e.message };
  }
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if CHROME else p.chromium.launch()
    errors = []
    def page():
        pg = b.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(BASE + '/terms'); pg.add_script_tag(url='/vendor/mp4box.min.js'); pg.add_script_tag(url='/vendor/mp4-muxer.js')
        return pg

    with Watchdog(): r = page().evaluate(RUN, [[['good', b64('/tmp/good.mp4')]], True])
    assert r['ok'], r
    step(f"encoder says yes then fails → probed, skipped, rendered with {r['report']['video']} + {r['report']['audio']}")

    with Watchdog(): r = page().evaluate(RUN, [[['good', b64('/tmp/good.mp4')], ['corrupt', b64('/tmp/corrupt.mp4')]], False])
    assert r['ok'], r
    paths = {s['clip']: s['path'] for s in r['report']['sources']}
    open('/tmp/render-mixed.mp4', 'wb').write(base64.b64decode(r['file']))
    bad = subprocess.run(['ffmpeg', '-v', 'error', '-i', '/tmp/render-mixed.mp4', '-f', 'null', '-'], capture_output=True, text=True).stderr.strip()
    assert not bad and r['report'].get('unreadable') == ['corrupt'], (bad[:200], r['report'])
    step(f"a corrupted clip doesn't sink the film: {paths}; reported as unreadable; output decodes cleanly")

    with Watchdog(): r = page().evaluate(RUN, [[['rot', b64('/tmp/rot.mp4')]], False])
    assert r['ok'], r
    open('/tmp/render-rot.mp4', 'wb').write(base64.b64decode(r['file']))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '0.7', '-i', '/tmp/render-rot.mp4', '-frames:v', '1', '/tmp/render-rot.png'])
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '0.9', '-i', '/tmp/rot.mp4', '-frames:v', '1', '-vf', 'scale=-2:360', '/tmp/rot-ref.png'])
    from PIL import Image
    out = Image.open('/tmp/render-rot.png').convert('L'); ref = Image.open('/tmp/rot-ref.png').convert('L')
    # the render letterboxes nothing (fill), so compare the centre column band of both, top vs bottom brightness pattern
    # Expected: ffmpeg's correctly-rotated frame, filled into 640x360 (centre crop). Compare pixels.
    rw, rh = ref.size
    big = ref.resize((640, round(rh * 640 / rw)))
    top = (big.size[1] - 360) // 2
    want = big.crop((0, top, 640, top + 360))
    def diff(a, b):
        a = a.resize((64, 36)); b = b.resize((64, 36))
        return sum(abs(a.getpixel((x, y)) - b.getpixel((x, y))) for x in range(64) for y in range(36)) / (64 * 36)
    right = diff(out, want)
    wrong = diff(out, want.rotate(180))
    assert right < 12 and wrong > right * 2, (right, wrong)
    step(f"rotation flag honoured: rendered frame matches ffmpeg's upright view (mean difference {right:.1f}/255; upside-down would be {wrong:.1f})")
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
