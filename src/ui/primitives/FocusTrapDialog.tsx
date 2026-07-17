import type { ReactElement, ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog";

type FocusTrapDialogProps = {
  children: ReactNode;
  onClose: () => void;
  className: string;
  panelClassName: string;
  ariaLabel?: string;
  ariaLabelledby?: string;
  testId?: string;
};

export function FocusTrapDialog({
  children,
  onClose,
  className,
  panelClassName,
  ariaLabel,
  ariaLabelledby,
  testId,
}: FocusTrapDialogProps): ReactElement {
  return (
    <Dialog defaultOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={panelClassName}
        overlayClassName={className}
        showCloseButton={false}
        unstyled
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
      >
        <DialogTitle className="sr-only">{ariaLabel ?? "Dialog"}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
