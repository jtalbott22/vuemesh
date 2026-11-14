# How VUEMesh fits together

VUEMesh turns everyone's phones at an event into one multi-camera production. Almost all of the work happens on the local network at the venue; the cloud only helps devices find each other.

## The roles

| Role | Runs on | What it does |
|---|---|---|
| **Studio** (host) | A laptop or desktop | Sees every live camera, switches the program, mixes sound, records the program, edits and renders. The heart of the event. |
| **Camera** | Any phone (or a computer with a webcam) | Records full-quality clips and sends a light live picture to the studio. Keeps a copy in *My footage*. |
| **Microphone** | Any phone | Records sound for the whole event, placed near the people talking. |
| **Beacon** | Any screen: a TV, tablet, spare laptop, or the studio itself | Shows the event's join code and an optical clock. Phones glance at it to join and to line their recordings up. |
| **Program out** | The studio computer only | A clean window of the program for a TV, projector or OBS. |
| **Monitor** | The studio computer only | A second window with network, device and transfer details. |

## One beacon clock per event

Recordings from different phones line up because each phone reads the same optical clock from the beacon. **It doesn't matter which device shows the beacon, only that the whole event uses the same one.** Two beacons running separate clocks would put phones on different timelines.

This matters most if an event ever uses more than one studio (see *Satellite studios* below): every studio and every phone must sync to the same beacon.

## What only the studio computer can do

- Switching, the auto director, the lower third, clips and the mixer.
- Program out and Monitor windows: they take the picture and sound straight from the studio tab, so they must be **in the same browser on the same computer**.
- Recording the program (downloaded, and kept in that browser), and sending each camera person their part of the live cut.
- Editing and rendering.

### Why a phone can't be the studio

The studio decodes every camera's live picture at once, mixes sound, and keeps hours of full-quality recordings. A phone's screen is too small to direct from, and its battery, memory and heat limits would show within minutes. **An iPad or other large tablet may work** (best with a keyboard) but is untested; a laptop is the supported choice.

### Which browser for the studio

Use **Chrome or Edge on a Mac or Windows PC, or Safari on a Mac**. They record H.264 video, which every phone plays.

Browsers on Linux (Chromium and Chrome) can't record H.264 and fall back to VP9. That plays on Android and computers but **not on iPhones**: the studio shows a notice when this happens, and iPhones mark such files "Can't play on this phone".

## Network and capacity

Bring your own router and keep everyone on it. Venue and guest Wi-Fi often stop devices from reaching each other ("client isolation"), and then nothing connects locally.

Devices that can't reach each other directly, on the network or over the internet (a phone on mobile data, a strict office network), connect through the site's relay (TURN, `aws/stun`) instead. It works, but it's the slowest path (pictures drop to the lowest live quality, "Mobile data or a relay" in the README), and it's there as a fallback, not a plan. It may also be switched off at any time (from Admin, or by itself once the month's data allowance runs out), and then those devices can't connect at all, so for a show that matters, keep everything on one network. **Local network only** in the studio never uses it.

- **Router:** Wi-Fi 6 on 5 GHz, in the room. A travel router works.
- **Studio laptop:** plugged into the router by cable, and plugged into power.
- **Live pictures:** about 1.2 Mbps per camera (light).
- **Recordings:** about 12 Mbps per phone while recording at 1080p (90 MB a minute), about 50 Mbps at 4K. Each clip is sent when it ends.
- **Live cut:** about 95 MB per person for each five-minute part.
- **How many cameras:** one laptop comfortably shows about **12 live pictures** plus a few microphones. On older Wi-Fi 5 or a busy venue network, plan on 6 to 8.

### Record-only overflow

The studio shows up to a set number of live pictures (12 by default; *Live → Output*). Phones that join beyond that are **recording only**: no live picture, but they record and send every clip as usual, and their phone tells them so. When a live camera leaves, the phone that has waited longest moves up automatically, and the director can **Swap in** any waiting phone (the live camera that has been off air longest steps back).

### Calls

A call (`/call`) has no studio: up to 6 people, each connected to each of the others (a "mesh": everyone sends their picture to everyone, which is why it stops at 6). Each pair has one connection, with three places in it from the start (sound, camera, screen), and only one of the two ever makes an offer, so a shared screen, or another camera (Switch camera), just fills its place. Pictures play muted, and each person's sound in a player of its own, started by hand (Tap to hear the call, if the browser wants a tap first); if someone's microphone is on and no sound has come from them for 8 seconds, they're asked to send it again.

Keeping people out who weren't asked, with no accounts:
- **The link carries the room's key after the `#`**, which browsers never send to a server. The page proves it has the key with the key's hash; the server keeps only a hash of that. The code alone gets nobody in.
- **Typing the code needs the 6-digit PIN** (whoever started the call has it). Ten wrong PINs and only the link opens it.
- **A waiting room.** Someone already in lets each newcomer in (or the first to arrive, in an empty call). Waiting, a device sees nobody and can only knock; its name goes with the knock and isn't kept. Anyone in the call can let people in, take them out (and keep them out), and lock it, with two exceptions: **nobody can take a studio out** (it proves it's one with its show's host key), and **a call a studio started is the studio's to run** while it's in it (only it lets people in, takes them out and locks it; with the studio gone, it's everyone's again). Anyone can leave.
- **Coming back** after a dropped connection doesn't mean waiting again: the page made itself a pass, and the server keeps the pass's hash.
- Calls delete themselves a day after they're made, and an address can start 20 an hour.

Joining a call is the same code wherever it runs (`callmesh.js`): the call page, another computer's screen (`/share` with the call's link: one more in the call, sending only its screen and its sound), and the studio.

**The studio in a call** (Add → People on a call, `studio/callin.js`) is one of its people. It starts a call (its link and PIN to send the guests) or joins one, and lets people in like anyone in it. Each person in the call is a source in the studio: their camera with their sound (ON in the mixer from the start: they're talking), and a screen they share as a source of its own. They're recorded on the studio computer as they arrive while they're on air, for Edit, as another computer's screen is; nothing is kept on their devices. The call sees the program as the studio's camera, and hears the program without its own people (a second sound bus every channel but theirs feeds): they already hear each other straight, and sent back to them they'd hear themselves late.

### Satellite studios (planned)

For very large events, a second laptop could run its own studio for one zone, with its own auto director, and feed its program into the main studio as a single source. Every satellite would sync to the same beacon as the main studio.

## Where things are stored

- **Phones** keep their own clips (unless turned off) and any live-cut parts in *My footage*.
- **The studio browser** keeps every clip it receives, the edit, and the program recordings. Use *Export* on the home page to keep a copy outside the browser.
- **The cloud** stores only what's needed to find the event, for 30 days.
- **Nothing about where anyone is.** VUEMesh never asks for a location, and there is no public list of events: people join with the code the host shares.

The [Privacy page](../public/privacy.html) (`/privacy` on the site) lists every item kept in the browser and on the server, and clears the browser's with one button.

## When something goes wrong

On a phone, open the event menu (tap the event name) or *My footage* and choose **Copy diagnostics**. In the studio, open **Help → Copy diagnostics**. Each produces a report describing the device and what just happened, without your recordings, to send to whoever helps you.
