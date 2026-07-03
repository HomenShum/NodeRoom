# ProofLoop Preprod Runbook

This runbook is the tracked release-safety receipt for the ProofLoop preprod lane.

## Gates

- Static release gate: `npm run benchmark:proofloop:preprod -- --strict`
- Live release gate: `npm run benchmark:proofloop:preprod:live -- --strict`
- Full production gate: `npm run prod:gate`
- Live story smoke only: `npm run qa:story:prod`

## Kill Switches

- Agent spend enforcement is guarded by the Convex credit enforcement path in `convex/agent.ts`.
- Passive room-activity auto-execution stays off unless `PASSIVE_CREATE_AGENT_JOBS=true` in `convex/roomActivity.ts`.
- Provider egress policy lives in `src/nodeagent/guardrails/egressPolicy.ts`. Production can fail closed with `PROVIDER_EGRESS_REQUIRE_ALLOWLIST=1` / `NODEROOM_PRODUCTION=1`, and file-derived egress requires explicit `OPENROUTER_FREE_ALLOW_FILE_EGRESS` or `PROVIDER_PARSER_ALLOW_FILE_EGRESS` approval.
- Browser bundle provider-host scans are checked by `npm run security:gate`.

## Rollback

1. Identify the last green Vercel deployment for `main`.
2. Promote that deployment in Vercel, or revert the offending merge commit and redeploy.
3. Re-run `npm run benchmark:proofloop:preprod:live -- --strict`.
4. Record the deployment URL, commit, and receipt path in the release notes.

## Convex Deploy Guard

Use `npm run convex:deploy:guard` before any production Convex deploy. It verifies that the local deployment target matches the deployment that production reads from.

## Restore Evidence

Backup and restore state is external to this repository. Treat restore readiness as manual until a dated restore rehearsal receipt is attached to the release packet. The preprod receipt keeps this visible as manual evidence rather than claiming it from code.

## Waivers

Waivers must be tracked in `docs/eval/proofloop-preprod-waivers.json` with:

- `checkId`
- `owner`
- `reason`
- `expiresAt`
- `evidence`

Expired waivers do not suppress release blockers.
