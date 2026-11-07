// Every page that talks to the cloud (vm.js's api or meshSocket, anywhere in its modules) must load
// /config.js first: it's what points the page at the AWS endpoints. Without it the page uses its own
// origin's /api and /ws, which only the dev server has, so it works locally and not on the real site
// (the share page did this: "Waiting for the studio" on vuemesh.com, fine on npm run dev).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', 'public');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));
const usesCloud = /import\s*\{[^}]*\b(api|meshSocket)\b[^}]*\}\s*from\s*['"]\/js\/vm\.js['"]/;

function reaches(src, seen = new Set()) {
  if (seen.has(src)) return false;
  seen.add(src);
  const file = join(root, src);
  if (!existsSync(file)) return false;
  const s = readFileSync(file, 'utf8');
  if (usesCloud.test(s)) return true;
  return [...s.matchAll(/(?:import|from)\s*\(?\s*['"](\/js\/[^'"]+\.js)['"]/g)].some((m) => reaches(m[1], seen));
}

const bad = [];
for (const page of pages) {
  const h = readFileSync(join(root, page), 'utf8');
  const mods = [...h.matchAll(/<script[^>]*type="module"[^>]*src="(\/js\/[^"]+)"/g)].map((m) => m[1]);
  if (!mods.some((m) => reaches(m))) continue;
  const cfg = h.indexOf('src="/config.js"');
  const first = h.indexOf(`src="${mods[0]}"`);
  if (cfg < 0 || cfg > first) bad.push(`${page}: talks to the cloud but doesn't load /config.js before its modules`);
}
// No password fields but the admin key: with one in a page, Chrome takes the text boxes around it
// for a login (offering saved passwords in them) and asks to save what's typed (the stream key did)
for (const page of pages) {
  if (page === 'admin.html') continue;
  if (/<input[^>]*type="password"/.test(readFileSync(join(root, page), 'utf8'))) bad.push(`${page}: has a password field (Chrome then offers to save it and fills the boxes around it)`);
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('ok  every page that talks to the cloud loads /config.js first; no password fields but the admin key');
