export type NodeAgentFanoutRole =
  | "coordinator"
  | "intake"
  | "evidence"
  | "spreadsheet"
  | "formula_audit"
  | "deck_memo"
  | "privacy_security"
  | "browser_proof"
  | "notebook_proposal"
  | "fresh_context_judge";

export type NodeAgentMutationMode = "none" | "room_tools_only" | "proposal_only";

export interface NodeAgentSubagentPlan {
  role: NodeAgentFanoutRole;
  goal: string;
  inputRefs: string[];
  outputRefs: string[];
  allowedToolHints: string[];
  mutationMode: NodeAgentMutationMode;
  requiredReceiptFields: readonly string[];
}

export interface NodeAgentSubagentReceipt {
  agentJobId: string;
  role: NodeAgentFanoutRole;
  inputRefs: string[];
  outputRefs: string[];
  toolCalls: Array<{ tool: string; status: "ok" | "failed" | "skipped"; receiptId?: string }>;
  evidenceFacts: string[];
  mutationReceipts: string[];
  costUsd?: number;
  latencyMs?: number;
  verdict: "ok" | "needs_review" | "failed";
}

export interface NodeAgentFanoutPlanInput {
  goal: string;
  benchmarkCaseId?: string;
  artifactKinds?: readonly string[];
  focusMode?: boolean;
  needsBrowserProof?: boolean;
  maxParallel?: number;
}

export interface NodeAgentFanoutPlan {
  mode: "single_agent" | "fanout";
  reason: string;
  focusModeRequired: boolean;
  subagents: NodeAgentSubagentPlan[];
  waves: NodeAgentFanoutRole[][];
  receiptContract: readonly string[];
}

const RECEIPT_FIELDS = [
  "agentJobId",
  "role",
  "inputRefs",
  "outputRefs",
  "toolCalls",
  "evidenceFacts",
  "mutationReceipts",
  "cost",
  "latency",
  "verdict",
] as const;

export function planNodeAgentFanout(input: NodeAgentFanoutPlanInput): NodeAgentFanoutPlan {
  const goal = input.goal.toLowerCase();
  const artifactKinds = new Set((input.artifactKinds ?? []).map((kind) => kind.toLowerCase()));
  const isBtb = /\b(bankertoolbench|btb-[a-z0-9]{6,}|btb\b)\b/i.test(input.goal);
  const isSpreadsheet = isBtb || /\b(spreadsheetbench|spreadsheet|xlsx|xlsm|sheet 1|excel)\b/i.test(input.goal) || artifactKinds.has("sheet");
  const isNotebook = /\b(notebook|wiki|notes?|prosemirror|document)\b/i.test(goal) || artifactKinds.has("note") || artifactKinds.has("wiki");
  const needsBrowserProof = input.needsBrowserProof ?? (isBtb || isSpreadsheet || isNotebook);

  const subagents: NodeAgentSubagentPlan[] = [
    makeSubagent("coordinator", "Own the NodeRoom run plan and merge receipts, without directly mutating artifacts.", "none"),
    makeSubagent("intake", "Read the fresh room, uploads, prompt, visible artifact list, and Focus Mode state.", "none", [
      "list_artifacts",
      "snapshot",
      "awareness",
    ]),
  ];

  if (isBtb || isSpreadsheet || isNotebook) {
    subagents.push(makeSubagent("evidence", "Extract source-backed facts and cite source artifact refs.", "none", [
      "list_artifacts",
      "source_open_literal",
      "search_sheet_context",
      "read_range",
    ]));
  }

  if (isSpreadsheet) {
    subagents.push(
      makeSubagent("spreadsheet", "Compute the required sheet/package outputs through RoomTools only.", "room_tools_only", [
        "read_range",
        "write_locked_cells",
        "create_btb_deliverable_package",
      ]),
      makeSubagent("formula_audit", "Check formula/value consistency, CAS assumptions, and benchmark coverage.", "none", [
        "read_range",
        "search_sheet_context",
      ]),
    );
  }

  if (isBtb) {
    subagents.push(makeSubagent("deck_memo", "Prepare banker-facing memo/deck rows for package generation.", "room_tools_only", [
      "create_btb_deliverable_package",
    ]));
  }

  if (isNotebook) {
    subagents.push(makeSubagent("notebook_proposal", "Create proposal/read-model receipts only; never mutate human-owned ProseMirror text directly.", "proposal_only", [
      "list_artifacts",
      "set_artifact_meta",
    ]));
  }

  subagents.push(makeSubagent("privacy_security", "Verify public/private artifact boundaries and egress policy receipts.", "none", [
    "list_artifacts",
    "awareness",
  ]));

  if (needsBrowserProof) {
    subagents.push(makeSubagent("browser_proof", "Prove the work in a fresh browser room with Focus Mode, trace boxes, streaming, exports, and reopen checks.", "none", [
      "record_capture",
    ]));
  }

  subagents.push(makeSubagent("fresh_context_judge", "Read saved receipts and decide if the run can stop or must loop.", "none"));

  const mode = subagents.length > 3 ? "fanout" : "single_agent";
  return {
    mode,
    reason: isBtb
      ? "BankerToolBench requires parallel evidence, artifact, privacy, browser, and final-judge receipts."
      : isSpreadsheet
        ? "Spreadsheet work needs source evidence, sheet mutation, formula audit, and browser proof receipts."
        : isNotebook
          ? "Notebook work must separate proposals/read models from human-owned live text."
          : "Small NodeRoom run can stay in one agent unless the fresh judge requests proof fanout.",
    focusModeRequired: input.focusMode ?? true,
    subagents,
    waves: makeWaves(subagents, input.maxParallel ?? 4),
    receiptContract: RECEIPT_FIELDS,
  };
}

function makeSubagent(
  role: NodeAgentFanoutRole,
  goal: string,
  mutationMode: NodeAgentMutationMode,
  allowedToolHints: string[] = [],
): NodeAgentSubagentPlan {
  return {
    role,
    goal,
    inputRefs: [],
    outputRefs: [],
    allowedToolHints,
    mutationMode,
    requiredReceiptFields: RECEIPT_FIELDS,
  };
}

function makeWaves(subagents: NodeAgentSubagentPlan[], maxParallel: number): NodeAgentFanoutRole[][] {
  const coordinator = subagents.find((subagent) => subagent.role === "coordinator");
  const judge = subagents.find((subagent) => subagent.role === "fresh_context_judge");
  const middle = subagents.filter((subagent) => subagent.role !== "coordinator" && subagent.role !== "fresh_context_judge");
  const waves: NodeAgentFanoutRole[][] = [];
  if (coordinator) waves.push([coordinator.role]);
  for (let index = 0; index < middle.length; index += Math.max(1, maxParallel)) {
    waves.push(middle.slice(index, index + Math.max(1, maxParallel)).map((subagent) => subagent.role));
  }
  if (judge) waves.push([judge.role]);
  return waves;
}
