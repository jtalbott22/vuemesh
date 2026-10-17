# Every time on air makes Edit, even after hand edits: take one with this computer's camera
# (on air, a break, on air again: the break is its own item in the edit), a hand edit (the
# break deleted, Collapse gaps), then another take live with a break: going to Edit puts the
# new footage, its break item included, on the end, and Collapse gaps leaves no empty time.
# Run: node dev/server.mjs &  then  python3 test/e2e_secondtake.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())   # ("Leave site?" while recording: yes)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Takes'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=30000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="cam"]', timeout=15000)
    host.select_option('#localList [data-snd] >> nth=0', '')   # (picture only, to keep it simple)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=15000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=20000)
    P = lambda: host.evaluate("(() => vmProgram().map(i => ({ id: i.id, kind: i.name ? 'cam' : 'break', start: i.start, dur: i.dur })))()")
    def span(items): return (len(items), round(sum(i['dur'] for i in items) / 1000), round(max((i['start'] + i['dur'] for i in items), default=0) / 1000))
    def wait_for(pred, t=60):
        for _ in range(t * 2):
            items = P()
            if pred(items): return items
            time.sleep(0.5)
        return P()
    key = lambda k: (host.evaluate('document.activeElement && document.activeElement.blur()'), host.keyboard.press(k))

    # take one: on air, a break, on air again
    host.evaluate("document.querySelector('.tile[data-peer^=\"local-cam\"]').click()"); time.sleep(5)
    key('b'); time.sleep(8); key('b'); time.sleep(5)
    ed = edit_window(host.context, host, errors)
    t1 = wait_for(lambda it: [i['kind'] for i in it][:3] == ['cam', 'break', 'cam'])
    assert [i['kind'] for i in t1][:3] == ['cam', 'break', 'cam'], t1
    step(f'take one in the edit: camera, the break (its own item), camera: {span(t1)} (pieces, s of items, s long)')
    brk = next(i for i in t1 if i['kind'] == 'break')
    ed.evaluate(f"vmSelect('{brk['id']}')"); ed.evaluate('document.activeElement && document.activeElement.blur()'); ed.keyboard.press('Delete'); time.sleep(0.5)
    ed.evaluate("document.querySelector('#gapsBtn').click()"); time.sleep(0.8)
    h1 = P()
    assert 'break' not in [i['kind'] for i in h1] and span(h1)[2] <= span(h1)[1] + 1, h1
    step(f'a hand edit: the break deleted and Collapse gaps: {span(h1)} (the timeline is hand-made now)')

    # take two, later: back in Live, a break, on air again, then Edit
    host.bring_to_front(); time.sleep(0.5)
    key('b'); time.sleep(9); key('b'); time.sleep(6)
    ed = edit_window(host.context, host, errors)
    h2 = wait_for(lambda it: 'break' in [i['kind'] for i in it] and [i['kind'] for i in it][-1] == 'cam' and span(it)[2] >= span(h1)[2] + 12, 90)
    kinds = [i['kind'] for i in h2]
    assert 'break' in kinds and kinds[-1] == 'cam' and span(h2)[2] >= span(h1)[2] + 12, (h1, h2)
    step(f'take two went on the end, its break as an item: {kinds[len(h1):]} → {span(h2)}')
    ed.evaluate("document.querySelector('#gapsBtn').click()"); time.sleep(0.8)
    h3 = P()
    assert span(h3)[2] <= span(h3)[1] + 1, h3
    step(f'Collapse gaps again: {span(h3)}, no empty time')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
