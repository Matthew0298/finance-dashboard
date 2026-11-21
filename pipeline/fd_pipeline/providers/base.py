from __future__ import annotations

from dataclasses import dataclass
from datetime import date


class ProviderError(RuntimeError):
    """A data source failed or returned unusable data."""


@dataclass(frozen=True)
class Bar:
    """One daily observation. `adjclose` includes dividends/splits (total return)."""

    day: date
    close: float
    adjclose: float
