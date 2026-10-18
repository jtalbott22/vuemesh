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
};
const icon = (k) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

// The jobs a device can take, and their colours (the page's tally / preview / amber family).
const JOB = {
  camera: { name: 'Camera', color: '#e8352b' },
  mic: { name: 'Microphone', color: '#2fb36b' },
  screen: { name: 'Screen', color: '#4f8df0' },
  remote: { name: 'Remote', color: '#d9962b' },
  stream: { name: 'Goes live', color: '#a46fe0' },
  keep: { name: 'Keeps', color: '#8a8f99' },
};

const SETUPS = [
  {
    id: 'phones',
    tab: 'Just phones',
    say: 'The quickest show there is: one laptop, and the phones already in the room.',
    studio: { icon: 'laptop', name: 'A laptop', note: 'Runs the studio in Chrome or Edge' },
    in: [
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'The wide shot, on a stand' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'Close up, front row' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'Roaming, in someone’s hand' },
    ],
    out: [
      { icon: 'tv', name: 'The TV', job: 'screen', note: 'The beacon to join, then the show' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'On the laptop, and on each phone' },
    ],
    steps: ['Start a show and open the studio on the laptop.', 'Put the beacon on the TV. Each phone scans it once.', 'Cut it yourself, or let the Auto Director.'],
  },
  {
    id: 'podcast',
    tab: 'Podcast desk',
    say: 'Two hosts, two webcams, two good microphones, and one computer doing the rest.',
    studio: { icon: 'desktop', name: 'A desktop, two screens', note: 'The studio on one, the program on the other' },
    in: [
      { icon: 'webcam', name: 'Webcam', job: 'camera', note: 'Host one, plugged into the desktop' },
      { icon: 'webcam', name: 'Webcam', job: 'camera', note: 'Host two, plugged into the desktop' },
      { icon: 'mic', name: 'USB mic', job: 'mic', note: 'Host one, into the desktop' },
      { icon: 'mic', name: 'USB mic', job: 'mic', note: 'Host two, into the desktop' },
      { icon: 'phone', name: 'Phone', job: 'camera', note: 'The wide shot of the table' },
    ],
    out: [
      { icon: 'desktop', name: 'Second screen', job: 'screen', note: 'The program, full screen' },
      { icon: 'stream', name: 'YouTube, Twitch…', job: 'stream', note: 'Only if you go live: straight from the desktop' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'Each camera and mic, separately, on the desktop' },
    ],
    steps: ['Open the studio on the desktop; add its webcams and mics with + This computer.', 'The phone scans the beacon and becomes the wide shot.', 'Open Program out on the second screen, paste a stream key, and go live.'],
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
    steps: ['Open the studio on the laptop, and share its sound if there’s music.', 'The phones and the second laptop scan the beacon.', 'Open /tv on the TV and accept it. Pair your phone as the remote.'],
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
      { icon: 'laptop', name: 'The other laptop', job: 'screen', note: 'The beacon, by the door' },
      { icon: 'stream', name: 'Live', job: 'stream', note: 'Only if you want an audience' },
      { icon: 'file', name: 'Every angle', job: 'keep', note: 'Full quality, on the desktop' },
    ],
    steps: ['Open the studio on the desktop; add the webcams and the mic with + This computer.', 'Put the beacon on the spare laptop. The phones and the other laptop scan it.', 'Open /tv on the TV stick and accept it. Pair the oldest phone as the remote.'],
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
show('phones');

// ---- any device, any job ------------------------------------------------------------
const YES = '<span class="yes" aria-label="Yes">●</span>', NO = '<span class="no" aria-label="No">–</span>';
const JOBS = [
  // [device, icon, studio, camera, mic, screen, remote]
  ['Laptop or desktop', 'laptop', 1, 1, 1, 1, 1],
  ['Phone, new or old', 'phone', 0, 1, 1, 1, 1],
  ['Tablet', 'tablet', 0, 1, 1, 1, 1],
  ['TV, stick PC or projector', 'tv', 0, 0, 0, 1, 0],
  ['USB webcam', 'webcam', 0, 'into a computer', 0, 0, 0],
  ['USB microphone', 'mic', 0, 0, 'into a computer or a phone', 0, 0],
];
$('#jobs tbody').innerHTML = JOBS.map(([name, ic, ...cells]) => `<tr><th scope="row">${icon(ic)}${name}</th>${cells.map((c) => `<td>${c === 1 ? YES : c ? `${YES}<small>${c}</small>` : NO}</td>`).join('')}</tr>`).join('');
