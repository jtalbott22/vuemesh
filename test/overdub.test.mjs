// Unit tests for overdubbing: where a take lands, the latency trim, measuring latency from
// clicks, the WAV file, and the take tracks (pure, no browser needed).
import assert from 'node:assert/strict';
import * as O from '../public/js/overdub.js';
import * as S from '../public/js/sequence.js';

const ok = (m) => console.log('ok  ' + m);
const SR = 48000;

// the timeline on the engine's clock: timeline 2000 ms is engine time 10 s
const clock = { c0: 10, t0: 2000, sr: SR, latencyMs: 0 };
assert.equal(O.frameFor(clock, 2000), 480000);
assert.equal(O.frameFor(clock, 3000), 528000);
assert.equal(O.frameFor({ ...clock, latencyMs: 12.5 }, 2000), 480600, 'latency moves later into the recording');
ok('timeline positions map to engine frames, latency included');

// a captured recording: blocks of 2048 from frame 470000, a marker sample at a known frame
const blocks = [];
const marked = new Set([480000 + 600, 528000 + 600]); // frames where something was played
for (let f = 470000; f < 540000; f += 2048) {
  const L = new Float32Array(2048), R = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) if (marked.has(f + i)) L[i] = 0.5;
  blocks.push({ frame: f, L, R });
}
let t = O.cutTake(blocks, { ...clock, latencyMs: 12.5 }, 2000, 3000);
assert.equal(t.frames, 48000);
assert.equal(t.channels.length, 1);
assert.equal(t.channels[0][0], 0.5, 'what was played at 2000 ms is the take’s first sample, latency taken off');
assert.equal(t.channels[0].indexOf(0.5, 1), -1, 'the end is exclusive');
ok('a take is cut from the capture with the latency taken off');

// before the capture began is silence; the louder channel is kept
t = O.cutTake(blocks.map((b) => ({ ...b, L: new Float32Array(2048), R: b.L })), clock, 1900, 2100);
assert.equal(t.channels[0].length, O.frameFor(clock, 2100) - O.frameFor(clock, 1900));
assert.ok(t.channels[0].some((x) => x === 0.5), 'the second input (with the sound) was kept');
ok('missing frames are silence; a microphone on the second input still records');

// WAV: 24-bit, the right size, a round trip of a sample
const wav = O.encodeWav([new Float32Array([0, 0.5, -1, 1])], SR);
const v = new DataView(wav);
assert.equal(wav.byteLength, 44 + 4 * 3);
assert.equal(String.fromCharCode(...new Uint8Array(wav, 0, 4)), 'RIFF');
assert.deepEqual([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)], [1, SR, 24]);
const s24 = (o) => { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); return x & 0x800000 ? x - 0x1000000 : x; };
assert.equal(s24(47), Math.round(0.5 * 0x7fffff));
assert.equal(s24(50), -0x800000);
ok('WAV files are 24-bit PCM');

// measuring latency: bursts played, heard back 23.4 ms later, quieter, with an echo and hiss
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const N = SR * 3.2, late = Math.round(0.0234 * SR);
const frames = O.MEASURE_AT.map((at) => Math.round((0.2 + at) * SR));
const played = O.burstTrain(frames, N, SR);
const heard = new Float32Array(N);
const bu = O.burst(SR);
for (const f of frames) for (let i = 0; i < bu.length; i++) {
  heard[f + late + i] += 0.2 * bu[i];
  heard[f + late + 400 + i] += 0.06 * bu[i]; // (an echo off the wall)
}
for (let i = 0; i < N; i++) heard[i] += 0.01 * rnd();
let m = O.measureLatency(played, heard, SR);
assert.ok(Math.abs(m.ms - 23.4) < 0.1 && m.sure, JSON.stringify(m));
m = O.measureLatency(played, new Float32Array(N).map(() => 0.01 * rnd()), SR);
assert.equal(m.sure, false, 'hiss alone is not a measurement');
assert.equal(O.burst(SR).length, 96);
assert.deepEqual(O.burst(SR), O.burst(SR), 'the burst is the same every time');
ok('latency is measured from bursts heard back, and hiss alone is not a measurement');

// take tracks: a new take mutes the last unless stacked; parts listed
const seq = S.newSequence();
const a = O.placeTake(seq, { part: 'Guitar', src: 'g1', start: 0, dur: 8000, in: 500 });
assert.deepEqual([a.name, a.takeNo, a.items[0].in, a.muted], ['Guitar · take 1', 1, 500, false]);
const b = O.placeTake(seq, { part: 'Guitar', src: 'g2', start: 0, dur: 8000 });
assert.deepEqual([b.name, a.muted, b.muted], ['Guitar · take 2', true, false]);
assert.equal(seq.tracks.indexOf(b), seq.tracks.indexOf(a) + 1, 'the newest under the earlier ones');
O.placeTake(seq, { part: 'Voice', src: 'v1', start: 2000, dur: 6000 });
const c = O.placeTake(seq, { part: 'Guitar', src: 'g3', start: 0, dur: 8000, stack: true });
assert.deepEqual([c.name, b.muted, c.stack], ['Guitar · take 3', false, true], 'a stacked take keeps the others playing');
assert.equal(seq.tracks.indexOf(c), seq.tracks.indexOf(b) + 1, 'with its part, not after Voice');
assert.deepEqual(O.partsOf(seq), ['Guitar', 'Voice']);
ok('takes: each on its own track, replacing or stacked, kept with their part');
