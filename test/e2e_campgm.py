# Cameras watching the program: each camera in the show gets the program, small and silent, in a
# box beside its record button while it isn't on air; on air the box steps aside and nothing is
# sent. Tapping it watches full screen: the camera's live picture pauses and the studio shows
# WATCHING; the director's messages still come up over it; clicking that camera in the studio
# calls them back (it isn't cut to); Back to camera and they're live again. The box tucks away
# (nothing sent), only so many cameras get it (4 to start with, lowest numbers first), and a camera
# that leaves loses it.
# Run: node dev/server.mjs &  then  python3 test/e2e_campgm.py
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PHONE = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)
TILE = "[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === %r)"
# what the studio is sending each camera's program screen
CAMLINKS = """(() => { const h = vmDisplayHub(); return [...h.links.values()].filter((l) => h.keys.get(l.key)?.cam).map((l) => ({
  name: h.keys.get(l.key).name, mode: h.keys.get(l.key).mode, big: !!l.big, connected: l.pc?.connectionState === 'connected',
  video: !!l.pc?.getSenders().some((s) => s.track?.kind === 'video'), audio: !!l.pc?.getSenders().some((s) => s.track?.kind === 'audio'),
  scale: l.pc?.getSenders().map((s) => s.getParameters().encodings?.[0]?.scaleResolutionDownBy).find(Boolean) || null })); })()"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Watch test'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0'); localStorage.removeItem('vm_camwatch'); localStorage.removeItem('vm_camwatch_max')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    assert host.input_value('#camsWatch') == '4'
    ph = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent=PHONE).new_page()
        c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000)
    rosa, dev = ph['Rosa'], ph['Dev']

    # Rosa on air, Dev off
    host.evaluate(f"{TILE % 'Rosa'}.click()")
    rosa.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
    dev.wait_for_function("vmPgm().box && vmPgm().linked && document.querySelector('#pgmVideo').videoWidth > 0", timeout=30000)
    w, h, audio = dev.evaluate("(() => { const v = document.querySelector('#pgmVideo'); return [v.videoWidth, v.videoHeight, v.srcObject.getAudioTracks().length]; })()")
    assert audio == 0, 'a camera never gets the program sound'
    box = dev.locator('#pgmBox').bounding_box(); shutter = dev.locator('#shutter').bounding_box()
    assert box['x'] > shutter['x'] + shutter['width'] and box['y'] + box['height'] > shutter['y'], (box, shutter)
    assert box['x'] + box['width'] <= 390 and box['y'] + box['height'] <= 844
    step(f"off air, Dev's camera shows the program in a {box['width']:.0f}x{box['height']:.0f} box right of the record button ({w}x{h}, no sound)")

    rosa.wait_for_function("vmPgm().key && !vmPgm().box && vmPgm().wanted === 'idle'", timeout=10000)
    links = host.evaluate(CAMLINKS)
    rl = next(l for l in links if l['name'].startswith('Rosa'))
    dl = next(l for l in links if l['name'].startswith('Dev'))
    assert not rl['video'] and not rl['audio'] and dl['video'] and not dl['audio'] and dl['scale'] == 4, links
    tvs = host.inner_text('#tvList')
    assert 'Rosa' not in tvs and 'Dev' not in tvs, tvs
    step('on air, Rosa has no box and the studio sends her nothing; Dev gets a quarter-size picture, never sound; neither is listed as a TV')

    # Dev watches full screen
    dev.click('#pgmOpen')
    dev.wait_for_function("vmPgm().watching && !document.querySelector('#pgmWatch').hidden && document.querySelector('#pgmBig').videoWidth > 0", timeout=10000)
    host.wait_for_function(f"{TILE % 'Dev'}.querySelector('.pz')?.textContent.startsWith('WATCHING')", timeout=8000)
    host.wait_for_function(f"(() => {{ const l = ({CAMLINKS}).find((l) => l.name.startsWith('Dev')); return l && l.big && l.scale === 2; }})()", timeout=8000)
    sub = dev.inner_text('#pgmWatchSub')
    assert dev.is_hidden('#pausedTag') and 'Watching the program' in dev.evaluate("document.querySelector('#lsState').textContent")
    step(f'Dev tapped it: the program full screen ("{sub}"), sent at half size; the studio shows WATCHING on their tile')

    # the director's message comes up over it
    host.fill('#dmAll', 'Cake in five'); host.press('#dmAll', 'Enter')
    dev.wait_for_selector('#dm:not([hidden])', timeout=6000)
    top = dev.evaluate("document.elementFromPoint(195, document.querySelector('#dm').getBoundingClientRect().top + 20).closest('#dm') !== null")
    assert top, 'the message is over the program'
    dev.click('#dm [data-dmclose]')
    step('a message to every camera comes up over the program, and can be dismissed')

    # clicking Dev in the studio calls them back; it doesn't cut to them
    host.evaluate(f"{TILE % 'Dev'}.click()")
    dev.wait_for_function("vmPgm().call && !document.querySelector('#pgmCall').hidden", timeout=6000)
    assert rosa.evaluate("document.querySelector('#camView').classList.contains('onair')")
    call = dev.inner_text('#pgmCall')
    step(f'clicking Dev\'s camera in the studio called them back ("{call}"), and Rosa stayed on air')

    dev.click('#pgmBack')
    host.wait_for_function(f"!{TILE % 'Dev'}.classList.contains('paused')", timeout=8000)
    dev.wait_for_function("!vmPgm().watching && vmPgm().box && vmPgm().wanted === 'small'", timeout=8000)
    host.evaluate(f"{TILE % 'Dev'}.click()")
    dev.wait_for_function("document.querySelector('#camView').classList.contains('onair')", timeout=10000)
    dev.wait_for_function("!vmPgm().box && vmPgm().wanted === 'idle'", timeout=5000)
    rosa.wait_for_function("vmPgm().box", timeout=15000)
    step('Back to camera: Dev is live again and can be cut to; on air their box steps aside, and Rosa, off air, has hers')

    # tucked away: nothing sent
    rosa.click('#pgmHide')
    rosa.wait_for_function("!vmPgm().box && vmPgm().tab && vmPgm().wanted === 'idle'", timeout=5000)
    host.wait_for_function(f"!({CAMLINKS}).find((l) => l.name.startsWith('Rosa')).video", timeout=5000)
    rosa.reload(); rosa.wait_for_selector('#joinView:not([hidden])', timeout=10000); rosa.click('#joinForm button[type=submit]')
    rosa.wait_for_selector('#camView.on', timeout=20000)
    rosa.wait_for_function("vmPgm().key && vmPgm().tab && !vmPgm().box", timeout=20000)
    rosa.click('#pgmTab')
    rosa.wait_for_function("vmPgm().box", timeout=15000)
    step('× tucks the box away (the studio stops sending it), remembered after a reload; Program brings it back')

    # only so many cameras: the lowest numbers first
    num = lambda n: int(host.evaluate(f"{TILE % n}.querySelector('.n').textContent"))
    first, second = (rosa, dev) if num('Rosa') < num('Dev') else (dev, rosa)
    host.fill('#camsWatch', '1'); host.dispatch_event('#camsWatch', 'change')
    second.wait_for_function("!vmPgm().key && !vmPgm().box && !vmPgm().tab", timeout=8000)
    assert first.evaluate("vmPgm().key")
    host.wait_for_function(f"({CAMLINKS}).length === 1", timeout=8000)
    host.fill('#camsWatch', '0'); host.dispatch_event('#camsWatch', 'change')
    first.wait_for_function("!vmPgm().key", timeout=8000)
    host.wait_for_function(f"({CAMLINKS}).length === 0", timeout=8000)
    host.fill('#camsWatch', '4'); host.dispatch_event('#camsWatch', 'change')
    rosa.wait_for_function("vmPgm().box", timeout=20000)
    dev.wait_for_function("vmPgm().key", timeout=20000)
    step('cameras watching: up to 4 to start with; at 1 only the lowest-numbered camera keeps it, at 0 none, back at 4 both again')

    # a camera that leaves loses its key
    rosa.click('#camTitle'); rosa.wait_for_selector('#linkSheet[open]')
    rosa.click('#leaveBtn')
    host.wait_for_function("![...vmDisplayHub().keys.values()].some((k) => k.cam && k.name.startsWith('Rosa'))", timeout=20000)
    # at 1, with Rosa gone, Dev moves up and gets it
    host.fill('#camsWatch', '1'); host.dispatch_event('#camsWatch', 'change')
    dev.wait_for_function("vmPgm().key", timeout=10000)
    assert not rosa.evaluate("vmPgm().key")
    step('Rosa left: her program screen is gone from the studio, and the next camera in line has a place')

    assert not errors, errors
    step('no page errors')
    b.close()
