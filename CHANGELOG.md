# Changelog

## 0.61.9 — another computer's screen reaches the studio on the real site
**Deploy:** `./aws/deploy.sh` (site only).

- **Another computer's screen (`/share`) joins the studio on vuemesh.com.** The share page never loaded the site's settings (where the studio's signalling is), so it looked for the studio at the site's own address, which only the dev server answers. On the real site it sat on "Finding the studio…" or "Waiting for the studio to open…" with the studio open, and never showed up under Sources. It worked on the dev server, where it was tested. (Tried against a new show on vuemesh.com with the page as it is now: it joined, linked on this network, and was a source in the studio in seconds.)
- **A test catches a page that talks to the cloud without those settings** (`npm test`), so this can't come back on another page.

## 0.61.8 — microphones added as stereo or mono; a Windows show: a screen in the sync check, and Record program while hidden
**Deploy:** `./aws/deploy.sh` (site only).

- **Add a microphone as stereo, two mono tracks, or mono:** in + This computer, each microphone has **As**:
  - **Stereo (one track)**: both sides from the start, for a stereo mic, a pair on Input 1 and 2, or a mixer's stereo out. Its Mono switch folds it to the middle later.
  - **Two mono tracks (Input 1, Input 2)**: each input its own track, to pan or mute. It's the split from 0.61.7, chosen up front; right-click still joins it back.
  - **Mono (one track)**: both sides folded to the middle. A single mic on Input 1 comes in 6 dB lower, so raise its fader.

  The choice is remembered for that device and kept after a reload (a Mono switch changed since stays as it was). A device that opens with one side is mono whatever was chosen, and says so. Stereo and Mono take both sides as they are: before, a stereo input started with its left side copied to the right until the right had sound of its own.

From a show log (a 14-thread Windows PC, three USB webcams, a shared screen, a Focusrite Scarlett 2i2 4th Gen plugged in mid-show, the studio hidden for a minute of Record program):

- **A shared screen sits out the sync check.** Nothing in the room happens on a screen, but the check looked for the clap there too. It found the studio's own "Clap now" banner on the shared screen, called the screen 347 ms late, and every camera and the Scarlett's sound then waited 300 ms for it (they had been at 116). A screen is always one frame now, and an old measurement for one is ignored. The cameras didn't see that clap, so their figures are unchanged.
- **The picture delay holds still during the sync check.** Comparing every frame with the one before makes the cameras look late, so the delay went from 116 to 214 ms before the check had finished. It's set from what the check measured, once the check is done.
- **Record program is never longer than the show.** With the studio hidden, the sound engine's clock reading kept saying it had stopped. Each time, the recording filled the gap with silence: 31 s of it in 80 s. Twice, the picture also gained about 710 frames (24 s) in one second. The file came out at 125 s. Now neither the picture nor the sound goes past the recording's own time: a gap is filled only up to it, and sound past it is left out. The show log counts both (`clamped` and `overMs`). Where the 710 frames came from isn't known yet: the next log will say whether this guard caught them.
- **A camera that won't start at its size opens smaller, rather than not at all:** two Logitech C930e webcams on the same USB controller as the Scarlett failed with "Timeout starting video source" (Windows, after 10 s) at 1080p and 720p, with nothing else using them, but opened at 360p. A camera now tries 1080p, then 720p, then 360p, and says which size it got and why: its USB port is out of room, and another port, ideally one on the computer itself, may give it more. That takes about 20 s, and the same happens when a camera is brought back after a reload or a dropout.
- **The studio at every width.** Below 1100 px the layout broke. Each panel was still pinned to its column number from the three-column layout, so the browser made up columns: the inspector took 40% of a 1024-px screen, its cards were squashed to empty outlines with their chevrons pressed against the bottom edge, and the sources were cut off.
  - **Laptops (up to 1439 px):** sources, program and inspector side by side. Each side keeps the width you dragged it to, up to its share of the window (the program keeps at least half). The top bar is one row: tighter, without the key hints, the show's code and the Beta pill.
  - **Tablets (up to 900 px):** sources beside the program, the inspector underneath with its cards side by side.
  - **Phones (up to 640 px):** one column, program first, and the page scrolls.
  - **The cards' chevrons** sit centred on the title and its line, down when closed and up when open.
- **Every source in view, without scrolling, where it can be.** With 3 cameras and 5 microphones on a 1024 x 768 screen, the sources were one column of big tiles, 1,216 px tall in a 306-px panel. The panel now picks the number of columns that fits them all, as large as possible:
  - The break, black and the cameras come first. The microphones follow on rows of their own, after the cameras, as their numbers are.
  - The microphones are tiles (their waveform) when that costs the pictures nothing, and strips (number, name, level) when it makes the pictures bigger.
  - A small tile keeps its number, its name and what's urgent, and drops where it comes from (THIS PC, LAN) first.
  - A microphone shows the part of its name that tells it apart: "Input 1 · Scarlett 2i2 4th Gen", not "Microphone (…)". Two the same are numbered, and a strip's name takes two lines rather than being cut.
  - Measured: at 1920 x 1080 and 1440 x 900 all ten fit. At 1280 x 800 and 1024 x 768, with the mixer showing six strips, about 170 px still scroll.
- **The mixer's strips, readable and one size:**
  - Every strip lying flat is three rows: its name with Mono and AFV / ON / OFF; its meter, across the strip's whole width (it was squeezed in beside the fader); then its fader, level, balance and routing.
  - A camera's Sound menu is in that last row, and a strip with nothing to route leaves the space, so every strip is the same height (a camera's had been taller than a microphone's).
  - The mixer's buttons and menus are dark, as the mixer is: Audio console was a light grey pill and a camera's Sound menu a white box, both under light text, because they took the page's light-theme colours.
- **The row under the program stays one row on a 1024-px laptop:** after the short labels, it closes up (less space between, the clock without its AM / PM, slimmer panel buttons) before it wraps. The two panel buttons had wrapped onto a row of their own.
- **The mixer takes at most a third of a window under 1000 px tall** (it took 40% with six strips); past that its strips scroll. On a short screen, the empty Clips box is just its title and + Add (its explanation is on the button).
- **+ This computer shows each device before it's added:** each camera's live picture, and each microphone's sound as it comes, each side on its own (L above, R below), so a stereo input shows which input has what.
  - A device in the show shows its own picture or sound, outlined in green.
  - One that isn't is opened small (320 x 180) just for the list, and let go before it's added and when the list closes.
  - On Linux, a second input of an interface that's already open isn't opened for its preview: Chrome there would silence one of them.
- **Adding a device, while it opens:** Add becomes a small spinner and "Opening" in the same space (its column is one width whatever it says), and the preview says Opening… where the picture was. A long Sound menu shrinks instead of running under the button.
- **Name any source, anywhere, with a picker:** from a tile's right-click menu (phones and microphones too, not only this computer's), a mixer strip's name (double-click), or the pen beside a device in + This computer. That last one also names a device before it's added.
  - The picker has **Who** (Host, Guest, Teacher, Pastor…) and **Shot** (Wide, Close-up, Left…) or, for a microphone, **Microphone** (Lav, Handheld, Podium…). Each sets its part of the name, e.g. "Teacher · Wide".
  - Or type any name. The names used before are a click away, and **Use its own name** goes back to the device's.
  - This computer's sources keep their names with them, also after a reload, and by the device itself: one removed and added again (or that dropped out) comes back with the name it was given. The list shows it by that name, with its own beside it.
  - A phone's name is kept for that phone on this computer, and it has it whenever it joins.
- **+ This computer, redesigned:** a sheet with a header, a scrolling list and Done at the foot. Each camera, microphone and share is a row with an icon, its name, its options (Sound, or As) and Add; what's already in the show says so in green. Two of the same webcam are told apart as the show names them (Logitech Webcam C930e, … 2), without Windows' "2-" prefixes. On a phone it fills the screen, with Add under the name.
- **Monitor, reorganized, at every width.** Its phones table had 16 columns and scrolled sideways even at 1920 px; the saved show logs were squeezed into a 64-px column (a date a word a line); the show log's summary was one long list.
  - A row of links at the top (it stays): Sources, Show log, Transfers, Recordings, Event log, Saved show logs, with counts (amber where something needs attention).
  - **Sources** are cards, cameras then microphones: each one's link, its live picture, and only the figures it has (this computer's have no round trip or battery). One that needs attention is outlined amber, with what's wrong; one on air, red.
  - **Show log:** its two graphs side by side; each line of the summary with its moments folded under it (open to see them, and they stay open as it updates).
  - **Transfers:** coming in and going out side by side. **Recordings** received and parts sent, in one place.
  - On a wide screen the event log and the saved show logs stay beside the rest as it scrolls; narrower, they're under it, side by side; on a phone, everything in one column.
- **A shared screen that stops sharing leaves at once,** and says how to share again. It was tried again for 30 s, as a camera that dropped out is, but only the browser's picker can share a screen again.
- **The home page's buttons in light mode on Auto:** a device in light mode with the theme left on Auto showed the Camera, My media, Kiosk and Join a show buttons dark grey on the light page. Their colours were set for Light chosen by hand, not for Auto.
- **The show log says how this computer's microphones opened:** how many sides (`ch`) and each side's level for a stereo input (`dbL` and `dbR`: an interface's Input 1 and Input 2). Its join line also says "in stereo" or "mono". The last log couldn't tell what the Scarlett gave Windows.

From a load test on the same PC (three 1080p webcams, four microphones, a shared screen with its sound and the computer's sound, then Record program): each of those alone was fine, but all together the program drew a new picture only about every 110 ms (12–17 of every 30 frames were the one before again), and Record program kept about 1 frame in 7. The page itself was mostly idle: the browser's graphics couldn't keep up with four 1080p pictures at 30.

- **This computer's cameras are never bigger than the output.** The live picture is drawn at the output's size (720p unless changed), so a 1080p webcam in a 720p show was shrunk on every frame, for nothing on air: three of them in a 720p show made Record program skip about half its frames, where three 720p webcams skipped none. The camera setting is **As the output** (the default) or **720p** (lighter on USB); a 1080p chosen before now follows the output.
- **A camera changes size by being opened again, in either direction, and never while it's in use.** A camera's size can't be changed as it runs: with its frame buffer's copy open too, Windows keeps it at the size it was opened at. Asked for less, the browser only scaled one copy, so the camera, its USB port and the program stayed at the old size ("720p (lighter on USB)" didn't lighten it); asked for more, 720p webcams stayed 720p in a show changed to 1080p. Now a camera at another size than it should be is opened again at that size (a moment without a picture on its tile), but not while it's on the program, in a dissolve or picture-in-picture, in preview, or recording: then as soon as it's free. What was set in Camera control is put back on it. One that can't be that size (it tried, or its USB port had no room) is left as it is, and a change made during one is picked up straight after.
- **A shared screen is the output's size:** 1280 x 720 at 30 in a 720p show, 1920 x 1080 at 15 in a 1080p show. A screen is the heaviest picture there is for a laptop's graphics (Windows copies the desktop for it, and the browser converts it). In a 1080p show beside three 1080p webcams, at 30 the graphics were 75–90% busy and Record program skipped up to half its frames; at 15, about 60% and none. Its own recording stays at 15.
- **A camera added while its preview was still opening came in at 320 x 180, 15 frames a second.** The add list opens each camera small to show it, and Windows gave the camera's own opening that size too. Adding one now waits for its preview to open and let go. A camera that still comes in smaller than it can do is asked once more for its size. (In the test it was one camera in two of every three runs: the cameras' "25 frames a second" in the earlier figures was that camera at 15.)
- **This computer's camera recordings are encoded on the graphics card when it can:** VP9 (WebM), else H.264 (MP4, as Android phones record it), else VP8 on the processor as before. A picture smaller than 640 x 480 stays VP8 (the browser encodes only bigger ones on the card). Which formats the card encodes is asked once, and each recording's note in the event log says which it's in. On the test PC's Intel graphics, a 1080p webcam's recording took 29% of a core as VP8 and nothing measurable as VP9, H.264 or H.265; in the show, the studio's page went from 167–170% of a core to 80–86%, and Record program skipped no more than with VP8. Edit read back every frame of a test recording in each format, with its sound.
- **Record program keeps a steady frame rate.** A frame the studio was too late to draw is written again while the encoder has room for the copies. Only without room is it one frame held for as long (copies in a burst had filled the queue, and the next new picture was skipped); the show log counts those (`held`), and they're the only ones that leave the frame rate uneven. The show log also says how long the encoder took a frame (`enc`: mean and longest, ms) and how many it gave back (`out`), so a slow encoder and a late studio can be told apart.
- **The program's picture is captured only for what takes it:** Program out, streaming, a TV, the live cut once someone is there for it, or the browser's own recorder where the steady one can't run. Record program draws from the program itself, but took a copy it never used, and a copy nobody used still cost a full-size copy and conversion 30 times a second. A Go live that fails lets its copy go.
- **The studio's page does less on every frame.** The meters read the sound every frame (each shows the loudest since it was last drawn) but are drawn at most 30 times a second and only where they changed, from elements found once instead of by searching the page for each. The program's label is worked out once and written only when it changes, the clock once a second, and the preview box draws the camera's frame already made for the program instead of converting the camera's full-size picture again.
- **The microphones are lined up off the page.** Every 10 s the studio works out how far each microphone's sound is from the main one: three FFTs of 262,144 points for each microphone, about 220 ms of the page's time in a row. The program's drawing waited each time (7 frames late, a stutter on air and in Record program, every 10 s). It runs in a worker now (`audiosync-worker.js`), with the same results to the last digit; the page only hands over the sound. Long tasks during a show went from 6 a minute to none.
- **A camera or microphone that leaves the show is let go.** The copies of its picture and sound kept for the program's timing were never stopped, so the device could stay open after it left. And a camera whose Sound from changes is lined up by its new microphone: the old one stayed open and measured.
- **The 1080p warning counts a shared screen** ("3 cameras and a shared screen at 1080p is a lot for one computer: … try a 720p output, or 720p here") and clears when a source is removed.

The same show on the same PC afterwards, against the code before these changes, 60 s each: three webcams held at a full 30 frames a second (their exposure fixed: in a dim room they slow down on their own, to 8–20, which makes any test look better than it is), a shared screen, four microphones, the computer's sound, a camera on air with its own recording, and Record program.

- **1080p:** Record program skipped none of 1,800 frames in five runs out of five, where it had skipped 63–72% (seven runs); the encoder's queue never held more than one frame. The studio's page took 67–76% of a core instead of 163–202%, the program never stalled (6 stalls a minute before), and Chrome's share of the graphics card fell from 66–70% to about 50%. (Earlier versions of these changes still skipped 0–46% at 1080p; the last round, with copies of a late frame only into the encoder's free half, brought it to none.)
- **720p:** none of 1,800 skipped, every time (three runs, and five more with the cameras slower).

With three webcams and a screen at 1080p, this laptop's built-in Intel graphics are still the busiest part (about two-thirds of the 3D engine with everything else on the computer): a slower computer, or more sources, may still need the 720p output. The warning by the camera setting says so.

From a test with a phone in the show (an iPhone stand-in: Chrome with an iPhone's identity, screen and touch, on fake camera and microphone, joining over the local network) beside the same three webcams, screen, microphones and Record program:

- **The live cut for the crew no longer copies the full-size program off the graphics card.** As soon as a phone joins a recorded show, the studio makes the live cut it sends them: the program again, at 2.5 Mbit/s, in parts. It was the browser's own recorder on a copy of the program, and each frame of that copy was read back off the graphics card, at 1080p more than half of the graphics' own thread (Record program then skipped a quarter to two fifths of its frames, with one phone). Now each part is the program made smaller (720p at most, which looks better than 1080p at that rate) and encoded on the processor, which has room; on the graphics card's encoder it competed with Record program's. Each part is a normal MP4 that iPhones play, and the event log says how it's made. Parts are numbered in the order recorded as they're saved, so they're 1, 2, 3… with none missing, whatever happened to one. Someone leaving gets the part being recorded at once. Each part is kept as its bytes: kept as the recording's file, IndexedDB holds only a reference to it, and this browser's storage tidy removes those files after a day. A part whose encoder fails is kept as far as it got and the live cut carries on (after three failures in a show, with the browser's own recorder); where the browser can't encode it itself, the browser's recorder, as before.
- **720p is the size for most shows.** The output's sizes now say so: **720p (smooth on most computers)** and **1080p (a powerful computer)**, and the hint by them: 1080p is about twice the work, for one or two cameras or a computer with its own graphics card. With three webcams, a screen and a phone, the test laptop recorded 720p with nothing skipped, and couldn't keep up at 1080p.
- **A 1080p recording that skips frames says so on screen,** once: "Record program is skipping frames: this computer can't keep up at 1080p. After this recording, set Output to 720p." (The size can't change while it records.)
- **That's a wrap** says only that the film is saved (or published): nothing about credits or sending it.
- **What's new, on the site** (`/changelog`, linked at the foot of the home page): this changelog, newest first, the latest three versions open and the rest folded, each with its own link (`/changelog#v0-61-8`). It's the file itself, copied next to the pages when the site is deployed, so it's never out of date.
- **Record program's file still opens the next day.** The show's master, and Edit's "Program (as aired)", are kept in this browser as a reference to the recording's file, and this browser's storage tidy removed every recording file a day old: from the next day, both couldn't be opened. The tidy now leaves a file that anything kept here still uses, and removes only the ones nothing does (a show deleted, a kiosk's finished show); if what's kept can't be read, it removes nothing. It looks at what's kept only when a file is old enough to go. Deleting "Program (as aired)" (in Edit, or in My media on the camera page) deletes the show's master too, so its file is freed: kept twice, it would otherwise have stayed for good.

With the phone in the show, on air, sending its own clip, and leaving at the end (its parts went with it within seconds), at 720p: Record program skipped none of 11,700 frames (three runs), and the live cut's parts kept every frame. At 1080p on the same laptop it skipped about half. (With parts every 20 s instead of every 5 minutes, a new part can cost Record program a moment; every 5 minutes, that's about 0.1%.)

From a show log (the same laptop, a 1080p show, three webcams, a Focusrite Scarlett 2i2 4th Gen), and testing another computer's screen against a studio on the dev server:

- **A USB interface beside 1080p cameras on the same computer is told why it stopped, and what to do.** The Scarlett went to exact silence three times, a minute apart, and each time Windows let go of it 13 s later (the studio opened it again in a second). Tried on the same laptop without the studio: the Scarlett alone, fine; three seconds after three webcams started at 1080p and 30 a second, silence, and 14 s later the device let go; with the same three at 720p, fine for the whole test. The webcams took the USB from it. Now, while two or more of this computer's cameras run at 1080p, the alerts for its microphones say so: "This computer's cameras are taking its USB at 1080p: plug it into another USB port (one on the computer itself, away from the cameras), or set Output to 720p."
- **Another computer's screen, into a studio running on a computer's own dev server** (for testing a local build; a different problem from sharing into the real site). The studio's link said `localhost`, which the other computer can't open, and over this computer's plain http address a browser can't share a screen at all (nor sign in to the show): the share page said "This browser can't share its screen (phones and tablets mostly can't)". The dev server now also serves https on its port + 1000, with a self-signed certificate it makes with openssl (Git for Windows' too) the first time, and prints the addresses for other devices. The studio's link for another computer is that https address when the studio runs on localhost. The share page and the camera page opened over plain http say they need a secure address (https://) instead of failing. On the real site nothing changes: its links were already https. (Tried with a second browser as the other computer: it opened the link, accepted the certificate, and its screen was in the studio in seconds.)
- **The share page's sound tip on Linux** says to share a Chrome tab with its sound, as on a Mac: Linux shares a tab's sound, not the whole computer's.

## 0.61.7 — one interface, two microphones
**Deploy:** `./aws/deploy.sh` (site only).

0.61.6 found that Chrome on Linux reads only one of an interface's inputs at a time (a Scarlett 2i2's Input 1 and Input 2, which Linux lists as two microphones). This is how to hear both.

- **Two microphones from one input:** add the interface once, in stereo, then right-click its tile: **Two microphones (Input 1 left, Input 2 right)**. Each side is a microphone of its own: its own tile, strip, mode (AFV / ON / OFF), fader, and recording of just its side. **One microphone (both sides)** puts it back. On Linux, set the interface to **Pro Audio** in the computer's sound settings first (its inputs then come as one, "Scarlett 2i2 4th Gen Pro"). A Mac shows a Scarlett that way already. Tried with the real Scarlett on Pro Audio: both inputs heard every second for 20 s, where on HiFi the first went silent.
- Adding a microphone that opens in stereo says how. So does the notice when two inputs of one interface are added.
- A split input comes back split after a reload, with each side's name. Removing the first side takes the second with it (the same device). The sound watch listens to the whole input, so an input with nothing plugged in doesn't keep "reconnecting".
- **Enter saves in Rename** (it pressed Cancel: the dialog's first button).
- A recording of this computer's sources is named as it was when it started (a rename or a split before it was saved gave it the new name).

## 0.61.6 — an audio interface on Linux
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (the same Linux laptop, a Focusrite Scarlett 2i2 4th Gen plugged in mid-show): the Scarlett's sound cut in and out and its waveform wouldn't draw. Every 10 s the studio said its sound "had stopped reaching the mixer: reconnected it", and each reconnect brought about a second of sound back.

Reproduced on that laptop with the real Scarlett: **Chrome on Linux reads only one of an interface's inputs at a time.** Linux lists the Scarlett's Input 1 and Input 2 as two microphones. Open both in Chrome, and the first gets no sound at all: PipeWire holds 10 s of it for Chrome, then throws it away. The same input twice is fine, and so is the Scarlett with the built-in mic. Outside Chrome, both inputs record together. In the show, it wasn't only Input 1 and Input 2: plugging the Scarlett in made it the computer's default microphone, and the webcam took its sound from "Default".

- **A camera's sound is a microphone by name, never "Default":** the device it groups with, one whose name matches, the device "Default" is right now where the browser says (a Mac, Windows), then the built-in one. "Default" follows whatever was plugged in last, so it was the webcam's sound one moment and the Scarlett the next. A camera saved with "Default" as its sound picks one by name the next time it's opened.
- **Two inputs of one interface, said so:** in Chrome on Linux, adding the second (as a microphone, or as a camera's sound) says that only one will be heard, and how to have both: the interface on Pro Audio in the computer's sound settings, added once (Input 1 on the left, Input 2 on the right). Also in the show log.

## 0.61.5 — recording on a laptop, lighter
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (an 8-thread i7 Linux laptop, its built-in webcam and a shared screen, no phones): during Record program the program repeated about 10 frames a second (the picture stuttered on the program monitor) and the recording skipped 779 of 2,496 frames ("H.264 High on the processor"). 0.61.2's picture delay held (208 ms, not 380), but the computer was still out of processor: four video encoders at once.

- **The live cut only runs for someone:** it's a second recording of the whole program, cut into parts for the people on their own phones and computers. With nobody but this computer's cameras and screens, it was encoding for no one. Now it starts when Record program does if someone's there, or when the first person joins, and stops at the end of a part when everyone has gone.
- **This computer's cameras and screens record in VP8** (it was VP9). Measured here with a noisy 720p webcam: VP9 took almost a whole core more. Edit, export and renders take either.
- Together, on this laptop, recording with a webcam took 2.0 cores instead of 3.6.

## 0.61.4 — the phone remote in Monitor, as a TV is
**Deploy:** `./aws/deploy.sh` (site only).

- **The remote's Program out says what it's getting, as a TV does:** frames shown, dropped and frozen, packets lost, and the size it shows. It said only frames shown before (freezes and drops were always 0), so Monitor had little to go on, and the studio never lowered a remote's picture that was falling behind; now it does, as for a TV.
- **Each phone remote's own link is in Monitor's Transfers:** open on its screen (with the cameras' pictures) or in the background, when it joined, when it was last heard from if a while ago, and how much the studio is sending it.
- TVs and the remote also say how many packets they lost.

## 0.61.3 — a shared screen that's sharp, light, and stays on air
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (an 8-core iMac, 2560x1440 at 2x, sharing its screen): the screen on air kept going to the break slate, the studio lagged while it was shared, the screen looked pixelated in Program, and Record program's first seconds were frozen.

- **A still screen isn't a dropped camera:** a screen shared on this computer sends a picture only when something on it changes, so a slide held for 1.5 s looked like a camera that had stopped, and the break slate went up (the log had 66 s of "stopped sending" from a screen that was fine). While it's still being shared, it's on air; it's no longer logged as stopped either. Off air by mistake, it also wasn't recorded for Edit (its clip was 0 MB).
- **Captured at most 1080p:** the browser captured the screen at its full size (5120x2880 on that iMac), and every frame was copied and shrunk 4x on the page, which was slow and made text jagged, and recorded on air at that size. Now the browser shrinks it as it captures (smoothly), marked as detail so text stays sharp, and what's left is shrunk smoothly too.
- **Record program starts its encoder first:** starting the graphics card's encoder took 4.5 s, and every frame meanwhile was skipped (141). One throwaway frame goes through it before the recording's clock starts (at most 8 s), and the program's clip in Edit starts at the recording's real first frame.

## 0.61.2 — a busy computer
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (a Linux laptop, its built-in webcam and a shared screen): during Record program, 1,142 of 3,431 frames were skipped, the pictures' delay crept from 108 to 380 ms, and the program froze for 1.8 s once.

- **The program's encoder keeps up first:** it asks for the graphics card's encoder and real-time mode (a software encoder's quicker settings), and falls back to how it was. Falling behind, it skips a frame here and there (a queue of 6) instead of letting 3 s of frames pile up and then dropping them in a run. The recording's note says which encoder it got, and the show log says when frames are skipped, with what else this computer is recording.
- **A shared screen records at most 1080p and 15 frames a second** (from its own copy of the picture; the live picture is untouched), at 3 Mbps. Encoding a full-size screen at 30 on the processor, beside the program, was the heaviest load.
- **The picture delay doesn't creep:** it goes up only when a camera has needed more for 3 s in a row, and never past 300 ms. A computer too busy to take its frames on time makes every camera look late at once; raising the delay each time only added delay and memory.
- **No freezes from "are you sure?":** removing a phone remote or a TV and clearing the rundown ask on the button (press again: Sure? Remove), and renaming a source opens a small dialog of the page's own. The browser's own confirm and prompt stop the whole page, program included, while they're open: that was the 1.8 s.
- The show log says when a camera runs at about half its rate: most webcams do that in dim light.

## 0.61.1 — the phone remote from a home screen
**Deploy:** `./aws/deploy.sh` (site only; it now uploads `remote.webmanifest` too).

Saved to a phone's home screen, the remote didn't join easily: it opened the camera page's start (the site's one manifest), a home-screen app on an iPhone keeps its own storage (so a pairing done in Safari wasn't there), the camera app's scan of the studio's code opens Safari rather than the app, and each new show needed a new pairing.

- **Its own home-screen app:** `remote.webmanifest` starts it at `/remote`, standalone, named Remote.
- **Scan from the page:** Scan the studio's code uses the phone's camera inside the remote itself, then pairs.
- **The show's code is enough after the first time:** a studio computer remembers the phones it paired for every show it runs (it kept them per show before). A paired phone types only the new show's code and is let in by its own key. The show's code alone still lets no other phone in: a phone the studio never paired is told to add it once.
- **Back into the last show** when opened from the home screen. If that studio isn't open, after 8 s it asks for another show's code (still listening, in case it's just opening). **Another show…** under the controls does the same.
- Typing or pasting both codes together ("ABC123 ABCD-EFGH", or the studio's link) puts each where it belongs; eight characters in the code box connects.

## 0.61.0 — picture-in-picture, screens from other computers, a tidier inspector
**Deploy:** `./aws/deploy.sh` (site only).

Stage 5 of the plan from the class recording: the instructor's slides on air lost the instructor, a second computer's screen could only come in by sharing it on the studio computer itself, and the inspector was one long column.

- **Picture-in-picture, live:** with a screen on air (shared here, or from another computer), the camera that was on air just before it stays in a corner, live and in time with the screen (its frames come through the same picture delay as every camera). Its sound stays up (AFV hears it as on air), its tally is on (the tile and the phone), and this computer's camera keeps recording. It fades in and out, goes with its picture through a dissolve, and leaves when that camera is the shot itself. Choose the camera, the corner, its size, and whether it goes over screens only or every shot (the Picture-in-picture card). **P**, or the bar's Picture-in-picture button, turns it off and on; so does the phone remote.
- **Another computer's screen** (`/share?e=CODE`, the link is under + This computer > Screen and sound): open it on the presenter's laptop, name it, share a screen, window or tab, with its sound if the browser shares it. It joins like a phone, sends only the live picture, keeps its resolution over its frame rate (slides stay sharp), keeps that computer awake, and says when it's up next or on air. Share something else, or stop, from the page.
- **The inspector is cards**, as in the avatar's Setup: each a title and a line saying what it's for, opened or closed with a click, remembered on this computer (Close all / Open all at the top). Output's long section is now Output, Picture-in-picture, Recording, Autopilot and Sync; Live pictures moved to Network.

## 0.60.0 — the TV and the remote
**Deploy:** `./aws/deploy.sh` (site only).

Stage 4 of the plan from the class recording: the MacBook used as the TV couldn't rejoin after its lid was closed until the studio was brought forward, its picture dropped frames with nothing to show why, and the remote had no picture of what was on air.

- **A TV joins again by itself:** every 3 s, a TV with a studio there but no picture link (and nothing tried for 12 s) says hello again, and the studio, knowing its key, has it straight back to the picture. A gap in its clock means its computer slept (a closed lid): it starts its link again at once. And it checks as soon as its page shows again or the network comes back. Before, a TV whose own connection came back with the same studio never said hello again. (The studio's side, kept on time while hidden, was 0.58.)
- **It keeps its screen awake** while showing the program or the beacon (a closed lid still sleeps the computer: rejoining is the part above).
- **A TV says what it's getting:** every 5 s, the frames it showed (counted as they reach its screen), dropped and froze, and the size. In the show log, its summary, and Monitor's Transfers.
- **A TV falling behind gets a lower bitrate:** fewer than 80% of the frames sent it, a freeze, or more than 3% dropped, and its picture's bitrate comes down 30% (at most every 10 s, not below 0.6 Mbps); steady 30 s, back up a quarter at a time. A softer picture that keeps moving instead of a sharp one that stops. Its frame rate follows Output settings.
- **Program out on the phone remote:** what's on air, above the cameras, on the remote's own link (the studio lets it in when the phone is paired: no Accept), half size and no sound (it can't echo into the room), not listed among the TVs. A button turns it off, to save battery and data.

## 0.59.0 — sound you control
**Deploy:** `./aws/deploy.sh` (site only).

Stage 3 of the plan from the class recording: the Focusrite dropped out and was gone for good, some cameras' sound wasn't their own, and with the other microphones muted nothing could bring them up from the phone remote.

- **A device that stops comes back:** a microphone, camera or camera's microphone on this computer that stops (a USB interface dropping out, a driver hiccup) is opened again, into the same source, at once and then for 30 s (sooner when Windows says a device was plugged in). Its mixer channel, sound mode, recording and sync carry on. Before, the source was taken as unplugged and removed, with its settings; a camera's own microphone stopping went unnoticed. Only a device that doesn't come back goes. The sound alerts say what's happening meanwhile.
- **Sound from** (each camera from this computer, in the mixer): any microphone here, or none, applied at once, kept for that camera on this computer and used whenever it's added again. A camera used to take whichever microphone matched it (the same USB device, a name, or the computer's default), with no way to change it once it was in.
- **AFV that follows a chosen camera** (any channel set to AFV): heard while that camera is on air instead of its own picture. A room microphone with the wide shot, say.
- **The phone remote's mixer:** every live channel with how loud it is now, AFV / ON / OFF and a fader, and the program's level.
- **Device checks:** a microphone at another sample rate from the studio's sound is pointed out once (set both its own app and Windows to the studio's rate: a usual cause of crackling); **this computer's cameras capture at** 1080p or 720p (Output), applied at once (three webcams at 1080p can be more than USB takes, and sound on the same ports suffers first); the show log's summary names a camera that delivered fewer frames than it should.

## 0.58.0 — a steady program, and a recording Windows can scrub
**Deploy:** `./aws/deploy.sh` (site only).

Stage 2 of the plan from the class recording (one Windows computer, three USB cameras, PowerPoint in front of the studio): the program recorded at 26.11 frames a second, Windows' player couldn't scrub the file, a TV couldn't find the studio again until someone brought it forward, and lined up with a backup camera's recording the program held for one camera and was off after a cut to another.

- **A steady program clock:** a frame is due every 1/fps seconds from when the program started, whatever drives it (animation frames when the studio shows, the worker clock when it's hidden or covered), and a frame the studio was too late to draw still counts. Before, it drew whenever 31 ms had passed since the last frame, which on the hidden studio's 33 ms clock skipped every frame that came early: that was the 26.11.
- **Output settings** (beside Landscape / Portrait): 24, 25, 29.97, 30, 50 or 60 frames a second, 720p or 1080p, per event, fixed while Record program runs. The TVs, the stream, Record program and Render MP4 all follow them.
- **Record program is a normal MP4 at exactly that rate** (Chrome and Edge on a computer): the studio encodes the program itself, one frame per output frame, the live mix as AAC, into an MP4 with its index, so Windows' player can scrub it. It's written to the browser's file storage as it goes, not memory, so a long class doesn't fill it. Elsewhere, the browser's recorder as before. If the encoder fails mid-show, what was recorded is saved.
- **Record program's sound never drops:** it's taken on the sound thread (an audio worklet the sound engine runs whatever the page is doing; what it sends waits until the page takes it), timed by counting samples. The sound engine's clock and the computer's drift apart a little (a few hundred ms over two hours): it's kept within 15 ms of the picture by taking out or putting in a millisecond at a time, crossfaded. If the engine stops for a moment (a device change can do that), the gap is silence of its length, so everything after keeps its place. (Read on the page instead, a busy studio dropped most of it.)
- **Kept on time while hidden:** the server connection's reconnect and keep-alive, the phone remote's updates, the TV links and the mixer's sound check run on a worker clock, which the browser doesn't slow down in a hidden window (it slows a page's own timers to once a minute).
- **One timeline for this computer's cameras** (Output → Sync): each camera takes its own time to get a picture in (its sensor and compression, then USB), so a cut moved the program in time. Now every camera and screen here is held to one picture delay, the slowest camera's with a frame to spare: the picture on air shows the same moment whichever camera it's from, and the program lines up with another recording of the room at one offset. Each camera is read straight from its track (not a video element), so this goes on while the studio is hidden; a camera that stops sending is held at its last picture and catches up when it's back (in the show log). The delay goes up during a show only if a camera slows (in the show log), and settles between shows.
- **The sync check** (Output → Sync check): clap once where every camera can see your hands. The clap's crack on a microphone and the moment each camera sees the hands meet give each camera's own delay, kept for that camera on this computer. Checked with stand-in cameras 120 ms apart: it measured 119, and a cut between them went from moving the picture 139 ms to 4 ms.
- **Sound with the pictures:** sound from this computer waits as long as the pictures, and its microphones are lined up with each other by what they all hear (matching their sound, all the time, against the main microphone). Or by hand, or straight in.
- **No false break slate while hidden:** a camera on air counted as dropped when its video element stopped showing new frames, which a hidden window's do; now it's whether the camera is still sending.
- **The show log** has the target frame rate, repeated frames, Record program's progress (frames, skipped, sound against picture), the picture delay, each camera's own delay, cameras that stalled or slowed, and the sync check.

## 0.57.0 — the show log, and alerts when the sound stops
**Deploy:** `./aws/deploy.sh` (site only). It also ships the studio's code in its new files (0.56.5 below).

From a class recorded on one Windows computer (three USB cameras, a Focusrite for the microphones, PowerPoint shared from the same machine with the studio behind it): the Focusrite crackled and then dropped out, and with the other microphones muted the program went silent with nothing said. There was nothing to look back at to find out why.

- **The show log:** while the studio is open it notes, every second, the program's real frame rate (and the longest wait between two frames), whether the window was showing or hidden, how busy the computer was, the sound engine's state and the program's level; for each camera and microphone its sound (live, stopped, ended), level, sample rate, the frames its camera delivered and its tile showed, sound dropped on the way in (where Chrome counts it), and which microphone a camera's sound comes from; for phones, their link (frame rate, loss, jitter, round trip); for TVs, what they're sent and what's holding it back. And the events: joins and leaves, cuts, recording, the window hidden and back, devices plugged in and unplugged, tracks ending, the server connection. It runs on the background clock, so a studio hidden behind a slideshow is logged too.
- **Kept on this computer,** a minute at a time (30 days), so it survives a crash or a reload. **Save show log** (in the inspector, in Help, and in Monitor for any earlier session) makes one JSON file with a plain-words summary on top: the average and slowest frame rate, how long the studio was hidden, silent stretches, sources whose sound stopped or dropped, cameras sharing one microphone, every sound alert and how long it lasted.
- **Monitor's Show log panel:** the last ten minutes of program frame rate and sound, the seconds the studio was hidden shaded, the summary, and every saved session.
- **Sound alerts:** when the program has no sound for 3 s while something is in the mix, a source in the mix stops (its device ends or stops sending) or goes silent for 5 s, or the only microphone in the mix leaves the show (a USB interface that drops out is taken as unplugged, so it leaves), the studio says so in red over the program, with **Turn on** buttons for sources that could stand in. The phone remote shows the same alert (and buzzes), with the same buttons. With alerts allowed, the computer shows a system notification too, while the studio is hidden.
- **Found on the way:** the studio's own sound check ran on a page timer, which Chrome slows to once a minute in a window hidden for a while; and a USB microphone that dropped out left the show without a word.

## 0.56.5 — repo housekeeping
**Deploy:** with 0.57.0 (the studio's code moved into files; it works the same).

- **`npm test` runs every unit test** (core, sequence, quality, imports); it used to run only the core. `npm run test:e2e` runs the browser suites (`test/run_all.py`).
- **GitHub Actions** (`.github/workflows/test.yml`) runs `npm test` on every push and pull request.
- **Suites named for what they test**, not the version they arrived in: `e2e_v19` → `e2e_mic_alone`, `e2e_v201` → `e2e_fitted_mixer`, `e2e_v22` → `e2e_leave_rejoin`, `e2e_v23` → `e2e_podcast`, `e2e_v24` → `e2e_guided_setup`, `e2e_v27` → `e2e_switcher_room`.
- **`docs/TESTS.md`** lists every suite and what it covers (`e2e_display` and `e2e_remote` were missing). The README's test section now points to it, and its title no longer carries a version (it said v0.46).
- **The studio's code is in 23 files** (`public/js/studio/`), not one of 8,600 lines: core state, clips, live, the mixer, sources, Camera control, Stream out, graphics, the switcher, autopilot, Edit, menus, the media library, render and export, and so on. `public/js/studio.js` lists them. Nothing about how it works changed: the parts run in the same order as the single file (each imports the one before it first), and taking out the new imports, exports and setters gives back the old file exactly, token for token. A variable that another file changes has a setter beside it (`setLiveActive(peer)`), since an imported variable can't be assigned to. The import check (`test/imports.test.mjs`) now covers folders.
- **Lint, for mistakes only:** ESLint for the JavaScript (`npm run lint`, `eslint.config.js`) and Ruff for the Python (`ruff check .`, `ruff.toml`), both run on every push. They check for undefined names, unused imports and the like, not style. They found three lines in the studio that ran a function and returned `''` in one confusing expression (now two plain statements), and 29 unused imports in the tests (removed).
- **Removed what's done with:** `tools/split_pages.py` (0.41.0) and `tools/make_kiosk_page.py` (0.43.0), one-time scripts; `docs/og-source.html` and `docs/archivo.woff2`, the old share picture's source (it's `dev/og/` now). They're still in git history.

## 0.56.4 — a new share picture
**Deploy:** `./aws/deploy.sh` (site only). Links already shared keep the old picture until the site refetches it: paste vuemesh.com into Facebook's Sharing Debugger or LinkedIn's Post Inspector to refresh it there.

- **`og.png`, redrawn to match the site:** the home page's headline ("A production studio. In the browser."), what it does in one line, and a multiviewer wall (one camera on air, one in preview, two waiting) in the control-room look: colour bars, Barlow Condensed, tally red, amber timecode. "Everyone shoots. One film." and the QR code are gone; a QR shrunk into a link preview is too small to scan.
- **Made from a page:** `dev/og/og.html`, rendered with `python3 dev/og/render.py`. The frames are stills from the home page's live demo. The alt text on every page says what's in it now.

## 0.56.3 — the tour, linked
**Deploy:** `./aws/deploy.sh` (site only).

- **`/tour` is linked:** from the home page's "How it works" ("take the tour of every screen") and from the Partners page ("See every screen in the tour", under the facts).
- **The beacon's picture shows its venue Wi‑Fi code** as it is (an open network: the beacon itself says "make sure you trust it").

## 0.56.2 — the tour's pictures
**Deploy:** `./aws/deploy.sh` (site only).

- **All eleven screenshots are in** (`public/media/screens/*.webp`, 16–230 KB each), from a real show: studio, beacon, kiosk, camera, microphone, audio console, camera control, monitor, remote, `/tv`, my media.
- **Each frame takes its picture's shape** instead of cropping to 16:10: the wide studio windows show whole, the camera is a phone held sideways, and My media is a phone (it was a computer frame).

## 0.56.1 — the remote sees the clips
**Deploy:** `./aws/deploy.sh` (site only).

- **Clips loaded in the studio show on the phone remote**, under Clips (🎞 a video, 🖼 a picture): tap one and it goes on air, as clicking it in the studio does, with ON AIR on the one playing. The studio only ever told the remote which clip was on air, never which clips there were.

## 0.56.0 — the tour
**Deploy:** `./aws/deploy.sh` (site only).

- **`/tour`** (new, not linked yet): every screen in the order a show happens. Set up (the studio, the beacon, the kiosk), bring in sources (camera, microphone), run the show (audio mixer, camera control, monitor, the phone remote), show it (TV screens), afterwards (my media). Each with what it's for, what it runs on, and a link to open it.
- **Screenshots drop in by name:** `public/media/screens/<name>.webp` (studio, beacon, kiosk, camera, mic, mixer, ccu, monitor, remote, tv, media). Until a file is there, a labelled frame stands in. **`docs/SCREENSHOTS.md`** is the shot list: what each should show, sizes, theme, and what to keep out of frame.
- The dev server serves `.webp` as images.

## 0.55.1 — partners write to you directly; integrations first
**Deploy:** `./aws/deploy.sh` (site only).

- **Every button on the Partners page emails jtalbott22@gmail.com**, each with its own subject line ("Technology partnership", "Pilot: our venue or organization"…), instead of going to Patreon messages. The Terms page's contact link goes there too, with a subject for questions, notices and removal requests.
- **Integrations come first** on the Partners page ("Build an integration that ships"), now backed by who's building it: someone who has run countless live events and knows what breaks on the night. Camera and audio companies are named alongside streaming services, TV and device makers and AI labs.

## 0.55.0 — Partners, not just sponsors
**Deploy:** `./aws/deploy.sh` (site only).

- **The sponsors page is a partners page**, honest about where VUEMesh is (one developer, public beta, an audience just starting) and organised by who could pay: **gear makers** (get tested and featured in the setups), **venues and organizations** (founding pilots, founding pricing), **local sponsors** (the break slate, on air today) and **technology and platforms** (integrations and showcases). Each says what's real today, what the partner gets, and has its own button, each with its own subject line.
- **How VUEMesh will pay for itself**: personal shows stay free; paid plans for organizations and partnerships keep it running.
- The placements that need publishing and the public map (film page card, beacon line, featured events) are now under "Coming as the audience grows", not offered as if they were for sale.
- Links to it read **Partners** / **Partner with us**. `BRAND.sponsorEmail` (in `brand.js`) makes every button an email with its own subject; while it's empty they go to Patreon messages, and the page says so.

## 0.54.2 — the row under the program stays on one line
**Deploy:** `./aws/deploy.sh` (site only).

- **The controls under the program don't drop to a second line** when there's room for them. As it gets tight they give way in steps: the key hints go first (the keys still work; the buttons' titles name them), then the clock gets smaller, then the labels get short (Auto, Fade, Record, Mark). Only if even that doesn't fit does the row wrap, so nothing is ever cut off.

## 0.54.1 — the device chart knows kiosks, and webcam mics
**Deploy:** `./aws/deploy.sh` (site only).

- **"Any device, any job" has a Kiosk column**, with a line saying what one is (a screen that runs a whole show by itself: its code on screen, guests scan in, and it directs and records): a laptop or desktop, newer tablets, and a TV with a stick PC.
- **A USB webcam is a microphone too** (its own mic), as it is in the studio.

## 0.54.0 — the home page says how its films were made
**Deploy:** `./aws/deploy.sh` (site only).

- **The three films are labelled AI-made** where they play ("Film 1 of 3 · made with AI", and "see how" under the monitor), instead of passing for real footage.
- **"The films up top were made on one gaming PC"** (new, after the control room): the pipeline in six steps (write the shots, draw the stills with Qwen-Image, pick the best, bring them to life with LTX image-to-video, score with ACE-Step, cut with ffmpeg), what it runs on (ComfyUI in Docker and a Jupyter notebook on a home NVIDIA PC: no cloud, no upload), links to the film pipeline (jupyter-notebooks/vuemesh-films) and the home AI stack (self-hosted-ai-stack), and a nod to the bird-spotting notebook.

## 0.53.1 — the setups say where everything goes
**Deploy:** `./aws/deploy.sh` (site only).

- **The setup diagrams show the data's path:** the wires in are labelled "your network" and the wires out "straight out"; the VUEMesh cloud sits off to the side of the studio on a thin dashed line, marked "introductions only"; and each setup's recordings and stream say where they end up (on the studio computer, and on each camera; live only if you choose, straight from the studio).
- **Where everything goes**, under the diagram: pictures and sound go device to device on your own network and are never uploaded; the cloud only makes introductions (the event's code and name, who's in it, the handshake), and with Local network only that's all that leaves the room; recordings go straight to your studio computer and stay in its browser, with each camera keeping its own copy; going live goes straight from the studio, only while you stream.

## 0.53.0 — the home page shows how your own devices fit together
**Deploy:** `./aws/deploy.sh` (site only).

- **"Use what's already in the drawer"** (new, before the beacon; How it works goes here): pick a setup (Just phones, Podcast desk, Living room, Everything in the drawer) and a diagram shows what sees and hears, the studio in the middle, and what shows, sends and keeps, each device labelled with its job (camera, microphone, screen, remote, goes live, keeps), with the setup in a line and three steps to make it. The setups are plain data in `public/js/rig.js`.
- **"Any device, any job"**: a chart of which devices can be the studio, a camera, a microphone, a screen or the remote, and a tip that says out loud what nobody would guess: a USB mic plugged into a phone (USB‑C, or Apple's adapter on older iPhones) makes it a camera with studio sound, and webcams and mics on the studio computer join with + This computer.
- **The beacon section is plainer**: "One scan to join", what a phone does with the code, and why it keeps changing (it's a clock).

## 0.52.0 — the home page, for your own multicam shows; no revenue sharing
**Deploy:** `./aws/deploy.sh` (functions and site: new events' terms leave revenue out).

- **No more revenue sharing anywhere you can see it.** Gone: the home page's "Every source has a place" panel (names, screen-time shares and dollar amounts), the Contributor revenue share slider when you make an event, the revenue line on the watch page's credits and in the Edit credits, and the line on Sponsors. New events share no revenue whatever a client asks, and the terms a camera agrees to on joining no longer mention it (events already made keep the terms they were made with).
- **The home page's live demo labels its cameras by device** (Phone, Tablet, Phone 2, Laptop), not people's names.
- **New copy** for personal multicam productions: the description, the opening lines, "When the lights come up" (the show as it aired, every angle in full quality, a first edit already made) where the attribution panel was, a sharper line on why nothing is uploaded, and a new call to start a show. "Then make it a real control room" gains **Direct from your pocket** (the phone remote) and **Every screen in the room is a monitor** (`/tv`: the program, the night's recordings, or the beacon; "coming to more" big screens, without naming the Apple TV yet).

## 0.51.0 — TVs browse recordings and show the beacon, with PIP
**Deploy:** `./aws/deploy.sh` (site only). The Apple TV app: build and run it again from Xcode.

- **A TV that's been let in shows one of four things**: the program, **Browse** (the event's recordings), the **Beacon**, or the event card. The studio picks it under TV screens, or the TV does: the bar at the top of `/tv`, or Menu on the Apple TV remote (from any mode; on the event card the modes are on screen). The studio remembers each TV's choice.
- **Browse**: the TV lists the recordings on the studio computer (names, lengths, pictures), and the one you pick comes over peer to peer on a data channel of its own (`media`), as phones send clips, then plays on the TV with its own controls. Nothing goes through the cloud. `/tv` plays everything; the Apple TV plays MP4, QuickTime and AAC (what phones record) and lists WebM ones dimmed. Recordings already on the TV play straight away (`/tv` keeps up to about 1.5 GB, the Apple TV the last six).
- **PIP**: in Browse or Beacon, the live program small in a corner (picture only; the studio sends the picture only while it's shown).
- **Beacon on a TV**: phones scan and sync to it like any beacon. It draws the **studio's** clock, learnt from pings over the local network (a few ms), so phones synced to the TV line up with this computer and its cameras. A TV shows a picture late (20 ms in game mode, often 100 ms or more without), so the TV's beacon draws ahead by its lag. Until that's measured the TV asks for Game mode and Calibrate.
- **Calibrate** (studio, TV screens, in Beacon): the studio shows a beacon of its own; scan it with a phone and `/tvcal` opens, reads this screen's beacon and the TV's in turn, and sends the difference back (the phone camera's delay drops out). The TV's lag is set, shown in the row, and its beacon lines up.
- **Monitor** says what each TV is doing (program, browsing, sending a recording, beacon, + PIP), and counts a recording going to a TV in its rate.

- **The Apple TV's mode menu takes focus when it opens.** It came up over the program with nothing focused, so nothing could be chosen until the app was left and re-entered; focus now goes to the mode on screen. Its buttons draw their focus from the button itself.
- **A TV says when the studio is too old for modes.** A studio before 0.51 ignores Browse, Beacon and PIP; the TV now tells (the Apple TV's menu says so, `/tv` greys those out) instead of doing nothing.

**Tests:** `e2e_display.py`: Browse chosen on the TV (the studio follows), the program recording listed, pulled and played; PIP shows the program in a corner (the studio ticks PIP); Beacon on the studio's clock with the game-mode hint until a lag is set, and a set lag reaching the TV.

## 0.50.0 — the Apple TV shows the picture; TVs and streams in Monitor; no TV code
**Deploy:** `./aws/deploy.sh` (site only). The Apple TV app: build and run it again from Xcode.

- **The Apple TV app showed the program's sound over a black screen.** It drew only frames the Apple TV's hardware had decoded from H.264, and dropped anything else without a word on screen: when the studio's browser sends VP8 or VP9 (a Chromium without H.264, say), that was every frame. Frames decoded in software are now copied into a picture the TV can show, so the program appears whatever the codec. The picture's track is also picked up once the studio's answer arrives, not only when WebRTC announces it, and attached once.
- **The Apple TV keypad's focus no longer spills over the keys beside it.** tvOS's plain button style still draws its own light focus slab behind a button; the keys (and the app's other buttons) now draw only their own amber focus, and the focused key sits above its neighbours.
- **No more TV codes.** A TV gets in with the event code and Accept in the studio's TV screens, nothing else: Show a TV code (the studio), Enter a TV code (/tv and the Apple TV app) and the `pair` message are gone.
- **Monitor's Transfers shows everything going in and out**: Coming in lists each live picture and sound arriving (name, size, codec, rate) as well as recordings; Going out lists each TV (program or event card, size, codec, route and rate), the stream out, and cameras' parts of the live cut. A TV's codec there tells you whether the Apple TV is getting H.264.

**Tests:** `e2e_display.py`: the second screen gets in with Accept (no TV code anywhere), with its event code pasted with a dash into the fourth cell; Monitor lists both TVs going out, with a rate, and the camera coming in.

## 0.49.0 — Break and Black as sources; a T-bar that fits; TV screens you can paste into
**Deploy:** `./aws/deploy.sh` (site only).

- **Break and Black are sources**, two tiles above the cameras with their pictures (the break slate as it's set, and black), instead of buttons under the program. With Tap: Preview, tap one to put it in preview; then AUTO dissolves to the slate or fades to black over the dissolve time, the T-bar fades by hand as slowly as you like (picture and sound), and CUT takes it straight there. Coming back works the same way, and whatever you left waits in preview (flip-flop): the camera after you go to black, black after you come back up. With Tap: Air, or tapping the one on air, it cuts straight there and back. B, X and Shift+X still work, and Fade to black stays under the program. With two fewer buttons, the row under the program fits on one line on a laptop.
- **Microphone tiles show their picture**: what the program shows while that microphone is on air (the waveform, bars or ring, from its own sound), the same size as a camera's tile; the preview box shows the same.
- **The T-bar works in a short window.** The switcher was sized for a tall monitor and ran off the top and bottom of a short one (a laptop with the mixer dock open), taking the T-bar's handle with it. It now stays inside the monitor: the T-bar gives up height first, and under about 380 px the MIDI button goes too.
- **TV screens (/tv):** a code pastes in whole (the event code, or a TV code as the studio shows it, ABCD-EFGH), into any cell; it used to keep only the first character. **Full screen** (or F, or a double-click on the picture) and **Leave** (back to the code screen, and the studio stops sending) beside Sound; all three fade with the label, and so does the pointer.

**Tests:** `e2e_switcher.py`: Black in preview, AUTO fades to black and back up (flip-flop both ways); the break by CUT and back; no Break or Black buttons. `e2e_showcontrol.py`: the Black tile lights on Shift+X and cuts back up. `e2e_display.py`: a pasted event code and a pasted TV code (with its dash, into the fourth cell) fill every cell; Full screen in and out; Leave.

## 0.48.0 — TV screens: the program on an Apple TV, or any browser at /tv
**Deploy:** `./aws/deploy.sh` (functions and site: the cloud learns the TV role).

- **TV screens** (new, beside Phone remote): a TV joins with the event code and waits there until you press **Accept**, or types a one-time code from **Show a TV code** (8 characters, two minutes, five tries, as the phone remote). Knowing the event code isn't enough: it's on every beacon. Once in, each TV gets its own key, remembered on both sides, so a reload or a restart comes straight back. Each TV has **Program** or **Event card**, and **Remove** stops it at once.
- **The picture goes straight from this computer** over the local network: the same program picture as Program out, with the live mix, H.264 first (an Apple TV decodes it in hardware) at up to 6 Mbit/s. Nothing but the handshake touches the cloud, and there's no relay. A TV that can't reach the studio in 10 s says so (two networks, or Wi-Fi that keeps devices apart).
- **/tv**: any screen with a browser can be a TV screen, with the same protocol as the Apple TV app (so it's the app's reference): six code cells, the event's name, and a broadcast-style label that fades.
- **The Apple TV app** (`apple-tv/`, SwiftUI, new): join by code with a keypad of only the characters codes use, wait or pair, then the program full screen. See `apple-tv/README.md`.
- **Cloud:** a `display` role; TVs hear who's here, as the beacon does; they can only message the studio, as phones can; a `displays` count per day.

**Not yet:** Edit as a TV's source, Browse, Beacon mode and its Wi-Fi phase, the device key. If the program's sound starts after a TV has joined, that TV gets sound when it next connects. The design is in docs/APPLE-TV.md and the spec doc.

**Tests:** `core.test.mjs`: a TV joins as a display, reaches only the studio, can't message a phone, and hears the studio come and go. `e2e_display.py` (new): /tv waits, Accept shows the program, Event card and back, a reload needs no second Accept, a TV code pairs a second screen (a wrong one is turned away), Remove stops one and not the other.
## 0.47.0 — stereo in the live mixer; balance and Mono on every channel
**Deploy:** `./aws/deploy.sh` (site only).

- **This computer's sound, a shared screen and the Clips stay stereo.** The live mixer folded every channel to mono before its EQ, so stereo sources reached the program (and its recording and stream) as mono, and the Program meters always read the same on both sides. Each live channel now has a **Mono** switch: on for phones (as before), off for this computer's sound, a shared screen, a stereo input of this computer and the Clips. Mono folds both sides into one and puts it in the middle; off, each side keeps its own.
- **A stereo channel shows two meters** (left and right, after its balance) in the mixer dock, the full-screen meter bridge and the inspector.
- **Balance on every strip in the mixer dock** (it was only in the audio console): pans a mono channel, balances a stereo one; double-click to centre. In Edit it sets the track's balance, with the track's Mono beside it.
- Sharing asks the browser for two channels of sound.

**Tests:** `e2e_screen.py`: shared stereo sound arrives on a stereo strip (two meters, each side its own); balance hard left takes the right side away; Mono folds it to one channel and back.

## 0.46.4 — sound sources on the phone remote
**Deploy:** `./aws/deploy.sh` (site only).

- **The phone remote has a Sound section:** each sound-only source (a microphone, this computer's sound) as a card; a tap cuts to it, as clicking it in the studio does (the program shows its sound picture), with its tally while it's on air, and the status reads "On air · Computer sound · sound only". The status line wraps rather than cutting a long name short.

**Tests:** `e2e_remote.py`: a microphone of the studio's computer shows under Sound, and a tap puts it on air (the studio: ON AIR · MIC).

## 0.46.3 — this computer's sound in Monitor; the receiver takes busy cuts
**Deploy:** `./aws/deploy.sh` (site only).

- **Monitor shows this computer's own microphones and sound** (Computer sound): "This computer", the device, "straight in, no network, no compression" (cameras of this computer already did).
- **The WHIP receiver (`tools/whip_receiver.py`) no longer sticks or breaks up on a cut to something busy.** aiortc's video jitter buffer holds 128 packets (about 150 KB): a frame bigger than that (the first after a hard cut, a sharp screen, a keyframe at a good rate, all bigger since the stream runs at its full rate) lost its start, couldn't be decoded, and the keyframe it asked for was bigger still, round and round. Measured with a hard cut every 3 s: six keyframe requests in 15 s with aiortc's buffer, none with the receiver's (4096 packets, about 5 MB; `VM_RX_JITTER` to change it). VUEMesh's program itself always runs at 30 frames a second at one size whatever's on air, so a source's size or frame rate never reaches the stream.

## 0.46.2 — the remote keeps up; camera control that takes
**Deploy:** `./aws/deploy.sh` (site only).

- **A camera that joined while the remote was open didn't show until a reload.** A phone's connection drops now and then and comes back (the screen sleeps, it goes to the background, the Wi-Fi blips); the studio let go of the remote and wasn't told it was back, so nothing new reached it. The remote now checks in every five seconds (which binds it again), and asks for everything if nothing's come for twelve.
- **Brightness and contrast often did nothing.** Camera settings were asked for as "advanced" constraints with values between the camera's steps (a brightness of 159.4 on a camera that steps by 1; an exposure of 0.7 EV on a phone that steps by a sixth), and a set with one value a camera can't do exactly is dropped whole, without an error. Every value now goes inside the camera's range and on its step (`snapToCamera` in `camctl.js`, for phones and this computer's cameras alike); a camera of this computer that still doesn't take a setting is named in the event log.

**Tests:** `e2e_remote.py`: after the studio loses track of the remote, a camera that joins still shows up on it. `quality.test.mjs`: settings put on the camera's steps and inside its range.

## 0.46.1 — a WHIP receiver that doesn't hold the stream back; this computer's cameras in Monitor
**Deploy:** `./aws/deploy.sh` (site only).

- **The stream out's low rate was the receiver.** A WHIP receiver built on aiortc (Python) tells the browser its own estimate of the link's bandwidth, and it's far too low: measured here, the studio's encoder was told 5.2 Mbit/s, then 0.5 within three seconds, creeping to 0.8, overriding VUEMesh's floor. Against MediaMTX the same program stayed near 5. **`tools/whip_receiver.py`** (new, on-brand) leaves out what that estimate needs (abs-send-time, goog-remb), so the browser's own congestion control sets the rate: measured, the encoder's target stays at the chosen 6 Mbit/s. It also fixes: Stop streaming reaching it (it gave a stop address it didn't answer); the token visible to anyone opening the dashboard (the dashboard now needs its key); the incoming video piling up while nobody watched; a second stream not replacing the first; the preview's quality (raised from aiortc's 0.5 Mbit/s); recordings saying 640x480 (aiortc's recorder, with sound, wrote the size before it knew it). It keeps its token between runs, makes its own certificate, shows the rate, picture and recording time, and lists recordings to download.
- **Monitor shows this computer's own cameras** (USB webcams): "This computer", the picture's size and frame rate, "straight in, no network, no compression"; no more dashes, and no "not on the venue Wi-Fi".
- **Monitor's stream tiles say what the encoder was asked for**, beside what it sends: near the chosen rate and sending less means the picture doesn't need more; far below it (flagged) means the receiver or the network is holding it back.

## 0.46.0 — sharper live pictures, faster starts
**Deploy:** `./aws/deploy.sh` (site only).

- **The camera on air sends its full picture, generously.** Every phone's live picture was 1.2 Mbps at half size, whatever it was doing, and the program, Record program and the stream are made of those pictures: no stream rate could put back what they didn't have. Now the live picture follows the show: on air, full size up to 8 Mbps on the local network (less over the internet, a relay or mobile data); in preview, full size at 3 Mbps, so a cut to it is sharp at once; standby, the small picture as before, so a room full of phones doesn't fill the Wi-Fi. (The phones' own recordings, which Edit uses, were always full quality.) Each phone checks its link every two seconds and steps its ceiling down for loss or congestion, and back up when it clears.
- **Links start near their target,** not at a few hundred kbit/s creeping up: the cameras' links at 2.5 Mbps; the WHIP stream at three-quarters of its chosen rate, with a floor at 30%; Program out's Edit picture (this computer to itself) at 12 Mbps with a floor of 8 and a ceiling of 30 (it was 8, starting low, which is why it looked soft). Chrome and Edge take the start and floor hints; every browser takes the ceiling.
- **Monitor** has a **Live picture** column: on air, preview or standby; what it's sending of what it may (and what it was stepped down from); its size and frame rate, and whether the encoder is hardware; what's holding it back (the network, or the phone's encoder), with warnings when it's the picture on air. The stream out gets a summary tile (rate of the chosen rate, picture, what limits it).

**Tests:** `test/quality.test.mjs` (the hints in an answer; the table); run by `run_all.py`. Checked here with two phones: before any cut both send the small picture; cutting to one puts it on air at its full size with an 8 Mbps ceiling while the other stays small; Monitor shows both; the Edit page test (Program out's Edit picture at full size) passes.

## 0.45.0 — a phone remote for the studio
**Deploy:** `./aws/deploy.sh` (the server changed: it accepts a remote's connection; no new AWS resources).

- **Phone remote** (the studio's right-hand panel): **Add a phone** shows a QR and a one-time code (two minutes, one phone; five wrong tries take it away); the code shows only when asked for. The phone (`/remote`) shows what's on air and whether the program is recording, the cameras by name with tally and a small picture every few seconds (only while it's open and on screen), and cuts to a camera, turns the auto-director on and off, fades to black and up, takes a break, and starts and stops Record program (asking before it stops). It keeps the phone's screen awake while open.
- **Only that phone:** pairing gives it its own session key, checked on every command; the code is spent once used or expired, and a made-up key gets nothing. Paired phones are remembered on the studio computer for the show (a reload doesn't unpair them, and a reload of the phone carries on); **Remove** unpairs one at once. A remote's messages go only between it and the studio, never to the cameras' links. Remotes aren't counted as cameras or viewers.

**Tests:** `test/e2e_remote.py`: no code until asked; pairing by the QR's link (a wrong code turned away; the code leaves the phone's address bar); both cameras' pictures; cut, auto-director, break, fade to black and up, Record program start and stop; the used code refused, a made-up key refused, five wrong codes ending the pairing; a reload carrying on; Remove.

## 0.44.0 — the films on the home page, web traffic in Admin, footage counted right
**Deploy:** `./aws/deploy.sh`. **The server changed** (page views and visitors, Admin's traffic and day correction, a limit on footage); same command, no new AWS resources. Put the films in `public/media/` first (`wedding.mp4`, `concert.mp4`, `arena.mp4`).

**The films on the home page**
- **A playlist in the hero's program monitor:** when it comes into view the three films play one after another (muted; browsers only start sound when asked), then the live demo takes over. Keys under the wall (switcher keys: the one on air has its tally lit and a progress bar) pick a film or the demo; Sound turns the sound on. Off screen the film pauses, and carries on when it's back. A film that isn't uploaded yet is left out, its key hidden. Nothing plays by itself for anyone who's asked their device for less motion. The demo underneath doesn't draw while a film covers it.

**Web traffic, in Admin**
- **Visitors, page views, pages per visitor, films played and watched to the end;** a visitors-a-day chart; top pages, where visitors came from, landing pages, campaigns (`utm_source`), devices, browsers, countries (when the edge provides them), films; a CSV. One anonymous page view per page load: no cookies, nothing stored about anyone (a visitor is counted once a day by a salted fingerprint that's deleted after two days); bots, the admin pages and browsers asking not to be tracked (Do Not Track, Global Privacy Control) aren't counted.

**Footage counted right**
- **Three days in October had about 7.16 million seconds (83 days) of footage each:** a recording with a nonsense length was counted. The studio now counts only plausible lengths (more than 0, up to 6 hours) and names any other in the event log (and diagnostics), so the cause can be found; and the server won't add more footage for an event than its devices could have recorded since it was made.
- **Correct a day** (Admin, under Growth): days whose footage can't be right are listed (more than their cameras and microphones could record in a day); correct a count, and the original is kept beside it (`was_footage_sec`), shown in the list.

**Tests:** `test/core.test.mjs` covers traffic counting (visitors once a day, bots and the admin not counted, referrers, campaigns, devices, browsers, film plays), the footage limit and correcting a day. Checked here in a browser: the films play in turn, a missing one is skipped, the demo takes over; scrolling away pauses; plays and page views reach Admin; correcting 10-08 from the flagged list.

## 0.43.1 — Program out's Edit keeps full size
**Deploy:** `./aws/deploy.sh` (site only).

- **Program out (Edit) showed the edit at 640×360, not 1280×720.** The Edit window's picture travels to Program out over a connection on the same computer (since the Edit window runs in its own process, 0.42), and a connection left to itself lowers the resolution when it judges the link busy. The sender is now set to keep the picture at full size, at the program's bitrate and 30 fps. Live is unchanged: it never crossed a connection.

**Tests:** `e2e_editpage` checks that Program out's Edit picture arrives at the size the Edit window draws the program (it passed at 640×360 in the earlier run; the check should have caught it then).

## 0.43.0 — the kiosk screen is its own page
**Deploy:** `./aws/deploy.sh` (site only).

- **`/kiosk` is the screen itself** (`kiosk.html`), with only what a sign needs: the program, the cameras and the join-code panel; the switcher, inspector, mixer dock, transport and the rest are gone from its markup (26 parts). Its design can change without touching the studio. Before, `/kiosk` was a launcher that opened the studio in kiosk mode, which hid those parts with CSS.
- **The launcher is folded in:** `/kiosk` with no show in the address starts one (or carries on this screen's), shows "Getting the show ready…", and comes back as `/kiosk?e=…`; each next show opens there too. Embeds pointing at `/kiosk` work as before; older links to the studio in kiosk mode (`/studio?…&kiosk=1`) still work.
- The shared code gets stand-ins for the kiosk page's missing parts, as on the Live and Edit pages; four button-label updates (full screen, fade, black, lower third) skip when their button isn't on the page. `tools/make_kiosk_page.py` did the one-time build.

**Tests:** `e2e_kiosk` and `e2e_home` expect `/kiosk?e=…`. Checked here: `/kiosk` starts a show and lands on it with no errors; a phone names it, taps Go live, and the kiosk goes on air and records; every stand-in handed out is one of the page's listed parts.

## 0.42.0 — the Edit window in its own process
**Deploy:** `./aws/deploy.sh` (site only).

- **Edit runs in its own browser process,** so a heavy export (or anything else busy) in the Edit window can't make the live program stutter: the studio opens it without a link back, which browsers give a process of its own (checked: 1 → 2 page processes). Edit ↗ with the Edit window already open asks it to come forward (over the channel between them) and sends what's recording so far; closed, it says so, and Edit ↗ opens a new one. If no Edit window says hello within a few seconds of opening one, the studio says to allow pop-ups.
- **Program out (Edit)** gets the edit's picture and sound from the Edit window over a WebRTC connection on this computer (set up over a channel; nothing leaves the computer), since the two windows can't reach into each other any more. It asks again every few seconds until an Edit window answers, and hangs up when switched back to Live. While it's showing the edit, the Edit window keeps drawing even when covered.

**Tests:** `e2e_editpage` (Program out's Edit comes from the Edit window's own process, with picture and sound; close and reopen), `e2e_pages` checks the Edit window is its own process; tests waiting on a newly opened window wait for its page to exist.

## 0.41.1 — the Edit page says "edit" when it's ready
**Deploy:** `./aws/deploy.sh` (site only).

- **The Edit page starts as "loading"** and becomes "edit" once it has built the edit (as before the split, when it started as a copy of the studio). In 0.41.0 it said "edit" from the first moment, so anything waiting for it (the tests' Edit window, for one) went ahead before the timeline and title were there.

**Tests:** layout counts a missing Live mixer dock as hidden on the Edit page; mic break reads the studio's Live mixer (the dock; `#mixer` is Edit's); the phone-setup test's fake iPhone says it's an iPhone (the motion step is for phones and tablets).

## 0.41.0 — Live and Edit are separate pages
**Deploy:** `./aws/deploy.sh` (site only).

- **Two pages, each with only its own markup:** `studio.html` is Live (14 Edit blocks out, about 5,000 characters lighter), `edit.html` is Edit (28 Live blocks out, about 12,000 lighter). They're edited on their own from here: change one page's design without touching the other. (`tools/split_pages.py` did the one-time split, for the record.)
- **The code still serves both** (`js/studio.js`; moving Edit's code into its own file is next). Each page lists the other page's elements on `<body data-absent>`; asked for one of those, the code gets a harmless detached stand-in, so wiring the other page's controls does nothing here. Anything else missing is still missing, so real mistakes still show. A few lookups by class (the stream-out tabs, the mixer dock, the monitor's resize watch) skip when their element isn't on the page.

**Tests:** `test/e2e_pages.py` — each page shows its own controls and none of the other's; pressing around both (full screen, fades, breaks, help; play, marks, gaps, export) raises nothing; every stand-in handed out is one of the other page's listed elements.

## 0.40.3 — no motion-sensor step on a computer
**Deploy:** `./aws/deploy.sh` (site only).

**Fixed**
- **A computer joining as a camera could be shown the "Keep it level" motion-sensor step** (and wait there) when its browser offers the motion permission, as newer ones do. The step is for phones and tablets (iPhones and iPads ask for it); a computer goes straight to its camera now.

**Tests**
- The control room, layout and events suites updated for Edit in its own window (opening a pop-up ends a browser's full screen, and the studio's layout follows); phone recovery says what the phone is showing if it gets stuck (`wait_or_show` in `test/vmtest.py`).

## 0.40.2 — the studio loads again
**Deploy:** `./aws/deploy.sh` (site only). **Deploy this over 0.40.1.**

**Fixed**
- **0.40.1 broke the studio** (and so the Edit window and the kiosk): the time-limit helper added to the export code landed between `export` and `class RenderError`, so the module exported the helper instead of `RenderError`; the studio imports `RenderError`, and a missing import stops the whole page loading. The export test passed because it doesn't import it.

**Tests**
- `test/imports.test.mjs`: every name a page imports from one of the site's modules must be exported by it (a second to run; it fails on 0.40.1's file). `run_all.py` runs it first, every time, even with `--failed`.

## 0.40.1 — a damaged recording can't stall (or freeze) an export
**Deploy:** `./aws/deploy.sh` (site only).

**Fixed**
- **An export could stall for ever on a damaged recording** (and, on some computers, take the computer with it): when a clip couldn't be decoded quickly, the export switched to the slower route, which seeks a hidden player frame by frame, and waited for each seek to finish with no limit. A damaged file never finishes it. Now a seek gives up after 4 s and any frame after 8 s, on either route; that clip is left out of the export (whatever's underneath shows) and named in the report ("the clip stops partway (it may be damaged)"), and the rest renders. Checked: a good clip with a damaged one renders in about 5 s, the damaged one reported unreadable, the film decoding cleanly.

**Tests**
- `test/run_all.py`: runs everything and writes `test-results.txt`; checks for Pillow, Playwright and ffmpeg first.
- The suites that switch to Edit with the backtick key (audio console, control room, show control) use the Edit window; context menu and sync lock start Record program (cameras record on air only then); the project export accepts the live cut when Edit hasn't been opened; the home page's own palette is expected.
- `e2e_render`: makes its own samples (in VP9, which every Chromium decodes, so the damaged one really is decoded), and a watchdog stops the test's browser if any export runs past two minutes.

## 0.40.0 — Live and Edit, apart: the studio is Live only, the edit is its own window
**Deploy:** `./aws/deploy.sh` (site only changed since 0.39.0).

**One job each**
- **The studio is Live only.** Its Edit ↗ button opens the edit in its own window beside it, or brings it forward (finishing the recordings in progress as it does). The studio never goes into Edit.
- **The edit belongs to the Edit window, always.** The studio records (every camera, the live cut, the program as aired) and tells the Edit window; the Edit window builds the edit from them when it opens and keeps it current as things arrive. Close it and open it again: your edits are all there. (Before, the timeline changed hands between the studio and an open Edit window, every couple of seconds; that's gone.)
- **Each computer camera recording keeps whether it has sound,** so the Edit window knows without checking again (on a busy computer its own check could time out and show "sound ?").

**Tests**
- All 22 suites that edited inside the studio now do their editing in the Edit window (`test/vmtest.py`: `edit_window()` opens it, or finds it if it's open). Run here: the Edit window, computer cameras, black and fades, second takes, and aired clips. The heavier two-phone suites (dissolves, the editor, breaks in Edit) need a machine with more than one CPU to run; run them on yours.

**Next:** slimming the two pages (each still carries the other's hidden markup), the editing code in its own file, the Edit window in its own browser process (so a heavy export can't stutter the live program), and the kiosk as its own page.

## 0.39.0 — the home page in broadcast clothes; studio recordings in My media
**Deploy:** `./aws/deploy.sh` (site only; it now uploads the site's fonts with the right type).

**The home page, redesigned for the people it's for**
- **The control room:** the hero is a multiviewer wall (the program and each camera in a dark bezel, each with its label strip, red tally on air, green on hover, timecode in amber); the shortcuts are keys on a switcher panel, each with its light (Start a show is the red one); a strip of colour bars at the top.
- **Type:** Barlow Condensed for headlines and on-screen labels, as on broadcast graphics, and Barlow for reading, served from the site itself (no requests to Google; they work on a local network). License: `fonts/LICENSE-Barlow-OFL.txt`.
- **Palette:** control-room slate, with tally red and preview green used only as signals, and amber for time; light and dark themes. Text on a monitor stays white (and timecode bright amber) whatever the theme.
- **Layout:** on wide screens the headline and what it means sit side by side, so the wall starts above the fold. "Start a show" everywhere (the top bar said "Start an event").
- **Fixed:** the "Not a video upload service" section had lost its top space (it's also a kit section, whose later rule overrode it).

**My media**
- **Studio shows are in it:** everything recorded on this device, including the recordings a studio here received or made (each camera's, the program as aired), under their show, with no need to open the show. Play, Save, and Delete (which also removes it from the studio's editor: at once if the studio is open, and from its saved timeline).

**Tests:** `test/e2e_mymedia.py`.

## 0.38.0 — the home page is the app; Delete in Monitor; the Edit page finds its event; your new home page and terms
**Deploy:** `./aws/deploy.sh` (site only changed since 0.37.0).

**The home page works right away**
- **Camera, My media, Kiosk, Join a show and Start a show** sit at the top of the home page, no event needed. **Camera** starts the camera on your own (straight away if the browser already allows the camera, else one tap); **My media** opens what's recorded on this device; **Kiosk** opens a kiosk show; **Join a show** scans or takes a code.
- **The terms, once:** the first tap asks to agree to the Terms of Use (again only when they change); after that a tap goes straight in.

**Monitor**
- **Delete** on a received recording (after a confirm) removes it from this computer and from the editor: the file, everywhere it's used on the timeline, and its subclips. (Before, only Media in Edit, or My events, could.) An open Edit window drops it too.

**The Edit page**
- **Opened without its event code** (a bookmark, a reopened tab) it finds its event: from the studio that opened it, or the last event edited here. It used to show the studio's event list, whose links went back to the studio. Its list now asks "Edit which event?" and opens events in Edit.

**Your new home page and terms**
- **Home page:** your new words ("A production studio. In the browser."), plus two fixes: the new two-card section ("Not a video upload service") had no two-column layout (it would have left an empty third column), and two sections shared a heading id (screen readers named the wrong one).
- **Terms:** your new section 9, VUEMesh intellectual property (the rest renumbered; nothing else refers to section numbers). The terms are dated October 11, 2026, so people agree again.

**Words**
- **"Device", not "laptop":** the studio can be any computer, and the camera page any phone, tablet or computer ("Saved on this device", "Recording the program to this device").

**Tests:** `test/e2e_home.py`, `test/e2e_monitordel.py`.

## 0.37.0 — Edit in its own window, beside the live studio; Program out's Live / Edit
**Deploy:** `./aws/deploy.sh` (site only changed since 0.36.0).

**Edit in its own window** (the first step of giving Live, Edit and the kiosk their own pages)
- **Edit ↗** (beside the Live and Edit tabs) opens `/edit` in its own window: keep the show live in the studio, and watch the edit come together in the other window.
- **It only edits:** it connects to no phones or cameras (the studio does that), has no Live, and draws no live program, so it doesn't slow the studio down.
- **It follows the show:** opening it (or coming back to it) finishes the recordings in progress; every recording the studio receives and every change to the live cut shows up in it as it happens (changes to the live cut come in batches, one rebuild a second at most).
- **While it's open, it owns the timeline:** the studio leaves the timeline alone, so edits made there stay, and new takes go on the end. **Close it**, and the studio's own Edit has what was done there.
- `edit.html` is its own page now (for now the same layout as the studio; it'll be slimmed down as the pages separate).

**Program out: Live or Edit**
- Program out has a **Live / Edit** switch (remembered): Live is the program going to air; Edit is the edit as it plays in the Edit window, with its sound. The window says which (PROGRAM / EDIT).

**Fixed**
- **A flickering break flooded the live cut:** on a busy computer the automatic break could flicker on and off as frames came late, and each flicker went into the live cut. A break goes in once it has lasted 1.5 s now, and ends once it has been off 1 s (dated from when it really began or ended).

**Tests:** `test/e2e_editpage.py` (Edit ↗ beside a live studio, a take arriving in it, a hand edit kept and a second take on its end, Program out showing Live or Edit, the studio taking the edits back when it closes).

## 0.36.0 — cameras record only while the show is recorded; identical webcams; the audio console
**Deploy:** `./aws/deploy.sh` (site only changed since 0.35.0).

**Recording follows the director**
- **Cameras record their time on air only while you Record program.** Cutting around without it shows the cameras live and records nothing: there's no point editing what you weren't recording. With it, the camera on air records (phones, with "Cameras record their time on air while you Record program", on by default; this computer's cameras always). When you stop Record program, the cameras hear at once (not after the program has finished saving) and stop.
- **A camera person's own recording is theirs, and comes first.** If they're recording when you cut to them (recording), their recording carries on and a new clip starts at your cut (your in-point); when you cut away, that clip ends there and their recording carries on until they stop it. Stopping Record program doesn't stop them.

**Fixed**
- **Identical webcams** (three of the same Logitech) could only be added once: a camera on this computer was known by its name. Each device is its own camera now ("Logitech BRIO", "Logitech BRIO 2", "Logitech BRIO 3"), and they come back as three when the studio reopens.
- **The audio console could grow forever** (a strip "expanding into infinity", meters and faders gone, then the browser giving up), on high-density screens such as a Retina Mac: each meter's drawing was sized from its box, and the drawing's size pushed the box a little taller every frame. The boxes decide now and the drawing follows, with a cap as a backstop.
- **A dissolve could crawl on a very busy computer** (each slow frame moved it only a little); it keeps pace now.

**Tests:** `test/e2e_recpolicy.py` (nothing recorded without Record program; the on-air camera records with it; a person's own recording gets the director's cut as its own clip and carries on; stopping Record program stops only the director's recording), `test/e2e_console2.py` (two microphones on a 2× screen: steady; on 0.35 the meters grew 928 → 1248 px in six seconds). Tests that need on-air recordings now start Record program, as a director would.

## 0.35.0 — nothing records at black, fades in Edit, kiosk vs studio (and time used) in Admin
**Deploy:** `./aws/deploy.sh`. **The server changed** (camera time counted from connect to disconnect; the studio's live, edit and kiosk time; the admin's view of both); same command, no new AWS resources.

**Fixed**
- **A camera on this computer kept recording at black** (and its clips kept arriving in Edit), and finishing the recordings (going to Edit, ending Record program) started a new one even at black. Black means nothing's on air: once the program has faded to black, this computer's cameras stop recording (5 s on) and stay stopped; finishing a recording only starts another if the camera's still on air. Fading up starts it again.
- **A fade to black wasn't in Edit.** The live cut keeps it now: the shot before fades out to black (over the fade's length), the time at black is empty, and the shot after a fade up fades in.
- **Going back to Edit soon after** (within 15 s) didn't bring in what had been recorded since; it does now (not more than once in 3 s).

**Kiosk**
- **A kiosk records no clips of its own** (cameras or microphones on its computer): it never edits. It records only the program, which goes back to the phones. (Phones already keep their clips at a kiosk.)

**Admin**
- **Each event says where it ran: KIOSK or STUDIO** (the filter takes "kiosk" or "studio" too), and **the time used on each part**: the studio live, editing, a kiosk, and the phones (cameras and microphones, from joining to leaving).
- **Growth** has the same times by day: Studio (live), Editing, Kiosks running, Phones in shows (hours).

**Tests:** `test/e2e_blackrec.py`; `test/sequence.test.mjs` covers fades in the rebuild; `test/core.test.mjs` covers the kind and the times; `test/e2e_admin_monitor.py` knows the new Kind column.

## 0.34.0 — Go live at the kiosk, breaks and dissolves in Edit, the studio's own event list
**Deploy:** `./aws/deploy.sh` (site only changed since 0.33.0).

**Kiosk**
- **The side panel fills the screen's height** (beside the bar too) and everything in it fits: the code takes what's left after the words and the counts, and stays square. (The counts and the line under them were cut off.)
- **Go live:** the first phone in (the one that named the show), once it's locked in to the code (or after 20 s), gets a big **Go live** button. A tap counts in 3-2-1, on the phone (a buzz with each) and big over the kiosk's program, then the program fades up and records. The kiosk says "Ana: tap Go live on your phone to start" meanwhile. If that phone leaves, the next one gets it; after 3 minutes the show starts anyway.
- **No "Leave site?"** when the kiosk moves on to its next show.
- **Phones keep their clips** at a kiosk (a kiosk doesn't collect them: nobody edits there); they show as "Kept on this phone" in My events, and each phone still gets its part of the live cut. (This also keeps big clips off the sign's computer; one had failed to send with Safari's "The object can not be found here.")
- **A camera on the kiosk's own computer** (a webcam added in the studio) never starts or keeps a show going: it joins the rotation while phones are on.
- **Setting up a kiosk on a sign:** README and Help (set the look and timing in the studio on that computer first; the kiosk uses that browser's settings).

**Edit**
- **Breaks taken live are their own items** in the automatic edit, "Break (live): …" with what the slate said and its look, drawn at full quality: keep, change or delete them like anything else.
- **Dissolve button and D:** a half-second dissolve into the selected shot (or the shot at the playhead); again takes it off. (Right-click a clip for other lengths.)

**Studio**
- **Opened with no event, or one that's gone,** it lists the events on this computer, each with Open (or Forget, if it has expired), plus Make a new event and Kiosk.

**Tests:** `test/e2e_kiosk.py` (the panel fits the height, a webcam doesn't start a show, Go live and its count-in, phones keep their clips, a fresh show with no Leave site?), `test/e2e_editbreaks.py` (a live break between the shots in Edit, Dissolve and D, the studio's event list); `test/sequence.test.mjs` covers breaks in the rebuild.

## 0.33.0 — a hands-free kiosk, named by the first phone; events kept apart on phones
**Deploy:** `./aws/deploy.sh`. **The server changed** (a kiosk show without a name, named once by the first phone; a few private fields left out of the public event); same command, no new AWS resources.

**The kiosk, as it should be**
- **Nothing to press, nothing asked for.** `/kiosk` opens this screen's show (or starts one) straight into the stripped-down studio. No buttons, no inputs, and it asks the browser for nothing (no camera, microphone or screen): it only receives phones. In an iframe, nothing has to be allowed.
- **Its own join code**, drawn by the studio (moving, like the beacon's, so phones sync to it), whole on screen and pulsing, with "Scan to start a show", then "Scan to join" and the show's name. (It was the beacon in a frame before, and the code got cropped.)
- **The first phone to scan in names the show** ("You're first here: name the show"); the screen shows the name within seconds, and everyone after joins that show. If two phones name it at once, the first wins and the other is told and joins it.
- **After each show:** when everyone's gone, the autopilot fades out and stops recording; once nothing's still being sent (or 3 minutes on), the screen thanks them and starts a fresh show with a new code, waiting for a name. The old one is deleted (phones keep what they recorded). A show also deletes itself 12 hours after it started.

**Events kept apart on phones**
- **My events lists each event by name, when, and code** ("Test · Oct 6, 9:03 PM · U9AC45"), newest first, so events with the same name are told apart.
- **Codes come round again** once an event's gone: if a phone has things from an older event with the same code, they're moved aside when it meets the new one (still in My events, under the old date), so nothing mixes.

**Tests:** `test/e2e_kiosk.py` (in an iframe: no buttons, the code whole on screen, the first phone names it, the second joins that show, a fresh show with a new code once everyone's gone, the old one deleted); `test/e2e_eventsapart.py`; `test/core.test.mjs` covers naming (once, terms remade with the name, ordinary events can't be renamed this way).

## 0.32.0 — autopilot, recording with the fades, a kiosk for signs, screens and computer sound
**Deploy:** `./aws/deploy.sh`. **The server changed** (kiosk shows that delete themselves after 12 hours; the host can delete an event); same command, no new AWS resources.

**Autopilot: the show runs itself** (Output, in the studio)
- With no camera the program sits at black. When a camera arrives (picture steady for 3 s): the intro clip (if chosen) plays, the program fades up and records, the auto director takes over, and that camera's name goes up on a lower third.
- Each camera that arrives later is queued: in preview (PREVIEW on its phone), then it dissolves to air with "joined the show". The auto director doesn't take it before it's been welcomed.
- When no camera's been here for the time chosen (15 s to 3 min), the program fades to black, the recording stops (kept in this browser and in Media; no download, no pop-up), and each phone gets its part of the live cut. Then it waits for the next camera.

**Record the program with the fades** (Output): fading up from black starts Record program; fading to black stops it. Off by default; Record program by hand works as before.

**Kiosk: a screen people walk up to, or a digital sign** (`/kiosk`)
- Name the show and Start the show. The studio opens stripped down: the cameras, the program, the join code (the beacon) beside them, cameras / clips in / sending, the state ("On air · recording 3:12"), **End show** (then **Start again**) and **Delete show**. The autopilot runs it; the pointer hides when nobody's touching; no menus, pop-ups or downloads.
- **Delete show** deletes it on the server now, and this screen's recordings (phones keep theirs). **If nobody does**, it deletes itself 12 hours after it started, and the screen goes back to the start half an hour after the last camera left. Coming back to `/kiosk` with a show running offers it (and goes back by itself in 5 s), or deletes it.
- **In an iframe on a sign:** `allow="camera; microphone; display-capture; autoplay; fullscreen; screen-wake-lock"` (README). VUEMesh doesn't stop it being framed.

**A screen, a window, or this computer's sound as a source** (+ This computer, Share…)
- A screen or window is a source like a camera, with its sound if the browser shares it. **This computer's sound** keeps only the sound, as a microphone. Windows and ChromeOS share the whole computer's sound; on a Mac, Chrome shares a tab's. The browser asks each time, so they aren't brought back next time.

**Tests:** `test/e2e_autopilot.py`, `test/e2e_kiosk.py` (inside an iframe), `test/e2e_screen.py`; `test/core.test.mjs` covers kiosk shows (12 hours) and the host's delete.

## 0.31.0 — the program as a camera for video calls; phones that recover
**Deploy:** `./aws/deploy.sh` (site only changed since 0.30.0; the relay is part of the site: anyone using it downloads it again for the camera feature).

**The program as a camera in Zoom, Teams or Meet**
- **Stream out → Zoom, Teams or Meet (as a camera)**, through the relay (now version 2). No address or key: the relay makes the camera.
  - **Mac and Windows:** OBS Studio makes the camera. The relay sends the program to OBS on this computer (MPEG-TS over local UDP, `udp://127.0.0.1:9998`, quick to arrive); OBS's Media Source picks it up and Start Virtual Camera makes "OBS Virtual Camera". Sound goes through OBS's monitoring to BlackHole (Mac) or VB-CABLE (Windows), picked as the call's microphone.
  - **Linux:** no OBS: with a loopback camera (v4l2loopback, labelled VUEMesh) and a sound sink named VUEMesh, the relay writes the program straight into them ("VUEMesh" camera, "Monitor of VUEMesh" microphone).
  - **ChromeOS** (and anywhere, with nothing to install): open Program out and Share screen in the call, with its sound.
- The set-up steps for your computer show under it, each command with Copy. The status reads "On as a camera"; the studio says what to pick in the call.

**The live cut on phones**
- **A phone that can't save a part says why**, and the studio's event log shows it ("Live cut part 2 didn't reach Rosa: the phone couldn't save it here: …. Trying again."). It's tried again on the next round.
- **Phones whose browser won't keep the part as a file** (some iPhones refuse certain files in their storage) now keep it as raw data instead; it shows and plays in My events the same way.
- **While a phone waits for its live cut before leaving, its screen is kept on** (a locked iPhone stops receiving). If it leaves with parts still owed, its home screen says how many are waiting and to rejoin (with the screen on) to get them.
- Note: a phone that's recording doesn't take its live cut until it stops (so the transfer never disturbs a recording); the studio shows "waiting on Rosa (recording)".

**Phones that lose the camera**
- **Joining never hangs on a camera that won't start** (a home-screen app reopened, or a phone back from the background): after 8 s it asks again, with Allow, and a Reload VUEMesh button.
- **If the camera stops while VUEMesh is in the background**, "The camera went off" comes up with **Turn the camera back on** (one tap) and Reload VUEMesh, instead of a frozen picture. Clips are kept either way.

**Tests:** `test/e2e_vcam.py` (the relay to a stand-in for OBS: H.264 1280×720 + AAC over local UDP); `test/e2e_phonerobust.py` (storage that refuses the part, a camera that stops, a camera that never answers on join). `test/e2e_whip.py` knows the new video-call group.

## 0.30.0 — dissolves in Edit, and a quarter-second dissolve
**Deploy:** `./aws/deploy.sh` (site only changed since 0.29.1).

- **Edit has dissolves.** A dissolve into a shot: the shot before it carries on underneath (from its recording, past its end) while this one fades in over it, and camera sound crossfades with the picture, in playback and in the exported film.
- **Live dissolves arrive in Edit as dissolves**, as they were made: on the shot they went into, from when they began, and as long as they took (AUTO or the T-bar, cameras or clips).
- **To make sure both shots are recorded through a dissolve**, the incoming camera is on air from the moment the dissolve begins: its tally comes on and it starts recording then (phones, and this computer's cameras), as on a real switcher.
- **Add, change or take off a dissolve:** right-click a clip on the timeline (**Dissolve in**), or **Dissolve in** in the Selection panel: Cut, ¼, ½, 1 or 2 s (plus the live length, if it came from live). The timeline marks it with a shaded corner at the start of the shot. A split keeps it on the left half only.
- **The switcher's AUTO has ¼ s** as well as ½, 1, 2 and 3 s.
- Tests: `test/e2e_dissolve.py` (a live 1 s AUTO dissolve lands in the edit as long as it took; halfway through, both cameras play with their sound at half each; ¼ s and Cut from the Selection panel; a render through it); `test/sequence.test.mjs` covers the model (live dissolves through the automatic edit, the sound crossfade, splits, never longer than the shot).

## 0.29.1 — every time on air makes Edit, second takes included
**Deploy:** `./aws/deploy.sh` (site only changed since 0.29.0).

- **A second take could be missing from Edit.** Two causes, both fixed:
  - **The automatic edit only followed a camera into a new recording if it started right where the last one ended.** A camera that stopped recording and started again while still on air (after a break, or a second take) was dropped until the next cut. Now the edit stays with the camera on air and picks it up again wherever it recorded; the time between is a gap.
  - **Once the timeline had been edited by hand** (Collapse gaps, a trim, a move), new live footage never reached it. Now it goes on the end of the timeline, after a gap as long as the real time since the last part, with its microphone sound lined up; Collapse gaps takes the empty time out. Your hand edits stay as they are, nothing is added twice, and it waits until the clips have stopped arriving so cameras land together. Undo takes it back off.
- **Edit shows the whole timeline** when it has grown since you were last there.
- Tests: `test/e2e_secondtake.py` (this computer's camera: a take with a break, Collapse gaps, a second take, then Edit puts it on the end after the real gap, and Collapse gaps closes it up); `test/sequence.test.mjs` covers adding after hand edits (gap kept, mic lined up, nothing twice, only the new part of a recording that spans the end).

## 0.29.0 — anything aired makes Edit
**Deploy:** `./aws/deploy.sh` (site only changed since 0.28.1).

- **A camera on this computer records whenever it's on air**, whatever "Cameras record while they're on air" says (that setting is for phones' storage).
- **Going to Edit finishes the recordings in progress**, so what's been on air is there now, even if a camera is still on air: this computer's cameras and microphones roll to a new recording, and phones that are recording are asked to do the same (each keeps recording; a phone's part arrives as it sends). Ending Record program does the same.
- **Clips that aired go into Edit where they aired:** the live cut cuts to the clip, and a copy of its file is placed at that time (one per time round if it loops), with its sound on Camera sound. Stills aren't in Edit yet.
- **Record program's recording goes into Media** as "Program (as aired)", on the cameras' clock, for shots by hand (titles, slates, anything that aired). It stays out of the automatic edit and out of Auto-sync.
- **Auto-sync:** this computer's recordings count as locked (they're on the studio's own clock); aired clips and the program recording aren't lined up by sound.
- Tests: `test/e2e_aired.py` (with the phones' setting off: camera, clip, camera on air, straight to Edit with the camera still on air, and the program track has all three; the program recording in Media, not in the edit).

## 0.28.1 — this computer's cameras keep their sound in Edit
**Deploy:** `./aws/deploy.sh` (site only changed since 0.28.0).

- **A camera on this computer could record without its sound** (the live picture had sound; the recording in Edit didn't). Its recordings were made in the studio's program format (on a Mac, MP4 with AAC sound), and that recorder can drop a live microphone. They're now recorded as WebM with Opus sound first, the steadiest way a browser records a live mic; they play in Edit and export the same.
- **Every recording from this computer's cameras is checked for its sound.** If a format ever comes out without it, the studio says so (in the event log and on screen) and the next recordings use another format.
- **Diagnostics: a new "Edit sound" section:** each sound track (level, muted, whether Camera sound follows the picture and ducks under microphones), how much of the film microphone recordings cover, and, for the latest recordings, their format and whether they have sound.
- Tests: `test/e2e_local.py` now plays the camera's recording in Edit and checks its sound, and reads the new diagnostics.

## 0.28.0 — clips cue in preview
**Deploy:** `./aws/deploy.sh` (site only changed since 0.27.1).

- **With Tap: Preview, clicking a clip cues it in preview:** paused at its first frame, with a green outline on its tile and "PREVIEW · CLIP … · cued" in the preview box. It stays there until you take it.
- **It starts playing as it goes on air:** when the dissolve to it begins (AUTO or the T-bar), or when CUT puts it on air. Its sound fades in with its picture; a clip going out fades its sound out with its picture. A T-bar pulled back before the end puts the clip back at its start, paused.
- **Flip-flop with clips:** going from a camera to a clip puts the camera in preview; going from a clip back to a camera puts the clip back in preview, cued at the start again. While a clip is on air, the camera under it can be put in preview.
- **Tap: Air** still puts a clicked clip straight on air from the top, as before.
- Tests: `test/e2e_clipcue.py`.

## 0.27.1 — a camera on this computer brings its sound
**Deploy:** `./aws/deploy.sh` (site only changed since 0.27.0).

- **A camera added with + This computer comes with its sound**, as a phone does: one source, picture and sound, with its own mixer strip, and its recordings carry the sound. Which microphone: the one in the same device (a USB webcam's own mic, which the browser groups with it), else one whose name matches the camera's, else this computer's own microphone (a built-in camera like the FaceTime HD Camera has no mic of its own). The picker shows it under **Sound** for each camera; pick another, or **No sound**. Cameras added before come back with the sound they had.
- If the camera's microphone isn't available (busy, unplugged), the camera is added without sound and says so, rather than not at all.
- Pressing Add twice no longer tries to add the same camera twice.
- Tests: `test/e2e_local.py` checks the camera brings sound (a live sound track and its own mixer strip) and that its recording has the sound in it.

## 0.27.0 — this computer's cameras and mics, moderation, the new terms
**Deploy:** `./aws/deploy.sh`. **The server changed** (the event keeps a blocked list, and signaling turns blocked phones away); the same command deploys it, no new AWS resources.

**Cameras and microphones on the studio computer**
- **+ This computer** (under the sources) adds the built-in camera, USB cameras or capture cards, and microphones. They're sources like phones: a tile marked THIS PC with a number, on air or in preview, Camera control (through the camera's own zoom, brightness and contrast, where it has them), and the mixer.
- **No beacon needed:** they run on the studio's own clock, so their recordings line up in Edit from the start.
- **Recording:** a camera records while it's on air (with "Cameras record while they're on air"), or right-click it for Record until you stop it; a microphone records the whole time it's in the show. Recordings roll every 5 minutes and land in Edit like phones' clips. Right-click to rename or remove; they come back next time the studio opens (when the browser remembers its permission).

**Moderation**
- **Remove from the event…** (right-click a camera or microphone): **Remove** (their phone is told and leaves; they can rejoin) or **Remove and block** (they can't rejoin this event: the server turns them away and their phone says so; their recordings stay out of the automatic edit, still in Media). **Removed and blocked** under the sources lists them, with **Let back in**. Blocking goes by the phone's identity for this event: someone who wipes their browser data comes back as a new phone.

**The switcher and Camera control**
- **The program shrinks beside the switcher** instead of being covered by it.
- **The preview box goes away** with Tap: Air, when the switcher closes, or once its source is on air (it used to freeze), and **never shows in Edit**.
- **Camera control shows PAUSED** when a phone pauses its feed, as the studio's tile does.

**The camera**
- **The record button is centred** again (Flip and Pause feed on the left don't push it over).

**Terms of Use**
- **Your new terms** (October 4, 2026) replace the old ones, including the usage-counts paragraph. Because they changed, phones ask people to agree again (the agree box isn't pre-ticked until they do).

**Tests:** `test/e2e_local.py`, `test/e2e_v27.py`; `test/core.test.mjs` covers blocking (refused at connect, only valid ids kept, only the host can block, let back in).

## 0.26.0 — a switcher with preview and a T-bar, a bank of camera controls
**Deploy:** `./aws/deploy.sh` (site only changed since 0.25.1).

**The switcher** (⇅ beside the program, like the sound meters ♪)
- **Tap: Air / Tap: Preview.** Air keeps the old way (tap a source, it's on air). Preview puts a tapped source (or its number key) in preview: a green outline on its tile, a preview box in the corner of the program monitor (only on this screen, never in the program), and a green PREVIEW tag on the phone. Right-click a camera for **Put in preview** either way.
- **CUT** (Shift+Enter) takes preview straight to air. **AUTO** (Enter) dissolves over 0.5, 1, 2 or 3 s. **The T-bar** dissolves by hand: push it from one end to the other (it rests at whichever end it last reached, like a real one); stop halfway and both pictures are on air. It glides, eased every frame like the phones' zoom, so a mouse, a finger or a fader gives a smooth dissolve, never steps.
- **MIDI fader:** press it, move a fader on any MIDI controller, and that fader is the T-bar (remembered).
- After a transition, what was on air goes to preview (flip-flop). Cameras on AFV crossfade their sound with the picture. Edit starts from a cut at the middle of each dissolve (dissolves in Edit come later).

**Camera control**
- **A bank of strips:** narrow camera strips side by side, like a truck's camera controls, with a **Strip width** slider (remembered).
- **Message the person on each camera** from their strip (the same message the studio's box under the tile sends).

**The camera**
- **Pause feed moved to the left**, beside Flip, so the zoom rail has the whole right side.
- **The full-screen button is gone** (phones go full screen from their own home-screen app; the button rarely did anything).

**Tests:** `test/e2e_switcher.py` (preview, AUTO's length and landing, the T-bar held halfway then pushed through, CUT, Tap: Air, the Camera control strips and a message). `test/e2e_camera_pro.py` no longer looks for the full-screen button.

## 0.25.1 — the terms say what's counted
**Deploy:** `./aws/deploy.sh` (site only changed since 0.25.0).

- **Terms of Use, What we store:** now describe the anonymous daily usage counts added in 0.25.0: what's counted, that the studio sends its event's running totals, the one-way code that counts a rejoining phone once per event (kept with the event and deleted with it), that the totals identify no one and no event, that they're kept past 30 days, and that they may be shared (for example with investors). "No analytics" now reads "no third-party analytics"; the 30-day deletion is now worded as everything stored about an event. The terms page shows the version (0.25.1), which dates the change.

## 0.25.0 — growth numbers, with the 30-day policy intact
**Deploy:** `./aws/deploy.sh`. **The server changed this time** (the same command deploys it; no new AWS resources, the existing table holds the counts).

- **Anonymous day counts, kept:** one record per day of events created (by kind), events run (a studio opened that day), cameras, microphones and viewers joining (each once per event: a phone's camera id is hashed and kept on the event, so it goes when the event does), recordings received, hours of footage, live cut and streaming, and films published. They never expire; events and everything in them still delete themselves after 30 days. Nothing in a day's counts names a person, phone, place or event.
- **The studio reports its event's running totals** (recordings, footage, live cut and streaming time) every 10 minutes, a minute after a recording arrives, and when it closes; the server adds only what's new, and a smaller report (a studio on another computer) never subtracts.
- **Admin → Growth:** the chosen period (30 or 90 days, 12 months, or since counting began) against the one before with ▲▼%, cameras per event run, a chart with the running total (by day, or by week over 120 days), a month table, **Download CSV**, **Investor snapshot** (a printable one-pager with both charts and how it's counted: Print, then Save as PDF), **Save snapshot** (freezes the numbers for the record; Open shows that report again), and **Fill in earlier days** (counts the events still stored into days from before counting began; never counts a day twice).
- Tests: `test/e2e_growth.py`; `test/core.test.mjs` covers the counts (once per phone per event, only new usage, nothing identifying), that they outlive the events, backfill and snapshots.

## 0.24.0 — edit sound, recordings that keep moving, a gentler start on the phone
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick it up when they next load the page.

**Fixed**
- **No sound in Edit once a microphone had joined.** Camera sound was set to silent for the whole film, so anything the microphone didn't cover had no sound at all. Now it ducks: it steps aside only while a microphone recording plays, and is heard everywhere else (in Edit and in the exported film). A **Duck** switch on Camera sound (Edit mixer and Audio console) turns that off. Edits saved in the old silent state are moved over, unless you'd set the track yourself.
- **A second program recording could freeze its picture** (the sound went on). Record program, the live cut, streaming and Program out now share one program picture whose frames are pushed on every redraw, so it keeps moving even when the studio window is hidden or covered (Program out full screen over it).
- **Typing the event code:** capitals and digits only as you type (spaces, dashes and autocorrect can't slip in), and a clear message if it isn't 6 characters.
- **Leaving with the live cut:** the phone waits up to 10 s for the studio's answer (saying so, with Leave now), and leaves after 45 quiet seconds; anything not finished comes on rejoin. While sending parts, the studio keeps responding.

**On the phone**
- **Guided setup:** the browser's questions come one at a time, each after a screen that says what it's for (camera and microphone; then motion on iPhones), and only when the browser is actually going to ask. A phone whose browser remembers goes straight to the camera.
- **You're in control:** a one-time card says what the director can do and where to change it (it gets out of the way for a director's message, and goes by itself after 20 s). Settings lists the cameras the director may switch to. **The selfie camera is kept from the director unless you allow it**; a request for a private camera is refused and the phone says so.
- **Pause feed** stays available on air (that's when it matters).
- **A new lens starts at 1×** (zoom isn't remembered per lens).
- **Rejoin as camera / Rejoin as microphone:** two buttons after leaving. The one you were is highlighted and is one tap; the other opens the event's join screen with that role chosen.

**Landing page and help**
- A "Then make it bigger" section: more screens for the control room, and going live anywhere (some services straight from the browser, the rest with a small helper set up once with a few copy-and-paste steps).
- Help: a new "More screens" topic; Microphones on air and Camera control now show their headings; Only microphones, Stream out and Audio console brought up to date.

**Not in this release:** the watch link (where people can watch the stream, on phones and the beacon). It needs a server change and isn't verified yet; it comes in a later release.

**Tests**
- New: `test/e2e_editaudio.py`, `test/e2e_v24.py`, `test/e2e_rejoin.py`. Updated for this release's behaviour: Pause feed on air, Rejoin's two buttons, the live cut's rejoin fallback, and waits that suit a slow machine.

## 0.23.0 — microphones on air (podcasts)
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick it up when they next load the page.

- **Microphones are live sources:** each microphone phone has a tile in Sources with a number (after the cameras'). Click it or press its number to put it on air: the program shows its sound and its name ("ON AIR · MIC 4 Ana"), and the phone shows ON AIR (red frame), like a camera's tally. In the mixer a microphone stays ON (always heard) unless set to AFV (heard while on air) or OFF.
- **The auto director for sound:** with no cameras up and two or more microphones, A goes to whoever's talking (louder by about 4 dB, held at least 2.5 s), from each microphone's own level before its fader.
- **No break slate while there's sound:** with no camera up, the first microphone goes on air by itself; and while a microphone is live, a camera dropping puts the sound on air instead of the break slate. The break slate comes on by itself only when there's nothing to show or hear (B still puts it up by hand).
- **The Edit page no longer shows the live AUTO BREAK tag.**
- Edit still starts from the camera cuts: a microphone on air doesn't change the picture there.
- **Fixed:** deleting an event on a phone right after leaving could leave one clip behind (the clip that was still being finished was saved after the delete).
- Tests: `test/e2e_v23.py`. The microphone test now expects the microphone on air when the camera drops; the audio test accepts the studio waking its own sound.

## 0.22.0 — a sturdier media engine, a quieter studio, Pause feed
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick it up when they next load the page.

**Recording**
- A take stopped about a second after the phone turned could come out 0 s long (and drop out of the edit): a clip's length came from the recorder's start and stop events, which arrive late on a busy phone. Now it comes from the recording itself, ending when it was told to stop; the start time and the orientation log move to match.

**The media engine**
- The studio now follows every track a phone sends, not just the first: sound that arrives after the picture, a track that's swapped or ends. The mixer listens to the sound track itself, so a late or replaced one is always the one heard (before, the sound could stay silent until the studio was reloaded).
- A sound watchdog every 2 s keeps each phone's player and the audio engine running, and rebuilds a sound source that has given pure digital silence for 8 seconds (real microphones always hiss a little).
- Camera control's drawing can't stop: each camera is drawn on its own, so one camera's trouble (a picture not ready yet, a phone that just left) no longer freezes the window (the waveforms that only showed after a reload).
- The live program is drawn 30 times a second, the rate it's captured at, instead of the screen's 60: half the work, and the studio stays responsive when clips arrive.

**Camera control**
- Each camera's cameras are listed (front, ultra wide, wide, tele…): pick one and the phone switches to it.
- Brightness and contrast now reach the studio from iPhones too. Safari can't filter a canvas, so the live picture ignored them there (the phone's own viewfinder showed them); now they're done by blending: brightness exactly, contrast within a few levels.
- The Camera control button stays one line at any width.

**A quieter studio: transfers and news in the Monitor**
- No pop-ups for clips arriving, and no "Receiving…" line in the top bar (it moved the layout as it came and went).
- The Monitor button has a light: blue (pulsing) while recordings come in or parts go out to cameras, amber when there's news in the event log since you last looked. Looking at the Monitor puts it out.
- The Monitor's transfers: Coming in from phones, Going out to cameras (their part of the live cut), each with progress; Received, with a thumbnail, Preview (plays right there) and Download; and Sent to cameras.

**The camera**
- Save is gone from the viewfinder (every clip is in My events, to watch, send again or save). In its place, **Pause feed**: stop sending your picture and sound to the director for a moment (the same as Live off in the event sheet). It's only offered when you're not on air and not recording.

**Tests**
- New: `test/e2e_v22.py`. The tests that waited for the studio's "arrived" pop-up now wait for a quiet arrival signal; the devices test reads the Program meter's level directly; the media test closes its phones before exporting; the audio console test waits for the edit's sound to start.

## 0.21.0 — camera control from the studio, and a zoom you can grab
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick it up when they next load the page; Camera control needs the phones on 0.21.

- **Camera control window** (Sources → Camera control ↗, or right-click a camera): every live camera's picture with a histogram (R, G, B and brightness) and a waveform, and a warning when whites clip or blacks crush. The scopes are worked out in the studio from the pictures it already receives, so phones do no extra work.
- **The director can adjust each camera remotely:** zoom (the phone glides there), brightness (the camera's own exposure where it has it, else digital), contrast (digital), focus by clicking a point in the picture (like tapping the phone), AE/AF lock, white balance lock, Auto to put it all back, and Cut. The phone shows each change ("The director adjusted this camera: zoom 2.0×"), and its owner can turn remote control off in the camera's settings ("Let the director adjust this camera").
- **Digital contrast** joins digital brightness: in the live picture, on the phone's viewfinder, and logged with native recordings so the edit plays it too; the recording itself stays as shot.
- **The zoom rail is easy to grab:** an invisible touch pad about three times the slider's width runs the length of the rail. Put a thumb anywhere on it and drag (up to zoom in); double-tap for 1×.
- **Every zoom glides,** from the rail, a pinch, a lens chip or the director: eased every frame in equal steps of magnification, like a zoom lens, never in notches. A native zoom is sent to the camera as fast as it takes it (always the latest value); a digital zoom moves with every frame, and is logged up to 30 times a second so the edit's zoom is smooth too.
- Tests: `test/e2e_ccu.py`.

## 0.20.3 — fewer "Allow" questions
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick it up when they next load the page.

A page can't give itself permanent permission to the camera and microphone: the browser decides. Chrome, Edge and Firefox remember once you choose to; Safari on iPhone and iPad asks on every visit until the site is set to Allow in its Website Settings (and iPhones ask about motion on every visit, with no way to keep it). So:
- **Scanning the beacon from the camera's home joins on the same page.** It used to load a new page, and an iPhone asked for the camera a second time.
- **Someone coming back whose browser is going to ask again gets the steps to make it remember, once, on the join screen:** Safari's Website Settings on iPhone and iPad (or "only Safari can keep it" in other iPhone browsers), "Allow while visiting the site" in Chrome and Edge, "Remember this decision" in Firefox, or how to unblock a blocked camera. "Got it" puts it away for good; a browser that already remembers never sees it.
- **The studio's blocked-window message** (Program out, Audio console) now says how to always allow this site's windows, so it only happens once.
- Tests: `test/e2e_permtip.py`.

## 0.20.2 — a mixer with no empty space
**Deploy:** `./aws/deploy.sh` (site only changed).

- The Live audio mixer is now always exactly as tall as its strips when they lie flat, even if its edge was dragged before (0.20.1 kept a dragged height, empty space and all, and wouldn't drag below 120 px). With no phones it's one row for the program; each phone adds a row. Drag its edge up past 175 px and the strips stand up, faders upright, at the height you drag to; drag it back down and it snaps to fit again. Double-click the edge to fit.
- Tests: `test/e2e_v201.py` also checks a mixer dragged tall before, dragging it up (strips stand up) and back down (fits again).

## 0.20.1 — clips that keep up with the show, and polish
**Deploy:** `./aws/deploy.sh` (site only changed). Phones pick up the new upload pacing when they next load the page.

- **Clips upload as fast as the network allows, while live.** v0.19 held a live camera's clip uploads to a fixed trickle, so clips crawled until you turned the camera's live picture off by hand. Now uploads pace themselves like the internet's own congestion control, watching the live picture: a little faster every second while the picture stays healthy, backing off quickly when it shows strain (the round trip grows as the router's queue fills, packets go missing, or the browser holds the picture back for bandwidth). Nothing to switch by hand. The phone notes in its diagnostics when it eased off, and reports its upload rate to the studio.
- **RTMP relay set-up for each computer.** Stream out shows the steps for Windows (winget), Mac (Homebrew), Linux (apt) and ChromeOS (the Linux development environment), opening on the one you're using, with Copy buttons for each command.
- **The Live mixer fits its strips:** no empty space below them. Drag its edge to set your own height (tall enough, and the faders stand up); double-click the edge to fit it again.
- **Live has the panel buttons** (left panel, inspector) at the right of the transport bar, like Edit.
- **Program out fills the screen with one click** anywhere on the picture (browsers only allow full screen after a click); Esc, F or the button bring it back.
- **One dark theme:** the home page, beacon, monitor, watch and camera pages now use the studio's neutral black instead of navy.
- Tests: `test/e2e_v201.py`; `test/e2e_controlroom.py` expects the fitted mixer's flat faders.

## 0.20.0 — RTMP streaming
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes). The relay is a separate download for streaming hosts.

- Stream out now has RTMP: YouTube Live, Facebook Live, Twitch (RTMP), Kick, Vimeo, LinkedIn Live, X (Media Studio Producer) and any RTMP or RTMPS server, alongside the WHIP services. Server URLs are filled in where a service has a standard one; paste the stream key and Go live.
- A browser can't send RTMP, so RTMP goes through the **VUEMesh relay**: one small file (`relay/vuemesh-relay.mjs`, downloadable from Stream out) that runs on the studio computer with Node.js and ffmpeg, nothing else to install. The studio records the program in quarter-second pieces and passes them to the relay over a WebSocket; ffmpeg sends them on as H.264 (2-second keyframes, constant 30 fps) and AAC, as services want.
- The studio checks for the relay and says plainly if it's missing or has no ffmpeg; while live it shows the rate ffmpeg is sending at, and says so if the computer can't keep up.
- The relay listens on this computer only, takes connections only from VUEMesh pages, only sends to rtmp:// and rtmps:// addresses, and never prints the stream key.
- Tests: `test/e2e_rtmp.py` streams through the relay to an ffmpeg RTMP server and checks what arrives (H.264 + AAC); `test/e2e_whip.py` checks the WHIP path on its own.

## 0.19.0 — comings and goings, microphones alone, the live cut that gets there, sound sync, streaming out
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Leaving and rejoining**
- Leaving an event, as a camera or a microphone, goes back to the camera's home (join by code or scan, the camera on its own, My events), with the event you left at the top and a one-tap Rejoin. The separate "You've left" screen is gone.
- The microphone screen has Leave the event (stopping the recording first, if it's running; what's not sent yet goes when you rejoin). Rejoin brings it back as the microphone and, if it's still synced, locks straight back in.
- Coming back later (after a reload, or the next day), the home offers the last event; the join screen remembers whether you were the microphone.

**My events** (was My footage)
- Shows how many events and clips are on the phone. The Show tab can delete a whole event from the phone: its clips, the live cut, messages, rundown and the rest (it warns about clips the host hasn't got yet).

**Sync with the beacon, and by sound**
- The phone stops telling you to aim at the beacon for each clip; "Synced" now says you're set. Every clip carries its beacon lock (when it was read), the studio counts it, and a phone that never synced is marked NO SYNC on its live tile.
- Auto-sync no longer says "No clips include a shot of the beacon": it says how many clips are locked, fine-tunes any with the beacon in shot, then lines clips up by their sound (GCC-PHAT cross-correlation at 8 kHz, to a fraction of a millisecond), starting from the most trustworthy clip (beacon in shot, then a synced microphone). A microphone that was off from the cameras now lines up with them. In an edit you've cut by hand, the moved clips' pieces keep showing the same moments; undo puts it back.

**Microphones on their own**
- A microphone is heard with no camera live. Chrome only passes a remote stream's sound to Web Audio while a media element plays it; cameras had their tile, microphones had nothing, so they were silent until a camera joined. Every stream now gets a muted player.
- With no camera picture and a microphone open, the program shows the sound: a rolling waveform, spectrum bars or a ring (Breaks and black), with the event and who's talking.

**The live cut gets to everyone, without crowding the show**
- Someone leaving during Record program is sent their part first: the studio finishes the part being recorded if they were in it, and their phone waits for it, showing how far each part has got (with Leave now). Before, the last part was made after they'd gone, so they never got it unless they rejoined.
- A sending pass worked through the list of parts while new parts kept being added, so with a long backlog it could run on and on and some phones never got a turn. Each pass now works from a fixed list, and someone leaving cuts in at the next part. A phone that said it was leaving no longer counts as "there" while it waits for its copy.
- The studio asks each phone before sending (one that's recording, sending its own clips or short of space says "not now" and gets it later) and holds transfers to 2 Mbit/s while the show is live (1 Mbit/s to the camera on air). The studio says who's still owed and why.
- Phones pace their own clip uploads by WebRTC's estimate of what the link can carry: a trickle while on air, part of what the live picture leaves spare while live, full speed otherwise.

**Tests**
- New: `test/e2e_v19.py`. Tests that waited for clips to arrive now keep checking until they do, since a live camera paces its uploads.

**Landing page**
- A "What you need" section (and menu link): a decent Wi-Fi router, a laptop, desktop or tablet to host, then the phones (or your own fixed cameras) show up; plus a note that the video goes over the Wi-Fi, so a slow internet connection is fine. "How it works" now says guests scan the beacon once to join and sync, instead of glancing at it on every recording.

**Stream out**
- One streaming output from the Live inspector: the program, picture and mix, sent from the browser over WHIP (RFC 9725). Templates for Twitch (direct), Restream (to YouTube, Facebook, LinkedIn, Kick and more), Cloudflare Stream, Dolby OptiView, and any WHIP server; YouTube and Facebook entries explain the relay they need (a browser can't send RTMP, and WebAssembly can't open the sockets either). 2.5 / 4.5 / 6 Mbit/s, H.264 first, the key kept on this computer, a STREAMING badge in the top bar.

## 0.18.0 — sound on both sides, moments that stay put, the audio console
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes). Phones pick up the sound fix when they next load the page.

**Sound on both sides**
- Some phone browsers hand a mono microphone to the page as "stereo" with a silent right side, so clips came out left-only (the Source monitor's right meter stayed flat). Phones now play the left on both sides until the microphone shows it really has a right channel; a phone with stereo microphones records true stereo (VUEMesh now asks for two channels). Clips say which they are.
- The studio fixes clips already recorded left-only: the Source monitor, Edit playback and Render MP4 fill the empty side from the left (true stereo clips are left alone). Live strips do the same for phones still on the old version.

**Moments and markers stay on their footage**
- A moment keeps the event-clock time it was marked at, and a marker (added over footage) the time of the footage under it. They're placed wherever that footage now sits, so Collapse gaps, trims, moves, ripple deletes and speed changes carry them along, and undo brings them back. Before, moments were placed by the clock alone, so they drifted off their footage as soon as the edit moved anything.
- A moment where no camera was recording sits by the footage either side of it, faded; if its gap was taken out, it sits at the cut.
- Dragging a moment or marker re-anchors it to the footage you drop it on.

**Audio console (pop-out)**
- "Audio console ↗" in the Edit mixer and on the Live mixer dock opens a window for mixing. Each channel (each phone and the Clips in Live; each audio track in Edit) has AFV / ON / OFF or Mute / Mono, a high-pass at 80 Hz, low / mid / high EQ (±12 dB) with its curve drawn, balance (centre stays at full level), a big meter with peak hold, and a fader.
- The output side shows L / R meters, peak, RMS level, balance and phase correlation, a spectrum, the waveform, and a stereo (vector) scope. Quiet sound is scaled up to be seen.
- It follows the room: switch Live / Edit and it switches with you. Changes go to the same sound engine, so they're in the program recording (Live) and in Render MP4 (Edit, where EQ and balance are saved with the edit). Double-click any control to reset it. The studio's keys work from the console window (1–9 to cut, B, X, T, M, `).

**Fixes**
- The Clips strip's fader in the Live mixer didn't change the level of a clip that was already playing.

## 0.17.1 — timing that stays locked, and full screen in your theme
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes). Phones pick it up when they next load the page.

**Sync with the beacon once**
- Once a phone has synced, the timing is locked in for as long as the page runs. New clips no longer ask anyone to aim at the beacon: not when the director's cut starts a recording, not after fade to black stops it and you come back up, not after leaving and rejoining or reloading the page.
- It still glances for the beacon quietly in the first seconds of each clip, with nothing on screen, in case it's in shot (that sharpens the studio's Auto-sync).
- It's forgotten only if the phone's clock slips: it slept, or the browser froze the page in the background. The phone notices the jump, says so once, and looks for the beacon again. A quick trip to another app that doesn't stop the clock keeps it.
- Tap the Synced pill to take a fresh reading (worth it every few hours: phone clocks drift a little). The old timing stays in use until three new readings are in.

**Full screen keeps your theme**
- In light mode, full screen stayed light only until you entered it, then switched to a dark blue look that isn't one of the themes. The control room now keeps your theme: light stays light, dark is the studio's black.
- The studio also follows the device properly when the theme is set to follow it (it used to stay dark on a device set to light).
- The meter bridge's strips and buttons are neutral black and grey, like the rest of the dark studio, instead of navy. The theme button is available in full screen too.

## 0.17.0 — black, slate looks, editable moments and markers, pictures that don't stick
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Fade to black**
- Fade to black (X) and Black (Shift+X), next to Break. The whole program goes black, picture and sound together; the program recording, Program out and the live mix all follow. Fade time is under Breaks and black (½ to 3 seconds).
- Once it's black, the lower third, any clip and the break come off air. Press again (the buttons now read Fade up and Cut up) to come back on the camera you were on. Cameras show off air while it's black. Cutting to a camera while black lines it up and reminds you how to come back up.

**Break slate looks**
- Choose the look under Breaks and black: color bars (as before), static (snow with a rolling band), Please stand by (an old television set), a test card with a running clock, a VHS blue screen (PLAY, a counter of how long the break has run, the date, tracking noise), or a station clock whose dots light up as the minute goes round. Your message and the event's name sit on every one, and a small preview shows it as you choose. "Starting soon" uses the same look, and slates on the Edit timeline have their own Look setting, which renders too.
- Slate sound (off by default): the 1 kHz line-up tone with color bars, hiss with static. It goes into the program (and the recording) only while the slate itself is up, not the sponsor reel, and fades with black.

**Lower thirds**
- Each saved lower third has an ×. Right-click one to show it, edit it without putting it on air (showing the edit replaces it instead of adding another), or delete it. The one on air is outlined. Up to 16 are kept.

**Moments and markers**
- Live has a Moments list: everything marked with M, newest first. Click a name to rename it; × deletes it.
- On the Edit timeline, markers and moments show their names on the ruler. Drag one to move it (it snaps); double-click it, or select it and press Enter, to rename it; Delete removes it. Right-click for: go to it, rename, move it to the playhead, delete, and for moments, make clips from every angle or show it in Media. Marker edits undo.
- Renaming a moment in the Media inspector now updates the ruler as well.

**Rundown**
- Next ▶ on the last item ends the rundown, and End does it any time: it comes off every camera's screen, but phones keep it (marked ended, at the item it reached) in My footage. Prev or Next picks it back up.
- Clear empties it in the studio and on every camera, including phones that were away when you cleared it.

**Live pictures that get stuck**
- The studio checks every live picture every two seconds and fixes just the part that's stuck, without a reload:
  - the tile's player has stopped, or shows nothing while video is still being decoded: a fresh player is swapped in once it has a frame, so the program doesn't blink;
  - video arrives but stops decoding, or the phone is drawing its picture but it isn't getting through: that one phone reconnects (at most every 45 seconds; after three in five minutes it stops and asks you to check the phone).
- Each fix is written to the Monitor log and to diagnostics, saying which kind it was.
- Right-click a camera tile in Live: Cut to this camera, Refresh picture, Reconnect phone. Refresh live pictures (under Network) does every tile.
- Phones keep their live preview drawing: if the viewfinder stops handing over frames (after a lens change or an interruption), the drawing restarts within a second. Phones also report how many preview frames they draw, so the studio can tell a picture stuck on the way from a phone that has stopped.

**Fixes**
- Microphone tiles disappeared from Live after a visit to Edit.
- A phone that reconnected could lose its live picture to a recording-only phone, because the slot was handed on before it got back. It now gets 8 seconds to return, and keeps its place in the queue.

## 0.16.0 — record-only overflow, sharing, formats and diagnostics
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Record-only overflow**
- The studio shows up to a set number of live pictures (Live → Output, 12 by default). Phones that join beyond that record only: no live picture or sound, but every clip still arrives, and their phone says so ("RECORDING ONLY · studio full").
- They're listed under "Recording only" rather than as tiles. When a live camera leaves, the phone that has waited longest moves up automatically; Swap in brings any waiting phone up now (the live camera off air longest steps back; never one that's on air).
- Past about 12 live cameras the studio says that more can stutter.

**Sharing and search**
- A share image (1200×630) for link previews: "Everyone shoots. One film." with the product at work, and a beacon card whose QR code opens vuemesh.com.
- Titles, descriptions, canonical addresses, Open Graph and Twitter/X large-image cards on every public page. Join and watch links show inviting previews but stay out of search; the studio, admin, monitor, program and beacon pages are kept out entirely. Structured data on the home page, robots.txt, sitemap.xml, and home-screen icons.

**Files every phone can play**
- The studio prefers H.264 when it records the program and the live cut. At startup it test-records half a second and reads the real format; if iPhones can't play it (Chromium and Chrome on Linux record VP9), a notice under Live → Output says so and which browsers fix it (Chrome or Edge on Mac or Windows, or Safari on Mac).
- Phones test-play each live-cut part. One they can't play is marked "Can't play on this phone" with the reason, and the player explains instead of showing a broken icon. Save still works.

**Diagnostics**
- Copy diagnostics: in the phone's event menu and My footage, and in studio Help. A report of the version, device, browser, which formats it can record and play, connection, each recording's format and status, and recent errors, to send to whoever helps you. It doesn't include recordings.

**Documentation**
- docs/HOW-IT-WORKS.md and studio Help: the roles and where each runs; one beacon clock per event (any device can show it, but everyone must sync to the same one); what only the studio computer does; why a phone can't be the studio (an iPad might); which browser to use; network, capacity and router advice; record-only overflow; satellite studios (planned).

**Fixes**
- A shooter who stopped recording while on air could have it restarted by the studio after a moment off air (the break slate flashing up during a Wi-Fi hiccup). The stop now holds until they've really been off air.
- The edit could skip a camera's first clip when the phone rolled to a new clip within 5 seconds of a live cut. A cut now belongs to the clip actually rolling at that moment.
- Live-cut parts are confirmed as soon as they're saved, so the next part follows straight away.

## 0.15.0 — the live cut for every camera person, and speed
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes). Includes everything in 0.14.1.

**The live cut, sent to the crew** (Live → Output: "Send each camera the part of the program they were in", on by default)
- Record program still downloads the full-quality recording, and now also keeps a copy in this browser.
- While it records, a lighter copy is cut into parts of a few minutes. Each part goes, over the local link (nothing via the cloud), to every camera and microphone person who was connected while it was recorded. Someone who leaves gets only their part; anything that finished while they were away arrives when they come back.
- On the phone, parts land in My footage as "Live cut · part N, From the director", to watch, save to Photos or Files, or delete.
- The studio shows progress, e.g. "5 parts of the live cut · sent 7 of 7".
- Phones now tell the studio when they leave, so it knows exactly who was there when.

**Speed** (right-click a timeline clip → Speed: 25%, 50%, 100%, 200%, 400%)
- Same content, slower or faster. A slowed clip stretches where there's room; against the next clip it keeps its slot and shows less of its source, so cameras and sound stay in sync. Clips show their speed on the timeline ("1 Rosa · 50%").
- A clip at another speed plays without its sound, in the preview and in the render alike.
- Split, trims, slip, slide, Collapse gaps and exporting In to Out all cut a changed-speed clip at the right source frame.

## 0.14.1 — sound in the editor
**Deploy:** `./aws/deploy.sh` (site only changed).

- The Source monitor's sound now shows on the program meters while it plays (it used to play straight to the speakers, past the meters). You still hear it.
- The right program meter stayed flat: phones record mono and the edit mix is mono, so only the left channel carried sound. The meters now spread mono across both sides, as speakers do (Live's meters too).
- Edit playback could go silent, with the meters dead, in two ways, both fixed:
  - Each clip's sound was wired to its track once, when the clip first loaded; if that track's audio wasn't set up yet, the clip stayed silent for the whole session. It's now checked every frame and fixes itself.
  - Browsers can pause a page's sound (before the first click, or when the audio device changes). Any click or key press in the studio now wakes it, and if sound is still paused while something should be playing, a notice over the monitor says so; click it to turn sound on.

## 0.14.0 — right-click editing, program meters, recording on air
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Edit like an editor**
- Right-click menus (or Shift+F10 / the Menu key; arrows, Enter, Esc):
  - Timeline clips: Replace media with another camera at the same moment (stays in sync) or with the Source monitor clip from its In; Open in Source monitor; Split at playhead; Picture-in-picture (corners, halves) or Full frame; Reset transform; fill or whole shot; Mute this clip's sound; Delete; Ripple delete.
  - Camera tiles and media items: Open in Source monitor; Insert or Overwrite at the playhead; add as picture-in-picture; cut the Program to that camera.
- Picture-in-picture uses the clip in the Source monitor (click any media item to load it), or another camera rolling at the playhead, and says which. Before, it took whichever other camera came first.
- Track targets: the ◉ on a track header is where Insert and Overwrite land.

**Program meters**
- Left and right meters beside the program picture in Live and Edit (never over it). The ♪ button shows or hides them.

**Cameras record while they're on air** (on by default; Live → Output)
- Cut to a camera that isn't recording and it starts. Off air, a recording the director started stops after 8 seconds unless the camera comes back on air. A recording the shooter started keeps going, and a stop while on air holds. The host's choice carries over to new events.

## 0.13.1 — clear of the notch and Dynamic Island
**Deploy:** `./aws/deploy.sh` (site only changed).

- Held sideways, iPhones put the notch or Dynamic Island on the left or right edge, and it covered whatever was there: the microphone meter on one side, the zoom controls on the other. Every control and screen on the camera page now keeps clear of the safe areas the phone reports: the meter, zoom rail, top and bottom bars, notices, status line, My footage, the player, microphone mode, the join and scan screens. Held upright nothing moves.
- Sideways, the "Point at the beacon screen" guide sits inside the framing square instead of running into the record button.

## 0.13.0 — export a range, collapse gaps, the camera on its own
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Editing a long day**
- In and Out on the timeline: with the Program monitor showing, press I and O to mark a range (an amber band on the ruler). Render exports just that range ("Render In to Out"); Alt/Option+X or "Clear in/out" goes back to the whole timeline. (With the Source monitor showing, I and O still mark the source clip.)
- Collapse gaps (timeline toolbar): takes out every stretch where no camera was recording, on all tracks at once, so sound stays in sync with picture. Sound after the last picture stays. One step to undo.

**The camera page**
- Scan the beacon to join: on the event-code screen, "Scan the beacon instead" opens the camera and joins the event from the beacon's code. No typing.
- Use the camera on its own: the same camera app and controls with no event. Clips are saved to My footage ("On my own"), so people can get used to the app before they shoot at an event.
- The theme toggle is now a small symbol (◐ follows the device, ☀ light, ☾ dark) on every page, so it no longer crowds the event title.

## 0.12.0 — real resolution recordings, microphone choice
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Recordings at the resolution you chose**
- Phones now record the camera's own picture at the quality picked in settings (1920×1080 at 30, 1080p60, or 4K), like any camera app, at a bitrate to match (about 12 Mbps at 1080p30). Before, they recorded a 1440×1440 square that the phone redrew every frame: the shot inside was really about 1440×810, frames were lost to the redrawing (22 fps on an iPhone 17 Pro Max), and it was only 6 Mbps. The square now only feeds the small live preview to the director.
- Turned mid-take with rotation lock on, the picture is stored as the sensor gives it and the clip remembers how to stand upright. The studio, renders and the My footage player straighten it, and Save writes the turn into the MP4 (the way iPhone camera files mark portrait), so Photos shows it upright — no re-encoding.
- Turning the phone or switching lenses mid-take carries on in a new clip. The new one starts before the old one stops, so they overlap rather than leave a gap, and the edit follows the camera from one clip into the next.
- Digital zoom and digital exposure (on cameras that can't do them natively, like iPhone exposure) are no longer baked into the file: the studio applies them from the clip's log. A clip saved straight from My footage doesn't include them.
- Files are bigger: about 90 MB a minute at 1080p30, about 370 MB a minute at 4K.

**Microphone mode**
- Choose the microphone (a lav, a USB mic, a headset). The list updates when one is plugged in. Before recording it switches straight away; while recording it carries on in a new piece from the new microphone, overlapping the last, so nothing is lost.

**My footage**
- The room-code screen (the camera page with no event) offers My footage when the device holds clips, opening on the event with footage.

**Editor**
- When the selected clip isn't under the playhead, the inspector says why there are no handles on the viewer.

## 0.11.0 — My footage, and delivery that can't jam
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Delivery fixes (why a recording sometimes didn't make it)**
- A clip the host refused used to stay at the front of the phone's queue, holding up every clip recorded after it until the connection dropped and came back. Now it's set aside, marked "Didn't arrive" with the reason, and the rest keep going.
- If the host never confirmed a clip while the connection stayed up, sending stopped for good. Confirmation now has a deadline that scales with the clip's size.
- Clips that didn't arrive retry by themselves up to three times, further apart each time. A dropped connection still resumes the same clip, as before.

**My footage (camera people)**
- Open it from the event menu (tap the event name), the join screen, the "You've left" screen, or the home page, without rejoining. It covers every event this device shot at.
- Clips: thumbnail, time, length, size and status (✓ Delivered, Sending, Waiting for the host, Didn't arrive: reason). Retry or Send again (also for delivered clips, in case the director lost one), Save (the share sheet on phones, so it lands in Photos or Files; a download on computers), and Delete (asks first, and warns harder if the host doesn't have it yet). The player shows just the shot, not the square recording around it.
- A copy of each clip stays on the device after delivery, unless you untick "Keep a copy". "Delete delivered clips" frees space in one tap.
- Show: clips, total recorded, time on air (and how many times), the director's messages with your replies, and the rundown with where it ended. Messages and the rundown now survive closing the tab.
- Home page: events you shot at as a guest have a My footage button.

**Known limits**
- Phones may clear a website's stored data if it isn't opened for a few weeks (iPhones especially). Save anything you want to keep.

## 0.10.0 — Android lenses, computers as cameras, fixes
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Fixes**
- Live audio mixer meters didn't draw (a stylesheet ordering bug from 0.9: the bars had no height). They light up again, vertical or sideways.
- Android phones with several back cameras couldn't switch lenses: many Android phones can't run two cameras at once. A switch that fails now releases the current camera and tries again, and puts the previous camera back if that fails too. iPhones (which hand over between cameras by themselves) are unchanged.
- On the camera screen, the rundown line was hidden under the ON AIR light. ON AIR, PAUSED, AE/AF LOCK, the rundown line and director messages now stack in one column and never cover each other.

**Android lenses**
- Extra back cameras are named plainly ("Cam 2", "Cam 3"), since Android's camera names don't say which lens is which.
- If the phone offers zoom below 1× (often how Android reaches its wide lens), the rail shows it, e.g. 0.6×.

**Computers as cameras**
- The camera page tells phones from computers. A computer's webcam can't be turned, so it never hears "Hold your phone upright"; it gets one plain note instead (its landscape picture will be cropped for a portrait film, nothing to change). No level overlay (no gyro); Flip steps through the computer's cameras; messages say "computer", not "phone".
- The studio marks computer cameras with a PC badge. The auto director scores a fixed camera in the wrong shape more gently than a phone held the wrong way, and describes it as "a landscape camera in a portrait film". Auto-cut in Edit does the same, using what each recording says it was shot on.
- Motion coaching (hold steady, pan slower) still appears if a computer really has a gyro, like a 2-in-1.

## 0.9.0 — live playout, and Program out on one screen
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Program out that keeps going**
- Fixed: the "Waiting for the studio" message stayed over the picture.
- Fixed: the program froze when the Program out window covered the studio (browsers pause drawing in a covered window). Program out now drives the studio's drawing itself, and a background clock keeps drawing, program recording and the auto director running even with no Program out window. Works full screen on a single laptop.

**Live room**
- No cut buttons under the program: click a source tile to cut. Tiles show each camera's sound mode.
- Clips: add b-roll, commercials or a logo under Clips in the Sources panel. Each loops silently in its tile so it's ready; click to put it on air from the top. Loop keeps it going until you cut to a camera; otherwise it plays once and returns to the camera you were on. Clip sound has its own strip in the mixer. While a clip is on air, phones' ON AIR lights go dark and the auto director waits. Clips also play in the break rotation.
- Lower third: type a name and second line, press Show (or T). It fades in, hides itself after 8 seconds unless you untick that, and recent ones are a click away. It's part of the program, so recordings and Program out include it.
- The audio mixer dock adapts: tall, its strips stand up and widen to fill the space; short, they turn sideways (like OBS) and spread across the full width.

**Director**
- A "better shot" now has to stay better for 1.5 seconds before the director cuts to it (quality scores are noisy; no more twitchy cuts). Cutting away from a bad shot stays fast.

**Known gap**
- Clips aired live are in the program recording, but not yet placed on the Edit timeline when it's rebuilt from live cuts.

## 0.8.0 — two rooms, transforms, program out, and your events
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**The studio, redesigned**
- Live is an OBS-style control room: program is the hero, every camera is a card in a multiview grid (with its message box), the switcher bus sits under the program, and the audio mixer is a resizable dock along the bottom with vertical meters, faders, AFV / ON / OFF and stereo Program meters. No timeline while you're switching.
- Edit is an editor: media browser, a large viewer with Program/Source tabs and icon transport, inspector, a slim tool palette, and the timeline.
- Every divider drags (or use the arrow keys on it); double-click a side divider to hide that panel, or the timeline/mixer divider to reset it. Live and Edit remember their own layouts. Panel toggle buttons in Edit.
- Compact, professional sizing and a neutral dark look across the studio (choosing Light still gives light; the mixer dock stays dark like a meter bridge).

**Transform any layer**
- Select a clip or image and handles appear on the viewer: drag to move, corners to scale, the dot to rotate (snaps to centre and right angles; Shift for 15° steps). Click the picture to select the layer under the pointer.
- Exact position, scale, rotation, opacity and crop in the inspector, plus layout presets (full, corners, halves) and Reset.
- Crop trims edges in place, so the layer below shows through. Layers stack like any editor: the top track draws last. Everything renders into the MP4.

**Program out**
- One click opens a clean program-only window, with sound, for a TV, projector or OBS window capture. It takes the picture and sound straight from the studio tab; nothing leaves the computer.

**Your events on this device (home page)**
- Each event shows whether you hosted or shot at it, how much it stores here, and whether the server still has it ("Ended on server" when it's gone there — footage on this device is untouched).
- Export: one ZIP of every recording, unsent clips and break media, plus the edit and metadata (project.json). Archive tucks an event away. Delete from this device asks first and removes only that event's data.
- The server never deletes anything on anyone's device.

**From your iPhone 17 Pro Max testing**
- Cameras are requested in their native shape, so iPhones no longer crop (that was the "zoomed in more" stretch). First open uses the plain 1× lens front and back; after that the phone remembers each person's camera, zoom, exposure, quality, mic and overlays.
- Orientation changes only count after a steady one-second hold; orientation advice waits 1.5 s; hints no longer flicker. Phones hear when the film's shape changes.
- "Connected to host" shows briefly and fades (tap to dismiss); a status dot by the event name stays. Tap the event name to pause sending your camera, see the rundown and messages, or leave — and rejoin in one tap. Clips shot before leaving still deliver.
- Director messages: a box under each camera, or message everyone; phones show a small banner with 👍 / Can't, and the studio shows sent, seen and replies. A rundown with Prev/Next cues (also [ and ]) shows on phones as one line: Now · Next.

**Fixes**
- The director names the problem when it cuts away from a bad shot.
- Accessibility: zero automated WCAG 2.1 AA violations across every page and the new screens, both themes.

## 0.7.0 — control room, camera operator, media manager
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Full screen control room (F)**
- The studio becomes the control surface: program, multiview, a switcher bus (big numbered buttons, red when on air, showing each camera's sound mode), and a vertical meter bridge — a strip per phone with a dB scale, peak hold, clip light and vertical fader, plus stereo Program meters. Edit gets the bridge too (audio tracks and Master). Always dark, whatever the theme.

**Pictures and sound switched independently**
- Every phone has its own mixer strip with a broadcast audio mode: AFV (heard only while that camera is on air), ON (always in the mix) or OFF. Microphone phones start ON; cameras start AFV, and go OFF when a microphone joins unless you've set them.
- Shift + 1–9 steps a camera's sound AFV → ON → OFF (a "breakaway").
- Program meters are stereo; the mixer updates in place, so no button press is ever lost to a redraw.

**The phone as a real camera**
- Lenses and zoom: a zoom rail with lens buttons (0.5×, 1×, 2× where the phone has them), a vertical slider and pinch. Native zoom where the phone allows it, otherwise a digital crop that is really in the recording.
- Tap to focus and expose; press and hold for AE/AF LOCK.
- Settings (⚙): camera and microphone chosen separately (a clip-on or Bluetooth mic with the back lens, say), quality (720p to 4K, 30 or 60 fps), exposure, microphone level, grid, level, zebras, white-balance lock. Torch (⚡) where there is one.
- Camera, lens, zoom and microphone can all change mid-recording without stopping the take.
- A vertical microphone meter (dB, peak hold, clip light). Full screen (⛶); iPhones are offered Add to Home Screen, since iPhone browsers can't go full screen.

**Media manager (Edit → Media)**
- Every recording, subclip and marked moment in one list: search, filter by kind or tag, star, tag (quick tags or your own), notes.
- Source monitor (Shift + 2): play a recording, mark In and Out (I / O), Make subclip, Insert (,) or Overwrite (.) at the playhead on the selected track (the Program if nothing is selected), or Export clip as its own MP4.
- Mark moment (M) during the event; later, "Make clips from every angle" makes one clip per camera that was rolling (10 s before to 5 s after), tagged Moment. Moments show on the timeline ruler.
- Trim keeps only part of a recording in use; the phone's signed file is untouched. Delete removes a recording from this computer, every use of it on the timeline, and its subclips.

**Fixes**
- Monitors size themselves to the space they have (no more overlapping the controls below).
- Shift + digit is read from the physical key, so it works on any keyboard layout.
- Phone top bar fits every button on narrow phones.
- Accessibility: zero automated WCAG 2.1 AA violations across all pages and the new screens, both themes.

## 0.6.0 — right way up, a director, and real editing tools
**Deploy:** `./aws/deploy.sh` (site only changed; no backend changes).

**Rotation, fixed at the source**
- Phones now record an always-upright picture into a square frame, using the gravity sensor to undo any turn the screen didn't follow (rotation lock). Turning mid-shot is fine: every turn is logged with the clip.
- The studio slices clips exactly where a phone turned (▭ landscape, ▯ portrait). Shots that don't match the output shape are striped; change the output shape after the fact and the flags follow. Per-item rotation override for the rare phone that lay flat and guessed wrong. "Split at turns" for hand-made edits.
- Live tiles and the live program show exactly the shot inside each phone's square.
- iPhone clips recorded with a "rotated" flag (earlier versions) now render the right way up — the old renderer drew them sideways.

**AI technical director**
- Every phone rates its own shot twice a second from its gyroscope (shake), gravity (pointed at the floor or ceiling), compass (whip pans) and picture (too dark, blown out, covered, blurry), plus whether it's held the right way for the output.
- Live (A): holds each shot at least 3 s, cuts away from a bad one within about two seconds and says why, varies the angle, goes to the break slate if nothing is usable, and waits 8 s after you cut by hand.
- On-air tally: the phone that's live gets a red frame and ON AIR. Phones coach their shooters ("Hold steady", "Point the camera at the action", "Turn your phone sideways", "Too dark: find some light").
- Edit: Auto-cut uses each clip's recorded quality log to avoid shaky, dark or sideways moments.

**Premiere Pro tools and keys**
- Selection (V), Ripple Edit (B), Rolling Edit (N), Razor (C), Slip (Y), Slide (U), Hand (H). Add edit (Ctrl/⌘ K), ripple trim to playhead (Q / W), ripple delete (Shift + Delete), markers (M), previous/next edit point (↑ / ↓), snapping (S), nudge (Alt + ←/→), zoom (= / - / \), track locks. Ripples keep overlays in sync with the Program.
- Live/Edit switch moved to the ` key.

**Local connections**
- Connections are judged by address, not just type: LAN (direct), LAN·NAT (same network through the router), CELL (mobile data), NET, RELAY. Peer-reflexive local addresses were wrongly shown as NET before.
- "Help phones connect directly": browsers only share a computer's local address after microphone permission; one click grants it and reconnects phones.
- "Local network only" refuses anything that goes out through the internet.
- Monitor shows each phone's shot quality, shape and connection path.

**Render MP4 that doesn't give up**
- Encoders are tested by encoding real frames, then tried in order: H.264 High, Main, Baseline (what Chrome on Linux can do), VP9. This is the likely cause of "codec" errors on Linux.
- Each clip's decoder is tested first; a clip that can't use the fast path drops to a compatible one, even mid-render. A clip that can't be read at all no longer stops the film: those moments show the layer below, and the clip is named.
- Clear failures: what stopped, what to do, copyable details, and one-click real-time export.

**Fixes**
- Messages on the camera screen no longer sit on top of the record button; messages never block taps anywhere.
- Beacon scanning runs in the background and backs off, so the camera no longer stutters while looking for the beacon.
- A live cut made just before a phone started recording now lands when its clip begins (no black gap).
- Phone identity is filled in if its picture arrives before its name.

## 0.5.0 — the beta
**Deploy:** `./aws/deploy.sh`. The first run creates your admin key in `aws/.admin-keys` and prints it once. Publishing and the events map are off by default, on both the site and the server.

**Safer to run in public**
- Terms of Use page (beta, as-is, no warranty, limitation of liability, consent and recording responsibilities, what is stored). A beta notice on every page. Hosts and guests must tick an agreement box. No accounts, no cookies, no analytics.
- Publishing films to the cloud is switched off (site and server). Hosts render and share the file themselves.
- The events globe is switched off (site and server). "Near me" still works and only ever shows whole-kilometre distances, never locations.
- Everything expires 30 days after an event is created: the database record (enforced the moment it expires, not when DynamoDB gets round to it) and any published film (S3 lifecycle rule). Stale half-finished uploads are cleared after a day.
- Admin panel at `/admin`: totals, every event, rename, list or unlist, change expiry, delete a film, delete an event and all its files. Keys live only on your machine; AWS stores their SHA-256 hashes.

**A real editor**
- Layered timeline, top track wins. Drag items to move them (with snapping), drag their edges to trim, ▲▼ to change a track's priority, show/hide and mute per track, split (S), trim to playhead ([ ]), delete, duplicate, undo/redo (Ctrl/⌘ Z).
- The Program track is your multicam cut, built from live cuts until you edit it by hand ("Rebuild cuts" starts over). Number keys cut it to another angle at the playhead.
- Add lower thirds (T), title cards, break slates, images and logos, and picture-in-picture of another angle (P), with position presets and fades.
- Angles are phones: camera 3 is the same person live and in the edit.
- **Render MP4**: a new renderer that decodes every source with WebCodecs, composites every layer, mixes audio offline, and writes a standard MP4 (H.264 + AAC in Chrome and Edge; VP9 + Opus where H.264 encoding isn't available). No longer tied to real time; real-time export is still there as a fallback.

**Sound**
- Mixer with level, mute and meter for every source, live and in the edit, plus a master meter and a limiter so stacked sources don't clip.
- Mono fix: phone microphones are summed to mono, so a phone that records only one side plays in both ears. Phones now also ask for mono at the source.
- A microphone phone becomes its own audio track and quiets camera sound by default.

**Monitor tab** (`Monitor ↗` in the studio): every phone's link (LAN or not), round trip, jitter, packet loss, preview resolution and bitrate over the last minute, camera resolution, battery, free storage, device, how long it's been connected, and plain-language warnings (low battery, low storage, not on the venue Wi-Fi, clips waiting, not synced). Transfers and an event log. It reads from the studio inside your browser; nothing is sent anywhere.

**Fixes**
- Beacon: "Code brightness", "Background" and "Whole screen" are now three separate controls; background no longer dims the code.
- Published-film playback: films are now standard MP4 files from the new renderer (the old path could produce files some players wouldn't open).

## 0.4.0
**Deploy:** run `./aws/deploy.sh`. It adds one DynamoDB index (for the globe), updates both Lambdas, and uploads the new site. The index takes a few minutes to build; the globe shows events created after this deploy (and any you re-list).

- **Studio redesign.** Sources | program monitor | inspector, with a timeline underneath. Broadcast tally (red = on air), mono timecode, Live and Edit modes, light and dark themes.
- **Break slate.** Press B (or let it happen automatically when the on-air camera drops): color bars and your message, alternating with a sponsor reel of images or videos. Returns to the same camera when it recovers. Whatever the program shows is what OBS streams.
- **Microphone phones.** A guest can join as Microphone: sync with the beacon, lock in, and the phone records the room for the whole event in overlapping 10-minute pieces (no gaps), each sent to the host. Its live sound can drive the live program; in Edit it becomes the film's sound. Re-sync button for long events. Screen dimming and recovery if the phone interrupts the recording.
- **Portrait or landscape.** Chosen per event (and switchable in the studio). Every shot is shaped to one output — fill (crop) or whole shot (bars) — so the two never mix. Phones are told which way to hold. The watch page takes the film's shape.
- **Events globe.** The Events section is a spinning globe (d3-geo + Natural Earth, served with the site: no map keys) with a board of every public event; live events pulse red. "Near me" sorts by distance.
- **Beacon dimming.** Code brightness and screen brightness sliders (and [ ] keys) so a bright screen doesn't blow out cameras in a dark room.
- **Money.** Patreon ask after publishing or exporting, Patreon links in footers, a "Presented by" sponsor card on the watch page (from the break reel), and a /sponsors page describing placements for advertisers. Set `sponsorEmail` in `public/js/brand.js`.
- **Accessibility.** Help dialog with every shortcut (press ?), screen-reader announcements for cuts and arrivals, labeled controls, visible focus, reduced motion respected. Zero automated WCAG 2.1 AA violations (axe-core) on every page in both themes; tally red and green deepened to pass contrast.
- **Themes.** Auto / light / dark on every page, remembered per device, no flash on load.

## 0.3.2
- `aws/functions/api.mjs`: answer the browser's CORS preflight (OPTIONS) in the Lambda. The API's catch-all route also catches OPTIONS, so API Gateway was forwarding it to the Lambda, which rejected it, and "Create event" failed with a CORS error. Backend-only change: run `./aws/deploy.sh` again.

## 0.3.1
Fixes and cost work since the first 0.3 zip. **Only the last item changes the deployed backend**, so if you already deployed the earlier 0.3.x fixes, run `./aws/deploy.sh` once more to pick it up. The website files are unchanged.

- `aws/functions/package.json`: added the missing `version` so `sam build` works.
- `aws/deploy.sh`: no longer passes empty `DomainName=` / `CertificateArn=` to `sam deploy`; refuses `DOMAIN` without `CERT_ARN`.
- Added `aws/iam-deploy-policy.json` and `aws/iam-domain-policy.json` (scoped deploy permissions) and switched the docs and prompt from Amazon Q Developer to Kiro.
- `aws/functions/lib/core.mjs` (backend): presence messages now go only to the host and beacon, not to every phone, so signaling cost grows linearly with the crowd instead of quadratically. Phones still hear when the host arrives or leaves. Phones that vanish without disconnecting drop out of the list after 11 quiet minutes.

## 0.3.0
LAN-first rebuild: phones stream a live preview and send signed clips to the host laptop over WebRTC; AWS only does event discovery, signaling and film publishing.

## 0.2.0
New landing page with the live multi-angle demo.

## 0.1.0
First Cloudflare-based version (all clips through the cloud).
