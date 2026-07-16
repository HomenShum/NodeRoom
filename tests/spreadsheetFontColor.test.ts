import { describe, expect, it } from "vitest";
import {
  normalizeSpreadsheetFontColor,
  resolveSpreadsheetFontColor,
  spreadsheetFontColorToCss,
  spreadsheetThemeIndexForColor,
  spreadsheetThemePalette,
} from "../src/shared/spreadsheetFontColor";

describe("spreadsheet font color", () => {
  it.each([
    ["112233", "FF112233"],
    ["#a1b2c3", "FFA1B2C3"],
    ["80112233", "80112233"],
    ["#00abcdef", "00ABCDEF"],
  ])("normalizes %s to canonical ARGB", (input, expected) => {
    expect(normalizeSpreadsheetFontColor(input)).toBe(expected);
  });

  it.each(["red", "rgb(1, 2, 3)", "#12345", "1234567", "#GG1122", "", null, 0])(
    "rejects unsupported color %s",
    (input) => {
      expect(normalizeSpreadsheetFontColor(input)).toBeUndefined();
    },
  );

  it("converts ARGB to CSS while preserving non-opaque alpha", () => {
    expect(spreadsheetFontColorToCss("FF112233")).toBe("#112233");
    expect(spreadsheetFontColorToCss("80112233")).toBe("#11223380");
    expect(spreadsheetFontColorToCss("red")).toBeUndefined();
  });

  const theme = `<?xml version="1.0"?><a:theme xmlns:a="urn:test"><a:themeElements><a:clrScheme name="Test">
    <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
    <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
    <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
    <a:accent6><a:srgbClr val="4EA72E"/></a:accent6>
  </a:clrScheme></a:themeElements></a:theme>`;

  it("maps Office theme slots to spreadsheet theme indices", () => {
    const palette = spreadsheetThemePalette(theme);
    expect(palette.get(0)).toBe("FFFFFFFF");
    expect(palette.get(1)).toBe("FF000000");
    expect(palette.get(4)).toBe("FF4472C4");
    expect(palette.get(9)).toBe("FF4EA72E");
  });

  it("resolves explicit, themed, tinted, and indexed colors", () => {
    expect(resolveSpreadsheetFontColor({ argb: "00ff00" }, theme)).toBe("FF00FF00");
    expect(resolveSpreadsheetFontColor({ theme: 9 }, theme)).toBe("FF4EA72E");
    expect(resolveSpreadsheetFontColor({ theme: 1, tint: 0.5 }, theme)).toBe("FF808080");
    expect(resolveSpreadsheetFontColor({ indexed: 4 }, theme)).toBe("FF0000FF");
    expect(resolveSpreadsheetFontColor({ theme: 99 }, theme)).toBeUndefined();
    expect(spreadsheetThemeIndexForColor("FF4EA72E", theme)).toBe(9);
    expect(spreadsheetThemeIndexForColor("FF123456", theme)).toBeUndefined();
  });
});
