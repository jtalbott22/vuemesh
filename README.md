# VUEMesh v0.46 (beta) — LAN-first

Everyone at an event shoots on their own phone. The phones find the host laptop through a tiny cloud handshake, then send everything **directly over the local Wi-Fi**: a live preview for cutting live, and each full-quality clip when they stop recording. The cloud never carries raw video. It only sees the finished film when the host publishes it.

**New here?** Read [How VUEMesh fits together](docs/HOW-IT-WORKS.md): the roles, the one-beacon rule, which browser to use for the studio, network and capacity.

## How the pieces fit

| Where | What happens |
| --- | --- |
| **Beacon** (a screen at the venue) | One QR that is the join link and the master clock, plus an optional Wi-Fi join code. Shows how many phones are in. |
| **Guest phone** (`/cam`) | Join, sign the terms with the phone's own key, optical sync, record full quality locally. Streams a low-res live preview to the host and sends each finished clip over a WebRTC data channel in 8 MB hashed parts. Unsent clips wait in the phone's outbox (survives reloads) until the host confirms them. |
| **Host laptop** (`/studio`) | The hub. **Live**: every phone's preview in a multiview, cut with 1–9, break slate with a sponsor reel, a mixer with meters (and a pop-out audio console with EQ and visualizers), record the program to a file (or point OBS at it). **Edit**: a layered timeline (top track wins) with trims, moves, splits, titles, slates, images and picture-in-picture, a mixer, and **Render MP4** faster than real time. |
| **Monitor** (`/monitor`) | Second tab for the host: network, device and transfer health for every phone, and an event log. Reads from the studio in the same browser. |
| **Admin** (`/admin`) | For you and your team: every event, rename, list/unlist, change expiry, delete films and events. |
| **Watch page** (`/watch`) | When publishing is on: plays the film, shows credits, and verifies every contributor's signature in the browser. Off during the beta. |
| **Terms** (`/terms`) | Beta Terms of Use. Hosts and guests agree before creating or joining. |
| **Landing** (`/`) | Live multi-angle demo, a globe and board of public events, and start an event (landscape or portrait, optionally listed on the globe). |
| **Sponsors** (`/sponsors`) | Where sponsors can appear and the house rules. Contact goes to `sponsorEmail` in `public/js/brand.js`, or Patreon if that's empty. |
| **AWS** (`aws/`) | CloudFront + S3 for the app and films, HTTP API + Lambda for events/discovery/publish URLs, WebSocket API + Lambda for presence and WebRTC handshakes, DynamoDB with TTL. All scale to zero. |

Live cuts made on the host are stamped on the shared clock, so when the full-quality clips arrive the cut is already there. Put the beacon on a second screen of the host laptop to keep one clock for everything.

## Run it locally


**Everything at once:** `python3 test/run_all.py` starts the dev server, runs the unit tests and
every end-to-end suite one at a time, and writes `test-results.txt` (a PASS/FAIL line per suite,
and the last lines of each failure). `python3 test/run_all.py editor kiosk` runs only suites whose
names contain those words; `--failed` reruns what failed last time; `--list` lists them.

```bash
npm install
npm run dev          # http://localhost:8790 — same API/signaling code as the Lambdas, in memory
npm test                          # cloud core unit tests (events, discovery, signaling, admin, expiry, switches)
node test/sequence.test.mjs       # edit operations (ripple, roll, slip, slide, slicing) and the AI director
python3 test/e2e.py               # host + phone: live cut, P2P transfer, verify, lower third, Render MP4 (checked with ffprobe)
python3 test/e2e_editor.py        # two cameras: Premiere tools (add edit, ripple, roll, slip, slide, razor), markers, PiP, layers, mixer, render
python3 test/e2e_orientation.py   # a phone turned mid-shot with rotation lock: upright pixels, turn log, slicing, overrides
python3 test/e2e_director.py      # AI director: cuts away from a shaky shot with a reason, tally, override, break slate, local-only
python3 test/e2e_render.py        # renderer: lying encoder, corrupted clip, iPhone rotation flag (needs ffmpeg)
python3 test/e2e_camera_pro.py    # phone: lenses, separate mic, zoom in the recording, focus, lock, overlays, meter, full screen
python3 test/e2e_media.py         # media manager: moments, tags, stars, Source monitor, subclips, insert/overwrite, export, trim, delete
python3 test/e2e_controlroom.py   # full screen control room: switcher bus, meter bridge, AFV / ON / OFF, breakaway
python3 test/e2e_crew.py          # director messages, replies, rundown cues, output shape, pause, leave and rejoin
python3 test/e2e_layout.py        # Live and Edit rooms, Program out window, resizable panels, transforms (needs ffmpeg)
python3 test/e2e_events.py        # home page: events on this device, ended-on-server, export ZIP, archive, delete
python3 test/e2e_playout.py       # live clips, lower third, Program out with the studio covered, sideways mixer (needs ffmpeg)
python3 test/e2e_devices.py       # Android lens switching, a computer as a camera, stacked notices, meters drawing
python3 test/e2e_footage.py       # My footage: delivery status, a failed clip doesn't block others, retry, player, delete, show data
python3 test/e2e_micpick.py       # microphone mode: choose the mic before and during recording; My footage from the room-code screen
python3 test/e2e_range.py         # Collapse gaps (with undo), In/Out on the timeline, render just the range (needs ffmpeg)
python3 test/e2e_solo.py          # theme symbol, the camera on its own, scanning a real beacon code to join (needs ffmpeg)
python3 test/e2e_safearea.py      # camera controls clear of the notch / Dynamic Island when held sideways
python3 test/e2e_contextmenu.py   # right-click editing, replace media, PiP from Source, track targets, recording on air, program meters
python3 test/e2e_audio.py         # editor sound under real browser rules: both meters, the Source monitor, recovering paused sound
python3 test/e2e_programcopy.py   # the live cut in parts, sent to each person for the time they were there (and on rejoin)
python3 test/e2e_diag.py          # recording format detection and warning, unplayable parts explained, diagnostics reports
python3 test/e2e_overflow.py      # record-only overflow, promotion, Swap in; sharing tags on every page
python3 test/e2e_mic_break.py     # microphone phone, live mixer, break slate (manual + automatic), portrait
python3 test/e2e_rtmp.py          # RTMP through the relay to a stand-in RTMP server (needs ffmpeg)
python3 test/e2e_whip.py          # Stream out over WHIP to a stand-in endpoint
python3 test/e2e_local.py         # cameras and microphones on the studio computer: tiles, recording on the studio clock, back after a reload
python3 test/e2e_v27.py           # switcher room, preview box, PAUSED in Camera control, centred record button, remove / block / let back in
python3 test/e2e_kiosk.py         # /kiosk in an iframe: hands-free; the first phone names the show; a fresh show after each one
python3 test/e2e_home.py          # the home page: Camera, My media, Kiosk, Join right away (terms once); /edit without a code
python3 test/e2e_mymedia.py       # My media shows the studio's recordings on this device; Delete clears the editor
python3 test/e2e_monitordel.py    # Delete in Monitor removes a recording from this computer and the editor
python3 test/e2e_pages.py         # Live and Edit as separate pages: each its own controls, no errors pressing around
python3 test/e2e_editpage.py      # Edit in its own window beside the live studio; Program out's Live / Edit picker
python3 test/e2e_recpolicy.py     # cameras record only while Record program runs; a person's own recording comes first
python3 test/e2e_console2.py      # the audio console with two microphones on a 2x screen stays steady
python3 test/e2e_blackrec.py      # nothing records at black; the fade is in Edit (fades out, fades in)
python3 test/e2e_editbreaks.py    # live breaks as items in Edit; the Dissolve button and D; the studio's event list with no code
python3 test/e2e_eventsapart.py   # same-named events and reused codes kept apart on a phone
python3 test/e2e_autopilot.py     # Record with the fades; autopilot: starts at a camera, welcomes the next, ends when all have gone
python3 test/e2e_screen.py        # a shared screen (with its sound) and this computer's sound as sources
python3 test/e2e_vcam.py          # the program as a camera for video calls: relay → (stand-in) OBS over local UDP, H.264 + AAC
python3 test/e2e_phonerobust.py   # a phone that won't store blobs, a camera that stops in the background, a camera that never answers on join
python3 test/e2e_dissolve.py      # a live dissolve arrives in Edit as a dissolve; crossfading sound; ¼ s / Cut in the Selection panel; renders through it
python3 test/e2e_secondtake.py    # a second take after hand edits (Collapse gaps) goes on the end, after the real gap
python3 test/e2e_aired.py         # anything aired makes Edit: computer cameras, aired clips, recordings finished on entering Edit, the program recording in Media
python3 test/e2e_clipcue.py       # clips through the switcher: cued paused in preview, playing as they dissolve in or cut on
python3 test/e2e_switcher.py      # preview, AUTO dissolve, the T-bar by hand, CUT, Tap: Air; Camera control strips and messages
python3 test/e2e_growth.py        # Admin, Growth: anonymous day counts, growth vs the previous period, CSV, investor snapshot, saved snapshots
python3 test/e2e_editaudio.py     # edit sound with a camera and a microphone: camera sound ducks under the mic, plays elsewhere
python3 test/e2e_v24.py           # guided setup, private selfie camera, lens at 1x, Pause feed on air, event code typing, two program takes
python3 test/e2e_rejoin.py        # Rejoin as camera / Rejoin as microphone
python3 test/e2e_v23.py           # a podcast: microphones as live sources (tally, number keys, whoever's talking), no break slate while there's sound
python3 test/e2e_v22.py           # leave/rejoin 3x keeps pictures and sound; Pause feed; lens choice in Camera control; transfers in the Monitor
python3 test/e2e_ccu.py           # Camera control window (scopes, remote zoom/brightness/contrast/focus); the wide zoom pad and gliding zoom
python3 test/e2e_permtip.py       # scan-to-join on the same page; the once-only "make it remember" tip per browser
python3 test/e2e_v201.py          # fitted mixer, Live panel buttons, relay steps per computer, one-click full screen, one dark theme
python3 test/e2e_v19.py           # a microphone alone, leaving to home and rejoining, the live cut for someone leaving, My events, sound sync, WHIP streaming
python3 test/e2e_audio_console.py # left-only microphones recorded on both sides, moments/markers through Collapse gaps, the audio console
python3 test/e2e_synclock.py      # beacon timing locked in: on/off air, black, reload never ask again; a clock slip asks once (needs ffmpeg)
python3 test/e2e_showcontrol.py   # lower thirds (delete, edit), fade/cut to black, slate looks, moments, markers, rundown end/clear, picture watchdog
python3 test/e2e_outbox_globe.py  # clips waiting for a late host, reload survival, nearby events
python3 test/e2e_admin_monitor.py # monitor tab, beacon dimmers, admin panel (dev admin key: dev-admin)
```

Phones need HTTPS for the camera, so real phone tests go through the AWS deploy.

## Put it on AWS

See [`aws/README.md`](aws/README.md). Short version: install the AWS CLI and SAM CLI, then `./aws/deploy.sh`. Or paste [`aws/PROMPT.md`](aws/PROMPT.md) into Kiro (AWS's AI coding agent) and let it do the steps.

## Keyboard

Press **?** anywhere in the studio (and on guest phones with a keyboard) for the full list.

| Keys | Studio |
| --- | --- |
| 1–9 | Cut to a camera (live) or angle (edit) — the same phone either way |
| A, B, R, M, T | Live: auto director, break slate, record the program, mark a moment, lower third |
| X, Shift + X | Live: fade to black, cut to black (press again to come back up) |
| Click a source | Live: cut to that camera, or put a clip on air |
| Shift + 1–9 | Live: that camera's sound AFV → ON → OFF |
| F | Full screen (studio) |
| [ / ] | Live: previous / next rundown cue |
| I / O, Alt+X | Edit (Program showing): mark the export range, clear it |
| Right-click, Shift+F10 | Edit: menu for a clip, camera tile or media item |
| Shift + 2 / Shift + 4 | Edit: Source monitor / Program monitor |
| I / O, `,` / `.` | Source monitor: mark In / Out; insert / overwrite at the playhead |
| ` | Switch Live / Edit |
| V B N C Y U H | Edit tools: Selection, Ripple, Rolling, Razor, Slip, Slide, Hand (Premiere keys) |
| Space, J / K / L | Play/pause, shuttle |
| ← / →, Shift, Alt | Frame step (Shift: 5 frames); Alt nudges the selected item |
| ↑ / ↓ | Previous / next edit point or marker |
| Ctrl/⌘ K, Q / W | Add edit at the playhead; ripple trim start / end to the playhead |
| Delete, Shift + Delete | Lift; ripple delete |
| M, S, = - \\ | Marker; snapping; zoom in / out / fit |
| Drag, double-click, Delete | Edit: move, rename or remove a marker or moment on the ruler (right-click for more) |
| T, Shift + P | Add a lower third; add picture-in-picture |
| Ctrl/⌘ Z, Esc | Undo (Shift to redo); deselect |
| [ / ], H, F | Beacon: dim or brighten the code, show controls, full screen |

## Security model

- Each phone makes a P-256 key on first use. Joining signs the event's terms; every clip's fingerprint (hash of its part hashes) is signed off by the phone.
- The host laptop checks every part hash, the fingerprint, the key, and both signatures before accepting a clip.
- Published manifests carry the signatures, so anyone can re-verify who shot what.
- The host key (in the studio link) is required for hosting the signaling room and publishing. Guests can only message the host, never each other.
- Public listings store location rounded to about a kilometer.

## Streaming to RTMP (YouTube, Facebook, Kick, Vimeo…)

Stream out in the studio sends the program to one service. WHIP services (Twitch, Restream,
Cloudflare Stream, Dolby OptiView) take it straight from the browser. RTMP services need the
**VUEMesh relay**, because no browser can send RTMP:

1. Install [Node.js](https://nodejs.org) (18 or later) and [ffmpeg](https://ffmpeg.org/download.html) on the computer running the studio. Stream out shows the exact commands for Windows (winget), Mac (Homebrew), Linux (apt) and ChromeOS (the Linux development environment), opening on the one you're using.
2. Download the relay from Stream out ("download the relay"), or use `public/relay/vuemesh-relay.mjs` from this repo.
3. Run it and leave the window open: `node vuemesh-relay.mjs` (or `npm run relay` in the repo).
4. In Stream out, pick the service, paste the stream key (and the server URL if it isn't filled in), and press Go live.

The relay listens on this computer only (`ws://localhost:8935`; `--port` to change it), takes
connections only from VUEMesh pages (`--origins` to add your own), only sends to `rtmp://` and
`rtmps://` addresses, and never prints the stream key. It re-encodes to what services expect
(H.264 with a keyframe every 2 s, AAC at 160 kbit/s), which takes some CPU: if the studio says
the computer is struggling, pick a lower quality.

## Live picture quality

Each phone sends two things: its full-quality recording (kept on the phone, sent afterwards for
Edit) and a live picture for the studio, which the program, Record program and the stream are made
of. The live picture follows the show:

| | On the local network | Same network, via the router | Over the internet | Mobile data or a relay |
|---|---|---|---|---|
| **On air** (program) | 8 Mbps, full size | 6 Mbps, full size | 4 Mbps, full size | 2.5 Mbps, full size |
| **In preview** (next) | 3 Mbps, full size | 2.5 Mbps, full size | 1.8 Mbps, full size | 1.2 Mbps, 2/3 size |
| **Standby** | 1.2 Mbps, half size | 1 Mbps, half size | 0.9 Mbps, half size | 0.6 Mbps, half size |

So what's on air is sharp, a cut to what's in preview is sharp at once, and a room full of phones
doesn't fill the Wi-Fi with full-size pictures nobody's watching. Every two seconds each phone
checks its link: loss, or the browser saying the network is holding the picture back, steps its
ceiling down by a quarter; ten clean seconds step it back up. Links start near their target, not
at a few hundred kbit/s (Chrome and Edge take the start, floor and ceiling hints; every browser
takes the ceiling). The table is `LIVE_QUALITY` in `public/js/quality.js`.

The stream out (WHIP) starts at three-quarters of its chosen rate and won't sink below 30% of it;
Program out's Edit picture, which never leaves the computer, starts at 12 Mbps with a floor of 8.
**Monitor** shows each camera's live picture (on air, preview or standby; what it's sending of
what it may; its size and frame rate; what's holding it back: the network or the phone's encoder)
and the stream's rate and picture.

## A WHIP receiver on your own computer

`tools/whip_receiver.py` takes the studio's program on a computer of yours (on the same network,
say), shows it and records it: `pip install aiortc aiohttp`, then `python whip_receiver.py`. It
prints the WHIP URL and bearer token to paste into the studio (Stream out › Another WHIP service),
and a dashboard link with its key (keep that to yourself: the dashboard shows the token). The
token and key are kept between runs (`whip_receiver.json`; `--new-token` for new ones), and it
makes its own certificate if there's none. Open the dashboard once from the studio's computer and
accept the certificate, or the studio can't reach it. Recordings go to `recordings/`.

It's built on aiortc, which tells the browser a far-too-low bandwidth estimate (it cut the stream
to 0.5 Mbit/s within three seconds); the receiver leaves out what that estimate needs, so the
stream runs at the rate chosen. For something bigger, MediaMTX takes WHIP too, without the
re-encoding this does for its preview.

## Phone remote

Run the show from your phone while you step away from the studio. In the studio's right-hand
panel, **Phone remote > Add a phone** shows a QR code and a one-time code (good for two minutes
and one phone; five wrong tries take it away). Scan it, or go to `/remote` and type the show and
the code. The phone then shows what's on air and whether the program is recording, every camera
by name with its tally (red on air, green in preview) and a small picture every few seconds,
and can cut to a camera, turn the auto-director on and off, fade to black and up, take a break,
and start and stop Record program (it asks before stopping).

The pairing gives that phone its own session key, which every command carries; nobody else in
the show can control it (cameras can't, and the code is no use once used or expired). Paired
phones are remembered on the studio computer for that show, so a reload doesn't unpair them; a
reload of the phone carries on too. **Remove** unpairs one at once. Pictures are sent only while
the remote is open and on screen; nothing goes through the server but the messages (which go only
between the studio and that phone).

## The films on the home page

The hero's program monitor plays the three films (First Dance, Live Tonight, Game Night) when it
comes into view, muted, one after another, then hands over to the live demo; the keys under the
wall pick one, and Sound turns the sound on. Put the files in `public/media/` as `wedding.mp4`,
`concert.mp4` and `arena.mp4` (the films pipeline's `cut` makes them: H.264 MP4, 1280x720) and
deploy as usual. A film that isn't there is left out (its key hidden), so the page works before
they're all uploaded. Nothing plays by itself for anyone who's asked their device for less motion.

## Web traffic (Admin)

Every page sends one anonymous page view when it loads (not the admin pages, and not for browsers
that ask not to be tracked: Do Not Track or Global Privacy Control). No cookies and nothing stored
about anyone: a visitor is counted once a day by a fingerprint (a salted hash of the day, their
address and browser) that's deleted after two days. Bots aren't counted. Admin's **Web traffic**
panel shows visitors, page views, pages, where visitors came from, landing pages, campaigns
(`?utm_source=` on a link), devices, browsers, countries (when the edge provides them) and how
often each film was played and watched to the end, with a CSV.

## Kiosk: a screen people walk up to (and digital signs)

`/kiosk` needs nothing pressed: it opens this screen's show (or starts one) as the studio,
stripped down: the cameras, the program, and its own join code beside them, pulsing, filling
the screen's height, with "Scan to start a show". No buttons, no inputs, and it asks the
browser for nothing (no camera, microphone or screen): it only receives phones.

- **The first phone to scan in names the show** ("You're first here: name the show"), and once
  it's locked in to the code gets **Go live**: a tap counts in 3-2-1 on the phone and on the
  kiosk, then the program fades up and records. (If that phone leaves, the next one gets Go
  live; after 3 minutes the show starts anyway.) Everyone after joins that show; the autopilot
  welcomes each and cuts between them.
- **Phones keep their clips** (in My events): a kiosk doesn't collect them; each phone still
  gets its part of the live cut.
- **When a show ends** (everyone gone for the time chosen) it fades out, stops recording, and
  once nothing's still being sent (or 3 minutes on) the screen thanks them and starts a fresh
  show with a new code; the old one is deleted. A show also deletes itself 12 hours after it started.
- A camera on the kiosk's own computer (a webcam added in the studio) never starts or keeps a
  show going: it joins the rotation while phones are on.

### Setting up a kiosk on a sign

1. **On the sign's computer, in the browser the sign will use,** open the studio once (any
   event: `/studio`, or make one on the home page) and set how shows should look and run. The
   kiosk uses this browser's settings: the break slate and its look and message (Auto break),
   the fade time, the intro clip and the autopilot's end time (Output), the output shape, and
   any webcam on this computer (+ This computer) you want in the rotation.
2. **Put `/kiosk` on the screen**, full screen (F11, or the sign's kiosk mode), or in an iframe
   on the sign's page; nothing has to be allowed:

   ```html
   <iframe src="https://vuemesh.com/kiosk" style="border:0;width:100vw;height:100vh"></iframe>
   ```

   (Add `allow="screen-wake-lock"` if the sign's page permits it, to keep the screen awake.)
3. **Keep it on and connected** for the show: the kiosk is the studio, so phones connect to it
   (best on the same Wi-Fi), and it sends each phone its part of the live cut.

## The program as a camera in video calls

Stream out → **Zoom, Teams or Meet (as a camera)** sends the program through the relay (relay
version 2: download it again) to a camera the call can pick:

- **Mac and Windows:** OBS Studio makes the camera. The relay sends the program to OBS on this
  computer as MPEG-TS on `udp://127.0.0.1:9998` (`--vcam-port` changes it). In OBS: Media Source,
  Local File off, Input `udp://127.0.0.1:9998`, Input Format `mpegts`; then Start Virtual Camera.
  Sound: OBS monitoring to BlackHole (Mac) or VB-CABLE (Windows), picked as the call's microphone.
- **Linux:** no OBS. With a v4l2loopback device (`card_label=VUEMesh`) and a PulseAudio/PipeWire
  null sink named `VUEMesh`, the relay writes the program straight into them: camera "VUEMesh",
  microphone "Monitor of VUEMesh".
- **ChromeOS, or no install anywhere:** Program out, then Share screen in the call.

## Growth numbers (for investors) without keeping anyone's data

Events and everything in them still delete themselves 30 days after they're created. Alongside,
the server keeps one record per day of **anonymous counts**, which never expire: events created
(by kind), events run (a studio opened that day), cameras, microphones and viewers joining (each
counted once per event, by a hash that expires with the event), recordings received, hours of
footage, live cut and streaming, and films published. Nothing in a day's counts names a person,
a phone, a place or an event.

**Admin → Growth** shows them: the period against the one before (▲▼%), a chart with the running
total, a month table, **Download CSV**, **Investor snapshot** (a printable page: Print, then Save
as PDF) and **Save snapshot** (freezes today's numbers for the record, to quote later). **Fill in
earlier days** counts the events still stored (the last 30 days) into days from before counting
began. Footage and live-cut hours come from studios on 0.25 or later.

## Known limits in v0.20

- Guests need to be on the same network as the host for the direct path. Venue Wi-Fi with client isolation needs a travel router.
- Very long camera clips are held in phone memory until sent; keep them under ~10 minutes. Microphone phones split automatically.
- A browser can't stop a phone from sleeping on its own. VUEMesh holds a wake lock (supported on current iPhone and Android browsers) and recovers the microphone if it's interrupted, but for long events keep phones plugged in with the screen on.
- RTMP was tested end to end through the relay to an ffmpeg RTMP server standing in for YouTube; the service URLs filled in for YouTube, Facebook, Twitch and Vimeo are their published defaults, so check them against your dashboard. Chrome may ask permission before a website can reach the relay on your computer.
- Stream out (WHIP) was tested end to end against a stand-in WHIP endpoint (another browser), not against Twitch or the other services: the sandbox can't reach them. Whether a service accepts a stream from a browser page (CORS) is up to the service; the studio says so plainly if it refuses.
- Sound sync needs a few seconds of shared sound between overlapping clips; silence or very different sound (a mic in another room) is left on the beacon's timing.
- The left-only microphone fix was tested with a simulated left-only microphone in desktop Chrome (it reproduced the fault, and the fix fills both sides); it still needs a check on a real iPhone.
- Break reel videos play silent on the program; sound for commercials is a next step. Slate sound (tone or hiss) plays at a fixed level.
- The live-picture watchdog was tested by simulating each kind of freeze in a desktop browser; the freezes seen at real events haven't been reproduced in testing yet. The Monitor log says which kind it fixed each time, which will show where they come from.
- Rotation and the director depend on phone sensors. They were tested with synthetic sensor events in a desktop browser, not yet on a wide range of real phones; a phone lying flat can't tell which way is up, so it keeps its last answer (fix any slip with the per-item rotation override).
- Phones record the camera's own picture at the chosen quality; a turn or lens change mid-take starts a new, overlapping clip. Digital zoom and exposure are applied in the studio, not baked into the file.
- Live-cut parts go to phones over the local network only. A phone that never comes back to the event doesn't get the parts it missed.
- Camera people keep a copy of their clips after delivery (they can turn this off). Phones may clear stored website data if the site isn't opened for a few weeks, so anything worth keeping should be saved from My footage.
- Computers can join as cameras. They're detected from the browser; a touch-screen laptop or tablet may be treated as a phone.
- iPhones ask for motion permission when you join; if someone declines, their clips still record upright as the screen shows them, and the director rates them on the picture alone.
- Camera controls depend on what each phone lets a browser do. Android Chrome exposes most (zoom, torch, focus point, exposure); iPhones expose fewer, so zoom and exposure may be digital there, and focus lock may not be available (the phone says so).
- iPhone browsers can't go full screen; adding VUEMesh to the Home Screen gives the full-screen app.
- Media library details (tags, subclips, moments, trims) are kept in this browser on the host computer, like the edit itself. Use Export on the home page to keep a copy outside the browser.
- Program out needs the studio tab open in the same browser (it takes the picture straight from it). It keeps running when it covers the studio, on one screen or two.
- Clips aired live are in the program recording, but not yet placed on the Edit timeline when it's rebuilt from live cuts. Export ZIPs are limited to 4 GB; bigger events download as separate files.
- The studio needs Chrome or Edge on a computer. Render MP4 speed depends on the machine: on a test machine with no graphics hardware it ran at roughly 0.25–0.8× real time (software VP9); Chrome and Edge normally use hardware H.264 and should be several times faster. Real-time export is always available.
- Render MP4 holds decoded audio in memory; for films over about 30 minutes it writes straight to disk when the browser allows it, but very long events may be better split.
- The Terms are a starting point, not legal advice. Have a lawyer review them before you charge money or turn publishing on.
- Export renders in real time on the host laptop (keep the tab in front).
- Remote viewers get the published director's cut. Watching any single angle remotely would mean hosting every clip, which is the expensive thing this design avoids.
