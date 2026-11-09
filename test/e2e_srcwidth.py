# The sources panel's width (0.66.14): its divider widens it on a laptop too (at 1280 and 1366
# px it went nowhere: the page held the panel to 22% of the window), the pictures in it grow with
# it, the program is fitted again beside it and keeps 40% of the window, the width is kept after a
# reload, a double-click puts it back, a finger can drag it, and dragged to the edge it slides shut.
# Run: node dev/server.mjs &  then  python3 test/e2e_srcwidth.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

GEOM = """(() => {
  const r = (s) => document.querySelector(s)?.getBoundingClientRect();
  const mon = r('.center .monitor'), pg = r('#program'), tile = r('.tile[data-peer]');
  return { src: r('.sources').width, centre: r('.center').width, prog: pg.width, progH: pg.height,
    inMonitor: pg.left >= mon.left - 1 && pg.right <= mon.right + 1 && pg.top >= mon.top - 1 && pg.bottom <= mon.bottom + 1,
    tile: tile ? tile.width : 0, sideways: document.documentElement.scrollWidth - innerWidth,
    shut: document.body.classList.contains('noleft'), vw: innerWidth };
})()"""
SAVED = "JSON.parse(localStorage.getItem('vm_layout') || '{}').live || {}"

def drag(page, dx, steps=10):
    sl = page.locator('#splitL').bounding_box()
    x, y = sl['x'] + sl['width'] / 2, sl['y'] + sl['height'] / 2
    page.mouse.move(x, y); page.mouse.down()
    page.mouse.move(x + dx, y, steps=steps); page.mouse.up(); time.sleep(0.5)
    return page.evaluate(GEOM)

def touch_drag(page, dx):
    """A finger on the divider: real touch events, through the browser's input (not a mouse)."""
    cdp = page.context.new_cdp_session(page)
    sl = page.locator('#splitL').bounding_box()
    x, y = sl['x'] + sl['width'] / 2, sl['y'] + sl['height'] / 2
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 11):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x + dx * i / 10, 'y': y}]}); time.sleep(0.03)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); time.sleep(0.5)
    cdp.detach()
    return page.evaluate(GEOM)

def fair(g, what):
    """The program is never squeezed out: it keeps 40% of the window, fits its monitor, nothing scrolls sideways."""
    assert g['sideways'] <= 0, (what, g)
    assert g['centre'] >= g['vw'] * 0.4 - 1 and g['centre'] >= 399, (what, g)
    assert g['inMonitor'] and g['prog'] > 300, (what, g)

def studio(b, w, h, touch=False):
    ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=touch)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host {w}: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Wider sources'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam {w}: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1.5)
    return ctx, host, cam

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)

    # ---- a 1366 x 768 laptop: the divider went nowhere here before ----
    ctx, host, cam = studio(b, 1366, 768)
    g0 = host.evaluate(GEOM)
    assert 290 <= g0['src'] <= 310 and g0['tile'] > 0 and g0['sideways'] <= 0, g0
    step(f"1366x768: the sources start at their usual {g0['src']:.0f} px (22% of the window), Rosa's picture {g0['tile']:.0f} px wide, program {g0['prog']:.0f} px")

    g1 = drag(host, 160)
    assert abs(g1['src'] - (g0['src'] + 160)) <= 3, (g0, g1)
    assert g1['tile'] >= g0['tile'] * 1.3, (g0, g1)
    assert g1['prog'] < g0['prog'] - 40, (g0, g1)   # fitMonitors fitted the program to its narrower monitor
    fair(g1, 'after +160')
    assert host.evaluate(SAVED).get('leftSet') is True
    step(f"dragged 160 px wider: the sources {g1['src']:.0f} px, Rosa's picture {g0['tile']:.0f} -> {g1['tile']:.0f} px, the program fitted again {g0['prog']:.0f} -> {g1['prog']:.0f} px, inside its monitor")

    g2 = drag(host, 1200)
    fair(g2, 'dragged all the way')
    assert g2['src'] > g1['src'] and g2['centre'] <= g2['vw'] * 0.4 + 2, (g1, g2)   # stopped where the program keeps its 40%
    mx = int(host.get_attribute('#splitL', 'aria-valuemax')); now = int(host.get_attribute('#splitL', 'aria-valuenow'))
    assert now == mx and abs(g2['src'] - mx) <= 1, (mx, now, g2)
    step(f"dragged as far as it goes: it stops at {g2['src']:.0f} px (its aria-valuemax), the program's column {g2['centre']:.0f} px (40% of 1366), nothing scrolls sideways")

    g3 = drag(host, -200)
    host.reload(); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    g4 = host.evaluate(GEOM)
    assert abs(g4['src'] - g3['src']) <= 2 and abs(g4['tile'] - g3['tile']) <= 3, (g3, g4)
    fair(g4, 'after reload')
    step(f"kept after a reload: {g3['src']:.0f} px before, {g4['src']:.0f} px after, the picture {g4['tile']:.0f} px")

    host.dblclick('#splitL'); time.sleep(0.5)
    g5 = host.evaluate(GEOM)
    assert abs(g5['src'] - g0['src']) <= 2 and abs(g5['tile'] - g0['tile']) <= 3 and not g5['shut'], (g0, g5)
    assert not host.evaluate(SAVED).get('leftSet')
    host.reload(); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000); time.sleep(1)
    assert abs(host.evaluate(GEOM)['src'] - g0['src']) <= 2
    step(f"a double-click on the divider puts it back to {g5['src']:.0f} px, and that's kept too")

    host.focus('#splitL'); host.keyboard.press('ArrowRight'); time.sleep(0.3)
    g6 = host.evaluate(GEOM)
    assert abs(g6['src'] - (g0['src'] + 20)) <= 2, (g0, g6)
    step(f"→ on the focused divider: 20 px wider ({g6['src']:.0f} px)")

    g7 = drag(host, -400)
    assert g7['shut'] and g7['src'] < 2 and host.evaluate(SAVED).get('leftHidden') is True, g7
    assert host.get_attribute('#togLeft', 'aria-pressed') == 'false'
    host.click('#togLeft'); time.sleep(0.5)
    g8 = host.evaluate(GEOM)
    assert not g8['shut'] and abs(g8['src'] - g6['src']) <= 2, (g6, g8)   # (as it was before the drag, not the narrowest it went through)
    g9 = drag(host, -400); assert g9['shut']
    g10 = drag(host, 250)
    assert not g10['shut'] and g10['src'] > 300, g10
    fair(g10, 'dragged back out')
    step(f"dragged to the left edge it slides shut (program {g7['prog']:.0f} px); ◧ opens it as it was ({g8['src']:.0f} px); shut again and dragged back out: {g10['src']:.0f} px")
    cam.context.close(); ctx.close()

    # ---- a finger: a touch screen laptop ----
    ctx, host, cam = studio(b, 1280, 800, touch=True)
    t0 = host.evaluate(GEOM)
    hit = host.evaluate("""(() => { const r = document.querySelector('#splitL').getBoundingClientRect();
      const x = r.left + r.width / 2 + 10, y = r.top + r.height / 2; return document.elementFromPoint(x, y)?.id; })()""")
    assert hit == 'splitL', hit   # (a coarse pointer: 10 px off the 6-px divider still takes hold of it)
    t1 = touch_drag(host, 150)
    assert abs(t1['src'] - (t0['src'] + 150)) <= 4 and t1['tile'] > t0['tile'] * 1.25, (t0, t1)
    fair(t1, 'touch')
    t2 = touch_drag(host, -100)
    assert abs(t2['src'] - (t1['src'] - 100)) <= 4, (t1, t2)
    step(f"1280x800 by touch: the divider is a finger wide; dragged out {t0['src']:.0f} -> {t1['src']:.0f} px (the picture {t0['tile']:.0f} -> {t1['tile']:.0f} px), back to {t2['src']:.0f} px")
    cam.context.close(); ctx.close()

    # ---- other common sizes: as far as it goes, the program keeps its share ----
    for w, h in [(1280, 800), (1440, 900), (1536, 864), (1920, 1080), (1024, 768)]:
        ctx, host, cam = studio(b, w, h)
        a = host.evaluate(GEOM)
        z = drag(host, 2000)
        fair(z, f'{w}x{h} widest')
        assert z['src'] > a['src'] + 80 and z['tile'] > a['tile'], (w, a, z)
        step(f"{w}x{h}: {a['src']:.0f} -> {z['src']:.0f} px at most, the picture {a['tile']:.0f} -> {z['tile']:.0f} px, the program's column {z['centre']:.0f} px, nothing sideways")
        cam.context.close(); ctx.close()

    assert not errors, errors
    b.close()
print('PASS')
