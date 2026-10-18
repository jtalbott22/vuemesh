// Local stand-in for the AWS stack: serves public/, runs the same core API and
// signaling code with an in-memory store, and accepts "published" uploads.
// Phones need HTTPS for the camera, so on a real LAN test use the AWS deploy;
// this is for laptop testing (localhost counts as secure).
import http from 'node:http';
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
const TYPES = { '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.webp': 'image/webp' };

const post = async (connId, data) => {
  const ws = sockets.get(connId);
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(data));
  return true;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cdn = `http://${req.headers.host}`;
  try {
    if (url.pathname === '/config.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      return res.end(`window.VM_CONFIG = { api: '/api', ws: 'ws://${req.headers.host}/ws' };`);
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
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws') return socket.destroy();
  const connectionId = randomUUID();
  const r = await signal({ route: '$connect', connectionId, query: Object.fromEntries(url.searchParams) }, { store, post });
  if (r.status !== 200) {
    socket.write(`HTTP/1.1 ${r.status} Refused\r\n\r\n`);
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    sockets.set(connectionId, ws);
    ws.on('message', (data) => signal({ route: '$default', connectionId, body: data.toString() }, { store, post }));
    ws.on('close', () => {
      sockets.delete(connectionId);
      signal({ route: '$disconnect', connectionId }, { store, post });
    });
  });
});

server.listen(PORT, () => console.log(`VUEMesh dev server on http://localhost:${PORT}  (admin key: ${ADMIN_KEY}${flags.globe ? ', globe on' : ''})`));
