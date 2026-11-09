# Program out on the phone remote, from the moment it's paired: with no camera in the show and
# nothing on air, and without the phone's own camera (+ This phone) ever joining.
# - On a phone that plays video by itself: the program (the Starting soon slate) shows at once.
# - On a phone that won't play a video until the page is touched (an iPhone in Low Power Mode;
#   made here by a play() that refuses until the page has been touched): the picture still arrives,
#   the box says "Tap to show the program", the studio's show log says so, and the first tap
#   anywhere on the page (not only on the box) starts it, without opening it full screen.
# Run: node dev/server.mjs &  then  python3 test/e2e_remotepgm.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
# a phone that won't start a video before the page is touched
NO_AUTOPLAY = """(() => {
  const play = HTMLMediaElement.prototype.play;
  let touched = false; // (set by a real touch or key, before the page's own listeners hear it)
  for (const t of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(t, (e) => { if (e.isTrusted) touched = true; }, true);
  HTMLMediaElement.prototype.play = function () {
    if (!touched) return Promise.reject(new DOMException('needs a touch', 'NotAllowedError'));
    return play.call(this);
  };
  // (and nothing starts by itself either)
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay');
  Object.defineProperty(HTMLMediaElement.prototype, 'autoplay', { get() { return false; }, set() {}, configurable: true });
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('video[autoplay]').forEach((v) => v.removeAttribute('autoplay')));
})();"""

def pair(b, host, ev, init=None):
    host.evaluate("document.querySelectorAll('dialog[open]').forEach((d) => d.close())")
    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    if init:
        ctx.add_init_script(init)
    rem = ctx.new_page()
    rem.on('pageerror', lambda e: errors.append(f'remote: {e}'))
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function("!document.querySelector('#ctlView').hidden", timeout=20000)
    return rem

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    host.on('pageerror', lambda e: errors.append(f'studio: {e}'))
    host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Hall'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)

    # a phone that plays video by itself: the program at once, with no camera anywhere
    rem = pair(b, host, ev)
    t0 = time.time()
    rem.wait_for_function("vmProgramView()?.linked && vmProgramView().shown > 5 && vmProgramView().w > 0", timeout=10000)
    took = time.time() - t0
    assert took < 5 and not rem.evaluate("vmProgramView().tapShown"), took
    assert rem.evaluate("!vmRemoteCam?.()?.on"), 'the phone camera joined'
    step(f'paired, with no camera in the show or on the phone: Program out shows the program in {took:.1f} s')
    rem.context.close()

    # a phone that won't play until it's touched
    rem = pair(b, host, ev, NO_AUTOPLAY)
    rem.wait_for_function("vmProgramView()?.linked && vmProgramView().blocked && vmProgramView().tapShown", timeout=15000)
    assert rem.evaluate("vmProgramView().shown") == 0
    host.wait_for_function("vmNotes().some((t) => /has the picture but the phone won.t show it until it.s touched/.test(t))", timeout=10000)
    step('a phone that won\'t play a video by itself: "Tap to show the program", and the show log says so')

    rem.click('#status')  # (anywhere on the page, not the box)
    rem.wait_for_function("vmProgramView().shown > 5 && !vmProgramView().blocked && !vmProgramView().tapShown", timeout=10000)
    assert not rem.evaluate("vmProgramFull()"), 'the tap opened it full screen'
    host.wait_for_function("vmNotes().some((t) => /is showing the picture now/.test(t))", timeout=10000)
    step('the first tap anywhere starts it (not full screen), and the show log says it is showing')

    assert not errors, errors
    b.close()
print('\nAll remote Program out tests passed.')
