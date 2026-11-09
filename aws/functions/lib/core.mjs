// VUEMesh cloud core. The cloud does three small jobs:
//   1. events: create, look up, list nearby public ones (discovery)
//   2. signaling: relay WebRTC offers/answers/ICE so phones can find the host
//      laptop and then talk to it directly over the local network
//   3. publishing: hand out one-time upload URLs for the finished film
// Video never passes through here.

import { randomId, sha256hex, b64url, termsText, HttpError, geohash, nearbyCells, km, publicEvent } from './common.mjs';
import { randomBytes } from 'node:crypto';

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
  if (seg[0] === 'admin') return admin(req, seg.slice(1), deps, now);
  if (seg[0] === 'lan') return lan(req, seg.slice(1), deps, now);
  if (seg[0] !== 'events') throw new HttpError(404, 'Unknown endpoint');
  const m = req.method.toUpperCase();

  if (seg.length === 1 && m === 'POST') return createEvent(req.body || {}, store, now, deps);

  if (seg[1] === 'near' && m === 'GET') {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, 'Share your location to find events near you');
    const found = await store.listByCells(nearbyCells(lat, lon, 4));
    const events = found
      .filter((e) => e.public && e.lat != null && alive(e, now))
      // Whole kilometres only, so a listing can't be used to pinpoint a venue.
      .map((e) => ({ ...publicEvent(e), km: Math.max(1, Math.round(km(lat, lon, e.lat, e.lon))), live: now - (e.hostSeenAt || 0) < LIVE_WINDOW_MS }))
      .filter((e) => e.km <= 80)
      .sort((a, b) => (b.live - a.live) || (a.km - b.km))
      .slice(0, 30)
      .map(({ lat: _a, lon: _b, terms, termsHash, ...e }) => e);
    return { status: 200, body: { events } };
  }

  if (seg[1] === 'public' && m === 'GET') {
    if (!deps.flags?.globe) throw new HttpError(404, 'The event map is turned off during the beta');
    // Everything public and recent, for the globe. Coarse location only (~10 km).
    const found = await store.listPublic(200);
    const events = found
      .filter((e) => e.public && e.lat != null && alive(e, now))
      .map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        orientation: e.orientation || 'landscape',
        lat: Math.round(e.lat * 10) / 10,
        lon: Math.round(e.lon * 10) / 10,
        createdAt: e.createdAt,
        live: now - (e.hostSeenAt || 0) < LIVE_WINDOW_MS,
        published: e.published ? { title: e.published.title, publishedAt: e.published.publishedAt } : null,
      }))
      .sort((a, b) => (b.live - a.live) || (b.createdAt - a.createdAt));
    return { status: 200, body: { events } };
  }

  const id = String(seg[1] || '').toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(id)) throw new HttpError(400, 'Bad event code');
  const meta = await store.getEvent(id);
  if (!alive(meta, now)) throw new HttpError(404, 'No event with that code');

  if (seg.length === 2 && m === 'GET') {
    return { status: 200, body: { ...publicEvent(meta), live: now - (meta.hostSeenAt || 0) < LIVE_WINDOW_MS } };
  }

  // A kiosk show without a name yet: the first phone to scan in names it (once). Everyone
  // after joins that show. (Its terms carry the name, so they're made again.)
  if (seg[2] === 'name' && m === 'POST') {
    if (!meta.kiosk) throw new HttpError(403, 'Only a kiosk show is named by whoever arrives first');
    if (meta.titled) return { status: 409, body: { title: meta.title } };
    const title = String(req.body?.title || '').trim().slice(0, 80);
    if (!title) throw new HttpError(400, 'Give the show a name');
    const terms = termsText({ title, poolPct: meta.poolPct || 0 });
    const won = await (store.updateEventIf ? store.updateEventIf(id, { title, titled: true, terms, termsHash: sha256hex(terms), titledAt: now }, 'titled', false) : store.updateEvent(id, { title, titled: true, terms, termsHash: sha256hex(terms), titledAt: now }));
    if (!won) return { status: 409, body: { title: (await store.getEvent(id))?.title } };
    return { status: 200, body: publicEvent(won) };
  }

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
    if (Number.isFinite(b.lat) && Number.isFinite(b.lon)) Object.assign(fields, place(b.lat, b.lon));
    // contributors the host removed and blocked (their random camera ids for this event)
    if ('blocked' in b) fields.blocked = (Array.isArray(b.blocked) ? b.blocked : []).map(String).filter((x) => /^[\w-]{4,80}$/.test(x)).slice(0, 500);
    if (fields.public === false) fields.gh = null;
    else if (fields.public || meta.public) {
      const lat = fields.lat ?? meta.lat, lon = fields.lon ?? meta.lon;
      if (lat != null) fields.gh = geohash(lat, lon, 4);
    }
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
  // a kiosk show can start without a name: the first phone to scan in names it
  const untitledKiosk = !!body.kiosk && !String(body.title || '').trim();
  const title = untitledKiosk ? 'New show' : String(body.title || 'Untitled event').trim().slice(0, 120) || 'Untitled event';
  const kind = String(body.kind || 'other').slice(0, 32);
  const terms = termsText({ title, poolPct, kind });
  const isPublic = !!body.public;
  const orientation = body.orientation === 'portrait' ? 'portrait' : 'landscape';
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = randomId(6);
    const hostKey = b64url(randomBytes(24));
    const meta = {
      id,
      title,
      kind,
      poolPct,
      terms,
      termsHash: sha256hex(terms),
      hostKeyHash: sha256hex(hostKey),
      public: isPublic,
      orientation,
      createdAt: now,
      ttl: Math.floor(now / 1000) + (body.kiosk ? KIOSK_TTL_HOURS * 3600 : EVENT_TTL_DAYS * DAY),
      ...(body.kiosk ? { kiosk: true, titled: !untitledKiosk } : {}),
    };
    if (Number.isFinite(body.lat) && Number.isFinite(body.lon)) Object.assign(meta, place(body.lat, body.lon));
    if (isPublic && meta.lat != null) {
      meta.gh = geohash(meta.lat, meta.lon, 4);
      meta.pub = 'P';
    }
    if (await store.putEventIfAbsent(meta)) {
      await bump(deps, now, { events: 1, events_public: isPublic ? 1 : 0, [`kind_${kindKey(kind)}`]: 1 });
      return { status: 200, body: { id, hostKey, termsHash: meta.termsHash } };
    }
  }
  throw new HttpError(500, 'Could not allocate an event code');
}

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
    const fp = sha256hex(`${day}|${req.ip || ''}|${ua}|${(deps.adminKeyHashes || [])[0] || 'vuemesh'}`).slice(0, 24);
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

// Stored to ~1 km so a public listing never pins someone's front door.
const place = (lat, lon) => ({ lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 });

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
    const stat = { cam: 'cameras', mic: 'mics', viewer: 'viewers', display: 'displays' }[role];
    if (stat) {
      // (by the phone's camera id for this event, which survives a reload; else this connection's)
      const tag = `${role}:${sha256hex(String(q.cid || q.peer || conn)).slice(0, 16)}`, joined = meta.joined || [];
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
      await broadcastPeers(eventId, deps, undefined, gone?.role === 'host');
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
    if (typeof b.title === 'string' && b.title.trim()) fields.title = b.title.trim().slice(0, 120);
    if ('public' in b) {
      fields.public = !!b.public;
      fields.pub = b.public && meta.lat != null ? 'P' : null;
      fields.gh = b.public && meta.lat != null ? geohash(meta.lat, meta.lon, 4) : null;
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
