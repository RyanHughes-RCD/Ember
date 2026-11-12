// Materials section: owned fuel (sortable), the material shop, and the satchel of treasures.

import { $, $$, esc, fmtDur, fmtNum, fmtStat } from './util.js';
import { iconUrl } from './icons.js';
import { sfx } from './audio.js';
import { effectiveMaterial } from '../logic/stats.js';
import {
  isUnlocked, unlockHint, buyMaterial, sellItem, sellAllTreasures, sellValue, treasureValue, canCraft,
} from '../logic/economy.js';

const SORTS = {
  category: { label: 'Category', fn: (a, b, d) => d.config.categories.indexOf(a.category) - d.config.categories.indexOf(b.category) },
  rarity: { label: 'Rarity', fn: (a, b, d) => d.rarityIndex[b.rarity] - d.rarityIndex[a.rarity] },
  burn: { label: 'Burn duration', fn: (a, b) => b.eff.burnSeconds - a.eff.burnSeconds },
  heat: { label: 'Heat', fn: (a, b) => b.eff.heat - a.eff.heat },
  quality: { label: 'Quality', fn: (a, b) => b.eff.quality - a.eff.quality },
  essence: { label: 'Essence', fn: (a, b) => b.eff.essence - a.eff.essence },
  owned: { label: 'Quantity owned', fn: (a, b) => b.owned - a.owned },
};

export class MaterialsView {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.sub = 'fuel';
    this.sort = 'category';
    this.body = $('#materials-body');
    $$('#view-materials .subtab').forEach((b) => b.addEventListener('click', () => { sfx.tap(); this.setSub(b.dataset.sub); }));
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('change', (e) => {
      if (e.target.id === 'mat-sort') { this.sort = e.target.value; this.render(); }
    });
  }

  get state() { return this.game.state; }
  get data() { return this.game.data; }

  setSub(sub) {
    this.sub = sub;
    $$('#view-materials .subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
    this.render();
  }

  onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    e.preventDefault();
    const { act, id } = t.dataset;
    if (act === 'buy') {
      const qty = Number(t.dataset.qty);
      const r = this.game.act((s, d) => buyMaterial(s, d, id, qty));
      if (r.ok) { sfx.coin(); this.ui.toast(`${r.crafted ? 'Made' : 'Bought'} ${qty} ${this.data.byId[id].name}.`, '', id); if (!r.crafted) this.ui.bump('sparks'); }
      else { sfx.error(); this.ui.toast(r.error, 'error'); }
    } else if (act === 'sell') {
      const qty = this.state.inventory[id] || 0;
      const r = this.game.act((s, d) => sellItem(s, d, id, qty));
      if (r.ok) { sfx.coin(); this.ui.toast(`Sold for ✦${r.gain}.`, '', id); this.ui.bump('sparks'); }
    } else if (act === 'sell-all') {
      const r = this.game.act((s, d) => sellAllTreasures(s, d));
      if (r.ok) { sfx.coin(); this.ui.toast(`Sold everything for ✦${r.gain}.`); this.ui.bump('sparks'); }
    } else if (act === 'detail') {
      this.ui.showItem(id);
    }
    this.render();
  }

  render() {
    if (this.sub === 'fuel') this.renderFuel();
    else if (this.sub === 'shop') this.renderShop();
    else this.renderSatchel();
  }

  lootRow(m) {
    const s = this.state;
    const btns = m.loot.map((e) => {
      const def = this.data.byId[e.item];
      const known = Boolean(s.discoveries[e.item]);
      return `<button data-act="detail" data-id="${e.item}" title="${known ? esc(def.name) : 'Undiscovered'}">
        <img class="px-icon" src="${iconUrl(def, { silhouette: !known })}" alt="${known ? esc(def.name) : 'Unknown'}"></button>`;
    }).join('');
    return `<div class="loot-row"><span class="lbl">Ashes</span>${btns}</div>`;
  }

  statsRow(eff) {
    return `<div class="stats-row">
      <span>Burn <b>${fmtDur(eff.burnSeconds)}</b></span>
      <span class="h">Heat <b>${fmtStat(eff.heat)}</b></span>
      <span class="q">Quality <b>${fmtStat(eff.quality)}</b></span>
      <span class="e">Essence <b>${fmtStat(eff.essence)}</b></span>
      <span>Yield <b>${eff.ashYield}</b></span></div>`;
  }

  renderFuel() {
    const s = this.state; const d = this.data;
    const list = d.materials
      .filter((m) => s.seenMaterials[m.id] || (s.inventory[m.id] || 0) > 0)
      .map((m) => ({ ...m, eff: effectiveMaterial(s, d, m.id), owned: s.inventory[m.id] || 0 }));
    const sort = SORTS[this.sort];
    list.sort((a, b) => sort.fn(a, b, d) || d.rarityIndex[a.rarity] - d.rarityIndex[b.rarity] || a.eff.burnSeconds - b.eff.burnSeconds);
    const hidden = d.materials.length - list.length;
    const opts = Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === this.sort ? 'selected' : ''}>${v.label}</option>`).join('');
    this.body.innerHTML = `
      <div class="toolbar"><label for="mat-sort">Sort</label><select id="mat-sort">${opts}</select></div>
      <div class="list">${list.map((m) => `
        <div class="card mat-card">
          <img class="px-icon" src="${iconUrl(m)}" alt="">
          <div>
            <div class="mat-head"><span class="name">${esc(m.name)}</span>
              <span class="rarity r-${m.rarity}">${m.rarity} · ${m.category}</span>
              <span class="owned">Owned <b>${m.owned}</b></span></div>
            <p class="desc">${esc(m.description)}</p>
            ${this.statsRow(m.eff)}
            ${this.lootRow(m)}
          </div>
        </div>`).join('')}
      </div>
      ${hidden ? `<p class="empty-note">${hidden} more material${hidden === 1 ? '' : 's'} still to discover.</p>` : ''}`;
  }

  renderShop() {
    const s = this.state; const d = this.data;
    const items = d.materials.filter((m) => m.price || m.recipe);
    this.body.innerHTML = `
      <p class="desc" style="margin:0 2px 10px">Trade Sparks for fuel. Better wood and stranger things appear as your fires grow longer.</p>
      <div class="list">${items.map((m) => {
        const open = isUnlocked(s, d, m.id);
        const eff = effectiveMaterial(s, d, m.id);
        const known = open || s.seenMaterials[m.id];
        return `
        <div class="card mat-card ${open ? '' : 'locked'}">
          <img class="px-icon" src="${iconUrl(m, { silhouette: !known })}" alt="">
          <div>
            <div class="mat-head"><span class="name">${known ? esc(m.name) : '???'}</span>
              <span class="rarity r-${m.rarity}">${m.rarity}</span>
              <span class="owned">Owned <b>${s.inventory[m.id] || 0}</b></span></div>
            ${open ? this.statsRow(eff) : `<div class="lock-hint">${esc(unlockHint(d, m.id))}</div>`}
            ${open && m.recipe ? `<div class="buy-row"><span class="recipe">${Object.entries(m.recipe).map(([ing, n]) => `<span class="ing ${(s.inventory[ing] || 0) >= n ? '' : 'short'}" title="${esc(d.byId[ing].name)}"><img class="px-icon" src="${iconUrl(d.byId[ing])}" alt="">${n}<small>/${s.inventory[ing] || 0}</small></span>`).join('')}</span>
              <button class="btn btn-small" data-act="buy" data-id="${m.id}" data-qty="1" ${canCraft(s, d, m.id, 1) ? '' : 'disabled'}>Make 1</button>
              <button class="btn btn-small" data-act="buy" data-id="${m.id}" data-qty="5" ${canCraft(s, d, m.id, 5) ? '' : 'disabled'}>Make 5</button>
            </div>` : ''}
            ${open && !m.recipe ? `<div class="buy-row"><span class="price">✦ ${m.price}</span>
              <button class="btn btn-small" data-act="buy" data-id="${m.id}" data-qty="1" ${s.sparks >= m.price ? '' : 'disabled'}>Buy 1</button>
              <button class="btn btn-small" data-act="buy" data-id="${m.id}" data-qty="5" ${s.sparks >= m.price * 5 ? '' : 'disabled'}>Buy 5</button>
            </div>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;
  }

  renderSatchel() {
    const s = this.state; const d = this.data;
    const owned = Object.entries(s.inventory)
      .filter(([id, n]) => n > 0 && sellValue(d, id) > 0)
      .map(([id, n]) => ({ def: d.byId[id], n }))
      .sort((a, b) => d.rarityIndex[b.def.rarity] - d.rarityIndex[a.def.rarity] || a.def.name.localeCompare(b.def.name));
    const total = treasureValue(s, d);
    this.body.innerHTML = `
      <div class="card sell-all">
        <div class="txt">Treasures recovered from the ashes can be traded for Sparks.<br>Total value: <b style="color:var(--amber)">✦ ${fmtNum(total)}</b></div>
        <button class="btn btn-primary btn-small" data-act="sell-all" ${total ? '' : 'disabled'}>Sell all</button>
      </div>
      <div class="list">${owned.length ? owned.map(({ def, n }) => `
        <div class="card row-item">
          <button data-act="detail" data-id="${def.id}" style="background:none;border:0;padding:0"><img class="px-icon" src="${iconUrl(def)}" alt=""></button>
          <div class="mid"><div class="name">${esc(def.name)} <span class="rarity r-${def.rarity}">${def.rarity}</span></div>
            <small>×${n} · ✦${sellValue(d, def.id)} each</small></div>
          <button class="btn btn-small" data-act="sell" data-id="${def.id}">Sell ✦${sellValue(d, def.id) * n}</button>
        </div>`).join('') : '<p class="empty-note">Your satchel is empty. Let a fire burn out and sift its ashes.</p>'}
      </div>`;
  }
}
