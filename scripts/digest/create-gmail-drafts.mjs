/**
 * Always-On Rooms — digest bootstrap step 2: Gmail drafts.
 *
 * Reads the outbox journal and, for rows in `pending_draft`, renders RFC-822
 * .eml draft files into data/digest/drafts/ (gitignored) and transitions the
 * rows to `draft_created` with providerRef = the .eml filename.
 *
 * THIS SCRIPT NEVER SENDS. NEVER touches the network. A human (or the Gmail
 * connector operating under explicit human approval) imports the .eml files
 * as Gmail drafts and reviews them. `approved` and `sent` are recorded ONLY
 * via preview-outbox.mjs --approve / --mark-sent, each validated against the
 * outbox transition table. The agent writes copy and creates drafts; it never
 * picks recipients and never sends.
 *
 * Caps: --limit N (default 10, hard max 20 per invocation) AND a ≤20 drafts
 * per UTC day budget. Requests past either cap are REFUSED with an honest
 * error — never silently clamped.
 *
 * Usage:
 *   node scripts/digest/create-gmail-drafts.mjs \
 *     [--outbox data/digest/outbox.jsonl] [--drafts-dir data/digest/drafts] \
 *     [--limit 10] [--from "Expositio Pulse · NodeRoom <rooms@noderoom.live>"]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  canTransition,
  loadOutbox,
  appendOutboxRows,
  sanitizeHeaderValue,
  safeFileName,
  mimeBoundary,
  markdownToBasicHtml,
  utcDay,
  DEFAULT_OUTBOX_PATH,
  DEFAULT_DRAFTS_DIR,
  DAILY_DRAFT_CAP,
  DEFAULT_DRAFT_LIMIT,
} from "./outbox-shared.mjs";
import { parseArgs } from "./enqueue-digest.mjs";

export const DEFAULT_FROM = "Expositio Pulse · NodeRoom <rooms@noderoom.live>";

/** Render one RFC-822 multipart/alternative draft. Pure + deterministic per row. */
export function renderEml(row, { from = DEFAULT_FROM, date = new Date() } = {}) {
  const boundary = mimeBoundary(row.idempotencyKey);
  const unsubscribe = row.links?.unsubscribe ?? "https://noderoom.live/#rooms/" + row.roomSlug;
  const text = String(row.markdownBody ?? "");
  const html = `<div>${markdownToBasicHtml(text)}</div>`;
  const lines = [
    `From: ${sanitizeHeaderValue(from)}`,
    `To: ${sanitizeHeaderValue(row.to)}`,
    `Subject: ${sanitizeHeaderValue(row.subject ?? "")}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0",
    `List-Unsubscribe: <${sanitizeHeaderValue(unsubscribe)}>`,
    `X-NodeRoom-Idempotency-Key: ${sanitizeHeaderValue(row.idempotencyKey)}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

/**
 * Core drafting logic (exported for scenario tests).
 * Returns an honest summary; throws on cap refusals and IO failures.
 */
export function createDrafts({ outboxPath, draftsDir, limit, from, now } = {}) {
  const resolvedOutbox = outboxPath || DEFAULT_OUTBOX_PATH;
  const resolvedDraftsDir = draftsDir || DEFAULT_DRAFTS_DIR;
  const nowDate = now ? new Date(now) : new Date();

  const requested = limit === undefined ? DEFAULT_DRAFT_LIMIT : Number(limit);
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error(`--limit must be a positive integer (got ${limit})`);
  }
  if (requested > DAILY_DRAFT_CAP) {
    throw new Error(`--limit ${requested} exceeds the hard cap of ${DAILY_DRAFT_CAP} drafts/day; run with --limit ${DAILY_DRAFT_CAP} or fewer`);
  }

  const { rows, corruptLines, endsWithNewline } = loadOutbox(resolvedOutbox);

  // Deterministic order: sort pending rows by idempotency key.
  const pending = [...rows.values()]
    .filter((r) => r.state === "pending_draft")
    .sort((a, b) => (a.idempotencyKey < b.idempotencyKey ? -1 : 1));

  // ≤20 drafts per UTC day, counted from rows drafted today (any later state).
  const today = utcDay(nowDate.toISOString());
  const draftedToday = [...rows.values()].filter((r) => r.draftedAt && utcDay(r.draftedAt) === today).length;
  const toDraft = Math.min(requested, pending.length);
  if (toDraft > 0 && draftedToday + toDraft > DAILY_DRAFT_CAP) {
    const remaining = Math.max(0, DAILY_DRAFT_CAP - draftedToday);
    throw new Error(
      `daily budget: ${draftedToday}/${DAILY_DRAFT_CAP} drafts already created today; drafting ${toDraft} more would exceed the cap. ` +
        (remaining > 0 ? `Re-run with --limit ${remaining}.` : "No budget left today — wait for the next UTC day.")
    );
  }

  fs.mkdirSync(resolvedDraftsDir, { recursive: true });
  const updates = [];
  const summary = { drafted: 0, failed: 0, pendingRemaining: 0, corruptLinesIgnored: corruptLines, draftsDir: resolvedDraftsDir };

  for (const row of pending.slice(0, toDraft)) {
    // ERROR_BOUNDARY: a bad row becomes an honest failed row, never a crash or fake success.
    try {
      if (!canTransition(row.state, "draft_created")) {
        throw new Error(`invalid transition ${row.state} -> draft_created`);
      }
      const fileName = `${safeFileName(row.idempotencyKey)}.eml`;
      const filePath = path.join(resolvedDraftsDir, fileName);
      fs.writeFileSync(filePath, renderEml(row, { from, date: nowDate }), "utf8");
      updates.push({
        ...row,
        state: "draft_created",
        providerRef: fileName,
        providerLane: "gmail-draft-bootstrap",
        draftedAt: nowDate.toISOString(),
      });
      summary.drafted += 1;
    } catch (err) {
      // Failure is RECORDED at the moment the worker observes it (core contract:
      // no transition INTO `failed`) — the row was in-flight (pending_draft).
      updates.push({ ...row, state: "failed", error: String(err.message ?? err), failedAt: nowDate.toISOString() });
      summary.failed += 1;
    }
  }

  appendOutboxRows(resolvedOutbox, updates, { endsWithNewline });
  summary.pendingRemaining = pending.length - toDraft;
  return summary;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const summary = createDrafts({
      outboxPath: args.outbox,
      draftsDir: args["drafts-dir"],
      limit: args.limit,
      from: args.from,
    });
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
    process.stdout.write(
      "Next: import the .eml files as Gmail drafts, review them, then record decisions with\n" +
        "  node scripts/digest/preview-outbox.mjs --approve <key>\n" +
        "  node scripts/digest/preview-outbox.mjs --mark-sent <key> <gmail_msg_ref>\n"
    );
  } catch (err) {
    // HONEST_STATUS: cap refusals and IO failures exit 1 with the reason.
    process.stderr.write(`create-gmail-drafts: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
