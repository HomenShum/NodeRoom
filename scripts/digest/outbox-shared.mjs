/**
 * Always-On Rooms — digest outbox shared logic (bootstrap lane, plain node ESM).
 *
 * MIRROR PIN: OUTBOX_STATES, OUTBOX_TRANSITIONS/canTransition, and
 * buildIdempotencyKey are LOCAL MIRRORS of `convex/alwaysOnCore.ts` (Lane A).
 * Plain `node` cannot import the .ts core, so the tiny state-machine surface is
 * duplicated here. tests/digestRunner.test.ts imports BOTH modules via vitest
 * and fails if they ever drift. If you change one side, change the other.
 *
 * Everything else in this file (jsonl outbox IO, eml rendering helpers) is
 * bootstrap-runner-only and NOT part of the alwaysOnCore contract.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/* ── mirrored contract (pinned to convex/alwaysOnCore.ts) ────────────────── */

/** Mirror of alwaysOnCore.OUTBOX_STATES — order matters for the drift test. */
export const OUTBOX_STATES = [
  "pending_draft",
  "draft_created",
  "approved",
  "sent",
  "failed",
  "skipped",
];

/**
 * Mirror of the alwaysOnCore transition table (VALID_TRANSITIONS).
 * The human-review gate sits between draft_created and approved: nothing in
 * this repo may move a row to `approved` except an explicit human command
 * (preview-outbox.mjs --approve), and only `approved` rows may ever send.
 *
 * NOTE (matches the core exactly): there is NO transition INTO `failed`.
 * Per the core contract, failed rows are RECORDED at the moment a worker/human
 * observes the failure (an event, not a state-machine transition) — see
 * canRecordFailure below for the bootstrap-side recording guard. The only
 * transition touching `failed` is the retry exit: failed → pending_draft.
 */
export const OUTBOX_TRANSITIONS = {
  pending_draft: ["draft_created", "skipped"],
  draft_created: ["approved"],
  approved: ["sent"],
  failed: ["pending_draft"],
  sent: [],
  skipped: [],
};

/** Mirror of alwaysOnCore.canTransition(from, to). Unknown states → false. */
export function canTransition(from, to) {
  const allowed = Object.prototype.hasOwnProperty.call(OUTBOX_TRANSITIONS, from)
    ? OUTBOX_TRANSITIONS[from]
    : undefined;
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * LOCAL bootstrap policy — NOT part of the core mirror (the core has no
 * transition into `failed`; failure is recorded as an event by whoever
 * observed it). This guard says WHICH rows may have a failure recorded:
 * in-flight rows only. Terminal rows (sent, skipped) and already-failed rows
 * refuse, so a failure record can never un-send or double-fail a row.
 */
export function canRecordFailure(from) {
  return from === "pending_draft" || from === "draft_created" || from === "approved";
}

/**
 * Mirror of alwaysOnCore.buildIdempotencyKey({roomSlug, briefKey,
 * subscriptionId, cadence}) → "room:brief:subscriber:cadence".
 * A crash never double-sends because the key is stable across re-runs.
 * DETERMINISTIC: same format as the core for all valid parts. The throw on
 * ":"/whitespace parts is bootstrap-side hardening ON TOP of the core (the
 * core is only ever called with Convex-internal ids that cannot contain
 * either; this runner reads operator-supplied JSON, so it refuses instead).
 */
export function buildIdempotencyKey({ roomSlug, briefKey, subscriptionId, cadence }) {
  const parts = { roomSlug, briefKey, subscriptionId, cadence };
  for (const [name, value] of Object.entries(parts)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`buildIdempotencyKey: ${name} must be a non-empty string`);
    }
    if (/[:\s]/.test(value)) {
      throw new Error(`buildIdempotencyKey: ${name} must not contain ':' or whitespace (got ${JSON.stringify(value)})`);
    }
  }
  return [roomSlug, briefKey, subscriptionId, cadence].join(":");
}

/* ── bootstrap-runner-only helpers (not part of the core contract) ───────── */

/** BOUND: hard caps so agent loops can never grow unbounded local state. */
export const MAX_OUTBOX_BYTES = 5 * 1024 * 1024;
export const MAX_OUTBOX_LINES = 50_000;
export const MAX_SUBSCRIBERS = 1_000;
export const MAX_BRIEF_BYTES = 512 * 1024;
export const DAILY_DRAFT_CAP = 20;
export const DEFAULT_DRAFT_LIMIT = 10;

export const DEFAULT_OUTBOX_PATH = path.join("data", "digest", "outbox.jsonl");
export const DEFAULT_DRAFTS_DIR = path.join("data", "digest", "drafts");

/** Strip header-injection characters from any value that lands in an RFC-822 header. */
export function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n\0]+/g, " ").trim();
}

/** Conservative email shape check; rejects header-injection attempts outright. */
export function isValidEmail(email) {
  if (typeof email !== "string" || email.length === 0 || email.length > 254) return false;
  if (/[\r\n\0,;<>]/.test(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Load the append-only outbox journal.
 * - Last valid line per idempotencyKey wins (transitions append updated rows).
 * - Corrupt lines (crash-truncated writes) are counted and ignored, so a
 *   re-run converges instead of crashing (crash-replay safety).
 * - BOUND_READ: refuses files past MAX_OUTBOX_BYTES / MAX_OUTBOX_LINES.
 */
export function loadOutbox(outboxPath) {
  const rows = new Map();
  let corruptLines = 0;
  let endsWithNewline = true;
  if (!fs.existsSync(outboxPath)) {
    return { rows, corruptLines, endsWithNewline, exists: false };
  }
  const stat = fs.statSync(outboxPath);
  if (stat.size > MAX_OUTBOX_BYTES) {
    throw new Error(`outbox ${outboxPath} is ${stat.size} bytes (cap ${MAX_OUTBOX_BYTES}); compact it before continuing`);
  }
  const raw = fs.readFileSync(outboxPath, "utf8");
  endsWithNewline = raw.length === 0 || raw.endsWith("\n");
  const lines = raw.split(/\r?\n/);
  if (lines.length > MAX_OUTBOX_LINES) {
    throw new Error(`outbox ${outboxPath} has ${lines.length} lines (cap ${MAX_OUTBOX_LINES}); compact it before continuing`);
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      corruptLines += 1;
      continue;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.idempotencyKey !== "string" ||
      !OUTBOX_STATES.includes(parsed.state)
    ) {
      corruptLines += 1;
      continue;
    }
    rows.set(parsed.idempotencyKey, parsed);
  }
  return { rows, corruptLines, endsWithNewline, exists: true };
}

/**
 * Append rows to the journal. If a previous write crashed mid-line (file does
 * not end with "\n"), a newline is written first so the partial line stays an
 * isolated corrupt line instead of merging with the new row.
 */
export function appendOutboxRows(outboxPath, newRows, { endsWithNewline = true } = {}) {
  if (newRows.length === 0) return;
  fs.mkdirSync(path.dirname(outboxPath), { recursive: true });
  const prefix = fs.existsSync(outboxPath) && !endsWithNewline ? "\n" : "";
  const payload = prefix + newRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(outboxPath, payload, "utf8");
}

/** Filesystem-safe name for an idempotency key ("exp:b0704:s003:daily" → "exp_b0704_s003_daily"). */
export function safeFileName(key) {
  return String(key).replace(/[^A-Za-z0-9._-]/g, "_");
}

/** DETERMINISTIC MIME boundary derived from the idempotency key. */
export function mimeBoundary(idempotencyKey) {
  return "=_ao_" + crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 16);
}

/** UTC calendar day ("2026-07-04") for the ≤20-drafts-per-day budget. */
export function utcDay(isoString) {
  return String(isoString).slice(0, 10);
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (ch) => ESCAPES[ch]);
}

function inlineHtml(text) {
  // links first (on escaped text, so hrefs are also entity-escaped)
  return escapeHtml(text).replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/**
 * Tiny deterministic markdown → basic HTML for the .eml html part.
 * Supports headings, -/1. lists, links, paragraphs, hr. Nothing else — the
 * bootstrap lane keeps emails boring on purpose.
 */
export function markdownToBasicHtml(markdown) {
  const blocks = String(markdown).replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      html.push("<ul>" + lines.map((l) => `<li>${inlineHtml(l.replace(/^\s*[-*] /, ""))}</li>`).join("") + "</ul>");
      continue;
    }
    if (lines.every((l) => /^\s*\d+[.)] /.test(l))) {
      html.push("<ol>" + lines.map((l) => `<li>${inlineHtml(l.replace(/^\s*\d+[.)] /, ""))}</li>`).join("") + "</ol>");
      continue;
    }
    const out = [];
    for (const line of lines) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
      if (heading) {
        const level = Math.min(heading[1].length + 2, 6); // # → h3, ## → h4 … email-scale headings
        out.push(`<h${level}>${inlineHtml(heading[2])}</h${level}>`);
      } else if (/^-{3,}$/.test(line.trim())) {
        out.push("<hr />");
      } else {
        out.push(`<p>${inlineHtml(line.trim())}</p>`);
      }
    }
    html.push(out.join(""));
  }
  return html.join("\n");
}

/**
 * Digest email footer links — SAME template shape as
 * alwaysOnCore.renderDigestEmail(briefMeta, items, links): every digest carries
 * View room / Manage subscription / Unsubscribe.
 */
export function renderFooterLinks(links) {
  return [
    "---",
    "",
    `[View room](${links.view}) · [Manage subscription](${links.manage}) · [Unsubscribe](${links.unsubscribe})`,
    "",
    "every claim links to a source capture",
  ].join("\n");
}
