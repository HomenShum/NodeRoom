/**
 * Server-side, Docker-free grader for the NodeBench nonbtb (golden) tasks.
 *
 * `internal.benchmarkGrade.runNonbtb({ roomId, artifactId, taskId, threshold? })` is the prod path
 * for grading a live agent run AFTER it commits cells to the room's artifact. It reuses the SAME
 * `gradeGolden` function the Vite-side dashboard and the vitest self-test gate already use — there is
 * no second scorer, no Python, no Docker. The two new pieces are:
 *
 *   1. `convex/lib/goldenRubrics.ts` — Convex-safe rubric registry (replaces the Vite `import.meta.glob`).
 *   2. `convex/lib/cellsToGoldenOutputs.ts` — adapter from the artifact's elements rows into the
 *      grader's `{ key: { value, formula, cite } }` shape.
 *
 * Honesty invariant: this action reads ONLY (a) the bundled rubric (immutable, committed) and (b) the
 * room's artifact state (elements + meta.dataframe.columns). It never inspects the agent's prompt,
 * intermediate state, or any auxiliary message. The score the action returns is a pure function of
 * those two inputs.
 */
import { v } from "convex/values";
import { internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { gradeGolden } from "../src/benchmarks/golden/grader";
import type { GradeResult } from "../src/benchmarks/golden/grader";
import { NONBTB_RUBRICS, NONBTB_TASK_IDS } from "./lib/goldenRubrics";
import { cellsToGoldenOutputs } from "./lib/cellsToGoldenOutputs";

/** Internal read-only snapshot of the artifact (meta + elements) used by `runNonbtb`. Kept here so
 *  the grader doesn't depend on the artifacts module's auth-coupled `requireArtifactInRoom` path —
 *  this is server-internal, so the caller is responsible for authz before scheduling the action. */
export const snapshotForGrading = internalQuery({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts") },
  handler: async (ctx, { roomId, artifactId }) => {
    const art = await ctx.db.get(artifactId);
    if (!art) return null;
    if (String(art.roomId) !== String(roomId)) return null;
    const elements = await ctx.db
      .query("elements")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
      .collect();
    return {
      artifactId: String(artifactId),
      version: art.version,
      kind: art.kind,
      meta: art.meta ?? null,
      elements: elements.map((e) => ({ elementId: e.elementId, value: e.value })),
    };
  },
});

export interface RunNonbtbResult {
  taskId: string;
  ok: boolean;
  score: number;
  raw: number;
  result: GradeResult;
  /** Per-cell breakdown the UI grade panel renders. Mirrors `result.perKey` but inlined for callers
   *  that don't want to destructure the GradeResult. */
  perCell: GradeResult["perKey"];
  artifactVersion: number;
}

export const runNonbtb = internalAction({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    taskId: v.string(),
    threshold: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, artifactId, taskId, threshold }): Promise<RunNonbtbResult> => {
    // (a) Load the bundled rubric. If the taskId isn't a nonbtb task, fail loudly — silently scoring
    //     against a wrong rubric would be a worse outcome than a clean error.
    const rubric = NONBTB_RUBRICS[taskId];
    if (!rubric) {
      throw new Error(
        `unknown_nonbtb_task: "${taskId}" — known ids are ${NONBTB_TASK_IDS.join(", ")}`,
      );
    }

    // (b) Read the room's artifact state (and ONLY that). The snapshot query enforces the artifact
    //     belongs to the supplied room (cross-room confusion would be a silent grade falsification).
    const snap = (await ctx.runQuery(internal.benchmarkGrade.snapshotForGrading, {
      roomId: roomId as Id<"rooms">,
      artifactId: artifactId as Id<"artifacts">,
    })) as
      | {
          artifactId: string;
          version: number;
          kind: string;
          meta: unknown;
          elements: { elementId: string; value: unknown }[];
        }
      | null;
    if (!snap) {
      throw new Error("artifact_not_in_room");
    }

    // (c) Adapt the elements to the grader's GoldenOutputs shape (no agent state consulted).
    const outputs = cellsToGoldenOutputs(rubric, snap.meta as never, snap.elements);

    // (d) Score with the same pure function the self-test gate uses.
    const result = gradeGolden(rubric, outputs, threshold ?? 0.6);

    return {
      taskId,
      ok: result.ok,
      score: result.score,
      raw: result.raw,
      result,
      perCell: result.perKey,
      artifactVersion: snap.version,
    };
  },
});
