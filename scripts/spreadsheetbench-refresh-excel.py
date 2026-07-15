"""Refresh cached workbook values with local Excel and emit a hash-bound receipt."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import posixpath
import re
import shutil
import subprocess
import tempfile
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


XML_PREFIX = r'(?:[A-Za-z_][\w.-]*:)?'
CELL_RE = re.compile(
    rf'<(?P<tag>{XML_PREFIX}c)\b(?P<attrs>[^>]*?)(?:(?P<self>/>)|>(?P<body>[\s\S]*?)</(?P=tag)>)',
    re.IGNORECASE,
)
FORMULA_RE = re.compile(
    rf'<(?P<tag>{XML_PREFIX}f)\b(?P<attrs>[^>]*?)(?:/>|>(?P<body>[\s\S]*?)</(?P=tag)>)',
    re.IGNORECASE,
)
VALUE_RE = re.compile(
    rf'<(?P<tag>{XML_PREFIX}v)\b(?P<attrs>[^>]*?)(?:(?P<self>/>)|>(?P<body>[\s\S]*?)</(?P=tag)>)',
    re.IGNORECASE,
)
CELL_REF_RE = re.compile(r'\br\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
CELL_TYPE_RE = re.compile(r'\s+t\s*=\s*(["\'])[\s\S]*?\1', re.IGNORECASE)
ADDRESS_RE = re.compile(r'^([A-Z]{1,3})([1-9][0-9]*)$')
RANGE_RE = re.compile(r'^\$?([A-Z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?$')
EXCEL_ESCAPE_RE = re.compile(r'_[xX][0-9A-Fa-f]{4}_')
MAX_FORMULA_CACHE_TARGETS_PER_SHEET = 1_000_000
EXCEL_ERROR_CODES = {
    2000: "#NULL!",
    2007: "#DIV/0!",
    2015: "#VALUE!",
    2023: "#REF!",
    2029: "#NAME?",
    2036: "#NUM!",
    2042: "#N/A",
    2043: "#GETTING_DATA",
    2045: "#SPILL!",
    2046: "#BLOCKED!",
    2047: "#UNKNOWN!",
    2048: "#FIELD!",
    2049: "#DATA!",
    2050: "#CALC!",
    2051: "#CONNECT!",
    2052: "#BUSY!",
    2053: "#PYTHON!",
}


@dataclass(frozen=True)
class FormulaCache:
    cell_type: str | None
    value_xml: str


def refresh_with_excel(excel, path: Path, record: dict[str, object]) -> None:
    formula_cells = workbook_formula_cells(path)
    formula_count = sum(len(addresses) for _, addresses in formula_cells.values())
    record["formulaCellCount"] = formula_count
    if formula_count == 0:
        record["cacheWriteMode"] = "no_formula_caches"
        return
    workbook = None
    open_options = {
        "UpdateLinks": 0,
        "ReadOnly": True,
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
        values = collect_stable_formula_values(excel, workbook, formula_cells, record)
    finally:
        if workbook is not None:
            workbook.Close(SaveChanges=False)
    patch_formula_caches(
        path,
        formula_cells,
        values,
        expected_sha256=str(record["beforeSha256"]),
    )
    record["cacheWriteMode"] = "original_package_formula_cache_patch"


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


def workbook_formula_cells(path: Path) -> dict[str, tuple[str, list[str]]]:
    with zipfile.ZipFile(path, "r") as package:
        sheet_parts = workbook_sheet_parts(package)
        result: dict[str, tuple[str, list[str]]] = {}
        for sheet_name, part_path in sheet_parts.items():
            xml = package.read(part_path).decode("utf-8")
            worksheet = ElementTree.fromstring(xml)
            addresses: set[str] = set()
            for cell in worksheet.iter():
                if local_name(cell.tag) != "c":
                    continue
                address = normalize_address(cell.attrib.get("r", ""))
                formula = next((child for child in cell if local_name(child.tag) == "f"), None)
                if not address or formula is None:
                    continue
                addresses.add(address)
                formula_type = formula.attrib.get("t")
                formula_ref = formula.attrib.get("ref")
                if formula_ref and formula_type in {"array", "dataTable"}:
                    addresses.update(expand_range_addresses(formula_ref))
            if addresses:
                if len(addresses) > MAX_FORMULA_CACHE_TARGETS_PER_SHEET:
                    raise RuntimeError(
                        f"worksheet {sheet_name} declares {len(addresses)} formula cache targets; "
                        f"limit is {MAX_FORMULA_CACHE_TARGETS_PER_SHEET}"
                    )
                result[sheet_name] = (part_path, sorted(addresses, key=parse_address))
        return result


def workbook_sheet_parts(package: zipfile.ZipFile) -> dict[str, str]:
    workbook = ElementTree.fromstring(package.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(package.read("xl/_rels/workbook.xml.rels"))
    rels: dict[str, str] = {}
    for relationship in relationships:
        if local_name(relationship.tag) != "Relationship":
            continue
        relationship_id = relationship.attrib.get("Id")
        target = relationship.attrib.get("Target")
        relationship_type = relationship.attrib.get("Type", "")
        if not relationship_id or not target:
            continue
        if relationship.attrib.get("TargetMode", "").lower() == "external":
            continue
        if not relationship_type.endswith("/worksheet"):
            continue
        rels[relationship_id] = normalize_workbook_target(target)
    result: dict[str, str] = {}
    for sheet in workbook.iter():
        if local_name(sheet.tag) != "sheet":
            continue
        relationship_id = next(
            (value for key, value in sheet.attrib.items() if local_name(key) == "id"),
            None,
        )
        sheet_name = sheet.attrib.get("name")
        if not sheet_name or not relationship_id:
            raise RuntimeError("workbook contains a worksheet without a name or relationship id")
        path = rels.get(relationship_id)
        if not path:
            raise RuntimeError(f"worksheet {sheet_name} has no internal worksheet relationship")
        if path not in package.namelist():
            raise RuntimeError(f"worksheet {sheet_name} relationship target is missing: {path}")
        if sheet_name in result:
            raise RuntimeError(f"workbook contains duplicate worksheet name {sheet_name}")
        result[sheet_name] = path
    return result


def normalize_workbook_target(target: str) -> str:
    normalized = target.replace("\\", "/")
    if normalized.startswith("/"):
        resolved = posixpath.normpath(normalized).lstrip("/")
    else:
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname("xl/workbook.xml"), normalized))
    if not resolved or resolved == ".." or resolved.startswith("../"):
        raise RuntimeError(f"worksheet relationship escapes the workbook package: {target}")
    return resolved


def local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1]


def collect_formula_values(
    workbook,
    formula_cells: dict[str, tuple[str, list[str]]],
) -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    for sheet_name, (_, addresses) in formula_cells.items():
        worksheet = workbook.Worksheets(sheet_name)
        sheet_values: dict[str, Any] = {}
        for min_row, max_row, min_col, max_col in contiguous_formula_areas(addresses):
            block = worksheet.Range(
                address_from_position(min_row, min_col),
                address_from_position(max_row, max_col),
            ).Value2
            matrix = com_range_matrix(block, max_row - min_row + 1, max_col - min_col + 1)
            for row in range(min_row, max_row + 1):
                for col in range(min_col, max_col + 1):
                    sheet_values[address_from_position(row, col)] = matrix[row - min_row][col - min_col]
        missing = set(addresses).difference(sheet_values)
        if missing:
            raise RuntimeError(f"Excel omitted {len(missing)} formula cache value(s) on {sheet_name}")
        values[sheet_name] = {address: sheet_values[address] for address in addresses}
    return values


def collect_stable_formula_values(
    excel,
    workbook,
    formula_cells: dict[str, tuple[str, list[str]]],
    record: dict[str, object],
    timeout_seconds: float = 10.0,
) -> dict[str, dict[str, Any]]:
    state = int(excel.CalculationState)
    record["calculationStateAfterFullRebuild"] = state
    values = collect_formula_values(workbook, formula_cells)
    if state == 0:
        record["calculationStabilityCheck"] = "excel_done"
        return values

    deadline = time.monotonic() + timeout_seconds
    stable_reads = 0
    while time.monotonic() < deadline:
        time.sleep(0.25)
        current = collect_formula_values(workbook, formula_cells)
        if formula_value_maps_equal(values, current):
            stable_reads += 1
            if stable_reads >= 2:
                record["calculationStabilityCheck"] = "stable_while_excel_pending"
                record["calculationStateAfterStabilityCheck"] = int(excel.CalculationState)
                return current
        else:
            stable_reads = 0
        values = current
    raise RuntimeError(
        f"Excel calculation remained unstable for {timeout_seconds:.1f}s "
        f"(state={int(excel.CalculationState)})"
    )


def formula_value_maps_equal(left: dict[str, dict[str, Any]], right: dict[str, dict[str, Any]]) -> bool:
    if left.keys() != right.keys():
        return False
    for sheet_name, left_values in left.items():
        right_values = right[sheet_name]
        if left_values.keys() != right_values.keys():
            return False
        for address, left_value in left_values.items():
            right_value = right_values[address]
            if isinstance(left_value, float) and isinstance(right_value, float):
                if math.isnan(left_value) and math.isnan(right_value):
                    continue
            if left_value != right_value:
                return False
    return True


def parse_address(address: str) -> tuple[int, int]:
    match = ADDRESS_RE.fullmatch(normalize_address(address))
    if not match:
        raise ValueError(f"invalid formula cell address {address}")
    column = 0
    for char in match.group(1):
        column = column * 26 + ord(char) - 64
    return int(match.group(2)), column


def normalize_address(address: str) -> str:
    return address.replace("$", "").strip().upper()


def expand_range_addresses(reference: str) -> list[str]:
    match = RANGE_RE.fullmatch(reference.replace(" ", "").upper())
    if not match:
        raise RuntimeError(f"invalid formula result range {reference}")
    start_row, start_col = parse_address(f"{match.group(1)}{match.group(2)}")
    end_row, end_col = parse_address(
        f"{match.group(3) or match.group(1)}{match.group(4) or match.group(2)}"
    )
    min_row, max_row = sorted((start_row, end_row))
    min_col, max_col = sorted((start_col, end_col))
    area = (max_row - min_row + 1) * (max_col - min_col + 1)
    if area > MAX_FORMULA_CACHE_TARGETS_PER_SHEET:
        raise RuntimeError(
            f"formula result range {reference} contains {area} cells; "
            f"limit is {MAX_FORMULA_CACHE_TARGETS_PER_SHEET}"
        )
    return [
        address_from_position(row, col)
        for row in range(min_row, max_row + 1)
        for col in range(min_col, max_col + 1)
    ]


def contiguous_formula_areas(addresses: list[str]) -> list[tuple[int, int, int, int]]:
    columns_by_row: dict[int, set[int]] = {}
    for address in addresses:
        row, col = parse_address(address)
        columns_by_row.setdefault(row, set()).add(col)

    intervals_by_row: dict[int, list[tuple[int, int]]] = {}
    for row, columns in columns_by_row.items():
        intervals: list[tuple[int, int]] = []
        start = previous = None
        for col in sorted(columns):
            if start is None:
                start = previous = col
            elif col == previous + 1:
                previous = col
            else:
                intervals.append((start, previous))
                start = previous = col
        if start is not None and previous is not None:
            intervals.append((start, previous))
        intervals_by_row[row] = intervals

    areas: list[tuple[int, int, int, int]] = []
    active: dict[tuple[int, int], tuple[int, int]] = {}
    previous_row: int | None = None
    for row in sorted(intervals_by_row):
        current = set(intervals_by_row[row])
        if previous_row is None or row != previous_row + 1:
            for (min_col, max_col), (min_row, max_row) in active.items():
                areas.append((min_row, max_row, min_col, max_col))
            active.clear()
        for interval in list(active):
            if interval not in current:
                min_row, max_row = active.pop(interval)
                areas.append((min_row, max_row, interval[0], interval[1]))
        for interval in current:
            if interval in active:
                min_row, _ = active[interval]
                active[interval] = (min_row, row)
            else:
                active[interval] = (row, row)
        previous_row = row
    for (min_col, max_col), (min_row, max_row) in active.items():
        areas.append((min_row, max_row, min_col, max_col))
    return sorted(areas)


def address_from_position(row: int, col: int) -> str:
    letters = ""
    remaining = col
    while remaining > 0:
        remaining, index = divmod(remaining - 1, 26)
        letters = chr(65 + index) + letters
    return f"{letters}{row}"


def com_range_matrix(value: Any, rows: int, cols: int) -> list[list[Any]]:
    if rows == 1 and cols == 1:
        return [[value]]
    if not isinstance(value, tuple):
        return [[value for _ in range(cols)] for _ in range(rows)]
    if rows == 1 and value and not isinstance(value[0], tuple):
        return [list(value)]
    if cols == 1 and value and not isinstance(value[0], tuple):
        return [[item] for item in value]
    return [list(row) for row in value]


def patch_formula_caches(
    path: Path,
    formula_cells: dict[str, tuple[str, list[str]]],
    values: dict[str, dict[str, Any]],
    *,
    expected_sha256: str,
) -> None:
    part_values = {
        part_path: values[sheet_name]
        for sheet_name, (part_path, _) in formula_cells.items()
    }
    descriptor, replacement_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".cache-patched",
        dir=path.parent,
    )
    os.close(descriptor)
    replacement = Path(replacement_name)
    try:
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed before cache patching: {path}")
        with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(replacement, "w") as output:
            source_names = source.namelist()
            output.comment = source.comment
            for info in source.infolist():
                data = source.read(info.filename)
                caches = part_values.get(info.filename)
                if caches:
                    xml = data.decode("utf-8")
                    patched_xml, patched_addresses = patch_worksheet_formula_caches(xml, caches)
                    expected_addresses = set(caches)
                    if patched_addresses != expected_addresses:
                        missing = expected_addresses.difference(patched_addresses)
                        raise RuntimeError(
                            f"worksheet {info.filename} omitted {len(missing)} formula cache target(s)"
                        )
                    ElementTree.fromstring(patched_xml)
                    data = patched_xml.encode("utf-8")
                output.writestr(info, data)
        with zipfile.ZipFile(replacement, "r") as candidate:
            if candidate.namelist() != source_names:
                raise RuntimeError("cache patch changed workbook package entries")
            bad_entry = candidate.testzip()
            if bad_entry:
                raise RuntimeError(f"cache-patched workbook has an invalid ZIP entry: {bad_entry}")
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed concurrently during cache patching: {path}")
        os.replace(replacement, path)
    finally:
        if replacement.exists():
            replacement.unlink()


def patch_worksheet_formula_caches(xml: str, values: dict[str, Any]) -> tuple[str, set[str]]:
    patched_addresses: set[str] = set()

    def replace_cell(match: re.Match[str]) -> str:
        attrs = match.group("attrs")
        body = match.group("body") or ""
        cell_ref = CELL_REF_RE.search(attrs)
        address = normalize_address(cell_ref.group(1)) if cell_ref else ""
        if address not in values:
            return match.group(0)
        cache = values[address] if isinstance(values[address], FormulaCache) else serialize_formula_cache(values[address])
        next_attrs = CELL_TYPE_RE.sub("", attrs)
        if cache.cell_type:
            next_attrs = f'{next_attrs} t="{cache.cell_type}"'

        cell_tag = match.group("tag")
        value_tag = f'{cell_tag.rsplit(":", 1)[0]}:v' if ":" in cell_tag else "v"

        def replace_value(value_match: re.Match[str]) -> str:
            return (
                f'<{value_match.group("tag")}{value_match.group("attrs")}>'
                f'{cache.value_xml}</{value_match.group("tag")}>'
            )

        cached_value = f"<{value_tag}>{cache.value_xml}</{value_tag}>"
        next_body = VALUE_RE.sub(replace_value, body, count=1)
        if next_body == body:
            formula_match = FORMULA_RE.search(body)
            if formula_match:
                next_body = f"{body[:formula_match.end()]}{cached_value}{body[formula_match.end():]}"
            else:
                next_body = f"{body}{cached_value}"
        patched_addresses.add(address)
        return f"<{cell_tag}{next_attrs}>{next_body}</{cell_tag}>"

    return CELL_RE.sub(replace_cell, xml), patched_addresses


def serialize_formula_cache(value: Any) -> FormulaCache:
    if value is None:
        return FormulaCache(None, "")
    if isinstance(value, bool):
        return FormulaCache("b", "1" if value else "0")
    if isinstance(value, int):
        error = EXCEL_ERROR_CODES.get(value & 0xFFFF)
        if error:
            return FormulaCache("e", html.escape(error, quote=False))
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise RuntimeError(f"Excel returned a non-finite formula cache value: {value}")
        return FormulaCache(None, repr(value))
    return FormulaCache("str", encode_spreadsheetml_string(str(value)))


def encode_spreadsheetml_string(value: str) -> str:
    escaped_literals = EXCEL_ESCAPE_RE.sub(lambda match: f"_x005F_{match.group(0)[1:]}", value)
    encoded = "".join(
        f"_x{ord(char):04X}_"
        if ord(char) == 0x0D or ord(char) < 0x20 and char not in {"\t", "\n"}
        else char
        for char in escaped_literals
    )
    return html.escape(encoded, quote=False)


def refresh_with_libreoffice_cache_patch(path: Path, record: dict[str, object]) -> None:
    formula_cells = workbook_formula_cells(path)
    formula_count = sum(len(addresses) for _, addresses in formula_cells.values())
    record["formulaCellCount"] = formula_count
    if formula_count == 0:
        record["cacheWriteMode"] = "no_formula_caches"
        return
    with tempfile.TemporaryDirectory(prefix="ssb-v2-cache-fallback-") as temp_dir:
        temporary = Path(temp_dir) / path.name
        shutil.copy2(path, temporary)
        record["libreOfficeOutput"] = refresh_with_libreoffice(temporary)
        values = read_formula_caches(temporary, formula_cells)
    patch_formula_caches(
        path,
        formula_cells,
        values,
        expected_sha256=str(record["beforeSha256"]),
    )
    record["cacheWriteMode"] = "original_package_formula_cache_patch"


def read_formula_caches(
    path: Path,
    source_formula_cells: dict[str, tuple[str, list[str]]],
) -> dict[str, dict[str, FormulaCache]]:
    with zipfile.ZipFile(path, "r") as package:
        refreshed_parts = workbook_sheet_parts(package)
        values: dict[str, dict[str, FormulaCache]] = {}
        for sheet_name, (_, addresses) in source_formula_cells.items():
            refreshed_path = refreshed_parts.get(sheet_name)
            if not refreshed_path:
                raise RuntimeError(f"refreshed workbook is missing worksheet {sheet_name}")
            xml = package.read(refreshed_path).decode("utf-8")
            by_address: dict[str, FormulaCache] = {}
            requested = set(addresses)
            for match in CELL_RE.finditer(xml):
                cell_ref = CELL_REF_RE.search(match.group("attrs"))
                address = cell_ref.group(1).replace("$", "").upper() if cell_ref else ""
                if address not in requested:
                    continue
                body = match.group("body") or ""
                value_match = VALUE_RE.search(body)
                raw = value_match.group("body") or "" if value_match else ""
                cell_type = next(
                    (item.group(2) for item in re.finditer(r'\bt\s*=\s*(["\'])([^"\']+)\1', match.group("attrs"), re.IGNORECASE)),
                    None,
                )
                if cell_type == "inlineStr":
                    text = "".join(
                        html.unescape(text_match.group(1))
                        for text_match in re.finditer(
                            rf'<{XML_PREFIX}t\b[^>]*>([\s\S]*?)</{XML_PREFIX}t>',
                            body,
                            re.IGNORECASE,
                        )
                    )
                    by_address[address] = FormulaCache("str", encode_spreadsheetml_string(text))
                else:
                    by_address[address] = FormulaCache(cell_type, raw)
            missing = requested.difference(by_address)
            if missing:
                raise RuntimeError(f"refreshed workbook omitted {len(missing)} formula cache cell(s) on {sheet_name}")
            values[sheet_name] = by_address
        return values


def create_excel_application():
    import win32com.client  # Imported lazily so OOXML helpers remain cross-platform testable.

    excel = win32com.client.DispatchEx("Excel.Application")
    try:
        excel.Visible = False
        excel.DisplayAlerts = False
        excel.AskToUpdateLinks = False
        excel.EnableEvents = False
        excel.AutomationSecurity = 3  # msoAutomationSecurityForceDisable
        version = str(excel.Version)
        return excel, version
    except Exception:
        try:
            excel.Quit()
        except Exception:
            pass
        raise


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
    excel = None
    version = "unavailable"
    excel_initialization_error: str | None = None
    excel_quit_error: str | None = None
    try:
        try:
            excel, version = create_excel_application()
        except Exception as exc:
            excel_initialization_error = str(exc)
        for index, path in enumerate(files, start=1):
            before = sha256_file(path)
            record: dict[str, object] = {
                "path": path.relative_to(Path.cwd()).as_posix(),
                "beforeSha256": before,
            }
            try:
                if excel is not None:
                    try:
                        refresh_with_excel(excel, path, record)
                    except Exception as excel_error:
                        record["excelError"] = str(excel_error)
                        record["openMode"] = "libreoffice_fallback"
                        refresh_with_libreoffice_cache_patch(path, record)
                else:
                    record["excelInitializationError"] = excel_initialization_error or "Excel initialization failed"
                    record["openMode"] = "libreoffice_fallback"
                    refresh_with_libreoffice_cache_patch(path, record)
                record["status"] = "refreshed"
            except Exception as exc:  # Refresh errors must remain visible in the receipt.
                record["status"] = "failed"
                record["error"] = str(exc)
            record["afterSha256"] = sha256_file(path)
            records.append(record)
            if index % 20 == 0 or index == len(files):
                print(f"refreshed {index}/{len(files)}", flush=True)
    finally:
        if excel is not None:
            try:
                excel.Quit()
            except Exception as exc:
                excel_quit_error = str(exc)

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
        "engine": "Microsoft Excel COM cache extraction with isolated LibreOffice cache fallback",
        "engineVersion": version,
        **({"excelInitializationError": excel_initialization_error} if excel_initialization_error else {}),
        **({"excelQuitError": excel_quit_error} if excel_quit_error else {}),
        "policy": {
            "macros": "disabled",
            "externalLinkUpdates": "disabled",
            "calculation": "CalculateFullRebuild",
            "persistence": "patch cached formula values into the original OOXML package without saving Excel's formula rewrites",
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
