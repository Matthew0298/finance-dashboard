"""File-based store: one CSV per instrument plus a few JSON files. In CI it is the `data` branch."""

from __future__ import annotations

import csv
import json
from datetime import date
from pathlib import Path

from .providers.base import Bar

HEADER = ["date", "close", "adjclose"]


def prices_path(store: Path, instrument_id: str) -> Path:
    return Path(store) / "prices" / f"{instrument_id}.csv"


def read_prices(store: Path, instrument_id: str) -> list[Bar]:
    path = prices_path(store, instrument_id)
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            Bar(date.fromisoformat(r["date"]), float(r["close"]), float(r["adjclose"]))
            for r in csv.DictReader(fh)
        ]


def write_prices(store: Path, instrument_id: str, bars: list[Bar]) -> None:
    path = prices_path(store, instrument_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    by_day = {b.day: b for b in bars}  # one row per day, later bars win
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(HEADER)
        for day in sorted(by_day):
            bar = by_day[day]
            writer.writerow([day.isoformat(), repr(round(bar.close, 6)), repr(round(bar.adjclose, 6))])


def read_json(path: Path):
    with Path(path).open(encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, payload) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1, sort_keys=False)
        fh.write("\n")
