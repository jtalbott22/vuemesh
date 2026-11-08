# Edit in its own window beside the live studio: "Edit ↗" opens /edit; it connects to no
# phones (the studio keeps doing that), starts in Edit with no Live, and draws no live
# program. What the studio receives shows up in the Edit page's timeline while the studio stays
# live. A hand edit there stays (the studio leaves the timeline to it), a second take goes on
# its end, and when it closes, the studio's own Edit has what was done there.
# Run: node dev/server.mjs &  then  python3 test/e2e_editpage.py
import os, time, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Two windows'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Ana'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=90000)
    host.evaluate("document.querySelector('.tile[data-peer]').click()"); time.sleep(1)
    recprog = lambda: (host.evaluate("document.querySelector('#recProgBtn').click()"), time.sleep(1), host.evaluate("document.querySelectorAll('dialog[open]').forEach(d => d.close())"))

    with ctx.expect_page() as pop: host.evaluate("document.querySelector('#editTab').click()")
    ed = pop.value; ed.on('pageerror', lambda e: errors.append(f'edit: {e}')); ed.on('dialog', lambda d: d.accept())
    ed.wait_for_function("document.body && document.body.classList.contains('editpage') && document.body.dataset.mode === 'edit'", timeout=120000)
    assert ed.is_hidden('#liveTab') and '— edit' in ed.title() and host.evaluate("document.body.dataset.mode") == 'live' and ed.evaluate("vmMedia().length") == 0
    step("Edit ↗ opened /edit beside the live studio: no phones of its own, no Live, and the studio stays live")

    # full screen, as the studio has: the button (F too), Monitor and Help still there, the button takes it back out
    assert ed.is_visible('#fsBtn')
    ed.click('#fsBtn')
    ed.wait_for_function("document.body.classList.contains('fs') && !!document.fullscreenElement", timeout=5000)
    assert ed.inner_text('#fsBtn').startswith('Exit full screen') and ed.is_visible('#monitorBtn') and ed.is_visible('#helpBtn') and ed.is_visible('#timeline')
    ed.click('#fsBtn')
    ed.wait_for_function("!document.body.classList.contains('fs') && !document.fullscreenElement", timeout=5000)
    assert ed.inner_text('#fsBtn').startswith('Full screen')
    step('Edit has the Full screen button: in and out again, with Monitor, Help and the timeline still there')

    def take(sec):
        recprog(); time.sleep(sec); recprog()   # the director records a take
    take(8)
    for _ in range(240):
        prog = ed.evaluate("vmProgram()")
        if any(i['name'] == 'Ana' for i in prog): break
        time.sleep(0.5)
    assert any(i['name'] == 'Ana' for i in prog), (prog, host.evaluate('vmClipList()'), ed.evaluate('vmClipList()'), ed.evaluate('JSON.stringify(window.vmEditMsgs)'), ed.evaluate("(async () => { const idb = await import('/js/idb.js'); const all = await idb.list('clips', new URLSearchParams(location.search).get('e')); return [all.length, typeof BroadcastChannel]; })()"))
    step(f"a take recorded in the studio showed up in the Edit page's timeline: {[(i['name'], i['dur']) for i in prog]}")

    first = [i['id'] for i in prog]
    ed.evaluate(f"vmSelect('{first[0]}')"); ed.evaluate("document.activeElement && document.activeElement.blur()"); ed.keyboard.press('Delete'); time.sleep(0.5)
    left = [i['id'] for i in ed.evaluate("vmProgram()")]
    assert first[0] not in left
    take(8)
    for _ in range(240):
        prog2 = ed.evaluate("vmProgram()")
        if len(prog2) > len(left): break
        time.sleep(0.5)
    saved = json.loads(host.evaluate(f"localStorage.getItem('vm_seq_{ev['id']}')"))
    saved_items = [i['id'] for t in saved['tracks'] if t.get('program') for i in t['items']]
    assert len(prog2) > len(left) and first[0] not in [i['id'] for i in prog2] and saved_items == [i['id'] for i in prog2], (left, prog2, saved_items)
    step(f'a hand edit there (the shot deleted) stayed, and a second take went on its end ({len(left)} → {len(prog2)} pieces); the studio left the timeline to it')

    # Program out: Live, or the edit as it plays in the Edit window
    with ctx.expect_page() as pop2: host.evaluate("document.querySelector('#progOutBtn').click()")
    po = pop2.value; po.on('pageerror', lambda e: errors.append(f'program out: {e}'))
    ids = lambda pg: pg.evaluate("(() => { const s = document.querySelector('#out')?.srcObject; return s ? s.getTracks().map(t => t.id).sort() : []; })()")
    feed = lambda pg: pg.evaluate("vmProgramFeed().getTracks().map(t => t.id).sort()")
    po.wait_for_function("document.querySelector('#out').srcObject", timeout=30000)
    assert ids(po) == feed(host), (ids(po), feed(host))
    # Edit: the Edit window is in its own process; its picture and sound come over a connection on this computer
    ed.evaluate("document.querySelector('#playBtn')?.click()")
    po.evaluate("document.querySelector('[data-src=\"edit\"]').click()")
    po.wait_for_function("document.querySelector('#srcTag').textContent === 'EDIT' && document.querySelector('#out').srcObject && document.querySelector('#out').srcObject.getVideoTracks().length && document.querySelector('#out').videoWidth > 0", timeout=60000)
    got = po.evaluate("(() => { const v = document.querySelector('#out'); return [v.videoWidth, v.videoHeight, v.srcObject.getTracks().map(t => t.kind).sort()]; })()")
    assert not set(ids(po)) & set(feed(host)), 'Program out (Edit) is showing the live program'
    # the picture arrives at the size the program is drawn at (a connection can quietly lower it)
    want = ed.evaluate("[document.querySelector('#program').width, document.querySelector('#program').height]")
    assert got[:2] == want, f'Program out got {got[:2]} from the Edit window, which draws {want}'
    po.evaluate("document.querySelector('[data-src=\"live\"]').click()"); time.sleep(1.5)
    assert ids(po) == feed(host)
    step(f'Program out has Live and Edit: Edit comes from the Edit window, in its own process, over a connection on this computer ({got[0]}x{got[1]}, {got[2]}); Live the program again')
    po.close()

    # the studio has no Edit of its own: closing the Edit window and opening it again brings the
    # same timeline back, hand edits and all
    ed.close(); time.sleep(2)
    assert host.evaluate("document.body.dataset.mode") == 'live'
    with ctx.expect_page() as pop3: host.evaluate("document.querySelector('#editTab').click()")
    ed2 = pop3.value; ed2.on('pageerror', lambda e: errors.append(f'edit again: {e}'))
    ed2.wait_for_function("document.body && document.body.dataset.mode === 'edit'", timeout=180000); time.sleep(2)
    again = [i['id'] for i in ed2.evaluate("vmProgram()")]
    # (more of that take can arrive after the snapshot: what was there comes first, in order, and the deleted shot stays gone)
    assert first[0] not in again and again[:len(prog2)] == [i['id'] for i in prog2], (again, prog2)
    step("closed the Edit window and opened it again from the studio: the same timeline, hand edits and all (the studio never edits)")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
