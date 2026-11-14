// VUEMesh cloud core. The cloud does three small jobs:
//   1. events: create, look up, list nearby public ones (discovery)
//   2. signaling: relay WebRTC offers/answers/ICE so phones can find the host
//      laptop and then talk to it directly over the local network
//   3. publishing: hand out one-time upload URLs for the finished film
//   4. TURN passwords: short-lived ones for the site's relay (aws/stun), for devices that can't
//      reach each other directly; the relay forwards their encrypted media, this never sees it
// Video never passes through here.

import { randomId, sha256hex, b64url, termsText, HttpError, publicEvent } from './common.mjs';
import { randomBytes, randomInt, createHmac, timingSafeEqual } from 'node:crypto';

const DAY = 86400;
const EVENT_TTL_DAYS = 30;
const KIOSK_TTL_HOURS = 12; // a show started at a kiosk deletes itself after this if nobody does
const LIVE_WINDOW_MS = 15 * 60 * 1000;

// ------------------------------------------------------------------ HTTP API ---

/**
 * @param {{method:string, path:string, query:object, headers:object, body:any}} req
 * @param {{store:object, presign:Function, cdn:string, now?:()=>number}} deps
 */
export async function api(req, deps) {
  try {
    return await route(req, deps);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
    console.error(e);
    return { status: 500, body: { error: 'Something went wrong on our side' } };
  }
}

const TURN_TTL = DAY; // a TURN password works for a day: longer than any show's connections need to be set up

/**
 * The relay's addresses with a password for them (coturn's use-auth-secret: the username is
 * "<expiry>:<random id>", the password base64(HMAC-SHA1(secret, username))). Nothing about who asked
 * is in it or kept. None when the site has no relay.
 * @param {{secret?: string, urls?: string[]}|undefined} turn  @param {number} now ms
 */
export function iceServers(turn, now) {
  if (!turn?.secret || !turn.urls?.length) return { iceServers: [], ttl: 0 };
  const username = `${Math.floor(now / 1000) + TURN_TTL}:${randomBytes(6).toString('hex')}`;
  const credential = createHmac('sha1', turn.secret).update(username).digest('base64');
  return { iceServers: [{ urls: turn.urls, username, credential }], ttl: TURN_TTL };
}

// Who gets one. There are no accounts, so a password can't be kept from a determined person: anyone
// who opens the site gets one, and a script can ask like a browser does. What keeps the relay from
// being worth abusing is everywhere else: each password is only good for a few relays at a few
// Mbit/s, the server caps everything it relays, never relays into a private network, and is switched
// off past the month's data (aws/stun, lib/lightsail.mjs). Here:
// - only this site's pages get one (a browser always says which site is asking, and a page can't
//   change that), so another site can't put its visitors on our relay;
// - a few an hour per address (counted under a mark made from the address with the day's random
//   salt, kept an hour), and a ceiling for everyone, so a script can't collect thousands;
// - none while the relay is switched off, or once the month's data is nearly used.
// Each one asked for is counted (given, or why not) in the day's anonymous traffic counts.
export const TURN_LIMITS = { perAddressHour: 30, allHour: 3000 };
async function ice(req, deps, now) {
  const none = (why) => ({ status: 200, body: { iceServers: [], ttl: 0, ...(why ? { why } : {}) } });
  const t = deps.turn;
  if (!t?.secret || !t.urls?.length) return none();
  const count = async (k) => deps.store?.bumpTraffic?.(dayOf(now), { [`turn:${k}`]: 1 }).catch(() => {});
  const origin = String(req.headers?.origin || '');
  const allowed = t.origins || (deps.cdn ? [deps.cdn, deps.cdn.replace('://', '://www.')] : []);
  if (!allowed.includes(origin)) { await count('other_site'); return none('only for this site'); }
  if (deps.relayState) {
    const r = await deps.relayState().catch(() => null);
    if (r && !r.open) { await count('off'); return none('relay off'); }
    if (r && r.share >= (t.stopAt ?? 0.9)) { await count('budget'); return none("relay off for the rest of the month"); }
  }
  if (deps.store?.countUp) {
    const hour = Math.floor(now / 3600000), day = dayOf(now);
    const fp = sha256hex(`turn|${hour}|${req.ip || ''}|${await daySalt(deps.store, day)}`).slice(0, 24);
    const [mine, all] = await Promise.all([deps.store.countUp(`TURN#${hour}#${fp}`, 3600), deps.store.countUp(`TURN#${hour}#all`, 3600)]);
    if (mine > TURN_LIMITS.perAddressHour || all > TURN_LIMITS.allHour) { await count('limited'); return none('too many, try again later'); }
  }
  await count('given');
  return { status: 200, body: iceServers(t, now) };
}

const alive = (meta, now) => meta && !(meta.ttl && meta.ttl * 1000 < now);

async function route(req, deps) {
  const { store } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const seg = req.path.split('/').filter(Boolean);

  // ---- web traffic: a page view, or an event on a page (a film played). No cookies, nothing
  // stored about anyone: a visitor is counted once a day by a fingerprint (a salted hash of the
  // day, their address and browser) that's kept two days and never stored as it came.
  if (seg[0] === 'api') seg.shift();
  if (seg[0] === 'hit' && req.method === 'POST' && seg.length === 1) return hit(req, deps);   // (after the /api prefix is gone)
  if (seg[0] === 'ice' && req.method === 'GET' && seg.length === 1) return ice(req, deps, now);
  if (seg[0] === 'relay' && seg[1] === 'report' && req.method === 'POST' && seg.length === 2) return relayReport(req, deps, now);
  if (seg[0] === 'admin') return admin(req, seg.slice(1), deps, now);
  if (seg[0] === 'lan') return lan(req, seg.slice(1), deps, now);
  if (seg[0] !== 'events') throw new HttpError(404, 'Unknown endpoint');
  const m = req.method.toUpperCase();

  if (seg.length === 1 && m === 'POST') {
    if (req.body?.kind === 'call') return createCall(req, deps, now);
    return createEvent(req.body || {}, store, now, deps);
  }

  // (No location endpoints: VUEMesh never asks where anyone is, and there's no list or map of events.)

  const id = String(seg[1] || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(id)) throw new HttpError(400, 'Bad event code');
  const meta = await store.getEvent(id);
  if (!alive(meta, now)) throw new HttpError(404, 'No event with that code');

  // A call: may this device come in? (before it connects, so it can be told why not)
  if (seg[2] === 'enter' && m === 'POST' && meta.kind === 'call') {
    const r = await callEntry(meta, req.body || {}, deps, now);
    if (r.error) throw new HttpError(r.status, r.error);
    return { status: 200, body: { ok: true, waiting: !r.admitted } };
  }

  if (seg.length === 2 && m === 'GET') {
    return { status: 200, body: { ...publicEvent(meta), live: now - (meta.hostSeenAt || 0) < LIVE_WINDOW_MS } };
  }

  // (A kiosk show used to be named here by its first phone. Names stay on the devices now: the first
  // phone tells the kiosk over their own link, and the kiosk says that it's named with titled, below.)
  if (seg[2] === 'name' && m === 'POST') throw new HttpError(410, "Show names stay on the devices now: reload this page");

  // Everything below needs the host key.
  const key = req.headers['x-host-key'] || '';
  if (!key || sha256hex(key) !== meta.hostKeyHash) throw new HttpError(403, 'Host key required');

  if (seg[2] === 'host' && m === 'GET') return { status: 200, body: { ok: true } };

  // A local show's address (vuemesh-local.mjs on the studio's computer): <slug>.lan.vuemesh.com,
  // registered by a host (once; its secret is what lets it renew), so that it can get a certificate.
  if (seg[2] === 'lan' && m === 'POST') {
    if (!deps.lanDns) throw new HttpError(503, "Local show addresses aren't set up on this server");
    const slug = String(req.body?.slug || ''), token = String(req.body?.token || '');
    if (!/^[a-z0-9]{8,20}$/.test(slug) || token.length < 20) throw new HttpError(400, 'A name (8-20 letters and digits) and a secret');
    const rec = { slug, tokenHash: sha256hex(token), eventId: id, at: now };
    if (!(await store.putLanIfAbsent(rec))) {
      const had = await store.getLan(slug);
      if (had?.tokenHash !== rec.tokenHash) throw new HttpError(409, 'That name is taken');
    }
    return { status: 200, body: { name: `${slug}.${deps.lanDomain || 'lan.vuemesh.com'}` } };
  }

  // The host deletes the event now (a kiosk's "Delete show", or the host's own choice):
  // the event and any published film go; phones keep what they recorded.
  if (seg.length === 2 && m === 'DELETE') {
    const removed = deps.deleteFilms ? await deps.deleteFilms(`films/${id}/`).catch(() => 0) : 0;
    await store.deleteEvent(id);
    return { status: 200, body: { deleted: id, removedFilms: removed } };
  }

  if (seg.length === 2 && m === 'PATCH') {
    const b = req.body || {};
    const fields = {};
    if (b.orientation === 'portrait' || b.orientation === 'landscape') fields.orientation = b.orientation;
    if ('public' in b) {
      fields.public = !!b.public;
      fields.pub = b.public ? 'P' : null;
    }
    // a kiosk show its first phone has named (over their own link): that it has a name, never the name
    if (b.titled === true && meta.kiosk) fields.titled = true;
    // contributors the host removed and blocked (their random camera ids for this event)
    if ('blocked' in b) fields.blocked = (Array.isArray(b.blocked) ? b.blocked : []).map(String).filter((x) => /^[\w-]{4,80}$/.test(x)).slice(0, 500);
    const updated = await store.updateEvent(id, fields);
    return { status: 200, body: publicEvent(updated) };
  }

  // The studio's running totals for this event (recordings, footage, live cut and streaming
  // time). Only what's new since its last report is added to today's counts; the totals
  // themselves go when the event does.
  if (seg[2] === 'usage' && m === 'POST') {
    const b = req.body || {}, prev = meta.usage || {}, next = {}, add = {};
    // (no event records more footage than its devices could since it was made: a clip with a
    // nonsense length once added 83 days of footage in an afternoon)
    const elapsed = Math.max(60, (now - (meta.createdAt || now)) / 1000);
    const footageCap = elapsed * Math.max(16, 2 * (meta.joined?.length || 0));
    if (Number(b.footageSec) > footageCap) {
      console.warn(`usage: ${id} reported ${Math.round(b.footageSec)} s of footage; capped at ${Math.round(footageCap)}`);
      b.footageSec = footageCap;
    }
    for (const [k, stat] of [['clips', 'clips'], ['footageSec', 'footage_sec'], ['liveCutSec', 'live_cut_sec'], ['streamSec', 'stream_sec'], ['liveSec', 'studio_sec'], ['editSec', 'edit_sec'], ['kioskSec', 'kiosk_sec']]) {
      const v = Math.max(0, Math.min(1e7, Math.round(Number(b[k]) || 0)));
      next[k] = Math.max(v, prev[k] || 0);
      if (v > (prev[k] || 0)) add[stat] = v - (prev[k] || 0);
    }
    await store.updateEvent(id, { usage: next });
    await bump(deps, now, add);
    return { status: 200, body: { ok: true } };
  }

  if ((seg[2] === 'publish' || seg[2] === 'published') && !deps.flags?.publish) {
    throw new HttpError(403, 'Publishing is off during the beta. Export the film from the studio instead.');
  }

  if (seg[2] === 'publish' && m === 'POST') {
    const b = req.body || {};
    const ext = b.ext === 'webm' ? 'webm' : 'mp4';
    const stamp = now.toString(36);
    const filmKey = `films/${id}/${stamp}.${ext}`;
    const manifestKey = `films/${id}/${stamp}-manifest.json`;
    return {
      status: 200,
      body: {
        film: { put: await deps.presign(filmKey, ext === 'webm' ? 'video/webm' : 'video/mp4'), url: `${deps.cdn}/${filmKey}` },
        manifest: { put: await deps.presign(manifestKey, 'application/json'), url: `${deps.cdn}/${manifestKey}` },
      },
    };
  }

  if (seg[2] === 'published' && m === 'POST') {
    const b = req.body || {};
    const prefix = `${deps.cdn}/films/${id}/`;
    if (!String(b.filmUrl).startsWith(prefix) || !String(b.manifestUrl).startsWith(prefix)) throw new HttpError(400, 'Unexpected film location');
    const published = { filmUrl: b.filmUrl, manifestUrl: b.manifestUrl, publishedAt: now, title: String(b.title || 'Main cut').slice(0, 80) };
    // Everything, published or not, expires 30 days after the event was created.
    const updated = await store.updateEvent(id, { published });
    if (!meta.published) await bump(deps, now, { films: 1 });
    return { status: 200, body: publicEvent(updated) };
  }

  throw new HttpError(404, 'Unknown endpoint');
}

async function createEvent(body, store, now, deps) {
  const poolPct = 0; // (revenue sharing is off for now: whatever a client asks for, new events share none)
  // No name, whatever a client sends: a show's name stays on the devices (the host's browser has it,
  // and the studio tells the phones over their own links), so nothing anyone calls a show is kept
  // here. A kiosk show starts unnamed: its first phone names it, and the kiosk says it's named.
  const kind = String(body.kind || 'other').slice(0, 32);
  const terms = termsText({ kind });
  const isPublic = !!body.public;
  const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape';
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId(6);
    const hostKey = b64url(randomBytes(24));
    const meta = {
      id,
      kind,
      poolPct,
      terms,
      termsHash: sha256hex(terms),
      hostKeyHash: sha256hex(hostKey),
      public: isPublic,
      orientation,
      createdAt: now,
      ttl: Math.floor(now / 1000) + (body.kiosk ? KIOSK_TTL_HOURS * 3600 : EVENT_TTL_DAYS * DAY),
      ...(body.kiosk ? { kiosk: true, titled: false } : {}),
    };
    if (await store.putEventIfAbsent(meta)) {
      await bump(deps, now, { events: 1, events_public: isPublic ? 1 : 0, [`kind_${kindKey(kind)}`]: 1 });
      return { status: 200, body: { id, hostKey, termsHash: meta.termsHash } };
    }
  }
  throw new HttpError(500, 'Could not allocate an event code');
}

// ------------------------------------------------------------------- calls ---
// A call (/call): a few people on cameras and screens, everyone connected to everyone, no studio.
// Nobody gets in on the code alone, which a script could guess:
// - the link carries a room key after the # (the creator's browser made it; it never reaches any
//   server). Devices prove they have it with its hash (kh); this keeps only a hash of that.
// - typing the code needs the 6-digit PIN too; 10 wrong PINs and only the link opens it.
// - then a waiting room: someone already in lets each newcomer in (or the first to arrive, in an
//   empty call). A waiting device sees nobody and can only knock; its name rides on the knock and
//   isn't kept. Anyone in can let people in, take them out (and keep them out), and lock the call.
// - let in once, a device comes back after a dropped connection without waiting again: it proves
//   that with a pass it made itself (this keeps the pass's hash, ph).
// Nothing about anyone is kept: no names, the media never comes here, and a call deletes itself a
// day after it's made.
// A studio in a call (it proves it's one with its show's host key) can't be taken out by anyone.
// One a studio started is the studio's to run while it's in it: only it lets people in, takes them
// out, or locks it (anyone can still leave). In a call a studio joined, the people in it keep those
// between themselves. With the studio gone from a call it started, they're everyone's again.
export const CALL = { maxIn: 6, maxWaiting: 4, pinTries: 10, perAddressHour: 20, ttlHours: 24 };
const isHex64 = (s) => /^[0-9a-f]{64}$/.test(String(s || ''));

/** Is this a studio? Its show's code and host key (sk), checked like the studio's own connection */
async function isStudio(store, show, sk, now) {
  const id = String(show || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(id) || !sk) return false;
  const ev = await store.getEvent(id);
  return !!(alive(ev, now) && ev.kind !== 'call' && sha256hex(String(sk)) === ev.hostKeyHash);
}

async function createCall(req, deps, now) {
  const { store } = deps;
  const b = req.body || {};
  const byStudio = await isStudio(store, b.show, b.sk, now);
  if (!isHex64(b.kh)) throw new HttpError(400, "A call needs its room key's hash (kh)");
  if (store.countUp) {
    const hour = Math.floor(now / 3600000);
    const fp = sha256hex(`call|${hour}|${req.ip || ''}|${await daySalt(store, dayOf(now))}`).slice(0, 24);
    if ((await store.countUp(`CALL#${hour}#${fp}`, 3600)) > CALL.perAddressHour) throw new HttpError(429, 'Too many calls started from here: try again in an hour');
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId(6);
    const hostKey = b64url(randomBytes(24));
    const pin = String(randomInt(0, 1000000)).padStart(6, '0');
    const terms = 'A call: what you send goes to the others in it, directly, and nothing is recorded unless someone in the call records it.';
    const meta = {
      id, kind: 'call', terms, termsHash: sha256hex(terms), hostKeyHash: sha256hex(hostKey),
      keyCheck: sha256hex(String(b.kh)), pinHash: sha256hex(`${id}|${pin}`), pinFails: 0, passes: [], locked: false, ...(byStudio ? { byStudio: true } : {}),
      orientation: 'landscape', createdAt: now, ttl: Math.floor(now / 1000) + CALL.ttlHours * 3600,
    };
    if (await store.putEventIfAbsent(meta)) {
      await bump(deps, now, { calls: 1 });
      return { status: 200, body: { id, hostKey, pin } };
    }
  }
  throw new HttpError(500, 'Could not allocate a call code');
}

/**
 * May this device come into the call, and straight in or to wait? Shared by /enter (which says why
 * not) and the WebSocket's $connect (which checks again: a device could skip /enter).
 * @param c {kh?, pin?, pass?, k?, cid?} the room key's hash, the PIN, its own pass, the host key, its camera id
 * @returns {{admitted: boolean} | {status: number, error: string}}
 */
async function callEntry(meta, c, deps, now) {
  const { store } = deps;
  const conns = (await store.listConns(meta.id)).filter((x) => now - (x.seenAt || 0) < STALE_MS);
  const inside = conns.filter((x) => !x.waiting);
  if (c.cid && (meta.blocked || []).includes(String(c.cid))) return { status: 403, error: 'You were taken out of this call' };
  const back = c.pass && (meta.passes || []).includes(sha256hex(String(c.pass)));
  const host = c.k && sha256hex(String(c.k)) === meta.hostKeyHash;
  if (!back && !host) {
    if (meta.locked) return { status: 423, error: 'This call is locked: nobody new can come in' };
    if (c.kh) {
      if (sha256hex(String(c.kh)) !== meta.keyCheck) return { status: 403, error: "That link isn't right for this call" };
    } else if (c.pin) {
      if ((meta.pinFails || 0) >= CALL.pinTries) return { status: 429, error: 'Too many wrong PINs: ask for the link instead' };
      if (sha256hex(`${meta.id}|${String(c.pin).replace(/\D/g, '')}`) !== meta.pinHash) {
        await store.updateEvent(meta.id, { pinFails: (meta.pinFails || 0) + 1 });
        return { status: 403, error: 'Wrong code or PIN' };
      }
    } else return { status: 403, error: 'This call needs its link, or its code and PIN' };
  }
  const admitted = back || host || !inside.length; // (the first into an empty call doesn't wait)
  if (admitted && inside.length >= CALL.maxIn) return { status: 409, error: `This call is full (${CALL.maxIn} people)` };
  if (!admitted && conns.length - inside.length >= CALL.maxWaiting) return { status: 409, error: 'Too many people are waiting to come in: try again in a minute' };
  return { admitted };
}

/** Let a waiting device's pass in for good (it comes back after a dropped connection without waiting) */
const keepPass = (meta, ph) => (isHex64(ph) && !(meta.passes || []).includes(ph) ? [...(meta.passes || []), ph].slice(-50) : meta.passes || []);

// ----------------------------------------------------------------- traffic ---

const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|httpclient|java\//i;
const deviceOf = (ua) => (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)) ? 'tablet' : /mobi|iphone|ipod|android/i.test(ua) ? 'mobile' : 'desktop');
const browserOf = (ua) => (/edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /samsungbrowser/i.test(ua) ? 'Samsung Internet' : /firefox|fxios/i.test(ua) ? 'Firefox'
  : /chrome|crios|chromium/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Other');
const pageOf = (p) => {
  const path = String(p || '/').split(/[?#]/)[0].replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/+$/, '$1').toLowerCase();
  return /^\/[a-z0-9-]{0,24}$/.test(path) ? path : '/other';
};
const refOf = (r) => {
  try {
    const host = new URL(String(r)).hostname.replace(/^www\./, '').toLowerCase();
    return host && host.length <= 60 ? host : null;
  } catch {
    return null;
  }
};
// A random salt for each day, kept two days like the visitor marks, then gone: once it's deleted
// nobody (the maintainer included) can recompute a visitor's mark from an address.
let localSalt = null;
async function daySalt(store, day) {
  if (store.daySalt) return store.daySalt(day, b64url(randomBytes(24)));
  if (!localSalt || localSalt.day !== day) localSalt = { day, salt: b64url(randomBytes(24)) };
  return localSalt.salt;
}
async function hit(req, deps) {
  const ok = { status: 200, body: { ok: true } };
  const b = req.body || {}, h = req.headers || {}, ua = String(h['user-agent'] || '');
  const store = deps.store, now = deps.now?.() ?? Date.now();
  if (!store?.bumpTraffic || !ua || BOTS.test(ua)) return ok;
  const page = pageOf(b.p);
  if (page === '/admin') return ok;   // (the admin's own visits aren't traffic)
  const day = dayOf(now), c = {};
  const ev = String(b.ev || '').toLowerCase().replace(/[^a-z0-9_:-]/g, '').slice(0, 40);
  if (ev) {
    c[`ev:${ev}`] = 1;
  } else {
    c.pageviews = 1;
    c[`page:${page}`] = 1;
    const ref = refOf(b.r), own = String(h.host || '').replace(/^www\./, '').split(':')[0];
    if (!ref) c['ref:(direct)'] = 1;
    else if (ref !== own && !ref.endsWith('vuemesh.com')) c[`ref:${ref}`] = 1;
    const utm = String(b.u || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
    if (utm) c[`utm:${utm}`] = 1;
    const fp = sha256hex(`${day}|${req.ip || ''}|${ua}|${await daySalt(store, day)}`).slice(0, 24);
    if (await store.markOnce(`VIS#${day}#${fp}`).catch(() => false)) {
      // a new visitor today: what they came on, and from where (country, if the edge says so)
      c.visitors = 1;
      c[`dev:${deviceOf(ua)}`] = 1;
      c[`br:${browserOf(ua)}`] = 1;
      const country = String(h['cloudfront-viewer-country'] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
      if (country) c[`ctry:${country}`] = 1;
      c[`land:${page}`] = 1;
    }
  }
  try {
    await store.bumpTraffic(day, c);
  } catch (e) {
    console.warn('traffic: not kept', e.message); // (counting never gets in the way)
  }
  return ok;
}

// ------------------------------------------------------------------ growth ---
// Usage numbers for the record (and for investors) without keeping anyone's data. Each day
// gets one record of anonymous counts: events made, events whose studio opened, cameras,
// microphones and viewers that joined, recordings and footage, live cut and streaming time,
// films published. Events, and everything in them, still delete themselves after 30 days;
// the day counts stay, and nothing in them points to a person, a phone or an event.
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const kindKey = (k) => String(k || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) || 'other';
async function bump(deps, now, counts) {
  const c = {};
  for (const [k, v] of Object.entries(counts || {})) if (Number.isFinite(v) && v > 0) c[k] = Math.round(v);
  if (!Object.keys(c).length || !deps?.store?.bumpStats) return;
  try {
    await deps.store.bumpStats(dayOf(now), c);
  } catch (e) {
    console.warn('growth: count not kept', e.message); // (counting never gets in the way)
  }
}


// ------------------------------------------------------------ WebSocket API ---

/**
 * @param {{route:string, connectionId:string, query?:object, body?:string}} evt
 * @param {{store:object, post:(connId:string, data:object)=>Promise<boolean>, now?:()=>number}} deps
 * post() resolves false when the connection is gone.
 */
export async function signal(evt, deps) {
  const { store } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const conn = evt.connectionId;

  if (evt.route === '$connect') {
    const q = evt.query || {};
    const eventId = String(q.e || '').toUpperCase();
    const meta = /^[A-Z0-9]{6}$/.test(eventId) ? await store.getEvent(eventId) : null;
    if (!alive(meta, now)) return { status: 404 };
    if (meta.kind === 'call') return callConnect(meta, q, conn, deps, now);
    // (a remote: a phone the studio paired to control the show; it proves itself to the studio, not here)
    // (a display: a TV the studio shows its program on, the Apple TV app or /tv; it's let in by the studio, not here)
    const role = ['host', 'cam', 'mic', 'beacon', 'viewer', 'remote', 'display'].includes(q.role) ? q.role : 'viewer';
    if (role === 'host' && sha256hex(String(q.k || '')) !== meta.hostKeyHash) return { status: 403 };
    // a camera or microphone the host removed and blocked can't come back into this event
    if (role !== 'host' && q.cid && (meta.blocked || []).includes(String(q.cid))) return { status: 403 };
    // Today's counts: a camera, microphone or viewer the first time it joins this event (by a
    // hash kept on the event, which goes when the event does), and the event itself the first
    // time its studio opens each day. Nothing about who.
    const counts = {}, fields = {};
    // (a computer's screen from /share joins as a camera, and is counted as a screen shared)
    const screen = role === 'cam' && q.src === 'screen';
    const stat = screen ? 'screens' : { cam: 'cameras', mic: 'mics', viewer: 'viewers', display: 'displays' }[role];
    if (stat) {
      // (by the phone's camera id for this event, which survives a reload; else this connection's)
      const tag = `${screen ? 'screen' : role}:${sha256hex(String(q.cid || q.peer || conn)).slice(0, 16)}`, joined = meta.joined || [];
      if (!joined.includes(tag) && joined.length < 2000) {
        fields.joined = [...joined, tag];
        counts[stat] = 1;
      }
    }
    if (role === 'host') {
      fields.hostSeenAt = now;
      if (meta.activeDay !== dayOf(now)) {
        fields.activeDay = dayOf(now);
        counts.active_events = 1;
      }
    }
    if (Object.keys(fields).length) await store.updateEvent(eventId, fields);
    await bump(deps, now, counts);
    await store.addConn(eventId, conn, {
      peer: String(q.peer || conn).slice(0, 40),
      role,
      name: String(q.name || '').slice(0, 40),
      cid: String(q.cid || '').slice(0, 32),
      rec: false,
      seenAt: now,
      at: now,
      ttl: Math.floor(now / 1000) + DAY,
    });
    await broadcastPeers(eventId, deps, conn, role === 'host');
    return { status: 200 };
  }

  if (evt.route === '$disconnect') {
    const eventId = await store.getConnEvent(conn);
    if (eventId) {
      const gone = (await store.listConns(eventId)).find((c) => c.connId === conn);
      await store.removeConn(eventId, conn);
      // how long a camera (or microphone) was here: counted on the event and the day
      if (gone && (gone.role === 'cam' || gone.role === 'mic') && gone.at) {
        const sec = Math.max(0, Math.min(86400, Math.round(((deps.now?.() ?? Date.now()) - gone.at) / 1000)));
        if (sec) {
          const meta = await store.getEvent(eventId);
          if (meta) await store.updateEvent(eventId, { camSec: (meta.camSec || 0) + sec });
          await bump(deps, deps.now?.() ?? Date.now(), { camera_sec: sec });
        }
      }
      // and how long a TV watched (the /tv page or the Apple TV app): counted on the day only
      if (gone && gone.role === 'display' && gone.at) {
        const sec = Math.max(0, Math.min(86400, Math.round(((deps.now?.() ?? Date.now()) - gone.at) / 1000)));
        if (sec) await bump(deps, deps.now?.() ?? Date.now(), { display_sec: sec });
      }
      if (gone?.call) await broadcastCall(eventId, deps);
      else await broadcastPeers(eventId, deps, undefined, gone?.role === 'host');
    }
    return { status: 200 };
  }

  // $default: JSON messages from connected clients
  let msg;
  try {
    msg = JSON.parse(evt.body || '{}');
  } catch {
    return { status: 400 };
  }
  // A connection this side has no record of (it was taken for gone) is told to connect again: else it
  // would think it's here while nobody can reach it, and the phones would wait for it forever.
  const eventId = await store.getConnEvent(conn);
  if (!eventId) {
    await deps.post(conn, { type: 'rejoin' });
    return { status: 410 };
  }
  const peers = await store.listConns(eventId);
  const me = peers.find((p) => p.connId === conn);
  if (!me) {
    await deps.post(conn, { type: 'rejoin' });
    return { status: 410 };
  }
  if (me.role === 'guest' || me.call) return callMessage(eventId, msg, me, peers, conn, deps, now);

  switch (msg.action) {
    case 'hello':
      await store.updateConn(eventId, conn, { seenAt: now });
      // (pong: this server answers a ping, so a page can tell a connection that's gone quiet from one that's fine)
      await deps.post(conn, { type: 'peers', you: me.peer, peers: peerList(peers, now), pong: true });
      if (me.role === 'host') await store.updateEvent(eventId, { hostSeenAt: now });
      break;
    case 'status':
      await store.updateConn(eventId, conn, { rec: !!msg.rec, seenAt: now });
      await broadcastPeers(eventId, deps, undefined, false);
      break;
    case 'signal': {
      // Relay a WebRTC message to one peer. Phones may only talk to hosts and
      // hosts may talk to anyone, so guests can't message each other.
      // (the newest connection of that peer: one that just reconnected can sit beside its old one a moment)
      const target = peers.filter((p) => p.peer === msg.to).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
      if (!target) break;
      if (me.role !== 'host' && target.role !== 'host') break;
      const ok = await deps.post(target.connId, { type: 'signal', from: me.peer, fromRole: me.role, data: msg.data });
      if (!ok && settled(target, now)) await store.removeConn(eventId, target.connId);
      break;
    }
    case 'ping':
      await store.updateConn(eventId, conn, { seenAt: now });
      if (me.role === 'host') await store.updateEvent(eventId, { hostSeenAt: now });
      await deps.post(conn, { type: 'pong' });
      break;
    default:
      break;
  }
  return { status: 200 };
}

// A person in a call, counted once per call however often their connection drops and comes back:
// by a one-way code of their device's random ID, kept on the call (and deleted with it, after a
// day). Counted when they're in, not while they wait. Nothing about who.
// A screen shared in a call is counted the same way, once per device per call (call_screens).
async function countCallOnce(meta, what, id, deps, now) {
  const [field, stat] = what === 'screen' ? ['callScreens', 'call_screens'] : ['callJoined', 'call_people'];
  const tag = sha256hex(`call${what === 'screen' ? 's' : 'p'}|${id}`).slice(0, 16), joined = meta[field] || [];
  if (joined.includes(tag) || joined.length >= 200) return;
  meta[field] = [...joined, tag];
  await deps.store.updateEvent(meta.id, { [field]: meta[field] });
  await bump(deps, now, { [stat]: 1 });
}
const countCallPerson = (meta, id, deps, now) => countCallOnce(meta, 'person', id, deps, now);

// ---- a call's connections: everyone in it talks to everyone; a waiting device only knocks
async function callConnect(meta, q, conn, deps, now) {
  const role = q.role === 'host' ? 'host' : 'guest';
  if (role === 'host' && sha256hex(String(q.k || '')) !== meta.hostKeyHash) return { status: 403 };
  const r = await callEntry(meta, { kh: q.kh, pin: q.pin, pass: q.pass, k: role === 'host' ? q.k : '', cid: q.cid }, deps, now);
  if (r.error) return { status: r.status };
  const ph = isHex64(q.ph) ? String(q.ph) : '';
  if (r.admitted && ph) await deps.store.updateEvent(meta.id, { passes: keepPass(meta, ph) });
  await deps.store.addConn(meta.id, conn, {
    peer: String(q.peer || conn).slice(0, 40), role, call: true, waiting: !r.admitted, ph,
    ...((await isStudio(deps.store, q.show, q.sk, now)) ? { studio: true } : {}),
    name: '', // (no names here: they go between the devices, and with a knock, never kept)
    cid: String(q.cid || '').slice(0, 32), rec: false, seenAt: now, at: now, ttl: Math.floor(now / 1000) + DAY,
  });
  await bump(deps, now, { call_joins: 1 });
  if (r.admitted) await countCallPerson(meta, q.cid || q.peer || conn, deps, now);
  await broadcastCall(meta.id, deps, conn);
  return { status: 200 };
}

async function callMessage(eventId, msg, me, peers, conn, deps, now) {
  const { store } = deps;
  const fresh = peers.filter((p) => now - (p.seenAt || 0) < STALE_MS);
  const target = msg.to || msg.peer ? fresh.filter((p) => p.peer === (msg.to || msg.peer)).sort((a, b) => (b.at || 0) - (a.at || 0))[0] : null;
  const tell = async (c, data) => {
    const ok = await deps.post(c.connId, data);
    if (!ok && settled(c, now)) await store.removeConn(eventId, c.connId);
  };
  const inside = fresh.filter((p) => !p.waiting);
  // (who may: see the top of calls. A studio's call while it's in it is the studio's to run)
  const ruledFor = async () => !me.studio && inside.some((c) => c.studio) && !!(await store.getEvent(eventId))?.byStudio;
  const refuse = (why) => deps.post(conn, { type: 'refused', why });
  switch (msg.action) {
    case 'hello':
    case 'ping':
      await store.updateConn(eventId, conn, { seenAt: now });
      await deps.post(conn, me.waiting
        ? { type: 'peers', you: me.peer, peers: [], waiting: true, pong: true }
        : await (async () => { const meta = await store.getEvent(eventId); return { type: 'peers', you: me.peer, peers: callPeers(fresh), pong: true, locked: !!meta?.locked, studioRules: studioRules(meta, fresh) }; })());
      break;
    case 'knock': // (a waiting device says who it is to the people in the call; the name isn't kept)
      if (!me.waiting) break;
      await Promise.all(inside.map((c) => tell(c, { type: 'knock', from: me.peer, name: String(msg.name || '').trim().slice(0, 40) })));
      break;
    case 'signal': // (only between people in the call)
      if (me.waiting || !target || target.waiting) break;
      await tell(target, { type: 'signal', from: me.peer, fromRole: me.role, data: msg.data });
      break;
    case 'screen': { // (sharing a screen in the call: counted once per device per call)
      if (me.waiting) break;
      const meta = await store.getEvent(eventId);
      if (meta) await countCallOnce(meta, 'screen', me.cid || me.peer, deps, now);
      break;
    }
    case 'admit': {
      if (me.waiting || !target?.waiting) break;
      if (await ruledFor()) { await refuse('The studio lets people into this call'); break; }
      const meta = await store.getEvent(eventId);
      if (inside.length >= CALL.maxIn) {
        await deps.post(conn, { type: 'full' });
        break;
      }
      await store.updateConn(eventId, target.connId, { waiting: false });
      if (target.ph) await store.updateEvent(eventId, { passes: keepPass(meta, target.ph) });
      await countCallPerson(meta, target.cid || target.peer || target.connId, deps, now);
      await tell(target, { type: 'admitted', by: me.peer });
      await broadcastCall(eventId, deps);
      break;
    }
    case 'remove': { // (out of the call; with block, kept out: its camera id, and its pass forgotten)
      if (me.waiting || !target || target.peer === me.peer) break;
      if (target.studio) { await refuse('Nobody can take the studio out of the call'); break; }
      if (await ruledFor()) { await refuse('Only the studio takes people out of this call'); break; }
      const meta = await store.getEvent(eventId);
      const fields = { passes: (meta.passes || []).filter((h) => h !== target.ph) };
      if (msg.block && target.cid) fields.blocked = [...new Set([...(meta.blocked || []), target.cid])].slice(-500);
      await store.updateEvent(eventId, fields);
      await tell(target, { type: 'removed', block: !!msg.block });
      for (const c of peers.filter((p) => p.peer === target.peer)) await store.removeConn(eventId, c.connId);
      await broadcastCall(eventId, deps);
      break;
    }
    case 'leave': // (said just before closing: everyone hears at once, not when the connection's noticed gone)
      for (const c of peers.filter((p) => p.peer === me.peer)) await store.removeConn(eventId, c.connId);
      await Promise.all(inside.filter((c) => c.peer !== me.peer).map((c) => tell(c, { type: 'left', peer: me.peer })));
      await broadcastCall(eventId, deps);
      break;
    case 'lock':
      if (me.waiting) break;
      if (await ruledFor()) { await refuse('Only the studio locks this call'); break; }
      await store.updateEvent(eventId, { locked: !!msg.on });
      await Promise.all(fresh.map((c) => tell(c, { type: 'locked', on: !!msg.on, by: me.peer })));
      break;
    default:
      break;
  }
  return { status: 200 };
}

/** Who's in a call (and who's waiting, without names: those come with their knock) */
const callPeers = (conns) => conns.map((c) => ({ peer: c.peer, role: c.role, waiting: !!c.waiting, ...(c.studio ? { studio: true } : {}) }));
/** Is the studio running this call now (one it started, while it's in it)? Said with each list, so pages show who may do what */
const studioRules = (meta, conns) => !!meta?.byStudio && conns.some((c) => c.studio && !c.waiting);
/** Everyone in a call hears who's in it; a waiting device hears only that it's waiting */
async function broadcastCall(eventId, deps, skipConn) {
  const now = deps.now ? deps.now() : Date.now();
  const conns = (await deps.store.listConns(eventId)).filter((c) => now - (c.seenAt || 0) < STALE_MS);
  const peers = callPeers(conns), ruled = studioRules(await deps.store.getEvent(eventId), conns);
  await Promise.all(conns.map(async (c) => {
    if (c.connId === skipConn) return; // (can't post during $connect: it says hello instead)
    const ok = await deps.post(c.connId, c.waiting ? { type: 'peers', you: c.peer, peers: [], waiting: true } : { type: 'peers', you: c.peer, peers, studioRules: ruled });
    if (!ok && settled(c, now)) await deps.store.removeConn(eventId, c.connId);
  }));
}

// Connections ping every 4 minutes (a studio every 30 s); API Gateway drops idle ones at 10. Anything
// quiet for longer than that is a ghost (a phone that vanished without a clean
// disconnect) and is left out of the list.
const STALE_MS = 11 * 60 * 1000;
// A message that can't be delivered usually means the connection is gone, and it's taken off the list.
// Not a brand-new one: AWS won't deliver to a connection until its connecting has finished, and the
// phones answer a studio that's just reconnected faster than that. Taking it off then left a studio
// that thought it was connected, which no phone could reach (after AWS's two-hour cut, 0.63.3).
const SETTLE_MS = 15 * 1000;
const settled = (c, now) => now - (c.at || 0) > SETTLE_MS;
function peerList(conns, now = Date.now()) {
  return conns.filter((c) => now - (c.seenAt || 0) < STALE_MS).map((c) => ({ peer: c.peer, role: c.role, name: c.name, cid: c.cid, rec: !!c.rec }));
}

// Who needs to hear about a change? Phones only care whether the host is here,
// so a phone starting or stopping a recording only notifies the host, the beacon and TVs
// (a TV, like the beacon, shows who's here).
// That keeps message cost linear in the number of phones instead of quadratic.
async function broadcastPeers(eventId, deps, skipConn, toEveryone = false) {
  const now = deps.now ? deps.now() : Date.now();
  const conns = await deps.store.listConns(eventId);
  const peers = peerList(conns, now);
  await Promise.all(
    conns.map(async (c) => {
      if (c.connId === skipConn) return; // can't post during $connect; it says hello instead
      if (!toEveryone && c.role !== 'host' && c.role !== 'beacon' && c.role !== 'display') return;
      const ok = await deps.post(c.connId, { type: 'peers', you: c.peer, peers });
      if (!ok && settled(c, now)) await deps.store.removeConn(eventId, c.connId);
    }),
  );
}

// ------------------------------------------------------------- local shows ---
// Let's Encrypt checks a record in the name's DNS before it gives a certificate for it. Only the one
// that registered the name (with its secret) can put that record in, and only that record.
async function lan(req, seg, deps) {
  if (!deps.lanDns) throw new HttpError(503, "Local show addresses aren't set up on this server");
  const slug = String(seg[0] || '');
  if (!/^[a-z0-9]{8,20}$/.test(slug) || seg[1] !== 'txt' || seg.length !== 2) throw new HttpError(404, 'Unknown endpoint');
  const rec = await deps.store.getLan(slug);
  if (!rec || rec.tokenHash !== sha256hex(String(req.body?.token || ''))) throw new HttpError(403, 'Not your name');
  const record = `_acme-challenge.${slug}.${deps.lanDomain || 'lan.vuemesh.com'}`;
  if (req.method === 'PUT') {
    const value = String(req.body?.value || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(400, 'Not a certificate check');
    await deps.lanDns.setTxt(record, value);
    return { status: 200, body: { ok: true, record } };
  }
  if (req.method === 'DELETE') {
    await deps.lanDns.clearTxt(record);
    return { status: 200, body: { ok: true } };
  }
  throw new HttpError(405, 'PUT or DELETE');
}

// ------------------------------------------------------------- relay report ---
// The relay server (aws/stun) reports every minute, signed with the TURN secret: what it counted
// since the last report (relays started, data relayed, what it turned away) and how many relays
// are open. Counts only, into the day's anonymous traffic counts: no addresses ever come here.
// The answer tells it whether Admin's troubleshooting log is on, and until when.
export const RELAY_COUNTS = ['started', 'bad_password', 'forbidden', 'tcp', 'full', 'errors', 'flood', 'self', 'bytes_in', 'bytes_out', 'relay_min'];
export const RELAY_LOG_MAX_HOURS = 24;
export function relaySig(secret, at, raw) {
  return createHmac('sha256', `vuemesh-relay-report|${secret}`).update(`${at}.${raw}`).digest('hex');
}
async function relayReport(req, deps, now) {
  const secret = deps.turn?.secret;
  if (!secret) throw new HttpError(404, 'No relay here');
  const raw = typeof req.raw === 'string' ? req.raw : '', b = req.body || {}, at = Number(b.at);
  const sig = String(req.headers?.['x-relay-sig'] || '');
  const want = relaySig(secret, at, raw);
  if (!raw || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) throw new HttpError(403, 'Not signed by the relay');
  if (!Number.isFinite(at) || Math.abs(now - at) > 5 * 60_000) throw new HttpError(400, 'Too old (or this clock is off)');
  const { store } = deps;
  if (store.markOnce && !(await store.markOnce(`RELAYREP#${at}`))) throw new HttpError(409, 'Already counted');
  const counts = {};
  for (const k of RELAY_COUNTS) {
    const v = Number(b.counts?.[k]);
    if (Number.isFinite(v) && v > 0) counts[`relay:${k}`] = Math.round(Math.min(v, 1e13));
  }
  const day = dayOf(now), hour = new Date(now).toISOString().slice(11, 13);
  if (counts['relay:relay_min']) counts[`relayh:${hour}:min`] = counts['relay:relay_min'];
  const bytes = (counts['relay:bytes_in'] || 0) + (counts['relay:bytes_out'] || 0);
  if (bytes) counts[`relayh:${hour}:bytes`] = bytes;
  if (counts['relay:started']) counts[`relayh:${hour}:started`] = counts['relay:started'];
  const peak = Math.round(Number(b.peak));
  await Promise.all([
    Object.keys(counts).length && store.bumpTraffic?.(day, counts),
    peak > 0 && store.maxTraffic?.(day, { 'relay:peak': peak, [`relayh:${hour}:peak`]: peak }),
    store.setFlag?.('relayReport', { at: now, open: Math.max(0, Math.round(Number(b.open)) || 0), v: String(b.v || '').slice(0, 20) }),
  ]);
  const log = (await store.getFlag?.('relayLog')) || {};
  return { status: 200, body: { logUntil: log.until > now ? log.until : 0 } };
}

// ------------------------------------------------------------------- admin ---
// For you (and anyone you give a key): look at, change, or delete anything in
// the cloud without opening DynamoDB or S3. Keys are checked against SHA-256
// hashes set at deploy time; the keys themselves never leave your machine.

async function admin(req, seg, deps, now) {
  const hashes = deps.adminKeyHashes || [];
  if (!hashes.length) throw new HttpError(503, 'Admin is not set up. Deploy with an admin key (see aws/README.md).');
  const key = req.headers['x-admin-key'] || '';
  if (!key || !hashes.includes(sha256hex(key))) throw new HttpError(403, 'Admin key not recognised');
  const { store } = deps;
  const m = req.method.toUpperCase();
  const view = (e) => ({
    ...publicEvent(e), expiresAt: e.ttl ? e.ttl * 1000 : null, live: now - (e.hostSeenAt || 0) < LIVE_WINDOW_MS,
    // where it ran, and the time used on each part (seconds): the studio live, editing, a kiosk, and the phones
    surface: e.kiosk ? 'kiosk' : 'studio',
    time: { studio: e.usage?.liveSec || 0, edit: e.usage?.editSec || 0, kiosk: e.usage?.kioskSec || 0, cameras: e.camSec || 0 },
  });

  if (seg[0] === 'whoami' && m === 'GET') return { status: 200, body: { ok: true } };

  // The Lightsail servers (aws/stun): health, the month's data, and the relay's switch
  if (seg[0] === 'servers' && m === 'GET') {
    if (!deps.servers) return { status: 200, body: { servers: [], note: 'No Lightsail access on this server' } };
    const [servers, report, log] = await Promise.all([deps.servers.status(now), store.getFlag?.('relayReport'), store.getFlag?.('relayLog')]);
    return { status: 200, body: { servers, limits: TURN_LIMITS, relayReport: report || null, relayLog: log?.until > now ? log : null } };
  }
  // The relay's troubleshooting log: its own log, addresses and all, written to the server's memory
  // (never its disk, never sent here) for up to a day, then deleted. Off by default.
  if (seg[0] === 'relay-log' && m === 'POST') {
    const hours = Number(req.body?.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > RELAY_LOG_MAX_HOURS) throw new HttpError(400, `hours: 0 (off) to ${RELAY_LOG_MAX_HOURS}`);
    const log = hours ? { until: now + Math.round(hours * 3600_000), since: now } : { until: 0 };
    await store.setFlag('relayLog', log);
    return { status: 200, body: { relayLog: log.until ? log : null } };
  }
  if (seg[0] === 'relay' && m === 'POST') {
    if (!deps.servers) throw new HttpError(503, 'No Lightsail access on this server');
    if (typeof req.body?.open !== 'boolean') throw new HttpError(400, 'open: true or false');
    return { status: 200, body: await deps.servers.setRelay(req.body.open) };
  }

  if (seg[0] === 'stats' && m === 'GET') {
    let cursor, events = 0, live = 0, pub = 0, published = 0;
    do {
      const page = await store.scanEvents(cursor, 200);
      for (const e of page.items) {
        events++;
        if (now - (e.hostSeenAt || 0) < LIVE_WINDOW_MS) live++;
        if (e.public) pub++;
        if (e.published) published++;
      }
      cursor = page.next;
    } while (cursor);
    const films = deps.listFilms ? await deps.listFilms('films/') : [];
    return { status: 200, body: { events, live, public: pub, published, films: films.length, filmBytes: films.reduce((s, f) => s + (f.size || 0), 0) } };
  }

  // ---- growth: the day counts, a backfill for days before counting began, saved snapshots
  if (seg[0] === 'growth') {
    const q = req.query || {}, isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (seg.length === 1 && m === 'GET') {
      const to = isDay(q.to) ? q.to : dayOf(now), from = isDay(q.from) ? q.from : dayOf(now - 730 * 86400000);
      return { status: 200, body: { from, to, days: await store.listStats(from, to) } };
    }
    if (seg[1] === 'backfill' && m === 'POST') {
      // events still here (the last 30 days) counted into days that have no counts yet
      const byDay = new Map();
      let cursor;
      do {
        const page = await store.scanEvents(cursor, 200);
        for (const e of page.items) {
          const d = dayOf(e.createdAt || now);
          const c = byDay.get(d) || { events: 0, events_public: 0, backfilled: 1 };
          c.events++;
          if (e.public) c.events_public++;
          const k = `kind_${kindKey(e.kind)}`;
          c[k] = (c[k] || 0) + 1;
          byDay.set(d, c);
        }
        cursor = page.next;
      } while (cursor);
      let filled = 0;
      for (const [d, c] of byDay) if (d < dayOf(now) && (await store.putStatsIfAbsent(d, c))) filled++;
      return { status: 200, body: { filled, days: byDay.size } };
    }
    if (seg[1] === 'snapshots' && m === 'GET') return { status: 200, body: { snapshots: await store.listSnapshots() } };
    // Correct one day's count (a count that's plainly wrong, kept from an old bug): the value
    // that was there is kept beside it, so the correction can be seen and undone.
    if (seg[1] === 'fix' && m === 'POST') {
      const b = req.body || {};
      const key = String(b.key || ''), value = Number(b.value);
      if (!isDay(b.day) || !/^[a-z_]{2,30}$/.test(key) || !Number.isFinite(value) || value < 0) throw new HttpError(400, 'A day, a count and a value (0 or more)');
      const before = (await store.listStats(b.day, b.day))[0] || {};
      if (before[`was_${key}`] === undefined && before[key] !== undefined) await store.setStat(b.day, `was_${key}`, before[key]);
      const after = await store.setStat(b.day, key, Math.round(value));
      return { status: 200, body: { day: b.day, key, was: before[key] ?? 0, now: after[key] } };
    }
    if (seg[1] === 'snapshots' && m === 'POST') {
      const b = req.body || {};
      const snap = { at: new Date(now).toISOString(), label: String(b.label || 'Snapshot').slice(0, 120), from: String(b.from || '').slice(0, 10), to: String(b.to || '').slice(0, 10), summary: b.summary || {}, days: Array.isArray(b.days) ? b.days.slice(0, 800) : [] };
      if (JSON.stringify(snap).length > 300000) throw new HttpError(413, 'Snapshot too large');
      await store.putSnapshot(snap);
      return { status: 200, body: { ok: true, at: snap.at } };
    }
    throw new HttpError(404, 'Unknown admin endpoint');
  }

  if (seg[0] === 'traffic' && m === 'GET') {
    const q = req.query || {}, isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    const to = isDay(q.to) ? q.to : dayOf(now), from = isDay(q.from) ? q.from : dayOf(now - 90 * 86400000);
    return { status: 200, body: { from, to, days: store.listTraffic ? await store.listTraffic(from, to) : [] } };
  }

  if (seg[0] !== 'events') throw new HttpError(404, 'Unknown admin endpoint');

  if (seg.length === 1 && m === 'GET') {
    const page = await store.scanEvents(req.query.cursor || undefined, Math.min(100, Number(req.query.limit) || 50));
    return { status: 200, body: { events: page.items.map(view).sort((a, b) => b.createdAt - a.createdAt), next: page.next || null } };
  }

  const id = String(seg[1] || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(id)) throw new HttpError(400, 'Bad event code');
  const meta = await store.getEvent(id);
  if (!meta) throw new HttpError(404, 'No event with that code');
  const prefix = `films/${id}/`;

  if (seg.length === 2 && m === 'GET') {
    const films = deps.listFilms ? await deps.listFilms(prefix) : [];
    const conns = await store.listConns(id);
    return { status: 200, body: { event: view(meta), films, connected: conns.length } };
  }
  if (seg.length === 2 && m === 'PATCH') {
    const b = req.body || {};
    const fields = {};
    if ('public' in b) {
      fields.public = !!b.public;
      fields.pub = null;
      fields.gh = null;
    }
    if (Number.isFinite(b.daysLeft)) {
      const days = Math.min(30, Math.max(0, b.daysLeft));
      fields.ttl = Math.floor(now / 1000) + Math.round(days * DAY);
    }
    const updated = await store.updateEvent(id, fields);
    return { status: 200, body: { event: view(updated) } };
  }
  if (seg[2] === 'films' && m === 'DELETE') {
    const removed = deps.deleteFilms ? await deps.deleteFilms(prefix) : 0;
    await store.updateEvent(id, { published: null });
    return { status: 200, body: { removedFilms: removed } };
  }
  if (seg.length === 2 && m === 'DELETE') {
    const removed = deps.deleteFilms ? await deps.deleteFilms(prefix) : 0;
    await store.deleteEvent(id);
    return { status: 200, body: { deleted: id, removedFilms: removed } };
  }
  throw new HttpError(404, 'Unknown admin endpoint');
}
