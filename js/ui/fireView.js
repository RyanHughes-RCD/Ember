// Campfire screen: HUD, characteristics, slots, material tray, basket, ash phase.

import { $, esc, fmtClock, fmtDur, fmtStat } from './util.js';
import { iconUrl, uiIconUrl } from './icons.js';
import { sfx } from './audio.js';
import {
  remainingAt, durationAt, canStokeNow, stoke, selectionSeconds,
} from '../logic/fire.js';
import { getCapacity, getThreshold, effectiveMaterial } from '../logic/stats.js';
import { fireAverages } from '../logic/rewards.js';
import {
  basketContents, collectBasket, nextGatherIn, canForage, forage, burnableCount,
} from '../logic/economy.js';

export class FireView {
  constructor(game, scene, ui) {
    this.game = game;
    this.scene = scene;
    this.ui = ui; // { toast, openSift }
    this.selection = {};
    this.panel = $('#fire-panel');
    this.lastKey = '';
    this.iconImgs = {};
    this.panel.addEventListener('click', (e) => this.onClick(e));
  }

  get state() { return this.game.state; }
  get data() { return this.game.data; }

  selectedCount() {
    return Object.values(this.selection).reduce((a, b) => a + b, 0);
  }

  /** Drop selections that are no longer valid (inventory spent elsewhere, etc). */
  pruneSelection() {
    const cap = getCapacity(this.state, this.data);
    let total = 0;
    for (const id of Object.keys(this.selection)) {
      const have = this.state.inventory[id] || 0;
      let n = Math.min(this.selection[id], have, cap - total);
      if (n <= 0) { delete this.selection[id]; continue; }
      this.selection[id] = n;
      total += n;
    }
  }

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    e.preventDefault();
    const act = t.dataset.act;
    const id = t.dataset.id;
    sfx.unlock();
    if (act === 'add') this.add(id);
    else if (act === 'remove') this.remove(id);
    else if (act === 'clear') { this.selection = {}; sfx.deselect(); this.render(); }
    else if (act === 'stoke') this.doStoke();
    else if (act === 'sift') this.ui.openSift();
    else if (act === 'basket') this.collectBasket();
    else if (act === 'forage') this.doForage();
    else if (act === 'shop') this.ui.go('materials', 'shop');
    else if (act === 'detail') this.ui.showItem(id);
  }

  add(id) {
    const cap = getCapacity(this.state, this.data);
    const have = this.state.inventory[id] || 0;
    const sel = this.selection[id] || 0;
    if (this.selectedCount() >= cap) {
      sfx.error();
      this.ui.toast(cap === 1 ? 'Only 1 slot — tap the slot to swap, or upgrade capacity.' : `All ${cap} slots are full.`, 'error');
      return;
    }
    if (sel >= have) { sfx.error(); return; }
    this.selection[id] = sel + 1;
    sfx.select();
    this.render();
  }

  remove(id) {
    if (!this.selection[id]) return;
    this.selection[id] -= 1;
    if (!this.selection[id]) delete this.selection[id];
    sfx.deselect();
    this.render();
  }

  iconImage(id) {
    if (!this.iconImgs[id]) {
      const img = new Image();
      img.src = iconUrl(this.data.byId[id]);
      this.iconImgs[id] = img;
    }
    return this.iconImgs[id];
  }

  doStoke() {
    const sel = { ...this.selection };
    const res = this.game.act((s, d, now) => stoke(s, d, sel, now));
    if (!res.ok) {
      sfx.error();
      this.ui.toast(res.error, 'error');
      return;
    }
    const icons = [];
    for (const [id, n] of Object.entries(sel)) for (let i = 0; i < n; i++) icons.push(this.iconImage(id));
    this.selection = {};
    sfx.stoke();
    if (navigator.vibrate) navigator.vibrate(15);
    this.scene.stoke(icons);
    this.render();
  }

  collectBasket() {
    const got = this.game.act((s, d, now) => ({ got: collectBasket(s, d, now) })).got;
    const parts = Object.entries(got).map(([id, n]) => `${n} ${this.data.byId[id].name}`);
    if (!parts.length) {
      this.ui.toast('Nothing in the basket yet.', '', 'basket');
    } else {
      sfx.coin();
      this.ui.toast(`Gathered ${parts.join(' and ')}.`, '', 'basket');
    }
    this.render();
  }

  doForage() {
    const r = this.game.act((s, d) => forage(s, d));
    if (r.ok) {
      sfx.coin();
      this.ui.toast('You scrape together some kindling from the forest floor.', '', 'basket');
    }
    this.render();
  }

  // ------------------------------------------------------------ rendering

  /** Called every tick for live numbers; rebuilds the panel only when needed. */
  update(now) {
    const s = this.state;
    const fire = s.fire;
    const rem = remainingAt(fire, now);
    const dur = durationAt(fire, now);
    const thr = getThreshold(s, this.data);
    const timeEl = $('#hud-time');
    const subEl = $('#hud-sub');

    if (fire.status === 'burning') {
      timeEl.textContent = fmtClock(rem);
      timeEl.className = `hud-time${rem <= thr ? ' low' : ''}`;
      subEl.textContent = rem <= thr ? 'The fire is running low' : '';
    } else if (fire.status === 'ash' || this.ui.revealing) {
      timeEl.textContent = 'Ashes';
      timeEl.className = 'hud-time out';
      subEl.textContent = s.pendingAsh ? `It burned for ${fmtDur(s.pendingAsh.duration)}` : '';
    } else {
      timeEl.textContent = 'Unlit';
      timeEl.className = 'hud-time out';
      subEl.textContent = '';
    }

    // Scene parameters
    const avg = fireAverages(fire);
    let intensity = 0;
    if (fire.status === 'burning') {
      intensity = rem <= thr ? 0.28 + 0.32 * (rem / thr) : Math.min(1, 0.62 + 0.38 * ((rem - thr) / (thr * 5)));
    }
    this.scene.setFire({
      status: this.ui.revealing ? 'cold' : fire.status,
      intensity,
      heat: Math.min(1, avg.heat / 16),
      essence: Math.min(1, avg.essence / 20),
      quality: Math.min(1, avg.quality / 12),
    });

    // Rebuild the panel only when its structure changes (not every tick).
    if (this.panelKey(now) !== this.lastKey) {
      this.render(now);
    } else {
      // live countdown text without rebuilding (keeps taps reliable)
      const wait = fmtClock(Math.max(0, rem - thr));
      const btn = $('#stoke-btn', this.panel);
      if (btn && btn.dataset.waiting) btn.textContent = `STOKE IN ${wait}`;
      const after = $('#stoke-after', this.panel);
      if (after) after.textContent = fmtClock(rem + selectionSeconds(s, this.data, this.selection));
      const bn = $('#basket-next', this.panel);
      const nextIn = nextGatherIn(s, this.data);
      if (bn) bn.textContent = nextIn === null ? 'Full' : fmtClock(nextIn);
    }
  }

  panelKey(now) {
    const s = this.state;
    return [
      s.fire.status, this.ui.revealing, canStokeNow(s, this.data, now), getCapacity(s, this.data),
      Object.entries(basketContents(s, this.data)).join(','), s.rev,
    ].join('|');
  }

  render(now = this.game.now()) {
    const s = this.state;
    const d = this.data;
    this.pruneSelection();
    const fire = s.fire;
    const rem = remainingAt(fire, now);
    const thr = getThreshold(s, d);
    const ready = canStokeNow(s, d, now);
    this.lastKey = this.panelKey(now);

    if (this.ui.revealing) { this.panel.innerHTML = ''; return; }

    if (fire.status === 'ash') {
      const p = s.pendingAsh;
      this.panel.innerHTML = `
        <div class="ash-panel">
          <button class="btn btn-primary btn-wide glow" data-act="sift">SIFT THROUGH ASHES</button>
        </div>`;
      return;
    }

    const cap = getCapacity(s, d);
    const count = this.selectedCount();
    const adds = selectionSeconds(s, d, this.selection);
    const lighting = fire.status === 'cold';

    // slots
    const slotIds = [];
    for (const [id, n] of Object.entries(this.selection)) for (let i = 0; i < n; i++) slotIds.push(id);
    let slots = '';
    for (let i = 0; i < cap; i++) {
      const id = slotIds[i];
      slots += id
        ? `<button class="slot filled" data-act="remove" data-id="${id}" aria-label="Remove ${esc(d.byId[id].name)}"><img class="px-icon" src="${iconUrl(d.byId[id])}" alt=""></button>`
        : '<div class="slot" aria-hidden="true"></div>';
    }

    const after = (lighting ? 0 : rem) + adds;
    const label = lighting ? 'LIGHT FIRE' : ready ? 'STOKE FIRE' : `STOKE IN ${fmtClock(rem - thr)}`;
    const btnOk = ready && count > 0;

    // tray: burnable materials owned
    const owned = d.materials.filter((m) => (s.inventory[m.id] || 0) > 0);
    const tray = owned.map((m) => {
      const have = s.inventory[m.id];
      const sel = this.selection[m.id] || 0;
      const eff = effectiveMaterial(s, d, m.id);
      return `<button class="tray-item${sel ? ' chosen' : ''}${sel >= have ? ' empty' : ''}" data-act="add" data-id="${m.id}">
          ${sel ? `<span class="sel">${sel}</span>` : ''}<span class="qty">×${have - sel}</span>
          <img class="px-icon" src="${iconUrl(m)}" alt="">
          <span class="nm">${esc(m.name)}</span><span class="bt">${fmtDur(eff.burnSeconds, { short: true })}</span>
        </button>`;
    }).join('');

    // passive basket: a tile at the start of the fuel strip
    const basket = basketContents(s, d);
    const bCount = Object.values(basket).reduce((x, y) => x + y, 0);
    const nextIn = nextGatherIn(s, d);
    const basketHtml = `<button class="tray-item basket-btn${bCount ? ' has' : ''}" data-act="basket" aria-label="Collect gathered fuel">
        ${bCount ? `<span class="qty">+${bCount}</span>` : ''}
        <img class="px-icon" src="${uiIconUrl('basket')}" alt="">
        <span class="nm">${bCount ? 'Collect' : 'Basket'}</span><span class="bt" id="basket-next">${nextIn === null ? 'Full' : fmtClock(nextIn)}</span>
      </button>`;

    const noFuel = burnableCount(s, d) === 0;
    const forageBtn = canForage(s, d)
      ? '<button class="btn btn-wide" data-act="forage" style="margin-top:10px">FORAGE FOR KINDLING</button>' : '';

    this.panel.innerHTML = `
      <div class="slots-row">${slots}</div>
      <div class="slots-meta">${adds
    ? `<span class="plus">+${fmtClock(adds)}</span> → <b id="${lighting ? '' : 'stoke-after'}">${fmtClock(after)}</b>`
    : noFuel ? 'No fuel left — <a href="#" data-act="shop" style="color:var(--amber)">visit the shop</a>' : ''}</div>
      <button id="stoke-btn" class="btn btn-primary btn-wide${btnOk ? ' glow' : ''}" data-act="stoke" ${!lighting && !ready ? 'data-waiting="1"' : ''} ${btnOk ? '' : 'disabled'}>${label}</button>
      ${forageBtn}
      <div class="tray">${basketHtml}${tray}</div>`;
    // keep the fire clear of the controls (only ever grows, so the fire never jumps around)
    const hPx = this.panel.offsetHeight;
    if (hPx > (this.maxPanel || 0) + 4) { this.maxPanel = hPx; this.scene.layout(hPx - 20); }
  }
}
