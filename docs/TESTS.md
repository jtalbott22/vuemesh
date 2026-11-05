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

`npm test` runs all seven, and GitHub Actions runs them on every push and pull request.

| File | Covers |
| --- | --- |
| `test/core.test.mjs` | cloud core: events, discovery, signaling, admin, expiry, switches, growth |
| `test/sequence.test.mjs` | edit operations (ripple, roll, slip, slide, slicing) and the AI director |
| `test/quality.test.mjs` | live picture quality hints |
| `test/imports.test.mjs` | every import across the front end is exported by its module |
| `test/framesync.test.mjs` | one timeline: a camera's quickest delivery, the picture delay (up at once, down between shows), each camera's frame of a moment, a stalled camera held, the clap in sound and picture |
| `test/tvquality.test.mjs` | a TV falling behind: its bitrate down (at most every 10 s, not below the floor), and back up when steady |
| `test/showlog.test.mjs` | the show log: sound alerts (stopped, silent, unplugged), the summary, chunks put back together |

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
| `test/e2e_media.py` | media manager: moments, tags, stars, Source monitor, subclips, insert/overwrite, export, trim, delete |
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
| `test/e2e_screen.py` | a shared screen (with its sound) and this computer's sound as sources |
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
| `test/e2e_remotejoin.py` | the remote saved to a home screen: its own manifest, pairing by scanning with its own camera, the next show with just the show's code, straight back into the last show, another show when that studio is closed; unknown phones still need Add a phone |
| `test/e2e_showlog.py` | the show log every second, Monitor's panel, a microphone dropping out (alerts here and on the remote, Turn on), Save show log, earlier sessions kept |
| `test/e2e_twomics.py` | one interface, two microphones: a two-sided input split (each strip hears and records only its side), Enter in Rename saves, a reload brings it back split, One microphone, removing both |
| `test/e2e_output.py` | Output settings, the program's rate on animation frames and on the worker clock, Record program's MP4 checked with ffprobe (exact rate, not fragmented, sound as long as picture) (needs ffmpeg) |
| `test/e2e_sync.py` | one timeline: stand-in cameras 120 ms apart jump on a cut; the sync check (a clap) measures them; after it a cut doesn't jump; sound waits with the pictures; cameras stay on air with no animation frames |
| `test/e2e_soundcontrol.py` | a device that stops comes back into the same source; a camera's Sound from; AFV following a chosen camera; this computer's cameras at 720p; the phone remote's mixer |
| `test/e2e_tvremote.py` | a TV whose link dies or whose computer sleeps joins again by itself; it says what it's getting; falling behind lowers its bitrate; Program out on the phone remote |
| `test/e2e_pip.py` | another computer shares its screen from /share; a camera stays live in the corner over a screen (tally, sound, the remote), P turns it off and on; the inspector's cards fold and are remembered |
