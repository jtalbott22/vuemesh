# The phone remote's own camera: "+ This phone" at the end of the remote's cameras joins the phone
# to the show as a camera too. Its picture comes back among the others' with THIS PHONE on it, and a
# tap on it cuts to it (ON AIR on its bar too). The whole frame goes, upright as held. It's not
# offered a program screen (the remote has Program out), and the program's sound is held off while
# its microphone is live. A second lens changes the studio's picture over; Mic off lets the sound go
# again; Remove (a second tap while on air) takes it out of the show, and "+ This phone" is back.
# Run: node dev/server.mjs &  then  python3 test/e2e_remotecam.py
import os
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
# (two fake cameras: the remote's camera has two lenses to choose from)
ARGS = ['--use-fake-device-for-media-stream=device-count=2', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Remote camera show'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=60000)
    cam = b.new_context(permissions=['camera', 'microphone']).new_page(); cam.on('pageerror', lambda e: errors.append(f'Ana: {e}'))
    cam.goto(f"{BASE}/cam?e={ev['id']}"); cam.fill('#name', 'Ana'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 1 && document.querySelector('.tile[data-peer] video').readyState >= 2", timeout=120000)

    host.click('#remoteAdd')
    host.wait_for_function("document.querySelector('#remoteDlg').open && document.querySelector('#remoteCode').textContent.length === 9", timeout=10000)
    code = host.inner_text('#remoteCode').replace('-', '')
    rem = b.new_context(viewport={'width': 390, 'height': 844}, permissions=['camera', 'microphone']).new_page()
    rem.on('pageerror', lambda e: errors.append(f'remote: {e}')); rem.on('dialog', lambda d: d.accept())
    rem.goto(f"{BASE}/remote?e={ev['id']}#p={code}")
    rem.wait_for_function("!document.querySelector('#ctlView').hidden && document.querySelectorAll('#cams .cam').length === 1 && vmProgramView()?.linked", timeout=30000)
    assert rem.is_visible('#cams .camadd[data-add]') and rem.is_hidden('#myCam') and rem.is_hidden('#noCams')
    step('a paired remote shows Ana and, after her, "+ This phone"; no camera bar yet')

    # the program's sound on, as a director with earbuds has it: it's held off once the mic is live
    rem.evaluate("document.querySelector('#sndBtn').click()")
    rem.click('#cams .camadd[data-add]')
    rem.wait_for_function("vmRemoteCam()?.on && ['lan','nat','internet','relay','unknown'].includes(vmRemoteCam().state)", timeout=30000)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2 && [...document.querySelectorAll('.tile[data-peer] video')].every(v => v.readyState >= 2)", timeout=30000)
    peer = rem.evaluate('vmRemoteCam().peer')
    rem.wait_for_function(f"""(() => {{ const me = document.querySelector('#cams .cam.mine[data-peer="{peer}"]');
      return me && me.querySelector('.tag.me')?.textContent === 'THIS PHONE' && me.querySelector('img')?.src.startsWith('data:image/jpeg') && !document.querySelector('#cams .camadd'); }})()""", timeout=30000)
    rc = rem.evaluate('vmRemoteCam()')
    assert rc['w'] > 0 and rc['mic'] and rc['micOn'] and rc['held'], rc
    assert rem.is_visible('#myCam') and rem.is_disabled('#sndBtn') and 'mic live' in rem.inner_text('#sndBtn'), rem.inner_text('#sndBtn')
    name = rem.inner_text(f'#cams .cam[data-peer="{peer}"] b')
    step(f'"+ This phone": the phone joins as a camera ("{name}"); the studio has its picture, and the remote shows it like the others, THIS PHONE on it; its own picture under the cameras ({rc["w"]}x{rc["h"]}); program sound held off ("{rem.inner_text("#sndBtn")}")')

    shape = host.evaluate(f"""document.querySelector('.tile[data-peer="{peer}"]')?.dataset.shape""")
    assert shape == 'landscape', shape
    rem.wait_for_timeout(4000)
    assert not rem.evaluate('vmRemoteCam().pgmOffered'), 'the studio offered the remote camera a program screen'
    step('the studio takes it as the whole frame, landscape, and offers it no program screen (the remote has Program out)')

    # held sideways, Program out's space can be wider (or taller) than the picture in it: the full-screen
    # mark is on the picture's own corner, and the camera's bar keeps "This phone" clear of its buttons
    for w, h in ((956, 380), (932, 430), (844, 390), (667, 375)):
        rem.set_viewport_size({'width': w, 'height': h})
        rem.wait_for_timeout(500)
        g = rem.evaluate('''(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), v = r('#pgm'), i = r('#pgmBox .fsico'), n = r('#myCamH'), m = r('#myMicBtn'), o = r('#myCamOff');
          const c = r('#clock'), d = r('#conn'), t = r('#title'), hd = r('header');
          return { right: Math.round(v.right - i.right), top: Math.round(i.top - v.top), nameClear: n.bottom <= Math.min(m.top, o.top) + 1 && n.right <= r('#myCam').right,
            clock: c.width > 0 && c.left >= t.right && c.right <= d.left && c.top >= hd.top && c.bottom <= hd.bottom && hd.height < 44 }; })()''')
        assert g == {'right': 8, 'top': 8, 'nameClear': True, 'clock': True}, (w, h, g)
    rem.set_viewport_size({'width': 390, 'height': 844})
    rem.wait_for_timeout(300)
    clock = rem.inner_text('#clock')
    import re as _re, datetime as _dt
    assert _re.fullmatch(r'\d{1,2}:\d{2}:\d{2}(\s?[AP]M)?', clock), clock
    assert rem.evaluate("(() => { const c = document.querySelector('#clock').getBoundingClientRect(), t = document.querySelector('#title').getBoundingClientRect(); return c.left >= t.right && c.right <= innerWidth && c.top < 60; })()")
    first = clock; rem.wait_for_timeout(1300)
    assert rem.inner_text('#clock') != first
    step(f'the time of day at the title bar\'s right end ("{clock}", ticking), upright and sideways, on one line beside the show\'s name')
    step('sideways (956x380, 932x430, 844x390, 667x375): the full-screen mark 8 px inside the picture\'s corner, and "This phone" clear of Mic and Remove')

    rem.click(f'#cams .cam[data-peer="{peer}"]')
    rem.wait_for_function(f"""document.querySelector('#cams .cam.air')?.dataset.peer === '{peer}' && vmRemoteCam().air && document.querySelector('#myCam').classList.contains('air') && document.querySelector('#myCamSay').textContent === 'ON AIR'""", timeout=15000)
    assert host.evaluate('vmSwitcher().liveActive') == peer
    step(f'a tap on its picture cuts to it: ON AIR on the remote ("{rem.inner_text("#onAir")}"), its tally on its bar, and live in the studio')

    lenses = rem.eval_on_selector_all('#lenses [data-lens]', 'els => els.map(e => [e.textContent, e.getAttribute("aria-pressed")])')
    assert len(lenses) == 2 and [x[1] for x in lenses].count('true') == 1, lenses
    was = rem.evaluate('vmRemoteCam().lens')
    t0 = host.evaluate(f"""document.querySelector('.tile[data-peer="{peer}"] video').currentTime""")
    rem.click('#lenses [data-lens][aria-pressed="false"]')
    rem.wait_for_function(f"vmRemoteCam().lens && vmRemoteCam().lens !== '{was}' && document.querySelector('#lenses [aria-pressed=true]')?.dataset.lens === vmRemoteCam().lens", timeout=15000)
    rem.wait_for_timeout(2500)
    t1 = host.evaluate(f"""document.querySelector('.tile[data-peer="{peer}"] video').currentTime""")
    assert t1 > t0 + 1, (t0, t1)
    assert host.evaluate('vmSwitcher().liveActive') == peer
    step(f'its lenses ({", ".join(x[0] for x in lenses)}): a tap on the other changes the camera, the studio\'s picture carries on ({t0:.1f} s, then {t1:.1f} s) and it stays on air')

    assert rem.evaluate('vmRemoteCam().micOpen && vmRemoteCam().soundSent')
    rem.click('#myMicBtn')
    rem.wait_for_function("!vmRemoteCam().micOn && !vmRemoteCam().held && !document.querySelector('#sndBtn').disabled", timeout=5000)
    # (let go, not only muted: an iPhone with its microphone open plays sound from the earpiece)
    rem.wait_for_function("!vmRemoteCam().micOpen && !vmRemoteCam().soundSent", timeout=5000)
    rem.click('#myMicBtn')
    rem.wait_for_function("vmRemoteCam().micOn && vmRemoteCam().held && vmRemoteCam().micOpen && vmRemoteCam().soundSent", timeout=10000)
    rem.wait_for_timeout(1500)
    got = host.evaluate(f"""(async () => {{ const pc = vmHub().links?.get?.('{peer}')?.pc; if (!pc) return null;
      let n = 0; (await pc.getStats()).forEach((r) => {{ if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.packetsReceived; }}); return n; }})()""")
    rem.wait_for_timeout(1500)
    got2 = host.evaluate(f"""(async () => {{ const pc = vmHub().links?.get?.('{peer}')?.pc; if (!pc) return null;
      let n = 0; (await pc.getStats()).forEach((r) => {{ if (r.type === 'inbound-rtp' && r.kind === 'audio') n += r.packetsReceived; }}); return n; }})()""")
    assert got is not None and got2 > got, (got, got2)
    step(f'Mic off lets go of the microphone (not only muted) and the program\'s sound goes again; Mic on opens it again, holds the sound off, and the studio hears it (sound packets {got}, then {got2})')

    # Record program on: a camera phone leaving is sent its part of the live cut, and the recording's
    # rolled for it; the remote's camera records nothing, so it's neither
    rem.click('#recBtn')
    rem.wait_for_function("document.querySelector('#recBtn').getAttribute('aria-pressed') === 'true'", timeout=20000)
    rem.wait_for_timeout(4000)
    # (on air, Remove asks for a second tap: the studio would go to its break slate)
    rem.click('#myCamOff')
    assert rem.inner_text('#myCamOff') == 'On air: tap again' and rem.evaluate('vmRemoteCam().on')
    rem.click('#myCamOff')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 1", timeout=20000)
    rem.wait_for_timeout(2000)
    rem.wait_for_function("!vmRemoteCam().on && !vmRemoteCam().held && document.querySelector('#myCam').hidden && document.querySelectorAll('#cams .cam').length === 1 && !!document.querySelector('#cams .camadd[data-add]')", timeout=20000)
    assert not rem.is_disabled('#sndBtn')
    notes = host.evaluate('vmNotes()')
    assert not any(name in n and ('live cut' in n or 'is leaving' in n) for n in notes), notes
    assert any(name in n and 'disconnected' in n for n in notes), notes
    rem.click('#recBtn'); rem.click('#recBtn')  # (stopping takes a second tap)
    rem.wait_for_function("document.querySelector('#recBtn').getAttribute('aria-pressed') === 'false'", timeout=20000)
    step('Remove, on air and recording: a second tap asked, then out of the show (the studio has Ana alone), no part of the live cut sent its way, the camera let go, "+ This phone" back and the sound button free')

    rem.click('#cams .camadd[data-add]')
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=30000)
    rem.wait_for_function("document.querySelectorAll('#cams .cam.mine').length === 1", timeout=30000)
    step('added again: back in the show, once')

    assert not errors, errors
    step('no page errors')
    b.close()
