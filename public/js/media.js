// The media library: everything the studio knows about the footage beyond the files.
// Tags, stars, notes and non-destructive trims per recording; subclips (named,
// tagged ranges of a recording — no new files); and moments marked live.
// Recordings stay exactly as the phones signed them; nothing here edits a file.

export const QUICK_TAGS = ['Highlight', 'Funny', 'Speech', 'Toast', 'Dance', 'Blooper', 'Crowd', 'Family'];
const uid = () => Math.random().toString(36).slice(2, 10);

export class MediaLibrary {
  constructor(eventId, storage = globalThis.localStorage) {
    this.key = 'vm_media_' + eventId;
    this.storage = storage;
    let d = {};
    try {
      d = JSON.parse(storage.getItem(this.key) || '{}');
    } catch {}
    this.data = { meta: d.meta || {}, subclips: d.subclips || [], moments: d.moments || [] };
  }

  save() {
    this.storage.setItem(this.key, JSON.stringify(this.data));
  }

  meta(clipId) {
    return { tags: [], star: false, notes: '', trim: null, ...(this.data.meta[clipId] || {}) };
  }

  setMeta(clipId, fields) {
    this.data.meta[clipId] = { ...this.meta(clipId), ...fields };
    this.save();
    return this.data.meta[clipId];
  }

  /** Usable range of a recording (ms into the file). */
  range(clip) {
    const t = this.meta(clip.id).trim;
    return t ? { in: Math.max(0, t.in), out: Math.min(clip.dur, t.out) } : { in: 0, out: clip.dur };
  }

  get subclips() {
    return this.data.subclips;
  }

  addSubclip({ src, in: a, out: b, name, tags = [] }) {
    const sc = { id: 'sc-' + uid(), src, in: Math.round(Math.min(a, b)), out: Math.round(Math.max(a, b)), name: name || 'Subclip', tags: [...new Set(tags)], star: false, createdAt: Date.now() };
    this.data.subclips.push(sc);
    this.save();
    return sc;
  }

  updateSubclip(id, fields) {
    const sc = this.data.subclips.find((x) => x.id === id);
    if (sc) Object.assign(sc, fields);
    this.save();
    return sc;
  }

  removeSubclip(id) {
    this.data.subclips = this.data.subclips.filter((x) => x.id !== id);
    this.save();
  }

  get moments() {
    return this.data.moments;
  }

  /** A moment marked live (event clock, ms). */
  addMoment(t, label) {
    const m = { id: 'm-' + uid(), t: Math.round(t), label: label || `Moment ${this.data.moments.length + 1}`, tags: [] };
    this.data.moments.push(m);
    this.data.moments.sort((a, b) => a.t - b.t);
    this.save();
    return m;
  }

  updateMoment(id, fields) {
    const m = this.data.moments.find((x) => x.id === id);
    if (m) Object.assign(m, fields);
    if ('t' in fields) this.data.moments.sort((a, b) => a.t - b.t);
    this.save();
    return m;
  }

  removeMoment(id) {
    this.data.moments = this.data.moments.filter((x) => x.id !== id);
    this.save();
  }

  /**
   * Subclips of a moment from every angle that was rolling: `before` ms ahead of it,
   * `after` ms past it, clipped to each recording's usable range.
   */
  clipsFromMoment(momentId, clips, before = 10000, after = 5000) {
    const m = this.data.moments.find((x) => x.id === momentId);
    if (!m) return [];
    const made = [];
    for (const c of clips) {
      if (c.kind === 'audio') continue;
      const r = this.range(c);
      const at = m.t - c.t0;
      if (at < r.in || at > r.out) continue;
      made.push(this.addSubclip({ src: c.id, in: Math.max(r.in, at - before), out: Math.min(r.out, at + after), name: `${m.label} · ${c.name}`, tags: ['Moment', ...m.tags] }));
    }
    return made;
  }

  /** Forget everything about a deleted recording. */
  forgetSource(clipId) {
    delete this.data.meta[clipId];
    const gone = this.data.subclips.filter((x) => x.src === clipId).length;
    this.data.subclips = this.data.subclips.filter((x) => x.src !== clipId);
    this.save();
    return gone;
  }

  /** Every tag in use, most used first. */
  allTags() {
    const n = new Map();
    const add = (tags) => tags.forEach((t) => n.set(t, (n.get(t) || 0) + 1));
    Object.values(this.data.meta).forEach((m) => add(m.tags || []));
    this.data.subclips.forEach((s) => add(s.tags));
    this.data.moments.forEach((m) => add(m.tags || []));
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  }
}
