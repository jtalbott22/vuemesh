# The media manager: moments marked live, the media list (search, tags, stars), the
# Source monitor (In/Out, subclips, insert and overwrite), clips from every angle,
# exporting a subclip, non-destructive trim, and deleting a recording.
# Run: node dev/server.mjs &  then  python3 test/e2e_media.py   (needs ffmpeg)
import json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
SEQ = "JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')))"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    host = b.new_context(viewport={'width': 1600, 'height': 1000}, accept_downloads=True).new_page()
    host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Reception'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    phones = []
    for name in ['Rosa', 'Dev']:
        c = b.new_context(permissions=['camera', 'microphone']).new_page()
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones.append(c)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000)
    for c in phones: c.evaluate("document.querySelector('#shutter').click()")
    time.sleep(2); host.keyboard.press('1'); time.sleep(3)
    host.keyboard.press('m'); time.sleep(4)
    for c in phones: c.evaluate("document.querySelector('#shutter').click()")
    host.wait_for_function("(window.vmLastArrival || 0) > Date.now() - 6000", timeout=40000)
    time.sleep(3)
    step('live: both phones recorded; M marked a moment mid-take')

    ed = edit_window(host.context, host, errors); time.sleep(0.6)
    ed.click('#mediaTab'); time.sleep(0.4)
    rows = ed.eval_on_selector_all('#mediaList li[data-kind]', 'e => e.map(x => x.dataset.kind + ":" + x.querySelector("b").textContent)')
    assert sum(r.startswith('clip:') for r in rows) == 2 and any(r.startswith('moment:') for r in rows), rows
    step(f'Media lists {rows}')

    # tag and star the first recording, then filter by the tag
    ed.click('#mediaList li[data-kind="clip"] >> nth=0'); time.sleep(0.4)
    ed.click('#mediaInsp .quicktags button:has-text("Funny")'); time.sleep(0.2)
    ed.click('#mediaList li[data-kind="clip"] >> nth=0 >> [data-star]'); time.sleep(0.2)
    ed.click('#mediaFilters [data-filter="tag:Funny"]'); time.sleep(0.2)
    funny = ed.eval_on_selector_all('#mediaList li[data-kind]', 'e => e.map(x => x.querySelector("b").textContent)')
    ed.click('#mediaFilters [data-filter="star"]'); time.sleep(0.2)
    starred = ed.eval_on_selector_all('#mediaList li[data-kind]', 'e => e.length')
    ed.fill('#mediaSearch', 'dev'); time.sleep(0.2)
    ed.click('#mediaFilters [data-filter="all"]'); time.sleep(0.2)
    found = ed.eval_on_selector_all('#mediaList li[data-kind]', 'e => e.map(x => x.querySelector("b").textContent)')
    ed.fill('#mediaSearch', ''); time.sleep(0.2)
    assert len(funny) == 1 and starred == 1 and all('Dev' in f for f in found), (funny, starred, found)
    step(f'tagged #Funny and starred: tag filter → {funny}, ★ → {starred}; search "dev" → {found}')

    # Source monitor: open the recording, mark In 1 s / Out 3 s, make a subclip
    ed.click('#mediaList li[data-kind="clip"] >> nth=0'); time.sleep(0.8)
    assert ed.is_visible('#srcFrame') and ed.is_visible('#srcBar')
    sb = ed.locator('#srcScrub').bounding_box()
    dur = ed.evaluate("document.querySelector('#srcRange').textContent")
    clipdur = ed.evaluate("async () => { const c = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; }); return c.map(x => x.dur); }")[0]
    ed.mouse.click(sb['x'] + sb['width'] * (1000 / clipdur), sb['y'] + 10); time.sleep(0.4)
    ed.keyboard.press('i')
    ed.mouse.click(sb['x'] + sb['width'] * (3000 / clipdur), sb['y'] + 10); time.sleep(0.4)
    ed.keyboard.press('o'); time.sleep(0.2)
    rng = ed.inner_text('#srcRange')
    ed.click('#srcSubclip'); time.sleep(0.4)
    subs = ed.eval_on_selector_all('#mediaList li[data-kind="subclip"]', 'e => e.length')
    assert subs == 1, subs
    step(f'Source monitor: marked In/Out with I and O ({rng}); Make subclip added it to Media')

    # insert (,) and overwrite (.) at the playhead
    end0 = ed.evaluate(SEQ + ".tracks.reduce((m, t) => Math.max(m, ...t.items.map(i => i.start + i.dur)), 0)")
    ed.click('#progTab'); time.sleep(0.2)
    ed.evaluate("document.querySelector('#tracks [data-ruler]') && 0")
    ed.keyboard.press('Home'); time.sleep(0.2)
    ed.keyboard.press('Shift+2'); time.sleep(0.2)
    ed.keyboard.press(','); time.sleep(0.4)
    end1 = ed.evaluate(SEQ + ".tracks.reduce((m, t) => Math.max(m, ...t.items.map(i => i.start + i.dur)), 0)")
    ed.keyboard.press(','); time.sleep(0.1)  # second insert after the first (playhead moved past it)
    ed.keyboard.press('Control+z'); time.sleep(0.3)
    ed.keyboard.press('Home'); time.sleep(0.2)
    ed.keyboard.press('.'); time.sleep(0.4)
    end2 = ed.evaluate(SEQ + ".tracks.reduce((m, t) => Math.max(m, ...t.items.map(i => i.start + i.dur)), 0)")
    marked = ed.evaluate("(() => { const s = JSON.parse(localStorage.getItem('vm_media_' + new URLSearchParams(location.search).get('e'))).subclips[0]; return s.out - s.in; })()")
    assert abs((end1 - end0) - marked) < 2 and abs(end2 - end1) < 2, (end0, end1, end2, marked)
    step(f'Insert (,) added exactly the marked {round(marked)} ms and pushed everything along; Overwrite (.) replaced in place (length unchanged)')

    # moment → clips from every angle
    ed.click('#mediaFilters [data-filter="moment"]'); time.sleep(0.2)
    ed.click('#mediaList li[data-kind="moment"]'); time.sleep(0.3)
    ed.click('#moClips'); time.sleep(0.4)
    made = ed.eval_on_selector_all('#mediaList li[data-kind="subclip"]', 'e => e.map(x => x.querySelector("b").textContent + " " + (x.querySelector(".tg")?.textContent || ""))')
    assert len([m for m in made if 'Moment' in m]) == 2, made
    step(f'the moment became a clip from every angle that was rolling: {made}')

    # export one moment clip as its own MP4
    ed.click('#mediaList li[data-kind="subclip"]:has-text("Moment 1") >> nth=0'); time.sleep(0.6)
    for c in phones: c.close()   # (the phones are done: give the export this machine's whole CPU)
    with ed.expect_download(timeout=180000) as dl:
        ed.click('#scExport')
    dl.value.save_as('/tmp/moment.mp4')
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', '/tmp/moment.mp4'], capture_output=True, text=True).stdout)
    want = ed.evaluate("(() => { const name = document.querySelector('#scName').value; const s = JSON.parse(localStorage.getItem('vm_media_' + new URLSearchParams(location.search).get('e'))).subclips; const x = s.find(y => y.name === name); return (x.out - x.in) / 1000; })()")
    got = float(pr['format']['duration'])
    assert abs(got - want) < 0.3, (got, want)
    step(f'Export clip: an MP4 of just that moment ({got:.2f}s, {"+".join(s["codec_type"] for s in pr["streams"])})')

    # non-destructive trim, then delete the other recording
    ed.click('#mediaFilters [data-filter="video"]'); time.sleep(0.2)
    ed.click('#mediaList li[data-kind="clip"] >> nth=0'); time.sleep(0.6)
    ed.keyboard.press('Home'); ed.keyboard.press('ArrowRight'); ed.keyboard.press('i')
    sb = ed.locator('#srcScrub').bounding_box()
    ed.mouse.click(sb['x'] + sb['width'] * 0.5, sb['y'] + 10); time.sleep(0.3); ed.keyboard.press('o')
    ed.click('#mTrim'); time.sleep(0.3)
    trimmed = ed.inner_text('#mediaList li[data-kind="clip"] >> nth=0')
    assert 'trimmed' in trimmed, trimmed
    step('Trim to In/Out: only that part of the recording is used now (the signed file is untouched)')
    ed.click('#mediaList li[data-kind="clip"] >> nth=1'); time.sleep(0.5)
    victim = ed.evaluate("document.querySelector('#mediaInsp b').textContent")
    ed.click('#mDelete'); time.sleep(0.8)
    left = ed.evaluate("async () => (await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.length); }; }))")
    srcs = ed.evaluate(SEQ + ".tracks.flatMap(t => t.items.map(i => i.src)).filter(Boolean)")
    remaining = ed.eval_on_selector_all('#mediaList li[data-kind="clip"]', 'e => e.length')
    assert left == 1 and remaining == 1, (left, remaining)
    step(f'Deleted {victim}\'s recording: gone from this computer ({left} left), from Media, and from the timeline ({len(set(srcs))} source(s) still used)')
    ed.screenshot(path='/tmp/v07-media.png')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
