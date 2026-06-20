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
} from "./mobileData";

export type RowEditResult = { ok: boolean; reason?: string; version?: number };

export type SaveState = "saving" | "saved" | "idle";
export type RunState = "plan" | "running" | "done";
export type PassiveMode = "off" | "suggest" | "index" | "research";
export type CopyTone = "analyst" | "calm" | "command";
export type Density = "compact" | "comfortable";
export type AccentName = "terracotta" | "amber" | "neutral";
export type MotionName = "expressive" | "minimal" | "reduced";
export type NavStyle = "tabs" | "dock";

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
}

/** Live room data injected into MobileApp by MobileAppLive (see MobileRoot). */
export interface MobileLive {
  roomName: string;
  roomCode: string;
  liveCount: number;
  roomMsgs: RoomMsg[];
  people: Record<string, Person>;
  postRoomMessage: (text: string) => void;
  agentPrivate: AgentMsg[];
  agentRoom: AgentMsg[];
  askPrivateAgent: (goal: string) => void;
  askRoomAgent: (goal: string) => void;
  row: Row;
  editRowField: (elementId: string, value: string, baseVersion: number) => Promise<RowEditResult>;
  onLeave?: () => void;
}
