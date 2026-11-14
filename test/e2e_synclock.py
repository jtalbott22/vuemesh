# The beacon timing is locked in: once a camera has synced, going on and off air (fade to
# black stops its recording; fading back up starts a new one), reloading and rejoining never
# ask it to aim at the beacon again. Only a clock slip (the phone slept) resets it, once.
# Run: node dev/server.mjs &  then  python3 test/e2e_synclock.py   (needs ffmpeg)
import os, time, base64, subprocess
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)

BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
def launch(p, extra=[]):
    return p.chromium.launch(executable_path=CHROME, args=ARGS + extra) if CHROME else p.chromium.launch(args=ARGS + extra)
AIMING = "document.querySelector('#aimText').classList.contains('show') || document.querySelector('#aim').classList.contains('show')"

with sync_playwright() as p:
    b = launch(p)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sync lock', kind:'talk'})})).json()""")
    EID = ev['id']
    host.evaluate("localStorage.setItem('vm_autorec_default', '1')")
    # a beacon timecode, shown to the phone's camera the whole time
    qr = host.evaluate(f"""(async () => {{ const {{ drawQR }} = await import('/js/vm.js'); const c = document.createElement('canvas'); drawQR(c, '{BASE}/cam?e={EID}#t=' + Date.now(), {{ size: 420 }}); return c.toDataURL('image/png'); }})()""")
    open('/tmp/synclock.png', 'wb').write(base64.b64decode(qr.split(',')[1]))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', '/tmp/synclock.png', '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '3', '-r', '15', '/tmp/synclock.y4m'], check=True)
    host.goto(f"{BASE}/studio?e={EID}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)

    b2 = launch(p, ['--use-file-for-fake-video-capture=/tmp/synclock.y4m'])
    cam = b2.new_context(permissions=['camera', 'microphone']).new_page(); watch(cam, 'cam')
    def join():
        cam.goto(f"{BASE}/cam?e={EID}")
        cam.wait_for_selector('#joinForm, #camView.on', timeout=10000)
        if cam.is_visible('#joinForm'):
            if not cam.input_value('#name'): cam.fill('#name', 'Rosa')
            if not cam.is_checked('#agreeGuest'): cam.check('#agreeGuest')
            cam.click('#joinForm button[type=submit]')
        cam.wait_for_selector('#camView.on', timeout=15000)
    join()
    cam.wait_for_function("document.querySelector('#syncPill').textContent === 'Synced'", timeout=20000)
    step('joined and synced from the beacon once')

    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=20000)
    host.keyboard.press('1')
    cam.wait_for_function("document.querySelector('#shutter').classList.contains('rec')", timeout=10000)
    asked = any(cam.evaluate(AIMING) for _ in range(12) if not time.sleep(0.2))
    assert not asked and cam.inner_text('#syncPill') == 'Synced'
    step('on air → recording started by the director, with no "aim at the beacon" prompt')

    host.keyboard.press('x')
    cam.wait_for_function("!document.querySelector('#shutter').classList.contains('rec')", timeout=25000)
    step('fade to black → off air → the recording stopped by itself')
    host.keyboard.press('x')
    cam.wait_for_function("document.querySelector('#shutter').classList.contains('rec')", timeout=10000)
    asked = any(cam.evaluate(AIMING) for _ in range(15) if not time.sleep(0.2))
    assert not asked and cam.inner_text('#syncPill') == 'Synced'
    step('fade back up → recording again, still Synced, no prompt to scan')

    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(1)
    cam.evaluate("window.onbeforeunload = null"); cam.on('dialog', lambda d: d.accept())
    join()
    time.sleep(0.4)
    assert cam.inner_text('#syncPill') == 'Synced' and not cam.evaluate(AIMING), cam.inner_text('#syncPill')
    step('reloaded and rejoined: the timing was kept, no beacon needed')

    cam.evaluate("(() => { const d = Date.now.bind(Date); Date.now = () => d() + 7000; })()")  # as if the phone slept
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('slept'))", timeout=6000)
    cam.wait_for_function("document.querySelector('#syncPill').textContent === 'Synced'", timeout=20000)
    step('clock slipped (as when the phone sleeps) → timing reset with one notice, and it re-synced from the beacon in view')

    cam.click('#syncPill')
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Timing refreshed'))", timeout=15000)
    assert cam.inner_text('#syncPill') == 'Synced'
    step('tapping Synced took a fresh reading without dropping the lock meanwhile')

    # the studio knows: no NO SYNC tag on this camera, but one on a phone that never scanned the beacon
    other = b.new_context(permissions=['camera', 'microphone']).new_page(); watch(other, 'other')
    other.goto(f"{BASE}/cam?e={EID}"); other.fill('#name', 'Dev'); other.check('#agreeGuest'); other.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer]').length === 2", timeout=20000)
    host.wait_for_function("[...document.querySelectorAll('.tile[data-peer]')].some(t => t.querySelector('.who').textContent === 'Dev' && t.querySelector('.nosync'))", timeout=15000)
    tags = host.evaluate("[...document.querySelectorAll('.tile[data-peer]')].map(t => [t.querySelector('.who').textContent, !!t.querySelector('.nosync')])")
    assert dict(tags) == {'Rosa': False, 'Dev': True}, tags
    step(f'live tiles: the synced camera is clean; the phone that never scanned the beacon is marked NO SYNC {tags}')

    # every clip carries the lock; Auto-sync counts it instead of saying no clip shows the beacon
    clips = host.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.map(c => ({ name: c.name, src: c.t0Source, sync: c.sync || null }))); }; }))()")
    rosa = [c for c in clips if c['name'] == 'Rosa']
    assert len(rosa) >= 2 and all(c['src'] == 'phone' and c['sync'] and c['sync']['at'] for c in rosa), clips
    ed = edit_window(host.context, host, errors); time.sleep(1)
    ed.click('#syncBtn')
    ed.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('locked to the QR Beacon'))", timeout=30000)
    msg = next(t for t in ed.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)') if 'locked to the QR Beacon' in t)
    assert f'{len(rosa)} of {len(rosa)} clips are locked to the QR Beacon' in msg and 'No clips' not in msg, msg
    ed.click('#mediaTab'); time.sleep(0.3); ed.locator('#mediaList [data-kind="clip"]').first.click(); time.sleep(0.5)
    sync_row = ed.evaluate("(() => { const k = [...document.querySelectorAll('#mediaInsp .kv span')]; const i = k.findIndex(s => s.textContent === 'Sync'); return i >= 0 ? k[i + 1].textContent : null; })()")
    assert sync_row and sync_row.startswith('Locked to the QR Beacon'), sync_row
    step(f'each clip carries the lock ({rosa[0]["sync"]}); Auto-sync: "{msg}"; the recording says "{sync_row}"')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close(); b2.close()
