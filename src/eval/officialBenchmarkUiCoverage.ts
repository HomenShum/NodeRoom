import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import {
  readFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
  type FreshRoomExportReceipt,
  type FreshRoomProofGate,
  type FreshRoomProofReceipt,
  type FreshRoomReopenReceipt,
} from "./freshRoomProofReceipts";

export type OfficialBenchmarkUiId = "bankertoolbench" | "spreadsheetbench-v1" | "spreadsheetbench-v2";

/**
 * Path to the proof receipt written by e2e/benchmark-ui-spreadsheetbench.spec.ts on a GENUINE
 * end-to-end pass. The coverage ledger reads this file and only flips the gates the receipt proves;
 * no receipt -> the row stays 'missing'. This keeps `passed` DERIVED from receipts, never hardcoded.
 */
export const SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH = "docs/eval/spreadsheetbench-live-room-proof.json";

/**
 * Fresh-room proof receipt written by e2e/benchmark-ui-bankertoolbench.spec.ts / the recovery
 * downloader for a completed live BTB room. This is the BTB equivalent of the SpreadsheetBench
 * receipt, but it has to prove a package: xlsx, xlsm, pptx, docx, and pdf.
 */
export const BANKERTOOLBENCH_FRESH_ROOM_PROOF_PATH = "docs/eval/fresh-room/FR-020/latest.json";
export const BANKERTOOLBENCH_LIVE_ROOM_PROOF_PATH = "docs/eval/bankertoolbench-live-room-proof.json";
export const BANKERTOOLBENCH_PACKAGE_MANIFEST_PATH = "test-results/bankertoolbench/package-manifest.json";

/** The gates the live-browser fresh-room spec can honestly prove for SpreadsheetBench V1. */
export type SpreadsheetBenchProvenGate =
  | "fresh_room_join"
  | "official_fixture_upload"
  | "public_nodeagent_invocation"
  | "visible_streaming_progress"
  | "deliverable_export_download"
  | "artifact_reopen_validation"
  | "official_scorer_handoff"
  | "no_memory_mode_shortcut";

/**
 * Structured receipt for the export-download gate. Populated by the e2e spec on a real
 * `page.waitForEvent('download')` capture: the spec re-reads the downloaded file from disk and
 * records its byte length, the first-four-bytes "magic" header (must be the PKZIP signature
 * "PK\x03\x04" for any real .xlsx — Office files are ZIP packages), and the filename the browser
 * proposed. The ledger refuses to flip `deliverable_export_download` to covered unless every field
 * here independently validates — a zero-byte download or a CSV that lied about its extension can
 * still produce a `gatesProven` entry, so the structured fields are the actual gate.
 */
export type DeliverableExportDownloadReceipt = {
  downloaded: boolean;
  /** Byte length of the file written to disk after the Playwright download completed. */
  bytes: number;
  /** First-four-bytes magic header, as a printable string (must start with "PK"). */
  magic: string;
  filename: string;
};

/**
 * Structured receipt for the artifact-reopen gate. Populated by the e2e spec after it reopens the
 * downloaded workbook with exceljs and re-grades the reopened cells through the SAME official
 * scorer that judged the live DOM cells (gradeGolden against NB01_RUBRIC_DOM). The ledger refuses
 * to flip `artifact_reopen_validation` to covered unless `reopened === true`, `scorerResult` is
 * exactly the string `"pass"`, and the cells-matched fraction reaches the full count.
 */
export type ArtifactReopenValidationReceipt = {
  reopened: boolean;
  /** Scorer verdict on the reopened workbook — only "pass" satisfies the gate. */
  scorerResult: "pass" | "fail";
  /** "N/N" tag for the receipt narrative (e.g. "5/5"). */
  cellsMatched: string;
  /** Numerator/denominator split, kept structured so the gate can demand correct === n. */
  correct: number;
  n: number;
};

/** Shape of the proof receipt written by the live-browser SpreadsheetBench spec. */
export type SpreadsheetBenchLiveRoomProof = {
  schema: 1;
  task: string;
  generatedAt: string;
  baseUrl: string;
  memoryMode: boolean;
  gradingMethod: "cell-read" | "file-export";
  note: string;
  scorer: { name: string; file: string };
  grade: { score: number; ok: boolean; correct: number; n: number; fabrication: number; flags: string[] };
  selfTest: { goodScore: number; badScore: number; badRejected: boolean };
  cells: Record<string, string>;
  passed: boolean;
  gatesProven: SpreadsheetBenchProvenGate[];
  gatesNotProven: Record<string, string>;
  /**
   * Structured proof for the export gate — present iff the spec actually captured the downloaded
   * file's bytes and magic header. Missing/invalid fields keep the gate `missing` regardless of
   * what `gatesProven` claims.
   */
  deliverable_export_download?: DeliverableExportDownloadReceipt;
  /**
   * Structured proof for the reopen gate — present iff the spec actually reopened the file from
   * disk and re-graded it via the official scorer. Missing/invalid fields keep the gate `missing`.
   */
  artifact_reopen_validation?: ArtifactReopenValidationReceipt;
};

/** The PKZIP magic header every real .xlsx (and any OOXML file) must start with. */
export const XLSX_MAGIC_PREFIX = "PK";

/**
 * Validate the structured export-download receipt. The gate flips ONLY when this returns true —
 * the spec must have actually downloaded a non-empty file whose first four bytes are the PKZIP
 * signature. A receipt with `downloaded: false`, `bytes: 0`, or a wrong magic header is rejected
 * even if `gatesProven` lists the gate id (defense-in-depth against tampered receipts).
 */
export function isDeliverableExportDownloadValid(
  receipt: DeliverableExportDownloadReceipt | undefined,
): receipt is DeliverableExportDownloadReceipt {
  if (!receipt) return false;
  if (receipt.downloaded !== true) return false;
  if (typeof receipt.bytes !== "number" || !Number.isFinite(receipt.bytes) || receipt.bytes <= 0) return false;
  if (typeof receipt.magic !== "string" || !receipt.magic.startsWith(XLSX_MAGIC_PREFIX)) return false;
  if (typeof receipt.filename !== "string" || receipt.filename.length === 0) return false;
  return true;
}

/**
 * Validate the structured reopen receipt. The gate flips ONLY when this returns true — the spec
 * must have reopened the file from disk, the scorer must have returned the literal string "pass",
 * and the matched-cells fraction must be complete (`correct === n` with `n > 0`). A receipt that
 * lists `scorerResult: "fail"` or `correct < n` is rejected.
 */
export function isArtifactReopenValidationValid(
  receipt: ArtifactReopenValidationReceipt | undefined,
): receipt is ArtifactReopenValidationReceipt {
  if (!receipt) return false;
  if (receipt.reopened !== true) return false;
  if (receipt.scorerResult !== "pass") return false;
  if (typeof receipt.correct !== "number" || typeof receipt.n !== "number") return false;
  if (receipt.n <= 0 || receipt.correct !== receipt.n) return false;
  if (typeof receipt.cellsMatched !== "string" || receipt.cellsMatched.length === 0) return false;
  return true;
}

/**
 * Read the SpreadsheetBench live-room proof receipt, but ONLY trust it when it is internally honest:
 * a genuine pass, not memory mode, the scorer accepted every cell with zero fabrication, AND the
 * in-run anti-cheat self-test held (good=1.0, bad rejected). A receipt that fails any of these is
 * ignored — the ledger refuses to flip on a tampered or partial receipt.
 */
export function readSpreadsheetBenchLiveRoomProof(
  proofPath: string = SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH,
): SpreadsheetBenchLiveRoomProof | null {
  const absolute = resolve(process.cwd(), proofPath);
  if (!existsSync(absolute)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
  const proof = parsed as Partial<SpreadsheetBenchLiveRoomProof>;
  const honest =
    proof?.schema === 1 &&
    proof.passed === true &&
    proof.memoryMode === false &&
    !!proof.grade &&
    proof.grade.ok === true &&
    proof.grade.fabrication === 0 &&
    proof.grade.correct === proof.grade.n &&
    !!proof.selfTest &&
    proof.selfTest.goodScore === 1 &&
    proof.selfTest.badRejected === true &&
    Array.isArray(proof.gatesProven) &&
    proof.gatesProven.length > 0;
  return honest ? (proof as SpreadsheetBenchLiveRoomProof) : null;
}

const BANKERTOOLBENCH_REQUIRED_EXTENSIONS = [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf"] as const;
type BankerToolBenchRequiredExtension = (typeof BANKERTOOLBENCH_REQUIRED_EXTENSIONS)[number];

const BANKERTOOLBENCH_KIND_BY_EXTENSION: Record<BankerToolBenchRequiredExtension, BenchmarkDeliverableKind> = {
  ".xlsx": "workbook",
  ".xlsm": "workbook",
  ".pptx": "presentation",
  ".docx": "document",
  ".pdf": "pdf",
};

const BANKERTOOLBENCH_REQUIRED_PROOF_GATES: FreshRoomProofGate[] = [
  "fresh_room_join",
  "official_fixture_upload",
  "public_nodeagent_invocation",
  "visible_streaming_progress",
  "trace_video_artifacts",
  "no_memory_mode_shortcut",
  "focus_mode_enabled",
  "focus_box_or_attention_overlay",
  "agent_live_loop",
  "room_trace_visible",
  "job_detail_visible",
  "deliverable_export_download",
  "artifact_reopen_validation",
  "official_scorer_handoff",
];

/**
 * Read the BankerToolBench fresh-room receipt, but only trust it when the browser run proved the
 * whole package: focus-mode live room, public @nodeagent invocation, streaming/job/trace UI,
 * downloaded xlsx/xlsm/pptx/docx/pdf deliverables, reopened package files, and a passing verifier.
 */
export function readBankerToolBenchFreshRoomProof(
  proofPath: string = BANKERTOOLBENCH_FRESH_ROOM_PROOF_PATH,
): FreshRoomProofReceipt | null {
  const proof = readFreshRoomProofReceipt(proofPath);
  if (!proof) return null;
  if (proof.benchmark !== "bankertoolbench") return null;

  const validation = validateFreshRoomProofReceipt(proof, {
    path: proofPath,
    caseId: "FR-020",
    requireFocusMode: true,
    requireOfficialScorer: true,
  });
  if (!validation.ok) return null;

  const gateSet = new Set(proof.gatesProven ?? []);
  for (const gate of BANKERTOOLBENCH_REQUIRED_PROOF_GATES) {
    if (!gateSet.has(gate)) return null;
  }
  if (!hasCompleteBankerToolBenchExports(proof.artifacts?.exportedFiles)) return null;
  if (!hasCompleteBankerToolBenchReopens(proof.artifacts?.reopenedFiles)) return null;
  return proof;
}

function hasCompleteBankerToolBenchExports(files: FreshRoomExportReceipt[] | undefined): boolean {
  return BANKERTOOLBENCH_REQUIRED_EXTENSIONS.every((extension) =>
    (files ?? []).some((file) => isValidBankerToolBenchExport(file, extension)),
  );
}

function hasCompleteBankerToolBenchReopens(files: FreshRoomReopenReceipt[] | undefined): boolean {
  return BANKERTOOLBENCH_REQUIRED_EXTENSIONS.every((extension) =>
    (files ?? []).some((file) => isValidBankerToolBenchReopen(file, extension)),
  );
}

function isValidBankerToolBenchExport(
  file: FreshRoomExportReceipt,
  expectedExtension: BankerToolBenchRequiredExtension,
): boolean {
  if (normalizedReceiptExtension(file) !== expectedExtension) return false;
  if (file.kind !== BANKERTOOLBENCH_KIND_BY_EXTENSION[expectedExtension]) return false;
  if (file.downloaded !== true) return false;
  if (typeof file.bytes !== "number" || !Number.isFinite(file.bytes) || file.bytes <= 0) return false;
  const expectedMagic = expectedExtension === ".pdf" ? "%PDF" : XLSX_MAGIC_PREFIX;
  return typeof file.magic === "string" && file.magic.startsWith(expectedMagic);
}

function isValidBankerToolBenchReopen(
  file: FreshRoomReopenReceipt,
  expectedExtension: BankerToolBenchRequiredExtension,
): boolean {
  if (normalizedReceiptExtension(file) !== expectedExtension) return false;
  if (file.kind !== BANKERTOOLBENCH_KIND_BY_EXTENSION[expectedExtension]) return false;
  if (file.reopened !== true) return false;
  return !file.scorerResult || file.scorerResult === "pass";
}

function normalizedReceiptExtension(file: { extension?: string; filename?: string }): string {
  return (file.extension || extname(file.filename ?? "")).toLowerCase();
}

export type BenchmarkUiCoverageStatus = "covered" | "partial" | "missing";

export type BenchmarkDeliverableKind =
  | "workbook"
  | "presentation"
  | "document"
  | "pdf"
  | "csv"
  | "image";

export type BenchmarkDeliverableType = {
  kind: BenchmarkDeliverableKind;
  label: string;
  extensions: string[];
  requiredFor: OfficialBenchmarkUiId[];
  validation: string[];
};

export type BenchmarkUiGate = {
  id:
    | "fresh_room_join"
    | "official_fixture_upload"
    | "public_nodeagent_invocation"
    | "visible_streaming_progress"
    | "deliverable_export_download"
    | "artifact_reopen_validation"
    | "official_scorer_handoff"
    | "trace_video_artifacts"
    | "no_memory_mode_shortcut";
  label: string;
};

export type BenchmarkUiCoverageTrack = {
  id: OfficialBenchmarkUiId;
  title: string;
  status: BenchmarkUiCoverageStatus;
  requiredDeliverables: BenchmarkDeliverableKind[];
  supportedByNonUiRunner: BenchmarkDeliverableKind[];
  liveBrowserFreshRoomDeliverables: BenchmarkDeliverableKind[];
  missingDeliverables: BenchmarkDeliverableKind[];
  gates: Array<BenchmarkUiGate & { status: BenchmarkUiCoverageStatus; evidence?: string; blocker?: string }>;
  currentEvidence: string[];
  requiredSpec: string;
  blockers: string[];
};

export type OfficialBenchmarkUiCoverageReport = {
  schema: 1;
  generatedAt?: string;
  summary: {
    tracks: number;
    coveredTracks: number;
    partialTracks: number;
    missingTracks: number;
    requiredDeliverableKinds: BenchmarkDeliverableKind[];
    liveBrowserFreshRoomReady: boolean;
  };
  policy: string[];
  deliverableTypes: BenchmarkDeliverableType[];
  gates: BenchmarkUiGate[];
  tracks: BenchmarkUiCoverageTrack[];
};

export type OfficialBenchmarkUiCoverageProofPaths = {
  spreadsheetBenchLiveRoomProofPath?: string;
  bankerToolBenchFreshRoomProofPath?: string;
};

export const BENCHMARK_DELIVERABLE_TYPES: BenchmarkDeliverableType[] = [
  {
    kind: "workbook",
    label: "Excel workbook",
    extensions: [".xlsx", ".xlsm"],
    requiredFor: ["bankertoolbench", "spreadsheetbench-v1", "spreadsheetbench-v2"],
    validation: [
      "download candidate workbook from the room",
      "reopen workbook from disk",
      "run workbook scorer, formula recompute, and format diff where applicable",
    ],
  },
  {
    kind: "presentation",
    label: "PowerPoint deck",
    extensions: [".pptx"],
    requiredFor: ["bankertoolbench"],
    validation: [
      "download candidate deck from the room",
      "reopen deck package",
      "hand candidate deck to the BankerToolBench verifier",
    ],
  },
  {
    kind: "document",
    label: "Word document",
    extensions: [".docx"],
    requiredFor: ["bankertoolbench"],
    validation: [
      "download candidate memo from the room",
      "reopen document package",
      "hand candidate memo to the BankerToolBench verifier",
    ],
  },
  {
    kind: "pdf",
    label: "PDF",
    extensions: [".pdf"],
    requiredFor: ["bankertoolbench"],
    validation: [
      "download candidate PDF from the room",
      "render or parse the PDF",
      "hand candidate PDF to the BankerToolBench verifier",
    ],
  },
  {
    kind: "csv",
    label: "CSV/table export",
    extensions: [".csv"],
    requiredFor: [],
    validation: [
      "download candidate CSV when a task requests table export",
      "parse rows and columns",
      "compare against task-specific scorer policy",
    ],
  },
  {
    kind: "image",
    label: "Image/asset export",
    extensions: [".png", ".jpg", ".jpeg"],
    requiredFor: [],
    validation: [
      "download or inspect image assets when a task produces them",
      "verify non-empty dimensions",
      "include assets in verifier package manifests",
    ],
  },
];

export const BENCHMARK_UI_GATES: BenchmarkUiGate[] = [
  { id: "fresh_room_join", label: "Create or join a fresh live room through the browser UI" },
  { id: "official_fixture_upload", label: "Upload official benchmark input files through the UI" },
  { id: "public_nodeagent_invocation", label: "Send the official instruction through public @nodeagent chat" },
  { id: "visible_streaming_progress", label: "Show visible agent progress or streamed text while work runs" },
  { id: "deliverable_export_download", label: "Export or download every expected deliverable type from the UI" },
  { id: "artifact_reopen_validation", label: "Reopen downloaded artifacts from disk before scoring" },
  { id: "official_scorer_handoff", label: "Hand artifacts to the official or benchmark-faithful scorer" },
  { id: "trace_video_artifacts", label: "Persist trace, screenshot, and video evidence for each run" },
  { id: "no_memory_mode_shortcut", label: "Do not use memory-mode demo seeds for benchmark claims" },
];

export function buildOfficialBenchmarkUiCoverageReport(args: {
  generatedAt?: string;
  proofPaths?: OfficialBenchmarkUiCoverageProofPaths;
} = {}): OfficialBenchmarkUiCoverageReport {
  const proofPaths = {
    spreadsheetBenchLiveRoomProofPath: args.proofPaths?.spreadsheetBenchLiveRoomProofPath ?? SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH,
    bankerToolBenchFreshRoomProofPath: args.proofPaths?.bankerToolBenchFreshRoomProofPath ?? BANKERTOOLBENCH_FRESH_ROOM_PROOF_PATH,
  };
  const tracks = [
    bankerToolBenchUiTrack(proofPaths.bankerToolBenchFreshRoomProofPath),
    spreadsheetBenchV1UiTrack(proofPaths.spreadsheetBenchLiveRoomProofPath),
    spreadsheetBenchV2UiTrack(),
  ];
  const requiredDeliverableKinds = [
    ...new Set(tracks.flatMap((track) => track.requiredDeliverables)),
  ].sort();

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    summary: {
      tracks: tracks.length,
      coveredTracks: tracks.filter((track) => track.status === "covered").length,
      partialTracks: tracks.filter((track) => track.status === "partial").length,
      missingTracks: tracks.filter((track) => track.status === "missing").length,
      requiredDeliverableKinds,
      liveBrowserFreshRoomReady: tracks.every((track) => track.status === "covered"),
    },
    policy: [
      "A screenshot or memory-mode run is not enough for benchmark UI proof.",
      "Every benchmark UI run must start from a fresh live room and use the public @nodeagent lane.",
      "Every expected deliverable type must be exported/downloaded from the browser, reopened from disk, and passed to the benchmark scorer or verifier.",
      "SpreadsheetBench requires workbook export/reopen/scoring; BankerToolBench requires Excel, PowerPoint, Word, and PDF package handling.",
      "Runner-only evidence is useful plumbing, but it does not satisfy live-browser fresh-room coverage.",
    ],
    deliverableTypes: BENCHMARK_DELIVERABLE_TYPES,
    gates: BENCHMARK_UI_GATES,
    tracks,
  };
}

function bankerToolBenchUiTrack(proofPath: string = BANKERTOOLBENCH_FRESH_ROOM_PROOF_PATH): BenchmarkUiCoverageTrack {
  const proof = readBankerToolBenchFreshRoomProof(proofPath);
  const requiredDeliverables: BenchmarkDeliverableKind[] = ["workbook", "presentation", "document", "pdf"];
  const liveBrowserFreshRoomDeliverables = proof ? requiredDeliverables : [];
  const missingDeliverables = requiredDeliverables.filter((kind) => !liveBrowserFreshRoomDeliverables.includes(kind));
  const requiredSpec = "e2e/benchmark-ui-bankertoolbench.spec.ts";
  const currentEvidence = [
    "src/eval/bankerToolBenchRunner.ts",
    "src/eval/bankerToolBenchNodeAgentGeneral.ts",
    "tests/bankerToolBenchRunner.test.ts",
    "tests/bankerToolBenchNodeAgentGeneral.test.ts",
    "docs/qa/browser-e2e-flow-inventory.json",
    requiredSpec,
    proofPath,
    BANKERTOOLBENCH_LIVE_ROOM_PROOF_PATH,
    BANKERTOOLBENCH_PACKAGE_MANIFEST_PATH,
  ];
  const gateSet = new Set(proof?.gatesProven ?? []);
  const requiredSpecExists = existsSync(requiredSpec);
  const proofLabel = proof
    ? `${requiredSpec} (proof: ${proofPath}, room ${proof.roomId ?? "unknown"})`
    : undefined;

  const gates = BENCHMARK_UI_GATES.map((gate) => {
    if (proof && gateSet.has(gate.id)) {
      if (gate.id === "deliverable_export_download") {
        return {
          ...gate,
          status: "covered" as const,
          evidence: `${proofLabel}; downloaded ${BANKERTOOLBENCH_REQUIRED_EXTENSIONS.join(", ")}`,
        };
      }
      if (gate.id === "artifact_reopen_validation") {
        return {
          ...gate,
          status: "covered" as const,
          evidence: `${proofLabel}; reopened OOXML/PDF package files before scoring`,
        };
      }
      if (gate.id === "official_scorer_handoff") {
        const scorer = proof.scorer;
        return {
          ...gate,
          status: "covered" as const,
          evidence: `${scorer?.name ?? "BankerToolBench verifier"} (${scorer?.command ?? BANKERTOOLBENCH_LIVE_ROOM_PROOF_PATH})`,
        };
      }
      if (gate.id === "trace_video_artifacts") {
        return {
          ...gate,
          status: "covered" as const,
          evidence: proof.ui.tracePath ?? proof.ui.videoPaths?.[0] ?? proofPath,
        };
      }
      if (gate.id === "visible_streaming_progress") {
        return {
          ...gate,
          status: "covered" as const,
          evidence: btbStreamingEvidence(proof, proofLabel ?? proofPath),
        };
      }
      return {
        ...gate,
        status: "covered" as const,
        evidence: proofLabel,
      };
    }
    if (gate.id === "public_nodeagent_invocation") {
      return {
        ...gate,
        status: "partial" as const,
        evidence: "tests/ui-benchmark-drive.spec.ts",
        blocker: "Covered in memory mode only; no trusted FR-020 fresh-room receipt is present.",
      };
    }
    if (gate.id === "trace_video_artifacts") {
      return {
        ...gate,
        status: "partial" as const,
        evidence: "playwright.config.ts",
        blocker: "Generic Playwright traces/videos exist, but no trusted BTB fresh-room artifact package proof is present.",
      };
    }
    if (gate.id === "no_memory_mode_shortcut") {
      return {
        ...gate,
        status: requiredSpecExists ? "partial" as const : "missing" as const,
        blocker: requiredSpecExists
          ? "Spec exists but needs a trusted FR-020 receipt proving it never uses ?mode=memory."
          : "No fresh-room BTB UI spec exists.",
      };
    }
    return {
      ...gate,
      status: "missing" as const,
      blocker: `Missing trusted FR-020 fresh-room proof for ${gate.id}.`,
    };
  });

  return {
    id: "bankertoolbench",
    title: "BankerToolBench live browser deliverable package",
    status: proof ? "covered" : "missing",
    requiredDeliverables,
    supportedByNonUiRunner: ["workbook", "presentation", "document", "pdf", "csv", "image"],
    liveBrowserFreshRoomDeliverables,
    missingDeliverables,
    gates,
    currentEvidence,
    requiredSpec,
    blockers: proof
      ? [
          `Live-browser fresh-room BTB run PASSED for task ${proof.taskId ?? "unknown"} with ${BANKERTOOLBENCH_REQUIRED_EXTENSIONS.join(", ")} downloaded and reopened; proof: ${proofPath}.`,
          ...btbVisualJudgeCoverageNotes(proof),
          ...(proof.visualJudge?.verdict === "not_run" && proof.visualJudge.reason
            ? [`Gemini visual judge not run: ${proof.visualJudge.reason}`]
            : []),
        ]
      : [
          "Missing live-browser fresh-room proof for BankerToolBench package delivery.",
          "Need a fresh live room, official input upload, public @nodeagent prompt, streamed UI progress, downloaded Excel/PPTX/DOCX/PDF package, reopen checks, trace/video, and verifier handoff.",
        ],
  };
}

function btbStreamingEvidence(proof: FreshRoomProofReceipt, proofLabel: string): string {
  const parts = [
    proofLabel,
    `model ${proof.model?.resolved ?? "unknown"}`,
    proof.model?.runtimeProfile ? `runtime ${proof.model.runtimeProfile}` : undefined,
    proof.ui.jobDetailVisible ? "job detail visible" : undefined,
    proof.ui.roomTraceVisible ? "room trace visible" : undefined,
    proof.gatesProven?.includes("agent_live_loop") ? "agent live loop proven" : undefined,
    btbTelemetrySummary(proof),
  ].filter((part): part is string => !!part);
  return parts.join("; ");
}

function btbTelemetrySummary(proof: FreshRoomProofReceipt): string | undefined {
  const telemetry = proof.telemetry;
  if (!telemetry) return undefined;
  const parts: string[] = [];
  if (typeof telemetry.modelCalls === "number") parts.push(`${telemetry.modelCalls} model calls`);
  if (typeof telemetry.toolCalls === "number") parts.push(`${telemetry.toolCalls} tool calls`);
  if (typeof telemetry.mutationCount === "number") parts.push(`${telemetry.mutationCount} mutations`);
  if (typeof telemetry.costUsd === "number") parts.push(`$${telemetry.costUsd}`);
  return parts.length ? parts.join(", ") : undefined;
}

function btbVisualJudgeCoverageNotes(proof: FreshRoomProofReceipt): string[] {
  if (proof.visualJudge?.verdict !== "pass") return [];
  const scorecard = proof.visualJudge.scorecardPath ? `; scorecard: ${proof.visualJudge.scorecardPath}` : "";
  const reason = proof.visualJudge.reason ? `; ${proof.visualJudge.reason.replace(/\.+$/g, "")}` : "";
  return [`Gemini visual judge passed${scorecard}${reason}.`];
}

function spreadsheetBenchV1UiTrack(proofPath: string = SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH): BenchmarkUiCoverageTrack {
  const proof = readSpreadsheetBenchLiveRoomProof(proofPath);
  return buildTrack({
    id: "spreadsheetbench-v1",
    title: "SpreadsheetBench V1 live browser workbook run",
    requiredDeliverables: ["workbook"],
    supportedByNonUiRunner: ["workbook"],
    currentEvidence: [
      "tests/ui-benchmark-drive.spec.ts",
      "src/eval/spreadsheetBenchRunner.ts",
      "src/eval/spreadsheetBenchScorer.ts",
      "docs/qa/browser-e2e-flow-inventory.json",
      ...(proof ? ["e2e/benchmark-ui-spreadsheetbench.spec.ts", proofPath] : []),
    ],
    requiredSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    blockers: [
      "Current Playwright benchmark driver uses memory mode and demo sheet cells, not a fresh live room with official workbook upload/export.",
      "No browser-run workbook is downloaded, reopened, and scored against the official V1 policy.",
    ],
    proof,
    proofPath,
  });
}

function spreadsheetBenchV2UiTrack(): BenchmarkUiCoverageTrack {
  return buildTrack({
    id: "spreadsheetbench-v2",
    title: "SpreadsheetBench 2 live browser workbook and chart workflow",
    requiredDeliverables: ["workbook"],
    supportedByNonUiRunner: ["workbook", "image"],
    currentEvidence: [
      "tests/ui-benchmark-drive.spec.ts",
      "src/eval/spreadsheetBenchRunner.ts",
      "src/eval/spreadsheetBenchChartVisualProbe.ts",
      "docs/qa/browser-e2e-flow-inventory.json",
    ],
    requiredSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    blockers: [
      "No fresh live room V2 workflow uploads official workbooks and exports the edited workbook package from the browser.",
      "Rendered chart screenshots and VLM/chart grading are not attached to a browser-run artifact package.",
    ],
  });
}

function buildTrack(args: {
  id: OfficialBenchmarkUiId;
  title: string;
  requiredDeliverables: BenchmarkDeliverableKind[];
  supportedByNonUiRunner: BenchmarkDeliverableKind[];
  currentEvidence: string[];
  requiredSpec: string;
  blockers: string[];
  /** Honest live-browser proof receipt; when present, flips the gates the receipt proves. */
  proof?: SpreadsheetBenchLiveRoomProof | null;
  proofPath?: string;
}): BenchmarkUiCoverageTrack {
  const proof = args.proof ?? null;
  const proofPath = args.proofPath ?? SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH;
  const provenByReceipt = new Set<string>(proof?.gatesProven ?? []);
  // EXPORT was the genuine gap; with the Export XLSX toolbar button + reopen step, an honest
  // file-export receipt now flips the workbook deliverable to covered. Defense-in-depth: the
  // string membership in `gatesProven` is necessary but NOT sufficient — the receipt must also
  // carry valid structured field-level receipts so a tampered/zero-byte/wrong-magic file or a
  // failed reopened-grade cannot pass by string-claim alone.
  const exportDownloadValid = isDeliverableExportDownloadValid(proof?.deliverable_export_download);
  const reopenValid = isArtifactReopenValidationValid(proof?.artifact_reopen_validation);
  const exportProven =
    !!proof &&
    proof.gradingMethod === "file-export" &&
    provenByReceipt.has("deliverable_export_download") &&
    provenByReceipt.has("artifact_reopen_validation") &&
    exportDownloadValid &&
    reopenValid;
  const liveBrowserFreshRoomDeliverables: BenchmarkDeliverableKind[] =
    exportProven && args.requiredDeliverables.includes("workbook") ? ["workbook"] : [];
  const missingDeliverables = args.requiredDeliverables.filter((kind) => !liveBrowserFreshRoomDeliverables.includes(kind));
  const requiredSpecExists = existsSync(args.requiredSpec);
  const gates = BENCHMARK_UI_GATES.map((gate) => {
    // The two export-shaped gates carry STRUCTURED receipts and need extra validation: a string
    // listing in `gatesProven` is not enough — the matching field on the proof must also pass
    // `isDeliverableExportDownloadValid` / `isArtifactReopenValidationValid`. The handlers further
    // down in this map ALSO write a missing-with-blocker branch for these gates, so we only flip
    // to covered up here when both the receipt-string and the structured field agree.
    if (gate.id === "deliverable_export_download" && proof && provenByReceipt.has(gate.id) && exportDownloadValid) {
      const r = proof.deliverable_export_download!;
      return {
        ...gate,
        status: "covered" as const,
        evidence: `e2e/benchmark-ui-spreadsheetbench.spec.ts (download: ${r.filename}, ${r.bytes} bytes, magic ${r.magic.slice(0, 2)})`,
      };
    }
    if (gate.id === "artifact_reopen_validation" && proof && provenByReceipt.has(gate.id) && reopenValid) {
      const r = proof.artifact_reopen_validation!;
      return {
        ...gate,
        status: "covered" as const,
        evidence: `e2e/benchmark-ui-spreadsheetbench.spec.ts (reopened workbook: ${r.scorerResult}, ${r.cellsMatched})`,
      };
    }
    // Gates the live-browser run genuinely proves (fresh room, official upload, public ask, visible
    // progress, scorer handoff, no-memory) flip to 'covered' ONLY when an honest receipt proves
    // them. We exclude the two export-shaped gate ids here so the unconditional
    // `provenByReceipt.has(gate.id)` branch above can't bypass the structured-receipt check.
    if (
      proof &&
      provenByReceipt.has(gate.id) &&
      gate.id !== "deliverable_export_download" &&
      gate.id !== "artifact_reopen_validation"
    ) {
      return {
        ...gate,
        status: "covered" as const,
        evidence: `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: ${proofPath}, score ${proof.grade.score})`,
      };
    }
    if (gate.id === "public_nodeagent_invocation") {
      return {
        ...gate,
        status: "partial" as const,
        evidence: "tests/ui-benchmark-drive.spec.ts",
        blocker: "Covered in memory mode only; fresh live room benchmark route is not wired.",
      };
    }
    if (gate.id === "trace_video_artifacts") {
      return {
        ...gate,
        status: proof ? ("covered" as const) : ("partial" as const),
        evidence: proof ? "e2e/benchmark-ui-spreadsheetbench.spec.ts (attached graded-sheet screenshot)" : "playwright.config.ts",
        ...(proof ? {} : { blocker: "Generic Playwright traces/videos exist, but no official benchmark UI run artifact package is produced." }),
      };
    }
    if (gate.id === "deliverable_export_download") {
      // The covered-branch above only fires when the structured receipt validates. Reach this
      // fallback when (a) there is no proof, (b) the gate id is not in `gatesProven`, or (c) the
      // structured `deliverable_export_download` field is missing/tampered (zero bytes, wrong
      // magic, etc.). Surface the most actionable blocker for each case.
      const claimedButInvalid =
        !!proof && provenByReceipt.has(gate.id) && !exportDownloadValid;
      return {
        ...gate,
        status: "missing" as const,
        blocker: claimedButInvalid
          ? "Receipt claims `deliverable_export_download` but the structured field is missing or invalid (need downloaded === true, bytes > 0, magic starting with 'PK', filename set)."
          : proof?.gatesNotProven?.deliverable_export_download ??
            `${args.requiredSpec} cannot download a workbook: the live desktop room has no sheet->.xlsx export.`,
      };
    }
    if (gate.id === "artifact_reopen_validation") {
      const claimedButInvalid =
        !!proof && provenByReceipt.has(gate.id) && !reopenValid;
      return {
        ...gate,
        status: "missing" as const,
        blocker: claimedButInvalid
          ? "Receipt claims `artifact_reopen_validation` but the structured field is missing or invalid (need reopened === true, scorerResult === 'pass', correct === n > 0)."
          : proof?.gatesNotProven?.artifact_reopen_validation ??
            `${args.requiredSpec} has no exported file to reopen from disk; grading is cell-read.`,
      };
    }
    if (gate.id === "no_memory_mode_shortcut") {
      return {
        ...gate,
        status: requiredSpecExists ? "partial" as const : "missing" as const,
        blocker: requiredSpecExists
          ? "Spec exists but still needs proof that it never uses ?mode=memory."
          : "No fresh-room benchmark UI spec exists; current benchmark UI driver uses ?mode=memory.",
      };
    }
    return {
      ...gate,
      status: "missing" as const,
      blocker: `${args.requiredSpec} is not implemented for ${args.id}.`,
    };
  });

  // Status is DERIVED from the LIVE-BROWSER receipt, not from the pre-existing memory-mode partials
  // (public_nodeagent_invocation / trace_video_artifacts are 'partial' for every track regardless,
  // because a memory-mode driver and generic traces exist — that has never meant a track is anything
  // but 'missing'). So:
  //   - 'covered'  : every gate covered (impossible while the workbook export gates are missing).
  //   - 'partial'  : an honest receipt flipped real live-browser gates to covered, but export is still
  //                  missing (the genuine gap) — the honest landing state for SpreadsheetBench V1.
  //   - 'missing'  : no honest receipt; only the pre-existing memory-mode partials exist.
  const hasCoveredGate = gates.some((gate) => gate.status === "covered");
  const status: BenchmarkUiCoverageStatus = gates.every((gate) => gate.status === "covered")
    ? "covered"
    : hasCoveredGate
      ? "partial"
      : "missing";

  return {
    id: args.id,
    title: args.title,
    status,
    requiredDeliverables: args.requiredDeliverables,
    supportedByNonUiRunner: args.supportedByNonUiRunner,
    liveBrowserFreshRoomDeliverables,
    missingDeliverables,
    gates,
    currentEvidence: args.currentEvidence,
    requiredSpec: args.requiredSpec,
    blockers: [
      ...(proof ? [] : args.blockers),
      ...(proof
        ? [
            `Live-browser fresh-room run PASSED via ${proof.gradingMethod} grading (gradeGolden score ${proof.grade.score}, ${proof.grade.correct}/${proof.grade.n} cells, 0 fabrications); proof: ${proofPath}.`,
          ]
        : []),
      ...(missingDeliverables.length
        ? [`Missing live-browser fresh-room proof for deliverables: ${missingDeliverables.join(", ")} (no sheet->.xlsx export in the live room).`]
        : []),
    ],
  };
}
