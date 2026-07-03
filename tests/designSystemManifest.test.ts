import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditNodeRoomDesignSystem,
  designSystemFiles,
  getNodeRoomDesignManifest,
} from "../src/design/designSystem";

function currentDesignFiles(): Record<string, string> {
  return Object.fromEntries(designSystemFiles.map((file) => [file, readFileSync(file, "utf8")]));
}

describe("NodeRoom design-system manifest", () => {
  it("documents the Astryx-inspired agent workflow without adding styling lock-in", () => {
    const manifest = getNodeRoomDesignManifest();

    expect(manifest.type).toBe("noderoom.design-system.manifest");
    expect(manifest.data.inspiration.map((item) => item.source)).toContain("facebook/astryx");
    expect(manifest.data.principles).toContain("Receipts are product objects, not status-bar prose.");
    expect(manifest.data.components.map((component) => component.name)).toEqual([
      "SheetGrid",
      "ReceiptChips",
      "IdentityChips",
      "WalkthroughDock",
      "ScaleBinder",
    ]);
  });

  it("passes against the current production UI surfaces", () => {
    const result = auditNodeRoomDesignSystem(currentDesignFiles(), "2026-07-03T00:00:00.000Z");

    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("catches the regressions that made the prod grid read as AI-generated", () => {
    const files = currentDesignFiles();
    files["src/app/styles.css"] = files["src/app/styles.css"]
      .replace(".r-cell.sel, .r-cell.editing { outline: 2px solid var(--accent-primary)", ".r-cell.sel, .r-cell.editing { outline: 2px solid rgb(46, 158, 107)")
      .replace(
        ".r-sheet[data-sheet-kind=\"generic\"] td.r-cell .r-cell-value { display: block; min-width: 0; max-width: 100%; white-space: nowrap; overflow: hidden; overflow-wrap: normal; text-overflow: ellipsis;",
        ".r-sheet[data-sheet-kind=\"generic\"] td.r-cell .r-cell-value { display: block; min-width: 0; max-width: 100%; word-break: break-all;"
      );
    files["src/ui/Chat.tsx"] = files["src/ui/Chat.tsx"].replace('data-testid="agent-lock-released-receipt"', 'data-testid="agent-lock-hidden"');
    files["src/ui/RoomShell.tsx"] = files["src/ui/RoomShell.tsx"].replace("Attention overlay", "Focus Mode");
    files["src/ui/LeftRail.tsx"] = files["src/ui/LeftRail.tsx"].replace('data-testid="binder-search"', 'data-testid="binder-search-missing"');
    files["src/ui/panels/Artifact.tsx"] = files["src/ui/panels/Artifact.tsx"]
      .replace('data-testid="grid-render-window"', 'data-testid="grid-render-window-missing"')
      .replace("const hasEvidence = !isScaleSheet &&", "const hasEvidence =")
      .replace("&& !isGenericSourceColumn(col)", "")
      .replace("function scaleColumnWidth", "function compressedColumnWidth");
    files["src/app/styles.css"] = files["src/app/styles.css"]
      .replace(".r-sheet-wrap[data-scale-sheet=\"true\"] .r-focus-box[data-focus-kind=\"evidence\"]", ".r-sheet-wrap[data-scale-sheet=\"true\"] .r-focus-box[data-focus-kind=\"source-noise\"]")
      .replace(".r-sheet[data-scale-sheet=\"true\"] td.r-cell.evidence", ".r-sheet[data-scale-sheet=\"true\"] td.r-cell.receipt-noise");

    const result = auditNodeRoomDesignSystem(files, "2026-07-03T00:00:00.000Z");
    const codes = result.findings.map((finding) => finding.code);

    expect(result.ok).toBe(false);
    expect(codes).toContain("sheet-ellipsis");
    expect(codes).toContain("sheet-selection-success");
    expect(codes).toContain("agent-lock-released-receipt");
    expect(codes).toContain("focus-mode-duplicate-label");
    expect(codes).toContain("binder-search");
    expect(codes).toContain("grid-render-window");
    expect(codes).toContain("scale-passive-evidence-gate");
    expect(codes).toContain("scale-source-receipt-dedupe");
    expect(codes).toContain("scale-column-widths");
    expect(codes).toContain("scale-evidence-overlay-css");
    expect(codes).toContain("scale-evidence-calm-css");
  });
});
