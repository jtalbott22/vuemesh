# The phone as a camera: lenses and microphones chosen separately (and switched while
# recording), zoom that really changes the recording, tap-to-focus, overlays, the
# vertical mic meter, the settings sheet, and full screen. Three fake cameras and mics.
# Run: node dev/server.mjs &  then  python3 test/e2e_camera_pro.py   (needs ffmpeg)
import base64, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Camera op'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent='Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36').new_page()  # a phone
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('#camView.on', timeout=15000)
    host.wait_for_selector('.tile[data-peer] video', timeout=20000)

    lenses = cam.eval_on_selector_all('#lenses button', 'e => e.map(x => x.textContent)')
    assert len(lenses) == 3, lenses
    step(f'zoom rail lists the phone\'s three cameras as lenses {lenses}, with a zoom slider')
    cam.wait_for_function("parseFloat(document.querySelector('#camVu .fill').style.height) > 5", timeout=10000)
    step(f"vertical mic meter is live ({cam.inner_text('#camVuDb')} dB)")

    cam.click('#setBtn'); cam.wait_for_selector('#camSettings[open]')
    cams = cam.eval_on_selector_all('#camSel option', 'e => e.map(x => x.textContent)')
    mics = cam.eval_on_selector_all('#micSel option', 'e => e.map(x => x.textContent)')
    quals = cam.eval_on_selector_all('#qualSel option', 'e => e.map(x => x.textContent)')
    step(f'settings sheet: {len(cams)} cameras, {len(mics)} microphones (chosen separately), quality {quals}')
    for t in ['tgGrid', 'tgLevel', 'tgZebra']: cam.check('#' + t)
    note = cam.inner_text('#csNote')
    cam.click('#csClose')
    shown = cam.evaluate("['#grid3', '#levelLine', '#zebra'].map(s => !document.querySelector(s).hidden)")
    assert shown == [True, True, True], shown
    step(f'grid, level and zebras on; the sheet explains what\'s digital here: "{note}"')

    # record: 1× → zoom to 2× → switch camera → switch mic, all without stopping
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(2.2)
    cam.evaluate("const s = document.querySelector('#zoomSlider'); s.value = '2'; s.dispatchEvent(new Event('input'))"); time.sleep(2.2)
    zoom_out = cam.inner_text('#zoomOut')
    cam.click('#setBtn'); cam.wait_for_selector('#camSettings[open]')
    first_mic = cam.evaluate("document.querySelector('#micSel').value")
    cam.select_option('#camSel', index=1); time.sleep(1.2)
    cam.select_option('#micSel', index=2); time.sleep(1.2)
    cam.click('#csClose')
    state = cam.evaluate("({ rec: document.querySelector('#shutter').classList.contains('rec'), mic: document.querySelector('#micSel').value })")
    time.sleep(1)
    assert state['rec'] and state['mic'] != first_mic, state
    step(f'while recording: zoomed to {zoom_out}, switched to camera 2 and microphone 3 — the take never stopped')
    cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=40000)

    # The lens switch mid-take rolls the recording into a new clip (each clip keeps one camera);
    # wait for both, then check the first: the camera's own picture with sound, and the 2×
    # digital zoom written into its log for the studio to apply.
    # (wait for both clips: a camera that's live paces its uploads to leave room for its picture)
    for _ in range(120):
        if host.evaluate("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; }))()") >= 2: break
        time.sleep(0.5)
    time.sleep(3.5)   # (let the "delivered" messages clear, so they don't cover the ones checked below)
    clips = host.evaluate("""async () => { const all = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; });
      all.sort((a, b) => a.t0 - b.t0); const c = all[0];
      const buf = new Uint8Array(await c.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { n: all.length, native: all.every(k => k.native), orient: c.orient, w: c.w, h: c.h, t0s: all.map(k => k.t0), ends: all.map(k => k.t0 + k.dur), file: btoa(s) }; }""")
    open('/tmp/campro.mp4', 'wb').write(base64.b64decode(clips['file']))
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', '/tmp/campro.mp4'], capture_output=True, text=True).stdout)
    kinds = [x['codec_type'] for x in pr['streams']]
    vid = next(x for x in pr['streams'] if x['codec_type'] == 'video')
    zoomed = [e for e in clips['orient'] if e.get('rect') and 0.45 < e['rect']['w'] < 0.55]
    overlap = round((clips['ends'][0] - clips['t0s'][1]) / 1000, 2)
    assert 'audio' in kinds and 'video' in kinds and clips['native'] and vid['width'] != vid['height'] and zoomed and overlap > 0, (kinds, clips['native'], vid, clips['orient'], overlap)
    step(f"one take became {clips['n']} back-to-back clips at the lens switch (overlap {overlap}s); each is the camera's own {vid['width']}×{vid['height']} picture with sound, and the 2× digital zoom is in the log for the studio")

    vw = cam.evaluate("document.querySelector('#preview').getBoundingClientRect()")
    cam.mouse.click(vw['x'] + vw['width'] * 0.3, vw['y'] + vw['height'] * 0.45)
    cam.wait_for_selector('#focusBox:not([hidden])', timeout=3000)
    step('tap on the picture: focus box appears where you tapped')
    # (note every message shown from here, in case a later one, like a clip being delivered, replaces it)
    cam.evaluate("window.__said = []; new MutationObserver(() => document.querySelectorAll('.toast').forEach(t => __said.push(t.textContent))).observe(document.body, { subtree: true, childList: true, characterData: true })")
    cam.mouse.move(vw['x'] + vw['width'] * 0.6, vw['y'] + vw['height'] * 0.5); cam.mouse.down(); time.sleep(0.9); cam.mouse.up()
    # locking reconfigures the camera, which can take a moment
    cam.wait_for_function("!document.querySelector('#aeLock').hidden || __said.some(t => /lock/i.test(t))", timeout=6000)
    locked = cam.is_visible('#aeLock')
    msgs = cam.evaluate("__said")
    lock_msg = next((m for m in msgs if 'lock' in m.lower()), None)
    assert locked or lock_msg, msgs
    step(f"press and hold: {'AE/AF LOCK shown' if locked else 'explains this browser can’t lock: “' + lock_msg + '”'}")

    assert not cam.query_selector('#fsCam')   # (removed in 0.26: phones go full screen from their own home-screen app)
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
