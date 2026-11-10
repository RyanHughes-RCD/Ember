export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** 3725 → "1:02:05", 125 → "2:05" */
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

/** 3725 → "1h 2m", 125 → "2m 5s", 40 → "40s" */
export function fmtDur(sec, { short = false } = {}) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return short && !m ? `${h}h` : `${h}h ${m}m`;
  if (m) return short || m >= 10 ? `${m}m` : `${m}m ${r}s`;
  return `${r}s`;
}

export function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.floor(n));
}

export const fmtStat = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 10) / 10).toString();

export const pct = (n) => `${Math.round(n * 100)}%`;
