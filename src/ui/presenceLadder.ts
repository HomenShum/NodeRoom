/**
 * presenceLadder — the pure "presence ladder" primitive from the States & Scale
 * design (design-reference/scale/scale-states.jsx, "Presence at scale" board):
 *
 *   1 cursor  = flag           (named cursor flag on the cell)
 *   2–3       = stacked flags  (small stack of named flags)
 *   4+        = cluster count  (one pill with the count — .sc-cluster treatment)
 *   room-wide = facepile + people panel (PeoplePanel.tsx owns that rung)
 *
 * This module is deliberately a pure helper with zero React/DOM dependencies:
 * panels/Artifact.tsx integrates it on the sheet next wave, and tests can pin
 * the thresholds + deterministic ordering without rendering anything.
 */
import type { PresenceClaim } from "../app/store";

export type LadderMode = "none" | "flag" | "stack" | "cluster";

export type LadderMember = {
  /** actor id (member id or agent id) — the dedupe key. */
  id: string;
  name: string;
  kind: "user" | "agent";
  color?: string;
  /** The freshest claim mode this actor holds on the target (edit wins over focus on a tie). */
  mode: PresenceClaim["mode"];
  updatedAt: number;
};

export type LadderResult = {
  mode: LadderMode;
  /** Bounded preview of who is here (freshest first) — never more than LADDER_MEMBER_CAP. */
  members: LadderMember[];
  /** Honest total of DISTINCT actors on the target (cluster shows this count). */
  count: number;
};

/** 2–3 actors render as a stack; 4 or more collapse to a cluster count. */
export const LADDER_STACK_MAX = 3;
/**
 * Agent presence is a "just here" trail, not a sustained cursor. The server
 * grants presence claims up to a 180s TTL, so a batch write (e.g. NodeAgent
 * writing 55 underwriting cells) leaves EVERY cell flagged for minutes after the
 * agent is done. Display-freshness policy: an agent counts as present on a cell
 * only if it touched it within this window; older agent claims fade even though
 * the server claim is still valid. Human presence is unaffected — a person
 * editing a cell is genuinely live until their own claim expires. */
export const AGENT_PRESENCE_TTL_MS = 12_000;
/** Bound on the members preview — a 500-claim burst must not return a 500-entry array. */
export const LADDER_MEMBER_CAP = 3;

/** Freshness order for two claims by the SAME actor: newer updatedAt wins; on an exact
 *  tie, "edit" outranks "focus"-family modes (an editor flag is the stronger truth);
 *  final tie-break is claim id so the result is stable across shuffles. */
const MODE_RANK: Record<PresenceClaim["mode"], number> = { edit: 3, commit_lease: 2, agent_intent: 1, focus: 0 };

function fresherClaim(a: PresenceClaim, b: PresenceClaim): PresenceClaim {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const ra = MODE_RANK[a.mode] ?? 0;
  const rb = MODE_RANK[b.mode] ?? 0;
  if (ra !== rb) return ra > rb ? a : b;
  return a.id <= b.id ? a : b;
}

/**
 * Collapse the presence claims on one target into its ladder rung.
 *
 * - Expired claims (expiresAt <= now) and other targets are ignored.
 * - One actor holding several claims (focus + edit on the same cell) counts ONCE.
 * - Ordering is deterministic: freshest actor first, ties by actor id ascending —
 *   the same input set always renders the same stack, regardless of claim order.
 * - Pure: never mutates `claims`.
 */
export function ladderFor(claims: readonly PresenceClaim[], targetId: string, now: number = Date.now()): LadderResult {
  const byActor = new Map<string, PresenceClaim>();
  for (const claim of claims) {
    if (claim.targetId !== targetId) continue;
    if ((claim.expiresAt ?? Infinity) <= now) continue;
    // Fade an agent's presence once it has moved on, so a finished batch write
    // doesn't leave a live flag on every cell it touched (see AGENT_PRESENCE_TTL_MS).
    if (claim.actor?.kind === "agent" && now - claim.updatedAt > AGENT_PRESENCE_TTL_MS) continue;
    const actorId = claim.actor?.id;
    if (!actorId) continue;
    const prev = byActor.get(actorId);
    byActor.set(actorId, prev ? fresherClaim(prev, claim) : claim);
  }

  const ordered = [...byActor.values()].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
    return a.actor.id < b.actor.id ? -1 : a.actor.id > b.actor.id ? 1 : 0;
  });

  const count = ordered.length;
  const mode: LadderMode = count === 0 ? "none" : count === 1 ? "flag" : count <= LADDER_STACK_MAX ? "stack" : "cluster";
  const members: LadderMember[] = ordered.slice(0, LADDER_MEMBER_CAP).map((c) => ({
    id: c.actor.id,
    name: c.actor.name,
    kind: c.actor.kind === "agent" ? "agent" : "user",
    color: c.color,
    mode: c.mode,
    updatedAt: c.updatedAt,
  }));
  return { mode, members, count };
}
