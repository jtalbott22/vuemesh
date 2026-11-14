// Admin: see and manage everything VUEMesh keeps in the cloud, without the AWS console.
// One period (7D … All) scopes every number and chart on the page; each is compared with the
// period just before it.
import { $, api, esc, toast, themeButton, announce } from '/js/vm.js';
import { chart, renderSvg, sparkline, compact, bytes, dayLabel, dayFull, hourLabel } from '/js/charts.js';

themeButton($('#themeBtn'));
let adminKey = sessionStorage.getItem('vm_admin') || '';
const call = (path, opts = {}) => api('admin/' + path, { ...opts, headers: { 'x-admin-key': adminKey, ...(opts.headers || {}) } });
const DAY_MS = 86400000;
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

async function signIn(key) {
  adminKey = key;
  try {
    await call('whoami');
    sessionStorage.setItem('vm_admin', key);
    $('#login').hidden = true;
    for (const id of ['#main', '#signOut', '#refreshAll', '#secnav']) $(id).hidden = false;
    await refreshAll();
  } catch (e) {
    sessionStorage.removeItem('vm_admin');
    adminKey = '';
    toast(e.message, 5000);
  }
}
async function refreshAll() {
  $('#updated').textContent = 'Updating…';
  await Promise.all([
    loadEvents().catch((e) => toast(`Events: ${e.message}`, 5000)),
    loadGrowth().catch((e) => toast(`Growth: ${e.message}`, 5000)),
    loadTraffic().catch((e) => toast(`Web traffic: ${e.message}`, 5000)),
  ]);
  renderTicker();
  await loadServers().catch((e) => ($('#servers').innerHTML = `<p class="note">Couldn't read the servers: ${esc(e.message)}</p>`));
  $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  signIn($('#key').value.trim());
});
$('#signOut').onclick = () => {
  sessionStorage.removeItem('vm_admin');
  location.reload();
};
$('#refreshAll').onclick = () => refreshAll();
// (signed in already in this tab: straight in, once the rest of this file has set up)
if (adminKey) queueMicrotask(() => signIn(adminKey));

// ---- the period, for everything ----------------------------------------------------
let range = store.get('vm_admin_range') || '30';
function pressSeg(group, attr, value) {
  for (const b of $(group).querySelectorAll(`[data-${attr}]`)) b.setAttribute('aria-pressed', String(b.dataset[attr] === value));
}
pressSeg('#range', 'range', range);
$('#range').addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  range = b.dataset.range;
  store.set('vm_admin_range', range);
  pressSeg('#range', 'range', range);
  renderGrowth();
  renderTraffic();
  renderTicker();
  renderServers();
});
/** The period's days, and the same number just before, from `first` (the earliest day counted) for All */
function periodOf(first) {
  const to = dayStr(Date.now());
  const from = range === 'all' ? (first && first < to ? first : to) : dayStr(Date.now() - (+range - 1) * DAY_MS);
  const n = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  return { from, to, n, prevFrom: dayStr(Date.parse(from) - n * DAY_MS), prevTo: dayStr(Date.parse(from) - DAY_MS) };
}
function fillDays(rows, from, to) {
  const by = new Map(rows.map((d) => [d.day, d]));
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY_MS) out.push(by.get(dayStr(t)) || { day: dayStr(t) });
  return out;
}
/** Over 120 days, by week: whole weeks counted back from today (so the last isn't a partial one
 * that looks like a drop), each at its first day; a partial week at the start is left off */
function bucket(days, value) {
  const pts = days.map((d) => ({ t: Date.parse(d.day), v: value(d) }));
  if (pts.length <= 120) return { pts, unit: 'day' };
  const weeks = [];
  for (let end = pts.length; end - 7 >= 0; end -= 7) {
    const w = pts.slice(end - 7, end);
    weeks.unshift({ t: w[0].t, v: w.reduce((a, p) => a + p.v, 0) });
  }
  return { pts: weeks, unit: 'week' };
}
const movingAvg = (vals, k) => vals.map((_, i) => { const w = vals.slice(Math.max(0, i - k + 1), i + 1); return w.reduce((a, b) => a + b, 0) / w.length; });
/** ▲ 12% (good when up), ▼ 8%, or "new" when there was nothing before */
function delta(now, before) {
  if (!before && !now) return '<span class="delta flat">—</span>';
  if (!before) return '<span class="delta up" title="Nothing in the period before">new</span>';
  const c = (now - before) / before, r = Math.round(Math.abs(c) * 100);
  if (!r) return '<span class="delta flat">0%</span>';
  return `<span class="delta ${c > 0 ? 'up' : 'down'}"><span aria-hidden="true">${c > 0 ? '▲' : '▼'}</span><span class="sr">${c > 0 ? 'up' : 'down'}</span> ${r.toLocaleString()}%</span>`;
}
const rangeName = (p) => (range === 'all' ? `since ${dayLabel(p.from, true)}` : `${p.n} days`);

// ---------------------------------------------------------------- stat tiles ---
// The headline numbers for the period, each against the period before, with its trend.
function renderTicker() {
  if (!growthAll.length && !trafficAll.length) return;
  const g = summary(), p = g.period;
  const tp = periodOf(trafficAll[0]?.day), tNow = fillDays(trafficAll, tp.from, tp.to), tPrev = fillDays(trafficAll, tp.prevFrom, tp.prevTo);
  const tsum = (days, k) => days.reduce((s, d) => s + (d[k] || 0), 0);
  const tile = (label, value, now, before, trend, fmt = compact) => `<div class="stat"><span class="lbl">${esc(label)}</span>
    <div class="val"><b>${esc(fmt(value))}</b>${delta(now, before)}</div><span class="vs">vs the ${esc(range === 'all' ? 'same length before' : `previous ${p.n} days`)}</span>${sparkline(trend)}</div>`;
  const trendOf = (days, value) => bucket(days, value).pts.map((x) => x.v);
  const gt = (k) => tile(METRIC[k].label.replace(/ \(.*\)$/, ''), g.totals[k], g.totals[k], g.previous[k], trendOf(g.days, (d) => val(d, k)), (v) => fmt(v, k));
  $('#gKpis').innerHTML = [
    gt('events'), gt('active_events'), gt('cameras'), gt('footage_sec'), gt('calls'), gt('call_people'),
    tile('Visitors', tsum(tNow, 'visitors'), tsum(tNow, 'visitors'), tsum(tPrev, 'visitors'), trendOf(tNow, (d) => d.visitors || 0)),
    tile('Page views', tsum(tNow, 'pageviews'), tsum(tNow, 'pageviews'), tsum(tPrev, 'pageviews'), trendOf(tNow, (d) => d.pageviews || 0)),
  ].join('');
  const long = (d) => new Date(Date.parse(d)).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', ...(p.from.slice(0, 4) !== p.to.slice(0, 4) ? { year: 'numeric' } : {}) });
  $('#rangeNote').textContent = `${long(p.from)} – ${long(p.to)}${range === 'all' ? '' : `, against the ${p.n} days before`}`;
}

// --------------------------------------------------------------------- events ---
// All of them are read (they delete themselves after 30 days, so there are never many), then
// sorted, filtered and shown a page at a time here.
let events = [], page = 0, sortBy = { key: 'createdAt', dir: -1 }, kind = 'all';
async function loadEvents() {
  const [st, all] = await Promise.all([call('stats'), (async () => {
    const out = [];
    let cursor = null;
    for (let i = 0; i < 100; i++) {
      const r = await call(`events?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      out.push(...r.events);
      if (!(cursor = r.next)) break;
    }
    return out;
  })()]);
  events = all;
  const chip = (label, v, cls = '') => `<span class="chip ${cls}"><b>${esc(v)}</b>${esc(label)}</span>`;
  $('#tiles').innerHTML = [chip('live now', st.live, st.live ? 'live' : ''), chip('events stored', st.events), chip('published', st.published), chip(`film files · ${bytes(st.filmBytes || 0)}`, st.films)].join('');
  renderEvents();
}
const daysLeft = (ev) => (ev.expiresAt ? Math.max(0, Math.round((ev.expiresAt - Date.now()) / DAY_MS)) : null);
const usedSec = (e) => Object.values(e.time || {}).reduce((a, b) => a + (b || 0), 0);
// time used on each part of VUEMesh for this event: the studio live, editing, a kiosk, the phones
const hm = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : s ? `${s} s` : '');
function timeUsed(e) {
  const t = e.time || {};
  const parts = [['Studio', t.studio], ['Edit', t.edit], ['Kiosk', t.kiosk], ['Cameras', t.cameras]].filter(([, s]) => s > 0);
  return parts.length ? parts.map(([k, s]) => `<span title="${k}">${k} ${hm(s)}</span>`).join('<br>') : '<span class="note">—</span>';
}
const SORTS = { id: (e) => e.id, createdAt: (e) => e.createdAt || 0, left: (e) => e.expiresAt || 0, used: usedSec };
function visibleEvents() {
  const q = $('#filter').value.trim().toUpperCase();
  // (no names: a show's name stays on its devices, and the server never has it)
  const list = events.filter((e) => (!q || e.id.includes(q))
    && (kind === 'all' || (kind === 'live' && e.live) || (kind === 'kiosk' && e.surface === 'kiosk') || (kind === 'call' && e.kind === 'call') || (kind === 'studio' && e.surface !== 'kiosk' && e.kind !== 'call')));
  const f = SORTS[sortBy.key];
  return list.sort((a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0) * sortBy.dir);
}
function renderEvents() {
  const per = +$('#ePer').value, list = visibleEvents(), pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(page, pages - 1);
  const rows = list.slice(page * per, page * per + per);
  const th = (key, label) => `<th scope="col"${sortBy.key === key ? ` aria-sort="${sortBy.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="sort" data-sort="${key}">${label}</button></th>`;
  $('#eCount').textContent = `${events.length.toLocaleString()} stored`;
  $('#list').innerHTML = rows.length
    ? `<table><thead><tr>${th('id', 'Code')}<th scope="col">Kind</th>${th('createdAt', 'Created')}${th('left', 'Days left')}${th('used', 'Time used')}<th scope="col">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
      <tbody>${rows.map((e) => {
        const left = daysLeft(e), kindTag = e.kind === 'call' ? '<span class="tag">CALL</span>' : `<span class="tag ${e.surface === 'kiosk' ? 'kiosk' : 'studio'}">${e.surface === 'kiosk' ? 'KIOSK' : 'STUDIO'}</span>`;
        return `<tr data-id="${esc(e.id)}">
        <th scope="row" class="code">${esc(e.id)}</th>
        <td>${kindTag}</td>
        <td>${new Date(e.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
        <td>${left == null ? '—' : `<span class="left${left <= 3 ? ' soon' : ''}">${left}<i style="--w:${Math.min(100, (left / 30) * 100).toFixed(0)}%"></i></span>`}</td>
        <td class="times">${timeUsed(e)}</td>
        <td>${e.live ? '<span class="tag live">LIVE</span> ' : ''}${e.published ? '<span class="tag">FILM</span> ' : ''}${e.orientation === 'portrait' ? '<span class="tag">PORTRAIT</span>' : ''}</td>
        <td><div class="acts">
          <button type="button" data-act="days">Set expiry</button>
          ${e.published ? '<button type="button" data-act="films">Delete film</button>' : ''}
          <button type="button" class="danger" data-act="delete">Delete</button>
        </div></td></tr>`;
      }).join('')}</tbody></table>`
    : `<p class="note" style="padding:12px 0">${events.length ? 'No events match.' : 'No events.'}</p>`;
  $('#eShowing').textContent = list.length ? `${(page * per + 1).toLocaleString()}–${(page * per + rows.length).toLocaleString()} of ${list.length.toLocaleString()}${list.length < events.length ? ` (of ${events.length.toLocaleString()})` : ''}` : '';
  // pages: first, last, and two either side of this one
  const nums = [...new Set([0, pages - 1, ...[-2, -1, 0, 1, 2].map((d) => page + d)])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const btn = (n, label, extra = '') => `<button type="button" data-page="${n}" ${extra}>${label}</button>`;
  $('#pager').innerHTML = pages < 2 ? '' : [
    btn(page - 1, '‹ Prev', `aria-label="Previous page"${page === 0 ? ' disabled' : ''}`),
    ...nums.flatMap((n, i) => [...(i && n - nums[i - 1] > 1 ? ['<span class="gap" aria-hidden="true">…</span>'] : []), btn(n, n + 1, `aria-label="Page ${n + 1}"${n === page ? ' aria-current="page"' : ''}`)]),
    btn(page + 1, 'Next ›', `aria-label="Next page"${page >= pages - 1 ? ' disabled' : ''}`),
  ].join('');
}
$('#filter').oninput = () => { page = 0; renderEvents(); };
$('#ePer').onchange = () => { page = 0; renderEvents(); };
$('#refresh').onclick = () => loadEvents().catch((e) => toast(e.message, 5000));
$('#eKind').addEventListener('click', (e) => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  kind = b.dataset.kind;
  pressSeg('#eKind', 'kind', kind);
  page = 0;
  renderEvents();
});
$('#pager').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (!b || b.disabled) return;
  page = +b.dataset.page;
  renderEvents();
  $('#eventsCard').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  $('#pager [aria-current="page"]')?.focus();
});
$('#list').addEventListener('click', async (e) => {
  const s = e.target.closest('[data-sort]');
  if (s) {
    const key = s.dataset.sort;
    sortBy = sortBy.key === key ? { key, dir: -sortBy.dir } : { key, dir: key === 'id' ? 1 : -1 };
    page = 0;
    renderEvents();
    $(`#list [data-sort="${key}"]`)?.focus();
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('tr').dataset.id;
  const ev = events.find((x) => x.id === id);
  try {
    if (b.dataset.act === 'days') {
      const d = prompt('Delete this event in how many days? (0–30)', String(daysLeft(ev) ?? ''));
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
    renderEvents();
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
  ['calls', 'Calls started', 1], ['call_people', 'People in calls (each once a call)', 1], ['call_joins', 'Call connections (reconnects too)', 1],
];
const METRIC = Object.fromEntries(METRICS.map(([k, label, f]) => [k, { label, f }]));
let growthAll = [], gMode = 'daily';
$('#gMetric').innerHTML = METRICS.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('');
$('#gMetric').value = store.get('vm_admin_metric') && METRIC[store.get('vm_admin_metric')] ? store.get('vm_admin_metric') : 'events';

async function loadGrowth() {
  const r = await call(`growth?from=${dayStr(Date.now() - 800 * DAY_MS)}&to=${dayStr(Date.now())}`);
  growthAll = r.days.sort((a, b) => a.day.localeCompare(b.day));
  renderGrowth();
  loadSnapshots();
}
const val = (d, k) => (d?.[k] || 0) / (METRIC[k]?.f || 1);
const fmt = (v, k) => ((METRIC[k]?.f || 1) > 1 ? (Math.round(v * 10) / 10).toLocaleString() : compact(Math.round(v)));
const period = () => periodOf(growthAll[0]?.day);
const sum = (days, k) => days.reduce((s, d) => s + val(d, k), 0);
function summary() {
  const p = period(), now = fillDays(growthAll, p.from, p.to), prev = fillDays(growthAll, p.prevFrom, p.prevTo);
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
/** The chart's series for one count: columns by day (or week) with their moving average, or the running total */
function growthSeries(days, k, mode, colors = { a: 'var(--series-1)', b: 'var(--series-2)' }) {
  const { pts, unit } = bucket(days, (d) => val(d, k));
  const x = pts.map((p) => p.t), vals = pts.map((p) => p.v), name = METRIC[k].label.replace(/ \(.*\)$/, '');
  if (mode === 'total') {
    let run = 0;
    return { x, unit, series: [{ name: `${name}, running total`, kind: 'area', color: colors.a, values: vals.map((v) => (run += v)) }] };
  }
  return { x, unit, series: [
    { name: `${name} a ${unit}`, kind: 'column', color: colors.a, values: vals },
    { name: unit === 'day' ? '7-day average' : '4-week average', kind: 'line', color: colors.b, values: movingAvg(vals, unit === 'day' ? 7 : 4) },
  ] };
}
let gChart = null;
function renderGrowth() {
  if (!growthAll.length && !gChart) { /* (drawn empty below) */ }
  renderFixes();
  const S = summary(), p = S.period, k = $('#gMetric').value;
  const best = S.days.reduce((b, d) => (val(d, k) > val(b, k) ? d : b), S.days[0] || {});
  $('#gHero').innerHTML = `<div class="main"><span class="lbl">${esc(METRIC[k].label)} · ${esc(rangeName(p))}</span>
      <b>${esc(fmt(S.totals[k], k))} ${delta(S.totals[k], S.previous[k])}</b></div>
    <div class="side">
      <div><span>Previous ${esc(range === 'all' ? 'period' : `${p.n} days`)}</span><b>${esc(fmt(S.previous[k], k))}</b></div>
      <div><span>Daily average</span><b>${esc(fmt(S.totals[k] / p.n, k))}</b></div>
      <div><span>Best day</span><b>${val(best, k) ? `${esc(fmt(val(best, k), k))} <span class="note">${esc(dayLabel(best.day))}</span>` : '—'}</b></div>
      <div><span>Since counting began</span><b>${esc(fmt(S.sinceStart[k], k))}</b></div>
    </div>`;
  const g = growthSeries(S.days, k, gMode);
  const o = { ...g, height: 280, format: (v) => fmt(v, k), xLabel: (t) => dayLabel(t, p.n > 400), tipLabel: (t) => (g.unit === 'week' ? `Week of ${dayFull(t)}` : dayFull(t)), label: `${METRIC[k].label}, ${p.from} to ${p.to}` };
  if (gChart) gChart.update(o); else gChart = chart($('#gChart'), o);
  // months
  const months = new Map();
  for (const d of growthAll) {
    const m = d.day.slice(0, 7), acc = months.get(m) || {};
    for (const [key] of METRICS) acc[key] = (acc[key] || 0) + val(d, key);
    months.set(m, acc);
  }
  const cols = ['events', 'active_events', 'cameras', 'mics', 'clips', 'footage_sec', 'live_cut_sec', 'stream_sec', 'films', 'calls', 'call_people'];
  $('#gTable').innerHTML = `<thead><tr><th scope="col">Month</th>${cols.map((c) => `<th scope="col">${esc(METRIC[c].label)}</th>`).join('')}</tr></thead><tbody>${[...months]
    .reverse()
    .map(([m, a]) => `<tr><th scope="row">${new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' })}</th>${cols.map((c) => `<td>${fmt(a[c] || 0, c)}</td>`).join('')}</tr>`)
    .join('') || `<tr><td colspan="${cols.length + 1}">No counts yet: they start the day this version is deployed (or press Fill in earlier days).</td></tr>`}</tbody>`;
}
$('#gMetric').onchange = () => { store.set('vm_admin_metric', $('#gMetric').value); renderGrowth(); };
$('#gMode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  gMode = b.dataset.mode;
  pressSeg('#gMode', 'mode', gMode);
  renderGrowth();
});

$('#gCsv').onclick = () => {
  const p = period(), rows = [['day', ...METRICS.map((m) => m[0])], ...fillDays(growthAll, p.from, p.to).map((d) => [d.day, ...METRICS.map(([k]) => d[k] || 0)])];
  download(rows, `vuemesh-growth-${p.from}-to-${p.to}.csv`);
};
function download(rows, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

// The investor snapshot: one printable page (Print, then Save as PDF), its charts drawn in print colours.
const PRINT_INK = { grid: '#e6e6e3', axis: '#c3c2b7', text: '#111111', muted: '#6b6a66', surface: '#ffffff' };
function reportHtml(S, label, asOf) {
  const p = S.period;
  const svg = (k) => {
    const g = growthSeries(S.days, k, 'daily', { a: '#2a78d6', b: '#eb6834' });
    const key = g.series.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;color:#555;font-size:12px"><i style="display:inline-block;width:${s.kind === 'column' ? 10 : 14}px;height:${s.kind === 'column' ? 10 : 2}px;border-radius:2px;background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    return `<div>${key}</div>${renderSvg({ ...g, height: 220, ink: PRINT_INK, format: (v) => fmt(v, k), xLabel: (t) => dayLabel(t, p.n > 400) }, 760).svg.replace('<svg', '<svg style="width:100%;height:auto"')}`;
  };
  const pct = (c) => (c == null ? 'new' : `${c >= 0 ? '+' : ''}${Math.round(c * 100)}%`);
  const row = (k, l) => `<tr><th>${l}</th><td>${fmt(S.totals[k], k)}</td><td>${fmt(S.previous[k], k)}</td><td>${pct(S.change[k])}</td><td>${fmt(S.sinceStart[k], k)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(label)}</title><style>
    body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px auto;max-width:820px;padding:0 20px}
    h1{font-size:26px;margin:0}.sub{color:#555;margin:4px 0 22px}.k{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:0 0 18px}
    .k div{border:1px solid #ddd;border-radius:10px;padding:10px}.k b{display:block;font-size:22px}.k span{color:#555;font-size:12px}
    table{width:100%;border-collapse:collapse;margin:8px 0 20px;font-variant-numeric:tabular-nums}th,td{padding:6px 8px;border-bottom:1px solid #eee;text-align:right}th:first-child{text-align:left}
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
  await loadGrowth();
  renderTicker();
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
let trafficAll = [], tChart = null;
async function loadTraffic() {
  const r = await call(`traffic?from=${dayStr(Date.now() - 800 * DAY_MS)}&to=${dayStr(Date.now())}`);
  trafficAll = (r.days || []).sort((a, b) => a.day.localeCompare(b.day));
  renderTraffic();
}
const trafficPeriod = () => periodOf(trafficAll[0]?.day);
function tally(days, prefix) {
  const m = new Map();
  for (const d of days) for (const [k, v] of Object.entries(d)) if (k.startsWith(prefix)) m.set(k.slice(prefix.length), (m.get(k.slice(prefix.length)) || 0) + v);
  return [...m].sort((a, b) => b[1] - a[1]);
}
function renderTraffic() {
  const p = trafficPeriod(), days = fillDays(trafficAll, p.from, p.to), prev = fillDays(trafficAll, p.prevFrom, p.prevTo);
  const sumOf = (ds, k) => ds.reduce((s, d) => s + (d[k] || 0), 0);
  const visitors = sumOf(days, 'visitors'), views = sumOf(days, 'pageviews');
  const films = tally(days, 'ev:film:'), plays = films.filter(([k]) => k.endsWith(':play')), dones = films.filter(([k]) => k.endsWith(':done'));
  const total = (rows) => rows.reduce((s, [, v]) => s + v, 0);
  $('#tHero').innerHTML = `<div class="main"><span class="lbl">Visitors · ${esc(rangeName(p))}</span><b>${esc(compact(visitors))} ${delta(visitors, sumOf(prev, 'visitors'))}</b></div>
    <div class="side">
      <div><span>Page views</span><b>${esc(compact(views))} ${delta(views, sumOf(prev, 'pageviews'))}</b></div>
      <div><span>Pages per visitor</span><b>${visitors ? (views / visitors).toFixed(1) : '—'}</b></div>
      <div><span>Films played</span><b>${esc(compact(total(plays)))}</b></div>
      <div><span>Watched to the end</span><b>${esc(compact(total(dones)))}</b></div>
    </div>`;
  const b1 = bucket(days, (d) => d.visitors || 0), b2 = bucket(days, (d) => d.pageviews || 0);
  const o = {
    x: b1.pts.map((x) => x.t), height: 260, label: `Visitors and page views, ${p.from} to ${p.to}`,
    xLabel: (t) => dayLabel(t, p.n > 400), tipLabel: (t) => (b1.unit === 'week' ? `Week of ${dayFull(t)}` : dayFull(t)),
    series: [
      { name: `Visitors a ${b1.unit}`, kind: 'area', color: 'var(--series-1)', values: b1.pts.map((x) => x.v) },
      { name: `Page views a ${b2.unit}`, kind: 'line', color: 'var(--series-2)', values: b2.pts.map((x) => x.v) },
    ],
  };
  if (tChart) tChart.update(o); else tChart = chart($('#tChart'), o);
  const list = (title, rows, label = (k) => k) => {
    const max = rows[0]?.[1] || 1;
    return `<div class="tlist"><h3>${esc(title)}</h3><ol>${rows.slice(0, 8).map(([k, v]) => `<li><span title="${esc(label(k))}">${esc(label(k))}</span><b>${v.toLocaleString()}</b><i style="--w:${Math.max(2, Math.round((v / max) * 100))}%"></i></li>`).join('') || '<li class="note">None yet</li>'}</ol></div>`;
  };
  const filmName = { wedding: 'First Dance', concert: 'Live Tonight', arena: 'Game Night' };
  const filmRows = [...new Set(plays.map(([k]) => k.split(':')[0]))].map((id) => [`${filmName[id] || id}: ${(dones.find(([k]) => k === `${id}:done`)?.[1] || 0)} to the end`, plays.find(([k]) => k === `${id}:play`)?.[1] || 0]);
  $('#tTables').innerHTML = [
    list('Pages', tally(days, 'page:')),
    list('Where visitors came from', tally(days, 'ref:')),
    list('Landing pages', tally(days, 'land:')),
    list('Campaigns (utm_source)', tally(days, 'utm:')),
    list('Devices', tally(days, 'dev:')),
    list('Browsers', tally(days, 'br:')),
    list('Countries', tally(days, 'ctry:')),
    list('Films (played)', filmRows),
  ].join('');
}
$('#tCsv')?.addEventListener('click', () => {
  const p = trafficPeriod(), days = fillDays(trafficAll, p.from, p.to);
  const film = (d, end) => Object.entries(d).filter(([k]) => k.startsWith('ev:film:') && k.endsWith(end)).reduce((s, [, v]) => s + v, 0);
  download([['day', 'visitors', 'pageviews', 'film_plays', 'films_watched'], ...days.map((d) => [d.day, d.visitors || 0, d.pageviews || 0, film(d, ':play'), film(d, ':done')])], `vuemesh-traffic-${p.from}-to-${p.to}.csv`);
});

// ------------------------------------------------------------------ servers --
// The Lightsail servers (aws/stun): health, the month's data against the allowance, and the relay's
// switch. And how many TURN passwords the site gave out (or didn't, and why), from the traffic counts.
const gb = (bytes) => bytes / 1e9;
function turnCounts(days) {
  const sum = (k) => days.reduce((s, d) => s + (d[`turn:${k}`] || 0), 0);
  return { given: sum('given'), limited: sum('limited'), other: sum('other_site'), off: sum('off') + sum('budget') };
}
// What the relay server reports every minute (counts only), and how browsers' connections went:
// on the same network, direct, or through the relay (each end of a connection counts its own)
function relayCounts(days) {
  const sum = (k) => days.reduce((s, d) => s + (d[`relay:${k}`] || 0), 0);
  const route = { lan: 0, direct: 0, relay: 0 }, call = { lan: 0, direct: 0, relay: 0 };
  for (const d of days) {
    for (const [k, v] of Object.entries(d)) {
      const m = /^ev:route:([a-z]+):(lan|direct|relay)$/.exec(k);
      if (!m) continue;
      route[m[2]] += v;
      if (m[1] === 'call') call[m[2]] += v;
    }
  }
  return {
    started: sum('started'), hours: sum('relay_min') / 60, bytes: sum('bytes_in') + sum('bytes_out'), peak: Math.max(0, ...days.map((d) => d['relay:peak'] || 0)),
    badPassword: sum('bad_password'), forbidden: sum('forbidden'), tcp: sum('tcp'), flood: sum('flood'), self: sum('self'), full: sum('full'), errors: sum('errors'), route, call,
  };
}
/** The last 24 hours, hour by hour, from today's and yesterday's counts (relayh:HH:*) */
function relayHours(days, field, now = Date.now()) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  return Array.from({ length: 24 }, (_, i) => {
    const t = now - (23 - i) * 3600000, iso = new Date(t).toISOString();
    return { t, v: byDay.get(iso.slice(0, 10))?.[`relayh:${iso.slice(11, 13)}:${field}`] || 0 };
  });
}
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} hours ago`; };
const until = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function relayPanel(r, week, span) {
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  const c = relayCounts(week), routes = c.route.lan + c.route.direct + c.route.relay;
  const share = routes ? `${((c.route.relay / routes) * 100).toFixed(1)}%` : '—';
  const calls = c.call.lan + c.call.direct + c.call.relay, callShare = calls ? `${((c.call.relay / calls) * 100).toFixed(1)}%` : '—';
  const rep = r.relayReport;
  const fresh = rep && Date.now() - rep.at < 5 * 60000;
  const report = rep
    ? `<span class="tag ${fresh ? 'ok' : 'bad'}">reported ${esc(ago(rep.at))}</span> <span class="note">${fresh ? `${rep.open} relay${rep.open === 1 ? '' : 's'} open now` : "The server hasn't reported for a while: its counts here stop until it does."}</span>`
    : `<span class="note">No report from the relay server yet. A server made before 0.77 doesn't send them: bump the number in InstanceName in aws/stun/template.yaml and deploy aws/stun.</span>`;
  const log = r.relayLog
    ? `<p><span class="tag bad">troubleshooting log on</span> until ${esc(until(r.relayLog.until))}. <button type="button" data-relaylog="0" class="primary">Switch it off now</button></p>`
    : `<p><span class="tag ok">troubleshooting log off</span> <button type="button" data-relaylog="1">Log for 1 hour</button> <button type="button" data-relaylog="24">Log for 24 hours</button></p>`;
  return `<article class="server"><header><b>Relay · ${esc(span)}</b>${report}</header>
    <div class="kpis">${kpi(share, `Of ${routes.toLocaleString()} connections, through the relay (${c.route.lan.toLocaleString()} on one network, ${c.route.direct.toLocaleString()} direct)`)}${kpi(callShare, `Of ${calls.toLocaleString()} call connections, through the relay (${c.call.direct.toLocaleString()} direct, ${c.call.lan.toLocaleString()} on one network)`)}${kpi(c.started.toLocaleString(), 'Relays started')}${kpi(c.peak.toLocaleString(), 'Most open at once')}${kpi(c.hours.toFixed(1), 'Relay hours')}${kpi(`${gb(c.bytes).toFixed(2)} GB`, 'Through the relay ports')}</div>
    <p class="sub2">Most relays open at once, hour by hour, the last 24 hours</p><div data-chart="relay"></div>
    <div class="kpis">${kpi(c.badPassword.toLocaleString(), 'Turned away: wrong or expired password')}${kpi(c.forbidden.toLocaleString(), 'Turned away: asked to reach a private address')}${kpi(c.tcp.toLocaleString(), 'Turned away: asked for a TCP relay')}${kpi(c.flood.toLocaleString(), 'Flood packets dropped')}${kpi(c.self.toLocaleString(), "Stopped reaching this server's own ports")}${kpi((c.full + c.errors).toLocaleString(), 'Relay full, or other errors')}</div>
    <div class="note">Counts only: the server counts its own log and forgets it. No addresses come here.</div>
    <div><b>Troubleshooting log</b>${log}<div class="note">While it's on, the relay writes its own log, with the addresses of the devices using it, to the server's memory only (never its disk, never sent here), for a day at most, then deletes it. Switching it on or off takes up to a minute to reach the server. Read it in the Lightsail console's browser terminal: <code>sudo tail -f /run/vuemesh/turn.log</code></div></div>
  </article>`;
}
let lastServers = null;
async function loadServers() {
  lastServers = await call('servers');
  renderServers();
}
function renderServers() {
  const r = lastServers;
  if (!r) return;
  const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${esc(label)}</span></div>`;
  const tp = trafficPeriod(), week = trafficAll.filter((d) => d.day >= tp.from && d.day <= tp.to), span = rangeName(tp);
  const t = turnCounts(week);
  const nets = [];
  const cards = (r.servers || []).map((s, si) => {
    const byHour = new Map();
    for (const p of [...s.day.netIn, ...s.day.netOut]) byHour.set(p.t, (byHour.get(p.t) || 0) + p.v);
    const net = [...byHour].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }));
    nets[si] = net;
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
      <p class="sub2">Data an hour, the last 24 hours (in and out)</p><div data-chart="net-${si}"></div>
    </article>`;
  });
  const turn = `<article class="server"><header><b>TURN passwords · ${esc(span)}</b></header><div class="kpis">${kpi(t.given.toLocaleString(), 'Given')}${kpi(t.limited.toLocaleString(), `Refused: too many from one address (over ${r.limits?.perAddressHour ?? '?'} an hour) or in all`)}${kpi(t.other.toLocaleString(), 'Refused: asked by another site or a script')}${kpi(t.off.toLocaleString(), 'Refused: relay off')}</div></article>`;
  const relay = (r.servers || []).some((s) => s.relay) ? relayPanel(r, week, span) : '';
  $('#servers').innerHTML = (cards.join('') || `<p class="note">${esc(r.note || 'No Lightsail servers in this region.')}</p>`) + turn + relay;
  // the charts, hour by hour
  const hourly = (values, x, name, format) => ({ x, height: 150, format, xLabel: hourLabel, tipLabel: (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }), endLabels: false, series: [{ name, kind: 'column', color: 'var(--series-1)', values }] });
  nets.forEach((net, si) => {
    const el = $(`#servers [data-chart="net-${si}"]`);
    if (el) chart(el, hourly(net.map((p) => p.v), net.map((p) => p.t), 'Data', (v) => bytes(v)));
  });
  const relayEl = $('#servers [data-chart="relay"]');
  if (relayEl) {
    const h = relayHours(trafficAll, 'peak');
    chart(relayEl, hourly(h.map((p) => p.v), h.map((p) => p.t), 'Most open at once', compact));
  }
}
$('#sRefresh')?.addEventListener('click', () => loadTraffic().then(loadServers).catch((e) => toast(e.message, 5000)));
$('#servers')?.addEventListener('click', async (e) => {
  const lg = e.target.closest('[data-relaylog]');
  if (lg) {
    const hours = Number(lg.dataset.relaylog);
    if (hours && !confirm(`Log the relay for ${hours} hour${hours > 1 ? 's' : ''}? Its log has the addresses of the devices it relays. It stays in the server's memory, and is deleted when the time's up.`)) return;
    lg.disabled = true;
    try {
      await call('relay-log', { method: 'POST', body: { hours } });
      announce(hours ? `Relay log on for ${hours} hour${hours > 1 ? 's' : ''}` : 'Relay log off');
      await loadServers();
    } catch (err) {
      toast(err.message, 5000);
      lg.disabled = false;
    }
    return;
  }
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
