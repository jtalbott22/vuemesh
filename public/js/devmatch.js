// Finding a saved camera or microphone among the ones plugged in now (see studio/sources.js).
// No browser needed: tested in test/devmatch.test.mjs.
//
// A device is saved with its id, its name and, where the browser gives one, its USB id. Ids can
// change (the browser's data cleared, another USB port), and names can change when a maker's own
// driver is installed: a Focusrite Scarlett 2i2 4th Gen is "Microphone (Scarlett 2i2 4th Gen)
// (1235:8219)" on Windows' own USB driver and "Analogue 1 + 2 (Focusrite USB Audio)" on Focusrite's,
// with nothing else in common. So it's looked for by each in turn, and never found in another
// device: two of the same webcam, two Focusrites, or a laptop's two Realtek inputs stay apart.

/** The name without the USB id the browser adds ("… (1235:8219)") or Windows' "Default - ". */
export const cleanLabel = (s) => String(s || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^Default - /, '').trim();

/** The USB id the browser adds to a USB device's name ("1235:8219"), if it does. */
export const usbIdOf = (s) => /\(([0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i.exec(String(s || ''))?.[1]?.toLowerCase() || null;

// Makers whose own driver renames their interfaces: the words for the maker on either driver, and
// the name its own driver gives every input (a model on Windows' driver, the maker on its own)
export const FAMILIES = [{ maker: /\b(focusrite|scarlett|clarett|vocaster)\b/i, own: /\(Focusrite USB Audio\)/i }];

const KIND = { mic: 'audioinput', cam: 'videoinput' };
const real = (d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications';

/**
 * The device plugged in now that a saved one is, and how it was found: { d, how } with how one of
 * id, name, usb or driver, or null. claimed: device ids already spoken for (in the show, another
 * saved one's by its id, or removed by hand), never matched by anything but their own id.
 * By driver only for a maker's interface whose driver changed: one of the two names is the one its
 * own driver gives (Focusrite USB Audio) and the other isn't, the other names no USB id that's
 * plugged in, and exactly one such device is free (two models on the same driver never match, and
 * neither do two inputs or two interfaces both on the maker's driver: those keep their names).
 */
export function matchSaved(s, devs, claimed = new Set()) {
  const free = devs.filter((d) => d.kind === KIND[s.kind] && real(d));
  const own = free.find((d) => d.deviceId === s.deviceId);
  if (own) return { d: own, how: 'id' };
  const open = free.filter((d) => !claimed.has(d.deviceId));
  const by = (f, how) => {
    const d = open.find(f);
    return d ? { d, how } : null;
  };
  return (
    (s.label && by((d) => cleanLabel(d.label) === s.label, 'name')) ||
    (s.usb && by((d) => usbIdOf(d.label) === s.usb, 'usb')) ||
    byDriver(s, free, open)
  );
}
function byDriver(s, free, open) {
  const fam = FAMILIES.find((f) => f.maker.test(s.label || ''));
  if (!fam) return null;
  const savedOwn = fam.own.test(s.label || '');
  // (its own USB id still plugged in somewhere: it's that one, not renamed)
  if (s.usb && free.some((d) => usbIdOf(d.label) === s.usb)) return null;
  const c = open.filter((d) => fam.maker.test(d.label) && fam.own.test(d.label) !== savedOwn);
  return c.length === 1 ? { d: c[0], how: 'driver' } : null;
}

/** Found under another name: the names it was given that began with its old name take the new one. */
export function renamed(names, was, now) {
  if (!names || !was || !now || was === now) return names;
  const swap = (n) => (typeof n === 'string' && n.startsWith(was) ? now + n.slice(was.length) : n);
  return Object.fromEntries(Object.entries(names).map(([k, v]) => [k, swap(v)]));
}
