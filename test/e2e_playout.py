# Live playout: clips (b-roll, commercials) ready in the Sources panel, a typed lower
# third, Program out that keeps running when it covers the studio, and the mixer dock
# that turns sideways when it's short. Needs ffmpeg for the test clip.
# Run: node dev/server.mjs &  then  python3 test/e2e_playout.py
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
CLIP = '/tmp/redclip.mp4'
if not os.path.exists(CLIP):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-t', '2.5', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest', CLIP], check=True)
PIX = "(([x, y]) => { const c = document.querySelector('#program'); const d = c.getContext('2d').getImageData(Math.round(c.width * x), Math.round(c.height * y), 1, 1).data; return [d[0], d[1], d[2]]; })"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Playout'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")  # (this suite predates recording on air)
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_selector('.tile[data-peer] video', timeout=20000); time.sleep(1)
    assert host.locator('#bus').count() == 0
    host.click('.tile[data-peer]'); time.sleep(0.6)
    assert 'Rosa' in host.inner_text('#progLabel')
    step(f"no cut buttons under the program; clicking the source tile cut to it ({host.inner_text('#progLabel')}); tile shows {host.inner_text('.tile[data-peer] .aud')}")

    host.set_input_files('#clipFiles', CLIP); time.sleep(1.5)
    t0 = host.evaluate("document.querySelector('.tile.media video').currentTime"); time.sleep(1)
    t1 = host.evaluate("document.querySelector('.tile.media video').currentTime")
    assert t1 != t0, (t0, t1)
    step(f"added a clip: its tile loops silently, ready ({host.inner_text('.tile.media .kind')}); the mixer gained a Clips strip: {'Clips' in host.inner_text('#bridge')}")

    host.click('.tile.media'); time.sleep(0.8)
    px = host.evaluate(PIX, [0.5, 0.4])
    assert px[0] > 180 and px[1] < 60, px
    label = host.inner_text('#progLabel')
    tally_off = cam.evaluate("!document.querySelector('#camView').classList.contains('onair')")
    step(f'clicked the clip: program shows it ({px}), label "{label}", the phone\'s ON AIR light is off ({tally_off})')
    host.wait_for_function("document.querySelector('#progLabel').textContent.includes('Rosa')", timeout=6000)
    step('plays once, then goes back to the camera by itself')

    host.click('.clipcard [data-loop]'); time.sleep(0.2)
    host.click('.tile.media'); time.sleep(3.5)
    assert 'CLIP' in host.inner_text('#progLabel')
    host.click('.tile[data-peer]'); time.sleep(0.5)
    assert 'Rosa' in host.inner_text('#progLabel')
    step('Loop on: still on air after its length; clicking the camera takes it off')

    host.fill('#ltText', 'Rosa Martinez'); host.fill('#ltSub', 'Maid of honour')
    host.uncheck('#ltAuto'); host.click('#ltShow'); time.sleep(0.6)
    box = host.evaluate(PIX, [0.06, 0.74])
    assert box[2] > box[1] and box[0] < 60, box
    host.locator('body').click(position={'x': 700, 'y': 300}); host.keyboard.press('t'); time.sleep(0.6)
    gone = host.evaluate(PIX, [0.06, 0.74])
    assert gone != box, (box, gone)
    recent = host.eval_on_selector_all('#ltRecent [data-lt]', 'e => e.map(x => x.textContent)')
    step(f'lower third: typed, shown over the program (dark panel {box}), T hid it again; recent: {recent}')

    with ctx.expect_page() as pop:
        host.click('#progOutBtn')
    out = pop.value
    out.wait_for_function("document.querySelector('#out').readyState >= 2", timeout=10000)
    waiting = out.evaluate("getComputedStyle(document.querySelector('#wait')).display")
    assert waiting == 'none', waiting
    # Now behave like a covered window: the studio's animation frames stop completely.
    host.evaluate("window.requestAnimationFrame = () => 0")
    time.sleep(0.5)
    frames = out.evaluate("new Promise(r => { const v = document.querySelector('#out'); let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) v.requestVideoFrameCallback(f); else r(n); }; v.requestVideoFrameCallback(f); })")
    assert frames > 15, frames
    step(f'Program out: no "waiting" message over the picture; with the studio\'s animation frames stopped (as when covered), it still got {frames} fresh frames in 2 s')
    out.close(); time.sleep(0.5)
    host.click('.tile.media'); time.sleep(0.6)
    px2 = host.evaluate(PIX, [0.5, 0.4])
    assert px2[0] > 180, px2
    step('…and with no Program out window at all, the background clock keeps the studio switching and drawing')

    host.evaluate("location.reload()"); host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000); time.sleep(1.5)
    sd = host.locator('#splitD').bounding_box()
    host.mouse.move(sd['x'] + 300, sd['y'] + 3); host.mouse.down(); host.mouse.move(sd['x'] + 300, sd['y'] + 110, steps=6); host.mouse.up(); time.sleep(0.5)
    horiz = host.evaluate("document.querySelector('.dock').classList.contains('horiz')")
    widths = host.eval_on_selector_all('#bridge .vstrip', 'e => e.map(x => Math.round(x.getBoundingClientRect().width))')
    assert horiz and widths and min(widths) > 300, (horiz, widths)
    host.screenshot(path='/tmp/v09-horizontal.png')
    step(f'shrank the mixer dock: strips turned sideways and spread across the width ({widths} px)')
    print('\nerrors:', errors or 'none')
    b.close()
    sys.exit(1 if errors else 0)
