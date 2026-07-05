import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type FocusTrapDialogProps = {
  children: ReactNode;
  onClose: () => void;
  className: string;
  panelClassName: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  testId?: string;
};

function visibleFocusable(root: HTMLElement | null): HTMLElement[] {
  return Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
    (el) => el.offsetParent !== null,
  );
}

export function FocusTrapDialog({
  children,
  onClose,
  className,
  panelClassName,
  ariaLabel,
  ariaLabelledby,
  testId,
}: FocusTrapDialogProps): ReactElement {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = window.requestAnimationFrame(() => {
      if (panelRef.current?.contains(document.activeElement)) return;
      visibleFocusable(panelRef.current)[0]?.focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = visibleFocusable(panelRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div
      className={className}
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={panelClassName} ref={panelRef}>
        {children}
      </div>
    </div>
  );
}
