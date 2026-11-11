// The campfire scene, rendered at native pixel-art resolution and scaled up
// with nearest-neighbour filtering by CSS. Sprites are traced from the
// provided art (see tools/build_sprites.py).

const NATIVE_W = 84; // native pixels across the screen: the campsite is zoomed in on the fire
const FOREST_W = 128;
const FRAME_W = 40;
const FRAME_H = 50;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

export async function loadSprites(base = './assets/sprites/') {
  const names = ['forest_night', 'flames', 'logs', 'embers', 'ashpile', 'charred'];
  const imgs = await Promise.all(names.map((n) => loadImage(`${base}${n}.png`)));
  return Object.fromEntries(names.map((n, i) => [n, imgs[i]]));
}

const rand = (a, b) => a + Math.random() * (b - a);
// On average the eyes appear once per this many seconds spent looking at the fire.
const EYES_EVERY_SECONDS = 600;

// ---------------------------------------------------------------- fire-ring stones

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// dark → light; a few different kinds of stone so the ring isn't uniform
const STONE_PALETTES = [
  ['#151311', '#262320', '#3a3632', '#55504a', '#746d65', '#958c82'], // warm grey
  ['#121316', '#212328', '#33363c', '#4c5057', '#6a6f77', '#8a9098'], // blue-grey granite
  ['#16120e', '#28201a', '#3d3229', '#574839', '#74624e', '#927e66'], // brown sandstone
  ['#0f0f0f', '#1d1d1c', '#2e2d2b', '#444240', '#5f5c58', '#7c7873'], // dark basalt
];
const MOSS = ['#1f2a14', '#2e3d1c', '#3f5226'];

function makeStone(rng, w, h, side, back) {
  const pal = STONE_PALETTES[Math.floor(rng() * STONE_PALETTES.length)];
  const cx = w / 2 + (rng() - 0.5) * 0.8;
  const rx = w / 2; const ry = h * 0.58;
  const cy = h - ry * 0.82; // the stone sits partly sunk into the ground
  const tilt = (rng() - 0.5) * 0.7; // leaning one way or the other
  const f1 = rng() * 6; const f2 = rng() * 6; const lump = 0.12 + rng() * 0.12;
  const inside = (x, y) => {
    const dx = (x + 0.5 - cx) / rx;
    const dy = (y + 0.5 - cy) / ry + dx * tilt;
    if (y >= h) return false;
    const a = Math.atan2(dy, dx);
    const r = 1 + lump * Math.sin(a * 3 + f1) + lump * 0.7 * Math.sin(a * 5 + f2);
    return dx * dx + dy * dy <= r * r;
  };
  const isIn = new Set();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) isIn.add(`${x},${y}`);
  const has = (x, y) => isIn.has(`${x},${y}`);

  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const rim = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!has(x, y)) continue;
      const nx = (x + 0.5 - cx) / rx; const ny = (y + 0.5 - cy) / ry + nx * tilt;
      const top = !has(x, y - 1);
      const left = !has(x - 1, y); const right = !has(x + 1, y);
      const bottom = !has(x, y + 1) && y < h - 1;
      let light = 2.9 - ny * 1.7 - nx * 0.9 + (rng() - 0.5) * 0.8;
      if (top) light += 0.5;
      let col;
      if ((left || right || bottom) && !top) col = pal[0]; // dark outline down the sides
      else if (y === h - 1 && !top) col = pal[1]; // where it meets the ground
      else {
        col = pal[Math.max(1, Math.min(5, Math.round(light)))];
        if (rng() < 0.1) col = pal[Math.max(1, Math.min(5, Math.round(light) + (rng() < 0.6 ? -2 : 1)))]; // speckles
      }
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
      // which faces turn toward the fire (it is to the stone's `-side`, and behind it for front stones)
      const facing = side > 0 ? left || nx < -0.35 : right || nx > 0.35;
      if (back) {
        if (!top && ny > -0.2) rim.push([x, y, facing ? 0.55 : 0.3]);
      } else if (top) {
        rim.push([x, y, facing ? 0.6 : 0.32]);
      } else if (facing && (left || right)) {
        rim.push([x, y, 0.4]);
      }
    }
  }
  // a hairline crack on some stones
  if (w >= 7 && rng() < 0.55) {
    let x = Math.floor(w * (0.3 + rng() * 0.4)); let y = 1;
    g.fillStyle = pal[1];
    for (let i = 0; i < Math.min(3, h - 2); i++) {
      if (has(x, y) && has(x - 1, y) && has(x + 1, y) && has(x, y + 1)) g.fillRect(x, y, 1, 1);
      y += 1; if (rng() < 0.5) x += rng() < 0.5 ? -1 : 1;
    }
  }
  // moss on the shaded side of a few
  if (rng() < 0.35) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!has(x, y) || has(x, y - 1)) continue;
        if ((x + 0.5 - cx) / rx > 0.15 && rng() < 0.75) {
          g.fillStyle = MOSS[Math.floor(rng() * MOSS.length)];
          g.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  return { img: c, rim };
}

/** A ring of irregular stones around the pit (fixed seed: the same ring every visit). */
function buildStones() {
  const rng = seeded(4411);
  const out = [];
  const count = 13;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.32;
    const front = Math.sin(a) > 0;
    // nearer (front) stones are larger; the back row is partly hidden behind the logs
    const depth = (Math.sin(a) + 1) / 2;
    const w = Math.round(6 + depth * 4 + rng() * 4);
    const h = Math.round(4 + depth * 2 + rng() * 3);
    const st = makeStone(rng, w, h, Math.cos(a) >= 0 ? 1 : -1, !front);
    out.push({
      ...st, w, h, back: !front,
      dx: Math.cos(a) * (22 + rng() * 2.5),
      dy: Math.sin(a) * 6.5 - 4 + h * 0.35 + (rng() - 0.5),
    });
  }
  // draw far stones first so nearer ones overlap them
  return out.sort((p, q) => p.dy - q.dy);
}

/** A red-flame copy of the flame sheet: each pixel is remapped by brightness onto a red ramp. */
function recolorFlames(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const ramp = [[110, 8, 16], [176, 16, 32], [224, 40, 40], [255, 84, 70], [255, 150, 130], [255, 214, 200]];
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const l = (0.3 * d.data[i] + 0.55 * d.data[i + 1] + 0.15 * d.data[i + 2]) / 255;
    const k = Math.max(0, Math.min(ramp.length - 1, Math.floor((l - 0.35) / 0.1)));
    [d.data[i], d.data[i + 1], d.data[i + 2]] = ramp[k];
  }
  g.putImageData(d, 0, 0);
  return c;
}

export class Scene {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = NATIVE_W;
    this.h = 180;
    this.fx = NATIVE_W / 2; // centre of the fire pit
    this.fb = 126; // bottom of the log sprite
    this.s = sprites;
    this.mode = 'burning'; // burning | dying | ash | cold | sifting
    this.intensity = 1; // 0..1 flame size target
    this.shown = 1; // eased flame size
    this.heat = 0.3; this.essence = 0; this.quality = 0.2;
    this.particles = [];
    this.drops = [];
    this.flare = 0;
    this.modeT = 0;
    this.frame = 0;
    this.frameT = 0;
    this.stars = Array.from({ length: 40 }, () => ({ x: Math.random(), y: Math.random(), p: rand(0, 6) }));
    this.layout();
    this.red = 0; // 0..1 eased mix toward red flames
    this.redTarget = 0;
    this.redFlames = recolorFlames(sprites.flames);
    this.stones = buildStones();
    this.eyes = null; // the rare watcher in the trees
    this.tmp = document.createElement('canvas');
    this.tmp.width = FRAME_W; this.tmp.height = FRAME_H;
    this.tctx = this.tmp.getContext('2d');
    this.last = performance.now();
    this.running = false;
    this.siftResolve = null;
  }

  /** Fit the native canvas to the element's aspect ratio (portrait fills the screen). */
  layout(insetPx = this.insetPx || 0) {
    this.insetPx = insetPx; // height of the controls overlaid on the bottom of the scene
    const r = this.canvas.getBoundingClientRect();
    const aspect = r.width > 0 ? r.height / r.width : 2;
    this.h = Math.max(110, Math.min(240, Math.round(NATIVE_W * aspect)));
    const scale = r.width > 0 ? r.width / NATIVE_W : 4.6;
    // sit the fire just above the controls, but never higher than mid-screen
    this.fb = Math.max(Math.round(this.h * 0.52), Math.min(Math.round(this.h * 0.74), this.h - Math.ceil(insetPx / scale) - 3));
    if (this.canvas.width !== this.w || this.canvas.height !== this.h) {
      this.canvas.width = this.w;
      this.canvas.height = this.h;
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      this.update(dt);
      this.draw(t / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame((t) => { this.last = t; loop(t); });
  }

  stop() { this.running = false; }

  /** Called by the UI every tick. */
  setFire({ status, intensity, heat, essence, quality, tint }) {
    if (tint !== undefined) this.redTarget = tint === 'red' ? 1 : 0;
    if (status === 'burning') {
      if (this.mode !== 'burning') { this.mode = 'burning'; this.shown = 0.2; }
    } else if (status === 'ash') {
      if (this.mode === 'burning') { this.mode = 'dying'; this.modeT = 0; }
      else if (this.mode !== 'dying' && this.mode !== 'sifting') this.mode = 'ash';
    } else if (status === 'cold') {
      if (this.mode !== 'sifting') this.mode = 'cold';
    }
    this.intensity = intensity ?? this.intensity;
    this.heat = heat ?? this.heat;
    this.essence = essence ?? this.essence;
    this.quality = quality ?? this.quality;
  }

  /** Visual feedback for adding materials. */
  stoke(icons = []) {
    this.flare = 1;
    icons.slice(0, 10).forEach((img, i) => {
      this.drops.push({ img, x: this.fx - 4 + rand(-10, 10), y: -10 - i * 7, vy: 30 + i * 2 });
    });
    for (let i = 0; i < 26; i++) this.spark(true);
  }

  /** Ash dispersal animation; resolves when the reveal should begin. */
  sift() {
    this.mode = 'sifting';
    this.modeT = 0;
    const greys = ['#5a5552', '#7d7772', '#a29b94', '#c9c2b8'];
    for (let i = 0; i < 140; i++) {
      const a = rand(Math.PI * 1.05, Math.PI * 1.95);
      const sp = rand(15, 70);
      this.particles.push({
        x: this.fx + rand(-12, 12), y: this.fb - rand(2, 10), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 38, life: rand(0.8, 1.8), age: 0, c: greys[i % 4], drag: 1.6,
      });
    }
    return new Promise((r) => { this.siftResolve = r; });
  }

  spark(burst = false) {
    const magic = Math.random() < this.essence * 0.7;
    const golden = !magic && Math.random() < this.quality * 0.4;
    let c = magic ? (Math.random() < 0.5 ? '#7ef0ff' : '#c48aff') : golden ? '#fff2a0' : (Math.random() < 0.5 ? '#ffb040' : '#ff7a2a');
    if (Math.random() < this.red) c = Math.random() < 0.5 ? '#ff3a2e' : '#ff8070';
    this.particles.push({
      x: this.fx + rand(-8, 8) * (0.6 + this.shown * 0.5), y: this.fb - 12 - rand(0, 18) * this.shown,
      vx: rand(-6, 6), vy: -rand(14, burst ? 60 : 34), g: -2, life: rand(0.6, burst ? 1.8 : 1.4), age: 0, c, drag: 0.4, twinkle: magic || golden,
    });
  }

  smoke() {
    this.particles.push({
      x: this.fx + rand(-6, 6), y: this.fb - 8, vx: rand(-3, 3), vy: -rand(5, 10), g: 0,
      life: rand(2, 3.5), age: 0, c: '#3a3634', drag: 0.1, smoke: true,
    });
  }

  update(dt) {
    this.modeT += dt;
    this.frameT += dt;
    const frameDur = 0.16 - this.shown * 0.04;
    if (this.frameT > frameDur) { this.frameT = 0; this.frame = (this.frame + 1) % 3; }

    this.red += (this.redTarget - this.red) * Math.min(1, dt * 1.5);
    const target = this.mode === 'burning' ? this.intensity : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * 2.5);
    this.flare = Math.max(0, this.flare - dt * 1.2);
    this.updateEyes(dt);

    if (this.mode === 'burning') {
      if (Math.random() < dt * (6 + this.heat * 14) * (0.4 + this.shown)) this.spark();
    } else if (this.mode === 'dying') {
      if (Math.random() < dt * 3) this.smoke();
      if (this.modeT > 4.2) { this.mode = 'ash'; this.modeT = 0; }
    } else if (this.mode === 'ash') {
      if (Math.random() < dt * 0.8) this.smoke();
    } else if (this.mode === 'sifting') {
      if (this.modeT > 1.1 && this.siftResolve) { const r = this.siftResolve; this.siftResolve = null; r(); }
    }

    for (const p of this.particles) {
      p.age += dt;
      p.vy += p.g * dt;
      p.vx *= 1 - p.drag * dt;
      p.vy *= 1 - p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.smoke) p.vx += Math.sin(p.age * 2 + p.x) * dt * 3;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    for (const d of this.drops) { d.vy += 140 * dt; d.y += d.vy * dt; }
    this.drops = this.drops.filter((d) => d.y < this.fb - 18);
  }

  draw(t) {
    const c = this.ctx;
    const W = this.w; const H = this.h;
    const forestY = this.fb - 80;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    // sky + ground backdrop
    const sky = c.createLinearGradient(0, 0, 0, this.fb);
    sky.addColorStop(0, '#04050a'); sky.addColorStop(0.5, '#0b0d18');
    sky.addColorStop(0.8, '#10140f'); sky.addColorStop(1, '#0a0806');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      const tw = (Math.sin(t * 1.3 + s.p) + 1) / 2;
      c.fillStyle = tw > 0.7 ? '#cfd6ff' : '#5a6080';
      c.fillRect(Math.floor(s.x * W), Math.floor(s.y * (forestY + 26)), 1, 1);
    }
    c.drawImage(this.s.forest_night, Math.round((W - FOREST_W) / 2), forestY);
    // ground in front of the forest
    const gy = this.fb - 26;
    const ground = c.createLinearGradient(0, gy, 0, gy + 34);
    ground.addColorStop(0, 'rgba(18,14,10,0)'); ground.addColorStop(0.5, '#15100c'); ground.addColorStop(1, '#0a0705');
    c.fillStyle = ground;
    c.fillRect(0, gy, W, H - gy);

    // firelight
    const flick = 0.92 + Math.sin(t * 11) * 0.03 + Math.sin(t * 17.3) * 0.03 + Math.random() * 0.03;
    let light = 0;
    if (this.mode === 'burning') light = (0.35 + this.shown * 0.65) * flick + this.flare * 0.25;
    else if (this.mode === 'dying') light = Math.max(0, 0.45 * (1 - this.modeT / 4.2)) * flick;
    else if (this.mode === 'ash' || this.mode === 'sifting') light = 0.06;
    if (light > 0) {
      const r = 40 + 50 * light * (0.7 + this.heat * 0.6);
      const gl = c.createRadialGradient(this.fx, this.fb - 14, 2, this.fx, this.fb - 14, r);
      const mag = this.essence;
      let col = mag > 0.35 ? [255 - mag * 120, 150 + mag * 40, 80 + mag * 150] : [255, 150, 60];
      col = col.map((v, i) => Math.round(v + ([255, 46, 36][i] - v) * this.red)).join(',');
      gl.addColorStop(0, `rgba(${col},${0.55 * light})`);
      gl.addColorStop(0.4, `rgba(${col},${0.22 * light})`);
      gl.addColorStop(1, `rgba(${col},0)`);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = gl;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }

    this.drawStones(c, true);

    const lx = this.fx - FRAME_W / 2;
    const ly = this.fb - FRAME_H;
    if (this.mode === 'burning') {
      c.drawImage(this.s.logs, lx, ly);
      this.drawFlame(c, lx, ly);
    } else if (this.mode === 'dying') {
      const k = Math.min(1, this.modeT / 4.2);
      c.drawImage(this.s.logs, lx, ly);
      c.globalAlpha = 1 - Math.max(0, (k - 0.55) / 0.45);
      c.drawImage(this.s.embers, lx, ly);
      c.globalAlpha = Math.max(0, (k - 0.55) / 0.45);
      c.drawImage(this.s.ashpile, lx, ly);
      c.globalAlpha = 1;
    } else if (this.mode === 'ash') {
      c.drawImage(this.s.ashpile, lx, ly);
      if (Math.sin(t * 2) > 0.6) { c.fillStyle = '#ff6a30'; c.fillRect(this.fx - 3, this.fb - 8, 1, 1); }
    } else if (this.mode === 'sifting') {
      c.globalAlpha = Math.max(0, 1 - this.modeT * 1.3);
      c.drawImage(this.s.ashpile, lx, ly);
      c.globalAlpha = 1;
      c.globalAlpha = Math.min(1, this.modeT * 1.3);
      c.drawImage(this.s.charred, lx, ly);
      c.globalAlpha = 1;
    } else {
      c.drawImage(this.s.charred, lx, ly);
    }

    this.drawStones(c, false);

    for (const d of this.drops) c.drawImage(d.img, Math.round(d.x), Math.round(d.y), 8, 8);

    for (const p of this.particles) {
      const a = 1 - p.age / p.life;
      if (p.smoke) {
        c.globalAlpha = a * 0.35;
        c.fillStyle = p.c;
        c.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      } else {
        if (p.twinkle && Math.sin(p.age * 30) < -0.3) continue;
        c.globalAlpha = Math.min(1, a * 1.4);
        c.fillStyle = p.c;
        c.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
    c.globalAlpha = 1;

    // vignette
    const v = c.createRadialGradient(this.fx, this.fb - 20, 30, this.fx, this.fb - 30, Math.max(100, H * 0.7));
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);

    this.drawEyes(c);
  }

  // ------------------------------------------------------------ the watcher
  // Very rarely, a pair of ghostly blue-green eyes shines out of the dark trees to one side
  // of the fire, blinks once or twice, and is gone.

  updateEyes(dt) {
    if (!this.eyes) {
      if (this.mode !== 'sifting' && Math.random() < dt / EYES_EVERY_SECONDS) this.showEyes();
      return;
    }
    this.eyes.t += dt;
    if (this.eyes.t >= this.eyes.dur) this.eyes = null;
  }

  showEyes() {
    const left = Math.random() < 0.5;
    const x = left ? rand(5, this.fx - 25) : rand(this.fx + 22, this.w - 8);
    const y = this.fb - 26 - rand(0, 22);
    const dur = rand(4, 7);
    const blinks = [rand(1.2, dur * 0.45)];
    if (Math.random() < 0.6) blinks.push(rand(dur * 0.55, dur - 1.2));
    this.eyes = { x: Math.round(x), y: Math.round(y), gap: Math.random() < 0.5 ? 3 : 4, t: 0, dur, blinks };
  }

  drawEyes(c) {
    const e = this.eyes;
    if (!e) return;
    if (e.blinks.some((b) => e.t > b && e.t < b + 0.14)) return; // eyelids closed
    const a = Math.min(1, e.t / 0.9, (e.dur - e.t) / 0.7);
    if (a <= 0) return;
    // ghostly blue-green, with a slow shimmer
    const shimmer = 0.85 + 0.15 * Math.sin(e.t * 5.3);
    for (const ex of [e.x, e.x + e.gap]) {
      c.globalAlpha = a * 0.14 * shimmer;
      c.fillStyle = '#3fe0d0';
      c.fillRect(ex - 1, e.y - 1, 3, 3);
      c.globalAlpha = a * 0.34 * shimmer;
      c.fillStyle = '#4ff0d8';
      c.fillRect(ex - 1, e.y, 3, 1);
      c.fillRect(ex, e.y - 1, 1, 3);
      c.globalAlpha = a * shimmer;
      c.fillStyle = '#c8fff2';
      c.fillRect(ex, e.y, 1, 1);
    }
    c.globalAlpha = 1;
  }

  drawFlame(c, lx, ly) {
    const k = Math.max(0.12, this.shown + this.flare * 0.25);
    const tc = this.tctx;
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, FRAME_W, FRAME_H);
    tc.drawImage(this.s.flames, this.frame * FRAME_W, 0, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
    if (this.red > 0.001) {
      tc.globalAlpha = this.red;
      tc.drawImage(this.redFlames, this.frame * FRAME_W, 0, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
      tc.globalAlpha = 1;
    }
    // fire colour responds to its characteristics
    tc.globalCompositeOperation = 'source-atop';
    if (this.essence > 0.12 && this.red < 0.5) {
      tc.globalAlpha = Math.min(0.55, this.essence * 0.6);
      tc.fillStyle = '#58d8ff';
      tc.fillRect(0, 0, FRAME_W, FRAME_H * 0.7);
    }
    if (this.heat > 0.5) {
      tc.globalAlpha = Math.min(0.35, (this.heat - 0.5) * 0.6);
      tc.fillStyle = '#fff6d0';
      tc.fillRect(0, FRAME_H * 0.45, FRAME_W, FRAME_H);
    }
    tc.globalAlpha = 1;
    const dw = Math.round(FRAME_W * (0.55 + 0.45 * k));
    const dh = Math.round(FRAME_H * k);
    c.drawImage(this.tmp, Math.round(this.fx - dw / 2), ly + FRAME_H - dh + Math.round(4 * (1 - k)), dw, dh);
  }

  drawStones(c, back) {
    const burning = this.mode === 'burning';
    const glow = burning ? 0.45 + this.shown * 0.4 + this.flare * 0.2 : this.mode === 'dying' ? 0.25 * Math.max(0, 1 - this.modeT / 4.2) : 0;
    const warm = [255, 150 - 100 * this.red, 70 - 30 * this.red].map(Math.round).join(',');
    for (const st of this.stones) {
      if (st.back !== back) continue;
      const x = Math.round(this.fx + st.dx - st.w / 2);
      const y = Math.round(this.fb + st.dy - st.h);
      // contact shadow
      c.globalAlpha = 0.55;
      c.fillStyle = '#050403';
      c.fillRect(x, y + st.h - 1, st.w, 2);
      c.fillRect(x + 1, y + st.h + 1, st.w - 2, 1);
      c.globalAlpha = 1;
      c.drawImage(st.img, x, y);
      // faces turned toward the fire catch its light
      if (glow > 0) {
        c.fillStyle = `rgb(${warm})`;
        for (const [px, py, k] of st.rim) {
          c.globalAlpha = Math.min(0.5, glow * k * 0.75);
          c.fillRect(x + px, y + py, 1, 1);
        }
        c.globalAlpha = 1;
      }
    }
  }
}
