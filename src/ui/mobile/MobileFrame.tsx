/* ============================================================================
   NodeAgent Mobile — iOS device frame (terra parity)
   Ported from terra/ios-frame.jsx (window.IOSDevice). At desktop widths the
   surface renders inside a 402×874 bezel with Dynamic Island, a 9:41 status bar
   and a home indicator, centered on a warm "desk" backdrop; at real phone
   widths (≤460px) the bezel drops and the surface goes full-bleed.

   `.na-app` is `position:absolute; inset:0`, so IOSDevice must give it a
   positioned, sized parent: the bezel on desktop, the viewport when compact.
   Status bar / island / home indicator are layered ABOVE the screen and the
   screen's own chrome already reserves space for them (`.na-top` padding-top).
   ============================================================================ */
import * as React from "react";

/** True at real-phone widths — drop the synthetic bezel, go full-bleed. */
export function useCompact(): boolean {
  const query = "(max-width: 460px)";
  const read = (): boolean =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches;
  const [compact, setCompact] = React.useState<boolean>(read);
  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = (): void => setCompact(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return compact;
}

function StatusBar({ dark }: { dark: boolean }): React.ReactElement {
  const c = dark ? "#fff" : "#000";
  return (
    <div
      style={{
        display: "flex",
        gap: 154,
        alignItems: "center",
        justifyContent: "center",
        padding: "21px 24px 19px",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 20,
        width: "100%",
      }}
    >
      <div style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 1.5 }}>
        <span style={{ fontFamily: '-apple-system, "SF Pro", system-ui', fontWeight: 590, fontSize: 17, lineHeight: "22px", color: c }}>9:41</span>
      </div>
      <div style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, paddingTop: 1, paddingRight: 1 }}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z" fill={c} />
          <path d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z" fill={c} />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={c} strokeOpacity="0.35" fill="none" />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

export function IOSDevice({
  children,
  dark = false,
  width = 402,
  height = 874,
}: {
  children?: React.ReactNode;
  dark?: boolean;
  width?: number;
  height?: number;
}): React.ReactElement {
  const compact = useCompact();
  if (compact) {
    // Real phone: the device IS the frame — full-bleed, no synthetic chrome.
    return (
      <div className="na-ios-bleed" style={{ position: "fixed", inset: 0, background: dark ? "#000" : "#FBF4E7", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 30, pointerEvents: "none" }}>
          <StatusBar dark={dark} />
        </div>
        {children}
      </div>
    );
  }
  return (
    <div
      className="na-ios"
      style={{
        width,
        height,
        borderRadius: 48,
        overflow: "hidden",
        position: "relative",
        background: dark ? "#000" : "#F2F2F7",
        boxShadow: "0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)",
        fontFamily: "-apple-system, system-ui, sans-serif",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* dynamic island */}
      <div style={{ position: "absolute", top: 11, left: "50%", transform: "translateX(-50%)", width: 126, height: 37, borderRadius: 24, background: "#000", zIndex: 50 }} />
      {/* status bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}>
        <StatusBar dark={dark} />
      </div>
      {/* screen content — .na-app fills this (position:absolute; inset:0) */}
      {children}
      {/* home indicator — always on top */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 60,
          height: 34,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-end",
          paddingBottom: 8,
          pointerEvents: "none",
        }}
      >
        <div style={{ width: 139, height: 5, borderRadius: 100, background: dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.25)" }} />
      </div>
    </div>
  );
}

/**
 * Desk backdrop: centers the device on a warm radial-gradient desk at desktop
 * widths; goes full-bleed (cream, or black in dark mode) when compact. Mirrors
 * the terra standalone's <body> styling.
 */
export function MobileStage({ dark = false, children }: { dark?: boolean; children?: React.ReactNode }): React.ReactElement {
  const compact = useCompact();
  return (
    <div className="na-stage" data-compact={compact ? "true" : undefined} data-dark={dark ? "true" : undefined}>
      {children}
    </div>
  );
}
