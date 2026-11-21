"""Auditor agent: runs a stage of checks and writes `data/audit.json` (merging stages)."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, timezone
from pathlib import Path

from .. import config, storage
from . import checks as C

STAGES = ("raw", "output")
ORDER = {"pass": 0, "warn": 1, "fail": 2}


def _status(items: list[C.Check]) -> str:
    if any(not c.ok and c.severity == "error" for c in items):
        return "fail"
    if any(not c.ok and c.severity == "warn" for c in items):
        return "warn"
    return "pass"


def run_audit(
    stage: str,
    *,
    store: Path,
    site: Path,
    universe: list[dict],
    rules: dict,
    today: date,
    now: datetime | None = None,
) -> dict:
    """Run one stage, merge it into audit.json and return the stage result."""
    if stage not in STAGES:
        raise ValueError(f"unknown stage {stage!r}")
    now = now or datetime.now(timezone.utc)
    classes = config.tax_classes()

    if stage == "raw":
        items = (
            C.check_universe(universe, classes)
            + C.check_prices(store, universe, today)
            + C.check_ingest_log(store, universe)
            + C.check_fx(store, universe, today)
            + C.check_rules(rules, classes, today)
        )
    else:
        items = C.check_signals(site, universe) + C.check_manifest(site) + C.check_privacy(site)

    result = {
        "status": _status(items),
        "ran_at": now.isoformat(timespec="seconds"),
        "counts": {
            "checks": len(items),
            "failed_errors": sum(1 for c in items if not c.ok and c.severity == "error"),
            "failed_warnings": sum(1 for c in items if not c.ok and c.severity == "warn"),
        },
        "checks": [asdict(c) for c in items],
    }

    path = Path(site) / "data" / "audit.json"
    report = storage.read_json(path) if path.exists() else {"schema_version": config.SCHEMA_VERSION, "stages": {}}
    report["stages"][stage] = result
    report["generated_at"] = now.isoformat(timespec="seconds")
    report["status"] = max((s["status"] for s in report["stages"].values()), key=ORDER.__getitem__)
    storage.write_json(path, report)
    return result
