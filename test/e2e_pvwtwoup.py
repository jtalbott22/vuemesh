# Tap: Preview puts the preview monitor beside the program (green, left; red, right), each as big as
# fits, instead of a small box in the program's corner that looked like picture-in-picture (and the
# real one could land on it). The preview shows what CUT will put on air, its corner camera
# included; the program shows the corner only once it's taken; then what left air waits in
# preview (flip-flop). Tap: Air: the program alone.
# Run: node dev/server.mjs &  then  python3 test/e2e_pvwtwoup.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

BLUE_SCREEN = """(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = '#2040c0'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#2244c4'; g.fillRect((n++ * 7) % 1200, 10, 40, 40); }, 50);
    return c.captureStream(30);
  };
})();"""
# a canvas's colour at a fraction of its width and height
PX = """([sel, fx, fy]) => { const c = document.querySelector(sel); const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)]; }"""
blue = lambda p: p[2] > 150 and p[0] < 70 and p[1] < 100

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1600, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(BLUE_SCREEN)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Two-up'})})).json()""")
    host.add_init_script("localStorage.setItem('vm_pip', JSON.stringify({ on: true, over: 'screens', cam: 'auto', corner: 'br', size: 25 }))")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    # a camera and a screen from this computer
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.locator('#localList [data-add="cam"]').first.click()
    host.wait_for_function("document.querySelectorAll('.tile[data-peer^=\"local-cam\"] video').length >= 1 && [...document.querySelectorAll('.tile[data-peer^=\"local-cam\"] video')].every((v) => v.readyState >= 2)", timeout=15000)
    host.click('#localList [data-share="screen"]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer^=\"local-cam\"] video').length >= 2 && [...document.querySelectorAll('.tile[data-peer^=\"local-cam\"] video')].every((v) => v.readyState >= 2)", timeout=15000)
    host.keyboard.press('Escape')
    # (in the order added: the camera, then the screen; a canvas standing in for the screen has no "Screen" label)
    peers = host.evaluate("[...document.querySelectorAll('.tile[data-peer^=\"local-cam\"]')].map((t) => t.dataset.peer)")
    cam, scr = f'.tile[data-peer="{peers[0]}"]', f'.tile[data-peer="{peers[1]}"]'
    host.click(cam); time.sleep(1)  # (Tap: Air for now: the camera on air)

    # the switcher, Tap: Preview: two monitors side by side
    if host.locator('#switcher').is_hidden(): host.click('#swTgl')
    host.click('#switcher [data-tap="preview"]'); time.sleep(0.6)
    box = host.evaluate("""() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { two: document.querySelector('.monitor').classList.contains('twoup'), pv: r('#pvwCanvas'), pg: r('#program'), empty: !document.querySelector('#pvwEmpty').hidden }; }""")
    assert box['two'] and box['empty'], box
    pv, pg = box['pv'], box['pg']
    assert pv['right'] <= pg['left'] and abs(pv['width'] - pg['width']) < 3 and abs(pv['top'] - pg['top']) < 3 and pv['width'] > 300, box
    step(f"Tap: Preview: preview ({pv['width']:.0f} x {pv['height']:.0f}) beside the program ({pg['width']:.0f} x {pg['height']:.0f}), level, the same size; empty, it says so")

    # the screen in preview: what CUT will give, its corner camera included; the program has no corner yet
    host.click(scr); time.sleep(1.2)
    assert host.locator('#pvwEmpty').is_hidden()
    pv_mid, pv_corner = host.evaluate(PX, ['#pvwCanvas', 0.3, 0.5]), host.evaluate(PX, ['#pvwCanvas', 0.82, 0.82])
    pg_corner = host.evaluate(PX, ['#program', 0.82, 0.82])
    assert blue(pv_mid) and not blue(pv_corner), (pv_mid, pv_corner)
    assert not blue(pg_corner), pg_corner  # (the camera, full frame: no screen, no corner)
    step(f'the screen in preview shows the camera it would get in the corner ({pv_corner}); the program is still the camera alone')

    # CUT: the screen on air with the camera in its corner; the preview is empty again
    host.click('#swCut'); time.sleep(1.2)
    pg_mid, pg_corner = host.evaluate(PX, ['#program', 0.3, 0.5]), host.evaluate(PX, ['#program', 0.82, 0.82])
    assert blue(pg_mid) and not blue(pg_corner), (pg_mid, pg_corner)
    # (flip-flop, as a switcher does: what was on air waits in preview, ready to go back; a camera gets no corner)
    pv_mid = host.evaluate(PX, ['#pvwCanvas', 0.3, 0.5])
    assert host.locator('#pvwEmpty').is_hidden() and not blue(pv_mid), pv_mid
    step('CUT: the screen on air with the camera in its corner, as the preview showed; the camera waits in preview (flip-flop)')

    # Tap: Air: the program alone, as big as fits
    host.click('#switcher [data-tap="air"]'); time.sleep(0.6)
    st = host.evaluate("() => ({ two: document.querySelector('.monitor').classList.contains('twoup'), hidden: document.querySelector('#pvwFrame').hidden, w: document.querySelector('#program').getBoundingClientRect().width })")
    assert not st['two'] and st['hidden'] and st['w'] > pg['width'] * 1.3, st
    step(f"Tap: Air: the program alone, bigger ({st['w']:.0f} wide)")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
