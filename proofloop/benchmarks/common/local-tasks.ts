export type ExternalBenchmarkAdapterId = "finch" | "finauditing" | "workstreambench";

export type ExternalBenchmarkLocalTask = {
  schema: "proofloop-external-local-task-v1";
  adapterId: ExternalBenchmarkAdapterId;
  taskId: string;
  title: string;
  workflowId: string;
  benchmarkMapping: string;
  inputRefs: string[];
  userPrompt: string;
  expectedUiSignals: string[];
  expectedArtifacts: string[];
  officialScoreClaim: false;
};

const COMMON_EXPECTED_ARTIFACTS = [
  "browser-proof.json",
  "local-task-manifest.json",
  "visual-proof.png",
];

const TASKS: Record<ExternalBenchmarkAdapterId, ExternalBenchmarkLocalTask[]> = {
  finch: [
    {
      schema: "proofloop-external-local-task-v1",
      adapterId: "finch",
      taskId: "finch-local-financial-evidence-qa",
      title: "Financial evidence QA through NodeRoom story workflow",
      workflowId: "noderoom-story-revenue-variance",
      benchmarkMapping: "Maps Finch financial question answering onto NodeRoom's live spreadsheet/story proof path.",
      inputRefs: [
        "proofloop/datasets/proximitty-demo-underwriting/synthetic-financials.csv",
        "proofloop/accounting/datasets/variance.json",
      ],
      userPrompt: "Recompute the revenue variance and ground the answer in the visible spreadsheet evidence.",
      expectedUiSignals: [
        "Interactive story demo",
        "Computed D2 = C2 - B2 = 3,250.",
        "kept the human C2 edit",
      ],
      expectedArtifacts: COMMON_EXPECTED_ARTIFACTS,
      officialScoreClaim: false,
    },
  ],
  finauditing: [
    {
      schema: "proofloop-external-local-task-v1",
      adapterId: "finauditing",
      taskId: "finauditing-local-risk-and-misstatement-review",
      title: "Audit-style evidence review through NodeRoom story workflow",
      workflowId: "noderoom-story-revenue-variance",
      benchmarkMapping: "Maps FinAuditing source-grounded review onto a live UI task with visible evidence and final answer gates.",
      inputRefs: [
        "proofloop/datasets/proximitty-demo-underwriting/source-pack.md",
        "proofloop/datasets/proximitty-demo-underwriting/risk-notes.md",
        "proofloop/accounting/datasets/financial-statements.json",
      ],
      userPrompt: "Check the revenue change, identify evidence that supports it, and preserve the human-entered C2 value.",
      expectedUiSignals: [
        "Interactive story demo",
        "Computed D2 = C2 - B2 = 3,250.",
        "kept the human C2 edit",
      ],
      expectedArtifacts: COMMON_EXPECTED_ARTIFACTS,
      officialScoreClaim: false,
    },
  ],
  workstreambench: [
    {
      schema: "proofloop-external-local-task-v1",
      adapterId: "workstreambench",
      taskId: "workstreambench-local-spreadsheet-workstream",
      title: "Spreadsheet workstream execution through NodeRoom story workflow",
      workflowId: "noderoom-story-revenue-variance",
      benchmarkMapping: "Maps WorkstreamBench end-to-end spreadsheet workstreams onto the local live browser story proof.",
      inputRefs: [
        "proofloop/accounting/datasets/reconciliation.json",
        "proofloop/accounting/datasets/variance.json",
      ],
      userPrompt: "Run the visible spreadsheet workstream, recompute D2, and confirm the edited input remains intact.",
      expectedUiSignals: [
        "Interactive story demo",
        "Computed D2 = C2 - B2 = 3,250.",
        "kept the human C2 edit",
      ],
      expectedArtifacts: COMMON_EXPECTED_ARTIFACTS,
      officialScoreClaim: false,
    },
  ],
};

export function loadExternalBenchmarkLocalTasks(adapterId: ExternalBenchmarkAdapterId): ExternalBenchmarkLocalTask[] {
  return TASKS[adapterId].map((task) => ({ ...task, inputRefs: [...task.inputRefs], expectedUiSignals: [...task.expectedUiSignals], expectedArtifacts: [...task.expectedArtifacts] }));
}

export function externalBenchmarkLocalTaskIds(): ExternalBenchmarkAdapterId[] {
  return ["finch", "finauditing", "workstreambench"];
}
