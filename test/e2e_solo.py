# The camera page without an event: a small theme symbol, the camera on its own (clips
# saved to My events), and scanning the beacon to join — with a real beacon code shown
# to a second browser's camera.  Run: node dev/server.mjs &  then  python3 test/e2e_solo.py
import base64, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)
launch = lambda p, extra=[]: p.chromium.launch(executable_path=CHROME, args=ARGS + extra) if CHROME else p.chromium.launch(args=ARGS + extra)

with sync_playwright() as p:
    b = launch(p)
    errors = []
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, user_agent=ANDROID, permissions=['camera', 'microphone'])
    cam = ctx.new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(BASE + '/')
    ev = cam.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Backyard wedding'})})).json()""")
    cam.goto(f"{BASE}/cam?e={ev['id']}")
    tb = cam.locator('#themeBtn').bounding_box()
    joining = cam.locator('#joinView .vm-eyebrow').bounding_box()
    assert tb['width'] <= 40 and joining['height'] < 40, (tb, joining)
    step(f"theme toggle is a {tb['width']:.0f}px symbol (\"{cam.inner_text('#themeBtn')}\", labelled \"{cam.get_attribute('#themeBtn', 'aria-label')}\"); \"You're joining\" stays on one line")

    cam.goto(f"{BASE}/cam")
    cam.click('#soloBtn')
    cam.wait_for_selector('#camView.on', timeout=15000)
    status = cam.inner_text('#upPill')
    assert cam.inner_text('#camTitleText') == 'On my own' and 'My events' in status
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(2.5); cam.evaluate("document.querySelector('#shutter').click()")
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Saved to My events'))", timeout=20000)
    step(f'the camera on its own: "{status}"; recorded a clip → "Saved to My events"')
    cam.click('#camTitle'); cam.wait_for_selector('#linkSheet[open]')
    sheet = [cam.is_visible('#liveSwitch'), cam.inner_text('#leaveBtn')]
    cam.click('#linkSheet .openLib'); cam.wait_for_selector('#library:not([hidden])')
    row = cam.inner_text('#libList li').replace('\n', ' ')
    assert 'Saved on this phone' in row and cam.locator('#libList [data-act="send"]').count() == 0 and sheet == [False, 'Join an event'], (row, sheet)
    step(f'event menu offers My events and "Join an event" (no live switch); My events: "{row[:60]}…" with no Send button')

    # a real beacon join code, shown to a camera
    home = ctx.new_page(); home.goto(BASE + '/')   # the home page loads the QR generator
    qr = home.evaluate(f"""(async () => {{ const {{ drawQR }} = await import('/js/vm.js'); const c = document.createElement('canvas'); drawQR(c, '{BASE}/cam?e={ev['id']}#t=123456', {{ size: 480 }}); return c.toDataURL('image/png'); }})()""")
    open('/tmp/beaconqr.png', 'wb').write(base64.b64decode(qr.split(',')[1]))
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-i', '/tmp/beaconqr.png', '-vf', 'pad=640:480:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p', '-t', '3', '-r', '15', '/tmp/beaconqr.y4m'], check=True)
    b2 = launch(p, ['--use-file-for-fake-video-capture=/tmp/beaconqr.y4m'])
    sc = b2.new_context(viewport={'width': 390, 'height': 844}, user_agent=ANDROID, permissions=['camera', 'microphone']).new_page()
    sc.on('pageerror', lambda e: errors.append(f'scan: {e}'))
    sc.goto(f"{BASE}/cam"); sc.click('#scanJoinBtn')
    sc.wait_for_url(f"**/cam?e={ev['id']}", timeout=15000)
    sc.wait_for_function("document.querySelector('#joinTitle').textContent.length > 0", timeout=8000)
    step(f'Scan the beacon instead: pointed at the beacon\'s code → joined "{sc.inner_text("#joinTitle")}" ({ev["id"]}) without typing')
    b2.close()
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
