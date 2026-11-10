// Loads the centralized JSON game definitions and builds lookup tables.
// All balancing values live in /data/*.json — nothing gameplay-related is hardcoded here.

const FILES = ['config', 'materials', 'items', 'upgrades', 'milestones'];

export function buildData(raw) {
  const { config, materials, items, upgrades, milestones } = raw;
  const byId = {};
  const materialById = {};
  for (const m of materials) {
    const def = { ...m, kind: 'material' };
    byId[m.id] = def;
    materialById[m.id] = def;
  }
  for (const it of items) byId[it.id] = { ...it };
  const upgradeById = Object.fromEntries(upgrades.map((u) => [u.id, u]));
  const rarityIndex = Object.fromEntries(config.rarities.map((r, i) => [r, i]));

  // Every item that can drop from at least one material, in a stable journal order.
  const lootIds = new Set();
  for (const m of materials) for (const e of m.loot) lootIds.add(e.item);
  const journal = [...Object.values(byId)]
    .filter((d) => lootIds.has(d.id))
    .sort((a, b) => rarityIndex[a.rarity] - rarityIndex[b.rarity] || a.name.localeCompare(b.name));

  // Validate references early so a typo in JSON fails loudly rather than silently.
  for (const m of materials) {
    for (const e of m.loot) {
      if (!byId[e.item]) throw new Error(`Material ${m.id} loot references unknown item "${e.item}"`);
    }
  }

  return {
    config, materials: Object.values(materialById), items, upgrades, milestones,
    byId, materialById, upgradeById, rarityIndex, journal,
  };
}

export async function loadData(base = './data/') {
  const raw = {};
  await Promise.all(FILES.map(async (name) => {
    const res = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${name}.json (${res.status})`);
    raw[name] = await res.json();
  }));
  return buildData(raw);
}
