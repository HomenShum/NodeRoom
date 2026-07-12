# NodeRoom Launch Kill Switches

Status: live-job admission switches are implemented in the candidate branch; deployment proof is
still required. Distribution and production-write switches remain approval-gated.

| Switch | Scope | Trigger | Required behavior |
|---|---|---|---|
| Live job admission | Global | Spend cap, provider outage, retry storm, SEV-1 | Reject new live jobs with an honest recovery message; deterministic sample remains separate. |
| Workspace admission | Workspace | Workspace cap, abuse, repeated failure | Stop new jobs in that workspace without affecting unrelated workspaces. |
| Provider route | Provider/model | Preflight failure, elevated error/latency | Reject the launch request. Model retries/fallbacks stay disabled until per-attempt metering is certified. |
| Background work | Global/workspace | Foreground starvation | Pause passive jobs and preserve resumable state. |
| Distribution | Campaign/channel | Duplicate risk, policy concern, owner pause | Stop queued sends before execution; preserve skipped receipts and idempotency keys. |
| Production writes | Deployment | Migration window or data-integrity incident | Enter maintenance/read-only mode before snapshots or rollback. |

No switch is launch-ready until admission, active-job behavior, UI state, idempotency, receipt, and recovery are tested.

## Runtime contract

| Environment key | Values | Effect |
|---|---|---|
| `NODEAGENT_LAUNCH_MODE` | `development`, `private_pilot`, `public_launch`, `benchmark` | Pilot/public fail closed unless credits are enforced and the room is enrolled. Benchmark completion is rejected outside development or a dedicated benchmark deployment. |
| `CREDITS_ENFORCED` | `true`/`false` | Reserves before scheduling/lease claim and settles every recorded attempt. Required in pilot/public modes. |
| `NODEAGENT_NEW_ROOM_GRANT_CREDITS` | `0` or `1..20` | Explicitly enrolls newly authenticated launch rooms with a bounded grant. Missing, malformed, negative, or development-mode values grant nothing. |
| `NODEAGENT_GLOBAL_PAUSED` | `true`/`false` | Rejects all new interactive and durable provider work. |
| `NODEAGENT_PROVIDER_PAUSED` | `true`/`false` | Rejects provider-backed work while leaving deterministic/read-only surfaces available. |
| `NODEAGENT_MAINTENANCE_MODE` | `true`/`false` | Rejects new agent work during migration or data-integrity response. |

In pilot/public mode, unresolved hard-cap reservations count toward global, room, and requester
limits. Direct provider admission is one transaction and stable duplicate keys return without
provider execution. Provider-priced nested tools, dynamic subagents, hosted voice, direct capture,
and external embeddings fail closed until their spend is included in the same durable settlement.

Convex environment changes take effect without a frontend redeploy. Production mutation remains
approval-gated; the operator command shape is `npx convex env set <KEY> <VALUE> --prod`.
