export type IngestionSourceKind = "url" | "rss_item" | "upload" | "raw_text";

export type IngestionMetadataValue = string | number | boolean | null;

export interface IngestionSource {
  id: string;
  kind: IngestionSourceKind;
  uri?: string;
  title?: string;
  content?: string;
  metadata?: Record<string, IngestionMetadataValue>;
}

export interface CanonicalDocument {
  id: string;
  sourceId: string;
  sourceKind: IngestionSourceKind;
  title: string;
  text: string;
  contentHash: string;
  uri?: string;
  metadata?: Record<string, IngestionMetadataValue>;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  sourceId: string;
  index: number;
  text: string;
  contentHash: string;
}

export type MemoryObjectKind = "entity" | "fact" | "embedding_stub";

export interface MemoryObject {
  key: string;
  kind: MemoryObjectKind;
  chunkId: string;
  documentId: string;
  sourceId: string;
  value: string;
  evidence: string;
}

export interface TwoPoolIngestionConfig {
  documentShardSize: number;
  documentBatchSize: number;
  documentWorkerConcurrency: number;
  memoryBatchSize: number;
  memoryWorkerConcurrency: number;
  chunkMaxChars: number;
  chunkOverlapChars: number;
}

export interface IngestionResumeState {
  documentContentHashes?: readonly string[];
  memoryObjectKeys?: readonly string[];
}

export interface DocumentWorkBatch {
  index: number;
  shardIndex: number;
  sources: readonly IngestionSource[];
}

export interface MemoryWorkBatch {
  index: number;
  chunks: readonly DocumentChunk[];
}

export interface IngestionWorkerContext {
  config: TwoPoolIngestionConfig;
}

export interface DocumentWorkerFailure {
  sourceId: string;
  reason: string;
}

export interface DocumentWorkerResult {
  documents: readonly CanonicalDocument[];
  failures?: readonly DocumentWorkerFailure[];
}

export interface MemoryWorkerFailure {
  chunkId: string;
  documentId: string;
  sourceId: string;
  reason: string;
}

export interface MemoryWorkerResult {
  memoryObjects: readonly MemoryObject[];
  failures?: readonly MemoryWorkerFailure[];
}

export interface IngestionDocumentPoolReceipt {
  sourceCount: number;
  shardSize: number;
  shardCount: number;
  batchSize: number;
  batchCount: number;
  workerConcurrency: number;
  attemptedSources: number;
  documentsCreated: number;
  documentsDeduped: number;
  failedSources: number;
  failures: readonly DocumentWorkerFailure[];
}

export interface IngestionMemoryPoolReceipt {
  documentCount: number;
  chunkMaxChars: number;
  chunkOverlapChars: number;
  chunkCount: number;
  batchSize: number;
  batchCount: number;
  workerConcurrency: number;
  attemptedChunks: number;
  memoryObjectsCreated: number;
  memoryObjectsDeduped: number;
  failedChunks: number;
  failures: readonly MemoryWorkerFailure[];
}

export interface TwoPoolIngestionProof {
  sourceIds: readonly string[];
  documentHashes: readonly string[];
  chunkHashes: readonly string[];
  memoryObjectKeys: readonly string[];
  stageOrder: readonly ["document_pool", "memory_pool"];
  resumeApplied: boolean;
}

export interface TwoPoolIngestionReceipt {
  type: "noderoom.nodeagent.document-ingestion.receipt";
  version: 1;
  ok: boolean;
  generatedAt: string;
  config: TwoPoolIngestionConfig;
  documentPool: IngestionDocumentPoolReceipt;
  memoryPool: IngestionMemoryPoolReceipt;
  proof: TwoPoolIngestionProof;
  warnings: readonly string[];
}

export interface RunTwoPoolIngestionOptions {
  sources: readonly IngestionSource[];
  config?: Partial<TwoPoolIngestionConfig>;
  resume?: IngestionResumeState;
  documentWorker?: (
    batch: DocumentWorkBatch,
    context: IngestionWorkerContext,
  ) => Promise<DocumentWorkerResult> | DocumentWorkerResult;
  memoryWorker?: (
    batch: MemoryWorkBatch,
    context: IngestionWorkerContext,
  ) => Promise<MemoryWorkerResult> | MemoryWorkerResult;
  chunker?: (document: CanonicalDocument, config: TwoPoolIngestionConfig) => readonly DocumentChunk[];
  now?: () => string;
}

export interface TwoPoolIngestionPlan {
  documentShards: readonly (readonly IngestionSource[])[];
  documentBatches: readonly DocumentWorkBatch[];
}

export const DEFAULT_TWO_POOL_INGESTION_CONFIG: TwoPoolIngestionConfig = {
  documentShardSize: 1000,
  documentBatchSize: 100,
  documentWorkerConcurrency: 4,
  memoryBatchSize: 100,
  memoryWorkerConcurrency: 4,
  chunkMaxChars: 1600,
  chunkOverlapChars: 160,
};

const FAILURE_DOCUMENT_MARKER = "[FAIL_DOCUMENT]";
const FAILURE_MEMORY_MARKER = "[FAIL_MEMORY]";

export function resolveTwoPoolIngestionConfig(
  config: Partial<TwoPoolIngestionConfig> = {},
): TwoPoolIngestionConfig {
  const resolved = { ...DEFAULT_TWO_POOL_INGESTION_CONFIG, ...config };
  assertPositiveInteger("documentShardSize", resolved.documentShardSize);
  assertPositiveInteger("documentBatchSize", resolved.documentBatchSize);
  assertPositiveInteger("documentWorkerConcurrency", resolved.documentWorkerConcurrency);
  assertPositiveInteger("memoryBatchSize", resolved.memoryBatchSize);
  assertPositiveInteger("memoryWorkerConcurrency", resolved.memoryWorkerConcurrency);
  assertPositiveInteger("chunkMaxChars", resolved.chunkMaxChars);

  if (!Number.isInteger(resolved.chunkOverlapChars) || resolved.chunkOverlapChars < 0) {
    throw new Error("chunkOverlapChars must be a non-negative integer");
  }

  if (resolved.chunkOverlapChars >= resolved.chunkMaxChars) {
    throw new Error("chunkOverlapChars must be smaller than chunkMaxChars");
  }

  return resolved;
}

export function buildTwoPoolIngestionPlan(
  sources: readonly IngestionSource[],
  config: Partial<TwoPoolIngestionConfig> = {},
): TwoPoolIngestionPlan {
  const resolved = resolveTwoPoolIngestionConfig(config);
  const documentShards = partition(sources, resolved.documentShardSize);
  const documentBatches = documentShards.flatMap((shard, shardIndex) =>
    partition(shard, resolved.documentBatchSize).map((batchSources, batchIndexInShard) => ({
      index: documentShards
        .slice(0, shardIndex)
        .reduce((count, priorShard) => count + Math.ceil(priorShard.length / resolved.documentBatchSize), 0) + batchIndexInShard,
      shardIndex,
      sources: batchSources,
    })),
  );

  return {
    documentShards,
    documentBatches,
  };
}

export async function runTwoPoolIngestion(
  options: RunTwoPoolIngestionOptions,
): Promise<TwoPoolIngestionReceipt> {
  const config = resolveTwoPoolIngestionConfig(options.config);
  const plan = buildTwoPoolIngestionPlan(options.sources, config);
  const resumeDocumentHashes = new Set(options.resume?.documentContentHashes ?? []);
  const resumeMemoryKeys = new Set(options.resume?.memoryObjectKeys ?? []);
  const documentWorker = options.documentWorker ?? defaultDocumentWorker;
  const memoryWorker = options.memoryWorker ?? defaultMemoryWorker;
  const chunker = options.chunker ?? chunkTextDocument;
  const warnings: string[] = [];

  const documentResults = await runBatches(
    plan.documentBatches,
    config.documentWorkerConcurrency,
    (batch) => Promise.resolve(documentWorker(batch, { config })),
  );

  const documentFailures = documentResults.flatMap((result) => result.failures ?? []);
  const candidateDocuments = documentResults.flatMap((result) => result.documents);
  const documents: CanonicalDocument[] = [];
  let documentsDeduped = 0;
  const seenDocumentHashes = new Set<string>(resumeDocumentHashes);

  for (const document of candidateDocuments) {
    if (seenDocumentHashes.has(document.contentHash)) {
      documentsDeduped += 1;
      continue;
    }

    seenDocumentHashes.add(document.contentHash);
    documents.push(document);
  }

  const chunks = documents.flatMap((document) => [...chunker(document, config)]);
  const memoryBatches = partition(chunks, config.memoryBatchSize).map((batchChunks, index) => ({
    index,
    chunks: batchChunks,
  }));

  const memoryResults = await runBatches(
    memoryBatches,
    config.memoryWorkerConcurrency,
    (batch) => Promise.resolve(memoryWorker(batch, { config })),
  );

  const memoryFailures = memoryResults.flatMap((result) => result.failures ?? []);
  const candidateMemoryObjects = memoryResults.flatMap((result) => result.memoryObjects);
  const memoryObjectKeys: string[] = [];
  let memoryObjectsDeduped = 0;
  const seenMemoryKeys = new Set<string>(resumeMemoryKeys);

  for (const memoryObject of candidateMemoryObjects) {
    if (seenMemoryKeys.has(memoryObject.key)) {
      memoryObjectsDeduped += 1;
      continue;
    }

    seenMemoryKeys.add(memoryObject.key);
    memoryObjectKeys.push(memoryObject.key);
  }

  if (documentFailures.length > 0) {
    warnings.push("document_pool_failures_present");
  }

  if (memoryFailures.length > 0) {
    warnings.push("memory_pool_failures_present");
  }

  const receipt: TwoPoolIngestionReceipt = {
    type: "noderoom.nodeagent.document-ingestion.receipt",
    version: 1,
    ok: documentFailures.length === 0 && memoryFailures.length === 0,
    generatedAt: options.now?.() ?? new Date().toISOString(),
    config,
    documentPool: {
      sourceCount: options.sources.length,
      shardSize: config.documentShardSize,
      shardCount: plan.documentShards.length,
      batchSize: config.documentBatchSize,
      batchCount: plan.documentBatches.length,
      workerConcurrency: config.documentWorkerConcurrency,
      attemptedSources: plan.documentBatches.reduce((count, batch) => count + batch.sources.length, 0),
      documentsCreated: documents.length,
      documentsDeduped,
      failedSources: documentFailures.length,
      failures: documentFailures,
    },
    memoryPool: {
      documentCount: documents.length,
      chunkMaxChars: config.chunkMaxChars,
      chunkOverlapChars: config.chunkOverlapChars,
      chunkCount: chunks.length,
      batchSize: config.memoryBatchSize,
      batchCount: memoryBatches.length,
      workerConcurrency: config.memoryWorkerConcurrency,
      attemptedChunks: memoryBatches.reduce((count, batch) => count + batch.chunks.length, 0),
      memoryObjectsCreated: memoryObjectKeys.length,
      memoryObjectsDeduped,
      failedChunks: memoryFailures.length,
      failures: memoryFailures,
    },
    proof: {
      sourceIds: [...new Set(options.sources.map((source) => source.id))].sort(),
      documentHashes: documents.map((document) => document.contentHash).sort(),
      chunkHashes: chunks.map((chunk) => chunk.contentHash).sort(),
      memoryObjectKeys: memoryObjectKeys.sort(),
      stageOrder: ["document_pool", "memory_pool"],
      resumeApplied: resumeDocumentHashes.size > 0 || resumeMemoryKeys.size > 0,
    },
    warnings,
  };

  return receipt;
}

export function chunkTextDocument(
  document: CanonicalDocument,
  config: TwoPoolIngestionConfig = DEFAULT_TWO_POOL_INGESTION_CONFIG,
): readonly DocumentChunk[] {
  const text = normalizeWhitespace(document.text);

  if (text.length === 0) {
    return [];
  }

  const chunks: DocumentChunk[] = [];
  const step = config.chunkMaxChars - config.chunkOverlapChars;
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + config.chunkMaxChars, text.length);
    const chunkText = text.slice(start, end).trim();

    if (chunkText.length > 0) {
      const contentHash = stableHash(`${document.contentHash}:${index}:${chunkText}`);
      chunks.push({
        id: `chunk_${stableHash(`${document.id}:${index}:${contentHash}`)}`,
        documentId: document.id,
        sourceId: document.sourceId,
        index,
        text: chunkText,
        contentHash,
      });
    }

    start += step;
    index += 1;
  }

  return chunks;
}

export function defaultDocumentWorker(batch: DocumentWorkBatch): DocumentWorkerResult {
  const documents: CanonicalDocument[] = [];
  const failures: DocumentWorkerFailure[] = [];

  for (const source of batch.sources) {
    const text = normalizeWhitespace(
      source.content ?? [source.title, source.uri].filter(Boolean).join("\n"),
    );

    if (text.includes(FAILURE_DOCUMENT_MARKER)) {
      failures.push({
        sourceId: source.id,
        reason: "document_worker_failure_marker",
      });
      continue;
    }

    if (text.length === 0) {
      failures.push({
        sourceId: source.id,
        reason: "empty_source_content",
      });
      continue;
    }

    const contentHash = stableHash(`${source.kind}:${source.uri ?? ""}:${text}`);
    documents.push({
      id: `doc_${stableHash(`${source.id}:${contentHash}`)}`,
      sourceId: source.id,
      sourceKind: source.kind,
      title: source.title ?? source.uri ?? source.id,
      text,
      contentHash,
      uri: source.uri,
      metadata: source.metadata,
    });
  }

  return { documents, failures };
}

export function defaultMemoryWorker(batch: MemoryWorkBatch): MemoryWorkerResult {
  const memoryObjects: MemoryObject[] = [];
  const failures: MemoryWorkerFailure[] = [];

  for (const chunk of batch.chunks) {
    if (chunk.text.includes(FAILURE_MEMORY_MARKER)) {
      failures.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        sourceId: chunk.sourceId,
        reason: "memory_worker_failure_marker",
      });
      continue;
    }

    const entities = extractCandidateEntities(chunk.text).slice(0, 5);
    for (const entity of entities) {
      memoryObjects.push({
        key: `entity:${stableHash(`${chunk.contentHash}:${entity}`)}`,
        kind: "entity",
        chunkId: chunk.id,
        documentId: chunk.documentId,
        sourceId: chunk.sourceId,
        value: entity,
        evidence: chunk.text.slice(0, 240),
      });
    }

    memoryObjects.push({
      key: `fact:${stableHash(`${chunk.contentHash}:${chunk.text.slice(0, 120)}`)}`,
      kind: "fact",
      chunkId: chunk.id,
      documentId: chunk.documentId,
      sourceId: chunk.sourceId,
      value: chunk.text.slice(0, 180),
      evidence: chunk.text.slice(0, 240),
    });

    memoryObjects.push({
      key: `embedding_stub:${stableHash(chunk.contentHash)}`,
      kind: "embedding_stub",
      chunkId: chunk.id,
      documentId: chunk.documentId,
      sourceId: chunk.sourceId,
      value: stableHash(`embedding:${chunk.text}`),
      evidence: chunk.text.slice(0, 240),
    });
  }

  return { memoryObjects, failures };
}

export function stableHash(input: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function partition<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const partitions: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    partitions.push(items.slice(index, index + size));
  }
  return partitions;
}

async function runBatches<TBatch, TResult>(
  batches: readonly TBatch[],
  concurrency: number,
  worker: (batch: TBatch) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array<TResult>(batches.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= batches.length) {
        return;
      }

      results[currentIndex] = await worker(batches[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, () => runWorker()),
  );

  return results;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractCandidateEntities(text: string): readonly string[] {
  const entities = new Set<string>();
  const matches = text.match(/\b[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3}\b/g) ?? [];

  for (const match of matches) {
    const normalized = normalizeWhitespace(match);
    if (!isCommonSentenceStart(normalized)) {
      entities.add(normalized);
    }
  }

  return [...entities].sort();
}

function isCommonSentenceStart(value: string): boolean {
  return ["The", "This", "That", "When", "Where", "There"].includes(value);
}
