# Shared by the end-to-end tests.
import time


def edit_window(ctx, host, errors=None, timeout=180000):
    """Edit is its own window: open it from the studio's Edit button (or bring it forward if it's
    open), and return its page once it's editing."""
    for pg in ctx.pages:
        if not pg.is_closed() and '/edit' in pg.url:
            host.evaluate("document.querySelector('#editTab').click()")
            time.sleep(0.5)
            return pg
    with ctx.expect_page(timeout=timeout) as pop:
        host.evaluate("document.querySelector('#editTab').click()")
    ed = pop.value
    if errors is not None:
        ed.on('pageerror', lambda e: errors.append(f'edit: {e}'))
    ed.on('dialog', lambda d: d.accept())
    ed.wait_for_function("document.body && document.body.dataset.mode === 'edit' && typeof window.vmProgram === 'function'", timeout=timeout)
    return ed


def wait_or_show(page, selector, timeout, what):
    """wait_for_selector, and if it doesn't come, raise with what the page is showing instead."""
    try:
        page.wait_for_selector(selector, timeout=timeout)
    except Exception:
        shown = page.evaluate("""() => {
          const vis = (el) => el && el.offsetParent !== null;
          const views = [...document.querySelectorAll('[id$="View"], .camback, .toast, dialog[open], [role=alertdialog]')].filter(vis).map((e) => (e.id || e.className) + ': ' + e.innerText.replace(/\\s+/g, ' ').slice(0, 160));
          return { url: location.href, views };
        }""")
        raise AssertionError(f'{what}: {selector} never showed. The page was showing: {shown}')
