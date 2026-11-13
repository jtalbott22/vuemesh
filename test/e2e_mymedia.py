# My media is everything recorded on this device, studio shows included: the recordings a
# studio here received (each camera's) show in My media under their show, with no need to open
# the show. Delete there removes the recording from this device and from the open studio's editor.
# Run: node dev/server.mjs &  then  python3 test/e2e_mymedia.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Saturday show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Saturday%20show")  # (the name rides in the studio link; the phone hears it from the studio)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Ana'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=90000)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(5); cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("vmClipList().some(c => c.name === 'Ana')", timeout=120000)

    lib = ctx.new_page(); lib.on('pageerror', lambda e: errors.append(f'my media: {e}')); lib.on('dialog', lambda d: d.accept())
    lib.goto(f"{BASE}/cam?go=media"); lib.wait_for_selector('#library:not([hidden])', timeout=20000)
    lib.wait_for_function(f"[...document.querySelectorAll('#libEvent option')].some(o => o.value === '{ev['id']}')", timeout=20000)
    lib.select_option('#libEvent', ev['id']); time.sleep(1.5)
    rows = lib.eval_on_selector_all('#libList li', 'e => e.map(x => x.innerText.replace(/\\n+/g, " | "))')
    assert any('Ana' in r and 'In the studio on this device' in r for r in rows), rows
    assert 'Saturday show' in lib.eval_on_selector('#libEvent', 's => s.selectedOptions[0].textContent')
    step(f'My media lists the studio show "Saturday show" without opening it: {rows[0][:90]}')

    lib.evaluate("[...document.querySelectorAll('#libList li')].find(li => li.innerText.includes('Ana')).querySelector('[data-act=\"delete\"]').click()")
    host.wait_for_function("!vmClipList().some(c => c.name === 'Ana')", timeout=30000)
    lib.wait_for_function("![...document.querySelectorAll('#libList li')].some(li => li.innerText.includes('Ana'))", timeout=15000)
    step("Delete in My media removed it from this device and from the open studio's editor")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
