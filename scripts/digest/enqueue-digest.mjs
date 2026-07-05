/**
 * Always-On Rooms — digest bootstrap step 1: enqueue.
 *
 * Reads a rendered daily-brief markdown file + a subscribers JSON file and
 * appends one outbox row per ACTIVE subscriber to the local jsonl outbox
 * journal (default data/digest/outbox.jsonl, gitignored). Idempotent: rows
 * whose idempotency key already exists in the outbox are skipped, so re-runs
 * and crash-replays converge. Inactive subscribers are recorded as `skipped`
 * rows with an honest reason — the agent never silently drops a recipient.
 *
 * ZERO network. ZERO model calls. Deterministic v1.
 *
 * Usage:
 *   node scripts/digest/enqueue-digest.mjs \
 *     --room expositio-pulse \
 *     --brief data/digest/briefs/2026-07-04.md \
 *     --subscribers data/digest/subscribers.json \
 *     [--outbox data/digest/outbox.jsonl] \
 *     [--brief-key b0704] [--room-title "Expositio Pulse"] [--cadence daily]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  buildIdempotencyKey,
  loadOutbox,
  appendOutboxRows,
  isValidEmail,
  renderFooterLinks,
  DEFAULT_OUTBOX_PATH,
  MAX_SUBSCRIBERS,
  MAX_BRIEF_BYTES,
} from "./outbox-shared.mjs";

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith("--")) continue;
    args[flag.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** First markdown heading becomes the subject line; falls back to the brief key. */
export function deriveSubject(roomTitle, briefMarkdown, briefKey) {
  const headingMatch = /^#{1,6}\s+(.+)$/m.exec(briefMarkdown);
  const detail = headingMatch ? headingMatch[1].trim() : `daily brief · ${briefKey}`;
  return `${roomTitle} — ${detail}`;
}

/**
 * Placeholder links for the bootstrap lane. Production lane replaces these
 * with Convex-minted tokenized links (subscribeToRoom/confirm/unsubscribe).
 * NEVER embed token hashes here — subscription ids only.
 */
export function buildLinks(roomSlug, subscriptionId) {
  const base = `https://noderoom.live/#rooms/${roomSlug}`;
  return {
    view: base,
    manage: `${base}?manage=${subscriptionId}`,
    unsubscribe: `${base}?unsubscribe=${subscriptionId}`,
  };
}

/**
 * Core enqueue logic (exported for scenario tests).
 * Returns an honest summary; throws on refusals (bounds, bad input).
 */
export function enqueueDigest({ roomSlug, briefPath, subscribersPath, outboxPath, briefKey, roomTitle, cadence }) {
  if (!roomSlug) throw new Error("--room <slug> is required");
  if (!briefPath) throw new Error("--brief <path.md> is required");
  if (!subscribersPath) throw new Error("--subscribers <path.json> is required");
  const resolvedOutbox = outboxPath || DEFAULT_OUTBOX_PATH;
  const resolvedCadence = cadence || "daily";

  // BOUND_READ: brief size cap.
  const briefStat = fs.statSync(briefPath);
  if (briefStat.size > MAX_BRIEF_BYTES) {
    throw new Error(`brief ${briefPath} is ${briefStat.size} bytes (cap ${MAX_BRIEF_BYTES})`);
  }
  const briefMarkdown = fs.readFileSync(briefPath, "utf8");

  const resolvedBriefKey = (briefKey || path.basename(briefPath).replace(/\.[^.]*$/, "")).replace(/[:\s]/g, "-");
  const resolvedTitle = roomTitle || titleFromSlug(roomSlug);

  const subscribersRaw = fs.readFileSync(subscribersPath, "utf8");
  let subscribers;
  try {
    subscribers = JSON.parse(subscribersRaw);
  } catch (err) {
    throw new Error(`subscribers file ${subscribersPath} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(subscribers)) {
    throw new Error(`subscribers file ${subscribersPath} must be a JSON array`);
  }
  // BOUND: refuse unbounded fan-out instead of silently truncating.
  if (subscribers.length > MAX_SUBSCRIBERS) {
    throw new Error(`${subscribers.length} subscribers exceeds cap ${MAX_SUBSCRIBERS}; shard the run`);
  }

  const { rows: existing, corruptLines, endsWithNewline } = loadOutbox(resolvedOutbox);

  const subject = deriveSubject(resolvedTitle, briefMarkdown, resolvedBriefKey);
  const createdAt = new Date().toISOString();
  const newRows = [];
  const summary = { enqueued: 0, skipped: 0, alreadyQueued: 0, invalid: 0, corruptLinesIgnored: corruptLines };

  for (const sub of subscribers) {
    if (!sub || typeof sub !== "object" || typeof sub.id !== "string" || sub.id.length === 0) {
      summary.invalid += 1;
      continue;
    }
    let idempotencyKey;
    try {
      idempotencyKey = buildIdempotencyKey({
        roomSlug,
        briefKey: resolvedBriefKey,
        subscriptionId: sub.id,
        cadence: resolvedCadence,
      });
    } catch {
      summary.invalid += 1;
      continue;
    }
    if (existing.has(idempotencyKey)) {
      summary.alreadyQueued += 1;
      continue;
    }
    const base = {
      idempotencyKey,
      roomSlug,
      briefKey: resolvedBriefKey,
      cadence: resolvedCadence,
      createdAt,
    };
    if (sub.status !== "active") {
      newRows.push({ ...base, to: typeof sub.email === "string" ? sub.email : "(no email)", state: "skipped", reason: `subscriber_not_active:${sub.status ?? "unknown"}` });
      summary.skipped += 1;
      continue;
    }
    if (!isValidEmail(sub.email)) {
      newRows.push({ ...base, to: "(invalid email redacted)", state: "skipped", reason: "invalid_email" });
      summary.skipped += 1;
      continue;
    }
    const links = buildLinks(roomSlug, sub.id);
    newRows.push({
      ...base,
      to: sub.email,
      state: "pending_draft",
      subject,
      markdownBody: `${briefMarkdown.trimEnd()}\n\n${renderFooterLinks(links)}\n`,
      links,
      retryCount: 0,
    });
    summary.enqueued += 1;
  }

  appendOutboxRows(resolvedOutbox, newRows, { endsWithNewline });
  return { ...summary, outbox: resolvedOutbox, briefKey: resolvedBriefKey, subject };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const summary = enqueueDigest({
      roomSlug: args.room,
      briefPath: args.brief,
      subscribersPath: args.subscribers,
      outboxPath: args.outbox,
      briefKey: args["brief-key"],
      roomTitle: args["room-title"],
      cadence: args.cadence,
    });
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } catch (err) {
    // HONEST_STATUS: refusals exit non-zero with the reason, never a fake success.
    process.stderr.write(`enqueue-digest: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
