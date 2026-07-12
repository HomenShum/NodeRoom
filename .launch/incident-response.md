# NodeRoom Launch Incident Response

## Severity

- `SEV-1`: privacy/security breach, data loss, cross-room access, uncontrolled spend, or production-wide inability to create/join/recover rooms.
- `SEV-2`: sustained job failure, queue saturation, export corruption, auth degradation, or first-stream latency beyond the launch threshold.
- `SEV-3`: isolated workflow, provider, visual, or documentation defect with a working recovery path.

## Immediate Actions

1. Stop new live jobs using the documented admission kill switch.
2. Preserve current traces, deployment IDs, function-spec hash, queue depth, and cost ledger without copying secrets or customer content.
3. Classify the origin as model, tool, representation, provider, UI, verifier, auth, data, or infrastructure.
4. For SEV-1, disable public live entry and keep the deterministic sample available only when isolation is intact.
5. Roll back using the production migration runbook when a deployment, import, auth, reference, or file-integrity trigger fires.
6. Record timeline, impact, owner, mitigation, and follow-up in `.launch/receipts/monitoring/`.

## Communication

- Public status notes must contain impact and recovery facts, not private prompts, room IDs, emails, filenames, source URLs, or raw traces.
- Notify invited pilot users directly for material incidents affecting their task or data.
- Product Hunt comments receive a direct factual update when an incident materially affects the demonstrated workflow.

## Recovery Gate

Do not restore live admission until the triggering deterministic check passes, a fresh browser journey succeeds, and the incident owner records the recovery receipt.
