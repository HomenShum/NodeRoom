import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const SOLO_DIR = ".solo";
export const SOLO_LOOP_STATE_FILE = "loop-state.json";
export const SOLO_EVENTS_FILE = "events.jsonl";
export const SOLO_MEMORY_FILE = "memory.db";
export const SOLO_PROOF_VERDICT_FILE = "proof-verdict.json";
export const SOLO_REWORK_LEDGER_FILE = "rework-ledger.md";

export const RALPH_MILESTONES = ["R", "A", "L", "P", "H"] as const;
export type RalphMilestone = (typeof RALPH_MILESTONES)[number];

export type SoloLoopStatus = "running" | "blocked" | "completed" | "failed";
export type SoloMilestoneStatus = "not_started" | SoloLoopStatus;
export type SoloBlockedKind = "approval" | "secret" | "install" | "budget" | "missing_receipt";

export type SoloLoopRun = {
  loopId: string;
  projectId: string;
  repoPath: string;
  goal: string;
  currentMilestone: RalphMilestone;
  status: SoloLoopStatus;
  milestones: Record<RalphMilestone, SoloMilestoneState>;
  budgets: {
    maxUsd?: number;
    maxRuntimeMs?: number;
    maxModelCalls?: number;
  };
  lastSafeCheckpointAt: string;
};

export type SoloMilestoneState = {
  status: SoloMilestoneStatus;
  startedAt?: string;
  completedAt?: string;
  inputs: string[];
  outputs: string[];
  receipts: string[];
  resumeCommand?: string;
  blockedOn?: {
    kind: SoloBlockedKind;
    message: string;
    nextAction: string;
  };
};

export type SoloStepEvent = {
  schema: 1;
  id: string;
  loopId: string;
  at: string;
  milestone: RalphMilestone;
  kind: "loop.init" | "loop.start" | "loop.blocked" | "loop.verify" | "receipt" | "command" | "note";
  summary: string;
  data?: Record<string, unknown>;
};

export type SoloMilestoneContract = {
  label: string;
  entryReceipts: string[];
  exitReceipts: string[];
};

export const MILESTONE_RECEIPT_DIRS: Record<RalphMilestone, string> = {
  R: "receipts/R-reality",
  A: "receipts/A-acceptance-bar",
  L: "receipts/L-live-build",
  P: "receipts/P-proof-run",
  H: "receipts/H-harden",
};

export const SOLO_MILESTONE_CONTRACTS: Record<RalphMilestone, SoloMilestoneContract> = {
  R: {
    label: "Reality / Research",
    entryReceipts: [],
    exitReceipts: [
      "receipts/R-reality/capability-spec.json",
      "receipts/R-reality/research-spine.json",
    ],
  },
  A: {
    label: "Acceptance Bar",
    entryReceipts: [
      "receipts/R-reality/capability-spec.json",
      "receipts/R-reality/research-spine.json",
    ],
    exitReceipts: [
      "receipts/A-acceptance-bar/benchmark-choice.json",
      "receipts/A-acceptance-bar/rubric-policy.json",
      "receipts/A-acceptance-bar/held-out-split.json",
      "receipts/A-acceptance-bar/memory-quarantine.json",
    ],
  },
  L: {
    label: "Live Build",
    entryReceipts: [
      "receipts/R-reality/capability-spec.json",
      "receipts/R-reality/research-spine.json",
      "receipts/A-acceptance-bar/benchmark-choice.json",
      "receipts/A-acceptance-bar/rubric-policy.json",
      "receipts/A-acceptance-bar/held-out-split.json",
      "receipts/A-acceptance-bar/memory-quarantine.json",
    ],
    exitReceipts: [
      "receipts/L-live-build/agent-layer-delta.json",
      "receipts/L-live-build/app-ui-delta.json",
      "receipts/L-live-build/transfer-plan.json",
    ],
  },
  P: {
    label: "Proof Run",
    entryReceipts: [
      "receipts/R-reality/capability-spec.json",
      "receipts/R-reality/research-spine.json",
      "receipts/A-acceptance-bar/benchmark-choice.json",
      "receipts/A-acceptance-bar/rubric-policy.json",
      "receipts/A-acceptance-bar/held-out-split.json",
      "receipts/A-acceptance-bar/memory-quarantine.json",
      "receipts/L-live-build/agent-layer-delta.json",
      "receipts/L-live-build/app-ui-delta.json",
      "receipts/L-live-build/transfer-plan.json",
    ],
    exitReceipts: [
      SOLO_PROOF_VERDICT_FILE,
      "receipts/P-proof-run/live-ui-proof.json",
      "receipts/P-proof-run/scorer-receipt.json",
    ],
  },
  H: {
    label: "Harden",
    entryReceipts: [
      SOLO_PROOF_VERDICT_FILE,
      "receipts/P-proof-run/live-ui-proof.json",
      "receipts/P-proof-run/scorer-receipt.json",
    ],
    exitReceipts: [
      SOLO_REWORK_LEDGER_FILE,
      "receipts/H-harden/cost-ledger.json",
      "receipts/H-harden/improvement-candidates.json",
    ],
  },
};

export const SOLO_PROOF_GATES = [
  "fresh_room",
  "official_upload",
  "real_composer",
  "deterministic_readiness",
  "real_export",
  "official_scorer",
  "ledger_row",
] as const;

export type SoloProofGate = (typeof SOLO_PROOF_GATES)[number];

export type SoloProofVerdict = {
  schema: 1;
  loopId?: string;
  generatedAt: string;
  verdict: "pass" | "fail";
  claim?: string;
  receipts: Array<{
    gate: SoloProofGate;
    path: string;
    verdict: "pass" | "fail";
  }>;
};

export type SoloValidationResult = {
  ok: boolean;
  errors: string[];
};

export type SoloStartEvaluation = {
  allowed: boolean;
  milestone: RalphMilestone;
  missing: string[];
  resumeCommand: string;
};

export type SoloMemoryKind =
  | "capability_spec"
  | "benchmark_choice"
  | "held_out_split_hash"
  | "scorecard"
  | "environment_provenance"
  | "in_app_transfer_verdict"
  | "rework_decision";

const FORBIDDEN_MEMORY_KINDS = new Set([
  "held_out_task_content",
  "held_out_answer",
  "golden_output",
  "evaluator_only_prompt",
]);

const FORBIDDEN_MEMORY_FIELDS = new Set([
  "taskContents",
  "heldOutTaskContents",
  "heldOutRows",
  "answerKey",
  "goldenOutput",
  "goldenOutputs",
  "evaluatorPrompt",
  "evaluatorOnlyPrompt",
]);

export function soloRoot(projectRoot: string = process.cwd()): string {
  return resolve(projectRoot, SOLO_DIR);
}

export function soloPath(projectRoot: string, relativePath: string): string {
  return resolve(soloRoot(projectRoot), relativePath);
}

export function initSoloLoop(args: {
  projectRoot?: string;
  goal: string;
  projectId?: string;
  loopId?: string;
  budgets?: SoloLoopRun["budgets"];
  now?: string;
}): SoloLoopRun {
  const projectRoot = resolve(args.projectRoot ?? process.cwd());
  const now = args.now ?? new Date().toISOString();
  const loopId = args.loopId ?? `loop_${randomUUID()}`;
  const root = soloRoot(projectRoot);
  mkdirSync(root, { recursive: true });
  for (const dir of Object.values(MILESTONE_RECEIPT_DIRS)) mkdirSync(resolve(root, dir), { recursive: true });
  ensureFile(soloPath(projectRoot, SOLO_EVENTS_FILE), "");
  ensureFile(soloPath(projectRoot, SOLO_MEMORY_FILE), "");
  ensureFile(soloPath(projectRoot, SOLO_REWORK_LEDGER_FILE), "# RALPH Rework Ledger\n\n");

  const milestones = Object.fromEntries(
    RALPH_MILESTONES.map((milestone): [RalphMilestone, SoloMilestoneState] => [
      milestone,
      {
        status: milestone === "R" ? "running" : "not_started",
        startedAt: milestone === "R" ? now : undefined,
        inputs: SOLO_MILESTONE_CONTRACTS[milestone].entryReceipts,
        outputs: SOLO_MILESTONE_CONTRACTS[milestone].exitReceipts,
        receipts: [],
        resumeCommand: `npm run sfn -- loop start --from ${milestone}`,
      },
    ]),
  ) as Record<RalphMilestone, SoloMilestoneState>;

  const state: SoloLoopRun = {
    loopId,
    projectId: args.projectId ?? slugFromPath(projectRoot),
    repoPath: projectRoot,
    goal: args.goal,
    currentMilestone: "R",
    status: "running",
    milestones,
    budgets: args.budgets ?? {},
    lastSafeCheckpointAt: now,
  };
  writeSoloLoopState(projectRoot, state);
  appendSoloEvent(projectRoot, {
    schema: 1,
    id: randomUUID(),
    loopId,
    at: now,
    milestone: "R",
    kind: "loop.init",
    summary: `Initialized RALPH loop for: ${args.goal}`,
  });
  return state;
}

export function readSoloLoopState(projectRoot: string = process.cwd()): SoloLoopRun | null {
  const path = soloPath(projectRoot, SOLO_LOOP_STATE_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SoloLoopRun;
}

export function writeSoloLoopState(projectRoot: string, state: SoloLoopRun): void {
  writeJson(soloPath(projectRoot, SOLO_LOOP_STATE_FILE), state);
}

export function appendSoloEvent(projectRoot: string, event: SoloStepEvent): void {
  appendFileSync(soloPath(projectRoot, SOLO_EVENTS_FILE), `${JSON.stringify(event)}\n`, "utf8");
}

export function evaluateSoloMilestoneStart(
  projectRoot: string,
  milestone: RalphMilestone,
): SoloStartEvaluation {
  const missing = missingReceipts(projectRoot, SOLO_MILESTONE_CONTRACTS[milestone].entryReceipts);
  return {
    allowed: missing.length === 0,
    milestone,
    missing,
    resumeCommand: missing.length === 0
      ? `npm run sfn -- loop start --from ${milestone}`
      : `npm run sfn -- loop start --from ${backfillMilestoneForMissing(missing[0])}`,
  };
}

export function startSoloMilestone(projectRoot: string, milestone: RalphMilestone, now = new Date().toISOString()): SoloStartEvaluation {
  const state = readSoloLoopState(projectRoot);
  if (!state) throw new Error("No .solo/loop-state.json exists. Run: npm run sfn -- loop init --goal \"...\"");
  const evaluation = evaluateSoloMilestoneStart(projectRoot, milestone);
  state.currentMilestone = milestone;
  state.lastSafeCheckpointAt = now;
  const current = state.milestones[milestone];
  if (!evaluation.allowed) {
    state.status = "blocked";
    current.status = "blocked";
    current.blockedOn = {
      kind: "missing_receipt",
      message: `Cannot start ${milestone}; missing ${evaluation.missing.length} prior receipt(s).`,
      nextAction: evaluation.resumeCommand,
    };
    writeSoloLoopState(projectRoot, state);
    appendSoloEvent(projectRoot, {
      schema: 1,
      id: randomUUID(),
      loopId: state.loopId,
      at: now,
      milestone,
      kind: "loop.blocked",
      summary: current.blockedOn.message,
      data: { missing: evaluation.missing, resumeCommand: evaluation.resumeCommand },
    });
    return evaluation;
  }

  state.status = "running";
  current.status = "running";
  current.startedAt ??= now;
  current.blockedOn = undefined;
  writeSoloLoopState(projectRoot, state);
  appendSoloEvent(projectRoot, {
    schema: 1,
    id: randomUUID(),
    loopId: state.loopId,
    at: now,
    milestone,
    kind: "loop.start",
    summary: `Started ${milestone}: ${SOLO_MILESTONE_CONTRACTS[milestone].label}`,
  });
  return evaluation;
}

export function verifySoloMilestone(projectRoot: string, milestone: RalphMilestone, now = new Date().toISOString()): SoloValidationResult {
  const state = readSoloLoopState(projectRoot);
  if (!state) return { ok: false, errors: ["No .solo/loop-state.json exists."] };

  const missing = missingReceipts(projectRoot, SOLO_MILESTONE_CONTRACTS[milestone].exitReceipts);
  const errors = missing.map((path) => `missing exit receipt: ${path}`);
  if (milestone === "P") {
    const proof = readJsonIfExists(soloPath(projectRoot, SOLO_PROOF_VERDICT_FILE));
    errors.push(...validateSoloProofVerdict(proof).errors);
  }

  const ok = errors.length === 0;
  const current = state.milestones[milestone];
  current.status = ok ? "completed" : "blocked";
  current.completedAt = ok ? now : undefined;
  current.receipts = SOLO_MILESTONE_CONTRACTS[milestone].exitReceipts.filter((path) => existsSync(soloPath(projectRoot, path)));
  current.blockedOn = ok ? undefined : {
    kind: "missing_receipt",
    message: `Cannot verify ${milestone}; ${errors.length} issue(s).`,
    nextAction: `npm run sfn -- loop start --from ${milestone}`,
  };
  state.status = ok && milestone === "H" ? "completed" : ok ? "running" : "blocked";
  state.lastSafeCheckpointAt = now;
  writeSoloLoopState(projectRoot, state);
  appendSoloEvent(projectRoot, {
    schema: 1,
    id: randomUUID(),
    loopId: state.loopId,
    at: now,
    milestone,
    kind: "loop.verify",
    summary: ok ? `Verified ${milestone}.` : `Verification failed for ${milestone}.`,
    data: { errors },
  });
  return { ok, errors };
}

export function validateSoloProofVerdict(value: unknown): SoloValidationResult {
  const errors: string[] = [];
  const proof = objectRecord(value) as Partial<SoloProofVerdict> | undefined;
  if (!proof) return { ok: false, errors: ["proof-verdict.json must be a JSON object."] };
  if (proof.schema !== 1) errors.push("proof verdict schema must be 1.");
  if (proof.verdict !== "pass") errors.push("proof verdict must be pass.");
  if (!nonEmptyString(proof.generatedAt) || Number.isNaN(Date.parse(proof.generatedAt ?? ""))) {
    errors.push("proof verdict generatedAt must be an ISO timestamp.");
  }
  if (!Array.isArray(proof.receipts)) {
    errors.push("proof verdict receipts must be an array.");
  } else {
    for (const gate of SOLO_PROOF_GATES) {
      const receipt = proof.receipts.find((item) => item.gate === gate);
      if (!receipt) {
        errors.push(`missing proof gate receipt: ${gate}`);
      } else {
        if (receipt.verdict !== "pass") errors.push(`proof gate ${gate} must pass.`);
        if (!nonEmptyString(receipt.path)) errors.push(`proof gate ${gate} path is required.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateSoloMemoryRecord(record: unknown): SoloValidationResult {
  const errors: string[] = [];
  const value = objectRecord(record);
  if (!value) return { ok: false, errors: ["memory record must be a JSON object."] };
  const kind = value.kind;
  if (!nonEmptyString(kind)) {
    errors.push("memory record kind is required.");
  } else if (FORBIDDEN_MEMORY_KINDS.has(kind)) {
    errors.push(`memory kind ${kind} is forbidden; store split hashes and aggregate scores only.`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_MEMORY_FIELDS.has(key)) {
      errors.push(`memory field ${key} is forbidden because it can contain held-out task contents.`);
    }
  }
  if (kind === "held_out_split_hash" && !nonEmptyString(value.splitHash)) {
    errors.push("held_out_split_hash memory requires splitHash.");
  }
  return { ok: errors.length === 0, errors };
}

export function recordSoloReceipt(projectRoot: string, milestone: RalphMilestone, receiptName: string, value: unknown): string {
  const relativePath = join(MILESTONE_RECEIPT_DIRS[milestone], receiptName);
  writeJson(soloPath(projectRoot, relativePath), value);
  return relativePath;
}

function missingReceipts(projectRoot: string, receiptPaths: string[]): string[] {
  return receiptPaths.filter((path) => !existsSync(soloPath(projectRoot, path)));
}

function backfillMilestoneForMissing(relativePath: string): RalphMilestone {
  if (relativePath.startsWith("receipts/R-")) return "R";
  if (relativePath.startsWith("receipts/A-")) return "A";
  if (relativePath.startsWith("receipts/L-")) return "L";
  if (relativePath.startsWith("receipts/P-") || relativePath === SOLO_PROOF_VERDICT_FILE) return "P";
  return "H";
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function ensureFile(path: string, content: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function slugFromPath(path: string): string {
  const clean = path.replace(/[\\/]+$/g, "");
  const base = clean.split(/[\\/]/).at(-1) || "project";
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
