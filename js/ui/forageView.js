// Forage screen: a top-down view of a small grassy patch near the fire.
// Twigs and leaves that have fallen there can be tapped to pick them up.

import { $, fmtClock } from './util.js';
import { iconUrl } from './icons.js';
import { sfx } from './audio.js';
import { pickUp, nextGatherIn, spawnCount, canForage, forage } from '../logic/economy.js';
import { handGrid, newHandVisit, handFrame, HAND_W, HAND_H } from './hand.js';

const NATIVE_W = 96;
const ITEM = 16; // item sprite size in native pixels
// The hand in the corner: a small chance on each visit, and a slow chance while you linger.
const HAND_CHANCE_PER_VISIT = 0.03;
const HAND_EVERY_SECONDS = 600;

// Night palette, lit warmly from the fire just off-screen (bottom).
const SOIL = ['#120d09', '#1a130c', '#221810', '#2c2014'];
const GRASS = ['#16260f', '#1f3716', '#2a4a1d', '#3a6026', '#507a32', '#6c9440'];
const FLOWERS = ['#d8c890', '#c890b0', '#a0b8e0'];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ForageView {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.root = $('#forage');
    this.canvas = $('#forage-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = $('#forage-info');
    this.imgs = {};
    this.appear = new Map(); // spawn key -> time it appeared (for the falling animation)
    this.pops = []; // picked-up items floating away
    this.hand = null;
    this.handGrids = { rest: handGrid(false), curl: handGrid(true) };
    this.flies = Array.from({ length: 5 }, (_, i) => ({ x: Math.random(), y: Math.random(), p: i * 1.7 }));
    this.running = false;
    this.bg = null;
    this.stage = this.root.querySelector('.forage-stage');
    this.stage.addEventListener('click', (e) => this.onTap(e));
    window.addEventListener('resize', () => { if (this.running) this.layout(); });
  }

  get state() { return this.game.state; }
  get data() { return this.game.data; }

  img(id) {
    if (!this.imgs[id]) {
      const im = new Image();
      im.src = iconUrl(this.data.byId[id]);
      this.imgs[id] = im;
    }
    return this.imgs[id];
  }

  open() {
    if (canForage(this.state, this.data)) {
      const r = this.game.act((s, d, now) => forage(s, d, now));
      if (r.ok) this.ui.toast('You spot some kindling in the grass.', '', 'dry_leaves');
    }
    // Items already lying here are shown at once; only new arrivals fall in.
    this.appear.clear();
    for (const o of this.state.gathering.spawns) this.appear.set(o.key, -Infinity);
    this.layout();
    this.update();
    this.hand = null;
    this.handAt = Math.random() < HAND_CHANCE_PER_VISIT ? performance.now() / 1000 + 2 + Math.random() * 4 : null;
    this.lastT = null;
    if (!this.running) {
      this.running = true;
      const loop = (t) => {
        if (!this.running) return;
        this.draw(t / 1000);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }

  close() { this.running = false; }

  layout() {
    const r = this.canvas.getBoundingClientRect();
    const aspect = r.width > 0 ? r.height / r.width : 1.6;
    this.w = NATIVE_W;
    this.h = Math.max(96, Math.min(220, Math.round(NATIVE_W * aspect)));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx.imageSmoothingEnabled = false;
    this.scale = r.width > 0 ? r.width / this.w : 4;
    // the patch: a rounded, slightly irregular clearing in the middle
    this.cx = this.w / 2;
    this.cy = this.h * 0.48;
    this.rx = this.w * 0.44;
    this.ry = Math.min(this.h * 0.36, this.rx * 1.15);
    this.bg = this.paintBackground();
    for (const el of [...this.stage.querySelectorAll('.spawn-hit')]) el.remove(); // re-place for the new size
  }

  inPatch(x, y, pad = 0) {
    const dx = (x - this.cx) / (this.rx - pad);
    const dy = (y - this.cy) / (this.ry - pad);
    const a = Math.atan2(dy, dx);
    const wobble = 1 + 0.07 * Math.sin(a * 3 + 1.2) + 0.05 * Math.sin(a * 7 + 0.4) + 0.03 * Math.sin(a * 13);
    return dx * dx + dy * dy <= wobble * wobble;
  }

  /** Static ground, painted once per layout from a fixed seed so the patch never changes. */
  paintBackground() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d');
    const rng = mulberry(20261110);
    const img = g.createImageData(this.w, this.h);
    const put = (x, y, hex) => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const i = (y * this.w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.inPatch(x + 0.5, y + 0.5)) {
          // lighter toward the bottom, where the firelight falls
          const light = (y / this.h) * 1.6 + rng() * 1.4;
          put(x, y, GRASS[Math.min(4, Math.floor(1 + light))]);
        } else {
          put(x, y, SOIL[Math.floor(rng() * 2.2 + (y / this.h) * 1.2)] || SOIL[3]);
        }
      }
    }
    // grass blades: short light strokes with a dark root
    for (let n = 0; n < this.w * this.h * 0.09; n++) {
      const x = Math.floor(rng() * this.w); const y = Math.floor(rng() * this.h);
      if (!this.inPatch(x + 0.5, y + 0.5, 1)) continue;
      const tone = 2 + Math.floor((y / this.h) * 2.2 + rng() * 1.5);
      put(x, y, GRASS[Math.min(5, tone)]);
      put(x, y - 1, GRASS[Math.min(5, tone + 1)]);
      put(x, y + 1, GRASS[0]);
    }
    // tufts spilling over the patch edge
    for (let n = 0; n < 220; n++) {
      const a = rng() * Math.PI * 2;
      const r = 0.92 + rng() * 0.16;
      const x = Math.round(this.cx + Math.cos(a) * this.rx * r);
      const y = Math.round(this.cy + Math.sin(a) * this.ry * r);
      put(x, y, GRASS[1 + Math.floor(rng() * 2)]);
      put(x, y - 1, GRASS[2 + Math.floor(rng() * 2)]);
    }
    // forest floor clutter: needles and pebbles
    for (let n = 0; n < 140; n++) {
      const x = Math.floor(rng() * this.w); const y = Math.floor(rng() * this.h);
      if (this.inPatch(x, y, -2)) continue;
      if (rng() < 0.7) { put(x, y, '#3a2a18'); put(x + 1, y + (rng() < 0.5 ? 1 : 0), '#2e2214'); } else { put(x, y, '#4a4440'); put(x + 1, y, '#5e5852'); put(x, y + 1, '#2a2624'); }
    }
    // a few pebbles and flowers inside the patch
    for (let n = 0; n < 7; n++) {
      const x = Math.floor(this.cx + (rng() - 0.5) * this.rx * 1.5);
      const y = Math.floor(this.cy + (rng() - 0.5) * this.ry * 1.5);
      if (!this.inPatch(x, y, 3)) continue;
      put(x, y, '#5a5650'); put(x + 1, y, '#7a756e'); put(x, y + 1, '#34302c'); put(x + 1, y + 1, '#4a4640');
    }
    for (let n = 0; n < 12; n++) {
      const x = Math.floor(this.cx + (rng() - 0.5) * this.rx * 1.6);
      const y = Math.floor(this.cy + (rng() - 0.5) * this.ry * 1.6);
      if (!this.inPatch(x, y, 3)) continue;
      const col = FLOWERS[n % FLOWERS.length];
      put(x, y, col); put(x - 1, y, GRASS[3]); put(x + 1, y, GRASS[3]); put(x, y + 1, GRASS[2]);
    }
    g.putImageData(img, 0, 0);

    // firelight from below, cool shade above
    const warm = g.createRadialGradient(this.w / 2, this.h * 1.15, 4, this.w / 2, this.h * 1.15, this.h * 0.95);
    warm.addColorStop(0, 'rgba(255,150,60,0.32)'); warm.addColorStop(0.6, 'rgba(255,120,40,0.08)'); warm.addColorStop(1, 'rgba(255,120,40,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = warm; g.fillRect(0, 0, this.w, this.h);
    g.globalCompositeOperation = 'source-over';
    const shade = g.createLinearGradient(0, 0, 0, this.h);
    shade.addColorStop(0, 'rgba(4,6,14,0.3)'); shade.addColorStop(0.45, 'rgba(4,6,14,0.1)'); shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shade; g.fillRect(0, 0, this.w, this.h);
    const v = g.createRadialGradient(this.cx, this.cy, this.rx * 0.8, this.cx, this.cy, this.w);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.4)');
    g.fillStyle = v; g.fillRect(0, 0, this.w, this.h);
    return c;
  }

  /** Spawn position (0..1 patch units) → native pixel centre. */
  pos(o) {
    return { x: this.cx + (o.x - 0.5) * 2 * this.rx * 0.78, y: this.cy + (o.y - 0.5) * 2 * this.ry * 0.78 };
  }

  /** Each fallen item has an invisible button over it (tap target, keyboard and screen readers). */
  onTap(e) {
    const btn = e.target.closest('.spawn-hit');
    if (!btn) return;
    e.preventDefault();
    sfx.unlock();
    const key = btn.dataset.key;
    const spawn = this.state.gathering.spawns.find((o) => o.key === key);
    if (!spawn) return;
    const p = this.pos(spawn);
    const res = this.game.act((s, d) => pickUp(s, d, key));
    if (!res.ok) return;
    sfx.pick();
    const def = this.data.byId[spawn.id];
    if (def.rarity !== 'common') {
      sfx.reveal(def.rarity);
      this.ui.toast(`You found a ${def.name}!`, 'milestone', spawn.id);
    }
    if (navigator.vibrate) navigator.vibrate(8);
    this.pops.push({ id: spawn.id, x: p.x, y: p.y, flip: spawn.flip, t: performance.now() / 1000 });
    this.floatLabel(btn.offsetLeft, btn.offsetTop - 10, `+1 ${this.data.byId[spawn.id].name}`);
    this.appear.delete(key);
    this.update();
  }

  syncHits() {
    const want = new Map(this.state.gathering.spawns.map((o) => [o.key, o]));
    for (const el of [...this.stage.querySelectorAll('.spawn-hit')]) {
      if (!want.has(el.dataset.key)) el.remove();
      else want.delete(el.dataset.key);
    }
    for (const o of want.values()) {
      const p = this.pos(o);
      const el = document.createElement('button');
      el.className = 'spawn-hit';
      el.dataset.key = o.key;
      el.dataset.id = o.id;
      el.setAttribute('aria-label', `Pick up ${this.data.byId[o.id].name}`);
      el.style.left = `${(p.x / this.w) * 100}%`;
      el.style.top = `${(p.y / this.h) * 100}%`;
      this.stage.append(el);
    }
  }

  floatLabel(x, y, text) {
    const el = document.createElement('div');
    el.className = 'forage-float';
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.stage.append(el);
    setTimeout(() => el.remove(), 1000);
  }

  /** Called every tick: register new arrivals and refresh the info line. */
  update() {
    if (this.bg) this.syncHits();
    const now = performance.now() / 1000;
    for (const o of this.state.gathering.spawns) if (!this.appear.has(o.key)) this.appear.set(o.key, now);
    const d = this.data;
    const n = spawnCount(this.state);
    const next = nextGatherIn(this.state, d);
    const have = d.config.gathering.sources.map((src) => `${d.byId[src.id].name} ×${this.state.inventory[src.id] || 0}`).join(' · ');
    const status = next === null
      ? 'The patch is full — pick something up'
      : n ? `${n} to pick up · more falls in ${fmtClock(next)}` : `Something falls here in ${fmtClock(next)}`;
    this.info.innerHTML = `<div>${status}</div><div class="have">${have}</div>`;
  }

  draw(t) {
    if (!this.bg) return;
    const c = this.ctx;
    c.globalAlpha = 1;
    c.drawImage(this.bg, 0, 0);

    // fallen items
    for (const o of this.state.gathering.spawns) {
      const p = this.pos(o);
      const t0 = this.appear.get(o.key) ?? -Infinity;
      const k = Math.min(1, (t - t0) / 0.9); // 0..1 fall-in progress
      const ease = 1 - (1 - k) ** 3;
      const sway = o.id === 'dry_leaves' && k < 1 ? Math.sin(k * 9) * 4 * (1 - k) : 0;
      const dx = Math.round(p.x - ITEM / 2 + sway);
      const dy = Math.round(p.y - ITEM / 2 - (1 - ease) * 18);
      // shadow grows as the item lands
      c.globalAlpha = 0.4 * ease;
      c.fillStyle = '#050403';
      c.beginPath();
      c.ellipse(Math.round(p.x) + 1, Math.round(p.y) + 5, 6, 2.2, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = Math.min(1, k * 2);
      this.drawItem(c, o.id, dx, dy, o.flip);
      // an occasional glint so items read as tappable
      const rare = this.data.byId[o.id].rarity !== 'common';
      const phase = (t * (rare ? 1.6 : 0.6) + o.x * 7 + o.y * 3) % 4;
      if (k >= 1 && phase < 0.25) {
        c.globalAlpha = 1 - phase * 4;
        c.fillStyle = '#fff4c8';
        c.fillRect(dx + 4, dy + 3, 1, 1);
        c.fillRect(dx + 3, dy + 4, 1, 1); c.fillRect(dx + 5, dy + 4, 1, 1); c.fillRect(dx + 4, dy + 5, 1, 1);
      }
    }

    // picked items lift away
    this.pops = this.pops.filter((pp) => t - pp.t < 0.5);
    for (const pp of this.pops) {
      const k = (t - pp.t) / 0.5;
      c.globalAlpha = 1 - k;
      this.drawItem(c, pp.id, Math.round(pp.x - ITEM / 2), Math.round(pp.y - ITEM / 2 - k * 14), pp.flip);
    }

    this.updateHand(t);
    this.drawHand(c);

    // fireflies
    for (const f of this.flies) {
      f.x += Math.sin(t * 0.7 + f.p) * 0.0009;
      f.y += Math.cos(t * 0.5 + f.p * 2) * 0.0007;
      const on = Math.sin(t * 1.6 + f.p * 3) > 0.3;
      if (!on) continue;
      c.globalAlpha = 0.85;
      c.fillStyle = '#e8f080';
      c.fillRect(Math.round(((f.x % 1) + 1) % 1 * this.w), Math.round(((f.y % 1) + 1) % 1 * this.h), 1, 1);
    }
    c.globalAlpha = 1;
  }

  // ------------------------------------------------------------ the hand
  // On very rare occasions a pitch-black hand creeps out of one of the top
  // corners onto the dark forest floor, rests a moment, then pulls back.

  updateHand(t) {
    const dt = this.lastT === null ? 0 : Math.min(0.1, t - this.lastT);
    this.lastT = t;
    if (!this.hand) {
      const due = this.handAt !== null && t >= this.handAt;
      if (due || Math.random() < dt / HAND_EVERY_SECONDS) {
        this.handAt = null;
        const left = Math.random() < 0.5;
        const tilt = (Math.random() - 0.5) * 0.35;
        this.hand = { ...newHandVisit(), left, angle: (left ? Math.PI / 4 : (3 * Math.PI) / 4) + tilt };
      }
      return;
    }
    this.hand.t += dt;
    if (this.hand.t >= this.hand.end) this.hand = null;
  }

  drawHand(c) {
    const h = this.hand;
    if (!h) return;
    const { reveal, curled } = handFrame(h);
    if (reveal <= 0) return;
    const grid = curled ? this.handGrids.curl : this.handGrids.rest;
    const ox = h.left ? 0 : this.w;
    const cos = Math.cos(h.angle); const sin = Math.sin(h.angle);
    const mirror = h.left ? 1 : -1;
    const span = Math.ceil(reveal) + 4;
    c.fillStyle = '#000';
    for (let py = 0; py < span; py++) {
      for (let i = 0; i < span; i++) {
        const px = h.left ? i : this.w - 1 - i;
        // supersample so the thin fingers stay unbroken at an angle
        let hit = false;
        for (const [sx, sy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const dx = px + sx - ox; const dy = py + sy;
          const u = dx * cos + dy * sin; // along the reach
          const v = (-dx * sin + dy * cos) * mirror; // across it
          const gx = Math.floor(u - reveal + HAND_W);
          const gy = Math.floor(v + HAND_H / 2);
          if (gx >= 0 && gy >= 0 && gx < HAND_W && gy < HAND_H && grid[gy][gx]) { hit = true; break; }
        }
        if (hit) c.fillRect(px, py, 1, 1);
      }
    }
  }

  drawItem(c, id, x, y, flip) {
    const im = this.img(id);
    if (!im.complete) return;
    if (flip) {
      c.save();
      c.translate(x + ITEM, y);
      c.scale(-1, 1);
      c.drawImage(im, 0, 0, ITEM, ITEM);
      c.restore();
    } else {
      c.drawImage(im, x, y, ITEM, ITEM);
    }
  }
}
