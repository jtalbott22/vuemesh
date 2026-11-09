# A camera page in a background tab (a computer's Chrome: its person sharing their screen from
# another tab). Chrome stops the camera frames the page draws its upright picture on, so the
# director's picture froze until the tab was back. While hidden, the page now sends the camera's
# own picture, and the studio is told it's the whole frame; the upright square comes back with
# the tab.
# (Headless Chromium never hides a tab, so the test does what Chrome does: the page says it's
# hidden, and its video frame callbacks stop.)
# Run: node dev/server.mjs &  then  python3 test/e2e_cambg.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
FRAMES = "vmMedia().find((x) => x.name === 'Mac')?.videoFrames || 0"
SIZE = "(() => { const v = [...document.querySelectorAll('.tile[data-peer]')].find((t) => t.querySelector('.who').textContent === 'Mac')?.querySelector('video'); return v ? [v.videoWidth, v.videoHeight] : null; })()"
HIDE = """() => {
  window.__bg = true;
  const P = HTMLVideoElement.prototype;
  if (!P.__rvfc) {
    P.__rvfc = P.requestVideoFrameCallback;
    P.requestVideoFrameCallback = function (cb) { return P.__rvfc.call(this, (...a) => { if (!window.__bg) cb(...a); }); };
  }
  Object.defineProperty(document, 'hidden', { get: () => window.__bg, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (window.__bg ? 'hidden' : 'visible'), configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}"""
SHOW = "() => { window.__bg = false; document.dispatchEvent(new Event('visibilitychange')); }"

def gained(page, secs):
    a = page.evaluate(FRAMES); time.sleep(secs); return page.evaluate(FRAMES) - a

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Background tab'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)

    # a computer's camera page (not a phone), as on the Mac
    cam = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera', 'microphone']).new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Mac'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function(f"{FRAMES} > 30", timeout=40000)
    host.wait_for_function(f"(({SIZE}) || [0, 0])[0] > 0 && ({SIZE})[0] === ({SIZE})[1]", timeout=10000)
    n = gained(host, 2)
    sq = host.evaluate(SIZE)
    assert n > 30, n
    step(f'a computer\'s camera is in the show: its upright square ({sq[0]}x{sq[1]}), {n / 2:.0f} frames a second in the studio')

    cam.evaluate(HIDE)
    time.sleep(1.5)   # (the switch-over)
    n = gained(host, 3)
    assert n > 45, f'the studio got {n} frames in 3 s from the hidden tab'
    host.wait_for_function(f"(({SIZE}) || [0, 0])[0] !== ({SIZE})[1]", timeout=5000)
    raw = host.evaluate(SIZE)
    step(f"its tab in the background (the page hidden, its frame callbacks stopped): the studio still gets {n / 3:.0f} frames a second, the camera's own picture ({raw[0]}x{raw[1]})")

    cam.evaluate(SHOW)
    host.wait_for_function(f"(({SIZE}) || [0, 0])[0] === ({SIZE})[1]", timeout=8000)
    time.sleep(1)   # (its drawing starts again)
    n = gained(host, 2)
    assert n > 25, n
    step(f'the tab is back: the upright square again ({host.evaluate(SIZE)[0]} px), {n / 2:.0f} frames a second')

    print()
    print('errors:', errors or 'none')
    assert not errors
    b.close()
