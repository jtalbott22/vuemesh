// How far one sound is behind another (audiosync.js offsetBetween), off the page's own thread.
// The studio lines up its microphones every 10 s: three FFTs of 262,144 points for each one, about
// 220 ms of the page's time in a row, which held up the program's drawing every 10 s (7 frames
// late, a stutter on air and in Record program). Here the page only hands over the sound.
import { offsetBetween } from './audiosync.js';

self.onmessage = (e) => {
  const { id, a, b, maxLag } = e.data;
  try {
    self.postMessage({ id, m: offsetBetween(a, b, maxLag) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
