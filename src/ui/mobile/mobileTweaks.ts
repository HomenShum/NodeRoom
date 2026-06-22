/* ============================================================================
   NodeAgent Mobile — user-facing variant settings (persisted per device).
   The prototype's variants (accent / density / nav / tone / motion / theme /
   passive) were design-iteration knobs; here they ship as real user settings,
   stored in localStorage and edited via the Settings sheet (MobileSettings.tsx).
   ============================================================================ */
import type { TabId } from "./mobileData";
import type { TweaksConfig, PassiveMode, Density, AccentName, CopyTone, MotionName, NavStyle } from "./mobileTypes";

export const DEFAULT_TWEAKS: TweaksConfig = {
  passive: "suggest",
  navModel: "capture",
  density: "comfortable",
  accent: "terracotta",
  navStyle: "tabs",
  copyTone: "analyst",
  motion: "expressive",
  dark: false,
};

const KEY = "noderoom:mobile:tweaks:v2";
const LEGACY_KEY = "noderoom:mobile:tweaks:v1";

function pickEnum<T extends string>(allowed: readonly T[], val: unknown, fallback: T): T {
  return typeof val === "string" && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;
}

export function loadTweaks(): TweaksConfig {
  try {
    const current = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    const legacy = typeof localStorage !== "undefined" ? localStorage.getItem(LEGACY_KEY) : null;
    const raw = current ?? legacy;
    if (!raw) return DEFAULT_TWEAKS;
    const p = JSON.parse(raw) as Record<string, unknown>;
    const navModel = pickEnum<TabId>(["home", "capture", "room", "agent", "inbox", "files"], p.navModel, DEFAULT_TWEAKS.navModel);
    return {
      passive: pickEnum<PassiveMode>(["off", "suggest", "index", "research"], p.passive, DEFAULT_TWEAKS.passive),
      navModel: !current && legacy && navModel === "home" ? DEFAULT_TWEAKS.navModel : navModel,
      density: pickEnum<Density>(["compact", "comfortable"], p.density, DEFAULT_TWEAKS.density),
      accent: pickEnum<AccentName>(["terracotta", "clay", "ochre"], p.accent, DEFAULT_TWEAKS.accent),
      navStyle: pickEnum<NavStyle>(["tabs", "dock"], p.navStyle, DEFAULT_TWEAKS.navStyle),
      copyTone: pickEnum<CopyTone>(["analyst", "calm", "command"], p.copyTone, DEFAULT_TWEAKS.copyTone),
      motion: pickEnum<MotionName>(["expressive", "minimal", "reduced"], p.motion, DEFAULT_TWEAKS.motion),
      dark: typeof p.dark === "boolean" ? p.dark : DEFAULT_TWEAKS.dark,
    };
  } catch {
    return DEFAULT_TWEAKS;
  }
}

export function saveTweaks(t: TweaksConfig): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}
