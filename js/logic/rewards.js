// Ash reward generation. Every burned material rolls its OWN loot table.
//
// For each burned material:
//   rolls      = ashYield × (1 + Fine Ash Sieve bonus); fractional part is a chance of one extra roll
//   per roll, every loot entry is checked independently with its modified chance
//   modifiers  = blend of this material's own characteristics and the whole fire's average:
//     Quality  → boosts uncommon+ entries, more so the rarer they are (never commons)
//     Heat     → boosts entries tagged "heat"   (charcoal, clinker, ember cores, obsidian…)
//     Essence  → boosts entries tagged "magic"  (spores, dust, fragments, relics…)
//   upgrades  → Careful Recovery (uncommon), Lucky Charm (rare+), Ancient Knowledge (magic)

import { effectiveMaterial, rollBonus, rarityBonus, tagBonus } from './stats.js';

export function chanceFor(entry, mat, fireAvg, state, data) {
  const cfg = data.config.rewards;
  const item = data.byId[entry.item];
  const tier = data.rarityIndex[item.rarity];
  const w = cfg.fireAverageWeight;
  const q = mat.quality * (1 - w) + fireAvg.quality * w;
  const h = mat.heat * (1 - w) + fireAvg.heat * w;
  const e = mat.essence * (1 - w) + fireAvg.essence * w;
  const tags = item.tags || [];

  let mult = 1;
  if (tier > 0) mult *= 1 + q * cfg.qualityPerTier * tier;
  if (tags.includes('heat')) mult *= 1 + h * cfg.heatBonusPerPoint;
  if (tags.includes('magic')) mult *= (1 + e * cfg.essenceBonusPerPoint) * (1 + tagBonus(state, data, 'magic'));
  mult *= 1 + rarityBonus(state, data, item.rarity);

  const p = entry.chance * mult;
  return Math.min(p, Math.max(cfg.maxChance, entry.chance));
}

export function fireAverages(fire) {
  const n = Math.max(1, fire.materialsCount);
  return { heat: fire.totalHeat / n, quality: fire.totalQuality / n, essence: fire.totalEssence / n };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Generate the combined loot for a finished fire.
 * Returns [{ id, qty }] sorted rarest first. Pure apart from the supplied rng.
 */
export function generateRewards(state, data, fire, rng = Math.random) {
  const totals = {};
  const avg = fireAverages(fire);
  const sieve = rollBonus(state, data);

  for (const [id, count] of Object.entries(fire.materialsBurned)) {
    const def = data.materialById[id];
    if (!def) continue; // material removed from data in a later version — skip safely
    const mat = effectiveMaterial(state, data, id);
    const chances = def.loot.map((entry) => chanceFor(entry, mat, avg, state, data));
    for (let n = 0; n < count; n++) {
      const exact = mat.ashYield * (1 + sieve);
      let rolls = Math.floor(exact);
      if (rng() < exact - rolls) rolls += 1;
      for (let r = 0; r < rolls; r++) {
        def.loot.forEach((entry, i) => {
          if (rng() < chances[i]) {
            totals[entry.item] = (totals[entry.item] || 0) + randInt(rng, entry.min, entry.max);
          }
        });
      }
    }
  }

  return Object.entries(totals)
    .map(([id, qty]) => ({ id, qty }))
    .sort((a, b) => data.rarityIndex[data.byId[b.id].rarity] - data.rarityIndex[data.byId[a.id].rarity] ||
      data.byId[a.id].name.localeCompare(data.byId[b.id].name));
}
