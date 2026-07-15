from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


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
    def test_discovers_formula_shapes_and_resolves_sheet_relationships(self) -> None:
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

            targets = refresh_excel.workbook_formula_cells(workbook_path)

        self.assertEqual(
            targets,
            {
                "Relative formulas": (
                    "xl/worksheets/relative.xml",
                    ["B2", "C3", "C4", "D6", "E6", "D7", "E7"],
                ),
                "Absolute formulas": (
                    "xl/custom/absolute.xml",
                    ["G10", "H10", "G11", "H11"],
                ),
            },
        )
        self.assertNotIn("C5", targets["Relative formulas"][1])

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


class WorksheetCachePatchingTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
