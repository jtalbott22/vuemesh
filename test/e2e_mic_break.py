# Microphone-only phone + break slate, end to end in headless Chromium with fake devices.
# Run: node dev/server.mjs &  then  python3 test/e2e_mic_break.py
import os, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)

BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

PIXEL = """(pt) => { const c = document.querySelector('#program'); const [x, y] = pt; const d = c.getContext('2d').getImageData(c.width * x | 0, c.height * y | 0, 1, 1).data; return [d[0], d[1], d[2]]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())

    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Podcast taping', kind:'talk'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    step('studio up')

    cam_ctx = b.new_context(permissions=['camera', 'microphone']); cam = cam_ctx.new_page(); watch(cam, 'cam')
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=20000)
    host.keyboard.press('1'); time.sleep(0.6)
    px = host.evaluate(PIXEL, [0.5, 0.5])
    step(f'camera 1 on air (program centre pixel {px})')

    host.keyboard.press('b'); time.sleep(0.5)
    tag = host.inner_text('#slateTag'); bars = host.evaluate(PIXEL, [0.05, 0.3])
    assert host.is_visible('#slateTag') and bars[0] > 150 and abs(bars[0] - bars[2]) < 20, bars
    step(f'B puts the break slate on air ({tag}; first bar pixel {bars})')
    host.keyboard.press('b'); time.sleep(0.5)
    assert not host.is_visible('#slateTag')
    step('B again returns to the camera')

    mic_ctx = b.new_context(permissions=['camera', 'microphone']); mic = mic_ctx.new_page(); watch(mic, 'mic')
    mic.goto(f"{BASE}/cam?e={ev['id']}"); mic.fill('#name', 'Table'); mic.check('input[name=role][value=mic]'); mic.check('#agreeGuest')
    mic.click('#joinForm button[type=submit]')
    mic.wait_for_selector('#micView.on', timeout=10000)
    step('microphone phone opened the sync step: ' + mic.inner_text('#micHead'))
    mic.click('#micSkip')  # fake camera can't see a beacon; confirm() is auto-accepted
    mic.wait_for_selector('#micStop', state='visible', timeout=5000)
    step('mic locked in and recording: ' + mic.inner_text('#micHead'))
    host.wait_for_selector('.mic[data-peer]', timeout=15000)
    time.sleep(1.5)
    strips = host.eval_on_selector_all('#bridge .vstrip .vname', 'els => els.map(e => e.textContent)')   # (the studio's Live mixer: the dock)
    modes = host.eval_on_selector_all('#bridge .vstrip', 'els => els.filter(e => e.querySelector("[data-amode]")).map(e => [e.querySelector(".vname").textContent, e.querySelector("[data-amode][aria-pressed=true]")?.dataset.amode])')
    time.sleep(1)
    assert any('Mic' in x for x in strips) and dict(modes).get('Mic · Table') == 'on' and any(n.endswith('Rosa') and m == 'off' for n, m in modes), modes
    step(f'live mixer: one strip per phone {modes} — the mic is ON, and the camera went OFF when the mic joined')

    cam_ctx.close()
    # (since 0.23: with a microphone live there's sound to put on air, so no break slate)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('MIC')", timeout=15000)
    assert host.is_hidden('#slateTag')
    step('camera dropped → the microphone went on air, not the break slate: ' + host.inner_text('#progLabel'))

    time.sleep(2)
    mic.click('#micStop')
    mic.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('delivered'))", timeout=30000)
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=15000)
    step('mic recording delivered and verified on the host')

    ed = edit_window(host.context, host, errors); time.sleep(0.5)
    heads = ed.inner_text('#heads')
    estrips = ed.eval_on_selector_all('#mixer .strip .nm', 'els => els.map(e => e.textContent)')
    assert 'Mic' in heads and any('Mic' in x for x in estrips), (heads, estrips)
    step(f'edit: the mic is its own audio track; mixer strips {estrips}')

    ed.click('#portBtn'); time.sleep(0.3)
    dims = ed.evaluate("[document.querySelector('#program').width, document.querySelector('#program').height]")
    assert dims == [720, 1280], dims
    step(f'output switched to portrait: program is {dims[0]}x{dims[1]}')
    ed.screenshot(path='/tmp/v04-studio-edit.png')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
