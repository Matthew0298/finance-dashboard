from __future__ import annotations

from .base import Bar, ProviderError

__all__ = ["Bar", "ProviderError", "get_provider"]


def get_provider(name: str):
    """Return a provider with `fetch_prices(instrument, start, end)` and `fetch_fx(currencies, today)`."""
    if name == "synthetic":
        from .synthetic import SyntheticProvider

        return SyntheticProvider()
    if name == "yahoo":
        from .yahoo import YahooProvider

        return YahooProvider()
    raise ValueError(f"unknown provider: {name!r} (expected 'synthetic' or 'yahoo')")
