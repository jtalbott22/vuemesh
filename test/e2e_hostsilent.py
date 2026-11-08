# The studio's server connection dies quietly: a network blip leaves it open as far as the studio
# can tell, but the server has taken it for gone, so nothing reaches it. Phones joining meanwhile
# find no studio ("Host not here yet"). The studio checks its connection every 30 s; with no
# answer in 10 s it connects again by itself, and the waiting phone joins, with nothing touched.
# (It happened in a show: a phone waited until Local network only was switched off and on, which
# sent something through the server and so found the connection dead.)
# Run: node dev/server.mjs &  then  python3 test/e2e_hostsilent.py
import os, time, urllib.request
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Quiet studio'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.wait_for_function("vmSockets.every((s) => s.connected)", timeout=10000)
    time.sleep(1)

    # the server takes the studio's connection for gone; the studio's side stays open
    said = urllib.request.urlopen(f'{BASE}/_dev/silence?role=host').read().decode()
    assert said == 'silenced 1', said
    t0 = time.time()
    assert host.evaluate("vmSockets.every((s) => s.connected)"), 'the studio still thinks it is connected'
    step('the studio\'s server connection died quietly: the server has no studio, the studio still thinks it\'s connected')

    phone = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE).new_page()
    phone.on('pageerror', lambda e: errors.append(f'phone: {e}')); phone.on('dialog', lambda d: d.accept())
    phone.goto(f"{BASE}/cam?e={ev['id']}"); phone.fill('#name', 'Rosa'); phone.check('#agreeGuest'); phone.click('#joinForm button[type=submit]')
    phone.wait_for_function("document.querySelector('#lsState')?.textContent.includes('Host not here yet')", timeout=15000)
    step(f'a phone joining meanwhile finds no studio: "{phone.inner_text("#lsState")}"')

    # nothing touched: the studio finds out within 30 s + 10 s, connects again, and the phone joins
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 1", timeout=50000)
    took = time.time() - t0
    phone.wait_for_function("!document.querySelector('#lsState').textContent.includes('Host not here')", timeout=10000)
    host.wait_for_function("vmShowLog().events.filter((e) => e.kind === 'server').at(-1)?.text === 'Connected to the server again'", timeout=5000)
    texts = [e['text'] for e in host.evaluate('vmShowLog().events') if e['kind'] == 'server']
    assert 'Lost the server connection' in texts and texts[-1] == 'Connected to the server again', texts
    assert took < 50, took
    step(f'the studio found its connection dead and connected again by itself; the phone joined {took:.0f} s after the drop ("{phone.inner_text("#lsState")}"); show log: {texts[-2:]}')

    print()
    print('errors:', errors or 'none')
    assert not errors
    b.close()
