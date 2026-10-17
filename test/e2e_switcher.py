# The switcher: Tap: Preview puts a source in preview (green tile, the preview box, PREVIEW on
# the phone); AUTO dissolves it to air smoothly and flip-flops; the T-bar dissolves by hand
# (halfway shows both pictures; all the way takes it); CUT takes preview straight to air;
# The break and black are sources too: in preview, AUTO fades to black (and back up), CUT takes
# the break and back. Tap: Air goes back to tapping straight to air. Camera control: narrow strips, the width
# remembered, and a message to a camera from its strip.
# Run: node dev/server.mjs &  then  python3 test/e2e_switcher.py
import os, re, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Switcher'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    phones = {}
    for name in ['Ana', 'Ben']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones[name] = c
        host.wait_for_function(f"document.querySelectorAll('.tile[data-peer] video').length === {len(phones)} && [...document.querySelectorAll('.tile[data-peer] video')].every(v => v.readyState >= 2)", timeout=45000)
    host.click('.tile[data-peer]:has-text("Ana")'); time.sleep(0.8)
    assert 'Ana' in host.inner_text('#progLabel')
    assert host.is_visible('#swTgl'); host.click('#swTgl'); assert host.is_visible('#switcher')
    host.click('#switcher [data-tap="preview"]')
    host.click('.tile[data-peer]:has-text("Ben")')
    # (on a slow machine, wait for it rather than assume a moment is enough)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ana') && !document.querySelector('#pvwBox').hidden && document.querySelector('#pvwLabel').textContent.includes('Ben')", timeout=20000)
    assert 'pvw' in host.get_attribute('.tile[data-peer]:has-text("Ben")', 'class')
    phones['Ben'].wait_for_selector('#pvwTag:not([hidden])', timeout=8000)
    step('Tap: Preview: tapping Ben put him in preview (green tile, the preview box, PREVIEW on his phone) and Ana stayed on air')

    host.select_option('#swDur', '3')
    # (this test machine draws only a few frames a second, so: the dissolve takes its time, then lands)
    host.click('#swAuto')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben') && !document.querySelector('#progLabel').textContent.includes('%')", timeout=20000)
    took = host.evaluate("vmSwitcher().lastTook") / 1000
    assert 2.6 < took < 6, took
    mids = [round(took, 1)]
    assert 'Ana' in host.inner_text('#pvwLabel')
    phones['Ben'].wait_for_selector('#pvwTag', state='hidden', timeout=8000); phones['Ana'].wait_for_selector('#pvwTag:not([hidden])', timeout=8000)
    step(f'AUTO (3 s): the dissolve took {mids[0]} s and Ben is on air; Ana went to preview (flip-flop), her phone says PREVIEW')

    bar = host.locator('#tbar .ttrack').bounding_box()
    x = bar['x'] + bar['width'] / 2
    # the bar now rests at the top: pull it down halfway, hold, then all the way
    host.mouse.move(x, bar['y'] + 2); host.mouse.down()
    for i in range(1, 11): host.mouse.move(x, bar['y'] + bar['height'] * 0.05 * i); time.sleep(0.03)
    time.sleep(0.6)
    half = host.inner_text('#progLabel')
    assert re.search(r'(4\d|5\d)%', half) and 'Ben → Ana' in half, half
    for i in range(11, 21): host.mouse.move(x, bar['y'] + bar['height'] * 0.05 * i); time.sleep(0.03)
    host.mouse.move(x, bar['y'] + bar['height'] + 4); host.mouse.up()
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ana') && !document.querySelector('#progLabel').textContent.includes('%')", timeout=8000)
    step(f'T-bar by hand: halfway shows both pictures ("{half}"), all the way takes Ana to air; Ben is in preview')

    host.click('#swCut'); time.sleep(0.6)
    assert 'Ben' in host.inner_text('#progLabel') and 'Ana' in host.inner_text('#pvwLabel')

    # ---- the break and black are sources: in preview, then AUTO / the T-bar / CUT
    host.select_option('#swDur', '2')
    host.click('#multi [data-special="black"]')
    host.wait_for_function("document.querySelector('#pvwLabel').textContent.includes('BLACK') && document.querySelector('#multi [data-special=black]').classList.contains('pvw')", timeout=5000)
    host.click('#swAuto')
    host.wait_for_function("document.querySelector('#progLabel').textContent === 'FADING TO BLACK'", timeout=5000)
    host.wait_for_function("document.querySelector('#progLabel').textContent === 'BLACK'", timeout=15000)
    assert host.get_attribute('#multi [data-special="black"]', 'aria-pressed') == 'true' and 'Ben' in host.inner_text('#pvwLabel'), host.inner_text('#pvwLabel')
    step('Black in preview, AUTO faded to black over the dissolve time (FADING TO BLACK, then BLACK); Ben waits in preview')
    host.click('#swAuto')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben') && !document.querySelector('#progLabel').classList.contains('black')", timeout=15000)
    assert 'BLACK' in host.inner_text('#pvwLabel'), host.inner_text('#pvwLabel')
    step('AUTO again faded back up on Ben; black waits in preview (flip-flop)')
    host.click('#multi [data-special="break"]'); host.click('#swCut')
    host.wait_for_function("document.querySelector('#progLabel').textContent === 'ON AIR · BREAK'", timeout=10000)
    assert 'Ben' in host.inner_text('#pvwLabel'), host.inner_text('#pvwLabel')
    host.click('#swCut')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben') && document.querySelector('#pvwLabel').textContent.includes('BREAK')", timeout=10000)
    step('Break: in preview, CUT to the slate (Ben waits in preview), CUT back to Ben (the break waits in preview)')
    assert host.query_selector('#breakBtn') is None and host.query_selector('#blackBtn') is None
    step('Break and Black are no longer buttons under the program')
    host.click('#switcher [data-tap="air"]'); host.click('.tile[data-peer]:has-text("Ana")'); time.sleep(0.6)
    assert 'Ana' in host.inner_text('#progLabel')
    step('CUT takes preview straight to air; Tap: Air puts a tapped source straight on air again')

    with ctx.expect_page() as pop: host.click('#ccuBtn')
    w = pop.value; w.wait_for_selector('.cam [data-k="z"]', timeout=15000); time.sleep(1)
    widths = w.eval_on_selector_all('.cam', 'e => e.map(x => Math.round(x.getBoundingClientRect().width))')
    assert all(v <= 320 for v in widths) and len(widths) == 2, widths
    w.eval_on_selector('#cw', "r => { r.value = '240'; r.dispatchEvent(new Event('input', {bubbles:true})); }"); time.sleep(0.3)
    narrow = w.eval_on_selector_all('.cam', 'e => e.map(x => Math.round(x.getBoundingClientRect().width))')
    assert all(v <= 250 for v in narrow), narrow
    w.fill('.cam:has-text("Ana") [data-msg] input', 'Get a wide shot please'); w.press('.cam:has-text("Ana") [data-msg] input', 'Enter')
    phones['Ana'].wait_for_function("document.body.innerText.includes('Get a wide shot please')", timeout=10000)
    step(f'Camera control: a bank of narrow strips ({widths} px, down to {narrow} px with the width slider), and a message sent from Ana\'s strip reached her phone')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
