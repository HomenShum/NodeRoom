import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  applySpreadsheetBenchOperation,
  type AgentEditPlan,
} from "../src/eval/spreadsheetBenchRunner";
import { readSpreadsheetBenchWorkbookForCells } from "../src/eval/spreadsheetBenchScorer";

type AgentManifest = {
  taskId: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
};

type EvaluatorManifest = {
  answerPosition?: string;
  goldFiles: string[];
};

const args = process.argv.slice(2);
const stage = resolve(requiredOption("--stage-root"));
const modelOutput = resolve(requiredOption("--model-output-root"));
const datasetRoot = resolve(requiredOption("--dataset-root"));
const receiptPath = resolve(requiredOption("--receipt-out"));
const upstreamRepo = resolve(requiredOption("--upstream-repo"));
const resume = args.includes("--resume");
const offset = numberOption("--offset") ?? 0;
const limit = numberOption("--limit");
const spreadsheetRoot = resolve(datasetRoot, "spreadsheet");
mkdirSync(spreadsheetRoot, { recursive: true });

const upstreamEvaluationPath = resolve(upstreamRepo, "evaluation", "evaluation.py");
if (!existsSync(upstreamEvaluationPath)) throw new Error(`upstream evaluator is missing: ${upstreamEvaluationPath}`);
const upstreamCommit = gitHead(upstreamRepo);
const evaluatorSha256 = sha256File(upstreamEvaluationPath);
const allTaskDirs = findTaskDirs(resolve(stage, "tasks"));
const taskDirs = allTaskDirs.slice(offset, limit === undefined ? undefined : offset + limit);
const dataset: Array<Record<string, unknown>> = [];
const cases: Array<Record<string, unknown>> = [];
const errors: Array<{ taskId: string; caseIndex: number; message: string }> = [];

for (const [taskIndex, taskDir] of taskDirs.entries()) {
  const agentPath = resolve(taskDir, "agent", "task.json");
  const evaluatorPath = resolve(taskDir, "evaluator", "evaluator.json");
  const agent = readJson<AgentManifest>(agentPath);
  const evaluator = readJson<EvaluatorManifest>(evaluatorPath);
  const planPath = resolve(modelOutput, agent.taskId, "model-edit-plan.json");
  const plan = existsSync(planPath) ? readJson<AgentEditPlan>(planPath) : { schema: 1 as const, operations: [] };
  const taskOutput = resolve(spreadsheetRoot, agent.taskId);
  mkdirSync(taskOutput, { recursive: true });
  const caseCount = Math.min(agent.inputFiles.length, evaluator.goldFiles.length);

  dataset.push({
    id: agent.taskId,
    instruction: agent.instruction,
    spreadsheet_path: `spreadsheet/${agent.taskId}`,
    instruction_type: agent.instructionType ?? "Cell-Level Manipulation",
    answer_position: evaluator.answerPosition ?? "",
  });

  for (let caseIndex = 0; caseIndex < caseCount; caseIndex += 1) {
    const sourceInput = resolve(dirname(agentPath), agent.inputFiles[caseIndex]);
    const sourceGold = resolve(dirname(evaluatorPath), evaluator.goldFiles[caseIndex]);
    const candidate = resolve(taskOutput, `${caseIndex + 1}_${agent.taskId}_input.xlsx`);
    const gold = resolve(taskOutput, `${caseIndex + 1}_${agent.taskId}_answer.xlsx`);
    let status: "applied" | "copied_after_error" | "resumed" = "applied";
    let error: string | undefined;

    if (resume && existsSync(candidate) && existsSync(gold)) {
      status = "resumed";
    } else {
      copyFileSync(sourceGold, gold);
      try {
        const workbook = await readSpreadsheetBenchWorkbookForCells(sourceInput);
        for (const operation of plan.operations) applySpreadsheetBenchOperation(workbook, operation);
        await workbook.xlsx.writeFile(candidate);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
        errors.push({ taskId: agent.taskId, caseIndex: caseIndex + 1, message: error });
        copyFileSync(sourceInput, candidate);
        status = "copied_after_error";
      }
    }

    cases.push({
      taskId: agent.taskId,
      caseIndex: caseIndex + 1,
      status,
      operationCount: plan.operations.length,
      planSha256: existsSync(planPath) ? sha256File(planPath) : null,
      candidate: rel(candidate),
      candidateSha256: sha256File(candidate),
      gold: rel(gold),
      goldSha256: sha256File(gold),
      ...(error ? { error } : {}),
    });
  }

  if ((taskIndex + 1) % 50 === 0 || taskIndex + 1 === taskDirs.length) {
    console.log(`projected ${taskIndex + 1}/${taskDirs.length} task(s), ${cases.length} case(s), errors=${errors.length}`);
  }
}

const shardDir = resolve(datasetRoot, ".projection-shards");
const shardDatasetPath = resolve(shardDir, `dataset-${String(offset).padStart(4, "0")}-${String(taskDirs.length).padStart(4, "0")}.json`);
writeJson(shardDatasetPath, dataset);
if (offset === 0 && taskDirs.length === allTaskDirs.length) writeJson(resolve(datasetRoot, "dataset.json"), dataset);
const caseManifestHash = createHash("sha256")
  .update(JSON.stringify(cases.map((item) => [item.taskId, item.caseIndex, item.candidateSha256, item.goldSha256])))
  .digest("hex");
writeJson(receiptPath, {
  schema: 1,
  generatedAt: new Date().toISOString(),
  track: "spreadsheetbench-v1",
  policy: "one model-generated edit plan projected across every official workbook variant",
  stageRoot: rel(stage),
  modelOutputRoot: rel(modelOutput),
  datasetRoot: rel(datasetRoot),
  taskOffset: offset,
  totalTaskCount: allTaskDirs.length,
  taskCount: dataset.length,
  caseCount: cases.length,
  projectionErrorCount: errors.length,
  caseManifestSha256: caseManifestHash,
  upstream: {
    repository: "https://github.com/RUCKBReasoning/SpreadsheetBench",
    commit: upstreamCommit,
    evaluator: rel(upstreamEvaluationPath),
    evaluatorSha256,
  },
  errors,
  cases,
});
console.log(`wrote ${rel(shardDatasetPath)}`);
console.log(`wrote ${rel(receiptPath)}`);

function findTaskDirs(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = resolve(root, entry.name);
    if (existsSync(resolve(path, "agent", "task.json")) && existsSync(resolve(path, "evaluator", "evaluator.json"))) found.push(path);
    else found.push(...findTaskDirs(path));
  }
  return found.sort((a, b) => a.localeCompare(b));
}

function gitHead(root: string): string {
  const head = readFileSync(resolve(root, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  return readFileSync(resolve(root, ".git", head.slice(5)), "utf8").trim();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredOption(name: string): string {
  const value = optionValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const value = optionValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.trunc(parsed);
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
