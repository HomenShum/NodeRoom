import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";
import { FocusTrapDialog } from "./FocusTrapDialog";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "secondary" | "ghost";
};

export function Button({ variant = "default", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx("r-btn nr-button", variant !== "default" && variant, className)}
    />
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md";
};

export function IconButton({ active, size = "md", className, type = "button", ...props }: IconButtonProps) {
  const activeProps = active === undefined
    ? {}
    : { "data-on": String(active), "aria-pressed": props["aria-pressed"] ?? active };
  return (
    <button
      {...props}
      {...activeProps}
      type={type}
      className={cx("r-iconbtn nr-icon-button", size === "sm" && "r-iconbtn-sm", className)}
    />
  );
}

type SwitchProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  checked: boolean;
};

export function Switch({ checked, className, type = "button", ...props }: SwitchProps) {
  return (
    <button
      {...props}
      type={type}
      role={props.role ?? "switch"}
      aria-checked={props["aria-checked"] ?? checked}
      data-on={String(checked)}
      className={cx("r-switch nr-switch", className)}
    />
  );
}

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  region?: "left" | "center" | "right" | "artifact";
};

export function Panel({ region, className, ...props }: PanelProps) {
  return <div {...props} className={cx("r-panel nr-panel", region, region && `nr-panel--${region}`, className)} />;
}

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span {...props} data-tone={tone} className={cx("r-tag nr-badge", className)} />;
}

export function Tabs({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("nr-tabs", className)} />;
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("nr-input", className)} />;
}

type SearchFieldProps = LabelHTMLAttributes<HTMLLabelElement> & {
  icon?: ReactNode;
  inputProps: InputHTMLAttributes<HTMLInputElement>;
};

export function SearchField({ icon, inputProps, className, ...props }: SearchFieldProps) {
  return (
    <label {...props} className={cx("nr-search-field", className)}>
      {icon}
      <input {...inputProps} className={cx("nr-input", inputProps.className)} />
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { icon?: ReactNode; title: ReactNode }) {
  return (
    <div {...props} className={cx("nr-empty-state", className)}>
      {icon && <div className="nr-empty-state__icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <div className="nr-empty-state__body">{children}</div>}
    </div>
  );
}

export function LoadingState({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("nr-loading-state", className)} />;
}

export function ErrorState({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} role={props.role ?? "alert"} className={cx("nr-error-state", className)} />;
}

export function Popover({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("nr-popover", className)} />;
}

type ModalProps = {
  children: ReactNode;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledby?: string;
  testId?: string;
  className?: string;
  panelClassName?: string;
};

export function Modal({
  children,
  onClose,
  ariaLabel,
  ariaLabelledby,
  testId,
  className,
  panelClassName,
}: ModalProps) {
  return (
    <FocusTrapDialog
      className={cx("r-modal-backdrop nr-modal-backdrop", className)}
      panelClassName={cx("r-modal nr-modal-panel", panelClassName)}
      ariaLabel={ariaLabel}
      ariaLabelledby={ariaLabelledby}
      testId={testId}
      onClose={onClose}
    >
      {children}
    </FocusTrapDialog>
  );
}
