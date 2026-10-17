# v0.23: a podcast. Microphones are live sources: the first goes on air by itself (no break
# slate while there's sound), the phone shows ON AIR, clicking another microphone (or its
# number) puts that one on air, the auto director goes to whoever's talking, and the Edit
# page never shows the live break tag.
# Run: node dev/server.mjs &  then  python3 test/e2e_v23.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SPEECHY_MIC = """(() => {   // sound like speech: bursts of noise of random lengths (nothing repeats within 20 s)
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.audio && !c.video) {
      const ctx = new AudioContext(), n = ctx.sampleRate * 20, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      let s = 12345; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
      for (let i = 0; i < n;) { const len = Math.floor((0.05 + Math.abs(rnd()) * 0.3) * ctx.sampleRate), amp = Math.abs(rnd()) > 0.4 ? 0.35 * Math.abs(rnd()) : 0.002; for (let k = 0; k < len && i < n; k++, i++) d[i] = amp * rnd(); }
      const src = ctx.createBufferSource(), dst = ctx.createMediaStreamDestination(); src.buffer = buf; src.loop = true; src.connect(dst); src.start(); ctx.resume();
      return dst.stream;
    }
    return orig(c);
  };
})();"""
QUIET_MIC = SPEECHY_MIC.replace("0.35 * Math.abs(rnd()) : 0.002", "0.0004 * Math.abs(rnd()) : 0.0002")   # a guest who isn't talking
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    hctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = hctx.new_page(); errors = []; host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Podcast'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    mics = []
    for name, script in [('Ana', SPEECHY_MIC), ('Ben', QUIET_MIC)]:
        c = b.new_context(permissions=['camera', 'microphone']); c.add_init_script(script)
        m = c.new_page(); m.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); m.on('dialog', lambda d: d.accept())
        m.goto(f"{BASE}/cam?e={ev['id']}"); m.fill('#name', name); m.check('input[name=role][value=mic]'); m.check('#agreeGuest'); m.click('#joinForm button[type=submit]')
        m.wait_for_selector('#micView.on', timeout=10000); m.click('#micSkip'); m.wait_for_selector('#micStop', state='visible', timeout=20000); print('joined', name, flush=True)
        mics.append(m)
        if name == 'Ana':
            host.wait_for_function("document.querySelector('#progLabel').textContent.includes('MIC')", timeout=15000)
            mics[0].wait_for_selector('#micOnAir:not([hidden])', timeout=10000)
            step(f"a microphone on its own went on air by itself: \"{host.inner_text('#progLabel')}\", and Ana's phone shows ON AIR")
    host.wait_for_function("document.querySelectorAll('#multi button.mic').length === 2", timeout=15000); time.sleep(1)
    tiles = host.eval_on_selector_all('#multi button.mic', 'e => e.map(x => [x.querySelector(".glyph").textContent, x.querySelector("b").textContent, x.classList.contains("live")])')
    ben = next(t for t in tiles if 'Ben' in t[1])
    host.click('#multi button.mic:has-text("Ben")'); time.sleep(1)
    assert 'Ben' in host.inner_text('#progLabel'), host.inner_text('#progLabel')
    mics[1].wait_for_selector('#micOnAir:not([hidden])', timeout=8000)
    mics[0].wait_for_selector('#micOnAir', state='hidden', timeout=8000)
    assert host.is_hidden('#slateTag')
    step(f"microphones are live sources {[(n, w) for n, w, _ in tiles]}: clicking Ben put him on air (\"{host.inner_text('#progLabel')}\"), the tally moved to his phone; no break slate")
    ana = next(t for t in tiles if 'Ana' in t[1])
    host.locator('body').click(position={'x': 700, 'y': 300})
    host.keyboard.press(ana[0]); host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ana')", timeout=8000)
    host.keyboard.press(ben[0]); host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben')", timeout=8000)
    host.keyboard.press('a'); time.sleep(0.3)   # the auto director: whoever's talking (Ana)
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ana')", timeout=20000)
    step(f"number keys put each microphone on air ({ana[0]} Ana, {ben[0]} Ben), and with the auto director on it went to whoever's talking: \"{host.inner_text('#progLabel')}\"")
    host.keyboard.press('a')
    host.keyboard.press('b'); time.sleep(0.5)   # a break by hand still works
    assert host.is_visible('#slateTag') and host.inner_text('#slateTag') == 'BREAK'
    ed = edit_window(host.context, host, errors); time.sleep(0.8)
    assert ed.is_hidden('#slateTag'), 'break tag showed in Edit'
    host.bring_to_front(); time.sleep(0.5); host.keyboard.press('b'); time.sleep(0.5)
    step('the break tag shows in Live, never on the Edit page')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
