# Camera control: the zoom rail is easy to grab (a wide invisible pad) and every zoom glides;
# the studio's Camera control window shows each camera's picture, histogram and waveform, and
# zooms (gliding on the phone), sets brightness and contrast, focuses where the director
# clicks, and puts it all back to auto; a phone can turn remote control off.
# Run: node dev/server.mjs &  then  python3 test/e2e_ccu.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
Z = "+document.querySelector('#zoomSlider').value"
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); errors = []; host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Shading'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)
    cam = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 390, 'height': 844}, has_touch=True).new_page()
    cam.on('pageerror', lambda e: errors.append(f'cam: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Rosa'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelector('.tile[data-peer] video')?.readyState >= 2", timeout=45000)
    host.keyboard.press('1'); time.sleep(3)

    # the rail: grabbed well to the left of the slider (the invisible pad), dragged up
    sl = cam.locator('#zoomSlider').bounding_box(); pad = cam.locator('#zoomPad').bounding_box()
    assert pad['width'] >= sl['width'] + 50, (pad, sl)
    x, y = sl['x'] - 40, sl['y'] + sl['height'] * 0.8
    cam.mouse.move(x, y); cam.mouse.down()
    for i in range(1, 11): cam.mouse.move(x, y - i * 14); time.sleep(0.03)
    cam.mouse.up()
    zs = []
    for i in range(10): zs.append(cam.evaluate(Z)); time.sleep(0.05)
    time.sleep(0.6); z1 = cam.evaluate(Z)
    assert z1 > 1.5 and all(b2 >= a - 0.001 for a, b2 in zip(zs, zs[1:])), (zs, z1)
    step(f"grabbed the zoom rail 40 px left of the slider and dragged up: {pad['width']:.0f} px wide touch area; the zoom glided {[round(z, 2) for z in zs[:5]]}… to {z1:.2f}×")

    with ctx.expect_page() as pop: host.click('#ccuBtn')
    w = pop.value; w.on('pageerror', lambda e: errors.append(f'ccu: {e}'))
    w.wait_for_selector('.cam [data-k="z"]', timeout=15000); time.sleep(1.5)
    def scopes_drawn():
        return w.evaluate("""(() => { const c = document.querySelector('[data-w]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 1; i < d.length; i += 4) if (d[i] > 120) lit++; return lit; })()""")
    assert scopes_drawn() > 50
    step(f"Camera control shows the camera ({w.inner_text('.cam h3').replace(chr(10), ' ')}), its picture, histogram and waveform")

    set_ = lambda k, v: w.eval_on_selector(f'[data-k="{k}"]', f"r => {{ r.value = '{v}'; r.dispatchEvent(new Event('input', {{bubbles:true}})); r.dispatchEvent(new Event('change', {{bubbles:true}})); }}")
    set_('z', 1); time.sleep(0.02)
    zs = []
    for i in range(8): zs.append(cam.evaluate(Z)); time.sleep(0.05)
    time.sleep(0.8)
    assert abs(cam.evaluate(Z) - 1) < 0.02 and len(set(round(z, 2) for z in zs)) >= 4, zs
    set_('ev', 0.8); set_('ct', 1.4); time.sleep(1.2)
    look = cam.evaluate("[...document.querySelectorAll('video')].map(v => v.style.filter).find(f => f && f !== 'none') || ''")
    assert 'contrast(1.4' in look, look
    step(f"the director zoomed back to 1× (it glided: {[round(z, 2) for z in zs]}), and set brightness +0.8 and contrast 1.4: the phone shows \"{look}\"")
    box = w.locator('.cam [data-pic]').bounding_box()
    w.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.4); time.sleep(1)
    said = cam.evaluate("[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' / ')")
    assert w.locator('.ret').count() == 1 or 'focus' in said, said
    w.click('[data-act="auto"]'); time.sleep(1.2)
    assert w.input_value('[data-k="ct"]') == '1' and w.input_value('[data-k="ev"]') == '0', (w.input_value('[data-k="ct"]'), w.input_value('[data-k="ev"]'))
    step('clicking the picture focused the phone there; AUTO put brightness and contrast back')

    cam.evaluate("document.querySelector('#tgRemote').click()"); time.sleep(1.5)
    w.wait_for_selector('.cam .off', timeout=8000)
    step(f"the phone turned remote control off: \"{w.inner_text('.cam .off')}\"")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
