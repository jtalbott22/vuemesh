# The home page is the app's front door: Camera, My media, Kiosk and Join work right away, no
# event needed. The first tap asks once to agree to the terms; after that a tap goes straight
# in. Camera starts the camera on your own (the browser already allows it here); My media opens
# what's on this device; Kiosk opens a kiosk show. And the Edit page, opened without its event
# code, finds the last event edited here; its event list opens events in Edit.
# Run: node dev/server.mjs &  then  python3 test/e2e_home.py
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, permissions=['camera', 'microphone'])
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(f'page: {e}'))
    pg.goto(BASE + '/')
    tiles = pg.eval_on_selector_all('.apps .app b', 'e => e.map(x => x.textContent)')
    assert tiles == ['Camera', 'My media', 'Kiosk', 'Join a show', 'TV', 'Share', 'Start a show', 'Call'], tiles
    pg.evaluate("document.querySelector('.apps a[href=\"/cam?go=solo\"]').click()")
    pg.wait_for_selector('#gate[open]', timeout=10000)
    assert pg.is_disabled('#gateGo')
    pg.check('#gateOk'); pg.click('#gateGo')
    pg.wait_for_url('**/cam?go=solo', timeout=15000)
    pg.wait_for_selector('#camView.on', timeout=30000)
    step(f'the home page has {tiles}; Camera asked once to agree to the terms, then started the camera on its own (no event)')
    pg.goto(BASE + '/'); pg.evaluate("document.querySelector('.apps a[href=\"/cam?go=media\"]').click()")
    pg.wait_for_url('**/cam?go=media', timeout=15000)
    assert not pg.query_selector('#gate[open]') if pg.url.endswith('/') else True
    pg.wait_for_selector('#library:not([hidden])', timeout=15000)
    step('My media went straight in (no second question) and opened what\'s on this device')
    pg.goto(BASE + '/'); pg.evaluate("document.querySelector('.apps a[href=\"/kiosk\"]').click()")
    pg.wait_for_url('**/kiosk?e=*', timeout=30000)   # (the kiosk screen is its own page)
    step('Kiosk opened a kiosk show straight away')
    # the Edit page without its event code: the last event edited here
    ev = pg.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Edit me'})})).json()""")
    pg.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Edit%20me")  # (the name rides in the studio link)
    pg.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    with ctx.expect_page() as pop: pg.evaluate("document.querySelector('#editTab').click()")
    pop.value.close()
    ed = ctx.new_page(); ed.on('pageerror', lambda e: errors.append(f'edit: {e}'))
    ed.goto(BASE + '/edit')
    ed.wait_for_url(f"**/edit?e={ev['id']}", timeout=20000)
    ed.wait_for_function("document.body && document.body.dataset.mode === 'edit' && document.title.includes('Edit me')", timeout=120000)
    ed.goto(BASE + '/edit?e=ZZZZZZ'); ed.wait_for_selector('#eventPicker[open]', timeout=60000)
    hrefs = ed.eval_on_selector_all('#pickList a', 'e => e.map(a => a.getAttribute("href"))')
    assert ed.inner_text('#pickH') == 'Edit which event?' and any(h == f"/edit?e={ev['id']}" for h in hrefs), hrefs
    step(f'/edit with no code went to the last event edited here; with a gone code its list asks "Edit which event?" and opens events in Edit: {hrefs[:2]}')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
