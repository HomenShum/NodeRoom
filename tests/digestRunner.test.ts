/**
 * Always-On Rooms — digest bootstrap runner scenario suite (Lane D).
 *
 * Persona: the room owner of "Expositio Pulse" runs the deterministic digest
 * bootstrap by hand each morning: enqueue → Gmail drafts → human approve →
 * mark sent. These tests simulate that operator end to end, plus the failure
 * modes that matter for an agent-adjacent email pipeline: crash-truncated
 * journals, header injection, cap overruns, out-of-order state transitions,
 * and journal accumulation over weeks of runs.
 *
 * Drift gate: scripts/digest/outbox-shared.mjs mirrors the state machine of
 * convex/alwaysOnCore.ts (Lane A). The last describe block imports BOTH and
 * fails if they diverge — ACTIVE now that the core has landed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OUTBOX_STATES,
  OUTBOX_TRANSITIONS,
  canTransition,
  canRecordFailure,
  buildIdempotencyKey,
  loadOutbox,
  MAX_SUBSCRIBERS,
  DAILY_DRAFT_CAP,
  type OutboxRow,
} from "../scripts/digest/outbox-shared.mjs";
import { enqueueDigest } from "../scripts/digest/enqueue-digest.mjs";
import { createDrafts } from "../scripts/digest/create-gmail-drafts.mjs";
import { applyTransition, recordFailure, formatOutboxTable } from "../scripts/digest/preview-outbox.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SCRIPTS = path.join(ROOT, "scripts", "digest");
const CORE_PATH = path.join(ROOT, "convex", "alwaysOnCore.ts");
const coreExists = fs.existsSync(CORE_PATH);

const BRIEF_MD = [
  "# 4 new papers, 2 growing clusters, 2 open questions",
  "",
  "Daily brief · Friday, July 4",
  "",
  "## What changed",
  "",
  "- 4 new papers detected across mathematics, physics, and CS.",
  "- The ML interpretability cluster grew for a third straight week.",
  "",
  "## Top new papers",
  "",
  "1. [Spectral sequences without tears](https://expositio.org/papers/2841) — algebraic topology, graduate.",
  "2. [What attention heads actually compute](https://expositio.org/papers/2843) — ML interpretability, intermediate.",
].join("\n");

type Subscriber = { id: string; email: string; status: string };

const SUBSCRIBERS: Subscriber[] = [
  { id: "s003", email: "researcher@stanford.edu", status: "active" },
  { id: "s011", email: "k.tanaka@riken.jp", status: "active" },
  { id: "s017", email: "msmith@princeton.edu", status: "active" },
  { id: "s024", email: "pending-user@ens.fr", status: "pending" },
  { id: "s025", email: "gone@gmail.com", status: "unsubscribed" },
  // adversarial: SMTP header injection attempt in the email address
  { id: "s026", email: "evil@x.com\r\nBcc: spam@spam.example", status: "active" },
];

let tmp: string;
let outboxPath: string;
let draftsDir: string;
let briefPath: string;
let subscribersPath: string;

function writeFixtures(subscribers: Subscriber[] = SUBSCRIBERS, brief: string = BRIEF_MD) {
  fs.writeFileSync(briefPath, brief, "utf8");
  fs.writeFileSync(subscribersPath, JSON.stringify(subscribers, null, 2), "utf8");
}

function enqueueOnce() {
  return enqueueDigest({
    roomSlug: "expositio-pulse",
    briefPath,
    subscribersPath,
    outboxPath,
    briefKey: "b0704",
    roomTitle: "Expositio Pulse",
    cadence: "daily",
  });
}

function rowsByKey(): Map<string, OutboxRow> {
  return loadOutbox(outboxPath).rows;
}

function runCli(script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ao-digest-"));
  outboxPath = path.join(tmp, "outbox.jsonl");
  draftsDir = path.join(tmp, "drafts");
  briefPath = path.join(tmp, "brief-2026-07-04.md");
  subscribersPath = path.join(tmp, "subscribers.json");
  writeFixtures();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/* ── scenario: fresh morning run ─────────────────────────────────────────── */

describe("enqueue — owner runs the first digest of the day", () => {
  it("enqueues one pending_draft row per active subscriber and skips the rest with reasons", () => {
    const summary = enqueueOnce();
    expect(summary.enqueued).toBe(3);
    expect(summary.skipped).toBe(3); // pending + unsubscribed + header-injection email

    const rows = rowsByKey();
    expect(rows.size).toBe(6);

    const active = rows.get("expositio-pulse:b0704:s003:daily");
    expect(active?.state).toBe("pending_draft");
    expect(active?.to).toBe("researcher@stanford.edu");
    expect(active?.subject).toBe("Expositio Pulse — 4 new papers, 2 growing clusters, 2 open questions");
    expect(active?.markdownBody).toContain("What changed");
    expect(active?.markdownBody).toContain("[Unsubscribe](https://noderoom.live/#rooms/expositio-pulse?unsubscribe=s003)");

    expect(rows.get("expositio-pulse:b0704:s024:daily")?.state).toBe("skipped");
    expect(rows.get("expositio-pulse:b0704:s024:daily")?.reason).toBe("subscriber_not_active:pending");
    expect(rows.get("expositio-pulse:b0704:s025:daily")?.reason).toBe("subscriber_not_active:unsubscribed");
  });

  it("refuses the header-injection email as invalid and never persists the raw injected value", () => {
    enqueueOnce();
    const injected = rowsByKey().get("expositio-pulse:b0704:s026:daily");
    expect(injected?.state).toBe("skipped");
    expect(injected?.reason).toBe("invalid_email");
    const raw = fs.readFileSync(outboxPath, "utf8");
    expect(raw).not.toContain("spam@spam.example");
  });

  it("is idempotent: an immediate re-run enqueues zero duplicates", () => {
    enqueueOnce();
    const before = fs.readFileSync(outboxPath, "utf8");
    const second = enqueueOnce();
    expect(second.enqueued).toBe(0);
    expect(second.skipped).toBe(0);
    expect(second.alreadyQueued).toBe(6);
    expect(fs.readFileSync(outboxPath, "utf8")).toBe(before);
  });

  it("counts subscribers with contract-breaking ids as invalid instead of crashing", () => {
    writeFixtures([...SUBSCRIBERS, { id: "s:bad colon", email: "ok@ok.org", status: "active" }]);
    const summary = enqueueOnce();
    expect(summary.invalid).toBe(1);
    expect(summary.enqueued).toBe(3);
  });

  it("BOUND: refuses a subscriber list past the fan-out cap instead of truncating silently", () => {
    const flood: Subscriber[] = Array.from({ length: MAX_SUBSCRIBERS + 1 }, (_, i) => ({
      id: `s${String(i).padStart(5, "0")}`,
      email: `user${i}@example.org`,
      status: "active",
    }));
    writeFixtures(flood);
    expect(() => enqueueOnce()).toThrow(/exceeds cap/);
  });
});

/* ── scenario: drafts for human review ───────────────────────────────────── */

describe("create-gmail-drafts — agent writes copy, human reviews", () => {
  it("transitions pending rows to draft_created and writes reviewable .eml files", () => {
    enqueueOnce();
    const summary = createDrafts({ outboxPath, draftsDir });
    expect(summary.drafted).toBe(3);
    expect(summary.failed).toBe(0);

    const rows = rowsByKey();
    const row = rows.get("expositio-pulse:b0704:s003:daily");
    expect(row?.state).toBe("draft_created");
    expect(row?.providerRef).toBe("expositio-pulse_b0704_s003_daily.eml");
    expect(row?.providerLane).toBe("gmail-draft-bootstrap");

    const eml = fs.readFileSync(path.join(draftsDir, "expositio-pulse_b0704_s003_daily.eml"), "utf8");
    expect(eml).toContain("Subject: Expositio Pulse — 4 new papers, 2 growing clusters, 2 open questions");
    expect(eml).toContain("To: researcher@stanford.edu");
    expect(eml).toContain("List-Unsubscribe: <https://noderoom.live/#rooms/expositio-pulse?unsubscribe=s003>");
    expect(eml).toContain("Content-Type: text/plain; charset=utf-8");
    expect(eml).toContain("Content-Type: text/html; charset=utf-8");
    expect(eml).toContain("<h3>4 new papers, 2 growing clusters, 2 open questions</h3>");
    // RFC-822 header block uses CRLF
    expect(eml.split("\r\n")[0]).toMatch(/^From: /);
    // skipped rows are untouched
    expect(rows.get("expositio-pulse:b0704:s025:daily")?.state).toBe("skipped");
  });

  it("HONEST_STATUS: refuses --limit past the 20/day hard cap (the 21st draft never happens)", () => {
    enqueueOnce();
    expect(() => createDrafts({ outboxPath, draftsDir, limit: 21 })).toThrow(/hard cap of 20/);
    const cli = runCli("create-gmail-drafts.mjs", ["--outbox", outboxPath, "--drafts-dir", draftsDir, "--limit", "21"]);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("hard cap of 20");
    // nothing was drafted
    expect(fs.existsSync(draftsDir)).toBe(false);
    for (const row of rowsByKey().values()) {
      expect(row.state === "draft_created").toBe(false);
    }
  });

  it("enforces the ≤20 drafts per UTC day budget across invocations", () => {
    // 20 drafts already created today (sustained-load state accumulation)…
    const today = new Date().toISOString();
    const spent: OutboxRow[] = Array.from({ length: DAILY_DRAFT_CAP }, (_, i) => ({
      idempotencyKey: `expositio-pulse:b0704:spent${i}:daily`,
      state: "draft_created",
      draftedAt: today,
    }));
    fs.writeFileSync(outboxPath, spent.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    enqueueOnce();
    // …so drafting even one more is refused with the honest reason.
    expect(() => createDrafts({ outboxPath, draftsDir, limit: 1 })).toThrow(/daily budget/);
  });
});

/* ── scenario: the human gate + full lifecycle ───────────────────────────── */

describe("preview-outbox — human decisions move the state machine", () => {
  it("walks a row draft_created → approved → sent through the CLI", () => {
    enqueueOnce();
    createDrafts({ outboxPath, draftsDir });
    const key = "expositio-pulse:b0704:s003:daily";

    const approve = runCli("preview-outbox.mjs", ["--outbox", outboxPath, "--approve", key]);
    expect(approve.status).toBe(0);
    expect(rowsByKey().get(key)?.state).toBe("approved");

    const sent = runCli("preview-outbox.mjs", ["--outbox", outboxPath, "--mark-sent", key, "gmail_msg 18c4f2"]);
    expect(sent.status).toBe(0);
    const row = rowsByKey().get(key);
    expect(row?.state).toBe("sent");
    expect(row?.sentRef).toBe("gmail_msg 18c4f2");
  });

  it("rejects the illegal pending_draft → sent shortcut with exit 1 and the reason", () => {
    enqueueOnce();
    const key = "expositio-pulse:b0704:s003:daily";
    const cli = runCli("preview-outbox.mjs", ["--outbox", outboxPath, "--mark-sent", key, "gmail_msg x"]);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("invalid transition pending_draft -> sent");
    expect(rowsByKey().get(key)?.state).toBe("pending_draft");
  });

  it("rejects approving a row before its draft exists (the gate order is the contract)", () => {
    enqueueOnce();
    expect(() =>
      applyTransition({ outboxPath, key: "expositio-pulse:b0704:s003:daily", to: "approved" })
    ).toThrow(/invalid transition pending_draft -> approved/);
  });

  it("allows exactly one retry after a recorded failure, then caps", () => {
    enqueueOnce();
    createDrafts({ outboxPath, draftsDir });
    const key = "expositio-pulse:b0704:s011:daily";
    recordFailure({ outboxPath, key, reason: "gmail import rejected" });
    const retried = applyTransition({ outboxPath, key, to: "pending_draft" });
    expect(retried.retryCount).toBe(1);
    recordFailure({ outboxPath, key, reason: "rejected again" });
    expect(() => applyTransition({ outboxPath, key, to: "pending_draft" })).toThrow(/1 retry then capped/);
  });

  it("failure is a recorded event, never a transition: terminal rows refuse --mark-failed", () => {
    enqueueOnce();
    createDrafts({ outboxPath, draftsDir });
    const key = "expositio-pulse:b0704:s003:daily";
    applyTransition({ outboxPath, key, to: "approved" });
    applyTransition({ outboxPath, key, to: "sent", extra: { sentRef: "gmail_msg 18c4f2" } });

    // core contract: canTransition never allows *→failed — recordFailure is the only path
    expect(() => applyTransition({ outboxPath, key: "expositio-pulse:b0704:s011:daily", to: "failed" })).toThrow(
      /invalid transition draft_created -> failed/
    );

    // a sent row can never be failure-recorded (would un-send the receipt)
    const cli = runCli("preview-outbox.mjs", ["--outbox", outboxPath, "--mark-failed", key, "oops"]);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("cannot record failure on a sent row");
    expect(rowsByKey().get(key)?.state).toBe("sent");

    // a skipped row (inactive subscriber) is terminal too
    expect(() => recordFailure({ outboxPath, key: "expositio-pulse:b0704:s025:daily", reason: "x" })).toThrow(
      /cannot record failure on a skipped row/
    );
  });
});

/* ── scenario: crash mid-write, operator re-runs ─────────────────────────── */

describe("crash-replay — truncated journal converges on re-run", () => {
  it("ignores the torn last line, re-enqueues its row, and a third run is a no-op", () => {
    enqueueOnce();
    // simulate a crash mid-append: the last row loses its tail (no trailing \n)
    const raw = fs.readFileSync(outboxPath, "utf8");
    fs.writeFileSync(outboxPath, raw.slice(0, raw.length - 25), "utf8");

    const replay = enqueueOnce();
    expect(replay.corruptLinesIgnored).toBe(1);
    expect(replay.enqueued + replay.skipped).toBe(1); // exactly the torn row comes back
    expect(replay.alreadyQueued).toBe(5);

    const { rows, corruptLines } = loadOutbox(outboxPath);
    expect(rows.size).toBe(6);
    expect(corruptLines).toBe(1); // torn line stays isolated on its own line

    const third = enqueueOnce();
    expect(third.enqueued).toBe(0);
    expect(third.alreadyQueued).toBe(6);
  });
});

/* ── scenario: weeks of sustained use ────────────────────────────────────── */

describe("long-running journal — accumulation stays bounded and readable", () => {
  it("last-write-wins over hundreds of appended transitions; preview output stays bounded", () => {
    const many: Subscriber[] = Array.from({ length: 300 }, (_, i) => ({
      id: `s${String(i).padStart(4, "0")}`,
      email: `user${i}@example.org`,
      status: "active",
    }));
    writeFixtures(many);
    const summary = enqueueOnce();
    expect(summary.enqueued).toBe(300);

    // a week of partial drafting runs (10/day within the cap, dated per-day)
    for (let day = 0; day < 5; day += 1) {
      const now = new Date(Date.UTC(2026, 6, 6 + day, 9, 0, 0));
      const s = createDrafts({ outboxPath, draftsDir, limit: 10, now });
      expect(s.drafted).toBe(10);
    }

    const { rows } = loadOutbox(outboxPath);
    expect(rows.size).toBe(300);
    expect([...rows.values()].filter((r) => r.state === "draft_created").length).toBe(50);
    expect([...rows.values()].filter((r) => r.state === "pending_draft").length).toBe(250);

    const table = formatOutboxTable(outboxPath);
    expect(table.split("\n").length).toBeLessThan(60); // BOUND: 50 rows + header + more-rows line
    expect(table).toContain("more rows");
    expect(table).toContain("pending_draft=250");
  });
});

/* ── drift gate vs convex/alwaysOnCore.ts (Lane A) ───────────────────────── */

describe("outbox-shared.mjs mirrors convex/alwaysOnCore.ts", () => {
  // Lane A's convex/alwaysOnCore.ts has landed, so this drift gate is ACTIVE
  // (it already caught one real drift: the mirror allowed *→failed transitions
  // the core does not have; the mirror was reconciled to the core). The
  // coreExists guard only remains so a partial checkout that lacks the core
  // skips instead of erroring on import.
  (coreExists ? it : it.skip)("state names, transition table, and idempotency key format match", () => {
    const probe = [
      `const core = await import(${JSON.stringify(String(new URL("file:///" + CORE_PATH.replace(/\\/g, "/"))))});`,
      "const table = {};",
      "const states = core.OUTBOX_STATES;",
      "for (const from of [...states, '__unknown__']) {",
      "  table[from] = {};",
      "  for (const to of [...states, '__unknown__']) table[from][to] = core.canTransition(from, to);",
      "}",
      "const sampleKey = core.buildIdempotencyKey({ roomSlug: 'expositio-pulse', briefKey: 'b0704', subscriptionId: 's003', cadence: 'daily' });",
      "console.log(JSON.stringify({ states, table, sampleKey }));",
    ].join("\n");
    const probePath = path.join(tmp, "core-probe.mjs");
    fs.writeFileSync(probePath, probe, "utf8");
    const out = execFileSync(
      process.execPath,
      ["--import", "./node_modules/tsx/dist/loader.mjs", probePath],
      { cwd: ROOT, encoding: "utf8" }
    );
    const core = JSON.parse(out.trim().split("\n").pop() as string) as {
      states: string[];
      table: Record<string, Record<string, boolean>>;
      sampleKey: string;
    };

    expect(core.states).toEqual(OUTBOX_STATES);
    expect(core.sampleKey).toBe(
      buildIdempotencyKey({ roomSlug: "expositio-pulse", briefKey: "b0704", subscriptionId: "s003", cadence: "daily" })
    );
    for (const from of [...OUTBOX_STATES, "__unknown__"]) {
      for (const to of [...OUTBOX_STATES, "__unknown__"]) {
        expect(
          { from, to, allowed: core.table[from]?.[to] },
        ).toEqual({ from, to, allowed: canTransition(from, to) });
      }
    }
  });

  it("mirror self-consistency: transition table only references known states", () => {
    expect(Object.keys(OUTBOX_TRANSITIONS).sort()).toEqual([...OUTBOX_STATES].sort());
    for (const targets of Object.values(OUTBOX_TRANSITIONS)) {
      for (const target of targets) expect(OUTBOX_STATES).toContain(target);
    }
    // terminal states really are terminal
    expect(OUTBOX_TRANSITIONS.sent).toEqual([]);
    expect(OUTBOX_TRANSITIONS.skipped).toEqual([]);
    // the human gate: nothing reaches `sent` except from `approved`
    for (const from of OUTBOX_STATES) {
      if (from !== "approved") expect(canTransition(from, "sent")).toBe(false);
    }
    // core contract: NO transition into `failed` — failure is recorded, not transitioned
    for (const from of OUTBOX_STATES) {
      expect(canTransition(from, "failed")).toBe(false);
    }
    // …and only in-flight rows may have a failure recorded
    expect(OUTBOX_STATES.filter(canRecordFailure)).toEqual(["pending_draft", "draft_created", "approved"]);
    // the only exit from `failed` is the retry back to pending_draft
    expect(OUTBOX_TRANSITIONS.failed).toEqual(["pending_draft"]);
    // prototype-key probes never leak Object.prototype members as transitions
    expect(canTransition("constructor", "sent")).toBe(false);
    expect(canTransition("__proto__", "pending_draft")).toBe(false);
  });
});
