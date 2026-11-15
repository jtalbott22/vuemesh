# Renders dev/og/og.html to the picture links show when shared (1200 × 630): public/card.png, which the
# pages name, and public/og.png, the same picture for links shared before (and the README).
# A new look needs a new name for card.png too: sites keep a shared picture by its address.
# python3 dev/og/render.py   (needs Playwright's Chromium)
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).resolve().parent
public = here.parent.parent / 'public'
out = public / 'card.png'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    pg.goto((here / 'og.html').as_uri())
    pg.evaluate('document.fonts.ready')
    pg.wait_for_function('[...document.images].every((i) => i.complete && i.naturalWidth > 0)')
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(out))
    b.close()
shutil.copyfile(out, public / 'og.png')
print(out, public / 'og.png')
