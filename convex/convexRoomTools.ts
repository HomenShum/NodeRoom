/**
 * ConvexRoomTools — the RoomTools port implemented over Convex. It is the ONLY
 * thing that differs between the spike and production: the agent harness
 * (context.ts, tools.ts, runtime.ts) is byte-for-byte identical; here each method
 * just runs a Convex query/mutation instead of calling the in-memory engine.
 *
 * Note the result MAPPING: the Convex mutations return their own shapes
 * (`{ ok:false, reason:'conflict', ... }`); we translate them to the harness's
 * RoomTools shapes (`{ ok:false, conflict:true, ... }`) so the model sees one
 * stable contract regardless of transport.
 */

import { makeFunctionReference } from "convex/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { RoomTools, RoomSnapshot, AwarenessView, CellView, EditOutcome, MergeView, SourceResult, ArtifactRef, SpreadsheetContextHit } from "../src/nodeagent/core/types";
import type { Actor } from "../src/engine/types";

const artifactsGetSheetRef = makeFunctionReference<"query">("artifacts:getSheet") as any;
const collabAwarenessRef = makeFunctionReference<"query">("collab:awareness") as any;
const artifactsReadRangeRef = makeFunctionReference<"query">("artifacts:readRange") as any;
const artifactsSearchSheetContextRef = makeFunctionReference<"query">("artifacts:searchSheetContext") as any;
const locksProposeLockRef = makeFunctionReference<"mutation">("locks:proposeLock") as any;
const locksReleaseLockRef = makeFunctionReference<"mutation">("locks:releaseLock") as any;
const artifactsApplyAgentCellEditRef = makeFunctionReference<"mutation">("artifacts:applyAgentCellEdit") as any;
const draftsCreateDraftRef = makeFunctionReference<"mutation">("drafts:createDraft") as any;
const messagesSendAgentRef = makeFunctionReference<"mutation">("messages:sendAgent") as any;
const artifactsListForRoomRef = makeFunctionReference<"query">("artifacts:listForRoom") as any;

export class ConvexRoomTools implements RoomTools {
  constructor(
    private ctx: ActionCtx,
    private roomId: Id<"rooms">,
    private artifactId: Id<"artifacts">,
    private actor: Actor,
    private sessionId: string,
    private jobId?: Id<"agentJobs">,
  ) {}

  async snapshot(artifactId: string = this.artifactId): Promise<RoomSnapshot> {
    const s = await this.ctx.runQuery(artifactsGetSheetRef, { roomId: this.roomId, artifactId });
    return s ?? { artifactId, version: 0, kind: "sheet", rows: [] };
  }

  async listArtifacts(): Promise<ArtifactRef[]> {
    return this.ctx.runQuery(artifactsListForRoomRef, { roomId: this.roomId });
  }

  awareness(): Promise<AwarenessView> {
    return this.ctx.runQuery(collabAwarenessRef, { roomId: this.roomId, excludeAgentId: this.actor.id });
  }

  readRange(elementIds: string[], artifactId: string = this.artifactId): Promise<CellView[]> {
    return this.ctx.runQuery(artifactsReadRangeRef, { roomId: this.roomId, artifactId, elementIds });
  }

  searchSheetContext(query: string, artifactId: string = this.artifactId, limit = 8): Promise<SpreadsheetContextHit[]> {
    return this.ctx.runQuery(artifactsSearchSheetContextRef, { roomId: this.roomId, artifactId, query, limit });
  }

  async proposeLock(elementIds: string[], reason: string, artifactId: string = this.artifactId) {
    const r = await this.ctx.runMutation(locksProposeLockRef, { roomId: this.roomId, artifactId, elementIds, holder: this.actor, sessionId: this.sessionId, reason });
    return r.ok ? { ok: true as const, lockId: String(r.lockId) } : { ok: false as const, reason: r.reason, lockId: r.lockId ? String(r.lockId) : undefined };
  }

  async releaseLock(lockId: string): Promise<{ ok?: boolean; reason?: string; merged: MergeView[] }> {
    const r = await this.ctx.runMutation(locksReleaseLockRef, { lockId: lockId as Id<"locks">, actor: this.actor });
    if (!r.ok) return { ok: false, reason: r.reason, merged: [] };
    const merged = (r.merged ?? []).map((m: { draftId: unknown; verdict: string; applied: number; conflicts: number }) => ({ draftId: String(m.draftId), verdict: m.verdict, note: "", applied: m.applied, conflicts: m.conflicts }));
    return { merged };
  }

  async editCell(elementId: string, value: unknown, baseVersion: number, artifactId: string = this.artifactId, kind?: "set" | "create" | "delete"): Promise<EditOutcome> {
    const r = await this.ctx.runMutation(artifactsApplyAgentCellEditRef, { roomId: this.roomId, artifactId, elementId, value, baseVersion, kind, actor: this.actor, jobId: this.jobId });
    if (r.ok) return { ok: true, version: r.version, mutationReceiptId: r.mutationReceiptId ? String(r.mutationReceiptId) : undefined };
    if (r.reason === "conflict") return { ok: false, conflict: true, expected: r.expected, actual: r.actual };
    if (r.reason === "locked") return { ok: false, locked: true, holder: r.by };
    if (r.reason === "pending_approval") return { ok: false, pendingApproval: true, proposalId: r.proposalId ? String(r.proposalId) : undefined };
    return { ok: false, error: r.reason };
  }

  async createDraft(ops: { elementId: string; value: unknown; baseVersion: number }[], blockedByLockId: string, note: string, artifactId: string = this.artifactId) {
    const r = await this.ctx.runMutation(draftsCreateDraftRef, {
      roomId: this.roomId, artifactId, author: this.actor, note, blockedByLockId,
      ops: ops.map((o) => ({ opId: crypto.randomUUID(), artifactId: String(artifactId), elementId: o.elementId, kind: "set" as const, value: o.value, baseVersion: o.baseVersion })),
    });
    return { draftId: String(r.draftId) };
  }

  async say(text: string): Promise<void> {
    const channel = this.actor.scope === "private" && this.actor.ownerId ? this.actor.ownerId : "public";
    await this.ctx.runMutation(messagesSendAgentRef, { roomId: this.roomId, channel, author: this.actor, text, clientMsgId: crypto.randomUUID(), kind: "agent" });
  }

  /** Convex-standard-runtime source fetch: HTTPS-only, target-guarded, timeout-bound, and size-capped. */
  fetchSource(url: string): Promise<SourceResult> { return fetchSourceForConvex(url); }
}

export async function fetchSourceForConvex(url: string): Promise<SourceResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "https_required" };
  const hostBlock = blockedConvexFetchHost(parsed.hostname);
  if (hostBlock) return { ok: false, error: hostBlock };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(parsed.toString(), {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "NodeRoomAgent/0.1" },
    });
    if (res.status >= 300 && res.status < 400) return { ok: false, error: "redirect_not_followed" };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const raw = (await res.text()).slice(0, 50_000);
    const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim()
      || parsed.hostname;
    const snippet = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_200);
    return { ok: true, title, snippet, url: parsed.toString() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

function blockedConvexFetchHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host.includes("%")) return "blocked_host";
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "169.254.169.254"
  ) {
    return "blocked_private_or_metadata_host";
  }
  const v4 = normalizedIpv4(host);
  if (v4 && privateOrReservedIpv4(v4)) return "blocked_private_or_reserved_ip";
  if (privateOrReservedIpv6(host)) return "blocked_private_or_reserved_ip";
  return null;
}

function normalizedIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => {
    if (!/^\d+$/.test(part)) return Number.NaN;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : Number.NaN;
  });
  return nums.every((n) => Number.isInteger(n)) ? nums : null;
}

function privateOrReservedIpv4(ip: number[]): boolean {
  const [a, b] = ip;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function privateOrReservedIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("0:0:0:0:0:0:0:1")
  );
}
