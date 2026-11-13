// Checks the STUN and TURN server the way a browser uses it, and the ways it could be abused.
//   node aws/stun/check.mjs stun.vuemesh.com
// 1. STUN: asks for this computer's public address.
// 2. TURN (when aws/.turn-secret is here, or TURN_SECRET is set): makes a password the way the API
//    does and checks that
//    - a wrong password is refused, and the right one gets a relay on the public address;
//    - no relay is allowed into private networks, by any spelling (169.254.169.254, 127.0.0.1,
//      10.x, 0.0.0.0, ::1, and IPv4 written as IPv6, ::ffff:127.0.0.1);
//    - no TCP relay (the way a TURN server gets used to reach other machines' services);
//    - two relays on the server reach each other (two relayed devices meet there), but a relay
//      can't reach the server's own STUN/TURN port (the server's firewall; skip with --no-self,
//      for a test server without it).
//    Every relay is let go at the end.
import dgram from 'node:dgram';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { iceServers } from '../functions/lib/core.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const host = args[0] || 'stun.vuemesh.com', port = Number(args[1] || 3478), self = !process.argv.includes('--no-self');
const { address } = await lookup(host, { family: 4 });
const MAGIC = Buffer.from([0x21, 0x12, 0xa4, 0x42]);
const fail = (msg) => { console.error('FAIL ' + msg); process.exit(1); };
const ok = (msg) => console.log('ok  ' + msg);

// ---- STUN messages
const attr = (type, value) => {
  const pad = (4 - (value.length % 4)) % 4, b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0); b.writeUInt16BE(value.length, 2); value.copy(b, 4);
  return b;
};
function ipv6Bytes(ip) {
  let tail = [];
  const m = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:127.0.0.1
  if (m) { const q = m[2].split('.').map(Number); tail = [(q[0] << 8) | q[1], (q[2] << 8) | q[3]]; ip = m[1] + '0'; }
  const [a, b = ''] = ip.split('::');
  const head = a ? a.split(':').map((h) => parseInt(h, 16)) : [], rest = b ? b.split(':').map((h) => parseInt(h, 16)) : [];
  if (tail.length) rest.splice(rest.length - 1, 1, ...tail);
  const words = [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest];
  const out = Buffer.alloc(16);
  words.forEach((w, i) => out.writeUInt16BE(w, i * 2));
  return out;
}
/** XOR-PEER-ADDRESS for an IPv4 or IPv6 address, in this transaction */
function xorPeer(ip, p, tid) {
  const v6 = ip.includes(':');
  const raw = v6 ? ipv6Bytes(ip) : Buffer.from(ip.split('.').map(Number));
  const mask = Buffer.concat([MAGIC, tid]);
  const b = Buffer.alloc(4 + raw.length);
  b[1] = v6 ? 2 : 1; b.writeUInt16BE(p ^ 0x2112, 2);
  raw.forEach((x, i) => (b[4 + i] = x ^ mask[i]));
  return attr(0x0012, b);
}
function message(type, attrs, key) {
  const head = Buffer.alloc(20), tid = randomBytes(12);
  head.writeUInt16BE(type, 0); MAGIC.copy(head, 4); tid.copy(head, 8);
  let body = Buffer.concat(typeof attrs === 'function' ? attrs(tid) : attrs);
  if (key) { // MESSAGE-INTEGRITY: HMAC-SHA1 over the message, its length counting the integrity attribute
    head.writeUInt16BE(body.length + 24, 2);
    body = Buffer.concat([body, attr(0x0008, createHmac('sha1', key).update(Buffer.concat([head, body])).digest())]);
  }
  head.writeUInt16BE(body.length, 2);
  return Buffer.concat([head, body]);
}
function parse(m) {
  const out = { type: m.readUInt16BE(0), tid: m.subarray(8, 20), attrs: new Map() };
  for (let o = 20; o + 4 <= m.length;) {
    const t = m.readUInt16BE(o), l = m.readUInt16BE(o + 2);
    out.attrs.set(t, m.subarray(o + 4, o + 4 + l));
    o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return out;
}
const xorAddr = (v) => [0, 1, 2, 3].map((i) => v[4 + i] ^ MAGIC[i]).join('.') + ':' + (v.readUInt16BE(2) ^ 0x2112);
const errorOf = (r) => { const e = r.attrs.get(0x0009); return e ? `${e[2] * 100 + e[3]} ${e.subarray(4).toString()}` : 'type 0x' + r.type.toString(16); };

/** A UDP socket to the server: ask() a request and wait for its answer; next() for the next indication */
function client() {
  const s = dgram.createSocket('udp4'), waiting = new Map(), inbox = [];
  let wake = null;
  s.on('message', (m) => {
    const r = parse(m), k = r.tid.toString('hex');
    if (waiting.has(k)) { waiting.get(k)(r); waiting.delete(k); } else { inbox.push(r); wake?.(); }
  });
  return {
    ask(msg, why = '') {
      return new Promise((resolve) => {
        const k = msg.subarray(8, 20).toString('hex');
        const timer = setTimeout(() => fail(`No answer from ${host} (${address}:${port}) in 3 s${why}`), 3000);
        waiting.set(k, (r) => { clearTimeout(timer); resolve(r); });
        s.send(msg, port, address);
      });
    },
    send(msg) { s.send(msg, port, address); },
    async next(ms) {
      const end = Date.now() + ms;
      while (!inbox.length && Date.now() < end) await new Promise((r) => { wake = r; setTimeout(r, end - Date.now()); });
      return inbox.shift() || null;
    },
    close() { s.close(); },
  };
}

// 1. STUN
const c1 = client();
const b = await c1.ask(message(0x0001, []));
if (b.type !== 0x0101 || !b.attrs.has(0x0020)) fail('Unexpected answer to STUN');
ok(`STUN: ${host} (${address}) says this computer is ${xorAddr(b.attrs.get(0x0020))}`);

// 2. TURN
const secretFile = join(import.meta.dirname, '..', '.turn-secret');
const secret = process.env.TURN_SECRET || (existsSync(secretFile) ? readFileSync(secretFile, 'utf8').trim() : '');
if (!secret) {
  console.log('--  TURN not checked: no aws/.turn-secret here (or TURN_SECRET)');
  process.exit(0);
}
const transport = (proto) => attr(0x0019, Buffer.from([proto, 0, 0, 0])); // REQUESTED-TRANSPORT
const { iceServers: [{ username, credential }] } = iceServers({ secret, urls: ['turn:check'] }, Date.now());

/** a relay on its own socket: { c, r, relay: 'ip:port' or null, ask(type, attrs) signed } */
async function relay(password = credential, proto = 17) {
  const c = client();
  const first = await c.ask(message(0x0003, [transport(proto)]), ' to a TURN request: is it still STUN-only? (./aws/stun/deploy.sh)');
  if (first.type !== 0x0113 || !first.attrs.has(0x0014)) fail(`TURN: expected to be asked for a password, got ${errorOf(first)}`);
  const realm = first.attrs.get(0x0014), nonce = first.attrs.get(0x0015);
  const key = createHash('md5').update(`${username}:${realm}:${password}`).digest();
  const auth = [attr(0x0006, Buffer.from(username)), attr(0x0014, realm), attr(0x0015, nonce)];
  const r = await c.ask(message(0x0003, [transport(proto), ...auth], key));
  const ask = (type, more) => c.ask(message(type, (tid) => [...(typeof more === 'function' ? more(tid) : more), ...auth], key));
  return { c, r, ask, relay: r.type === 0x0103 ? xorAddr(r.attrs.get(0x0016)) : null };
}

const wrong = await relay('not-the-password');
if (wrong.relay) fail('TURN gave a relay for a wrong password: it is an open relay');
ok(`TURN: a wrong password is refused (${errorOf(wrong.r)})`);
wrong.c.close();

const A = await relay();
if (!A.relay) fail(`TURN refused the API's password: ${errorOf(A.r)} (is aws/.turn-secret the one the server was deployed with?)`);
if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(A.relay)) fail(`TURN: the relay address ${A.relay} is private: external-ip isn't set (does stun.<domain> resolve on the server?)`);
ok(`TURN: relay address ${A.relay}, for ${A.r.attrs.get(0x000d)?.readUInt32BE(0) ?? '?'} s`);

const FORBIDDEN = ['169.254.169.254', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '0.0.0.0', '100.64.0.1', '::1', '::', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'fe80::1', 'fd00::1'];
const through = [];
for (const ip of FORBIDDEN) {
  const r = await A.ask(0x0008, (tid) => [xorPeer(ip, 80, tid)]);
  if (r.type === 0x0108) through.push(ip);
}
if (through.length) fail(`TURN would relay into private networks: ${through.join(', ')} (denied-peer-ip)`);
ok(`TURN: no relaying into private networks (${FORBIDDEN.length} addresses refused, IPv4 written as IPv6 among them)`);

const T = await relay(credential, 6);
if (T.relay) fail('TURN gave a TCP relay: no-tcp-relay is missing');
ok(`TURN: no TCP relays (${errorOf(T.r)})`);
T.c.close();

// two relays on the server reach each other; a relay can't reach the server's own STUN port
const B = await relay();
const [aIp] = A.relay.split(':'), [bIp, bPort] = B.relay.split(':');
const permit = async (X, ip) => { const r = await X.ask(0x0008, (tid) => [xorPeer(ip, 0, tid)]); if (r.type !== 0x0108) fail(`TURN: no permission for ${ip}: ${errorOf(r)}`); };
await permit(A, bIp); await permit(B, aIp);
const sendVia = (X, ip, p, data) => X.c.send(message(0x0016, (tid) => [xorPeer(ip, Number(p), tid), attr(0x0013, data)]));
sendVia(A, bIp, bPort, Buffer.from('hello'));
const got = await B.c.next(3000);
if (!got || got.type !== 0x0017 || got.attrs.get(0x0013)?.toString() !== 'hello') fail("TURN: two relays on the server didn't reach each other (two relayed devices couldn't connect)");
ok('TURN: two relays on the server reach each other');
if (self) {
  // a STUN request sent through the relay to the server's own 3478: an answer would come back as data
  sendVia(A, aIp, port, message(0x0001, []));
  const back = await A.c.next(2000);
  if (back) fail("TURN: a relay reached the server's own STUN/TURN port (the server's firewall, nft table vuemesh, isn't on)");
  ok("TURN: a relay can't reach the server's own STUN/TURN port");
}

// let them go (REFRESH with LIFETIME 0)
for (const X of [A, B]) { await X.ask(0x0004, [attr(0x000d, Buffer.alloc(4))]); X.c.close(); }
c1.close();
