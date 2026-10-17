# Black means nothing's on air, so nothing records: this computer's camera, on air, stops
# recording once the program has faded to black (5 s on), going to Edit doesn't start it again,
# and the fade is in Edit (its shot fades out to black). Fading up starts it again, and that
# shot fades in.
# Run: node dev/server.mjs &  then  python3 test/e2e_blackrec.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())   # ("Leave site?" while recording: yes)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Black'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=30000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="cam"]', timeout=15000)
    host.select_option('#localList [data-snd] >> nth=0', '')
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=15000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=20000)
    key = lambda k: (host.evaluate('document.activeElement && document.activeElement.blur()'), host.keyboard.press(k))
    vids = lambda: host.evaluate("vmClipList().filter(c => c.kind === 'video' && c.local && !c.reel && !c.program).length")
    recording = lambda: host.evaluate("vmLocal()[0].rec")

    host.evaluate("document.querySelector('.tile[data-peer^=\"local-cam\"]').click()"); time.sleep(6)
    assert recording()
    key('x')   # fade to black
    for _ in range(40):
        if not recording(): break
        time.sleep(0.5)
    assert not recording()
    for _ in range(30):
        if vids() >= 1: break
        time.sleep(0.5)
    n_black = vids(); time.sleep(6)
    assert vids() == n_black and not recording(), (n_black, vids())
    step(f'faded to black: the camera stopped recording (5 s on) and stayed stopped ({n_black} recording, nothing more)')

    ed = edit_window(host.context, host, errors); time.sleep(4)
    assert vids() == n_black and not recording(), (n_black, vids())
    prog = ed.evaluate("vmProgram()")
    cam = [i for i in prog if i['type'] == 'clip']
    assert cam and cam[-1]['fadeOut'] > 0, prog
    step(f'going to Edit didn\'t start it again; in Edit its shot fades out to black ({cam[-1]["fadeOut"]} ms)')

    host.bring_to_front(); time.sleep(0.5)
    key('x'); time.sleep(1.5)   # fade up
    assert recording()
    time.sleep(5)
    ed = edit_window(host.context, host, errors)
    for _ in range(40):
        prog = ed.evaluate("vmProgram()")
        cam = [i for i in prog if i['type'] == 'clip']
        if len(cam) >= 2 and cam[-1]['fadeIn'] > 0: break
        time.sleep(0.5)
    assert len(cam) >= 2 and cam[-1]['fadeIn'] > 0, prog
    step(f'fading up started it again, and that shot fades in ({cam[-1]["fadeIn"]} ms): {[(i["start"], i["dur"], i["fadeIn"], i["fadeOut"]) for i in cam]}')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
