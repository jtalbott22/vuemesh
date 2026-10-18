# Screenshots for the tour

`/tour` shows every screen in VUEMesh. Each one's picture is `public/media/screens/<name>.webp`:
drop a file in with the right name and it appears (until then the page shows a labelled frame).
The frame takes the picture's own shape, so a wider window or a sideways phone fits too: a tall
picture sits in a phone's frame on the `phone` screens (camera is a phone held sideways, `held`).
Nothing else to change. Shrink them first: about 1600 wide for computer screens, about 660 wide
for portrait phones.

## For all of them

- **A real show.** Real phones and webcams, three or four of them, pointed at something worth
  looking at (people, a stage, a table set for a podcast). Not the test setup's fake cameras.
- **Dark theme**, everywhere, so they read as one set.
- **Computer screens: one window size, 1600 × 1000** (Chrome: DevTools, device toolbar,
  "Responsive", 1600 × 1000, then "Capture screenshot"). Phone screens: the phone's own
  screenshot, portrait.
- **WebP**, about 80% quality (`cwebp -q 80 in.png -o studio.webp`, or Squoosh). Aim for under
  300 KB each.
- **No real names** on camera tiles: name the devices ("Phone 1", "Tablet", "Desk cam").
- **Nothing private** in the picture: no host key in the address bar, no real people who haven't
  agreed to it, no notifications.

## The shot list

| File | Screen | Size | What it should show |
| --- | --- | --- | --- |
| `studio.webp` | The studio | 1600 × 1000 | Four cameras in, one on air (red), one in preview (green), the switcher open with the T-bar, the audio mixer dock along the bottom with meters moving, the Break and Black tiles above the cameras. |
| `beacon.webp` | The beacon | 1600 × 1000 | Full screen on a TV or laptop: the code, the show's name, the clock, "3 phones in". A photo of it on a real screen in a real room works even better. |
| `kiosk.webp` | The kiosk | 1600 × 1000 | A kiosk show running: the program on air beside the join code, a couple of phones joined. |
| `camera.webp` | The camera | phone, sideways | The camera on a phone, on air (tally lit), the zoom rail and lens buttons showing, "Synced". |
| `mic.webp` | The microphone | phone, portrait | A phone in microphone mode with its level meter moving. Bonus: a USB mic plugged into it, as a photo. |
| `mixer.webp` | The audio mixer | 1600 × 1000 | The audio console window: several strips with EQ curves, one stereo source showing two meters, the spectrum and stereo scope on the right. |
| `ccu.webp` | Camera control | 1600 × 1000 | Three or four cameras side by side, each with histogram and waveform, one on air. |
| `monitor.webp` | The monitor | 1600 × 1000 | The phones table with bitrates and batteries, Transfers showing a camera coming in and a TV going out, the event log. |
| `remote.webp` | The remote | phone, portrait | The phone remote mid-show: camera buttons, one on air, Break / Fade / Record. |
| `tv.webp` | TV screens | 1600 × 1000 | `/tv` showing the live program full screen, with its label. A photo of a real TV showing it is even better. |
| `media.webp` | My media | phone, portrait | My media with a few recordings listed, their pictures showing. |

## When they're in

All eleven are in (October 2026), taken from a real show. The tour isn't linked from anywhere
yet: the home page's "How it works" and the Partners page are the natural places.
