// In-memory store with the same interface as store-dynamo.mjs (local dev + tests).
export function memoryStore() {
  const events = new Map();
  const traffic = new Map(), seen = new Set();
  const conns = new Map(); // connId -> {eventId, ...info}
  const stats = new Map(); // day -> counts (kept)
  const snaps = [];
  const lans = new Map(); // slug -> a local show's address and its owner
  const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);
  return {
    async getEvent(id) { return clone(events.get(id)); },
    async putEventIfAbsent(meta) {
      if (events.has(meta.id)) return false;
      events.set(meta.id, clone(meta));
      return true;
    },
    async updateEvent(id, fields) {
      const e = events.get(id);
      if (!e) return null;
      for (const [k, v] of Object.entries(fields)) v === null || v === undefined ? delete e[k] : (e[k] = clone(v));
      return clone(e);
    },
    async listByCells(cells) { return [...events.values()].filter((e) => e.gh && cells.includes(e.gh)).map(clone); },
    async listPublic(limit) {
      return [...events.values()].filter((e) => e.pub === 'P').sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(clone);
    },
    async scanEvents(cursor, limit) {
      const all = [...events.values()].sort((a, b) => a.id.localeCompare(b.id));
      const start = cursor ? Number(cursor) : 0;
      const items = all.slice(start, start + limit).map(clone);
      return { items, next: start + limit < all.length ? String(start + limit) : null };
    },
    async deleteEvent(id) {
      events.delete(id);
      for (const [k, c] of conns) if (c.eventId === id) conns.delete(k);
    },
    async addConn(eventId, connId, info) { conns.set(connId, { eventId, connId, ...info }); },
    async getConnEvent(connId) { return conns.get(connId)?.eventId || null; },
    async removeConn(_eventId, connId) { conns.delete(connId); },
    async listConns(eventId) { return [...conns.values()].filter((c) => c.eventId === eventId).map(clone); },
    async updateEventIf(id, fields, field, value) {
      const e = events.get(id);
      if (!e || (e[field] ?? false) !== value) return null;
      Object.assign(e, fields);
      return clone(e);
    },
    async updateConn(_eventId, connId, fields) { const c = conns.get(connId); if (c) Object.assign(c, fields); },
    async bumpStats(day, counts) {
      const d = stats.get(day) || { day };
      for (const [k, v] of Object.entries(counts)) d[k] = (d[k] || 0) + v;
      stats.set(day, d);
    },
    async putStatsIfAbsent(day, counts) {
      if (stats.has(day)) return false;
      stats.set(day, { day, ...counts });
      return true;
    },
    async listStats(from, to) { return [...stats.values()].filter((d) => d.day >= from && d.day <= to).sort((a, b) => a.day.localeCompare(b.day)).map(clone); },
    async putSnapshot(snap) { snaps.unshift(clone(snap)); },
    async setStat(day, key, value) {
      const d = stats.get(day) || { day };
      d[key] = value;
      stats.set(day, d);
      return clone(d);
    },
    async bumpTraffic(day, counts) {
      const d = traffic.get(day) || { day };
      for (const [k, v] of Object.entries(counts)) d[k] = (d[k] || 0) + v;
      traffic.set(day, d);
    },
    async listTraffic(from, to) { return [...traffic.values()].filter((d) => d.day >= from && d.day <= to).sort((a, b) => a.day.localeCompare(b.day)).map(clone); },
    async getLan(slug) { return clone(lans.get(slug) || null); },
    async putLanIfAbsent(rec) {
      if (lans.has(rec.slug)) return false;
      lans.set(rec.slug, clone(rec));
      return true;
    },
    async markOnce(key) {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    async listSnapshots() { return snaps.map(clone); },
  };
}
