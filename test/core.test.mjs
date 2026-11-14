// Unit tests for the cloud core (the same code the Lambdas run), using the in-memory store.
import assert from 'node:assert/strict';
import { api, signal, iceServers, TURN_LIMITS, CALL, relaySig, RELAY_LOG_MAX_HOURS } from '../aws/functions/lib/core.mjs';
import { guard } from '../aws/functions/lib/relay-guard.mjs';
import { memoryStore } from '../aws/functions/lib/store-memory.mjs';
import { geohash, nearbyCells } from '../aws/functions/lib/common.mjs';

const store = memoryStore();
let clock = Date.now();
import { createHash, createHmac } from 'node:crypto';
const ADMIN_KEY = 'test-admin-key';
const films = new Map([['films/ZZZZZZ/old.mp4', 5]]);
const deps = {
  store, cdn: 'https://cdn.example', presign: async (k, t) => `https://s3.example/${k}?type=${t}`, now: () => clock,
  flags: { globe: true, publish: true },
  adminKeyHashes: [createHash('sha256').update(ADMIN_KEY).digest('hex')],
  listFilms: async (prefix) => [...films].filter(([k]) => k.startsWith(prefix)).map(([key, size]) => ({ key, size })),
  deleteFilms: async (prefix) => { let n = 0; for (const k of [...films.keys()]) if (k.startsWith(prefix)) { films.delete(k); n++; } return n; },
};
const call = (method, path, body, headers = {}, query = {}) => api({ method, path, body, headers, query }, deps);
const ok = (name) => console.log('ok  ' + name);

// geohash sanity: Akron vs Cuyahoga Falls share nearby cells
assert.equal(geohash(41.08, -81.52, 4), geohash(41.13, -81.48, 4));
assert.equal(nearbyCells(41.08, -81.52).length, 9);
ok('geohash neighbourhood');

// create + get
const a = await call('POST', '/events', { title: 'Garage show', kind: 'show', poolPct: 20, public: true, lat: 41.0814, lon: -81.519 });
assert.equal(a.status, 200);
const { id, hostKey } = a.body;
const got = await call('GET', `/events/${id}`);
assert.equal(got.body.kind, 'show');
assert.ok(!('title' in got.body) && !('title' in (await store.getEvent(id))), "a show's name sent with an event is never kept (names stay on the devices)");
assert.ok(!got.body.terms.includes('Garage show') && got.body.terms.includes('this show'), 'nor is it in the terms');
assert.ok(!('lat' in got.body) && !('lon' in got.body), 'a location sent with an event is never kept');
assert.ok(!('hostKeyHash' in got.body) && !('gh' in got.body), 'secrets hidden');
ok('create and read an event');

await call('POST', '/events', { title: 'Private wedding', public: false, lat: 41.08, lon: -81.52 });
const p1 = await call('POST', '/events', { title: 'Vertical set', public: true, orientation: 'portrait', lat: 40.0, lon: -83.0 });
const p1Host = { 'x-host-key': p1.body.hostKey };
assert.equal((await call('GET', `/events/${p1.body.id}`)).body.orientation, 'portrait');
assert.ok(!('lat' in (await call('PATCH', `/events/${p1.body.id}`, { lat: 40.1, lon: -83.1 }, p1Host)).body), 'nor one sent later');
for (const r of [await call('GET', '/events/near', null, {}, { lat: '41.13', lon: '-81.48' }), await call('GET', '/events/public')]) {
  assert.ok(r.status >= 400 && !r.body?.events, 'no "near me", and no public list or map');
}
ok('no location is kept or asked for; orientation');

// host-only routes
assert.equal((await call('POST', `/events/${id}/publish`, { ext: 'mp4' })).status, 403);
const pub = await call('POST', `/events/${id}/publish`, { ext: 'mp4' }, { 'x-host-key': hostKey });
assert.match(pub.body.film.put, /films\/.+\.mp4\?type=video\/mp4/);
const bad = await call('POST', `/events/${id}/published`, { filmUrl: 'https://evil.example/x.mp4', manifestUrl: 'x' }, { 'x-host-key': hostKey });
assert.equal(bad.status, 400);
const done = await call('POST', `/events/${id}/published`, { filmUrl: pub.body.film.url, manifestUrl: pub.body.manifest.url }, { 'x-host-key': hostKey });
assert.equal(done.body.published.filmUrl, pub.body.film.url);
ok('publishing is host-only and pinned to our CDN');
deps.flags.publish = false;
assert.equal((await call('POST', `/events/${id}/publish`, { ext: 'mp4' }, { 'x-host-key': hostKey })).status, 403, 'publishing off = refused at the server');
deps.flags.publish = true;
ok('publishing obeys the server flag');

// signaling
const outbox = new Map();
const open = new Set();
const post = async (conn, data) => {
  if (!open.has(conn)) return false;
  (outbox.get(conn) || outbox.set(conn, []).get(conn)).push(data);
  return true;
};
const sig = (route, connectionId, extra = {}) => signal({ route, connectionId, ...extra }, { store, post, now: () => clock });
const connect = async (conn, query) => {
  const r = await sig('$connect', conn, { query });
  if (r.status === 200) open.add(conn);
  return r;
};
const last = (conn, type) => (outbox.get(conn) || []).filter((m) => m.type === type).at(-1);

assert.equal((await connect('h1', { e: id, role: 'host', peer: 'HOST', k: 'wrong' })).status, 403, 'host needs the key');
assert.equal((await connect('x1', { e: 'ZZZZZZ', role: 'cam', peer: 'P' })).status, 404);
await connect('h1', { e: id, role: 'host', peer: 'HOST', k: hostKey });
await connect('c1', { e: id, role: 'cam', peer: 'CAM1', name: 'Rosa', cid: 'abc' });
await connect('c2', { e: id, role: 'cam', peer: 'CAM2', name: 'Dev', cid: 'def' });
await connect('m1', { e: id, role: 'mic', peer: 'MIC1', name: 'Table mic', cid: 'mmm' });
await sig('$default', 'm1', { body: JSON.stringify({ action: 'signal', to: 'HOST', data: { kind: 'offer' } }) });
assert.equal(last('h1', 'signal').fromRole, 'mic', 'a microphone phone can reach the host');
await sig('$disconnect', 'm1');
assert.equal(last('h1', 'peers').peers.length, 3, 'host sees everyone');
await sig('$default', 'c1', { body: JSON.stringify({ action: 'hello' }) });
assert.equal(last('c1', 'peers').you, 'CAM1');
assert.equal(last('c1', 'peers').pong, true, 'the first list says this server answers a ping');
await sig('$default', 'h1', { body: JSON.stringify({ action: 'ping' }) });
assert.ok(last('h1', 'pong'), 'a ping is answered, so a studio can tell a connection that has quietly died');
ok('connect, host key check, presence, pings answered');

await sig('$default', 'c1', { body: JSON.stringify({ action: 'signal', to: 'HOST', data: { kind: 'offer', sdp: 'x' } }) });
assert.deepEqual(last('h1', 'signal'), { type: 'signal', from: 'CAM1', fromRole: 'cam', data: { kind: 'offer', sdp: 'x' } });
await sig('$default', 'h1', { body: JSON.stringify({ action: 'signal', to: 'CAM1', data: { kind: 'answer' } }) });
assert.equal(last('c1', 'signal').data.kind, 'answer');
await sig('$default', 'c1', { body: JSON.stringify({ action: 'signal', to: 'CAM2', data: { kind: 'offer' } }) });
assert.equal(last('c2', 'signal'), undefined, 'guests cannot message each other');
ok('offers and answers relay only through the host');

const before = (outbox.get('c1') || []).length;
await sig('$default', 'c2', { body: JSON.stringify({ action: 'status', rec: true }) });
assert.equal(last('h1', 'peers').peers.find((p) => p.peer === 'CAM2').rec, true);
assert.equal((outbox.get('c1') || []).length, before, 'other phones are not messaged when a phone starts recording');
open.delete('c2'); // phone vanished without closing
clock += 12 * 60 * 1000; // 12 quiet minutes: c2 never pings again
await sig('$default', 'h1', { body: JSON.stringify({ action: 'ping' }) });
await sig('$default', 'c1', { body: JSON.stringify({ action: 'ping' }) });
await sig('$default', 'c1', { body: JSON.stringify({ action: 'status', rec: false }) });
assert.deepEqual(last('h1', 'peers').peers.map((p) => p.peer).sort(), ['CAM1', 'HOST'], 'a ghost phone drops out of the list after 11 quiet minutes');
await sig('$disconnect', 'c1');
assert.equal(last('h1', 'peers').peers.length, 1);
ok('recording status, pruning, disconnect');

// a phone learns when the host arrives and leaves
await connect('c3', { e: id, role: 'cam', peer: 'CAM3', name: 'Priya', cid: 'ghi' });
assert.equal(last('c3', 'peers'), undefined, 'a phone joining is not pushed a list (it asks with hello)');
await sig('$disconnect', 'h1');
assert.equal(last('c3', 'peers').peers.some((p) => p.role === 'host'), false, 'phones hear the host leave');
await connect('h2', { e: id, role: 'host', peer: 'HOST2', k: hostKey });
assert.equal(last('c3', 'peers').peers.some((p) => p.peer === 'HOST2'), true, 'phones hear the host arrive');
open.delete('h2');
ok('phones only hear about the host arriving or leaving');

// AWS cuts every connection at two hours. The studio reconnects, the phones answer at once, and AWS
// can't deliver to the new connection until its connecting has finished: that mustn't take it off
// the list (it did, leaving a studio no phone could reach). An older one that fails is taken off,
// and a connection the server has no record of is told to connect again.
await connect('h3', { e: id, role: 'host', peer: 'HOST3', k: hostKey });
open.delete('h3'); // (still connecting, as far as AWS is concerned)
await sig('$default', 'c3', { body: JSON.stringify({ action: 'signal', to: 'HOST3', data: { kind: 'offer' } }) });
open.add('h3');
await sig('$default', 'h3', { body: JSON.stringify({ action: 'hello' }) });
assert.equal(last('h3', 'peers')?.you, 'HOST3', 'a brand-new connection that missed a message stays on the list');
assert.equal(last('h3', 'rejoin'), undefined);
clock += 20000;
open.delete('h3');
await sig('$default', 'c3', { body: JSON.stringify({ action: 'signal', to: 'HOST3', data: { kind: 'offer' } }) });
open.add('h3');
await sig('$default', 'h3', { body: JSON.stringify({ action: 'ping' }) });
assert.ok(last('h3', 'rejoin'), 'one the server took for gone is told to connect again');
open.delete('h3');
await connect('h4a', { e: id, role: 'host', peer: 'HOST4', k: hostKey });
open.delete('h4a'); // (its old connection, gone without a word yet)
clock += 20000;
await connect('h4b', { e: id, role: 'host', peer: 'HOST4', k: hostKey });
await sig('$default', 'c3', { body: JSON.stringify({ action: 'signal', to: 'HOST4', data: { kind: 'offer', n: 4 } }) });
assert.equal(last('h4b', 'signal')?.data.n, 4, 'a message goes to the newest connection of that peer');
open.delete('h4b');
await sig('$disconnect', 'h4a');
await sig('$disconnect', 'h4b');
ok('a studio that just reconnected stays reachable; a lost one is told to connect again');

// a TV (the display role): it joins like a phone, hears who's here, reaches only the host
await connect('h3', { e: id, role: 'host', peer: 'HOST3', k: hostKey });
await connect('tv1', { e: id, role: 'display', peer: 'TV1', name: 'Hall TV', cid: 'tvdev' });
await sig('$default', 'tv1', { body: JSON.stringify({ action: 'hello' }) });
assert.equal(last('tv1', 'peers').peers.find((p) => p.peer === 'TV1').role, 'display', 'a TV keeps the display role');
await sig('$default', 'tv1', { body: JSON.stringify({ action: 'signal', to: 'HOST3', data: { display: { t: 'hello', v: 1 } } }) });
assert.deepEqual(last('h3', 'signal'), { type: 'signal', from: 'TV1', fromRole: 'display', data: { display: { t: 'hello', v: 1 } } });
await sig('$default', 'h3', { body: JSON.stringify({ action: 'signal', to: 'TV1', data: { display: { t: 'waiting' } } }) });
assert.equal(last('tv1', 'signal').data.display.t, 'waiting', 'the studio can answer a TV');
await sig('$default', 'tv1', { body: JSON.stringify({ action: 'signal', to: 'CAM3', data: { kind: 'offer' } }) });
assert.equal((outbox.get('c3') || []).filter((m) => m.type === 'signal').length, 0, 'a TV cannot message a phone');
const tvPeersBefore = (outbox.get('tv1') || []).filter((m) => m.type === 'peers').length;
await sig('$disconnect', 'h3');
assert.ok((outbox.get('tv1') || []).filter((m) => m.type === 'peers').length > tvPeersBefore && !last('tv1', 'peers').peers.some((p) => p.role === 'host'), 'a TV hears the studio leave');
await connect('c4', { e: id, role: 'cam', peer: 'CAM4', cid: 'jkl' });
await sig('$default', 'c4', { body: JSON.stringify({ action: 'status', rec: true }) });
assert.equal(last('tv1', 'peers').peers.some((p) => p.peer === 'CAM4'), true, 'a TV hears who is here, as the beacon does');
await sig('$disconnect', 'tv1'); await sig('$disconnect', 'c4');
ok('a TV joins as a display, talks only to the studio, and hears who is here');

const ev = await call('GET', `/events/${id}`);
assert.equal(ev.body.live, true, 'event shows as live while the host is connected');
clock += 60 * 60 * 1000;
assert.equal((await call('GET', `/events/${id}`)).body.live, false);
ok('live flag follows the host');

// globe feed can be switched off at the server
deps.flags.globe = false;
assert.equal((await call('GET', '/events/public')).status, 404, 'globe feed is off unless enabled');
deps.flags.globe = true;
ok('globe feed obeys the server flag');

// admin
const A = { 'x-admin-key': ADMIN_KEY };
assert.equal((await call('GET', '/admin/stats')).status, 403, 'admin needs a key');
assert.equal((await call('GET', '/admin/stats', null, { 'x-admin-key': 'nope' })).status, 403);
films.set(`films/${id}/a.mp4`, 1000);
films.set(`films/${id}/a-manifest.json`, 10);
const st = await call('GET', '/admin/stats', null, A);
assert.ok(st.body.events >= 3 && st.body.films === 3 && st.body.filmBytes === 1015, JSON.stringify(st.body));
const list = await call('GET', '/admin/events', null, A, { limit: '2' });
assert.equal(list.body.events.length, 2);
assert.ok(list.body.next, 'admin list pages');
const one = await call('GET', `/admin/events/${id}`, null, A);
assert.equal(one.body.films.length, 2);
const renamed = await call('PATCH', `/admin/events/${id}`, { title: 'Renamed', daysLeft: 2 }, A);
assert.ok(!('title' in renamed.body.event) && !('title' in (await store.getEvent(id))), 'admin can’t give a show a name either');
assert.ok(Math.abs(renamed.body.event.expiresAt - (clock + 2 * 86400000)) < 2000);
await call('DELETE', `/admin/events/${id}/films`, null, A);
assert.equal(films.size, 1, 'deleting films leaves other events alone');
assert.equal((await call('GET', `/events/${id}`)).body.published, undefined, 'film link removed');
await call('DELETE', `/admin/events/${id}`, null, A);
assert.equal((await call('GET', `/events/${id}`)).status, 404, 'event gone');
ok('admin: stats, paging, no names, set expiry, delete films, delete event');

// expiry: past its ttl an event is gone immediately, even before DynamoDB's TTL sweep
const exp = await call('POST', '/events', { title: 'Short lived' });
clock += 31 * 86400000;
assert.equal((await call('GET', `/events/${exp.body.id}`)).status, 404, 'expired after 30 days');
assert.equal((await signal({ route: '$connect', connectionId: 'late', query: { e: exp.body.id, role: 'cam', peer: 'L' } }, { store, post: async () => true, now: () => clock })).status, 404);
ok('events expire after 30 days for the API and signaling');
// kiosk shows: short-lived, and the host can delete one
{
  const k = (await call('POST', '/events', { title: 'Lobby show', kiosk: true })).body;
  const meta = await store.getEvent(k.id);
  assert.ok(meta.kiosk && meta.ttl - Math.floor(clock / 1000) <= 12 * 3600 && meta.ttl - Math.floor(clock / 1000) > 11 * 3600, 'a kiosk show lasts 12 hours');
  const later = clock + 13 * 3600 * 1000;
  assert.equal((await api({ method: 'GET', path: `/events/${k.id}`, headers: {}, query: {} }, { ...deps, now: () => later })).status, 404, 'gone after 12 hours');
  const k2 = (await call('POST', '/events', { title: 'Delete me', kiosk: true })).body;
  assert.equal((await call('DELETE', `/events/${k2.id}`)).status, 403, 'deleting needs the host key');
  assert.equal((await call('DELETE', `/events/${k2.id}`, undefined, { 'x-host-key': k2.hostKey })).status, 200);
  assert.equal((await call('GET', `/events/${k2.id}`)).status, 404, 'deleted now');
  ok('kiosk: a show started at a kiosk deletes itself after 12 hours; its host can delete it now (and only its host)');
  // an unnamed kiosk show: its first phone names it over their own link (the server never has the
  // name); the kiosk says only that it's named
  const k3 = (await call('POST', '/events', { kiosk: true })).body;
  const before = (await call('GET', `/events/${k3.id}`)).body;
  assert.deepEqual([before.title, before.titled, before.joined, before.usage], [undefined, false, undefined, undefined]);
  assert.equal((await call('POST', `/events/${k3.id}/name`, { title: 'Open mic night' })).status, 410, 'the old naming route is gone');
  assert.equal((await call('PATCH', `/events/${k3.id}`, { titled: true })).status, 403, 'only the kiosk says it');
  const named = await call('PATCH', `/events/${k3.id}`, { titled: true, title: 'Open mic night' }, { 'x-host-key': k3.hostKey });
  assert.ok(named.body.titled === true && !('title' in named.body) && !('title' in (await store.getEvent(k3.id))), 'named, without the name');
  assert.equal(named.body.termsHash, before.termsHash, 'terms unchanged: they never had the name');
  const plain = (await call('POST', '/events', {})).body;
  assert.equal((await call('PATCH', `/events/${plain.id}`, { titled: true }, { 'x-host-key': plain.hostKey })).body.titled, undefined, 'only a kiosk show is named that way');
  ok('kiosk: an unnamed kiosk show says it is named (never the name); the old naming route is gone');
}

// admin: what kind of event, and the time used on each part
{
  const A = { 'x-admin-key': ADMIN_KEY };
  const k = (await call('POST', '/events', { kiosk: true })).body, s = (await call('POST', '/events', { title: 'Studio show' })).body;
  const t0 = clock;
  await signal({ route: '$connect', connectionId: 'tc1', query: { e: s.id, peer: 'pa', role: 'cam', cid: 'CamA' } }, { store, post: async () => true, now: () => t0 });
  await signal({ route: '$disconnect', connectionId: 'tc1' }, { store, post: async () => true, now: () => t0 + 90000 });
  await call('POST', `/events/${s.id}/usage`, { liveSec: 600, editSec: 120 }, { 'x-host-key': s.hostKey });
  await call('POST', `/events/${k.id}/usage`, { kioskSec: 3600 }, { 'x-host-key': k.hostKey });
  const all = [];
  let cur;
  do {
    const r = (await call('GET', '/admin/events', null, A, { limit: '100', ...(cur ? { cursor: cur } : {}) })).body;
    all.push(...r.events);
    cur = r.next;
  } while (cur);
  const vs = all.find((e) => e.id === s.id), vk = all.find((e) => e.id === k.id);
  assert.deepEqual([vs.surface, vs.time], ['studio', { studio: 600, edit: 120, kiosk: 0, cameras: 90 }]);
  assert.deepEqual([vk.surface, vk.time.kiosk], ['kiosk', 3600]);
  ok('admin: each event says studio or kiosk, and the time used: studio 10 min, edit 2 min, a camera 90 s (from connect to disconnect); a kiosk 1 h');
}

// moderation: a blocked camera can't connect to that event
{
  const m = (await call('POST', '/events', { title: 'Moderated' })).body;
  const H = { 'x-host-key': m.hostKey };
  const conn = (connectionId, cid) => signal({ route: '$connect', connectionId, query: { e: m.id, peer: 'p-' + cid, role: 'cam', cid } }, { store, post: async () => true, now: () => clock });
  assert.equal((await conn('mb1', 'BadCid_123')).status, 200);
  assert.equal((await call('PATCH', `/events/${m.id}`, { blocked: ['BadCid_123', 'bad id!'] }, H)).status, 200);
  assert.deepEqual((await call('GET', `/events/${m.id}`)).body.blocked, ['BadCid_123']);
  assert.equal((await conn('mb2', 'BadCid_123')).status, 403, 'blocked camera refused');
  assert.equal((await conn('mb3', 'GoodCid_456')).status, 200, 'others still welcome');
  assert.equal((await call('PATCH', `/events/${m.id}`, { blocked: ['x'] })).status, 403, 'only the host can block');
  await call('PATCH', `/events/${m.id}`, { blocked: [] }, H);
  assert.equal((await conn('mb4', 'BadCid_123')).status, 200, 'let back in');
  ok('moderation: the host blocks a camera by its id; it can\'t connect until let back in; only valid ids kept; only the host can do it');
}

// growth: anonymous day counts that outlive the events
{
  const A = { 'x-admin-key': ADMIN_KEY };
  const today = new Date(clock).toISOString().slice(0, 10);
  const day = async () => (await call('GET', '/admin/growth', undefined, A)).body.days.find((d) => d.day === today) || {};
  const t0 = await day();
  const g = (await call('POST', '/events', { title: 'Growth test', kind: 'Wedding' })).body;
  const sg = (connectionId, peer, role, k) => signal({ route: '$connect', connectionId, query: { e: g.id, peer, role, k } }, { store, post: async () => true, now: () => clock });
  await sg('g1', 'phoneA', 'cam'); await sg('g2', 'phoneA', 'cam'); await sg('g3', 'phoneB', 'mic');
  await sg('g4', 'h', 'host', g.hostKey); await sg('g5', 'h', 'host', g.hostKey);
  const H = { 'x-host-key': g.hostKey };
  await call('POST', `/events/${g.id}/usage`, { clips: 3, footageSec: 120, liveCutSec: 60, streamSec: 0 }, H);
  await call('POST', `/events/${g.id}/usage`, { clips: 5, footageSec: 200, liveCutSec: 60, streamSec: 30 }, H);
  await call('POST', `/events/${g.id}/usage`, { clips: 2, footageSec: 10 }, H); // (a studio on another computer reporting less never subtracts)
  const t1 = await day();
  const d = (k) => (t1[k] || 0) - (t0[k] || 0);
  assert.deepEqual(
    ['events', 'kind_wedding', 'cameras', 'mics', 'active_events', 'clips', 'footage_sec', 'live_cut_sec', 'stream_sec'].map(d),
    [1, 1, 1, 1, 1, 5, 200, 60, 30],
  );
  assert.equal((await call('POST', `/events/${g.id}/usage`, { clips: 1 })).status, 403, 'usage needs the host key');
  const rec = JSON.stringify(t1);
  assert.ok(!rec.includes(g.id) && !rec.includes('phoneA') && !rec.includes('Growth test'), 'day counts name nothing');
  ok(`growth: an event, a camera joining twice and a mic count once each; usage adds only what's new (${JSON.stringify(Object.fromEntries(Object.entries(t1).filter(([k]) => k !== 'day')))})`);

  // the counts outlive the event
  const later = clock + 31 * 86400000;
  const kept = (await api({ method: 'GET', path: '/admin/growth', headers: A, query: { from: today, to: today } }, { ...deps, now: () => later })).body.days;
  assert.equal(kept[0].events, t1.events);
  assert.equal((await api({ method: 'GET', path: `/events/${g.id}`, headers: {}, query: {} }, { ...deps, now: () => later })).status, 404);
  ok('growth: 31 days on, the event is gone but the day counts are still there');

  // backfill: events from before counting began fill days that have no counts
  const s2 = memoryStore(), old = clock - 5 * 86400000;
  await s2.putEventIfAbsent({ id: 'OLD111', title: 'x', kind: 'show', createdAt: old, public: true, ttl: Math.floor(clock / 1000) + 86400 * 20 });
  await s2.putEventIfAbsent({ id: 'OLD222', title: 'y', kind: 'show', createdAt: old, ttl: Math.floor(clock / 1000) + 86400 * 20 });
  const d2 = { ...deps, store: s2 };
  const bf = (await api({ method: 'POST', path: '/admin/growth/backfill', headers: A, query: {} }, d2)).body;
  const oldDay = new Date(old).toISOString().slice(0, 10);
  const got = (await api({ method: 'GET', path: '/admin/growth', headers: A, query: {} }, d2)).body.days.find((x) => x.day === oldDay);
  assert.deepEqual([bf.filled, got.events, got.events_public, got.kind_show, got.backfilled], [1, 2, 1, 2, 1]);
  assert.equal((await api({ method: 'POST', path: '/admin/growth/backfill', headers: A, query: {} }, d2)).body.filled, 0, 'backfill never counts a day twice');
  ok('growth: backfill fills days from before counting began, once');

  // snapshots: saved and listed
  await call('POST', '/admin/growth/snapshots', { label: 'Seed deck, Oct', from: '2026-09-01', to: today, summary: { events: 9 }, days: [t1] }, A);
  const snaps = (await call('GET', '/admin/growth/snapshots', undefined, A)).body.snapshots;
  assert.equal(snaps[0].label, 'Seed deck, Oct');
  assert.equal((await call('GET', '/admin/growth', undefined, {})).status, 403);
  ok('growth: snapshots save and list; all of it needs the admin key');
}

// web traffic: page views and visitors, no cookies
{
  const A = { 'x-admin-key': ADMIN_KEY };
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const hitAs = (body, ua = UA, ip = '203.0.113.7') => api({ method: 'POST', path: '/api/hit', body, headers: { 'user-agent': ua, host: 'vuemesh.com' }, query: {}, ip }, deps);
  await hitAs({ p: '/', r: 'https://www.google.com/search?q=vuemesh', u: 'Spring_Promo' });
  await hitAs({ p: '/studio.html', r: 'https://vuemesh.com/' });             // the same visitor, a second page (from our own site)
  await hitAs({ p: '/' }, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36', '198.51.100.4');  // someone else, typed it in
  await hitAs({ p: '/' }, 'Googlebot/2.1 (+http://www.google.com/bot.html)');  // a bot: not counted
  await hitAs({ p: '/admin' });                                               // the admin: not counted
  await hitAs({ p: '/', ev: 'film:wedding:play' });                          // an event, not a page view
  const days = (await call('GET', '/admin/traffic', null, A)).body.days;
  const d = days[days.length - 1];
  assert.deepEqual([d.pageviews, d.visitors, d['page:/'], d['page:/studio'], d['ref:google.com'], d['ref:(direct)'], d['ref:vuemesh.com'], d['utm:spring_promo']], [3, 2, 2, 1, 1, 1, undefined, 1]);
  assert.deepEqual([d['dev:mobile'], d['dev:desktop'], d['br:Safari'], d['br:Chrome'], d['ev:film:wedding:play'], d['page:/admin']], [1, 1, 1, 1, 1, undefined]);
  assert.equal((await call('GET', '/admin/traffic', null, {})).status, 403);
  ok('traffic: 3 page views by 2 visitors (counted once a day each), pages, referrers (Google; direct; not our own pages), a campaign, device and browser per visitor, a film play; bots and the admin not counted; the admin key needed');
}

// footage: no event records more than its devices could since it was made
{
  const f = (await call('POST', '/events', { title: 'Footage' })).body;
  const before = (await call('GET', '/admin/growth', null, { 'x-admin-key': ADMIN_KEY })).body.days.slice(-1)[0]?.footage_sec || 0;
  await call('POST', `/events/${f.id}/usage`, { clips: 3, footageSec: 7161743 }, { 'x-host-key': f.hostKey });
  const after = (await call('GET', '/admin/growth', null, { 'x-admin-key': ADMIN_KEY })).body.days.slice(-1)[0].footage_sec;
  assert.ok(after - before <= 60 * 16, `added ${after - before} s`);
  ok(`footage: an event a moment old reporting 7,161,743 s (83 days) adds at most what its devices could record (${after - before} s)`);
}

// correcting a day: the count set right, the old value kept beside it
{
  const A = { 'x-admin-key': ADMIN_KEY };
  await deps.store.bumpStats('2026-10-08', { footage_sec: 7161743 });
  const r = (await call('POST', '/admin/growth/fix', { day: '2026-10-08', key: 'footage_sec', value: 1743 }, A)).body;
  const day = (await call('GET', '/admin/growth', null, A, { from: '2026-10-08', to: '2026-10-08' })).body.days[0];
  assert.deepEqual([r.was, r.now, day.footage_sec, day.was_footage_sec], [7161743, 1743, 1743, 7161743]);
  await call('POST', '/admin/growth/fix', { day: '2026-10-08', key: 'footage_sec', value: 1800 }, A);
  assert.equal((await call('GET', '/admin/growth', null, A, { from: '2026-10-08', to: '2026-10-08' })).body.days[0].was_footage_sec, 7161743, 'the original stays the original');
  assert.equal((await call('POST', '/admin/growth/fix', { day: 'nope', key: 'footage_sec', value: 1 }, A)).status, 400);
  ok('growth: a day corrected (7,161,743 → 1,743 s), its original kept as was_footage_sec (still the original after a second correction)');
}

// a local show's address: registered by a host, its certificate check put in the DNS only by its owner
{
  const txts = new Map();
  const lanDeps = { ...deps, lanDns: { setTxt: async (n, v) => txts.set(n, v), clearTxt: async (n) => txts.delete(n) }, lanDomain: 'lan.example.com' };
  const lc = (method, path, body, headers = {}) => api({ method, path, body, headers, query: {} }, lanDeps);
  const ev = (await call('POST', '/events', { title: 'Barn dance' })).body;
  const token = 'a-secret-that-is-long-enough';
  assert.equal((await call('POST', `/events/${ev.id}/lan`, { slug: 'abcdefgh23', token }, { 'x-host-key': ev.hostKey })).status, 503, 'off unless the server has a zone');
  assert.equal((await lc('POST', `/events/${ev.id}/lan`, { slug: 'abcdefgh23', token })).status, 403, 'a host only');
  assert.equal((await lc('POST', `/events/${ev.id}/lan`, { slug: 'AB', token }, { 'x-host-key': ev.hostKey })).status, 400);
  const reg = await lc('POST', `/events/${ev.id}/lan`, { slug: 'abcdefgh23', token }, { 'x-host-key': ev.hostKey });
  assert.equal(reg.body.name, 'abcdefgh23.lan.example.com');
  assert.equal((await lc('POST', `/events/${ev.id}/lan`, { slug: 'abcdefgh23', token }, { 'x-host-key': ev.hostKey })).status, 200, 'the same owner again (a renewal)');
  assert.equal((await lc('POST', `/events/${ev.id}/lan`, { slug: 'abcdefgh23', token: 'somebody-else-entirely' }, { 'x-host-key': ev.hostKey })).status, 409, 'not someone else');
  const value = 'x'.repeat(43);
  assert.equal((await lc('PUT', '/lan/abcdefgh23/txt', { token: 'wrong-token-wrong-token', value })).status, 403);
  assert.equal((await lc('PUT', '/lan/abcdefgh23/txt', { token, value: 'not a check; rm -rf' })).status, 400);
  assert.equal((await lc('PUT', '/lan/abcdefgh23/txt', { token, value })).status, 200);
  assert.equal(txts.get('_acme-challenge.abcdefgh23.lan.example.com'), value);
  assert.equal((await lc('DELETE', '/lan/abcdefgh23/txt', { token })).status, 200);
  assert.equal(txts.size, 0);
  ok("a local show's address: a host registers it once (its owner again for a renewal), and only its owner puts its certificate check in the DNS, and takes it out");
}

{
  // a TV's own code, with no studio (tvdirect.js): what the people joining agree to says nothing's recorded
  const tv = await call('POST', '/events', { title: 'Lobby TV', kind: 'tv' });
  const got = await call('GET', `/events/${tv.body.id}`);
  assert.equal(got.body.kind, 'tv');
  assert.ok(/is a TV screen/.test(got.body.terms) && /Nothing is recorded/.test(got.body.terms) && !/publish/.test(got.body.terms) && !/Lobby TV/.test(got.body.terms), got.body.terms);
  const other = await call('POST', '/events', { title: 'Band night', kind: 'show' });
  const show = await call('GET', `/events/${other.body.id}`);
  assert.ok(/publish them/.test(show.body.terms), show.body.terms);
  ok("a TV's own code: its terms say it's a TV and nothing is recorded; a show's are as before");
}

{
  // TURN passwords for the relay (aws/stun): coturn's use-auth-secret, a day long, nothing about who asked
  const none = await call('GET', '/api/ice');
  assert.deepEqual(none.body, { iceServers: [], ttl: 0 }, 'no relay set up: none handed out');
  const turn = { secret: 'test-turn-secret', urls: ['turn:stun.example:3478?transport=udp', 'turn:stun.example:3478?transport=tcp'] };
  const site = { origin: 'https://cdn.example' };
  const ask = (headers = site, ip = '203.0.113.7', more = {}) => api({ method: 'GET', path: '/api/ice', headers, query: {}, ip }, { ...deps, turn, ...more });
  const r = await ask();
  const [srv] = r.body.iceServers;
  assert.deepEqual(srv.urls, turn.urls);
  const [expiry, id] = srv.username.split(':');
  assert.equal(Number(expiry), Math.floor(clock / 1000) + 86400, 'good for a day');
  assert.match(id, /^[0-9a-f]{12}$/, 'a random id, nothing about the device');
  assert.equal(srv.credential, createHmac('sha1', turn.secret).update(srv.username).digest('base64'));
  assert.notEqual(iceServers(turn, clock).iceServers[0].username, srv.username, 'a new one each time');
  assert.equal(r.body.ttl, 86400);
  ok('TURN passwords: none without a relay; HMAC-SHA1 of "<expiry>:<id>", a day long');

  // only this site's pages: another site (its visitors' browsers say so) or a script without an origin gets none
  assert.equal((await ask({ origin: 'https://freeloader.example' })).body.iceServers.length, 0);
  assert.equal((await ask({})).body.why, 'only for this site');
  assert.equal((await ask({ origin: 'https://www.cdn.example' })).body.iceServers.length, 1, 'www. is this site too');
  ok("TURN passwords: only for this site's pages, not another site's or a script without an origin");

  // a few an hour per address, then none (another address still gets one); the next hour, again
  let given = 0;
  for (let i = 0; i < 40; i++) given += (await ask(site, '198.51.100.9')).body.iceServers.length;
  assert.equal(given, TURN_LIMITS.perAddressHour, `${TURN_LIMITS.perAddressHour} an hour from one address`);
  assert.equal((await ask(site, '198.51.100.9')).body.why, 'too many, try again later');
  assert.equal((await ask(site, '198.51.100.10')).body.iceServers.length, 1, 'another address still gets one');
  clock += 3600_000;
  assert.equal((await ask(site, '198.51.100.9')).body.iceServers.length, 1, 'the next hour, again');
  ok(`TURN passwords: ${TURN_LIMITS.perAddressHour} an hour per address, then none`);

  // switched off, or the month's data nearly used: none
  assert.equal((await ask(site, '192.0.2.1', { relayState: async () => ({ open: false, share: 0 }) })).body.why, 'relay off');
  assert.equal((await ask(site, '192.0.2.1', { relayState: async () => ({ open: true, share: 0.95 }) })).body.iceServers.length, 0, 'over 90% of the month');
  assert.equal((await ask(site, '192.0.2.1', { relayState: async () => ({ open: true, share: 0.5 }) })).body.iceServers.length, 1);
  assert.equal((await ask(site, '192.0.2.1', { relayState: async () => { throw new Error('Lightsail down'); } })).body.iceServers.length, 1, "Lightsail not answering doesn't stop shows");
  const t = (await store.listTraffic(new Date(clock).toISOString().slice(0, 10), new Date(clock).toISOString().slice(0, 10)))[0];
  assert.ok(t['turn:given'] >= 1 && t['turn:off'] === 1 && t['turn:budget'] === 1, JSON.stringify(t));
  ok('TURN passwords: none while the relay is off or past 90% of the month; counted, given or why not');
}

{
  // Admin: the Lightsail servers and the relay's switch
  const admin = { 'x-admin-key': ADMIN_KEY };
  assert.deepEqual((await call('GET', '/admin/servers', undefined, admin)).body.servers, [], 'none without Lightsail access');
  let open = true;
  const servers = { status: async () => [{ name: 'vuemesh-stun-2', relay: true, relayOpen: open }], setRelay: async (o) => ((open = o), { name: 'vuemesh-stun-2', open }) };
  const a = (method, path, body, headers = admin) => api({ method, path, body, headers, query: {} }, { ...deps, servers });
  assert.equal((await a('GET', '/admin/servers', undefined, {})).status, 403, 'admin only');
  assert.equal((await a('GET', '/admin/servers')).body.servers[0].name, 'vuemesh-stun-2');
  assert.equal((await a('POST', '/admin/relay', { open: 'no' })).status, 400);
  assert.equal((await a('POST', '/admin/relay', { open: false }, {})).status, 403, 'only admin switches it');
  assert.deepEqual((await a('POST', '/admin/relay', { open: false })).body, { name: 'vuemesh-stun-2', open: false });
  assert.equal(open, false);

  // the guard: past the allowance the relay is switched off; under it, left alone
  const fake = (share, isOpen = true) => { const calls = []; return { calls, relay: async () => ({ name: 'r', open: isOpen, usedGb: share * 1024, allowanceGb: 1024, share }), setRelay: async (o) => calls.push(o) }; };
  const over = fake(1.01), under = fake(0.8), closed = fake(1.2, false);
  assert.equal((await guard(over, clock, () => {})).switchedOff, true); assert.deepEqual(over.calls, [false]);
  await guard(under, clock, () => {}); assert.deepEqual(under.calls, []);
  await guard(closed, clock, () => {}); assert.deepEqual(closed.calls, [], 'already off');
  ok('admin: the servers and the relay switch, admin only; the guard switches the relay off past the allowance');
}

{
  // The relay's minute report: signed with the TURN secret, counts only, into the day's counts
  const turn = { secret: 'test-turn-secret', urls: ['turn:stun.example:3478?transport=udp'] };
  const send = (body, { secret = turn.secret, raw = JSON.stringify(body), sig } = {}) =>
    api({ method: 'POST', path: '/api/relay/report', body: JSON.parse(raw), raw, headers: { 'x-relay-sig': sig ?? relaySig(secret, body.at, raw) }, query: {} }, { ...deps, turn });
  const report = { at: clock, v: '1', open: 3, peak: 5, counts: { started: 2, bad_password: 1, forbidden: 4, tcp: 1, flood: 7, bytes_in: 1000, bytes_out: 900, relay_min: 3, ip: 9 } };
  assert.equal((await send(report, { secret: 'wrong' })).status, 403, 'not signed with the secret');
  assert.equal((await send(report, { sig: '' })).status, 403, 'not signed at all');
  assert.equal((await send({ ...report, at: clock - 10 * 60_000 })).status, 400, 'too old');
  assert.equal((await api({ method: 'POST', path: '/api/relay/report', body: report, raw: JSON.stringify(report), headers: {}, query: {} }, deps)).status, 404, 'no relay, no reports');
  const r = await send(report);
  assert.deepEqual(r.body, { logUntil: 0 }, 'the troubleshooting log is off');
  assert.equal((await send(report)).status, 409, 'the same report twice is counted once');
  await send({ ...report, at: clock + 1, peak: 2, counts: { started: 1 } });
  const day = new Date(clock).toISOString().slice(0, 10), hour = new Date(clock).toISOString().slice(11, 13);
  const t = (await store.listTraffic(day, day))[0];
  assert.equal(t['relay:started'], 3);
  assert.equal(t['relay:forbidden'], 4);
  assert.equal(t['relay:bytes_in'], 1000);
  assert.equal(t['relay:peak'], 5, 'the most at once only goes up');
  assert.equal(t[`relayh:${hour}:peak`], 5);
  assert.equal(t[`relayh:${hour}:bytes`], 1900);
  assert.ok(!Object.keys(t).some((k) => /ip/.test(k)), 'only the counts it knows: nothing else gets in');
  ok('relay report: signed with the TURN secret, once each, fresh; counts only, into the day');

  // Admin's troubleshooting switch: on for up to a day, the relay hears it in its next report
  const admin = { 'x-admin-key': ADMIN_KEY };
  const servers = { status: async () => [], setRelay: async () => ({}) };
  const a = (method, path, body, headers = admin) => api({ method, path, body, headers, query: {} }, { ...deps, servers, turn });
  assert.equal((await a('POST', '/admin/relay-log', { hours: 1 }, {})).status, 403, 'admin only');
  assert.equal((await a('POST', '/admin/relay-log', { hours: RELAY_LOG_MAX_HOURS + 1 })).status, 400, 'a day at most');
  const on = (await a('POST', '/admin/relay-log', { hours: 1 })).body.relayLog;
  assert.equal(on.until, clock + 3600_000);
  assert.equal((await send({ ...report, at: clock + 2, counts: {} })).body.logUntil, clock + 3600_000, 'the relay is told');
  const seen = (await a('GET', '/admin/servers')).body;
  assert.equal(seen.relayLog.until, clock + 3600_000);
  assert.equal(seen.relayReport.open, 3, 'when it last reported, and how many relays were open');
  assert.equal((await a('POST', '/admin/relay-log', { hours: 0 })).body.relayLog, null);
  assert.equal((await send({ ...report, at: clock + 3, counts: {} })).body.logUntil, 0, 'off again');
  ok('relay troubleshooting log: admin only, a day at most, the relay hears it in its next report');
}

{
  // Calls: a room key after the # (only its hash reaches the server), a PIN for typing the code,
  // a waiting room, and everyone in the call talking to everyone
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const roomKey = 'room-key-only-the-link-has', kh = sha(roomKey);
  assert.equal((await call('POST', '/events', { kind: 'call' })).status, 400, 'a call needs its key hash');
  const made = (await call('POST', '/events', { kind: 'call', kh, title: 'Family call' })).body;
  const { id: cid, hostKey: chk, pin } = made;
  assert.match(pin, /^\d{6}$/);
  const stored = await store.getEvent(cid);
  assert.ok(!JSON.stringify(stored).includes(roomKey) && !JSON.stringify(stored).includes(kh) && !JSON.stringify(stored).includes(pin) && !('title' in stored), 'the server keeps no key, no key hash, no PIN, no name');
  const pub = (await call('GET', `/events/${cid}`)).body;
  assert.ok(!('keyCheck' in pub) && !('pinHash' in pub) && !('passes' in pub) && !('pinFails' in pub), 'nor shows its checks');
  ok('calls: made with a key hash; the server keeps neither key nor PIN nor name');

  const enter = (body) => call('POST', `/events/${cid}/enter`, body);
  assert.equal((await enter({})).status, 403, 'not on the code alone');
  assert.equal((await enter({ kh: sha('a guess') })).status, 403, 'not with the wrong key');
  assert.deepEqual((await enter({ kh })).body, { ok: true, waiting: false }, 'the first into an empty call goes straight in');
  assert.equal((await enter({ pin: '000000' === pin ? '111111' : '000000' })).status, 403);
  assert.equal((await enter({ pin })).status, 200, 'or with the code and PIN');
  ok('calls: in with the link or the code and PIN, never the code alone');

  // the room: A first (straight in), then B (waits)
  const cconnect = (conn, q) => connect(conn, { e: cid, ...q });
  const ph = (p) => sha(p);
  assert.equal((await cconnect('A', { role: 'guest', peer: 'PA', kh: sha('nope') })).status, 403, 'the socket checks too');
  assert.equal((await cconnect('A', { role: 'guest', peer: 'PA', kh, ph: ph('passA'), cid: 'devA', name: 'Ann' })).status, 200);
  await sig('$default', 'A', { body: JSON.stringify({ action: 'hello' }) });
  assert.equal(last('A', 'peers').waiting, undefined, 'A is in');
  assert.equal((await cconnect('B', { role: 'guest', peer: 'PB', kh, ph: ph('passB'), cid: 'devB', name: 'Bob' })).status, 200);
  await sig('$default', 'B', { body: JSON.stringify({ action: 'hello' }) });
  assert.deepEqual([last('B', 'peers').waiting, last('B', 'peers').peers], [true, []], 'B waits, and sees nobody');
  assert.ok((await store.listConns(cid)).every((c) => c.name === ''), 'no names kept on the connections');
  assert.deepEqual(last('A', 'peers').peers.map((p) => [p.peer, p.waiting]), [['PA', false], ['PB', true]], 'A sees someone waiting');
  await sig('$default', 'B', { body: JSON.stringify({ action: 'knock', name: 'Bob' }) });
  assert.deepEqual(last('A', 'knock'), { type: 'knock', from: 'PB', name: 'Bob' }, "B's knock, with the name it gave, reaches A");
  assert.ok(!JSON.stringify(await store.listConns(cid)).includes('Bob') && !JSON.stringify(await store.getEvent(cid)).includes('Bob'), 'and the name is not kept');
  await sig('$default', 'B', { body: JSON.stringify({ action: 'signal', to: 'PA', data: { kind: 'offer' } }) });
  assert.equal(last('A', 'signal'), undefined, 'a waiting device can’t signal anyone');
  await sig('$default', 'B', { body: JSON.stringify({ action: 'admit', peer: 'PB' }) });
  assert.equal(last('B', 'admitted'), undefined, "a waiting device can't let itself in");
  await sig('$default', 'A', { body: JSON.stringify({ action: 'admit', peer: 'PB' }) });
  assert.deepEqual(last('B', 'admitted'), { type: 'admitted', by: 'PA' });
  assert.deepEqual(last('B', 'peers').peers.map((p) => p.waiting), [false, false], 'B in, and hears who is');
  await sig('$default', 'B', { body: JSON.stringify({ action: 'signal', to: 'PA', data: { kind: 'offer', sdp: 'o' } }) });
  assert.deepEqual(last('A', 'signal'), { type: 'signal', from: 'PB', fromRole: 'guest', data: { kind: 'offer', sdp: 'o' } }, 'people in a call talk to each other');
  ok('calls: a waiting room (waiting sees nobody, can only knock); someone in lets them in; then everyone signals everyone');

  // back after a dropped connection: no waiting again, with its own pass
  await sig('$disconnect', 'B');
  open.delete('B');
  assert.equal((await cconnect('B2', { role: 'guest', peer: 'PB', pass: 'passB', ph: ph('passB'), cid: 'devB' })).status, 200);
  await sig('$default', 'B2', { body: JSON.stringify({ action: 'hello' }) });
  assert.equal(last('B2', 'peers').waiting, undefined, 'straight back in with its pass');
  assert.equal((await enter({ pass: 'not-a-pass' })).status, 403);
  ok('calls: back in after a dropped connection with its own pass, without waiting');
  {
    const today = new Date(clock).toISOString().slice(0, 10), d = (await store.listStats(today, today))[0] || {};
    assert.equal(d.call_people, 2, 'Ann and Bob: each counted once (Bob when let in, not while waiting, and not again when back)');
    assert.ok(d.call_joins >= 3, 'connections, reconnects among them');
    const kept = (await store.getEvent(cid)).callJoined;
    assert.ok(kept.length === 2 && !JSON.stringify(kept).includes('devA') && !JSON.stringify(kept).includes('devB'), 'kept on the call as one-way codes only');
    ok('calls: each person counted once per call, when in; codes kept on the call only');
  }

  // leaving says so: everyone's list goes without them at once (before the connection's even closed)
  assert.equal((await cconnect('L1', { role: 'guest', peer: 'PL', pass: 'passB', cid: 'devL' })).status, 200);
  assert.ok(last('A', 'peers').peers.some((p) => p.peer === 'PL'));
  await sig('$default', 'L1', { body: JSON.stringify({ action: 'leave' }) });
  assert.ok(!last('A', 'peers').peers.some((p) => p.peer === 'PL') && !(await store.listConns(cid)).some((c) => c.peer === 'PL'), 'gone from the list at once');
  open.delete('L1');
  await sig('$disconnect', 'L1');
  ok('calls: leaving takes them off everyone’s list at once');

  // lock: nobody new, even with the link; those let in still come back
  await sig('$default', 'A', { body: JSON.stringify({ action: 'lock', on: true }) });
  assert.equal(last('B2', 'locked').on, true, 'everyone hears it');
  assert.equal((await enter({ kh })).status, 423, 'locked: not even with the link');
  assert.equal((await enter({ pass: 'passB' })).status, 200, 'but someone let in before comes back');
  await sig('$default', 'A', { body: JSON.stringify({ action: 'lock', on: false }) });
  ok('calls: locked, nobody new comes in (even with the link); those let in come back');

  // remove and keep out: its pass forgotten and its camera id blocked
  await sig('$default', 'A', { body: JSON.stringify({ action: 'remove', peer: 'PB', block: true }) });
  assert.deepEqual(last('B2', 'removed'), { type: 'removed', block: true });
  assert.ok(!(await store.listConns(cid)).some((c) => c.peer === 'PB'), 'out of the call');
  assert.equal((await enter({ pass: 'passB', cid: 'devB' })).status, 403, 'and kept out');
  assert.equal((await enter({ kh, cid: 'devB' })).status, 403, 'even with the link');
  ok('calls: taken out and kept out (pass forgotten, device blocked)');

  // full at 6; the PIN closes after 10 wrong tries
  for (let i = 0; i < 5; i++) {
    await cconnect(`F${i}`, { role: 'guest', peer: `PF${i}`, kh });
    await sig('$default', 'A', { body: JSON.stringify({ action: 'admit', peer: `PF${i}` }) });
  }
  assert.equal((await store.listConns(cid)).filter((c) => !c.waiting).length, CALL.maxIn);
  assert.equal((await enter({ pass: 'passA' })).status, 409, 'full: six people');
  for (let i = 0; i < CALL.pinTries; i++) await enter({ pin: pin === '123456' ? '654321' : '123456' });
  assert.equal((await enter({ pin })).status, 429, 'the right PIN too, after ten wrong ones: the link only');
  ok(`calls: full at ${CALL.maxIn}; the PIN closes after ${CALL.pinTries} wrong tries`);

  // the creator's host key gets in without waiting; a call deletes itself after a day
  const h = await enter({ k: chk });
  assert.equal(h.status, 409, 'host key counts as in, and the call is full');
  const later = clock + 25 * 3600 * 1000;
  assert.equal((await api({ method: 'GET', path: `/events/${cid}`, headers: {}, query: {} }, { ...deps, now: () => later })).status, 404, 'gone after a day');
  ok('calls: a call deletes itself after a day');

  // made too often from one address: refused
  let refused = 0;
  for (let i = 0; i < CALL.perAddressHour + 2; i++) if ((await api({ method: 'POST', path: '/events', body: { kind: 'call', kh }, headers: {}, query: {}, ip: '203.0.113.50' }, deps)).status === 429) refused++;
  assert.equal(refused, 2, `${CALL.perAddressHour} calls an hour from one address`);
  ok(`calls: ${CALL.perAddressHour} an hour from one address`);

  // A studio in a call: nobody takes it out; a call it started is its to run while it's in it
  const show = (await call('POST', '/events', { kind: 'show' })).body;
  const sCall = (await api({ method: 'POST', path: '/events', body: { kind: 'call', kh, show: show.id, sk: show.hostKey }, headers: {}, query: {}, ip: '198.51.100.70' }, deps)).body;
  const fake = (await api({ method: 'POST', path: '/events', body: { kind: 'call', kh, show: show.id, sk: 'not-its-key' }, headers: {}, query: {}, ip: '198.51.100.70' }, deps)).body;
  assert.ok((await store.getEvent(sCall.id)).byStudio && !(await store.getEvent(fake.id)).byStudio, 'started by a studio only with its show key');
  const into = (id) => (conn, q) => connect(conn, { e: id, kh, ...q });
  const s1 = into(sCall.id);
  await s1('ST', { role: 'host', k: sCall.hostKey, peer: 'PS', show: show.id, sk: show.hostKey });
  await s1('G1', { role: 'guest', peer: 'P1' });
  await s1('G2', { role: 'guest', peer: 'P2' });
  await sig('$default', 'ST', { body: JSON.stringify({ action: 'admit', peer: 'P1' }) });
  await sig('$default', 'ST', { body: JSON.stringify({ action: 'admit', peer: 'P2' }) });
  assert.ok((await store.listConns(sCall.id)).every((c) => !c.waiting), 'the studio lets them in');
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'hello' }) });
  assert.equal(last('G1', 'peers').studioRules, true, 'everyone hears the studio runs it');
  assert.equal(last('G1', 'peers').peers.find((p) => p.peer === 'PS').studio, true, 'and which one is the studio');
  await s1('G3', { role: 'guest', peer: 'P3' });
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'admit', peer: 'P3' }) });
  assert.ok((await store.listConns(sCall.id)).find((c) => c.peer === 'P3').waiting && /studio lets/.test(last('G1', 'refused').why), "a guest can't let people in");
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'remove', peer: 'P2', block: true }) });
  assert.ok((await store.listConns(sCall.id)).some((c) => c.peer === 'P2'), "nor take one out");
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'lock', on: true }) });
  assert.ok(!(await store.getEvent(sCall.id)).locked, 'nor lock it');
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'remove', peer: 'PS', block: true }) });
  assert.ok((await store.listConns(sCall.id)).some((c) => c.peer === 'PS') && /Nobody can take the studio out/.test(last('G1', 'refused').why), 'nor the studio');
  await sig('$default', 'ST', { body: JSON.stringify({ action: 'remove', peer: 'P2', block: true }) });
  assert.ok(!(await store.listConns(sCall.id)).some((c) => c.peer === 'P2'), 'the studio takes people out');
  // with the studio gone from it, it's everyone's again: a guest lets someone in
  await sig('$default', 'ST', { body: JSON.stringify({ action: 'leave' }) });
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'admit', peer: 'P3' }) });
  assert.ok(!(await store.listConns(sCall.id)).find((c) => c.peer === 'P3').waiting, 'with the studio gone, guests let people in');
  await sig('$default', 'G1', { body: JSON.stringify({ action: 'leave' }) });
  assert.ok(!(await store.listConns(sCall.id)).some((c) => c.peer === 'P1'), 'and anyone can leave');
  ok("calls: a studio's call is the studio's to run (only it lets in, takes out, locks); nobody takes the studio out; anyone can leave");

  // a call the studio joined: the people in it keep their say over each other, but not the studio
  const gCall = (await api({ method: 'POST', path: '/events', body: { kind: 'call', kh }, headers: {}, query: {}, ip: '198.51.100.71' }, deps)).body;
  const g = into(gCall.id);
  await g('A1', { role: 'host', k: gCall.hostKey, peer: 'QA' });
  await g('B1', { role: 'guest', peer: 'QB' });
  await g('S2', { role: 'guest', peer: 'QS', show: show.id, sk: show.hostKey });
  await sig('$default', 'A1', { body: JSON.stringify({ action: 'admit', peer: 'QB' }) });
  await sig('$default', 'A1', { body: JSON.stringify({ action: 'admit', peer: 'QS' }) });
  await sig('$default', 'A1', { body: JSON.stringify({ action: 'hello' }) });
  assert.equal(last('A1', 'peers').studioRules, false, 'not the studio’s to run');
  await sig('$default', 'A1', { body: JSON.stringify({ action: 'remove', peer: 'QS', block: true }) });
  assert.ok((await store.listConns(gCall.id)).some((c) => c.peer === 'QS'), 'still nobody takes the studio out');
  await sig('$default', 'A1', { body: JSON.stringify({ action: 'remove', peer: 'QB', block: true }) });
  assert.ok(!(await store.listConns(gCall.id)).some((c) => c.peer === 'QB'), 'they can take each other out');
  await sig('$default', 'S2', { body: JSON.stringify({ action: 'lock', on: true }) });
  assert.ok((await store.getEvent(gCall.id)).locked, 'and the studio can lock it too');
  ok('calls: in a call the studio joined, people still take each other out, never the studio');
}

console.log('\nAll core tests passed.');
