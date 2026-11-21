"""Fail if the repository contains something that looks like personal financial data.

The repo is public (free GitHub Pages), so personal data must never be committed (ADR-0001).
Checks the files tracked by git when available, otherwise every file under the repo root.
"""

from __future__ import annotations

import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_NAMES = ("*.portfolio.json", "portfolio*.json", ".env", ".env.*", "*.pem", "*.key", "id_rsa*")
FORBIDDEN_DIRS = ("private", "secrets")
SKIP_DIRS = {".git", "node_modules", "build", "store", "__pycache__", ".venv", "venv"}
TEXT_SUFFIXES = {".json", ".csv", ".md", ".py", ".js", ".mjs", ".html", ".css", ".yml", ".yaml", ".txt", ".toml"}

# Patterns that are never legitimate in this repository.
CONTENT_PATTERNS = {
    "IBAN": re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b"),
    "GitHub token": re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "portfolio fields in data files": re.compile(r'"(?:avgCost|lossCarryforward)"\s*:'),
}
# Files that may mention the pattern names on purpose (code and docs that implement or explain the guard).
CONTENT_ALLOWLIST = {
    # the auditor tests use a well-known fake IBAN as a fixture to prove the scan catches it
    "IBAN": ("pipeline/tests/",),
    "portfolio fields in data files": ("web/js/", "pipeline/fd_pipeline/audit/", "docs/", "tools/", ".claude/", "CLAUDE.md", "README.md"),
}


def tracked_files() -> list[Path]:
    try:
        out = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=ROOT, capture_output=True, check=True,
        ).stdout.decode("utf-8")
        names = [n for n in out.split("\0") if n]
        if names:
            return [ROOT / n for n in names if (ROOT / n).is_file()]
    except (OSError, subprocess.CalledProcessError):
        pass
    found: list[Path] = []
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]  # prune while walking: never enter build/, store/, .git...
        found.extend(Path(folder) / name for name in files)
    return found


def main() -> int:
    problems: list[str] = []
    for path in tracked_files():
        rel = path.relative_to(ROOT).as_posix()
        parts = set(rel.split("/")[:-1])
        if parts & set(FORBIDDEN_DIRS):
            problems.append(f"{rel}: file in a folder meant for private data")
        if any(fnmatch.fnmatch(path.name, pattern) for pattern in FORBIDDEN_NAMES):
            problems.append(f"{rel}: file name looks like personal data or a secret")
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES or path.stat().st_size > 2_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in CONTENT_PATTERNS.items():
            if any(rel.startswith(prefix) or rel == prefix for prefix in CONTENT_ALLOWLIST.get(label, ())):
                continue
            match = pattern.search(text)
            if match:
                problems.append(f"{rel}: possible {label}: {match.group(0)[:12]}...")
    if problems:
        print("privacy guard FAILED:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("privacy guard ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
