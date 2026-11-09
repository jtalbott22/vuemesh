// Bitrate hints and the live-picture table (quality.js).
// Run: node test/quality.test.mjs
import assert from 'node:assert/strict';
import { bitrateHints, opusStereo, qualityFor, screenCodecs, LIVE_QUALITY } from '../public/js/quality.js';
const ok = (m) => console.log('ok  ' + m);
const sdp = ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 0.0.0.0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102', 'c=IN IP4 0.0.0.0', 'b=AS:500', 'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96', 'a=rtpmap:102 H264/90000', 'a=fmtp:102 packetization-mode=1;profile-level-id=42e01f', ''].join('\r\n');
const out = bitrateHints(sdp, { start: 2500, min: 250, max: 8000 });
assert.match(out, /a=fmtp:96 x-google-start-bitrate=2500;x-google-min-bitrate=250;x-google-max-bitrate=8000/);
assert.match(out, /a=fmtp:102 packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=2500/);
assert.ok(!/a=fmtp:97 .*x-google/.test(out), 'rtx left alone');
assert.equal((out.match(/b=AS:/g) || []).length, 1);
assert.match(out, /c=IN IP4 0\.0\.0\.0\r\nb=AS:8000/);
assert.ok(out.includes('a=fmtp:111 minptime=10;useinbandfec=1\r\n'), 'audio untouched');
const twice = bitrateHints(out, { start: 3000, max: 6000 });
assert.equal((twice.match(/x-google-start-bitrate/g) || []).length, 2);
assert.match(twice, /b=AS:6000/);
assert.equal(bitrateHints(undefined, { start: 1 }), undefined);
ok('bitrate hints: every video codec (not rtx), one bandwidth line after the connection line, audio untouched, safe to apply again');
assert.deepEqual(qualityFor('program', 'lan'), [8000, 1]);
assert.deepEqual(qualityFor('idle', 'relay'), [600, 2]);
assert.deepEqual(qualityFor('preview', 'nowhere'), LIVE_QUALITY.preview.unknown);
assert.deepEqual(qualityFor(undefined, 'lan'), LIVE_QUALITY.idle.lan);
for (const route of Object.keys(LIVE_QUALITY.program)) assert.ok(LIVE_QUALITY.program[route][0] > LIVE_QUALITY.preview[route][0] && LIVE_QUALITY.preview[route][0] > LIVE_QUALITY.idle[route][0], route);
ok('live picture: on air > preview > standby on every route; full size on air; unknown routes and tiers fall back');
{
  const st = opusStereo(sdp);
  assert.match(st, /a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=128000\r\n/);
  assert.equal(opusStereo(st), st);
  assert.ok(st.includes('a=fmtp:102 packetization-mode=1;profile-level-id=42e01f'));
  const bare = opusStereo('m=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n');
  assert.match(bare, /a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=128000/);
  assert.equal(opusStereo(undefined), undefined);
  ok('stereo Opus: stereo, sprop-stereo and room for it on Opus only; video untouched; an Opus with no fmtp gets one; safe to apply again');
}
{
  const c = (mimeType, sdpFmtpLine = '') => ({ mimeType, clockRate: 90000, sdpFmtpLine });
  const caps = [c('video/VP8'), c('video/rtx', 'apt=96'), c('video/H264', 'packetization-mode=0;profile-level-id=42e01f'), c('video/VP9'), c('video/H264', 'packetization-mode=1;profile-level-id=640c1f'), c('video/H264', 'packetization-mode=1;profile-level-id=42e01f'), c('video/AV1')];
  const out = screenCodecs(caps);
  assert.deepEqual(out.map((x) => x.mimeType + ' ' + x.sdpFmtpLine), ['video/H264 packetization-mode=1;profile-level-id=42e01f', 'video/H264 packetization-mode=1;profile-level-id=640c1f', 'video/H264 packetization-mode=0;profile-level-id=42e01f', 'video/VP8 ', 'video/rtx apt=96', 'video/VP9 ', 'video/AV1 ']);
  assert.equal(out.length, caps.length);
  const noH264 = [c('video/VP8'), c('video/VP9')];
  assert.deepEqual(screenCodecs(noH264), noH264);
  ok("a shared screen's codecs: H.264 first (constrained baseline, packetization-mode=1, first), then the rest in the browser's order; none dropped; without H.264, as it was");
}
import { labelCams, lensButtons, snapToCamera } from '../public/js/camctl.js';
{
  const caps = { brightness: { min: 0, max: 255, step: 1 }, exposureCompensation: { min: -2, max: 2, step: 1 / 6 }, zoom: { min: 1, max: 5, step: 0.1 } };
  const s = snapToCamera(caps, { brightness: 159.375, exposureCompensation: 0.7, zoom: 2.34, focusMode: 'continuous' });
  assert.deepEqual(s, { brightness: 159, exposureCompensation: 0.666667, zoom: 2.3, focusMode: 'continuous' });
  assert.deepEqual(snapToCamera(caps, { brightness: 400, exposureCompensation: -9 }), { brightness: 255, exposureCompensation: -2 });
  assert.deepEqual(snapToCamera({}, { brightness: 3.3 }), { brightness: 3.3 });
  ok('camera settings: each number inside the range and on the camera\'s step (a value off the step made the whole set be ignored); anything else as it was');
}
{
  // The remote's lens buttons on an iPhone 17 Pro: its two front cameras listed, the usual selfie one first.
  // One front button, "Front", and it's the first one listed (0.66.12 kept the shortest name: "Front 2").
  const iphone = ['Front Camera', 'Back Camera', 'Back Ultra Wide Camera', 'Back Telephoto Camera', 'Back Dual Wide Camera', 'Back Triple Camera', 'Front Camera 2']
    .map((label, i) => ({ deviceId: 'd' + i, label }));
  let b = lensButtons(labelCams(iphone));
  assert.deepEqual(b.map((l) => l.short), ['0.5×', '1×', '2×', 'Front'], b.map((l) => l.short).join());
  assert.equal(b.find((l) => l.short === 'Front').label, 'Front Camera');
  // listed the other way round, with a longer name first: still the first listed, still "Front"
  const other = ['Front TrueDepth Camera', 'Front Camera', 'Back Camera'].map((label, i) => ({ deviceId: 'e' + i, label }));
  b = lensButtons(labelCams(other));
  assert.deepEqual(b.map((l) => [l.short, l.label]), [['1×', 'Back Camera'], ['Front', 'Front TrueDepth Camera']]);
  // a phone with only combined back cameras keeps them; Android's numbered back lenses stay numbered
  b = lensButtons(labelCams(['Back Triple Camera', 'Front Camera'].map((label, i) => ({ deviceId: 'f' + i, label }))));
  assert.deepEqual(b.map((l) => l.short), ['Auto', 'Front']);
  b = lensButtons(labelCams(['camera2 1, facing front', 'camera2 0, facing back', 'camera2 2, facing back'].map((label, i) => ({ deviceId: 'g' + i, label }))));
  assert.deepEqual(b.map((l) => l.short), ['1×', 'Cam 2', 'Front']);
  console.log('ok  the remote\'s lens buttons: one front camera, the first the phone lists, called Front');
}

console.log('\nAll quality tests passed.');
