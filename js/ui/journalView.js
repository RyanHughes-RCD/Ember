// Journal: endurance records, milestones and the discovery journal.

import { $, esc, fmtDur, fmtNum } from './util.js';
import { iconUrl } from './icons.js';
import { durationAt } from '../logic/fire.js';
import { enduranceBonus } from '../logic/economy.js';

export function rewardText(data, r = {}) {
  const parts = [];
  if (r.sparks) parts.push(`✦${r.sparks}`);
  if (r.cores) parts.push(`◆${r.cores} Ember Core${r.cores === 1 ? '' : 's'}`);
  if (r.items) for (const [id, n] of Object.entries(r.items)) parts.push(`${n} ${data.byId[id].name}`);
  if (r.unlock) parts.push(`${data.byId[r.unlock].name} in the shop`);
  if (r.title) parts.push(`title “${r.title}”`);
  return parts.join(' · ') || 'An achievement';
}

export class JournalView {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.body = $('#journal-body');
    this.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act="detail"]');
      if (t) this.ui.showItem(t.dataset.id);
    });
  }

  render(now = this.game.now()) {
    const s = this.game.state; const d = this.game.data;
    const cur = s.fire.status === 'burning' ? durationAt(s.fire, now) : 0;
    const longest = Math.max(s.records.longestFire, cur);
    const eb = enduranceBonus(d, cur);
    const found = d.journal.filter((it) => s.discoveries[it.id]).length;
    const title = s.titles.length ? `<p class="desc" style="text-align:center;color:var(--gold)">— ${esc(s.titles[s.titles.length - 1])} —</p>` : '';

    const ms = d.milestones.map((m) => {
      const done = s.milestones[m.id];
      const prog = Math.min(1, cur / m.seconds);
      return `<div class="card milestone ${done ? 'done' : ''}">
        <span class="nm">${done ? '★ ' : ''}${esc(m.name)}</span>
        <span class="when">${fmtDur(m.seconds)}</span>
        ${done ? '' : `<div class="bar"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>`}
        <span class="rw">${esc(m.description)} Reward: ${esc(rewardText(d, m.reward))}</span>
      </div>`;
    }).join('');

    const grid = d.journal.map((it) => {
      const known = s.discoveries[it.id];
      return `<button class="disc b-${it.rarity} ${known ? '' : 'unknown'}" data-act="detail" data-id="${it.id}">
        <img class="px-icon" src="${iconUrl(it, { silhouette: !known })}" alt="">
        <span class="nm">${known ? esc(it.name) : '???'}</span></button>`;
    }).join('');

    this.body.innerHTML = `
      ${title}
      <h3 class="section-title" style="margin:0 2px 6px">Fire Endurance</h3>
      <div class="records">
        <div class="record"><span>Current fire</span><b>${cur ? fmtDur(cur) : '—'}</b></div>
        <div class="record"><span>Endurance bonus so far</span><b>${cur ? `✦ ${fmtNum(eb.sparks)}${eb.cores ? ` ◆ ${eb.cores}` : ''}` : '—'}</b></div>
        <div class="record"><span>Longest fire</span><b>${fmtDur(longest)}</b></div>
        <div class="record"><span>Fires completed</span><b>${s.records.firesCompleted}</b></div>
        <div class="record wide"><span>Lifetime fire time</span><b>${fmtDur(s.records.totalFireTime)}</b></div>
        <div class="record"><span>Materials burned</span><b>${fmtNum(s.records.materialsBurned)}</b></div>
        <div class="record"><span>Stoking actions</span><b>${fmtNum(s.records.stokes)}</b></div>
      </div>
      <h3 class="section-title" style="margin:0 2px">Milestones</h3>
      <div class="milestones">${ms}</div>
      <div class="disc-head"><h3 class="section-title">Discoveries</h3><span class="desc">${found} / ${d.journal.length}</span></div>
      <div class="disc-grid">${grid}</div>`;
  }
}
