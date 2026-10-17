// QR decoding off the main thread, so scanning for the beacon never stutters the camera.
self.importScripts('/vendor/jsQR.js');
self.onmessage = (e) => {
  const { id, data, width, height } = e.data;
  let text = null;
  try {
    const r = self.jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'dontInvert' });
    text = r?.data || null;
  } catch {}
  self.postMessage({ id, text });
};
