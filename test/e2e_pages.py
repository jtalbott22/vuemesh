# Live and Edit are separate pages, each with only its own markup (studio.html, edit.html); the
# shared code gets a stand-in for the other page's elements. Both pages load and work without an
# error: the studio shows Live's controls and no timeline, the Edit page the timeline and no
# switcher; every stand-in handed out is one of the other page's listed elements; and pressing
# around (full screen, fades, breaks, help; play, marks, gaps, export) raises nothing.
# Run: node dev/server.mjs &  then  python3 test/e2e_pages.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Two pages'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    vis = lambda pg, sel: pg.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return !!e && e.offsetParent !== null; }})()")
    has = lambda pg, sel: pg.evaluate(f"!!document.querySelector('{sel}')")
    assert vis(host, '#program') and vis(host, '#recProgBtn') and not has(host, '#playBtn') and not has(host, '#selPanel')
    step("the studio page has Live's controls (program, Record program) and none of Edit's (no timeline, no Selection panel)")
    cdp = b.new_browser_cdp_session()
    renderers = lambda: len([x for x in cdp.send('SystemInfo.getProcessInfo')['processInfo'] if x['type'] == 'renderer'])
    before = renderers()
    with ctx.expect_page() as pop: host.evaluate("document.querySelector('#editTab').click()")
    ed = pop.value; ed.on('pageerror', lambda e: errors.append(f'edit: {e}')); ed.on('dialog', lambda d: d.accept())
    ed.wait_for_function("document.body && document.body.dataset.mode === 'edit'", timeout=120000)
    assert vis(ed, '#timeline') and vis(ed, '#playBtn') and not has(ed, '#switcher') and not has(ed, '#recProgBtn')
    after = renderers()
    assert after > before, (before, after)
    step(f"the Edit page has the timeline and play, and none of Live's (no switcher, no Record program); it runs in its own browser process ({before} → {after} page processes)")
    for sel in ['#helpBtn', '#streamBtn', '#addLocal', '#swTgl', '#fsBtn']:
        host.evaluate(f"document.querySelector('{sel}')?.click()"); time.sleep(0.3); host.keyboard.press('Escape')
    for k in ['f', 'f', 'x', 'x', 'b', 'b']:
        host.keyboard.press(k); time.sleep(0.3)
    for k in ['Home', 'Space', 'Space', 'i', 'o', 'm', 'd', 'f', 'f']:
        ed.keyboard.press(k); time.sleep(0.2)
    for sel in ['#gapsBtn', '#helpBtn', '#renderBtn']:
        ed.evaluate(f"document.querySelector('{sel}')?.click()"); time.sleep(0.4); ed.keyboard.press('Escape')
    time.sleep(1)
    for name, pg in (('studio', host), ('Edit', ed)):
        listed = pg.evaluate("JSON.parse(document.body.dataset.absent)")
        used = pg.evaluate('vmAbsent()')
        assert all(i in listed for i in used), (name, [i for i in used if i not in listed])
    step(f"pressing around both pages raised nothing; stand-ins handed out were all the other page's elements (studio {len(host.evaluate('vmAbsent()'))}, Edit {len(ed.evaluate('vmAbsent()'))})")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
