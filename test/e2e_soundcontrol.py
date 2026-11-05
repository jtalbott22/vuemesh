# Sound you control, with cameras and a microphone on the studio computer:
#  - a device that stops (a USB interface dropping out) is opened again into the same source:
#    the same channel, its sound mode kept, and the alert clears;
#  - a camera's Sound from: its sound from another microphone (or none), kept for that camera
#    when it's added again;
#  - AFV follows a camera you choose: a microphone heard only while that camera is on air;
#  - the phone remote's mixer: each channel's level as it is, and its mode and fader from the phone.
# Run: node dev/server.mjs &  then  python3 test/e2e_soundcontrol.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sound'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.evaluate("localStorage.removeItem('vm_camsound')")
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    for _ in range(2):
        host.click('#localList [data-add="cam"] >> nth=0'); time.sleep(1.2)
    host.click('#localList [data-add="mic"] >> nth=0'); time.sleep(1)
    host.click('#localDlg form button')
    media = host.evaluate('vmMedia()')
    cams = [m['peer'] for m in media if m['peer'].startswith('local-cam')]
    mic = next(m['peer'] for m in media if m['peer'].startswith('local-mic'))
    host.click(f'.tile[data-peer="{cams[0]}"]'); time.sleep(1)
    open_ = lambda peer: host.evaluate(f"vmShowLog().rows.at(-1).s.find(x => x.id === '{peer}')?.open")

    # 1. the microphone's device stops, and comes back into the same source
    host.evaluate(f"vmEndSound('{mic}')")
    host.wait_for_function(f"vmReopening().some(x => x.peer === '{mic}')", timeout=3000)
    host.wait_for_function(f"!vmReopening().length && vmMedia().find(m => m.peer === '{mic}')?.audioTracks[0] === 'live' && vmMedia().find(m => m.peer === '{mic}').hearing", timeout=15000)
    time.sleep(2.5)
    notes = host.evaluate('vmNotes()')
    back = next(n for n in notes if 'is back' in n)
    assert open_(mic) == 1 and not host.evaluate('vmShowLog().alerts').__len__(), (open_(mic), host.evaluate('vmShowLog().alerts'))
    step(f'the microphone\'s device stopped and came back into the same source, still in the mix, no alert left: "{back}"')

    # 2. Sound from: the second camera takes its sound from the microphone
    host.wait_for_selector(f'[data-sndfrom="{cams[1]}"]', state='attached', timeout=5000)
    opts = host.eval_on_selector(f'[data-sndfrom="{cams[1]}"]', 'e => [...e.options].map(o => [o.value, o.textContent])')
    before = host.evaluate(f"vmMedia().find(m => m.peer === '{cams[1]}').audioTracks")
    host.select_option(f'[data-sndfrom="{cams[1]}"]', '')   # no sound
    host.wait_for_function(f"vmMedia().find(m => m.peer === '{cams[1]}').audioTracks.length === 0", timeout=5000)
    other = next(v for v, _ in opts if v)
    host.select_option(f'[data-sndfrom="{cams[1]}"]', other)
    host.wait_for_function(f"vmMedia().find(m => m.peer === '{cams[1]}').audioTracks[0] === 'live' && vmMedia().find(m => m.peer === '{cams[1]}').hearing", timeout=8000)
    saved = host.evaluate("JSON.parse(localStorage.getItem('vm_camsound'))")
    assert len(saved) == 1 and list(saved.values())[0]['micId'] == other, saved
    step(f"Sound from: the second camera with no sound, then sound from \"{dict(opts)[other]}\" (it had {before}); kept for that camera on this computer")

    # 3. AFV follows: the microphone heard only while the second camera is on air
    strip = host.evaluate("[...document.querySelectorAll('#bridge [data-strip]')].find(e => e.querySelector('.vname')?.textContent.startsWith('Mic')).dataset.strip")
    host.click(f'#bridge [data-strip="{strip}"] [data-amode="afv"]')
    host.wait_for_selector(f'#bridge [data-follow="{strip}"]', state='attached', timeout=5000)
    cam2_cid = host.eval_on_selector(f'#bridge [data-follow="{strip}"]', "e => [...e.options].map(o => o.value).filter(Boolean)[1] || [...e.options].map(o => o.value).filter(Boolean)[0]")
    label = host.eval_on_selector(f'#bridge [data-follow="{strip}"]', f"e => [...e.options].find(o => o.value === '{cam2_cid}').textContent")
    host.select_option(f'#bridge [data-follow="{strip}"]', cam2_cid)
    target = next(c for c in cams if host.evaluate(f"document.querySelector('.tile[data-peer=\"{c}\"] .who')?.textContent") and label.endswith(host.evaluate(f"document.querySelector('.tile[data-peer=\"{c}\"] .who').textContent")))
    elsewhere = next(c for c in cams if c != target)
    host.click(f'.tile[data-peer="{elsewhere}"]'); time.sleep(2.5)
    off = open_(mic)
    host.click(f'.tile[data-peer="{target}"]'); time.sleep(2.5)
    on = open_(mic)
    assert off == 0 and on == 1, (off, on)
    step(f'AFV follows "{label}": the microphone is out of the mix with the other camera on air, in with that one')

    # 4. the phone remote's mixer: a channel's mode and level from the phone
    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    rem = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}'))
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function("!document.querySelector('#mix').hidden && document.querySelectorAll('#mix [data-ch]').length === 3", timeout=30000)
    rem.wait_for_function("[...document.querySelectorAll('#mix .lv i')].some(i => parseFloat(i.style.width) > 0)", timeout=10000)
    cam1 = host.evaluate(f"vmMedia().find(m => m.peer === '{cams[0]}')") and next(s for s in host.evaluate("[...document.querySelectorAll('#bridge [data-strip]')].map(e => e.dataset.strip)") if host.evaluate(f"document.querySelector('#bridge [data-strip=\"{s}\"] .vname').textContent.includes('fake_device_0')"))
    rem.click(f'#mix [data-ch="{cam1}"] [data-mode="on"]')
    host.wait_for_function(f"document.querySelector('#bridge [data-strip=\"{cam1}\"] [data-amode=on]').getAttribute('aria-pressed') === 'true'", timeout=8000)
    rem.eval_on_selector(f'#mix [data-ch="{cam1}"] input[type=range]', "e => { e.value = '-12'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }")
    host.wait_for_function(f"document.querySelector('#bridge [data-strip=\"{cam1}\"] .db').textContent.trim() === '-12 dB'", timeout=8000)
    rem.wait_for_function(f"document.querySelector('#mix [data-ch=\"{cam1}\"] [data-mode=on]').getAttribute('aria-pressed') === 'true'", timeout=8000)
    rows = rem.eval_on_selector_all('#mix [data-ch] .nm', 'els => els.map(e => e.textContent)')
    step(f"the phone remote's mixer: {rows} with their levels moving; ON and -12 dB from the phone, and the studio's mixer shows both")

    assert not errors, errors
    b.close()
