# MediaPipe face landmarks, for the studio

Used only by the studio's face tracking (faces, and people's heads by their pose) (`public/js/faces-worker.js`), and only once it is turned on.
Cameras, viewers and TVs never load these files.

| File | From | Licence |
|---|---|---|
| `vision_bundle.js` | `@mediapipe/tasks-vision` 1.1.1 on npm (its browser build), **modified** (below) | Apache-2.0, Google LLC |
| `wasm/vision_wasm_internal.js`, `wasm/vision_wasm_internal.wasm` | the same package, unchanged | Apache-2.0, Google LLC |
| `pose_landmarker_lite.task` | `storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/`, unchanged (SHA-256 `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`): where a person's head and shoulders are when their face can't be seen (turned away, looking down, small in a wide shot) | Apache-2.0, Google LLC |
| `face_landmarker.task` | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/`, unchanged (SHA-256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`) | Apache-2.0, Google LLC |

**The change:** MediaPipe Tasks sends performance and usage counts to Google
(`odml.pa.googleapis.com/v1/log`) once a minute. In this copy its logger never sends: the timer is
gone, `flush()` drops what it holds, and the address is `about:blank`. Pictures were never sent;
now nothing is. `test/faces.test.mjs` checks the address isn't in the file.

To update: take the new version's `vision_bundle.js` and `wasm/vision_wasm_internal.*` from npm,
make the same three changes, and check the test still passes.
