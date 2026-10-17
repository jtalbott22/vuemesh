// A steady clock that browsers don't slow down when the studio window is covered or in
// the background (page timers and animation frames are throttled there; a worker's aren't).
setInterval(() => postMessage(0), 33);
