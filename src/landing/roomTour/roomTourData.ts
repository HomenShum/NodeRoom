/* ============================================================================
   NodeAgent Room Tour — seed state (ported from room/data.js, window.NAR).
   Mirrors the public repo's contracts (realtimeRuntime, versionedSpreadsheetSync,
   memoryWallEngine, publicPrivateContracts) but for the scripted #room-tour
   walkthrough — NOT the live engine. The real product wires those contracts in
   convex/ + src/engine.
   ============================================================================ */

export type ActorKind = "human" | "agent";
export type ScreenId = "landing" | "create" | "join" | "room";
export type PanelId = "left" | "center" | "artifact" | "right";

export interface Person {
  id: string;
  name: string;
  short: string;
  role: string;
  kind: ActorKind;
  color: string;
  anon: boolean;
}
export const PEOPLE: Record<string, Person> = {
  homen:  { id: "homen",  name: "Homen",          short: "HS", role: "Host",         kind: "human", color: "#D97757", anon: false },
  priya:  { id: "priya",  name: "Priya",          short: "PR", role: "Finance lead", kind: "human", color: "#5E6AD2", anon: false },
  quokka: { id: "quokka", name: "anon · quokka",  short: "qk", role: "Guest",        kind: "human", color: "#5B8F71", anon: true  },
  room_na:{ id: "room_na",name: "Room NodeAgent", short: "NA", role: "Public agent", kind: "agent", color: "#C08A5E", anon: false },
  my_na:  { id: "my_na",  name: "Your NodeAgent", short: "na", role: "Private agent",kind: "agent", color: "#7B8794", anon: false },
};

export type ArtifactKind = "sheet" | "note" | "wall" | "doc";
export interface FileItem {
  id: string;
  name: string;
  kind: ArtifactKind;
  meta: string;
}
export const FILES: FileItem[] = [
  { id: "sheet_q3",    name: "Q3 variance",      kind: "sheet", meta: "v41 · 3 collaborators" },
  { id: "note_sync",   name: "Sync reliability", kind: "note",  meta: "edited 2m ago" },
  { id: "wall_ideas",  name: "Diligence wall",   kind: "wall",  meta: "6 notes" },
  { id: "doc_netsuite",name: "NetSuite export",  kind: "doc",   meta: "source · read-only" },
];

export interface ChatMessage {
  id: string;
  who: string;
  text: string;
  t: string;
  ask?: boolean;
  agent?: boolean;
  system?: boolean;
  private?: boolean;
}
export const PUBLIC_CHAT: ChatMessage[] = [
  { id: "c1", who: "priya",   text: "Pulling the NetSuite Q3 numbers into the variance sheet — revenue looks off vs the close.", t: "-8m" },
  { id: "c2", who: "quokka",  text: "joined as a guest. read-only on the sheet for now?", t: "-6m", system: false },
  { id: "c3", who: "homen",   text: "You can edit — I turned on collaborator access. Let me get the agent to reconcile the variance.", t: "-5m" },
  { id: "c4", who: "homen",   text: "/ask reconcile Q3 revenue against the NetSuite export and update the variance column", t: "-4m", ask: true },
  { id: "c5", who: "room_na", text: "On it. Gathering room context (chat + NetSuite export), then I’ll propose a versioned delta to the variance column. I’ll lock just the rows I touch.", t: "-4m", agent: true },
];
export const PRIVATE_CHAT: ChatMessage[] = [
  { id: "p1", who: "homen", text: "Private: why should null cells survive the sync instead of being treated as deletes?", t: "-3m", private: true },
  { id: "p2", who: "my_na", text: "null is a real blank value in the sheet, not an instruction to delete the row. The sync tool preserves it so a retried delta can’t silently drop data. This note stays private unless you promote it.", t: "-3m", agent: true, private: true },
];

export interface SheetRow {
  id: string;
  cells: Array<string | null>;
}
export interface SheetData {
  sheetId: string;
  version: number;
  columns: string[];
  rows: SheetRow[];
}
export const SHEET: SheetData = {
  sheetId: "sheet_q3", version: 41,
  columns: ["Account", "Q2", "Q3", "Variance", "Note"],
  rows: [
    { id: "r_rev",  cells: ["Revenue",      "$10,000", "$12,400", null, null] },
    { id: "r_cogs", cells: ["COGS",         "$4,000",  "$5,100",  null, null] },
    { id: "r_gp",   cells: ["Gross profit", "$6,000",  "$7,300",  null, null] },
    { id: "r_opex", cells: ["OpEx",         "$2,200",  "$2,650",  null, null] },
    { id: "r_ni",   cells: ["Net income",   "$3,800",  "$4,650",  null, null] },
  ],
};

export interface WallNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  by: string;
}
export const WALL: WallNote[] = [
  { id: "w1", x: 22,  y: 18,  text: "NetSuite export is the source of truth for Q3", color: "#E8C9B8", by: "priya" },
  { id: "w2", x: 256, y: 30,  text: "Variance = Q3 − Q2, show as %",                color: "#CBD2F0", by: "homen" },
  { id: "w3", x: 66,  y: 156, text: "Flag anything > 15% for review",               color: "#C5DBCB", by: "quokka" },
  { id: "w4", x: 300, y: 170, text: "Agent: keep null notes blank, don’t invent",   color: "#E8C9B8", by: "room_na" },
  { id: "w5", x: 150, y: 296, text: "COGS up 27.5% — volume or price? confirm",     color: "#EAD9A6", by: "priya" },
  { id: "w6", x: 398, y: 300, text: "Board read due Friday",                        color: "#E6B8C2", by: "homen" },
];

export type NoteBlockType = "heading" | "paragraph" | "quote";
export type NoteBlockStatus = "accepted" | "draft";
export type NoteBlockAuthor = "user" | "agent";
export interface NoteBlock {
  id: string;
  type: NoteBlockType;
  text: string;
  status: NoteBlockStatus;
  author: NoteBlockAuthor;
  sources?: string[];
}
export const NOTE_BLOCKS: NoteBlock[] = [
  { id: "b1", type: "heading",   text: "Q3 variance — reconciliation note", status: "accepted", author: "user" },
  { id: "b2", type: "paragraph", text: "Revenue rose to $12,400 in Q3 from $10,000 in Q2 — a +24% move, reconciled against the NetSuite export close.", status: "accepted", author: "user", sources: ["NetSuite export"] },
  { id: "b3", type: "paragraph", text: "COGS climbed to $5,100 (+27.5%), slightly outpacing revenue. Gross profit still grew to $7,300 (+21.7%).", status: "accepted", author: "agent", sources: ["Q3 variance"] },
  { id: "b4", type: "quote",     text: "null cells are preserved through sync — a blank Note is data, not a delete.", status: "accepted", author: "user" },
  { id: "b5", type: "paragraph", text: "Proposed: the COGS jump is volume-driven, not margin erosion — gross margin held near 59%. Flag for finance before the board read.", status: "draft", author: "agent", sources: ["Q3 variance"] },
];

export interface Step {
  id: string;
  label: string;
  kicker: string;
  title: string;
  screen: ScreenId;
  file: string;
  blurb: string;
  panels?: PanelId[];
}
export const STEPS: Step[] = [
  { id: "landing", label: "NodeAgent", kicker: "01 · Surface",
    title: "The public surface", screen: "landing",
    file: "apps/web · scratchnode.live shell",
    blurb: "Start like scratchnode.live: one room URL, public by default. From here you host a room or join one anonymously with a code." },
  { id: "create", label: "Create room", kicker: "02 · Rooms",
    title: "Host a room", screen: "create",
    file: "convex/schema.ts → rooms, liveMessages",
    blurb: "Creating a room mints a roomId + a short share code. The host owns the room; everything inside is keyed by roomId." },
  { id: "join", label: "Anonymous join", kicker: "03 · Identity",
    title: "Anyone joins with a code", screen: "join",
    file: "rooms · anonymous identity",
    blurb: "A guest pastes the code and picks a display name — no account. They get an ephemeral anon identity scoped to this room." },
  { id: "chat", label: "Public chat", kicker: "04 · One panel", screen: "room",
    title: "Public chat + room agent", panels: ["center"],
    file: "collaboration/realtimeHub.ts",
    blurb: "The room opens to one panel: shared public chat with the Room NodeAgent in the center. Type /ask to invoke the public agent — everyone sees the run." },
  { id: "artifact", label: "Open artifact", kicker: "05 · Two panels", screen: "room",
    title: "Open the artifact beside chat", panels: ["center", "artifact"],
    file: "spreadsheet · notebook · wall engines",
    blurb: "Open an artifact next to chat: a versioned spreadsheet, a TipTap note, or a post-it wall. The agent edits the same artifact you do." },
  { id: "private", label: "Personal agent", kicker: "06 · Three panels", screen: "room",
    title: "Your private agent on the right", panels: ["center", "artifact", "right"],
    file: "docs/publicPrivateContracts.ts",
    blurb: "Open your personal NodeAgent on the right. It’s private to you — it can read room context but its output stays yours until you promote it." },
  { id: "navigator", label: "Files & people", kicker: "07 · Four panels", screen: "room",
    title: "Navigate files & people", panels: ["left", "center", "artifact", "right"],
    file: "convex/schema.ts → rooms, sourceDocuments",
    blurb: "Open the left rail to jump between files and see who’s in the room. Four panels: navigator · chat · artifact · private agent." },
  { id: "collab", label: "Lock → draft → merge", kicker: "08 · Live collab", screen: "room",
    title: "Locks, drafts & smart-merge", panels: ["left", "center", "artifact", "right"],
    file: "realtimeRuntime.ts · versionedSpreadsheetSync.ts",
    blurb: "Two agents, aware of each other. One locks a range — read-only for everyone else, but still readable. The other drafts changes around it and the LLM smart-merges on unlock. Every step is traced per room." },
];

export type CollabBeatKind = "idle" | "lock" | "readonly" | "draft" | "commit" | "merge" | "done";
export interface CollabBeatLog {
  kind: string;
  tool: string;
  text: string;
  detail: string;
}
export interface CollabBeat {
  id: number;
  kind: CollabBeatKind;
  actor?: string;
  rowIds?: string[];
  cols?: number[];
  values?: Record<string, string>;
  log: CollabBeatLog | null;
  desc: string;
}
export const COLLAB_BEATS: CollabBeat[] = [
  { id: 0, kind: "idle", log: null, desc: "Room NodeAgent and Priya are both looking at the variance sheet." },
  { id: 1, kind: "lock", actor: "room_na", rowIds: ["r_rev", "r_cogs"], cols: [3],
    log: { kind: "lock", tool: "nodeagent.propose_lock", text: "Room NodeAgent locks Variance on Revenue, COGS", detail: "affectedRange · rows [r_rev, r_cogs] · cols [3]" },
    desc: "The room agent proposes a lock on the rows it’s about to write. Those cells go read-only for everyone else." },
  { id: 2, kind: "readonly",
    log: { kind: "read", tool: "context.read_locked", text: "Priya’s agent reads the locked range as context", detail: "read-only · used for reasoning, not mutation" },
    desc: "Priya’s private agent can still read the locked cells — locked means read-only, not invisible. It reasons about the rows around them." },
  { id: 3, kind: "draft", actor: "my_na", rowIds: ["r_gp", "r_ni"], cols: [3],
    log: { kind: "draft", tool: "nodeagent.draft_change", text: "Your agent drafts Variance for Gross profit, Net income", detail: "draft held for merge — does not touch locked rows" },
    desc: "Instead of waiting, your agent drafts the variance for the unlocked rows around the lock. The draft is held, not applied." },
  { id: 4, kind: "commit", actor: "room_na", rowIds: ["r_rev", "r_cogs"], cols: [3], values: { r_rev: "+24%", r_cogs: "+27.5%" },
    log: { kind: "commit", tool: "nodeagent.apply_spreadsheet_delta", text: "Room NodeAgent commits Variance · v41 → v42", detail: "idempotencyKey checked · stable row ids · null notes preserved" },
    desc: "The room agent commits its delta through the versioned sync tool. v41 → v42. The lock releases." },
  { id: 5, kind: "merge", actor: "my_na", rowIds: ["r_gp", "r_ni"], cols: [3], values: { r_gp: "+21.7%", r_ni: "+22.4%" },
    log: { kind: "merge", tool: "nodeagent.smart_merge", text: "Smart-merge applies the held draft · v42 → v43", detail: "rebased on canonical v42 · no conflict · auto-allow on" },
    desc: "On unlock the LLM smart-merges the held draft against canonical v42 — it rebases cleanly because it never touched the locked rows. v42 → v43." },
  { id: 6, kind: "done",
    log: { kind: "trace", tool: "agentTraces", text: "Run sealed to the room trace", detail: "6 steps · 2 agents · 1 lock · 1 merge · preserved per room" },
    desc: "Both agents finished, aware of each other the whole time. The full run is preserved in the room trace." },
];

// Helpers (mirror window.NAR.makeRoomCode/Id/stableHash).
export function makeRoomCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s.slice(0, 3) + "-" + s.slice(3);
}
export function makeRoomId(): string {
  return "room_" + Math.random().toString(36).slice(2, 8);
}
export function stableHash(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
