"""Yahoo Finance chart endpoint (unofficial, personal use only, no SLA).

Prices come from Yahoo, FX from the ECB. The auditor is the safety net: stale, missing or
implausible data blocks publication instead of reaching the dashboard.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

from . import ecb
from .base import Bar, ProviderError

URL = (
    "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
    "?period1={p1}&period2={p2}&interval=1d&events=div%2Csplit"
)
USER_AGENT = "Mozilla/5.0 (compatible; finance-dashboard personal project)"


def parse_chart(payload: dict) -> list[Bar]:
    chart = payload.get("chart") or {}
    if chart.get("error"):
        raise ProviderError(f"Yahoo error: {chart['error']}")
    results = chart.get("result") or []
    if not results:
        raise ProviderError("Yahoo returned an empty result")
    result = results[0]
    timestamps = result.get("timestamp") or []
    indicators = result.get("indicators") or {}
    quote = (indicators.get("quote") or [{}])[0]
    closes = quote.get("close") or []
    adjcloses = ((indicators.get("adjclose") or [{}])[0]).get("adjclose") or closes
    offset = int((result.get("meta") or {}).get("gmtoffset") or 0)
    by_day: dict[date, Bar] = {}
    for ts, close, adj in zip(timestamps, closes, adjcloses):
        if close is None or adj is None:
            continue
        day = datetime.fromtimestamp(ts + offset, tz=timezone.utc).date()
        by_day[day] = Bar(day, float(close), float(adj))  # the last bar of a day wins
    return [by_day[d] for d in sorted(by_day)]


class YahooProvider:
    name = "yahoo"
    delay_seconds = 0.7  # be polite: one request every ~second

    def __init__(self, retries: int = 3, timeout: float = 20.0):
        self.retries = retries
        self.timeout = timeout

    def _get_json(self, url: str) -> dict:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        last_error: Exception | None = None
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 404:
                    raise ProviderError(f"ticker not found (HTTP 404): {url}") from exc
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                last_error = exc
            time.sleep(2**attempt)
        raise ProviderError(f"Yahoo request failed after {self.retries} attempts: {last_error}")

    def fetch_prices(self, instrument: dict, start: date, end: date) -> list[Bar]:
        p1 = int(datetime(start.year, start.month, start.day, tzinfo=timezone.utc).timestamp())
        p2 = int(datetime(end.year, end.month, end.day, tzinfo=timezone.utc).timestamp()) + 86400
        url = URL.format(ticker=urllib.parse.quote(instrument["ticker"]), p1=p1, p2=p2)
        return parse_chart(self._get_json(url))

    def fetch_fx(self, currencies: list[str], today: date) -> dict:
        return ecb.fetch_fx(currencies, today)
