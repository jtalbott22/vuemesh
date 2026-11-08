# Live numbers and a TV under Notifications. A show used again and again had handed out a number
# per device for good, so its fifth source was 10, which no key can reach. In Live, each source
# in the show now holds the lowest number free when it came in, and keeps it while it stays: one
# that leaves frees its number for the next, and a reload of the studio keeps them. Its keys
# follow (1-9). Edit keeps its own angle numbers (one per device for good, its clips are filed
# by them). And a TV asking to show the program is under Notifications (the bell) with Accept,
# not only in TV screens.
# Run: node dev/server.mjs &  then  python3 test/e2e_livenumbers.py
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
PASTE = "(el, v) => { const dt = new DataTransfer(); dt.setData('text/plain', v); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }"
PLAYING = "(() => { const v = document.querySelector('#out'); return !v.hidden && v.readyState >= 2 && v.videoWidth > 0; })()"
TILES = "document.querySelectorAll('.tile[data-peer] video').length"
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Numbers'})})).json()""")
    # (a show used before: nine devices already had angle numbers, so the next one's angle is 10)
    host.evaluate(f"""localStorage.setItem('vm_autorec_default', '0'); localStorage.setItem('vm_angles_{ev['id']}', JSON.stringify(['old1','old2','old3','old4','old5','old6','old7','old8','old9']))""")
    studio = f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}"
    host.goto(studio)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)

    phones = {}
    def join(name):
        n = host.evaluate(TILES)
        c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE)
        pg = c.new_page(); pg.on('pageerror', lambda e: errors.append(f'{name}: {e}')); pg.on('dialog', lambda d: d.accept())
        pg.goto(f"{BASE}/cam?e={ev['id']}"); pg.fill('#name', name); pg.check('#agreeGuest'); pg.click('#joinForm button[type=submit]')
        host.wait_for_function(f"{TILES} === {n + 1}", timeout=30000)
        phones[name] = c
    for name in ['Ana', 'Ben', 'Cy']:
        join(name)
    nos = host.evaluate('vmLiveNos()')
    assert nos == {'Ana': 1, 'Ben': 2, 'Cy': 3}, nos
    tiles = host.evaluate("[...document.querySelectorAll('.tile[data-peer]')].map(t => [t.querySelector('.who').textContent, t.querySelector('.n').textContent])")
    assert sorted(tiles) == [['Ana', '1'], ['Ben', '2'], ['Cy', '3']], tiles
    step(f'in a show whose devices had numbers up to 9, three phones are 1, 2 and 3 on their tiles: {nos}')

    phones.pop('Ben').close()
    host.wait_for_function(f"{TILES} === 2", timeout=30000)
    join('Dee')
    nos = host.evaluate('vmLiveNos()')
    assert nos == {'Ana': 1, 'Cy': 3, 'Dee': 2}, nos
    step(f'Ben leaves: the others keep theirs; Dee, joining next, takes the free 2: {nos}')

    host.keyboard.press('2'); host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Dee')", timeout=5000)
    host.keyboard.press('3'); host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Cy')", timeout=5000)
    label = host.inner_text('#progLabel')
    assert '3 Cy' in label, label
    cuts = [n for n in host.evaluate('vmNotes()') if 'Cut:' in n]
    assert any('camera 2 (Dee)' in t for t in cuts) and any('camera 3 (Cy)' in t for t in cuts), cuts
    step(f'the keys follow: 2 cuts to Dee, 3 to Cy ("{label}"); the log says {cuts[-2:]}')

    host.reload()
    host.wait_for_function(f"{TILES} === 3", timeout=60000)
    nos2 = host.evaluate('vmLiveNos()')
    assert nos2 == nos, (nos2, nos)
    step(f'after a reload of the studio, every phone has its number again: {nos2}')

    # a TV asking to show the program: on the bell, with Accept there
    tv = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
    tv.goto(f"{BASE}/tv")
    tv.locator('#eventCells input').first.evaluate(PASTE, ev['id'])
    tv.fill('#screenName', 'Hall TV'); tv.click('#joinForm button[type=submit]')
    tv.wait_for_function("document.querySelector('#waitSay').textContent.includes('accept')", timeout=30000)
    host.wait_for_function("vmNotifs().tvs.includes('Hall TV') && vmNotifs().badge === 1 && vmNotifs().fresh", timeout=20000)
    assert 'Hall TV' in host.get_attribute('#notifBtn', 'aria-label') or '1 TV asking' in host.get_attribute('#notifBtn', 'aria-label'), host.get_attribute('#notifBtn', 'aria-label')
    host.click('#notifBtn')
    host.wait_for_selector('#notifList [data-tv-accept]', timeout=5000)
    said = host.inner_text('#notifList li.tvask')
    assert 'Hall TV wants to show the program' in said, said
    step(f'a TV asks: the bell turns red ({host.get_attribute("#notifBtn", "aria-label")}), and Notifications has "{next(x for x in said.splitlines() if 'wants' in x)}" with Accept and Decline')
    host.click('#notifList [data-tv-accept]')
    tv.wait_for_function(PLAYING, timeout=30000)
    host.wait_for_function("!vmNotifs().tvs.length && !document.querySelector('#notifList li.tvask')", timeout=10000)
    assert 'Hall TV' in host.inner_text('#tvList')
    step('Accept there: the TV shows the program, the request leaves Notifications, and TV screens lists Hall TV')

    print()
    print('errors:', errors or 'none')
    assert not errors
    b.close()
