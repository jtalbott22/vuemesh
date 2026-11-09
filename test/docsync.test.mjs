// The changelog, the site and the README say the same thing:
// - the version in package.json, the app's APP_VERSION (shown on What's new and in diagnostics) and
//   the newest heading in CHANGELOG.md are one version;
// - every version of CHANGELOG.md renders on the site's What's new (/changelog, which reads the file
//   itself) without raw ** or backticks showing;
// - every file and picture the README links to is in the repository;
// - every page shows which version it is (linked to What's new), but the program output, which goes on air.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangelog } from '../public/js/changelog.js';
import { versionAnchor } from '../public/js/version.js';

const repo = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(repo, p), 'utf8');
const bad = [];

const pkg = JSON.parse(read('package.json')).version;
const app = read('public/js/brand.js').match(/APP_VERSION = '([^']+)'/)?.[1];
const md = read('CHANGELOG.md');
const top = md.match(/^## (\S+)/m)?.[1];
if (!(pkg === app && app === top)) bad.push(`versions differ: package.json ${pkg}, APP_VERSION ${app}, CHANGELOG.md's newest ${top}`);

const versions = parseChangelog(md);
if (versions[0]?.version !== top) bad.push(`What's new reads ${versions[0]?.version} as the newest, not ${top}`);
for (const v of versions) {
  const text = (v.title + ' ' + v.html).replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, '');
  // (a lone ` is the key itself, as in "the ` key"; two or more are code that didn't render)
  if (/\*\*/.test(text) || (text.match(/`/g) || []).length > 1) bad.push(`${v.version} shows raw markdown on What's new: …${text.match(/.{0,40}(\*\*|`).{0,40}/)[0]}…`);
}

const readme = read('README.md');
const refs = [...readme.matchAll(/(?:\]\(|src="|href=")([^)"#\s]+)/g)].map((m) => m[1]).filter((u) => !/^(https?:|mailto:)/.test(u));
for (const r of new Set(refs)) if (!existsSync(join(repo, r))) bad.push(`README links to ${r}, which isn't in the repository`);

// (the studio, Edit and the kiosk show it in Help, beside its title: helpDialog in vm.js; their bars have no room)
const NO_VERSION = ['program.html'], IN_HELP = ['studio.html', 'edit.html', 'kiosk.html'];
const pages = readdirSync(join(repo, 'public')).filter((f) => f.endsWith('.html'));
for (const f of pages) {
  if (NO_VERSION.includes(f) || IN_HELP.includes(f)) continue;
  const html = read(join('public', f));
  if (!/data-vm-version/.test(html)) bad.push(`${f} doesn't show the version (a <a data-vm-version> where it fits)`);
  else if (!/src="\/js\/version\.js"/.test(html)) bad.push(`${f} has a place for the version but doesn't load /js/version.js`);
}
if (!/fillVersions\(d\)/.test(read('public/js/vm.js'))) bad.push("Help (vm.js's helpDialog) no longer shows the version");
for (const f of NO_VERSION) if (/data-vm-version|version\.js/.test(read(join('public', f)))) bad.push(`${f} goes on air: no version on it`);
if (!versions.some((v) => 'v' + v.version.replace(/[^\w]+/g, '-') === versionAnchor(app))) bad.push(`the version's link (#${versionAnchor(app)}) isn't an anchor on What's new`);

if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`ok  one version everywhere (${top}); ${versions.length} versions render on What's new; the README's ${new Set(refs).size} local links all exist; ${pages.length - NO_VERSION.length} pages show the version`);
