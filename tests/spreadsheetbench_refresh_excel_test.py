from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "spreadsheetbench-refresh-excel.py"
MODULE_NAME = "spreadsheetbench_refresh_excel"
SPEC = importlib.util.spec_from_file_location(MODULE_NAME, SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"could not load {SCRIPT_PATH}")
refresh_excel = importlib.util.module_from_spec(SPEC)
sys.modules[MODULE_NAME] = refresh_excel
SPEC.loader.exec_module(refresh_excel)


WORKSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOCUMENT_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
WORKSHEET_REL_TYPE = f"{DOCUMENT_REL_NS}/worksheet"


def write_zip(
    path: Path,
    entries: list[tuple[str, str | bytes, bytes]],
    *,
    comment: bytes = b"",
) -> None:
    with zipfile.ZipFile(path, "w") as package:
        package.comment = comment
        for name, data, entry_comment in entries:
            info = zipfile.ZipInfo(name, date_time=(2020, 1, 2, 3, 4, 6))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.comment = entry_comment
            info.external_attr = 0o600 << 16
            package.writestr(info, data)


def write_minimal_workbook(path: Path, worksheet_xml: str) -> None:
    workbook_xml = (
        f'<workbook xmlns="{WORKSHEET_NS}" xmlns:r="{DOCUMENT_REL_NS}">'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>'
        "</workbook>"
    )
    relationships_xml = (
        f'<Relationships xmlns="{PACKAGE_REL_NS}">'
        f'<Relationship Id="rId1" Type="{WORKSHEET_REL_TYPE}" '
        'Target="worksheets/sheet1.xml"/>'
        "</Relationships>"
    )
    write_zip(
        path,
        [
            ("xl/workbook.xml", workbook_xml, b""),
            ("xl/_rels/workbook.xml.rels", relationships_xml, b""),
            ("xl/worksheets/sheet1.xml", worksheet_xml, b""),
        ],
    )


class FakeWorkbook:
    def __init__(self) -> None:
        self.closed = False

    def Close(self, *, SaveChanges: bool) -> None:
        if SaveChanges:
            raise AssertionError("finalizer must never save through Excel")
        self.closed = True


class FakeWorkbooks:
    def __init__(self, workbook: FakeWorkbook | None = None, error: Exception | None = None) -> None:
        self.workbook = workbook or FakeWorkbook()
        self.error = error
        self.open_count = 0
        self.opened_paths: list[Path] = []

    def Open(self, _path: str, **options: object) -> FakeWorkbook:
        self.open_count += 1
        self.opened_paths.append(Path(_path))
        if not Path(_path).is_absolute():
            raise AssertionError("finalizer must pass an absolute path to Excel COM")
        if options.get("ReadOnly") is not True:
            raise AssertionError("finalizer must open Excel read-only")
        if self.error:
            raise self.error
        return self.workbook


class FakeExcel:
    def __init__(self, states: list[int], *, open_error: Exception | None = None) -> None:
        self._states = iter(states)
        self.workbook = FakeWorkbook()
        self.Workbooks = FakeWorkbooks(self.workbook, open_error)
        self.calculate_count = 0

    @property
    def CalculationState(self) -> int:
        return next(self._states)

    def CalculateFullRebuild(self) -> None:
        self.calculate_count += 1


class FormulaCacheSerializationTests(unittest.TestCase):
    def assert_cache(self, value: object, cell_type: str | None, value_xml: str) -> None:
        self.assertEqual(
            refresh_excel.serialize_formula_cache(value),
            refresh_excel.FormulaCache(cell_type, value_xml),
        )

    def test_serializes_numbers_booleans_and_empty_values(self) -> None:
        self.assert_cache(None, None, "")
        self.assert_cache(True, "b", "1")
        self.assert_cache(False, "b", "0")
        self.assert_cache(0, None, "0")
        self.assert_cache(-42, None, "-42")
        self.assert_cache(1.25, None, "1.25")

    def test_serializes_classic_and_modern_excel_errors(self) -> None:
        for code, text in {
            2000: "#NULL!",
            2007: "#DIV/0!",
            2023: "#REF!",
            2042: "#N/A",
            2045: "#SPILL!",
            2049: "#DATA!",
            2053: "#PYTHON!",
        }.items():
            with self.subTest(code=code):
                self.assert_cache(code, "e", text)
                self.assert_cache(0x800A0000 | code, "e", text)

    def test_encodes_control_characters_cr_and_literal_excel_escapes(self) -> None:
        value = "<&\x00\x01\t\n\r\x0b> _x0041_ _X000D_"
        self.assert_cache(
            value,
            "str",
            "&lt;&amp;_x0000__x0001_\t\n_x000D__x000B_&gt; "
            "_x005F_x0041_ _x005F_X000D_",
        )

    def test_rejects_non_finite_numeric_values(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, "non-finite"):
                    refresh_excel.serialize_formula_cache(value)


class FormulaTargetDiscoveryTests(unittest.TestCase):
    def test_expands_known_formula_result_ranges_and_rejects_unknown_shapes(self) -> None:
        workbook_xml = (
            f'<workbook xmlns="{WORKSHEET_NS}" xmlns:r="{DOCUMENT_REL_NS}">'
            "<sheets>"
            '<sheet name="Relative formulas" sheetId="1" r:id="rIdRelative"/>'
            '<sheet name="Absolute formulas" sheetId="2" r:id="rIdAbsolute"/>'
            "</sheets>"
            "</workbook>"
        )
        relationships_xml = (
            f'<Relationships xmlns="{PACKAGE_REL_NS}">'
            f'<Relationship Id="rIdRelative" Type="{WORKSHEET_REL_TYPE}" '
            'Target="worksheets/relative.xml"/>'
            f'<Relationship Id="rIdAbsolute" Type="{WORKSHEET_REL_TYPE}" '
            'Target="/xl/custom/absolute.xml"/>'
            "</Relationships>"
        )
        relative_sheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData>'
            '<row r="2"><c r="b2"><f>1+1</f><v>2</v></c></row>'
            '<row r="3"><c r="$C$3"><f t="shared" ref="C3:C5" si="4">A3*2</f>'
            "<v>2</v></c></row>"
            '<row r="4"><c r="C4"><f t="shared" si="4"/><v>4</v></c></row>'
            '<row r="5"><c r="C5"><v>6</v></c></row>'
            '<row r="6"><c r="D6"><f t="array" ref="$D$6:$E$7">SEQUENCE(2,2)</f>'
            "<v>1</v></c><c r=\"E6\"/></row>"
            '<row r="7"><c r="D7"/><c r="E7"/></row>'
            "</sheetData></worksheet>"
        )
        absolute_sheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData>'
            '<row r="10"><c r="G10"><f t="dataTable" ref="$G$10:$H$11" '
            'dt2D="1"/><v>10</v></c><c r="H10"/></row>'
            '<row r="11"><c r="G11"/><c r="H11"/></row>'
            '<row r="12"><c r="J12"><f t="futureFormula">1+1</f><v>2</v></c></row>'
            "</sheetData></worksheet>"
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "formula-targets.xlsx"
            write_zip(
                workbook_path,
                [
                    ("xl/workbook.xml", workbook_xml, b""),
                    ("xl/_rels/workbook.xml.rels", relationships_xml, b""),
                    ("xl/worksheets/relative.xml", relative_sheet_xml, b""),
                    ("xl/custom/absolute.xml", absolute_sheet_xml, b""),
                ],
            )

            inspection = refresh_excel.inspect_formula_topology(workbook_path)

        self.assertEqual(
            inspection.formula_cells,
            {
                "Relative formulas": (
                    "xl/worksheets/relative.xml",
                    ["B2", "C3", "C4", "C5", "D6", "E6", "D7", "E7"],
                ),
                "Absolute formulas": (
                    "xl/custom/absolute.xml",
                    ["G10", "H11", "J12"],
                ),
            },
        )
        self.assertFalse(inspection.safe)
        self.assertEqual(inspection.formula_cell_count, 6)
        self.assertEqual(
            inspection.detail["counts"],
            {"normal": 1, "shared": 2, "array": 1, "dataTable": 1, "unknown": 1},
        )
        self.assertEqual(
            [item["type"] for item in inspection.detail["unsupported"]],
            ["unknown"],
        )
        self.assertEqual(inspection.detail["cacheTargetCellCount"], 11)
        self.assertIn("C5", inspection.formula_cells["Relative formulas"][1])

    def test_two_input_data_table_excludes_existing_headers_from_cache_targets(self) -> None:
        worksheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f t="dataTable" ref="A1:C3" dt2D="1" r1="E1" r2="E2"/>'
            '<v>#VALUE!</v></c><c r="B1" t="inlineStr"><is><t>Header B</t></is></c>'
            '<c r="C1" t="inlineStr"><is><t>Header C</t></is></c></row><row r="2">'
            '<c r="A2"><v>10</v></c><c r="B2"><v>1</v></c><c r="C2"><v>2</v></c>'
            '</row><row r="3"><c r="A3"><v>20</v></c><c r="B3"><v>3</v></c>'
            '<c r="C3"><v>4</v></c></row></sheetData></worksheet>'
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "data-table.xlsx"
            write_minimal_workbook(workbook_path, worksheet_xml)

            inspection = refresh_excel.inspect_formula_topology(workbook_path)

        self.assertEqual(
            inspection.formula_cells["Sheet1"][1],
            ["A1", "B2", "C2", "B3", "C3"],
        )
        self.assertNotIn("B1", inspection.formula_cells["Sheet1"][1])
        self.assertNotIn("A2", inspection.formula_cells["Sheet1"][1])

    def test_data_table_never_rewrites_inline_string_results(self) -> None:
        worksheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f t="dataTable" ref="A1:B2" dt2D="1" r1="D1" r2="D2"/>'
            '<v>#VALUE!</v></c><c r="B1"><v>1</v></c></row><row r="2">'
            '<c r="A2"><v>2</v></c><c r="B2" t="inlineStr"><is><t>2.4x/19%</t></is>'
            '</c></row></sheetData></worksheet>'
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "inline-data-table.xlsx"
            write_minimal_workbook(workbook_path, worksheet_xml)

            inspection = refresh_excel.inspect_formula_topology(workbook_path)

        self.assertEqual(inspection.formula_cells["Sheet1"][1], ["A1"])

    def test_sparse_formula_areas_keep_tight_excel_range_bounds(self) -> None:
        addresses = [
            "XFD1048576",
            "B2",
            "A1",
            "F4",
            "B1",
            "A2",
            "D4",
            "A1",
        ]

        self.assertEqual(
            refresh_excel.contiguous_formula_areas(addresses),
            [
                (1, 2, 1, 2),
                (4, 4, 4, 4),
                (4, 4, 6, 6),
                (1048576, 1048576, 16384, 16384),
            ],
        )
        self.assertEqual(refresh_excel.contiguous_formula_areas([]), [])


class ReceiptStatusTests(unittest.TestCase):
    def test_only_completed_statuses_are_accepted_without_retry(self) -> None:
        self.assertTrue(refresh_excel.is_accepted_finalization_status("completed"))
        self.assertTrue(refresh_excel.is_accepted_finalization_status("completed_stable_pending"))
        for status in refresh_excel.FINALIZATION_STATUSES:
            if status not in {"completed", "completed_stable_pending"}:
                self.assertFalse(refresh_excel.is_accepted_finalization_status(status))


class CheckpointRecoveryTests(unittest.TestCase):
    def test_checkpoint_loader_keeps_latest_record_per_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            checkpoint_path = Path(temp_dir) / "refresh.checkpoint.jsonl"
            refresh_excel.append_checkpoint_record(
                checkpoint_path,
                {"path": "Debugging/example.xlsx", "status": "failed", "afterSha256": "old"},
            )
            refresh_excel.append_checkpoint_record(
                checkpoint_path,
                {"path": "Debugging/example.xlsx", "status": "completed", "afterSha256": "new"},
            )

            records = refresh_excel.load_checkpoint_records(checkpoint_path)

            self.assertEqual(records["Debugging/example.xlsx"]["status"], "completed")
            self.assertEqual(len(checkpoint_path.read_text(encoding="utf-8").splitlines()), 2)

    def test_checkpoint_reuse_requires_accepted_status_and_matching_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "example.xlsx"
            write_minimal_workbook(
                workbook_path,
                f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData /></worksheet>',
            )
            workbook_hash = refresh_excel.sha256_file(workbook_path)

            self.assertTrue(
                refresh_excel.accepted_record_matches_workbook(
                    {"status": "completed", "afterSha256": workbook_hash},
                    workbook_path,
                )
            )
            self.assertFalse(
                refresh_excel.accepted_record_matches_workbook(
                    {"status": "completed", "afterSha256": "stale"},
                    workbook_path,
                )
            )
            self.assertFalse(
                refresh_excel.accepted_record_matches_workbook(
                    {"status": "preserved_after_error", "afterSha256": workbook_hash},
                    workbook_path,
                )
            )

    def test_malformed_checkpoint_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            checkpoint_path = Path(temp_dir) / "refresh.checkpoint.jsonl"
            checkpoint_path.write_text('{"path":"example.xlsx"}\nnot-json\n', encoding="utf-8")

            with self.assertRaises(RuntimeError):
                refresh_excel.load_checkpoint_records(checkpoint_path)


class FailClosedFinalizationTests(unittest.TestCase):
    def make_formula_workbook(self, path: Path, formula_xml: str = "<f>40+2</f>") -> None:
        worksheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            f'<c r="A1">{formula_xml}<v>stale</v></c>'
            "</row></sheetData></worksheet>"
        )
        write_minimal_workbook(path, worksheet_xml)

    def assert_preserved(self, path: Path, before: bytes, record: dict[str, object]) -> None:
        self.assertIn(record["status"], refresh_excel.PRESERVED_STATUSES)
        self.assertFalse(record["changed"])
        self.assertEqual(record["beforeSha256"], record["afterSha256"])
        self.assertEqual(path.read_bytes(), before)

    def test_only_zero_before_and_after_cache_read_can_patch(self) -> None:
        for states, expected_reads in [([2, 2], 0), ([2, 0], 0), ([0, 2], 1), ([0, 1], 1)]:
            with self.subTest(states=states), tempfile.TemporaryDirectory() as temp_dir:
                workbook_path = Path(temp_dir) / "pending.xlsx"
                self.make_formula_workbook(workbook_path)
                before = workbook_path.read_bytes()
                excel = FakeExcel(states)
                with patch.object(
                    refresh_excel,
                    "collect_formula_values",
                    return_value={"Sheet1": {"A1": 42}},
                ) as collect_values:
                    record = refresh_excel.finalize_workbook(workbook_path, excel)

                self.assertEqual(record["status"], "preserved_pending")
                self.assertEqual(record["reason"], "excel_calculation_state_not_done")
                self.assertEqual(
                    record["calculationStates"],
                    {"beforeCacheRead": states[0], "afterCacheRead": states[1]},
                )
                self.assertEqual(collect_values.call_count, expected_reads)
                self.assert_preserved(workbook_path, before, record)

    def test_zero_before_and_after_cache_read_completes_atomic_patch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "completed.xlsx"
            self.make_formula_workbook(workbook_path)
            excel = FakeExcel([0, 0])
            with patch.object(
                refresh_excel,
                "collect_formula_values",
                return_value={"Sheet1": {"A1": 42}},
            ):
                record = refresh_excel.finalize_workbook(workbook_path, excel)

            self.assertEqual(record["status"], "completed")
            self.assertEqual(record["transactionMode"], "staged_compare_and_swap")
            self.assertEqual(record["transactionAttemptCount"], 1)
            self.assertNotEqual(excel.Workbooks.opened_paths, [workbook_path.resolve()])
            self.assertEqual(record["reason"], "excel_calculation_done_and_supported_topology")
            self.assertTrue(record["changed"])
            self.assertNotEqual(record["beforeSha256"], record["afterSha256"])
            self.assertEqual(
                record["calculationStates"],
                {"beforeCacheRead": 0, "afterCacheRead": 0},
            )
            self.assertTrue(record["formulaTopology"]["safe"])
            self.assertTrue(record["formulaTopologyPreservation"]["matched"])
            self.assertEqual(record["formulaTopologyPreservation"]["formulaElementCount"], 1)
            with zipfile.ZipFile(workbook_path, "r") as package:
                worksheet = package.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn("<f>40+2</f><v>42</v>", worksheet)

    def test_normal_open_failure_uses_read_only_repair_without_saving_excel_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "repair-open.xlsx"
            self.make_formula_workbook(workbook_path)
            excel = FakeExcel([0, 0])
            normal_open = excel.Workbooks.Open
            open_options: list[dict[str, object]] = []

            def open_with_repair(path: str, **options: object) -> FakeWorkbook:
                open_options.append(options)
                if options.get("CorruptLoad") != 1:
                    raise RuntimeError("normal Excel open failed")
                return normal_open(path, **options)

            excel.Workbooks.Open = open_with_repair  # type: ignore[method-assign]
            with patch.object(
                refresh_excel,
                "collect_formula_values",
                return_value={"Sheet1": {"A1": 42}},
            ):
                record = refresh_excel.finalize_workbook(workbook_path, excel)

            self.assertEqual(record["status"], "completed")
            self.assertEqual(record["openMode"], "repair_read_only")
            self.assertIn("normal Excel open failed", record["normalOpenError"])
            self.assertEqual(len(open_options), 2)
            self.assertNotIn("CorruptLoad", open_options[0])
            self.assertEqual(open_options[1]["CorruptLoad"], 1)
            self.assertTrue(all(options["ReadOnly"] is True for options in open_options))
            self.assertTrue(excel.workbook.closed)

    def test_staged_commit_retries_when_source_changes_concurrently(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "concurrent.xlsx"
            self.make_formula_workbook(workbook_path)
            replacement_xml = (
                f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
                '<c r="A1"><f>84/2</f><v>42</v></c>'
                "</row></sheetData></worksheet>"
            )
            replacement_path = Path(temp_dir) / "replacement.xlsx"
            write_minimal_workbook(replacement_path, replacement_xml)
            replacement_bytes = replacement_path.read_bytes()
            calls = 0

            def finalize_staging(staging_path: Path, _excel, **_kwargs: object) -> dict[str, object]:
                nonlocal calls
                calls += 1
                before_sha256 = refresh_excel.sha256_file(staging_path)
                if calls == 1:
                    workbook_path.write_bytes(replacement_bytes)
                return {
                    "path": staging_path.as_posix(),
                    "beforeSha256": before_sha256,
                    "afterSha256": before_sha256,
                    "status": "completed",
                    "changed": False,
                }

            with patch.object(refresh_excel, "_finalize_workbook_staged", side_effect=finalize_staging):
                record = refresh_excel.finalize_workbook(workbook_path, FakeExcel([]))

            self.assertEqual(calls, 2)
            self.assertEqual(record["transactionAttemptCount"], 2)
            self.assertEqual(record["beforeSha256"], refresh_excel.sha256_file(workbook_path))
            self.assertEqual(workbook_path.read_bytes(), replacement_bytes)

    def test_opt_in_three_stable_pending_reads_completes_atomic_patch(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "stable-pending.xlsx"
            self.make_formula_workbook(workbook_path)
            excel = FakeExcel([2, 2])
            stable_values = {"Sheet1": {"A1": 42}}
            with (
                patch.object(
                    refresh_excel,
                    "collect_formula_values",
                    side_effect=[stable_values, stable_values, stable_values],
                ) as collect_values,
                patch.object(refresh_excel.time, "sleep", return_value=None),
            ):
                record = refresh_excel.finalize_workbook(
                    workbook_path,
                    excel,
                    allow_stable_pending=True,
                )

            self.assertEqual(collect_values.call_count, 3)
            self.assertEqual(record["status"], "completed_stable_pending")
            self.assertEqual(record["reason"], "excel_cache_values_stable_while_calculation_pending")
            self.assertEqual(record["calculationStateGate"], "accepted_stable_pending")
            self.assertEqual(record["calculationStates"], {"beforeCacheRead": 2, "afterCacheRead": 2})
            self.assertEqual(
                record["calculationStability"],
                {
                    "mode": "stable_pending_opt_in",
                    "passed": True,
                    "requiredIdenticalReads": 3,
                    "observedIdenticalReads": 3,
                    "observedReads": 3,
                    "sampleIntervalMs": 250,
                    "timeoutMs": 10000,
                },
            )
            self.assertTrue(record["changed"])
            self.assertTrue(record["formulaTopologyPreservation"]["matched"])
            with zipfile.ZipFile(workbook_path, "r") as package:
                worksheet = package.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn("<f>40+2</f><v>42</v>", worksheet)

    def test_opt_in_pending_cache_without_stability_still_preserves(self) -> None:
        record: dict[str, object] = {}
        excel = FakeExcel([2, 2])
        with patch.object(
            refresh_excel,
            "collect_formula_values",
            return_value={"Sheet1": {"A1": 42}},
        ):
            with self.assertRaises(refresh_excel.ExcelCalculationPending):
                refresh_excel.collect_formula_values_with_state_gate(
                    excel,
                    excel.workbook,
                    {"Sheet1": ("xl/worksheets/sheet1.xml", ["A1"])},
                    record,
                    allow_stable_pending=True,
                    sample_interval_seconds=0,
                    timeout_seconds=0,
                )

        self.assertEqual(record["calculationStateGate"], "preserved_pending")
        self.assertFalse(record["calculationStability"]["passed"])

    def test_unknown_topology_preserves_without_opening_excel(self) -> None:
        formula_xml = (
            '<f t="shared" si="1">1+1</f></c><c r="B1">'
            '<f t="array" ref="B1:B2">SEQUENCE(2)</f></c><c r="C1">'
            '<f t="dataTable" ref="C1:D2"/></c><c r="D1">'
            '<f t="futureFormula">2+2</f>'
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "unsupported.xlsx"
            self.make_formula_workbook(workbook_path, formula_xml)
            before = workbook_path.read_bytes()
            excel = FakeExcel([])

            record = refresh_excel.finalize_workbook(workbook_path, excel)

            self.assertEqual(record["status"], "preserved_unsupported")
            self.assertEqual(record["reason"], "unsupported_formula_topology")
            self.assertEqual(excel.Workbooks.open_count, 0)
            self.assertEqual(
                record["formulaTopology"]["counts"],
                {"normal": 0, "shared": 1, "array": 1, "dataTable": 1, "unknown": 1},
            )
            self.assertEqual(
                [item["type"] for item in record["formulaTopology"]["unsupported"]],
                ["unknown"],
            )
            self.assert_preserved(workbook_path, before, record)

    def test_known_shared_array_and_data_table_topology_patches_only_caches(self) -> None:
        worksheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f t="shared" ref="A1:A2" si="1">ROW()</f><v>0</v></c>'
            '<c r="B1"><f t="array" ref="B1:C1">SEQUENCE(1,2)</f><v>0</v></c>'
            '<c r="C1"><v>0</v></c>'
            '<c r="D1"><f t="dataTable" ref="D1:E1"/><v>0</v></c>'
            '<c r="E1"><v>0</v></c></row><row r="2">'
            '<c r="A2"><f t="shared" si="1"/><v>0</v></c>'
            '</row></sheetData></worksheet>'
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "known-topologies.xlsx"
            write_minimal_workbook(workbook_path, worksheet_xml)
            topology_before = refresh_excel.formula_topology_fingerprint(workbook_path)
            values = {
                "Sheet1": {
                    "A1": 1,
                    "A2": 2,
                    "B1": 10,
                    "C1": 20,
                    "D1": 30,
                    "E1": 40,
                }
            }
            with patch.object(refresh_excel, "collect_formula_values", return_value=values):
                record = refresh_excel.finalize_workbook(workbook_path, FakeExcel([0, 0]))

            topology_after = refresh_excel.formula_topology_fingerprint(workbook_path)
            self.assertEqual(record["status"], "completed")
            self.assertTrue(record["formulaTopology"]["safe"])
            self.assertEqual(record["formulaTopology"]["cacheTargetCellCount"], 5)
            self.assertEqual(topology_before, topology_after)
            self.assertEqual(
                record["formulaTopologyPreservation"],
                {
                    "matched": True,
                    "beforeSha256": topology_before["sha256"],
                    "afterSha256": topology_after["sha256"],
                    "formulaElementCount": 4,
                },
            )

    def test_com_and_package_read_errors_are_terminal_preservations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workbook_path = root / "com-error.xlsx"
            self.make_formula_workbook(workbook_path)
            before = workbook_path.read_bytes()

            com_record = refresh_excel.finalize_workbook(
                workbook_path,
                FakeExcel([], open_error=RuntimeError("COM unavailable")),
            )

            self.assertEqual(com_record["status"], "preserved_error")
            self.assertEqual(com_record["reason"], "excel_com_error")
            self.assertIn("COM unavailable", com_record["excelError"])
            self.assert_preserved(workbook_path, before, com_record)

            invalid_path = root / "invalid.xlsx"
            invalid_path.write_bytes(b"not-an-ooxml-package")
            invalid_before = invalid_path.read_bytes()
            package_record = refresh_excel.finalize_workbook(invalid_path, FakeExcel([]))

            self.assertEqual(package_record["status"], "preserved_error")
            self.assertEqual(package_record["reason"], "package_read_error")
            self.assertIn("packageReadError", package_record)
            self.assert_preserved(invalid_path, invalid_before, package_record)

    def test_no_formulas_still_require_excel_open_evidence(self) -> None:
        worksheet_xml = f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData/></worksheet>'
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "no-formulas.xlsx"
            write_minimal_workbook(workbook_path, worksheet_xml)
            before = workbook_path.read_bytes()

            record = refresh_excel.finalize_workbook(
                workbook_path,
                None,
                excel_initialization_error="Excel is unavailable",
            )

            self.assertEqual(record["status"], "preserved_error")
            self.assertEqual(record["reason"], "excel_initialization_error")
            self.assertEqual(record["formulaCellCount"], 0)
            self.assertFalse(record["changed"])
            self.assertEqual(record["beforeSha256"], record["afterSha256"])
            self.assertEqual(workbook_path.read_bytes(), before)


class WorksheetCachePatchingTests(unittest.TestCase):
    def test_repairs_only_inline_string_cache_conflicts(self) -> None:
        source_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1" s="2" t="e"><is><t>2.4x/19%</t></is><v>#VALUE!</v></c>'
            '<c r="B1" t="inlineStr"><is><t>keep</t></is></c>'
            '<c r="C1"><f>1+1</f><v>2</v></c>'
            '</row></sheetData></worksheet>'
        )

        repaired_xml, addresses = refresh_excel.repair_worksheet_inline_string_cache_conflicts(source_xml)

        self.assertEqual(addresses, {"A1"})
        self.assertIn('<c r="A1" s="2" t="inlineStr"><is><t>2.4x/19%</t></is></c>', repaired_xml)
        self.assertIn('<c r="B1" t="inlineStr"><is><t>keep</t></is></c>', repaired_xml)
        self.assertIn('<c r="C1"><f>1+1</f><v>2</v></c>', repaired_xml)

    def test_collapses_identical_duplicate_value_caches_and_rejects_conflicts(self) -> None:
        source_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f>1+1</f><v>2</v><v>2</v></c>'
            '<c r="B1"><f>2+2</f><v>3</v><v>4</v></c>'
            '<c r="C1" t="str"><f>D1</f><v>keep  </v><v xml:space="preserve">keep  </v></c>'
            '<c r="D1"><v>keep</v></c>'
            '</row></sheetData></worksheet>'
        )

        repaired_xml, repaired, ambiguous = refresh_excel.repair_worksheet_duplicate_value_caches(source_xml)

        self.assertEqual(repaired, {"A1", "C1"})
        self.assertEqual(ambiguous, {"B1"})
        self.assertIn('<c r="A1"><f>1+1</f><v>2</v></c>', repaired_xml)
        self.assertIn('<c r="B1"><f>2+2</f><v>3</v><v>4</v></c>', repaired_xml)
        self.assertIn('<c r="C1" t="str"><f>D1</f><v xml:space="preserve">keep  </v></c>', repaired_xml)
        self.assertIn('<c r="D1"><v>keep</v></c>', repaired_xml)

    def test_formula_cache_patch_replaces_all_existing_cache_nodes_with_one(self) -> None:
        source_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f>40+2</f><v>stale</v><v>stale</v></c>'
            '</row></sheetData></worksheet>'
        )

        patched_xml, addresses = refresh_excel.patch_worksheet_formula_caches(source_xml, {"A1": 42})

        self.assertEqual(addresses, {"A1"})
        self.assertEqual(patched_xml.count("<v>42</v>"), 1)
        self.assertNotIn("stale", patched_xml)

        unchanged_xml, unchanged_addresses = refresh_excel.patch_worksheet_formula_caches(
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1"><f>40+2</f><v>42</v></c>'
            '</row></sheetData></worksheet>',
            {"A1": 42},
        )
        self.assertEqual(unchanged_addresses, {"A1"})
        self.assertEqual(unchanged_xml.count("<v>42</v>"), 1)

    def test_patches_formula_shapes_without_rewriting_unrelated_xml(self) -> None:
        source_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<ss:worksheet xmlns:ss="{WORKSHEET_NS}"><ss:sheetData><!--keep--><ss:row r="1">'
            '<ss:c r="A1" s="7" t="str"><ss:f t="shared" ref="A1:A2" si="0">'
            'SUM( A3:A4 )&amp;&lt;literal&gt;</ss:f>'
            '<ss:v xml:space="preserve">stale-anchor</ss:v><ss:ext marker="keep"/></ss:c>'
            '<ss:c r="A2" t="n"><ss:f t="shared" si="0"/><ss:v/></ss:c>'
            '<ss:c r="B2" s="2"/>'
            '<ss:c r="C3"><ss:f>UNTOUCHED()</ss:f><ss:v>99</ss:v></ss:c>'
            "</ss:row></ss:sheetData><ss:extLst><ss:ext uri=\"keep-me\"/></ss:extLst>"
            "</ss:worksheet>"
        )
        expected_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f'<ss:worksheet xmlns:ss="{WORKSHEET_NS}"><ss:sheetData><!--keep--><ss:row r="1">'
            '<ss:c r="A1" s="7"><ss:f t="shared" ref="A1:A2" si="0">'
            'SUM( A3:A4 )&amp;&lt;literal&gt;</ss:f>'
            '<ss:v xml:space="preserve">12.5</ss:v><ss:ext marker="keep"/></ss:c>'
            '<ss:c r="A2" t="b"><ss:f t="shared" si="0"/><ss:v>0</ss:v></ss:c>'
            '<ss:c r="B2" s="2" t="str"><ss:v>ready &amp; waiting</ss:v></ss:c>'
            '<ss:c r="C3"><ss:f>UNTOUCHED()</ss:f><ss:v>99</ss:v></ss:c>'
            "</ss:row></ss:sheetData><ss:extLst><ss:ext uri=\"keep-me\"/></ss:extLst>"
            "</ss:worksheet>"
        )

        patched_xml, patched_addresses = refresh_excel.patch_worksheet_formula_caches(
            source_xml,
            {"A1": 12.5, "A2": False, "B2": "ready & waiting"},
        )

        self.assertEqual(patched_addresses, {"A1", "A2", "B2"})
        self.assertEqual(patched_xml, expected_xml)


class WorkbookPackagePatchingTests(unittest.TestCase):
    def make_workbook(self, path: Path) -> str:
        worksheet_xml = (
            f'<worksheet xmlns="{WORKSHEET_NS}"><sheetData><row r="1">'
            '<c r="A1" s="3"><f>40+2</f><v>stale</v></c>'
            '<c r="B1"><v>unrelated</v></c>'
            "</row></sheetData></worksheet>"
        )
        write_zip(
            path,
            [
                ("[Content_Types].xml", "<Types/>", b"types-entry-comment"),
                ("xl/workbook.xml", "<workbook/>", b""),
                ("xl/worksheets/sheet1.xml", worksheet_xml, b"sheet-entry-comment"),
                ("docProps/custom.bin", b"\x00\x01unchanged\xff", b"binary-entry-comment"),
            ],
            comment=b"workbook archive comment",
        )
        return worksheet_xml

    def test_preserves_zip_entries_comments_and_unrelated_content(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "book.xlsx"
            original_worksheet = self.make_workbook(workbook_path)
            with zipfile.ZipFile(workbook_path, "r") as package:
                original_names = package.namelist()
                original_comment = package.comment
                original_binary = package.read("docProps/custom.bin")
                original_entry_comments = {
                    info.filename: info.comment for info in package.infolist()
                }

            refresh_excel.patch_formula_caches(
                workbook_path,
                {"Sheet 1": ("xl/worksheets/sheet1.xml", ["A1"])},
                {"Sheet 1": {"A1": 42}},
                expected_sha256=refresh_excel.sha256_file(workbook_path),
            )

            with zipfile.ZipFile(workbook_path, "r") as package:
                patched_worksheet = package.read("xl/worksheets/sheet1.xml").decode("utf-8")
                self.assertEqual(package.namelist(), original_names)
                self.assertEqual(package.comment, original_comment)
                self.assertEqual(package.read("docProps/custom.bin"), original_binary)
                self.assertEqual(
                    {info.filename: info.comment for info in package.infolist()},
                    original_entry_comments,
                )
                self.assertIsNone(package.testzip())

        self.assertNotEqual(patched_worksheet, original_worksheet)
        self.assertIn("<f>40+2</f><v>42</v>", patched_worksheet)
        self.assertIn('<c r="B1"><v>unrelated</v></c>', patched_worksheet)

    def test_rejects_stale_expected_sha_without_modifying_the_workbook(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workbook_path = Path(temp_dir) / "book.xlsx"
            self.make_workbook(workbook_path)
            stale_sha = refresh_excel.sha256_file(workbook_path)
            with workbook_path.open("ab") as stream:
                stream.write(b"changed-after-hash")
            bytes_before_patch_attempt = workbook_path.read_bytes()

            with self.assertRaisesRegex(RuntimeError, "changed before cache patching"):
                refresh_excel.patch_formula_caches(
                    workbook_path,
                    {"Sheet 1": ("xl/worksheets/sheet1.xml", ["A1"])},
                    {"Sheet 1": {"A1": 42}},
                    expected_sha256=stale_sha,
                )

            self.assertEqual(workbook_path.read_bytes(), bytes_before_patch_attempt)
            self.assertEqual([path.name for path in Path(temp_dir).iterdir()], ["book.xlsx"])


class WorkbookSelectionTests(unittest.TestCase):
    def test_selects_one_explicit_candidate_without_output_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            candidate = root / "candidate-input.xlsx"
            candidate.write_bytes(b"xlsx")

            selected_root, files = refresh_excel.select_workbooks(None, str(candidate))

        self.assertEqual(selected_root, candidate.parent.resolve())
        self.assertEqual(files, [candidate.resolve()])

    def test_directory_mode_keeps_the_official_output_filename_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            expected = root / "nested" / "01_output.xlsx"
            expected.parent.mkdir()
            expected.write_bytes(b"xlsx")
            (root / "candidate.xlsx").write_bytes(b"xlsx")

            selected_root, files = refresh_excel.select_workbooks(str(root), None)

        self.assertEqual(selected_root, root.resolve())
        self.assertEqual(files, [expected.resolve()])

    def test_rejects_ambiguous_or_invalid_sources(self) -> None:
        with self.assertRaisesRegex(ValueError, "exactly one"):
            refresh_excel.select_workbooks(None, None)
        with self.assertRaisesRegex(ValueError, "exactly one"):
            refresh_excel.select_workbooks(".", "candidate.xlsx")
        with self.assertRaisesRegex(ValueError, "existing .xlsx"):
            refresh_excel.select_workbooks(None, "missing.xlsx")


if __name__ == "__main__":
    unittest.main()
