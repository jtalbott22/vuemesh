// Second-screen monitor for the host. Reads the studio's BroadcastChannel in this
// same browser: network, device and transfer health for every phone.
import { $, esc, themeButton, eventIdFromUrl } from '/js/vm.js';
import * as idb from '/js/idb.js';
import { joinChunks, sessionFile } from '/js/showlog.js';

themeButton($('#themeBtn'));
const eventId = eventIdFromUrl();
$('#code').textContent = eventId;
const history = new Map(); // peer → [{kbps, rtt}]
let lastAt = 0;
let lastLogAt = 0, lastReceived = '', lastSeenSent = 0;
const fmtDur = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
document.addEventListener('visibilitychange', () => !document.hidden && ch.postMessage({ type: 'seen' }));
// Preview and download a received recording, straight from this browser's storage.
async function clipBlob(id) {
  const all = await idb.list('clips', eventId).catch(() => []);
  return all.find((r) => r.id === id) || null;
}
document.addEventListener('click', async (e) => {
  // Delete: the recording goes from this computer and from the editor (the studio does it)
  const del = e.target.closest('[data-del]');
  if (del) {
    if (!confirm(`Delete ${del.dataset.name}'s recording from this computer and the editor? Everywhere it's used on the timeline goes too. This can't be undone.`)) return;
    ch.postMessage({ type: 'delete', id: del.dataset.del });
    del.closest('li')?.classList.add('going');
    del.disabled = true;
    return;
  }
  const play = e.target.closest('[data-play]')?.dataset.play, dl = e.target.closest('[data-dl]')?.dataset.dl;
  if (!play && !dl) return;
  const r = await clipBlob(play || dl);
  if (!r?.blob) return;
  const url = URL.createObjectURL(r.blob), ext = (r.mime || r.blob.type).includes('mp4') ? 'mp4' : 'webm';
  const name = `${(r.name || 'clip').replace(/[^\w-]+/g, '-')}-${r.id}.${r.kind === 'audio' && ext === 'mp4' ? 'm4a' : ext}`;
  if (dl) {
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    return setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const v = $('#pvVideo');
  if (v.src) URL.revokeObjectURL(v.src);
  v.src = url;
  $('#pvTitle').textContent = `${r.name || 'Clip'} · ${new Date(r.receivedAt || r.t0).toLocaleTimeString()}`;
  Object.assign($('#pvDl'), { href: url, download: name });
  $('#pv').showModal();
  v.play().catch(() => {});
});
$('#pvClose').onclick = () => $('#pv').close();
$('#pv').addEventListener('close', () => $('#pvVideo').pause());

const ch = new BroadcastChannel('vuemesh-monitor-' + eventId);
ch.onmessage = (e) => e.data?.type === 'stats' && render(e.data);

function linkState() {
  const stale = Date.now() - lastAt > 6000;
  $('#waiting').hidden = !stale;
  $('#linkDot').className = 'dot' + (stale ? '' : ' sync');
  $('#linkText').textContent = stale ? 'Waiting for the studio…' : 'Live from the studio';
}
setInterval(linkState, 1000);

const fmtMB = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : Math.round(b / 1e6) + ' MB');
const since = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const median = (a) => {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

function warnings(p) {
  const w = [];
  const t = p.tele || {};
  if (p.route === 'cellular') w.push('On mobile data');
  else if (p.route === 'nat') w.push('Through the router, not direct');
  else if (p.route && p.route !== 'lan' && p.route !== 'local') w.push('Not on the venue Wi-Fi');
  if (p.problem) w.push(`Shot: ${p.problem}`);
  if (t.battery != null && t.battery < 20 && !t.charging) w.push(`Battery ${t.battery}%`);
  if (t.freeMB != null && t.freeMB < 1024) w.push(`${t.freeMB} MB free`);
  if (p.lossPct > 5) w.push(`${p.lossPct}% packet loss`);
  if (p.rttMs > 150) w.push(`Slow link (${p.rttMs} ms)`);
  if (p.fps != null && p.role === 'cam' && p.fps < 15) w.push(`Preview ${p.fps} fps`);
  if (t.queue > 0) w.push(`${t.queue} clip${t.queue > 1 ? 's' : ''} waiting (${t.queueMB} MB)`);
  if (t.synced === false) w.push('Not synced to the beacon');
  if (t.link?.limit === 'cpu') w.push("The phone's encoder is at its limit (it's sending less than it could)");
  if (t.link?.limit === 'bandwidth' && t.link.tier === 'program') w.push('The network is holding back the picture on air');
  return w;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  cam: svg('<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>'),
};
const LIMIT = { cpu: "phone's encoder", bandwidth: 'network', other: 'other', none: '' };
const TIER = { program: 'On air', preview: 'Preview', idle: 'Standby' };
const mbps = (k) => (k == null ? '—' : k >= 1000 ? `${(k / 1000).toFixed(1)}` : `${(k / 1000).toFixed(2)}`);
/** A camera's live picture: its tier, what it's sending of what it may, its size, what limits it. */
function liveCell(l) {
  if (!l) return '—';
  // (a camera plugged into the studio's computer: its picture goes straight in, no network, no compression)
  // (one line: it's straight in, no network or compression, as THIS PC says)
  if (l.local && l.audio) return `<span class="tag ${l.tier === 'program' ? 'air' : ''}">${l.tier === 'program' ? 'On air' : 'Sound'}</span> <small>straight in</small>`;
  if (l.local) return `<span class="tag ${l.tier === 'program' ? 'air' : ''}">${TIER[l.tier] || l.tier}</span> ${l.w ? `${l.w}×${l.h}${l.fps ? ' @' + l.fps : ''} ` : ''}<small>straight in</small>`;
  const lim = LIMIT[l.limit] ?? '';
  return `<span class="tag ${l.tier === 'program' ? 'air' : ''}">${TIER[l.tier] || l.tier}</span> ${mbps(l.kbps)} / ${mbps(l.capKbps)} Mbps`
    + `${l.capKbps < l.targetKbps ? ` <small title="Stepped down from ${mbps(l.targetKbps)} Mbps for a congested link">(of ${mbps(l.targetKbps)})</small>` : ''}`
    + `${l.w ? `<br><small>${l.w}×${l.h}${l.fps ? ' @' + l.fps : ''}${l.hw === true ? ' · hardware' : ''}${lim ? ` · limited by the ${lim}` : ''}</small>` : ''}`;
}

function render(d) {
  lastAt = Date.now();
  linkState();
  if (d.showlog) renderShowLog(d.showlog);
  $('#title').textContent = d.event.title;
  document.title = `${d.event.title} — monitor`;
  const cams = d.peers.filter((p) => p.role === 'cam');
  const mics = d.peers.filter((p) => p.role === 'mic');
  const lan = d.peers.filter((p) => p.route === 'lan').length;  // direct only
  const rtt = median(d.peers.map((p) => p.rttMs));
  const warnCount = d.peers.reduce((s, p) => s + (warnings(p).length ? 1 : 0), 0);
  const tiles = [
    ['Cameras / mics', `${cams.length} / ${mics.length}`, ''],
    ['On the local network', d.peers.length ? `${Math.round((lan / d.peers.length) * 100)}%` : '—', d.peers.length && lan < d.peers.length ? 'warn' : ''],
    ['Median round trip', rtt != null ? `${rtt} ms` : '—', rtt > 150 ? 'warn' : ''],
    ['Recording now', String(d.peers.filter((p) => p.rec).length), ''],
    ['Recordings received', `${d.totals.clips}`, ''],
    ['Footage on this computer', fmtMB(d.totals.bytes), ''],
    ['Program' + (d.program.auto ? ' · auto director' : ''), d.program.onBreak ? 'Break' : d.program.active || 'Standby', d.program.onBreak ? 'warn' : ''],
    ['Phones needing attention', String(warnCount), warnCount ? 'bad' : ''],
  ];
  if (d.stream) {
    const s = d.stream, lim = LIMIT[s.limit] ?? '';
    tiles.push([`Stream to ${s.name || 'the service'}${s.w ? ` · ${s.w}×${s.h}${s.fps ? ' @' + s.fps : ''}` : ''}${lim ? ` · limited by the ${lim}` : ''}`,
      `${mbps(s.kbps)} / ${mbps(s.targetKbps)} Mbps`, s.limit === 'bandwidth' || s.limit === 'cpu' || (s.encKbps != null && s.encKbps < s.targetKbps * 0.5) ? 'warn' : '']);
    // (what the encoder was told to aim for: near the chosen rate and sending less, the picture
    // just doesn't need more; far below it, the receiver or the network is holding it back)
    if (s.encKbps != null) tiles.push(['Stream: the encoder was asked for (Mbps)' + (s.encKbps < s.targetKbps * 0.5 ? ' · held back by the receiver or network' : ''), mbps(s.encKbps), s.encKbps < s.targetKbps * 0.5 ? 'warn' : '']);
  }
  $('#tiles').innerHTML = tiles.map(([k, v, cls]) => `<div class="tile ${cls}"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');

  for (const p of d.peers) {
    const h = history.get(p.peer) || [];
    h.push({ kbps: (p.videoKbps || 0) + (p.audioKbps || 0), rtt: p.rttMs || 0 });
    if (h.length > 60) h.shift();
    history.set(p.peer, h);
  }

  // the sections' counts, in the row of links at the top
  $('#nSources').textContent = d.peers.length || '';
  $('#nSources').classList.toggle('bad', warnCount > 0);
  $('#nSources').title = warnCount ? `${warnCount} needing attention` : '';
  $('#srcSum').textContent = d.peers.length ? `${cams.length} camera${cams.length === 1 ? '' : 's'} · ${mics.length} microphone${mics.length === 1 ? '' : 's'}${warnCount ? ` · ${warnCount} needing attention` : ''}` : '';
  $('#nRec').textContent = d.totals.clips || '';
  $('#recSum').textContent = d.totals.clips ? `${d.totals.clips} · ${fmtMB(d.totals.bytes)} on this computer` : '';

  // Each source a card: what it is, how it's connected, its live picture, and only the figures it
  // has (a camera on this computer has no round trip or battery). One that needs attention is
  // outlined amber, one on air red. Cameras, then microphones.
  if (!d.peers.length) $('#peers').innerHTML = '<p class="empty">Nothing connected yet.</p>';
  else {
    const card = (p) => {
      const t = p.tele || {}, w = warnings(p);
      const remote = p.route !== 'local';
      const routeTag = `<span class="tag ${p.route === 'lan' || p.route === 'nat' || p.route === 'local' ? 'lan' : p.route ? 'net' : ''}" title="${esc(p.path ? `this computer: ${p.path.local?.type || '?'} ${p.path.local?.protocol || ''} · phone: ${p.path.remote?.type || '?'} ${p.path.remote?.address || ''}` : remote ? '' : 'On this computer: straight in, no network, no compression')}">${{ lan: 'LAN', nat: 'LAN·NAT', cellular: 'CELL', local: 'THIS PC' }[p.route] || (p.route ? p.route.toUpperCase() : '…')}</span>`;
      const stats = [
        ['Round trip', p.rttMs != null && `${p.rttMs} ms`],
        ['Jitter', p.jitterMs != null && `${p.jitterMs} ms`],
        ['Loss', p.lossPct != null && `${p.lossPct}%`],
        // (this computer's: its size is on the line above, and it sends what it captures)
        ['Sending', remote && p.width && `${p.width}×${p.height}${p.fps ? ' @' + p.fps : ''}${p.codec && p.codec !== 'raw' ? ' ' + esc(p.codec) : ''}`],
        ['Camera', remote && t.camW && `${t.camW}×${t.camH}${t.camFps ? ' @' + t.camFps : ''}${t.zoom && t.zoom !== 1 ? ` · ${t.zoom}×` : ''}`],
        ['Shot', p.score != null && `<meter min="0" max="1" low="0.35" high="0.6" optimum="1" value="${p.score}" title="Shot quality ${Math.round(p.score * 100)}%"></meter> ${Math.round(p.score * 100)}`],
        ['Battery', t.battery != null && `${t.battery}%${t.charging ? ' ⚡' : ''}`],
        ['Free', t.freeMB != null && fmtMB(t.freeMB * 1048576)],
        ['Connected', p.joinedAt && since(p.joinedAt)],
      ].filter(([, v]) => v);
      const device = [t.platform, t.browser].filter(Boolean).join(' · ');
      return `<article class="src${w.length ? ' attn' : ''}${p.onAir ? ' air' : ''}">
        <header><span class="ico" aria-hidden="true">${ICON[p.role === 'mic' ? 'mic' : 'cam']}</span><b class="nm" title="${esc(p.name)}">${esc(p.name)}</b>${p.onAir ? '<span class="tag air">ON AIR</span>' : ''}${p.rec ? '<span class="dot rec" title="Recording"></span>' : ''}${routeTag}</header>
        ${t.link ? `<div class="live">${liveCell(t.link)}</div>` : ''}
        ${remote ? `<canvas class="spark" data-spark="${esc(p.peer)}" width="480" height="52" role="img" aria-label="Bitrate over the last minute: now ${(p.videoKbps || 0) + (p.audioKbps || 0)} kbps"></canvas>` : ''}
        ${stats.length ? `<dl>${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
        ${device || t.mic ? `<p class="dev" title="${esc(device)}">${esc(device)}${t.mic ? ` · mic: ${esc(t.mic)}` : ''}</p>` : ''}
        ${w.length ? `<ul class="warns" aria-label="Needs attention">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      </article>`;
    };
    const group = (title, list) => (list.length ? `<h3 class="sub">${title} <span class="n">${list.length}</span></h3><div class="srcgrid">${list.map(card).join('')}</div>` : '');
    $('#peers').innerHTML = group('Cameras and screens', cams) + group('Microphones', mics) + group('Other', d.peers.filter((p) => p.role !== 'cam' && p.role !== 'mic'));
    const css = getComputedStyle(document.documentElement);
    document.querySelectorAll('canvas[data-spark]').forEach((c) => {
      const h = history.get(c.dataset.spark) || [];
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const max = Math.max(500, ...h.map((x) => x.kbps));
      g.strokeStyle = css.getPropertyValue('--preview').trim();
      g.lineWidth = 3;
      g.beginPath();
      h.forEach((x, i) => {
        const px = (i / 59) * c.width, py = c.height - 4 - (x.kbps / max) * (c.height - 8);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    });
  }

  // ---- transfers: coming in, going out, received (with preview), sent
  const pct = (x) => Math.round((x.got / Math.max(1, x.total)) * 100);
  const row = (who, what, x) => `<div class="xrow"><span><b>${esc(who)}</b> · ${esc(what)}</span><progress max="100" value="${pct(x)}" aria-label="${esc(who)}: ${pct(x)}%"></progress><span class="num">${pct(x)}% of ${fmtMB(x.total)}</span></div>`;
  // (a live stream: no progress, just that it's flowing and how fast)
  const stream = (who, what, kbps, on = true) => `<div class="xrow"><span><b>${esc(who)}</b> · ${esc(what)}</span><span class="live${on ? '' : ' off'}"><i aria-hidden="true"></i>${on ? 'live' : 'not connected'}</span><span class="num">${kbps == null ? '—' : `${mbps(kbps)} Mbps`}</span></div>`;
  const inc = d.totals.incoming || [], out = d.outgoing || [];
  const liveIn = d.peers.filter((p) => p.route !== 'local').map((p) => stream(p.name, p.role === 'mic' ? 'sound' : `picture${p.width ? ` ${p.width}×${p.height}` : ''}${p.codec ? ` ${p.codec}` : ''}`, (p.videoKbps || 0) + (p.audioKbps || 0)));
  // (and what each TV says it's getting: frames shown, freezes; its cap, if the studio lowered it)
  const got = (t) => (t.rx ? ` · shows ${t.rx.fps ?? '?'} fps${t.rx.freezes ? `, froze ${t.rx.freezes}×` : ''}${t.rx.dropped ? `, dropped ${t.rx.dropped}` : ''}${t.rx.lost ? `, lost ${t.rx.lost} packets` : ''}` : '') + (t.cap && t.cap < (t.remote ? 1200 : 6000) ? ` · lowered to ${(t.cap / 1000).toFixed(1)} Mbps` : '');
  const liveOut = (d.displays || []).map((t) => stream(t.name, `${t.remote ? 'Phone remote' : 'TV'} · ${{ program: 'program', browse: t.sending ? 'sending a recording' : 'browsing recordings', beacon: 'beacon', idle: 'event card' }[t.mode] || t.mode}${t.pip ? ' + PIP' : ''}${t.w ? ` ${t.w}×${t.h}` : ''}${t.codec ? ` ${t.codec}` : ''}${t.route ? ` · ${t.route === 'lan' ? 'this network' : t.route}` : ''}${got(t)}`, t.kbps, t.status === 'connected'));
  // (each phone remote's own link: the show's state and the cameras' pictures, while it's open; its Program out is above, as a TV)
  for (const r of d.remotes || []) liveOut.push(stream(r.name, `Phone remote · control${r.visible ? ', open on its screen (with camera pictures)' : ', in the background'}${r.since ? ` · joined ${since(r.since)} ago` : ''}${r.heard && Date.now() - r.heard > 15000 ? ` · last heard ${since(r.heard)} ago` : ''}`, r.kbps));
  if (d.stream) liveOut.push(stream(d.stream.name || 'Stream', 'the program, streaming out', d.stream.kbps));
  const xin = [...liveIn, ...inc.map((x) => row(x.name, 'recording', x))], xout = [...liveOut, ...out.map((x) => row(x.name, `part ${x.part} of the live cut`, x))];
  $('#nXfer').textContent = inc.length + out.length || '';
  $('#xfIn').innerHTML = xin.length ? xin.join('') : '<p class="empty">Nothing coming in.</p>';
  $('#xfOut').innerHTML = xout.length ? xout.join('') : '<p class="empty">Nothing going out.</p>';
  const rec = d.received || [];
  const rsig = rec.map((r) => r.id + (r.thumb ? 't' : '')).join('|');
  if (rsig !== lastReceived) {
    lastReceived = rsig;
    $('#received').innerHTML = rec.length
      ? `<ul class="rlist">${rec
          .map((r) => `<li><span class="th" style="${r.thumb ? `background-image:url('${r.thumb}')` : ''}">${r.thumb ? '' : r.kind === 'audio' ? '🎙' : '🎞'}</span><span><b>${esc(r.name)}</b> · ${r.kind === 'audio' ? 'microphone' : 'clip'}<small>${fmtDur(r.dur)} · ${fmtMB(r.size)} · ${new Date(r.at).toLocaleTimeString()}</small></span><span class="acts"><button type="button" data-play="${esc(r.id)}">▶ Preview</button><button type="button" data-dl="${esc(r.id)}">Download</button><button type="button" class="danger" data-del="${esc(r.id)}" data-name="${esc(r.name)}">Delete</button></span></li>`)
          .join('')}</ul>`
      : '<p class="empty">Nothing received yet.</p>';
  }
  const sent = d.sent || [];
  $('#sent').innerHTML = sent.length
    ? `<ul class="rlist">${sent.map((x) => `<li><span class="th">⇢</span><span>Part ${x.part} of the live cut → <b>${esc(x.name)}</b><small>${fmtDur(x.secs * 1000)} · ${fmtMB(x.size)} · ${new Date(x.at).toLocaleTimeString()}</small></span><span></span></li>`).join('')}</ul>`
    : '<p class="empty">Nothing sent yet.</p>';
  // someone's looking: the studio's Monitor light can go out
  if (!document.hidden && Date.now() - lastSeenSent > 1500) {
    lastSeenSent = Date.now();
    ch.postMessage({ type: 'seen' });
  }

  if (d.log[0]?.at !== lastLogAt) {
    lastLogAt = d.log[0]?.at;
    $('#log').innerHTML = d.log.map((l) => `<li><time>${new Date(l.at).toLocaleTimeString()}</time><span>${esc(l.text)}</span></li>`).join('') || '<li class="empty">Quiet so far.</li>';
  }
}

// ---- the show log: the last ten minutes from the studio, and every one kept here ----
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
function strip(cv, recent, value, lo, hi, guide) {
  const w = (cv.width = Math.round(cv.clientWidth * devicePixelRatio)), h = (cv.height = Math.round(56 * devicePixelRatio));
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!recent.length) return;
  const t1 = recent.at(-1)[0], t0 = t1 - 600_000;
  const x = (t) => ((t - t0) / 600_000) * w, y = (v) => h - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * h;
  g.fillStyle = '#f0a82b33'; // seconds drawn by the background clock (studio hidden or covered)
  for (const r of recent) if (r[3]) g.fillRect(x(r[0]), 0, Math.max(1, w / 600), h);
  if (guide != null) {
    g.strokeStyle = css('--line', '#2a2c32');
    g.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
    g.beginPath(); g.moveTo(0, y(guide)); g.lineTo(w, y(guide)); g.stroke();
    g.setLineDash([]);
  }
  g.strokeStyle = css('--text', '#ececef');
  g.lineWidth = 1.5 * devicePixelRatio;
  g.beginPath();
  let gap = true, prev = 0;
  for (const r of recent) {
    const v = value(r);
    if (v == null || r[0] - prev > 2500) gap = true;
    prev = r[0];
    if (v == null) continue;
    if (gap) g.moveTo(x(r[0]), y(v)); else g.lineTo(x(r[0]), y(v));
    gap = false;
  }
  g.stroke();
}
let lastSession = null, lastLines = '';
const openMoments = new Set(); // (a list of moments you opened stays open as the log updates)
$('#slLines').addEventListener('toggle', (e) => {
  const k = e.target.dataset?.k;
  if (k == null) return;
  if (e.target.open) openMoments.add(k);
  else openMoments.delete(k);
}, true);
function renderShowLog(sl) {
  strip($('#slFps'), sl.recent, (r) => r[1], 0, 35, 30);
  strip($('#slSnd'), sl.recent, (r) => r[2], -90, 0, -90 + 6);
  $('#slAlert').hidden = !sl.alerts.length;
  $('#slAlert').textContent = sl.alerts.length ? `⚠ ${sl.alerts.join(' · ')}` : '';
  $('#nAlerts').textContent = sl.alerts.length || '';
  $('#nAlerts').classList.toggle('bad', sl.alerts.length > 0);
  // Each line of the summary, with its moments (the indented lines under it: "12:01:30 …") folded
  // under it: open to see them. A moment's time in a column of its own.
  const groups = [];
  for (const l of sl.lines) {
    if (/^\s/.test(l) && groups.length) groups.at(-1).more.push(l.trim());
    else groups.push({ text: l, more: [] });
  }
  const moment = (m) => {
    const [, t, rest] = m.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)\s+(.*)$/i) || [];
    return t ? `<li><time>${esc(t)}</time><span>${esc(rest)}</span></li>` : `<li><span></span><span>${esc(m)}</span></li>`;
  };
  const html = groups.map((g) => `<li>${esc(g.text)}${g.more.length ? `<details${openMoments.has(g.text.slice(0, 24)) ? ' open' : ''} data-k="${esc(g.text.slice(0, 24))}"><summary>${g.more.length} moment${g.more.length === 1 ? '' : 's'}</summary><ul class="moments">${g.more.map(moment).join('')}</ul></details>` : ''}</li>`).join('') || '<li>Nothing logged yet.</li>';
  if (html !== lastLines) {
    lastLines = html;
    $('#slLines').innerHTML = html;
  }
  if (sl.session !== lastSession) {
    lastSession = sl.session;
    renderSessions();
  }
}
let sessions = [];
async function renderSessions() {
  sessions = joinChunks(await idb.list('showlog', eventId).catch(() => []));
  const ul = $('#slSessions');
  if (!sessions.length) return void (ul.innerHTML = '<li class="empty">None yet.</li>');
  const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  ul.innerHTML = sessions.map((s, i) => {
    const mins = Math.round(s.rows.length / 60), alerts = s.events.filter((e) => e.kind === 'alert').length;
    return `<li><span><b>${esc(when(s.startedAt))}</b><small>${mins} min logged · ${s.events.length} events${alerts ? ` · ${alerts} sound alert${alerts === 1 ? '' : 's'}` : ''}${s.session === lastSession ? ' · open now' : ''}</small></span><span class="acts"><button type="button" data-sl-save="${i}">Save show log</button></span></li>`;
  }).join('');
}
$('#slSessions').addEventListener('click', async (e) => {
  const i = e.target.closest('[data-sl-save]')?.dataset.slSave;
  if (i == null) return;
  await renderSessions(); // (the newest minute, if the studio has kept it since)
  const s = sessions[Number(i)];
  if (!s) return;
  const blob = new Blob([JSON.stringify(sessionFile(s))], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `vuemesh-showlog-${eventId}-${new Date(s.startedAt).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});
renderSessions();
setInterval(renderSessions, 60_000);
