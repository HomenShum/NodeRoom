# NodeAgent Two-Pool Ingestion Orchestrator Smoke

Generated: 2026-07-06T07:05:15.230Z

Status: PASS

## Document Work Pool

- Sources: 5
- Shards: 3 at size 2
- Batches: 3 at size 2
- Worker concurrency: 2
- Documents created: 4
- Documents deduped: 1
- Failed sources: 0

## Memory Work Pool

- Documents: 4
- Chunks: 7
- Batches: 4 at size 2
- Worker concurrency: 2
- Memory objects created: 20
- Memory objects deduped: 0
- Failed chunks: 0

## Proof Surface

- Receipt type: noderoom.nodeagent.document-ingestion.receipt
- Receipt version: 1
- Stage order: document_pool -> memory_pool
- Source IDs: raw_duplicate_a, raw_duplicate_b, rss_liveflow_receivables, upload_underwriting_packet, url_acme_q2
- Document hashes: 5e447969, 74890dfe, c2f45d04, cdaf408b
- Chunk hashes: 01e156e4, 0fb720b5, 152566e4, 2c2b4e9e, 503694db, f0b90700, fae1bb13
- Memory object keys: embedding_stub:244bdb5b, embedding_stub:2bb00622, embedding_stub:384b02ff, embedding_stub:6192e102, embedding_stub:7608beae, embedding_stub:d5c24377, embedding_stub:fea39e77, entity:0361e52d, entity:424b2316, entity:7c1c50c2, entity:a53431e4, entity:d8ed3f9e

This smoke proves the scalable architecture shape before adding external workers:
source shards feed the document pool, canonical documents feed the memory pool,
and the receipt captures counts, hashes, resume state, and failures for ProofLoop.
