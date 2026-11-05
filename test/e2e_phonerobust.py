# Phones that misbehave, handled: (1) a phone whose browser won't keep the live cut as a blob
# (some iPhones) keeps it as raw bytes and it's still in My events; (2) the camera stopping
# in the background brings up "Turn the camera back on", one tap; (3) a phone whose camera
# never answers on join (a reopened home-screen app) gets asked again instead of hanging.
# Run: node dev/server.mjs &  then  python3 test/e2e_phonerobust.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import wait_or_show
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
# a browser that refuses to store this kind of blob in IndexedDB (as some iPhones do)
NO_BLOBS = """(() => { const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) { if (v && v.blob instanceof Blob && String(v.id || '').startsWith('pgm-')) throw new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError'); return put.call(this, v, k); }; })();"""
# a camera that never answers the first time (then works)
HANGS_ONCE = """(() => { const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md); let n = 0;
  md.getUserMedia = (c) => (c && c.video && n++ === 0 ? new Promise(() => {}) : gum(c)); })();"""
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Tough phones'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    pc = b.new_context(permissions=['camera', 'microphone']); pc.add_init_script(NO_BLOBS)
    cam = pc.new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.evaluate("document.querySelector('.tile[data-peer]').click()"); time.sleep(1)
    with host.expect_download(timeout=90000):
        host.evaluate("document.querySelector('#recProgBtn').click()"); time.sleep(7); host.evaluate("document.querySelector('#recProgBtn').click()")
    host.bring_to_front(); host.keyboard.press('Escape'); host.keyboard.press('b')   # (off air: the phone stops recording, so its part can come)
    for _ in range(80):
        got = cam.evaluate("(async () => (await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('outbox').objectStore('outbox').getAll(); t.onsuccess = () => r(t.result.filter(x => String(x.id).startsWith('pgm-')).map(x => [x.keptAs || 'blob', x.buf ? x.buf.byteLength : 0])); }; })))()")
        if got: break
        time.sleep(0.5)
    assert got and got[0][0] == 'bytes' and got[0][1] > 10000, got
    cam.click('#camTitle'); cam.click('#linkSheet .openLib'); cam.wait_for_selector('#library:not([hidden])')
    cam.wait_for_function("[...document.querySelectorAll('#libList li')].some(li => li.textContent.includes('Live cut · part 1 ·'))", timeout=10000)
    step(f"a browser that won't store the live cut as a blob kept it as raw bytes ({got[0][1] // 1024} KB) and it's in My events as Live cut · part 1")
    cam.keyboard.press('Escape'); cam.evaluate("document.querySelector('#library')?.close?.()"); time.sleep(0.5)
    cam.reload(); cam.wait_for_selector('#joinView:not([hidden])', timeout=10000); cam.click('#joinForm button[type=submit]'); wait_or_show(cam, '#camView.on', 20000, 'rejoining after a reload')

    # the camera stops (as phones do in the background): one tap brings it back
    cam.evaluate("document.querySelector('#preview').srcObject?.getVideoTracks().forEach(t => t.stop()); (window.__vmKit || null)")
    cam.evaluate("for (const v of document.querySelectorAll('video')) v.srcObject?.getVideoTracks?.().forEach(t => t.stop())")
    cam.wait_for_selector('#camBack:not([hidden])', timeout=12000)
    cam.click('#camBackGo'); cam.wait_for_selector('#camBack', state='hidden', timeout=15000)
    time.sleep(2)
    live = cam.evaluate("[...document.querySelectorAll('video')].some(v => v.srcObject?.getVideoTracks?.().some(t => t.readyState === 'live'))")
    assert live
    step('the camera stopped (as in the background): "Turn the camera back on" came up, and one tap brought it back')

    # a reopened app whose camera never answers on join: asked again, not stuck
    pc2 = b.new_context(permissions=['camera', 'microphone']); pc2.add_init_script(HANGS_ONCE)
    c2 = pc2.new_page(); c2.on('pageerror', lambda e: errors.append(f'c2: {e}'))
    c2.goto(f"{BASE}/cam?e={ev['id']}"); c2.fill('#name', 'Ben'); c2.check('#agreeGuest'); c2.click('#joinForm button[type=submit]')
    c2.wait_for_selector('#setupView:not([hidden]) #setupAllow', timeout=20000)
    msg = c2.inner_text('#setupErr')
    assert c2.is_visible('#setupReload') and 'didn' in msg, msg
    c2.click('#setupAllow'); wait_or_show(c2, '#camView.on', 20000, 'after Allow, on the second try')
    step(f'a camera that never answered on join: after 8 s it asked again ("{msg}", with Reload VUEMesh), and Allow got it going')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
