# Fewer "Allow" questions: scanning the beacon joins on the same page (an iPhone would ask
# for the camera again on a new page), and someone coming back whose browser will ask again
# gets the steps to make it remember, once, on the join screen; nothing if it already does.
# Run: node dev/server.mjs &  then  python3 test/e2e_permtip.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    pg = b.new_page(); pg.goto(BASE + '/')
    ev = pg.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Ask once'})})).json()""")
    # a first visit: no tip (the question is expected)
    ctx = b.new_context(); c = ctx.new_page(); c.on('pageerror', lambda e: errors.append(str(e)))
    c.goto(f"{BASE}/cam?e={ev['id']}"); c.wait_for_selector('#joinView:not([hidden])'); time.sleep(0.8)
    assert c.is_hidden('#permTip')
    # coming back, in a browser that will ask again
    c.evaluate("localStorage.setItem('vm_joins', '2')"); c.reload(); c.wait_for_selector('#joinView:not([hidden])')
    c.wait_for_selector('#permTip:not([hidden])', timeout=5000)
    tip = c.inner_text('#permTipText')
    assert 'Allow while visiting the site' in tip, tip
    c.click('#permTipDone'); c.reload(); c.wait_for_selector('#joinView:not([hidden])'); time.sleep(0.8)
    assert c.is_hidden('#permTip')
    step(f'a returning visitor whose browser will ask again sees, once: "{tip[:90]}…"; Got it puts it away for good')
    # a browser that already remembers: nothing
    ctx2 = b.new_context(permissions=['camera', 'microphone']); c2 = ctx2.new_page()
    c2.goto(f"{BASE}/cam?e={ev['id']}"); c2.evaluate("localStorage.setItem('vm_joins', '2')"); c2.reload(); c2.wait_for_selector('#joinView:not([hidden])'); time.sleep(0.8)
    assert c2.is_hidden('#permTip')
    step('a browser that already remembers gets no tip')
    # an iPhone gets Safari's steps
    ctx3 = b.new_context(user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'); c3 = ctx3.new_page()
    c3.goto(f"{BASE}/cam?e={ev['id']}"); c3.evaluate("localStorage.setItem('vm_joins', '1')"); c3.reload(); c3.wait_for_selector('#permTip:not([hidden])', timeout=5000)
    tip3 = c3.inner_text('#permTipText')
    assert 'Website Settings' in tip3 and 'Allow' in tip3, tip3
    step(f'an iPhone gets Safari\'s steps: "{tip3[:100]}…"')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
