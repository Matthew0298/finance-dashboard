"""Command line: `python -m fd_pipeline <ingest|audit|forecast|publish|run>`."""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from . import config
from .audit import run_audit
from .forecast import run_forecast
from .ingest import run_ingest
from .providers import get_provider
from .publish import run_publish


def _audit(stage: str, args, today: date) -> int:
    result = run_audit(
        stage,
        store=args.store,
        site=args.out,
        universe=config.load_universe(),
        rules=config.load_rules(),
        today=today,
    )
    counts = result["counts"]
    print(f"audit[{stage}] {result['status'].upper()}: {counts['checks']} controlli, "
          f"{counts['failed_errors']} errori, {counts['failed_warnings']} avvisi")
    for check in result["checks"]:
        if not check["ok"] and check["severity"] in ("error", "warn"):
            subject = f" [{check['subject']}]" if check["subject"] else ""
            print(f"  - {check['severity']}: {check['id']}{subject}: {check['detail']}")
    return 1 if result["status"] == "fail" else 0


def _ingest(args, today: date) -> int:
    log = run_ingest(get_provider(args.provider), config.load_universe(), args.store, today)
    failed = [k for k, v in log["instruments"].items() if not v["ok"]]
    print(f"ingest[{args.provider}]: {len(log['instruments']) - len(failed)} strumenti ok, {len(failed)} falliti; "
          f"cambi: {'ok' if log['fx'].get('ok') else 'falliti'}")
    for key in failed:
        print(f"  - {key}: {log['instruments'][key]['error']}")
    return 0  # failures are judged by the auditor, which sees stale or missing data


def _forecast(args, today: date) -> int:
    payload = run_forecast(config.load_universe(), args.store, args.out, today)
    ok = sum(1 for v in payload["instruments"].values() if v["status"] == "ok")
    print(f"forecast: scenari per {ok} strumenti su {len(payload['instruments'])}")
    return 0


def _publish(args, today: date) -> int:
    manifest = run_publish(args.store, args.out)
    print(f"publish: manifest con {len(manifest['files'])} file")
    return _audit("output", args, today)  # re-check now that the manifest exists


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(prog="fd_pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser, provider: bool = False, stage: bool = False) -> None:
        p.add_argument("--store", type=Path, default=Path("store"), help="folder with price history")
        p.add_argument("--out", type=Path, default=Path("build/site"), help="site folder (data goes in <out>/data)")
        p.add_argument("--today", type=date.fromisoformat, default=None, help="override today (YYYY-MM-DD)")
        if provider:
            p.add_argument("--provider", choices=("yahoo", "synthetic"), default="yahoo")
        if stage:
            p.add_argument("--stage", choices=("raw", "output"), required=True)

    add_common(sub.add_parser("ingest", help="refresh prices and FX"), provider=True)
    add_common(sub.add_parser("audit", help="run one audit stage"), stage=True)
    add_common(sub.add_parser("forecast", help="signals, scenario cones, calibration"))
    add_common(sub.add_parser("publish", help="manifest + final audit"))
    add_common(sub.add_parser("run", help="everything, stopping at the first failed audit"), provider=True)

    args = parser.parse_args(argv)
    today = args.today or date.today()

    if args.command == "ingest":
        return _ingest(args, today)
    if args.command == "audit":
        return _audit(args.stage, args, today)
    if args.command == "forecast":
        return _forecast(args, today)
    if args.command == "publish":
        return _publish(args, today)

    # A full run starts from a clean report: stage results of a previous run must not leak into this one.
    (Path(args.out) / "data" / "audit.json").unlink(missing_ok=True)
    for step in (
        lambda: _ingest(args, today),
        lambda: _audit("raw", args, today),
        lambda: _forecast(args, today),
        lambda: _audit("output", args, today),
        lambda: _publish(args, today),
    ):
        code = step()
        if code:
            print("pipeline interrotta: l'audit ha bloccato la pubblicazione", file=sys.stderr)
            return code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
