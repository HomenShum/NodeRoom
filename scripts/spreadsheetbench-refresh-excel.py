"""Refresh cached workbook values with local Excel and emit a hash-bound receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import win32com.client


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def refresh_with_excel(excel, path: Path, record: dict[str, object]) -> None:
    workbook = None
    replacement: Path | None = None
    open_options = {
        "UpdateLinks": 0,
        "ReadOnly": False,
        "IgnoreReadOnlyRecommended": True,
        "AddToMru": False,
    }
    try:
        try:
            workbook = excel.Workbooks.Open(str(path), **open_options)
            record["openMode"] = "normal"
        except Exception as normal_open_error:
            record["normalOpenError"] = str(normal_open_error)
            workbook = excel.Workbooks.Open(str(path), CorruptLoad=1, **open_options)
            record["openMode"] = "repair"
        excel.CalculateFullRebuild()
        if record["openMode"] == "repair":
            replacement = path.with_name(f".{path.stem}.excel-repaired.xlsx")
            if replacement.exists():
                replacement.unlink()
            workbook.SaveAs(str(replacement), FileFormat=51, CreateBackup=False)
        else:
            workbook.Save()
    finally:
        if workbook is not None:
            workbook.Close(SaveChanges=False)
    if replacement is not None:
        os.replace(replacement, path)


def refresh_with_libreoffice(path: Path) -> str:
    soffice = shutil.which("soffice") or r"C:\Program Files\LibreOffice\program\soffice.exe"
    if not Path(soffice).exists():
        raise RuntimeError("LibreOffice soffice executable is unavailable")
    with tempfile.TemporaryDirectory(prefix="ssb-v2-lo-") as temp_dir:
        temp_root = Path(temp_dir)
        output_dir = temp_root / "output"
        profile_dir = temp_root / "profile"
        output_dir.mkdir()
        command = [
            soffice,
            "--headless",
            "--nologo",
            "--nodefault",
            "--nolockcheck",
            "--norestore",
            f"-env:UserInstallation={profile_dir.as_uri()}",
            "--convert-to",
            "xlsx",
            "--outdir",
            str(output_dir),
            str(path),
        ]
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        converted = output_dir / path.name
        if result.returncode != 0 or not converted.exists():
            detail = (result.stderr or result.stdout or "no converted workbook").strip()
            raise RuntimeError(f"LibreOffice conversion failed ({result.returncode}): {detail}")
        shutil.copy2(converted, path)
        return (result.stdout or result.stderr).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, help="Root containing *_output.xlsx files")
    parser.add_argument("--receipt", required=True, help="JSON receipt path")
    parser.add_argument("--retry-receipt", help="Retry only failed records from this receipt and merge the results")
    args = parser.parse_args()

    root = Path(args.dir).resolve()
    receipt_path = Path(args.receipt).resolve()
    previous_receipt: dict[str, object] | None = None
    previous_records: dict[str, dict[str, object]] = {}
    files = sorted(root.rglob("*_output.xlsx"))
    if args.retry_receipt:
        previous_receipt = json.loads(Path(args.retry_receipt).resolve().read_text(encoding="utf-8"))
        previous_records = {str(record["path"]): record for record in previous_receipt.get("records", [])}
        failed_paths = {path for path, record in previous_records.items() if record.get("status") != "refreshed"}
        files = [path for path in files if path.relative_to(Path.cwd()).as_posix() in failed_paths]
    if not files:
        raise SystemExit(f"no *_output.xlsx files found under {root}")

    started = time.time()
    records: list[dict[str, object]] = []
    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    excel.AskToUpdateLinks = False
    excel.EnableEvents = False
    excel.AutomationSecurity = 3  # msoAutomationSecurityForceDisable
    version = str(excel.Version)
    try:
        for index, path in enumerate(files, start=1):
            before = sha256_file(path)
            record: dict[str, object] = {
                "path": path.relative_to(Path.cwd()).as_posix(),
                "beforeSha256": before,
            }
            try:
                try:
                    refresh_with_excel(excel, path, record)
                except Exception as excel_error:
                    record["excelError"] = str(excel_error)
                    record["openMode"] = "libreoffice_fallback"
                    record["libreOfficeOutput"] = refresh_with_libreoffice(path)
                record["status"] = "refreshed"
            except Exception as exc:  # Refresh errors must remain visible in the receipt.
                record["status"] = "failed"
                record["error"] = str(exc)
            record["afterSha256"] = sha256_file(path)
            records.append(record)
            if index % 20 == 0 or index == len(files):
                print(f"refreshed {index}/{len(files)}", flush=True)
    finally:
        excel.Quit()

    if previous_records:
        for record in records:
            previous_records[str(record["path"])] = record
        records = sorted(previous_records.values(), key=lambda record: str(record["path"]))
    failures = [record for record in records if record["status"] != "refreshed"]
    attempt_duration_ms = round((time.time() - started) * 1000)
    previous_duration_ms = int(previous_receipt.get("durationMs", 0)) if previous_receipt else 0
    receipt = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": "Microsoft Excel COM with isolated LibreOffice conversion fallback",
        "engineVersion": version,
        "policy": {
            "macros": "disabled",
            "externalLinkUpdates": "disabled",
            "calculation": "CalculateFullRebuild",
        },
        "root": root.relative_to(Path.cwd()).as_posix(),
        "workbookCount": len(records),
        "refreshedCount": len(records) - len(failures),
        "failureCount": len(failures),
        "durationMs": previous_duration_ms + attempt_duration_ms,
        "lastAttemptDurationMs": attempt_duration_ms,
        "records": records,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {receipt_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
