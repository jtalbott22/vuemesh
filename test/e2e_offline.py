# A show with no server: everyone joins, then the server goes away altogether (the internet's down,
# or someone pulled the plug). Everything already in carries on over the local network: cutting
# (tally on the phones), the phone remote's buttons and what it shows, a camera's program box, the
# TV's modes, a stuck camera reconnected (over its own link), a clip coming over. The studio says
# it's offline and asks before a reload would end it all. The server back, a new phone can join,
# and a studio opened with no server opens the event as it last saw it.
# Starts its own server (PORT 8796), and takes it offline (no connections, no API) and back.
# Run: python3 test/e2e_offline.py
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('OFFLINE_PORT', '8796'))
BASE = f'http://localhost:{PORT}'
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
PLAYING = "(() => { const v = document.querySelector('#out'); return !!v && !v.hidden && v.readyState >= 2 && v.videoWidth > 0; })()"
TILE = "[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === %r)"
def step(m): print('ok  ' + m, flush=True)

def server():
    p = subprocess.Popen(['node', 'dev/server.mjs'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'HTTPS_PORT': str(PORT + 1000)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + '/config.js', timeout=1)
            return p
        except Exception:
            time.sleep(0.2)
    raise RuntimeError('dev server did not start')

srv = server()
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        errors = []
        hctx = b.new_context(viewport={'width': 1600, 'height': 1000})
        host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
        host.goto(BASE + '/')
        ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Offline show'})})).json()""")
        host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
        host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Offline%20show")  # (the name rides in the studio link; this computer keeps it)
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
        rosa.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        dev.wait_for_function("vmPgm().linked && document.querySelector('#pgmVideo').videoWidth > 0", timeout=30000)
        tv = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
        tv.goto(f"{BASE}/tv?e={ev['id']}")
        if tv.is_visible('#joinForm'):
            tv.fill('#screenName', 'Hall TV'); tv.click('#joinForm button[type=submit]')
        host.wait_for_function("!!document.querySelector('[data-tv-accept]')", timeout=30000)
        host.click('[data-tv-accept]')
        tv.wait_for_function(PLAYING, timeout=30000)
        host.click('#remoteAdd')
        host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
        code = host.inner_text('#remoteCode').replace('-', '')
        rem = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}'))
        rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
        rem.wait_for_function("!document.querySelector('#ctlView').hidden && vmProgramView()?.linked && document.querySelectorAll('#cams .cam').length === 2", timeout=30000)
        if host.evaluate("document.querySelector('#remoteDlg').open"): host.keyboard.press('Escape')
        step('studio with Rosa on air, Dev showing the program in its box, a TV, and a phone remote')

        # the server goes away (as far as everyone can tell: nothing gets through to it)
        urllib.request.urlopen(BASE + '/_dev/offline?on=1').read()
        host.wait_for_selector('#offlineDot:not([hidden])', timeout=15000)
        assert not host.evaluate("vmSockets[0].connected")
        step(f"server stopped: the studio says \"{host.inner_text('#offlineDot')}\"")

        def all_up(tag):
            bad = [n for n, ok in [
                ('Dev box', dev.evaluate("vmPgm().linked")), ('TV', tv.evaluate("vmTvLinked()")), ('remote', rem.evaluate("vmProgramView().linked")),
            ] if not ok]
            links = host.evaluate("[...vmHub().links.values()].map((l) => l.pc.connectionState)")
            assert not bad and links == ['connected', 'connected'], (tag, bad, links)

        # cut in the studio: the tally lights on the phones follow
        host.evaluate(f"{TILE % 'Dev'}.click()")
        dev.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        rosa.wait_for_function("!document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        step('offline, a cut in the studio reaches the phones: Dev on air, Rosa off')

        # the phone remote: what's on air, and a cut from it
        rem.wait_for_function("document.querySelector('#onAir').textContent.includes('Dev')", timeout=10000)
        rosa_peer = host.evaluate(f"{TILE % 'Rosa'}.dataset.peer")
        rem.click(f'#cams .cam[data-peer="{rosa_peer}"]')
        rosa.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        rem.wait_for_function("document.querySelector('#onAir').textContent.includes('Rosa')", timeout=10000)
        rem.click('#pgmTgl')
        host.wait_for_function("[...vmDisplayHub().keys.values()].find((k) => k.remote)?.mode === 'idle'", timeout=10000)
        rem.click('#pgmTgl')
        host.wait_for_function("[...vmDisplayHub().keys.values()].find((k) => k.remote)?.mode === 'program'", timeout=10000)
        step('offline, the phone remote shows what\'s on air, cuts to Rosa from its button, and turns its program off and on')

        # the TV's mode, from the studio
        host.select_option('[data-tv-mode]', 'idle')
        tv.wait_for_function("document.querySelector('#out').hidden", timeout=15000)
        host.select_option('[data-tv-mode]', 'program')
        tv.wait_for_function(PLAYING, timeout=15000)
        step('offline, the TV goes to standby and back from the studio')

        # a stuck camera reconnected: the new link is arranged over the old one
        host.evaluate(f"window.__v = {TILE % 'Dev'}.querySelector('video')")
        dev_peer = host.evaluate(f"{TILE % 'Dev'}.dataset.peer")
        assert host.evaluate(f"vmHub().restart({dev_peer!r})")
        host.wait_for_function(f"(() => {{ const v = {TILE % 'Dev'}?.querySelector('video'); return !!v && v !== __v && v.readyState >= 2; }})()", timeout=25000)
        dev.wait_for_function("vmPgm().linked", timeout=10000)
        step('offline, Dev\'s camera reconnected (as the studio does for a stuck picture): a new link, arranged over the old one, and its picture is back')

        # a clip comes over
        n0 = host.evaluate("vmClipList().length")
        dev.evaluate("document.querySelector('#shutter').click()"); time.sleep(3); dev.evaluate("document.querySelector('#shutter').click()")
        host.wait_for_function(f"vmClipList().length > {n0}", timeout=60000)
        step('offline, a clip Dev recorded came over to the studio')

        # still going a while later
        time.sleep(15)
        all_up('after 15 s more')
        f0 = host.evaluate(f"{TILE % 'Rosa'}.querySelector('video').getVideoPlaybackQuality().totalVideoFrames")
        time.sleep(2)
        assert host.evaluate(f"{TILE % 'Rosa'}.querySelector('video').getVideoPlaybackQuality().totalVideoFrames") > f0 + 20
        step('everything is still connected and the pictures still arriving well after the server went')

        # a reload now would end it all: the studio asks first (headless Chrome never shows the
        # "Leave site?" box itself, so the leaving is asked as the browser asks it)
        LEAVE = "(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; })()"
        assert host.evaluate(LEAVE)
        step('leaving the studio while offline asks first ("Leave site?")')

        # the server back: the studio says so, and a new phone can join
        urllib.request.urlopen(BASE + '/_dev/offline?on=0').read()
        host.wait_for_selector('#offlineDot', state='hidden', timeout=30000)
        assert not host.evaluate(LEAVE), 'online again: no question'
        ana = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE).new_page()
        ana.on('pageerror', lambda e: errors.append(f'Ana: {e}'))
        ana.goto(f"{BASE}/cam?e={ev['id']}"); ana.fill('#name', 'Ana'); ana.check('#agreeGuest'); ana.click('#joinForm button[type=submit]')
        host.wait_for_function(f"{TILE % 'Ana'}?.querySelector('video')?.readyState >= 2", timeout=40000)
        step('the server back: the studio\'s badge goes, and a new phone (Ana) joins')

        # a studio opened with no server: the event as this computer last saw it
        ana.close(); [x.close() for x in (rosa, dev, tv, rem)]
        host.close()
        s2 = hctx.new_page(); s2.on('pageerror', lambda e: errors.append(f'studio 2: {e}'))
        s2.route('**/api/**', lambda r: r.abort())
        s2.goto(f"{BASE}/studio?e={ev['id']}")
        s2.wait_for_function("document.querySelector('#title').textContent === 'Offline show'", timeout=15000)
        assert s2.evaluate("vmNotes().some((t) => t.includes('no internet'))"), s2.evaluate('vmNotes()')
        step('a studio opened with no server opens the event as this computer last saw it (title, host controls)')

        print('\nerrors:', errors or 'none')
        assert not errors
        b.close()
finally:
    srv.terminate()
