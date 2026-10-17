# The audio console on a high-density screen (a Retina Mac) with two microphones: every strip
# stays inside the window (none grows forever), and the meters and faders stay in view.
# Run: node dev/server.mjs &  then  python3 test/e2e_console2.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=2, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Two mics'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=30000)
    js = lambda sel: host.evaluate(f"document.querySelector({sel!r}).click()")   # (inside the page: this machine is slow for Playwright's click checks)
    js('#addLocal'); host.wait_for_selector('#localList [data-add="mic"]', timeout=20000)
    js('#localList [data-add="mic"]'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=20000)
    host.wait_for_selector('#localList [data-add="mic"]', timeout=20000); time.sleep(0.5)
    js('#localList [data-add="mic"]'); host.wait_for_function("document.querySelectorAll('button.mic[data-peer^=\"local-mic\"]').length === 2", timeout=20000)
    js('#localDlg form button')
    with ctx.expect_page() as pop: js('[data-console]')
    w = pop.value; w.wait_for_selector('[data-strip]', timeout=15000)
    sizes = []
    for _ in range(6):
        sizes.append(w.evaluate("[innerHeight, ...[...document.querySelectorAll('.ch')].map(c => Math.round(c.getBoundingClientRect().height)), ...[...document.querySelectorAll('.fd canvas')].map(c => c.height)]")); time.sleep(1)
    first, last = sizes[0], sizes[-1]
    assert first == last and all(h <= first[0] for h in last[1:1 + (len(last) - 1) // 2]), sizes
    faders = w.evaluate("[...document.querySelectorAll('.fd input')].map(i => { const r = i.getBoundingClientRect(); return r.bottom <= innerHeight && r.height > 60; })")
    assert faders and all(faders), faders
    step(f'two microphones on a 2× screen: strips {last[1:1 + (len(last) - 1) // 2]} px tall in a {last[0]} px window, steady for 6 s (meter canvases {last[1 + (len(last) - 1) // 2:]} px), every fader in view')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
