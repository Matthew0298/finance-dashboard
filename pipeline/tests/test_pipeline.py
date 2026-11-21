import io
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import patch

from fd_pipeline import storage
from fd_pipeline.cli import main
from fd_pipeline.providers.base import ProviderError


class EndToEndTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="fd-e2e-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def run_cli(self, *extra: str) -> int:
        args = ["run", "--provider", "synthetic", "--store", str(self.root / "store"),
                "--out", str(self.root / "site"), "--today", "2026-11-21", *extra]
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            return main(args)

    def test_full_run_publishes_audited_synthetic_data(self):
        self.assertEqual(self.run_cli(), 0)
        data = self.root / "site" / "data"
        self.assertEqual(storage.read_json(data / "audit.json")["status"], "pass")
        manifest = storage.read_json(data / "manifest.json")
        self.assertEqual(manifest["data_source"], "synthetic")  # the UI and the workflow rely on this flag
        self.assertEqual(set(manifest["files"]), {"universe.json", "rules.json", "signals.json", "fx.json"})

    def test_running_twice_in_the_same_folder_still_passes(self):
        self.assertEqual(self.run_cli(), 0)
        self.assertEqual(self.run_cli(), 0)  # regression: a stale manifest used to fail the second run

    def test_a_failed_audit_stops_the_run_before_publishing(self):
        class Down:  # a source that is completely unreachable
            name = "down"
            delay_seconds = 0.0

            def fetch_prices(self, instrument, start, end):
                raise ProviderError("source unreachable")

            def fetch_fx(self, currencies, today):
                raise ProviderError("source unreachable")

        with patch("fd_pipeline.cli.get_provider", return_value=Down()):
            code = self.run_cli()
        self.assertEqual(code, 1)
        data = self.root / "site" / "data"
        self.assertEqual(storage.read_json(data / "audit.json")["status"], "fail")
        self.assertFalse((data / "manifest.json").exists(), "nothing may be published after a failed audit")
        self.assertFalse((data / "signals.json").exists(), "the forecast step must not run after a failed audit")

    def test_audit_command_returns_failure_code_on_error(self):
        self.assertEqual(self.run_cli(), 0)
        (self.root / "store" / "prices" / "BTC.csv").unlink()
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            code = main(["audit", "--stage", "raw", "--store", str(self.root / "store"),
                         "--out", str(self.root / "site"), "--today", "2026-11-21"])
        self.assertEqual(code, 1)


if __name__ == "__main__":
    unittest.main()
