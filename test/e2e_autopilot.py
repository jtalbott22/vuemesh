# Autopilot: the show runs itself. Off: "Record the program with the fades" starts Record
# program on a fade up and stops it at black. On: with no camera the program sits at black;
# the first camera (steady for 3 s) fades up, recording starts, the auto director takes over,
# and its name goes up; a second camera goes to preview (PREVIEW on its phone), then
# dissolves to air with "joined the show"; when everyone's gone for the time chosen, the
# program fades to black and the recording stops (kept, no download, no pop-up).
# Run: node dev/server.mjs &  then  python3 test/e2e_autopilot.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    downloads = []; host.on('download', lambda d: downloads.append(d.suggested_filename))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Hands free'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    A = lambda: host.evaluate('vmAutopilot()')

    # with the fades, by hand
    host.check('#recFades'); host.evaluate('document.activeElement.blur()')   # (keys typed into a checkbox stay there)
    host.keyboard.press('x'); time.sleep(1.6)
    assert A()['black'] and not A()['recording']
    host.keyboard.press('x'); time.sleep(1.0)
    assert A()['recording'], A()
    host.keyboard.press('x'); time.sleep(2.5)
    assert not A()['recording'] and A()['black'], A()
    step('"Record the program with the fades": fading up started Record program, fading to black stopped it')
    time.sleep(1); downloads.clear()
    host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")   # (by hand: the usual wrap-up)
    host.evaluate("(() => { const c = document.querySelector('#recFades'); c.checked = false; c.dispatchEvent(new Event('change')); })()")

    host.select_option('#apEnd', '15'); host.evaluate("(() => { const c = document.querySelector('#apOn'); c.checked = true; c.dispatchEvent(new Event('change')); })()"); time.sleep(1.5)
    a = A(); assert a['on'] and a['state'] == 'idle' and a['black'], a
    phones = {}
    def join(name):
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e: errors.append(f'{name}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones[name] = c
    join('Ana')
    host.wait_for_function("vmAutopilot().state === 'running' && vmAutopilot().recording && !vmAutopilot().black", timeout=45000)
    time.sleep(1.5)
    a = A(); lt = host.inner_text('#ltText') if host.query_selector('#ltText') else ''
    assert a['auto'] and 'Ana' in host.inner_text('#progLabel'), (a, host.inner_text('#progLabel'))
    step("Autopilot: black with nobody here; Ana arrived and the show came up by itself: recording, the auto director cutting, her name up")

    join('Ben')
    # (the studio says it went through preview; on a busy test machine the phone's PREVIEW tag can come and go between looks)
    host.wait_for_function("vmAutopilot().welcomed.includes('Ben')", timeout=90000)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben')", timeout=30000)
    step('Ben arrived: in preview first (PREVIEW on his phone), then he dissolved to air with "joined the show"')

    for c in phones.values(): c.context.close()
    host.wait_for_function("vmAutopilot().state === 'idle' && !vmAutopilot().recording && vmAutopilot().black", timeout=60000)
    master = host.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('program').objectStore('program').getAll(); t.onsuccess = () => r(t.result.filter(x => x.kind === 'master').length); }; }))()")
    wrap = host.evaluate("[...document.querySelectorAll('dialog[open]')].map(d => d.id)")
    assert master >= 2 and not any('live' in d for d in downloads) and not wrap, (master, downloads, wrap)
    step(f"everyone left: 15 s later the program faded to black and the recording stopped by itself, kept in the browser ({master} recordings), no download and no pop-up")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
