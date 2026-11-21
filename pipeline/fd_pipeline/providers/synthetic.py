"""Deterministic fake prices for tests and offline development. Never use as real data."""

from __future__ import annotations

import hashlib
from datetime import date

import numpy as np

from .base import Bar

ANCHOR = date(2015, 1, 1)  # series are generated from here, so slices are stable over time

# (annual drift, annual volatility) per asset class
PROFILES = {
    "azionario": (0.07, 0.16),
    "obbligazionario": (0.025, 0.05),
    "materie_prime": (0.05, 0.15),
    "crypto": (0.30, 0.65),
}
FIXED_FX = {"USD": 1.10, "GBP": 0.85, "CHF": 0.95, "JPY": 160.0}


def _weekdays(start: date, end: date) -> list[date]:
    days = np.arange(np.datetime64(start), np.datetime64(end) + 1)
    days = days[np.is_busday(days)]
    return [d.astype(object) for d in days]


class SyntheticProvider:
    name = "synthetic"
    delay_seconds = 0.0

    def fetch_prices(self, instrument: dict, start: date, end: date) -> list[Bar]:
        mu, sigma = PROFILES.get(instrument["asset_class"], PROFILES["azionario"])
        seed = int.from_bytes(hashlib.sha256(instrument["id"].encode()).digest()[:8], "big")
        rng = np.random.default_rng(seed)
        days = _weekdays(ANCHOR, end)
        dt = 1.0 / 252.0
        # Student-t shocks (df=5) rescaled to unit variance: fat tails like real markets
        shocks = rng.standard_t(5, len(days)) / np.sqrt(5.0 / 3.0)
        logret = (mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * shocks
        prices = 100.0 * np.exp(np.cumsum(logret))
        return [Bar(d, round(float(p), 6), round(float(p), 6)) for d, p in zip(days, prices) if d >= start]

    def fetch_fx(self, currencies: list[str], today: date) -> dict:
        rates = {c: FIXED_FX[c] for c in currencies if c in FIXED_FX}
        return {"asof": today.isoformat(), "base": "EUR", "source": "synthetic", "rates": rates}
