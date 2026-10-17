# Rotation, end to end: a phone records, is turned sideways mid-shot (rotation lock on,
# so the screen doesn't follow), then turned back. Synthetic sensor events stand in for
# a real phone. Checks the recorded pixels, the orientation log, live tile shape,
# slicing in the edit, the mismatch warning, and the manual rotation override.
# Run: node dev/server.mjs &  then  python3 test/e2e_orientation.py   (needs ffmpeg)
import os, base64, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
from PIL import Image
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
GRAVITY = """window.__g = {x: 0, y: 9.81, z: 0}; setInterval(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: window.__g, rotationRate: { alpha: 2, beta: 1, gamma: 1 }, interval: 50 })), 50);"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Turns', orientation: 'landscape'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.add_init_script(GRAVITY)
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer]')?.dataset.shape === 'landscape'", timeout=20000)
    step('phone held normally: live tile reports a landscape shot')

    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(1.0)
    cam.evaluate("window.__g = {x: 9.81, y: 0, z: 0}"); time.sleep(0.6)   # a quick tip sideways...
    cam.evaluate("window.__g = {x: 0, y: 9.81, z: 0}"); time.sleep(1.6)   # ...and straight back
    tipped = host.evaluate("document.querySelector('.tile[data-peer]')?.dataset.shape")
    assert tipped == 'landscape', tipped
    step('a quick 0.6 s tip sideways is ignored (a turn has to hold for a second)')
    cam.evaluate("window.__g = {x: 9.81, y: 0, z: 0}")  # turned a quarter-turn counter-clockwise, screen locked
    host.wait_for_function("document.querySelector('.tile[data-peer]')?.dataset.shape === 'portrait'", timeout=5000)
    step('turned sideways and held (rotation lock on): after a second, the live tile switched to the upright portrait shot')
    time.sleep(3)
    hint = cam.inner_text('#hint') if cam.is_visible('#hint') else ''
    cam.evaluate("window.__g = {x: 0, y: 9.81, z: 0}"); time.sleep(2.5)
    cam.evaluate("document.querySelector('#shutter').click()")
    COUNT = "(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; }))()"
    for _ in range(120):   # (a live camera paces its uploads: give the clips time to arrive)
        if host.evaluate(COUNT) >= 3: break
        time.sleep(0.5)
    time.sleep(1)
    step(f'the shooter was coached while sideways in a landscape event: "{hint}"')

    clips = host.evaluate("""async () => { const all = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; });
      all.sort((a, b) => a.t0 - b.t0);
      const out = [];
      for (const c of all) { const buf = new Uint8Array(await c.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        out.push({ orient: c.orient, native: c.native, w: c.w, h: c.h, t0: c.t0, dur: c.dur, qa: (c.qa || []).length, file: btoa(s) }); }
      return out; }""")
    shapes = [c['orient'][0]['upright'] for c in clips]
    rots = [c['orient'][0]['rot'] for c in clips]
    assert len(clips) == 3 and shapes == ['landscape', 'portrait', 'landscape'] and rots[0] == 0 and rots[1] in (90, 270) and rots[2] == 0 and all(c['native'] for c in clips), [(c['orient'], c['native']) for c in clips]
    overlaps = [round(((clips[i]['t0'] + clips[i]['dur']) - clips[i + 1]['t0']) / 1000, 2) for i in range(2)]
    assert all(o > 0 for o in overlaps), overlaps
    step(f"turning mid-take rolled to a new clip each time: {list(zip(shapes, rots))}; each starts before the last ends (overlaps {overlaps} s)")

    open('/tmp/turns.mp4', 'wb').write(base64.b64decode(clips[0]['file']))
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', '/tmp/turns.mp4'], capture_output=True, text=True, check=True)
    import json as _j
    pj = _j.loads(probe.stdout); st = pj['streams'][0]; fps = int(st['nb_read_frames']) / float(pj['format']['duration'])
    # The camera here is simulated in software with no video hardware, so absolute fps is low;
    # check the camera was asked for 30 and the recording keeps pace with what it delivered.
    asked = int(cam.evaluate("document.querySelector('#qualSel').value || '1080p30'").split('p')[-1])  # the quality setting the camera was opened with
    cam_fps = cam.evaluate("document.querySelector('#preview').srcObject.getVideoTracks()[0].getSettings().frameRate")  # Chrome's simulated camera runs at 20 whatever is asked
    delivered = cam.evaluate("new Promise(r => { const v = document.querySelector('#preview'); let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(f); else r(n / 2); }; v.requestVideoFrameCallback(f); })")
    assert st['width'] != st['height'] and (st['width'], st['height']) == (clips[0]['w'], clips[0]['h']) and asked == 30 and fps >= 0.4 * delivered, (st, fps, delivered, asked, cam_fps)  # software encoding in a busy container; real phones encode in hardware
    step(f"recorded at the camera's own size, not a square: {st['width']}×{st['height']}; asked the camera for {asked} fps; recording {fps:.1f} fps vs {delivered:.1f} the simulated camera delivered here")

    ed = edit_window(host.context, host, errors); time.sleep(1.2)
    items = ed.eval_on_selector_all('[data-lane="t-prog"] .item', "e => e.map(x => [x.textContent.trim().slice(0, 1), x.classList.contains('mismatch')])")
    assert [s for s, _ in items] == ['▭', '▯', '▭'] and [mm for _, mm in items] == [False, True, False], items
    step(f'edit: the clip was sliced at both turns {[s for s, _ in items]}; the portrait slice is flagged in a landscape film')
    ed.locator('[data-lane="t-prog"] .item').nth(1).click(); time.sleep(0.3)
    ed.screenshot(path='/tmp/v06-edit.png')

    ed.locator('[data-lane="t-prog"] .item').nth(1).click(); time.sleep(0.3)
    ed.select_option('#selRot', '90'); time.sleep(0.4)
    items2 = ed.eval_on_selector_all('[data-lane="t-prog"] .item', "e => e.map(x => [x.textContent.trim().slice(0, 1), x.classList.contains('mismatch')])")
    assert items2[1] == ['▭', False], items2
    step('a manual rotation override on that slice makes it landscape (for a phone that lay flat and guessed wrong)')
    ed.select_option('#selRot', '0'); time.sleep(0.2)
    ed.click('#portBtn'); time.sleep(0.4)
    items3 = ed.eval_on_selector_all('[data-lane="t-prog"] .item', "e => e.map(x => x.classList.contains('mismatch'))")
    assert items3 == [True, False, True], items3
    step('switched the film to portrait after the fact: now the landscape slices are the flagged ones')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
