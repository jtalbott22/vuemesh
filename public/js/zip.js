// A small ZIP writer (stored, not compressed: video doesn't compress anyway). Reads each
// file once to checksum it, in 8 MB pieces, and assembles the archive from references to
// the original blobs, so even large exports don't need much memory. Up to 4 GB.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

async function crc32(blob, step) {
  let c = 0xffffffff;
  for (let off = 0; off < blob.size; off += 8 << 20) {
    const u = new Uint8Array(await blob.slice(off, off + (8 << 20)).arrayBuffer());
    for (let i = 0; i < u.length; i++) c = TABLE[(c ^ u[i]) & 0xff] ^ (c >>> 8);
    step?.(u.length);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export const ZIP_LIMIT = 0xffffffff - (64 << 20);

/**
 * @param files [{name, data: Blob|string}]
 * @param onProgress (doneBytes, totalBytes)
 */
export async function makeZip(files, onProgress) {
  const enc = new TextEncoder();
  const items = files.map((f) => ({ name: enc.encode(f.name.replace(/[\\:*?"<>|]+/g, '-')), blob: typeof f.data === 'string' ? new Blob([f.data]) : f.data }));
  const total = items.reduce((s, i) => s + i.blob.size, 0);
  if (total + items.length * 200 > ZIP_LIMIT) throw new Error('Too large for one ZIP file');
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [], central = [];
  let offset = 0, done = 0;
  for (const it of items) {
    const crc = await crc32(it.blob, (n) => onProgress?.((done += n), total));
    const size = it.blob.size;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // names are UTF-8
    lh.setUint16(8, 0, true); // stored
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, it.name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, it.name, it.blob);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, it.name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, it.name);
    offset += 30 + it.name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
