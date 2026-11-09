# A TV showing phones and screens itself, with no studio (/tv?direct, tvdirect.js): the TV makes its
# own code, a phone's camera (/cam) and another computer's screen (/share) join it with that code,
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
    tv.click('#directBtn')
    code = wait(tv, "() => window.vmTvDirect?.().code", "the TV's own code")
    assert tv.locator('#dCode').inner_text() == code and len(code) == 6, code
    assert tv.evaluate("document.body.classList.contains('dempty') && !document.querySelector('#dJoin').hidden")
    assert tv.evaluate("document.querySelector('#dQr').width > 100")
    step(f'the TV has its own code ({code}), and the join card fills the screen')

    # the same code after a reload: it goes back to showing cameras by itself
    tv.reload()
    again = wait(tv, "() => window.vmTvDirect?.().code", 'the code after a reload')
    assert again == code, (again, code)
    assert tv.evaluate("!document.querySelector('#directView').hidden && document.querySelector('#joinView').hidden")
    step('after a reload: still showing cameras, with the same code')

    # a phone's camera joins with the code
    camx = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone'])
    camx.add_init_script(CAPTURE_PCS)
    cam = camx.new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f'{BASE}/cam?e={code}')
    terms = cam.locator('#terms').inner_text()
    assert 'TV screen' in terms and 'Nothing is recorded' in terms, terms
    cam.fill('#name', 'Ana')
    if cam.locator('#agreeGuest').count():
        cam.check('#agreeGuest')
    cam.click('#joinForm button[type=submit]')
    wait(tv, "() => window.vmTvDirect().tiles.some((t) => t.name === 'Ana' && t.playing)", "Ana's picture on the TV", 40)
    assert tv.evaluate("!document.body.classList.contains('dempty') && document.querySelector('#dTiles').dataset.n === '1'")
    step("the phone's camera is on the TV, full screen; the join card went to a corner")
    s = wait(cam, SENDING, "the phone's link")
    wait(cam, "() => !document.querySelector('#tally').hidden", "the phone's light on (it's on the TV)", 10)
    time.sleep(1.5)
    assert not cam.evaluate("!!window.vmRec?.().recording"), cam.evaluate("window.vmRec?.()")
    s = cam.evaluate(SENDING)
    assert s['kbps'] >= 2500 and s['scale'] == 1, s
    step(f"the phone sends its full picture ({s['kbps']} kbit/s), and isn't recording")
    status = cam.evaluate("document.querySelector('#upPill')?.textContent || ''")
    assert 'host' not in status.lower(), status
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

    # the phone leaves: its tile goes; the screen leaves: the join card fills the screen again
    camx.close()
    wait(tv, "() => window.vmTvDirect().tiles.length === 1", "Ana's tile gone", 40)
    sh.click('#stopBtn')
    wait(tv, "() => window.vmTvDirect().tiles.length === 0 && document.body.classList.contains('dempty')", 'the join card back', 40)
    step('as each leaves its tile goes, and with none left the join card fills the screen again')

    tv.click('#dStop')
    wait(tv, "() => !document.querySelector('#joinView').hidden", 'the join screen', 5)
    tv.reload()
    time.sleep(1)
    assert tv.evaluate("!document.querySelector('#joinView').hidden && document.querySelector('#directView').hidden")
    step('Stop goes back to the join screen, and stays there after a reload')

    assert not errors, errors
    b.close()
print('\nAll TV direct tests passed.')
