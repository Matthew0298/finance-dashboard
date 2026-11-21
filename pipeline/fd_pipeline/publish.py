"""Publish agent: assemble the public data folder and write the manifest."""

from __future__ import annotations

import hashlib
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import config, storage

# audit.json is excluded from the hashes: the final audit pass rewrites it after the manifest.
PUBLIC_FILES = ("universe.json", "rules.json", "signals.json", "fx.json")


def run_publish(store: Path, out_dir: Path, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    data = Path(out_dir) / "data"
    data.mkdir(parents=True, exist_ok=True)

    shutil.copyfile(config.UNIVERSE_PATH, data / "universe.json")
    shutil.copyfile(config.RULES_PATH, data / "rules.json")
    fx = Path(store) / "fx.json"
    if fx.exists():
        shutil.copyfile(fx, data / "fx.json")

    files = {}
    for name in PUBLIC_FILES:
        path = data / name
        if path.exists():
            files[name] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size}

    log_path = Path(store) / "ingest_log.json"
    data_source = storage.read_json(log_path).get("provider") if log_path.exists() else None

    manifest = {
        "schema_version": config.SCHEMA_VERSION,
        "generated_at": now.isoformat(timespec="seconds"),
        "commit": os.environ.get("GITHUB_SHA"),
        "data_source": data_source,  # "synthetic" must never reach production: the UI shows a banner
        "files": files,
    }
    storage.write_json(data / "manifest.json", manifest)
    return manifest
