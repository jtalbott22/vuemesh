#!/usr/bin/env python3
"""One-time (0.43.0): the kiosk page, from the Live page. /kiosk used to be a launcher that
opened the studio in kiosk mode (the studio's CSS hid what a sign doesn't need); now it's the
screen itself, with only what a sign needs, and the launcher folded in.
    python3 tools/make_kiosk_page.py public/studio.html public/kiosk.html
"""
import json, sys
from bs4 import BeautifulSoup, Comment

# what kiosk mode hides (the studio's body.kiosk rules), for the markup that's there from the start
HIDDEN = ('.insp, .dock, .split, .transport, #switcher, #splitD, .sources .phead button, '
          '.sources > :not(.phead):not(#multi):not(#blockedBox), .ptabs, .banner, .incoming, '
          'header.bar > :not(.mark):not(.ev):not(.status)')

LAUNCH_CSS = """
  /* /kiosk with no show in the address: this screen starts one (or carries on its own), then shows it */
  .launching { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; background: #0f1013; color: #f3f4f6; text-align: center; font-size: clamp(1.1rem, 3vmin, 1.8rem); cursor: none; }
  .launching .lmark { font-weight: 800; font-stretch: 125%; font-size: 1.6em; }
  .launching .lmark i { display: inline-block; width: .55em; height: .55em; border-radius: 50%; background: #e5534b; margin-right: .35em; vertical-align: .05em; }
  .launching p { color: #c3c6cf; margin: .6em 0 0; }
  .launching .err { color: #ff8a80; }
"""

LAUNCHER = """
<script type="module">
  import { $, api } from '/js/vm.js';
  // /kiosk with no show in the address: this screen's show (one at a time), if it's still there,
  // or a new one; then the screen shows it, at /kiosk?e=…. A kiosk show deletes itself on the
  // server 12 hours after it started; the screen starts a new one after each show ends.
  const KEY = 'vm_kiosk';
  const go = (s) => location.replace(`/kiosk?e=${s.id}#k=${s.hostKey}`);
  async function start() {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s?.id && s.hostKey) {
      const alive = await api(`events/${s.id}`).then(() => true).catch(() => false);
      if (alive) return go(s);
    }
    try {
      const ev = await api('events', { method: 'POST', body: { kiosk: true, orientation: 'landscape' } });
      const fresh = { id: ev.id, hostKey: ev.hostKey, at: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(fresh));
      go(fresh);
    } catch (e) {
      $('#launchSay').className = 'err';
      $('#launchSay').textContent = `Can't reach VUEMesh (${e.message}). Trying again…`;
      setTimeout(start, 10000);
    }
  }
  if (new URLSearchParams(location.search).get('e')) $('#launching').remove();
  else start();
</script>
"""

src, dest = sys.argv[1], sys.argv[2]
soup = BeautifulSoup(open(src).read(), 'html.parser')
body = soup.body
absent = json.loads(body.get('data-absent', '{}'))
gone = 0
for el in body.select(HIDDEN):
    if el.decomposed or not el.parent:
        continue
    for node in [el, *el.find_all(True)]:
        if node.get('id'):
            absent[node['id']] = node.name
    el.replace_with(Comment(' (not on the kiosk screen) '))
    gone += 1
body['data-absent'] = json.dumps(absent, separators=(',', ':'))
body['class'] = (body.get('class') or []) + ['kiosk']
soup.title.string = 'VUEMesh kiosk'
soup.head.find('style').append(LAUNCH_CSS)
launch = BeautifulSoup('<div class="launching" id="launching" role="status"><div class="lmark"><i aria-hidden="true"></i>VUEMesh</div><p id="launchSay">Getting the show ready…</p></div>', 'html.parser')
body.insert(0, launch)
studio_script = body.find('script', src='/js/studio.js')
studio_script.insert_before(BeautifulSoup(LAUNCHER, 'html.parser'))
out = str(soup)
open(dest, 'w').write(out)
print(f'{dest}: {gone} parts a sign does not need taken out ({len(absent)} ids the code gets stand-ins for), {len(out):,} chars')
