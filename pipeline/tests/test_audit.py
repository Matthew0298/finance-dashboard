import json
from datetime import date

from fd_pipeline import storage
from fd_pipeline.audit.checks import isin_is_valid
from fd_pipeline.ingest import run_ingest
from fd_pipeline.providers.base import ProviderError
from tests.helpers import PipelineCase, TODAY


class IsinTest(PipelineCase):
    def test_known_isins(self):
        self.assertTrue(isin_is_valid("US0378331005"))  # Apple
        self.assertTrue(isin_is_valid("IE00B4L5Y983"))
        self.assertFalse(isin_is_valid("US0378331006"))  # wrong check digit
        self.assertFalse(isin_is_valid("US037833100"))  # too short
        self.assertFalse(isin_is_valid("us0378331005"))  # lower case


class RawStageTest(PipelineCase):
    def test_clean_synthetic_data_passes(self):
        result = self.audit("raw")
        self.assertEqual(result["status"], "pass", [c for c in result["checks"] if not c["ok"]])
        self.assertGreater(result["counts"]["checks"], 100)

    def test_stale_prices_block_publication(self):
        result = self.audit("raw", today=date(2026, 12, 15))
        self.assertEqual(result["status"], "fail")
        self.assertTrue(self.failures(result, "prices.freshness"))

    def test_moderately_stale_prices_only_warn(self):
        result = self.audit("raw", today=date(2026, 11, 30))  # 6 business days after 2026-11-20
        self.assertEqual(result["status"], "warn")
        self.assertTrue(all(c["severity"] == "warn" for c in self.failures(result, "prices.freshness")))

    def test_non_positive_price_is_an_error(self):
        path = self.store / "prices" / "SWDA.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        lines[-1] = lines[-1].split(",")[0] + ",-5.0,-5.0"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        result = self.audit("raw")
        self.assertEqual(result["status"], "fail")
        self.assertEqual([c["subject"] for c in self.failures(result, "prices.schema")], ["SWDA"])

    def test_duplicate_dates_are_an_error(self):
        path = self.store / "prices" / "VWCE.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        path.write_text("\n".join(lines + [lines[-1]]) + "\n", encoding="utf-8")
        self.assertTrue(self.failures(self.audit("raw"), "prices.schema"))

    def test_price_spike_is_flagged_as_outlier_warning(self):
        path = self.store / "prices" / "ENEL.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        day, close, adj = lines[500].split(",")
        lines[500] = f"{day},{float(close) * 3},{float(adj) * 3}"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        result = self.audit("raw")
        self.assertEqual(result["status"], "warn")
        self.assertEqual([c["subject"] for c in self.failures(result, "prices.outliers")], ["ENEL"])

    def test_frozen_feed_is_flagged(self):
        path = self.store / "prices" / "ISP.csv"
        lines = path.read_text(encoding="utf-8").splitlines()
        frozen = lines[600].split(",")
        for i in range(601, 615):
            lines[i] = f"{lines[i].split(',')[0]},{frozen[1]},{frozen[2]}"
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        self.assertTrue(self.failures(self.audit("raw"), "prices.flatline"))

    def test_missing_price_file_is_an_error(self):
        (self.store / "prices" / "BTC.csv").unlink()
        result = self.audit("raw")
        self.assertEqual(result["status"], "fail")
        self.assertEqual([c["subject"] for c in self.failures(result, "prices.exists")], ["BTC"])

    def test_wrong_isin_is_an_error(self):
        self.universe[0]["isin"] = "IE00B4L5Y984"
        self.assertTrue(self.failures(self.audit("raw"), "universe.isin"))

    def test_duplicate_ids_are_an_error(self):
        self.universe.append(dict(self.universe[0]))
        self.assertTrue(self.failures(self.audit("raw"), "universe.unique_ids"))

    def test_missing_fx_currency_is_an_error(self):
        fx = storage.read_json(self.store / "fx.json")
        del fx["rates"]["USD"]
        storage.write_json(self.store / "fx.json", fx)
        self.assertTrue(self.failures(self.audit("raw"), "fx.complete"))

    def test_failed_ingest_is_reported(self):
        log = storage.read_json(self.store / "ingest_log.json")
        log["instruments"]["AAPL"] = {"ok": False, "error": "HTTP 429"}
        storage.write_json(self.store / "ingest_log.json", log)
        self.assertEqual([c["subject"] for c in self.failures(self.audit("raw"), "ingest.instrument")], ["AAPL"])


class RulesAuditTest(PipelineCase):
    def test_rules_not_verified_for_over_a_year_are_an_error(self):
        self.rules["rules"][0]["last_verified"] = "2025-01-01"
        result = self.audit("raw")
        self.assertEqual(result["status"], "fail")
        self.assertTrue(self.failures(result, "rules.staleness"))

    def test_rules_not_verified_for_six_months_warn(self):
        self.rules["rules"][0]["last_verified"] = "2026-03-01"  # 265 days
        result = self.audit("raw")
        self.assertEqual(result["status"], "warn")

    def test_verification_date_in_the_future_is_an_error(self):
        self.rules["rules"][0]["last_verified"] = "2027-01-01"
        self.assertTrue(self.failures(self.audit("raw"), "rules.last_verified"))

    def test_rule_without_source_or_with_http_source_is_an_error(self):
        self.rules["rules"][1]["source"]["url"] = "http://example.com"
        del self.rules["rules"][2]["summary"]
        result = self.audit("raw")
        self.assertTrue(self.failures(result, "rules.values"))
        self.assertTrue(self.failures(result, "rules.schema"))

    def test_checklist_pointing_to_unknown_rule_is_an_error(self):
        self.rules["checklists"][0]["steps"][0]["rules"].append("fisco.non_esiste")
        self.assertTrue(self.failures(self.audit("raw"), "rules.checklist_refs"))

    def test_unverified_rules_are_reported_as_information(self):
        info = [c for c in self.audit("raw")["checks"] if c["id"] == "rules.verification_level"][0]
        self.assertEqual(info["severity"], "info")
        self.assertRegex(info["detail"], r"^\d+ regole su \d+")


class OutputStageTest(PipelineCase):
    def setUp(self):
        super().setUp()
        self.produce_outputs()

    def test_clean_outputs_pass(self):
        result = self.audit("output")
        self.assertEqual(result["status"], "pass", [c for c in result["checks"] if not c["ok"]])

    def test_unordered_quantiles_are_an_error(self):
        path = self.site / "data" / "signals.json"
        data = storage.read_json(path)
        q = data["instruments"]["SWDA"]["scenario"]["quantiles"]
        q["p10"], q["p90"] = q["p90"], q["p10"]
        storage.write_json(path, data)
        self.assertTrue(self.failures(self.audit("output"), "signals.quantiles"))

    def test_non_finite_values_are_an_error(self):
        path = self.site / "data" / "signals.json"
        text = path.read_text(encoding="utf-8").replace('"last_price": ', '"last_price": null, "x": ', 1)
        path.write_text(text, encoding="utf-8")
        self.assertTrue(self.failures(self.audit("output"), "signals.last_price"))

    def test_poor_calibration_warns(self):
        path = self.site / "data" / "signals.json"
        data = storage.read_json(path)
        data["instruments"]["BTC"]["calibration"]["observed"] = 0.31
        storage.write_json(path, data)
        result = self.audit("output")
        self.assertTrue(self.failures(result, "signals.calibration"))
        self.assertNotEqual(result["status"], "pass")

    def test_missing_instrument_in_signals_is_an_error(self):
        path = self.site / "data" / "signals.json"
        data = storage.read_json(path)
        del data["instruments"]["ENEL"]
        storage.write_json(path, data)
        self.assertEqual(self.audit("output")["status"], "fail")

    def test_file_changed_after_the_manifest_is_detected(self):
        (self.site / "data" / "rules.json").write_text('{"tampered": true}', encoding="utf-8")
        self.assertTrue(self.failures(self.audit("output"), "manifest.file"))

    def test_personal_data_patterns_in_published_files_are_an_error(self):
        (self.site / "data" / "notes.json").write_text(json.dumps({"iban": "IT60X0542811101000000123456"}), encoding="utf-8")
        self.assertTrue(self.failures(self.audit("output"), "privacy.scan"))
        (self.site / "data" / "notes.json").write_text(json.dumps({"portfolio": {"quantity": 3}}), encoding="utf-8")
        self.assertTrue(self.failures(self.audit("output"), "privacy.scan"))

    def test_isin_codes_do_not_trigger_the_iban_scan(self):
        self.assertFalse(self.failures(self.audit("output"), "privacy.scan"))

    def test_stages_are_merged_into_one_report(self):
        self.audit("raw")
        self.audit("output")
        report = storage.read_json(self.site / "data" / "audit.json")
        self.assertEqual(set(report["stages"]), {"raw", "output"})
        self.assertEqual(report["status"], "pass")


class ReportStatusTest(PipelineCase):
    def test_overall_status_is_the_worst_stage(self):
        self.produce_outputs()
        self.audit("output")  # pass
        self.audit("raw", today=date(2026, 12, 15))  # fail
        self.assertEqual(storage.read_json(self.site / "data" / "audit.json")["status"], "fail")


class IngestSafetyTest(PipelineCase):
    def test_a_short_refetch_does_not_overwrite_good_history(self):
        class Truncated:
            name = "truncated"
            delay_seconds = 0.0

            def fetch_prices(self, instrument, start, end):
                bars = SyntheticFull.fetch_prices(instrument, start, end)
                return bars[-20:]

            def fetch_fx(self, currencies, today):
                return SyntheticFull.fetch_fx(currencies, today)

        from fd_pipeline.providers.synthetic import SyntheticProvider

        SyntheticFull = SyntheticProvider()
        before = (self.store / "prices" / "SWDA.csv").read_text(encoding="utf-8")
        log = run_ingest(Truncated(), self.universe, self.store, TODAY)
        self.assertFalse(log["instruments"]["SWDA"]["ok"])
        self.assertEqual((self.store / "prices" / "SWDA.csv").read_text(encoding="utf-8"), before)

    def test_provider_failure_is_recorded_not_fatal(self):
        class Broken:
            name = "broken"
            delay_seconds = 0.0

            def fetch_prices(self, instrument, start, end):
                raise ProviderError("boom")

            def fetch_fx(self, currencies, today):
                raise ProviderError("fx boom")

        log = run_ingest(Broken(), self.universe, self.store, TODAY)
        self.assertTrue(all(not v["ok"] for v in log["instruments"].values()))
        self.assertFalse(log["fx"]["ok"])
