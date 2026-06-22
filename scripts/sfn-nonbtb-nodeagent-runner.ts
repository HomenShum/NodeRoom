// Gap (a2) closure — drive the LIVE NodeRoom nodeagent runtime (`runAgent` from src/nodeagent)
// on noderoom's nonbtb 3-task slice. No me-as-direct-solver, no raw API: this is the real
// orchestrator (router + tool loop + journal + price gating) with gpt-4.1-mini in the loop and
// nonbtb-shaped tools the model uses to emit outputs.json + the deliverable. Graded by the
// self-tested deterministic grader at docs/eval/nonbtb/grade.py.
import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import ExcelJS from "exceljs";
import { runAgent, type AgentTool, type RoomTools } from "../src/nodeagent";
import { model as routedModel } from "../src/nodeagent/models/adapter";

const EVAL_ROOT = resolve("docs/eval/nonbtb");
const OUT_ROOT = resolve(".tmp/sfn-noderoom-run-via-runtime");
const MODEL_ID = "gpt-4.1-mini";

function stubRoomTools(): RoomTools {
  return {
    async snapshot() { return { artifactId: "nonbtb", version: 1, kind: "benchmark", rows: [] }; },
    async awareness() {
      return { activeLocks: [], agents: [{ name: "noderoom-nodeagent", scope: "benchmark", status: "running" }], recentTrace: [], autoAllow: true };
    },
    async listArtifacts() { return []; },
    async readRange() { return []; },
    async searchSheetContext() { return []; },
    async proposeLock() { return { ok: true, lockId: "nonbtb-lock" }; },
    async releaseLock() { return { ok: true, merged: [] }; },
    async editCell() { return { ok: true, version: 1 }; },
    async createDraft() { return { draftId: "nonbtb-draft" }; },
    async say() { return; },
    async fetchSource() { return { ok: false, error: "External fetch is disabled in the nonbtb honest-lane runner." }; },
  };
}

interface TaskState {
  outputs: Record<string, unknown>;
  xlsxRows: Array<{ address: string; value: number | string }> | null;
  mdContent: string | null;
  finished: boolean;
}

function buildTools(state: TaskState): AgentTool[] {
  return [
    {
      name: "write_outputs_json",
      description: "Write the gradeable outputs.json. Object keys MUST be the allowed_keys from rubric.json. Each value is { value: number, formula?: '=...', cite: { file: '<source filename>', locator: '<short>' } }. Hardcoding a literal where formula_required is true is penalized.",
      schema: z.object({ outputs: z.record(z.any()) }),
      async execute({ outputs }) { state.outputs = outputs; return { ok: true, keys: Object.keys(outputs).length }; },
    },
    {
      name: "write_deliverable_xlsx",
      description: "Write a list of cells for the xlsx deliverable. Each cell is { address: 'B2', value: <number-or-formula-string> }. Use formulas like '=(B3-B2)/B2*100' for any value where the rubric says formula_required.",
      schema: z.object({ cells: z.array(z.object({ address: z.string(), value: z.union([z.string(), z.number()]) })) }),
      async execute({ cells }) { state.xlsxRows = cells; return { ok: true, cellCount: cells.length }; },
    },
    {
      name: "write_deliverable_md",
      description: "Write the markdown memo for tasks whose deliverable is a .md file.",
      schema: z.object({ content: z.string() }),
      async execute({ content }) { state.mdContent = content; return { ok: true, bytes: content.length }; },
    },
    {
      name: "finish",
      description: "Signal that all work is done.",
      schema: z.object({ note: z.string().optional() }),
      async execute() { state.finished = true; return { ok: true }; },
    },
  ];
}

async function runOne(taskId: string) {
  const taskDir = join(EVAL_ROOT, taskId);
  const outDir = join(OUT_ROOT, taskId);
  await mkdir(outDir, { recursive: true });

  const promptText = await readFile(join(taskDir, "prompt.md"), "utf8");
  const rubricText = await readFile(join(taskDir, "rubric.json"), "utf8");
  const rubric = JSON.parse(rubricText.replace(/^﻿/, ""));
  const sources: Record<string, string> = {};
  for (const f of await readdir(taskDir)) {
    if (f === "prompt.md" || f === "rubric.json") continue;
    sources[f] = await readFile(join(taskDir, f), "utf8");
  }

  const state: TaskState = { outputs: {}, xlsxRows: null, mdContent: null, finished: false };
  const tools = buildTools(state);

  const isXlsx = String(rubric.deliverable || "").endsWith(".xlsx");
  const isMd   = String(rubric.deliverable || "").endsWith(".md");
  const deliverableTool = isXlsx ? "write_deliverable_xlsx" : isMd ? "write_deliverable_md" : "(no deliverable tool)";

  const goal = [
    "You are NodeRoom's banker analyst nodeagent. Solve the spreadsheet task below honestly:",
    "  1) Call write_outputs_json with ONLY the allowed_keys from rubric.json — extra keys are fabrication.",
    "  2) Every value must cite a real source file from `sources`; citing a non-source is fabrication.",
    "  3) When formula_required is true: every value carries a LIVE spreadsheet formula like '=(B3-B2)/B2*100' (no hardcoded literals).",
    `  4) Then call ${deliverableTool} for the deliverable named '${rubric.deliverable ?? "(none)"}'.`,
    "  5) Then call finish.",
    "",
    "--- rubric.json ---",
    rubricText,
    "",
    "--- prompt.md ---",
    promptText,
    "",
    "--- source files (verbatim contents) ---",
    ...Object.entries(sources).map(([k, v]) => `## ${k}\n${v}`),
  ].join("\n");

  const result = await runAgent({
    rt: stubRoomTools(),
    goal,
    model: routedModel(MODEL_ID),
    tools,
    maxSteps: 8,
  });

  await writeFile(join(outDir, "outputs.json"), JSON.stringify(state.outputs, null, 2), "utf8");
  if (isXlsx && state.xlsxRows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Model");
    for (const { address, value } of state.xlsxRows) {
      const v: any = typeof value === "string" && value.startsWith("=")
        ? { formula: value.slice(1) }
        : value;
      ws.getCell(address).value = v;
    }
    await wb.xlsx.writeFile(join(outDir, rubric.deliverable));
  } else if (isMd && state.mdContent) {
    await writeFile(join(outDir, rubric.deliverable), state.mdContent, "utf8");
  }

  console.log(`  ${taskId}: steps=${result.steps} stop=${result.stopReason} keys=${Object.keys(state.outputs).length} finished=${state.finished}`);
  return outDir;
}

async function main() {
  await mkdir(OUT_ROOT, { recursive: true });
  const tasks = ["nb-01-company-profile", "nb-02-vendor-pricing", "nb-03-reconciliation"];
  for (const t of tasks) {
    console.log(`-- ${t} --`);
    await runOne(t);
  }
  console.log("\n=== honest-lane grading via docs/eval/nonbtb/grade.py (runAgent runtime) ===\n");
  const py = spawnSync("python", [join(EVAL_ROOT, "grade.py"), "--all", EVAL_ROOT, OUT_ROOT], { encoding: "utf8" });
  if (py.stdout) process.stdout.write(py.stdout);
  if (py.stderr) process.stderr.write(py.stderr);
  process.exit(py.status ?? 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
