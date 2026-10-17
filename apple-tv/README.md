# VUEMesh for Apple TV

Shows a VUEMesh studio's program on the TV, straight from the studio computer over the local network; or browses and plays the event's recordings (pulled from the studio, peer to peer); or shows the sync beacon. Menu on the remote picks the mode, and PIP puts the live program in a corner while browsing or beaconing; the studio can choose too. It speaks the same protocol as `public/tv.html` (the browser version), so when something misbehaves, check whether `/tv` in a browser does the same: if it does, the problem is on the studio side.

## Build

1. `brew install xcodegen`, then in this folder run `xcodegen`. That makes `VUEMeshTV.xcodeproj`.
2. Open it, set your team under Signing, and run on an Apple TV (tvOS 17 or later) or the simulator.

The one dependency is LiveKit's WebRTC build for Apple platforms (`https://github.com/livekit/webrtc-xcframework`, product `LiveKitWebRTC`), which builds for tvOS. It prefixes WebRTC's classes with `LKRTC`. The app names that framework in one file only, `VUEMeshTV/WebRTC/WebRTCBridge.swift`; if a class or enum name doesn't match the version you get, fix it there.

The program side has been built and run on an Apple TV 4K. Browse, Beacon, PIP and the mode menu (0.51.0) haven't been compiled yet: expect a fix or two on the first build, most likely in `Views/Screens.swift` (SwiftUI focus and `VideoPlayer`) and the media channel in `PeerLink.swift`.

## Try it against the dev server

1. On the laptop: `node dev/server.mjs`, then open the studio for an event.
2. On the Apple TV, choose **This screen** on the first screen: give the screen a name, and set the server to `http://<laptop address>:8790`. `Info.plist` allows plain HTTP on the local network for this.
3. Enter the event code, then **Accept** the TV under **TV screens** in the studio.

Against vuemesh.com nothing needs setting: the app reads `/config.js` from the server to find the API and signalling addresses, as the web pages do.

## What's where

| File | Does |
| --- | --- |
| `DisplayClient.swift` | The protocol, step for step as `public/js/tv.js`: lookup, socket, hello, waiting or paired, offer, mode, ping (and the studio's clock from it), restart; Browse's list, pictures and downloads |
| `Net/MeshSocket.swift` | The signalling socket, as `meshSocket` in `vm.js` |
| `Net/Server.swift` | Reads `/config.js`, looks events up, keeps the key and this TV's id in the keychain |
| `WebRTC/PeerLink.swift` | The receive-only connection, its `ctl` channel, and the `media` one recordings come in on |
| `WebRTC/SampleBufferRenderer.swift` | Draws the program's frames with AVSampleBufferDisplayLayer (hardware H.264 as is, anything else copied in) |
| `Views/` | Join (code cells and keypad), waiting and standby, program with its fading label, the mode menu, Browse and its player, Beacon (its QR from Core Image), PIP |

## Known limits

- Browse plays MP4, QuickTime, AAC, MP3 and WAV (what phones record). WebM recordings (this computer's own cameras, some Android microphones) are listed but dimmed: they play on `/tv` in a browser. A recording comes over whole before it plays; the last six stay on the TV.
- The beacon draws the studio's clock (learnt from pings on the local network, a few ms) plus this TV's display lag. Turn on the TV's Game mode, then **Calibrate** it in the studio: a phone reads the studio screen's beacon and the TV's, and the difference becomes the lag.
- Sound plays through WebRTC's own audio output. If the TV gets picture and no sound, check that first.
- Fonts are the site's Barlow faces (Latin only), converted to TTF; licence in `Resources/Fonts`.
- There's no app icon or Top Shelf image yet; the App Store needs both.
