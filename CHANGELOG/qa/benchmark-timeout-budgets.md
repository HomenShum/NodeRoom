# Benchmark timeout budgets

## 2026-07-30 — Budget measured full-matrix scenarios

Give the 5,416-attempt ProofLoop planner and 321-candidate SpreadsheetBench V2
projection scenarios workload-specific Vitest budgets. Their assertions and
runtime behavior stay unchanged while the full two-worker production gate no
longer reports contention-driven false negatives.

**Commit**: `0973e699`. **Author**: Codex.

**Evidence**: `.tmp/nodekit-v2-gates.log` (384 test files, 2,706 tests, 29
product-memory journeys, final dist security gate).
