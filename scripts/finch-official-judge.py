#!/usr/bin/env python3
"""Run the pinned Finch canonical judge with resumable, capped receipts."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import subprocess
import time
from pathlib import Path
from typing import Any


EXPECTED_TASKS = 172
UPSTREAM_COMMIT = "95a8b8d135a528b325be003e54c55f886a22602d"
CANONICAL_JUDGE_MODEL = "gpt-5-mini"
CANONICAL_JUDGE_VERSION = "2025-08-07"
CANONICAL_CONTRACT = "finch-gpt5mini-canonical-v1"
RESULT_COLUMNS = [
    "task_id",
    "score",
    "completeness",
    "correctness",
    "over_edit_avoidance",
    "readability",
    "detailed_analysis",
    "timestamp",
    "model",
    "api_call_duration",
    "error",
    "source_jsonl",
    "line_num",
    "content_record_sha256",
]


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--repo-root", default=".tmp/official-benchmarks/finch-repo")
    command.add_argument(
        "--content-parts",
        default=".tmp/official-benchmarks/proofloop-official-outputs/finch/eval_set/"
        "noderoom-source-workbook-baseline/content_parts.jsonl",
    )
    command.add_argument(
        "--judge-output",
        default=".tmp/official-benchmarks/finch-official/finch-judge-results.jsonl",
    )
    command.add_argument(
        "--results-xlsx",
        default=".tmp/official-benchmarks/finch-official/results.xlsx",
    )
    command.add_argument(
        "--receipt-out",
        default=".tmp/official-benchmarks/finch-official/finch-judge-receipt.json",
    )
    command.add_argument("--provider", choices=["openai", "azure_openai", "openrouter"], default="openai")
    command.add_argument("--judge-model")
    command.add_argument("--deployment", help="Deprecated alias for --judge-model; retained for Azure compatibility.")
    command.add_argument("--azure-endpoint")
    command.add_argument("--api-version")
    command.add_argument("--api-key-env")
    command.add_argument("--limit", type=int)
    command.add_argument("--max-calls", type=int, default=EXPECTED_TASKS)
    command.add_argument("--max-provider-cost-usd", type=float, required=True)
    command.add_argument("--max-call-reserve-usd", type=float, default=0.5)
    command.add_argument("--input-usd-per-1m", type=float, default=0.25)
    command.add_argument("--output-usd-per-1m", type=float, default=2.0)
    command.add_argument("--max-retries", type=int, default=3)
    command.add_argument("--rate-limit-delay", type=float, default=1.0)
    command.add_argument("--shadow-max-completion-tokens", type=int, default=8192)
    command.add_argument("--allow-provider-spend", action="store_true")
    command.add_argument("--resume", action="store_true")
    return command


def main() -> int:
    args = parser().parse_args()
    if not args.allow_provider_spend:
        raise RuntimeError("Refusing provider calls without --allow-provider-spend.")
    if args.max_provider_cost_usd <= 0 or args.max_call_reserve_usd <= 0:
        raise ValueError("Provider and per-call cost caps must be positive.")
    if args.max_calls <= 0 or args.max_retries <= 0 or args.shadow_max_completion_tokens <= 0:
        raise ValueError("Call, retry, and shadow completion limits must be positive.")

    require_results_workbook_dependencies()
    from dotenv import load_dotenv

    load_dotenv(".env.local")
    judge_model = (
        args.judge_model
        or args.deployment
        or (
            os.environ.get("AZURE_OPENAI_DEPLOYMENT", "")
            if args.provider == "azure_openai"
            else (
                os.environ.get("FINCH_SHADOW_JUDGE_MODEL", "openrouter/free")
                if args.provider == "openrouter"
                else os.environ.get("FINCH_JUDGE_MODEL", CANONICAL_JUDGE_MODEL)
            )
        )
    )
    endpoint = args.azure_endpoint or os.environ.get("AZURE_OPENAI_ENDPOINT", "")
    api_version = args.api_version or os.environ.get("AZURE_OPENAI_API_VERSION", "")
    api_key_env = args.api_key_env or {
        "azure_openai": "AZURE_OPENAI_API_KEY",
        "openai": "OPENAI_API_KEY",
        "openrouter": "OPENROUTER_API_KEY",
    }[args.provider]
    api_key = os.environ.get(api_key_env, "")
    required = [("judge model", judge_model), (api_key_env, api_key)]
    if args.provider == "azure_openai":
        required.extend([("azure endpoint", endpoint), ("API version", api_version)])
    missing = [name for name, value in required if not value]
    if missing:
        raise RuntimeError(f"Missing Finch canonical judge configuration: {', '.join(missing)}")
    if args.provider == "openai" and not canonical_model_name(judge_model):
        raise RuntimeError(
            "The direct OpenAI official-equivalent path is restricted to the canonical Finch "
            f"judge {CANONICAL_JUDGE_MODEL}; use a shadow runner for frontier or free-router judges."
        )

    repo_root = Path(args.repo_root).resolve()
    content_path = Path(args.content_parts).resolve()
    output_path = Path(args.judge_output).resolve()
    workbook_path = Path(args.results_xlsx).resolve()
    receipt_path = Path(args.receipt_out).resolve()
    judge_path = repo_root / "src" / "call_gpt_judge.py"
    if not judge_path.exists() or not content_path.exists():
        raise FileNotFoundError(f"Missing pinned judge or content_parts input: {judge_path}, {content_path}")
    commit = git_commit(repo_root)
    if commit != UPSTREAM_COMMIT:
        raise RuntimeError(f"Unexpected Finch commit: {commit}; expected {UPSTREAM_COMMIT}")

    upstream = load_upstream(judge_path)
    config = upstream.APIConfig()
    config.API_KEY = api_key
    config.AZURE_ENDPOINT = endpoint
    config.API_VERSION = api_version
    config.MODEL = judge_model
    config.MAX_RETRIES = args.max_retries
    config.RATE_LIMIT_DELAY = args.rate_limit_delay
    if args.provider == "openrouter":
        config.MAX_COMPLETION_TOKENS = args.shadow_max_completion_tokens
    caller = make_caller(upstream, config, args.provider, api_key)

    items = load_content_parts(content_path)
    if len(items) != EXPECTED_TASKS:
        raise RuntimeError(f"Expected {EXPECTED_TASKS} Finch content_parts rows, found {len(items)}")
    selected = items[: args.limit] if args.limit is not None else items
    records = load_jsonl_by_id(output_path) if args.resume else {}

    for line_num, item in enumerate(selected, 1):
        task_id = str(item.get("task_id") or f"task_{line_num}")
        item_sha256 = content_record_sha256(item)
        current = records.get(task_id)
        if complete_record(current, args.provider, judge_model, item_sha256):
            continue
        relevant = selected_records(selected, records, args.provider, judge_model)
        accounting = provider_accounting(relevant, args)
        attempt_budget = available_attempt_budget(accounting, args)
        if attempt_budget <= 0:
            break

        content_parts = caller._upgrade_prompt(item.get("content_parts", []))
        started = time.time()
        response = None
        parsed: dict[str, Any] = {}
        raw_response = None
        error_message = None
        new_attempts = 0
        try:
            response, new_attempts = call_with_retries(caller, content_parts, attempt_budget)
            raw_response = response.choices[0].message.content or ""
            parsed = caller._parse_response(raw_response)
        except ProviderCallFailure as error:
            new_attempts = error.attempts
            error_message = f"{type(error.original).__name__}: {error.original}"
        except Exception as error:
            error_message = f"{type(error).__name__}: {error}"

        usage = getattr(response, "usage", None)
        new_input_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        new_output_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
        priced_responses = 1 if response is not None and new_input_tokens + new_output_tokens > 0 else 0
        previous = current if record_matches_contract(current, args.provider, judge_model, item_sha256) else {}
        previous_errors = previous.get("error_history") if isinstance(previous.get("error_history"), list) else []
        if not previous_errors and previous.get("error"):
            previous_errors = [previous["error"]]
        total_attempts = record_provider_attempts(previous) + new_attempts
        total_unpriced_attempts = (
            record_unpriced_call_attempts(previous) + max(0, new_attempts - priced_responses)
        )
        records[task_id] = {
            "task_id": task_id,
            "score": parsed.get("score") if error_message is None else None,
            "completeness": parsed.get("completeness"),
            "correctness": parsed.get("correctness"),
            "over_edit_avoidance": parsed.get("over_edit_avoidance"),
            "readability": parsed.get("readability"),
            "detailed_analysis": parsed.get("detailed_analysis"),
            "timestamp": utc_timestamp(),
            "judge_model": judge_model,
            "resolved_judge_model": getattr(response, "model", None),
            "judge_provider": args.provider,
            "judge_contract": CANONICAL_CONTRACT,
            "api_call_duration": time.time() - started,
            "error": error_message if error_message is not None else parsed.get("error"),
            "error_history": [*previous_errors, *([error_message] if error_message else [])],
            "source_jsonl": str(content_path),
            "line_num": line_num,
            "content_record_sha256": item_sha256,
            "provider_call": total_attempts > 0,
            "provider_call_attempts": total_attempts,
            "provider_response_received": response is not None,
            "priced_response_count": int(previous.get("priced_response_count", 0) or 0) + priced_responses,
            "unpriced_call_attempts": total_unpriced_attempts,
            "provider": args.provider,
            "response_id": getattr(response, "id", None),
            "raw_response": raw_response,
            "input_tokens": int(previous.get("input_tokens", 0) or 0) + new_input_tokens,
            "output_tokens": int(previous.get("output_tokens", 0) or 0) + new_output_tokens,
        }
        write_jsonl_atomic(output_path, records, selected)
        write_results_xlsx(workbook_path, records, selected)
        write_receipt(
            receipt_path,
            repo_root,
            content_path,
            output_path,
            workbook_path,
            selected,
            records,
            args.provider,
            judge_model,
            endpoint,
            api_version,
            args,
        )
        time.sleep(args.rate_limit_delay)

    write_jsonl_atomic(output_path, records, selected)
    write_results_xlsx(workbook_path, records, selected)
    receipt = write_receipt(
        receipt_path,
        repo_root,
        content_path,
        output_path,
        workbook_path,
        selected,
        records,
        args.provider,
        judge_model,
        endpoint,
        api_version,
        args,
    )
    print(json.dumps(receipt, indent=2))
    return 0 if receipt["status"] in {"accepted", "complete"} else 1


def load_upstream(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("finch_call_gpt_judge", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load upstream Finch judge: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_caller(upstream: Any, config: Any, provider: str, api_key: str) -> Any:
    from openai import OpenAI

    if provider == "azure_openai":
        return upstream.GPTJudgeCaller(config)

    # Preserve the pinned prompt upgrade, request payload, retry policy, and parser.
    # Only the SDK transport changes from AzureOpenAI to the canonical OpenAI endpoint.
    caller = upstream.GPTJudgeCaller.__new__(upstream.GPTJudgeCaller)
    caller.config = config
    if provider == "openrouter":
        caller.client = OpenAI(
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            timeout=config.TIMEOUT,
            default_headers={
                "HTTP-Referer": "https://github.com/HomenShum/NodeRoom",
                "X-Title": "NodeRoom Finch shadow judge",
            },
        )
    else:
        caller.client = OpenAI(api_key=api_key, timeout=config.TIMEOUT)
    return caller


class ProviderCallFailure(RuntimeError):
    def __init__(self, original: Exception, attempts: int):
        super().__init__(str(original))
        self.original = original
        self.attempts = attempts


def call_with_retries(caller: Any, content_parts: list[dict[str, Any]], retries: int) -> tuple[Any, int]:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            response = caller.client.chat.completions.create(
                model=caller.config.MODEL,
                messages=[{"role": "user", "content": content_parts}],
                max_completion_tokens=caller.config.MAX_COMPLETION_TOKENS,
                temperature=caller.config.TEMPERATURE,
            )
            return response, attempt + 1
        except Exception as error:  # Retry the same way as the pinned upstream caller.
            last_error = error
            if attempt + 1 < retries:
                time.sleep(caller.config.RETRY_DELAY)
    assert last_error is not None
    raise ProviderCallFailure(last_error, retries) from last_error


def load_content_parts(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for line_num, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        task_id = str(row.get("task_id") or f"task_{line_num}")
        if task_id in seen:
            raise RuntimeError(f"Duplicate Finch task id: {task_id}")
        seen.add(task_id)
        rows.append(row)
    return rows


def load_jsonl_by_id(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        records[str(record.get("task_id"))] = record
    return records


def content_record_sha256(item: dict[str, Any]) -> str:
    canonical = json.dumps(item, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def canonical_model_name(model: str) -> bool:
    normalized = model.strip().lower()
    return normalized == CANONICAL_JUDGE_MODEL or normalized == (
        f"{CANONICAL_JUDGE_MODEL}-{CANONICAL_JUDGE_VERSION}"
    )


def record_matches_contract(
    record: dict[str, Any] | None,
    provider: str,
    judge_model: str,
    expected_content_sha256: str,
) -> bool:
    return bool(
        record
        and record.get("judge_provider", record.get("provider")) == provider
        and record.get("judge_model") == judge_model
        and record.get("judge_contract", CANONICAL_CONTRACT) == CANONICAL_CONTRACT
        and record.get("content_record_sha256") == expected_content_sha256
    )


def complete_record(
    record: dict[str, Any] | None,
    provider: str,
    judge_model: str,
    expected_content_sha256: str,
) -> bool:
    if not record_matches_contract(record, provider, judge_model, expected_content_sha256) or record.get("provider_call") is not True:
        return False
    if provider == "openai" and not canonical_model_name(str(record.get("resolved_judge_model") or "")):
        return False
    if record.get("error"):
        return False
    score = record.get("score")
    return isinstance(score, (int, float)) and not isinstance(score, bool)


def complete_selected_record(record: dict[str, Any], provider: str, judge_model: str) -> bool:
    expected = record.get("content_record_sha256")
    return bool(
        isinstance(expected, str)
        and expected
        and complete_record(record, provider, judge_model, expected)
    )


def selected_records(
    items: list[dict[str, Any]],
    records: dict[str, dict[str, Any]],
    provider: str,
    judge_model: str,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for index, item in enumerate(items, 1):
        task_id = str(item.get("task_id") or f"task_{index}")
        record = records.get(task_id)
        if record_matches_contract(record, provider, judge_model, content_record_sha256(item)):
            selected.append(record)
    return selected


def record_provider_attempts(record: dict[str, Any]) -> int:
    if "provider_call_attempts" in record:
        return max(0, int(record.get("provider_call_attempts", 0) or 0))
    return 1 if record.get("provider_call") is True else 0


def record_unpriced_call_attempts(record: dict[str, Any]) -> int:
    if "unpriced_call_attempts" in record:
        return max(0, int(record.get("unpriced_call_attempts", 0) or 0))
    attempts = record_provider_attempts(record)
    has_priced_response = int(record.get("input_tokens", 0) or 0) + int(record.get("output_tokens", 0) or 0) > 0
    return max(0, attempts - (1 if has_priced_response else 0))


def provider_accounting(records: list[dict[str, Any]], args: argparse.Namespace) -> dict[str, float | int]:
    input_tokens = sum(int(record.get("input_tokens", 0) or 0) for record in records)
    output_tokens = sum(int(record.get("output_tokens", 0) or 0) for record in records)
    attempts = sum(record_provider_attempts(record) for record in records)
    unpriced_attempts = sum(record_unpriced_call_attempts(record) for record in records)
    token_cost = estimated_cost(input_tokens, output_tokens, args)
    reserved_cost = unpriced_attempts * args.max_call_reserve_usd
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "provider_call_attempts": attempts,
        "unpriced_call_attempts": unpriced_attempts,
        "estimated_provider_cost_usd": token_cost,
        "reserved_unpriced_cost_usd": reserved_cost,
        "accounted_provider_cost_usd": token_cost + reserved_cost,
    }


def available_attempt_budget(accounting: dict[str, float | int], args: argparse.Namespace) -> int:
    remaining_calls = args.max_calls - int(accounting["provider_call_attempts"])
    remaining_cost = args.max_provider_cost_usd - float(accounting["accounted_provider_cost_usd"])
    affordable_calls = math.floor(max(0.0, remaining_cost) / args.max_call_reserve_usd + 1e-12)
    return max(0, min(args.max_retries, remaining_calls, affordable_calls))


def write_jsonl_atomic(
    path: Path,
    records: dict[str, dict[str, Any]],
    items: list[dict[str, Any]],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for index, item in enumerate(items, 1):
            task_id = str(item.get("task_id") or f"task_{index}")
            record = records.get(task_id)
            if record is not None:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    os.replace(temp, path)


def write_results_xlsx(
    path: Path,
    records: dict[str, dict[str, Any]],
    items: list[dict[str, Any]],
) -> None:
    pd = require_results_workbook_dependencies()

    rows: list[dict[str, Any]] = []
    for index, item in enumerate(items, 1):
        task_id = str(item.get("task_id") or f"task_{index}")
        record = records.get(task_id)
        if record is None:
            continue
        rows.append({
            "task_id": task_id,
            "score": record.get("score"),
            "completeness": record.get("completeness"),
            "correctness": record.get("correctness"),
            "over_edit_avoidance": record.get("over_edit_avoidance"),
            "readability": record.get("readability"),
            "detailed_analysis": record.get("detailed_analysis"),
            "timestamp": record.get("timestamp"),
            "model": record.get("judge_model"),
            "api_call_duration": record.get("api_call_duration"),
            "error": record.get("error"),
            "source_jsonl": record.get("source_jsonl"),
            "line_num": record.get("line_num"),
            "content_record_sha256": record.get("content_record_sha256"),
        })
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.stem}.tmp{path.suffix}")
    pd.DataFrame(rows, columns=RESULT_COLUMNS).to_excel(temp, index=False, sheet_name="Results")
    os.replace(temp, path)


def require_results_workbook_dependencies() -> Any:
    try:
        import openpyxl  # noqa: F401
        import pandas as pd
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Finch official judge requires pandas and openpyxl to write results.xlsx."
        ) from error
    return pd


def write_receipt(
    path: Path,
    repo_root: Path,
    content_path: Path,
    output_path: Path,
    workbook_path: Path,
    items: list[dict[str, Any]],
    records: dict[str, dict[str, Any]],
    provider: str,
    judge_model: str,
    endpoint: str,
    api_version: str,
    args: argparse.Namespace,
) -> dict[str, Any]:
    relevant = selected_records(items, records, provider, judge_model)
    completed = [record for record in relevant if complete_selected_record(record, provider, judge_model)]
    scores = [float(record["score"]) for record in completed]
    parse_error_count = sum(1 for record in completed if record.get("error"))
    accounting = provider_accounting(relevant, args)
    cost = float(accounting["estimated_provider_cost_usd"])
    accounted_cost = float(accounting["accounted_provider_cost_usd"])
    accepted = (
        len(items) == EXPECTED_TASKS
        and len(completed) == EXPECTED_TASKS
        and parse_error_count == 0
        and accounting["provider_call_attempts"] <= args.max_calls
        and accounted_cost <= args.max_provider_cost_usd
    )
    direct_equivalent = provider == "openai"
    shadow = provider == "openrouter"
    resolved_models = sorted({
        str(record.get("resolved_judge_model"))
        for record in completed
        if record.get("resolved_judge_model")
    })
    prompt_path = repo_root / "src" / "build_prompt" / "content_builder" / "prompts.py"
    receipt = {
        "schema": (
            "finch-shadow-judge-receipt-v1"
            if shadow
            else ("finch-canonical-judge-receipt-v1" if direct_equivalent else "finch-official-judge-receipt-v1")
        ),
        "status": ("complete" if accepted else "partial") if shadow else ("accepted" if accepted else "partial"),
        "accepted": accepted,
        "official": not shadow,
        "source": "shadow_free_router" if shadow else ("upstream_equivalent" if direct_equivalent else "upstream_official"),
        "kind": "finch_free_router_shadow" if shadow else ("finch_canonical_judge" if direct_equivalent else "finch_azure_judge"),
        "provider": provider,
        "judgeModel": judge_model,
        "resolvedJudgeModels": resolved_models,
        "expectedTasks": EXPECTED_TASKS,
        "selectedTasks": len(items),
        "completedTasks": len(completed),
        "contentPartsCount": EXPECTED_TASKS,
        "providerCalls": accounting["provider_call_attempts"],
        "providerTaskCalls": sum(1 for record in relevant if record.get("provider_call") is True),
        "meanScore": round(sum(scores) / len(scores), 8) if scores else None,
        "parseErrorCount": parse_error_count,
        "providerCostUsd": round(cost, 8),
        "usage": {
            "inputTokens": accounting["input_tokens"],
            "outputTokens": accounting["output_tokens"],
            "estimatedProviderCostUsd": round(cost, 8),
            "unpricedCallAttempts": accounting["unpriced_call_attempts"],
            "reservedUnpricedCostUsd": round(float(accounting["reserved_unpriced_cost_usd"]), 8),
            "accountedProviderCostUsd": round(accounted_cost, 8),
            "maxProviderCostUsd": args.max_provider_cost_usd,
            "maxCallReserveUsd": args.max_call_reserve_usd,
            "inputUsdPer1M": args.input_usd_per_1m,
            "outputUsdPer1M": args.output_usd_per_1m,
        },
        "azure": {
            "apiVersion": api_version,
            "endpointSha256": hashlib.sha256(endpoint.encode("utf-8")).hexdigest(),
        } if provider == "azure_openai" else None,
        "equivalenceContract": {
            "schema": "finch-judge-transport-equivalence-v1",
            "status": "accepted" if accepted else "partial",
            "accepted": accepted,
            "contractId": CANONICAL_CONTRACT,
            "canonicalModel": CANONICAL_JUDGE_MODEL,
            "canonicalModelVersion": CANONICAL_JUDGE_VERSION,
            "requestedModel": judge_model,
            "resolvedModels": resolved_models,
            "transportOnly": True,
            "releasedTransport": "openai.AzureOpenAI",
            "equivalentTransport": "openai.OpenAI",
            "requestPath": "chat.completions.create",
            "requestFields": ["model", "messages", "max_completion_tokens", "temperature"],
            "promptUpgradeMethod": "GPTJudgeCaller._upgrade_prompt",
            "parserMethod": "GPTJudgeCaller._parse_response",
            "promptSourceSha256": sha256(prompt_path) if prompt_path.exists() else None,
            "paper": "https://aclanthology.org/2026.findings-acl.523/",
        } if direct_equivalent else None,
        "shadowContract": {
            "schema": "finch-free-router-shadow-v1",
            "officialScoreClaim": False,
            "promotionAllowed": False,
            "router": "openrouter/free",
            "resolvedModels": resolved_models,
            "purpose": "Disagreement analysis only; never a substitute for the canonical GPT-5-mini score.",
            "maxCompletionTokens": args.shadow_max_completion_tokens,
        } if shadow else None,
        "upstream": {
            "repository": "https://github.com/FinWorkBench/Finch",
            "commit": git_commit(repo_root),
            "entrypoint": "src/call_gpt_judge.py",
            "entrypointSha256": sha256(repo_root / "src" / "call_gpt_judge.py"),
        },
        "contentParts": {"path": str(content_path), "sha256": sha256(content_path)},
        "judgeOutput": {
            "path": str(output_path),
            "sha256": sha256(output_path) if output_path.exists() else None,
        },
        "resultsWorkbook": {
            "path": str(workbook_path),
            "sha256": sha256(workbook_path) if workbook_path.exists() else None,
        },
        "errors": [
            record for record in relevant if not complete_selected_record(record, provider, judge_model)
        ][:20],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)
    return receipt


def estimated_cost(input_tokens: int, output_tokens: int, args: argparse.Namespace) -> float:
    return input_tokens * args.input_usd_per_1m / 1_000_000 + output_tokens * args.output_usd_per_1m / 1_000_000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit(root: Path) -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, capture_output=True, text=True, check=False)
    return result.stdout.strip() or None


def utc_timestamp() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
