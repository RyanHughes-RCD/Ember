// Save structure, versioning, migrations and safe persistence.

import { effectiveMaterial } from './stats.js';

export const SAVE_VERSION = 1;

export function emptyFire() {
  return {
    id: null,
    status: 'cold', // 'burning' | 'ash' | 'cold'
    remaining: 0, // seconds left, as of lastUpdated
    lastUpdated: null, // ms epoch — authoritative timestamp for elapsed-time maths
    litAt: null,
    totalDuration: 0, // seconds this fire has been continuously alive
    totalHeat: 0,
    totalQuality: 0,
    totalEssence: 0,
    materialsCount: 0,
    materialsBurned: {}, // { materialId: count } — the complete list consumed this fire
    stokes: 0,
  };
}

export function newFireId(now) {
  return `fire-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createNewSave(data, now) {
  const ng = data.config.newGame;
  const state = {
    version: SAVE_VERSION,
    createdAt: now,
    rev: 0,
    sparks: ng.sparks,
    cores: ng.cores,
    inventory: { ...ng.inventory },
    discoveries: {}, // { itemId: { count, firstFoundAt } }
    seenMaterials: {}, // materials the player has ever owned
    upgrades: {},
    fire: emptyFire(),
    pendingAsh: null,
    unseenReveal: null, // rewards already granted whose reveal the player hasn't seen yet
    records: {
      longestFire: 0, totalFireTime: 0, firesCompleted: 0,
      materialsBurned: 0, stokes: 0, sparksEarned: 0,
    },
    milestones: {}, // { milestoneId: achievedAt }
    unlocks: {}, // shop unlocks granted by milestones
    titles: [],
    gathering: { lastUpdated: now, accum: {}, spawns: [], seq: 0 },
    settings: { sound: true },
    tutorial: { intro: false },
  };
  for (const id of Object.keys(state.inventory)) state.seenMaterials[id] = true;

  // A forgiving welcome fire, already burning low so the stoke threshold is taught right away.
  const wf = ng.welcomeFire;
  if (wf) {
    const fire = state.fire;
    fire.id = newFireId(now);
    fire.status = 'burning';
    fire.remaining = wf.remainingSeconds;
    fire.lastUpdated = now;
    fire.litAt = now;
    for (const [id, n] of Object.entries(wf.materials)) {
      const m = effectiveMaterial(state, data, id);
      fire.materialsBurned[id] = (fire.materialsBurned[id] || 0) + n;
      fire.materialsCount += n;
      fire.totalHeat += m.heat * n;
      fire.totalQuality += m.quality * n;
      fire.totalEssence += m.essence * n;
    }
  }
  return state;
}

// Ordered list of migrations: MIGRATIONS[v] upgrades a save from version v to v+1.
// Add new entries here when the save format changes; never edit old ones.
export const MIGRATIONS = {
  // 1: (s) => { s.newField = defaultValue; s.version = 2; return s; },
};

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Fill any fields missing from an older/partial save with defaults, without overwriting data. */
function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target) || target[k] === undefined) {
      target[k] = structuredCloneSafe(v);
    } else if (isObj(v) && isObj(target[k]) && k !== 'inventory' && k !== 'materialsBurned' &&
      k !== 'discoveries' && k !== 'upgrades' && k !== 'milestones' && k !== 'accum') {
      fillDefaults(target[k], v);
    }
  }
  return target;
}

function structuredCloneSafe(v) {
  return v === null || typeof v !== 'object' ? v : JSON.parse(JSON.stringify(v));
}

export function migrate(raw, data, now) {
  if (!isObj(raw) || typeof raw.version !== 'number') throw new Error('Not a valid save');
  let s = raw;
  if (s.version > SAVE_VERSION) throw new Error(`Save is from a newer version (${s.version})`);
  while (s.version < SAVE_VERSION) {
    const step = MIGRATIONS[s.version];
    if (!step) throw new Error(`No migration from version ${s.version}`);
    s = step(s);
  }
  const defaults = createNewSave(data, now);
  defaults.fire = emptyFire();
  fillDefaults(s, defaults);
  return s;
}

// ---------------------------------------------------------------- persistence

export class SaveStore {
  constructor(key, storage = globalThis.localStorage) {
    this.key = key;
    this.backupKey = `${key}-backup`;
    this.storage = storage;
    this.lastError = null;
  }

  readRaw(key = this.key) {
    try {
      const txt = this.storage.getItem(key);
      return txt ? JSON.parse(txt) : null;
    } catch (err) {
      this.lastError = err;
      return undefined; // undefined = unreadable/corrupt; null = nothing stored
    }
  }

  /** Load and migrate the save. Falls back to the backup copy if the main save is corrupt. */
  load(data, now) {
    for (const key of [this.key, this.backupKey]) {
      const raw = this.readRaw(key);
      if (raw === null) continue;
      if (raw === undefined) continue;
      try {
        return { state: migrate(raw, data, now), source: key };
      } catch (err) {
        this.lastError = err;
      }
    }
    return { state: null, source: null };
  }

  /** Write the save. Keeps the previous good save as a backup. Never throws. */
  save(state) {
    try {
      state.rev = (state.rev || 0) + 1;
      state.savedAt = Date.now();
      const txt = JSON.stringify(state);
      const prev = this.storage.getItem(this.key);
      if (prev) this.storage.setItem(this.backupKey, prev);
      this.storage.setItem(this.key, txt);
      this.lastError = null;
      return true;
    } catch (err) {
      this.lastError = err;
      return false;
    }
  }

  /** Keep an unreadable save aside (never silently destroy player data). */
  stashCorrupt(now = Date.now()) {
    try {
      const txt = this.storage.getItem(this.key);
      if (txt) this.storage.setItem(`${this.key}-corrupt-${now}`, txt);
    } catch (err) {
      this.lastError = err;
    }
  }

  clear() {
    try {
      this.storage.removeItem(this.key);
      this.storage.removeItem(this.backupKey);
    } catch (err) {
      this.lastError = err;
    }
  }
}
