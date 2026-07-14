#!/usr/bin/env python3
"""Resume and merge Finch content_parts JSONL without hiding partial failures."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


def load_records(path: Path) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return records
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            print(f"warning: {path}:{line_number}: {error}", file=sys.stderr)
            continue
        task_id = str(record.get("task_id", "")).strip()
        if task_id:
            records[task_id] = record
    return records


def valid_record(record: dict[str, Any] | None) -> bool:
    return bool(record and isinstance(record.get("content_parts"), list) and record["content_parts"])


def record_quality(record: dict[str, Any]) -> tuple[int, int, int, int]:
    parts = record.get("content_parts") if isinstance(record.get("content_parts"), list) else []
    images = sum(1 for part in parts if isinstance(part, dict) and part.get("type") == "image_url")
    text_chars = sum(
        len(str(part.get("text", "")))
        for part in parts
        if isinstance(part, dict) and part.get("type") == "text"
    )
    return (int(valid_record(record)), int(not record.get("error")), images, text_chars)


def write_records(path: Path, records: dict[str, dict[str, Any]], task_ids: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        for task_id in task_ids:
            record = records.get(task_id)
            if record is not None:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    os.replace(temp_path, path)


def task_directories(model_dir: Path) -> list[Path]:
    return sorted((item for item in model_dir.iterdir() if item.is_dir()), key=lambda item: item.name)


def merge(args: argparse.Namespace) -> int:
    model_dir = Path(args.model_dir).resolve()
    tasks = task_directories(model_dir)
    task_ids = [item.name for item in tasks]
    expected = set(task_ids)
    output = model_dir / args.output_name
    inputs = sorted(model_dir.glob(args.pattern))
    records: dict[str, dict[str, Any]] = {}
    sources: dict[str, str] = {}

    for path in inputs:
        if path.name.endswith(".tmp"):
            continue
        for task_id, record in load_records(path).items():
            if task_id not in expected or not valid_record(record):
                continue
            current = records.get(task_id)
            if current is None or record_quality(record) > record_quality(current):
                records[task_id] = record
                sources[task_id] = path.name

    write_records(output, records, task_ids)
    missing = [task_id for task_id in task_ids if task_id not in records]
    summary = {
        "schema": "finch-content-parts-recovery-v1",
        "action": "merge",
        "modelDir": str(model_dir),
        "output": str(output),
        "inputFiles": [path.name for path in inputs],
        "expectedTasks": len(task_ids),
        "validRecords": len(records),
        "missingTasks": missing,
        "recordsBySource": {
            source: sum(1 for value in sources.values() if value == source)
            for source in sorted(set(sources.values()))
        },
    }
    print(json.dumps(summary, indent=2))
    return 0 if not missing else 1


def build(args: argparse.Namespace) -> int:
    eval_root = Path(args.eval_root).resolve()
    repo_root = Path(args.repo_root).resolve()
    model_dir = eval_root / args.model_name
    tasks = task_directories(model_dir)
    start = max(0, args.start)
    end = min(len(tasks), args.end if args.end is not None else len(tasks))
    selected = tasks[start:end]
    selected_ids = [item.name for item in selected]
    official_path = model_dir / "content_parts.jsonl"
    output_path = model_dir / args.output_name

    records = load_records(official_path)
    for task_id, record in load_records(output_path).items():
        current = records.get(task_id)
        if current is None or record_quality(record) > record_quality(current):
            records[task_id] = record

    sys.path.insert(0, str(repo_root))
    from src.build_prompt.content_builder.content_builder import ContentBuilder
    from src.build_prompt.content_builder.excel_content_builder import ExcelContentBuilder

    if args.no_screenshots:
        ExcelContentBuilder._get_all_screenshots = lambda self, excel_file: []
        ExcelContentBuilder._get_selected_screenshots = lambda self, excel_file, sheet_names: []
        print("Finch recovery: upstream snapshots/diffs enabled; screenshot generation disabled", flush=True)

    builder = ContentBuilder(str(eval_root), models=[args.model_name])
    built = 0
    skipped = 0
    failures = 0
    print(
        f"Finch recovery: output={args.output_name} range={start}:{end} existing={len(records)}",
        flush=True,
    )
    for index, task_dir in enumerate(selected, start=1):
        task_id = task_dir.name
        if valid_record(records.get(task_id)):
            skipped += 1
            print(f"[{index}/{len(selected)}] skip {task_id}", flush=True)
            continue
        try:
            content_parts = builder.build_task(task_dir)
            if not content_parts:
                raise RuntimeError("upstream builder returned empty content_parts")
            records[task_id] = {"task_id": task_id, "content_parts": content_parts}
            built += 1
            print(f"[{index}/{len(selected)}] built {task_id} parts={len(content_parts)}", flush=True)
        except Exception as error:  # Preserve the task-level failure in the shard receipt.
            records[task_id] = {
                "task_id": task_id,
                "content_parts": [],
                "error": f"{type(error).__name__}: {error}",
            }
            failures += 1
            print(f"[{index}/{len(selected)}] failed {task_id}: {type(error).__name__}: {error}", flush=True)
        write_records(output_path, records, selected_ids)

    summary = {
        "schema": "finch-content-parts-recovery-v1",
        "action": "build",
        "output": str(output_path),
        "range": [start, end],
        "selectedTasks": len(selected),
        "built": built,
        "skipped": skipped,
        "failures": failures,
        "noScreenshots": args.no_screenshots,
    }
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if failures == 0 else 1


def is_excel_suffix(value: str) -> bool:
    return value.lower() in {".xls", ".xlsx", ".xlsm"}


def is_zip_file(path: Path) -> bool:
    try:
        return path.read_bytes()[:4] == b"PK\x03\x04"
    except OSError:
        return False


def write_blank_workbook(path: Path, task_id: str, instruction: str) -> None:
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Baseline"
    sheet.append(["Field", "Value"])
    sheet.append(["task_id", task_id])
    sheet.append(["baseline_policy", "Blank workbook emitted because the source artifact is not Excel."])
    sheet.append(["instruction_prefix", instruction[:500]])
    workbook.save(path)


def repair_output_types(args: argparse.Namespace) -> int:
    model_dir = Path(args.model_dir).resolve()
    repaired: list[dict[str, str]] = []
    for task_dir in task_directories(model_dir):
        metadata_path = task_dir / "metadata.json"
        if not metadata_path.exists():
            continue
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        source_names = metadata.get("source_files") if isinstance(metadata.get("source_files"), list) else []
        reference = metadata.get("reference_outputs") if isinstance(metadata.get("reference_outputs"), dict) else {}
        reference_names = reference.get("files") if isinstance(reference.get("files"), list) else []
        output = metadata.get("outputs") if isinstance(metadata.get("outputs"), dict) else {}
        output_names = output.get("files") if isinstance(output.get("files"), list) else []
        if not source_names or not output_names:
            continue

        source_path = task_dir / str(source_names[0])
        if not source_path.exists():
            continue
        source_suffix = source_path.suffix.lower() or ".bin"
        expected_suffix = Path(str(reference_names[0])).suffix.lower() if reference_names else ""
        use_blank_workbook = is_excel_suffix(expected_suffix) and not is_excel_suffix(source_suffix)
        desired_suffix = ".xlsx" if use_blank_workbook else source_suffix
        desired_name = f"{task_dir.name}{desired_suffix}"
        desired_path = task_dir / desired_name
        current_path = task_dir / str(output_names[0])
        needs_repair = desired_name != str(output_names[0])
        if use_blank_workbook and (not desired_path.exists() or not is_zip_file(desired_path)):
            needs_repair = True
        if not needs_repair:
            continue

        if use_blank_workbook:
            write_blank_workbook(desired_path, task_dir.name, str(metadata.get("instruction_en", "")))
            policy = "blank_excel_for_non_excel_source"
        else:
            shutil.copy2(source_path, desired_path)
            policy = "source_format_preserved"
        metadata["outputs"] = {
            **output,
            "files": [desired_name],
        }
        temp_path = metadata_path.with_suffix(".json.tmp")
        temp_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temp_path, metadata_path)
        repaired.append({
            "taskId": task_dir.name,
            "from": str(current_path.name),
            "to": desired_name,
            "policy": policy,
        })

    print(json.dumps({
        "schema": "finch-content-parts-recovery-v1",
        "action": "repair-output-types",
        "modelDir": str(model_dir),
        "repairedCount": len(repaired),
        "repairs": repaired,
    }, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="action", required=True)

    merge_parser = subparsers.add_parser("merge", help="Merge valid shard records into content_parts.jsonl.")
    merge_parser.add_argument("--model-dir", required=True)
    merge_parser.add_argument("--pattern", default="content_parts*.jsonl")
    merge_parser.add_argument("--output-name", default="content_parts.jsonl")
    merge_parser.set_defaults(handler=merge)

    build_parser = subparsers.add_parser("build", help="Resume an upstream ContentBuilder shard.")
    build_parser.add_argument("--eval-root", required=True)
    build_parser.add_argument("--repo-root", required=True)
    build_parser.add_argument("--model-name", required=True)
    build_parser.add_argument("--start", type=int, default=0)
    build_parser.add_argument("--end", type=int)
    build_parser.add_argument("--output-name", required=True)
    build_parser.add_argument("--no-screenshots", action="store_true")
    build_parser.set_defaults(handler=build)

    repair_parser = subparsers.add_parser(
        "repair-output-types",
        help="Repair generated Finch outputs whose extension does not match their bytes or task contract.",
    )
    repair_parser.add_argument("--model-dir", required=True)
    repair_parser.set_defaults(handler=repair_output_types)
    return root


if __name__ == "__main__":
    parsed = parser().parse_args()
    raise SystemExit(parsed.handler(parsed))
