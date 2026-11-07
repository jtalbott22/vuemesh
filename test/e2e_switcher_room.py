# v0.27: the switcher has its own room (the program shrinks beside it, not under it); the
# preview box goes away (Tap: Air, closing the switcher, or once that source is on air) and
# never shows in Edit; Camera control shows PAUSED like the studio; the record button stays
# centred; the host removes a camera (it can rejoin) or removes and blocks it (it can't; the
# server turns it away; its clips leave the automatic edit), and lets it back in.
# Run: node dev/server.mjs &  then  python3 test/e2e_switcher_room.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Moderated show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=45000)
    ph = {}
    for name in ['Ana', 'Ben']:
        c = b.new_context(permissions=['camera', 'microphone'], viewport={'width': 844, 'height': 390}).new_page(); c.on('pageerror', lambda e, n=name: errors.append(f'{n}: {e}')); c.on('dialog', lambda d: d.accept())
        c.goto(f"{BASE}/cam?e={ev['id']}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        ph[name] = c
        host.wait_for_function(f"[...document.querySelectorAll('.tile[data-peer] video')].filter(v => v.readyState >= 2).length === {len(ph)}", timeout=45000)
    def hclick(sel):   # (clicked inside the page: a busy machine can be too slow for Playwright's click checks)
        host.evaluate(f"(() => {{ const t = {sel!r}; const m = t.match(/^(.*):has-text\\(\"(.*)\"\\)$/); const el = m ? [...document.querySelectorAll(m[1])].find(e => e.textContent.includes(m[2])) : document.querySelector(t); el.click(); }})()")
    hclick('.tile[data-peer]:has-text("Ana")'); time.sleep(0.6)

    # the record button: dead centre
    sh = ph['Ana'].locator('#shutter').bounding_box()
    off = abs(sh['x'] + sh['width'] / 2 - 844 / 2)
    assert off < 3, off
    step(f'the record button is centred at the bottom ({off:.1f} px off centre) with Flip and Pause feed on the left')

    # the switcher has its own room
    pw0 = host.locator('#program').bounding_box()
    hclick('#swTgl'); time.sleep(0.6)
    pw1 = host.locator('#program').bounding_box(); swb = host.locator('#switcher').bounding_box()
    assert pw1['x'] >= swb['x'] + swb['width'] - 1, (pw1, swb)
    step(f"with the switcher open the program shrinks beside it ({pw0['width']:.0f} → {pw1['width']:.0f} px wide), nothing hidden under it")

    hclick('#switcher [data-tap="preview"]'); hclick('.tile[data-peer]:has-text("Ben")'); time.sleep(0.6)
    assert host.is_visible('#pvwFrame') and 'Ben' in host.inner_text('#pvwLabel')
    pv, pg = host.locator('#pvwCanvas').bounding_box(), host.locator('#program').bounding_box()
    assert pv['x'] + pv['width'] <= pg['x'] and abs(pv['width'] - pg['width']) < 3, (pv, pg)
    assert pv['x'] >= swb['x'] + swb['width'] - 1, (pv, swb)
    hclick('#switcher [data-tap="air"]'); time.sleep(0.4)
    assert host.is_hidden('#pvwFrame')
    hclick('#switcher [data-tap="preview"]'); hclick('.tile[data-peer]:has-text("Ben")'); time.sleep(0.4); hclick('#swCut'); time.sleep(0.6)
    assert 'Ben' in host.inner_text('#progLabel') and host.is_visible('#pvwFrame')
    hclick('#switcher [data-tap="air"]'); time.sleep(0.3)
    assert host.is_hidden('#pvwFrame')
    hclick('#switcher [data-tap="preview"]'); hclick('.tile[data-peer]:has-text("Ana")'); time.sleep(0.4)
    assert host.is_visible('#pvwFrame')
    ed = edit_window(host.context, host, errors); time.sleep(0.8)
    assert ed.is_hidden('#pvwFrame') and ed.is_hidden('#switcher')
    host.bring_to_front(); time.sleep(0.5)
    hclick('#swTgl'); time.sleep(0.3)
    assert host.is_hidden('#pvwFrame')
    step('Tap: Preview: the preview monitor beside the program (and clear of the switcher), the same size; it goes with Tap: Air and with the switcher closed; Edit never shows it')
    # closed, the switcher leaves Tap: Preview behind: a tapped source goes straight on air
    assert host.evaluate('vmSwitcher().tapMode') == 'air'
    hclick('.tile[data-peer]:has-text("Ana")'); time.sleep(0.6)
    assert 'Ana' in host.inner_text('#progLabel') and host.is_hidden('#pvwFrame'), host.inner_text('#progLabel')
    hclick('#swTgl'); time.sleep(0.3)
    assert host.get_attribute('#switcher [data-tap="preview"]', 'aria-pressed') == 'true' and host.evaluate('vmSwitcher().tapMode') == 'preview'
    hclick('#swTgl'); time.sleep(0.3)
    hclick('.tile[data-peer]:has-text("Ben")'); time.sleep(0.6)
    assert 'Ben' in host.inner_text('#progLabel')
    step('with the switcher closed, tapping a camera puts it on air (Tap: Air); opened again, it is back on Tap: Preview')

    # Camera control: PAUSED like the studio
    with ctx.expect_page() as pop: hclick('#ccuBtn')
    w = pop.value; w.wait_for_selector('.cam [data-k="z"]', timeout=45000)
    ph['Ana'].evaluate("document.querySelector('#feedBtn').click()"); host.wait_for_selector('.tile[data-peer]:has-text("Ana") .pz', timeout=30000)
    w.wait_for_selector('.cam:has-text("Ana") .pz', timeout=30000)
    step(f"Ana paused her feed: \"{w.inner_text('.cam:has-text(\"Ana\") .pz')}\" in Camera control, as on her studio tile")
    ph['Ana'].evaluate("document.querySelector('#feedBtn').click()"); w.close(); host.bring_to_front()

    def remove(who, how):   # right-click the camera, Remove from the event…, then Remove / Remove and block (inside the page)
        host.evaluate(f"""(() => {{ const t = [...document.querySelectorAll('.tile[data-peer]')].find(e => e.textContent.includes('{who}')); const r = t.getBoundingClientRect();
          t.dispatchEvent(new MouseEvent('contextmenu', {{ bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20 }})); }})()""")
        host.wait_for_function("[...document.querySelectorAll('[role=menuitem], .menu button')].some(b => b.textContent.includes('Remove from the event'))", timeout=10000)
        host.evaluate("[...document.querySelectorAll('[role=menuitem], .menu button')].find(b => b.textContent.includes('Remove from the event')).click()")
        host.wait_for_selector('#kickDlg[open]', timeout=10000)
        host.evaluate(f"document.querySelector('#kickDlg button[value=\"{how}\"]').click()")

    # remove (can rejoin)
    remove('Ben', 'remove')
    ph['Ben'].wait_for_selector('#rejoinCard:not([hidden])', timeout=45000)
    assert 'Removed by the host' in ph['Ben'].inner_text('#rejoinLabel') and ph['Ben'].is_visible('#rejoinBtn')
    host.wait_for_function("!document.querySelector('.tile[data-peer]') || ![...document.querySelectorAll('.tile[data-peer]')].some(t => t.textContent.includes('Ben'))", timeout=45000)
    ph['Ben'].evaluate("document.querySelector('#rejoinBtn').click()"); host.wait_for_selector('.tile[data-peer]:has-text("Ben")', timeout=30000)
    step(f"Remove: Ben's phone left (\"{ph['Ben'].inner_text('#rejoinText')[:60]}…\") and he could rejoin")

    # remove and block
    remove('Ben', 'block')
    ph['Ben'].wait_for_selector('#rejoinCard:not([hidden])', timeout=45000)
    assert ph['Ben'].is_hidden('.rejoinpair') and "can't rejoin" in ph['Ben'].inner_text('#rejoinText')
    host.wait_for_selector('#blockedBox:not([hidden])', timeout=30000)
    blocked = host.evaluate(f"(async () => (await (await fetch('/api/events/{ev['id']}')).json()).blocked)()")
    assert blocked and len(blocked) == 1, blocked
    ph['Ben'].goto(f"{BASE}/cam?e={ev['id']}"); ph['Ben'].wait_for_selector('#blockedNote:not([hidden])', timeout=10000)
    assert ph['Ben'].is_hidden('#joinForm')
    step("Remove and block: Ben can't rejoin (his phone says so, the join form is gone, the event's blocked list has his id), and he's in the studio's Removed and blocked list")

    # a blocked phone that tries anyway (its own memory cleared, same identity) is turned away by the server
    ph['Ben'].evaluate(f"localStorage.removeItem('vm_blocked_{ev['id']}')"); ph['Ben'].reload(); time.sleep(1)
    assert ph['Ben'].is_visible('#blockedNote')   # (the event itself says he's blocked)
    host.evaluate("document.querySelector('#blockedList [data-unblock]').click()"); time.sleep(1)
    ph['Ben'].reload(); ph['Ben'].wait_for_selector('#joinForm:not([hidden])', timeout=10000)
    ph['Ben'].click('#joinForm button[type=submit]'); host.wait_for_selector('.tile[data-peer]:has-text("Ben")', timeout=30000)
    step('Let back in: Ben can join again')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
