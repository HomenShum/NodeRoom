export const FOCUS_MODE_PREF_KEY = "noderoom:focusMode:v1";

export type FocusModeClientState = {
  enabled: boolean;
  selectedJobId?: string;
  paused: boolean;
  lastUserPausedAt?: number;
};

export function readFocusModeClientState(): FocusModeClientState {
  const off: FocusModeClientState = { enabled: false, paused: false };
  if (typeof window === "undefined") return off;
  const forced = new URLSearchParams(window.location.search).get("focusMode");
  if (forced) return { enabled: /^(1|true|on|yes)$/i.test(forced), paused: false };
  if (navigator.webdriver) return { enabled: true, paused: false };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(FOCUS_MODE_PREF_KEY) ?? "null") as Partial<FocusModeClientState> | null;
    return {
      enabled: !!parsed?.enabled,
      selectedJobId: parsed?.selectedJobId,
      paused: !!parsed?.paused,
      lastUserPausedAt: parsed?.lastUserPausedAt,
    };
  } catch {
    return off;
  }
}

export function persistFocusModeClientState(state: FocusModeClientState): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(FOCUS_MODE_PREF_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

export function textEntryIsActive(): boolean {
  if (typeof document === "undefined") return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable;
}
