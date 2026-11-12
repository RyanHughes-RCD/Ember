// Embers — entry point. Wires data, persistence, the scene and the views together.

import { loadData } from './data.js';
import { Game } from './game.js';
import { collectAsh } from './logic/fire.js';
import { sellValue, isUnlocked, nextUpgradeCost, meetsRequirement } from './logic/economy.js';
import { effectiveMaterial } from './logic/stats.js';
import { Scene, loadSprites } from './ui/scene.js';
import { iconUrl, uiIconUrl } from './ui/icons.js';
import { sfx, startAmbience, stopAmbience } from './ui/audio.js';
import { $, $$, esc, fmtDur, fmtNum, fmtStat } from './ui/util.js';
import { FireView } from './ui/fireView.js';
import { MaterialsView } from './ui/materialsView.js';
import { JournalView, rewardText } from './ui/journalView.js';
import { UpgradesView } from './ui/upgradesView.js';
import { ForageView } from './ui/forageView.js';

const ui = {
  view: 'fire',
  revealing: false,
  toast, bump, go, showItem, openSift: () => openSift(),
};

let game; let scene; let fireView; let materialsView; let journalView; let upgradesView; let forageView;

// ------------------------------------------------------------ toasts & small helpers

function toast(msg, type = '', iconId = null) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const def = iconId && game?.data.byId[iconId];
  el.innerHTML = `${def ? `<img class="px-icon" src="${iconUrl(def)}" alt="">` : iconId === 'basket' ? `<img class="px-icon" src="${uiIconUrl('basket')}" alt="">` : ''}<span>${esc(msg)}</span>`;
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, type === 'milestone' ? 4200 : 2600);
}

function bump(which) {
  const el = $(`.coin.${which}`);
  if (!el) return;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function renderWallet() {
  $('#w-sparks').textContent = fmtNum(game.state.sparks);
  $('#w-cores').textContent = fmtNum(game.state.cores);
}

const PAGE_TITLES = { materials: 'Materials', journal: 'Journal', upgrades: 'Upgrades' };

/** 'fire' shows the campsite alone; 'forage' opens the grassy patch; anything else opens that page over it. */
function go(view, sub) {
  ui.view = view;
  const page = view !== 'fire' && view !== 'forage';
  $('#pages').hidden = !page;
  $('#forage').hidden = view !== 'forage';
  if (view === 'forage') {
    scene.stop();
    forageView.open();
  } else {
    forageView.close();
  }
  if (page) {
    $('#page-title').textContent = PAGE_TITLES[view];
    $$('#pages .view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
    $('#pages').scrollTop = 0;
    scene.stop();
  } else if (view === 'fire') {
    scene.layout();
    scene.start();
  }
  if (view === 'materials' && sub) materialsView.setSub(sub);
  renderAll();
}

function renderAll() {
  const now = game.now();
  renderWallet();
  if (ui.view === 'fire') fireView.render(now);
  else if (ui.view === 'materials') materialsView.render();
  else if (ui.view === 'journal') journalView.render(now);
  else if (ui.view === 'upgrades') upgradesView.render();
  renderDots();
}

function upgradeAffordable() {
  const s = game.state; const d = game.data;
  return d.upgrades.some((u) => { const c = nextUpgradeCost(s, d, u.id); return c && meetsRequirement(s, d, u.requires) && s.sparks >= c.sparks && s.cores >= c.cores; });
}

/** A small dot on the menu button when an upgrade can be bought. */
function renderDots() {
  const btn = $('#btn-menu');
  const want = upgradeAffordable();
  const has = btn.querySelector('.dot');
  if (want && !has) btn.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
  if (!want && has) has.remove();
}

function showMenu() {
  const s = game.state;
  const item = (view, icon, label, dot) => `<button class="btn menu-item" data-view="${view}">
    <img class="px-icon" src="${uiIconUrl(icon)}" alt="">${label}${dot ? '<i class="dot"></i>' : ''}</button>`;
  openSheet(`
    <h2>Embers</h2>
    <div class="menu-wallet">
      <span class="coin sparks"><b>✦</b>${fmtNum(s.sparks)}</span>
      <span class="coin cores"><b>◆</b>${fmtNum(s.cores)}</span>
    </div>
    <div class="menu-list">
      ${item('materials', 'log', 'Materials')}
      ${item('journal', 'book', 'Journal')}
      ${item('upgrades', 'bellows', 'Upgrades')}
      ${item('settings', 'sieve', 'Settings')}
    </div>`);
  $$('#sheet-body .menu-item').forEach((b) => b.addEventListener('click', () => {
    sfx.tap();
    if (b.dataset.view === 'settings') { showSettings(); return; }
    closeSheet();
    go(b.dataset.view);
  }));
}

// ------------------------------------------------------------ sheets

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; }

/** "Something stomped out the fire early" — shown once, live or on the next visit. */
function showPutOutMessage() {
  const p = game.state.pendingAsh;
  if (!p || !p.message || p.messageSeen) return;
  game.act((s) => { if (s.pendingAsh) s.pendingAsh.messageSeen = true; });
  openSheet(`
    <div class="omen">
      <p class="omen-text">${esc(p.message)}</p>
      <button class="btn btn-wide omen-ok" id="omen-ok">OK</button>
    </div>`);
  $('#omen-ok').onclick = () => { sfx.tap(); closeSheet(); };
}

function showItem(id) {
  const s = game.state; const d = game.data;
  const def = d.byId[id];
  if (!def) return;
  const known = Boolean(s.discoveries[id] || (def.kind === 'material' && s.seenMaterials[id]));
  const sources = d.materials.filter((m) => m.loot.some((e) => e.item === id));
  const srcTxt = sources.map((m) => (s.seenMaterials[m.id] ? esc(m.name) : '???')).join(', ');
  let extra = '';
  if (def.kind === 'material' && known) {
    const e = effectiveMaterial(s, d, id);
    extra += `<h3>Characteristics</h3><p>Burns ${fmtDur(e.burnSeconds)} · Heat ${fmtStat(e.heat)} · Quality ${fmtStat(e.quality)} · Essence ${fmtStat(e.essence)} · Ash yield ${e.ashYield}</p>`;
    extra += `<p class="muted">Owned: ${s.inventory[id] || 0}${isUnlocked(s, d, id) ? ` · Shop price ✦${def.price}` : ''}</p>`;
  }
  if (def.kind === 'treasure' && known) extra += `<p class="muted">Trades for ✦${sellValue(d, id)} each.</p>`;
  if (def.kind === 'core' && known) extra += '<p class="muted">Added straight to your Ember Cores (◆), used for the deepest upgrades.</p>';
  if (def.tags?.length && known) extra += `<p class="muted">Favoured by ${def.tags.includes('magic') ? 'Essence' : 'Heat'}.</p>`;
  openSheet(`
    <div class="detail-head">
      <img class="px-icon" src="${iconUrl(def, { silhouette: !known })}" alt="">
      <div><h2>${known ? esc(def.name) : 'Undiscovered'}</h2><span class="rarity r-${def.rarity}">${def.rarity}${def.kind === 'material' ? ' · burnable' : ''}</span></div>
    </div>
    <p>${known ? esc(def.description) : 'Something waits to be found in the ashes.'}</p>
    ${sources.length ? `<p class="muted">Found in the ashes of: ${srcTxt}</p>` : ''}
    ${s.discoveries[id] ? `<p class="muted">Total recovered: ${fmtNum(s.discoveries[id].count)}</p>` : ''}
    ${extra}`);
}

/**
 * Re-download every file the game has loaded, bypassing the cache, then reload.
 * Home-screen web apps on iOS can otherwise keep running an old version.
 */
async function fetchLatest(btn) {
  btn.disabled = true;
  btn.textContent = 'Updating…';
  game.save();
  const urls = new Set([window.location.href.split('#')[0]]);
  for (const e of performance.getEntriesByType('resource')) {
    const u = new URL(e.name, window.location.href);
    if (u.origin === window.location.origin) urls.add(u.href);
  }
  await Promise.all([...urls].map((u) => fetch(u, { cache: 'reload' }).catch(() => {})));
  window.location.reload();
}

function showSettings() {
  const s = game.state;
  openSheet(`
    <h2>Settings</h2>
    <div class="settings-row"><span>Sound</span><button class="btn btn-small" id="set-sound">${s.settings.sound ? 'On' : 'Off'}</button></div>
    <div class="settings-row"><span>Back up progress</span><button class="btn btn-small" id="set-export">Export</button></div>
    <div class="settings-row"><span>Restore a backup</span><button class="btn btn-small" id="set-import">Import</button></div>
    <div id="save-io"></div>
    <div class="settings-row"><span>Get the latest version</span><button class="btn btn-small" id="set-update">Update</button></div>
    <div class="settings-row"><span>Erase all progress</span><button class="btn btn-small btn-danger" id="set-reset">Reset</button></div>
    <p class="muted" style="font-size:12px">Progress is saved on this device automatically.</p>`);
  $('#set-sound').onclick = () => {
    game.act((st) => { st.settings.sound = !st.settings.sound; });
    sfx.setEnabled(game.state.settings.sound);
    if (game.state.settings.sound) { sfx.unlock(); sfx.tap(); }
    $('#set-sound').textContent = game.state.settings.sound ? 'On' : 'Off';
  };
  $('#set-export').onclick = () => {
    const txt = btoa(unescape(encodeURIComponent(JSON.stringify(game.state))));
    $('#save-io').innerHTML = `<textarea class="save-text" readonly>${txt}</textarea><button class="btn btn-small" id="copy-save">Copy</button>`;
    $('#copy-save').onclick = async () => {
      try { await navigator.clipboard.writeText(txt); toast('Save copied.'); } catch { $('.save-text').select(); }
    };
  };
  $('#set-import').onclick = () => {
    $('#save-io').innerHTML = '<textarea class="save-text" placeholder="Paste a backup here"></textarea><button class="btn btn-small" id="do-import">Restore</button>';
    $('#do-import').onclick = () => {
      try {
        const raw = $('.save-text').value.trim();
        const json = raw.startsWith('{') ? raw : decodeURIComponent(escape(atob(raw)));
        game.importSave(json);
        closeSheet(); toast('Backup restored.'); renderAll();
      } catch (err) { toast(`Could not restore: ${err.message}`, 'error'); }
    };
  };
  $('#set-update').onclick = () => fetchLatest($('#set-update'));
  $('#set-reset').onclick = () => {
    if (!window.confirm('Erase all progress and start over?')) return;
    if (!window.confirm('Really? This cannot be undone.')) return;
    game.reset(); closeSheet(); go('fire');
  };
}

// ------------------------------------------------------------ ash sifting & reveal

async function openSift() {
  if (!game.state.pendingAsh || ui.revealing) return;
  ui.revealing = true;
  sfx.unlock();
  sfx.sift();
  // Rewards are granted the instant the player sifts — before any animation —
  // so a refresh or closed tab mid-reveal can never lose (or duplicate) them.
  const res = game.act((s, d, now) => {
    const p = collectAsh(s, d, now);
    s.unseenReveal = p;
    return { p };
  });
  fireView.render();
  renderWallet();
  if (!res.p) { ui.revealing = false; renderAll(); return; }
  await scene.sift();
  showReveal(res.p);
}

function showReveal(p) {
  const d = game.data;
  ui.revealing = true;
  const grid = $('#reveal-grid');
  const total = p.rewards.reduce((a, r) => a + r.qty, 0);
  $('#reveal-summary').textContent =
    `A ${fmtDur(p.duration)} fire · ${p.materialsCount} material${p.materialsCount === 1 ? '' : 's'} burned · ${total} thing${total === 1 ? '' : 's'} recovered`;
  const order = [...p.rewards].sort((a, b) => d.rarityIndex[d.byId[a.id].rarity] - d.rarityIndex[d.byId[b.id].rarity]);
  const e = p.endurance || { sparks: 0, cores: 0 };
  const bonus = e.sparks || e.cores
    ? `<div class="endurance">Endurance bonus <b>✦ ${fmtNum(e.sparks)}</b>${e.cores ? ` <b class="c">◆ ${e.cores}</b>` : ''}</div>` : '';
  $('#reveal-bonus').innerHTML = bonus;
  grid.innerHTML = order.length ? order.map((r) => {
    const def = d.byId[r.id];
    const isNew = p.newDiscoveries.includes(r.id);
    return `<div class="loot r-${def.rarity}" data-rarity="${def.rarity}">
      ${isNew ? '<span class="new">NEW DISCOVERY</span>' : ''}
      <img class="px-icon" src="${iconUrl(def)}" alt="">
      <span class="nm">${esc(def.name)}</span>
      <span class="q">×${r.qty}</span>
      <span class="rarity r-${def.rarity}">${def.rarity}</span>
    </div>`;
  }).join('') : '<div class="nothing">Only soft grey ash remained this time.<br>Longer fires and richer fuel leave more behind.</div>';
  $('#reveal').hidden = false;
  const btn = $('#btn-continue');
  btn.disabled = true;

  const cards = $$('.loot', grid);
  let i = 0;
  let timer = null;
  const showNext = () => {
    if (i >= cards.length) { btn.disabled = false; return; }
    const c = cards[i++];
    const rarity = c.dataset.rarity;
    c.classList.add('show');
    addSparkles(c, rarity);
    sfx.reveal(rarity);
    c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const pause = { legendary: 1100, epic: 750, rare: 420 }[rarity] || Math.max(70, 260 - cards.length * 8);
    timer = setTimeout(showNext, pause);
  };
  grid.onclick = () => { // tap to skip ahead
    clearTimeout(timer);
    while (i < cards.length) cards[i++].classList.add('show');
    btn.disabled = false;
  };
  timer = setTimeout(showNext, 250);
  if (!cards.length) btn.disabled = false;
}

function addSparkles(card, rarity) {
  const colors = { rare: ['#5fb4ff', '#bfe4ff'], epic: ['#c27bff', '#f0d0ff', '#7fd8ff'], legendary: ['#ffb52e', '#fff2a0', '#ff7a2a', '#ffffff'] }[rarity];
  if (!colors) return;
  const n = { rare: 8, epic: 14, legendary: 24 }[rarity];
  for (let k = 0; k < n; k++) {
    const sp = document.createElement('i');
    sp.className = 'sparkle';
    const a = Math.random() * Math.PI * 2; const r = 26 + Math.random() * 30;
    sp.style.cssText = `left:50%;top:28px;background:${colors[k % colors.length]};--dx:${Math.cos(a) * r}px;--dy:${Math.sin(a) * r}px;animation-delay:${Math.random() * 0.3}s`;
    card.append(sp);
  }
}

function closeReveal() {
  $('#reveal').hidden = true;
  game.act((s) => { s.unseenReveal = null; });
  ui.revealing = false;
  scene.setFire({ status: 'cold' });
  renderAll();
}

// ------------------------------------------------------------ events & loop

function onGameEvent(e) {
  const d = game.data;
  if (e.type === 'milestone') {
    const m = d.milestones.find((x) => x.id === e.id);
    sfx.milestone();
    toast(`★ ${m.name} — ${rewardText(d, m.reward)}`, 'milestone');
    bump('sparks');
  } else if (e.type === 'extinguished' && booted) {
    stopAmbience();
    if (e.message) {
      sfx.stomp();
      setTimeout(showPutOutMessage, 1400); // let the embers start to die first
    } else {
      sfx.extinguish();
    }
  } else if (e.type === 'save-error') {
    toast('Progress could not be saved — storage may be full or disabled.', 'error');
  } else if (e.type === 'change') {
    renderWallet();
  } else if (e.type === 'synced') {
    renderAll();
  }
}

let booted = false;
let lastSlow = 0;

function tick() {
  if (!game) return;
  game.tick();
  const now = game.now();
  renderWallet();
  fireView.update(now);
  if (ui.view === 'forage') forageView.update();
  if (now - lastSlow > 1000) {
    lastSlow = now;
    renderDots();
    if (ui.view === 'journal' && game.state.fire.status === 'burning' && now % 5000 < 1000) journalView.render(now);
  }
}

async function boot() {
  try {
    const data = await loadData('./data/');
    const sprites = await loadSprites('./assets/sprites/', data.overlays.filter((o) => o.sprite).map((o) => o.sprite));
    game = new Game(data, window.localStorage);
    game.on(onGameEvent);
    const bootEvents = game.boot();

    scene = new Scene($('#scene'), sprites);
    fireView = new FireView(game, scene, ui);
    materialsView = new MaterialsView(game, ui);
    journalView = new JournalView(game, ui);
    upgradesView = new UpgradesView(game, ui);
    forageView = new ForageView(game, ui);

    $('#btn-menu').addEventListener('click', () => { sfx.unlock(); sfx.tap(); showMenu(); });
    $('#btn-back').addEventListener('click', () => { sfx.tap(); go('fire'); });
    $('#forage-back').addEventListener('click', () => { sfx.tap(); go('fire'); });
    window.addEventListener('resize', () => scene.layout());
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' || e.target.closest('.sheet-close')) closeSheet(); });
    $('#btn-continue').addEventListener('click', () => { sfx.tap(); closeReveal(); });

    sfx.setEnabled(game.state.settings.sound);
    document.addEventListener('pointerdown', () => {
      sfx.unlock();
      if (game.state.settings.sound && game.state.fire.status === 'burning') startAmbience();
    }, { once: true });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        game.save();
        scene.stop();
      } else {
        game.sync();
        game.tick();
        if (ui.view === 'fire') scene.start();
        if (ui.view === 'forage') forageView.update();
        renderAll();
      }
    });
    window.addEventListener('pagehide', () => game.save());
    window.addEventListener('storage', (e) => { if (e.key === game.data.config.saveKey && game.sync()) renderAll(); });

    // Paint the current state immediately (no dying animation for a fire that went out while away is skipped:
    // returning players still see the embers fade before the ash pile appears).
    fireView.update(game.now());
    go('fire');
    scene.start();
    for (const e of bootEvents) if (e.type === 'milestone') onGameEvent(e);
    booted = true;
    setInterval(tick, 250);
    $('#app').classList.remove('loading');

    if (game.state.pendingAsh && game.state.pendingAsh.message && !game.state.pendingAsh.messageSeen) {
      // the fire was put out early while the player was away
      setTimeout(showPutOutMessage, 1600);
    }
    if (game.state.unseenReveal) {
      // Rewards were already granted; replay the reveal the player missed.
      ui.revealing = true;
      scene.setFire({ status: 'cold' });
      showReveal(game.state.unseenReveal);
    }
  } catch (err) {
    console.error(err);
    $('#boot-msg').textContent = `Something went wrong while loading: ${err.message}`;
  }
}

boot();
