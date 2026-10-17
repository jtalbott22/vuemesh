import { $, api, rememberEvent, myEvents, esc, toast, drawQR, now, fmtClock, themeButton, betaBanner, updateRemembered, forgetEventLocally, hostKey } from '/js/vm.js';
import * as idb from '/js/idb.js';
import { makeZip, ZIP_LIMIT } from '/js/zip.js';
import { EventGlobe, km } from '/js/globe.js';
import { BRAND, FEATURES, TERMS_VERSION } from '/js/brand.js';

betaBanner();
document.body.classList.toggle('globe', FEATURES.globe);
themeButton($('#themeBtn'));
$('#patreonLink').href = BRAND.patreon;
import { ANGLES, render, tickBeacon } from '/js/landing-scene.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const POOL = 0.2;
const REVENUE = 1000;

// ------------------------------------------------------------- the demo ----

const program = $('#program');
const pg = program.getContext('2d', { alpha: false });
const tiles = ANGLES.map((a, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  b.innerHTML = `<canvas></canvas><span class="n" style="color:${a.color}">${a.key}</span><span class="ttc tc"></span><span class="who">${a.who} · ${a.spot}</span>`;
  b.setAttribute('aria-label', `Cut to angle ${a.key}: ${a.who}, ${a.spot}`);
  b.addEventListener('click', () => cut(i, true));
  $('#tiles').append(b);
  const c = b.querySelector('canvas');
  return { b, c, g: c.getContext('2d', { alpha: false }), tc: b.querySelector('.ttc') };
});

let live = 1;            // open wide on Dev's balcony shot
let T = 7.5;             // scene time (frozen when reduced motion is on)
let W = 30;              // edit clock; starts 30 s in so the strip and credits already have a story
let mode = 'auto';
let lastUser = -1e9;
let nextAuto = 3;
let autoCount = 0;
let frameNo = 0;
let heroOnScreen = true;
let qrOnScreen = false;
const segs = [];
const screenTime = [0, 0, 0, 0];

function size(canvas, maxDpr) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.round(canvas.clientWidth * dpr);
  const h = Math.round(canvas.clientHeight * dpr);
  if (w && h && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
  }
}
const resize = () => {
  size(program, 2);
  tiles.forEach((t) => size(t.c, 1.5));
  size($('#strip'), 2);
  if (reduce) paint(true);
};
new ResizeObserver(resize).observe(document.body);

function cut(i, byUser) {
  if (byUser) {
    lastUser = W;
    setMode('you');
  }
  if (i === live) return;
  live = i;
  segs.push({ t: W, i, by: byUser ? 'you' : 'auto' });
  const f = $('#flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
  labelOnAir();
  if (reduce) paint(true);
}

function setMode(m) {
  if (m === mode) return;
  mode = m;
  $('#mode').textContent = m === 'you' ? 'You’re directing' : 'Auto-director';
  $('#mode').classList.toggle('you', m === 'you');
}

// Pretend the auto-director has been cutting for the last 30 seconds.
(function seedHistory() {
  let t = 0;
  while (t < W) {
    segs.push({ t, i: live, by: 'auto' });
    const end = Math.min(W, t + 2.4 + Math.random() * 2.8);
    screenTime[live] += end - t;
    t = end;
    if (t < W) live = autoPick();
  }
  nextAuto = W + 2.5;
})();

function labelOnAir() {
  const a = ANGLES[live];
  $('#onair').innerHTML = `On air · ${a.key} ${a.who}<span class="spot">, ${a.spot}</span>`;
  tiles.forEach((t, k) => t.b.classList.toggle('live', k === live));
}
labelOnAir();

function autoPick() {
  autoCount++;
  // Every third cut goes back to the wide; otherwise any close angle but this one.
  if (autoCount % 3 === 0 && live !== 1) return 1;
  const options = [0, 2, 3].filter((k) => k !== live);
  return options[Math.floor(Math.random() * options.length)];
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  const n = +e.key;
  if (n >= 1 && n <= 4) cut(n - 1, true);
});

function tc() {
  const d = new Date(now());
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}:${p(Math.floor(d.getMilliseconds() / (1000 / 30)))}`;
}

function paint(all) {
  render(pg, program.width, program.height, live, T, live, { still: reduce });
  tiles.forEach((t, k) => {
    // Tiles take turns on busy frames; everything repaints when asked.
    if (all || (frameNo + k) % 2 === 0) render(t.g, t.c.width, t.c.height, k, T, live, { still: reduce });
  });
}

// ------------------------------------------------------- strip + credits ----

const strip = $('#strip');
const sg = strip.getContext('2d');
function drawStrip() {
  const w = strip.width, h = strip.height;
  const span = 30;
  const from = W - span;
  sg.fillStyle = '#0e1329';
  sg.fillRect(0, 0, w, h);
  while (segs.length > 1 && segs[1].t < from) segs.shift();
  segs.forEach((s, k) => {
    const a = Math.max(s.t, from);
    const b = k + 1 < segs.length ? segs[k + 1].t : W;
    if (b <= a) return;
    const x0 = ((a - from) / span) * w;
    const x1 = ((b - from) / span) * w;
    sg.fillStyle = ANGLES[s.i].color;
    sg.fillRect(x0, h * 0.18, Math.max(1, x1 - x0 - 2), h * 0.64);
    if (s.t >= from) {
      sg.fillStyle = s.by === 'you' ? '#ffffff' : '#0e1329';
      sg.fillRect(x0, 0, Math.max(2, w / 400), h);
    }
    if (x1 - x0 > h * 0.6) {
      sg.fillStyle = '#0d1122';
      sg.font = `800 ${Math.round(h * 0.34)}px Archivo, system-ui, sans-serif`;
      sg.fillText(String(ANGLES[s.i].key), x0 + h * 0.18, h * 0.62);
    }
  });
}

const creditRows = ANGLES.map((a) => {
  const row = document.createElement('div');
  row.className = 'credit';
  row.innerHTML = `<span>${esc(a.who)}</span><span class="bar"><i style="background:${a.color};width:0"></i></span><span class="pct tc">0%</span><span class="usd tc">$0</span>`;
  $('#credits').append(row);
  return { bar: row.querySelector('i'), pct: row.querySelector('.pct'), usd: row.querySelector('.usd') };
});
function drawCredits() {
  const total = screenTime.reduce((s, v) => s + v, 0) || 1;
  creditRows.forEach((r, k) => {
    const share = screenTime[k] / total;
    r.bar.style.width = (share * 100).toFixed(1) + '%';
    r.pct.textContent = Math.round(share * 100) + '%';
    r.usd.textContent = '$' + Math.round(share * REVENUE * POOL);
  });
}

// ------------------------------------------------------------ the beacon ----

const qr = $('#qr');
const drawBeacon = () => {
  const t = now();
  drawQR(qr, `${location.origin}/#t=${Math.round(t)}`, { size: 680 });
  $('#qrtc').textContent = fmtClock(t);
};
drawBeacon();

// ------------------------------------------------------------ main loop ----

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.target.id === 'program') heroOnScreen = e.isIntersecting;
    if (e.target.id === 'qr') qrOnScreen = e.isIntersecting;
  }
});
io.observe(program);
io.observe(qr);

let last = performance.now();
let lastBeacon = 0;
let lastCredits = 0;
function frame(ms) {
  const dt = Math.min(0.1, (ms - last) / 1000);
  last = ms;
  W += dt;
  screenTime[live] += dt;
  if (!reduce) T += dt;

  if (mode === 'you' && W - lastUser > 9) setMode('auto');
  if (mode === 'auto' && W >= nextAuto) {
    cut(autoPick(), false);
    nextAuto = W + 2.4 + Math.random() * 2.8;
  }

  if (heroOnScreen && !window.vmFilmPlaying) {   // (a film covers it: no need to draw)
    if (!reduce) paint(false);
    const code = tc();
    $('#ptc').textContent = code;
    tiles.forEach((t) => (t.tc.textContent = code));
    drawStrip();
    if (ms - lastCredits > 250) {
      drawCredits();
      lastCredits = ms;
    }
  }
  if (ms - lastBeacon > 1000 / 15) {
    lastBeacon = ms;
    if (!reduce) tickBeacon();
    if (qrOnScreen) drawBeacon();
  }
  frameNo++;
  requestAnimationFrame(frame);
}
resize();
paint(true);
requestAnimationFrame(frame);

// -------------------------------------------------------- start an event ----

const pool = $('#pool'), poolOut = $('#poolOut'), poolHint = $('#poolHint');
const updatePool = () => {
  const v = +pool.value;
  poolOut.textContent = v + '%';
  poolHint.textContent = v
    ? `${v}% of any revenue this film earns is split among guests by how much of their footage makes the cut.`
    : 'No revenue sharing. Guests still get a "shot by" credit for their footage.';
};
pool.addEventListener('input', updatePool);
$('#kind').addEventListener('change', (e) => {
  pool.value = { show: 20, game: 10 }[e.target.value] ?? 0;
  updatePool();
});

$('#create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const title = $('#title').value.trim();
    const orientation = new FormData($('#create')).get('orientation') === 'portrait' ? 'portrait' : 'landscape';
    const body = { title, kind: $('#kind').value, poolPct: +pool.value, public: $('#listPublic').checked, orientation };
    if (body.public) Object.assign(body, await where().catch(() => ({})));
    const { id, hostKey } = await api('events', { method: 'POST', body });
    localStorage.setItem('vm_terms', TERMS_VERSION);
    localStorage.setItem('vm_host_' + id, hostKey);
    rememberEvent({ id, title });
    const studio = `${location.origin}/studio?e=${id}#k=${hostKey}`;
    $('#madeCode').textContent = id;
    $('#beaconLink').href = `/beacon?e=${id}`;
    $('#studioLink').href = studio;
    $('#copyStudio').onclick = async () => {
      await navigator.clipboard.writeText(studio);
      toast('Studio link copied');
    };
    $('#formBody').hidden = true;
    $('#made').classList.add('show');
    renderMine();
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

// ------------------------------------------------------------ find nearby ----

function where() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => reject(new Error('Allow location to find events near you')),
      { maximumAge: 600000, timeout: 10000 },
    );
  });
}

// --------------------------------------------------------- globe + board ----

const KINDS = { wedding: 'Wedding or party', show: 'Show', game: 'Game', talk: 'Talk or service', other: 'Event' };
let events = [];
let me = null;
const globe = FEATURES.globe
  ? new EventGlobe($('#globe'), { onSelect: (ev) => choose(ev, false) })
  : { select() {}, flyTo() {}, setMe() {}, setEvents() {}, load: async () => {}, selected: null };
const detail = document.createElement('div');
detail.className = 'detail';
detail.hidden = true;
detail.setAttribute('aria-live', 'polite');
$('#board').after(detail);

function ago(ms) {
  const d = Math.floor((Date.now() - ms) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
function statusOf(ev) {
  return ev.live ? 'live' : ev.published ? 'film' : 'idle';
}
function subline(ev) {
  const bits = [ev.live ? 'Live now' : ev.published ? 'Film ready' : `Created ${ago(ev.createdAt)}`, KINDS[ev.kind] || 'Event'];
  if (ev.orientation === 'portrait') bits.push('portrait');
  if (me && ev.km != null) bits.push(ev.km <= 1 ? 'about 1 km' : `${Math.round(ev.km)} km`);
  return bits.join(' · ');
}

function renderBoard(selectedId) {
  $('#boardCount').textContent = events.length ? `${events.filter((e) => e.live).length} live · ${events.length} total` : '';
  if (!events.length) {
    $('#board').innerHTML = '<li style="padding:14px;color:var(--text-2)">No public events yet. Start one below and tick “List it on the globe”.</li>';
    return;
  }
  $('#board').innerHTML = events
    .map((ev) => `<li><button type="button" data-id="${ev.id}" aria-current="${ev.id === selectedId}">
      <span class="pin ${statusOf(ev)}" aria-hidden="true"></span><b>${esc(ev.title)}</b><span class="go">${ev.live ? 'Shoot' : ev.published ? 'Watch' : ''}</span>
      <small>${esc(subline(ev))}</small></button></li>`)
    .join('');
}

function choose(ev, fly = true) {
  globe.select(ev, fly);
  renderBoard(ev.id);
  $(`#board [data-id="${ev.id}"]`)?.scrollIntoView({ block: 'nearest' });
  detail.hidden = false;
  detail.innerHTML = `<h3>${esc(ev.title)}</h3><p>${esc(subline(ev))}</p><div class="row">
    ${ev.live ? `<a class="btn primary" href="/cam?e=${ev.id}">Join and shoot</a>` : ''}
    ${ev.published ? `<a class="btn" href="/watch?e=${ev.id}">Watch the film</a>` : ''}
    ${!ev.live && !ev.published ? '<span style="color:var(--text-2)">Not live right now. Check back when it starts.</span>' : ''}</div>`;
}

$('#board').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (b) choose(events.find((x) => x.id === b.dataset.id));
});

async function loadEvents() {
  if (!FEATURES.globe) {
    $('#board').innerHTML = '<li style="padding:14px;color:var(--text-2)">Tap “Near me” to see public events within 80 km. Your location stays on this device; we only send it to find nearby events.</li>';
    return;
  }
  try {
    await globe.load();
    const { events: list } = await api('events/public');
    events = list;
    sortEvents();
    globe.setEvents(events);
    renderBoard();
  } catch (e) {
    $('#board').innerHTML = `<li style="padding:14px;color:var(--text-2)">Couldn't load events: ${esc(e.message)}</li>`;
  }
}
function sortEvents() {
  if (me) events.forEach((ev) => (ev.km = km(me.lat, me.lon, ev.lat, ev.lon)));
  events.sort((a, b) => (b.live - a.live) || (me ? a.km - b.km : b.createdAt - a.createdAt));
}
loadEvents();

$('#findBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Locating…';
  try {
    me = await where();
    if (!FEATURES.globe) {
      const { events: list } = await api(`events/near?lat=${me.lat.toFixed(2)}&lon=${me.lon.toFixed(2)}`);
      events = list;
      events.sort((a, b) => (b.live - a.live) || a.km - b.km);
      renderBoard();
      if (!events.length) $('#board').innerHTML = '<li style="padding:14px;color:var(--text-2)">Nothing public within 80 km right now. Start one below.</li>';
      return;
    }
    globe.setMe(me.lat, me.lon);
    globe.flyTo(me.lon, me.lat);
    sortEvents();
    renderBoard(globe.selected);
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Near me';
  }
});

// ---- your events on this device ----------------------------------------------------------
// Everything VUEMesh keeps locally: open it, export it (one ZIP of every recording plus
// the edit), archive it out of the way, or delete it from this device. We show when the
// server no longer has an event, but never delete anyone's footage on their behalf.

const fmtSize = (b) => (b >= 1e9 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? Math.round(b / 1048576) + ' MB' : b ? Math.max(1, Math.round(b / 1024)) + ' KB' : 'nothing stored');
let showArchived = false;

function renderMine() {
  const all = myEvents();
  const active = all.filter((e) => !e.archived), archived = all.filter((e) => e.archived);
  $('#mine').hidden = !all.length;
  $('#archToggle').hidden = !archived.length;
  $('#archToggle').textContent = showArchived ? 'Hide archived' : `Archived (${archived.length})`;
  $('#archToggle').setAttribute('aria-expanded', String(showArchived));
  $('#archList').hidden = !showArchived;
  const row = (ev) => {
    const host = ev.role !== 'guest';
    const href = host ? `/studio?e=${ev.id}` : `/cam?e=${ev.id}`;
    return `<li data-ev="${ev.id}">
      <a class="t" href="${href}">${esc(ev.title)}</a>
      <span class="m"><span class="badge">${host ? 'Host' : 'Guest'}</span><span>${ev.id}</span><span data-size>…</span><span data-status></span></span>
      <span class="acts">
        <a class="btn" href="${href}">Open</a>
        ${host ? '' : `<a class="btn" href="/cam?e=${ev.id}#footage">My events</a>`}
        <button type="button" data-act="export">Export</button>
        <button type="button" data-act="archive">${ev.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" data-act="delete" class="danger">Delete</button>
      </span></li>`;
  };
  $('#mineList').innerHTML = active.map(row).join('');
  $('#archList').innerHTML = archived.map(row).join('');
  for (const ev of all) fillMine(ev);
}

async function fillMine(ev) {
  const li = () => document.querySelector(`[data-ev="${ev.id}"]`);
  try {
    const u = await idb.usage(ev.id);
    const n = u.clips + u.outbox;
    if (li()) li().querySelector('[data-size]').textContent = `${fmtSize(u.bytes)}${n ? ` · ${n} recording${n > 1 ? 's' : ''}` : ''}`;
  } catch {}
  try {
    const live = await api(`events/${ev.id}`);
    const el = li()?.querySelector('[data-status]');
    if (el) el.innerHTML = live.live ? '<span class="badge live">LIVE</span>' : '<span>on the server</span>';
  } catch (e) {
    const el = li()?.querySelector('[data-status]');
    if (el) el.innerHTML = /No event|404/.test(e.message) ? '<span class="badge gone" title="It ended or was deleted on the server. Everything on this device is still here.">Ended on server</span>' : '';
  }
}

$('#archToggle').onclick = () => {
  showArchived = !showArchived;
  renderMine();
};

document.querySelector('#mine').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('[data-ev]').dataset.ev;
  const ev = myEvents().find((x) => x.id === id);
  if (b.dataset.act === 'archive') {
    updateRemembered(id, { archived: !ev.archived });
    toast(ev.archived ? 'Moved back to your events' : 'Archived. It\'s still on this device.');
    return renderMine();
  }
  if (b.dataset.act === 'export') return exportEvent(ev, b);
  if (b.dataset.act === 'delete') {
    const u = await idb.usage(id).catch(() => ({ bytes: 0, clips: 0, outbox: 0 }));
    const unsent = u.outbox ? `\n\n${u.outbox} recording${u.outbox > 1 ? 's have' : ' has'} not reached the host yet.` : '';
    if (!confirm(`Delete "${ev.title}" from this device?\n\nThis removes ${fmtSize(u.bytes)} of recordings and the edit from this browser.${unsent}\n\nExport first if you want to keep a copy. This can't be undone.`)) return;
    await idb.wipe(id);
    forgetEventLocally(id);
    toast(`Deleted "${ev.title}" from this device`);
    renderMine();
  }
});

/** One ZIP: every recording, any unsent clips and break media, plus the edit and metadata. */
async function exportEvent(ev, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  try {
    btn.textContent = 'Gathering…';
    const [clips, outbox, reel] = await Promise.all([idb.list('clips', ev.id), idb.list('outbox', ev.id), idb.list('reel', ev.id)]);
    const ls = (k) => {
      try { return JSON.parse(localStorage.getItem(`vm_${k}_${ev.id}`)); } catch { return null; }
    };
    const safe = (x) => String(x || '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clip';
    const ext = (b) => (b?.type?.includes('webm') ? 'webm' : b?.type?.startsWith('audio/') ? 'm4a' : 'mp4');
    const stamp = (t) => (t ? new Date(t).toISOString().slice(11, 19).replace(/:/g, '') : '');
    const files = [];
    const meta = (r) => { const { blob, key, ...m } = r; return m; };
    clips.forEach((c) => files.push({ name: `recordings/${safe(c.name)}-${stamp(c.t0)}-${c.id}.${ext(c.blob)}`, data: c.blob }));
    outbox.forEach((c) => files.push({ name: `not-yet-sent/${safe(c.meta?.name)}-${c.id}.${ext(c.blob)}`, data: c.blob }));
    reel.forEach((r) => files.push({ name: `break-media/${safe(r.name)}-${r.id}.${(r.type || '').split('/')[1] || 'bin'}`, data: r.blob }));
    const project = {
      vuemesh: 1, exportedAt: new Date().toISOString(), event: { id: ev.id, title: ev.title, role: ev.role || 'host' },
      recordings: clips.map(meta), notYetSent: outbox.map((o) => ({ id: o.id, meta: o.meta })), breakMedia: reel.map(meta),
      edit: ls('seq'), liveCuts: ls('cut'), media: ls('media'), crew: ls('crew'), angles: ls('angles'), mixer: ls('livemix'),
      note: 'Recordings are exactly as each phone signed them. The edit refers to recordings by id.',
    };
    files.unshift({ name: 'project.json', data: JSON.stringify(project, null, 2) });
    const total = files.reduce((s, f) => s + (typeof f.data === 'string' ? f.data.length : f.data.size), 0);
    const name = `${safe(ev.title)}-${ev.id}`;
    if (total < ZIP_LIMIT) {
      const zip = await makeZip(files, (d, t) => (btn.textContent = `Packing ${Math.round((d / t) * 100)}%`));
      save(zip, `${name}.zip`);
    } else {
      // Over 4 GB: hand over the files one by one instead.
      toast('This event is bigger than one ZIP can hold, so the files will download one by one.', 6000);
      for (const f of files) {
        save(typeof f.data === 'string' ? new Blob([f.data], { type: 'application/json' }) : f.data, `${name}-${f.name.split('/').pop()}`);
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    toast(`Exported "${ev.title}" (${fmtSize(total)})`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function save(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

renderMine();


// ---- Use it now: Camera, My media, Kiosk, Join right from here, no event needed. The first
// time, agree to the terms (asked again only when they change); after that a tap goes straight in.
{
  const gate = document.querySelector('#gate');
  let target = null;
  document.querySelectorAll('.apps [data-app]').forEach((a) => a.addEventListener('click', (e) => {
    if (localStorage.getItem('vm_terms') === TERMS_VERSION) return;
    e.preventDefault();
    target = a.href;
    gate.querySelector('#gateOk').checked = false;
    gate.querySelector('#gateGo').disabled = true;
    gate.showModal();
  }));
  gate?.querySelector('#gateOk').addEventListener('change', (e) => (gate.querySelector('#gateGo').disabled = !e.target.checked));
  gate?.querySelector('#gateNo').addEventListener('click', () => gate.close());
  gate?.querySelector('#gateGo').addEventListener('click', () => {
    localStorage.setItem('vm_terms', TERMS_VERSION);
    gate.close();
    if (target) location.href = target;
  });
}
