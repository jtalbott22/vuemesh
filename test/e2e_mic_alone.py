# Coming and going, microphones on their own, the live cut for someone leaving, sound sync and
# streaming out:
#  - a microphone alone is heard (the program meter moves) and the program shows its sound
#  - leaving (camera or microphone) goes back to the camera's home, with Rejoin at the top
#  - someone leaving during Record program is sent their part of the live cut first
#  - My events counts events and clips, and deletes a whole event from the phone
#  - Auto-sync lines two recordings of the same sound up to the millisecond
#  - Stream out sends the program to a WHIP endpoint (a stand-in here), key and all
# Run: node dev/server.mjs &  then  python3 test/e2e_mic_alone.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SPEECHY_MIC = """(() => {   // sound like speech: bursts of noise of random lengths (nothing repeats within 20 s)
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.audio && !c.video) {
      const ctx = new AudioContext(), n = ctx.sampleRate * 20, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      let s = 12345; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
      for (let i = 0; i < n;) { const len = Math.floor((0.05 + Math.abs(rnd()) * 0.3) * ctx.sampleRate), amp = Math.abs(rnd()) > 0.4 ? 0.35 * Math.abs(rnd()) : 0.002; for (let k = 0; k < len && i < n; k++, i++) d[i] = amp * rnd(); }
      const src = ctx.createBufferSource(), dst = ctx.createMediaStreamDestination(); src.buffer = buf; src.loop = true; src.connect(dst); src.start(); ctx.resume();
      return dst.stream;
    }
    return orig(c);
  };
})();"""
IDB_ALL = "(store) => new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction(store).objectStore(store).getAll(); t.onsuccess = () => r(t.result); }; })"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())
    hctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = hctx.new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    r = host.evaluate("""(async () => {
      const { offsetBetween } = await import('/js/audiosync.js');
      let s = 7; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
      const N = 8000 * 12, src = new Float32Array(N + 8000); for (let i = 0; i < src.length; i++) src[i] = (i % 3000 < 1800 ? 0.3 : 0.01) * rnd();
      const lag = 1234, a = src.subarray(2000, 2000 + N), b = new Float32Array(N);
      for (let i = 0; i < N; i++) { const j = 2000 + i + lag; b[i] = 0.6 * src[j] + 0.25 * (src[j - 40] || 0) + 0.05 * rnd(); }   // another mic: quieter, an echo, its own hiss
      const hit = offsetBetween(a, b, 16000);
      const other = new Float32Array(N); for (let i = 0; i < N; i++) other[i] = 0.3 * rnd();
      const miss = offsetBetween(a, other, 16000);
      return { lag: hit.lag, score: hit.score, clarity: hit.clarity, missScore: miss.score, missClarity: miss.clarity };
    })()""")
    assert abs(r['lag'] - 1234) < 0.6 and r['score'] > 20 and r['clarity'] > 3 and (r['missScore'] < 8 or r['missClarity'] < 1.4), r
    step(f"sound sync finds a 1234-sample offset between two different 'microphones' ({r['lag']:.2f}, score {r['score']:.0f}; unrelated sound scores {r['missScore']:.1f})")

    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Comings and goings'})})).json()""")
    EID = ev['id']
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={EID}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)

    # ---- a microphone on its own
    mctx = b.new_context(permissions=['camera', 'microphone']); mctx.add_init_script(SPEECHY_MIC)
    mic = mctx.new_page(); watch(mic, 'mic')
    mic.goto(f"{BASE}/cam?e={EID}"); mic.fill('#name', 'Table'); mic.check('input[name=role][value=mic]'); mic.check('#agreeGuest'); mic.click('#joinForm button[type=submit]')
    mic.wait_for_selector('#micView.on', timeout=10000); mic.click('#micSkip'); mic.wait_for_selector('#micStop', state='visible', timeout=5000)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('MIC')", timeout=15000)
    with hctx.expect_page() as pop: host.click('.dock [data-console]')
    con = pop.value; time.sleep(3)
    peak = con.inner_text('#rPeak'); con.close()
    lit = host.evaluate("(() => { const c = document.querySelector('#program'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i+1] + d[i+2] > 200) n++; return n; })()")
    assert peak != '−∞' and lit > 200, (peak, lit)
    step(f"a microphone alone is heard (program peak {peak}) and the program shows its sound ({host.inner_text('#progLabel')})")

    # ---- a camera; Record program; it leaves and gets its part of the live cut first
    cctx = b.new_context(permissions=['camera', 'microphone']); cctx.add_init_script(SPEECHY_MIC)
    cam = cctx.new_page(); watch(cam, 'cam')
    cam.goto(f"{BASE}/cam?e={EID}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=20000)
    host.keyboard.press('1'); time.sleep(0.5)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(0.5)
    host.click('#recProgBtn'); time.sleep(8)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(1)
    cam.click('#camTitle'); cam.click('#leaveBtn')
    cam.wait_for_selector('#rejoinCard:not([hidden])', timeout=90000)
    got = cam.evaluate(f"(async () => (await ({IDB_ALL})('outbox')).filter(r => r.id.startsWith('pgm-')).length)()")
    assert cam.is_visible('#codeView') and cam.inner_text('#rejoinBtn') == 'Rejoin as camera', (got,)
    step("Rosa left during Record program: " + (f"got her part of the live cut first ({got})" if got else "the studio kept her part for when she rejoins") + ", then landed on the camera's home with Rejoin")
    host.click('#recProgBtn'); time.sleep(1)

    # ---- My events: totals; rejoin; leave; delete the whole event
    cam.wait_for_function("document.querySelector('#codeLib').textContent.includes('event')", timeout=10000)
    lib = cam.inner_text('#codeLib')
    assert lib.startswith('My events (1 event · ') and 'clip' in lib, lib
    cam.click('#rejoinBtn'); cam.wait_for_selector('#camView.on', timeout=10000)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer]').length === 1", timeout=20000)
    step(f'home shows "{lib}"; Rejoin took her straight back in (one tap)')
    # the clip she shot reaches the studio: make a second recording of the same sound, 350 ms out, and let Auto-sync find it
    host.wait_for_function(f"(async () => (await ({IDB_ALL})('clips')).some(c => c.name === 'Rosa'))()", timeout=30000)
    for _ in range(30):
        n = host.evaluate(f"(async () => (await ({IDB_ALL})('clips')).filter(c => c.name === 'Rosa').length)()")
        if n: break
        time.sleep(0.5)
    host.evaluate(f"""(async () => {{
      const recs = await ({IDB_ALL})('clips'); const r = recs.find(c => c.name === 'Rosa');
      const copy = {{ ...r, id: r.id + 'b', key: r.key.replace(r.id, r.id + 'b'), name: 'Echo', t0: r.t0 + 350, t0Source: 'phone' }};
      await new Promise(res => {{ const q = indexedDB.open('vuemesh'); q.onsuccess = () => {{ const t = q.result.transaction('clips', 'readwrite'); t.objectStore('clips').put(copy); t.oncomplete = res; }}; }});
    }})()""")
    host.reload(); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000); time.sleep(1)
    ed = edit_window(host.context, host, errors); time.sleep(1); ed.click('#syncBtn')
    ed.wait_for_function("[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('locked to the QR Beacon'))", timeout=90000)
    t0s = ed.evaluate(f"(async () => Object.fromEntries((await ({IDB_ALL})('clips')).map(c => [c.name, [c.t0, c.t0Source]])))()")
    diff = t0s['Echo'][0] - t0s['Rosa'][0]
    msg = next(t for t in ed.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)') if 'locked to the QR Beacon' in t)
    assert abs(diff) <= 3 and 'audio' in (t0s['Echo'][1], t0s['Rosa'][1]) and 'by sound' in msg, (t0s, msg)
    step(f"Auto-sync lined the two recordings up by their sound: 350 ms apart → {diff} ms (\"{msg}\")")
    host.bring_to_front(); time.sleep(0.5)

    cam.click('#camTitle'); cam.click('#leaveBtn'); cam.wait_for_selector('#rejoinCard:not([hidden])', timeout=30000)
    cam.click('#codeLib'); cam.wait_for_selector('#library:not([hidden])')
    totals = cam.inner_text('#libTotals')
    cam.click('#tabShow'); cam.click('#delEvent'); time.sleep(1)
    left = cam.evaluate(f"(async () => (await ({IDB_ALL})('outbox')).length)()")
    assert left == 0 and cam.is_hidden('#rejoinCard') and cam.evaluate(f"localStorage.getItem('vm_msgs_{EID}') === null"), (left,)
    step(f'My events ("{totals}") → Show → Delete this event: everything from it is gone from the phone, Rejoin with it')

    # ---- the microphone leaves too: home, and rejoin as the microphone
    mic.click('#micLeave'); mic.wait_for_selector('#rejoinCard:not([hidden])', timeout=30000)
    assert mic.inner_text('#rejoinMicBtn') == 'Rejoin as microphone' and 'primary' in (mic.get_attribute('#rejoinMicBtn', 'class') or '')
    mic.click('#rejoinMicBtn'); mic.wait_for_selector('#micView.on', timeout=10000)
    step('the microphone left mid-recording → the camera home → "Rejoin as the microphone" → back at the microphone')

    # ---- stream out over WHIP to a stand-in service
    rctx = b.new_context(); recv = rctx.new_page(); watch(recv, 'receiver'); recv.goto(BASE + '/terms')
    recv.evaluate("""() => { window.pc = new RTCPeerConnection(); window.kinds = [];
      pc.ontrack = (e) => { kinds.push(e.track.kind); if (e.track.kind === 'video') { const v = document.createElement('video'); v.muted = true; v.srcObject = new MediaStream([e.track]); v.play(); window.v = v; } }; }""")
    seen = {}
    def whip(route, request):
        if request.method == 'POST':
            seen['auth'] = request.headers.get('authorization'); seen['type'] = request.headers.get('content-type')
            answer = recv.evaluate("""async (sdp) => { await pc.setRemoteDescription({ type: 'offer', sdp }); await pc.setLocalDescription(await pc.createAnswer());
              await new Promise((r) => { if (pc.iceGatheringState === 'complete') return r(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && r(); setTimeout(r, 2000); });
              return pc.localDescription.sdp; }""", request.post_data)
            route.fulfill(status=201, headers={'Content-Type': 'application/sdp', 'Location': '/whip/session/1', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Location'}, body=answer)
        elif request.method == 'DELETE':
            seen['deleted'] = True; route.fulfill(status=200, headers={'Access-Control-Allow-Origin': '*'}, body='')
        else:
            route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS'})
    host.route('https://whip.test/**', whip)
    host.select_option('#stSvc', 'custom'); host.fill('#stUrl', 'https://whip.test/whip/live'); host.fill('#stKey', 'KEY123'); host.click('#stGo')
    recv.wait_for_function("window.v && window.v.readyState >= 2 && window.v.videoWidth > 0", timeout=20000)
    host.wait_for_function("document.querySelector('#stState').textContent.startsWith('Live on')", timeout=10000)
    assert seen.get('auth') == 'Bearer KEY123' and seen.get('type') == 'application/sdp' and host.is_visible('#streamDot'), seen
    vw = recv.evaluate("[v.videoWidth, v.videoHeight, kinds.join('+')]")
    host.click('#stGo'); time.sleep(1)
    assert seen.get('deleted') and host.inner_text('#stGo') == 'Go live', seen
    saved = host.evaluate("JSON.parse(localStorage.getItem('vm_stream'))")
    assert saved['svc'] == 'custom' and saved['per']['custom']['key'] == 'KEY123'
    step(f"Stream out: the program reached a WHIP endpoint ({vw[0]}×{vw[1]}, {vw[2]}), with the key as a Bearer token; Stop ended the session (DELETE); settings kept on this computer")

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
