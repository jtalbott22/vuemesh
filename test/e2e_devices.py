# Different devices behind the camera: an Android phone with several back cameras (where
# only one camera can run at a time), a computer webcam (no gyro, can't be turned), the
# camera screen's top notices not covering each other, and the studio's meters lighting up.
# Run: node dev/server.mjs &  then  python3 test/e2e_devices.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream=device-count=3', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
ONE_CAMERA_AT_A_TIME = """(() => {
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const live = new Set(); window.__refused = 0;
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.video && [...live].some((t) => t.readyState === 'live')) { window.__refused++; throw new DOMException('Could not start video source', 'NotReadableError'); }
    const s = await orig(c); s.getVideoTracks().forEach((t) => live.add(t)); return s;
  };
})()"""
def step(m): print('ok  ' + m, flush=True)
def overlap(a, b): return not (a['x'] + a['width'] <= b['x'] or b['x'] + b['width'] <= a['x'] or a['y'] + a['height'] <= b['y'] or b['y'] + b['height'] <= a['y'])

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Devices', orientation: 'portrait'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)

    # --- Android phone, several back cameras, one at a time
    android = b.new_context(viewport={'width': 412, 'height': 915}, user_agent=ANDROID, permissions=['camera', 'microphone'], has_touch=True).new_page()
    android.on('pageerror', lambda e: errors.append(f'android: {e}'))
    android.add_init_script(ONE_CAMERA_AT_A_TIME)
    android.goto(f"{BASE}/cam?e={ev['id']}"); android.fill('#name', 'Pixel'); android.check('#agreeGuest'); android.click('#joinForm button[type=submit]')
    android.wait_for_selector('#camView.on', timeout=15000); time.sleep(1.5)
    before = android.evaluate("document.querySelector('#preview').srcObject.getVideoTracks()[0].label")
    chips = android.eval_on_selector_all('#lenses button', 'e => e.map(x => x.textContent)')
    android.click('#lenses button >> nth=1'); time.sleep(1.5)
    after = android.evaluate("document.querySelector('#preview').srcObject.getVideoTracks()[0].label")
    refused = android.evaluate('window.__refused')
    playing = android.evaluate("(() => { const v = document.querySelector('#preview'); return v.readyState >= 2 && !v.paused; })()")
    assert after != before and refused >= 1 and playing, (before, after, refused, playing)
    step(f'Android: lens chips {chips}; tapping the second switched {before} → {after}, even though the phone refused a second camera ({refused}×)')
    android.click('#lenses button >> nth=2'); time.sleep(1.5)
    third = android.evaluate("document.querySelector('#preview').srcObject.getVideoTracks()[0].label")
    assert third not in (before, after), third
    step(f'…and on to the third ({third})')
    android.wait_for_function("document.querySelector('#hint') && !document.querySelector('#hint').hidden", timeout=8000)
    step(f'a phone held the wrong way for a portrait film is still coached: "{android.inner_text("#hint")}"')

    # --- a computer as a camera
    pc = b.new_context(viewport={'width': 1280, 'height': 800}, permissions=['camera', 'microphone']).new_page()
    pc.on('pageerror', lambda e: errors.append(f'pc: {e}'))
    pc.goto(f"{BASE}/cam?e={ev['id']}"); pc.fill('#name', 'Laptop'); pc.check('#agreeGuest'); pc.click('#joinForm button[type=submit]')
    pc.wait_for_selector('#camView.on', timeout=15000)
    pc.wait_for_selector('#dm:not([hidden])', timeout=8000)
    note = pc.inner_text('#dmText')
    time.sleep(2.5)
    hint = pc.evaluate("document.querySelector('#hint').hidden ? '' : document.querySelector('#hint').textContent")
    assert 'computer' in note and 'upright' not in hint.lower() and 'phone' not in hint.lower(), (note, hint)
    pc.click('#setBtn'); level_hidden = pc.evaluate("document.querySelector('#tgLevel').closest('label').hidden"); pc.click('#csClose')
    assert level_hidden
    step(f'computer: no "hold your phone upright"; one plain note instead: "{note}"; no level overlay (no gyro)')
    host.wait_for_function("[...document.querySelectorAll('.tile[data-peer]')].some(t => t.querySelector('.who').textContent === 'Laptop' && t.querySelector('.pctag'))", timeout=10000)
    step('the studio marks it with a PC badge (the director scores it as a fixed camera)')

    # --- top notices stack, never overlap
    host.click('.tile[data-peer]:has-text("Pixel")'); time.sleep(0.4)
    host.fill('#rundownText', 'Entrance\nToasts'); host.click('#rundownSend'); time.sleep(0.3); host.click('#cueNext')
    android.wait_for_selector('#tally:not([hidden])', timeout=6000); android.wait_for_selector('#cue:not([hidden])', timeout=6000)
    t, c = android.locator('#tally').bounding_box(), android.locator('#cue').bounding_box()
    assert not overlap(t, c), (t, c)
    step(f'on air with a rundown: ON AIR (y {t["y"]:.0f}–{t["y"] + t["height"]:.0f}) sits above the rundown line (y {c["y"]:.0f}), not over it')

    # --- the studio's meters actually light up
    from PIL import Image
    # The test microphone is a short beep once a second with silence between, so keep looking
    # (a real microphone is never that quiet).
    # (read the meter's level many times a second: a screenshot each time was too slow to catch a beep)
    lvl = 0.0
    t_end = time.time() + 8
    while time.time() < t_end and lvl <= 20:
        lvl = max(lvl, host.evaluate("Math.max(0, ...[...document.querySelectorAll('#bridge .vstrip.master .fill')].map(f => parseFloat(f.style.getPropertyValue('--lvl')) || 0))"))
        time.sleep(0.05)
    assert lvl > 20, lvl
    box = host.locator('#bridge .vstrip.master .vmeter').first.bounding_box()
    assert box and box['width'] > 40, box
    step(f'mixer meters draw: the Program meter reached {lvl:.0f}% on the test microphone\'s beeps ({box["width"]:.0f} px wide meter)')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
