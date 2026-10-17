# The layered editor: two cameras, then cut, split, drag-trim, undo, picture-in-picture,
# move, layer priority, mixer, and an offline render checked with ffprobe.
# Run: node dev/server.mjs &  then  python3 test/e2e_editor.py
import os, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)

BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
PROG = '[data-lane="t-prog"] .item'

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())
    host = b.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True).new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Editor test'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)

    cams = []
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); watch(c, name)
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        cams.append(c)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=20000)
    time.sleep(1)
    for c in cams:  # press both shutters at once (no click-settling delay between phones)
        hit = c.evaluate("(() => { const b = document.querySelector('#shutter').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('#shutter') !== null })()")
        assert hit, 'something covers the shutter button'
    for c in cams: c.evaluate("document.querySelector('#shutter').click()")
    time.sleep(1); host.keyboard.press('1'); time.sleep(5)
    for c in cams: c.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=150000)   # (a slow machine)
    time.sleep(3)
    got = host.evaluate("async () => (await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; }))")
    assert got == 2, got
    step('two cameras recorded; both clips delivered and verified')

    ed = edit_window(host.context, host, errors); time.sleep(1)
    ed.fill('#zoom', '120'); ed.dispatch_event('#zoom', 'input'); time.sleep(0.3)
    n0 = ed.eval_on_selector_all(PROG, 'e => e.length')
    step(f'Program built from the live cut: {n0} item(s)')

    # put the playhead where both phones are rolling, cut to angle 2
    ed.evaluate("() => document.querySelector('#tracks').scrollIntoView()")
    ruler = ed.locator('#tracks [data-ruler]').bounding_box()
    both = ed.evaluate("async () => { const c = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; }); return (Math.max(...c.map(x => x.t0)) - Math.min(...c.map(x => x.t0))) / 1000; }")
    ed.mouse.click(ruler['x'] + (both + 1) * 120, ruler['y'] + 5); time.sleep(0.3)
    ed.keyboard.press('2'); time.sleep(0.4)
    n1 = ed.eval_on_selector_all(PROG, 'e => e.length')
    labels = ed.eval_on_selector_all(PROG, 'e => e.map(x => x.textContent.trim().replace(/^[▭▯]/, ""))')
    assert n1 > n0 and labels[0].startswith('1') and any(l.startswith('2') for l in labels), (n0, n1, labels)
    live_names = labels[0].split(' ', 1)[1]
    step(f'live cut on camera 1 stayed angle 1 in Edit; key 2 cut to the other phone → {labels}')

    SEQ = "JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')))"
    prog = lambda: ed.evaluate(SEQ + ".tracks.find(t => t.program).items.map(i => [Math.round(i.start), Math.round(i.dur), Math.round(i.in || 0)])")
    tool = lambda k: (ed.keyboard.press(k), time.sleep(0.15))
    def drag(loc, dx, at='mid'):
        bb = loc.bounding_box()
        x = bb['x'] + (bb['width'] - 3 if at == 'end' else 3 if at == 'start' else bb['width'] / 2)
        y = bb['y'] + bb['height'] / 2
        ed.mouse.move(x, y); ed.mouse.down(); ed.mouse.move(x + dx, y, steps=6); ed.mouse.up(); time.sleep(0.3)

    # Ctrl+K: add edit a second later
    ed.mouse.click(ruler['x'] + (both + 2) * 120, ruler['y'] + 5); time.sleep(0.2)
    ed.keyboard.press('Control+k'); time.sleep(0.3)
    n2 = ed.eval_on_selector_all(PROG, 'e => e.length')
    assert n2 == n1 + 1, (n1, n2)
    step(f'Ctrl+K added an edit at the playhead → {n2} items')

    # Selection tool: drag the last item's end handle 60 px left, then undo
    tool('v')
    last = ed.locator(PROG).last
    w0 = last.bounding_box()['width']
    drag(last, -60, 'end')
    w1 = ed.locator(PROG).last.bounding_box()['width']
    assert w1 < w0 - 40, (w0, w1)
    ed.keyboard.press('Control+z'); time.sleep(0.3)
    w2 = ed.locator(PROG).last.bounding_box()['width']
    assert abs(w2 - w0) < 2, (w0, w2)
    step(f'Selection (V): dragged an end handle to trim ({w0:.0f}→{w1:.0f}px), Ctrl+Z restored it')

    # Ripple (B): trim the first item's end 30 px; everything after slides back
    before = prog()
    tool('b'); drag(ed.locator(PROG).first, -30, 'end')
    after = prog()
    shift = before[1][0] - after[1][0]
    assert after[0][1] < before[0][1] and abs(shift - (before[0][1] - after[0][1])) <= 2, (before, after)  # rounded ms
    step(f'Ripple (B): first item {before[0][1]}→{after[0][1]} ms, later items moved back {shift} ms, no gap')
    ed.keyboard.press('Control+z'); time.sleep(0.2)

    # Roll (N): move the first cut point 40 px later; total length unchanged
    before = prog()
    tool('n'); drag(ed.locator(PROG).first, 40, 'end')
    after = prog()
    assert after[0][1] > before[0][1] and abs(after[1][0] - (after[0][0] + after[0][1])) <= 2 and abs(sum(x[1] for x in after) - sum(x[1] for x in before)) <= 2, (before, after)
    step(f'Rolling (N): cut point moved {after[1][0] - before[1][0]} ms, total length unchanged')

    # Slip (Y): second item shows a different part of its clip, same place
    before = prog()
    tool('y'); drag(ed.locator(PROG).nth(1), -40)
    after = prog()
    assert after[1][0] == before[1][0] and after[1][2] != before[1][2], (before, after)
    step(f'Slip (Y): same start, source in-point {before[1][2]}→{after[1][2]} ms')

    # Slide (U): move the second item later; its neighbours trim to fit
    before = prog()
    tool('u'); drag(ed.locator(PROG).nth(1), 30)
    after = prog()
    assert after[1][0] > before[1][0] and abs(after[0][0] + after[0][1] - after[1][0]) <= 2 and abs(after[1][0] + after[1][1] - after[2][0]) <= 2, (before, after)
    step(f'Slide (U): item moved {after[1][0] - before[1][0]} ms, neighbours trimmed, still gap-free')

    # Razor (C): click the last item to cut it
    n_before = len(prog())
    tool('c')
    lb = ed.locator(PROG).last.bounding_box()
    ed.mouse.click(lb['x'] + lb['width'] / 2, lb['y'] + lb['height'] / 2); time.sleep(0.3)
    assert len(prog()) == n_before + 1
    step('Razor (C): one click cut the clip in two')
    tool('v')

    # Markers and edit-point navigation
    ed.mouse.click(ruler['x'] + 1.5 * 120, ruler['y'] + 5); time.sleep(0.2)
    ed.keyboard.press('m'); time.sleep(0.2)
    assert ed.locator('.marker').count() == 1
    ed.keyboard.press('Home'); time.sleep(0.1)
    ed.keyboard.press('ArrowDown'); time.sleep(0.2)
    t_first = ed.evaluate("document.querySelector('#clock').textContent")
    step(f'M added a marker; ↓ from the start jumped to the next edit point ({t_first})')
    n1 = len(prog())

    # picture-in-picture at 2.5 s (both phones are rolling by then), then drag it 60 px right
    ed.keyboard.press('Escape')
    ed.mouse.click(ruler['x'] + (both + 1.5) * 120, ruler['y'] + 5); time.sleep(0.2)
    ed.keyboard.press('Shift+P'); time.sleep(0.4)
    assert ed.locator('.lane .item.pip').count(), ed.evaluate("document.querySelector('.toast')?.textContent")
    pip = ed.locator('.lane .item.pip').first
    pb = pip.bounding_box()
    ed.mouse.move(pb['x'] + pb['width'] / 2, pb['y'] + pb['height'] / 2)
    ed.mouse.down(); ed.mouse.move(pb['x'] + pb['width'] / 2 + 60, pb['y'] + pb['height'] / 2, steps=6); ed.mouse.up()
    time.sleep(0.3)
    pb2 = ed.locator('.lane .item.pip').first.bounding_box()
    assert pb2['x'] > pb['x'] + 40, (pb, pb2)
    step(f"P added picture-in-picture ({ed.locator('.lane .item.pip').first.inner_text().strip()}); dragged it {pb2['x'] - pb['x']:.0f}px later")

    # layer priority: move the overlay track below the Program and back
    ed.click('[data-down="t-ov1"]'); time.sleep(0.2)
    order = ed.eval_on_selector_all('#heads .head[data-track]', 'e => e.map(x => x.dataset.track)')
    assert order.index('t-ov1') > order.index('t-prog'), order
    ed.click('[data-up="t-ov1"]'); time.sleep(0.2)
    order = ed.eval_on_selector_all('#heads .head[data-track]', 'e => e.map(x => x.dataset.track)')
    assert order.index('t-ov1') < order.index('t-prog'), order
    step(f'▼/▲ changed layer priority and back: {order}')

    # mixer: camera sound fader
    ed.fill('#mixer [data-strip="t-cam"] input[type=range]', '-6'); ed.dispatch_event('#mixer [data-strip="t-cam"] input[type=range]', 'input'); time.sleep(0.2)
    g = ed.evaluate("JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e'))).tracks.find(t => t.id === 't-cam').gain")
    assert abs(g - 10 ** (-6 / 20)) < 0.01, g
    step(f'mixer fader set Camera sound to -6 dB (gain {g:.3f})')

    with ed.expect_download(timeout=420000) as dl:   # (the live studio keeps running beside it now)
        ed.click('#renderBtn')
    out = '/tmp/e2e-editor.mp4'
    dl.value.save_as(out)
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_frames:format=duration', '-of', 'json', out], capture_output=True, text=True).stdout)
    dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', out, '-f', 'null', '-'], capture_output=True, text=True)
    assert not dec.stderr.strip(), dec.stderr[:300]
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(both + 2.3), '-i', out, '-frames:v', '1', '/tmp/e2e-editor-pip.png'])
    v = [s for s in pr['streams'] if s['codec_type'] == 'video'][0]
    step(f"rendered {v['codec_name']} {v['width']}x{v['height']}, {float(pr['format']['duration']):.2f}s, decodes cleanly; frame saved with the PiP")
    ed.screenshot(path='/tmp/v05-editor.png')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
