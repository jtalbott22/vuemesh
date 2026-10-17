// Streaming the program out with WHIP (WebRTC-HTTP Ingestion Protocol, RFC 9725): the
// browser sends the program straight to the service over WebRTC, with nothing to install.
// A browser can't speak RTMP (no raw sockets, and WebAssembly can't open them either), so
// RTMP services (YouTube, Facebook…) go through the VUEMesh relay on the same computer
// (rtmp.js and relay/vuemesh-relay.mjs), or through a WHIP service that restreams.

export const STREAM_SERVICES = [
  // straight from the browser, over WebRTC
  {
    id: 'twitch', kind: 'whip', name: 'Twitch (WHIP)', url: 'https://g.webrtc.live-video.net:4443/v2/offer', fixedUrl: true,
    keyLabel: 'Stream key', help: 'Twitch takes WHIP directly, with nothing else running. Your key: Twitch Creator Dashboard → Settings → Stream → Primary stream key.',
  },
  {
    id: 'restream', kind: 'whip', name: 'Restream (to many platforms at once)', urlLabel: 'WHIP URL', keyLabel: 'Stream key',
    help: 'Restream takes WHIP (in beta) and sends it on to the platforms you connect there, several at once. In Restream, use its WHIP (WebRTC) ingest details: paste the URL and key.',
  },
  {
    id: 'cloudflare', kind: 'whip', name: 'Cloudflare Stream', urlLabel: 'WHIP URL', noKey: true,
    help: 'Cloudflare dashboard → Stream → Live inputs → your input → WebRTC (WHIP) URL. The key is part of that URL. A live input can also restream to YouTube, Facebook and others.',
  },
  {
    id: 'dolby', kind: 'whip', name: 'Dolby OptiView (Millicast)', url: 'https://director.millicast.com/api/whip/', urlLabel: 'WHIP URL (add your stream name at the end)', keyLabel: 'Publishing token',
    help: 'OptiView Real-time Streaming: the publish URL ends with your stream name; the token is a publishing token from the dashboard.',
  },
  {
    id: 'custom', kind: 'whip', name: 'Another WHIP service', urlLabel: 'WHIP URL', keyLabel: 'Bearer token (if it asks for one)',
    help: 'Any service or server that takes WHIP: OBS-style "WHIP" settings work here (LiveKit, MediaMTX, Mux, AWS and others).',
  },
  // RTMP / RTMPS, through the VUEMesh relay on this computer (a browser can't send RTMP itself)
  {
    id: 'youtube-rtmp', kind: 'rtmp', name: 'YouTube Live', url: 'rtmp://a.rtmp.youtube.com/live2', urlLabel: 'Server URL', keyLabel: 'Stream key',
    help: 'YouTube Studio → Create → Go live → Stream: copy the stream key. The server URL is YouTube\u2019s standard one (check it matches what YouTube shows).',
  },
  {
    id: 'facebook-rtmp', kind: 'rtmp', name: 'Facebook Live', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', urlLabel: 'Server URL', keyLabel: 'Stream key',
    help: 'Facebook: Live Producer → Streaming software: copy the stream key (the server URL is filled in; check it matches).',
  },
  {
    id: 'twitch-rtmp', kind: 'rtmp', name: 'Twitch (RTMP)', url: 'rtmp://live.twitch.tv/app', urlLabel: 'Server URL', keyLabel: 'Stream key',
    help: 'Twitch: Creator Dashboard → Settings → Stream → Primary stream key. (Twitch (WHIP) needs no relay.)',
  },
  {
    id: 'kick-rtmp', kind: 'rtmp', name: 'Kick', url: '', urlLabel: 'Stream URL', keyLabel: 'Stream key',
    help: 'Kick: Dashboard → Settings → Stream URL & Key: paste both.',
  },
  {
    id: 'vimeo-rtmp', kind: 'rtmp', name: 'Vimeo', url: 'rtmps://rtmp-global.cloud.vimeo.com:443/live', urlLabel: 'Server URL', keyLabel: 'Stream key',
    help: 'Vimeo: your live event → "Streaming software" (RTMP): check the URL matches and copy the stream key.',
  },
  {
    id: 'linkedin-rtmp', kind: 'rtmp', name: 'LinkedIn Live', url: '', urlLabel: 'Stream URL', keyLabel: 'Stream key',
    help: 'LinkedIn: create a live event with "Streaming tool" as the source, then copy its stream URL and key.',
  },
  {
    id: 'x-rtmp', kind: 'rtmp', name: 'X (Media Studio Producer)', url: '', urlLabel: 'RTMP URL', keyLabel: 'Stream key',
    help: 'X: Media Studio → Producer → create a source, then copy its RTMP URL and stream key.',
  },
  {
    // not a streaming service: the program as a camera and microphone on this computer
    id: 'vcam', kind: 'rtmp', vcam: true, name: 'Zoom, Teams or Meet (as a camera)', url: 'vcam:', fixedUrl: true, noKey: true,
    help: 'The program becomes a camera (and microphone) that video calls can pick, through the relay. Set up once below.',
  },
  {
    id: 'rtmp', kind: 'rtmp', name: 'Another RTMP server', url: '', urlLabel: 'Server URL (rtmp:// or rtmps://)', keyLabel: 'Stream key (if it has a separate one)',
    help: 'Any RTMP or RTMPS server, OBS-style: the "Server" and the "Stream key".',
  },
];

const gathered = (pc, ms) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const t = setTimeout(resolve, ms);
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') {
      clearTimeout(t);
      resolve();
    }
  });
});

/** Start sending `stream` (one video and one audio track) to a WHIP endpoint. */
import { bitrateHints, sendStats } from '/js/quality.js';

export async function startWhip({ url, token, stream, kbps = 4500, onState = () => {} }) {
  if (!/^https:\/\//i.test(url || '')) throw new Error('The WHIP URL has to start with https://');
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  const v = stream.getVideoTracks()[0], a = stream.getAudioTracks()[0];
  const tv = v && pc.addTransceiver(v, { direction: 'sendonly', sendEncodings: [{ maxBitrate: kbps * 1000, maxFramerate: 30, priority: 'high', networkPriority: 'high' }] });
  if (a) pc.addTransceiver(a, { direction: 'sendonly' });
  if (v && 'contentHint' in v) v.contentHint = 'motion';
  // H.264 first: Twitch and most services want it (and it plays everywhere)
  try {
    const caps = RTCRtpSender.getCapabilities('video')?.codecs || [];
    const h264 = caps.filter((c) => /h264/i.test(c.mimeType));
    if (h264.length && tv?.setCodecPreferences) tv.setCodecPreferences([...h264, ...caps.filter((c) => !/h264/i.test(c.mimeType))]);
  } catch {}
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, 2500); // send every candidate in the offer (some services don't take trickle)
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp', ...auth }, body: pc.localDescription.sdp });
  } catch {
    pc.close();
    throw new Error("Couldn't reach the service. Check the URL; some services don't accept a stream from a browser page.");
  }
  if (!res.ok) {
    pc.close();
    const why = res.status === 401 || res.status === 403 ? 'the key or token was refused' : res.status === 404 ? 'that URL isn\u2019t a WHIP endpoint' : `it answered ${res.status}`;
    throw new Error(`The service didn't take the stream: ${why}.`);
  }
  const loc = res.headers.get('Location');
  const session = loc ? new URL(loc, url).href : null;
  // (start near the chosen rate, not at a few hundred kbit/s, and don't sink below 30% of it)
  await pc.setRemoteDescription({ type: 'answer', sdp: bitrateHints(await res.text(), { start: kbps * 0.75, min: kbps * 0.3, max: kbps }) });
  // a stream keeps its picture size and lets the frame rate give a little first (a call would do the opposite)
  try {
    const sender = tv?.sender, p = sender?.getParameters();
    if (p) {
      p.degradationPreference = 'maintain-resolution';
      await sender.setParameters(p);
    }
  } catch {}
  pc.addEventListener('connectionstatechange', () => onState(pc.connectionState));
  let last = null;
  return {
    pc,
    async stop() {
      try { pc.close(); } catch {}
      if (session) await fetch(session, { method: 'DELETE', headers: auth }).catch(() => {});
    },
    /** The video going out: rate, picture, what's holding it back (for Monitor). */
    async link() {
      this.last = await sendStats(pc, this.last);
      return { ...this.last, targetKbps: kbps };
    },
    /** kbit/s going out right now. */
    async rate() {
      let bytes = 0;
      (await pc.getStats()).forEach((r) => { if (r.type === 'outbound-rtp') bytes += r.bytesSent || 0; });
      const t = performance.now(), prev = last;
      last = { bytes, t };
      return prev ? Math.round(((bytes - prev.bytes) * 8) / (t - prev.t)) : 0;
    },
  };
}
