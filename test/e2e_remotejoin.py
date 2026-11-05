# The phone remote, saved to a home screen: it opens on /remote with no link (its own manifest
# starts it there, not on the camera page). The first time, it scans the studio's Add a phone code
# with its own camera (here: the code's link handed to the page as if scanned) and is paired.
# The next show on that studio computer needs just the show's code: the phone's key from before
# lets it in, and opened again it goes straight to the last show. A phone the studio has never
# paired is told to add it once; a phone with no pairing at all is asked for the code too. The
# show's code alone never lets a phone in.
# Run: node dev/server.mjs &  then  python3 test/e2e_remotejoin.py
import os, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
NEW_EVENT = """async (t) => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title: t})})).json()"""
CONTROLS = "!document.querySelector('#ctlView').hidden && !!document.querySelector('#title').textContent && document.querySelector('#conn').classList.contains('on')"
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    m = host.evaluate("async () => (await fetch('/remote.webmanifest')).json()")
    assert m['start_url'] == '/remote' and m['display'] == 'standalone', m
    ev1 = host.evaluate(NEW_EVENT, 'Monday class')
    host.goto(f"{BASE}/studio?e={ev1['id']}#k={ev1['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)

    # opened from the home screen: no link
    rctx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera'])
    rem = rctx.new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}')); rem.on('dialog', lambda d: d.accept())
    rem.goto(f"{BASE}/remote")
    assert rem.is_visible('#pairView') and rem.is_visible('#scanBtn')
    rem.click('#scanBtn'); rem.wait_for_selector('#scanBox:not([hidden])', timeout=10000)
    step(f"the remote's own manifest starts it at {m['start_url']}; opened with no link it asks to pair, and its camera can scan")

    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    rem.evaluate("(t) => vmRemoteTake(t) && document.querySelector('#pairBtn').click()", f"{BASE}/remote?e={ev1['id']}#p={code}")
    rem.wait_for_function(CONTROLS, timeout=30000)
    rem.click('#scanBtn') if rem.is_visible('#scanBtn') else None
    step('scanned the studio\'s Add a phone code: paired, and the camera let go')

    # the next show on this studio computer: the show's code is enough
    ev2 = host.evaluate(NEW_EVENT, 'Wednesday class')
    host.goto(f"{BASE}/studio?e={ev2['id']}#k={ev2['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    rem.goto(f"{BASE}/remote")  # (back from the home screen: the last show, Monday's, is closed now)
    rem.wait_for_function("document.querySelector('#show').value.length === 6", timeout=5000)
    assert rem.input_value('#show') == ev1['id']
    rem.wait_for_function("!document.querySelector('#pairView').hidden && document.querySelector('#pairSay').textContent.includes(\"isn't open\")", timeout=20000)
    say = rem.inner_text('#pairSay')
    rem.fill('#show', ev2['id']); rem.click('#pairBtn')
    rem.wait_for_function(CONTROLS, timeout=30000)
    host.wait_for_function("vmNotes().some((n) => n.includes('joined this show as a remote'))", timeout=10000)
    assert host.evaluate("vmRemoteHost().list().length") == 1
    step(f'back from the home screen on last show\'s code, with that studio closed: "{say}"; then the next show on the same studio computer with just its code, no Add a phone; the studio says the phone joined as its remote')

    rem.goto(f"{BASE}/remote")
    rem.wait_for_function(CONTROLS, timeout=30000)
    assert rem.input_value('#show') == ev2['id']
    rem.click('#changeShow'); assert rem.is_visible('#pairView') and rem.is_visible('#show')
    step('opened again from the home screen: straight into the last show; Another show… is there for the next one')

    # a phone this studio never paired, and a phone never paired at all
    stranger = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); stranger.on('pageerror', lambda e: errors.append(f'stranger: {e}'))
    stranger.goto(f"{BASE}/remote")
    stranger.evaluate("(k) => localStorage.setItem('vm_remote_keys', k)", json.dumps(['NotAKeyThisStudioGaveOut0000000']))
    stranger.fill('#show', ev2['id']); stranger.click('#pairBtn')
    stranger.wait_for_function("document.querySelector('#pairSay').textContent.includes(\"doesn't know this phone yet\")", timeout=20000)
    assert stranger.is_hidden('#ctlView')
    fresh = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    fresh.goto(f"{BASE}/remote"); fresh.fill('#show', ev2['id']); fresh.click('#pairBtn')
    fresh.wait_for_function("document.querySelector('#pairSay').textContent.includes('needs the code from the studio')", timeout=5000)
    step("a phone this studio never paired is told to add it once; one never paired at all is asked for the code: the show's code alone lets nobody in")

    # pasting the studio's whole link fills both and connects
    paste = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    paste.goto(f"{BASE}/remote")
    assert paste.evaluate("() => vmRemoteTake('ABC123 ABCD-EFGH') && document.querySelector('#show').value === 'ABC123' && document.querySelector('#code').value === 'ABCD-EFGH'")
    step('typed or pasted together ("ABC123 ABCD-EFGH", or the link), the two codes go where they belong')
    assert not errors, errors
    b.close()
