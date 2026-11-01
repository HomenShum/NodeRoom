/**
 * Claude 5.5 thinking blocks are signed against the conversation that produced them: the system prompt, the tool
 * set, and every earlier message (migration guide, "preserved thinking"). A re-sent block whose prefix has since
 * changed is a 400 on accounts created on or after 2026-08-31 ("Invalid signature ... bound to a different
 * conversation"). The runtime does change that prefix: compaction rewrites old read_range results and the tool set
 * shrinks (say, held-back reads) between turns.
 *
 * So each assistant turn records the fingerprint of the prefix its blocks were produced against, and before every
 * request the blocks whose fingerprint no longer matches are stripped, together with every block after them (the
 * guide's remedy: the first mismatched block and all later ones go). Thinking blocks are not part of the prefix, so
 * stripping one never disturbs another's fingerprint. A turn with no recorded fingerprint (replayed from the journal,
 * or restored from a checkpoint) is treated as mismatched.
 */
import type { AgentMessage, AgentTool } from "./types";

// cyrb53: a small synchronous 53-bit string hash (the core runs where node:crypto and async subtle crypto are not options).
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function seed(system: string, tools: AgentTool[]): string {
  const toolSet = tools.map((t) => `${t.name}\u0001${t.description}`).sort();
  return hash53(`${system}\u0000${JSON.stringify(toolSet)}`);
}
const extend = (key: string, m: AgentMessage): string =>
  hash53(`${key}\u0000${JSON.stringify([m.role, m.content, m.toolCalls, m.toolCallId, m.toolName])}`);

/** Fingerprint of the request `{ system, tools, messages: prefix }` that a model turn is about to answer. */
export function thinkingBindingKey(system: string, tools: AgentTool[], prefix: AgentMessage[]): string {
  let key = seed(system, tools);
  for (const m of prefix) key = extend(key, m);
  return key;
}

/** The messages to send: thinking removed from the first assistant turn whose binding no longer matches, and every one after it. */
export function dropStaleThinking(messages: AgentMessage[], system: string, tools: AgentTool[]): AgentMessage[] {
  let key = seed(system, tools);
  let stale = false;
  let out: AgentMessage[] | undefined;
  messages.forEach((m, i) => {
    if (m.thinking?.length) {
      stale ||= m.thinkingBinding !== key;
      if (stale) {
        const { thinking: _thinking, thinkingBinding: _binding, ...rest } = m;
        (out ??= messages.slice())[i] = rest;
      }
    }
    key = extend(key, m);
  });
  return out ?? messages;
}
