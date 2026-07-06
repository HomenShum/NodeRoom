/* ============================================================================
   Room join consent — surfaces autoAllow as an explicit permission grant the
   FIRST time the user enters a room. The schema/mutation already accept the
   flag (convex/rooms.ts createStarterRoom { autoAllow }); this modal is the
   in-app moment where the user actually says yes.

   Display flow:
     • initialChoice highlights one radio ("auto" if the URL doesn't say
       ?demo=review, "review" if it does) but DOES NOT auto-fire — the user
       must click Continue.
     • Choice is per-session (component state, not localStorage). Tab refresh
       re-prompts. Joiners (?room=) and memory mode (?mode=memory) skip this
       entirely; the parent (MobileRoot) gates whether the modal renders.

   Visual: terracotta mobile shell (.na-* namespace, terra tokens only — no
   new CSS vars).
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";

export type ConsentChoice = "auto" | "review";

export function RoomJoinConsent({
  initialChoice,
  onAccept,
  onCancel,
}: {
  initialChoice: ConsentChoice;
  onAccept: (autoAllow: boolean) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [choice, setChoice] = React.useState<ConsentChoice>(initialChoice);

  const Card = ({
    value,
    icon,
    title,
    sub,
    blurb,
  }: {
    value: ConsentChoice;
    icon: Parameters<typeof Ico>[0];
    title: string;
    sub: string;
    blurb: string;
  }): React.ReactElement => {
    const selected = choice === value;
    return (
      <button
        type="button"
        className="na-card"
        data-selected={String(selected)}
        onClick={() => setChoice(value)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "14px 16px",
          marginBottom: 10,
          border: "1.5px solid " + (selected ? "var(--accent-primary, #d97757)" : "var(--border-color, rgba(255,255,255,.12))"),
          borderRadius: 14,
          background: selected ? "var(--accent-primary-bg, rgba(217,119,87,.10))" : "var(--bg-secondary, #171b20)",
          color: "var(--text-primary, #fff)",
          cursor: "pointer",
          font: "inherit",
          transition: "border-color .12s ease, background .12s ease",
        }}
        aria-pressed={selected}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: "2px solid " + (selected ? "var(--accent-primary, #d97757)" : "var(--border-strong, rgba(255,255,255,.22))"),
              background: selected ? "var(--accent-primary, #d97757)" : "transparent",
              flex: "none",
              display: "grid",
              placeItems: "center",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1,
            }}
            aria-hidden
          >
            {selected ? Ico("check", { width: 12, height: 12 }) : null}
          </span>
          <span style={{ flex: "none", color: selected ? "var(--accent-primary, #d97757)" : "var(--text-secondary, rgba(255,255,255,.7))" }}>
            {Ico(icon, { width: 17, height: 17 })}
          </span>
          <strong style={{ fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" }}>{title}</strong>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary, rgba(255,255,255,.7))", marginBottom: 6 }}>{sub}</div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary, rgba(255,255,255,.55))", lineHeight: 1.45 }}>{blurb}</div>
      </button>
    );
  };

  return (
    <div
      className="na-frame-root"
      data-theme="light"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rjc-title"
    >
      <div className="na-frame">
        <div
          className="na-join"
          data-accent="terracotta"
          style={{ justifyContent: "flex-start", paddingTop: 36 }}
        >
          <div className="na-mark na-join-mark">{Ico("shield", { width: 22, height: 22 })}</div>
          <h1 id="rjc-title" className="na-join-title" style={{ marginTop: 4 }}>
            Let agents commit edits?
          </h1>
          <p className="na-join-sub">
            NodeAgent can propose evidence-backed changes to this room. Pick how landed edits should flow.
            You can revoke this any time from the room header.
          </p>

          <div style={{ marginTop: 6 }}>
            <Card
              value="auto"
              icon="bolt"
              title="Auto-approve agent edits"
              sub="Faster · agents commit cells directly · every change is traced"
              blurb="Good for solo demos and the live walkthrough. The agent still proposes through CAS — any conflict turns into a review proposal."
            />
            <Card
              value="review"
              icon="shield"
              title="Review every edit"
              sub="Safer · each agent change lands as a proposal you approve in Inbox"
              blurb="Good for higher-trust review. The agent runs, but cells only commit when you tap Approve from this device."
            />
          </div>

          <button
            type="button"
            className="na-btn primary full"
            onClick={() => onAccept(choice === "auto")}
            style={{ marginTop: 8, padding: 13, justifyContent: "center" }}
            aria-label={"Continue with " + (choice === "auto" ? "auto-approve" : "review-every-edit")}
          >
            Continue {Ico("arrow", { width: 16, height: 16 })}
          </button>
          <button
            type="button"
            className="na-btn full"
            onClick={onCancel}
            style={{ padding: 11, justifyContent: "center" }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
