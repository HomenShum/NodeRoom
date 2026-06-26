/**
 * Context compaction — keeps the agent's message history bounded on long runs.
 *
 * The bulk of a long run is OLD `read_range` tool results: each is a fat JSON
 * array, and every later read supersedes the earlier ones, so the old ones are
 * pure dead weight. Compaction elides them — exactly Anthropic's "context
 * editing" (clear stale tool results) pattern — while keeping the message
 * ENVELOPES intact, so the assistant↔tool pairing the model API requires is
 * never broken. We always preserve: the opening task+snapshot (message 0), the
 * most recent turns verbatim, and every conflict/commit (those are signal).
 *
 * Deterministic by default; an optional `summarize` seam can replace the elided
 * block's stub text with an LLM running-summary (the Claude "compaction" pattern).
 *
 * Prior art:
 *   - Anthropic, "Effective context engineering for AI agents" — context editing,
 *     compaction, the memory tool.
 *   - Nous Research Hermes — structured tool-call turns (we preserve the turn shape).
 */

import type { AgentMessage } from "./types";

export interface CompactionOpts {
  /** Compact once the estimated context exceeds this many chars (~chars/4 ≈ tokens). */
  maxChars?: number;
  /** Keep this many of the most recent messages verbatim (chosen at a turn boundary). */
  keepRecent?: number;
  /** Tool results that are superseded by later calls and safe to elide. */
  staleTools?: string[];
  /** Optional: summarize the elided block into one line (the LLM-compaction seam). */
  summarize?: (elided: AgentMessage[]) => Promise<string>;
}

const DEFAULTS = { maxChars: 24_000, keepRecent: 8, staleTools: ["read_range"] };
const MAX_COMPACTED_READ_CELLS = 200;

/** Cheap size estimate — character count of content + serialized tool calls. */
export function estimateChars(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) n += (m.content?.length ?? 0) + (m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);
  return n;
}

export interface CompactionResult { messages: AgentMessage[]; compacted: boolean; before: number; after: number; elided: number; }

function compactReadRangeContent(content: string | undefined, fallback: string): string {
  try {
    const parsed = JSON.parse(content ?? "");
    if (!Array.isArray(parsed)) return fallback;
    const cells = parsed.slice(0, MAX_COMPACTED_READ_CELLS).map((cell) => {
      const record = cell && typeof cell === "object" && !Array.isArray(cell) ? cell as Record<string, unknown> : {};
      return {
        id: typeof record.id === "string" ? record.id : "",
        version: typeof record.version === "number" ? record.version : 0,
        locked: record.locked ?? null,
        value: "[compacted]",
        compacted: true,
        note: "read_range value payload compacted to save context; this is not evidence that source data is missing. Re-read this artifactId/cell if the value is required.",
      };
    });
    if (parsed.length > MAX_COMPACTED_READ_CELLS) {
      cells.push({
        id: "__read_range_compacted_more__",
        version: 0,
        locked: null,
        value: `${parsed.length - MAX_COMPACTED_READ_CELLS} additional cells compacted`,
        compacted: true,
        note: "Additional cells were compacted; re-read a narrower range if needed.",
      });
    }
    return JSON.stringify(cells);
  } catch {
    return fallback;
  }
}

export async function compactMessages(messages: AgentMessage[], opts: CompactionOpts = {}): Promise<CompactionResult> {
  const maxChars = opts.maxChars ?? DEFAULTS.maxChars;
  const keepRecent = opts.keepRecent ?? DEFAULTS.keepRecent;
  const stale = new Set(opts.staleTools ?? DEFAULTS.staleTools);
  const before = estimateChars(messages);

  if (before <= maxChars) return { messages, compacted: false, before, after: before, elided: 0 };

  const head = messages[0];
  const tailStart = Math.max(1, messages.length - keepRecent);
  const tail = messages.slice(tailStart);
  const middle = messages.slice(1, tailStart);

  const staleToolMessages = messages.filter((m) => m.role === "tool" && stale.has(m.toolName ?? ""));
  if (!staleToolMessages.length) return { messages, compacted: false, before, after: before, elided: 0 };
  const stubText = opts.summarize
    ? `[compacted: earlier reads summarized] ${await opts.summarize(staleToolMessages)}`
    : "[read_range payload compacted to save context; this is not evidence that source data is missing. Re-read the needed artifactId/cells if values are required.]";

  // Keep every envelope; only shrink stale tool results. Recent read_range
  // payloads can be the largest messages in a BTB slice, so they must compact too.
  const compactToolContent = (m: AgentMessage) =>
    m.role === "tool" && stale.has(m.toolName ?? "")
      ? { ...m, content: m.toolName === "read_range" ? compactReadRangeContent(m.content, stubText) : stubText }
      : m;
  const compactedMiddle = middle.map((m) =>
    compactToolContent(m),
  );

  const out = [head, ...compactedMiddle, ...tail.map(compactToolContent)];
  return { messages: out, compacted: true, before, after: estimateChars(out), elided: staleToolMessages.length };
}
