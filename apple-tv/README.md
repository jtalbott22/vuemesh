# VUEMesh for Apple TV

Shows a VUEMesh studio's program on the TV, straight from the studio computer over the local network. It speaks the same protocol as `public/tv.html` (the browser version), so when something misbehaves, check whether `/tv` in a browser does the same: if it does, the problem is on the studio side.

## Build

1. `brew install xcodegen`, then in this folder run `xcodegen`. That makes `VUEMeshTV.xcodeproj`.
2. Open it, set your team under Signing, and run on an Apple TV (tvOS 17 or later) or the simulator.

The one dependency is LiveKit's WebRTC build for Apple platforms (`https://github.com/livekit/webrtc-xcframework`, product `LiveKitWebRTC`), which builds for tvOS. It prefixes WebRTC's classes with `LKRTC`. The app names that framework in one file only, `VUEMeshTV/WebRTC/WebRTCBridge.swift`; if a class or enum name doesn't match the version you get, fix it there.

This code hasn't been compiled yet. Expect a few fixes on the first build, most likely in delegate method signatures (`PeerLink.swift`) and the stats read in `reportRoute()`.

## Try it against the dev server

1. On the laptop: `node dev/server.mjs`, then open the studio for an event.
2. On the Apple TV, choose **This screen** on the first screen: give the screen a name, and set the server to `http://<laptop address>:8790`. `Info.plist` allows plain HTTP on the local network for this.
3. Enter the event code, then **Accept** the TV under **TV screens** in the studio.

Against vuemesh.com nothing needs setting: the app reads `/config.js` from the server to find the API and signalling addresses, as the web pages do.

## What's where

| File | Does |
| --- | --- |
| `DisplayClient.swift` | The protocol, step for step as `public/js/tv.js`: lookup, socket, hello, waiting or paired, offer, mode, ping, restart |
| `Net/MeshSocket.swift` | The signalling socket, as `meshSocket` in `vm.js` |
| `Net/Server.swift` | Reads `/config.js`, looks events up, keeps the key and this TV's id in the keychain |
| `WebRTC/PeerLink.swift` | The receive-only connection and its `ctl` channel |
| `WebRTC/SampleBufferRenderer.swift` | Draws hardware-decoded H.264 frames with AVSampleBufferDisplayLayer |
| `Views/` | Join (code cells and keypad), waiting and standby, program with its fading label |

## Known limits

- Only hardware-decoded frames are drawn. The studio asks for H.264 first, so this only bites if the studio's browser can't send it (Linux Chromium); the app logs it once.
- Sound plays through WebRTC's own audio output. If the TV gets picture and no sound, check that first.
- Fonts are the site's Barlow faces (Latin only), converted to TTF; licence in `Resources/Fonts`.
- There's no app icon or Top Shelf image yet; the App Store needs both.
