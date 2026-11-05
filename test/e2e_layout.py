# The studio's two rooms and the new tools: Live (no timeline, audio dock, bus), Program
# out in its own window, resizable panels that remember, and clip transforms (handles on
# the viewer, exact values in the inspector, and in the rendered file).
# Run: node dev/server.mjs &  then  python3 test/e2e_layout.py   (needs ffmpeg)
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
from PIL import Image
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SEQ = "JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')))"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Layout'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1.5)
    shown = lambda sel: host.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return !!e && getComputedStyle(e).display !== 'none'; }})()")   # (absent counts as not shown: each page has only its own markup)
    assert not shown('#timeline') and shown('.dock') and host.locator('#bus').count() == 0
    pw = host.evaluate("document.querySelector('#program').getBoundingClientRect().width")
    step(f'Live: no timeline; program is the hero ({pw:.0f}px wide), no cut buttons beneath it, audio mixer dock below')

    with ctx.expect_page() as pop:
        host.click('#progOutBtn')
    out = pop.value
    out.wait_for_function("(() => { const v = document.querySelector('#out'); return v.srcObject && v.readyState >= 2 && v.videoWidth > 0; })()", timeout=10000)
    info = out.evaluate("(() => { const v = document.querySelector('#out'); return [v.videoWidth, v.videoHeight, v.srcObject.getAudioTracks().length]; })()")
    assert info[2] == 1, info
    step(f'Program out: a separate window plays the program ({info[0]}×{info[1]}) with its sound, straight from this tab')
    out.close()

    sl = host.locator('#splitL').bounding_box()
    host.mouse.move(sl['x'] + 3, sl['y'] + 200); host.mouse.down(); host.mouse.move(sl['x'] + 123, sl['y'] + 200, steps=6); host.mouse.up()
    w1 = host.evaluate("document.querySelector('.sources').getBoundingClientRect().width")
    host.reload(); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000); time.sleep(1)
    w2 = host.evaluate("document.querySelector('.sources').getBoundingClientRect().width")
    assert abs(w1 - w2) < 2 and w1 > 400, (w1, w2)
    step(f'dragged the divider: sources panel {w1:.0f}px wide, still {w2:.0f}px after a reload')

    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(1); host.keyboard.press('1'); time.sleep(3.5)
    cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=30000); time.sleep(2)
    ed = edit_window(host.context, host, errors); time.sleep(0.8)
    eshown = lambda sel: ed.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return !!e && getComputedStyle(e).display !== 'none'; }})()")   # (in the Edit window)
    assert eshown('#timeline') and not eshown('.dock')
    ed.keyboard.press('Home'); time.sleep(0.3)
    ed.locator('[data-lane="t-prog"] .item').first.click(); time.sleep(0.5)
    # the live cut can land a moment after the recording began, so the clip may start just
    # after zero: with the playhead outside it, the inspector says why there are no handles
    hint = ed.evaluate("!document.querySelector('#tfHint').hidden && document.querySelector('#xform').hidden")
    # onto the clip: if it starts after zero, the next edit point is its start; if it starts at zero, we're already there
    st = ed.evaluate(SEQ + ".tracks.find(t => t.program).items[0].start")
    if st > 1: ed.keyboard.press('ArrowDown')
    ed.keyboard.press('ArrowRight'); ed.keyboard.press('ArrowRight'); time.sleep(0.4)
    step(f'selected the clip; with the playhead before it the inspector explains the missing handles ({hint}); stepped onto it')
    # the handles appear once the editor has loaded the clip enough to know its size (a native
    # 1080p file takes a moment to open in this container, which has no video hardware)
    ed.wait_for_selector('#xform:not([hidden])', timeout=15000)
    xb = ed.locator('#xform').bounding_box()
    ed.mouse.move(xb['x'] + xb['width'] / 2, xb['y'] + xb['height'] / 2); ed.mouse.down()
    ed.mouse.move(xb['x'] + xb['width'] / 2 - 120, xb['y'] + xb['height'] / 2 + 40, steps=8); ed.mouse.up(); time.sleep(0.3)
    tf = ed.evaluate(SEQ + ".tracks.find(t => t.program).items[0].tf")
    assert tf and tf['x'] < 0.45 and tf['y'] > 0.52, tf
    xb = ed.locator('#xform').bounding_box()
    ne = ed.locator('#xform .ne').bounding_box()   # the top-right corner is still on screen after the move
    ed.mouse.move(ne['x'] + ne['width'] / 2, ne['y'] + ne['height'] / 2); ed.mouse.down()
    ed.mouse.move(ne['x'] - xb['width'] * 0.25, ne['y'] + xb['height'] * 0.25, steps=8); ed.mouse.up(); time.sleep(0.3)
    tf2 = ed.evaluate(SEQ + ".tracks.find(t => t.program).items[0].tf")
    assert tf2['s'] < 0.9, tf2
    step(f"viewer handles: dragged the clip (x {tf['x']:.2f}, y {tf['y']:.2f}) and its corner (scale {tf2['s']:.2f})")

    ed.click('#tfReset'); time.sleep(0.3)
    for fid, val in [('#tfS', '50'), ('#tfR', '30'), ('#tfCl', '20')]:
        ed.fill(fid, val); ed.dispatch_event(fid, 'input'); ed.dispatch_event(fid, 'change')
    time.sleep(0.3)
    tf3 = ed.evaluate(SEQ + ".tracks.find(t => t.program).items[0].tf")
    assert abs(tf3['s'] - 0.5) < 0.01 and abs(tf3['r'] - 30) < 0.01 and abs(tf3['crop']['l'] - 0.2) < 0.01, tf3
    step('inspector: scale 50%, rotate 30°, crop left 20% set exactly')
    with ed.expect_download(timeout=120000) as dl:
        ed.click('#renderBtn')
    dl.value.save_as('/tmp/layout-render.mp4')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '1.5', '-i', '/tmp/layout-render.mp4', '-frames:v', '1', '/tmp/layout-frame.png'], check=True)
    im = Image.open('/tmp/layout-frame.png').convert('L'); w, h = im.size
    corners = [im.getpixel((5, 5)), im.getpixel((w - 6, 5)), im.getpixel((5, h - 6)), im.getpixel((w - 6, h - 6))]
    centre = im.getpixel((w // 2, h // 2))
    assert max(corners) < 20 and centre > 40, (corners, centre)
    step(f'rendered MP4 carries the transform: corners black {corners}, picture in the middle ({centre})')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
