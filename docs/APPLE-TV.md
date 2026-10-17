# TV screens (the Apple TV app and /tv)

A TV joins an event as a **display** and shows the studio's program, straight from the studio computer over the local network. Nothing but the handshake touches the cloud, and there is no relay.

The full design (Browse, Beacon, Wi-Fi join, enterprise Wi-Fi, timecode rules) is the spec doc "VUEMesh Display Signaling Spec (Apple TV)". This file covers what 0.48.0 builds: the demo slice, join code to program out.

## What's in 0.48.0

| Piece | Where |
| --- | --- |
| Cloud: the `display` role, TVs hear who's here, a `displays` day count | `aws/functions/lib/core.mjs` |
| Studio: TV screens panel, pairing, program out to each TV | `public/js/display-hub.js`, `studio.js`, `studio.html` |
| A TV in any browser, and the reference for the app | `public/tv.html`, `public/js/tv.js` |
| The Apple TV app | `apple-tv/` (see its README) |
| Tests | `test/core.test.mjs` (display role), `test/e2e_display.py` |

## How it goes

1. The TV looks the event up: `GET /api/events/{code}`.
2. It opens the event's socket as `role=display` and says `{action: "hello"}`.
3. When the studio is in `peers`, it signals the studio `{display: {v: 1, t: "hello", name, model, caps, screen, key?}}`.
4. The studio answers `waiting` (it shows under TV screens with Accept), or `paired` with a key if it already knows this TV. A TV can also send `{t: "pair", code}` with a one-time code from **Show a TV code** (8 characters, 2 minutes, 5 tries).
5. Once paired, the TV offers a receive-only connection (video and audio recvonly, plus a reliable `ctl` data channel) with the usual `offer` / `answer` / `ice` kinds. The studio answers, H.264 first, up to 6 Mbit/s.
6. On `ctl`: the studio sends `{t: "mode", mode: "program" | "idle"}` and `{t: "meta", title}`; the TV pings every 5 s and reports `{t: "state", status, mode}`.

The TV never talks to phones (the cloud only lets guests signal the host). It sends `restart` and offers again if the studio stops answering for 15 s, and shows a same-network message if the connection can't form in 10 s.

## Try it

```
node dev/server.mjs
```

Open the studio for an event, then on any other screen open `http://<laptop>:8790/tv` (or the Apple TV app pointed at that server) and enter the event code. Accept it under **TV screens**.

```
python3 test/run_all.py display
```

## Not yet

Edit mode as the TV's source (it shows the live program), Browse, Beacon mode and its Wi-Fi phase, the device key, the bandwidth warning, and re-forwarding between TVs.
