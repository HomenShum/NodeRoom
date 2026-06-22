import { existsSync } from "node:fs";

export type OfficialBenchmarkUiId = "bankertoolbench" | "spreadsheetbench-v1" | "spreadsheetbench-v2";

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
} = {}): OfficialBenchmarkUiCoverageReport {
  const tracks = [
    bankerToolBenchUiTrack(),
    spreadsheetBenchV1UiTrack(),
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

function bankerToolBenchUiTrack(): BenchmarkUiCoverageTrack {
  return buildTrack({
    id: "bankertoolbench",
    title: "BankerToolBench live browser deliverable package",
    requiredDeliverables: ["workbook", "presentation", "document", "pdf"],
    supportedByNonUiRunner: ["workbook", "presentation", "document", "pdf", "csv", "image"],
    currentEvidence: [
      "src/eval/bankerToolBenchRunner.ts",
      "src/eval/bankerToolBenchNodeAgentGeneral.ts",
      "tests/bankerToolBenchRunner.test.ts",
      "tests/bankerToolBenchNodeAgentGeneral.test.ts",
      "docs/qa/browser-e2e-flow-inventory.json",
    ],
    requiredSpec: "e2e/benchmark-ui-bankertoolbench.spec.ts",
    blockers: [
      "No Playwright spec creates a fresh live room, uploads official BankerToolBench inputs, sends the official prompt, and downloads the full Excel/PPTX/DOCX/PDF package.",
      "No browser-run package is handed to the official Gandalf verifier.",
    ],
  });
}

function spreadsheetBenchV1UiTrack(): BenchmarkUiCoverageTrack {
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
    ],
    requiredSpec: "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    blockers: [
      "Current Playwright benchmark driver uses memory mode and demo sheet cells, not a fresh live room with official workbook upload/export.",
      "No browser-run workbook is downloaded, reopened, and scored against the official V1 policy.",
    ],
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
}): BenchmarkUiCoverageTrack {
  const liveBrowserFreshRoomDeliverables: BenchmarkDeliverableKind[] = [];
  const missingDeliverables = args.requiredDeliverables.filter((kind) => !liveBrowserFreshRoomDeliverables.includes(kind));
  const requiredSpecExists = existsSync(args.requiredSpec);
  const gates = BENCHMARK_UI_GATES.map((gate) => {
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
        status: "partial" as const,
        evidence: "playwright.config.ts",
        blocker: "Generic Playwright traces/videos exist, but no official benchmark UI run artifact package is produced.",
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

  return {
    id: args.id,
    title: args.title,
    status: "missing",
    requiredDeliverables: args.requiredDeliverables,
    supportedByNonUiRunner: args.supportedByNonUiRunner,
    liveBrowserFreshRoomDeliverables,
    missingDeliverables,
    gates,
    currentEvidence: args.currentEvidence,
    requiredSpec: args.requiredSpec,
    blockers: [
      ...args.blockers,
      ...(missingDeliverables.length
        ? [`Missing live-browser fresh-room proof for deliverables: ${missingDeliverables.join(", ")}.`]
        : []),
    ],
  };
}
