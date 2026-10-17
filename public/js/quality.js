// Picture quality for live links: how fast a link starts, how good each camera's live picture is
// (by what it's doing in the show), and what the browser says is holding it back.

/**
 * Bitrate hints in an answer, for the side that sends video (applied to the answer it receives).
 * A connection left to itself starts at a few hundred kbit/s and creeps up over many seconds;
 * these let it start near where it should be (start), not sink below a floor (min), and know
 * its ceiling (max), in kbit/s. Chrome and Edge read the x-google-* hints; b=AS is the standard
 * ceiling every browser reads. Nothing else in the answer changes.
 */
export function bitrateHints(sdp, { start, min, max }) {
  if (!sdp || typeof sdp !== 'string') return sdp;
  const nl = sdp.includes('\r\n') ? '\r\n' : '\n';
  const parts = sdp.split(new RegExp(`${nl}(?=m=)`));
  return parts.map((sec) => {
    if (!sec.startsWith('m=video')) return sec;
    let lines = sec.split(nl).filter((l) => !/^b=(AS|TIAS):/.test(l));
    const pts = lines.map((l) => /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1|H265)\//i.exec(l)?.[1]).filter(Boolean);
    const hint = [start && `x-google-start-bitrate=${Math.round(start)}`, min && `x-google-min-bitrate=${Math.round(min)}`, max && `x-google-max-bitrate=${Math.round(max)}`].filter(Boolean).join(';');
    for (const pt of pts) {
      const i = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
      if (i >= 0) lines[i] = lines[i].replace(/;?x-google-(start|min|max)-bitrate=\d+/g, '') + `;${hint}`;
      else {
        const r = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `));
        lines.splice(r + 1, 0, `a=fmtp:${pt} ${hint}`);
      }
    }
    if (max) {
      // (the bandwidth line goes after the connection line, or straight after m=)
      const c = lines.findIndex((l) => l.startsWith('c='));
      lines.splice(c >= 0 ? c + 1 : 1, 0, `b=AS:${Math.round(max)}`);
    }
    return lines.join(nl);
  }).join(nl);
}

/**
 * A camera's live picture, by what it's doing in the show and how it's connected: [kbit/s,
 * resolution divisor]. The camera on air sends its full picture, generously (it's what the
 * program, the recording of it and the stream are made of); the one in preview is full size too,
 * so a cut to it is sharp at once; the rest send a small picture to cut from, so a room full of
 * phones doesn't fill the network. Over the internet, through a relay, or on mobile data, less.
 */
export const LIVE_QUALITY = {
  program: { lan: [8000, 1], nat: [6000, 1], internet: [4000, 1], cellular: [2500, 1], relay: [2500, 1], unknown: [4000, 1] },
  preview: { lan: [3000, 1], nat: [2500, 1], internet: [1800, 1], cellular: [1200, 1.5], relay: [1200, 1.5], unknown: [1800, 1] },
  idle: { lan: [1200, 2], nat: [1000, 2], internet: [900, 2], cellular: [600, 2], relay: [600, 2], unknown: [900, 2] },
};
export const qualityFor = (tier, route) => (LIVE_QUALITY[tier] || LIVE_QUALITY.idle)[route] || LIVE_QUALITY[tier || 'idle'].unknown;

/** What the browser says about a sending link: rate, picture, and what's holding it back. */
export async function sendStats(pc, prev) {
  const out = { at: performance.now() };
  try {
    const st = await pc.getStats();
    st.forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'video' && !r.rid) {
        out.bytes = r.bytesSent || 0;
        out.w = r.frameWidth || null;
        out.h = r.frameHeight || null;
        out.fps = r.framesPerSecond ? Math.round(r.framesPerSecond) : null;
        out.limit = r.qualityLimitationReason || 'none'; // cpu, bandwidth, other, none
        if (r.targetBitrate) out.encKbps = Math.round(r.targetBitrate / 1000); // (what the encoder's been told to aim for)
        out.enc = r.encoderImplementation || null;
        out.hw = r.powerEfficientEncoder ?? null;
      }
      if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
        if (r.fractionLost != null) out.lossPct = Math.round(r.fractionLost * 1000) / 10;
        if (r.roundTripTime != null) out.rttMs = Math.round(r.roundTripTime * 1000);
      }
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
        if (r.availableOutgoingBitrate) out.availKbps = Math.round(r.availableOutgoingBitrate / 1000);
        if (out.rttMs == null && r.currentRoundTripTime != null) out.rttMs = Math.round(r.currentRoundTripTime * 1000);
      }
    });
  } catch {}
  if (prev?.bytes != null && out.bytes != null && out.at > prev.at) out.kbps = Math.round(((out.bytes - prev.bytes) * 8) / (out.at - prev.at));
  return out;
}
