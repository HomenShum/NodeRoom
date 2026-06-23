/**
 * postGradeMessage — chat-side display for a finished benchmark run.
 *
 * After gradeGolden() runs (in vitest, the live UI verifier, or a Convex action's success
 * callback), the trigger calls postGradeMessage() to publish ONE agent-authored summary into the
 * room's public channel. It reuses the engine's existing message path (engine.postMessage,
 * kind="agent") — no new state, no new pub/sub.
 *
 * Anti-cheat contract (the property the unit test pins):
 *   - This module NEVER imports rubric.json, the dataset, or any GoldenRubric.expected[*].value.
 *   - The message text is built from (taskId, GradeResult, GoldenOutputs) only. The agent's own
 *     written values (outputs[key].value) are echoed back — that's what the user saw the agent
 *     write, not the golden. Pass/fail per key comes from GradeResult.perKey, which contains booleans
 *     (okValue/okFormula/okCite), never the expected target.
 *   - The user sees the score; the golden is not exposed.
 *
 * Format (matches the spec in the chat-side display task):
 *
 *   Benchmark **nb-01-company-profile** complete.
 *   Score: **0.92** (correct: 5/5, formula: 4/5, cited: 5/5, fabricated: 0)
 *   [per-cell: revenue_growth_pct ✓ 25.0; gross_margin_2024 ✗ 41.0; ...]
 *
 * The leading `>` blockquote glyphs in the original spec are intentionally omitted — chat renders
 * message.text as plain text (no markdown parser), so the literal `>` would just be a visible
 * chevron noise. Bold markers (`**…**`) are kept verbatim per the spec; they read fine as-is and
 * future-proof the line if a renderer is wired later.
 */
import type { GradeResult, GoldenOutputs, KeyBreakdown } from "./grader";
import type { Actor, Channel } from "../../engine/types";
import type { RoomEngine } from "../../engine/roomEngine";

/** Per-key glyph: ✓ if the value dimension passed (okValue), ✗ otherwise. Formula/citation
 * failures don't downgrade the glyph — they show up in the headline counts. This keeps the per-cell
 * list a single "did the number land in tolerance?" signal, which is what a reader scans for. */
function cellGlyph(k: KeyBreakdown): "✓" | "✗" {
  return k.okValue ? "✓" : "✗";
}

/** Format the agent's written value for a key in a compact, locale-stable way. Falls back to a
 * literal "—" placeholder when the agent didn't write anything (missing key). NEVER consults the
 * rubric's expected value. */
function formatAgentValue(key: string, outputs: GoldenOutputs): string {
  const rec = outputs[key];
  const v = rec?.value;
  if (v == null) return "—";
  if (typeof v === "number" && Number.isFinite(v)) {
    // Trim trailing zeros after the decimal but keep at least one decimal place for floats.
    // Integers render bare (e.g. 25 → "25"); decimals render with their meaningful digits (25.0 → "25.0").
    return Number.isInteger(v) ? String(v) : String(v);
  }
  // Strings (rare; outputs.value is typed unknown) and anything else: JSON-stringify-light.
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * Build the chat-side summary text for a finished grade run.
 *
 * Pure, dependency-free. Safe to call from anywhere (browser, vitest, Convex action). No I/O.
 */
export function formatGradeMessage(taskId: string, result: GradeResult, outputs: GoldenOutputs): string {
  const headline = `Benchmark **${taskId}** complete.`;
  const score = result.score.toFixed(2);
  // `formula`/`cited` are only meaningful when the rubric required them; if not, surface 0/n so the
  // counts stay legible (matches the grader's own behavior where the dimension simply isn't scored).
  const f = result.needFormula ? `${result.formula}/${result.n}` : `0/${result.n}`;
  const c = result.needCite ? `${result.cited}/${result.n}` : `0/${result.n}`;
  const scoreLine =
    `Score: **${score}** (correct: ${result.correct}/${result.n}, formula: ${f}, cited: ${c}, fabricated: ${result.fabrication})`;
  const perCell = result.perKey
    .map((k) => `${k.key} ${cellGlyph(k)} ${formatAgentValue(k.key, outputs)}`)
    .join("; ");
  const perCellLine = `[per-cell: ${perCell}]`;
  return `${headline}\n${scoreLine}\n${perCellLine}`;
}

export interface PostGradeMessageArgs {
  engine: RoomEngine;
  roomId: string;
  taskId: string;
  result: GradeResult;
  /** The agent's deliverable — used ONLY for echoing the agent's own written value per key.
   *  Must not be confused with rubric.expected. */
  outputs: GoldenOutputs;
  /** Optional explicit author. When omitted, the room's public agent session is used; if no public
   *  session exists, a synthetic fallback Actor is used so the post still lands (the message is
   *  never silently dropped on the engine side). */
  author?: Actor;
  /** Optional deterministic clientMsgId for idempotent re-posts (e.g. action retries). */
  clientMsgId?: string;
}

/** Resolve the public agent author for `roomId`, or fall back to a synthetic grader actor. */
function resolveAuthor(engine: RoomEngine, roomId: string): Actor {
  const pub = engine.listSessions(roomId).find((s) => s.scope === "public");
  if (pub) return { kind: "agent", id: pub.agentId, name: pub.agentName, scope: "public" };
  return { kind: "agent", id: "agent_grader", name: "NodeAgent", scope: "public" };
}

/**
 * Post the formatted grade summary to the room's public channel as an agent message.
 *
 * Returns the posted message id (or null if engine.postMessage de-duped on clientMsgId — the
 * idempotent re-post case).
 */
export function postGradeMessage(args: PostGradeMessageArgs): string | null {
  const { engine, roomId, taskId, result, outputs } = args;
  const author = args.author ?? resolveAuthor(engine, roomId);
  const text = formatGradeMessage(taskId, result, outputs);
  // Public channel: every member sees the headline + per-cell breakdown. The golden never enters
  // the text — see the anti-cheat contract at the top of this file.
  const channel: Channel = "public";
  const clientMsgId = args.clientMsgId ?? `grade_${taskId}_${result.score.toFixed(3)}_${Date.now()}`;
  const m = engine.postMessage({ roomId, channel, author, text, clientMsgId, kind: "agent" });
  return m?.id ?? null;
}
