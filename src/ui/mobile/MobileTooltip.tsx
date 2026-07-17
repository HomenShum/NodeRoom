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
import {
  Tooltip as RadixTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../components/ui/tooltip";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Tooltip text shown in the bubble. */
  label: string;
  /** Which side of the trigger the bubble sits on. Default 'bottom'. */
  side?: TooltipSide;
  /** Exactly one trigger element. The wrapper renders an inline-flex span around it. */
  children: React.ReactNode;
}

/**
 * Tooltip — hover/focus/long-press bubble around a single trigger.
 * The trigger remains clickable; we only attach reveal/hide handlers to the
 * wrapping span (which uses pointer-events that bubble from the child).
 */
export function Tooltip({ label, side = "bottom", children }: TooltipProps): React.ReactElement {
  const [show, setShow] = React.useState<boolean>(false);
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearPress = React.useCallback((): void => {
    if (pressTimer.current !== undefined) {
      clearTimeout(pressTimer.current);
      pressTimer.current = undefined;
    }
  }, []);

  React.useEffect(() => clearPress, [clearPress]);

  const close = React.useCallback((): void => {
    clearPress();
    setShow(false);
  }, [clearPress]);

  // Touch: reveal after a short long-press, hide on release/cancel.
  const onTouchStart = React.useCallback((): void => {
    clearPress();
    pressTimer.current = setTimeout(() => setShow(true), 380);
  }, [clearPress]);

  return (
    <TooltipProvider delayDuration={300}>
      <RadixTooltip open={show} onOpenChange={setShow}>
        <TooltipTrigger asChild>
          <span className="na-tip" onTouchStart={onTouchStart} onTouchEnd={close} onTouchCancel={close}>
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="na-tip-bubble" side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </TooltipContent>
      </RadixTooltip>
    </TooltipProvider>
  );
}
