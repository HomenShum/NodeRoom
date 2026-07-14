#!/usr/bin/env python3
"""Run the pinned MBABench official judge across every exported case."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


REQUIRED_FILES = ("scores.json", "ai_judgement.json", "_metadata.json", "token_tracking.json")


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--judge-root", default=".tmp/mbabench-official/judge")
    command.add_argument("--cases-root", default=".tmp/official-benchmarks/proofloop-official-outputs/workstreambench")
    command.add_argument("--receipt-out", default=".tmp/official-benchmarks/workstreambench-official/mbabench-sweep-receipt.json")
    command.add_argument("--model", default="google/gemini-3-flash-preview")
    command.add_argument("--expected-cases", type=int, default=38)
    command.add_argument("--max-provider-cost-usd", type=float, required=True)
    command.add_argument("--max-case-cost-usd", type=float, default=0.25)
    command.add_argument("--allow-provider-spend", action="store_true")
    command.add_argument("--resume", action="store_true")
    command.add_argument("--limit", type=int)
    return command


def main() -> int:
    args = parser().parse_args()
    if not args.allow_provider_spend:
        raise RuntimeError("Refusing provider calls without --allow-provider-spend.")
    if args.max_provider_cost_usd <= 0 or args.max_case_cost_usd <= 0:
        raise ValueError("Provider and per-case cost caps must be positive.")

    load_dotenv(".env.local")
    if not os.environ.get("BIZBENCHJUDGE_KEYS_GEMINI_KEY"):
        key = os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY", "")
        if key:
            os.environ["BIZBENCHJUDGE_KEYS_GEMINI_KEY"] = key
    if not os.environ.get("BIZBENCHJUDGE_KEYS_GEMINI_KEY"):
        raise RuntimeError("Missing BIZBENCHJUDGE_KEYS_GEMINI_KEY or GOOGLE_GENERATIVE_AI_API_KEY.")

    root = Path.cwd()
    judge_root = Path(args.judge_root).resolve()
    cases_root = Path(args.cases_root).resolve()
    receipt_path = Path(args.receipt_out).resolve()
    launcher = root / "scripts" / "mbabench-official-judge.py"
    cases = sorted(
        (item for item in cases_root.iterdir() if item.is_dir() and item.name.startswith("task_")),
        key=task_number,
    )
    if len(cases) != args.expected_cases:
        raise RuntimeError(f"Expected {args.expected_cases} MBABench cases, found {len(cases)} in {cases_root}")
    selected = cases[: args.limit] if args.limit is not None else cases

    for case in selected:
        current = case_receipt(case, args.model)
        if args.resume and current["complete"]:
            continue
        aggregate = build_receipt(receipt_path, judge_root, cases_root, selected, args)
        if aggregate["providerCostUsd"] + args.max_case_cost_usd > args.max_provider_cost_usd:
            break
        command = [
            sys.executable,
            str(launcher),
            "--judge-root",
            str(judge_root),
            "--",
            "-f",
            str(case),
            "--model",
            args.model,
            "--no-use-existing",
            "true",
        ]
        run = subprocess.run(command, cwd=root, env=os.environ.copy(), capture_output=True, text=True, check=False)
        log_root = case / "judge_results"
        log_root.mkdir(parents=True, exist_ok=True)
        (log_root / "noderoom-sweep.stdout.log").write_text(run.stdout, encoding="utf-8")
        (log_root / "noderoom-sweep.stderr.log").write_text(run.stderr, encoding="utf-8")
        if run.returncode != 0:
            (log_root / "noderoom-sweep.failure.json").write_text(json.dumps({
                "exitCode": run.returncode,
                "command": command_without_secrets(command),
                "stderrTail": run.stderr[-4000:],
            }, indent=2) + "\n", encoding="utf-8")
        write_receipt(receipt_path, build_receipt(receipt_path, judge_root, cases_root, selected, args))

    receipt = build_receipt(receipt_path, judge_root, cases_root, selected, args)
    write_receipt(receipt_path, receipt)
    print(json.dumps(receipt, indent=2))
    return 0 if receipt["status"] == "accepted" else 1


def case_receipt(case: Path, expected_model: str) -> dict[str, Any]:
    result_root = case / "judge_results"
    paths = {name: result_root / name for name in REQUIRED_FILES}
    missing = [name for name, path in paths.items() if not path.exists()]
    metadata = read_json(paths["_metadata.json"]) if not missing else {}
    tokens = read_json(paths["token_tracking.json"]) if not missing else {}
    scores = read_json(paths["scores.json"]) if not missing else {}
    model = str(metadata.get("grader_model") or tokens.get("model") or "")
    complete = not missing and model == expected_model
    return {
        "case": case.name,
        "complete": complete,
        "model": model or None,
        "missingFiles": missing,
        "score": metadata.get("total_score", scores.get("total_score")),
        "promptTokens": int(tokens.get("total_prompt_tokens", 0) or 0),
        "completionTokens": int(tokens.get("total_completion_tokens", 0) or 0),
        "totalTokens": int(tokens.get("total_tokens", 0) or 0),
        "costUsd": float(tokens.get("total_cost", 0) or 0),
        "evidence": [str(path) for path in paths.values() if path.exists()],
    }


def build_receipt(
    receipt_path: Path,
    judge_root: Path,
    cases_root: Path,
    cases: list[Path],
    args: argparse.Namespace,
) -> dict[str, Any]:
    case_receipts = [case_receipt(case, args.model) for case in cases]
    complete = [case for case in case_receipts if case["complete"]]
    total_cost = round(sum(case["costUsd"] for case in complete), 8)
    scores = [float(case["score"]) for case in complete if isinstance(case["score"], (int, float))]
    accepted = len(complete) == len(cases) == args.expected_cases and total_cost <= args.max_provider_cost_usd
    return {
        "schema": "mbabench-official-sweep-receipt-v1",
        "status": "accepted" if accepted else "partial",
        "accepted": accepted,
        "official": True,
        "source": "upstream_official",
        "kind": "workstreambench_mbabench_judge",
        "provider": "google",
        "judgeModel": args.model,
        "expectedCases": args.expected_cases,
        "selectedCases": len(cases),
        "completedCases": len(complete),
        "providerCostUsd": total_cost,
        "maxProviderCostUsd": args.max_provider_cost_usd,
        "maxCaseCostUsd": args.max_case_cost_usd,
        "promptTokens": sum(case["promptTokens"] for case in complete),
        "completionTokens": sum(case["completionTokens"] for case in complete),
        "totalTokens": sum(case["totalTokens"] for case in complete),
        "meanScore": round(sum(scores) / len(scores), 8) if scores else None,
        "upstream": {
            "repository": "https://github.com/namkoong-lab/MBABench",
            "commit": git_commit(judge_root.parent),
            "judgeRoot": str(judge_root),
            "entrypoint": "judge/main_scripts/judge.py",
            "judgeVersion": 5,
            "promptVersion": "7.0",
            "rubricVersion": "8",
        },
        "casesRoot": str(cases_root),
        "receiptPath": str(receipt_path),
        "cases": case_receipts,
    }


def write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)


def task_number(path: Path) -> tuple[int, str]:
    try:
        return int(path.name.split("_", 1)[1]), path.name
    except (IndexError, ValueError):
        return 10**9, path.name


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def git_commit(root: Path) -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=False)
    return result.stdout.strip() or None


def command_without_secrets(command: list[str]) -> list[str]:
    return list(command)


if __name__ == "__main__":
    raise SystemExit(main())
