/**
 * postGradeMessage — chat-side display contract.
 *
 * Pins the two things callers depend on:
 *   1. Format: the message reads exactly like the spec ("Benchmark **<task>** complete." headline,
 *      "Score: **<n>** (…)" line, "[per-cell: key ✓ <agent-value>; …]" breakdown).
 *   2. Anti-cheat: rubric.expected values NEVER appear in the message text. Only the agent's own
 *      writes are echoed; pass/fail per key is reduced to a single glyph. Property test: scan the
 *      message for every distinct rubric.expected[*].value and assert each one is absent — UNLESS
 *      the agent itself wrote that exact number (in which case the leak is the agent's, not ours).
 */
import { describe, it, expect } from "vitest";
import { gradeGolden } from "../src/benchmarks/golden/grader";
import { goldenDataset } from "../src/benchmarks/golden/dataset";
import { formatGradeMessage, postGradeMessage } from "../src/benchmarks/golden/postGradeMessage";
import { RoomEngine } from "../src/engine/roomEngine";

const nb01 = goldenDataset().find((t) => t.taskId === "nb-01-company-profile")!;

describe("postGradeMessage — chat-side display", () => {
  it("formats a passing run with the headline, score, and per-cell breakdown", () => {
    const r = gradeGolden(nb01.rubric, nb01.good);
    const text = formatGradeMessage(nb01.taskId, r, nb01.good);

    // Headline + bold task slug.
    expect(text).toMatch(/^Benchmark \*\*nb-01-company-profile\*\* complete\./);
    // Score line — bold score, correct/formula/cited/fabricated counts.
    expect(text).toMatch(/Score: \*\*1\.00\*\* \(correct: 5\/5, formula: 5\/5, cited: 5\/5, fabricated: 0\)/);
    // Per-cell list — every expected key shows with a glyph and the agent's written value.
    expect(text).toContain("[per-cell: ");
    for (const key of Object.keys(nb01.rubric.expected)) {
      expect(text).toMatch(new RegExp(`${key} [✓✗] `));
    }
  });

  it("ANTI-CHEAT: rubric.expected values never appear in the per-cell value slot", () => {
    // Use the bad deliverable so every per-cell value slot diverges from the golden. For each
    // expected key, parse out the value chunk after the glyph and assert it matches the AGENT's
    // own write (or the missing-placeholder), never the rubric.expected target.
    //
    // This is the strict form: rather than scanning the whole message (which would false-positive
    // when "25" appears inside a column NAME like "eps_2025"), we anchor on the per-cell pattern
    // `key (✓|✗) <value>` and check the value position only.
    const r = gradeGolden(nb01.rubric, nb01.bad!);
    const text = formatGradeMessage(nb01.taskId, r, nb01.bad!);

    for (const [key, spec] of Object.entries(nb01.rubric.expected)) {
      const m = text.match(new RegExp(`${key} [✓✗] ([^;\\]]+)`));
      expect(m, `per-cell entry missing for "${key}"`).toBeTruthy();
      const valueSlot = m![1].trim();
      const rec = nb01.bad![key];
      const agentValue = rec?.value;
      const expectedRender = agentValue == null
        ? "—"
        : (typeof agentValue === "number" ? String(agentValue) : String(agentValue));
      expect(valueSlot, `value slot for "${key}" diverged from agent's write`).toBe(expectedRender);
      // And as a backstop: the rubric.expected value never appears in the slot UNLESS the agent
      // wrote that exact number. (This catches a future regression where the formatter swaps in
      // the rubric target for "context".)
      if (agentValue !== spec.value) {
        expect(valueSlot).not.toBe(String(spec.value));
      }
    }
  });

  it("ANTI-CHEAT: the source word 'expected' / golden / target never appears in the message", () => {
    const r = gradeGolden(nb01.rubric, nb01.bad!);
    const text = formatGradeMessage(nb01.taskId, r, nb01.bad!);
    // The chat surface is for the user; the words that name the golden are reserved for the
    // grader internals and dev-side panels. Keep them out of the public-channel post.
    expect(text).not.toMatch(/\bexpected\b/i);
    expect(text).not.toMatch(/\bgolden\b/i);
    expect(text).not.toMatch(/\btarget\b/i);
  });

  it("renders a missing key as ✗ with an em-dash placeholder (no rubric leak)", () => {
    const r = gradeGolden(nb01.rubric, nb01.bad!);
    const text = formatGradeMessage(nb01.taskId, r, nb01.bad!);
    // nb-01 bad omits gross_margin_2025 → must show with ✗ and an em-dash, not the rubric target.
    expect(text).toMatch(/gross_margin_2025 ✗ —/);
  });

  it("postGradeMessage posts ONE kind='agent' message in the public channel via engine.postMessage", () => {
    const engine = new RoomEngine();
    const { room } = engine.createRoom({ title: "grade-test", hostName: "Tester" });
    // Stand up a public agent session so resolveAuthor finds the public NodeAgent (mirrors a
    // real room — no fallback path).
    engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "RoomAgent", scope: "public" });

    const r = gradeGolden(nb01.rubric, nb01.good);
    const id = postGradeMessage({ engine, roomId: room.id, taskId: nb01.taskId, result: r, outputs: nb01.good });
    expect(id).toBeTruthy();

    const msgs = engine.listMessages(room.id, "public");
    const posted = msgs.find((m) => m.id === id);
    expect(posted).toBeTruthy();
    expect(posted!.kind).toBe("agent");
    expect(posted!.author.kind).toBe("agent");
    expect(posted!.author.scope).toBe("public");
    expect(posted!.text).toContain("Benchmark **nb-01-company-profile** complete.");
  });

  it("postGradeMessage is idempotent on the same clientMsgId (no duplicate posts on retry)", () => {
    const engine = new RoomEngine();
    const { room } = engine.createRoom({ title: "grade-idem", hostName: "Tester" });
    engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "RoomAgent", scope: "public" });

    const r = gradeGolden(nb01.rubric, nb01.good);
    const cid = "grade_run_42";
    const first = postGradeMessage({ engine, roomId: room.id, taskId: nb01.taskId, result: r, outputs: nb01.good, clientMsgId: cid });
    const second = postGradeMessage({ engine, roomId: room.id, taskId: nb01.taskId, result: r, outputs: nb01.good, clientMsgId: cid });
    expect(first).toBeTruthy();
    expect(second).toBeNull(); // engine.postMessage de-dupes on clientMsgId.

    expect(engine.listMessages(room.id, "public").filter((m) => m.kind === "agent")).toHaveLength(1);
  });
});
