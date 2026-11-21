"""Block-bootstrap scenario cones and their walk-forward calibration (ADR-0003).

The cone says "if the next year resembles resampled chunks of the recent past, these are the
percentiles of the outcome". It carries the historical drift of the window and reacts slowly to
regime changes, which is exactly what the calibration check is there to expose.
"""

from __future__ import annotations

import numpy as np

from .. import config

QUANTILES = (0.10, 0.25, 0.50, 0.75, 0.90)


def bootstrap_log_paths(
    log_returns: np.ndarray, horizon: int, n_paths: int, block: int, rng: np.random.Generator
) -> np.ndarray:
    """Cumulative log-return paths, shape (n_paths, horizon), from resampled blocks of daily returns."""
    n = len(log_returns)
    if n < block:
        raise ValueError("series shorter than one block")
    n_blocks = -(-horizon // block)
    starts = rng.integers(0, n - block + 1, size=(n_paths, n_blocks))
    index = (starts[:, :, None] + np.arange(block)[None, None, :]).reshape(n_paths, n_blocks * block)
    return np.cumsum(log_returns[index[:, :horizon]], axis=1)


def scenario_cone(
    log_returns: np.ndarray,
    rng: np.random.Generator,
    horizons: tuple[int, ...] = config.CONE_HORIZONS,
    n_paths: int = config.N_PATHS,
    block: int = config.BLOCK_SIZE,
) -> dict:
    """Percentiles of the value multiplier (1.0 = today's price) at each horizon, plus P(loss) at the last."""
    longest = max(horizons)
    multipliers = np.exp(bootstrap_log_paths(log_returns, longest, n_paths, block, rng))
    quantiles = {}
    for q in QUANTILES:
        values = [round(float(np.quantile(multipliers[:, h - 1], q)), 4) for h in horizons]
        quantiles[f"p{round(q * 100)}"] = [1.0, *values]
    return {
        "horizons": [0, *horizons],
        "quantiles": quantiles,
        "prob_loss": round(float(np.mean(multipliers[:, longest - 1] < 1.0)), 4),
    }


def calibration(
    log_returns: np.ndarray,
    rng: np.random.Generator,
    horizon: int = config.CALIBRATION_HORIZON,
    lookback: int = config.LOOKBACK_DAYS,
    step: int = config.CALIBRATION_STEP,
    n_paths: int = config.CALIBRATION_PATHS,
) -> dict | None:
    """Walk-forward coverage of the p10-p90 band over `horizon` days.

    At each origin the band is built only from the `lookback` days before it, then compared with
    what really happened over the next `horizon` days. Windows overlap (step < horizon), so
    `n_windows` overstates the independent evidence: read the result as indicative.
    """
    n = len(log_returns)
    origins = list(range(lookback, n - horizon + 1, step))
    if len(origins) < config.CALIBRATION_MIN_WINDOWS:
        return None
    inside = 0
    for t in origins:
        train = log_returns[t - lookback : t]
        final = bootstrap_log_paths(train, horizon, n_paths, config.BLOCK_SIZE, rng)[:, -1]
        low, high = np.quantile(final, [0.10, 0.90])
        realized = float(np.sum(log_returns[t : t + horizon]))
        inside += int(low <= realized <= high)
    return {
        "horizon_days": horizon,
        "nominal": config.NOMINAL_COVERAGE,
        "observed": round(inside / len(origins), 4),
        "n_windows": len(origins),
    }
