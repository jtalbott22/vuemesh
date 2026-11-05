// A steady clock that browsers don't slow down when the studio window is covered or in
// the background (page timers and animation frames are throttled there; a worker's aren't).
// Every 33 ms, or as often as the page asks ({ ms }).
let timer = setInterval(() => postMessage(0), 33);
onmessage = (e) => {
  const ms = Math.max(1, Math.min(1000, Number(e.data?.ms) || 33));
  clearInterval(timer);
  timer = setInterval(() => postMessage(0), ms);
};
