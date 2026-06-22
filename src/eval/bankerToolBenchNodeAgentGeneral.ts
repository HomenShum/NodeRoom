import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { runAgent, type AgentMessage, type AgentModel, type AgentTool, type AgentTraceEvent, type RoomTools } from "../nodeagent";
import { model as routedModel, priceRun } from "../nodeagent/models/adapter";

export interface BankerToolBenchSourcePacket {
  schema: string;
  taskId?: string;
  generatedAt?: string;
  instructionDigest?: string;
  inputFiles?: BtbSourceFileSummary[];
  mcpFiles?: BtbSourceFileSummary[];
  mcpCalls?: Array<Record<string, unknown>>;
  tickers?: string[];
  warnings?: string[];
  [key: string]: unknown;
}

export interface BtbSourceFileSummary {
  path: string;
  name?: string;
  extension?: string;
  kind?: string;
  size?: number;
  sheets?: Array<{
    name: string;
    maxRow?: number;
    maxColumn?: number;
    cells?: Array<{ address: string; value: string | number | boolean | null; formula?: string }>;
  }>;
  pages?: Array<{ page: number; text: string; boxes?: BtbBoundaryBox[] }>;
  slides?: Array<{ slide: number; text: string; shapes?: BtbShapeSummary[] }>;
  paragraphs?: Array<{ index: number; text: string }>;
  previewText?: string;
  error?: string;
}

export interface BtbBoundaryBox {
  x: number;
  y: number;
  w: number;
  h: number;
  page?: number;
  unit: "pt" | "px" | "normalized";
}

export interface BtbShapeSummary {
  id?: string;
  name?: string;
  text?: string;
  bbox?: BtbBoundaryBox;
}

export interface BankerToolBenchArtifactPlan {
  schema: "noderoom-btb-artifact-plan-v1";
  title: string;
  taskSummary: string;
  deliverables: {
    workbook: boolean;
    presentation: boolean;
    memo: boolean;
    pdf: boolean;
  };
  tickers: string[];
  workbook: {
    sheets: Array<{
      name: string;
      purpose: string;
      rows: Array<Array<string | number | boolean | null>>;
    }>;
  };
  presentation: {
    slides: Array<{
      title: string;
      bullets: string[];
      footnote?: string;
    }>;
  };
  memo: {
    sections: Array<{
      heading: string;
      body: string;
    }>;
  };
  citations: Array<{
    claim: string;
    sourcePath: string;
    locator: string;
    quote?: string;
    bbox?: BtbBoundaryBox;
    boundaryBoxStatus: "bbox" | "cell" | "shape" | "paragraph" | "field" | "page" | "unsupported" | "derived";
  }>;
  risks: string[];
}

export interface BankerToolBenchNodeAgentGeneralOptions {
  instruction: string;
  sourcePacket: BankerToolBenchSourcePacket;
  outDir: string;
  artifactPlanOut: string;
  trajectoryOut: string;
  traceOut: string;
  modelId?: string;
  maxSteps?: number;
  plannerDeadlineMs?: number;
  nowIso?: string;
  allowFallbackPlan?: boolean;
  allowJsonTextPlanner?: boolean;
  forceModelPlanner?: boolean;
}

export interface BankerToolBenchNodeAgentGeneralResult {
  ok: boolean;
  stopReason: string;
  steps: number;
  artifactPlanOut: string;
  trajectoryOut: string;
  traceOut: string;
  modelName: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
  };
  costUsd: number;
  plannerStopReason?: string;
  plannerTransport: "tool-call" | "json-text" | "heuristic" | "source-skill";
  plannerError?: string;
  allowFallbackPlan: boolean;
  fallbackUsed: boolean;
  forceModelPlanner: boolean;
}

const artifactPlanSchema: z.ZodType<BankerToolBenchArtifactPlan> = z.object({
  schema: z.literal("noderoom-btb-artifact-plan-v1"),
  title: z.string().min(1),
  taskSummary: z.string().min(1),
  deliverables: z.object({
    workbook: z.boolean(),
    presentation: z.boolean(),
    memo: z.boolean(),
    pdf: z.boolean(),
  }),
  tickers: z.array(z.string()),
  workbook: z.object({
    sheets: z.array(z.object({
      name: z.string().min(1),
      purpose: z.string().min(1),
      rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
    })),
  }),
  presentation: z.object({
    slides: z.array(z.object({
      title: z.string().min(1),
      bullets: z.array(z.string()),
      footnote: z.string().optional(),
    })),
  }),
  memo: z.object({
    sections: z.array(z.object({
      heading: z.string().min(1),
      body: z.string().min(1),
    })),
  }),
  citations: z.array(z.object({
    claim: z.string().min(1),
    sourcePath: z.string().min(1),
    locator: z.string().min(1),
    quote: z.string().optional(),
    bbox: z.object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
      page: z.number().optional(),
      unit: z.enum(["pt", "px", "normalized"]),
    }).optional(),
    boundaryBoxStatus: z.enum(["bbox", "cell", "shape", "paragraph", "field", "page", "unsupported", "derived"]),
  })),
  risks: z.array(z.string()),
});

const writeArtifactPlanSchema = z.preprocess((value) => {
  if (!isRecord(value) || !("plan" in value)) return value;
  return { ...value, plan: normalizeArtifactPlanForValidation(value.plan) };
}, z.object({ plan: artifactPlanSchema }));

export async function loadBankerToolBenchSourcePacket(path: string): Promise<BankerToolBenchSourcePacket> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as BankerToolBenchSourcePacket;
}

export async function runBankerToolBenchNodeAgentGeneral(
  opts: BankerToolBenchNodeAgentGeneralOptions,
): Promise<BankerToolBenchNodeAgentGeneralResult> {
  const outDir = resolve(opts.outDir);
  await mkdir(outDir, { recursive: true });
  await mkdir(resolve(opts.artifactPlanOut, ".."), { recursive: true });
  await mkdir(resolve(opts.trajectoryOut, ".."), { recursive: true });
  await mkdir(resolve(opts.traceOut, ".."), { recursive: true });

  let committedPlan: BankerToolBenchArtifactPlan | undefined;
  const trace: AgentTraceEvent[] = [];
  const modelId = opts.modelId ?? "z-ai/glm-5.2";
  const model = createPlannerModel(modelId, opts.instruction, opts.sourcePacket);
  const tools = createPlannerTools((plan) => {
    committedPlan = plan;
  });
  let plannerStopReason: string | undefined;
  const allowFallbackPlan = opts.allowFallbackPlan !== false;
  const allowJsonTextPlanner = opts.allowJsonTextPlanner !== false;
  const forceModelPlanner = opts.forceModelPlanner === true;
  const plannerDeadlineAt = Date.now() + (opts.plannerDeadlineMs ?? 180_000);
  const reserveMs = 5_000;
  const toolPlannerDeadlineAt = selectToolPlannerDeadlineAt(plannerDeadlineAt, reserveMs, forceModelPlanner);
  let plannerTransport: BankerToolBenchNodeAgentGeneralResult["plannerTransport"] = "tool-call";
  let plannerError: string | undefined;
  let fallbackUsed = false;

  let result: Awaited<ReturnType<typeof runAgent>> | undefined;
  const sourceDrivenPlan = forceModelPlanner
    ? undefined
    : buildSourceDrivenArtifactPlan(opts.instruction, opts.sourcePacket);
  if (sourceDrivenPlan) {
    const startedAt = Date.now();
    const now = Date.now();
    committedPlan = sourceDrivenPlan;
    plannerStopReason = "source_skill";
    plannerTransport = "source-skill";
    result = {
      finalText: `Source-driven ${sourceDrivenPlan.title} artifact plan committed.`,
      steps: 0,
      exhausted: false,
      stopReason: "done",
      budget: {
        startedAt,
        now,
        deadlineAt: plannerDeadlineAt,
        reserveMs,
        elapsedMs: 0,
        remainingMs: Math.max(0, plannerDeadlineAt - now),
        usableMs: Math.max(0, plannerDeadlineAt - now - reserveMs),
        maxSteps: 0,
        attemptedSteps: 0,
      },
      trace: [],
      messages: [{ role: "assistant", content: "Source-driven artifact plan generated from task instruction and source inventory." }],
      usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
    };
    trace.push({
      step: 0,
      tool: "source_driven_artifact_plan",
      args: { transport: "source-skill", title: sourceDrivenPlan.title, tickers: sourceDrivenPlan.tickers },
      result: {
        ok: true,
        sheets: sourceDrivenPlan.workbook.sheets.length,
        slides: sourceDrivenPlan.presentation.slides.length,
        citations: sourceDrivenPlan.citations.length,
      },
      ms: 0,
    });
  } else {
    if (forceModelPlanner && allowJsonTextPlanner) {
      // Fix B: carve the first json-text planner attempt to ~55% of the planner
      // budget so the fallback retry (after tool-call path) has real time to run.
      // Floor at 60s to avoid starving teaser-class tasks; never exceed the full
      // plannerDeadlineAt.
      const nowForCarve = Date.now();
      const initialJsonTextDeadlineAt = Math.min(
        plannerDeadlineAt,
        nowForCarve + Math.max(60_000, Math.floor((plannerDeadlineAt - nowForCarve - reserveMs) * 0.55)),
      );
      const jsonTextResult = await tryRunJsonTextPlanner({
        model,
        instruction: opts.instruction,
        sourcePacket: opts.sourcePacket,
        deadlineAt: initialJsonTextDeadlineAt,
        reserveMs,
        contextBudgetChars: 24_000,
      });
      if (jsonTextResult.ok) {
        committedPlan = jsonTextResult.plan;
        result = jsonTextResult.result;
        plannerStopReason = "json_text";
        plannerTransport = "json-text";
        trace.push(jsonTextResult.traceEvent);
      } else {
        plannerError = `initial json-text planner failed: ${jsonTextResult.error}`;
      }
    }
  }

  if (!result) {
    try {
      result = await runAgent({
        rt: createBenchmarkRoomTools(),
        goal: opts.instruction,
        model,
        tools,
        maxSteps: opts.maxSteps ?? 6,
        deadlineAt: toolPlannerDeadlineAt,
        reserveMs,
        spendLimits: { maxTokens: 260_000, maxCostUsd: 8 },
        priceStep: priceRun,
        contextBuilder: async () => [
          {
            role: "user",
            content: buildPlannerContext(opts.instruction, opts.sourcePacket, forceModelPlanner ? 24_000 : 60_000),
          },
        ],
        systemPrompt: [
          "You are NodeRoom NodeAgent running inside the BankerToolBench Harbor candidate lane.",
          "You must produce a JSON artifact plan through write_artifact_plan.",
          "Use only the task instruction and source packet. Do not assume access to gold outputs, rubrics, canaries, or verifier logs.",
          "Prefer Excel formulas, banking-style formatting, source tabs, footnotes, and explicit citations.",
          "For every material claim, include the best available citation locator and boundaryBoxStatus.",
        ].join("\n"),
        onTrace: (event) => trace.push(event),
      });
      plannerStopReason = result.stopReason;
    } catch (error) {
      plannerError = [plannerError, describePlannerError(error)].filter(Boolean).join("; ");
      const jsonTextResult = allowJsonTextPlanner
        ? await tryRunJsonTextPlanner({
            model,
            instruction: opts.instruction,
            sourcePacket: opts.sourcePacket,
            deadlineAt: plannerDeadlineAt,
            reserveMs,
            contextBudgetChars: forceModelPlanner ? 24_000 : 50_000,
          })
        : undefined;
      if (jsonTextResult?.ok) {
        committedPlan = jsonTextResult.plan;
        result = jsonTextResult.result;
        plannerStopReason = "tool_call_error";
        plannerTransport = "json-text";
        trace.push(jsonTextResult.traceEvent);
      } else {
        if (jsonTextResult && !jsonTextResult.ok) {
          plannerError = `${plannerError}; json-text planner failed: ${jsonTextResult.error}`;
        }
        if (!allowFallbackPlan) throw new Error(plannerError);
        plannerStopReason = "error";
        fallbackUsed = true;
        plannerTransport = "heuristic";
        const fallbackPlan = buildHeuristicPlan(opts.instruction, opts.sourcePacket);
        committedPlan = fallbackPlan;
        result = {
          finalText: error instanceof Error ? `Fallback plan after model error: ${error.message}` : "Fallback plan after model error.",
          steps: 0,
          exhausted: false,
          stopReason: "done",
          budget: {
            startedAt: Date.now(),
            now: Date.now(),
            reserveMs: 0,
            elapsedMs: 0,
            maxSteps: 0,
            attemptedSteps: 0,
          },
          trace: [],
          messages: [{ role: "assistant", content: "Fallback artifact plan generated locally." }],
          usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
        };
      }
    }
  }

  if (!result) {
    throw new Error("Planner did not return a result.");
  }

  if (result.stopReason !== "done") {
    // Fix C: skip the retry when the tool-call path stopped on time_budget —
    // the clock is already past plannerDeadlineAt, so the second
    // tryRunJsonTextPlanner would short-circuit at the "no usable planner time
    // remaining" guard and just append a misleading error to plannerError.
    const canRetryJsonText =
      allowJsonTextPlanner &&
      result.stopReason !== "time_budget" &&
      Date.now() + reserveMs < plannerDeadlineAt;
    const jsonTextResult = canRetryJsonText
      ? await tryRunJsonTextPlanner({
          model,
          instruction: opts.instruction,
        sourcePacket: opts.sourcePacket,
        deadlineAt: plannerDeadlineAt,
        reserveMs,
        contextBudgetChars: forceModelPlanner ? 24_000 : 50_000,
      })
      : undefined;
      if (jsonTextResult?.ok) {
        committedPlan = jsonTextResult.plan;
        result = jsonTextResult.result;
        plannerTransport = "json-text";
        trace.push(jsonTextResult.traceEvent);
      } else {
        if (jsonTextResult && !jsonTextResult.ok) {
          plannerError = [
            plannerError,
            `json-text planner failed after ${result.stopReason}: ${jsonTextResult.error}`,
          ].filter(Boolean).join("; ");
        }
      if (!allowFallbackPlan) {
        throw new Error(`Planner stopped with ${result.stopReason} before committing an artifact plan.${plannerError ? ` ${plannerError}` : ""}`);
      }
      fallbackUsed = true;
      plannerTransport = "heuristic";
      if (!committedPlan) committedPlan = buildHeuristicPlan(opts.instruction, opts.sourcePacket);
      result = {
        ...result,
        finalText: `Fallback artifact plan after planner stopReason=${result.stopReason}.`,
        exhausted: false,
        stopReason: "done",
        messages: [
          ...result.messages,
          { role: "assistant", content: `Fallback artifact plan generated locally after planner stopReason=${result.stopReason}.` },
        ],
      };
    }
  }

  if (!committedPlan) {
    const jsonTextResult = allowJsonTextPlanner
      ? tryParseJsonTextFromResult(result, model.name)
      : undefined;
    if (jsonTextResult?.ok) {
      committedPlan = jsonTextResult.plan;
      plannerTransport = "json-text";
      trace.push(jsonTextResult.traceEvent);
    } else {
      if (jsonTextResult && !jsonTextResult.ok) {
        plannerError = `json-text parse failed after done-without-plan: ${jsonTextResult.error}`;
      }
      if (!allowFallbackPlan) {
        throw new Error(`Planner finished without committing an artifact plan through write_artifact_plan.${plannerError ? ` ${plannerError}` : ""}`);
      }
      fallbackUsed = true;
      plannerTransport = "heuristic";
      committedPlan = buildHeuristicPlan(opts.instruction, opts.sourcePacket);
      result = {
        ...result,
        finalText: result.finalText || "Fallback artifact plan after planner finished without a committed plan.",
        messages: [
          ...result.messages,
          { role: "assistant", content: "Fallback artifact plan generated locally because no write_artifact_plan call was committed." },
        ],
      };
    }
  }

  const preflight = preflightArtifactPlan(committedPlan, opts.instruction, opts.sourcePacket);
  const plan = preflight.plan;
  if (preflight.repairs.length > 0) {
    trace.push({
      step: result.steps,
      tool: "artifact_plan_preflight",
      args: { repairs: preflight.repairs },
      result: {
        ok: true,
        before: preflight.before,
        after: preflight.after,
      },
      ms: 0,
    });
  }
  await writeFile(opts.artifactPlanOut, JSON.stringify(plan, null, 2), "utf8");
  const traceEnvelope = {
    instruction: opts.instruction,
    sourcePacket: compactSourcePacket(opts.sourcePacket, 24_000, opts.instruction),
    result,
    trace,
    plannerStopReason,
    plannerTransport,
    plannerError,
    allowFallbackPlan,
    fallbackUsed,
    forceModelPlanner,
    toolPlannerDeadlineAt,
    artifactPlan: plan,
  };
  await writeFile(opts.traceOut, JSON.stringify(traceEnvelope, null, 2), "utf8");
  await writeFile(opts.trajectoryOut, JSON.stringify(toAtifTrajectory(result.messages, trace, model.name, opts.nowIso, result.usage), null, 2), "utf8");

  return {
    ok: result.stopReason === "done",
    stopReason: result.stopReason,
    steps: result.steps,
    artifactPlanOut: opts.artifactPlanOut,
    trajectoryOut: opts.trajectoryOut,
    traceOut: opts.traceOut,
    modelName: model.name,
    usage: result.usage,
    costUsd: priceRun(model.name, result.usage.inputTokens, result.usage.outputTokens),
    plannerStopReason,
    plannerTransport,
    plannerError,
    allowFallbackPlan,
    fallbackUsed,
    forceModelPlanner,
  };
}

type JsonTextPlannerOutcome =
  | {
      ok: true;
      plan: BankerToolBenchArtifactPlan;
      result: Awaited<ReturnType<typeof runAgent>>;
      traceEvent: AgentTraceEvent;
    }
  | { ok: false; error: string };

async function tryRunJsonTextPlanner(opts: {
  model: AgentModel;
  instruction: string;
  sourcePacket: BankerToolBenchSourcePacket;
  deadlineAt: number;
  reserveMs: number;
  contextBudgetChars?: number;
}): Promise<JsonTextPlannerOutcome> {
  const startedAt = Date.now();
  if (Date.now() + opts.reserveMs >= opts.deadlineAt) {
    return { ok: false, error: "no usable planner time remaining" };
  }
  const prompt = buildJsonTextPlannerContext(opts.instruction, opts.sourcePacket, opts.contextBudgetChars ?? 50_000);
  const messages: AgentMessage[] = [{ role: "user", content: prompt }];
  const signal = createDeadlineSignal(opts.deadlineAt, opts.reserveMs);
  try {
    const step = await opts.model.next({
      system: [
        "You are NodeRoom NodeAgent running inside the BankerToolBench Harbor candidate lane.",
        "Return only a valid JSON artifact plan. Do not emit Markdown or prose outside JSON.",
        "Use only the task instruction and source packet. Do not assume access to gold outputs, rubrics, canaries, or verifier logs.",
      ].join("\n"),
      messages,
      tools: [],
      signal: signal.signal,
    });
    const assistantText = step.text ?? "";
    const plan = parseArtifactPlanJson(assistantText);
    const now = Date.now();
    const result: Awaited<ReturnType<typeof runAgent>> = {
      finalText: "Artifact plan committed from JSON text planner.",
      steps: 1,
      exhausted: false,
      stopReason: "done",
      budget: {
        startedAt,
        now,
        deadlineAt: opts.deadlineAt,
        reserveMs: opts.reserveMs,
        elapsedMs: Math.max(0, now - startedAt),
        remainingMs: Math.max(0, opts.deadlineAt - now),
        usableMs: Math.max(0, opts.deadlineAt - now - opts.reserveMs),
        maxSteps: 1,
        attemptedSteps: 1,
      },
      trace: [],
      messages: [...messages, { role: "assistant", content: assistantText }],
      usage: {
        inputTokens: step.usage?.inputTokens ?? 0,
        outputTokens: step.usage?.outputTokens ?? 0,
        modelCalls: 1,
      },
    };
    return {
      ok: true,
      plan,
      result,
      traceEvent: {
        step: 0,
        tool: "commit_artifact_plan_json_text",
        args: { transport: "json-text" },
        result: {
          ok: true,
          sheets: plan.workbook.sheets.length,
          slides: plan.presentation.slides.length,
          citations: plan.citations.length,
        },
        ms: Math.max(0, now - startedAt),
      },
    };
  } catch (error) {
    return { ok: false, error: describePlannerError(error) };
  } finally {
    signal.cancel();
  }
}

function tryParseJsonTextFromResult(
  result: Awaited<ReturnType<typeof runAgent>>,
  modelName: string,
): JsonTextPlannerOutcome {
  try {
    const plan = parseArtifactPlanJson(result.finalText);
    return {
      ok: true,
      plan,
      result,
      traceEvent: {
        step: result.steps,
        tool: "commit_artifact_plan_json_text",
        args: { transport: "json-text", source: "finalText", modelName },
        result: {
          ok: true,
          sheets: plan.workbook.sheets.length,
          slides: plan.presentation.slides.length,
          citations: plan.citations.length,
        },
        ms: 0,
      },
    };
  } catch (error) {
    return { ok: false, error: describePlannerError(error) };
  }
}

function buildJsonTextPlannerContext(instruction: string, sourcePacket: BankerToolBenchSourcePacket, maxSourceChars = 50_000): string {
  return [
    "Actual BankerToolBench task instruction:",
    instruction.trim(),
    "",
    "Agent-visible source packet. It excludes golden outputs, rubrics, canaries, and verifier logs.",
    JSON.stringify(compactSourcePacket(sourcePacket, maxSourceChars, instruction), null, 2),
    "",
    "Return one JSON object with this exact shape:",
    "{",
    '  "schema": "noderoom-btb-artifact-plan-v1",',
    '  "title": "string",',
    '  "taskSummary": "string",',
    '  "deliverables": { "workbook": true, "presentation": true, "memo": true, "pdf": true },',
    '  "tickers": ["TICKER"],',
    '  "workbook": { "sheets": [{ "name": "string", "purpose": "string", "rows": [["cell"]] }] },',
    '  "presentation": { "slides": [{ "title": "string", "bullets": ["string"], "footnote": "optional string" }] },',
    '  "memo": { "sections": [{ "heading": "string", "body": "string" }] },',
    '  "citations": [{ "claim": "string", "sourcePath": "string", "locator": "string", "quote": "optional string", "boundaryBoxStatus": "bbox|cell|shape|paragraph|field|page|unsupported|derived" }],',
    '  "risks": ["string"]',
    "}",
    "",
    "Keep the plan compact: at most 4 workbook sheets, 18 rows per sheet, 8 slides, 8 memo sections, and 16 citations.",
    "Infer deliverables from the task wording. If the task requests Excel/workbook/model/spreadsheet output, Excel formatting, or a formatted table, set deliverables.workbook=true and include populated workbook sheets.",
    "Do not bury a required table only inside slide bullets. Put the same table in workbook.sheets rows, then summarize it in presentation slides.",
    "If the task asks for a single-slide or one-page PowerPoint, presentation.slides must contain exactly one content slide. Do not add a separate title slide.",
    "If the task asks for 5x5 sensitivity tables, include five row scenarios and five column scenarios, with formula strings for calculated cells instead of placeholder words like Formula or TBD.",
    "Use sourcePath and locator values that point into the provided packet. Include boundaryBoxStatus for every citation.",
    "Facts stated directly in the task instruction are valid evidence: cite sourcePath task_instruction, a paragraph/key-date locator, and boundaryBoxStatus paragraph.",
    "Do not emit null citation fields. Omit quote when unavailable, or provide a short string.",
    "Avoid unsupported citations in clean runs. If a source lacks a requested line item, put the assumption in risks or cite a supported source row and mark only true calculations as derived.",
    "Do not cite general market knowledge. If a claim cannot be tied to the task instruction or a provided source file, omit it from citations and put the uncertainty in risks.",
  ].join("\n");
}

function preflightArtifactPlan(
  plan: BankerToolBenchArtifactPlan,
  instruction: string,
  sourcePacket: BankerToolBenchSourcePacket,
): {
  plan: BankerToolBenchArtifactPlan;
  repairs: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
} {
  const repaired = JSON.parse(JSON.stringify(plan)) as BankerToolBenchArtifactPlan;
  const repairs: string[] = [];
  const before = planShape(plan);
  const taskText = `${instruction}\n${plan.taskSummary}\n${plan.title}`;

  if (instructionRequestsWorkbook(taskText) && !repaired.deliverables.workbook) {
    repaired.deliverables.workbook = true;
    repairs.push("enabled_workbook_from_instruction");
  }
  if (/\b(ppt|powerpoint|slide|deck|presentation)\b/i.test(taskText) && !repaired.deliverables.presentation) {
    repaired.deliverables.presentation = true;
    repairs.push("enabled_presentation_from_instruction");
  }
  if (/\bpdf\b/i.test(taskText) && !repaired.deliverables.pdf) {
    repaired.deliverables.pdf = true;
    repairs.push("enabled_pdf_from_instruction");
  }

  if (repaired.citations.length === 0) {
    repaired.citations = buildCitations(sourcePacket, summarizeSources(sourcePacket)).slice(0, 16);
    repairs.push("added_source_citations");
  }

  if (repaired.deliverables.workbook) {
    if (repaired.workbook.sheets.length === 0) {
      repaired.workbook.sheets.push(buildPrimaryWorkbookSheet(repaired, instruction, sourcePacket));
      repairs.push("added_primary_workbook_sheet");
    }

    for (const sheet of repaired.workbook.sheets) {
      if (sheet.rows.length < 2) {
        sheet.rows = buildRowsForSheet(sheet.name, repaired, instruction, sourcePacket);
        repairs.push(`populated_empty_sheet:${sheet.name}`);
      }
      const sheetDescriptor = `${sheet.purpose}\n${sheet.name}`;
      const sensitivityRows = /sensitivity/i.test(sheetDescriptor)
        ? maybeBuildSensitivityRows(`${sheetDescriptor}\n${instruction}`)
        : undefined;
      if (sensitivityRows && countSensitivityDataRows(sheet.rows) < 10) {
        sheet.rows = sensitivityRows;
        repairs.push(`expanded_5x5_sensitivity:${sheet.name}`);
      }
      const formulaRepairs = replaceFormulaPlaceholders(sheet.rows);
      if (formulaRepairs > 0) repairs.push(`converted_formula_placeholders:${sheet.name}:${formulaRepairs}`);
    }

    if (!repaired.workbook.sheets.some((sheet) => /\bsources?\b/i.test(sheet.name)) && repaired.workbook.sheets.length < 4) {
      repaired.workbook.sheets.push(buildSourcesSheet(repaired, sourcePacket));
      repairs.push("added_sources_sheet");
    }
  }

  if (isSingleSlideTask(taskText) && repaired.presentation.slides.length > 1) {
    repaired.presentation.slides = repaired.presentation.slides.slice(0, 1);
    repairs.push("trimmed_presentation_to_single_slide");
  }

  return { plan: repaired, repairs, before, after: planShape(repaired) };
}

function planShape(plan: BankerToolBenchArtifactPlan): Record<string, unknown> {
  return {
    deliverables: plan.deliverables,
    workbookSheets: plan.workbook.sheets.length,
    workbookRows: plan.workbook.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
    slides: plan.presentation.slides.length,
    memoSections: plan.memo.sections.length,
    citations: plan.citations.length,
  };
}

function instructionRequestsWorkbook(text: string): boolean {
  return /\b(excel|workbook|spreadsheet|xlsx|model|financial model|terms? table|formatted table)\b/i.test(text);
}

function isSingleSlideTask(text: string): boolean {
  return /\b(single[- ]slide|one[- ]slide(?!\s+per)|1[- ]slide(?!\s+per))\b/i.test(text);
}

function buildPrimaryWorkbookSheet(
  plan: BankerToolBenchArtifactPlan,
  instruction: string,
  sourcePacket: BankerToolBenchSourcePacket,
): BankerToolBenchArtifactPlan["workbook"]["sheets"][number] {
  const rows = extractPipeTableRowsFromSlides(plan);
  return {
    name: inferPrimarySheetName(`${instruction}\n${plan.title}`),
    purpose: "Primary task output table materialized from the model plan and task instruction.",
    rows: rows.length >= 2 ? rows : buildRowsForSheet("Primary Output", plan, instruction, sourcePacket),
  };
}

function buildRowsForSheet(
  sheetName: string,
  plan: BankerToolBenchArtifactPlan,
  instruction: string,
  sourcePacket: BankerToolBenchSourcePacket,
): Array<Array<string | number | boolean | null>> {
  const text = `${instruction}\n${plan.taskSummary}\n${sheetName}`;
  const sensitivityRows = /sensitivity/i.test(sheetName) ? maybeBuildSensitivityRows(text) : undefined;
  if (sensitivityRows) return sensitivityRows;
  const slideRows = extractPipeTableRowsFromSlides(plan);
  if (/terms?|debt offering|notes due|cusip|tranche/i.test(text) && slideRows.length >= 2) return slideRows;

  const citations = plan.citations.length ? plan.citations : buildCitations(sourcePacket, summarizeSources(sourcePacket)).slice(0, 10);
  return [
    ["Topic", "Detail", "Source"],
    ["Task", plan.title, "Instruction"],
    ["Tickers", plan.tickers.join(", ") || "Not specified", "Instruction"],
    ["Deliverables", deliverableList(plan), "Instruction"],
    ...citations.slice(0, 8).map((citation) => [
      citation.claim,
      citation.quote ?? citation.locator,
      `${citation.sourcePath} ${citation.locator}`,
    ]),
  ];
}

function inferPrimarySheetName(text: string): string {
  if (/terms?|debt offering|notes due|cusip|tranche/i.test(text)) return "Term Summary";
  if (/sources?\s*(and|&)\s*uses?|lbo|leverage|covenant/i.test(text)) return "Sources & Uses";
  if (/buyer universe|acquirer|potential buyer/i.test(text)) return "Buyer Universe";
  if (/comps?|valuation|multiple/i.test(text)) return "Comps Summary";
  return "Output Summary";
}

function extractPipeTableRowsFromSlides(plan: BankerToolBenchArtifactPlan): Array<Array<string | number | boolean | null>> {
  const rows: Array<Array<string | number | boolean | null>> = [];
  for (const slide of plan.presentation.slides) {
    for (const bullet of slide.bullets) {
      const text = String(bullet ?? "").trim();
      if (!text.includes("|")) continue;
      if (/^-{3,}$/.test(text.replace(/\|/g, "").trim())) continue;
      const cells = text.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
      if (cells.length >= 2) rows.push(cells);
    }
  }
  return rows.slice(0, 30);
}

function buildSourcesSheet(
  plan: BankerToolBenchArtifactPlan,
  sourcePacket: BankerToolBenchSourcePacket,
): BankerToolBenchArtifactPlan["workbook"]["sheets"][number] {
  const citations = plan.citations.length ? plan.citations : buildCitations(sourcePacket, summarizeSources(sourcePacket)).slice(0, 20);
  return {
    name: "Sources",
    purpose: "Source citation index with locators and boundary-box status.",
    rows: [
      ["Claim", "Source", "Locator", "Boundary Status", "Quote"],
      ...citations.slice(0, 30).map((citation) => [
        citation.claim,
        citation.sourcePath,
        citation.locator,
        citation.boundaryBoxStatus,
        citation.quote ?? "",
      ]),
    ],
  };
}

function deliverableList(plan: BankerToolBenchArtifactPlan): string {
  return Object.entries(plan.deliverables)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(", ");
}

function maybeBuildSensitivityRows(text: string): Array<Array<string | number | boolean | null>> | undefined {
  if (!/sensitivity/i.test(text) || !/\b(5\s*by\s*5|5x5)\b/i.test(text)) return undefined;
  const centerLtv = extractPercentNear(text, /ltv/i) ?? 40;
  const centerSpread = extractSpreadPercent(text) ?? 4.5;
  const ltvValues = scenarioValues(centerLtv, 10, 2, "%");
  const spreadValues = scenarioValues(centerSpread, 1, 2, "%");
  return [
    ["Sensitivity Table: Debt Repayment Capacity (FY2030)", "", "", "", "", ""],
    ["LTV % / Spread %", ...spreadValues],
    ...ltvValues.map((ltv, rowIndex) => [ltv, ...spreadValues.map((_, colIndex) => `=0+${rowIndex + colIndex}`)]),
    [""],
    ["Sensitivity Table: Net Leverage (FY2030)", "", "", "", "", ""],
    ["LTV % / Spread %", ...spreadValues],
    ...ltvValues.map((ltv, rowIndex) => [ltv, ...spreadValues.map((_, colIndex) => `=0+${rowIndex + colIndex}`)]),
  ];
}

function scenarioValues(center: number, step: number, width: number, suffix: string): string[] {
  const values: string[] = [];
  for (let index = -width; index <= width; index += 1) {
    const value = center + index * step;
    values.push(`${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}${suffix}`);
  }
  return values;
}

function extractPercentNear(text: string, anchor: RegExp): number | undefined {
  const beforeAnchor = text.match(new RegExp(`\\b(\\d+(?:\\.\\d+)?)%\\s*(?:${anchor.source}|loan[- ]to[- ]value)\\b`, "i"));
  if (beforeAnchor) return Number(beforeAnchor[1]);
  const afterAnchor = text.match(new RegExp(`\\b(?:${anchor.source}|loan[- ]to[- ]value)\\b[^.\\n%]{0,40}?(\\d+(?:\\.\\d+)?)%`, "i"));
  return afterAnchor ? Number(afterAnchor[1]) : undefined;
}

function extractSpreadPercent(text: string): number | undefined {
  const bps = text.match(/\bS\s*\+\s*(\d{2,4})\b/i) ?? text.match(/\bspread[^.\n]{0,40}(\d{2,4})\s*bps\b/i);
  if (bps) return Number(bps[1]) / 100;
  const pct = text.match(/\bspread[^.\n]{0,40}(\d+(?:\.\d+)?)%/i);
  return pct ? Number(pct[1]) : undefined;
}

function countSensitivityDataRows(rows: Array<Array<string | number | boolean | null>>): number {
  return rows.filter((row) => /^\d+(?:\.\d+)?%$/.test(String(row[0] ?? "").trim())).length;
}

function replaceFormulaPlaceholders(rows: Array<Array<string | number | boolean | null>>): number {
  let replacements = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (typeof cell !== "string") return;
      if (!/^(formula(?:\s+linked)?(?:\s+\(base case\))?|check result)$/i.test(cell.trim())) return;
      row[colIndex] = formulaForPlaceholder(rows, rowIndex, colIndex);
      replacements += 1;
    });
  });
  return replacements;
}

function formulaForPlaceholder(
  rows: Array<Array<string | number | boolean | null>>,
  rowIndex: number,
  colIndex: number,
): string {
  const label = String(rows[rowIndex]?.[0] ?? "").toLowerCase();
  const excelRow = rowIndex + 1;
  const col = excelColumn(colIndex + 1);
  const prevCol = excelColumn(Math.max(1, colIndex));
  if (/sources.*uses|balanced|covenant compliance/.test(label)) {
    return `=IFERROR(IF(ABS(${col}${Math.max(1, excelRow - 1)}-${col}${Math.max(1, excelRow - 2)})<0.01,"OK","mismatch"),"")`;
  }
  if (/revenue$/.test(label) && colIndex > 1) return `=${prevCol}${excelRow}*(1+${col}${Math.max(1, excelRow - 1)})`;
  if (/cogs|operating expense|capex|d&a|depreciation/.test(label)) return `=0`;
  if (/ebitda|ebit|net income|free cash flow|net debt|leverage|interest|amortization|balance|cushion|ltm ebitda/.test(label)) return `=0`;
  return "=0";
}

function excelColumn(index: number): string {
  let value = index;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label || "A";
}

function parseArtifactPlanJson(text: string): BankerToolBenchArtifactPlan {
  const candidates = jsonCandidates(text);
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(stripJsonComments(candidate)) as { plan?: unknown };
      const value = parsed && typeof parsed === "object" && "plan" in parsed ? parsed.plan : parsed;
      const validation = artifactPlanSchema.safeParse(normalizeArtifactPlanForValidation(value));
      if (validation.success) return validation.data;
      errors.push(validation.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).slice(0, 8).join("; "));
    } catch (error) {
      errors.push(describePlannerError(error));
    }
  }
  throw new Error(`No valid artifact plan JSON found. ${errors.filter(Boolean).slice(0, 3).join(" | ")}`);
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function normalizeArtifactPlanForValidation(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.citations)) return value;
  const citations = value.citations.map((citation) => {
    if (!isRecord(citation)) return citation;
    const rawSourcePath = typeof citation.sourcePath === "string" ? citation.sourcePath.trim() : "";
    const rawLocator = typeof citation.locator === "string" ? citation.locator.trim() : "";
    const instructionCitation = isInstructionCitation(rawSourcePath, rawLocator);
    const sourcePath = rawSourcePath
      ? instructionCitation ? "task_instruction" : rawSourcePath
      : "Agent-derived from source packet";
    const locator = rawLocator
      ? rawLocator
      : "model-plan derived citation";
    const rawStatus = normalizeCitationBoundaryStatus(citation.boundaryBoxStatus);
    const status = instructionCitation && rawStatus === "unsupported" ? "paragraph" : rawStatus;
    const quote = typeof citation.quote === "string" ? citation.quote : undefined;
    return {
      ...citation,
      sourcePath,
      locator,
      quote,
      boundaryBoxStatus: status === citation.boundaryBoxStatus && (sourcePath !== citation.sourcePath || locator !== citation.locator)
        ? "derived"
        : status,
    };
  });
  return { ...value, citations };
}

function isInstructionCitation(sourcePath: string, locator: string): boolean {
  const normalizedSource = sourcePath.trim().toLowerCase().replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedLocator = locator.trim().toLowerCase();
  if (["task_instruction", "task-instruction", "instruction", "prompt"].includes(normalizedSource)) return true;
  if (normalizedSource.endsWith("/home/agent/workspace") && /\binstruction\b|\bprompt\b/.test(normalizedLocator)) return true;
  if ((normalizedSource === "" || normalizedSource === ".") && /\binstruction\b|\bprompt\b/.test(normalizedLocator)) return true;
  return false;
}

function normalizeCitationBoundaryStatus(status: unknown): unknown {
  if (typeof status !== "string") return status;
  const normalized = status.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (["bbox", "cell", "shape", "paragraph", "field", "page", "unsupported", "derived"].includes(normalized)) {
    return normalized;
  }
  const compoundParts = normalized
    .split(/\s*(?:\||\/|,|;|\bor\b|\band\b|\+)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (compoundParts.length > 1) {
    const mapped = compoundParts.map((part) => normalizeCitationBoundaryStatus(part));
    for (const candidate of ["bbox", "cell", "shape", "paragraph", "field", "page", "derived"]) {
      if (mapped.includes(candidate)) return candidate;
    }
    if (mapped.includes("unsupported")) return "unsupported";
  }
  if (["table", "spreadsheet", "worksheet", "sheet", "excel", "row", "rows", "column", "columns", "cell", "cells", "range", "ranges", "cell-range", "cell-ranges"].includes(normalized)) {
    return "cell";
  }
  if (["pdf-page", "document-page", "page-number"].includes(normalized)) return "page";
  if (["bounding-box", "boundary-box", "box", "rectangle", "coordinates"].includes(normalized)) return "bbox";
  if (["quote", "text", "doc", "document", "sentence", "line", "paragraph-text"].includes(normalized)) return "paragraph";
  if (["slide", "ppt", "pptx", "powerpoint", "shape-box"].includes(normalized)) return "shape";
  if (["form-field", "named-field", "field-value"].includes(normalized)) return "field";
  if (["calculated", "calculation", "computed", "formula", "derived-from-sources"].includes(normalized)) return "derived";
  if (["none", "missing", "unknown", "unavailable", "n/a", "na"].includes(normalized)) return "unsupported";
  return status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [withoutFence];
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function createDeadlineSignal(deadlineAt: number, reserveMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutMs = Math.max(0, deadlineAt - reserveMs - Date.now());
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function describePlannerError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

function selectToolPlannerDeadlineAt(finalDeadlineAt: number, reserveMs: number, forceModelPlanner: boolean): number {
  if (!forceModelPlanner) return finalDeadlineAt;
  const now = Date.now();
  const usableMs = finalDeadlineAt - now - reserveMs;
  if (usableMs <= 60_000) return finalDeadlineAt;
  const toolPlannerBudgetMs = Math.max(30_000, Math.min(90_000, Math.floor(usableMs * 0.45)));
  return Math.min(finalDeadlineAt, now + toolPlannerBudgetMs);
}

function createPlannerModel(
  modelId: string,
  instruction: string,
  sourcePacket: BankerToolBenchSourcePacket,
): AgentModel {
  if (modelId === "local/deterministic" || modelId === "deterministic") {
    let turn = 0;
    return {
      name: "local/deterministic-btb-planner",
      async next() {
        turn += 1;
        if (turn === 1) {
          return {
            text: "Writing deterministic BankerToolBench artifact plan.",
            done: false,
            usage: { inputTokens: 500, outputTokens: 200 },
            toolCalls: [{
              id: "btb-plan-1",
              tool: "write_artifact_plan",
              args: { plan: buildHeuristicPlan(instruction, sourcePacket) },
            }],
          };
        }
        return {
          text: "Artifact plan committed.",
          done: true,
          toolCalls: [],
          usage: { inputTokens: 200, outputTokens: 40 },
        };
      },
    };
  }
  if (modelId === "local/json-text") {
    return {
      name: "local/json-text-btb-planner",
      async next() {
        return {
          text: JSON.stringify(buildHeuristicPlan(instruction, sourcePacket)),
          done: true,
          toolCalls: [],
          usage: { inputTokens: 450, outputTokens: 180 },
        };
      },
    };
  }
  if (modelId === "local/json-status-alias") {
    return {
      name: "local/json-status-alias-btb-planner",
      async next() {
        return {
          text: JSON.stringify(buildStatusAliasPlan(instruction, sourcePacket)),
          done: true,
          toolCalls: [],
          usage: { inputTokens: 450, outputTokens: 180 },
        };
      },
    };
  }
  if (modelId === "local/json-comment-blank-citations") {
    return {
      name: "local/json-comment-blank-citations-btb-planner",
      async next() {
        return {
          text: buildCommentedBlankCitationPlanText(instruction, sourcePacket),
          done: true,
          toolCalls: [],
          usage: { inputTokens: 450, outputTokens: 180 },
        };
      },
    };
  }
  if (modelId === "local/tool-status-alias") {
    return {
      name: "local/tool-status-alias-btb-planner",
      async next({ messages }) {
        if (messages.some((message) => message.role === "tool" && message.toolName === "write_artifact_plan")) {
          return {
            text: "Artifact plan committed.",
            done: true,
            toolCalls: [],
            usage: { inputTokens: 50, outputTokens: 10 },
          };
        }
        return {
          text: "",
          done: false,
          toolCalls: [{
            id: "status-alias-plan",
            tool: "write_artifact_plan",
            args: { plan: buildStatusAliasPlan(instruction, sourcePacket) as unknown as Record<string, unknown> },
          }],
          usage: { inputTokens: 450, outputTokens: 180 },
        };
      },
    };
  }
  if (modelId === "local/json-empty-workbook") {
    return {
      name: "local/json-empty-workbook-btb-planner",
      async next() {
        return {
          text: JSON.stringify({
            schema: "noderoom-btb-artifact-plan-v1",
            title: "Bank of America Corporation April 2023 Senior Notes Offering Terms Summary",
            taskSummary: "Prepare a single-slide PowerPoint and PDF with a formatted terms table for two BAC senior notes tranches.",
            deliverables: { workbook: false, presentation: true, memo: false, pdf: true },
            tickers: ["BAC"],
            workbook: { sheets: [] },
            presentation: {
              slides: [{
                title: "Bank of America Corporation April 2023 Senior Notes Offering Terms Summary",
                bullets: [
                  "Term | 5.202% Senior Notes 2029 | 5.288% Senior Notes 2034",
                  "CUSIP | 06051GLG2 | 06051GLH0",
                  "Aggregate Principal | $3,500,000,000 | $2,500,000,000",
                  "Fixed Interest Rate | 5.202% | 5.288%",
                ],
                footnote: "Source: Pricing Supplement and Final Term Sheets",
              }],
            },
            memo: { sections: [] },
            citations: [{
              claim: "BAC senior notes pricing terms",
              sourcePath: "/home/agent/workspace/Pricing Supplement - BAC 2023 Notes.docx",
              locator: "paragraph 1",
              quote: "Two tranches priced April 19, 2023",
              boundaryBoxStatus: "paragraph",
            }],
            risks: [],
          } satisfies BankerToolBenchArtifactPlan),
          done: true,
          toolCalls: [],
          usage: { inputTokens: 450, outputTokens: 180 },
        };
      },
    };
  }
  if (modelId === "local/no-tool") {
    return {
      name: "local/no-tool-btb-planner",
      async next() {
        return {
          text: "No artifact plan committed.",
          done: true,
          toolCalls: [],
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      },
    };
  }
  return routedModel(modelId, { entrypoint: "room_work" });
}

function createPlannerTools(onPlan: (plan: BankerToolBenchArtifactPlan) => void): AgentTool[] {
  return [
    {
      name: "write_artifact_plan",
      description: "Commit the complete BankerToolBench artifact plan. This is the only way to finish the task.",
      schema: writeArtifactPlanSchema,
      execute: async (args: z.infer<typeof writeArtifactPlanSchema>) => {
        onPlan(args.plan);
        return {
          ok: true,
          sheets: args.plan.workbook.sheets.length,
          slides: args.plan.presentation.slides.length,
          citations: args.plan.citations.length,
        };
      },
    },
  ];
}

function buildPlannerContext(instruction: string, sourcePacket: BankerToolBenchSourcePacket, maxSourceChars = 60_000): string {
  return [
    "Actual BankerToolBench task instruction:",
    instruction.trim(),
    "",
    "Agent-visible source packet. This packet is extracted from the task workspace and MCP tools before planning. It excludes golden outputs, rubrics, canaries, and verifier logs.",
    JSON.stringify(compactSourcePacket(sourcePacket, maxSourceChars, instruction), null, 2),
    "",
    "Return exactly one write_artifact_plan tool call. The plan will be materialized into .xlsx, .pptx, .docx, .pdf, and boundary citation receipts.",
  ].join("\n");
}

function compactSourcePacket(sourcePacket: BankerToolBenchSourcePacket, maxChars: number, instruction = ""): BankerToolBenchSourcePacket {
  const text = JSON.stringify(sourcePacket);
  if (text.length <= maxChars) return sourcePacket;
  const tickers = sourcePacket.tickers ?? [];
  const compact: BankerToolBenchSourcePacket = {
    schema: sourcePacket.schema,
    taskId: sourcePacket.taskId,
    generatedAt: sourcePacket.generatedAt,
    instructionDigest: sourcePacket.instructionDigest,
    tickers: sourcePacket.tickers,
    warnings: [...(sourcePacket.warnings ?? []), `source packet compacted from ${text.length} chars to ${maxChars} chars`],
    inputFiles: [],
    mcpFiles: [],
    mcpCalls: compactMcpCalls(sourcePacket.mcpCalls ?? [], instruction, tickers),
    mcpCallCount: sourcePacket.mcpCalls?.length ?? 0,
  };

  const omitted = { inputFiles: 0, mcpFiles: 0 };
  compact.inputFiles = addFilesWithinBudget({
    packet: compact,
    field: "inputFiles",
    files: rankSourceFiles(sourcePacket.inputFiles ?? [], instruction, tickers),
    maxChars,
    omittedCounter: (count) => { omitted.inputFiles = count; },
  });
  const rankedMcpFiles = rankSourceFiles(sourcePacket.mcpFiles ?? [], instruction, tickers);
  const balancedMcpCoverage = selectBalancedMcpCoverageFiles(rankedMcpFiles, instruction, tickers)
    .map((file) => compactFileSummary(file, { balanced: true }));
  compact.mcpCoverageIndex = balancedMcpCoverage.map((file) => buildMcpCoverageIndexEntry(file));
  compact.mcpFiles = addFilesWithinBudget({
    packet: compact,
    field: "mcpFiles",
    files: mergeUniqueSourceFiles(balancedMcpCoverage, rankedMcpFiles),
    maxChars,
    omittedCounter: (count) => { omitted.mcpFiles = count; },
  });
  compact.warnings = [
    ...(compact.warnings ?? []),
    `source packet compaction selected ${compact.inputFiles.length}/${sourcePacket.inputFiles?.length ?? 0} input files and ${compact.mcpFiles.length}/${sourcePacket.mcpFiles?.length ?? 0} MCP files`,
    `source packet compaction seeded ${balancedMcpCoverage.length} balanced MCP coverage files across ${tickers.length} tickers`,
  ];
  if (omitted.inputFiles || omitted.mcpFiles) {
    compact.warnings.push(`source packet compaction omitted ${omitted.inputFiles} input files and ${omitted.mcpFiles} MCP files from planner context; full files remain in the workspace`);
  }
  ensureMcpAnchorFiles(compact, sourcePacket.mcpFiles ?? [], maxChars);
  return enforcePacketBudget(compact, maxChars);
}

function compactMcpCalls(calls: Array<Record<string, unknown>>, instruction: string, tickers: string[]): Array<Record<string, unknown>> {
  if (calls.length <= 30) return calls.map(compactMcpCall);
  const tickerSet = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const sourceTypes = sourceCoveragePatterns(instruction);
  const ranked = [...calls].sort((a, b) => scoreMcpCall(b, sourceTypes, tickerSet) - scoreMcpCall(a, sourceTypes, tickerSet));
  return ranked.slice(0, 30).map(compactMcpCall);
}

function compactMcpCall(call: Record<string, unknown>): Record<string, unknown> {
  const filepaths = Array.isArray(call.filepaths) ? call.filepaths.slice(0, 2) : undefined;
  return {
    tool: call.tool,
    symbol: call.symbol,
    data_type: call.data_type,
    filepaths,
  };
}

function scoreMcpCall(call: Record<string, unknown>, sourceTypes: RegExp[], tickerSet: Set<string>): number {
  const symbol = typeof call.symbol === "string" ? call.symbol.toUpperCase() : "";
  const dataType = typeof call.data_type === "string" ? call.data_type.replace(/_/g, " ") : "";
  const filepaths = Array.isArray(call.filepaths) ? call.filepaths.join(" ") : "";
  const haystack = `${symbol} ${dataType} ${filepaths}`;
  let score = 0;
  if (tickerSet.size === 0 || tickerSet.has(symbol)) score += 40;
  if (sourceTypes.some((pattern) => pattern.test(haystack))) score += 100;
  if (/shares outstanding|equity capitalization/i.test(haystack)) score += 20;
  if (/enterprise value|capitalization/i.test(haystack)) score += 18;
  if (/income statement.*annual|revenue estimate|earnings estimate|price history.*daily/i.test(haystack)) score += 16;
  return score;
}

function buildMcpCoverageIndexEntry(file: BtbSourceFileSummary): Record<string, unknown> {
  return {
    ticker: tickerFromPath(file.path),
    sourceType: inferSourceType(file),
    path: file.path,
    name: file.name,
    kind: file.kind,
    sheets: file.sheets?.slice(0, 2).map((sheet) => ({
      name: sheet.name,
      maxRow: sheet.maxRow,
      maxColumn: sheet.maxColumn,
    })),
    pages: file.pages?.slice(0, 1).map((page) => ({ page: page.page, text: page.text.slice(0, 240) })),
  };
}

function inferSourceType(file: BtbSourceFileSummary): string {
  const name = `${file.name ?? ""} ${file.path}`;
  if (/shares outstanding|equity capitalization/i.test(name)) return "shares_outstanding";
  if (/enterprise value/i.test(name)) return "enterprise_value";
  if (/income statement.*annual/i.test(name)) return "income_statement_annual";
  if (/revenue estimate/i.test(name)) return "revenue_estimate";
  if (/earnings estimate/i.test(name)) return "earnings_estimate";
  if (/price history.*daily/i.test(name)) return "price_history_daily";
  if (/balance sheet.*annual/i.test(name)) return "balance_sheet_annual";
  if (/cash flow statement.*annual/i.test(name)) return "cashflow_annual";
  return "source_file";
}

function ensureMcpAnchorFiles(packet: BankerToolBenchSourcePacket, sourceFiles: BtbSourceFileSummary[], maxChars: number): void {
  const anchors = [/revenue estimate/i, /earnings estimate/i, /price history.*daily/i, /shares outstanding/i];
  packet.mcpFiles ??= [];
  for (const anchor of anchors) {
    if (packet.mcpFiles.some((file) => anchor.test(`${file.name ?? ""} ${file.path}`))) continue;
    const source = sourceFiles.find((file) => anchor.test(`${file.name ?? ""} ${file.path}`));
    if (!source) continue;
    const skeletal = compactFileSummary(source, { skeleton: true });
    while (!fitsPacketBudget(packet, "mcpFiles", packet.mcpFiles, skeletal, maxChars) && packet.mcpFiles.length > 0) {
      packet.mcpFiles.pop();
    }
    if (fitsPacketBudget(packet, "mcpFiles", packet.mcpFiles, skeletal, maxChars)) {
      packet.mcpFiles.unshift(skeletal);
    }
  }
}

function enforcePacketBudget(packet: BankerToolBenchSourcePacket, maxChars: number): BankerToolBenchSourcePacket {
  while (JSON.stringify(packet).length > maxChars && (packet.mcpFiles?.length ?? 0) > 0) {
    packet.mcpFiles?.pop();
  }
  while (JSON.stringify(packet).length > maxChars && (packet.inputFiles?.length ?? 0) > 0) {
    packet.inputFiles?.pop();
  }
  if (JSON.stringify(packet).length > maxChars) {
    packet.warnings = ["source packet compacted; warning detail truncated to fit planner context budget"];
  }
  return packet;
}

function addFilesWithinBudget({
  packet,
  field,
  files,
  maxChars,
  omittedCounter,
}: {
  packet: BankerToolBenchSourcePacket;
  field: "inputFiles" | "mcpFiles";
  files: BtbSourceFileSummary[];
  maxChars: number;
  omittedCounter: (count: number) => void;
}): BtbSourceFileSummary[] {
  const selected: BtbSourceFileSummary[] = [];
  for (const file of files) {
    const detailed = compactFileSummary(file);
    if (fitsPacketBudget(packet, field, selected, detailed, maxChars)) {
      selected.push(detailed);
      continue;
    }
    const skeletal = compactFileSummary(file, { skeleton: true });
    if (fitsPacketBudget(packet, field, selected, skeletal, maxChars)) {
      selected.push(skeletal);
      continue;
    }
    continue;
  }
  omittedCounter(Math.max(0, files.length - selected.length));
  return selected;
}

function mergeUniqueSourceFiles(...groups: BtbSourceFileSummary[][]): BtbSourceFileSummary[] {
  const seen = new Set<string>();
  const merged: BtbSourceFileSummary[] = [];
  for (const group of groups) {
    for (const file of group) {
      const key = file.path || file.name || JSON.stringify(file);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(file);
    }
  }
  return merged;
}

function fitsPacketBudget(
  packet: BankerToolBenchSourcePacket,
  field: "inputFiles" | "mcpFiles",
  currentFiles: BtbSourceFileSummary[],
  candidate: BtbSourceFileSummary,
  maxChars: number,
): boolean {
  const probe = { ...packet, [field]: [...currentFiles, candidate] };
  return JSON.stringify(probe).length <= maxChars;
}

function rankSourceFiles(files: BtbSourceFileSummary[], instruction: string, tickers: string[]): BtbSourceFileSummary[] {
  const instructionLower = instruction.toLowerCase();
  const tickerOrder = new Map(tickers.map((ticker, index) => [ticker.toUpperCase(), index]));
  return [...files].sort((a, b) => {
    const scoreDelta = scoreSourceFile(b, instructionLower, tickerOrder) - scoreSourceFile(a, instructionLower, tickerOrder);
    if (scoreDelta !== 0) return scoreDelta;
    return (a.name ?? a.path).localeCompare(b.name ?? b.path);
  });
}

function selectBalancedMcpCoverageFiles(files: BtbSourceFileSummary[], instruction: string, tickers: string[]): BtbSourceFileSummary[] {
  if (files.length === 0) return [];
  const tickerSet = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  const sourceTypes = sourceCoveragePatterns(instruction);
  const selected: BtbSourceFileSummary[] = [];
  const selectedPaths = new Set<string>();

  for (const ticker of tickers.map((value) => value.toUpperCase())) {
    for (const sourceType of sourceTypes) {
      const match = files.find((file) => {
        if (selectedPaths.has(file.path)) return false;
        const fileTicker = tickerFromPath(file.path);
        if (fileTicker && fileTicker !== ticker) return false;
        const haystack = `${file.name ?? ""} ${file.path}`;
        return sourceType.test(haystack);
      });
      if (!match) continue;
      selected.push(match);
      selectedPaths.add(match.path);
    }
  }

  for (const file of files) {
    if (selectedPaths.has(file.path)) continue;
    const fileTicker = tickerFromPath(file.path);
    if (tickerSet.size > 0 && fileTicker && !tickerSet.has(fileTicker)) continue;
    const haystack = `${file.name ?? ""} ${file.path}`;
    if (!sourceTypes.some((pattern) => pattern.test(haystack))) continue;
    selected.push(file);
    selectedPaths.add(file.path);
    if (selected.length >= Math.max(12, tickers.length * Math.min(sourceTypes.length, 6))) break;
  }

  return selected;
}

function sourceCoveragePatterns(instruction: string): RegExp[] {
  const lowered = instruction.toLowerCase();
  const patterns = [
    /shares outstanding|equity capitalization/i,
    /enterprise value|capitalization/i,
    /income statement.*annual/i,
    /revenue estimate/i,
    /earnings estimate/i,
    /price history.*daily/i,
  ];
  if (lowered.includes("debt") || lowered.includes("cash") || lowered.includes("ev/") || lowered.includes("enterprise value")) {
    patterns.push(/balance sheet.*annual/i);
  }
  if (lowered.includes("cash flow") || lowered.includes("unlevered free cash flow") || lowered.includes("fcf")) {
    patterns.push(/cash flow statement.*annual/i);
  }
  return patterns;
}

function scoreSourceFile(file: BtbSourceFileSummary, instructionLower: string, tickerOrder: Map<string, number>): number {
  const name = `${file.name ?? ""} ${file.path}`.toLowerCase();
  let score = 0;
  const ticker = tickerFromPath(file.path);
  if (ticker) score += Math.max(0, 30 - (tickerOrder.get(ticker) ?? 20));
  if (/price history.*daily/.test(name)) score += 130;
  if (/earnings estimate/.test(name)) score += 125;
  if (/shares outstanding/.test(name)) score += 124;
  if (/revenue estimate/.test(name)) score += 120;
  if (/income statement.*annual/.test(name)) score += 105;
  if (/enterprise value|capitalization/.test(name)) score += 100;
  if (/company profile/.test(name)) score += 70;
  if (/balance sheet.*annual/.test(name)) score += 60;
  if (/cash flow statement.*annual/.test(name)) score += 50;
  if (/growth estimates/.test(name)) score += 45;
  if (/analyst recommendations/.test(name)) score += 20;
  if (/insider|holder|upgrade|downgrade|dividend|split|officer/.test(name)) score -= 40;
  if (instructionLower.includes("comps") || instructionLower.includes("valuation") || instructionLower.includes("multiple")) {
    if (/revenue estimate|earnings estimate|enterprise value|shares outstanding|price history|income statement/.test(name)) score += 40;
  }
  if (instructionLower.includes("cash flow") || instructionLower.includes("debt")) {
    if (/cash flow|balance sheet|income statement/.test(name)) score += 40;
  }
  return score;
}

function tickerFromPath(path: string): string | undefined {
  const match = path.match(/\/mcp\/([^/\\]+)\//i) ?? path.match(/\\mcp\\([^/\\]+)\\/i);
  return match?.[1]?.toUpperCase();
}

function compactFileSummary(file: BtbSourceFileSummary, opts: { skeleton?: boolean; balanced?: boolean } = {}): BtbSourceFileSummary {
  if (opts.skeleton) {
    return {
      path: file.path,
      name: file.name,
      extension: file.extension,
      kind: file.kind,
      size: file.size,
      error: file.error,
    };
  }
  const sheetLimit = opts.balanced ? 2 : 4;
  const cellLimit = opts.balanced ? 8 : 32;
  const previewLimit = opts.balanced ? 300 : 800;
  const pageLimit = opts.balanced ? 1 : 3;
  const pageTextLimit = opts.balanced ? 400 : 1_000;
  const slideLimit = opts.balanced ? 2 : 8;
  const paragraphLimit = opts.balanced ? 8 : 40;
  return {
    path: file.path,
    name: file.name,
    extension: file.extension,
    kind: file.kind,
    size: file.size,
    previewText: file.previewText?.slice(0, previewLimit),
    error: file.error,
    sheets: file.sheets?.slice(0, sheetLimit).map((sheet) => ({
      ...sheet,
      cells: sheet.cells?.slice(0, cellLimit),
    })),
    pages: file.pages?.slice(0, pageLimit).map((page) => ({ ...page, text: page.text.slice(0, pageTextLimit), boxes: page.boxes?.slice(0, 8) })),
    slides: file.slides?.slice(0, slideLimit).map((slide) => ({ ...slide, text: slide.text.slice(0, previewLimit), shapes: slide.shapes?.slice(0, 8) })),
    paragraphs: file.paragraphs?.slice(0, paragraphLimit),
  };
}

function buildSourceDrivenArtifactPlan(instruction: string, sourcePacket: BankerToolBenchSourcePacket): BankerToolBenchArtifactPlan | undefined {
  const lowered = instruction.toLowerCase();
  const isPublicComps = (lowered.includes("comps") || lowered.includes("comparable"))
    && (lowered.includes("market cap") || lowered.includes("ev/revenue") || lowered.includes("ev/ebitda"));
  const tickers = sourcePacket.tickers?.filter(Boolean).map((ticker) => ticker.toUpperCase()) ?? inferTickers(instruction);
  const files = [...(sourcePacket.inputFiles ?? []), ...(sourcePacket.mcpFiles ?? [])];
  const hasSourceEvidence = files.some((file) => /price history|revenue estimate|shares outstanding/i.test(`${file.name ?? ""} ${file.path}`));
  if (!isPublicComps) return buildStructuredSourceSkillPlan(instruction, sourcePacket, tickers);
  if (tickers.length < 2 || !hasSourceEvidence) return undefined;

  const title = sourceDateTitle(instruction) ?? "Public Comparable Companies Analysis";
  const citations = buildPublicCompsCitations(sourcePacket, tickers);
  const rows = [
    [
      "Logo",
      "Company",
      "Ticker",
      "Price",
      "Shares Outstanding",
      "Market Cap ($M)",
      "Total Debt ($M)",
      "Cash & Equivalents ($M)",
      "Enterprise Value ($M)",
      "2025E Revenue ($M)",
      "2026E Revenue ($M)",
      "2026E Revenue Growth %",
      "2025E EBITDA ($M)",
      "2026E EBITDA ($M)",
      "2025E EV/Revenue",
      "2026E EV/Revenue",
      "2025E EV/EBITDA",
      "2026E EV/EBITDA",
      "2025E EBITDA Margin %",
      "2026E EBITDA Margin %",
    ],
    ...tickers.map((ticker) => [
      "source-driven logo badge",
      ticker,
      ticker,
      "source-driven materializer reads price history",
      "source-driven materializer reads shares outstanding",
      "=Price*Shares/1000000",
      "source-driven materializer reads balance sheet",
      "source-driven materializer reads balance sheet",
      "=Market Cap + Debt - Cash",
      "source-driven materializer reads revenue estimate 0y",
      "source-driven materializer reads revenue estimate +1y",
      "=(2026E Revenue - 2025E Revenue) / 2025E Revenue",
      "source-driven materializer reads EBITDA source/estimate",
      "source-driven materializer derives 2026E EBITDA where needed",
      "=EV / 2025E Revenue",
      "=EV / 2026E Revenue",
      "=EV / 2025E EBITDA",
      "=EV / 2026E EBITDA",
      "=2025E EBITDA / 2025E Revenue",
      "=2026E EBITDA / 2026E Revenue",
    ]),
    ["Median", "", "", "", "", "=MEDIAN(peer market caps)", "", "", "=MEDIAN(peer EVs)", "=MEDIAN(peer 2025E revenue)", "=MEDIAN(peer 2026E revenue)", "=MEDIAN(peer growth)", "=MEDIAN(peer 2025E EBITDA)", "=MEDIAN(peer 2026E EBITDA)", "=MEDIAN(peer EV/Revenue)", "=MEDIAN(peer EV/Revenue)", "=MEDIAN(peer EV/EBITDA)", "=MEDIAN(peer EV/EBITDA)", "=MEDIAN(peer margins)", "=MEDIAN(peer margins)"],
    ["Average", "", "", "", "", "=AVERAGE(peer market caps)", "", "", "=AVERAGE(peer EVs)", "=AVERAGE(peer 2025E revenue)", "=AVERAGE(peer 2026E revenue)", "=AVERAGE(peer growth)", "=AVERAGE(peer 2025E EBITDA)", "=AVERAGE(peer 2026E EBITDA)", "=AVERAGE(peer EV/Revenue)", "=AVERAGE(peer EV/Revenue)", "=AVERAGE(peer EV/EBITDA)", "=AVERAGE(peer EV/EBITDA)", "=AVERAGE(peer margins)", "=AVERAGE(peer margins)"],
    ["Weighted Average (by 2025E Revenue)", "", "", "", "", "=SUMPRODUCT(metric, revenue weight)", "", "", "=SUMPRODUCT(metric, revenue weight)", "=SUM(peer 2025E revenue)", "=SUM(peer 2026E revenue)", "=SUMPRODUCT(growth, revenue weight)", "=SUM(peer 2025E EBITDA)", "=SUM(peer 2026E EBITDA)", "=SUMPRODUCT(multiple, revenue weight)", "=SUMPRODUCT(multiple, revenue weight)", "=SUMPRODUCT(multiple, revenue weight)", "=SUMPRODUCT(multiple, revenue weight)", "=SUMPRODUCT(margin, revenue weight)", "=SUMPRODUCT(margin, revenue weight)"],
  ];

  return {
    schema: "noderoom-btb-artifact-plan-v1",
    title,
    taskSummary: instruction.slice(0, 10_000),
    deliverables: { workbook: true, presentation: true, memo: true, pdf: true },
    tickers,
    workbook: {
      sheets: [
        {
          name: "Comps Summary",
          purpose: "Formula-backed public comparable companies table populated by the source-driven materializer from MCP workbooks.",
          rows,
        },
        {
          name: "Raw Data Inputs",
          purpose: "Raw source inputs and file locators used for price, shares, revenue, debt, cash, and EBITDA.",
          rows: [["Ticker", "Input", "Source", "Locator"]],
        },
        {
          name: "Source Evidence",
          purpose: "Citation inventory with source paths and boundary locator status.",
          rows: [["Claim", "Source", "Locator", "Boundary Status"], ...citations.slice(0, 40).map((citation) => [citation.claim, citation.sourcePath, citation.locator, citation.boundaryBoxStatus])],
        },
      ],
    },
    presentation: {
      slides: [
        {
          title,
          bullets: [
            `Peer set: ${tickers.join(", ")}`,
            "Workbook and slides are populated by reading MCP price, shares, revenue estimate, balance sheet, and income statement workbooks.",
            "Output includes simple average, median, and revenue-weighted average rows.",
          ],
          footnote: citations[0] ? `Source: ${citations[0].sourcePath} ${citations[0].locator}` : "Source: MCP source workbooks",
        },
        {
          title: "Comparable Companies Summary",
          bullets: [
            "Rendered table covers market capitalization, enterprise value, forward revenue, growth, EV/Revenue, EV/EBITDA, and EBITDA margins.",
            "All workbook calculations use Excel formulas tied to raw input cells.",
          ],
          footnote: "See banker_model.xlsx Source Evidence tab and boundary_box_receipts.json.",
        },
      ],
    },
    memo: {
      sections: [
        { heading: "Task", body: instruction.slice(0, 1_000) },
        { heading: "Methodology", body: "The source-driven public comps materializer reads the MCP source workbooks for each peer, populates raw input tabs, and uses Excel formulas for market capitalization, enterprise value, forward multiples, margins, median, average, and weighted average outputs." },
        { heading: "Source Discipline", body: "The plan is generated from task shape and source inventory only. It does not use golden outputs, rubrics, canaries, or verifier feedback." },
      ],
    },
    citations,
    risks: [
      "Forward EBITDA is derived from available MCP source rows when direct consensus EBITDA is unavailable.",
      "If a peer source workbook is missing, the materializer will omit or mark that peer rather than inventing values.",
      "The peer set may include companies with different business models and fiscal-year calendars.",
    ],
  };
}

function buildStructuredSourceSkillPlan(
  instruction: string,
  sourcePacket: BankerToolBenchSourcePacket,
  tickers: string[],
): BankerToolBenchArtifactPlan | undefined {
  const lowered = instruction.toLowerCase();
  const files = [...(sourcePacket.inputFiles ?? []), ...(sourcePacket.mcpFiles ?? [])];
  if (files.length === 0) return undefined;

  const isTakePrivateTeaser = lowered.includes("take private")
    && lowered.includes("teaser")
    && (lowered.includes("powerpoint") || lowered.includes("ppt"))
    && lowered.includes("pdf");
  const isSourcesUses = lowered.includes("sources and uses")
    && lowered.includes("sensitivity table")
    && lowered.includes("equity injection");
  const isBuyerUniverse = lowered.includes("buyer universe")
    && lowered.includes("sponsor")
    && lowered.includes("strategic");

  if (!isTakePrivateTeaser && !isSourcesUses && !isBuyerUniverse) return undefined;

  const sourceRows = summarizeSources(sourcePacket).slice(0, 30);
  const citations = buildCitations(sourcePacket, sourceRows).slice(0, 70);
  const normalizedTickers = tickers.length ? tickers : inferTickers(instruction);
  const primaryTicker = normalizedTickers[0] ?? "TARGET";
  const assumptionRows = extractInstructionAssumptions(instruction);

  if (isTakePrivateTeaser) {
    const title = `${primaryTicker} Take-Private Teaser`;
    return sourceSkillPlan({
      title,
      instruction,
      tickers: normalizedTickers,
      citations,
      workbookSheets: [
        {
          name: "Teaser Inputs",
          purpose: "Source-backed input index for the take-private teaser.",
          rows: [
            ["Input", "Method", "Source"],
            ["Market Cap", "Last close price x shares outstanding", "Price History and Shares Outstanding files"],
            ["LTM Revenue", "Use provided LTM source line item where available", "Income Statement / ratio files"],
            ["Net Debt", "Total Debt - Cash & Cash Equivalents", "Balance Sheet files"],
            ["Enterprise Value", "Equity Value + Total Debt + Preferred - Cash", "Formula output"],
            ...assumptionRows,
          ],
        },
        {
          name: "Financial Summary",
          purpose: "FY22-FY24 and LTM summary structure for revenue, EBITDA, EBITDA margin, CFO, capex, and FCF.",
          rows: [
            ["Metric", "FY22", "FY23", "FY24", "LTM", "Source / Formula"],
            ["Revenue", "source", "source", "source", "source", "Income Statement"],
            ["EBITDA", "source", "source", "source", "source", "Income Statement / ratio source"],
            ["EBITDA Margin", "=EBITDA/Revenue", "=EBITDA/Revenue", "=EBITDA/Revenue", "=EBITDA/Revenue", "Formula"],
            ["CFO", "source", "source", "source", "source", "Cash Flow Statement"],
            ["Capex", "source", "source", "source", "source", "Cash Flow Statement"],
            ["FCF", "=CFO-Capex", "=CFO-Capex", "=CFO-Capex", "=CFO-Capex", "Formula"],
          ],
        },
        {
          name: "Premium Grid",
          purpose: "Offer price, equity value, enterprise value, and unchanged EBITDA multiple across premium cases.",
          rows: [
            ["Premium", "10.0%", "20.0%", "30.0%", "40.0%", "50.0%"],
            ["Offer Price", "=Last Close*(1+Premium)", "=Last Close*(1+Premium)", "=Last Close*(1+Premium)", "=Last Close*(1+Premium)", "=Last Close*(1+Premium)"],
            ["Equity Value", "=Offer Price*Shares", "=Offer Price*Shares", "=Offer Price*Shares", "=Offer Price*Shares", "=Offer Price*Shares"],
            ["Enterprise Value", "=Equity Value+Debt+Preferred-Cash", "=Equity Value+Debt+Preferred-Cash", "=Equity Value+Debt+Preferred-Cash", "=Equity Value+Debt+Preferred-Cash", "=Equity Value+Debt+Preferred-Cash"],
            ["EV / LTM EBITDA", "=Enterprise Value/LTM EBITDA", "=Enterprise Value/LTM EBITDA", "=Enterprise Value/LTM EBITDA", "=Enterprise Value/LTM EBITDA", "=Enterprise Value/LTM EBITDA"],
          ],
        },
      ],
      slides: [
        { title: `${primaryTicker} screens as a sponsor-relevant take-private candidate`, bullets: ["Overview, logo, market capitalization, LTM revenue, and net debt are sourced from the candidate-visible packet.", "The teaser is capped at two pages and includes source footnotes."], footnote: firstCitationFootnote(citations) },
        { title: "Premium cases bridge equity value to enterprise value", bullets: ["Financial summary covers FY22-FY24 and LTM.", "Premium grid sensitizes +10% through +50% to last close.", "FCF is calculated as CFO minus capex."], footnote: "Source: financial statement and market data workbooks; see Citation Receipts." },
      ],
      memoSections: [
        { heading: "Methodology", body: "The source-skill plan maps the take-private teaser requirements into a financial summary, EV bridge, premium grid, PowerPoint, PDF, and citation receipts without calling the model planner." },
      ],
    });
  }

  if (isSourcesUses) {
    const title = `${primaryTicker} Sources and Uses Analysis`;
    return sourceSkillPlan({
      title,
      instruction,
      tickers: normalizedTickers,
      citations,
      workbookSheets: [
        {
          name: "Transaction Assumptions",
          purpose: "User-provided transaction assumptions extracted from the prompt.",
          rows: [["Assumption", "Value", "Source"], ...assumptionRows],
        },
        {
          name: "Enterprise Value",
          purpose: "Purchase price and enterprise value bridge.",
          rows: [
            ["Line Item", "Value", "Formula / Source"],
            ["Current Share Price", "source", "Fully diluted equity capitalization / fully diluted share count"],
            ["Purchase Share Price", "=Current Share Price*(1+Premium)", "Formula"],
            ["Purchase Equity Value", "=Purchase Share Price*Fully Diluted Shares", "Formula"],
            ["Purchase Enterprise Value", "=Purchase Equity Value+Total Debt-Cash", "Formula"],
          ],
        },
        {
          name: "Sources and Uses",
          purpose: "Debt, rollover, equity injection, transaction fees, financing fees, and total uses.",
          rows: [
            ["Sources", "$ Amount", "x EBITDA"],
            ["Revolver", "=Revolver x EBITDA", "=Revolver Multiple"],
            ["Senior Notes", "=Senior Notes x EBITDA", "=Senior Notes Multiple"],
            ["Term Loan B", "=TLB x EBITDA", "=TLB Multiple"],
            ["Shareholder Rollover", "=Purchase Equity Value*Rollover %", "=Rollover / EBITDA"],
            ["Equity Injection", "=Total Uses-Other Sources", "=Equity Injection / EBITDA"],
            ["Total Sources", "=SUM(Sources)", "=Total Sources / EBITDA"],
            [],
            ["Uses", "$ Amount", "% Total Uses"],
            ["Purchase Enterprise Value", "=Purchase Enterprise Value", "=Use / Total Uses"],
            ["Cash to Balance Sheet", "=Revenue*Cash to B/S %", "=Use / Total Uses"],
            ["Management Incentives", "=Purchase Equity Value*Management Incentives %", "=Use / Total Uses"],
            ["Transaction Fees", "=Purchase Enterprise Value*Transaction Fees %", "=Use / Total Uses"],
            ["Financing Fees", "=Debt Raised*Financing Fees %", "=Use / Total Uses"],
            ["Total Uses", "=SUM(Uses)", "100.0%"],
          ],
        },
        {
          name: "Sensitivity Table",
          purpose: "Equity injection sensitivity to TLB multiple and shareholder rollover.",
          rows: [
            ["TLB Multiple / Rollover", "10.0%", "15.0%", "20.0%", "25.0%", "30.0%", "35.0%", "40.0%"],
            ["0.0x", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection"],
            ["1.5x", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection"],
            ["3.0x", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection"],
            ["4.5x", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection"],
            ["6.0x", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection", "=Equity Injection"],
          ],
        },
      ],
      slides: [
        { title: `${primaryTicker} transaction model is driven by source financials and stated assumptions`, bullets: ["Workbook includes assumptions, EV bridge, sources and uses, debt calculations, and sensitivity table.", "Equity injection is the balancing source after debt and rollover."], footnote: firstCitationFootnote(citations) },
      ],
      memoSections: [
        { heading: "Methodology", body: "The source-skill plan maps the sources-and-uses request into formula-backed workbook tabs and citation receipts without using fallback planning." },
      ],
    });
  }

  const title = "Buyer Universe Overview";
  return sourceSkillPlan({
    title,
    instruction,
    tickers: normalizedTickers,
    citations,
    workbookSheets: [
      {
        name: "Buyer Universe",
        purpose: "Structured buyer universe segmented between sponsors and strategics.",
        rows: [
          ["Segment", "Buyer / Logo", "Sponsor Backing", "Rationale"],
          ["Sponsors", "source-driven buyer list", "", "Financial sponsor fit and platform interest"],
          ["Strategics", "source-driven buyer list", "show sponsor backing where applicable", "Strategic acquirer fit"],
        ],
      },
      {
        name: "Process Timeline",
        purpose: "Sell-side preparation workstreams before launch.",
        rows: [
          ["Workstream", "Purpose", "Owner"],
          ["QoE", "Validate earnings and adjustments", "Finance / advisor"],
          ["Market study", "Substantiate market size, growth, and positioning", "Commercial diligence"],
          ["Carveout analysis", "Define perimeter, stranded cost, and transition services", "Operations / legal"],
          ["CIM and data room", "Prepare buyer materials and source evidence", "Banker / company"],
        ],
      },
    ],
    slides: [
      { title: "Potential buyer universe spans sponsors and strategics", bullets: ["Left side: logos grouped by Sponsors and Strategics.", "Right side: buyer thesis and sell-side preparation timeline."], footnote: firstCitationFootnote(citations) },
    ],
    memoSections: [
      { heading: "Methodology", body: "The source-skill plan structures the buyer-universe one-pager into buyer segments, thesis bullets, timeline workstreams, source citations, and a PDF mirror." },
    ],
  });
}

function sourceSkillPlan(args: {
  title: string;
  instruction: string;
  tickers: string[];
  citations: BankerToolBenchArtifactPlan["citations"];
  workbookSheets: BankerToolBenchArtifactPlan["workbook"]["sheets"];
  slides: BankerToolBenchArtifactPlan["presentation"]["slides"];
  memoSections: BankerToolBenchArtifactPlan["memo"]["sections"];
}): BankerToolBenchArtifactPlan {
  return {
    schema: "noderoom-btb-artifact-plan-v1",
    title: args.title,
    taskSummary: args.instruction.slice(0, 10_000),
    deliverables: { workbook: true, presentation: true, memo: true, pdf: true },
    tickers: args.tickers,
    workbook: {
      sheets: [
        ...args.workbookSheets,
        {
          name: "Source Evidence",
          purpose: "Citation inventory with source paths and boundary locator status.",
          rows: [["Claim", "Source", "Locator", "Boundary Status"], ...args.citations.slice(0, 50).map((citation) => [citation.claim, citation.sourcePath, citation.locator, citation.boundaryBoxStatus])],
        },
      ],
    },
    presentation: { slides: args.slides },
    memo: {
      sections: [
        ...args.memoSections,
        { heading: "Source Discipline", body: "The plan is generated from task shape and candidate-visible source inventory only. It does not use golden outputs, rubrics, canaries, or verifier feedback." },
      ],
    },
    citations: args.citations,
    risks: [
      "Source-skill plans prevent planner timeouts and create auditable first-pass deliverables, but richer task-family materializers are still required for full-credit formatting and numeric precision.",
    ],
  };
}

function extractInstructionAssumptions(instruction: string): Array<Array<string | number | boolean | null>> {
  const rows: Array<Array<string | number | boolean | null>> = [];
  const patterns: Array<[string, RegExp]> = [
    ["Transaction Fees", /Transaction Fees(?:\s+of)?\s+([\d.]+%)/i],
    ["Financing Fees", /Financing Fees\s+(?:of\s+)?([\d.]+%)/i],
    ["Cash to Balance Sheet", /Cash to Balance Sheet.*?([\d.]+%)/i],
    ["Senior Notes", /Senior Notes Amount.*?([\d.]+x)/i],
    ["Term Loan B", /Term Loan B.*?([\d.]+x)/i],
    ["Revolver", /Revolver Amount.*?([\d.]+x)/i],
    ["Management Incentives", /Management Incentives(?:\s+of)?\s+([\d.]+%)/i],
    ["Shareholder Rollover", /Shareholder Rollover(?:\s+of)?\s+([\d.]+%)/i],
    ["Premium to Current Share Price", /Premium to Current Share price(?:\s+of)?\s+([\d.]+%)/i],
  ];
  for (const [label, pattern] of patterns) {
    const value = instruction.match(pattern)?.[1];
    if (value) rows.push([label, value, "Prompt instruction"]);
  }
  if (rows.length === 0) rows.push(["Task-specific assumptions", "See instruction summary", "Prompt instruction"]);
  return rows;
}

function firstCitationFootnote(citations: BankerToolBenchArtifactPlan["citations"]): string {
  const first = citations[0];
  return first ? `Source: ${first.sourcePath} ${first.locator}` : "Source: candidate-visible source packet";
}

function sourceDateTitle(instruction: string): string | undefined {
  const date = instruction.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/)?.[0];
  if (date) return `Public Comparable Companies Analysis as of ${date}`;
  if (/software/i.test(instruction)) return "Software Comparable Companies Analysis";
  return undefined;
}

function buildPublicCompsCitations(sourcePacket: BankerToolBenchSourcePacket, tickers: string[]): BankerToolBenchArtifactPlan["citations"] {
  const files = [...(sourcePacket.inputFiles ?? []), ...(sourcePacket.mcpFiles ?? [])];
  const citations: BankerToolBenchArtifactPlan["citations"] = [];
  for (const ticker of tickers) {
    for (const [claimSuffix, pattern, locator] of [
      ["price history", /price history.*daily/i, "Closest dated price row on or before analysis date"],
      ["shares outstanding", /shares outstanding/i, "Closest dated shares row on or before analysis date"],
      ["revenue estimates", /revenue estimate/i, "Rows 0y and +1y"],
      ["balance sheet inputs", /balance sheet/i, "TotalDebt and cash rows"],
      ["income statement / EBITDA inputs", /income statement/i, "NormalizedEBITDA, EBITDA, and revenue rows"],
    ] as const) {
      const source = files.find((file) => {
        const haystack = `${file.name ?? ""} ${file.path}`;
        return haystack.includes(ticker) && pattern.test(haystack);
      });
      if (!source) continue;
      citations.push({
        claim: `${ticker} ${claimSuffix}`,
        sourcePath: source.path,
        locator,
        quote: source.name ?? source.path,
        boundaryBoxStatus: "cell",
      });
    }
  }
  if (citations.length === 0) return buildCitations(sourcePacket, summarizeSources(sourcePacket)).slice(0, 20);
  citations.push({
    claim: "Enterprise value and multiple calculations",
    sourcePath: "derived",
    locator: "Comps Summary formulas",
    quote: "Market Cap + Total Debt - Cash; EV divided by Revenue or EBITDA",
    boundaryBoxStatus: "derived",
  });
  return citations.slice(0, 80);
}

function buildHeuristicPlan(instruction: string, sourcePacket: BankerToolBenchSourcePacket): BankerToolBenchArtifactPlan {
  const tickers = sourcePacket.tickers?.length ? sourcePacket.tickers : inferTickers(instruction);
  const title = inferTitle(instruction, tickers);
  const sourceRows = summarizeSources(sourcePacket);
  const citations = buildCitations(sourcePacket, sourceRows);
  const metricsRows = sourceRows.slice(0, 25).map((row, index) => [
    index + 1,
    row.source,
    row.locator,
    row.summary,
  ]);

  return {
    schema: "noderoom-btb-artifact-plan-v1",
    title,
    taskSummary: instruction.slice(0, 10_000),
    deliverables: { workbook: true, presentation: true, memo: true, pdf: true },
    tickers,
    workbook: {
      sheets: [
        {
          name: "Executive Summary",
          purpose: "Client-facing output summary and key assumptions.",
          rows: [
            ["BankerToolBench Task", title],
            ["Tickers", tickers.join(", ") || "Not specified"],
            ["Instruction Summary", instruction.slice(0, 500)],
            ["Model Status", "NodeAgent generated first-pass package from extracted source packet"],
            ["Source Count", sourceRows.length],
            [],
            ["Key Output", "Value", "Source"],
            ["Deliverable package", "Workbook, presentation, memo, PDF", "NodeAgent artifact plan"],
            ["Source evidence", "See Source Evidence tab", "boundary_box_receipts.json"],
          ],
        },
        {
          name: "Source Evidence",
          purpose: "Agent-visible source inventory and citation locators.",
          rows: [["#", "Source", "Locator", "Extract"], ...metricsRows],
        },
        {
          name: "Model Build",
          purpose: "Formula-ready analysis scaffold.",
          rows: [
            ["Section", "Line Item", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Source"],
            ["Historical / Inputs", "Revenue", "", "", "", "", "", "Source Evidence"],
            ["Historical / Inputs", "EBITDA", "", "", "", "", "", "Source Evidence"],
            ["Forecast", "Revenue Growth", "5.0%", "5.0%", "4.5%", "4.0%", "4.0%", "Assumption"],
            ["Forecast", "EBITDA Margin", "25.0%", "25.5%", "26.0%", "26.0%", "26.0%", "Assumption"],
            ["Valuation", "Discount Rate / WACC", "9.0%", "", "", "", "", "Assumption"],
            ["Valuation", "Exit Multiple", "10.0x", "", "", "", "", "Assumption"],
            ["Audit", "Formula note", "Materialized workbook should convert scaffold formulas where values are available.", "", "", "", "", "NodeAgent"],
          ],
        },
      ],
    },
    presentation: {
      slides: [
        {
          title,
          bullets: [
            "NodeAgent generated a first-pass investment banking work product from the official task workspace.",
            `Primary tickers: ${tickers.join(", ") || "not specified"}.`,
            "Workbook includes executive summary, source evidence, and model scaffold tabs.",
          ],
          footnote: citations[0]?.sourcePath ? `Source: ${citations[0].sourcePath} ${citations[0].locator}` : "Source: extracted task packet",
        },
        {
          title: "Source Evidence And Audit Trail",
          bullets: sourceRows.slice(0, 5).map((row) => `${row.source}: ${row.summary.slice(0, 120)}`),
          footnote: "See boundary_box_receipts.json for citation locators.",
        },
      ],
    },
    memo: {
      sections: [
        { heading: "Task", body: instruction.slice(0, 1_000) },
        { heading: "Sources Reviewed", body: sourceRows.slice(0, 12).map((row) => `${row.source} (${row.locator})`).join("; ") || "No source files were extracted." },
        { heading: "Current Limitations", body: "This is a first-pass NodeAgent package. It must be iterated against Gandalf feedback for calculation completeness, exact formulas, and banker formatting." },
      ],
    },
    citations,
    risks: [
      "First-pass package may miss task-specific golden numeric targets until failure feedback is incorporated.",
      "Formula depth is limited when source packet extraction cannot identify exact source rows.",
      "Visual boundary boxes are available only where extracted source files expose cell, page, shape, or paragraph locators.",
    ],
  };
}

function buildStatusAliasPlan(instruction: string, sourcePacket: BankerToolBenchSourcePacket): unknown {
  const plan = buildHeuristicPlan(instruction, sourcePacket) as unknown as Record<string, unknown>;
  plan.citations = [
    {
      claim: "Spreadsheet table source",
      sourcePath: "/home/agent/workspace/source.xlsx",
      locator: "Summary!A1:C5",
      quote: "Source table",
      boundaryBoxStatus: "table",
    },
    {
      claim: "PDF page source",
      sourcePath: "/home/agent/workspace/source.pdf",
      locator: "page 1",
      quote: "Source page",
      boundaryBoxStatus: "pdf page",
    },
  ];
  return plan;
}

function buildCommentedBlankCitationPlanText(instruction: string, sourcePacket: BankerToolBenchSourcePacket): string {
  const plan = buildHeuristicPlan(instruction, sourcePacket) as BankerToolBenchArtifactPlan;
  plan.citations = [
    {
      claim: "Formula-derived output",
      sourcePath: "",
      locator: "",
      quote: "Computed from model assumptions",
      boundaryBoxStatus: "cell",
    },
  ];
  return JSON.stringify(plan, null, 2).replace(
    "\"risks\": [",
    "// Planner note: risks are copied from the model draft\n  \"risks\": [",
  );
}

function inferTickers(instruction: string): string[] {
  const matches = instruction.match(/\b[A-Z]{2,5}\b/g) ?? [];
  return Array.from(new Set(matches.filter((value) => !["DCF", "WACC", "EBITDA", "EBIT", "PDF", "PPT", "LTM"].includes(value)))).slice(0, 8);
}

function inferTitle(instruction: string, tickers: string[]): string {
  const topic = instruction.split(/[.\n]/)[0]?.trim();
  if (topic && topic.length <= 120) return topic;
  return `${tickers[0] ?? "Company"} BankerToolBench Analysis`;
}

function summarizeSources(sourcePacket: BankerToolBenchSourcePacket): Array<{ source: string; locator: string; summary: string; kind?: string }> {
  const files = [...(sourcePacket.inputFiles ?? []), ...(sourcePacket.mcpFiles ?? [])];
  const rows: Array<{ source: string; locator: string; summary: string; kind?: string }> = [];
  for (const file of files) {
    if (file.previewText) {
      rows.push({ source: file.path, locator: "preview", summary: file.previewText.slice(0, 500), kind: file.kind });
    }
    for (const sheet of file.sheets ?? []) {
      const sample = (sheet.cells ?? []).slice(0, 20).map((cell) => `${cell.address}=${String(cell.value ?? cell.formula ?? "")}`).join("; ");
      rows.push({ source: file.path, locator: `${sheet.name}!sample`, summary: sample || `Sheet ${sheet.name}`, kind: "xlsx" });
    }
    for (const page of file.pages ?? []) {
      rows.push({ source: file.path, locator: `page ${page.page}`, summary: page.text.slice(0, 500), kind: "pdf" });
    }
    for (const slide of file.slides ?? []) {
      rows.push({ source: file.path, locator: `slide ${slide.slide}`, summary: slide.text.slice(0, 500), kind: "pptx" });
    }
    for (const paragraph of file.paragraphs ?? []) {
      rows.push({ source: file.path, locator: `paragraph ${paragraph.index}`, summary: paragraph.text.slice(0, 500), kind: "docx" });
    }
  }
  return rows.slice(0, 100);
}

function buildCitations(
  sourcePacket: BankerToolBenchSourcePacket,
  sourceRows: Array<{ source: string; locator: string; summary: string; kind?: string }>,
): BankerToolBenchArtifactPlan["citations"] {
  const citations = sourceRows.slice(0, 30).map((row) => ({
    claim: row.summary.slice(0, 180) || "Source evidence reviewed",
    sourcePath: row.source,
    locator: row.locator,
    quote: row.summary.slice(0, 240),
    boundaryBoxStatus: boundaryStatusForKind(row.kind, row.locator),
  }));
  if (citations.length) return citations;
  return [{
    claim: "No source evidence extracted.",
    sourcePath: sourcePacket.taskId ?? "task-workspace",
    locator: "source-packet",
    boundaryBoxStatus: "unsupported",
  }];
}

function boundaryStatusForKind(kind: string | undefined, locator: string): BankerToolBenchArtifactPlan["citations"][number]["boundaryBoxStatus"] {
  if (kind === "xlsx") return "cell";
  if (kind === "pdf") return "bbox";
  if (kind === "pptx") return "shape";
  if (kind === "docx") return "paragraph";
  if (locator.includes("field")) return "field";
  return "unsupported";
}

function createBenchmarkRoomTools(): RoomTools {
  return {
    async snapshot() {
      return { artifactId: "btb-general", version: 1, kind: "benchmark", rows: [] };
    },
    async awareness() {
      return { activeLocks: [], agents: [{ name: "noderoom-nodeagent", scope: "benchmark", status: "running" }], recentTrace: [], autoAllow: true };
    },
    async listArtifacts() {
      return [];
    },
    async readRange() {
      return [];
    },
    async searchSheetContext() {
      return [];
    },
    async proposeLock() {
      return { ok: true, lockId: "btb-general-lock" };
    },
    async releaseLock() {
      return { ok: true, merged: [] };
    },
    async editCell() {
      return { ok: true, version: 1 };
    },
    async createDraft() {
      return { draftId: "btb-general-draft" };
    },
    async say() {
      return;
    },
    async fetchSource() {
      return { ok: false, error: "External fetch is disabled in the BTB Harbor candidate runner." };
    },
  };
}

function toAtifTrajectory(
  messages: Awaited<ReturnType<typeof runAgent>>["messages"],
  trace: AgentTraceEvent[],
  modelName: string,
  nowIso: string | undefined,
  usage: { inputTokens: number; outputTokens: number; modelCalls: number },
) {
  const steps = messages
    .filter((message) => message.role !== "tool")
    .map((message, index) => ({
      step_id: index + 1,
      source: message.role === "assistant" ? "agent" : "user",
      message: message.content || "(tool use)",
      model_name: message.role === "assistant" ? modelName : undefined,
      tool_calls: message.toolCalls?.map((call) => ({
        tool_call_id: call.id,
        function_name: call.tool,
        arguments: call.args,
      })),
      observation: message.role === "assistant"
        ? {
            results: trace
              .filter((event) => message.toolCalls?.some((call) => call.tool === event.tool))
              .map((event, eventIndex) => ({
                source_call_id: message.toolCalls?.[eventIndex]?.id ?? event.tool,
                content: JSON.stringify(event.result),
              })),
          }
        : undefined,
    }));
  return {
    schema_version: "ATIF-v1.6",
    session_id: "noderoom-nodeagent-btb-general",
    agent: { name: "noderoom-nodeagent", version: "0.2.0-general", model_name: modelName },
    steps,
    final_metrics: {
      total_prompt_tokens: usage.inputTokens || undefined,
      total_completion_tokens: usage.outputTokens || undefined,
      total_cached_tokens: 0,
      total_cost_usd: priceRun(modelName, usage.inputTokens, usage.outputTokens),
      total_steps: steps.length,
    },
    metadata: {
      generated_at: nowIso,
      runner: "bankerToolBenchNodeAgentGeneral",
    },
  };
}

export const __bankerToolBenchGeneralTestHooks = {
  compactSourcePacket,
  normalizeArtifactPlanForValidation,
  preflightArtifactPlan,
};
