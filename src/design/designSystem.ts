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

export type DesignDriftInput = {
  /** Content of design-reference/assets/colors_and_type.css (empty string when the gitignored bundle is absent). */
  canonicalCss: string;
  /** Content of src/app/styles.css — its :root/[data-theme] token blocks extend the allowed hex set. */
  appCss: string;
  /** path -> content for every file to scan (styles.css + src/ui TSX surfaces). */
  files: Record<string, string>;
};

export type DesignDriftResult = {
  ok: boolean;
  summary: {
    warnings: number;
    hexDrift: number;
    typeScaleDrift: number;
    radiusScaleDrift: number;
    allowedHexes: number;
  };
  findings: DesignAuditFinding[];
};

/** Canonical type scale from design-reference/assets/colors_and_type.css (--text-xs .. --text-4xl). */
export const designTypeScalePx = [11, 12, 13, 14, 15, 17, 20, 26, 31, 40] as const;
/** Canonical radius scale (--radius-xs .. --radius-pill). */
export const designRadiusScalePx = [4, 6, 8, 10, 12, 16, 9999] as const;
export const canonicalTokenFile = "design-reference/assets/colors_and_type.css";

const STYLE_FILE = "src/app/styles.css";
const APP_FILE = "src/ui/App.tsx";
const CHAT_FILE = "src/ui/Chat.tsx";
const ARTIFACT_FILE = "src/ui/panels/Artifact.tsx";
const SHELL_FILE = "src/ui/RoomShell.tsx";
const LEFT_RAIL_FILE = "src/ui/LeftRail.tsx";
const FOCUS_TRAP_FILE = "src/ui/primitives/FocusTrapDialog.tsx";
const MOBILE_CSS_FILE = "src/ui/mobile/mobile.css";
const MOBILE_ROOT_FILE = "src/ui/mobile/MobileRoot.tsx";
const MOBILE_APP_FILE = "src/ui/mobile/MobileApp.tsx";
const MOBILE_FRAME_FILE = "src/ui/mobile/MobileFrame.tsx";
const MOBILE_FRAME_CSS_FILE = "src/ui/mobile/mobileFrame.css";
const MOBILE_CONSENT_FILE = "src/ui/mobile/RoomJoinConsent.tsx";
const ALWAYS_ON_CSS_FILE = "src/alwayson/alwayson.css";
const ALWAYS_ON_PUBLIC_FILE = "src/alwayson/PublicRoomPage.tsx";
const ALWAYS_ON_SUBSCRIBE_FILE = "src/alwayson/SubscribeModal.tsx";

export const designSystemFiles = [
  STYLE_FILE,
  APP_FILE,
  CHAT_FILE,
  ARTIFACT_FILE,
  SHELL_FILE,
  LEFT_RAIL_FILE,
  FOCUS_TRAP_FILE,
  MOBILE_CSS_FILE,
  MOBILE_ROOT_FILE,
  MOBILE_APP_FILE,
  MOBILE_FRAME_FILE,
  MOBILE_FRAME_CSS_FILE,
  MOBILE_CONSENT_FILE,
  ALWAYS_ON_CSS_FILE,
  ALWAYS_ON_PUBLIC_FILE,
  ALWAYS_ON_SUBSCRIBE_FILE,
] as const;

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
          selectors: [".r-binder-search", ".r-binder-count", ".r-tree-section-head", ".r-tree-row", ".sc-count"],
          role: "Large-room Binder navigation for hundreds of workbooks and dozens of live people.",
          must: [
            "Large rooms expose real workbook counts and search.",
            "Pinned, recent, sheet, doc, notebook, and upload sections render as a nested tree.",
            "People lists collapse while preserving the live count.",
          ],
          avoid: ["Rendering every artifact or participant row in the default scale viewport.", "Summary-card groups that duplicate the tree navigation."],
        },
        {
          name: "SharedDialog",
          selectors: ["FocusTrapDialog", "[role=\"dialog\"][aria-modal=\"true\"]"],
          role: "Shared modal behavior for regular rooms and public room overlays.",
          must: [
            "Trap focus inside the dialog.",
            "Close on Escape and scrim click.",
            "Restore focus to the opener when the caller provides a trigger path.",
          ],
          avoid: ["One-off modal traps in feature bundles."],
        },
        {
          name: "MobileTerracottaRoom",
          selectors: [".na-app", ".na-nav", ".na-sheet", ".na-ios-bleed"],
          role: "NodeAgent mobile room system: cream, terracotta, iOS-HIG navigation, and bottom sheets.",
          must: [
            "Use the terracotta mobile tokens, not the dark Always-On public-room shell.",
            "Render the same .na-app shell in memory preview and live room mode.",
            "Drop the synthetic device bezel on real phone widths and keep the route overflow-free.",
            "Expose room, agent, inbox, artifact, and sheet actions through mobile-native controls.",
          ],
          avoid: [
            "Calling public #rooms mobile parity proof for the #mobile product route.",
            "Proving only #mobile?mode=memory when validating live user usage.",
            "Replacing bottom sheets with clipped desktop tables on phones.",
          ],
        },
        {
          name: "MobileLiveBootstrap",
          selectors: ["?demo=review", "?room=", "#mobile?demo=review", "#mobile?room=", ".na-join", "RoomJoinConsent"],
          role: "Universal mobile entry path that routes phone-sized NodeRoom URLs into live terracotta create/join before mounting MobileTerracottaRoom.",
          must: [
            "Route phone-sized standard NodeRoom URLs into #mobile before desktop or public-room shells render.",
            "Keep a named surface=desktop harness escape for desktop responsive QA, not for normal users.",
            "Route demo creation through explicit consent before minting the room.",
            "Support join, demo, and create intents from standard URL parameters.",
            "Replace the URL with #mobile?room=<code> after a live room is created or joined.",
            "Mount MobileAppLive inside the same terracotta shell as memory mode.",
          ],
          avoid: [
            "Requiring real mobile users to know or type a #mobile hash.",
            "Landing first-time phone users on the dark public-room shell.",
            "Auto-firing live room mutations from URL parsing.",
            "Using ?mode=memory as proof of live room behavior.",
          ],
        },
        {
          name: "PublicRoomFrame",
          selectors: [".ao-public", ".ao-frame", ".ao-proof"],
          role: "Always-On public room variant of the NodeRoom work surface.",
          must: [
            "Expose data-ao-source so demo and live states are distinguishable.",
            "Use the shared token system for surfaces, focus, ink, and semantic states.",
            "Keep proof receipts visible as product objects.",
          ],
          avoid: ["Demo-only metrics in live bundles.", "Fake proof copy without a stored receipt."],
        },
        {
          name: "PublicRoomControls",
          selectors: [".ao-btn", ".ao-chip", ".ao-tab", ".ao-filter"],
          role: "Public-room button, chip, tab, and filter variants.",
          must: [
            "Use the same focus-ring and accent semantics as .r-* controls.",
            "Support keyboard tab roving on tablists and radio groups.",
            "Keep mobile controls clickable without horizontal page overflow.",
          ],
          avoid: ["Invisible focus state.", "Duplicated dialog behavior."],
        },
        {
          name: "PublicRoomDataSurfaces",
          selectors: [".ao-sheet", ".ao-paper-cards", ".ao-runlog"],
          role: "Read-only public data surfaces for papers, mobile cards, and proof traces.",
          must: [
            "Keep desktop tables dense and ellipsized.",
            "Use mobile cards for small screens instead of clipped tables.",
            "Keep trace rows bounded so costs, retries, and skipped work remain inspectable.",
          ],
          avoid: ["Unbounded table overflow on phones.", "Trace rows whose child content escapes the row."],
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
        "large binders expose count, search, nested tree navigation, and collapsed people",
        "walkthrough dock is dismissible",
        "phone top bar hides secondary utilities instead of clipping them",
        "shared dialog primitive backs both regular-room and public-room modals",
        "mobile terracotta room is tracked separately from public Always-On rooms",
        "mobile live bootstrap can enter a Convex room without memory-mode shortcuts",
        "public Always-On room exposes live/demo source, keyboard tabs, mobile cards, and proof receipts",
        "public subscription copy does not claim a confirmation email was sent before a sender exists",
        "token drift (off-palette hex, off-scale font-size, off-scale border-radius) is reported as warnings",
      ],
    },
  };
}

export function auditNodeRoomDesignSystem(files: Record<string, string>, checkedAt = new Date().toISOString()): DesignAuditResult {
  const findings: DesignAuditFinding[] = [];
  const styles = files[STYLE_FILE] ?? "";
  const app = files[APP_FILE] ?? "";
  const chat = files[CHAT_FILE] ?? "";
  const artifact = files[ARTIFACT_FILE] ?? "";
  const shell = files[SHELL_FILE] ?? "";
  const leftRail = files[LEFT_RAIL_FILE] ?? "";
  const focusTrap = files[FOCUS_TRAP_FILE] ?? "";
  const mobileCss = files[MOBILE_CSS_FILE] ?? "";
  const mobileRoot = files[MOBILE_ROOT_FILE] ?? "";
  const mobileApp = files[MOBILE_APP_FILE] ?? "";
  const mobileFrame = files[MOBILE_FRAME_FILE] ?? "";
  const mobileFrameCss = files[MOBILE_FRAME_CSS_FILE] ?? "";
  const mobileConsent = files[MOBILE_CONSENT_FILE] ?? "";
  const alwaysOnCss = files[ALWAYS_ON_CSS_FILE] ?? "";
  const alwaysOnPublic = files[ALWAYS_ON_PUBLIC_FILE] ?? "";
  const alwaysOnSubscribe = files[ALWAYS_ON_SUBSCRIBE_FILE] ?? "";

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

  // Scan EVERY rule whose selector mentions .r-cell.sel — a single-first-match
  // extraction went stale the moment calm mode added a hover-reveal rule whose
  // selector list also names .r-cell.sel ahead of the real selection rule.
  const selectedBlocks = allCssBlocks(styles, ".r-cell.sel");
  if (selectedBlocks.length === 0) {
    findings.push(finding("sheet-selection-missing", "error", STYLE_FILE, "The selected-cell rule is missing.", "Keep an explicit .r-cell.sel rule with a terracotta outline."));
  } else if (selectedBlocks.some((block) => /31,\s*138,\s*91|46,\s*158,\s*107|--success|#1F8A5B|#2E9E6B/i.test(block))) {
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
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-search\"", "binder-search", "Large Binder search is missing.", "Add search before tree navigation for large rooms.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "r-tree-section-head sc-sec fx-folder", "binder-tree-sections", "Large Binder tree section headers are missing.", "Group pinned, recent, sheets, docs, notebooks, and uploads as collapsible tree sections.");
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-level", "binder-tree-levels", "Large Binder nested tree levels are missing.", "Preserve nested sheet/doc rows so hierarchy is visible at scale.");
  if (leftRail.includes("binder-scale-groups") || leftRail.includes("r-binder-groups")) {
    findings.push(finding("binder-summary-groups", "error", LEFT_RAIL_FILE, "Large Binder summary-card groups are still present.", "Keep the Binder tree-first; do not duplicate navigation with summary cards.", findLine(leftRail, "binder-scale-groups") || findLine(leftRail, "r-binder-groups")));
  }
  requireText(findings, leftRail, LEFT_RAIL_FILE, "data-testid=\"binder-people-collapsed\"", "binder-people-collapsed", "Large-room people list does not collapse.", "Show a bounded people list plus a more-live summary.");
  requireText(findings, styles, STYLE_FILE, ".r-top > .r-iconbtn[title=\"Tweaks\"]", "phone-topbar-secondary-hidden", "Phone top bar does not explicitly hide secondary utilities.", "Hide or move secondary utilities on narrow phones so they do not clip offscreen.");
  requireText(findings, focusTrap, FOCUS_TRAP_FILE, "role=\"dialog\"", "shared-dialog-role", "Shared dialog primitive does not expose role=dialog.", "Keep modal semantics centralized in FocusTrapDialog.");
  requireText(findings, focusTrap, FOCUS_TRAP_FILE, "aria-modal=\"true\"", "shared-dialog-modal", "Shared dialog primitive does not expose aria-modal.", "Keep modal semantics centralized in FocusTrapDialog.");
  requireText(findings, shell, SHELL_FILE, "FocusTrapDialog", "room-shell-shared-dialog", "Regular room shell modal is not using the shared dialog primitive.", "Use FocusTrapDialog for dismissible modal overlays.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, "--bg-app:       #FBF4E7", "mobile-terracotta-cream-bg", "Mobile terracotta CSS no longer exposes the cream app surface.", "Keep #mobile on the terracotta mobile system, separate from public Always-On dark chrome.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, "--accent-primary:       #C56A3C", "mobile-terracotta-accent", "Mobile terracotta CSS no longer exposes the #C56A3C accent.", "Keep the terra mobile accent token for the #mobile route.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, "--font-serif: 'DM Serif Display'", "mobile-terracotta-serif", "Mobile terracotta CSS no longer uses the mobile serif display token.", "Keep the mobile-specific editorial type system.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, ".na-nav {", "mobile-ios-nav", "Mobile terracotta bottom navigation is missing.", "Keep the iOS-HIG bottom tab bar on #mobile.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, ".na-sheet {", "mobile-bottom-sheet", "Mobile terracotta bottom sheets are missing.", "Use bottom sheets for mobile details instead of clipped desktop panels.");
  requireText(findings, mobileCss, MOBILE_CSS_FILE, ".na-handle", "mobile-sheet-handle", "Mobile terracotta sheet grabber is missing.", "Keep the grabber affordance on bottom sheets.");
  requireText(findings, mobileFrame, MOBILE_FRAME_FILE, "const query = \"(max-width: 460px)\";", "mobile-real-phone-bleed", "Mobile frame no longer switches to full-bleed at real phone widths.", "Drop the synthetic bezel at phone width so production mobile is not a framed mockup.");
  requireText(findings, mobileFrame, MOBILE_FRAME_FILE, "na-ios-bleed", "mobile-real-phone-shell", "Mobile full-bleed shell is missing.", "Keep the production phone shell distinct from the desktop presentation frame.");
  requireText(findings, app, APP_FILE, "normalizeMobileLandingUrl", "mobile-universal-landing-router", "The app entry no longer normalizes standard phone URLs into the mobile route.", "Route every phone-sized NodeRoom URL into #mobile before desktop/public shells render.");
  requireText(findings, app, APP_FILE, "isMobileLandingViewport", "mobile-universal-viewport-gate", "Universal mobile routing is missing the phone viewport/user-agent gate.", "Keep desktop URLs on desktop while phone-sized users land in the mobile shell.");
  requireText(findings, app, APP_FILE, "sourceParams.get(\"surface\") === \"desktop\"", "mobile-desktop-harness-escape", "Desktop responsive QA no longer has an explicit harness escape from universal mobile routing.", "Keep surface=desktop for deterministic desktop-shell QA on phone viewports.");
  requireText(findings, mobileApp, MOBILE_APP_FILE, "export function MobileApp({ live }", "mobile-live-prop", "MobileApp no longer accepts the live room binding.", "Keep one terracotta component tree for memory preview and live room mode.");
  requireText(findings, mobileApp, MOBILE_APP_FILE, "if (!live) { setFirstJoinSeen(true); return; }", "mobile-live-first-join", "Mobile live first-join logic is missing.", "Keep live-room behavior explicit instead of treating memory preview as production usage.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "return <MobileLiveRoot />;", "mobile-live-root-route", "The #mobile route no longer reaches the live root when Convex is available.", "Do not validate production mobile usage through memory mode only.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "useMutation(api.rooms.create)", "mobile-live-create-path", "Mobile live bootstrap no longer supports standard ?create= room creation.", "Keep join, demo, and create parity with the desktop live URL contract.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "data-theme=\"light\"", "mobile-entry-light-shell", "Mobile join bootstrap is not using the terracotta light shell.", "First-time phone users should land on the terracotta mobile system, not the dark public shell.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "RoomJoinConsent", "mobile-live-consent", "Live mobile demo creation is no longer gated by consent.", "Keep explicit auto-approve/review consent before minting a live demo room.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "MobileAppLive", "mobile-live-app", "Live mobile room binding is missing.", "Mount MobileAppLive so the terracotta shell subscribes to the real room.");
  requireText(findings, mobileRoot, MOBILE_ROOT_FILE, "history.replaceState(null, \"\", `#mobile?room=${reqCode}`", "mobile-live-room-url", "Live mobile room creation no longer replaces the URL with #mobile?room=<code>.", "Record the live room code in the URL after join/create so the session is reproducible.");
  requireText(findings, mobileConsent, MOBILE_CONSENT_FILE, "data-theme=\"light\"", "mobile-consent-light-shell", "Mobile consent bootstrap is not using the terracotta light shell.", "The explicit consent screen must match the mobile design system.");
  requireText(findings, mobileFrameCss, MOBILE_FRAME_CSS_FILE, "#fbf4e7", "mobile-entry-frame-cream", "Mobile live entry frame no longer defaults to the cream terracotta backdrop.", "Keep mobile join/consent on the same cream surface as the room shell.");
  requireText(findings, mobileFrameCss, MOBILE_FRAME_CSS_FILE, ".na-frame-root[data-theme=\"dark\"]", "mobile-entry-dark-opt-in", "Mobile frame CSS removed the explicit dark opt-in variant.", "Keep dark as an opt-in variant while the default mobile landing stays terracotta.");
  requireText(findings, alwaysOnSubscribe, ALWAYS_ON_SUBSCRIBE_FILE, "FocusTrapDialog", "public-subscribe-shared-dialog", "Always-On subscription modal is not using the shared dialog primitive.", "Use FocusTrapDialog for public-room modal behavior parity.");
  requireText(findings, alwaysOnSubscribe, ALWAYS_ON_SUBSCRIBE_FILE, "Automatic confirmation email delivery is not wired yet", "public-subscribe-no-fake-email", "Always-On subscription success copy can imply an email was sent before delivery exists.", "Only claim pending storage until the confirmation sender is wired and tested.");
  requireText(findings, alwaysOnCss, ALWAYS_ON_CSS_FILE, ".ao-btn:focus-visible", "public-controls-focus", "Always-On controls are missing explicit focus-visible styling.", "Use the shared accent/focus token semantics for public controls.");
  requireText(findings, alwaysOnCss, ALWAYS_ON_CSS_FILE, "var(--accent-primary)", "public-controls-accent-token", "Always-On controls do not reference the shared accent token.", "Use the NodeRoom accent token for public-room control focus and primary actions.");
  requireText(findings, alwaysOnCss, ALWAYS_ON_CSS_FILE, ".ao-paper-cards { display: none;", "public-mobile-card-surface", "Always-On public papers surface is missing the mobile card variant.", "Use responsive cards on phones instead of clipped tables.");
  requireText(findings, alwaysOnCss, ALWAYS_ON_CSS_FILE, ".ao-paper-cards { display: flex;", "public-mobile-card-breakpoint", "Always-On public papers surface is missing the phone card breakpoint.", "Switch the paper card surface on at the phone breakpoint.");
  requireText(findings, alwaysOnPublic, ALWAYS_ON_PUBLIC_FILE, "data-ao-source={bundle.source}", "public-source-stamp", "Always-On public room does not stamp live vs demo source in the DOM.", "Expose data-ao-source so tests and users can distinguish live from demo paths.");
  requireText(findings, alwaysOnPublic, ALWAYS_ON_PUBLIC_FILE, "data-testid=\"ao-proof-footer\"", "public-proof-footer", "Always-On public room proof footer is missing.", "Keep proof receipts visible in the public room frame.");
  requireText(findings, alwaysOnPublic, ALWAYS_ON_PUBLIC_FILE, "data-testid=\"ao-change-postit\"", "public-change-postit", "Always-On public room does not expose the right-rail change post-it.", "Keep the reference design's change post-it, populated from real proof/run data in live mode.");
  requireText(findings, alwaysOnPublic, ALWAYS_ON_PUBLIC_FILE, "role=\"tablist\"", "public-tabs-keyboard", "Always-On public tabs are missing tablist semantics.", "Keep public-room tabs keyboard-addressable.");
  requireText(findings, alwaysOnPublic, ALWAYS_ON_PUBLIC_FILE, "data-testid=\"ao-paper-cards\"", "public-paper-cards", "Always-On papers do not expose the responsive card surface.", "Keep the mobile paper card surface wired and testable.");

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warn").length;
  return {
    ok: errors === 0,
    checkedAt,
    summary: { errors, warnings },
    findings,
  };
}

/**
 * Astryx-style "slop detector": scan the shipped CSS + UI surfaces for values
 * that drift off the canonical token/scale set. Everything here is a WARNING —
 * guidance over enforcement — so the result is ok unless an error sneaks in.
 */
export function auditDesignTokenDrift(input: DesignDriftInput): DesignDriftResult {
  const findings: DesignAuditFinding[] = [];
  const allowed = buildAllowedHexSet(input.canonicalCss, input.appCss);
  if (!input.canonicalCss.trim()) {
    findings.push(
      finding(
        "token-canonical-missing",
        "warn",
        canonicalTokenFile,
        "Canonical token file was not available; the allowed hex set only covers styles.css :root/[data-theme] tokens.",
        "Re-export the Claude Design bundle so design-reference/assets/colors_and_type.css exists locally."
      )
    );
  }
  const typeScale = new Set<number>(designTypeScalePx);
  const radiusScale = new Set<number>(designRadiusScalePx);
  let hexDrift = 0;
  let typeScaleDrift = 0;
  let radiusScaleDrift = 0;

  for (const [file, content] of Object.entries(input.files)) {
    const lines = content.split(/\r?\n/);
    lines.forEach((text, index) => {
      const line = index + 1;
      const seenHex = new Set<string>();
      const seenType = new Set<number>();
      const seenRadius = new Set<number>();
      for (const segment of text.split(";")) {
        if (isCustomPropertyDeclaration(segment)) continue;
        for (const raw of segment.match(HEX_LITERAL) ?? []) {
          const hex = normalizeHex(raw);
          if (allowed.has(hex) || seenHex.has(hex)) continue;
          seenHex.add(hex);
          hexDrift += 1;
          findings.push(
            finding(
              "token-hex-drift",
              "warn",
              file,
              `${raw} is not in the canonical token set.`,
              "Use a token from design-reference/assets/colors_and_type.css or a styles.css :root token instead of a literal hex.",
              line
            )
          );
        }
      }
      for (const value of fontSizePxValues(text)) {
        if (typeScale.has(value) || seenType.has(value)) continue;
        seenType.add(value);
        typeScaleDrift += 1;
        findings.push(
          finding(
            "type-scale-drift",
            "warn",
            file,
            `font-size ${value}px is off the design type scale (${designTypeScalePx.join("/")}px).`,
            "Snap to the nearest type-scale step, or record the exception in the design manifest.",
            line
          )
        );
      }
      for (const value of borderRadiusPxValues(text)) {
        if (value === 0 || radiusScale.has(value) || seenRadius.has(value)) continue;
        seenRadius.add(value);
        radiusScaleDrift += 1;
        findings.push(
          finding(
            "radius-scale-drift",
            "warn",
            file,
            `border-radius ${value}px is off the radius scale (${designRadiusScalePx.join("/")}px).`,
            "Snap to the nearest radius-scale step (9999px for pills), or record the exception in the design manifest.",
            line
          )
        );
      }
    });
  }

  const errors = findings.filter((item) => item.severity === "error").length;
  return {
    ok: errors === 0,
    summary: {
      warnings: findings.filter((item) => item.severity === "warn").length,
      hexDrift,
      typeScaleDrift,
      radiusScaleDrift,
      allowedHexes: allowed.size,
    },
    findings,
  };
}

/**
 * Allowed hex set = every hex in the canonical token file plus every hex used
 * in a custom-property declaration inside styles.css :root/[data-theme] blocks.
 * Comparison is case-insensitive; #abc is normalized to #aabbcc.
 */
export function buildAllowedHexSet(canonicalCss: string, appCss: string): Set<string> {
  const allowed = new Set<string>();
  for (const match of canonicalCss.match(HEX_LITERAL) ?? []) allowed.add(normalizeHex(match));
  for (const block of tokenBlocks(appCss)) {
    for (const segment of block.split(";")) {
      if (!isCustomPropertyDeclaration(segment)) continue;
      for (const match of segment.match(HEX_LITERAL) ?? []) allowed.add(normalizeHex(match));
    }
  }
  return allowed;
}

const HEX_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

function normalizeHex(raw: string): string {
  const hex = raw.toLowerCase();
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  return hex;
}

/** Token blocks are the flat `:root {…}` / `[data-theme…] {…}` rule bodies. */
function tokenBlocks(css: string): string[] {
  const blocks: string[] = [];
  const selector = /(?::root|\[data-theme[^\]]*\])[^{}]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = selector.exec(css))) {
    const open = match.index + match[0].length;
    const close = css.indexOf("}", open);
    if (close < 0) break;
    blocks.push(css.slice(open, close));
    selector.lastIndex = close;
  }
  return blocks;
}

/** A `;`-split segment counts as a variable definition when its declaration starts with `--name:`. */
function isCustomPropertyDeclaration(segment: string): boolean {
  const afterBrace = segment.slice(segment.lastIndexOf("{") + 1);
  return /^\s*--[\w-]+\s*:/.test(afterBrace);
}

/** Extract px font sizes from CSS (`font-size: 12.5px`) and TSX (`fontSize: 9` / `fontSize: "10.5px"`). */
function fontSizePxValues(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) values.push(Number.parseFloat(match[1]));
  for (const match of line.matchAll(/fontSize\s*:\s*(?:["'`]([^"'`]*)["'`]|(\d+(?:\.\d+)?))/g)) {
    if (match[2] !== undefined) {
      values.push(Number.parseFloat(match[2]));
      continue;
    }
    const quoted = /^(\d+(?:\.\d+)?)px$/.exec((match[1] ?? "").trim());
    if (quoted) values.push(Number.parseFloat(quoted[1]));
  }
  return values;
}

/** Extract px radii from CSS (`border-radius: 7px 7px 0 0`) and TSX (`borderRadius: 999` / `"999px"`). */
function borderRadiusPxValues(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(/border-radius\s*:\s*([^;{}]+)/gi)) pushPxValues(values, match[1]);
  for (const match of line.matchAll(/borderRadius\s*:\s*(?:["'`]([^"'`]*)["'`]|(\d+(?:\.\d+)?))/g)) {
    if (match[2] !== undefined) values.push(Number.parseFloat(match[2]));
    else pushPxValues(values, match[1] ?? "");
  }
  return values;
}

function pushPxValues(values: number[], cssValue: string) {
  for (const match of cssValue.matchAll(/(\d+(?:\.\d+)?)px\b/gi)) values.push(Number.parseFloat(match[1]));
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

/** Every rule body whose SELECTOR list mentions `selector` — audits that key on
 *  a semantic selector must inspect all of them, not the first occurrence. */
function allCssBlocks(css: string, selector: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const hit = css.indexOf(selector, from);
    if (hit < 0) break;
    const open = css.indexOf("{", hit);
    if (open < 0) break;
    const close = css.indexOf("}", open);
    if (close < 0) break;
    // Only count occurrences in a selector position (before the block opens),
    // not matches inside a previous rule body.
    const prevClose = css.lastIndexOf("}", hit);
    const between = css.slice(prevClose + 1, hit);
    if (!between.includes("{")) blocks.push(css.slice(open + 1, close));
    from = close + 1;
  }
  return blocks;
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
