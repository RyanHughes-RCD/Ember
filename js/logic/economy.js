// Currency, shop, selling, upgrades, passive gathering, milestones and unlocks.

import { upgradeLevel } from './stats.js';

// ---------------------------------------------------------------- milestones

export function checkMilestones(state, data, duration, now) {
  const events = [];
  for (const m of data.milestones) {
    if (state.milestones[m.id] || duration < m.seconds) continue;
    state.milestones[m.id] = now;
    grantReward(state, data, m.reward);
    events.push({ type: 'milestone', id: m.id });
  }
  return events;
}

function grantReward(state, data, reward = {}) {
  if (reward.sparks) {
    state.sparks += reward.sparks;
    state.records.sparksEarned += reward.sparks;
  }
  if (reward.cores) state.cores += reward.cores;
  if (reward.items) {
    for (const [id, n] of Object.entries(reward.items)) {
      if (!data.byId[id]) continue;
      state.inventory[id] = (state.inventory[id] || 0) + n;
      if (data.materialById[id]) state.seenMaterials[id] = true;
    }
  }
  if (reward.unlock) state.unlocks[reward.unlock] = true;
  if (reward.title && !state.titles.includes(reward.title)) state.titles.push(reward.title);
}

// ---------------------------------------------------------------- unlocks / shop

export function isUnlocked(state, data, materialId) {
  const m = data.materialById[materialId];
  if (!m) return false;
  if (state.unlocks[materialId]) return true;
  const u = m.unlock;
  if (!u) return true;
  if (u.firesCompleted !== undefined) return state.records.firesCompleted >= u.firesCompleted;
  if (u.milestone) return Boolean(state.milestones[u.milestone]);
  if (u.discovered) return Boolean(state.discoveries[u.discovered]);
  if (u.longestFire !== undefined) return state.records.longestFire >= u.longestFire;
  return false;
}

export function unlockHint(data, materialId) {
  const u = data.materialById[materialId].unlock;
  if (!u) return '';
  if (u.firesCompleted !== undefined) {
    return `Let ${u.firesCompleted} fire${u.firesCompleted === 1 ? '' : 's'} burn out`;
  }
  if (u.milestone) {
    const m = data.milestones.find((x) => x.id === u.milestone);
    return m ? `Reach the “${m.name}” milestone` : 'Reach a milestone';
  }
  if (u.discovered) return `Find ${data.byId[u.discovered].name} in the ashes`;
  return 'Locked';
}

export function buyMaterial(state, data, id, qty = 1) {
  const m = data.materialById[id];
  if (!m || !m.price) return { ok: false, error: 'Not for sale.' };
  if (!isUnlocked(state, data, id)) return { ok: false, error: 'Not available yet.' };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: 'Invalid amount.' };
  const cost = m.price * qty;
  if (state.sparks < cost) return { ok: false, error: 'Not enough Sparks.' };
  state.sparks -= cost;
  state.inventory[id] = (state.inventory[id] || 0) + qty;
  state.seenMaterials[id] = true;
  return { ok: true, cost };
}

export function sellValue(data, id) {
  const def = data.byId[id];
  if (!def || def.kind !== 'treasure') return 0;
  return Math.max(1, Math.round(def.value * data.config.sellRate));
}

export function sellItem(state, data, id, qty) {
  const have = state.inventory[id] || 0;
  const value = sellValue(data, id);
  if (!value) return { ok: false, error: 'That cannot be sold.' };
  if (!Number.isInteger(qty) || qty < 1 || qty > have) return { ok: false, error: 'Not enough to sell.' };
  state.inventory[id] = have - qty;
  if (state.inventory[id] <= 0) delete state.inventory[id];
  const gain = value * qty;
  state.sparks += gain;
  state.records.sparksEarned += gain;
  return { ok: true, gain };
}

export function treasureValue(state, data) {
  let v = 0;
  for (const [id, n] of Object.entries(state.inventory)) v += sellValue(data, id) * n;
  return v;
}

export function sellAllTreasures(state, data) {
  let gain = 0;
  for (const [id, n] of Object.entries({ ...state.inventory })) {
    if (sellValue(data, id) > 0) gain += sellItem(state, data, id, n).gain || 0;
  }
  return { ok: gain > 0, gain };
}

// ---------------------------------------------------------------- upgrades

export function nextUpgradeCost(state, data, id) {
  const u = data.upgradeById[id];
  const lvl = upgradeLevel(state, id);
  if (lvl >= u.costs.length) return null; // maxed
  return { sparks: 0, cores: 0, ...u.costs[lvl] };
}

export function buyUpgrade(state, data, id) {
  const u = data.upgradeById[id];
  if (!u) return { ok: false, error: 'Unknown upgrade.' };
  const cost = nextUpgradeCost(state, data, id);
  if (!cost) return { ok: false, error: 'Already at maximum level.' };
  if (state.sparks < cost.sparks) return { ok: false, error: 'Not enough Sparks.' };
  if (state.cores < cost.cores) return { ok: false, error: 'Not enough Ember Cores.' };
  state.sparks -= cost.sparks;
  state.cores -= cost.cores;
  state.upgrades[id] = upgradeLevel(state, id) + 1;
  return { ok: true, level: state.upgrades[id] };
}

// ---------------------------------------------------------------- passive gathering

/** Accrue basket contents from elapsed real time (works across app closures). */
export function accrueGathering(state, data, now) {
  const g = state.gathering;
  if (!g.lastUpdated || now < g.lastUpdated) {
    g.lastUpdated = now;
    return;
  }
  const elapsed = (now - g.lastUpdated) / 1000;
  for (const src of data.config.gathering.sources) {
    const cur = g.accum[src.id] || 0;
    g.accum[src.id] = Math.min(src.cap, cur + elapsed / src.everySeconds);
  }
  g.lastUpdated = now;
}

export function basketContents(state, data) {
  const out = {};
  for (const src of data.config.gathering.sources) {
    const n = Math.floor((state.gathering.accum[src.id] || 0) + 1e-9);
    if (n > 0) out[src.id] = n;
  }
  return out;
}

/** Seconds until the next item arrives in the basket (null if everything is full). */
export function nextGatherIn(state, data) {
  let best = null;
  for (const src of data.config.gathering.sources) {
    const cur = state.gathering.accum[src.id] || 0;
    if (cur >= src.cap) continue;
    const t = (1 - (cur % 1)) * src.everySeconds;
    if (best === null || t < best) best = t;
  }
  return best;
}

export function collectBasket(state, data, now) {
  accrueGathering(state, data, now);
  const got = basketContents(state, data);
  for (const [id, n] of Object.entries(got)) {
    state.inventory[id] = (state.inventory[id] || 0) + n;
    state.gathering.accum[id] -= n;
    state.seenMaterials[id] = true;
  }
  return got;
}

// ---------------------------------------------------------------- safety net

export function burnableCount(state, data) {
  let n = 0;
  for (const [id, c] of Object.entries(state.inventory)) if (data.materialById[id]) n += c;
  return n;
}

/** True only when the player genuinely cannot restart their fire any other way. */
export function canForage(state, data) {
  if (state.fire.status !== 'cold') return false;
  if (burnableCount(state, data) > 0) return false;
  if (Object.keys(basketContents(state, data)).length > 0) return false;
  const cheapest = Math.min(...data.materials.filter((m) => m.price && isUnlocked(state, data, m.id)).map((m) => m.price));
  return state.sparks + treasureValue(state, data) < cheapest;
}

export function forage(state, data) {
  if (!canForage(state, data)) return { ok: false };
  for (const [id, n] of Object.entries(data.config.forage.grant)) {
    state.inventory[id] = (state.inventory[id] || 0) + n;
    state.seenMaterials[id] = true;
  }
  return { ok: true, grant: data.config.forage.grant };
}
