# A shared screen that's still: the browser sends a screen's picture only when something on it
# changes, so a slide held on air sends nothing for a minute. That was taken for a dropped
# camera (the break slate went up after 1.5 s, and the show log said it had stopped sending).
# Here the "screen" is a canvas that sends one picture and then nothing: it stays on air, isn't
# logged as stopped, and its capture asked for at most 1080p.
# Run: node dev/server.mjs &  then  python3 test/e2e_stillscreen.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
STILL_SCREEN = """(() => {
  navigator.mediaDevices.getDisplayMedia = async (c) => {
    window.__screenAsked = c;
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const g = cv.getContext('2d'); g.fillStyle = '#246'; g.fillRect(0, 0, 1920, 1080); g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText('Slide 1', 200, 400);
    const s = cv.captureStream(0);   // (frames only when asked for: like a screen, only on a change)
    const t = s.getVideoTracks()[0];
    window.__screenChange = () => { g.fillText('.', 200 + Math.random() * 1500, 700); t.requestFrame(); };
    setTimeout(() => window.__screenChange(), 300);
    Object.defineProperty(t, 'getSettings', { value: () => ({ ...MediaStreamTrack.prototype.getSettings.call(t), displaySurface: 'monitor' }) });
    return s;
  };
})();"""
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(STILL_SCREEN)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Still slides'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="screen"]', timeout=10000)
    host.click('#localList [data-share="screen"]'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    asked = host.evaluate('window.__screenAsked.video')
    assert asked['width']['max'] == 1280 and asked['height']['max'] == 720 and asked['frameRate']['max'] == 30, asked
    step(f"the screen is captured at the output's size and frame rate, 720p at 30 (asked for {asked['width']} x {asked['height']} at {asked['frameRate']}), not the screen's full size")
    host.wait_for_function("vmSync().cams.some((c) => c.name === 'Screen' && c.count >= 1)", timeout=10000)
    host.click('.tile[data-peer^="local-cam"]')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Screen')", timeout=5000)
    time.sleep(6)   # (four times what counts as a dropped camera, with no new picture)
    quiet = next(c for c in host.evaluate('vmSync().cams') if c['name'] == 'Screen')['quiet']
    label = host.inner_text('#progLabel')
    assert quiet > 4000, quiet
    assert 'Screen' in label and 'BREAK' not in label.upper() and host.is_hidden('#slateTag'), (label, host.is_visible('#slateTag'))
    step(f'a still screen ({quiet} ms with no new picture) stays on air: "{label}", no break slate')
    log = host.evaluate('JSON.stringify(vmShowLog().events)')
    assert 'Screen stopped sending' not in log, 'logged as stopped'
    host.evaluate('window.__screenChange()'); time.sleep(0.5)
    assert next(c for c in host.evaluate('vmSync().cams') if c['name'] == 'Screen')['quiet'] < 500
    step('nothing logged as stopped; a change on the screen comes straight through')
    host.evaluate("document.querySelector('.tile[data-peer^=\"local-cam\"] video').srcObject.getVideoTracks()[0].stop()")
    host.wait_for_function("document.querySelector('#progLabel').textContent.toUpperCase().includes('BREAK') || !document.querySelector('#slateTag').hidden", timeout=8000)
    step('stopping the sharing still puts the break slate up')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
