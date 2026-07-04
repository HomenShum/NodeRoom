/**
 * Chat-at-scale pure helpers (src/ui/Chat.tsx): day dividers, agent-run collapse,
 * jump-to-latest threshold.
 *
 * Scenario: the scale parity room — Priya (VC platform lead) opens a room whose public chat
 * carries the 312-message demo seed (roomStore.seedScaleMessages: 2 openers + 309 workflow
 * lines + 1 agent summary) while Homen (host) fires @nodeagent enrichment runs whose messages
 * carry run-scoped clientMsgIds (`pubstream-<jobId>` convex/streaming.ts, `final-<runId>` /
 * `plan-blocked-<jobId>` convex/agent.ts). The feed must stay readable: one quiet divider per
 * local day, finished long runs folded to one line, and everything O(n) so a week of chat
 * doesn't cost quadratic re-renders.
 *
 * All timestamps use LOCAL Date constructors so the day-boundary assertions hold in any
 * timezone (the dividers split on local midnight, which is what a reader perceives).
 */
import { describe, it, expect, vi } from "vitest";
import {
  agentRunIdFor,
  chatDayLabel,
  groupAgentRuns,
  groupMessagesByDay,
  runCollapsedByDefault,
  shouldShowJumpToLatest,
} from "../src/ui/Chat";

type Row = { key: string; createdAt: number };
const at = (y: number, mo: number, d: number, h = 12, mi = 0, s = 0, ms = 0) =>
  new Date(y, mo, d, h, mi, s, ms).getTime();
const row = (key: string, createdAt: number): Row => ({ key, createdAt });

/** Feed-item shape Chat.tsx feeds into the helpers (message rows + the run-id accessors). */
type FeedRow = Row & { message: { author: { kind: string }; clientMsgId?: string; text: string } };
const msg = (key: string, createdAt: number, authorKind: string, clientMsgId: string, text = key): FeedRow => ({
  key,
  createdAt,
  message: { author: { kind: authorKind }, clientMsgId, text },
});
const runIdOf = (r: FeedRow) => agentRunIdFor(r.message);
const isAgent = (r: FeedRow) => r.message.author.kind === "agent";

const dividers = (rows: Array<{ kind: string; label?: string }>): string[] =>
  rows.filter((r) => r.kind === "day").map((r) => r.label ?? "");

// The fixed "reading moment": Priya opens the room Sat Jul 4 2026, 14:00 local.
const NOW = at(2026, 6, 4, 14, 0);

describe("day dividers — Priya reads a week of scale-room chat", () => {
  it("labels Today / Yesterday / same-year dates / prior-year dates", () => {
    expect(chatDayLabel(at(2026, 6, 4, 0, 0, 0, 1), NOW)).toBe("Today");
    expect(chatDayLabel(at(2026, 6, 3, 23, 59), NOW)).toBe("Yesterday");
    expect(chatDayLabel(at(2026, 5, 30, 9, 0), NOW)).toBe("Jun 30");
    expect(chatDayLabel(at(2025, 11, 31, 9, 0), NOW)).toBe("Dec 31, 2025");
  });

  it("splits a week of messages into one divider per local day, in feed order", () => {
    const rows = [
      row("m1", at(2025, 11, 31, 9, 0)), // year boundary: last message of 2025
      row("m2", at(2026, 5, 30, 8, 0)), // month boundary: Jun 30 ...
      row("m3", at(2026, 5, 30, 17, 0)),
      row("m4", at(2026, 6, 1, 9, 0)), // ... to Jul 1
      row("m5", at(2026, 6, 3, 9, 0)), // yesterday
      row("m6", at(2026, 6, 4, 9, 0)), // today
    ];
    const grouped = groupMessagesByDay(rows, NOW);
    expect(dividers(grouped)).toEqual(["Dec 31, 2025", "Jun 30", "Jul 1", "Yesterday", "Today"]);
    // Message order is untouched and every message survives grouping.
    expect(grouped.filter((r) => r.kind === "row").map((r) => (r.kind === "row" ? r.key : ""))).toEqual([
      "m1", "m2", "m3", "m4", "m5", "m6",
    ]);
    // The month-boundary pair (m3 late Jun 30, m4 early Jul 1) sits under different dividers.
    const keys = grouped.map((r) => r.key);
    expect(keys.indexOf("m3")).toBeLessThan(keys.indexOf(`day-${at(2026, 6, 1, 0, 0)}`));
  });

  it("midnight edge: 23:59:59.999 and 00:00:00.000 one millisecond apart land on different days", () => {
    const grouped = groupMessagesByDay(
      [row("before", at(2026, 6, 2, 23, 59, 59, 999)), row("after", at(2026, 6, 3, 0, 0, 0, 0))],
      NOW,
    );
    expect(dividers(grouped)).toEqual(["Jul 2", "Yesterday"]);
  });

  it("same local day stays one group even when messages are 23h apart", () => {
    const grouped = groupMessagesByDay([row("dawn", at(2026, 6, 4, 0, 30)), row("dusk", at(2026, 6, 4, 23, 30))], NOW);
    expect(dividers(grouped)).toEqual(["Today"]);
    expect(grouped).toHaveLength(3); // 1 divider + 2 messages
  });

  it("adversarial: a future timestamp (optimistic-row clock skew) reads as Today, never a phantom date", () => {
    expect(chatDayLabel(NOW + 3 * 86_400_000, NOW)).toBe("Today");
  });

  it("empty feed produces no rows", () => {
    expect(groupMessagesByDay([], NOW)).toEqual([]);
  });
});

describe("agent-run collapse — Homen's @nodeagent jobs fold to one line", () => {
  it("extracts the run id from the runner's clientMsgId lanes and from nowhere else", () => {
    expect(agentRunIdFor({ author: { kind: "agent" }, clientMsgId: "pubstream-job42" })).toBe("job42");
    expect(agentRunIdFor({ author: { kind: "agent" }, clientMsgId: "final-run9" })).toBe("run9");
    expect(agentRunIdFor({ author: { kind: "agent" }, clientMsgId: "plan-blocked-job42" })).toBe("job42");
    expect(agentRunIdFor({ author: { kind: "agent" }, clientMsgId: "privstream-s7" })).toBe("s7");
    // Human sends mint crypto.randomUUID() ids — never a run.
    expect(agentRunIdFor({ author: { kind: "user" }, clientMsgId: "9d2f6c3a-1111-4222-8333-444455556666" })).toBeNull();
    // Adversarial: a user message spoofing the prefix must NOT join (or split) an agent run.
    expect(agentRunIdFor({ author: { kind: "user" }, clientMsgId: "pubstream-job42" })).toBeNull();
    expect(agentRunIdFor({ author: { kind: "agent" }, clientMsgId: undefined })).toBeNull();
  });

  it("happy path: one job's stream + final messages group into a single run row, in order", () => {
    const rows = [
      msg("u1", 1, "user", "uuid-user-1", "@nodeagent enrich batch 1"),
      msg("a1", 2, "agent", "pubstream-job7"),
      msg("a2", 3, "agent", "final-job7"),
      msg("u2", 4, "user", "uuid-user-2"),
    ];
    const grouped = groupAgentRuns(rows, runIdOf, isAgent);
    expect(grouped.map((g) => g.kind)).toEqual(["loose", "run", "loose"]);
    const run = grouped[1];
    if (run.kind !== "run") throw new Error("expected run");
    expect(run.runId).toBe("job7");
    expect(run.rows.map((r) => r.key)).toEqual(["a1", "a2"]);
    expect(run.createdAt).toBe(2); // the run sits at its first message for day-divider placement
  });

  it("absorbs the runner's uuid `say` posts only when the same run id resumes after them", () => {
    // pubstream → two say() posts (random uuids) → final of the SAME job: one 4-message run.
    const sandwiched = groupAgentRuns(
      [
        msg("a1", 1, "agent", "pubstream-job9"),
        msg("a2", 2, "agent", "uuid-say-1"),
        msg("a3", 3, "agent", "uuid-say-2"),
        msg("a4", 4, "agent", "final-job9"),
      ],
      runIdOf,
      isAgent,
    );
    expect(sandwiched.map((g) => g.kind)).toEqual(["run"]);
    expect(sandwiched[0].kind === "run" && sandwiched[0].rows.map((r) => r.key)).toEqual(["a1", "a2", "a3", "a4"]);
    // Trailing chatter after the final row is NOT provably part of the run — it stays loose.
    const trailing = groupAgentRuns(
      [msg("a1", 1, "agent", "final-job9"), msg("a2", 2, "agent", "uuid-say-1")],
      runIdOf,
      isAgent,
    );
    expect(trailing.map((g) => g.kind)).toEqual(["run", "loose"]);
  });

  it("interleaved authors: a human reply is never swallowed and splits the run", () => {
    const grouped = groupAgentRuns(
      [
        msg("a1", 1, "agent", "pubstream-job7"),
        msg("u1", 2, "user", "uuid-user", "hold on — wrong batch"),
        msg("a2", 3, "agent", "final-job7"),
      ],
      runIdOf,
      isAgent,
    );
    expect(grouped.map((g) => g.kind)).toEqual(["run", "loose", "run"]);
    expect(grouped.map((g) => (g.kind === "loose" ? g.row.key : g.rows[0].key))).toEqual(["a1", "u1", "a2"]);
    // The two fragments of job7 get distinct React keys.
    const runKeys = grouped.filter((g) => g.kind === "run").map((g) => g.key);
    expect(new Set(runKeys).size).toBe(2);
  });

  it("adjacent DIFFERENT runs never merge, and a user message between runs keeps buffered chatter loose", () => {
    const grouped = groupAgentRuns(
      [
        msg("a1", 1, "agent", "pubstream-jobA"),
        msg("a2", 2, "agent", "uuid-say-1"), // buffered against jobA...
        msg("b1", 3, "agent", "pubstream-jobB"), // ...but jobB shows up: chatter stays loose
        msg("b2", 4, "agent", "final-jobB"),
      ],
      runIdOf,
      isAgent,
    );
    expect(grouped.map((g) => (g.kind === "run" ? `run:${g.runId}` : `loose:${g.row.key}`))).toEqual([
      "run:jobA",
      "loose:a2",
      "run:jobB",
    ]);
    expect(grouped[2].kind === "run" && grouped[2].rows.map((r) => r.key)).toEqual(["b1", "b2"]);
  });

  it("collapse defaults: only a FINISHED run longer than 3 messages starts folded; live runs stay open", () => {
    expect(runCollapsedByDefault(4, true)).toBe(true); // finished + long → one summary line
    expect(runCollapsedByDefault(4, false)).toBe(false); // LIVE run must stay expanded
    expect(runCollapsedByDefault(3, true)).toBe(false); // boundary: 3 messages stay visible
    expect(runCollapsedByDefault(1, true)).toBe(false);
    expect(runCollapsedByDefault(0, true)).toBe(false);
  });
});

describe("jump-to-latest threshold — Priya scrolls back through history", () => {
  it("shows only when the reader is ≥2 viewports above the newest message", () => {
    expect(shouldShowJumpToLatest(1200, 600)).toBe(true); // exactly 2 viewports
    expect(shouldShowJumpToLatest(1199, 600)).toBe(false); // just under
    expect(shouldShowJumpToLatest(79, 600)).toBe(false); // near-bottom reading position
    expect(shouldShowJumpToLatest(5000, 600)).toBe(true);
  });

  it("degenerate viewport (hidden/zero-height feed) never shows the chip", () => {
    expect(shouldShowJumpToLatest(1200, 0)).toBe(false);
  });
});

describe("312-message scale seed — the full pipeline stays O(n)", () => {
  /** Mirror roomStore.seedScaleMessages: 2 openers + 309 rotating workflow lines + 1 agent
   *  summary (uuid clientMsgIds throughout — the memory engine never mints run prefixes),
   *  spread across three local days so dividers land mid-feed. */
  const buildScaleSeed = (): FeedRow[] => {
    const rows: FeedRow[] = [
      msg("msg-scale-seed-priya", at(2026, 6, 2, 9, 0), "user", "scale-seed-priya", "Scale room is open"),
      msg("msg-scale-seed-host", at(2026, 6, 2, 9, 1), "user", "scale-seed-host", "@nodeagent enrich the first batch"),
    ];
    const authors = ["user", "user", "user", "user"];
    for (let i = 0; i < 309; i += 1) {
      const day = i < 100 ? 2 : i < 220 ? 3 : 4; // Jul 2 → Jul 3 → Jul 4
      rows.push(msg(`msg-scale-thread-${i + 1}`, at(2026, 6, day, 10, 0, i), authors[i % 4], `scale-thread-${i + 1}`, `line ${i + 1}`));
    }
    rows.push(msg("msg-scale-agent-research-summary", at(2026, 6, 4, 12, 0), "agent", "scale-agent-research-summary", "Researched 40 companies"));
    return rows;
  };

  it("groups 312 seeded messages into 3 day slices with every message kept in order", () => {
    const seed = buildScaleSeed();
    expect(seed).toHaveLength(312);
    const runIdSpy = vi.fn(runIdOf);
    const grouped = groupMessagesByDay(groupAgentRuns(seed, runIdSpy, isAgent), NOW);
    // Single pass over the input: exactly one run-id probe per message (O(n) proof, not wall-clock).
    expect(runIdSpy).toHaveBeenCalledTimes(312);
    expect(dividers(grouped)).toEqual(["Jul 2", "Yesterday", "Today"]); // Jul 3 reads as Yesterday from the Jul 4 reading moment
    // No seed message carries a run prefix ("scale-agent-research-summary" is uuid-lane), so
    // nothing collapses: 312 rows + 3 dividers.
    expect(grouped).toHaveLength(315);
    const messageRows = grouped.filter((r) => r.kind === "row");
    expect(messageRows[0].kind === "row" && messageRows[0].key).toBe("msg-scale-seed-priya");
    expect(messageRows.at(-1)?.key).toBe("msg-scale-agent-research-summary");
  });

  it("sustained load: a quarter of chat (10k messages + 40 finished agent runs) grinds through one linear pass", () => {
    const rows: FeedRow[] = [];
    for (let day = 0; day < 90; day += 1) {
      for (let i = 0; i < 111; i += 1) {
        rows.push(msg(`m-${day}-${i}`, at(2026, 3, 1 + day, 9, 0, i), "user", `uuid-${day}-${i}`, "standup line"));
      }
      if (day % 2 === 0 && day < 80) {
        // A finished enrichment run: stream + 2 says + final = 4 messages → collapses by default.
        rows.push(msg(`run-${day}-s`, at(2026, 3, 1 + day, 10, 0), "agent", `pubstream-job${day}`));
        rows.push(msg(`run-${day}-t1`, at(2026, 3, 1 + day, 10, 1), "agent", `uuid-say-${day}-1`));
        rows.push(msg(`run-${day}-t2`, at(2026, 3, 1 + day, 10, 2), "agent", `uuid-say-${day}-2`));
        rows.push(msg(`run-${day}-f`, at(2026, 3, 1 + day, 10, 3), "agent", `final-job${day}`));
      }
    }
    expect(rows.length).toBe(90 * 111 + 40 * 4); // 10_150
    const runIdSpy = vi.fn(runIdOf);
    const started = performance.now();
    const grouped = groupMessagesByDay(groupAgentRuns(rows, runIdSpy, isAgent), NOW);
    const elapsed = performance.now() - started;
    expect(runIdSpy).toHaveBeenCalledTimes(rows.length); // still exactly one probe per message
    expect(elapsed).toBeLessThan(500); // generous CI bound; quadratic work would blow far past it
    expect(dividers(grouped)).toHaveLength(90);
    const runs = grouped.filter((r) => r.kind === "row" && r.row.kind === "run");
    expect(runs).toHaveLength(40);
    for (const runRow of runs) {
      if (runRow.kind !== "row" || runRow.row.kind !== "run") continue;
      expect(runRow.row.rows).toHaveLength(4);
      // Every one of these runs is finished and >3 messages → folds to "Run · 4 steps · view".
      expect(runCollapsedByDefault(runRow.row.rows.length, true)).toBe(true);
    }
    // Loose rows + run rows still account for every message.
    const total = grouped.reduce((sum, r) => sum + (r.kind === "day" ? 0 : r.row.kind === "run" ? r.row.rows.length : 1), 0);
    expect(total).toBe(rows.length);
  });
});
