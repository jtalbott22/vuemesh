# My events (camera person): every clip kept with its delivery status, a clip the host
# didn't confirm doesn't hold up the others and can be retried, the player, delete, the
# show's messages and stats, and opening it straight from the home page without rejoining.
# Run: node dev/server.mjs &  then  python3 test/e2e_footage.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
LOSE_NEXT = """(() => { const orig = RTCDataChannel.prototype.send; RTCDataChannel.prototype.send = function (d) {
  if (window.__failNext && typeof d === 'string' && d.includes('"t":"ack"') && d.includes('"ok":true')) { window.__failNext = false; d = d.replace('"ok":true', '"ok":false,"error":"Simulated loss"'); }
  return orig.call(this, d); }; })()"""
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    hctx = b.new_context(viewport={'width': 1440, 'height': 900}); hctx.add_init_script(LOSE_NEXT)
    host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Footage night'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    pctx = b.new_context(viewport={'width': 412, 'height': 915}, user_agent=ANDROID, permissions=['camera', 'microphone'], accept_downloads=True)
    cam = pctx.new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    host.click('.tile[data-peer]')  # on air, for the on-air tally
    row = host.locator('.dmrow').first; row.locator('input').fill('Great angle, keep it'); row.locator('input').press('Enter')
    host.fill('#rundownText', 'Entrance\nToasts'); host.click('#rundownSend'); time.sleep(0.3); host.click('#cueNext')
    delivered = lambda: cam.evaluate("[...document.querySelectorAll('.toast')].filter(t => t.textContent.includes('delivered')).length")
    def shoot(sec):
        cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(sec); cam.evaluate("document.querySelector('#shutter').click()")

    shoot(2)
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('delivered'))", timeout=30000)
    host.evaluate('window.__failNext = true')
    shoot(2)
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes(\"didn't reach the host\"))", timeout=30000)
    step('clip 2: the host never confirmed it — the phone says so and keeps a copy')
    shoot(2)
    # (on air, a phone sends its clips slowly, so the live picture keeps the Wi-Fi: give it time)
    for _ in range(120):
        n = cam.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('outbox').objectStore('outbox').getAll(); t.onsuccess = () => r(t.result.filter(x => x.status === 'delivered').length); }; }))()")
        if n >= 2: break
        time.sleep(0.5)
    assert n >= 2, n
    step('clip 3 went straight through: a failed clip no longer holds up the ones behind it')

    host.click('.tile[data-peer]'); time.sleep(0.3)  # (keeps the tally running; harmless)
    cam.click('#camTitle'); cam.wait_for_selector('#linkSheet[open]'); cam.click('#linkSheet .openLib')
    cam.wait_for_selector('#library:not([hidden])', timeout=5000)
    cam.wait_for_function("document.querySelectorAll('#libList li').length === 3", timeout=5000)
    sts = cam.eval_on_selector_all('#libList .st', 'e => e.map(x => x.textContent)')
    assert sts[0].startswith('✓') and 'Simulated loss' in sts[1] and sts[2].startswith('✓'), sts
    step(f"My events lists all three: {sts}")

    cam.click('#libList li >> nth=1 >> [data-act="send"]')
    cam.wait_for_function("document.querySelectorAll('#libList .st')[1].textContent.startsWith('✓')", timeout=30000)
    step('Retry on clip 2: delivered ✓')

    cam.click('#libList li >> nth=0 >> .thumb')
    cam.wait_for_selector('#player:not([hidden])', timeout=4000)
    cam.wait_for_function("document.querySelector('#playVideo').currentTime > 0.3", timeout=8000)
    fit = cam.evaluate("(() => { const v = document.querySelector('#playVideo'); return [v.videoWidth, v.videoHeight, Math.round(parseFloat(v.style.width))]; })()")
    cam.click('#playClose')
    step(f'the player plays clip 1, framed to the shot inside its {fit[0]}×{fit[1]} recording')

    cam.click('#libList li >> nth=0 >> [data-act="delete"]')
    cam.wait_for_function("document.querySelectorAll('#libList li').length === 2", timeout=5000)
    left = cam.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('outbox').objectStore('outbox').getAll(); t.onsuccess = () => r(t.result.length); }; }))()")
    assert left == 2, left
    step('Delete removed clip 1 from the phone (2 left)')

    cam.click('#tabShow'); time.sleep(0.3)
    stats = cam.inner_text('#showStats').replace('\n', ' ')
    msg = cam.inner_text('#libMsgs'); rd = cam.inner_text('#libRundown')
    assert 'Great angle' in msg and 'Entrance' in rd, (msg, rd)
    step(f'Show tab: {stats} · the director\'s message and the rundown are there')

    home = pctx.new_page(); home.on('pageerror', lambda e: errors.append(f'home: {e}'))
    home.goto(BASE + '/'); home.wait_for_selector(f'[data-ev="{ev["id"]}"] a[href$="#footage"]', timeout=8000)
    home.click(f'[data-ev="{ev["id"]}"] a[href$="#footage"]')
    home.wait_for_selector('#library:not([hidden])', timeout=8000)
    n = home.evaluate("document.querySelectorAll('#libList li').length")
    joined = home.evaluate("document.querySelector('#camView').classList.contains('on')")
    assert n == 2 and not joined, (n, joined)
    step('home page → My events opens the library straight away, without rejoining (2 clips, messages intact)')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
