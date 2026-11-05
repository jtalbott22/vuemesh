# The kiosk: a hands-free screen (also in an iframe on a digital sign). /kiosk opens a show
# with nothing to press: the studio, stripped down, its own pulsing join code, the side
# panel fitting the full height. A camera on the kiosk's own computer doesn't start a show.
# The first phone names the show and gets Go live (once locked in, or after 20 s): a 3-2-1
# count-in on the phone and the kiosk, then the show fades up and records. The next phone just
# joins. Phones keep their clips (a kiosk doesn't collect them). When everyone's gone, it
# fades out, stops, and starts a fresh show with a new code, with no "Leave site?" in the way.
# Run: node dev/server.mjs &  then  python3 test/e2e_kiosk.py
import os, re, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1920, 'height': 1080}, accept_downloads=True, permissions=['camera', 'microphone'])
    sign = ctx.new_page(); sign.on('pageerror', lambda e: errors.append(f'sign: {e}'))
    downloads = []; sign.on('download', lambda d: downloads.append(d.suggested_filename))
    sign.goto(BASE + '/terms')
    # set up beforehand in the studio on this computer: a webcam added, a short end time
    sign.evaluate("""async () => {
      const s = await navigator.mediaDevices.getUserMedia({ video: true }); const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'videoinput'); s.getTracks().forEach(t => t.stop());
      localStorage.setItem('vm_local_sources', JSON.stringify([{ kind: 'cam', deviceId: d.deviceId, label: d.label, name: 'Webcam', sound: false }]));
      localStorage.setItem('vm_ap_end', '15'); }""")
    sign.set_content(f'<body style="margin:0"><iframe id="k" src="{BASE}/kiosk" style="border:0;width:100vw;height:100vh"></iframe></body>')
    time.sleep(1)
    st = next(f for f in sign.frames if f != sign.main_frame)
    st.wait_for_url(re.compile(r'/kiosk\?e='), timeout=20000)   # (the kiosk screen is its own page)
    st.wait_for_function("document.body && document.body.classList.contains('kiosk') && vmAutopilot().on", timeout=20000)
    ev = st.evaluate("new URLSearchParams(location.search).get('e')")
    st.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=20000); time.sleep(6)
    assert st.evaluate("vmAutopilot().state") == 'idle' and st.evaluate("vmAutopilot().black")
    fit = st.evaluate("(() => { const s = document.querySelector('#kioskSide'), r = s.getBoundingClientRect(), last = document.querySelector('#kState').getBoundingClientRect(), q = document.querySelector('#kQr').getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight, s.scrollHeight <= s.clientHeight + 1, Math.round(last.bottom), Math.round(q.width), Math.round(q.height)]; })()")
    assert fit[0] == 0 and fit[1] == fit[2] and fit[3] and fit[4] <= fit[2] and abs(fit[5] - fit[6]) <= 2, fit
    buttons = [x for x in st.eval_on_selector_all('button', 'b => b.filter(x => x.offsetParent && !x.closest("dialog") && !x.closest(".tile, #multi")).map(x => x.textContent.trim())') if x]
    assert not buttons, buttons
    step(f'/kiosk opened a show ({ev}): no buttons; the side panel fills the full height ({fit[0]}–{fit[1]} of {fit[2]} px) with everything in it, the code square ({fit[5]}×{fit[6]}); the webcam on this computer is in, but did not start a show')

    def phone(name, show=None):
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e: errors.append(f'{name}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev}"); c.wait_for_selector('#joinForm', timeout=10000)
        first = c.is_visible('#nameShowBox')
        if show: c.fill('#showName', show)
        c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        return c, first
    ana, first = phone('Ana', 'Friday open mic')
    assert first
    st.wait_for_function("document.querySelector('#kTitle').textContent === 'Friday open mic'", timeout=15000)
    ana.wait_for_selector('#goLive:not([hidden]) #goLiveBtn', timeout=60000)
    time.sleep(2); assert st.evaluate("vmAutopilot().state") == 'idle'
    step(f"the first phone named it \"Friday open mic\" and got Go live; the kiosk waits: \"{st.inner_text('#kState')}\"")
    ana.click('#goLiveBtn')
    ana.wait_for_selector('#goLiveCount:not([hidden])', timeout=5000)
    st.wait_for_selector('#kCount:not([hidden])', timeout=8000)
    counted = st.inner_text('#kCount')
    st.wait_for_function("vmAutopilot().state === 'running' && vmAutopilot().recording && !vmAutopilot().black", timeout=45000)   # (a slow machine)
    ana.wait_for_selector('#goLive', state='hidden', timeout=10000)
    step(f'Go live: a 3-2-1 count-in on the phone and the kiosk ("{counted}"), then the show faded up and recorded')

    ben, first2 = phone('Ben')
    assert not first2
    ana.evaluate("document.querySelector('#shutter').click()"); time.sleep(3); ana.evaluate("document.querySelector('#shutter').click()")
    time.sleep(4)
    kept = ana.evaluate("(async () => (await (await import('/js/idb.js')).list('outbox', new URLSearchParams(location.search).get('e'))).filter(r => !String(r.id).startsWith('pgm-')).map(r => r.status))()")
    assert kept and all(s == 'saved' for s in kept) and st.evaluate("document.querySelector('#kClips').textContent") == '0', kept
    step(f'the next phone just joined; a clip Ana shot stayed on her phone ({kept}): the kiosk collects none')

    ana.context.close(); ben.context.close()
    st.wait_for_url(lambda u: '/kiosk?e=' in u and ev not in u, timeout=180000)
    ev2 = st.evaluate("new URLSearchParams(location.search).get('e')")
    gone = sign.evaluate(f"(async () => (await fetch('{BASE}/api/events/{ev}')).status)()")
    st.wait_for_function("document.querySelector('#kCall').textContent === 'Scan to start a show'", timeout=20000)
    assert ev2 != ev and gone == 404 and not any('live' in d for d in downloads), (ev2, gone, downloads)
    step(f'everyone left: it faded out, stopped, and moved to a fresh show ({ev2}) by itself, no "Leave site?" in the way; the old one is deleted')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
