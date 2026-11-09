# A TV showing phones and screens itself, with no studio (/tv, tvdirect.js): its landing page has a
# studio's code to type and, beside it, the TV's own code, already listening (nothing to click). It makes
# its own code, a phone's camera (/cam) and another computer's screen (/share) join it with that code,
# and both are on the TV, tiled, as they come and go. Checks: the code stays the same after a
# reload; the phone is told it's on and not to record (its light, no recording, clips kept); with
# two on, both send their full picture; one chosen full screen gets the full picture and the other a
# small one; the screen's sound plays and a camera's doesn't (feedback) until turned on; the share
# page says it's on the TV; one leaving takes its tile away and the join card fills the screen again.
# Run: node dev/server.mjs &  then  python3 test/e2e_tvdirect.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

CAPTURE_PCS = """(() => {
  const PC = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends PC { constructor(...a) { super(...a); window.__pcs.push(this); } };
})();"""
# a "screen" with a tone, as e2e_sharequality makes one
SCREEN = """(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { n++; g.fillStyle = '#eee'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c00'; g.fillRect((n * 17) % 1100, 300, 120, 120); }, 33);
    const s = c.captureStream(30);
    const ctx = new AudioContext(), d = ctx.createMediaStreamDestination(), o = ctx.createOscillator();
    o.connect(d); o.start(); ctx.resume();
    s.addTrack(d.stream.getAudioTracks()[0]);
    return s;
  };
})();"""
# the most a sending link may use, kbit/s, and its picture's size divisor
SENDING = """() => {
  for (const pc of window.__pcs || []) {
    if (pc.connectionState !== 'connected') continue;
    const s = pc.getSenders().find((x) => x.track?.kind === 'video');
    const e = s?.getParameters().encodings?.[0];
    if (e) return { kbps: Math.round((e.maxBitrate || 0) / 1000), scale: e.scaleResolutionDownBy || 1 };
  }
  return null;
}"""

def wait(page, js, what, secs=30, arg=None):
    end = time.time() + secs
    while time.time() < end:
        v = page.evaluate(js) if arg is None else page.evaluate(js, arg)
        if v:
            return v
        time.sleep(0.25)
    raise AssertionError(f'timed out: {what}')

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    tvx = b.new_context(viewport={'width': 1280, 'height': 720})
    tv = tvx.new_page()
    tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
    tv.goto(f'{BASE}/tv')
    code = wait(tv, "() => window.vmTvDirect?.().code", "the TV's own code, with nothing clicked")
    wait(tv, "() => window.vmTvDirect().listening", 'the TV listening on its code', 10)
    assert tv.locator('#lCode').inner_text() == code and len(code) == 6, code
    land = tv.evaluate("({ join: !document.querySelector('#joinView').hidden, tiles: !document.querySelector('#directView').hidden, cells: !!document.querySelector('#eventCells input'), qr: document.querySelector('#lQr').width, focus: document.activeElement === document.querySelector('#eventCells input') })")
    assert land['join'] and not land['tiles'] and land['cells'] and land['qr'] > 100 and land['focus'], land
    step(f"the landing page has both: a studio's code to type (focused) and the TV's own code ({code}) and QR, listening")

    # the TV's own code typed as a studio's: said so, and still listening
    tv.keyboard.type(code)
    tv.click('#joinForm button[type=submit]')
    wait(tv, "() => /a TV.s code/.test(document.querySelector('#joinErr').textContent)", 'the TV code turned away', 10)
    assert tv.evaluate("window.vmTvDirect().listening && !document.querySelector('#joinView').hidden")
    step("its own code typed on the studio side says it's a TV's code, and it keeps listening")

    # the same code after a reload
    tv.reload()
    again = wait(tv, "() => window.vmTvDirect?.().code", 'the code after a reload')
    assert again == code, (again, code)
    step('after a reload: the same code')

    # a phone's camera joins with the code
    camx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'])
    camx.add_init_script(CAPTURE_PCS)
    cam = camx.new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f'{BASE}/cam?e={code}')
    terms = cam.locator('#terms').inner_text()
    assert 'TV screen' in terms and 'Nothing is recorded' in terms, terms
    assert cam.evaluate("document.querySelector('#joinForm .roles').hidden"), 'the microphone choice shows for a TV'
    assert cam.locator('#joinForm button[type=submit]').inner_text() == 'Put my camera on the TV'
    cam.fill('#name', 'Ana')
    if cam.locator('#agreeGuest').count():
        cam.check('#agreeGuest')
    cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('#camView.on', timeout=15000)
    step('the phone joins a TV as a camera only, in one tap ("Put my camera on the TV")')
    wait(tv, "() => window.vmTvDirect().tiles.some((t) => t.name === 'Ana' && t.playing)", "Ana's picture on the TV", 40)
    assert tv.evaluate("document.querySelector('#joinView').hidden && !document.querySelector('#directView').hidden && document.querySelector('#dTiles').dataset.n === '1'")
    step("the phone's camera takes the TV from the landing page, full screen, with how to join in a corner")
    s = wait(cam, SENDING, "the phone's link")
    wait(cam, "() => !document.querySelector('#tally').hidden", "the phone's light on (it's on the TV)", 10)
    time.sleep(1.5)
    assert not cam.evaluate("!!window.vmRec?.().recording"), cam.evaluate("window.vmRec?.()")
    s = cam.evaluate(SENDING)
    assert s['kbps'] >= 2500 and s['scale'] == 1, s
    step(f"the phone sends its full picture ({s['kbps']} kbit/s), and isn't recording")
    status = cam.evaluate("document.querySelector('#upPill')?.textContent || ''")
    assert status.startswith('On the TV'), status
    # no beacon: nothing asks to aim at one, and there's no sync pill
    st = cam.evaluate("({ aim: document.querySelector('#aimText').classList.contains('show'), pill: !document.querySelector('#syncPill').hidden, tally: document.querySelector('#tally').textContent, note: !document.querySelector('#ctlNote').hidden })")
    assert not st['aim'] and not st['pill'] and not st['note'] and st['tally'] == 'ON THE TV', st
    # recording here: it stays on the phone, and still no beacon
    cam.click('#shutter'); time.sleep(2.5)
    assert not cam.evaluate("document.querySelector('#aimText').classList.contains('show')"), 'asked for the beacon while recording'
    cam.click('#shutter')
    wait(cam, "() => [...document.querySelectorAll('.toast')].some((t) => /the TV doesn.t record/.test(t.textContent))", 'the clip saved on the phone', 15)
    step("no beacon, no sync pill, no director note; its light says ON THE TV; a clip recorded here stays on the phone")
    # the camera's sound doesn't play on the TV (it would feed back)
    assert tv.evaluate("window.vmTvDirect().sound") is None
    assert tv.evaluate("!document.querySelector('#dCamSound').hidden")
    step("the camera's sound stays off on the TV, with a button to turn it on")

    # another computer's screen joins with the code
    shx = b.new_context(viewport={'width': 1280, 'height': 800})
    shx.add_init_script(CAPTURE_PCS)
    shx.add_init_script(SCREEN)
    sh = shx.new_page()
    sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f'{BASE}/share')
    sh.fill('#code', code)
    sh.fill('#name', 'Slides')
    sh.click('#shareBtn')
    wait(tv, "() => window.vmTvDirect().tiles.filter((t) => t.playing).length === 2", 'both on the TV', 40)
    assert tv.evaluate("document.querySelector('#dTiles').dataset.n === '2'")
    wait(tv, "() => window.vmTvDirect().tiles.find((t) => t.name === 'Slides')?.screen", 'the screen known as a screen', 10)
    wait(tv, "() => window.vmTvDirect().sound === 'Slides'", "the screen's sound playing", 10)
    wait(sh, "() => /On the TV/.test(document.querySelector('#linkSay').textContent)", 'the share page saying it is on the TV', 20)
    assert 'Nothing is recorded' in sh.locator('#joinWhat').inner_text()
    step("the screen joins beside it, side by side; its sound plays; the share page says it's on the TV")

    # one full screen: it sends its full picture, the other a small one; 0 puts them back
    tv.keyboard.press('2')
    wait(tv, "() => window.vmTvDirect().spot === 'Slides'", 'Slides full screen', 5)
    wait(cam, "() => { const s = (" + SENDING + ")(); return s && s.scale >= 2; }", 'the phone sending a small picture', 15)
    tv.keyboard.press('0')
    wait(tv, "() => window.vmTvDirect().spot == null", 'back to both', 5)
    wait(cam, "() => { const s = (" + SENDING + ")(); return s && s.scale === 1; }", 'the phone sending its full picture again', 15)
    step('2 shows the screen full screen (the phone then sends a small picture); 0 puts both back')

    # the camera's sound, turned on: the camera shown full screen plays its sound
    tv.click('#dCamSound')
    tv.keyboard.press('1')
    wait(tv, "() => window.vmTvDirect().sound === 'Ana'", "Ana's sound with camera sound on", 5)
    tv.click('#dCamSound')
    tv.keyboard.press('0')
    step("with Camera sound on, the camera full screen plays its sound")

    # the phone leaves (no waiting for a cut that a TV never makes) and comes back
    cam.click('#camTitle')
    t0 = time.time()
    cam.click('#leaveBtn')
    cam.wait_for_selector('#rejoinCard:not([hidden])', timeout=5000)
    took = time.time() - t0
    assert took < 2.5 and cam.evaluate("document.querySelector('#cutWait').hidden"), took
    assert "You're off the TV" in cam.locator('#rejoinText').inner_text()
    assert cam.evaluate("document.querySelector('#rejoinMicBtn').hidden")
    wait(tv, "() => window.vmTvDirect().tiles.length === 1", "Ana's tile gone", 40)
    step(f'leaving takes {took:.1f} s, with no wait for a copy of the show; the TV takes her tile away')
    cam.click('#rejoinBtn')
    wait(tv, "() => window.vmTvDirect().tiles.filter((t) => t.playing).length === 2", 'Ana back on the TV', 40)
    step('Back on the TV puts her back')

    # the phone closes: its tile goes; the screen leaves: the join card fills the screen again
    camx.close()
    wait(tv, "() => window.vmTvDirect().tiles.length === 1", "Ana's tile gone", 40)
    sh.click('#stopBtn')
    wait(tv, "() => window.vmTvDirect().tiles.length === 0 && !document.querySelector('#joinView').hidden && document.querySelector('#directView').hidden", 'the landing page back', 40)
    assert tv.evaluate("window.vmTvDirect().listening")
    step('as each leaves its tile goes, and with none left the landing page is back, still listening')

    # Clear: everyone off, told so (a phone doesn't link straight back), and the landing page
    cam2x = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'])
    cam2 = cam2x.new_page()
    cam2.goto(f'{BASE}/cam?e={code}'); cam2.fill('#name', 'Ben')
    if cam2.locator('#agreeGuest').count():
        cam2.check('#agreeGuest')
    cam2.click('#joinForm button[type=submit]')
    wait(tv, "() => window.vmTvDirect().tiles.some((t) => t.playing)", 'Ben on the TV', 40)
    tv.click('#dStop')
    wait(tv, "() => !document.querySelector('#joinView').hidden && window.vmTvDirect().tiles.length === 0", 'the landing page after Clear', 10)
    wait(cam2, "() => !document.querySelector('#rejoinCard').hidden && /took everyone off/.test(document.querySelector('#rejoinText').textContent)", "Ben told he's off", 10)
    time.sleep(4)
    assert tv.evaluate("window.vmTvDirect().tiles.length === 0"), 'a phone linked straight back after Clear'
    step("Clear takes everyone off (the phone says so and stays off) and shows the landing page")

    assert not errors, errors
    b.close()
print('\nAll TV direct tests passed.')
