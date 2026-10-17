# Cameras record for the director only while the show's being recorded: cutting around live
# shows the cameras and records nothing. Record program: the camera on air records. A camera
# person's own recording is theirs: when the director (recording) cuts to them, it carries on
# and a new clip starts there (the director's in-point); when the director cuts away, that clip
# ends there and their recording carries on until they stop it.
# Run: node dev/server.mjs &  then  python3 test/e2e_recpolicy.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Record policy'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=30000)
    ph = {}
    for name in ['Ana', 'Ben']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
        host.wait_for_function(f"[...document.querySelectorAll('.tile[data-peer] video')].filter(v => v.readyState >= 2).length === {len(ph)}", timeout=60000)
    tap = lambda who: host.evaluate(f"[...document.querySelectorAll('.tile[data-peer]')].find(t => t.textContent.includes('{who}')).click()")
    rec = lambda who: ph[who].evaluate("document.querySelector('#shutter').getAttribute('aria-label') === 'Stop recording'")
    clips = lambda who: ph[who].evaluate("(async () => (await (await import('/js/idb.js')).list('outbox', new URLSearchParams(location.search).get('e'))).filter(r => !String(r.id).startsWith('pgm-')).length)()")

    tap('Ana'); time.sleep(6)
    assert not rec('Ana'), 'Ana records though nothing is being recorded'
    step('cut to Ana without Record program: she is live on air and her phone records nothing')

    host.evaluate("document.querySelector('#recProgBtn').click()")
    ph['Ana'].wait_for_function("document.querySelector('#shutter').getAttribute('aria-label') === 'Stop recording'", timeout=15000)
    step('Record program: Ana, on air, starts recording')

    ph['Ben'].evaluate("document.querySelector('#shutter').click()"); time.sleep(3)   # Ben records on his own
    assert rec('Ben')
    b0 = clips('Ben')
    tap('Ben'); time.sleep(4)
    for _ in range(20):
        if clips('Ben') > b0: break
        time.sleep(0.5)
    b1 = clips('Ben')
    assert rec('Ben') and b1 == b0 + 1, (b0, b1)
    step(f'Ben was recording on his own; the director cut to him: his recording carried on and a clip ended there, so the director\'s cut starts a new one ({b0} → {b1} clips)')

    tap('Ana'); time.sleep(4)
    for _ in range(20):
        if clips('Ben') > b1: break
        time.sleep(0.5)
    b2 = clips('Ben')
    assert rec('Ben') and b2 == b1 + 1, (b1, b2)
    ph['Ana'].wait_for_function("document.querySelector('#shutter').getAttribute('aria-label') === 'Stop recording'", timeout=10000)
    step(f'cut away from Ben: his director\'s clip ended there ({b1} → {b2}) and he is still recording, as he chose; Ana is recording again on air')

    host.evaluate("document.querySelector('#recProgBtn').click()"); time.sleep(1)
    ph['Ana'].wait_for_function("document.querySelector('#shutter').getAttribute('aria-label') === 'Start recording'", timeout=60000)   # (8 s grace, plus a slow machine saving the program)
    assert rec('Ben')
    step('Record program stopped: Ana (recording for the director) stopped; Ben (his own) carries on')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
