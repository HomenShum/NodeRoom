import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditDesignTokenDrift,
  auditNodeRoomDesignSystem,
  buildAllowedHexSet,
  canonicalTokenFile,
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
      "SharedDialog",
      "PublicRoomFrame",
      "PublicRoomControls",
      "PublicRoomDataSurfaces",
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
    files["src/ui/primitives/FocusTrapDialog.tsx"] = files["src/ui/primitives/FocusTrapDialog.tsx"].replace('role="dialog"', 'role="presentation"');
    files["src/alwayson/SubscribeModal.tsx"] = files["src/alwayson/SubscribeModal.tsx"]
      .split("FocusTrapDialog").join("LegacyModal")
      .replace("Automatic confirmation email delivery is not wired yet", "Check your email to confirm");
    files["src/alwayson/PublicRoomPage.tsx"] = files["src/alwayson/PublicRoomPage.tsx"]
      .replace("data-ao-source={bundle.source}", "")
      .split('data-testid="ao-change-postit"').join('data-testid="ao-change-postit-missing"')
      .replace('role="tablist"', "")
      .replace('data-testid="ao-paper-cards"', 'data-testid="ao-paper-cards-missing"');
    files["src/alwayson/alwayson.css"] = files["src/alwayson/alwayson.css"]
      .replace(".ao-btn:focus-visible", ".ao-btn:focus-missing")
      .split(".ao-paper-cards").join(".ao-mobile-cards-missing");
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
    expect(codes).toContain("shared-dialog-role");
    expect(codes).toContain("public-subscribe-shared-dialog");
    expect(codes).toContain("public-subscribe-no-fake-email");
    expect(codes).toContain("public-controls-focus");
    expect(codes).toContain("public-mobile-card-surface");
    expect(codes).toContain("public-mobile-card-breakpoint");
    expect(codes).toContain("public-source-stamp");
    expect(codes).toContain("public-change-postit");
    expect(codes).toContain("public-tabs-keyboard");
    expect(codes).toContain("public-paper-cards");
    expect(codes).toContain("grid-render-window");
    expect(codes).toContain("scale-passive-evidence-gate");
    expect(codes).toContain("scale-source-receipt-dedupe");
    expect(codes).toContain("scale-column-widths");
    expect(codes).toContain("scale-evidence-overlay-css");
    expect(codes).toContain("scale-evidence-calm-css");
  });
});

describe("design token drift (slop detector)", () => {
  const canonicalCss = ":root { --accent-primary: #D97757; --bg-primary: #FFFFFF; }";
  const appCss = [
    ":root { --success: #2E9E6B; --custom-panel: #123456; }",
    '[data-theme="dark"] { --bg-app: #09090b; }',
    ".ok { color: #d97757; background: #fff; border-radius: 8px; font-size: 13px; }",
    ".drift { color: #ABCDEF; border-radius: 7px 7px 0 0; font-size: 12.5px; }",
    ".scoped-def { --scoped-only: #FEDCBA; }",
    ".pill { border-radius: 9999px; border-radius: 50%; }",
  ].join("\n");

  it("builds the allowed set from the canonical file plus styles.css root-block tokens, case-insensitively", () => {
    const allowed = buildAllowedHexSet(canonicalCss, appCss);

    expect(allowed.has("#d97757")).toBe(true); // canonical
    expect(allowed.has("#ffffff")).toBe(true); // canonical, uppercase source
    expect(allowed.has("#123456")).toBe(true); // :root token in styles.css
    expect(allowed.has("#09090b")).toBe(true); // [data-theme] token in styles.css
    expect(allowed.has("#fedcba")).toBe(false); // component-scoped var def is not a root token
    expect(allowed.has("#abcdef")).toBe(false); // literal usage never joins the allowed set
  });

  it("flags off-token hex, off-scale font-size, and off-scale radius as warnings with file:line", () => {
    const result = auditDesignTokenDrift({ canonicalCss, appCss, files: { "src/app/styles.css": appCss } });
    const byCode = (code: string) => result.findings.filter((item) => item.code === code);

    // #fff normalizes to canonical #FFFFFF; root tokens and scale values stay quiet.
    const hex = byCode("token-hex-drift");
    expect(hex.map((item) => item.message)).toEqual(["#ABCDEF is not in the canonical token set."]);
    expect(hex[0]).toMatchObject({ severity: "warn", file: "src/app/styles.css", line: 4 });

    expect(byCode("type-scale-drift")).toHaveLength(1);
    expect(byCode("type-scale-drift")[0].message).toContain("12.5px");
    expect(byCode("radius-scale-drift")).toHaveLength(1); // 7px (0 and 9999 and 50% pass)
    expect(byCode("radius-scale-drift")[0].message).toContain("7px");
    // A hex inside a variable DEFINITION is never flagged, even off-root.
    expect(result.findings.some((item) => item.message.includes("#FEDCBA"))).toBe(false);
  });

  it("catches TSX inline-style slop (bare numbers and quoted px) without failing the audit", () => {
    const tsx = [
      "export function Chip() {",
      '  return <span style={{ background: "#8f3f27", fontSize: 9, borderRadius: 999 }}>x</span>;',
      "}",
      'export const label = <i style={{ fontSize: "10.5px", borderRadius: "999px", color: "#d97757" }} />;',
      'export const safe = <b style={{ fontSize: "0.9em" }} />;',
    ].join("\n");

    const result = auditDesignTokenDrift({ canonicalCss, appCss, files: { "src/ui/Fake.tsx": tsx } });
    const codes = result.findings.map((item) => `${item.code}:${item.line}`);

    expect(result.ok).toBe(true); // drift is guidance — warnings only, never a hard fail
    expect(result.findings.every((item) => item.severity === "warn")).toBe(true);
    expect(codes).toContain("token-hex-drift:2"); // #8f3f27
    expect(codes).toContain("type-scale-drift:2"); // fontSize: 9
    expect(codes).toContain("radius-scale-drift:2"); // borderRadius: 999
    expect(codes).toContain("type-scale-drift:4"); // "10.5px"
    expect(codes).toContain("radius-scale-drift:4"); // "999px"
    expect(codes.filter((code) => code.startsWith("type-scale-drift"))).toHaveLength(2); // em value ignored
    expect(result.findings.some((item) => item.message.includes("#d97757"))).toBe(false); // canonical accent ok
    expect(result.summary).toMatchObject({ hexDrift: 1, typeScaleDrift: 2, radiusScaleDrift: 2 });
  });

  it("reports a missing canonical bundle honestly instead of silently shrinking the allowed set", () => {
    const result = auditDesignTokenDrift({ canonicalCss: "", appCss, files: {} });

    expect(result.ok).toBe(true);
    expect(result.findings.map((item) => item.code)).toEqual(["token-canonical-missing"]);
    expect(result.findings[0].file).toBe(canonicalTokenFile);
  });

  it("stays warning-only against the real production stylesheet", () => {
    const realAppCss = readFileSync("src/app/styles.css", "utf8");
    const realCanonical = existsSync(canonicalTokenFile) ? readFileSync(canonicalTokenFile, "utf8") : "";
    const result = auditDesignTokenDrift({
      canonicalCss: realCanonical,
      appCss: realAppCss,
      files: { "src/app/styles.css": realAppCss },
    });

    expect(result.ok).toBe(true);
    expect(result.findings.every((item) => item.severity === "warn")).toBe(true);
    expect(result.summary.allowedHexes).toBeGreaterThan(10);
  });
});
