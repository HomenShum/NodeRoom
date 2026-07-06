import { describe, expect, it } from "vitest";
import {
  buildTwoPoolIngestionPlan,
  runTwoPoolIngestion,
  stableHash,
  type IngestionSource,
} from "../src/nodeagent/ingestion/twoPoolOrchestrator";

const fixedNow = () => "2026-07-06T00:00:00.000Z";

function source(id: string, content: string): IngestionSource {
  return {
    id,
    kind: "raw_text",
    title: `Source ${id}`,
    content,
  };
}

describe("NodeAgent two-pool ingestion orchestrator", () => {
  it("plans source shards and worker batches independently", async () => {
    const sources = Array.from({ length: 7 }, (_, index) =>
      source(
        `source_${index + 1}`,
        `Acme Capital document ${index + 1}. Redwood Bank tracks invoice and cash timing.`,
      ),
    );

    const plan = buildTwoPoolIngestionPlan(sources, {
      documentShardSize: 3,
      documentBatchSize: 2,
    });

    expect(plan.documentShards.map((shard) => shard.length)).toEqual([3, 3, 1]);
    expect(plan.documentBatches.map((batch) => batch.sources.length)).toEqual([2, 1, 2, 1, 1]);

    const receipt = await runTwoPoolIngestion({
      sources,
      config: {
        documentShardSize: 3,
        documentBatchSize: 2,
        documentWorkerConcurrency: 2,
        memoryBatchSize: 2,
        memoryWorkerConcurrency: 2,
        chunkMaxChars: 80,
        chunkOverlapChars: 10,
      },
      now: fixedNow,
    });

    expect(receipt.ok).toBe(true);
    expect(receipt.documentPool.shardCount).toBe(3);
    expect(receipt.documentPool.batchCount).toBe(5);
    expect(receipt.documentPool.documentsCreated).toBe(7);
    expect(receipt.memoryPool.batchCount).toBeGreaterThan(1);
    expect(receipt.proof.stageOrder).toEqual(["document_pool", "memory_pool"]);
  });

  it("dedupes resumed documents and memory objects", async () => {
    const duplicateContent = "Northwind Foods uploaded the same remittance packet twice.";
    const resumedHash = stableHash(`raw_text::${duplicateContent}`);

    const firstPass = await runTwoPoolIngestion({
      sources: [source("resume_a", duplicateContent), source("resume_b", duplicateContent)],
      config: {
        documentShardSize: 10,
        documentBatchSize: 5,
        memoryBatchSize: 5,
      },
      now: fixedNow,
    });

    expect(firstPass.documentPool.documentsCreated).toBe(1);
    expect(firstPass.documentPool.documentsDeduped).toBe(1);
    expect(firstPass.memoryPool.memoryObjectsCreated).toBeGreaterThan(0);

    const secondPass = await runTwoPoolIngestion({
      sources: [source("resume_c", duplicateContent)],
      resume: {
        documentContentHashes: [resumedHash],
        memoryObjectKeys: [firstPass.proof.memoryObjectKeys[0]],
      },
      now: fixedNow,
    });

    expect(secondPass.proof.resumeApplied).toBe(true);
    expect(secondPass.documentPool.documentsCreated).toBe(0);
    expect(secondPass.documentPool.documentsDeduped).toBe(1);
    expect(secondPass.memoryPool.memoryObjectsCreated).toBe(0);
  });

  it("continues independently and receipts document and memory failures", async () => {
    const receipt = await runTwoPoolIngestion({
      sources: [
        source("good", "Globex Treasury confirmed the working-capital note."),
        source("bad_document", "This item should trip [FAIL_DOCUMENT]."),
        source("bad_memory", "Initech Finance sent a chunk with [FAIL_MEMORY] for extraction."),
      ],
      config: {
        chunkMaxChars: 120,
        chunkOverlapChars: 0,
      },
      now: fixedNow,
    });

    expect(receipt.ok).toBe(false);
    expect(receipt.documentPool.failedSources).toBe(1);
    expect(receipt.documentPool.failures[0]).toEqual({
      sourceId: "bad_document",
      reason: "document_worker_failure_marker",
    });
    expect(receipt.memoryPool.failedChunks).toBe(1);
    expect(receipt.memoryPool.failures[0]?.sourceId).toBe("bad_memory");
    expect(receipt.documentPool.documentsCreated).toBe(2);
    expect(receipt.warnings).toEqual(["document_pool_failures_present", "memory_pool_failures_present"]);
  });

  it("generates stable proof hashes for the same inputs", async () => {
    const sources = [
      source("stable_1", "Contoso Bank reconciled revenue against the June trial balance."),
      source("stable_2", "Fabrikam Advisors normalized entity names before embedding."),
    ];

    const first = await runTwoPoolIngestion({ sources, now: fixedNow });
    const second = await runTwoPoolIngestion({ sources, now: fixedNow });

    expect(second).toEqual(first);
    expect(first.proof.documentHashes).toHaveLength(2);
    expect(first.proof.chunkHashes).toHaveLength(2);
    expect(first.proof.memoryObjectKeys.length).toBeGreaterThanOrEqual(2);
  });
});
