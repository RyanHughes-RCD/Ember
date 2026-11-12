// Permanent upgrades, split into Firekeeping and Ash Recovery.

import { $, esc, fmtClock, pct } from './util.js';
import { uiIconUrl, artUrl } from './icons.js';
import { sfx } from './audio.js';
import { upgradeLevel } from '../logic/stats.js';
import { buyUpgrade, nextUpgradeCost, meetsRequirement, requirementText } from '../logic/economy.js';

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
    case 'forageFinds': return lvl ? `${e.finds.map((f) => data.byId[f.id].name).join(' and ')} in the forage patch` : '';
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
        const up = this.game.data.upgradeById[id];
        this.ui.toast(up.costs.length === 1 ? `${up.name} bought.` : `${up.name} is now level ${r.level}.`);
        this.ui.bump('sparks');
      } else {
        sfx.error();
        this.ui.toast(r.error, 'error');
      }
      this.render();
    });
  }

  iconSrc(u) {
    if (u.iconArt) return artUrl(u.iconArt);
    if (u.iconSprite) return `assets/sprites/${u.iconSprite}.png`;
    const g = (this.game.data.config.upgradeGroups || []).find((x) => x.id === u.group);
    return uiIconUrl(u.icon || 'flame', (g && g.iconPalette) || ICON_PALETTES[u.group]);
  }

  card(u) {
    const s = this.game.state; const d = this.game.data;
    const lvl = upgradeLevel(s, u.id);
    const max = u.costs.length;
    const cost = nextUpgradeCost(s, d, u.id);
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const locked = !meetsRequirement(s, d, u.requires);
    const afford = !locked && cost && s.sparks >= cost.sparks && s.cores >= cost.cores;
    const costTxt = cost ? `✦ ${cost.sparks}${cost.cores ? ` <span class="c-cores">+ ◆ ${cost.cores}</span>` : ''}` : '';
    return `<div class="card up-card">
      <img class="px-icon${u.iconSprite || u.iconArt ? ' sprite-icon' : ''}" src="${this.iconSrc(u)}" alt="">
      <div>
        <div class="up-top"><span class="name">${esc(u.name)}</span><span class="pips" title="Level ${lvl} of ${max}">${pips}</span></div>
        <p class="desc" style="margin:2px 0">${esc(u.description)}</p>
        <div class="effect">
          <span class="now">${lvl ? esc(effectAt(u, lvl, d)) : max === 1 ? 'Not bought' : 'Not learned'}</span>
          ${cost ? `<span class="arrow"> → </span><span class="next">${esc(effectAt(u, lvl + 1, d))}</span>` : ''}
        </div>
        ${cost && locked ? `<div class="lock-hint">${esc(requirementText(d, u.requires))} to unlock</div>` : ''}
        ${cost ? `<button class="btn ${afford ? 'btn-primary' : ''} cost-btn" data-act="upgrade" data-id="${u.id}" ${afford ? '' : 'disabled'}>
          ${max === 1 ? 'Buy' : `Level ${lvl + 1}`} · ${costTxt}</button>` : `<div class="maxed">${max === 1 ? 'OWNED' : 'MASTERED'}</div>`}
      </div></div>`;
  }

  render() {
    const d = this.game.data;
    const group = (g) => d.upgrades.filter((u) => u.group === g).map((u) => this.card(u)).join('');
    const groups = d.config.upgradeGroups || [
      { id: 'firekeeping', name: 'Firekeeping', blurb: '' }, { id: 'ash', name: 'Ash Recovery', blurb: '' }];
    this.body.innerHTML = groups.filter((g) => d.upgrades.some((u) => u.group === g.id)).map((g) => `
      <div class="up-group">
        <h3 class="section-title">${esc(g.name)}</h3>
        ${g.blurb ? `<p>${esc(g.blurb)}</p>` : ''}
        <div class="list">${group(g.id)}</div>
      </div>`).join('');
  }
}
