# The AI technical director, live. Two phones report their shot quality; when the
# on-air phone starts shaking, pointing at the floor and whip-panning, the director
# cuts away, the tally light moves, and a manual cut holds the director off for 8 s.
# Run: node dev/server.mjs &  then  python3 test/e2e_director.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SENSORS = """window.__bad = false; let heading = 0;
setInterval(() => {
  const bad = window.__bad;
  window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
    accelerationIncludingGravity: bad ? { x: 0.5, y: 0.5, z: 9.8 } : { x: 0, y: 9.81, z: 0 },
    rotationRate: bad ? { alpha: 260, beta: 210, gamma: 170 } : { alpha: 3, beta: 2, gamma: 1 }, interval: 50 }));
  heading = (heading + (bad ? 22 : 0.2)) % 360;
  window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: heading, beta: 0, gamma: 0, absolute: true }));
}, 50);"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Director'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    mon = ctx.new_page(); mon.goto(f"{BASE}/monitor?e={ev['id']}")
    phones = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone'], user_agent='Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36').new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))  # phones, with gyros
        c.add_init_script(SENSORS)
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] .q i').length === 2", timeout=25000)
    time.sleep(2)
    host.keyboard.press('a')
    host.wait_for_function("document.querySelector('#progLabel').textContent.startsWith('ON AIR · ')", timeout=10000)
    on_air = lambda: host.evaluate("document.querySelector('#progLabel').textContent").split(' ')[-1]
    first = on_air()
    other = 'Dev' if first == 'Rosa' else 'Rosa'
    phones[first].wait_for_selector('#camView.onair', timeout=6000)
    assert not phones[other].is_visible('#tally')
    step(f'auto director on: started on {first}; {first}\'s phone shows ON AIR, {other}\'s doesn\'t')

    # Make whichever phone is on air go bad, right after a cut, so a variety cut can't explain it.
    def cut_happens_after(label_before):
        host.wait_for_function(f"!document.querySelector('#progLabel').textContent.endsWith('{label_before}')", timeout=15000)
    bad = on_air()
    good = 'Dev' if bad == 'Rosa' else 'Rosa'
    t0 = time.time()
    phones[bad].evaluate('window.__bad = true')
    host.wait_for_function(f"[...document.querySelectorAll('.tile[data-peer]')].some(t => t.querySelector('.who').textContent === '{bad}' && t.querySelector('.q').classList.contains('bad'))", timeout=4000)
    rated = time.time() - t0
    cut_happens_after(bad)
    took = time.time() - t0
    assert on_air() == good
    why = host.evaluate(f"[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === '{bad}').querySelector('.why').textContent")
    phones[good].wait_for_selector('#camView.onair', timeout=6000)
    phones[bad].wait_for_function("!document.querySelector('#camView').classList.contains('onair')", timeout=6000)
    step(f'{bad} began shaking, pointing at the floor and whip-panning: its tile rated it bad in {rated:.1f}s ("{why}"), the director cut to {good} {took:.1f}s after it started; tally moved')
    # the studio sends its log to the monitor every 2 s
    mon.wait_for_function(f"document.querySelector('#log').textContent.includes('({good}) — Cut away')", timeout=6000)
    log = mon.inner_text('#log')
    line = next((l for l in log.split('\n') if f'({good}) — Cut away' in l), None)
    assert line and any(w in line for w in ('shaking', 'floor or ceiling', 'panning'))  # the bad phone has all three; the director names the worst at that moment, log[:500]
    step('the event log names the reason: ' + line.split('Auto: ')[1])
    phones[bad].wait_for_selector('#hint:not([hidden])', timeout=5000)
    step(f'{bad}\'s phone coached its shooter: "{phones[bad].inner_text("#hint")}"')
    first, other = bad, good

    # manual override: cut back to the shaky phone; the director waits 8 s before fixing it
    n_first = host.evaluate(f"[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === '{first}').querySelector('.n').textContent")
    host.keyboard.press(n_first)
    time.sleep(5)
    assert on_air() == first, on_air()
    host.wait_for_function(f"document.querySelector('#progLabel').textContent.endsWith('{other}')", timeout=8000)
    step(f'a manual cut back to {first} held for 5+ s (director waits 8 s), then the director took it away again')

    for c in phones.values(): c.evaluate('window.__bad = true')
    host.wait_for_function("document.querySelector('#slateTag') && !document.querySelector('#slateTag').hidden", timeout=10000)
    step('both phones unusable → the director put the break slate on air')
    for c in phones.values(): c.evaluate('window.__bad = false')
    host.wait_for_function("document.querySelector('#slateTag').hidden && !document.querySelector('#progLabel').textContent.includes('BREAK')", timeout=10000)
    step('a usable shot came back → off the slate, back on camera: ' + host.evaluate("document.querySelector('#progLabel').textContent"))

    host.check('#localOnly'); time.sleep(8)
    routes = host.eval_on_selector_all('.tile[data-peer] .route', 'e => e.map(x => x.textContent)')
    assert routes == ['LAN', 'LAN'], routes
    step(f'"Local network only" on: phones reconnected over the local network only ({routes})')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
