// Joining with no internet, by QR code.
//
// Normally a phone finds the studio through the server, which passes the WebRTC handshake between
// them. With no internet there's no server, and a browser can't be one. So the two swap the little
// that a link needs by showing each other a QR code: the phone shows its code to the studio (to the
// studio computer's camera, or to any camera in the show), and the studio shows its answer for the
// phone to scan. That sets up a small link with only a data channel ("boot"), whose handshake fits
// in a QR code: the address it can be reached at, two passwords and a certificate fingerprint. Over
// that link the studio says which show this is and who it is, and the phone's usual link (picture,
// sound, clips) is then arranged exactly as it is through the server.
//
// A code: VMJ1|<show>|<nonce>|<setup>|<ufrag>|<pwd>|<fingerprint, base64url>|<host:port>;<host:port>…
// The studio's answer repeats the phone's nonce, so a phone takes only the answer to its own code.

const MAGIC = 'VMJ1';
const GATHER_MS = 3000;

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** Wait until the connection has found its addresses (no servers to ask: quick), at most a few seconds. */
function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    const t = setTimeout(res, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && (clearTimeout(t), res()));
  });
}

/** What the other side needs from a local description: passwords, fingerprint, setup, addresses on this network. */
function essentials(sdp) {
  const get = (re) => (re.exec(sdp) || [])[1];
  const fp = get(/^a=fingerprint:sha-256 ([0-9A-F:]+)/im);
  const cands = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gim)) {
    const at = `${m[1]}:${m[2]}`;
    if (!cands.includes(at) && !m[1].includes(':')) cands.push(at); // (IPv4 and .local names: IPv6 rarely helps on a show's Wi-Fi, and is long)
  }
  return {
    ufrag: get(/^a=ice-ufrag:(\S+)/m),
    pwd: get(/^a=ice-pwd:(\S+)/m),
    setup: get(/^a=setup:(\S+)/m),
    fp: fp ? b64u(fp.split(':').map((h) => parseInt(h, 16))) : null,
    cands: cands.slice(0, 4),
  };
}

export function encode({ show, nonce, setup, ufrag, pwd, fp, cands }) {
  return [MAGIC, show, nonce, setup, ufrag, pwd, fp, cands.join(';')].join('|');
}

/** @returns the code's parts, or null if it isn't one */
export function decode(text) {
  const p = String(text || '').split('|');
  if (p[0] !== MAGIC || p.length !== 8) return null;
  const [, show, nonce, setup, ufrag, pwd, fp, cands] = p;
  if (!/^[A-Z0-9]{6}$/.test(show) || !ufrag || !pwd || !fp) return null;
  return { show, nonce, setup, ufrag, pwd, fp, cands: cands ? cands.split(';').filter(Boolean) : [] };
}

/** A data-channel-only description built from a code's parts (what browsers make for one, give or take). */
function describe(type, c) {
  const fp = [...unb64u(c.fp)].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(':');
  const setup = type === 'offer' ? 'actpass' : c.setup === 'passive' ? 'passive' : 'active';
  const sdp = [
    'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${c.ufrag}`, `a=ice-pwd:${c.pwd}`, 'a=ice-options:trickle', `a=fingerprint:sha-256 ${fp}`, `a=setup:${setup}`,
    'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', '',
  ].join('\r\n');
  return { type, sdp };
}

async function addCandidates(pc, cands) {
  let i = 0;
  for (const at of cands) {
    const k = at.lastIndexOf(':');
    const host = at.slice(0, k), port = at.slice(k + 1);
    if (!host || !/^\d+$/.test(port)) continue;
    await pc.addIceCandidate({ candidate: `candidate:${++i} 1 udp ${2122260223 - i} ${host} ${port} typ host generation 0`, sdpMid: '0', sdpMLineIndex: 0 }).catch(() => {});
  }
  await pc.addIceCandidate({ candidate: '', sdpMid: '0', sdpMLineIndex: 0 }).catch(() => {}); // (that's all of them)
}

const opened = (dc, ms) =>
  new Promise((res, rej) => {
    if (dc.readyState === 'open') return res(dc);
    const t = setTimeout(() => rej(new Error("Couldn't reach the studio on this network")), ms);
    dc.addEventListener('open', () => (clearTimeout(t), res(dc)));
    dc.addEventListener('close', () => (clearTimeout(t), rej(new Error('The studio closed the link'))));
  });

/**
 * The phone's side. start() makes its code; answer(text) takes the studio's answer and resolves
 * with the link once it's open: { pc, dc, hello } (hello: the studio's first message: the show and who it is).
 */
export class PhoneJoin {
  constructor(show) {
    this.show = show;
    this.nonce = b64u(crypto.getRandomValues(new Uint8Array(6)));
  }
  async start() {
    this.close();
    const pc = (this.pc = new RTCPeerConnection({ iceServers: [] }));
    this.dc = pc.createDataChannel('boot', { ordered: true });
    this.hello = new Promise((res) => {
      this.dc.addEventListener('message', function first(e) {
        try {
          const m = JSON.parse(e.data);
          if (m.t === 'hello') {
            this.removeEventListener('message', first);
            res(m);
          }
        } catch {}
      });
    });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const e = essentials(pc.localDescription.sdp);
    if (!e.cands.length) throw new Error('This phone has no address on a network: join the show’s Wi-Fi first');
    this.code = encode({ show: this.show, nonce: this.nonce, ...e });
    return this.code;
  }
  /** @returns false if the text isn't the studio's answer to this phone's code (another phone's, or not a code) */
  async answer(text) {
    const c = decode(text);
    if (!c || c.nonce !== this.nonce || c.show !== this.show || !this.pc) return false;
    await this.pc.setRemoteDescription(describe('answer', c));
    await addCandidates(this.pc, c.cands);
    await opened(this.dc, 20000);
    const hello = await Promise.race([this.hello, new Promise((_, rej) => setTimeout(() => rej(new Error("The studio didn't say hello")), 10000))]);
    return { pc: this.pc, dc: this.dc, hello };
  }
  close() {
    try { this.pc?.close(); } catch {}
    this.pc = null;
  }
}

/**
 * The studio's side: the answer to a phone's code. Resolves { code, link } at once: code is the
 * answer to show; link resolves with { pc, dc } when the phone has scanned it and the link is open.
 * @returns null if the text isn't a phone's code for this show
 */
export async function studioAnswer(text, show) {
  const c = decode(text);
  if (!c || c.show !== show) return null;
  const pc = new RTCPeerConnection({ iceServers: [] });
  const channel = new Promise((res) => (pc.ondatachannel = (e) => res(e.channel)));
  await pc.setRemoteDescription(describe('offer', c));
  await addCandidates(pc, c.cands);
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc);
  const e = essentials(pc.localDescription.sdp);
  const code = encode({ show, nonce: c.nonce, ...e });
  const link = channel.then((dc) => opened(dc, 120000)).then((dc) => ({ pc, dc }));
  link.catch(() => pc.close());
  return { code, link, pc };
}
