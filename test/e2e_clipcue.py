# Clips through the switcher: with Tap: Preview, clicking a clip cues it in preview, paused
# at its first frame (it stays there); AUTO starts it playing as the dissolve begins and it's
# on air when the dissolve ends (the camera goes to preview); CUT back to the camera puts
# the clip back in preview, cued at the start again; CUT to the clip starts it from the top.
# Run: node dev/server.mjs &  then  python3 test/e2e_clipcue.py   (makes a test clip with ffmpeg)
import os, subprocess, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
CLIP = '/tmp/vm-promo.webm'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '8', '-c:v', 'libvpx', '-b:v', '800k', '-c:a', 'libopus', CLIP], check=True)
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Clip cue'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.click('.tile[data-peer]'); time.sleep(0.5)
    host.set_input_files('#clipFiles', CLIP); host.wait_for_selector('.tile.media', timeout=10000); time.sleep(1)
    host.click('#swTgl'); host.click('#switcher [data-tap="preview"]')
    host.click('.tile.media'); time.sleep(2.5)
    sw = host.evaluate('vmSwitcher()'); c = host.evaluate('vmClips()')[0]
    assert sw['pvwClip'] == c['id'] and c['paused'] and c['t'] == 0 and host.is_visible('#pvwFrame') and 'cued' in host.inner_text('#pvwLabel'), (sw, c)
    assert 'pvw' in host.get_attribute('.tile.media', 'class') and 'Rosa' in host.inner_text('#progLabel')
    step(f"Tap: Preview, click the clip: it's in preview (\"{host.inner_text('#pvwLabel')}\"), paused at {c['t']} s, and it stays there; Rosa stays on air")

    host.select_option('#swDur', '2'); host.click('#swAuto')
    host.wait_for_function("vmSwitcher().mediaOn !== null", timeout=15000)
    sw = host.evaluate('vmSwitcher()'); c = host.evaluate('vmClips()')[0]
    assert sw['mediaOn'] == c['id'] and not c['paused'] and c['t'] >= 1.0 and sw['pvw'] and c['volume'] == 1, (sw, c)
    step(f"AUTO: the clip started as the dissolve began and is on air, already {c['t']} s in (it played through the {sw['lastTook'] / 1000:.1f} s dissolve); Rosa went to preview")

    time.sleep(0.5); host.click('#swCut'); time.sleep(0.8)
    sw = host.evaluate('vmSwitcher()'); c = host.evaluate('vmClips()')[0]
    assert sw['mediaOn'] is None and 'Rosa' in host.inner_text('#progLabel') and sw['pvwClip'] == c['id'] and c['paused'] and c['t'] == 0, (sw, c)
    step(f"CUT back to Rosa: the clip went back to preview, cued at {c['t']} s and paused")

    time.sleep(1.5); host.click('#swCut'); time.sleep(1.0)
    sw = host.evaluate('vmSwitcher()'); c = host.evaluate('vmClips()')[0]
    assert sw['mediaOn'] == c['id'] and not c['paused'] and 0.3 < c['t'] < 2.5, (sw, c)
    step(f"CUT to the clip: on air from the top ({c['t']} s in a moment later)")

    host.click('#switcher [data-tap="air"]'); time.sleep(0.3)
    host.click('.tile[data-peer]'); time.sleep(0.5); host.click('.tile.media'); time.sleep(0.8)
    sw = host.evaluate('vmSwitcher()')
    assert sw['mediaOn'] is not None and sw['pvwClip'] is None
    step('Tap: Air: clicking the clip puts it straight on air, as before')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
