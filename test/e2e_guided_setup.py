# v0.24: the guided setup (one question at a time, only when the browser will ask) and the
# "you're in control" card; the selfie camera kept from the director unless allowed; a new
# lens starts at 1×; Pause feed on air; the event code typed cleanly; two Record program
# takes in a row both have moving pictures. (The watch link: test/e2e_watch.py.)
# Run: node dev/server.mjs &  then  python3 test/e2e_guided_setup.py
import os, time, subprocess
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'   # (the motion step is for phones and tablets: a fake iPhone says it's one)
IPHONE = "Object.defineProperty(DeviceMotionEvent, 'requestPermission', { value: async () => 'granted' }); Object.defineProperty(DeviceOrientationEvent, 'requestPermission', { value: async () => 'granted' });"
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    hctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Onboard'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)

    # the event code: capitals and digits only, whatever's typed
    home = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    home.goto(BASE + '/cam'); home.click('#codeInput'); home.keyboard.type(ev['id'][:3].lower() + ' -' + ev['id'][3:].lower())
    typed = home.input_value('#codeInput')
    assert typed == ev['id'], typed
    home.keyboard.press('Enter'); home.wait_for_url(f"**/cam?e={ev['id']}", timeout=8000)
    step(f'typing "{ev["id"][:3].lower()} -{ev["id"][3:].lower()}" into the event code gives {typed}, and Enter goes to the event')

    # an iPhone whose browser will ask: one question at a time
    c = b.new_context(viewport={'width': 390, 'height': 844}, user_agent=IPHONE_UA); c.add_init_script(IPHONE)
    cam = c.new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}')); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('[data-step="perm"]:not([hidden])', timeout=8000)
    assert cam.is_hidden('#camView.on') if cam.query_selector('#camView.on') else True
    cam.click('#setupAllow'); cam.wait_for_selector('[data-step="motion"]:not([hidden])', timeout=10000)
    cam.click('#setupMotion'); cam.wait_for_selector('#camView.on', timeout=10000)
    cam.wait_for_selector('#ctlNote:not([hidden])', timeout=5000)
    step('a browser that will ask gets the guided setup: camera and microphone, then motion, one at a time; then the camera, with a one-time "You\'re in control" card')
    cam.click('#ctlNoteOk')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000); time.sleep(2)

    # Pause feed stays available on air
    host.keyboard.press('1'); time.sleep(1.5)
    assert cam.is_visible('#feedBtn'), 'Pause feed hidden on air'
    step('Pause feed is there while on air')

    # the director's lens choices follow the phone's: turn this kind of camera off and the director can't pick it
    with hctx.expect_page() as pop: host.click('#ccuBtn')
    w = pop.value; w.wait_for_selector('.cam [data-k="z"]', timeout=15000); time.sleep(2)
    n_before = w.eval_on_selector_all('.cam [data-lens]', 'e => e.length')
    cam.evaluate("document.querySelector('#camSettings').showModal()"); time.sleep(0.6)
    cam.uncheck('#setLenses input >> nth=0'); time.sleep(0.3); cam.evaluate("document.querySelector('#camSettings').close()")
    w.wait_for_function("document.querySelectorAll('.cam [data-lens]').length === 0", timeout=10000)
    step(f'the director could switch between {n_before} cameras; with that kind of camera kept private in Settings, Camera control offers none')
    w.close()

    # a new lens starts at 1x
    cam.evaluate("document.querySelector('#zoomSlider').value = '2.5'; document.querySelector('#zoomSlider').dispatchEvent(new Event('input'))"); time.sleep(1)
    cam.click('#lenses button:has-text("Cam 2")'); time.sleep(2)
    z = cam.evaluate("+document.querySelector('#zoomSlider').value")
    assert abs(z - 1) < 0.01, z
    step('zoomed to 2.5×, switched lens: the new lens starts at 1×')

    # two Record program takes in a row: both pictures keep moving
    def take(n):
        with host.expect_download(timeout=60000) as dl:
            host.click('#recProgBtn'); time.sleep(4); host.click('#recProgBtn')
        path = f'/tmp/v24prog{n}.webm'; dl.value.save_as(path)
        out = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vf', 'fps=2', '-f', 'framemd5', '-'], capture_output=True, text=True).stdout
        hashes = [l.split(',')[-1].strip() for l in out.splitlines() if l and not l.startswith('#')]
        return len(set(hashes))
    d1 = take(1); time.sleep(1); host.keyboard.press('Escape'); time.sleep(1.5); d2 = take(2)
    assert d1 > 5 and d2 > 5, (d1, d2)
    step(f'Record program twice in a row: both takes have moving pictures ({d1} and {d2} different frames)')
    time.sleep(1); host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())"); time.sleep(0.5)

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
