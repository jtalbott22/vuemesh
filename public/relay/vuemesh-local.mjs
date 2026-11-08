#!/usr/bin/env node
// VUEMesh local show: this computer becomes the show's own Wi-Fi and its own server, so a show runs
// with no internet and no venue router at all.
//
//   Linux:    sudo node vuemesh-local.mjs
//   Windows:  node vuemesh-local.mjs            (in a PowerShell opened with "Run as administrator")
//
// What it does, while it runs:
//   - starts this computer's Wi-Fi hotspot (its name and password show in the studio as a QR code:
//     a phone's camera joins it from that);
//   - answers for the show's own address, https://<name>.lan.vuemesh.com, on that hotspot, with a
//     real certificate (got once while online, from Let's Encrypt; nothing to install on phones);
//   - serves the app and the joining there, so a phone that has never opened VUEMesh joins by
//     scanning the show's code, with no internet;
//   - pops up the "you're on the show's Wi-Fi" page a guest network shows, with the show's address;
//   - talks to the studio on this computer (http://localhost:8936), which adds its phones to the
//     ones that join through the internet as usual.
//
// Needs Node.js 18 or later. Nothing else to install. Online the first time (it fetches the app and
// its certificate, and keeps them for next time, in ~/.vuemesh-local).
//
// Options:
//   --port 8936         the studio's way in (this computer only)
//   --https 443 --http 80 --dns 53   the hotspot's ports (tests use others)
//   --site <dir>        the app's files from here (else the copy it fetched)
//   --cert <pem> --key <pem>         a certificate of your own (else the Let's Encrypt one)
//   --name <host>       the show's address (else <random>.lan.vuemesh.com, made once)
//   --ip <address>      the hotspot's address to answer with (else 10.42.0.1 on Linux, 192.168.137.1 on Windows)
//   --no-hotspot        don't start a hotspot (this computer's Wi-Fi is the venue's, or a router does it)
//   --dns-own           answer addresses itself on --dns (Windows; Linux uses the hotspot's own)
//   --dry-run           say what it would run to start the hotspot, and don't
//   --staging           Let's Encrypt's test certificates (for trying this out)
//   --origins a,b       other studio addresses allowed to talk to it

import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import os from 'node:os';
import { createHash, randomBytes, randomUUID, generateKeyPairSync, createPrivateKey, createPublicKey, sign as signData, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const VERSION = 1;
const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt;
};
const flag = (name) => process.argv.includes('--' + name);
const SITE_URL = (arg('site-url', process.env.VUEMESH_SITE || 'https://vuemesh.com')).replace(/\/$/, '');
const API_URL = (arg('api', process.env.VUEMESH_API || `${SITE_URL}/api`)).replace(/\/$/, '');
const HOME = arg('home', process.env.VUEMESH_LOCAL_HOME || join(os.homedir(), '.vuemesh-local'));
const CTRL_PORT = Number(arg('port', 8936));
const HTTPS_PORT = Number(arg('https', 443));
const HTTP_PORT = Number(arg('http', 80));
const DNS_PORT = Number(arg('dns', 53));
const HERE = dirname(fileURLToPath(import.meta.url));
const EXTRA_ORIGINS = String(arg('origins', '')).split(',').map((s) => s.trim()).filter(Boolean);
const LAN_DOMAIN = 'lan.vuemesh.com';
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
mkdirSync(HOME, { recursive: true });

// ---- what it keeps between runs: its name, the hotspot's, the certificate ----
const statePath = join(HOME, 'state.json');
const state = (() => {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return {}; }
})();
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const words = (n) => [...randomBytes(n)].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
state.slug ||= words(10);
state.token ||= randomBytes(24).toString('base64url');
state.pass ||= words(10);
save();
const NAME = arg('name', `${state.slug}.${LAN_DOMAIN}`);

// ---- the studio's addresses: VUEMesh itself, this computer, and anything named with --origins ----
export const okOrigin = (o) =>
  !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) || /^https:\/\/([a-z0-9-]+\.)*vuemesh\.com$/i.test(o) || EXTRA_ORIGINS.includes(o);

// ---------------------------------------------------------------- the app ----
// The server's own code (the same that runs in the cloud): next to this file, in this repository,
// or fetched from the site into ~/.vuemesh-local/lib.
const LIB_FILES = ['core.mjs', 'common.mjs', 'store-memory.mjs'];
async function libDir() {
  for (const d of [arg('lib'), join(HERE, 'lib'), join(HERE, '..', '..', 'aws', 'functions', 'lib'), join(HOME, 'lib')].filter(Boolean)) {
    if (LIB_FILES.every((f) => existsSync(join(d, f)))) return d;
  }
  const d = join(HOME, 'lib');
  mkdirSync(d, { recursive: true });
  for (const f of LIB_FILES) {
    const r = await fetch(`${SITE_URL}/relay/lib/${f}`);
    if (!r.ok) throw new Error(`Couldn't fetch ${f} from ${SITE_URL} (${r.status}): this needs the internet the first time`);
    writeFileSync(join(d, f), Buffer.from(await r.arrayBuffer()));
  }
  return d;
}
// The app's files: --site, or a copy fetched from the site (refreshed whenever it's online).
async function siteDir() {
  if (arg('site')) return resolve(arg('site'));
  const d = join(HOME, 'site');
  try {
    const r = await fetch(`${SITE_URL}/app-files.json`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(String(r.status));
    const { files = [] } = await r.json();
    let got = 0;
    for (const f of files) {
      if (typeof f !== 'string' || f.includes('..')) continue;
      const res = await fetch(`${SITE_URL}/${f}`);
      if (!res.ok) continue;
      mkdirSync(dirname(join(d, f)), { recursive: true });
      writeFileSync(join(d, f), Buffer.from(await res.arrayBuffer()));
      got++;
    }
    log(`The app: ${got} files from ${SITE_URL}, kept in ${d}`);
  } catch (e) {
    if (!existsSync(join(d, 'cam.html'))) throw new Error(`Couldn't fetch the app from ${SITE_URL} (${e.message}), and there's no copy yet: this needs the internet the first time`);
    log('The app: offline, so the copy from last time');
  }
  return d;
}

// ------------------------------------------------- the smallest WebSocket server (RFC 6455) ----
function frame(op, data) {
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x80 | op, n]);
  else if (n < 65536) head = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | op;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, data]);
}
function wsAccept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = { open: true, onmessage: null, onclose: null };
  const end = () => {
    if (!ws.open) return;
    ws.open = false;
    ws.onclose?.();
  };
  ws.send = (text) => ws.open && !socket.destroyed && socket.write(frame(1, Buffer.from(text)));
  ws.close = () => {
    if (!ws.open) return;
    try { socket.end(frame(8, Buffer.alloc(0))); } catch {}
    end();
  };
  let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0), frags = [];
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      let len = b1 & 127, off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 1 << 20) return socket.destroy(); // (signalling is small)
      const masked = b1 & 128;
      if (buf.length < off + (masked ? 4 : 0) + len) return;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      const data = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      const op = b0 & 15;
      if (op === 8) return ws.close();
      if (op === 9) {
        socket.write(frame(10, data));
        continue;
      }
      if (op === 10) continue;
      frags.push(data);
      if (!(b0 & 128)) continue;
      const text = Buffer.concat(frags).toString('utf8');
      frags = [];
      ws.onmessage?.(text);
    }
  });
  socket.on('close', end);
  socket.on('error', end);
  return ws;
}

// ------------------------------------------------------------- answering for addresses (DNS) ----
// On the hotspot, phones ask this computer where things are. The show's address is here; so, with
// no internet, are the addresses phones check to see if they're online (their answer from here pops
// up the "you're on the show's Wi-Fi" page). Anything else is asked of the internet, when there is one.
export const PROBES = ['captive.apple.com', 'www.apple.com', 'connectivitycheck.gstatic.com', 'connectivitycheck.android.com', 'clients1.google.com', 'clients3.google.com', 'www.msftconnecttest.com', 'www.msftncsi.com', 'detectportal.firefox.com', 'nmcheck.gnome.org'];
function qname(msg, off) {
  const labels = [];
  for (let n = 0; off < msg.length && (n = msg[off]) && labels.length < 64; off += n + 1) {
    if (n & 0xc0) return null; // (no compression in a question)
    labels.push(msg.subarray(off + 1, off + 1 + n).toString('latin1'));
  }
  return { name: labels.join('.').toLowerCase(), end: off + 1 };
}
/** The answer to one DNS question: an A record for a name this answers for, else null (ask elsewhere). */
export function dnsReply(msg, lookup) {
  if (msg.length < 17 || msg.readUInt16BE(4) !== 1) return null;
  const q = qname(msg, 12);
  if (!q || q.end + 4 > msg.length) return null;
  const type = msg.readUInt16BE(q.end), ip = lookup(q.name);
  if (!ip) return null;
  const question = msg.subarray(12, q.end + 4);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(msg.readUInt16BE(0), 0); // id
  head.writeUInt16BE(0x8180 | (msg.readUInt16BE(2) & 0x0100), 2); // a response, recursion as asked, no error
  head.writeUInt16BE(1, 4);
  head.writeUInt16BE(type === 1 ? 1 : 0, 6); // (A: the address; AAAA and the rest: none, so phones use the A)
  if (type !== 1) return Buffer.concat([head, question]);
  const ans = Buffer.alloc(16);
  ans.writeUInt16BE(0xc00c, 0);
  ans.writeUInt16BE(1, 2);
  ans.writeUInt16BE(1, 4);
  ans.writeUInt32BE(30, 6);
  ans.writeUInt16BE(4, 10);
  ip.split('.').forEach((b, i) => (ans[12 + i] = Number(b)));
  return Buffer.concat([head, question, ans]);
}
function startDns(bind, port, lookup) {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, from) => {
    const r = dnsReply(msg, lookup);
    if (r) return sock.send(r, from.port, from.address);
    // (not ours: the internet's answer, if there is one)
    const up = dgram.createSocket('udp4');
    const t = setTimeout(() => up.close(), 2500);
    up.on('message', (m) => {
      clearTimeout(t);
      sock.send(m, from.port, from.address);
      up.close();
    });
    up.on('error', () => up.close());
    up.send(msg, 53, '1.1.1.1');
  });
  sock.on('error', (e) => log(`Couldn't answer addresses on ${bind}:${port} (${e.code || e.message})${process.platform === 'win32' ? ": Windows' hotspot may be answering them itself" : ''}`));
  sock.bind(port, bind, () => log(`Answering for ${NAME} on ${bind}:${port}`));
  return sock;
}

// ------------------------------------------------------------------- the hotspot ----
const HOTSPOT_IP = arg('ip', process.platform === 'win32' ? '192.168.137.1' : '10.42.0.1');
const SSID = `VUEMesh ${state.slug.slice(0, 4).toUpperCase()}`;
const DNSMASQ_CONF = '/etc/NetworkManager/dnsmasq-shared.d/vuemesh-local.conf';
const wifiEsc = (s) => String(s).replace(/[\\;,:"]/g, (c) => '\\' + c);
export const wifiQr = (ssid, pass) => `WIFI:T:WPA;S:${wifiEsc(ssid)};P:${wifiEsc(pass)};;`;
const hot = { on: false, error: '', captive: false };

function wifiDevice() {
  const r = spawnSync('nmcli', ['-t', '-f', 'DEVICE,TYPE', 'device'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').map((l) => l.split(':')).find(([, t]) => t === 'wifi')?.[0] || null;
}
const WIN_HOTSPOT = (on, ssid, pass) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$actTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and !$_.IsGenericMethod })[0]
function AwaitAction($op) { $actTask.Invoke($null, @($op)).Wait(-1) | Out-Null }
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $profile) { $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles() | Select-Object -First 1 }
if (-not $profile) { throw 'Windows needs a network connection of some kind to start its hotspot (an Ethernet cable is enough).' }
$null = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]
$tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
${on ? `$cfg = $tm.GetCurrentAccessPointConfiguration()
$cfg.Ssid = '${ssid.replace(/'/g, "''")}'
$cfg.Passphrase = '${pass.replace(/'/g, "''")}'
AwaitAction ($tm.ConfigureAccessPointAsync($cfg))
$r = Await ($tm.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])` : `$r = Await ($tm.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])`}
if ($r.Status -ne 'Success') { throw "$($r.Status) $($r.AdditionalErrorMessage)" }
'ok'`;

/** What starting (or stopping) the hotspot runs on this computer. */
export function hotspotPlan(on, { platform = process.platform, dev = 'wlan0', ssid = SSID, pass = state.pass, ip = HOTSPOT_IP, captive = false, name = NAME } = {}) {
  if (platform === 'linux') {
    const conf = [`address=/${name}/${ip}`, ...(captive ? PROBES.map((p) => `address=/${p}/${ip}`) : [])].join('\n') + '\n';
    return on
      ? { conf: { path: DNSMASQ_CONF, text: conf }, run: [
          ['nmcli', 'connection', 'delete', 'vuemesh-hotspot'],
          ['nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', dev, 'con-name', 'vuemesh-hotspot', 'autoconnect', 'no', 'ssid', ssid],
          ['nmcli', 'connection', 'modify', 'vuemesh-hotspot', '802-11-wireless.mode', 'ap', '802-11-wireless.band', 'bg', 'ipv4.method', 'shared', 'ipv4.addresses', `${ip}/24`, 'ipv6.method', 'disabled', 'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', pass],
          ['nmcli', 'connection', 'up', 'vuemesh-hotspot'],
        ] }
      : { run: [['nmcli', 'connection', 'down', 'vuemesh-hotspot']] };
  }
  if (platform === 'win32') return { run: [['powershell', '-NoProfile', '-NonInteractive', '-Command', WIN_HOTSPOT(on, ssid, pass)]] };
  return { unsupported: platform === 'darwin' ? "A Mac can't make a Wi-Fi hotspot on its own (only share a wired connection): use a router, or a Linux or Windows computer" : `No hotspot on ${platform}` };
}

async function online() {
  try {
    await Promise.race([dns.resolve4('vuemesh.com'), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
    return true;
  } catch {
    return false;
  }
}

async function setHotspot(on) {
  if (flag('no-hotspot')) throw new Error('The hotspot is off by choice here (--no-hotspot): phones join this computer’s network as it is');
  const captive = on && !(await online()); // (no internet: answer the "am I online?" checks, for the welcome page)
  const plan = hotspotPlan(on, { dev: process.platform === 'linux' ? wifiDevice() || 'wlan0' : undefined, captive });
  if (plan.unsupported) throw new Error(plan.unsupported);
  if (flag('dry-run')) {
    if (plan.conf) log(`(dry run) would write ${plan.conf.path}:\n${plan.conf.text}`);
    for (const c of plan.run) log(`(dry run) would run: ${c[0]} ${c.slice(1).map((a) => (/\s/.test(a) ? JSON.stringify(a.length > 80 ? a.slice(0, 80) + '…' : a) : a)).join(' ')}`);
    Object.assign(hot, { on, captive, error: '', dry: true });
    return;
  }
  if (plan.conf) {
    try {
      mkdirSync(dirname(plan.conf.path), { recursive: true });
      writeFileSync(plan.conf.path, plan.conf.text);
    } catch (e) {
      throw new Error(`Couldn't set the show's address up (${e.code || e.message}): start this with sudo`);
    }
  }
  for (const [i, c] of plan.run.entries()) {
    const r = spawnSync(c[0], c.slice(1), { encoding: 'utf8', timeout: 60000 });
    const quiet = process.platform === 'linux' && on && i === 0; // (deleting an old one that isn't there is fine)
    if (r.status !== 0 && !quiet) throw new Error(`${c[0]} failed: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}`);
  }
  Object.assign(hot, { on, captive, error: '' });
  log(on ? `Hotspot on: "${SSID}" (password ${state.pass}), at ${HOTSPOT_IP}${captive ? ' (no internet: phones get the welcome page)' : ''}` : 'Hotspot off');
}

// ------------------------------------------------- the welcome page (a guest network's "accept") ----
const accepted = new Set(); // phones that have seen it (by address): their "am I online?" checks pass from then on
const shows = new Map(); // event id → { id, title, hostKey, at }
const latestShow = () => [...shows.values()].sort((a, b) => b.at - a.at)[0] || null;
const httpsBase = () => `https://${NAME}${HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function welcome(done) {
  const show = latestShow();
  const link = show ? `${httpsBase()}/cam?e=${show.id}` : `${httpsBase()}/cam`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VUEMesh</title>
<style>body{font:17px/1.45 system-ui,sans-serif;margin:0;padding:28px 22px;background:#0b0e17;color:#fff;text-align:center}a.b{display:block;margin:18px auto;padding:14px;border-radius:12px;background:#5b8cff;color:#fff;font-weight:700;text-decoration:none;max-width:340px}small{color:#aab;display:block;margin-top:14px}code{word-break:break-all;color:#cde}</style>
<h1 style="font-size:1.4rem">${done ? 'All set' : "You're on the show's Wi-Fi"}</h1>
<p>${show ? `<b>${esc(show.title || show.id)}</b><br>` : ''}To join with your camera, scan the show's code with your camera app, or open this in your browser:</p>
<p><code>${esc(link)}</code></p>
<a class="b" href="${esc(link)}">Open the show</a>
${done ? '<small>You can close this now.</small>' : '<a class="b" style="background:#2a3350" href="/accept">Done</a><small>(This page can’t use your camera. If “Open the show” stays in here, tap Done, then scan the show’s code.)</small>'}`;
}
const SUCCESS = {
  apple: '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>',
  msft: 'Microsoft Connect Test',
  ncsi: 'Microsoft NCSI',
  firefox: 'success\n',
  gnome: 'NetworkManager is online\n',
};
function probeOk(host, path) {
  if (/apple\.com$/.test(host)) return [200, SUCCESS.apple];
  if (/generate_?204|gen_204/.test(path)) return [204, ''];
  if (host === 'www.msftconnecttest.com') return [200, SUCCESS.msft];
  if (host === 'www.msftncsi.com') return [200, SUCCESS.ncsi];
  if (host === 'detectportal.firefox.com') return [200, SUCCESS.firefox];
  if (host === 'nmcheck.gnome.org') return [200, SUCCESS.gnome];
  return [204, ''];
}
export function portal(req, res) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const url = new URL(req.url, 'http://x');
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (host === NAME) {
    res.writeHead(301, { location: `${httpsBase()}${url.pathname}${url.search}` });
    return res.end();
  }
  if (url.pathname === '/accept') {
    accepted.add(ip);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(welcome(true));
  }
  if (PROBES.includes(host) && accepted.has(ip)) {
    const [code, body] = probeOk(host, url.pathname);
    res.writeHead(code, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    return res.end(body);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(welcome(false));
}

// ------------------------------------------------- the certificate (Let's Encrypt, DNS check) ----
// Let's Encrypt gives a certificate for the show's name once a record it asks for is in the name's
// DNS. vuemesh.com's DNS is the site's: its API puts the record in for this name (and only for the
// one that registered it, with its secret), and takes it out after.
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => createHash('sha256').update(b).digest();
function der(tag, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
}
const seq = (...p) => der(0x30, ...p);
const oid = (bytes) => der(0x06, bytes);
/** A certificate request (PKCS #10) for one DNS name, signed with an EC P-256 key. */
export function csrFor(name, key) {
  const spki = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const cn = seq(der(0x31, seq(oid([0x55, 0x04, 0x03]), der(0x0c, Buffer.from(name)))));
  const san = seq(oid([0x55, 0x1d, 0x11]), der(0x04, seq(der(0x82, Buffer.from(name)))));
  const attrs = der(0xa0, seq(oid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x0e]), der(0x31, seq(san))));
  const info = seq(der(0x02, [0]), cn, spki, attrs);
  const sig = signData('sha256', info, key);
  return seq(info, seq(oid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])), der(0x03, Buffer.concat([Buffer.from([0]), sig])));
}
function ecKey(path) {
  if (existsSync(path)) return createPrivateKey(readFileSync(path));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  return privateKey;
}
async function acmeCert(eventId, hostKey) {
  const DIR = flag('staging') ? 'https://acme-staging-v02.api.letsencrypt.org/directory' : 'https://acme-v02.api.letsencrypt.org/directory';
  const acct = ecKey(join(HOME, 'acme-account.pem')), dkey = ecKey(join(HOME, 'domain-key.pem'));
  const jwk = (({ kty, crv, x, y }) => ({ crv, kty, x, y }))(createPublicKey(acct).export({ format: 'jwk' }));
  const thumb = b64u(sha256(`{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`));
  const dir = await (await fetch(DIR)).json();
  let nonce = null, kid = null;
  const getNonce = async () => nonce || (await fetch(dir.newNonce, { method: 'HEAD' })).headers.get('replay-nonce');
  const post = async (url, payload, again = true) => {
    const prot = b64u(JSON.stringify({ alg: 'ES256', nonce: await getNonce(), url, ...(kid ? { kid } : { jwk }) }));
    const body = payload === '' ? '' : b64u(JSON.stringify(payload));
    const sig = b64u(signData('sha256', Buffer.from(`${prot}.${body}`), { key: acct, dsaEncoding: 'ieee-p1363' }));
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/jose+json' }, body: JSON.stringify({ protected: prot, payload: body, signature: sig }) });
    nonce = r.headers.get('replay-nonce');
    const type = r.headers.get('content-type') || '';
    const data = type.includes('json') ? await r.json() : await r.text();
    if (!r.ok) {
      if (again && data?.type?.endsWith(':badNonce')) return post(url, payload, false);
      throw new Error(`Let's Encrypt: ${data?.detail || r.status}`);
    }
    return { r, data };
  };
  const ours = async (method, path, body) => {
    const r = await fetch(`${API_URL}${path}`, { method, headers: { 'content-type': 'application/json', ...(hostKey ? { 'x-host-key': hostKey } : {}) }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`VUEMesh: ${data.error || r.status}`);
    return data;
  };
  await ours('POST', `/events/${eventId}/lan`, { slug: state.slug, token: state.token });
  kid = (await post(dir.newAccount, { termsOfServiceAgreed: true })).r.headers.get('location');
  const order = await post(dir.newOrder, { identifiers: [{ type: 'dns', value: NAME }] });
  const orderUrl = order.r.headers.get('location');
  const authz = (await post(order.data.authorizations[0], '')).data;
  const chal = authz.challenges.find((c) => c.type === 'dns-01');
  const value = b64u(sha256(`${chal.token}.${thumb}`));
  await ours('PUT', `/lan/${state.slug}/txt`, { token: state.token, value });
  try {
    // (the record seen from outside before Let's Encrypt is asked to look)
    const res = new dns.Resolver();
    res.setServers(['1.1.1.1', '8.8.8.8']);
    for (let i = 0; i < 40; i++) {
      const got = await res.resolveTxt(`_acme-challenge.${NAME}`).catch(() => []);
      if (got.some((t) => t.join('') === value)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await post(chal.url, {});
    for (let i = 0; ; i++) {
      const a = (await post(order.data.authorizations[0], '')).data;
      if (a.status === 'valid') break;
      if (a.status === 'invalid' || i > 30) throw new Error(`Let's Encrypt couldn't check the name: ${a.challenges?.find((c) => c.error)?.error?.detail || a.status}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    let o = (await post(order.data.finalize, { csr: b64u(csrFor(NAME, dkey)) })).data;
    for (let i = 0; o.status !== 'valid'; i++) {
      if (o.status === 'invalid' || i > 30) throw new Error(`Let's Encrypt didn't issue it (${o.status})`);
      await new Promise((r) => setTimeout(r, 2000));
      o = (await post(orderUrl, '')).data;
    }
    const pem = (await post(o.certificate, '')).data;
    writeFileSync(join(HOME, 'cert.pem'), pem);
    return { cert: pem, key: readFileSync(join(HOME, 'domain-key.pem')) };
  } finally {
    await ours('DELETE', `/lan/${state.slug}/txt`, { token: state.token }).catch(() => {});
  }
}
const cert = { state: 'none', error: '', tls: null };
function loadCert() {
  const certPath = arg('cert') || join(HOME, 'cert.pem'), keyPath = arg('key') || join(HOME, 'domain-key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  const pem = readFileSync(certPath);
  let days = Infinity;
  try { days = (new Date(new X509Certificate(pem).validTo) - Date.now()) / 864e5; } catch {}
  return { cert: pem, key: readFileSync(keyPath), days };
}
async function ensureCert(eventId, hostKey) {
  if (arg('cert') || cert.state === 'getting') return;
  const have = loadCert();
  if (have && have.days > 30) return;
  if (!(await online())) return;
  cert.state = 'getting';
  log(`Getting the certificate for ${NAME}${flag('staging') ? " (Let's Encrypt's test one)" : ''}…`);
  try {
    const tls = await acmeCert(eventId, hostKey);
    useCert(tls);
    log(`Certificate ready for ${NAME}`);
  } catch (e) {
    cert.state = have ? 'ready' : 'error';
    cert.error = e.message;
    log(`No certificate: ${e.message}`);
  }
}

// --------------------------------------------------------------------------- the servers ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/markdown; charset=utf-8' };
let SITE, api, signal, store;
const sockets = new Map();
const post = async (connId, data) => {
  const ws = sockets.get(connId);
  if (!ws?.open) return false;
  ws.send(JSON.stringify(data));
  return true;
};
async function upgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const connectionId = randomUUID();
  const r = await signal({ route: '$connect', connectionId, query: Object.fromEntries(url.searchParams) }, { store, post });
  if (r.status !== 200) {
    socket.write(`HTTP/1.1 ${r.status} Refused\r\n\r\n`);
    return socket.destroy();
  }
  const ws = wsAccept(req, socket, head);
  sockets.set(connectionId, ws);
  ws.onmessage = (text) => signal({ route: '$default', connectionId, body: text }, { store, post }).catch(() => {});
  ws.onclose = () => {
    sockets.delete(connectionId);
    signal({ route: '$disconnect', connectionId }, { store, post }).catch(() => {});
  };
}
async function body(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    if ((n += c.length) > 1 << 20) throw new Error('too big');
    chunks.push(c);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined; } catch { return undefined; }
}
// The show's pages and joining, on the hotspot
async function serve(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || NAME}`);
  try {
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end(`window.VM_CONFIG = { api: '/api', ws: 'wss://${url.host}/ws', local: true };`);
    }
    if (url.pathname.startsWith('/api/')) {
      // (only what a phone needs to join: the show, and naming a kiosk show; nothing is made here)
      const seg = url.pathname.split('/').filter(Boolean);
      const okRoute = seg[1] === 'events' && /^[A-Z0-9]{6}$/i.test(seg[2] || '') && ((req.method === 'GET' && seg.length === 3) || (req.method === 'POST' && seg[3] === 'name'));
      if (!okRoute) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Not on a local show' }));
      }
      const out = await api({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: {}, body: await body(req), ip: req.socket.remoteAddress || '' }, { store, cdn: url.origin, flags: {}, adminKeyHashes: [], presign: async () => { throw new Error('no uploads on a local show'); }, listFilms: async () => [], deleteFilms: async () => 0 });
      res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(out.body));
    }
    let path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!extname(path)) path += '.html';
    const file = join(SITE, normalize(path));
    if (!file.startsWith(SITE) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(String(e.message || e));
  }
}
const status = () => ({
  local: 'vuemesh', version: VERSION, os: process.platform, name: NAME, url: httpsBase(), https: !!cert.tls,
  cert: cert.tls ? 'ready' : cert.state, certError: cert.error || undefined,
  hotspot: { on: hot.on, dry: !!hot.dry, captive: hot.captive, error: hot.error || undefined, ssid: SSID, pass: state.pass, ip: HOTSPOT_IP, qr: wifiQr(SSID, state.pass), can: !flag('no-hotspot') && !hotspotPlan(true).unsupported, why: flag('no-hotspot') ? 'off by choice (--no-hotspot)' : hotspotPlan(true).unsupported },
  shows: [...shows.values()].map(({ id, title }) => ({ id, title, link: `${httpsBase()}/cam?e=${id}` })),
});
// The studio's way in: this computer only, and only from VUEMesh's own pages
async function control(req, res) {
  const origin = req.headers.origin;
  const cors = okOrigin(origin) ? { 'access-control-allow-origin': origin || '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-private-network': 'true', vary: 'origin' } : {};
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
    res.end(JSON.stringify(obj));
  };
  if (!okOrigin(origin)) return send(403, { error: 'Not from VUEMesh' });
  if (req.method === 'OPTIONS') return send(204, {});
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/status' && req.method === 'GET') return send(200, status());
    if (url.pathname === '/event' && req.method === 'POST') {
      // the studio's show: phones on the hotspot join it here, with the studio's own key
      const b = (await body(req)) || {};
      const ev = b.ev || {};
      const id = String(ev.id || '').toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(id) || !b.hostKey) return send(400, { error: 'The show and its key' });
      const meta = { ...ev, id, hostKeyHash: createHash('sha256').update(String(b.hostKey)).digest('hex'), ttl: Math.floor(Date.now() / 1000) + 3 * 86400 };
      delete meta.live;
      if (!(await store.putEventIfAbsent(meta))) await store.updateEvent(id, meta);
      shows.set(id, { id, title: ev.title || id, hostKey: String(b.hostKey), at: Date.now() });
      ensureCert(id, String(b.hostKey)); // (in the background: online, and the certificate's missing or old)
      return send(200, status());
    }
    if (url.pathname === '/hotspot' && req.method === 'POST') {
      const b = (await body(req)) || {};
      try {
        await setHotspot(!!b.on);
      } catch (e) {
        hot.error = e.message;
        return send(500, { error: e.message, ...status() });
      }
      return send(200, status());
    }
    send(404, { error: 'Unknown' });
  } catch (e) {
    send(500, { error: e.message });
  }
}

let httpsServer = null;
function useCert(tls) {
  cert.tls = tls;
  cert.state = 'ready';
  cert.error = '';
  if (httpsServer) return httpsServer.setSecureContext({ cert: tls.cert, key: tls.key });
  httpsServer = https.createServer({ cert: tls.cert, key: tls.key }, serve);
  httpsServer.on('upgrade', upgrade);
  httpsServer.on('error', (e) => log(`The show's address can't be served on port ${HTTPS_PORT} (${e.code || e.message})${e.code === 'EACCES' ? ': start this with sudo / as administrator' : ''}`));
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => log(`The show's address: ${httpsBase()}`));
}

async function main() {
  const lib = await libDir();
  ({ api, signal } = await import(pathToFileURL(join(lib, 'core.mjs')).href));
  store = (await import(pathToFileURL(join(lib, 'store-memory.mjs')).href)).memoryStore();
  SITE = await siteDir();
  const have = loadCert();
  if (have) useCert(have);
  const web = http.createServer(portal);
  web.on('error', (e) => log(`The welcome page can't be served on port ${HTTP_PORT} (${e.code || e.message})`));
  web.listen(HTTP_PORT, '0.0.0.0');
  const ctl = http.createServer(control);
  ctl.on('upgrade', (req, socket, head) => (okOrigin(req.headers.origin) ? upgrade(req, socket, head) : socket.destroy()));
  ctl.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${CTRL_PORT} is in use: is this already running?` : e.message);
    process.exit(1);
  });
  ctl.listen(CTRL_PORT, '127.0.0.1', () => {
    log(`VUEMesh local show ready: the studio finds it at http://localhost:${CTRL_PORT}`);
    log(`The show's address: ${NAME}${have ? '' : ' (its certificate comes once the studio connects, while online)'}`);
    log('Leave this window open during the show. Ctrl+C to stop (and the hotspot with it).');
  });
  if (flag('dns-own') || process.platform === 'win32') startDns(arg('dns-bind', process.platform === 'win32' ? HOTSPOT_IP : '0.0.0.0'), DNS_PORT, (n) => (n === NAME || (hot.captive && PROBES.includes(n)) ? HOTSPOT_IP : null));
  const stop = () => {
    if (hot.on && !hot.dry) {
      try {
        const plan = hotspotPlan(false);
        for (const c of plan.run || []) spawnSync(c[0], c.slice(1), { timeout: 20000 });
      } catch {}
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
