// Pull the encoded video samples out of a recording so WebCodecs can decode it
// frame-accurately, faster than real time. Phones record MP4 (most) or WebM.
// Returns { codec, description?, width, height, samples:[{ts, dur, key, data}] } (µs), or null.

export async function demux(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const buf = await blob.arrayBuffer();
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return demuxWebm(buf);
  if (String.fromCharCode(...head.slice(4, 8)) === 'ftyp') return demuxMp4(buf);
  return null;
}

// ---------------------------------------------------------------------- MP4 ---

function demuxMp4(buf) {
  const { MP4Box, DataStream } = window;
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    let track = null;
    const samples = [];
    file.onError = (e) => reject(new Error('MP4 parse failed: ' + e));
    file.onReady = (info) => {
      track = info.videoTracks[0] || null;
      if (!track) return;
      file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
      file.start();
    };
    file.onSamples = (_id, _user, list) => {
      for (const s of list) {
        samples.push({ ts: (s.cts * 1e6) / s.timescale, dur: (s.duration * 1e6) / s.timescale, key: s.is_sync, data: s.data });
      }
    };
    buf.fileStart = 0;
    file.appendBuffer(buf);
    file.flush();
    if (!track) return resolve(null);
    // Codec setup bytes (avcC / hvcC / vpcC / av1C) without their box header.
    let description;
    const trak = file.getTrackById(track.id);
    for (const entry of trak.mdia.minf.stbl.stsd.entries) {
      const box = entry.avcC || entry.hvcC || entry.av1C;
      if (box) {
        const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
        box.write(ds);
        description = new Uint8Array(ds.buffer, 8);
        break;
      }
    }
    samples.sort((a, b) => a.ts - b.ts);
    fixDurations(samples);
    // iPhones often record sideways pixels plus a "display rotated" flag in the track header.
    const m = track.matrix;
    const rotation = m ? ((Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360 : 0;
    const coded = trak.mdia.minf.stbl.stsd.entries[0];
    resolve({ codec: normalizeCodec(track.codec), description, width: coded?.width || track.video.width, height: coded?.height || track.video.height, rotation, samples });
  });
}

// --------------------------------------------------------------------- WebM ---
// Just enough EBML to read what MediaRecorder writes: tracks, clusters, blocks.

const ID = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
};
const DESCEND = new Set([ID.Segment, ID.Cluster, ID.BlockGroup]);

function demuxWebm(buf) {
  const u8 = new Uint8Array(buf);
  const len = u8.length;
  const readId = (p) => {
    const b = u8[p];
    const n = b >= 0x80 ? 1 : b >= 0x40 ? 2 : b >= 0x20 ? 3 : b >= 0x10 ? 4 : 0;
    if (!n || p + n > len) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + u8[p + i];
    return { v, n };
  };
  const readSize = (p) => {
    const b = u8[p];
    let n = 1, mask = 0x80;
    while (n <= 8 && !(b & mask)) { n++; mask >>= 1; }
    if (n > 8 || p + n > len) return null;
    let v = b & (mask - 1);
    let allOnes = v === mask - 1;
    for (let i = 1; i < n; i++) {
      v = v * 256 + u8[p + i];
      if (u8[p + i] !== 0xff) allOnes = false;
    }
    return { v: allOnes ? -1 : v, n };
  };
  const readUint = (p, n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + u8[p + i];
    return v;
  };
  const readStr = (p, n) => String.fromCharCode(...u8.subarray(p, p + n)).replace(/\0+$/, '');

  let scale = 1e6; // ns per timecode unit
  const tracks = [];
  const blocks = [];
  let clusterTc = 0;

  const parseTracks = (start, stop) => {
    let p = start;
    while (p < stop) {
      const id = readId(p); const sz = id && readSize(p + id.n);
      if (!id || !sz) break;
      const d = p + id.n + sz.n;
      if (id.v === ID.TrackEntry) {
        const t = {};
        let q = d;
        while (q < d + sz.v) {
          const cid = readId(q); const csz = cid && readSize(q + cid.n);
          if (!cid || !csz) break;
          const cd = q + cid.n + csz.n;
          if (cid.v === ID.TrackNumber) t.number = readUint(cd, csz.v);
          else if (cid.v === ID.TrackType) t.type = readUint(cd, csz.v);
          else if (cid.v === ID.CodecID) t.codec = readStr(cd, csz.v);
          else if (cid.v === ID.CodecPrivate) t.priv = u8.slice(cd, cd + csz.v);
          else if (cid.v === ID.Video) {
            let r = cd;
            while (r < cd + csz.v) {
              const vid = readId(r); const vsz = vid && readSize(r + vid.n);
              if (!vid || !vsz) break;
              const vd = r + vid.n + vsz.n;
              if (vid.v === ID.PixelWidth) t.width = readUint(vd, vsz.v);
              if (vid.v === ID.PixelHeight) t.height = readUint(vd, vsz.v);
              r = vd + vsz.v;
            }
          }
          q = cd + csz.v;
        }
        tracks.push(t);
      }
      p = d + sz.v;
    }
  };

  let p = 0;
  while (p < len) {
    const id = readId(p);
    const sz = id && readSize(p + id.n);
    if (!id || !sz) break;
    const d = p + id.n + sz.n;
    if (DESCEND.has(id.v)) { p = d; continue; }
    if (sz.v < 0) break; // unknown-size element we don't descend into
    if (id.v === ID.Info) {
      let q = d;
      while (q < d + sz.v) {
        const cid = readId(q); const csz = cid && readSize(q + cid.n);
        if (!cid || !csz) break;
        if (cid.v === ID.TimecodeScale) scale = readUint(q + cid.n + csz.n, csz.v);
        q += cid.n + csz.n + csz.v;
      }
    } else if (id.v === ID.Tracks) parseTracks(d, d + sz.v);
    else if (id.v === ID.Timecode) clusterTc = readUint(d, sz.v);
    else if (id.v === ID.SimpleBlock || id.v === ID.Block) {
      const tn = readSize(d);
      if (tn) {
        const h = d + tn.n;
        const rel = (u8[h] << 24 >> 16) | u8[h + 1]; // signed 16-bit
        const flags = u8[h + 2];
        blocks.push({ track: tn.v, ts: ((clusterTc + rel) * scale) / 1000, key: id.v === ID.SimpleBlock ? !!(flags & 0x80) : true, data: u8.slice(h + 3, d + sz.v) });
      }
    }
    p = d + sz.v;
  }

  const v = tracks.find((t) => t.type === 1);
  if (!v) return null;
  const codec = { V_VP8: 'vp8', V_VP9: 'vp09.00.10.08', V_AV1: 'av01.0.04M.08', 'V_MPEG4/ISO/AVC': 'avc1.42E01F' }[v.codec];
  if (!codec) return null;
  const samples = blocks.filter((b) => b.track === v.number).map((b) => ({ ts: b.ts, dur: 0, key: b.key, data: b.data }));
  samples.sort((a, b) => a.ts - b.ts);
  fixDurations(samples);
  return { codec, description: codec.startsWith('avc1') ? v.priv : undefined, width: v.width, height: v.height, samples };
}

// Some recorders write codec strings WebCodecs rejects (a VP9 level of "00", say).
// The level doesn't change how a stream decodes, so replace an invalid one.
const VP9_LEVELS = new Set(['10', '11', '20', '21', '30', '31', '40', '41', '50', '51', '52', '60', '61', '62']);
export function normalizeCodec(codec) {
  if (!codec) return codec;
  if (codec === 'vp08' || codec === 'vp8') return 'vp8';
  const m = /^vp09\.(\d\d)\.(\d\d)\.(\d\d)(.*)$/.exec(codec);
  if (m) return `vp09.${m[1]}.${VP9_LEVELS.has(m[2]) ? m[2] : '41'}.${m[3]}`;
  if (codec === 'vp09') return 'vp09.00.41.08';
  return codec;
}

function fixDurations(samples) {
  for (let i = 0; i < samples.length; i++) {
    if (!samples[i].dur) samples[i].dur = i + 1 < samples.length ? samples[i + 1].ts - samples[i].ts : 33333;
  }
}
