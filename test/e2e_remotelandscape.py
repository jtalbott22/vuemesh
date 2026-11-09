# The phone remote held sideways: the whole show on one screen with no page to scroll, on an
# iPhone Pro Max (956 x 440 from the home screen, about 956 x 380 in Safari) and a small phone
# (667 x 375). Program out on the left, 16:9 and as big as the height allows, with what's on air
# above it and the quick actions in one row under it; the cameras and sounds on the right,
# scrolling on their own. Taps there cut and the actions work. With Program out off, the actions
# go down the left. Turned upright, it's the remote as before (Program out above the cameras, the
# actions under them); sideways again, Program out still plays.
# Run: node dev/server.mjs &  then  python3 test/e2e_remotelandscape.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
OUT = os.environ.get('SHOTS')  # (a folder: screenshots of each size go there)
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
# where everything is, as the phone shows it
LAYOUT = """(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const se = document.scrollingElement, vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
  return {
    vw: innerWidth, vh: innerHeight, sw: se.scrollWidth, sh: se.scrollHeight,
    video: vis(document.querySelector('#pgmBox')) ? r(document.querySelector('#pgm')) : null,
    status: r(document.querySelector('#status')), deck: r(document.querySelector('#deck')),
    deckScrolls: document.querySelector('#deck').scrollHeight > document.querySelector('#deck').clientHeight + 1,
    cams: [...document.querySelectorAll('#cams .cam')].map(r),
    ctl: [...document.querySelectorAll('.ctl button')].filter(vis).map((b) => ({ id: b.id, ...r(b) })),
    pgmRow: vis(document.querySelector('#pgmRow')) ? r(document.querySelector('#pgmRow')) : null,
  };
})()"""
def in_view(box, L, what):
    assert box['l'] >= -0.5 and box['t'] >= -0.5 and box['r'] <= L['vw'] + 0.5 and box['b'] <= L['vh'] + 0.5, f"{what} is off the screen: {box} in {L['vw']}x{L['vh']}"
def check_sideways(L, size):
    assert L['sw'] <= L['vw'] and L['sh'] <= L['vh'], f"{size}: the page scrolls ({L['sw']}x{L['sh']} in {L['vw']}x{L['vh']})"
    v = L['video']
    assert v, f'{size}: no Program out'
    in_view(v, L, f'{size}: Program out')
    assert abs(v['w'] / v['h'] - 16 / 9) < 0.03, f"{size}: Program out isn't 16:9 ({v['w']:.0f}x{v['h']:.0f})"
    assert v['r'] <= L['deck']['l'], f'{size}: Program out runs into the cameras'
    assert L['status']['b'] <= v['t'] + 0.5, f'{size}: what is on air is not above Program out'
    assert len(L['ctl']) >= 4
    for b in L['ctl']:
        in_view(b, L, f"{size}: {b['id']}")
        assert b['t'] >= v['b'] - 0.5 and b['r'] <= L['deck']['l'] + 0.5, f"{size}: {b['id']} is not under Program out: {b}"
        assert b['h'] >= 44, f"{size}: {b['id']} is too small to tap ({b['h']:.0f} high)"
    assert len({round(b['t']) for b in L['ctl']}) == 1, f'{size}: the quick actions are not in one row'
    in_view(L['deck'], L, f'{size}: the cameras')
    assert L['vh'] - L['deck']['b'] < 30 and abs(L['deck']['b'] - L['ctl'][0]['b']) < 1, f"{size}: the cameras don't run to the bottom: {L['deck']} vs {L['ctl'][0]}"
    assert rem.is_hidden('#changeShow'), f'{size}: Another show is there sideways'
    assert L['cams'] and L['cams'][0]['t'] < L['vh'], f'{size}: no camera in view'
    assert len({round(c['t']) for c in L['cams'][:2]}) == 1, f'{size}: the cameras are one to a row'
    return v

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sideways show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    LONG = 'Joshua Talbott iPhone 17 Pro Max'
    names = ('Ana', 'Ben', 'Cy', 'Dee', 'Eli', LONG)
    for name in names:
        cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}'))
        cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', name); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function(f"document.querySelectorAll('.tile[data-peer] video').length >= {len(names)}", timeout=120000)
    host.click('#addLocal'); host.wait_for_selector('#localList [data-add="mic"]', timeout=10000)
    host.click('#localList [data-add="mic"] >> nth=0'); host.keyboard.press('Escape')
    step(f'studio up with {len(names)} cameras and a microphone')

    time.sleep(1)  # (the add dialog closes as the microphone comes in: closed first, as a person would)
    host.evaluate("document.querySelectorAll('dialog[open]').forEach((d) => d.close()); document.querySelector('#remoteAdd').click()")
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    rctx = b.new_context(viewport={'width': 956, 'height': 440}, is_mobile=True, has_touch=True, device_scale_factor=3)
    rem = rctx.new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}'))
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function(f"!document.querySelector('#ctlView').hidden && document.querySelectorAll('#cams .cam').length === {len(names)} && !document.querySelector('#sound').hidden", timeout=60000)
    rem.wait_for_function("vmProgramView() && vmProgramView().linked && vmProgramView().shown > 10", timeout=30000)
    toast = rem.evaluate("(() => { const t = document.querySelector('#toast').getBoundingClientRect(), c = document.querySelector('.ctl').getBoundingClientRect(); return { hidden: document.querySelector('#toast').hidden, over: t.bottom > c.top && t.top < c.bottom }; })()")
    assert toast['hidden'] or not toast['over'], 'the toast covers the quick actions'
    step('a phone held sideways is paired, with Program out playing')

    for w, h, what in ((956, 440, 'Pro Max, home screen'), (956, 380, 'Pro Max, Safari'), (667, 375, 'small phone')):
        rem.set_viewport_size({'width': w, 'height': h}); time.sleep(0.4)
        L = rem.evaluate(LAYOUT)
        v = check_sideways(L, f'{w}x{h}')
        if OUT: rem.screenshot(path=os.path.join(OUT, f'remote-{w}x{h}.png'))
        step(f"{w}x{h} ({what}): no page to scroll, Program out {v['w']:.0f}x{v['h']:.0f} on the left, {len(L['ctl'])} quick actions in a row under it, {len(L['cams'])} cameras beside it ({'scrolling' if L['deckScrolls'] else 'all in view'})")

    # taps, as a finger would: the cameras beside Program out cut, the actions under it work
    rem.set_viewport_size({'width': 956, 'height': 440}); time.sleep(0.3)
    on_air = lambda: rem.evaluate("document.querySelector('#cams .cam.air b')?.textContent || ''")
    target = 'Ben' if on_air() != 'Ben' else 'Ana'
    rem.locator('#cams .cam', has_text=target).tap()
    rem.wait_for_function(f"document.querySelector('#cams .cam.air b')?.textContent === '{target}'", timeout=10000)
    last = rem.locator('#cams .cam').last
    last.scroll_into_view_if_needed()
    assert rem.evaluate("""(() => { const d = document.querySelector('#deck').getBoundingClientRect(), c = [...document.querySelectorAll('#cams .cam')].pop().getBoundingClientRect();
      return document.scrollingElement.scrollTop === 0 && c.top >= d.top - 0.5 && c.bottom <= d.bottom + 0.5; })()"""), 'only the cameras scroll'
    last_name = last.locator('b').inner_text()
    last.tap()
    rem.wait_for_function(f"document.querySelector('#cams .cam.air b')?.textContent === '{last_name}'", timeout=10000)
    rem.locator('#sound .cam').tap()
    rem.wait_for_function("document.querySelector('#onAir').textContent.endsWith('sound only')", timeout=15000)
    rem.locator('#cams .cam', has_text=target).tap()
    rem.tap('#breakBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent === 'On a break'", timeout=10000)
    rem.tap('#breakBtn'); rem.wait_for_function(f"document.querySelector('#onAir').textContent === 'On air · {target}'", timeout=10000)
    rem.tap('#blackBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent === 'Black'", timeout=15000)
    rem.tap('#blackBtn'); rem.wait_for_function("document.querySelector('#onAir').textContent.startsWith('On air')", timeout=15000)
    step(f'taps: {target}, then {last_name} (scrolled to, only the cameras moving), the microphone, a break and back, black and up')

    # another computer's screen on air, with a camera with a long name in the corner: the buttons and
    # Program out stay just as they were (its longer label made the row taller, and Program out smaller)
    sh = b.new_context(viewport={'width': 900, 'height': 800}).new_page(); sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f"{BASE}/share?e={ev['id']}"); sh.fill('#name', 'MacBook screen'); sh.click('#shareBtn')
    sh.wait_for_selector("#liveView:not([hidden])", timeout=15000)
    sh.wait_for_function("window.vmShare && vmShare().linked", timeout=30000)
    rem.wait_for_function("[...document.querySelectorAll('#cams .cam b')].some((b) => b.textContent === 'MacBook screen')", timeout=30000)
    rem.locator('#cams .cam', has_text=LONG).tap()
    rem.wait_for_function(f"document.querySelector('#cams .cam.air b')?.textContent === '{LONG}'", timeout=10000)
    time.sleep(0.5)
    before = rem.evaluate(LAYOUT)
    rem.locator('#cams .cam', has_text='MacBook screen').tap()
    rem.wait_for_function(f"document.querySelector('#pipBtn small')?.textContent === '{LONG}'", timeout=15000)
    time.sleep(0.5)
    after = rem.evaluate(LAYOUT)
    check_sideways(after, 'a screen on air')
    assert (round(after['video']['w']), round(after['video']['h'])) == (round(before['video']['w']), round(before['video']['h'])), f"Program out changed size: {before['video']} -> {after['video']}"
    assert [(round(x['w']), round(x['h'])) for x in after['ctl']] == [(round(x['w']), round(x['h'])) for x in before['ctl']], f"the buttons changed size: {before['ctl']} -> {after['ctl']}"
    pip = rem.evaluate("(() => { const b = document.querySelector('#pipBtn'), s = b.querySelector('small'); return { label: b.innerText.replace(/\\s+/g, ' ').trim(), fits: [...b.children].every((c) => !c.getClientRects().length || c.getBoundingClientRect().bottom <= b.getBoundingClientRect().bottom + 0.5), aria: b.getAttribute('aria-label') }; })()")
    assert pip['fits'] and LONG in pip['aria'], pip
    if OUT: rem.screenshot(path=os.path.join(OUT, 'remote-956x440-screen.png'))
    step(f"a screen on air with {LONG} in the corner: Program out stays {after['video']['w']:.0f}x{after['video']['h']:.0f} and the buttons {after['ctl'][0]['h']:.0f} high; the corner button says \"{pip['label']}\" within itself")

    # Program out full screen: a tap on it, a tap to go back; it carries on playing
    def full_screen(size):
        rem.tap('#pgmBox')
        rem.wait_for_function('vmProgramFull()', timeout=3000)
        F = rem.evaluate("""(() => { const v = document.querySelector('#pgm').getBoundingClientRect(), c = document.querySelector('#recBtn').getBoundingClientRect();
          const at = (x, y) => !!document.elementFromPoint(x, y)?.closest('#pgmBox');
          const covered = at(4, 4) && at(innerWidth - 4, innerHeight - 4) && (c.bottom > innerHeight || at(c.left + c.width / 2, c.top + c.height / 2));
          return { w: v.width, h: v.height, l: v.left, t: v.top, vw: innerWidth, vh: innerHeight, covered, hint: getComputedStyle(document.querySelector('#fsHint')).display !== 'none' }; })()""")
        assert F['covered'] and F['hint'], F
        assert abs(F['w'] / F['h'] - 16 / 9) < 0.03 and (abs(F['w'] - F['vw']) < 1 or abs(F['h'] - F['vh']) < 1), f'{size}: full screen, Program out does not fill the screen: {F}'
        assert abs(F['l'] * 2 + F['w'] - F['vw']) < 1.5 and abs(F['t'] * 2 + F['h'] - F['vh']) < 1.5, f'{size}: not in the middle: {F}'
        n0 = rem.evaluate('vmProgramView().shown')
        rem.wait_for_function(f"vmProgramView().shown > {n0} + 10 && !document.querySelector('#pgm').paused", timeout=10000)
        if OUT: rem.screenshot(path=os.path.join(OUT, f'remote-{size}-full.png'))
        rem.tap('#pgmBox', position={'x': 20, 'y': 20})
        rem.wait_for_function('!vmProgramFull()', timeout=3000)
        return F
    F = full_screen('956x440')
    check_sideways(rem.evaluate(LAYOUT), 'back from full screen')
    step(f"sideways, a tap on Program out: full screen ({F['w']:.0f}x{F['h']:.0f} of {F['vw']}x{F['vh']}, over the buttons, still playing), and a tap goes back to the remote as it was")

    # Program out off: the actions down the left, two to a row, the sources wider
    deck_was = rem.evaluate(LAYOUT)['deck']['w']
    rem.tap('#pgmTgl')
    rem.wait_for_function("document.querySelector('#pgmBox').hidden")
    L = rem.evaluate(LAYOUT)
    assert L['sh'] <= L['vh'] and L['sw'] <= L['vw'], L
    for x in L['ctl']: in_view(x, L, x['id'])
    assert len({round(x['l']) for x in L['ctl']}) == 2 and all(x['r'] <= L['deck']['l'] for x in L['ctl']), L['ctl']
    assert L['deck']['w'] > deck_was + 100, (deck_was, L['deck'])
    if OUT: rem.screenshot(path=os.path.join(OUT, 'remote-956x440-noprogram.png'))
    rem.tap('#autoBtn'); rem.wait_for_function("document.querySelector('#autoBtn').getAttribute('aria-pressed') === 'true'", timeout=10000)
    rem.tap('#autoBtn'); rem.wait_for_function("document.querySelector('#autoBtn').getAttribute('aria-pressed') === 'false'", timeout=10000)
    rem.tap('#pgmTgl')
    rem.wait_for_function("!document.querySelector('#pgmBox').hidden && vmProgramView().linked", timeout=10000)
    step(f"Program out off: the actions two to a row down the left, the cameras {deck_was:.0f} -> {L['deck']['w']:.0f} wide; the auto-director on and off from there; Program out on again")

    # upright: as before
    rem.set_viewport_size({'width': 440, 'height': 956}); time.sleep(0.4)
    order = rem.evaluate("""(() => ['#status', '#pgmBox', '#pgmRow', '#cams', '#sound', '.ctl', '#changeShow'].map((s) => document.querySelector(s).getBoundingClientRect()))()""")
    tops = [o['top'] for o in order]
    assert tops == sorted(tops), f'upright, not in order: {tops}'
    assert abs(order[1]['width'] - order[3]['width']) < 1 and abs(order[1]['width'] / order[1]['height'] - 16 / 9) < 0.03, 'upright, Program out spans the width at 16:9'
    assert rem.evaluate("getComputedStyle(document.querySelector('.ctl')).gridTemplateColumns.split(' ').length") == 2
    if OUT: rem.screenshot(path=os.path.join(OUT, 'remote-440x956.png'), full_page=True)
    rem.evaluate('scrollTo(0, 0)')
    F = full_screen('440x956')
    step(f"upright too: a tap fills the screen's width ({F['w']:.0f}x{F['h']:.0f}), a tap goes back")
    rem.set_viewport_size({'width': 956, 'height': 440}); time.sleep(0.4)
    check_sideways(rem.evaluate(LAYOUT), 'sideways again')
    n0 = rem.evaluate('vmProgramView().shown')
    rem.wait_for_function(f"vmProgramView().shown > {n0} + 10 && !document.querySelector('#pgm').paused", timeout=10000)
    step('upright it is the remote as before (Program out, its buttons, the cameras, the sound, the actions, one under another); sideways again, Program out is still playing')

    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
