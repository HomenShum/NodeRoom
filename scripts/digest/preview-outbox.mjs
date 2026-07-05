/**
 * Always-On Rooms — digest bootstrap step 3: outbox preview + human decisions.
 *
 * No args: prints state counts + a bounded table of the outbox journal.
 * Transitions (each validated against the outbox transition table; invalid
 * transitions EXIT 1 with the reason — the state machine is the contract):
 *
 *   --approve <key>            draft_created → approved   (the human-review gate)
 *   --mark-sent <key> <ref>    approved      → sent       (records provider ref)
 *   --retry <key>              failed        → pending_draft (1 retry, then capped)
 *
 * Failure RECORDING (an event, not a state-machine transition — the core
 * contract has no transition into `failed`; guarded by canRecordFailure so
 * terminal rows can never be failure-recorded):
 *
 *   --mark-failed <key> <why>  records `failed` on an in-flight row
 *
 * `approved` is the ONLY state that may send, and only a human runs --approve.
 * This script never sends anything; it is a ledger over data/digest/outbox.jsonl.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  OUTBOX_STATES,
  canTransition,
  canRecordFailure,
  loadOutbox,
  appendOutboxRows,
  DEFAULT_OUTBOX_PATH,
} from "./outbox-shared.mjs";

const MAX_TABLE_ROWS = 50; // BOUND: preview output stays readable at any journal size

/**
 * Apply one validated transition to the journal (exported for scenario tests).
 * Throws with an honest reason on any invalid transition or unknown key.
 */
export function applyTransition({ outboxPath, key, to, extra = {}, now } = {}) {
  const resolvedOutbox = outboxPath || DEFAULT_OUTBOX_PATH;
  const { rows, endsWithNewline } = loadOutbox(resolvedOutbox);
  const row = rows.get(key);
  if (!row) throw new Error(`no outbox row with idempotency key ${JSON.stringify(key)}`);
  if (!canTransition(row.state, to)) {
    throw new Error(`invalid transition ${row.state} -> ${to} for ${key} (allowed from ${row.state}: see outbox-shared.mjs OUTBOX_TRANSITIONS)`);
  }
  if (to === "pending_draft") {
    // retry path: 1 retry, then capped (mirrors the specimen retry policy)
    const retries = Number(row.retryCount ?? 0);
    if (retries >= 1) {
      throw new Error(`retry policy: 1 retry then capped — ${key} has already been retried`);
    }
    extra = { ...extra, retryCount: retries + 1 };
  }
  const updated = { ...row, state: to, ...extra, updatedAt: (now ? new Date(now) : new Date()).toISOString() };
  appendOutboxRows(resolvedOutbox, [updated], { endsWithNewline });
  return updated;
}

/**
 * Record a failure on an in-flight row (exported for scenario tests).
 * NOT a state-machine transition — the core contract has no transition into
 * `failed`; failure is recorded by whoever observed it. canRecordFailure
 * refuses terminal rows (sent/skipped) and already-failed rows.
 */
export function recordFailure({ outboxPath, key, reason, now } = {}) {
  const resolvedOutbox = outboxPath || DEFAULT_OUTBOX_PATH;
  const { rows, endsWithNewline } = loadOutbox(resolvedOutbox);
  const row = rows.get(key);
  if (!row) throw new Error(`no outbox row with idempotency key ${JSON.stringify(key)}`);
  if (!canRecordFailure(row.state)) {
    throw new Error(`cannot record failure on a ${row.state} row (${key}); only in-flight rows (pending_draft/draft_created/approved) may fail`);
  }
  const nowIso = (now ? new Date(now) : new Date()).toISOString();
  const updated = { ...row, state: "failed", error: reason ?? "manually_failed", failedAt: nowIso, updatedAt: nowIso };
  appendOutboxRows(resolvedOutbox, [updated], { endsWithNewline });
  return updated;
}

/** Render counts-by-state + a bounded table (exported for tests). */
export function formatOutboxTable(outboxPath) {
  const { rows, corruptLines } = loadOutbox(outboxPath || DEFAULT_OUTBOX_PATH);
  const all = [...rows.values()];
  const counts = Object.fromEntries(OUTBOX_STATES.map((s) => [s, 0]));
  for (const row of all) counts[row.state] += 1;
  const lines = [];
  lines.push(OUTBOX_STATES.map((s) => `${s}=${counts[s]}`).join("  ") + `  (rows=${all.length}, corrupt_ignored=${corruptLines})`);
  lines.push("");
  const pad = (v, n) => String(v ?? "").slice(0, n).padEnd(n);
  lines.push(pad("IDEMPOTENCY KEY", 34) + pad("TO", 30) + pad("STATE", 15) + pad("REF", 26) + "REASON/ERROR");
  const shown = all.sort((a, b) => (a.idempotencyKey < b.idempotencyKey ? -1 : 1)).slice(0, MAX_TABLE_ROWS);
  for (const r of shown) {
    lines.push(pad(r.idempotencyKey, 34) + pad(r.to, 30) + pad(r.state, 15) + pad(r.providerRef ?? r.sentRef ?? "—", 26) + (r.reason ?? r.error ?? ""));
  }
  if (all.length > shown.length) lines.push(`… and ${all.length - shown.length} more rows`);
  return lines.join("\n");
}

function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  const positional = [];
  let outboxPath;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--outbox") {
      outboxPath = argv[i + 1];
      i += 1;
    } else if (a.startsWith("--")) {
      flags[a.slice(2)] = true;
      // collect this action's positional args
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        positional.push(argv[i + 1]);
        i += 1;
      }
    }
  }

  try {
    if (flags.approve) {
      const [key] = positional;
      if (!key) throw new Error("--approve requires <key>");
      const row = applyTransition({ outboxPath, key, to: "approved", extra: { approvedBy: "human:cli" } });
      process.stdout.write(`approved ${row.idempotencyKey} (${row.to})\n`);
    } else if (flags["mark-sent"]) {
      const [key, ref] = positional;
      if (!key || !ref) throw new Error("--mark-sent requires <key> <provider_ref>");
      const row = applyTransition({ outboxPath, key, to: "sent", extra: { sentRef: ref } });
      process.stdout.write(`sent ${row.idempotencyKey} via ${ref}\n`);
    } else if (flags["mark-failed"]) {
      const [key, reason] = positional;
      if (!key) throw new Error("--mark-failed requires <key> [reason]");
      const row = recordFailure({ outboxPath, key, reason });
      process.stdout.write(`failed ${row.idempotencyKey}: ${row.error}\n`);
    } else if (flags.retry) {
      const [key] = positional;
      if (!key) throw new Error("--retry requires <key>");
      const row = applyTransition({ outboxPath, key, to: "pending_draft" });
      process.stdout.write(`retrying ${row.idempotencyKey} (retry ${row.retryCount}/1)\n`);
    } else {
      process.stdout.write(formatOutboxTable(outboxPath) + "\n");
    }
  } catch (err) {
    // HONEST_STATUS: invalid transitions exit 1 with the exact reason.
    process.stderr.write(`preview-outbox: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
