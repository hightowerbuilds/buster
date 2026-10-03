"""Prepare disposable native acceptance assets; run `bun run build` first."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("kind", choices=["print", "split"])
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
dist = Path(tempfile.mkdtemp(prefix=f"buster-mac-{args.kind}-smoke-", dir="/private/tmp"))
shutil.copytree(root / "dist", dist, dirs_exist_ok=True)
harness = f"native-macos-{args.kind}-smoke.js"
shutil.copy2(root / "scripts" / harness, dist / harness)
index = dist / "index.html"
index.write_text(index.read_text().replace("</body>", f'<script src="/{harness}"></script></body>'))
if args.kind == "print":
    # Tauri internals are read-only. Route only this disposable bundle through
    # the harness fixture; the normal app never includes the hook or harness.
    routed = 0
    for asset in (dist / "assets").glob("*.js"):
        content = asset.read_text()
        routed += content.count("window.__TAURI_INTERNALS__.invoke(")
        asset.write_text(content.replace("window.__TAURI_INTERNALS__.invoke(",
            "(window.__PRINT_SMOKE_INVOKE__ || window.__TAURI_INTERNALS__.invoke)("))
    if routed == 0:
        raise RuntimeError("Could not route invoke in the disposable bundle")
identifier = f"com.lukehightower.buster.parity-smoke-{args.kind}-{uuid.uuid4().hex}"
config = {"identifier": identifier, "build": {"frontendDist": str(dist)},
    "app": {"windows": [{"title": f"BusterMark {args.kind.title()} Smoke", "width": 1400,
                         "height": 900, "closable": True}]}}
prefix = Path(f"/private/tmp/bustermark-macos-{args.kind}-smoke")
Path(f"{prefix}-config.json").write_text(json.dumps(config))
Path(f"{prefix}-dist.txt").write_text(str(dist))
notes = Path.home() / "Library/Application Support" / identifier / "Notes"
Path(f"{prefix}-root.txt").write_text(str(notes))
print(f"Config: {prefix}-config.json")
print(f"Report: {notes}/{harness.removesuffix('.js')}-result.json")
