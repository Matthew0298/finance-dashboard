import math
import unittest

import numpy as np

from fd_pipeline import config
from fd_pipeline.forecast.scenarios import bootstrap_log_paths, calibration, scenario_cone
from fd_pipeline.forecast.signals import compute_signals
from tests.helpers import PipelineCase, TODAY
from fd_pipeline.forecast import run_forecast


class SignalsTest(unittest.TestCase):
    def test_steady_growth_matches_closed_form(self):
        # p_k = 100 * 1.001^k, n = 300 points: every return is a power of 1.001
        n = 300
        p = 100 * 1.001 ** np.arange(n)
        s = compute_signals(p)
        self.assertEqual(s["ret_1m"], round(1.001**21 - 1, 4))
        self.assertEqual(s["ret_12m"], round(1.001**252 - 1, 4))
        self.assertEqual(s["momentum_12_1"], round(1.001**231 - 1, 4))  # p[-22] / p[-253]
        self.assertEqual(s["max_drawdown_1y"], 0.0)
        self.assertTrue(s["above_sma200"])
        self.assertAlmostEqual(s["vol_ann"], 0.0, places=6)  # constant log return -> no dispersion

    def test_drawdown_is_peak_to_trough_in_the_last_year(self):
        # climbs 100 -> 200, then falls to 150: drawdown = 150/200 - 1 = -25%
        p = np.concatenate([np.linspace(100, 200, 260), np.linspace(200, 150, 40)[1:]])
        self.assertEqual(compute_signals(p)["max_drawdown_1y"], -0.25)

    def test_short_series_returns_none_not_garbage(self):
        s = compute_signals(100 * 1.001 ** np.arange(100))
        self.assertIsNone(s["ret_12m"])
        self.assertIsNone(s["momentum_12_1"])
        self.assertIsNone(s["above_sma200"])


class ScenarioTest(unittest.TestCase):
    def test_zero_volatility_collapses_to_the_deterministic_path(self):
        mu = 0.0004
        cone = scenario_cone(np.full(504, mu), np.random.default_rng(1))
        expected = round(math.exp(mu * 252), 4)
        self.assertEqual(cone["horizons"], [0, 21, 63, 126, 252])
        for key in ("p10", "p25", "p50", "p75", "p90"):
            self.assertEqual(cone["quantiles"][key][0], 1.0)
            self.assertEqual(cone["quantiles"][key][-1], expected)
        self.assertEqual(cone["prob_loss"], 0.0)

    def test_constant_losses_mean_certain_loss(self):
        cone = scenario_cone(np.full(504, -0.0004), np.random.default_rng(1))
        self.assertEqual(cone["prob_loss"], 1.0)

    def test_quantiles_are_ordered_at_every_horizon(self):
        returns = np.random.default_rng(7).normal(0.0003, 0.01, 504)
        q = scenario_cone(returns, np.random.default_rng(2))["quantiles"]
        for i in range(5):
            self.assertLessEqual(q["p10"][i], q["p25"][i])
            self.assertLessEqual(q["p25"][i], q["p50"][i])
            self.assertLessEqual(q["p50"][i], q["p75"][i])
            self.assertLessEqual(q["p75"][i], q["p90"][i])
        self.assertLess(q["p10"][-1], q["p90"][-1])

    def test_same_seed_same_result(self):
        returns = np.random.default_rng(7).normal(0.0003, 0.01, 504)
        a = scenario_cone(returns, np.random.default_rng(5))
        b = scenario_cone(returns, np.random.default_rng(5))
        self.assertEqual(a, b)

    def test_bootstrap_shape_and_blocks(self):
        paths = bootstrap_log_paths(np.arange(100, dtype=float), horizon=50, n_paths=10, block=21, rng=np.random.default_rng(0))
        self.assertEqual(paths.shape, (10, 50))

    def test_calibration_on_iid_returns_is_near_nominal(self):
        returns = np.random.default_rng(11).normal(0.0003, 0.01, 2500)
        cal = calibration(returns, np.random.default_rng(3))
        self.assertIsNotNone(cal)
        self.assertGreater(cal["n_windows"], 80)
        # With iid data the 10-90 band should hold about 80% of the time (deterministic seeds: no flakiness)
        self.assertTrue(0.65 <= cal["observed"] <= 0.92, cal)

    def test_calibration_needs_enough_history(self):
        self.assertIsNone(calibration(np.random.default_rng(1).normal(0, 0.01, 400), np.random.default_rng(3)))


class RunForecastTest(PipelineCase):
    def test_every_instrument_gets_signals_with_synthetic_history(self):
        payload = run_forecast(self.universe, self.store, self.site, TODAY)
        self.assertEqual(set(payload["instruments"]), {i["id"] for i in self.universe})
        for entry in payload["instruments"].values():
            self.assertEqual(entry["status"], "ok")
            self.assertEqual(len(entry["spark"]), config.SPARK_POINTS)
            self.assertIsNotNone(entry["calibration"])

    def test_short_history_is_reported_not_forecast(self):
        path = self.store / "prices" / "SWDA.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        path.write_text("\n".join(lines[:1] + lines[-100:]) + "\n", encoding="utf-8")
        entry = run_forecast(self.universe, self.store, self.site, TODAY)["instruments"]["SWDA"]
        self.assertEqual(entry["status"], "insufficient_history")
        self.assertEqual(entry["n_obs"], 100)

    def test_results_are_reproducible(self):
        a = run_forecast(self.universe, self.store, self.site, TODAY)
        b = run_forecast(self.universe, self.store, self.site, TODAY)
        self.assertEqual(a["instruments"], b["instruments"])


if __name__ == "__main__":
    unittest.main()
