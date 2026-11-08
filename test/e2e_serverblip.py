# The server connection drops for a moment (AWS cuts every WebSocket at two hours; Wi-Fi blinks):
# the pictures and sound go straight between the devices, not through the server, so nothing that
# was connected lets go. The studio's drop: the cameras, a camera's program box and a TV all keep
# their links (the same ones, never rebuilt). A phone's own drop: the studio keeps its camera. An
# offer lost on the way: the phone asks again after 10 s rather than wait for ever. A phone that
# really leaves still goes from the studio at once.
# Run: node dev/server.mjs &  then  python3 test/e2e_serverblip.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
PLAYING = "(() => { const v = document.querySelector('#out'); return !!v && !v.hidden && v.readyState >= 2 && v.videoWidth > 0; })()"
def step(m): print('ok  ' + m, flush=True)
TILE = "[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === %r)"
BLIP = "vmSockets.forEach((s) => s.blip())"
UP = "vmSockets.every((s) => s.connected)"

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Blip test'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    ph = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE).new_page()
        c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=30000)
    rosa, dev = ph['Rosa'], ph['Dev']
    host.evaluate(f"{TILE % 'Rosa'}.click()")
    dev.wait_for_function("vmPgm().linked && document.querySelector('#pgmVideo').videoWidth > 0", timeout=30000)
    tv = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
    tv.goto(f"{BASE}/tv?e={ev['id']}")
    if tv.is_visible('#joinForm'):
        tv.fill('#screenName', 'Hall TV'); tv.click('#joinForm button[type=submit]')
    host.wait_for_function("!!document.querySelector('[data-tv-accept]')", timeout=30000)
    host.click('[data-tv-accept]')
    tv.wait_for_function(PLAYING, timeout=30000)
    step('studio with Rosa on air, Dev showing the program in its box, and a TV showing the program')

    def mark():
        # the studio's tiles' own video elements (a rebuilt link makes new ones)
        host.evaluate(f"window.__v = {{ Rosa: {TILE % 'Rosa'}?.querySelector('video'), Dev: {TILE % 'Dev'}?.querySelector('video') }}")
    def same(name):
        return host.evaluate(f"(() => {{ const v = {TILE % name}?.querySelector('video'); return !!v && v === __v[{name!r}] && v.readyState >= 2; }})()")
    def frames(name):
        return host.evaluate(f"{TILE % name}.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
    def watch(secs, label):
        # sample every link through the drop: none may let go, even for a moment
        bad = []
        end = time.time() + secs
        while time.time() < end:
            if not dev.evaluate("vmPgm().linked"): bad.append('Dev program box')
            if not tv.evaluate("vmTvLinked()"): bad.append('TV')
            for n in ['Rosa', 'Dev']:
                if not same(n): bad.append(f'studio tile {n}')
            time.sleep(0.25)
        assert not bad, (label, sorted(set(bad)))

    # 1. the studio's server connection drops (as AWS does at two hours) and comes back
    mark(); f0 = frames('Rosa')
    host.evaluate(BLIP)
    host.wait_for_function(f"!({UP})", timeout=3000)
    watch(8, 'studio drop')
    host.wait_for_function(UP, timeout=10000)
    assert frames('Rosa') > f0 + 60, 'Rosa kept arriving'
    assert rosa.evaluate("document.querySelector('#camView').classList.contains('onair')"), 'Rosa still on air'
    tv.wait_for_function(PLAYING, timeout=2000)
    step('the studio\'s server connection dropped and came back: both cameras, Dev\'s program box and the TV kept the same links throughout, and Rosa stayed on air')

    # 2. a phone's own server connection drops (its camera and its program box both)
    mark()
    dev.evaluate(BLIP)
    dev.wait_for_function(f"!({UP})", timeout=3000)
    watch(8, 'phone drop')
    dev.wait_for_function(UP, timeout=10000)
    host.wait_for_function("vmSockets[0].peers.some((p) => p.name === 'Dev')", timeout=5000)
    step('Dev\'s server connections dropped and came back: the studio kept its camera, and its program box kept going')

    # 3. an offer lost on the way (the studio was reconnecting, say): the phone asks again
    rosa.evaluate("""(() => { const send = WebSocket.prototype.send; window.__lost = 0;
      WebSocket.prototype.send = function (d) { if (!__lost && String(d).includes('"kind":"offer"')) { __lost++; return; } return send.call(this, d); }; })()""")
    rosa.click('#camTitle'); rosa.click('#leaveBtn'); rosa.wait_for_selector('#rejoinCard:not([hidden])', timeout=40000)
    host.wait_for_function(f"!{TILE % 'Rosa'}", timeout=10000)
    t0 = time.time()
    rosa.click('#rejoinBtn')
    host.wait_for_function(f"{TILE % 'Rosa'}?.querySelector('video')?.readyState >= 2", timeout=30000)
    took = time.time() - t0
    assert rosa.evaluate("__lost") == 1 and 8 < took < 25, (rosa.evaluate("__lost"), took)
    step(f'Rosa\'s first offer after rejoining was lost: she asked again and was back in {took:.0f} s (not stuck waiting)')

    # 4. a phone that really leaves still goes at once
    dev.click('#camTitle'); dev.click('#leaveBtn')
    t0 = time.time()
    host.wait_for_function(f"!{TILE % 'Dev'}", timeout=6000)
    step(f'Dev left: gone from the studio in {time.time() - t0:.1f} s')

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
