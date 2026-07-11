import type { Artifact, DataframeColumn } from "../../engine/types";
import type { NotebookKernelResult, NotebookKernelScalar, NotebookKernelTable } from "../../notebook/notebookKernel";

export const NOTEBOOK_KERNEL_OUTPUT_PREFIX = "notebook_kernel:";

export type NotebookKernelStoredOutput = {
  blockId: string;
  input: string;
  result: NotebookKernelResult;
};

export function buildNotebookKernelTables(artifacts: Artifact[]): Record<string, NotebookKernelTable> {
  const sheets = artifacts.filter((artifact) => artifact.kind === "sheet").slice(0, 6);
  const tables: Record<string, NotebookKernelTable> = {};
  for (const artifact of sheets) {
    const table = tableFromArtifact(artifact);
    if (!table) continue;
    for (const alias of [artifact.title, artifact.id, slug(artifact.title)]) tables[slug(alias)] = table;
  }
  if (sheets.length === 1) {
    const only = tables[slug(sheets[0].title)];
    if (only) for (const alias of ["data", "sheet", "diligence", "room_data"]) tables[alias] = only;
  }
  return tables;
}

export function notebookKernelOutputElementId(blockId: string): string {
  return `${NOTEBOOK_KERNEL_OUTPUT_PREFIX}${blockId}`;
}

export function readNotebookKernelOutputs(artifact: Artifact): Record<string, NotebookKernelStoredOutput> {
  const outputs: Record<string, NotebookKernelStoredOutput> = {};
  for (const [elementId, element] of Object.entries(artifact.elements)) {
    if (!elementId.startsWith(NOTEBOOK_KERNEL_OUTPUT_PREFIX) || !isStoredOutput(element.value)) continue;
    outputs[element.value.blockId] = element.value;
  }
  return outputs;
}

function tableFromArtifact(artifact: Artifact): NotebookKernelTable | null {
  const configured = artifact.meta?.dataframe?.columns ?? [];
  const columns = configured.length ? [...configured].sort((a, b) => a.order - b.order) : inferColumns(artifact);
  if (!columns.length) return null;
  const rowIds = unique(Object.keys(artifact.elements).map((id) => id.includes("__") ? id.split("__", 1)[0] : undefined));
  const labels = unique(columns.map((column) => column.label || column.id));
  const rows = rowIds.slice(0, 500).map((rowId) => Object.fromEntries(columns.slice(0, 40).map((column) => [column.label || column.id, scalar(artifact.elements[`${rowId}__${column.id}`]?.value)])));
  return { name: artifact.title, columns: labels.slice(0, 40), rows };
}

function inferColumns(artifact: Artifact): DataframeColumn[] {
  const ids = unique(Object.keys(artifact.elements).map((id) => id.includes("__") ? id.slice(id.indexOf("__") + 2) : undefined));
  return ids.slice(0, 40).map((id, order) => ({ id, label: id, order }));
}

function scalar(value: unknown): NotebookKernelScalar {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value && typeof value === "object" && "value" in value) return scalar((value as { value?: unknown }).value);
  return value === undefined ? null : JSON.stringify(value).slice(0, 500);
}

function isStoredOutput(value: unknown): value is NotebookKernelStoredOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NotebookKernelStoredOutput>;
  return typeof candidate.blockId === "string" && typeof candidate.input === "string" && candidate.result?.schema === 1;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
