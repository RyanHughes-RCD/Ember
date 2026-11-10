// Derived values that depend on permanent upgrades.

export function upgradeLevel(state, id) {
  return state.upgrades[id] || 0;
}

function effectSum(state, data, type, pick) {
  let total = 0;
  for (const u of data.upgrades) {
    if (u.effect.type !== type) continue;
    const lvl = upgradeLevel(state, u.id);
    if (lvl > 0) total += pick(u.effect, lvl);
  }
  return total;
}

export function getCapacity(state, data) {
  const levels = data.config.capacityByLevel;
  const lvl = Math.min(upgradeLevel(state, 'capacity'), levels.length - 1);
  return levels[lvl];
}

export function getThreshold(state, data) {
  return data.config.stokeThresholdSeconds +
    effectSum(state, data, 'preservation', (e, l) => e.thresholdPerLevel * l);
}

export function rollBonus(state, data) {
  return effectSum(state, data, 'rolls', (e, l) => e.perLevel * l);
}

export function rarityBonus(state, data, rarity) {
  return effectSum(state, data, 'rarityChance', (e, l) => (e.rarities.includes(rarity) ? e.perLevel * l : 0));
}

export function tagBonus(state, data, tag) {
  return effectSum(state, data, 'tagChance', (e, l) => (e.tag === tag ? e.perLevel * l : 0));
}

/** A material's characteristics after permanent upgrades are applied. */
export function effectiveMaterial(state, data, id) {
  const m = data.materialById[id];
  const burnMult = 1 +
    effectSum(state, data, 'burnAll', (e, l) => e.perLevel * l) +
    effectSum(state, data, 'burnCategory', (e, l) => (e.category === m.category ? e.perLevel * l : 0));
  const heatMult = 1 + effectSum(state, data, 'heat', (e, l) => e.perLevel * l);
  const qualMult = 1 + effectSum(state, data, 'quality', (e, l) => e.perLevel * l);
  const essMult = 1 + effectSum(state, data, 'preservation', (e, l) => e.essencePerLevel * l);
  return {
    burnSeconds: Math.round(m.burnSeconds * burnMult),
    heat: round1(m.heat * heatMult),
    quality: round1(m.quality * qualMult),
    essence: round1(m.essence * essMult),
    ashYield: m.ashYield,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
