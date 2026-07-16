"""Finalize workbook formula caches with fail-closed Excel evidence."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import os
import posixpath
import re
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
INLINE_STRING_RE = re.compile(
    rf'<(?P<tag>{XML_PREFIX}is)\b(?P<attrs>[^>]*?)>(?P<body>[\s\S]*?)</(?P=tag)>',
    re.IGNORECASE,
)
CELL_REF_RE = re.compile(r'\br\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
CELL_TYPE_RE = re.compile(r'\s+t\s*=\s*(["\'])[\s\S]*?\1', re.IGNORECASE)
ADDRESS_RE = re.compile(r'^([A-Z]{1,3})([1-9][0-9]*)$')
RANGE_RE = re.compile(r'^\$?([A-Z]{1,3})\$?([1-9][0-9]*)(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?$')
EXCEL_ESCAPE_RE = re.compile(r'_[xX][0-9A-Fa-f]{4}_')
MAX_FORMULA_CACHE_TARGETS_PER_SHEET = 1_000_000
SUPPORTED_FORMULA_TOPOLOGIES = ("normal", "shared", "array", "dataTable")
FINALIZATION_STATUSES = (
    "completed",
    "completed_stable_pending",
    "not_required",
    "preserved_pending",
    "preserved_unsupported",
    "preserved_error",
)
PRESERVED_STATUSES = {
    "preserved_pending",
    "preserved_unsupported",
    "preserved_error",
}
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


@dataclass(frozen=True)
class FormulaTopologyInspection:
    formula_cells: dict[str, tuple[str, list[str]]]
    formula_cell_count: int
    detail: dict[str, object]

    @property
    def safe(self) -> bool:
        return bool(self.detail["safe"])


class ExcelCalculationPending(RuntimeError):
    pass


class FormulaCachePatchError(RuntimeError):
    pass


def refresh_with_excel(
    excel,
    path: Path,
    record: dict[str, object],
    formula_cells: dict[str, tuple[str, list[str]]],
    *,
    allow_stable_pending: bool = False,
) -> None:
    workbook = None
    open_options = {
        "UpdateLinks": 0,
        "ReadOnly": True,
        "IgnoreReadOnlyRecommended": True,
        "AddToMru": False,
    }
    try:
        try:
            workbook = excel.Workbooks.Open(str(path.resolve()), **open_options)
            record["openMode"] = "normal_read_only"
        except Exception as normal_open_error:
            record["normalOpenError"] = str(normal_open_error)
            workbook = excel.Workbooks.Open(str(path.resolve()), CorruptLoad=1, **open_options)
            record["openMode"] = "repair_read_only"
        excel.CalculateFullRebuild()
        values = collect_formula_values_with_state_gate(
            excel,
            workbook,
            formula_cells,
            record,
            allow_stable_pending=allow_stable_pending,
        )
    finally:
        if workbook is not None:
            workbook.Close(SaveChanges=False)
    try:
        topology_preservation = patch_formula_caches(
            path,
            formula_cells,
            values,
            expected_sha256=str(record.get("preRefreshSha256", record["beforeSha256"])),
        )
    except Exception as exc:
        raise FormulaCachePatchError(str(exc)) from exc
    record["cacheWriteMode"] = "original_package_formula_cache_patch"
    record["formulaTopologyPreservation"] = topology_preservation


def inspect_formula_topology(path: Path) -> FormulaTopologyInspection:
    topology_counts = {
        "normal": 0,
        "shared": 0,
        "array": 0,
        "dataTable": 0,
        "unknown": 0,
    }
    unsupported: list[dict[str, object]] = []
    with zipfile.ZipFile(path, "r") as package:
        sheet_parts = workbook_sheet_parts(package)
        result: dict[str, tuple[str, list[str]]] = {}
        for sheet_name, part_path in sheet_parts.items():
            xml = package.read(part_path).decode("utf-8")
            worksheet = ElementTree.fromstring(xml)
            cells_by_address: dict[str, ElementTree.Element] = {}
            for cell in worksheet.iter():
                if local_name(cell.tag) != "c":
                    continue
                address = normalize_address(cell.attrib.get("r", ""))
                if ADDRESS_RE.fullmatch(address):
                    cells_by_address[address] = cell

            def is_cache_result_cell(address: str) -> bool:
                cell = cells_by_address.get(address)
                if cell is None:
                    return False
                # Inline/shared strings are persisted workbook content, not formula
                # result caches. A number of financial-model data tables use them
                # for display labels even inside the declared data-table rectangle.
                if cell.attrib.get("t") in {"inlineStr", "s"}:
                    return False
                return not any(local_name(child.tag) == "is" for child in cell)
            formula_addresses: set[str] = set()
            cache_targets: set[str] = set()
            for cell in worksheet.iter():
                if local_name(cell.tag) != "c":
                    continue
                formula = next((child for child in cell if local_name(child.tag) == "f"), None)
                if formula is None:
                    continue
                address = normalize_address(cell.attrib.get("r", ""))
                if not ADDRESS_RE.fullmatch(address):
                    raise RuntimeError(
                        f"worksheet {sheet_name} contains a formula cell without a valid address"
                    )
                if address in formula_addresses:
                    raise RuntimeError(
                        f"worksheet {sheet_name} contains duplicate formula cell {address}"
                    )
                formula_addresses.add(address)
                cache_targets.add(address)
                declared_type = formula.attrib.get("t")
                normalized_type = (declared_type or "normal").strip().casefold()
                topology_markers = sorted(
                    key for key in (local_name(name) for name in formula.attrib) if key != "t"
                )
                if normalized_type == "normal" and any(
                    marker in {"ref", "si", "dt2D", "dtr", "r1", "r2"}
                    for marker in topology_markers
                ):
                    topology_type = "unknown"
                elif normalized_type == "normal":
                    topology_type = "normal"
                elif normalized_type == "shared":
                    topology_type = "shared"
                elif normalized_type == "array":
                    topology_type = "array"
                elif normalized_type == "datatable":
                    topology_type = "dataTable"
                else:
                    topology_type = "unknown"
                topology_counts[topology_type] += 1
                if topology_type in {"shared", "array"} and formula.attrib.get("ref"):
                    cache_targets.update(
                        address
                        for address in expand_range_addresses(formula.attrib["ref"])
                        if is_cache_result_cell(address)
                    )
                elif topology_type == "dataTable" and formula.attrib.get("ref"):
                    # A two-input data table's top row and left column are inputs/labels,
                    # not calculated cache cells. Rewriting those cells can leave an
                    # inline-string payload under t="e" and makes Excel reject the file.
                    # One-input table shapes are less explicit, so only patch their
                    # formula anchor until a safe result-cell contract is available.
                    if formula.attrib.get("dt2D") in {"1", "true", "True"}:
                        range_addresses = expand_range_addresses(formula.attrib["ref"])
                        positions = [parse_address(address) for address in range_addresses]
                        min_row = min(row for row, _ in positions)
                        min_col = min(col for _, col in positions)
                        cache_targets.update(
                            address
                            for address in range_addresses
                            if is_cache_result_cell(address)
                            and parse_address(address)[0] > min_row
                            and parse_address(address)[1] > min_col
                        )
                if topology_type not in SUPPORTED_FORMULA_TOPOLOGIES:
                    unsupported.append({
                        "sheet": sheet_name,
                        "cell": address,
                        "type": topology_type,
                        **({"declaredType": declared_type} if declared_type else {}),
                        **({"topologyMarkers": topology_markers} if topology_markers else {}),
                        **({"reference": formula.attrib["ref"]} if formula.attrib.get("ref") else {}),
                    })
            if cache_targets:
                if len(cache_targets) > MAX_FORMULA_CACHE_TARGETS_PER_SHEET:
                    raise RuntimeError(
                        f"worksheet {sheet_name} declares {len(cache_targets)} formula cache targets; "
                        f"limit is {MAX_FORMULA_CACHE_TARGETS_PER_SHEET}"
                    )
                result[sheet_name] = (part_path, sorted(cache_targets, key=parse_address))
    formula_cell_count = sum(topology_counts.values())
    cache_target_cell_count = sum(len(addresses) for _, addresses in result.values())
    return FormulaTopologyInspection(
        formula_cells=result,
        formula_cell_count=formula_cell_count,
        detail={
            "safe": not unsupported,
            "supportedTypes": list(SUPPORTED_FORMULA_TOPOLOGIES),
            "counts": topology_counts,
            "cacheTargetCellCount": cache_target_cell_count,
            "unsupported": unsupported,
        },
    )


def workbook_formula_cells(path: Path) -> dict[str, tuple[str, list[str]]]:
    return inspect_formula_topology(path).formula_cells


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


def collect_formula_values_with_state_gate(
    excel,
    workbook,
    formula_cells: dict[str, tuple[str, list[str]]],
    record: dict[str, object],
    *,
    allow_stable_pending: bool = False,
    required_identical_reads: int = 3,
    sample_interval_seconds: float = 0.25,
    timeout_seconds: float = 10.0,
) -> dict[str, dict[str, Any]]:
    state_before = int(excel.CalculationState)
    record["calculationStateBeforeCacheRead"] = state_before
    if state_before == 0:
        values = collect_formula_values(workbook, formula_cells)
        state_after = int(excel.CalculationState)
    elif allow_stable_pending:
        values, state_after = collect_stable_pending_formula_values(
            excel,
            workbook,
            formula_cells,
            record,
            required_identical_reads=required_identical_reads,
            sample_interval_seconds=sample_interval_seconds,
            timeout_seconds=timeout_seconds,
        )
    else:
        values = None
        state_after = int(excel.CalculationState)
    record["calculationStateAfterCacheRead"] = state_after
    record["calculationStates"] = {
        "beforeCacheRead": state_before,
        "afterCacheRead": state_after,
    }
    if state_before != 0 or state_after != 0:
        if allow_stable_pending and values is not None and record.get("calculationStability", {}).get("passed") is True:
            record["calculationStateGate"] = "accepted_stable_pending"
            return values
        record["calculationStateGate"] = "preserved_pending"
        raise ExcelCalculationPending(
            "Excel calculation state must be 0 before and after the cache read "
            f"(before={state_before}, after={state_after})"
        )
    record["calculationStateGate"] = "passed"
    if values is None:
        raise RuntimeError("Excel formula cache values were not read")
    return values


def collect_stable_pending_formula_values(
    excel,
    workbook,
    formula_cells: dict[str, tuple[str, list[str]]],
    record: dict[str, object],
    *,
    required_identical_reads: int,
    sample_interval_seconds: float,
    timeout_seconds: float,
) -> tuple[dict[str, dict[str, Any]] | None, int]:
    if required_identical_reads < 2:
        raise ValueError("stable-pending finalization requires at least two identical cache reads")
    deadline = time.monotonic() + timeout_seconds
    values = collect_formula_values(workbook, formula_cells)
    identical_reads = 1
    observed_reads = 1
    while time.monotonic() < deadline:
        time.sleep(sample_interval_seconds)
        current = collect_formula_values(workbook, formula_cells)
        observed_reads += 1
        if formula_value_maps_equal(values, current):
            identical_reads += 1
            values = current
            if identical_reads >= required_identical_reads:
                state_after = int(excel.CalculationState)
                record["calculationStability"] = {
                    "mode": "stable_pending_opt_in",
                    "passed": True,
                    "requiredIdenticalReads": required_identical_reads,
                    "observedIdenticalReads": identical_reads,
                    "observedReads": observed_reads,
                    "sampleIntervalMs": round(sample_interval_seconds * 1000),
                    "timeoutMs": round(timeout_seconds * 1000),
                }
                return values, state_after
        else:
            identical_reads = 1
            values = current
    state_after = int(excel.CalculationState)
    record["calculationStability"] = {
        "mode": "stable_pending_opt_in",
        "passed": False,
        "requiredIdenticalReads": required_identical_reads,
        "observedIdenticalReads": identical_reads,
        "observedReads": observed_reads,
        "sampleIntervalMs": round(sample_interval_seconds * 1000),
        "timeoutMs": round(timeout_seconds * 1000),
    }
    return None, state_after


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
) -> dict[str, object]:
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
    topology_before: dict[str, object] | None = None
    topology_preservation: dict[str, object] | None = None
    try:
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed before cache patching: {path}")
        topology_before = formula_topology_fingerprint(path, part_values)
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
        topology_after = formula_topology_fingerprint(replacement, part_values)
        if topology_before != topology_after:
            raise RuntimeError("cache patch changed workbook formula topology")
        topology_preservation = {
            "matched": True,
            "beforeSha256": topology_before["sha256"],
            "afterSha256": topology_after["sha256"],
            "formulaElementCount": topology_before["formulaElementCount"],
        }
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed concurrently during cache patching: {path}")
        os.replace(replacement, path)
    finally:
        if replacement.exists():
            replacement.unlink()
    if topology_preservation is None:
        raise RuntimeError("cache patch omitted formula-topology preservation evidence")
    return topology_preservation


def repair_inline_string_cache_conflicts(
    path: Path,
    *,
    expected_sha256: str,
) -> dict[str, object]:
    """Remove only impossible cache payloads left beside inline-string content."""
    descriptor, replacement_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".inline-cache-repaired",
        dir=path.parent,
    )
    os.close(descriptor)
    replacement = Path(replacement_name)
    repaired_cells: list[dict[str, str]] = []
    duplicate_value_cells: list[dict[str, str]] = []
    try:
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed before inline-string compatibility repair: {path}")
        topology_before = formula_topology_fingerprint(path)
        with zipfile.ZipFile(path, "r") as source, zipfile.ZipFile(replacement, "w") as output:
            source_names = source.namelist()
            worksheet_parts = set(workbook_sheet_parts(source).values())
            output.comment = source.comment
            for info in source.infolist():
                data = source.read(info.filename)
                if info.filename in worksheet_parts:
                    xml = data.decode("utf-8")
                    deduplicated_xml, duplicate_addresses, ambiguous_addresses = repair_worksheet_duplicate_value_caches(xml)
                    if ambiguous_addresses:
                        raise RuntimeError(
                            f"worksheet {info.filename} has {len(ambiguous_addresses)} conflicting duplicate value cache(s)"
                        )
                    patched_xml, addresses = repair_worksheet_inline_string_cache_conflicts(deduplicated_xml)
                    if duplicate_addresses:
                        duplicate_value_cells.extend(
                            {"part": info.filename, "cell": address}
                            for address in sorted(duplicate_addresses, key=parse_address)
                        )
                    if addresses:
                        repaired_cells.extend(
                            {"part": info.filename, "cell": address}
                            for address in sorted(addresses, key=parse_address)
                        )
                    if duplicate_addresses or addresses:
                        ElementTree.fromstring(patched_xml)
                        data = patched_xml.encode("utf-8")
                output.writestr(info, data)
        if not repaired_cells and not duplicate_value_cells:
            return {
                "changed": False,
                "repairedCellCount": 0,
                "cells": [],
                "duplicateValueCacheCellCount": 0,
                "duplicateValueCacheCells": [],
            }
        with zipfile.ZipFile(replacement, "r") as candidate:
            if candidate.namelist() != source_names:
                raise RuntimeError("inline-string compatibility repair changed workbook package entries")
            bad_entry = candidate.testzip()
            if bad_entry:
                raise RuntimeError(f"inline-string compatibility repair produced an invalid ZIP entry: {bad_entry}")
        topology_after = formula_topology_fingerprint(replacement)
        if topology_before != topology_after:
            raise RuntimeError("inline-string compatibility repair changed workbook formula topology")
        if sha256_file(path) != expected_sha256:
            raise RuntimeError(f"workbook changed concurrently during inline-string compatibility repair: {path}")
        os.replace(replacement, path)
        return {
            "changed": True,
            "repairedCellCount": len(repaired_cells),
            "cells": repaired_cells,
            "duplicateValueCacheCellCount": len(duplicate_value_cells),
            "duplicateValueCacheCells": duplicate_value_cells,
            "formulaTopologyPreservation": {
                "matched": True,
                "beforeSha256": topology_before["sha256"],
                "afterSha256": topology_after["sha256"],
                "formulaElementCount": topology_before["formulaElementCount"],
            },
        }
    finally:
        if replacement.exists():
            replacement.unlink()


def repair_worksheet_inline_string_cache_conflicts(xml: str) -> tuple[str, set[str]]:
    repaired_addresses: set[str] = set()

    def replace_cell(match: re.Match[str]) -> str:
        attrs = match.group("attrs")
        body = match.group("body") or ""
        if not INLINE_STRING_RE.search(body) or not VALUE_RE.search(body):
            return match.group(0)
        cell_ref = CELL_REF_RE.search(attrs)
        address = normalize_address(cell_ref.group(1)) if cell_ref else ""
        if not ADDRESS_RE.fullmatch(address):
            return match.group(0)
        next_attrs = CELL_TYPE_RE.sub("", attrs)
        next_body = VALUE_RE.sub("", body)
        repaired_addresses.add(address)
        return f'<{match.group("tag")}{next_attrs} t="inlineStr">{next_body}</{match.group("tag")}>'

    return CELL_RE.sub(replace_cell, xml), repaired_addresses


def repair_worksheet_duplicate_value_caches(xml: str) -> tuple[str, set[str], set[str]]:
    repaired_addresses: set[str] = set()
    ambiguous_addresses: set[str] = set()

    def replace_cell(match: re.Match[str]) -> str:
        attrs = match.group("attrs")
        body = match.group("body") or ""
        values = list(VALUE_RE.finditer(body))
        if len(values) <= 1:
            return match.group(0)
        cell_ref = CELL_REF_RE.search(attrs)
        address = normalize_address(cell_ref.group(1)) if cell_ref else ""
        if not ADDRESS_RE.fullmatch(address):
            return match.group(0)
        signatures = {
            (value.group("self") or "", value.group("body") or "")
            for value in values
        }
        if len(signatures) != 1:
            ambiguous_addresses.add(address)
            return match.group(0)
        preferred_value = next(
            (
                value.group(0)
                for value in values
                if re.search(r"\bxml:space\s*=\s*['\"]preserve['\"]", value.group("attrs") or "", re.IGNORECASE)
            ),
            values[0].group(0),
        )
        kept = False

        def keep_one(value_match: re.Match[str]) -> str:
            nonlocal kept
            if kept:
                return ""
            kept = True
            return preferred_value

        repaired_addresses.add(address)
        next_body = VALUE_RE.sub(keep_one, body)
        return f'<{match.group("tag")}{attrs}>{next_body}</{match.group("tag")}>'

    return CELL_RE.sub(replace_cell, xml), repaired_addresses, ambiguous_addresses


def formula_topology_fingerprint(
    path: Path,
    part_paths: object | None = None,
) -> dict[str, object]:
    digest = hashlib.sha256()
    formula_element_count = 0
    with zipfile.ZipFile(path, "r") as package:
        selected_parts = (
            sorted(set(str(part_path) for part_path in part_paths))
            if part_paths is not None
            else sorted(set(workbook_sheet_parts(package).values()))
        )
        for part_path in selected_parts:
            xml = package.read(part_path).decode("utf-8")
            for cell_match in CELL_RE.finditer(xml):
                attrs = cell_match.group("attrs")
                body = cell_match.group("body") or ""
                cell_ref = CELL_REF_RE.search(attrs)
                address = normalize_address(cell_ref.group(1)) if cell_ref else ""
                for formula_match in FORMULA_RE.finditer(body):
                    digest.update(part_path.encode("utf-8"))
                    digest.update(b"\0")
                    digest.update(address.encode("ascii"))
                    digest.update(b"\0")
                    digest.update(formula_match.group(0).encode("utf-8"))
                    digest.update(b"\0")
                    formula_element_count += 1
    return {
        "sha256": digest.hexdigest(),
        "formulaElementCount": formula_element_count,
    }


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

        value_replaced = False

        def replace_value(value_match: re.Match[str]) -> str:
            nonlocal value_replaced
            if value_replaced:
                return ""
            value_replaced = True
            return (
                f'<{value_match.group("tag")}{value_match.group("attrs")}>'
                f'{cache.value_xml}</{value_match.group("tag")}>'
            )

        cached_value = f"<{value_tag}>{cache.value_xml}</{value_tag}>"
        next_body = VALUE_RE.sub(replace_value, body)
        if not value_replaced:
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


def select_workbooks(directory: str | None, file: str | None) -> tuple[Path, list[Path]]:
    if bool(directory) == bool(file):
        raise ValueError("exactly one of --dir or --file is required")
    if file:
        workbook = Path(file).resolve()
        if not workbook.is_file() or workbook.suffix.lower() != ".xlsx":
            raise ValueError(f"--file must name an existing .xlsx workbook: {workbook}")
        return workbook.parent, [workbook]
    root = Path(str(directory)).resolve()
    if not root.is_dir():
        raise ValueError(f"--dir must name an existing directory: {root}")
    return root, sorted(root.rglob("*_output.xlsx"))


def receipt_workbook_path(path: Path) -> str:
    try:
        return path.relative_to(Path.cwd()).as_posix()
    except ValueError:
        return path.as_posix()


def is_accepted_finalization_status(status: object) -> bool:
    return status in {"completed", "completed_stable_pending"}


def load_checkpoint_records(path: Path) -> dict[str, dict[str, object]]:
    if not path.exists():
        return {}
    records: dict[str, dict[str, object]] = {}
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"invalid checkpoint JSON at {path}:{line_number}: {exc}") from exc
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise RuntimeError(f"invalid checkpoint record at {path}:{line_number}")
        records[str(record["path"])] = record
    return records


def append_checkpoint_record(path: Path, record: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(record, separators=(",", ":")) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def accepted_record_matches_workbook(record: dict[str, object] | None, path: Path) -> bool:
    if not record or not is_accepted_finalization_status(record.get("status")):
        return False
    after_sha256 = record.get("afterSha256")
    return isinstance(after_sha256, str) and after_sha256 == sha256_file(path)


def seal_terminal_record(path: Path, record: dict[str, object]) -> dict[str, object]:
    after = sha256_file(path)
    before = str(record["beforeSha256"])
    status = str(record["status"])
    changed = before != after
    record["afterSha256"] = after
    record["changed"] = changed
    if (status == "not_required" or status in PRESERVED_STATUSES) and changed:
        raise RuntimeError(
            f"{status} violated the byte-preservation boundary for {path}: {before} != {after}"
        )
    return record


def _finalize_workbook_staged(
    path: Path,
    excel,
    *,
    excel_initialization_error: str | None = None,
    allow_stable_pending: bool = False,
) -> dict[str, object]:
    record: dict[str, object] = {
        "path": receipt_workbook_path(path),
        "beforeSha256": sha256_file(path),
    }
    original_bytes: bytes | None = None
    try:
        inspection = inspect_formula_topology(path)
    except Exception as exc:
        record.update({
            "status": "preserved_error",
            "reason": "package_read_error",
            "cacheWriteMode": "none_preserved_original_package",
            "packageReadError": str(exc),
        })
        return seal_terminal_record(path, record)

    record["formulaCellCount"] = inspection.formula_cell_count
    record["formulaTopology"] = inspection.detail
    if not inspection.safe:
        record.update({
            "status": "preserved_unsupported",
            "reason": "unsupported_formula_topology",
            "cacheWriteMode": "none_preserved_original_package",
        })
        return seal_terminal_record(path, record)

    original_bytes = path.read_bytes()
    try:
        compatibility_repair = repair_inline_string_cache_conflicts(
            path,
            expected_sha256=str(record["beforeSha256"]),
        )
        record["inlineStringCacheCompatibilityRepair"] = compatibility_repair
    except Exception as exc:
        record.update({
            "status": "preserved_error",
            "reason": "package_compatibility_repair_error",
            "cacheWriteMode": "none_preserved_original_package",
            "packageCompatibilityRepairError": str(exc),
        })
        return seal_terminal_record(path, record)
    record["preRefreshSha256"] = sha256_file(path)

    if excel is None:
        if original_bytes is not None:
            path.write_bytes(original_bytes)
        record.update({
            "status": "preserved_error",
            "reason": "excel_initialization_error",
            "cacheWriteMode": "none_preserved_original_package",
            "excelInitializationError": excel_initialization_error or "Excel initialization failed",
        })
        return seal_terminal_record(path, record)

    if inspection.formula_cell_count == 0:
        workbook = None
        try:
            workbook = excel.Workbooks.Open(
                str(path.resolve()),
                UpdateLinks=0,
                ReadOnly=True,
                IgnoreReadOnlyRecommended=True,
                AddToMru=False,
            )
            record.update({
                "openMode": "normal_read_only",
                "status": "completed",
                "reason": "excel_open_verified_no_formula_cells",
                "cacheWriteMode": "no_formula_caches",
            })
        except Exception as exc:
            record.update({
                "status": "preserved_error",
                "reason": "excel_com_error",
                "cacheWriteMode": "none_preserved_original_package",
                "excelError": str(exc),
            })
        finally:
            if workbook is not None:
                workbook.Close(SaveChanges=False)
        if str(record["status"]) in PRESERVED_STATUSES and original_bytes is not None:
            path.write_bytes(original_bytes)
        return seal_terminal_record(path, record)

    try:
        refresh_with_excel(
            excel,
            path,
            record,
            inspection.formula_cells,
            allow_stable_pending=allow_stable_pending,
        )
    except ExcelCalculationPending as exc:
        record.update({
            "status": "preserved_pending",
            "reason": "excel_calculation_state_not_done",
            "cacheWriteMode": "none_preserved_original_package",
            "calculationStateError": str(exc),
        })
    except FormulaCachePatchError as exc:
        record.update({
            "status": "preserved_error",
            "reason": "package_write_error",
            "cacheWriteMode": "none_preserved_original_package",
            "packageWriteError": str(exc),
        })
    except Exception as exc:
        record.update({
            "status": "preserved_error",
            "reason": "excel_com_error",
            "cacheWriteMode": "none_preserved_original_package",
            "excelError": str(exc),
        })
    else:
        stable_pending = record.get("calculationStateGate") == "accepted_stable_pending"
        record.update({
            "status": "completed_stable_pending" if stable_pending else "completed",
            "reason": (
                "excel_cache_values_stable_while_calculation_pending"
                if stable_pending
                else "excel_calculation_done_and_supported_topology"
            ),
        })
    if str(record["status"]) in PRESERVED_STATUSES and original_bytes is not None:
        path.write_bytes(original_bytes)
    return seal_terminal_record(path, record)


def finalize_workbook(
    path: Path,
    excel,
    *,
    excel_initialization_error: str | None = None,
    allow_stable_pending: bool = False,
    transaction_attempts: int = 3,
) -> dict[str, object]:
    """Finalize through a sibling staging file and commit with a source hash check."""
    if transaction_attempts < 1:
        raise ValueError("transaction_attempts must be at least 1")

    last_source_change: tuple[str, str] | None = None
    for transaction_attempt in range(1, transaction_attempts + 1):
        original_bytes = path.read_bytes()
        original_sha256 = hashlib.sha256(original_bytes).hexdigest()
        descriptor, staging_name = tempfile.mkstemp(
            prefix=f".{path.stem}.",
            suffix=".finalizing.xlsx",
            dir=path.parent,
        )
        os.close(descriptor)
        staging_path = Path(staging_name)
        try:
            staging_path.write_bytes(original_bytes)
            record = _finalize_workbook_staged(
                staging_path,
                excel,
                excel_initialization_error=excel_initialization_error,
                allow_stable_pending=allow_stable_pending,
            )
            current_sha256 = sha256_file(path)
            if current_sha256 != original_sha256:
                last_source_change = (original_sha256, current_sha256)
                if transaction_attempt < transaction_attempts:
                    time.sleep(0.05 * transaction_attempt)
                    continue
                raise RuntimeError(
                    f"workbook changed during staged finalization for {path}: "
                    f"{original_sha256} != {current_sha256}"
                )

            record["path"] = receipt_workbook_path(path)
            record["beforeSha256"] = original_sha256
            record["transactionMode"] = "staged_compare_and_swap"
            record["transactionAttemptCount"] = transaction_attempt
            if is_accepted_finalization_status(record.get("status")):
                with zipfile.ZipFile(staging_path, "r") as candidate:
                    bad_entry = candidate.testzip()
                    if bad_entry:
                        raise RuntimeError(f"staged workbook has an invalid ZIP entry: {bad_entry}")
                os.replace(staging_path, path)
            record["afterSha256"] = sha256_file(path)
            record["changed"] = record["beforeSha256"] != record["afterSha256"]
            return record
        finally:
            if staging_path.exists():
                staging_path.unlink()

    before, after = last_source_change or ("unknown", "unknown")
    raise RuntimeError(f"workbook remained unstable during finalization for {path}: {before} != {after}")


def main() -> int:
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--dir", help="Root containing *_output.xlsx files")
    source.add_argument("--file", help="One candidate .xlsx workbook to finalize before evidence sealing")
    parser.add_argument("--receipt", required=True, help="JSON receipt path")
    parser.add_argument("--retry-receipt", help="Retry non-terminal legacy records and merge the results")
    parser.add_argument("--checkpoint", help="Durable JSONL progress checkpoint; defaults beside the receipt")
    parser.add_argument(
        "--allow-stable-pending",
        action="store_true",
        help="Opt in to cache patching after three identical reads while Excel calculation remains pending",
    )
    args = parser.parse_args()

    try:
        root, files = select_workbooks(args.dir, args.file)
    except ValueError as exc:
        parser.error(str(exc))
    all_files = files
    receipt_path = Path(args.receipt).resolve()
    checkpoint_path = (
        Path(args.checkpoint).resolve()
        if args.checkpoint
        else receipt_path.with_suffix(receipt_path.suffix + ".checkpoint.jsonl")
    )
    previous_receipt: dict[str, object] | None = None
    previous_records: dict[str, dict[str, object]] = {}
    if args.retry_receipt:
        previous_receipt = json.loads(Path(args.retry_receipt).resolve().read_text(encoding="utf-8"))
        previous_records = {str(record["path"]): record for record in previous_receipt.get("records", [])}
    checkpoint_records = load_checkpoint_records(checkpoint_path)
    prior_records = {**previous_records, **checkpoint_records}
    selected_paths = {receipt_workbook_path(path) for path in all_files}
    prior_records = {path: record for path, record in prior_records.items() if path in selected_paths}
    files = [
        path
        for path in all_files
        if not accepted_record_matches_workbook(prior_records.get(receipt_workbook_path(path)), path)
    ]
    reused_count = len(all_files) - len(files)
    if reused_count:
        print(f"reused {reused_count}/{len(all_files)} checkpointed workbook records", flush=True)

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
            record = finalize_workbook(
                path,
                excel,
                excel_initialization_error=excel_initialization_error,
                allow_stable_pending=args.allow_stable_pending,
            )
            attempt_count = 1
            if record.get("reason") == "excel_com_error":
                if excel is not None:
                    try:
                        excel.Quit()
                    except Exception:
                        pass
                    excel = None
                try:
                    excel, version = create_excel_application()
                    excel_initialization_error = None
                except Exception as exc:
                    excel_initialization_error = str(exc)
                attempt_count = 2
                record = finalize_workbook(
                    path,
                    excel,
                    excel_initialization_error=excel_initialization_error,
                    allow_stable_pending=args.allow_stable_pending,
                )
            record["excelAttemptCount"] = attempt_count
            records.append(record)
            append_checkpoint_record(checkpoint_path, record)
            if index % 20 == 0 or index == len(files):
                print(f"finalized {index}/{len(files)}", flush=True)
    finally:
        if excel is not None:
            try:
                excel.Quit()
            except Exception as exc:
                excel_quit_error = str(exc)

    merged_records = prior_records
    for record in records:
        merged_records[str(record["path"])] = record
    records = sorted(merged_records.values(), key=lambda record: str(record["path"]))
    status_counts = {
        status: sum(1 for record in records if record["status"] == status)
        for status in FINALIZATION_STATUSES
    }
    completed_count = status_counts["completed"] + status_counts["completed_stable_pending"]
    not_required_count = status_counts["not_required"]
    preserved_count = sum(status_counts[status] for status in PRESERVED_STATUSES)
    attempt_duration_ms = round((time.time() - started) * 1000)
    previous_duration_ms = int(previous_receipt.get("durationMs", 0)) if previous_receipt else 0
    receipt = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "engine": "Microsoft Excel COM fail-closed formula cache finalizer",
        "engineVersion": version,
        **({"excelInitializationError": excel_initialization_error} if excel_initialization_error else {}),
        **({"excelQuitError": excel_quit_error} if excel_quit_error else {}),
        "policy": {
            "macros": "disabled",
            "externalLinkUpdates": "disabled",
            "calculation": "CalculateFullRebuild",
            "calculationStateGate": (
                "state 0, or explicit opt-in with three identical cache reads while pending"
                if args.allow_stable_pending
                else "both beforeCacheRead and afterCacheRead must equal 0"
            ),
            "stablePendingOptIn": args.allow_stable_pending,
            "formulaTopology": (
                "normal, shared, array, and dataTable caches are patched with byte-identical formula-element proof; "
                "unknown types are preserved"
            ),
            "fallback": "none",
            "excelOpen": "normal read-only with repair-mode read-only fallback; Excel output is never saved",
            "persistence": "stage and compare-and-swap cached formula values without saving Excel's formula rewrites",
            "progressRecovery": "fsync each terminal workbook record to a reusable JSONL checkpoint",
        },
        "root": root.relative_to(Path.cwd()).as_posix(),
        "checkpointPath": checkpoint_path.relative_to(Path.cwd()).as_posix(),
        "reusedCheckpointCount": reused_count,
        "workbookCount": len(records),
        "terminalCount": len(records),
        "completedCount": completed_count,
        "notRequiredCount": not_required_count,
        "preservedCount": preserved_count,
        "statusCounts": status_counts,
        "refreshedCount": completed_count,
        "failureCount": len(records) - completed_count,
        "durationMs": previous_duration_ms + attempt_duration_ms,
        "lastAttemptDurationMs": attempt_duration_ms,
        "records": records,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {receipt_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
