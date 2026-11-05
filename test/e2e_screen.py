# A screen or window, and this computer's sound, as sources: + This computer, Share… (the
# browser's own picker): the screen is a source like a camera, with its sound (a tile, on
# air, a mixer strip, recorded on air); "This computer's sound" is a microphone source. They
# aren't brought back next time (sharing asks each time). The computer's sound stays stereo
# in the mixer (two meters, each side its own), with a Mono switch and a balance.
# Run: node dev/server.mjs &  then  python3 test/e2e_screen.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
# shared sound in stereo: a loud left, a quieter right
STEREO_SHARE = """(() => {
  const orig = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getDisplayMedia = async (c) => {
    const s = await orig(c);
    const ctx = new AudioContext(), m = ctx.createChannelMerger(2), d = ctx.createMediaStreamDestination();
    for (const [ch, lvl] of [[0, 0.4], [1, 0.08]]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 440 + ch * 220; g.gain.value = lvl; o.connect(g); g.connect(m, 0, ch); o.start(); }
    m.connect(d); ctx.resume();
    s.getAudioTracks().forEach((t) => { s.removeTrack(t); t.stop(); });
    s.addTrack(d.stream.getAudioTracks()[0]);
    return s;
  };
})();"""
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(STEREO_SHARE)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Slides'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="screen"]', timeout=10000)
    host.click('#localList [data-share="screen"]'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=10000)
    name = host.inner_text('.tile[data-peer^="local-cam"]')
    m = next(x for x in host.evaluate('vmMedia()') if x['peer'].startswith('local-cam'))
    assert 'Screen' in name and m['audioTracks'] == ['live'], (name, m)
    host.click('.tile[data-peer^="local-cam"]'); time.sleep(1)
    assert 'Screen' in host.inner_text('#progLabel')
    step(f'shared the screen: a source called Screen with its sound (its own mixer strip), and it went on air: "{host.inner_text("#progLabel")}"')
    # recorded on air (Record program): from its own copy, at most 15 frames a second
    host.click('#recProgBtn')
    host.wait_for_function("vmMedia().some((x) => x.peer.startsWith('local-cam') && x.recording)", timeout=15000)
    rec = next(x for x in host.evaluate('vmMedia()') if x['peer'].startswith('local-cam'))['recording']
    assert rec['copy'] and rec['fps'] is not None and rec['fps'] <= 15.5, rec
    host.wait_for_function("vmNotes().some((n) => n.includes('Recording the program'))", timeout=15000)
    notes = [n for n in host.evaluate('vmNotes()') if 'Recording the program' in n]
    assert any('real-time' in n for n in notes) or any('recorder' in n for n in notes), notes

    step(f"on air with Record program: the screen records from its own copy at {rec['fps']:.0f} frames a second (not its full rate), and the program's encoder: \"{notes[-1]}\"")
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="sound"]', timeout=10000)
    host.click('#localList [data-share="sound"]'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=10000)
    mic = host.inner_text('button.mic[data-peer^="local-mic"]')
    assert 'Computer sound' in mic, mic
    step(f'This computer\'s sound: a microphone source ("{mic.strip().splitlines()[-1] if mic.strip() else mic}"), recording')
    strip = '#bridge .vstrip[data-strip^="L"]:has(.vname[title*="Computer sound"])'
    host.wait_for_selector(strip, timeout=5000)
    peaks = f"""() => [...document.querySelectorAll('{strip} .fill')].map((f) => parseFloat(f.style.getPropertyValue('--lvl')) || 0)"""
    assert host.get_attribute(f'{strip} [data-mono]', 'aria-pressed') == 'false'
    host.wait_for_function(f"(({peaks})()).length === 2 && (({peaks})())[0] > 50", timeout=8000)
    time.sleep(0.5); l, r = host.evaluate(peaks)
    assert l > r + 10 and r > 30, (l, r)
    step(f'its strip is stereo: two meters, each side its own (L {l:.0f}%, R {r:.0f}%)')
    host.fill(f'{strip} input[data-pan]', '-100'); host.dispatch_event(f'{strip} input[data-pan]', 'input'); time.sleep(0.8)
    l2, r2 = host.evaluate(peaks)
    assert l2 > 50 and r2 < 5, (l2, r2)
    host.dblclick(f'{strip} input[data-pan]'); time.sleep(0.8)
    assert host.input_value(f'{strip} input[data-pan]') == '0'
    step(f'balance hard left takes the right side away (L {l2:.0f}%, R {r2:.0f}%); double-click centres it')
    host.click(f'{strip} [data-mono]'); time.sleep(0.8)
    assert host.get_attribute(f'{strip} [data-mono]', 'aria-pressed') == 'true' and len(host.evaluate(peaks)) == 1
    host.click(f'{strip} [data-mono]'); time.sleep(0.8)
    assert len(host.evaluate(peaks)) == 2
    step('Mono folds it to one channel (one meter), and back to stereo')
    saved = host.evaluate("localStorage.getItem('vm_local_sources')")
    assert 'screen' not in (saved or '') and 'sound-' not in (saved or ''), saved
    step('neither is remembered for next time (sharing asks each time)')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
