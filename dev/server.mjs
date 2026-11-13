// Local stand-in for the AWS stack: serves public/, runs the same core API and
// signaling code with an in-memory store, and accepts "published" uploads.
// Phones and other computers need HTTPS (a camera, a screen share and the page's own signing all
// need a secure address; only localhost counts as one over plain http). So it also serves HTTPS on
// PORT + 1000 with a self-signed certificate made by openssl (dev/.cert/, made once): another
// device opens https://<this computer's address>:<that port>, accepts the warning once, and joins.
import http from 'node:http';
import https from 'node:https';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { readdir, stat, rm } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { api, signal } from '../aws/functions/lib/core.mjs';
import { memoryStore } from '../aws/functions/lib/store-memory.mjs';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const UPLOADS = fileURLToPath(new URL('./uploads/', import.meta.url));
const PORT = Number(process.env.PORT || 8790);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || PORT + 1000);
const lanRank = (a) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : a.startsWith('172.') ? 2 : 3);
const lanAddresses = () => Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address).sort((x, y) => lanRank(x) - lanRank(y));
/** This computer's self-signed certificate (made with openssl the first time), or null without openssl. */
function devCert() {
  const dir = fileURLToPath(new URL('./.cert/', import.meta.url));
  const key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    try {
      mkdirSync(dir, { recursive: true });
      const alt = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((a) => 'IP:' + a)].join(',');
      const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '825', '-subj', '/CN=VUEMesh dev', '-addext', 'subjectAltName=' + alt];
      // (openssl on the path, or the one Git for Windows brings)
      const tries = ['openssl', ...[process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean).map((d) => join(d, 'Git', 'usr', 'bin', 'openssl.exe'))];
      const made = tries.some((exe) => {
        try {
          execFileSync(exe, args, { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      });
      if (!made) return null;
    } catch {
      return null;
    }
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
let httpsUp = false;
const store = memoryStore();
// Local admin key: set ADMIN_KEY, or use "dev-admin".
const ADMIN_KEY = process.env.ADMIN_KEY || 'dev-admin';
const flags = { globe: process.env.GLOBE === 'true', publish: process.env.PUBLISH === 'true' };
async function listFilms(prefix) {
  const out = [];
  const walk = async (dir) => {
    for (const name of await readdir(dir).catch(() => [])) {
      const full = join(dir, name);
      const st = await stat(full);
      if (st.isDirectory()) await walk(full);
      else out.push({ key: full.slice(UPLOADS.length).replace(/\\/g, '/'), size: st.size, lastModified: st.mtimeMs });
    }
  };
  await walk(UPLOADS);
  return out.filter((f) => f.key.startsWith(prefix));
}
async function deleteFilms(prefix) {
  const files = await listFilms(prefix);
  await Promise.all(files.map((f) => rm(join(UPLOADS, f.key), { force: true })));
  return files.length;
}
const sockets = new Map();
// (tests: as if the internet went: every connection dropped, and nothing reaches the server, until it's back)
let offline = false;
let offlinePages = false; // (and the pages too: as for a phone with no internet at all)
// (tests: a connection that has quietly died on the way, as a network blip can leave one: the server
// takes it for gone, nothing reaches it and nothing from it arrives, but its page never hears it close)
const roles = new Map(), silenced = new Set();
const TYPES = { '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

const post = async (connId, data) => {
  const ws = sockets.get(connId);
  if (!ws || ws.readyState !== 1 || silenced.has(connId)) return false;
  ws.send(JSON.stringify(data));
  return true;
};

const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cdn = `http://${req.headers.host}`;
  if (url.pathname === '/_dev/offline') {
    offline = url.searchParams.get('on') === '1';
    offlinePages = offline && url.searchParams.get('pages') === '1';
    if (offline) for (const ws of sockets.values()) ws.terminate();
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(offline ? 'offline' : 'online');
  }
  if (url.pathname === '/_dev/silence') {
    const role = url.searchParams.get('role') || 'host';
    const ids = [...sockets.keys()].filter((id) => roles.get(id) === role && !silenced.has(id));
    for (const id of ids) {
      silenced.add(id);
      await signal({ route: '$disconnect', connectionId: id }, { store, post });
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end(`silenced ${ids.length}`);
  }
  if (offline && (offlinePages || url.pathname.startsWith('/api/'))) return req.socket.destroy();
  try {
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`window.VM_CONFIG = { api: '/api', ws: '${req.socket.encrypted ? 'wss' : 'ws'}://${req.headers.host}/ws' };`);
    }
    // (where another device on this network can open the show: the studio's links use it when it runs on localhost)
    if (url.pathname === '/_dev/lan') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ https: httpsUp ? lanAddresses().map((a) => `https://${a}:${HTTPS_PORT}`) : [] }));
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      let body;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined; } catch {}
      const out = await api(
        { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), v])), body, ip: req.socket.remoteAddress || '' },
        { store, cdn, presign: async (key) => `${cdn}/_put/${key}`, flags, adminKeyHashes: [createHash('sha256').update(ADMIN_KEY).digest('hex')], listFilms, deleteFilms },
      );
      res.writeHead(out.status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out.body));
    }
    if (url.pathname.startsWith('/_put/') && req.method === 'PUT') {
      const key = normalize(url.pathname.slice(6)).replace(/^(\.\.[/\\])+/, '');
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await mkdir(join(UPLOADS, key, '..'), { recursive: true });
      await writeFile(join(UPLOADS, key), Buffer.concat(chunks));
      res.writeHead(200, { 'access-control-allow-origin': '*' });
      return res.end();
    }
    let path = url.pathname;
    if (path.startsWith('/films/')) {
      const data = await readFile(join(UPLOADS, normalize(path)));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      return res.end(data);
    }
    // (What's new reads the changelog itself; the deploy copies it next to the pages)
    if (path === '/changelog.md') {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(await readFile(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url))));
    }
    if (path === '/') path = '/index.html';
    else if (!extname(path)) path += '.html';
    const file = join(ROOT, normalize(path));
    if (!file.startsWith(ROOT)) throw new Error('bad path');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
};

const server = http.createServer(handler);

const wss = new WebSocketServer({ noServer: true });
const onUpgrade = async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws' || offline) return socket.destroy();
  const connectionId = randomUUID();
  const r = await signal({ route: '$connect', connectionId, query: Object.fromEntries(url.searchParams) }, { store, post });
  if (r.status !== 200) {
    socket.write(`HTTP/1.1 ${r.status} Refused\r\n\r\n`);
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(connectionId, ws);
    roles.set(connectionId, url.searchParams.get('role'));
    ws.on('message', (data) => !silenced.has(connectionId) && signal({ route: '$default', connectionId, body: data.toString() }, { store, post }));
    ws.on('close', () => {
      sockets.delete(connectionId);
      roles.delete(connectionId);
      if (silenced.delete(connectionId)) return; // (already taken for gone)
      signal({ route: '$disconnect', connectionId }, { store, post });
    });
  });
};

server.on('upgrade', onUpgrade);
server.listen(PORT, () => console.log(`VUEMesh dev server on http://localhost:${PORT}  (admin key: ${ADMIN_KEY}${flags.globe ? ', globe on' : ''})`));
const tls = devCert();
if (tls) {
  const secure = https.createServer(tls, handler);
  secure.on('upgrade', onUpgrade);
  secure.on('error', (e) => console.log(`HTTPS for other devices is off: ${e.message}`));
  secure.listen(HTTPS_PORT, () => {
    httpsUp = true;
    console.log(`For phones and other computers: ${lanAddresses().map((a) => `https://${a}:${HTTPS_PORT}`).join('  ') || `https://localhost:${HTTPS_PORT}`}  (self-signed: accept the warning once)`);
  });
} else console.log('HTTPS for other devices is off (openssl not found): phones and other computers need it');
