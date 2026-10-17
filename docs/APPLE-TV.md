# TV screens (the Apple TV app and /tv)

A TV joins an event as a **display** and shows the studio's program, straight from the studio computer over the local network. Nothing but the handshake touches the cloud, and there is no relay.

The full design (Browse, Beacon, Wi-Fi join, enterprise Wi-Fi, timecode rules) is the spec doc "VUEMesh Display Signaling Spec (Apple TV)". This file covers what's built: join code to program out (0.48.0), and Browse, Beacon and PIP (0.51.0).

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
4. The studio answers `waiting` (it shows under TV screens with Accept), or `paired` with a key if it already knows this TV. Accept is the only way in: knowing the event code (it's on every beacon) isn't enough on its own.
5. Once paired, the TV offers a receive-only connection (video and audio recvonly, plus a reliable `ctl` data channel) with the usual `offer` / `answer` / `ice` kinds. The studio answers, H.264 first, up to 6 Mbit/s.
6. On `ctl`: the studio sends `{t: "mode", mode: "program" | "browse" | "beacon" | "idle", pip, params: {lag}}` and `{t: "meta", title}`; the TV pings every 5 s (`{t: "ping", seq, at}`, answered `{t: "pong", seq, at, now}` with the studio's clock) and reports `{t: "state", status, mode}`. The TV can ask for a mode itself: `{t: "want", mode, pip}`; the studio remembers it and answers with `mode`.

## Modes

| Mode | The TV shows | Picture / sound sent |
| --- | --- | --- |
| `program` | the live program | both |
| `browse` | the event's recordings: `{t: "list"}` → `{t: "list", items}` then `{t: "thumb", id, data}` each; `{t: "get", id}` → on the `media` data channel (opened by the TV, reliable, ordered) `{t: "file", id, size, mime}`, the bytes in 64 KB pieces, `{t: "end", id}`. One at a time; `{t: "cancel", id}` stops one. The TV plays it itself | the picture only with PIP |
| `beacon` | the sync beacon: the join link with the clock in it (as `/beacon`), on the studio's clock (offset from the pong with the shortest round trip) plus `params.lag` | the picture only with PIP |
| `idle` | the event card | nothing |

**Lag.** A TV shows a picture 20 ms (game mode) to 100+ ms after it gets it, so a beacon on it would put phones synced to it that far behind. The studio's **Calibrate** shows a reference beacon on its own screen (`/tvcal?e=…&c=…#t=…`); a phone that scans it opens `/tvcal`, reads that beacon and the TV's, and sends the difference of the best readings (the camera's own delay drops out) to the studio through the cloud (`{tvcal: {c, ms}}`, from a `viewer`). The studio adds it to the TV's lag and the TV's beacon draws that far ahead.

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

Edit mode as the TV's source (it shows the live program), the beacon's Wi-Fi phase, the device key, the bandwidth warning, re-forwarding between TVs, and playing a recording before it has all come over.
