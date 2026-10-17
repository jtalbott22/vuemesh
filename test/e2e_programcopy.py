# The live cut, sent to the crew: while the program records, it's cut into parts; each part
# goes to everyone who was connected during it. Someone who leaves gets only their part (and
# what finished while they were away, when they come back). The master is kept in the browser.
# Run: node dev/server.mjs &  then  python3 test/e2e_programcopy.py
import re, os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)
def until(page, expr, test, secs):
    end = time.time() + secs
    while True:
        v = page.evaluate(expr)
        if test(v) or time.time() > end: return v
        time.sleep(0.5)
def poll(page, expr, cond, timeout=40):
    # (a promise-returning check would read as "done" at once, so evaluate and test it here)
    end = time.time() + timeout
    while True:
        v = page.evaluate(expr)
        if cond(v) or time.time() > end: return v
        time.sleep(0.5)
GOT = "(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('outbox').objectStore('outbox').getAll(); t.onsuccess = () => r(t.result.filter(x => x.status === 'received').map(x => x.meta.part).sort((a, b) => a - b)); }; }))()"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    hctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Reception'})})).json()""")
    host.evaluate("localStorage.setItem('vm_piece_ms', '4000'); localStorage.setItem('vm_autorec_default', '0')")  # short parts for the test
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    ph = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(viewport={'width': 412, 'height': 915}, user_agent=ANDROID, permissions=['camera', 'microphone']).new_page()
        c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000); time.sleep(1)
    rosa, dev = ph['Rosa'], ph['Dev']
    assert host.is_checked('#sendPgm')
    host.click('.tile[data-peer]'); time.sleep(0.5)
    with host.expect_download(timeout=240000) as dl:
        host.click('#recProgBtn'); time.sleep(6)
        dev.click('#camTitle'); dev.click('#leaveBtn'); dev.wait_for_selector('#rejoinCard:not([hidden])', timeout=120000)
        at_leave = dev.evaluate(GOT)   # his part goes with him: the studio finishes it and sends it first
        time.sleep(8)
        host.click('#recProgBtn')
    # (normally his part goes with him; a studio too busy to finish it in time keeps it for his rejoin, checked below)
    step(f'recorded the program for ~14 s (downloaded "{dl.value.suggested_filename}"); Dev left after ~6 s, ' + (f', and got his part {at_leave} before he went' if at_leave else ' (his part waits for his rejoin)'))

    host.wait_for_function("/^\\d+ parts? of the live cut/.test(document.querySelector('#pgmState').textContent)", timeout=20000); time.sleep(1)
    made = int(host.inner_text('#pgmState').split(' ')[0])
    r_parts = poll(rosa, GOT, lambda v: len(v) >= made)
    assert r_parts == list(range(1, made + 1)), (made, r_parts)
    step(f'the studio made {made} parts; Rosa, there the whole time, got every one: {r_parts}')

    dev.click('#rejoinBtn'); dev.wait_for_selector('#camView.on', timeout=10000)
    time.sleep(8)   # nothing more should follow
    d_parts = dev.evaluate(GOT)
    # what Dev should have: exactly the parts that overlap the times the studio saw him there
    owed = host.evaluate("""(async () => {
      const id = new URLSearchParams(location.search).get('e');
      const pres = JSON.parse(localStorage.getItem('vm_presence_' + id) || '{}');
      const pieces = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('program').objectStore('program').getAll(); t.onsuccess = () => r(t.result.filter(x => x.kind === 'piece')); }; });
      const per = Object.values(pres).map(ivs => pieces.filter(p => ivs.some(([a, b]) => a < p.t1 && b > p.t0)).map(p => p.part).sort((a, b) => a - b));
      return per.sort((a, b) => a.length - b.length)[0];   // Dev is the one who was there less
    })()""")
    assert d_parts == owed and len(owed) < made, (d_parts, owed, made)
    step(f'Dev got exactly the parts covering when he was there {d_parts} (of {made}); any that finished while he was away arrived when he rejoined')

    state = host.inner_text('#pgmState')
    master = host.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('program').objectStore('program').getAll(); t.onsuccess = () => r(t.result.filter(x => x.kind === 'master').map(x => x.blob.size)); }; }))()")
    assert master and master[0] > 10000 and 'sent' in state, (master, state)
    step(f'studio: "{state}"; the full-quality master is also kept in the browser ({master[0] // 1024} KB)')

    rosa.click('#camTitle'); rosa.click('#linkSheet .openLib'); rosa.wait_for_selector('#library:not([hidden])')
    rosa.wait_for_function("[...document.querySelectorAll('#libList li')].some(li => li.textContent.includes('Live cut · part 1 ·'))", timeout=6000)
    row = rosa.locator('#libList li', has_text=re.compile(r'Live cut · part 1 ·')).inner_text().replace('\n', ' ')
    assert 'From the director' in row and rosa.locator('#libList li', has_text=re.compile(r'Live cut · part 1 ·')).locator('[data-act="send"]').count() == 0
    rosa.locator('#libList li', has_text=re.compile(r'Live cut · part 1 ·')).locator('.thumb').click()
    rosa.wait_for_function("document.querySelector('#playVideo').currentTime > 0.3", timeout=8000)
    step(f'in Rosa\'s My events: "{row[:70]}…" — plays, can be saved, nothing to send back')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
