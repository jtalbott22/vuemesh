# Rejoin as either: after leaving, the camera's home has two buttons, Rejoin as camera and
# Rejoin as microphone. The role you were is highlighted and is one tap; the other opens the
# event's join screen with that role chosen.
# Run: node dev/server.mjs &  then  python3 test/e2e_rejoin.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Either'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    ph = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844}).new_page()
    ph.on('pageerror', lambda e: errors.append(f'phone: {e}')); ph.on('dialog', lambda d: d.accept())
    ph.goto(f"{BASE}/cam?e={ev['id']}"); ph.fill('#name', 'Rosa'); ph.check('#agreeGuest'); ph.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    ph.click('#camTitle'); ph.click('#leaveBtn'); ph.wait_for_selector('#rejoinCard:not([hidden])', timeout=60000)
    labels = [ph.inner_text('#rejoinBtn'), ph.inner_text('#rejoinMicBtn')]
    assert labels == ['Rejoin as camera', 'Rejoin as microphone'] and 'primary' in ph.get_attribute('#rejoinBtn', 'class'), labels
    step(f'after leaving as a camera, home offers {labels}, with the camera one highlighted')
    ph.click('#rejoinMicBtn'); ph.wait_for_url('**as=mic', timeout=10000); ph.wait_for_selector('#joinView:not([hidden])', timeout=10000)
    assert ph.is_checked('input[name=role][value=mic]')
    ph.click('#joinForm button[type=submit]'); ph.wait_for_selector('#micView.on', timeout=15000)
    host.wait_for_selector('#multi button.mic', timeout=20000)
    step('Rejoin as microphone opened the join screen with Microphone chosen; Join made it the studio\'s microphone')
    ph.click('#micSkip'); ph.wait_for_selector('#micStop', state='visible', timeout=20000)
    ph.click('#micLeave'); ph.wait_for_selector('#rejoinCard:not([hidden])', timeout=60000)
    ph.wait_for_function("document.querySelector('#rejoinMicBtn').classList.contains('primary')", timeout=8000)
    ph.click('#rejoinBtn'); ph.wait_for_url('**as=cam', timeout=10000); ph.wait_for_selector('#joinView:not([hidden])', timeout=10000)
    assert ph.is_checked('input[name=role][value=cam]')
    ph.click('#joinForm button[type=submit]'); ph.wait_for_selector('#camView.on', timeout=15000)
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    step('and back: Rejoin as camera, Join, and it\'s a camera tile in the studio again')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
