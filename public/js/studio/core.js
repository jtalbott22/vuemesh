// Studio, part 1 of 25: shared state, the page helpers, constants.
// The parts load in order (see ../studio.js); this one loads every library first, as the single file did.
import {
  $ as $q, api, hostKey, rememberEvent, meshSocket, toast, esc, eventIdFromUrl, myEvents, themeButton,
  announce, helpDialog, diag,
} from '/js/vm.js';
import { bitrateHints } from '/js/quality.js';
import '/js/camctl.js';
import '/js/remote-host.js';
import '/js/display-hub.js';
import { EditPlayer } from '/js/editplayer.js';
import '/js/compose.js';
import '/js/slates.js';
import '/js/audiofx.js';
import '/js/audiosync.js';
import '/js/whip.js';
import '/js/rtmp.js';
import * as S from '/js/sequence.js';
import { Timeline } from '/js/timeline.js';
import '/js/director.js';
import '/js/render.js';
import { HostHub } from '/js/rtc.js';
import { FEATURES } from '/js/brand.js';
import * as idb from '/js/idb.js';
import '/js/media.js';
import {
  addClip, angleOfCid, appendLiveSoon, clipOf, commit, labelOf, loadCut, loadSeq, noteAngle, rebuild,
  renderOutput, setFit, setMode, setOrientation, snapshot, undoStack, viewOf,
} from './clips.js';
import { camOrder, fitTile, renderLive } from './live.js';
import { renderQuality } from './usage.js';
import { autoOn, director, updateNetwork } from './onair.js';
import { mixAttach, mixDetach, renderMixer } from './mixer.js';
import { flushRecordings, isBlocked } from './sources.js';
import { ccuSync } from './ccu.js';
import { crewHeard, media, renderMoments, welcomePhone } from './room.js';
import { addReel, reel } from './graphics.js';
import { ap, apCountIn } from './autopilot.js';
import {
  checkCrowd, leavingPeers, liveLimit, prepareLeaving, presenceOff, presenceOn, rebalanceSlots,
  renderIncoming, sendProgramParts, sendSlot,
} from './phones.js';
import { renderTimeline, select } from './edit.js';
import { deleteMarker, markerMenu, moveMarker, renameMarker, renderTools, timeOfAbs } from './transport.js';
import { deleteRecording } from './library.js';
import { displayHub, onTvCal, pushMonitor, remoteHost, startDisplayHub, startRemoteHost } from './screens.js';
import { bgInterval } from '/js/bgclock.js';

// The Live studio and Edit are separate pages, each with only its own markup; this code serves
// both. The other page's elements are listed on <body data-absent> (id: tag): asked for one,
// the code gets a detached stand-in rather than null, so wiring that page's controls is harmless
// here. Anything else that's missing is still null, as it should be. (window.vmAbsent lists
// the stand-ins handed out, for tests.)
const ABSENT = JSON.parse(document.body?.dataset.absent || '{}');
const absentStubs = new Map();
window.vmAbsent = () => [...absentStubs.keys()];
export const $ = (s, el = document) => {
  const hit = $q(s, el);
  if (hit || el !== document) return hit;
  const id = /^#([\w-]+)$/.exec(s)?.[1];
  if (!id || !(id in ABSENT)) return hit;
  if (!absentStubs.has(id)) absentStubs.set(id, document.createElement(ABSENT[id]));
  return absentStubs.get(id);
};

// Recording formats, best first: H.264 in MP4 plays everywhere, including iPhones.
export const REC_MIMES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/webm;codecs=h264,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
export const recMime = () => REC_MIMES.find((m) => window.MediaRecorder?.isTypeSupported(m));

export const COLORS = ['#6d9cf0', '#f0b44d', '#4cc2b3', '#c883dc', '#9ccf5e', '#6fd0ef', '#e39bbd', '#c7b97a', '#9aa3ff'];
export const FRAME = S.FRAME;
export const LIVE_DELAY = 250;   // live previews arrive ~¼ s late; live cuts are back-dated by this much
export const STALL_MS = 1500;    // an on-air camera silent this long counts as dropped
export const dbToGain = (db) => (db <= -60 ? 0 : 10 ** (db / 20));
export const gainToDb = (g) => (g <= 0.001 ? -60 : Math.round(20 * Math.log10(g)));

export const eventId = eventIdFromUrl();
export const key = hostKey(eventId);
export let ev;
export let isHost = false;
export let mode = 'live';
export function setModeValue(v) { return (mode = v); }
export const clips = [];               // verified clip records (video and audio)
export const blobs = new Map();        // clip id → object URL
export const rawBlobs = new Map();     // clip id → Blob (for rendering)
export const thumbs = new Map();       // clip id → data URL
export let cut = loadCut();            // multicam cut log (live cuts and number keys)
export function setCut(v) { return (cut = v); }
export let seq = loadSeq();            // the layered edit
export function setSeq(v) { return (seq = v); }
export let selectedItem = null;
export function setSelectedItem(v) { return (selectedItem = v); }
export let sock, hub;
export const live = new Map();         // peer → { stream, name, cid, role, route, rec, tile, video, tele, stats }
export let liveActive = null;
export function setLiveActive(v) { return (liveActive = v); }
export let lastLive = null;
export function setLastLive(v) { return (lastLive = v); }
export let orientation = 'landscape';
export function setOrientationValue(v) { return (orientation = v); }
export let fit = localStorage.getItem('vm_fit_' + eventId) || 'fill';
export function setFitValue(v) { return (fit = v); }
export const log = [];                 // event log for the monitor
const returning = new Map();    // peer → { joinedAt } while a phone rebuilds its link
// Black: the whole program faded (or cut) to black, picture and sound. 0 = normal, 1 = black.
export const black = { target: 0, from: 0, start: 0, dur: 0, cleared: true };
// A kiosk (a sign or a screen people walk up to): the studio, stripped down and hands-free.
// The kiosk screen is its own page (/kiosk), with only what a sign needs; the studio in kiosk
// mode (?kiosk=1) still works for older links.
export const KIOSK_PAGE = location.pathname.replace(/\/+$/, '') === '/kiosk';
export const KIOSK = KIOSK_PAGE || new URLSearchParams(location.search).has('kiosk');
// The Edit page (/edit): the same engine, editing only, in its own window beside the live
// studio. It doesn't connect to phones or cameras; the studio tells it (on this computer) when
// a recording lands or the live cut changes, and it rebuilds there and then, so the edit comes
// together while the show's live. While it's open, it owns the timeline: the studio leaves it be.
export const EDIT_ONLY = location.pathname.replace(/\/+$/, '') === '/edit';
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
export const editCh = typeof BroadcastChannel === 'function' && eventId ? new BroadcastChannel('vm-edit-' + eventId) : null;
export let editPageAt = 0, seqStale = false;

export const program = $('#program');
export const player = new EditPlayer({
  canvas: program,
  urlFor: (id) => blobs.get(id),
  imageFor: (asset) => reel.find((r) => r.id === asset)?.el || null,
  title: () => ev?.title || '',
  viewOf: (item, ms) => viewOf(item, ms),
  audioOf: (id) => clipOf(id)?.audio, // 'stereo' if the phone recorded real stereo
});
player.enabled = false;
player.fit = fit;

export const timeline = new Timeline({
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
export const help = helpDialog('Studio help', [
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
export const progOutPeers = new Map();
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
    window.vmEditMsgs[m.t] = (window.vmEditMsgs[m.t] || 0) + 1;
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
  renderOutput();
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
      // (and a phone measuring a TV's lag, from /tvcal: only the result, to the open Calibrate)
      onSignal: (from, data, role) => (data?.remote ? remoteHost?.onMessage(from, data) : data?.tvcal ? onTvCal(data.tvcal) : role === 'display' ? displayHub?.onSignal(from, data, role) : hub.onSignal(from, data, role)),
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
    bgInterval(pushMonitor, 2000);
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

export function note(text) {
  diag('event', text);
  log.unshift({ at: Date.now(), text });
  log.length = Math.min(log.length, 200);
}

// The monitors fill whatever space the layout leaves them, keeping their shape.
export function fitMonitors() {
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
