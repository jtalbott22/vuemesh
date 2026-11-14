// Admin's charts, in plain SVG: time series (columns, lines and areas on one axis), sparklines, and
// number formats. Colours come from the page's chart tokens (--series-1, --chart-grid…), so both
// themes work; the printable snapshot passes plain hex instead.
//
// Every chart drawn with chart() has a crosshair and a tooltip (pointer and arrow keys), a legend
// when there's more than one series, and a table of its numbers behind the Table button.

const SVGNS = 'http://www.w3.org/2000/svg';
const TOKENS = {
  grid: 'var(--chart-grid)', axis: 'var(--chart-axis)', text: 'var(--chart-text)', muted: 'var(--chart-muted)', surface: 'var(--chart-surface)',
};
let uid = 0;

// ---- numbers -----------------------------------------------------------------
const trim = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
/** 1,284 · 12.9K · 4.2M (whole numbers below 10,000) */
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${trim(v / 1e9)}B`;
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e4) return `${trim(v / 1e3)}K`;
  return Number.isInteger(v) || a >= 100 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toLocaleString();
}
export const bytes = (b) => (b >= 1e12 ? `${trim(b / 1e12)} TB` : b >= 1e9 ? `${trim(b / 1e9)} GB` : b >= 1e6 ? `${trim(b / 1e6)} MB` : b >= 1e3 ? `${trim(b / 1e3)} KB` : `${Math.round(b)} B`);
export const pct = (x) => `${x >= 0.1 || x === 0 ? Math.round(x * 100) : trim(x * 100)}%`;

/** Round ticks from 0 to at least max: steps of 1, 2, 2.5 or 5 × a power of ten */
export function niceTicks(max, count = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / count, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const out = [];
  for (let v = 0; v <= max + step * 1e-9 || out.length < 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
}

// ---- dates -------------------------------------------------------------------
const UTC = { timeZone: 'UTC' };
/** A day (YYYY-MM-DD, or its UTC midnight in ms) as "Nov 3", or "Nov 2025" across a long span */
export const dayLabel = (t, long = false) => new Date(typeof t === 'string' ? Date.parse(t) : t).toLocaleDateString(undefined, long ? { ...UTC, month: 'short', year: 'numeric' } : { ...UTC, month: 'short', day: 'numeric' });
export const dayFull = (t) => new Date(typeof t === 'string' ? Date.parse(t) : t).toLocaleDateString(undefined, { ...UTC, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const hourLabel = (t) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' });

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- the drawing ---------------------------------------------------------------
/**
 * One time-series chart as an SVG string, `width` wide.
 * @param {{
 *   series: {name: string, kind: 'column'|'line'|'area', color: string, values: number[]}[],
 *   x: number[], height?: number, format?: (v:number)=>string, xLabel?: (t:number)=>string,
 *   ink?: object, endLabels?: boolean,
 * }} o  x: one time (ms) per value
 */
export function renderSvg(o, width) {
  const { series, x } = o, H = o.height || 240, n = x.length, ink = { ...TOKENS, ...(o.ink || {}) };
  const fmt = o.format || compact, xLabel = o.xLabel || ((t) => dayLabel(t));
  const max = Math.max(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max), top = ticks[ticks.length - 1] || 1;
  const yw = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 10;
  const ends = o.endLabels !== false && series.some((s) => s.kind !== 'column');
  const m = { l: Math.round(yw), r: ends ? 52 : 10, t: 10, b: 24 };
  const W = Math.max(width, m.l + m.r + 40), pw = W - m.l - m.r, ph = H - m.t - m.b;
  const band = pw / Math.max(1, n), cx = (i) => m.l + band * (i + 0.5);
  const y = (v) => m.t + ph - (v / top) * ph, y0 = m.t + ph;
  const id = `c${++uid}`;
  const parts = [];
  // grid and y ticks
  for (const t of ticks) {
    const yy = y(t).toFixed(1);
    if (t > 0) parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}" stroke="${ink.grid}" stroke-width="1" shape-rendering="crispEdges"/>`);
    parts.push(`<text x="${m.l - 8}" y="${yy}" dy="0.32em" text-anchor="end" fill="${ink.muted}" font-size="11" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`);
  }
  // x labels: about one every 90px, the last always
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 90))));
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    if (i % every && !last) continue;
    if (!last && n - 1 - i < every * 0.6) continue; // (too close to the last one)
    const anchor = n === 1 ? 'middle' : i === 0 ? 'start' : last ? 'end' : 'middle';
    const xx = n === 1 ? cx(i) : i === 0 ? m.l : last ? W - m.r : cx(i);
    parts.push(`<text x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}" fill="${ink.muted}" font-size="11">${esc(xLabel(x[i]))}</text>`);
  }
  // columns: at most 24px, a 2px gap between neighbours, a 4px rounded top, square at the baseline
  const bw = Math.max(1, Math.min(24, band - 2));
  series.forEach((s, si) => {
    if (s.kind !== 'column') return;
    const bars = s.values.map((v, i) => {
      if (!(v > 0)) return '';
      const x0 = cx(i) - bw / 2, yt = y(v), r = Math.min(4, bw / 2, y0 - yt);
      const d = r >= 1
        ? `M${x0.toFixed(1)},${y0}V${(yt + r).toFixed(1)}Q${x0.toFixed(1)},${yt.toFixed(1)} ${(x0 + r).toFixed(1)},${yt.toFixed(1)}H${(x0 + bw - r).toFixed(1)}Q${(x0 + bw).toFixed(1)},${yt.toFixed(1)} ${(x0 + bw).toFixed(1)},${(yt + r).toFixed(1)}V${y0}Z`
        : `M${x0.toFixed(1)},${y0}V${yt.toFixed(1)}H${(x0 + bw).toFixed(1)}V${y0}Z`;
      return `<path data-i="${i}" d="${d}"/>`;
    }).join('');
    parts.push(`<g class="cols" data-s="${si}" fill="${s.color}">${bars}</g>`);
  });
  // areas (a wash fading to the baseline) and lines (2px), drawn over the columns
  series.forEach((s, si) => {
    if (s.kind === 'column') return;
    const pts = s.values.map((v, i) => [cx(i), y(Math.max(0, v || 0))]);
    if (!pts.length) return;
    const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
    if (s.kind === 'area') {
      parts.push(`<defs><linearGradient id="${id}g${si}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${s.color};stop-opacity:.22"/><stop offset="1" style="stop-color:${s.color};stop-opacity:0"/></linearGradient></defs>`);
      parts.push(`<path d="${line}L${pts[pts.length - 1][0].toFixed(1)},${y0}L${pts[0][0].toFixed(1)},${y0}Z" fill="url(#${id}g${si})"/>`);
    }
    parts.push(`<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
  });
  // baseline
  parts.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}" stroke="${ink.axis}" stroke-width="1" shape-rendering="crispEdges"/>`);
  // end dots with a ring of the surface, and the last value beside them (not when two would collide)
  if (ends && n) {
    const lined = series.filter((s) => s.kind !== 'column');
    const ys = lined.map((s) => y(Math.max(0, s.values[n - 1] || 0)));
    lined.forEach((s, k) => {
      parts.push(`<circle cx="${cx(n - 1).toFixed(1)}" cy="${ys[k].toFixed(1)}" r="4" fill="${s.color}" stroke="${ink.surface}" stroke-width="2"/>`);
      if (ys.slice(0, k).some((o2) => Math.abs(o2 - ys[k]) < 14)) return;
      parts.push(`<text x="${(cx(n - 1) + 9).toFixed(1)}" y="${ys[k].toFixed(1)}" dy="0.32em" fill="${ink.text}" font-size="11.5" font-weight="600" style="font-variant-numeric:tabular-nums">${esc(fmt(s.values[n - 1] || 0))}</text>`);
    });
  }
  // the hover layer (used by chart(); inert in a static copy)
  parts.push(`<g class="hover" visibility="hidden"><line class="xh" y1="${m.t}" y2="${y0}" stroke="${ink.muted}" stroke-width="1" shape-rendering="crispEdges"/>${series.map((s) => (s.kind === 'column' ? '' : `<circle class="hd" r="4.5" fill="${s.color}" stroke="${ink.surface}" stroke-width="2"/>`)).join('')}</g>`);
  return {
    svg: `<svg xmlns="${SVGNS}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="inherit" style="display:block;overflow:visible">${parts.join('')}</svg>`,
    geom: { m, band, n, W, H, y, cx },
  };
}

/** A small trend line with a wash under it (no axes): for stat tiles */
export function sparkline(values, color = 'var(--series-1)') {
  const v = values.length > 1 ? values : [0, ...values, 0].slice(0, 2);
  const max = Math.max(...v, 1e-9), w = 100, h = 30;
  const pts = v.map((a, i) => `${((i / (v.length - 1)) * w).toFixed(2)},${(h - 2 - (a / max) * (h - 5)).toFixed(2)}`);
  const g = `s${++uid}`;
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${g}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:.25"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient></defs><path d="M0,${h}L${pts.join('L')}L${w},${h}Z" fill="url(#${g})"/><path d="M${pts.join('L')}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

// ---- the interactive chart -------------------------------------------------------
/**
 * Draws a time-series chart into `el`, at its own width (and again when that changes), with a
 * crosshair and tooltip, a legend for two or more series, and a table view.
 * @param {HTMLElement} el  @param {object} o renderSvg's options, plus label (for screen readers)
 *   and tipLabel (t => the tooltip's heading)
 * @returns {{update: (o:object)=>void}}
 */
export function chart(el, o) {
  el.classList.add('chart');
  el.innerHTML = `<div class="chart-head"><div class="chart-legend"></div><button type="button" class="chart-tbtn" aria-expanded="false">Table</button></div>
    <div class="chart-plot" tabindex="0" role="img"><div class="chart-svg"></div><div class="chart-tip" hidden></div></div>
    <div class="chart-table" hidden></div>`;
  const plot = el.querySelector('.chart-plot'), holder = el.querySelector('.chart-svg'), tip = el.querySelector('.chart-tip');
  const tbtn = el.querySelector('.chart-tbtn'), tbl = el.querySelector('.chart-table'), legend = el.querySelector('.chart-legend');
  let opts = o, geom = null, idx = -1, width = 0;

  const fmt = () => opts.format || compact;
  const tipLabel = () => opts.tipLabel || ((t) => dayFull(t));
  function draw() {
    width = plot.clientWidth || 600;
    const r = renderSvg(opts, width);
    holder.innerHTML = r.svg;
    geom = r.geom;
    const s = opts.series;
    legend.replaceChildren(...(s.length > 1 ? s.map((x) => {
      const k = document.createElement('span');
      k.className = 'chart-key';
      const sw = document.createElement('i');
      sw.className = x.kind === 'column' ? 'sw-bar' : 'sw-line';
      sw.style.background = x.color;
      k.append(sw, document.createTextNode(x.name));
      return k;
    }) : []));
    const last = opts.x.length - 1;
    plot.setAttribute('aria-label', `${opts.label || s.map((x) => x.name).join(' and ')}. ${last >= 0 ? `Latest, ${tipLabel()(opts.x[last])}: ${s.map((x) => `${x.name} ${fmt()(x.values[last] || 0)}`).join(', ')}.` : 'No data.'} Arrow keys step through the values; the Table button lists them all.`);
    if (!tbl.hidden) table();
    if (idx >= 0) show(idx);
  }
  function table() {
    const s = opts.series, f = fmt(), tl = tipLabel();
    const t = document.createElement('table');
    const head = t.createTHead().insertRow();
    for (const h of ['', ...s.map((x) => x.name)]) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = h; head.append(th); }
    const body = t.createTBody();
    for (let i = opts.x.length - 1; i >= 0; i--) {
      const r = body.insertRow(), th = document.createElement('th');
      th.scope = 'row';
      th.textContent = tl(opts.x[i]);
      r.append(th);
      for (const x of s) r.insertCell().textContent = f(x.values[i] || 0);
    }
    tbl.replaceChildren(t);
  }
  function show(i) {
    if (!geom || !geom.n) return;
    idx = Math.max(0, Math.min(geom.n - 1, i));
    const svg = holder.firstElementChild, hover = svg.querySelector('.hover'), xx = geom.cx(idx);
    hover.setAttribute('visibility', 'visible');
    const xh = hover.querySelector('.xh');
    xh.setAttribute('x1', xx); xh.setAttribute('x2', xx);
    const dots = hover.querySelectorAll('.hd');
    let k = 0;
    for (const s of opts.series) {
      if (s.kind === 'column') continue;
      dots[k].setAttribute('cx', xx); dots[k].setAttribute('cy', geom.y(Math.max(0, s.values[idx] || 0))); k++;
    }
    svg.querySelectorAll('.cols path').forEach((p) => p.classList.toggle('dim', +p.dataset.i !== idx));
    // the tooltip: the time, then each series, value first
    const head = document.createElement('div');
    head.className = 'tip-h';
    head.textContent = tipLabel()(opts.x[idx]);
    tip.replaceChildren(head, ...opts.series.map((s) => {
      const row = document.createElement('div'), key = document.createElement('i'), b = document.createElement('b'), name = document.createElement('span');
      row.className = 'tip-r';
      key.className = s.kind === 'column' ? 'sw-bar' : 'sw-line';
      key.style.background = s.color;
      b.textContent = fmt()(s.values[idx] || 0);
      name.textContent = s.name;
      row.append(key, b, name);
      return row;
    }));
    tip.hidden = false;
    const tw = tip.offsetWidth, left = xx + 14 + tw > geom.W ? xx - 14 - tw : xx + 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${geom.m.t}px`;
  }
  function hide() {
    idx = -1;
    tip.hidden = true;
    const svg = holder.firstElementChild;
    svg?.querySelector('.hover')?.setAttribute('visibility', 'hidden');
    svg?.querySelectorAll('.cols path.dim').forEach((p) => p.classList.remove('dim'));
  }
  plot.addEventListener('pointermove', (e) => {
    if (!geom) return;
    const r = plot.getBoundingClientRect(), px = e.clientX - r.left;
    show(Math.floor((px - geom.m.l) / geom.band));
  });
  plot.addEventListener('pointerleave', hide);
  plot.addEventListener('focus', () => show(idx >= 0 ? idx : (geom?.n || 1) - 1));
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }[e.key];
    if (e.key === 'Escape') return hide();
    if (step === undefined || !geom) return;
    e.preventDefault();
    show(step === -Infinity ? 0 : step === Infinity ? geom.n - 1 : (idx < 0 ? geom.n - 1 : idx) + step);
  });
  tbtn.addEventListener('click', () => {
    tbl.hidden = !tbl.hidden;
    tbtn.setAttribute('aria-expanded', String(!tbl.hidden));
    tbtn.textContent = tbl.hidden ? 'Table' : 'Hide table';
    if (!tbl.hidden) table();
  });
  new ResizeObserver(() => { if (Math.abs((plot.clientWidth || 0) - width) > 1) draw(); }).observe(plot);
  draw();
  return { update(next) { opts = next; hide(); draw(); } };
}
