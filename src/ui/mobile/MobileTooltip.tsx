/* ============================================================================
   NodeAgent Mobile — lightweight tooltip wrapper.
   Wraps a SINGLE trigger element and reveals a small bubble on hover (desktop),
   keyboard focus, and long-press (touch). The wrapper forwards pointer/focus
   handlers but does NOT swallow clicks — the trigger stays fully interactive.

   Always pair this with a native `title` + `aria-label` on the trigger itself
   (this wrapper supplies the visual bubble + an aria-describedby hook; it is not
   a replacement for the accessible name). Bubble styling + reduced-motion live
   in mobileFrame.css under `.na-tip` / `.na-tip-bubble`.

   Style parity: React.createElement (NOT JSX), strict TS.
   ============================================================================ */
import * as React from "react";

const h = React.createElement;

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Tooltip text shown in the bubble. */
  label: string;
  /** Which side of the trigger the bubble sits on. Default 'bottom'. */
  side?: TooltipSide;
  /** Exactly one trigger element. The wrapper renders an inline-flex span around it. */
  children: React.ReactNode;
}

let tipSeq = 0;

/**
 * Tooltip — hover/focus/long-press bubble around a single trigger.
 * The trigger remains clickable; we only attach reveal/hide handlers to the
 * wrapping span (which uses pointer-events that bubble from the child).
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps): React.ReactElement {
  const [show, setShow] = React.useState<boolean>(false);
  const idRef = React.useRef<string | undefined>(undefined);
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (idRef.current === undefined) {
    tipSeq += 1;
    idRef.current = `na-tip-${tipSeq}`;
  }
  const tipId = idRef.current;

  const clearPress = React.useCallback((): void => {
    if (pressTimer.current !== undefined) {
      clearTimeout(pressTimer.current);
      pressTimer.current = undefined;
    }
  }, []);

  React.useEffect(() => clearPress, [clearPress]);

  const open = React.useCallback((): void => setShow(true), []);
  const close = React.useCallback((): void => {
    clearPress();
    setShow(false);
  }, [clearPress]);

  // Touch: reveal after a short long-press, hide on release/cancel.
  const onTouchStart = React.useCallback((): void => {
    clearPress();
    pressTimer.current = setTimeout(() => setShow(true), 380);
  }, [clearPress]);

  return h(
    "span",
    {
      className: "na-tip",
      // Desktop hover
      onPointerEnter: open,
      onPointerLeave: close,
      // Keyboard focus (focus bubbles from focusable child)
      onFocus: open,
      onBlur: close,
      // Touch long-press
      onTouchStart,
      onTouchEnd: close,
      onTouchCancel: close,
    },
    children,
    h(
      "span",
      {
        className: "na-tip-bubble",
        role: "tooltip",
        id: tipId,
        "data-side": side,
        "data-show": show ? "" : undefined,
      },
      label,
    ),
  );
}
