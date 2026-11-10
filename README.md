# Embers

*Keep the fire burning. Discover what remains.*

A small, cozy, mobile-first idle game about tending one campfire for as long as you can.
Collect fuel, stoke the fire when it runs low, and when it finally goes out, sift the ashes
for whatever the fuel left behind.

It's plain HTML, CSS and ES-module JavaScript, with no build step and no runtime dependencies,
so it runs directly on GitHub Pages.

## How to play

1. The fire burns in real time, even while the game is closed.
2. Once it drops to its last **45 minutes** you can stoke it. Tap fuel to fill your slots, then press **STOKE FIRE**.
   You start with 1 slot per stoke. Upgrades raise this to 2, 3, 4, 5, 7 and finally 10.
3. Each material has its own burn time, **heat**, **quality**, **essence**, **ash yield** and its own loot table.
   - Heat boosts fiery finds (charcoal, obsidian, Ember Cores)
   - Quality boosts uncommon-and-rarer finds
   - Essence boosts magical finds
   - Ash yield sets how many times the material rolls its loot table
4. When the fire reaches zero it goes out. Press **SIFT THROUGH ASHES** to get everything at once.
5. Sell treasures for **Sparks ✦**, buy fuel and permanent upgrades, then light another fire.
   **Ember Cores ◆** come from hot fires and endurance milestones, and pay for the deepest upgrades.
   Every fire also pays an **endurance bonus** with its ashes that grows smoothly with how long it burned,
   and a ladder of 15 one-time milestones (1 hour to 6 days) adds rewards and unlocks new fuel.
6. Twigs and leaves fall onto a small grassy patch over time, even while you're away. Tap **FORAGE**
   and tap each one to pick it up; up to 6 can lie there at once. An emergency fallback means you can
   never get stuck without fuel.

## Running locally

ES modules and `fetch()` need a web server; opening `index.html` as a file won't work.

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Any static server works (`npx http-server`, etc.).

## Tests

```bash
npm test
```

Unit tests for the game logic run on Node 18+ with no dependencies. They cover stoking rules,
capacity, inventory checks, offline expiry, reward generation, saves and migrations, upgrades,
the shop, milestones and gathering.

```bash
npm run test:e2e
```

This is a full browser playthrough using Playwright with a mocked clock. It serves the game
under a `/Ember/` sub-path, the same way GitHub Pages does. It covers starting a fire, stoking
with one and with several materials, stoking above the threshold, insufficient inventory,
upgrade purchases, refreshing during a fire, closing the app until the fire expires,
refreshing during pending ash, sifting, the reveal, and lighting a new fire.

## Deploying to GitHub Pages

The site is the repository root and every path is relative, so it works at
`https://<user>.github.io/<repo>/`.

**Option A: GitHub Actions (included)**
1. Merge to `main`.
2. In the repository, go to **Settings → Pages → Build and deployment** and set **Source: GitHub Actions**.
3. `.github/workflows/pages.yml` runs the unit tests and then deploys on every push to `main`.

**Option B: deploy from a branch**
In **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.
`.nojekyll` is already in place.

## Project structure

```
index.html              App shell
manifest.webmanifest    Install-to-home-screen metadata
css/style.css           All styling (pixel UI, mobile-first)
data/                   ALL balancing lives here
  config.json           Stoke threshold, capacity levels, starting kit, gathering, reward tuning
  materials.json        Burnable materials: stats, prices, unlocks, per-material loot tables
  items.json            Reward items: rarity, value, tags (heat/magic), icons
  upgrades.json         Upgrades: effects and per-level costs
  milestones.json       Endurance milestones and rewards
js/
  main.js               Entry point: wiring, reveal flow, sheets, timers
  game.js               Owns state; sync → mutate → save for every action
  data.js               Loads and validates JSON definitions
  logic/                Pure, DOM-free game rules (unit-tested)
    fire.js             Timestamp-based fire simulation, stoking, extinguish, ash collection
    rewards.js          Per-material loot generation
    economy.js          Shop, selling, upgrades, gathering, milestones, unlocks, forage
    stats.js            Upgrade-derived values
    state.js            Save format, versioning, migrations, safe storage
  ui/                   Views, canvas scene, pixel icons, synthesized audio
assets/
  source/               Original sprite art (forest, campfire)
  sprites/              Native-resolution sprites derived by tools/build_sprites.py
  fonts/                Self-hosted Silkscreen (SIL OFL)
  icons/                App icons
tools/
  build_sprites.py      Rebuilds assets/sprites from assets/source (needs Pillow + numpy)
  build_icon.py         Rebuilds the app icons in assets/icons (needs Pillow)
  icon-preview.html     Dev page showing every item icon
tests/                  Unit tests + end-to-end playthrough
```

## Tuning the game

Every gameplay number lives in `data/*.json`. To add a material, add an entry to `materials.json`
with its stats and a `loot` table. Any loot item it references must exist in `items.json` or
`materials.json`. The loader checks these references and throws an error on startup if one is
missing. Icons are 16×16 shape programs (`js/ui/icons.js`) recoloured by a five-colour palette
given in the JSON.

## Persistence and offline progress

- The save lives in `localStorage` under the key `embers-save`. It has a version number and a
  migration table (`MIGRATIONS` in `js/logic/state.js`). Every write also keeps the previous copy
  as `embers-save-backup`.
- Elapsed time always comes from stored timestamps, never from timers. On load, and whenever the
  app becomes visible, the fire is advanced to "now". If it ran out while you were away, it goes
  out at the exact moment the fuel ended.
- Rewards are generated once, in the same save as the fire going out, and stored as `pendingAsh`.
  Sifting moves them into the inventory in a single save before the reveal animation plays. A
  refresh can't lose or duplicate them, and a reveal you missed is shown again.
- If the device clock moves backwards, no fire time is added or removed.
- If a save can't be read, it is set aside under its own key rather than overwritten. Storage
  errors show a warning instead of crashing.
- When two tabs are open, each one picks up the other's newer save before doing anything.
- From the ☰ menu you can export a backup, import one, or reset progress.
