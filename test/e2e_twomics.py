# One interface, two microphones: an input of this computer that opens with two sides (an
# interface's Input 1 on the left, Input 2 on the right, as a Scarlett does on Pro Audio in Linux,
# or always on a Mac) split into two microphones from its one stream. Chrome on Linux can't open
# an interface's two inputs separately (the first goes silent), so this is how both are heard.
#  - right-click, Two microphones: two tiles and two mixer strips, each hearing only its own side
#  - each records its own side (Input 1's file loud, Input 2's quiet, as they were)
#  - a reload brings it back split, with its names
#  - One microphone puts both sides back together; removing the first side takes the second too
# Here the "interface" is a stand-in: a loud tone on the left, a quiet one on the right.
# Run: node dev/server.mjs &  then  python3 test/e2e_twomics.py
import os, time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
CHROME = os.environ.get('CHROME')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
TWO_INPUTS = """(() => {   // a microphone that opens with two sides: Input 1 (left) loud, Input 2 (right) quiet
  const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (c && c.audio && !c.video && c.audio.deviceId) {
      const ctx = new AudioContext(), m = ctx.createChannelMerger(2), dst = ctx.createMediaStreamDestination();
      dst.channelCount = 2;
      for (const [side, hz, amp] of [[0, 440, 0.5], [1, 660, 0.02]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = hz; g.gain.value = amp; o.connect(g).connect(m, 0, side); o.start();
      }
      m.connect(dst); ctx.resume();
      // (named as the device it stands in for, as a real one is: a reload finds it again by its name)
      const want = c.audio.deviceId.exact || c.audio.deviceId;
      const d = (await navigator.mediaDevices.enumerateDevices()).find((x) => x.deviceId === want);
      const t = dst.stream.getAudioTracks()[0];
      if (d?.label) Object.defineProperty(t, 'label', { value: d.label });
      return dst.stream;
    }
    return orig(c);
  };
})();"""
IDB_ALL = "(store) => new Promise(r => { const q = indexedDB.open('vuemesh'); q.onsuccess = () => { const t = q.result.transaction(store).objectStore(store).getAll(); t.onsuccess = () => r(t.result); }; })"
MICS = "[...document.querySelectorAll('button.mic[data-peer^=\"local-mic\"]')].map(b => b.dataset.peer)"
# each microphone's loudest in the last few seconds of the show log (dBFS)
LEVELS = """() => { const out = {}; for (const r of vmShowLog().rows.slice(-3)) for (const s of r.s) if (s.k === 'mic') out[s.n] = Math.max(out[s.n] ?? -99, s.db ?? -99); return out; }"""
# a recording's loudness (dBFS, RMS), decoded here
RMS = """async (id) => { const all = await (%s)('clips'); const c = all.find(x => x.id === id); const ctx = new OfflineAudioContext(1, 48000, 48000);
  const buf = await ctx.decodeAudioData(await c.blob.arrayBuffer()); const d = buf.getChannelData(0); let s = 0; for (const v of d) s += v * v;
  return { ch: buf.numberOfChannels, secs: Math.round(buf.duration * 10) / 10, db: Math.round(10 * Math.log10(s / d.length)) }; }""" % IDB_ALL

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS) if CHROME else p.chromium.launch(args=ARGS)
    errors = []
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    ctx.add_init_script(TWO_INPUTS)
    host = ctx.new_page()
    host.on('pageerror', lambda e: errors.append(f'studio: {e}'))
    host.on('dialog', lambda d: d.accept())
    host.goto(BASE + '/')
    ev = host.evaluate("""async () => (await fetch('/api/events', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({title:'Two mics'})})).json()""")
    host.evaluate("localStorage.setItem('vm_autorec_default', '0')")
    studio = f"{BASE}/studio?e={ev['id']}#k={ev['hostKey']}"
    host.goto(studio)
    host.wait_for_function("document.querySelector('#presence').textContent.includes('recording')", timeout=20000)

    host.click('#addLocal'); host.wait_for_selector('#localDlg[open]')
    if host.is_visible('#localAllow'): host.click('#localAllow')
    host.wait_for_selector('#localList [data-add="mic"]', timeout=10000)
    # (its As: Two mono tracks can be chosen here, up front; it starts on Stereo, one microphone)
    sel = host.eval_on_selector('#localList select[data-as]', 's => ({ v: s.value, opts: [...s.options].map(o => o.textContent) })')
    assert sel['v'] == 'stereo' and any('Two mono tracks' in o for o in sel['opts']), sel
    host.click('#localList [data-add="mic"] >> nth=0'); host.wait_for_selector('button.mic[data-peer^="local-mic"]', timeout=10000)
    host.click('#localDlg form button')
    one = host.evaluate(MICS)
    assert len(one) == 1, one
    whole = host.evaluate(f"vmMedia().find(x => x.peer === '{one[0]}').name")
    hint = ' '.join(host.eval_on_selector_all('.toast', 'e => e.map(x => x.textContent)'))
    # (chosen in As, so no tip to right-click for Two microphones: the choice was just there)
    assert 'is in the show (recording)' in hint and 'Right-click' not in hint, hint
    step(f'a two-sided input added as one microphone ("{whole}"), As offering {sel["opts"]}; the studio says: "{hint.strip()}"')

    host.click(f'button.mic[data-peer="{one[0]}"]', button='right')
    host.click('text=Two microphones')
    host.wait_for_function(f"{MICS}.length === 2", timeout=5000)
    two = host.evaluate(MICS)
    names = host.evaluate("vmMedia().filter(x => x.peer.startsWith('local-mic')).map(x => x.name)")
    assert names == [f'{whole} · Input 1', f'{whole} · Input 2'], names
    time.sleep(3.5)
    lv = host.evaluate(LEVELS)
    l1, l2 = lv[names[0]], lv[names[1]]
    assert -9 <= l1 <= -3 and -40 <= l2 <= -30, lv   # (0.5 is -6 dB, 0.02 is -34 dB: each hears only its own side)
    step(f'Two microphones: {names[0]} hears {l1} dB (the left side), {names[1]} {l2} dB (the right), each its own strip')

    time.sleep(2)
    host.click(f'button.mic[data-peer="{two[0]}"]', button='right')
    host.click('text=One microphone')
    host.wait_for_function(f"{MICS}.length === 1", timeout=5000)
    time.sleep(1.5)
    clips = host.evaluate(f"(async () => (await ({IDB_ALL})('clips')).filter(c => c.kind === 'audio').map(c => ({{ id: c.id, name: c.name, cid: c.cid, size: c.blob.size }})))()")
    side = {n: next(c for c in reversed(clips) if c['name'] == n) for n in names}
    r1, r2 = host.evaluate(RMS, side[names[0]]['id']), host.evaluate(RMS, side[names[1]]['id'])
    assert r1['secs'] >= 4 and r2['secs'] >= 4, (r1, r2)
    assert -13 <= r1['db'] <= -6 and -45 <= r2['db'] <= -33 and side[names[0]]['cid'] != side[names[1]]['cid'], (r1, r2, side)
    back = host.evaluate(f"vmMedia().find(x => x.peer === '{one[0]}').name")
    assert back == whole, back
    step(f"each side recorded its own ({names[0]}: {r1['secs']} s at {r1['db']} dB RMS; {names[1]}: {r2['secs']} s at {r2['db']} dB), then One microphone: \"{back}\" again")

    host.click(f'button.mic[data-peer="{one[0]}"]', button='right')
    host.click('text=Two microphones')
    host.wait_for_function(f"{MICS}.length === 2", timeout=5000)
    host.evaluate("() => { const r = [...document.querySelectorAll('button.mic[data-peer$=\"-R\"]')][0]; r && r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 })); }")
    host.click('text=Rename…')
    host.wait_for_selector('dialog[open] input', timeout=3000)
    host.fill('dialog[open] input', 'Guest')
    host.keyboard.press('Enter')   # (Enter saves: it used to press Cancel)
    time.sleep(0.5)
    host.reload()
    host.wait_for_function(f"{MICS}.length === 2", timeout=20000)
    after = host.evaluate("vmMedia().filter(x => x.peer.startsWith('local-mic')).map(x => x.name)")
    assert after == [f'{whole} · Input 1', 'Guest'], after
    time.sleep(3.5)
    lv = host.evaluate(LEVELS)
    assert -9 <= lv[after[0]] <= -3 and -40 <= lv['Guest'] <= -30, lv
    step(f'after a reload it comes back split, names and all: {after} ({lv[after[0]]} and {lv["Guest"]} dB)')

    first = [p for p in host.evaluate(MICS) if not p.endswith('-R')][0]
    host.click(f'button.mic[data-peer="{first}"]', button='right')
    host.click('text=Remove from the show')
    host.wait_for_function(f"{MICS}.length === 0", timeout=5000)
    step('removing the first side takes the second with it (it was the same device)')

    assert not errors, errors
    b.close()
print('PASS')
