#!/usr/bin/env python3
"""Build the Ember Workshop editor as one self-contained HTML page.

It bundles the game's current data (data/*.json), its sprites (assets/sprites/*.png)
and its real drawing code (js/ui/scene.js, js/ui/icons.js), so the editor's
previews match the game exactly.

Usage:  python3 tools/build_workshop.py [output.html]
        (default output: tools/workshop/dist/ember-workshop.html)
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "workshop" / "workshop.html"
DATA_FILES = ["config", "materials", "items", "upgrades", "milestones", "overlays"]


def as_script(path, name):
    """Turn an ES module into a plain script exposing its exports as `name`."""
    src = path.read_text()
    if re.search(r"^import ", src, re.M):
        raise SystemExit(f"{path} has imports; the workshop expects a standalone module")
    exports = re.findall(r"^export (?:async function|function|class|const|let) (\w+)", src, re.M)
    body = re.sub(r"^export ", "", src, flags=re.M)
    return f"const {name} = (() => {{\n{body}\nreturn {{ {', '.join(exports)} }};\n}})();"


def build(out):
    data = {n: json.loads((ROOT / "data" / f"{n}.json").read_text()) for n in DATA_FILES}
    sprites = {}
    for png in sorted((ROOT / "assets" / "sprites").glob("*.png")):
        sprites[png.stem] = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
    game = json.dumps({"data": data, "sprites": sprites}, ensure_ascii=False).replace("</", "<\\/")
    html = TEMPLATE.read_text()
    html = html.replace("/*__GAME__*/null", game)
    html = html.replace("/*__SCENE_LIB__*/", as_script(ROOT / "js" / "ui" / "scene.js", "SceneLib"))
    html = html.replace("/*__ICONS_LIB__*/", as_script(ROOT / "js" / "ui" / "icons.js", "IconsLib"))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(f"wrote {out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tools" / "workshop" / "dist" / "ember-workshop.html")
