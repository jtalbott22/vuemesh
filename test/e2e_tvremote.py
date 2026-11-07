# The TV and the remote: a TV whose link dies, or whose computer sleeps (a laptop's lid closed),
# joins again by itself with nobody touching the studio; a TV says what it's getting (frames it
# shows) and the studio keeps it in its show log; a TV falling behind gets a lower bitrate; and the
# phone remote shows Program out (what's on air) above its cameras, on its own link that the
# studio let in when the phone was paired, not listed as a TV.
# Run: node dev/server.mjs &  then  python3 test/e2e_tvremote.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
PASTE = "(el, v) => { const dt = new DataTransfer(); dt.setData('text/plain', v); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }"
PLAYING = "(() => { const v = document.querySelector('#out'); return !v.hidden && v.readyState >= 2 && v.videoWidth > 0; })()"
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Hall'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    host.click('#localList [data-add="cam"] >> nth=0'); time.sleep(1)
    host.click('#localDlg form button')
    host.click('.tile[data-peer^="local-cam"]'); time.sleep(1)

    tv = b.new_context(viewport={'width': 1280, 'height': 720}).new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
    tv.goto(f"{BASE}/tv")
    tv.locator('#eventCells input').first.evaluate(PASTE, ev['id'])
    tv.fill('#screenName', 'Hall TV'); tv.click('#joinForm button[type=submit]')
    host.wait_for_function("!!document.querySelector('[data-tv-accept]')", timeout=20000)
    host.click('[data-tv-accept]')
    tv.wait_for_function(PLAYING, timeout=30000)
    tv.wait_for_function('vmTvLinked()', timeout=20000)
    step('a TV joined and was let in: it shows the program')

    # its sound: its own player (on with a phone locked), off to start with, on with Sound, the show in Now Playing
    tv.wait_for_function('vmTvSound().track', timeout=20000)
    assert not tv.evaluate('vmTvSound().on') and tv.inner_text('#soundBtn') == 'Sound off'
    assert tv.evaluate("document.querySelector('#out').srcObject.getAudioTracks().length") == 0, 'the sound is played apart from the picture'
    tv.click('#soundBtn')
    tv.wait_for_function("vmTvSound().on && vmTvSound().nowPlaying === 'Hall'", timeout=5000)
    assert tv.inner_text('#soundBtn') == 'Sound on' and tv.evaluate('navigator.mediaSession.playbackState') == 'playing'
    tv.click('#soundBtn')
    assert not tv.evaluate('vmTvSound().on') and tv.evaluate('navigator.mediaSession.playbackState') == 'paused'
    step("the TV's sound plays from a player of its own, not the picture: off to start, on with Sound, with the show in Now Playing (playing, then paused)")

    # it says what it's getting, and the studio keeps it
    host.wait_for_function("vmShowLog().rows.slice(-8).some(r => (r.tv || []).some(t => t.n === 'Hall TV' && t.rfps > 5))", timeout=30000)
    t = next(x for r in reversed(host.evaluate('vmShowLog().rows')) for x in (r.get('tv') or []) if x['n'] == 'Hall TV' and x.get('rfps'))
    step(f"the TV says what it's getting, in the studio's show log: {t['rfps']} frames a second shown, {t.get('frz', 0)} freezes, its picture capped at {t['cap'] / 1000:.1f} Mbps")

    # the link dies: it joins again by itself
    t0 = time.time()
    tv.evaluate('vmTvBreak()')
    tv.wait_for_function('!vmTvLinked()', timeout=5000)
    tv.wait_for_function(f'vmTvLinked() && {PLAYING}', timeout=30000)
    step(f'its link died: it joined again by itself in {time.time() - t0:.0f} s, nothing pressed in the studio')

    # the computer slept (a closed lid): woken, it joins again at once
    t0 = time.time()
    tv.evaluate('vmTvSleep()')
    tv.wait_for_function("document.querySelector('#waitErr').textContent.includes('asleep') || !vmTvLinked()", timeout=6000)
    tv.wait_for_function(f'vmTvLinked() && {PLAYING}', timeout=30000)
    step(f'its computer slept (a closed lid): woken, it started its link again and was back in {time.time() - t0:.0f} s')

    # falling behind: the studio lowers its picture
    tv.evaluate("vmTvReport({ fps: 12, freezes: 2, freezeMs: 900, dropped: 20 })")
    host.wait_for_function("vmNotes().some(n => n.includes('Hall TV is falling behind'))", timeout=8000)
    note = next(n for n in host.evaluate('vmNotes()') if 'falling behind' in n)
    step(f'it said it was falling behind (12 frames a second, 2 freezes): "{note}"')

    # the phone remote: Program out above its cameras
    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    rem = b.new_context(viewport={'width': 390, 'height': 844}).new_page(); rem.on('pageerror', lambda e: errors.append(f'remote: {e}'))
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function("!document.querySelector('#ctlView').hidden && !document.querySelector('#pgmBox').hidden", timeout=30000)
    rem.wait_for_function("vmProgramView() && vmProgramView().linked && vmProgramView().shown > 10 && vmProgramView().w > 0", timeout=30000)
    pv = rem.evaluate('vmProgramView()')
    tvs = host.inner_text('#tvList')
    assert 'Program out' not in tvs and 'Hall TV' in tvs, tvs
    rem.click('#pgmTgl')
    assert rem.is_hidden('#pgmBox') and rem.evaluate('vmProgramView()') is None
    rem.click('#pgmTgl')
    rem.wait_for_function("vmProgramView() && vmProgramView().linked && vmProgramView().shown > 5", timeout=30000)
    step(f"the phone remote shows Program out above its cameras ({pv['w']}x{pv['h']}, {pv['shown']} frames so far), let in without Accept and not listed as a TV; it can be turned off and on")

    # its sound: the program's, muted to start with; a tap turns it on, remembered; opened again, the first tap anywhere brings it back
    rem.wait_for_function("vmProgramView().sound", timeout=20000)
    assert rem.evaluate('vmProgramView().muted') and rem.get_attribute('#sndBtn', 'aria-pressed') == 'false' and rem.inner_text('#sndBtn') == 'Sound off'
    rem.click('#sndBtn')
    rem.wait_for_function("!vmProgramView().muted && document.querySelector('#sndBtn').getAttribute('aria-pressed') === 'true'", timeout=5000)
    assert rem.inner_text('#sndBtn') == 'Sound on'
    rem.reload()
    rem.wait_for_function("vmProgramView() && vmProgramView().linked && vmProgramView().sound && vmProgramView().shown > 5", timeout=30000)
    time.sleep(1)
    came = 'by itself'
    if rem.evaluate('vmProgramView().muted'):  # (a browser that wants a tap first, as a phone does)
        assert rem.inner_text('#sndBtn') == 'Tap for sound'
        rem.wait_for_selector('#cams .cam')
        rem.click('#cams .cam')
        came = 'with the first tap'
    rem.wait_for_function("!vmProgramView().muted && document.querySelector('#sndBtn').textContent.trim() === 'Sound on'", timeout=5000)
    on_air = rem.inner_text('#onAir').replace('On air · ', '')
    rem.wait_for_function(f"vmProgramView().nowPlaying === {on_air!r}", timeout=5000)
    rem.click('#sndBtn')
    assert rem.evaluate('vmProgramView().muted') and rem.inner_text('#sndBtn') == 'Sound off'
    step(f"Program out has the program's sound: muted to start, on with a tap (remembered: opened again, back on {came}), what's on air in Now Playing ({on_air}), and off again")

    # a phone in a pocket: its pings late and its signalling gone, while its link is still connected: the studio keeps it
    kept = host.evaluate("""(() => { const h = vmDisplayHub(); for (const l of h.links.values()) l.lastSeen -= 30000; h.sweep(); h.syncPeers([]);
      return [...h.links.values()].filter((l) => l.pc && l.pc.connectionState === 'connected').length; })()""")
    assert kept == 2, kept
    time.sleep(2)
    assert rem.evaluate('vmProgramView().linked') and tv.evaluate('vmTvLinked()')
    step('a phone whose pings come late (its screen locked) and whose signalling has gone keeps its picture and sound while its link is connected')

    # the cameras aren't drawn again every second (that made the program stutter on a phone): only when something changes
    time.sleep(1.5)  # (after the cut: its state has come)
    rem.evaluate("window.__cam = document.querySelector('#cams .cam'); window.__img = document.querySelector('#cams .cam img')?.src || ''")
    time.sleep(3.5)
    assert rem.evaluate("document.querySelector('#cams .cam') === window.__cam"), 'the camera grid was drawn again with nothing changed'
    step('the camera buttons stay as they are while the studio sends what is on air each second')

    # Monitor: the remote's Program out says what it's getting, as a TV does, and its control link is there too
    mon = ctx.new_page(); mon.on('pageerror', lambda e: errors.append(f'monitor: {e}'))
    mon.goto(f"{BASE}/monitor?e={ev['id']}")
    mon.wait_for_function("(() => { const o = document.querySelector('#xfOut').textContent; return /Program out\\).*Phone remote · program.*shows [\\d.]+ fps/.test(o) && /Phone remote · control, open on its screen/.test(o); })()", timeout=30000)
    rx = host.evaluate("(async () => (await vmDisplayHub().stats()).find((t) => t.remote)?.rx)()")
    assert rx and rx['w'] and rx['h'] and rx['fps'] is not None and 'lost' in rx, rx
    out = mon.inner_text('#xfOut')
    step(f"Monitor lists the remote's Program out with what it shows ({rx['w']}x{rx['h']}, {rx['fps']} fps) and its control link: " + ' | '.join(l for l in out.splitlines() if 'remote' in l.lower())[:240])
    mon.close()
    assert not errors, errors
    b.close()
