#!/usr/bin/env node
// VUEMesh relay: takes the studio's program (picture and sound) from the browser and sends it
// on to an RTMP or RTMPS service (YouTube, Facebook, Twitch, Kick, Vimeo, LinkedIn, X…) with
// ffmpeg. Browsers can't send RTMP themselves, so this small helper runs next to the studio.
//
//   node vuemesh-relay.mjs                listen on this computer only (ws://localhost:8935)
//   node vuemesh-relay.mjs --port 9000    another port
//
// Needs Node.js 18 or later and ffmpeg (https://ffmpeg.org). Nothing else to install.
// It only listens on this computer, only takes connections from VUEMesh pages, and only
// sends to rtmp:// and rtmps:// addresses. Stream keys are never printed.

import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const PORT = Number(arg('port', process.env.VUEMESH_RELAY_PORT || 8935));
const HOST = arg('host', '127.0.0.1');
const FFMPEG = arg('ffmpeg', process.env.FFMPEG || 'ffmpeg');
const EXTRA_ORIGINS = String(arg('origins', process.env.VUEMESH_ORIGINS || '')).split(',').map((s) => s.trim()).filter(Boolean);
const VERSION = 2; // 2: "vcam:" — the program as a camera and microphone for Zoom, Teams or Meet
const VCAM_PORT = Number(arg('vcam-port', process.env.VUEMESH_VCAM_PORT || 9998));

// VUEMesh itself, this computer, and anything named with --origins
const okOrigin = (o) =>
  !o || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) || /^https:\/\/([a-z0-9-]+\.)*vuemesh\.com$/i.test(o) || EXTRA_ORIGINS.includes(o);

const ffmpegVersion = (() => {
  try {
    const r = spawnSync(FFMPEG, ['-hide_banner', '-version'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.split('\n')[0].match(/version (\S+)/)?.[1] || 'yes' : null;
  } catch {
    return null;
  }
})();

const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return 'the service';
  }
};

// ---- the smallest WebSocket server that does the job (RFC 6455) ----
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

// ---- the program as a camera (and microphone) on this computer ----
// Video-call apps only take cameras the operating system knows. On Linux, a v4l2loopback
// device is one (and a PulseAudio/PipeWire "null sink" is a microphone): ffmpeg writes the
// program straight into them. On Mac and Windows, OBS Studio makes the camera: the relay sends
// the program to OBS on this computer (UDP, port 9998), and OBS's Start Virtual Camera does
// the rest (its sound goes to a virtual cable such as BlackHole or VB-CABLE for the mic).
function vcamWay() {
  if (process.platform === 'linux') {
    let device = null;
    try {
      const devs = readdirSync('/sys/class/video4linux').map((d) => ({ d, name: readFileSync(`/sys/class/video4linux/${d}/name`, 'utf8').trim() }));
      const hit = devs.find((x) => /vuemesh/i.test(x.name)) || devs.find((x) => /loopback|dummy/i.test(x.name));
      if (hit) device = `/dev/${hit.d}`;
    } catch {}
    let sink = null;
    try {
      const r = spawnSync('pactl', ['list', 'short', 'sinks'], { encoding: 'utf8' });
      if (/\bVUEMesh\b/.test(r.stdout || '')) sink = 'VUEMesh';
    } catch {}
    if (device) return { way: 'v4l2', device, sink };
  }
  return { way: 'udp', udp: `udp://127.0.0.1:${VCAM_PORT}` };
}

function session(socket, origin) {
  let buf = Buffer.alloc(0), frags = [], fragOp = 0, ff = null, statsTimer = null, closed = false, target = '';
  const stats = {};
  const send = (obj) => {
    if (!closed && !socket.destroyed) socket.write(frame(1, Buffer.from(JSON.stringify(obj))));
  };
  const clean = (s) => (target && target !== 'vcam:' ? String(s).split(target).join(hostOf(target)) : String(s)); // never echo the key

  function startFfmpeg(m) {
    if (ff) return send({ t: 'error', message: 'Already streaming.' });
    target = String(m.target || '');
    const vcam = target === 'vcam:' ? vcamWay() : null;
    if (!vcam && (!/^rtmps?:\/\/[^\s'"<>]+$/i.test(target) || target.length > 2048)) return send({ t: 'error', message: 'Only rtmp:// and rtmps:// addresses can be streamed to (or vcam: for a camera on this computer).' });
    if (!ffmpegVersion) return send({ t: 'error', message: "ffmpeg isn't installed on this computer (or isn't on the PATH)." });
    const kbps = Math.max(500, Math.min(12000, Math.round(Number(m.kbps) || 4500)));
    const args = vcam?.way === 'v4l2'
      ? [
          '-hide_banner', '-loglevel', 'warning', '-stats', '-fflags', '+genpts', '-i', 'pipe:0',
          // straight into the loopback camera (raw frames), and the sound into the VUEMesh sink
          '-map', '0:v', '-pix_fmt', 'yuv420p', '-r', '30', '-f', 'v4l2', vcam.device,
          ...(vcam.sink ? ['-map', '0:a?', '-ac', '2', '-ar', '48000', '-f', 'pulse', '-device', vcam.sink, 'VUEMesh program'] : []),
        ]
      : vcam
        ? [
            '-hide_banner', '-loglevel', 'warning', '-stats', '-fflags', '+genpts', '-i', 'pipe:0',
            // to OBS on this computer, as quickly as possible (a camera shouldn't lag)
            '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '30',
            '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`,
            '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
            '-f', 'mpegts', `${vcam.udp}?pkt_size=1316`,
          ]
        : [
      '-hide_banner', '-loglevel', 'warning', '-stats', '-fflags', '+genpts', '-i', 'pipe:0',
      // what streaming services ask for: H.264, a keyframe every 2 s, constant frame rate, AAC
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
      '-r', '30', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-f', 'flv', target,
    ];
    ff = spawn(FFMPEG, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stdin.on('error', () => {});
    let last = '';
    ff.stderr.on('data', (d) => {
      for (const line of d.toString().split(/[\r\n]+/)) {
        if (!line.trim()) continue;
        const br = line.match(/bitrate=\s*([\d.]+)kbits\/s/), fps = line.match(/fps=\s*([\d.]+)/), sp = line.match(/speed=\s*([\d.]+)x/);
        if (br || fps) Object.assign(stats, { kbps: br ? +br[1] : stats.kbps, fps: fps ? +fps[1] : stats.fps, speed: sp ? +sp[1] : stats.speed });
        else last = clean(line.trim());
      }
    });
    ff.on('exit', (code) => {
      clearInterval(statsTimer);
      log(`stopped ${target === 'vcam:' ? 'the camera' : `streaming to ${hostOf(target)}`}${code ? ` (ffmpeg: ${last || code})` : ''}`);
      send({ t: 'ended', code, message: code ? last || `ffmpeg stopped (${code})` : 'Stream ended.' });
      ff = null;
    });
    statsTimer = setInterval(() => ff && send({ t: 'stats', ...stats }), 2000);
    if (vcam) log(vcam.way === 'v4l2' ? `the program is the camera ${vcam.device}${vcam.sink ? ' and the microphone "Monitor of VUEMesh"' : ' (no VUEMesh sound sink: picture only)'}` : `the program is going to OBS on this computer: ${vcam.udp} (add it as a Media Source, then Start Virtual Camera)`);
    else log(`streaming to ${hostOf(target)} at ${kbps} kbit/s (from ${origin || 'a local tool'})`);
    send({ t: 'started', ...(vcam ? { vcam } : {}) });
  }

  function stop() {
    if (!ff) return;
    const p = ff;
    try { p.stdin.end(); } catch {}
    setTimeout(() => p.exitCode === null && p.kill('SIGKILL'), 5000);
  }

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(statsTimer);
    stop();
    try { socket.end(frame(8, Buffer.alloc(0))); } catch {}
  }

  function onText(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.t === 'hello') send({ t: 'hello', relay: 'vuemesh', version: VERSION, ffmpeg: ffmpegVersion, vcam: vcamWay() });
    else if (m.t === 'start') startFfmpeg(m);
    else if (m.t === 'stop') stop();
  }

  function onBinary(data) {
    if (!ff?.stdin.writable) return;
    // ffmpeg is the slow end: hold the browser's data until it catches up
    if (!ff.stdin.write(data)) {
      socket.pause();
      ff.stdin.once('drain', () => socket.resume());
    }
  }

  socket.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 2) break;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const mlen = masked ? 4 : 0;
      if (buf.length < off + mlen + len) break;
      let payload = buf.subarray(off + mlen, off + mlen + len);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(off + mlen + len);
      if (op === 8) return close();
      if (op === 9) {
        socket.write(frame(10, payload));
        continue;
      }
      if (op === 10) continue;
      if (op !== 0) {
        fragOp = op;
        frags = [];
      }
      frags.push(payload);
      if (!fin) continue;
      const data = frags.length === 1 ? frags[0] : Buffer.concat(frags);
      frags = [];
      if (fragOp === 1) onText(data.toString('utf8'));
      else if (fragOp === 2) onBinary(data);
    }
  });
  socket.on('close', close);
  socket.on('error', close);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ relay: 'vuemesh', version: VERSION, ffmpeg: ffmpegVersion }));
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
  if (!okOrigin(req.headers.origin)) {
    log(`refused a connection from ${req.headers.origin} (add it with --origins if it's yours)`);
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  session(socket, req.headers.origin);
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use: is the relay already running? (or use --port)` : e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  log(`VUEMesh relay ready on ws://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  log(ffmpegVersion ? `ffmpeg ${ffmpegVersion} found` : "ffmpeg wasn't found: install it (https://ffmpeg.org) and start the relay again");
  log('Leave this window open while you stream. Ctrl+C to stop.');
});
