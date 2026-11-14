# The studio in a call (studio/callin.js): Add → People on a call → Start a call. The studio is in it
# at once, with a link to send. A guest opens the link (/call), waits, and the studio lets them in from
# its panel. Then: the guest is a source in the studio (their picture, their sound ON in the mixer);
# the guest sees the studio's program as the studio's camera, named for the show, and hears the
# studio. The guest shares a screen: it's a source of its own, named for them; it goes when they stop.
# The guest leaves: their source goes at once. The studio leaves the call: the call's sources go.
# Run: node dev/server.mjs &  then  python3 test/e2e_studiocall.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SCREEN = """(() => {
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { n++; g.fillStyle = '#eee'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c00'; g.fillRect((n * 17) % 1100, 300, 120, 120); }, 33);
    return c.captureStream(15);
  };
})();"""

def wait(page, js, what, secs=30, arg=None):
    end = time.time() + secs
    v = None
    while time.time() < end:
        v = page.evaluate(js) if arg is None else page.evaluate(js, arg)
        if v:
            return v
        time.sleep(0.25)
    raise AssertionError(f'timed out: {what} (last {v!r}); studio: {host.evaluate("() => JSON.stringify(window.vmStudioCall?.())")}')

with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    errors = []
    hctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = hctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Pod%20show")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-call]', timeout=10000)
    host.click('#localList [data-call]')
    host.wait_for_selector('#callDlg[open] [data-act="start"]', timeout=5000)
    host.click('#callDlg [data-act="start"]')
    info = wait(host, "() => { const c = window.vmStudioCall?.(); return c && c.in && c.link ? c : null; }", 'the studio in its own call, with a link')
    link = info['link']
    step(f"Add → People on a call → Start a call: the studio is in call {info['id']}, with its link and PIN {info['pin']}")

    gctx = b.new_context(permissions=['camera', 'microphone'])
    gctx.add_init_script(SCREEN)
    guest = gctx.new_page(); guest.on('pageerror', lambda e: errors.append(f'guest: {e}'))
    guest.goto(link)
    guest.wait_for_selector('#preView', state='visible', timeout=15000)
    guest.fill('#name', 'Maya')
    guest.click('#joinBtn')
    guest.wait_for_selector('#waitView', state='visible', timeout=15000)
    wait(host, "() => vmStudioCall().waiting.includes('Maya')", 'the studio sees Maya waiting')
    host.wait_for_selector('#callDlg[open] [data-admit]', timeout=5000)   # (in the call panel)
    # and on the bell, with the panel closed: a count, and Let in right there
    host.evaluate("() => document.querySelector('#callDlg').close()")
    wait(host, "() => vmNotifs().guests.includes('Maya') && vmNotifs().badge >= 1 && vmNotifs().fresh", 'Maya on the bell, counted and new')
    host.click('#notifBtn')
    host.wait_for_selector('#notifList [data-guest-admit]', timeout=5000)
    assert 'Maya is waiting to come into the call' in host.inner_text('#notifList')
    host.click('#notifList [data-guest-admit]')
    guest.wait_for_selector('#callView', state='visible', timeout=15000)
    wait(host, "() => !vmNotifs().guests.length", 'off the bell once she is in')
    host.keyboard.press('Escape')
    step('Maya opens the link and waits; the studio has her in its call panel, and on the bell (counted, new), and lets her in from the bell')

    src = wait(host, "() => vmStudioCall().sources.find((s) => !s.screen && s.name === 'Maya' && s.sound && s.video > 0)", "Maya a source in the studio, with picture and sound", secs=40)
    assert src['mode'] == 'on', src
    host.wait_for_function(f"(() => {{ const v = document.querySelector('.tile[data-peer=\"{src['peer']}\"] video'); return v && v.readyState >= 2; }})()", timeout=15000)
    step("Maya is a source in the studio (her tile playing, her sound ON in the mixer)")

    # the studio's message to her (Message… under her tile) reaches her call page; seen, and her reply comes back
    host.click('.dmrow button[aria-label="Message Maya"]')
    host.wait_for_selector('#dmDlg[open]', timeout=3000)
    host.fill('#dmText', 'You are on next'); host.press('#dmText', 'Enter')
    host.wait_for_function("!document.querySelector('#dmDlg').open", timeout=3000)   # (sent: the box closes)
    guest.wait_for_selector('#dirMsg:not([hidden])', timeout=8000)
    assert 'You are on next' in guest.inner_text('#dirText') and 'studio' in guest.inner_text('#dirFrom'), guest.inner_text('#dirMsg')
    host.wait_for_function("[...document.querySelectorAll('.dmrow .dmstat')].some(s => s.textContent.startsWith('\u2713\u2713 seen'))", timeout=8000)
    guest.fill('#dirReply', 'Ready'); guest.click('#dirForm button[type=submit]')
    host.wait_for_function("[...document.querySelectorAll('.dmrow .dmstat')].some(s => s.textContent.includes('Ready'))", timeout=8000)
    assert guest.is_hidden('#dirMsg')
    step('the studio messages Maya (Message… under her tile): it reaches her call page, shows seen, and her reply comes back')

    seen = wait(guest, "() => vmCall().peers.find((p) => /Pod show \\(studio\\)/.test(p.name) && p.state === 'connected' && p.streams >= 2)", "Maya connected to the studio, with its picture and sound", secs=30)
    wait(guest, "() => [...document.querySelectorAll('#grid .tile:not(.self) video')].some((v) => v.videoWidth >= 640 && !v.paused)", "the program playing on Maya's page")
    step(f"Maya sees the studio's program as \"{seen['name']}\", and hears it")

    # the studio started the call, so it runs it: Maya can't take the studio out, take anyone out, or lock it
    guest.click('#peopleBtn')
    guest.wait_for_selector('#peopleBox[open]', timeout=5000)
    assert guest.query_selector('#inList [data-remove]') is None and 'Studio' in guest.inner_text('#inList'), guest.inner_text('#inList')
    assert not guest.is_visible('#lockBtn') and 'studio' in guest.inner_text('#peopleRule').lower()
    guest.click('#peopleBox [data-close]')
    step("the studio's call is the studio's to run: Maya has no Take out (the studio's marked Studio) and no Lock")

    # Maya is told plainly that a studio is in the call, and when it's recording
    wait(guest, "() => /Pod show \\(studio\\) is in this call/.test(document.querySelector('#studioNote').textContent) && !document.querySelector('#studioNote').hidden", 'the studio notice on Maya\'s page')
    assert 'Recording' not in guest.inner_text('#studioNote')
    host.click('#recProgBtn')
    wait(guest, "() => /Recording/.test(document.querySelector('#studioNote').textContent)", 'Maya told it is recording', secs=15)
    host.click('#recProgBtn')
    wait(guest, "() => !/Recording/.test(document.querySelector('#studioNote').textContent)", 'and when it stops', secs=20)
    step("Maya's page says plainly the studio is in the call and can put her on its show, record or stream it; \"Recording\" while it records")

    # the Monitor: the call under going out (the program to Maya), and Maya under coming in, measured
    mon = hctx.new_page(); mon.on('pageerror', lambda e: errors.append(f'monitor: {e}'))
    mon.goto(f"{BASE}/monitor?e={ev['id']}")
    mon.wait_for_function("/Maya/.test(document.querySelector('#xfOut').textContent) && /Call /.test(document.querySelector('#xfOut').textContent)", timeout=30000)
    mon.wait_for_function("[...document.querySelectorAll('#xfOut .xrow')].some((r) => /Maya/.test(r.textContent) && /[1-9][0-9.]* Mbps|0\\.[1-9]/.test(r.textContent))", timeout=20000)
    outRow = next(r for r in mon.eval_on_selector_all('#xfOut .xrow', 'rs => rs.map((r) => r.innerText.replace(/\\s+/g, " "))') if 'Maya' in r)
    mon.close()
    step(f'the Monitor lists the call under going out: "{outRow}"')

    guest.click('#shareBtn')
    scr = wait(host, "() => vmStudioCall().sources.find((s) => s.screen && /Maya/.test(s.name) && s.video >= 640)", "Maya's screen a source of its own", secs=30)
    guest.click('#shareBtn')
    wait(host, "() => !vmStudioCall().sources.some((s) => s.screen)", "her screen's source gone when she stops", secs=15)
    step(f"Maya shares her screen: \"{scr['name']}\" is a source of its own; it goes when she stops")

    t0 = time.time()
    guest.click('#leaveBtn')
    wait(host, "() => !vmStudioCall().sources.length && !vmStudioCall().peers.length", 'Maya gone from the studio', secs=5)
    step(f'Maya leaves: her source is gone from the studio in {time.time() - t0:.1f} s')

    host.evaluate("() => document.querySelector('#callDlg').open || document.querySelector('#callDlg').showModal()")
    host.on('dialog', lambda d: d.accept())
    host.click('#callDlg [data-act="leave"]')
    wait(host, "() => !window.vmStudioCall?.()", 'the studio out of the call', secs=5)
    step('the studio leaves the call')

    assert not errors, errors
    b.close()
print('\nAll studio call tests passed.')
