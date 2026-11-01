import "../scripts/benchmark/loadEnv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { judge } from "../src/nodeagent/models/adapter";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";
import {
  PROFESSIONAL_WORKFLOW_CASES,
  type ProfessionalEvalCase,
} from "./professionalWorkflows";

export type ProfessionalLiveCatalogAnswer = {
  caseId: string;
  intakeModes: string[];
  primarySurface: string;
  evidencePlan: string[];
  riskControls: string[];
  mutationMode: "read_only" | "draft_first" | "mutate_with_cas" | "background_job";
  approvalRequired: boolean;
  privacyBoundary: string;
  traceMustShow: string[];
  blockersToResolve: string[];
};

export type ProfessionalLiveCatalogReport = {
  caseId: string;
  model: string;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  ms: number;
  answer?: ProfessionalLiveCatalogAnswer;
  raw: string;
  error?: string;
};

export type ProfessionalLiveCatalogAggregate = {
  generatedAt: string;
  harnessVersion: string;
  model: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  allPassed: boolean;
  rows: ProfessionalLiveCatalogReport[];
};

const HARNESS_VERSION = "professional-live-catalog-v1";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_OUT = "docs/eval/professional-live-catalog.json";

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function buildProfessionalLiveCatalogPrompt(evalCase: ProfessionalEvalCase): string {
  return [
    "You are being evaluated as NodeAgent's professional workflow planner.",
    "Return ONLY valid JSON matching this TypeScript type:",
    "{ caseId: string; intakeModes: string[]; primarySurface: string; evidencePlan: string[]; riskControls: string[]; mutationMode: 'read_only' | 'draft_first' | 'mutate_with_cas' | 'background_job'; approvalRequired: boolean; privacyBoundary: string; traceMustShow: string[]; blockersToResolve: string[] }",
    "Do not add markdown. Do not claim you executed tools. This is a plan contract, not a final answer.",
    "Grading rules:",
    "- If outputContract is present, primarySurface must be one of its allowed surfaces or an obvious synonym.",
    "- If requiredHarness contains privacy_redaction, privacyBoundary must explicitly mention private/public boundary, redaction, masking, PII, leakage, confidential, or sensitive data.",
    "- If requiredHarness contains long_running_free_auto, use background_job or explain checkpoint/resume/job behavior.",
    "- If requiredHarness contains human_review, either approvalRequired=true or riskControls must explain review/approval/draft behavior.",
    "- traceMustShow must name observable reads/writes/receipts/sources, not only high-level intentions.",
    "",
    `caseId: ${evalCase.id}`,
    `workflow: ${evalCase.workflow}`,
    `persona: ${evalCase.persona}`,
    `agentGoal: ${evalCase.agentGoal}`,
    `intakeModes: ${(evalCase.intakeModes ?? ["selected_artifact"]).join(", ")}`,
    `sourcePatterns: ${evalCase.sourcePatterns.join(", ")}`,
    `fixtureStrategy: ${evalCase.fixtureStrategy}`,
    `evalSteps: ${evalCase.evalSteps.join(" | ")}`,
    `assertions: ${evalCase.assertions.join(" | ")}`,
    `requiredHarness: ${evalCase.requiredHarness.join(", ")}`,
    evalCase.outputContract
      ? `outputContract: allowed=${evalCase.outputContract.allowedSurfaces.join(", ")}; default=${evalCase.outputContract.defaultSurface}; escalation=${evalCase.outputContract.escalationRule}`
      : "outputContract: none declared",
  ].join("\n");
}

export function parseProfessionalLiveCatalogAnswer(raw: string): ProfessionalLiveCatalogAnswer {
  const text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(candidate) as ProfessionalLiveCatalogAnswer;
  return {
    caseId: String(parsed.caseId ?? ""),
    intakeModes: arrayOfString(parsed.intakeModes),
    primarySurface: String(parsed.primarySurface ?? ""),
    evidencePlan: arrayOfString(parsed.evidencePlan),
    riskControls: arrayOfString(parsed.riskControls),
    mutationMode: parsed.mutationMode,
    approvalRequired: Boolean(parsed.approvalRequired),
    privacyBoundary: String(parsed.privacyBoundary ?? ""),
    traceMustShow: arrayOfString(parsed.traceMustShow),
    blockersToResolve: arrayOfString(parsed.blockersToResolve),
  };
}

export function gradeProfessionalLiveCatalogAnswer(
  evalCase: ProfessionalEvalCase,
  answer: ProfessionalLiveCatalogAnswer,
): Record<string, boolean> {
  const joined = [
    answer.primarySurface,
    answer.mutationMode,
    answer.evidencePlan.join(" "),
    answer.riskControls.join(" "),
    answer.privacyBoundary,
    answer.traceMustShow.join(" "),
    answer.blockersToResolve.join(" "),
  ].join(" ").toLowerCase();
  const expectedIntakes = evalCase.intakeModes ?? ["selected_artifact"];
  const allowedSurfaces = evalCase.outputContract?.allowedSurfaces ?? [];
  const required = evalCase.requiredHarness;
  const requiredMentions = required.filter((req) => mentionsRequirement(joined, req)).length;
  return {
    validCaseId: answer.caseId === evalCase.id,
    intakeCovered: expectedIntakes.some((mode) => answer.intakeModes.includes(mode)),
    outputSurfaceValid: !allowedSurfaces.length || outputSurfaceMatches(answer.primarySurface, allowedSurfaces),
    provenancePlan: /evidence|source|cite|artifact|row|claim|manual|provenance/.test(joined),
    mutationDiscipline: /lock|cas|draft|review|checkpoint|read.?only|proposal|receipt|version/.test(joined),
    tracePlan: answer.traceMustShow.length >= 3 && /read|lock|write|cas|receipt|trace|source|checkpoint|review|artifact|row|provenance|citation|redaction|exception|evidence/.test(answer.traceMustShow.join(" ").toLowerCase()),
    requirementCoverage: required.length === 0 || requiredMentions / required.length >= 0.45,
    privacyIfNeeded: !required.includes("privacy_redaction") || /private|public|redact|mask|pii|leak|boundary|confidential|sensitive/.test(joined),
    longRunningIfNeeded: !required.includes("long_running_free_auto") || answer.mutationMode === "background_job" || /job|checkpoint|resume|slice|resolved.?model|duplicate/.test(joined),
    reviewIfNeeded: !required.includes("human_review") || answer.approvalRequired || /review|approval|needs_review|proposal|draft/.test(joined),
    privateGoldIfNeeded: !required.includes("private_gold_pack") || /answer.?key|private|gold|guide|collaborate|zero.?write|formula|tie.?out/.test(joined),
  };
}

export async function runProfessionalLiveCatalog(options: {
  model?: string;
  cases?: ProfessionalEvalCase[];
  retryFailed?: number;
} = {}): Promise<ProfessionalLiveCatalogAggregate> {
  const modelName = options.model ?? DEFAULT_MODEL;
  const rows: ProfessionalLiveCatalogReport[] = [];
  for (const evalCase of options.cases ?? PROFESSIONAL_WORKFLOW_CASES) {
    let latest = await runProfessionalLiveCatalogCase(modelName, evalCase);
    const retryFailed = Math.max(0, options.retryFailed ?? 0);
    for (let attempt = 0; latest.status !== "passed" && attempt < retryFailed; attempt++) {
      console.log(`RETRY ${evalCase.id} after ${failedCheckSummary(latest.checks) || latest.error || "failed checks"}`);
      latest = await runProfessionalLiveCatalogCase(modelName, evalCase);
    }
    rows.push(latest);
    console.log(`${latest.status === "passed" ? "PASS" : "FAIL"} ${latest.caseId} ${latest.score.toFixed(2)} ${(latest.ms / 1000).toFixed(1)}s`);
  }
  const passed = rows.filter((row) => row.status === "passed").length;
  return {
    generatedAt: new Date().toISOString(),
    harnessVersion: HARNESS_VERSION,
    model: modelName,
    total: rows.length,
    passed,
    failed: rows.length - passed,
    passRate: rows.length ? passed / rows.length : 0,
    allPassed: passed === rows.length,
    rows,
  };
}

async function runProfessionalLiveCatalogCase(
  modelName: string,
  evalCase: ProfessionalEvalCase,
): Promise<ProfessionalLiveCatalogReport> {
  const started = Date.now();
  const prompt = buildProfessionalLiveCatalogPrompt(evalCase);
  try {
    const raw = await judge(modelName, prompt, { operatorSelected: true });
    const answer = parseProfessionalLiveCatalogAnswer(raw);
    const checks = gradeProfessionalLiveCatalogAnswer(evalCase, answer);
    const score = scoreChecks(checks);
    return {
      caseId: evalCase.id,
      model: modelName,
      status: score === 1 ? "passed" : "failed",
      score,
      checks,
      ms: Date.now() - started,
      answer,
      raw,
    };
  } catch (error) {
    return {
      caseId: evalCase.id,
      model: modelName,
      status: "failed",
      score: 0,
      checks: { providerReturnedUsableJson: false },
      ms: Date.now() - started,
      raw: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readProfessionalLiveCatalog(path = DEFAULT_OUT): ProfessionalLiveCatalogAggregate | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as ProfessionalLiveCatalogAggregate;
}

function writeAggregate(path: string, aggregate: ProfessionalLiveCatalogAggregate): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(aggregate, null, 2) + "\n");
}

function recordAggregate(aggregate: ProfessionalLiveCatalogAggregate, path: string, store = DEFAULT_STORE): void {
  const identity = readGitIdentity();
  const ts = Date.now();
  const caseIds = aggregate.rows.map((row) => `professional-live-catalog:${row.caseId}:${aggregate.model}`);
  const records: EvalRunRecord[] = aggregate.rows.map((row) => ({
    ts,
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash: computeCaseSetHash(caseIds),
    suite: "professional-live-catalog",
    caseId: `professional-live-catalog:${row.caseId}:${aggregate.model}`,
    model: aggregate.model,
    status: row.status === "passed" ? "pass" : "fail",
    score: row.score,
    checks: row.checks,
    failureOwner: row.status === "passed" ? undefined : row.error ? "provider" : "model",
    failureSummary: row.status === "passed" ? undefined : row.error ?? failedCheckSummary(row.checks),
    traceRef: path.replace(/\\/g, "/"),
    harnessVersion: HARNESS_VERSION,
  }));
  appendEvalRuns(records, store);
  console.log(`recorded ${records.length} professional live catalog rows to ${store} (${runKey(records[0])})`);
}

function selectedCases(): ProfessionalEvalCase[] {
  const raw = optionValue("--cases");
  if (!raw) return PROFESSIONAL_WORKFLOW_CASES;
  const wanted = new Set(raw.split(",").map((id) => id.trim()).filter(Boolean));
  return PROFESSIONAL_WORKFLOW_CASES.filter((evalCase) => wanted.has(evalCase.id));
}

function scoreChecks(checks: Record<string, boolean>): number {
  const values = Object.values(checks);
  return values.length ? values.filter(Boolean).length / values.length : 0;
}

function arrayOfString(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function mentionsRequirement(text: string, requirement: string): boolean {
  const pattern = REQUIREMENT_PATTERNS[requirement];
  if (pattern?.test(text)) return true;
  const tokens = requirement.split("_").filter((token) => token.length > 2);
  return tokens.some((token) => text.includes(token));
}

const REQUIREMENT_PATTERNS: Record<string, RegExp> = {
  artifact_refs: /artifact|source reference|clickable|file id|sheet name|row number|url field/,
  cell_payload_evidence: /cellpayload|cell payload|evidence|source row|source field|confidence|status/,
  schema_detection: /schema|layout|structure|header|merged|template|cell structure|column/,
  chat_intake_parser: /chat|intake|parse|capture|user said|manual claim/,
  entity_resolution: /entity|duplicate|disambiguat|ambiguous|match|join key|resolve/,
  clarifying_question_gate: /clarify|question|ask|ambiguous|needs_review|guess/,
  spreadsheet_semantic_index: /semantic|chunk|search|narrow window|row|column|sheet/,
  formula_dependency_locks: /formula|dependency|derived|lock|linkage|tie.?out|preserve/,
  cross_file_context: /cross.?file|multi.?sheet|join|read .* and .*|source artifact|workbook/,
  privacy_redaction: /privacy|private|public|redact|mask|pii|confidential|sensitive|leak/,
  provider_parser_adapter: /provider|parser|parse|layout|extract|ocr|adapter/,
  liteparse_layout_fallback: /liteparse|fallback|layout|parse|extract/,
  long_running_free_auto: /long.?running|free|job|checkpoint|resume|slice|resolved.?model|duplicate/,
  workflow_checkpoint_resume: /checkpoint|resume|continuation|handoff|slice|duplicate/,
  resolved_model_audit: /resolved.?model|route|model audit|provider|cost/,
  private_gold_pack: /private|gold|answer.?key|workbook|rights|local/,
  answer_key_formula_oracle: /answer.?key|oracle|grader|formula|hidden/,
  formula_structure_equivalence: /formula|structure|reference|token|equivalence|tie.?out/,
  guide_mode_no_write: /guide|coach|hint|zero.?write|no write|answer cell/,
  section_collaboration_locks: /section|collaborat|lease|lock|draft|shared/,
  wiki_grounded_update: /wiki|grounded|citation|source link|toc|section/,
  human_review: /human|review|approval|approve|needs_review|proposal|draft/,
};

function outputSurfaceMatches(surface: string, allowed: readonly string[]): boolean {
  if (allowed.includes(surface as never)) return true;
  const normalized = surface.toLowerCase().replace(/[\s-]+/g, "_");
  if (allowed.includes(normalized as never)) return true;
  if (/chat|acknowledg/.test(normalized) && allowed.includes("chat_reply_only" as never)) return true;
  if (/research.*sheet|queue|job/.test(normalized) && allowed.includes("background_job" as never)) return true;
  if (/watchlist|spreadsheet|sheet|row/.test(normalized) && allowed.includes("watchlist_row" as never)) return true;
  if (/wiki|note/.test(normalized) && allowed.includes("wiki_note" as never)) return true;
  if (/private/.test(normalized) && allowed.includes("private_note" as never)) return true;
  return false;
}

function failedCheckSummary(checks: Record<string, boolean>): string {
  return Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name).join(", ");
}

async function main(): Promise<void> {
  const modelName = optionValue("--real") ?? optionValue("--model") ?? DEFAULT_MODEL;
  const out = optionValue("--json-out") ?? DEFAULT_OUT;
  const aggregate = await runProfessionalLiveCatalog({
    model: modelName,
    cases: selectedCases(),
    retryFailed: positiveIntOption("--retry-failed") ?? 0,
  });
  writeAggregate(out, aggregate);
  if (hasFlag("--record")) recordAggregate(aggregate, out, optionValue("--eval-store") ?? DEFAULT_STORE);
  console.log(JSON.stringify({
    model: aggregate.model,
    total: aggregate.total,
    passed: aggregate.passed,
    failed: aggregate.failed,
    passRate: aggregate.passRate,
    allPassed: aggregate.allPassed,
    jsonOut: out,
  }, null, 2));
  if (hasFlag("--require-full") && !aggregate.allPassed) process.exitCode = 1;
}

function positiveIntOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
