"""Descriptive signals computed from the adjusted-close series. They describe, they do not predict."""

from __future__ import annotations

import numpy as np


def _simple_return(prices: np.ndarray, lag: int) -> float | None:
    if len(prices) <= lag:
        return None
    return float(prices[-1] / prices[-1 - lag] - 1.0)


def _r(value: float | None) -> float | None:
    return None if value is None else round(value, 4)


def compute_signals(adjclose: np.ndarray) -> dict:
    """Returns over 1/3/6/12 months, annualised volatility, 1y max drawdown, trend and 12-1 momentum."""
    p = np.asarray(adjclose, dtype=float)
    n = len(p)
    log_returns = np.diff(np.log(p))
    last_year = log_returns[-252:]

    window = p[-253:]
    drawdown = float(np.min(window / np.maximum.accumulate(window) - 1.0))

    sma200 = float(np.mean(p[-200:])) if n >= 200 else None
    signals = {
        "ret_1m": _simple_return(p, 21),
        "ret_3m": _simple_return(p, 63),
        "ret_6m": _simple_return(p, 126),
        "ret_12m": _simple_return(p, 252),
        "vol_ann": float(np.std(last_year, ddof=1) * np.sqrt(252)) if len(last_year) >= 60 else None,
        "max_drawdown_1y": drawdown,
        "dist_sma200": float(p[-1] / sma200 - 1.0) if sma200 else None,
        "above_sma200": bool(p[-1] > sma200) if sma200 else None,
        "momentum_12_1": float(p[-22] / p[-253] - 1.0) if n >= 253 else None,
    }
    return {k: (v if isinstance(v, bool) else _r(v)) for k, v in signals.items()}
