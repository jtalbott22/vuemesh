// RTMP streaming through the VUEMesh relay (relay/vuemesh-relay.mjs). A browser can't send
// RTMP, so the studio records the program in quarter-second pieces and passes them over a
// WebSocket to the relay running on this computer, which hands them to ffmpeg to send on as
// RTMP or RTMPS. The relay re-encodes to what services ask for (H.264 with a keyframe every
// 2 seconds, AAC sound), so the browser sends a generous, high-quality picture.

export const RELAY_DEFAULT = 'ws://localhost:8935';
const MIMES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];

function connect(url, ms = 3000) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      return reject(e);
    }
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, ms);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('refused'));
    };
  });
}

function nextMessage(ws, kinds, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ws.removeEventListener('message', on);
      reject(new Error('timeout'));
    }, ms);
    function on(e) {
      if (typeof e.data !== 'string') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (!kinds.includes(m.t)) return;
      clearTimeout(t);
      ws.removeEventListener('message', on);
      resolve(m);
    }
    ws.addEventListener('message', on);
  });
}

/** Is the relay there, and has it got ffmpeg? {ffmpeg: '7.0'} or {ffmpeg: null}; throws if nothing answers. */
export async function relayHello(url = RELAY_DEFAULT) {
  const ws = await connect(url, 2500);
  try {
    ws.send(JSON.stringify({ t: 'hello' }));
    return await nextMessage(ws, ['hello'], 2500);
  } finally {
    ws.close();
  }
}

/** The address ffmpeg sends to: the service's URL with the stream key on the end. */
export const rtmpTarget = (url, key) => (key ? `${String(url).replace(/\/+$/, '')}/${key}` : String(url));

/** Start streaming `stream` to `target` (rtmp:// or rtmps://) through the relay. */
export async function startRtmp({ relay = RELAY_DEFAULT, target, stream, kbps = 4500, onState = () => {} }) {
  if (target !== 'vcam:' && !/^rtmps?:\/\//i.test(target || '')) throw new Error('The server address has to start with rtmp:// or rtmps://');
  let ws;
  try {
    ws = await connect(relay);
  } catch {
    throw new Error(`No relay answered at ${relay}. Start it on this computer (node vuemesh-relay.mjs) and press Go live again.`);
  }
  ws.send(JSON.stringify({ t: 'hello' }));
  const hi = await nextMessage(ws, ['hello'], 3000).catch(() => null);
  if (!hi) {
    ws.close();
    throw new Error(`Something answered at ${relay}, but it isn't the VUEMesh relay.`);
  }
  if (!hi.ffmpeg) {
    ws.close();
    throw new Error("The relay is running but can't find ffmpeg. Install ffmpeg, then start the relay again.");
  }
  if (target === 'vcam:' && !(hi.version >= 2)) {
    ws.close();
    throw new Error('This relay is older than the camera feature: download the relay again (the link below), and start the new one.');
  }
  const mime = MIMES.find((m) => window.MediaRecorder?.isTypeSupported(m)) || '';
  ws.send(JSON.stringify({ t: 'start', target, kbps, mime }));
  const st = await nextMessage(ws, ['started', 'error'], 6000).catch(() => ({ t: 'error', message: "The relay didn't answer." }));
  const vcamInfo = st.vcam || null;
  if (st.t === 'error') {
    ws.close();
    throw new Error(st.message);
  }
  const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.min(12000, kbps * 2) * 1000, audioBitsPerSecond: 160000 });
  let chain = Promise.resolve(), stats = {}, done = false;
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    chain = chain.then(async () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(await e.data.arrayBuffer());
    });
  };
  const finish = (why) => {
    if (done) return;
    done = true;
    try { rec.state !== 'inactive' && rec.stop(); } catch {}
    onState('failed', why);
  };
  ws.addEventListener('message', (e) => {
    if (typeof e.data !== 'string') return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'stats') stats = m;
    else if (m.t === 'ended') finish(m.code ? `The service stopped taking the stream: ${m.message}` : 'The stream ended.');
  });
  ws.addEventListener('close', () => finish('The relay closed the connection (was its window closed?).'));
  rec.start(250);
  return {
    kind: 'rtmp',
    vcam: vcamInfo,
    async stop() {
      done = true;
      try { rec.state !== 'inactive' && rec.stop(); } catch {}
      await chain.catch(() => {});
      try { ws.send(JSON.stringify({ t: 'stop' })); } catch {}
      setTimeout(() => ws.close(), 500);
    },
    /** kbit/s ffmpeg is sending at. */
    async rate() {
      return Math.round(stats.kbps || 0);
    },
    stats: () => stats,
    /** Data waiting to go to the relay (it grows if this computer can't keep up). */
    backlog: () => ws.bufferedAmount,
  };
}
