/**
 * Background crons. P1-2: the lock-lease janitor — TTL-expired locks must be actively swept
 * (status transition + agent-session clear + smart-merge of blocked drafts), not just filtered out
 * of reads: a filtered-but-active expired lock strands its blocked drafts in "pending" forever and
 * renders locked-forever in any UI that filters on status alone.
 */
import { cronJobs, makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const sweepOkfOutboxLeasesRef = makeFunctionReference<"mutation">("okf:sweepOutboxLeases") as any;
const drainOkfOutboxRef = makeFunctionReference<"action">("okfIndexer:drainBatch") as any;
// alwaysOn is not in _generated yet (codegen deploys to prod — run by the deploy lane), so
// reference it by name exactly like the okf refs above.
const scanAlwaysOnRoomsRef = makeFunctionReference<"action">("alwaysOn:scanDuePublicRooms") as any;
// pruneAlwaysOnRows is new in retention.ts and not in _generated for the same reason.
const pruneAlwaysOnRowsRef = makeFunctionReference<"mutation">("retention:pruneAlwaysOnRows") as any;

crons.interval("sweep expired lock leases", { minutes: 1 }, internal.locks.sweepExpiredLocks, {});
crons.interval("sweep expired agent job leases", { minutes: 1 }, internal.agentJobs.sweepExpiredJobLeases, {});
crons.interval("sweep expired OKF outbox leases", { minutes: 1 }, sweepOkfOutboxLeasesRef, {});
crons.interval("drain OKF embedding outbox", { minutes: 1 }, drainOkfOutboxRef, { limit: 8 });
// Always-On public rooms: deterministic scheduled scan (zero model calls in v1). The action
// re-checks per-room cadence (daily/weekly) and monthly/per-run credit caps itself, so a
// 24h tick is correct for both cadences.
crons.interval("scan due always-on public rooms", { hours: 24 }, scanAlwaysOnRoomsRef, {});

// Production gate: bound telemetry growth. Prunes traces/agentSteps/agentOperationEvents older than
// the retention window in bounded batches (convex/retention.ts) so a live deployment's storage can't
// grow without ceiling. Product data, chat, and the spend ledger are intentionally untouched.
crons.interval("prune old telemetry", { hours: 6 }, internal.retention.pruneOldTelemetry, {});

// Always-On retention: run receipts, terminal outbox rows, and stale pending/unsubscribed
// subscription rows are append-only and must not grow without ceiling (convex/retention.ts
// pruneAlwaysOnRows — active subscriptions are never touched).
crons.interval("prune always-on rows", { hours: 6 }, pruneAlwaysOnRowsRef, {});

// Refund credit holds left behind by crashed/abandoned runs (a never-settled reserve past its
// TTL permanently strands a room's budget otherwise). Append-only refund rows; idempotent.
crons.interval("sweep expired credit reservations", { minutes: 15 }, internal.credits.sweepExpiredReservations, {});

export default crons;
