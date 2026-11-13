# Changelog

## 0.70.1 — the TV page on digital signs
**Deploy:** `./aws/deploy.sh` (CloudFront settings and site). It builds on 0.70.0.

**The TV page can be shown in a frame on any site**, like the kiosk and the studio, so a digital sign (Rise Vision and the like) can embed `/tv?e=…`. Every other page still refuses to be framed by another site.

**The frame settings live in the template now.** The kiosk's and the studio's (made by hand in the CloudFront console until now) are in `aws/template.yaml` as the `EmbedHeaders` policy and cache behaviours for `/kiosk*`, `/studio*` and `/tv*`, with the default's security headers, so a deploy can't drop them.

**vuemesh.com and its certificate are now kept by the stack.** They had been set by hand in the CloudFront console, so a deploy that changed the distribution dropped them (vuemesh.com was down for a few minutes during this release's deploy). The stack now has `DomainName` and `CertificateArn`, and later deploys keep them without `DOMAIN` or `CERT_ARN` being set.

**`*.har` files are ignored by git**: a browser's network capture can hold a host key.

## 0.70.0 — nothing sent to Google, no location code left, a fuller Privacy page, and easier to read
**Deploy:** update the deploy user's IAM policy from `aws/iam-deploy-policy.json` (log retention and Lightsail), then `./aws/stun/deploy.sh` (new, once), then `./aws/deploy.sh` (functions and site). It builds on 0.69.0.

**No outside requests for fonts.** Archivo, the typeface of the studio and most pages, is now served from the site (`public/css/archivo.css`, `public/fonts/archivo-*.woff2`, SIL Open Font License) instead of Google Fonts. No page sends a visitor's address to Google for a font, and Archivo works offline on a show's own network too.

**The Privacy page covers what the GDPR asks for:** who is responsible and how to reach them; the basis for each thing kept (providing the service, legitimate interests, and why browser storage needs no consent banner); AWS as processor, with the servers in the United States and what covers the transfer; your rights (to see, correct, delete, restrict, object, take a copy) and how to use them without an account; and the right to complain to a data protection authority. Google Fonts is gone from its list of other services, and it says the STUN server sees a device's public address and how a copy can use its own.

**Our own STUN server** (`aws/stun`): devices ask `stun.vuemesh.com` for their public address instead of Google's server. STUN only (coturn): it relays nothing and keeps no logs. One small Lightsail server; `deploy.sh` writes it into `config.js`, and stops if it isn't there (or runs with `STUN=google`). Going live to a streaming service (WHIP) uses it too. `aws/stun/check.mjs` asks it for this computer's address.

**No location code left.** The server no longer accepts or keeps a location with an event, and the "near me" and map endpoints are gone (nothing has asked for a location since 0.68.0). An older event's location is never shown.

**Visitor counting uses a random salt made fresh each day**, deleted with that day's visitor marks after two days, instead of one fixed salt: once it's gone, nobody can recompute a mark from an address.

**An Accessibility page** (`/accessibility`): the standard aimed for (WCAG 2.2 AA, partially met), what has been checked, the known limits, and how to report a barrier. Linked from the home page and the Privacy page.

**The Privacy page names who runs vuemesh.com** (Joshua Allen Talbott, Ohio) and the STUN server it now uses.

**Server logs are kept for 14 days**, not forever: `deploy.sh` sets the retention on both functions' CloudWatch log groups.

**Easier to read (WCAG 2.2 AA colour contrast),** checked with axe on every public page in light and dark: the role labels on the home page's rig, the step headings on the Tour, the muted text on the light home page, white on red buttons in the dark home page, the partner labels on Collaborate, and the version links on the camera, share, remote and TV pages. The Remote's connection dot is announced as a status.

**Tests:** `core.test`: a location sent with an event, or later, is never kept; no "near me" and no public list; visitors still counted once a day with the daily salt.

## 0.69.0 — info@vuemesh.com
**Deploy:** `./aws/deploy.sh` (site only), after `aws/mail` is set up. It builds on 0.68.0.

**A contact address of the project's own.** The Collaborate page's buttons, the Terms' contact link and the Code of Conduct now go to **info@vuemesh.com** instead of a personal address.
- **How it works** (`aws/mail`, its own stack): mail to info@ arrives at Amazon SES, is scanned for viruses and spam, kept encrypted for 30 days, and forwarded to the maintainer's inbox from info@ with the sender as Reply-To. Replies go out as info@ through SES, signed with the domain's DKIM key. Only info@ is accepted; a virus is dropped, and suspected spam is marked in the subject. It costs cents a month. `aws/mail/README.md` has the setup.
- **The Privacy page says so:** what happens to a message sent to info@, and that AWS handles it.

**Tests:** `mail.test`: a message forwarded from info@ with the sender as Reply-To, the headers that would fail checks taken out, the body untouched; suspected spam marked; accented names encoded; a sender's own Reply-To kept.

## 0.68.0 — free and open source, nothing given up to start a show, and a steadier zoom on iPhones
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.67.0.

**Free and open source.** VUEMesh is now MIT licensed (`LICENSE`), with `CONTRIBUTING.md`, a Code of Conduct, and issue and pull-request templates written for artists and producers as well as developers.

**Nothing given up to start a show.**
- **Starting an event asks for a name and a shape, nothing else.** The event-type choice and "List it on the globe" are gone from the home page, and so is the events section with Near me: nothing asks for a location any more. Admin no longer lists or unlists events, and the globe and its map files are removed.
- **A note on first visit says what's kept,** in plain words: no cookies, no accounts, no trackers; what this browser stores (settings, events and their keys, names, recordings and edits); what the server keeps for 30 days; and the anonymous counts. **Got it** puts it away for good. Not on the program, a TV, the beacon, a kiosk or TV calibration, and not in automated test browsers.
- **A Privacy page** (`/privacy`): every item kept in the browser and on the server, and for how long, the other services a browser talks to (AWS, Google's STUN server, Google Fonts), what this browser holds right now, and **Clear everything VUEMesh keeps here** (with a warning to export first).
- **The Terms** (version 2026-11-12, so people are asked to agree again) say the code is MIT licensed in place of the old intellectual-property section, and point to the Privacy page. The home page footer links Privacy and the source code, and Work with VUEMesh opens with building it together.

**TV and Share on the home page.** Two more tiles beside Camera, My media, Kiosk and Join a show: **TV** (show a studio's program, or phones straight to this screen) and **Share** (send this computer's screen into a show), with a how-to for each further down the page. Start a show takes the full width under them, and the header's duplicate Start a show button is gone.

**The camera page's zoom, on an iPhone.**
- **A pinch zoomed the whole page,** not just the camera, and the picture and controls jumped. The viewfinder's pinch, tap and hold are now the camera's alone (Safari's own page-zoom gestures are stopped there).
- **The zoom slider's thumb jumped as you pinched,** upright: the slider resized itself at each step. It stays put now.
- **Sideways, the lens chips left the slider a stub** over the zoom readout. As on a phone's own camera app, the lenses are now one row in a capsule above the record button, and the slider runs the right edge.
- **Each zoom step reset the picture's size and undid exposure, white balance and the focus point.** Camera settings now add up: a zoom keeps everything set before it, and a setting the camera can't do is skipped on its own instead of taking the others with it.
- **Tap to focus and hold to lock only appear where they work** (Android's Chrome). An iPhone's camera keeps its own focus and exposure, and a focus box that changed nothing looked broken; holding no longer says it can't lock.

**Tests:** `quality.test`: a zoom keeps exposure, white balance, focus point and size, and a one-shot focus isn't repeated; tap to focus and hold to lock are off where the camera doesn't allow them. `e2e_outbox` (was `e2e_outbox_globe`): the home page asks only for a name. `e2e_home`: the TV and Share tiles.

## 0.67.0 — phones and screens straight to a TV, which VUEMesh this is, and a 6-core desktop at 1080p
**Deploy:** `./aws/deploy.sh` (backend and site: a TV's own code has its own words for the people joining; with the older backend it still works, with the studio's words). It builds on 0.66.19.

**Straight to a TV, with no studio.** `/tv` opens on both ways onto the TV, side by side, with nothing to click to find either: **Show a studio's program** (type the event code, as before) on the left, and **Put your camera on this TV** on the right, with the TV's own code and a QR code, already listening.
- **The TV has a code of its own.** Phones scan it and join as a camera does (`/cam`); a computer opens `/share` and types it in. The code stays the same on that TV, after a reload or the next day, so it can go on a sticker. **New code** makes another (it asks first). Typed on the studio side by mistake, it says it's a TV's code.
- **The first one to join takes the TV to the tiles; when the last one goes, it's back to the landing page,** still listening. Showing a studio's program stops the listening, and leaving it starts it again. **Clear** takes everyone off (each phone is told, and doesn't link straight back).
- **Whoever joins is on the TV,** as they come and go: one fills the screen, two side by side, three as one big and two beside it, then 2x2, 3+2, 3x3 (up to nine; more wait for a place). Every tile is 16:9 and slides to its new place as others join and leave. A shared screen is shown whole; a phone's picture fills its tile.
- **One full screen:** click it, OK on a remote, or 1 to 9; again, 0 or Back for all of them. The remote's arrows move between tiles. The one shown full screen sends its full picture and the rest a small one; with one or two on, both send their full picture, with three or four a full picture at less, with more a small one.
- **Sound, one at a time:** a shared screen's (the one full screen, else the first with sound). A phone's microphone in the same room as the TV feeds back through its speakers, so cameras' sound is off until **Camera sound** is turned on; then the camera full screen plays its.
- **Nothing is recorded.** Each phone's light goes red while it's on the TV, it doesn't record, and it keeps its own clips. The terms a phone agrees to say so, and the phone and share pages say "the TV", not the studio.
- **The camera page, joining a TV, is a camera on a TV and nothing more.** One tap in (**Put my camera on the TV**, a camera only: no microphone choice, as the TV keeps cameras' sound off), and no motion step. No beacon: nothing asks to aim at one, after joining or on recording, and there's no sync pill. No note about the director's control. Its light says ON THE TV, Paused says not on the TV, and its status, event sheet and Help are in the TV's words. **Leaving is at once:** a studio is asked for the phone's copy of the show first, and a TV, which never answers that, held the phone up to 10 s on "Checking with the studio for your copy of the show"; now it doesn't ask. Then **Back on the TV** puts it back. A clip recorded on the phone stays there, in My events, and says so at once.
- While someone's on, how to join sits small in a corner; it and the buttons fade after 12 s and come back with any key or movement.
- How: the TV joins its own event's signalling as its host, with the studio's own end of a phone's link, so `/cam` and `/share` link to it exactly as to a studio. A phone told how good a picture to send (the TV's tiers) takes it as it takes the studio's tally.

**Program out on the remote, direct, with no tap.** From three show logs on the Dell, with an iPhone as the remote: Program out didn't come until + This phone was tapped.
- **Why only the remote:** a browser only gives a page the device's real address once the page has the camera or microphone. Without, it gives a made-up name.local, which the studio has to find on the network (from a Wi-Fi phone to a wired studio computer, it usually can't), and what the phone sends the studio's firewall drops. The camera page always has the camera, and the share page asks for the microphone for just this: so their links are direct. The remote was the one page that asked for nothing, so its Program out sat at "connecting" (50 s in one log) until + This phone gave it the camera. It isn't about phones: a remote in any browser is the same.
- **Now the remote asks as it joins, as the camera page does:** the device's own question for the camera and microphone (none, if they're allowed for the site already), let go at once (nothing from them is recorded or sent), and the picture connects directly, with no tap and no camera added. Only where the picture hasn't come by itself in a second: a computer on the studio's network, or a studio that lets the phone in, isn't asked anything. + This phone then opens with no question, its lenses already named.
- **Answered no** (or a browser that only asks inside a tap): the box says **Tap to connect the picture** after 5 s, and stays until it comes.
- **The show log says why** a TV or remote hasn't connected in 12 s: only a hidden address (name.local), and whether anything it sent reached the studio at all (nothing: its firewall, or the network, turned it away, and what to change).
- **A phone that won't play a video until it's touched** (an iPhone in Low Power Mode): the first touch anywhere starts the picture, the box says Tap to show the program until then, and the show log says so. A camera watching the program has the same.

**The remote's front camera on an iPhone 17 Pro.** It lists two front cameras, and since 0.66.12 the remote showed one: the one with the shorter name, which on the 17 Pro is the second the phone lists. So its only front button said "Front 2", and the usual selfie camera wasn't there. Now it's the first the phone lists, the one it opens itself for a selfie, and the button says Front.

**A TV listed a shared screen as joining after it had gone.** Stop sharing on `/share` closed its link but left the computer on the event's signalling, so a TV's landing page said "Joining: Josh's Mac" for good, and the studio still listed it. Now stopping takes it off the event (sharing again joins afresh). A TV also lists someone as joining only for 25 s after they appear, and never one that was on it and left: a page left open or a phone gone without saying isn't "joining".

**The camera page on a laptop or desktop.** It was laid out for a phone held upright, and on a computer some of it came apart.
- **The Event and Camera sheets spread across the whole window** (a rule keeping them clear of an iPhone's notch also undid their width). They're a sheet's size again, on a phone too, with the notch still kept clear: 440 px, and 520 for Camera on a computer, scrolling inside if the screen is short.
- **My events ran edge to edge**, its clips one under another across 1440 px. On a computer it's a centered column, about 960 px, with clips two across and bigger pictures, and the totals line and tabs sized to match.
- **Joining, the home page and the setup step sat at the top of an empty window.** On a computer they're in the middle.
- Only in a wide window with a mouse (760 px and more, 560 high): a phone held sideways, or a tablet, keeps the phone's layout.

**Which VUEMesh this is, on every page.** A small `v0.67.0` beside the VUEMesh mark (the home page, What's new, Terms, Work with VUEMesh, the tour, Monitor, Admin, the share page and the TV's), and at the foot of the phone pages (camera, remote), the beacon, the watch page and TV calibration. The studio, Edit and the kiosk have it in Help, beside its title, as their bars have no room. It opens What's new at that version. On a phone the home page and the tour show it at the foot, where it doesn't push Start a show onto two lines. Not on the program output, which goes on air. The number comes from one place, so a page can't show an old one.

**From a show log of a 6-core desktop (a Dell all-in-one, 9th-gen Intel, 8 GB) at 1080p with Quality first,** three USB cameras, its screen with sound, a phone and the phone remote.
- **This computer's cameras recorded on air with "Cameras record their time on air" off.** It was turned off a minute and a half before Record program, and each cut to one of the computer's own cameras still started its recording, at 1080p and 16 Mbit/s, beside the program's. The setting applied to the phones only. Now it applies to this computer's cameras and screens too (one recording by hand still records).
- **What the log says about 1080p on it:** the program held 30 frames a second throughout, but the cameras didn't. At 720p all three delivered 30 frames a second; opened again at 1080p, 28; with the phone joined and the phone remote watching, 25; while recording (the program plus each camera's own), 18. Record program skipped 391 of 1891 frames (a fifth). So the cameras at 1080p, then the recordings, are what it can't keep up with, not the program.
- **What it now says to change:** when Record program skips frames at 1080p with this computer's cameras at 1080p, the message says to set **This computer's cameras capture at** to 720p (in Sync): the program stays 1080p, and it changes during the recording, each camera as it's off air. With cameras recording here too, it says to turn off Cameras record their time on air. Before, it said only to set Output to 720p after the recording.

**Tests:** `e2e_tvdirect` (new): the landing page with both (the studio's code focused, the TV's code and QR listening); the TV's code typed on the studio side turned away; the TV's code the same after a reload; a phone's camera and a shared screen join with it and are tiled; the phone's light on, not recording, its full picture with two on; 2 full screen (the phone then sends a small picture) and 0 back; the screen's sound plays and the camera's only with Camera sound on; the share page says it's on the TV; tiles go as each leaves and the landing page comes back; Clear takes a phone off (it says so and stays off) and shows the landing page. `e2e_remotepgm` (new): paired with no camera, Program out in under 5 s; a phone that hides its address (made by giving the studio only a name.local, and ignoring its addresses until the camera or microphone's been asked for): asked once as it joins, the picture in under 5 s with no tap and no camera added; answering no, Tap to connect the picture after 5 s (staying through the phone's next try), the show log saying why and that nothing reached the studio, and the tap connecting it; on a studio that lets in what it sends, the picture with nothing asked; a phone that won't play a video until touched says Tap to show the program, the show log says so, and the first tap anywhere starts it, not full screen. `quality.test`: the remote's lens buttons from an iPhone 17 Pro's list (one Front, the first listed, even with a longer name), combined cameras kept when there's nothing else, Android's numbered lenses. `e2e_tvdirect`: a stopped share is off the TV's list and nobody's listed as joining (without the change, it stays). Camera page at 1440x900 and 1366x768 checked by eye (the sheets, My events with clips, joining); `e2e`, `e2e_solo`, `e2e_mymedia`, `e2e_guided_setup`, `e2e_permtip` and `e2e_qrjoin` pass. On the phone: a camera only, in one tap; no beacon (after joining or recording), no sync pill or director's note; ON THE TV; a clip recorded stays on the phone; leaving in under 2.5 s with no wait for a copy of the show; Back on the TV. `docsync.test`: every page but the program output shows the version, and its link is an anchor on What's new.

## 0.66.19 — a shared screen's sound when Windows changes speakers
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.18.

From a show log of a video on a shared screen with its sound: 10 s of it reached the program, then none, and Record program's file and the screen's own recording had none of it.
- **Windows moved its sound to another speaker during the show** (from the Focusrite to the Realtek, half a minute before Record program started). A screen's System Audio is what plays on the speaker that was Windows' default when it was shared, and Chrome keeps it on that speaker: everything then played on the other one, and the share heard exact silence with its track still live. The log only said "the computer said its devices changed".
- **Now the studio says so at once,** under Notifications (and as a system alert while it's hidden): which speaker Windows moved to and which one the share still hears, with **Share its sound again** beside it. That's Chrome's picker (Entire screen, Also share system audio on); the picture carries on as it is, and so does its recording. Putting Windows back on the first speaker clears it too.
- **The show log says which speaker a screen's sound comes from,** when Windows moves, and, each second until it's put right, that the screen is on the wrong one.
- A screen on this computer no longer logs "sound had stopped reaching the mixer: reconnected it": nothing links it to the mixer, and with nothing playing it's simply silent.

**Tests:** `showlog.test`: the alert comes at once with both speakers' names, once, and clears when it's put right; a silent screen otherwise says nothing; the default speaker is read from the browser's device list, and not guessed when it has no name.

## 0.66.18 — sound from the start of a new link, and Quality first
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.17.

From a show log with a Mac's screen, a Mac's camera and a phone, on a studio computer with power to spare.
- **Sound dropped out at the start.** 10 s after another computer's screen joined, the log says "Josh Mac's sound had stopped reaching the mixer: reconnected it", and the same for the phone's camera (the night before, too). A phone's or computer's sound track arrives muted, before any sound has come, and the mixer listened to it then. Chrome can keep handing the mixer silence after that, until it's listened to again, which the sound watch did only after 8 s of nothing. Now the mixer listens again once the track unmutes, and in a new link's first 30 s the sound watch puts it back after 2 s, not 8. (The test's sound reaches the mixer either way, so the first part is the likely cause, not a proven one; the second makes the gap 4 s at worst.)
- **Quality first** (under Output, off unless turned on, kept on this computer): for a studio computer with power to spare. Record program at 12 Mbit/s at 720p and 20 at 1080p (6 and 10), this computer's own cameras' recordings at 16 (8) and a screen's at 8 (3). The camera on air may send up to 15 Mbit/s on the local network, not 8: the phones and the Mac's screen reached about 6.5 of the 8. The studio says so with each on-air message (every 4 s, and at once when it's switched). It can't change while Record program runs, as the output's size can't.

**Tests:** `showlog.test`: a new link's silent sound is put back after 2 s, after that as before; listened to over 30 s ago, 8 s. `e2e_sharequality`: the screen's sound reaches the mixer from the start; Quality first on, the screen on air may send 15000 kbit/s, off, 8000.

## 0.66.17 — the show log hears a phone's sound speeding up
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.16.

0.66.16 keeps 150 ms of each phone's and computer's sound in hand, so a short hiccup isn't hurried through. Whether that's enough after a long stall can't be seen in a test, and the show log couldn't say: it had the link's jitter, but that was its picture's, not its sound's (so the 179 ms read for 0.66.16 was most likely the Mac screen's picture), and nothing on what the browser did with the sound.
- **Now each phone's and computer's sound is in the show log as the studio plays it:** its own jitter and how long it waits to be played, every second; and every few seconds, how much the browser played faster to catch up (heard as the sound speeding up), stretched, made up for sound that didn't arrive, and got.
- **When it's hurried** (200 ms or more in a few seconds), the log says so when it happens, with its jitter and what was made up before it. The summary says how often, how much in all and the worst moment, and how much of a source's sound was made up, a second or more.
- The numbers come as running totals, so the Monitor asking for them as well doesn't split them.

**Tests:** `showlog.test`: from two readings, the wait, and ms hurried, made up and arrived; a first reading or a new link gives only what holds now; the summary says a source hurried after a stall once, with when and how much, and nothing for a steady phone. `e2e_sharequality`: the shared screen's sound in the log, waiting about 150 ms, about 5000 ms arrived each reading (so not counted twice for its two sides), nothing hurried, what the browser did once per reading. A stall can't be made in a test, so the next show is the proof.

## 0.66.16 — a shared video sent smooth, and sound that doesn't hurry after a stall
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.15.

From a show log with a Mac sharing its screen over `/share` (a video, with its sound) and sending its own camera from another tab, both on its software encoders.
- **A shared video came out blocky, and at 2 frames a second.** The share page starts on Slides and text, which keeps every word sharp: frames and bitrate give way first. On air the Mac's screen sent about 1 Mbit/s (the studio allows 8), and for a minute only 2 frames a second, 20 s of it on air. Nothing reported being held back, so the page's tip to choose Video and motion never showed. Now a share whose sound plays for 3 s is sent as **Video and motion** by itself, and the page says so ("Showing slides? Choose Slides and text"). It's once per share and not remembered: choosing Slides and text then holds, and the next share starts as chosen.
- **Sound sped up after a stall.** The Mac stalled for about 2 s (its camera sent 5 frames, then none, then 85 in one second), and its screen's sound jitter went from 5 to 179 ms. The browser then plays the backlog faster to catch up, which is what was heard on air. The studio's own sound delay didn't change (no change over 15 ms in the log). Now the studio keeps 150 ms of each phone's and computer's sound in hand (`jitterBufferTarget`), so less is left over to hurry through. The browser holds the picture back to match: about what the studio's own cameras already wait (~110 ms).

**Tests:** `e2e_sharequality`: a share playing a tone goes to Video and motion by itself (`maintain-framerate`, `motion`), says so, doesn't store it; Slides and text chosen then holds for 4 s; the studio's sound receiver for it is at 150 ms. `e2e_screen`, `e2e_remotescreenrec`, `e2e_audio` and `e2e_sync` pass. `e2e_stillscreen` fails the same way on 0.66.15 without these changes. The catch-up after a stall can't be made to happen in a test, so that part isn't proven until a show.

## 0.66.15 — the remote's camera: its microphone the first time, and its picture the right shape
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.14.

From a show log of the remote's camera on a phone.
- **The microphone didn't come in the first time.** + This phone asked for it, and the camera joined without sound ("sound from nothing" in the log), with no Mic button to try again. Removed and added again, it worked. The program's sound on the remote puts the phone's audio session on "playback", and an iPhone won't open its microphone in that. Remove set it back to "auto", which is why the second try worked. Now the program's sound is held off from the tap on + This phone, and the phone is set for recording ("play-and-record") before the microphone's asked for, not after: the first add brings it in. The session is never changed while the microphone's open (changed under it, it can go silent).
- **If the microphone still doesn't open,** the camera goes in without it and says so ("without its microphone: tap Mic off to try it again"). Mic off stays on its bar, the program's sound isn't held, and a tap brings the microphone in. Turned down by the phone's settings, the tap says where to allow it.
- **Its picture was squeezed in the studio's sources.** The tile took every camera's picture as the square a phone's camera page sends, and the remote's camera sends its whole 16:9 frame, so the tile squeezed it into a square (round things came out tall and thin). The program was right: it's drawn from the picture's real size. Now the tile uses the picture's own shape, and fits it again when that changes (a lens, a turn). A camera page in a background tab, which also sends its whole frame, had the same squeeze.

**Tests:** `e2e_remotecam`: the remote page keeps an iPhone's audio session (the microphone turned down on "playback"). With the program's sound on, the first add asks for the microphone on "play-and-record", the session isn't changed while it's open, and the studio hears it. The studio's tile is 1.778 wide to 1 high for a 1920x1080 picture. Added again with the microphone turned down: in without it, Mic off, the program's sound free; a tap brings it in and the studio hears it. With 0.66.14's code it fails on both (no microphone; the tile 1 to 1). `e2e_cambg`, `e2e_remote`, `e2e_remotelandscape`, `e2e_tvremote`, `e2e_campgm` and `e2e_srcwidth` pass. Not tried on an iPhone yet.

## 0.66.14 — the sources panel as wide as you like
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.13.

The sources panel's divider went nowhere on a laptop. At 1280 or 1366 px the page held the panel to 22% of the window (282 or 301 px), whatever it was dragged to, so the pictures stayed small: hard to tell two cameras on the same stage apart. On a wide screen it went the other way: the panel could take 55% of the window and leave the program a third of its size.
- **Now the divider drags it wider on any screen,** and the pictures grow with it: at 1366 x 768, 160 px wider takes a camera's picture from 136 to 216 px across. The panel still picks how many pictures go across to fit them all in, as large as they can be.
- **The program keeps its share:** the panel stops where the program's column would go under 40% of the window (and 400 px), beside the inspector as wide as it is. That's 456 px at 1280, 508 at 1366, 552 at 1440 and 840 at 1920. The program is fitted again as you drag, and nothing scrolls sideways.
- **It's kept** on this computer after a reload, as the other panels are. Until you drag it, a laptop shows the panel as it did before.
- **Double-click the divider** to put it back to its own width (it used to hide the panel). **To hide it,** ◧ as before, or drag the divider to the left edge and it slides shut; ◧ (or dragging it back out) opens it as it was.
- **By touch:** the dividers are 6 px to look at, and now a finger's width to take hold of on a touch screen. A drag follows the finger, one layout a frame.
- Edit's media panel has the same divider and the same fix (it was held to 18% of the window).

**Tests:** `e2e_srcwidth` (new): at 1366 x 768 with a camera in, a drag 160 px wider widens the panel 160 px, the camera's picture by 30% or more, and fits the program again, inside its monitor; dragged as far as it goes, it stops at its limit with the program's column 40% of the window; the width is the same after a reload; a double-click puts it back (kept too); → on the focused divider adds 20 px; dragged to the edge it shuts, ◧ opens it at the width it had, and it drags back out. At 1280 x 800 by touch (real touch events): 10 px off the divider still takes hold, and it drags out and back. At 1280, 1440, 1536, 1920 and 1024 wide, as wide as it goes: the pictures bigger, the program's share kept, nothing sideways. `e2e_layout`, `e2e_fitted_mixer`, `e2e_overflow`, `e2e_editpage`, `e2e_pvwtwoup` and `e2e_kiosk` pass.

## 0.66.13 — the time of day on the phone remote
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.12.

The remote had no clock, and a show runs to one.
- **Now:** the time of day sits at the right end of the remote's title bar, beside the connection dot, styled as the studio's program monitor shows it in its top right: white, bold, monospace, on a dark see-through pill. It ticks on the second and is written only when it changes. It's this phone's own clock, as the studio's is that computer's.
- It's on one line with the show's name, upright and sideways. Upright on a phone, a long show name is cut short with "…" to make room for it.

**Tests:** `e2e_remotecam`: the clock reads as a time and ticks, sits right of the show's name and left of the dot, inside the title bar, upright and sideways at 956x380, 932x430, 844x390 and 667x375. `e2e_remotelandscape`, `e2e_remote` and `e2e_tvremote` pass.

## 0.66.12 — the remote's camera on a real iPhone: the speaker, its bar, and the full-screen mark
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.11.

The first show with the remote's own camera on an iPhone worked, with three things off.
- **The program's sound came from the earpiece after Mic off.** Mic off only muted the microphone, so it stayed open, and an iPhone with its microphone open plays sound as a phone call does, from the earpiece. Now Mic off lets go of the microphone altogether (the studio gets silence, the picture carries on), and the program's sound comes back on the speaker. Mic on opens it again, holding the program's sound off as before.
- **The camera's bar was jammed** on a phone held sideways: its picture, "This phone", Mic and Remove in one row squeezed the name under the buttons ("phoı"). Now its picture is on the left, with "This phone" and its state on one line beside it and Mic and Remove under them, then the lenses.
- **One front camera.** An iPhone 17 lists two, and the second showed as "Front 2", a fifth lens button that said nothing. Now only the plain selfie one shows (0.5×, 1×, 2×, Front).
- **The full-screen mark floated outside Program out** when the phone was held sideways in Safari: it sat on the corner of Program out's space, which is wider than the picture when the browser's bars take some of the height. Now it's on the picture's own corner, 8 px in, whatever the space.

**Tests:** `e2e_remotecam`: Mic off lets go of the microphone (not only muted) and nothing's sent; Mic on opens it again and the studio hears it (its sound packets climb). Sideways at 956x380, 932x430, 844x390 and 667x375: the full-screen mark 8 px inside the picture's corner each time, and "This phone" clear of Mic and Remove. `e2e_remotelandscape`, `e2e_remote` and `e2e_tvremote` pass. Not tried on an iPhone yet: which speaker the sound comes from (a browser here can't show that).

## 0.66.11 — the phone remote's own camera
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.9 (the remote held sideways) and 0.66.10.

The phone running the show couldn't be one of its cameras. That needed a second phone, or leaving the remote for the camera page and losing Program out and the buttons.
- **Now:** after the cameras on the remote, **+ This phone**. A tap (the phone asks for its camera and microphone the first time), and it joins the show as a camera of its own, named after the remote ("Remote camera", or "Josh's iPhone camera"). In a second or two its picture is among the others', with THIS PHONE on it and an amber edge, and a tap on it cuts to it, the same as any camera. The remote stays as it was, upright or sideways, Program out and all.
- **Under the cameras,** while it's in: its own live picture (to frame the shot; the front camera as a mirror), ON AIR or Up next, **Mic on/off**, and **Remove**. Its lenses are one row of buttons, named as a camera app has them (0.5×, 1×, 2×, Front). A tap changes lens, and the studio's picture changes over with it (a moment's blip on an iPhone, which runs one camera at a time). An iPhone's combined cameras ("Back Dual Wide", "Back Triple") are left off when it has plain ones.
- **The program's sound is held off** on the phone while its microphone is live: played there, it would go straight back into the show. The Sound button says "Sound off: mic live". Mic off, or Remove, and Sound on comes back if it was on.
- **Remove** takes a second tap while it's on air ("On air: tap again"). Gone, the studio would put up its break slate until the next cut.
- **What it sends:** the camera's own picture, the whole frame, upright as the phone is held. The studio is told its shape, and again when the phone turns. The camera page's upright square, zoom, the look and the shot coach aren't on it.
- **Live only:** the phone records no clip of its own (the camera page does, for Edit). It's in Record program like any camera.
- **The studio** knows it's a remote's camera (by its id, as it knows a shared screen). It doesn't offer it a place watching the program, since the remote has Program out, and that place goes to another camera. It sends it no part of the live cut, and its leaving doesn't finish the part being recorded.
- **Locked, or behind another app,** an iPhone stops the camera. Back on the remote, a camera it ended is opened again, the same lens. A reload of the remote takes it out of the show: + This phone puts it back.

**Tests:** `e2e_remotecam` (new), with two fake cameras: + This phone joins the remote's camera to the show. The studio has its picture, and the remote shows it with THIS PHONE on it, its thumbnail from the studio, and its own picture under the cameras. The studio takes it as the whole frame, landscape, and offers it no program screen (with that left out, it was offered one). With Program out's sound on, it's held off while the mic is live, and let go with Mic off. A tap cuts to it: ON AIR on the remote and on its bar, live in the studio. The other lens changes the camera, and the studio's picture carries on, still on air. On air and recording, Remove asks for a second tap, then it's out of the show with no part of the live cut sent its way (with that left out, "Remote camera is leaving: sending them 1 part of the live cut first"). Added again, it's in once. `e2e_remote`, `e2e_remotelandscape`, `e2e_tvremote`, `e2e_remotejoin`, `e2e_campgm`, `e2e_offline`, `e2e_pip`, `e2e_cambg` and `e2e_remotescreenrec` pass.

## 0.66.10 — Record program's sound doesn't crackle on a busy computer
**Deploy:** `./aws/deploy.sh` (site only). It changes only Record program's sound, and needs nothing from 0.66.8 or 0.66.9.

A show on a busy laptop (four sources, the program encoded on the processor, two recordings here at once) made an MP4 whose music was choppy, though it sounded fine on the remote.
- **Why:** Record program keeps its sound in step with the picture. When the sound engine's clock falls behind the page's (on a computer this busy, it does), it puts in a millisecond of the sound again, crossfaded, so the join can't be heard. The crossfade ran the wrong way: a jump back of a millisecond at its start and again at its end, two clicks each time. That show's log has 478 put in during 70 s, about 17 a second at first, nearly every block of sound. Taking a millisecond out, the other correction, was right. The remote hears the live mix, which never goes through this.
- **Now:** the millisecond put in joins the sound smoothly at both ends, as one taken out does.
- A recording already made keeps its clicks.

**Tests:** `splice.test.mjs` (new): a millisecond put in or taken out of a 2048-sample block of a tone (110 Hz to 3 kHz) never jumps more than twice the tone's own step from one sample to the next. With 0.66.9 one put in jumped 0.625 at 110 Hz, against the tone's own 0.014. The length changes by exactly 48 samples, and the sound either side of the join is the block as it was.

## 0.66.9 — the phone remote held sideways, and Program out full screen
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.8.

Held sideways, the phone remote was the upright page stretched wide: Program out filled the width, so the cameras and the buttons were a long scroll below it, and the sides ran under the Dynamic Island.
- **Now:** turned sideways, a phone shows the whole show on one screen with no page to scroll. Program out is on the left, 16:9 and as big as the height allows, with what's on air, Program out and Sound above it. The quick actions (Auto-director, Fade to black, Break, Record program, the corner camera) sit in one row under it. The cameras, sounds, clips and the mixer are on the right, from top to bottom, and scroll on their own, at least two to a row. On an iPhone Pro Max that's a 505x284 Program out from the home screen (399x224 in Safari, with its bars). Nothing runs under the Dynamic Island or the home bar.
- **Program out full screen:** a tap on Program out fills the screen with it (sideways or upright), to just watch. A tap anywhere goes back to the remote. It's the same picture made big, so it carries on playing with nothing to reconnect. "Tap to go back to the remote" shows for 2 s. Where the browser lets a page go full screen (an iPad, Android), it does. An iPhone doesn't let a page do that, so there it fills the page. A small corner mark on Program out says it can.
- **A screen on air no longer shrinks Program out sideways.** With a screen on air, the corner button said "Corner camera: " and the camera's name, which took three lines on a phone held sideways, so the row of buttons grew and Program out got smaller. Now the buttons sideways are all one height whatever they say, and the corner button says "Corner on" with the camera under it in small type, cut short with "…" if it's long. Upright, it says "Corner camera" with the camera under it.
- **No "Another show…" sideways** (nor the line above it), so the sources run to the bottom. It's still there upright, and a studio that isn't open brings up the show's code by itself.
- **With Program out off,** what's on air and the actions go down the left, two to a row, and the sources get the rest.
- **The toast** ("This phone is now a remote…") shows at the top when sideways, not over the actions.
- Upright, the remote is otherwise as it was. An iPad isn't affected by the sideways layout (it's for screens under 560 high when sideways).

**Tests:** `e2e_remotelandscape` (new): at 956x440, 956x380 and 667x375, nothing scrolls but the sources, which run to the bottom, Program out is 16:9 beside them, and the actions are one row of buttons 44 or more high under it. Taps on cameras, the microphone, Break and Fade to black work. Another computer's screen cut to, with a camera named "Joshua Talbott iPhone 17 Pro Max" in the corner: Program out and the buttons keep their size, and the corner button's label stays inside it. A tap on Program out fills the screen (782x440 sideways, 440x248 upright), over the buttons, still playing, and a tap goes back. Program out off puts the actions two to a row, and upright it's the old order. `e2e_remote`, `e2e_tvremote` and `e2e_pip` pass.

## 0.66.8 — the Monitor shows the program's picture
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.7.

The Monitor's summary didn't fit in one row on a wide screen (seven figures, then one alone underneath), and the Program figure cut a camera's name short ("Josh M…").
- **Now:** the summary starts with a small picture of the program, as Program out shows it, with what's on (or Break, Black, Standby) named under it, a red edge while a camera is on air, and AUTO while the auto director cuts. The other figures sit beside it in two rows (three on a narrower screen), so it all fits. On a phone, the picture is on top.
- **What it costs:** the studio sends a 384-wide still 4 times a second over the same in-browser channel the Monitor already uses, and only while a Monitor is on screen and asking for it (every 2 s; it stops within 5 s of the Monitor going into the background or closing). It's a JPEG made off the page's own thread. There's no video encoder and nothing goes on the network. A live video like Program out's would need the Monitor to be opened by the studio, as Program out is, and the Monitor is a separate tab.
- **Shorter labels:** "Phones needing attention" is "Needing attention". The stream's figures say "Stream" and "Encoder asked for", with the details on hover.

**Tests:** `e2e_admin_monitor` checks the program picture arrives and the page doesn't scroll sideways.

## 0.66.7 — a camera in a background tab keeps sending
**Deploy:** `./aws/deploy.sh` (site only). It builds on 0.66.6.

A camera page on a Mac stopped sending its picture whenever its Chrome tab wasn't the one showing, for example while the same Mac shared its screen from another tab. The director's picture froze until the tab was back.
- **Why:** the picture the camera page sends isn't the camera's own. It's an upright square drawn from it frame by frame, turned for a phone held sideways, with digital zoom and the look. That drawing runs on the camera's frames as the page shows them, and Chrome stops those in a background tab. The camera page's own keep-alive also waited for the tab to be back. Its recording was fine: that comes straight from the camera.
- **Now:** while the tab is hidden, the page sends the camera's own picture instead, and tells the studio it's the whole frame. The browser keeps sending that in the background. This happens when nothing needs turning, as with a computer's camera, or a phone held as its picture is. Zoom and the look aren't applied meanwhile. When the tab is back, the square comes back.

**Tests:** `e2e_cambg` (new): a computer's camera page whose tab goes into the background (headless Chromium never hides a tab, so the test does what Chrome does: the page says it's hidden, and its frame callbacks stop). With 0.66.6 the studio got 0 frames in 3 s. Now it gets about 20 a second, the camera's own 960x540, and the 540x540 square is back with the tab. `e2e_camera_pro`, `e2e_campgm`, `e2e_orientation`, `e2e_phonerobust`, `e2e_rejoin`, `e2e_leave_rejoin`, `e2e_serverblip` and `e2e_vcam` pass.

## 0.66.6 — the remote's Program out keeps playing after Stop recording
**Deploy:** `./aws/deploy.sh` (site only).

In a test, the phone remote's Program out froze when recording was stopped from it, and stayed frozen, even with Program out turned off and on. The show log shows the studio still sending it 30 frames a second, and the phone still decoding about 30 a second, with its link connected the whole time. So the picture was arriving, but the video on the phone had stopped playing.
- **What paused it:** Stop recording on the remote asked "Stop recording the program?" with the browser's own confirm box, the only one on the remote, so starting a recording was fine. An iPhone pauses a page's video while such a box is open. (That's the likely cause. A desktop browser doesn't do this, so it wasn't reproduced here.)
- **Why it stayed paused:** nothing played it again. The link never dropped, so no new picture arrived to start it, and turning Program out off and on only tells the studio what to send.

Now:
- **Stop recording on the remote asks for a second tap.** The button says "Tap again to stop" for 3 s. There's no box.
- **Program out plays again by itself** if anything pauses it while its link is fine: a box, a call, Siri. It checks every 3 s, when the page comes back on screen, and when Program out is turned on again. This applies to the remote and to cameras watching the program (their box and full screen).

**Tests:** `e2e_tvremote`: the remote's Program out paused, with its link fine, plays again by itself (with 0.66.5 it was still paused 8 s later). `e2e_remote`: one tap of Stop recording doesn't stop it, the second does, and no box appears. `e2e_display`, `e2e_offline`, `e2e_remotejoin`, `e2e_remotescreenrec`, `e2e_campgm`, `e2e_media` and `e2e_serverblip` pass.

## 0.66.5 — Live numbers 1–9, no sound alerts for screens, a TV asking under Notifications
**Deploy:** `./aws/deploy.sh` (site only).

- **Live numbers stay within reach of the keys.** Each device that ever joined a show kept its own number for good, so in a show used again and again they climbed: with four sources in, a Mac's camera was 10, which no key can press. And since microphones were numbered after every camera number, none of them had a key at all. Now, in Live, each source in the show holds the **lowest number free** when it came in, and keeps it while it stays. One that leaves frees its number for the next, and one that comes back gets its own again if it's free (kept across a reload of the studio). Cameras, screens and microphones share them, so a microphone is just the next number. The 1–9 keys, Shift + number, the tiles, the bus, the mixer, PIP, the CCU, the AFV Follows list and the show log's "camera 3" all use these. **Edit** keeps its own angle numbers, one per device for good, since its clips are filed by them.
- **No sound alerts for a shared screen.** A screen, from this computer or another one over `/share`, and This computer's sound, are silent whenever nothing on them plays (slides, a desktop). They raised "it has gone silent" every time they went on air (25 times in one show), and a silent screen alone in the mix raised "The program has no sound". Neither is raised for them now, nor "its sound stopped", nor "left the show while its sound was in the program". Microphones and cameras are watched as before.
- **A TV asking to show the program is under Notifications.** It was only in TV screens, in the inspector. Now it's also at the top of Notifications (the bell, which turns red), with **Accept** and **Decline**. While the studio is hidden, the computer's own notification says so too, when alerts are allowed, as for sound alerts.

- **A TV or a camera watching the program whose link closed while its mode was changing** no longer throws an error in the studio ("Cannot read properties of null"). It showed up in about 1 run in 7 of `e2e_media`.

**Tests:** `e2e_livenumbers` (new): in a show whose devices already had numbers up to 9, three phones are 1, 2 and 3. One leaves, and the next to join takes its number. The keys cut to them, a reload keeps the numbers, and a TV asking turns the bell red and is let in with Accept there. `showlog.test.mjs`: a screen going silent, losing its sound or leaving raises nothing. The full suite passed apart from `e2e_soundcontrol` once (it passed on a re-run) and `e2e_media` (the race above, fixed; six clean runs after).

## 0.66.4 — a studio whose server connection dies quietly comes back by itself
**Deploy:** `./aws/deploy.sh` (backend and site: the server answers a studio's check; the Route 53 zone given for 0.66.0 is kept, so there's no need to give it again). It deploys the backend before the site, so the studio's new check only meets a server that answers it.

In a show, a phone that joined waited at "Host not here yet" for about 20 s, until Local network only was switched off and on. The show log and the server's records show why:
- The studio's server connection had died quietly between 97 s and 180 s into the show. The server had taken it for gone, so a phone asking who's here got no studio. The studio never heard it close: its own status said connected, and the cameras already in (straight to the studio, not through the server) carried on.
- The studio only spoke to the server every 4 minutes, and didn't check for an answer. Switching Local network only sent the phones a restart through the server, which found the connection dead. The studio connected again 2 s later, the server told the phone the studio was there, and it joined that second. Local network only itself had nothing to do with it: the phone joined after it was back on.

Now:
- **The studio checks its server connection every 30 s,** and the server answers each check. With no answer in 10 s, it lets that connection go and connects again at once, so a quietly dead one costs at most about 40 s, with nothing to press. Phones, TVs and the rest stay at every 4 minutes.
- **An older server isn't taken for dead:** the studio only waits for an answer once the server has said it gives one. (The local show helper keeps the copy of the server it fetched first, which doesn't.) That server still gets the check every 30 s, and if it has lost the studio it says so, as before.

**Tests:** `e2e_hostsilent` (new): the dev server takes the studio's connection for gone while the studio's side stays open (`/_dev/silence`), and a phone joining meanwhile waits at "Host not here yet". The studio connects again by itself and the phone joins 41 s after the drop. With 0.66.3's studio it was still waiting 50 s later. `core.test.mjs`: the server's first list says it answers, and a ping gets one. The server-connection suites (`e2e_serverblip`, `e2e_rejoin`, `e2e_leave_rejoin`, `e2e_phonerobust`, `e2e_offline`, `e2e_qrjoin`, `e2e_local`, `e2e_localshow`, `e2e_display`, `e2e_tvremote`, `e2e_remote`, `e2e_remotejoin`, `e2e_crew`, `e2e_kiosk`) pass.

## 0.66.3 — a Mac's screen reaches a wired Windows studio
**Deploy:** `./aws/deploy.sh` (site only).

- **Another computer's screen over `/share` no longer stays a black tile on a wired studio computer.** A shared screen gives the page no camera or microphone permission, so the browser hid the computer's address behind a random `name.local`. A studio computer on a cable couldn't look that name up (the lookup didn't cross from the Wi-Fi), never sent first, and its firewall dropped what came in. With Local network only on, a Mac's screen shared into a Windows studio stayed black. The share page now asks once for the microphone and lets it go at once (nothing is kept or sent), so the browser gives its real address, as a phone's camera page does.

**Tests:** `e2e_sharequality`, `e2e_remotescreenrec`, `e2e_screen`, `e2e_screenfit` and `e2e_stillscreen` pass.

## 0.66.2 — the kiosk without the offline badge's error
**Deploy:** `./aws/deploy.sh` (site only).

- **The kiosk no longer throws an error every second.** 0.64.0's OFFLINE badge is on the studio's page but not the kiosk's, and the check that shows it looked for it once a second, so the kiosk's console filled with "Cannot read properties of null". Nothing on screen was wrong. The kiosk now skips the badge and its notice: nobody is there to join phones by QR.

**Tests:** four browser tests brought up to date with the app (they failed every time in a full run):
- `e2e_kiosk` passes again with the fix above.
- `e2e_screen`: since 100bd80, a shared screen's recording copy runs at the screen's on-air rate, because a slower copy slowed the live screen too. The test still expected at most 15 a second. It now expects 30 in its 720p-at-30 show.
- `e2e_twomics`: since 0.61.8, a microphone added from + This computer has its **As** chosen there, Two mono tracks included, so the "Right-click it: Two microphones" tip no longer follows it. The test still waited for the tip. It now checks that **As** offers Two mono tracks and starts on Stereo, and that the tip doesn't repeat it.
- `e2e_output`: the test stops the sound engine for 1.5 s to check the gap is filled with silence, but the studio wakes a stopped engine every 2 s by itself, and that cut the stop to about 260 ms (filled correctly, but under the test's 700 ms). The test now holds the engine stopped for the whole 1.5 s, and the gap filled is about 1,480 ms.

## 0.66.1 — the local show helper finds the API
**Deploy:** `./aws/deploy.sh` (the site, for the helper people download; the backend keeps the Route 53 zone given once for 0.66.0, see `aws/README.md`).

The local show helper (`vuemesh-local.mjs`) asked for its certificate at `vuemesh.com/api`, but the site's API isn't there (it answers 403). The pages find the API through the site's `config.js`, which names its own address. Now the helper reads `config.js` the same way, or takes `--api <url>`.

**Tests:** `local.test.mjs` reads the API's address from a `config.js` like the live one, from one with a path, and from one with none. Run against the live site, it finds the API.

## 0.66.0 — a show on the studio computer's own Wi-Fi
**Deploy:** `LAN_ZONE=<the domain's Route 53 zone> ./aws/deploy.sh`, once (backend and site: a new API route, and permission to change records in that one zone). The stack keeps the zone, so later deploys are plain `./aws/deploy.sh`. It builds on 0.65.0.

The studio computer can now be the show's Wi-Fi and its server, so a show needs no router and no internet. Phones join by scanning two codes, and nothing is installed on them.

- **The local show helper,** `public/relay/vuemesh-local.mjs`, runs on the studio computer: `sudo node vuemesh-local.mjs` on Linux, or `node vuemesh-local.mjs` in an administrator PowerShell on Windows. It needs Node.js only. While it runs it:
  - **starts the hotspot**, with NetworkManager on Linux or Mobile Hotspot on Windows;
  - **answers for the show's address,** `https://<name>.lan.vuemesh.com`, on that Wi-Fi, with a **real certificate**. It gets the certificate from Let's Encrypt the first time it's online and keeps it. Phones trust it like any website, so no warnings and no profiles to install;
  - **serves the app and the joining** at that address, with the same server code as the cloud. A phone that has **never** opened VUEMesh joins with no internet;
  - **shows the welcome page** a guest network shows. When a phone checks whether it's online, it gets "You're on the show's Wi-Fi" with the show's address and a Done button, and after Done its checks pass.
- **The studio joins it,** beside the cloud: phones on the hotspot join through the helper, and phones on the internet through the cloud, into the same show. **Join by QR** now opens with **On this computer's own Wi-Fi**. It finds the helper, with a **Start the hotspot** button, and shows two codes, the Wi-Fi's (a phone's camera app joins it) and the show's address. Swapping QR codes is still there below it. A green **HOTSPOT** badge shows while it's running. The studio only looks for the helper by itself once it has found it once, so a browser never asks about this computer's network for nothing.
- **The certificate's check:** the API registers a show address for a host (`POST /events/:id/lan`, once; its secret renews it). Only that address's owner can place the record Let's Encrypt checks and remove it after (`PUT`/`DELETE /lan/:name/txt`), only in the domain's zone and only that record.
- **The deploy** publishes the server's own code (`relay/lib/`) and a list of the app's files (`app-files.json`) for the helper to keep copies of.
- **Limits:**
  - Windows' hotspot takes up to 8 devices, and can want a network connection of some kind to start (an Ethernet cable is enough).
  - Whether Windows lets the helper answer for addresses on its hotspot is still to be tried on a real machine.
  - A Mac can't make a Wi-Fi hotspot on its own.
  - On Linux a hotspot usually runs on 2.4 GHz, and takes the computer off the Wi-Fi it was on.

**Tests:** `e2e_localshow.py` starts the helper on test ports, with the dev certificate and the hotspot as a dry run:
- the studio finds it, gives it the show, joins it and starts the hotspot, and both codes read back right;
- a phone opens the show's address and joins with its camera, then goes on air;
- with the cloud gone, another phone joins too;
- a phone's "am I online?" check gets the welcome page, and after Done the answer Apple and Android expect;
- the helper answers for the show's address;
- another site's page is refused.

`local.test.mjs` checks the address answers, the hotspot commands for Linux and Windows (and the Mac's refusal), the Wi-Fi code's escaping, and the certificate request (openssl reads it and checks its signature). `core.test.mjs` covers the show address's registration and its check record.

**Not yet tried for real:** getting a certificate from Let's Encrypt (that needs the backend deployed with `LAN_ZONE`; `--staging` is there for a first try), and a real hotspot with real phones.

## 0.65.0 — join a show with no internet, by QR code
**Deploy:** `./aws/deploy.sh` (site only; it builds on 0.64.0). The deploy now sends `sw.js` uncached, like the pages.

A phone normally finds the studio through the server. With no internet there's no server, and a browser can't be one. Now the phone and the studio swap two QR codes instead:

1. **The phone shows its code.** On a phone that has opened VUEMesh before, the show opens with no internet, and the page says "No internet: join with the studio" with a QR code.
2. **The studio reads it.** **Join by QR** in the studio's top bar (or a click on the OFFLINE badge) shows what one of its cameras sees. The code can be read by this computer's camera or by any camera already in the show, so you can hold the phone up to Rosa's phone. The studio then shows its answer.
3. **The phone scans the answer** ("Next: scan the studio's code"). The two now have a small link straight between them. Over it the studio tells the phone which show this is (title, terms), the phone joins as usual (name, terms, camera), and its usual link (picture, sound, clips) is set up over that small one. Several phones can join one after another; the dialog is ready for the next.

- **A camera whose link has really gone, with no internet,** gets **"Can't reach the studio · Reconnect by QR"** after 8 seconds and comes back the same way, without a reload.
- **The app is kept on the device.** A small service worker (`sw.js`) keeps copies of the app's own pages and files. Online, everything still comes from the network as before and the copies are refreshed. With no network, the copies are used. It never keeps the API, films or uploads. Only a phone that has opened VUEMesh at least once can open it offline; a phone that never has needs the internet that first time.
- **Codes are small:** about 120–200 characters (an address on the Wi-Fi, two passwords and a certificate fingerprint). Each answer names the phone's code, so a phone takes only its own.
- Phones that joined this way count in the studio's phone count and show their names.

**Tests:** `e2e_qrjoin.py` takes everything offline (pages, API and signalling: the dev server's `/_dev/offline` switch has a `pages=1` now). Ana's phone, which opened VUEMesh once before, opens the show from its kept copy and shows its code, and the studio's Join by QR answers. Both QR images read back to their codes. Ana gets the show's details over the new link, joins with her camera, and goes on air. Rosa's link is then dropped: she gets "Reconnect by QR" and comes back. With the internet back, both stay.

## 0.64.0 — a show carries on with no internet
**Deploy:** `./aws/deploy.sh` (site only; it builds on 0.63.3, which changed the backend).

Pictures, sound and clips always went straight over the local network, but some things still went through the server during a show. With no internet, they stopped. Now everything already in the show carries on over the local network:

- **The phone remote works with no server.** Its buttons, and what the studio sends back (what's on air, the cameras' pictures), used to go through the server, so offline it stopped working. Now they go on the remote's own link to the studio (the one its Program out comes on), and through the server only before that's up. Turning Program out off keeps that link and has the studio send nothing over it, where it used to close it.
- **A camera reconnects over its own link.** When the studio reconnects a camera whose picture is stuck (or after a network setting changes), the new link is set up over the old one. The old one keeps the camera's picture in the show until the new one's up, and if the new one doesn't come up, the old one carries on. It used to drop the camera first and go through the server, so offline the camera was lost.
- **A Wi-Fi blink doesn't drop anyone.** With no server to reconnect through, a phone waits for its link to come back by itself (it usually does within 30 seconds) instead of giving up after 6. A TV whose link blinks is kept too.
- **The studio says it's offline:** "OFFLINE · THIS NETWORK ONLY" beside the phone count, with a note of what that means. It asks before you leave or reload while offline, since that would end every link with nothing to bring them back through.
- **The studio opens with no internet,** using the event as this computer last saw it, with its host controls.

Still needing the internet: a phone, TV or remote joining for the first time, and one coming back after its link has really gone (more than about 30 seconds without the network, a reload, or the studio reloaded). Joining with no internet is the next part.

**Tests:** `e2e_offline.py` runs a show with two cameras, a camera's program box, a TV and a phone remote, then takes the server offline (the dev server's new `/_dev/offline` switch: every connection dropped, nothing gets through). It then checks a cut reaching the phones' tally, the remote's on-air display, a cut from its button and its program turned off and on, the TV's standby, a stuck camera reconnected, a clip coming over, all still connected 15 seconds later, and the studio asking before leaving. It brings the server back: the badge goes and a new phone joins. Last, a studio opened with no API. With the old remote code it fails at the remote's first button offline; with the old camera links, at the reconnect. `e2e_tvremote.py` now checks that a remote's Program out turned off stays connected, with the studio sending it nothing.

## 0.63.3 — a dropped server connection doesn't take the show down
**Deploy:** `./aws/deploy.sh` (the backend and the site: the signalling Lambda changed).

A two-hour show lost every camera, the shared Mac screen, the TV and the phone remote at once, and none came back. Two hours to the second after the studio connected, AWS closed its server connection, as it does to every WebSocket at two hours. The studio was back in 2 seconds, but:

- **The phones let go of links that were working.** Pictures and sound go straight from each device to the studio over the local network, not through the server. A device that saw the studio missing from the server's list for those 2 seconds closed its link anyway. Now a connected link stays. Only one that fails while the studio is away is let go. The same goes for TVs, the phone remote's program, the camera's program box, and the studio's side when a phone's own server connection drops.
- **The phones couldn't get back in.** The phones answered the reconnected studio before AWS had finished connecting it. The server took the failed delivery for a dead connection and took the studio off its list. The studio believed it was connected while no phone could reach it, and each phone waited for an answer that never came. Now:
  - The server leaves a connection under 15 seconds old on the list.
  - A connection the server has no record of is told to connect again.
  - A device that hears nothing back from the server after connecting connects again.
  - A phone that gets no answer to its offer in 10 seconds asks again.
- **A phone remote whose own connection drops says who it is again** when it's back. The studio forgets it meanwhile.

A phone that really leaves still goes from the studio at once.

**Tests:** `e2e_serverblip.py` drops the studio's server connection with two cameras, a camera's program box and a TV running: every link stays the same throughout. On the old code all of them drop. It then drops a phone's connections, loses a phone's offer (it's back after its 10-second retry), and has a phone leave (gone in a moment). `core.test.mjs` checks the server keeps a brand-new connection that missed a message, takes off an older one, sends `rejoin` to a connection it has no record of, and delivers to the newest connection of a peer.

## 0.63.2 — the program box's × takes a tap on a phone held sideways
**Deploy:** `./aws/deploy.sh` (site only).

On an iPhone 17 Pro Max held sideways, tapping the × on the camera's program box moved the zoom instead. The zoom slider takes touches in a wide strip beside it (about 56 px to its left, and a little below it), and the × sat in the box's top-right corner, inside that strip.

- **The × is on the box's top-left corner,** away from the zoom rail.
- **Sideways, the box sits clear of the zoom slider's touch strip,** island side included. Where the two might still meet on some phone, the box is the one that takes the tap.

**Tests:** `e2e_campgm.py` taps the box and its × at iPhone 17 Pro Max, 17 Pro and SE sizes, upright and sideways with the island's safe area: each tap lands on them, and the zoom's touch strip stays clear. On the old layout it fails at the 17 Pro Max held sideways.

## 0.63.1 — Edit has its Full screen button; a camera watching the program isn't "gone silent"
**Deploy:** `./aws/deploy.sh` (site only).

- **Edit has the Full screen button again,** as the studio has. It went with the live controls when Edit got its own window (0.62.0), though F still worked there, with no button to see or to come back out with. Edit stays laid out as it is, and Monitor and Help stay in its bar.
- **A camera paused by its person isn't "gone silent".** A show log had the alert twice, each six seconds after a phone started watching the program: watching pauses its picture and sound, on purpose. Pause feed did the same. A paused camera's silence is no longer an alert; back live and silent, it is.

**Tests:** `showlog.test.mjs` checks a paused camera's silence raises nothing and that it does once it's live; `e2e_editpage.py` goes into full screen and back with the button.

## 0.63.0 — camera people can watch the show
**Deploy:** `./aws/deploy.sh` (site only).

Off air, a camera person had no idea what the show looked like. Now every camera shows the program, small and silent, in a box to the right of the record button.

- **The box shows whenever that camera isn't on air.** On air it steps aside, and the studio sends that phone nothing. No sound, ever: the phone is in the room, recording, and the program's sound would go straight back into its microphone.
- **Tap the box to watch full screen.** That camera's live picture pauses (as Pause feed does) and the studio's tile says **WATCHING**. Recording carries on as it was. **Back to camera** and they're live again.
- **The director can still reach them:** messages come up over the program, and clicking a watching camera in the studio (or right-click, **Call back to camera**) asks them back. The phone buzzes and says the director wants them, and it does the same if the director puts them in preview. Clicking doesn't cut to them: there's nothing to see until they're back.
- **× tucks the box away** (a small Program button brings it back), remembered on that phone. Nothing is sent while it's tucked away.
- **Up to 4 cameras to start with:** each is a picture the studio computer sends, so TV screens → *Cameras watching the program: up to* sets how many (0: none). Camera 1 gets it first, then 2, and so on; when one leaves, the next in line gets it.
- **Light on the studio:** each one gets a quarter-size picture at 15 frames a second (about 0.35 Mbps), half size when watching full screen, on its own link as a TV's is. A camera's key works only while it's in the show; one that leaves loses it. Monitor lists each one under Transfers.

**Tests:** `e2e_campgm.py`: the box off air, nothing on air, watching full screen and WATCHING in the studio, a message over it, called back by a click, back to camera, tucked away, up to 4 (at 1 only the lowest-numbered camera, at 0 none), and a camera that leaves (the next one moves up).

## 0.62.8 — the auto director changes angle around every camera, not just the phone
**Deploy:** `./aws/deploy.sh` (site only).

With a phone, a shared screen and this computer's webcam, the auto director cut to the phone and stayed there. A phone rates its own shot (steady, level, well lit) and on a stand it rates itself near-perfect; a screen and this computer's own camera don't rate themselves, and were counted as middling (0.5). The director only changed angle for variety to a shot within a whisker of the one on air, so nothing ever qualified.

- **A source that never rates its shot counts as a good one,** not a middling one: this computer's cameras and shared screens don't shake. A phone whose ratings stop coming is still middling until they're back.
- **Changing angle for variety goes to any good shot,** whichever has been off air longest, after the longest hold (12 s). Before, it had to score about as well as the one on air.
- **A good shot isn't pulled off air early because another rates higher.** "A better shot is available" now only replaces a shot that's middling or worse.

**Tests:** `sequence.test.mjs` checks that a phone rating itself perfect, a screen and a webcam all get the air within a minute, the two not yet seen first, and that a good screen shot holds its full time.

## 0.62.7 — the program's sound on an iPhone plays like a music app's: screen locked, other apps, CarPlay, Now Playing
**Deploy:** `./aws/deploy.sh` (site only).

The TV page (`/tv`) and the phone remote's Program out play the program's sound the way a music player does (as the avatar page plays its music), so you can lock the phone, switch apps or drive and keep listening.

- **The sound plays from a player of its own,** a plain audio player beside the picture, not the picture itself (an iPhone pauses a video in the background), and never through Web Audio (iOS stops that when the screen locks, and over wireless CarPlay it stutters).
- **The show is in Now Playing,** on the lock screen, in Control Center and on CarPlay, with the app's icon: on the remote, what's on air (it changes as you cut) over the show's name; on the TV page, the show's name. Play and pause there are Sound on and Sound off here.
- **The phone is set to play media while the sound is on** (Safari 17's audio session): it plays with the ring switch on silent, into earbuds or the car, and carries on in the background.
- **Sound on is remembered on the TV page too.** Opened again, it comes on by itself where the browser allows, or with the first tap or key anywhere; the button says "Tap for sound" until then.
- **The studio keeps a phone that's still connected,** even when its pings come late (a locked phone's timers are held back) or its signalling drops: the picture and sound go straight between the two, and the connection checks the other end is there by itself. It used to close it after 20 s without a ping, and the sound stopped. A TV page that closes is still let go at once.
- **The TV page doesn't start its link again after a gap in its clock while the program is still coming in.** A gap meant a computer had slept; on a locked phone it's only its timers held back, and starting again cut the sound.

**Tests:** `e2e_tvremote` checks the TV's sound (its own player, off to start, on with Sound, the show in Now Playing playing then paused), the remote's (back on by itself after a reload where the browser allows, what's on air in Now Playing), and that the studio keeps a still-connected TV and remote whose pings are 30 s late and whose signalling has gone.

## 0.62.6 — the remote's Program out has the program's sound, and stops stuttering
**Deploy:** `./aws/deploy.sh` (site only).

On an iPhone, the TV page (`/tv`) played the program smoothly, with its sound; the phone remote's Program out was choppy, and had no sound at all.

- **Program out on the remote has the program's sound,** with a **Sound off / Sound on** button beside Program out: put earbuds in, turn it on, and hear what's on air as you cut. It starts off (a phone in the studio's room would play it back into the microphones), and the phone remembers. Opened again with it on, it comes on with the first tap anywhere (a phone plays sound only after a tap), and the button says "Tap for sound" until then.
- **The remote's camera buttons are drawn again only when something in them changes.** The studio sends what's on air every second (the mixer's levels change that often), and each time the remote drew every camera button again, with its picture. On a phone that's enough work to make the program above them stutter, once a second.
- **A remote that's locked, in the background or scrolled past Program out no longer tells the studio it's falling behind.** It shows nothing then, and the studio took that as frozen and lowered its picture to the floor (0.6 Mbps), which took a minute and a half to come back up. A show log had the remote's Program out "frozen 18 s of every 20" while the phone was locked.

**Tests:** `e2e_tvremote` checks the remote's sound: there, muted to start, on with a tap, remembered and back with the first tap after a reload, and off again; and that the camera buttons stay as they are while the studio sends what's on air each second.

## 0.62.5 — a shared screen's sound isn't "reconnected" every 12 seconds
**Deploy:** `./aws/deploy.sh` (site only).

From a 10-minute test show (this computer's three webcams and its Scarlett, another computer's screen over `/share` with its sound, and a phone, cut every 8 s with Record program on): nothing dropped out. The program held 30 frames a second, the screen came in at 30 a second, and Record program dropped no frames. In Edit, every shot was there, with every source's own recording. But the event log said "Presenter Mac's sound had stopped reaching the mixer: reconnected it" every 10 to 12 seconds, start to finish, while the show log had its sound at -10 dB every second.

- **The studio no longer mistakes a shared screen's quiet moments for its sound being lost.** The watch that puts back a sound that stopped reaching the mixer looked at it for a fiftieth of a second every 2 s. Another computer's screen sends exact silence between sounds (a notification, a video's quiet parts), and those looks kept landing in it. Now any sound the show log hears, which it looks for 20 times a second, counts.
- **A shared screen with nothing playing is put back once, not every 12 seconds.** Exact silence from it looks the same as sound that stopped reaching the mixer, so it's still put back after 8 s. When that brings nothing, it's tried again after 16 s, 32 s and then once a minute, and the event log says so once. A source whose sound comes back and then stops again is put back at 8 s and logged again.
- A sound that really stops reaching the mixer is still put back: about 12 s after it stops, where it was about 10.

**Tests:** `showlog.test.mjs` checks the watch: sound with silence between is never put back; one that stays silent is put back after 8, 16 and 32 s and then once a minute, logged once; one that comes back and stops again is logged again.

## 0.62.4 — Edit on a laptop: the panel buttons always there, the two viewers level
**Deploy:** `./aws/deploy.sh` (site only).

On a 1280 x 720 laptop screen (Chrome's window about 1280 x 633), with the media panel and the inspector open, each viewer has about 365 pixels.

- **The Media panel and Inspector buttons are in the top bar,** beside Help, where they're always there. They were at the end of the Program viewer's row of buttons, and with the inspector open that row didn't fit, so the button to close the inspector again was cut off.
- **A viewer's buttons go onto a second line when they don't fit** instead of being cut off: Insert, Overwrite, Subclip and Export clip under the Source, and the edit's Length under the Program.
- **The Source and Program pictures are the same size and level with each other.** The Program's sound meters take some of its width, so its picture was smaller and lower, and the Source's looked off. Now both are drawn at the smaller of the two sizes.

## 0.62.3 — Edit's sound is the show's sound, as it was heard
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (a Linux laptop, its webcam and its own screen, both added without sound; a Mac's screen over `/share` with its sound; an iPhone): in Edit, the webcam's and the screen's shots were silent. Live, the program had sound under them the whole time (the Mac's sound and the iPhone's microphone, about -9 dB), because the mix carries every source's sound whatever's on air. Edit played each shot's own sound, and those two recordings have none.

- **The program's sound as aired plays under the whole edit,** on a new **Sound as aired** track, whenever there's a Record program recording. It's on by default, with **Program sound under the whole edit** in Edit's Audio mixer to switch it off.
- **The shots' own sound and the microphone tracks start at nothing** while it's on, because the program has their sound already (both at once is the same sound twice, a moment apart). Turn one up in the mixer to blend in its own recording. A level you set yourself stays as you set it.
- **Switched off,** each shot plays its own sound, as before, and the program's sound plays only under a shot with none of its own (a webcam or a screen added without sound), except where a microphone track plays.
- Where the program recording hadn't started yet (its first second, while its encoder starts), the shot's own sound plays, so the edit never starts silent. Each piece of the program's sound is the moment its shot shows, so it holds when you move or trim shots by hand.
- **A recording made without sound says so,** so Edit knows. Recordings from before this version are checked once when Edit opens.

**Tests:** `e2e_remotescreenrec` checks Edit's sound: the program's under the whole edit, the shots' own at nothing; then, switched off, the program's only under the shot with none of its own, playing there. `sequence.test.mjs` checks the Sound as aired track both ways, beside microphones, levels set by hand, the program starting late, and an edit made by hand.

## 0.62.2 — every source that aired is in Edit, not black
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (a Linux laptop, its webcam, a Mac's screen over `/share` and an iPhone, with Record program): in Edit, the Mac's and the iPhone's time on air was black. Only the webcam's clips and the program as aired had come in. The Mac's screen was never recorded anywhere: the share page sends only the live picture, and the studio recorded only its own computer's cameras and screens. None of the iPhone's three clips had arrived 2½ minutes after it was last on air. A phone sends a clip only once it stops recording (8 s after it goes off air), and on a busy network it eases its sending down to keep the live pictures going (that show's Phone remote froze every 20 s).

- **Another computer's screen is recorded in the studio while it's on air,** as this computer's are: from the picture it sends (the output's size), with its sound, from Record program until 5 s after it goes off air. Edit has its time on air from its own recording, and it's in Media as that computer's name. The event log says "Recording Presenter Mac (here, as it arrives…)". It's finished and kept when that computer leaves, and a new recording starts if what it sends changes.
- **Where a source that aired has no footage, Edit shows the program as aired there,** at the same moment, instead of black: a phone whose clip is still on its way, one that keeps its clips, or a source nothing recorded. When the phone's clip arrives, the automatic edit uses it instead. The same goes for the time a camera's recording stopped while it was still on air. Without a Record program recording, Edit is as it was.

**Tests:** `e2e_remotescreenrec` puts this computer's webcam, another computer's screen over `/share` and a phone that keeps its clips on air during Record program, then checks Edit: the screen from its own recording, the phone's time from the program as aired, neither black. `sequence.test.mjs` checks the fill: where it goes, its dissolve, the real clip replacing it, and nothing changed without a program recording.

## 0.62.1 — preview beside the program
**Deploy:** `./aws/deploy.sh` (site only).

- **Tap: Preview shows two monitors side by side:** the preview (green, left) and the program (red, right), level, the same size, each as big as fits beside the switcher. The preview was a small box in the program's bottom-left corner, which looked like picture-in-picture, and the real picture-in-picture could land right on it. An empty preview says so ("Tap a source to put it here"). **Tap: Air** has the program alone, as big as fits.
- **The preview shows what CUT or AUTO will put on air, picture-in-picture included:** a screen in preview has the camera it would get in its corner, at the corner and size chosen, while the program shows its corner only once the screen is on air. After CUT, what left air waits in preview, as before.
- The labels on both monitors stay inside them and stop short of the clock when a source's name is long.

## 0.62.0 — Edit laid out like an editing suite: Source and Program side by side
**Deploy:** `./aws/deploy.sh` (site only).

- **A Source viewer and a Program viewer, side by side** (as Premiere's Source and Program monitors, or Resolve's two viewers), where one monitor flipped between them and hid the edit while you looked at a recording. Open a recording from Media and it plays in Source while the Program still shows the edit at the playhead. The one you last clicked has the keys (an amber line across its top): Space, J K L, the arrows, I and O; clicking the timeline gives them to the Program. In a narrower window (under about 1,200 pixels wide, with the side panels as they start) they take turns, their two headers as tabs.
- **Each viewer has its own transport:** go to In or the start, back a frame, play, forward a frame, go to Out or the end, and, on the Program, previous and next edit; Mark In and Mark Out on each (on the Program they set what Export renders), Insert and Overwrite on the Source, with Subclip and Export clip. Its header says what's showing and where (the angle at the playhead, its timecode), where labels sat over the picture.
- **A bar under each picture:** where you are in the recording or the edit, with its In to Out range; drag it to scrub. The Program's says how long the edit is.
- **The timeline's tools are icons, as an editing suite's:** Selection, Ripple, Rolling, Razor, Slip, Slide and Hand (V B N C Y U H), then Undo and Redo, Split, Snap, Marker and Dissolve, **Add** (titles, slates, images, picture-in-picture, tracks), Split at turns and Collapse gaps, and zoom out, in and to fit; the playhead's timecode at the left. Hover over one for its name and key.
- **Tracks are named V2, V1, A1, A2** beside their names; click the name tag to target the track for Insert and Overwrite (blue). Lock, show or hide (an eye) and Mute (M) are icons, and moving a track up or down or deleting it is there when you point at it, so the names have room. Each video clip shows its recording's first frame at its head; the ruler has minor ticks, and the playhead a tab on it.
- **The inspector is the studio's cards:** the selected clip (named, with its track, start and length), the recording or subclip from Media, the audio mixer, Output and Export, each opened or closed with Close all, and kept as you left them (apart from the studio's).
- **Export is in the top bar,** as in an editing app. The live show's own controls aren't: no Beacon, Full screen, Camera control or "0 phones in" (the Edit window connects to no phones), and an **Edit** tag says which window this is.
- **Auto-sync in Edit no longer starts the studio's clap check:** it lined up the recordings and also said "The sync check is for cameras plugged into this computer".
- **"Program (as aired)" in Media is called that,** not "? Program (as aired)", and Edit no longer shows the live program recording's "? video" note.

**Tests:** `e2e_media` checks the Source and Program viewers are side by side with a recording open; `e2e_audio_console` finds the audio console button in the mixer's card.

## 0.61.17 — why the Scarlett really dropped; a renamed interface comes back
**Deploy:** `./aws/deploy.sh` (site only).

From three live runs on the same Windows studio (three USB webcams, a Focusrite Scarlett 2i2 4th Gen, one USB controller): the Scarlett's sound stopped dead, nothing at all arriving from it, and about 12 s later Chrome gave up on it and the studio opened it again. That happened every minute, three minutes in a row, every 15 minutes. It wasn't the webcams at 1080p, as 0.61.9 had it: with them at 720p it still dropped (4 times in 19 minutes, then 9 in 28). Each drop came about a second after something looked at the Scarlett's **Easy Start** drive (the small "Scarlett Welcome Disk" it shows when new), mostly Dell TechHub, the computer maker's software, on its 15-minute cycle. With Easy Start turned off there were no drops in 31 minutes, at 720p and with all three webcams at 1080p, through two of Dell's cycles and 25 of the same drive checks made on purpose.

- **The alerts for an interface on this computer say what to try first:** turn off Easy Start if it shows up as a small drive (open Focusrite Control 2, or hold 48V while plugging it in, then unplug it and plug it in again), because software that looks at the computer's drives stops its sound. The 1080p note comes second, and only beside cameras at 1080p on the same computer. A phone's microphone gets no advice about this computer. The show log keeps all of an alert's text (alerts were cut at 300 characters).
- **The alerts tell a device on this computer that stopped sending from one sending silence.** "No sound is arriving from the device" (nothing arrived at all, as from the Scarlett) comes with that advice. "It has gone silent (the device is sending silence: check its cable, its gain and any mute)" comes when sound arrives but it's all quiet. A phone's stays "it has gone silent": its sound keeps arriving, as silence, when its network drops.
- **A saved interface under a new name comes back.** Installing Focusrite's driver renamed the Scarlett from "Microphone (Scarlett 2i2 4th Gen)" to "Analogue 1 + 2 (Focusrite USB Audio)", and the studio said it "isn't plugged in now" and forgot it for good. A saved camera or microphone is now found by its id, its name, its USB id or, renamed by its maker's driver, the one device of that maker on the other driver (going by the device's own name, never one you gave it). It comes back with its two-microphone split, the names it was given and its mixer settings, and the log says it's there under another name.
- **One that isn't plugged in stays saved, and comes back when it is**, mid-show too. That includes one that dropped out and didn't come back in 30 s, one that wouldn't open (another app holding it: it's tried again for a minute and a half), and one plugged in while the studio is still opening the others. + This computer lists each one, saying which ("Not plugged in", "Plugged in, but it couldn't be opened", or "Kept" until cameras or microphones are allowed), with **Forget**. One that still won't open once its tries are up is tried again, with its saved settings, each time + This computer opens. Before, it was dropped from the list the next time anything was saved. A webcam unplugged for longer than 30 s is kept with its own microphone (it came back without sound).
- **It's never mistaken for another device:** two of the same microphone, two Focusrites on the same driver, a laptop's two inputs, or two inputs of one interface stay separate. A device you removed by hand isn't brought back in place of a missing one like it, and adding one by hand clears only its own saved entry. A webcam that drops out is never opened again as another of the same name that's already in the show (one of three identical webcams showed another's picture), and one moved to another USB port mid-show is known by its new id from then on.
- **The show log says more:**
  - How much sound each microphone and camera on this computer delivered every second (`dv`). Its summary says how long nothing arrived from one, and how many times.
  - Each webcam's real capture size and frame rate when it joins or is opened again, and whether the browser is shrinking a bigger picture (when it is, its USB still carries the bigger one).
  - Every time the computer says its devices changed, counting webcams of the same name (one of three unplugged is logged), and saying so when no camera or microphone changed.
- The two sides of a split input (Input 1, Input 2) now each count their own sound in the log; the second side's figures read as nothing before.

## 0.61.16 — sound alerts under a bell, not over the program; closing the switcher is Tap: Air again
**Deploy:** `./aws/deploy.sh` (site only).

- **Sound alerts are under Notifications, a bell in the studio's top bar,** where a red box covered the top of the program. The bell counts what's happening now, red until you've looked, then grey while it lasts; its list has each alert and when it started (the program's own first), with **Turn on** for a source that could stand in, as the box had. One that clears moves to **Earlier**, with when it started and ended (**Clear earlier** empties it). They're still in the show log, and still on this computer's own alerts while the studio is hidden, if those are allowed.
- **The phone remote doesn't show sound alerts:** no red box over its cameras, and it no longer buzzes for one.
- **Closing the switcher puts tapping back to Tap: Air.** With Tap: Preview chosen, closing the switcher (⇅) still sent a tapped source to preview, with no CUT, AUTO or T-bar to take it to air. Closed, a tapped source goes straight to air; opening the switcher again brings back Tap: Preview.
- **No balance slider on the audio mixer's strips** (in Live and in Edit): each has its fader and Mono, with AFV / ON / OFF in Live and Mute in Edit. Balance is still in the audio console, beside the EQ.
- **The sync check (clap once) has its own prompt over the program,** dark rather than red: its countdown, "clap now" and what it found had shared the sound alerts' box.

## 0.61.15 — Work with VUEMesh: collaborate, or host your shows here
**Deploy:** `./aws/deploy.sh` (site only).

- **The partners page is now about working together** (`/sponsors`, "Work with VUEMesh"): **Collaborate on something** (integrations, devices, models, or a show made together: hit me up), **Host your shows on VUEMesh** (publishing is built and switched off for now; hosted and played here, with the watch page checking every contributor's signature, partnering on the delivery: you cover what it costs to host and serve your content), **Send something to try** (gear, honest results either way) and **Get into the breaks of shows people watch** (local sponsors). The house rules stay.
- Gone from it: founding pilots and founding-partner pricing, "How VUEMesh will pay for itself" with its paid plans, and sponsor placements "coming as the audience grows".
- Its links read **Collab** (the home page's and the tour's top bar) and **Work with me** (the footers of the home page, the studio, Edit and the kiosk).

## 0.61.14 — the home page sells the whole studio; no beta, no "free"
**Deploy:** `./aws/deploy.sh` (site only).

- **No "Beta · experimental software, no warranty" strip** across the top of the home page, the tour, the partners page, the watch page and the camera, and no **BETA** pill in the studio's and Edit's top bar. The Terms stay linked from the home page and the camera's join form, and are still agreed to when a show is created or joined ("VUEMesh comes with no warranty", where it said "is beta software with no warranty").
- **No "beta" or "free" in what VUEMesh says about itself:** the share picture for links (`og.png`: "Switch · Mix · Record · Stream" where it said "Free in beta", and the whole studio in its line), the home page's description for search and link previews, the partners page, What's new's title and the watch page. The Terms of Use are as they were.
- **The kiosk opens again:** 0.61.12's message box and the stream key's Show button weren't in the kiosk's list of the studio's controls it lacks, so the kiosk stopped while starting (as the Edit window did, fixed in 0.61.13). A test now checks that Edit and the kiosk have, or stand in for, every control the studio wires up as it loads.
- **The home page leads with the studio, not the phones.** Its opening line is a complete production studio in one browser tab: USB cameras and an audio interface, any screen (yours or a presenter's laptop), your own clips and ads, and phones when you want more angles.
- **The setups diagram has the whole architecture:** two new setups come first, **Solo desk** (two USB webcams, an audio interface, your own screen, your intro and ads; out to a second screen, a live stream, a video call as its camera, and every source recorded) and **Talk or meeting** (the presenter's laptop over `/share`, a webcam on the speaker, the lectern mic, a phone on the audience, a video package; out to a projector with the speaker in the corner, an online audience, and the recording). Phones are the **Event** setup, with sponsor spots through every break. A shared screen and a clip are sources of their own in it.
- **Any device, any job** has **Shares its screen** (a laptop or desktop) and a **USB audio interface** row (stereo, or each input its own).
- **Then make it a real control room** has two more: **Clips, ads and packages**, and **Breaks your way** (six slates, your message and tone, sponsors through every break, or your own clip). **Then add your sources** replaces "Then the cameras show up", and the beacon is **Phones join with one scan**.

## 0.61.13 — the Edit window opens again; a screen in Camera control and the audio console
**Deploy:** `./aws/deploy.sh` (site only).

- **The Edit window opens again.** 0.61.12's new message box and the stream key's Show button weren't in the Edit window's list of the studio's own controls, so the Edit window stopped while starting and never showed. (Found by the browser tests that open Edit.)
- **Another computer's screen in Camera control has CUT.** It showed "Waiting for this camera to send its settings" with nothing to press: a screen never sends camera settings. It now says it's another computer's screen, with nothing to adjust from here (the presenter picks Slides and text or Video and motion), and has its CUT button, for a cut in a pinch. A camera still waiting for its settings has CUT too.
- **The audio console shows a stereo source's two sides:** each strip had one meter, whatever came in. A stereo source (this computer's sound, a screen, a stereo input, Clips) now has one for each side, as the studio's own mixer already showed; Mono pressed makes it one.

From a second show log (the same Linux studio, the Mac's screen over `/share`, 13 minutes, with tab switching): the Mac sent 27 to 30 frames a second the whole time, so it wasn't the source of the drops. Its Chrome encoded the screen in software (OpenH264), not on its graphics hardware: Chrome keeps a shared screen on its software encoder. The drops were the studio laptop's: Record program (H.264 on its processor, 31 ms a frame on average against 33 ms to spare, up to 74) skipped 1,070 of 15,466 frames, most when the audio console opened and when this laptop's own screen was shared too (recorded on its own as well), alongside Program out, a TV and the webcam's recording; the TV froze 12 times. On a laptop like this one, fewer things at once (Output's "Cameras record their time on air" off, or no screen shared on the studio's own computer) gives Record program room.

## 0.61.12 — another computer's screen: smooth for video, why it's slow in the log; messages in a proper box
**Deploy:** `./aws/deploy.sh` (site only).

From a show log (a Linux studio, another computer's screen from a Mac over `/share`): the screen came in at 29 to 30 frames a second for a minute and a half, then, about 20 seconds after its sound started (a video playing), at 10 to 13 for the rest of the show, with no loss on the way. The studio drew every frame it got (the program held 30): the Mac was sending fewer. A screen kept its size and let its frame rate give way, which is right for slides and wrong for video.

- **The share page asks what you're showing:** **Slides and text** (sharpest: every word stays readable, frames give way first, as before) or **Video and motion** (smoothest: keeps 30 frames a second, the size gives way first). It can be changed while sharing, and this computer remembers it. When the picture is held back on slides, it suggests Video and motion.
- **The show log says whose end a slow picture was:** a phone or another computer now reports what it sent (frames a second, kbit/s), what held it back (its processor, the network) and its encoder, every few seconds, into the log (`tx`, `txk`, `lim`, `enc`, `hw`, `tier`). The summary names each stretch of 10 s or more a remote picture arrived slowly on air or in preview, such as "Josh's picture arrived at 11 frames a second (of 30) from 08:46:35 for 1 min 19 s: it sent 12, held back by its processor". (The log above, from before this, can only say "no word from its side".)
- **No message box for another computer's screen:** its share page has nowhere to show one. Not under its tile, not in Camera control, and Message all cameras leaves it out.
- **Messages to a camera open a proper box:** **Message…** under a camera opens a box to type in (full size, with their last reply), where a small field squeezed under the tile was too small to use in a narrow Sources panel. The last message or reply stays on one line beside the button.
- **Chrome stops offering to save passwords in the studio:** the stream key was the studio's one password field, and with one in the page Chrome took the boxes around it for a login, offered saved passwords in them and asked to save the key. It's a text field shown as dots now, with **Show** beside it. (The admin page's key stays a password field: that one is a password.)

## 0.61.11 — another computer's screen in stereo, on the hardware encoder
**Deploy:** `./aws/deploy.sh` (site only).

- **Another computer's screen sends its sound in stereo.** WebRTC sends Opus in mono unless both sides say otherwise, and nothing did, so a shared tab's music or a video's stereo arrived as one channel (both sides the same), on a one-meter strip. The share page now says its sound is stereo, the studio answers that it takes it, and the screen's mixer strip is stereo (two meters, balance), as a screen shared on the studio's own computer already was. Phones don't say so, so their sound is as it was.
- **Another computer's screen is encoded on its graphics hardware where it can be:** the link prefers H.264, which a Mac or a Windows PC encodes on its hardware, over VP8, which is encoded on the processor (a busy 1080p screen at 30 frames a second is a lot of work for it). A studio browser without H.264 gets VP8 as before.
- **The share page says what it's sending:** its size, frame rate, codec, whether it's on the graphics hardware, and what's holding it back (the processor, the network), every two seconds. Off air it's half size, as every camera is, until the studio puts it in preview or on air.
- Measured with a busy 1920 x 1080 screen redrawn 30 times a second, with a tone on the left only: on air it arrived at 1920 x 1080 and 30 frames a second, as before (there's no cap at 15: that's for a screen shared on the studio's own computer in a 1080p show); its sound arrived left only, where it had been the same on both sides at half the level.

## 0.61.10 — a shared screen is always shown whole; What's new reads as written
**Deploy:** `./aws/deploy.sh` (site only).

- **A shared screen is always shown whole.** The show's framing (Fill, the default) cropped every source to the output's shape, so a Mac's 16:10 screen in a 16:9 show lost its menu bar and Dock. A screen, shared on this computer or from another one over `/share`, now keeps all of itself with bars at the sides, on the program, in a dissolve into it, in the preview box and on its tile. Cameras still follow Fill or Whole shot. A screen's recording is marked a screen, so Edit and Render MP4 show it whole too (an item's own Framing still wins). (Tried with a 1440 x 900 screen with a red menu bar and a green Dock, in a 720p show on Fill: before, both were cropped off; now both are on the program, from this computer and over `/share`.)
- **What's new shows code inside bold text.** A bold lead-in with code in it, such as "The WHIP receiver (`tools/whip_receiver.py`) no longer sticks…", showed its stars as written and lost the code ("The WHIP receiver () no longer…"). Seven older versions had one; they read as written now.
- **The changelog, What's new and the README stay in step** (`npm test`): one version in `package.json`, the app and the newest heading here; every version renders on What's new without stray stars or backticks; and every file and picture the README links to is in the repository.

## 0.61.9 — another computer's screen reaches the studio on the real site
**Deploy:** `./aws/deploy.sh` (site only).

- **Another computer's screen joins the studio on vuemesh.com.** The share page (`/share`) never loaded the site's settings (where the studio's signalling is), so it looked for the studio at the site's own address, which only the dev server answers. On the real site it sat on "Finding the studio…" or "Waiting for the studio to open…" with the studio open, and never showed up under Sources. It worked on the dev server, where it was tested. (Tried against a new show on vuemesh.com with the page as it is now: it joined, linked on this network, and was a source in the studio in seconds.)
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
