// Owns the authoritative game state and its persistence.
// Every state change goes through act(), which syncs with storage first
// (so two open tabs can never double-collect rewards) and saves immediately after.

import { createNewSave, SaveStore } from './logic/state.js';
import { settle } from './logic/fire.js';
import { accrueGathering } from './logic/economy.js';

export class Game {
  constructor(data, storage) {
    this.data = data;
    this.store = new SaveStore(data.config.saveKey, storage);
    this.state = null;
    this.listeners = new Set();
    this.isNew = false;
    this.saveFailed = false;
  }

  now() { return Date.now(); }

  boot() {
    const now = this.now();
    const { state } = this.store.load(this.data, now);
    if (state) {
      this.state = state;
    } else {
      // Only create a fresh save if there was nothing at all, or nothing readable
      // (an unreadable save is stashed under a separate key first).
      this.store.stashCorrupt(now);
      this.state = createNewSave(this.data, now);
      this.isNew = true;
    }
    this.normalize();
    accrueGathering(this.state, this.data, now);
    const events = settle(this.state, this.data, now);
    this.save();
    return events;
  }

  normalize() {
    const s = this.state;
    // Repair impossible combinations instead of crashing.
    if (s.fire.status === 'ash' && !s.pendingAsh) s.fire.status = 'cold';
    if (s.pendingAsh && s.fire.status !== 'ash') s.fire.status = 'ash';
  }

  save() {
    const ok = this.store.save(this.state);
    if (!ok && !this.saveFailed) this.emit({ type: 'save-error', error: this.store.lastError });
    this.saveFailed = !ok;
    return ok;
  }

  /** Adopt a newer save written by another tab. Returns true if state changed. */
  sync() {
    const raw = this.store.readRaw();
    if (!raw || typeof raw.rev !== 'number' || raw.rev <= (this.state.rev || 0)) return false;
    const { state } = this.store.load(this.data, this.now());
    if (!state) return false;
    this.state = state;
    this.normalize();
    this.emit({ type: 'synced' });
    return true;
  }

  /** Run a state mutation: sync → settle → mutate → save → notify. */
  act(fn) {
    this.sync();
    const now = this.now();
    const pre = settle(this.state, this.data, now);
    const result = fn(this.state, this.data, now);
    this.save();
    for (const e of pre) this.emit(e);
    for (const e of (result && result.events) || []) this.emit(e);
    this.emit({ type: 'change' });
    return result;
  }

  /** Called on a timer: advances time-based systems; saves only when something happened. */
  tick() {
    const now = this.now();
    accrueGathering(this.state, this.data, now);
    const events = settle(this.state, this.data, now);
    if (events.length) {
      this.save();
      for (const e of events) this.emit(e);
      this.emit({ type: 'change' });
    }
    return events;
  }

  reset() {
    this.store.clear();
    this.state = createNewSave(this.data, this.now());
    this.isNew = true;
    this.save();
    this.emit({ type: 'change' });
  }

  importSave(text) {
    const raw = JSON.parse(text);
    const tmp = new SaveStore('__import_check', { getItem: () => JSON.stringify(raw), setItem() {}, removeItem() {} });
    const { state } = tmp.load(this.data, this.now());
    if (!state) throw new Error('That save could not be read.');
    state.rev = (this.state.rev || 0) + 1;
    this.state = state;
    this.normalize();
    this.save();
    this.emit({ type: 'change' });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(e) { for (const fn of this.listeners) fn(e); }
}
