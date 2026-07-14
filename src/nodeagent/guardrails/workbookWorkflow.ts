import type { AgentMessage, ToolCall } from "../core/types";
import type { BlockedTool, HookCtx, NodeAgentHook, StopDecision } from "../core/hooks";

const INSPECT_TOOL = "inspect_workbook";
const VERIFY_TOOL = "verify_workbook";
const COMPOSITE_TOOL = "execute_verified_workbook_plan";
const MANAGED_WRITE_TOOLS = new Set([
  "write_locked_cell",
  "write_locked_cells",
  "write_locked_cell_result",
  "write_locked_cell_results",
]);
const WORKFLOW_TOOLS = new Set([INSPECT_TOOL, VERIFY_TOOL, COMPOSITE_TOOL, ...MANAGED_WRITE_TOOLS]);
const PRIMARY_ARTIFACT = "__primary_workbook__";

type WorkbookOperation = {
  elementId: string;
  target: string;
  baseVersion?: number;
  formula?: string;
  value?: unknown;
  result?: unknown;
  numFmt?: string;
};

type WorkbookPlan = {
  artifactId: string;
  artifactKey: string;
  operations: WorkbookOperation[];
  signature: string;
};

export interface VerifiedWorkbookWorkflowHookOptions {
  /** Force the workflow for a bounded caller even when the natural-language goal is ambiguous. */
  force?: boolean;
}

/**
 * Complex workbook writes need stronger control flow than a system-prompt request. This classifier
 * deliberately excludes exact one-cell scalar edits while covering benchmark, formula, repair,
 * forecasting, structural, chart, and multi-cell work.
 */
export function goalRequiresVerifiedWorkbookWorkflow(goal: string): boolean {
  const text = goal.trim();
  if (!text) return false;
  if (/\bspreadsheetbench\b/i.test(text)) return true;
  if (/\b(?:read[- ]only|do not|don't|dont|never)\s+(?:edit|write|update|fill|set|repair|change|commit|apply)\b/i.test(text)) {
    return false;
  }

  const hasWorkbookSurface = /\b(?:workbook|spreadsheet|worksheet|sheet|cells?|ranges?|rows?|columns?|table|chart)\b/i.test(text);
  const hasWriteDirective = /\b(?:edit|write|update|fill|populate|complete|repair|fix|correct|recalculate|recompute|forecast|build|create|replace|apply)\b/i.test(text);
  const hasComplexScope = /\b(?:formula|formulas|dependency|dependencies|model|schedule|forecast|audit|repair|recalculate|recompute|chart|format|style|merged|named range|table|multiple|multi[- ]cell|ranges?|rows?|columns?|uploaded workbook)\b/i.test(text)
    || /\b(?:fill|populate|complete)\b[^.!?\r\n]{0,120}\b(?:workbook|spreadsheet|worksheet|sheet)\b/i.test(text)
    || /\b(?:workbook|spreadsheet|worksheet|sheet)\b[^.!?\r\n]{0,120}\b(?:fill|populate|complete)\b/i.test(text);
  return hasWorkbookSurface && hasWriteDirective && hasComplexScope;
}

/**
 * Enforces inspect -> passing preflight -> matching managed write -> matching post-write verify.
 * The hook reconstructs state from durable assistant/tool messages, so Convex workflow slices can
 * resume without trusting an ephemeral in-memory controller.
 */
export function createVerifiedWorkbookWorkflowHook(
  options: VerifiedWorkbookWorkflowHookOptions = {},
): NodeAgentHook {
  const state = new WorkbookWorkflowState(options);
  return {
    preTool: (ctx, call) => state.preTool(ctx, call),
    postTool: (ctx, call, result) => state.postTool(ctx, call, result),
    preStop: (ctx) => state.preStop(ctx),
  };
}

class WorkbookWorkflowState {
  private hydrated = false;
  private engaged = false;
  private activeArtifactId = PRIMARY_ARTIFACT;
  private readonly inspected = new Set<string>();
  private readonly approved = new Map<string, WorkbookPlan>();
  private readonly pending = new Map<string, WorkbookPlan>();
  private readonly verified = new Map<string, WorkbookPlan>();
  private verifiedWrites = 0;
  private proposedWrites = 0;

  constructor(private readonly options: VerifiedWorkbookWorkflowHookOptions) {}

  preTool(ctx: HookCtx, call: ToolCall): ToolCall | BlockedTool {
    const strict = this.strictFor(ctx.goal);
    this.hydrate(ctx.messages, strict);
    const normalizedCall = normalizeWorkflowCall(call);

    if (normalizedCall.tool === INSPECT_TOOL) {
      this.engaged = true;
      return normalizedCall;
    }
    if (normalizedCall.tool === VERIFY_TOOL || normalizedCall.tool === COMPOSITE_TOOL) this.engaged = true;
    const active = strict || this.engaged;
    if (!active) return normalizedCall;

    if (normalizedCall.tool === "plan_and_dispatch" && dispatchRequestsWorkbookWrites(normalizedCall.args)) {
      return blocked(
        "parent_workflow_required",
        "Managed workbook writes must remain in the parent NodeAgent trace so one workflow guard can match preflight, write, and post-write receipts.",
        "Use subagents only for read-only analysis, then inspect, preflight, write, and verify in the parent run.",
      );
    }

    if (normalizedCall.tool === VERIFY_TOOL) return this.guardVerification(normalizedCall);
    if (MANAGED_WRITE_TOOLS.has(normalizedCall.tool)) return this.guardWrite(normalizedCall);
    if (normalizedCall.tool === COMPOSITE_TOOL && this.inspected.size === 0) {
      return blocked(
        "inspection_required",
        "The verified workbook executor requires a successful workbook inspection first.",
        "Call inspect_workbook for the target artifact, then retry execute_verified_workbook_plan.",
      );
    }
    return normalizedCall;
  }

  postTool(ctx: HookCtx, call: ToolCall, result: unknown): void {
    const strict = this.strictFor(ctx.goal);
    this.hydrate(ctx.messages, strict);
    if (!strict && !this.engaged && ![INSPECT_TOOL, VERIFY_TOOL, COMPOSITE_TOOL].includes(call.tool)) return;
    this.record(call, result, strict);
  }

  preStop(ctx: HookCtx): StopDecision {
    const strict = this.strictFor(ctx.goal);
    this.hydrate(ctx.messages, strict);
    if (!strict && !this.engaged) return { action: "allow" };

    const pending = this.pending.values().next().value as WorkbookPlan | undefined;
    if (pending) {
      return {
        action: "continue",
        reason: "A managed workbook write has not passed matching post-write verification.",
        prompt: workflowPrompt(
          "POST_WRITE_VERIFICATION_REQUIRED",
          `Call verify_workbook now with exactly these arguments: ${JSON.stringify(verificationArgs(pending, ctx.goal))}. If it returns needs_repair, repair the plan and repeat the guarded write/verify cycle before finishing.`,
        ),
      };
    }

    const approved = this.approved.values().next().value as WorkbookPlan | undefined;
    if (approved) {
      return {
        action: "continue",
        reason: "A passing workbook preflight has not been executed through its matching managed write.",
        prompt: workflowPrompt(
          "APPROVED_WRITE_REQUIRED",
          `Call a managed write for ${displayArtifact(approved.artifactId)} with at least one unchanged operation, including its baseVersion when preflighted, from the approved ${approved.operations.length}-operation plan. The runtime will bind that explicit commit attempt to the complete preflight-approved plan; then call verify_workbook with afterWrite=true for the same operations.`,
        ),
      };
    }

    if (!strict || this.verifiedWrites > 0 || this.proposedWrites > 0) return { action: "allow" };
    if (this.inspected.size === 0) {
      return {
        action: "continue",
        reason: "This complex workbook task has no successful inspection receipt.",
        prompt: workflowPrompt(
          "INSPECTION_REQUIRED",
          `Call inspect_workbook with the complete task instruction and target artifact before planning any write. Task: ${ctx.goal}`,
        ),
      };
    }
    return {
      action: "continue",
      reason: "This complex workbook task has not produced a passing edit-plan preflight and verified write.",
      prompt: workflowPrompt(
        "PREFLIGHT_REQUIRED",
        "Use the inspection evidence to submit the complete target operation set to verify_workbook with afterWrite=false. Correct any needs_repair result before calling a managed write tool.",
      ),
    };
  }

  private guardVerification(call: ToolCall): ToolCall | BlockedTool {
    const args = argsRecord(call.args) ?? {};
    const plan = this.planFromArgs(args, "verify");
    const preflight = isFalse(args.afterWrite);
    if (preflight) {
      if (!this.inspected.has(plan.artifactKey)) {
        return blocked(
          "inspection_required",
          `Workbook artifact ${displayArtifact(plan.artifactId)} has not been inspected in this durable run.`,
          "Call inspect_workbook for this artifact before verify_workbook with afterWrite=false.",
          { artifactId: plan.artifactId },
        );
      }
      return call;
    }

    const pending = this.pending.get(plan.artifactKey);
    const verified = this.verified.get(plan.artifactKey);
    if (!pending && verified?.signature === plan.signature) return call;
    if (!pending) {
      return blocked(
        "managed_write_required",
        "Post-write verification requires a successful managed write receipt for the same artifact.",
        "Pass a complete plan with afterWrite=false, execute the approved managed write, then verify that exact operation set with afterWrite=true.",
        { artifactId: plan.artifactId },
      );
    }
    if (pending.signature !== plan.signature) {
      if (operationsMatchApprovedPlan(plan.operations, pending.operations, true)) {
        return bindPendingVerification(call, pending);
      }
      return blocked(
        "post_write_plan_mismatch",
        "Post-write verification must cover exactly the operations from the most recent successful managed write.",
        `Retry verify_workbook with exactly these arguments: ${JSON.stringify(verificationArgs(pending))}.`,
        { verificationRequired: verificationArgs(pending) },
      );
    }
    return call;
  }

  private guardWrite(call: ToolCall): ToolCall | BlockedTool {
    const requestedPlan = this.planFromArgs(call.args, "write");
    const approvedForArtifact = this.approved.get(requestedPlan.artifactKey);
    const approvedPlans = [...this.approved.values()];
    if (approvedForArtifact?.signature === requestedPlan.signature) return call;
    if (approvedPlans.length === 0) {
      return blocked(
        "preflight_required",
        "A passing verify_workbook preflight is required before any managed write for this complex workbook task.",
        "Call inspect_workbook, then verify_workbook with afterWrite=false and the complete operation set before retrying the managed write.",
        { artifactId: requestedPlan.artifactId },
      );
    }

    // The preflight result is the write authority. Providers still have to prove intent by
    // repeating at least one unchanged approved operation, but they do not have to retranscribe a
    // large operation bundle perfectly. Rebinding the explicit commit attempt here keeps the
    // mutation inside the already verified target/content boundary.
    const bindingMatches = call.tool === "write_locked_cells"
      ? approvedPlans.filter((approved) =>
        artifactAllowsApprovedBinding(call.args, approved.artifactId)
        && rawBatchOperationsMatchApprovedSubset(call.args, approved))
      : [];
    if (bindingMatches.length === 1) {
      return bindApprovedBatchWrite(call, bindingMatches[0]);
    }

    const approved = approvedForArtifact ?? (approvedPlans.length === 1 ? approvedPlans[0] : undefined);
    const approvedTargets = approved ? targetSummary(approved.operations) : undefined;
    const requestedTargets = targetSummary(requestedPlan.operations);
    return blocked(
      "write_plan_mismatch",
      "The managed write must match one passing preflight plan exactly, including artifact, targets, base versions, formulas or values, cached results, and number formats.",
      approved
        ? `Retry write_locked_cells with the approved artifact and at least one unchanged operation from its ${approved.operations.length}-operation plan, or submit a corrected replacement preflight first.`
        : "Retry with the exact artifact and operation set from one passing preflight, or submit a corrected replacement preflight first.",
      {
        approvedPlanCount: approvedPlans.length,
        bindingMatchCount: bindingMatches.length,
        ...(approved ? {
          approvedArtifactId: approved.artifactId,
          approvedOperationCount: approved.operations.length,
          approvedTargets: approvedTargets?.targets,
          approvedTargetsOmitted: approvedTargets?.omitted,
        } : {}),
        requestedTargets: requestedTargets.targets,
        requestedTargetsOmitted: requestedTargets.omitted,
      },
    );
  }

  private hydrate(messages: readonly AgentMessage[], strict: boolean): void {
    if (this.hydrated) return;
    const calls = new Map<string, ToolCall>();
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) calls.set(call.id, call);
        continue;
      }
      if (message.role !== "tool" || !message.toolCallId) continue;
      const call = calls.get(message.toolCallId);
      if (!call || !WORKFLOW_TOOLS.has(call.tool)) continue;
      const parsed = parseToolMessage(message.content);
      if (parsed.ok) this.record(call, parsed.value, strict);
    }
    this.hydrated = true;
  }

  private record(call: ToolCall, result: unknown, strict: boolean): void {
    if ([INSPECT_TOOL, VERIFY_TOOL, COMPOSITE_TOOL].includes(call.tool)) this.engaged = true;
    if (!strict && !this.engaged) return;

    const args = asRecord(call.args) ?? {};
    const resultRecord = asRecord(result);
    if (call.tool === INSPECT_TOOL) {
      if (!resultSucceeded(result)) return;
      const artifactId = artifactIdFrom(args, resultRecord, this.activeArtifactId);
      this.activeArtifactId = artifactId;
      this.inspected.add(artifactKey(artifactId));
      return;
    }

    if (call.tool === VERIFY_TOOL) {
      const artifactId = artifactIdFrom(args, resultRecord, this.activeArtifactId);
      this.activeArtifactId = artifactId;
      const requestedPlan = this.planFromArgs({ ...args, artifactId }, "verify");
      const preflight = resultRecord?.phase === "preflight" || args.afterWrite === false;
      const passed = resultRecord?.status === "passed" && resultRecord.ok !== false;
      if (preflight) {
        const approvedOperations = resultRecord?.approvedOperations;
        const approvedPlan = Array.isArray(approvedOperations)
          ? this.planFromArgs({ artifactId, operations: approvedOperations }, "verify")
          : undefined;
        const authoritative = approvedPlan
          && approvedPlan.operations.length > 0
          && approvedPlan.operations.every((operation) => operation.baseVersion !== undefined)
          && operationsMatchApprovedPlan(requestedPlan.operations, approvedPlan.operations, true);
        if (passed && authoritative) this.approved.set(approvedPlan.artifactKey, approvedPlan);
        else this.approved.delete(requestedPlan.artifactKey);
        return;
      }
      if (!passed) return;
      const pending = this.pending.get(requestedPlan.artifactKey);
      if (pending?.signature === requestedPlan.signature) {
        this.pending.delete(requestedPlan.artifactKey);
        this.verified.set(requestedPlan.artifactKey, pending);
        this.verifiedWrites += 1;
      } else if (this.verified.get(requestedPlan.artifactKey)?.signature === requestedPlan.signature) {
        this.verified.set(requestedPlan.artifactKey, requestedPlan);
      }
      return;
    }

    if (call.tool === COMPOSITE_TOOL) {
      if (resultSucceeded(result) && compositeWorkflowPassed(resultRecord)) this.verifiedWrites += 1;
      return;
    }

    if (!MANAGED_WRITE_TOOLS.has(call.tool)) return;
    const plan = this.planFromArgs(args, "write");
    if (resultRecord?.pendingApproval === true || resultRecord?.drafted === true) {
      this.approved.delete(plan.artifactKey);
      this.proposedWrites += 1;
      return;
    }
    if (!resultSucceeded(result)) return;
    this.activeArtifactId = plan.artifactId;
    this.pending.set(plan.artifactKey, plan);
    this.approved.delete(plan.artifactKey);
  }

  private planFromArgs(argsValue: unknown, source: "verify" | "write"): WorkbookPlan {
    const args = argsRecord(argsValue) ?? {};
    const artifactId = typeof args.artifactId === "string" && args.artifactId.trim()
      ? args.artifactId.trim()
      : this.activeArtifactId;
    const rawOperations = source === "verify"
      ? Array.isArray(args.operations) ? args.operations : []
      : Array.isArray(args.ops) ? args.ops
        : Array.isArray(args.cells) ? args.cells
          : [args];
    const operations = rawOperations.flatMap((operation) => normalizeOperation(operation, artifactId));
    const canonicalOperations = [...operations]
      .sort((left, right) => left.target.localeCompare(right.target) || stableStringify(left).localeCompare(stableStringify(right)));
    return {
      artifactId,
      artifactKey: artifactKey(artifactId),
      operations,
      signature: stableStringify(canonicalOperations),
    };
  }

  private strictFor(goal: string): boolean {
    return this.options.force === true || goalRequiresVerifiedWorkbookWorkflow(goal);
  }
}

function normalizeOperation(value: unknown, artifactId: string): WorkbookOperation[] {
  const operation = asRecord(value);
  if (!operation) return [];
  const elementId = stringField(operation, ["elementId", "cellId", "id", "cell", "cellKey", "targetCell", "target", "targetId", "element_id", "cell_id"]);
  if (!elementId) return [];
  const nested = asRecord(operation.value);
  const formulaValue = stringField(operation, ["formula"])
    ?? (nested ? stringField(nested, ["formula"]) : undefined);
  const formula = formulaValue?.trim().replace(/^=/, "").trim();
  const result = ownValue(operation, ["result"])
    ?? (nested ? ownValue(nested, ["result"]) : undefined);
  const nestedValue = nested ? ownValue(nested, ["value"]) : undefined;
  const scalarValue = result !== undefined
    ? result
    : nestedValue !== undefined
      ? nestedValue
      : nested && formula ? undefined : ownValue(operation, ["value", "newValue", "new_value", "text", "content"]);
  const numFmt = stringField(operation, ["numFmt", "num_fmt", "numberFormat", "number_format"])
    ?? (nested ? stringField(nested, ["numFmt", "num_fmt", "numberFormat", "number_format"]) : undefined);
  const baseVersion = integerValue(ownValue(operation, ["baseVersion", "base_version", "currentVersion", "current_version", "version"]));
  const normalizedElementId = normalizeElementId(elementId);
  return [{
    elementId: normalizedElementId,
    target: targetFor(normalizedElementId, artifactId),
    ...(baseVersion !== undefined ? { baseVersion } : {}),
    ...(formula ? { formula } : {}),
    ...(formula && result !== undefined ? { result: normalizeJson(result) } : {}),
    ...(!formula && scalarValue !== undefined ? { value: normalizeJson(scalarValue) } : {}),
    ...(numFmt?.trim() ? { numFmt: numFmt.trim() } : {}),
  }];
}

function artifactIdFrom(
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  fallback: string,
): string {
  for (const candidate of [result?.artifactId, args.artifactId, fallback]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return PRIMARY_ARTIFACT;
}

function artifactKey(value: string): string {
  return value.trim().toLowerCase() || PRIMARY_ARTIFACT;
}

function displayArtifact(value: string): string {
  return value === PRIMARY_ARTIFACT ? "the primary workbook" : value;
}

function normalizeElementId(value: string): string {
  return value.trim().replace(/\$/g, "").replace(/^'([^']+)'!/, "$1!").replace(/\s*!\s*/g, "!").toUpperCase();
}

function targetFor(elementId: string, artifactId: string): string {
  return elementId.includes("!") ? elementId : `${artifactKey(artifactId)}!${elementId}`;
}

function bindApprovedBatchWrite(call: ToolCall, plan: WorkbookPlan): ToolCall {
  return {
    ...call,
    tool: "write_locked_cells",
    args: { artifactId: plan.artifactId, ops: plan.operations.map(operationArgs) },
  };
}

function bindPendingVerification(call: ToolCall, plan: WorkbookPlan): ToolCall {
  const args = argsRecord(call.args) ?? {};
  return {
    ...call,
    args: {
      ...args,
      artifactId: plan.artifactId,
      operations: plan.operations.map(operationArgs),
      afterWrite: true,
    },
  };
}

function artifactAllowsApprovedBinding(argsValue: unknown, approvedArtifactId: string): boolean {
  const raw = argsRecord(argsValue)?.artifactId;
  if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) return true;
  if (typeof raw !== "string") return false;
  if (raw.trim() === approvedArtifactId) return true;
  if (!raw.startsWith(approvedArtifactId)) return false;
  const suffix = raw.slice(approvedArtifactId.length);
  return /^\s*(?:\r?\n|<(?:tool_call|arg_key|function|tool-use)\b)/i.test(suffix);
}

function rawBatchOperationsMatchApprovedSubset(argsValue: unknown, approved: WorkbookPlan): boolean {
  const args = argsRecord(argsValue);
  if (!args || !Array.isArray(args.ops) || args.ops.length === 0 || args.ops.length > approved.operations.length) return false;
  const requested: WorkbookOperation[] = [];
  for (const rawOperation of args.ops) {
    const normalized = normalizeOperation(rawOperation, approved.artifactId);
    if (normalized.length !== 1) return false;
    requested.push(normalized[0]);
  }

  return operationsMatchApprovedPlan(requested, approved.operations, false);
}

function operationsMatchApprovedPlan(
  requested: WorkbookOperation[],
  approved: WorkbookOperation[],
  requireComplete: boolean,
): boolean {
  if (requested.length === 0 || requested.length > approved.length) return false;
  if (requireComplete && requested.length !== approved.length) return false;
  const remaining = [...approved];
  for (const operation of requested) {
    const matchIndex = remaining.findIndex((candidate) => operationMatchesApproved(operation, candidate));
    if (matchIndex === -1) return false;
    remaining.splice(matchIndex, 1);
  }
  return !requireComplete || remaining.length === 0;
}

function operationMatchesApproved(requested: WorkbookOperation, approved: WorkbookOperation): boolean {
  if (requested.baseVersion !== undefined && requested.baseVersion !== approved.baseVersion) return false;
  return stableStringify(operationArgsWithoutVersion(requested)) === stableStringify(operationArgsWithoutVersion(approved));
}

function operationArgsWithoutVersion(operation: WorkbookOperation): Record<string, unknown> {
  const args = operationArgs(operation);
  delete args.baseVersion;
  return args;
}

function targetSummary(operations: WorkbookOperation[], limit = 8): { targets: string[]; omitted: number } {
  return {
    targets: operations.slice(0, limit).map((operation) => operation.target),
    omitted: Math.max(0, operations.length - limit),
  };
}

function verificationArgs(plan: WorkbookPlan, instruction?: string): Record<string, unknown> {
  return {
    ...(instruction ? { instruction } : {}),
    artifactId: plan.artifactId,
    operations: plan.operations.map(operationArgs),
    afterWrite: true,
  };
}

function operationArgs(operation: WorkbookOperation): Record<string, unknown> {
  return {
    elementId: operation.elementId,
    ...(operation.baseVersion !== undefined ? { baseVersion: operation.baseVersion } : {}),
    ...(operation.formula ? { formula: operation.formula } : {}),
    ...(Object.prototype.hasOwnProperty.call(operation, "value") ? { value: operation.value } : {}),
    ...(Object.prototype.hasOwnProperty.call(operation, "result") ? { result: operation.result } : {}),
    ...(operation.numFmt ? { numFmt: operation.numFmt } : {}),
  };
}

function blocked(
  stage: string,
  reason: string,
  recovery: string,
  metadata: Record<string, unknown> = {},
): BlockedTool {
  return {
    blocked: true,
    reason: `verified_workbook_workflow:${stage}: ${reason}`,
    failureKind: "evidence_required",
    recovery,
    metadata: { workflow: "inspect_preflight_write_postverify", stage, ...metadata },
  };
}

function workflowPrompt(stage: string, instruction: string): string {
  return `NODEAGENT WORKBOOK WORKFLOW GATE [${stage}]: ${instruction}`;
}

function dispatchRequestsWorkbookWrites(args: unknown): boolean {
  const waves = argsRecord(args)?.waves;
  if (!Array.isArray(waves)) return false;
  return waves.some((wave) => Array.isArray(wave) && wave.some((spec) => {
    const allowedTools = asRecord(spec)?.allowedTools;
    return Array.isArray(allowedTools) && allowedTools.some((tool) => typeof tool === "string" && MANAGED_WRITE_TOOLS.has(tool));
  }));
}

function compositeWorkflowPassed(result: Record<string, unknown> | undefined): boolean {
  if (!result || result.ok === false) return false;
  if (result.workflowComplete === true) return true;
  const phases = asRecord(result.phases);
  const preflight = asRecord(phases?.preflight)?.status;
  const verify = asRecord(phases?.verify)?.status;
  return ["passed", "completed"].includes(String(preflight)) && ["passed", "completed"].includes(String(verify));
}

function resultSucceeded(result: unknown): boolean {
  const record = asRecord(result);
  if (!record) return result !== undefined && result !== null;
  if (record.pendingApproval === true || record.drafted === true) return true;
  return record.ok !== false && typeof record.error !== "string";
}

function parseToolMessage(content: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    return { ok: false };
  }
}

function normalizeWorkflowCall(call: ToolCall): ToolCall {
  const args = argsRecord(call.args);
  if (!args) return call;
  const afterWrite = call.tool === VERIFY_TOOL && typeof args.afterWrite === "string"
    ? args.afterWrite.trim().toLowerCase() === "false" ? false
      : args.afterWrite.trim().toLowerCase() === "true" ? true
        : args.afterWrite
    : args.afterWrite;
  return {
    ...call,
    args: afterWrite === args.afterWrite ? args : { ...args, afterWrite },
  };
}

function argsRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (record) return record;
  if (typeof value !== "string") return undefined;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function isFalse(value: unknown): boolean {
  return value === false || value === 0 || (typeof value === "string" && value.trim().toLowerCase() === "false");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function ownValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
  }
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, normalizeJson(record[key])]));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}
