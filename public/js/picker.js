// A drop-down menu drawn in the page, standing in for a <select>. The select stays (hidden) as the
// source of truth: its options (and option groups), its value and its change event, so code that
// reads or listens to it doesn't change. Why: a native select's pop-up belongs to the browser and
// the desktop, and on some (Chrome on Linux) it closes as the mouse button comes up, so picking
// meant holding the button down and dragging. This one is part of the page.
//
// Keyboard: on the button, ↓ ↑ Enter or Space opens it; in the list, ↓ ↑ Home End move, a letter
// jumps to the next item starting with it, Enter or Space picks, Escape closes.

let n = 0;
export function picker(sel) {
  if (sel._picker) return sel._picker;
  const id = `pk${++n}`;
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker-btn';
  btn.id = `${id}-btn`;
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', `${id}-list`);
  const list = document.createElement('ul');
  list.className = 'picker-list';
  list.id = `${id}-list`;
  list.setAttribute('role', 'listbox');
  list.tabIndex = -1;
  list.popover = 'manual'; // (in the top layer: not cut off by a card that hides its overflow)
  const outer = sel.id ? document.querySelector(`label[for="${sel.id}"]`) : null;
  const name = sel.getAttribute('aria-label') || outer?.textContent.trim() || '';
  if (outer) outer.htmlFor = btn.id;
  list.setAttribute('aria-label', name);
  sel.after(wrap);
  wrap.append(btn, list);
  sel.hidden = true;
  sel.tabIndex = -1;

  let items = [], active = -1;
  const isOpen = () => list.matches(':popover-open');
  function build() {
    list.replaceChildren();
    items = [];
    const add = (opt) => {
      const li = document.createElement('li');
      const i = items.length;
      li.id = `${id}-o${i}`;
      li.setAttribute('role', 'option');
      li.textContent = opt.textContent;
      li.addEventListener('click', () => choose(i));
      li.addEventListener('pointermove', () => setActive(i, false));
      items.push({ li, opt });
      return li;
    };
    for (const child of sel.children) {
      if (child.tagName === 'OPTGROUP') {
        const g = document.createElement('li');
        g.setAttribute('role', 'presentation');
        g.className = 'picker-group';
        g.textContent = child.label;
        list.append(g, ...[...child.children].map(add));
      } else list.append(add(child));
    }
    sync();
  }
  function sync() {
    const cur = sel.selectedOptions[0];
    btn.textContent = cur?.textContent || '';
    btn.setAttribute('aria-label', `${name}${name ? ': ' : ''}${cur?.textContent || ''}`);
    for (const it of items) it.li.setAttribute('aria-selected', String(it.opt === cur));
  }
  function setActive(i, scroll = true) {
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((it, k) => it.li.classList.toggle('active', k === active));
    list.setAttribute('aria-activedescendant', items[active].li.id);
    if (scroll) items[active].li.scrollIntoView({ block: 'nearest' });
  }
  function place() {
    const r = btn.getBoundingClientRect(), vh = innerHeight, vw = document.documentElement.clientWidth;
    list.style.minWidth = `${Math.round(r.width)}px`;
    const h = Math.min(list.scrollHeight, 380), below = vh - r.bottom - 8, above = r.top - 8;
    const up = below < Math.min(h, 220) && above > below;
    list.style.maxHeight = `${Math.max(120, Math.min(380, up ? above : below))}px`;
    list.style.top = up ? 'auto' : `${Math.round(r.bottom + 4)}px`;
    list.style.bottom = up ? `${Math.round(vh - r.top + 4)}px` : 'auto';
    const w = list.offsetWidth;
    list.style.left = `${Math.round(Math.max(8, Math.min(r.left, vw - w - 8)))}px`;
  }
  function open() {
    if (isOpen()) return;
    list.showPopover();
    place();
    btn.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, items.findIndex((it) => it.opt.selected)));
    list.focus({ preventScroll: true });
    addEventListener('pointerdown', outside, true);
    addEventListener('resize', closeQuiet);
    addEventListener('scroll', onScroll, true);
  }
  function close(focusBtn = true) {
    if (!isOpen()) return;
    list.hidePopover();
    btn.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', closeQuiet);
    removeEventListener('scroll', onScroll, true);
    if (focusBtn) btn.focus({ preventScroll: true });
  }
  const closeQuiet = () => close(false);
  const onScroll = (e) => { if (e.target !== list && !list.contains(e.target)) close(false); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
  function choose(i) {
    const it = items[i];
    if (!it) return;
    const changed = sel.value !== it.opt.value;
    sel.value = it.opt.value;
    sync();
    close();
    if (changed) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); return close(); }
    if (k === 'Tab') return close(false);
    if (k === 'ArrowDown') { e.preventDefault(); return setActive(active + 1); }
    if (k === 'ArrowUp') { e.preventDefault(); return setActive(active - 1); }
    if (k === 'Home') { e.preventDefault(); return setActive(0); }
    if (k === 'End') { e.preventDefault(); return setActive(items.length - 1); }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); return choose(active); }
    if (k.length === 1 && /\S/.test(k)) {
      const c = k.toLowerCase();
      for (let s = 1; s <= items.length; s++) {
        const j = (active + s) % items.length;
        if (items[j].li.textContent.trim().toLowerCase().startsWith(c)) return setActive(j);
      }
    }
  });
  new MutationObserver(build).observe(sel, { childList: true, subtree: true });
  build();
  sel._picker = { sync, open, close, button: btn };
  return sel._picker;
}
