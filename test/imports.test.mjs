// Every name a page imports from one of the site's own modules must be exported by it. (A broken
// export stops the whole page from loading, and only a browser would notice: this catches it in a second.)
// Covers public/js and its folders (the studio's parts are in public/js/studio/), and the pages.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';

const root = join(import.meta.dirname, '..', 'public');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const js = walk(join(root, 'js'));
const html = readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => join(root, f));

// names in `export let a, b;` or `export const a = f(x, y), b = [];`: the first name, and any more
// after a comma outside brackets on the same line (later lines are the values, not more names)
function declaredNames(s, at) {
  const line = s.slice(at, (s.indexOf('\n', at) + 1 || s.length + 1) - 1);
  const names = [/^[A-Za-z_$][\w$]*/.exec(line)?.[0]];
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      const m = /^\s*([A-Za-z_$][\w$]*)\s*(?:=|,|;|$)/.exec(line.slice(i + 1));
      if (m) names.push(m[1]);
    }
  }
  return names.filter(Boolean);
}
const exportsOf = new Map();
for (const f of js) {
  const s = readFileSync(f, 'utf8');
  const names = new Set([...s.matchAll(/export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of s.matchAll(/export\s+(?:const|let|var)\s+/g)) for (const n of declaredNames(s, m.index + m[0].length)) names.add(n);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) for (const x of m[1].split(',')) if (x.trim()) names.add(x.split(/\s+as\s+/).pop().trim());
  exportsOf.set(f, names);
}
const bad = [];
for (const f of [...js, ...html]) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]((?:\/js\/|\.\.?\/)[\w./-]+\.js)['"]/g)) {
    const mod = m[2].startsWith('/') ? join(root, m[2]) : resolve(dirname(f), m[2]);
    const name = relative(root, f);
    if (!exportsOf.has(mod)) { bad.push(`${name} imports from ${m[2]}, which isn't there`); continue; }
    for (const x of m[1].split(',')) {
      const n = x.split(/\s+as\s+/)[0].trim();
      if (n && !exportsOf.get(mod).has(n)) bad.push(`${name} imports ${n} from ${m[2]}, which doesn't export it`);
    }
  }
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`ok  every import across ${js.length + html.length} files is exported by its module`);
