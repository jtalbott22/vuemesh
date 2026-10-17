# Edit looks like the show: a break taken live (B) is its own item in the automatic edit (the
# break slate, with what it said), between the camera before and after; the Dissolve button
# (and D) puts a dissolve into the selected shot and takes it off again. And the studio opened
# with no event, or one that's gone, lists the events on this computer to open.
# Run: node dev/server.mjs &  then  python3 test/e2e_editbreaks.py
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
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())   # ("Leave site?" while recording: yes)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Breaks'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    ph = {}
    for name in ['Ana', 'Ben']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
        host.wait_for_function(f"[...document.querySelectorAll('.tile[data-peer] video')].filter(v => v.readyState >= 2).length === {len(ph)}", timeout=150000)
    tap = lambda sel: host.evaluate(f"(() => {{ const e = [...document.querySelectorAll('.tile[data-peer]')].find(t => t.textContent.includes('{sel}')); e.click(); }})()")
    tap('Ana'); time.sleep(5)
    host.evaluate("(() => { const i = document.querySelector('#slateMsg'); i.value = 'Back in a moment'; i.dispatchEvent(new Event('input', {bubbles: true})); })()")
    host.keyboard.press('b'); time.sleep(4); host.keyboard.press('b'); time.sleep(5)   # (back on Ana a moment before cutting to Ben)
    tap('Ben'); time.sleep(5)
    ed = edit_window(host.context, host, errors)
    prog = []
    for _ in range(180):
        prog = ed.evaluate("(() => (vmProgram ? null : null))()") or ed.evaluate("(() => [...document.querySelectorAll('.lane .item')].map(x => x.getAttribute('aria-label').split(',')[0]))()")
        if any('Break (live)' in x for x in prog) and any('Ben' in x for x in prog) and any('Ana' in x for x in prog): break
        time.sleep(0.5)
    brk = [x for x in prog if 'Break (live)' in x]
    assert brk and 'Back in a moment' in brk[0], prog
    order = [('break' if 'Break' in x else 'Ana' if 'Ana' in x else 'Ben' if 'Ben' in x else '?') for x in prog if 'Mic' not in x]
    assert order.index('break') > order.index('Ana') and order.index('Ben') > order.index('break') and 'Ana' in order[order.index('break'):], order
    step(f'the live break is its own item in the edit, between the shots before and after: {order[:6]} ("{brk[0]}")')

    ben = ed.evaluate("vmProgram().find(i => i.name === 'Ben' && i.start > 0)")
    ed.evaluate(f"vmSeek({ben['start'] + 500})"); time.sleep(0.5)   # (the playhead on Ben's shot: Dissolve works on the shot there)
    ed.evaluate("document.querySelector('#xdBtn').click()"); time.sleep(0.4)
    # (the shot at that spot, by name: a recording landing can rebuild the timeline and renew its id)
    at = lambda: ed.evaluate(f"(vmProgram().find(i => i.name === 'Ben' && i.start <= {ben['start'] + 500} && i.start + i.dur > {ben['start'] + 500}) || {{}}).dissolve || 0")
    d1 = at()
    ed.evaluate('document.activeElement.blur()'); ed.keyboard.press('d'); time.sleep(0.4)
    d2 = at()
    step(f'Dissolve put a {d1} ms dissolve into the selected shot{" (it already had the live one, so it came off)" if not d1 else ""}; D toggled it ({d2} ms)')
    assert (d1 == 500 and d2 == 0) or (d1 == 0 and d2 == 500), (d1, d2)

    pick = ctx.new_page(); pick.on('pageerror', lambda e: errors.append(f'pick: {e}'))
    pick.goto(f"{BASE}/studio"); pick.wait_for_selector('#eventPicker[open]', timeout=15000)
    rows = pick.eval_on_selector_all('#pickList li', 'e => e.map(x => x.innerText.replace(/\\n/g, " "))')
    assert any('Breaks' in r and ev['id'] in r for r in rows), rows
    pick.goto(f"{BASE}/studio?e=ZZZZZZ"); pick.wait_for_selector('#eventPicker[open]', timeout=15000)
    why = pick.inner_text('#pickWhy')
    pick.click(f'#pickList a[href="/studio?e={ev["id"]}"]'); pick.wait_for_function("document.querySelector('#title').textContent === 'Breaks'", timeout=15000)
    step(f'the studio with no event (or a gone one: "{why[:40]}…") lists this computer\'s events: {rows[:2]}; Open went straight into it')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
