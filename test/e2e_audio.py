# Sound in the editor, under real browser rules (no autoplay shortcut): Edit playback reaches
# both program meters (mono phone audio shows on L and R); the Source monitor's sound shows
# on the meters while it plays; and if the browser suspends sound, a notice says so and one
# click brings it back.   Run: node dev/server.mjs &  then  python3 test/e2e_audio.py
import os, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox']   # no autoplay shortcut
TRACK = "window.__ctxs = []; const O = window.AudioContext; window.AudioContext = class extends O { constructor(...a) { super(...a); window.__ctxs.push(this); } };"
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    hctx = b.new_context(viewport={'width': 1440, 'height': 900}); hctx.add_init_script(TRACK)
    host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sound check'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(1); host.keyboard.press('1'); time.sleep(5)
    cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=40000); time.sleep(2)
    ed = edit_window(host.context, host, errors); time.sleep(1.5)

    def sample(n=30):
        mx = [0, 0]
        for _ in range(n):
            time.sleep(0.12)
            v = ed.evaluate("[...document.querySelectorAll('#pMeters .pm .fill')].map(f => parseFloat(f.style.getPropertyValue('--lvl')) || 0)")
            mx = [max(mx[0], v[0]), max(mx[1], v[1])]
        return [round(x) for x in mx]
    ed.locator('body').click(position={'x': 800, 'y': 360}); ed.keyboard.press('Home'); ed.keyboard.press('Space')
    prog = sample()
    ed.keyboard.press('Space')
    assert prog[0] > 20 and prog[1] > 20, prog
    step(f'Edit playback: program meters move on both sides (peak L {prog[0]}%, R {prog[1]}%) — the phone\'s mono sound shows on L and R')

    ed.click('#mediaTab'); time.sleep(0.4); ed.locator('#mediaList [data-kind="clip"]').first.click(); time.sleep(0.8)
    ed.click('#srcPlay'); src = sample(); ed.click('#srcPlay')
    assert src[0] > 20, src
    step(f'Source monitor playing: the meters follow it (peak L {src[0]}%, R {src[1]}%) and its sound still plays')

    ed.click('#progTab'); time.sleep(0.3)
    ed.locator('body').click(position={'x': 800, 'y': 360}); ed.keyboard.press('Home'); ed.keyboard.press('Space'); time.sleep(0.5)
    ed.evaluate("Promise.all(window.__ctxs.map(c => c.suspend()))"); time.sleep(0.4)
    shown = ed.is_visible('#soundOff')
    # (since 0.22 the studio also wakes the sound itself within a couple of seconds; if the notice
    # is still up, one click on it does it)
    if ed.is_visible('#soundOff'):
        try: ed.click('#soundOff', timeout=3000)
        except Exception: pass
    time.sleep(2.5)
    state = ed.evaluate("window.__ctxs.map(c => c.state)")
    ed.keyboard.press('Home'); time.sleep(0.2)   # (the short test film may have played out meanwhile: from the top)
    if not ed.evaluate("vmEdit().playing"): ed.keyboard.press('Space')
    for _ in range(40):   # (on a slow machine the clip can take a moment to be ready after the jump)
        if all(e['ready'] >= 3 for e in ed.evaluate('vmEdit()')['els']): break
        time.sleep(0.15)
    after = sample(25)
    ed.keyboard.press('Space')
    assert shown and all(s == 'running' for s in state) and after[0] > 20, (shown, state, after)
    step(f'browser suspended the sound mid-playback: the "sound is paused" notice appeared, and it plays again (meters {after[0]}%)')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
