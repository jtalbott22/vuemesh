# Full screen control room: the source tiles, the vertical meter bridge, and pictures
# and sound switched independently (AFV / ON / OFF per phone, Shift+number breakaway).
# Run: node dev/server.mjs &  then  python3 test/e2e_controlroom.py
import os, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 900}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Control room'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page()
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000)
    time.sleep(1.5)
    host.keyboard.press('f'); time.sleep(0.6)
    assert host.evaluate("document.body.classList.contains('fs')") and host.is_visible('#bridge')
    strips = host.eval_on_selector_all('#bridge .vstrip', "e => e.map(x => [x.querySelector('.vname').textContent, x.querySelectorAll('.vmeter').length])")
    buses = host.eval_on_selector_all('.tile[data-peer]', 'e => e.map(x => x.querySelector(".n").textContent + " " + x.querySelector(".who").textContent)')
    assert len(strips) == 3 and strips[-1] == ['Program', 2] and len(buses) == 2, (strips, buses)
    step(f'F: full screen control room — source tiles {buses}, meter bridge {strips} (Program is stereo)')

    is_open = lambda n: host.evaluate(f"document.querySelectorAll('#bridge .vstrip')[{n}].classList.contains('open')")
    host.click('.tile[data-peer] >> nth=0'); time.sleep(0.6)
    assert is_open(0) and not is_open(1), (is_open(0), is_open(1))
    host.click('.tile[data-peer] >> nth=1'); time.sleep(0.6)
    assert not is_open(0) and is_open(1)
    step('AFV: cutting from the source tiles opens only the on-air camera\'s sound (and moves it when you cut)')
    host.wait_for_function("parseFloat(document.querySelector('#bridge .vstrip.master .fill[data-ch=\"0\"]').style.getPropertyValue('--lvl')) > 10", timeout=10000)
    step('Program meters move with the on-air sound (left and right)')

    host.click('#bridge .vstrip >> nth=0 >> [data-amode="on"]'); time.sleep(0.4)
    assert is_open(0) and is_open(1)
    step('breakaway: camera 1 set to ON stays in the mix while camera 2 has the picture')
    host.keyboard.press('Shift+1'); time.sleep(0.4)
    m1 = host.evaluate("document.querySelector('#bridge .vstrip [data-amode][aria-pressed=true]').dataset.amode")
    assert m1 == 'off' and not is_open(0), m1
    host.keyboard.press('Shift+1'); time.sleep(0.3)
    m1b = host.evaluate("document.querySelector('#bridge .vstrip [data-amode][aria-pressed=true]').dataset.amode")
    aud = host.eval_on_selector_all('.tile[data-peer] .aud', 'e => e.map(x => x.textContent)')
    assert m1b == 'afv', m1b
    step(f'Shift+1 steps camera 1 sound ON → OFF → AFV; each tile shows its camera\'s sound mode {aud}')
    fader = host.locator('#bridge .vstrip >> nth=1 >> .vfader')
    box = fader.bounding_box()
    # (the dock fits its strips, so it's one row per phone with the fader lying flat; drag its edge taller for upright faders)
    assert box['width'] > box['height'] * 3, box
    step(f'faders lie flat in the fitted mixer ({box["width"]:.0f}×{box["height"]:.0f}px), meters have peak hold and clip lights')
    host.screenshot(path='/tmp/v07-controlroom.png')

    ed = edit_window(host.context, host, errors); time.sleep(0.8)   # (` opens Edit: its own window)
    estrips = ed.eval_on_selector_all('#mixer .strip .nm', 'e => e.map(x => x.textContent)')
    assert estrips[-1] == 'Master' and ed.is_visible('#mixer') and host.is_visible('#bridge'), estrips
    step(f'Edit (its own window): the inspector mixer shows the audio tracks {estrips}; the studio keeps its Live mixer')
    host.bring_to_front()
    # (opening a pop-up takes the browser out of full screen, and the studio's layout follows; else F does it)
    was_fs = host.evaluate("document.body.classList.contains('fs')")
    if was_fs:
        host.keyboard.press('f'); time.sleep(0.4)
    assert not host.evaluate("document.body.classList.contains('fs')")
    step('F leaves full screen' if was_fs else 'opening the Edit window took the studio out of full screen (as browsers do for a pop-up), and its layout followed')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
