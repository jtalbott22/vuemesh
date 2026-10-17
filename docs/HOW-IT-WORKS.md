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

- **Router:** Wi-Fi 6 on 5 GHz, in the room. A travel router works.
- **Studio laptop:** plugged into the router by cable, and plugged into power.
- **Live pictures:** about 1.2 Mbps per camera (light).
- **Recordings:** about 12 Mbps per phone while recording at 1080p (90 MB a minute), about 50 Mbps at 4K. Each clip is sent when it ends.
- **Live cut:** about 95 MB per person for each five-minute part.
- **How many cameras:** one laptop comfortably shows about **12 live pictures** plus a few microphones. On older Wi-Fi 5 or a busy venue network, plan on 6 to 8.

### Record-only overflow

The studio shows up to a set number of live pictures (12 by default; *Live → Output*). Phones that join beyond that are **recording only**: no live picture, but they record and send every clip as usual, and their phone tells them so. When a live camera leaves, the phone that has waited longest moves up automatically, and the director can **Swap in** any waiting phone (the live camera that has been off air longest steps back).

### Satellite studios (planned)

For very large events, a second laptop could run its own studio for one zone, with its own auto director, and feed its program into the main studio as a single source. Every satellite would sync to the same beacon as the main studio.

## Where things are stored

- **Phones** keep their own clips (unless turned off) and any live-cut parts in *My footage*.
- **The studio browser** keeps every clip it receives, the edit, and the program recordings. Use *Export* on the home page to keep a copy outside the browser.
- **The cloud** stores only what's needed to find the event, for 30 days.

## When something goes wrong

On a phone, open the event menu (tap the event name) or *My footage* and choose **Copy diagnostics**. In the studio, open **Help → Copy diagnostics**. Each produces a report describing the device and what just happened, without your recordings, to send to whoever helps you.
