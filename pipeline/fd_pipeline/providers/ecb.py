"""ECB euro reference rates via the SDMX REST API (no key required)."""

from __future__ import annotations

import csv
import io
import urllib.error
import urllib.request
from datetime import date

from .base import ProviderError

URL = (
    "https://data-api.ecb.europa.eu/service/data/EXR/D.{ccys}.EUR.SP00.A"
    "?lastNObservations=1&format=csvdata"
)
USER_AGENT = "finance-dashboard/0.1 (personal project)"


def parse_fx_csv(text: str) -> tuple[str, dict[str, float]]:
    """Return (asof, {currency: units per 1 EUR}) from the ECB CSV."""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise ProviderError("ECB returned no rows")
    rates: dict[str, float] = {}
    asof = ""
    for row in rows:
        try:
            ccy = row["CURRENCY"]
            value = float(row["OBS_VALUE"])
            period = row["TIME_PERIOD"]
        except (KeyError, ValueError) as exc:
            raise ProviderError(f"unexpected ECB CSV format: {exc}") from exc
        rates[ccy] = value
        asof = max(asof, period)
    return asof, rates


def fetch_fx(currencies: list[str], today: date, timeout: float = 20.0) -> dict:
    wanted = sorted({c for c in currencies if c != "EUR"})
    if not wanted:
        return {"asof": today.isoformat(), "base": "EUR", "source": "ecb", "rates": {}}
    url = URL.format(ccys="+".join(wanted))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ProviderError(f"ECB request failed: {exc}") from exc
    asof, rates = parse_fx_csv(text)
    return {"asof": asof, "base": "EUR", "source": "ecb", "rates": rates}
