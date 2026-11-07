// The changelog, the site and the README say the same thing:
// - the version in package.json, the app's APP_VERSION (shown on What's new and in diagnostics) and
//   the newest heading in CHANGELOG.md are one version;
// - every version of CHANGELOG.md renders on the site's What's new (/changelog, which reads the file
//   itself) without raw ** or backticks showing;
// - every file and picture the README links to is in the repository.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseChangelog } from '../public/js/changelog.js';

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

if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`ok  one version everywhere (${top}); ${versions.length} versions render on What's new; the README's ${new Set(refs).size} local links all exist`);
