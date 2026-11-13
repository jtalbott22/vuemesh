// Asks a STUN server for this computer's public address, the way a browser does.
//   node aws/stun/check.mjs stun.vuemesh.com
import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';

const host = process.argv[2] || 'stun.vuemesh.com', port = Number(process.argv[3] || 3478);
const { address } = await lookup(host, { family: 4 });
const MAGIC = [0x21, 0x12, 0xa4, 0x42];
const s = dgram.createSocket('udp4');
const timer = setTimeout(() => { console.error(`No answer from ${host} (${address}:${port}) in 3 s`); process.exit(1); }, 3000);
s.on('message', (m) => {
  let o = 20, mapped = null;
  while (o + 4 <= m.length) {
    const t = m.readUInt16BE(o), l = m.readUInt16BE(o + 2);
    if (t === 0x0020) mapped = [0, 1, 2, 3].map((i) => m[o + 8 + i] ^ MAGIC[i]).join('.') + ':' + (m.readUInt16BE(o + 6) ^ 0x2112);
    o += 4 + l + ((4 - (l % 4)) % 4);
  }
  clearTimeout(timer); s.close();
  if (m.readUInt16BE(0) !== 0x0101 || !mapped) { console.error('Unexpected answer'); process.exit(1); }
  console.log(`ok  ${host} (${address}) says this computer is ${mapped}`);
});
s.send(Buffer.concat([Buffer.from([0, 1, 0, 0, ...MAGIC]), randomBytes(12)]), port, address);
