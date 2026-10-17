// The VUEMesh landing demo: one moment, rendered live from four guests' phones.
// Pure canvas 2D with a tiny perspective projector — no libraries.

const TAU = Math.PI * 2;
const VOID = '#0e1329';

export const ANGLES = [
  { key: 1, who: 'Rosa', spot: 'front row', color: '#6d9cf0', pos: [0.5, 1.35, 3.3], target: [0, 1.25, -0.4], fov: 56, wob: 0.018 },
  { key: 2, who: 'Dev', spot: 'balcony', color: '#f0b44d', pos: [-6.5, 7.6, 9.6], target: [0, 0.3, -1], fov: 42, wob: 0.006 },
  { key: 3, who: 'Priya', spot: 'dance floor', color: '#4cc2b3', pos: [-1.4, 1.55, 1.1], target: [0.1, 1.35, -0.2], fov: 64, wob: 0.035, orbit: true },
  { key: 4, who: 'Marcus', spot: 'side stage', color: '#c883dc', pos: [4.4, 1.75, -2.4], target: [0, 1.25, -0.3], fov: 44, wob: 0.014 },
];

// ---------------------------------------------------------------- world ----

function rng(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
const R = rng(20260928);

const BODY = ['#2f3960', '#3a4574', '#46507f', '#2a3356', '#4b4f6e', '#55486e', '#3d4a6b'];
const HEAD = ['#8a8fb0', '#a58f86', '#7d6a62', '#b59c8c', '#6f5a52', '#c2a896'];
const CONFETTI = ['#ffd27a', '#ffffff', '#e39bbd', '#6d9cf0', '#f0b44d'];

const people = [];
for (let i = 0; i < 90 && people.length < 64; i++) {
  const a = R() * TAU;
  const r = 2.7 + R() * 3.4;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r * 0.85 + 0.3;
  // keep sightlines open near the four phones and the beacon
  if (ANGLES.some((c) => Math.hypot(c.pos[0] - x, c.pos[2] - z) < 1.1)) continue;
  if (Math.abs(x) < 1.4 && z < -4.4) continue;
  people.push({
    x, z,
    h: 1.55 + R() * 0.32,
    body: BODY[Math.floor(R() * BODY.length)],
    head: HEAD[Math.floor(R() * HEAD.length)],
    phase: R() * TAU,
    phone: R() < 0.42,
  });
}

// The four phones in the demo are held by people too.
const owners = ANGLES.map((c) => {
  const dx = c.target[0] - c.pos[0];
  const dz = c.target[2] - c.pos[2];
  const d = Math.hypot(dx, dz) || 1;
  return { x: c.pos[0] - (dx / d) * 0.35, z: c.pos[2] - (dz / d) * 0.35, h: 1.7, body: '#3a4574', head: '#a58f86', phase: R() * TAU };
});

const confetti = Array.from({ length: 110 }, () => ({
  x: (R() - 0.5) * 9,
  y: R() * 5.5,
  z: (R() - 0.5) * 8 - 0.5,
  vy: 0.35 + R() * 0.45,
  spin: R() * TAU,
  vs: 2 + R() * 5,
  c: CONFETTI[Math.floor(R() * CONFETTI.length)],
}));

const STRANDS = [-3.4, -1.2, 1.0, 3.2].map((z, k) => ({ z, y: 4.3 + (k % 2) * 0.25, sag: 0.7 }));
const BEACON = { x: 0, y: 2.05, z: -6.3, w: 1.5 };
let qrCells = randomQR();

function randomQR() {
  const n = 11;
  const cells = [];
  const inFinder = (r, c) => (r < 3 && c < 3) || (r < 3 && c >= n - 3) || (r >= n - 3 && c < 3);
  const nearFinder = (r, c) => (r < 4 && c < 4) || (r < 4 && c >= n - 4) || (r >= n - 4 && c < 4);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (inFinder(r, c)) cells.push([r, c]);
      else if (!nearFinder(r, c) && R() < 0.5) cells.push([r, c]);
    }
  }
  return { n, cells };
}

// ------------------------------------------------------------ camera ----

function camera(c, t, W, H, still) {
  const w = still ? 0 : c.wob;
  let pos = c.pos.slice();
  let target = c.target.slice();
  if (c.orbit && !still) {
    const a = Math.atan2(pos[2], pos[0]) + Math.sin(t * 0.21) * 0.55;
    const r = Math.hypot(pos[0], pos[2]);
    pos = [Math.cos(a) * r, pos[1], Math.sin(a) * r];
  }
  const k = c.key * 1.7;
  pos[0] += Math.sin(t * 1.31 + k) * w + Math.sin(t * 3.7 + k) * w * 0.3;
  pos[1] += Math.sin(t * 1.73 + k * 2) * w * 0.8;
  pos[2] += Math.sin(t * 0.97 + k * 3) * w;
  target[0] += Math.sin(t * 0.6 + k) * w * 6;
  target[1] += Math.sin(t * 0.8 + k) * w * 3;

  const f = norm(sub(target, pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const focal = H / 2 / Math.tan((c.fov * Math.PI) / 360);
  return { p: pos, f, r, u, focal, W, H };
}

function toCam(cam, x, y, z) {
  const dx = x - cam.p[0], dy = y - cam.p[1], dz = z - cam.p[2];
  return [
    dx * cam.r[0] + dy * cam.r[1] + dz * cam.r[2],
    dx * cam.u[0] + dy * cam.u[1] + dz * cam.u[2],
    dx * cam.f[0] + dy * cam.f[1] + dz * cam.f[2],
  ];
}

const NEAR = 0.15;
function screen(cam, v) {
  return { x: cam.W / 2 + (v[0] / v[2]) * cam.focal, y: cam.H / 2 - (v[1] / v[2]) * cam.focal, z: v[2], s: cam.focal / v[2] };
}
function proj(cam, x, y, z) {
  const v = toCam(cam, x, y, z);
  return v[2] < NEAR ? null : screen(cam, v);
}

// Convex polygon clipped against the near plane, then projected.
function polygon(cam, pts) {
  const cv = pts.map((p) => toCam(cam, p[0], p[1], p[2]));
  const out = [];
  for (let i = 0; i < cv.length; i++) {
    const a = cv[i], b = cv[(i + 1) % cv.length];
    const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const k = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]);
    }
  }
  return out.length >= 3 ? out.map((v) => screen(cam, v)) : null;
}

function fillPoly(g, sp, color, alpha = 1) {
  if (!sp) return;
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.beginPath();
  sp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.fill();
  g.globalAlpha = 1;
}

const fog = (z) => Math.max(0.25, Math.min(1, 1.15 - z / 22));

// ------------------------------------------------------------ render ----

/**
 * Draw the scene from one angle.
 * @param {CanvasRenderingContext2D} g
 * @param {number} W @param {number} H  canvas pixels
 * @param {number} idx  which angle
 * @param {number} t  seconds
 * @param {number} live  index of the angle that's on air (its phone glows red)
 * @param {object} o  { still, pulse }
 */
export function render(g, W, H, idx, t, live, o = {}) {
  const cam = camera(ANGLES[idx], t, W, H, o.still);
  const beat = (t * 118) / 60;
  g.fillStyle = VOID;
  g.fillRect(0, 0, W, H);

  // Floor, then the dance floor tiles pulsing on the beat.
  fillPoly(g, polygon(cam, [[-14, 0, -9], [14, 0, -9], [14, 0, 10], [-14, 0, 10]]), '#151b36');
  const b = Math.floor(beat);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x0 = -3 + i, z0 = -3.3 + j;
      const lit = (i + j + b) % 3 === 0;
      const warm = (i * 7 + j * 3 + b) % 5 === 0;
      const col = lit ? (warm ? '#6a5530' : '#33438a') : '#1d2447';
      fillPoly(g, polygon(cam, [[x0 + 0.03, 0.001, z0 + 0.03], [x0 + 0.97, 0.001, z0 + 0.03], [x0 + 0.97, 0.001, z0 + 0.97], [x0 + 0.03, 0.001, z0 + 0.97]]), col);
    }
  }
  // Spotlight on the couple
  const spot = [];
  for (let k = 0; k < 24; k++) spot.push([Math.cos((k / 24) * TAU) * 1.15, 0.002, Math.sin((k / 24) * TAU) * 1.15 - 0.3]);
  fillPoly(g, polygon(cam, spot), '#ffd27a', 0.24);

  // String-light wires
  g.strokeStyle = '#2a3150';
  g.lineWidth = Math.max(1, W / 900);
  for (const s of STRANDS) {
    g.beginPath();
    let started = false;
    for (let k = 0; k <= 40; k++) {
      const u = k / 40;
      const p = proj(cam, -8 + 16 * u, s.y - s.sag * (1 - (2 * u - 1) ** 2), s.z);
      if (!p) { started = false; continue; }
      started ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y);
      started = true;
    }
    g.stroke();
  }

  // Everything that needs depth sorting
  const items = [];
  const bob = (ph) => (o.still ? 0 : Math.abs(Math.sin(beat * Math.PI + ph)) * 0.07);

  for (const p of people) items.push(personItem(g, cam, p, bob(p.phase)));
  owners.forEach((p, k) => {
    if (k !== idx) items.push(personItem(g, cam, p, bob(p.phase) * 0.4));
  });

  // The couple, slow-dancing in the spotlight
  const a = o.still ? 0.6 : t * 0.45;
  const sway = o.still ? 0 : Math.sin(beat * Math.PI * 0.5) * 0.04;
  items.push(personItem(g, cam, { x: Math.cos(a) * 0.28 + sway, z: Math.sin(a) * 0.28 - 0.3, h: 1.64, body: '#eeeae2', head: '#b59c8c', wide: 1.35 }, 0));
  items.push(personItem(g, cam, { x: -Math.cos(a) * 0.28 + sway, z: -Math.sin(a) * 0.28 - 0.3, h: 1.82, body: '#5a6598', head: '#8a6f62' }, 0));

  // Phones held up in the crowd, plus the four angle phones
  const phones = [];
  for (const p of people) {
    if (!p.phone) continue;
    const d = Math.hypot(p.x, p.z + 0.3) || 1;
    phones.push({ x: p.x - (p.x / d) * 0.28, y: p.h + 0.12 + bob(p.phase), z: p.z - ((p.z + 0.3) / d) * 0.28, color: '#dfe8ff' });
  }
  ANGLES.forEach((c, k) => {
    if (k === idx) return;
    phones.push({ x: c.pos[0], y: c.pos[1], z: c.pos[2], color: k === live ? '#e8352b' : c.color, big: true });
  });
  for (const ph of phones) {
    const q = proj(cam, ph.x, ph.y, ph.z);
    if (q) items.push({ z: q.z, draw: () => drawPhone(g, q, ph) });
  }

  // Bulbs
  for (const s of STRANDS) {
    for (let k = 0; k <= 32; k++) {
      const u = k / 32;
      const q = proj(cam, -8 + 16 * u, s.y - s.sag * (1 - (2 * u - 1) ** 2) - 0.08, s.z);
      if (!q) continue;
      const tw = o.still ? 1 : 0.75 + 0.25 * Math.sin(t * 3 + k * 1.9 + s.z);
      items.push({
        z: q.z,
        draw: () => {
          const r = Math.max(1.2, q.s * 0.045);
          g.globalAlpha = 0.22 * tw;
          g.fillStyle = '#ffd27a';
          g.beginPath(); g.arc(q.x, q.y, r * 3.2, 0, TAU); g.fill();
          g.globalAlpha = tw;
          g.fillStyle = '#fff1c9';
          g.beginPath(); g.arc(q.x, q.y, r, 0, TAU); g.fill();
          g.globalAlpha = 1;
        },
      });
    }
  }

  // Confetti
  for (const c of confetti) {
    const y = o.still ? c.y : ((c.y - t * c.vy) % 5.5 + 5.5) % 5.5;
    const x = c.x + (o.still ? 0 : Math.sin(t * 0.8 + c.spin) * 0.25);
    const q = proj(cam, x, y + 0.3, c.z);
    if (!q) continue;
    items.push({
      z: q.z,
      draw: () => {
        const s = Math.max(1, q.s * 0.05);
        const flip = Math.abs(Math.cos(t * c.vs + c.spin));
        g.globalAlpha = fog(q.z);
        g.fillStyle = c.c;
        g.fillRect(q.x - (s * flip) / 2, q.y - s * 0.35, s * flip + 0.5, s * 0.7);
        g.globalAlpha = 1;
      },
    });
  }

  // The beacon on its stand
  const bc = proj(cam, BEACON.x, BEACON.y, BEACON.z);
  if (bc) items.push({ z: bc.z, draw: () => drawBeacon(g, cam, t) });

  items.sort((p, q) => q.z - p.z);
  for (const it of items) it.draw();

  // The mesh: faint sync threads from every phone to the beacon, pulsing green.
  if (bc) {
    const wave = o.still ? -1 : (t % 5) / 1.4;
    for (const ph of phones) {
      const q = proj(cam, ph.x, ph.y, ph.z);
      if (!q) continue;
      const d = Math.hypot(ph.x - BEACON.x, ph.z - BEACON.z) / 12;
      const hot = wave >= 0 && Math.abs(wave - d) < 0.12;
      g.globalAlpha = hot ? 0.55 : 0.07;
      g.strokeStyle = hot ? '#22a95b' : '#b9bfd6';
      g.lineWidth = Math.max(1, W / 1100) * (hot ? 1.6 : 1);
      g.beginPath();
      g.moveTo(q.x, q.y);
      g.lineTo(bc.x, bc.y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }
}

function personItem(g, cam, p, lift) {
  const foot = proj(cam, p.x, lift, p.z);
  const shoulder = proj(cam, p.x, p.h - 0.28 + lift, p.z);
  const head = proj(cam, p.x, p.h - 0.1 + lift, p.z);
  const parts = { foot, shoulder, head, p };
  return { z: foot ? foot.z : -1, draw: () => drawPerson(g, parts) };
}

// Person drawing lives outside personItem so the closure stays cheap.
function drawPerson(g, { foot, shoulder, head, p }) {
  if (!foot || !shoulder || !head) return;
  const alpha = fog(foot.z);
  const w = 0.44 * (p.wide || 1) * shoulder.s;
  g.globalAlpha = alpha;
  g.strokeStyle = p.body;
  g.lineCap = 'round';
  g.lineWidth = Math.max(1.5, w);
  g.beginPath();
  g.moveTo(foot.x, foot.y - w / 2);
  g.lineTo(shoulder.x, shoulder.y + w / 2);
  g.stroke();
  g.fillStyle = p.head;
  g.beginPath();
  g.arc(head.x, head.y, Math.max(1.2, 0.12 * head.s), 0, TAU);
  g.fill();
  g.globalAlpha = 1;
}

function drawPhone(g, q, ph) {
  const w = Math.max(2, q.s * (ph.big ? 0.09 : 0.07));
  const h = w * 1.8;
  g.globalAlpha = fog(q.z) * 0.35;
  g.fillStyle = ph.color;
  g.fillRect(q.x - w * 1.1, q.y - h * 0.8, w * 2.2, h * 1.6);
  g.globalAlpha = fog(q.z);
  g.fillRect(q.x - w / 2, q.y - h / 2, w, h);
  if (w > 5) {
    g.fillStyle = '#e8352b';
    g.beginPath();
    g.arc(q.x, q.y - h / 2 - w * 0.35, w * 0.16, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawBeacon(g, cam, t) {
  const { x, y, z, w } = BEACON;
  // stand
  const top = proj(cam, x, y - w / 2, z + 0.05);
  const base = proj(cam, x, 0, z + 0.05);
  if (top && base) {
    g.strokeStyle = '#2a3150';
    g.lineWidth = Math.max(1, 0.06 * base.s);
    g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(base.x, base.y); g.stroke();
  }
  const frame = polygon(cam, [[x - w / 2 - 0.08, y + w / 2 + 0.08, z], [x + w / 2 + 0.08, y + w / 2 + 0.08, z], [x + w / 2 + 0.08, y - w / 2 - 0.08, z], [x - w / 2 - 0.08, y - w / 2 - 0.08, z]]);
  fillPoly(g, frame, '#22a95b');
  const face = polygon(cam, [[x - w / 2, y + w / 2, z + 0.01], [x + w / 2, y + w / 2, z + 0.01], [x + w / 2, y - w / 2, z + 0.01], [x - w / 2, y - w / 2, z + 0.01]]);
  fillPoly(g, face, '#ffffff');
  const size = face ? Math.abs(face[1].x - face[0].x) : 0;
  if (size < 14) return;
  const { n, cells } = qrCells;
  const cell = (w * 0.86) / n;
  const x0 = x - (w * 0.86) / 2;
  const y0 = y + (w * 0.86) / 2;
  for (const [r, c] of cells) {
    const px = x0 + c * cell, py = y0 - r * cell;
    fillPoly(g, polygon(cam, [[px, py, z + 0.02], [px + cell, py, z + 0.02], [px + cell, py - cell, z + 0.02], [px, py - cell, z + 0.02]]), '#1a2038');
  }
}

/** Re-randomize the beacon's code (the page calls this ~15×/s, like the real beacon). */
export function tickBeacon() {
  qrCells = randomQR();
}

// small vector helpers
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

