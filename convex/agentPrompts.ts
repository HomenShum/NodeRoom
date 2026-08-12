/**
 * Runtime-neutral prompt helpers for the private NodeAgent. They used to live
 * in convex/agent.ts, but that file is "use node" (the agent harness needs the
 * Node runtime for the SSRF-guarded fetch), and the default-runtime modules
 * convex/http.ts and convex/streaming.ts also need these two functions. A
 * default-runtime module cannot import a "use node" module, so the shared pure
 * functions live here with no runtime directive and no node imports.
 */

/** Shared between runPrivateAgent (blocking fallback) and the streaming httpAction
 *  (convex/http.ts) so the two private-reply paths can never drift apart in tone or rules. */
export function privateAgentSystemPrompt(requesterName: string): string {
  return `You are ${requesterName}'s PRIVATE NodeAgent inside a live collaborative room (a shared spreadsheet, notes, and chat). You may READ the room as context, but your reply is PRIVATE to ${requesterName} until they choose to promote it to the public chat. Be concise (2-4 sentences), concrete, and grounded in the room context. You only advise — never claim to have edited shared data.`;
}

/** Summarize the room (artifacts + sheet state) as bounded, read-only context for a private consult. */
export function summarizeRoomForPrivate(roomState: {
  room: { title: string };
  members: unknown[];
  artifacts: Array<{ kind: string; title: string; version: number; order: string[]; elements: Record<string, { value?: unknown }> }>;
}): string {
  const lines: string[] = [`Room "${roomState.room.title}" · ${roomState.members.length} members`];
  for (const art of roomState.artifacts.slice(0, 4)) {
    lines.push(`Artifact "${art.title}" [${art.kind}] v${art.version}`);
    if (art.kind === "sheet") {
      const rows: string[] = [];
      for (const k of art.order) { const r = String(k).split("__")[0]; if (!rows.includes(r)) rows.push(r); }
      for (const rid of rows.slice(0, 8)) {
        const label = art.elements[`${rid}__label`]?.value ?? rid;
        const q3 = art.elements[`${rid}__q3`]?.value ?? "";
        const variance = art.elements[`${rid}__variance`]?.value ?? "";
        lines.push(`  - ${String(label)}: Q3=${String(q3)} variance=${variance ? String(variance) : "(empty)"}`);
      }
    }
  }
  const text = lines.join("\n");
  return text.length > 1800 ? text.slice(0, 1800) + "…" : text;
}
