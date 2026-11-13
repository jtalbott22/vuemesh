# Joining with no internet, by QR code. A phone that has opened VUEMesh before opens a show with no
# internet at all (pages, API and signalling all gone): the page comes from the phone itself, and,
# with no server to find the studio through, it shows a QR code. The studio's Join by QR reads it
# (here the code is handed over as a camera would read it; the QR images are checked to read back
# the same), shows its answer, and the phone takes it: a link straight to the studio, which brings
# the show's details, then the usual join (name, terms, camera) and its picture in the studio, on
# air. A camera whose link has really gone, with no internet, gets "Reconnect by QR" and comes back
# the same way. The internet back, nothing changes.
# Starts its own server (PORT 8797), and takes it offline and back.
# Run: python3 test/e2e_qrjoin.py
import os, subprocess, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('QRJOIN_PORT', '8797'))
BASE = f'http://localhost:{PORT}'
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
TILE = "[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === %r)"
READ = "(async (sel) => (await import('/js/vm.js')).decodeQR(document.querySelector(sel)))"
def step(m): print('ok  ' + m, flush=True)
def offline(on, pages=False): urllib.request.urlopen(f"{BASE}/_dev/offline?on={1 if on else 0}{'&pages=1' if pages else ''}").read()

srv = subprocess.Popen(['node', 'dev/server.mjs'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'HTTPS_PORT': str(PORT + 1000)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + '/config.js', timeout=1); break
        except Exception:
            time.sleep(0.2)
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        errors = []
        host = b.new_context(viewport={'width': 1600, 'height': 1000}, permissions=['camera', 'microphone']).new_page()
        host.on('pageerror', lambda e: errors.append(f'host: {e}'))
        host.goto(BASE + '/')
        ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'QR show'})})).json()""")
        host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
        host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=QR%20show")  # (the name rides in the studio link: the server never has it)
        host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)

        def phone(name):
            c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE).new_page()
            c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
            return c
        rosa = phone('Rosa')
        rosa.goto(f"{BASE}/cam?e={ev['id']}"); rosa.fill('#name', 'Rosa'); rosa.check('#agreeGuest'); rosa.click('#joinForm button[type=submit]')
        host.wait_for_function(f"{TILE % 'Rosa'}?.querySelector('video')?.readyState >= 2", timeout=30000)
        # Ana has opened VUEMesh before (not this show): the app is kept on her phone
        ana = phone('Ana')
        ana.goto(f"{BASE}/cam")
        ana.wait_for_function("navigator.serviceWorker?.controller && caches.has('vm-app-v1')", timeout=15000)
        time.sleep(3)  # (what the page loaded, kept)
        step('the studio with Rosa in it; Ana opened VUEMesh once before, and it kept the app on her phone')

        # no internet at all: pages, API, signalling
        offline(True, pages=True)
        host.wait_for_selector('#offlineDot:not([hidden])', timeout=15000)
        ana.goto(f"{BASE}/cam?e={ev['id']}")
        ana.wait_for_selector('#qrJoinView:not([hidden])', timeout=20000)
        ana.wait_for_function("vmQrJoinPhone()?.code", timeout=10000)
        code = ana.evaluate("vmQrJoinPhone().code")
        assert ana.evaluate(READ, '#qjMine') == code, 'the QR on the phone reads back as its code'
        step(f"no internet: Ana's phone opens the show from what it kept, and shows its QR code ({len(code)} characters, reads back the same)")

        host.evaluate("vmQrJoin.open()")
        assert host.is_visible('#qrJoinDlg') and 'Rosa' in host.inner_text('#qjSrc'), host.inner_text('#qjSrc')
        assert host.evaluate(f"vmQrJoin.read({code!r})")
        answer = host.evaluate("vmQrJoin.answer()")
        assert answer and answer.startswith('VMJ1|') and host.evaluate(READ, '#qjQr') == answer
        step("the studio's Join by QR (read with: " + ', '.join(host.eval_on_selector_all('#qjSrc option', 'o => o.map((x) => x.textContent)')) + ") takes Ana's code and shows its answer, which reads back the same")

        assert ana.evaluate(f"vmQrJoinPhoneRead({answer!r})")
        ana.wait_for_selector('#joinView:not([hidden])', timeout=20000)
        assert ana.inner_text('#joinTitle') == 'QR show' and ana.inner_text('#terms').strip()
        host.wait_for_function("document.querySelector('#qjSay2').textContent.includes('Connected')", timeout=10000)
        step("Ana's phone scans it: a link straight to the studio, which tells it the show (\"QR show\", its terms)")

        ana.fill('#name', 'Ana'); ana.check('#agreeGuest'); ana.click('#joinForm button[type=submit]')
        host.wait_for_function(f"{TILE % 'Ana'}?.querySelector('video')?.readyState >= 2", timeout=40000)
        host.evaluate(f"{TILE % 'Ana'}.click()")
        ana.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        assert '2 cameras' in host.inner_text('#presence'), host.inner_text('#presence')
        step(f"Ana joins as usual: her picture is in the studio and she's on air; the studio counts her ({host.inner_text('#presence')})")
        host.wait_for_function("document.querySelector('#qjRead') && !document.querySelector('#qjRead').hidden", timeout=10000)
        host.click('#qjCancel')

        # Rosa's link really goes (no internet to come back through): Reconnect by QR
        rosa_peer = host.evaluate(f"{TILE % 'Rosa'}.dataset.peer")
        host.evaluate(f"vmHub().drop({rosa_peer!r})")
        rosa.wait_for_selector('#qrRejoinBtn:not([hidden])', timeout=90000)
        rosa.click('#qrRejoinBtn')
        rosa.wait_for_function("vmQrJoinPhone()?.code", timeout=10000)
        host.evaluate("vmQrJoin.open()")
        assert host.evaluate(f"vmQrJoin.read({rosa.evaluate('vmQrJoinPhone().code')!r})")
        assert rosa.evaluate(f"vmQrJoinPhoneRead({host.evaluate('vmQrJoin.answer()')!r})")
        host.wait_for_function(f"{TILE % 'Rosa'}?.querySelector('video')?.readyState >= 2", timeout=40000)
        host.click('#qjCancel')
        step('Rosa\'s link went, with no internet: her phone offered "Reconnect by QR", and with the codes swapped she\'s back in the studio')

        # the internet back: nothing changes
        offline(False)
        host.wait_for_selector('#offlineDot', state='hidden', timeout=30000)
        time.sleep(4)
        for n in ['Rosa', 'Ana']:
            assert host.evaluate(f"{TILE % n}?.querySelector('video')?.readyState >= 2"), n
        assert ana.evaluate("document.querySelector('#camView').classList.contains('onair')")
        step('the internet back: both still in, Ana still on air')

        print('\nerrors:', errors or 'none')
        assert not errors
        b.close()
finally:
    srv.terminate()
