# Edit sound with a camera and a microphone: camera sound plays wherever no microphone
# recording does, and steps aside (ducks) where one does; the Duck switch turns that off.
# (Before 0.24 camera sound went silent for the whole film once a microphone joined.)
# Run: node dev/server.mjs &  then  python3 test/e2e_editaudio.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox']   # no autoplay shortcut
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
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Edit sound'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('dialog', lambda d: d.accept())
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.keyboard.press('1'); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()"); time.sleep(6)
    # the microphone only covers the second half
    mc = b.new_context(permissions=['camera', 'microphone']); mc.add_init_script(SPEECHY_MIC)
    mic = mc.new_page(); mic.on('dialog', lambda d: d.accept())
    mic.goto(f"{BASE}/cam?e={ev['id']}"); mic.fill('#name', 'Table'); mic.check('input[name=role][value=mic]'); mic.check('#agreeGuest'); mic.click('#joinForm button[type=submit]')
    mic.wait_for_selector('#micView.on', timeout=10000); mic.click('#micSkip'); mic.wait_for_selector('#micStop', state='visible', timeout=20000)
    time.sleep(5); mic.click('#micStop'); time.sleep(1)
    cam.evaluate("document.querySelector('#shutter').click()")
    for _ in range(90):
        n = host.evaluate("""(async () => (await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; })))()""")
        if n >= 2: break
        time.sleep(0.5)
    assert n >= 2, n
    ed = edit_window(host.context, host, errors); time.sleep(2)
    def cam_el(): return next((e for e in ed.evaluate("vmEdit()")['els'] if e['bus'] == 't-cam'), None)
    tracks = {t['name']: t for t in ed.evaluate("vmEdit()")['tracks']}
    assert tracks['Camera sound']['gain'] == 1, tracks
    ed.locator('body').click(position={'x': 800, 'y': 360}); ed.keyboard.press('Home'); ed.keyboard.press('Space'); time.sleep(1.8)
    early = cam_el(); state = ed.evaluate("vmEdit()")
    assert early and not early['paused'] and early['gain'] > 0.9 and state['ctx'] == 'running', (early, state['ctx'])
    step(f"camera and microphone: Camera sound stays up (0 dB, Duck on); where only the camera recorded, its sound plays ({early})")
    for _ in range(60):
        e = cam_el()
        if e and e['gain'] < 0.05: break
        time.sleep(0.2)
    mic_el = next(x for x in ed.evaluate("vmEdit()")['els'] if x['bus'] and x['bus'].startswith('t-mic'))
    assert e['gain'] < 0.05 and mic_el['gain'] > 0.9 and not mic_el['paused'], (e, mic_el)
    step(f"where the microphone recorded, camera sound steps aside (camera {e['gain']}, microphone {mic_el['gain']})")
    ed.keyboard.press('Space')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
