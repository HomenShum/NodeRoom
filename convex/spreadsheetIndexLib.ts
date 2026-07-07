import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { DataframeColumn } from "../src/engine/types";
import { buildSpreadsheetSemanticIndex, type SpreadsheetSeedCell } from "../src/app/spreadsheetIndex";

type ArtifactDoc = {
  _id: Id<"artifacts">;
  kind: "sheet" | "note" | "wall";
  title: string;
  meta?: unknown;
};

const MAX_DEPENDENCY_EXPANSION = 1_000;
const MAX_SEED_CELLS_TO_INDEX = 2_000;

export async function syncSpreadsheetIndexFromSeed(
  ctx: MutationCtx,
  args: {
    artifactId: Id<"artifacts">;
    title: string;
    kind: "sheet" | "note" | "wall";
    meta?: unknown;
    seed: SpreadsheetSeedCell[];
    now?: number;
  },
) {
  if (args.kind !== "sheet") return;
  const columns = dataframeColumns(args.meta);
  if (!columns.length) return;
  if (spreadsheetIndexDisabled(args.meta) || args.seed.length > MAX_SEED_CELLS_TO_INDEX) return;
  const now = args.now ?? Date.now();
  const index = buildSpreadsheetSemanticIndex({ title: args.title, columns, seed: args.seed });
  await replaceSpreadsheetIndex(ctx, args.artifactId, index, now);
}

export async function syncSpreadsheetIndexFromDb(ctx: MutationCtx, artifact: ArtifactDoc) {
  if (artifact.kind !== "sheet") return;
  const columns = dataframeColumns(artifact.meta);
  if (!columns.length) return;
  if (spreadsheetIndexDisabled(artifact.meta)) return;
  const elements = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id)).collect();
  if (elements.length > MAX_SEED_CELLS_TO_INDEX) return;
  const seed = elements.map((element) => ({ id: element.elementId, value: element.value }));
  const index = buildSpreadsheetSemanticIndex({ title: artifact.title, columns, seed });
  await replaceSpreadsheetIndex(ctx, artifact._id, index, Date.now());
}

export async function expandElementIdsWithSpreadsheetDependencies(
  ctx: MutationCtx,
  artifactId: Id<"artifacts">,
  elementIds: string[],
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [...elementIds];
  while (queue.length && out.length < MAX_DEPENDENCY_EXPANSION) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const deps = await ctx.db
      .query("spreadsheetDependencies")
      .withIndex("by_parent", (q) => q.eq("artifactId", artifactId).eq("parentElementId", id))
      .collect();
    for (const dep of deps) if (!seen.has(dep.childElementId)) queue.push(dep.childElementId);
  }
  return out;
}

async function replaceSpreadsheetIndex(
  ctx: MutationCtx,
  artifactId: Id<"artifacts">,
  index: ReturnType<typeof buildSpreadsheetSemanticIndex>,
  now: number,
) {
  for (const row of await ctx.db.query("spreadsheetCells").withIndex("by_artifact_element", (q) => q.eq("artifactId", artifactId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("spreadsheetChunks").withIndex("by_artifact_chunk", (q) => q.eq("artifactId", artifactId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("spreadsheetDependencies").withIndex("by_parent", (q) => q.eq("artifactId", artifactId)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const cell of index.cells) {
    await ctx.db.insert("spreadsheetCells", {
      artifactId,
      elementId: cell.elementId,
      coordinate: cell.coordinate,
      rowId: cell.rowId,
      columnId: cell.columnId,
      rowIndex: cell.rowIndex,
      colIndex: cell.colIndex,
      rowHeader: cell.rowHeader,
      columnHeader: cell.columnHeader,
      rawValue: cell.rawValue,
      formula: cell.formula,
      semanticSummary: cell.semanticSummary,
      updatedAt: now,
    });
  }
  for (const chunk of index.chunks) {
    await ctx.db.insert("spreadsheetChunks", {
      artifactId,
      chunkId: chunk.chunkId,
      rowStart: chunk.rowStart,
      rowEnd: chunk.rowEnd,
      colStart: chunk.colStart,
      colEnd: chunk.colEnd,
      elementIds: chunk.elementIds,
      text: chunk.text,
      updatedAt: now,
    });
  }
  for (const dep of index.dependencies) {
    await ctx.db.insert("spreadsheetDependencies", {
      artifactId,
      parentElementId: dep.parentElementId,
      childElementId: dep.childElementId,
      parentCoordinate: dep.parentCoordinate,
      childCoordinate: dep.childCoordinate,
      formula: dep.formula,
      updatedAt: now,
    });
  }
}

function dataframeColumns(meta: unknown): DataframeColumn[] {
  const maybe = meta as { dataframe?: { columns?: unknown } } | undefined;
  const columns = maybe?.dataframe?.columns;
  if (!Array.isArray(columns)) return [];
  return columns.filter((column): column is DataframeColumn => {
    const c = column as Partial<DataframeColumn>;
    return typeof c.id === "string" && typeof c.label === "string" && typeof c.order === "number";
  });
}

function spreadsheetIndexDisabled(meta: unknown): boolean {
  const maybe = meta as { dataframe?: { semanticIndexDisabled?: unknown; skipSemanticIndex?: unknown } } | undefined;
  return maybe?.dataframe?.semanticIndexDisabled === true || maybe?.dataframe?.skipSemanticIndex === true;
}
