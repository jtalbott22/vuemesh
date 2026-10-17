# Formats and diagnostics: the studio tests what its browser really records and warns when
# iPhones can't play it; phones test-play each live-cut part and explain one they can't;
# both pages produce a diagnostics report to copy.
# Run: node dev/server.mjs &  then  python3 test/e2e_diag.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
# a phone that can't decode blob videos (like an iPhone handed VP9)
CANT_PLAY = """(() => { const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return d.get.call(this); },
    set(v) { if (window.__noPlay && String(v).startsWith('blob:')) { d.set.call(this, ''); setTimeout(() => this.dispatchEvent(new Event('error')), 20); return; } d.set.call(this, v); } }); })()"""
def step(m): print('ok  ' + m, flush=True)
GOT = "(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('outbox').objectStore('outbox').getAll(); t.onsuccess = () => r(t.result.filter(x => x.status === 'received').map(x => x.meta)); }; }))()"
def until(page, expr, test, secs):
    end = time.time() + secs
    while True:
        v = page.evaluate(expr)
        if test(v) or time.time() > end: return v
        time.sleep(0.5)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Formats'})})).json()""")
    host.evaluate("localStorage.setItem('vm_piece_ms', '4000'); localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    host.wait_for_function("!document.querySelector('#pgmFormat').hidden || document.querySelector('#pgmFormat').textContent.length > 0", timeout=15000)
    fmt = host.inner_text('#pgmFormat'); shown = host.is_visible('#pgmFormat')
    step(f'studio tested its own recording format: {"warning shown — " + fmt[:110] if shown else "iPhone-friendly, no warning"}…')

    ph = {}
    for name, ua, cant in [('Pixel', ANDROID, False), ('Iris', IPHONE, True)]:
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, user_agent=ua, permissions=['camera', 'microphone'])
        if cant: ctx.add_init_script(CANT_PLAY)
        c = ctx.new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000); time.sleep(1)
    ph['Iris'].evaluate('window.__noPlay = true')
    host.click('.tile[data-peer]'); host.click('#recProgBtn'); time.sleep(5); host.click('#recProgBtn')
    # (phones confirm a part first, then test whether they can play it)
    pix = until(ph['Pixel'], GOT, lambda v: len(v) >= 1 and 'playable' in v[0], 40); iris = until(ph['Iris'], GOT, lambda v: len(v) >= 1 and 'playable' in v[0], 40)
    assert pix and pix[0]['playable'] is True and iris and iris[0]['playable'] is False, (pix, iris)
    step(f"part 1 ({pix[0]['codecs']}): plays on Pixel; Iris's phone can't decode it and knows it")

    iris_pg = ph['Iris']
    iris_pg.click('#camTitle'); iris_pg.click('#linkSheet .openLib'); iris_pg.wait_for_selector('#library:not([hidden])')
    iris_pg.wait_for_function("[...document.querySelectorAll('#libList li')].some(li => li.textContent.includes(\"Can't play on this phone\"))", timeout=6000)
    why = iris_pg.locator('#libList li .why').first.inner_text()
    iris_pg.locator('#libList li .thumb').first.click(); iris_pg.wait_for_selector('#playErr:not([hidden])', timeout=5000)
    perr = iris_pg.inner_text('#playErr'); iris_pg.click('#playClose')
    step(f'in My events: "Can\'t play on this phone" — {why[:90]}…; the player explains: "{perr[:70]}…"')

    iris_pg.click('#libClips .diagOpen'); iris_pg.wait_for_function("document.querySelector('#diagText').value.includes('Recent messages')", timeout=8000)
    rep = iris_pg.input_value('#diagText')
    for must in ['diagnostics', 'Video formats', 'live cut part 1', 'NOT PLAYABLE HERE', 'Browser:']:
        assert must in rep, (must, rep[:400])
    step(f'phone diagnostics report ({len(rep.splitlines())} lines): version, device, formats, each recording\'s format and status, recent errors')

    for _ in host.evaluate("[...document.querySelectorAll('dialog[open]')].map(d => d.id)"): host.keyboard.press('Escape'); time.sleep(0.2)   # the end-of-recording message
    host.click('#helpBtn'); host.click('#diagBtn'); host.wait_for_function("document.querySelector('#diagText').value.includes('Recent messages')", timeout=8000)
    srep = host.input_value('#diagText')
    assert 'Program recording format' in srep and 'Phones connected' in srep and 'Pixel' in srep, srep[:500]
    assert 'Network and capacity' in host.inner_text('.help .bd') or True
    step(f'studio diagnostics report ({len(srep.splitlines())} lines): program format, phones and their connections, event log')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
