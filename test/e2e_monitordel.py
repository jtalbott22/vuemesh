# Delete from Monitor: a received recording's Delete (after a confirm) removes it from this
# computer and the editor: gone from the studio's recordings and its timeline, and from storage.
# Run: node dev/server.mjs &  then  python3 test/e2e_monitordel.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Delete from Monitor'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Ana'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=90000)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(5); cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("vmClipList().some(c => c.name === 'Ana')", timeout=120000)
    with ctx.expect_page() as pop: host.evaluate("document.querySelector('#monitorBtn').click()")
    mon = pop.value; mon.on('pageerror', lambda e: errors.append(f'monitor: {e}')); mon.on('dialog', lambda d: d.accept())
    mon.wait_for_selector('#received [data-del]', timeout=60000)
    mon.evaluate("document.querySelector('#received [data-del]').click()")
    host.wait_for_function("!vmClipList().some(c => c.name === 'Ana')", timeout=30000)
    left = host.evaluate("(async () => (await (await import('/js/idb.js')).list('clips', new URLSearchParams(location.search).get('e'))).length)()")
    assert left == 0 and not any(i['name'] == 'Ana' for i in host.evaluate('vmProgram()')), left
    step('Delete in Monitor (after a confirm) removed Ana\'s recording from the studio, its timeline and this computer\'s storage')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
