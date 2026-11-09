# Tests

All of these run with one command, which starts the dev server itself:

```bash
python3 test/run_all.py                 # everything (45-90 minutes); writes test-results.txt
python3 test/run_all.py editor kiosk    # only suites whose names contain these words
python3 test/run_all.py --failed        # rerun what failed last time
python3 test/run_all.py --list          # list the suites
```

The end-to-end suites need Python 3 with Playwright (`pip install playwright; python3 -m playwright
install chromium`), and some need `ffmpeg`. To run one by itself, start `npm run dev` first.

## Unit tests (node, no installs)

`npm test` runs all ten, and GitHub Actions runs them on every push and pull request.

| File | Covers |
| --- | --- |
| `test/core.test.mjs` | cloud core: events, discovery, signaling, admin, expiry, switches, growth, local shows' addresses |
| `test/sequence.test.mjs` | edit operations (ripple, roll, slip, slide, slicing) and the AI director |
| `test/quality.test.mjs` | live picture quality hints |
| `test/imports.test.mjs` | every import across the front end is exported by its module |
| `test/config.test.mjs` | every page that talks to the cloud loads `/config.js` first (the share page didn't, and couldn't reach the studio on the real site); no password fields but the admin key |
| `test/docsync.test.mjs` | one version in `package.json`, `APP_VERSION` and the newest `CHANGELOG.md` heading; every version renders on What's new without raw markdown; every file the README links to exists; every page but the program output shows the version, linked to its place on What's new |
| `test/framesync.test.mjs` | one timeline: a camera's quickest delivery, the picture delay (up at once, down between shows), each camera's frame of a moment, a stalled camera held, the clap in sound and picture |
| `test/tvquality.test.mjs` | a TV falling behind: its bitrate down (at most every 10 s, not below the floor), and back up when steady |
| `test/local.test.mjs` | the local show helper: its address answers (the show's name, IPv6 none, others passed on), the hotspot's commands on Linux and Windows (and why not on a Mac), the Wi-Fi code's escaping, its certificate request checked by openssl, only VUEMesh's pages let in |
| `test/showlog.test.mjs` | the show log: sound alerts (stopped, silent, unplugged; nothing arriving or sending silence; what to try for an interface here), the mixer's watch putting back a sound that stopped reaching it, the summary, chunks put back together, a phone's sound hurried after a stall or made up (worked out from two link readings, said once in the summary), a screen's system sound after Windows moved to another speaker (said at once with both names, cleared when it's put right) |
| `test/splice.test.mjs` | Record program's millisecond corrections to the sound: put in or taken out, the join doesn't click (110 Hz to 3 kHz), the length changes by exactly that, the sound either side is untouched |
| `test/devmatch.test.mjs` | finding a saved camera or microphone again: by its id, name or USB id, or (renamed by its maker's driver) the one on the other driver; never another device (twins, two Focusrites, a laptop's two inputs) |

## End-to-end suites (browser)

`test/vmtest.py` holds the shared helpers. The dev admin key is `dev-admin`.

| File | Covers |
| --- | --- |
| `test/e2e.py` | host + phone: live cut, P2P transfer, verify, lower third, Render MP4 (checked with ffprobe) |
| `test/e2e_editor.py` | two cameras: Premiere tools (add edit, ripple, roll, slip, slide, razor), markers, PiP, layers, mixer, render |
| `test/e2e_orientation.py` | a phone turned mid-shot with rotation lock: upright pixels, turn log, slicing, overrides |
| `test/e2e_director.py` | AI director: cuts away from a shaky shot with a reason, tally, override, break slate, local-only |
| `test/e2e_render.py` | renderer: lying encoder, corrupted clip, iPhone rotation flag (needs ffmpeg) |
| `test/e2e_camera_pro.py` | phone: lenses, separate mic, zoom in the recording, focus, lock, overlays, meter, full screen |
| `test/e2e_media.py` | media manager: moments, tags, stars, the Source viewer beside the Program, subclips, insert/overwrite, export, trim, delete |
| `test/e2e_controlroom.py` | full screen control room: switcher bus, meter bridge, AFV / ON / OFF, breakaway |
| `test/e2e_crew.py` | director messages, replies, rundown cues, output shape, pause, leave and rejoin |
| `test/e2e_layout.py` | Live and Edit rooms, Program out window, resizable panels, transforms (needs ffmpeg) |
| `test/e2e_events.py` | home page: events on this device, ended-on-server, export ZIP, archive, delete |
| `test/e2e_playout.py` | live clips, lower third, Program out with the studio covered, sideways mixer (needs ffmpeg) |
| `test/e2e_devices.py` | Android lens switching, a computer as a camera, stacked notices, meters drawing |
| `test/e2e_footage.py` | My footage: delivery status, a failed clip doesn't block others, retry, player, delete, show data |
| `test/e2e_micpick.py` | microphone mode: choose the mic before and during recording; My footage from the room-code screen |
| `test/e2e_range.py` | Collapse gaps (with undo), In/Out on the timeline, render just the range (needs ffmpeg) |
| `test/e2e_solo.py` | theme symbol, the camera on its own, scanning a real beacon code to join (needs ffmpeg) |
| `test/e2e_safearea.py` | camera controls clear of the notch / Dynamic Island when held sideways |
| `test/e2e_contextmenu.py` | right-click editing, replace media, PiP from Source, track targets, recording on air, program meters |
| `test/e2e_audio.py` | editor sound under real browser rules: both meters, the Source monitor, recovering paused sound |
| `test/e2e_programcopy.py` | the live cut in parts, sent to each person for the time they were there (and on rejoin) |
| `test/e2e_diag.py` | recording format detection and warning, unplayable parts explained, diagnostics reports |
| `test/e2e_overflow.py` | record-only overflow, promotion, Swap in; sharing tags on every page |
| `test/e2e_mic_break.py` | microphone phone, live mixer, break slate (manual + automatic), portrait |
| `test/e2e_rtmp.py` | RTMP through the relay to a stand-in RTMP server (needs ffmpeg) |
| `test/e2e_whip.py` | Stream out over WHIP to a stand-in endpoint |
| `test/e2e_local.py` | cameras and microphones on the studio computer: tiles, recording on the studio clock, back after a reload |
| `test/e2e_switcher_room.py` | switcher room, preview box, PAUSED in Camera control, centred record button, remove / block / let back in |
| `test/e2e_kiosk.py` | /kiosk in an iframe: hands-free; the first phone names the show; a fresh show after each one |
| `test/e2e_home.py` | the home page: Camera, My media, Kiosk, Join right away (terms once); /edit without a code |
| `test/e2e_mymedia.py` | My media shows the studio's recordings on this device; Delete clears the editor |
| `test/e2e_monitordel.py` | Delete in Monitor removes a recording from this computer and the editor |
| `test/e2e_pages.py` | Live and Edit as separate pages: each its own controls, no errors pressing around |
| `test/e2e_editpage.py` | Edit in its own window beside the live studio; Program out's Live / Edit picker |
| `test/e2e_recpolicy.py` | cameras record only while Record program runs; a person's own recording comes first |
| `test/e2e_console2.py` | the audio console with two microphones on a 2x screen stays steady |
| `test/e2e_blackrec.py` | nothing records at black; the fade is in Edit (fades out, fades in) |
| `test/e2e_editbreaks.py` | live breaks as items in Edit; the Dissolve button and D; the studio's event list with no code |
| `test/e2e_eventsapart.py` | same-named events and reused codes kept apart on a phone |
| `test/e2e_autopilot.py` | Record with the fades; autopilot: starts at a camera, welcomes the next, ends when all have gone |
| `test/e2e_pvwtwoup.py` | Tap: Preview: preview and program side by side, the same size; the preview's corner camera over a screen (what CUT will give), the program's only once taken; flip-flop; Tap: Air, the program alone |
| `test/e2e_screen.py` | a shared screen (with its sound) and this computer's sound as sources |
| `test/e2e_sharequality.py` | another computer's screen (/share): 1080p at 30 frames a second on air, its sound in stereo (left stays left), a stereo mixer strip, the share page saying what it sends, Slides and text / Video and motion (a share playing sound goes to Video and motion by itself, says so and doesn't remember it; Slides and text chosen then holds), the studio holding 150 ms of its sound, its sound reaching the mixer from the start, Quality first letting it send up to 15 Mbit/s on air (8 again when it's off), no message box for it, its sending in the show log, its sound in the show log as played (its jitter, about 150 ms waiting, ms hurried, made up and arrived per reading, not counted twice for stereo), no password field in the studio |
| `test/e2e_remotescreenrec.py` | every source that aired is in Edit: another computer's screen (`/share`) recorded in the studio while on air; a phone whose clips aren't here filled from the program as aired; neither black. Edit's sound: the program's as aired under the whole edit (the shots' own at nothing); switched off, only under a shot with no sound of its own |
| `test/e2e_screenfit.py` | a 16:10 screen in a 16:9 show on Fill is shown whole (menu bar and Dock), from this computer and over `/share`; its recording is marked a screen |
| `test/e2e_vcam.py` | the program as a camera for video calls: relay → (stand-in) OBS over local UDP, H.264 + AAC |
| `test/e2e_phonerobust.py` | a phone that won't store blobs, a camera that stops in the background, a camera that never answers on join |
| `test/e2e_dissolve.py` | a live dissolve arrives in Edit as a dissolve; crossfading sound; ¼ s / Cut in the Selection panel; renders through it |
| `test/e2e_secondtake.py` | a second take after hand edits (Collapse gaps) goes on the end, after the real gap |
| `test/e2e_aired.py` | anything aired makes Edit: computer cameras, aired clips, recordings finished on entering Edit, the program recording in Media |
| `test/e2e_clipcue.py` | clips through the switcher: cued paused in preview, playing as they dissolve in or cut on |
| `test/e2e_switcher.py` | preview, AUTO dissolve, the T-bar by hand, CUT, Tap: Air; Camera control strips and messages |
| `test/e2e_growth.py` | Admin, Growth: anonymous day counts, growth vs the previous period, CSV, investor snapshot, saved snapshots |
| `test/e2e_editaudio.py` | edit sound with a camera and a microphone: camera sound ducks under the mic, plays elsewhere |
| `test/e2e_guided_setup.py` | guided setup, private selfie camera, lens at 1x, Pause feed on air, event code typing, two program takes |
| `test/e2e_rejoin.py` | Rejoin as camera / Rejoin as microphone |
| `test/e2e_podcast.py` | a podcast: microphones as live sources (tally, number keys, whoever's talking), no break slate while there's sound |
| `test/e2e_leave_rejoin.py` | leave/rejoin 3x keeps pictures and sound; Pause feed; lens choice in Camera control; transfers in the Monitor |
| `test/e2e_ccu.py` | Camera control window (scopes, remote zoom/brightness/contrast/focus); the wide zoom pad and gliding zoom |
| `test/e2e_permtip.py` | scan-to-join on the same page; the once-only "make it remember" tip per browser |
| `test/e2e_fitted_mixer.py` | fitted mixer, Live panel buttons, relay steps per computer, one-click full screen, one dark theme |
| `test/e2e_mic_alone.py` | a microphone alone, leaving to home and rejoining, the live cut for someone leaving, My events, sound sync, WHIP streaming |
| `test/e2e_audio_console.py` | left-only microphones recorded on both sides, moments/markers through Collapse gaps, the audio console |
| `test/e2e_synclock.py` | beacon timing locked in: on/off air, black, reload never ask again; a clock slip asks once (needs ffmpeg) |
| `test/e2e_showcontrol.py` | lower thirds (delete, edit), fade/cut to black, slate looks, moments, markers, rundown end/clear, picture watchdog |
| `test/e2e_outbox_globe.py` | clips waiting for a late host, reload survival, nearby events |
| `test/e2e_admin_monitor.py` | monitor tab, beacon dimmers, admin panel (dev admin key: dev-admin) |
| `test/e2e_display.py` | TV screens at `/tv`: pairing with Accept, the program, Remove, full screen, Browse, PiP, the beacon on the studio's clock |
| `test/e2e_remote.py` | the phone remote: pairing code, cut, auto director, break, black, Record program; wrong and reused codes turned away |
| `test/e2e_remotecam.py` | the first + This phone with the program's sound on, under an iPhone's audio-session rule: the microphone comes in (asked for on play-and-record, the session unchanged while it's open) and the studio hears it; its tile in the studio the picture's own shape (16:9, not squeezed square); a microphone turned down at the add: Mic off, a tap brings it in; the time of day in the remote's title bar (ticking, beside the show's name, upright and sideways); the remote's own camera: + This phone joins it as a camera, its picture comes back with THIS PHONE on it, a tap cuts to it (ON AIR on its bar); the whole frame, landscape; no program screen offered it; sideways, the full-screen mark on the picture's own corner and the camera's bar clear; the program's sound held off while its mic is live (and let go with Mic off, which lets go of the microphone too; Mic on: the studio hears it again); a second lens changes the studio's picture over, still on air; Remove on air takes a second tap, and leaving while Record program runs sends it no part of the live cut; added again, once |
| `test/e2e_remotejoin.py` | the remote saved to a home screen: its own manifest, pairing by scanning with its own camera, the next show with just the show's code, straight back into the last show, another show when that studio is closed; unknown phones still need Add a phone |
| `test/e2e_remotelandscape.py` | the phone remote held sideways (956x440, 956x380, 667x375): one screen with no page to scroll, Program out 16:9 on the left with the quick actions in one row under it, the cameras scrolling on their own beside it; taps cut and the actions work; a screen on air with a long-named camera in the corner leaves Program out and the buttons the same size; a tap on Program out fills the screen and a tap goes back (sideways and upright); Program out off puts the actions down the left; upright, as before |
| `test/e2e_showlog.py` | the show log every second, Monitor's panel, a microphone dropping out (alerts under Notifications, not on the remote; Turn on), Save show log, earlier sessions kept |
| `test/e2e_twomics.py` | one interface, two microphones: a two-sided input split (each strip hears and records only its side), Enter in Rename saves, a reload brings it back split, One microphone, removing both |
| `test/e2e_output.py` | Output settings, the program's rate on animation frames and on the worker clock, Record program's MP4 checked with ffprobe (exact rate, not fragmented, sound as long as picture) (needs ffmpeg) |
| `test/e2e_sync.py` | one timeline: stand-in cameras 120 ms apart jump on a cut; the sync check (a clap) measures them; after it a cut doesn't jump; sound waits with the pictures; cameras stay on air with no animation frames |
| `test/e2e_soundcontrol.py` | a device that stops comes back into the same source; a camera's Sound from; AFV following a chosen camera; this computer's cameras following the output or 720p (a free one at once, the one on air when it's cut away from); the phone remote's mixer |
| `test/e2e_tvremote.py` | a TV whose link dies or whose computer sleeps joins again by itself; it says what it's getting; falling behind lowers its bitrate; Program out on the phone remote (turned off, its link kept and sent nothing), with its sound (muted to start, a tap for sound) and its camera buttons left alone between changes; the TV's and the remote's sound from a player of their own, in Now Playing; a phone that pings late or loses its signalling, still connected, kept |
| `test/e2e_tvdirect.py` | a TV showing phones and screens with no studio (`/tv`): the landing page with a studio's code and the TV's own code side by side, listening with nothing clicked; its code typed as a studio's turned away; the same code after a reload; a phone's camera (`/cam`) and a shared screen (`/share`) join with it and are tiled; the phone's light on, not recording, its full picture with two on; one full screen (1 to 9) sends its full picture and the other a small one, 0 puts both back; the screen's sound plays and a camera's only with Camera sound on; the share page says it's on the TV; the phone joins as a camera only in one tap, is never asked for the beacon, keeps a clip it records, and leaves at once (no wait for a copy of the show) and comes back; tiles go as each leaves and the landing page comes back, still listening, a stopped share off its list and nobody listed as joining; Clear takes everyone off and they stay off |
| `test/e2e_remotepgm.py` | Program out on the phone remote from pairing, with no camera in the show or on the phone: shown at once; on a phone that won't play a video until it's touched, Tap to show the program, the show log saying so, and the first tap anywhere starting it (not full screen) |
| `test/e2e_campgm.py` | cameras watching the program: a small silent box beside the record button off air, nothing sent on air; tap to watch full screen (half size), the live picture paused and WATCHING in the studio; messages over it; clicking the camera in the studio calls them back instead of cutting; Back to camera; tucking the box away (remembered); up to 4 cameras, lowest numbers first (1, 0, back to 4); a camera that leaves loses it and the next moves up |
| `test/e2e_cambg.py` | a computer's camera page in a background tab (its frame callbacks stopped, as Chrome does): the studio still gets its picture (the camera's own, the studio told it's the whole frame), and the upright square comes back with the tab |
| `test/e2e_serverblip.py` | a server connection drops (AWS's two-hour cut): the studio's drop keeps both cameras, a camera's program box and a TV on the same links; a phone's own drop keeps its camera in the studio; an offer lost on the way is asked again after 10 s; a phone that leaves still goes at once |
| `test/e2e_hostsilent.py` | the studio's server connection dies quietly (the server has no studio; the studio still thinks it's connected): a phone joining meanwhile waits at "Host not here yet" until the studio's 30-second check finds no answer and connects again by itself, and the phone joins with nothing touched |
| `test/e2e_livenumbers.py` | Live numbers: in a show whose devices had numbers up to 9, phones are 1, 2, 3; one that leaves frees its number for the next; the keys follow; a studio reload keeps them. A TV asking to show the program is under Notifications (the bell, red) with Accept, and Accept there lets it in |
| `test/e2e_offline.py` | a show with no server (own dev server on 8796, taken offline and back): cut and tally, the phone remote's buttons and program, a camera's program box, the TV's standby, a stuck camera reconnected over its own link, a clip coming over, still connected after 15 s, the studio's OFFLINE badge and leave warning; back online a new phone joins; a studio opened with no API opens the event it last saw |
| `test/e2e_qrjoin.py` | joining with no internet (own dev server on 8797, pages too taken offline): a phone that opened VUEMesh before opens the show from its kept copy and shows its QR code; the studio's Join by QR answers; both QR images read back; the phone gets the show over the new link, joins and goes on air; a camera whose link went gets Reconnect by QR and comes back; the internet back, both stay |
| `test/e2e_localshow.py` | a show on the studio computer's own Wi-Fi (vuemesh-local.mjs on test ports, dev certificate, hotspot as a dry run): the studio finds the helper, gives it the show, joins it and starts the hotspot; the Wi-Fi's and the show's codes read back; phones open the show's address and join through the helper, one with the cloud gone; the welcome page and, after Done, the answers phones expect; its address answers; other sites refused |
| `test/e2e_pip.py` | another computer shares its screen from /share; a camera stays live in the corner over a screen (tally, sound, the remote), P turns it off and on; the inspector's cards fold and are remembered |
| `test/e2e_srcwidth.py` | the sources panel's width: its divider widens it on a laptop (1366 x 768 and others), the camera pictures grow with it, the program is fitted again and keeps 40% of the window, nothing sideways; kept after a reload; double-click puts it back; arrow keys; by touch (a finger-wide hold); dragged to the edge it slides shut, ◧ opens it as it was |
