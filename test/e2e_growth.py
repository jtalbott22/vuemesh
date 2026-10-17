# Growth for investors, with the 30-day policy intact: anonymous day counts (events, cameras
# and microphones joining once each, events run, recordings and footage from the studio)
# shown in Admin with growth against the previous period, a CSV, a printable investor
# snapshot and snapshots saved for the record.
# Run: node dev/server.mjs &  then  python3 test/e2e_growth.py   (dev admin key: dev-admin)
import os, time, csv, io
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    adm = ctx.new_page(); adm.on('pageerror', lambda e: errors.append(f'admin: {e}'))
    adm.goto(f"{BASE}/admin"); adm.fill('#key', 'dev-admin'); adm.click('#login button[type=submit]')
    adm.wait_for_selector('#gKpis .kpi', timeout=15000)
    base = adm.evaluate("(async () => (await (await fetch('/api/admin/growth', { headers: { 'x-admin-key': 'dev-admin' } })).json()).days)()")
    today = time.strftime('%Y-%m-%d', time.gmtime())
    t0 = next((d for d in base if d['day'] == today), {})

    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Growth night', kind:'wedding'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    cam.reload(); cam.wait_for_selector('#joinView:not([hidden])', timeout=15000); cam.click('#joinForm button[type=submit]')   # (the same phone again: still one camera)
    host.keyboard.press('1'); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(4); cam.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > 0", timeout=60000)
    host.evaluate("vmReportUsage()"); time.sleep(1.5)
    after = adm.evaluate("(async () => (await (await fetch('/api/admin/growth', { headers: { 'x-admin-key': 'dev-admin' } })).json()).days)()")
    t1 = next(d for d in after if d['day'] == today)
    d = lambda k: t1.get(k, 0) - t0.get(k, 0)
    assert d('events') == 1 and d('kind_wedding') == 1 and d('cameras') == 1 and d('active_events') == 1 and d('clips') >= 1 and d('footage_sec') >= 2, t1
    assert ev['id'] not in str(t1) and 'Rosa' not in str(t1)
    step(f"today's anonymous counts went up by: events 1, cameras 1 (the same phone joined twice), events run 1, recordings {d('clips')}, footage {d('footage_sec')} s; nothing in them names the event or the phone")

    adm.click('#refresh') if adm.is_visible('#refresh') else None
    adm.reload(); adm.wait_for_selector('#gKpis .kpi', timeout=15000); time.sleep(1)
    kpis = adm.eval_on_selector_all('#gKpis .kpi', 'e => e.map(x => x.innerText.replace(/\\n/g, " "))')
    bars = adm.eval_on_selector_all('#gChart rect', 'e => e.length')
    rows = adm.eval_on_selector_all('#gTable tbody tr', 'e => e.length')
    assert bars >= 30 and rows >= 1 and any('Events created' in k for k in kpis), (bars, rows, kpis)
    step(f"Admin, Growth: {kpis[:4]} …, a {bars}-bar chart with the running total, and a month table")
    with adm.expect_download() as dl: adm.click('#gCsv')
    text = open(dl.value.path()).read()
    rows = list(csv.reader(io.StringIO(text)))
    assert rows[0][:3] == ['day', 'events', 'active_events'] and any(r[0] == today for r in rows), rows[:2]
    step(f'CSV: {len(rows) - 1} days × {len(rows[0]) - 1} counts ({dl.value.suggested_filename})')
    with ctx.expect_page() as pop: adm.click('#gReport')
    rep = pop.value; rep.wait_for_load_state()
    assert 'VUEMesh usage' in rep.inner_text('h1') and rep.locator('svg').count() == 2 and '30 days' in rep.inner_text('.fine')
    step(f"Investor snapshot: a printable page (\"{rep.inner_text('.sub')}\") with the period against the one before, two charts, and how it's counted")
    rep.close(); adm.bring_to_front()
    adm.once('dialog', lambda dlg: dlg.accept('Seed deck test'))
    adm.click('#gSave'); adm.wait_for_function("document.querySelector('#gSnaps').textContent.includes('Seed deck test')", timeout=10000)
    adm.click('.snaps summary')
    with ctx.expect_page() as pop2: adm.click('#gSnaps [data-snap]')
    assert 'Seed deck test' in pop2.value.inner_text('.sub')
    step('Save snapshot keeps the numbers as they are today; Open shows that report again')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
