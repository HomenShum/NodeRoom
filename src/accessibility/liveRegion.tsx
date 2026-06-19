import type { CSSProperties, ReactNode } from "react";

export type LiveRegionProps = {
  message?: ReactNode;
  children?: ReactNode;
  politeness?: "polite" | "assertive" | "off";
  atomic?: boolean;
  className?: string;
  visuallyHidden?: boolean;
};

export const visuallyHiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function LiveRegion({
  message,
  children,
  politeness = "polite",
  atomic = true,
  className,
  visuallyHidden = true,
}: LiveRegionProps) {
  const role = politeness === "assertive" ? "alert" : "status";
  return (
    <div
      role={role}
      aria-live={politeness}
      aria-atomic={atomic}
      className={className}
      style={visuallyHidden ? visuallyHiddenStyle : undefined}
    >
      {children ?? message}
    </div>
  );
}
