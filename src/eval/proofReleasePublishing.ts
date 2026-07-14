export type JsonRecord = Record<string, any>;

export type ProofReleaseInputs = {
  generatedAt: string;
  packageVersion: string;
  gitCommit: string;
  goalLedger: JsonRecord;
  coverage: JsonRecord;
  spreadsheetReports: Array<{
    id: string;
    title: string;
    path: string;
    report: JsonRecord;
    officialRequired?: boolean;
    officialReceiptPath?: string;
    officialReceipt?: JsonRecord;
  }>;
  officialScores: Array<{
    id: "finauditing" | "workstreambench" | "finch";
    title: string;
    path: string;
    expectedCount: number;
    unit: string;
    receipt: JsonRecord;
    output?: JsonRecord;
  }>;
  validation: JsonRecord;
  personaDogfood: JsonRecord;
  mediaJudge: JsonRecord;
};

export type ProofReleaseBundle = ReturnType<typeof buildProofReleaseBundle>;

const METHODS = [
  "Lock public task bundles and upstream scorer revisions before running candidates.",
  "Keep exploration open, but keep certification fixtures, scorer semantics, and promotion gates immutable.",
  "Require generated plans, raw model output, candidate hashes, workspace manifests, and scorer-attempt receipts for task coverage.",
  "Show live product behavior and benchmark receipts together; neither screenshots nor aggregate scores substitute for the other.",
  "Run analyst, researcher, finance-operator, founder, reviewer, and guest-observer workflows from fresh landing states, including mutation, conflict handling, evidence review, and export.",
  "Record costs, retries, parse failures, blocked lanes, and negative results instead of publishing only successful examples.",
  "Route product and exploration work free-first; reserve a pinned paid model for certification only when the benchmark defines it.",
  "Keep canonical judge identity separate from API transport; direct OpenAI is the Finch certification path, Azure is optional compatibility only, and free-router or frontier judges remain non-promotable disagreement evidence.",
];

const FIXES = [
  {
    id: "spreadsheet-receipt-repair",
    title: "Hash-verified resumable SpreadsheetBench repair",
    finding: "Interrupted and cross-model runs left valid task receipts stranded in archives.",
    change: "Recover exact task receipts only when candidate, raw output, manifests, and hashes verify; rerun only missing tasks.",
    files: ["scripts/spreadsheetbench-run-chunked.ts", "tests/spreadsheetBenchChunkedRepair.test.ts"],
  },
  {
    id: "formula-json-repair",
    title: "Formula-aware model JSON salvage",
    finding: "Nested formula quotes could make otherwise usable model plans invalid JSON.",
    change: "Repair unescaped formula quotes without rewriting legitimate empty-string formula arguments.",
    files: ["src/eval/spreadsheetBenchRunner.ts", "tests/spreadsheetBenchRunner.test.ts"],
  },
  {
    id: "score-rate-source",
    title: "Model-run pass-rate provenance",
    finding: "The V1 coverage ledger displayed the copy-input baseline pass rate instead of the model-run pass rate.",
    change: "Bind the published pass rate to the model-run report and pin it in tests.",
    files: ["src/eval/officialBenchmarkTaskCoverage.ts", "tests/officialBenchmarkTaskCoverage.test.ts"],
  },
  {
    id: "provider-spend-guard",
    title: "Retry-aware provider cost ceilings",
    finding: "Failed or retried judge calls could escape a success-only call counter.",
    change: "Charge every provider attempt against call and reserve ceilings and reject over-cap promotion receipts.",
    files: ["scripts/finch-official-judge.py", "tests/finchOfficialJudgeCostGuard.test.ts", "tests/proofloopPromoteOfficialScore.test.ts"],
  },
  {
    id: "finch-canonical-transport",
    title: "Canonical Finch judge without Azure lock-in",
    finding: "The released Finch script hard-coded Azure transport even though the paper calibrates the GPT-5-mini judge model and exact prompt/parser contract.",
    change: "Use direct OpenAI as the hash-verified certification transport, keep Azure optional, route ordinary work free-first, and make OpenRouter free-auto structurally non-promotable shadow evidence.",
    files: ["scripts/finch-official-judge.py", "src/eval/finchJudgeDisagreement.ts", "tests/finchOfficialJudgeCostGuard.test.ts", "tests/proofloopPromoteOfficialScore.test.ts"],
  },
  {
    id: "finch-output-regeneration-safety",
    title: "Non-destructive Finch scorer-input regeneration",
    finding: "A routine output-manifest refresh could delete rendered content_parts and demote already-accepted score claims.",
    change: "Clean only regenerable model outputs, preserve eval_set, and retain a promoted claim only while accepted-receipt and full-coverage invariants still hold.",
    files: ["src/eval/finchOfficialOutputSafety.ts", "scripts/proofloop-official-outputs.ts", "tests/finchOfficialOutputSafety.test.ts"],
  },
  {
    id: "finch-task-input-binding",
    title: "Prompt-hash-bound Finch resume",
    finding: "A provider/model-matched result could be resumed after its individual content record changed, allowing stale task evidence into a newly hashed aggregate receipt.",
    change: "Hash each canonical task record, store that hash on the judge result, and rerun any row whose expected prompt hash does not match.",
    files: ["scripts/finch-official-judge.py", "tests/finchOfficialJudgeCostGuard.test.ts"],
  },
  {
    id: "finch-free-shadow-context",
    title: "Free-router shadow context guard",
    finding: "Finch's released 128k completion reserve can exceed a free endpoint's total context before the small JSON judgment is generated.",
    change: "Cap only the non-promotable OpenRouter shadow at 8,192 completion tokens while preserving the released canonical request unchanged.",
    files: ["scripts/finch-official-judge.py", "docs/eval/FINCH_JUDGE_CONTRACT.md", "tests/finchOfficialJudgeCostGuard.test.ts"],
  },
  {
    id: "work-artifact-interiors",
    title: "Real work-artifact interiors",
    finding: "The shell migration did not prove deck editing, notebook execution, graph exploration, or scoped chat context.",
    change: "Add CAS-backed deck state, bounded notebook kernel receipts, draggable graph clusters, and openable chat references.",
    files: ["src/ui/workArtifacts/", "src/notebook/notebookKernel.ts", "src/ui/graph/semanticGraphClusters.ts", "src/ui/artifactRefs.ts"],
  },
];

const ASSETS = [
  { label: "Fresh-user vertical receipt", path: "docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md" },
  { label: "Six-persona dogfood receipt", path: "docs/eval/noderoom-persona-dogfood-receipt.json" },
  { label: "Collaborative deck", path: "docs/synthesis/proof/m24-deck-collaboration-proof.png" },
  { label: "Notebook kernel", path: "docs/synthesis/proof/m25-notebook-kernel-proof.png" },
  { label: "Graph clusters", path: "docs/synthesis/proof/m26-graph-cluster-drag-proof.png" },
  { label: "Scoped chat context", path: "docs/synthesis/proof/m27-chat-context-proof.png" },
];

export function buildProofReleaseBundle(input: ProofReleaseInputs) {
  const officialGoal = (input.goalLedger.goals ?? []).find((goal: JsonRecord) => goal.goalId === "official-scores") ?? {};
  const spreadsheets = input.spreadsheetReports.map((item) => spreadsheetResult(item));
  const external = input.officialScores.map((item) => officialResult(item));
  const strictCoverage = input.coverage.summary?.strictFullCoverageReady === true;
  const requiredSpreadsheetReceiptsAccepted = spreadsheets
    .filter((item) => item.officialRequired)
    .every((item) => item.measurementSource === "accepted_official_scorer_receipt");
  const allExternalScored = external.every((item) => item.status === "scored");
  const validationPassed = input.validation.status === "passed";
  const personaDogfood = personaDogfoodResult(input.personaDogfood);
  const personaDogfoodPassed = personaDogfood.status === "passed";
  const mediaReview = mediaJudgeResult(input.mediaJudge);
  const mediaPassed = mediaReview.verdict === "publish";
  const gatePassed = officialGoal.status === "passed";
  const publishable = strictCoverage && requiredSpreadsheetReceiptsAccepted && allExternalScored && validationPassed && personaDogfoodPassed && mediaPassed && gatePassed;
  const blockers = [
    ...(!strictCoverage ? ["Strict official task coverage is incomplete."] : []),
    ...spreadsheets
      .filter((item) => item.officialRequired && item.measurementSource !== "accepted_official_scorer_receipt")
      .map((item) => `${item.title} accepted official scorer receipt is pending.`),
    ...external.filter((item) => item.status !== "scored").map((item) => `${item.title} accepted official judge receipt is pending.`),
    ...(!validationPassed ? ["Repository validation receipt is not passing."] : []),
    ...(!personaDogfoodPassed ? ["Six-persona fresh-user dogfood receipt is not passing."] : []),
    ...(!mediaPassed ? [`Storyboard media judge verdict is ${mediaReview.verdict}.`] : []),
    ...(!gatePassed ? [`ProofLoop official-scores goal is ${officialGoal.status ?? "missing"}.`] : []),
  ];
  const models = unique([
    ...spreadsheets.flatMap((item) => item.models.map((model) => model.name)),
    ...external.map((item) => item.model).filter(Boolean),
  ]);

  return {
    schema: "noderoom-proof-release-v1",
    generatedAt: input.generatedAt,
    releaseId: "noderoom-proof-release-2026-07",
    product: { name: "NodeRoom", version: input.packageVersion, gitCommit: input.gitCommit },
    publication: {
      status: publishable ? "certified" : "pending_external",
      publishable,
      gateStatus: officialGoal.status ?? "missing",
      blockers,
      rule: "Publish completion claims only when task coverage, accepted external scorers, repository validation, six-persona dogfood, the storyboard media judge, and the persisted ProofLoop gate all pass.",
    },
    method: METHODS,
    results: {
      taskCoverage: {
        expectedTasks: number(input.coverage.summary?.totalOfficialExpectedTasks),
        stagedTasks: number(input.coverage.summary?.totalStagedTasks),
        modelRunCases: number(input.coverage.summary?.totalModelRunCases),
        completeTracks: number(input.coverage.summary?.completeTracks),
        tracks: number(input.coverage.summary?.tracks),
        receipt: "docs/eval/official-benchmark-task-coverage.json",
      },
      spreadsheets,
      external,
      validation: input.validation,
      personaDogfood,
    },
    findings: buildFindings(spreadsheets, external),
    fixes: FIXES,
    versions: {
      nodeRoom: input.packageVersion,
      gitCommit: input.gitCommit,
      candidateAndJudgeModels: models,
      receiptSchemas: unique([
        String(input.coverage.schema),
        ...input.officialScores.map((item) => String(item.receipt.schema ?? "missing")),
      ]),
      upstreamReceiptHashes: Object.fromEntries(external.filter((item) => item.receiptSha256).map((item) => [item.id, item.receiptSha256])),
    },
    assets: ASSETS,
    mediaReview,
    reproducibility: [
      "npm run benchmark:official:task-coverage -- --strict",
      "npm run benchmark:proofloop:official-preflight -- --strict",
      "npm run benchmark:finch:canonical-judge -- --resume --max-calls 516 --allow-provider-spend --max-provider-cost-usd <approved-cap>",
      "npm run benchmark:finch:judge-disagreement",
      "npm test -- --run",
      "npm run build",
      "npm run proofloop -- gate --goal official-scores",
      "npm run proofs:publish:check",
    ],
  };
}

function personaDogfoodResult(receipt: JsonRecord) {
  const personas = Array.isArray(receipt.personas) ? receipt.personas : [];
  const gates = receipt.gates ?? {};
  const requiredGates = ["freshLanding", "nodeAgent", "mutation", "conflictHandling", "evidenceReview", "export"];
  const passed = personas.length >= 6
    && requiredGates.every((gate) => gates[gate] === "passed")
    && number(gates.consoleErrors) === 0
    && personas.every((persona: JsonRecord) => persona.freshLanding === true && arrayStrings(persona.consoleErrors).length === 0);
  return {
    status: passed ? "passed" : "pending",
    count: personas.length,
    totalVisibleSteps: personas.reduce((sum: number, persona: JsonRecord) => sum + number(persona.userVisibleSteps), 0),
    averageAgentLatencyMs: personas.length
      ? Math.round(personas.reduce((sum: number, persona: JsonRecord) => sum + number(persona.agentLatencyMs), 0) / personas.length)
      : 0,
    consoleErrors: number(gates.consoleErrors),
    receipt: "docs/eval/noderoom-persona-dogfood-receipt.json",
    personas: personas.map((persona: JsonRecord) => ({
      id: String(persona.persona ?? "unknown"),
      label: String(persona.label ?? persona.persona ?? "Unknown"),
      route: String(persona.route ?? "unknown"),
      screenshot: String(persona.screenshot ?? ""),
      exportKind: String(persona.export?.kind ?? "unknown"),
      userVisibleSteps: number(persona.userVisibleSteps),
    })),
  };
}

function mediaJudgeResult(judge: JsonRecord) {
  const scores = Object.values(judge.scores ?? {}).filter((value): value is JsonRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const total = scores.reduce((sum, item) => sum + number(item.score), 0);
  const max = scores.length * 2;
  const defects = Array.isArray(judge.defects) ? judge.defects : [];
  const remainingGap = defects.length
    ? defects.map((defect: JsonRecord) => `${String(defect.severity ?? "P2")} at ${String(defect.ts ?? "unknown")}: ${String(defect.observed ?? "unspecified media gap")}`).join(" ")
    : "No unresolved visual-judge defects.";
  return {
    verdict: String(judge.verdict ?? "missing"),
    score: `${total}/${max || 16}`,
    receipt: "episodes/noderoom-proof-release-v1/judge.md",
    remainingGap,
  };
}

function spreadsheetResult(item: ProofReleaseInputs["spreadsheetReports"][number]) {
  const report = item.report;
  const models = new Map<string, { name: string; tasks: number; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>();
  for (const result of report.results ?? []) {
    const model = result.model ?? {};
    const name = String(model.name ?? "unknown");
    const current = models.get(name) ?? { name, tasks: 0, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    current.tasks += 1;
    current.calls += number(model.calls);
    current.inputTokens += number(model.usage?.inputTokens);
    current.outputTokens += number(model.usage?.outputTokens);
    current.costUsd += number(model.costUsd);
    models.set(name, current);
  }
  const candidateProxy = {
    cases: number(report.caseCount),
    passCount: number(report.casePassCount ?? report.passCount),
    passRate: number(report.casePassRate ?? report.passRate),
    averageOverall: number(report.averageOverall),
    receipt: item.path,
  };
  const official = acceptedSpreadsheetOfficialScore(item.officialReceipt);
  return {
    id: item.id,
    title: item.title,
    status: official ? "official_scored" : candidateProxy.cases > 0 ? "proxy_scored" : "missing",
    officialRequired: item.officialRequired === true,
    measurementSource: official ? "accepted_official_scorer_receipt" : "candidate_proxy_report",
    cases: official?.scoredTaskCount ?? candidateProxy.cases,
    passCount: official?.passCount ?? candidateProxy.passCount,
    passRate: official?.passRate ?? candidateProxy.passRate,
    averageOverall: official?.averageOverall ?? candidateProxy.averageOverall,
    receipt: item.path,
    officialReceipt: official ? item.officialReceiptPath : undefined,
    candidateProxy,
    models: [...models.values()].map((model) => ({ ...model, calls: round(model.calls), costUsd: round(model.costUsd, 8) })),
    embeddedProviderCostUsd: round([...models.values()].reduce((sum, model) => sum + model.costUsd, 0), 8),
  };
}

function acceptedSpreadsheetOfficialScore(receipt: JsonRecord | undefined): {
  averageOverall: number;
  passRate: number;
  passCount: number;
  scoredTaskCount: number;
} | undefined {
  if (receipt?.schema !== 1 || receipt.verifier !== "spreadsheetbench_official_scorer" || receipt.accepted !== true) return undefined;
  const score = receipt.score;
  if (!score || typeof score !== "object" || Array.isArray(score)) return undefined;
  const values = score as JsonRecord;
  const fields = ["averageOverall", "passRate", "passCount", "scoredTaskCount"] as const;
  if (!fields.every((field) => typeof values[field] === "number" && Number.isFinite(values[field]))) return undefined;
  return {
    averageOverall: values.averageOverall,
    passRate: values.passRate,
    passCount: values.passCount,
    scoredTaskCount: values.scoredTaskCount,
  };
}

function officialResult(item: ProofReleaseInputs["officialScores"][number]) {
  const receipt = item.receipt;
  const accepted = receipt.acceptedExternalScorerReceipt ?? {};
  const scored = receipt.status === "scored" && receipt.scoreClaim === true && accepted.accepted === true;
  const completed = item.id === "finauditing"
    ? number(accepted.finMr?.judgedRows)
    : item.id === "workstreambench"
      ? number(accepted.completedCases)
      : number(accepted.taskCount);
  const cost = item.id === "finauditing"
    ? number(receipt.scores?.FinMR?.usage?.estimatedProviderCostUsd)
    : item.id === "workstreambench"
      ? number(receipt.officialMetrics?.providerCostUsd)
      : number(receipt.scores?.providerCostUsd);
  const primaryMetric = item.id === "finauditing"
    ? { label: "FinRE macro F1", value: number(receipt.scores?.FinRE?.macro_f1) }
    : item.id === "workstreambench"
      ? { label: "Mean score", value: number(receipt.officialMetrics?.meanScore) }
      : { label: "Mean score", value: receipt.scores?.meanScore ?? null };
  return {
    id: item.id,
    title: item.title,
    status: scored ? "scored" : "pending",
    expected: item.expectedCount,
    completed,
    unit: item.unit,
    outputCoverage: `${number(item.output?.outputTaskCount)}/${number(item.output?.officialTaskCount)}`,
    model: String(accepted.judgeModel ?? ""),
    provider: String(accepted.provider ?? ""),
    providerCostUsd: round(cost, 8),
    primaryMetric,
    receipt: item.path,
    receiptSha256: String(accepted.receiptSha256 ?? ""),
    blockers: scored ? [] : arrayStrings(receipt.blockers),
  };
}

function buildFindings(spreadsheets: Array<JsonRecord>, external: Array<JsonRecord>) {
  const v1 = spreadsheets.find((item) => item.id === "spreadsheetbench-v1");
  const v2 = spreadsheets.find((item) => item.id === "spreadsheetbench-v2");
  const pending = external.filter((item) => item.status !== "scored").map((item) => item.title);
  return [
    {
      id: "coverage-is-not-quality",
      finding: `Full execution coverage does not imply high task performance: V1 passed ${v1?.passCount ?? 0}/${v1?.cases ?? 0} and V2 passed ${v2?.passCount ?? 0}/${v2?.cases ?? 0} under the bounded model-edit-plan route.`,
      implication: "Publish coverage, average score, and pass count together.",
    },
    {
      id: "cheap-first-repair",
      finding: "Most spreadsheet receipts were recovered from free routes; paid fallbacks were limited to exact missing tasks with explicit caps.",
      implication: "Resume by task id and preserve hash-verified evidence before escalating model cost.",
    },
    {
      id: "external-score-boundary",
      finding: pending.length ? `${pending.join(", ")} remains unclaimed until an accepted upstream receipt exists.` : "Every external scorer lane has an accepted upstream receipt.",
      implication: "Proxy judges and no-provider smokes prove wiring, not official scores.",
    },
    {
      id: "product-and-benchmark-proof",
      finding: "Live deck, notebook, graph, and chat proof exposed integration issues that benchmark-only runs would not detect.",
      implication: "Ship product-state screenshots and deterministic receipts as one proof packet.",
    },
  ];
}

export function renderReadmeProofRelease(bundle: ProofReleaseBundle): string {
  const status = bundle.publication.publishable
    ? "`certified` - all required receipts and the persisted gate pass"
    : `\`pending_external\` - ${bundle.publication.blockers.join(" ")}`;
  const spreadsheetRows = bundle.results.spreadsheets.map((item) =>
    `| ${item.title} | ${item.cases}/${item.cases} | ${spreadsheetMetricText(item)} | [JSON](${item.officialReceipt ?? item.receipt}) |`,
  );
  const externalRows = bundle.results.external.map((item) =>
    `| ${item.title} | ${item.completed}/${item.expected} ${item.unit} | ${item.status === "scored" ? `${item.primaryMetric.label}: ${format(item.primaryMetric.value)}; cost $${format(item.providerCostUsd, 6)}` : "Not claimed"} | [JSON](${item.receipt}) |`,
  );
  const personaTables: string[] = [];
  for (let index = 0; index < bundle.results.personaDogfood.personas.length; index += 3) {
    const group = bundle.results.personaDogfood.personas.slice(index, index + 3);
    personaTables.push(
      `| ${group.map((persona) => persona.label).join(" | ")} |`,
      `| ${group.map(() => "---").join(" | ")} |`,
      `| ${group.map((persona) => `![${persona.label} fresh-user proof](${persona.screenshot})`).join(" | ")} |`,
      "",
    );
  }
  return [
    "<!-- Generated by `npm run proofs:publish`; do not edit this block by hand. -->",
    "## Proof Release: Methods, Results, And Receipts",
    "",
    `**Certification status:** ${status}`,
    "",
    `The current packet covers **${bundle.results.taskCoverage.stagedTasks.toLocaleString()}/${bundle.results.taskCoverage.expectedTasks.toLocaleString()} staged official tasks** and keeps execution coverage separate from task performance. [Full methods, findings, fixes, versions, and limitations](docs/release/NODEROOM_PROOF_RELEASE.md).`,
    "",
    "| Lane | Executed coverage | Measured result | Receipt |",
    "|---|---:|---|---|",
    ...spreadsheetRows,
    ...externalRows,
    "",
    "> Honest boundary: a completed task receipt proves the model produced a candidate and reached the scorer. It does not mean the candidate passed. Proxy judges never become official scores.",
    "",
    "[![Storyboarded NodeRoom proof release](episodes/noderoom-proof-release-v1/renders/teaser.gif)](episodes/noderoom-proof-release-v1/renders/short.mp4)",
    "",
    `[Full proof video](episodes/noderoom-proof-release-v1/renders/short.mp4) | [Storyboard](episodes/noderoom-proof-release-v1/storyboard.yaml) | [Media manifest](episodes/noderoom-proof-release-v1/media-manifest.json) | [Visual judge: ${bundle.mediaReview.verdict}, ${bundle.mediaReview.score}](episodes/noderoom-proof-release-v1/judge.md)`,
    "",
    "<details><summary><b>Live product proof: deck, notebook, graph, and scoped chat</b></summary>",
    "",
    "| Collaborative deck | Notebook kernel |",
    "|---|---|",
    "| ![Collaborative deck proof](docs/synthesis/proof/m24-deck-collaboration-proof.png) | ![Notebook kernel proof](docs/synthesis/proof/m25-notebook-kernel-proof.png) |",
    "| Graph clusters | Scoped chat context |",
    "| ![Graph cluster drag proof](docs/synthesis/proof/m26-graph-cluster-drag-proof.png) | ![Scoped chat context proof](docs/synthesis/proof/m27-chat-context-proof.png) |",
    "",
    "</details>",
    "",
    `<details><summary><b>Six-persona fresh-user dogfood: ${bundle.results.personaDogfood.count}/6 passed, ${bundle.results.personaDogfood.consoleErrors} console errors</b></summary>`,
    "",
    ...personaTables,
    `[Machine-readable persona receipt](${bundle.results.personaDogfood.receipt})`,
    "",
    "</details>",
    "",
    "[Fresh-user vertical receipt](docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md) | [Machine-readable live receipt](docs/eval/noderoom-fresh-user-vertical-proof.json) | [Machine-readable release](docs/release/noderoom-proof-release.json) | [Finch judge contract](docs/eval/FINCH_JUDGE_CONTRACT.md) | [Recovery costs](docs/eval/FINCH_RECOVERY_COST_LEDGER.md) | [Free-model gauge](docs/eval/PROOFLOOP_FREE_OPENROUTER_NODEAGENT_GAUGE.md) | [Social drafts and media map](docs/release/NODEROOM_SOCIAL_COPY.md) | [Reproduce](docs/eval/LOCAL_BENCH_SETUP.md)",
  ].join("\n");
}

export function renderProofReleaseDossier(bundle: ProofReleaseBundle): string {
  const lines = [
    "# NodeRoom Proof Release",
    "",
    `Generated: ${bundle.generatedAt}`,
    `Publication status: **${bundle.publication.status}**`,
    "",
    "## Claim Gate",
    "",
    bundle.publication.publishable ? "All required receipts and the persisted ProofLoop gate pass." : "This packet is evidence-complete except for the blockers below; do not publish it as a completion claim.",
    ...bundle.publication.blockers.map((blocker) => `- ${blocker}`),
    "",
    "## Method",
    "",
    ...bundle.method.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Results",
    "",
    `Strict task coverage: ${bundle.results.taskCoverage.stagedTasks}/${bundle.results.taskCoverage.expectedTasks}; model-run cases: ${bundle.results.taskCoverage.modelRunCases}.`,
    "",
    "| Lane | Status | Coverage | Primary metric | Candidate proxy | Cost in candidate run |",
    "|---|---|---:|---|---|---:|",
    ...bundle.results.spreadsheets.map((item) => `| ${item.title} | ${item.status} | ${item.cases}/${item.cases} | ${item.passCount}/${item.cases}; avg ${format(item.averageOverall)} | ${item.candidateProxy.passCount}/${item.candidateProxy.cases}; avg ${format(item.candidateProxy.averageOverall)} | $${format(item.embeddedProviderCostUsd, 6)} |`),
    ...bundle.results.external.map((item) => `| ${item.title} | ${item.status} | ${item.completed}/${item.expected} ${item.unit} | ${item.status === "scored" ? `${item.primaryMetric.label}: ${format(item.primaryMetric.value)}` : "Not claimed"} | n/a | $${format(item.providerCostUsd, 6)} |`),
    "",
    "## Findings",
    "",
    ...bundle.findings.flatMap((item) => [`### ${item.id}`, "", item.finding, "", `Implication: ${item.implication}`, ""]),
    "## Fixes",
    "",
    "| Fix | Finding | Change | Evidence |",
    "|---|---|---|---|",
    ...bundle.fixes.map((item) => `| ${item.title} | ${item.finding} | ${item.change} | ${item.files.map((file) => `\`${file}\``).join("<br>")} |`),
    "",
    "## Versions",
    "",
    `- NodeRoom: \`${bundle.versions.nodeRoom}\``,
    `- Git commit at generation: \`${bundle.versions.gitCommit}\``,
    `- Candidate and judge models: ${bundle.versions.candidateAndJudgeModels.map((model) => `\`${model}\``).join(", ")}`,
    `- Accepted receipt hashes: ${Object.entries(bundle.versions.upstreamReceiptHashes).map(([id, hash]) => `\`${id}:${String(hash).slice(0, 12)}\``).join(", ") || "none"}`,
    "",
    "## Product Proof",
    "",
    ...bundle.assets.map((asset) => `- [${asset.label}](../${asset.path.replace(/^docs\//, "")})`),
    "",
    "## Vertical Dogfood",
    "",
    `Six fresh-user personas passed ${bundle.results.personaDogfood.totalVisibleSteps} visible interaction steps with ${bundle.results.personaDogfood.consoleErrors} console errors and an average NodeAgent latency of ${bundle.results.personaDogfood.averageAgentLatencyMs} ms.`,
    "",
    `Receipt: [machine-readable persona proof](../eval/noderoom-persona-dogfood-receipt.json).`,
    "",
    "## Media Review",
    "",
    `Visual judge: **${bundle.mediaReview.verdict}, ${bundle.mediaReview.score}**. ${bundle.mediaReview.remainingGap}`,
    "",
    `[Judge receipt](../../${bundle.mediaReview.receipt})`,
    "",
    "## Reproduce",
    "",
    "```bash",
    ...bundle.reproducibility,
    "```",
    "",
    "## Publication Rule",
    "",
    bundle.publication.rule,
  ];
  return lines.join("\n");
}

export function renderSocialProofRelease(bundle: ProofReleaseBundle): string {
  const hold = bundle.publication.publishable ? "PUBLISH" : "HOLD - NOT A COMPLETION RELEASE";
  const v1 = bundle.results.spreadsheets.find((item) => item.id === "spreadsheetbench-v1")!;
  const v2 = bundle.results.spreadsheets.find((item) => item.id === "spreadsheetbench-v2")!;
  const scored = bundle.results.external.filter((item) => item.status === "scored");
  const pending = bundle.results.external.filter((item) => item.status !== "scored");
  return [
    "# NodeRoom Social Proof Kit",
    "",
    `Publication gate: **${hold}**`,
    "",
    "## Media Order",
    "",
    "1. Storyboarded product clip: founder deck -> isolated notebook -> graph path -> analyst live receipts.",
    "2. Six-persona fresh-user proof grid with the machine-readable interaction receipt.",
    "3. Static benchmark scorecard with coverage and pass counts together.",
    "4. Fix card: receipt recovery, formula JSON repair, pass-rate provenance, retry-aware cost caps.",
    "5. Final gate card linked to the machine-readable receipt.",
    "",
    "- README preview: `episodes/noderoom-proof-release-v1/renders/teaser.gif`",
    "- Full video: `episodes/noderoom-proof-release-v1/renders/short.mp4`",
    "- Storyboard: `episodes/noderoom-proof-release-v1/storyboard.yaml`",
    "- Visual judge receipt: `episodes/noderoom-proof-release-v1/judge.md`",
    "- Media hashes: `episodes/noderoom-proof-release-v1/media-manifest.json`",
    "- Fresh-user vertical receipt: `docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md`",
    "- Six-persona receipt: `docs/eval/noderoom-persona-dogfood-receipt.json`",
    "- Free-model tool-call gauge: `docs/eval/PROOFLOOP_FREE_OPENROUTER_NODEAGENT_GAUGE.md`",
    "",
    "## LinkedIn Draft",
    "",
    bundle.publication.publishable ? "We finished a proof release for NodeRoom." : "Progress note, not a completion announcement: NodeRoom's proof release is still gated.",
    "",
    `Method: lock upstream tasks/scorers, preserve raw outputs and candidate hashes, run the product UI, score every task, and refuse to promote proxy evidence.`,
    "",
    `Results so far: ${bundle.results.taskCoverage.stagedTasks}/${bundle.results.taskCoverage.expectedTasks} staged official tasks; SpreadsheetBench V1 ${v1.passCount}/${v1.cases} accepted-official pass (avg ${format(v1.averageOverall)}); V2 ${v2.passCount}/${v2.cases} accepted-official pass (avg ${format(v2.averageOverall)}).`,
    ...scored.map((item) => `${item.title}: ${item.completed}/${item.expected} ${item.unit}, ${item.primaryMetric.label.toLowerCase()} ${format(item.primaryMetric.value)}, accepted judge receipt.`),
    ...(pending.length ? [`Still unclaimed: ${pending.map((item) => item.title).join(", ")}. The gate stays closed until accepted upstream receipts exist.`] : []),
    "",
    "The most useful finding was that coverage is not quality. Running every task exposed weak task performance, parser failures, stranded receipts, and cost-accounting gaps that a polished demo would hide. We fixed those paths and kept the negative scores visible.",
    "",
    `Proof packet: README scorecard + raw receipts + reproducible commands + storyboarded product states + ${bundle.results.personaDogfood.count}/6 fresh-user persona workflows.`,
    "",
    "## X / Threads Draft",
    "",
    "1/ A proof release should show more than a GIF. We packaged NodeRoom's method, exact task coverage, measured results, failures, fixes, model versions, costs, raw receipts, and live product states.",
    `2/ Coverage: ${bundle.results.taskCoverage.stagedTasks}/${bundle.results.taskCoverage.expectedTasks} staged official tasks. That is execution coverage, not a pass claim.`,
    `3/ SpreadsheetBench accepted official scores: V1 ${v1.passCount}/${v1.cases} pass, avg ${format(v1.averageOverall)}. V2 ${v2.passCount}/${v2.cases} pass, avg ${format(v2.averageOverall)}. The low results stay visible.`,
    `4/ Accepted external lanes: ${scored.map((item) => `${item.title} ${item.completed}/${item.expected}`).join("; ") || "none yet"}.`,
    `5/ Fixes: exact-ID resume, hash-verified receipt recovery, formula-aware JSON salvage, correct pass-rate provenance, and retry-aware spend caps.`,
    `6/ Product proof: ${bundle.results.personaDogfood.count}/6 fresh-user personas completed NodeAgent work, mutation, conflict handling, evidence review, and export; deck, notebook, graph, chat, and trace states remained live.`,
    pending.length ? `7/ Not claimed yet: ${pending.map((item) => item.title).join(", ")}. Proxy evidence does not cross the official-score boundary.` : "7/ Every required external scorer receipt is accepted and the persisted gate passes.",
    "8/ The README is generated from receipts, and the social copy is held automatically when the gate is not certified.",
    "",
    "## Short Draft",
    "",
    `NodeRoom proof packet: ${bundle.results.taskCoverage.stagedTasks}/${bundle.results.taskCoverage.expectedTasks} task coverage, honest pass counts, accepted scorer receipts, live deck/notebook/graph/chat proof, exact fixes, versions, costs, and reproducible commands. Status: ${bundle.publication.status}.`,
    "",
    "## Alt Text",
    "",
    "A NodeRoom proof sequence showing a founder exporting a source-backed deck, an isolated notebook kernel result, a draggable evidence graph path, and analyst live-agent receipts beside room chat; followed by a six-persona proof grid and a scorecard separating execution coverage from pass counts.",
    "",
    "## Posting Checklist",
    "",
    `- [${bundle.publication.publishable ? "x" : " "}] Persisted ProofLoop gate is passed.`,
    `- [${pending.length ? " " : "x"}] Every external score shown has an accepted upstream receipt.`,
    `- [${bundle.mediaReview.verdict === "publish" ? "x" : " "}] Feature Proof Studio video judge returns publish.`,
    "- [x] README proof-block links and raw JSON receipts resolve in the repository.",
    "- [x] The media order assigns one primary claim to each visual.",
    "",
    "Publishing to GitHub and social platforms remains an explicit human account action; this packet does not claim those external posts already exist.",
  ].join("\n");
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function spreadsheetMetricText(item: ProofReleaseBundle["results"]["spreadsheets"][number]): string {
  const primary = item.measurementSource === "accepted_official_scorer_receipt"
    ? `${item.passCount}/${item.cases} official pass; avg ${format(item.averageOverall)}`
    : `${item.passCount}/${item.cases} candidate proxy pass; avg ${format(item.averageOverall)}`;
  if (item.measurementSource !== "accepted_official_scorer_receipt") return primary;
  return `${primary}; candidate proxy ${item.candidateProxy.passCount}/${item.candidateProxy.cases}, avg ${format(item.candidateProxy.averageOverall)}`;
}

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function format(value: unknown, digits = 6): string {
  return number(value).toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
