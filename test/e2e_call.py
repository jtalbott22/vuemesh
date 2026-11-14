# A call (/call, call.js): three people, everyone connected to everyone, behind a waiting room.
# Ann starts a call; it gives her a link (with the room key after the #) and a code and PIN. Bob comes
# with the link and waits, seeing nobody, until Ann lets him in; then they see and hear each other.
# Cara types the code with a wrong PIN (refused), then the right one, and waits; Bob lets her in, and
# all three are connected to each other. Ann shares her screen and both see it; she stops and it goes.
# Ann locks the call: a fourth with the link is refused. Ann takes Cara out: Cara's page says so, and
# she can't come back, even with the link. Checks along the way: no request ever carries the key or
# anyone's name to the server, and the server keeps no name.
# Run: node dev/server.mjs &  then  python3 test/e2e_call.py
import os, time, json, urllib.request
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

SCREEN = """(() => {
  if (!navigator.mediaDevices) return; // (about:blank)
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => { n++; g.fillStyle = '#eee'; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#c00'; g.fillRect((n * 17) % 1100, 300, 120, 120); }, 33);
    const s = c.captureStream(15);
    if (window.__screenTone) { // (a screen playing sound, as with Share tab audio ticked: a tone)
      const ctx = new AudioContext(), o = ctx.createOscillator(), d = ctx.createMediaStreamDestination();
      o.frequency.value = 440; o.connect(d); o.start(); ctx.resume();
      s.addTrack(d.stream.getAudioTracks()[0]);
    }
    return s;
  };
  // every link, so the test can read how loud the sound arriving from each person is
  const PC = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends PC { constructor(...a) { super(...a); window.__pcs.push(this); } };
})();"""
# the loudest sound arriving over any link (0 to 1), as the browser measures it
HEARD = "async () => { let lv = 0; for (const pc of window.__pcs) { if (pc.connectionState !== 'connected') continue; (await pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') lv = Math.max(lv, r.audioLevel || 0); }); } return lv; }"

# A browser that recognises speech on the device (headless Chromium has none): it "hears" a phrase
# from the track it's given, as the real one would from Ann's microphone
HEARS = """(() => {
  class SR {
    static async available(o) { return o?.processLocally ? 'available' : 'unavailable'; }
    start(track) {
      this.track = track; this.on = true; this.n = 0;
      setTimeout(() => this.onaudiostart?.(), 50);
      this.timer = setInterval(() => {
        if (!this.on) return;
        const words = ['hello', 'hello from', 'hello from Ann'][Math.min(2, this.n++)];
        const res = Object.assign([{ transcript: words }], { isFinal: this.n > 3 });
        this.onresult?.({ resultIndex: 0, results: [res] });
      }, 400);
    }
    stop() { this.on = false; clearInterval(this.timer); this.onend?.(); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = SR;
})();"""

def wait(page, js, what, secs=30, arg=None):
    end = time.time() + secs
    v = None
    while time.time() < end:
        v = page.evaluate(js) if arg is None else page.evaluate(js, arg)
        if v:
            return v
        time.sleep(0.25)
    states = '; '.join(f"{getattr(p, 'person', '?')}: {p.evaluate('() => window.vmCall ? JSON.stringify(vmCall()) : null')}" for p in PAGES)
    raise AssertionError(f'timed out: {what} (last {v!r})\n{states}')
PAGES = []

def visible(page, sel, what, secs=20):
    page.wait_for_selector(sel, state='visible', timeout=secs * 1000)

with sync_playwright() as pw:
    browser = pw.chromium.launch(args=ARGS)
    sent = []  # every request any page makes (url and body), to check nothing carries the key or a name
    def person(name, hears=False):
        ctx = browser.new_context(permissions=['camera', 'microphone'])
        ctx.add_init_script(SCREEN)
        if hears: ctx.add_init_script(HEARS)
        p = ctx.new_page()
        errors = []
        p.on('pageerror', lambda e: errors.append(str(e)))
        p.on('request', lambda r: sent.append((r.url, r.post_data or '')))
        p.on('websocket', lambda ws: sent.append((ws.url, '')) or ws.on('framesent', lambda f: sent.append(('ws', f if isinstance(f, str) else ''))))
        p.errors = errors
        p.person = name
        p.on('console', lambda m: m.type in ('warning', 'error') and errors.append(f'console: {m.text}') if 'call:' in m.text else None)
        PAGES.append(p)
        return p

    ann = person('Ann', hears=True)   # (her browser recognises speech on the device; Bob's can't)
    ann.goto(f'{BASE}/call')
    visible(ann, '#homeView', 'the call page')
    ann.click('#startBtn')
    visible(ann, '#preView', 'Ann ready to join')
    link = ann.inner_text('#preLink').strip()
    assert '/call?e=' in link and '#k=' in link, link
    key = link.split('#k=')[1]
    code = link.split('?e=')[1][:6]
    pin = ann.inner_text('#prePin')
    pin = ''.join(ch for ch in pin.split('PIN')[1] if ch.isdigit())[:6]
    assert len(pin) == 6, pin
    ann.fill('#name', 'Ann')
    ann.click('#joinBtn')
    visible(ann, '#callView', 'Ann in her call (nobody there: straight in)')
    step(f'Ann starts a call: a link with its key, code {code} and a PIN; she goes straight in')

    bob = person('Bob')
    bob.goto(link)
    bob.evaluate("() => localStorage.setItem('vm_captions_crashed', '1')")   # (a browser that can't recognise speech on the device: asked, Playwright's own crashes)
    visible(bob, '#preView', 'Bob with the link')
    bob.fill('#name', 'Bob')
    bob.click('#joinBtn')
    visible(bob, '#waitView', 'Bob waiting')
    wait(ann, "() => vmCall().waiting.includes('Bob')", 'Ann sees Bob knock')
    assert bob.evaluate('vmCall().peers.length') == 0, 'waiting, Bob is connected to nobody'
    assert int(ann.inner_text('#waitBadge')) == 1
    ann.click('#peopleBtn')
    ann.click('#waitingList [data-admit]')
    ann.click('#peopleBox [data-close]')
    visible(bob, '#callView', 'Bob let in')
    wait(ann, "() => vmCall().peers.some((p) => p.name === 'Bob' && p.state === 'connected' && p.streams > 0)", 'Ann connected to Bob, with his picture')
    wait(bob, "() => vmCall().peers.some((p) => p.name === 'Ann' && p.state === 'connected' && p.streams > 0)", 'Bob connected to Ann')
    wait(bob, "() => [...document.querySelectorAll('#grid .tile:not(.self) video')].some((v) => v.videoWidth > 0 && !v.paused)", "Ann's picture playing for Bob")
    step('Bob, with the link, waits seeing nobody, knocks with his name; Ann lets him in; they see each other')

    # they hear each other: each one's sound in a player of its own, playing, and its packets arriving
    for p, other in ((ann, 'Bob'), (bob, 'Ann')):
        wait(p, "(n) => vmCall().peers.some((x) => x.name === n && x.playing && x.hearing === true)", f'{p.person} hears {other}', secs=25, arg=other)
    step('they hear each other: each one\'s sound playing in its own player, and arriving')

    # captions: Bob turns them on; Ann's browser recognises her speech on her device and her words are
    # on her picture on Bob's page; Bob's browser can't, so Ann (once she turns them on) is told so
    # (Bob's browser can't make captions: a tap turns them on only because Ann's device makes them)
    bob.click('#ccBtn')
    wait(bob, "() => vmCall().ccWant && document.querySelector('#ccBtn').getAttribute('aria-pressed') === 'true' && !document.querySelector('#ccBtn').classList.contains('cant')", "Bob's captions on, since Ann's device makes them", secs=10)
    wait(bob, "() => [...document.querySelectorAll('#grid .tile:not(.self) .cc')].some((c) => /hello from Ann/.test(c.textContent))", "Ann's words on her picture on Bob's page", secs=20)
    assert ann.evaluate("() => vmCall().ccCan") == 'yes' and not ann.evaluate('() => vmCall().ccWant'), "Ann captions herself because Bob asked, without showing captions herself"
    ann.click('#ccBtn')
    # (a small CC on Bob's picture, struck through, the reason in its label and on hover)
    wait(ann, "() => [...document.querySelectorAll('#grid .tile:not(.self) .ccnote')].some((n) => !n.hidden && n.textContent === 'CC' && n.classList.contains('cant') && /no captions from this browser/i.test(n.getAttribute('aria-label')) && getComputedStyle(n).textDecorationLine.includes('line-through'))", "Ann told Bob's browser can't caption", secs=15)
    assert ann.evaluate("() => { const n = document.querySelector('#grid .tile.self .ccnote'); return !n.hidden && n.textContent === 'CC' && !n.classList.contains('cant'); }"), "Ann's own picture: CC, not struck through (her device captions her)"
    bob.click('#ccSizeBtn'); bob.click('#ccPosBtn')
    assert bob.evaluate("() => document.querySelector('#grid').classList.contains('cc-top') && getComputedStyle(document.querySelector('#stage')).getPropertyValue('--cc').trim() === '1.35rem'")
    for p in (ann, bob):
        p.click('#ccBtn')
    wait(ann, "() => vmCall().ccSaid === '' || !document.querySelector('#grid .tile.self .cc').textContent", "captions off, Ann's recogniser stopped")
    assert bob.evaluate("() => document.querySelector('#ccBtn').classList.contains('cant') && document.querySelector('#ccBtn').getAttribute('aria-pressed') === 'false'"), "Bob's Captions off and struck through again" 
    step("captions: Bob turns them on and Ann's words (recognised on her device) are on her picture; Bob's browser can't, and Ann is told; size and position change")

    # a tap on Ann's picture makes it big on Bob's page; another, back to the grid; each has a full-screen button
    bob.click('#grid .tile:not(.self) video')
    wait(bob, "() => vmCall().big && document.querySelector('#grid .tile.big:not(.self)') && document.querySelector('#grid').classList.contains('has-big')", "Ann's picture big")
    assert bob.query_selector('#grid .tile.big [data-fs]'), 'a full-screen button'
    bob.click('#grid .tile.big video')
    wait(bob, "() => !vmCall().big && !document.querySelector('#grid .tile.big')", 'back to the grid')
    step("a tap on Ann's picture makes it big on Bob's page (with a full-screen button); another tap, back to the grid")

    # Ann switches camera: Bob's picture of her carries on, from the other camera
    ann.wait_for_selector('#flipBtn', state='visible', timeout=10000)
    before = ann.evaluate("() => document.querySelector('#grid .tile.self video').srcObject.getVideoTracks()[0].label")
    ann.click('#flipBtn')
    wait(ann, "(b) => document.querySelector('#grid .tile.self video').srcObject?.getVideoTracks()[0]?.label !== b", "Ann's other camera", arg=before)
    time.sleep(1.5)
    wait(bob, "() => [...document.querySelectorAll('#grid .tile:not(.self) video')].some((v) => v.videoWidth > 0 && !v.paused)", "Bob still sees Ann")
    assert ann.evaluate("() => vmCall().peers[0].state") == 'connected'
    after = ann.evaluate("() => document.querySelector('#grid .tile.self video').srcObject.getVideoTracks()[0].label")
    ratio = ann.evaluate("() => { const s = document.querySelector('#grid .tile.self video').srcObject.getVideoTracks()[0].getSettings(); return Math.round(s.width / s.height * 100) / 100; }")
    assert abs(ratio - 16 / 9) < 0.02, f'the other camera at the same shape (16:9), not {ratio}'
    step(f'Ann switches camera ({before} → {after}): the same 16:9 picture, and Bob still sees her on the same link')

    # full screen as on an iPhone (no full screen for a page's element): the picture fills the page,
    # no player, still playing; ⛶ again and it's back, still playing
    bob.evaluate("() => { Object.defineProperty(document, 'fullscreenEnabled', { get: () => false }); }")
    bob.click('#grid .tile:not(.self) [data-fs]')
    wait(bob, "() => { const t = document.querySelector('#grid .tile.fsfake'); const v = t?.querySelector('video'); const r = t?.getBoundingClientRect(); const vr = v?.getBoundingClientRect(); return t && r.width >= innerWidth - 1 && r.height >= innerHeight - 1 && vr.width >= innerWidth - 1 && vr.height >= innerHeight * 0.9 && v.videoWidth > 0 && !v.paused; }", "Ann's picture filling Bob's page, playing")
    bob.evaluate("() => document.querySelector('#grid .tile.fsfake video').pause()")
    wait(bob, "() => !document.querySelector('#grid .tile.fsfake video').paused", 'a paused picture starts again by itself')
    bob.click('#grid .tile.fsfake [data-fs]')
    wait(bob, "() => !document.querySelector('.fsfake') && [...document.querySelectorAll('#grid .tile:not(.self) video')].every((v) => !v.paused)", 'back, still playing')
    step("full screen as on an iPhone: Ann's picture fills Bob's page with no player, a pause starts again by itself, and back it's still playing")

    cara = person('Cara')
    cara.goto(f'{BASE}/call')
    cara.fill('#code', code)
    cara.fill('#pin', '000000' if pin != '000000' else '111111')
    cara.click('#codeForm button[type=submit]')
    wait(cara, "() => /Wrong code or PIN/.test(document.querySelector('#homeErr').textContent)", 'a wrong PIN refused')
    cara.fill('#pin', pin)
    cara.click('#codeForm button[type=submit]')
    visible(cara, '#preView', 'Cara with the code and PIN')
    cara.fill('#name', 'Cara')
    cara.click('#joinBtn')
    visible(cara, '#waitView', 'Cara waiting')
    wait(bob, "() => vmCall().waiting.includes('Cara')", 'Bob sees Cara knock')
    # (a bar across the top of the call, her name and Let in, there until it's answered)
    bob.wait_for_selector('#knocks .knock', timeout=5000)
    assert 'Cara is waiting to come in' in bob.inner_text('#knocks'), bob.inner_text('#knocks')
    bob.click('#knocks [data-admit]')
    bob.wait_for_selector('#knocks', state='hidden', timeout=10000)
    visible(cara, '#callView', 'Cara let in by Bob')
    for p in (ann, bob, cara):
        wait(p, "() => vmCall().peers.length === 2 && vmCall().peers.every((x) => x.state === 'connected' && x.streams > 0 && x.name)", f'{p.person} connected to both others', secs=40)
    step('Cara: a wrong PIN refused, the right one lets her wait; Bob sees a bar across the top of the call and lets her in from it; all three connected to each other')

    ann.click('#shareBtn')
    for p in (bob, cara):
        wait(p, "() => { const v = document.querySelector('#screenVideo'); return !document.querySelector('#screenBox').hidden && v.videoWidth >= 640; }", f"Ann's screen on {p.person}'s page", secs=30)
        assert 'Ann' in p.inner_text('#screenWho')
        # (its own box: no picture over it, whatever the window; the bar at the bottom)
        assert p.evaluate("() => { const s = document.querySelector('#screenBox').getBoundingClientRect(); return [...document.querySelectorAll('#grid .tile')].every((t) => { const r = t.getBoundingClientRect(); return r.top >= s.bottom - 1 || r.bottom <= s.top + 1 || r.left >= s.right - 1 || r.right <= s.left + 1; }) && s.height > 100; }"), 'the shared screen has its own box, nothing over it'
        assert p.evaluate("() => Math.abs(document.querySelector('.bar').getBoundingClientRect().bottom - innerHeight) < 2"), 'the bar at the bottom'
    ann.click('#shareBtn')
    for p in (bob, cara):
        wait(p, "() => document.querySelector('#screenBox').hidden", f"Ann's screen gone from {p.person}'s page")
    step("Ann shares her screen: both see it, with her name; she stops and it's gone")

    # a screen with sound: Ann's microphone off (and Cara's, so hers isn't counted), so all Bob can hear
    # from Ann is the screen's sound
    ann.click('#micBtn'); cara.click('#micBtn')
    # (muted: a struck microphone after her name on Bob's page, not the word)
    wait(bob, "() => [...document.querySelectorAll('#grid .tile:not(.self) .who')].some((w) => /^Ann/.test(w.textContent) && w.querySelector('.mut[aria-label=muted]') && !/muted/.test(w.textContent))", "a struck microphone by Ann's name on Bob's page", secs=10)
    wait(bob, f"async () => (await ({HEARD})()) < 0.01", "Bob hears nothing from Ann with her microphone off", secs=20)
    ann.evaluate("window.__screenTone = true")
    ann.click('#shareBtn')
    wait(ann, "() => vmCall().screenSound", "Ann's screen sound mixed into her sound", secs=10)
    wait(bob, f"async () => (await ({HEARD})()) > 0.05", "Bob hears Ann's screen's sound", secs=20)
    heard = bob.evaluate(HEARD)
    ann.click('#shareBtn')
    wait(ann, "() => !vmCall().screenSound", "the mix closed when Ann stops sharing", secs=10)
    wait(bob, f"async () => (await ({HEARD})()) < 0.01", "and Bob hears nothing from her again", secs=20)
    ann.evaluate("window.__screenTone = false")
    ann.click('#micBtn'); cara.click('#micBtn')
    step(f"a screen with sound: with Ann's microphone off, Bob hears her screen's sound (level {heard:.2f}) while she shares, and nothing once she stops")

    # another computer showing only its screen: the share page with the call's link
    eve = person('Eve')
    eve.goto(f'{BASE}/share?e={code}#k={key}')
    wait(eve, "() => /call/.test(document.querySelector('#joinWhat').textContent)", 'the share page knows it is a call')
    eve.fill('#name', 'Eve laptop')
    eve.click('#shareBtn')
    wait(eve, "() => /Waiting to be let in/.test(document.querySelector('#linkSay').textContent)", 'the screen waits to be let in', secs=20)
    wait(ann, "() => vmCall().waiting.includes('Eve laptop')", 'Ann sees the screen knock')
    ann.click('#peopleBtn')
    ann.click('#waitingList [data-admit]')
    ann.click('#peopleBox [data-close]')
    wait(eve, "() => /In the call/.test(document.querySelector('#linkSay').textContent)", 'the screen in the call', secs=20)
    for p in (ann, bob, cara):
        wait(p, "() => { const v = document.querySelector('#screenVideo'); return !document.querySelector('#screenBox').hidden && v.videoWidth >= 640 && /Eve laptop/.test(document.querySelector('#screenWho').textContent); }", f"Eve's screen on {p.person}'s page", secs=30)
    eve.click('#stopBtn')
    for p in (ann, bob, cara):
        wait(p, "() => document.querySelector('#screenBox').hidden && !vmCall().peers.some((x) => x.name === 'Eve laptop')", f"Eve's screen gone from {p.person}'s page", secs=10)
    step("another computer's screen (/share with the call's link) waits, is let in, is on everyone's page, and goes when it stops")

    ann.click('#peopleBtn')
    ann.click('#lockBtn')
    ann.click('#peopleBox [data-close]')
    wait(bob, "() => !document.querySelector('#lockTag').hidden", 'Bob sees the call locked')
    dan = person('Dan')
    dan.goto(link)
    visible(dan, '#preView', 'Dan with the link')
    dan.fill('#name', 'Dan')
    dan.click('#joinBtn')
    wait(dan, "() => /locked/.test(document.querySelector('#preErr').textContent)", 'Dan refused: locked')
    ann.click('#peopleBtn')
    ann.click('#lockBtn')
    ann.click('#peopleBox [data-close]')
    step('Ann locks the call: Dan, with the link, is refused')

    ann.on('dialog', lambda d: d.accept())
    ann.click('#peopleBtn')
    ann.click("#inList li:has-text('Cara') [data-remove]")
    ann.click('#peopleBox [data-close]')
    visible(cara, '#endView', 'Cara out')
    assert 'taken out' in cara.inner_text('#endTitle'), cara.inner_text('#endTitle')
    wait(ann, "() => vmCall().peers.length === 1", 'Ann now with Bob alone')
    wait(bob, "() => vmCall().peers.length === 1", 'Bob now with Ann alone')
    cara.goto('about:blank')  # (the link differs only after the #: without this, no reload)
    cara.goto(link)
    visible(cara, '#preView', 'Cara back with the link')
    cara.click('#joinBtn')
    wait(cara, "() => /taken out/.test(document.querySelector('#preErr').textContent)", 'Cara kept out, even with the link')
    step('Ann takes Cara out: her page says so, the others lose her, and she can’t come back even with the link')

    # Bob's network changes (Wi-Fi to mobile data, as the browser tells it): his server link is made
    # again at once and his link with Ann started again; they're back, still in the call
    socks_before = bob.evaluate('globalThis.vmSockets[0].opens')
    bob.evaluate("() => window.dispatchEvent(new Event('online'))")
    wait(bob, f"() => globalThis.vmSockets[0].opens > {socks_before}", "Bob's server link made again at once", secs=10)
    for p, other in ((ann, 'Bob'), (bob, 'Ann')):
        wait(p, "(n) => vmCall().peers.length === 1 && vmCall().peers[0].state === 'connected' && vmCall().peers[0].name === n", f'{p.person} connected again, to {other}', secs=20, arg=other)
    assert bob.is_visible('#callView'), 'Bob still in the call, without waiting again'
    assert 'Bob left' not in (ann.evaluate("() => document.querySelector('.toast')?.textContent") or ''), "Ann wasn't told Bob left: he didn't"
    step("Bob's network changes: his server link is back at once, the link with Ann starts again, still in the call")

    # on a phone: the controls in one row (Mic, Camera, Share, People, More, Leave), the rest under More
    bob.set_viewport_size({'width': 390, 'height': 844}); time.sleep(0.3)
    row = bob.evaluate("() => [...document.querySelectorAll('#bar > button')].filter((b) => b.offsetParent).map((b) => [b.id, Math.round(b.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().right)])")
    assert [r[0] for r in row] == ['micBtn', 'camBtn', 'shareBtn', 'peopleBtn', 'moreBtn', 'leaveBtn'], row
    assert len({r[1] for r in row}) == 1 and max(r[2] for r in row) <= 390, row
    assert not bob.is_visible('#inviteBtn')
    bob.click('#moreBtn')
    assert bob.is_visible('#inviteBtn') and bob.is_visible('#ccBtn') and bob.get_attribute('#moreBtn', 'aria-expanded') == 'true'
    bob.click('#grid')
    bob.wait_for_selector('#inviteBtn', state='hidden', timeout=3000)
    bob.set_viewport_size({'width': 1280, 'height': 720}); time.sleep(0.3)
    step('on a phone: one row of six (Mic, Camera, Share, People, More, Leave); More opens the rest, and a tap elsewhere closes it')

    # Bob leaves: Ann sees it at once (his goodbye comes over their own link)
    t0 = time.time()
    bob.click('#leaveBtn')
    wait(ann, "() => vmCall().peers.length === 0", 'Ann sees Bob gone', secs=5)
    gone_in = time.time() - t0
    assert gone_in < 2, f'took {gone_in:.1f} s'
    said = ann.evaluate("() => [document.querySelector('.toast')?.textContent, (window.vmDiag?.() || []).slice?.(-5)]")
    assert 'Bob left' in (said[0] or ''), f'Ann is told ({said})'
    step(f'Bob leaves: Ann sees him gone in {gone_in:.1f} s, and is told')

    # nothing to the server carries the room key, or anyone's name
    leaks = [(u, b) for (u, b) in sent if key in u or key in b or any(n in b for n in ('"Ann"', '"Cara"', '"Dan"')) or 'name=Ann' in u or 'name=Bob' in u]
    # (Bob's and Cara's names do go with their knock, to the people in the call, and aren't kept: allowed)
    leaks = [l for l in leaks if '"action":"knock"' not in l[1]]
    assert not leaks, leaks[:3]
    ev = json.loads(urllib.request.urlopen(f'{BASE}/api/events/{code}').read())
    assert not any(n in json.dumps(ev) for n in ('Ann', 'Bob', 'Cara')), ev
    step('no request carries the room key or a name (but a knock), and the server keeps no name')

    for p in (ann, bob, cara, dan):
        assert not p.errors, (p.person, p.errors)
    browser.close()
print('\nAll call tests passed.')
