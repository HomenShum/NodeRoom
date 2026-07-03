export type DesignAuditSeverity = "error" | "warn";

export type DesignAuditFinding = {
  code: string;
  severity: DesignAuditSeverity;
  file: string;
  line?: number;
  message: string;
  suggestion: string;
};

export type DesignAuditResult = {
  ok: boolean;
  checkedAt: string;
  summary: {
    errors: number;
    warnings: number;
  };
  findings: DesignAuditFinding[];
};

export type DesignManifest = {
  apiVersion: 1;
  type: "noderoom.design-system.manifest";
  data: {
    name: "NodeRoom Design System";
    version: 1;
    inspiration: Array<{
      source: string;
      appliedAs: string;
    }>;
    principles: string[];
    tokens: Array<{
      name: string;
      role: string;
      value: string;
    }>;
    components: Array<{
      name: string;
      selectors: string[];
      role: string;
      must: string[];
      avoid: string[];
    }>;
    auditChecks: string[];
  };
};

const STYLE_FILE = "src/app/styles.css";
const CHAT_FILE = "src/ui/Chat.tsx";
const ARTIFACT_FILE = "src/ui/panels/Artifact.tsx";
const SHELL_FILE = "src/ui/RoomShell.tsx";
const LEFT_RAIL_FILE = "src/ui/LeftRail.tsx";

export const designSystemFiles = [STYLE_FILE, CHAT_FILE, ARTIFACT_FILE, SHELL_FILE, LEFT_RAIL_FILE] as const;

export function getNodeRoomDesignManifest(): DesignManifest {
  return {
    apiVersion: 1,
    type: "noderoom.design-system.manifest",
    data: {
      name: "NodeRoom Design System",
      version: 1,
      inspiration: [
        {
          source: "facebook/astryx",
          appliedAs: "CLI-readable manifest and audit, not runtime component replacement.",
        },
        {
          source: "Astryx principle: guidance over enforcement",
          appliedAs: "Document concrete component roles and catch the highest-risk regressions with checks.",
        },
        {
          source: "Astryx principle: one system for humans and agents",
          appliedAs: "The same manifest is readable by people, tests, and coding agents.",
        },
      ],
      principles: [
        "Default state shows data; hover or focus reveals apparatus.",
        "Receipts are product objects, not status-bar prose.",
        "Selection is terracotta or neutral; green is reserved for success semantics.",
        "Dense work surfaces use fixed dimensions and ellipsis instead of mid-word wrapping.",
        "Mobile exposes desktop hover details through sheets or compact controls, without page overflow.",
        "Demo or walkthrough chrome must be dismissible and must not become permanent product furniture.",
      ],
      tokens: [
        { name: "--space-1", role: "4px spacing base", value: "4px" },
        { name: "--accent-primary", role: "selection, focus, and agent provenance accent", value: "#D97757" },
        { name: "--success", role: "completed/success only, never selection", value: "#2E9E6B" },
        { name: "--focus-ring", role: "keyboard-visible focus halo", value: "terracotta alpha ring" },
        { name: "--r", role: "default container radius ceiling", value: "12px" },
      ],
      components: [
        {
          name: "SheetGrid",
          selectors: [".r-sheet", ".r-cell", ".r-sheet-bar"],
          role: "Dense spreadsheet surface for diligence data.",
          must: [
            "Rows are 44px in the generic sheet.",
            "Cell values ellipsize and retain full value in title or detail path.",
            "Column count lives in the sheet bar.",
            "Agent-written cells can pulse without changing layout.",
          ],
          avoid: [
            "word-break: break-all on grid values.",
            "Green selection rings.",
            "Rows stretched by badges or receipts.",
          ],
        },
        {
          name: "ReceiptChips",
          selectors: [".r-cite-chip", ".r-agent-receipt", ".r-agent-receipt-chip"],
          role: "Visible provenance for sources, versions, locks, and row targets.",
          must: [
            "Agent research messages expose source count, version delta, lock release, and row navigation.",
            "In-cell cite chips reveal source detail without expanding row height.",
            "Large sheets gate passive evidence overlays so receipts do not blanket the grid.",
          ],
          avoid: [
            "Claims only in chat prose.",
            "Source badges that stretch row height.",
            "Duplicate source-chip plus cite-chip treatment in source columns.",
          ],
        },
        {
          name: "IdentityChips",
          selectors: [".r-owner-chip", ".r-owner-avatar", ".r-avatars"],
          role: "Consistent person/agent identity language across chat, grid, and shell.",
          must: [
            "Owner cells use avatar chips instead of bare names.",
            "Avatar labels remain compact and ellipsized.",
          ],
          avoid: ["Plain owner text in dense grids."],
        },
        {
          name: "WalkthroughDock",
          selectors: [".r-walkdock", "[data-testid=\"walkthrough-dock-dismiss\"]"],
          role: "Optional learning chrome that never traps the product viewport.",
          must: ["Dismiss control is always present.", "Phone layout fits without body overflow."],
          avoid: ["Permanent second status bar."],
        },
        {
          name: "ScaleBinder",
          selectors: [".r-binder-search", ".r-binder-count", ".r-binder-group"],
          role: "Large-room Binder navigation for hundreds of workbooks and dozens of live people.",
          must: [
            "Large rooms expose real workbook counts and search.",
            "Pinned, recent, sheet, doc, notebook, and upload groups replace unbounded rails.",
            "People lists collapse while preserving the live count.",
          ],
          avoid: ["Rendering every artifact or participant row in the default scale viewport."],
        },
      ],
      auditChecks: [
        "required token aliases exist",
        "generic sheet rows stay 44px",
        "grid values ellipsize instead of breaking words",
        "selected sheet cell is not success green",
        "agent research receipt exposes source, version, lock, and row target",
        "scale sheets expose filters and rendered-row window proof",
        "large sheets demote passive evidence overlays and duplicate source badges",
        "scale columns use domain widths instead of generic label-length compression",
        "large binders expose count, search, grouped navigation, and collapsed people",
        "walkthrough dock is dismissible",
        "phone top bar hides secondary utilities instead of clipping them",
      ],
    },
  };
}

export function auditNodeRoomDesignSystem(files: Record<string, string>, checkedAt = new Date().toISOString()): DesignAuditResult {
  const findings: DesignAuditFinding[] = [];
  const styles = files[STYLE_FILE] ?? "";
  const chat = files[CHAT_FILE] ?? "";
  const artifact = files[ARTIFACT_FILE] ?? "";
  const shell = files[SHELL_FILE] ?? "";
  const leftRail = files[LEFT_RAIL_FILE] ?? "";

  for (const file of designSystemFiles) {
    if (!files[file]) {
      findings.push(finding("design-file-missing", "error", file, `${file} was not available to the design-system audit.`, "Pass the file content into auditNodeRoomDesignSystem."));
    }
  }

  requireText(findings, styles, STYLE_FILE, "--space-1: 4px", "token-space-base", "The 4px spacing base token is missing.", "Keep --space-1 as the system spacing base.");
  requireText(findings, styles, STYLE_FILE, "--accent-primary: #D97757", "token-accent", "The terracotta accent token changed or is missing.", "Keep selection/provenance on the terracotta accent token.");
  requireText(findings, styles, STYLE_FILE, "--focus-ring:", "token-focus-ring", "The focus ring token is missing.", "Use one explicit focus-ring token instead of ad hoc focus shadows.");

  requireRegex(
    findings,
    styles,
    STYLE_FILE,
    /\.r-sheet\[data-sheet-kind="generic"\]\s+tbody\s+tr:not\(\.r-row-add\)\s*\{[^}]*height:\s*44px/i,
    "sheet-row-height",
    "Generic sheet rows are not locked to 44px.",
    "Keep badges and receipts absolutely positioned so rows do not stretch."
  );

  const cellValueBlock = cssBlock(styles, ".r-sheet[data-sheet-kind=\"generic\"] td.r-cell .r-cell-value");
  if (!cellValueBlock || !/white-space:\s*nowrap/.test(cellValueBlock) || !/overflow:\s*hidden/.test(cellValueBlock) || !/text-overflow:\s*ellipsis/.test(cellValueBlock)) {
    findings.push(finding("sheet-ellipsis", "error", STYLE_FILE, "Generic sheet cell values do not have the nowrap/hidden/ellipsis trio.", "Use ellipsis for dense data and expose full values via title/detail affordances.", findLine(styles, ".r-cell-value")));
  }

  const sheetBreakAllLine = firstMatchingLine(styles, (line) => line.includes(".r-sheet") && /word-break:\s*break-all/.test(line));
  if (sheetBreakAllLine) {
    findings.push(finding("sheet-break-all", "error", STYLE_FILE, "Sheet CSS uses word-break: break-all, which causes mid-word wrapping.", "Use nowrap plus text-overflow: ellipsis for grid values.", sheetBreakAllLine.line));
  }

  const selectedBlock = cssBlock(styles, ".r-cell.sel");
  if (!selectedBlock) {
    findings.push(finding("sheet-selection-missing", "error", STYLE_FILE, "The selected-cell rule is missing.", "Keep an explicit .r-cell.sel rule with a terracotta outline."));
  } else if (/31,\s*138,\s*91|46,\s*158,\s*107|--success|#1F8A5B|#2E9E6B/i.test(selectedBlock)) {
    findings.push(finding("sheet-selection-success", "error", STYLE_FILE, "Selected cells use success-green styling.", "Selection/focus must use terracotta or neutral styling; green is semantic success only.", findLine(styles, ".r-cell.sel")));
  }

  const focusStatusLine = firstMatchingLine(shell, (line) => line.includes("r-focus-status") || line.includes("focus-mode-status"));
  const focusStatusBlock = shell.match(/<div[^>]*className="r-focus-status"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
  if (focusStatusBlock.includes("Focus Mode")) {
    findings.push(finding("focus-mode-duplicate-label", "error", SHELL_FILE, "The bottom status strip still names Focus Mode, creating a second Focus affordance.", "Keep the top switch as the only Focus control; the bottom strip may expose an attention-overlay status only.", focusStatusLine?.line));
  }

  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-status-chip\"", "grid-status-chip", "Grid status chips are missing.", "Render status values through a dry status-chip component.");
  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-owner-chip\"", "grid-owner-chip", "Grid owner avatar chips are missing.", "Render owner values with avatar chips for identity consistency.");
  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-cite-chip\"", "grid-cite-chip", "In-cell cite chips are missing.", "Expose source counts in-cell and details on hover/focus.");
  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-column-count\"", "grid-column-count", "Hidden-column count is missing.", "Keep the hidden-column count in the sheet bar.");
  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-filterbar\"", "grid-filterbar", "Scale sheet filter bar is missing.", "Expose status filters in the large-sheet header so scale state is navigable.");
  requireText(findings, artifact, ARTIFACT_FILE, "data-testid=\"grid-render-window\"", "grid-render-window", "Scale sheet rendered-window proof is missing.", "Show how many rows are mounted/rendered in the large-sheet window.");
  requireText(findings, artifact, ARTIFACT_FILE, "const hasEvidence = !isScaleSheet &&", "scale-passive-evidence-gate", "Large sheets still send every sourced cell to the Attention Overlay.", "Gate passive evidence boxes for scale sheets; rely on cite chips/popovers and active locks instead.");
  requireText(findings, artifact, ARTIFACT_FILE, "&& !isGenericSourceColumn(col)", "scale-source-receipt-dedupe", "Source columns can render duplicate source and cite badges.", "Do not add a second cite badge in source columns; the source chip is the receipt object.");
  requireText(findings, artifact, ARTIFACT_FILE, "function scaleColumnWidth", "scale-column-widths", "Scale sheets use generic compressed column widths.", "Use domain-specific widths so dense scale data remains readable and scrolls horizontally when needed.");
  requireText(findings, styles, STYLE_FILE, ".r-sheet-wrap[data-scale-sheet=\"true\"] .r-focus-box[data-focus-kind=\"evidence\"]", "scale-evidence-overlay-css", "Scale sheet overlay CSS does not suppress passive evidence boxes.", "Large sheets should hide passive evidence boxes and reserve overlays for active state.");
  requireText(findings, styles, STYLE_FILE, ".r-sheet[data-scale-sheet=\"true\"] td.r-cell.evidence", "scale-evidence-calm-css", "Scale sheet evidence styling is not tuned separately from small sheets.", "Use calmer large-sheet evidence styling so provenance does not dominate readability.");

  requireText(findings, chat, CHAT_FILE, "data-testid=\"agent-source-receipt\"", "agent-source-receipt", "Agent receipt source chip is missing.", "Agent claims need an explicit source-count receipt.");
  requireText(findings, chat, CHAT_FILE, "data-testid=\"agent-version-receipt\"", "agent-version-receipt", "Agent receipt version pill is missing.", "Tie agent commits to a visible version delta.");
  requireText(findings, chat, CHAT_FILE, "data-testid=\"agent-lock-released-receipt\"", "agent-lock-released-receipt", "Agent receipt lock release chip is missing.", "Show lock release as a receipt object, not only status text.");
  requireText(findings, chat, CHAT_FILE, "data-testid=\"agent-view-row\"", "agent-view-row", "Agent receipt row target is missing.", "Receipt messages should navigate back to the touched row.");

  requireText(findings, shell, SHELL_FILE, "data-testid=\"walkthrough-dock-dismiss\"", "walkthrough-dismiss", "Walkthrough dock is not dismissible.", "Keep walkthrough chrome optional and dismissible.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-scale-count\"", "binder-scale-count", "Large Binder count badge is missing.", "Show the real artifact count in large rooms.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-search\"", "binder-search", "Large Binder search is missing.", "Add search before grouped Binder navigation for large rooms.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-scale-groups\"", "binder-scale-groups", "Large Binder grouped navigation is missing.", "Group pinned, recent, sheets, docs, notebooks, and uploads at scale.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-people-collapsed\"", "binder-people-collapsed", "Large-room people list does not collapse.", "Show a bounded people list plus a more-live summary.");
  requireText(findings, styles, STYLE_FILE, ".r-top > .r-iconbtn[title=\"Tweaks\"]", "phone-topbar-secondary-hidden", "Phone top bar does not explicitly hide secondary utilities.", "Hide or move secondary utilities on narrow phones so they do not clip offscreen.");

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return {
    ok: errors === 0,
    checkedAt,
    summary: { errors, warnings },
    findings,
  };
}

function requireText(
  findings: DesignAuditFinding[],
  content: string,
  file: string,
  needle: string,
  code: string,
  message: string,
  suggestion: string
) {
  if (!content.includes(needle)) {
    findings.push(finding(code, "error", file, message, suggestion, findLine(content, needle)));
  }
}

function requireRegex(
  findings: DesignAuditFinding[],
  content: string,
  file: string,
  regex: RegExp,
  code: string,
  message: string,
  suggestion: string
) {
  if (!regex.test(content)) {
    findings.push(finding(code, "error", file, message, suggestion));
  }
}

function finding(code: string, severity: DesignAuditSeverity, file: string, message: string, suggestion: string, line?: number): DesignAuditFinding {
  return { code, severity, file, line, message, suggestion };
}

function cssBlock(css: string, selector: string): string | null {
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  if (open < 0) return null;
  const close = css.indexOf("}", open);
  if (close < 0) return null;
  return css.slice(open + 1, close);
}

function findLine(content: string, needle: string): number | undefined {
  if (!content || !needle) return undefined;
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  return index >= 0 ? index + 1 : undefined;
}

function firstMatchingLine(content: string, predicate: (line: string) => boolean): { line: number; text: string } | null {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? "";
    if (predicate(text)) return { line: index + 1, text };
  }
  return null;
}
