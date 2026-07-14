/* ============================================================================
   NodeAgent Mobile — live store binding.
   Reads the live room from useStore() and reshapes it into the props MobileApp
   expects, then renders MobileApp with `live` set. This component always runs
   under a store provider (mounted by MobileRoot), so useStore() is safe here.
   Wired surfaces (this pass): room metadata + the public room chat (the wedge).
   Unsupported panels render explicit unavailable states instead of sample data.
   ============================================================================ */
import { useCallback, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReference } from "convex/server";
import { useStore, type ActorProof } from "../../app/store";
import type { Actor, Message, Member, CellStatus, Artifact, CellEvidence, CellPayload, Proposal, TraceEvent } from "../../engine/types";
import type { RoomMsg, Person, AgentMsg, Row, Tone, InboxItem, Job, RecentItem, RecentSig, Plan, Evidence, EvidenceSupport, Coach, PipelineStage, TraceRow, ManageGroup, ManagedPerson, OfflineHold, NotifRow, DeckStatus, SlideStatus } from "./mobileData";
import { MOBILE_TRACE_MAX, slideDoc } from "./mobileData";
import type { MobileDeckArtifact, MobileLive } from "./mobileTypes";
import {
  buildDeckObjectProposalGoal,
  buildDeckStoryboardFromRoom,
  collaborativeDeckArtifactInput,
  deckArtifactInputFromStoryboard,
  deckSlideElementId,
  isCollaborativeDeckArtifact,
  readCollaborativeDeckArtifact,
  readCollaborativeDeckProposal,
  type CollaborativeDeckSnapshot,
  type DeckStoryboard,
} from "../workArtifacts";
import { groupPeople, liveLocationFor } from "../PeoplePanel";
import { MobileApp } from "./MobileApp";

const AGENT_KEY = "room_na";

// convex/_generated lags until the next codegen — which must NOT be run casually
// (`npx convex codegen` against a cloud deployment DEPLOYS schema+functions).
// Same cast precedent as src/ui/NotificationsInbox.tsx watchesApi.
type WatchRowLive = { targetKind: "row" | "artifact"; targetId: string; updatedAt: number };
type RoomScopedArgs = { roomId: string; requester: ActorProof };
type SetWatchArgs = RoomScopedArgs & { targetKind: "row" | "artifact"; targetId: string; on: boolean };
const watchesApi = (api as unknown as {
  watches: {
    listWatches: FunctionReference<"query", "public", RoomScopedArgs, WatchRowLive[]>;
    setWatch: FunctionReference<"mutation", "public", SetWatchArgs, { on: boolean; changed: boolean }>;
  };
}).watches;

/** Map a room TraceEvent.type to the short chip vocabulary the mobile Trace sheet uses. */
function traceKind(type: TraceEvent["type"]): string {
  if (type === "edit_applied") return "commit";
  if (type === "edit_proposed" || type === "proposal_resolved" || type === "proposal_resolve_failed") return "proposal";
  if (type === "edit_blocked") return "blocked";
  if (type.startsWith("lock_")) return "lock";
  if (type.startsWith("agent_")) return "agent";
  if (type === "member_joined" || type === "room_created") return "room";
  if (type === "notebook_read_model") return "cite";
  return type.split("_")[0] || "event";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

const DECK_PATCH_FIELDS = ["title", "purpose", "speakerNote", "status"] as const;
type DeckPatchField = (typeof DECK_PATCH_FIELDS)[number];

function deckPatchReview(
  proposal: Proposal,
  deck: CollaborativeDeckSnapshot | null,
  artifacts: Artifact[],
): InboxItem["review"] | undefined {
  if (!deck) return undefined;
  const candidate = readCollaborativeDeckProposal(proposal, deck.artifactId);
  const raw = candidate?.objectPatch?.value;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const patch = raw as Record<string, unknown>;
  if (patch.kind !== "slide_patch" || typeof patch.slideId !== "string" || !patch.changes || typeof patch.changes !== "object" || Array.isArray(patch.changes)) return undefined;
  const slide = deck.storyboard.slides.find((item) => item.slideId === patch.slideId);
  if (!slide) return undefined;
  const changes = patch.changes as Record<string, unknown>;
  const changed = DECK_PATCH_FIELDS.flatMap((field) => typeof changes[field] === "string" ? [[field, changes[field] as string] as const] : []);
  if (changed.length === 0) return undefined;
  const beforeValue = (field: DeckPatchField): string => {
    if (field === "speakerNote") return slide.speakerNote ?? "(none)";
    return String(slide[field]);
  };
  const label = (field: DeckPatchField): string => field === "speakerNote" ? "Speaker note" : field[0].toUpperCase() + field.slice(1);
  const sourceLabels = Array.from(new Set(slide.sourceArtifactIds.flatMap((id) => {
    const artifact = artifacts.find((candidate) => candidate.id === id);
    return artifact ? [artifact.title] : [];
  })));
  const traceIds = Array.from(new Set([
    ...deck.storyboard.traceIds,
    ...slide.claims.map((claim) => claim.traceId),
  ])).filter((id): id is string => typeof id === "string" && id.length > 0).slice(0, 6);
  return {
    target: `Slide ${deck.storyboard.slides.indexOf(slide) + 1} - ${slide.title}`,
    before: changed.map(([field]) => `${label(field)}: ${beforeValue(field)}`).join("\n"),
    after: changed.map(([field, value]) => `${label(field)}: ${value}`).join("\n"),
    sources: sourceLabels,
    traceIds,
  };
}

function buildPeople(members: Member[]): Record<string, Person> {
  const out: Record<string, Person> = {
    [AGENT_KEY]: { short: "NA", name: "Room NodeAgent", color: "#C08A5E", agent: true },
  };
  for (const m of members) out[m.id] = { short: initials(m.name), name: m.name, color: m.color };
  return out;
}

// Live Message -> mobile RoomMsg. The rich summary/artifact card variants have no
// server shape (see the integration map's keepMock list); live messages render as
// plain chat / agent text, with agent authorship driving the agent styling.
function reshapeMessages(messages: Message[]): RoomMsg[] {
  return messages.map((m): RoomMsg => {
    // The store paints optimistic sends as "opt-<clientMsgId>" rows before the
    // server confirms — surface them as pending so the bubble reads as "sending".
    const optimistic = m.id.startsWith("opt-");
    return {
      id: m.id,
      who: m.author.kind === "agent" ? AGENT_KEY : m.author.id,
      kind: "msg",
      t: optimistic ? "now" : relTime(m.createdAt),
      text: m.text,
      ...(optimistic ? { pending: true, clientId: m.id } : {}),
    };
  });
}

// Live Message -> mobile AgentMsg (1:1 agent-convo style): user-authored -> user bubble,
// agent-authored -> agent text bubble.
function reshapeAgentMsgs(messages: Message[]): AgentMsg[] {
  return messages.map((m): AgentMsg =>
    m.author.kind === "user" ? { id: m.id, role: "user", text: m.text } : { id: m.id, role: "agent", variant: "text", text: m.text });
}

// ── live sheet row projection; the synthetic sample keeps its named row ─────
const RESEARCH_ROW = "rc_cardionova";
const ROW_FIELDS: { col: string; label: string }[] = [
  { col: "intent", label: "Product" },
  { col: "funding", label: "Funding" },
  { col: "headcount", label: "Headcount" },
  { col: "owner", label: "Contact" },
];

// A cell's value is either a raw seed string or an enriched CellPayload { value, status, evidence }.
function cellPayload(value: unknown): { value: unknown; status?: CellStatus } {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return value as { value: unknown; status?: CellStatus };
  }
  return { value };
}
function fullCellPayload(value: unknown): CellPayload {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) return value as CellPayload;
  return { value };
}
function cellDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
function cellTone(s?: CellStatus): Tone {
  if (s === "complete") return "ok";
  if (s === "needs_review" || s === "running") return "warn";
  if (s === "gap" || s === "failed") return "bad";
  return "mute";
}

export function projectMobileSheetRow(artifact: Artifact | undefined, sampleResearch = false): Row {
  if (!artifact) return { entity: "No live sheet", sub: "No live sheet artifact is available", fields: [] };
  const fields = sampleResearch
    ? ROW_FIELDS.map(({ col, label }) => {
        const elementId = `${RESEARCH_ROW}__${col}`;
        const el = artifact.elements[elementId];
        const payload = cellPayload(el?.value);
        return { k: label, v: cellDisplay(payload.value), status: payload.status ?? "", tone: cellTone(payload.status), elementId, version: el?.version ?? 0 };
      })
    : (artifact.order.length ? artifact.order : Object.keys(artifact.elements)).slice(0, 8).map((elementId) => {
        const el = artifact.elements[elementId];
        const payload = cellPayload(el?.value);
        const columnId = elementId.includes("__") ? elementId.slice(elementId.lastIndexOf("__") + 2) : elementId;
        const column = artifact.meta?.dataframe?.columns.find((candidate) => candidate.id === columnId);
        return {
          k: column?.label ?? elementId,
          v: cellDisplay(payload.value),
          status: payload.status ?? "",
          tone: cellTone(payload.status),
          elementId,
          version: el?.version ?? 0,
        };
      });
  return {
    entity: sampleResearch ? "CardioNova" : artifact.title,
    sub: `${artifact.title} · live sheet preview`,
    fields,
  };
}

export function resolveMobileExperience(
  serverExperience: "workspace" | "sample" | undefined,
  sessionHint: "workspace" | "sample" | undefined,
): "workspace" | "sample" {
  return serverExperience ?? sessionHint ?? "workspace";
}

// Live room artifacts -> Home recents. Real titles/kinds/edit-times; the sheet
// signature samples the first cells' tones (elements are already loaded).
function buildArtifactRecents(artifacts: Artifact[]): RecentItem[] {
  return artifacts.slice(0, 8).map((a): RecentItem => {
    const icon = a.kind === "sheet" ? "table" : a.kind === "wall" ? "layers" : "note";
    const count = a.order?.length ?? Object.keys(a.elements).length;
    const sig: RecentSig =
      a.kind === "sheet"
        ? { type: "sheet", cells: Object.values(a.elements).slice(0, 12).map((e) => cellTone(cellPayload(e.value).status)) }
        : { type: a.kind };
    return {
      id: a.id,
      icon,
      title: a.title,
      meta: relTime(a.updatedAt) + " · " + count + (a.kind === "sheet" ? " cells" : " blocks"),
      kind: a.kind,
      peek: "Opens on desktop",
      sig,
    };
  });
}

export function buildMobileRecents(
  artifacts: Artifact[],
  deck?: Pick<MobileDeckArtifact, "id" | "title" | "slides" | "status" | "sourceGaps">,
): RecentItem[] {
  const artifactRecents = buildArtifactRecents(artifacts);
  if (!deck) return artifactRecents;
  const slideCount = deck.slides.length;
  const reviewCount = deck.slides.filter((slide) => slide.status === "needs_review").length;
  const deckRecent: RecentItem = {
    id: `deck:${deck.id}`,
    icon: "layers",
    title: deck.title,
    meta: `governed deck - ${slideCount} slide${slideCount === 1 ? "" : "s"} - ${deck.status}`,
    kind: "deck",
    peek: deck.sourceGaps
      ? `${deck.sourceGaps} evidence gap${deck.sourceGaps === 1 ? "" : "s"} remain`
      : "Source-backed storyboard ready for review",
    sig: { type: "deck", count: slideCount, active: reviewCount, status: deck.status },
  };
  return [deckRecent, ...artifactRecents].slice(0, 8);
}

function sourceHost(e: CellEvidence): string | undefined {
  const raw = e.url || e.source;
  if (!raw) return undefined;
  try { return new URL(raw).hostname.replace(/^www\./, ""); } catch { return raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0]; }
}

function supportFromEvidence(e: CellEvidence, idx: number, claim: string, status?: CellStatus): EvidenceSupport {
  return {
    kind: "cite",
    n: String(idx + 1),
    text: e.label || e.snippet || claim,
    host: sourceHost(e),
    verified: status === "complete" || (e.confidence ?? 0) >= 0.72,
    srcType: e.kind,
    url: e.url,
    excerpt: e.snippet,
  };
}

function buildLiveEvidence(artifacts: Artifact[]): Evidence {
  const support: EvidenceSupport[] = [];
  const gaps: EvidenceSupport[] = [];
  for (const artifact of artifacts) {
    for (const id of artifact.order.length ? artifact.order : Object.keys(artifact.elements)) {
      const el = artifact.elements[id];
      const payload = fullCellPayload(el?.value);
      const value = cellDisplay(payload.value);
      const claim = `${artifact.title} ${id}: ${value}`.slice(0, 120);
      for (const ev of (payload.evidence ?? []).slice(0, 2)) {
        if (support.length < 6) support.push(supportFromEvidence(ev, support.length, claim, payload.status));
      }
      if ((payload.status === "gap" || payload.status === "needs_review" || payload.status === "failed") && gaps.length < 4) {
        gaps.push({ kind: "gap", text: `${artifact.title} ${id} is ${payload.status}${value !== "-" ? `: ${value}` : ""}`.slice(0, 140) });
      }
      if (support.length >= 6 && gaps.length >= 4) break;
    }
    if (support.length >= 6 && gaps.length >= 4) break;
  }
  const total = support.length;
  const gapCount = gaps.length;
  const supportList: EvidenceSupport[] = total ? [...support, ...gaps] : [{ kind: "gap", text: "No source-backed cells are present in this room yet." }];
  return {
    claim: total ? "Live room evidence" : "No evidence yet",
    status: gapCount ? "needs_review" : total ? "source-backed" : "empty",
    answer: total
      ? `${total} cited source${total === 1 ? "" : "s"} found across the room. ${gapCount ? `${gapCount} item${gapCount === 1 ? "" : "s"} still need review.` : "No flagged gaps found in the sampled cells."}`
      : "Upload a source, run NodeAgent, or fill source-backed cells to populate this evidence sheet.",
    support: supportList,
    followups: [
      { match: ["source", "cite", "citation"], text: total ? "Open any source row above to inspect the citation. Desktop can show the source side by side with the work surface." : "There are no citations yet. Start with a source upload or a read-only agent run." },
      { match: ["gap", "missing", "review"], text: gapCount ? gaps.map((g) => g.text).join(" ") : "No sampled evidence gaps are currently flagged." },
      { match: ["close", "fix"], text: "Close gaps by attaching a primary source, rerunning evidence extraction, then approving the proposed change from the review queue." },
    ],
    fallback: "This evidence sheet is derived from the live room artifacts, not the standalone sample data.",
  };
}

function buildLivePlan(artifacts: Artifact[], proposals: InboxItem[], job: { status?: string; entrypoint?: string; modelPolicy?: string } | null | undefined): Plan {
  const readable = artifacts.slice(0, 5).map((a) => `${a.title} (${a.kind})`);
  const pending = proposals.length;
  const running = job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(job.status ?? "");
  return {
    hash: `live-${artifacts.length}-${pending}`,
    entity: artifacts.find((a) => a.title.includes("Company"))?.title ?? "this room",
    willRead: readable.length ? readable : ["Room chat and any uploaded source files"],
    wontRead: ["Private agent lanes", "External data not explicitly fetched", "Anything outside this room"],
    willCreate: [
      pending ? `Resolve ${pending} pending proposal${pending === 1 ? "" : "s"}` : "Propose source-backed changes before writing",
      running ? `Track ${job?.entrypoint ?? "agent job"} until completion` : "Keep evidence and trace receipts attached",
    ],
    stats: [
      { v: String(artifacts.length), l: "artifacts", mono: true },
      { v: String(pending), l: "reviews", mono: true },
      { v: job?.modelPolicy ?? "room", l: running ? "running" : "scope", mono: false },
    ],
  };
}

function buildLiveCoach(evidence: Evidence, artifacts: Artifact[], proposals: InboxItem[]): Coach {
  const gap = evidence.support.find((s) => s.kind === "gap")?.text;
  const topic = gap || (proposals.length ? "pending agent edit" : artifacts[0]?.title ?? "room evidence");
  return {
    topics: [
      {
        id: "live-evidence",
        label: "Evidence defense",
        question: `Explain the current evidence status for ${topic}.`,
        howto: [
          "Name the claim or artifact.",
          "State which source supports it.",
          "Call out any missing primary source.",
          "Say the action that would move it to verified.",
        ],
        feedback: {
          well: "You anchored the answer to the live room evidence.",
          missed: gap ? "Be precise about the missing source: " + gap : "Mention the exact artifact or citation you inspected.",
          cite: evidence.support.find((s) => s.kind === "cite")?.text ?? "Attach a primary source before calling the claim verified.",
          wording: evidence.status === "source-backed" ? "This claim is source-backed in the room and can be defended with the cited artifact." : "This claim remains needs_review until the missing source is attached and the evidence check reruns.",
        },
      },
    ],
  };
}

function escapeSlideText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function storyboardSlideStatus(status: DeckStoryboard["slides"][number]["status"], verified: boolean): SlideStatus {
  if (status === "needs_review") return "needs_review";
  return verified ? "approved" : "draft";
}

function storyboardDeckStatus(storyboard: DeckStoryboard): DeckStatus {
  return storyboard.storyboardStatus === "needs_review" || storyboard.unresolvedGaps.length > 0 ? "proposed" : "approved";
}

function mobileDeckFromStoryboard(
  storyboard: DeckStoryboard,
  options: { artifactId?: string; proposalIds?: string[] } = {},
): MobileDeckArtifact {
  const workArtifact = deckArtifactInputFromStoryboard(storyboard);
  const proposalIds = Array.from(new Set([...storyboard.proposalIds, ...(options.proposalIds ?? [])]));
  const slides = storyboard.slides.map((slide, index) => {
    const verified = slide.claims.length > 0 && slide.claims.every((claim) => claim.status === "verified");
    const claims = slide.claims.slice(0, 4).map((claim) =>
      `<li>${escapeSlideText(claim.text)}${claim.status === "verified" ? "" : " - needs review"}</li>`,
    ).join("");
    const gaps = slide.unresolvedGaps.slice(0, 3).map((gap) => `<li>${escapeSlideText(gap)}</li>`).join("");
    return {
      id: slide.slideId,
      index: index + 1,
      title: slide.title,
      status: storyboardSlideStatus(slide.status, verified),
      html: slideDoc(
        `<div class="k">Live storyboard - ${escapeSlideText(slide.purpose)}</div><div class="spacer"></div>` +
          `<h1 class="mid">${escapeSlideText(slide.title)}</h1>` +
          `<ul style="margin-top:18px">${claims || "<li>No claims extracted yet</li>"}</ul>` +
          (gaps ? `<p style="margin-top:14px">Open gaps:</p><ul>${gaps}</ul>` : "") +
          `<div class="spacer"></div><span class="badge ${slide.status === "needs_review" ? "nr" : "ok"}">${slide.status}</span>`,
      ),
    };
  });
  const firstGap = storyboard.unresolvedGaps[0] ?? storyboard.requiredEvidence[0] ?? "Unsupported claim";
  return {
    id: storyboard.deckId,
    storyboard,
    roomId: storyboard.roomId,
    workArtifactId: options.artifactId ?? workArtifact.id,
    traceIds: storyboard.traceIds,
    sourceIds: storyboard.sourceArtifactIds,
    proposalIds,
    readonly: true,
    fallbackReason: "Live mobile renders the governed storyboard; revision requests route through the room agent and proposals.",
    title: storyboard.title,
    audience: storyboard.audience,
    status: storyboardDeckStatus(storyboard),
    planHash: storyboard.planHash,
    privacy: "Room",
    exportState: storyboard.unresolvedGaps.length ? "not_started" : "ready",
    exportFormat: "PPTX",
    exportSize: "receipt pending",
    sourceGaps: storyboard.unresolvedGaps.length,
    plan: {
      goal: storyboard.objective,
      todos: [
        { text: "Read live room artifacts", status: storyboard.sourceArtifactIds.length ? "done" : "todo" },
        { text: "Map claims to evidence", status: storyboard.requiredEvidence.length ? "running" : "done" },
        { text: "Review pending proposals", status: proposalIds.length ? "running" : "done" },
        { text: "Produce export receipt", status: storyboard.unresolvedGaps.length ? "todo" : "done" },
      ],
      ran: Math.max(1, storyboard.sourceArtifactIds.length + storyboard.traceIds.length),
      guard: "Read-only storyboard projection - live revision requests must produce a host-reviewed proposal.",
      willRead: storyboard.sourceArtifactIds.length ? storyboard.sourceArtifactIds.map((id) => `Artifact ${id}`) : ["Live room artifacts"],
      willCreate: ["Governed patch request", "PPTX download receipt"],
      wontWrite: ["Deck HTML", "Notebook text", "Sheet cells"],
      stats: [
        { v: String(storyboard.slides.length), l: "slides", mono: true },
        { v: String(storyboard.unresolvedGaps.length), l: "gaps", mono: true },
        { v: String(proposalIds.length), l: "proposals", mono: true },
      ],
    },
    slides,
    patchSample: {
      target: proposalIds[0] ? `Proposal ${proposalIds[0]}` : "Storyboard claim",
      before: firstGap,
      after: "Keep the claim marked needs_review until a source-backed proposal is accepted.",
      evidence: storyboard.slides.flatMap((slide) => slide.claims).slice(0, 2).map((claim, index) => ({
        n: String(index + 1),
        text: claim.text,
        verified: claim.status === "verified",
      })),
    },
    receipt: {
      reads: { planned: storyboard.sourceArtifactIds.length, actual: storyboard.sourceArtifactIds.length },
      writes: { planned: 0, actual: 0 },
      cost: { planned: "room policy", actual: "not run from mobile" },
      coverage: `${storyboard.requiredEvidence.length} claims need evidence`,
      gaps: storyboard.unresolvedGaps,
      files: ["Mobile storyboard preview", "PPTX export with integrity receipt"],
    },
    versions: [
      { v: `v${storyboard.version}`, label: "Live storyboard projection", t: "now", current: true },
    ],
  };
}

export function MobileAppLive({ roomId, me, proof, experienceHint, onLeave, onSignOut }: {
  roomId: string;
  me: Actor;
  proof?: ActorProof;
  experienceHint?: "workspace" | "sample";
  onLeave?: () => void;
  onSignOut?: () => void;
}) {
  const store = useStore();
  const room = store.getRoom(roomId);
  // First-load signal: in the Convex store getRoom() is the ONLY accessor that
  // returns undefined until the first server round-trip (every other accessor
  // coalesces to []). Memory mode is synchronous so room is never undefined and
  // loading stays false. Anti-blank guard: meta is reactive and can transiently
  // flip back to undefined on re-subscribe (room switch / token refresh); hold
  // the last non-undefined room in a ref and only report loading on the genuine
  // first load (no cached data yet), never on a transient undefined mid-session.
  const lastRoom = useRef(room);
  if (room !== undefined) lastRoom.current = room;
  const loading = lastRoom.current === undefined;
  const members = store.listMembers(roomId);
  const messages = store.listMessages(roomId, "public");
  const privateMsgs = store.listMessages(roomId, { private: me.id });

  const artifacts = store.listArtifacts(roomId);
  const collaborativeDeckArtifact = useMemo(() => artifacts.find(isCollaborativeDeckArtifact), [artifacts]);
  const collaborativeDeck = useMemo(
    () => collaborativeDeckArtifact ? readCollaborativeDeckArtifact(collaborativeDeckArtifact) : null,
    [collaborativeDeckArtifact],
  );
  const sourceArtifacts = useMemo(() => artifacts.filter((artifact) => !isCollaborativeDeckArtifact(artifact)), [artifacts]);
  const deckArtifactCreateRef = useRef<{ roomId: string; promise: Promise<string> } | null>(null);
  const sampleResearchSheet = room?.experience === "sample"
    ? sourceArtifacts.find((a) => a.kind === "sheet" && a.title === "Company research")
    : undefined;
  const mobileSheet = sampleResearchSheet ?? sourceArtifacts.find((a) => a.kind === "sheet");
  const mobileSheetArtifact = mobileSheet ? store.getArtifact(mobileSheet.id) : undefined;
  const liveRow: Row = useMemo(
    () => projectMobileSheetRow(mobileSheetArtifact, !!sampleResearchSheet),
    [mobileSheetArtifact, sampleResearchSheet],
  );
  const editRowField = async (elementId: string, value: string, baseVersion: number) => {
    if (!mobileSheet) return { ok: false, reason: "no_sheet" };
    return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: mobileSheet.id, elementId, kind: "set", value, baseVersion }, actor: me });
  };

  const proposals = store.listProposals(roomId);
  const job = store.lastLongFreeJob();
  const isHost = members.some((m) => m.id === me.id && m.role === "host");
  const inboxItems: InboxItem[] = useMemo(() => proposals.map((p): InboxItem => {
    const review = deckPatchReview(p, collaborativeDeck, sourceArtifacts);
    return {
      id: p.id,
      icon: review ? "layers" : "sparkles",
      tone: "accent",
      title: review ? "Deck slide proposal" : "Agent edit proposed",
      sub: review ? `${review.target} - review before it lands` : `Cell ${p.op.elementId} - approve before it lands`,
      status: "approve",
      statusTone: "warn",
      time: relTime(p.createdAt),
      kind: review ? "deck" : "plan",
      preview: review ? "deck" : "doc",
      review,
    };
  }), [collaborativeDeck, proposals, sourceArtifacts]);
  const jobs: { running: Job[]; queued: Job[]; completed: Job[] } = useMemo(() => {
    const oneJob: Job | null = job
      ? { id: job.id, title: job.entrypoint ?? "Agent job", sub: job.status + (job.error ? " · " + job.error : ""), cost: "", route: job.modelPolicy as Job["route"], trace: job.id }
      : null;
    const out: { running: Job[]; queued: Job[]; completed: Job[] } = { running: [], queued: [], completed: [] };
    if (job && oneJob) {
      const s = job.status;
      const bucket = s === "running" ? "running" : s === "queued" || s === "paused" || s === "blocked" || s === "retrying" ? "queued" : "completed";
      out[bucket].push(oneJob);
    }
    return out;
  }, [job]);
  const liveEvidence = useMemo(() => buildLiveEvidence(sourceArtifacts), [sourceArtifacts]);
  const livePlan = useMemo(() => buildLivePlan(sourceArtifacts, inboxItems, job), [inboxItems, job, sourceArtifacts]);
  const liveCoach = useMemo(() => buildLiveCoach(liveEvidence, sourceArtifacts, inboxItems), [liveEvidence, sourceArtifacts, inboxItems]);

  // ── gap pack: pipeline (same live data the desktop pipeline bar reads) ──
  // Intake = any artifact rows exist; Evidence = any source-backed cell; Draft =
  // an agent job is running; Review = pending proposals; Export = nothing left
  // to review and something to export. Honest states, no faked completion.
  const sessions = store.listSessions(roomId);
  const pipeline: PipelineStage[] = useMemo(() => {
    const sheet = artifacts.find((a) => a.kind === "sheet");
    const rowCount = sheet ? (sheet.order.length ? sheet.order.length : Object.keys(sheet.elements).length) : 0;
    let cited = 0, review = 0;
    for (const a of artifacts) {
      for (const id of a.order.length ? a.order : Object.keys(a.elements)) {
        const p = fullCellPayload(a.elements[id]?.value);
        if ((p.evidence?.length ?? 0) > 0) cited += 1;
        if (p.status === "needs_review" || p.status === "gap" || p.status === "failed") review += 1;
      }
    }
    const running = job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(job.status ?? "");
    const pending = inboxItems.length;
    const intakeDone = rowCount > 0;
    const evidenceDone = cited > 0;
    return [
      { key: "intake", label: "Intake", state: intakeDone ? "done" : "on", meta: rowCount ? `${rowCount} rows` : "waiting" },
      { key: "evidence", label: "Evidence", state: evidenceDone ? "done" : intakeDone ? "on" : "todo", meta: cited ? `${cited} sourced` : "" },
      { key: "draft", label: "Draft", state: running ? "on" : evidenceDone ? "done" : "todo", meta: running ? "agent working" : "" },
      { key: "review", label: "Review", state: pending ? "on" : "todo", meta: pending ? `${pending} waiting` : review ? `${review} flagged` : "0 waiting" },
      { key: "export", label: "Export", state: intakeDone && pending === 0 ? "on" : "todo", meta: "" },
    ];
  }, [artifacts, job, inboxItems.length]);

  // ── gap pack: recent trace rows (bounded — agentic-reliability BOUND) ──
  const traceEvents = store.listTraces(roomId);
  const traceRows: TraceRow[] = useMemo(() => {
    return traceEvents
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MOBILE_TRACE_MAX)
      .map((e): TraceRow => ({ id: e.id, kind: traceKind(e.type), text: e.summary, time: relTime(e.ts) }));
  }, [traceEvents]);

  const liveDeck = useMemo(() => {
    if (!collaborativeDeck && sourceArtifacts.length === 0 && proposals.length === 0) return undefined;
    const storyboard = collaborativeDeck?.storyboard ?? buildDeckStoryboardFromRoom({
      roomId,
      roomTitle: room?.title ?? "Room",
      artifacts: sourceArtifacts,
      traces: traceEvents,
      proposals,
      maxSlides: 5,
    });
    const deckProposalIds = collaborativeDeck
      ? proposals.filter((proposal) => proposal.artifactId === collaborativeDeck.artifactId).map((proposal) => proposal.id)
      : [];
    return mobileDeckFromStoryboard(storyboard, {
      artifactId: collaborativeDeck?.artifactId,
      proposalIds: deckProposalIds,
    });
  }, [collaborativeDeck, proposals, room?.title, roomId, sourceArtifacts, traceEvents]);

  // ── gap pack: role-grouped people + live location (same as desktop PeoplePanel) ──
  const peopleGroups: ManageGroup[] = useMemo(() => {
    const groups = groupPeople(members, sessions);
    return groups.map((g): ManageGroup => ({
      key: g.key,
      label: g.label,
      rows: g.rows.map((r): ManagedPerson => {
        const loc = r.kind === "user" ? liveLocationFor(r.id, roomId, store) : null;
        return {
          id: r.id,
          name: r.name,
          short: initials(r.name),
          color: r.color,
          role: g.key,
          location: loc?.text ?? "",
        };
      }),
    }));
  }, [members, sessions, roomId, store]);

  // ── gap pack: offline hold snapshot (store owns the real queue) ──
  const offline: OfflineHold | undefined = store.offlineEditQueue ? store.offlineEditQueue() : undefined;

  // ── gap pack: auto-allow (real room flag; toggle hits the store) ──
  const autoAllow = room?.autoAllow ?? false;
  const setAutoAllow = useCallback((next: boolean) => {
    // toggleAutoAllow flips; only fire when the desired state differs from current.
    if (next !== (room?.autoAllow ?? false)) store.toggleAutoAllow(roomId, me);
  }, [store, roomId, me, room?.autoAllow]);

  // ── gap pack: watches (wave-2 backend via typed-cast) ──
  const watchArgs = proof ? { roomId: roomId as never, requester: proof } : "skip";
  const watchRowsQ = useQuery(watchesApi.listWatches, watchArgs) ?? [];
  const setWatchMut = useMutation(watchesApi.setWatch);
  const watchedRowIds = useMemo(
    () => new Set(watchRowsQ.filter((w) => w.targetKind === "row").map((w) => w.targetId)),
    [watchRowsQ],
  );
  const notifBacked = !!proof;
  const notifRows: NotifRow[] = useMemo(() => {
    const watching = watchedRowIds.size;
    return [
      { label: "@mentions of you", mode: "instant", on: true, backed: false },
      { label: "Rows you watch", mode: "instant", on: watching > 0, backed: notifBacked },
      { label: "Agent run summaries", mode: "hourly", on: true, backed: false },
      { label: "Everything else", mode: "daily digest", on: false, backed: false },
    ];
  }, [watchedRowIds, notifBacked]);

  // Per-render reshapes memoized so re-renders that don't change the underlying
  // store data (e.g. a sibling state toggle) don't recompute identical arrays.
  // Results are byte-identical to the inline calls; deps are the exact inputs.
  const roomMsgs = useMemo(() => reshapeMessages(messages), [messages]);
  const people = useMemo(() => buildPeople(members), [members]);
  const recents = useMemo(() => buildMobileRecents(artifacts, liveDeck), [artifacts, liveDeck]);
  const agentPrivate = useMemo(() => reshapeAgentMsgs(privateMsgs), [privateMsgs]);
  const agentRoom = useMemo(
    () => reshapeAgentMsgs(messages.filter((m) => m.author.kind === "agent" || m.author.id === me.id)),
    [messages, me.id],
  );

  const live: MobileLive = {
    roomName: room?.title ?? "Room",
    roomCode: room?.code ?? "",
    experience: resolveMobileExperience(room?.experience, experienceHint),
    starterBackfill: room?.starterBackfill,
    starterProfile: room?.starterProfile,
    liveCount: members.length,
    roomMsgs,
    people,
    recents,
    plan: livePlan,
    evidence: liveEvidence,
    coach: liveCoach,
    deck: liveDeck,
    postRoomMessage: async (text: string) => {
      return store.postMessage({ roomId, channel: "public", author: me, text, clientMsgId: crypto.randomUUID(), kind: "chat" });
    },
    agentPrivate,
    agentRoom,
    askPrivateAgent: async (goal: string) => {
      void store.postMessage({ roomId, channel: { private: me.id }, author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askPrivateAgent({ goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    askRoomAgent: async (goal, modelSelection) => {
      void store.postMessage({ roomId, channel: "public", author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askAgent(modelSelection ? { goal, modelSelection } : { goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    requestDeckPatch: async ({ reviewerRequest, slideId, targetField }, modelSelection) => {
      const storyboard = collaborativeDeck?.storyboard ?? liveDeck?.storyboard;
      const slide = storyboard?.slides.find((candidate) => candidate.slideId === slideId);
      if (!storyboard || !slide) return { ok: false, reason: "deck_slide_not_found" };
      const elementId = deckSlideElementId(slide.slideId);
      try {
        let artifactId = collaborativeDeck?.artifactId;
        let baseVersion = collaborativeDeck?.objectVersions[elementId] ?? 0;
        if (!artifactId) {
          if (!deckArtifactCreateRef.current || deckArtifactCreateRef.current.roomId !== roomId) {
            deckArtifactCreateRef.current = {
              roomId,
              promise: store.uploadArtifact({
                roomId,
                artifact: collaborativeDeckArtifactInput(storyboard),
                actor: me,
                visibility: "room",
              }),
            };
          }
          try {
            artifactId = await deckArtifactCreateRef.current.promise;
          } catch (error) {
            deckArtifactCreateRef.current = null;
            throw error;
          }
          baseVersion = 1;
        }
        const goal = buildDeckObjectProposalGoal({
          artifactId,
          storyboard,
          slide,
          baseVersion,
          reviewerRequest,
          targetField,
        });
        const posted = await store.postMessage({
          roomId,
          channel: "public",
          author: me,
          text: `Deck revision request for "${slide.title}": ${reviewerRequest}`,
          clientMsgId: crypto.randomUUID(),
          kind: "chat",
        });
        if (!posted.ok) return { ok: false, reason: posted.reason ?? "message_failed" };
        await store.askAgent({
          goal,
          ...(modelSelection ? { modelSelection } : {}),
          contextArtifactId: artifactId,
          contextArtifactRequired: true,
          allowedElementIds: [elementId],
          maxAttempts: 1,
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "deck_patch_failed" };
      }
    },
    row: liveRow,
    editRowField,
    inboxItems,
    jobs,
    canApprove: isHost,
    resolveProposalById: async (id, approve) => {
      try {
        const r = await store.resolveProposal(id, approve, me);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "approve_failed" };
      }
    },
    jobAct: async (id, action) => {
      const r = action === "cancel" ? await store.cancelLongFreeJob(id) : await store.retryLongFreeJob(id);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    onLeave,
    onSignOut,
    loading,

    // ── gap pack ──
    pipeline,
    traceRows,
    peopleGroups,
    inviteCode: room?.code ?? "",
    offline,
    acknowledgeOfflineConflicts: store.acknowledgeOfflineConflicts,
    autoAllow,
    setAutoAllow,
    notifRows,
    notifBacked,
    watchRow: async (rowId: string, on: boolean) => {
      if (!proof) return { ok: false, reason: "no_proof" };
      try {
        await setWatchMut({ roomId: roomId as never, requester: proof, targetKind: "row", targetId: rowId, on });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "watch_failed" };
      }
    },
    isRowWatched: (rowId: string) => watchedRowIds.has(rowId),
    flagRowNeedsReview: async (rowId: string) => {
      // Route through the existing CAS edit path: set the row's status column to
      // needs_review only when that live sheet exposes an existing status cell.
      if (!mobileSheet || !mobileSheetArtifact) return { ok: false, reason: "no_sheet" };
      const elementId = `${rowId}__status`;
      const el = mobileSheetArtifact.elements[elementId];
      if (!el) return { ok: false, reason: "status_field_unavailable" };
      const baseVersion = el?.version ?? 0;
      return store.applyEdit({
        roomId,
        op: { opId: crypto.randomUUID(), artifactId: mobileSheet.id, elementId, kind: "set", value: "needs_review", baseVersion },
        actor: me,
      });
    },
  };

  return <MobileApp live={live} />;
}
