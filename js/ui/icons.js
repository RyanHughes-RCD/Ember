// 16×16 pixel-art icons drawn from tiny shape programs + a 5-colour palette
// (1 outline, 2 dark, 3 mid, 4 light, 5 highlight/accent). Light comes from the
// top-left, matching the campfire sprites. Shapes are auto-outlined.

const N = 16;
const cache = new Map();

function grid() {
  return Array.from({ length: N }, () => new Array(N).fill(0));
}

function shadeAt(nx, ny) {
  const l = -(nx * 0.62 + ny * 0.78);
  if (l > 0.5) return 5;
  if (l > 0.12) return 4;
  if (l > -0.38) return 3;
  return 2;
}

const P = {
  set(g, x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = c;
  },
  ellipse(g, cx, cy, rx, ry, c = null, rot = 0) {
    const cs = Math.cos(rot); const sn = Math.sin(rot);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x + 0.5 - cx; const dy = y + 0.5 - cy;
        const u = (dx * cs + dy * sn) / rx; const v = (-dx * sn + dy * cs) / ry;
        if (u * u + v * v <= 1) g[y][x] = c ?? shadeAt(dx / rx, dy / ry);
      }
    }
  },
  rect(g, x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) P.set(g, x, y, typeof c === 'function' ? c(x, y) : c);
  },
  line(g, x0, y0, x1, y1, c, t = 1) {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps; const y = y0 + ((y1 - y0) * i) / steps;
      for (let a = 0; a < t; a++) for (let b = 0; b < t; b++) P.set(g, x + a, y + b, c);
    }
  },
  poly(g, pts, shaded = true, c = 3) {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const px = x + 0.5; const py = y + 0.5;
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i]; const [xj, yj] = pts[j];
          if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) g[y][x] = shaded ? shadeAt((px - cx) / 6, (py - cy) / 6) : c;
      }
    }
  },
  outline(g) {
    const out = g.map((r) => r.slice());
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (g[y][x]) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[y + dy]?.[x + dx] > 1);
        if (n) out[y][x] = 1;
      }
    }
    return out;
  },
};

const SHAPES = {
  log(g) {
    P.rect(g, 5, 4, 14, 11, (x, y) => (y <= 5 ? 4 : y <= 8 ? 3 : 2));
    P.set(g, 8, 6, 4); P.set(g, 11, 9, 4); P.set(g, 12, 6, 2); P.set(g, 9, 10, 3); P.set(g, 13, 8, 2);
    P.ellipse(g, 4.5, 8, 3.2, 4.2, 4);
    P.ellipse(g, 4.5, 8, 2.1, 2.9, 2);
    P.ellipse(g, 4.5, 8, 1.1, 1.5, 5);
  },
  twigs(g) {
    P.line(g, 2, 12, 13, 3, 3); P.line(g, 3, 13, 14, 4, 2);
    P.line(g, 2, 7, 12, 13, 3); P.line(g, 7, 2, 8, 13, 4);
    P.line(g, 9, 6, 11, 2, 3); P.set(g, 4, 10, 5); P.set(g, 7, 6, 5);
  },
  leaf(g) {
    P.ellipse(g, 8, 7.5, 6.8, 4.2, null, -Math.PI / 4);
    P.line(g, 3, 13, 12, 4, 2);
    P.line(g, 1, 15, 3, 13, 2);
    P.set(g, 6, 8, 2); P.set(g, 7, 6, 2); P.set(g, 9, 8, 2); P.set(g, 8, 5, 5);
  },
  flower(g) {
    P.line(g, 8, 9, 8, 15, 2);
    P.line(g, 8, 13, 11, 11, 2);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      P.ellipse(g, 8 + Math.cos(a) * 3.4, 6.5 + Math.sin(a) * 3.4, 2.3, 2.3);
    }
    P.ellipse(g, 8, 6.5, 1.6, 1.6, 5);
  },
  herb(g) {
    P.line(g, 5, 14, 9, 3, 2); P.line(g, 7, 14, 8, 4, 2); P.line(g, 9, 14, 12, 4, 2);
    for (const [x, y] of [[6, 5], [10, 5], [7, 8], [11, 7], [5, 9], [9, 10], [12, 4], [8, 3]]) {
      P.ellipse(g, x + 0.5, y + 0.5, 1.8, 1.1, null, 0.5);
    }
    P.rect(g, 5, 11, 10, 12, 5);
  },
  mushroom(g) {
    P.rect(g, 6, 9, 9, 14, (x) => (x <= 6 ? 5 : x <= 8 ? 4 : 3));
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - 8) / 6.8; const dy = (y + 0.5 - 9) / 6;
        if (dy <= 0 && dx * dx + dy * dy <= 1) g[y][x] = shadeAt(dx, dy * 1.2 + 0.25);
      }
    }
    P.rect(g, 2, 9, 13, 9, 2);
    P.set(g, 5, 5, 5); P.set(g, 6, 5, 5); P.set(g, 10, 6, 5); P.set(g, 8, 4, 5); P.set(g, 4, 7, 5);
  },
  lump(g) {
    P.ellipse(g, 6.5, 9.5, 4.2, 3.6);
    P.ellipse(g, 10, 8.5, 4, 4);
    P.ellipse(g, 8, 11, 5, 3);
    P.set(g, 6, 7, 5); P.set(g, 10, 6, 5); P.set(g, 9, 11, 2);
  },
  gem(g) {
    P.poly(g, [[8, 1.5], [14, 6], [12, 14], [4, 14], [2, 6]]);
    P.line(g, 5, 6, 11, 6, 4); P.line(g, 8, 2, 5, 6, 5); P.line(g, 8, 6, 8, 13, 3);
    P.set(g, 5, 4, 5); P.set(g, 6, 3, 5);
  },
  pile(g) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5 - 8) / 7; const dy = (y + 0.5 - 13) / 7.5;
        if (dy <= 0.15 && dx * dx + dy * dy <= 1) g[y][x] = shadeAt(dx, dy + 0.3);
      }
    }
    for (const [x, y] of [[5, 10], [9, 8], [11, 11], [7, 12], [8, 9]]) P.set(g, x, y, (x + y) % 2 ? 5 : 2);
  },
  spores(g) {
    for (const [x, y, r] of [[5, 5, 1.6], [10, 4, 1.3], [8, 9, 2.2], [4, 11, 1.3], [12, 10, 1.6], [11, 14, 1], [3, 7, 0.8], [13, 6, 0.8]]) {
      P.ellipse(g, x + 0.5, y + 0.5, r, r);
    }
    P.set(g, 8, 8, 5); P.set(g, 5, 4, 5);
  },
  seed(g) {
    P.ellipse(g, 8, 9.5, 4.2, 5);
    P.rect(g, 4, 4, 12, 6, (x) => (x < 7 ? 4 : x < 10 ? 3 : 2));
    P.line(g, 8, 1, 8, 4, 2);
    P.set(g, 6, 9, 5); P.set(g, 6, 10, 5);
  },
  drop(g) {
    P.ellipse(g, 8, 10, 4.5, 4.5);
    P.poly(g, [[8, 1.5], [12.2, 9], [3.8, 9]]);
    P.set(g, 6, 8, 5); P.set(g, 6, 9, 5); P.set(g, 7, 6, 4);
  },
  bottle(g) {
    P.ellipse(g, 8, 10.5, 5, 4.5);
    P.rect(g, 6, 3, 9, 6, (x) => (x === 6 ? 4 : 3));
    P.rect(g, 5, 1, 10, 2, 2);
    P.set(g, 5, 9, 5); P.set(g, 6, 8, 5);
  },
  nail(g) {
    P.line(g, 4, 3, 12, 13, 3, 2);
    P.line(g, 4, 3, 12, 13, 4);
    P.rect(g, 1, 3, 6, 4, (x) => (x < 3 ? 4 : 3));
    P.set(g, 13, 14, 2);
  },
  scroll(g) {
    P.rect(g, 3, 4, 12, 11, (x, y) => (y < 6 ? 4 : y < 9 ? 3 : 2));
    P.ellipse(g, 3.5, 7.5, 2, 4.2, 4); P.ellipse(g, 3.5, 7.5, 1, 2.6, 2);
    P.ellipse(g, 12.5, 7.5, 2, 4.2, 3);
    P.line(g, 5, 6, 10, 6, 2); P.line(g, 5, 8, 9, 8, 2);
  },
  clover(g) {
    P.line(g, 8, 8, 10, 15, 2);
    for (const [x, y] of [[5.5, 5.5], [10.5, 5.5], [5.5, 10], [10.5, 10]]) P.ellipse(g, x, y, 2.8, 2.8);
    P.set(g, 8, 8, 5);
  },
  bead(g) {
    P.ellipse(g, 8, 8, 6, 6);
    P.ellipse(g, 8, 8, 1.6, 1.6, 1);
    P.set(g, 5, 4, 5); P.set(g, 4, 5, 5);
  },
  charm(g) {
    P.ellipse(g, 8, 6, 4.5, 4.5);
    P.ellipse(g, 8, 6, 2.2, 2.2, 0);
    P.line(g, 6, 10, 5, 15, 2); P.line(g, 8, 10, 8, 15, 3); P.line(g, 10, 10, 11, 15, 2);
    P.set(g, 12, 1, 5); P.set(g, 13, 0, 5); P.set(g, 14, 2, 5);
  },
  ring(g) {
    P.ellipse(g, 8, 8, 6.5, 6.5);
    P.ellipse(g, 8, 8, 3, 3, 0);
    P.set(g, 4, 5, 5); P.set(g, 5, 4, 5);
  },
  shard(g) {
    P.poly(g, [[9, 0.5], [13, 6], [9.5, 15.5], [4, 10], [5.5, 4]]);
    P.line(g, 9, 1, 8, 14, 4);
    P.set(g, 7, 4, 5); P.set(g, 7, 5, 5);
  },
  coin(g) {
    P.ellipse(g, 8, 8, 6.5, 6.5);
    P.ellipse(g, 8, 8, 4.4, 4.4, 3);
    P.rect(g, 7, 5, 8, 10, 2); P.rect(g, 6, 6, 9, 6, 2);
    P.set(g, 4, 5, 5); P.set(g, 5, 4, 5);
  },
  core(g) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
        if (d <= 6) g[y][x] = d < 1.8 ? 5 : d < 3.4 ? 4 : d < 5 ? 3 : 2;
      }
    }
    P.set(g, 8, 1, 4); P.set(g, 14, 8, 4); P.set(g, 1, 8, 4); P.set(g, 8, 14, 4);
  },
  insect(g) {
    SHAPES.gem(g);
    P.ellipse(g, 8, 9, 1.6, 2.4, 5);
    P.line(g, 6, 7, 10, 11, 5); P.line(g, 10, 7, 6, 11, 5); P.set(g, 8, 6, 5);
  },
  star(g) {
    P.poly(g, [[8, 0.5], [10, 6], [15.5, 8], [10, 10], [8, 15.5], [6, 10], [0.5, 8], [6, 6]]);
    P.ellipse(g, 8, 8, 1.4, 1.4, 5);
  },
  relic(g) {
    P.line(g, 3, 1, 8, 6, 2); P.line(g, 13, 1, 8, 6, 2);
    P.ellipse(g, 8, 10, 5, 5);
    P.ellipse(g, 8, 10, 2.4, 2.4, 5);
    P.set(g, 6, 7, 4); P.set(g, 5, 8, 4);
  },
  thread(g) {
    for (let x = 1; x < 15; x++) {
      const y = 8 + Math.sin(x * 0.9) * 3.5;
      P.set(g, x, y, x % 3 ? 4 : 3); P.set(g, x, y + 1, 2);
    }
    P.set(g, 13, 4, 5); P.set(g, 3, 12, 5);
  },
  // ---- UI-only shapes
  flame(g) {
    P.poly(g, [[8, 0.5], [12.5, 7], [13, 11], [10.5, 14.5], [5.5, 14.5], [3, 11], [4, 6], [6, 8]]);
    P.ellipse(g, 8, 11, 2.5, 3, 5);
  },
  slots(g) {
    for (const [x, y] of [[2, 3], [9, 3], [2, 9], [9, 9]]) P.rect(g, x, y, x + 4, y + 4, (px, py) => (py === y ? 4 : px === x ? 4 : 3));
    P.rect(g, 10, 10, 12, 12, 5);
  },
  sieve(g) {
    P.ellipse(g, 8, 8, 6.5, 6.5);
    for (let y = 4; y <= 12; y += 2) for (let x = 4; x <= 12; x += 2) if (Math.hypot(x - 8, y - 8) < 4.6) P.set(g, x, y, 1);
  },
  bellows(g) {
    P.poly(g, [[1.5, 4], [11, 6.5], [11, 10.5], [1.5, 13]]);
    P.rect(g, 11, 7, 15, 10, (x) => (x < 13 ? 3 : 2));
    P.line(g, 3, 6, 3, 11, 5);
  },
  book(g) {
    P.rect(g, 3, 2, 13, 14, (x, y) => (x === 3 ? 2 : y < 5 ? 4 : 3));
    P.rect(g, 5, 4, 11, 4, 5); P.rect(g, 6, 7, 10, 7, 2); P.rect(g, 6, 9, 10, 9, 2);
  },
  hand(g) {
    P.rect(g, 4, 7, 12, 13, (x, y) => (y < 9 ? 4 : 3));
    for (const x of [4, 6, 8, 10]) P.rect(g, x, 3 + (x === 6 || x === 8 ? -1 : 1), x + 1, 7, (px) => (px === x ? 4 : 3));
    P.rect(g, 12, 6, 13, 10, 3);
  },
  basket(g) {
    P.rect(g, 2, 8, 13, 13, (x, y) => ((x + y) % 2 ? 3 : 2));
    P.rect(g, 1, 7, 14, 8, 4);
    P.line(g, 4, 7, 6, 3, 2); P.line(g, 6, 3, 10, 3, 2); P.line(g, 10, 3, 12, 7, 2);
    P.set(g, 5, 6, 5); P.set(g, 9, 5, 5);
  },
};

const UI_PALETTE = ['#1a0c06', '#6a2e10', '#c0602a', '#f0a040', '#ffe6a0'];

function render(shape, palette, silhouette) {
  const g = grid();
  (SHAPES[shape] || SHAPES.lump)(g, P);
  const out = P.outline(g);
  const canvas = document.createElement('canvas');
  canvas.width = N; canvas.height = N;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = out[y][x];
      if (!c) continue;
      ctx.fillStyle = silhouette ? (c === 1 ? '#4a3f37' : '#1d1815') : palette[c - 1];
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL();
}

/** Data URL for an item's icon. `def.icon = { shape, palette }`. */
export function iconUrl(def, { silhouette = false } = {}) {
  const icon = def.icon || { shape: 'lump', palette: UI_PALETTE };
  const key = `${icon.shape}|${icon.palette.join(',')}|${silhouette}`;
  if (!cache.has(key)) cache.set(key, render(icon.shape, icon.palette, silhouette));
  return cache.get(key);
}

export function uiIconUrl(shape, palette = UI_PALETTE) {
  return iconUrl({ icon: { shape, palette } });
}

export function iconImg(def, opts = {}) {
  const img = document.createElement('img');
  img.className = `px-icon ${opts.className || ''}`;
  img.src = iconUrl(def, opts);
  img.alt = opts.silhouette ? 'Undiscovered' : def.name || '';
  img.draggable = false;
  return img;
}

export const ICON_SHAPES = Object.keys(SHAPES);
