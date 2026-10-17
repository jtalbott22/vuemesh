# RTMP streaming through the VUEMesh relay, end to end: the relay (Node + ffmpeg) runs next to
# the studio; an ffmpeg RTMP server stands in for YouTube; the program goes studio → relay →
# RTMP and arrives as H.264 + AAC. Also: the studio finds the relay (or says it's missing),
# and the relay only sends to rtmp:// and rtmps:// (and never prints the key).
# Run: node dev/server.mjs &  then  python3 test/e2e_rtmp.py   (needs ffmpeg)
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
HERE = os.path.dirname(os.path.abspath(__file__))
RELAY = os.path.join(HERE, '..', 'public', 'relay', 'vuemesh-relay.mjs')
def step(m): print('ok  ' + m, flush=True)
OUT = '/tmp/rtmp_out.flv'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Streamed'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=20000)
    host.keyboard.press('1'); time.sleep(0.5)

    # no relay yet: the studio says so
    host.select_option('#stSvc', 'rtmp'); host.fill('#stRelay', 'ws://localhost:8936'); host.dispatch_event('#stRelay', 'change')
    host.wait_for_function("document.querySelector('#stRelayState').textContent.startsWith('No relay')", timeout=8000)
    host.fill('#stUrl', 'rtmp://127.0.0.1:19350/live'); host.fill('#stKey', 'SECRETKEY'); host.click('#stGo')
    host.wait_for_function("document.querySelector('#stState').textContent.startsWith('No relay answered')", timeout=10000)
    step(f"without the relay: \"{host.inner_text('#stRelayState')}\"; Go live says \"{host.inner_text('#stState')[:70]}…\"")

    relay = subprocess.Popen(['node', RELAY, '--port', '8936'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(1)
    host.click('#stRelayCheck')
    host.wait_for_function("document.querySelector('#stRelayState').textContent.startsWith('Relay ready')", timeout=8000)
    step(f"relay started: \"{host.inner_text('#stRelayState')}\"")

    # it only sends to RTMP addresses
    bad = host.evaluate("""async () => { const ws = new WebSocket('ws://localhost:8936'); await new Promise(r => ws.onopen = r);
      const got = new Promise(r => ws.onmessage = (e) => r(JSON.parse(e.data))); ws.send(JSON.stringify({ t: 'start', target: 'file:///tmp/steal.flv', kbps: 1000 })); const m = await got; ws.close(); return m; }""")
    assert bad['t'] == 'error' and 'rtmp' in bad['message'], bad
    step(f"the relay refuses anything but rtmp:// and rtmps:// (\"{bad['message']}\")")

    # an RTMP server standing in for YouTube
    if os.path.exists(OUT): os.remove(OUT)
    server = subprocess.Popen(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-listen', '1', '-i', 'rtmp://127.0.0.1:19350/live/SECRETKEY', '-c', 'copy', OUT])
    time.sleep(1)
    host.click('#stGo')
    host.wait_for_function("document.querySelector('#stState').textContent.startsWith('Live on')", timeout=15000)
    host.wait_for_function("/\\d+\\.\\d Mbit\\/s/.test(document.querySelector('#stState').textContent) && !document.querySelector('#stState').textContent.includes('0.0 Mbit')", timeout=20000)
    state = host.inner_text('#stState')
    time.sleep(8)
    host.click('#stGo')
    server.wait(timeout=20)
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height:format=duration', '-of', 'json', OUT], capture_output=True, text=True).stdout)
    codecs = sorted(s['codec_name'] for s in probe['streams'])
    dur = float(probe['format']['duration'])
    assert codecs == ['aac', 'h264'] and dur > 5, (codecs, dur)
    vid = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    step(f"streamed through the relay to an RTMP server: \"{state}\"; it received {dur:.1f} s of {vid['width']}×{vid['height']} H.264 with AAC sound")

    relay.terminate(); out = relay.communicate(timeout=5)[0]
    assert 'SECRETKEY' not in out and 'streaming to 127.0.0.1:19350' in out, out
    step('the relay logged where it streamed, never the key')
    saved = host.evaluate("JSON.parse(localStorage.getItem('vm_stream'))")
    assert saved['relay'] == 'ws://localhost:8936' and saved['per']['rtmp']['key'] == 'SECRETKEY'
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
