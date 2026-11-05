# Editing a long day: Collapse gaps takes out the empty time between recordings (undoable),
# and In/Out marks just part of the timeline for Render.
# Run: node dev/server.mjs &  then  python3 test/e2e_range.py   (needs ffmpeg)
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
PROG = "(() => { const s = JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e'))); return s.tracks.find(t => t.program).items.map(i => [Math.round(i.start), Math.round(i.dur)]); })()"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Long day'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    phones = []
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones.append(c)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000); time.sleep(1)
    order = host.eval_on_selector_all('.tile[data-peer] .who', 'e => e.map(x => x.textContent)')
    for name, key in [('Rosa', None), ('Dev', None)]:
        c = phones[0 if name == 'Rosa' else 1]
        c.evaluate("document.querySelector('#shutter').click()"); time.sleep(1)
        host.locator('body').click(position={'x': 700, 'y': 300}); host.keyboard.press(str(order.index(name) + 1)); time.sleep(2)
        c.evaluate("document.querySelector('#shutter').click()")
        if name == 'Rosa': time.sleep(4)   # nobody recording: a gap
    host.wait_for_function("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.filter(c => c.kind !== 'audio').length >= 2); }; }))()", timeout=40000); time.sleep(1.5)
    ed = edit_window(host.context, host, errors); time.sleep(1)
    before = ed.evaluate(PROG)
    gap = before[1][0] - (before[0][0] + before[0][1])
    assert len(before) == 2 and gap > 2000, before
    ed.click('#gapsBtn'); time.sleep(0.5)
    after = ed.evaluate(PROG)
    assert after[0][0] == 0 and abs(after[1][0] - after[0][1]) <= 1, after
    msg = next((t for t in ed.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)') if 'gap' in t), '')
    step(f'Collapse gaps: {before} → {after} — "{msg}"')
    ed.locator('body').click(position={'x': 700, 'y': 300}); ed.keyboard.press('Control+z'); time.sleep(0.4)
    assert ed.evaluate(PROG) == before
    ed.keyboard.press('Control+Shift+z'); time.sleep(0.4)
    assert ed.evaluate(PROG) == after
    step('Undo puts the gaps back; Redo takes them out again')

    ed.keyboard.press('Home'); time.sleep(0.2)
    for _ in range(15): ed.keyboard.press('ArrowRight')
    ed.keyboard.press('i')
    for _ in range(60): ed.keyboard.press('ArrowRight')
    ed.keyboard.press('o'); time.sleep(0.4)
    rng = ed.evaluate("JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e'))).range")
    band = ed.locator('.ruler .inout').count()
    label = ed.inner_text('#renderBtn')
    assert rng and 1800 < rng['out'] - rng['in'] < 2200 and band == 1 and 'In to Out' in label, (rng, band, label)
    step(f"I and O marked {rng['in']}–{rng['out']} ms: amber band on the ruler, the button says \"{label}\", and \"{ed.inner_text('#rangeInfo')}\"")
    with ed.expect_download(timeout=120000) as dl:
        ed.click('#renderBtn')
    dl.value.save_as('/tmp/range.mp4')
    dur = float(json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '/tmp/range.mp4'], capture_output=True, text=True).stdout)['format']['duration'])
    assert 1.7 < dur < 2.4, dur
    step(f'Render exported just In to Out: {dur:.2f} s ("{dl.value.suggested_filename}")')
    open_dialogs = ed.evaluate("[...document.querySelectorAll('dialog[open]')].map(d => d.id)")
    for _ in open_dialogs: ed.keyboard.press('Escape'); time.sleep(0.2)   # close the render result first
    ed.locator('body').click(position={'x': 700, 'y': 300}); ed.keyboard.press('Alt+x'); time.sleep(0.4)
    assert ed.locator('.ruler .inout').count() == 0 and ed.inner_text('#renderBtn') == 'Render MP4'
    step(f'closed the render result ({open_dialogs}); Alt+X cleared In and Out: back to rendering the whole timeline')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
