# End-to-end: host laptop + guest phone in headless Chromium with a fake camera,
# talking through the local dev server (same core code as the Lambdas).
# Run: node dev/server.mjs &  then  python3 test/e2e.py
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)

BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(msg): print('ok  ' + msg, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('console', lambda m: m.type == 'error' and 'status of 403' not in m.text and errors.append(f'{tag} console: {m.text}'))
        page.on('dialog', lambda d: d.accept())

    host_ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = host_ctx.new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'E2E show', kind:'show', poolPct:20})})).json()""")
    step(f"event {ev['id']} created")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    step('studio connected to signaling as host')

    cam_ctx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'])
    cam = cam_ctx.new_page(); watch(cam, 'cam')
    cam.goto(f"{BASE}/cam?e={ev['id']}")
    cam.fill('#name', 'Rosa')
    cam.check('#agreeGuest')
    cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('#camView.on', timeout=10000)
    cam.wait_for_function("document.querySelector('#upPill').textContent.includes('Connected to host')", timeout=20000)
    step('phone found the host: ' + cam.inner_text('#upPill'))

    host.wait_for_selector('.tile[data-peer] video', timeout=15000)
    host.wait_for_function("document.querySelector('.tile[data-peer] video').readyState >= 2", timeout=15000)
    step(f"live preview arrived (route: {host.inner_text('.tile[data-peer] .route')})")

    cam.click('#shutter'); time.sleep(1.2)
    host.keyboard.press('1'); time.sleep(3.8)
    cam.click('#shutter')
    cam.wait_for_function("document.querySelector('.toast') && document.querySelector('.toast').textContent.includes('delivered')", timeout=30000)
    # (no pop-up in the studio since 0.22: it's in the Monitor, and the Monitor button lights up)
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=15000)
    assert not any('arrived' in t for t in host.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)'))
    step('clip delivered peer-to-peer and verified on the host')

    ed = edit_window(host.context, host, errors); time.sleep(0.8)
    n = ed.eval_on_selector_all('[data-lane="t-prog"] .item', 'els => els.length')
    assert n >= 1, n
    step(f'edit: the live cut became {n} Program item(s) on the timeline')
    step('credits: ' + ' '.join(ed.inner_text('#credits').split()))

    # add a lower third and a slate, then render a real file
    ed.click('#tracks [data-ruler]', position={'x': 5, 'y': 5})
    ed.keyboard.press('t'); time.sleep(0.3)
    assert ed.eval_on_selector_all('.item', 'els => els.filter(e => e.textContent.includes("Title")).length') >= 1
    step('T added a lower third on an overlay track')
    with ed.expect_download(timeout=60000) as dl:
        ed.click('#renderBtn')
    path = '/tmp/e2e-render.mp4'
    dl.value.save_as(path)
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', path], capture_output=True, text=True).stdout)
    kinds = {s['codec_type']: s for s in probe['streams']}
    dur = float(probe['format']['duration'])
    assert 'video' in kinds and dur > 3, probe
    step(f"Render MP4 → {kinds['video']['codec_name']} {kinds['video']['width']}x{kinds['video']['height']}, {kinds.get('audio', {}).get('codec_name', 'no audio')}, {dur:.2f}s")
    ed.wait_for_selector('#wrap[open]', timeout=5000)
    step('wrap dialog shown after render (Patreon ask)')
    ed.click('#wrap [data-close]')

    w = b.new_page(); watch(w, 'watch')
    w.goto(f"{BASE}/watch?e={ev['id']}")
    w.wait_for_function("document.querySelector('#waiting') && !document.querySelector('#waiting').hidden", timeout=10000)
    step('watch page (publishing off in beta): ' + w.inner_text('#waiting'))

    beacon = b.new_page(); watch(beacon, 'beacon')
    beacon.goto(f"{BASE}/beacon?e={ev['id']}")
    beacon.wait_for_function("document.querySelector('#nCams').textContent === '1'", timeout=10000)
    step('beacon shows 1 phone in')

    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
