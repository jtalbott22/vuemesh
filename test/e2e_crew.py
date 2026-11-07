# Director ↔ camera crew: the fading status pill, messages to one phone or all, quick
# replies and read receipts, the rundown with cues, output shape reaching phones,
# pausing the live picture, and leaving and rejoining mid-event (clip still arrives).
# Run: node dev/server.mjs &  then  python3 test/e2e_crew.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Crew test'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    ph = {}
    for name in ['Rosa', 'Dev']:
        c = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'], user_agent='Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36').new_page()  # phones
        c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000)
    rosa, dev = ph['Rosa'], ph['Dev']
    rosa.wait_for_function("document.querySelector('#upPill').textContent.includes('Connected to host')", timeout=15000)
    rosa.wait_for_function("document.querySelector('#upPill').classList.contains('fade')", timeout=8000)
    dot = rosa.evaluate("document.querySelector('#linkDot').className")
    step(f'status line showed "Connected to host on local Wi-Fi", then faded on its own; the event name keeps a {dot.split()[-1]} dot')

    # one phone
    host.click('.dmrow button[aria-label="Message Rosa"]')  # (opens a proper box to type in)
    host.wait_for_selector('#dmDlg[open]', timeout=3000)
    assert host.inner_text('#dmWho') == 'Rosa'
    host.fill('#dmText', 'Get the cake table from the left'); host.press('#dmText', 'Enter')
    host.wait_for_function("!document.querySelector('#dmDlg').open", timeout=3000)  # (sent: the box closes)
    rosa.wait_for_selector('#dm:not([hidden])', timeout=6000)
    assert 'cake table' in rosa.inner_text('#dmText') and dev.is_hidden('#dm')
    host.wait_for_function("[...document.querySelectorAll('.dmrow .dmstat')].some(s => s.textContent.startsWith('✓✓ seen'))", timeout=6000)
    step(f"Message… under Rosa's tile opened a box for her; it reached only Rosa (\"{rosa.inner_text('#dmText')}\"); the studio shows ✓✓ seen")
    rosa.click('#dm [data-reply="👍 Got it"]')
    host.wait_for_function("[...document.querySelectorAll('.dmrow .dmstat.reply')].some(s => s.textContent.includes('Got it'))", timeout=6000)
    step('Rosa tapped 👍: the reply shows under her tile and in the event log')

    # everyone
    host.fill('#dmAll', 'Speeches in two minutes'); host.press('#dmAll', 'Enter')
    for c in (rosa, dev): c.wait_for_function("document.querySelector('#dmText').textContent.includes('Speeches')", timeout=6000)
    who = dev.inner_text('#dm .from')
    step(f'Message all cameras reached both phones (banner: "{who}")')

    # rundown + cues
    host.fill('#rundownText', 'Entrance\nFirst dance\nToasts')
    host.click('#rundownSend'); time.sleep(0.5)
    host.click('#cueNext')
    rosa.wait_for_selector('#cue:not([hidden])', timeout=6000)
    cue1 = rosa.inner_text('#cue').replace('\n', ' ')
    host.locator('body').click(position={'x': 800, 'y': 400}); host.keyboard.press(']')
    dev.wait_for_function("document.querySelector('#cueNow').textContent === 'First dance'", timeout=6000)
    step(f'rundown sent; Next ▶ then ] stepped the cue — phones show one line: "{cue1}" → "Now First dance · Next: Toasts"')

    # output shape
    host.click('#portBtn')
    rosa.wait_for_function("document.querySelector('#dmText').textContent.includes('portrait')", timeout=6000)
    step(f'switching the film to portrait told every phone: "{rosa.inner_text("#dmText")}"')
    host.click('#landBtn'); time.sleep(0.5)

    # pause
    rosa.click('#camTitle'); rosa.wait_for_selector('#linkSheet[open]')
    rosa.uncheck('#liveSwitch'); rosa.click('#lsClose')
    host.wait_for_function("[...document.querySelectorAll('.tile[data-peer]')].some(t => t.classList.contains('paused') && t.querySelector('.who').textContent === 'Rosa')", timeout=6000)
    n = host.evaluate("[...document.querySelectorAll('.tile[data-peer]')].find(t => t.querySelector('.who').textContent === 'Rosa').querySelector('.n').textContent")
    host.locator('body').click(position={'x': 800, 'y': 400}); host.keyboard.press(n); time.sleep(0.4)
    refused = 'paused' in host.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')")
    assert refused and rosa.is_visible('#pausedTag')
    step(f'Rosa paused from the event button: her tile shows PAUSED, cutting to her is refused, her phone says "{rosa.inner_text("#pausedTag")}"')
    rosa.click('#camTitle'); rosa.check('#liveSwitch'); rosa.click('#lsClose')
    host.wait_for_function("![...document.querySelectorAll('.tile[data-peer]')].some(t => t.classList.contains('paused'))", timeout=6000)
    step('turned back on: live again in the studio')

    # leave mid-recording, rejoin, clip still arrives
    dev.evaluate("document.querySelector('#shutter').click()"); time.sleep(2.5)
    dev.click('#camTitle'); dev.wait_for_selector('#linkSheet[open]'); dev.click('#leaveBtn')
    dev.wait_for_selector('#rejoinCard:not([hidden])', timeout=8000)
    dev.wait_for_function("document.querySelector('#rejoinText').textContent.includes('kept on this phone')", timeout=15000)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 1", timeout=15000)
    step(f'Dev left mid-recording: "{dev.inner_text("#rejoinText")}"; the studio dropped his tile')
    dev.click('#rejoinBtn')
    dev.wait_for_selector('#camView.on', timeout=10000)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=20000)
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=30000)
    step('one tap on Rejoin: back in the studio, and the clip he shot before leaving arrived and verified')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
