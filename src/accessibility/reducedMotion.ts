type MatchMediaWindow = Pick<Window, "matchMedia">;

export function prefersReducedMotion(win: MatchMediaWindow | undefined = currentWindow()): boolean {
  if (!win?.matchMedia) return false;
  return win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function motionDuration(ms: number, win: MatchMediaWindow | undefined = currentWindow()): number {
  return prefersReducedMotion(win) ? 0 : Math.max(0, ms);
}

export function motionClassName(baseClassName: string, reducedClassName: string, win: MatchMediaWindow | undefined = currentWindow()): string {
  return prefersReducedMotion(win) ? `${baseClassName} ${reducedClassName}` : baseClassName;
}

function currentWindow(): MatchMediaWindow | undefined {
  return typeof window === "undefined" ? undefined : window;
}
