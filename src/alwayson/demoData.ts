/**
 * Always-On Rooms — demo dataset for the public room page, landing cards, and
 * ops panel when no Convex data is available (memory mode / cold landing).
 * Mirrors design-reference/alwayson/ao-data.js — keep the two in sync when the
 * design bundle is refreshed.
 */

export type AoPaperStatus = "new" | "updated" | "tracked";

export type AoPaper = {
  title: string;
  discipline: string;
  topic: string;
  difficulty: string;
  status: AoPaperStatus;
  firstSeen: string;
  evidenceRef: string;
};

export type AoRunEventStatus = "changed" | "ok" | "skipped" | "failed";

export type AoRunEvent = {
  at: string;
  event: string;
  meta: string;
  status: AoRunEventStatus;
  cost: string;
};

export type AoOutboxState =
  | "pending_draft"
  | "draft_created"
  | "approved"
  | "sent"
  | "failed"
  | "skipped";

export type AoOutboxRow = {
  to: string;
  brief: string;
  state: AoOutboxState;
  ref: string;
  idempotencyKey: string;
};

export type AoCard = {
  slug: string;
  name: string;
  desc: string;
  updated: string;
  metric: string;
  health: "live" | "paused";
};

export const AO_PAPERS: AoPaper[] = [
  { title: "Spectral sequences without tears", discipline: "Mathematics", topic: "algebraic topology", difficulty: "graduate", status: "new", firstSeen: "today 09:00", evidenceRef: "expositio · #2841" },
  { title: "A gentle route to the étale fundamental group", discipline: "Mathematics", topic: "arithmetic geometry", difficulty: "graduate", status: "new", firstSeen: "today 09:00", evidenceRef: "expositio · #2842" },
  { title: "What attention heads actually compute", discipline: "Computer science", topic: "ML interpretability", difficulty: "intermediate", status: "new", firstSeen: "today 09:00", evidenceRef: "expositio · #2843" },
  { title: "Renormalization for the impatient", discipline: "Physics", topic: "quantum field theory", difficulty: "graduate", status: "new", firstSeen: "today 09:00", evidenceRef: "expositio · #2844" },
  { title: "Causal inference: the missing semester", discipline: "Statistics", topic: "causal inference", difficulty: "intermediate", status: "tracked", firstSeen: "Jun 30", evidenceRef: "expositio · #2790" },
  { title: "Sheaves for systems biologists", discipline: "Biology", topic: "applied topology", difficulty: "intermediate", status: "updated", firstSeen: "Jun 28", evidenceRef: "expositio · #2771" },
];

export const AO_RUNLOG: AoRunEvent[] = [
  { at: "09:00:04", event: "fetch expositio.org/papers", meta: "hash 9f3a…c2 · changed", status: "changed", cost: "0.2 cr" },
  { at: "09:00:12", event: "extract new items", meta: "4 new · 0 removed · metadata parsed", status: "ok", cost: "0.3 cr" },
  { at: "09:00:31", event: "classify + summarize", meta: "4 rows · 3 summary levels · evidence refs attached", status: "ok", cost: "0.6 cr" },
  { at: "09:00:58", event: "update topics graph", meta: "4 nodes · 9 edges", status: "ok", cost: "0.1 cr" },
  { at: "09:01:10", event: "append daily brief", meta: "agent-authored · append-only · admin can correct", status: "ok", cost: "0.1 cr" },
  { at: "Jul 3 · 09:00", event: "fetch expositio.org/papers", meta: "hash unchanged · no LLM call", status: "skipped", cost: "0.0 cr" },
];

export const AO_OUTBOX: AoOutboxRow[] = [
  { to: "researcher@stanford.edu", brief: "daily · Jul 4", state: "sent", ref: "gmail_msg 18c4f2…", idempotencyKey: "exp:b0704:s003:daily" },
  { to: "k.tanaka@riken.jp", brief: "daily · Jul 4", state: "sent", ref: "gmail_msg 18c4f7…", idempotencyKey: "exp:b0704:s011:daily" },
  { to: "msmith@princeton.edu", brief: "daily · Jul 4", state: "approved", ref: "gmail_draft r-582a…", idempotencyKey: "exp:b0704:s017:daily" },
  { to: "lena@expositio.org", brief: "daily · Jul 4", state: "draft_created", ref: "gmail_draft r-58c1…", idempotencyKey: "exp:b0704:s019:daily" },
  { to: "j.doe@ens.fr", brief: "daily · Jul 4", state: "pending_draft", ref: "—", idempotencyKey: "exp:b0704:s024:daily" },
  { to: "new-sub@gmail.com", brief: "daily · Jul 4", state: "skipped", ref: "subscriber_not_active", idempotencyKey: "exp:b0704:s025:daily" },
];

export const AO_CARDS: AoCard[] = [
  { slug: "expositio-pulse", name: "Expositio Pulse", desc: "New expository papers, topics, authors, and a weekly reading digest.", updated: "Updated 12m ago", metric: "43 papers tracked · 4 new today", health: "live" },
  { slug: "noderoom-live-ops", name: "NodeRoom Live Ops", desc: "Public product metrics, benchmark receipts, incidents, and the daily brief.", updated: "Updated 2m ago", metric: "Healthy · 0 open incidents", health: "live" },
  { slug: "agentic-rl-watch", name: "Agentic RL Watch", desc: "New papers, repos, benchmarks, and trace/reward/eval infrastructure.", updated: "Updated 1h ago", metric: "18 new items this week", health: "live" },
];

export type AoProofRow = { k: string; v: string; ok?: boolean; link?: boolean };

export const AO_PROOF: AoProofRow[] = [
  { k: "Status", v: "completed · 12m ago", ok: true },
  { k: "Sources checked", v: "1 / 1 allowed" },
  { k: "New items", v: "4" },
  { k: "Rows updated", v: "4" },
  { k: "Brief", v: "generated", ok: true },
  { k: "Cost", v: "1.2 cr · cap 3.0" },
  { k: "Evidence", v: "4 source refs" },
  { k: "Trace", v: "open →", link: true },
];

export const AO_ROOM_META = {
  slug: "expositio-pulse",
  title: "Expositio Pulse",
  briefTitle: "Expositio daily brief",
  briefDate: "2026-07-04 · run #26 · completed 09:01",
  papersCount: 43,
  viewersWeek: 312,
  schedule: "daily scan · weekly digest",
  sourceLine: "expositio.org/papers · daily · ok",
};
