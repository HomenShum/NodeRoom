import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { z } from "zod";
import { runAgent, type AgentModel, type AgentTool, type AgentTraceEvent, type RoomTools } from "../nodeagent";

export interface BankerToolBenchSourceFacts {
  sector: string;
  sicDescription: string;
  companyName?: string;
  description?: string;
  vdrSourcePath?: string;
  edgarSourcePath?: string;
}

export interface BankerToolBenchNodeAgentSmokeOptions {
  instruction: string;
  facts: BankerToolBenchSourceFacts;
  outDir: string;
  trajectoryOut: string;
  traceOut: string;
  nowIso?: string;
}

export interface BankerToolBenchNodeAgentSmokeResult {
  ok: boolean;
  stopReason: string;
  steps: number;
  deliverablesDir: string;
  deliverables: string[];
  trajectoryOut: string;
  traceOut: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
  };
}

interface AtifStep {
  step_id: number;
  source: "user" | "agent";
  message: string;
  model_name?: string;
  tool_calls?: Array<{
    tool_call_id: string;
    function_name: string;
    arguments: Record<string, unknown>;
  }>;
  observation?: {
    results: Array<{
      source_call_id: string;
      content: string;
    }>;
  };
}

const deliverableSchema = z.object({
  filename: z.string().min(1),
  content: z.string(),
});

const writeLockedCellsSchema = z.object({
  files: z.array(deliverableSchema).min(1),
});

const allowedDeliverables = new Set([
  "vdr_answer.txt",
  "edgar_answer.txt",
  "summary.txt",
  "boundary_box_receipts.json",
]);

export async function loadBankerToolBenchSourceFacts(path: string): Promise<BankerToolBenchSourceFacts> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, "")) as Partial<BankerToolBenchSourceFacts>;
  return normalizeFacts(parsed);
}

export async function runBankerToolBenchNodeAgentSmoke(
  opts: BankerToolBenchNodeAgentSmokeOptions,
): Promise<BankerToolBenchNodeAgentSmokeResult> {
  const facts = normalizeFacts(opts.facts);
  const outDir = resolve(opts.outDir);
  const deliverablesDir = join(outDir, "deliverables");
  await mkdir(deliverablesDir, { recursive: true });
  await mkdir(resolve(opts.trajectoryOut, ".."), { recursive: true });
  await mkdir(resolve(opts.traceOut, ".."), { recursive: true });

  const trace: AgentTraceEvent[] = [];
  const model = createSmokeModel(facts);
  const tools = createBankerToolBenchTools(deliverablesDir);
  const result = await runAgent({
    rt: createSmokeRoomTools(),
    goal: opts.instruction,
    model,
    tools,
    maxSteps: 4,
    contextBuilder: async () => [
      {
        role: "user",
        content: [
          "BankerToolBench smoke task.",
          opts.instruction.trim(),
          "",
          "Trusted source facts extracted from the task MCP data:",
          JSON.stringify(facts, null, 2),
        ].join("\n"),
      },
    ],
    systemPrompt: "You are NodeAgent running a BankerToolBench smoke task. Use the provided source facts and commit required deliverable files through the available managed write tool.",
    onTrace: (event) => trace.push(event),
  });

  const deliverables = Array.from(allowedDeliverables);
  const traceEnvelope = {
    instruction: opts.instruction,
    facts,
    result,
    trace,
  };
  await writeFile(opts.traceOut, JSON.stringify(traceEnvelope, null, 2));
  await writeFile(opts.trajectoryOut, JSON.stringify(toAtifTrajectory(result.messages, trace, model.name, opts.nowIso), null, 2));

  return {
    ok: result.stopReason === "done",
    stopReason: result.stopReason,
    steps: result.steps,
    deliverablesDir,
    deliverables,
    trajectoryOut: opts.trajectoryOut,
    traceOut: opts.traceOut,
    usage: result.usage,
  };
}

function createSmokeModel(facts: BankerToolBenchSourceFacts): AgentModel {
  let turn = 0;
  return {
    name: "noderoom-nodeagent-smoke-model",
    async next() {
      turn += 1;
      if (turn === 1) {
        return {
          text: "Writing BankerToolBench smoke deliverables from verified source facts.",
          done: false,
          usage: { inputTokens: 1_100, outputTokens: 180 },
          toolCalls: [
            {
              id: "btb-smoke-write-1",
              tool: "write_locked_cells",
              args: {
                files: buildDeliverables(facts),
              },
            },
          ],
        };
      }

      return {
        text: "Done. The smoke artifacts and citation receipt were written.",
        done: true,
        toolCalls: [],
        usage: { inputTokens: 480, outputTokens: 42 },
      };
    },
  };
}

function buildDeliverables(facts: BankerToolBenchSourceFacts): Array<z.infer<typeof deliverableSchema>> {
  const company = facts.companyName ?? "Viper Energy";
  return [
    {
      filename: "vdr_answer.txt",
      content: `${facts.sector}\n`,
    },
    {
      filename: "edgar_answer.txt",
      content: `${facts.sicDescription}\n`,
    },
    {
      filename: "summary.txt",
      content: `${company} is an ${facts.sector.toLowerCase()} company whose SEC industry classification is ${facts.sicDescription.toLowerCase()}.\n`,
    },
    {
      filename: "boundary_box_receipts.json",
      content: JSON.stringify(
        {
          schema: "noderoom-btb-boundary-evidence-v0",
          task: "btb-smoke",
          status: "field-level-citation-smoke",
          note: "The smoke task emits text files, so source evidence is field-level. Full BTB runs must upgrade this to PDF page+bbox, XLSX sheet+cell, PPTX slide+shape, and DOCX paragraph/run receipts.",
          receipts: [
            {
              artifact: "vdr_answer.txt",
              sourceType: "xlsx",
              sourcePath: facts.vdrSourcePath ?? null,
              field: "Sector",
              extractedValue: facts.sector,
              boundaryBoxStatus: "cell-required-in-full-eval",
            },
            {
              artifact: "edgar_answer.txt",
              sourceType: "sec-edgar-json",
              sourcePath: facts.edgarSourcePath ?? null,
              field: "sicDescription",
              extractedValue: facts.sicDescription,
              boundaryBoxStatus: "json-field-supported-no-bbox",
            },
            {
              artifact: "summary.txt",
              sourceType: "derived",
              sourcePath: [facts.vdrSourcePath, facts.edgarSourcePath].filter(Boolean),
              fields: ["Sector", "sicDescription"],
              boundaryBoxStatus: "derived-from-cited-fields",
            },
          ],
        },
        null,
        2,
      ),
    },
  ];
}

function createBankerToolBenchTools(deliverablesDir: string): AgentTool[] {
  return [
    {
      name: "write_locked_cells",
      description: "Commit BankerToolBench deliverable files through the NodeAgent managed write gate.",
      schema: writeLockedCellsSchema,
      execute: async (args: z.infer<typeof writeLockedCellsSchema>) => {
        const written: string[] = [];
        for (const file of args.files) {
          const filename = assertAllowedDeliverable(file.filename);
          const target = assertInsideDirectory(deliverablesDir, filename);
          await writeFile(target, file.content, "utf8");
          written.push(filename);
        }
        return { ok: true, written };
      },
    },
  ];
}

function createSmokeRoomTools(): RoomTools {
  return {
    async snapshot(_artifactId?: string) {
      return { artifactId: "btb-smoke", version: 1, kind: "benchmark", rows: [] };
    },
    async awareness() {
      return { activeLocks: [], agents: [{ name: "noderoom-nodeagent", scope: "benchmark", status: "running" }], recentTrace: [], autoAllow: true };
    },
    async listArtifacts() {
      return [];
    },
    async readRange(_elementIds: string[], _artifactId?: string) {
      return [];
    },
    async searchSheetContext(_query: string, _artifactId?: string, _limit?: number) {
      return [];
    },
    async proposeLock(_elementIds: string[], _reason: string, _artifactId?: string) {
      return { ok: true, lockId: "btb-smoke-lock" };
    },
    async releaseLock(_lockId: string) {
      return { ok: true, merged: [] };
    },
    async editCell(_elementId: string, _value: unknown, _baseVersion: number, _artifactId?: string, _kind?: "set" | "create" | "delete") {
      return { ok: true, version: 1 };
    },
    async createDraft(_ops: { elementId: string; value: unknown; baseVersion: number }[], _blockedByLockId: string, _note: string, _artifactId?: string) {
      return { draftId: "btb-smoke-draft" };
    },
    async say(_text: string) {
      return;
    },
    async fetchSource(_url: string) {
      return { ok: false, error: "Network fetch is disabled in the deterministic BTB smoke runner." };
    },
  };
}

function normalizeFacts(facts: Partial<BankerToolBenchSourceFacts>): BankerToolBenchSourceFacts {
  const sector = normalizeRequiredText(facts.sector, "sector");
  const sicDescription = normalizeRequiredText(facts.sicDescription, "sicDescription");
  return {
    sector,
    sicDescription,
    companyName: normalizeOptionalText(facts.companyName),
    description: normalizeOptionalText(facts.description),
    vdrSourcePath: normalizeOptionalText(facts.vdrSourcePath),
    edgarSourcePath: normalizeOptionalText(facts.edgarSourcePath),
  };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing BankerToolBench source fact: ${field}`);
  }
  return value.trim();
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function assertAllowedDeliverable(filename: string): string {
  const normalized = filename.replaceAll("\\", "/");
  if (normalized !== basename(normalized) || !allowedDeliverables.has(normalized)) {
    throw new Error(`Unsupported BankerToolBench smoke deliverable: ${filename}`);
  }
  return normalized;
}

function assertInsideDirectory(root: string, filename: string): string {
  const target = resolve(root, filename);
  const rootWithSep = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(rootWithSep)) {
    throw new Error(`Refusing to write outside deliverables directory: ${filename}`);
  }
  return target;
}

function toAtifTrajectory(
  messages: Awaited<ReturnType<typeof runAgent>>["messages"],
  trace: AgentTraceEvent[],
  modelName: string,
  nowIso?: string,
) {
  const steps: AtifStep[] = [
    {
      step_id: 1,
      source: "user",
      message: messages.find((message) => message.role === "user")?.content ?? "BankerToolBench smoke task.",
    },
  ];

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const matchingResults = trace.filter((event) => message.toolCalls?.some((call) => call.id === event.args || call.tool === event.tool));
    steps.push({
      step_id: steps.length + 1,
      source: "agent",
      message: message.content || "(tool use)",
      model_name: modelName,
      tool_calls: message.toolCalls?.map((call) => ({
        tool_call_id: call.id,
        function_name: call.tool,
        arguments: call.args,
      })),
      observation: matchingResults.length
        ? {
            results: matchingResults.map((event, index) => ({
              source_call_id: message.toolCalls?.[index]?.id ?? event.tool,
              content: JSON.stringify(event.result),
            })),
          }
        : undefined,
    });
  }

  return {
    schema_version: "ATIF-v1.6",
    session_id: "noderoom-nodeagent-btb-smoke",
    agent: {
      name: "noderoom-nodeagent",
      version: "0.1.0-smoke",
      model_name: modelName,
    },
    steps,
    final_metrics: {
      total_prompt_tokens: 1_580,
      total_completion_tokens: 222,
      total_cached_tokens: 0,
      total_cost_usd: 0,
      total_steps: steps.length,
    },
    metadata: {
      generated_at: nowIso,
      runner: "bankerToolBenchNodeAgentSmoke",
    },
  };
}
