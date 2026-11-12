// The campfire simulation. Time is always derived from stored timestamps,
// never from how often a timer happened to fire, so offline progress is exact.

import { effectiveMaterial, getCapacity, getThreshold } from './stats.js';
import { generateRewards } from './rewards.js';
import { newFireId } from './state.js';
import { checkMilestones, enduranceBonus } from './economy.js';

/** Seconds remaining right now, without mutating anything. */
export function remainingAt(fire, now) {
  if (fire.status !== 'burning') return 0;
  const elapsed = Math.max(0, (now - fire.lastUpdated) / 1000);
  return Math.max(0, fire.remaining - elapsed);
}

/** How much bigger the flames are drawn: each burned material with fireGrowth adds that much (e.g. Tributes). */
export function fireGrowth(fire, data) {
  if (fire.status !== 'burning') return 0;
  let g = 0;
  for (const [id, n] of Object.entries(fire.materialsBurned)) {
    const m = data.materialById[id];
    if (m && m.fireGrowth) g += m.fireGrowth * n;
  }
  return g;
}

/** If enough of a material has gone into this fire to make it unapproachable, the message to show. */
export function tooHotMessage(fire, data) {
  if (fire.status !== 'burning') return null;
  for (const [id, n] of Object.entries(fire.materialsBurned)) {
    const m = data.materialById[id];
    if (m && m.tooHotAt && n >= m.tooHotAt) return m.tooHotMessage || 'It burns too hot to approach';
  }
  return null;
}

/** The flame colour right now ('red', …), or null for an ordinary fire. */
export function tintAt(fire, now) {
  return fire.status === 'burning' && fire.tint && fire.tint.until > now ? fire.tint.color : null;
}

export function durationAt(fire, now) {
  if (fire.status !== 'burning') return fire.totalDuration;
  const elapsed = Math.max(0, (now - fire.lastUpdated) / 1000);
  return fire.totalDuration + Math.min(elapsed, fire.remaining);
}

/**
 * Advance the fire to `now`. Awards milestones crossed along the way and, if the
 * fuel ran out (online or offline), extinguishes the fire and generates + stores
 * the ash rewards in the same step. Returns a list of events for the UI.
 * The caller must persist the state whenever events are returned.
 */
export function settle(state, data, now, rng = Math.random) {
  const events = [];
  const fire = state.fire;
  if (fire.status !== 'burning') return events;

  // Clock moved backwards (device time changed): never refund or skip time, just re-anchor.
  if (now < fire.lastUpdated) {
    fire.lastUpdated = now;
    return events;
  }
  const elapsed = (now - fire.lastUpdated) / 1000;
  // Something may put the fire out before its fuel runs out (see the Wooden Effigy).
  const untilPutOut = fire.putOut ? Math.max(0, (fire.putOut.at - fire.lastUpdated) / 1000) : Infinity;
  const putOutFirst = untilPutOut < fire.remaining && elapsed >= untilPutOut;
  const burned = putOutFirst ? untilPutOut : Math.min(elapsed, fire.remaining);
  fire.totalDuration += burned;
  fire.remaining -= burned;
  state.records.totalFireTime += burned;
  if (fire.totalDuration > state.records.longestFire) state.records.longestFire = fire.totalDuration;

  events.push(...checkMilestones(state, data, fire.totalDuration, now));

  if (fire.remaining <= 1e-6 || putOutFirst) {
    const outAt = fire.lastUpdated + burned * 1000;
    const message = putOutFirst ? fire.putOut.message : null;
    fire.remaining = 0;
    fire.lastUpdated = outAt;
    events.push(extinguish(state, data, outAt, rng, message));
  } else {
    fire.lastUpdated = now;
  }
  return events;
}

/** Fire ran out: generate rewards once, store them as pending, move to ash phase. */
export function extinguish(state, data, at, rng = Math.random, message = null) {
  const fire = state.fire;
  const rewards = generateRewards(state, data, fire, rng);
  const newDiscoveries = rewards.filter((r) => !state.discoveries[r.id]).map((r) => r.id);
  state.pendingAsh = {
    fireId: fire.id,
    rewards,
    newDiscoveries,
    endurance: enduranceBonus(data, fire.totalDuration),
    duration: fire.totalDuration,
    materialsBurned: { ...fire.materialsBurned },
    materialsCount: fire.materialsCount,
    extinguishedAt: at,
    message, // shown to the player once, e.g. "Something stomped out the fire early"
    messageSeen: !message,
  };
  fire.status = 'ash';
  fire.putOut = null;
  state.records.firesCompleted += 1;
  return { type: 'extinguished', fireId: fire.id, message };
}

export function canStokeNow(state, data, now) {
  const fire = state.fire;
  if (fire.status === 'cold') return true; // lighting a new fire
  if (fire.status !== 'burning') return false;
  return remainingAt(fire, now) <= getThreshold(state, data) + 1e-9;
}

/** Validate a selection { materialId: count } against capacity and inventory. */
export function validateSelection(state, data, selection) {
  const capacity = getCapacity(state, data);
  let total = 0;
  for (const [id, n] of Object.entries(selection)) {
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: 'Invalid amount.' };
    if (n === 0) continue;
    if (!data.materialById[id]) return { ok: false, error: 'That cannot be burned.' };
    if ((state.inventory[id] || 0) < n) return { ok: false, error: `Not enough ${data.materialById[id].name}.` };
    total += n;
  }
  if (total === 0) return { ok: false, error: 'Choose something to burn.' };
  if (total > capacity) return { ok: false, error: `You can only add ${capacity} at a time.` };
  return { ok: true, total };
}

/** Preview the seconds a selection would add. */
export function selectionSeconds(state, data, selection) {
  let s = 0;
  for (const [id, n] of Object.entries(selection)) {
    if (n > 0 && data.materialById[id]) s += effectiveMaterial(state, data, id).burnSeconds * n;
  }
  return s;
}

/**
 * Add materials to the fire (or light a new one when cold).
 * Materials are consumed immediately. Returns { ok, error?, events }.
 */
export function stoke(state, data, selection, now, rng = Math.random) {
  const events = settle(state, data, now, rng);
  const fire = state.fire;
  if (fire.status === 'ash') return { ok: false, error: 'The fire has gone out. Sift the ashes first.', events };
  if (!canStokeNow(state, data, now)) {
    return { ok: false, error: 'The fire is still burning strong. Wait until it runs low.', events };
  }
  const hot = tooHotMessage(fire, data);
  if (hot) return { ok: false, error: hot, popup: true, events };
  const v = validateSelection(state, data, selection);
  if (!v.ok) return { ...v, events };
  // some materials (Skull Fragments) only burn alongside other fuel
  const chosen = Object.entries(selection).filter(([, n]) => n > 0).map(([id]) => data.materialById[id]);
  if (chosen.every((m) => m.burnAlone === false)) {
    return { ok: false, error: chosen[0].burnAloneMessage || 'It won\'t burn on its own', events };
  }

  const lighting = fire.status === 'cold';
  if (lighting) {
    Object.assign(fire, {
      id: newFireId(now), status: 'burning', remaining: 0, lastUpdated: now, litAt: now,
      totalDuration: 0, totalHeat: 0, totalQuality: 0, totalEssence: 0,
      materialsCount: 0, materialsBurned: {}, stokes: 0, tint: null, putOut: null,
    });
  }

  for (const [id, n] of Object.entries(selection)) {
    if (!n) continue;
    const m = effectiveMaterial(state, data, id);
    state.inventory[id] -= n;
    if (state.inventory[id] <= 0) delete state.inventory[id];
    fire.remaining += m.burnSeconds * n;
    fire.totalHeat += m.heat * n;
    fire.totalQuality += m.quality * n;
    fire.totalEssence += m.essence * n;
    fire.materialsCount += n;
    fire.materialsBurned[id] = (fire.materialsBurned[id] || 0) + n;
    state.records.materialsBurned += n;
    state.records.burned = state.records.burned || {};
    state.records.burned[id] = (state.records.burned[id] || 0) + n;
    const tint = data.materialById[id].flameTint;
    if (tint) {
      // the flames take this colour while the material burns; more of it keeps them that colour longer
      const from = fire.tint && fire.tint.color === tint && fire.tint.until > now ? fire.tint.until : now;
      fire.tint = { color: tint, until: from + m.burnSeconds * n * 1000 };
    }
    const after = data.materialById[id].extinguishAfterSeconds;
    if (after) {
      // the first one burned decides when; more of them don't move it
      const at = now + after * 1000;
      if (!fire.putOut || at < fire.putOut.at) {
        fire.putOut = { at, message: data.materialById[id].extinguishMessage || 'The fire went out early' };
      }
    }
  }
  fire.lastUpdated = now;
  fire.stokes += 1;
  state.records.stokes += 1;
  events.push({ type: lighting ? 'lit' : 'stoked', added: v.total });
  return { ok: true, events };
}

/**
 * Sift the ashes: move every pending reward into the inventory in one step.
 * Idempotent — calling it twice cannot duplicate rewards because the pending
 * record is removed in the same state change that grants it.
 */
export function collectAsh(state, data, now) {
  const pending = state.pendingAsh;
  if (!pending) return null;
  for (const { id, qty } of pending.rewards) {
    const def = data.byId[id];
    if (!def) continue;
    if (def.kind === 'core') {
      state.cores += qty;
    } else {
      state.inventory[id] = (state.inventory[id] || 0) + qty;
      if (def.kind === 'material') state.seenMaterials[id] = true;
    }
    const d = state.discoveries[id] || { count: 0, firstFoundAt: now };
    d.count += qty;
    state.discoveries[id] = d;
  }
  if (pending.endurance) {
    state.sparks += pending.endurance.sparks || 0;
    state.cores += pending.endurance.cores || 0;
    state.records.sparksEarned += pending.endurance.sparks || 0;
  }
  state.pendingAsh = null;
  state.fire.status = 'cold';
  state.fire.remaining = 0;
  return pending;
}
