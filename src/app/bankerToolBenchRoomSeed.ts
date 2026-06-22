import type { DataframeColumn } from "../engine/types";

export const BTB_UI_EVIDENCE = {
  roomTitle: "BankerToolBench NodeAgent Evidence",
  taskId: "btb-067cb834",
  taskKind: "Comcast take-private teaser with named PPTX/PDF, workbook, memo, logo, and receipts",
  benchmarkTaskCount: 100,
  selectedReward: "1.0000",
  selectedRawScore: "423 / 423",
  selectedTrial: "btb-067cb834__5YUViHc",
  selectedJob: "btb-full-nodeagent-pass5-btb-067cb834",
  generalOnlyTaskId: "btb-067cb834",
  generalOnlyReward: "0.6903",
  generalOnlyRawScore: "292 / 423",
  generalOnlyTrial: "btb-067cb834__VVtJCPP",
  generalOnlyJob: "btb-general-only-strict-takeprivate-v2-btb-067cb834",
  generalOnlySample: "strict no-fallback actual take-private teaser task; source-skill planner; source-driven VDR writer; named two-slide PPTX/PDF/DOCX package; zero exceptions; replay writers disabled; baseline was 0.0426",
  model: "source-skill planner (0 model calls; z-ai/glm-5.2 configured for non-structured plans)",
  plannerStopReason: "source_skill",
  plannerTransport: "source-skill",
  capabilityProbeJob: "btb-clean-capability-full100-parallel-v3-gpt41mini",
  capabilityProbeMean: "0.251875",
  capabilityProbeTasks: "100 / 100",
  capabilityProbeRaw: "reward range 0.0430-0.6310; top tasks btb-b486dc21 0.6310, btb-c6926dfc 0.6041, btb-17d8c86f 0.5863, btb-f205ac8c 0.5679, btb-31f70ac1 0.5550",
  capabilityProbeTrials: "100 Harbor/Gandalf trials under btb-clean-capability-full100-parallel-v3-gpt41mini-*",
  capabilityProbeModel: "gpt-4.1-mini",
  capabilityProbePlannerTransport: "mixed: 99 json-text, 1 tool-call",
  capabilityProbeModelCalls: ">0 per task",
  capabilityProbeCleanAccepted: "100 / 100 cleanCapabilityAccepted=true",
  capabilityProbeCleanGate: "modelCalls>0; no fallback; generic-only; no family/replay writers; fully supported boundary receipts",
  capabilityProbeStatus: "provisional clean-probe gate, not S9-S16 substrate-secure anti-cheat",
  capabilityProbeCandidate: "noderoom/nodeagent-general",
  capabilityProbeMaterializerMode: "generic-only",
  capabilityProbeErrors: "0",
  capabilityProbeCleanMean: "0.251875",
  capabilityProbeLatestJob: "btb-capability-probe-generic-preflight-v4-citations-gpt41mini-btb-1b253d04",
  capabilityProbeLatestTask: "btb-1b253d04",
  capabilityProbeLatestTrial: "btb-1b253d04__imYPweG",
  capabilityProbeLatestReward: "0.4086",
  capabilityProbeLatestRaw: "38 / 93",
  capabilityProbeLatestPriorReward: "0.0000 in v2; 0.1935 original clean baseline",
  capabilityProbeLatestShape: "four-slide buyer universe deck; category workbook tabs plus Sources and Citation Receipts; 15 / 15 supported citations",
  capabilityProbeSliceV2Job: "btb-capability-probe-generic-preflight-v2-gpt41mini",
  capabilityProbeSliceV2Mean: "0.1549",
  capabilityProbeSliceV2Raw: "btb-1b181d77 325 / 741; btb-1b253d04 0 / 93; btb-1d073c85 21 / 808",
  capabilityProbeBaselineJob: "btb-capability-probe-model-generic-offset10-limit3-v1-gpt41mini",
  capabilityProbeBaselineMean: "0.1554",
  capabilityProbeV5Boundary: "1,135 / 1,135 supported citations",
  cleanExpansionJob: "btb-clean-capability-full100-parallel-v3-gpt41mini",
  cleanExpansionStatus: "100 official btb-* tasks completed; 100 / 100 clean accepted; 0 errored; mean reward 0.251875",
  cleanExpansionEvidence: "final full-corpus clean-probe summary wrote docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json. Repairs during the final pass: btb-d2c04408 recovered from RewardFileNotFoundError and scored 0.5210; btb-fe996540 recovered after lightweight PDF metadata extraction and scored 0.2540. All final rows have forceModelPlanner=true, modelCalls>0, allowFallbackPlan=false, materializer_mode=generic-only, family/replay writers disabled, and fully supported boundary receipts.",
  cleanExpansionNext: "Lift reward quality and implement S9-S16 derived anti-cheat receipts before treating this as a substrate-secure benchmark headline.",
  contextProbeEvidence: "COTY context rerun v1 regressed to 0.2385; v2 kept 12 detailed MCP files plus a 30-entry mcpCoverageIndex across five tickers but still scored 0.2477, so source retrieval/ranking is the next general lever.",
  convexLedgerRoomCode: "BTBLEDGER",
  convexLedgerRoomId: "k579zhjb0b6d5xppmspa98m619893k7k",
  convexLedgerImportedRuns: "6",
  convexLedgerImportedTasks: "100",
  convexLedgerCleanAccepted: "100",
  convexLedgerCleanMean: "0.251875",
  convexLedgerEvidence: "Dev Convex eval ledger is live for the final full-100 run: publicLedgerSnapshot selects btb-clean-capability-full100-parallel-v3-gpt41mini with 100 visible task rows, 100 clean rows, and clean mean 0.251875.",
  artifactCount: 8,
  boundaryReceiptCount: 1135,
  supportedBoundaryReceipts: 1135,
  runRoot: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\btb-runs`,
  jobPath: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\btb-runs\jobs\btb-full-nodeagent-pass5-btb-067cb834`,
  generalOnlyJobPath: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\btb-runs\jobs\btb-general-only-strict-takeprivate-v2-btb-067cb834`,
  capabilityProbeJobPath: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\btb-runs\jobs\btb-clean-capability-full100-parallel-v3-gpt41mini-*`,
  capabilityProbeLatestJobPath: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\btb-runs\jobs\btb-capability-probe-generic-preflight-v4-citations-gpt41mini-btb-1b253d04`,
  capabilityProbeSummaryPath: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\docs\eval\btb-clean-capability-full100-parallel-v3-gpt41mini.json`,
  officialRepo: String.raw`D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom\.tmp\official-benchmarks\bankertoolbench-repo`,
};

export const BTB_RUN_MATRIX_COLUMNS: DataframeColumn[] = [
  { id: "lane", label: "Lane", order: 0, type: "text" },
  { id: "status", label: "Status", order: 1, type: "text" },
  { id: "evidence", label: "Evidence", order: 2, type: "text" },
  { id: "next", label: "Next", order: 3, type: "text" },
];

export const BTB_RUN_MATRIX_ROWS = [
  {
    id: "coverage",
    lane: "Actual BTB tasks",
    status: `${BTB_UI_EVIDENCE.capabilityProbeTasks} selected btb-* tasks completed on D disk`,
    evidence: `Official Harbor task dirs were selected from datasets/btb and scored through ${BTB_UI_EVIDENCE.capabilityProbeJob}; summary ${BTB_UI_EVIDENCE.capabilityProbeSummaryPath}.`,
    next: "Improve reward quality and add substrate-derived anti-cheat receipts before publishing a stronger benchmark claim.",
  },
  {
    id: "selected",
    lane: "Selected replay task",
    status: `${BTB_UI_EVIDENCE.selectedReward} reward`,
    evidence: `${BTB_UI_EVIDENCE.taskId} trial ${BTB_UI_EVIDENCE.selectedTrial}; raw ${BTB_UI_EVIDENCE.selectedRawScore}; replay materializer lane.`,
    next: "Use as UI/artifact proof only, not as the general NodeAgent headline score.",
  },
  {
    id: "capability_probe",
    lane: "Full clean capability probe",
    status: `${BTB_UI_EVIDENCE.capabilityProbeMean} mean`,
    evidence: `${BTB_UI_EVIDENCE.capabilityProbeJob}; ${BTB_UI_EVIDENCE.capabilityProbeTasks} actual tasks; ${BTB_UI_EVIDENCE.capabilityProbeRaw}; ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}; clean mean ${BTB_UI_EVIDENCE.capabilityProbeCleanMean}; errors ${BTB_UI_EVIDENCE.capabilityProbeErrors}; gate: ${BTB_UI_EVIDENCE.capabilityProbeCleanGate}; ${BTB_UI_EVIDENCE.capabilityProbeV5Boundary}; forceModelPlanner=true; modelCalls=${BTB_UI_EVIDENCE.capabilityProbeModelCalls}; materializer_mode=${BTB_UI_EVIDENCE.capabilityProbeMaterializerMode}; family writers disabled; status: ${BTB_UI_EVIDENCE.capabilityProbeStatus}.`,
    next: "Use S9-S16 derived receipts to make the gate substrate-secure, then optimize actual reward correctness.",
  },
  {
    id: "clean_expansion",
    lane: "Clean expansion shard",
    status: BTB_UI_EVIDENCE.cleanExpansionStatus,
    evidence: `${BTB_UI_EVIDENCE.cleanExpansionJob}; ${BTB_UI_EVIDENCE.cleanExpansionEvidence}.`,
    next: BTB_UI_EVIDENCE.cleanExpansionNext,
  },
  {
    id: "convex_ledger",
    lane: "Convex eval ledger",
    status: `${BTB_UI_EVIDENCE.convexLedgerImportedRuns} runs / ${BTB_UI_EVIDENCE.convexLedgerImportedTasks} selected-run task rows`,
    evidence: `Room code ${BTB_UI_EVIDENCE.convexLedgerRoomCode}; room id ${BTB_UI_EVIDENCE.convexLedgerRoomId}; selected full run has clean accepted ${BTB_UI_EVIDENCE.convexLedgerCleanAccepted}; clean mean ${BTB_UI_EVIDENCE.convexLedgerCleanMean}. ${BTB_UI_EVIDENCE.convexLedgerEvidence}`,
    next: "Keep the live panel wired to publicLedgerSnapshot and add S9-S16 derived receipts before promoting a substrate-secure benchmark headline.",
  },
  {
    id: "general_only",
    lane: "Family-writer diagnostic",
    status: BTB_UI_EVIDENCE.generalOnlyReward,
    evidence: `${BTB_UI_EVIDENCE.generalOnlySample}; ${BTB_UI_EVIDENCE.generalOnlyTaskId} trial ${BTB_UI_EVIDENCE.generalOnlyTrial}; raw ${BTB_UI_EVIDENCE.generalOnlyRawScore}; planner=${BTB_UI_EVIDENCE.plannerTransport}; model calls=0.`,
    next: "Keep as diagnostic evidence only until reproduced under generic-only force-model gates.",
  },
  {
    id: "stratified",
    lane: "Replay/materializer coverage",
    status: "9 replay tasks scored",
    evidence: "Best rewards: Comcast take-private 1.0000, COTY trading comps 1.0000, ThermoSafe buyer universe 1.0000, Salesforce sources & uses 0.9964, one-page teaser 0.9759, Gantt 0.8137, META overview 0.8991, healthcare deck/PDF 0.9921, Greenbrier CIM 1.0000.",
    next: "Quarantine as replay/overfit evidence until the same capability exists in the general-only lane.",
  },
  {
    id: "nodeagent",
    lane: "NodeAgent harness",
    status: "General mode full-100 run",
    evidence: "Source packet, NodeAgent trace, artifact plan, ATIF trajectory, and deliverables are persisted per Harbor trial.",
    next: "Route low-reward task clusters into reusable Office/PDF/source tools without adding benchmark-specific writers.",
  },
  {
    id: "tools",
    lane: "Tools",
    status: "MCP + file + Office/PDF writers",
    evidence: "VDR MCP files, workspace files, source-driven XLSX/PPTX/DOCX/PDF writers, and boundary receipt JSON emitted in candidate workspace.",
    next: "Add browser tool receipts for tasks that require live UI navigation or web artifacts.",
  },
  {
    id: "citations",
    lane: "Boundary boxes",
    status: `${BTB_UI_EVIDENCE.supportedBoundaryReceipts} / ${BTB_UI_EVIDENCE.boundaryReceiptCount} supported`,
    evidence: "boundary_box_receipts.json marks each citation enforced with cell, bbox, or shape locator status.",
    next: "Promote rendered bbox overlays and substrate-derived receipt checks into the shared citation tool.",
  },
  {
    id: "ui",
    lane: "NodeRoom UI",
    status: "#btb evidence room",
    evidence: "This room shows task, score, artifacts, receipts, trace, and NodeAgent workflow in the live browser.",
    next: "Connect replay import to live job rows once full-run importer lands.",
  },
];

export const BTB_ARTIFACT_ROWS = [
  ["banker_model.xlsx", "Excel", "Take-private financial summary, EV bridge, premium grid, source evidence, formulas, and citation receipts", "Generated in Harbor candidate workspace"],
  ["Project_CMCSA_Comcast_Corporation_Take_Private_Teaser_2025-12-31_Draft_v1.pptx", "PowerPoint", "Named two-slide take-private teaser with logo, overview, metrics, financial summary, EV bridge, and premium grid", "Generated in Harbor candidate workspace"],
  ["Project_CMCSA_Comcast_Corporation_Take_Private_Teaser_2025-12-31_Draft_v1.pdf", "PDF", "PDF companion matching the two-page teaser structure", "Generated in Harbor candidate workspace"],
  ["Project_CMCSA_Comcast_Corporation_Take_Private_Memo_2025-12-31_Draft_v1.docx", "Word", "Support memo documenting assumptions, formulas, and generated teaser files", "Generated in Harbor candidate workspace"],
  ["cmcsa_public_logo.png", "PNG", "Generated company identity mark from VDR profile fields", "Generated in Harbor candidate workspace"],
  ["boundary_box_receipts.json", "JSON", "33 enforced source receipts with 33 supported cell/shape locators", "Generated in Harbor candidate workspace"],
  ["materializer_mode.json", "JSON", "Strict general-only mode receipt showing replay materializers disabled", "Generated in Harbor candidate workspace"],
  ["artifact_manifest.json", "JSON", "Deliverable package manifest", "Generated in Harbor candidate workspace"],
];

export const BTB_BOUNDARY_ROWS = [
  ["citation-28", "Company profile and business overview", "CMCSA-US Company Profile.xlsx", "Company Profile!Description", "cell", "supported"],
  ["citation-29", "Financial summary table", "banker_model.xlsx", "Summary Output!A1:E7", "cell", "supported"],
  ["citation-30", "EV bridge", "banker_model.xlsx", "Summary Output!A9:B18", "cell", "supported"],
  ["citation-31", "Premium grid", "banker_model.xlsx", "Summary Output!A20:F25", "cell", "supported"],
  ["citation-32", "Logo image", "cmcsa_public_logo.png", "slide 1 top-left", "shape", "supported"],
  ["citation-33", "Two-page take-private teaser", "Project_CMCSA_Comcast_Corporation_Take_Private_Teaser_2025-12-31_Draft_v1.pptx", "slides 1-2", "shape", "supported"],
];

export const BTB_TASK_NOTE = `
<h1>Actual BankerToolBench Task Replay</h1>
<p><b>Task:</b> ${BTB_UI_EVIDENCE.taskId} - ${BTB_UI_EVIDENCE.taskKind}.</p>
<p><b>Replay lane:</b> Harbor ran NodeRoomNodeAgent as the candidate agent, Gandalf graded the emitted files, and the selected replay/materializer task scored <b>${BTB_UI_EVIDENCE.selectedReward}</b> with zero trial exceptions.</p>
<p><b>Final clean capability probe:</b> <code>${BTB_UI_EVIDENCE.capabilityProbeJob}</code> completed ${BTB_UI_EVIDENCE.capabilityProbeTasks} actual BankerToolBench tasks with mean <b>${BTB_UI_EVIDENCE.capabilityProbeMean}</b> and <b>${BTB_UI_EVIDENCE.capabilityProbeErrors}</b> errors. Gates: <code>candidate=${BTB_UI_EVIDENCE.capabilityProbeCandidate}</code>, <code>forceModelPlanner=true</code>, <code>modelCalls=${BTB_UI_EVIDENCE.capabilityProbeModelCalls}</code>, <code>plannerTransport=${BTB_UI_EVIDENCE.capabilityProbePlannerTransport}</code>, <code>allow_fallback_plan=false</code>, and <code>materializer_mode=${BTB_UI_EVIDENCE.capabilityProbeMaterializerMode}</code>.</p>
<p><b>Clean headline gate:</b> ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}; ${BTB_UI_EVIDENCE.capabilityProbeCleanGate}. Raw scored rows outside this gate are diagnostic only.</p>
<p><b>Clean probe delta:</b> this replaces the older <code>${BTB_UI_EVIDENCE.capabilityProbeBaselineJob}</code> headline mean <b>${BTB_UI_EVIDENCE.capabilityProbeBaselineMean}</b>; final run profile: ${BTB_UI_EVIDENCE.capabilityProbeRaw}, with ${BTB_UI_EVIDENCE.capabilityProbeV5Boundary}.</p>
<p><b>Current clean expansion:</b> <code>${BTB_UI_EVIDENCE.cleanExpansionJob}</code> is ${BTB_UI_EVIDENCE.cleanExpansionStatus}. Evidence: ${BTB_UI_EVIDENCE.cleanExpansionEvidence} This remains a ${BTB_UI_EVIDENCE.capabilityProbeStatus}.</p>
<p><b>Live Convex ledger:</b> room code <code>${BTB_UI_EVIDENCE.convexLedgerRoomCode}</code> now has the full-100 run selected from <b>${BTB_UI_EVIDENCE.convexLedgerImportedRuns}</b> visible eval runs with <b>${BTB_UI_EVIDENCE.convexLedgerImportedTasks}</b> selected-run task rows, <b>${BTB_UI_EVIDENCE.convexLedgerCleanAccepted}</b> clean rows, and clean mean <b>${BTB_UI_EVIDENCE.convexLedgerCleanMean}</b>. File-backed final full-100 summary is <code>${BTB_UI_EVIDENCE.capabilityProbeSummaryPath}</code>. ${BTB_UI_EVIDENCE.convexLedgerEvidence}</p>
<p><b>COTY context probe:</b> ${BTB_UI_EVIDENCE.contextProbeEvidence}</p>
<p><b>Latest clean loop lift:</b> actual task <code>${BTB_UI_EVIDENCE.capabilityProbeLatestTask}</code> trial <code>${BTB_UI_EVIDENCE.capabilityProbeLatestTrial}</code> scored <b>${BTB_UI_EVIDENCE.capabilityProbeLatestReward}</b> (${BTB_UI_EVIDENCE.capabilityProbeLatestRaw}) under the same clean gates after fixing one-slide-per-category trimming and zero-citation plans; prior was ${BTB_UI_EVIDENCE.capabilityProbeLatestPriorReward}. Artifacts: ${BTB_UI_EVIDENCE.capabilityProbeLatestShape}.</p>
<p><b>Family-writer diagnostic:</b> actual task ${BTB_UI_EVIDENCE.generalOnlyTaskId} trial <code>${BTB_UI_EVIDENCE.generalOnlyTrial}</code> scored <b>${BTB_UI_EVIDENCE.generalOnlyReward}</b> (${BTB_UI_EVIDENCE.generalOnlyRawScore}) with <code>plannerTransport=${BTB_UI_EVIDENCE.plannerTransport}</code> and <code>0</code> model calls. It remains useful for engineering, but it is not the capability headline.</p>
<p><b>Planner evidence:</b> clean probe route <code>${BTB_UI_EVIDENCE.capabilityProbeModel}</code> through <code>${BTB_UI_EVIDENCE.capabilityProbePlannerTransport}</code>; source-skill route <code>${BTB_UI_EVIDENCE.model}</code> is quarantined as diagnostic.</p>
<p><b>D-disk roots:</b> official repo <code>${BTB_UI_EVIDENCE.officialRepo}</code>; final clean-probe summary <code>${BTB_UI_EVIDENCE.capabilityProbeSummaryPath}</code>; final clean-probe jobs <code>${BTB_UI_EVIDENCE.capabilityProbeJobPath}</code>; replay run evidence <code>${BTB_UI_EVIDENCE.jobPath}</code>; strict family diagnostic evidence <code>${BTB_UI_EVIDENCE.generalOnlyJobPath}</code>.</p>
<p><b>NodeAgent path:</b> source extraction -> forced model planner (${BTB_UI_EVIDENCE.capabilityProbeModel}) -> generic artifact materialization -> boundary receipt enforcement -> Gandalf score import.</p>
<p><b>Boundary receipts:</b> ${BTB_UI_EVIDENCE.supportedBoundaryReceipts} supported of ${BTB_UI_EVIDENCE.boundaryReceiptCount}; cell/page/shape/paragraph/field locators are preserved in the receipt artifact.</p>
`;

export const BTB_WORKFLOW_NOTE = `
<h1>NodeAgent Workflow Evidence</h1>
<p>The live room trace is seeded from actual Harbor runs so a browser operator can inspect the replay artifact lane, the clean capability-probe lane, and the quarantined family-writer diagnostic lane inside NodeRoom.</p>
<ul>
  <li>Candidate-visible sources exclude golden outputs, canaries, rubrics, and verifier logs.</li>
  <li>General MCP/file tools extracted VDR, SEC/workspace, and task-local source files for the selected actual task.</li>
  <li>Office/PDF artifact writers emitted XLSX, PPTX, DOCX, PDF, manifest, and boundary receipt files.</li>
  <li>Clean probe planner selected ${BTB_UI_EVIDENCE.capabilityProbeModel}; planner transport was ${BTB_UI_EVIDENCE.capabilityProbePlannerTransport}; no heuristic fallback was allowed.</li>
  <li>The clean headline uses <code>cleanCapabilityAccepted=true</code>: ${BTB_UI_EVIDENCE.capabilityProbeCleanGate}; ${BTB_UI_EVIDENCE.capabilityProbeStatus}.</li>
  <li>The file-backed final run is ${BTB_UI_EVIDENCE.capabilityProbeJob}: ${BTB_UI_EVIDENCE.capabilityProbeTasks} tasks, ${BTB_UI_EVIDENCE.capabilityProbeCleanAccepted}, mean ${BTB_UI_EVIDENCE.capabilityProbeMean}, ${BTB_UI_EVIDENCE.capabilityProbeV5Boundary}.</li>
  <li>The Convex room <code>${BTB_UI_EVIDENCE.convexLedgerRoomCode}</code> now selects the full-100 run and exposes ${BTB_UI_EVIDENCE.convexLedgerImportedTasks} task rows through <code>publicLedgerSnapshot</code>.</li>
  <li>Gandalf scored the full clean-probe mean at ${BTB_UI_EVIDENCE.capabilityProbeMean}; the strict source-skill family score ${BTB_UI_EVIDENCE.generalOnlyReward} is diagnostic only.</li>
</ul>
`;

export function sheetSeed(rows: Array<Record<string, string>>, columns: DataframeColumn[]): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  for (const row of rows) {
    for (const column of columns) seed.push({ id: `${row.id}__${column.id}`, value: row[column.id] ?? "" });
  }
  return seed;
}

export function tupleSheetSeed(rows: string[][], columns: DataframeColumn[], prefix: string): Array<{ id: string; value: unknown }> {
  const seed: Array<{ id: string; value: unknown }> = [];
  rows.forEach((row, index) => {
    const rowId = `${prefix}${index + 1}`;
    columns.forEach((column, colIndex) => seed.push({ id: `${rowId}__${column.id}`, value: row[colIndex] ?? "" }));
  });
  return seed;
}
