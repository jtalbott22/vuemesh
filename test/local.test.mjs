// The local show helper (public/relay/vuemesh-local.mjs): its answers for addresses, the hotspot's
// commands on Linux and Windows, the Wi-Fi code, and its certificate request (checked by openssl).
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VUEMESH_LOCAL_HOME = mkdtempSync(join(tmpdir(), 'vm-local-')); // (its name and password: kept here, not in your home)
const L = await import('../public/relay/vuemesh-local.mjs');
const ok = (m) => console.log('ok  ' + m);

// a DNS question for a name, as a phone asks it
const ask = (name, type = 1) => {
  const head = Buffer.from([0x12, 0x34, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0]);
  const labels = Buffer.concat([...name.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
  return Buffer.concat([head, labels, Buffer.from([0, type, 0, 1])]);
};
const lookup = (n) => (n === 'abc.lan.vuemesh.com' ? '10.42.0.1' : null);
const r = L.dnsReply(ask('ABC.lan.vuemesh.com'), lookup);
assert.equal(r.readUInt16BE(0), 0x1234, 'the same id');
assert.equal(r.readUInt16BE(6), 1, 'one answer');
assert.deepEqual([...r.subarray(r.length - 4)], [10, 42, 0, 1], 'the hotspot’s address');
assert.equal(L.dnsReply(ask('abc.lan.vuemesh.com', 28), lookup).readUInt16BE(6), 0, 'no IPv6 address: phones use the IPv4 one');
assert.equal(L.dnsReply(ask('example.com'), lookup), null, 'anything else is asked of the internet');
assert.equal(L.dnsReply(Buffer.from([1, 2, 3]), lookup), null, 'nonsense is ignored');
ok("addresses: the show's name answers with the hotspot's address (any capitals), IPv6 none, others passed on");

const lin = L.hotspotPlan(true, { platform: 'linux', dev: 'wlp1s0', ssid: 'VUEMesh AB', pass: 'secret123x', ip: '10.42.0.1', captive: true, name: 'abc.lan.vuemesh.com' });
assert.match(lin.conf.text, /^address=\/abc\.lan\.vuemesh\.com\/10\.42\.0\.1$/m);
assert.match(lin.conf.text, /address=\/captive\.apple\.com\/10\.42\.0\.1/, 'no internet: the "am I online?" checks come here (the welcome page)');
assert.ok(!L.hotspotPlan(true, { platform: 'linux', captive: false, name: 'abc.lan.vuemesh.com' }).conf.text.includes('apple'), 'with internet, not');
const flat = lin.run.map((c) => c.join(' '));
assert.ok(flat.some((c) => c.includes('ifname wlp1s0') && c.includes('ssid VUEMesh AB')) && flat.some((c) => c.includes('ipv4.method shared') && c.includes('wifi-sec.psk secret123x')) && flat.at(-1) === 'nmcli connection up vuemesh-hotspot');
assert.equal(L.hotspotPlan(false, { platform: 'linux' }).run[0].join(' '), 'nmcli connection down vuemesh-hotspot');
const win = L.hotspotPlan(true, { platform: 'win32', ssid: "Rosa's", pass: 'pw' });
assert.equal(win.run[0][0], 'powershell');
assert.match(win.run[0].at(-1), /StartTetheringAsync/);
assert.match(win.run[0].at(-1), /\$cfg\.Ssid = 'Rosa''s'/, 'quotes in the name are safe');
assert.match(L.hotspotPlan(true, { platform: 'darwin' }).unsupported, /Mac/);
ok('the hotspot: NetworkManager on Linux (with its address answers), Windows Mobile Hotspot, and why not on a Mac');

assert.equal(L.wifiQr('VUEMesh A;B', 'p:w"x'), String.raw`WIFI:T:WPA;S:VUEMesh A\;B;P:p\:w\"x;;`);
ok('the Wi-Fi code a camera app joins from (; : " escaped)');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const dir = mkdtempSync(join(tmpdir(), 'vm-csr-'));
const pem = `-----BEGIN CERTIFICATE REQUEST-----\n${L.csrFor('abc.lan.vuemesh.com', privateKey).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE REQUEST-----\n`;
writeFileSync(join(dir, 'r.csr'), pem);
const v = spawnSync('openssl', ['req', '-in', join(dir, 'r.csr'), '-noout', '-verify', '-text'], { encoding: 'utf8' });
if (v.error) console.log('(openssl not found: the certificate request not checked)');
else {
  assert.equal(v.status, 0, v.stderr);
  assert.match(v.stdout + v.stderr, /verify OK|Certificate request self-signature verify OK/i);
  assert.match(v.stdout, /CN\s*=\s*abc\.lan\.vuemesh\.com/);
  assert.match(v.stdout, /DNS:abc\.lan\.vuemesh\.com/);
  ok('its certificate request: openssl reads it, its signature checks, the name in it and as its DNS name');
}

assert.ok(L.okOrigin('https://vuemesh.com') && L.okOrigin('http://localhost:8790') && !L.okOrigin('https://evil.example'));
ok("only VUEMesh's own pages (and this computer) talk to it");
console.log('\nAll local show tests passed.');
