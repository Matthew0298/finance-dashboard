"""Assemble the static site: copy web/ into build/site/ (keeping the generated data/ folder).

Test files and the Node package marker are left out: they are not part of the site.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main(out: Path = ROOT / "build" / "site") -> int:
    src = ROOT / "web"
    if not (out / "data" / "manifest.json").exists():
        print(f"error: {out / 'data' / 'manifest.json'} not found: run the pipeline first", file=sys.stderr)
        return 1
    shutil.copytree(
        src,
        out,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("*.test.mjs", "package.json"),
    )
    (out / ".nojekyll").write_text("", encoding="utf-8")  # serve files as they are on GitHub Pages
    count = sum(1 for p in out.rglob("*") if p.is_file())
    print(f"site assembled in {out} ({count} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "site"))
