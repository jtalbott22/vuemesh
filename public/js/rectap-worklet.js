// Record program's tap on the program's sound, on the sound thread (see progrec.js). The sound
// engine runs this for every 128 samples whatever the page is doing, and what it sends waits in
// a queue until the page takes it: nothing is dropped, however busy the studio is. Blocks of
// 2048 samples, two channels, each with the number of its first sample on the engine's clock.
const BLOCK = 2048;
class RecTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = new Float32Array(BLOCK);
    this.R = new Float32Array(BLOCK);
    this.n = 0;
    this.first = 0;
    this.on = true;
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this.on = false;
    };
  }
  process(inputs) {
    if (!this.on) return false;
    const inp = inputs[0];
    const L = inp?.[0], R = inp?.[1] || L;
    const len = L ? L.length : 128;
    for (let i = 0; i < len; i++) {
      if (this.n === 0) this.first = currentFrame + i;
      this.L[this.n] = L ? L[i] : 0;
      this.R[this.n] = R ? R[i] : 0;
      if (++this.n === BLOCK) {
        this.port.postMessage({ frame: this.first, L: this.L, R: this.R }, [this.L.buffer, this.R.buffer]);
        this.L = new Float32Array(BLOCK);
        this.R = new Float32Array(BLOCK);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('vm-rec-tap', RecTap);
