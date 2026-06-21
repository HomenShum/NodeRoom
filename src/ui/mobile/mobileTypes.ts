/* ============================================================================
   NodeAgent Mobile — controller context type.
   `MobileCtx` is the single prop bag every screen / sheet receives (mirrors the
   `ctx` object the prototype's App() assembled). Defined here to break import
   cycles between the controller and the leaf components.
   ============================================================================ */
import type { Dispatch, SetStateAction } from "react";
import type {
  TabId,
  SheetId,
  ComposerMode,
  AgentLane,
  InboxItem,
  QuickPrompt,
  RoomMsg,
  AgentMsg,
  Person,
  Row,
  Job,
  Extraction,
  RoomEntry,
  SourceRef,
} from "./mobileData";

// Re-export the UI-state unions so leaf modules can import them from here too.
export type { TabId, SheetId, ComposerMode } from "./mobileData";

export type RowEditResult = { ok: boolean; reason?: string; version?: number };

export type SaveState = "saving" | "saved" | "idle";
export type RunState = "plan" | "running" | "done";
export type PassiveMode = "off" | "suggest" | "index" | "research";
export type CopyTone = "analyst" | "calm" | "command";
export type Density = "compact" | "comfortable";
export type AccentName = "terracotta" | "clay" | "ochre";
export type MotionName = "expressive" | "minimal" | "reduced";
export type NavStyle = "tabs" | "dock";
export type ScopeName = "Private" | "Room" | "Shared";

/** Stacking overlay shown above any bottom sheet (trace receipt | source reader). */
export type OverlayState =
  | { type: "trace"; id: string }
  | { type: "source"; src: SourceRef }
  | null;

export interface TweaksConfig {
  passive: PassiveMode;
  navModel: TabId; // default surface
  density: Density;
  accent: AccentName;
  navStyle: NavStyle;
  copyTone: CopyTone;
  motion: MotionName;
  dark: boolean;
}

export interface CopyCtx {
  save: string;
  noticedTitle: string;
  noticedSub: string;
}

export interface MobileCtx {
  t: TweaksConfig;
  setTweak: <K extends keyof TweaksConfig>(key: K, value: TweaksConfig[K]) => void;
  tab: TabId;
  note: string;
  setNote: Dispatch<SetStateAction<string>>;
  saveState: SaveState;
  detected: boolean;
  noticed: boolean;
  copy: CopyCtx;
  openSheet: (k: SheetId) => void;
  closeSheet: () => void;
  openInbox: (item: InboxItem) => void;
  approveResearch: () => void;
  runReadOnly: () => void;
  runState: RunState;
  resolved: Record<string, boolean>;
  resolvedCount: number;
  version: string;
  toast: (msg: string) => void;
  composerMode: ComposerMode;
  setComposerMode: Dispatch<SetStateAction<ComposerMode>>;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  sendComposer: () => void;
  listening: boolean;
  startVoice: () => void;
  stopVoice: () => void;
  agentLane: AgentLane;
  setAgentLane: Dispatch<SetStateAction<AgentLane>>;
  roomMsgs: RoomMsg[];
  agentMsgs: { private: AgentMsg[]; room: AgentMsg[] };
  /** Avatar/name lookup for the room feed — live members (keyed by member id) or the mock PEOPLE map. */
  people: Record<string, Person>;
  /** True when bound to a live Convex room (vs sample data). */
  isLive: boolean;
  runQuick: (q: QuickPrompt) => void;
  openRow: () => void;
  askAboutRow: () => void;
  /** CardioNova row — live cells when bound to a room, else the sample row. */
  row: Row;
  /** In-place cell edit with CAS (baseVersion); resolves with the live edit result. */
  editRowField: (elementId: string, value: string, baseVersion: number) => Promise<RowEditResult>;
  inboxItems: InboxItem[];
  jobs: { running: Job[]; queued: Job[]; completed: Job[] };
  canApprove: boolean;
  resolveProposalById: (id: string, approve: boolean) => Promise<RowEditResult>;
  jobAct: (id: string, action: "cancel" | "retry") => Promise<RowEditResult>;

  // ── terra: passive extraction + flash-on-change ──
  /** Live structured extraction derived from the note (Detected tab / Home). */
  extract: Extraction;
  /** Keys ("group.field") that changed on the last silent rescan — flashed briefly. */
  flashKeys: string[];

  // ── terra: sheet back-stack + stacking overlay ──
  backSheet: () => void;
  canBack: boolean;
  /** Spin up a read-only "search sources" run in the room agent. */
  startSearch: (item?: unknown) => void;
  openTrace: (id: string) => void;
  openSource: (src: SourceRef) => void;
  closeOverlay: () => void;
  /** Jump from a job's trace receipt to the finished artifact, then pulse it. */
  openFromTrace: (job: { artifact?: string; artifactName?: string; trace?: string }) => void;
  overlay: OverlayState;

  // ── terra: people / mentions / pins ──
  mentionPerson: (who: string) => void;
  togglePin: (name: string) => void;
  pinned: string[];

  // ── terra: navigation + Ask-NodeAgent composer ──
  setTab: (t: TabId) => void;
  scope: ScopeName;
  cycleScope: () => void;
  toggleScope: () => void;
  openAsk: (mode?: ComposerMode) => void;
  closeAsk: () => void;
  sendAsk: () => void;
  askOpen: boolean;

  // ── terra: room switcher ──
  /** Current room descriptor (live room when bound, else the sample room entry). */
  room: RoomEntry;
  roomId: string;
  switchRoom: (id: string) => void;
  joinRoom: () => void;
  leaveRoom: () => void;
}

/** Live room data injected into MobileApp by MobileAppLive (see MobileRoot). */
export interface MobileLive {
  roomName: string;
  roomCode: string;
  liveCount: number;
  roomMsgs: RoomMsg[];
  people: Record<string, Person>;
  postRoomMessage: (text: string) => Promise<RowEditResult>;
  agentPrivate: AgentMsg[];
  agentRoom: AgentMsg[];
  askPrivateAgent: (goal: string) => Promise<RowEditResult>;
  askRoomAgent: (goal: string) => Promise<RowEditResult>;
  row: Row;
  editRowField: (elementId: string, value: string, baseVersion: number) => Promise<RowEditResult>;
  inboxItems: InboxItem[];
  jobs: { running: Job[]; queued: Job[]; completed: Job[] };
  canApprove: boolean;
  resolveProposalById: (id: string, approve: boolean) => Promise<RowEditResult>;
  jobAct: (id: string, action: "cancel" | "retry") => Promise<RowEditResult>;
  onLeave?: () => void;
}
