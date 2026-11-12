#!/usr/bin/env python3
"""Apply an Ember Workshop change file to the game's data.

Writes data/materials.json, data/items.json, data/upgrades.json and
data/overlays.json, and the upgrade sections in data/config.json, then loads
everything through the game's own data loader to check it. If that check
fails, every file is put back the way it was.

Usage:  python3 tools/apply_workshop.py embers-workshop.json
Requires: Node.js (for the check)
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

CHECK = """
import { readFileSync } from 'node:fs';
import { buildData } from './js/data.js';
const load = (n) => JSON.parse(readFileSync(`./data/${n}.json`, 'utf8'));
const d = buildData({ config: load('config'), materials: load('materials'), items: load('items'),
  upgrades: load('upgrades'), milestones: load('milestones'), overlays: load('overlays') });
console.log(`ok: ${d.materials.length} materials, ${d.items.length} ash items, ${d.upgrades.length} upgrades, ${d.overlays.length} overlays`);
"""


def dump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def main(path):
    bundle = json.loads(Path(path).read_text())
    if bundle.get("format") != "embers-workshop":
        raise SystemExit("That is not an Ember Workshop change file.")
    targets = {
        "materials.json": bundle["materials"],
        "items.json": bundle["items"],
        "upgrades.json": bundle["upgrades"],
        "overlays.json": bundle.get("overlays", []),
    }
    backups = {name: (DATA / name).read_text() if (DATA / name).exists() else None for name in [*targets, "config.json"]}
    try:
        for name, value in targets.items():
            (DATA / name).write_text(dump(value))
        if "upgradeGroups" in bundle:
            config = json.loads(backups["config.json"])
            config["upgradeGroups"] = bundle["upgradeGroups"]
            (DATA / "config.json").write_text(dump(config))
        result = subprocess.run(["node", "--input-type=module", "-e", CHECK], cwd=ROOT, capture_output=True, text=True)
        if result.returncode != 0:
            lines = result.stderr.strip().splitlines()
            reason = next((ln.split("Error: ", 1)[1] for ln in lines if "Error: " in ln), lines[-1] if lines else "check failed")
            raise RuntimeError(reason)
        print(result.stdout.strip())
        print("Applied. Review with `git diff data/`, then commit.")
    except Exception as err:  # put everything back
        for name, text in backups.items():
            if text is None:
                (DATA / name).unlink(missing_ok=True)
            else:
                (DATA / name).write_text(text)
        raise SystemExit(f"Not applied, nothing was changed: {err}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
