// Every name a page imports from one of the site's own modules must be exported by it. (A broken
// export stops the whole page from loading, and only a browser would notice: this catches it in a second.)
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = join(import.meta.dirname, '..', 'public');
const js = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f));
const html = readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => join(root, f));
const exportsOf = new Map();
for (const f of js) {
  const s = readFileSync(f, 'utf8');
  const names = new Set([...s.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) for (const x of m[1].split(',')) if (x.trim()) names.add(x.split(/\s+as\s+/).pop().trim());
  exportsOf.set(basename(f), names);
}
const bad = [];
for (const f of [...js, ...html]) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:\/js\/|\.\/)([\w.-]+\.js)['"]/g)) {
    const mod = m[2];
    if (!exportsOf.has(mod)) continue;
    for (const x of m[1].split(',')) {
      const n = x.split(/\s+as\s+/)[0].trim();
      if (n && !exportsOf.get(mod).has(n)) bad.push(`${basename(f)} imports ${n} from ${mod}, which doesn't export it`);
    }
  }
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`ok  every import across ${js.length + html.length} files is exported by its module`);
