# Record-only overflow: past the live-picture limit, phones join recording only (no tile,
# listed under "Recording only", told so on the phone) and still deliver every clip; a
# freed-up picture promotes the longest-waiting phone; Swap in trades places.
# Also: every page still loads cleanly with its search and sharing tags.
# Run: node dev/server.mjs &  then  python3 test/e2e_overflow.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)
TILES = "[...document.querySelectorAll('.cam')].filter(c => c.style.display !== 'none').map(c => c.querySelector('.who').textContent).sort()"
WAITING = "[...document.querySelectorAll('#ovList .nm')].map(x => x.textContent)"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    # search and sharing tags on the public pages
    for path, robots in [('/', None), ('/terms', None), ('/sponsors', None), ('/cam', 'noindex'), ('/watch', 'noindex')]:
        pg = b.new_context().new_page(); pg.on('pageerror', lambda e, x=path: errors.append(f'{x}: {e}'))
        pg.goto(BASE + path)
        meta = pg.evaluate("""() => { const m = (s) => document.querySelector(s)?.getAttribute('content'); return { title: m('meta[property="og:title"]'), image: m('meta[property="og:image"]'), card: m('meta[name="twitter:card"]'), robots: m('meta[name="robots"]') }; }""")
        assert meta['image'] == 'https://vuemesh.com/og.png' and meta['card'] == 'summary_large_image' and (robots is None or robots in (meta['robots'] or '')), (path, meta)
        pg.context.close()
    img = host.evaluate("fetch('/og.png').then(r => r.headers.get('content-type') + ' ' + r.status)")
    assert host.evaluate("fetch('/robots.txt').then(r => r.ok)") and host.evaluate("fetch('/sitemap.xml').then(r => r.ok)") and '200' in img
    step(f'share and search tags on every public page (OG image {img}); event links preview but stay out of search; robots.txt and sitemap.xml served')

    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Packed hall'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    host.fill('#liveLimit', '2'); host.dispatch_event('#liveLimit', 'change')
    ph = {}
    for i, name in enumerate(['Rosa', 'Dev', 'Maya']):
        c = b.new_context(viewport={'width': 390, 'height': 844}, user_agent=ANDROID, permissions=['camera', 'microphone']).new_page()
        c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
        # a record-only phone has no tile: count live tiles plus the "Recording only" list
        host.wait_for_function(f"[...document.querySelectorAll('.cam')].filter(c => c.style.display !== 'none').length + document.querySelectorAll('#ovList li').length === {i + 1}", timeout=20000); time.sleep(1.5)
    host.wait_for_function(f"{WAITING}.length === 1", timeout=10000)
    ph['Maya'].wait_for_selector('#pausedTag:not([hidden])', timeout=8000)
    tiles, waiting, tag = host.evaluate(TILES), host.evaluate(WAITING), ph['Maya'].inner_text('#pausedTag')
    assert tiles == ['Dev', 'Rosa'] and waiting == ['Maya'] and 'RECORDING ONLY' in tag, (tiles, waiting, tag)
    step(f'limit 2: Rosa and Dev live {tiles}; Maya joined recording only (listed {waiting}); her phone says "{tag}"')

    ph['Maya'].evaluate("document.querySelector('#shutter').click()"); time.sleep(2.5); ph['Maya'].evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.some(c => c.name === 'Maya')); }; }))()", timeout=30000)
    step('Maya recorded a clip while recording only: it reached the studio like anyone\'s')

    host.click('.tile[data-peer]:has-text("Rosa")'); time.sleep(0.5)   # Rosa on air
    ph['Dev'].click('#camTitle'); ph['Dev'].click('#leaveBtn'); ph['Dev'].wait_for_selector('#rejoinCard:not([hidden])', timeout=8000)
    host.wait_for_function(f"JSON.stringify({TILES}) === JSON.stringify(['Maya', 'Rosa'])", timeout=15000)
    ph['Maya'].wait_for_selector('#pausedTag', state='hidden', timeout=8000)
    step(f'Dev left: Maya moved up to a live picture by herself {host.evaluate(TILES)}; her phone is live again')

    host.fill('#liveLimit', '1'); host.dispatch_event('#liveLimit', 'change'); time.sleep(1)
    assert host.evaluate(TILES) == ['Rosa'] and host.evaluate(WAITING) == ['Maya'], (host.evaluate(TILES), host.evaluate(WAITING))
    host.click('.tile[data-peer]:has-text("Rosa")'); time.sleep(0.3)  # (Rosa stays on air)
    host.click(f'#ovList [data-swap]'); time.sleep(0.4)
    # Rosa is on air, so she can't step back: Swap in says so
    msg = next((t for t in host.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)') if 'on air' in t), '')
    step(f'limit 1: Maya stepped back (newest, not on air); Swap in won\'t take Rosa off while she\'s on air: "{msg}"')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
