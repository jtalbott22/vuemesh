# Microphone mode: choose which microphone (a lav, a USB mic...), before and during
# recording, with the recording carrying on; and the room-code screen offering My events
# when the device already holds clips.
# Run: node dev/server.mjs &  then  python3 test/e2e_micpick.py
import os, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
def step(m): print('ok  ' + m, flush=True)
COUNT = "(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.filter(c => c.kind === 'audio').length); }; }))()"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1440, 'height': 900}).new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Mic night'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}&n=Mic%20night")  # (the name rides in the studio link; the phone hears it from the studio)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    ctx = b.new_context(viewport={'width': 412, 'height': 915}, user_agent=ANDROID, permissions=['camera', 'microphone'])
    mic = ctx.new_page(); mic.on('pageerror', lambda e: errors.append(f'mic: {e}')); mic.on('dialog', lambda d: d.accept())
    mic.goto(f"{BASE}/cam?e={ev['id']}"); mic.fill('#name', 'Table'); mic.check('input[name=role][value=mic]'); mic.check('#agreeGuest')
    mic.click('#joinForm button[type=submit]')
    mic.wait_for_selector('#micPick', state='visible', timeout=15000)
    options = mic.eval_on_selector_all('#micPick option', 'e => e.map(x => x.textContent)')
    label = lambda: mic.evaluate("(() => { const v = document.querySelector('#micPreview').srcObject; return v ? v.getAudioTracks()[0].label : ''; })()")
    first = label()
    mic.select_option('#micPick', index=1); time.sleep(1.2)
    second = label()
    assert len(options) >= 2 and second != first, (options, first, second)
    step(f'microphone mode lists {len(options)} microphones {options}; picked "{second}" before recording')

    mic.click('#micSkip'); time.sleep(2.5)
    mic.select_option('#micPick', index=2); time.sleep(2.5)
    picked = mic.evaluate("document.querySelector('#micPick').selectedOptions[0].textContent")
    mic.click('#micStop'); time.sleep(0.5)
    host.wait_for_function(f"{COUNT}.then(n => n >= 2)", timeout=40000)
    segs = host.evaluate("""(async () => { const all = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.filter(c => c.kind === 'audio').sort((a, b) => a.t0 - b.t0)); }; });
      return all.map(c => [c.t0, c.t0 + c.dur]); })()""")
    overlap = round((segs[0][1] - segs[1][0]) / 1000, 2)
    assert overlap > 0, segs
    step(f'switched to "{picked}" mid-recording: it carried on in a new piece that overlaps the last by {overlap}s; both reached the host')

    code = ctx.new_page(); code.on('pageerror', lambda e: errors.append(f'code: {e}'))
    code.goto(f"{BASE}/cam")
    code.wait_for_selector('#codeLib:not([hidden])', timeout=8000)
    text = code.inner_text('#codeLib')
    code.click('#codeLib'); code.wait_for_selector('#library:not([hidden])', timeout=5000)
    n = code.evaluate("document.querySelectorAll('#libList li').length")
    ev_name = code.evaluate("document.querySelector('#libEvent').selectedOptions[0]?.textContent")
    assert n >= 2 and 'Mic night' in ev_name, (n, ev_name)
    step(f'the room-code screen offers "{text}"; it opens on "{ev_name}" with {n} recordings')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
