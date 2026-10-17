// Write a display rotation into an MP4's video track header — the same way an iPhone camera
// marks a portrait video — so Photos and players show it upright. No re-encoding: only the
// 36-byte matrix in 'tkhd' changes, so even a large clip saves instantly.

const MATRIX = {
  // [a, b, u, c, d, v, tx, ty, w] — 16.16 fixed point (u, v, w are 2.30); tx/ty keep it in frame
  0: (W, H) => [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000],
  90: (W, H) => [0, 0x10000, 0, -0x10000, 0, 0, H, 0, 0x40000000],
  180: (W, H) => [-0x10000, 0, 0, 0, -0x10000, 0, W, H, 0x40000000],
  270: (W, H) => [0, -0x10000, 0, 0x10000, 0, 0, 0, W, 0x40000000],
};

function boxes(dv, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = dv.getUint32(o);
    const type = String.fromCharCode(dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6), dv.getUint8(o + 7));
    let hdr = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(o + 8));
      hdr = 16;
    } else if (size === 0) size = end - o;
    if (size < 8) break;
    out.push({ o, size, type, hdr });
    o += size;
  }
  return out;
}

/** The rotation (clockwise degrees) a matrix already applies. */
function degOf(a, b) {
  if (a === 0 && b > 0) return 90;
  if (a === 0 && b < 0) return 270;
  if (a < 0) return 180;
  return 0;
}

/**
 * @param blob  an MP4
 * @param deg   clockwise degrees to turn it, on top of any rotation it already has
 * @returns a new Blob (or the same one if it isn't an MP4 we can mark)
 */
export async function withRotation(blob, deg) {
  deg = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  if (!deg) return blob;
  // find the top-level 'moov' (it can be at the start or the end)
  let off = 0, moov = null;
  while (off + 16 <= blob.size) {
    const h = new DataView(await blob.slice(off, off + 16).arrayBuffer());
    let size = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    let hdr = 8;
    if (size === 1) {
      size = Number(h.getBigUint64(8));
      hdr = 16;
    } else if (size === 0) size = blob.size - off;
    if (size < 8) return blob;
    if (type === 'moov') {
      moov = { off, size, hdr };
      break;
    }
    off += size;
  }
  if (!moov) return blob;
  const dv = new DataView(await blob.slice(moov.off, moov.off + moov.size).arrayBuffer());
  for (const trak of boxes(dv, moov.hdr, moov.size).filter((b) => b.type === 'trak')) {
    const kids = boxes(dv, trak.o + trak.hdr, trak.o + trak.size);
    const tkhd = kids.find((b) => b.type === 'tkhd'), mdia = kids.find((b) => b.type === 'mdia');
    if (!tkhd || !mdia) continue;
    const hdlr = boxes(dv, mdia.o + mdia.hdr, mdia.o + mdia.size).find((b) => b.type === 'hdlr');
    if (!hdlr) continue;
    const h0 = hdlr.o + hdlr.hdr + 8;
    if (String.fromCharCode(dv.getUint8(h0), dv.getUint8(h0 + 1), dv.getUint8(h0 + 2), dv.getUint8(h0 + 3)) !== 'vide') continue;
    const m = tkhd.o + tkhd.hdr + (dv.getUint8(tkhd.o + tkhd.hdr) === 1 ? 52 : 40);
    const W = dv.getUint32(m + 36), H = dv.getUint32(m + 40); // 16.16, as the matrix wants
    const total = (degOf(dv.getInt32(m), dv.getInt32(m + 4)) + deg) % 360;
    const bytes = new DataView(new ArrayBuffer(36));
    MATRIX[total](W, H).forEach((x, i) => bytes.setInt32(i * 4, x | 0));
    const abs = moov.off + m;
    return new Blob([blob.slice(0, abs), bytes.buffer, blob.slice(abs + 36)], { type: blob.type });
  }
  return blob;
}
