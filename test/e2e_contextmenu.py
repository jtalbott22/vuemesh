# Editing like an editor, and recording while on air: cameras record when cut to (and stop
# after leaving air unless the shooter started it); right-click menus on timeline clips and
# sources; replace media in sync; picture-in-picture from the Source monitor; track targets
# for Insert; the keyboard way into menus; program meters beside the picture.
# Run: node dev/server.mjs &  then  python3 test/e2e_contextmenu.py
import os, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SEQ = "JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')))"
rec = lambda c: c.evaluate("document.querySelector('#shutter').classList.contains('rec')")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Editor night'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    ph = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.add_init_script("window.__msgs = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList?.contains('toast') && window.__msgs.push(new Date().toTimeString().slice(0, 8) + ' ' + n.textContent)))).observe(document, { childList: true, subtree: true });")
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000); time.sleep(1)
    rosa, dev = ph['Rosa'], ph['Dev']
    tile = lambda n: host.locator('.tile[data-peer]', has=host.locator(f'.who:text-is("{n}")'))
    assert host.is_checked('#autoRec')

    tile('Rosa').click(); rosa.wait_for_function("document.querySelector('#shutter').classList.contains('rec')", timeout=6000)
    step('cut to Rosa (not recording): her phone started recording — "Recording: you\'re on air"')
    time.sleep(3)
    tile('Dev').click(); dev.wait_for_function("document.querySelector('#shutter').classList.contains('rec')", timeout=6000)
    time.sleep(3); still = rec(rosa)
    rosa.wait_for_function("!document.querySelector('#shutter').classList.contains('rec')", timeout=10000)
    step(f'cut to Dev: he started; Rosa kept rolling for a few seconds off air ({still}), then stopped by herself')

    rosa.evaluate("document.querySelector('#shutter').click()")   # Rosa starts recording herself
    time.sleep(1); tile('Rosa').click(); time.sleep(2); tile('Dev').click(); time.sleep(10)
    assert rec(rosa)
    step('Rosa started recording herself: going on and off air never stops it (the shooter\'s choice wins)')
    before = [rec(dev), dev.evaluate("document.querySelector('#camView').classList.contains('onair')")]
    dev.evaluate("document.querySelector('#shutter').click()")    # Dev stops while on air
    time.sleep(6)
    if rec(dev):
        print('DEBUG Dev before tap [recording, on air]:', before)
        print('DEBUG Dev messages:', dev.evaluate("window.__msgs || []"))
    assert not rec(dev)
    # a blip off air (the break slate for a moment, as during a Wi-Fi hiccup) mustn't undo that
    host.locator('body').click(position={'x': 700, 'y': 300}); host.keyboard.press('b'); time.sleep(1.2); host.keyboard.press('b'); time.sleep(6)
    if rec(dev): print('DEBUG Dev messages after the blip:', dev.evaluate("window.__msgs || []"))
    assert not rec(dev)
    rosa.evaluate("document.querySelector('#shutter').click()")
    step('Dev stopped while on air: it stays stopped, even through a moment off air (the break slate) and back')
    host.wait_for_function("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length >= 3); }; }))()", timeout=40000); time.sleep(2)

    pm, cv = host.locator('#pMeters').bounding_box(), host.locator('#program').bounding_box()
    assert pm['x'] >= cv['x'] + cv['width'] - 1
    ed = edit_window(host.context, host, errors); time.sleep(1.2)
    pm2, cv2 = ed.locator('#pMeters').bounding_box(), ed.locator('#program').bounding_box()
    assert pm2 and pm2['x'] >= cv2['x'] + cv2['width'] - 1
    ed.click('#meterTgl'); time.sleep(0.3)
    assert ed.locator('#pMeters').is_hidden()
    ed.click('#meterTgl')
    step('program L/R meters sit beside the picture in Live and Edit (never over it); ♪ toggles them')

    items = ed.evaluate(SEQ + ".tracks.find(t => t.program).items.map(i => i.src)")
    # find a program segment where another camera was also rolling
    idx = ed.evaluate(f"""(() => {{ const s = {SEQ}; const clips = []; return null; }})()""")
    target = None
    for i in range(len(items)):
        ed.locator('[data-lane="t-prog"] .item').nth(i).click(button='right'); time.sleep(0.3)
        ed.locator('.ctxmenu:not([hidden]) button:has-text("Replace media with")').hover(); time.sleep(0.3)
        opts = ed.eval_on_selector_all('.ctxmenu:not([hidden]) >> nth=1 >> button', 'e => e.map(x => [x.textContent.trim(), x.getAttribute("aria-disabled")])')
        live = [o for o in opts if o[1] != 'true' and 'Camera' in o[0]]
        if live:
            target = (i, live[0][0]); break
        ed.keyboard.press('Escape')
    assert target, 'no segment with another camera rolling'
    i, label = target
    before = ed.evaluate(SEQ + f".tracks.find(t => t.program).items[{i}]")
    ed.locator('.ctxmenu:not([hidden]) >> nth=1 >> button', has_text=label).first.click(); time.sleep(0.4)
    after = ed.evaluate(SEQ + f".tracks.find(t => t.program).items[{i}]")
    assert after['src'] != before['src'] and after['start'] == before['start'], (before, after)
    step(f'right-click → Replace media with → "{label}": same place on the timeline, new camera, same moment')

    # speed: half speed from the right-click menu
    first = ed.evaluate(SEQ + ".tracks.find(t => t.program).items.slice().sort((a, b) => a.start - b.start)[0]")
    ed.locator(f'[data-item="{first["id"]}"]').click(button='right'); time.sleep(0.3)
    ed.locator('.ctxmenu:not([hidden]) button:has-text("Speed")').hover(); time.sleep(0.3)
    ed.locator('.ctxmenu:not([hidden]) >> nth=1 >> button', has_text='50%').first.click(); time.sleep(0.5)
    slow = ed.evaluate(SEQ + f".tracks.find(t => t.program).items.find(i => i.id === '{first['id']}')")
    label = ed.locator(f'[data-item="{first["id"]}"]').inner_text()
    # (it stretches where there's room; against the next clip it holds its length and shows half as much)
    stretched = slow['dur'] > first['dur'] * 1.2
    msg = next((t for t in ed.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)') if 'Speed 50%' in t), '')
    assert slow['speed'] == 0.5 and '50%' in label and (stretched or 'fit before the next clip' in msg), (first, slow, label, msg)
    ed.locator('body').click(position={'x': 800, 'y': 360}); ed.keyboard.press('Home')
    if first['start'] > 1: ed.keyboard.press('ArrowDown')   # the first edit point is the slowed clip's start
    for _ in range(3): ed.keyboard.press('ArrowRight')
    ed.keyboard.press('Space'); time.sleep(1.2)
    rates = ed.evaluate("[...document.querySelectorAll('video')].filter(v => v.src.startsWith('blob:') && !v.paused).map(v => +v.playbackRate.toFixed(3))")
    ed.keyboard.press('Space')
    assert rates and min(abs(r - 0.5) for r in rates) < 0.06, rates
    step(f"Speed → 50%: labelled \"{label.strip()}\", plays at half rate ({rates}); {'stretched to ' + str(round(slow['dur'] / 1000, 1)) + ' s' if stretched else 'held to its slot against the next clip: ' + repr(msg)}")
    ed.keyboard.press('Control+z'); time.sleep(0.3)

    ed.click('#leftMedia') if ed.locator('#leftMedia').count() else ed.click('text=Media')
    time.sleep(0.4)
    ed.locator('#mediaList [data-kind="clip"]').first.click(); time.sleep(0.6)
    src_clip = ed.evaluate("document.querySelector('#mediaList [data-kind=\"clip\"]').dataset.id")
    ed.click('#progTab'); ed.locator('body').click(position={'x': 800, 'y': 360})
    ed.keyboard.press('Home'); ed.keyboard.press('Shift+P'); time.sleep(0.5)
    ov = ed.evaluate(SEQ + ".tracks.filter(t => t.kind === 'video' && !t.program).flatMap(t => t.items).map(i => i.src)")
    assert src_clip in ov, (src_clip, ov)
    step('picture-in-picture uses the clip loaded in the Source monitor (no more random pick)')

    ovl = ed.evaluate(SEQ + ".tracks.find(t => t.kind === 'video' && !t.program).id")
    ed.click(f'[data-target="{ovl}"]'); time.sleep(0.3)
    n0 = ed.evaluate(SEQ + f".tracks.find(t => t.id === '{ovl}').items.length")
    ed.locator('#mediaList [data-kind="clip"]').first.click(button='right'); time.sleep(0.3)
    ed.locator('.ctxmenu:not([hidden]) button:has-text("Insert at playhead")').click(); time.sleep(0.5)
    n1 = ed.evaluate(SEQ + f".tracks.find(t => t.id === '{ovl}').items.length")
    assert n1 == n0 + 1, (n0, n1)
    step('targeted the overlay track (◉ on its header); a media item\'s right-click → Insert at playhead landed there')

    ed.locator('[data-lane="t-prog"] .item').first.focus(); ed.keyboard.press('Shift+F10'); time.sleep(0.3)
    focused = ed.evaluate("document.activeElement.closest('.ctxmenu') ? document.activeElement.textContent.trim() : null")
    ed.keyboard.press('Escape'); time.sleep(0.2)
    closed = ed.locator('.ctxmenu:not([hidden])').count() == 0
    assert focused and closed, (focused, closed)
    step(f'keyboard: Shift+F10 on a clip opens its menu (focus on "{focused}"), Esc closes it')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
