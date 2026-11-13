// Live captions (public/js/captions.js): phrases cut into captions of two lines, their times,
// the WebVTT file, line wrapping, and the recogniser's sessions (with a stand-in for the browser's).
// No browser needed.
import assert from 'node:assert/strict';
import { CUE_CHARS, LEAD, LiveCaptions, captionSupport, readMs, splitCue, toVtt, vttTime, wrapLines } from '../public/js/captions.js';

const ok = (m) => console.log('ok  ' + m);

// ---- splitCue ----
{
  assert.deepEqual(splitCue('', 0, 1000), []);
  const one = splitCue('Hello and welcome', 1000, 2000);
  assert.deepEqual(one, [{ t0: 1000, t1: 2000, text: 'Hello and welcome' }]);
  const long = 'Thank you all for coming tonight, it means the world to both of us. We have been planning this for a very long time and we are so glad you are here with us';
  const parts = splitCue(long, 0, 10_000);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(p.text.length <= CUE_CHARS, `${p.text.length} characters: ${p.text}`);
  assert.equal(parts.map((p) => p.text).join(' '), long);
  assert.equal(parts[0].t0, 0);
  assert.equal(parts.at(-1).t1, 10_000);
  for (let i = 1; i < parts.length; i++) assert.equal(parts[i].t0, parts[i - 1].t1);
  // a break after a sentence's end, where one falls in the second half
  assert.match(parts[0].text, /[.,]$/);
  // one very long word still comes out (on its own)
  assert.equal(splitCue('x'.repeat(120), 0, 100)[0].text.length, 120);
  ok('a phrase is cut into captions of two lines at most, at words (after . or , where it can), its time shared out by length');
}

// ---- the file ----
{
  assert.equal(vttTime(0), '00:00:00.000');
  assert.equal(vttTime(3_723_045), '01:02:03.045');
  assert.equal(vttTime(-5), '00:00:00.000');
  const cues = [
    { t0: 500, t1: 1500, text: 'before the recording' },
    { t0: 9_000, t1: 11_000, text: 'starts as it starts' },
    { t0: 12_000, t1: 14_000, text: 'in the middle --> with an arrow & <b>', speaker: 'Rosa <M>' },
    { t0: 50_000, t1: 52_000, text: 'after it ended' },
  ];
  assert.equal(toVtt(cues, 100_000), null);
  const v = toVtt(cues, 10_000, 40_000);
  assert.equal(v, 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nstarts as it starts\n\n2\n00:00:02.000 --> 00:00:04.000\n<v Rosa &lt;M&gt;>in the middle --&gt; with an arrow &amp; &lt;b&gt;\n');
  ok('the WebVTT file: only what was heard while recording, timed from its first frame, who said it (a voice tag), and nothing that breaks the format');
}

// ---- wrapping ----
{
  const measure = (s) => s.length * 10;
  assert.deepEqual(wrapLines('one two three four five', 100, measure), ['one two', 'three four', 'five']);
  assert.deepEqual(wrapLines('  ', 100, measure), []);
  assert.deepEqual(wrapLines('supercalifragilistic', 50, measure), ['supercalifragilistic']);
  ok('lines wrap at words, to the width given; a word wider than a line has a line of its own');
}

// ---- the recogniser, with a stand-in for the browser's ----
{
  let t = 0;
  const made = [];
  class FakeRec {
    constructor() { made.push(this); this.started = null; }
    start(track) { this.started = track; }
    abort() { this.aborted = true; }
    // e.results: [{ isFinal, 0: { transcript } }]
    say(results, resultIndex = 0) {
      const rs = results.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }));
      this.onresult({ resultIndex, results: rs });
    }
  }
  FakeRec.available = async ({ langs, processLocally }) => (processLocally && langs[0] === 'en-US' ? 'available' : 'unavailable');
  globalThis.SpeechRecognition = FakeRec;
  globalThis.setTimeout ??= setTimeout;

  assert.equal(await captionSupport('en-US'), 'available');
  assert.equal(await captionSupport('xx-XX'), 'unavailable');

  const states = [];
  const c = new LiveCaptions({ lang: 'en-US', clock: () => t, onState: (s, why) => states.push([s, why]) });
  const track = { kind: 'audio' };
  c.start(track);
  const r = made[0];
  assert.equal(r.started, track, 'it listens to the track it was given, not a microphone');
  assert.equal(r.processLocally, true, 'on the device only');
  assert.equal(r.continuous, true);
  assert.deepEqual(states.at(-1), ['listening', undefined]);

  t = 10_000;
  r.say([['good evening', false]]);
  assert.equal(c.text(), 'good evening');
  t = 11_500;
  r.say([['good evening everyone', true]]);
  assert.equal(c.cues.length, 1);
  assert.equal(c.cues[0].t0, 10_000 - LEAD, 'timed from when its first words were heard, a little earlier');
  assert.equal(c.cues[0].text, 'good evening everyone');
  assert.ok(c.cues[0].t1 - c.cues[0].t0 >= readMs('good evening everyone'), 'up long enough to read');
  t = 12_000;
  r.say([['good evening everyone', true], ['and welcome', false]], 1);
  assert.equal(c.text(), 'good evening everyone and welcome');
  t = 12_600;
  r.say([['good evening everyone', true], ['and welcome', true]], 1);
  assert.equal(c.cues.length, 2);
  assert.ok(c.cues[0].t1 <= c.cues[1].t0, 'a caption is gone when the next one starts');
  // the same final again (a recogniser repeats itself) isn't a second caption
  r.say([['good evening everyone', true], ['and welcome', true]], 0);
  assert.equal(c.cues.length, 2);

  // quiet for a while: nothing on screen
  t = 20_000;
  assert.equal(c.text(), '');

  // the recogniser ends by itself: what was being heard is kept, and it starts again
  r.say([['to the', false]]);
  t = 21_000;
  r.onend();
  assert.equal(c.cues.at(-1).text, 'to the');
  await new Promise((res) => setTimeout(res, 80));
  assert.equal(made.length, 2, 'started again');
  assert.equal(made[1].started, track);

  // something it can't get past: it stops and says why
  made[1].onerror({ error: 'language-not-supported' });
  assert.equal(c.running, false);
  assert.equal(states.at(-1)[0], 'error');
  assert.match(states.at(-1)[1], /en-US/);

  // who's talking (face tracking): each caption says who, and the words on screen start with a new speaker's name
  {
    let who = 'Speaker 1';
    const e = new LiveCaptions({ lang: 'en-US', clock: () => t, speaker: () => who });
    e.start(track);
    const rr = made.at(-1);
    t = 30_000;
    rr.say([['hello there', true]]);
    t = 30_500;
    rr.say([['hello there', true], ['nice to see you', true]], 1);
    who = 'Rosa';
    t = 31_000;
    rr.say([['hello there', true], ['nice to see you', true], ['thank you', false]], 2);
    assert.equal(e.text(), 'Speaker 1: hello there nice to see you Rosa: thank you');
    assert.equal(e.cues[0].speaker, 'Speaker 1');
    e.stop();
    assert.equal(e.cues.at(-1).speaker, 'Rosa');
    assert.match(toVtt(e.cues, 29_000), /<v Speaker 1>hello there/);
  }

  // what the recogniser says it's doing goes to the show log, each first once; errors by name
  {
    const logs = [];
    const e = new LiveCaptions({ lang: 'en-US', clock: () => t, onState: (s, w) => s === 'log' && logs.push(w) });
    e.start(track);
    const rr = made.at(-1);
    rr.onaudiostart(); rr.onaudiostart(); rr.onsoundstart();
    rr.onerror({ error: 'no-speech' }); rr.onerror({ error: 'no-speech' });
    assert.deepEqual(logs, ['the recogniser is getting sound', 'the recogniser hears sound', 'the recogniser says "no-speech"']);
    assert.equal(e.stats.errors['no-speech'], 2);
    assert.equal(e.running, true, 'no speech is no reason to stop');
    rr.say([['hi', true]]);
    assert.equal(logs.at(-1), 'the first words are recognised');
    e.stop();
    // with no track: the browser's own microphone (start() with nothing)
    const m = new LiveCaptions({ lang: 'en-US', clock: () => t });
    m.start(null);
    assert.equal(made.at(-1).started, undefined);
    m.stop();
  }

  // ending straight away, again and again: it gives up rather than spin
  const d = new LiveCaptions({ lang: 'en-US', clock: () => t, onState: (s, why) => states.push([s, why]) });
  d.start(track);
  for (let i = 0; i < 6 && d.running; i++) {
    made.at(-1).onend();
    await new Promise((res) => setTimeout(res, 1100));
  }
  assert.equal(d.running, false);
  assert.match(states.at(-1)[1], /keeps stopping/);
  ok('the recogniser: the program’s track, on the device only; phrases timed from their first words; it starts again when it ends, and stops (saying why) when it can’t go on');
}

console.log('\nAll captions tests passed.');
