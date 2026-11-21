"""Shared constants and loaders. Thresholds live here so the auditor and docs agree."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UNIVERSE_PATH = ROOT / "data" / "universe.json"
RULES_PATH = ROOT / "data" / "compliance" / "rules.json"

SCHEMA_VERSION = 1

# --- ingest -----------------------------------------------------------------
HISTORY_YEARS = 6
SHORT_FETCH_RATIO = 0.8  # a refetch shorter than this share of the stored rows is rejected

# --- forecast (ADR-0003) ----------------------------------------------------
MIN_HISTORY = 300  # observations needed for signals and scenarios
LOOKBACK_DAYS = 504  # trailing window resampled by the bootstrap
BLOCK_SIZE = 21  # bootstrap block length (about one month)
N_PATHS = 2000
CONE_HORIZONS = (21, 63, 126, 252)  # trading days
CALIBRATION_HORIZON = 63
CALIBRATION_STEP = 21
CALIBRATION_PATHS = 400
CALIBRATION_MIN_WINDOWS = 8
NOMINAL_COVERAGE = 0.80  # the p10-p90 band
CALIBRATION_OK_RANGE = (0.60, 0.95)
SPARK_POINTS = 104  # weekly points kept for charts

# --- audit ------------------------------------------------------------------
STALE_WARN_BDAYS = 4
STALE_ERROR_BDAYS = 10
FX_STALE_WARN_DAYS = 7
MAX_GAP_DAYS = 10
FLATLINE_RUN = 10
OUTLIER_LOG_RETURN = {"default": 0.20, "crypto": 0.40}
RULE_STALE_WARN_DAYS = 180
RULE_STALE_ERROR_DAYS = 365
MAX_FILE_BYTES = 5 * 1024 * 1024

RULE_AREAS = ("fisco", "dichiarazione", "regolamentazione")
VERIFICATION_LEVELS = ("primaria", "secondaria", "da_verificare")
ASSET_CLASS_PROFILES = ("azionario", "obbligazionario", "materie_prime", "crypto")


def load_json(path: Path) -> dict:
    with Path(path).open(encoding="utf-8") as fh:
        return json.load(fh)


def load_universe(path: Path = UNIVERSE_PATH) -> list[dict]:
    return load_json(path)["instruments"]


def load_rules(path: Path = RULES_PATH) -> dict:
    return load_json(path)


def tax_classes(path: Path = UNIVERSE_PATH) -> tuple[str, ...]:
    return tuple(load_json(path)["tax_classes"])
