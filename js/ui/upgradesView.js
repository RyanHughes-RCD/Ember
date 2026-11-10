// Permanent upgrades, split into Firekeeping and Ash Recovery.

import { $, esc, fmtClock, pct } from './util.js';
import { uiIconUrl } from './icons.js';
import { sfx } from './audio.js';
import { upgradeLevel } from '../logic/stats.js';
import { buyUpgrade, nextUpgradeCost } from '../logic/economy.js';

const ICON_PALETTES = {
  firekeeping: ['#1a0c06', '#6a2e10', '#c0602a', '#f0a040', '#ffe6a0'],
  ash: ['#121014', '#3e3a44', '#7a7480', '#b8b0bc', '#f0e8ff'],
};

function effectAt(u, lvl, data) {
  const e = u.effect;
  switch (e.type) {
    case 'capacity': return `${data.config.capacityByLevel[Math.min(lvl, data.config.capacityByLevel.length - 1)]} per stoke`;
    case 'burnCategory': return `${e.category[0].toUpperCase()}${e.category.slice(1)} burn +${pct(e.perLevel * lvl)}`;
    case 'burnAll': return `Burn time +${pct(e.perLevel * lvl)}`;
    case 'heat': return `Heat +${pct(e.perLevel * lvl)}`;
    case 'quality': return `Quality +${pct(e.perLevel * lvl)}`;
    case 'preservation':
      return `Stoke at ${fmtClock(data.config.stokeThresholdSeconds + e.thresholdPerLevel * lvl)} · Essence +${pct(e.essencePerLevel * lvl)}`;
    case 'rolls': return `Reward rolls +${pct(e.perLevel * lvl)}`;
    case 'rarityChance': return `${e.rarities.length > 1 ? 'Rare+' : 'Uncommon'} chance +${pct(e.perLevel * lvl)}`;
    case 'tagChance': return `Magical finds +${pct(e.perLevel * lvl)}`;
    default: return '';
  }
}

export class UpgradesView {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.body = $('#upgrades-body');
    this.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act="upgrade"]');
      if (!t) return;
      const id = t.dataset.id;
      const r = this.game.act((s, d) => buyUpgrade(s, d, id));
      if (r.ok) {
        sfx.upgrade();
        this.ui.toast(`${this.game.data.upgradeById[id].name} is now level ${r.level}.`);
        this.ui.bump('sparks');
      } else {
        sfx.error();
        this.ui.toast(r.error, 'error');
      }
      this.render();
    });
  }

  card(u) {
    const s = this.game.state; const d = this.game.data;
    const lvl = upgradeLevel(s, u.id);
    const max = u.costs.length;
    const cost = nextUpgradeCost(s, d, u.id);
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const afford = cost && s.sparks >= cost.sparks && s.cores >= cost.cores;
    const costTxt = cost ? `✦ ${cost.sparks}${cost.cores ? ` <span class="c-cores">+ ◆ ${cost.cores}</span>` : ''}` : '';
    return `<div class="card up-card">
      <img class="px-icon" src="${uiIconUrl(u.icon, ICON_PALETTES[u.group])}" alt="">
      <div>
        <div class="up-top"><span class="name">${esc(u.name)}</span><span class="pips" title="Level ${lvl} of ${max}">${pips}</span></div>
        <p class="desc" style="margin:2px 0">${esc(u.description)}</p>
        <div class="effect">
          <span class="now">${lvl ? esc(effectAt(u, lvl, d)) : 'Not learned'}</span>
          ${cost ? `<span class="arrow"> → </span><span class="next">${esc(effectAt(u, lvl + 1, d))}</span>` : ''}
        </div>
        ${cost ? `<button class="btn ${afford ? 'btn-primary' : ''} cost-btn" data-act="upgrade" data-id="${u.id}" ${afford ? '' : 'disabled'}>
          Level ${lvl + 1} · ${costTxt}</button>` : '<div class="maxed">MASTERED</div>'}
      </div></div>`;
  }

  render() {
    const d = this.game.data;
    const group = (g) => d.upgrades.filter((u) => u.group === g).map((u) => this.card(u)).join('');
    this.body.innerHTML = `
      <div class="up-group">
        <h3 class="section-title">Firekeeping</h3>
        <p>Tend the flame: more fuel per stoke, longer burns, richer characteristics.</p>
        <div class="list">${group('firekeeping')}</div>
      </div>
      <div class="up-group">
        <h3 class="section-title">Ash Recovery</h3>
        <p>Find more, and finer things, in what remains.</p>
        <div class="list">${group('ash')}</div>
      </div>`;
  }
}
