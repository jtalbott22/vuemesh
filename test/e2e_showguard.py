# 0.95.0: a show runs only while a person is at its studio. With the guard's times shortened (they
# can only be shortened): Admin tells LIVE from OPEN; "Still running this show?" comes up and Keep
# going carries on (the server hears it); unanswered, the show ends: the studio says so and the phone
# stops recording and says the show has ended; opening the studio again starts it again; Admin's End
# show ends it for everyone and keeps the event; and a studio with nobody here pauses, and resumes.
# Run: node dev/server.mjs &  then  python3 test/e2e_showguard.py
import json, os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ADMIN = os.environ.get('ADMIN_KEY', 'dev-admin')
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    def studio(times):
        ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(f"localStorage.setItem('vm_guard_test', {json.dumps(json.dumps(times))}); localStorage.setItem('vm_notice', '1')")
        page = ctx.new_page(); page.on('pageerror', lambda e: errors.append(f'studio: {e}'))
        page.goto(BASE + '/')
        ev = page.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({kind:'show'})})).json()""")
        page.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Guard")
        page.wait_for_function("window.vmGuard && window.vmSockets?.[0]?.connected", timeout=15000)
        return page, ev
    def admin(page, path, method='GET'):
        return page.evaluate("""async ([path, method, key]) => (await fetch('/api/admin/' + path, {method, headers: {'x-admin-key': key}})).json()""", [path, method, ADMIN])
    def phone(ev):
        cam = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844}).new_page()
        cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
        cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
        return cam

    host, ev = studio({'confirmMs': 25000, 'answerMs': 8000})
    time.sleep(1.5); host.evaluate("vmSockets[0].send({action: 'ping', busy: false})"); time.sleep(0.5)
    assert admin(host, f"events/{ev['id']}")['event']['state'] == 'open'
    cam = phone(ev)
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.evaluate("vmSockets[0].send({action: 'ping', busy: false})"); time.sleep(0.5)
    st = admin(host, f"events/{ev['id']}")['event']
    assert st['state'] == 'live' and st['runSince'], st
    step('Admin: the studio alone is OPEN; with a phone in it is LIVE, with when it started')

    host.wait_for_selector('#stillDlg[open]', timeout=30000)
    before = admin(host, f"events/{ev['id']}")['event']['confirmedAt']
    host.click('#stillDlg button[value=keep]'); time.sleep(1)
    after = admin(host, f"events/{ev['id']}")['event']['confirmedAt']
    assert after > before and not host.evaluate("vmGuard().ended"), (before, after)
    step('"Still running this show?" came up after its time; Keep going carried on, and the server heard it')

    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(2)
    host.wait_for_selector('#stillDlg[open]', timeout=30000)
    host.wait_for_selector('#endedDlg[open]', timeout=15000)
    assert 'by itself' in host.inner_text('#endedDlg'), host.inner_text('#endedDlg')
    cam.wait_for_function("document.querySelector('#rejoinLabel')?.textContent === 'The show has ended'", timeout=15000)
    assert 'stopped recording' in cam.inner_text('#rejoinText') and cam.is_hidden('.rejoinpair')
    time.sleep(2)
    assert admin(host, f"events/{ev['id']}")['event']['state'] is None
    step(f"unanswered, the show ended: the studio says so, the phone stopped recording (\"{cam.inner_text('#rejoinText')[:60]}…\"), and Admin no longer shows it")

    host.reload(); host.wait_for_function("window.vmSockets?.[0]?.connected", timeout=15000)
    step('opening the studio again (a person) starts the show again')
    cam2 = phone(ev)
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    r = admin(host, f"events/{ev['id']}/end", 'POST')
    assert r['told'] >= 2 and r['event']['state'] is None, r
    host.wait_for_selector('#endedDlg[open]', timeout=10000)
    assert 'administrator' in host.inner_text('#endedDlg')
    cam2.wait_for_function("document.querySelector('#rejoinLabel')?.textContent === 'The show has ended'", timeout=15000)
    assert admin(host, f"events/{ev['id']}")['event']['id'] == ev['id']
    step("Admin's End show ended it for the studio and the phone, and kept the event")

    idle, ev2 = studio({'idleMs': 8000})
    idle.wait_for_selector('#pauseDlg[open]', timeout=20000)
    assert not idle.evaluate("vmSockets[0].connected") and idle.is_hidden('#offlineDot')
    idle.click('#pauseDlg button[value=resume]')
    idle.wait_for_function("vmSockets[0].connected", timeout=10000)
    step('a studio with nobody in and nothing running paused itself (not shown as offline) and resumed')

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
