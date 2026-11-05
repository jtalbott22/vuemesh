# Output settings and Record program's file: the program keeps its frame rate whether animation
# frames drive it or (the studio hidden or covered) the worker clock does; and Record program
# writes a normal MP4 (not fragmented: Windows' player can scrub it) at exactly the chosen rate,
# its sound as long as its picture. Checked with ffprobe, at 25 and at 29.97 with 1080p, with
# animation frames stopped as they are in a hidden window. And lip sync: this computer's sound
# waits for its camera's measured picture delay, or as long as set by hand, or not at all. (Needs ffmpeg.)
# Run: node dev/server.mjs &  then  python3 test/e2e_output.py
import os, json, subprocess, time, statistics
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
def probe(path):
    j = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-count_frames', '-of', 'json', path], capture_output=True, text=True).stdout)
    out = {'fragmented': b'moof' in open(path, 'rb').read()}
    for s in j['streams']:
        out[s['codec_type']] = s
    return out
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'], accept_downloads=True)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Output'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); host.wait_for_selector('.tile[data-peer^="local-cam"] video', timeout=10000)
    host.click('#localDlg form button')
    host.click('.tile[data-peer^="local-cam"]')

    def rate(secs=6):
        time.sleep(secs)
        rows = host.evaluate('vmShowLog().rows')[-(secs - 1):]
        return statistics.mean(r['fps'] for r in rows if r['fps'] is not None), rows[-1]['drv']
    # lip sync: this computer's sound waits for its camera's picture (measured), by hand, or not at all
    for _ in range(40):   # (measured from the camera's frames, applied every 2 s)
        cam = next((x for x in host.evaluate('vmShowLog().rows.at(-1).s') if x['k'] == 'cam'), {})
        if cam.get('vl') is not None and cam.get('sd'): break
        time.sleep(0.5)
    assert 0 < cam['vl'] < 400 and abs(cam['sd'] - (cam['vl'] + 500 / 30)) < 25, cam
    host.select_option('#lipMode', 'manual'); host.fill('#lipMs', '150'); host.evaluate("document.querySelector('#lipMs').dispatchEvent(new Event('change'))")
    host.wait_for_function("vmShowLog().rows.at(-1).s.every(x => x.sd === 150)", timeout=8000)
    host.select_option('#lipMode', 'off')
    host.wait_for_function("vmShowLog().rows.at(-1).s.every(x => !x.sd)", timeout=8000)
    host.select_option('#lipMode', 'auto')
    step(f"lip sync: the camera's picture reaches the program {cam['vl']} ms after it's taken, so its sound waits {cam['sd']} ms; by hand 150 ms; straight in, none")

    host.select_option('#outFps', '25')
    r25, d25 = rate()
    assert abs(r25 - 25) < 0.6 and d25 == 'raf', (r25, d25)
    step(f'Output 25: the program runs at {r25:.2f} frames a second on animation frames')

    press = lambda: host.evaluate("document.querySelector('#recProgBtn').click()")
    def record(secs):
        press()   # (Playwright's own clicks wait for animation frames, which are stopped in the second half)
        time.sleep(0.5)
        assert host.is_disabled('#outFps') and host.is_disabled('#outSize'), 'fixed while recording'
        time.sleep(secs)
        with host.expect_download(timeout=60000) as dl:
            press()
        host.wait_for_function("!document.querySelector('#outFps').disabled", timeout=10000)
        return probe(dl.value.path())
    f = record(8)
    v, a = f['video'], f['audio']
    assert not f['fragmented'] and v['codec_name'] == 'h264' and v['r_frame_rate'] == v['avg_frame_rate'] == '25/1', (f['fragmented'], v['r_frame_rate'], v['avg_frame_rate'])
    assert abs(float(v['duration']) - float(a['duration'])) < 0.15 and int(v['nb_read_frames']) >= 25 * 7, (v['duration'], a['duration'], v['nb_read_frames'])
    step(f"Record program at 25: a normal MP4 (not fragmented), H.264 at exactly {v['avg_frame_rate']}, {v['nb_read_frames']} frames, {v['width']}x{v['height']}; sound ({a['codec_name']}) {a['duration']} s, picture {v['duration']} s; settings fixed while it ran")

    host.select_option('#outFps', '29.97'); host.select_option('#outSize', '1080')
    host.evaluate("window.requestAnimationFrame = () => 0")   # (what a hidden or covered window gets: no animation frames)
    r, d = rate()
    assert abs(r - 29.97) < 0.6 and d == 'tick', (r, d)
    f = record(8)
    v, a = f['video'], f['audio']
    assert not f['fragmented'] and v['avg_frame_rate'] == '30000/1001' and (v['width'], v['height']) == (1920, 1080), (v['avg_frame_rate'], v['width'])
    assert abs(float(v['duration']) - float(a['duration'])) < 0.15, (v['duration'], a['duration'])
    rs = [x for x in host.evaluate('vmShowLog().rows') if x.get('rs')]
    step(f"no animation frames (as when hidden): the worker clock keeps {r:.2f} a second, and Record program at 29.97 1080p is exactly {v['avg_frame_rate']} at {v['width']}x{v['height']}, sound and picture {a['duration']} / {v['duration']} s; the show log followed it ({len(rs)} seconds, last {rs[-1]['rs'] if rs else None})")
    assert rs, 'the show log records the recorder'
    assert not errors, errors
    b.close()
