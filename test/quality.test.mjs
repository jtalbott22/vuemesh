// Bitrate hints and the live-picture table (quality.js).
// Run: node test/quality.test.mjs
import assert from 'node:assert/strict';
import { bitrateHints, qualityFor, LIVE_QUALITY } from '../public/js/quality.js';
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
import { snapToCamera } from '../public/js/camctl.js';
{
  const caps = { brightness: { min: 0, max: 255, step: 1 }, exposureCompensation: { min: -2, max: 2, step: 1 / 6 }, zoom: { min: 1, max: 5, step: 0.1 } };
  const s = snapToCamera(caps, { brightness: 159.375, exposureCompensation: 0.7, zoom: 2.34, focusMode: 'continuous' });
  assert.deepEqual(s, { brightness: 159, exposureCompensation: 0.666667, zoom: 2.3, focusMode: 'continuous' });
  assert.deepEqual(snapToCamera(caps, { brightness: 400, exposureCompensation: -9 }), { brightness: 255, exposureCompensation: -2 });
  assert.deepEqual(snapToCamera({}, { brightness: 3.3 }), { brightness: 3.3 });
  ok('camera settings: each number inside the range and on the camera\'s step (a value off the step made the whole set be ignored); anything else as it was');
}
console.log('\nAll quality tests passed.');
