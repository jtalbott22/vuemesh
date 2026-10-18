// Shared helpers for the VUEMesh Lambdas (and the local dev server).
import { createHash, randomBytes } from 'node:crypto';

const ID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomId(n) {
  const bytes = randomBytes(n);
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
export const b64url = (buf) => Buffer.from(buf).toString('base64url');

// (what a camera or microphone agrees to on joining; kept with the event when it's made, so an
// event's terms never change under it)
export function termsText({ title }) {
  return [
    `By joining "${title}" you add your angle to one shared production.`,
    `The host may use your clips in cuts of this event and publish them.`,
    `Your phone signs every clip you send, so your contribution is provably yours.`,
  ].join(' ');
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- geohash: sparse "find events near me" without a geo database -------------

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat, lon, precision = 4) {
  let latR = [-90, 90], lonR = [-180, 180], hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    const r = even ? lonR : latR;
    const v = even ? lon : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch |= 1 << (4 - bit); r[0] = mid; } else { r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

export function geohashBox(hash) {
  let latR = [-90, 90], lonR = [-180, 180], even = true;
  for (const c of hash) {
    const v = B32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lonR : latR;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid; else r[1] = mid;
      even = !even;
    }
  }
  return { lat: latR, lon: lonR };
}

/** The cell containing (lat, lon) plus its 8 neighbours. */
export function nearbyCells(lat, lon, precision = 4) {
  const box = geohashBox(geohash(lat, lon, precision));
  const dLat = box.lat[1] - box.lat[0];
  const dLon = box.lon[1] - box.lon[0];
  const cLat = (box.lat[0] + box.lat[1]) / 2;
  const cLon = (box.lon[0] + box.lon[1]) / 2;
  const cells = new Set();
  for (const a of [-1, 0, 1]) {
    for (const b of [-1, 0, 1]) {
      const la = Math.max(-89.999, Math.min(89.999, cLat + a * dLat));
      let lo = cLon + b * dLon;
      if (lo > 180) lo -= 360;
      if (lo < -180) lo += 360;
      cells.add(geohash(la, lo, precision));
    }
  }
  return [...cells];
}

export function km(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function publicEvent(meta) {
  if (!meta) return null;
  const { pk, sk, hostKeyHash, gh, pub, ttl, joined, usage, activeDay, ...rest } = meta; // (counting details stay private)
  return rest;
}
