/**
 * MemoryContextBuilder — formats a NodeMem ContextPack into a bounded system-context
 * string for injection into the agent's system prompt.
 *
 * Key design decisions:
 * - Injected as SYSTEM context, NOT as a user message (per Phase 3 spec).
 * - Bounded token budget (default 1200 tokens, ~4 chars/token).
 * - Evidence facts are presented as verified context; graph-only facts as needs_review.
 * - Freshness is surfaced so the agent knows which facts might be stale.
 * - Open questions guide the agent toward verification.
 */

import type { NodeMemContextPack } from "./core/types";

const APPROX_CHARS_PER_TOKEN = 4;

export interface MemoryContextOptions {
  maxTokens?: number;
  includeFreshness?: boolean;
  includeOpenQuestions?: boolean;
}

/**
 * Format a ContextPack into a system-context string.
 * Returns null if the pack is empty or null (no injection).
 */
export function buildMemorySystemContext(
  pack: NodeMemContextPack | null,
  opts: MemoryContextOptions = {},
): string | null {
  if (!pack) return null;
  if (!pack.evidence.length && !pack.graphFacts.length) return null;

  const maxTokens = opts.maxTokens ?? 1200;
  const maxChars = maxTokens * APPROX_CHARS_PER_TOKEN;
  const includeFreshness = opts.includeFreshness ?? true;
  const includeOpenQuestions = opts.includeOpenQuestions ?? true;

  const sections: string[] = [];

  sections.push("MEMORY CONTEXT — room knowledge assembled from prior episodes:");
  sections.push(`Task kind: ${pack.taskKind}`);
  sections.push("");

  // Evidence facts (verified, source-backed)
  if (pack.evidence.length) {
    sections.push("VERIFIED FACTS (source-backed, high confidence):");
    const evidenceLines: string[] = [];
    let charBudget = maxChars - sections.join("\n").length - 200; // reserve for other sections
    for (const ev of pack.evidence) {
      const line = `  - ${ev.label}: ${ev.value} (confidence: ${ev.confidence})`;
      if (charBudget - line.length < 0) break;
      evidenceLines.push(line);
      charBudget -= line.length;
    }
    sections.push(evidenceLines.join("\n"));
    sections.push("");
  }

  // Graph-only facts (inferred, needs review)
  if (pack.graphFacts.length) {
    sections.push("INFERRED FACTS (graph-only, needs verification — treat as leads, not confirmed):");
    const graphLines: string[] = [];
    let charBudget = maxChars - sections.join("\n").length - 200;
    for (const gf of pack.graphFacts) {
      const line = `  - [${gf.status}] ${gf.statement}`;
      if (charBudget - line.length < 0) break;
      graphLines.push(line);
      charBudget -= line.length;
    }
    sections.push(graphLines.join("\n"));
    sections.push("");
  }

  // Freshness summary
  if (includeFreshness && pack.freshness) {
    const f = pack.freshness;
    const staleCount = f.staleItems.length;
    if (staleCount > 0) {
      sections.push(`FRESHNESS: ${staleCount} stale item(s), needsRefresh=${f.needsRefresh}`);
    } else {
      sections.push("FRESHNESS: all facts are fresh");
    }
    sections.push("");
  }

  // Open questions
  if (includeOpenQuestions && pack.openQuestions?.length) {
    sections.push("OPEN QUESTIONS (verify if relevant to your task):");
    for (const q of pack.openQuestions) {
      sections.push(`  - ${q}`);
    }
    sections.push("");
  }

  sections.push("END MEMORY CONTEXT — use verified facts directly; verify inferred facts before relying on them.");

  const result = sections.join("\n");

  // Final token budget check
  if (result.length > maxChars) {
    // Trim to budget — keep evidence, drop graph facts if needed
    const trimmed = result.slice(0, maxChars - 50) + "\n…[memory context trimmed to token budget]…\nEND MEMORY CONTEXT";
    return trimmed;
  }

  return result;
}

/**
 * Append memory context to an existing system prompt.
 * Returns the original prompt if pack is null (no injection).
 */
export function injectMemoryIntoSystemPrompt(
  systemPrompt: string,
  pack: NodeMemContextPack | null,
  opts: MemoryContextOptions = {},
): string {
  const memoryContext = buildMemorySystemContext(pack, opts);
  if (!memoryContext) return systemPrompt;

  return `${systemPrompt}\n\n${memoryContext}`;
}

/**
 * Estimate token count for a ContextPack (approx 4 chars/token).
 */
export function estimateContextPackTokens(pack: NodeMemContextPack): number {
  const json = JSON.stringify(pack);
  return Math.ceil(json.length / APPROX_CHARS_PER_TOKEN);
}
