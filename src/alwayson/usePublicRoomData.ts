/**
 * Always-On Rooms — public room data source.
 *
 * usePublicRoomData(slug) reads convex `alwaysOn.getPublicRoomBundle` via the
 * repo's explicit function-reference precedent (see convex/alwaysOn.ts and
 * tests/alwaysOnBackend.test.ts). The generated `api` object can lag backend
 * deployment, so this public surface must not silently depend on codegen.
 *
 * REAL server payload (convex/alwaysOnShape.ts toPublicRoomBundle):
 *   { room: { slug, title, description, status, mode, timezone, scanCadence,
 *             monthlyCreditCap, perRunCreditCap, lastRunAt, lastRunStatus,
 *             lastMetric, createdAt, updatedAt },
 *     state: { papers[], briefMarkdown, briefMeta{title,dateLine,runNumber},
 *              runlog[], updatedAt } | null,
 *     runs:  [{ status, startedAt, completedAt, sourcesChecked, changedSources,
 *               itemsCreated, itemsUpdated, creditsUsed, error }],   // desc
 *     sources: [{ url, label, status, lastCheckedAt }] }
 * normalizeBundle maps THAT shape (papers/runlog/brief from state; the proof
 * footer derived from room caps + the latest run) — never a guessed shape.
 *
 * Contract with the page:
 *   - The hook MUST only be mounted under the root ConvexProvider
 *     (PublicRoomPage gates on HAS_CONVEX and wraps the live subtree in an
 *     error boundary — a missing/erroring server query falls back silently).
 *   - While loading, on null, or on a malformed payload it returns the demo
 *     bundle (source: "demo"). Demo values are honest specimen data reused
 *     as-is — never fabricated timestamps or fake "live" markers.
 *   - A live payload is normalized defensively and BOUNDED (row caps) before
 *     it reaches the DOM. Live meta sets viewersWeek to null (no viewer
 *     tracking exists — the page hides the chip rather than fabricating it).
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import {
  AO_PAPERS,
  AO_PROOF,
  AO_ROOM_META,
  AO_RUNLOG,
  type AoPaper,
  type AoPaperStatus,
  type AoProofRow,
  type AoRunEvent,
  type AoRunEventStatus,
} from "./demoData";

/**
 * viewersWeek is number | null: null means "not tracked" (live mode — no
 * viewer analytics exist, so the page hides the chip instead of inventing a
 * number). The demo meta keeps its specimen value.
 */
export type AoRoomMeta = Omit<typeof AO_ROOM_META, "viewersWeek"> & { viewersWeek: number | null };

export type PublicRoomBundle = {
  /** "live" only when a well-formed convex payload arrived; everything else is "demo". */
  source: "live" | "demo";
  meta: AoRoomMeta;
  papers: AoPaper[];
  runlog: AoRunEvent[];
  proof: AoProofRow[];
  /**
   * Live: state.briefMarkdown ("" until the first successful scan writes one).
   * Demo: null — the page renders the specimen Brief component instead.
   */
  briefMarkdown: string | null;
};

/* BOUND — hard caps on anything a server payload could inflate. */
const MAX_PAPERS = 200;
const MAX_RUNLOG = 200;
const MAX_PROOF = 24;
const MAX_STR = 300;
const MAX_BRIEF_CHARS = 20_000;
const MAX_SOURCES = 8;
const MAX_CARDS = 24;

/** Slugs are plain ascii identifiers; anything else is dropped, not escaped. */
export function normalizeRoomSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
}

/**
 * Demo fallback. Only the flagship room has specimen data; unknown slugs get
 * null so the page can render an honest "not available" state instead of
 * relabeling Expositio Pulse content as some other room.
 */
export function fallbackRoomBundle(slug: string): PublicRoomBundle | null {
  if (normalizeRoomSlug(slug) !== AO_ROOM_META.slug) return null;
  return {
    source: "demo",
    meta: AO_ROOM_META,
    papers: AO_PAPERS,
    runlog: AO_RUNLOG,
    proof: AO_PROOF,
    briefMarkdown: null,
  };
}

// convex/alwaysOn.ts is deployed, but _generated/api can lag and omit it.
// Use the same explicit reference pattern as the backend/tests so live public
// rooms do not fall back to demo just because codegen was not refreshed.
export const alwaysOnApi: {
  getPublicRoomBundle: FunctionReference<"query", "public", { slug: string }, unknown>;
  listPublicRooms: FunctionReference<"query", "public", Record<string, never>, unknown>;
  subscribeToRoom: FunctionReference<
    "mutation",
    "public",
    { slug: string; email: string; cadence: "daily" | "weekly" | "act_now" },
    unknown
  >;
} = {
  getPublicRoomBundle: makeFunctionReference<"query", { slug: string }, unknown>("alwaysOn:getPublicRoomBundle"),
  listPublicRooms: makeFunctionReference<"query", Record<string, never>, unknown>("alwaysOn:listPublicRooms"),
  subscribeToRoom:
    makeFunctionReference<"mutation", { slug: string; email: string; cadence: "daily" | "weekly" | "act_now" }, unknown>(
      "alwaysOn:subscribeToRoom",
    ),
};

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, MAX_STR) : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const PAPER_STATUSES: readonly AoPaperStatus[] = ["new", "updated", "tracked"];
const RUN_STATUSES: readonly AoRunEventStatus[] = ["changed", "ok", "skipped", "failed"];

function normalizePaper(raw: unknown): AoPaper | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title);
  if (!title) return null;
  const status = PAPER_STATUSES.includes(r.status as AoPaperStatus) ? (r.status as AoPaperStatus) : "tracked";
  return {
    title,
    discipline: str(r.discipline),
    topic: str(r.topic),
    difficulty: str(r.difficulty),
    status,
    firstSeen: str(r.firstSeen),
    evidenceRef: str(r.evidenceRef),
  };
}

function normalizeRunEvent(raw: unknown): AoRunEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event = str(r.event);
  if (!event) return null;
  const status = RUN_STATUSES.includes(r.status as AoRunEventStatus) ? (r.status as AoRunEventStatus) : "ok";
  return { at: str(r.at), event, meta: str(r.meta), status, cost: str(r.cost) };
}

/**
 * Coarse relative freshness for live timestamps ("just now" / "12m ago" /
 * "3h ago" / "2d ago" / ISO date). Clock skew clamps to "just now" — never a
 * fabricated future time. Exported for the landing cards.
 */
export function relativeTimeSince(thenMs: number, nowMs: number = Date.now()): string {
  if (!Number.isFinite(thenMs) || thenMs <= 0) return "unknown";
  const minutes = Math.floor((nowMs - thenMs) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 60) return `${days}d ago`;
  return new Date(thenMs).toISOString().slice(0, 10);
}

/** Latest run receipt, defensively normalized from bundle.runs[0]. */
type LatestRun = {
  status: string;
  startedAt: number;
  completedAt: number | null;
  sourcesChecked: number;
  itemsCreated: number;
  itemsUpdated: number;
  creditsUsed: number;
  error: string | null;
};

function normalizeLatestRun(raw: unknown): LatestRun | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = str(r.status);
  const startedAt = num(r.startedAt, 0);
  if (!status || startedAt <= 0) return null;
  return {
    status,
    startedAt,
    completedAt: typeof r.completedAt === "number" && Number.isFinite(r.completedAt) ? r.completedAt : null,
    sourcesChecked: num(r.sourcesChecked, 0),
    itemsCreated: num(r.itemsCreated, 0),
    itemsUpdated: num(r.itemsUpdated, 0),
    creditsUsed: num(r.creditsUsed, 0),
    error: typeof r.error === "string" && r.error.length > 0 ? r.error.slice(0, MAX_STR) : null,
  };
}

/**
 * Proof-footer rows derived from the room caps + latest run receipt — the
 * HONEST replacement for the specimen AO_PROOF in live mode. `ok` (green) is
 * reserved for genuinely good states: a completed run, a generated brief.
 * A failed/capped run shows that status and its error; no runs yet says so.
 */
function buildLiveProofRows(input: {
  run: LatestRun | null;
  perRunCreditCap: number;
  sourcesCount: number;
  briefGenerated: boolean;
  updatedAt: number;
  now: number;
}): AoProofRow[] {
  const { run, now } = input;
  const rows: AoProofRow[] = [];
  if (run) {
    rows.push({
      k: "Status",
      v: `${run.status} · ${relativeTimeSince(run.completedAt ?? run.startedAt, now)}`,
      ok: run.status === "completed" || undefined,
    });
  } else {
    rows.push({ k: "Status", v: "no runs yet" });
  }
  rows.push({ k: "Sources checked", v: `${run ? run.sourcesChecked : 0} / ${input.sourcesCount} allowed` });
  rows.push({ k: "New items", v: run ? String(run.itemsCreated) : "—" });
  rows.push({ k: "Rows updated", v: run ? String(run.itemsUpdated) : "—" });
  rows.push(input.briefGenerated ? { k: "Brief", v: "generated", ok: true } : { k: "Brief", v: "not yet generated" });
  rows.push({
    k: "Cost",
    v: run
      ? `${run.creditsUsed.toFixed(1)} cr · cap ${input.perRunCreditCap.toFixed(1)}`
      : `cap ${input.perRunCreditCap.toFixed(1)} cr/run`,
  });
  if (run?.error) rows.push({ k: "Error", v: run.error.slice(0, 80) });
  if (input.updatedAt > 0) rows.push({ k: "Updated", v: relativeTimeSince(input.updatedAt, now) });
  rows.push({ k: "Trace", v: "open →", link: true });
  return rows.slice(0, MAX_PROOF);
}

/** One postit line for the sources allowlist, from the bundle's source rows. */
function buildSourceLine(sourcesRaw: unknown[], cadence: string): string {
  const rows = sourcesRaw
    .slice(0, MAX_SOURCES)
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  if (rows.length === 0) return "no sources configured";
  const first = rows[0];
  const label = str(first.label) || str(first.url) || "source";
  const status = str(first.status, "unknown");
  const extra = rows.length > 1 ? ` · +${rows.length - 1} more` : "";
  return `${label} · ${cadence} · ${status}${extra}`;
}

/**
 * Accept a live payload only when it carries the REAL server shape's minimum:
 * a room object whose slug matches the requested room. state may be null
 * (a freshly seeded room before its first scan) — that renders as an honest
 * empty live room, not as demo data. Anything malformed falls back to demo.
 * Exported for tests (feed it a toPublicRoomBundle-shaped payload).
 */
export function normalizeBundle(raw: unknown, slug: string): PublicRoomBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const roomRaw = r.room;
  if (!roomRaw || typeof roomRaw !== "object") return null;
  const room = roomRaw as Record<string, unknown>;
  if (normalizeRoomSlug(str(room.slug)) !== normalizeRoomSlug(slug)) return null;

  const state = r.state && typeof r.state === "object" ? (r.state as Record<string, unknown>) : null;
  const papers = (state && Array.isArray(state.papers) ? state.papers : [])
    .slice(0, MAX_PAPERS)
    .map(normalizePaper)
    .filter((p): p is AoPaper => p !== null);
  const runlog = (state && Array.isArray(state.runlog) ? state.runlog : [])
    .slice(0, MAX_RUNLOG)
    .map(normalizeRunEvent)
    .filter((e): e is AoRunEvent => e !== null);
  const briefMeta = state && state.briefMeta && typeof state.briefMeta === "object"
    ? (state.briefMeta as Record<string, unknown>)
    : null;
  const briefMarkdown = state && typeof state.briefMarkdown === "string"
    ? state.briefMarkdown.slice(0, MAX_BRIEF_CHARS)
    : "";

  const run = normalizeLatestRun(Array.isArray(r.runs) && r.runs.length > 0 ? r.runs[0] : null);
  const sourcesRaw = Array.isArray(r.sources) ? r.sources : [];
  const cadence = str(room.scanCadence) === "weekly" ? "weekly" : "daily";
  const now = Date.now();
  const updatedAt = num(state?.updatedAt, num(room.updatedAt, 0));

  return {
    source: "live",
    meta: {
      slug: normalizeRoomSlug(str(room.slug)),
      title: str(room.title, "Public room"),
      briefTitle: str(briefMeta?.title, "Daily brief"),
      briefDate: str(briefMeta?.dateLine),
      papersCount: papers.length,
      viewersWeek: null, // no viewer tracking exists — the page hides the chip
      schedule: `${cadence} scan${str(room.mode) === "digest" ? " · email digest" : ""}`,
      sourceLine: buildSourceLine(sourcesRaw, cadence),
    },
    papers,
    runlog,
    proof: buildLiveProofRows({
      run,
      perRunCreditCap: num(room.perRunCreditCap, 0),
      sourcesCount: Math.min(sourcesRaw.length, MAX_SOURCES),
      briefGenerated: briefMarkdown.trim().length > 0,
      updatedAt,
      now,
    }),
    briefMarkdown,
  };
}

/**
 * Live hook — ONLY mount under ConvexProvider (PublicRoomPage gates this).
 * Loading / null / malformed → demo fallback; server-side throws propagate to
 * the page's error boundary, which renders the same fallback.
 */
export function usePublicRoomData(slug: string): PublicRoomBundle | null {
  const normalized = normalizeRoomSlug(slug);
  const raw = useQuery(alwaysOnApi.getPublicRoomBundle, { slug: normalized });
  return useMemo(() => {
    const live = raw === undefined || raw === null ? null : normalizeBundle(raw, normalized);
    return live ?? fallbackRoomBundle(normalized);
  }, [raw, normalized]);
}

// ─── Landing cards (alwaysOn.listPublicRooms) ──────────────────────────────

export type AoLiveCardHealth = "ok" | "failed" | "capped" | "skipped" | "none";

export type AoLiveCard = {
  slug: string;
  name: string;
  desc: string;
  /** "Updated 12m ago" from lastRunAt, or an honest "No runs yet". */
  updated: string;
  metric: string;
  /** room.lastRunStatus verbatim ("none" = no runs recorded). A failed/capped
   *  room must render THAT state on the card — never a live pulse. */
  health: AoLiveCardHealth;
};

/**
 * Normalize listPublicRooms card rows ({ slug, title, description, lastRunAt,
 * lastRunStatus, lastMetric, papersCount } — convex/alwaysOnShape.ts
 * toPublicRoomCard). Empty or malformed → null so the gallery falls back to
 * the demo cards (stamped demo, never presented as live).
 */
export function normalizeRoomCards(raw: unknown, nowMs: number = Date.now()): AoLiveCard[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cards: AoLiveCard[] = [];
  for (const item of raw.slice(0, MAX_CARDS)) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const slug = normalizeRoomSlug(str(c.slug));
    const name = str(c.title);
    if (!slug || !name) continue;
    const lastRunAt = typeof c.lastRunAt === "number" && Number.isFinite(c.lastRunAt) && c.lastRunAt > 0
      ? c.lastRunAt
      : null;
    const statusRaw = str(c.lastRunStatus);
    const health: AoLiveCardHealth =
      statusRaw === "ok" || statusRaw === "failed" || statusRaw === "capped" || statusRaw === "skipped"
        ? statusRaw
        : "none";
    cards.push({
      slug,
      name,
      desc: str(c.description),
      updated: lastRunAt !== null ? `Updated ${relativeTimeSince(lastRunAt, nowMs)}` : "No runs yet",
      metric: str(c.lastMetric) || `${num(c.papersCount, 0)} papers tracked`,
      health,
    });
  }
  return cards.length > 0 ? cards : null;
}

/**
 * Live landing cards — ONLY mount under ConvexProvider (AlwaysOnCards gates on
 * HAS_CONVEX + error boundary). Loading / empty / malformed → null (demo).
 */
export function useLivePublicRoomCards(): AoLiveCard[] | null {
  const raw = useQuery(alwaysOnApi.listPublicRooms, {});
  return useMemo(() => (raw === undefined || raw === null ? null : normalizeRoomCards(raw)), [raw]);
}
