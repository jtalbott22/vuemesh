# The phone remote: the studio shows a pairing code only when asked (Phone remote > Add a phone);
# a phone that scans it becomes a remote, sees the cameras by name (and their pictures), and can
# cut, run the auto-director, break, fade to black and back, and start and stop Record program.
# A wrong code is turned away, a used one can't be used again, five wrong tries stop the pairing,
# and a made-up key gets nothing. A reload carries on; Remove in the studio unpairs it at once.
# Run: node dev/server.mjs &  then  python3 test/e2e_remote.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Remote show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    for name in ('Ana', 'Ben'):
        cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', name); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length >= 2 && [...document.querySelectorAll('.tile[data-peer] video')].every(v => v.readyState >= 2)", timeout=120000)
    assert host.evaluate("!document.querySelector('#remoteDlg').open") and host.is_visible('#remoteAdd') and host.is_visible('#remoteNone')
    step('studio up with two cameras; the Phone remote section offers "Add a phone", and no code is showing')

    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    left = host.inner_text('#remoteLeft')
    step(f'Add a phone shows a QR and a one-time code ({host.inner_text("#remoteCode")}): {left}')

    # a phone with the wrong code first, then the right one (from the QR's link)
    bad = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); bad.on('pageerror', lambda e: errors.append(f'bad: {e}'))
    bad.goto(f"{BASE}/remote?e={ev['id']}#p=WRONGCDE")
    bad.wait_for_function("document.querySelector('#pairSay').textContent.includes(\"isn't right\")", timeout=20000)
    rctx = b.new_context(viewport={'width': 390, 'height': 844})
    rem = rctx.new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}')); rem.on('dialog', lambda d: d.accept())
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function("!document.querySelector('#ctlView').hidden && document.querySelectorAll('#cams .cam').length === 2", timeout=30000)
    assert '#p=' not in rem.url and host.evaluate("!document.querySelector('#remoteDlg').open")
    host.wait_for_function("document.querySelector('#remoteList').textContent.includes('connected')", timeout=10000)
    names = rem.eval_on_selector_all('#cams .cam b', 'els => els.map(e => e.textContent)')
    step(f"a wrong code is turned away; the right one pairs the phone: it sees {names}, the code leaves its address bar, the studio's dialog closes and lists it as connected")

    rem.wait_for_function("[...document.querySelectorAll('#cams .cam img')].filter(i => i.src.startsWith('data:image/jpeg')).length === 2", timeout=20000)
    step('both cameras show a picture on the remote (sent every few seconds while it is open)')

    on_air = lambda: rem.evaluate("document.querySelector('#cams .cam.air b')?.textContent || ''")
    target = 'Ben' if on_air() != 'Ben' else 'Ana'
    rem.evaluate(f"[...document.querySelectorAll('#cams .cam')].find(c => c.querySelector('b').textContent === '{target}').click()")
    rem.wait_for_function(f"document.querySelector('#cams .cam.air b')?.textContent === '{target}' && document.querySelector('#onAir').textContent.includes('{target}')", timeout=10000)
    step(f'tapping {target} on the remote cuts the studio to {target} ("{rem.inner_text("#onAir")}")')

    was = rem.get_attribute('#autoBtn', 'aria-pressed')
    rem.click('#autoBtn'); rem.wait_for_function(f"document.querySelector('#autoBtn').getAttribute('aria-pressed') !== '{was}'", timeout=10000)
    assert host.get_attribute('#autoBtn', 'aria-pressed') == rem.get_attribute('#autoBtn', 'aria-pressed')
    rem.click('#autoBtn'); rem.wait_for_function(f"document.querySelector('#autoBtn').getAttribute('aria-pressed') === '{was}'", timeout=10000)
    rem.click('#breakBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent === 'On a break' && document.querySelector('#breakBtn').textContent === 'End break'", timeout=10000)
    rem.click('#breakBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent.startsWith('On air')", timeout=10000)
    rem.click('#blackBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent === 'Black' && document.querySelector('#blackBtn').textContent === 'Fade up'", timeout=15000)
    rem.click('#blackBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent.startsWith('On air')", timeout=15000)
    step('auto-director on and off, a break and back, fade to black and up: all from the remote, the studio following')

    rem.click('#recBtn')
    host.wait_for_function("document.querySelector('#recProgBtn').getAttribute('aria-pressed') === 'true'", timeout=15000)
    rem.wait_for_function("document.querySelector('#recBtn').textContent === 'Stop recording' && !document.querySelector('#recTime').hidden", timeout=10000)
    time.sleep(2)
    rem.click('#recBtn')   # (asks first: accepted)
    host.wait_for_function("document.querySelector('#recProgBtn').getAttribute('aria-pressed') === 'false'", timeout=20000)
    host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.id !== 'remoteDlg' && d.close())")
    step('Record program started from the remote (it shows the time recording), and stopped (after asking)')

    # the used code can't be used again; a made-up key gets nothing; five wrong codes stop a pairing
    # (the studio is busy a moment finishing the program recording; let it)
    host.wait_for_function("!window.vmProgRecBusy?.()", timeout=60000) if host.evaluate("typeof window.vmProgRecBusy === 'function'") else time.sleep(8)
    again = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    again.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    try:
        again.wait_for_function("document.querySelector('#pairSay').textContent.includes('run out')", timeout=45000)
    except Exception:
        print('   the second phone said:', repr(again.inner_text('#pairSay')), '| connected to the studio:', again.get_attribute('#conn', 'class'))
        raise
    forged = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); forged.on('pageerror', lambda e: errors.append(f'forged: {e}'))
    forged.goto(f"{BASE}/remote?e={ev['id']}"); forged.evaluate(f"localStorage.setItem('vm_remote_{ev['id']}', 'madeupkey1234567890madeupkey1234')"); forged.reload()
    forged.wait_for_function("!document.querySelector('#pairView').hidden && document.querySelector('#pairSay').textContent.includes('removed')", timeout=45000)
    # (the studio's "That's a wrap" opens once the recording is done: closed first, as a person would)
    host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelector('#remoteAdd').click()")
    host.wait_for_function("document.querySelector('#remoteDlg').open", timeout=5000)
    for k in range(5):
        # (a new address each time: only the part after # changing wouldn't reload the page)
        bad.goto(f"{BASE}/remote?e={ev['id']}&try={k}#p=WRONG{k}AB")
        bad.wait_for_function("document.querySelector('#pairSay').textContent.includes(\"isn't right\") || document.querySelector('#pairSay').textContent.includes('run out')", timeout=45000)
    host.wait_for_function("!document.querySelector('#remoteDlg').open", timeout=10000)
    step('the used code is refused ("run out"), a made-up key is refused (back to pairing), and five wrong codes take the new code away')

    rem.reload()
    rem.wait_for_function("!document.querySelector('#ctlView').hidden && document.querySelectorAll('#cams .cam').length === 2", timeout=30000)
    step('a reload of the remote carries on (its key is kept on the phone)')

    # a phone's connection drops now and then and comes back: the studio lets go of the remote and
    # isn't told it's back. The remote checks in every few seconds, so a camera joining meanwhile shows up.
    host.evaluate("(() => { const h = vmRemoteHost(); for (const p of [...h.bound.keys()]) h.gone(p); })()")
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'Cy: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Cy'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    rem.wait_for_function("[...document.querySelectorAll('#cams .cam b')].some(b => b.textContent === 'Cy')", timeout=60000)
    step('after the studio lost track of the remote (a dropped connection), a camera that joined still showed up on it: it checks in every few seconds')

    # a sound-only source (this computer's microphone): on the remote under Sound, and a tap puts it on air
    host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())")
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="mic"]', timeout=10000)
    host.click('#localList [data-add="mic"] >> nth=0'); host.keyboard.press('Escape')
    rem.wait_for_function("!document.querySelector('#sound').hidden && document.querySelectorAll('#sound .cam').length === 1", timeout=30000)
    sname = rem.inner_text('#sound .cam b')
    rem.evaluate("document.querySelector('#sound .cam').click()")
    rem.wait_for_function("document.querySelector('#onAir').textContent.endsWith('sound only') && document.querySelector('#sound .cam').classList.contains('air')", timeout=15000)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('MIC')", timeout=10000)
    step(f'a sound-only source ({sname}) shows on the remote under Sound; a tap puts it on air ("{rem.inner_text("#onAir")}"; the studio: "{host.inner_text("#progLabel")}")')

    host.evaluate("document.querySelector('#remoteList [data-remote-del]').click()")
    rem.wait_for_function("!document.querySelector('#pairView').hidden && document.querySelector('#pairSay').textContent.includes('removed')", timeout=15000)
    assert host.is_visible('#remoteNone')
    step('Remove in the studio: the phone is a remote no more, at once')

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
