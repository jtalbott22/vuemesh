// The home page's setups: pick one, and see how the devices you already own fit together.
// What sees and hears (cameras, microphones) → the studio → what shows and sends (screens, the
// stream, the recording), with the three steps to set it up. Plain data: edit a setup here.

const $ = (s) => document.querySelector(s);

// Small line icons, drawn in the current colour (the job's colour).
const ICON = {
  phone: '<rect x="15" y="5" width="18" height="38" rx="4"/><path d="M21 38h6"/>',
  tablet: '<rect x="9" y="6" width="30" height="36" rx="4"/><path d="M21 37h6"/>',
  laptop: '<rect x="10" y="10" width="28" height="19" rx="2"/><path d="M5 35h38l-3-6H8z"/>',
  desktop: '<rect x="4" y="8" width="19" height="15" rx="1.5"/><rect x="25" y="8" width="19" height="15" rx="1.5"/><path d="M13 23v6M35 23v6M8 31h10M30 31h10"/>',
  webcam: '<circle cx="24" cy="19" r="11"/><circle cx="24" cy="19" r="4"/><path d="M17 38h14M24 30v8"/>',
  mic: '<rect x="18" y="5" width="12" height="22" rx="6"/><path d="M12 22a12 12 0 0 0 24 0M24 34v8M17 42h14"/>',
  tv: '<rect x="4" y="9" width="40" height="25" rx="2"/><path d="M16 41h16M24 34v7"/>',
  stick: '<rect x="4" y="9" width="40" height="25" rx="2"/><path d="M16 41h16M24 34v7"/><rect x="31" y="35" width="11" height="5" rx="1"/>',
  stream: '<circle cx="24" cy="24" r="3.5"/><path d="M16 16a11 11 0 0 0 0 16M32 16a11 11 0 0 1 0 16M10 10a19 19 0 0 0 0 28M38 10a19 19 0 0 1 0 28"/>',
  file: '<path d="M12 5h16l9 9v29H12z"/><path d="M28 5v9h9"/><path d="M21 22v12l9-6z"/>',
  sound: '<path d="M8 19h7l9-7v24l-9-7H8z"/><path d="M30 18a8 8 0 0 1 0 12M35 13a15 15 0 0 1 0 22"/>',
  share: '<rect x="10" y="12" width="28" height="18" rx="2"/><path d="M5 37h38l-3-7H8z"/><path d="M24 26v-9M19.5 21l4.5-4.5 4.5 4.5"/>',
  clip: '<rect x="6" y="10" width="36" height="28" rx="3"/><path d="M6 17h36M6 31h36M13 10v7M21 10v7M29 10v7M37 10v7M13 31v7M21 31v7M29 31v7M37 31v7"/><path d="M21 20v8l6-4z"/>',
  iface: '<rect x="5" y="15" width="38" height="18" rx="3"/><circle cx="14" cy="24" r="4"/><circle cx="26" cy="24" r="4"/><path d="M34 21h4M34 27h4"/>',
  projector: '<rect x="6" y="16" width="36" height="16" rx="3"/><circle cx="16" cy="24" r="5"/><path d="M28 21h8M28 27h8M12 32l-3 6M36 32l3 6"/>',
  call: '<rect x="5" y="10" width="38" height="26" rx="3"/><circle cx="17" cy="21" r="4"/><path d="M10 31a7 7 0 0 1 14 0"/><rect x="28" y="16" width="10" height="10" rx="1.5"/>',
};
const icon = (k) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// The jobs a device can take, and their colours (the page's tally / preview / amber family).
const JOB = {
  camera: { name: 'Camera', color: '#e8352b' },
  mic: { name: 'Microphone', color: '#2fb36b' },
  screen: { name: 'Screen', color: '#4f8df0' },
  remote: { name: 'Remote', color: '#d9962b' },
  share: { name: 'Shared screen', color: '#2bb3c0' },
  clip: { name: 'Clip', color: '#e05fa8' },
  stream: { name: 'Goes live', color: '#a46fe0' },
  keep: { name: 'Keeps', color: '#8a8f99' },
};

const SETUPS = [
  {
    id: 'desk',
    tab: 'Solo desk',
    say: 'A stream, a podcast or a tutorial from one desk. Everything plugs into the computer: nothing else needed.',
    studio: { icon: 'desktop', name: 'A desktop, two screens', note: 'The studio on one, the program on the other' },
    in: [
      { icon: 'webcam', name: '2 USB webcams', job: 'camera', note: 'Your face, and the overhead shot of the desk' },
      { icon: 'iface', name: 'USB audio interface', job: 'mic', note: 'Two mics, each on its own channel' },
      { icon: 'desktop', name: 'Your screen', job: 'share', note: 'Slides, code or a game, with its sound' },
      { icon: 'clip', name: 'Intro and ads', job: 'clip', note: 'Video files, one click from air' },
    ],
    out: [
      { icon: 'desktop', name: 'Second screen', job: 'screen', note: 'The program, full screen' },
      { icon: 'stream', name: 'YouTube, Twitch…', job: 'stream', note: 'Live, straight from the desktop' },
      { icon: 'call', name: 'Zoom, Teams, Meet', job: 'stream', note: 'The program as your camera' },
      { icon: 'file', name: 'Every source', job: 'keep', note: 'The program, and each camera and mic on its own' },
    ],
    steps: ['Open the studio; + This computer adds the webcams, the interface and your screen.', 'Drop your intro and ads into Clips.', 'Go live, record, or be the camera in your next call.'],
  },
  {
    id: 'talk',
    tab: 'Talk or meeting',
    say: "A talk, a class or a hybrid meeting: the presenter shares from their own laptop, and the room and the people online see it all.",
    studio: { icon: 'laptop', name: 'A laptop', note: 'At the back of the room, running the studio' },
    remote: { icon: 'phone', name: 'Your phone', note: 'The remote, from the front row' },
    in: [
      { icon: 'share', name: "The presenter's laptop", job: 'share', note: 'Opens a link and shares its slides, with sound' },
      { icon: 'webcam', name: 'USB webcam', job: 'camera', note: 'On the speaker, from the back' },
      { icon: 'mic', name: 'USB mic', job: 'mic', note: 'At the lectern' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'The audience, for the questions' },
      { icon: 'clip', name: 'Video package', job: 'clip', note: 'A film made beforehand, aired in a click' },
    ],
    out: [
      { icon: 'projector', name: 'Projector', job: 'screen', note: 'The slides, with the speaker in the corner' },
      { icon: 'stream', name: 'Online audience', job: 'stream', note: 'Live, or the camera in a video call' },
      { icon: 'file', name: 'The talk, recorded', job: 'keep', note: 'Slides and speaker, and each on its own' },
    ],
    steps: ['Open the studio; add the webcam and the mic with + This computer.', 'Send the presenter the share link; they share their slides.', 'Cut between them, or put the speaker in the corner over the slides.'],
  },
  {
    id: 'phones',
    tab: 'Event',
    say: 'A wedding, a gig, a game: one laptop, the phones already in the room, and your sponsors in every break.',
    studio: { icon: 'laptop', name: 'A laptop', note: 'Runs the studio in Chrome or Edge' },
    in: [
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'The wide shot, on a stand' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'Close up, front row' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'Roaming, in someone’s hand' },
      { icon: 'clip', name: 'Sponsor spots', job: 'clip', note: 'Through every break, and between songs' },
    ],
    out: [
      { icon: 'tv', name: 'The TV', job: 'screen', note: 'The QR Beacon to join, then the show' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'On the laptop, and on each phone' },
    ],
    steps: ['Start a show and open the studio on the laptop.', 'Put the QR Beacon on the TV. Each phone scans it once.', 'Cut it yourself, or let the Auto Director; take a break and the sponsors roll.'],
  },
  {
    id: 'living',
    tab: 'Living room',
    say: 'A recital, a game night, a birthday: old phones become cameras, and the big TV shows it all.',
    studio: { icon: 'laptop', name: 'A laptop', note: 'On the coffee table, running the studio' },
    remote: { icon: 'phone', name: 'Your phone', note: 'The remote, so you can sit down' },
    in: [
      { icon: 'phone', name: 'Old phone', job: 'camera', note: 'Retired, now on a tripod' },
      { icon: 'phone', name: 'Phone + USB‑C mic', job: 'camera', note: 'Picture and proper sound, one device' },
      { icon: 'laptop', name: 'Second laptop', job: 'camera', note: 'Its own camera, from the side' },
      { icon: 'sound', name: 'The laptop’s sound', job: 'mic', note: 'The music, straight in' },
    ],
    out: [
      { icon: 'stick', name: 'TV, with a stick PC', job: 'screen', note: 'Opens /tv: the show, live' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'On the laptop, and on each device' },
    ],
    steps: ['Open the studio on the laptop, and share its sound if there’s music.', 'The phones and the second laptop scan the QR Beacon.', 'Open /tv on the TV and accept it. Pair your phone as the remote.'],
  },
  {
    id: 'drawer',
    tab: 'Everything in the drawer',
    say: 'Two laptops, a desktop, a TV stick, three generations of phones, four webcams and a couple of USB mics. Every one of them has a job.',
    studio: { icon: 'desktop', name: 'The desktop, two screens', note: 'Studio on one screen, program on the other' },
    remote: { icon: 'phone', name: 'The oldest phone', note: 'The remote, in your pocket' },
    in: [
      { icon: 'webcam', name: '3 webcams', job: 'camera', note: 'On the desktop: three angles' },
      { icon: 'mic', name: 'USB mic', job: 'mic', note: 'On the desktop' },
      { icon: 'phone', name: 'Newest phone + USB‑C mic', job: 'camera', note: 'The best camera, with the best sound' },
      { icon: 'phone', name: 'Middle phone', job: 'camera', note: 'The roaming angle' },
      { icon: 'laptop', name: 'Laptop + webcam', job: 'camera', note: 'One more angle across the room' },
    ],
    out: [
      { icon: 'stick', name: 'TV, with a stick PC', job: 'screen', note: 'The program, on /tv' },
      { icon: 'laptop', name: 'The other laptop', job: 'screen', note: 'The QR Beacon, by the door' },
      { icon: 'stream', name: 'Live', job: 'stream', note: 'Only if you want an audience' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'Full quality, on the desktop' },
    ],
    steps: ['Open the studio on the desktop; add the webcams and the mic with + This computer.', 'Put the QR Beacon on the spare laptop. The phones and the other laptop scan it.', 'Open /tv on the TV stick and accept it. Pair the oldest phone as the remote.'],
  },
];

function item(d) {
  const j = JOB[d.job];
  return `<li style="--job:${j.color}">${icon(d.icon)}<span><b>${d.name}</b><small>${d.note}</small></span><em>${j.name}</em></li>`;
}

function show(id) {
  const s = SETUPS.find((x) => x.id === id) || SETUPS[0];
  document.querySelectorAll('#rigTabs [data-setup]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.setup === s.id)));
  $('#rigIn').innerHTML = s.in.map(item).join('');
  $('#rigOut').innerHTML = s.out.map(item).join('');
  $('#rigStudio').innerHTML = `${icon(s.studio.icon)}<b>${s.studio.name}</b><small>${s.studio.note}</small><em>Studio</em>`;
  $('#rigRemote').hidden = !s.remote;
  if (s.remote) $('#rigRemote').innerHTML = `${icon(s.remote.icon)}<span><b>${s.remote.name}</b><small>${s.remote.note}</small></span>`;
  $('#rigSay').textContent = s.say;
  $('#rigSteps').innerHTML = s.steps.map((t) => `<li>${t}</li>`).join('');
  const box = $('#rigFlow');
  box.classList.remove('fresh');
  void box.offsetWidth;
  box.classList.add('fresh');
}

$('#rigTabs').innerHTML = SETUPS.map((s, i) => `<button type="button" role="tab" data-setup="${s.id}" aria-selected="${i === 0}" aria-controls="rigFlow">${s.tab}</button>`).join('');
$('#rigTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-setup]');
  if (b) show(b.dataset.setup);
});
// arrow keys move between the tabs, as tabs do
$('#rigTabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('#rigTabs [data-setup]')];
  const i = tabs.findIndex((b) => b.getAttribute('aria-selected') === 'true');
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  next.focus();
  show(next.dataset.setup);
});
show('desk');

// ---- any device, any job ------------------------------------------------------------
const YES = '<span class="yes" aria-label="Yes">●</span>', NO = '<span class="no" aria-label="No">–</span>';
const JOBS = [
  // [device, icon, studio, kiosk, camera, mic, shares its screen, screen, remote]
  ['Laptop or desktop', 'laptop', 1, 1, 1, 1, 1, 1, 1],
  ['Phone, new or old', 'phone', 0, 0, 1, 1, 0, 1, 1],
  ['Tablet', 'tablet', 0, 'newer ones', 1, 1, 0, 1, 1],
  ['TV, stick PC or projector', 'tv', 0, 'a stick PC', 0, 0, 0, 1, 0],
  ['USB webcam', 'webcam', 0, 0, 'into a computer', 'its own mic', 0, 0, 0],
  ['USB microphone', 'mic', 0, 0, 0, 'into a computer or a phone', 0, 0, 0],
  ['USB audio interface', 'iface', 0, 0, 0, 'stereo, or each input its own', 0, 0, 0],
];
$('#jobs tbody').innerHTML = JOBS.map(([name, ic, ...cells]) => `<tr><th scope="row">${icon(ic)}${name}</th>${cells.map((c) => `<td>${c === 1 ? YES : c ? `${YES}<small>${c}</small>` : NO}</td>`).join('')}</tr>`).join('');
