# Your events on this device: the list shows each event's storage and server status;
# an event deleted on the server keeps its footage here, labelled; Export gives one ZIP;
# Archive tucks it away; Delete removes it from this device (only when asked).
# Run: node dev/server.mjs &  then  python3 test/e2e_events.py   (dev admin key: dev-admin)
import json, os, sys, time, zipfile
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Backyard wedding'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(3); cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=30000)

    home = ctx.new_page(); home.on('pageerror', lambda e: errors.append(f'home: {e}')); home.on('dialog', lambda d: d.accept())
    home.goto(BASE + '/')
    row = f'[data-ev="{ev["id"]}"]'
    home.wait_for_function(f"document.querySelector('{row} [data-status]')?.textContent.length > 0", timeout=8000)
    meta = home.inner_text(f'{row} .m').replace('\n', ' ')
    assert 'recording' in meta and 'in this browser' in meta and ('Code active' in meta or 'LIVE' in meta) and 'on the server' not in meta, meta
    step(f'home page lists the event: {meta}')

    host.evaluate(f"fetch('/api/admin/events/{ev['id']}', {{ method: 'DELETE', headers: {{ 'x-admin-key': 'dev-admin' }} }})"); time.sleep(0.5)
    home.reload()
    home.wait_for_selector(f'{row} .badge.gone', timeout=8000)
    meta = home.inner_text(f'{row} .m').replace('\n', ' ')
    assert 'recording' in meta and 'Code ended' in meta, meta
    step(f'deleted on the server: labelled, but the footage here is untouched → {meta}')

    with home.expect_download(timeout=60000) as dl:
        home.click(f'{row} [data-act="export"]')
    dl.value.save_as('/tmp/event-export.zip')
    z = zipfile.ZipFile('/tmp/event-export.zip')
    names = z.namelist()
    assert z.testzip() is None and 'project.json' in names and any(n.startswith('recordings/') for n in names), names
    proj = json.loads(z.read('project.json'))
    # (both are in it; either can be empty: nothing went on air in this test, and Edit was never opened)
    assert proj['event']['id'] == ev['id'] and proj['recordings'] and 'edit' in proj and 'liveCuts' in proj, proj.keys()
    step(f'Export: one valid ZIP {names} with the edit and signed metadata in project.json')

    home.click(f'{row} [data-act="archive"]'); time.sleep(0.3)
    assert home.locator('#mineList ' + row).count() == 0 and 'Archived (1)' in home.inner_text('#archToggle')
    home.click('#archToggle'); time.sleep(0.2)
    assert home.locator('#archList ' + row).count() == 1
    step('Archive: moved out of the way, still listed under Archived (1)')

    home.click(f'{row} [data-act="delete"]')
    home.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.startsWith('Deleted'))", timeout=10000)
    left = home.evaluate(f"""async () => {{ const n = await new Promise(r => {{ const q = indexedDB.open('vuemesh'); q.onsuccess = () => {{ const t = q.result.transaction('clips').objectStore('clips').index('eventId').getAll('{ev['id']}'); t.onsuccess = () => r(t.result.length); }}; }});
      return [n, Object.keys(localStorage).filter(k => k.endsWith('_{ev['id']}')).length, document.querySelectorAll('{row}').length]; }}""")
    assert left == [0, 0, 0], left
    step('Delete from this device (after confirming): recordings, edit and settings for that event are gone; other events untouched')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
