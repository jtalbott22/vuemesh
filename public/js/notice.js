// What this site keeps, said once per browser, in plain words. Not a cookie banner (there are no
// cookies to accept): a note that says exactly what this browser stores and what the server keeps,
// with a link to the whole list at /privacy (where it can all be cleared in one go).
// Shown on the pages people use; not on screens that go on air or hang on a wall (the program, a TV,
// the beacon, a kiosk, TV calibration), not on Admin, and not in automated browsers (the test suites).
// Dismissing it stores one key, vm_privacy_ok, so it doesn't come back.

const KEY = 'vm_privacy_ok';
const QUIET = /^\/(program|tv|beacon|kiosk|tvcal|admin|privacy)(\.html)?\/?$/;

const CSS = `
.vmnotice { position: fixed; z-index: 2147483000; left: max(12px, env(safe-area-inset-left, 0px)); bottom: max(12px, env(safe-area-inset-bottom, 0px));
  width: min(420px, calc(100vw - 24px)); box-sizing: border-box; padding: 16px 18px 14px; border-radius: 14px;
  background: var(--surface, #18191d); color: var(--text, #ececef); border: 1px solid var(--line, #2a2c32);
  box-shadow: 0 12px 40px #0008; font: 14px/1.45 var(--font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); }
.vmnotice h2 { margin: 0 0 6px; font-size: 15px; font-weight: 800; letter-spacing: 0; line-height: 1.25; }
.vmnotice p { margin: 0 0 8px; color: var(--text-2, #a9acb4); }
.vmnotice ul { margin: 0 0 10px; padding-left: 1.1em; color: var(--text-2, #a9acb4); }
.vmnotice li { margin: 2px 0; }
.vmnotice b { color: var(--text, #ececef); font-weight: 700; }
.vmnotice .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-top: 4px; }
.vmnotice a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.vmnotice button { font: inherit; font-weight: 700; min-height: 38px; padding: 0 18px; border-radius: 999px; border: 0; cursor: pointer;
  background: var(--text, #ececef); color: var(--bg, #0f1013); }
.vmnotice button:focus-visible, .vmnotice a:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media (max-width: 480px) { .vmnotice { font-size: 13px; } }
@media print { .vmnotice { display: none; } }
`;

function seen() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // (storage blocked: nothing is being kept, and there's nowhere to remember the answer)
  }
}

function show() {
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.append(s);
  const box = document.createElement('section');
  box.className = 'vmnotice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-labelledby', 'vmnoticeH');
  box.innerHTML = `<h2 id="vmnoticeH">What VUEMesh keeps</h2>
    <p><b>No cookies, no accounts, no ads, no trackers.</b> Nothing to accept.</p>
    <ul>
      <li><b>In this browser, on this device only:</b> your settings, the events you made or joined (and their keys), your name for joining, and your recordings and edits.</li>
      <li><b>On our server, for 30 days:</b> an event's code and settings, so devices can find each other. Not its name, which stays on your devices. Video goes device to device on your own network.</li>
      <li><b>Anonymous counts</b> of page views and events, with nothing that names you (none if your browser asks not to be tracked).</li>
    </ul>
    <div class="row"><a href="/privacy">Exactly what's stored, and clear it</a><button type="button">Got it</button></div>`;
  box.querySelector('button').addEventListener('click', () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    box.remove();
  });
  document.body.append(box);
}

if (typeof document !== 'undefined' && !QUIET.test(location.pathname) && !navigator.webdriver && !seen()) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
}
