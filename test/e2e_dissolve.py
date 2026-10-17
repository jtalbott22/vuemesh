# Dissolves in Edit: a live AUTO dissolve between two cameras arrives in the automatic edit as
# a dissolve (on the shot it went into, as long as it took live), marked on the timeline;
# halfway through it, both cameras play with their sound crossfading; the Selection panel
# changes it to a quarter second or a cut; and the export renders through it.
# Run: node dev/server.mjs &  then  python3 test/e2e_dissolve.py
import os, time, json, subprocess
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}')); host.on('dialog', lambda d: d.accept())   # ("Leave site?" while recording: yes)
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Dissolves'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    host.evaluate("document.querySelector('#recProgBtn').click()")   # (the director records the show: cameras on air record only then)
    ph = {}
    for name in ['Ana', 'Ben']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
        host.wait_for_function(f"[...document.querySelectorAll('.tile[data-peer] video')].filter(v => v.readyState >= 2).length === {len(ph)}", timeout=150000)
    assert host.eval_on_selector('#swDur', "s => [...s.options].map(o => o.value)")[0] == '0.25'
    def hclick(sel):   # (clicked inside the page: a busy machine can be too slow for Playwright's click checks)
        host.evaluate(f"(() => {{ const t = {sel!r}; const m = t.match(/^(.*):has-text\\(\"(.*)\"\\)$/); const el = m ? [...document.querySelectorAll(m[1])].find(e => e.textContent.includes(m[2])) : document.querySelector(t); el.click(); }})()")
    hclick('.tile[data-peer]:has-text("Ana")'); time.sleep(7)
    hclick('#swTgl'); hclick('#switcher [data-tap="preview"]'); hclick('.tile[data-peer]:has-text("Ben")'); time.sleep(0.5)
    host.evaluate("(() => { const s = document.querySelector('#swDur'); s.value = '1'; s.dispatchEvent(new Event('change')); })()"); hclick('#swAuto')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Ben') && !document.querySelector('#progLabel').textContent.includes('%')", timeout=60000)
    took = host.evaluate('vmSwitcher().lastTook')
    ben_rec = ph['Ben'].evaluate("!!document.querySelector('#shutter.rec, #shutter[aria-label*=\"Stop\"]')")
    time.sleep(7)
    ed = edit_window(host.context, host, errors)
    prog = []
    for _ in range(90):
        prog = ed.evaluate('vmProgram()')
        if any(i['dissolve'] for i in prog) and len(prog) >= 2: break
        time.sleep(0.5)
    d = next(i for i in prog if i['dissolve'])
    assert d['name'] == 'Ben' and abs(d['dissolve'] - took) < 400, (prog, took)
    assert ed.locator('.lane .item .xd').count() >= 1
    step(f"the live AUTO dissolve (1 s; {took} ms on this machine) is in the edit: on Ben's shot, {d['dissolve']} ms, marked on the timeline: {[(i['name'], i['dissolve']) for i in prog]}")

    ed.evaluate(f"vmSeek({d['start'] + d['dissolve'] / 2})"); time.sleep(1.5)
    els = [e for e in ed.evaluate('vmEdit()')['els'] if e['bus'] == 't-cam' and e['gain'] > 0.01]   # (players not in use sit at 0)
    gains = sorted(round(e['gain'], 2) for e in els)
    assert len(els) == 2 and all(0.2 < g < 0.8 for g in gains), els
    step(f'halfway through it both cameras play, their sound crossfading (gains {gains})')

    ed.click(f".lane .item[data-item=\"{d['id']}\"]"); ed.wait_for_selector('#selDissolve', timeout=5000)
    opts = ed.eval_on_selector('#selDissolve', 's => [...s.options].map(o => o.textContent)')
    ed.select_option('#selDissolve', '250'); time.sleep(0.4)
    q = next(i for i in ed.evaluate('vmProgram()') if i['id'] == d['id'])
    assert q['dissolve'] == 250, q
    step(f'the Selection panel offers {opts}; picking ¼ s makes it a quarter-second dissolve')

    # render through it
    ed.evaluate(f"vmSeek({d['start'] - 1000})"); ed.locator('.tlbar').click(position={'x': 5, 'y': 5}) if ed.query_selector('.tlbar') else None
    ed.locator('body').click(position={'x': 700, 'y': 300})
    ed.evaluate(f"vmSeek({d['start'] - 1000})"); ed.keyboard.press('i')
    ed.evaluate(f"vmSeek({d['start'] + 1500})"); ed.keyboard.press('o'); time.sleep(0.4)
    with ed.expect_download(timeout=180000) as dl:
        ed.click('#renderBtn')
    dl.value.save_as('/tmp/dissolve.mp4')
    dur = float(json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', '/tmp/dissolve.mp4'], capture_output=True, text=True).stdout)['format']['duration'])
    assert 2.2 < dur < 2.9, dur
    step(f'the export renders through the dissolve ({dur:.2f} s, In to Out around it)')
    for _ in ed.evaluate("[...document.querySelectorAll('dialog[open]')].map(d => d.id)"): ed.keyboard.press('Escape'); time.sleep(0.2)
    ed.click(f".lane .item[data-item=\"{d['id']}\"]"); ed.select_option('#selDissolve', '0'); time.sleep(0.4)
    assert next(i for i in ed.evaluate('vmProgram()') if i['id'] == d['id'])['dissolve'] == 0
    step('and Cut takes the dissolve off')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
