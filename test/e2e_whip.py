# Stream out over WHIP, on its own: the program reaches a WHIP endpoint (a stand-in: another
# browser answering through an intercepted route) with the key as a Bearer token; Stop ends
# the session; the services list offers WHIP and RTMP groups.
# Run: node dev/server.mjs &  then  python3 test/e2e_whip.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(str(e)))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Whip'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    groups = host.eval_on_selector_all('#stSvc optgroup', 'g => g.map(x => [x.label, x.children.length])')
    assert len(groups) == 3 and groups[0][1] >= 4 and groups[1][1] >= 7, groups
    step(f'Stream out offers {groups}')
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.keyboard.press('1'); time.sleep(0.5)
    recv = b.new_context().new_page(); recv.goto(BASE + '/terms')
    recv.evaluate("""() => { window.pc = new RTCPeerConnection(); window.kinds = [];
      pc.ontrack = (e) => { kinds.push(e.track.kind); if (e.track.kind === 'video') { const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([e.track]); v.play(); window.v = v; } }; }""")
    seen = {}
    def whip(route, request):
        if request.method == 'POST':
            seen['auth'] = request.headers.get('authorization')
            answer = recv.evaluate("""async (sdp) => { await pc.setRemoteDescription({ type: 'offer', sdp }); await pc.setLocalDescription(await pc.createAnswer());
              await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
              return pc.localDescription.sdp; }""", request.post_data)
            route.fulfill(status=201, headers={'Content-Type': 'application/sdp', 'Location': '/whip/session/1', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location'}, body=answer)
        elif request.method == 'DELETE':
            seen['deleted'] = True; route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, body='')
        else:
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'})
    host.route('https://whip.test/**', whip)
    host.select_option('#stSvc', 'custom')
    assert host.is_hidden('#stRelayRow')
    host.fill('#stUrl', 'https://whip.test/whip/live'); host.fill('#stKey', 'KEY123'); host.click('#stGo')
    recv.wait_for_function("window.v && window.v.readyState >= 2 && window.v.videoWidth > 0", timeout=30000)
    host.wait_for_function("document.querySelector('#stState').textContent.startsWith('Live on')", timeout=15000)
    assert seen.get('auth') == 'Bearer KEY123', seen
    vw = recv.evaluate("[v.videoWidth, v.videoHeight, kinds.join('+')]")
    host.click('#stGo'); time.sleep(1)
    assert seen.get('deleted') and host.inner_text('#stGo') == 'Go live', seen
    step(f"WHIP: the program reached the endpoint ({vw[0]}×{vw[1]}, {vw[2]}), key as a Bearer token, no relay asked for; Stop ended the session")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
