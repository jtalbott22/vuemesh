// A spinning globe of events. No map tiles, no API keys: the land outline is a
// 55 KB Natural Earth file served with the site, drawn with d3-geo on a canvas.

const { d3, topojson } = window;

export class EventGlobe {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onSelect:(ev:object)=>void}} o
   */
  constructor(canvas, o = {}) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.onSelect = o.onSelect || (() => {});
    this.events = [];
    this.selected = null;
    this.me = null;
    this.rotation = [96, -30]; // start over North America
    this.zoom = 1;
    this.lastInteract = 0;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.proj = d3.geoOrthographic().clipAngle(90).precision(0.6);
    this.path = d3.geoPath(this.proj, this.g);
    this.graticule = d3.geoGraticule10();
    this.visible = true;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(canvas);
    this.resize();
    requestAnimationFrame((t) => this._frame(t));
  }

  async load() {
    const topo = await fetch('/vendor/land-110m.json').then((r) => r.json());
    this.land = topojson.feature(topo, topo.objects.land);
  }

  setEvents(list) {
    this.events = list;
  }

  setMe(lat, lon) {
    this.me = { lat, lon };
  }

  select(ev, fly = true) {
    this.selected = ev?.id || null;
    if (ev && fly) this.flyTo(ev.lon, ev.lat);
  }

  flyTo(lon, lat) {
    const from = this.rotation.slice();
    const to = [-lon, -lat];
    // go the short way round
    while (to[0] - from[0] > 180) to[0] -= 360;
    while (to[0] - from[0] < -180) to[0] += 360;
    this.lastInteract = performance.now();
    if (this.reduce) {
      this.rotation = to;
      return;
    }
    this.anim = { from, to, t0: performance.now(), dur: 900 };
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  _colors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { ocean: v('--surface'), land: v('--surface-3'), line: v('--line'), text: v('--text'), muted: v('--muted') };
  }

  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    if (!this.visible || !this.land) return;
    if (this.anim) {
      const k = Math.min(1, (now - this.anim.t0) / this.anim.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.rotation = [0, 1].map((i) => this.anim.from[i] + (this.anim.to[i] - this.anim.from[i]) * e);
      if (k === 1) this.anim = null;
    } else if (!this.reduce && !this.dragging && now - this.lastInteract > 6000) {
      this.rotation[0] += 0.04; // slow drift while nobody's touching it
    }
    this.draw(now);
  }

  draw(now = performance.now()) {
    const { g, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const r = (Math.min(W, H) / 2) * 0.9 * this.zoom;
    this.proj.scale(r).translate([W / 2, H / 2]).rotate([this.rotation[0], this.rotation[1], 0]);
    const c = this._colors();
    g.clearRect(0, 0, W, H);

    g.beginPath();
    this.path({ type: 'Sphere' });
    g.fillStyle = c.ocean;
    g.fill();

    g.beginPath();
    this.path(this.graticule);
    g.strokeStyle = c.line;
    g.globalAlpha = 0.45;
    g.lineWidth = 1 * this.dpr;
    g.stroke();
    g.globalAlpha = 1;

    g.beginPath();
    this.path(this.land);
    g.fillStyle = c.land;
    g.fill();
    g.strokeStyle = c.line;
    g.lineWidth = 0.8 * this.dpr;
    g.stroke();

    g.beginPath();
    this.path({ type: 'Sphere' });
    g.strokeStyle = c.line;
    g.lineWidth = 1.5 * this.dpr;
    g.stroke();

    const center = [-this.rotation[0], -this.rotation[1]];
    const pulse = this.reduce ? 0.5 : (Math.sin(now / 350) + 1) / 2;
    this.hits = [];
    const draw = (ev, sel) => {
      if (d3.geoDistance([ev.lon, ev.lat], center) > Math.PI / 2 - 0.02) return;
      const [x, y] = this.proj([ev.lon, ev.lat]);
      const col = ev.live ? '#e8352b' : ev.published ? '#6d9cf0' : c.muted;
      const s = this.dpr;
      if (ev.live) {
        g.beginPath();
        g.arc(x, y, (8 + pulse * 8) * s, 0, Math.PI * 2);
        g.fillStyle = '#e8352b';
        g.globalAlpha = 0.25 * (1 - pulse * 0.6);
        g.fill();
        g.globalAlpha = 1;
      }
      g.beginPath();
      g.arc(x, y, (sel ? 7 : 5) * s, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
      g.lineWidth = 2 * s;
      g.strokeStyle = sel ? c.text : '#0008';
      g.stroke();
      if (sel) {
        g.font = `700 ${13 * s}px Archivo, system-ui, sans-serif`;
        const label = ev.title;
        const tw = g.measureText(label).width;
        const lx = Math.min(Math.max(x + 12 * s, 8 * s), W - tw - 16 * s);
        g.fillStyle = '#0d1226e6';
        g.fillRect(lx - 6 * s, y - 12 * s, tw + 12 * s, 22 * s);
        g.fillStyle = '#fff';
        g.textBaseline = 'middle';
        g.fillText(label, lx, y - 1 * s);
      }
      this.hits.push({ ev, x, y });
    };
    for (const ev of this.events) if (ev.id !== this.selected) draw(ev, false);
    const sel = this.events.find((e) => e.id === this.selected);
    if (sel) draw(sel, true);

    if (this.me && d3.geoDistance([this.me.lon, this.me.lat], center) < Math.PI / 2) {
      const [x, y] = this.proj([this.me.lon, this.me.lat]);
      g.beginPath();
      g.arc(x, y, 4 * this.dpr, 0, Math.PI * 2);
      g.fillStyle = c.text;
      g.fill();
      g.beginPath();
      g.arc(x, y, 9 * this.dpr, 0, Math.PI * 2);
      g.strokeStyle = c.text;
      g.lineWidth = 1.5 * this.dpr;
      g.stroke();
    }
  }

  _bind() {
    const cv = this.canvas;
    const pointers = new Map();
    let start = null;
    let pinch0 = null;
    let moved = false;
    cv.tabIndex = 0;
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.dragging = true;
      this.anim = null;
      moved = false;
      start = { x: e.clientX, y: e.clientY, rot: this.rotation.slice(), zoom: this.zoom };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.lastInteract = performance.now();
      if (pointers.size === 2 && pinch0) {
        const [a, b] = [...pointers.values()];
        this.zoom = Math.min(4, Math.max(0.7, pinch0.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d)));
        moved = true;
        return;
      }
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      const k = 0.25 / this.zoom;
      this.rotation = [start.rot[0] + dx * k, Math.max(-85, Math.min(85, start.rot[1] - dy * k))];
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch0 = null;
      if (pointers.size) return;
      this.dragging = false;
      if (!moved) this._clickAt(e);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    // Trackpad pinch arrives as ctrl+wheel; a plain wheel keeps scrolling the page.
    cv.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      this.zoom = Math.min(4, Math.max(0.7, this.zoom * Math.exp(-e.deltaY * 0.01)));
      this.lastInteract = performance.now();
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      const step = 8 / this.zoom;
      const map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        e.preventDefault();
        this.anim = null;
        this.rotation = [this.rotation[0] + map[e.key][0], Math.max(-85, Math.min(85, this.rotation[1] + map[e.key][1]))];
        this.lastInteract = performance.now();
      } else if (e.key === '+' || e.key === '=') this.zoom = Math.min(4, this.zoom * 1.2);
      else if (e.key === '-') this.zoom = Math.max(0.7, this.zoom / 1.2);
    });
  }

  _clickAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * this.dpr, y = (e.clientY - r.top) * this.dpr;
    let best = null;
    for (const h of this.hits || []) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < 16 * this.dpr && (!best || d < best.d)) best = { d, ev: h.ev };
    }
    if (best) {
      this.select(best.ev, false);
      this.onSelect(best.ev);
    }
  }
}

export function km(lat1, lon1, lat2, lon2) {
  const toR = (d) => (d * Math.PI) / 180;
  const a = Math.sin(toR(lat2 - lat1) / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(toR(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
