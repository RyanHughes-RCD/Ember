// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildData } from '../js/data.js';
import { createNewSave, migrate, SaveStore, emptyFire } from '../js/logic/state.js';
import { settle, stoke, collectAsh, remainingAt, canStokeNow, durationAt } from '../js/logic/fire.js';
import { generateRewards } from '../js/logic/rewards.js';
import {
  buyMaterial, buyUpgrade, sellAllTreasures, accrueGathering, collectBasket, canForage, forage, isUnlocked,
} from '../js/logic/economy.js';
import { getCapacity, getThreshold, effectiveMaterial } from '../js/logic/stats.js';

const load = (n) => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url)));
const data = buildData({
  config: load('config'), materials: load('materials'), items: load('items'),
  upgrades: load('upgrades'), milestones: load('milestones'),
});

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const T0 = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;

class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('new save starts with a forgiving welcome fire near the threshold', () => {
  const s = createNewSave(data, T0);
  assert.equal(s.fire.status, 'burning');
  assert.ok(s.fire.remaining > getThreshold(s, data));
  assert.equal(getCapacity(s, data), 1);
  assert.equal(canStokeNow(s, data, T0), false);
  assert.equal(canStokeNow(s, data, T0 + 31_000), true);
});

test('cannot stoke above threshold; can at/below it', () => {
  const s = createNewSave(data, T0);
  const r1 = stoke(s, data, { pine_log: 1 }, T0);
  assert.equal(r1.ok, false);
  assert.equal(s.inventory.pine_log, 3, 'nothing consumed on a refused stoke');
  const at = T0 + 30_000; // remaining exactly 300
  const r2 = stoke(s, data, { pine_log: 1 }, at);
  assert.equal(r2.ok, true);
  assert.equal(s.inventory.pine_log, 2);
  assert.equal(Math.round(remainingAt(s.fire, at)), 300 + 900);
});

test('capacity limits the number of individual items', () => {
  const s = createNewSave(data, T0);
  const at = T0 + 60_000;
  assert.equal(stoke(s, data, { twigs: 2 }, at).ok, false);
  assert.equal(stoke(s, data, { twigs: 1, dry_leaves: 1 }, at).ok, false);
  s.upgrades.capacity = 2; // 3 slots
  const r = stoke(s, data, { twigs: 2, dry_leaves: 1 }, at);
  assert.equal(r.ok, true);
  assert.equal(s.inventory.twigs, 4);
  assert.equal(s.inventory.dry_leaves, 5);
  assert.equal(s.fire.materialsBurned.twigs, 3); // 1 from welcome fire + 2
});

test('insufficient inventory is refused without consuming anything', () => {
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6;
  const at = T0 + 60_000;
  const r = stoke(s, data, { pine_log: 4 }, at);
  assert.equal(r.ok, false);
  assert.match(r.error, /Not enough/);
  assert.equal(s.inventory.pine_log, 3);
  assert.equal(stoke(s, data, { oak_log: 1 }, at).ok, false);
});

test('offline expiry extinguishes once, at the right time, and stores rewards', () => {
  const s = createNewSave(data, T0);
  stoke(s, data, { pine_log: 1 }, T0 + 30_000); // 300 + 900 = 1200s left
  const events = settle(s, data, T0 + 10 * HOUR, seeded(3));
  assert.ok(events.some((e) => e.type === 'extinguished'));
  assert.equal(s.fire.status, 'ash');
  assert.ok(s.pendingAsh);
  assert.equal(Math.round(s.pendingAsh.duration), 30 + 1200);
  assert.equal(Math.round(s.records.longestFire), 1230);
  assert.equal(s.records.firesCompleted, 1);
  // settling again (e.g. after a refresh) must not regenerate
  const before = JSON.stringify(s.pendingAsh);
  assert.deepEqual(settle(s, data, T0 + 11 * HOUR, seeded(9)), []);
  assert.equal(JSON.stringify(s.pendingAsh), before);
  assert.equal(s.records.firesCompleted, 1);
});

test('refresh during an active fire keeps an accurate countdown', () => {
  const store = new SaveStore('t', new MemStorage());
  const s = createNewSave(data, T0);
  stoke(s, data, { pine_log: 1 }, T0 + 30_000);
  store.save(s);
  const { state } = store.load(data, T0 + 10 * MIN);
  settle(state, data, T0 + 10 * MIN);
  assert.equal(Math.round(remainingAt(state.fire, T0 + 10 * MIN)), 1200 - (10 * 60 - 30));
  assert.equal(Math.round(durationAt(state.fire, T0 + 10 * MIN)), 600);
});

test('refresh during pending ash keeps rewards and never duplicates them', () => {
  const store = new SaveStore('t', new MemStorage());
  const s = createNewSave(data, T0);
  stoke(s, data, { pine_log: 1 }, T0 + 30_000);
  settle(s, data, T0 + 2 * HOUR, seeded(5));
  store.save(s);
  const pending = JSON.stringify(s.pendingAsh);
  const { state: s2 } = store.load(data, T0 + 3 * HOUR);
  settle(s2, data, T0 + 3 * HOUR);
  assert.equal(JSON.stringify(s2.pendingAsh), pending);
  const got = collectAsh(s2, data, T0 + 3 * HOUR);
  store.save(s2);
  assert.ok(got);
  assert.equal(collectAsh(s2, data, T0 + 3 * HOUR), null, 'second collect is a no-op');
  const { state: s3 } = store.load(data, T0 + 4 * HOUR);
  assert.equal(s3.pendingAsh, null);
  assert.equal(s3.fire.status, 'cold');
  for (const r of got.rewards) assert.ok(s3.discoveries[r.id].count >= r.qty);
});

test('every burned material type contributes its own loot table', () => {
  const s = createNewSave(data, T0);
  const fire = { ...emptyFire(), materialsBurned: { pine_log: 40, glowcap: 40, coal: 40 }, materialsCount: 120 };
  for (const id of Object.keys(fire.materialsBurned)) {
    const m = effectiveMaterial(s, data, id);
    fire.totalHeat += m.heat * 40; fire.totalQuality += m.quality * 40; fire.totalEssence += m.essence * 40;
  }
  const rewards = generateRewards(s, data, fire, seeded(11));
  const ids = new Set(rewards.map((r) => r.id));
  assert.ok(ids.has('resin'), 'pine table');
  assert.ok(ids.has('luminescent_spores'), 'glowcap table');
  assert.ok(ids.has('clinker'), 'coal table');
  // only items present in burned materials' tables
  const allowed = new Set(['pine_log', 'glowcap', 'coal'].flatMap((id) => data.materialById[id].loot.map((e) => e.item)));
  for (const r of rewards) assert.ok(allowed.has(r.id), `${r.id} must come from a burned material`);
});

test('essence favours magic, heat favours heat items', () => {
  const s = createNewSave(data, T0);
  const avgOf = (burned) => {
    const fire = { ...emptyFire(), materialsBurned: burned, materialsCount: 0 };
    for (const [id, n] of Object.entries(burned)) {
      const m = effectiveMaterial(s, data, id);
      fire.materialsCount += n; fire.totalHeat += m.heat * n;
      fire.totalQuality += m.quality * n; fire.totalEssence += m.essence * n;
    }
    let magic = 0; let heat = 0;
    for (let i = 0; i < 30; i++) {
      for (const r of generateRewards(s, data, fire, seeded(i + 1))) {
        if (r.id === 'magic_dust') magic += r.qty;
        if (r.id === 'charcoal') heat += r.qty;
      }
    }
    return { magic, heat };
  };
  const plain = avgOf({ herbs: 20, pine_log: 20 });
  const mystic = avgOf({ herbs: 20, pine_log: 20, moonstone: 20 });
  const hot = avgOf({ herbs: 20, pine_log: 20, coal: 20 });
  assert.ok(mystic.magic > plain.magic, 'moonstone essence should raise magic dust from herbs');
  assert.ok(hot.heat > plain.heat, 'coal heat should raise charcoal');
});

test('upgrades: purchase, cost, capacity and effects', () => {
  const s = createNewSave(data, T0);
  s.sparks = 10_000;
  assert.equal(buyUpgrade(s, data, 'capacity').ok, true);
  assert.equal(getCapacity(s, data), 2);
  for (let i = 0; i < 4; i++) buyUpgrade(s, data, 'capacity');
  assert.equal(getCapacity(s, data), 5);
  assert.equal(buyUpgrade(s, data, 'capacity').ok, false, 'needs cores');
  s.cores = 20; s.sparks = 100_000;
  buyUpgrade(s, data, 'capacity'); buyUpgrade(s, data, 'capacity');
  assert.equal(getCapacity(s, data), 10);
  assert.equal(buyUpgrade(s, data, 'capacity').ok, false, 'maxed');
  buyUpgrade(s, data, 'seasoned_wood');
  assert.equal(effectiveMaterial(s, data, 'pine_log').burnSeconds, 990);
  assert.equal(effectiveMaterial(s, data, 'glowcap').burnSeconds, 720);
  buyUpgrade(s, data, 'ember_preservation');
  assert.equal(getThreshold(s, data), 390);
});

test('shop, selling and unlocks', () => {
  const s = createNewSave(data, T0);
  assert.equal(isUnlocked(s, data, 'oak_log'), false);
  assert.equal(buyMaterial(s, data, 'oak_log').ok, false);
  assert.equal(buyMaterial(s, data, 'pine_log', 1).ok, true);
  assert.equal(s.sparks, 30 - 18);
  assert.equal(buyMaterial(s, data, 'pine_log', 1).ok, false, 'cannot afford');
  s.inventory.fine_ash = 10; s.inventory.old_coin = 1;
  const r = sellAllTreasures(s, data);
  assert.equal(r.gain, 70);
  assert.equal(s.inventory.pine_log, 4, 'materials are not sold');
});

test('milestones award once and unlock materials', () => {
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6;
  s.inventory.pine_log = 10;
  stoke(s, data, { pine_log: 10 }, T0 + 30_000);
  const ev = settle(s, data, T0 + 2 * HOUR);
  const ids = ev.filter((e) => e.type === 'milestone').map((e) => e.id);
  assert.deepEqual(ids, ['m15', 'm30', 'm60']);
  assert.equal(isUnlocked(s, data, 'oak_log'), true);
  assert.equal(s.inventory.oak_log, 2);
  assert.deepEqual(settle(s, data, T0 + 2 * HOUR + 1000).filter((e) => e.type === 'milestone'), []);
});

test('passive gathering accrues offline, caps, and collects', () => {
  const s = createNewSave(data, T0);
  accrueGathering(s, data, T0 + 30 * MIN);
  const got = collectBasket(s, data, T0 + 30 * MIN);
  assert.equal(got.dry_leaves, 6);
  assert.equal(got.twigs, 2);
  accrueGathering(s, data, T0 + 100 * HOUR);
  const got2 = collectBasket(s, data, T0 + 100 * HOUR);
  assert.equal(got2.dry_leaves, 8);
  assert.equal(got2.twigs, 5);
});

test('player can never be locked out of restarting', () => {
  const s = createNewSave(data, T0);
  s.fire.status = 'cold'; s.inventory = {}; s.sparks = 0;
  assert.equal(canForage(s, data), true);
  assert.equal(forage(s, data).ok, true);
  assert.equal(canForage(s, data), false);
  assert.equal(stoke(s, data, { twigs: 1 }, T0).ok, true, 'lighting a cold fire ignores the threshold');
  assert.equal(s.fire.status, 'burning');
});

test('clock moving backwards never adds or removes fire time', () => {
  const s = createNewSave(data, T0);
  settle(s, data, T0 - HOUR);
  assert.equal(s.fire.remaining, 330);
});

test('corrupt saves fall back to backup; storage failures do not throw', () => {
  const mem = new MemStorage();
  const store = new SaveStore('k', mem);
  const s = createNewSave(data, T0);
  store.save(s);
  s.sparks = 999;
  store.save(s);
  mem.setItem('k', '{not json');
  const { state, source } = store.load(data, T0);
  assert.equal(source, 'k-backup');
  assert.equal(state.sparks, 30);
  const broken = new SaveStore('k', { getItem() { return null; }, setItem() { throw new Error('quota'); }, removeItem() {} });
  assert.equal(broken.save(s), false);
});

test('migration fills missing fields without losing data', () => {
  const s = createNewSave(data, T0);
  const raw = JSON.parse(JSON.stringify(s));
  delete raw.settings; delete raw.gathering; raw.inventory = { coal: 3 };
  const m = migrate(raw, data, T0);
  assert.equal(m.settings.sound, true);
  assert.deepEqual(m.inventory, { coal: 3 });
  assert.throws(() => migrate({ version: 99 }, data, T0));
});
