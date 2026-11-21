from __future__ import annotations

import copy
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

from fd_pipeline import config
from fd_pipeline.audit import run_audit
from fd_pipeline.forecast import run_forecast
from fd_pipeline.ingest import run_ingest
from fd_pipeline.providers.synthetic import SyntheticProvider
from fd_pipeline.publish import run_publish

TODAY = date(2026, 11, 21)  # a Saturday: the last synthetic bar is Friday 2026-11-20


class PipelineCase(unittest.TestCase):
    """Builds a synthetic store once per class; every test works on its own copy."""

    @classmethod
    def setUpClass(cls):
        cls._base = Path(tempfile.mkdtemp(prefix="fd-tests-"))
        cls.universe = config.load_universe()
        cls.rules = config.load_rules()
        run_ingest(SyntheticProvider(), cls.universe, cls._base / "store", TODAY)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls._base, ignore_errors=True)

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="fd-case-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        shutil.copytree(self._base / "store", self.root / "store")
        self.store = self.root / "store"
        self.site = self.root / "site"
        self.universe = copy.deepcopy(type(self).universe)
        self.rules = copy.deepcopy(type(self).rules)

    # helpers
    def audit(self, stage: str, today: date = TODAY) -> dict:
        return run_audit(stage, store=self.store, site=self.site, universe=self.universe, rules=self.rules, today=today)

    def produce_outputs(self) -> None:
        run_forecast(self.universe, self.store, self.site, TODAY)
        run_publish(self.store, self.site)

    @staticmethod
    def failures(result: dict, check_id: str) -> list[dict]:
        return [c for c in result["checks"] if c["id"] == check_id and not c["ok"]]
