// Which VUEMesh this is, on every page: a small "v0.66.19" that opens What's new at that version.
// A page puts <a data-vm-version></a> where it fits (beside the wordmark in a header, in a footer,
// under a join form) and loads this; the number comes from brand.js, the one place it's kept, so a
// page can't show an old one. Not on the program output or anything else that goes on air.
// data-vm-version="long" reads "VUEMesh 0.66.19" (where nothing beside it says VUEMesh).
import { APP_VERSION } from './brand.js';

/** The anchor What's new gives a version (changelog.js does the same). */
export const versionAnchor = (v = APP_VERSION) => 'v' + v.replace(/[^\w]+/g, '-');
export const versionHref = (v = APP_VERSION) => `/changelog#${versionAnchor(v)}`;

const CSS = `
.vmver { display: inline-flex; align-items: center; gap: .35em; font-family: inherit; font-size: 11px; font-weight: 600; line-height: 1.2;
  font-variant-numeric: tabular-nums; letter-spacing: .02em; color: inherit; opacity: .9; text-decoration: none;
  white-space: nowrap; vertical-align: middle; border-radius: 999px; padding: 3px 8px;
  border: 1px solid color-mix(in srgb, currentColor 28%, transparent); flex: none; }
.vmver:hover, .vmver:focus-visible { opacity: 1; border-color: color-mix(in srgb, currentColor 55%, transparent); }
.vmver:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.vmver.plain { border: 0; padding: 0; border-radius: 0; font-size: inherit; font-weight: inherit; }
.vmver.plain:hover { text-decoration: underline; text-underline-offset: 2px; }
.mark .vmver { font-stretch: normal; text-transform: none; margin-left: .35em; font-size: max(11px, .55em); }
.vmverline { margin: 14px 0 0; text-align: center; font-size: 12px; }
.vmbrand { display: inline-flex; align-items: center; gap: .6rem; flex: none; min-width: 0; }
`;

/** Fills one element (an <a>) with the version and its link. */
export function fillVersion(a) {
  const long = a.dataset.vmVersion === 'long';
  a.textContent = long ? `VUEMesh ${APP_VERSION}` : `v${APP_VERSION}`;
  if (a.tagName === 'A') {
    a.href = versionHref();
    a.title = `What's new in VUEMesh ${APP_VERSION}`;
    if (!long) a.setAttribute('aria-label', `VUEMesh version ${APP_VERSION}: what's new`);
  }
  a.classList.add('vmver');
  a.hidden = false;
}

/** Fills every placeholder on the page (and any added later by calling it again). */
export function fillVersions(root = document) {
  if (!document.getElementById('vmverCss')) {
    const s = document.createElement('style');
    s.id = 'vmverCss';
    s.textContent = CSS;
    document.head.prepend(s); // (first, so a page's own .vmver rules win)
  }
  for (const a of root.querySelectorAll('[data-vm-version]')) fillVersion(a);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fillVersions());
  else fillVersions();
  // (every page loads this, so the once-per-browser note on what's stored rides along: see notice.js)
  import('./notice.js').catch(() => {});
}
