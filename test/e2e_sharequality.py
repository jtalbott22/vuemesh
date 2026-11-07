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
    sh.wait_for_function("!document.querySelector('#sendSay').hidden && /frames a second/.test(document.querySelector('#sendSay').textContent)", timeout=8000)
    say, codec = sh.inner_text('#sendSay'), sh.evaluate('vmShare().codec')
    step(f'the share page says what it sends: "{say}" (codec {codec})')
    print('\nerrors:', errors or 'none')
    assert ok and not errors
    b.close()
