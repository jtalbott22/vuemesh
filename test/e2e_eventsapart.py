# Events kept apart on a phone: My events lists each event by its name, when it was, and its
# code (names repeat: "Test" made on three computers is three events). And codes are reused
# once an event's gone: when a phone with things from an older event meets a new event with
# that code, the old things move aside (still in My events, by their date), the new event starts clean.
# Run: node dev/server.mjs &  then  python3 test/e2e_eventsapart.py
import os, json
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox']
def step(m): print('ok  ' + m, flush=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)
    errors = []
    ph = b.new_context(permissions=['camera', 'microphone']).new_page(); ph.on('pageerror', lambda e: errors.append(f'phone: {e}'))
    ph.goto(BASE + '/')
    mk = lambda t: ph.evaluate(f"""async () => (await fetch('/api/events', {{method:'POST', headers:{{'content-type':'application/json'}}, body: JSON.stringify({{title:'{t}'}})}})).json()""")
    e1, e2 = mk('Test'), mk('Test')
    # this phone was at an older event that had e1's code (that event's gone; the code came round again)
    ph.evaluate(f"""async () => {{
      localStorage.setItem('vm_events', JSON.stringify([{{ id: '{e1['id']}', title: 'Test', at: 1000, createdAt: 1700000000000, role: 'guest' }}]));
      localStorage.setItem('vm_msgs_{e1['id']}', JSON.stringify([{{ at: 1, text: 'from the old one' }}]));
      const idb = await import('/js/idb.js');
      await idb.put('outbox', {{ eventId: '{e1['id']}', id: 'old-clip', blob: new Blob(['x'.repeat(2000)], {{ type: 'video/webm' }}), status: 'delivered', createdAt: 1700000000000, meta: {{ t0: 1700000000000, dur: 3000, kind: 'video' }} }});
    }}""")
    for e in (e1, e2):
        ph.goto(f"{BASE}/cam?e={e['id']}#n=Test"); ph.wait_for_selector('#joinForm')  # (the name, as a link carries it: the server never has it)
    recs = ph.evaluate("(async () => (await (await import('/js/idb.js')).listAll('outbox')).map(r => r.eventId))()")
    ids = [x['id'] for x in json.loads(ph.evaluate("localStorage.getItem('vm_events')"))]
    old = f"{e1['id']}~1700000000000"
    assert recs == [old] and old in ids and ph.evaluate(f"localStorage.getItem('vm_msgs_{old}')") and not ph.evaluate(f"localStorage.getItem('vm_msgs_{e1['id']}')"), (recs, ids)
    step(f"the code {e1['id']} came round again: the old event's clip and messages moved aside to {old}; the new event starts clean")
    for e in (e1, e2):   # (it joins both: two more "Test" events)
        ph.goto(f"{BASE}/cam?e={e['id']}#n=Test"); ph.fill('#name', 'Rosa'); ph.check('#agreeGuest'); ph.click('#joinForm button[type=submit]'); ph.wait_for_selector('#camView.on', timeout=20000)
    ph.click('#camTitle'); ph.click('#linkSheet .openLib'); ph.wait_for_selector('#library:not([hidden])')
    labels = ph.eval_on_selector('#libEvent', 's => [...s.options].map(o => o.textContent)')
    tests = [l for l in labels if l.startswith('Test')]
    assert len(tests) == 3 and len(set(tests)) == 3 and all(e1['id'] in l or e2['id'] in l for l in tests), labels
    step(f'My events tells three "Test" events apart by when and their code: {tests}')
    print('\nerrors:', errors or 'none')
    assert not errors
    b.close()
