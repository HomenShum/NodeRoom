/**
 * Derive the live TraceFocusBox[] for a spreadsheet from EXISTING store state — no new query, no new table.
 * Sources (all already streamed into the renderer): presenceClaims, locks, drafts/proposals, cell evidence.
 *
 * Critic fixes baked in:
 *  - P0 provenance: focusKind derives from actor.kind AND mode. An AGENT editing uses mode 'edit'/'commit_lease'
 *    yet must NEVER paint as blue user_focus — that would be a box that lies about who is acting.
 *  - actorKind set on EVERY box (not just presence) so the orthogonality holds.
 *  - range presence: a claim whose targetId is "A1:C5" yields ONE box (the resolver merges it) — the agent's
 *    read scope draws as a single amber range, not 15 cells.
 *  - BOUND: cap at MAX_FOCUS_BOXES with deterministic priority eviction (conflict>proposal>evidence>agent>user).
 */
import type { PresenceClaim } from "../../app/store";
import type { Actor } from "../../engine/types";
import type { ActorKind, FocusKind, TraceFocusBox } from "./types";
import { FOCUS_PRIORITY, MAX_FOCUS_BOXES } from "./types";

const actorKindOf = (a: Actor): ActorKind => (a.kind === "agent" ? "agent" : "human");

/** P0: an agent's presence is amber (read/write), a human's is blue — never derive color from mode alone. */
function presenceFocusKind(a: Actor, mode: string): FocusKind {
  if (a.kind === "agent") {
    // agent_intent / focus = reading scope; edit / commit_lease = actively writing.
    return mode === "edit" || mode === "commit_lease" ? "agent_write" : "agent_read";
  }
  return "user_focus"; // human: any mode -> blue
}

export interface SheetCellState {
  id: string;
  lockedByOther: boolean;
  proposed: boolean;
  hasEvidence: boolean;
}

export function focusBoxesForSheet(input: {
  artifactId: string;
  now: number;
  meId: string;
  presence: PresenceClaim[];
  cellStates: SheetCellState[];
}): TraceFocusBox[] {
  const { artifactId, now, meId, presence, cellStates } = input;
  const boxes: TraceFocusBox[] = [];
  const target = (cellRange: string) => ({ artifactId, artifactKind: "spreadsheet" as const, kind: "cellRange" as const, cellRange });

  // (a) presence -> user_focus (blue) / agent_read|agent_write (amber). One box per non-self, live claim.
  for (const c of presence) {
    if (c.actor.id === meId) continue;
    if (((c as { expiresAt?: number }).expiresAt ?? Infinity) <= now) continue;
    const focusKind = presenceFocusKind(c.actor, c.mode);
    boxes.push({
      id: `presence:${c.id}`,
      sourceRef: c.id,
      actorId: c.actor.id,
      actorKind: actorKindOf(c.actor),
      focusKind,
      target: target(c.targetId),
      label: c.label || `${c.actor.name} ${focusKind === "user_focus" ? "is here" : focusKind === "agent_write" ? "is writing" : "is reading"}`,
      visibility: "room",
      durability: "ephemeral",
      createdAt: now,
      expiresAt: (c as { expiresAt?: number }).expiresAt,
    });
  }

  // (b/c/d) per-cell lock / proposal / evidence.
  for (const s of cellStates) {
    if (s.lockedByOther) {
      boxes.push({
        id: `conflict:${s.id}`, actorKind: "system", focusKind: "conflict", target: target(s.id),
        label: "Locked — held by another", description: "An agent write here is deflected to a proposal (no clobber).",
        visibility: "room", durability: "trace_persisted", createdAt: now,
      });
    }
    if (s.proposed) {
      boxes.push({
        id: `proposal:${s.id}`, actorKind: "agent", focusKind: "proposal", target: target(s.id),
        label: "Suggestion available", description: "Agent proposed a change — review to apply.",
        visibility: "room", durability: "trace_persisted", createdAt: now,
      });
    }
    if (s.hasEvidence) {
      boxes.push({
        id: `evidence:${s.id}`, actorKind: "system", focusKind: "evidence", target: target(s.id),
        label: "Evidence-backed", visibility: "room", durability: "evidence_persisted", createdAt: now,
      });
    }
  }

  // BOUND: cap with priority eviction (highest FOCUS_PRIORITY kept, then most-recent).
  if (boxes.length <= MAX_FOCUS_BOXES) return boxes;
  return boxes
    .sort((a, b) => FOCUS_PRIORITY[b.focusKind] - FOCUS_PRIORITY[a.focusKind] || b.createdAt - a.createdAt)
    .slice(0, MAX_FOCUS_BOXES);
}
