"""Ingest agent: refresh prices and FX into the store. Failures are recorded, not fatal."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import config, storage
from .providers.base import ProviderError


def run_ingest(provider, universe: list[dict], store: Path, today: date, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    log: dict = {
        "provider": provider.name,
        "run_at": now.isoformat(timespec="seconds"),
        "instruments": {},
        "fx": {},
    }
    start = today - timedelta(days=365 * config.HISTORY_YEARS)

    for index, inst in enumerate(universe):
        iid = inst["id"]
        if index:
            time.sleep(getattr(provider, "delay_seconds", 0.0))
        try:
            # Always refetch the whole window: adjusted closes are rescaled retroactively
            # after each dividend, so appending only new rows would mix two scales.
            bars = provider.fetch_prices(inst, start, today)
            existing = storage.read_prices(store, iid)
            if existing and len(bars) < config.SHORT_FETCH_RATIO * len(existing):
                raise ProviderError(
                    f"refetch returned {len(bars)} rows against {len(existing)} stored: kept the stored data"
                )
            known = {b.day for b in existing}
            storage.write_prices(store, iid, bars)
            log["instruments"][iid] = {
                "ok": True,
                "rows": len(bars),
                "new_rows": sum(1 for b in bars if b.day not in known),
            }
        except (ProviderError, OSError, ValueError) as exc:
            log["instruments"][iid] = {"ok": False, "error": str(exc)}

    currencies = sorted({i["currency"] for i in universe if i["currency"] != "EUR"})
    try:
        fx = provider.fetch_fx(currencies, today)
        storage.write_json(Path(store) / "fx.json", fx)
        log["fx"] = {"ok": True, "asof": fx["asof"], "currencies": sorted(fx["rates"])}
    except (ProviderError, OSError, ValueError) as exc:
        log["fx"] = {"ok": False, "error": str(exc)}

    storage.write_json(Path(store) / "ingest_log.json", log)
    return log
