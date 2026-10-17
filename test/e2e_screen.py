# A screen or window, and this computer's sound, as sources: + This computer, Share… (the
# browser's own picker): the screen is a source like a camera, with its sound (a tile, on
# air, a mixer strip, recorded on air); "This computer's sound" is a microphone source. They
# aren't brought back next time (sharing asks each time).
# Run: node dev/server.mjs &  then  python3 test/e2e_screen.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Slides'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="screen"]', timeout=10000)
    host.click('#localList [data-share="screen"]'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=10000)
    name = host.inner_text('.tile[data-peer^="local-cam"]')
    m = next(x for x in host.evaluate('vmMedia()') if x['peer'].startswith('local-cam'))
    assert 'Screen' in name and m['audioTracks'] == ['live'], (name, m)
    host.click('.tile[data-peer^="local-cam"]'); time.sleep(1)
    assert 'Screen' in host.inner_text('#progLabel')
    step(f'shared the screen: a source called Screen with its sound (its own mixer strip), and it went on air: "{host.inner_text("#progLabel")}"')
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="sound"]', timeout=10000)
    host.click('#localList [data-share="sound"]'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=10000)
    mic = host.inner_text('button.mic[data-peer^="local-mic"]')
    assert 'Computer sound' in mic, mic
    step(f'This computer\'s sound: a microphone source ("{mic.strip().splitlines()[-1] if mic.strip() else mic}"), recording')
    saved = host.evaluate("localStorage.getItem('vm_local_sources')")
    assert 'screen' not in (saved or '') and 'sound-' not in (saved or ''), saved
    step('neither is remembered for next time (sharing asks each time)')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
