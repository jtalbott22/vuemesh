# Renders dev/og/og.html to public/og.png (1200 × 630), the picture links show when shared.
# python3 dev/og/render.py   (needs Playwright's Chromium)
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).resolve().parent
out = here.parent.parent / 'public' / 'og.png'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1200, 'height': 630})
    pg.goto((here / 'og.html').as_uri())
    pg.evaluate('document.fonts.ready')
    pg.wait_for_timeout(300)
    pg.screenshot(path=str(out))
    b.close()
print(out)
