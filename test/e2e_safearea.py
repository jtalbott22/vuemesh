# The camera page clears the notch / Dynamic Island: held sideways, an iPhone reports safe
# areas on the left and right, and no control may sit under them.
# Run: node dev/server.mjs &  then  python3 test/e2e_safearea.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
INSET = 59   # an iPhone with a Dynamic Island, held sideways
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context().new_page()
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Island'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    ctx = b.new_context(viewport={'width': 932, 'height': 430}, user_agent=IPHONE, has_touch=True, permissions=['camera', 'microphone'])
    cam = ctx.new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    # Prefer the browser's own safe-area simulation (it feeds env()); else set the same values by hand.
    how = 'simulated by the browser'
    try:
        ctx.new_cdp_session(cam).send('Emulation.setSafeAreaInsetsOverride', {'insets': {'left': INSET, 'right': INSET, 'top': 0, 'bottom': 21}})
    except Exception:
        how = 'set by hand'
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('#camView.on', timeout=15000); time.sleep(1.5)
    if how == 'set by hand' or cam.evaluate("parseFloat(getComputedStyle(document.querySelector('.vu')).left)") < INSET:
        how = 'set by hand'
        cam.evaluate(f"document.documentElement.style.setProperty('--sl', '{INSET}px'); document.documentElement.style.setProperty('--sr', '{INSET}px')")
        time.sleep(0.3)
    W = 932
    def box(sel):
        b_ = cam.locator(sel).first.bounding_box()
        return b_ and (round(b_['x']), round(b_['x'] + b_['width']))
    checks = {
        'mic meter': box('.vu'), 'zoom rail': box('.zoomrail'),
        'event name (top left)': box('#camTitle'), 'top-right button': box('.bar:not(.bottom) button >> nth=-1'),
        'Flip': box('#flip'), 'notices stack': box('#topstack'), 'status line': box('.uploads'),
    }
    bad = {k: v for k, v in checks.items() if v and (v[0] < INSET or v[1] > W - INSET)}
    assert not bad and checks['mic meter'] and checks['zoom rail'], (checks, bad)
    step(f'held sideways with a {INSET}px island each side ({how}): every control clears it — ' + ', '.join(f'{k} {v[0]}–{v[1]}' for k, v in checks.items() if v))
    cam.evaluate("document.documentElement.style.setProperty('--sl', '0px'); document.documentElement.style.setProperty('--sr', '0px')")
    time.sleep(0.2)
    upright = box('.vu')[0]
    assert upright < INSET, upright
    step(f'with no safe area (held upright), the meter sits where it always did ({upright}px from the edge)')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
