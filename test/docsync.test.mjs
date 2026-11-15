// The changelog, the site and the README say the same thing:
// - the version in package.json, the app's APP_VERSION (shown on What's new and in diagnostics) and
//   the newest heading in CHANGELOG.md are one version;
// - every version of CHANGELOG.md renders on the site's What's new (/changelog, which reads the file
//   itself) without raw ** or backticks showing;
// - every file and picture the README links to is in the repository;
// - every page shows which version it is (linked to What's new), but the program output, which goes on air;
// - the home page's FAQ and its search-engine copy match; what people and AI tools read (home, Compare,
//   Privacy, the first-visit note, /llms.txt, the README) agrees with the code (a call's size, how long
//   events are kept, when a show pauses and asks) and with itself (no third-party trackers, capacity
//   with what it depends on, every app Compare names in /llms.txt, "distributed live production").
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

// The home page's questions say the same thing to people and to search engines: each visible
// question and answer (tags taken off) is word for word the FAQPage data in its head.
const home = read('public/index.html');
const words = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const shown = [...home.matchAll(/<details[^>]*><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [words(m[1]), words(m[2])]);
const ldm = home.match(/<script type="application\/ld\+json" id="faqld">([\s\S]*?)<\/script>/);
const given = ldm ? JSON.parse(ldm[1]).mainEntity.map((q) => [q.name, q.acceptedAnswer.text]) : [];
if (!shown.length) bad.push("the home page has no questions (its FAQ's <details>)");
else if (JSON.stringify(shown) !== JSON.stringify(given)) bad.push("the home page's FAQ and its FAQPage data (#faqld) don't say the same thing: change both");
for (const f of ['compare.html', 'tour.html']) if (!read('public/sitemap.xml').includes(`/${f.replace('.html', '')}<`)) bad.push(`${f} isn't in the sitemap`);

// What people and AI systems read about VUEMesh (the home page and its FAQ, Compare, Privacy, the
// first-visit note, /llms.txt and the README) agrees with itself and with the code, so a release
// can't leave one saying something another (or the software) no longer does.
const facing = { 'public/index.html': home, 'public/compare.html': read('public/compare.html'), 'public/privacy.html': read('public/privacy.html'),
  'public/js/notice.js': read('public/js/notice.js'), 'public/llms.txt': read('public/llms.txt'), 'README.md': read('README.md') };
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
const coreSrc = read('aws/functions/lib/core.mjs'), guardSrc = read('public/js/studio/guard.js');
const num = (src, re, what) => { const m = src.match(re); if (!m) bad.push(`can't find ${what} in the code`); return m ? Number(m[1]) : NaN; };
const callMax = num(coreSrc, /CALL = \{ maxIn: (\d+)/, "a call's size (CALL.maxIn)");
const ttlDays = num(coreSrc, /EVENT_TTL_DAYS = (\d+)/, 'how long an event is kept (EVENT_TTL_DAYS)');
const idleMin = num(guardSrc, /idleMs: (\d+) \* 60_000/, "the studio's pause (GUARD.idleMs)");
const askHours = num(guardSrc, /confirmMs: (\d+) \* 3600_000/, '"Still running?" (GUARD.confirmMs)');
for (const [f, src] of Object.entries(facing)) {
  const t = text(src);
  // "No trackers" beside our own anonymous counts reads as a contradiction: say third-party
  for (const m of t.matchAll(/.{0,40}\b(?:no|or) trackers\b.{0,40}/gi)) if (!/"no trackers" means/.test(m[0])) bad.push(`${f} says "${m[0].trim()}": say no third-party trackers (VUEMesh counts its own use, anonymously)`);
  // a call's size, as the server has it
  for (const m of t.matchAll(/\bcalls? (?:of )?\(?up to (\d+)/gi)) if (Number(m[1]) !== callMax) bad.push(`${f} says calls of up to ${m[1]}; the server lets ${callMax} in`);
  // how many live pictures: always with what it depends on
  for (const m of t.matchAll(/.{0,160}\b12 live pictures\b.{0,160}/gi)) if (!/typical|depend|fewer|more or fewer/i.test(m[0])) bad.push(`${f} gives 12 live pictures without saying it depends on the computer, picture size and network`);
}
const llms = text(facing['public/llms.txt']), privacy = text(facing['public/privacy.html']);
if (!llms.includes(`after ${ttlDays} days`) || !privacy.includes(`${ttlDays} days`)) bad.push(`/llms.txt and Privacy should both say event data goes after ${ttlDays} days (EVENT_TTL_DAYS)`);
if (!privacy.includes(`${idleMin} minutes`) || !privacy.includes(`Every ${askHours} hours`)) bad.push(`Privacy's "shows end" should say ${idleMin} minutes and every ${askHours} hours, as the studio does (guard.js)`);
// every app Compare names is in /llms.txt too, so AI tools hear the same comparison
const cmp = facing['public/compare.html'];
const named = [...new Set([...[...cmp.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]), ...[...cmp.matchAll(/<li><b><a href="[^"]+">([^<]+)<\/a><\/b>/g)].map((m) => m[1])])].filter((n) => n !== 'VUEMesh');
if (named.length < 4) bad.push(`Compare names only ${named.length} other apps: has its markup changed?`);
for (const n of named) if (!llms.includes(n)) bad.push(`Compare names ${n} but /llms.txt doesn't`);
// the tour: every screen has its picture and is on the shot list, and every picture is on the tour
const tourShots = [...read('public/tour.html').matchAll(/data-shot="([a-z]+)"/g)].map((m) => m[1]);
const pictures = readdirSync(join(repo, 'public/media/screens')).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', ''));
const shotList = read('docs/SCREENSHOTS.md');
for (const n of tourShots) {
  if (!pictures.includes(n)) bad.push(`the tour shows ${n} but public/media/screens/${n}.webp isn't there`);
  if (!shotList.includes(`\`${n}.webp\``)) bad.push(`the tour shows ${n} but docs/SCREENSHOTS.md's shot list doesn't`);
}
for (const n of pictures) if (!tourShots.includes(n)) bad.push(`public/media/screens/${n}.webp isn't on the tour`);
// the phrase it's known by, in each place it's described
for (const f of ['public/index.html', 'public/compare.html', 'public/llms.txt', 'README.md']) if (!/distributed live production/i.test(facing[f])) bad.push(`${f} no longer calls VUEMesh distributed live production`);

if (bad.length) {
  console.error(bad.join('\n'));
  process.exit(1);
}
console.log(`ok  one version everywhere (${top}); ${versions.length} versions render on What's new; the README's ${new Set(refs).size} local links all exist; ${pages.length - NO_VERSION.length} pages show the version`);
