# v0.22: the media engine (leave and rejoin three times: the studio keeps getting pictures
# and sound, and Camera control keeps drawing, with no reload), Pause feed on the phone
# (only off air and not recording), Camera control's lens buttons, transfers and news in
# the Monitor (light on the Monitor button; preview of what arrived), and no pop-ups for clips.
# Run: node dev/server.mjs &  then  python3 test/e2e_v22.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); errors = []; host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Engine'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844}).new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000); time.sleep(2)

    # Pause feed: offered off air and not recording; pauses the director's picture; gone on air
    cam.wait_for_selector('#feedBtn:not([hidden])', timeout=8000)
    cam.click('#feedBtn'); host.wait_for_selector('.tile[data-peer] .pz', timeout=8000)
    assert cam.get_attribute('#feedBtn', 'aria-pressed') == 'true'
    cam.click('#feedBtn'); host.wait_for_selector('.tile[data-peer] .pz', state='detached', timeout=8000)
    host.keyboard.press('1'); time.sleep(1.5)
    assert cam.is_visible('#feedBtn')   # (since 0.24 it stays on air: that's when it matters)
    step('Pause feed on the viewfinder pauses the director\'s picture (PAUSED on the tile) and resumes it, and stays there on air')

    def media_ok(tag):
        # (Chrome's test microphone beeps once a second: take the loudest of a few looks)
        a = host.evaluate("vmMedia()")[0]; levels = []
        for _ in range(30): levels.append(host.evaluate("vmMedia()")[0]['level'] or 0); time.sleep(0.1)
        m = host.evaluate("vmMedia()")[0]; m['level'] = max(levels)
        assert m['videoFrames'] > a['videoFrames'] and m['hearing'] and m['level'] > 0, (tag, a, m)
        return m
    with ctx.expect_page() as pop: host.click('#ccuBtn')
    w = pop.value; w.on('pageerror', lambda e: errors.append(f'ccu: {e}')); w.wait_for_selector('.cam [data-k="z"]', timeout=15000); time.sleep(1)
    ccu_px = lambda: w.evaluate("(() => { const c = document.querySelector('.cam [data-v]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 1] > 60) lit++; return lit; })()")
    m0 = media_ok('first')
    results = []
    for rnd in range(3):
        cam.click('#camTitle'); cam.click('#leaveBtn'); cam.wait_for_selector('#rejoinCard:not([hidden])', timeout=40000); time.sleep(1)
        cam.click('#rejoinBtn'); host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=30000); time.sleep(3)
        m = media_ok(f'rejoin {rnd + 1}')
        w.wait_for_selector('.cam [data-k="z"]', timeout=10000); time.sleep(0.5)
        px = ccu_px(); assert px > 20, ('ccu after rejoin', rnd, px)
        results.append((m['videoFrames'], round(m['level'], 3)))
    step(f'left and rejoined 3 times: the studio kept getting pictures and sound each time (frames, sound level) {results}, and Camera control kept drawing')

    lenses = w.eval_on_selector_all('.cam [data-lens]', 'e => e.map(x => [x.textContent, x.getAttribute("aria-pressed")])')
    assert len(lenses) >= 2, lenses
    other = [i for i, (_, on) in enumerate(lenses) if on != 'true'][0]
    w.click(f'.cam [data-lens] >> nth={other}')
    w.wait_for_function(f"document.querySelectorAll('.cam [data-lens]')[{other}]?.getAttribute('aria-pressed') === 'true'", timeout=10000)
    step(f"Camera control lists the phone's cameras {[t for t, _ in lenses]}; picking {lenses[other][0]} switched the phone to it")

    # a clip arrives: no pop-up in the studio; the Monitor button lights; the Monitor lists it with a preview
    host.keyboard.press('1'); cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(3); cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("document.querySelector('#monitorBtn').classList.contains('news') || document.querySelector('#monitorBtn').classList.contains('busy')", timeout=40000)
    for _ in range(80):
        toasts = host.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)')
        assert not any('arrived' in t for t in toasts), toasts
        if host.evaluate("[...document.querySelectorAll('#incoming span')].length") == 0 and host.evaluate("(window.vmMedia && true)"): pass
        if host.evaluate("(async () => (await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; })))()") >= 1: break
        time.sleep(0.5)
    assert host.is_hidden('#incoming')
    mon = ctx.new_page(); mon.on('pageerror', lambda e: errors.append(f'monitor: {e}'))
    mon.goto(f"{BASE}/monitor?e={ev['id']}#k={ev['hostKey']}")
    mon.wait_for_selector('#received [data-play]', timeout=15000)
    mon.click('#received [data-play]'); mon.wait_for_function("document.querySelector('#pvVideo').readyState >= 1", timeout=10000)
    assert mon.is_visible('#pv')
    host.wait_for_function("!document.querySelector('#monitorBtn').classList.contains('news')", timeout=10000)
    step(f"a clip arrived with no pop-up and no line in the studio's layout; the Monitor button lit up; the Monitor lists it under Received (\"{mon.inner_text('#received li')[:60]}…\") and plays it; looking at the Monitor put the light out")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
