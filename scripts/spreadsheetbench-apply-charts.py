from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.chart import (
    AreaChart,
    BarChart,
    BubbleChart,
    DoughnutChart,
    LineChart,
    PieChart,
    Reference,
    ScatterChart,
    Series,
)
from openpyxl.chart.label import DataLabelList
from openpyxl.utils.cell import range_boundaries


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply bounded chart operations to an existing XLSX workbook.")
    parser.add_argument("--workbook", required=True)
    parser.add_argument("--operations", required=True)
    parser.add_argument("--engine", choices=["auto", "excel", "openpyxl"], default="auto")
    args = parser.parse_args()

    workbook_path = Path(args.workbook).resolve()
    payload = json.loads(Path(args.operations).read_text(encoding="utf-8"))
    operations = [item for item in payload.get("operations", []) if item.get("op") == "add_chart"]
    engine = args.engine
    if engine == "auto":
        engine = "excel" if os.name == "nt" and excel_com_available() else "openpyxl"
    if engine == "excel":
        apply_with_excel_com(workbook_path, operations)
    else:
        apply_with_openpyxl(workbook_path, operations)
    print(json.dumps({"schema": 1, "appliedChartCount": len(operations), "workbook": workbook_path.name, "engine": engine}))
    return 0


def excel_com_available() -> bool:
    try:
        import win32com.client  # type: ignore  # noqa: F401
        return True
    except ImportError:
        return False


def apply_with_openpyxl(workbook_path: Path, operations: list[dict[str, Any]]) -> None:
    keep_vba = workbook_path.suffix.lower() == ".xlsm"
    workbook = load_workbook(workbook_path, keep_vba=keep_vba, keep_links=True)
    for operation in operations:
        apply_chart(workbook, operation)
    workbook.save(workbook_path)


def apply_with_excel_com(workbook_path: Path, operations: list[dict[str, Any]]) -> None:
    import win32com.client  # type: ignore

    excel = win32com.client.DispatchEx("Excel.Application")
    excel.Visible = False
    excel.DisplayAlerts = False
    excel.ScreenUpdating = False
    workbook = None
    try:
        workbook = excel.Workbooks.Open(str(workbook_path), UpdateLinks=0, ReadOnly=False)
        for operation in operations:
            apply_chart_com(workbook, operation)
        workbook.Save()
    finally:
        if workbook is not None:
            workbook.Close(SaveChanges=False)
        excel.Quit()


def apply_chart_com(workbook: Any, operation: dict[str, Any]) -> None:
    target_sheet = workbook.Worksheets(operation["sheet"])
    anchor = target_sheet.Range(operation.get("anchor") or "H2")
    width = bounded_number(operation.get("width"), 18, 6, 36) * 28
    height = bounded_number(operation.get("height"), 10, 4, 24) * 20
    chart_object = target_sheet.ChartObjects().Add(anchor.Left, anchor.Top, width, height)
    chart = chart_object.Chart
    chart.ChartType = chart_type_com(operation["chartType"], operation.get("grouping"))
    chart.HasTitle = True
    chart.ChartTitle.Text = operation.get("title") or "Chart"
    chart.HasLegend = operation.get("legendPosition", "right") != "none"
    if chart.HasLegend:
        chart.Legend.Position = {"top": -4160, "bottom": -4107, "left": -4131, "right": -4152}.get(
            operation.get("legendPosition", "right"), -4152
        )
    while chart.SeriesCollection().Count:
        chart.SeriesCollection(1).Delete()
    for series_spec in operation["series"][:12]:
        series = chart.SeriesCollection().NewSeries()
        series.Name = series_spec["name"]
        series.Values = range_com(workbook, series_spec["valuesRange"], operation["sheet"])
        series.XValues = range_com(
            workbook,
            series_spec.get("xValuesRange") or operation["categoryRange"],
            operation["sheet"],
        )
        if operation["chartType"] == "bubble":
            series.BubbleSizes = range_com(
                workbook,
                series_spec.get("sizeRange") or series_spec["valuesRange"],
                operation["sheet"],
            )
        if series_spec.get("chartType"):
            series.ChartType = chart_type_com(series_spec["chartType"], operation.get("grouping"))
        if series_spec.get("secondaryAxis"):
            series.AxisGroup = 2
        apply_series_color_com(series, series_spec.get("color"), series_spec.get("chartType") or operation["chartType"])
        if operation.get("dataLabels"):
            series.ApplyDataLabels()


def chart_type_com(chart_type: str, grouping: Any = None) -> int:
    if chart_type == "line":
        return 4
    if chart_type == "bar":
        return 59 if grouping == "percentStacked" else 58 if grouping == "stacked" else 57
    if chart_type == "column":
        return 53 if grouping == "percentStacked" else 52 if grouping == "stacked" else 51
    return {"pie": 5, "doughnut": -4120, "scatter": -4169, "area": 1, "bubble": 15}[chart_type]


def range_com(workbook: Any, spec: str, default_sheet: str) -> Any:
    sheet_name, cell_range = split_range(spec, default_sheet)
    return workbook.Worksheets(sheet_name).Range(cell_range)


def apply_series_color_com(series: Any, color: Any, chart_type: str) -> None:
    if not isinstance(color, str):
        return
    normalized = color.lstrip("#")[:6]
    if len(normalized) != 6:
        return
    red, green, blue = int(normalized[0:2], 16), int(normalized[2:4], 16), int(normalized[4:6], 16)
    excel_rgb = red + (green << 8) + (blue << 16)
    try:
        if chart_type in {"line", "scatter"}:
            series.Format.Line.ForeColor.RGB = excel_rgb
        else:
            series.Format.Fill.ForeColor.RGB = excel_rgb
    except Exception:
        pass


def apply_chart(workbook: Any, operation: dict[str, Any]) -> None:
    target_sheet = require_sheet(workbook, operation["sheet"])
    chart_type = operation["chartType"]
    chart = new_chart(chart_type)
    chart.title = operation.get("title") or "Chart"
    chart.style = 10
    chart.width = bounded_number(operation.get("width"), 18, 6, 36)
    chart.height = bounded_number(operation.get("height"), 10, 4, 24)

    categories = reference_for(workbook, operation["categoryRange"], operation["sheet"])
    for series_spec in operation["series"][:12]:
        values = reference_for(workbook, series_spec["valuesRange"], operation["sheet"])
        if chart_type in {"scatter", "bubble"}:
            x_values = reference_for(
                workbook,
                series_spec.get("xValuesRange") or operation["categoryRange"],
                operation["sheet"],
            )
            if chart_type == "bubble":
                sizes = reference_for(
                    workbook,
                    series_spec.get("sizeRange") or series_spec["valuesRange"],
                    operation["sheet"],
                )
                series = Series(values, x_values, sizes, title=series_spec["name"])
            else:
                series = Series(values, x_values, title=series_spec["name"])
        else:
            series = Series(values, title=series_spec["name"])
        apply_series_color(series, series_spec.get("color"), chart_type)
        chart.series.append(series)

    if chart_type not in {"scatter", "bubble"}:
        chart.set_categories(categories)
    if isinstance(chart, BarChart):
        chart.type = "bar" if chart_type == "bar" else "col"
        chart.grouping = operation.get("grouping") or "clustered"
        chart.overlap = 100 if chart.grouping in {"stacked", "percentStacked"} else 0
    legend = operation.get("legendPosition", "right")
    if legend == "none":
        chart.legend = None
    elif chart.legend is not None:
        chart.legend.position = {"top": "t", "bottom": "b", "left": "l", "right": "r"}.get(legend, "r")
    if operation.get("dataLabels"):
        chart.dLbls = DataLabelList()
        chart.dLbls.showVal = True
    target_sheet.add_chart(chart, operation.get("anchor") or "H2")


def new_chart(chart_type: str) -> Any:
    if chart_type == "line":
        return LineChart()
    if chart_type in {"bar", "column"}:
        return BarChart()
    if chart_type == "pie":
        return PieChart()
    if chart_type == "doughnut":
        return DoughnutChart()
    if chart_type == "scatter":
        return ScatterChart()
    if chart_type == "area":
        return AreaChart()
    if chart_type == "bubble":
        return BubbleChart()
    raise ValueError(f"unsupported chart type: {chart_type}")


def reference_for(workbook: Any, spec: str, default_sheet: str) -> Reference:
    sheet_name, cell_range = split_range(spec, default_sheet)
    sheet = require_sheet(workbook, sheet_name)
    min_col, min_row, max_col, max_row = range_boundaries(cell_range)
    return Reference(sheet, min_col=min_col, min_row=min_row, max_col=max_col, max_row=max_row)


def split_range(spec: str, default_sheet: str) -> tuple[str, str]:
    value = spec.strip().lstrip("=")
    if "!" not in value:
        return default_sheet, value.replace("$", "")
    sheet_name, cell_range = value.rsplit("!", 1)
    sheet_name = sheet_name.strip().strip("'").replace("''", "'")
    return sheet_name, cell_range.replace("$", "")


def require_sheet(workbook: Any, name: str) -> Any:
    if name not in workbook.sheetnames:
        raise ValueError(f"missing chart sheet: {name}")
    return workbook[name]


def bounded_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    if not isinstance(value, (int, float)):
        return fallback
    return max(minimum, min(maximum, float(value)))


def apply_series_color(series: Any, color: Any, chart_type: str) -> None:
    if not isinstance(color, str):
        return
    normalized = color.lstrip("#")[:6].upper()
    if len(normalized) != 6:
        return
    try:
        if chart_type in {"line", "scatter"}:
            series.graphicalProperties.line.solidFill = normalized
        else:
            series.graphicalProperties.solidFill = normalized
    except (AttributeError, TypeError, ValueError):
        pass


if __name__ == "__main__":
    raise SystemExit(main())
