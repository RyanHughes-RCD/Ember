// The campfire scene, rendered at native pixel-art resolution and scaled up
// with nearest-neighbour filtering by CSS. Sprites are traced from the
// provided art (see tools/build_sprites.py).

const W = 128;
const H = 112;
const FIRE_X = 64; // centre of the fire pit
const FIRE_BASE = 104; // bottom of the log sprite
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

export class Scene {
  constructor(canvas, sprites) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
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
    this.stars = Array.from({ length: 26 }, () => ({ x: Math.floor(rand(0, W)), y: Math.floor(rand(0, 18)), p: rand(0, 6) }));
    this.tmp = document.createElement('canvas');
    this.tmp.width = FRAME_W; this.tmp.height = FRAME_H;
    this.tctx = this.tmp.getContext('2d');
    this.last = performance.now();
    this.running = false;
    this.siftResolve = null;
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
  setFire({ status, intensity, heat, essence, quality }) {
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
      this.drops.push({ img, x: FIRE_X - 4 + rand(-10, 10), y: -10 - i * 7, vy: 30 + i * 2 });
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
        x: FIRE_X + rand(-12, 12), y: FIRE_BASE - rand(2, 10), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        g: 38, life: rand(0.8, 1.8), age: 0, c: greys[i % 4], drag: 1.6,
      });
    }
    return new Promise((r) => { this.siftResolve = r; });
  }

  spark(burst = false) {
    const magic = Math.random() < this.essence * 0.7;
    const golden = !magic && Math.random() < this.quality * 0.4;
    const c = magic ? (Math.random() < 0.5 ? '#7ef0ff' : '#c48aff') : golden ? '#fff2a0' : (Math.random() < 0.5 ? '#ffb040' : '#ff7a2a');
    this.particles.push({
      x: FIRE_X + rand(-8, 8) * (0.6 + this.shown * 0.5), y: FIRE_BASE - 12 - rand(0, 18) * this.shown,
      vx: rand(-6, 6), vy: -rand(14, burst ? 60 : 34), g: -2, life: rand(0.6, burst ? 1.8 : 1.4), age: 0, c, drag: 0.4, twinkle: magic || golden,
    });
  }

  smoke() {
    this.particles.push({
      x: FIRE_X + rand(-6, 6), y: FIRE_BASE - 8, vx: rand(-3, 3), vy: -rand(5, 10), g: 0,
      life: rand(2, 3.5), age: 0, c: '#3a3634', drag: 0.1, smoke: true,
    });
  }

  update(dt) {
    this.modeT += dt;
    this.frameT += dt;
    const frameDur = 0.16 - this.shown * 0.04;
    if (this.frameT > frameDur) { this.frameT = 0; this.frame = (this.frame + 1) % 3; }

    const target = this.mode === 'burning' ? this.intensity : 0;
    this.shown += (target - this.shown) * Math.min(1, dt * 2.5);
    this.flare = Math.max(0, this.flare - dt * 1.2);

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
    this.drops = this.drops.filter((d) => d.y < FIRE_BASE - 18);
  }

  draw(t) {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;

    // sky + ground backdrop
    const sky = c.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#05060c'); sky.addColorStop(0.35, '#0b0d18');
    sky.addColorStop(0.55, '#10140f'); sky.addColorStop(1, '#0a0806');
    c.fillStyle = sky;
    c.fillRect(0, 0, W, H);
    for (const s of this.stars) {
      const tw = (Math.sin(t * 1.3 + s.p) + 1) / 2;
      c.fillStyle = tw > 0.7 ? '#cfd6ff' : '#5a6080';
      c.fillRect(s.x, s.y, 1, 1);
    }
    c.drawImage(this.s.forest_night, 0, 10);
    // ground in front of the forest
    const ground = c.createLinearGradient(0, 84, 0, H);
    ground.addColorStop(0, 'rgba(18,14,10,0)'); ground.addColorStop(0.35, '#15100c'); ground.addColorStop(1, '#0a0705');
    c.fillStyle = ground;
    c.fillRect(0, 80, W, H - 80);

    // firelight
    const flick = 0.92 + Math.sin(t * 11) * 0.03 + Math.sin(t * 17.3) * 0.03 + Math.random() * 0.03;
    let light = 0;
    if (this.mode === 'burning') light = (0.35 + this.shown * 0.65) * flick + this.flare * 0.25;
    else if (this.mode === 'dying') light = Math.max(0, 0.45 * (1 - this.modeT / 4.2)) * flick;
    else if (this.mode === 'ash' || this.mode === 'sifting') light = 0.06;
    if (light > 0) {
      const r = 40 + 50 * light * (0.7 + this.heat * 0.6);
      const gl = c.createRadialGradient(FIRE_X, FIRE_BASE - 14, 2, FIRE_X, FIRE_BASE - 14, r);
      const mag = this.essence;
      const col = mag > 0.35 ? `${Math.round(255 - mag * 120)},${Math.round(150 + mag * 40)},${Math.round(80 + mag * 150)}` : '255,150,60';
      gl.addColorStop(0, `rgba(${col},${0.55 * light})`);
      gl.addColorStop(0.4, `rgba(${col},${0.22 * light})`);
      gl.addColorStop(1, `rgba(${col},0)`);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = gl;
      c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over';
    }

    this.drawStones(c, true);

    const lx = FIRE_X - FRAME_W / 2;
    const ly = FIRE_BASE - FRAME_H;
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
      if (Math.sin(t * 2) > 0.6) { c.fillStyle = '#ff6a30'; c.fillRect(FIRE_X - 3, FIRE_BASE - 8, 1, 1); }
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
    const v = c.createRadialGradient(FIRE_X, 78, 30, FIRE_X, 70, 100);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
  }

  drawFlame(c, lx, ly) {
    const k = Math.max(0.12, this.shown + this.flare * 0.25);
    const tc = this.tctx;
    tc.globalCompositeOperation = 'source-over';
    tc.clearRect(0, 0, FRAME_W, FRAME_H);
    tc.drawImage(this.s.flames, this.frame * FRAME_W, 0, FRAME_W, FRAME_H, 0, 0, FRAME_W, FRAME_H);
    // fire colour responds to its characteristics
    tc.globalCompositeOperation = 'source-atop';
    if (this.essence > 0.12) {
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
    c.drawImage(this.tmp, Math.round(FIRE_X - dw / 2), ly + FRAME_H - dh + Math.round(4 * (1 - k)), dw, dh);
  }

  drawStones(c, back) {
    const stones = back
      ? [[-19, -9], [-11, -12], [-2, -13], [7, -12], [15, -9]]
      : [[-22, -3], [-14, 0], [-5, 1], [4, 1], [13, 0], [21, -3]];
    for (const [dx, dy] of stones) {
      const x = FIRE_X + dx - 3;
      const y = FIRE_BASE + dy - 2;
      c.fillStyle = '#1a1716'; c.fillRect(x, y, 7, 4);
      c.fillStyle = '#3c3632'; c.fillRect(x + 1, y, 5, 3);
      c.fillStyle = '#5e5650'; c.fillRect(x + 1, y, 3, 1);
      if (this.mode === 'burning') { c.fillStyle = 'rgba(255,140,60,0.35)'; c.fillRect(x + 2, y, 3, 1); }
    }
  }
}
