# Every source that aired is in Edit, not black. Another computer's screen (/share) records
# nothing itself, so the studio records it while it's on air (as it arrives), and its time on air
# comes from that. A phone whose clips aren't here (still sending, or kept on the phone: here,
# this show keeps clips on the phones) is filled from the program as aired, at the same moment.
# Edit's sound: the program's sound as aired under the whole edit by default (the shots' own sound
# at nothing until turned up); switched off, each shot's own, with the program's only under a shot
# with none of its own (a webcam or a screen added without sound).
# On air during Record program: this computer's webcam, the other computer's screen, the phone,
# the webcam again.
# Run: node dev/server.mjs &  then  python3 test/e2e_remotescreenrec.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

# the other computer's screen: blue, with a moving white square
SCREEN = """(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const draw = () => { g.fillStyle = '#2040c0'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.fillRect((performance.now() / 5) % 1240, 340, 40, 40); };
    draw(); setInterval(draw, 50);
    const s = c.captureStream(30);
    const v = s.getVideoTracks()[0];
    if (v) v.getSettings = () => ({ width: 1280, height: 720, displaySurface: 'monitor' });
    return s;
  };
})();"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'], accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Every source in Edit'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=45000)
    def hclick(sel):   # (clicked inside the page: a busy machine can be too slow for Playwright's click checks)
        host.evaluate(f"(() => {{ const t = {sel!r}; const m = t.match(/^(.*):has-text\\(\"(.*)\"\\)$/); const el = m ? [...document.querySelectorAll(m[1])].find(e => e.textContent.includes(m[2])) : document.querySelector(t); el.click(); }})()")

    # this computer's webcam
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.click('#localDlg form button')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video').readyState >= 2", timeout=15000)

    # another computer's screen, over /share
    other = b.new_context(viewport={'width': 1000, 'height': 800})
    other.add_init_script(SCREEN)
    sh = other.new_page(); sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f"{BASE}/share?e={ev['id']}")
    sh.fill('#name', 'Presenter Mac'); sh.click('#shareBtn')
    sh.wait_for_function("document.querySelector('#linkSay').textContent.startsWith('In the studio')", timeout=20000)
    host.wait_for_function("[...document.querySelectorAll('.tile')].some((t) => t.textContent.includes('Presenter Mac') && t.querySelector('video')?.readyState >= 2)", timeout=20000)
    host.wait_for_function("vmNotes().some((n) => n.includes(\"Presenter Mac is another computer's screen\"))", timeout=15000)

    # a phone that keeps its clips (they never reach the studio, as a phone's still sending wouldn't yet)
    ph = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 844, 'height': 390}).new_page()
    ph.on('pageerror', lambda e: errors.append(f'phone: {e}')); ph.on('dialog', lambda d: d.accept())
    ph.goto(f"{BASE}/cam?e={ev['id']}")
    ph.evaluate(f"localStorage.setItem('vm_noupload_{ev['id']}', '1')")
    ph.goto(f"{BASE}/cam?e={ev['id']}"); ph.fill('#name', 'Ana'); ph.check('#agreeGuest'); ph.click('#joinForm button[type=submit]')
    host.wait_for_function("[...document.querySelectorAll('.tile')].some((t) => t.textContent.includes('Ana') && t.querySelector('video')?.readyState >= 2)", timeout=45000)
    time.sleep(1)

    with host.expect_download(timeout=120000):
        hclick('.tile[data-peer^="local-cam"]'); time.sleep(0.5)
        hclick('#recProgBtn'); time.sleep(3)                           # the webcam on air
        hclick('.tile:has-text("Presenter Mac")')
        host.wait_for_function("vmNotes().some((n) => n.startsWith('Recording Presenter Mac (here, as it arrives'))", timeout=10000)
        step('another computer\'s screen on air during Record program: the studio records it ("' + next(n for n in host.evaluate('vmNotes()') if n.startswith('Recording Presenter Mac')) + '")')
        time.sleep(5)                                                   # the screen, 5 s
        hclick('.tile:has-text("Ana")'); time.sleep(4)                  # the phone, 4 s (its clip stays on the phone)
        hclick('.tile[data-peer^="local-cam"]'); time.sleep(3)          # the webcam again
        hclick('#recProgBtn')
        confirm = host.locator('dialog[open] button:has-text("Stop")')
        if confirm.count(): confirm.first.click()

    # the screen's recording arrives (it's finished 5 s after it went off air)
    host.wait_for_function("vmClipList().some((c) => c.name === 'Presenter Mac' && c.kind === 'video' && c.dur > 3000) && vmClipList().some((c) => c.program)", timeout=30000)
    scr = next(c for c in host.evaluate('vmClipList()') if c['name'] == 'Presenter Mac')
    assert not any(c['name'] == 'Ana' for c in host.evaluate('vmClipList()')), 'the phone kept its clips'
    step(f"its recording reached Edit's Media ({scr['dur'] / 1000:.1f} s); the phone's didn't (it keeps its clips)")
    host.keyboard.press('Escape'); time.sleep(0.3)   # (the end-of-recording summary)

    ed = edit_window(host.context, host, errors)
    for _ in range(60):
        prog = ed.evaluate('vmProgram()')
        if any(i['screen'] for i in prog) and any(i['fill'] for i in prog): break
        time.sleep(0.5)
    shown = [(i['name'], round(i['dur'] / 1000, 1), 'fill' if i['fill'] else '') for i in prog]
    scr_items = [i for i in prog if i['screen'] and not i['fill']]
    fills = [i for i in prog if i['fill']]
    assert scr_items and 3500 < sum(i['dur'] for i in scr_items) < 6500, shown
    assert fills and all(i['program'] for i in fills), shown
    fill = max(fills, key=lambda i: i['dur'])
    assert 2500 < fill['dur'] < 5500, shown
    # the fill sits where the phone was on air: right after the screen
    after = [i for i in prog if i['start'] >= scr_items[-1]['start'] + scr_items[-1]['dur'] - 50]
    assert after and after[0]['fill'], shown
    step(f"Edit's timeline has every source that aired: the screen from its own recording, the phone's time on air from the program as aired: {shown}")

    # and the picture there isn't black: the screen's stretch shows its blue, the phone's the program's
    def pic_at(ms):
        ed.evaluate(f'vmSeek({ms})'); time.sleep(1.2)
        return ed.evaluate("""() => { const c = document.querySelector('#program'), g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
          const x = g.getContext('2d'); x.drawImage(c, 0, 0); return [...x.getImageData(c.width / 4, c.height / 4, 1, 1).data.slice(0, 3)]; }""")
    s_px = pic_at(scr_items[0]['start'] + 1500)
    assert s_px[2] > 140 and s_px[0] < 80, s_px
    f_px = pic_at(fill['start'] + 1500)
    assert max(f_px) > 30, f_px
    step(f"not black in Edit: the screen's stretch is its blue {s_px}, the phone's stretch shows what aired {f_px}")

    # sound. By default the program's sound as aired plays under the whole edit, and the shots' own
    # sound starts at nothing (the program has it already: both would be the same sound twice)
    snd = dict(host.evaluate("""(async () => (await (await import('/js/idb.js')).list('clips', new URLSearchParams(location.search).get('e'))).filter((c) => c.kind === 'video' && !c.program).map((c) => [c.name, c.sound ?? null]))()"""))
    assert snd.get('Presenter Mac') is False, snd   # (this test's shared screen has no sound: its recording says so)
    seq_now = lambda: ed.evaluate("JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')) || '{}').tracks || []")
    for _ in range(40):
        tracks = seq_now(); aired = next((t for t in tracks if t.get('aired')), None)
        if aired and aired['items']: break
        time.sleep(0.5)
    assert aired and aired['items'], [t.get('name') for t in tracks]
    assert ed.is_visible('#soundAsAiredRow') and ed.is_checked('#soundAsAired')
    covered = sum(a['dur'] for a in aired['items']); total = sum(i['dur'] for i in prog)
    cam = next(t for t in tracks if t.get('follow'))
    assert abs(covered - total) < 200 and cam['gain'] == 0, (covered, total, cam['gain'], [(a['start'], a['dur'], a['in']) for a in aired['items']])
    def loudest(at_ms):   # (the fake microphone beeps about once a second: the loudest moment over 2.5 s of playing)
        ed.evaluate(f"vmSeek({at_ms})"); time.sleep(0.8)
        return ed.evaluate("""(async () => { vmPlay(true); const top = {};
          for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 50)); for (const [k, v] of Object.entries(vmEditLevels())) top[k] = Math.max(top[k] || 0, v); }
          vmPlay(false); return top; })()""")
    cams = [i for i in prog if not i['fill'] and snd.get(i['name']) is True]
    lv = loudest(cams[0]['start'] + 500)
    assert lv['aired'] > 0.01 and lv['camera'] < 0.001, lv
    step(f"by default the program's sound as aired plays under the whole edit ({covered / 1000:.1f} of {total / 1000:.1f} s), the shots' own sound at nothing until turned up: under the webcam, levels {({k: round(v, 3) for k, v in lv.items()})}")

    # switched off: each shot's own sound, and the program's only under the shot with none (the screen's)
    ed.click('#soundAsAiredRow'); time.sleep(0.8)
    assert not ed.is_checked('#soundAsAired')
    tracks = seq_now(); aired = next((t for t in tracks if t.get('aired')), None); cam = next(t for t in tracks if t.get('follow'))
    silent = [i for i in prog if not i['fill'] and snd.get(i['name']) is False]
    assert cam['gain'] == 1 and aired and silent, (cam, aired)
    assert all(any(a['start'] <= c['start'] + 50 and a['start'] + a['dur'] >= c['start'] + c['dur'] - 50 for a in aired['items']) for c in silent), (silent, aired['items'])
    assert not any(a['start'] < c['start'] + c['dur'] - 50 and a['start'] + a['dur'] > c['start'] + 50 for a in aired['items'] for c in cams), 'not under shots with their own sound'
    lv = loudest(silent[0]['start'] + 500)
    assert lv['aired'] > 0.01 and lv['master'] > 0.01, lv
    step(f"switched off: each shot's own sound, and the sound as aired only under the screen's shot (it has none of its own), playing there: levels {({k: round(v, 3) for k, v in lv.items()})}")

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
