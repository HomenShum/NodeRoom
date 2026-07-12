import * as React from "react";
import { Ico } from "./MobileIcons";

export type ConsentChoice = "auto" | "review";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function RoomJoinConsent({
  experience,
  roomCode,
  initialChoice,
  onAccept,
  onCancel,
}: {
  experience: "workspace" | "sample";
  roomCode: string;
  initialChoice: ConsentChoice;
  onAccept: (autoAllow: boolean) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [choice, setChoice] = React.useState<ConsentChoice>(initialChoice);
  const sample = experience === "sample";
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const root = dialogRef.current;
    if (!root) return;
    const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === titleRef.current || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="na-frame-root"
      data-theme="light"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rjc-title"
      aria-describedby="rjc-description rjc-access"
      ref={dialogRef}
      onKeyDown={onDialogKeyDown}
    >
      <div className="na-frame">
        <main className="na-join na-consent" data-accent="terracotta">
          <div className="na-mark na-join-mark" aria-hidden="true">{Ico("shield", { width: 22, height: 22 })}</div>
          <span className="na-consent-kind">{sample ? "Synthetic sample" : "Empty workspace"}</span>
          <h1 id="rjc-title" className="na-join-title" ref={titleRef} tabIndex={-1}>{sample ? "Create this sample room?" : "Create this workspace?"}</h1>
          <p id="rjc-description" className="na-join-sub">
            {sample
              ? "NodeRoom will add demonstration artifacts and trace data. They are examples, not your work."
              : "NodeRoom will open a blank shared workspace. No sample artifacts or agent runs will be added."}
          </p>

          <div id="rjc-access" className="na-consent-access" role="note">
            <strong>Code-access room · {roomCode}</strong>
            <span>Anyone allowed by this deployment who has the code can join as an editor. The invite link does not expire.</span>
          </div>

          <fieldset className="na-consent-options">
            <legend>How should agent edits land?</legend>
            <ConsentCard
              value="review"
              selected={choice === "review"}
              icon="shield"
              title="Review every edit"
              badge="Recommended"
              summary="Agent changes wait as proposals until the host approves or rejects them."
              detail="Runs can still create provider, job, trace, and chat records. Artifact edits stay governed."
              onSelect={setChoice}
            />
            <ConsentCard
              value="auto"
              selected={choice === "auto"}
              icon="bolt"
              title="Auto-approve edits"
              summary="Validated agent changes can commit directly; conflicts still route to review."
              detail="Use this only when faster iteration matters more than approving each artifact change."
              onSelect={setChoice}
            />
          </fieldset>

          <button
            type="button"
            className="na-btn primary full na-consent-submit"
            onClick={() => onAccept(choice === "auto")}
            data-testid={sample ? "mobile-sample-confirm" : "mobile-create-confirm"}
          >
            {sample ? "Create sample room" : "Create workspace"} {Ico("arrow", { width: 16, height: 16 })}
          </button>
          <button type="button" className="na-btn full" onClick={onCancel}>Back</button>
        </main>
      </div>
    </div>
  );
}

function ConsentCard({
  value,
  selected,
  icon,
  title,
  badge,
  summary,
  detail,
  onSelect,
}: {
  value: ConsentChoice;
  selected: boolean;
  icon: Parameters<typeof Ico>[0];
  title: string;
  badge?: string;
  summary: string;
  detail: string;
  onSelect: (choice: ConsentChoice) => void;
}): React.ReactElement {
  return (
    <label className="na-consent-card" data-selected={String(selected)}>
      <input type="radio" name="agent-policy" value={value} checked={selected} onChange={() => onSelect(value)} />
      <span className="na-consent-radio" aria-hidden="true">{selected ? Ico("check", { width: 12, height: 12 }) : null}</span>
      <span className="na-consent-copy">
        <strong>{Ico(icon, { width: 16, height: 16 })}{title}{badge ? <em>{badge}</em> : null}</strong>
        <span>{summary}</span>
        <small>{detail}</small>
      </span>
    </label>
  );
}
