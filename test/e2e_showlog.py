# The show log and the sound watch, with a camera and a microphone on the studio computer:
# every second is logged (program frame rate, sound, each source's sound and frames, the mic a
# camera's sound comes from), and Monitor draws the last ten minutes. When the microphone lets
# go of its sound for good (a USB interface that drops out and doesn't come back: the studio
# keeps trying to open it again) with the camera's own sound off by hand, the studio says so under Notifications (the bell), not over the program or on the phone remote, and offers the camera's sound
# instead; turning it on clears the program alert. Save show log makes one file with all of
# it, and the log of an earlier studio session is still there in Monitor after a reload.
# Run: node dev/server.mjs &  then  python3 test/e2e_showlog.py
import os, json, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'], accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Class'})})).json()""")
    studio = f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}"
    host.goto(studio)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.click('#localList [data-add="mic"] >> nth=0'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=10000)
    host.click('#localDlg form button')
    host.click('.tile[data-peer^="local-cam"]')
    host.wait_for_function("vmShowLog().rows.length >= 4", timeout=15000)
    sl = host.evaluate('vmShowLog()')
    row = sl['rows'][-1]
    cam = next(s for s in row['s'] if s['k'] == 'cam'); mic = next(s for s in row['s'] if s['k'] == 'mic')
    assert 15 <= row['fps'] <= 40 and row['vis'] == 'v' and row['sock'] == 1 and row['ctx'] == 'running', row
    # Chromium's fake mic beeps with silence between, so one snapshot can land in a gap: the loudest of the last few.
    loudest = max(s['db'] for r in sl['rows'][-4:] for s in r['s'] if s['id'] == mic['id'])
    assert mic['a'] == 'live' and mic['open'] == 1 and loudest > -90 and mic.get('sr'), (loudest, mic)
    assert cam['a'] == 'live' and cam['open'] == 0 and cam.get('mic') and (cam.get('vf') or cam.get('vp')), cam
    kinds = {e['kind'] for e in sl['events']}
    assert {'source', 'air'} <= kinds, kinds
    joined = next(e['text'] for e in sl['events'] if e['kind'] == 'source' and 'camera' in e['text'])
    step(f"every second logged: program {row['fps']} fps, the mic in the mix at {mic['db']} dB ({mic['sr']} Hz), the camera's frames ({cam.get('vf') or cam.get('vp')}/s) and whose sound it has: \"{joined}\"")

    mon = ctx.new_page(); mon.on('pageerror', lambda e: errors.append(f'monitor: {e}'))
    mon.goto(f"{BASE}/monitor?e={ev['id']}")
    mon.wait_for_function("document.querySelector('#slLines').textContent.includes('Program picture')", timeout=15000)
    drawn = mon.evaluate("(() => { const c = document.querySelector('#slFps'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) n += d[i] > 0; return n; })()")
    host.evaluate('vmShowLogFlush()')
    mon.wait_for_function("document.querySelector('#slSessions').textContent.includes('open now')", timeout=70000)
    assert drawn > 50, drawn
    step(f"Monitor draws the last ten minutes ({drawn} pixels of frame rate), the summary, and lists this session as kept on this computer")

    # the camera's own sound turned OFF by hand (as the other mics were in the class), then the
    # microphone lets go of its sound, with nothing else in the mix
    for _ in range(3):   # (Shift+1: AFV, ON, OFF; set by hand, it stays off after the mic goes)
        host.keyboard.press('Shift+Digit1'); time.sleep(0.2)
    notes = host.evaluate("vmNotes()")[:6]
    assert next(n for n in notes if 'sound: ' in n).endswith('sound: OFF'), notes
    # (and it's really gone: opening it again fails, so the studio keeps trying while the alerts say so)
    host.evaluate("() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Requested device not found', 'NotFoundError'); }; }")
    host.evaluate(f"vmEndSound('{mic['id']}')")
    # nothing over the program: the bell in the top bar counts them, red until they're looked at
    host.wait_for_selector('#notifCount.new:not([hidden])', timeout=5000)
    assert host.query_selector('#soundAlert') is None
    first = host.evaluate('vmNotifs()')['now'][0]
    assert 'its sound stopped' in first, first
    host.wait_for_function("vmNotifs().now.includes('The program has no sound') && vmNotifs().badge === 2", timeout=8000)
    rs = host.evaluate('vmRemoteState()')
    assert 'alerts' not in rs and 'backups' not in rs, rs   # (the phone remote doesn't show them)
    host.click('#notifBtn'); host.wait_for_selector('#notifPop:popover-open', timeout=3000)
    shown = host.inner_text('#notifList')
    assert 'its sound stopped' in shown and 'The program has no sound' in shown, shown
    assert not host.evaluate('vmNotifs().fresh')   # (looked at: the count goes grey)
    btn = host.inner_text(f'#notifList [data-sound-on="{cam["id"]}"]')
    step(f'the mic dropping out: the bell counts "{first}", then the program alert; nothing over the program or on the phone remote; Notifications lists both and offers "{btn}"')

    host.click(f'#notifList [data-sound-on="{cam["id"]}"]')
    host.wait_for_function("!vmShowLog().alerts.some(a => a.kind === 'program-silent')", timeout=8000)
    host.wait_for_function("vmNotifs().earlier.includes('The program has no sound')", timeout=5000)
    left = host.evaluate('vmNotifs()')['now']
    assert 'The program has no sound' not in left, left
    kinds = [e['kind'] for e in host.evaluate('vmShowLog()')['events']]
    assert 'alert' in kinds and 'alert-action' in kinds and 'alert-clear' in kinds, kinds
    host.keyboard.press('Escape'); host.wait_for_function("!document.querySelector('#notifPop').matches(':popover-open')", timeout=3000)
    step(f"{btn}: the camera's sound is in the program and that alert moved to Earlier (still now: {left or 'nothing'}); the log has the alert, the fix and the clearing")

    with host.expect_download() as dl:
        host.click('#slSave')
    f = json.load(open(dl.value.path()))
    lines = '\n'.join(f['summary']['lines'])
    assert f['kind'] == 'vuemesh-showlog' and f['eventId'] == ev['id'] and len(f['rows']) >= 8 and f['device']['browser'], list(f)
    assert 'its sound stopped' in lines and 'The program has no sound (for' in lines, lines
    step(f"Save show log: {dl.value.suggested_filename}, {len(f['rows'])} seconds and {len(f['events'])} events, its summary saying what happened:\n      " + '\n      '.join(f['summary']['lines']))

    # the studio reopens: the earlier session is still kept, and Monitor saves it
    first_session = host.evaluate('vmShowLog().rows[0].t')
    host.reload()   # (goto the same address with the same #key is no reload)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.wait_for_function(f"vmShowLog().rows.length >= 2 && vmShowLog().rows[0].t > {first_session}", timeout=10000)
    host.evaluate('vmShowLogFlush()')
    mon.reload()
    mon.wait_for_function("document.querySelectorAll('#slSessions [data-sl-save]').length >= 2", timeout=20000)
    with mon.expect_download() as dl2:
        mon.click('#slSessions [data-sl-save] >> nth=1')
    g = json.load(open(dl2.value.path()))
    assert g['kind'] == 'vuemesh-showlog' and len(g['rows']) >= 8 and any(e['kind'] == 'alert' for e in g['events']), (len(g['rows']), len(g['events']))
    step(f"after a reload the earlier session is still kept: Monitor lists both and saves the earlier one ({len(g['rows'])} seconds, with its alerts)")

    assert not errors, errors
    b.close()
