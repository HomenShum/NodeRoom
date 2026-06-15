import type {
  CellEvidence,
  CellPayload,
  DataframeColumn,
  ProviderFileCacheMeta,
  ProviderParseMeta,
  ProviderParser,
} from "../engine/types";
import type { UploadedArtifactInput } from "./uploadedArtifact";
import { buildSpreadsheetSemanticIndex } from "./spreadsheetIndex";

export type CanonicalFileRef = {
  storageId: string;
  artifactId?: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type ProviderUploadResult = {
  provider: ProviderParser;
  providerFileId: string;
  cachedAt: number;
  expiresAt?: number;
};

export type ProviderParserAdapter = {
  provider: ProviderParser;
  uploadFile(file: CanonicalFileRef): Promise<ProviderUploadResult>;
  extract(args: {
    file: CanonicalFileRef;
    providerFile: ProviderFileCacheMeta;
    model: string;
    prompt: string;
  }): Promise<ProviderExtraction>;
};

export type ProviderExtractionTable = {
  title: string;
  columns: string[];
  rows: unknown[][];
  confidence?: number;
};

export type ProviderExtraction = {
  summary?: string;
  tables?: ProviderExtractionTable[];
  evidence?: Array<{
    label: string;
    snippet?: string;
    table?: string;
    row?: number;
    column?: string;
    page?: number;
    bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
    url?: string;
    confidence?: number;
  }>;
  warnings?: string[];
};

export function providerFileCacheMeta(file: CanonicalFileRef, result: ProviderUploadResult): ProviderFileCacheMeta {
  return {
    provider: result.provider,
    providerFileId: result.providerFileId,
    sourceStorageId: file.storageId,
    sourceArtifactId: file.artifactId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    cachedAt: result.cachedAt,
    expiresAt: result.expiresAt,
  };
}

export function artifactsFromProviderExtraction(args: {
  file: CanonicalFileRef;
  providerFile: ProviderFileCacheMeta;
  provider: ProviderParser;
  model: string;
  extraction: ProviderExtraction;
  providerRoute?: unknown;
  now?: number;
}): UploadedArtifactInput[] {
  const extractedAt = args.now ?? Date.now();
  const meta: ProviderParseMeta = {
    parser: "provider",
    provider: args.provider,
    model: args.model,
    sourceStorageId: args.file.storageId,
    sourceArtifactId: args.file.artifactId,
    providerFileId: args.providerFile.providerFileId,
    extractedAt,
    warnings: args.extraction.warnings,
    providerRoute: args.providerRoute,
  };
  const artifacts: UploadedArtifactInput[] = [];
  for (const table of args.extraction.tables ?? []) {
    artifacts.push(tableArtifactFromProvider({ ...args, table, extractedAt, meta }));
  }
  if (args.extraction.summary && artifacts.length === 0) {
    artifacts.push({
      kind: "note",
      title: `${args.file.fileName} / provider summary`,
      seed: [{ id: "doc", value: args.extraction.summary }],
      meta: {
        upload: { fileName: args.file.fileName, mimeType: args.file.mimeType, size: args.file.size, parsedAt: extractedAt },
        providerParse: meta,
      },
    });
  }
  return artifacts;
}

function tableArtifactFromProvider(args: {
  file: CanonicalFileRef;
  providerFile: ProviderFileCacheMeta;
  provider: ProviderParser;
  model: string;
  extraction: ProviderExtraction;
  table: ProviderExtractionTable;
  extractedAt: number;
  meta: ProviderParseMeta;
}): UploadedArtifactInput {
  const columns = uniqueProviderColumns(args.table.columns);
  const seed: Array<{ id: string; value: unknown }> = [];
  args.table.rows.forEach((row, rowIndex) => {
    const rid = `p${rowIndex + 1}`;
    columns.forEach((col, colIndex) => {
      seed.push({
        id: `${rid}__${col.id}`,
        value: providerCellPayload({
          value: row[colIndex] ?? "",
          column: col,
          row: rowIndex + 1,
          table: args.table,
          file: args.file,
          providerFile: args.providerFile,
          extraction: args.extraction,
        }),
      });
    });
  });
  const title = `${args.file.fileName} / ${args.table.title}`;
  const semanticIndex = buildSpreadsheetSemanticIndex({ title, columns, seed });
  return {
    kind: "sheet",
    title,
    seed,
    meta: {
      upload: { fileName: args.file.fileName, mimeType: args.file.mimeType, size: args.file.size, parsedAt: args.extractedAt },
      providerParse: args.meta,
      dataframe: {
        columns,
        rowCount: args.table.rows.length,
        sourceFile: args.file.fileName,
        sheetName: args.table.title,
        sheetNames: [args.table.title],
        parser: `provider:${args.provider}:${args.model}`,
        truncated: false,
        warnings: args.extraction.warnings,
        semanticIndex: {
          cellCount: semanticIndex.cells.length,
          chunkCount: semanticIndex.chunks.length,
          dependencyCount: semanticIndex.dependencies.length,
          indexedAt: args.extractedAt,
        },
      },
    },
  };
}

function providerCellPayload(args: {
  value: unknown;
  column: DataframeColumn;
  row: number;
  table: ProviderExtractionTable;
  file: CanonicalFileRef;
  providerFile: ProviderFileCacheMeta;
  extraction: ProviderExtraction;
}): CellPayload {
  const evidence: CellEvidence[] = args.extraction.evidence?.length
    ? scopedEvidence(args.extraction.evidence, args.table, args.row, args.column).map((e, idx): CellEvidence => ({
      id: `provider:${args.providerFile.provider}:${args.providerFile.providerFileId}:${args.row}:${args.column.id}:${idx + 1}`,
      kind: "source",
      label: e.label,
      source: args.file.fileName,
      sourceStorageId: args.file.storageId,
      sourceArtifactId: args.file.artifactId,
      providerFileId: args.providerFile.providerFileId,
      row: e.row ?? args.row,
      column: e.column ?? args.column.label,
      page: e.page,
      bbox: e.bbox,
      snippet: e.snippet,
      url: e.url,
      confidence: e.confidence,
    }))
    : [{
      id: `provider:${args.providerFile.provider}:${args.providerFile.providerFileId}:${args.row}:${args.column.id}`,
      kind: "source",
      label: `${args.providerFile.provider} extraction from ${args.file.fileName}`,
      source: args.file.fileName,
      sourceStorageId: args.file.storageId,
      sourceArtifactId: args.file.artifactId,
      providerFileId: args.providerFile.providerFileId,
      row: args.row,
      column: args.column.label,
      confidence: args.table.confidence,
    }];
  const empty = args.value === null || args.value === undefined || String(args.value).trim() === "";
  return {
    value: args.value,
    status: empty ? "empty" : "complete",
    confidence: args.table.confidence,
    evidence,
  };
}

function scopedEvidence(
  evidence: NonNullable<ProviderExtraction["evidence"]>,
  table: ProviderExtractionTable,
  row: number,
  column: DataframeColumn,
) {
  const scoped = evidence.filter((e) => {
    if (e.table && e.table !== table.title) return false;
    if (e.row != null && e.row !== row) return false;
    if (e.column && e.column !== column.label && e.column !== column.id) return false;
    return e.table != null || e.row != null || e.column != null;
  });
  return scoped.length ? scoped : evidence;
}

function uniqueProviderColumns(labels: string[]): DataframeColumn[] {
  const seen = new Map<string, number>();
  return labels.map((label, order) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "col";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { id: n ? `${base}_${n + 1}` : base, label, order, mode: "enrich", type: "text", agentWritable: true };
  });
}
