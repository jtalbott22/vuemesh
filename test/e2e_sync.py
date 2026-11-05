# One timeline for the studio computer's cameras: every camera is held to one picture delay,
# so a cut never moves the program in time, and the sync check (a clap) measures each camera's
# own delay. With two stand-in cameras (each frame's shade says which moment it shows) where the
# back one is 120 ms slower than the desk one, and a stand-in microphone: before the check a cut
# from one to the other jumps about 120 ms; the clap (both cameras flash, the microphone hears a
# crack) finds the back camera about 120 ms slower; after it, a cut doesn't jump; sound from this
# computer waits as long as the pictures; and the camera stays on air with no animation frames
# (as in a hidden window), its pictures still coming.
# Run: node dev/server.mjs &  then  python3 test/e2e_sync.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
PERIOD = 2000   # the shade goes round every 2 s
SLOW = 120      # the back camera's own delay over the desk camera's (ms)
# Stand-in devices: two cameras drawing the moment as a shade of grey (the back one SLOW ms
# late), both flashing white at a clap, and a microphone with a little hiss and the clap's crack.
DEVICES = """
(() => {
  const PERIOD = %d, SLOW = %d;
  window.__clapAt = null;
  const cams = { 'cam-desk': ['Desk camera', 0], 'cam-back': ['Back camera', SLOW] };
  const make = (late) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const draw = () => {
      const t = performance.now() - late; // the moment this camera's picture shows
      const flash = window.__clapAt != null && t >= window.__clapAt && t < window.__clapAt + 120;
      const v = flash ? 255 : Math.round(((t %% PERIOD) / PERIOD) * 200 + 20);
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, 0, 640, 360);
    };
    setInterval(draw, 5); draw();
    return c.captureStream(30).getVideoTracks()[0];
  };
  let actx = null;
  const mic = () => {
    actx ||= new AudioContext();
    const dest = actx.createMediaStreamDestination();
    const hiss = actx.createBufferSource(), buf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() - 0.5) * 0.004;
    hiss.buffer = buf; hiss.loop = true; hiss.connect(dest); hiss.start();
    window.__crack = (atPerf) => {
      const b = actx.createBuffer(1, actx.sampleRate * 0.2, actx.sampleRate), x = b.getChannelData(0);
      for (let i = 0; i < x.length; i++) x[i] = (Math.random() - 0.5) * 1.6 * Math.exp(-i / (actx.sampleRate * 0.01));
      const s = actx.createBufferSource(); s.buffer = b; s.connect(dest);
      const ts = actx.getOutputTimestamp();
      s.start(ts.contextTime + (atPerf - ts.performanceTime) / 1000);
    };
    return dest.stream.getAudioTracks()[0];
  };
  navigator.mediaDevices.enumerateDevices = async () => [
    ...Object.entries(cams).map(([id, [label]]) => ({ deviceId: id, groupId: id, kind: 'videoinput', label, toJSON() { return this; } })),
    { deviceId: 'mic-room', groupId: 'mic-room', kind: 'audioinput', label: 'Room mic', toJSON() { return this; } },
  ];
  navigator.mediaDevices.getUserMedia = async (c) => {
    const out = new MediaStream();
    const vid = c?.video && (c.video.deviceId?.exact || 'cam-desk');
    if (c?.video) { const tr = make(cams[vid]?.[1] ?? 0); Object.defineProperty(tr, 'label', { value: cams[vid]?.[0] || 'Camera' }); out.addTrack(tr); }
    if (c?.audio) { const tr = mic(); Object.defineProperty(tr, 'label', { value: 'Room mic' }); out.addTrack(tr); }
    return out;
  };
  window.__clap = (inMs) => { const at = performance.now() + inMs; window.__clapAt = at; window.__crack(at); };
})();
""" % (PERIOD, SLOW)
# which moment the program shows now, from the shade at its middle: how far behind now (ms)
BEHIND = """(() => { const c = document.querySelector('#program'), g = c.getContext('2d');
  const d = g.getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; const v = s / (d.length / 4);
  const t = ((v - 20) / 200) * %d; return ((performance.now() %% %d) - t + %d) %% %d; })()""" % (PERIOD, PERIOD, PERIOD, PERIOD)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(DEVICES)
    host = ctx.new_page(); host.on('pageerror', lambda e: errors.append(f'studio: {e}')); host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    host.evaluate('vmSyncClear && vmSyncClear()') if host.evaluate('typeof vmSyncClear') == 'function' else None
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sync'})})).json()""")
    host.goto(f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)
    host.evaluate('vmSyncClear()')
    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="cam"]', timeout=10000)
    for _ in range(2):
        host.click('#localList [data-add="cam"] >> nth=0'); time.sleep(1.5)
    host.click('#localList [data-add="mic"] >> nth=0'); time.sleep(1)
    host.click('#localDlg form button')
    cams = {c['name']: c['peer'] for c in host.wait_for_function("vmSync().cams.length === 2 && vmSync().P && vmSync().cams.every(c => c.count > 30) && vmSync().cams", timeout=20000).json_value()}
    assert set(cams) == {'Desk camera', 'Back camera'}, cams

    def behind(name, n=8):
        host.click(f'.tile[data-peer="{cams[name]}"]'); time.sleep(1.2)
        xs = []
        for _ in range(n):
            xs.append(host.evaluate(BEHIND)); time.sleep(0.11)
        xs.sort()
        return xs[len(xs) // 2]
    time.sleep(16)   # (the measurements settle)
    a0, b0 = behind('Desk camera'), behind('Back camera')
    jump0 = b0 - a0
    assert abs(jump0 - SLOW) < 50, (a0, b0)
    step(f"before the sync check: on the desk camera the program shows {a0:.0f} ms ago, on the back camera {b0:.0f} ms ago: a cut jumps {jump0:.0f} ms (the back camera is {SLOW} ms slower inside)")

    # (during "clap now", where neither camera's shade is about to go round: well clear of that jump)
    host.evaluate(f"setTimeout(() => {{ const m = performance.now() % {PERIOD}; window.__clap(({PERIOD} * 1.5 - m + {PERIOD}) % {PERIOD}); }}, 3600)")
    res = host.evaluate('vmSyncCheck()')
    sync = host.evaluate('vmSync()')
    lat = {c['name']: c['latency'] for c in sync['cams']}
    diff = lat['Back camera'] - lat['Desk camera']
    clap = host.evaluate('window.__clapAt')
    assert res and all('ms' in r for r in res) and abs(diff - SLOW) < 45, (res, lat, 'clap at', round(clap), sync['check'])
    step(f"the sync check (a clap): {', '.join(res)}: the back camera {diff:.0f} ms slower; pictures line up at {sync['P']} ms")

    a1, b1 = behind('Desk camera'), behind('Back camera')
    assert abs(b1 - a1) < 45 and abs(a1 - sync['P']) < 80, (a1, b1, sync['P'])
    step(f"after it: desk camera {a1:.0f} ms ago, back camera {b1:.0f} ms ago: a cut moves {abs(b1 - a1):.0f} ms (was {jump0:.0f}); both about the picture delay, {sync['P']} ms")

    snd = {s['peer']: s['delay'] for s in sync['sound']}
    mic = next(p for p in snd if p.startswith('local-mic'))
    assert abs(snd[mic] - sync['P']) < 40, (snd, sync['P'])
    ev_ = [e['text'] for e in host.evaluate('vmShowLog().events') if e['kind'] == 'sync-check']
    assert ev_, 'the show log has the sync check'
    step(f"sound from this computer waits {snd[mic]} ms, with the pictures ({sync['P']} ms); the show log has the check")

    host.evaluate("window.requestAnimationFrame = () => 0"); time.sleep(4)
    counts = [c['count'] for c in host.evaluate('vmSync()')['cams']]; time.sleep(1)
    counts2 = [c['count'] for c in host.evaluate('vmSync()')['cams']]
    label = host.inner_text('#progLabel')
    assert all(y - x >= 20 for x, y in zip(counts, counts2)) and 'BREAK' not in label, (counts, counts2, label)
    step(f"no animation frames (as in a hidden window): each camera still sends ~{min(y - x for x, y in zip(counts, counts2))} pictures a second and stays on air ({label})")
    assert not errors, errors
    b.close()
