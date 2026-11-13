# Anything aired makes Edit: a camera on this computer records whenever it's on air (with "Cameras
# record their time on air" on, as it is by default), a clip that aired is placed where it aired, going to Edit finishes the
# recordings in progress (they keep recording) so the edit has everything up to now, and the
# program recording lands in Media as "Program (as aired)" (for shots by hand, not the auto edit).
# Run: node dev/server.mjs &  then  python3 test/e2e_aired.py
import os, subprocess, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
CLIP = '/tmp/vm-aired.webm'
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330', '-t', '6', '-c:v', 'libvpx', '-b:v', '600k', '-c:a', 'libopus', CLIP], check=True)
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'], accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Aired'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '1')")   # ("Cameras record their time on air" on: since 0.67.0 it applies to this computer's cameras too)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=15000)
    host.set_input_files('#clipFiles', CLIP); host.wait_for_selector('.tile.media', timeout=10000); time.sleep(1)

    with host.expect_download(timeout=120000) as dl:
        host.click('#recProgBtn'); time.sleep(1)
        host.click('.tile[data-peer^="local-cam"]'); time.sleep(5)      # camera on air
        host.click('.tile.media'); time.sleep(3.5)                       # the clip airs
        host.click('.tile[data-peer^="local-cam"]'); time.sleep(4)      # back to the camera (still on air)
        ed = edit_window(host.context, host, errors)                                            # straight to Edit, camera still on air
        for _ in range(60):
            prog = ed.evaluate('vmProgram()')
            if any(i['reel'] for i in prog) and sum(1 for i in prog if i['local'] and not i['reel']) >= 2: break
            time.sleep(0.5)
        host.bring_to_front(); time.sleep(0.5)
        host.click('#recProgBtn')
    names = [(i['name'], i['dur']) for i in prog]
    cam_items = [i for i in prog if i['local'] and not i['reel']]
    reel_items = [i for i in prog if i['reel']]
    assert len(cam_items) >= 2 and len(reel_items) == 1 and 2500 < reel_items[0]['dur'] < 5000, prog
    step(f"with the phones' record-on-air setting off, the computer's camera recorded while on air; going to Edit (camera still on air) finished its recording, and the program track has camera / clip / camera: {names}")
    for _ in range(40):
        lst = host.evaluate('vmClipList()')
        if any(c['program'] for c in lst): break
        time.sleep(0.5)
    pg = next(c for c in lst if c['program'])
    host.bring_to_front(); host.keyboard.press('Escape'); time.sleep(0.3)   # (the end-of-recording summary)
    ed = edit_window(host.context, host, errors); time.sleep(1.5)
    prog2 = ed.evaluate('vmProgram()')
    assert pg['dur'] > 10000 and not any(i['program'] for i in prog2), (pg, prog2)
    step(f"Record program ended: \"{pg['name']}\" ({pg['dur'] / 1000:.0f} s) is in Media for shots by hand, and stays out of the automatic edit")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
