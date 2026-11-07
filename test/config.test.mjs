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
// The Edit window and the kiosk run the studio's code on pages without all of its controls; each
// lists the ones it lacks (<body data-absent>) and gets a stand-in for them. A control the studio
// wires up as it loads (a line starting $('#id').…) that's neither on the page nor in that list
// stops the page loading (0.61.12's message box did this to Edit, and to the kiosk).
{
  const ids = (h) => new Set([...h.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const studio = ids(readFileSync(join(root, 'studio.html'), 'utf8'));
  const dir = join(root, 'js', 'studio');
  const top = new Set(readdirSync(dir).filter((f) => f.endsWith('.js')).flatMap((f) => [...readFileSync(join(dir, f), 'utf8').matchAll(/^\$\('#([\w-]+)'\)\.(?!\?)/gm)].map((m) => m[1])));
  for (const page of ['edit.html', 'kiosk.html']) {
    const h = readFileSync(join(root, page), 'utf8');
    const have = ids(h), absent = JSON.parse(/data-absent='(\{.*?\})'/.exec(h)?.[1] || '{}');
    const missing = [...top].filter((id) => studio.has(id) && !have.has(id) && !(id in absent));
    if (missing.length) bad.push(`${page}: the studio wires up ${missing.map((m) => '#' + m).join(', ')} as it loads, and they're neither on the page nor in its data-absent list`);
  }
}
if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log('ok  every page that talks to the cloud loads /config.js first; no password fields but the admin key; Edit and the kiosk have (or stand in for) every control the studio wires up as it loads');
