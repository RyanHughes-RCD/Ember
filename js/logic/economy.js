// Currency, shop, selling, upgrades, passive gathering, milestones and unlocks.

import { upgradeLevel } from './stats.js';

// ---------------------------------------------------------------- endurance

/**
 * Smooth endurance bonus for a fire that burned `seconds`: no thresholds, it
 * simply grows a little faster than linearly with how long the fire was kept alive.
 */
export function enduranceBonus(data, seconds) {
  const e = data.config.endurance;
  if (!e) return { sparks: 0, cores: 0 };
  const hours = Math.max(0, seconds) / 3600;
  return {
    sparks: Math.round(e.sparksPerHour * hours ** e.sparksExponent),
    cores: Math.floor(e.coresPerHour * hours ** e.coresExponent + 1e-9),
  };
}

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

// ---------------------------------------------------------------- foraging (passive gathering)
//
// Twigs and leaves fall onto a small grassy patch over real time, even while the
// app is closed. Each one is a spawn with its own position; the player taps it to
// pick it up. At most `maxSpawns` lie on the patch at once; while it is full the
// timers pause.

const MIN_GAP = 0.2; // minimum distance between spawns, in patch units (0..1)

function placeSpawn(g, rng) {
  let best = null;
  for (let tries = 0; tries < 24; tries++) {
    const x = 0.12 + rng() * 0.76;
    const y = 0.12 + rng() * 0.76;
    const gap = Math.min(1, ...g.spawns.map((o) => Math.hypot(o.x - x, o.y - y)));
    if (!best || gap > best.gap) best = { x, y, gap };
    if (gap >= MIN_GAP) break;
  }
  return best;
}

function addSpawn(g, id, at, rng) {
  const pos = placeSpawn(g, rng);
  g.seq = (g.seq || 0) + 1;
  g.spawns.push({ key: `${at.toString(36)}-${g.seq}`, id, x: pos.x, y: pos.y, flip: rng() < 0.5, at });
}

/** Occasionally a fallen item is something rarer (e.g. a Wooden Effigy). */
function rareFind(finds, rng) {
  for (const f of finds) if (rng() < f.chance) return f.id;
  return null;
}

/** Everything that can turn up on the forage patch instead of a twig or leaf. */
export function forageFinds(state, data) {
  const out = [...(data.config.gathering.finds || [])];
  for (const u of data.upgrades) {
    if (u.effect.type === 'forageFinds' && upgradeLevel(state, u.id) > 0) out.push(...u.effect.finds);
  }
  return out;
}

/** Whether the player meets a requirement like { upgrade }, { milestone }, { discovered } or { firesCompleted }. */
export function meetsRequirement(state, data, req) {
  if (!req) return true;
  if (req.upgrade && upgradeLevel(state, req.upgrade) < (req.level || 1)) return false;
  if (req.milestone && !state.milestones[req.milestone]) return false;
  if (req.discovered && !state.discoveries[req.discovered] && !state.seenMaterials[req.discovered]) return false;
  if (req.firesCompleted !== undefined && state.records.firesCompleted < req.firesCompleted) return false;
  return true;
}

/** Campsite overlays the player can see right now (e.g. the hatchet once Improved Foraging is bought). */
export function visibleOverlays(state, data) {
  return (data.overlays || []).filter((o) => meetsRequirement(state, data, o.requires));
}

/** Advance foraging to `now`, spawning items in the order their timers complete. */
export function accrueGathering(state, data, now, rng = Math.random) {
  const g = state.gathering;
  const cfg = data.config.gathering;
  if (!Array.isArray(g.spawns)) g.spawns = [];
  g.accum = g.accum || {};
  // Older saves stored whole items in the basket counters: turn those into spawns.
  for (const src of cfg.sources) {
    while ((g.accum[src.id] || 0) >= 1 && g.spawns.length < cfg.maxSpawns) {
      g.accum[src.id] -= 1;
      addSpawn(g, src.id, now, rng);
    }
    if ((g.accum[src.id] || 0) >= 1) g.accum[src.id] %= 1;
  }
  if (!g.lastUpdated || now < g.lastUpdated) {
    g.lastUpdated = now;
    return;
  }
  let remaining = (now - g.lastUpdated) / 1000;
  const finds = forageFinds(state, data);
  let t = g.lastUpdated;
  while (remaining > 1e-9 && g.spawns.length < cfg.maxSpawns) {
    let best = null; let wait = Infinity;
    for (const src of cfg.sources) {
      const w = (1 - (g.accum[src.id] || 0)) * src.everySeconds;
      if (w < wait) { wait = w; best = src; }
    }
    const step = Math.min(wait, remaining);
    for (const src of cfg.sources) g.accum[src.id] = (g.accum[src.id] || 0) + step / src.everySeconds;
    remaining -= step;
    t += step * 1000;
    if (step === wait) {
      g.accum[best.id] = Math.max(0, g.accum[best.id] - 1);
      addSpawn(g, rareFind(finds, rng) || best.id, Math.round(t), rng);
    }
  }
  g.lastUpdated = now;
}

export function spawnCount(state) {
  return (state.gathering.spawns || []).length;
}

/** Seconds until the next item falls onto the patch (null while it is full). */
export function nextGatherIn(state, data) {
  const cfg = data.config.gathering;
  if (spawnCount(state) >= cfg.maxSpawns) return null;
  let best = null;
  for (const src of cfg.sources) {
    const t = (1 - (state.gathering.accum[src.id] || 0)) * src.everySeconds;
    if (best === null || t < best) best = t;
  }
  return best;
}

/** Pick up one item from the patch. */
export function pickUp(state, data, key) {
  const g = state.gathering;
  const i = (g.spawns || []).findIndex((o) => o.key === key);
  if (i < 0) return { ok: false };
  const [spawn] = g.spawns.splice(i, 1);
  state.inventory[spawn.id] = (state.inventory[spawn.id] || 0) + 1;
  state.seenMaterials[spawn.id] = true;
  return { ok: true, id: spawn.id };
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
  if (spawnCount(state) > 0) return false;
  const cheapest = Math.min(...data.materials.filter((m) => m.price && isUnlocked(state, data, m.id)).map((m) => m.price));
  return state.sparks + treasureValue(state, data) < cheapest;
}

/** Emergency: when the player is stuck, kindling appears on the forage patch right away. */
export function forage(state, data, now = Date.now(), rng = Math.random) {
  if (!canForage(state, data)) return { ok: false };
  const g = state.gathering;
  if (!Array.isArray(g.spawns)) g.spawns = [];
  for (const [id, n] of Object.entries(data.config.forage.grant)) {
    for (let i = 0; i < n && g.spawns.length < data.config.gathering.maxSpawns; i++) addSpawn(g, id, now, rng);
  }
  return { ok: true, grant: data.config.forage.grant };
}
