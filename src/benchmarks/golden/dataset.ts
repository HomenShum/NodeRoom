/**
 * Golden dataset — the UI-native, Docker-free benchmark corpus.
 *
 * Bundles every NodeBench task's rubric (the golden spec) together with its self-test deliverables
 * (`good` = a known-correct submission that must score 1.0; `bad` = a known-bad one that must be
 * rejected) straight from the Vite-mirrored fixtures in ../nonbtb. No filesystem, no Docker — the
 * whole corpus is bundled, so it loads identically in the browser dispatcher, in vitest, and in any
 * static build. Pair this with gradeGolden() (./grader) to verify a deliverable anywhere.
 */
import type { GoldenRubric, GoldenOutputs } from "./grader";

const RUBRICS = import.meta.glob<GoldenRubric>("../nonbtb/*/rubric.json", { eager: true, import: "default" });
const GOOD = import.meta.glob<GoldenOutputs>("../nonbtb/_selftest_good/*/outputs.json", { eager: true, import: "default" });
const BAD = import.meta.glob<GoldenOutputs>("../nonbtb/_selftest_bad/*/outputs.json", { eager: true, import: "default" });

/** Pull the `<taskId>` segment out of a fixture path like `../nonbtb/_selftest_good/nb-01.../outputs.json`. */
function taskIdFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 2] ?? path;
}

function byTaskId<T>(modules: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [path, mod] of Object.entries(modules)) out[taskIdFromPath(path)] = mod;
  return out;
}

const rubricById = byTaskId(RUBRICS);
const goodById = byTaskId(GOOD);
const badById = byTaskId(BAD);

export interface GoldenTask {
  taskId: string;
  rubric: GoldenRubric;
  /** Known-correct deliverable — gradeGolden must score this 1.0 (proves the golden spec is satisfiable). */
  good: GoldenOutputs;
  /** Known-bad deliverable — gradeGolden must reject this (proves the anti-cheat dimensions fire). */
  bad?: GoldenOutputs;
}

/** Every golden task, sorted by id. */
export function goldenDataset(): GoldenTask[] {
  return Object.keys(rubricById)
    .sort()
    .map((taskId) => ({ taskId, rubric: rubricById[taskId], good: goodById[taskId], bad: badById[taskId] }));
}

export function goldenRubric(taskId: string): GoldenRubric | undefined {
  return rubricById[taskId];
}

export const GOLDEN_TASK_IDS = Object.keys(rubricById).sort();
