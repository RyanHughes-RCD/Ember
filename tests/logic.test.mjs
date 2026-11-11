// Run with:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildData } from '../js/data.js';
import { createNewSave, migrate, SaveStore, emptyFire } from '../js/logic/state.js';
import { settle, stoke, collectAsh, remainingAt, canStokeNow, durationAt, tintAt } from '../js/logic/fire.js';
import { generateRewards } from '../js/logic/rewards.js';
import {
  buyMaterial, buyUpgrade, sellAllTreasures, enduranceBonus, accrueGathering, pickUp, nextGatherIn, canForage, forage, isUnlocked,
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
  const at = T0 + 30_000; // remaining exactly at the threshold
  const r2 = stoke(s, data, { pine_log: 1 }, at);
  assert.equal(r2.ok, true);
  assert.equal(s.inventory.pine_log, 2);
  assert.equal(Math.round(remainingAt(s.fire, at)), 2700 + 5400);
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
  stoke(s, data, { pine_log: 1 }, T0 + 30_000); // 2700 + 5400 = 8100s left
  const events = settle(s, data, T0 + 10 * HOUR, seeded(3));
  assert.ok(events.some((e) => e.type === 'extinguished'));
  assert.equal(s.fire.status, 'ash');
  assert.ok(s.pendingAsh);
  assert.equal(Math.round(s.pendingAsh.duration), 30 + 8100);
  assert.equal(Math.round(s.records.longestFire), 8130);
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
  assert.equal(Math.round(remainingAt(state.fire, T0 + 10 * MIN)), 8100 - (10 * 60 - 30));
  assert.equal(Math.round(durationAt(state.fire, T0 + 10 * MIN)), 600);
});

test('refresh during pending ash keeps rewards and never duplicates them', () => {
  const store = new SaveStore('t', new MemStorage());
  const s = createNewSave(data, T0);
  stoke(s, data, { pine_log: 1 }, T0 + 30_000);
  settle(s, data, T0 + 5 * HOUR, seeded(5));
  store.save(s);
  const pending = JSON.stringify(s.pendingAsh);
  const { state: s2 } = store.load(data, T0 + 6 * HOUR);
  settle(s2, data, T0 + 6 * HOUR);
  assert.equal(JSON.stringify(s2.pendingAsh), pending);
  const got = collectAsh(s2, data, T0 + 6 * HOUR);
  store.save(s2);
  assert.ok(got);
  assert.equal(collectAsh(s2, data, T0 + 6 * HOUR), null, 'second collect is a no-op');
  const { state: s3 } = store.load(data, T0 + 7 * HOUR);
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
  assert.equal(effectiveMaterial(s, data, 'pine_log').burnSeconds, 5940);
  assert.equal(effectiveMaterial(s, data, 'glowcap').burnSeconds, 4500);
  buyUpgrade(s, data, 'ember_preservation');
  assert.equal(getThreshold(s, data), 3300);
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
  const ev = settle(s, data, T0 + 3 * HOUR + MIN);
  const ids = ev.filter((e) => e.type === 'milestone').map((e) => e.id);
  assert.deepEqual(ids, ['e01', 'e02', 'e03', 'e04']);
  assert.equal(isUnlocked(s, data, 'oak_log'), true);
  assert.equal(s.inventory.oak_log, 2);
  assert.deepEqual(settle(s, data, T0 + 3 * HOUR + 2 * MIN).filter((e) => e.type === 'milestone'), []);
});

test('milestone ladder is evenly spaced and strictly increasing', () => {
  for (let i = 1; i < data.milestones.length; i++) {
    const ratio = data.milestones[i].seconds / data.milestones[i - 1].seconds;
    assert.ok(ratio > 1.2 && ratio <= 1.6, `step ${i} ratio ${ratio}`);
    assert.ok(data.milestones[i].reward.sparks > data.milestones[i - 1].reward.sparks);
  }
});

test('endurance bonus is a smooth curve, granted once with the ashes', () => {
  let prev = -1;
  for (let m = 0; m <= 72 * 60; m += 30) {
    const b = enduranceBonus(data, m * 60);
    assert.ok(b.sparks >= prev, 'never decreases');
    // no jumps: each half hour adds no more than the curve's own slope (plus rounding)
    const e = data.config.endurance; const h = m / 60 + 0.5;
    assert.ok(b.sparks - Math.max(prev, 0) <= 0.5 * e.sparksPerHour * e.sparksExponent * h ** (e.sparksExponent - 1) + 1, 'no jumps between half-hour steps');
    prev = b.sparks;
  }
  assert.deepEqual(enduranceBonus(data, 0), { sparks: 0, cores: 0 });
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6; s.inventory.oak_log = 10;
  stoke(s, data, { oak_log: 10 }, T0 + 30_000);
  settle(s, data, T0 + 60 * HOUR, seeded(2));
  const expected = enduranceBonus(data, s.pendingAsh.duration);
  assert.deepEqual(s.pendingAsh.endurance, expected);
  assert.ok(expected.cores >= 3);
  const sparks = s.sparks; const cores = s.cores;
  collectAsh(s, data, T0 + 60 * HOUR);
  assert.equal(s.sparks, sparks + expected.sparks);
  assert.equal(s.cores - cores >= expected.cores, true);
  collectAsh(s, data, T0 + 60 * HOUR);
  assert.equal(s.sparks, sparks + expected.sparks, 'not granted twice');
});

test('foraging spawns items offline at the basket rates, capped at 6 in total', () => {
  const s = createNewSave(data, T0);
  accrueGathering(s, data, T0 + 5 * HOUR, seeded(4));
  const ids = s.gathering.spawns.map((o) => o.id).sort();
  // leaves every 50m, twigs every 2h: L L T L L T fills the patch by the 4-hour mark
  assert.deepEqual(ids, ['dry_leaves', 'dry_leaves', 'dry_leaves', 'dry_leaves', 'twigs', 'twigs']);
  accrueGathering(s, data, T0 + 200 * HOUR, seeded(5));
  assert.equal(s.gathering.spawns.length, 6, 'never more than 6 on the patch');
  assert.equal(nextGatherIn(s, data), null, 'timers pause while full');
  for (const o of s.gathering.spawns) {
    assert.ok(o.x >= 0.1 && o.x <= 0.9 && o.y >= 0.1 && o.y <= 0.9, 'inside the patch');
  }
});

test('foraging mixes twigs in at their own rate and resumes after pickups', () => {
  const s = createNewSave(data, T0);
  accrueGathering(s, data, T0 + 2 * HOUR + MIN, seeded(6));
  const count = (id) => s.gathering.spawns.filter((o) => o.id === id).length;
  assert.equal(count('dry_leaves'), 2);
  assert.equal(count('twigs'), 1);
  const before = s.inventory.twigs;
  const twig = s.gathering.spawns.find((o) => o.id === 'twigs');
  assert.equal(pickUp(s, data, twig.key).ok, true);
  assert.equal(s.inventory.twigs, before + 1);
  assert.equal(pickUp(s, data, twig.key).ok, false, 'cannot pick the same item twice');
  assert.equal(s.gathering.spawns.length, 2);
});

test('foraging occasionally turns up a Wooden Effigy', () => {
  const s = createNewSave(data, T0);
  let effigies = 0; let total = 0;
  const rng = seeded(21);
  for (let day = 0; day < 400; day++) {
    accrueGathering(s, data, T0 + (day + 1) * 6 * HOUR, rng);
    for (const o of [...s.gathering.spawns]) {
      total++;
      if (o.id === 'wooden_effigy') effigies++;
      pickUp(s, data, o.key);
    }
  }
  const rate = effigies / total;
  assert.ok(rate > 0.02 && rate < 0.07, `about 4% of finds (${(rate * 100).toFixed(1)}%)`);
  assert.ok(s.seenMaterials.wooden_effigy, 'picking one up adds it to your materials');
});

test('a Wooden Effigy makes the fire burn red while it burns', () => {
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6;
  s.inventory.wooden_effigy = 1;
  const at = T0 + 30_000;
  assert.equal(tintAt(s.fire, at), null);
  assert.equal(stoke(s, data, { wooden_effigy: 1, pine_log: 1 }, at).ok, true);
  assert.equal(tintAt(s.fire, at), 'red');
  assert.equal(tintAt(s.fire, at + 24 * MIN), 'red');
  assert.equal(effectiveMaterial(s, data, 'wooden_effigy').burnSeconds, 1800);
  assert.equal(buyMaterial(s, data, 'wooden_effigy').ok, false, 'not sold in the shop');
});

test('something stomps out the fire 25 minutes after an effigy burns', () => {
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6;
  s.inventory.wooden_effigy = 2; s.inventory.pine_log = 3;
  const at = T0 + 30_000;
  stoke(s, data, { wooden_effigy: 1, pine_log: 3 }, at); // hours of fuel
  assert.deepEqual(settle(s, data, at + 24 * MIN), []);
  assert.equal(s.fire.status, 'burning');
  const ev = settle(s, data, at + 25 * MIN + 1000, seeded(3));
  const out = ev.find((e) => e.type === 'extinguished');
  assert.ok(out, 'put out at 25 minutes despite plenty of fuel');
  assert.equal(out.message, 'Something stomped out the fire early');
  assert.equal(s.fire.status, 'ash');
  assert.equal(s.pendingAsh.message, 'Something stomped out the fire early');
  assert.equal(s.pendingAsh.messageSeen, false);
  assert.equal(Math.round(s.pendingAsh.duration), 30 + 25 * 60, 'the fire stopped exactly then');
  assert.ok(s.pendingAsh.materialsBurned.wooden_effigy === 1 && s.pendingAsh.materialsBurned.pine_log === 3, 'everything burned still counts for rewards');
  collectAsh(s, data, at + HOUR);
  assert.equal(stoke(s, data, { wooden_effigy: 1 }, at + HOUR).ok, true, 'a new fire can be lit');
  assert.equal(s.fire.putOut.at, at + HOUR + 25 * MIN, 'a new fire gets its own timer');
});

test('the stomp also happens while the app is closed, and a second effigy does not delay it', () => {
  const s = createNewSave(data, T0);
  s.upgrades.capacity = 6;
  s.upgrades.ember_preservation = 3; // stoking opens at 1h15m, so a second effigy can follow quickly
  s.inventory.wooden_effigy = 2;
  const at = T0 + 30_000;
  assert.equal(stoke(s, data, { wooden_effigy: 1 }, at).ok, true);
  assert.equal(stoke(s, data, { wooden_effigy: 1 }, at + 10 * MIN).ok, true, 'second effigy 10 minutes later');
  assert.equal(s.fire.putOut.at, at + 25 * MIN, 'still put out 25 minutes after the first');
  const ev = settle(s, data, at + 8 * HOUR, seeded(4));
  assert.ok(ev.some((e) => e.type === 'extinguished' && e.message));
  assert.equal(Math.round(s.pendingAsh.duration), 30 + 25 * 60);
  // a plain fire is unaffected
  const p = createNewSave(data, T0);
  stoke(p, data, { pine_log: 1 }, T0 + 30_000);
  const pe = settle(p, data, T0 + 10 * HOUR, seeded(5)).find((e) => e.type === 'extinguished');
  assert.equal(pe.message, null);
  assert.equal(p.pendingAsh.messageSeen, true);
});

test('old basket saves become spawns', () => {
  const s = createNewSave(data, T0);
  delete s.gathering.spawns;
  s.gathering.accum = { dry_leaves: 8, twigs: 2.5 };
  accrueGathering(s, data, T0, seeded(7));
  assert.equal(s.gathering.spawns.length, 6);
  assert.ok(s.gathering.accum.dry_leaves < 1 && s.gathering.accum.twigs < 1);
});

test('player can never be locked out of restarting', () => {
  const s = createNewSave(data, T0);
  s.fire.status = 'cold'; s.inventory = {}; s.sparks = 0;
  assert.equal(canForage(s, data), true);
  assert.equal(forage(s, data, T0, seeded(8)).ok, true);
  assert.equal(canForage(s, data), false);
  for (const o of [...s.gathering.spawns]) pickUp(s, data, o.key);
  assert.equal(stoke(s, data, { twigs: 1 }, T0).ok, true, 'lighting a cold fire ignores the threshold');
  assert.equal(s.fire.status, 'burning');
});

test('clock moving backwards never adds or removes fire time', () => {
  const s = createNewSave(data, T0);
  settle(s, data, T0 - HOUR);
  assert.equal(s.fire.remaining, 2730);
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
