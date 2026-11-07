// What's new: the project's CHANGELOG.md, shown on the site. The deploy copies it next to the
// pages as /changelog.md (the dev server serves it from the repository), so this page is always
// the changelog itself. It's read as text and only what it uses is turned into HTML: version
// headings, paragraphs, bullets one level deep, **bold** and `code`; everything else is escaped.
// The **Deploy:** lines are notes for whoever deploys it, and aren't shown.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// (`code` is set aside first, so a ** inside code stays as written; then **bold**, which may have
// code inside it, as in **The receiver (`tools/whip_receiver.py`) no longer…**; then the code)
const inline = (s) => {
  const code = [];
  return esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `\uE000${code.push(c) - 1}\uE000`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\uE000(\d+)\uE000/g, (_, i) => `<code>${code[i]}</code>`);
};

/** One version's lines as HTML. */
function body(lines) {
  let html = '', para = [], list = null, sub = null, li = null, gap = false; // (gap: a blank line since the last bullet)
  const flushPara = () => {
    if (!para.length) return;
    const p = `<p>${inline(para.join(' '))}</p>`;
    if (li) li.extra += p; // (an indented paragraph under a bullet belongs to it)
    else html += p;
    para = [];
  };
  const closeSub = () => {
    if (sub) li.sub = sub;
    sub = null;
  };
  const closeList = () => {
    closeSub();
    if (list) html += `<ul>${list.map((x) => `<li>${inline(x.text)}${x.sub ? `<ul>${x.sub.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>` : ''}${x.extra}</li>`).join('')}</ul>`;
    list = null;
    li = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^\*\*Deploy:\*\*/.test(line)) continue;
    if (!line.trim()) {
      flushPara();
      gap = true;
      continue;
    }
    const top = /^- (.*)$/.exec(line), nested = /^ {2,}- (.*)$/.exec(line);
    if (top) {
      flushPara();
      closeSub();
      if (!list) list = [];
      li = { text: top[1], sub: null, extra: '' };
      list.push(li);
      gap = false;
    } else if (nested && li) {
      flushPara();
      (sub ||= []).push(nested[1]);
      gap = false;
    } else if (/^ {2,}\S/.test(line) && li) {
      // (after a blank line: a paragraph under the bullet; otherwise more of the line above)
      if (gap || para.length) para.push(line.trim());
      else if (sub) sub[sub.length - 1] += ' ' + line.trim();
      else li.text += ' ' + line.trim();
    } else {
      if (list) {
        flushPara();
        closeList();
      }
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return html;
}

/** The changelog's versions: [{ version, title, html }], newest first (as written). */
export function parseChangelog(md) {
  const out = [];
  const parts = md.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split('\n');
    const m = /^(\S+)\s+[—-]\s+(.*)$/.exec(head.trim());
    out.push({ version: m ? m[1] : head.trim(), title: m ? m[2] : '', html: body(rest) });
  }
  return out;
}

/** Fill `box` with the changelog: the newest `open` versions shown, the older ones folded. */
export async function renderChangelog(box, open = 3) {
  let md;
  try {
    const r = await fetch('/changelog.md', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    md = await r.text();
  } catch {
    box.innerHTML = '<p>The list of changes couldn’t be loaded. Try again in a moment.</p>';
    return [];
  }
  const versions = parseChangelog(md);
  const id = (v) => 'v' + v.replace(/[^\w]+/g, '-');
  box.innerHTML = versions.map((v, i) => {
    const head = `<span class="ver">${esc(v.version)}</span>${v.title ? ` <span class="vt">${inline(v.title)}</span>` : ''}`;
    return i < open
      ? `<section class="rel" id="${id(v.version)}"><h2>${head}</h2>${v.html}</section>`
      : `<details class="rel" id="${id(v.version)}"><summary><h2>${head}</h2></summary>${v.html}</details>`;
  }).join('');
  // a link to one version opens it
  const want = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  if (want?.tagName === 'DETAILS') want.open = true;
  want?.scrollIntoView();
  return versions;
}
