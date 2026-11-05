// Timers that keep time while the page is hidden. A hidden or minimized window's own timers
// are slowed by the browser (to once a second, and after a few minutes hidden to once a
// minute), which held up a studio behind a slideshow: its reconnect to the server waited, so a
// TV couldn't find it, and the remote heard nothing new. A worker's clock isn't slowed, so these
// run off one (/js/ticker.js), to about 50 ms. Where workers can't start, the page's own timers.
let worker = null;
let nextId = 1;
const timers = new Map(); // id → { fn, due, every }

function ensure() {
  if (worker !== null) return worker;
  try {
    worker = new Worker('/js/ticker.js');
    worker.postMessage({ ms: 50 });
    worker.onmessage = run;
  } catch {
    worker = false;
  }
  return worker;
}
function run() {
  const t = performance.now();
  for (const [id, x] of [...timers]) {
    if (t < x.due || !timers.has(id)) continue;
    if (x.every) x.due = Math.max(x.due + x.every, t); // (a steady beat, without a burst to catch up)
    else timers.delete(id);
    try {
      x.fn();
    } catch (e) {
      console.error(e);
    }
  }
}
/** Like setTimeout, but kept on time while the page is hidden. */
export function bgTimeout(fn, ms = 0) {
  if (!ensure()) return { native: setTimeout(fn, ms) };
  const id = nextId++;
  timers.set(id, { fn, due: performance.now() + ms, every: 0 });
  return id;
}
/** Like setInterval, but kept on time while the page is hidden. */
export function bgInterval(fn, ms) {
  if (!ensure()) return { native: setInterval(fn, ms), every: true };
  const id = nextId++;
  timers.set(id, { fn, due: performance.now() + ms, every: Math.max(1, ms) });
  return id;
}
/** Stop a timer from bgTimeout or bgInterval. */
export function bgClear(id) {
  if (id && typeof id === 'object') {
    clearTimeout(id.native);
    clearInterval(id.native);
  } else timers.delete(id);
}
