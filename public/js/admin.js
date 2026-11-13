// Admin: see and manage everything VUEMesh keeps in the cloud, without the AWS console.
import { $, api, esc, toast, themeButton, announce } from '/js/vm.js';

themeButton($('#themeBtn'));
let adminKey = sessionStorage.getItem('vm_admin') || '';
let events = [];
let next = null;

const call = (path, opts = {}) => api('admin/' + path, { ...opts, headers: { 'x-admin-key': adminKey, ...(opts.headers || {}) } });

async function signIn(key) {
  adminKey = key;
  try {
    await call('whoami');
    sessionStorage.setItem('vm_admin', key);
    $('#login').hidden = true;
    $('#main').hidden = false;
    $('#signOut').hidden = false;
    await load(true);
    loadGrowth().catch((e) => toast(`Growth: ${e.message}`, 5000));
    loadTraffic().catch((e) => toast(`Web traffic: ${e.message}`, 5000))
      .then(loadServers).catch((e) => ($('#servers').innerHTML = `<p class="note">Couldn't read the servers: ${esc(e.message)}</p>`));
  } catch (e) {
    sessionStorage.removeItem('vm_admin');
    adminKey = '';
    toast(e.message, 5000);
  }
}

$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  signIn($('#key').value.trim());
});
$('#signOut').onclick = () => {
  sessionStorage.removeItem('vm_admin');
  location.reload();
};
if (adminKey) signIn(adminKey);

async function load(reset) {
  if (reset) {
    events = [];
    next = null;
    const st = await call('stats');
    const mb = st.filmBytes > 1e9 ? (st.filmBytes / 1e9).toFixed(2) + ' GB' : Math.round(st.filmBytes / 1e6) + ' MB';
    $('#tiles').innerHTML = [
      ['Events', st.events], ['Live now', st.live], ['Published', st.published], ['Film files', st.films], ['Film storage', mb],
    ].map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  }
  const page = await call(`events?limit=50${next ? '&cursor=' + encodeURIComponent(next) : ''}`);
  events = events.concat(page.events);
  next = page.next;
  $('#more').hidden = !next;
  render();
}

function daysLeft(ev) {
  return ev.expiresAt ? Math.max(0, Math.round((ev.expiresAt - Date.now()) / 86400000)) : '—';
}

// time used on each part of VUEMesh for this event: the studio live, editing, a kiosk, the phones
const hm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : s ? `${s} s` : '');
function timeUsed(e) {
  const t = e.time || {};
  const parts = [['Studio', t.studio], ['Edit', t.edit], ['Kiosk', t.kiosk], ['Cameras', t.cameras]].filter(([, s]) => s > 0);
  return parts.length ? parts.map(([k, s]) => `<span title="${k}">${k} ${hm(s)}</span>`).join('<br>') : '<span class="fine">—</span>';
}
function render() {
  const q = $('#filter').value.trim().toLowerCase();
  // (no names: a show's name stays on its devices, and the server never has it)
  const list = events.filter((e) => !q || e.id.toLowerCase().includes(q) || (q === 'kiosk' && e.surface === 'kiosk') || (q === 'studio' && e.surface !== 'kiosk') || String(e.kind || '').includes(q));
  $('#list').innerHTML = list.length
    ? `<table><thead><tr><th scope="col">Code</th><th scope="col">Kind</th><th scope="col">Created</th><th scope="col">Days left</th><th scope="col">Time used</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
      <tbody>${list.map((e) => `<tr data-id="${e.id}">
        <th scope="row" class="code">${e.id}</th>
        <td><span class="tag ${e.surface === 'kiosk' ? 'kiosk' : 'studio'}">${e.surface === 'kiosk' ? 'KIOSK' : 'STUDIO'}</span></td>
        <td>${new Date(e.createdAt).toLocaleString()}</td>
        <td>${daysLeft(e)}</td>
        <td class="times">${timeUsed(e)}</td>
        <td>${e.live ? '<span class="tag live">LIVE</span> ' : ''}${e.published ? '<span class="tag">FILM</span> ' : ''}${e.orientation === 'portrait' ? '<span class="tag">PORTRAIT</span>' : ''}</td>
        <td><div class="acts">
          <button type="button" data-act="days">Set expiry</button>
          ${e.published ? '<button type="button" data-act="films">Delete film</button>' : ''}
          <button type="button" class="danger" data-act="delete">Delete</button>
        </div></td></tr>`).join('')}</tbody></table>`
    : '<p style="padding:16px;color:var(--text-2)">No events.</p>';
}

$('#filter').oninput = render;
$('#refresh').onclick = () => load(true);
$('#more').onclick = () => load(false);

$('#list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('tr').dataset.id;
  const ev = events.find((x) => x.id === id);
  try {
    if (b.dataset.act === 'days') {
      const d = prompt('Delete this event in how many days? (0–30)', String(daysLeft(ev)));
      if (d === null) return;
      Object.assign(ev, (await call(`events/${id}`, { method: 'PATCH', body: { daysLeft: Number(d) } })).event);
    } else if (b.dataset.act === 'films') {
      if (!confirm(`Delete the published film for ${id}? This can't be undone.`)) return;
      await call(`events/${id}/films`, { method: 'DELETE' });
      ev.published = null;
    } else if (b.dataset.act === 'delete') {
      if (!confirm(`Delete ${id} and everything stored for it? This can't be undone.`)) return;
      const r = await call(`events/${id}`, { method: 'DELETE' });
      events = events.filter((x) => x.id !== id);
      toast(`Deleted ${id}${r.removedFilms ? ` and ${r.removedFilms} file(s)` : ''}`);
    }
    render();
    announce('Done');
  } catch (err) {
    toast(err.message, 5000);
  }
});


// ------------------------------------------------------------------ growth ---
// Day-by-day anonymous counts (kept after events expire): charts, period-over-period growth,
// a month table, CSV, a printable investor snapshot, and snapshots frozen for the record.
const METRICS = [
  ['events', 'Events created', 1], ['active_events', 'Events run (studio open, per day)', 1],
  ['cameras', 'Cameras joined', 1], ['mics', 'Microphones joined', 1], ['viewers', 'Viewers', 1],
  ['clips', 'Recordings received', 1], ['footage_sec', 'Footage recorded (hours)', 3600],
  ['live_cut_sec', 'Live cut recorded (hours)', 3600], ['stream_sec', 'Streamed live (hours)', 3600], ['films', 'Films published', 1],
  ['studio_sec', 'Studio, live (hours)', 3600], ['edit_sec', 'Editing (hours)', 3600], ['kiosk_sec', 'Kiosks running (hours)', 3600], ['camera_sec', 'Phones in shows (hours)', 3600],
];
const DAY_MS = 86400000;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
let growthAll = [];
$('#gMetric').innerHTML = METRICS.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('');

async function loadGrowth() {
  const r = await call(`growth?from=${dayStr(Date.now() - 800 * DAY_MS)}&to=${dayStr(Date.now())}`);
  growthAll = r.days.sort((a, b) => a.day.localeCompare(b.day));
  renderGrowth();
  loadSnapshots();
}
const val = (d, k) => (d?.[k] || 0) / (METRICS.find((m) => m[0] === k)?.[2] || 1);
const fmt = (v, k) => ((METRICS.find((m) => m[0] === k)?.[2] || 1) > 1 ? (Math.round(v * 10) / 10).toLocaleString() : Math.round(v).toLocaleString());
// every day in a range, zeros where nothing happened
function fillDays(from, to) {
  const by = new Map(growthAll.map((d) => [d.day, d]));
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) out.push(by.get(dayStr(t)) || { day: dayStr(t) });
  return out;
}
function period() {
  const r = $('#gRange').value, to = dayStr(Date.now());
  const first = growthAll[0]?.day || to;
  const from = r === 'all' ? first : dayStr(Date.now() - (+r - 1) * DAY_MS);
  const n = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  return { from, to, n, prevFrom: dayStr(Date.parse(from) - n * DAY_MS), prevTo: dayStr(Date.parse(from) - DAY_MS) };
}
const sum = (days, k) => days.reduce((s, d) => s + val(d, k), 0);
function summary() {
  const p = period(), now = fillDays(p.from, p.to), prev = fillDays(p.prevFrom, p.prevTo);
  const out = { period: p, totals: {}, previous: {}, change: {}, sinceStart: {} };
  for (const [k] of METRICS) {
    out.totals[k] = sum(now, k);
    out.previous[k] = sum(prev, k);
    out.change[k] = out.previous[k] ? (out.totals[k] - out.previous[k]) / out.previous[k] : null;
    out.sinceStart[k] = sum(growthAll, k);
  }
  out.camerasPerEvent = out.totals.active_events ? out.totals.cameras / out.totals.active_events : null;
  out.days = now;
  return out;
}
function renderGrowth() {
  renderFixes();
  const S = summary(), p = S.period;
  const chg = (c) => (c == null ? '' : `<i class="${c >= 0 ? 'up' : 'down'}">${c >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}%</i>`);
  const tile = (k, label) => `<div class="kpi"><b>${fmt(S.totals[k], k)}${chg(S.change[k])}</b><span>${esc(label)}</span></div>`;
  $('#gKpis').innerHTML = [
    tile('events', 'Events created'), tile('active_events', 'Events run'), tile('cameras', 'Cameras joined'), tile('mics', 'Microphones joined'),
    tile('footage_sec', 'Hours of footage'), tile('live_cut_sec', 'Hours of live cut'), tile('stream_sec', 'Hours streamed'),
    `<div class="kpi"><b>${S.camerasPerEvent == null ? '—' : S.camerasPerEvent.toFixed(1)}</b><span>Cameras per event run</span></div>`,
  ].join('');
  drawGrowthChart($('#gChart'), S.days, $('#gMetric').value);
  const label = METRICS.find((m) => m[0] === $('#gMetric').value)[1];
  $('#gCap').textContent = `${label}: ${p.n > 120 ? 'by week' : 'by day'}, ${p.from} to ${p.to}, with the running total. ▲▼ compare with the ${p.n} days before.`;
  // months
  const months = new Map();
  for (const d of growthAll) {
    const m = d.day.slice(0, 7), acc = months.get(m) || {};
    for (const [k] of METRICS) acc[k] = (acc[k] || 0) + val(d, k);
    months.set(m, acc);
  }
  const cols = ['events', 'active_events', 'cameras', 'mics', 'clips', 'footage_sec', 'live_cut_sec', 'stream_sec', 'films'];
  $('#gTable').innerHTML = `<thead><tr><th scope="col">Month</th>${cols.map((k) => `<th scope="col">${esc(METRICS.find((m) => m[0] === k)[1])}</th>`).join('')}</tr></thead><tbody>${[...months]
    .reverse()
    .map(([m, a]) => `<tr><th scope="row">${m}</th>${cols.map((k) => `<td>${fmt(a[k] || 0, k)}</td>`).join('')}</tr>`)
    .join('') || `<tr><td colspan="${cols.length + 1}">No counts yet: they start the day this version is deployed (or press Fill in earlier days).</td></tr>`}</tbody>`;
}
/** Bars (by day, or by week over 120 days) and the running total as a line. */
function drawGrowthChart(svg, days, k, { w = 900, h = 220, ink = 'currentColor' } = {}) {
  let pts = days.map((d) => ({ day: d.day, v: val(d, k) }));
  if (pts.length > 120) {
    const weeks = [];
    pts.forEach((p, i) => (i % 7 ? (weeks[weeks.length - 1].v += p.v) : weeks.push({ ...p })));
    pts = weeks;
  }
  const max = Math.max(1, ...pts.map((p) => p.v)), cum = [];
  pts.reduce((s, p, i) => (cum[i] = s + p.v), 0);
  const cmax = Math.max(1, cum[cum.length - 1] || 0), pad = 28, bw = (w - pad * 2) / Math.max(1, pts.length);
  const y = (v) => h - 20 - (v / max) * (h - 40), yc = (v) => h - 20 - (v / cmax) * (h - 40);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.innerHTML = `<g fill="#e5534b" opacity=".85">${pts.map((p, i) => `<rect x="${(pad + i * bw + bw * 0.12).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${Math.max(1, bw * 0.76).toFixed(1)}" height="${(h - 20 - y(p.v)).toFixed(1)}"><title>${p.day}: ${fmt(p.v, k)}</title></rect>`).join('')}</g>
    <polyline fill="none" stroke="#3d8bfd" stroke-width="2.2" points="${cum.map((c, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${yc(c).toFixed(1)}`).join(' ')}"/>
    <g fill="${ink}" font-size="11" opacity=".75"><text x="${pad}" y="12">peak ${fmt(max, k)} ${pts.length > 120 ? 'a week' : 'a day'}</text><text x="${w - pad}" y="12" text-anchor="end" fill="#3d8bfd">running total ${fmt(cmax, k)}</text>
    <text x="${pad}" y="${h - 4}">${pts[0]?.day || ''}</text><text x="${w - pad}" y="${h - 4}" text-anchor="end">${pts[pts.length - 1]?.day || ''}</text></g>`;
}
$('#gRange').onchange = renderGrowth;
$('#gMetric').onchange = renderGrowth;

$('#gCsv').onclick = () => {
  const p = period(), rows = [['day', ...METRICS.map((m) => m[0])], ...fillDays(p.from, p.to).map((d) => [d.day, ...METRICS.map(([k]) => d[k] || 0)])];
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })), download: `vuemesh-growth-${p.from}-to-${p.to}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
};

// The investor snapshot: one printable page (Print, then Save as PDF).
function reportHtml(S, label, asOf) {
  const p = S.period;
  const svg = (k) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawGrowthChart(el, S.days, k, { w: 760, h: 200, ink: '#333' });
    return el.outerHTML.replace('<svg', '<svg style="width:100%;height:auto"');
  };
  const pct = (c) => (c == null ? 'new' : `${c >= 0 ? '+' : ''}${Math.round(c * 100)}%`);
  const row = (k, label) => `<tr><th>${label}</th><td>${fmt(S.totals[k], k)}</td><td>${fmt(S.previous[k], k)}</td><td>${pct(S.change[k])}</td><td>${fmt(S.sinceStart[k], k)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)}</title><style>
    body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px auto;max-width:820px;padding:0 20px}
    h1{font-size:26px;margin:0}.sub{color:#555;margin:4px 0 22px}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 18px}
    .k div{border:1px solid #ddd;border-radius:10px;padding:10px}.k b{display:block;font-size:22px}.k span{color:#555;font-size:12px}
    table{width:100%;border-collapse:collapse;margin:8px 0 20px}th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}th:first-child{text-align:left}
    h2{font-size:15px;margin:22px 0 6px}.fine{color:#666;font-size:12px}@media print{.noprint{display:none}body{margin:0 auto}}</style></head><body>
    <p class="noprint"><button onclick="print()">Print or save as PDF</button></p>
    <h1>VUEMesh usage</h1><p class="sub">${esc(label)} · ${p.from} to ${p.to} (${p.n} days) · as of ${esc(asOf)}</p>
    <div class="k">${[['events', 'Events created'], ['cameras', 'Cameras joined'], ['footage_sec', 'Hours of footage'], ['live_cut_sec', 'Hours of live cut']].map(([k, l]) => `<div><b>${fmt(S.totals[k], k)}</b><span>${l} · ${pct(S.change[k])}</span></div>`).join('')}</div>
    <table><thead><tr><th></th><th>This period</th><th>Previous ${p.n} days</th><th>Change</th><th>Since counting began</th></tr></thead><tbody>
    ${METRICS.map(([k, l]) => row(k, l)).join('')}</tbody></table>
    <p>Cameras per event run: <b>${S.camerasPerEvent == null ? '—' : S.camerasPerEvent.toFixed(1)}</b></p>
    <h2>Events created</h2>${svg('events')}<h2>Cameras joined</h2>${svg('cameras')}
    <p class="fine">How these are counted: one anonymous count per day of events created, events run (a studio opened that day), cameras, microphones and viewers joining (each once per event), recordings, hours of footage, live cut and streaming, and films published. No names, phones, places or event details are in these counts. VUEMesh deletes every event and everything in it 30 days after it's created; only these day totals are kept. Footage and live-cut hours come from studios running VUEMesh 0.25 or later.</p>
    </body></html>`;
}
function openReport(S, label, asOf) {
  const w = window.open('', '_blank');
  if (!w) return toast('The browser blocked the window: allow pop-ups for this site and try again', 6000);
  w.document.open();
  w.document.write(reportHtml(S, label, asOf));
  w.document.close();
}
$('#gReport').onclick = () => openReport(summary(), 'Usage snapshot', new Date().toLocaleString());
$('#gSave').onclick = async () => {
  const label = prompt('Name this snapshot (for example "Seed deck, October")', `Snapshot ${dayStr(Date.now())}`);
  if (!label) return;
  const S = summary();
  await call('growth/snapshots', { method: 'POST', body: { label, from: S.period.from, to: S.period.to, summary: { period: S.period, totals: S.totals, previous: S.previous, change: S.change, sinceStart: S.sinceStart, camerasPerEvent: S.camerasPerEvent }, days: S.days } });
  toast('Snapshot saved: it keeps these numbers as they are today');
  loadSnapshots();
};
let snapshots = [];
async function loadSnapshots() {
  snapshots = (await call('growth/snapshots').catch(() => ({ snapshots: [] }))).snapshots;
  $('#gSnaps').innerHTML = snapshots.length
    ? snapshots.map((s, i) => `<li><b>${esc(s.label)}</b><span class="note">${esc(s.from)} to ${esc(s.to)} · saved ${new Date(s.at).toLocaleString()}</span><span class="spacer"></span><button type="button" data-snap="${i}">Open</button></li>`).join('')
    : '<li class="note">None yet. Save snapshot keeps today\'s numbers exactly as they are, for the record.</li>';
}
$('#gSnaps').onclick = (e) => {
  const s = snapshots[+e.target.closest('[data-snap]')?.dataset.snap];
  if (s) openReport({ ...s.summary, days: s.days }, s.label, new Date(s.at).toLocaleString());
};
$('#gBackfill').onclick = async () => {
  const r = await call('growth/backfill', { method: 'POST' });
  toast(r.filled ? `Filled in ${r.filled} earlier day${r.filled > 1 ? 's' : ''} from the events still here` : 'Nothing to fill in: every day with events already has counts');
  loadGrowth();
};


// ------------------------------------------------------------ correct a day --
// A day whose footage is more than its cameras and microphones could record in a day can't be
// right (an old bug once added 83 days of footage in an afternoon): listed, to correct.
function renderFixes() {
  const sel = $('#fxKey');
  if (sel && !sel.options.length) sel.innerHTML = METRICS.map(([k, label, f]) => `<option value="${k}" data-f="${f}">${esc(label)}</option>`).join('');
  const flagged = growthAll.filter((d) => (d.footage_sec || 0) > 86400 * Math.max(1, (d.cameras || 0) + (d.mics || 0)));
  const fixed = growthAll.filter((d) => Object.keys(d).some((k) => k.startsWith('was_')));
  $('#gFlagCount').textContent = flagged.length ? `(${flagged.length} day${flagged.length > 1 ? 's' : ''} look wrong)` : '';
  $('#gFlags').innerHTML = flagged.map((d) => `<li><b>${d.day}</b>: ${Math.round(d.footage_sec / 3600).toLocaleString()} hours of footage from ${(d.cameras || 0) + (d.mics || 0)} camera(s) and microphone(s) can't be right (that day also had ${Math.round((d.live_cut_sec || 0) / 60)} min of live cut).<button type="button" data-fix="${d.day}">Correct it</button></li>`).join('')
    + fixed.map((d) => Object.keys(d).filter((k) => k.startsWith('was_')).map((k) => `<li><b>${d.day}</b>: ${esc(k.slice(4))} corrected to ${(d[k.slice(4)] || 0).toLocaleString()} (was ${d[k].toLocaleString()})</li>`).join('')).join('');
  if (flagged.length) $('#gFixBox').open = true;
}
document.addEventListener('click', (e) => {
  const day = e.target.closest('[data-fix]')?.dataset.fix;
  if (!day) return;
  $('#fxDay').value = day;
  $('#fxKey').value = 'footage_sec';
  $('#fxVal').focus();
  $('#fxSay').textContent = 'Enter the footage that day, in hours (your best estimate: the camera hours, say).';
});
$('#fxGo')?.addEventListener('click', async () => {
  const opt = $('#fxKey').selectedOptions[0], f = +opt.dataset.f || 1, v = Number($('#fxVal').value);
  if (!$('#fxDay').value || !(v >= 0)) return ($('#fxSay').textContent = 'A day and a value, please');
  try {
    const r = await call('growth/fix', { method: 'POST', body: { day: $('#fxDay').value, key: opt.value, value: Math.round(v * f) } });
    $('#fxSay').textContent = `${opt.textContent} on ${r.day}: ${(r.was / f).toLocaleString()} → ${(r.now / f).toLocaleString()} (the original is kept)`;
    $('#fxVal').value = '';
    await loadGrowth();
  } catch (err) {
    $('#fxSay').textContent = err.message;
  }
});

// -------------------------------------------------------------- web traffic --
let trafficAll = [];
async function loadTraffic() {
  const r = await call(`traffic?from=${dayStr(Date.now() - 100 * DAY_MS)}&to=${dayStr(Date.now())}`);
  trafficAll = (r.days || []).sort((a, b) => a.day.localeCompare(b.day));
  renderTraffic();
}
function trafficDays() {
  const n = +$('#tRange').value, by = new Map(trafficAll.map((d) => [d.day, d])), out = [];
  for (let t = Date.now() - (n - 1) * DAY_MS; t <= Date.now(); t += DAY_MS) out.push(by.get(dayStr(t)) || { day: dayStr(t) });
  return out;
}
function tally(days, prefix) {
  const m = new Map();
  for (const d of days) for (const [k, v] of Object.entries(d)) if (k.startsWith(prefix)) m.set(k.slice(prefix.length), (m.get(k.slice(prefix.length)) || 0) + v);
  return [...m].sort((a, b) => b[1] - a[1]);
}
function renderTraffic() {
  const days = trafficDays(), sum = (k) => days.reduce((s, d) => s + (d[k] || 0), 0);
  const visitors = sum('visitors'), views = sum('pageviews');
  const films = tally(days, 'ev:film:'), plays = films.filter(([k]) => k.endsWith(':play')), dones = films.filter(([k]) => k.endsWith(':done'));
  const total = (rows) => rows.reduce((s, [, v]) => s + v, 0);
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  $('#tKpis').innerHTML = [kpi(visitors.toLocaleString(), 'Visitors'), kpi(views.toLocaleString(), 'Page views'),
    kpi(visitors ? (views / visitors).toFixed(1) : '0', 'Pages per visitor'), kpi(total(plays).toLocaleString(), 'Films played'), kpi(total(dones).toLocaleString(), 'Films watched to the end')].join('');
  drawGrowthChart($('#tChart'), days, 'visitors');
  $('#tCap').textContent = `Visitors a day, the last ${days.length} days`;
  const table = (title, rows, label = (k) => k) => {
    const max = rows[0]?.[1] || 1;
    return `<table><caption>${esc(title)}</caption>${rows.slice(0, 10).map(([k, v]) => `<tr><td>${esc(label(k))}<span class="tbar" style="width:${Math.round((v / max) * 100)}%"></span></td><td class="n">${v.toLocaleString()}</td></tr>`).join('') || '<tr><td class="note">None yet</td></tr>'}</table>`;
  };
  const filmName = { wedding: 'First Dance', concert: 'Live Tonight', arena: 'Game Night' };
  const filmRows = [...new Set(plays.map(([k]) => k.split(':')[0]))].map((id) => [`${filmName[id] || id}: ${(dones.find(([k]) => k === `${id}:done`)?.[1] || 0)} to the end`, plays.find(([k]) => k === `${id}:play`)?.[1] || 0]);
  $('#tTables').innerHTML = [
    table('Pages', tally(days, 'page:')),
    table('Where visitors came from', tally(days, 'ref:')),
    table('Landing pages', tally(days, 'land:')),
    table('Campaigns (utm_source)', tally(days, 'utm:')),
    table('Devices', tally(days, 'dev:')),
    table('Browsers', tally(days, 'br:')),
    table('Countries', tally(days, 'ctry:')),
    table('Films (played)', filmRows),
  ].join('');
}
$('#tRange')?.addEventListener('change', renderTraffic);
$('#tCsv')?.addEventListener('click', () => {
  const days = trafficDays();
  const film = (d, end) => Object.entries(d).filter(([k]) => k.startsWith('ev:film:') && k.endsWith(end)).reduce((s, [, v]) => s + v, 0);
  const rows = [['day', 'visitors', 'pageviews', 'film_plays', 'films_watched'], ...days.map((d) => [d.day, d.visitors || 0, d.pageviews || 0, film(d, ':play'), film(d, ':done')])];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }));
  a.download = `vuemesh-traffic-${dayStr(Date.now())}.csv`;
  a.click();
});

// ------------------------------------------------------------------ servers --
// The Lightsail servers (aws/stun): health, the month's data against the allowance, and the relay's
// switch. And how many TURN passwords the site gave out (or didn't, and why), from the traffic counts.
const gb = (bytes) => bytes / 1e9;
function spark(points, fmt) {
  if (!points.length) return '<p class="note">No numbers yet</p>';
  const w = 300, h = 48, max = Math.max(...points.map((p) => p.v), 1e-9);
  const xy = points.map((p, i) => `${((i / Math.max(points.length - 1, 1)) * w).toFixed(1)},${(h - 2 - (p.v / max) * (h - 4)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Peak ${esc(fmt(max))}"><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="${xy.join(' ')}"/></svg>`;
}
function turnCounts(days) {
  const sum = (k) => days.reduce((s, d) => s + (d[`turn:${k}`] || 0), 0);
  return { given: sum('given'), limited: sum('limited'), other: sum('other_site'), off: sum('off') + sum('budget') };
}
async function loadServers() {
  const r = await call('servers');
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  const week = trafficAll.filter((d) => d.day >= dayStr(Date.now() - 6 * DAY_MS));
  const t = turnCounts(week);
  const cards = (r.servers || []).map((s) => {
    const byHour = new Map();
    for (const p of [...s.day.netIn, ...s.day.netOut]) byHour.set(p.t, (byHour.get(p.t) || 0) + p.v);
    const net = [...byHour].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
    const dayGb = gb(net.reduce((a, p) => a + p.v, 0));
    const peakMbps = Math.max(0, ...net.map((p) => (p.v * 8) / 3600 / 1e6));
    const cpu = s.day.cpu.length ? Math.max(...s.day.cpu.map((p) => p.v)) : null;
    const burst = s.day.burst.at(-1)?.v ?? null;
    const failed = s.day.failed.reduce((a, p) => a + p.v, 0);
    const pct = s.month.pct ?? 0;
    return `<article class="server">
      <header><b>${esc(s.name)}</b><span class="tag ${s.state === 'running' ? 'ok' : 'bad'}">${esc(s.state)}</span>
        <span class="note">${esc(s.ip || '')} · ${esc(s.bundle || '')} · ${esc(s.region || '')}</span>
        ${s.relay ? `<span class="tag ${s.relayOpen ? 'ok' : 'bad'}">relay ${s.relayOpen ? 'on' : 'off'}</span>
        <button type="button" data-relay="${s.relayOpen ? 'off' : 'on'}" class="${s.relayOpen ? 'danger' : 'primary'}">${s.relayOpen ? 'Switch the relay off' : 'Switch the relay on'}</button>` : ''}
        ${failed ? `<span class="tag bad">${failed} failed status check${failed > 1 ? 's' : ''} today</span>` : ''}
      </header>
      <div><div class="note">This month's data: ${s.month.usedGb.toFixed(2)} of ${s.month.allowanceGb ?? '?'} GB (${pct}%)${s.relay ? '. New TURN passwords stop at 90%; the relay switches itself off at 100%.' : ''}</div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Data this month"><i class="${pct >= 100 ? 'over' : pct >= 75 ? 'warn' : ''}" style="width:${Math.min(100, pct)}%"></i></div></div>
      <div class="kpis">${kpi(`${dayGb.toFixed(2)} GB`, 'Data, last 24 hours (in and out)')}${kpi(`${peakMbps.toFixed(1)} Mbit/s`, 'Busiest hour, on average')}${kpi(cpu === null ? '—' : `${cpu.toFixed(0)}%`, 'Processor, busiest hour')}${kpi(burst === null ? '—' : `${burst.toFixed(0)}%`, 'Burst capacity left')}</div>
      <figure class="gchart">${spark(net, (v) => `${((v * 8) / 3600 / 1e6).toFixed(1)} Mbit/s`)}<figcaption>Data an hour, the last 24 hours</figcaption></figure>
    </article>`;
  });
  const turn = `<div class="kpis">${kpi(t.given.toLocaleString(), 'TURN passwords given, last 7 days')}${kpi(t.limited.toLocaleString(), `Refused: too many from one address (over ${r.limits?.perAddressHour ?? '?'} an hour) or in all`)}${kpi(t.other.toLocaleString(), 'Refused: asked by another site or a script')}${kpi(t.off.toLocaleString(), 'Refused: relay off')}</div>`;
  $('#servers').innerHTML = (cards.join('') || `<p class="note">${esc(r.note || 'No Lightsail servers in this region.')}</p>`) + turn;
}
$('#sRefresh')?.addEventListener('click', () => loadTraffic().then(loadServers).catch((e) => toast(e.message, 5000)));
$('#servers')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-relay]');
  if (!b) return;
  const open = b.dataset.relay === 'on';
  if (!open && !confirm('Switch the relay off? Devices relayed through it lose their connection now, and no new ones get through until it\'s on again. STUN keeps working.')) return;
  b.disabled = true;
  try {
    await call('relay', { method: 'POST', body: { open } });
    announce(`Relay switched ${open ? 'on' : 'off'}`);
    await loadServers();
  } catch (err) {
    toast(err.message, 5000);
    b.disabled = false;
  }
});
