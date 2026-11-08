# A show on the studio computer's own Wi-Fi (public/relay/vuemesh-local.mjs). The helper runs beside
# the studio (here on test ports, with the dev certificate, the hotspot as a dry run); the studio finds
# it, gives it the show and joins it; Join by QR shows two codes: the Wi-Fi's and the show's address.
# A phone opens that address (its browser told the address is this computer, as the hotspot's
# answers would) and joins with its camera, through the helper; with the cloud gone, another does
# too. The welcome page a phone's "am I online?" check gets, its Done, and the helper's own address
# answers, are checked as well; and it talks only to VUEMesh's pages.
# Run: python3 test/e2e_localshow.py   (starts its own servers: 8798, and the helper on 18936/18443/18080/18053)
import os, socket, struct, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8798
BASE = f'http://localhost:{PORT}'
NAME = 'show1234ab.lan.vuemesh.com'
CTRL, HTTPS, HTTP, DNSP = 18936, 18443, 18080, 18053
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE_ARGS = ARGS + [f'--host-resolver-rules=MAP {NAME} 127.0.0.1', '--ignore-certificate-errors']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
TILE = "[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === %r)"
READ = "(async (sel) => (await import('/js/vm.js')).decodeQR(document.querySelector(sel)))"
def step(m): print('ok  ' + m, flush=True)
def get(url, headers=None):
    r = urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=5)
    return r.status, r.read().decode()
def up(url):
    for _ in range(60):
        try:
            urllib.request.urlopen(url, timeout=1); return
        except urllib.error.HTTPError:
            return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError('not up: ' + url)

home = tempfile.mkdtemp(prefix='vm-local-')
srv = subprocess.Popen(['node', 'dev/server.mjs'], cwd=ROOT, env={**os.environ, 'PORT': str(PORT), 'HTTPS_PORT': str(PORT + 1000)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
helper = subprocess.Popen(['node', 'public/relay/vuemesh-local.mjs', '--port', str(CTRL), '--https', str(HTTPS), '--http', str(HTTP), '--dns', str(DNSP), '--dns-own', '--dns-bind', '127.0.0.1',
                           '--site', 'public', '--cert', 'dev/.cert/cert.pem', '--key', 'dev/.cert/key.pem', '--name', NAME, '--home', home, '--dry-run'],
                          cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    up(BASE + '/config.js'); up(f'http://127.0.0.1:{CTRL}/status')
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        pb = p.chromium.launch(args=PHONE_ARGS)
        errors = []
        host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
        host.on('pageerror', lambda e: errors.append(f'host: {e}'))
        host.goto(BASE + '/')
        ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Barn show'})})).json()""")
        host.evaluate(f"localStorage.setItem('vm_autorec_default', '0'); localStorage.setItem('vm_local', 'http://localhost:{CTRL}')")
        host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
        host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)

        host.click('#qrJoinBtn')
        host.wait_for_function("document.querySelector('#qjLocalSay').textContent.includes('helper is running')", timeout=15000)
        host.wait_for_function("vmLocalShow().connected", timeout=10000)
        assert host.is_visible('#qjHotspot') and host.inner_text('#qjHotspot') == 'Start the hotspot'
        step(f"the studio finds the helper, gives it the show and joins it: \"{host.inner_text('#qjLocalSay')}\"")

        host.click('#qjHotspot')
        host.wait_for_selector('#qjWifiFig:not([hidden])', timeout=10000)
        wifi, show = host.evaluate(READ, '#qjWifiQr'), host.evaluate(READ, '#qjShowQr')
        assert wifi.startswith('WIFI:T:WPA;S:VUEMesh ') and ';P:' in wifi, wifi
        link = f"https://{NAME}:{HTTPS}/cam?e={ev['id']}"
        assert show == link, (show, link)
        host.wait_for_selector('#localDot:not([hidden])', timeout=8000)
        step(f"Start the hotspot: two codes, the Wi-Fi's ({wifi.split(';P:')[0]}…) and the show's ({show}); the studio shows HOTSPOT")

        def phone(name):
            c = pb.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE, ignore_https_errors=True).new_page()
            c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
            c.goto(link); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
            return c
        ana = phone('Ana')
        host.wait_for_function(f"{TILE % 'Ana'}?.querySelector('video')?.readyState >= 2", timeout=40000)
        host.evaluate(f"{TILE % 'Ana'}.click()")
        ana.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
        assert ana.evaluate("location.host") == f'{NAME}:{HTTPS}' and ana.evaluate("VM_CONFIG.local === true")
        step("Ana's phone opens the show's address (served by the helper, its joining too) and joins with her camera: in the studio, on air")

        urllib.request.urlopen(BASE + '/_dev/offline?on=1').read()
        host.wait_for_selector('#offlineDot:not([hidden])', timeout=15000)
        assert host.is_visible('#localDot')
        ben = phone('Ben')
        host.wait_for_function(f"{TILE % 'Ben'}?.querySelector('video')?.readyState >= 2", timeout=40000)
        assert host.evaluate(f"{TILE % 'Ana'}?.querySelector('video')?.readyState >= 2")
        step('the cloud gone (OFFLINE, and HOTSPOT): Ben joins the same way, and Ana is still in')

        # a phone's "am I online?" check: the welcome page, then (after Done) the answer it expects
        code, page = get(f'http://127.0.0.1:{HTTP}/hotspot-detect.html', {'Host': 'captive.apple.com'})
        assert code == 200 and "show's Wi-Fi" in page and link in page.replace('&amp;', '&'), page[:400]
        get(f'http://127.0.0.1:{HTTP}/accept', {'Host': 'captive.apple.com'})
        code, page = get(f'http://127.0.0.1:{HTTP}/hotspot-detect.html', {'Host': 'captive.apple.com'})
        assert 'Success' in page, page
        r = urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{HTTP}/generate_204', headers={'Host': 'connectivitycheck.gstatic.com'}), timeout=5)
        assert r.status == 204
        step('the welcome page: a phone checking if it\'s online gets it (with the show\'s address); after Done, the answer it expects (Apple, Android)')

        # its own answers for addresses
        q = struct.pack('>HHHHHH', 0x4242, 0x0100, 1, 0, 0, 0) + b''.join(bytes([len(l)]) + l.encode() for l in NAME.split('.')) + b'\0' + struct.pack('>HH', 1, 1)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3); s.sendto(q, ('127.0.0.1', DNSP)); a, _ = s.recvfrom(512)
        assert a[:2] == b'\x42\x42' and struct.unpack('>H', a[6:8])[0] == 1 and list(a[-4:]) == [10, 42, 0, 1], a
        step(f'its address answers: {NAME} is the hotspot\'s address (10.42.0.1)')

        try:
            urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:{CTRL}/status', headers={'Origin': 'https://evil.example'}), timeout=3)
            raise AssertionError('a foreign page was let in')
        except urllib.error.HTTPError as e:
            assert e.code == 403
        step('it talks only to VUEMesh\'s own pages (another site is refused)')

        host.click('#qjHotspot')
        host.wait_for_function("document.querySelector('#qjHotspot').textContent === 'Start the hotspot' && document.querySelector('#qjWifiFig').hidden", timeout=10000)
        step('Stop the hotspot: its Wi-Fi code goes')

        print('\nerrors:', errors or 'none')
        assert not errors
        b.close(); pb.close()
finally:
    srv.terminate(); helper.terminate()
    try:
        out = helper.communicate(timeout=5)[0]
        if os.environ.get('SHOW_HELPER'): print(out)
    except Exception:
        pass
