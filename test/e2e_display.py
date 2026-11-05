# TV screens: a browser at /tv joins the event as a "display" (the Apple TV app's protocol), waits
# until the studio accepts it, then shows the program, straight from the studio. The studio can put
# it on the event card and back; a reload comes back without asking; a second screen is let in with
# Accept too (there's no TV code); codes paste in whole; Remove sends it back to waiting; full
# screen; Leave goes back to the code screen. Monitor's Transfers lists the TVs going out. Browse
# pulls a recording and plays it; PIP; Beacon runs on the studio's clock and takes the TV's lag.
# Run: node dev/server.mjs &  then  python3 test/e2e_display.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
PASTE = "(el, v) => { const dt = new DataTransfer(); dt.setData('text/plain', v); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }"
PLAYING = "(() => { const v = document.querySelector('#out'); return !v.hidden && v.readyState >= 2 && v.videoWidth > 0; })()"
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'TV show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Ana'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length >= 1", timeout=120000)
    assert host.inner_text('#tvEventCode') == ev['id'] and not host.query_selector('#tvCodeBtn')
    step(f"studio up with a camera; TV screens says to enter {ev['id']} on the TV")

    tvctx = b.new_context(viewport={'width': 1280, 'height': 720})
    tv = tvctx.new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
    tv.goto(f"{BASE}/tv")
    tv.locator('#eventCells input').first.evaluate(PASTE, f" {ev['id'].lower()} ")   # (pasted, as copied: spaces, lower case)
    assert ''.join(tv.locator('#eventCells input').nth(i).input_value() for i in range(6)) == ev['id']
    step('the event code pasted into the first cell fills all six')
    tv.fill('#screenName', 'Hall TV'); tv.click('#joinForm button[type=submit]')
    tv.wait_for_function("document.querySelector('#waitSay').textContent.includes('accept')", timeout=30000)
    host.wait_for_function("document.querySelector('#tvList').textContent.includes('Hall TV') && !!document.querySelector('[data-tv-accept]')", timeout=20000)
    assert not tv.is_visible('#out')
    step('the TV joins with the event code and waits; the studio lists "Hall TV wants to show the program"; nothing shows yet')

    host.click('[data-tv-accept]')
    tv.wait_for_function(PLAYING, timeout=30000)
    host.wait_for_function("document.querySelector('#tvList').textContent.includes('showing')", timeout=20000)
    route = tv.inner_text('#umdRoute')
    step(f"Accept: the TV shows the program ({tv.evaluate('document.querySelector(\"#out\").videoWidth')} px wide, {route.strip('· ')}), the studio says showing")

    host.select_option('[data-tv-mode]', 'idle')
    tv.wait_for_function("document.querySelector('#waitSay').textContent.includes('standby') && document.querySelector('#out').hidden", timeout=15000)
    host.select_option('[data-tv-mode]', 'program')
    tv.wait_for_function(PLAYING, timeout=15000)
    step('Event card puts the TV on standby; Program brings the picture back without a new connection')

    tv.reload()
    tv.wait_for_function(PLAYING, timeout=40000)
    assert not host.query_selector('[data-tv-accept]')
    step('a reload comes straight back to the program (the key is remembered): no second Accept')

    tv2 = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); tv2.on('pageerror', lambda e: errors.append(f'tv2: {e}'))
    tv2.goto(f"{BASE}/tv")
    tv2.locator('#eventCells input').nth(3).evaluate(PASTE, f"{ev['id'][:3]}-{ev['id'][3:]}")   # (with a dash, into the fourth cell)
    assert ''.join(tv2.locator('#eventCells input').nth(i).input_value() for i in range(6)) == ev['id']
    tv2.click('#joinForm button[type=submit]')
    tv2.wait_for_function("document.querySelector('#waitSay').textContent.includes('accept')", timeout=30000)
    assert not tv2.query_selector('#pairBtn')
    host.wait_for_function("!!document.querySelector('[data-tv-accept]')", timeout=20000)
    host.click('[data-tv-accept]')
    tv2.wait_for_function(PLAYING, timeout=30000)
    host.wait_for_function("document.querySelectorAll('[data-tv-del]').length === 2", timeout=10000)
    step('a second screen waits too (no TV code to type) and Accept lets it in; two TVs listed, both showing')

    mon = ctx.new_page(); mon.on('pageerror', lambda e: errors.append(f'monitor: {e}'))
    mon.goto(f"{BASE}/monitor?e={ev['id']}")
    mon.wait_for_function("(() => { const o = document.querySelector('#xfOut').textContent, i = document.querySelector('#xfIn').textContent; return o.includes('Hall TV') && o.includes('TV screen') && /\\d\\.\\d+ Mbps/.test(o) && i.includes('Ana'); })()", timeout=30000)
    step(f"Monitor's Transfers: both TVs going out, with their rate ({mon.inner_text('#xfOut').splitlines()[0]}); Ana's picture coming in")
    mon.close()

    # ---- Browse (pulled over the media channel), PIP, Beacon (the studio's clock, led by the lag)
    with host.expect_download(timeout=120000):
        host.click('#recProgBtn'); time.sleep(4); host.click('#recProgBtn')
    host.wait_for_function("vmClipList().some((c) => c.program)", timeout=30000)
    host.keyboard.press('Escape')   # (the end-of-recording summary)
    tv2.click('#modes [data-want="browse"]')
    tv2.wait_for_function("vmTv().mode === 'browse' && document.querySelectorAll('#items [data-id]').length >= 1", timeout=15000)
    host.wait_for_function("[...document.querySelectorAll('[data-tv-mode]')].some((s) => s.value === 'browse')", timeout=10000)
    tv2.click('#items [data-id]')
    tv2.wait_for_function("!document.querySelector('#player').hidden && document.querySelector('#clip').readyState >= 2", timeout=60000)
    got = tv2.evaluate('vmTv()')
    assert got['open'] and got['open'] in got['cached'], got
    step('Browse, chosen on the TV (the studio follows): the program recording is listed, pulled over the media channel and plays on the TV')
    tv2.click('#playerBack')
    tv2.click('#pipBtn')
    tv2.wait_for_function("vmTv().pip && document.body.classList.contains('pip') && !document.querySelector('#out').hidden && document.querySelector('#out').videoWidth > 0", timeout=15000)
    assert host.is_checked('[data-tv-pip]')
    step('PIP: the live program in a corner over the recordings (the studio shows PIP ticked)')
    tv2.click('#modes [data-want="beacon"]')
    tv2.wait_for_function("vmTv().mode === 'beacon' && vmTv().samples >= 3 && !document.querySelector('#beaconHint').hidden", timeout=15000)
    off = tv2.evaluate('vmTv().clockOff')
    assert abs(off) < 50, off   # (one machine: both clocks are the same one)
    assert host.is_visible('[data-tv-cal]') and 'lag not measured' in host.inner_text('#tvList')
    key = host.evaluate("[...vmDisplayHub().keys].find(([, k]) => k.mode === 'beacon')[0]")
    host.evaluate("(k) => vmDisplayHub().setLag(k, 80)", key)
    tv2.wait_for_function("vmTv().lag === 80 && document.querySelector('#beaconHint').hidden", timeout=10000)
    assert '80 ms ahead' in host.inner_text('#tvList')
    step(f'Beacon: on the studio clock (offset {off:.1f} ms here), the game-mode hint until the lag is set; a lag of 80 ms reaches the TV')
    tv2.click('#modes [data-want="program"]')
    tv2.wait_for_function(PLAYING + " && vmTv().mode === 'program' && !document.body.classList.contains('pip')", timeout=15000)

    host.locator('[data-tv-del]').first.click(); host.locator('[data-tv-del]').first.click()  # (asked on the button: Sure? Remove)
    tv.wait_for_function("document.querySelector('#out').hidden && document.querySelector('#waitSay').textContent.length > 0", timeout=15000)
    host.wait_for_function("document.querySelectorAll('[data-tv-del]').length === 1", timeout=10000)
    assert tv2.evaluate(PLAYING)
    step('Remove stops that TV at once and it goes back to asking; the other keeps showing')

    assert tv2.is_visible('#fullBtn') and tv2.is_visible('#exitBtn')
    tv2.click('#fullBtn')
    tv2.wait_for_function("!!document.fullscreenElement && document.querySelector('#fullBtn').textContent === 'Exit full screen'", timeout=5000)
    tv2.click('#fullBtn')
    tv2.wait_for_function("!document.fullscreenElement", timeout=5000)
    step('Full screen takes the TV page full screen and back')
    tv2.click('#exitBtn')
    tv2.wait_for_function("!document.querySelector('#joinView').hidden && document.querySelector('#out').hidden && !location.search", timeout=10000)
    host.wait_for_function("!document.querySelector('#tvList').textContent.includes('showing')", timeout=20000)
    step('Leave takes the TV back to the code screen and the studio stops showing to it')

    assert not errors, errors
    step('no page errors')
    b.close()
print('\nTV screens test passed.')
