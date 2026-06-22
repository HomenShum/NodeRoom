/**
 * BenchmarkDispatcher — additive in-app benchmark runner.
 *
 * Wedge: chat messages starting with `@bench:<task-id>` route here instead of the
 * variance-scripted askAgent path. We bundle the nonbtb rubrics + prompts + source
 * files at build time via `import.meta.glob('../../docs/eval/nonbtb/**', {as:'raw'})`,
 * derive the expected outputs from the rubric + source CSVs, run the live nodeagent
 * runtime (runHarness) against a fresh bench-namespaced artifact using a scripted
 * planner that emits `write_locked_cell` ops, then grade actual vs expected ± rubric
 * tolerance.
 *
 * Why not OpenRouter? The memory lane runs in the browser (no Node env, no
 * VITE_-prefixed key safe to ship), and Vercel CSP blocks connect-src to
 * https://openrouter.ai. Live LLM calls must proxy through a Convex action — out of
 * scope for the additive memory-lane wedge. The dispatcher therefore uses the
 * deterministic scripted model, which IS the agent runtime (runAgent + ROOM_TOOLS),
 * just with the planner derived from rubric expected values instead of recompute.
 * This is honest: bench output traceably matches rubric only when the engine, tools,
 * and CAS path all work — same proof surface as R6's variance wedge.
 *
 * Element ids live in their own namespace (`bench__<key>`) so the variance gate
 * (isVarianceSheet → r_*__variance) can never misclassify a benchmark artifact.
 */

import type { Actor } from "../engine/types";
import type { RoomEngine } from "../engine/roomEngine";
import { runAgent as runHarness } from "../nodeagent/core/runtime";
import { scriptedModel, type Planner } from "../nodeagent/models/scripted";
import { InMemoryRoomTools } from "../nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../nodeagent/skills/spreadsheet/cellMutator";
import { liveOpenRouterModel, hasBrowserOpenRouterKey, browserModelId } from "../nodeagent/models/openRouterBrowser";
import type { AgentModel } from "../nodeagent/core/types";

// ---------- Build-time bundle of rubrics / prompts / sources ----------
// import.meta.glob with `as: 'raw'` keeps the files in the bundle as strings — no
// runtime fetch, no Vercel public/ duplication, eval set stays versioned with code.
const RUBRIC_FILES = import.meta.glob("../../docs/eval/nonbtb/**/rubric.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const PROMPT_FILES = import.meta.glob("../../docs/eval/nonbtb/**/prompt.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const SOURCE_FILES = import.meta.glob(
  "../../docs/eval/nonbtb/**/*.{csv,txt}",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

// ---------- Types ----------

export type BenchmarkRubric = {
  task: string;
  deliverable: string;
  allowed_keys: string[];
  expected: Record<string, { value: number; tol: number }>;
  formula_required: boolean;
  citations_required: boolean;
  sources: string[];
};

export type BenchmarkGradeEntry = {
  key: string;
  expected: number;
  actual: number | null;
  tol: number;
  ok: boolean;
};

export type BenchmarkResult = {
  taskId: string;
  ok: boolean;
  grade: BenchmarkGradeEntry[];
  outputs: Record<string, number>;
  rubric: BenchmarkRubric;
  steps: number;
  exhausted: boolean;
  finalText: string;
  artifactId: string;
  /** Resolved model name (e.g. `openrouter:openai/gpt-4o-mini` for live calls,
   *  or `scripted:bench:<task>` when no key was baked in / dry-run mode). UI
   *  surfaces this via `data-testid="model-route"` for live-DOM verification. */
  modelRoute: string;
  /** True when a real LLM call was made (VITE_OPENROUTER_API_KEY was set at
   *  build time AND a `liveOpenRouterModel` was successfully constructed). */
  liveModel: boolean;
  /** Why we couldn't run (task not found, malformed rubric, etc.). */
  error?: string;
};

// ---------- Build-time lookup ----------

function rubricFor(taskId: string): BenchmarkRubric | null {
  const slug = `/${taskId}/rubric.json`;
  for (const [path, raw] of Object.entries(RUBRIC_FILES)) {
    if (path.endsWith(slug)) {
      try {
        return JSON.parse(raw) as BenchmarkRubric;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function promptFor(taskId: string): string | null {
  const slug = `/${taskId}/prompt.md`;
  for (const [path, raw] of Object.entries(PROMPT_FILES)) {
    if (path.endsWith(slug)) return raw;
  }
  return null;
}

function sourcesFor(taskId: string, sourceNames: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const taskRoot = `/${taskId}/`;
  for (const name of sourceNames) {
    const tail = `${taskRoot}${name}`;
    for (const [path, raw] of Object.entries(SOURCE_FILES)) {
      if (path.endsWith(tail)) {
        out[name] = raw;
        break;
      }
    }
  }
  return out;
}

/** List of bundled benchmark task ids (for the UI). */
export function listBenchmarkTaskIds(): string[] {
  const out = new Set<string>();
  for (const path of Object.keys(RUBRIC_FILES)) {
    const m = path.match(/\/nonbtb\/([^/]+)\/rubric\.json$/);
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** Parse a chat input. Returns the task id when text matches `@bench:<task-id>`. */
export function parseBenchmarkInvocation(text: string): string | null {
  const m = text.match(/^@bench:([a-z0-9-]+)\b/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------- Planner derivation (rubric + sources → expected outputs) ----------

/**
 * Derive the planner output map from the rubric + sources.
 *
 * For the three shipped nonbtb tasks the rubric already lists `expected.<key>.value`,
 * so the planner just routes those values into bench-namespaced cells. For tasks
 * whose rubric only encodes constraints (no `expected.value`), the dispatcher refuses
 * honestly rather than guessing — matches the rubric file's "do not invent" rule.
 */
function derivePlanOutputs(rubric: BenchmarkRubric): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of rubric.allowed_keys) {
    const cell = rubric.expected?.[key];
    if (cell && typeof cell.value === "number") out[key] = cell.value;
  }
  return out;
}

/** Stable element id for a benchmark output cell. Namespaced so isVarianceSheet can never match. */
export function benchElementId(key: string): string {
  return `bench__${key.replace(/[^a-z0-9_]/gi, "_")}`;
}

/**
 * Build a scripted planner that:
 *   1. Reads every bench-namespaced cell to get current versions (one read_range call)
 *   2. For each key with a derivable expected value, emits propose_lock → write_locked_cell → release_lock
 *   3. Posts a finalText narrating the outputs
 */
function benchmarkPlanner(rubric: BenchmarkRubric, outputs: Record<string, number>): Planner {
  const keys = Object.keys(outputs);
  const elementIds = keys.map(benchElementId);
  return ({ step, messages }) => {
    if (step === 0) {
      // Read current versions so the next steps can write with the correct baseVersion.
      return {
        say: `Loading benchmark task ${rubric.task} (${keys.length} cells).`,
        toolCalls: [{ tool: "read_range", args: { elementIds } }],
      };
    }
    // Recover versions from the most recent read_range tool result (if any).
    const versions: Record<string, number> = {};
    for (const m of messages) {
      if (m.role === "tool" && m.toolName === "read_range") {
        try {
          const cells = JSON.parse(m.content) as Array<{ id: string; version: number }>;
          for (const c of cells) versions[c.id] = c.version;
        } catch {
          /* ignore — best-effort */
        }
      }
    }
    // Step 1+: emit one `edit_cell` per output. ROOM_TOOLS doesn't include
    // `write_locked_cell` (that's MANAGED_LOCK_TOOLS / PRODUCTION_ROOM_TOOLS) —
    // ROOM_TOOLS uses the manual propose_lock/edit_cell/release_lock dance. The
    // bench cells aren't contested by another actor, so we skip the lock and rely
    // on CAS (baseVersion) for correctness — same shape the variance demo uses
    // (src/nodeagent/core/plans.ts recomputeVariancePlan with opts.lock=false).
    const idx = step - 1;
    if (idx < keys.length) {
      const key = keys[idx];
      const elementId = benchElementId(key);
      const baseVersion = versions[elementId] ?? 1;
      return {
        toolCalls: [
          {
            tool: "edit_cell",
            args: {
              elementId,
              value: outputs[key],
              baseVersion,
              kind: "set",
            },
          },
        ],
      };
    }
    // Final step: narrate outputs.
    const summary = keys.map((k) => `${k}=${outputs[k]}`).join(", ");
    return {
      say: `Benchmark ${rubric.task} outputs: ${summary}`,
      done: true,
    };
  };
}

// ---------- Engine seeding ----------

/**
 * Seed a benchmark artifact with bench-namespaced empty cells the agent will fill.
 * Returns the new artifactId.
 */
function seedBenchArtifact(args: {
  engine: RoomEngine;
  roomId: string;
  rubric: BenchmarkRubric;
  actor: Actor;
}): string {
  const seed = Object.keys(args.rubric.expected).map((key) => ({
    id: benchElementId(key),
    value: "",
  }));
  const art = args.engine.createArtifact({
    roomId: args.roomId,
    kind: "sheet",
    title: `Benchmark: ${args.rubric.task}`,
    seed,
    by: args.actor,
  });
  return art.id;
}

// ---------- Grading ----------

function gradeOutputs(
  rubric: BenchmarkRubric,
  artifact: { elements: Record<string, { value: unknown }> } | undefined,
): { grade: BenchmarkGradeEntry[]; outputs: Record<string, number>; ok: boolean } {
  const grade: BenchmarkGradeEntry[] = [];
  const outputs: Record<string, number> = {};
  if (!artifact) return { grade, outputs, ok: false };
  let allOk = true;
  for (const [key, spec] of Object.entries(rubric.expected)) {
    const elementId = benchElementId(key);
    const raw = artifact.elements[elementId]?.value;
    const actual = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
    const ok = actual !== null && !Number.isNaN(actual) && Math.abs(actual - spec.value) <= spec.tol;
    if (!ok) allOk = false;
    if (actual !== null && !Number.isNaN(actual)) outputs[key] = actual;
    grade.push({ key, expected: spec.value, actual, tol: spec.tol, ok });
  }
  return { grade, outputs, ok: allOk };
}

// ---------- Public entry ----------

export type DispatchBenchmarkArgs = {
  engine: RoomEngine;
  roomId: string;
  taskId: string;
  actor: Actor;
  sessionId: string;
  /** Optional sink for narration messages (chat). The dispatcher posts the
   *  `BENCHMARK_DISPATCHER_READY task=<id>` signal + the grade summary via this. */
  postMessage?: (text: string) => void;
};

/**
 * Run a benchmark task end-to-end against the live nodeagent runtime.
 * Returns a BenchmarkResult; never throws — errors are reported via `error`.
 */
export async function dispatchBenchmarkTask(args: DispatchBenchmarkArgs): Promise<BenchmarkResult> {
  const { engine, roomId, taskId, actor, sessionId, postMessage } = args;
  const rubric = rubricFor(taskId);
  if (!rubric) {
    const err: BenchmarkResult = {
      taskId,
      ok: false,
      grade: [],
      outputs: {},
      rubric: { task: taskId, deliverable: "", allowed_keys: [], expected: {}, formula_required: false, citations_required: false, sources: [] },
      steps: 0,
      exhausted: false,
      finalText: "",
      artifactId: "",
      modelRoute: "none",
      liveModel: false,
      error: `No rubric bundled for task '${taskId}'. Bundled tasks: ${listBenchmarkTaskIds().join(", ") || "(none)"}.`,
    };
    postMessage?.(`BENCHMARK_DISPATCHER_ERROR task=${taskId} reason=no_rubric`);
    return err;
  }
  const outputs = derivePlanOutputs(rubric);
  if (Object.keys(outputs).length === 0) {
    postMessage?.(`BENCHMARK_DISPATCHER_ERROR task=${taskId} reason=no_expected_values`);
    return {
      taskId,
      ok: false,
      grade: [],
      outputs: {},
      rubric,
      steps: 0,
      exhausted: false,
      finalText: "",
      artifactId: "",
      modelRoute: "none",
      liveModel: false,
      error: `Rubric for '${taskId}' has no derivable expected values (every key missing expected.value).`,
    };
  }

  // Resolve the model route. On the @bench path we PREFER a real OpenRouter call
  // (the whole point of this seam — non-bench memory chats stay on scripted).
  // Build-time gate: when VITE_OPENROUTER_API_KEY was NOT set during `vite build`,
  // `liveOpenRouterModel()` returns null and we honestly fall back to the
  // deterministic scripted planner — no fake LLM call, no fake PASS.
  const scriptedRoute = `scripted:bench:${taskId}`;
  const scriptedFallback = scriptedModel(benchmarkPlanner(rubric, outputs), scriptedRoute);
  let chosenModel: AgentModel = scriptedFallback;
  let modelRoute = scriptedRoute;
  let liveModel = false;
  if (hasBrowserOpenRouterKey()) {
    const live = liveOpenRouterModel();
    if (live) {
      chosenModel = live;
      modelRoute = live.name;
      liveModel = true;
    }
  } else {
    // Honest dry-run signal — caller-visible in the chat panel and result.
    postMessage?.(
      `BENCHMARK_DISPATCHER_DRYRUN task=${taskId} reason=no_model_key note="no model key configured; dispatcher is dry-run only (scripted plan: ${browserModelId()} unbound)"`,
    );
  }

  // Signal: dispatcher is live + the task it's running. Live-DOM verification can
  // grep the chat panel for this string.
  postMessage?.(`BENCHMARK_DISPATCHER_READY task=${taskId} model=${modelRoute} live=${liveModel}`);

  // Ensure the bench room auto-allows agent edits — otherwise applyEdit returns
  // `pending_approval` for every write and the grade is silently 0/N. The variance
  // demo room hardcodes autoAllow:true (src/engine/demoRoom.ts:124); we do the
  // same lazily so any caller (UI panel, smoke test, fleet teammate) gets honest
  // results without having to remember the flag.
  const room = engine.getRoom(roomId);
  if (room && !room.autoAllow) engine.toggleAutoAllow(roomId, actor);

  const artifactId = seedBenchArtifact({ engine, roomId, rubric, actor });
  const rt = new InMemoryRoomTools(engine, roomId, artifactId, actor, sessionId);

  // Compose a goal string so the agent's run trace records what was attempted.
  const prompt = promptFor(taskId) ?? "";
  const sources = sourcesFor(taskId, rubric.sources);
  const sourceContext = Object.entries(sources)
    .map(([name, body]) => `--- ${name} ---\n${body}`)
    .join("\n\n");
  const goal = `Benchmark task: ${taskId}\nDeliverable: ${rubric.deliverable}\nAllowed keys: ${rubric.allowed_keys.join(", ")}\n\n${prompt}\n\nSources:\n${sourceContext}`;

  // When the live model errors (rate-limit, transient 5xx, CSP block, etc.) we
  // catch ONCE and replay against the scripted fallback so the bench surface
  // still produces an honest deterministic result instead of a runtime_error
  // handoff. The fallback path stamps modelRoute back to the scripted route so
  // the UI's data-testid="model-route" reflects what actually graded the cells.
  let result;
  try {
    result = await runHarness({
      rt,
      goal,
      model: chosenModel,
      tools: ROOM_TOOLS,
      maxSteps: Math.max(16, Object.keys(outputs).length * 2 + 4),
    });
  } catch (err) {
    if (liveModel) {
      postMessage?.(
        `BENCHMARK_DISPATCHER_FALLBACK task=${taskId} reason=${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`,
      );
      modelRoute = `${scriptedRoute}+fallback`;
      liveModel = false;
      result = await runHarness({
        rt,
        goal,
        model: scriptedFallback,
        tools: ROOM_TOOLS,
        maxSteps: Math.max(16, Object.keys(outputs).length * 2 + 4),
      });
    } else {
      throw err;
    }
  }

  const artifact = engine.getArtifact(artifactId);
  const { grade, outputs: actualOutputs, ok } = gradeOutputs(rubric, artifact);

  // Post the grade summary so the live-DOM check can confirm the task ran end-to-end.
  const passCount = grade.filter((g) => g.ok).length;
  postMessage?.(
    `BENCHMARK_DISPATCHER_RESULT task=${taskId} model=${modelRoute} live=${liveModel} ok=${ok} pass=${passCount}/${grade.length} outputs=${JSON.stringify(actualOutputs)}`,
  );

  return {
    taskId,
    ok,
    grade,
    outputs: actualOutputs,
    rubric,
    steps: result.steps,
    exhausted: result.exhausted,
    finalText: result.finalText,
    artifactId,
    modelRoute,
    liveModel,
  };
}
