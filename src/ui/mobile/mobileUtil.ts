/* ============================================================================
   NodeAgent Mobile — small UX utilities shared across the polish pass.
   Pure helpers only (no React, no DOM-mutation): keep this module side-effect
   free so any leaf component / controller can import it without import cycles.
   ============================================================================ */

/**
 * Fire a short haptic tap on supporting touch devices.
 * Guarded for SSR (no `navigator`) and unsupported browsers (no `vibrate`), so
 * it is always safe to call from an event handler. No-op when unavailable.
 *
 * @param ms vibration duration in milliseconds (default 8 — a subtle tick).
 */
export function haptic(ms: number = 8): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  nav.vibrate?.(ms);
}
