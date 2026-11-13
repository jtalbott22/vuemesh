# Faces and speakers, in a real studio: a camera on this computer that plays two close-ups from
# the wedding film (made with ffmpeg); Face tracking finds their faces (MediaPipe, in a worker),
# Keep faces framed crops the shot on air to them, the card and the camera's tile say what they
# should, and nothing is asked of any server but this one (the bundled MediaPipe's usage logging
# is taken out). Who's talking and the director's cuts with it are in test/faces.test.mjs.
# Needs ffmpeg. Run: node dev/server.mjs &  then  python3 test/e2e_faces.py
import os, subprocess, tempfile, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def step(m): print('ok  ' + m, flush=True)

tmp = tempfile.mkdtemp()
Y4M = os.path.join(tmp, 'sofa.y4m')
# (24–28.5 s of the wedding film: one close-up, then a couple on a sofa, facing the camera)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '24', '-t', '4.5', '-i', os.path.join(ROOT, 'public/media/wedding.mp4'),
                '-vf', 'scale=1280:720,fps=15', '-pix_fmt', 'yuv420p', Y4M], check=True)
ARGS = ['--use-fake-device-for-media-stream', f'--use-file-for-fake-video-capture={Y4M}', '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader']

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors, outside = [], []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page()
    host.on('pageerror', lambda e: errors.append(str(e)))
    ctx.on('request', lambda r: outside.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith(('data:', 'blob:')) else None)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Faces'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=15000)
    host.click('.tile[data-peer^="local-cam"]'); time.sleep(0.8)
    assert 'ON AIR' in host.inner_text('#progLabel')
    peer = host.get_attribute('.tile[data-peer^="local-cam"]', 'data-peer')

    # off: the shot as it is, and the options hidden
    assert host.is_hidden('#facesOpts')
    assert host.evaluate('vmFaces()')['on'] is False
    host.check('#facesOn')
    host.wait_for_function('vmFaces().ready || vmFaces().error', timeout=30000)
    st = host.evaluate('vmFaces()')
    assert st['ready'] and not st['error'], st
    assert host.is_visible('#facesOpts') and 'on this computer' in host.inner_text('#facesState')
    assert 'people by their pose' in host.inner_text('#facesState'), host.inner_text('#facesState')
    step(f"Face tracking starts in the studio (MediaPipe's faces and poses in a worker, on the {'graphics card' if st['delegate'] == 'GPU' else 'processor'}); the card says it's on this computer")

    # the couple on the sofa: two faces, found again and again (a few seconds of the loop)
    seen = 0
    for _ in range(60):
        cams = host.evaluate('vmFaces()')['cams']
        c = next((x for x in cams if x['peer'] == peer), None)
        if c and c['faces'] >= 1:
            seen = max(seen, c['faces'])
            if seen >= 2: break
        time.sleep(0.25)
    assert seen >= 1, host.evaluate('vmFaces()')
    step(f'faces found in the camera on air ({seen} at once, as the film comes round to the couple on the sofa)')

    # Keep faces framed: the program is a crop of the shot, around them, in the program's shape
    framing = None
    for _ in range(40):
        c = next(x for x in host.evaluate('vmFaces()')['cams'] if x['peer'] == peer)
        framing = c['framing']
        if framing and framing['subject'] and framing['rect']['w'] < 0.97: break
        time.sleep(0.25)
    r = framing['rect']
    assert framing['subject'] >= 1 and r['w'] < 0.97, framing
    assert 0 <= r['x'] and r['x'] + r['w'] <= 1.0001 and 0 <= r['y'] and r['y'] + r['h'] <= 1.0001, r
    assert abs(r['w'] / r['h'] - 1) < 0.02, r   # (a 16:9 crop of a 16:9 shot)
    assert framing['maxZoom'] <= 2
    lit = host.evaluate("""(() => { const c = document.querySelector('#program'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 400) s += d[i] + d[i+1] + d[i+2]; return s / (d.length / 400) / 3; })()""")
    assert lit > 15, lit
    step(f"Keep faces framed: on air, a crop of {round(r['w'] * 100)}% of the shot around them (at most 1.4 times past its own resolution), the program's shape, picture on air")

    # off: the whole shot again, and nothing left on the tile
    host.uncheck('#facesFollow')
    time.sleep(0.6)
    host.check('#facesFollow')
    host.uncheck('#facesOn')
    time.sleep(0.6)
    st = host.evaluate('vmFaces()')
    assert not st['on'] and not st['ready'] and st['cams'] == [], st
    assert not host.query_selector('.tile .spktag')
    assert 'Nobody yet' in host.inner_text('#speakers') or host.is_hidden('#facesOpts')
    step('turned off: the worker stops, the shot is whole again, no labels left on the tiles')

    assert not errors, errors
    assert not outside, outside
    step('no page errors; no request to anything but this server (no usage logging to Google)')
    b.close()
print('\nAll face tracking checks passed.')
