// Finding a saved camera or microphone among the ones plugged in now (public/js/devmatch.js):
// by its id, its name, its USB id, or (renamed by its maker's driver) the one device of that maker
// on the other driver; never another device. No browser needed.
import assert from 'node:assert/strict';
import { cleanLabel, usbIdOf, matchSaved, renamed } from '../public/js/devmatch.js';

const ok = (m) => console.log('ok  ' + m);
const mic = (deviceId, label, groupId = 'g-' + deviceId) => ({ kind: 'audioinput', deviceId, label, groupId });
const cam = (deviceId, label, groupId = 'g-' + deviceId) => ({ kind: 'videoinput', deviceId, label, groupId });
const how = (m) => (m ? [m.d.deviceId, m.how] : null);

{
  assert.equal(cleanLabel('Microphone (Scarlett 2i2 4th Gen) (1235:8219)'), 'Microphone (Scarlett 2i2 4th Gen)');
  assert.equal(cleanLabel('Default - Microphone (Scarlett 2i2 4th Gen) (1235:8219)'), 'Microphone (Scarlett 2i2 4th Gen)');
  assert.equal(usbIdOf('Logitech Webcam C930e (046d:0843)'), '046d:0843');
  assert.equal(usbIdOf('Analogue 1 + 2 (Focusrite USB Audio)'), null);
  ok("a device's name without its USB id, and its USB id where the browser gives one");
}
{
  // Windows' own driver, then Focusrite's: the same Scarlett, with nothing in its name in common
  const saved = { kind: 'mic', deviceId: 'old', label: 'Microphone (Scarlett 2i2 4th Gen)', name: 'Microphone (Scarlett 2i2 4th Gen)' };
  const now = [mic('default', 'Default - Analogue 1 + 2 (Focusrite USB Audio)'), mic('rt', 'Microphone Array (Realtek(R) Audio)'), mic('c1', 'Microphone (Logitech Webcam C930e) (046d:0843)'), mic('fr', 'Analogue 1 + 2 (Focusrite USB Audio)')];
  assert.deepEqual(how(matchSaved(saved, now)), ['fr', 'driver']);
  // and back again: Focusrite's driver taken off, Windows' own names it by its model
  assert.deepEqual(how(matchSaved({ kind: 'mic', deviceId: 'f', label: 'Analogue 1 + 2 (Focusrite USB Audio)' }, [mic('w', 'Microphone (Scarlett 2i2 4th Gen) (1235:8219)')])), ['w', 'driver']);
  // not when it's already in the show, or two are on Focusrite's driver (which would it be?)
  assert.equal(matchSaved(saved, now, new Set(['fr'])), null);
  assert.equal(matchSaved(saved, [...now, mic('fr2', 'Analogue 3 + 4 (Focusrite USB Audio)')]), null);
  // never a camera for a microphone
  assert.equal(matchSaved(saved, [cam('x', 'Focusrite camera (Focusrite USB Audio)')]), null);
  ok('a Scarlett renamed by Focusrite’s driver (or back) is found, when it’s the only one on the other driver');
}
{
  // two Focusrites both named by Windows' driver are two interfaces: a Solo isn't the 2i2, a Vocaster isn't a Scarlett
  const twoI2 = { kind: 'mic', deviceId: 'i2', label: 'Microphone (Scarlett 2i2 4th Gen)', usb: '1235:8219' };
  assert.equal(matchSaved(twoI2, [mic('solo', 'Microphone (Scarlett Solo 4th Gen) (1235:8211)')]), null);
  assert.equal(matchSaved(twoI2, [mic('voc', 'Microphone (Vocaster One) (1235:8216)')]), null);
  // its own USB id still plugged in under another name: that one, by its USB id
  assert.deepEqual(how(matchSaved(twoI2, [mic('i2b', 'Line (Scarlett 2i2 4th Gen) (1235:8219)'), mic('fr', 'Analogue 1 + 2 (Focusrite USB Audio)')])), ['i2b', 'usb']);
  ok('two different Focusrites stay two: the driver rule needs one name from each driver');
}
{
  // by its id first; then its name (ids can change); then its USB id
  const s = { kind: 'cam', deviceId: 'a', label: 'Logitech Webcam C930e', usb: '046d:0843' };
  assert.deepEqual(how(matchSaved(s, [cam('b', 'Logitech Webcam C930e (046d:0843)'), cam('a', 'Something else')])), ['a', 'id']);
  assert.deepEqual(how(matchSaved(s, [cam('b', 'Logitech Webcam C930e (046d:0843)')])), ['b', 'name']);
  assert.deepEqual(how(matchSaved(s, [cam('b', 'Webcam C930e (renamed) (046d:0843)')])), ['b', 'usb']);
  assert.equal(matchSaved(s, [cam('b', 'A different webcam (1111:2222)')]), null);
  ok('found by its id, else its name, else its USB id');
}
{
  // a laptop's Realtek inputs share one group: an unplugged headset never comes back as the built-in mic
  const headset = { kind: 'mic', deviceId: 'hs', label: 'Headset Microphone (Realtek(R) Audio)' };
  assert.equal(matchSaved(headset, [mic('arr', 'Microphone Array (Realtek(R) Audio)', 'realtek')]), null);
  // a name given to it never makes it a Focusrite (a mic named Scarlett after a singer)
  assert.equal(matchSaved({ kind: 'mic', deviceId: 'sh', label: 'Microphone (Shure MV7)', name: 'Scarlett' }, [mic('fr', 'Analogue 1 + 2 (Focusrite USB Audio)')]), null);
  // two of the same mic, which Windows numbers ("2- "): the missing one never takes the other's (claimed by its own id)
  const yeti2 = { kind: 'mic', deviceId: 'y2', label: 'Microphone (2- Yeti Stereo Microphone)', usb: 'b58e:9e84' };
  assert.equal(matchSaved(yeti2, [mic('y1', 'Microphone (Yeti Stereo Microphone) (b58e:9e84)')], new Set(['y1'])), null);
  ok("never another device: not a sibling input, not by a given name, not a twin that's another saved one's");
}
{
  // three of the same webcam: each saved one gets its own, and one unplugged isn't another's twin
  const saved = [
    { kind: 'cam', deviceId: 'w1', label: 'Logitech Webcam C930e', usb: '046d:0843' },
    { kind: 'cam', deviceId: 'w2', label: 'Logitech Webcam C930e', usb: '046d:0843' },
  ];
  const now = [cam('w1', 'Logitech Webcam C930e (046d:0843)')]; // (w2 unplugged)
  const claimed = new Set(['w1']); // (w1 is the first one's, by its own id)
  assert.equal(matchSaved(saved[0], now, claimed)?.how, 'id', 'its own id, even when claimed');
  assert.equal(matchSaved(saved[1], now, claimed), null, 'not its twin');
  ok('three of the same webcam stay three: a claimed device is only ever matched by its own id');
}
{
  const split = { L: 'Microphone (Scarlett 2i2 4th Gen) · Input 1', R: 'Vocals' };
  assert.deepEqual(renamed(split, 'Microphone (Scarlett 2i2 4th Gen)', 'Analogue 1 + 2 (Focusrite USB Audio)'), { L: 'Analogue 1 + 2 (Focusrite USB Audio) · Input 1', R: 'Vocals' });
  assert.equal(renamed(split, 'X', 'X'), split);
  ok('names made from its old name take the new one; names given by hand stay');
}
console.log('\nAll device matching tests passed.');
