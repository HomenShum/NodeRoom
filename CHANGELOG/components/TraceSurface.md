# Trace surface

## 2026-11-09 — Bind the run trace to the selected record

A host checking an approved agent edit now sees the newest run first, can select
older runs, and gets the selected run's title and span count. Remove the prototype
version and event claims and the inactive Back button; retain recorded errors,
retries and version attributes. Keep the picker and span tree reachable in a
narrow desktop window.

**Author**: Codex (agent-autoloop). **Change**: `autoloop/ui-uf01-trace-shows-its-own-run`.
**Proof**: `e2e/ui-flow/uf01-trace-shows-its-own-run.spec.ts`,
`evidence/ui-flow/uf01-trace-shows-its-own-run/` (before/after local memory captures).
