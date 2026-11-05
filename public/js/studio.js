// The studio: the Live page, the Edit page and the kiosk all load this. The code is in ./studio/,
// one file per area, in the order the single file had it. Each part imports the part before it
// first, so loading the last part runs them all in that order, top to bottom, as one file did:
// load-time code (wiring buttons, listeners) runs in the same order, and a part can still call a
// function in a later part. Add a part by importing the previous last one first, and point this at it.
// An imported variable can't be assigned to, so a variable another part changes has a setter
// beside it (setLiveActive(peer) for liveActive = peer; setModeValue where setMode is already taken).
//
// The parts, in load order:
//    1. core.js           shared state, the page helpers, constants
//    2. clips.js          output shape, clips, the cut log, the channel to the Edit page, Live/Edit modes
//    3. live.js           live mode: the camera tiles, break and black as sources, keeping pictures moving
//    4. usage.js          anonymous usage counts
//    5. onair.js          tally, the AI technical director, direct links to phones
//    6. mixer.js          the live mixer, its strips and meter bridge, the pop-out audio console
//    7. sources.js        this computer's cameras, mics, screen and sound; recording; moderation
//    8. ccu.js            Camera control for the phones
//    9. console-draw.js   the audio console's drawing
//   10. stream.js         Stream out (WHIP and RTMP)
//   11. room.js           the full screen control room, crew messages and rundown, moments
//   12. graphics.js       break slate, black, clips on air, lower thirds, the slate look, the mics-only picture
//   13. switcher.js       the live program and the switcher; running while covered
//   14. autopilot.js      autopilot and the kiosk
//   15. phones.js         the live cut sent to the crew, iPhone playback, overflow, capacity, diagnostics, incoming clips
//   16. edit.js           Edit mode, transforms, Program monitor handles, dissolves, the export range
//   17. menus.js          right-click menus
//   18. transport.js      program meters, Program out, layout, transport, tools, markers on the ruler
//   19. editops.js        edit operations
//   20. library.js        the media manager, Source monitor, media inspector
//   21. sync.js           optical sync and lining clips up by sound
//   22. export.js         render and export, wrap
//   23. screens.js        the Monitor, the phone remote, TV screens
//   24. showlog.js        the show log (what happened, second by second) and the sound watch
import './studio/showlog.js';
