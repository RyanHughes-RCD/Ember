// Loads the centralized JSON game definitions and builds lookup tables.
// All balancing values live in /data/*.json — nothing gameplay-related is hardcoded here.

const FILES = ['config', 'materials', 'items', 'upgrades', 'milestones', 'overlays'];

export function buildData(raw) {
  const { config, materials, items, upgrades, milestones } = raw;
  const overlays = raw.overlays || [];
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
  const groups = new Set((config.upgradeGroups || []).map((g) => g.id));
  for (const u of upgrades) {
    if (groups.size && !groups.has(u.group)) throw new Error(`Upgrade ${u.id} is in unknown group "${u.group}"`);
    if (u.iconArt) checkArt(u.iconArt, `Upgrade ${u.id} icon`);
    const r = u.requires;
    if (r && r.upgrade && !upgradeById[r.upgrade]) throw new Error(`Upgrade ${u.id} requires unknown upgrade "${r.upgrade}"`);
    if (r && r.milestone && !milestones.some((m) => m.id === r.milestone)) throw new Error(`Upgrade ${u.id} requires unknown milestone "${r.milestone}"`);
    if (r && r.discovered && !byId[r.discovered]) throw new Error(`Upgrade ${u.id} requires unknown item "${r.discovered}"`);
  }
  for (const d of Object.values(byId)) if (d.icon && d.icon.art) checkArt(d.icon.art, `${d.id} icon`);
  const layers = new Set(config.overlayLayers || ['sky', 'ground-back', 'ground-front', 'overlay']);
  for (const o of overlays) {
    if (!o.sprite && !o.art) throw new Error(`Overlay ${o.id} needs a sprite or art`);
    if (o.art) checkArt(o.art, `Overlay ${o.id}`);
    if (!layers.has(o.layer)) throw new Error(`Overlay ${o.id} has unknown layer "${o.layer}"`);
    const r = o.requires;
    if (r && r.upgrade && !upgradeById[r.upgrade]) throw new Error(`Overlay ${o.id} requires unknown upgrade "${r.upgrade}"`);
    if (r && r.milestone && !milestones.some((m) => m.id === r.milestone)) throw new Error(`Overlay ${o.id} requires unknown milestone "${r.milestone}"`);
    if (r && r.discovered && !byId[r.discovered]) throw new Error(`Overlay ${o.id} requires unknown item "${r.discovered}"`);
  }

  return {
    config, materials: Object.values(materialById), items, upgrades, milestones, overlays,
    byId, materialById, upgradeById, rarityIndex, journal,
  };
}

/**
 * Inline pixel art: { w, h, rows: ["..ab..", ...], colors: { a: "#rrggbb", ... } }.
 * Each row is w characters; "." is transparent and every other character is a key in colors.
 */
export function checkArt(art, where) {
  if (!art || !Array.isArray(art.rows) || typeof art.colors !== 'object') throw new Error(`${where}: art needs rows and colors`);
  if (art.rows.length !== art.h) throw new Error(`${where}: art has ${art.rows.length} rows but h is ${art.h}`);
  art.rows.forEach((row, y) => {
    if (row.length !== art.w) throw new Error(`${where}: art row ${y} is ${row.length} wide but w is ${art.w}`);
    for (const ch of row) if (ch !== '.' && !(ch in art.colors)) throw new Error(`${where}: art uses "${ch}" with no colour`);
  });
}

export async function loadData(base = './data/') {
  const raw = {};
  await Promise.all(FILES.map(async (name) => {
    const res = await fetch(`${base}${name}.json`, { cache: 'no-cache' });
    if (!res.ok) {
      if (name === 'overlays') { raw[name] = []; return; } // optional
      throw new Error(`Failed to load ${name}.json (${res.status})`);
    }
    raw[name] = await res.json();
  }));
  return buildData(raw);
}
