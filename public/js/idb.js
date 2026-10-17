// Tiny IndexedDB wrapper. Two stores:
//   clips  — on the host laptop: every verified clip received over the LAN
//   outbox — on a guest phone: finished clips waiting to reach the host (survives reloads)
//   reel   — on the host laptop: break-reel sponsor images and videos

let dbp;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('vuemesh', 3);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const name of ['clips', 'outbox', 'reel', 'program']) {
        if (d.objectStoreNames.contains(name)) continue;
        const s = d.createObjectStore(name, { keyPath: 'key' });
        s.createIndex('eventId', 'eventId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Some iPhone browsers refuse to keep certain blobs ("Error preparing Blob/File data to be
// stored"): then the same bytes are kept as a plain buffer, and handed back as a blob.
const asBlob = (r) => (r && !r.blob && r.buf ? { ...r, blob: new Blob([r.buf], { type: r.type || '' }) } : r);
export async function put(store, rec) {
  const d = await db();
  try {
    return await done(d.transaction(store, 'readwrite').objectStore(store).put({ ...rec, key: `${rec.eventId}:${rec.id}` }));
  } catch (e) {
    if (!(rec.blob instanceof Blob)) throw e;
    const { blob, ...rest } = rec;
    const buf = await blob.arrayBuffer();
    return done(d.transaction(store, 'readwrite').objectStore(store).put({ ...rest, buf, type: blob.type, key: `${rec.eventId}:${rec.id}`, keptAs: 'bytes' }));
  }
}

export async function list(store, eventId) {
  const d = await db();
  return (await done(d.transaction(store).objectStore(store).index('eventId').getAll(eventId))).map(asBlob);
}

/** One record (by event and id), or undefined. */
export async function get(store, eventId, id) {
  const d = await db();
  return asBlob(await done(d.transaction(store).objectStore(store).get(`${eventId}:${id}`)));
}

export async function patch(store, eventId, id, fields) {
  const d = await db();
  const tx = d.transaction(store, 'readwrite').objectStore(store);
  const rec = await done(tx.get(`${eventId}:${id}`));
  if (!rec) return null;
  Object.assign(rec, fields);
  await done(tx.put(rec));
  return rec;
}

export async function remove(store, eventId, id) {
  const d = await db();
  return done(d.transaction(store, 'readwrite').objectStore(store).delete(`${eventId}:${id}`));
}

const STORES = ['clips', 'outbox', 'reel', 'program'];

/** How much one event takes on this device. */
export async function usage(eventId) {
  const out = { bytes: 0, clips: 0, outbox: 0, reel: 0 };
  for (const s of STORES) {
    const recs = await list(s, eventId);
    out[s] = recs.length;
    out.bytes += recs.reduce((n, r) => n + (r.blob?.size || r.buf?.byteLength || 0), 0);
  }
  return out;
}

/** Remove everything one event stored on this device (only ever on the person's say-so). */
export async function wipe(eventId) {
  for (const s of STORES) for (const r of await list(s, eventId)) await remove(s, eventId, r.id);
}

/** Every record in a store, across all events (for the camera person's footage view). */
export async function listAll(store) {
  const d = await db();
  return (await done(d.transaction(store).objectStore(store).getAll())).map(asBlob);
}
