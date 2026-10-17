# Cameras and microphones on the studio computer: + This computer lists them (after the
# browser's OK); added ones are sources like phones (THIS PC on the tile, a number, on air,
# preview, Camera control, the mixer). A camera records while it's on air and its recording
# lands in Edit on the studio's own clock (no beacon); a microphone records while it's in the
# show; removing it finishes its recording; they come back when the studio reopens.
# Run: node dev/server.mjs &  then  python3 test/e2e_local.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
CLIPS = "(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.map(c => ({ kind: c.kind, local: !!c.local, src: c.t0Source, name: c.name, dur: c.dur, size: c.blob.size }))); }; }))()"
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})   # (no permissions yet: the picker asks)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())   # ("Leave site?" while recording: yes)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Desk show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    cams = host.eval_on_selector_all('#localList [data-add="cam"]', 'e => e.length'); mics = host.eval_on_selector_all('#localList [data-add="mic"]', 'e => e.length')
    snd = host.eval_on_selector('#localList [data-snd] >> nth=0', 's => s.selectedOptions[0]?.textContent')
    assert snd and snd != 'No sound', snd
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    m = next(x for x in host.evaluate('vmMedia()') if x['peer'].startswith('local-cam'))
    assert m['audioTracks'] == ['live'] and m['hearing'], m
    step(f'the camera came with its sound ("{snd}" picked for it in the picker): one source, picture and sound, with its own mixer strip')
    host.click('#localList [data-add="mic"] >> nth=0'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=10000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=15000)
    badge = host.inner_text('.tile[data-peer^="local-cam"] .route')
    assert badge == 'THIS PC' and not host.query_selector('.tile[data-peer^="local-cam"] .nosync'), badge
    step(f'+ This computer listed {cams} camera(s) and {mics} microphone(s); one of each added: the camera tile says {badge} (no beacon sync needed), the mic has its own tile')

    host.click('.tile[data-peer^="local-cam"]'); time.sleep(0.8)
    label = host.inner_text('#progLabel')
    assert 'ON AIR' in label, label
    rec_dot = host.is_visible('.tile[data-peer^="local-cam"] .rec')
    time.sleep(4)
    host.click('#swTgl') if host.is_hidden('#switcher') else None
    host.keyboard.press('b'); time.sleep(6.5)   # off air (a break): its recording stops 5 s later
    for _ in range(40):
        clips = host.evaluate(CLIPS)
        if any(c['kind'] == 'video' for c in clips): break
        time.sleep(0.5)
    v = next(c for c in clips if c['kind'] == 'video')
    has_sound = host.evaluate("""(async () => { const all = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; });
      const c = all.find(x => x.kind === 'video' && x.local); const ac = new AudioContext(); try { const b = await ac.decodeAudioData(await c.blob.arrayBuffer()); return b.duration; } catch { return 0; } })()""")
    assert has_sound > 2, has_sound
    v['sound_s'] = round(has_sound, 1)
    assert rec_dot and v['local'] and v['src'] == 'studio' and v['dur'] > 3000 and v['size'] > 50000, (rec_dot, v)
    host.keyboard.press('b')
    step(f"on air it recorded (red dot); off air it stopped and its recording landed on the studio's own clock: {v}")

    # in Edit, that recording plays with its sound (Camera sound, following the picture)
    ed = edit_window(host.context, host, errors); time.sleep(1.5)
    # (the timeline starts with the earliest recording, here the microphone's: play from the camera's first shot)
    ed.evaluate("vmSeek(vmProgram().find(i => i.type === 'clip' && i.local).start + 300)")
    ed.locator('body').click(position={'x': 800, 'y': 360}); ed.keyboard.press('Space')
    for _ in range(100):
        els = [e for e in ed.evaluate('vmEdit()')['els'] if e['bus'] == 't-cam']
        if els and not els[0]['paused'] and els[0]['ready'] >= 3: break
        time.sleep(0.2)
    lv = []
    for _ in range(25):
        lv.append(max(ed.evaluate("[...document.querySelectorAll('#pMeters .pm .fill, #bridge .vstrip.master .fill')].map(f => parseFloat(f.style.getPropertyValue('--lvl')) || 0)") or [0])); time.sleep(0.1)
    ed.keyboard.press('Space')
    diag = ed.evaluate("(async () => (await vmDiag()).find(s => s[0] === 'Edit sound')[1])()")
    # (going to Edit also finished the microphone's recording so far: where it covers, camera sound ducks under it)
    ducked = any(d.startswith('Microphone recordings cover') and not d.startswith('Microphone recordings cover 0 s') for d in diag)
    assert els and (els[0]['gain'] > 0.9 or ducked) and max(lv) > 5 and any('sound yes' in d and 'this computer' in d for d in diag), (els, diag, max(lv))
    step(f"in Edit the recording has its sound and the program is heard (meters up to {max(lv):.0f}%{', the microphone covering it' if ducked else ''}); diagnostics say: \"{next(d for d in diag if 'this computer' in d)}\"")
    host.bring_to_front(); time.sleep(0.8)

    with ctx.expect_page() as pop: host.click('#ccuBtn')
    w = pop.value; w.wait_for_selector('.cam [data-k="z"]', timeout=15000)
    hint = w.inner_text('.cam .hint') if w.query_selector('.cam .hint') else ''
    assert 'no beacon' in hint and not w.query_selector('.cam [data-msg]'), hint
    w.close(); host.bring_to_front()
    step(f'Camera control has a strip for it ("{hint}"), no message box; its own controls where the camera has them')

    strips = host.eval_on_selector_all('#bridge .vstrip', 'e => e.map(x => x.textContent.trim().slice(0, 30))')
    assert any('ake' in s or 'Mic' in s or 'mic' in s.lower() for s in strips), strips
    host.click('button.mic[data-peer^="local-mic"]', button='right'); host.click('text=Remove from the show')
    for _ in range(40):
        clips = host.evaluate(CLIPS)
        if any(c['kind'] == 'audio' for c in clips): break
        time.sleep(0.5)
    a = next(c for c in clips if c['kind'] == 'audio')
    assert a['local'] and a['src'] == 'studio' and a['dur'] > 5000, a
    step(f"the microphone had its own mixer strip and recorded the whole time; removing it finished its recording: {a}")

    ctx.grant_permissions(['camera', 'microphone'])   # (as when the browser remembers its OK for this site)
    host.reload(); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.wait_for_selector('.tile[data-peer^="local-cam"]', timeout=10000)
    assert not host.query_selector('button.mic[data-peer^="local-mic"]')
    step('reopening the studio brought the camera back by itself (the removed microphone stayed out)')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
