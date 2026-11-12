# Late host (clips wait in the outbox, survive a reload), and a home page that asks for nothing
# but a name: no event type, no public listing, no location.
# Run: node dev/server.mjs &  then  python3 test/e2e_outbox.py
import os
import time
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:8790')
ARGS=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','--no-sandbox']
with sync_playwright() as p:
    import os; CH=os.environ.get('CHROME'); b=p.chromium.launch(executable_path=CH, args=ARGS) if CH else p.chromium.launch(args=ARGS)
    errs=[]
    land_ctx=b.new_context()
    land=land_ctx.new_page(); land.on('pageerror', lambda e: errs.append(str(e)))
    land.goto(BASE+'/')
    for gone in ['#kind', '#listPublic', '#find', '#globe']:
        assert land.locator(gone).count() == 0, gone + ' is back on the home page'
    land.fill('#title','Porch concert'); land.check('#agreeHost'); land.click('#create button[type=submit]')
    land.wait_for_selector('#made.show'); code=land.inner_text('#madeCode')
    studio_link=land.get_attribute('#studioLink','href')
    print('ok  created an event with just a name (no type, no listing, no location)', code)
    # phone shoots before the host is there
    cam=b.new_context(permissions=['camera','microphone']).new_page(); cam.on('pageerror', lambda e: errs.append(str(e)))
    cam.goto(f'{BASE}/cam?e={code}'); cam.fill('#name','Dev'); cam.check('#agreeGuest'); cam.click('#joinForm button[type=submit]')
    cam.wait_for_selector('#camView.on'); time.sleep(1)
    print('   phone says:', cam.inner_text('#upPill'))
    cam.click('#shutter'); time.sleep(2.5); cam.click('#shutter')
    cam.wait_for_function("document.querySelector('#upPill').textContent.includes('waiting')", timeout=10000)
    print('ok  clip queued in the outbox:', cam.inner_text('#upPill'))
    cam.reload(); cam.click('#joinForm button[type=submit]'); cam.wait_for_selector('#camView.on'); time.sleep(1)
    print('ok  after reload:', cam.inner_text('#upPill'))
    host=b.new_page(); host.on('pageerror', lambda e: errs.append(str(e)))
    host.goto(studio_link)
    cam.wait_for_function("[...document.querySelectorAll('.toast')].some(t=>t.textContent.includes('delivered'))", timeout=30000)
    print('ok  host arrived later and the queued clip was delivered')
    print('errors:', errs or 'none'); b.close()
