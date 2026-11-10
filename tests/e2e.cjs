// End-to-end playthrough in a real browser with a controllable clock.
// Usage: node tests/e2e.cjs            (requires the `playwright` package + Chromium)
// Optional: BASE_PATH=/Ember/ to serve the game under a sub-path like GitHub Pages does.
/* eslint-disable no-console */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_PATH || '/Ember/';
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp',
};

function serve() {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end('outside base path'); }
    url = url.slice(BASE.length) || 'index.html';
    if (url.endsWith('/')) url += 'index.html';
    const file = path.join(ROOT, url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

const MIN = 60_000;
const HOUR = 60 * MIN;
let failures = 0;
function check(cond, msg) {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
}

(async () => {
  const server = await serve();
  const url = `http://localhost:${server.address().port}${BASE}`;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const errors = [];
  let T = new Date('2026-01-01T20:00:00Z').getTime();

  async function open() {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.clock.install({ time: T });
    await page.goto(url);
    await page.waitForSelector('#app:not(.loading)');
    await page.clock.runFor(600);
    return page;
  }
  const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('embers-save')));
  async function advance(page, ms) { T += ms; await page.clock.fastForward(ms); await page.clock.runFor(300); }
  const hudTime = (page) => page.textContent('#hud-time');
  async function nav(page, view) {
    if (await page.isVisible('#pages')) await page.click('#btn-back');
    if (view === 'fire') return;
    await page.click('#btn-menu');
    await page.click(`.menu-item[data-view="${view}"]`);
  }

  console.log('Start a fire / welcome fire');
  let page = await open();
  check(!(await page.isVisible('#sheet')) && !(await page.isVisible('#pages')), 'opens straight onto the campfire, no tutorial');
  let s = await save(page);
  check(s.fire.status === 'burning', 'welcome fire is burning');
  check(await page.isDisabled('#stoke-btn'), 'stoke button disabled above threshold');

  console.log('Stoking above the threshold is refused');
  await page.click('.tray-item[data-id="pine_log"]');
  check((await page.$$('.slot.filled')).length === 1, 'material can be pre-selected');
  check(await page.isDisabled('#stoke-btn'), 'still cannot stoke above threshold');

  console.log('Stoke with one material');
  await advance(page, 31_000);
  await page.waitForSelector('#stoke-btn:not([disabled])');
  check((await page.textContent('#stoke-btn')).includes('STOKE FIRE'), 'button reads STOKE FIRE at threshold');
  await page.click('#stoke-btn');
  s = await save(page);
  check(s.inventory.pine_log === 2, 'pine log consumed immediately');
  check(Math.round(s.fire.remaining) >= 1195, `remaining ≈ 20 min (${Math.round(s.fire.remaining)}s)`);

  console.log('Capacity: only one slot at level 0');
  await page.click('.tray-item[data-id="twigs"]');
  await page.click('.tray-item[data-id="dry_leaves"]');
  check((await page.$$('.slot.filled')).length === 1, 'second item rejected with 1 slot');
  await page.click('.slot.filled'); // clear

  console.log('Refresh during an active fire');
  await advance(page, 5 * MIN);
  const before = await hudTime(page);
  await page.close();
  page = await open();
  const after = await hudTime(page);
  const secs = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  check(Math.abs(secs(before) - secs(after)) <= 2, `countdown continuous across reload (${before} vs ${after})`);

  console.log('Purchase an upgrade, then stoke multiple materials');
  await page.close();
  { // grant sparks with the game closed (a test shortcut, like a player earning them)
    const p2 = await context.newPage();
    await p2.goto(`${url}manifest.webmanifest`);
    await p2.evaluate(() => { const st = JSON.parse(localStorage.getItem('embers-save')); st.sparks = 500; localStorage.setItem('embers-save', JSON.stringify(st)); });
    await p2.close();
  }
  page = await open();
  await nav(page, 'upgrades');
  await page.click('[data-act="upgrade"][data-id="capacity"]');
  await page.click('[data-act="upgrade"][data-id="capacity"]');
  s = await save(page);
  check(s.upgrades.capacity === 2 && s.sparks === 500 - 60 - 180, 'two capacity levels purchased, sparks deducted');
  check((await page.textContent('#w-sparks')).trim() === String(500 - 240), 'wallet updates immediately');
  await nav(page, 'fire');
  check((await page.$$('.slot')).length === 3, 'three slots shown');
  await advance(page, 11 * MIN); // ~4 min left
  await page.waitForSelector('#stoke-btn:not([disabled])', { state: 'attached' }).catch(() => {});
  await page.click('.tray-item[data-id="pine_log"]');
  await page.click('.tray-item[data-id="twigs"]');
  await page.click('.tray-item[data-id="dry_leaves"]');
  await page.click('#stoke-btn');
  s = await save(page);
  check(s.fire.materialsBurned.pine_log === 2 && s.fire.materialsBurned.twigs === 2 && s.fire.materialsBurned.dry_leaves === 1,
    'multi-material stoke recorded');

  console.log('Insufficient inventory');
  await advance(page, 18 * MIN);
  for (let i = 0; i < 3; i++) await page.click('.tray-item[data-id="pine_log"]');
  check((await page.$$('.slot.filled')).length === 1, 'cannot select more pine logs than owned (1)');
  await page.click('.slot.filled');

  console.log('Close the app until the fire expires');
  await page.close();
  T += 8 * HOUR;
  page = await open();
  s = await save(page);
  check(s.fire.status === 'ash' && s.pendingAsh, 'fire extinguished offline, rewards pending');
  check(s.pendingAsh.rewards.length > 0, `rewards generated (${s.pendingAsh.rewards.length} kinds)`);
  const pendingIds = s.pendingAsh.rewards.map((r) => r.id);
  check(pendingIds.some((id) => ['charcoal', 'resin', 'pine_seeds', 'amber'].includes(id)) &&
    pendingIds.some((id) => ['fine_ash', 'leaf_skeleton', 'lucky_clover'].includes(id)),
  'rewards come from multiple material tables');
  check(s.records.firesCompleted === 1, 'fires completed recorded');
  const pendingJson = JSON.stringify(s.pendingAsh);

  console.log('Refresh during pending ash collection');
  await page.close();
  page = await open();
  s = await save(page);
  check(JSON.stringify(s.pendingAsh) === pendingJson, 'pending rewards identical after refresh (no regeneration)');
  await advance(page, 5000);
  check(await page.isVisible('[data-act="sift"]'), 'SIFT THROUGH ASHES button visible');

  console.log('Ash collection');
  const invBefore = s.inventory;
  await page.click('[data-act="sift"]');
  s = await save(page);
  check(s.pendingAsh === null && s.fire.status === 'cold', 'rewards granted immediately on sift');
  const r0 = JSON.parse(pendingJson).rewards.find((r) => r.id !== 'ember_core');
  check((s.inventory[r0.id] || 0) === (invBefore[r0.id] || 0) + r0.qty, `${r0.id} added to inventory`);
  await page.clock.runFor(1800); // ash dispersal animation
  check(await page.isVisible('#reveal'), 'reveal overlay shown');
  await advance(page, 1000); for (let i = 0; i < 40; i++) await page.clock.runFor(400);
  check((await page.$$('.loot.show')).length === JSON.parse(pendingJson).rewards.length, 'every reward revealed');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'screenshot-reveal.png') });

  console.log('Refresh mid-reveal does not duplicate');
  await page.close();
  page = await open();
  const s2 = await save(page);
  check(JSON.stringify(s2.inventory) === JSON.stringify(s.inventory), 'inventory unchanged by refresh');
  check(await page.isVisible('#reveal'), 'missed reveal is replayed');
  await advance(page, 1000); for (let i = 0; i < 40; i++) await page.clock.runFor(400);
  await page.click('#btn-continue');
  check((await save(page)).unseenReveal === null, 'continue acknowledges reveal');

  console.log('Start another fire');
  await page.click('.tray-item[data-id="twigs"]');
  check((await page.textContent('#stoke-btn')).includes('LIGHT FIRE'), 'LIGHT FIRE offered on a cold pit');
  await page.click('#stoke-btn');
  s = await save(page);
  check(s.fire.status === 'burning' && s.fire.materialsCount === 1, 'new fire lit, progress preserved');
  check(s.upgrades.capacity === 2 && Object.keys(s.discoveries).length > 0, 'upgrades and discoveries persisted');

  console.log('Shop, satchel and journal render');
  await nav(page, 'materials');
  await page.click('.subtab[data-sub="satchel"]');
  const sparks0 = (await save(page)).sparks;
  if (await page.isEnabled('[data-act="sell-all"]')) await page.click('[data-act="sell-all"]');
  check((await save(page)).sparks > sparks0, 'treasures sold for sparks');
  await page.click('.subtab[data-sub="shop"]');
  await page.click('[data-act="buy"][data-id="twigs"][data-qty="1"]');
  check((await save(page)).inventory.twigs >= 1, 'bought twigs');
  await nav(page, 'journal');
  check((await page.$$('.disc')).length > 20, 'discovery journal lists items');
  check((await page.$$('.disc.unknown')).length > 0, 'undiscovered items are silhouettes');

  await page.close();
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll end-to-end checks passed.');
  process.exit(failures ? 1 : 0);
})();
