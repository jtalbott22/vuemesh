import {
  $ as $q, api, hostKey, rememberEvent, meshSocket, toast, esc, fmtDur, decodeQR, parseTimecode, now, eventIdFromUrl, myEvents,
  themeButton, announce, helpDialog, diag, codecsOf, diagnosticsDialog, drawQR, timecodeUrl,
} from '/js/vm.js';
import { bitrateHints } from '/js/quality.js';
import { snapToCamera } from '/js/camctl.js';
import { RemoteHost } from '/js/remote-host.js';
import { DisplayHub } from '/js/display-hub.js';
// The Live studio and Edit are separate pages, each with only its own markup; this code serves
// both. The other page's elements are listed on <body data-absent> (id: tag): asked for one,
// the code gets a detached stand-in rather than null, so wiring that page's controls is harmless
// here. Anything else that's missing is still null, as it should be. (window.vmAbsent lists
// the stand-ins handed out, for tests.)
const ABSENT = JSON.parse(document.body?.dataset.absent || '{}');
const absentStubs = new Map();
window.vmAbsent = () => [...absentStubs.keys()];
const $ = (s, el = document) => {
  const hit = $q(s, el);
  if (hit || el !== document) return hit;
  const id = /^#([\w-]+)$/.exec(s)?.[1];
  if (!id || !(id in ABSENT)) return hit;
  if (!absentStubs.has(id)) absentStubs.set(id, document.createElement(ABSENT[id]));
  return absentStubs.get(id);
};

// Recording formats, best first: H.264 in MP4 plays everywhere, including iPhones.
const REC_MIMES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
const recMime = () => REC_MIMES.find((m) => window.MediaRecorder?.isTypeSupported(m));
import { EditPlayer } from '/js/editplayer.js';
import { drawFramed, drawSlate, drawTitle, PIP, limiter, tfOf, TF_PRESETS, transformBox } from '/js/compose.js';
import { SLATE_LOOKS, SLATE_SOUND, slateLookName } from '/js/slates.js';
import { eqChain, balance, channelFixer, eqOf, eqFlat, eqCurve, EQ_BANDS } from '/js/audiofx.js';
import { offsetBetween, hasSound } from '/js/audiosync.js';
import { STREAM_SERVICES, startWhip } from '/js/whip.js';
import { startRtmp, relayHello, rtmpTarget, RELAY_DEFAULT } from '/js/rtmp.js';
import * as S from '/js/sequence.js';
import { Timeline, TOOLS } from '/js/timeline.js';
import { Director, planCuts, shotScore, whatsWrong } from '/js/director.js';
import { renderSequence, renderSupport, RenderError } from '/js/render.js';
import { HostHub } from '/js/rtc.js';
import { BRAND, FEATURES } from '/js/brand.js';
import * as idb from '/js/idb.js';
import { MediaLibrary, QUICK_TAGS } from '/js/media.js';

const COLORS = ['#6d9cf0', '#f0b44d', '#4cc2b3', '#c883dc', '#9ccf5e', '#6fd0ef', '#e39bbd', '#c7b97a', '#9aa3ff'];
const FRAME = S.FRAME;
const LIVE_DELAY = 250;   // live previews arrive ~¼ s late; live cuts are back-dated by this much
const STALL_MS = 1500;    // an on-air camera silent this long counts as dropped
const dbToGain = (db) => (db <= -60 ? 0 : 10 ** (db / 20));
const gainToDb = (g) => (g <= 0.001 ? -60 : Math.round(20 * Math.log10(g)));

const eventId = eventIdFromUrl();
const key = hostKey(eventId);
let ev;
let isHost = false;
let mode = 'live';
const clips = [];               // verified clip records (video and audio)
const blobs = new Map();        // clip id → object URL
const rawBlobs = new Map();     // clip id → Blob (for rendering)
const thumbs = new Map();       // clip id → data URL
let cut = loadCut();            // multicam cut log (live cuts and number keys)
let seq = loadSeq();            // the layered edit
let selectedItem = null;
let sock, hub;
const live = new Map();         // peer → { stream, name, cid, role, route, rec, tile, video, tele, stats }
let liveActive = null;
let lastLive = null;
let orientation = 'landscape';
let fit = localStorage.getItem('vm_fit_' + eventId) || 'fill';
const log = [];                 // event log for the monitor
const returning = new Map();    // peer → { joinedAt } while a phone rebuilds its link
// Black: the whole program faded (or cut) to black, picture and sound. 0 = normal, 1 = black.
const black = { target: 0, from: 0, start: 0, dur: 0, cleared: true };
// A kiosk (a sign or a screen people walk up to): the studio, stripped down and hands-free.
// The kiosk screen is its own page (/kiosk), with only what a sign needs; the studio in kiosk
// mode (?kiosk=1) still works for older links.
const KIOSK_PAGE = location.pathname.replace(/\/+$/, '') === '/kiosk';
const KIOSK = KIOSK_PAGE || new URLSearchParams(location.search).has('kiosk');
// The Edit page (/edit): the same engine, editing only, in its own window beside the live
// studio. It doesn't connect to phones or cameras; the studio tells it (on this computer) when
// a recording lands or the live cut changes, and it rebuilds there and then, so the edit comes
// together while the show's live. While it's open, it owns the timeline: the studio leaves it be.
const EDIT_ONLY = location.pathname.replace(/\/+$/, '') === '/edit';
// The Edit page opened without its event code (a bookmark, a reopened tab): the studio that
// opened it knows it, or the last event edited here does.
if (EDIT_ONLY && !eventId) {
  let t = null;
  try {
    t = window.opener?.vmEventId || null;
  } catch {}
  t ||= localStorage.getItem('vm_edit_last');
  if (t) location.replace(`/edit?e=${encodeURIComponent(t)}`);
}
window.vmEventId = eventId;
// (made here, before anything listens on it: the Edit page's listener is attached early on)
const editCh = typeof BroadcastChannel === 'function' && eventId ? new BroadcastChannel('vm-edit-' + eventId) : null;
let editPageAt = 0, seqStale = false;

const program = $('#program');
const player = new EditPlayer({
  canvas: program,
  urlFor: (id) => blobs.get(id),
  imageFor: (asset) => reel.find((r) => r.id === asset)?.el || null,
  title: () => ev?.title || '',
  viewOf: (item, ms) => viewOf(item, ms),
  audioOf: (id) => clipOf(id)?.audio, // 'stereo' if the phone recorded real stereo
});
player.enabled = false;
player.fit = fit;

const timeline = new Timeline({
  heads: $('#heads'),
  tracks: $('#tracks'),
  scroller: $('#scroller'),
  seq: () => seq,
  label: labelOf,
  srcDur: (it) => (it.type === 'clip' ? clips.find((c) => c.id === it.src)?.dur ?? Infinity : Infinity),
  begin: (it) => {
    snapshot();
    if (it && S.program(seq).items.includes(it)) seq.auto = false;
  },
  changed: () => commit(),
  select: (id) => select(id),
  seek: (t) => player.seek(t),
  now: () => player.t,
  toolChanged: (t) => renderTools(t),
  // moments sit on the footage they were marked on, wherever that footage is now
  extraMarkers: () => (seq.origin == null ? [] : media.moments.map((m) => {
    const at = timeOfAbs(m.t);
    return at && { id: m.id, t: at.t, gap: at.gap, name: m.label, moment: true };
  }).filter(Boolean)),
  moveMarker: (m, t) => moveMarker(m, t),
  renameMarker: (m) => renameMarker(m),
  deleteMarker: (m) => deleteMarker(m),
  markerMenu: (m, x, y) => markerMenu(m, x, y),
});

themeButton($('#themeBtn'));
const help = helpDialog('Studio help', [
  {
    heading: 'Live',
    rows: [
      ['1 – 9', 'Cut to that camera (the number stays with the phone, live and in the edit)'],
      ['A', 'Auto director on or off'],
      ['Shift + 1 – 9', 'That camera\'s sound: AFV (follows the picture) → ON → OFF'],
      ['M', 'Mark this moment (make clips of it later, from every angle)'],
      ['I / O (Edit, Program)', 'Mark In and Out on the timeline: Render exports just that part'],
      ['Alt/Option+X', 'Clear In and Out'],
      ['T', 'Show or hide the lower third'],
      ['X', 'Fade to black, picture and sound (again: fade back up)'],
      ['Shift + X', 'Cut to black (again: cut back up)'],
      ['Click a source', 'Cut to that camera, or put a clip on air'],
      ['[ / ]', 'Previous / next item in the rundown (phones see it as one line)'],
      ['F', 'Full screen control room, with a vertical meter bridge'],
      ['B', 'Break slate on or off (your chosen look and message, sponsor reel)'],
      ['R', 'Start or stop recording the program to this computer'],
      ['`', 'Switch between Live and Edit'],
    ],
  },
  {
    heading: 'Edit tools (Premiere Pro keys)',
    rows: [
      ['V', 'Selection: drag to move, drag edges to trim'],
      ['B', 'Ripple Edit: trim and close the gap on every track'],
      ['N', 'Rolling Edit: move a cut point between two clips'],
      ['C', 'Razor: click a clip to cut it'],
      ['Y', 'Slip: same place, different part of the clip'],
      ['U', 'Slide: move a clip between its neighbours'],
      ['H', 'Hand: drag to scroll'],
    ],
  },
  {
    heading: 'Edit keys',
    rows: [
      ['Space', 'Play or pause'],
      ['J / K / L', 'Back 5 seconds / stop / play (L again for 2× and 4×)'],
      ['← / →', 'One frame (Shift: five frames)'],
      ['Alt + ← / →', 'Nudge the selected item a frame (Shift: five)'],
      ['↑ / ↓', 'Previous or next cut point or marker'],
      ['1 – 9', 'Cut the Program to that angle at the playhead'],
      ['Shift + 2 / Shift + 4', 'Source monitor / Program monitor'],
      ['I / O', 'In the Source monitor: mark In and Out'],
      [', / .', 'Insert / overwrite the Source In–Out at the playhead'],
      ['Ctrl/⌘ + K', 'Add edit: cut every unlocked track at the playhead'],
      ['Q / W', 'Ripple trim the start or end to the playhead'],
      ['[ / ]', 'Trim the selected item\'s start or end to the playhead'],
      ['Delete', 'Remove the selected item (Shift + Delete: ripple delete)'],
      ['M', 'Add a marker'],
      ['S', 'Snapping on or off'],
      ['= / - / \\', 'Zoom in / out / to fit'],
      ['T', 'Add a lower third'],
      ['Drag / double-click a marker', 'Move it / rename it (right-click for more; Delete removes it)'],
      ['Shift + P', 'Add picture-in-picture of another angle'],
      ['Ctrl/⌘ + Z', 'Undo (add Shift to redo)'],
      ['Home / End, Esc', 'Start or end; deselect'],
    ],
  },
  { heading: 'Anywhere', rows: [['?', 'Open this help']] },
  {
    heading: 'How it fits together',
    text: 'This computer is the studio: it switches, mixes, records the program, edits and renders. Program out and Monitor take their picture straight from this tab, so they work only on this computer, in this browser. Phones are cameras or microphones. Any screen can show the beacon (a TV, a tablet, this laptop), but the whole event must use the same one: phones line their recordings up by its clock. A phone is too small to be the studio; an iPad may work but is untested. For files every phone can play, use Chrome or Edge on a Mac or Windows PC, or Safari on a Mac.',
  },
  {
    heading: 'More screens',
    text: 'The studio works on one screen, and it\u2019s easier with more. Each part of the control room opens in a window of its own, so plug in a monitor, a TV or a projector and spread out: Program out (what the audience sees: click it once to fill the screen), the Beacon (where the phones can see it), the Monitor (phones, transfers, the event log), Camera control (every camera\u2019s picture, scopes and settings) and the Audio console. Open one, drag it to the other screen, and make it full screen. They all run from this tab, so keep this browser open on this computer. If the browser blocks a window, choose Always allow pop-ups from this site once.',
  },
  {
    heading: 'Recording only (overflow)',
    text: 'The studio shows up to a set number of live pictures (Live → Output, 12 by default). Phones that join beyond that record only: no live picture, but every clip still arrives, and their phone tells them. When a live camera leaves, whoever has waited longest moves up; Swap in brings any waiting phone up now (the live camera that has been off air longest steps back).',
  },
  {
    heading: 'Network and capacity',
    text: 'Bring your own router and keep everyone on it: venue and guest Wi-Fi often stop phones from reaching each other ("client isolation"), and then nothing connects locally. A Wi-Fi 6 router on 5 GHz, in the room, with this laptop plugged in by cable, is ideal (a travel router works). Each phone\'s live picture is about 1.2 Mbps, so live viewing is light; the heavy part is the recordings: about 12 Mbps per phone while recording at 1080p (90 MB a minute), about 50 Mbps at 4K, sent when each clip ends. One laptop comfortably shows about 12 cameras and a few microphones; on older Wi-Fi 5 or a busy venue network, plan on 6 to 8. More phones can still join: they record and send their clips, but more live pictures can stutter.',
  },
  {
    heading: 'Clips and lower thirds',
    text: 'Add b-roll, commercials or a logo under Clips (Live, left panel). They loop silently in their tiles so you can see they\'re ready; click one to put it on air from the top. Loop keeps it going until you cut to a camera; otherwise it plays once and goes back to the camera you were on. Its sound has its own Clips strip in the mixer. Clips also play in the break rotation. Type a lower third in the inspector and press Show (or T); it fades in, and out after 8 seconds unless you untick that. Recent ones are a click away: × deletes one, and right-click loads one to edit without putting it on air.',
  },
  {
    heading: 'Black, breaks and slates',
    text: 'X fades the whole program to black, picture and sound together; Shift+X cuts straight to black. Once it’s black, the lower third, any clip and the break come off. Press X (or Shift+X) again to come back up on the camera you were on; cutting to another camera while it’s black lines it up for when you come back. The Black tile (above the cameras) does the same as Shift+X; with Tap: Preview it fades to black on the T-bar instead, as slowly as you push it. The break slate has several looks (color bars, static, Please stand by, a test card, a VHS blue screen, a station clock), all with your message on top, previewed under Breaks. Slate sound adds the line-up tone with bars, or hiss with static, to the program.',
  },
  {
    heading: 'Moments and markers',
    text: 'M marks a moment live. They’re listed under Moments, where you can rename one (click its name) or delete it with ×. In Edit, moments (red) and markers (amber) sit on the ruler with their names: drag one to move it, double-click it (or select it and press Enter) to rename it, Delete to remove it, or right-click to go to it, move it to the playhead, or make clips of a moment from every angle. They stay on the footage they were put on, so trims, moves and Collapse gaps carry them along; one where no camera was recording is faded.',
  },
  {
    heading: 'Audio console',
    text: 'Audio console ↗ (on the Live mixer dock, and in the Edit mixer) opens a window for mixing. Each channel has AFV / ON / OFF and Mono (Live) or Mute / Mono (Edit), an 80 Hz high-pass, low / mid / high EQ with its curve, balance, a meter and a fader. The output side shows meters, peak and RMS level, balance, phase, a spectrum, the waveform and a stereo scope. Live, it changes the program and its recording; in Edit, the settings are saved with the edit and rendered. Double-click a control to reset it. The studio’s keys work from the console window too. In Edit, Camera sound has a Duck switch (on when a microphone joins): camera sound steps aside wherever a microphone recording plays and is heard everywhere else; turn it off to hear camera sound throughout.',
  },
  {
    heading: 'Stream out',
    text: 'Stream out (Live inspector) sends the program, picture and mix, to one streaming service: pick it, paste its URL and key (kept on this computer only) and press Go live. WHIP services (Twitch, Restream, Cloudflare Stream, Dolby OptiView, any WHIP server) take it straight from this browser. RTMP services (YouTube, Facebook, Twitch, Kick, Vimeo, LinkedIn, X, any RTMP server) go through the VUEMesh relay: a small program you run on this computer next to the studio (download it from Stream out; it needs Node.js and ffmpeg), because no browser can send RTMP itself. Setting it up takes a few minutes, once: Stream out shows the steps for this computer (Windows, Mac, Linux or ChromeOS) with a Copy button for each command. Streaming uses this computer’s upload: a wired connection is best.',
  },
  {
    heading: 'Microphones on air (podcasts)',
    text: 'A microphone phone is a live source like a camera: click its tile in Sources (or press its number: microphones come after the cameras) to put it on air. The program shows its sound with its name, and the phone shows ON AIR. In the mixer, a microphone is ON (always heard) unless you set it to AFV (heard only while it\u2019s on air) or OFF. With no cameras up, the first microphone goes on air by itself, and the auto director (A) goes to whoever\u2019s talking: louder by about 4 dB, holding each one at least 2.5 seconds. The break slate only comes on by itself when there\u2019s nothing to show or hear: while a microphone is live, a camera dropping puts the sound on air instead. (Edit starts from the camera cuts; a microphone on air doesn\u2019t change the picture there.)',
  },
  {
    heading: 'Switcher: preview, dissolves and the T-bar',
    text: 'The ⇅ button beside the program opens the switcher (the program shrinks to make room). Tap: Air (the usual) puts a source on air when you tap it or press its number. Tap: Preview puts it in preview instead: a green outline on its tile, a preview box in the corner of the program monitor (never in the program itself), and PREVIEW on that phone. Then CUT (Shift+Enter) takes it straight to air, AUTO (Enter) dissolves over the time you pick (¼, ½, 1, 2 or 3 s), and the T-bar dissolves by hand: push it from one end to the other; stop halfway and both pictures are on air. The bar glides, so a mouse, a finger on a touchscreen or a hardware fader dissolves smoothly. MIDI fader: press it, move a fader on any MIDI controller, and that fader is the T-bar. After a transition, what was on air goes to preview, ready to come back. Cameras set to AFV crossfade their sound with the picture. Each dissolve arrives in Edit as a dissolve, as long as it took live. Right-click a camera for Put in preview. Clips work the same way: with Tap: Preview, clicking a clip cues it in preview, paused at its first frame; it starts playing as the dissolve to it begins (or when CUT puts it on air), its sound fading in with its picture. When you go from a clip back to a camera, the clip returns to preview, cued at the start again. The Break and Black tiles, above the cameras, are sources too: with Tap: Preview, tap one to put it in preview, then AUTO or the T-bar dissolves to the break slate or fades to black over as long as you like (sound too), and back again the same way; with Tap: Air, or tapping the one on air, it cuts straight there and back. B, X and Shift+X still work. Microphone tiles show the picture the program shows while that microphone is on air, drawn from its own sound.',
  },
  {
    heading: 'Cameras and microphones on this computer',
    text: '+ This computer (under the sources) adds this computer\u2019s own cameras (the built-in camera, USB cameras, capture cards) and microphones to the show. The browser asks once for permission. A camera brings its sound, as a phone does: its own microphone (a USB webcam\u2019s), or this computer\u2019s (a built-in camera like the FaceTime camera has none of its own); the picker shows which, under Sound, and you can pick another or No sound. They\u2019re sources like any phone: a tile marked THIS PC with a number, on air or in preview, Camera control (through the camera\u2019s own zoom, brightness and contrast, where it has them), and the mixer. They need no beacon: they run on the studio\u2019s own clock, so their recordings line up in Edit from the start. A camera records its time on air while you Record program, or right-click it for Record until you stop it; a microphone records the whole time it\u2019s in the show. Recordings roll every 5 minutes. Right-click to rename or remove one. The ones you add come back next time this studio opens (if the browser remembers its permission).',
  },
  {
    heading: 'Removing a camera',
    text: 'Right-click a camera or microphone, then Remove from the event. Remove: their phone is told and leaves; they can rejoin. Remove and block: they can\u2019t rejoin this event (the server turns them away, and their phone says so), and their recordings stay out of the automatic edit (still in Media if you want a shot by hand). Blocked ones are listed under the sources, with Let back in. Blocking goes by the phone\u2019s identity for this event, so someone who wipes their browser\u2019s data would come back as a new phone.',
  },
  {
    heading: 'Dissolves in Edit',
    text: 'Dissolve (or D) puts a half-second dissolve into the selected shot, or the shot at the playhead; again takes it off. A dissolve into a shot: the shot before it carries on underneath while this one fades in over it, and their sound crossfades. Dissolves made live (AUTO or the T-bar) arrive in the automatic edit as dissolves, on the shot they went into and as long as they took live. To add, change or remove one, right-click a clip on the timeline (Dissolve in) or use Dissolve in in the Selection panel: Cut, ¼, ½, 1 or 2 s (and the live length, if it came from live). The timeline marks a dissolve with a shaded corner at the start of the shot. The shot before needs recording past its end to carry on underneath; where it has none, the new shot fades in over black.',
  },
  {
    heading: 'Video calls (Zoom, Teams, Meet)',
    text: 'Stream out, Zoom, Teams or Meet (as a camera) makes the program a camera, and its sound a microphone, that a video call can pick, through the relay on this computer. Set up once (the steps show under it for your computer). Mac and Windows: OBS Studio makes the camera: add a Media Source on udp://127.0.0.1:9998 (input format mpegts), press Start Virtual Camera, and pick "OBS Virtual Camera" in the call; for sound, send OBS\u2019s monitoring to BlackHole (Mac) or VB-CABLE (Windows) and pick that as the microphone. Linux: a loopback camera and a sound sink, no OBS: pick "VUEMesh" and "Monitor of VUEMesh". ChromeOS can\u2019t, and nothing to install anywhere: open Program out, and in the call Share screen, that window, with its sound.',
  },
  {
    heading: 'Autopilot and recording with the fades',
    text: 'Record the program with the fades (under Output): fading up from black starts Record program, and fading to black stops it. Autopilot runs the whole show: with no camera the program sits at black; when a camera arrives (its picture steady for 3 seconds), the intro clip (if you chose one) plays, the program fades up and records, and the auto director takes over with that camera\u2019s name on a lower third. Each camera that arrives later goes to preview first (PREVIEW on its phone), then dissolves to air with \u201cjoined the show\u201d. When no camera\u2019s been here for the time you choose, the program fades to black, the recording stops (kept in this browser and in Media, nothing downloads), and each phone gets its part of the live cut. Then it waits for the next camera.',
  },
  {
    heading: 'Kiosk (a screen people walk up to)',
    text: 'Set up once, on the sign\u2019s computer, in the browser it will use: open the studio (any event) and set the break slate (look and message), the fade time, the intro clip and the autopilot\u2019s end time, the output shape, and any webcam to include: the kiosk uses this browser\u2019s settings. Then put /kiosk on the screen, full screen, or in an iframe on the sign\u2019s page (nothing has to be allowed). Nothing to press: it shows its own join code. The first phone to scan in names the show and, once locked in, gets Go live: 3-2-1 on the phone and the kiosk, then the show fades up and records. Everyone after joins that show. Phones keep their clips; each gets its part of the live cut. When everyone has gone it fades out, stops, and starts a fresh show with a new code (the old one is deleted). A webcam on the kiosk\u2019s computer never starts a show.',
  },
  {
    heading: 'A screen, a window, or this computer\u2019s sound',
    text: '+ This computer, then Share\u2026: a screen or window becomes a source like a camera, with its sound if the browser shares it. This computer\u2019s sound keeps only the sound, as a microphone. Windows and ChromeOS share the whole computer\u2019s sound (pick Entire screen and tick Share system audio); on a Mac, Chrome shares a tab\u2019s sound (pick the tab and tick Share tab audio). The browser asks each time, so these aren\u2019t brought back next time.',
  },
  {
    heading: 'Edit in its own window',
    text: 'The studio is Live only. Edit \u2197 opens the edit in its own window beside it (or brings it forward): keep the show live in one and watch the edit come together in the other. The studio records (every camera, the live cut) and tells the Edit window, which builds the edit from them when it opens and as things arrive; opening it, or bringing it forward, finishes the recordings in progress. The edit is the Edit window\u2019s alone: close it and open it again, and your edits are all there. It runs in its own browser process, so an export there can\u2019t hold up the live show. Program out has a Live / Edit switch: Edit shows the edit as it plays in that window (sent over a connection on this computer; nothing leaves it).',
  },
  {
    heading: 'Camera control',
    text: 'Camera control (Sources, or right-click a camera) opens a window with every live camera: its picture, a histogram (red, green, blue and brightness) and a waveform (how bright each part of the picture is, black at the bottom, white at the top), with a warning when whites clip or blacks crush. From there you can zoom (the phone glides there like a zoom lens), set brightness (the camera\u2019s own exposure where it has it, else digital) and contrast (digital), click the picture to focus there, lock focus and exposure or white balance, pick which of the phone\u2019s cameras to use (front, ultra wide, tele…), put it all back with Auto, cut to it, or message the person on it. Each camera is a strip, like a bank of camera controls: drag Strip width to fit them side by side. The phone shows each change, and its owner can turn remote control off in the camera\u2019s settings. Digital brightness and contrast are in the live picture and the edit; the recording itself stays as shot.',
  },
  {
    heading: 'Only microphones',
    text: 'A microphone is heard on its own, with no camera needed. With no camera up, a microphone goes on air by itself and the program shows its sound (a rolling waveform, spectrum bars or a ring; choose under Breaks and black) with its name. See Microphones on air.',
  },
  {
    heading: 'Sync',
    text: 'Every phone syncs once with the beacon and keeps that lock, and every clip carries it. Auto-sync (Edit) then fine-tunes clips that show the beacon, and lines every clip up by its sound with the ones around it (a microphone’s recording with the cameras’, cameras with each other), to a fraction of a frame. A phone that never synced is named, and marked NO SYNC on its live tile.',
  },
  {
    heading: 'The live cut on the phones',
    text: 'With Record program on, each camera gets the program for the time it was there, a few minutes at a time. The studio asks each phone first (one that’s recording or sending its own clips gets it later) and holds transfers to 2 Mbit/s while the show is live (1 Mbit/s to the camera on air) so the live pictures keep the Wi-Fi. Someone leaving goes first: they get their part before they go. Anyone who left early gets theirs when they rejoin.',
  },
  {
    heading: 'If a live picture freezes',
    text: 'The studio checks every live picture every two seconds. If one stops moving while its phone is still sending, it swaps in a fresh player without the program blinking; if the video stops arriving or decoding, it reconnects just that phone. Each fix goes in the Monitor log. Right-click a camera tile to refresh its picture or reconnect it by hand, or use Refresh live pictures under Network. You shouldn’t need to reload the page.',
  },
  {
    heading: 'Program out on one screen',
    text: 'Program out keeps running even when it covers the studio window, full screen on a single screen: it drives the studio\'s picture itself, and a background clock keeps the auto director, recording and switching going.',
  },
  {
    heading: 'Crew',
    text: 'Type under a camera\'s tile to message that phone, or use Message all cameras. Phones show a small banner they can answer with 👍 or Can\'t; you see ✓ sent, ✓✓ seen, and their reply. Send a rundown, then step through it with [ and ]: every phone shows "Now · Next" in one small line. Next ▶ on the last item ends the rundown and takes it off the cameras (End does that any time; Clear empties it). A phone can pause its live picture (it shows PAUSED here and the director skips it) or leave and rejoin without closing the browser.',
  },
  {
    heading: 'Media',
    text: 'Media (left panel, in Edit) lists every recording, subclip and moment. Search, filter by tag, star favourites. Open one in the Source monitor, mark In and Out, then Make subclip, Insert (,) or Overwrite (.) onto the selected track — the Program if nothing is selected — or Export clip to share it on its own. Trim keeps only part of a recording in use (the signed file is untouched); Delete removes the file from this computer and every use of it.',
  },
  {
    heading: 'Rotation',
    text: 'Every phone records an upright picture, whichever way it is held, and turns mid-shot are logged. Clips are sliced where a phone turned (▭ landscape, ▯ portrait); striped items don\'t match the output shape and are cropped to fill unless you choose Whole shot. If a phone was lying flat and got it wrong, pick a rotation for that item in the inspector.',
  },
  {
    heading: 'Auto director',
    text: 'Each phone rates its own shot a couple of times a second from its gyroscope, gravity sensor, compass and picture: shaking, pointed at the floor, panning fast, too dark, covered, or held the wrong way. Live, the director holds each shot at least 3 seconds, cuts away from a bad one within a second, varies the angle, and goes to the break slate if nothing is usable. Press a number to take over; it waits 8 seconds. In Edit, Auto-cut uses the same ratings, recorded with each clip.',
  },
  {
    heading: 'Network',
    text: 'Sound: every phone has a strip in the mixer. AFV plays it only while that camera is on air; ON keeps it in the mix; OFF never. Microphone phones start ON; cameras start AFV (OFF once a microphone joins). LAN means a phone is talking to this computer directly. LAN·NAT is the same network through the router. CELL means mobile data. If phones show NET or LAN·NAT while on the venue Wi-Fi, press "Help phones connect directly": browsers only share a computer\'s local address once it has microphone permission. "Local network only" refuses anything else.',
  },
]);
$('#helpBtn').onclick = () => help.showModal();
if (!FEATURES.publish) $('#publishBtn').hidden = true;

// The Edit page: it says it's open (so the studio leaves the timeline to it), asks the studio
// to finish the recordings in progress when it opens or comes back into view, and takes in
// recordings and live-cut changes as they happen.
let cutSoon = null;
// Program out (Edit): the Edit window is in its own process, so it sends the edit's picture and
// sound to Program out over a WebRTC connection on this computer (set up over a channel). Nothing
// leaves the computer.
const progOutPeers = new Map();
if (EDIT_ONLY && typeof BroadcastChannel === 'function' && eventId) {
  const pch = new BroadcastChannel('vm-progout-' + eventId);
  pch.onmessage = async (e) => {
    const m = e.data || {};
    if (m.t === 'want') {
      progOutPeers.get(m.id)?.close();
      const pc = new RTCPeerConnection({ iceServers: [] });
      progOutPeers.set(m.id, pc);
      pc.onicecandidate = (ev) => ev.candidate && pch.postMessage({ t: 'ice', id: m.id, from: 'edit', cand: ev.candidate.toJSON() });
      pc.onconnectionstatechange = () => ['failed', 'closed'].includes(pc.connectionState) && progOutPeers.delete(m.id);
      const feed = window.vmProgramFeed?.();
      feed?.getTracks().forEach((t) => pc.addTrack(t, feed));
      await pc.setLocalDescription(await pc.createOffer());
      // Keep the picture as it is: a connection left to itself lowers the resolution when it judges
      // the link (or this window, in its own process) to be busy. Full size, the program's bitrate, 30 fps.
      for (const s of pc.getSenders().filter((x) => x.track?.kind === 'video')) {
        const p = s.getParameters();
        p.degradationPreference = 'maintain-resolution';
        p.encodings = [{ ...(p.encodings?.[0] || {}), scaleResolutionDownBy: 1, maxBitrate: 30_000_000, maxFramerate: 30, priority: 'high' }];
        await s.setParameters(p).catch(() => {});
      }
      pch.postMessage({ t: 'offer', id: m.id, sdp: pc.localDescription.toJSON() });
    } else if (m.t === 'answer' && progOutPeers.has(m.id)) {
      // (this computer to itself: start high, stay high; there's no network to be kind to)
      await progOutPeers.get(m.id).setRemoteDescription({ type: m.sdp.type, sdp: bitrateHints(m.sdp.sdp, { start: 12000, min: 8000, max: 30000 }) }).catch(() => {});
    } else if (m.t === 'ice' && m.from === 'out' && progOutPeers.has(m.id)) {
      await progOutPeers.get(m.id).addIceCandidate(m.cand).catch(() => {});
    } else if (m.t === 'bye') {
      progOutPeers.get(m.id)?.close();
      progOutPeers.delete(m.id);
    }
  };
}
if (EDIT_ONLY) {
  document.body.classList.add('editpage');
  const alive = () => editCh?.postMessage({ t: 'edit-alive' });
  alive();
  addEventListener('pagehide', () => editCh?.postMessage({ t: 'edit-bye' })); // (closed: the studio opens a new one next time)
  setInterval(alive, 2000);
  editCh?.postMessage({ t: 'flush' });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && editCh?.postMessage({ t: 'flush' }));
  window.vmEditMsgs = {}; // (tests and diagnostics: what the studio has told this page)
  editCh?.addEventListener('message', async (e) => {
    const m = e.data || {};
    vmEditMsgs[m.t] = (vmEditMsgs[m.t] || 0) + 1;
    if (m.t === 'deleted' && m.id) return void deleteRecording(m.id, { confirmed: true, elsewhere: true });
    if (m.t === 'focus') return void window.focus();
    if (m.t === 'seek' && typeof m.ms === 'number') return void player.seek(m.ms);
    if (m.t === 'select' && m.id) return void select(m.id);
    if (m.t === 'clip' && m.id && !clips.some((c) => c.id === m.id)) {
      const rec = await idb.get('clips', eventId, m.id).catch(() => null);
      if (rec?.blob) addClip(rec, rec.blob, true);
    } else if (m.t === 'cut') {
      clearTimeout(cutSoon);
      cutSoon = setTimeout(() => {
        cut = loadCut();
        if (seq.auto) rebuild(false);
        else appendLiveSoon();
        player.setSequence(seq);
        renderTimeline();
      }, 1000);
    }
  });
} else {
  editCh?.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.t === 'edit-alive') {
      editPageAt = Date.now();
      seqStale = true;
    } else if (m.t === 'edit-bye') editPageAt = 0; else if (m.t === 'flush') flushRecordings('Edit window');
  });
}

// (/kiosk with no show in the address: its launcher starts one and comes back with it)
if (!(KIOSK_PAGE && !eventId)) init().catch((e) => {
  // no event code, or one that's gone: the events on this computer, right here
  if (!eventId || /404|No event|not found/i.test(e.message)) return showEventPicker(eventId ? `There's no event ${eventId} any more (events delete themselves 30 days after they're made).` : 'Open one of the events on this computer.');
  toast(e.message, 6000);
});

/** Every event this computer has hosted (it has the host key for), to open from here. */
async function showEventPicker(why) {
  const mine = myEvents().filter((x) => localStorage.getItem('vm_host_' + x.id));
  const rows = await Promise.all(mine.map(async (x) => {
    const alive = await api(`events/${x.id}`).then(() => true).catch(() => false);
    const when = x.createdAt || x.at;
    return `<li class="${alive ? '' : 'gone'}"><span><b>${esc(x.title || 'Untitled')}</b><small>${when ? new Date(when).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' : ''}${esc(x.id)}${alive ? '' : ' · expired'}</small></span>${alive ? `<a class="btn primary" href="${EDIT_ONLY ? '/edit' : '/studio'}?e=${esc(x.id)}">${EDIT_ONLY ? 'Edit' : 'Open'}</a>` : `<button type="button" data-forget="${esc(x.id)}">Forget</button>`}</li>`;
  }));
  const d = $('#eventPicker');
  d.querySelector('#pickH').textContent = EDIT_ONLY ? 'Edit which event?' : 'Your events on this computer';
  d.querySelector('#pickWhy').textContent = why;
  d.querySelector('#pickList').innerHTML = rows.join('') || '<li class="fine">No events on this computer yet.</li>';
  d.querySelector('#pickList').onclick = (e) => {
    const id = e.target.closest('[data-forget]')?.dataset.forget;
    if (!id) return;
    localStorage.setItem('vm_events', JSON.stringify(myEvents().filter((x) => x.id !== id)));
    localStorage.removeItem('vm_host_' + id);
    e.target.closest('li').remove();
  };
  d.showModal();
}

async function init() {
  $('#code').textContent = eventId;
  $('#beaconBtn').href = `/beacon?e=${eventId}`;
  $('#watchBtn').href = `/watch?e=${eventId}`;
  $('#monitorBtn').href = `/monitor?e=${eventId}`;
  $('#watchBtn').hidden = !FEATURES.publish;
  ev = await api(`events/${eventId}`);
  document.title = `${ev.title} — studio`;
  $('#title').textContent = ev.title;
  renderMoments();
  if (key) {
    try {
      await api(`events/${eventId}/host`, { host: key });
      isHost = true;
    } catch {}
  }
  $('#viewOnly').hidden = isHost;
  if (!isHost) document.querySelectorAll('.bar button:not([role=tab]):not(#helpBtn):not(#themeBtn), .insp button, .transport button').forEach((b) => (b.disabled = true));
  else rememberEvent(ev);

  setOrientation(localStorage.getItem('vm_orient_' + eventId) || ev.orientation || 'landscape', false);
  setFit(fit);

  for (const r of await idb.list('reel', eventId)) addReel(r, false);
  for (const rec of await idb.list('clips', eventId)) addClip(rec, rec.blob, false);
  if (seq.auto) rebuild(false);
  player.setSequence(seq);
  undoStack.length = 0;

  if (isHost && !EDIT_ONLY) {
    // The host laptop is the hub: phones find it through the cloud, then connect directly.
    sock = meshSocket({
      eventId,
      role: 'host',
      hostKey: key,
      onPeers: (peers) => {
        hub.syncPeers(peers);
        displayHub?.syncPeers(peers);
        for (const p of remoteHost?.bound.keys() || []) if (!peers.some((x) => x.peer === p)) remoteHost.gone(p);
        for (const p of peers) {
          const l = live.get(p.peer);
          if (!l) continue;
          l.rec = p.rec;
          // The picture can arrive a moment before who-it-is does; fill it in now.
          if (!l.cid && p.cid) {
            l.cid = p.cid;
            l.name = p.name || l.name;
            l.role = p.role === 'mic' ? 'mic' : l.role;
            if (l.role !== 'mic') noteAngle(p.cid);
          }
        }
        setPresence(peers);
        renderLive();
      },
      // (a phone remote's messages are its own, not a camera's: they never reach the cameras' links)
      // (a TV's messages, too: only the TV screens panel hears them)
      onSignal: (from, data, role) => (data?.remote ? remoteHost?.onMessage(from, data) : role === 'display' ? displayHub?.onSignal(from, data, role) : hub.onSignal(from, data, role)),
    });
    if (!KIOSK) startRemoteHost();
    if (!KIOSK) startDisplayHub();
    hub = new HostHub({
      eventId,
      termsHash: ev.termsHash,
      sock,
      onLive: (peer, stream, role) => {
        const info = sock.peers.find((p) => p.peer === peer) || {};
        const prev = live.get(peer) || {};
        const back = returning.get(peer);
        returning.delete(peer);
        live.set(peer, { ...prev, stream, role: role || info.role || 'cam', name: info.name || 'Guest', cid: info.cid, rec: info.rec, route: prev.route || 'connecting', joinedAt: prev.joinedAt || back?.joinedAt || Date.now() });
        if (KIOSK) for (const ms of [800, 3000, 9000]) setTimeout(() => hub?.message(peer, { t: 'uploads', on: false }), ms); // (phones keep their clips; again in case the link wasn't ready)
        if (typeof isBlocked === 'function' && isBlocked(info.cid)) {
          hub?.message(peer, { t: 'kick', block: true });
          hub?.send(peer, { t: 'kick', block: true });
          setTimeout(() => hub?.drop(peer, 'blocked'), 800);
          note(`${info.name || 'A blocked phone'} tried to rejoin and was turned away (blocked)`);
          live.delete(peer);
          return;
        }
        if ((role || info.role) !== 'mic') noteAngle(info.cid);
        // past the live-picture limit, a new camera records only (it still sends every clip)
        if (live.get(peer).role !== 'mic' && !prev.stream && camOrder().filter((p) => p !== peer).length >= liveLimit) {
          live.get(peer).overflow = true;
          sendSlot(peer);
          note(`${info.name || 'A phone'} joined recording only: the live pictures are full`);
        }
        welcomePhone(peer);
        presenceOn(info.cid);
        checkCrowd();
        setTimeout(sendProgramParts, 1500); // anything they missed while away
        mixAttach(peer);
        renderLive();
        renderMixer();
        const l = live.get(peer);
        note(back ? `${l.name} reconnected` : `${l.name} joined as ${l.role === 'mic' ? 'a microphone' : 'a camera'}`);
        announce(l.role === 'mic' ? `${l.name} joined as a microphone` : `${l.name} is live as camera ${angleOfCid(l.cid)}`);
      },
      onLiveEnd: (peer, why) => {
        const l = live.get(peer);
        if (l) note(why === 'reconnect' ? `${l.name} is reconnecting` : `${l.name} disconnected`);
        if (l && why === 'reconnect') returning.set(peer, { joinedAt: l.joinedAt });
        leavingPeers.delete(peer);
        (l?.card || l?.tile)?.remove();
        if (!l?.leaving) presenceOff(l?.cid); // (one who said they were leaving left then, not when the link closed)
        mixDetach(peer);
        live.delete(peer);
        if (liveActive === peer) {
          lastLive = peer;
          liveActive = null;
        }
        // a live picture may have freed up (a phone that's only reconnecting gets a moment to come back first)
        if (why === 'reconnect') setTimeout(() => !live.has(peer) && rebalanceSlots(), 8000);
        else rebalanceSlots();
        renderLive();
        renderMixer();
      },
      onRoute: (peer, route) => {
        const l = live.get(peer);
        if (l) l.route = route;
        renderLive();
      },
      // what the phone sends changed (sound arriving after the picture, a track swapped or ended)
      onTracks: (peer, stream) => {
        const l = live.get(peer);
        if (!l) return;
        l.stream = stream;
        mixAttach(peer);
        if (l.video) {
          if (l.video.srcObject !== stream) l.video.srcObject = stream;
          l.video.play?.().catch(() => {});
        }
        renderMixer();
      },
      onClip: async (meta, blob) => {
        const rec = { eventId, ...meta, receivedAt: Date.now() };
        await idb.put('clips', { ...rec, blob });
        addClip(rec, blob, true);
      },
      onProgress: (peer, p) => renderIncoming(p),
      onTelemetry: (peer, t) => {
        const l = live.get(peer);
        if (!l) return;
        const was = l.tele?.synced;
        l.tele = t;
        if (was !== t.synced) {
          renderLive(); // the NO SYNC tag
          if (t.synced === false && was) note(`${l.name} lost its beacon sync`);
          if (t.synced && was === false) note(`${l.name} synced with the beacon`);
        }
      },
      onPhoneMessage: (peer, m) => {
        const l = live.get(peer);
        if (!l) return;
        if (m.t === 'seen' || m.t === 'reply') return crewHeard(peer, m);
        if (m.t === 'camstate') {
          l.cam = m;
          return ccuSync();
        }
        if (m.t === 'go' && KIOSK && peer === ap.starter) return apCountIn(peer);
        if (m.t === 'leaving') {
          l.leaving = true;
          presenceOff(l.cid);
          prepareLeaving(peer);
          return;
        }
        if (m.t === 'paused') {
          if (!!m.on === !!l.paused) return;
          l.paused = !!m.on;
          note(`${l.name} ${l.paused ? 'paused their camera' : 'is live again'}`);
          if (l.paused) toast(`${l.name} paused their camera`);
          if (l.paused && peer === liveActive && autoOn) director.set(null, Date.now());
          renderLive();
          return;
        }
        if (m.t === 'orient') {
          l.view = { rect: m.rect, upright: m.upright };
          fitTile(l);
        } else if (m.t === 'qa') {
          l.qa = { base: m.base, parts: m.parts || {}, upright: m.upright, fixed: !!m.fixed, at: Date.now() };
          if (l.fixed !== !!m.fixed) {
            l.fixed = !!m.fixed;
            renderLive();
          }
          renderQuality(l);
        }
      },
      localOnly: () => $('#localOnly').checked,
    });
    setInterval(updateNetwork, 2000);
    setInterval(pushMonitor, 2000);
  }
  if (EDIT_ONLY) {
    document.title = `${ev.title} \u2014 edit`;
    setMode('edit');
  } else setMode('live');
}

function setPresence(peers) {
  const cams = peers.filter((p) => p.role === 'cam');
  const mics = peers.filter((p) => p.role === 'mic');
  const rec = cams.filter((p) => p.rec).length + mics.filter((p) => p.rec).length;
  $('#presence').textContent = `${cams.length} camera${cams.length === 1 ? '' : 's'}${mics.length ? ` · ${mics.length} mic` : ''} · ${rec} recording`;
  $('#recDot').className = 'dot' + (rec ? ' rec' : '');
}

function note(text) {
  diag('event', text);
  log.unshift({ at: Date.now(), text });
  log.length = Math.min(log.length, 200);
}

// The monitors fill whatever space the layout leaves them, keeping their shape.
function fitMonitors() {
  const box = document.querySelector('.monitor');
  if (!box) return;
  const cs = getComputedStyle(box);
  const W = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 6;
  const H = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 6;
  for (const cv of [program, $('#srcCanvas')]) {
    const k = Math.max(0.05, Math.min(W / cv.width, H / cv.height));
    cv.style.width = Math.floor(cv.width * k) + 'px';
    cv.style.height = Math.floor(cv.height * k) + 'px';
  }
}
if (document.querySelector('.monitor')) new ResizeObserver(fitMonitors).observe(document.querySelector('.monitor'));

// ------------------------------------------------------------ output shape ---

function setOrientation(o, persist = true) {
  orientation = o === 'portrait' ? 'portrait' : 'landscape';
  const [w, h] = orientation === 'portrait' ? [720, 1280] : [1280, 720];
  if (program.width !== w || program.height !== h) {
    program.width = w;
    program.height = h;
  }
  document.body.classList.toggle('portrait', orientation === 'portrait');
  fitMonitors();
  $('#landBtn').setAttribute('aria-pressed', String(orientation === 'landscape'));
  $('#portBtn').setAttribute('aria-pressed', String(orientation === 'portrait'));
  if (typeof timeline !== 'undefined' && mode === 'edit') renderTimeline();
  if (!persist) return;
  localStorage.setItem('vm_orient_' + eventId, orientation);
  if (isHost) api(`events/${eventId}`, { method: 'PATCH', host: key, body: { orientation } }).catch(() => {});
  for (const peer of live.keys()) hub?.message(peer, { t: 'output', orientation });
  announce(`Output is now ${orientation}`);
}
$('#landBtn').onclick = () => setOrientation('landscape');
$('#portBtn').onclick = () => setOrientation('portrait');

function setFit(f) {
  fit = f === 'fit' ? 'fit' : 'fill';
  player.fit = fit;
  document.body.classList.toggle('fit', fit === 'fit');
  $('#fillBtn').setAttribute('aria-pressed', String(fit === 'fill'));
  $('#fitBtn').setAttribute('aria-pressed', String(fit === 'fit'));
  localStorage.setItem('vm_fit_' + eventId, fit);
  live.forEach(fitTile);
}
$('#fillBtn').onclick = () => setFit('fill');
$('#fitBtn').onclick = () => setFit('fit');

// ------------------------------------------------------------------ clips ----

function addClip(rec, blob, fresh) {
  if (clips.some((c) => c.id === rec.id)) return;
  const { blob: _b, key: _k, ...meta } = rec;
  clips.push(meta);
  if (meta.kind !== 'audio' && !meta.reel && !meta.program) noteAngle(meta.cid);
  rawBlobs.set(meta.id, blob);
  blobs.set(meta.id, URL.createObjectURL(blob));
  if (meta.kind !== 'audio') makeThumb(meta.id);
  if (fresh) {
    const what = meta.kind === 'audio' ? 'microphone recording' : 'clip';
    note(`${meta.name}'s ${what} arrived (${Math.round(blob.size / 1048576)} MB, verified)`);
    announce(`${meta.name}'s ${what} arrived`); // (no pop-up: it's in the Monitor)
    window.vmLastArrival = Date.now(); // (for tests and diagnostics)
    reportUsageSoon();
    if (!EDIT_ONLY) editCh?.postMessage({ t: 'clip', id: meta.id }); // (the Edit page, if one's open, takes it)
    seqFromEditPage();
    if (editElsewhere()) {
      // the Edit page puts it in the timeline
    } else if (seq.auto) rebuild(false);
    else appendLiveSoon(); // (an edit made by hand: new live footage goes on the end)
    player.setSequence(seq);
    renderAll();
    renderMedia();
  }
}

// Footage that aired after the timeline was edited by hand goes on its end, after a gap as
// long as the real time since the last part (Collapse gaps takes that out). It waits until
// the clips have stopped arriving, so a camera's part and a phone's land together.
let appendTimer = null;
function appendLiveSoon(delay = 3000) {
  if (!EDIT_ONLY) return; // (the Edit page builds the timeline)
  clearTimeout(appendTimer);
  appendTimer = setTimeout(() => {
    if (incoming.size) return appendLiveSoon(); // (more on the way)
    const edl = resolvedEdl().filter((c) => !isBlocked(c.cid));
    const use = clips.filter((c) => !isBlocked(c.cid) && !c.program).map(usable);
    if (seq.auto || !S.appendLive(S.clone(seq), edl, use)) return;
    snapshot();
    const r = S.appendLive(seq, edl, use);
    saveSeq();
    player.setSequence(seq);
    renderTimeline();
    if (mode === 'edit') timeline.zoomToFit();
    const len = fmtDur(r.to - r.from).slice(0, -3), gap = fmtDur(r.gap).slice(0, -3);
    note(`New live footage (${len}) added to the end of the timeline, ${gap} after the last part`);
    toast(`New live footage (${len}) is on the end of the timeline, ${gap} after the last part. Collapse gaps takes the empty time out.`, 6000);
  }, delay);
}

function makeThumb(id) {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = blobs.get(id);
  v.addEventListener('loadeddata', () => {
    v.currentTime = Math.min(1, (v.duration || 2) / 2) || 0.5;
  }, { once: true });
  v.addEventListener('seeked', () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g2 = c.getContext('2d');
    g2.fillStyle = '#000';
    g2.fillRect(0, 0, 320, 180);
    drawFramed(g2, v, 320, 180, 'fill', null, orientAt(clipOf(id), v.currentTime * 1000)?.rect || null);
    thumbs.set(id, c.toDataURL('image/jpeg', 0.7));
    v.removeAttribute('src');
    v.load();
    if (mode === 'edit') renderMulti();
  }, { once: true });
}

// An angle is a phone. Angles are numbered in the order phones first appeared,
// and the numbers mean the same thing live and in the edit.
let angleCids = JSON.parse(localStorage.getItem('vm_angles_' + eventId) || '[]');
function noteAngle(cid) {
  if (!cid || angleCids.includes(cid)) return;
  angleCids.push(cid);
  localStorage.setItem('vm_angles_' + eventId, JSON.stringify(angleCids));
}
const videoClips = () => clips.filter((c) => c.kind !== 'audio').sort((a, b) => a.t0 - b.t0);
const audioClips = () => clips.filter((c) => c.kind === 'audio');
const clipOf = (id) => clips.find((c) => c.id === id);
const angleOfCid = (cid) => angleCids.indexOf(cid) + 1;
const angleNo = (id) => angleOfCid(clipOf(id)?.cid);
const color = (id) => COLORS[(angleNo(id) - 1) % COLORS.length] || '#888';
/** The clip from angle n that's rolling at timeline time t (or null). */
function clipForAngle(n, t) {
  const cid = angleCids[n - 1];
  if (!cid || seq.origin == null) return null;
  const abs = t + seq.origin;
  return videoClips().find((c) => {
    const r = media.range(c);
    return c.cid === cid && abs >= c.t0 + r.in && abs < c.t0 + r.out;
  }) || null;
}
const editAngles = () => angleCids.filter((cid) => videoClips().some((c) => c.cid === cid));

/** Where the picture sits in a phone's square frame at a moment of the clip, from its orientation log. */
function orientAt(clip, ms) {
  const log = clip?.orient;
  if (!log?.length) return null;
  let e = log[0];
  for (const x of log) {
    if (x.t * 1000 <= ms) e = x;
    else break;
  }
  return e;
}
function viewOf(item, ms) {
  const e = orientAt(clipOf(item.src), ms);
  // Square recordings (before 0.12): where the shot sits in the square. Native recordings:
  // how to turn the camera's picture upright, plus any digital zoom or exposure the phone used.
  return e ? { rect: e.rect || null, rot: e.rot || 0, ev: e.ev || 0, ct: e.ct || 0 } : null;
}
/** The shape a clip item shows, after any manual rotation. */
function shapeOf(item) {
  const e = orientAt(clipOf(item.src), (item.in || 0) + 1);
  if (!e) return null;
  const turned = (item.rot || 0) % 180 !== 0;
  return turned ? (e.upright === 'landscape' ? 'portrait' : 'landscape') : e.upright;
}

/** Is this layer smaller than the frame (picture-in-picture, scaled down, or cropped)? */
function isInset(it) {
  if (it.rect) return true;
  if (!it.tf) return false;
  const t = tfOf(it);
  return t.s < 0.999 || t.crop.l > 0 || t.crop.r > 0 || t.crop.t > 0 || t.crop.b > 0;
}

function labelOf(it) {
  if (it.type === 'title') return { text: `${it.style === 'card' ? 'Card' : 'Title'}: ${it.text || ''}`, color: '#e6e9f2' };
  if (it.type === 'slate') return { text: `Break${it.fromLive ? ' (live)' : ' slate'}: ${it.text || ''}`, color: '#f0a82b' };
  if (it.type === 'image') return { text: `Image: ${reel.find((r) => r.id === it.asset)?.name || ''}`, color: '#b9bfd6' };
  const c = clipOf(it.src);
  if (!c) return { text: 'Missing clip', color: '#888' };
  if (c.kind === 'audio') return { text: `Mic · ${c.name}`, color: '#6fd39a' };
  const shape = shapeOf(it);
  const inset = isInset(it);
  return { text: `${angleNo(c.id)} ${c.name}${inset ? ' · PiP' : ''}${it.speed && it.speed !== 1 ? ` · ${Math.round(it.speed * 100)}%` : ''}`, color: color(c.id), shape, pip: inset, mismatch: !!shape && !inset && shape !== orientation && it.fit !== 'fit' };
}

async function saveClipFields(id, fields) {
  const c = clipOf(id);
  Object.assign(c, fields);
  await idb.patch('clips', eventId, id, fields);
}

// ------------------------------------------------------ cut log + sequence ----
// Live cuts are logged on the shared clock as {t, cid} (the phone's full clip
// may not exist yet) and resolved to real clips as they arrive. While the
// sequence is in "auto", the Program track is rebuilt from that log.

function loadCut() {
  try {
    const c = JSON.parse(localStorage.getItem('vm_cut_' + eventId));
    return c && Array.isArray(c.edl) ? c : { edl: [] };
  } catch {
    return { edl: [] };
  }
}
function saveCut() {
  localStorage.setItem('vm_cut_' + eventId, JSON.stringify(cut));
  if (!EDIT_ONLY) editCh?.postMessage({ t: 'cut' }); // (the Edit page, if one's open, follows)
}
function loadSeq() {
  try {
    const s = JSON.parse(localStorage.getItem('vm_seq_' + eventId));
    if (s?.v === 2) return s;
  } catch {}
  return S.newSequence();
}
function saveSeq() {
  if (editElsewhere()) return; // (the Edit page owns the timeline while it's open)
  localStorage.setItem('vm_seq_' + eventId, JSON.stringify(seq));
}
// ---- the live studio and the Edit page, on this computer (the channel is made at the top)
// The timeline belongs to the Edit page, always: the studio records (the recordings, the live
// cut) and tells the Edit page, which builds the timeline from them, when it opens and as things
// arrive. The studio never builds or saves it.
function editElsewhere() {
  return !EDIT_ONLY;
}
function seqFromEditPage() {}

function resolvedEdl() {
  const vids = videoClips();
  return cut.edl
    .map((e) => {
      if (e.slate) return { t: e.t, slate: e.slate }; // (a break: the slate, in Edit)
      if (e.black) return { t: e.t, black: true, fade: e.fade || 0 }; // (black: nothing, the shot before fading out)
      if (e.clip && vids.some((c) => c.id === e.clip)) return { t: e.t, clip: e.clip, ...(e.dissolve ? { dissolve: e.dissolve } : {}), ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}) };
      if (!e.cid) return null;
      // a cut up to 5 s before that phone's recording started still belongs to it
      // Of the clips rolling at the moment of the cut, the newest (a phone that rolled to a
      // new clip wins the overlap). If none was rolling yet, the first to start. (Taking the
      // newest of everything within 5 s skipped a first clip when the phone rolled quickly.)
      const near = vids.filter((k) => k.cid === e.cid && e.t >= k.t0 - 5000 && e.t < k.t0 + k.dur);
      const rolling = near.filter((k) => e.t >= k.t0).sort((a, b) => b.t0 - a.t0);
      const c = rolling[0] || near.sort((a, b) => a.t0 - b.t0)[0];
      return c ? { t: Math.max(e.t, c.t0), clip: c.id, ...(e.dissolve ? { dissolve: e.dissolve } : {}), ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

/** A recording as the edit sees it: only its usable (trimmed) range. */
function usable(c) {
  const r = media.range(c);
  return r.in === 0 && r.out === c.dur ? c : { ...c, t0: c.t0 + r.in, dur: r.out - r.in, inBase: r.in };
}
function rebuild(announceIt = true) {
  if (!EDIT_ONLY) return; // (the Edit page builds the timeline)
  S.rebuildFromCuts(seq, resolvedEdl().filter((c) => !isBlocked(c.cid)), clips.filter((c) => !isBlocked(c.cid) && !c.program).map(usable));
  saveSeq();
  if (announceIt) announce('Program rebuilt from your cuts');
}

// Undo: snapshots of the sequence and the cut log.
const undoStack = [];
const redoStack = [];
function snapshot() {
  undoStack.push(JSON.stringify({ seq, cut }));
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}
function restore(stateJson) {
  const st = JSON.parse(stateJson);
  seq = st.seq;
  cut = st.cut;
  saveCut();
  commit(false);
}
function undo() {
  if (!undoStack.length) return toast('Nothing to undo');
  redoStack.push(JSON.stringify({ seq, cut }));
  restore(undoStack.pop());
  announce('Undone');
}
function redo() {
  if (!redoStack.length) return toast('Nothing to redo');
  undoStack.push(JSON.stringify({ seq, cut }));
  restore(redoStack.pop());
  announce('Redone');
}
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;

/** After any edit: save, refresh the player, redraw. */
function commit() {
  saveSeq();
  player.setSequence(seq);
  renderTimeline();
  renderInspector();
  renderCredits();
  renderMixer();
  if (leftTab === 'media') renderMedia();
}

// ------------------------------------------------------------------- modes ----

let fittedOnce = false, lastFitEnd = 0;
function setMode(m) {
  if (EDIT_ONLY && m !== 'edit') return; // (the Edit page only edits)
  if (!EDIT_ONLY && m === 'edit') return void openEditWindow(); // (and the studio never does: Edit is its own window)
  if (m === 'edit') seqFromEditPage();
  mode = m;
  document.body.dataset.mode = m;
  $('#liveTab').setAttribute('aria-selected', String(m === 'live'));
  $('#editTab').setAttribute('aria-selected', String(m === 'edit'));
  player.enabled = m === 'edit';
  if (m === 'live') player.pause();
  else flushRecordings('Edit');
  renderAll();
  setLeftTab(leftTab);
  setMonTab(m === 'edit' ? monTab : 'program');
  applyLayout();
  if (m === 'edit' && S.end(seq) > 0 && (!fittedOnce || S.end(seq) > lastFitEnd + 1000)) {
    fittedOnce = true;
    lastFitEnd = S.end(seq);
    timeline.zoomToFit(); // (new footage since you were last here: show all of it)
  }
  announce(m === 'live' ? 'Live mode' : 'Edit mode');
}
$('#liveTab').onclick = () => setMode('live');
$('#editTab').onclick = () => openEditWindow();
// Edit in its own window, beside the live studio: it rebuilds as recordings land
/** Edit is its own window, in its own browser process (opened without a link back, so a heavy
 *  export there can't hold up the live show here). Open, it's asked to come forward over the
 *  channel, and gets what's recording so far; otherwise a new one opens. */
function openEditWindow() {
  if (EDIT_ONLY) return;
  localStorage.setItem('vm_edit_last', eventId);
  if (Date.now() - editPageAt < 5000) {
    editCh?.postMessage({ t: 'focus' });
    flushRecordings('Edit window');
    toast('Edit is open in its own window');
    return;
  }
  window.open(`/edit?e=${eventId}`, '_blank', 'noopener');
  // (opened without a link back, so a blocked pop-up can't be seen directly: if no Edit window says hello, say how)
  const asked = Date.now();
  setTimeout(() => editPageAt < asked && toast('If Edit didn\u2019t open, allow pop-ups for this site', 6000), 6000);
}


function renderAll() {
  if (mode === 'live') renderLive();
  else renderMulti();
  renderMixer();
  renderTimeline();
  renderInspector();
  renderCredits();
}

// ---------------------------------------------------------------- live mode ---

// cameras with a live picture (record-only overflow phones aren't shown live)
const camOrder = () => [...live.keys()].filter((p) => live.get(p).role !== 'mic' && !live.get(p).overflow)
  .sort((a, b) => (angleOfCid(live.get(a).cid) || 99) - (angleOfCid(live.get(b).cid) || 99));
const micPeers = () => [...live.keys()].filter((p) => live.get(p).role === 'mic');
/** A microphone's number key: they come after the cameras' numbers (cameras 1–3, microphones 4, 5…). */
const micKey = (peer) => {
  const i = micPeers().indexOf(peer);
  const n = angleCids.length + i + 1;
  return i < 0 || n > 9 ? 0 : n;
};
const isMic = (peer) => live.get(peer)?.role === 'mic';
// How loud each microphone has been lately (smoothed over about half a second), from its
// own analyser before the fader, so a fader or AFV doesn't change who's "talking".
const micLoud = new Map(), micBuf = new Float32Array(512);
function loudestMic() {
  let best = null, bestV = -1;
  for (const p of micPeers()) {
    const v = micLoud.get(p) || 0;
    if (v > bestV) [best, bestV] = [p, v];
  }
  return best;
}
setInterval(() => {
  for (const p of micPeers()) {
    const st = mix.strips?.get(p);
    if (!st?.pre) continue;
    st.pre.getFloatTimeDomainData(micBuf);
    let ss = 0;
    for (let i = 0; i < micBuf.length; i++) ss += micBuf[i] * micBuf[i];
    const rms = Math.sqrt(ss / micBuf.length);
    micLoud.set(p, (micLoud.get(p) || 0) * 0.6 + rms * 0.4);
  }
  // the auto director for sound: no cameras up, two or more microphones: whoever's talking
  if (!autoOn || mode !== 'live' || onBreak() || mediaOn || Date.now() < manualUntil) return;
  const camUp = camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; });
  if (camUp || micPeers().length < 2) return;
  const best = loudestMic(), cur = liveActive && isMic(liveActive) ? liveActive : null;
  const bv = micLoud.get(best) || 0, cv = cur ? micLoud.get(cur) || 0 : 0;
  const held = Date.now() - (lastOnAir.get(cur) || 0);
  // louder by about 4 dB, above room noise (about −46 dBFS), and the current one held 2.5 s
  if (best && best !== cur && bv > 0.005 && bv > cv * 1.6 && (!cur || held > 2500)) cutLive(best, 'speaking');
}, 150);

function renderLive() {
  ccuSync();
  if (pvw && !live.has(pvw)) pvw = null;
  if (sw.to && !live.has(sw.to)) Object.assign(sw, { from: null, to: null, toClip: null, fromClip: null, p: 0, target: 0, auto: null, pos: sw.rest });
  if (mode !== 'live') return;
  renderBus();
  for (const l of live.values()) if (l.overflow && l.card) l.card.style.display = 'none';
  if (typeof renderOverflow === 'function') renderOverflow();
  const box = $('#multi');
  const cams = camOrder();
  box.querySelector('.empty')?.remove();
  box.querySelectorAll('.tile[data-angle]').forEach((t) => t.remove());
  $('#srcCount').textContent = cams.length ? `${cams.length} live` : '';
  if (!cams.length && !micPeers().length) {
    box.insertAdjacentHTML('afterbegin', `<div class="empty">${KIOSK ? 'No cameras yet: scan the code to join.' : 'No phones yet. Put the beacon on a screen; phones on this Wi-Fi that scan it show up here.'}</div>`);
  }
  cams.forEach((peer, i) => {
    const l = live.get(peer);
    if (!l.tile) {
      l.tile = document.createElement('button');
      l.tile.type = 'button';
      l.tile.className = 'tile';
      l.tile.dataset.peer = peer;
      l.video = document.createElement('video');
      l.video.muted = true;
      l.video.playsInline = true;
      l.video.autoplay = true;
      l.tile.append(l.video);
      l.tile.insertAdjacentHTML('beforeend', `<span class="n"></span><span class="who"></span><span class="route"></span><span class="dot rec" hidden></span><span class="aud" aria-hidden="true"></span>`);
      l.tile.onclick = () => takeSource(peer);
      l.card = document.createElement('div');
      l.card.className = 'cam';
      l.card.append(l.tile);
      box.append(l.card);
    }
    l.card.style.display = '';
    l.card.style.order = i;
    if (!l.card.isConnected) box.append(l.card);
    if (l.video.srcObject !== l.stream) {
      l.video.srcObject = l.stream;
      l.video.play().catch(() => {});
    } else if (l.video.paused) l.video.play().catch(() => {});
    fitTile(l);
    renderQuality(l);
    l.tile.style.display = '';
    l.tile.classList.toggle('paused', !!l.paused);
    let pz = l.tile.querySelector('.pz');
    if (l.paused && !pz) l.tile.insertAdjacentHTML('beforeend', '<span class="pz">PAUSED</span>');
    else if (!l.paused) pz?.remove();
    if (isHost && !l.local) dmRow(peer, l, i);
    l.tile.querySelector('.n').textContent = angleOfCid(l.cid) || i + 1;
    l.tile.querySelector('.who').textContent = l.name;
    // a camera that hasn't synced with the beacon: its clips would be placed by its own clock
    let ns = l.tile.querySelector('.nosync');
    const unsynced = l.tele?.synced === false;
    if (unsynced && !ns) l.tile.insertAdjacentHTML('beforeend', '<span class="nosync" title="This phone hasn’t synced with the beacon yet: ask them to point it at the beacon screen once">NO SYNC</span>');
    else if (!unsynced) ns?.remove();
    let pcTag = l.tile.querySelector('.pctag');
    if (l.fixed && !pcTag) l.tile.insertAdjacentHTML('beforeend', '<span class="pctag" title="A computer camera: fixed, no gyro">PC</span>');
    else if (!l.fixed) pcTag?.remove();
    const r = l.tile.querySelector('.route');
    r.textContent = { lan: 'LAN', nat: 'LAN·NAT', cellular: 'CELL', internet: 'NET', relay: 'RELAY', local: 'THIS PC' }[l.route] || '…';
    r.className = 'route ' + (l.route === 'nat' || l.route === 'local' ? 'lan' : l.route);
    r.title = { local: 'A camera on this computer: on the studio\u2019s own clock, no beacon needed', lan: 'Direct over the local network', nat: 'Same network, through the router', cellular: 'On mobile data — ask this guest to join the venue Wi-Fi' }[l.route] || 'Not on the local network — ask this guest to join the venue Wi-Fi';
    l.tile.querySelector('.rec').hidden = !l.rec;
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Camera ${angleOfCid(l.cid) || i + 1}, ${l.name}${peer === liveActive ? ', on air' : ''}${l.rec ? ', recording' : ''}`);
  });
  // Microphones are live sources too: click one (or press its number) to put it on air, with
  // its sound on the program picture and the tally on the phone, like a camera.
  micPeers().forEach((peer, i) => {
    const l = live.get(peer);
    if (!l.tile) {
      l.tile = document.createElement('button');
      l.tile.type = 'button';
      l.tile.className = 'mic';
      l.tile.dataset.peer = peer;
      // (its picture: what the program shows while it's on air, drawn from its own sound)
      l.tile.innerHTML = `<canvas class="mv" width="320" height="180" aria-hidden="true"></canvas><span class="glyph" aria-hidden="true">M</span><b></b><span class="meter" aria-hidden="true"><i></i></span>`;
      l.tile.onclick = () => takeSource(peer);
      box.prepend(l.tile);
    }
    l.tile.style.order = -10 + i;
    l.tile.style.display = ''; // (Edit hides every source; bring microphones back too)
    const n = micKey(peer);
    l.tile.querySelector('.glyph').textContent = n || 'M';
    l.tile.querySelector('b').textContent = `${l.name} · mic${l.rec ? ' · recording' : ''}`;
    l.tile.classList.toggle('on', mixState(l.cid || peer, 'mic').mode !== 'off');
    l.tile.classList.toggle('live', peer === liveActive && !onBreak());
    l.tile.classList.toggle('pvw', peer === pvw);
    l.tile.setAttribute('aria-label', `Microphone ${n}, ${l.name}${peer === liveActive ? ', on air' : ''}. Put it on air.`);
  });
  renderSpecials();
}

// ---- the break and black as sources: tiles beside the cameras -----------------------------
function renderSpecials() {
  const box = $('#multi');
  if (KIOSK || !box || mode !== 'live') return;
  let row = box.querySelector('.specials');
  if (!row) {
    row = document.createElement('div');
    row.className = 'cam specials';
    row.innerHTML = [['break', 'Break', 'B', 'The break slate (B cuts to it)'], ['black', 'Black', '⇧X', 'Black (Shift+X cuts to it, X fades)']]
      .map(([k, name, key, title]) => `<button type="button" class="tile special" data-special="${k}" title="${title}"><canvas width="320" height="180" aria-hidden="true"></canvas><span class="n">${key}</span><span class="who">${name}</span></button>`).join('');
    row.addEventListener('click', (e) => {
      const b = e.target.closest('[data-special]');
      if (b) takeSpecial(b.dataset.special);
    });
    box.append(row);
  }
  row.style.display = '';
  const air = { break: onBreak() && black.target !== 1, black: black.target === 1 };
  for (const b of row.querySelectorAll('[data-special]')) {
    const k = b.dataset.special;
    b.classList.toggle('live', air[k]);
    b.classList.toggle('pvw', pvwSpecial === k);
    b.setAttribute('aria-pressed', String(air[k]));
    b.setAttribute('aria-label', `${k === 'black' ? 'Black' : 'The break'}${air[k] ? ', on air. Tap to come back.' : tapMode === 'preview' ? '. Put it in preview.' : '. Put it on air.'}`);
  }
}
/** The source tiles that are pictures we draw (the break, black, each microphone): about 8 a second. */
let srcPrevAt = 0;
function drawSourcePreviews() {
  if (document.hidden || stalled() || performance.now() - srcPrevAt < 125) return;
  srcPrevAt = performance.now();
  const brk = document.querySelector('#multi [data-special="break"] canvas');
  if (brk?.offsetParent) drawSlate(brk.getContext('2d'), brk.width, brk.height, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
  const blk = document.querySelector('#multi [data-special="black"] canvas');
  if (blk?.offsetParent && !blk.dataset.drawn) {
    const g = blk.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, blk.width, blk.height);
    blk.dataset.drawn = '1';
  }
  for (const peer of micPeers()) {
    const c = live.get(peer)?.tile?.querySelector('canvas.mv');
    if (c?.offsetParent) drawMicVisual(c.getContext('2d'), c.width, c.height, micTileOpts(peer));
  }
}
/** One microphone's own sound and name for its picture (its tile, the preview box). */
const micTile = new Map(); // peer → { env, at, caps }
function micTileOpts(peer) {
  const an = mix.strips.get(peer)?.pre;
  let st = micTile.get(peer);
  if (!st) micTile.set(peer, (st = { env: new Float32Array(90), at: 0, caps: new Float32Array(64) }));
  return { an, spec: an, state: st, name: live.get(peer)?.name || '' };
}

function cutLive(peer, autoReason, opts = {}) {
  if (!isHost) return;
  const l = live.get(peer);
  if (!l) return;
  if (l.overflow) return toast(`${l.name} is recording only (the live pictures are full). Swap them in first.`);
  if (l.paused) return toast(`${l.name} has paused their camera`);
  lastOnAir.set(peer, Date.now());
  if (liveActive) lastOnAir.set(liveActive, Date.now());
  if (!autoReason && autoOn) manualUntil = Date.now() + 8000; // you took over; the director waits
  director.set(peer, Date.now());
  breakManual = false;
  directorBreak = false;
  if (mediaOn) stopMedia();
  liveActive = peer;
  lastLive = peer;
  // (the live cut that Edit starts from is pictures: a microphone on air doesn't change it)
  if (l.cid && l.role !== 'mic') {
    snapshot();
    // (from black, the fade up puts the camera in the live cut: see toggleBlack)
    if (!opts.underBlack) cut.edl.push({ t: (opts.at ?? now()) - LIVE_DELAY, cid: l.cid, ...(opts.dissolveMs >= 40 ? { dissolve: Math.round(opts.dissolveMs) } : {}) }); // (a dissolve: from when it began, as long as it took)
    saveCut();
    if (seq.auto && clips.length) {
      rebuild(false);
      player.setSequence(seq);
      renderTimeline();
    }
  }
  mixFollowCut();
  renderLive();
  syncBreakUi();
  syncTally();
  if (!autoReason && !opts.underBlack) blackHint();
  if (pvw === peer) pvw = null;
  note(`${opts.dissolve ? 'Dissolve' : autoReason ? 'Auto' : 'Cut'}: ${l.role === 'mic' ? `microphone ${micKey(peer) || ''}` : `camera ${angleOfCid(l.cid)}`} (${l.name})${autoReason ? ' — ' + autoReason : ''}`);
  announce(`Cut to camera ${angleOfCid(l.cid)}, ${l.name}`);
}

// Phones send a square picture with the shot somewhere inside it; size the tile's
// video so exactly the shot fills the tile.
function fitTile(l) {
  const v = l.video, tile = l.tile;
  if (!v || !tile) return;
  const r = l.view?.rect;
  if (!r) {
    Object.assign(v.style, { width: '100%', height: '100%', left: '0', top: '0', objectFit: 'cover' });
    return;
  }
  const TW = tile.clientWidth, TH = tile.clientHeight;
  const k = fit === 'fit' ? Math.min(TW / r.w, TH / r.h) : Math.max(TW / r.w, TH / r.h);
  Object.assign(v.style, { objectFit: 'fill', width: k + 'px', height: k + 'px', left: (TW - r.w * k) / 2 - r.x * k + 'px', top: (TH - r.h * k) / 2 - r.y * k + 'px' });
  tile.dataset.shape = l.view.upright;
}
window.addEventListener('resize', () => live.forEach(fitTile));

// ---- keep live pictures moving ------------------------------------------------------------
// A live picture can stop in three places: this window's player (the tile), the decoder
// (video arrives but no frames come out of it), or the phone's sender (the phone is running
// and drawing, but no picture arrives). Reloading the studio fixed all three because it
// rebuilds every connection. Instead, every two seconds each camera is checked and only the
// stuck part is fixed: a fresh player for the tile (swapped in once it has a frame, so the
// program never blinks), or a reconnect for that one phone. Every fix goes in the log.
const picHealth = new Map(); // peer → { fixes: [ms], reconnects: [ms], warned }
// Sound: every two seconds, each phone's muted player is kept playing, the audio engine
// kept running, and a sound source that has given nothing but exact zeros for 8 seconds
// (real microphones always hiss a little) is rebuilt from the phone's track.
const preBuf = new Float32Array(512);
// What the edit is playing right now: each clip's player, whether it's running, where its
// sound goes, and the audio engine's state (diagnostics and tests).
window.vmEdit = () => ({
  ctx: player.ctx.state,
  playing: player.playing,
  t: Math.round(player.t),
  tracks: (seq.tracks || []).filter((t) => t.kind === 'audio').map((t) => ({ id: t.id, name: t.name, muted: !!t.muted, gain: t.gain ?? 1, items: S.audioItems ? undefined : undefined })),
  els: [...player.els.values()].map((e) => ({ key: e.key.slice(0, 40), paused: e.v.paused, ready: e.v.readyState, error: e.v.error?.code || null, muted: e.v.muted, gain: Math.round(e.gain.gain.value * 100) / 100, bus: e.wired || null })),
});
// ---- usage, anonymously ----
// This event's running totals (recordings, footage, live cut and streaming time) go to the
// server now and then, which adds what's new to the day's anonymous counts (Admin, Growth).
// Totals only: no names, pictures or sound, nothing about anyone.
var usageAcc = null, usageTimer = null, usageSent = ''; // (var: used before this line runs)
function usageStore() {
  usageAcc ||= JSON.parse(localStorage.getItem('vm_usage_' + eventId) || '{"liveCutSec":0,"streamSec":0}');
  return usageAcc;
}
function addUsage(k, sec) {
  if (!(sec > 0)) return;
  const u = usageStore();
  u[k] = (u[k] || 0) + sec;
  localStorage.setItem('vm_usage_' + eventId, JSON.stringify(u));
  reportUsageSoon(5000);
}
function reportUsageSoon(delay = 60000) {
  clearTimeout(usageTimer);
  usageTimer = setTimeout(() => reportUsage(), delay);
}
async function reportUsage(leaving) {
  if (!isHost || !eventId) return;
  const u = usageStore();
  // (a recording's length counts if it's plausible: one with a nonsense length, 83 days once,
  // is left out of the footage and named in the event log, so the cause can be found)
  const recs = clips.filter((c) => !c.program && !c.reel);
  for (const c of recs) if (!(c.dur > 0 && c.dur <= 6 * 3600e3) && !c.durNoted) {
    c.durNoted = true;
    note(`${c.name}'s recording says it's ${Math.round((c.dur || 0) / 1000)} s long, which can't be right: left out of the footage count`);
    diag('clip', `implausible length: ${c.id} ${c.name} dur=${c.dur} t0=${c.t0} mime=${c.mime} src=${c.t0Source || ''}`);
  }
  const body = {
    clips: recs.length, footageSec: Math.round(recs.reduce((s, c) => s + (c.dur > 0 && c.dur <= 6 * 3600e3 ? c.dur : 0), 0) / 1000),
    liveCutSec: Math.round(u.liveCutSec || 0), streamSec: Math.round(u.streamSec || 0),
    liveSec: Math.round(u.liveSec || 0), editSec: Math.round(u.editSec || 0), kioskSec: Math.round(u.kioskSec || 0),
  };
  const sig = JSON.stringify(body);
  if (sig === usageSent || !Object.values(body).some(Boolean)) return;
  try {
    if (leaving) fetch(`${(window.VM_CONFIG?.api || '/api').replace(/\/$/, '')}/events/${eventId}/usage`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Host-Key': key }, body: sig });
    else await api(`events/${eventId}/usage`, { method: 'POST', host: key, body });
    usageSent = sig;
  } catch {}
}
setInterval(() => reportUsage(), 10 * 60000);
// Time used, by what the studio was doing: live, editing, or running a kiosk (while it's on
// screen, or has phones in, or is recording). Counted per event (Admin shows it).
setInterval(() => {
  if (!isHost || !eventId || !(document.visibilityState === 'visible' || live.size || progRec)) return;
  const u = usageStore(), k = KIOSK ? 'kioskSec' : mode === 'edit' ? 'editSec' : 'liveSec';
  u[k] = (u[k] || 0) + 10;
  localStorage.setItem('vm_usage_' + eventId, JSON.stringify(u));
}, 10000);
window.vmReportUsage = () => reportUsage(); // (tests and diagnostics: report now)
window.addEventListener('pagehide', () => reportUsage(true));

// What the studio is playing and hearing from each phone right now (diagnostics and tests).
window.vmMedia = () =>
  [...live].map(([peer, l]) => {
    const st = mix.strips?.get(peer), v = l.video;
    let level = null;
    if (st?.pre) {
      st.pre.getFloatTimeDomainData(preBuf);
      level = Math.max(...preBuf.map(Math.abs));
    }
    return {
      peer, name: l.name, videoFrames: v?.getVideoPlaybackQuality?.().totalVideoFrames ?? null, videoTime: v?.currentTime ?? null,
      videoTracks: l.stream?.getVideoTracks().map((t) => t.readyState) || [], audioTracks: l.stream?.getAudioTracks().map((t) => t.readyState + (t.muted ? ' muted' : '')) || [],
      hearing: !!st?.src && st.trackId === l.stream?.getAudioTracks()[0]?.id, level,
      control: l.cam ? { remote: l.cam.remote, lenses: (l.cam.lenses || []).map((x) => x.label), lens: l.cam.lens } : null,
    };
  });
setInterval(() => {
  if (!mix.strips?.size) return;
  if (player.ctx?.state === 'suspended') player.ctx.resume().catch(() => {});
  for (const [peer, st] of mix.strips) {
    const l = live.get(peer);
    if (!l || !st.src || !st.pre) continue;
    if (st.sink?.paused) st.sink.play().catch(() => {});
    const at = l.stream?.getAudioTracks().find((t) => t.id === st.trackId);
    if (!at || at.readyState !== 'live' || at.muted || !at.enabled || l.paused) {
      st.silentSince = 0;
      if (!at || at.readyState !== 'live') mixAttach(peer);
      continue;
    }
    st.pre.getFloatTimeDomainData(preBuf);
    if (preBuf.some((v) => v !== 0)) st.silentSince = 0;
    else if (!st.silentSince) st.silentSince = Date.now();
    else if (Date.now() - st.silentSince > 8000) {
      note(`${l.name}'s sound had stopped reaching the mixer: reconnected it`);
      st.trackId = null;
      mixAttach(peer);
    }
  }
}, 2000);
let picBusy = false;
const tileShowing = (l) => mode === 'live' && !document.hidden && !!l.tile?.isConnected && l.card?.style.display !== 'none' && l.tile.offsetParent !== null;
const healthOf = (peer) => {
  if (!picHealth.has(peer)) picHealth.set(peer, { fixes: [], reconnects: [] });
  return picHealth.get(peer);
};

async function watchPictures() {
  if (!hub || picBusy) return;
  picBusy = true;
  try {
    for (const [peer, l] of [...live]) {
      if (l.role === 'mic' || l.local || !l.video || !l.stream) continue; // (this computer's own cameras: no link to fix)
      if (l.video.srcObject !== l.stream) {
        l.video.srcObject = l.stream;
        l.video.play().catch(() => {});
      } else if (l.video.paused && l.tile?.isConnected) l.video.play().catch(() => {});
      const st = await hub.videoIn(peer);
      if (live.get(peer) !== l) continue;
      const w = (l.wd ||= { el: 0, dec: 0, send: 0, last: null });
      const cur = { bytes: st?.bytes || 0, dec: st?.decoded || 0, frames: l.video.getVideoPlaybackQuality?.().totalVideoFrames || 0, ct: l.video.currentTime, at: performance.now() };
      const prev = w.last;
      w.last = cur;
      const track = l.stream.getVideoTracks()[0];
      if (!prev || !st || st.state !== 'connected' || !track || track.readyState !== 'live' || l.paused || l.overflow || l.leaving) {
        w.el = w.dec = w.send = 0;
        continue;
      }
      const dt = cur.at - prev.at;
      const arriving = cur.bytes > prev.bytes, decoding = cur.dec > prev.dec;
      const shown = cur.frames > prev.frames || cur.ct !== prev.ct;
      const drawing = !!l.qa && Date.now() - l.qa.at < 3000 && l.qa.pv > 0; // the phone says it's drawing its preview
      w.el = decoding && !shown && tileShowing(l) ? w.el + dt : 0;
      w.dec = arriving && !decoding ? w.dec + dt : 0;
      w.send = !arriving && drawing ? w.send + dt : 0;
      const h = healthOf(peer);
      const t = Date.now();
      h.fixes = h.fixes.filter((x) => t - x < 60000);
      if (w.el >= 4000) {
        w.el = 0;
        if (h.fixes.length >= 2) reconnectPhone(peer, 'its picture kept freezing in this window', true);
        else {
          h.fixes.push(t);
          freshPlayer(peer, 'its picture froze in this window');
        }
      } else if (w.dec >= 4000 || w.send >= 6000) {
        const why = w.dec >= 4000 ? 'its video arrived but stopped decoding' : 'the phone stopped getting its picture through';
        w.dec = w.send = 0;
        reconnectPhone(peer, why, true);
      }
    }
  } finally {
    picBusy = false;
  }
}
setInterval(watchPictures, 2000);

/** Give a camera's tile a new player, swapped in once it has a frame (the program keeps the old one till then). */
function freshPlayer(peer, why) {
  const l = live.get(peer);
  if (!l?.stream || !l.video) return;
  const old = l.video;
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = l.stream;
  let done = false;
  const swap = () => {
    if (done || live.get(peer) !== l || l.video !== old) return;
    done = true;
    v.style.cssText = old.style.cssText;
    if (old.parentNode) old.replaceWith(v);
    else l.tile?.prepend(v);
    old.srcObject = null;
    l.video = v;
    l.lastMove = performance.now();
    if (l.wd) l.wd.last = null;
    fitTile(l);
  };
  v.addEventListener('loadeddata', swap, { once: true });
  setTimeout(swap, 3000);
  v.play().catch(() => {});
  note(`Camera ${angleOfCid(l.cid) || '?'} (${l.name}): ${why}, so it got a fresh picture`);
}

/** Ask one phone to rebuild its link. Automatic ones are spaced out and give up after three in five minutes. */
function reconnectPhone(peer, why, auto = false) {
  const l = live.get(peer);
  if (!l || !hub) return;
  const h = healthOf(peer);
  const t = Date.now();
  const n = angleOfCid(l.cid) || '?';
  h.reconnects = h.reconnects.filter((x) => t - x < 300000);
  if (auto) {
    if (h.reconnects.length && t - h.reconnects[h.reconnects.length - 1] < 45000) return;
    if (h.reconnects.length >= 3) {
      if (!h.warned) {
        h.warned = true;
        note(`Camera ${n} (${l.name}): ${why}, again. Not reconnecting it automatically any more.`);
        toast(`Camera ${n} (${l.name}) keeps losing its picture. Check the phone: screen on, VUEMesh in front, good Wi-Fi. Right-click its tile to reconnect it.`, 9000);
      }
      return;
    }
  }
  if (!hub.restart(peer)) return;
  h.reconnects.push(t);
  note(`Camera ${n} (${l.name}): ${why}, so it's reconnecting`);
  if (!auto) toast(`Reconnecting ${l.name}…`);
}

const scoreOfLive = (l) => (l.qa && Date.now() - l.qa.at < 3000 ? shotScore(l.qa.base ?? 0.5, l.qa.upright, orientation, l.qa.fixed) : null);
function renderQuality(l) {
  if (!l.tile || l.role === 'mic') return;
  let q = l.tile.querySelector('.q');
  if (!q) {
    l.tile.insertAdjacentHTML('beforeend', '<span class="q" aria-hidden="true"><i></i></span><span class="why" hidden></span>');
    q = l.tile.querySelector('.q');
  }
  const sc = scoreOfLive(l);
  q.querySelector('i').style.width = Math.round((sc ?? 0) * 100) + '%';
  q.classList.toggle('bad', sc != null && sc < 0.35);
  const why = sc != null && sc < 0.5 ? whatsWrong(l.qa.parts, l.qa.upright, orientation, l.qa.fixed) : null;
  const w = l.tile.querySelector('.why');
  w.hidden = !why;
  w.textContent = why || '';
}

// ---- tally: the phone that's on air lights up --------------------------------------------
let tallied = null;
let pvwTallied = null, swTallied = null;
function syncTally() {
  renderBus();
  // through a dissolve, the incoming camera is on air too (tally on, and it starts recording)
  const inc = swActive() && sw.to && live.has(sw.to) && sw.to !== liveActive ? sw.to : null;
  if (inc !== swTallied) {
    if (swTallied && swTallied !== liveActive) hub?.send(swTallied, { t: 'tally', on: false });
    if (inc) hub?.send(inc, { t: 'tally', on: true, rec: recOnAir() });
    swTallied = inc;
  }
  localRecFollow();
  const pv = pvw && live.has(pvw) && (pvw !== liveActive || airCovered()) ? pvw : null;
  if (pv !== pvwTallied) {
    if (pvwTallied) hub?.send(pvwTallied, { t: 'pvw', on: false });
    if (pv) hub?.send(pv, { t: 'pvw', on: true });
    pvwTallied = pv;
  }
  const on = onBreak() || mediaOn || black.target === 1 ? null : liveActive;
  if (on === tallied) return;
  if (tallied) hub?.send(tallied, { t: 'tally', on: false });
  if (on) hub?.send(on, { t: 'tally', on: true, rec: recOnAir() });
  tallied = on;
}
setInterval(() => {
  // resend now and then, in case a message was lost
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir() });
}, 4000);
// Cameras record their time on air while the director is recording the show (Record program):
// just cutting around shows the cameras live and records nothing. (With the setting on; it is
// by default.) A camera person's own recording is theirs, and runs as they choose.
const recOnAir = () => autoRec && !!progRec && !progRec.stopping;
function recOnAirChanged() {
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir() });
  if (swTallied) hub?.send(swTallied, { t: 'tally', on: true, rec: recOnAir() });
  localRecFollow();
}
// Cameras record while they're on air (if they weren't already): on unless the host turns it off.
// (the host's last choice carries over to new events)
let autoRec = (localStorage.getItem('vm_autorec_' + eventId) ?? localStorage.getItem('vm_autorec_default') ?? '1') !== '0';
$('#autoRec').checked = autoRec;
$('#autoRec').onchange = (e) => {
  autoRec = e.target.checked;
  localStorage.setItem('vm_autorec_' + eventId, autoRec ? '1' : '0');
  localStorage.setItem('vm_autorec_default', autoRec ? '1' : '0');
  if (tallied) hub?.send(tallied, { t: 'tally', on: true, rec: recOnAir() });
  note(autoRec ? 'Cameras now record their time on air while you Record program' : 'Cameras no longer record automatically when on air');
};

// ---- the AI technical director -------------------------------------------------------------
// Phones rate their own shots (steady, level, not black, not covered, right way round);
// the director holds a shot at least 3 s, cuts away from a bad one within a second,
// changes angle for variety, and goes to the break slate if nothing is usable.

const director = new Director();
let autoOn = false;
let manualUntil = 0;
let directorBreak = false;
function setAuto(on) {
  autoOn = on;
  $('#autoBtn').setAttribute('aria-pressed', String(on));
  director.set(liveActive, Date.now());
  if (!on && directorBreak) {
    directorBreak = false;
    syncBreakUi();
  }
  $('#directorNote').textContent = on ? 'Auto director is cutting. Press a number to take over for 8 seconds.' : 'Press 1–9 to cut, or let the auto director cut for you.';
  note(on ? 'Auto director on' : 'Auto director off');
  announce(on ? 'Auto director on' : 'Auto director off');
}
$('#autoBtn').onclick = () => isHost && setAuto(!autoOn);
function directorTick() {
  if (!autoOn || mode !== 'live' || breakManual || mediaOn || Date.now() < manualUntil) return;
  // (on autopilot, a camera that's just arrived waits to be welcomed: preview, then on air with its name)
  const sources = camOrder().filter((peer) => !live.get(peer).paused && (!ap?.on || ap.seen.has(peer) || peer === liveActive)).map((peer) => {
    const l = live.get(peer);
    return { id: peer, score: scoreOfLive(l) ?? 0.5, parts: l.qa?.parts, upright: l.qa?.upright, fixed: !!l.qa?.fixed };
  });
  if (!sources.length) return;
  const r = director.step(Date.now(), sources, orientation);
  if (r.breakOn !== directorBreak) {
    directorBreak = r.breakOn;
    syncBreakUi();
    mixFollowCut();
    syncTally();
    if (r.breakOn) note(`Auto director: ${r.reason}`);
  }
  if (r.cut && r.cut !== liveActive) cutLive(r.cut, r.reason);
}

// ---- network: get phones talking to this computer directly -------------------------------
// Browsers hide a computer's local address unless the page has microphone or camera
// permission. With it, phones on the same Wi-Fi can connect straight to this laptop.
async function micPermission() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return 'prompt';
  }
}
$('#localOnly').checked = localStorage.getItem('vm_localonly') === '1';
$('#localOnly').onchange = (e) => {
  localStorage.setItem('vm_localonly', e.target.checked ? '1' : '0');
  hub?.restartAll();
  note(e.target.checked ? 'Local network only: on' : 'Local network only: off');
};
$('#directBtn').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    toast('Thanks. Reconnecting phones on the local network…');
    note('Microphone permission granted: this computer now shares its local address');
    hub?.restartAll();
    updateNetwork();
  } catch {
    toast('Without that permission, phones may connect through the router or internet instead of directly.', 6000);
  }
};
async function updateNetwork() {
  const cams = [...live.values()];
  const direct = cams.filter((l) => l.route === 'lan').length;
  const perm = await micPermission();
  $('#directBtn').hidden = perm === 'granted';
  $('#netState').textContent = cams.length
    ? `${direct} of ${cams.length} phone${cams.length > 1 ? 's' : ''} connected directly on the local network.${cams.some((l) => l.route === 'cellular') ? ' One or more is on mobile data.' : ''}`
    : 'No phones yet.';
}

// ---- live mixer ------------------------------------------------------------------------
// One strip per phone, like a broadcast mixer. Each has a level and a mode:
//   AFV  audio follows video: heard only while that camera is on air
//   ON   always in the mix (a microphone phone, or a camera near the speeches)
//   OFF  never in the mix
// So pictures and sound switch independently. Everything feeds the program bus
// (recorded with the program), through a limiter, with stereo meters.
// A channel is mono or stereo (its Mono switch): phones are mono to start with; this
// computer's sound, a shared screen, a stereo input and the Clips keep both sides. Balance
// pans a mono channel and balances a stereo one.

const mix = { strips: new Map(), bus: null, dest: null, listen: null, meterL: null, meterR: null };
const mixSaved = () => JSON.parse(localStorage.getItem('vm_livemix_' + eventId) || '{}');
const MODES = ['afv', 'on', 'off'];
const MODE_LABEL = { afv: 'AFV', on: 'ON', off: 'OFF' };
/** Whether a channel's source has two sides of its own (see mixAttach). */
function srcStereo(id) {
  if (id === 'media') return true;
  const l = live.get(id) || [...live.values()].find((x) => x.cid === id);
  return !!l?.stereo;
}
function mixDefault(role, id) {
  if (role === 'media') return { gain: 1, mode: 'afv', mono: false };
  const micHere = [...live.values()].some((l) => l.role === 'mic');
  return { gain: 1, mode: role === 'mic' ? 'on' : micHere ? 'off' : 'afv', mono: !srcStereo(id) };
}
function mixState(id, role = 'cam') {
  return { ...mixDefault(role, id), ...(mixSaved()[id] || {}) };
}
function mixSave(id, st) {
  const all = mixSaved();
  all[id] = { ...st, touched: true };
  localStorage.setItem('vm_livemix_' + eventId, JSON.stringify(all));
}

function stereoMeters(ctx, node) {
  // spread mono across both sides first (phones record mono), as speakers do
  const up = ctx.createGain();
  up.channelCount = 2;
  up.channelCountMode = 'explicit';
  up.channelInterpretation = 'speakers';
  const split = ctx.createChannelSplitter(2);
  const L = ctx.createAnalyser(), R = ctx.createAnalyser();
  L.fftSize = R.fftSize = 1024;
  node.connect(up);
  up.connect(split);
  split.connect(L, 0);
  split.connect(R, 1);
  return [L, R];
}

function mixInit() {
  if (mix.bus) return;
  const ctx = player.ctx;
  mix.bus = ctx.createGain();
  mix.dest = ctx.createMediaStreamDestination();
  mix.listen = ctx.createGain();
  mix.listen.gain.value = 0;
  const lim = limiter(ctx);
  mix.ftb = ctx.createGain(); // fade to black, for the sound
  mix.ftb.gain.value = 1 - blackLevel();
  mix.bus.connect(mix.ftb);
  mix.ftb.connect(lim);
  lim.connect(mix.dest);
  lim.connect(mix.listen).connect(ctx.destination);
  [mix.meterL, mix.meterR] = stereoMeters(ctx, lim);
  mix.spec = ctx.createAnalyser(); // for the audio console's spectrum
  mix.spec.fftSize = 4096;
  mix.spec.smoothingTimeConstant = 0.75;
  lim.connect(mix.spec);
  // one strip for clips played from the Clips panel
  mix.media = { ...liveChain(ctx, false), open: false };
  applyStripFx(mix.media, mixState('media', 'media'));
}

/** A live channel: input (one side or two: the Mono switch) → EQ → fader → meter; fader → balance → L/R meters, gate (AFV / ON / OFF) → program bus. */
function liveChain(ctx, mono = true) {
  const input = ctx.createGain();
  input.channelCountMode = 'explicit';
  input.channelInterpretation = 'speakers';
  const eq = eqChain(ctx), fader = ctx.createGain(), meter = ctx.createAnalyser(), bal = balance(ctx), gate = ctx.createGain();
  meter.fftSize = 1024;
  gate.gain.value = 0;
  input.connect(eq.input);
  eq.output.connect(fader);
  fader.connect(meter);
  fader.connect(bal.input);
  bal.output.connect(gate);
  gate.connect(mix.bus);
  const nodes = {
    mono: input, eq, fader, meter, bal, gate, meters: stereoMeters(ctx, bal.output),
    /** Both sides as one (folded to the middle, then placed by the balance), or each side its own. */
    setMono(on) {
      input.channelCount = on ? 1 : 2;
    },
  };
  nodes.setMono(mono);
  return nodes;
}
function applyStripFx(nodes, st, smooth = false) {
  if (!nodes) return;
  if (smooth) nodes.fader.gain.setTargetAtTime(st.gain ?? 1, player.ctx.currentTime, 0.02);
  else nodes.fader.gain.value = st.gain ?? 1;
  nodes.eq.set(st.eq, smooth);
  nodes.bal.set(st.pan || 0, smooth);
  nodes.setMono(st.mono !== false);
}
const stripNodes = (r) => (r.id === 'media' ? mix.media : mix.strips.get(r.peer));
/** A live channel's Mono switch. */
function toggleStripMono(r) {
  const st = { ...mixState(r.id, r.role), mono: !r.st.mono };
  mixSave(r.id, st);
  applyStripFx(stripNodes(r), st);
  renderMixer();
  announce(`${r.name}: ${st.mono ? 'mono' : 'stereo'}`);
}

function mixAttach(peer) {
  mixInit();
  const l = live.get(peer);
  // The mixer listens to the phone's sound track itself (not the stream it came in), so a
  // sound track that arrives after the picture, or is replaced, is always the one heard.
  const at = l?.stream?.getAudioTracks().find((t) => t.readyState === 'live');
  if (!at) {
    const st0 = mix.strips.get(peer);
    if (st0?.src) {
      try { st0.src.disconnect(); } catch {}
      st0.src = null;
      st0.trackId = null;
    }
    return;
  }
  const ctx = player.ctx;
  let st = mix.strips.get(peer);
  if (!st) {
    st = { peer, ...liveChain(ctx), fix: channelFixer(ctx), src: null, pre: ctx.createAnalyser() };
    st.pre.fftSize = 512;
    st.fix.output.connect(st.mono); // a phone that only fills the left side still counts at full level
    mix.strips.set(peer, st);
  }
  if (st.trackId !== at.id || !st.src) {
    try { st.src?.disconnect(); } catch {}
    // Two sides of its own: this computer's sound or a shared screen, or an input of this
    // computer that opened in stereo. A phone's sound starts mono (Mono off makes it stereo).
    l.stereo = !!l.local && (!!l.screen || (at.getSettings?.().channelCount || 1) > 1);
    const only = new MediaStream([at]);
    st.src = ctx.createMediaStreamSource(only);
    st.src.connect(st.fix.input);
    st.src.connect(st.pre);
    st.fix.reset(!!l.screen); // a stereo input of this computer may still be one mic on the left: the fix finds out
    st.trackId = at.id;
    st.stream = l.stream;
    st.silentSince = 0;
    // Chrome only hands a phone's sound to the mixer while a media element is playing that
    // stream. Cameras had their video tile; a microphone had nothing, so on its own it was
    // silent until a camera joined. Every stream gets a muted player of its own.
    st.sink ||= Object.assign(new Audio(), { muted: true, autoplay: true });
    st.sink.srcObject = only;
    st.sink.play().catch(() => {});
  }
  const id = l.cid || peer;
  applyStripFx(st, mixState(id, l.role));
  // A microphone phone just arrived: cameras nobody has set yet go quiet.
  if (l.role === 'mic') {
    let quieted = 0;
    for (const [p2, l2] of live) {
      if (l2.role === 'mic' || !l2.cid || mixSaved()[l2.cid]?.touched) continue;
      if (mixState(l2.cid, 'cam').mode !== 'off') quieted++;
    }
    if (quieted) toast('A microphone joined: camera sound is off. Turn any camera to AFV or ON in the mixer.', 5000);
  }
  mixGates();
}

function mixDetach(peer) {
  const st = mix.strips.get(peer);
  if (st) {
    try { st.src?.disconnect(); st.gate.disconnect(); } catch {}
    st.fix?.dispose();
    if (st.sink) st.sink.srcObject = null;
    mix.strips.delete(peer);
  }
}

/** Open or close each strip's gate from its mode and what's on air. */
function mixGates() {
  if (!mix.bus) return;
  const now = player.ctx.currentTime;
  for (const [peer, st] of mix.strips) {
    const l = live.get(peer);
    if (!l) continue;
    const { mode } = mixState(l.cid || peer, l.role);
    // AFV follows the picture, through a dissolve too: out goes down as in comes up
    const tr = swActive();
    // (through a dissolve out of the break, the incoming camera's sound comes up with its picture)
    const brk = onBreak() && !(tr && sw.fromSpecial === 'break');
    let afv = 0;
    if (mode === 'afv' && !brk) {
      if (tr && peer === sw.to) afv = sw.p;
      else if (peer === liveActive && !mediaOn && !(tr && sw.fromSpecial === 'break')) afv = tr ? 1 - sw.p : 1;
    }
    const level = mode === 'on' ? 1 : afv;
    const open = level > 0.001;
    st.open = open;
    st.gate.gain.setTargetAtTime(level, now, 0.015);
  }
  if (mix.media) {
    const { mode } = mixState('media', 'media');
    mix.media.open = mode === 'on' || (mode === 'afv' && (!!mediaOn || !!sw.toClip) && !onBreak());
    mix.media.gate.gain.setTargetAtTime(mix.media.open ? 1 : 0, now, 0.015);
  }
  renderBusAudio();
}
const mixFollowCut = mixGates;

function setStripMode(id, role, mode) {
  const st = { ...mixState(id, role), mode };
  mixSave(id, st);
  mixGates();
  renderMixer();
}

/** Shift + number: step that camera's sound through AFV → ON → OFF (a "breakaway"). */
function cycleCameraAudio(n) {
  const cid = angleCids[n - 1];
  const peer = [...live.keys()].find((p) => live.get(p).cid === cid);
  if (!peer) return toast(`Camera ${n} isn't connected`);
  const l = live.get(peer);
  const cur = mixState(cid, l.role).mode;
  const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
  setStripMode(cid, l.role, next);
  announce(`Camera ${n} sound ${MODE_LABEL[next]}`);
  note(`Camera ${n} (${l.name}) sound: ${MODE_LABEL[next]}`);
}

$('#listen').onchange = (e) => {
  mixInit();
  mix.listen.gain.setTargetAtTime(e.target.checked ? 1 : 0, player.ctx.currentTime, 0.02);
  player.ctx.resume();
};

// ---- mixer UI: horizontal strips in the inspector, vertical meter bridge in full screen ----

function mixerRows() {
  const rows = [];
  if (mode === 'live') {
    mixInit();
    const order = [...micPeers(), ...camOrder()];
    for (const peer of order) {
      const l = live.get(peer);
      const st = mix.strips.get(peer);
      if (!st) continue;
      const id = l.cid || peer;
      const n = l.role === 'mic' ? null : angleOfCid(l.cid);
      rows.push({ id, peer, role: l.role, name: l.role === 'mic' ? `Mic · ${l.name}` : `${n} ${l.name}`, meter: () => st.meter, meters: () => st.meters, st: mixState(id, l.role), live: true, open: () => st.open });
    }
    if (reel.some((r) => r.type.startsWith('video/'))) rows.push({ id: 'media', role: 'media', name: 'Clips', meter: () => mix.media.meter, meters: () => mix.media.meters, st: mixState('media', 'media'), live: true, open: () => mix.media?.open });
    rows.push({ id: 'master', name: 'Program', meters: () => [mix.meterL, mix.meterR], master: true });
  } else {
    for (const tr of seq.tracks.filter((t) => t.kind === 'audio')) {
      rows.push({ id: tr.id, name: tr.name, meter: () => player.buses.get(tr.id)?.meter, st: { gain: tr.gain ?? 1, muted: !!tr.muted, mono: tr.mono !== false, eq: tr.eq, pan: tr.pan || 0 }, track: tr });
    }
    if (!player.meterLR) player.meterLR = stereoMeters(player.ctx, player.limit);
    rows.push({ id: 'master', name: 'Master', meters: () => player.meterLR, master: true });
  }
  return rows;
}

let mixSig = '';
const fmtPan = (p) => (Math.abs(p) < 0.005 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100));
/** A live channel in stereo shows both sides (its meters are after the balance). */
const twoSides = (r) => r.master || (r.live && !r.st.mono);
function renderMixer() {
  mixRows = mixerRows();
  const sig = mode + '|' + mixRows.map((r) => `${r.id}:${r.name}:${r.master ? 'm' : r.live ? 'l' : 't'}${twoSides(r) ? '2' : ''}`).join('|');
  if (sig === mixSig && $('#mixer').childElementCount) {
    // Same sources as before: update the strips in place, so a click never lands on a strip that's being replaced.
    for (const r of mixRows) {
      if (r.master) continue;
      document.querySelectorAll(`[data-strip="${CSS.escape(r.id)}"]`).forEach((el) => {
        el.querySelectorAll('[data-amode]').forEach((b) => b.setAttribute('aria-pressed', String(r.st.mode === b.dataset.amode)));
        el.querySelector('[data-mute]')?.setAttribute('aria-pressed', String(!!r.st.muted));
        el.querySelector('[data-mono]')?.setAttribute('aria-pressed', String(!!r.st.mono));
        el.querySelector('[data-duck]')?.setAttribute('aria-pressed', String(!!r.track?.duck));
        const range = el.querySelector('input[type=range]:not([data-pan])');
        if (range && document.activeElement !== range) range.value = String(gainToDb(r.st.gain));
        const pan = el.querySelector('input[data-pan]');
        if (pan && document.activeElement !== pan) pan.value = String(Math.round((r.st.pan || 0) * 100));
        const po = el.querySelector('.pano');
        if (po) po.textContent = fmtPan(r.st.pan || 0);
        const out = el.querySelector('.db');
        if (out) out.textContent = `${gainToDb(r.st.gain)} dB`;
        if (r.live) el.classList.toggle('open', !!r.open?.());
      });
    }
    renderBusAudio();
    consoleSync();
    fitDock();
    return;
  }
  mixSig = sig;
  const modeBtns = (r) => MODES.map((m) => `<button type="button" data-amode="${m}" aria-pressed="${r.st.mode === m}" title="${{ afv: 'Audio follows video: heard only while on air', on: 'Always in the mix', off: 'Never in the mix' }[m]}">${MODE_LABEL[m]}</button>`).join('');
  const monoBtn = (r, label = 'Mono') => `<button type="button" data-mono aria-pressed="${!!r.st.mono}" title="Play both channels as one (off: stereo)" aria-label="${esc(r.name)}: mono">${label}</button>`;
  const panIn = (r, cls = '') => `<input type="range" data-pan${cls ? ` class="${cls}"` : ''} min="-100" max="100" step="1" value="${Math.round((r.st.pan || 0) * 100)}" title="Balance (double-click: centre)" aria-label="${esc(r.name)} balance">`;
  // inspector: horizontal strips
  $('#mixer').innerHTML = mixRows.map((r) => `<div class="strip${r.master ? ' master' : ''}" data-strip="${esc(r.id)}">
      <span class="nm">${esc(r.name)}</span>
      ${r.master ? '<span></span>' : `<span class="btns">${r.live ? modeBtns(r) + monoBtn(r) : `${r.track?.follow ? `<button type="button" data-duck aria-pressed="${!!r.track.duck}" title="Quiet while a microphone recording plays, on everywhere else">Duck</button>` : ''}${monoBtn(r)}<button type="button" data-mute aria-pressed="${r.st.muted}" aria-label="Mute ${esc(r.name)}">Mute</button>`}</span>`}
      ${(twoSides(r) ? [0, 1] : [0]).map((c) => `<span class="lvl" aria-hidden="true"><i data-ch="${c}"></i></span>`).join('')}
      ${r.master ? '' : `<input type="range" min="-60" max="12" step="1" value="${gainToDb(r.st.gain)}" aria-label="${esc(r.name)} level in decibels"><output class="db">${gainToDb(r.st.gain)} dB</output>
      ${panIn(r)}<output class="db pano">${fmtPan(r.st.pan || 0)}</output>`}
    </div>`).join('');
  // full screen: vertical meter bridge
  const scale = [0, -6, -12, -18, -24, -36, -48].map((db) => `<span style="--p:${((db + 60) / 60) * 100}%">${db}</span>`).join('');
  $('#bridge').innerHTML = mixRows.map((r) => `<div class="vstrip${r.master ? ' master' : ''}${r.live && r.open?.() ? ' open' : ''}" data-strip="${esc(r.id)}">
      <div class="vname" title="${esc(r.name)}">${esc(r.name)}</div>
      <div class="vmeters">
        <div class="vscale" aria-hidden="true">${scale}</div>
        ${(twoSides(r) ? [0, 1] : [0]).map((c) => `<div class="vmeter" aria-hidden="true"><i class="fill" data-ch="${c}"></i><i class="peak" data-ch="${c}"></i><span class="clip" data-ch="${c}"></span></div>`).join('')}
        ${r.master ? '' : `<input type="range" class="vfader" min="-60" max="12" step="1" value="${gainToDb(r.st.gain)}" aria-label="${esc(r.name)} level in decibels">`}
      </div>
      <output class="db">${r.master ? 'L R' : gainToDb(r.st.gain) + ' dB'}</output>
      ${r.master ? '' : `<div class="vpan">${panIn(r, 'vpanr')}${monoBtn(r, 'MONO')}</div>`}
      ${r.master ? '' : `<div class="vbtns">${r.live ? modeBtns(r) : `<button type="button" data-mute aria-pressed="${r.st.muted}" aria-label="Mute ${esc(r.name)}">M</button>`}</div>`}
    </div>`).join('');
  renderBusAudio();
  consoleSync();
  fitDock();
}

// ---- the audio console: a pop-out window for mixing ----------------------------------------
// The same channels as the mixer (Live: each phone and the Clips; Edit: each audio track)
// with room to work: a high-pass and three-band EQ with its curve, balance, big meters, and
// the output's spectrum, waveform, stereo picture and phase. It's a window this page draws
// into, so every control drives the same sound engine (and the program recording), and
// closing it loses nothing. The studio's keys (1–9, B, X, T…) work from it too.
let conWin = null, conSig = '';
const conHolds = new Map();
const CONSOLE_CSS = `
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font-size:13px;overflow:hidden}
:root[data-theme="dark"] body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}
@media not all and (prefers-color-scheme: light){:root:not([data-theme]) body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--line);flex:none}
.logo{font-stretch:125%;font-weight:800}
.room{font-size:.68rem;font-weight:800;letter-spacing:.08em;padding:.15em .6em;border-radius:4px;background:var(--tally);color:#fff}
.room.edit{background:var(--text);color:var(--bg)}
.ev{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp{flex:1}.hint{color:var(--muted);font-size:.75rem}
.chk{display:inline-flex;gap:6px;align-items:center;font-size:.8rem;margin:0;font-weight:600}
main{flex:1;display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:0}
.strips{display:flex;gap:8px;padding:10px;overflow:auto;align-items:stretch}
.empty{color:var(--text-2);padding:20px;margin:0}
.ch{flex:0 0 158px;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px;min-height:420px;max-height:100%;box-sizing:border-box;overflow:hidden}
.ch.open{box-shadow:inset 0 0 0 2px var(--tally)}
.ch h3{margin:0;font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btns{display:flex;gap:3px}
button{font:inherit}
.btns button,.lbl button{flex:1;min-height:24px;padding:0 .3em;font-size:.64rem;font-weight:800;border-radius:4px}
button[aria-pressed="true"][data-amode="afv"]{background:#f2c037;color:#2b1d00}
button[aria-pressed="true"][data-amode="on"]{background:#2bd36b;color:#002910}
button[aria-pressed="true"][data-amode="off"],button[aria-pressed="true"][data-mute]{background:#ff3b30;color:#fff}
button[aria-pressed="true"][data-mono],button[aria-pressed="true"][data-hp]{background:var(--preview);color:#fff}
.lbl{font-size:.6rem;font-weight:800;letter-spacing:.08em;color:var(--text-2);display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px}
.lbl button{flex:none}
.eq canvas{display:block;width:100%;height:52px;background:#000;border-radius:4px}
.k{display:grid;grid-template-columns:30px minmax(0,1fr) 38px;gap:4px;align-items:center;font-size:.62rem;font-weight:800;color:var(--text-2);margin:0}
.k input{width:100%;margin:0;min-height:0;padding:0}
.k output{font-family:var(--mono);text-align:right;color:var(--text);font-weight:600}
.fd{flex:1 1 0;display:grid;grid-template-columns:minmax(0,1fr) 26px;grid-template-rows:minmax(0,1fr);gap:6px;min-height:150px}
.fd canvas{width:100%;height:100%;min-height:0;background:#000;border-radius:4px;display:block;contain:size}
.fd input{writing-mode:vertical-lr;direction:rtl;width:26px;height:100%;margin:0;min-height:0;padding:0}
.db{font-family:var(--mono);font-size:.74rem;text-align:center}
.out{border-left:1px solid var(--line);background:var(--surface);display:grid;grid-template-rows:auto 150px minmax(0,1fr) minmax(0,1fr) 180px;gap:8px;padding:10px;min-height:0}
.out h2{margin:0;font-size:.72rem;letter-spacing:.09em;text-transform:uppercase;color:var(--text-2)}
.lr{display:grid;grid-template-columns:64px 1fr;grid-template-rows:minmax(0,1fr);gap:10px;min-height:0}
.lr canvas{width:100%;height:100%;min-height:0;background:#000;border-radius:4px;display:block;contain:size}
.read{display:grid;grid-template-columns:1fr 1fr;gap:6px;align-content:start}
.read div{background:var(--surface-2);border-radius:6px;padding:6px 8px;display:grid}
.read span{font-size:.6rem;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.read b{font-family:var(--mono);font-size:1rem}
.vis{position:relative;background:#000;border-radius:6px;min-height:0;overflow:hidden}
.vis span{position:absolute;left:8px;top:6px;font-size:.6rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#8b8e97;z-index:1;pointer-events:none}
.vis canvas{display:block;width:100%;height:100%;contain:size}
`;
const consoleHtml = (theme) => `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8">
<title>Audio console · ${esc(ev?.title || 'VUEMesh')}</title>
<link rel="stylesheet" href="${location.origin}/css/vm.css"><style>${CONSOLE_CSS}</style></head>
<body><header><b class="logo">Audio console</b><span class="room" id="room"></span><span class="ev">${esc(ev?.title || '')}</span><span class="sp"></span>
<label class="chk" id="cListenRow"><input type="checkbox" id="cListen"> Listen on this computer</label><span class="hint">Double-click a control to reset it</span></header>
<main><section class="strips" id="strips" aria-label="Channels"></section>
<aside class="out" aria-label="Output"><h2 id="outName">Program</h2>
<div class="lr"><canvas id="cMeters" aria-hidden="true"></canvas><div class="read"><div><span>Peak</span><b id="rPeak">−∞</b></div><div><span>Level (RMS)</span><b id="rRms">−∞</b></div><div><span>Balance</span><b id="rBal">C</b></div><div><span>Phase</span><b id="rCorr">–</b></div></div></div>
<div class="vis"><span>Spectrum</span><canvas id="cSpec" aria-hidden="true"></canvas></div>
<div class="vis"><span>Waveform · L green, R amber</span><canvas id="cScope" aria-hidden="true"></canvas></div>
<div class="vis"><span>Stereo</span><canvas id="cVec" aria-hidden="true"></canvas></div>
</aside></main></body></html>`;

function openConsole() {
  if (conWin && !conWin.closed) return conWin.focus();
  const w = window.open('', 'vuemesh-console-' + eventId, 'popup,width=1240,height=780');
  if (!w) return toast('The browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  conWin = w;
  conSig = '';
  w.document.open();
  w.document.write(consoleHtml(document.documentElement.dataset.theme || ''));
  w.document.close();
  bindConsole(w);
  renderMixer();
  w.requestAnimationFrame(() => consoleFrame(w));
  note('Audio console opened');
}
window.addEventListener('pagehide', () => conWin?.close());

// ------------------------------------------------- sources on this computer ---
// The studio computer's own cameras (the built-in FaceTime camera, USB cameras, capture
// cards) and microphones are sources like any phone: a tile with a number, on air or in
// preview, Camera control (through the camera's own controls, where it has them), the
// mixer, and recordings that land in Edit. They need no beacon: they run on the studio's
// own clock, so they're in sync from the start. A camera records while it's on air (with
// "Cameras record while they're on air"), or from its menu until you stop it; a microphone
// records the whole time it's in the show. Recordings roll every 5 minutes so nothing big
// waits in memory. The ones you add come back next time this studio opens.
const LOCAL_KEY = 'vm_local_sources';
const hashStr = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
};
const cleanLabel = (s) => String(s || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').replace(/^Default - /, '').trim();
function saveLocalList() {
  const list = [...live].filter(([, l]) => l.local && !l.screen).map(([, l]) => ({ kind: l.role, deviceId: l.deviceId, label: l.deviceLabel, name: l.name, micId: l.micId || null, micLabel: l.micLabel || null, sound: l.role === 'cam' ? !!l.micId : undefined }));
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}
// A camera on this computer brings its sound, as a phone does: the microphone in the same
// device (a USB webcam's own mic, which the browser groups with it), else one whose name
// matches, else the computer's own microphone (a built-in camera like the FaceTime camera has
// no mic of its own). The picker shows which, and it can be changed or turned off.
const MIC_OPTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
function soundFor(cam, devs) {
  const mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
  const real = mics.filter((d) => d.deviceId !== 'default');
  const words = (s) => cleanLabel(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['camera', 'microphone', 'audio', 'video', 'webcam', 'usb', 'default'].includes(w));
  const camWords = words(cam.label);
  return (
    real.find((m) => cam.groupId && m.groupId === cam.groupId) ||
    real.find((m) => camWords.length && words(m.label).some((w) => camWords.includes(w))) ||
    mics.find((m) => m.deviceId === 'default') ||
    real.find((m) => /built-?in|internal|macbook/i.test(m.label)) ||
    real[0] ||
    null
  );
}
async function addLocalSource(kind, deviceId, name, quiet, micId) {
  if (kind === 'cam' && micId === undefined) {
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const cam = devs.find((d) => d.deviceId === deviceId);
    micId = cam ? soundFor(cam, devs)?.deviceId || null : null;
  }
  const constraints = kind === 'mic'
    ? { audio: { deviceId: { exact: deviceId }, ...MIC_OPTS } }
    : { video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, ...(micId ? { audio: { deviceId: { exact: micId }, ...MIC_OPTS } } : {}) };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    if (kind !== 'cam' || !micId) throw e;
    // the camera without its sound, rather than not at all (the mic may be busy or gone)
    stream = await navigator.mediaDevices.getUserMedia({ video: constraints.video });
    toast(`Added without sound: its microphone isn't available (${e.message})`, 6000);
    micId = null;
  }
  return registerLocal(kind, stream, { deviceId, name, quiet, micId });
}
/** A source on this computer, from a stream already open (a camera, a microphone, a shared screen or the computer's sound). */
function registerLocal(kind, stream, { deviceId, name, quiet, micId, screen, label: given } = {}) {
  const track = kind === 'mic' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
  const label = given || cleanLabel(track.label) || (kind === 'mic' ? 'Microphone' : 'Camera');
  const peer = `local-${kind}-${hashStr(deviceId)}`;
  if (live.has(peer)) {
    stream.getTracks().forEach((t) => t.stop());
    return quiet ? null : toast(`${label} is already in the show`);
  }
  // its identity comes from the device itself, not its name: three of the same webcam are three
  // cameras (named Logitech BRIO, Logitech BRIO 2, Logitech BRIO 3)
  const cid = 'L' + hashStr(`${kind}:${deviceId}`).slice(0, 10);
  if (!name) {
    const same = [...live.values()].filter((x) => x.local && x.deviceLabel === label).length;
    if (same) name = `${label} ${same + 1}`;
  }
  const micTrack = kind === 'cam' ? stream.getAudioTracks()[0] : null;
  live.set(peer, { stream, role: kind, name: name || label, cid, local: true, screen: !!screen, deviceId, deviceLabel: label, micId: micTrack ? micId : null, micLabel: micTrack ? cleanLabel(micTrack.label) : null, route: 'local', fixed: true, joinedAt: Date.now() });
  if (kind !== 'mic') noteAngle(cid);
  track.addEventListener('ended', () => removeLocalSource(peer, 'unplugged'));
  mixAttach(peer);
  if (kind === 'cam') localCamState(peer);
  renderLive();
  renderMixer();
  saveLocalList();
  if (kind === 'mic') !KIOSK && startLocalRec(peer);
  else localRecFollow();
  note(`${label} added from this computer${micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : kind === 'cam' ? ', without sound' : ''}`);
  if (!quiet) toast(`${live.get(peer).name} is in the show${kind === 'mic' ? ' (recording)' : micTrack ? `, with sound from ${cleanLabel(micTrack.label)}` : ''}`);
  return peer;
}
function removeLocalSource(peer, why) {
  const l = live.get(peer);
  if (!l?.local) return;
  stopLocalRec(peer, true);
  l.stream.getTracks().forEach((t) => t.stop());
  if (hub?.onLiveEnd) hub.onLiveEnd(peer, why || 'removed');
  else live.delete(peer);
  saveLocalList();
  renderLive();
  renderMixer();
}
function renameLocal(peer) {
  const l = live.get(peer);
  const name = l && prompt('Name for this source', l.name);
  if (!name?.trim()) return;
  l.name = name.trim().slice(0, 40);
  saveLocalList();
  renderLive();
  renderMixer();
  ccuSync();
}
// ---- recording: on the studio's clock, rolling every 5 minutes
// A camera's recording with its sound: WebM with Opus first (the steadiest way a browser
// records a live microphone; it plays in Edit and exports the same), then the studio's other
// formats. A format that comes out without the sound isn't used again this session.
const LOCAL_VIDEO_MIMES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm', ...REC_MIMES];
const localMimeNoSound = new Set();
function localVideoMime(l) {
  const sound = l.stream.getAudioTracks().length > 0;
  return LOCAL_VIDEO_MIMES.find((m) => MediaRecorder.isTypeSupported(m) && !(sound && localMimeNoSound.has(m))) || recMime();
}
/** Does a recording have sound in it? (null: can't tell) */
function fileHasSound(blob) {
  return new Promise((res) => {
    const v = document.createElement('video'), url = URL.createObjectURL(blob);
    const done = (x) => {
      URL.revokeObjectURL(url);
      v.removeAttribute('src');
      res(x);
    };
    v.muted = true;
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      const s = v.captureStream?.();
      if (!s) return done(null);
      setTimeout(() => done(s.getAudioTracks().length > 0), 60);
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    v.src = url;
  });
}
function startLocalRec(peer) {
  const l = live.get(peer);
  if (!l?.local || l.recorder) return;
  const kind = l.role === 'mic' ? 'audio' : 'video';
  const mime = kind === 'audio' ? ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) : localVideoMime(l);
  const one = () => {
    const rec = new MediaRecorder(new MediaStream(kind === 'audio' ? l.stream.getAudioTracks() : [...l.stream.getVideoTracks(), ...l.stream.getAudioTracks()]), { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    const chunks = [], t0 = now(), began = performance.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: mime });
      if (!blob.size) return;
      const s = l.stream.getVideoTracks()[0]?.getSettings?.() || {};
      const w = s.width || 0, h = s.height || 0;
      const meta = {
        id: `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind, mime: blob.type || mime, cid: l.cid, name: l.name,
        t0, t0Source: 'studio', dur: Math.round(performance.now() - began), w, h, local: true,
        ...(kind === 'video' ? { native: true, audio: (l.stream.getAudioTracks()[0]?.getSettings?.().channelCount || 1) > 1 ? 'stereo' : 'mono', orient: [{ t: 0, rot: 0, rect: null, upright: w >= h ? 'landscape' : 'portrait', ev: 0, ct: 0 }] } : {}),
      };
      const rec2 = { eventId, ...meta, receivedAt: Date.now() };
      await idb.put('clips', { ...rec2, blob }).catch((e) => note(`Couldn't keep ${l.name}'s recording: ${e.message}`));
      addClip(rec2, blob, true);
      // the camera had sound: is it in the file? (if a format drops it, the next ones use another)
      if (kind === 'video' && hadSound) {
        const has = await fileHasSound(blob);
        // kept with the recording, so the Edit window (and later visits) know without checking again
        if (has !== null) {
          await idb.patch('clips', eventId, meta.id, { sound: has }).catch(() => {});
          const c = clips.find((x) => x.id === meta.id);
          if (c) c.sound = has;
        }
        if (has === false) {
          localMimeNoSound.add(mime);
          note(`${l.name}'s recording came out without sound in ${mime}: the next ones use ${localVideoMime(l)}`);
          toast(`${l.name}'s last recording has no sound (the browser's ${mime.split(';')[0]} recorder dropped it). The next ones record differently.`, 7000);
        } else if (has) note(`${l.name}'s recording has its sound (${mime.split(';')[0]})`);
      }
    };
    const hadSound = kind === 'video' && l.stream.getAudioTracks().some((t) => t.readyState === 'live');
    rec.start(1000);
    return rec;
  };
  l.recorder = one();
  l.nextRecorder = one;
  l.rec = true;
  l.recRoll = setInterval(() => {
    const old = l.recorder;
    l.recorder = one();
    setTimeout(() => old.state !== 'inactive' && old.stop(), 400); // (a short overlap: nothing lost at the seam)
  }, 5 * 60000);
  renderLive();
  note(`Recording ${l.name} (this computer)`);
}
function rollLocalRec(peer) {
  const l = live.get(peer);
  if (!l?.recorder || !l.nextRecorder) return false;
  if (l.role !== 'mic' && !localShouldRec(peer, l)) {
    stopLocalRec(peer); // (off air, at black: finish it, and don't start another)
    return true;
  }
  const old = l.recorder;
  l.recorder = l.nextRecorder();
  setTimeout(() => old.state !== 'inactive' && old.stop(), 400); // (a short overlap: nothing lost at the seam)
  return true;
}
function stopLocalRec(peer, now_) {
  const l = live.get(peer);
  if (!l?.recorder) return;
  clearInterval(l.recRoll);
  clearTimeout(l.offAirStop);
  const r = l.recorder;
  l.recorder = null;
  l.rec = false;
  if (r.state !== 'inactive') r.stop();
  renderLive();
}
function setLocalManualRec(peer, on) {
  const l = live.get(peer);
  if (!l) return;
  l.recManual = on;
  if (on) startLocalRec(peer);
  else localRecFollow();
}
// cameras on this computer record while they're on air (if that's on), plus 5 s after
/** Is this computer's camera on air (a dissolve's incoming one too)? Not at black, in a break, or under a clip. */
function localAired(peer) {
  return (peer === liveActive || (swActive() && peer === sw.to)) && !onBreak() && !mediaOn && !(black.target === 1 && black.cleared);
}
// Whether this computer's camera should be recording: whenever it's on air (anything aired
// makes Edit), or by hand. Not at a kiosk: a kiosk never edits, so it records no clips of its
// own (only the program, which goes back to the phones).
const localShouldRec = (peer, l) => !KIOSK && (l.recManual || (localAired(peer) && !!progRec && !progRec.stopping)); // (the phones' storage setting doesn't apply to this computer's cameras)
function localRecFollow() {
  for (const [peer, l] of live) {
    if (!l.local || l.role === 'mic') continue;
    const want = localShouldRec(peer, l);
    if (want) {
      clearTimeout(l.offAirStop);
      l.offAirStop = null;
      startLocalRec(peer);
    } else if (l.recorder && !l.offAirStop) l.offAirStop = setTimeout(() => {
      l.offAirStop = null;
      if (!localShouldRec(peer, l)) stopLocalRec(peer);
    }, 5000);
  }
}
// ---- Camera control for this computer's cameras: the camera's own settings, where it has them
function localCamState(peer) {
  const l = live.get(peer), t = l?.stream?.getVideoTracks()[0];
  if (!t) return;
  const c = t.getCapabilities?.() || {}, s = t.getSettings?.() || {};
  l.camDefaults ||= { zoom: s.zoom, brightness: s.brightness, contrast: s.contrast, exposureCompensation: s.exposureCompensation };
  l.cam = {
    t: 'camstate', local: true, remote: true,
    z: Math.round((s.zoom ?? 1) * 100) / 100, zmin: c.zoom?.min ?? 1, zmax: c.zoom?.max ?? 1, zn: !!c.zoom && c.zoom.max > c.zoom.min,
    ev: l.localEv ?? 0, evmin: -2, evmax: 2, evn: !!(c.exposureCompensation || c.brightness),
    ct: l.localCt ?? 1, ctn: !!c.contrast,
    focus: false, lock: false, canLock: false, wb: false, canWb: false, lenses: [], lens: null,
  };
  ccuSync();
}
async function localCtl(peer, m) {
  const l = live.get(peer), t = l?.stream?.getVideoTracks()[0];
  if (!t) return;
  const c = t.getCapabilities?.() || {}, d = l.camDefaults || {}, set = {};
  const span = (cap, mid, k) => Math.min(cap.max, Math.max(cap.min, mid + k * (cap.max - cap.min) / 4)); // ±2 → ±half the range
  if (m.zoom != null && c.zoom) set.zoom = Math.min(c.zoom.max, Math.max(c.zoom.min, +m.zoom));
  if (m.ev != null) {
    l.localEv = +m.ev;
    if (c.exposureCompensation) set.exposureCompensation = span(c.exposureCompensation, d.exposureCompensation ?? 0, l.localEv);
    else if (c.brightness) set.brightness = span(c.brightness, d.brightness ?? (c.brightness.min + c.brightness.max) / 2, l.localEv);
  }
  if (m.ct != null && c.contrast) {
    l.localCt = +m.ct;
    const mid = d.contrast ?? (c.contrast.min + c.contrast.max) / 2;
    set.contrast = Math.min(c.contrast.max, Math.max(c.contrast.min, mid + (l.localCt - 1) * (c.contrast.max - c.contrast.min) / 2.2));
  }
  if (m.auto) {
    Object.assign(l, { localEv: 0, localCt: 1 });
    for (const k of ['zoom', 'brightness', 'contrast', 'exposureCompensation']) if (c[k] && d[k] != null) set[k] = d[k];
  }
  if (Object.keys(set).length) {
    const want = snapToCamera(c, set);
    await t.applyConstraints({ advanced: [want] }).catch((e) => note(`${l.name}: ${e.message}`));
    // (some cameras ignore a setting quietly: say so, rather than seem to do nothing)
    const got = t.getSettings?.() || {};
    const missed = Object.keys(want).filter((k) => typeof want[k] === 'number' && typeof got[k] === 'number' && Math.abs(got[k] - want[k]) > (c[k]?.step || 0.01) * 1.5);
    if (missed.length) note(`${l.name} didn't take ${missed.map((k) => `${k} ${want[k]} (it's at ${got[k]})`).join(', ')}`);
  }
  localCamState(peer);
}
// ---- anything aired makes Edit ----
// Going to Edit (or ending Record program) finishes the recordings in progress, so what's
// been on air is there now: this computer's cameras and microphones roll to a new recording,
// and phones that are recording are asked to do the same (each keeps recording).
let lastFlush = 0;
function flushRecordings(why) {
  if (!isHost || Date.now() - lastFlush < 3000) return; // (not twice in a moment)
  lastFlush = Date.now();
  let n = 0;
  for (const [peer, l] of live) {
    if (l.local) n += rollLocalRec(peer) ? 1 : 0;
    else if (l.rec && l.role !== 'mic' && hub?.message(peer, { t: 'roll' })) n++;
  }
  if (n) note(`${why}: ${n} recording${n > 1 ? 's' : ''} in progress finished so ${n > 1 ? 'they reach' : 'it reaches'} Edit now (still recording)`);
}

// ---- a screen, a window, or this computer's sound ----
// Shared through the browser's own picker (it asks each time, so these aren't brought back
// next time). A screen or window is a source like a camera, with its sound if the browser
// shares it; "This computer's sound" keeps just the sound, as a microphone. Which sound the
// browser can share: Windows and ChromeOS, the whole computer's (pick Entire screen, tick
// Share system audio); Mac, a Chrome tab's (pick the tab, tick Share tab audio).
async function addScreenSource(soundOnly) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }, systemAudio: 'include', surfaceSwitching: 'include', selfBrowserSurface: 'exclude' });
  } catch (e) {
    if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(`Couldn't share: ${e.message}`, 6000);
    return null;
  }
  const n = Date.now().toString(36);
  if (soundOnly) {
    const a = stream.getAudioTracks()[0];
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!a) {
      toast(myOs === 'mac' ? 'No sound came with it. On a Mac, share a Chrome tab and tick Share tab audio.' : 'No sound came with it. Pick Entire screen and tick Share system audio (or a tab, with Share tab audio).', 8000);
      return null;
    }
    return registerLocal('mic', new MediaStream([a]), { deviceId: 'sound-' + n, screen: true, label: 'Computer sound' });
  }
  const v = stream.getVideoTracks()[0];
  const surface = v.getSettings?.().displaySurface;
  const label = surface === 'monitor' ? 'Screen' : surface === 'browser' ? 'Browser tab' : cleanLabel(v.label) || 'Window';
  return registerLocal('cam', stream, { deviceId: 'screen-' + n, screen: true, label: `${label}${stream.getAudioTracks().length ? '' : ''}` });
}
async function openLocalPicker() {
  const dlg = $('#localDlg');
  let devs = await navigator.mediaDevices.enumerateDevices();
  const named = devs.some((d) => d.label);
  const inShow = new Set([...live.values()].filter((l) => l.local).map((l) => l.deviceId));
  const cams = devs.filter((d) => d.kind === 'videoinput' && d.deviceId), mics = devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
  const sound = (d) => {
    const pick = soundFor(d, devs), pickId = pick?.deviceId === 'default' ? mics.find((m) => m.groupId === pick.groupId)?.deviceId || 'default' : pick?.deviceId;
    return `<label class="snd">Sound <select data-snd="${esc(d.deviceId)}" aria-label="Sound for ${esc(cleanLabel(d.label))}">${mics.map((m) => `<option value="${esc(m.deviceId)}" ${m.deviceId === pickId ? 'selected' : ''}>${esc(cleanLabel(m.label))}</option>`).join('')}${pickId === 'default' ? '<option value="default" selected>This computer\u2019s microphone</option>' : ''}<option value="" ${pick ? '' : 'selected'}>No sound</option></select></label>`;
  };
  const row = (d, kind) => `<li><span>${esc(cleanLabel(d.label) || (kind === 'mic' ? 'Microphone' : 'Camera'))}${kind === 'cam' && !inShow.has(d.deviceId) ? sound(d) : ''}</span>${inShow.has(d.deviceId) ? '<span class="fine">in the show</span>' : `<button type="button" data-add="${kind}" data-dev="${esc(d.deviceId)}">Add</button>`}</li>`;
  $('#localList').innerHTML = !named
    ? '<p>To list them, the browser needs your OK to use this computer\u2019s cameras and microphones.</p><button type="button" class="primary" id="localAllow">Allow cameras and microphones</button>'
    : `<h3>Cameras</h3><ul>${cams.map((d) => row(d, 'cam')).join('') || '<li class="fine">None found</li>'}</ul><h3>Microphones</h3><ul>${mics.map((d) => row(d, 'mic')).join('') || '<li class="fine">None found</li>'}</ul>`;
  $('#localList').insertAdjacentHTML('beforeend', `<h3>Screen and sound</h3><ul><li><span>A screen or window<small class="fine">with its sound, if the browser shares it</small></span><button type="button" data-share="screen">Share…</button></li><li><span>This computer\u2019s sound<small class="fine">${myOs === 'mac' ? 'on a Mac: a Chrome tab\u2019s sound (tick Share tab audio)' : 'pick Entire screen and tick Share system audio'}</small></span><button type="button" data-share="sound">Share…</button></li></ul>`);
  if (!dlg.open) dlg.showModal();
}
$('#addLocal').onclick = openLocalPicker;
$('#localList').addEventListener('click', async (e) => {
  const sh = e.target.closest('[data-share]');
  if (sh) {
    sh.disabled = true;
    const peer = await addScreenSource(sh.dataset.share === 'sound');
    sh.disabled = false;
    if (peer) {
      $('#localDlg').close();
      toast(`${live.get(peer)?.name} is in the show${live.get(peer)?.stream.getAudioTracks().length ? ', with its sound' : ''}`);
    }
    return;
  }
  if (e.target.id === 'localAllow') {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      return toast('The browser said no: allow the camera and microphone for this site in its settings (the icon left of the address)', 7000);
    }
    return openLocalPicker();
  }
  const b = e.target.closest('[data-add]');
  if (!b || b.disabled) return;
  $('#localList').querySelectorAll(`[data-dev="${CSS.escape(b.dataset.dev)}"]`).forEach((x) => (x.disabled = true)); // (one add at a time)
  const snd = b.dataset.add === 'cam' ? $('#localList').querySelector(`[data-snd="${CSS.escape(b.dataset.dev)}"]`)?.value ?? undefined : undefined;
  try {
    await addLocalSource(b.dataset.add, b.dataset.dev, undefined, false, snd === undefined ? undefined : snd || null);
  } catch (err) {
    toast(err.name === 'NotReadableError' ? 'That device is busy (another app may be using it)' : err.message, 6000);
  }
  openLocalPicker();
});
// the ones added before come back (when the browser still allows it)
setTimeout(async () => {
  const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  if (!saved.length || !isHost || EDIT_ONLY) return; // (the Edit page uses no cameras)
  const cam = await navigator.permissions?.query({ name: 'camera' }).then((p) => p.state).catch(() => null);
  const mic = await navigator.permissions?.query({ name: 'microphone' }).then((p) => p.state).catch(() => null);
  const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const taken = new Set(); // (by name, each saved one gets a different device: three of the same webcam stay three)
  for (const s of saved) {
    if ((s.kind === 'mic' ? mic : cam) !== 'granted') continue;
    // by its id, or (ids can change) by its name
    const same = devs.find((d) => d.deviceId === s.deviceId && !taken.has(d.deviceId)) || devs.find((d) => d.kind === (s.kind === 'mic' ? 'audioinput' : 'videoinput') && cleanLabel(d.label) === s.label && !taken.has(d.deviceId) && !saved.some((o) => o !== s && o.deviceId === d.deviceId));
    if (same) taken.add(same.deviceId);
    if (!same) {
      note(`${s.label || 'A source'} on this computer isn't plugged in now`);
      continue;
    }
    let micId;
    if (s.kind === 'cam' && s.sound === false) micId = null;
    else if (s.kind === 'cam' && (s.micId || s.micLabel)) micId = (devs.find((d) => d.deviceId === s.micId) || devs.find((d) => d.kind === 'audioinput' && cleanLabel(d.label) === s.micLabel))?.deviceId;
    await addLocalSource(s.kind, same.deviceId, s.name, true, micId).catch((e) => note(`${s.label || 'A source'} on this computer isn't available now: ${e.message}`));
  }
  if (saved.some((s) => (s.kind === 'mic' ? mic : cam) !== 'granted')) toast('This computer\u2019s cameras and microphones are off until you allow them: + This computer', 7000);
}, 1500);
window.addEventListener('pagehide', () => { for (const [peer, l] of live) if (l.local) stopLocalRec(peer); });

// --------------------------------------------------------------- moderation ---
// A camera or microphone that's misbehaving can be removed: the phone is told and leaves
// (it can rejoin). Or removed and blocked: it can't rejoin this event (the server turns it
// away), and its recordings stay out of the automatic edit (they're still in Media, marked
// Blocked, if you want a shot by hand). Blocked ones are listed in the Live inspector, where
// they can be let back in. (Blocking goes by the phone's identity for this event: someone
// who wipes their browser's data comes back as a new phone.)
const blockedCids = new Set(JSON.parse(localStorage.getItem('vm_blocked_' + eventId) || '[]'));
const isBlocked = (cid) => !!cid && blockedCids.has(cid);
function saveBlocked() {
  localStorage.setItem('vm_blocked_' + eventId, JSON.stringify([...blockedCids]));
  if (isHost) api(`events/${eventId}`, { method: 'PATCH', host: key, body: { blocked: [...blockedCids] } }).catch((e) => note(`Couldn't save the blocked list: ${e.message}`));
  renderBlocked();
  if (seq.auto && clips.length) {
    rebuild(false);
    player.setSequence(seq);
    renderTimeline();
  }
  renderMedia?.();
}
function askRemove(peer) {
  const l = live.get(peer);
  if (!l) return;
  $('#kickWho').textContent = l.name;
  const dlg = $('#kickDlg');
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue === 'remove') removeContributor(peer, false);
    else if (dlg.returnValue === 'block') removeContributor(peer, true);
  };
  dlg.showModal();
}
function removeContributor(peer, block) {
  const l = live.get(peer);
  if (!l) return;
  if (block && l.cid) {
    blockedCids.add(l.cid);
    blockedNames.set(l.cid, l.name);
    localStorage.setItem('vm_blocked_names_' + eventId, JSON.stringify([...blockedNames]));
    saveBlocked();
  }
  hub?.message(peer, { t: 'kick', block: !!block });
  hub?.send(peer, { t: 'kick', block: !!block });
  if (peer === liveActive) {
    liveActive = null;
    syncTally();
  }
  if (pvw === peer) setPreview(null);
  setTimeout(() => hub?.drop(peer, 'removed'), 1200);
  note(`${l.name} removed by the host${block ? ' and blocked from this event' : ''}`);
  toast(`${l.name} removed${block ? ' and blocked: they can\u2019t rejoin, and their clips are out of the automatic edit' : ' (they can rejoin)'}`, 5000);
}
const blockedNames = new Map(JSON.parse(localStorage.getItem('vm_blocked_names_' + eventId) || '[]'));
function renderBlocked() {
  const box = $('#blockedBox');
  if (!box) return;
  box.hidden = !blockedCids.size;
  $('#blockedList').innerHTML = [...blockedCids].map((cid) => `<li><span>${esc(blockedNames.get(cid) || clips.find((c) => c.cid === cid)?.name || 'A phone')}</span><button type="button" class="small" data-unblock="${esc(cid)}">Let back in</button></li>`).join('');
}
$('#blockedList')?.addEventListener('click', (e) => {
  const cid = e.target.closest('[data-unblock]')?.dataset.unblock;
  if (!cid) return;
  blockedCids.delete(cid);
  saveBlocked();
  toast(`${blockedNames.get(cid) || 'They'} can rejoin, and their clips are back in the automatic edit`);
});
setTimeout(renderBlocked, 500);

// ---------------------------------------------------------- camera control ----
// The control room's camera control (a broadcast "CCU"): its own window with every live
// camera's picture, a histogram and a waveform for each, and the camera's controls. Zoom
// (the phone glides there), brightness (the camera's own exposure where it has it, else
// digital), contrast (digital), focus (click a point in the picture, like tapping the phone),
// focus/exposure lock, white balance lock, and Auto to put it all back. The scopes are worked
// out here, from the pictures this studio already receives: nothing extra is asked of phones.
var ccuWin = null, ccuSig = '', ccuFocus = null; // (var: renderLive can run before this line)
const CCU_CSS = `
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;font-size:13px;overflow:hidden}
:root[data-theme="dark"] body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}
@media not all and (prefers-color-scheme: light){:root:not([data-theme]) body{--bg:#0f1013;--surface:#18191d;--surface-2:#222328;--surface-3:#2d2f35;--line:#2a2c32;--text:#ececef;--text-2:#a9acb4;--muted:#8b8e97;--field:#121316;color-scheme:dark;background:var(--bg);color:var(--text)}}
header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:var(--surface);border-bottom:1px solid var(--line);flex:none}
.logo{font-stretch:125%;font-weight:800}.sp{flex:1}.hint{color:var(--muted);font-size:.75rem}
main{flex:1;overflow:auto;padding:10px;display:grid;grid-template-columns:repeat(auto-fill,var(--cw,300px));gap:8px;align-content:start;justify-content:start}
.cw{display:flex;align-items:center;gap:6px;font-size:.72rem;color:var(--text-2)}.cw input{width:120px;accent-color:#f2c037}
.empty{grid-column:1/-1;color:var(--muted);padding:40px;text-align:center}
.cam{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;gap:6px;position:relative;align-content:start}
.cam.air{border-color:var(--tally);box-shadow:0 0 0 1px var(--tally)}
.cam h3{margin:0;font-size:.9rem;display:flex;gap:8px;align-items:center}
.cam h3 .n{background:var(--surface-3);border-radius:4px;padding:0 .45em;font-family:var(--mono)}
.cam h3 .tag{margin-left:auto;font-size:.62rem;letter-spacing:.08em;padding:.15em .5em;border-radius:4px;background:var(--surface-3);color:var(--text-2)}
.cam.air h3 .tag{background:var(--tally);color:#fff}
.pic{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;cursor:crosshair}
.pic canvas{width:100%;height:100%;display:block}
.pic .ret{position:absolute;width:54px;height:54px;margin:-27px 0 0 -27px;border:2px solid #f2c037;border-radius:6px;pointer-events:none;animation:ret 1.2s forwards}
@keyframes ret{0%{transform:scale(1.5);opacity:1}25%{transform:scale(1)}100%{opacity:0}}
.pic .clipwarn{position:absolute;left:6px;bottom:6px;font:700 .62rem var(--mono);background:#000a;color:#fff;padding:1px 5px;border-radius:3px}
.pic .pz{position:absolute;inset:0;display:grid;place-items:center;background:#000a;color:#fff;font-weight:800;letter-spacing:.12em;font-size:.9rem;pointer-events:none}
.scopes{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.scopes div{position:relative;background:#050608;border-radius:6px;overflow:hidden;height:72px}
.scopes canvas{width:100%;height:100%;display:block}
.scopes span{position:absolute;left:6px;top:3px;font-size:.6rem;letter-spacing:.08em;color:#8b8e97;pointer-events:none}
.k{display:grid;grid-template-columns:minmax(64px,auto) 1fr 44px;gap:6px;align-items:center;font-size:.64rem;font-weight:700;letter-spacing:.06em;color:var(--text-2)}
.msg{display:flex;gap:4px}.msg input{flex:1;min-width:0;font:inherit;font-size:.78rem;padding:5px 8px;border-radius:7px;border:1px solid var(--line);background:var(--field);color:var(--text)}.msg button{font:inherit;font-size:.7rem;font-weight:800;padding:0 .7em;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}.msg .st{font-size:.66rem;color:var(--muted);align-self:center}
.k input{width:100%;accent-color:#f2c037}.k output{font-family:var(--mono);text-align:right;color:var(--text)}
.k small{font-weight:600;letter-spacing:0;color:var(--muted)}
.btns{display:flex;gap:6px;flex-wrap:wrap}
.lenses{display:flex;gap:4px;flex-wrap:wrap}
.lenses button{font:inherit;font-size:.7rem;font-weight:800;min-height:28px;padding:0 .75em;border-radius:999px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}
.lenses button[aria-pressed="true"]{background:#fff;color:#111;border-color:#fff}
.btns button{font:inherit;font-size:.64rem;font-weight:800;letter-spacing:.04em;min-height:28px;padding:0 .6em;border-radius:7px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);cursor:pointer}
.btns button[aria-pressed="true"]{background:#f2c037;color:#111;border-color:#f2c037}
.btns button:disabled{opacity:.4;cursor:default}
.btns .cut{margin-left:auto;background:var(--tally);border-color:var(--tally);color:#fff}
.off{position:absolute;inset:0;background:#000b;display:grid;place-items:center;text-align:center;padding:20px;border-radius:12px;color:#fff;font-weight:600}
`;
const ccuHtml = (theme) => `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ''}><head><meta charset="utf-8">
<title>Camera control · ${esc(ev?.title || 'VUEMesh')}</title>
<link rel="stylesheet" href="${location.origin}/css/vm.css"><style>${CCU_CSS}</style></head>
<body><header><b class="logo">Camera control</b><span>${esc(ev?.title || '')}</span><label class="cw">Strip width <input type="range" id="cw" min="220" max="560" step="10" value="${+localStorage.getItem('vm_ccu_w') || 300}" aria-label="Width of each camera's strip"></label><span class="sp"></span>
<span class="hint">Click the picture to focus there · double-click a control to reset it · histogram: R G B and brightness · waveform: brightness across the picture</span></header>
<main id="cams" aria-label="Cameras"></main></body></html>`;

function openCcu(focusPeer) {
  ccuFocus = focusPeer || null;
  if (ccuWin && !ccuWin.closed) {
    ccuWin.focus();
    ccuSig = '';
    return ccuSync();
  }
  const w = window.open('', 'vuemesh-ccu-' + eventId, 'popup,width=1280,height=860');
  if (!w) return toast('The browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  ccuWin = w;
  ccuSig = '';
  w.document.open();
  w.document.write(ccuHtml(document.documentElement.dataset.theme || ''));
  w.document.close();
  bindCcu(w);
  ccuSync();
  w.requestAnimationFrame((t) => ccuFrame(w, t));
  note('Camera control opened');
}
window.addEventListener('pagehide', () => ccuWin?.close());

const ccuCams = () => camOrder().filter((p) => live.get(p)?.video);
const fmtEv = (v) => (v > 0 ? '+' : '') + (+v).toFixed(1);
function ccuCard(peer) {
  const l = live.get(peer), c = l.cam, n = angleOfCid(l.cid) || '';
  const k = (key, label, v, min, max, step, shown, how, off) => `<label class="k"><span>${label}<br><small>${how}</small></span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}" ${c && !off ? '' : 'disabled'} aria-label="${esc(l.name)}: ${label}"><output data-o="${key}">${shown}</output></label>`;
  return `<section class="cam${peer === liveActive ? ' air' : ''}" data-peer="${esc(peer)}" aria-label="${esc(l.name)}">
    <h3><span class="n">${n}</span>${esc(l.name)}<span class="tag">${peer === liveActive ? 'ON AIR' : 'READY'}</span></h3>
    <div class="pic" data-pic title="Click to focus there"><canvas data-v aria-label="${esc(l.name)}'s picture: click to focus there"></canvas></div>
    <div class="scopes"><div><span>HISTOGRAM</span><canvas data-h aria-hidden="true"></canvas></div><div><span>WAVEFORM</span><canvas data-w aria-hidden="true"></canvas></div></div>
    ${c?.lenses?.length > 1 ? `<div class="lenses" role="group" aria-label="${esc(l.name)}: camera">${c.lenses.map((x) => `<button type="button" data-lens="${esc(x.id)}" aria-pressed="${x.id === c.lens}">${esc(x.label)}</button>`).join('')}</div>` : ''}
    ${c ? `${k('z', 'ZOOM', c.z, c.zmin, c.zmax, 0.01, c.z.toFixed(1) + '×', c.zn ? 'lens' : c.local ? 'not on this camera' : 'digital', c.local && !c.zn)}
    ${k('ev', 'BRIGHTNESS', c.ev, c.evmin, c.evmax, 0.1, fmtEv(c.ev), c.evn ? (c.local ? 'camera' : 'exposure') : c.local ? 'not on this camera' : 'digital', c.local && !c.evn)}
    ${k('ct', 'CONTRAST', c.ct, 0.5, 1.6, 0.01, c.ct.toFixed(2), c.local ? (c.ctn ? 'camera' : 'not on this camera') : 'digital', c.local && !c.ctn)}
    <div class="btns"><button type="button" data-act="lock" aria-pressed="${c.lock}" ${c.canLock ? '' : 'disabled title="This camera can&#39;t lock from a browser"'}>AE/AF LOCK</button><button type="button" data-act="wb" aria-pressed="${c.wb}" ${c.canWb ? '' : 'disabled title="This camera can&#39;t lock white balance from a browser"'}>WB LOCK</button><button type="button" data-act="auto">AUTO</button><button type="button" class="cut" data-act="cut">CUT ${n}</button></div>
    ${l.local ? '<p class="hint" style="margin:0">A camera on this computer: on the studio\u2019s own clock, no beacon needed.</p>' : `<form class="msg" data-msg><input type="text" maxlength="140" placeholder="Message ${esc(l.name)}…" aria-label="Message ${esc(l.name)}"><button type="submit">Send</button></form>`}
    ${c.remote ? '' : `<div class="off">${esc(l.name)} has turned off remote control in the camera's settings.</div>`}`
    : '<p class="hint" style="margin:0">Waiting for this camera to send its settings (it needs VUEMesh 0.21 or later: reload the camera page).</p>'}
  </section>`;
}
function ccuSync() {
  const w = ccuWin;
  if (!w || w.closed) return;
  const peers = ccuCams();
  const sig = peers.map((p) => `${p}:${!!live.get(p).cam}:${live.get(p).cam?.remote}:${live.get(p).cam?.zmax}:${live.get(p).cam?.evn}:${(live.get(p).cam?.lenses || []).map((x) => x.id).join(',')}`).join('|');
  const main = w.document.getElementById('cams');
  if (!main) return;
  if (sig !== ccuSig) {
    ccuSig = sig;
    main.innerHTML = peers.length ? peers.map(ccuCard).join('') : '<p class="empty">No cameras live yet. Phones show up here as they join.</p>';
    if (ccuFocus) main.querySelector(`[data-peer="${CSS.escape(ccuFocus)}"]`)?.scrollIntoView({ block: 'nearest' });
    ccuFocus = null;
  }
  // values and states, in place (not under a control being dragged)
  main.querySelectorAll('.cam').forEach((el) => {
    const l = live.get(el.dataset.peer), c = l?.cam;
    if (!l) return;
    el.classList.toggle('air', el.dataset.peer === liveActive);
    el.querySelector('.tag').textContent = el.dataset.peer === liveActive ? 'ON AIR' : 'READY';
    if (!c) return;
    for (const [key, v, shown] of [['z', c.z, c.z.toFixed(1) + '×'], ['ev', c.ev, fmtEv(c.ev)], ['ct', c.ct, c.ct.toFixed(2)]]) {
      const r = el.querySelector(`[data-k="${key}"]`);
      if (r && w.document.activeElement !== r && !(r.dataset.touched > Date.now() - 1500)) {
        r.value = String(v);
        el.querySelector(`[data-o="${key}"]`).textContent = shown;
      }
    }
    el.querySelectorAll('[data-lens]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lens === c.lens)));
    el.querySelector('[data-act="lock"]')?.setAttribute('aria-pressed', String(!!c.lock));
    el.querySelector('[data-act="wb"]')?.setAttribute('aria-pressed', String(!!c.wb));
  });
}
const ccuSend = (peer, msg) => (live.get(peer)?.local ? localCtl(peer, msg) : hub?.message(peer, { t: 'camctl', ...msg }));
function bindCcu(w) {
  const d = w.document, last = new Map();
  const send = (peer, key, v, now) => {
    const id = peer + key, t = Date.now();
    if (!now && t - (last.get(id) || 0) < 70) return; // a moving control: about 14 updates a second
    last.set(id, t);
    ccuSend(peer, { [key === 'z' ? 'zoom' : key]: v });
  };
  d.addEventListener('input', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (!r || !card) return;
    r.dataset.touched = Date.now();
    const v = +r.value, key = r.dataset.k;
    card.querySelector(`[data-o="${key}"]`).textContent = key === 'z' ? v.toFixed(1) + '×' : key === 'ev' ? fmtEv(v) : v.toFixed(2);
    send(card.dataset.peer, key, v, false);
  });
  d.addEventListener('change', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (r && card) send(card.dataset.peer, r.dataset.k, +r.value, true);
  });
  d.addEventListener('dblclick', (e) => {
    const r = e.target.closest('[data-k]'), card = e.target.closest('.cam');
    if (!r || !card) return;
    r.value = String({ z: 1, ev: 0, ct: 1 }[r.dataset.k]);
    r.dispatchEvent(new w.Event('input', { bubbles: true }));
    send(card.dataset.peer, r.dataset.k, +r.value, true);
  });
  d.addEventListener('click', (e) => {
    const card = e.target.closest('.cam');
    if (!card) return;
    const peer = card.dataset.peer, l = live.get(peer);
    const lens = e.target.closest('[data-lens]')?.dataset.lens;
    if (lens) return ccuSend(peer, { lens });
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'lock') return ccuSend(peer, { lock: !l?.cam?.lock });
    if (act === 'wb') return ccuSend(peer, { wb: !l?.cam?.wb });
    if (act === 'auto') return ccuSend(peer, { auto: true });
    if (act === 'cut') return cutLive(peer);
    const pic = e.target.closest('[data-pic]');
    if (!pic || !l?.cam?.remote) return;
    // where in the picture: map the click through the letterboxing to the phone's live frame
    const cv = pic.querySelector('canvas'), box = cv.getBoundingClientRect(), dr = cv._drawn;
    if (!dr) return;
    const px = ((e.clientX - box.left) / box.width) * cv.width, py = ((e.clientY - box.top) / box.height) * cv.height;
    const cx = (px - dr.dx) / dr.dw, cy = (py - dr.dy) / dr.dh;
    if (cx < 0 || cx > 1 || cy < 0 || cy > 1) return;
    const r = l.view?.rect || { x: 0, y: 0, w: 1, h: 1 };
    ccuSend(peer, { focus: { u: r.x + cx * r.w, v: r.y + cy * r.h } });
    const ret = d.createElement('div');
    ret.className = 'ret';
    Object.assign(ret.style, { left: e.clientX - pic.getBoundingClientRect().left + 'px', top: e.clientY - pic.getBoundingClientRect().top + 'px' });
    pic.append(ret);
    setTimeout(() => ret.remove(), 1300);
  });
  // messages to the person on that camera (the same as the studio's message box under its tile)
  d.addEventListener('submit', (e) => {
    const form = e.target.closest('[data-msg]'), card = e.target.closest('.cam');
    if (!form || !card) return;
    e.preventDefault();
    const inp = form.querySelector('input'), text = inp.value.trim();
    if (!text) return;
    const ok = sendDm(card.dataset.peer, text);
    inp.value = '';
    let st = form.querySelector('.st');
    if (!st) form.append((st = d.createElement('span'), st.className = 'st', st));
    st.textContent = ok ? 'Sent' : "Couldn't reach them";
    setTimeout(() => (st.textContent = ''), 4000);
  });
  // strip width: a bank of camera controls, as narrow or wide as you like (remembered)
  const cw = d.getElementById('cw');
  const applyCw = () => d.documentElement.style.setProperty('--cw', `${cw.value}px`);
  applyCw();
  cw.addEventListener('input', () => {
    applyCw();
    localStorage.setItem('vm_ccu_w', cw.value);
  });
  // the studio's keys keep working from here (cuts, black, break)
  d.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true }));
  });
}

// Scopes: each picture is shrunk to 160 wide and read back; the histogram counts R, G, B and
// brightness (Rec. 709 luma) in 256 steps; the waveform shows, for every column of the
// picture, how bright its pixels are (bottom black, top white), like a broadcast waveform.
const scopeCv = document.createElement('canvas'), scopeG = scopeCv.getContext('2d', { willReadFrequently: true });
const WAVE_ROWS = 100;
function measurePicture(l) {
  const v = l.video;
  if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;
  const r = l.view?.rect?.w > 0 && l.view.rect.h > 0 ? l.view.rect : { x: 0, y: 0, w: 1, h: 1 };
  const sx = r.x * v.videoWidth, sy = r.y * v.videoHeight, sw = r.w * v.videoWidth, sh = r.h * v.videoHeight;
  if (!(sw >= 1 && sh >= 1)) return null;
  const W = 160, H = Math.max(16, Math.min(284, Math.round((W * sh) / sw)));
  if (scopeCv.width !== W || scopeCv.height !== H) Object.assign(scopeCv, { width: W, height: H });
  scopeG.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  const d = scopeG.getImageData(0, 0, W, H).data;
  const hist = new Uint32Array(1024), wave = new Uint16Array(W * WAVE_ROWS);
  let hi = 0, lo = 0;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2], Y = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
      hist[R]++;
      hist[256 + G]++;
      hist[512 + B]++;
      hist[768 + Y]++;
      wave[x * WAVE_ROWS + Math.min(WAVE_ROWS - 1, Math.floor((Y / 256) * WAVE_ROWS))]++;
      if (Y >= 250) hi++;
      else if (Y <= 5) lo++;
    }
  }
  return { W, H, hist, wave, hi: hi / (W * H), lo: lo / (W * H) };
}
function drawHistogram(cv, m) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#ffffff14';
  for (const f of [0.25, 0.5, 0.75]) g.strokeRect(Math.round(W * f) + 0.5, -1, 0, H + 2);
  if (!m) return;
  let peak = 1;
  for (let i = 0; i < 1024; i++) peak = Math.max(peak, m.hist[i]);
  const ys = (n) => H - Math.sqrt(n / peak) * (H - 12); // (square root: dim tones stay visible)
  g.globalCompositeOperation = 'lighter';
  [['#ff4d4d66', 0], ['#3ddc6b66', 256], ['#4d8dff66', 512]].forEach(([col, o]) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, H);
    for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, ys(m.hist[o + i]));
    g.lineTo(W, H);
    g.fill();
  });
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = '#ffffffcc';
  g.lineWidth = 1.2;
  g.beginPath();
  for (let i = 0; i < 256; i++) g[i ? 'lineTo' : 'moveTo']((i / 255) * W, ys(m.hist[768 + i]));
  g.stroke();
}
function drawWaveform(cv, m) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.fillStyle = '#050608';
  g.fillRect(0, 0, W, H);
  if (m) {
    const img = g.createImageData(m.W, WAVE_ROWS), px = img.data, scale = 255 / Math.max(4, (m.H / WAVE_ROWS) * 6);
    for (let x = 0; x < m.W; x++) {
      for (let r = 0; r < WAVE_ROWS; r++) {
        const n = m.wave[x * WAVE_ROWS + r];
        if (!n) continue;
        const a = Math.min(255, 50 + n * scale), o = ((WAVE_ROWS - 1 - r) * m.W + x) * 4;
        px[o] = 90;
        px[o + 1] = 255;
        px[o + 2] = 120;
        px[o + 3] = a;
      }
    }
    if (!cv._tmp) cv._tmp = cv.ownerDocument.createElement('canvas');
    Object.assign(cv._tmp, { width: m.W, height: WAVE_ROWS });
    cv._tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(cv._tmp, 0, 0, W, H);
  }
  // 0, 50 and 100 (black, middle, white)
  g.strokeStyle = '#ffffff22';
  g.fillStyle = '#8b8e97';
  g.font = '9px ui-monospace, monospace';
  for (const [f, label] of [[0, '0'], [0.5, '50'], [1, '100']]) {
    const y = Math.round(H - 2 - f * (H - 14)) + 0.5;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
    g.fillText(label, W - 20, y - 2);
  }
}
let ccuLastScope = 0;
function ccuFrame(w, t) {
  if (w.closed || ccuWin !== w) return;
  // the next frame is booked first, and each camera is drawn on its own: one camera's
  // trouble (a picture that isn't ready, a phone that just left) can't stop the window
  w.requestAnimationFrame((t2) => ccuFrame(w, t2));
  const scopesDue = t - ccuLastScope > 120; // about 8 times a second
  if (scopesDue) ccuLastScope = t;
  w.document.querySelectorAll('.cam').forEach((el) => {
    try {
      ccuDrawCard(w, el, scopesDue);
    } catch (err) {
      if (!el._warned) console.warn('camera control: drawing', el.dataset.peer, err);
      el._warned = true;
    }
  });
}
function ccuDrawCard(w, el, scopesDue) {
  {
    const l = live.get(el.dataset.peer);
    const cv = el.querySelector('[data-v]');
    if (!l || !cv) return;
    const box = cv.getBoundingClientRect(), dpr = w.devicePixelRatio || 1;
    const W = Math.round(box.width * dpr), H = Math.round(box.height * dpr);
    if (cv.width !== W || cv.height !== H) Object.assign(cv, { width: W, height: H });
    const g = cv.getContext('2d'), v = l.video;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (v?.readyState >= 2 && v.videoWidth) {
      const r = l.view?.rect || { x: 0, y: 0, w: 1, h: 1 };
      const sw = r.w * v.videoWidth, sh = r.h * v.videoHeight, k = Math.min(W / sw, H / sh);
      const dw = sw * k, dh = sh * k, dx = (W - dw) / 2, dy = (H - dh) / 2;
      g.drawImage(v, r.x * v.videoWidth, r.y * v.videoHeight, sw, sh, dx, dy, dw, dh);
      cv._drawn = { dx, dy, dw, dh };
    }
    // paused by the person on the camera: say so, as the studio's tile does
    let pz = el.querySelector('.pz');
    if (l.paused && !pz) {
      pz = w.document.createElement('span');
      pz.className = 'pz';
      pz.textContent = 'PAUSED';
      el.querySelector('[data-pic]').append(pz);
    } else if (!l.paused && pz) pz.remove();
    if (scopesDue) {
      const m = measurePicture(l);
      for (const [sel, fn] of [['[data-h]', drawHistogram], ['[data-w]', drawWaveform]]) {
        const sc = el.querySelector(sel), sb = sc.getBoundingClientRect();
        const SW = Math.round(sb.width * dpr), SH = Math.round(sb.height * dpr);
        if (sc.width !== SW || sc.height !== SH) Object.assign(sc, { width: SW, height: SH });
        fn(sc, m);
      }
      let warn = el.querySelector('.clipwarn');
      const say = m && (m.hi > 0.02 || m.lo > 0.2) ? [m.hi > 0.02 ? `${Math.round(m.hi * 100)}% clipped white` : '', m.lo > 0.2 ? `${Math.round(m.lo * 100)}% crushed black` : ''].filter(Boolean).join(' · ') : '';
      if (say && !warn) {
        warn = w.document.createElement('span');
        warn.className = 'clipwarn';
        el.querySelector('[data-pic]').append(warn);
      }
      if (warn) say ? (warn.textContent = say) : warn.remove();
    }
  }
}
$('#ccuBtn').onclick = () => openCcu();
document.querySelectorAll('[data-console]').forEach((b) => (b.onclick = openConsole));

const fmtEq = (v) => (v > 0 ? '+' : '') + (+v).toFixed(1);
function conStrip(r) {
  const st = r.st, eq = eqOf(st.eq), pan = st.pan || 0;
  const knob = (k, label, v, min, max, step, shown) => `<label class="k"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(r.name)}: ${label}"><output data-o="${k}">${shown}</output></label>`;
  const btns = r.live
    ? MODES.map((m) => `<button type="button" data-amode="${m}" aria-pressed="${st.mode === m}">${MODE_LABEL[m]}</button>`).join('') + `<button type="button" data-mono aria-pressed="${!!st.mono}" title="Play both channels as one (off: stereo)">MONO</button>`
    : `${r.track?.follow ? `<button type="button" data-duck aria-pressed="${!!r.track.duck}" title="Quiet while a microphone recording plays, on everywhere else">DUCK</button>` : ''}<button type="button" data-mono aria-pressed="${!!st.mono}" title="Play both channels as one">MONO</button><button type="button" data-mute aria-pressed="${!!st.muted}">MUTE</button>`;
  return `<div class="ch${r.live && r.open?.() ? ' open' : ''}" data-strip="${esc(r.id)}">
    <h3 title="${esc(r.name)}">${esc(r.name)}</h3>
    <div class="btns">${btns}</div>
    <div class="eq"><div class="lbl">EQ <button type="button" data-hp aria-pressed="${eq.hp}" title="High-pass at ${EQ_BANDS.hp} Hz: takes out rumble, wind and handling noise">HPF ${EQ_BANDS.hp}</button></div><canvas data-curve aria-hidden="true"></canvas></div>
    ${knob('high', 'HIGH', eq.high, -12, 12, 0.5, fmtEq(eq.high))}
    ${knob('mid', 'MID', eq.mid, -12, 12, 0.5, fmtEq(eq.mid))}
    ${knob('low', 'LOW', eq.low, -12, 12, 0.5, fmtEq(eq.low))}
    ${knob('pan', 'BAL', Math.round(pan * 100), -100, 100, 1, fmtPan(pan))}
    <div class="fd"><canvas data-meter aria-hidden="true"></canvas><input type="range" data-k="gain" min="-60" max="12" step="1" value="${gainToDb(st.gain ?? 1)}" aria-label="${esc(r.name)}: level"></div>
    <output class="db" data-o="gain">${gainToDb(st.gain ?? 1)} dB</output>
  </div>`;
}

/** Bring the console in line with the mixer (rebuilt when the channels change, else updated in place). */
function consoleSync() {
  const w = conWin;
  if (!w) return;
  if (w.closed) return (conWin = null);
  const d = w.document, box = d.getElementById('strips');
  if (!box) return;
  d.getElementById('room').textContent = mode === 'live' ? 'LIVE' : 'EDIT';
  d.getElementById('room').className = 'room' + (mode === 'edit' ? ' edit' : '');
  d.getElementById('cListenRow').hidden = mode !== 'live';
  d.getElementById('cListen').checked = $('#listen').checked;
  d.getElementById('outName').textContent = mode === 'live' ? 'Program' : 'Master';
  const rows = mixRows.filter((r) => !r.master);
  const sig = mode + '|' + rows.map((r) => `${r.id}:${r.name}:${r.live ? 'l' : 't'}`).join('|');
  if (sig !== conSig) {
    conSig = sig;
    box.innerHTML = rows.length ? rows.map(conStrip).join('') : `<p class="empty">${mode === 'live' ? 'No phones with sound yet.' : 'No audio tracks yet.'}</p>`;
    return;
  }
  for (const r of rows) {
    const el = box.querySelector(`[data-strip="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    el.querySelectorAll('[data-amode]').forEach((b) => b.setAttribute('aria-pressed', String(r.st.mode === b.dataset.amode)));
    el.querySelector('[data-mute]')?.setAttribute('aria-pressed', String(!!r.st.muted));
    el.querySelector('[data-mono]')?.setAttribute('aria-pressed', String(!!r.st.mono));
    const eq = eqOf(r.st.eq);
    el.querySelector('[data-hp]')?.setAttribute('aria-pressed', String(eq.hp));
    const vals = { gain: gainToDb(r.st.gain ?? 1), high: eq.high, mid: eq.mid, low: eq.low, pan: Math.round((r.st.pan || 0) * 100) };
    for (const [k, v] of Object.entries(vals)) {
      const inp = el.querySelector(`input[data-k="${k}"]`);
      if (inp && d.activeElement !== inp) inp.value = String(v);
      const o = el.querySelector(`[data-o="${k}"]`);
      if (o) o.textContent = k === 'gain' ? `${v} dB` : k === 'pan' ? fmtPan(v / 100) : fmtEq(v);
    }
  }
}

/** Change one setting on one channel, from the console. */
function conSet(r, k, v) {
  if (k === 'gain') {
    const g = dbToGain(v);
    if (r.track) {
      r.track.gain = g;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), gain: g });
      stripNodes(r)?.fader.gain.setTargetAtTime(g, player.ctx.currentTime, 0.02);
    }
  } else {
    const patch = k === 'pan' ? { pan: v / 100 } : { eq: { ...eqOf(r.st.eq), [k]: k === 'hp' ? !!v : v } };
    if (r.track) {
      Object.assign(r.track, patch);
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), ...patch });
      applyStripFx(stripNodes(r), mixState(r.id, r.role), true);
    }
  }
  renderMixer();
}

function bindConsole(w) {
  const d = w.document;
  const rowOf = (el) => {
    const s = el.closest('[data-strip]');
    return s && mixRows.find((x) => x.id === s.dataset.strip);
  };
  d.addEventListener('input', (e) => {
    const inp = e.target.closest?.('input[data-k]');
    const r = inp && rowOf(inp);
    if (r) conSet(r, inp.dataset.k, +inp.value);
  });
  d.addEventListener('dblclick', (e) => {
    const inp = e.target.closest?.('input[data-k]');
    const r = inp && rowOf(inp);
    if (!r) return;
    inp.value = '0';
    conSet(r, inp.dataset.k, 0);
  });
  d.addEventListener('click', (e) => {
    const b = e.target.closest?.('button');
    const r = b && rowOf(b);
    if (!r) return;
    if (b.dataset.amode) {
      setStripMode(r.id, r.role, b.dataset.amode);
      announce(`${r.name}: ${MODE_LABEL[b.dataset.amode]}`);
    } else if (b.hasAttribute('data-hp')) conSet(r, 'hp', !eqOf(r.st.eq).hp);
    else if (r.live && b.hasAttribute('data-mono')) toggleStripMono(r);
    else if (r.track && (b.hasAttribute('data-mute') || b.hasAttribute('data-mono') || b.hasAttribute('data-duck'))) {
      if (b.hasAttribute('data-mute')) {
        r.track.muted = !r.track.muted;
        r.track.touched = true;
      } else if (b.hasAttribute('data-duck')) {
        r.track.duck = !r.track.duck;
        r.track.touched = true;
      } else r.track.mono = !(r.track.mono !== false);
      saveSeq();
      player.refreshMix();
      renderMixer();
      renderTimeline();
    }
  });
  d.getElementById('cListen').addEventListener('change', (e) => {
    $('#listen').checked = e.target.checked;
    $('#listen').onchange({ target: $('#listen') });
  });
  // the studio's own keys work from here (cut with 1–9, B, X, T, M…)
  d.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, input[type=checkbox]')) return;
    if (e.target.matches?.('input[type=range]') && /^(Arrow|Page|Home|End)/.test(e.key)) return;
    const copy = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
    document.body.dispatchEvent(copy);
    if (copy.defaultPrevented) e.preventDefault();
  });
  w.addEventListener('pagehide', () => {
    if (conWin === w) conWin = null;
  });
}

// ---- console drawing (on the console window's own animation frames) ----
const dbOf = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
const conL = new Float32Array(4096), conR = new Float32Array(4096), conSpec = new Float32Array(8192);
let conText = 0, conRms = -120, conZoom = 1;
function timeData(an, buf) {
  const b = buf.subarray(0, an.fftSize);
  an.getFloatTimeDomainData(b);
  return b;
}
const peakIn = (b) => {
  let p = 0;
  for (let i = 0; i < b.length; i++) p = Math.max(p, Math.abs(b[i]));
  return p;
};
function hold(id, i, v, t) {
  const h = conHolds.get(id) || [];
  conHolds.set(id, h);
  const x = h[i] || { v: 0, at: 0 };
  if (v >= x.v || t - x.at > 1500) h[i] = { v, at: t };
  else h[i] = { v: x.v * 0.995, at: x.at };
  return h[i].v;
}
function drawBars(g, W, H, levels, holds) {
  g.clearRect(0, 0, W, H);
  const n = levels.length, gap = Math.max(2, W * 0.06), bw = (W - gap * (n - 1)) / n;
  const y = (db) => H - Math.max(0, Math.min(1, (db + 60) / 60)) * H;
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, '#2bd36b');
  grad.addColorStop(0.69, '#2bd36b');
  grad.addColorStop(0.8, '#f2c037');
  grad.addColorStop(0.95, '#ff3b30');
  levels.forEach((lv, i) => {
    const x = i * (bw + gap);
    g.fillStyle = '#111';
    g.fillRect(x, 0, bw, H);
    const top = y(dbOf(lv));
    g.fillStyle = grad;
    g.fillRect(x, top, bw, H - top);
    g.fillStyle = '#fff';
    g.fillRect(x, y(dbOf(holds[i])) - 1, bw, 2);
  });
  g.fillStyle = '#ffffff40';
  for (const db of [-6, -12, -18, -24, -36, -48]) g.fillRect(0, y(db), W, 1);
}
function drawCurve(g, W, H, eq) {
  const n = Math.max(32, Math.round(W / 2));
  const freqs = new Float32Array(n);
  for (let i = 0; i < n; i++) freqs[i] = 20 * Math.pow(1000, i / (n - 1)); // 20 Hz … 20 kHz
  const db = eqCurve(eq, freqs);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const y = (v) => H / 2 - (Math.max(-15, Math.min(15, v)) / 15) * (H / 2 - 3);
  g.fillStyle = '#ffffff1f';
  for (const f of [100, 1000, 10000]) g.fillRect((Math.log10(f / 20) / 3) * W, 0, 1, H);
  g.fillRect(0, H / 2, W, 1);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * W;
    i ? g.lineTo(x, y(db[i])) : g.moveTo(x, y(db[i]));
  }
  g.strokeStyle = eqFlat(eq) ? '#8b8e97' : '#6d9cf0';
  g.lineWidth = Math.max(1.5, H / 30);
  g.stroke();
  g.lineTo(W, H / 2);
  g.lineTo(0, H / 2);
  g.closePath();
  g.fillStyle = '#6d9cf033';
  g.fill();
}
function drawSpectrum(g, W, H, an, dpr) {
  const n = an.frequencyBinCount, arr = conSpec.subarray(0, n), ny = an.context.sampleRate / 2;
  an.getFloatFrequencyData(arr);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const xOf = (f) => (Math.log(f / 20) / Math.log(ny / 20)) * W;
  g.fillStyle = '#ffffff30';
  g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
  for (const [f, lab] of [[100, '100'], [1000, '1k'], [10000, '10k']]) {
    g.fillRect(xOf(f), 0, 1, H);
    g.fillText(lab, xOf(f) + 3 * dpr, H - 4 * dpr);
  }
  g.beginPath();
  g.moveTo(0, H);
  const step = Math.max(1, Math.round(2 * dpr));
  for (let x = 0; x <= W; x += step) {
    const f0 = 20 * Math.pow(ny / 20, x / W), f1 = 20 * Math.pow(ny / 20, (x + step) / W);
    const b0 = Math.floor((f0 / ny) * n), b1 = Math.max(b0 + 1, Math.floor((f1 / ny) * n));
    let v = -160;
    for (let b = b0; b < b1 && b < n; b++) v = Math.max(v, arr[b]);
    g.lineTo(x, H - Math.max(0, Math.min(1, (v + 100) / 90)) * H);
  }
  g.lineTo(W, H);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#ff3b30');
  grad.addColorStop(0.3, '#f2c037');
  grad.addColorStop(1, '#2bd36b');
  g.fillStyle = grad;
  g.globalAlpha = 0.85;
  g.fill();
  g.globalAlpha = 1;
}
function drawScope(g, W, H, L, R, zoom, dpr) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff22';
  g.fillRect(0, H / 2, W, 1);
  if (zoom > 1.05) {
    g.fillStyle = '#8b8e97';
    g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
    g.textAlign = 'right';
    g.fillText(`×${zoom.toFixed(zoom < 10 ? 1 : 0)}`, W - 6 * dpr, 14 * dpr);
    g.textAlign = 'left';
  }
  for (const [buf, col] of [[L, '#2bd36b'], [R, '#f2c037']]) {
    g.beginPath();
    for (let i = 0; i < buf.length; i++) {
      const x = (i / (buf.length - 1)) * W, y = H / 2 - Math.max(-1, Math.min(1, buf[i] * zoom)) * (H / 2 - 2);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.strokeStyle = col;
    g.lineWidth = 1.5;
    g.stroke();
  }
}
function drawVector(g, W, H, L, R, zoom, dpr) {
  g.fillStyle = 'rgba(0,0,0,0.28)'; // phosphor: the last few frames fade out
  g.fillRect(0, 0, W, H);
  const s = Math.min(W, H) / 2 - 8 * dpr, cx = W / 2, cy = H / 2;
  g.strokeStyle = '#ffffff1f';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx, cy - s); g.lineTo(cx, cy + s);
  g.moveTo(cx - s * 0.7, cy - s * 0.7); g.lineTo(cx + s * 0.7, cy + s * 0.7);
  g.moveTo(cx + s * 0.7, cy - s * 0.7); g.lineTo(cx - s * 0.7, cy + s * 0.7);
  g.stroke();
  g.fillStyle = '#ffffff55';
  g.font = `${Math.round(10 * dpr)}px ui-monospace, monospace`;
  g.fillText('L', cx - s * 0.74, cy - s * 0.74);
  g.fillText('R', cx + s * 0.7, cy - s * 0.74);
  g.fillText('M', cx + 4 * dpr, cy - s + 10 * dpr);
  g.fillStyle = '#6fd0ef';
  const k = s * Math.SQRT1_2 * zoom, dot = Math.max(1.5, dpr * 1.2);
  for (let i = 0; i < L.length; i += 2) g.fillRect(cx + (R[i] - L[i]) * k, cy - (L[i] + R[i]) * k, dot, dot);
}
function consoleFrame(w) {
  if (w.closed || conWin !== w) return;
  w.requestAnimationFrame(() => consoleFrame(w));
  const d = w.document, dpr = w.devicePixelRatio || 1, t = performance.now();
  const ctxOf = (cv) => {
    const W = Math.min(4096, Math.round(cv.clientWidth * dpr)), H = Math.min(4096, Math.round(cv.clientHeight * dpr)); // (never runaway)
    if (W && H && (cv.width !== W || cv.height !== H)) Object.assign(cv, { width: W, height: H });
    return cv.getContext('2d');
  };
  for (const r of mixRows) {
    if (r.master) continue;
    const el = d.querySelector(`[data-strip="${CSS.escape(r.id)}"]`);
    if (!el) continue;
    el.classList.toggle('open', !!(r.live && r.open?.()));
    const cc = el.querySelector('[data-curve]');
    const sig = JSON.stringify(eqOf(r.st.eq)) + cc.clientWidth;
    if (cc.dataset.sig !== sig) {
      cc.dataset.sig = sig;
      drawCurve(ctxOf(cc), cc.width, cc.height, r.st.eq);
    }
    const an = r.meter?.();
    const lv = an ? peakIn(timeData(an, conL)) : 0;
    const mc = el.querySelector('[data-meter]');
    drawBars(ctxOf(mc), mc.width, mc.height, [lv], [hold(r.id, 0, lv, t)]);
  }
  // the output: meters, readouts, spectrum, waveform, stereo picture
  if (mode === 'live') mixInit();
  const pair = mode === 'live' ? [mix.meterL, mix.meterR] : (player.meterLR ||= stereoMeters(player.ctx, player.limit));
  if (mode !== 'live' && !player.spec) {
    player.spec = player.ctx.createAnalyser();
    player.spec.fftSize = 4096;
    player.spec.smoothingTimeConstant = 0.75;
    player.limit.connect(player.spec);
  }
  const L = timeData(pair[0], conL), R = timeData(pair[1], conR);
  let sl = 0, sr = 0, slr = 0;
  for (let i = 0; i < L.length; i++) {
    sl += L[i] * L[i];
    sr += R[i] * R[i];
    slr += L[i] * R[i];
  }
  const pl = peakIn(L), pr = peakIn(R);
  const mc = d.getElementById('cMeters');
  drawBars(ctxOf(mc), mc.width, mc.height, [pl, pr], [hold('out', 0, pl, t), hold('out', 1, pr, t)]);
  const rmsDb = dbOf(Math.sqrt((sl + sr) / (2 * L.length)));
  conRms = rmsDb > conRms ? rmsDb : conRms * 0.9 + rmsDb * 0.1;
  if (t - conText > 120) {
    conText = t;
    const pk = dbOf(Math.max(conHolds.get('out')?.[0]?.v || 0, conHolds.get('out')?.[1]?.v || 0));
    d.getElementById('rPeak').textContent = pk <= -100 ? '−∞' : `${pk.toFixed(1)} dB`;
    d.getElementById('rRms').textContent = conRms <= -100 ? '−∞' : `${conRms.toFixed(1)} dB`;
    const diff = dbOf(Math.sqrt(sl / L.length)) - dbOf(Math.sqrt(sr / R.length));
    d.getElementById('rBal').textContent = sl + sr < 1e-9 || Math.abs(diff) < 0.5 ? 'C' : `${diff > 0 ? 'L' : 'R'} ${Math.abs(diff).toFixed(1)} dB`;
    d.getElementById('rCorr').textContent = sl * sr > 1e-12 ? (slr / Math.sqrt(sl * sr)).toFixed(2) : '–';
  }
  const spec = mode === 'live' ? mix.spec : player.spec;
  const sc = d.getElementById('cSpec'), oc = d.getElementById('cScope'), vc = d.getElementById('cVec');
  drawSpectrum(ctxOf(sc), sc.width, sc.height, spec, dpr);
  // quiet sound is scaled up to be seen (the waveform says by how much)
  const want = Math.max(1, Math.min(40, 0.8 / Math.max(1e-4, pl, pr)));
  conZoom = want < conZoom ? want : conZoom * 0.97 + want * 0.03;
  drawScope(ctxOf(oc), oc.width, oc.height, L, R, conZoom, dpr);
  drawVector(ctxOf(vc), vc.width, vc.height, L, R, conZoom, dpr);
}

// ---- stream the program out (WHIP) -------------------------------------------------------
// One output: the program (picture and mix) straight from this browser to a streaming
// service over WebRTC (WHIP). Templates fill in what each service needs; the key stays on
// this computer. RTMP-only services (YouTube, Facebook) go through one that restreams.
const streamCfg = JSON.parse(localStorage.getItem('vm_stream') || '{}');
let streamOut = null, streamTimer = null, streamSince = 0;
const svcOf = (id) => STREAM_SERVICES.find((s) => s.id === id) || STREAM_SERVICES[0];
$('#stSvc').innerHTML = [['whip', 'Straight from this browser (WHIP)'], ['rtmp', 'RTMP: through the VUEMesh relay on this computer'], ['vcam', 'Video calls: as a camera on this computer (relay)']]
  .map(([k, label]) => `<optgroup label="${label}">${STREAM_SERVICES.filter((s) => (k === 'vcam' ? s.vcam : s.kind === k && !s.vcam)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
$('#stRelay').value = streamCfg.relay || RELAY_DEFAULT;
$('#stSvc').value = svcOf(streamCfg.svc).id;
$('#stRate').value = String(streamCfg.kbps || 4500);
function renderStreamForm() {
  const s = svcOf($('#stSvc').value), saved = (streamCfg.per || {})[s.id] || {};
  $('#stHelp').textContent = s.help;
  $('#stUrlLbl').textContent = s.urlLabel || 'WHIP URL';
  $('#stUrl').hidden = $('#stUrlLbl').hidden = !!s.fixedUrl;
  $('#stKeyLbl').textContent = s.keyLabel || 'Key';
  $('#stKey').hidden = $('#stKeyLbl').hidden = !!s.noKey;
  $('#stUrl').value = saved.url || s.url || '';
  $('#stKey').value = saved.key || '';

  $('#stUrl').placeholder = s.kind === 'rtmp' ? 'rtmp://… or rtmps://…' : 'https://…';
  $('#stRelayRow').hidden = s.kind !== 'rtmp';
  if (s.kind === 'rtmp') {
    checkRelay();
    renderRelaySteps();
  }
}
// RTMP goes through the VUEMesh relay on this computer: is it there, with ffmpeg?
let relayOk = false;
async function checkRelay() {
  const url = $('#stRelay').value.trim() || RELAY_DEFAULT;
  $('#stRelayState').textContent = 'Looking for the relay on this computer…';
  try {
    const hi = await relayHello(url);
    relayOk = !!hi.ffmpeg;
    $('#stRelayState').textContent = hi.ffmpeg ? `Relay ready, with ffmpeg ${hi.ffmpeg}.` : "The relay is running, but ffmpeg isn't installed on this computer. Install it, then restart the relay.";
  } catch {
    relayOk = false;
    $('#stRelayState').textContent = `No relay at ${url} yet. Start it (see below), then check again.`;
  }
  $('#stRelayState').classList.toggle('ok', relayOk);
}
$('#stRelayCheck').onclick = checkRelay;
// Setting the relay up, for the computer this is (any other with a tab).
const RELAY_STEPS = {
  win: [
    ['Install Node.js and ffmpeg. Open PowerShell (Start, then type PowerShell) and run these two (or get them from nodejs.org and ffmpeg.org):', 'winget install -e --id OpenJS.NodeJS.LTS', 'winget install -e --id Gyan.FFmpeg'],
    ['Close PowerShell and open a new one, so it finds them. Then start the relay from your Downloads folder:', 'cd $HOME\\Downloads; node vuemesh-relay.mjs'],
    ['Leave that window open while you stream, and press Check for the relay above.'],
  ],
  mac: [
    ['Install Homebrew if you haven\u2019t (the one command at brew.sh, pasted into Terminal), then install Node.js and ffmpeg:', 'brew install node ffmpeg'],
    ['Start the relay from your Downloads folder:', 'cd ~/Downloads && node vuemesh-relay.mjs'],
    ['Leave that Terminal window open while you stream, and press Check for the relay above.'],
  ],
  linux: [
    ['Install Node.js (18 or later) and ffmpeg. Ubuntu or Debian: (if node --version says below 18, get Node from nodejs.org or with sudo snap install node --classic; on Fedora, enable RPM Fusion and use dnf)', 'sudo apt install -y nodejs ffmpeg'],
    ['Start the relay from your Downloads folder:', 'cd ~/Downloads && node vuemesh-relay.mjs'],
    ['Leave that terminal open while you stream, and press Check for the relay above.'],
  ],
  cros: [
    ['Turn on Linux: Settings, About ChromeOS, Developers, Linux development environment, Set up. Then, in the Files app, move vuemesh-relay.mjs from Downloads into Linux files.'],
    ['Open the Terminal app (Linux) and install Node.js and ffmpeg:', 'sudo apt update && sudo apt install -y nodejs ffmpeg'],
    ['Start the relay:', 'node vuemesh-relay.mjs'],
    ['Leave the Terminal open and press Check for the relay above. If it isn\u2019t found, add port 8935 under the Linux development environment\u2019s Port forwarding in Settings.'],
  ],
};
// Then, for video calls: making the program a camera the call can pick (once per computer).
const VCAM_STEPS = {
  win: [
    ['Install OBS Studio (it makes the camera):', 'winget install -e --id OBSProject.OBSStudio'],
    ['In OBS: Sources, +, Media Source. Untick Local File. Input: the line below. Input Format: mpegts. OK.', 'udp://127.0.0.1:9998'],
    ['In OBS: Start Virtual Camera. In Zoom or Teams, pick the camera "OBS Virtual Camera".'],
    ['For sound: install VB-CABLE (vb-audio.com/Cable). In OBS: Settings, Audio, Monitoring Device: CABLE Input; then the Media Source\u2019s Advanced Audio Properties: Monitor and Output. In the call, pick the microphone "CABLE Output".'],
  ],
  mac: [
    ['Install OBS Studio (it makes the camera) and BlackHole (for the sound):', 'brew install --cask obs blackhole-2ch'],
    ['In OBS: Sources, +, Media Source. Untick Local File. Input: the line below. Input Format: mpegts. OK.', 'udp://127.0.0.1:9998'],
    ['In OBS: Start Virtual Camera. In Zoom, Teams or Meet, pick the camera "OBS Virtual Camera".'],
    ['For sound: OBS Settings, Audio, Monitoring Device: BlackHole 2ch; the Media Source\u2019s Advanced Audio Properties: Monitor and Output. In the call, pick the microphone "BlackHole 2ch".'],
  ],
  linux: [
    ['Make a VUEMesh camera and microphone (no OBS needed): install the loopback camera, then load both (again after a restart):', 'sudo apt install -y v4l2loopback-dkms', 'sudo modprobe v4l2loopback video_nr=10 card_label=VUEMesh exclusive_caps=1', 'pactl load-module module-null-sink sink_name=VUEMesh sink_properties=device.description=VUEMesh'],
    ['Start (or restart) the relay. In the call, pick the camera "VUEMesh" and the microphone "Monitor of VUEMesh".'],
  ],
  cros: [
    ['ChromeOS can\u2019t give video calls a camera from Linux. Instead: open Program out, then in the call Share screen, pick the Program out window, and include its sound.'],
  ],
};
const myOs = (() => {
  const ua = navigator.userAgent, p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  if (/CrOS/.test(ua) || p.includes('chrome os') || p.includes('chromeos')) return 'cros';
  if (/Windows/.test(ua) || p.startsWith('win')) return 'win';
  if (/Mac OS X|Macintosh/.test(ua) || p.startsWith('mac')) return 'mac';
  return 'linux';
})();
function renderRelaySteps(os = myOs) {
  document.querySelectorAll('.ostabs [data-os]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.os === os));
    b.textContent = { win: 'Windows', mac: 'Mac', linux: 'Linux', cros: 'ChromeOS' }[b.dataset.os] + (b.dataset.os === myOs ? ' •' : '');
    b.title = b.dataset.os === myOs ? 'This computer' : '';
  });
  const li = ([text, ...cmds]) => `<li><span>${esc(text)}</span>${cmds.map((c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" data-copy="${esc(c)}">Copy</button></div>`).join('')}</li>`;
  const vcam = svcOf($('#stSvc').value).vcam;
  $('#relaySteps').innerHTML = RELAY_STEPS[os].map(li).join('') + (vcam ? `<li class="vcamhead"><b>Then, to use it as a camera in video calls:</b></li>${VCAM_STEPS[os].map(li).join('')}<li class="fine">No install at all: open Program out, then in the call Share screen, pick that window, and include its sound.</li>` : '');
}
document.querySelector('.ostabs')?.addEventListener('click', (e) => { // (the stream-out panel is the Live page's)
  const b = e.target.closest('[data-os]');
  if (b) renderRelaySteps(b.dataset.os);
});
$('#relaySteps').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  try {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = 'Copied';
    setTimeout(() => (b.textContent = 'Copy'), 1500);
  } catch {
    toast('Select the command and copy it');
  }
});
renderRelaySteps();
function saveStreamCfg() {
  const s = svcOf($('#stSvc').value);
  streamCfg.svc = s.id;
  streamCfg.kbps = +$('#stRate').value;
  (streamCfg.per ||= {})[s.id] = { url: $('#stUrl').value.trim(), key: $('#stKey').value.trim() };
  streamCfg.relay = $('#stRelay').value.trim();
  localStorage.setItem('vm_stream', JSON.stringify(streamCfg));
}
$('#stSvc').onchange = () => {
  renderStreamForm();
  saveStreamCfg();
};
['#stUrl', '#stKey', '#stRate'].forEach((id) => $(id).addEventListener('change', saveStreamCfg));
$('#stRelay').addEventListener('change', () => {
  saveStreamCfg();
  checkRelay();
});
renderStreamForm();
function streamState(text, on = false) {
  $('#stState').textContent = text;
  $('#stGo').textContent = on ? 'Stop streaming' : 'Go live';
  $('#stGo').classList.toggle('danger', on);
  $('#streamDot').hidden = !on;
}
$('#stGo').onclick = async () => {
  if (!isHost) return;
  if (streamOut) return stopStream('Stream stopped.');
  const s = svcOf($('#stSvc').value);
  const url = s.fixedUrl ? s.url : $('#stUrl').value.trim();
  const key = s.noKey ? '' : $('#stKey').value.trim();
  if (s.vcam) {
    // (no address or key: the relay makes the camera)
  } else if (s.kind === 'rtmp') {
    if (!url) return toast('Paste the server URL first');
    if (!/^rtmps?:\/\//i.test(url)) return toast('The server URL should start with rtmp:// or rtmps://');
    if (!key && s.id !== 'rtmp') return toast('Paste the stream key first');
  } else {
    if (!url || (/\/$/.test(url) && s.id === 'dolby')) return toast(s.id === 'dolby' ? 'Add your stream name to the end of the URL' : 'Paste the WHIP URL first');
    if (s.id === 'twitch' && !key) return toast('Paste your Twitch stream key first');
  }
  saveStreamCfg();
  mixInit();
  $('#stGo').disabled = true;
  streamState(s.kind === 'rtmp' ? `Connecting to ${s.name} through the relay…` : `Connecting to ${s.name}…`);
  try {
    const stream = new MediaStream([programVideoTrack(), ...mix.dest.stream.getAudioTracks()]);
    const onState = (st, why) => {
      if (st === 'failed' && streamOut) stopStream(why ? `${why} Press Go live to start again.` : `The connection to ${s.name} dropped. Press Go live to start again.`);
    };
    streamOut = s.kind === 'rtmp'
      ? await startRtmp({ relay: $('#stRelay').value.trim() || RELAY_DEFAULT, target: s.vcam ? 'vcam:' : rtmpTarget(url, key), stream, kbps: +$('#stRate').value, onState })
      : await startWhip({ url, token: key, stream, kbps: +$('#stRate').value, onState });
    Object.assign(streamOut, { name: s.name, stream });
    streamSince = Date.now();
    streamState(`Live on ${s.name}`, true);
    if (s.vcam) {
      const v = streamOut.vcam;
      const where = v?.way === 'v4l2' ? `Pick the camera "VUEMesh" (${v.device})${v.sink ? ' and the microphone "Monitor of VUEMesh"' : ''} in your call.` : `In OBS: a Media Source on ${v?.udp || 'udp://127.0.0.1:9998'}, then Start Virtual Camera; in your call pick "OBS Virtual Camera".`;
      note(`The program is a camera on this computer. ${where}`);
      toast(where, 9000);
    }
    note(`Streaming the program to ${s.name}`);
    toast(`Live on ${s.name}`);
    streamTimer = setInterval(async () => {
      if (!streamOut) return;
      const k = await streamOut.rate().catch(() => 0);
      const sec = Math.floor((Date.now() - streamSince) / 1000);
      // through the relay: say so if this computer can't keep up (ffmpeg below real time, or data piling up)
      const sp = streamOut.stats?.().speed, behind = streamOut.backlog?.() > 8e6;
      const slow = streamOut.kind === 'rtmp' && ((sp && sp < 0.9) || behind) ? ` · this computer is struggling to keep up${sp ? ` (${sp}×)` : ''}: try a lower quality` : '';
      streamState(streamOut.vcam ? `On as a camera${streamOut.vcam.way === 'v4l2' ? ` (${streamOut.vcam.device})` : ' (to OBS)'} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${slow}` : `Live on ${streamOut.name}${streamOut.kind === 'rtmp' ? ' (RTMP)' : ''} · ${(k / 1000).toFixed(1)} Mbit/s · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${slow}`, true);
    }, 2000);
  } catch (e) {
    streamOut = null;
    streamState(e.message);
    toast(e.message, 7000);
    note(`Stream to ${s.name} didn't start: ${e.message}`);
  } finally {
    $('#stGo').disabled = false;
  }
};
async function stopStream(why) {
  if (streamSince) addUsage('streamSec', (Date.now() - streamSince) / 1000);
  const s = streamOut;
  streamOut = null;
  clearInterval(streamTimer);
  s?.stream?.getVideoTracks().forEach((t) => t.stop());
  await s?.stop();
  streamState(why || 'Not streaming.');
  if (s) note(`Stopped streaming to ${s.name}`);
}
window.addEventListener('pagehide', () => streamOut?.stop());

// The mixer never keeps empty space. Short, its strips lie flat, one row each, and it is
// exactly as tall as those rows (whatever height it was dragged to: anything more would be
// empty). Dragged tall (175 px or more), the strips stand up and fill it, faders upright.
// Double-click its edge to go back to fitting.
const DOCK_TALL = 175;
const dockFlat = () => !layout.live.dockManual || clampL('dock', layout.live.dock) < DOCK_TALL;
if (document.querySelector('.dock')) new ResizeObserver(() => document.querySelector('.dock')?.classList.toggle('horiz', dockFlat())).observe(document.querySelector('.dock')); // (the mixer dock is the Live page's)
/** How tall the mixer needs to be with its strips lying flat. */
function dockNeed() {
  const dock = document.querySelector('.dock'), bridge = $('#bridge');
  const wasHoriz = dock.classList.contains('horiz');
  dock.classList.add('horiz');
  const keep = bridge.style.cssText;
  bridge.style.flex = 'none';
  bridge.style.height = 'auto';
  const need = Math.ceil(dock.querySelector('.dockhead').offsetHeight + bridge.offsetHeight + 2);
  bridge.style.cssText = keep;
  if (!wasHoriz) dock.classList.remove('horiz');
  return need;
}
function fitDock() {
  const dock = document.querySelector('.dock'), bridge = $('#bridge');
  if (mode !== 'live' || !dock || !bridge || !dock.offsetParent) return;
  // flat strips: exactly as tall as their rows (never empty space, never cut off);
  // upright strips (dragged tall): the height it was dragged to
  const flat = dockFlat();
  const h = flat ? Math.min(Math.round(innerHeight * 0.6), dockNeed()) : clampL('dock', layout.live.dock);
  document.documentElement.style.setProperty('--dock', h + 'px');
  dock.classList.toggle('horiz', flat);
  $('#splitD')?.setAttribute('aria-valuenow', String(h));
}
window.addEventListener('resize', () => fitDock());

// One listener per panel: works whenever the strips were drawn.
for (const box of [$('#mixer'), $('#bridge')]) {
  box.addEventListener('input', (e) => {
    const range = e.target.closest('input[type=range]');
    const el = range?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (!r || r.master) return;
    if (range.hasAttribute('data-pan')) return conSet(r, 'pan', +range.value);
    const g = dbToGain(+range.value);
    document.querySelectorAll(`[data-strip="${CSS.escape(r.id)}"]`).forEach((x) => {
      const rr = x.querySelector('input[type=range]:not([data-pan])');
      if (rr && rr !== range) rr.value = range.value;
      const out = x.querySelector('.db');
      if (out) out.textContent = `${range.value} dB`;
    });
    if (r.track) {
      r.track.gain = g;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
    } else {
      mixSave(r.id, { ...mixState(r.id, r.role), gain: g });
      stripNodes(r)?.fader.gain.setTargetAtTime(g, player.ctx.currentTime, 0.02);
    }
  });
  box.addEventListener('dblclick', (e) => {
    const pan = e.target.closest('input[data-pan]');
    const el = pan?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (r) conSet(r, 'pan', 0);
  });
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const el = b?.closest('[data-strip]');
    const r = el && mixRows.find((x) => x.id === el.dataset.strip);
    if (!r || r.master) return;
    if (b.dataset.amode) {
      setStripMode(r.id, r.role, b.dataset.amode);
      announce(`${r.name}: ${MODE_LABEL[b.dataset.amode]}`);
    } else if (b.hasAttribute('data-mono') && r.live) toggleStripMono(r);
    else if (b.hasAttribute('data-mute') && r.track) {
      r.track.muted = !r.track.muted;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
      renderMixer();
      renderTimeline();
      announce(`${r.name} ${r.track.muted ? 'muted' : 'unmuted'}`);
    } else if (b.hasAttribute('data-mono') && r.track) {
      r.track.mono = !(r.track.mono !== false);
      saveSeq();
      player.refreshMix();
      renderMixer();
    } else if (b.hasAttribute('data-duck') && r.track) {
      r.track.duck = !r.track.duck;
      r.track.touched = true;
      saveSeq();
      player.refreshMix();
      renderMixer();
      announce(`${r.name}: ${r.track.duck ? 'quiet while a microphone plays' : 'always on'}`);
    }
  });
}

let mixRows = [];
const peakOf = (an) => {
  if (!an) return 0;
  const buf = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(buf);
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return p;
};
const toPct = (p) => Math.max(0, Math.min(100, (((p > 0 ? 20 * Math.log10(p) : -60) + 60) / 60) * 100));
// Meters: -60 dB to 0 dB, with a peak hold that falls after 1.5 s and a clip light.
const holds = new Map();
(function meters() {
  const t = performance.now();
  for (const r of mixRows) {
    const levels = twoSides(r) ? (r.meters?.() || []).map(peakOf) : [peakOf(r.meter?.())];
    levels.forEach((p, ch) => {
      const pct = toPct(p);
      const k = r.id + ':' + ch;
      const h = holds.get(k) || { v: 0, at: 0, clipAt: 0 };
      if (pct >= h.v || t - h.at > 1500) Object.assign(h, { v: pct, at: t });
      if (p >= 0.99) h.clipAt = t;
      holds.set(k, h);
      document.querySelectorAll(`[data-strip="${CSS.escape(r.id)}"]`).forEach((el) => {
        const fill = el.querySelector(`.fill[data-ch="${ch}"]`);
        if (fill) fill.style.setProperty('--lvl', pct + '%');
        else {
          const bar = el.querySelector(`.lvl i[data-ch="${ch}"]`);
          if (bar) bar.style.width = pct + '%';
        }
        el.querySelector(`.peak[data-ch="${ch}"]`)?.style.setProperty('--pk', h.v + '%');
        el.querySelector(`.clip[data-ch="${ch}"]`)?.classList.toggle('on', t - h.clipAt < 2000);
      });
    });
    if (r.live) document.querySelectorAll(`.vstrip[data-strip="${CSS.escape(r.id)}"]`).forEach((el) => el.classList.toggle('open', !!r.open?.()));
  }
  for (const peer of micPeers()) {
    const bar = live.get(peer)?.tile?.querySelector('.meter i');
    if (bar) bar.style.width = toPct(peakOf(mix.strips.get(peer)?.meter)) + '%';
  }
  requestAnimationFrame(meters);
})();

// ---- full screen control room ------------------------------------------------------------
// F (or the button): the whole screen becomes the control surface — program, switcher
// bus, multiview, and a vertical meter bridge with faders. Esc leaves.

function setFullscreenUi(on) {
  document.body.classList.toggle('fs', on);
  $('#fsBtn').setAttribute('aria-pressed', String(on));
  if ($('#fsBtn').firstChild) $('#fsBtn').firstChild.textContent = on ? 'Exit full screen ' : 'Full screen ';
  renderMixer();
  renderBus();
  live.forEach(fitTile);
}
async function toggleFullscreen() {
  const on = !document.body.classList.contains('fs');
  try {
    if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // The browser said no (some don't allow it): use the layout anyway.
  }
  setFullscreenUi(on);
  announce(on ? 'Full screen control room' : 'Left full screen');
}
$('#fsBtn').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && document.body.classList.contains('fs')) setFullscreenUi(false);
});

// The switcher bus: one big button per camera, red when on air, with its sound mode.
function renderBus() {
  if (!$('#bus')) return;
  const cams = camOrder();
  $('#bus').innerHTML = cams.length
    ? cams.map((peer) => {
        const l = live.get(peer);
        const n = angleOfCid(l.cid) || '?';
        const sc = scoreOfLive(l);
        return `<button type="button" class="busbtn${peer === liveActive && !onBreak() ? ' live' : ''}${sc != null && sc < 0.35 ? ' bad' : ''}" data-bus="${peer}" aria-pressed="${peer === liveActive && !onBreak()}" aria-label="Cut to camera ${n}, ${esc(l.name)}">
          <b>${n}</b><small>${esc(l.name)}</small><span class="aud" data-aud="${esc(l.cid || peer)}"></span></button>`;
      }).join('')
    : '<p class="fine" style="margin:0">No cameras yet.</p>';
  renderBusAudio();
}
function renderBusAudio() {
  document.querySelectorAll('.tile[data-peer] .aud').forEach((el) => {
    const peer = el.closest('[data-peer]').dataset.peer;
    const l = live.get(peer);
    if (l) el.textContent = `♪ ${MODE_LABEL[mixState(l.cid || peer, l.role).mode]}`;
  });
}
$('#bus')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bus]');
  if (b) cutLive(b.dataset.bus);
});

// ---- crew: messages to phones, a rundown with cues --------------------------------------
// Short messages go to one phone (the box under its tile) or all of them. Phones show
// a small banner with quick replies; the rundown shows as one line ("Now · Next").
// Messages ride the reliable link to each phone; nothing goes through the cloud.

const crew = { rundown: [], cue: -1, ended: false, cleared: false, ...JSON.parse(localStorage.getItem('vm_crew_' + eventId) || '{}') };
const saveCrew = () => localStorage.setItem('vm_crew_' + eventId, JSON.stringify({ rundown: crew.rundown, cue: crew.cue, ended: crew.ended, cleared: crew.cleared }));
const dmLast = new Map(); // peer → {id, text, status, reply}
const msgId = () => Math.random().toString(36).slice(2, 10);

function dmRow(peer, l, i) {
  let row = document.querySelector(`[data-dm="${CSS.escape(peer)}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'dmrow';
    row.dataset.dm = peer;
    row.innerHTML = `<input type="text" maxlength="140" aria-label="Message ${esc(l.name)}" placeholder="Message ${esc(l.name)}…"><button type="button">Send</button><span class="dmstat" aria-live="polite"></span>`;
    const input = row.querySelector('input');
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      if (sendDm(peer, text)) input.value = '';
    };
    row.querySelector('button').onclick = send;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    };
    (l.card || l.tile.parentNode).append(row);
  }
  renderDmStat(peer);
}

function renderDmStat(peer) {
  const st = document.querySelector(`[data-dm="${CSS.escape(peer)}"] .dmstat`);
  const d = dmLast.get(peer);
  if (!st) return;
  st.classList.toggle('reply', d?.status === 'reply');
  st.textContent = !d ? '' : d.status === 'reply' ? `↩ ${d.reply}` : `${d.status === 'seen' ? '✓✓ seen' : d.status === 'sent' ? '✓ sent' : '… not delivered'}: ${d.text}`;
}

function sendDm(peer, text, all = false) {
  const l = live.get(peer);
  const id = msgId();
  const ok = hub?.message(peer, { t: 'msg', id, text, all });
  dmLast.set(peer, { id, text, status: ok ? 'sent' : 'failed' });
  renderDmStat(peer);
  if (!all) note(`To ${l?.name}: ${text}`);
  if (!ok && !all) toast(`Couldn't reach ${l?.name} right now`);
  return ok;
}

$('#dmAllBtn').onclick = () => {
  const text = $('#dmAll').value.trim();
  if (!text) return;
  const cams = camOrder();
  if (!cams.length) return toast('No cameras connected');
  const n = cams.filter((p) => sendDm(p, text, true)).length;
  note(`To all cameras: ${text}`);
  toast(`Sent to ${n} of ${cams.length} camera${cams.length > 1 ? 's' : ''}`);
  $('#dmAll').value = '';
};
$('#dmAll').onkeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#dmAllBtn').click();
  }
};

function crewHeard(peer, m) {
  const l = live.get(peer);
  const d = dmLast.get(peer);
  if (m.t === 'seen' && d && d.id === m.id && d.status !== 'reply') d.status = 'seen';
  if (m.t === 'reply') {
    if (d && d.id === m.id) Object.assign(d, { status: 'reply', reply: m.text });
    else dmLast.set(peer, { id: m.id, text: '', status: 'reply', reply: m.text });
    note(`${l?.name}: ${m.text}`);
    toast(`${l?.name}: ${m.text}`);
    announce(`${l?.name} replied: ${m.text}`);
  }
  renderDmStat(peer);
}

function broadcast(obj) {
  for (const peer of live.keys()) hub?.message(peer, obj);
}
/** The rundown as phones get it. An ended one comes off their screens but they keep it (and where it got to). */
const rundownMsg = () => ({ t: 'rundown', items: crew.rundown, cue: crew.ended ? -1 : crew.cue, last: crew.cue, ended: !!crew.ended });
function renderCueState() {
  const now = crew.rundown[crew.cue];
  const next = crew.rundown[crew.cue + 1];
  $('#cueState').textContent = !crew.rundown.length ? 'No rundown yet. Phones show the current item as one small line.'
    : crew.ended ? "Rundown ended: it's off the cameras. ◀ Prev or Next ▶ picks it back up; Send starts a new one."
    : now ? `Now: ${now}${next ? ` · Next: ${next}` : ' · last item (Next ▶ ends the rundown)'}` : `${crew.rundown.length} items sent. Press Next ▶ (or ]) to cue the first.`;
  $('#rundownEnd').disabled = !crew.rundown.length || !!crew.ended;
}
$('#rundownText').value = crew.rundown.join('\n');
renderCueState();
$('#rundownSend').onclick = () => {
  crew.rundown = $('#rundownText').value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40);
  crew.cue = Math.min(crew.cue, crew.rundown.length - 1);
  crew.ended = false;
  crew.cleared = !crew.rundown.length;
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note(`Rundown sent (${crew.rundown.length} items)`);
  toast(`Rundown sent to ${live.size} phone${live.size === 1 ? '' : 's'}`);
};
function stepCue(d) {
  if (!crew.rundown.length) return toast('Send a rundown first');
  if (crew.ended) {
    // picking an ended rundown back up, at the item it ended on
    crew.ended = false;
    crew.cue = Math.max(0, crew.cue);
  } else if (d > 0 && crew.cue >= crew.rundown.length - 1) return endRundown();
  else crew.cue = Math.max(-1, Math.min(crew.rundown.length - 1, crew.cue + d));
  saveCrew();
  broadcast({ t: 'cue', i: crew.cue });
  renderCueState();
  if (crew.rundown[crew.cue]) {
    note(`Cue: ${crew.rundown[crew.cue]}`);
    announce(`Cue: ${crew.rundown[crew.cue]}`);
  }
}
$('#cuePrev').onclick = () => stepCue(-1);
$('#cueNext').onclick = () => stepCue(1);

/** The show's past the last item (or off script): take the rundown off every camera. */
function endRundown() {
  if (!isHost || !crew.rundown.length || crew.ended) return;
  crew.ended = true;
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note('Rundown ended: off the cameras');
  toast("Rundown ended. It's off the cameras.");
  announce('Rundown ended');
}
function clearRundown() {
  if (!isHost) return;
  if ((crew.rundown.length || $('#rundownText').value.trim()) && !confirm('Clear the rundown? It comes off every camera and the list here is emptied.')) return;
  Object.assign(crew, { rundown: [], cue: -1, ended: false, cleared: true });
  $('#rundownText').value = '';
  saveCrew();
  broadcast(rundownMsg());
  renderCueState();
  note('Rundown cleared');
  toast('Rundown cleared from every camera');
  announce('Rundown cleared');
}
$('#rundownEnd').onclick = endRundown;
$('#rundownClear').onclick = clearRundown;

/** A phone that just joined gets the rundown, current cue and output shape (once its link opens). */
function welcomePhone(peer, tries = 0) {
  const ok = hub?.message(peer, { t: 'output', orientation });
  if (!ok) {
    if (tries < 15 && live.has(peer)) setTimeout(() => welcomePhone(peer, tries + 1), 1000);
    return;
  }
  // (after a Clear, a phone that missed it still has the old one, so it hears about that too)
  if (crew.rundown.length || crew.cleared) hub.message(peer, rundownMsg());
}

// ---- moments: mark the crazy stuff live, make clips of it later ---------------------------
const media = new MediaLibrary(eventId);
function markMoment() {
  if (!isHost) return;
  const m = media.addMoment(now() - LIVE_DELAY);
  note(`Marked ${m.label}`);
  toast(`${m.label} marked. Rename it under Moments.`);
  announce(`${m.label} marked`);
  renderMoments();
  if (mode === 'edit') renderMedia();
}
$('#markBtn').onclick = markMoment;

// The Moments list (Live): rename in place, × to delete. Newest first.
function renderMoments() {
  const box = $('#momList');
  if (document.activeElement?.matches?.('#momList input')) return; // don't pull the text box out from under someone typing (it re-renders on change)
  const list = media.moments.slice().reverse();
  $('#momEmpty').hidden = !!list.length;
  box.hidden = !list.length;
  box.innerHTML = list.map((m) => `<li data-mo="${esc(m.id)}"><time>${fmtClock(m.t)}</time><input type="text" maxlength="60" value="${esc(m.label)}" aria-label="Name of the moment at ${fmtClock(m.t)}" title="Click to rename"><button type="button" class="ltx" data-momdel aria-label="Delete ${esc(m.label)}" title="Delete">×</button></li>`).join('');
}
function momentsChanged() {
  renderMoments();
  renderMedia();
  renderTimeline();
  if (mediaSel?.kind === 'moment') renderMediaInsp();
}
function renameMoment(id, label) {
  const m = media.moments.find((x) => x.id === id);
  const v = String(label || '').trim().slice(0, 60);
  if (!m || !v || v === m.label) return false;
  const was = m.label;
  media.updateMoment(id, { label: v });
  note(`Renamed ${was} to ${v}`);
  announce(`Renamed to ${v}`);
  momentsChanged();
  return true;
}
function deleteMoment(id) {
  const m = media.moments.find((x) => x.id === id);
  if (!m) return;
  media.removeMoment(id);
  if (mediaSel?.kind === 'moment' && mediaSel.id === id) mediaSel = null;
  momentsChanged();
  note(`Deleted ${m.label}`);
  toast(`Deleted ${m.label}`);
  announce(`Deleted ${m.label}`);
}
function clipsOfMoment(id) {
  const mo = media.moments.find((x) => x.id === id);
  if (!mo) return;
  const made = media.clipsFromMoment(id, clips.map((c) => c));
  mediaFilter = 'subclip';
  renderMedia();
  toast(made.length ? `Made ${made.length} clip${made.length === 1 ? '' : 's'} of ${mo.label}` : `No camera was recording at ${mo.label}`);
  note(`Made ${made.length} clips of ${mo.label}`);
}
$('#momList').addEventListener('change', (e) => {
  const li = e.target.closest('[data-mo]');
  if (!li || !e.target.matches('input')) return;
  if (!renameMoment(li.dataset.mo, e.target.value)) e.target.value = media.moments.find((x) => x.id === li.dataset.mo)?.label || '';
  setTimeout(renderMoments);
});
$('#momList').addEventListener('keydown', (e) => {
  if (!e.target.matches('input')) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.target.value = media.moments.find((x) => x.id === e.target.closest('[data-mo]').dataset.mo)?.label || '';
    e.target.blur();
  }
});
$('#momList').addEventListener('focusout', () => setTimeout(renderMoments));
$('#momList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-momdel]');
  if (b) deleteMoment(b.closest('[data-mo]').dataset.mo);
});

// ---- break slate --------------------------------------------------------------------

let breakManual = false;
let autoBreak = false;
let everLive = false;
const onBreak = () => breakManual || autoBreak || directorBreak;

function activeFrameOk() {
  const l = live.get(liveActive);
  if (l?.role === 'mic') return !!l.stream?.getAudioTracks().some((t) => t.readyState === 'live');
  const v = l?.video;
  if (!v || v.readyState < 2 || !v.videoWidth) return false;
  const track = l.stream.getVideoTracks()[0];
  if (!track || track.readyState === 'ended' || track.muted) return false;
  const t = v.currentTime;
  if (t !== l.lastTime) {
    l.lastTime = t;
    l.lastMove = performance.now();
  }
  return performance.now() - (l.lastMove || performance.now()) < STALL_MS;
}

function updateAutoBreak() {
  if (liveActive) everLive = true;
  if (mediaOn) {
    // a clip is on air: a camera hiccup underneath doesn't matter
    if (autoBreak) {
      autoBreak = false;
      syncBreakUi();
    }
    return;
  }
  // A podcast is microphones: with no camera to show, an open microphone is what's on air
  // (its sound and its picture), so there's no "dropped" to cover with the break slate.
  const camUp = camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; });
  const soundOnly = !camUp && micPeers().some((p) => mixState(live.get(p).cid || p, 'mic').mode !== 'off');
  if (!camUp && soundOnly && (!liveActive || !activeFrameOk())) {
    const mic = loudestMic();
    if (mic && mic !== liveActive && !breakManual) cutLive(mic, 'sound only');
  }
  const ok = (liveActive && activeFrameOk()) || soundOnly;
  const wasAuto = autoBreak;
  if (!$('#autoSlate').checked) autoBreak = false;
  else if (!ok && everLive) autoBreak = true;
  else if (ok) autoBreak = false;
  if (!liveActive && lastLive && live.has(lastLive) && !breakManual) {
    if (live.get(lastLive).role === 'mic' || live.get(lastLive).video?.readyState >= 2) {
      liveActive = lastLive;
      renderLive();
    }
  }
  if (wasAuto !== autoBreak) {
    syncBreakUi();
    mixFollowCut();
    note(autoBreak ? 'Camera dropped — break slate on air' : 'Back on camera');
    announce(autoBreak ? 'Camera dropped. Break slate is on air.' : 'Back on camera');
  }
}

function syncBreakUi() {
  $('#slateTag').hidden = !onBreak();
  $('#slateTag').textContent = breakManual ? 'BREAK' : 'AUTO BREAK';
  syncTally();
  renderLive();
}

function toggleBreak() {
  setBreak(!breakManual);
}
function setBreak(on) {
  if (!isHost || on === breakManual) return;
  breakManual = on;
  if (!breakManual && !liveActive && lastLive && live.has(lastLive)) liveActive = lastLive;
  syncBreakUi();
  mixFollowCut();
  if (breakManual) blackHint();
  note(breakManual ? 'Break called' : 'Break over');
  announce(breakManual ? 'Break slate on air' : 'Break over');
}

// ---- black: cut or fade the whole program to black, picture and sound ---------------------
// Like a vision mixer's FTB: a layer over everything (the program recording and Program out
// go black too). Once it's fully black the lower third, any clip and the break come off, so
// coming back up lands on the camera you were on.
$('#ftbTime').value = localStorage.getItem('vm_ftb_ms') || '1000';
$('#ftbTime').onchange = (e) => localStorage.setItem('vm_ftb_ms', e.target.value);
const ftbMs = () => +$('#ftbTime').value || 1000;
function blackLevel() {
  // the T-bar fading to black, or up from it
  if (swActive() && sw.toSpecial === 'black') return sw.p;
  if (swActive() && sw.fromSpecial === 'black') return 1 - sw.p;
  if (!black.dur) return black.target;
  const k = Math.min(1, Math.max(0, (performance.now() - black.start) / black.dur));
  return black.from + (black.target - black.from) * k;
}
/** `took`: the T-bar (or AUTO) already faded it over this many ms; it only needs to land. */
function toggleBlack(fade, took = 0) {
  if (!isHost || mode !== 'live') return;
  const on = black.target !== 1;
  const dur = took ? 0 : fade ? ftbMs() : 0;
  Object.assign(black, { from: took ? (on ? 1 : 0) : blackLevel(), target: on ? 1 : 0, start: performance.now(), dur, cleared: !on });
  mixInit();
  const gn = mix.ftb.gain, t0 = player.ctx.currentTime;
  gn.cancelScheduledValues(t0);
  gn.setValueAtTime(1 - black.from, t0);
  if (dur) gn.linearRampToValueAtTime(on ? 0 : 1, t0 + dur / 1000);
  else gn.setValueAtTime(on ? 0 : 1, t0);
  const fadeMs = took || dur;
  player.ctx.resume();
  if (!on && !liveActive && lastLive && live.has(lastLive) && !breakManual) liveActive = lastLive;
  // the live cut keeps the fade: to black (the shot before fades out in Edit), and back (the next fades in)
  if (cut?.edl) {
    const t = now() - LIVE_DELAY, l = live.get(liveActive);
    if (on) cut.edl.push({ t: t + dur, black: true, fade: fadeMs }); // (black from when the fade ends: the shot fades out to it)
    else if (l?.cid && l.role !== 'mic' && !mediaOn) cut.edl.push({ t: t - took, cid: l.cid, fadeIn: fadeMs });
    saveCut();
  }
  // coming up from black starts the recording (with "Record the program with the fades", or on autopilot)
  if (!on && (recFades() || ap?.on) && !progRec) {
    toggleProgramRecording();
    note('Recording the program (it came up from black)');
  }
  syncBlackUi();
  syncTally();
  renderLive();
  if (took) fade = true;
  note(on ? (fade ? 'Fade to black' : 'Cut to black') : fade ? 'Fade up from black' : 'Cut up from black');
  announce(on ? (fade ? 'Fading to black' : 'Black') : 'Back from black');
}
function syncBlackUi() {
  const on = black.target === 1;
  $('#ftbBtn').setAttribute('aria-pressed', String(on));
  if ($('#ftbBtn').firstChild) $('#ftbBtn').firstChild.textContent = on ? 'Fade up ' : 'Fade to black ';
  renderSpecials();
}
/** Fully black: take everything else off air. */
function atBlack() {
  black.cleared = true;
  localRecFollow(); // (at black nothing's on air: this computer's cameras stop recording, 5 s on)
  // ...and a fade to black ends the recording (with "Record the program with the fades", or on autopilot)
  if ((recFades() || ap?.on) && progRec) {
    if (ap) ap.handsFree = ap.on;
    toggleProgramRecording();
    note('Recording stopped (the program faded to black)');
  }
  if (ap?.state === 'ending') apIdle();
  else if (ap?.state === 'stopping') {
    ap.state = 'ended';
    note('The show was ended by hand');
  }
  const off = [];
  if (lt.on) {
    lt.on = false;
    lt.off = 0;
    ltUi(false);
    off.push('lower third');
  }
  if (mediaOn) {
    stopMedia(false);
    off.push('clip');
  }
  if (breakManual) {
    breakManual = false;
    if (!liveActive && lastLive && live.has(lastLive)) liveActive = lastLive;
    syncBreakUi();
    off.push('break');
  }
  note(`Program is black${off.length ? ` (took the ${off.join(', ')} off air)` : ''}`);
}
function drawBlack(g, W, H) {
  const a = blackLevel();
  if (a > 0) {
    g.save();
    g.globalAlpha = Math.min(1, a);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.restore();
  }
  if (black.target === 1 && a >= 1 && !black.cleared) atBlack();
  const showing = a > 0.001 || black.target === 1;
  $('#progLabel').classList.toggle('black', showing);
  $('#progFrame').classList.toggle('black', a >= 1);
  const down = swActive() && (sw.toSpecial === 'black' || sw.fromSpecial === 'black') ? sw.toSpecial === 'black' : black.target === 1; // (the T-bar's way, while it's moving)
  if (showing) $('#progLabel').textContent = a >= 1 ? 'BLACK' : down ? 'FADING TO BLACK' : 'FADING UP';
}
let blackHintAt = 0;
function blackHint() {
  if (black.target !== 1 || performance.now() - blackHintAt < 4000) return;
  blackHintAt = performance.now();
  toast('The program is black. Press X to fade up (Shift+X to cut up).', 4000);
}
$('#ftbBtn').onclick = () => toggleBlack(true);

// Media reel: sponsor spots for breaks, and images for the edit.
const reel = [];
function addReel(r, persist = true) {
  const item = { ...r, url: URL.createObjectURL(r.blob) };
  if (r.type.startsWith('video/')) {
    item.el = document.createElement('video');
    item.el.muted = true;
    item.el.loop = true;
    item.el.playsInline = true;
    item.el.src = item.url;
  } else {
    item.el = new Image();
    item.el.src = item.url;
  }
  reel.push(item);
  if (persist) idb.put('reel', { eventId, id: r.id, name: r.name, link: r.link || '', type: r.type, blob: r.blob, loop: !!r.loop });
  renderReel();
  renderClips();
  if (typeof mixRows !== 'undefined') renderMixer();
  return item;
}
function renderReel() {
  $('#reel').innerHTML = reel
    .map((r, i) => `<li><${r.type.startsWith('video/') ? 'video muted' : 'img alt=""'} src="${r.url}"></${r.type.startsWith('video/') ? 'video' : 'img'}>
      <input type="text" value="${esc(r.name)}" data-i="${i}" aria-label="Sponsor name for reel item ${i + 1}" placeholder="Sponsor name">
      <button type="button" data-rm="${i}" aria-label="Remove reel item ${i + 1}">Remove</button></li>`)
    .join('');
}
const fileToReel = (f) => addReel({ id: Math.random().toString(36).slice(2, 12), name: f.name.replace(/\.[^.]+$/, ''), type: f.type, blob: f });
$('#reelFiles').onchange = (e) => {
  for (const f of e.target.files) fileToReel(f);
  e.target.value = '';
};
$('#reel').addEventListener('change', (e) => {
  const i = e.target.dataset.i;
  if (i === undefined) return;
  reel[i].name = e.target.value;
  idb.patch('reel', eventId, reel[i].id, { name: e.target.value });
});
$('#reel').addEventListener('click', (e) => {
  const i = e.target.dataset.rm;
  if (i === undefined) return;
  const [r] = reel.splice(+i, 1);
  idb.remove('reel', eventId, r.id);
  renderReel();
});

// ---- clips: b-roll, commercials, logos — always ready in the Sources panel -----------------
// Each clip loops silently in its tile, so you can see it's ready. Click to put it on air
// (from the top, with its sound on the Clips strip). Loop keeps it going until you cut
// away; otherwise it plays once and returns to the camera you were on.
let mediaOn = null; // {id}
// A clip that airs goes into Edit where it aired: a cut to it in the live cut, and a copy of
// its file placed at that time (one per time round, if it loops). Stills aren't in Edit yet.
let mediaAir = null; // { id, t (when the clip's start aired, on the cameras' clock), cid }
async function finishMediaAir() {
  const a = mediaAir;
  mediaAir = null;
  const r = a && reelOf(a.id);
  if (!r?.type.startsWith('video/') || !r.blob) return;
  const end = now() - LIVE_DELAY;
  if (end - a.t < 300) return;
  const fileDur = r.prog && Number.isFinite(r.prog.duration) && r.prog.duration > 0 ? r.prog.duration * 1000 : end - a.t;
  for (let t = a.t, k = 0; t < end - 100 && k < 60; t += fileDur, k++) {
    const meta = {
      id: `R${a.id}-${Math.round(a.t)}-${k}`, kind: 'video', mime: r.type, cid: a.cid, name: r.name, t0: Math.round(t), dur: Math.round(Math.min(fileDur, end - t)),
      w: r.prog?.videoWidth || 0, h: r.prog?.videoHeight || 0, local: true, reel: true, t0Source: 'studio', native: true, audio: 'stereo',
      orient: [{ t: 0, rot: 0, rect: null, upright: (r.prog?.videoWidth || 16) >= (r.prog?.videoHeight || 9) ? 'landscape' : 'portrait', ev: 0, ct: 0 }],
    };
    const rec = { eventId, ...meta, receivedAt: Date.now() };
    await idb.put('clips', { ...rec, blob: r.blob }).catch(() => {});
    addClip(rec, r.blob, true);
  }
}
function startMediaAir(r, at, dissolveMs) {
  if (mediaAir) finishMediaAir();
  if (!r.type.startsWith('video/')) return;
  const cid = `REEL-${r.id}-${Math.round(now())}`;
  mediaAir = { id: r.id, t: now() - LIVE_DELAY - (r.prog?.currentTime || 0) * 1000, cid };
  snapshot();
  cut.edl.push({ t: (at ?? now()) - LIVE_DELAY, cid, ...(dissolveMs >= 40 ? { dissolve: Math.round(dissolveMs) } : {}) });
  saveCut();
}
function renderClips() {
  const box = $('#clips');
  if (!box) return;
  $('#clipsEmpty').hidden = reel.length > 0;
  for (const r of reel) {
    let card = box.querySelector(`[data-card="${r.id}"]`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'clipcard';
      card.dataset.card = r.id;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile media';
      tile.dataset.media = r.id;
      const preview = r.type.startsWith('video/') ? Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, autoplay: true, src: r.url }) : Object.assign(new Image(), { src: r.url, alt: '' });
      tile.append(preview);
      tile.insertAdjacentHTML('beforeend', `<span class="who"></span><span class="kind"></span><i class="prog" aria-hidden="true"></i>`);
      tile.onclick = () => takeClip(r.id);
      card.append(tile);
      card.insertAdjacentHTML('beforeend', `<div class="clipctl">${r.type.startsWith('video/') ? '<button type="button" data-loop aria-pressed="false" title="Loop until you cut away, or play once and go back to the camera">Loop</button>' : ''}<button type="button" data-rmclip aria-label="Remove ${esc(r.name)}">Remove</button></div>`);
      card.querySelector('[data-loop]')?.addEventListener('click', () => {
        r.loop = !r.loop;
        if (r.prog) r.prog.loop = r.loop;
        idb.patch('reel', eventId, r.id, { loop: r.loop });
        renderClips();
      });
      card.querySelector('[data-rmclip]').addEventListener('click', () => {
        if (mediaOn?.id === r.id) stopMedia(true);
        if (pvwClip === r.id) setPreviewClip(null);
        reel.splice(reel.indexOf(r), 1);
        idb.remove('reel', eventId, r.id);
        card.remove();
        renderReel();
        renderClips();
        renderMixer();
      });
      box.append(card);
      preview.play?.().catch(() => {});
    }
    const tile = card.querySelector('.tile');
    tile.querySelector('.who').textContent = r.name;
    tile.querySelector('.kind').textContent = r.type.startsWith('video/') ? (r.loop ? 'LOOP' : 'ONCE') : 'STILL';
    tile.classList.toggle('live', mediaOn?.id === r.id && !onBreak());
    tile.classList.toggle('pvw', pvwClip === r.id);
    tile.setAttribute('aria-label', `${tapMode === 'preview' ? 'Cue' : 'Put'} ${r.name} ${tapMode === 'preview' ? 'in preview' : 'on air'}${mediaOn?.id === r.id ? ' (on air now)' : pvwClip === r.id ? ' (in preview, cued at the start)' : ''}`);
    card.querySelector('[data-loop]')?.setAttribute('aria-pressed', String(!!r.loop));
  }
  for (const card of box.querySelectorAll('[data-card]')) if (!reel.some((r) => r.id === card.dataset.card)) card.remove();
}

/** A clip's on-air player: it plays with sound, through the Clips strip of the mixer. */
function ensureProg(r) {
  if (r.prog || !r.type.startsWith('video/')) return r.prog;
  r.prog = Object.assign(document.createElement('video'), { playsInline: true, preload: 'auto', src: r.url });
  mixInit();
  player.ctx.createMediaElementSource(r.prog).connect(mix.media.mono);
  r.prog.addEventListener('ended', () => {
    if (mediaOn?.id === r.id && !r.loop) stopMedia(true);
  });
  return r.prog;
}
function cutMedia(id, opts = {}) {
  if (!isHost) return;
  const r = reel.find((x) => x.id === id);
  if (!r) return;
  breakManual = false;
  directorBreak = false;
  if (pvwClip === id) pvwClip = null;
  if (r.type.startsWith('video/')) {
    ensureProg(r);
    r.prog.loop = !!r.loop;
    r.prog.volume = 1;
    player.ctx.resume();
    if (!opts.playing) {
      r.prog.currentTime = 0;
      r.prog.play().catch(() => {});
    } else if (r.prog.paused) r.prog.play().catch(() => {});
  }
  if (mediaOn && mediaOn.id !== id) reel.find((x) => x.id === mediaOn.id)?.prog?.pause();
  if (mediaOn?.id !== id) startMediaAir(r, opts.at, opts.dissolveMs);
  mediaOn = { id };
  mixGates();
  syncBreakUi();
  syncTally();
  renderClips();
  renderLive();
  note(`Clip on air: ${r.name}${r.type.startsWith('video/') ? (r.loop ? ' (loop)' : ' (plays once)') : ''}`);
  announce(`${r.name} on air`);
}

/** Take the clip off air; if it ended by itself, go back to the camera we were on. */
function stopMedia(returnToCamera = false) {
  const r = mediaOn && reel.find((x) => x.id === mediaOn.id);
  r?.prog?.pause();
  mediaOn = null;
  finishMediaAir();
  // back to the camera under it: the live cut says so from here
  if (liveActive && live.get(liveActive)?.cid && live.get(liveActive).role !== 'mic') {
    cut.edl.push({ t: now() - LIVE_DELAY, cid: live.get(liveActive).cid });
    saveCut();
  }
  if (returnToCamera && liveActive && live.has(liveActive)) {
    director.set(liveActive, Date.now());
    note(`Clip finished: back to camera ${angleOfCid(live.get(liveActive).cid)}`);
    announce('Back to camera');
  }
  mixGates();
  syncTally();
  renderClips();
  renderLive();
}

$('#clipFiles').onchange = (e) => {
  for (const f of e.target.files) fileToReel(f);
  e.target.value = '';
};

// ---- a live lower third: type it, show it, it fades in and out --------------------------
const lt = { on: false, at: 0, off: 0, text: '', sub: '' };
let ltRecent = JSON.parse(localStorage.getItem('vm_lt_' + eventId) || '[]');
let ltEditing = null; // the saved one loaded for editing: showing the edit replaces it
const saveLt = () => localStorage.setItem('vm_lt_' + eventId, JSON.stringify(ltRecent));
const ltShowing = () => lt.on && (!lt.off || performance.now() < lt.off);
function renderLtRecent() {
  const on = ltShowing();
  $('#ltRecent').innerHTML = ltRecent.map((x, i) => {
    const what = `${esc(x.text)}${x.sub ? ' · ' + esc(x.sub) : ''}`;
    const isOn = on && x.text === lt.text && (x.sub || '') === lt.sub;
    return `<span class="ltpill${isOn ? ' on' : ''}"><button type="button" data-lt="${i}" title="Show: ${what} (right-click to edit it without showing it)">${esc(x.text)}</button><button type="button" class="ltx" data-ltdel="${i}" aria-label="Delete the lower third ${what}" title="Delete">×</button></span>`;
  }).join('');
}
function ltUi(on) {
  $('#ltShow').setAttribute('aria-pressed', String(on));
  if ($('#ltShow').firstChild) $('#ltShow').firstChild.textContent = on ? 'Hide ' : 'Show ';
  renderLtRecent();
}
function showLowerThird(on) {
  if (on) {
    const text = $('#ltText').value.trim(), sub = $('#ltSub').value.trim();
    if (!text) {
      $('#ltText').focus();
      return toast('Type a name or headline first');
    }
    Object.assign(lt, { on: true, at: performance.now(), off: $('#ltAuto').checked ? performance.now() + 8000 : 0, text, sub });
    const same = (x, y) => y && x.text === y.text && (x.sub || '') === (y.sub || '');
    ltRecent = [{ text, sub }, ...ltRecent.filter((x) => !same(x, { text, sub }) && !same(x, ltEditing))].slice(0, 16);
    ltEditing = null;
    saveLt();
    note(`Lower third: ${text}${sub ? ' · ' + sub : ''}`);
    blackHint();
  } else if (lt.on) {
    lt.off = performance.now();
  }
  ltUi(on);
  announce(on ? 'Lower third on' : 'Lower third off');
}
$('#ltShow').onclick = () => showLowerThird(!ltShowing());
function loadLt(i, editing = false) {
  const x = ltRecent[i];
  if (!x) return;
  $('#ltText').value = x.text;
  $('#ltSub').value = x.sub || '';
  ltEditing = editing ? { ...x } : null;
}
function deleteLt(i) {
  const x = ltRecent[i];
  if (!x) return;
  ltRecent.splice(i, 1);
  saveLt();
  renderLtRecent();
  note(`Deleted the lower third ${x.text}`);
  announce(`Deleted ${x.text}`);
  ($('#ltRecent').querySelectorAll('[data-ltdel]')[Math.min(i, ltRecent.length - 1)] || $('#ltText')).focus();
}
$('#ltRecent').addEventListener('click', (e) => {
  const del = e.target.closest('[data-ltdel]');
  if (del) return deleteLt(+del.dataset.ltdel);
  const b = e.target.closest('[data-lt]');
  if (!b) return;
  loadLt(+b.dataset.lt);
  showLowerThird(true);
});
$('#ltRecent').addEventListener('contextmenu', (e) => {
  const b = e.target.closest('[data-lt], [data-ltdel]');
  if (!b) return;
  e.preventDefault();
  const i = +(b.dataset.lt ?? b.dataset.ltdel);
  const x = ltRecent[i];
  if (!x) return;
  openMenu(e.clientX, e.clientY, [
    { label: 'Show it now', action: () => { loadLt(i); showLowerThird(true); } },
    { label: 'Edit it (not on air)', action: () => { loadLt(i, true); $('#ltText').focus(); } },
    { sep: true },
    { label: 'Delete', action: () => deleteLt(i) },
  ], x.text);
});
renderLtRecent();
function drawLowerThird(g, W, H) {
  if (!lt.on) return;
  const t = performance.now();
  const FADE = 300;
  let a = Math.min(1, (t - lt.at) / FADE);
  if (lt.off) a = Math.min(a, (lt.off - t) / FADE + 1);
  if (lt.off && t >= lt.off + FADE) {
    lt.on = false;
    ltUi(false);
    return;
  }
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, a));
  drawTitle(g, W, H, { style: 'lower', text: lt.text, sub: lt.sub });
  g.restore();
}

function drawReelItem(g, W, H, item) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  drawFramed(g, item.el, W, H, 'fit');
  if (item.name) {
    g.font = `700 ${Math.round(H * 0.028)}px Archivo, system-ui, sans-serif`;
    const label = `Presented by ${item.name}`;
    const tw = g.measureText(label).width;
    g.fillStyle = '#000b';
    g.fillRect(16, H - 16 - H * 0.055, tw + 28, H * 0.055);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(label, 30, H - 16 - H * 0.0275);
  }
}

// ---- the break slate: its look, a preview, and (if you want it) its sound ----------------
$('#slateLook').innerHTML = SLATE_LOOKS.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('');
let slateLook = localStorage.getItem('vm_slatelook_' + eventId) || localStorage.getItem('vm_slatelook_default') || 'bars';
// Breaks go in the live cut: the slate (what it said, its look) from when the break began,
// and the camera again when it ended. In Edit each break is its own item.
// (A break goes in once it has lasted 1.5 s, and ends once it has been off 1 s: a flicker,
// a frame or two late on a busy computer, isn't a break, and doesn't flood the live cut.)
let edlBreak = false, brkChange = 0, brkSeen = false;
setInterval(() => {
  if (!isHost || !cut?.edl || EDIT_ONLY) return;
  const on = onBreak() && black.target !== 1;
  if (on !== brkSeen) {
    brkSeen = on;
    brkChange = performance.now();
  }
  if (on === edlBreak || performance.now() - brkChange < (on ? 1500 : 1000)) return;
  edlBreak = on;
  const t = now() - LIVE_DELAY - (on ? 1500 : 1000); // (from when it really began or ended)
  if (on) cut.edl.push({ t, slate: { ...slateText(), look: slateLook } });
  else {
    const l = live.get(liveActive);
    if (mediaOn || !l?.cid || l.role === 'mic') return;
    cut.edl.push({ t, cid: l.cid });
  }
  saveCut();
}, 250);
if (!SLATE_LOOKS.some(([id]) => id === slateLook)) slateLook = 'bars';
$('#slateLook').value = slateLook;
$('#slateLook').onchange = (e) => {
  slateLook = e.target.value;
  localStorage.setItem('vm_slatelook_' + eventId, slateLook);
  localStorage.setItem('vm_slatelook_default', slateLook);
  note(`Break slate look: ${slateLookName(slateLook)}`);
};
$('#slateSound').checked = localStorage.getItem('vm_slatesound') === '1';
$('#slateSound').onchange = (e) => localStorage.setItem('vm_slatesound', e.target.checked ? '1' : '0');
const slateText = () => ({ message: $('#slateMsg').value || "We'll be right back", title: ev?.title || '', brand: BRAND.name });
let slatePrevAt = 0;
function drawSlatePreview() {
  if (document.hidden || stalled() || performance.now() - slatePrevAt < 100) return; // (nobody can see it)
  slatePrevAt = performance.now();
  const c = $('#slatePrev');
  if (!c || c.offsetParent === null) return;
  const [w, h] = orientation === 'portrait' ? [180, 320] : [320, 180];
  if (c.width !== w || c.height !== h) Object.assign(c, { width: w, height: h });
  drawSlate(c.getContext('2d'), w, h, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
}
// Slate sound: the 1 kHz line-up tone with bars, hiss with static. Into the program mix
// (so it's recorded and fades with black); only while the slate itself is on air.
const slateAudio = { cur: null };
function slateSound(showing) {
  const want = showing && $('#slateSound').checked ? SLATE_SOUND[slateLook] || null : null;
  if (want === slateAudio.cur) return;
  slateAudio.cur = want;
  if (!want && !slateAudio.out) return;
  if (!slateAudio.out) {
    mixInit();
    const ctx = player.ctx;
    const out = ctx.createGain();
    out.connect(mix.bus);
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    const tone = ctx.createGain();
    tone.gain.value = 0;
    osc.connect(tone).connect(out);
    osc.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const hiss = ctx.createGain();
    hiss.gain.value = 0;
    src.connect(hp).connect(lp).connect(hiss).connect(out);
    src.start();
    Object.assign(slateAudio, { out, tone, hiss });
    ctx.resume();
  }
  const t = player.ctx.currentTime;
  slateAudio.tone.gain.setTargetAtTime(want === 'tone' ? 0.1 : 0, t, 0.015); // −20 dBFS, the broadcast line-up level
  slateAudio.hiss.gain.setTargetAtTime(want === 'hiss' ? 0.16 : 0, t, 0.015);
}

// ---- only microphones on air: a picture for the sound ------------------------------------
// With no camera picture to show and a microphone open, the program shows the sound itself:
// a rolling waveform, spectrum bars or a ring, with the event and who's talking.
const MIC_LOOKS = [['wave', 'Rolling waveform'], ['bars', 'Spectrum bars'], ['ring', 'Ring']];
$('#micLook').innerHTML = MIC_LOOKS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
let micLook = localStorage.getItem('vm_miclook') || 'wave';
$('#micLook').value = micLook;
$('#micLook').onchange = (e) => {
  micLook = e.target.value;
  localStorage.setItem('vm_miclook', micLook);
};
const micEnv = new Float32Array(180), micT = new Float32Array(4096), micF = new Float32Array(8192), micCaps = new Float32Array(64);
function micOnlyUp() {
  if (!mix.bus || !mix.meterL || !mix.spec) return false;
  if (camOrder().some((p) => { const l = live.get(p); return l && !l.paused && !l.overflow && l.video?.readyState >= 2; })) return false;
  for (const [peer, st] of mix.strips) if (live.get(peer)?.role === 'mic' && st.open) return true;
  return false;
}
const micNames = () => [...live.values()].filter((l) => l.role === 'mic').map((l) => l.name).join(' · ');
/** The sound as a picture: the program's (on air), or `o` one microphone's (an, spec, state, name). */
const programMic = { env: micEnv, at: 0, caps: micCaps };
function drawMicVisual(g, W, H, o = {}) {
  const u = Math.min(W, H), t = performance.now();
  const an = o.an || mix.meterL, sp = o.spec || mix.spec, st = o.state || programMic, env = st.env;
  const bg = g.createRadialGradient(W / 2, H * 0.45, u * 0.1, W / 2, H / 2, Math.hypot(W, H) * 0.6);
  bg.addColorStop(0, '#15203f');
  bg.addColorStop(1, '#04060c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (!an || !sp) return; // (no sound yet)
  const td = micT.subarray(0, an.fftSize);
  an.getFloatTimeDomainData(td);
  let ss = 0;
  for (let i = 0; i < td.length; i++) ss += td[i] * td[i];
  const lvl = Math.min(1, Math.sqrt(Math.sqrt(ss / td.length)) * 1.6);
  if (t - st.at > 50) {
    st.at = t;
    env.copyWithin(0, 1);
    env[env.length - 1] = lvl;
  }
  const grad = g.createLinearGradient(0, H * 0.22, 0, H * 0.78);
  grad.addColorStop(0, '#ff6b9a');
  grad.addColorStop(0.5, '#7b8cff');
  grad.addColorStop(1, '#3ad1c5');
  if (micLook === 'wave') {
    const n = env.length, x0 = W * 0.08, bw = (W * 0.84) / n, cy = H * 0.5, hmax = H * 0.27;
    g.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, env[i] * hmax);
      g.globalAlpha = 0.3 + 0.7 * (i / n);
      g.fillRect(x0 + i * bw + bw * 0.15, cy - h, bw * 0.7, h * 2);
    }
    g.globalAlpha = 1;
  } else {
    const fd = micF.subarray(0, sp.frequencyBinCount), ny = sp.context.sampleRate / 2, caps = st.caps;
    sp.getFloatFrequencyData(fd);
    const nb = micLook === 'ring' ? 64 : 48;
    const band = (i) => {
      const f0 = 60 * Math.pow(8000 / 60, i / nb), f1 = 60 * Math.pow(8000 / 60, (i + 1) / nb);
      let v = -140;
      for (let k = Math.floor((f0 / ny) * fd.length); k <= Math.ceil((f1 / ny) * fd.length) && k < fd.length; k++) v = Math.max(v, fd[k]);
      return Math.max(0, Math.min(1, (v + 95) / 70));
    };
    if (micLook === 'bars') {
      const x0 = W * 0.1, bw = (W * 0.8) / nb, base = H * 0.72, hmax = H * 0.46;
      for (let i = 0; i < nb; i++) {
        const v = band(i);
        caps[i] = Math.max(v, caps[i] - 0.012);
        g.fillStyle = grad;
        g.fillRect(x0 + i * bw + bw * 0.12, base - v * hmax, bw * 0.76, v * hmax);
        g.fillStyle = '#ffffffcc';
        g.fillRect(x0 + i * bw + bw * 0.12, base - caps[i] * hmax - 3, bw * 0.76, 3);
      }
    } else {
      const cx = W / 2, cy = H * 0.49, r0 = u * 0.16, rl = u * 0.16;
      g.strokeStyle = grad;
      g.lineCap = 'round';
      g.lineWidth = Math.max(2, ((2 * Math.PI * r0) / (nb * 2)) * 0.55);
      for (let i = 0; i < nb * 2; i++) {
        const v = band(i < nb ? i : 2 * nb - 1 - i), a = (i / (nb * 2)) * Math.PI * 2 - Math.PI / 2;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * (r0 + 4 + v * rl), cy + Math.sin(a) * (r0 + 4 + v * rl));
        g.stroke();
      }
      g.beginPath();
      g.arc(cx, cy, r0 * (0.84 + lvl * 0.12), 0, Math.PI * 2);
      g.fillStyle = '#ffffff12';
      g.fill();
    }
  }
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(u * 0.06)}px Archivo, system-ui, sans-serif`;
  g.fillText(ev?.title || '', W / 2, H * 0.12, W * 0.9);
  g.fillStyle = '#b9c2e6';
  g.font = `600 ${Math.round(u * 0.04)}px Archivo, system-ui, sans-serif`;
  g.fillText(`🎙 ${o.name ?? (liveActive && isMic(liveActive) ? live.get(liveActive).name : micNames())}`, W / 2, H * 0.87, W * 0.9);
  g.fillStyle = Math.floor(t / 600) % 2 ? '#e0362b77' : '#e0362b';
  g.beginPath();
  g.arc(W / 2 - u * 0.085, H * 0.2, u * 0.012, 0, Math.PI * 2);
  g.fill();
  g.textAlign = 'left';
  g.fillStyle = '#e8ebf5';
  g.font = `800 ${Math.round(u * 0.03)}px Archivo, system-ui, sans-serif`;
  g.fillText('LIVE AUDIO', W / 2 - u * 0.06, H * 0.2);
  g.textAlign = 'right';
  g.fillStyle = '#ffffffb0';
  g.font = `600 ${Math.round(Math.max(11, u * 0.024))}px Archivo, system-ui, sans-serif`;
  g.fillText(`Made with ${BRAND.name}`, W - 16, H - 18);
}

let slateClock = 0;
let playingReel = null;
/** Draws the break: the slate, alternating with the sponsor reel. True while the slate itself is up. */
function drawBreak(g, W, H) {
  const cycle = 6000 + reel.length * 8000;
  const pos = (performance.now() - slateClock) % cycle;
  if (pos < 6000 || !reel.length) {
    if (playingReel) { playingReel.el.pause?.(); playingReel = null; }
    drawSlate(g, W, H, { ...slateText(), look: slateLook, t: performance.now() - slateClock, now: now() });
    return true;
  }
  const item = reel[Math.floor((pos - 6000) / 8000)];
  if (playingReel !== item) {
    playingReel?.el.pause?.();
    playingReel = item;
    if (item.el.play) { item.el.currentTime = 0; item.el.play().catch(() => {}); }
  }
  drawReelItem(g, W, H, item);
  return false;
}

// ---- the live program -----------------------------------------------------------------

const pg = program.getContext('2d');
let wasBreak = false, slateLayer = null;
function drawLiveFrame() {
  if (mode !== 'live') return;
  updateAutoBreak();
  const W = program.width, H = program.height;
  if (onBreak() !== wasBreak) {
    wasBreak = onBreak();
    slateClock = performance.now();
  }
  const clip = mediaOn && reel.find((r) => r.id === mediaOn.id);
  let slateUp = false;
  const micAir = liveActive && isMic(liveActive) && !onBreak();
  if (!breakManual && !clip && (micAir || micOnlyUp())) {
    everLive = true;
    drawMicVisual(pg, W, H);
    $('#progLabel').textContent = micAir ? `ON AIR · MIC ${micKey(liveActive) || ''} ${live.get(liveActive).name}` : `ON AIR · MIC · ${micNames()}`;
  } else if (onBreak()) {
    slateUp = drawBreak(pg, W, H);
    $('#progLabel').textContent = 'ON AIR · BREAK';
  } else if (clip) {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    const el = clip.prog || clip.el;
    if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) drawFramed(pg, el, W, H, 'fit');
    const p = clip.prog && clip.prog.duration ? clip.prog.currentTime / clip.prog.duration : 0;
    $('#progLabel').textContent = `ON AIR · CLIP ${clip.name}${clip.prog && !clip.loop ? ` · ${Math.max(0, Math.ceil(clip.prog.duration - clip.prog.currentTime))} s` : ''}`;
    const bar = document.querySelector(`[data-media="${clip.id}"] .prog`);
    if (bar) bar.style.width = Math.round(p * 100) + '%';
  } else if (liveActive && activeFrameOk()) {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    drawFramed(pg, live.get(liveActive).video, W, H, fit, null, live.get(liveActive).view?.rect || null);
    $('#progLabel').textContent = `ON AIR · ${angleOfCid(live.get(liveActive).cid)} ${live.get(liveActive).name}`;
  } else if (!everLive) {
    drawSlate(pg, W, H, { message: 'Starting soon', title: ev?.title || '', brand: BRAND.name, look: slateLook, t: performance.now(), now: now() });
    $('#progLabel').textContent = live.size ? 'STANDBY · click a source' : 'STANDBY · waiting for phones';
  } else {
    pg.fillStyle = '#000';
    pg.fillRect(0, 0, W, H);
    $('#progLabel').textContent = 'ON AIR';
  }
  // a transition in progress: the incoming source over the outgoing one, by how far it's gone
  if (swActive() && sw.p > 0.001) {
    const b = live.get(sw.to), r = reelOf(sw.toClip);
    pg.globalAlpha = sw.fromSpecial === 'black' ? 1 : Math.min(1, sw.p); // (from black: the black lifts off it)
    if (sw.toSpecial === 'break' && sw.fromSpecial !== 'black') {
      const c = (slateLayer ||= document.createElement('canvas'));
      if (c.width !== W || c.height !== H) Object.assign(c, { width: W, height: H });
      drawSlate(c.getContext('2d'), W, H, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
      pg.drawImage(c, 0, 0);
    } else if (r) {
      const el = r.prog || r.el;
      if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) {
        pg.save();
        pg.globalAlpha = 1;
        pg.fillStyle = `rgba(0,0,0,${Math.min(1, sw.p)})`; // (behind the clip: black, so a letterboxed clip fades its bars in too)
        pg.fillRect(0, 0, W, H);
        pg.restore();
        drawFramed(pg, el, W, H, 'fit');
      }
    } else if (b && isMic(sw.to)) drawMicVisual(pg, W, H);
    else if (b?.video?.readyState >= 2) drawFramed(pg, b.video, W, H, fit, null, b.view?.rect || null);
    pg.globalAlpha = 1;
    const SPECIAL = { black: 'BLACK', break: 'BREAK' };
    const fromName = SPECIAL[sw.fromSpecial] || (sw.fromClip ? reelOf(sw.fromClip)?.name : live.get(liveActive)?.name);
    const toName = SPECIAL[sw.toSpecial] || (r ? r.name : b?.name);
    if (toName) $('#progLabel').textContent = `ON AIR · ${fromName || '—'} → ${toName} · ${Math.round(sw.p * 100)}%`;
  }
  drawLowerThird(pg, W, H);
  slateSound(slateUp);
  drawBlack(pg, W, H);
  drawSlatePreview();
  drawSourcePreviews();
  const clock = new Date(now()).toLocaleTimeString();
  $('#ptc').textContent = clock;
  $('#clock').textContent = clock;
}

// ---------------------------------------------------------------- switcher ---
// Preview and program, like a vision mixer. With "Tap: Preview", tapping a source (or its
// number) puts it in preview (green on the tile, the preview box, and the phone); CUT takes
// it straight to air, AUTO dissolves over the chosen time, and the T-bar dissolves by hand:
// push it from one end to the other. The bar glides (eased every frame, like the phones'
// zoom) so a mouse, a finger or a hardware fader (MIDI) gives a smooth dissolve, never steps.
// Once a source is on air, what was on air goes to preview (flip-flop). "Tap: Air" keeps the
// old way: tap a source and it's on air.
var pvw = null; // (var: drawing starts before this line runs)
var pvwClip = null; // a clip in preview (by id): cued, paused at its first frame
var pvwSpecial = null; // the break or black in preview ('break' | 'black')
// (toSpecial / fromSpecial: a dissolve to or from the break or black)
var sw = { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, target: 0, rest: 0, pos: 0, auto: null, midAt: null };
let tapMode = localStorage.getItem('vm_tapmode') === 'preview' ? 'preview' : 'air';
const swActive = () => !!(sw.to || sw.toClip || sw.toSpecial);
/** The break or black on air (taken by hand), if either is. */
const airSpecial = () => (black.target === 1 ? 'black' : breakManual ? 'break' : null);
/** Something covers the camera on air (a clip, the break, black): that camera can wait in preview. */
const airCovered = () => !!mediaOn || onBreak() || black.target === 1;
const inPreview = () => !!(pvw || pvwClip || pvwSpecial);
const reelOf = (id) => reel.find((x) => x.id === id);
function takeSource(peer) {
  if (tapMode === 'preview' && (peer !== liveActive || airCovered())) setPreview(peer);
  else cutLive(peer);
}
// The break and black are sources too: Tap: Preview puts one in preview, for CUT, AUTO or the
// T-bar (a fade to black as long as you like); Tap: Air, or tapping the one on air, cuts
// straight to it or back. B and Shift+X still cut, X still fades.
function takeSpecial(kind) {
  if (!isHost || mode !== 'live') return;
  const onAir = kind === 'black' ? black.target === 1 : breakManual;
  if (tapMode === 'preview' && !onAir) return setPreviewSpecial(kind);
  if (kind === 'black') toggleBlack(false);
  else toggleBreak();
}
function setPreviewSpecial(kind) {
  if (swActive()) return toast('Finish the transition first');
  pvw = null;
  pvwClip = null;
  pvwSpecial = kind;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
  announce(`Preview: ${kind === 'black' ? 'black' : 'the break'}`);
}
// Clips follow the switcher too: Tap: Preview cues a clip in preview, paused at its first
// frame; it starts playing as it goes on air (CUT) or as the dissolve to it begins.
function takeClip(id) {
  if (tapMode === 'preview' && mediaOn?.id !== id) setPreviewClip(id);
  else cutMedia(id);
}
/** The clip's on-air player, made if needed, wound back to the start and paused. */
function cueClip(r) {
  if (!r?.type.startsWith('video/')) return;
  ensureProg(r);
  r.prog.pause();
  r.prog.currentTime = 0;
  r.prog.volume = 1;
}
function setPreview(peer) {
  if (swActive()) return toast('Finish the transition first');
  pvw = peer && (peer !== liveActive || airCovered()) && live.has(peer) ? peer : null;
  if (pvw) pvwClip = pvwSpecial = null;
  if (!inPreview()) $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
  const l = live.get(pvw);
  if (l) announce(`Preview: ${l.name}`);
}
function clearPreview() {
  pvw = null;
  pvwClip = null;
  pvwSpecial = null;
  $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function setPreviewClip(id) {
  if (swActive()) return toast('Finish the transition first');
  const r = reelOf(id);
  pvwClip = r && mediaOn?.id !== id ? id : null;
  if (pvwClip) {
    pvw = pvwSpecial = null;
    cueClip(r);
    announce(`Preview: ${r.name}, cued at the start`);
  }
  if (!inPreview()) $('#pvwBox').hidden = true;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function startTransition() {
  if (!isHost) return false;
  const fromSpecial = airSpecial();
  if (pvwSpecial) {
    if (pvwSpecial === fromSpecial) return false;
    Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: null, toClip: null, toSpecial: pvwSpecial, midAt: null, began: performance.now(), startAt: now(), breakUnder: false });
    // the break comes up from black: it goes on under the black, which then lifts
    if (pvwSpecial === 'break' && fromSpecial === 'black') {
      setBreak(true);
      sw.breakUnder = true;
    }
    return true;
  }
  if (pvwClip) {
    const r = reelOf(pvwClip);
    if (!r) return false;
    Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: null, toClip: r.id, toSpecial: null, midAt: null, breakUnder: false, began: performance.now(), startAt: now() });
    // it starts as the dissolve to it begins
    if (r.prog) {
      r.prog.loop = !!r.loop;
      r.prog.volume = 0;
      mixInit();
      player.ctx.resume();
      r.prog.play().catch(() => {});
    }
    return true;
  }
  if (!pvw || !live.has(pvw)) return false;
  const l = live.get(pvw);
  if (l.overflow || l.paused) return toast(`${l.name} can't go on air right now`), false;
  Object.assign(sw, { from: liveActive, fromClip: mediaOn?.id || null, fromSpecial, to: pvw, toClip: null, toSpecial: null, midAt: null, breakUnder: false, began: performance.now(), startAt: now() });
  syncTally(); // (both on air through the dissolve: the incoming one's tally comes on now, and it starts recording)
  return true;
}
/** The T-bar moved (by hand, keys or a fader): 0..1 along its length. */
function setBar(pos) {
  pos = Math.min(1, Math.max(0, pos));
  if (!swActive() && Math.abs(pos - sw.rest) > 0.004 && !startTransition()) return;
  sw.auto = null;
  sw.pos = pos;
  sw.target = Math.abs(pos - sw.rest);
}
const NOTHING_IN_PREVIEW = 'Put a source, a clip, the break or black in preview first (Tap: Preview, or right-click a camera)';
function autoTransition() {
  if (!swActive() && !startTransition()) return inPreview() ? null : toast(NOTHING_IN_PREVIEW);
  sw.auto = { t0: performance.now(), from: sw.target, dur: +$('#swDur').value * 1000 * (1 - sw.target) };
}
/** What was on air goes to preview, ready to come back: a clip cued at its start again. */
function flipFlop(fromPeer, fromClip) {
  if (fromClip && reelOf(fromClip)) {
    pvw = null;
    pvwClip = fromClip;
    cueClip(reelOf(fromClip));
  } else {
    pvwClip = null;
    pvw = fromPeer && live.has(fromPeer) && (fromPeer !== liveActive || airCovered()) ? fromPeer : null;
  }
  pvwSpecial = null;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function takeCut() {
  if (swActive()) return Object.assign(sw, { target: 1, p: 1, auto: null, pos: 1 - sw.rest });
  if (!inPreview()) return toast(NOTHING_IN_PREVIEW);
  // to or from black, or to the break: a dissolve that's already over (it lands the same way)
  if (pvwSpecial || airSpecial() === 'black') {
    if (startTransition()) Object.assign(sw, { target: 1, p: 1, auto: null, pos: 1 - sw.rest });
    return;
  }
  const fromPeer = liveActive, fromClip = mediaOn?.id || null, fromSpecial = airSpecial();
  if (pvwClip) {
    if (fromSpecial === 'break') setBreak(false);
    cutMedia(pvwClip); // (from the top: it starts now)
  } else cutLive(pvw);
  flipFlop(fromPeer, fromClip);
  if (fromSpecial) flipSpecial(fromSpecial);
}
/** Back from the break or black: it waits in preview, ready to go again (flip-flop). */
function flipSpecial(kind) {
  pvw = pvwClip = null;
  pvwSpecial = kind;
  renderSwitcher();
  renderLive();
  renderClips();
  syncTally();
}
function finishTransition() {
  const fromPeer = sw.from, fromClip = sw.fromClip, to = sw.to, toClip = sw.toClip, startAt = sw.startAt ?? now();
  const toSpecial = sw.toSpecial, fromSpecial = sw.fromSpecial;
  sw.lastTook = Math.round(performance.now() - (sw.began || performance.now())); // (diagnostics: how long it took)
  const dissolveMs = now() - startAt;
  Object.assign(sw, { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, target: 0, auto: null, rest: sw.rest ? 0 : 1, breakUnder: false });
  sw.pos = sw.rest;
  const took = Math.max(1, Math.round(dissolveMs)); // (a fade that's already happened: black only lands)
  if (fromClip) {
    const r = reelOf(fromClip);
    if (r?.prog) r.prog.volume = 1;
  }
  if (toSpecial) {
    if (toSpecial === 'black') toggleBlack(true, took);
    else {
      setBreak(true);
      if (fromSpecial === 'black') toggleBlack(true, took); // (the black lifted off the break)
    }
    // what was on air waits in preview: the break or black it came from, else the camera (a clip comes off)
    return fromSpecial ? flipSpecial(fromSpecial) : flipFlop(fromClip ? null : fromPeer, null);
  }
  if (fromSpecial === 'break' && toClip) setBreak(false);
  if (toClip) {
    const r = reelOf(toClip);
    if (r?.prog) r.prog.volume = 1;
    cutMedia(toClip, { playing: true, at: startAt, dissolveMs }); // (already playing since the dissolve began)
  } else if (fromSpecial === 'black') {
    if (to !== liveActive) cutLive(to, null, { underBlack: true });
  } else cutLive(to, null, { dissolve: true, at: startAt, dissolveMs });
  if (fromSpecial === 'black') toggleBlack(true, took); // (up from black: the fade up puts it in the live cut)
  flipFlop(fromSpecial === 'black' ? null : fromPeer, fromClip !== toClip ? fromClip : null);
  if (fromSpecial) flipSpecial(fromSpecial);
}
let swLast = 0, swGates = 0;
function switcherTick(t) {
  const dt = Math.min(0.25, Math.max(0, (t - (swLast || t)) / 1000)); // (a slow frame doesn't stall the dissolve)
  swLast = t;
  if (!swActive()) return;
  if (sw.auto) {
    const a = sw.auto, k = Math.min(1, (t - a.t0) / Math.max(1, a.dur)), e = k * k * (3 - 2 * k);
    sw.target = a.from + (1 - a.from) * e;
    sw.pos = sw.rest ? 1 - sw.target : sw.target;
    if (k >= 1) sw.auto = null;
  }
  sw.p += (sw.target - sw.p) * (1 - Math.exp(-dt / 0.07));
  if (Math.abs(sw.target - sw.p) < 0.002) sw.p = sw.target;
  if (sw.p >= 0.5 && sw.midAt == null) sw.midAt = now();
  // a clip's own sound fades with its picture: in comes up, out goes down
  if (sw.toClip) {
    const r = reelOf(sw.toClip);
    if (r?.prog) r.prog.volume = Math.min(1, Math.max(0, sw.p));
  }
  if (sw.fromClip && sw.fromClip !== sw.toClip) {
    const r = reelOf(sw.fromClip);
    if (r?.prog) r.prog.volume = Math.min(1, Math.max(0, 1 - sw.p));
  }
  if (t - swGates > 45) {
    swGates = t;
    mixGates();
  }
  if ((sw.toSpecial === 'black' || sw.fromSpecial === 'black') && mix.ftb) {
    const g = mix.ftb.gain, t0 = player.ctx.currentTime;
    g.cancelScheduledValues(t0);
    g.setTargetAtTime(1 - blackLevel(), t0, 0.015);
  }
  if (sw.p >= 0.999 && sw.target >= 0.999) finishTransition();
  else if (sw.p <= 0.001 && sw.target <= 0.001 && !sw.auto) {
    // pulled back: nothing changed (a clip that had started goes back to its start, paused)
    const back = sw.toClip && reelOf(sw.toClip);
    if (sw.fromClip) {
      const r = reelOf(sw.fromClip);
      if (r?.prog) r.prog.volume = 1;
    }
    if (sw.breakUnder) setBreak(false);
    const blk = sw.toSpecial === 'black' || sw.fromSpecial === 'black';
    Object.assign(sw, { from: null, to: null, toClip: null, toSpecial: null, fromClip: null, fromSpecial: null, p: 0, midAt: null, breakUnder: false });
    if (blk && mix.ftb) {
      const g = mix.ftb.gain, t0 = player.ctx.currentTime;
      g.cancelScheduledValues(t0);
      g.setTargetAtTime(1 - black.target, t0, 0.015);
    }
    if (back) cueClip(back);
    mixGates();
    syncTally();
  }
  renderBar();
}
function renderBar() {
  const active = swActive();
  const shown = active ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest;
  $('#tbarHandle').style.setProperty('--y', shown);
  $('#tbarFill').style.setProperty('--p', active ? sw.p : 0);
  $('#tbar').setAttribute('aria-valuenow', String(Math.round((active ? sw.p : 0) * 100)));
  const toName = sw.toSpecial || (sw.toClip ? reelOf(sw.toClip)?.name : live.get(sw.to)?.name);
  $('#tbar').setAttribute('aria-valuetext', active ? `${Math.round(sw.p * 100)}% to ${toName || 'preview'}` : 'at rest');
}
function renderSwitcher() {
  document.querySelectorAll('#switcher [data-tap]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tap === tapMode)));
  const l = live.get(pvw), r = reelOf(pvwClip);
  $('#pvwBox').hidden = !l && !r && !pvwSpecial;
  $('#pvwLabel').textContent = pvwSpecial ? `PREVIEW · ${pvwSpecial === 'black' ? 'BLACK' : 'BREAK'}` : r ? `PREVIEW · CLIP ${r.name} · cued` : l ? `PREVIEW · ${isMic(pvw) ? `MIC ${micKey(pvw) || ''}` : angleOfCid(l.cid)} ${l.name}` : 'PREVIEW';
  renderBar();
}
// the preview box: the source in preview, drawn small in the corner of the program monitor
// (only on this screen: it's never in the program itself)
function drawPreviewBox() {
  const l = live.get(pvw), r = reelOf(pvwClip);
  const gone = pvwSpecial ? pvwSpecial === airSpecial() : (!l && !r) || (l && pvw === liveActive && !airCovered()) || (r && mediaOn?.id === pvwClip);
  if (gone || mode !== 'live') {
    if (!$('#pvwBox').hidden) $('#pvwBox').hidden = true; // (it went on air, left, or Tap: Air)
    return;
  }
  if ($('#pvwBox').hidden) return;
  const c = $('#pvwCanvas'), g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  if (pvwSpecial === 'break') drawSlate(g, c.width, c.height, { ...slateText(), look: slateLook, t: performance.now(), now: now() });
  else if (pvwSpecial) return; // (black)
  else if (r) {
    const el = r.prog || r.el;
    if (el && (el.readyState === undefined ? el.complete : el.readyState >= 2)) drawFramed(g, el, c.width, c.height, 'fit');
  } else if (isMic(pvw)) drawMicVisual(g, c.width, c.height, micTileOpts(pvw));
  else if (l.video?.readyState >= 2) drawFramed(g, l.video, c.width, c.height, fit, null, l.view?.rect || null);
}
document.querySelectorAll('#switcher [data-tap]').forEach((b) => (b.onclick = () => {
  tapMode = b.dataset.tap;
  localStorage.setItem('vm_tapmode', tapMode);
  if (tapMode === 'air' && inPreview() && !swActive()) clearPreview(); // (Tap: Air: nothing waits in preview)
  renderClips();
  renderSwitcher();
  announce(tapMode === 'preview' ? 'Tapping a source puts it in preview' : 'Tapping a source puts it on air');
}));
$('#swCut').onclick = takeCut;
window.vmClips = () => reel.map((r) => ({ id: r.id, name: r.name, t: r.prog ? Math.round(r.prog.currentTime * 100) / 100 : null, paused: r.prog ? r.prog.paused : null, volume: r.prog?.volume ?? null })); // (tests and diagnostics)
window.vmSwitcher = () => ({ ...sw, pvw, pvwClip, liveActive, mediaOn: mediaOn?.id || null, tapMode }); // (tests and diagnostics)
$('#swAuto').onclick = autoTransition;
// the T-bar by hand: drag the handle (or anywhere on the bar); keys move it in steps
{
  const bar = $('#tbar');
  let drag = null;
  const at = (e) => {
    const r = bar.querySelector('.ttrack').getBoundingClientRect();
    return 1 - (e.clientY - r.top) / r.height;
  };
  bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    drag = { off: at(e) - (swActive() ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest) };
    bar.classList.add('held');
  });
  bar.addEventListener('pointermove', (e) => drag && setBar(at(e) - drag.off));
  const up = () => {
    drag = null;
    bar.classList.remove('held');
  };
  bar.addEventListener('pointerup', up);
  bar.addEventListener('pointercancel', up);
  bar.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.2 : 0.05, cur = swActive() ? (sw.rest ? 1 - sw.p : sw.p) : sw.rest;
    if (e.key === 'ArrowUp') setBar(cur + step);
    else if (e.key === 'ArrowDown') setBar(cur - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
}
// a hardware fader (any MIDI controller): press MIDI, move the fader, and it's the T-bar
$('#swMidi').onclick = async () => {
  if (!navigator.requestMIDIAccess) return toast('This browser has no MIDI (Chrome and Edge do)');
  try {
    const midi = await navigator.requestMIDIAccess();
    let map = JSON.parse(localStorage.getItem('vm_tbar_midi') || 'null');
    toast(map ? `T-bar on MIDI fader ${map.cc}. Move another fader within 5 s to change it.` : 'Move the fader you want to use as the T-bar', 5000);
    const learnUntil = Date.now() + 5000;
    for (const input of midi.inputs.values()) {
      input.onmidimessage = (m) => {
        const [st, cc, v] = m.data;
        if ((st & 0xf0) !== 0xb0) return;
        if (Date.now() < learnUntil && (!map || map.cc !== cc)) {
          map = { cc, name: input.name };
          localStorage.setItem('vm_tbar_midi', JSON.stringify(map));
          toast(`T-bar: ${input.name}, fader ${cc}`);
        }
        if (map && cc === map.cc) setBar(v / 127);
      };
    }
    $('#swMidi').setAttribute('aria-pressed', 'true');
  } catch {
    toast('MIDI access was refused');
  }
};
function setSwitcher(on) {
  $('#switcher').hidden = !on;
  document.querySelector('.monitor')?.classList.toggle('withswitcher', on);
  if (!on && inPreview() && !swActive()) clearPreview(); // (no switcher, no preview)
  fitMonitors();
  $('#swTgl').setAttribute('aria-pressed', String(on));
  localStorage.setItem('vm_switcher', on ? '1' : '0');
  renderSwitcher();
}
$('#swTgl').onclick = () => setSwitcher($('#switcher').hidden);
// a short monitor (a small laptop, a tall mixer dock): the MIDI button goes, so the T-bar keeps its throw
new ResizeObserver(([e]) => $('#switcher').classList.toggle('tight', e.contentRect.height < 380)).observe(document.querySelector('.monitor') || document.body);
setSwitcher(localStorage.getItem('vm_switcher') === '1');

// ---- keep the program running when this window is covered or hidden ---------------------
// Browsers pause animation frames in a covered or background window, which would freeze
// the program (and Program out, and a program recording). So: animation frames while
// we're visible; otherwise Program out's own frames drive us (vmPump), and a worker clock
// (which browsers don't slow down) covers everything else, including the auto director.
let lastRaf = 0, lastPump = 0, lastDirector = 0;
const stalled = () => document.hidden || performance.now() - lastRaf > 120;
// The program is captured at 30 frames a second, so drawing it faster (60 on most screens)
// only doubles the work; at 30 the studio has time for everything else (messages from
// phones, clips arriving, the controls).
let lastLiveDraw = 0;
function frameTick() {
  const t = performance.now();
  if (EDIT_ONLY) {
    // the Edit page draws no live program (the studio does): only the edit's playback, which
    // it hands to Program out (Edit) as it goes
    if (mode === 'edit' && stalled()) player.step();
    if (t - lastLiveDraw >= 31) {
      lastLiveDraw = t;
      pushProgramFrame();
    }
    return;
  }
  switcherTick(t);
  if (t - lastLiveDraw >= 31) {
    lastLiveDraw = t;
    drawLiveFrame();
    drawPreviewBox();
    pushProgramFrame();
  }
  if (mode === 'edit' && stalled()) player.step();
}
(function rafLoop() {
  lastRaf = performance.now();
  frameTick();
  requestAnimationFrame(rafLoop);
})();
window.vmPump = () => {
  if (!stalled()) return;
  lastPump = performance.now();
  frameTick();
};
try {
  const ticker = new Worker('/js/ticker.js');
  ticker.onmessage = () => {
    const t = performance.now();
    if (stalled() && t - lastPump > 60 && (!EDIT_ONLY || progOutPeers.size)) frameTick(); // (the Edit window only while Program out shows it)
    if (t - lastDirector >= 300 && !EDIT_ONLY) {
      lastDirector = t;
      directorTick();
    }
  };
} catch {
  setInterval(() => directorTick(), 300);
}

// Record the program to this laptop: picture plus the live mix. A file the moment you stop.
// One program picture for everything that takes it: Record program, the live cut, streaming
// and Program out. Its frames are pushed on every draw (requestFrame) rather than sampled by
// the canvas's own timer: that timer can stop when the studio window is hidden or covered
// (Program out full screen over it), which froze a second recording's picture while its
// sound went on. Each user gets a copy (clone) of the one track.
var progCapture = null; // (var: the drawing loop starts before this line runs)
function programVideoTrack() {
  const t0 = progCapture?.getVideoTracks()[0];
  if (!t0 || t0.readyState !== 'live') {
    progCapture = program.captureStream(0);
    if (!progCapture.getVideoTracks()[0]?.requestFrame) progCapture = program.captureStream(30); // (no push here: sampled)
  }
  return progCapture.getVideoTracks()[0].clone();
}
function pushProgramFrame() {
  progCapture?.getVideoTracks()[0]?.requestFrame?.();
}

let progRec = null;
const recFades = () => $('#recFades')?.checked;
$('#recFades').checked = localStorage.getItem('vm_recfades') === '1';
$('#recFades').onchange = (e) => localStorage.setItem('vm_recfades', e.target.checked ? '1' : '0');

// ---------------------------------------------------------------- autopilot ---
// A show that runs itself. With no camera, the program sits at black. When a camera arrives
// (its picture steady for 3 s): the intro clip, if one's chosen, fades up and plays, the
// program records, and the auto director takes over. Each camera that arrives later is put
// in preview (green: PREVIEW on its phone), then dissolves to air with its name on a lower
// third. When no camera's been here for the time chosen, the program fades to black, the
// recording stops (kept here and in Media), and each phone gets its part of the live cut.
var ap = { on: false, state: 'idle', emptySince: 0, ready: new Map(), seen: new Set(), handsFree: false }; // (var: used early)
const apEndMs = () => (+$('#apEnd').value || 30) * 1000;
const apCams = () => camOrder().filter((p) => {
  const l = live.get(p);
  return l && !l.local && !l.paused && !l.overflow && l.video?.readyState >= 2; // (this computer's own cameras don't start a show: they join the rotation)
});
function setAutopilot(on, quiet) {
  ap.on = on;
  $('#apOn').checked = on;
  localStorage.setItem('vm_autopilot', on ? '1' : '0');
  document.body.classList.toggle('autopilot', on);
  if (on) {
    ap.seen = new Set(apCams()); // (who's here already isn't "new")
    if (apCams().length) {
      ap.state = 'running';
      if (!autoOn) setAuto(true);
      if (black.target === 1) toggleBlack(true);
    } else {
      ap.state = 'idle';
      if (black.target !== 1) toggleBlack(false);
    }
  } else ap.state = 'idle';
  renderApIntro();
  if (!quiet) {
    note(on ? 'Autopilot on: the show runs itself' : 'Autopilot off');
    toast(on ? 'Autopilot on: the show starts when a camera arrives, and ends when they\u2019ve all gone' : 'Autopilot off');
  }
}
function apIdle() {
  ap.state = 'idle';
  ap.seen.clear();
  ap.emptySince = 0;
  note('Autopilot: the show ended; waiting for the next camera');
}
function apLowerThird(peer, sub) {
  const l = live.get(peer);
  if (!l) return;
  Object.assign(lt, { on: true, at: performance.now(), off: performance.now() + 6000, text: l.name, sub });
  ltUi(true);
}
// Go live from the first phone: a 3-2-1 count-in, here and on the phone, then the show.
function apCountIn(peer) {
  if (ap.state !== 'idle' || ap.counting) return;
  ap.counting = true;
  const box = $('#kCount'), b = box.querySelector('b');
  box.hidden = false;
  let n = 3;
  const step = () => {
    if (n === 0) {
      box.hidden = true;
      ap.counting = false;
      if (live.has(peer)) apStart(peer);
      return;
    }
    b.textContent = n;
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    n--;
    setTimeout(step, 1000);
  };
  step();
  note(`Kiosk: ${live.get(peer)?.name} tapped Go live`);
}
function apStart(first) {
  if (ap.starter && live.has(ap.starter)) hub?.message(ap.starter, { t: 'starter', on: false });
  ap.starter = null;
  ap.state = 'running';
  ap.emptySince = 0;
  ap.seen.add(first);
  ap.handsFree = true;
  cutLive(first, 'autopilot');
  if (black.target === 1) toggleBlack(true); // (fading up starts the recording)
  else if (!progRec) toggleProgramRecording();
  const intro = reel.find((r) => r.id === $('#apIntro').value && r.type.startsWith('video/'));
  if (intro) {
    intro.loop = false;
    setTimeout(() => ap.on && cutMedia(intro.id), 50); // (plays once, then back to the camera)
    setTimeout(() => apLowerThird(first, 'is on'), (intro.prog?.duration || 5) * 1000 + 600);
  } else apLowerThird(first, 'is on');
  if (!autoOn) setAuto(true);
  note(`Autopilot: ${live.get(first)?.name || 'a camera'} arrived: the show is on${intro ? ` (intro: ${intro.name})` : ''}`);
}
function apWelcome(peer) {
  ap.seen.add(peer);
  (ap.welcomed ||= []).push(live.get(peer)?.name);
  if (swActive()) return;
  // queued: in preview for a moment (PREVIEW on their phone), then on air with a dissolve and their name
  pvw = peer;
  pvwClip = null;
  renderSwitcher();
  renderLive();
  syncTally();
  note(`Autopilot: ${live.get(peer)?.name} arrived: in preview, on air next`);
  setTimeout(() => {
    if (!ap.on || ap.state !== 'running' || pvw !== peer || !live.has(peer) || mediaOn) return;
    autoTransition();
    apLowerThird(peer, 'joined the show');
    manualUntil = Date.now() + 8000; // (the auto director leaves them on for a moment)
  }, 2500);
}
function apTick() {
  if (!ap.on || !isHost || mode !== 'live') return;
  const t = Date.now(), cams = apCams();
  for (const p of cams) if (!ap.ready.has(p)) ap.ready.set(p, t);
  for (const p of [...ap.ready.keys()]) if (!cams.includes(p)) ap.ready.delete(p);
  const steady = cams.filter((p) => t - ap.ready.get(p) >= 3000);
  if (ap.state === 'idle') {
    if (!steady.length) return;
    if (!KIOSK) return apStart(steady[0]);
    // At a kiosk, the first phone in starts the show: it gets Go live (after it's locked in to
    // the code), and the count-in. If it leaves, the next phone gets it; after 3 minutes, it starts anyway.
    const starter = ap.starter && steady.includes(ap.starter) ? ap.starter : steady[0];
    if (starter !== ap.starter) {
      if (ap.starter && live.has(ap.starter)) hub?.message(ap.starter, { t: 'starter', on: false });
      ap.starter = starter;
      ap.starterSince = t;
      hub?.message(starter, { t: 'starter', on: true });
      note(`Kiosk: ${live.get(starter)?.name} can start the show (Go live on their phone)`);
    }
    if (t - ap.starterSince > 180000) apStart(starter);
    return;
  }
  if (ap.state !== 'running') return; // ('ended': waits for Start again)
  if (!cams.length) {
    ap.emptySince ||= t;
    if (t - ap.emptySince >= apEndMs()) {
      ap.state = 'ending';
      setAuto(false);
      if (pvw) clearPreview();
      if (black.target !== 1) toggleBlack(true);
      note('Autopilot: everyone has gone: fading to black, stopping the recording; each phone gets its part of the live cut');
    }
    return;
  }
  ap.emptySince = 0;
  const fresh = steady.find((p) => !ap.seen.has(p) && p !== liveActive);
  if (fresh && !mediaOn && !swActive() && t >= manualUntil) apWelcome(fresh);
  for (const p of steady) if (p === liveActive) ap.seen.add(p);
}
setInterval(apTick, 1000);
function renderApIntro() {
  const sel = $('#apIntro'), cur = sel.value || localStorage.getItem('vm_ap_intro') || '';
  sel.innerHTML = `<option value="">None</option>${reel.filter((r) => r.type.startsWith('video/')).map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}`;
}
$('#apOn').onchange = (e) => setAutopilot(e.target.checked);
$('#apIntro').onfocus = renderApIntro;
$('#apIntro').onchange = (e) => localStorage.setItem('vm_ap_intro', e.target.value);
$('#apEnd').value = localStorage.getItem('vm_ap_end') || '30';
$('#apEnd').onchange = (e) => localStorage.setItem('vm_ap_end', e.target.value);
setTimeout(() => (KIOSK || localStorage.getItem('vm_autopilot') === '1') && isHost && !EDIT_ONLY && setAutopilot(true, true), 1500);
// ------------------------------------------------------------------ kiosk ---
// /kiosk starts a show and opens it here with ?kiosk=1: the program, the cameras, the join
// code (the beacon, beside them), what's coming in and going out, and two big buttons. The
// autopilot runs it. Nothing pops up and nothing downloads. Delete show deletes it now
// (phones keep what they recorded); a show left alone deletes itself after 12 hours, and
// this screen goes back to the start once nobody's been here for half an hour.
if (KIOSK && eventId) { // (with no show yet, the launcher is still finding one)
  document.body.classList.add('kiosk');
  document.documentElement.dataset.theme = 'dark'; // (a sign: dark, whatever this browser chose before)
  let ran = false, endedAt = 0, rolling = false, lastTitle = '';
  // its own join code, moving like the beacon's (the time in it syncs the phones)
  const qr = $('#kQr');
  $('#kHost').textContent = `${location.host}/cam`;
  $('#kCode').textContent = eventId;
  let qrLast = 0;
  (function drawCode() {
    const t = now();
    if (t - qrLast >= 1000 / 15) {
      qrLast = t;
      drawQR(qr, timecodeUrl(eventId, t), { size: 720 });
    }
    requestAnimationFrame(drawCode);
  })();
  const setTitle = (e) => {
    if (!e) return; // (the event is still loading)
    const named = !e.kiosk || e.titled !== false;
    $('#kCall').textContent = named ? 'Scan to join' : 'Scan to start a show';
    $('#kTitle').textContent = named ? e.title : 'The first to scan names it';
    if (named && e.title !== lastTitle) {
      lastTitle = e.title;
      if (ev) ev.title = e.title;
      $('#title').textContent = e.title;
      document.title = `${e.title} · VUEMesh`;
      if (lastTitle) note(`The show is called \u201c${e.title}\u201d`);
    }
  };
  setTitle(ev);
  // the show's name comes from the first phone; a show that's gone (12 hours) makes way for a new one
  setInterval(async () => {
    try {
      setTitle(await api(`events/${eventId}`));
    } catch (e) {
      if (/404|No event/.test(e.message)) nextShow('the show expired');
    }
  }, 4000);
  // When a show has ended (everyone gone, faded out, recording stopped) and nothing is still
  // going out or coming in, the screen thanks them and starts a fresh show with a new code.
  // The old one is deleted (phones keep what they recorded).
  async function nextShow(why) {
    if (rolling) return;
    rolling = true;
    note(`Kiosk: starting a new show (${why})`);
    try {
      const fresh = await api('events', { method: 'POST', body: { kiosk: true, orientation: ev?.orientation || 'landscape' } });
      localStorage.setItem('vm_kiosk', JSON.stringify({ id: fresh.id, hostKey: fresh.hostKey, at: Date.now() }));
      await api(`events/${eventId}`, { method: 'DELETE', host: key }).catch(() => {});
      await idb.wipe(eventId).catch(() => {});
      for (const k of Object.keys(localStorage)) if (k.includes(eventId)) localStorage.removeItem(k);
      leaveQuietly = true;
      location.replace(KIOSK_PAGE ? `/kiosk?e=${fresh.id}#k=${fresh.hostKey}` : `/studio?e=${fresh.id}&kiosk=1#k=${fresh.hostKey}`);
    } catch (e) {
      rolling = false;
      note(`Kiosk: couldn't start a new show yet (${e.message}); trying again`);
    }
  }
  setInterval(() => {
    // (phones: the kiosk's own cameras don't keep a show going, or count as people here)
    const cams = camOrder().filter((p) => !live.get(p)?.local).length, clipsIn = clips.filter((c) => !c.program && !c.reel && !c.local).length, busy = incoming.size + outgoing.size;
    if (ap.state === 'running') {
      ran = true;
      endedAt = 0;
    }
    if (ran && ap.state === 'idle' && !cams && !progRec) endedAt ||= Date.now();
    if (cams) endedAt = 0;
    $('#kCams').textContent = cams;
    $('#kClips').textContent = clipsIn;
    $('#kXfer').textContent = busy;
    document.body.classList.toggle('onair', ap.state === 'running');
    const recFor = progRec?.startedAt ? Math.floor((Date.now() - progRec.startedAt) / 1000) : 0;
    const st = $('#kState');
    st.classList.toggle('on', ap.state === 'running');
    st.textContent = ap.counting ? 'Here we go\u2026' : ap.state === 'idle' && ap.starter && live.has(ap.starter) ? `${live.get(ap.starter).name}: tap Go live on your phone to start` : ap.state === 'running' ? `\u25cf On air \u00b7 recording ${Math.floor(recFor / 60)}:${String(recFor % 60).padStart(2, '0')}`
      : ap.state === 'ending' ? 'That\u2019s a wrap\u2026'
      : endedAt ? (busy ? `Thanks! Finishing ${busy} transfer${busy > 1 ? 's' : ''}, then a new show starts` : 'Thanks! A new show starts in a moment')
      : 'Waiting for cameras';
    // a new show: once this one's over and its transfers are done (or after 3 minutes regardless)
    if (endedAt && ((!busy && Date.now() - endedAt > 15000) || Date.now() - endedAt > 180000)) nextShow('the last show ended');
  }, 1000);
  // hands-free: nothing to press; no pointer, no menus
  let idleT = null;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleT);
    idleT = setTimeout(() => document.body.classList.add('idle'), 3000);
  };
  ['pointermove', 'pointerdown'].forEach((t) => addEventListener(t, wake));
  addEventListener('contextmenu', (e) => e.preventDefault(), true);
  wake();
  navigator.wakeLock?.request('screen').catch(() => {});
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && navigator.wakeLock?.request('screen').catch(() => {}));
}

window.vmAutopilot = () => ({ on: ap.on, state: ap.state, seen: ap.seen.size, welcomed: ap.welcomed || [], recording: !!progRec, black: black.target === 1, auto: autoOn, pvw, liveActive }); // (tests and diagnostics)

function toggleProgramRecording() {
  if (!isHost) return;
  if (progRec) {
    // the cameras hear at once that the show's no longer being recorded (saving it can take a while)
    progRec.stopping = true;
    recOnAirChanged();
    return progRec.stop();
  }
  mixInit();
  player.ctx.resume();
  const tracks = [programVideoTrack(), ...mix.dest.stream.getAudioTracks()];
  const mime = recMime();
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const startedAt = now();
  rec.onstop = () => {
    addUsage('liveCutSec', (Date.now() - (rec.startedAt || Date.now())) / 1000);
    progRec = null;
    recOnAirChanged();
    setTimeout(() => tracks[0].stop(), 3000); // (its own copy, once the last live-cut part is done: the program picture goes on for everything else)
    $('#recProgBtn').setAttribute('aria-pressed', 'false');
    const blob = new Blob(chunks, { type: rec.mimeType });
    if (!KIOSK && !ap?.handsFree) download(blob, `${ev.title}-live`); // (hands-free: it's kept here and in Media, no download)
    // ...and keep a copy in this browser too
    idb.put('program', { eventId, id: 'master-' + Math.round(startedAt), kind: 'master', t0: startedAt, t1: now(), mime: rec.mimeType, blob }).catch(() => {});
    // ...and in Edit's Media, on the cameras' clock: everything that aired, to use by hand
    const pmeta = { id: 'PGM-' + Math.round(startedAt), kind: 'video', mime: rec.mimeType, cid: 'PGM', name: 'Program (as aired)', t0: startedAt - LIVE_DELAY, dur: Math.round(now() - startedAt), w: program.width, h: program.height, local: true, program: true, t0Source: 'studio', native: true, audio: 'stereo', orient: [{ t: 0, rot: 0, rect: null, upright: program.width >= program.height ? 'landscape' : 'portrait', ev: 0, ct: 0 }] };
    idb.put('clips', { eventId, ...pmeta, receivedAt: Date.now(), blob }).then(() => addClip({ eventId, ...pmeta, receivedAt: Date.now() }, blob, true)).catch(() => {});
    flushRecordings('Record program ended');
    stopPieces();
    note('Program recording saved (downloaded, and kept in this browser)');
    announce('Program recording saved');
    if (!KIOSK && !ap?.handsFree) showWrap();
  };
  rec.start(1000);
  startPieces(tracks);
  progRec = rec;
  rec.startedAt = Date.now();
  recOnAirChanged();
  $('#recProgBtn').setAttribute('aria-pressed', 'true');
  note('Program recording started');
  toast('Recording the program to this device');
  announce('Recording the program');
}
// by hand: it downloads and shows the wrap-up as usual (only hands-free shows skip those)
const recByHand = () => {
  ap.handsFree = false;
  toggleProgramRecording();
};
$('#recProgBtn').onclick = recByHand;

// ---- the live cut, sent to the crew ----------------------------------------------------
// While the program records, a second, lighter recorder cuts it into pieces of a few
// minutes. Each finished piece goes to every camera and microphone person who was
// connected during it (over the local link, nothing via the cloud), so they have the live
// cut of what they shot right away. Anyone away when a piece finishes gets it on return.

const PIECE_MS = Number(localStorage.getItem('vm_piece_ms')) || 5 * 60 * 1000;
const PIECE_OVERLAP = 500;
const presKey = 'vm_presence_' + eventId, sentKey = 'vm_pgmsent_' + eventId;
const presence = JSON.parse(localStorage.getItem(presKey) || '{}'); // cid → [[from, to], …]
const pgmSent = JSON.parse(localStorage.getItem(sentKey) || '{}');   // cid → [piece ids]
let sendPgm = (localStorage.getItem('vm_sendpgm_' + eventId) ?? localStorage.getItem('vm_sendpgm_default') ?? '1') !== '0';
$('#sendPgm').checked = sendPgm;
$('#sendPgm').onchange = (e) => {
  sendPgm = e.target.checked;
  localStorage.setItem('vm_sendpgm_' + eventId, sendPgm ? '1' : '0');
  localStorage.setItem('vm_sendpgm_default', sendPgm ? '1' : '0');
  if (sendPgm) sendProgramParts();
  renderPgmState();
};
const savePresence = () => localStorage.setItem(presKey, JSON.stringify(presence));
function presenceOn(cid) {
  if (!cid) return;
  const t = now();
  (presence[cid] ||= []).push([t, t]);
  savePresence();
}
function presenceOff(cid) {
  const iv = cid && presence[cid]?.[presence[cid].length - 1];
  if (iv) (iv[1] = now()), savePresence();
}
// while someone is connected, their latest stretch keeps growing
setInterval(() => {
  const t = now();
  let changed = false;
  for (const l of live.values()) {
    if (l.leaving) continue;
    const iv = l.cid && presence[l.cid]?.[presence[l.cid].length - 1];
    if (iv) (iv[1] = t), (changed = true);
  }
  if (changed) savePresence();
}, 5000);
const wasThere = (cid, t0, t1) => (presence[cid] || []).some(([a, b]) => a < t1 && b > t0);

let pieceRec = null, pieceN = 0, pieceTimer = null, pieceTracks = null;
const finishing = new Set(); // pieces stopped but not saved yet
const pieces = []; // {id, part, t0, t1} (blobs stay in the browser's storage)
idb.list('program', eventId).then((rs) => {
  for (const r of rs) if (r.kind === 'piece') pieces.push({ id: r.id, part: r.part, t0: r.t0, t1: r.t1, mime: r.mime });
  pieces.sort((a, b) => a.t0 - b.t0);
  pieceN = pieces.length;
  renderPgmState();
});
function startPieces(tracks) {
  pieceTracks = tracks;
  rollPiece();
}
function rollPiece() {
  const mime = recMime();
  const rec = new MediaRecorder(new MediaStream(pieceTracks), { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
  const chunks = [];
  const piece = { id: `${eventId}-${Math.round(now())}`, part: ++pieceN, t0: now(), mime: rec.mimeType };
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    piece.t1 = now();
    const blob = new Blob(chunks, { type: rec.mimeType });
    const f = await codecsOf(blob).catch(() => null);
    if (f) piece.codecs = `${f.container} · ${f.video} + ${f.audio}`;
    await idb.put('program', { eventId, kind: 'piece', ...piece, blob }).catch(() => {});
    diag('event', `Live cut part ${piece.part}: ${piece.codecs || piece.mime}, ${Math.round(blob.size / 1048576)} MB`);
    pieces.push(piece);
    finishing.delete(piece);
    renderPgmState();
    sendProgramParts();
  };
  rec.piece = piece;
  rec.start(1000);
  const prev = pieceRec;
  pieceRec = rec;
  if (prev) {
    finishing.add(prev.piece);
    setTimeout(() => prev.state !== 'inactive' && prev.stop(), PIECE_OVERLAP);
  }
  clearTimeout(pieceTimer);
  pieceTimer = setTimeout(() => progRec && rollPiece(), PIECE_MS);
}
function stopPieces() {
  clearTimeout(pieceTimer);
  if (pieceRec?.piece) finishing.add(pieceRec.piece);
  if (pieceRec?.state !== 'inactive') pieceRec?.stop();
  pieceRec = null;
}

let sending = false, sendAgain = false;
// Sending the live cut to the phones, without getting in the way of the show:
//  - one transfer at a time, and the phone is asked first: one that's recording, sending
//    its own clips or short of space says "not now", and gets it on a later pass
//  - the camera on air gets it slowest (its picture comes first)
//  - while the show is live, transfers are held to 2 Mbit/s so the live pictures keep the Wi-Fi;
//    after it, full speed
//  - someone leaving goes first, at full speed: the piece being recorded is finished early if
//    they were in it, and their phone waits for it (they can leave anyway)
const leavingPeers = new Set();
let lastLeaveRoll = 0;
const owedTo = (cid) => pieces.filter((pc) => pc.t1 && wasThere(cid, pc.t0, pc.t1) && !(pgmSent[cid] || []).includes(pc.id));
const comingFor = (cid) => ([...finishing].some((p) => wasThere(cid, p.t0, now())) ? 1 : 0); // a piece about to be saved
const showIsOn = () => mode === 'live' && black.target !== 1 && camOrder().some((p) => !live.get(p)?.paused);
// bytes per second: during the show, 2 Mbit/s (1 to the camera on air); after it, full speed
const partRate = (peer) => (leavingPeers.size ? Infinity : !showIsOn() ? Infinity : peer === liveActive && !onBreak() ? 125_000 : 250_000);
function prepareLeaving(peer) {
  const l = live.get(peer);
  if (!l?.cid || !sendPgm || !hub) return hub?.message(peer, { t: 'owed', n: 0 });
  const open = pieceRec?.piece;
  if (progRec && open && wasThere(l.cid, open.t0, now()) && Date.now() - lastLeaveRoll > 15000) {
    lastLeaveRoll = Date.now();
    rollPiece(); // their part of what's being recorded now: finish it so it can go with them
  }
  const n = owedTo(l.cid).length + comingFor(l.cid);
  hub.message(peer, { t: 'owed', n });
  if (!n) return;
  note(`${l.name} is leaving: sending them ${n} part${n > 1 ? 's' : ''} of the live cut first`);
  leavingPeers.add(peer);
  setTimeout(() => leavingPeers.delete(peer), 300000);
  sendProgramParts();
}
async function sendProgramParts() {
  if (!sendPgm || !isHost || !hub) return;
  // one pass at a time; anything that finishes meanwhile gets sent right after (not in 30 s)
  if (sending) return (sendAgain = true);
  sending = true;
  sendAgain = false;
  try {
    const peers = [...live.keys()].filter((p) => !live.get(p)?.local).sort((a, b) => leavingPeers.has(b) - leavingPeers.has(a));
    // (a snapshot: parts finished during this pass are picked up by the next one; and someone
    // starting to leave cuts in at the next part, rather than waiting for this pass to end)
    const todo = [...pieces];
    pass: for (const peer of peers) {
      const l = live.get(peer);
      if (!l?.cid) continue;
      const urgent = leavingPeers.has(peer);
      for (const pc of todo) {
        if (!urgent && leavingPeers.size) {
          sendAgain = true;
          break pass;
        }
        if (!pc.t1 || (pgmSent[l.cid] || []).includes(pc.id) || !wasThere(l.cid, pc.t0, pc.t1)) continue;
        const rec = (await idb.list('program', eventId)).find((r) => r.id === pc.id);
        if (!rec?.blob) continue;
        try {
          const oid = `${peer}:${pc.id}`;
          try {
            await hub.sendFile(peer, { id: pc.id, part: pc.part, t0: pc.t0, t1: pc.t1, mime: pc.mime, codecs: pc.codecs || rec.codecs, title: ev.title }, rec.blob, (got, total) => outgoing.set(oid, { id: oid, name: l.name, part: pc.part, got, total, at: outgoing.get(oid)?.at || Date.now() }), { ask: !urgent, rate: () => partRate(peer) });
            sentLog.unshift({ at: Date.now(), name: l.name, part: pc.part, size: rec.blob.size, secs: Math.round((pc.t1 - pc.t0) / 1000) });
            sentLog.length = Math.min(sentLog.length, 60);
          } finally {
            outgoing.delete(oid);
          }
          (pgmSent[l.cid] ||= []).push(pc.id);
          localStorage.setItem(sentKey, JSON.stringify(pgmSent));
          l.pgmWait = null;
          note(`Sent part ${pc.part} of the live cut to ${l.name}`);
          renderPgmState();
          if (urgent) hub.message(peer, { t: 'owed', n: owedTo(l.cid).length + comingFor(l.cid) });
        } catch (e) {
          if (e.busy && l.pgmWait !== e.message) {
            l.pgmWait = e.message;
            note(`Live cut for ${l.name}: waiting (their phone is ${e.message})`);
            renderPgmState();
          } else if (!e.busy) {
            // say why in the event log (and Monitor), once per reason: it's tried again next round
            console.warn('program part not sent', e);
            if (l.pgmFail !== e.message) {
              l.pgmFail = e.message;
              note(`Live cut part ${pc.part} didn't reach ${l.name}: ${e.message}. Trying again.`);
            }
          }
          break; // try this person again later
        }
      }
      if (urgent && !owedTo(l.cid).length && !comingFor(l.cid)) {
        leavingPeers.delete(peer);
        hub.message(peer, { t: 'owed', n: 0 });
      }
    }
  } finally {
    sending = false;
    if (sendAgain) setTimeout(sendProgramParts, 0);
  }
}
setInterval(sendProgramParts, 30000);

function renderPgmState() {
  const el = $('#pgmState');
  if (!el) return;
  const cids = Object.keys(presence);
  const owed = pieces.reduce((n, pc) => n + cids.filter((c) => pc.t1 && wasThere(c, pc.t0, pc.t1)).length, 0);
  const sent = cids.reduce((n, c) => n + (pgmSent[c] || []).length, 0);
  el.textContent = !pieces.length ? 'Each camera gets the live cut of the time they were here, a few minutes at a time.'
    : `${pieces.length} part${pieces.length > 1 ? 's' : ''} of the live cut · sent ${sent} of ${owed}${sendPgm ? '' : ' (sending is off)'}` + pgmWaiting();
}
/** Who's still owed some of the live cut, and why it hasn't gone yet. */
function pgmWaiting() {
  const here = new Map([...live.values()].filter((l) => l.cid).map((l) => [l.cid, l]));
  const away = [], busy = [];
  for (const cid of Object.keys(presence)) {
    if (!owedTo(cid).length) continue;
    const l = here.get(cid);
    const name = l?.name || clips.find((c) => c.cid === cid || c.contributorId === cid)?.name || 'a camera';
    if (!l) away.push(name);
    else if (l.pgmWait) busy.push(`${name} (${l.pgmWait})`);
  }
  return (busy.length ? ` · waiting on ${busy.join(', ')}` : '') + (away.length ? ` · ${away.join(', ')} left before ${away.length > 1 ? 'their parts were' : 'their part was'} ready: it goes when they rejoin` : '');
}

// ---- can iPhones play what this browser records? ---------------------------------------
// Some browsers (Chromium and Chrome on Linux, for one) can't record H.264, so the program,
// the live cut and renders come out as VP9: fine on Android and computers, not on iPhones.
// A half-second test recording at startup finds out, and the studio says so plainly.
let pgmFormat = null;
async function probeProgramFormat() {
  if (!window.MediaRecorder) return;
  if (!isHost) {
    // the studio may not know it's the host yet on a slow connection: try again shortly
    if ((probeProgramFormat.tries = (probeProgramFormat.tries || 0) + 1) < 12) setTimeout(probeProgramFormat, 1500);
    return;
  }
  try {
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 36 });
    const g = c.getContext('2d');
    const draw = setInterval(() => { g.fillStyle = `hsl(${Date.now() % 360},60%,50%)`; g.fillRect(0, 0, 64, 36); }, 30);
    const mime = recMime();
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime });
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    await new Promise((resolve) => {
      rec.onstop = resolve;
      rec.start(100);
      setTimeout(() => rec.state !== 'inactive' && rec.stop(), 700);
    });
    clearInterval(draw);
    const f = await codecsOf(new Blob(parts, { type: rec.mimeType || mime }));
    // a video-only test has no sound track: read the sound codec from the format instead
    if (f.audio === '?') f.audio = /mp4a/.test(mime) ? 'AAC' : /opus/.test(mime) || /webm/.test(mime) ? 'Opus' : MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2') ? 'AAC' : 'Opus';
    pgmFormat = { ...f, mime };
    diag('event', `Program recording format: ${f.container} · ${f.video} + ${f.audio} (${mime})`);
  } catch (e) {
    diag('warn', `Couldn't test the recording format: ${e.message}`);
  }
  renderFormatNote();
}
function renderFormatNote() {
  const el = $('#pgmFormat');
  if (!el || !pgmFormat) return;
  el.hidden = pgmFormat.iphone;
  el.innerHTML = `This browser records the program as <b>${pgmFormat.video} video with ${pgmFormat.audio} sound</b>. Android phones and computers play it, but <b>iPhones can't</b> (that goes for the live cut sent to phones, too). For files every phone plays, run the studio in Chrome or Edge on a Mac or Windows PC, or Safari on a Mac.`;
}
setTimeout(probeProgramFormat, 1500);

// ---- record-only overflow ----------------------------------------------------------------
// The studio shows up to a set number of live pictures. Phones past that join recording
// only: no live picture or sound (lighter for the Wi-Fi and the laptop), but they record and
// send every clip. When a live camera leaves, the first one waiting moves up; Swap in trades
// a waiting phone for the live camera that's been off air longest.
let liveLimit = Math.max(1, Math.min(24, Number(localStorage.getItem('vm_livelimit_' + eventId) || localStorage.getItem('vm_livelimit_default') || 12)));
const lastOnAir = new Map();
$('#liveLimit').value = liveLimit;
$('#liveLimit').onchange = (e) => {
  liveLimit = Math.max(1, Math.min(24, Math.round(+e.target.value || 12)));
  e.target.value = liveLimit;
  localStorage.setItem('vm_livelimit_' + eventId, liveLimit);
  localStorage.setItem('vm_livelimit_default', liveLimit);
  note(`Live pictures: up to ${liveLimit}`);
  rebalanceSlots();
};
function sendSlot(peer, tries = 0) {
  const l = live.get(peer);
  if (!l) return;
  if (!hub?.message(peer, { t: 'slot', live: !l.overflow }) && tries < 15) setTimeout(() => sendSlot(peer, tries + 1), 1000);
}
function setSlot(peer, isLive) {
  const l = live.get(peer);
  if (!l || !!l.overflow === !isLive) return;
  l.overflow = !isLive;
  sendSlot(peer);
  note(isLive ? `${l.name} is live again` : `${l.name} is recording only`);
}
function rebalanceSlots() {
  const cams = [...live].filter(([, l]) => l.role !== 'mic').sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  let shown = cams.filter(([, l]) => !l.overflow).length;
  // limit lowered: the most recent joiners that aren't on air step back first
  for (const [peer, l] of cams.slice().reverse()) {
    if (shown <= liveLimit) break;
    if (!l.overflow && peer !== liveActive) (setSlot(peer, false), shown--);
  }
  // room again: whoever has waited longest comes up
  for (const [peer, l] of cams) {
    if (shown >= liveLimit) break;
    if (l.overflow) (setSlot(peer, true), shown++);
  }
  renderLive();
  renderMixer();
}
function swapIn(peer) {
  const out = camOrder().filter((p) => p !== liveActive).sort((a, b) => (lastOnAir.get(a) || 0) - (lastOnAir.get(b) || 0))[0];
  if (camOrder().length >= liveLimit) {
    if (!out) return toast('Every live camera is on air right now');
    setSlot(out, false);
  }
  setSlot(peer, true);
  announce(`${live.get(peer)?.name} is live${out ? `; ${live.get(out)?.name} records only` : ''}`);
  renderLive();
  renderMixer();
}
function renderOverflow() {
  const waiting = [...live].filter(([, l]) => l.overflow).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  $('#overflowBox').hidden = !waiting.length;
  $('#ovCount').textContent = waiting.length ? `${waiting.length}` : '';
  $('#ovList').innerHTML = waiting.map(([peer, l]) => {
    const rec = l.tele?.rec ?? l.rec;
    return `<li><span class="nm">${esc(l.name)}</span><span class="rs ${rec ? 'on' : ''}">${rec ? '● recording' : 'standing by'}</span><button type="button" data-swap="${esc(peer)}" aria-label="Swap ${esc(l.name)} in to the live pictures">Swap in</button></li>`;
  }).join('');
}
$('#ovList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-swap]');
  if (b) swapIn(b.dataset.swap);
});
setInterval(() => mode === 'live' && renderOverflow(), 2000);

// ---- how many phones one studio can carry ------------------------------------------------
// Each phone's live picture is about 1.2 Mbps; the real limits are the laptop decoding them
// all and the Wi-Fi carrying full-quality clips too. Past about a dozen, say so (they still
// record and send their clips).
const COMFORTABLE_CAMERAS = 12;
let warnedCrowd = false;
function checkCrowd() {
  const cams = camOrder().length;
  if (cams > COMFORTABLE_CAMERAS && !warnedCrowd) {
    warnedCrowd = true;
    toast(`${cams} cameras live. One device shows about ${COMFORTABLE_CAMERAS} smoothly; more can stutter. Everyone still records and sends their clips. See Help → Network and capacity.`, 8000);
    note(`${cams} cameras live (more than about ${COMFORTABLE_CAMERAS} can stutter on one device)`);
  }
}

// ---- diagnostics for this studio ---------------------------------------------------------
async function studioDiagSections() {
  const phones = [...live.values()].map((l) => `${l.name} · ${l.role}${l.fixed ? ' (computer)' : ''} · ${l.route || '?'}${l.paused ? ' · paused' : ''}`);
  return [
    ['Studio', [
      `Event ${eventId} "${ev?.title || ''}" · ${isHost ? 'host' : 'viewer'} · ${mode} · output ${orientation}`,
      `Sound engine: ${player.ctx.state} · editing ${seq.tracks.length} tracks, ${S.end(seq) ? fmtDur(S.end(seq)) : 'empty'}`,
      `Program recording format: ${pgmFormat ? `${pgmFormat.container} · ${pgmFormat.video} + ${pgmFormat.audio} (${pgmFormat.mime})${pgmFormat.iphone ? '' : ' — iPhones can\'t play this'}` : 'not tested yet'}`,
      `Recordings received: ${clips.length} (${clips.filter((c) => c.kind === 'audio').length} sound only)`,
      `Live cut: ${$('#pgmState')?.textContent || '—'}`,
    ]],
    ['Phones connected', phones.length ? phones : ['none']],
    ['Edit sound', [
      ...seq.tracks.filter((t) => t.kind === 'audio').map((t) => `${t.name}: ${t.muted ? 'muted' : `${Math.round(20 * Math.log10(Math.max(1e-6, t.gain ?? 1)))} dB`}${t.follow ? ` · follows the picture${t.duck ? ' · ducks under microphones' : ''}` : ''}${t.mic ? ` · ${t.items.length} recording${t.items.length === 1 ? '' : 's'}` : ''}`),
      `Microphone recordings cover ${Math.round(S.micCover(seq).reduce((s, [a, b]) => s + b - a, 0) / 1000)} s of the film (camera sound ducks there)`,
      ...(await Promise.all(clips.filter((c) => c.kind !== 'audio').slice(-8).map(async (c) => `${c.name} ${new Date(c.t0).toTimeString().slice(0, 8)}${c.local ? ' (this computer)' : ''}: ${c.mime || '?'} · sound ${({ true: 'yes', false: 'NONE', null: '?' })[String(typeof c.sound === 'boolean' ? c.sound : rawBlobs.get(c.id) ? await fileHasSound(rawBlobs.get(c.id)) : null)]}`))),
    ]],
    ['Event log (newest first)', log.slice(0, 30).map((x) => `${new Date(x.at).toTimeString().slice(0, 8)} ${x.text}`)],
  ];
}
const openStudioDiag = diagnosticsDialog(studioDiagSections);
window.vmDiag = studioDiagSections; // (tests and diagnostics)
window.vmProgram = () => (seq.tracks.find((t) => t.id === 't-prog')?.items || []).map((it) => { const c = clips.find((k) => k.id === it.src); return { id: it.id, name: c?.name, local: !!c?.local, reel: !!c?.reel, program: !!c?.program, start: Math.round(it.start), dur: Math.round(it.dur), dissolve: it.transIn?.dur || 0, fadeIn: it.fadeIn || 0, fadeOut: it.fadeOut || 0, type: it.type }; });
window.vmSeek = (ms) => player.seek(ms); // (tests and diagnostics)
window.vmSelect = (id) => select(id);
if (!EDIT_ONLY) {
  // in the studio (tests and diagnostics): the timeline as the Edit window last saved it, and
  // seek and select asked of it over the channel (it's in its own process)
  const programOf = window.vmProgram;
  window.vmProgram = () => {
    const saved = loadSeq();
    if (!saved) return [];
    const mine = seq;
    seq = saved;
    try {
      return programOf();
    } finally {
      seq = mine;
    }
  };
  window.vmSeek = (ms) => editCh?.postMessage({ t: 'seek', ms });
  window.vmSelect = (id) => editCh?.postMessage({ t: 'select', id });
}
window.vmNotes = () => log.slice(0, 30).map((x) => x.text); // (tests and diagnostics: the event log, newest first)
window.vmLocal = () => [...live].filter(([, l]) => l.local).map(([p, l]) => ({ peer: p, rec: !!l.rec, recorder: l.recorder?.state || null, aired: localAired(p), black: black.target, cleared: black.cleared }));
window.vmClipList = () => clips.map((c) => ({ name: c.name, kind: c.kind, local: !!c.local, reel: !!c.reel, program: !!c.program, dur: c.dur }));
help.querySelector('.bd').insertAdjacentHTML('beforeend', '<h3>Something not working?</h3><p>Copy a diagnostics report and send it along: it describes this computer, its browser and what just happened (not your recordings).</p><p><button type="button" id="diagBtn">Copy diagnostics…</button></p>');
help.querySelector('#diagBtn').onclick = () => { help.close(); openStudioDiag(); };

// ---------------------------------------------------------------- incoming ----

const incoming = new Map();
// Transfers live in the Monitor (coming in, going out, received, sent), not in the studio's
// layout; the Monitor button's light shows when something's moving and when there's news.
const outgoing = new Map(), sentLog = [];
function renderIncoming(p) {
  if (p.done) incoming.delete(p.id);
  else incoming.set(p.id, { ...p, at: incoming.get(p.id)?.at || Date.now() });
  monitorLight();
}
let monitorSeenAt = Date.now(), lastLight = '';
function monitorLight() {
  const busy = incoming.size + outgoing.size > 0;
  const news = log.filter((x) => x.at > monitorSeenAt).length;
  const sig = `${busy}|${news}`;
  if (sig === lastLight) return;
  lastLight = sig;
  const b = $('#monitorBtn');
  b.classList.toggle('busy', busy);
  b.classList.toggle('news', news > 0);
  b.title = [busy ? `${incoming.size ? `${incoming.size} coming in` : ''}${incoming.size && outgoing.size ? ', ' : ''}${outgoing.size ? `${outgoing.size} going out` : ''}` : '', news ? `${news} new in the event log` : '', 'Open the monitor: phones, transfers and the event log'].filter(Boolean).join(' · ');
}
setInterval(monitorLight, 1000);

// ---------------------------------------------------------------- edit mode ---

function renderMulti() {
  const box = $('#multi');
  box.querySelector('.empty')?.remove();
  box.querySelectorAll('.cam, [data-peer]').forEach((t) => (t.style.display = 'none'));
  box.querySelectorAll('.tile[data-angle]').forEach((t) => t.remove());
  const cids = editAngles();
  $('#srcCount').textContent = cids.length ? `${cids.length} angle${cids.length > 1 ? 's' : ''}` : '';
  if (!cids.length) {
    box.insertAdjacentHTML('afterbegin', `<div class="empty">No clips yet. When a phone stops recording, its full-quality clip comes straight to this device and appears here.</div>`);
    return;
  }
  for (const cid of cids) {
    const n = angleOfCid(cid);
    const list = videoClips().filter((c) => c.cid === cid);
    const shown = clipForAngle(n, player.t) || list[0];
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'tile';
    tile.dataset.angle = String(n);
    tile.innerHTML = `${thumbs.get(shown.id) ? `<img src="${thumbs.get(shown.id)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}<span class="n" style="color:${COLORS[(n - 1) % COLORS.length]}">${n}</span><span class="who">${esc(shown.name)} · ${list.length} clip${list.length > 1 ? 's' : ''}</span>`;
    tile.style.order = n;
    tile.onclick = () => {
      const c = clipForAngle(n, player.t);
      if (c) cutTo(c.id);
      else toast(`Angle ${n} isn't recording at this moment`);
    };
    tile.setAttribute('aria-label', `Cut the Program to angle ${n}, ${shown.name}, at the playhead`);
    tile.classList.toggle('off', !clipForAngle(n, player.t));
    box.append(tile);
  }
}

function renderTimeline() {
  resolveMarkers();
  renderRangeInfo();
  timeline.selected = selectedItem;
  timeline.render();
}

function select(id) {
  selectedItem = id;
  document.querySelectorAll('.item.sel').forEach((el) => el.classList.remove('sel'));
  if (id) document.querySelector(`[data-item="${id}"]`)?.classList.add('sel');
  timeline.selected = id;
  renderInspector();
}

function renderInspector() {
  const box = $('#selPanel');
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f) {
    box.innerHTML = `<h2>Selection</h2><p class="fine" style="margin:0">Click an item on the timeline to trim, move, or change it. ${seq.auto ? 'The Program follows your live cuts until you edit it by hand.' : 'The Program is hand-edited; “Rebuild cuts” starts it over from your live cuts.'}</p>`;
    return;
  }
  const { item: it, track: tr } = f;
  const l = labelOf(it);
  const posOpts = '<option value="">Custom</option>' + Object.keys(TF_PRESETS).map((k) => `<option value="${k}" ${presetOf(it) === k ? 'selected' : ''}>${{ full: 'Full frame', 'top-right': 'Top right', 'top-left': 'Top left', 'bottom-right': 'Bottom right', 'bottom-left': 'Bottom left', 'left-half': 'Left half', 'right-half': 'Right half' }[k]}</option>`).join('');
  const fades = [0, 300, 500, 1000];
  const fadeSel = (name, v) => `<select data-f="${name}" aria-label="${name === 'fadeIn' ? 'Fade in' : 'Fade out'}">${fades.map((x) => `<option value="${x}" ${x === (v || 0) ? 'selected' : ''}>${x ? x / 1000 + ' s' : 'None'}</option>`).join('')}</select>`;
  const isVideo = tr.kind === 'video';
  box.innerHTML = `<h2>Selection</h2>
    <div class="sel">
      <div class="kv"><span>Item</span><b>${esc(l.text)}</b><span>Track</span><span>${esc(tr.name)}</span><span>Starts</span><span class="tc">${fmtDur(it.start)}</span><span>Length</span><span class="tc">${fmtDur(it.dur)}</span></div>
      ${it.type === 'title' ? `<label for="selText">Text</label><input type="text" id="selText" value="${esc(it.text || '')}"><label for="selSub">Second line</label><input type="text" id="selSub" value="${esc(it.sub || '')}">` : ''}
      ${it.type === 'slate' ? `<label for="selText">Message</label><input type="text" id="selText" value="${esc(it.text || '')}"><label for="selLook">Look</label><select id="selLook">${SLATE_LOOKS.map(([id, nm]) => `<option value="${id}" ${(it.look || 'bars') === id ? 'selected' : ''}>${esc(nm)}</option>`).join('')}</select>` : ''}
      ${isVideo && it.type === 'clip' ? `<label for="selRot">Rotation</label><select id="selRot">${[0, 90, 180, 270].map((r) => `<option value="${r}" ${(it.rot || 0) === r ? 'selected' : ''}>${r ? r + '° clockwise' : 'As recorded'}</option>`).join('')}</select>${shapeOf(it) ? `<p class="fine" style="margin:4px 0 0">This shot is ${shapeOf(it)}${shapeOf(it) !== orientation ? ` — the output is ${orientation}, so it's ${it.fit === 'fit' ? 'shown whole with bars' : 'cropped to fill'}.` : '.'}</p>` : ''}` : ''}
      ${isVideo && (it.type === 'clip' || it.type === 'image') ? `<label for="selPos">Layout</label><select id="selPos">${posOpts}</select>${transformFields(it)}
        <label for="selFit">Framing</label><select id="selFit"><option value="" ${!it.fit ? 'selected' : ''}>Same as output</option><option value="fill" ${it.fit === 'fill' ? 'selected' : ''}>Fill</option><option value="fit" ${it.fit === 'fit' ? 'selected' : ''}>Whole shot</option></select>` : ''}
      ${isVideo && it.type === 'clip' && S.heldBefore(tr, it) ? `<label for="selDissolve">Dissolve in</label><select id="selDissolve">${[...DISSOLVES, ...(it.transIn?.dur && !DISSOLVES.some(([ms]) => ms === it.transIn.dur) ? [[it.transIn.dur, `${(it.transIn.dur / 1000).toFixed(2)} s (as it was live)`]] : [])].map(([ms, nm]) => `<option value="${ms}" ${(it.transIn?.dur || 0) === ms ? 'selected' : ''}>${ms ? nm : 'Cut (no dissolve)'}</option>`).join('')}</select>` : ''}
      ${isVideo ? `<div class="row" style="gap:8px;margin-top:8px"><label style="margin:0">Fade in ${fadeSel('fadeIn', it.fadeIn)}</label><label style="margin:0">Fade out ${fadeSel('fadeOut', it.fadeOut)}</label></div>` : `<label for="selGain">Clip level</label><input type="range" id="selGain" min="-30" max="12" value="${gainToDb(it.gain ?? 1)}" aria-label="Clip level in decibels">`}
      <div class="row" style="margin-top:10px;gap:6px"><button type="button" id="selSplit">Split</button><button type="button" id="selDup">Duplicate</button><button type="button" id="selDel">Delete</button></div>
    </div>`;
  const edit = (fn) => {
    snapshot();
    if (S.program(seq).items.includes(it)) seq.auto = false;
    fn();
    commit();
  };
  box.querySelector('#selText')?.addEventListener('change', (e) => edit(() => (it.text = e.target.value)));
  box.querySelector('#selSub')?.addEventListener('change', (e) => edit(() => (it.sub = e.target.value)));
  box.querySelector('#selLook')?.addEventListener('change', (e) => edit(() => (it.look = e.target.value)));
  box.querySelector('#selPos')?.addEventListener('change', (e) => {
    if (!TF_PRESETS[e.target.value]) return;
    edit(() => {
      delete it.rect;
      it.tf = { ...tfOf(it), ...TF_PRESETS[e.target.value], r: 0, crop: { l: 0, t: 0, r: 0, b: 0 } };
    });
  });
  bindTransformFields(box, it);
  box.querySelector('#selFit')?.addEventListener('change', (e) => edit(() => (it.fit = e.target.value || null)));
  box.querySelector('#selDissolve')?.addEventListener('change', (e) => setDissolve(it, tr, +e.target.value));
  box.querySelector('#selRot')?.addEventListener('change', (e) => edit(() => (it.rot = +e.target.value || 0)));
  box.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', (e) => edit(() => (it[e.target.dataset.f] = +e.target.value))));
  box.querySelector('#selGain')?.addEventListener('change', (e) => edit(() => (it.gain = dbToGain(+e.target.value))));
  box.querySelector('#selSplit').onclick = () => splitSelected();
  box.querySelector('#selDel').onclick = () => deleteSelected();
  box.querySelector('#selDup').onclick = () => {
    const copy = { ...it, id: undefined, start: it.start + it.dur };
    edit(() => {
      if (tr.kind === 'video' && !tr.program) S.addOverlay(seq, copy);
      else {
        copy.id = Math.random().toString(36).slice(2, 10);
        if (!tr.items.some((o) => copy.start < o.start + o.dur && o.start < copy.start + copy.dur)) tr.items.push(copy), S.sortItems(tr);
        else toast('No room after it on this track');
      }
    });
  };
}

function credits() {
  // Screen time: whoever's clip is the topmost full-frame picture, sampled 10× a second.
  const ms = new Map();
  let total = 0;
  const endT = S.end(seq);
  const vtracks = seq.tracks.filter((t) => t.kind === 'video' && !t.hidden);
  for (let t = 0; t < endT; t += 100) {
    for (const tr of vtracks) {
      const it = S.itemAt(tr, t);
      if (!it || isInset(it)) continue;
      if (it.type !== 'clip') break; // a title card or slate covers everything below
      const c = clipOf(it.src);
      if (c) {
        ms.set(c.cid, { name: c.name, ms: (ms.get(c.cid)?.ms || 0) + 100 });
        total += 100;
      }
      break;
    }
  }
  return [...ms.entries()]
    .map(([cid, v]) => ({ cid, name: v.name, ms: v.ms, share: total ? v.ms / total : 0, poolShare: total ? (v.ms / total) * (ev.poolPct / 100) : 0 }))
    .sort((a, b) => b.ms - a.ms);
}

function soundCredits() {
  return seq.tracks.filter((t) => t.mic && !t.muted && (t.gain ?? 1) > 0).map((t) => t.name.replace(/^Mic · /, ''));
}

function renderCredits() {
  const box = $('#credits');
  const list = credits();
  const sound = soundCredits();
  box.hidden = !list.length && !sound.length;
  if (box.hidden) return;
  box.innerHTML = `<h2>Shot by</h2><table>${list
    .map((c) => `<tr><td>${esc(c.name)}</td><td>${(c.share * 100).toFixed(0)}%${ev.poolPct ? ` · ${(c.poolShare * 100).toFixed(1)}% rev` : ''}</td></tr>`)
    .join('')}${sound.map((n) => `<tr><td>${esc(n)}</td><td>sound</td></tr>`).join('')}</table>`;
}

// ------------------------------------------------------------- transforms ----
// Any picture layer can be moved, scaled, rotated, cropped and faded: drag the handles on
// the Program monitor, or type exact values in the inspector. Layers stack like any
// editor: the top track draws last, so a smaller or cropped clip shows the one below.

function presetOf(it) {
  if (!it.tf) return it.rect ? Object.keys(PIP).find((k) => JSON.stringify(PIP[k]) === JSON.stringify(it.rect)) || '' : 'full';
  const t = tfOf(it);
  if (t.r || t.crop.l || t.crop.t || t.crop.r || t.crop.b) return '';
  return Object.keys(TF_PRESETS).find((k) => {
    const p = TF_PRESETS[k];
    return Math.abs(p.x - t.x) < 0.005 && Math.abs(p.y - t.y) < 0.005 && Math.abs(p.s - t.s) < 0.005;
  }) || '';
}

/** Give an item an explicit transform (converting an old picture-in-picture box). */
function ensureTf(it) {
  if (it.tf) return it.tf;
  const r = it.rect;
  it.tf = r ? { ...tfOf({}), x: r.x + r.w / 2, y: r.y + r.h / 2, s: Math.min(r.w, r.h) } : tfOf({});
  delete it.rect;
  return it.tf;
}

function transformFields(it) {
  const t = tfOf(it);
  const n = (id, label, v, min, max, step, unit) => `<label class="tfl" for="${id}">${label}<span><input type="number" id="${id}" value="${v}" min="${min}" max="${max}" step="${step}">${unit}</span></label>`;
  return `<div class="tfgrid" role="group" aria-label="Transform">
    ${n('tfX', 'X', Math.round(t.x * 1000) / 10, -100, 200, 0.5, '%')}${n('tfY', 'Y', Math.round(t.y * 1000) / 10, -100, 200, 0.5, '%')}
    ${n('tfS', 'Scale', Math.round(t.s * 1000) / 10, 1, 1000, 1, '%')}${n('tfR', 'Rotate', Math.round(t.r * 10) / 10, -360, 360, 1, '°')}
    ${n('tfO', 'Opacity', Math.round(t.o * 100), 0, 100, 1, '%')}
  </div>
  <div class="tfgrid" role="group" aria-label="Crop">
    ${n('tfCl', 'Crop L', Math.round(t.crop.l * 100), 0, 90, 1, '%')}${n('tfCr', 'Crop R', Math.round(t.crop.r * 100), 0, 90, 1, '%')}
    ${n('tfCt', 'Crop T', Math.round(t.crop.t * 100), 0, 90, 1, '%')}${n('tfCb', 'Crop B', Math.round(t.crop.b * 100), 0, 90, 1, '%')}
  </div>
  <button type="button" id="tfReset" class="small">Reset transform</button>
  <p class="fine" id="tfHint" hidden>Move the playhead over this clip to drag it on the viewer.</p>`;
}

function bindTransformFields(box, it) {
  const map = { tfX: ['x', 0.01], tfY: ['y', 0.01], tfS: ['s', 0.01], tfR: ['r', 1], tfO: ['o', 0.01] };
  const crop = { tfCl: 'l', tfCr: 'r', tfCt: 't', tfCb: 'b' };
  let snapped = false;
  box.querySelectorAll('.tfgrid input').forEach((inp) => {
    inp.addEventListener('input', () => {
      if (!snapped) {
        snapshot();
        snapped = true;
        if (S.program(seq).items.includes(it)) seq.auto = false;
      }
      const tf = ensureTf(it);
      const v = parseFloat(inp.value);
      if (!Number.isFinite(v)) return;
      if (map[inp.id]) tf[map[inp.id][0]] = v * map[inp.id][1];
      else {
        tf.crop = { ...tfOf(it).crop, [crop[inp.id]]: Math.max(0, Math.min(0.9, v / 100)) };
        const c = tf.crop;
        if (c.l + c.r > 0.95) c[crop[inp.id]] = Math.max(0, 0.95 - (c.l + c.r - c[crop[inp.id]]));
        if (c.t + c.b > 0.95) c[crop[inp.id]] = Math.max(0, 0.95 - (c.t + c.b - c[crop[inp.id]]));
      }
      if (tf.s < 0.01) tf.s = 0.01;
      tf.o = Math.max(0, Math.min(1, tf.o));
    });
    inp.addEventListener('change', () => {
      snapped = false;
      saveSeq();
      renderTimeline();
    });
  });
  box.querySelector('#tfReset')?.addEventListener('click', () => {
    snapshot();
    delete it.rect;
    it.tf = tfOf({});
    commit();
  });
}

// ---- handles on the Program monitor ----
const xf = $('#xform');
function itemFrameSize(tr, it) {
  if (it.type === 'image') {
    const im = reel.find((r) => r.id === it.asset)?.el;
    return im ? { w: im.naturalWidth || im.videoWidth || 0, h: im.naturalHeight || im.videoHeight || 0, rot: 0 } : null;
  }
  const e = player.els.get(tr.id + '|' + it.src);
  const vw = e?.v.videoWidth, vh = e?.v.videoHeight;
  if (!vw || !vh) return null;
  const view = viewOf(it, S.srcAt(it, player.t));
  const r = view?.rect;
  return { w: vw * (r ? r.w : 1), h: vh * (r ? r.h : 1), rot: ((view?.rot || 0) + (it.rot || 0)) % 360 };
}
function selectedLayer() {
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f || f.track.kind !== 'video' || f.track.hidden || !['clip', 'image'].includes(f.item.type)) return null;
  const t = player.t;
  if (t < f.item.start || t >= f.item.start + f.item.dur) return null;
  return f;
}
/** The selected layer's visible box in CSS pixels over the program canvas. */
function layerBoxCss(f) {
  const size = itemFrameSize(f.track, f.item);
  if (!size) return null;
  const it = f.item;
  const W = program.width, H = program.height;
  let tf = tfOf(it);
  if (!it.tf && it.rect) tf = { ...tf, x: it.rect.x + it.rect.w / 2, y: it.rect.y + it.rect.h / 2, s: Math.min(it.rect.w, it.rect.h) };
  const b = transformBox(tf, W, H, size.w, size.h, it.fit || fit, size.rot);
  const k = program.clientWidth / W;
  return { left: program.offsetLeft + (b.cx - b.w / 2) * k, top: program.offsetTop + (b.cy - b.h / 2) * k, w: b.w * k, h: b.h * k, angle: b.angle, cx: program.offsetLeft + b.cx * k, cy: program.offsetTop + b.cy * k, k };
}
let xfDrag = null;
(function xformLoop() {
  const f = mode === 'edit' && monTab === 'program' && isHost ? selectedLayer() : null;
  // A clip is selected but the playhead isn't over it: say why there are no handles.
  const hint = document.querySelector('#tfHint');
  if (hint) {
    const sel = mode === 'edit' && selectedItem ? S.findItem(seq, selectedItem) : null;
    hint.hidden = !(sel && !f && sel.track.kind === 'video' && ['clip', 'image'].includes(sel.item.type));
  }
  const b = f && layerBoxCss(f);
  xf.hidden = !b;
  if (b && !xfDrag?.live) {
    Object.assign(xf.style, { left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px', transform: `rotate(${b.angle}deg)` });
  } else if (b && xfDrag?.live) {
    Object.assign(xf.style, { left: b.left + 'px', top: b.top + 'px', width: b.w + 'px', height: b.h + 'px', transform: `rotate(${b.angle}deg)` });
  }
  requestAnimationFrame(xformLoop);
})();

xf.addEventListener('pointerdown', (e) => {
  const f = selectedLayer();
  if (!f) return;
  e.preventDefault();
  e.stopPropagation();
  xf.setPointerCapture(e.pointerId);
  snapshot();
  if (S.program(seq).items.includes(f.item)) seq.auto = false;
  const tf = ensureTf(f.item);
  const fr = $('#progFrame').getBoundingClientRect();
  const b = layerBoxCss(f);
  const center = { x: fr.left + b.cx, y: fr.top + b.cy };
  const W = program.width, k = program.clientWidth / W;
  xfDrag = { live: true, h: e.target.dataset.h || 'move', x0: e.clientX, y0: e.clientY, tf0: JSON.parse(JSON.stringify(tf)), center, k,
    d0: Math.hypot(e.clientX - center.x, e.clientY - center.y) || 1, a0: Math.atan2(e.clientY - center.y, e.clientX - center.x) };
});
xf.addEventListener('pointermove', (e) => {
  if (!xfDrag) return;
  const f = selectedLayer();
  if (!f) return;
  const tf = f.item.tf, d = xfDrag;
  if (d.h === 'move') {
    const W = program.width, H = program.height;
    tf.x = d.tf0.x + (e.clientX - d.x0) / (W * d.k);
    tf.y = d.tf0.y + (e.clientY - d.y0) / (H * d.k);
    const near = 8 / (W * d.k);
    if (Math.abs(tf.x - 0.5) < near) tf.x = 0.5; // snap to the centre lines
    if (Math.abs(tf.y - 0.5) < near * (W / H)) tf.y = 0.5;
  } else if (d.h === 'rot') {
    let deg = d.tf0.r + ((Math.atan2(e.clientY - d.center.y, e.clientX - d.center.x) - d.a0) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    else {
      const q = Math.round(deg / 90) * 90;
      if (Math.abs(deg - q) < 3) deg = q; // snap to square
    }
    tf.r = Math.round(deg * 10) / 10;
  } else {
    const dist = Math.hypot(e.clientX - d.center.x, e.clientY - d.center.y);
    tf.s = Math.max(0.03, Math.min(10, d.tf0.s * (dist / d.d0)));
    if (Math.abs(tf.s - 1) < 0.02) tf.s = 1; // snap to full size
  }
});
const xfEnd = () => {
  if (!xfDrag) return;
  xfDrag = null;
  commit();
};
xf.addEventListener('pointerup', xfEnd);
xf.addEventListener('pointercancel', xfEnd);

// Click the picture to select the layer under the pointer (top track first).
program.addEventListener('pointerdown', (e) => {
  if (mode !== 'edit' || monTab !== 'program') return;
  const fr = $('#progFrame').getBoundingClientRect();
  const px = e.clientX - fr.left, py = e.clientY - fr.top;
  const t = player.t;
  for (const tr of seq.tracks) {
    if (tr.kind !== 'video' || tr.hidden) continue;
    const it = S.itemAt(tr, t);
    if (!it || !['clip', 'image'].includes(it.type)) continue;
    const b = layerBoxCss({ track: tr, item: it });
    if (!b) continue;
    const a = (-b.angle * Math.PI) / 180;
    const dx = px - b.cx, dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) {
      select(it.id);
      renderTimeline();
      return;
    }
  }
});

// ---- dissolves in the edit ----
// A dissolve into a shot: the shot before carries on underneath while this one fades in (its
// sound crossfades too). Live dissolves arrive this way in the automatic edit; any cut can
// be made one, or a dissolve made a cut again, from the clip's menu or the Selection panel.
const DISSOLVES = [[0, 'Cut'], [250, '¼ s'], [500, '½ s'], [1000, '1 s'], [2000, '2 s']];
function setDissolve(it, tr, ms) {
  snapshot();
  if (tr.program) seq.auto = false;
  if (ms > 0) it.transIn = { dur: ms };
  else delete it.transIn;
  commit();
  announce(ms ? `Dissolves in over ${ms / 1000} seconds` : 'Cuts in (no dissolve)');
}

// ---- export range (In to Out) and collapsing gaps ------------------------------------------
// I and O on the timeline mark what Render exports, so a long day doesn't have to be
// rendered end to end. Collapse gaps takes out every stretch where no camera was recording. After that (or any hand edit), new live footage goes on the end of the timeline, after a gap as long as the real time since the last part.

function setRange(which) {
  if (which === null) {
    if (!seq.range) return;
    snapshot();
    delete seq.range;
    commit();
    return announce('In and out cleared: Render exports the whole timeline');
  }
  snapshot();
  const t = Math.round(player.t);
  const r = seq.range || { in: 0, out: S.end(seq) };
  r[which] = t;
  if (r.out - r.in < FRAME) which === 'in' ? (r.out = S.end(seq)) : (r.in = 0);
  seq.range = r;
  commit();
  announce(`${which === 'in' ? 'In' : 'Out'} at ${fmtDur(t)}`);
}
function renderRangeInfo() {
  const r = seq.range;
  $('#rangeInfo').innerHTML = r
    ? `Renders <b>${fmtDur(r.in).slice(0, -3)} – ${fmtDur(r.out).slice(0, -3)}</b> (${fmtDur(r.out - r.in).slice(0, -3)}) of the timeline.`
    : 'Renders the whole timeline. Press <kbd>I</kbd> and <kbd>O</kbd> on the timeline to render just part of it.';
  $('#rangeClear').hidden = !r;
  $('#renderBtn').textContent = r ? 'Render In to Out' : 'Render MP4';
}
$('#rangeClear').onclick = () => setRange(null);

// Dissolve (D): into the selected clip, or else the Program shot at the playhead; again takes it off.
function dissolveHere() {
  let f = selectedItem && S.findItem(seq, selectedItem);
  if (!f || f.item.type !== 'clip' || f.track.kind !== 'video') {
    const prog = S.program(seq), t = player.t;
    const it = prog.items.filter((x) => x.type === 'clip' && x.start <= t + 1).sort((a, b) => b.start - a.start)[0];
    f = it ? { item: it, track: prog } : null;
  }
  if (!f) return toast('Pick a clip on the timeline first');
  if (!S.heldBefore(f.track, f.item)) return toast('Nothing right before this clip to dissolve from');
  setDissolve(f.item, f.track, f.item.transIn?.dur ? 0 : 500);
  select(f.item.id);
}
$('#xdBtn').onclick = dissolveHere;
$('#gapsBtn').onclick = () => {
  const gaps = S.videoGaps(seq).filter((g) => g.end - g.start >= FRAME);
  if (!gaps.length) return toast('No gaps: there\'s picture all the way through');
  snapshot();
  seq.auto = false; // the program no longer follows the live cuts by itself
  const total = gaps.reduce((n, g) => n + g.end - g.start, 0);
  S.collapseGaps(seq);
  commit();
  note(`Collapsed ${gaps.length} gap${gaps.length > 1 ? 's' : ''} (${fmtDur(total).slice(0, -3)} of empty time); new live footage will go on the end`);
  toast(`Took out ${gaps.length} gap${gaps.length > 1 ? 's' : ''}: ${fmtDur(total).slice(0, -3)} of empty time (Undo brings it back)`, 5000);
};

// ---- right-click menus ------------------------------------------------------------------
// Like any editor: right-click a clip on the timeline, a camera tile or a media item for
// what you can do with it. Shift+F10 or the Menu key opens it from the keyboard.
const ctxEl = Object.assign(document.createElement('div'), { className: 'ctxmenu', hidden: true });
ctxEl.setAttribute('role', 'menu');
const ctxSubEl = Object.assign(document.createElement('div'), { className: 'ctxmenu', hidden: true });
ctxSubEl.setAttribute('role', 'menu');
document.body.append(ctxEl, ctxSubEl);
let ctxItems = [], ctxSubItems = [], ctxReturn = null;

function menuHtml(items, title) {
  return (title ? `<div class="ctxtitle">${esc(title)}</div>` : '') + items.map((it, i) => (it.sep ? '<hr>'
    : `<button type="button" role="menuitem" data-i="${i}" tabindex="-1" ${it.disabled ? 'aria-disabled="true"' : ''} ${it.sub ? 'aria-haspopup="menu" aria-expanded="false"' : ''}><span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.sub ? '<b aria-hidden="true">▸</b>' : ''}</button>`)).join('');
}
function place(el, x, y) {
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  el.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function openMenu(x, y, items, title) {
  closeMenu();
  ctxReturn = document.activeElement;
  ctxItems = items;
  ctxEl.innerHTML = menuHtml(items, title);
  ctxEl.setAttribute('aria-label', title || 'Menu');
  place(ctxEl, x, y);
  ctxEl.querySelector('button:not([aria-disabled="true"])')?.focus();
}
function openSub(btn) {
  const it = ctxItems[+btn.dataset.i];
  if (!it?.sub) return;
  ctxEl.querySelectorAll('.open').forEach((b) => (b.classList.remove('open'), b.setAttribute('aria-expanded', 'false')));
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  ctxSubItems = it.sub;
  ctxSubEl.innerHTML = menuHtml(it.sub);
  const r = btn.getBoundingClientRect();
  place(ctxSubEl, r.right + 2, r.top - 4);
  if (ctxSubEl.getBoundingClientRect().left < r.right) place(ctxSubEl, r.left - ctxSubEl.offsetWidth - 2, r.top - 4);
}
function closeMenu(restore = false) {
  if (ctxEl.hidden) return;
  ctxEl.hidden = ctxSubEl.hidden = true;
  if (restore) ctxReturn?.focus?.();
}
function runItem(list, btn) {
  const it = list[+btn.dataset.i];
  if (!it || it.disabled) return;
  if (it.sub) return openSub(btn), ctxSubEl.querySelector('button:not([aria-disabled="true"])')?.focus();
  closeMenu();
  it.action?.();
}
ctxEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) runItem(ctxItems, b); });
ctxSubEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) runItem(ctxSubItems, b); });
ctxEl.addEventListener('pointerover', (e) => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  if (ctxItems[+b.dataset.i]?.sub) openSub(b);
  else if (!ctxSubEl.hidden) (ctxSubEl.hidden = true), ctxEl.querySelectorAll('.open').forEach((x) => x.classList.remove('open'));
});
for (const [el, list, isSub] of [[ctxEl, () => ctxItems, false], [ctxSubEl, () => ctxSubItems, true]]) {
  el.addEventListener('keydown', (e) => {
    const btns = [...el.querySelectorAll('button:not([aria-disabled="true"])')];
    const i = btns.indexOf(document.activeElement);
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (document.activeElement?.dataset.i) runItem(list(), document.activeElement);
    } else if (e.key === 'ArrowRight' && !isSub && document.activeElement?.getAttribute('aria-haspopup')) {
      e.preventDefault();
      runItem(list(), document.activeElement);
    } else if ((e.key === 'ArrowLeft' && isSub) || (e.key === 'Escape' && isSub)) {
      e.preventDefault();
      ctxSubEl.hidden = true;
      ctxEl.querySelector('.open')?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
    }
  });
}
document.addEventListener('pointerdown', (e) => { if (!ctxEl.hidden && !e.target.closest('.ctxmenu')) closeMenu(); }, true);
window.addEventListener('blur', () => closeMenu());

/** Swap a clip's media, keeping its place on the timeline (and its transform). */
function replaceMedia(f, c, how) {
  const it = f.item;
  snapshot();
  if (how === 'source') {
    it.src = c.id;
    it.in = srcMon.in;
    it.dur = Math.max(FRAME, Math.min(it.dur, srcMon.out - srcMon.in));
  } else {
    // the same moment from another camera, so it stays in sync
    const abs = it.start + (seq.origin ?? 0);
    it.src = c.id;
    it.in = abs - c.t0 + (c.inBase || 0);
    it.dur = Math.max(FRAME, Math.min(it.dur, c.t0 + c.dur - abs));
  }
  if (f.track.program) seq.auto = false;
  commit();
  select(it.id);
  note(`Replaced the media with ${clipTitle(c)}`);
  announce(`Media replaced with ${clipTitle(c)}`);
}
function setItemSpeed(f, v) {
  snapshot();
  const r = S.setSpeed(seq, f.item.id, v);
  if (f.track.program) seq.auto = false;
  commit();
  const pct = Math.round(v * 100);
  const msg = v === 1 ? 'Back to normal speed' : `Speed ${pct}%${r?.capped ? ', trimmed to fit before the next clip' : ''}. Its sound is off at this speed.`;
  toast(msg, 4000);
  announce(msg);
}
function applyPreset(f, k) {
  snapshot();
  delete f.item.rect;
  f.item.tf = { ...tfOf({}), ...TF_PRESETS[k] };
  if (f.track.program) seq.auto = false;
  commit();
}

function itemMenu(f, x, y) {
  const it = f.item, tr = f.track;
  const items = [];
  if (it.type === 'clip' && tr.kind === 'video') {
    const abs = it.start + (seq.origin ?? 0);
    const alts = videoClips().filter((c) => c.id !== it.src && abs >= c.t0 && abs < c.t0 + c.dur);
    const sub = alts.map((c) => ({ label: `Camera ${angleNo(c.id)} · ${c.name} (same moment)`, action: () => replaceMedia(f, c, 'sync') }));
    if (srcMon.clip && srcMon.clip.kind !== 'audio' && srcMon.clip.id !== it.src) {
      if (sub.length) sub.push({ sep: true });
      sub.push({ label: `Source monitor: ${clipTitle(srcMon.clip)} (from its In)`, action: () => replaceMedia(f, srcMon.clip, 'source') });
    }
    if (!sub.length) sub.push({ label: 'No other camera was rolling here. Load a clip in the Source monitor to use it.', disabled: true });
    items.push({ label: 'Replace media with', sub });
    items.push({ label: 'Open in Source monitor', action: () => { loadSource(it.src, { in: it.in || 0, out: (it.in || 0) + it.dur * S.rate(it) }); setMonTab('source'); } });
    const sp = S.rate(it);
    items.push({ label: `Speed${sp !== 1 ? ` (${Math.round(sp * 100)}%)` : ''}`, sub: [[0.25, '25% · quarter speed'], [0.5, '50% · slow motion'], [1, '100% · normal'], [2, '200% · double speed'], [4, '400%']].map(([v, l]) => ({ label: (v === sp ? '✓ ' : '') + l, action: () => setItemSpeed(f, v) })) });
    items.push({ sep: true });
  }
  const inside = player.t > it.start + 1 && player.t < it.start + it.dur - 1;
  items.push({ label: 'Split at playhead', kbd: '⌘K', disabled: !inside, action: () => { select(it.id); splitSelected(); } });
  if (tr.kind === 'video' && ['clip', 'image'].includes(it.type)) {
    items.push({ label: 'Picture-in-picture', sub: [['Top right', 'top-right'], ['Top left', 'top-left'], ['Bottom right', 'bottom-right'], ['Bottom left', 'bottom-left'], ['Left half', 'left-half'], ['Right half', 'right-half']].map(([l, k]) => ({ label: l, action: () => applyPreset(f, k) })).concat([{ sep: true }, { label: 'Full frame', action: () => applyPreset(f, 'full') }]) });
    items.push({ label: 'Reset transform', disabled: !it.tf && !it.rect, action: () => { snapshot(); delete it.rect; delete it.tf; commit(); } });
    items.push({ label: it.fit === 'fit' ? 'Fill the frame (crop)' : 'Show the whole shot (bars)', action: () => { snapshot(); it.fit = it.fit === 'fit' ? 'fill' : 'fit'; if (tr.program) seq.auto = false; commit(); } });
  }
  if (it.type === 'clip') items.push({ label: it.gain === 0 ? 'Unmute this clip\'s sound' : 'Mute this clip\'s sound', action: () => { snapshot(); it.gain = it.gain === 0 ? 1 : 0; commit(); } });
  if (it.type === 'clip' && tr.kind === 'video') {
    const before = S.heldBefore(tr, it), cur = it.transIn?.dur || 0;
    items.push({
      label: `Dissolve in${cur ? ` (${cur / 1000} s)` : ''}`,
      sub: before ? DISSOLVES.map(([ms, nm]) => ({ label: `${ms ? nm : 'Cut (no dissolve)'}${ms === cur ? ' ✓' : ''}`, action: () => setDissolve(it, tr, ms) })) : [{ label: 'Nothing right before it to dissolve from', disabled: true }],
    });
  }
  items.push({ sep: true });
  items.push({ label: 'Delete', kbd: 'Del', action: () => { select(it.id); deleteSelected(); } });
  items.push({ label: 'Ripple delete', kbd: '⇧Del', action: () => { select(it.id); rippleDeleteSelected(); } });
  openMenu(x, y, items, labelOf(it).text);
}

/** A clip from the left panel: open it, place it at the playhead, or make it a picture-in-picture. */
function sourceMenu(c, x, y, at = null, extra = []) {
  const open = () => {
    loadSource(c.id, null);
    if (at != null) setTimeout(() => srcSeek(Math.max(0, at)), 50);
    setMonTab('source');
  };
  openMenu(x, y, [
    { label: 'Open in Source monitor', action: open },
    { sep: true },
    { label: 'Insert at playhead (whole clip, or its In–Out)', kbd: ',', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, null); placeSource('insert'); } },
    { label: 'Overwrite at playhead', kbd: '.', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, null); placeSource('overwrite'); } },
    ...(c.kind !== 'audio' ? [{ label: 'Add as picture-in-picture here', action: () => { if (srcMon.clip?.id !== c.id) loadSource(c.id, at != null ? { in: Math.max(0, at), out: c.dur } : null); addItem('pip'); } }] : []),
    ...extra,
  ], clipTitle(c));
}

$('#timeline').addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-item]');
  if (!el || mode !== 'edit') return;
  const f = S.findItem(seq, el.dataset.item);
  if (!f) return;
  e.preventDefault();
  select(f.item.id);
  itemMenu(f, e.clientX, e.clientY);
});
$('#timeline').addEventListener('keydown', (e) => {
  if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return;
  const el = e.target.closest('[data-item]');
  const f = el && S.findItem(seq, el.dataset.item);
  if (!f) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  itemMenu(f, r.left + 8, r.bottom + 2);
});
// track targets
$('#timeline').addEventListener('click', (e) => {
  const b = e.target.closest('[data-target]');
  if (!b) return;
  const tr = seq.tracks.find((t) => t.id === b.dataset.target);
  if (!tr) return;
  seq.target = { ...(seq.target || {}), [tr.kind]: tr.id };
  saveSeq();
  renderTimeline();
  announce(`Insert and Overwrite now land on ${tr.name}`);
  document.querySelector(`[data-target="${CSS.escape(tr.id)}"]`)?.focus();
});
// camera tiles (Edit) and the media list
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('.tile[data-angle]');
  if (!tile || mode !== 'edit') return;
  const n = +tile.dataset.angle;
  const c = clipForAngle(n, player.t) || videoClips().find((k) => k.cid === angleCids[n - 1]);
  if (!c) return;
  e.preventDefault();
  const at = seq.origin != null ? player.t + seq.origin - c.t0 : 0;
  sourceMenu(c, e.clientX, e.clientY, at >= 0 && at < c.dur ? at : null, [{ sep: true }, { label: 'Cut the Program to this camera here', kbd: String(n), action: () => tile.click() }]);
});
// microphones on this computer: rename or remove
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('button.mic[data-peer]');
  const l = tile && live.get(tile.dataset.peer);
  if (!tile || !l || mode !== 'live' || !isHost) return;
  e.preventDefault();
  if (!l?.local) {
    e.preventDefault();
    return openMenu(e.clientX, e.clientY, [
      { label: 'Put on air', action: () => cutLive(tile.dataset.peer) },
      { sep: true },
      { label: 'Remove from the event…', action: () => askRemove(tile.dataset.peer) },
    ], `${l?.name || 'Microphone'}`);
  }
  openMenu(e.clientX, e.clientY, [
    { label: 'Put on air', action: () => cutLive(tile.dataset.peer) },
    { label: 'Rename…', action: () => renameLocal(tile.dataset.peer) },
    { label: 'Remove from the show', action: () => removeLocalSource(tile.dataset.peer, 'removed') },
  ], `${l.name} · this computer`);
});
// live camera tiles: cut, or fix a stuck picture by hand
$('#multi').addEventListener('contextmenu', (e) => {
  const tile = e.target.closest('.tile[data-peer]');
  if (!tile || mode !== 'live' || !isHost) return;
  const peer = tile.dataset.peer, l = live.get(peer);
  if (!l) return;
  e.preventDefault();
  const n = angleOfCid(l.cid);
  openMenu(e.clientX, e.clientY, [
    { label: 'Cut to this camera', kbd: n ? String(n) : '', action: () => cutLive(peer) },
    { label: 'Put in preview', action: () => setPreview(peer) },
    { sep: true },
    { label: 'Camera control…', action: () => openCcu(peer) },
    ...(l.local
      ? [
          { label: l.recManual ? 'Stop recording' : 'Record (until you stop it)', action: () => setLocalManualRec(peer, !l.recManual) },
          { label: 'Rename…', action: () => renameLocal(peer) },
          { label: 'Remove from the show', action: () => removeLocalSource(peer, 'removed') },
        ]
      : [
          { label: 'Refresh picture', action: () => freshPlayer(peer, 'refreshed by hand') },
          { label: 'Reconnect phone', action: () => reconnectPhone(peer, 'reconnected by hand') },
          { sep: true },
          { label: 'Remove from the event…', action: () => askRemove(peer) },
        ]),
  ], `Camera ${n || '?'} · ${l.name}${l.local ? ' · this computer' : ''}`);
});
$('#refreshPics').onclick = () => {
  const cams = camOrder();
  if (!cams.length) return toast('No live cameras');
  cams.forEach((p) => freshPlayer(p, 'refreshed by hand'));
  toast(`Refreshed ${cams.length} live picture${cams.length > 1 ? 's' : ''}`);
};
document.addEventListener('contextmenu', (e) => {
  const li = e.target.closest('#mediaList [data-kind="clip"][data-id], #mediaList [data-kind="subclip"][data-id]');
  if (!li || mode !== 'edit') return;
  e.preventDefault();
  selectMedia(li.dataset.kind, li.dataset.id);
  const c = clipOf(li.dataset.kind === 'clip' ? li.dataset.id : media.subclips.find((x) => x.id === li.dataset.id)?.src);
  if (c) sourceMenu(c, e.clientX, e.clientY);
});

// ---- program sound meters beside the picture -------------------------------------------
// Left and right, in both rooms: Live reads the program mix, Edit reads the edit's output.
let editMeters = null;
const pmState = [{ v: 0, at: 0 }, { v: 0, at: 0 }];
function setMeters(on) {
  $('#pMeters').hidden = !on;
  document.querySelector('.monitor')?.classList.toggle('withmeters', on);
  $('#meterTgl').setAttribute('aria-pressed', String(on));
  $('#meterTgl').setAttribute('aria-label', on ? 'Hide program sound meters' : 'Show program sound meters');
  localStorage.setItem('vm_pmeters', on ? '1' : '0');
  fitMonitors();
}
$('#meterTgl').onclick = () => setMeters($('#pMeters').hidden);
setMeters(localStorage.getItem('vm_pmeters') !== '0');
// Browsers keep a page's sound paused until a click or key press, and some suspend it again
// (an audio device change, for one). Any click or key here wakes it; if it's still paused
// while something should be playing, a notice over the monitor says so and fixes it.
const wakeAudio = () => player.ctx.state !== 'running' && player.ctx.resume().catch(() => {});
['pointerdown', 'keydown'].forEach((t) => document.addEventListener(t, wakeAudio, true));
$('#soundOff').onclick = () => player.ctx.resume().then(() => announce('Sound on')).catch(() => {});
// (first run on the next frame: it uses things defined further down this file)
requestAnimationFrame(function pmLoop() {
  requestAnimationFrame(pmLoop);
  const wantsSound = player.playing || !srcMon.v.paused || (mode === 'live' && $('#listen')?.checked);
  const off = wantsSound && player.ctx.state !== 'running';
  if ($('#soundOff').hidden === off) $('#soundOff').hidden = !off;
  if ($('#pMeters').hidden) return;
  let pair = null;
  if (mode === 'live') {
    if (mix.meterL) pair = [mix.meterL, mix.meterR];
  } else if (monTab === 'source') pair = srcAudio?.meters || null;
  else if (player.limit) pair = editMeters ||= stereoMeters(player.ctx, player.limit);
  const bars = document.querySelectorAll('#pMeters .pm');
  const t = performance.now();
  bars.forEach((bar, ch) => {
    let peak = 0;
    const an = pair?.[ch];
    if (an) {
      const buf = (an.__buf ||= new Float32Array(an.fftSize));
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
    }
    const db = peak > 0 ? 20 * Math.log10(peak) : -60;
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    const st = pmState[ch];
    if (pct >= st.v || t - st.at > 1500) Object.assign(st, { v: pct, at: t });
    bar.querySelector('.fill').style.setProperty('--lvl', pct + '%');
    bar.querySelector('.peak').style.setProperty('--pk', st.v + '%');
    if (db > -1) bar.classList.add('over'), (bar.__over = t);
    else if (bar.__over && t - bar.__over > 2000) bar.classList.remove('over');
  });
});

// ------------------------------------------------------------- program out ----
// A clean window with just the program, for a TV, projector, or OBS window capture. This
// tab hands it the picture and sound directly; nothing leaves the computer.
let outStream = null;
function programFeed() {
  if (outStream?.getVideoTracks()[0]?.readyState !== 'live') outStream = new MediaStream([programVideoTrack()]);
  let want = null;
  if (mode === 'live') {
    mixInit();
    want = mix.dest.stream.getAudioTracks()[0];
  } else want = player.audioStream().getAudioTracks()[0];
  const have = outStream.getAudioTracks()[0];
  if (want && have !== want) {
    if (have) outStream.removeTrack(have);
    outStream.addTrack(want);
  }
  return outStream;
}
window.vmProgramFeed = programFeed;
$('#progOutBtn').onclick = () => {
  const w = window.open(`/program?e=${eventId}`, 'vm-program-' + eventId, 'popup=yes,width=1280,height=760');
  if (!w) return toast('Your browser blocked the window. Click the blocked-window icon at the right of the address bar, choose Always allow pop-ups from this site, and try again: it will remember.', 6000);
  w.focus();
  note('Program out opened');
  toast('Program out is open: click anywhere in it to fill the screen.', 5000);
  announce('Program out opened in a new window. Click it to go full screen.');
};

// ---------------------------------------------------------------- layout ----
// Panels are resizable: drag a divider (or focus it and use the arrow keys); double-click
// a side divider to hide or show that panel, or the timeline/mixer divider to reset it.
// Live and Edit each remember their own layout.
const LAYOUT_DEFAULT = { live: { left: 360, right: 300, dock: 230 }, edit: { left: 270, right: 320, tl: 300 } };
const layout = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('vm_layout') || '{}');
    return { live: { ...LAYOUT_DEFAULT.live, ...(saved.live || {}) }, edit: { ...LAYOUT_DEFAULT.edit, ...(saved.edit || {}) } };
  } catch {
    return JSON.parse(JSON.stringify(LAYOUT_DEFAULT));
  }
})();
const saveLayout = () => localStorage.setItem('vm_layout', JSON.stringify(layout));
// (the mixer can come right down to one row of strips: it never needs more when they lie flat)
const LIMITS = { left: [160, () => innerWidth * 0.55], right: [220, () => innerWidth * 0.45], tl: [120, () => innerHeight * 0.72], dock: [56, () => innerHeight * 0.6] };
const clampL = (key, v) => Math.round(Math.max(LIMITS[key][0], Math.min(LIMITS[key][1](), v)));
function applyLayout() {
  const L = layout[mode];
  const st = document.documentElement.style;
  st.setProperty('--left', (L.leftHidden ? 0 : clampL('left', L.left)) + 'px');
  st.setProperty('--right', (L.rightHidden ? 0 : clampL('right', L.right)) + 'px');
  if (mode === 'edit') st.setProperty('--tl', clampL('tl', L.tl) + 'px');
  if (mode === 'live') fitDock();
  document.body.classList.toggle('noleft', !!L.leftHidden);
  document.body.classList.toggle('noright', !!L.rightHidden);
  $('#togLeft')?.setAttribute('aria-pressed', String(!L.leftHidden));
  $('#togRight')?.setAttribute('aria-pressed', String(!L.rightHidden));
  for (const [id, key] of [['splitL', 'left'], ['splitR', 'right'], ['splitT', 'tl'], ['splitD', 'dock']]) {
    const el = $('#' + id);
    if (!el) continue;
    el.setAttribute('aria-valuemin', String(LIMITS[key][0]));
    el.setAttribute('aria-valuemax', String(Math.round(LIMITS[key][1]())));
    el.setAttribute('aria-valuenow', String(L[key + 'Hidden'] ? 0 : clampL(key, L[key] ?? LAYOUT_DEFAULT[mode][key] ?? LIMITS[key][0])));
  }
  fitMonitors();
  live.forEach(fitTile);
}
function splitter(id, key, axis, sign) {
  const el = $('#' + id);
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const L = layout[mode];
    const start = axis === 'x' ? e.clientX : e.clientY;
    // (the mixer starts from the height you see, which may be less than the one it was dragged to)
    const v0 = key === 'dock' ? (document.querySelector('.dock')?.getBoundingClientRect().height ?? 0) : L[key + 'Hidden'] ? LIMITS[key][0] : clampL(key, L[key]);
    const mv = (m) => {
      L[key] = clampL(key, v0 + sign * ((axis === 'x' ? m.clientX : m.clientY) - start));
      L[key + 'Hidden'] = false;
      if (key === 'dock') L.dockManual = true; // (you set its height: it stays there)
      applyLayout();
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', up);
      saveLayout();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => {
    const L = layout[mode];
    if (key === 'left' || key === 'right') L[key + 'Hidden'] = !L[key + 'Hidden'];
    else if (key === 'dock') L.dockManual = false; // fit the strips again
    else L[key] = LAYOUT_DEFAULT[mode][key];
    applyLayout();
    saveLayout();
  });
  el.addEventListener('keydown', (e) => {
    const L = layout[mode];
    const step = e.shiftKey ? 60 : 20;
    const more = axis === 'x' ? (sign > 0 ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
    const less = axis === 'x' ? (sign > 0 ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    if (e.key !== more && e.key !== less && e.key !== 'Home') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Home') L[key] = LAYOUT_DEFAULT[mode][key];
    else L[key] = clampL(key, (L[key] ?? LAYOUT_DEFAULT[mode][key]) + (e.key === more ? step : -step));
    if (key === 'dock') L.dockManual = e.key !== 'Home';
    L[key + 'Hidden'] = false;
    applyLayout();
    saveLayout();
  });
}
splitter('splitL', 'left', 'x', 1);
splitter('splitR', 'right', 'x', -1);
splitter('splitT', 'tl', 'y', -1);
splitter('splitD', 'dock', 'y', -1);
$('#togLeft')?.addEventListener('click', () => {
  layout[mode].leftHidden = !layout[mode].leftHidden;
  applyLayout();
  saveLayout();
});
$('#togRight')?.addEventListener('click', () => {
  layout[mode].rightHidden = !layout[mode].rightHidden;
  applyLayout();
  saveLayout();
});
window.addEventListener('resize', applyLayout);

// ------------------------------------------------------------- transport ----

player.on('tick', (t, ended) => {
  if (mode !== 'edit') return;
  $('#clock').textContent = fmtDur(t);
  $('#ptc').textContent = fmtDur(t);
  timeline.movePlayhead(t);
  const playing = player.playing;
  $('#playBtn').textContent = playing ? '❚❚' : '▶';
  $('#playBtn').setAttribute('aria-label', playing ? (player.rate > 1 ? `Pause (${player.rate}× speed)` : 'Pause') : 'Play');
  if (playing) timeline.keepVisible(t);
  if (ended && exporting) exporting.stop();
  const prog = S.itemAt(S.program(seq), t);
  const c = prog && clipOf(prog.src);
  $('#progLabel').textContent = c ? `PROGRAM · ${angleNo(c.id)} ${c.name}` : 'PROGRAM';
  document.querySelectorAll('.tile[data-angle]').forEach((tile) => {
    const n = +tile.dataset.angle;
    tile.classList.toggle('live', !!c && angleOfCid(c.cid) === n);
    tile.classList.toggle('off', !clipForAngle(n, t));
  });
});

$('#playBtn').onclick = () => {
  player.rate = 1;
  player.toggle();
};
$('#zoom').oninput = (e) => {
  timeline.px = +e.target.value;
  renderTimeline();
};

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog[open], summary')) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && k === 'y') {
    e.preventDefault();
    return redo();
  }
  if (mod && k === 'k' && mode === 'edit') {
    e.preventDefault();
    return addEditAll();
  }
  if (mod) return;
  if (e.key === '?') {
    e.preventDefault();
    return help.showModal();
  }
  if (e.key === '`') return setMode(mode === 'live' ? 'edit' : 'live');
  if (k === 'f' && !e.shiftKey && !e.altKey) return toggleFullscreen();
  // Shifted digits are their own commands; read the physical key so any keyboard layout works.
  if (e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    if (mode === 'live') return cycleCameraAudio(+e.code.slice(5));
    if (e.code === 'Digit2') return setMonTab('source');
    if (e.code === 'Digit4') return setMonTab('program');
    return;
  }
  if (/^[1-9]$/.test(k)) {
    if (mode === 'live') {
      const cid = angleCids[+k - 1];
      const peer = camOrder().find((p) => live.get(p).cid === cid) || micPeers().find((p) => micKey(p) === +k);
      if (peer) takeSource(peer);
      else toast(cid ? `Camera ${k} isn't connected` : `Nothing on ${k}`);
    } else {
      const c = clipForAngle(+k, player.t);
      if (c) cutTo(c.id);
      else toast(angleCids[+k - 1] ? `Angle ${k} isn't recording at this moment` : `There's no angle ${k}`);
    }
    return;
  }
  if (mode === 'live') {
    if (k === 'b') toggleBreak();
    // the switcher: Enter = AUTO, Shift+Enter = CUT (not when Enter is pressing a focused button)
    else if (e.key === 'Enter' && !e.target.closest?.('button, a, select, [role="tab"]')) e.shiftKey ? takeCut() : autoTransition();
    else if (k === 'r') recByHand();
    else if (k === 'a') isHost && setAuto(!autoOn);
    else if (k === 'm') markMoment();
    else if (k === 't') $('#ltShow').click();
    else if (k === 'x') toggleBlack(!e.shiftKey);
    else if (k === '[' || k === ']') stepCue(k === ']' ? 1 : -1);
    return;
  }
  // ----- Edit: Premiere Pro keys
  if (k === 'd' && !e.metaKey && !e.ctrlKey && !e.altKey) return dissolveHere(); // (Dissolve, on the timeline)
  if (monTab === 'source') {
    // The Source monitor has focus: its own transport, In/Out, insert and overwrite.
    if (k === ' ' || k === 'k') {
      e.preventDefault();
      if (k === 'k') srcMon.v.pause();
      else srcToggle();
      return;
    }
    if (k === 'l') { player.pause(); srcMon.v.play().catch(() => {}); return; }
    if (k === 'j') return srcSeek(srcMon.v.currentTime * 1000 - 5000);
    if (k === 'arrowleft' || k === 'arrowright') {
      e.preventDefault();
      srcMon.v.pause();
      return srcSeek(srcMon.v.currentTime * 1000 + (e.shiftKey ? 5 * FRAME : FRAME) * (k === 'arrowleft' ? -1 : 1));
    }
    if (k === 'i') return markIn();
    if (k === 'o') return markOut();
    if (k === ',') return placeSource('insert');
    if (k === '.') return placeSource('overwrite');
    if (k === 'home') return srcSeek(srcMon.in);
    if (k === 'end') return srcSeek(srcMon.out);
  }
  if (k === ',' || k === '.') return toast('Open a clip in the Source monitor (Shift+2) to insert or overwrite');
  const tool = Object.entries(TOOLS).find(([, t]) => t.key === k && !e.shiftKey && !e.altKey);
  if (tool) return timeline.setTool(tool[0]);
  if (k === ' ') {
    e.preventDefault();
    player.rate = 1;
    player.toggle();
  } else if (k === 'j') player.seek(player.t - 5000);
  else if (k === 'k') {
    player.pause();
    player.rate = 1;
  } else if (k === 'l') {
    if (!player.playing) {
      player.rate = 1;
      player.play();
    } else player.rate = player.rate === 1 ? 2 : player.rate === 2 ? 4 : 1;
  } else if (k === 'arrowleft' || k === 'arrowright') {
    e.preventDefault();
    const step = (e.shiftKey ? 5 * FRAME : FRAME) * (k === 'arrowleft' ? -1 : 1);
    const f = selectedItem && S.findItem(seq, selectedItem);
    if (e.altKey && f) {
      // nudge the selected item, like Alt+arrow in Premiere
      snapshot();
      if (S.program(seq).items.includes(f.item)) seq.auto = false;
      if (!S.move(seq, f.item.id, f.item.start + step)) toast('No room there');
      commit();
    } else {
      player.pause();
      player.seek(player.t + step);
    }
  } else if (k === 'arrowup' || k === 'arrowdown') {
    e.preventDefault();
    const pts = S.editPoints(seq);
    const t = player.t;
    const to = k === 'arrowup' ? [...pts].reverse().find((p) => p < t - 1) : pts.find((p) => p > t + 1);
    if (to != null) player.seek(to);
  } else if (k === 'home') player.seek(0);
  else if (k === 'end') player.seek(player.duration());
  else if (k === 's') toggleSnap();
  else if (k === 'm') addMarkerHere();
  else if (k === 'i' && !e.altKey) setRange('in');
  else if (k === 'o' && !e.altKey) setRange('out');
  else if (e.altKey && e.code === 'KeyX') setRange(null);
  else if (k === 'q' || k === 'w') rippleTrimToPlayhead(k === 'q' ? 'start' : 'end');
  else if (k === '[' || k === ']') trimToPlayhead(k === '[' ? 'start' : 'end');
  else if (k === 'delete' || k === 'backspace') {
    e.preventDefault();
    if (e.shiftKey || e.altKey) rippleDeleteSelected();
    else deleteSelected();
  } else if (k === '=' || k === '+') zoomBy(1.4);
  else if (k === '-') zoomBy(1 / 1.4);
  else if (e.key === '\\') timeline.zoomToFit();
  else if (k === 't') addItem('lower');
  else if (k === 'p' && e.shiftKey) addItem('pip');
  else if (k === 'escape') select(null);
});

// ---- tool palette ----------------------------------------------------------------------------
function renderTools(active = timeline.tool) {
  $('#toolBtns').innerHTML = Object.entries(TOOLS)
    .map(([id, t]) => `<button type="button" data-tool="${id}" aria-pressed="${id === active}" title="${t.name} (${t.key.toUpperCase()})" aria-keyshortcuts="${t.key.toUpperCase()}">${t.name.split(' ')[0]} <kbd>${t.key.toUpperCase()}</kbd></button>`)
    .join('');
  $('#toolHelp').textContent = {
    select: 'Drag to move, drag edges to trim.',
    ripple: 'Drag an edge: trims and closes the gap on every track.',
    roll: 'Drag a cut point: moves it between the two clips.',
    razor: 'Click a clip to cut it there.',
    slip: 'Drag a clip: shows a different part of it, same place.',
    slide: 'Drag a clip between its neighbours; they trim to fit.',
    hand: 'Drag to scroll the timeline.',
  }[active];
}
$('#toolBtns').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) timeline.setTool(b.dataset.tool);
});
renderTools();

function toggleSnap() {
  timeline.snap = !timeline.snap;
  $('#snapBtn').setAttribute('aria-pressed', String(timeline.snap));
  announce(timeline.snap ? 'Snapping on' : 'Snapping off');
}
$('#snapBtn').onclick = toggleSnap;
function zoomBy(f) {
  timeline.px = Math.max(1, Math.min(240, timeline.px * f));
  $('#zoom').value = Math.round(Math.min(120, timeline.px));
  renderTimeline();
}
$('#fitBtnTl').onclick = () => timeline.zoomToFit();
function addMarkerHere() {
  snapshot();
  const m = S.addMarker(seq, player.t);
  if (!m) return toast('There’s already a marker here');
  m.abs = absAt(player.t, true) ?? undefined; // on footage: it stays with that footage through any edit
  commit();
  announce('Marker added');
}
$('#markerBtn').onclick = addMarkerHere;

// ---- markers and moments on the ruler: drag to move, double-click to rename, right-click --
// They hold on to the footage they were put on, not to a spot on the timeline: a moment
// keeps the event-clock time it was marked at, a marker the time of the footage under it.
// Wherever that footage now sits (after trims, moves, ripple deletes, Collapse gaps, speed
// changes), that's where they go. One where no camera was recording sits by the footage
// either side of it, faded.
function clipSpans() {
  const out = [];
  for (const tr of seq.tracks) {
    if (tr.follow) continue;
    for (const it of tr.items) {
      if (it.type !== 'clip') continue;
      const c = clipOf(it.src);
      if (!c) continue;
      const sp = it.speed || 1;
      const a = c.t0 + (it.in || 0) - (c.inBase || 0); // the event-clock time of the item's first frame
      out.push({ it, a, b: a + it.dur * sp, sp, prog: tr.program ? 1 : 0 });
    }
  }
  return out;
}
/** Event-clock time → {t: timeline time, gap: true if no footage covers it}, or null. */
function timeOfAbs(abs) {
  if (abs == null) return null;
  const spans = clipSpans();
  const hit = spans.filter((x) => abs >= x.a && abs < x.b).sort((p, q) => q.prog - p.prog)[0];
  if (hit) return { t: hit.it.start + (abs - hit.a) / hit.sp, gap: false };
  let before = null, after = null;
  for (const x of spans) {
    if (x.b <= abs && (!before || x.b > before.b)) before = x;
    if (x.a > abs && (!after || x.a < after.a)) after = x;
  }
  if (!before && !after) return seq.origin != null ? { t: Math.max(0, abs - seq.origin), gap: true } : null;
  let t = before ? before.it.start + before.it.dur + (abs - before.b) : after.it.start - (after.a - abs);
  if (before && after) t = Math.min(t, after.it.start); // its gap was taken out: at the cut
  return { t: Math.max(0, t), gap: true };
}
/** Timeline time → the event-clock time of the footage there (null if `exact` and there's none). */
function absAt(t, exact = false) {
  const spans = clipSpans();
  const hit = spans.filter((x) => t >= x.it.start && t < x.it.start + x.it.dur).sort((p, q) => q.prog - p.prog)[0];
  if (hit) return hit.a + (t - hit.it.start) * hit.sp;
  if (exact) return null;
  let before = null, after = null;
  for (const x of spans) {
    const e = x.it.start + x.it.dur;
    if (e <= t && (!before || e > before.it.start + before.it.dur)) before = x;
    if (x.it.start > t && (!after || x.it.start < after.it.start)) after = x;
  }
  if (before) return before.b + (t - before.it.start - before.it.dur);
  if (after) return after.a - (after.it.start - t);
  return seq.origin != null ? seq.origin + t : null;
}
/** Put every anchored marker where its footage is now. */
function resolveMarkers() {
  if (!seq.markers?.length) return;
  for (const m of seq.markers) {
    if (m.abs == null) continue;
    const at = timeOfAbs(m.abs);
    if (!at) continue;
    m.t = Math.round(at.t);
    m.gap = at.gap || undefined;
  }
  seq.markers.sort((a, b) => a.t - b.t);
}
const markerName = (m) => m.name || (m.moment ? 'Moment' : 'Marker');
const markerEl = (id) => document.querySelector(`[data-marker="${CSS.escape(id)}"]`);
function moveMarker(m, t) {
  t = Math.max(0, Math.round(t));
  if (m.moment) {
    if (seq.origin == null) return;
    const abs = absAt(t);
    if (abs == null) return;
    media.updateMoment(m.id, { t: Math.round(abs) });
    momentsChanged();
  } else {
    const mk = (seq.markers || []).find((x) => x.id === m.id);
    if (!mk) return;
    snapshot();
    mk.t = t;
    mk.abs = absAt(t, true) ?? undefined;
    seq.markers.sort((a, b) => a.t - b.t);
    commit();
  }
  announce(`${markerName(m)} moved to ${fmtDur(t)}`);
  markerEl(m.id)?.focus();
}
function renameMarker(m) {
  const el = markerEl(m.id);
  if (!el) return;
  renamePopover(el, m.name || '', m.moment ? 'Name this moment' : 'Name this marker', (v) => {
    if (m.moment) renameMoment(m.id, v);
    else {
      const mk = (seq.markers || []).find((x) => x.id === m.id);
      if (!mk || (mk.name || '') === v) return;
      snapshot();
      mk.name = v;
      commit();
      announce(v ? `Marker named ${v}` : 'Marker name cleared');
    }
    markerEl(m.id)?.focus();
  });
}
function deleteMarker(m) {
  if (m.moment) return deleteMoment(m.id);
  snapshot();
  seq.markers = (seq.markers || []).filter((x) => x.id !== m.id);
  commit();
  announce(`${markerName(m)} deleted`);
}
function markerMenu(m, x, y) {
  openMenu(x, y, [
    { label: 'Go to it', action: () => player.seek(m.t) },
    { label: 'Rename…', kbd: 'Enter', action: () => renameMarker(m) },
    { label: 'Move it to the playhead', disabled: Math.abs(player.t - m.t) < FRAME, action: () => moveMarker(m, player.t) },
    ...(m.moment ? [
      { label: 'Make clips from every angle', action: () => clipsOfMoment(m.id) },
      { label: 'Show it in Media', action: () => { setLeftTab('media'); selectMedia('moment', m.id); } },
    ] : []),
    { sep: true },
    { label: m.moment ? 'Delete this moment' : 'Delete this marker', kbd: 'Del', action: () => deleteMarker(m) },
  ], `${m.moment ? 'Moment' : 'Marker'} · ${markerName(m)} · ${fmtDur(m.t).slice(0, -3)}`);
}
/** A small text box under an element, for renaming. Enter or clicking away saves; Esc cancels. */
function renamePopover(anchor, value, label, onDone) {
  document.querySelector('.renamepop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'renamepop';
  pop.innerHTML = `<input type="text" maxlength="60" aria-label="${esc(label)}" placeholder="${esc(label)}">`;
  const input = pop.querySelector('input');
  input.value = value;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  place(pop, r.left - 8, r.bottom + 6);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    pop.remove();
    if (save && v !== value) onDone(v);
    else if (anchor.isConnected) anchor.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}
$('#turnsBtn').onclick = () => {
  snapshot();
  const n = S.splitAtOrientation(seq, (id) => clipOf(id)?.orient);
  if (!n) return toast('No clips change orientation inside the timeline');
  if (n) seq.auto = false;
  commit();
  toast(`Split ${n} time${n > 1 ? 's' : ''} where phones were turned`);
};

function addEditAll() {
  snapshot();
  const n = S.addEdit(seq, player.t);
  if (!n) return toast('Nothing under the playhead to cut');
  seq.auto = false;
  commit();
  announce(`Cut ${n} track${n > 1 ? 's' : ''}`);
}

/** Q / W: ripple trim the item under the playhead (on the selected item's track, or the Program). */
function rippleTrimToPlayhead(edge) {
  const f = selectedItem && S.findItem(seq, selectedItem);
  const tr = f?.track || S.program(seq);
  const it = S.itemAt(tr, player.t) || (f && f.item);
  if (!it) return toast('Nothing under the playhead on that track');
  snapshot();
  if (tr.program) seq.auto = false;
  const ok = S.rippleTrim(seq, it.id, edge, player.t, it.type === 'clip' ? clipOf(it.src)?.dur ?? Infinity : Infinity);
  if (!ok) return toast('Nothing to trim there');
  if (edge === 'start') player.seek(it.start);
  commit();
  announce(edge === 'start' ? 'Ripple trimmed the start' : 'Ripple trimmed the end');
}

function rippleDeleteSelected() {
  if (!selectedItem) return toast('Select an item to ripple delete');
  snapshot();
  const f = S.findItem(seq, selectedItem);
  if (f?.track.program) seq.auto = false;
  if (!S.rippleDelete(seq, selectedItem)) return toast('That track is locked');
  selectedItem = null;
  commit();
  announce('Ripple deleted');
}

// -------------------------------------------------------------- edit ops ----

/** Number keys in Edit: switch the Program's angle at the playhead. */
function cutTo(id) {
  if (!isHost) return toast('Open your studio link to cut');
  const c = clipOf(id);
  const t = player.t;
  if (seq.origin == null || t + seq.origin < c.t0 || t + seq.origin >= c.t0 + c.dur) return toast(`Angle ${angleNo(id)} isn't recording at this moment`);
  snapshot();
  if (seq.auto) {
    // still following the cut log: record the decision there and rebuild
    const abs = t + seq.origin;
    cut.edl = cut.edl.filter((e) => Math.abs(e.t - abs) > FRAME);
    cut.edl.push({ t: abs, clip: id });
    saveCut();
    rebuild(false);
  } else {
    S.cutProgramAt(seq, t, c);
  }
  commit();
  announce(`Cut to angle ${angleNo(id)}`);
}

function splitSelected() {
  let id = selectedItem;
  if (!id) id = S.itemAt(S.program(seq), player.t)?.id;
  if (!id) return toast('Nothing under the playhead to split');
  snapshot();
  const f = S.findItem(seq, id);
  if (f && S.program(seq).items.includes(f.item)) seq.auto = false;
  const right = S.splitAt(seq, id, player.t);
  if (!right) return toast('Move the playhead inside the item to split it');
  commit();
  announce('Split');
}

function trimToPlayhead(edge) {
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (!f) return toast('Select an item to trim');
  snapshot();
  if (S.program(seq).items.includes(f.item)) seq.auto = false;
  S.trim(seq, f.item.id, edge, player.t, f.item.type === 'clip' ? clipOf(f.item.src)?.dur ?? Infinity : Infinity);
  commit();
  announce(edge === 'start' ? 'Trimmed start' : 'Trimmed end');
}

function deleteSelected() {
  if (!selectedItem) return toast('Select an item to delete');
  snapshot();
  const f = S.findItem(seq, selectedItem);
  if (f && S.program(seq).items.includes(f.item)) seq.auto = false;
  S.remove(seq, selectedItem);
  selectedItem = null;
  commit();
  announce('Deleted');
}

function addItem(kind) {
  if (!isHost) return;
  document.querySelector('.addmenu')?.removeAttribute('open');
  const t = player.t;
  const room = Math.max(1000, (S.end(seq) || 10000) - t);
  if (kind === 'vtrack' || kind === 'atrack') {
    snapshot();
    S.addTrack(seq, kind === 'vtrack' ? 'video' : 'audio');
    return commit();
  }
  let item;
  if (kind === 'lower') item = { type: 'title', style: 'lower', text: 'Name', sub: 'What they do', start: t, dur: Math.min(5000, room), fadeIn: 300, fadeOut: 300 };
  else if (kind === 'card') item = { type: 'title', style: 'card', text: ev.title, sub: new Date(ev.createdAt || Date.now()).toLocaleDateString(), start: t, dur: Math.min(4000, room), fadeIn: 500, fadeOut: 500 };
  else if (kind === 'slate') item = { type: 'slate', text: "We'll be right back", look: slateLook, start: t, dur: Math.min(5000, room) };
  else if (kind === 'image') {
    const pickImage = (asset) => {
      snapshot();
      const tr = S.addOverlay(seq, { type: 'image', asset: asset.id, start: t, dur: Math.min(5000, room), tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fit: 'fit', fadeIn: 300, fadeOut: 300 });
      commit();
      select(tr.items.find((x) => x.asset === asset.id && x.start === t)?.id);
    };
    const img = reel.find((r) => r.type.startsWith('image/'));
    if (img && confirm(`Use "${img.name}" from your media? (Cancel to choose a new image.)`)) return pickImage(img);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => input.files[0] && pickImage(fileToReel(input.files[0]));
    return input.click();
  } else if (kind === 'pip') {
    // The clip in the Source monitor (from its In) if there is one; otherwise another camera
    // rolling right now. Right-click it afterwards to swap the media.
    if (srcMon.clip && srcMon.clip.kind !== 'audio') {
      item = { type: 'clip', src: srcMon.clip.id, start: t, dur: Math.max(FRAME, Math.min(10000, srcMon.out - srcMon.in)), in: srcMon.in, tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fadeIn: 300, fadeOut: 300 };
      toast(`Picture-in-picture from the Source monitor: ${clipTitle(srcMon.clip)}. Right-click it to swap.`, 4000);
    } else {
      const abs = t + (seq.origin ?? 0);
      const onProg = S.itemAt(S.program(seq), t)?.src;
      const onCid = clipOf(onProg)?.cid;
      const c = videoClips().find((k) => k.cid !== onCid && abs >= k.t0 && abs < k.t0 + k.dur);
      if (!c) return toast('Load a clip in the Source monitor (click it in Media), or put the playhead where another camera was rolling');
      item = { type: 'clip', src: c.id, start: t, dur: Math.min(10000, c.t0 + c.dur - abs), in: abs - c.t0, tf: { ...tfOf({}), ...TF_PRESETS['top-right'] }, fadeIn: 300, fadeOut: 300 };
      toast(`Picture-in-picture from camera ${angleNo(c.id)} (${c.name}). Right-click it to swap the media.`, 4000);
    }
  }
  snapshot();
  S.addOverlay(seq, item);
  commit();
  select(item.id);
  announce(`Added ${labelOf(item).text}`);
}
document.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => addItem(b.dataset.add)));
$('#splitBtn').onclick = splitSelected;

$('#rebuildBtn').onclick = () => {
  if (!seq.auto && !confirm('Rebuild the Program track from your live cuts? Hand edits to the Program (not overlays) will be replaced.')) return;
  snapshot();
  seq.auto = true;
  rebuild();
  commit();
};

// Auto-cut in post: the same AI director, reading the quality each phone recorded
// with its clip (steady, level, exposed, right shape for the output).
$('#autoCutBtn').onclick = () => {
  const list = videoClips();
  if (!list.length) return toast('No clips to cut yet');
  if (cut.edl.length && !confirm('Replace your cuts with an automatic cut?')) return;
  snapshot();
  const start = Math.min(...list.map((c) => c.t0));
  const endT = Math.max(...list.map((c) => c.t0 + c.dur));
  const angles = list.map((c) => ({
    id: c.id, t0: c.t0 + media.range(c).in, dur: media.range(c).out - media.range(c).in, fixed: c.device === 'computer',
    scoreAt: (abs) => {
      const ms = abs - c.t0;
      const q = c.qa;
      if (!q?.length) return null;
      let lo = 0, hi = q.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (q[mid][0] <= ms) lo = mid;
        else hi = mid - 1;
      }
      const [, score, sh] = q[lo];
      return { score: score ?? 0.5, upright: sh === 'p' ? 'portrait' : sh === 'l' ? 'landscape' : orientAt(c, ms)?.upright };
    },
  }));
  const planned = planCuts(angles, start, endT, orientation);
  cut.edl = planned.map((p) => ({ t: p.t, clip: p.clip }));
  saveCut();
  seq.auto = true;
  rebuild(false);
  commit();
  const withQa = list.filter((c) => c.qa?.length).length;
  note(`Auto-cut: ${planned.length} cuts from ${withQa} of ${list.length} clips' quality logs`);
  toast(withQa ? `Auto-cut made ${planned.length} cuts, avoiding shaky, dark, or sideways moments.` : `Auto-cut made ${planned.length} cuts. (These clips have no quality log, so it cut for variety.)`, 6000);
};

// ------------------------------------------------------------ media manager ----
// Every recording, subclip and marked moment: search, filter, tag, star, trim,
// delete, and a Source monitor to mark In/Out, make subclips, and insert or
// overwrite onto the timeline (Premiere's , and . keys).

let leftTab = 'angles';
let monTab = 'program';
let mediaSel = null;           // {kind: 'clip'|'subclip'|'moment', id}
let mediaFilter = 'all';
let mediaQuery = '';

function setLeftTab(t) {
  leftTab = t;
  $('#anglesTab').setAttribute('aria-selected', String(t === 'angles'));
  $('#mediaTab').setAttribute('aria-selected', String(t === 'media'));
  $('#multi').hidden = t === 'media' && mode === 'edit';
  $('#mediaPanel').hidden = !(t === 'media' && mode === 'edit');
  $('#srcHead').textContent = mode === 'edit' && t === 'media' ? 'Media' : 'Sources';
  if (t === 'media') renderMedia();
  renderMediaInsp();
}
$('#anglesTab').onclick = () => setLeftTab('angles');
$('#mediaTab').onclick = () => setLeftTab('media');

function setMonTab(t) {
  monTab = t;
  $('#progTab').setAttribute('aria-selected', String(t === 'program'));
  $('#srcTab').setAttribute('aria-selected', String(t === 'source'));
  $('#progFrame').hidden = t === 'source';
  $('#srcFrame').hidden = t !== 'source';
  $('#srcBar').hidden = t !== 'source' || mode !== 'edit';
  if (t === 'source') player.pause();
  else srcMon.v.pause();
}
$('#progTab').onclick = () => setMonTab('program');
$('#srcTab').onclick = () => setMonTab('source');

const fmtMB = (b) => (b >= 1e9 ? (b / 1073741824).toFixed(2) + ' GB' : b >= 10 * 1048576 ? Math.round(b / 1048576) + ' MB' : (b / 1048576).toFixed(1) + ' MB');
const clipTitle = (c) => (c.kind === 'audio' ? `Mic · ${c.name}` : `${angleNo(c.id) || '?'} ${c.name}`);
const fmtClock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

function mediaItems() {
  const items = [];
  for (const c of clips.slice().sort((a, b) => a.t0 - b.t0)) {
    const m = media.meta(c.id);
    const shapes = [...new Set((c.orient || []).map((o) => o.upright))];
    items.push({ kind: 'clip', id: c.id, title: clipTitle(c), sub: `${fmtClock(c.t0)} · ${fmtDur(c.dur).slice(0, -3)}${shapes.length ? ' · ' + shapes.join('/') : ''}${m.trim ? ' · trimmed' : ''}${syncState(c) === 'clock' ? ' · not synced' : ''}`, tags: m.tags, star: m.star, thumb: thumbs.get(c.id), audio: c.kind === 'audio', search: `${c.name} ${m.tags.join(' ')} ${m.notes}` });
  }
  for (const sc of media.subclips) {
    const c = clipOf(sc.src);
    if (!c) continue;
    items.push({ kind: 'subclip', id: sc.id, title: sc.name, sub: `${clipTitle(c)} · ${fmtDur(sc.out - sc.in).slice(0, -3)}`, tags: sc.tags, star: sc.star, thumb: thumbs.get(c.id), audio: c.kind === 'audio', search: `${sc.name} ${c.name} ${sc.tags.join(' ')}` });
  }
  for (const mo of media.moments) {
    const rolling = videoClips().filter((c) => mo.t >= c.t0 && mo.t < c.t0 + c.dur).length;
    items.push({ kind: 'moment', id: mo.id, title: mo.label, sub: `${fmtClock(mo.t)} · ${rolling} angle${rolling === 1 ? '' : 's'} rolling`, tags: mo.tags || [], search: `${mo.label} ${(mo.tags || []).join(' ')}` });
  }
  return items;
}

function renderMedia() {
  if (mode !== 'edit' || leftTab !== 'media') return;
  const tags = media.allTags();
  const filters = [['all', 'All'], ['video', 'Video'], ['audio', 'Audio'], ['subclip', 'Subclips'], ['moment', 'Moments'], ['star', '★']]
    .concat(tags.slice(0, 12).map((t) => ['tag:' + t.tag, `#${t.tag}`]));
  $('#mediaFilters').innerHTML = filters.map(([k, l]) => `<button type="button" data-filter="${esc(k)}" aria-pressed="${mediaFilter === k}">${esc(l)}</button>`).join('');
  const q = mediaQuery.toLowerCase();
  const list = mediaItems().filter((it) => {
    if (q && !`${it.title} ${it.search}`.toLowerCase().includes(q)) return false;
    if (mediaFilter === 'video') return it.kind === 'clip' && !it.audio;
    if (mediaFilter === 'audio') return it.audio && it.kind !== 'moment';
    if (mediaFilter === 'subclip') return it.kind === 'subclip';
    if (mediaFilter === 'moment') return it.kind === 'moment';
    if (mediaFilter === 'star') return it.star;
    if (mediaFilter.startsWith('tag:')) return (it.tags || []).includes(mediaFilter.slice(4));
    return true;
  });
  $('#mediaEmpty').hidden = !!list.length;
  $('#mediaEmpty').textContent = clips.length ? 'Nothing matches.' : 'Recordings appear here as they arrive. Press M during the event to mark moments.';
  $('#mediaList').hidden = !list.length;
  $('#mediaList').innerHTML = list.length
    ? list.map((it) => {
        const sel = mediaSel && mediaSel.kind === it.kind && mediaSel.id === it.id;
        const th = it.kind === 'moment' ? '<span class="th mom">★</span>' : it.audio ? `<span class="th aud${it.kind === 'subclip' ? ' sub' : ''}">MIC</span>` : `<span class="th${it.kind === 'subclip' ? ' sub' : ''}" style="${it.thumb ? `background-image:url(${it.thumb})` : ''}"></span>`;
        return `<li role="option" tabindex="0" aria-selected="${sel}" data-kind="${it.kind}" data-id="${esc(it.id)}">
          ${th}<span><b>${esc(it.title)}</b><small>${esc(it.sub)}</small>${it.tags?.length ? `<span class="tg">${it.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</span>` : ''}</span>
          ${it.kind === 'moment' ? '<span></span>' : `<button type="button" class="star" data-star aria-pressed="${!!it.star}" aria-label="${it.star ? 'Unstar' : 'Star'} ${esc(it.title)}">★</button>`}
        </li>`;
      }).join('')
    : '';
}

$('#mediaSearch').oninput = (e) => {
  mediaQuery = e.target.value;
  renderMedia();
};
$('#mediaFilters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]');
  if (!b) return;
  mediaFilter = b.dataset.filter;
  renderMedia();
});
$('#mediaList').addEventListener('click', (e) => {
  const li = e.target.closest('[data-kind]');
  if (!li) return;
  const { kind, id } = li.dataset;
  if (e.target.closest('[data-star]')) {
    if (kind === 'clip') media.setMeta(id, { star: !media.meta(id).star });
    else media.updateSubclip(id, { star: !media.subclips.find((x) => x.id === id).star });
    return renderMedia();
  }
  selectMedia(kind, id);
});
$('#mediaList').addEventListener('keydown', (e) => {
  const li = e.target.closest('[data-kind]');
  if (!li) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectMedia(li.dataset.kind, li.dataset.id);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    (e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling)?.focus();
  }
});

function selectMedia(kind, id) {
  mediaSel = { kind, id };
  renderMedia();
  renderMediaInsp();
  if (kind === 'clip') loadSource(id, null);
  else if (kind === 'subclip') {
    const sc = media.subclips.find((x) => x.id === id);
    loadSource(sc.src, { in: sc.in, out: sc.out });
  } else {
    const mo = media.moments.find((x) => x.id === id);
    { const at = timeOfAbs(mo.t); if (at) player.seek(at.t); }
    setMonTab('program');
  }
}

// ---- source monitor ----
const srcMon = { v: document.createElement('video'), clip: null, in: 0, out: 0 };
srcMon.v.playsInline = true;
srcMon.v.preload = 'auto';
Object.assign(srcMon.v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
document.body.append(srcMon.v);

function loadSource(clipId, range) {
  const c = clipOf(clipId);
  if (!c) return;
  srcMon.clip = c;
  srcAudio?.fix?.reset(c.audio === 'stereo');
  const r = range || media.range(c);
  srcMon.in = r.in;
  srcMon.out = r.out;
  srcMon.v.src = blobs.get(c.id);
  srcMon.v.addEventListener('loadedmetadata', () => (srcMon.v.currentTime = srcMon.in / 1000), { once: true });
  $('#srcLabel').textContent = `SOURCE · ${clipTitle(c)}`;
  setMonTab('source');
  renderSrcBar();
}

const srcG = $('#srcCanvas').getContext('2d');
(function drawSource() {
  if (monTab === 'source' && mode === 'edit') {
    const cv = $('#srcCanvas');
    if (cv.width !== program.width || cv.height !== program.height) {
      cv.width = program.width;
      cv.height = program.height;
      fitMonitors();
    }
    srcG.fillStyle = '#000';
    srcG.fillRect(0, 0, cv.width, cv.height);
    const c = srcMon.clip;
    const ms = srcMon.v.currentTime * 1000;
    if (c && c.kind === 'audio') {
      srcG.fillStyle = '#6fd39a';
      srcG.font = '700 42px Archivo, system-ui, sans-serif';
      srcG.textAlign = 'center';
      srcG.fillText(clipTitle(c), cv.width / 2, cv.height / 2);
    } else if (c && srcMon.v.readyState >= 2) {
      drawFramed(srcG, srcMon.v, cv.width, cv.height, 'fit', null, orientAt(c, ms)?.rect || null);
    }
    if (c) {
      if (!srcMon.v.paused && ms >= srcMon.out) srcMon.v.pause();
      $('#srcTc').textContent = fmtDur(ms);
      const pct = (x) => (c.dur ? (x / c.dur) * 100 : 0);
      $('#srcHeadBar').style.left = pct(ms) + '%';
      $('#srcScrub').setAttribute('aria-valuenow', String(Math.round(pct(ms))));
      $('#srcPlay').textContent = srcMon.v.paused ? 'Play' : 'Pause';
    }
  }
  requestAnimationFrame(drawSource);
})();

function renderSrcBar() {
  const c = srcMon.clip;
  if (!c) return;
  const pct = (x) => (x / c.dur) * 100;
  Object.assign($('#srcRangeBar').style, { left: pct(srcMon.in) + '%', width: Math.max(0.3, pct(srcMon.out - srcMon.in)) + '%' });
  $('#srcRange').textContent = `In ${fmtDur(srcMon.in)} · Out ${fmtDur(srcMon.out)} · ${fmtDur(srcMon.out - srcMon.in)}`;
  $('#srcTicks').innerHTML = media.moments.filter((m) => m.t >= c.t0 && m.t < c.t0 + c.dur).map((m) => `<i class="tick" style="left:${pct(m.t - c.t0)}%" title="${esc(m.label)}"></i>`).join('');
}

function srcSeek(ms) {
  const c = srcMon.clip;
  if (!c) return;
  srcMon.v.currentTime = Math.max(0, Math.min(c.dur, ms)) / 1000;
}
$('#srcScrub').addEventListener('pointerdown', (e) => {
  const box = $('#srcScrub').getBoundingClientRect();
  const at = (x) => srcSeek(((x - box.left) / box.width) * (srcMon.clip?.dur || 0));
  at(e.clientX);
  const mv = (m) => at(m.clientX);
  const up = () => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
});
// The Source monitor's sound goes through the audio engine too (still to the speakers), so
// the meters can show it while the Source monitor is up.
let srcAudio = null;
function routeSource() {
  if (srcAudio) return;
  try {
    const ctx = player.ctx;
    const node = ctx.createMediaElementSource(srcMon.v);
    // a recording that only filled the left side plays (and meters) on both
    const fix = channelFixer(ctx, { stereo: srcMon.clip?.audio === 'stereo' });
    const gain = ctx.createGain();
    node.connect(fix.input);
    fix.output.connect(gain);
    gain.connect(ctx.destination);
    srcAudio = { meters: stereoMeters(ctx, gain), fix };
  } catch (e) {
    console.warn('Source monitor meters unavailable', e);
    srcAudio = { meters: null };
  }
}
function srcToggle() {
  if (!srcMon.clip) return;
  routeSource();
  player.ctx.resume();
  if (srcMon.v.paused) {
    if (srcMon.v.currentTime * 1000 >= srcMon.out - 30) srcSeek(srcMon.in);
    player.pause();
    srcMon.v.play().catch(() => {});
  } else srcMon.v.pause();
}
function markIn() {
  if (!srcMon.clip) return;
  srcMon.in = Math.round(srcMon.v.currentTime * 1000);
  if (srcMon.out <= srcMon.in) srcMon.out = srcMon.clip.dur;
  renderSrcBar();
  announce(`In at ${fmtDur(srcMon.in)}`);
}
function markOut() {
  if (!srcMon.clip) return;
  srcMon.out = Math.round(srcMon.v.currentTime * 1000);
  if (srcMon.out <= srcMon.in) srcMon.in = 0;
  renderSrcBar();
  announce(`Out at ${fmtDur(srcMon.out)}`);
}
$('#srcPlay').onclick = srcToggle;
$('#srcIn').onclick = markIn;
$('#srcOut').onclick = markOut;

function srcItem() {
  const c = srcMon.clip;
  if (!c || srcMon.out - srcMon.in < FRAME) return null;
  return { type: 'clip', src: c.id, in: srcMon.in, dur: srcMon.out - srcMon.in };
}
/** Where source footage lands: the selected item's track if it fits the kind, else the Program (or first audio track). */
function targetTrack(kind) {
  // the track you targeted (◉ on its header) wins; otherwise the selected clip's track, then the defaults
  const tg = seq.target?.[kind] && seq.tracks.find((t) => t.id === seq.target[kind] && !t.locked && !t.follow);
  if (tg) return tg;
  const f = selectedItem && S.findItem(seq, selectedItem);
  if (f && f.track.kind === kind && !f.track.follow && !f.track.locked) return f.track;
  if (kind === 'video') return S.program(seq);
  return seq.tracks.find((t) => t.kind === 'audio' && !t.follow && !t.locked) || S.addTrack(seq, 'audio');
}
function placeSource(how) {
  const item = srcItem();
  if (!item) return toast('Mark an In and Out on a clip first');
  snapshot();
  const tr = targetTrack(srcMon.clip.kind === 'audio' ? 'audio' : 'video');
  if (tr.program) seq.auto = false;
  const t = player.t;
  const placed = how === 'insert' ? S.insertAt(seq, tr.id, t, item) : S.overwrite(seq, tr.id, t, item);
  if (!placed) return toast('That track is locked');
  commit();
  player.seek(t + item.dur); // like Premiere: the playhead moves past what you added
  note(`${how === 'insert' ? 'Inserted' : 'Overwrote'} ${fmtDur(item.dur).slice(0, -3)} of ${clipTitle(srcMon.clip)} on ${tr.name}`);
  announce(`${how === 'insert' ? 'Inserted' : 'Overwrote'} on ${tr.name}`);
}
$('#srcInsert').onclick = () => placeSource('insert');
$('#srcOverwrite').onclick = () => placeSource('overwrite');

function makeSubclip() {
  const item = srcItem();
  if (!item) return toast('Mark an In and Out first');
  const name = prompt('Name this clip', `${srcMon.clip.name} · ${fmtDur(srcMon.in).slice(0, -3)}`);
  if (name === null) return;
  const sc = media.addSubclip({ src: srcMon.clip.id, in: srcMon.in, out: srcMon.out, name: name || 'Subclip' });
  setLeftTab('media');
  mediaSel = { kind: 'subclip', id: sc.id };
  renderMedia();
  renderMediaInsp();
  announce(`Subclip ${sc.name} made`);
}
$('#srcSubclip').onclick = makeSubclip;

/** Render just this range as its own film (for sharing a moment). */
function exportRange(clipId, a, b, name) {
  const c = clipOf(clipId);
  const one = {
    v: 2, origin: 0, auto: false,
    tracks: c.kind === 'audio'
      ? [{ id: 'v', kind: 'video', items: [] }, { id: 'a', kind: 'audio', items: [{ id: 'x', type: 'clip', src: c.id, start: 0, dur: b - a, in: a }], gain: 1, mono: true }]
      : [{ id: 'p', kind: 'video', program: true, items: [{ id: 'x', type: 'clip', src: c.id, start: 0, dur: b - a, in: a }] }, { id: 'a', kind: 'audio', follow: 'p', items: [], gain: 1, mono: true }],
  };
  return runRender({ s: one, name, wrapUp: false });
}
$('#srcExport').onclick = () => {
  if (!srcItem()) return toast('Mark an In and Out first');
  exportRange(srcMon.clip.id, srcMon.in, srcMon.out, `${ev.title}-${srcMon.clip.name}-${fmtDur(srcMon.in).slice(0, -3).replace(/:/g, '')}`);
};

// ---- media inspector ----
function tagEditor(tags, onChange) {
  const wrap = document.createElement('div');
  const draw = () => {
    wrap.innerHTML = `<label>Tags</label><div class="tagedit">${tags.map((t, i) => `<span>${esc(t)}<button type="button" data-rm="${i}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}</div>
      <input type="text" placeholder="Add a tag and press Enter" aria-label="Add a tag">
      <div class="quicktags">${QUICK_TAGS.filter((q) => !tags.includes(q)).map((q) => `<button type="button" data-q="${esc(q)}">+ ${esc(q)}</button>`).join('')}</div>`;
    wrap.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { tags.splice(+b.dataset.rm, 1); onChange(tags); draw(); }));
    wrap.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { tags.push(b.dataset.q); onChange(tags); draw(); }));
    const input = wrap.querySelector('input');
    input.onkeydown = (e) => {
      if (e.key !== 'Enter' || !input.value.trim()) return;
      e.preventDefault();
      const t = input.value.trim().slice(0, 30);
      if (!tags.includes(t)) tags.push(t);
      onChange(tags);
      draw();
      wrap.querySelector('input').focus();
    };
  };
  draw();
  return wrap;
}

function renderMediaInsp() {
  const box = $('#mediaInsp');
  const show = mode === 'edit' && mediaSel && (leftTab === 'media' || monTab === 'source');
  box.hidden = !show;
  if (!show) return;
  const changed = () => { renderMedia(); };
  if (mediaSel.kind === 'clip') {
    const c = clipOf(mediaSel.id);
    if (!c) return (box.hidden = true);
    const m = media.meta(c.id);
    const r = media.range(c);
    const shapes = (c.orient || []).map((o) => o.upright);
    const turns = Math.max(0, shapes.length - 1);
    const qa = c.qa?.length ? Math.round((c.qa.reduce((s, q) => s + (q[1] ?? 0), 0) / c.qa.length) * 100) : null;
    const uses = seq.tracks.reduce((n, tr) => n + tr.items.filter((it) => it.src === c.id).length, 0);
    box.innerHTML = `<h2>Recording</h2><div class="sel"><div class="kv">
      <span>From</span><b>${esc(clipTitle(c))}</b>
      <span>Recorded</span><span>${fmtClock(c.t0)}</span>
      <span>Sync</span><span>${esc(syncLabel(c))}</span>
      <span>Length</span><span class="tc">${fmtDur(c.dur)}</span>
      <span>File</span><span>${fmtMB(rawBlobs.get(c.id)?.size || 0)} · signed by the phone</span>
      ${shapes.length ? `<span>Shape</span><span>${shapes[0]}${turns ? `, turned ${turns}×` : ''}</span>` : ''}
      ${qa != null ? `<span>Shot quality</span><span>${qa}% average</span>` : ''}
      <span>Usable</span><span class="tc">${m.trim ? `${fmtDur(r.in)} – ${fmtDur(r.out)}` : 'all of it'}</span>
      <span>On timeline</span><span>${uses} time${uses === 1 ? '' : 's'}</span>
    </div>
    <div class="row" style="gap:6px;flex-wrap:wrap">
      <button type="button" id="mTrim" title="Use only the In–Out range of this recording (the file is kept)">Trim to In/Out</button>
      ${m.trim ? '<button type="button" id="mUntrim">Use all of it</button>' : ''}
    </div>
    <div id="mTags"></div>
    <label for="mNotes">Notes</label><textarea id="mNotes" rows="2">${esc(m.notes || '')}</textarea>
    <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
      <button type="button" id="mDownload">Download original</button>
      <button type="button" id="mDelete" class="danger">Delete recording</button>
    </div></div>`;
    box.querySelector('#mTags').append(tagEditor([...m.tags], (tags) => { media.setMeta(c.id, { tags }); changed(); }));
    box.querySelector('#mNotes').onchange = (e) => media.setMeta(c.id, { notes: e.target.value });
    box.querySelector('#mTrim').onclick = () => {
      if (srcMon.clip?.id !== c.id) return toast('Open it in the Source monitor and mark In and Out first');
      snapshot();
      media.setMeta(c.id, { trim: { in: srcMon.in, out: srcMon.out } });
      if (seq.auto) rebuild(false);
      commit();
      renderMedia();
      renderMediaInsp();
      announce('Trimmed');
    };
    box.querySelector('#mUntrim')?.addEventListener('click', () => {
      snapshot();
      media.setMeta(c.id, { trim: null });
      if (seq.auto) rebuild(false);
      commit();
      renderMedia();
      renderMediaInsp();
    });
    box.querySelector('#mDownload').onclick = () => download(rawBlobs.get(c.id), `${ev.title}-${c.name}-${c.id}`);
    box.querySelector('#mDelete').onclick = () => deleteRecording(c.id);
  } else if (mediaSel.kind === 'subclip') {
    const sc = media.subclips.find((x) => x.id === mediaSel.id);
    if (!sc) return (box.hidden = true);
    const c = clipOf(sc.src);
    box.innerHTML = `<h2>Subclip</h2><div class="sel">
      <label for="scName">Name</label><input type="text" id="scName" value="${esc(sc.name)}">
      <div class="kv" style="margin-top:8px"><span>From</span><span>${esc(clipTitle(c))}</span><span>Range</span><span class="tc">${fmtDur(sc.in)} – ${fmtDur(sc.out)}</span><span>Length</span><span class="tc">${fmtDur(sc.out - sc.in)}</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button type="button" id="scUpdate" title="Set this subclip to the Source monitor's In and Out">Update from In/Out</button></div>
      <div id="scTags"></div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        <button type="button" id="scExport">Export clip</button>
        <button type="button" id="scDelete" class="danger">Delete subclip</button>
      </div></div>`;
    box.querySelector('#scName').onchange = (e) => { media.updateSubclip(sc.id, { name: e.target.value || 'Subclip' }); changed(); };
    box.querySelector('#scTags').append(tagEditor([...sc.tags], (tags) => { media.updateSubclip(sc.id, { tags }); changed(); }));
    box.querySelector('#scUpdate').onclick = () => {
      if (srcMon.clip?.id !== sc.src) return toast('Open this subclip first');
      media.updateSubclip(sc.id, { in: srcMon.in, out: srcMon.out });
      renderMedia();
      renderMediaInsp();
    };
    box.querySelector('#scExport').onclick = () => exportRange(sc.src, sc.in, sc.out, `${ev.title}-${sc.name}`);
    box.querySelector('#scDelete').onclick = () => {
      media.removeSubclip(sc.id);
      mediaSel = null;
      renderMedia();
      renderMediaInsp();
      announce('Subclip deleted');
    };
  } else {
    const mo = media.moments.find((x) => x.id === mediaSel.id);
    if (!mo) return (box.hidden = true);
    const rolling = videoClips().filter((c) => mo.t >= c.t0 && mo.t < c.t0 + c.dur);
    box.innerHTML = `<h2>Moment</h2><div class="sel">
      <label for="moName">Name</label><input type="text" id="moName" value="${esc(mo.label)}">
      <div class="kv" style="margin-top:8px"><span>When</span><span>${fmtClock(mo.t)}</span><span>Rolling</span><span>${rolling.map((c) => esc(c.name)).join(', ') || 'no cameras'}</span></div>
      <button type="button" id="moClips" class="primary" style="width:100%" ${rolling.length ? '' : 'disabled'}>Make clips from every angle</button>
      <p class="fine">Ten seconds before to five after, one clip per camera that was rolling, tagged Moment.</p>
      <div id="moTags"></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <button type="button" id="moGo">Go to it on the timeline</button>
        <button type="button" id="moDelete" class="danger">Delete moment</button>
      </div></div>`;
    box.querySelector('#moName').onchange = (e) => { if (!renameMoment(mo.id, e.target.value)) e.target.value = mo.label; };
    box.querySelector('#moTags').append(tagEditor([...(mo.tags || [])], (tags) => { media.updateMoment(mo.id, { tags }); changed(); }));
    box.querySelector('#moClips').onclick = () => clipsOfMoment(mo.id);
    box.querySelector('#moGo').onclick = () => {
      const at = timeOfAbs(mo.t);
      if (at) player.seek(at.t);
      setMonTab('program');
    };
    box.querySelector('#moDelete').onclick = () => deleteMoment(mo.id);
  }
}

/** Delete a recording for good: the file, every use on the timeline, its subclips. */
async function deleteRecording(id, { confirmed = false, elsewhere = false } = {}) {
  const c = clipOf(id);
  if (!c) return;
  const uses = seq.tracks.reduce((n, tr) => n + tr.items.filter((it) => it.src === id).length, 0);
  const subs = media.subclips.filter((x) => x.src === id).length;
  const mb = fmtMB(rawBlobs.get(id)?.size || 0);
  if (!confirmed && !confirm(`Delete ${clipTitle(c)}'s recording (${fmtDur(c.dur).slice(0, -3)}, ${mb})?${uses ? `\n\nIt's used ${uses} time${uses === 1 ? '' : 's'} on the timeline; those pieces will be removed.` : ''}${subs ? `\n${subs} subclip${subs === 1 ? '' : 's'} will go too.` : ''}\n\nThe file is deleted from this computer. This can't be undone.`)) return;
  if (!elsewhere) await idb.remove('clips', eventId, id); // (deleted in the other window: the file's gone already)
  if (!EDIT_ONLY && !elsewhere) editCh?.postMessage({ t: 'deleted', id }); // (the Edit page, if open, drops it too)
  if (srcMon.clip?.id === id) {
    srcMon.v.pause();
    srcMon.v.removeAttribute('src');
    srcMon.clip = null;
  }
  player.forget(id);
  URL.revokeObjectURL(blobs.get(id));
  blobs.delete(id);
  rawBlobs.delete(id);
  thumbs.delete(id);
  clips.splice(clips.findIndex((x) => x.id === id), 1);
  media.forgetSource(id);
  S.removeSource(seq, id);
  cut.edl = cut.edl.filter((e) => e.clip !== id);
  saveCut();
  undoStack.length = 0; // undo can't bring a deleted file back
  if (seq.auto) rebuild(false);
  mediaSel = null;
  commit();
  renderMedia();
  renderMediaInsp();
  renderMulti();
  note(`Deleted ${c.name}'s recording (${mb})`);
  toast(`Deleted ${c.name}'s recording`);
}

// ---------------------------------------------------------- optical sync ----

// Every phone syncs once, when it scans the beacon, and keeps that lock: each clip it sends
// is already placed on the beacon's clock (and says when the lock was read). So Auto-sync
// checks that every clip is locked, fine-tunes any that happen to have the beacon in shot,
// and names the phones that never synced (those clips are placed by the phone's own clock).
const syncState = (c) => (c.t0Source === 'optical' ? 'optical' : c.t0Source === 'audio' ? 'audio' : c.t0Source === 'phone' || c.t0Source === 'studio' ? 'locked' : 'clock');
function syncLabel(c) {
  const s = syncState(c);
  if (s === 'optical') return 'Locked to the beacon, fine-tuned from the beacon in shot';
  if (s === 'audio') return `Locked to the beacon, then lined up by sound with ${clipOf(c.syncRef)?.name || 'another clip'}`;
  if (s === 'locked') return c.t0Source === 'studio' ? 'On the studio\u2019s own clock (recorded on this computer)' : c.sync?.at ? `Locked to the beacon (read at ${fmtClock(c.sync.at)})` : 'Locked to the beacon by the phone';
  return "Not synced: placed by the phone's own clock";
}
$('#syncBtn').onclick = async () => {
  const all = videoClips();
  if (!all.length) return toast('No clips yet.');
  const list = all.filter((c) => c.syncHints?.length && c.t0Source !== 'optical');
  $('#syncBtn').disabled = true;
  let fixed = 0;
  for (const [i, c] of list.entries()) {
    $('#syncBtn').textContent = `Syncing ${i + 1}/${list.length}`;
    try {
      const t0 = await opticalT0(c);
      if (t0 !== null) {
        await saveClipFields(c.id, { t0, t0Source: 'optical' });
        fixed++;
      }
    } catch (e) {
      console.warn('sync failed', c.id, e);
    }
  }
  if (seq.auto) rebuild(false);
  commit();
  // then every clip that shares sound with one already lined up gets lined up by it
  const sound = await alignBySound((i, n) => ($('#syncBtn').textContent = `Listening ${i}/${n}`)).catch((e) => (console.warn('sound sync', e), { moves: [], lined: 0 }));
  if (sound.moves.length) {
    snapshot();
    if (seq.auto) rebuild(false);
    else shiftItemsBy(sound.moves);
    commit();
  }
  $('#syncBtn').textContent = 'Auto-sync';
  $('#syncBtn').disabled = false;
  const all2 = clips.filter((c) => c.t0Source && !c.program && !c.reel);
  const loose = all2.filter((c) => syncState(c) === 'clock');
  const who = [...new Set(loose.map((c) => c.name))];
  const how = [fixed && `${fixed} fine-tuned from the beacon in shot`, sound.lined && `${sound.lined} lined up by sound${sound.moves.length ? `, ${sound.moves.length} of them moved` : ''}`].filter(Boolean).join('; ');
  const msg = `${all2.length - loose.length} of ${all2.length} clip${all2.length === 1 ? ' is' : 's are'} locked to the beacon${how ? ` (${how})` : ''}.` +
    (loose.length ? ` ${loose.length} ${loose.length === 1 ? "isn't" : "aren't"}: ${who.join(', ')} hadn't synced, so ${loose.length === 1 ? 'it is' : 'those are'} placed by the phone's own clock.` : ' Nothing to fix.');
  toast(msg, 8000);
  note(`Auto-sync: ${msg}`);
};

// ---- lining clips up by their sound --------------------------------------------------------
// The beacon puts every clip within a few hundred milliseconds (phones start recording at
// slightly different speeds; a microphone-only recorder starts faster than a camera's).
// Clips that overlap share sound, so each is cross-correlated with one already lined up and
// moved by the difference. It starts from what's most trustworthy: clips with the beacon in
// shot, then a beacon-synced microphone, then the longest beacon-synced clip.
const SYNC_SR = 8000;
async function pcmOf(c, cache) {
  if (cache.has(c.id)) return cache.get(c.id);
  let out = null;
  const blob = rawBlobs.get(c.id);
  if (blob) {
    try {
      const buf = await new OfflineAudioContext(1, 1, SYNC_SR).decodeAudioData(await blob.arrayBuffer());
      out = new Float32Array(buf.length);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i++) out[i] += d[i];
      }
    } catch {}
  }
  cache.set(c.id, out);
  return out;
}
async function soundOffset(ref, c, cache) {
  const a0 = Math.max(ref.t0, c.t0), a1 = Math.min(ref.t0 + ref.dur, c.t0 + c.dur);
  if (a1 - a0 < 4000) return null;
  const win = Math.min(20000, a1 - a0 - 500), w0 = (a0 + a1) / 2 - win / 2;
  const pa = await pcmOf(ref, cache), pb = await pcmOf(c, cache);
  if (!pa || !pb) return null;
  const n = Math.round((win / 1000) * SYNC_SR);
  const cut = (pcm, clip) => {
    const s = Math.max(0, Math.round(((w0 - clip.t0 + (clip.inBase || 0)) / 1000) * SYNC_SR));
    return pcm.subarray(s, s + n);
  };
  const A = cut(pa, ref), B = cut(pb, c);
  if (Math.min(A.length, B.length) < SYNC_SR * 3 || !hasSound(A) || !hasSound(B)) return null;
  const m = Math.min(A.length, B.length);
  const wide = c.t0Source === 'clock' || ref.t0Source === 'clock';
  const r = offsetBetween(A.subarray(0, m), B.subarray(0, m), Math.round((wide ? 8 : 2) * SYNC_SR));
  return r.score >= 8 && r.clarity >= 1.4 ? { shift: (r.lag / SYNC_SR) * 1000, score: r.score } : null;
}
async function alignBySound(onStep) {
  const cands = clips.filter((c) => c.t0Source && !c.program && !c.reel && (c.dur || 0) >= 4000 && rawBlobs.has(c.id));
  if (cands.length < 2) return { moves: [], lined: 0 };
  const tier = (c) => (c.t0Source === 'optical' ? 0 : c.kind === 'audio' && c.t0Source !== 'clock' ? 1 : c.t0Source !== 'clock' ? 2 : 3);
  const done = new Set(cands.filter((c) => c.t0Source === 'optical').map((c) => c.id));
  if (!done.size) done.add(cands.slice().sort((a, b) => tier(a) - tier(b) || b.dur - a.dur)[0].id);
  const queue = [...done], tries = new Map(), moves = [], cache = new Map();
  let lined = 0;
  while (queue.length) {
    const ref = clipOf(queue.shift());
    for (const c0 of cands) {
      if (done.has(c0.id)) continue;
      const c = clipOf(c0.id);
      if (c.t0 + c.dur <= ref.t0 || c.t0 >= ref.t0 + ref.dur || (tries.get(c.id) || 0) >= 3) continue;
      tries.set(c.id, (tries.get(c.id) || 0) + 1);
      onStep?.(done.size, cands.length);
      await new Promise((r) => setTimeout(r));
      const r = await soundOffset(ref, c, cache);
      if (!r) continue;
      done.add(c.id);
      queue.push(c.id);
      lined++;
      if (Math.abs(r.shift) >= 1) moves.push({ id: c.id, shift: r.shift });
      await saveClipFields(c.id, { t0: Math.round(c.t0 + r.shift), t0Source: 'audio', syncRef: ref.id, syncScore: Math.round(r.score) });
      note(`Lined up ${c.name}'s ${c.kind === 'audio' ? 'sound' : 'clip'} by sound with ${ref.name}: moved ${Math.round(r.shift)} ms`);
    }
  }
  cache.clear();
  return { moves, lined };
}
/** In an edit you've cut yourself, keep each moved clip's pieces showing the same moments. */
function shiftItemsBy(moves) {
  for (const tr of seq.tracks) {
    for (const it of tr.items) {
      const m = it.type === 'clip' && moves.find((x) => x.id === it.src);
      if (!m) continue;
      const sp = it.speed || 1, c = clipOf(it.src);
      let ni = (it.in || 0) - m.shift;
      if (ni < 0) {
        it.start += -ni / sp;
        it.dur = Math.max(FRAME, it.dur + ni / sp);
        ni = 0;
      }
      it.in = Math.round(ni);
      if (c?.dur) it.dur = Math.max(FRAME, Math.min(it.dur, (c.dur + (c.inBase || 0) - it.in) / sp));
    }
  }
}

async function opticalT0(clip) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = blobs.get(clip.id);
  Object.assign(v.style, { position: 'fixed', left: '0', bottom: '0', width: '160px', opacity: '0.01', pointerEvents: 'none' });
  document.body.append(v);
  const samples = [];
  try {
    await once(v, 'loadedmetadata');
    const cv = document.createElement('canvas');
    const grab = async (mediaTime) => {
      cv.width = 640;
      cv.height = Math.round((v.videoHeight / v.videoWidth) * 640) || 360;
      cv.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, cv.width, cv.height);
      const tc = parseTimecode(await decodeQR(cv));
      if (tc && tc.e === eventId) samples.push(tc.t - mediaTime * 1000);
    };
    for (const h of clip.syncHints) {
      const from = Math.max(0, h - 1.5);
      const to = h + 2;
      v.currentTime = from;
      await once(v, 'seeked');
      if ('requestVideoFrameCallback' in v) {
        await new Promise((resolve) => {
          let stop = false;
          const finish = () => {
            if (stop) return;
            stop = true;
            v.pause();
            resolve();
          };
          const onFrame = async (_n, meta) => {
            if (stop) return;
            await grab(meta.mediaTime);
            if (meta.mediaTime >= to || v.ended || samples.length >= 16) return finish();
            v.requestVideoFrameCallback(onFrame);
          };
          v.requestVideoFrameCallback(onFrame);
          v.play().catch(finish);
          setTimeout(finish, 7000);
        });
      } else {
        for (let t = from; t < to; t += 1 / 15) {
          v.currentTime = t;
          await once(v, 'seeked');
          await grab(v.currentTime);
        }
      }
    }
  } finally {
    v.remove();
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  const med = samples[Math.floor(samples.length / 2)];
  return Math.max(...samples.filter((s) => Math.abs(s - med) < 150));
}

function once(el, name) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error('Video failed to load')); };
    const cleanup = () => { el.removeEventListener(name, ok); el.removeEventListener('error', bad); };
    el.addEventListener(name, ok, { once: true });
    el.addEventListener('error', bad, { once: true });
  });
}

// ------------------------------------------------------ render and export ----

function download(blob, base) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base.replace(/[^\w-]+/g, '-')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

let rendering = null;
const HINTS = {
  setup: 'This browser can’t write video files. Chrome or Edge on a computer can; Real-time export works everywhere.',
  'video-encode': 'The computer’s video encoder stopped. Try again (VUEMesh will pick another format), or use Real-time export.',
  'audio-encode': 'The audio encoder stopped. Real-time export will still work.',
  decode: 'One clip couldn’t be read. Its file may be damaged or in a format this browser can’t open. Real-time export may still play it.',
};
$('#renderBtn').onclick = () => runRender({});
async function runRender({ s: renderSeq = seq, name = ev.title, wrapUp = true }) {
  if (renderSeq === seq && seq.range) {
    // only In to Out
    renderSeq = S.sliceRange(seq, seq.range.in, seq.range.out);
    name = `${name} (${fmtDur(seq.range.in).slice(0, -3).replace(/:/g, '.')}–${fmtDur(seq.range.out).slice(0, -3).replace(/:/g, '.')})`;
  }
  if (!S.end(renderSeq)) return toast('Nothing on the timeline yet');
  const [W, H] = [program.width, program.height];
  const dlg = $('#renderDlg');
  const ctrl = new AbortController();
  rendering = ctrl;
  $('#renderErr').hidden = true;
  $('#renderRealtime').hidden = true;
  $('#renderCopy').hidden = true;
  $('#renderCancel').textContent = 'Cancel';
  $('#renderCancel').onclick = () => (rendering ? ctrl.abort() : dlg.close());
  $('#renderText').textContent = 'Checking what this computer can encode…';
  $('#renderBar').value = 0;
  $('#renderFine').textContent = '';
  dlg.showModal();
  player.pause();
  const t0 = performance.now();
  let report = null;
  const describe = (r) => {
    if (!r) return '';
    const fast = r.sources.filter((x) => x.path === 'fast').length;
    const slow = r.sources.filter((x) => x.path !== 'fast');
    return `${r.video} video, ${r.audio} audio, ${W}×${H}.` +
      (r.sources.length ? ` ${fast} clip${fast === 1 ? '' : 's'} on the fast path` : '') +
      (slow.length ? `, ${slow.length} in compatibility mode (slower): ${slow.map((x) => `${x.clip}${x.why ? ` — ${x.why}` : ''}`).join('; ')}` : '') +
      (r.silent ? `. ${r.silent} recording(s) had no readable sound.` : '') +
      (r.unreadable?.length ? `. Couldn't read ${r.unreadable.join(', ')}: those moments show the layer below (or black).` : '');
  };
  try {
    let stream = null;
    if (S.end(renderSeq) > 20 * 60 * 1000 && window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({ suggestedName: `${name.replace(/[^\w-]+/g, '-')}.mp4`, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      stream = await handle.createWritable();
    }
    const out = await renderSequence({
      seq: renderSeq, width: W, height: H, fps: 30, fit, title: ev.title,
      blobFor: (id) => rawBlobs.get(id),
      audioOf: (id) => clipOf(id)?.audio,
      nameOf: (id) => {
        const c = clipOf(id);
        return c ? `${c.name} (angle ${angleNo(id) || '?'})` : id;
      },
      imageFor: (asset) => reel.find((r) => r.id === asset)?.el || null,
      viewOf: (item, ms) => viewOf(item, ms),
      signal: ctrl.signal,
      stream,
      onReport: (r) => {
        report = r;
        $('#renderFine').textContent = describe(r);
      },
      onProgress: ({ phase, done, total }) => {
        const pct = phase === 'audio' ? (done / total) * 10 : 10 + (done / total) * 90;
        $('#renderBar').value = pct;
        const secs = (performance.now() - t0) / 1000;
        $('#renderText').textContent = phase === 'audio' ? 'Mixing sound…' : `Rendering picture · ${Math.round(pct)}% · ${(((done / 30) || 0) / Math.max(secs, 0.1)).toFixed(1)}× real time`;
      },
    });
    rendering = null;
    dlg.close();
    const took = ((performance.now() - t0) / 1000).toFixed(1);
    note(`Rendered ${name}: ${fmtDur(S.end(renderSeq)).slice(0, -3)} in ${took}s · ${describe(out.report)}`);
    if (out.blob) download(out.blob, name);
    if (renderSeq === seq && !seq.range) lastRender = { blob: out.blob, at: Date.now() };
    toast(out.report?.unreadable?.length ? `Rendered in ${took} s, but ${out.report.unreadable.length} clip(s) couldn't be read — see the event log` : `Rendered in ${took} s`, 6000);
    if (wrapUp) showWrap();
  } catch (e) {
    rendering = null;
    if (e.name === 'AbortError') return dlg.close();
    // Keep the dialog open and say exactly what went wrong.
    const stage = e instanceof RenderError ? e.stage : 'unknown';
    $('#renderText').textContent = 'The render stopped.';
    $('#renderErrText').textContent = e.message;
    $('#renderErrHint').textContent = HINTS[stage] || 'Real-time export will still make a file.';
    $('#renderErr').hidden = false;
    $('#renderRealtime').hidden = false;
    $('#renderCopy').hidden = false;
    $('#renderCancel').textContent = 'Close';
    const details = JSON.stringify({ stage, message: e.message, detail: e.detail || null, report, browser: navigator.userAgent, size: `${W}x${H}` }, null, 2);
    $('#renderCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(details);
        toast('Details copied');
      } catch {
        toast('Couldn’t copy; the details are in the event log');
      }
    };
    $('#renderRealtime').onclick = () => {
      dlg.close();
      $('#exportBtn').click();
    };
    note(`Render failed (${stage}): ${e.message}`);
    console.error('render failed', e, details);
  }
}
let lastRender = null;

// Real time: works in every browser that can record, at the cost of waiting the whole length.
let exporting = null;
$('#exportBtn').onclick = async () => {
  if (exporting) return exporting.stop();
  if (!S.end(seq)) return toast('Nothing on the timeline yet');
  const tracks = [...program.captureStream(30).getVideoTracks(), ...player.audioStream().getAudioTracks()];
  const mime = recMime();
  const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  exporting = { stop() { if (rec.state !== 'inactive') rec.stop(); player.pause(); } };
  $('#exportBtn').textContent = 'Stop';
  player.pause();
  player.rate = 1;
  player.seek(0);
  toast('Recording in real time. Keep this tab in front.', 5000);
  await new Promise((r) => setTimeout(r, 800));
  rec.start(1000);
  player.play();
  await stopped;
  exporting = null;
  $('#exportBtn').textContent = 'Real-time export';
  download(new Blob(chunks, { type: rec.mimeType }), `${ev.title}`);
  showWrap();
};

// Publishing (off in the beta): upload the rendered film and a signed manifest.
$('#publishBtn').onclick = async () => {
  if (!FEATURES.publish) return;
  if (!lastRender?.blob) return toast('Render MP4 first, then publish');
  const btn = $('#publishBtn');
  btn.disabled = true;
  try {
    btn.textContent = 'Uploading…';
    const urls = await api(`events/${eventId}/publish`, { method: 'POST', host: key, body: { ext: 'mp4' } });
    const used = new Set();
    for (const tr of seq.tracks) for (const it of tr.items) if (it.type === 'clip') used.add(it.src);
    const manifest = {
      v: 2,
      event: { id: eventId, title: ev.title, terms: ev.terms, termsHash: ev.termsHash, poolPct: ev.poolPct },
      credits: credits(),
      sound: soundCredits()[0] || null,
      clips: clips.filter((c) => used.has(c.id)).map(({ id, cid, name, jwk, joinSig, root, sig, t0, dur, kind }) => ({ id, cid, name, jwk, joinSig, root, sig, t0, dur, kind: kind || 'video' })),
      publishedAt: new Date().toISOString(),
    };
    await putTo(urls.film.put, lastRender.blob, 'video/mp4');
    await putTo(urls.manifest.put, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), 'application/json');
    await api(`events/${eventId}/published`, { method: 'POST', host: key, body: { filmUrl: urls.film.url, manifestUrl: urls.manifest.url, title: 'Main cut' } });
    toast('Published', 3000);
    showWrap(true);
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish';
  }
};

async function putTo(url, blob, type) {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

// ------------------------------------------------------------------ wrap ----

const wrap = $('#wrap');
wrap.querySelector('[data-close]').onclick = () => wrap.close();
$('#wrapPatreon').href = BRAND.patreon;
function showWrap(published = false) {
  const url = `${location.origin}/watch?e=${eventId}`;
  $('#wrapText').textContent = published
    ? 'Your film is published. Everyone who shot it can watch it, and their credits are on the page.'
    : 'Your film is saved to this device. Send it to everyone who shot it — their credits are in the studio.';
  $('#wrapWatch').href = url;
  $('#wrapShare').hidden = !published;
  $('#wrapWatch').hidden = !published;
  $('#wrapShare').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: ev.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Watch link copied');
      }
    } catch {}
  };
  if (!wrap.open) wrap.showModal();
}

// ---------------------------------------------------------------- monitor ----
// The Monitor tab (same browser) listens here: network, device and transfer
// details for every phone, plus the event log. Nothing leaves this computer.

const monitorChannel = 'BroadcastChannel' in window ? new BroadcastChannel('vuemesh-monitor-' + eventId) : null;
// the Monitor says when someone is looking at it: the button's news light goes out
if (monitorChannel) monitorChannel.onmessage = (e) => {
  // Monitor deletes a recording (it asked there): from this computer and the editor
  if (e.data?.type === 'delete' && e.data.id && isHost && !EDIT_ONLY) return void deleteRecording(e.data.id, { confirmed: true });
  if (e.data?.type === 'seen') {
    monitorSeenAt = Date.now();
    monitorLight();
  }
};
window.vmStreamOut = () => streamOut; // (diagnostics and tests: the stream out, while live)
async function pushMonitor() {
  if (!monitorChannel || !hub) return;
  const peers = [];
  for (const [peer, l] of live) {
    const st = l.local ? null : await hub.stats(peer);
    if (st) l.stats = st;
    if (l.local && l.role === 'mic') {
      // this computer's own microphone or sound: no link to measure; it goes straight in
      const tier = peer === liveActive && !onBreak() ? 'program' : 'idle';
      l.stats = { route: 'local', codec: 'raw' };
      l.tele = { ...(l.tele || {}), platform: 'This computer', browser: l.deviceLabel || l.micLabel || l.name || 'Microphone', link: { local: true, audio: true, tier } };
    }
    if (l.local && l.role !== 'mic') {
      // a camera plugged into this computer: no link to measure; its own picture, straight in
      const s = l.stream?.getVideoTracks()[0]?.getSettings?.() || {};
      const w = l.video?.videoWidth || s.width || null, h = l.video?.videoHeight || s.height || null, fps = s.frameRate ? Math.round(s.frameRate) : null;
      const tier = peer === liveActive && !onBreak() ? 'program' : peer === pvw ? 'preview' : 'idle';
      l.stats = { route: 'local', width: w, height: h, fps, codec: 'raw' };
      l.tele = { ...(l.tele || {}), camW: s.width || w, camH: s.height || h, camFps: fps, platform: 'This computer', browser: l.deviceLabel || 'Camera', link: { local: true, tier, w, h, fps } };
    }
    const sc = scoreOfLive(l);
    peers.push({
      peer, name: l.name, role: l.role, rec: !!l.rec, onAir: peer === liveActive && !onBreak(), joinedAt: l.joinedAt,
      ...(l.stats || {}), tele: l.tele || null,
      score: sc, problem: sc != null && sc < 0.5 ? whatsWrong(l.qa?.parts, l.qa?.upright, orientation, l.qa?.fixed) : null, shape: l.view?.upright || null,
    });
  }
  const bytes = [...rawBlobs.values()].reduce((s, b) => s + b.size, 0);
  monitorChannel.postMessage({
    type: 'stats', at: Date.now(), event: { id: eventId, title: ev.title, orientation },
    program: { onBreak: onBreak(), black: blackLevel() >= 1 ? 'black' : black.target === 1 ? 'fading' : null, active: live.get(liveActive)?.name || null, recording: !!progRec, auto: autoOn },
    totals: { clips: clips.length, audio: audioClips().length, bytes, incoming: [...incoming.values()], seconds: Math.round(S.end(seq) / 1000) },
    outgoing: [...outgoing.values()], sent: sentLog.slice(0, 40),
    received: [...clips].sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0)).slice(0, 30).map((c) => ({ id: c.id, name: c.name, kind: c.kind, size: rawBlobs.get(c.id)?.size || 0, at: c.receivedAt || c.t0, dur: c.dur, mime: c.mime, thumb: thumbs?.get?.(c.id) || null })),
    peers, log: log.slice(0, 80),
    stream: streamOut?.link ? { name: streamOut.name, ...(await streamOut.link().catch(() => ({}))) } : null,
    displays: (await displayHub?.stats().catch(() => [])) || [],
  });
}

let leaveQuietly = false; // (the kiosk starting its next show: no "Leave site?")
window.addEventListener('beforeunload', (e) => {
  if (leaveQuietly) return;
  if (exporting || progRec || incoming.size || rendering) {
    e.preventDefault();
    e.returnValue = '';
  }
});


// ------------------------------------------------------------- phone remote --
// A phone that runs the show while you step away (cut, auto-director, fade, break, record).
// Only a phone added here, with the one-time code this shows, can; see remote-host.js.
let remoteHost = null, remoteTick = null;
function remoteState() {
  const brk = breakManual || directorBreak;
  const atBlack = black.target === 1;
  const cams = camOrder().map((p) => {
    const l = live.get(p);
    if (!l || l.role === 'mic') return null;
    return { peer: p, name: l.name || 'Guest', rec: !!l.rec, onAir: p === liveActive && !mediaOn && !brk && !atBlack, preview: p === pvw };
  }).filter(Boolean);
  // sound-only sources (microphones, this computer's sound): cut to one and the program shows
  // its sound picture, as it does from the studio
  const sound = [...live].filter(([, l]) => l.role === 'mic').map(([p, l]) => ({ peer: p, name: l.name || 'Microphone', onAir: p === liveActive && !mediaOn && !brk && !atBlack, local: !!l.local }));
  const mics = sound.map((s) => s.name);
  return {
    title: $('#title')?.textContent || 'Studio', cams, sound, mics, auto: !!autoOn, black: atBlack, brk,
    media: mediaOn ? reelOf(mediaOn.id)?.name || 'A clip' : null, rec: !!(progRec && !progRec.stopping),
  };
}
window.vmRemoteState = () => remoteState(); // (diagnostics and tests)
window.vmRemoteHost = () => remoteHost;
function remoteAct(a, arg) {
  if (a === 'cut') {
    if (!live.has(arg)) return 'That camera has gone';
    cutLive(arg);
    return '';
  }
  if (a === 'auto') return void setAuto(!!arg) || '';
  if (a === 'black') return void toggleBlack(true) || '';
  if (a === 'break') return void toggleBreak() || '';
  if (a === 'rec') {
    const on = !!(progRec && !progRec.stopping);
    if (!!arg !== on) recByHand();
    return '';
  }
  return 'Not something a remote can do';
}
function startRemoteHost() {
  remoteHost = new RemoteHost({
    eventId,
    send: (peer, data) => sock?.signal(peer, data),
    state: remoteState,
    act: remoteAct,
    thumbs: () => camOrder().map((p) => ({ peer: p, video: live.get(p)?.role !== 'mic' ? live.get(p)?.video : null })),
    changed: renderRemotes,
    note,
  });
  renderRemotes();
}
function renderRemotes() {
  const ul = $('#remoteList');
  if (!ul || !remoteHost) return;
  const list = remoteHost.list();
  ul.innerHTML = list.map((r) => `<li><span class="dot${r.connected ? ' live' : ''}" aria-hidden="true"></span> ${esc(r.name)} <span class="fine">${r.connected ? 'connected' : 'not connected'}</span> <button type="button" class="small" data-remote-del="${esc(r.key)}">Remove</button></li>`).join('');
  $('#remoteNone').hidden = list.length > 0;
  if (!remoteHost.pairing && $('#remoteDlg')?.open) $('#remoteDlg').close();
}
function openRemotePairing() {
  if (!remoteHost) return toast('A phone remote needs the studio to be live first');
  const p = remoteHost.startPairing();
  const code = `${p.code.slice(0, 4)}-${p.code.slice(4)}`;
  const url = `${location.origin}/remote?e=${eventId}#p=${p.code}`;
  drawQR($('#remoteQr'), url, { size: 360, ecl: 'M' });
  $('#remoteCode').textContent = code;
  $('#remoteLink').textContent = `${location.host}/remote · show ${eventId}`;
  $('#remoteDlg').showModal();
  clearInterval(remoteTick);
  const tick = () => {
    const left = remoteHost.pairingLeft();
    $('#remoteLeft').textContent = left ? `This code works once, for ${Math.ceil(left / 1000)} more seconds.` : 'The code has run out.';
    if (!left) {
      clearInterval(remoteTick);
      $('#remoteDlg').close();
    }
  };
  tick();
  remoteTick = setInterval(tick, 1000);
}
$('#remoteAdd')?.addEventListener('click', openRemotePairing);
$('#remoteCancel')?.addEventListener('click', () => {
  remoteHost?.stopPairing();
  $('#remoteDlg').close();
});
$('#remoteDlg')?.addEventListener('close', () => {
  clearInterval(remoteTick);
  if (remoteHost?.pairing) remoteHost.stopPairing(); // (closing the dialog takes the code away)
});
$('#remoteList')?.addEventListener('click', (e) => {
  const key = e.target.closest('[data-remote-del]')?.dataset.remoteDel;
  if (key && confirm('Remove this phone? It stops being a remote straight away.')) remoteHost?.remove(key);
});


// --------------------------------------------------------------- TV screens --
// The program on a TV: the Apple TV app, or /tv in any browser on this network. A TV joins with
// the event code and waits here until it's accepted; then it's
// remembered and comes back on its own. Its picture comes straight from this computer over the
// local network; see display-hub.js.
let displayHub = null;
function programForTv() {
  const out = [programVideoTrack()];
  const sound = mix.dest?.stream.getAudioTracks()[0];
  if (sound) out.push(sound.clone());
  return out;
}
function startDisplayHub() {
  displayHub = new DisplayHub({
    eventId,
    title: () => $('#title')?.textContent || ev?.title || '',
    send: (peer, data) => sock?.signal(peer, data),
    program: programForTv,
    changed: renderTvs,
    note,
    localOnly: () => !!$('#localOnly')?.checked,
  });
  window.vmDisplayHub = () => displayHub; // (diagnostics and tests)
  const code = $('#tvEventCode');
  if (code) code.textContent = eventId;
  renderTvs();
}
const TV_STATUS = { active: 'showing', starting: 'starting', connecting: 'connecting', joining: 'joining', away: 'not connected', error: 'can’t connect' };
function renderTvs() {
  const ul = $('#tvList');
  if (!ul || !displayHub) return;
  const { paired, waiting } = displayHub.list();
  const say = (t) => (t.detail === 'ice_failed_same_network' ? 'not on this network' : TV_STATUS[t.status] || t.status);
  ul.innerHTML =
    waiting.map((w) => `<li class="tvwait"><span class="dot" aria-hidden="true"></span> ${esc(w.name)} <span class="fine">wants to show the program</span> <button type="button" class="small" data-tv-accept="${esc(w.peer)}">Accept</button> <button type="button" class="small" data-tv-decline="${esc(w.peer)}">Decline</button></li>`).join('') +
    paired.map((t) => `<li><span class="dot${t.connected ? ' live' : ''}" aria-hidden="true"></span> ${esc(t.name)} <span class="fine">${esc(say(t))}</span>
      <select class="small" data-tv-mode="${esc(t.key)}" aria-label="What ${esc(t.name)} shows"><option value="program"${t.mode === 'program' ? ' selected' : ''}>Program</option><option value="idle"${t.mode === 'idle' ? ' selected' : ''}>Event card</option></select>
      <button type="button" class="small" data-tv-del="${esc(t.key)}">Remove</button></li>`).join('');
  $('#tvNone').hidden = paired.length + waiting.length > 0;
}
$('#tvList')?.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.tvAccept) displayHub?.accept(t.dataset.tvAccept);
  else if (t.dataset.tvDecline) displayHub?.decline(t.dataset.tvDecline);
  else if (t.dataset.tvDel && confirm('Remove this TV? It stops showing the program straight away.')) displayHub?.remove(t.dataset.tvDel);
});
$('#tvList')?.addEventListener('change', (e) => {
  const key = e.target.dataset.tvMode;
  if (key) displayHub?.setMode(key, e.target.value);
});
