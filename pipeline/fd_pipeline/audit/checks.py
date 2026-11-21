"""Auditor checks. Each function returns a list of `Check`; none of them modifies data.

severity: "error" blocks publication, "warn" is published with a banner, "info" is only reported.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np

from .. import config, storage


@dataclass
class Check:
    id: str
    severity: str
    ok: bool
    detail: str
    subject: str | None = None


def _check(cid: str, severity: str, ok: bool, detail_ok: str, detail_bad: str, subject: str | None = None) -> Check:
    return Check(cid, severity, ok, detail_ok if ok else detail_bad, subject)


def bdays_between(start: date, end: date) -> int:
    return int(np.busday_count(start, end))


# ---------------------------------------------------------------- universe


def isin_is_valid(isin: str) -> bool:
    """ISO 6166: 2 letters, 9 alphanumerics, 1 check digit (Luhn on the letters-as-numbers expansion)."""
    if not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", isin):
        return False
    digits = "".join(str(int(ch, 36)) for ch in isin)
    total = 0
    for position, ch in enumerate(reversed(digits)):
        d = int(ch)
        if position % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def check_universe(universe: list[dict], tax_classes: tuple[str, ...]) -> list[Check]:
    checks: list[Check] = []
    ids = [i["id"] for i in universe]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    checks.append(_check("universe.unique_ids", "error", not duplicates, "id univoci", f"id duplicati: {duplicates}"))
    for inst in universe:
        iid = inst["id"]
        isin = inst.get("isin")
        if isin:
            checks.append(_check("universe.isin", "error", isin_is_valid(isin), f"ISIN {isin} valido", f"ISIN {isin} con checksum errato", iid))
        known_class = inst.get("tax_class") in tax_classes
        checks.append(_check("universe.tax_class", "error", known_class, "classe fiscale nota", f"classe fiscale sconosciuta: {inst.get('tax_class')}", iid))
        ter = inst.get("ter")
        checks.append(_check("universe.ter", "warn", isinstance(ter, (int, float)) and 0 <= ter <= 5, "TER plausibile", f"TER non plausibile: {ter}", iid))
    return checks


# ------------------------------------------------------------------ prices


def check_prices(store: Path, universe: list[dict], today: date) -> list[Check]:
    checks: list[Check] = []
    for inst in universe:
        iid = inst["id"]
        try:
            bars = storage.read_prices(store, iid)
        except (ValueError, KeyError) as exc:
            checks.append(Check("prices.parse", "error", False, f"file dei prezzi illeggibile: {exc}", iid))
            continue
        if not bars:
            checks.append(Check("prices.exists", "error", False, "nessun dato di prezzo", iid))
            continue
        checks.append(Check("prices.exists", "error", True, f"{len(bars)} osservazioni", iid))

        days = [b.day for b in bars]
        close = np.array([b.close for b in bars])
        adj = np.array([b.adjclose for b in bars])

        increasing = all(a < b for a, b in zip(days, days[1:]))
        finite_positive = bool(np.all(np.isfinite(close)) and np.all(close > 0) and np.all(np.isfinite(adj)) and np.all(adj > 0))
        checks.append(_check("prices.schema", "error", increasing and finite_positive, "date crescenti, prezzi positivi e finiti", "date non crescenti/duplicate oppure prezzi nulli, negativi o non finiti", iid))
        if not (increasing and finite_positive):
            continue

        age = bdays_between(days[-1], today)
        severity = "error" if age > config.STALE_ERROR_BDAYS else "warn"
        checks.append(_check("prices.freshness", severity, age <= config.STALE_WARN_BDAYS, f"ultimo dato {days[-1]} ({age} gg lavorativi)", f"dato vecchio: ultimo {days[-1]}, {age} giorni lavorativi", iid))
        checks.append(_check("prices.history", "warn", len(bars) >= config.MIN_HISTORY, f"{len(bars)} osservazioni", f"storico corto: {len(bars)} < {config.MIN_HISTORY}, niente scenari", iid))

        gaps = [(a, b) for a, b in zip(days, days[1:]) if (b - a).days > config.MAX_GAP_DAYS]
        example = f"{gaps[0][0]} -> {gaps[0][1]}" if gaps else ""
        checks.append(_check("prices.gaps", "warn", not gaps, "nessun buco anomalo", f"buchi oltre {config.MAX_GAP_DAYS} giorni, per esempio {example}", iid))

        limit = config.OUTLIER_LOG_RETURN.get(inst["asset_class"], config.OUTLIER_LOG_RETURN["default"])
        jumps = np.abs(np.diff(np.log(adj)))
        bad = np.where(jumps > limit)[0]
        checks.append(_check("prices.outliers", "warn", len(bad) == 0, "nessun salto anomalo", f"{len(bad)} salti giornalieri oltre {limit:.0%}, per esempio il {days[bad[0] + 1] if len(bad) else ''}", iid))

        longest = run = 1
        for a, b in zip(close, close[1:]):
            run = run + 1 if a == b else 1
            longest = max(longest, run)
        checks.append(_check("prices.flatline", "warn", longest < config.FLATLINE_RUN, "nessuna serie congelata", f"{longest} chiusure identiche consecutive: feed fermo?", iid))
    return checks


def check_ingest_log(store: Path, universe: list[dict]) -> list[Check]:
    path = Path(store) / "ingest_log.json"
    if not path.exists():
        return [Check("ingest.log", "warn", False, "ingest_log.json assente", None)]
    log = storage.read_json(path)
    checks = []
    for inst in universe:
        entry = log.get("instruments", {}).get(inst["id"])
        if entry is None:
            checks.append(Check("ingest.instrument", "warn", False, "strumento non presente nell'ultimo ingest", inst["id"]))
        else:
            checks.append(_check("ingest.instrument", "warn", entry.get("ok", False), "scaricato", f"scaricamento fallito: {entry.get('error')}", inst["id"]))
    fx = log.get("fx", {})
    checks.append(_check("ingest.fx", "warn", fx.get("ok", False), "cambi scaricati", f"cambi non scaricati: {fx.get('error')}"))
    return checks


# ---------------------------------------------------------------------- fx


def check_fx(store: Path, universe: list[dict], today: date) -> list[Check]:
    path = Path(store) / "fx.json"
    if not path.exists():
        return [Check("fx.exists", "error", False, "fx.json assente")]
    fx = storage.read_json(path)
    rates = fx.get("rates", {})
    needed = sorted({i["currency"] for i in universe if i["currency"] != "EUR"})
    missing = [c for c in needed if c not in rates]
    invalid = [c for c, v in rates.items() if not (isinstance(v, (int, float)) and math.isfinite(v) and v > 0)]
    checks = [
        _check("fx.complete", "error", not missing, f"cambi presenti per {needed}", f"cambi mancanti: {missing}"),
        _check("fx.valid", "error", not invalid, "cambi positivi e finiti", f"cambi non validi: {invalid}"),
    ]
    try:
        age = (today - date.fromisoformat(fx.get("asof", ""))).days
    except ValueError:
        checks.append(Check("fx.freshness", "error", False, "data dei cambi illeggibile"))
        return checks
    checks.append(_check("fx.freshness", "warn", age <= config.FX_STALE_WARN_DAYS, f"cambi del {fx['asof']}", f"cambi vecchi di {age} giorni"))
    return checks


# ------------------------------------------------------------------- rules


def check_rules(rules: dict, tax_classes: tuple[str, ...], today: date) -> list[Check]:
    checks: list[Check] = []
    items = rules.get("rules", [])
    ids = [r.get("id") for r in items]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    checks.append(_check("rules.unique_ids", "error", not duplicates, f"{len(items)} regole con id univoci", f"id duplicati: {duplicates}"))

    classes_ok = set(tax_classes)
    unverified: list[str] = []
    for rule in items:
        rid = str(rule.get("id"))
        missing = [k for k in ("id", "area", "title", "summary", "applies_to", "verification", "source", "last_verified") if not rule.get(k)]
        checks.append(_check("rules.schema", "error", not missing, "campi completi", f"campi mancanti: {missing}", rid))
        if missing:
            continue
        valid = (
            rule["area"] in config.RULE_AREAS
            and rule["verification"] in config.VERIFICATION_LEVELS
            and set(rule["applies_to"]) <= classes_ok
            and str(rule["source"].get("url", "")).startswith("https://")
        )
        checks.append(_check("rules.values", "error", valid, "valori ammessi, fonte https", "area, verifica, classi o URL della fonte non validi", rid))
        try:
            age = (today - date.fromisoformat(rule["last_verified"])).days
        except ValueError:
            checks.append(Check("rules.last_verified", "error", False, "data di verifica illeggibile", rid))
            continue
        if age < 0:
            checks.append(Check("rules.last_verified", "error", False, "data di verifica nel futuro", rid))
        elif age > config.RULE_STALE_ERROR_DAYS:
            checks.append(Check("rules.staleness", "error", False, f"verificata {age} giorni fa", rid))
        else:
            checks.append(_check("rules.staleness", "warn", age <= config.RULE_STALE_WARN_DAYS, f"verificata {age} giorni fa", f"verificata {age} giorni fa: da riverificare", rid))
        if rule["verification"] != "primaria":
            unverified.append(rid)

    checks.append(Check("rules.verification_level", "info", True, f"{len(unverified)} regole su {len(items)} senza verifica su fonte ufficiale"))

    rule_ids = set(ids)
    broken = []
    covered = set()
    for checklist in rules.get("checklists", []):
        covered.add(checklist.get("id"))
        for step in checklist.get("steps", []):
            broken += [r for r in step.get("rules", []) if r not in rule_ids]
    checks.append(_check("rules.checklist_refs", "error", not broken, "le checklist puntano a regole esistenti", f"riferimenti a regole inesistenti: {sorted(set(broken))}"))
    uncovered = [c for c in tax_classes if c not in covered]
    checks.append(_check("rules.checklist_coverage", "warn", not uncovered, "ogni tipo di strumento ha una checklist", f"manca la checklist per: {uncovered}"))
    return checks


# ----------------------------------------------------------------- outputs

QUANTILE_KEYS = ("p10", "p25", "p50", "p75", "p90")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")
_PERSONAL_KEYS = re.compile(r'"(quantity|avgCost|positions|portfolio|lossCarryforward)"')


def _finite(values) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


def check_signals(site: Path, universe: list[dict]) -> list[Check]:
    path = Path(site) / "data" / "signals.json"
    if not path.exists():
        return [Check("signals.exists", "error", False, "signals.json assente")]
    data = storage.read_json(path)
    checks = [_check("signals.schema_version", "error", data.get("schema_version") == config.SCHEMA_VERSION, "versione dello schema attesa", f"schema_version inatteso: {data.get('schema_version')}")]
    entries = data.get("instruments", {})

    for inst in universe:
        iid = inst["id"]
        entry = entries.get(iid)
        if entry is None:
            checks.append(Check("signals.present", "error", False, "strumento assente da signals.json", iid))
            continue
        if entry.get("status") != "ok":
            checks.append(Check("signals.present", "warn", False, f"nessuno scenario: {entry.get('status')} ({entry.get('n_obs')} osservazioni)", iid))
            continue
        checks.append(Check("signals.present", "error", True, "presente", iid))

        scenario = entry.get("scenario", {})
        horizons = scenario.get("horizons", [])
        quantiles = scenario.get("quantiles", {})
        shape_ok = set(quantiles) == set(QUANTILE_KEYS) and all(len(quantiles[k]) == len(horizons) for k in QUANTILE_KEYS)
        values_ok = shape_ok and _finite([v for k in QUANTILE_KEYS for v in quantiles[k]])
        ordered = values_ok and all(
            all(quantiles[a][i] <= quantiles[b][i] for i in range(len(horizons)))
            for a, b in zip(QUANTILE_KEYS, QUANTILE_KEYS[1:])
        )
        starts_at_one = values_ok and all(quantiles[k][0] == 1.0 for k in QUANTILE_KEYS)
        checks.append(_check("signals.quantiles", "error", ordered and starts_at_one, "quantili finiti, ordinati, con partenza a 1", "quantili mancanti, non finiti, non ordinati o senza partenza a 1", iid))
        prob = scenario.get("prob_loss")
        checks.append(_check("signals.prob_loss", "error", isinstance(prob, (int, float)) and 0 <= prob <= 1, "probabilità di perdita in [0,1]", f"probabilità di perdita non valida: {prob}", iid))
        spark = entry.get("spark", [])
        checks.append(_check("signals.spark", "error", bool(spark) and _finite(spark) and min(spark) > 0, "serie ridotta valida", "serie ridotta vuota o non valida", iid))
        price = entry.get("last_price")
        checks.append(_check("signals.last_price", "error", isinstance(price, (int, float)) and math.isfinite(price) and price > 0, "ultimo prezzo valido", f"ultimo prezzo non valido: {price}", iid))

        cal = entry.get("calibration")
        if cal is None:
            checks.append(Check("signals.calibration", "info", True, "storico troppo corto per misurare la calibrazione", iid))
        else:
            low, high = config.CALIBRATION_OK_RANGE
            observed = cal.get("observed")
            numeric = isinstance(observed, (int, float))
            shown = f"{observed:.0%}" if numeric else str(observed)
            checks.append(_check("signals.calibration", "warn", numeric and low <= observed <= high, f"copertura osservata {shown} su {cal.get('n_windows')} finestre (nominale 80%)", f"copertura osservata {shown} fuori da [{low:.0%}, {high:.0%}]: modello poco affidabile", iid))
    return checks


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_manifest(site: Path) -> list[Check]:
    path = Path(site) / "data" / "manifest.json"
    if not path.exists():
        return [Check("manifest.exists", "info", True, "manifest non ancora generato (lo crea il passo publish)")]
    manifest = storage.read_json(path)
    checks = [_check("manifest.schema_version", "error", manifest.get("schema_version") == config.SCHEMA_VERSION, "versione dello schema attesa", f"schema_version inatteso: {manifest.get('schema_version')}")]
    for name, meta in manifest.get("files", {}).items():
        file = Path(site) / "data" / name
        if not file.exists():
            checks.append(Check("manifest.file", "error", False, "file elencato ma assente", name))
            continue
        same = _sha256(file) == meta.get("sha256")
        small = file.stat().st_size <= config.MAX_FILE_BYTES
        checks.append(_check("manifest.file", "error", same and small, "hash coerente, dimensione sotto soglia", "hash diverso dal manifest oppure file troppo grande", name))
    return checks


def check_privacy(site: Path) -> list[Check]:
    findings = []
    for file in sorted((Path(site) / "data").glob("*.json")) if (Path(site) / "data").exists() else []:
        text = file.read_text(encoding="utf-8")
        if _IBAN.search(text):
            findings.append(f"{file.name}: possibile IBAN")
        if _PERSONAL_KEYS.search(text):
            findings.append(f"{file.name}: campi tipici del portafoglio personale")
    return [_check("privacy.scan", "error", not findings, "nessun pattern di dati personali nei dati pubblicati", "; ".join(findings))]
