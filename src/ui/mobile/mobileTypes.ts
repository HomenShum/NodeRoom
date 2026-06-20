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
} from "./mobileData";

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
  runQuick: (q: QuickPrompt) => void;
  openRow: () => void;
  askAboutRow: () => void;
}
