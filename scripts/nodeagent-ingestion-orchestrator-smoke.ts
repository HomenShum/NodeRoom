import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runTwoPoolIngestion,
  type IngestionSource,
  type TwoPoolIngestionReceipt,
} from "../src/nodeagent/ingestion/twoPoolOrchestrator";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jsonOut = resolve(repoRoot, "docs/eval/nodeagent-ingestion-orchestrator.json");
const mdOut = resolve(repoRoot, "docs/eval/NODEAGENT_INGESTION_ORCHESTRATOR.md");

const sources: IngestionSource[] = [
  {
    id: "url_acme_q2",
    kind: "url",
    uri: "https://example.com/acme-q2",
    title: "Acme Q2 Update",
    content:
      "Acme Capital reported cash collections for Q2. Redwood Bank requires reconciliation against June invoices.",
  },
  {
    id: "rss_liveflow_receivables",
    kind: "rss_item",
    uri: "https://example.com/feed/liveflow-receivables",
    title: "Receivables automation note",
    content:
      "LiveFlow-style accounting workflows compare AR aging, trial balance exports, and spreadsheet evidence.",
  },
  {
    id: "upload_underwriting_packet",
    kind: "upload",
    title: "Synthetic underwriting packet",
    content:
      "Proximitty underwriting intake extracts borrower facts, normalizes entities, and writes a decision memo.",
  },
  {
    id: "raw_duplicate_a",
    kind: "raw_text",
    title: "Duplicate memo A",
    content: "Northwind Foods uploaded the same remittance packet twice for resume and dedupe proof.",
  },
  {
    id: "raw_duplicate_b",
    kind: "raw_text",
    title: "Duplicate memo B",
    content: "Northwind Foods uploaded the same remittance packet twice for resume and dedupe proof.",
  },
];

function renderMarkdown(receipt: TwoPoolIngestionReceipt): string {
  return `# NodeAgent Two-Pool Ingestion Orchestrator Smoke

Generated: ${receipt.generatedAt}

Status: ${receipt.ok ? "PASS" : "FAIL"}

## Document Work Pool

- Sources: ${receipt.documentPool.sourceCount}
- Shards: ${receipt.documentPool.shardCount} at size ${receipt.documentPool.shardSize}
- Batches: ${receipt.documentPool.batchCount} at size ${receipt.documentPool.batchSize}
- Worker concurrency: ${receipt.documentPool.workerConcurrency}
- Documents created: ${receipt.documentPool.documentsCreated}
- Documents deduped: ${receipt.documentPool.documentsDeduped}
- Failed sources: ${receipt.documentPool.failedSources}

## Memory Work Pool

- Documents: ${receipt.memoryPool.documentCount}
- Chunks: ${receipt.memoryPool.chunkCount}
- Batches: ${receipt.memoryPool.batchCount} at size ${receipt.memoryPool.batchSize}
- Worker concurrency: ${receipt.memoryPool.workerConcurrency}
- Memory objects created: ${receipt.memoryPool.memoryObjectsCreated}
- Memory objects deduped: ${receipt.memoryPool.memoryObjectsDeduped}
- Failed chunks: ${receipt.memoryPool.failedChunks}

## Proof Surface

- Receipt type: ${receipt.type}
- Receipt version: ${receipt.version}
- Stage order: ${receipt.proof.stageOrder.join(" -> ")}
- Source IDs: ${receipt.proof.sourceIds.join(", ")}
- Document hashes: ${receipt.proof.documentHashes.join(", ")}
- Chunk hashes: ${receipt.proof.chunkHashes.join(", ")}
- Memory object keys: ${receipt.proof.memoryObjectKeys.slice(0, 12).join(", ")}

This smoke proves the scalable architecture shape before adding external workers:
source shards feed the document pool, canonical documents feed the memory pool,
and the receipt captures counts, hashes, resume state, and failures for ProofLoop.
`;
}

const receipt = await runTwoPoolIngestion({
  sources,
  config: {
    documentShardSize: 2,
    documentBatchSize: 2,
    documentWorkerConcurrency: 2,
    memoryBatchSize: 2,
    memoryWorkerConcurrency: 2,
    chunkMaxChars: 120,
    chunkOverlapChars: 20,
  },
});

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
writeFileSync(mdOut, renderMarkdown(receipt), "utf8");

console.log(`[nodeagent:ingestion] ${receipt.ok ? "PASS" : "FAIL"}`);
console.log(`[nodeagent:ingestion] wrote ${jsonOut}`);
console.log(`[nodeagent:ingestion] wrote ${mdOut}`);

if (!receipt.ok) {
  process.exitCode = 1;
}
