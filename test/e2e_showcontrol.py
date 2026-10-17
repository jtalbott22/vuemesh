# Show control, end to end: lower thirds you can delete and edit, fade/cut to black, the
# break slate's looks, moments renamed and deleted live, timeline markers dragged, renamed
# and deleted, a rundown that ends and clears on the phones, and the live-picture watchdog
# (a stopped or frozen player is restarted; refresh and reconnect by hand).
# Run: node dev/server.mjs &  then  python3 test/e2e_showcontrol.py
import os, sys, time, json
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)

BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

PIXEL = """(pt) => { const c = document.querySelector('#program'); const d = c.getContext('2d').getImageData(c.width * pt[0] | 0, c.height * pt[1] | 0, 1, 1).data; return [d[0], d[1], d[2]]; }"""
GRID = """() => { const c = document.querySelector('#program'), g = c.getContext('2d'), out = [];
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) { const d = g.getImageData(c.width * x / 5 | 0, c.height * y / 5 | 0, 1, 1).data; out.push(d[0], d[1], d[2]); } return out; }"""
FRAMES = "() => document.querySelector('.tile[data-peer] video').getVideoPlaybackQuality().totalVideoFrames"
diff = lambda a, b: sum(abs(x - y) for x, y in zip(a, b)) / len(a)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())

    host = b.new_context(viewport={'width': 1500, 'height': 950}).new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Rosa and Ben', kind:'wedding'})})).json()""")
    EID = ev['id']
    host.goto(f"{BASE}/studio?e={EID}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    rosa = b.new_context(permissions=['camera', 'microphone']).new_page(); watch(rosa, 'cam')
    rosa.goto(f"{BASE}/cam?e={EID}"); rosa.fill('#name', 'Rosa'); rosa.check('#agreeGuest'); rosa.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=20000)
    host.keyboard.press('1'); time.sleep(0.8)
    assert max(host.evaluate(PIXEL, [0.5, 0.5])) > 20
    step('studio up, camera 1 on air')

    # ---- lower thirds: × deletes one; right-click edits one without putting it on air
    host.fill('#ltText', 'Rosa Martinez'); host.fill('#ltSub', 'Maid of honour'); host.click('#ltShow'); time.sleep(0.3)
    host.click('#ltShow'); time.sleep(0.4)
    host.fill('#ltText', 'Ben Ortiz'); host.fill('#ltSub', 'Best man'); host.click('#ltShow'); time.sleep(0.3)
    pills = host.eval_on_selector_all('#ltRecent [data-lt]', 'els => els.map(e => e.textContent)')
    assert pills == ['Ben Ortiz', 'Rosa Martinez'], pills
    assert 'on' in host.get_attribute('#ltRecent .ltpill:first-child', 'class')
    host.click('#ltRecent [data-ltdel="1"]'); time.sleep(0.2)
    pills = host.eval_on_selector_all('#ltRecent [data-lt]', 'els => els.map(e => e.textContent)')
    stored = json.loads(host.evaluate(f"localStorage.getItem('vm_lt_{EID}')"))
    assert pills == ['Ben Ortiz'] and [x['text'] for x in stored] == ['Ben Ortiz'], (pills, stored)
    step(f'× deleted a saved lower third (left: {pills}; on air one outlined)')
    host.click('#ltShow'); time.sleep(0.5)  # hide Ben
    host.click('#ltRecent [data-lt="0"]', button='right'); host.click('.ctxmenu button:has-text("Edit it")')
    assert host.input_value('#ltText') == 'Ben Ortiz' and host.get_attribute('#ltShow', 'aria-pressed') == 'false'
    host.fill('#ltSub', 'Best man and brother'); host.click('#ltShow'); time.sleep(0.3)
    stored = json.loads(host.evaluate(f"localStorage.getItem('vm_lt_{EID}')"))
    assert len(stored) == 1 and stored[0]['sub'] == 'Best man and brother', stored
    step('right-click → Edit loaded it without airing it; showing the edit replaced it (no duplicate)')

    # ---- fade to black (X), cut to black (Shift+X)
    assert host.get_attribute('#ltShow', 'aria-pressed') == 'true'
    host.keyboard.press('x'); time.sleep(0.35)
    mid = host.inner_text('#progLabel')
    time.sleep(1.1)
    px = host.evaluate(PIXEL, [0.5, 0.5])
    assert mid == 'FADING TO BLACK' and host.inner_text('#progLabel') == 'BLACK' and max(px) < 6, (mid, px)
    assert host.get_attribute('#ftbBtn', 'aria-pressed') == 'true' and host.inner_text('#ftbBtn').startswith('Fade up')
    assert host.get_attribute('#ltShow', 'aria-pressed') == 'false'
    step(f'X faded to black ({mid} → BLACK, centre {px}); the lower third came off')
    host.keyboard.press('1'); time.sleep(0.4)
    assert max(host.evaluate(PIXEL, [0.5, 0.5])) < 6
    step('cutting to a camera while black waits for you to come back up')
    host.keyboard.press('x'); time.sleep(1.4)
    px = host.evaluate(PIXEL, [0.5, 0.5])
    assert max(px) > 20 and 'Rosa' in host.inner_text('#progLabel'), (px, host.inner_text('#progLabel'))
    step(f'X again faded back up on the camera ({host.inner_text("#progLabel")})')
    host.keyboard.press('Shift+X'); time.sleep(0.2)
    assert max(host.evaluate(PIXEL, [0.5, 0.5])) < 6 and host.get_attribute('#blackBtn', 'aria-pressed') == 'true'
    host.click('#blackBtn'); time.sleep(0.3)
    assert max(host.evaluate(PIXEL, [0.5, 0.5])) > 20 and not host.evaluate("document.querySelector('#progLabel').classList.contains('black')")
    step('Shift+X cut straight to black; Cut up came straight back')

    # ---- slate looks
    host.keyboard.press('b'); time.sleep(0.5)
    looks = host.eval_on_selector_all('#slateLook option', 'os => os.map(o => o.value)')
    sig = {}
    for look in looks:
        host.select_option('#slateLook', look); time.sleep(0.35)
        sig[look] = host.evaluate(GRID)
    for i, a in enumerate(looks):
        for c in looks[i + 1:]:
            assert diff(sig[a], sig[c]) > 8, (a, c, diff(sig[a], sig[c]))
    host.select_option('#slateLook', 'static'); time.sleep(0.2)
    s1 = host.evaluate(GRID); time.sleep(0.15); s2 = host.evaluate(GRID)
    assert diff(s1, s2) > 10, diff(s1, s2)
    host.select_option('#slateLook', 'vhs'); time.sleep(0.3)
    vb = host.evaluate(PIXEL, [0.5, 0.3])
    assert vb[2] > 150 and vb[0] < 80, vb
    prev = host.evaluate("(() => { const c = document.querySelector('#slatePrev'); const d = c.getContext('2d').getImageData(c.width/2|0, c.height*0.3|0, 1, 1).data; return [d[0], d[1], d[2]]; })()")
    assert prev[2] > 150, prev
    host.click('#slateSound'); time.sleep(0.4); host.select_option('#slateLook', 'bars'); time.sleep(0.4)
    assert host.evaluate(f"localStorage.getItem('vm_slatelook_{EID}')") == 'bars'
    host.evaluate('document.activeElement.blur()')
    host.keyboard.press('b'); time.sleep(0.5)
    assert host.is_hidden('#slateTag')
    step(f'break slate looks all distinct {looks}; static moves; VHS is blue; the preview follows; slate sound toggles')

    # ---- moments: rename and delete them live
    host.keyboard.press('m'); time.sleep(0.25); host.keyboard.press('m'); time.sleep(0.25)
    assert host.locator('#momList li').count() == 2 and host.is_hidden('#momEmpty')
    inp = host.locator('#momList li').nth(0).locator('input')
    assert inp.input_value() == 'Moment 2'
    inp.click(); inp.fill('First kiss'); inp.press('Enter'); time.sleep(0.3)
    labels = [m['label'] for m in json.loads(host.evaluate(f"localStorage.getItem('vm_media_{EID}')"))['moments']]
    assert sorted(labels) == ['First kiss', 'Moment 1'], labels
    host.locator('#momList li').nth(1).locator('[data-momdel]').click(); time.sleep(0.3)
    labels = [m['label'] for m in json.loads(host.evaluate(f"localStorage.getItem('vm_media_{EID}')"))['moments']]
    assert labels == ['First kiss'] and host.locator('#momList li').count() == 1, labels
    step(f'M twice → two moments listed live; renamed one in place, deleted the other with × ({labels})')

    # ---- rundown: Next on the last item ends it; Prev picks it up; End; Clear
    host.fill('#rundownText', 'Toasts\nCake'); host.click('#rundownSend'); time.sleep(0.4)
    host.click('#cueNext'); rosa.wait_for_selector('#cue:not([hidden])', timeout=6000)
    host.click('#cueNext'); time.sleep(0.4)
    assert 'Cake' in rosa.inner_text('#cueNow')
    host.click('#cueNext')
    rosa.wait_for_selector('#cue', state='hidden', timeout=6000)
    rd = rosa.evaluate(f"JSON.parse(localStorage.getItem('vm_rundown_{EID}'))")
    assert 'ended' in host.inner_text('#cueState') and rd['ended'] and rd['cue'] == 1, rd
    step('Next ▶ on the last item ended the rundown: off the phone screen, kept (ended at Cake) for My events')
    host.click('#cuePrev'); rosa.wait_for_selector('#cue:not([hidden])', timeout=6000)
    assert 'Cake' in rosa.inner_text('#cueNow')
    host.click('#rundownEnd'); rosa.wait_for_selector('#cue', state='hidden', timeout=6000)
    host.click('#rundownClear'); time.sleep(0.6)
    assert rosa.evaluate(f"localStorage.getItem('vm_rundown_{EID}')") is None and host.input_value('#rundownText') == ''
    step('Prev picked it back up; End took it off again; Clear emptied it on the studio and the phone')

    # ---- live pictures: the watchdog, then refresh and reconnect by hand
    host.evaluate("document.querySelector('.tile[data-peer] video').pause()")
    host.wait_for_function("!document.querySelector('.tile[data-peer] video').paused", timeout=6000)
    step('a tile player that stopped was started again by the watchdog')
    host.evaluate("""(() => { const v = document.querySelector('.tile[data-peer] video'); v.dataset.old = '1';
      Object.defineProperty(v, 'currentTime', { get: () => 4.2 }); v.getVideoPlaybackQuality = () => ({ totalVideoFrames: 100 }); })()""")
    host.wait_for_function("(() => { const v = document.querySelector('.tile[data-peer] video'); return v && !v.dataset.old && v.readyState >= 2; })()", timeout=15000)
    f1 = host.evaluate(FRAMES); time.sleep(1.2); f2 = host.evaluate(FRAMES)
    assert f2 > f1 and max(host.evaluate(PIXEL, [0.5, 0.5])) > 20, (f1, f2)
    step(f'a frozen tile (decoding, nothing shown) got a fresh player by itself; frames moving again ({f1} → {f2})')
    host.evaluate("document.querySelector('.tile[data-peer] video').dataset.old = '1'")
    host.click('.tile[data-peer]', button='right'); host.click('.ctxmenu button:has-text("Refresh picture")')
    host.wait_for_function("(() => { const v = document.querySelector('.tile[data-peer] video'); return v && !v.dataset.old && v.readyState >= 2; })()", timeout=8000)
    step('right-click → Refresh picture swapped in a new player')
    host.evaluate("document.querySelector('.tile[data-peer]').dataset.old = '1'")
    host.click('.tile[data-peer]', button='right'); host.click('.ctxmenu button:has-text("Reconnect phone")')
    host.wait_for_function("(() => { const t = document.querySelector('.tile[data-peer]'); return t && !t.dataset.old && t.querySelector('video').readyState >= 2; })()", timeout=20000)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Rosa')", timeout=10000)
    assert host.locator('.tile[data-peer]').count() == 1
    step('right-click → Reconnect phone rebuilt the link; the camera came back live and on air')

    # ---- markers in Edit: drag, rename, delete
    ed = edit_window(host.context, host, errors); time.sleep(0.6)   # (markers live in the Edit window)
    ruler = ed.locator('#tracks [data-ruler]').bounding_box()
    ed.mouse.click(ruler['x'] + 160, ruler['y'] + 12); time.sleep(0.2)
    ed.keyboard.press('m'); time.sleep(0.3)
    mk = ed.locator('.marker:not(.moment)').first
    assert ed.locator('.marker:not(.moment)').count() == 1
    mk.dblclick(); ed.wait_for_selector('.renamepop input', timeout=3000)
    ed.fill('.renamepop input', 'Vows'); ed.press('.renamepop input', 'Enter'); time.sleep(0.3)
    assert ed.inner_text('.mtag') == 'Vows'
    left = lambda: ed.evaluate("parseFloat(document.querySelector('.marker:not(.moment)').style.left)")
    x0 = left(); bb = ed.locator('.marker:not(.moment)').first.bounding_box()
    ed.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); ed.mouse.down()
    ed.mouse.move(bb['x'] + 60, bb['y'] + 5); ed.mouse.move(bb['x'] + 130, bb['y'] + 5); ed.mouse.up(); time.sleep(0.3)
    x1 = left()
    assert x1 > x0 + 80 and ed.inner_text('.mtag') == 'Vows', (x0, x1)
    ed.keyboard.press('Control+z'); time.sleep(0.3)
    assert abs(left() - x0) < 2
    step(f'double-click renamed a marker (shown on the ruler); dragged it {x0:.0f}px → {x1:.0f}px; undo put it back')
    ed.locator('.marker:not(.moment)').first.click(button='right')
    ed.click('.ctxmenu button:has-text("Delete this marker")'); time.sleep(0.3)
    assert ed.locator('.marker:not(.moment)').count() == 0
    ed.keyboard.press('Control+z'); time.sleep(0.3)
    ed.locator('.marker:not(.moment)').first.focus(); ed.keyboard.press('Delete'); time.sleep(0.3)
    assert ed.locator('.marker:not(.moment)').count() == 0
    step('right-click → Delete removed it; undo brought it back; Delete on the focused marker removed it again')

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
