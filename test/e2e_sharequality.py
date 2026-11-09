# Another computer's screen (/share), measured: what it sends and what the studio gets, off air
# and on air. The "screen" is 1920 x 1080, busy (a grid of text and a moving block, redrawn 30 times
# a second), with stereo sound: a tone on the left only. Checks the picture reaches about 30 frames
# a second at full size on air, and that its sound arrives in stereo (left loud, right quiet: mono
# would make them equal) and has a stereo strip in the mixer, and that the share page says what it's
# sending (size, frame rate, codec, what's holding it back).
# Run: node dev/server.mjs &  then  python3 test/e2e_sharequality.py
import os, time, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)

# every peer connection, so the test can read its stats and descriptions
CAPTURE_PCS = """(() => {
  const PC = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends PC { constructor(...a) { super(...a); window.__pcs.push(this); } };
})();"""
BUSY_SCREEN = """(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const g = c.getContext('2d'); let n = 0;
    setInterval(() => {
      n++;
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#123'; g.font = '22px monospace';
      for (let y = 30; y < 1080; y += 30) g.fillText(`line ${y / 30} · frame ${n} · the quick brown fox jumps over the lazy dog 0123456789`, 20 + (y % 7), y);
      g.fillStyle = '#c00'; g.fillRect((n * 23) % 1800, 500, 120, 120);
    }, 33);
    const s = c.captureStream(30);
    const ctx = new AudioContext(), m = ctx.createChannelMerger(2), d = ctx.createMediaStreamDestination();
    const o = ctx.createOscillator(), gn = ctx.createGain(); o.frequency.value = 440; gn.gain.value = 0.5; o.connect(gn); gn.connect(m, 0, 0); o.start();
    m.connect(d); ctx.resume();
    s.addTrack(d.stream.getAudioTracks()[0]);
    return s;
  };
})();"""

SEND = """async () => {
  const out = {};
  for (const pc of window.__pcs) {
    if (pc.connectionState !== 'connected') continue;
    (await pc.getStats()).forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video') Object.assign(out, { w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond, limit: r.qualityLimitationReason, enc: r.encoderImplementation, bytes: r.bytesSent, t: r.timestamp });
      if (r.type === 'outbound-rtp' && r.kind === 'audio') out.audioBytes = r.bytesSent;
    });
    const fm = (pc.remoteDescription?.sdp || '').split('\\r\\n').find((l) => /^a=fmtp:\\d+ .*useinbandfec/.test(l));
    out.opusAnswer = fm || null;
  }
  return out;
}"""
# what the studio receives from the share page's link: its frame rate, and its sound's two sides
RECV = """async (secs) => {
  let pc = null, best = 0;
  for (const p of window.__pcs) {
    if (p.connectionState !== 'connected') continue;
    let w = 0; (await p.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') w = r.frameWidth || 0; });
    if (w > best) { best = w; pc = p; }
  }
  if (!pc) return null;
  const grab = async () => { let o = {}; (await pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'video') o = { frames: r.framesDecoded, t: r.timestamp, w: r.frameWidth, h: r.frameHeight }; }); return o; };
  const a = await grab(); await new Promise((r) => setTimeout(r, secs * 1000)); const b = await grab();
  const at = pc.getReceivers().find((r) => r.track?.kind === 'audio')?.track;
  let L = null, R = null;
  if (at) {
    const ctx = new AudioContext(); await ctx.resume();
    const src = ctx.createMediaStreamSource(new MediaStream([at])), sp = ctx.createChannelSplitter(2);
    const an = [ctx.createAnalyser(), ctx.createAnalyser()]; src.connect(sp); sp.connect(an[0], 0); sp.connect(an[1], 1);
    const el = new Audio(); el.srcObject = new MediaStream([at]); el.muted = true; el.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const rms = (x) => { const buf = new Float32Array(2048); x.getFloatTimeDomainData(buf); return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length); };
    L = rms(an[0]); R = rms(an[1]); ctx.close();
  }
  return { fps: (b.frames - a.frames) / ((b.t - a.t) / 1000), w: b.w, h: b.h, L, R };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(CAPTURE_PCS)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'host: {e}'))
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Share quality'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=15000)

    other = b.new_context(viewport={'width': 1000, 'height': 800})
    other.add_init_script(CAPTURE_PCS); other.add_init_script(BUSY_SCREEN)
    sh = other.new_page(); sh.on('pageerror', lambda e: errors.append(f'share: {e}'))
    sh.goto(f"{BASE}/share?e={ev['id']}")
    sh.fill('#name', 'Presenter'); sh.click('#shareBtn')
    sh.wait_for_function("document.querySelector('#linkSay').textContent.startsWith('In the studio')", timeout=20000)
    host.wait_for_function("[...document.querySelectorAll('.tile')].some((t) => t.textContent.includes('Presenter') && t.querySelector('video')?.readyState >= 2)", timeout=20000)
    time.sleep(6)
    s0, r0 = sh.evaluate(SEND), host.evaluate(RECV, 3)
    print('off air  send', json.dumps(s0), '\n         recv', json.dumps(r0), flush=True)

    host.click('.tile:has-text("Presenter")'); time.sleep(8)
    s1, r1 = sh.evaluate(SEND), host.evaluate(RECV, 4)
    print('on air   send', json.dumps(s1), '\n         recv', json.dumps(r1), flush=True)
    strip = host.evaluate("""() => [...document.querySelectorAll('#bridge .vstrip')].filter((s) => s.textContent.includes('Presenter')).map((s) => s.querySelectorAll('.fill').length)""")
    print('mixer strip meters:', strip, flush=True)

    ok = True
    if not (r1['fps'] >= 24 and r1['h'] >= 1000): ok = False; print('FAIL  on air: under 24 frames a second or not full size', flush=True)
    else: step(f"on air: {r1['w']}x{r1['h']} at {r1['fps']:.0f} frames a second in the studio")
    if not (r1['L'] and r1['L'] > 0.02 and r1['R'] < r1['L'] * 0.3): ok = False; print(f"FAIL  sound not stereo: L {r1['L']}, R {r1['R']}", flush=True)
    else: step(f"its sound is stereo: left {r1['L']:.3f}, right {r1['R']:.3f}")
    if strip != [2]: ok = False; print(f'FAIL  mixer strip meters {strip} (want [2])', flush=True)
    else: step('its mixer strip is stereo (two meters)')
    # the audio console: a stereo source has a meter for each side (left lit, right dark: mono would light both)
    with host.context.expect_page() as pop:
        host.locator('[data-console]').first.click()
    con = pop.value
    con.wait_for_selector('.ch[data-strip]', timeout=5000); time.sleep(1.5)
    bars = con.evaluate("""() => { const ch = [...document.querySelectorAll('.ch[data-strip]')].find((c) => c.textContent.includes('Presenter'));
      const cv = ch.querySelector('[data-meter]'), g = cv.getContext('2d'), H = cv.height, W = cv.width;
      const px = (x) => [...g.getImageData(Math.round(x), H - 3, 1, 1).data.slice(0, 3)];
      return { left: px(W * 0.2), right: px(W * 0.8) }; }""")
    lit = lambda p: p[1] > 120
    assert lit(bars['left']) and not lit(bars['right']), bars
    step(f"the audio console shows the screen's two sides: left lit {bars['left']}, right dark {bars['right']}")
    con.close()
    # Camera control: the screen has a card with CUT (nothing else to adjust), and CUT works
    with host.context.expect_page() as pop:
        host.click('#ccuBtn')
    ccu = pop.value
    ccu.wait_for_selector('section.cam:has-text("Presenter") .cut', timeout=8000)
    hint = ccu.inner_text('section.cam:has-text("Presenter") .hint')
    assert 'screen' in hint and 'Waiting' not in hint, hint
    cuts = lambda: host.evaluate("vmNotes().filter((n) => /Cut: .*Presenter/.test(n)).length")
    before = cuts()
    ccu.click('section.cam:has-text("Presenter") .cut'); time.sleep(1)
    assert cuts() == before + 1 and 'Presenter' in host.inner_text('#progLabel'), (before, cuts(), host.inner_text('#progLabel'))
    step(f'Camera control: the screen has CUT ("{hint}"), and CUT cut to it')
    ccu.close()
    # the stream key: a text field shown as dots, so Chrome doesn't take the studio for a login page
    key = host.evaluate("(() => { const k = document.querySelector('#stKey'); return [k.type, getComputedStyle(k).webkitTextSecurity, document.querySelectorAll('input[type=password]').length]; })()")
    assert key == ['text', 'disc', 0], key
    step('no password field in the studio: the stream key is a text field shown as dots')
    # no message box for another computer's screen (its share page has nowhere to show one)
    assert host.locator('.cam:has-text("Presenter") .dmrow').count() == 0
    step('no Message… under the screen (its share page has nowhere to show one)')
    # what's on it: slides keep their size, video keeps its frame rate
    PREF = "() => { for (const pc of window.__pcs) for (const s of pc.getSenders()) if (s.track?.kind === 'video') return [s.getParameters().degradationPreference, s.track.contentHint]; return null; }"
    # its sound is playing (the tone), so it went to Video and motion by itself, said so, and didn't
    # remember it; the presenter choosing Slides and text then holds (it isn't changed back)
    assert sh.evaluate(PREF) == ['maintain-framerate', 'motion'], sh.evaluate(PREF)
    assert 'sent as Video and motion' in sh.inner_text('#soundSay'), sh.inner_text('#soundSay')
    assert sh.evaluate("localStorage.getItem('vm_share_mode')") != 'motion'
    sh.check('input[name="mode"][value="detail"]'); time.sleep(4)
    assert sh.evaluate(PREF) == ['maintain-resolution', 'detail'], sh.evaluate(PREF)
    step('playing sound: sent as Video and motion by itself, said so, not remembered; Slides and text chosen then holds')
    # the studio keeps 150 ms of its sound in hand (a stall then a rush isn't hurried through)
    jb = host.evaluate("[...new Set(window.__pcs.flatMap((pc) => pc.getReceivers().filter((r) => r.track?.kind === 'audio').map((r) => r.jitterBufferTarget)))]")
    assert jb == [150], jb
    step(f'the studio holds 150 ms of the screen\'s sound in hand ({jb})')
    # the show log has its sound as played here: its jitter and wait every second, and, once per link
    # reading (every few seconds), ms hurried through, made up and arrived (about 5000 a reading, in ms
    # of sound: not counted twice for its two sides)
    host.wait_for_function("vmShowLog().rows.filter((r) => r.s.some((s) => s.k === 'screen' && typeof s.got === 'number' && s.got > 0)).length >= 2", timeout=30000)
    snd = host.evaluate("vmShowLog().rows.map((r) => r.s.find((s) => s.k === 'screen')).filter(Boolean)")
    fresh = [s for s in snd if 'got' in s]
    assert all(3500 <= s['got'] <= 7000 for s in fresh[1:]), [s['got'] for s in fresh]
    assert all(s['fast'] >= 0 and s['slow'] >= 0 and s['fill'] >= 0 for s in fresh), fresh
    last = snd[-1]
    assert isinstance(last.get('ajit'), int) and 100 <= last.get('abuf', 0) <= 400, last
    assert len(fresh) < len([s for s in snd if 'ajit' in s]), 'what the browser did is in one sample per reading, not every second'
    step(f"the show log: the screen's sound jitter {last['ajit']} ms, waiting {last['abuf']} ms; per reading {[s['got'] for s in fresh]} ms arrived, {[s['fast'] for s in fresh]} ms hurried, {[s['fill'] for s in fresh]} ms made up")
    sh.check('input[name="mode"][value="motion"]'); time.sleep(0.5)
    assert sh.evaluate(PREF) == ['maintain-framerate', 'motion'], sh.evaluate(PREF)
    assert sh.evaluate("localStorage.getItem('vm_share_mode')") == 'motion'
    sh.check('input[name="mode"][value="detail"]'); time.sleep(0.5)
    assert sh.evaluate(PREF) == ['maintain-resolution', 'detail'], sh.evaluate(PREF)
    step('Slides and text keeps the size (frames give way); Video and motion keeps 30 a second (size gives way), switchable while sharing, remembered')
    # the studio's log has what the screen says about its own sending
    host.wait_for_function("(() => { const r = window.vmShowLog?.()?.rows?.at(-1); return (r?.s || []).some((s) => s.n === 'Presenter' && typeof s.tx === 'number'); })()", timeout=15000)
    row = next(s for s in host.evaluate("window.vmShowLog().rows.at(-1).s") if s['n'] == 'Presenter')
    step(f"the show log has what it says it sent: tx {row.get('tx')} fps, {row.get('txk')} kbit/s, held back: {row.get('lim')}, encoder {row.get('enc')}")
    sh.wait_for_function("!document.querySelector('#sendSay').hidden && /frames a second/.test(document.querySelector('#sendSay').textContent)", timeout=8000)
    say, codec = sh.inner_text('#sendSay'), sh.evaluate('vmShare().codec')
    step(f'the share page says what it sends: "{say}" (codec {codec})')
    print('\nerrors:', errors or 'none')
    assert ok and not errors
    b.close()
