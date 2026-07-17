#!/usr/bin/env python3
"""Run the pinned FinAuditing FinMR judge with resumable, capped receipts."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


LABELS = {"A", "S", "E", "C"}


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description=__doc__)
    command.add_argument("--notebook", default=".tmp/official-benchmarks/finauditing-repo/StartKit/evaluateFinMR.ipynb")
    command.add_argument("--predictions", default=".tmp/official-benchmarks/proofloop-official-outputs/finauditing/FinMR.predictions.jsonl")
    command.add_argument("--judge-output", default=".tmp/official-benchmarks/finauditing-official/finmr-judge-results.jsonl")
    command.add_argument("--receipt-out", default=".tmp/official-benchmarks/finauditing-official/finmr-judge-receipt.json")
    command.add_argument("--judge-model", default="gpt-5-mini")
    command.add_argument("--limit", type=int)
    command.add_argument("--max-calls", type=int, default=332)
    command.add_argument("--max-provider-cost-usd", type=float, required=True)
    command.add_argument("--input-usd-per-1m", type=float, default=0.25)
    command.add_argument("--output-usd-per-1m", type=float, default=2.0)
    command.add_argument("--allow-provider-spend", action="store_true")
    command.add_argument("--resume", action="store_true")
    return command


def main() -> int:
    args = parser().parse_args()
    if not args.allow_provider_spend:
        raise RuntimeError("Refusing provider calls without --allow-provider-spend.")
    if args.max_provider_cost_usd <= 0:
        raise ValueError("--max-provider-cost-usd must be positive.")
    if args.max_calls <= 0:
        raise ValueError("--max-calls must be positive.")

    load_dotenv(".env.local")
    notebook_path = Path(args.notebook).resolve()
    predictions_path = Path(args.predictions).resolve()
    output_path = Path(args.judge_output).resolve()
    receipt_path = Path(args.receipt_out).resolve()
    if not notebook_path.exists() or not predictions_path.exists():
        raise FileNotFoundError(f"Missing notebook or predictions: {notebook_path}, {predictions_path}")

    upstream = load_upstream_functions(notebook_path)
    items, true_raw, pred_raw = upstream["load_finmr_pairs_from_jsonl"](str(predictions_path))
    if args.limit is not None:
        items, true_raw, pred_raw = items[: args.limit], true_raw[: args.limit], pred_raw[: args.limit]

    existing = load_jsonl_by_id(output_path) if args.resume else {}
    records: dict[str, dict[str, Any]] = dict(existing)
    client = upstream["make_openai_client"]()
    provider_calls = sum(1 for record in records.values() if record.get("provider_call"))
    input_tokens = sum(int(record.get("input_tokens", 0) or 0) for record in records.values())
    output_tokens = sum(int(record.get("output_tokens", 0) or 0) for record in records.values())

    for item, gold_raw, prediction_raw in zip(items, true_raw, pred_raw):
        item_id = str(item.get("id"))
        current = records.get(item_id)
        if current and current.get("judge_label") in LABELS:
            continue
        if provider_calls >= args.max_calls:
            break
        current_cost = estimated_cost(input_tokens, output_tokens, args)
        if current_cost >= args.max_provider_cost_usd:
            break

        gold = upstream["normalize_two_key_obj"](upstream["parse_json_object_best_effort"](gold_raw))
        if gold is None:
            records[item_id] = {
                "id": item.get("id"),
                "judge_label": None,
                "error": "invalid_gold_structure",
                "ground_truth_raw": gold_raw,
                "prediction_raw": prediction_raw,
                "provider_call": False,
            }
            write_jsonl_atomic(output_path, records, items)
            continue

        prompt = upstream["get_prompt"](gold, prediction_raw)
        try:
            raw, usage, response_id = call_upstream_equivalent(client, prompt, args.judge_model)
            label = upstream["normalize_judge_label"](raw)
            provider_calls += 1
            input_tokens += usage["input_tokens"]
            output_tokens += usage["output_tokens"]
            records[item_id] = {
                "id": item.get("id"),
                "judge_label": label,
                "judge_raw": raw,
                "ground_truth": gold,
                "prediction_raw": prediction_raw,
                "provider_call": True,
                "provider": "openai",
                "judge_model": args.judge_model,
                "response_id": response_id,
                **usage,
            }
        except Exception as error:  # Preserve an auditable retry checkpoint.
            records[item_id] = {
                "id": item.get("id"),
                "judge_label": None,
                "error": f"{type(error).__name__}: {error}",
                "ground_truth": gold,
                "prediction_raw": prediction_raw,
                "provider_call": False,
            }
        write_jsonl_atomic(output_path, records, items)
        write_receipt(receipt_path, notebook_path, predictions_path, output_path, items, records, args)

    receipt = write_receipt(receipt_path, notebook_path, predictions_path, output_path, items, records, args)
    print(json.dumps(receipt, indent=2))
    return 0 if receipt["status"] == "accepted" else 1


def load_upstream_functions(path: Path) -> dict[str, Any]:
    notebook = json.loads(path.read_text(encoding="utf-8"))
    namespace: dict[str, Any] = {}
    code_cells = [cell for cell in notebook.get("cells", []) if cell.get("cell_type") == "code"]
    for cell in code_cells[:7]:
        exec("".join(cell.get("source", [])), namespace)
    required = [
        "load_finmr_pairs_from_jsonl",
        "normalize_two_key_obj",
        "parse_json_object_best_effort",
        "get_prompt",
        "normalize_judge_label",
        "make_openai_client",
    ]
    missing = [name for name in required if not callable(namespace.get(name))]
    if missing:
        raise RuntimeError(f"Pinned notebook is missing required functions: {', '.join(missing)}")
    return namespace


def call_upstream_equivalent(client: Any, prompt: str, model: str) -> tuple[str, dict[str, int], str | None]:
    model_lower = model.lower()
    if model_lower.startswith("gpt-4o") or model_lower.startswith("gpt-4.1"):
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a strict evaluator."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=4,
        )
        usage = response.usage
        return (
            response.choices[0].message.content.strip(),
            {
                "input_tokens": int(getattr(usage, "prompt_tokens", 0) or 0),
                "output_tokens": int(getattr(usage, "completion_tokens", 0) or 0),
            },
            getattr(response, "id", None),
        )
    response = client.responses.create(
        model=model,
        input=prompt,
        reasoning={"effort": "minimal"},
        text={"verbosity": "low"},
    )
    usage = response.usage
    return (
        response.output_text.strip(),
        {
            "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        },
        getattr(response, "id", None),
    )


def load_jsonl_by_id(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        records[str(record.get("id"))] = record
    return records


def write_jsonl_atomic(path: Path, records: dict[str, dict[str, Any]], items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for item in items:
            record = records.get(str(item.get("id")))
            if record is not None:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    os.replace(temp, path)


def write_receipt(
    path: Path,
    notebook: Path,
    predictions: Path,
    output: Path,
    items: list[dict[str, Any]],
    records: dict[str, dict[str, Any]],
    args: argparse.Namespace,
) -> dict[str, Any]:
    item_ids = {str(item.get("id")) for item in items}
    relevant_records = [record for item_id, record in records.items() if item_id in item_ids]
    labels = [record.get("judge_label") for record in relevant_records if record.get("judge_label") in LABELS]
    input_tokens = sum(int(record.get("input_tokens", 0) or 0) for record in relevant_records)
    output_tokens = sum(int(record.get("output_tokens", 0) or 0) for record in relevant_records)
    completed = len(labels)
    expected = len(items)
    counts = {label: labels.count(label) for label in sorted(LABELS)}
    cost = estimated_cost(input_tokens, output_tokens, args)
    receipt = {
        "schema": "finauditing-finmr-official-judge-receipt-v1",
        "status": "accepted" if completed == expected and expected > 0 else "partial",
        "accepted": completed == expected and expected > 0,
        "official": True,
        "source": "upstream_official",
        "kind": "finauditing_finmr_judge",
        "provider": "openai",
        "judgeModel": args.judge_model,
        "expectedRows": expected,
        "judgedRows": completed,
        "labelCounts": counts,
        "usage": {
            "inputTokens": input_tokens,
            "outputTokens": output_tokens,
            "estimatedProviderCostUsd": round(cost, 8),
            "maxProviderCostUsd": args.max_provider_cost_usd,
            "inputUsdPer1M": args.input_usd_per_1m,
            "outputUsdPer1M": args.output_usd_per_1m,
        },
        "upstream": {
            "repository": "https://github.com/The-FinAI/FinAuditing",
            "commit": git_commit(notebook.parents[1]),
            "notebook": str(notebook),
            "notebookSha256": sha256(notebook),
            "entrypoint": "StartKit/evaluateFinMR.ipynb:evaluate_finmr_with_judge",
        },
        "predictions": {"path": str(predictions), "sha256": sha256(predictions)},
        "judgeOutput": {"path": str(output), "sha256": sha256(output) if output.exists() else None},
        "errors": [record for record in relevant_records if record.get("judge_label") not in LABELS][:20],
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


if __name__ == "__main__":
    raise SystemExit(main())
