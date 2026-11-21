import unittest
from datetime import date

from fd_pipeline.providers.base import ProviderError
from fd_pipeline.providers.ecb import parse_fx_csv
from fd_pipeline.providers.synthetic import SyntheticProvider
from fd_pipeline.providers.yahoo import parse_chart


def chart(timestamps, close, adj, offset=3600, error=None):
    return {
        "chart": {
            "result": [{"meta": {"gmtoffset": offset}, "timestamp": timestamps,
                        "indicators": {"quote": [{"close": close}], "adjclose": [{"adjclose": adj}]}}],
            "error": error,
        }
    }


class YahooParsingTest(unittest.TestCase):
    def test_parses_bars_and_applies_exchange_offset(self):
        # 1700000000 = 2023-11-14 22:13:20 UTC -> 23:13 local, still the 14th
        bars = parse_chart(chart([1700000000, 1700086400], [10.0, 11.0], [9.5, 10.5]))
        self.assertEqual([(b.day.isoformat(), b.close, b.adjclose) for b in bars],
                         [("2023-11-14", 10.0, 9.5), ("2023-11-15", 11.0, 10.5)])

    def test_last_bar_of_a_day_wins_and_missing_values_are_skipped(self):
        bars = parse_chart(chart([1700086400, 1700086500, 1700172800], [11.0, 11.5, None], [10.5, 11.0, None]))
        self.assertEqual(len(bars), 1)
        self.assertEqual((bars[0].close, bars[0].adjclose), (11.5, 11.0))

    def test_errors_are_raised_not_swallowed(self):
        with self.assertRaises(ProviderError):
            parse_chart({"chart": {"result": None, "error": {"code": "Not Found"}}})
        with self.assertRaises(ProviderError):
            parse_chart({"chart": {"result": [], "error": None}})


class EcbParsingTest(unittest.TestCase):
    CSV = (
        "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS\n"
        "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2026-11-20,1.0523,A\n"
        "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2026-11-19,0.8750,A\n"
    )

    def test_parses_rates_and_latest_date(self):
        asof, rates = parse_fx_csv(self.CSV)
        self.assertEqual(asof, "2026-11-20")
        self.assertEqual(rates, {"USD": 1.0523, "GBP": 0.875})

    def test_rejects_empty_and_malformed(self):
        with self.assertRaises(ProviderError):
            parse_fx_csv("KEY,CURRENCY,TIME_PERIOD,OBS_VALUE\n")
        with self.assertRaises(ProviderError):
            parse_fx_csv("KEY,CURRENCY,TIME_PERIOD,OBS_VALUE\nx,USD,2026-11-20,not-a-number\n")


class SyntheticProviderTest(unittest.TestCase):
    inst = {"id": "TEST", "asset_class": "azionario"}

    def test_is_deterministic_and_weekdays_only(self):
        p = SyntheticProvider()
        a = p.fetch_prices(self.inst, date(2024, 1, 1), date(2026, 11, 20))
        b = p.fetch_prices(self.inst, date(2024, 1, 1), date(2026, 11, 20))
        self.assertEqual(a, b)
        self.assertTrue(all(bar.day.weekday() < 5 for bar in a))
        self.assertTrue(all(bar.close > 0 for bar in a))

    def test_slices_agree_whatever_the_start_date(self):
        p = SyntheticProvider()
        long = {b.day: b for b in p.fetch_prices(self.inst, date(2020, 1, 1), date(2026, 11, 20))}
        short = p.fetch_prices(self.inst, date(2024, 6, 1), date(2026, 11, 20))
        self.assertTrue(all(long[b.day] == b for b in short))

    def test_different_instruments_differ(self):
        p = SyntheticProvider()
        other = {"id": "OTHER", "asset_class": "azionario"}
        self.assertNotEqual(p.fetch_prices(self.inst, date(2026, 1, 1), date(2026, 11, 20)),
                            p.fetch_prices(other, date(2026, 1, 1), date(2026, 11, 20)))


if __name__ == "__main__":
    unittest.main()
