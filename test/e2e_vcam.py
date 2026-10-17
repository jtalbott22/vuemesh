# The program as a camera for video calls: "Zoom, Teams or Meet (as a camera)" in Stream out
# sends the program through the relay to a camera on this computer. Here (Linux without a
# loopback camera) that's the Mac/Windows way: MPEG-TS over local UDP, for OBS's Media Source
# and Virtual Camera. A stand-in for OBS (ffmpeg) receives it: H.264 picture and AAC sound.
# The set-up steps show for this kind of computer.
# Run: node dev/server.mjs &  then  python3 test/e2e_vcam.py   (needs ffmpeg)
import os, time, json, subprocess
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
HERE = os.path.dirname(os.path.abspath(__file__))
RELAY = os.path.join(HERE, '..', 'public', 'relay', 'vuemesh-relay.mjs')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
OUT = '/tmp/vcam.ts'
def step(m): print('ok  ' + m, flush=True)
relay = subprocess.Popen(['node', RELAY, '--port', '8937'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env={**os.environ, 'VUEMESH_VCAM_PORT': '19998'})
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        errors = []
        host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
        host.goto(BASE + '/')
        ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Call'})})).json()""")
        host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
        host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
        cam = b.new_context(permissions=['camera', 'microphone']).new_page()
        cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
        host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
        host.click('.tile[data-peer]'); time.sleep(0.5)
        host.select_option('#stSvc', 'vcam'); host.fill('#stRelay', 'ws://localhost:8937'); host.dispatch_event('#stRelay', 'change')
        host.click('#stRelayCheck'); host.wait_for_function("document.querySelector('#stRelayState').textContent.startsWith('Relay ready')", timeout=8000)
        steps = host.inner_text('#relaySteps')
        assert host.is_hidden('#stUrl') and host.is_hidden('#stKey') and 'as a camera in video calls' in steps and 'v4l2loopback' in steps, steps[:300]
        step('Stream out offers "Zoom, Teams or Meet (as a camera)": no address or key, and the set-up steps for this computer (Linux: a loopback camera and a sound sink)')

        if os.path.exists(OUT): os.remove(OUT)
        obs = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', 'udp://127.0.0.1:19998?timeout=20000000', '-t', '6', '-c', 'copy', OUT])
        host.click('#stGo')
        host.wait_for_function("document.querySelector('#stState').textContent.startsWith('Live on') || document.querySelector('#stState').textContent.startsWith('On as a camera')", timeout=15000)
        obs.wait(timeout=40)
        state = host.inner_text('#stState'); notes = host.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')")
        host.click('#stGo')
        probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height', '-of', 'json', OUT], capture_output=True, text=True).stdout)
        kinds = {s['codec_type']: s for s in probe['streams']}
        assert kinds['video']['codec_name'] == 'h264' and kinds['audio']['codec_name'] == 'aac', probe
        step(f"Go live: \"{state}\"; the stand-in for OBS got the program on UDP: {kinds['video']['codec_name']} {kinds['video'].get('width')}×{kinds['video'].get('height')} + {kinds['audio']['codec_name']} (the toast says: \"{notes[:90]}…\")")
        print('\nerrors:', errors or 'none')
        assert not errors
        b.close()
finally:
    relay.terminate()
    out = relay.communicate(timeout=5)[0]
    print('relay said:', ' / '.join(l for l in out.splitlines() if 'OBS' in l or 'camera' in l)[:300])
