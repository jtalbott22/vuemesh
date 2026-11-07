# Sound on both sides, moments that stay on their footage, and the audio console.
#  - a phone whose microphone comes in left-only (as some phone browsers hand it over) still
#    records and sends both channels; the studio's fix fills an empty right side too
#  - a moment marked live, and a marker, stay on the footage they were put on through Collapse gaps
#  - the audio console pops out: EQ, high-pass and balance per channel (saved), visualizers,
#    Live and Edit, and the studio's keys work from it
# Run: node dev/server.mjs &  then  python3 test/e2e_audio_console.py
import os, time
from playwright.sync_api import sync_playwright
import sys as _sys; _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vmtest import edit_window   # (Edit is its own window)
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
LEFT_ONLY_MIC = """(() => {
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.audio && !c.video) {   // a microphone that arrives as 'stereo' with a silent right side
      const ctx = new AudioContext(), osc = ctx.createOscillator(), g = ctx.createGain(), m = ctx.createChannelMerger(2), d = ctx.createMediaStreamDestination();
      osc.frequency.value = 440; g.gain.value = 0.3; osc.connect(g); g.connect(m, 0, 0); m.connect(d); osc.start(); ctx.resume();
      return d.stream;
    }
    return orig(c);
  };
})();"""
SEQ = "JSON.parse(localStorage.getItem('vm_seq_' + new URLSearchParams(location.search).get('e')))"
PAINTED = "(id) => { const c = document.getElementById(id); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 60) n++; return n; }"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    def watch(page, tag):
        page.on('pageerror', lambda e: errors.append(f'{tag}: {e}'))
        page.on('dialog', lambda d: d.accept())
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    host = ctx.new_page(); watch(host, 'host')
    host.goto(BASE + '/')
    # ---- the building blocks, in a real browser
    r = host.evaluate("""(async () => {
      const { channelFixer, fixBufferChannels, balance } = await import('/js/audiofx.js');
      const ctx = new AudioContext(); await ctx.resume();
      const rms = (an) => { const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b); return Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length); };
      const probe = (node) => { const s = ctx.createChannelSplitter(2), l = ctx.createAnalyser(), r = ctx.createAnalyser(); node.connect(s); s.connect(l, 0); s.connect(r, 1); return () => [rms(l), rms(r)]; };
      // left only
      const o1 = ctx.createOscillator(), m1 = ctx.createChannelMerger(2); o1.connect(m1, 0, 0); o1.start();
      const f1 = channelFixer(ctx); m1.connect(f1.input); const p1 = probe(f1.output);
      // real stereo: different sounds left and right
      const oL = ctx.createOscillator(), oR = ctx.createOscillator(), m2 = ctx.createChannelMerger(2); oR.frequency.value = 660; oL.connect(m2, 0, 0); oR.connect(m2, 0, 1); oL.start(); oR.start();
      const f2 = channelFixer(ctx); m2.connect(f2.input); const p2 = probe(f2.output);
      // balance: centre keeps full level on both sides; hard left silences the right
      const o3 = ctx.createOscillator(); const bal = balance(ctx); o3.connect(bal.input); o3.start(); const p3 = probe(bal.output);
      await new Promise((r) => setTimeout(r, 1600));
      const a = p1(), s = p2(), c = p3(); bal.set(-1, false); await new Promise((r) => setTimeout(r, 200)); const h = p3();
      const buf = new AudioBuffer({ numberOfChannels: 2, length: 4800, sampleRate: 48000 }); buf.getChannelData(0).fill(0.2); fixBufferChannels(buf);
      return { leftOnly: a, fixedStereo: f1.stereo, stereo: s, stereoKept: f2.stereo, centre: c, hardLeft: h, bufR: buf.getChannelData(1)[100] };
    })()""")
    assert r['leftOnly'][1] > 0.5 and abs(r['leftOnly'][0] - r['leftOnly'][1]) < 0.02 and not r['fixedStereo'], r
    assert r['stereoKept'] and r['stereo'][1] > 0.5, r
    assert abs(r['centre'][0] - r['centre'][1]) < 0.02 and r['centre'][0] > 0.6 and r['hardLeft'][1] < 0.01, r
    assert abs(r['bufR'] - 0.2) < 1e-6, r
    step(f"left-only sound plays on both sides (L {r['leftOnly'][0]:.2f} / R {r['leftOnly'][1]:.2f}); real stereo stays stereo; balance keeps the centre at full level; a decoded left-only recording gets its right side")

    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Sound check'})})).json()""")
    EID = ev['id']
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    host.goto(f"{BASE}/studio?e={EID}#k={ev['hostKey']}")
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=10000)
    phones = []
    for name in ['Rosa', 'Dev']:
        cctx = b.new_context(permissions=['camera', 'microphone'])
        if name == 'Rosa': cctx.add_init_script(LEFT_ONLY_MIC)
        c = cctx.new_page(); watch(c, name)
        c.goto(f"{BASE}/cam?e={EID}"); c.fill('#name', name); c.check('#agreeGuest'); c.click('#joinForm button[type=submit]')
        phones.append(c)
    host.wait_for_function("document.querySelectorAll('.tile[data-peer] video').length === 2", timeout=25000); time.sleep(1)
    order = host.eval_on_selector_all('.tile[data-peer] .who', 'e => e.map(x => x.textContent)')
    for name in ['Rosa', 'Dev']:
        c = phones[0 if name == 'Rosa' else 1]
        c.evaluate("document.querySelector('#shutter').click()"); time.sleep(1)
        host.locator('body').click(position={'x': 700, 'y': 300}); host.keyboard.press(str(order.index(name) + 1)); time.sleep(1.5)
        if name == 'Dev': host.keyboard.press('m'); time.sleep(1)   # a moment in Dev's take
        c.evaluate("document.querySelector('#shutter').click()")
        if name == 'Rosa': time.sleep(4)   # nobody recording: a gap
    host.wait_for_function("(async () => await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result.filter(c => c.kind !== 'audio').length >= 2); }; }))()", timeout=40000); time.sleep(1.5)
    sides = host.evaluate("""(async () => {
      const recs = await new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction('clips').objectStore('clips').getAll(); t.onsuccess = () => r(t.result); }; });
      const rosa = recs.find(c => c.name === 'Rosa' && c.kind !== 'audio');
      const buf = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(await rosa.blob.arrayBuffer());
      const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      return { ch: buf.numberOfChannels, L: rms(buf.getChannelData(0)), R: buf.numberOfChannels > 1 ? rms(buf.getChannelData(1)) : null, audio: rosa.audio };
    })()""")
    assert sides['ch'] == 2 and sides['L'] > 0.02 and sides['R'] > 0.02 and abs(sides['L'] - sides['R']) < 0.25 * sides['L'], sides
    step(f"a phone whose mic came in left-only recorded both sides: L {sides['L']:.3f} / R {sides['R']:.3f} (labelled \"{sides['audio']}\")")

    # ---- moments and markers stay on their footage through Collapse gaps
    ed = edit_window(host.context, host, errors); time.sleep(1)
    ed.keyboard.press('End'); ed.keyboard.press('ArrowUp'); time.sleep(0.2)   # onto Dev's clip (an edit point)
    for _ in range(10): ed.keyboard.press('ArrowRight')
    ed.keyboard.press('m'); time.sleep(0.4)
    POS = """(() => { const it = [...document.querySelectorAll('.lane .item')].sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left))[1];
      const mo = document.querySelector('.marker.moment'), mk = document.querySelector('.marker:not(.moment)');
      return { item: parseFloat(it.style.left), moment: mo && parseFloat(mo.style.left), marker: mk && parseFloat(mk.style.left) }; })()"""
    before = ed.evaluate(POS)
    assert before['moment'] is not None and before['marker'] is not None and before['moment'] > before['item'], before
    ed.click('#gapsBtn'); time.sleep(0.6)
    after = ed.evaluate(POS)
    assert after['item'] < before['item'] - 5, (before, after)
    assert abs((after['moment'] - after['item']) - (before['moment'] - before['item'])) < 1.5, (before, after)
    assert abs((after['marker'] - after['item']) - (before['marker'] - before['item'])) < 1.5, (before, after)
    step(f"Collapse gaps moved Dev's clip {before['item'] - after['item']:.0f}px left, and the moment and the marker moved with it (still {after['moment'] - after['item']:.1f}px / {after['marker'] - after['item']:.1f}px into the clip)")
    ed.keyboard.press('Control+z'); time.sleep(0.4)
    back = ed.evaluate(POS)
    assert abs(back['moment'] - before['moment']) < 1.5 and abs(back['marker'] - before['marker']) < 1.5, (before, back)
    step('undo put the gap back, and the moment and marker back with their footage')

    # ---- the audio console, in Edit
    with ctx.expect_page() as pop:
        ed.click('#cardMix [data-console]')
    con = pop.value; watch(con, 'console')
    con.wait_for_selector('.ch[data-strip]', timeout=5000)
    tracks = ed.evaluate(f"{SEQ}.tracks.filter(t => t.kind === 'audio').map(t => t.name)")
    strips = con.eval_on_selector_all('.ch h3', 'e => e.map(x => x.textContent)')
    assert strips == tracks and con.inner_text('#room') == 'EDIT', (strips, tracks)
    def set_range(sel, v):
        con.evaluate("([s, v]) => { const i = document.querySelector(s); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }", [sel, v])
    first = '.ch[data-strip]:first-child'
    set_range(f'{first} input[data-k="high"]', '6'); set_range(f'{first} input[data-k="low"]', '-4.5'); set_range(f'{first} input[data-k="pan"]', '-30')
    con.click(f'{first} [data-hp]'); time.sleep(0.4)
    tr = ed.evaluate(f"{SEQ}.tracks.filter(t => t.kind === 'audio')[0]")
    assert tr['eq'] == {'hp': True, 'low': -4.5, 'mid': 0, 'high': 6} and abs(tr['pan'] + 0.3) < 1e-9, tr
    assert con.inner_text(f'{first} [data-o="pan"]') == 'L30' and con.inner_text(f'{first} [data-o="high"]') == '+6.0'
    con.dblclick(f'{first} input[data-k="pan"]'); time.sleep(0.3)
    assert ed.evaluate(f"{SEQ}.tracks.filter(t => t.kind === 'audio')[0].pan") == 0
    step(f"console (Edit): one channel per audio track {strips}; HIGH +6, LOW −4.5, HPF on and balance L30 saved with the edit; double-click put the balance back to centre")
    ed.locator('body').click(position={'x': 700, 'y': 300}); ed.keyboard.press('Home'); ed.keyboard.press('Space'); time.sleep(1.5)
    spec, curve = con.evaluate(PAINTED, 'cSpec'), con.evaluate(f"(() => {{ const c = document.querySelector('{first} [data-curve]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i+2] > 120) n++; return n; }})()")
    peak = con.inner_text('#rPeak')
    for _ in range(40):   # (a busy machine can take a few seconds to get the edit's sound going)
        if peak != '−∞': break
        time.sleep(0.15); peak = con.inner_text('#rPeak')
    ed.keyboard.press('Space')
    assert spec > 200 and curve > 50 and peak != '−∞', (spec, curve, peak)
    step(f'playing the edit: spectrum drawn ({spec} lit pixels), the EQ curve shows the boost and cut, output peak {peak}')

    # ---- in Live: the studio's own console (the Edit window's console is Edit only); the studio's keys work from it
    con.close()
    with ctx.expect_page() as pop:
        host.evaluate("[...document.querySelectorAll('[data-console]')].find(b => b.offsetParent).click()")
    con = pop.value; watch(con, 'console (studio)')
    con.wait_for_selector('.ch[data-strip]', timeout=15000)
    assert con.inner_text('#room') == 'LIVE' and host.evaluate("document.body.dataset.mode") == 'live'
    live_strips = con.eval_on_selector_all('.ch h3', 'e => e.map(x => x.textContent)')
    assert len(live_strips) == 2, live_strips
    first = '.ch[data-strip]'
    set_range(f'{first} input[data-k="mid"]', '3'); con.click(f'{first} [data-amode="on"]'); time.sleep(0.3)
    saved = host.evaluate(f"JSON.parse(localStorage.getItem('vm_livemix_{EID}'))")
    entry = next(v for v in saved.values() if v.get('eq'))
    assert entry['eq']['mid'] == 3 and entry['mode'] == 'on', saved
    con.locator('body').click(position={'x': 600, 'y': 60}); con.keyboard.press('2'); time.sleep(0.6)
    label = host.inner_text('#progLabel')
    assert 'ON AIR' in label and order[1] in label, label
    step(f"console (Live, the studio's own): {live_strips}; MID +3 and ON saved for that phone; pressing 2 in the console cut the studio ({label})")
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
