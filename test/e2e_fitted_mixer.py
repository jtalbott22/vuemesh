# v0.20.1: the Live mixer fits its strips; Live has the panel buttons; the relay set-up steps
# follow this computer (with tabs for the others and copy buttons); Program out fills the
# screen with one click; dark mode is the same black on every page.
# Run: node dev/server.mjs &  then  python3 test/e2e_fitted_mixer.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    host = ctx.new_page(); errors = []; host.on('pageerror', lambda e: errors.append(str(e)))
    host.goto(BASE + '/'); host.evaluate("localStorage.setItem('vm_theme', 'dark')")
    host.evaluate("localStorage.setItem('vm_layout', JSON.stringify({ live: { dock: 146, dockManual: true } }))")   # dragged tall in 0.20.1
    host.reload()
    bg = lambda pg: pg.evaluate("getComputedStyle(document.body).backgroundColor")
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Polish'})})).json()""")
    pages = {'home': bg(host)}
    for name, url in [('beacon', f"/beacon?e={ev['id']}"), ('monitor', f"/monitor?e={ev['id']}#k={ev['hostKey']}")]:
        pg = ctx.new_page(); pg.goto(BASE + url); time.sleep(0.5); pages[name] = bg(pg); pg.close()
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    pages['studio'] = bg(host)
    # (the home page has its own, broadcast palette now; the app's pages share theirs)
    app = {k: v for k, v in pages.items() if k != 'home'}
    assert len(set(app.values())) == 1 and list(app.values())[0] == 'rgb(15, 16, 19)' and pages['home'] == 'rgb(18, 21, 25)', pages
    step(f"dark mode is one black everywhere: {pages}")
    cam = b.new_context(permissions=['camera', 'microphone']).new_page()
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000); time.sleep(1)
    dock = host.evaluate("document.querySelector('.dock').getBoundingClientRect().height")
    strip = host.evaluate("document.querySelector('#bridge .vstrip').getBoundingClientRect().bottom - document.querySelector('.dock').getBoundingClientRect().bottom")
    # (fits: shorter than the 146 px it was dragged to, and the strips end at its foot, its padding
    # apart. A strip is a row taller since 0.61.8, with its mode buttons, so not a fixed height)
    assert dock < 146 and -12 <= strip <= 0, (dock, strip)
    step(f'the Live mixer fits its strips (even though it was dragged to 146 px before): {dock:.0f}px tall, no empty space below them')
    D = "(() => { const d = document.querySelector('.dock'); return [Math.round(d.getBoundingClientRect().height), d.classList.contains('horiz')]; })()"
    sp = host.locator('#splitD').bounding_box(); x, y = sp['x'] + sp['width'] / 2, sp['y'] + sp['height'] / 2
    host.mouse.move(x, y); host.mouse.down(); host.mouse.move(x, y - 80); host.mouse.move(x, y - 170); host.mouse.up(); time.sleep(0.4)
    tall = host.evaluate(D)
    sp = host.locator('#splitD').bounding_box(); x, y = sp['x'] + sp['width'] / 2, sp['y'] + sp['height'] / 2
    host.mouse.move(x, y); host.mouse.down(); host.mouse.move(x, y + 120); host.mouse.move(x, y + 400); host.mouse.up(); time.sleep(0.4)
    back = host.evaluate(D)
    assert tall[0] >= 175 and not tall[1] and back[0] == round(dock) and back[1], (tall, back, dock)
    step(f'dragged up, the strips stand up ({tall[0]}px); dragged right down, it snaps back to fit ({back[0]}px)')
    assert host.is_visible('#togLeft') and host.is_visible('#togRight')
    host.click('#togLeft'); host.click('#togRight'); time.sleep(0.4)
    assert host.evaluate("document.body.classList.contains('noleft') && document.body.classList.contains('noright')")
    host.click('#togLeft'); host.click('#togRight'); time.sleep(0.3)
    step('Live has the left-panel and inspector buttons too; they hide and show both panels')
    host.select_option('#stSvc', 'youtube-rtmp'); time.sleep(0.5)
    tabs = host.eval_on_selector_all('.ostabs button', 'e => e.map(x => [x.textContent, x.getAttribute("aria-selected")])')
    mine = [t for t, sel in tabs if sel == 'true'][0]
    host.click('.ostabs [data-os="win"]'); time.sleep(0.2)
    win = host.inner_text('#relaySteps')
    host.click('#relaySteps [data-copy]'); time.sleep(0.3)
    copied = host.evaluate("navigator.clipboard.readText()")
    assert 'winget' in win and copied.startswith('winget install'), (win, copied)
    host.click('.ostabs [data-os="mac"]'); assert 'brew install node ffmpeg' in host.inner_text('#relaySteps')
    host.click('.ostabs [data-os="cros"]'); assert 'Linux development environment' in host.inner_text('#relaySteps')
    step(f'relay set-up steps open on this computer ({mine}); Windows, Mac and ChromeOS tabs have their own; Copy puts "{copied}" on the clipboard')
    with ctx.expect_page() as pop: host.click('#progOutBtn')
    po = pop.value; po.wait_for_load_state(); time.sleep(1)
    hint = po.is_visible('#fshint')
    po.mouse.click(600, 300); time.sleep(0.8)
    assert hint and po.evaluate("!!document.fullscreenElement") and po.inner_text('#fs') == 'Exit full screen'
    step('Program out says "Click anywhere for full screen"; one click and it fills the screen')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
