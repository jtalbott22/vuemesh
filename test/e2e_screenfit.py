# A shared screen is always shown whole, whatever the show's framing: a Mac's 16:10 screen in a
# 16:9 show lost its menu bar and Dock to Fill. The screen here is 1440 x 900 with a red band
# along the top (the menu bar) and a green one along the bottom (the Dock), each 40 px: Fill
# would crop both off entirely. Checked for a screen shared on this computer and for another
# computer's (/share), on the program, on the source's tile, and that the
# screen's own recording is marked a screen (Edit shows it whole too).
# Run: node dev/server.mjs &  then  python3 test/e2e_screenfit.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

# the browser's picker: a 16:10 "screen" (blue, red menu bar at the top, green Dock at the bottom)
SCREEN_16x10 = """(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1440; c.height = 900;
    const g = c.getContext('2d');
    const draw = () => {
      g.fillStyle = '#2040c0'; g.fillRect(0, 0, 1440, 900);
      g.fillStyle = '#ff0000'; g.fillRect(0, 0, 1440, 40);
      g.fillStyle = '#00ff00'; g.fillRect(0, 860, 1440, 40);
      g.fillStyle = '#fff'; g.fillRect((performance.now() / 5) % 1400, 400, 40, 40);
    };
    draw(); setInterval(draw, 50);
    const s = c.captureStream(30);
    const v = s.getVideoTracks()[0];
    if (v) v.getSettings = () => ({ width: 1440, height: 900, displaySurface: 'monitor' });
    return s;
  };
})();"""

# what the program shows along its top and bottom rows and at its left edge
PROBE = """() => {
  const c = document.querySelector('#program'), W = c.width, H = c.height;
  const g = document.createElement('canvas'); g.width = W; g.height = H;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0);
  const px = (X, Y) => [...x.getImageData(X, Y, 1, 1).data.slice(0, 3)];
  return { W, H, top: px(W / 2, 4), bottom: px(W / 2, H - 5), mid: px(W / 2, H / 3), edge: px(2, H / 2) };
}"""
red = lambda p: p[0] > 180 and p[1] < 80 and p[2] < 80
green = lambda p: p[1] > 180 and p[0] < 80 and p[2] < 80
blue = lambda p: p[2] > 140 and p[0] < 80
black = lambda p: max(p) < 30

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(SCREEN_16x10)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Fit test'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    # the show fills by default: say so, so this is the case that cropped
    assert host.evaluate("localStorage.getItem('vm_fit_' + new URLSearchParams(location.search).get('e')) || 'fill'") == 'fill'

    def on_air_check(peer_sel, what):
        host.click(peer_sel); time.sleep(1.5)
        host.wait_for_function(f"({PROBE})().mid[2] > 140", timeout=10000)
        s = host.evaluate(PROBE)
        assert red(s['top']) and green(s['bottom']) and blue(s['mid']), (what, s)
        # 16:10 in 16:9: whole means bars at the sides
        assert black(s['edge']), (what, s)
        step(f"{what} on air in a 16:9 show set to Fill: shown whole, menu bar {s['top']} at the top, Dock {s['bottom']} at the bottom, bars at the sides {s['edge']}")

    # 1. a screen shared on this computer
    host.click('#addLocal'); host.wait_for_selector('#localList [data-share="screen"]', timeout=10000)
    host.click('#localList [data-share="screen"]')
    host.wait_for_function("document.querySelector('.tile[data-peer^=\"local-cam\"] video')?.readyState >= 2", timeout=10000)
    host.keyboard.press('Escape')
    on_air_check('.tile[data-peer^="local-cam"]', "This computer's screen")
    fit = host.evaluate("getComputedStyle(document.querySelector('.tile[data-peer^=\"local-cam\"] video')).objectFit")
    assert fit == 'contain', fit
    step('its tile shows it whole too (object-fit: contain)')

    # its recording, for Edit, is marked a screen
    host.click('#recProgBtn')
    host.wait_for_function("vmMedia().some((x) => x.peer.startsWith('local-cam') && x.recording)", timeout=15000)
    time.sleep(3)
    host.click('#recProgBtn')
    confirm = host.locator('dialog[open] button:has-text("Stop")')
    if confirm.count(): confirm.first.click()
    host.wait_for_function("""(async () => (await (await import('/js/idb.js')).list('clips', new URLSearchParams(location.search).get('e'))).some((c) => c.kind === 'video' && c.screen === true))()""", timeout=20000)
    step("the screen's own recording is marked a screen, so Edit shows it whole as well")
    if host.locator('#wrap[open]').count():  # (stopping Record program says "That's a wrap")
        host.click('#wrap[open] [data-close]')

    # 2. another computer's screen, over /share
    other = b.new_context(viewport={'width': 1000, 'height': 800})
    other.add_init_script(SCREEN_16x10)
    sh = other.new_page(); sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f"{BASE}/share?e={ev['id']}")
    sh.fill('#name', 'Presenter Mac'); sh.click('#shareBtn')
    sh.wait_for_function("document.querySelector('#linkSay').textContent.startsWith('In the studio')", timeout=20000)
    host.wait_for_function("[...document.querySelectorAll('.tile')].some((t) => t.textContent.includes('Presenter Mac') && t.querySelector('video')?.readyState >= 2)", timeout=20000)
    time.sleep(2)  # (its telemetry says it's a screen)
    on_air_check('.tile:has-text("Presenter Mac")', "Another computer's screen (/share)")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
