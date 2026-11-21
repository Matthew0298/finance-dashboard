"""Forecast agent: turns stored prices into `signals.json` (signals, scenario cones, calibration)."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np

from .. import config, storage
from .scenarios import calibration, scenario_cone
from .signals import compute_signals


def _rng(instrument_id: str, last_day: date) -> np.random.Generator:
    digest = hashlib.sha256(f"{instrument_id}:{last_day.isoformat()}".encode()).hexdigest()
    return np.random.default_rng(int(digest[:16], 16))


def _spark(adjclose: np.ndarray) -> list[float]:
    weekly = adjclose[::-1][::5][: config.SPARK_POINTS][::-1]
    return [round(float(v), 4) for v in weekly]


def run_forecast(
    universe: list[dict], store: Path, out_dir: Path, today: date, now: datetime | None = None
) -> dict:
    now = now or datetime.now(timezone.utc)
    instruments: dict[str, dict] = {}

    for inst in universe:
        iid = inst["id"]
        bars = storage.read_prices(store, iid)
        if len(bars) < config.MIN_HISTORY:
            instruments[iid] = {"status": "insufficient_history", "n_obs": len(bars)}
            continue

        adjclose = np.array([b.adjclose for b in bars], dtype=float)
        log_returns = np.diff(np.log(adjclose))
        last = bars[-1]
        rng = _rng(iid, last.day)

        instruments[iid] = {
            "status": "ok",
            "last_date": last.day.isoformat(),
            "last_price": round(last.close, 4),
            "currency": inst["currency"],
            "n_obs": len(bars),
            "signals": compute_signals(adjclose),
            "spark": _spark(adjclose),
            "scenario": scenario_cone(log_returns[-config.LOOKBACK_DAYS :], rng),
            "calibration": calibration(log_returns, rng),
        }

    payload = {
        "schema_version": config.SCHEMA_VERSION,
        "generated_at": now.isoformat(timespec="seconds"),
        "asof": today.isoformat(),
        "method": {
            "name": "block_bootstrap",
            "lookback_days": config.LOOKBACK_DAYS,
            "block_days": config.BLOCK_SIZE,
            "paths": config.N_PATHS,
            "cone_horizons_days": [0, *config.CONE_HORIZONS],
            "calibration_horizon_days": config.CALIBRATION_HORIZON,
            "nominal_coverage": config.NOMINAL_COVERAGE,
            "price_basis": "adjclose (total return)",
        },
        "instruments": instruments,
    }
    data_dir = Path(out_dir) / "data"
    storage.write_json(data_dir / "signals.json", payload)
    # The manifest hashes signals.json, so a previous one is now stale: publish regenerates it.
    (data_dir / "manifest.json").unlink(missing_ok=True)
    return payload
