# Picture-in-picture, another computer's screen, and the inspector's cards. Another computer
# opens /share?e=CODE, names itself and shares a screen: the studio has it as a source, marked a
# screen. Cut to a camera, then to the screen: the camera stays live in the corner (tally on its
# tile, its sound open, its picture in the program's corner), the share page says it's on air;
# P takes the corner away and brings it back; the phone remote sees it and can turn it off. The
# inspector is cards with a title and what each is for: Close all folds them, and this computer
# remembers which are open.
# Run: node dev/server.mjs &  then  python3 test/e2e_pip.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
# the corner's picture against the screen's (the program canvas): how different the corner box is from just outside it
CORNER = """() => {
  const c = document.querySelector('#program'), g = c.getContext('2d', { willReadFrequently: true });
  const W = c.width, H = c.height, w = Math.round(W * 0.25), h = Math.round(w * 9 / 16), m = Math.round(W * 0.025);
  const mean = (x, y, ww, hh) => { const d = g.getImageData(x, y, ww, hh).data; let s = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; } const n = d.length / 4; return s.map((v) => v / n); };
  const inside = mean(W - m - w + 10, H - m - h + 10, w - 20, h - 20), outside = mean(W - m - w - 60, H - m - h - 60, 40, 40);
  return Math.round(inside.reduce((a, v, i) => a + Math.abs(v - outside[i]), 0));
}"""
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Lecture'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    assert f"/share?e={ev['id']}" in host.inner_text('#shareUrl')
    host.click('#localList [data-add="cam"] >> nth=0'); time.sleep(1)
    host.click('#localDlg form button')
    cam = host.get_attribute('.tile[data-peer^="local-cam"]', 'data-peer')
    step(f"the studio's add dialog gives the link for another computer: {host.evaluate('location.origin')}/share?e={ev['id']}")

    # another computer shares its screen
    sh = b.new_context(viewport={'width': 900, 'height': 800}).new_page(); sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f"{BASE}/share?e={ev['id']}")
    assert sh.is_hidden('#codeBox')
    sh.fill('#name', 'Teaching station'); sh.click('#shareBtn')
    sh.wait_for_selector('#liveView:not([hidden])', timeout=10000)
    sh.wait_for_function("vmShare().linked", timeout=30000)
    host.wait_for_function("[...document.querySelectorAll('.tile[data-peer]')].some((t) => !t.dataset.peer.startsWith('local-'))", timeout=20000)
    scr = host.evaluate("[...document.querySelectorAll('.tile[data-peer]')].map((t) => t.dataset.peer).find((p) => !p.startsWith('local-'))")
    host.wait_for_function("vmNotes().some((n) => n.includes(\"Teaching station is another computer's screen\"))", timeout=20000)
    step("another computer opened /share, named itself and shared its screen: the studio has it as a source, marked a screen")

    # a camera on air, then the screen: the camera stays live in the corner
    host.click(f'.tile[data-peer="{cam}"]'); time.sleep(1)
    host.click(f'.tile[data-peer="{scr}"]')
    host.wait_for_function(f"vmPip().peer === '{cam}' && vmPip().a === 1", timeout=10000)
    host.wait_for_function(f"document.querySelector('.tile[data-peer=\"{cam}\"]').classList.contains('pipair')", timeout=5000)
    sh.wait_for_function("document.querySelector('#tag').textContent === 'ON AIR'", timeout=10000)
    time.sleep(0.5)
    d_on = host.evaluate(CORNER)
    rs = host.evaluate('vmRemoteState()')
    assert any(c['peer'] == cam and c['inset'] for c in rs['cams']) and any(c['peer'] == scr and c['screen'] for c in rs['cams']), rs['cams']
    assert rs['pip']['on'] and rs['pip']['now']
    cid = host.evaluate(f"(() => {{ const t = vmRemoteState().cams.find((c) => c.peer === '{cam}'); return t && t.name; }})()")
    row = next((r for r in rs['mix']['rows'] if r['role'] != 'mic' and cid in r['name']), None)
    assert row and row['open'], rs['mix']
    step(f"camera, then the screen: the camera stays live in the corner (its tile tallied, the remote says IN CORNER, the share page says ON AIR, its sound open; the corner differs from the screen by {d_on})")

    # P: off and on
    host.keyboard.press('p')
    host.wait_for_function("vmPip().a === 0 && !vmPip().on", timeout=5000)
    time.sleep(0.3)
    d_off = host.evaluate(CORNER)
    assert host.get_attribute('#pipBtn', 'aria-pressed') == 'false'
    host.keyboard.press('p')
    host.wait_for_function(f"vmPip().peer === '{cam}' && vmPip().a === 1", timeout=5000)
    step(f"P took the corner away (corner vs screen {d_on} → {d_off}) and brought it back")

    # cutting back to the camera: the corner goes (it's the shot now)
    host.click(f'.tile[data-peer="{cam}"]')
    host.wait_for_function("vmPip().a === 0 && !vmPip().peer", timeout=5000)
    host.click(f'.tile[data-peer="{scr}"]')
    host.wait_for_function(f"vmPip().peer === '{cam}'", timeout=5000)
    step('back to the camera, the corner goes; to the screen again, it comes back')

    # the inspector's cards
    n = host.evaluate("document.querySelectorAll('.insp details.card').length")
    assert n >= 12 and host.evaluate("[...document.querySelectorAll('.insp details.card')].every((d) => d.open && d.querySelector('.sT') && d.querySelector('.sD'))")
    host.click('#cardsFold')
    assert host.evaluate("[...document.querySelectorAll('.insp details.card')].every((d) => !d.open)")
    host.click('#cardPip summary'); time.sleep(0.4)  # (the toggle event comes a moment later)
    host.reload()
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    opened = host.evaluate("[...document.querySelectorAll('.insp details.card')].filter((d) => d.open).map((d) => d.id)")
    assert opened == ['cardPip'], opened
    assert host.inner_text('#cardsFold') == 'Close all'
    host.click('#cardsFold'); assert host.inner_text('#cardsFold') == 'Open all'
    host.click('#cardsFold')
    assert host.evaluate("[...document.querySelectorAll('.insp details.card')].every((d) => d.open)")
    step(f'the inspector is {n} cards, each a title and what it is for; Close all folds them and this computer remembers which are open')

    # stop sharing: it leaves the show
    sh.click('#stopBtn')
    sh.wait_for_selector('#stoppedView:not([hidden])')
    host.wait_for_function(f"!document.querySelector('.tile[data-peer=\"{scr}\"]')", timeout=30000)
    step('Stop sharing: the screen left the show')
    assert not errors, errors
    b.close()
