/**
 * Always-On Rooms — subscribe modal (double opt-in email capture).
 * Ports design-reference/alwayson/ao-ops.jsx §4 left column (email field,
 * cadence radios with the specimen sublabels, primary Subscribe button, the
 * double-opt-in note) into a dismissable overlay: Escape, scrim click, and
 * the X all close it — the design audit forbids undismissable chrome.
 *
 * Data honesty (HONEST_STATUS):
 *   - Live (HAS_CONVEX): calls convex alwaysOn.subscribeToRoom via the
 *     typed-cast api seam in ./usePublicRoomData. `{ ok:false, reason }` maps
 *     to an inline error — never a success state. A transport/missing-function
 *     throw falls back to the demo success, which is honest because nothing
 *     WAS stored, and it says so. The hosted confirmation-email sender is not
 *     wired here yet; live success means "pending row stored", not "email sent".
 *   - Memory mode: never fakes a subscription — the success state is locked
 *     to a "demo — nothing was stored" hint.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { useMutation } from "convex/react";
import { HAS_CONVEX } from "../app/store";
import { FocusTrapDialog } from "../ui/primitives/FocusTrapDialog";
import { AoIcon as Ic } from "./AoIcon";
import { alwaysOnApi } from "./usePublicRoomData";
import "./alwayson.css";

export type SubscribeModalProps = {
  roomSlug: string;
  roomTitle: string;
  onClose: () => void;
};

type Cadence = "daily" | "weekly" | "act_now";

/** Specimen cadence rows — label + sublabel verbatim from ao-ops.jsx §4. */
const CADENCES: Array<{ key: Cadence; label: string; sub: string }> = [
  { key: "daily", label: "Daily brief", sub: "weekday 9:15, after the scan" },
  { key: "weekly", label: "Weekly digest", sub: "Monday 8:00" },
  { key: "act_now", label: "Act-now only", sub: "only when something material changes" },
];

type SubmitOutcome =
  | { kind: "live" }
  | { kind: "demo" }
  | { kind: "error"; message: string };

/**
 * Mirrors evaluateSubscriptionRequest reasons in convex/alwaysOn.ts.
 * Anti-enumeration: already-subscribed / pending-capped addresses come back as
 * plain { ok:true } (no reason), so those branches cannot arrive here — the
 * server never confirms whether a specific email is subscribed.
 */
function reasonMessage(reason: string): string {
  switch (reason) {
    case "invalid_email":
      return "That doesn't look like a valid email address.";
    case "room_not_found":
    case "room_not_active":
      return "This room isn't accepting subscriptions right now.";
    case "rate_limited":
      return "Too many subscriptions right now — try again in a minute.";
    case "room_subscription_limit":
      return "This room has reached its subscriber limit.";
    default:
      return "Could not subscribe. Please try again.";
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SubscribeForm({
  roomTitle,
  onSubmit,
}: {
  roomTitle: string;
  onSubmit: (email: string, cadence: Cadence) => Promise<SubmitOutcome>;
}) {
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | "live" | "demo">(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const radioRefs = useRef<Record<Cadence, HTMLDivElement | null>>({
    daily: null,
    weekly: null,
    act_now: null,
  });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const outcome = await onSubmit(trimmed, cadence);
      if (outcome.kind === "error") setError(outcome.message);
      else setDone(outcome.kind);
    } finally {
      setBusy(false);
    }
  };

  const selectCadence = (next: Cadence, focus = false) => {
    setCadence(next);
    if (focus) window.requestAnimationFrame(() => radioRefs.current[next]?.focus());
  };

  if (done) {
    if (done === "demo") {
      return (
        <>
          <div className="h">Demo subscription not stored</div>
          <div className="s" data-testid="ao-subscribe-success">
            This preview accepted the form, but no email was sent and no subscription was stored for {roomTitle}.
          </div>
          <div className="ao-optin" data-testid="ao-subscribe-demo-hint">
            <Ic name="alert" size={13} style={{ flex: "none" }} />
            demo - nothing was stored. Subscriptions go live with the hosted room.
          </div>
          <div className="ao-optin">
            <Ic name="shield" size={13} style={{ flex: "none" }} />
            One-click unsubscribe in every digest.
          </div>
        </>
      );
    }
    return (
      <>
        <div className="h">Subscription request received</div>
        <div className="s" data-testid="ao-subscribe-success">
          Your {CADENCES.find((c) => c.key === cadence)?.label.toLowerCase()} for {roomTitle} is
          pending confirmation. Automatic confirmation email delivery is not wired yet, so the
          request is stored but no email has been sent.
        </div>
        <div className="ao-optin">
          <Ic name="shield" size={13} style={{ flex: "none" }} />
          Digests stay inactive until the subscription is confirmed. One-click unsubscribe appears
          in every active digest.
        </div>
      </>
    );
  }

  return (
    // noValidate: the app's own inline error handles bad emails (HONEST_STATUS,
    // consistent copy) instead of the browser's native bubble.
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: "contents" }}>
      <div className="h">Subscribe to {roomTitle}</div>
      <div className="s">Get an email when this room changes. No account required.</div>
      <div className="ao-field">
        <label htmlFor="ao-subscribe-email">Email</label>
        <input
          id="ao-subscribe-email"
          ref={inputRef}
          className="ao-input"
          type="email"
          placeholder="you@university.edu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          data-testid="ao-subscribe-email"
        />
      </div>
      <div className="ao-field">
        <label id="ao-cadence-label">Cadence</label>
        <div className="ao-radio-group" role="radiogroup" aria-labelledby="ao-cadence-label">
          {CADENCES.map((c, index) => (
            <div
              className={"ao-radio" + (cadence === c.key ? " on" : "")}
              key={c.key}
              role="radio"
              aria-checked={cadence === c.key}
              tabIndex={cadence === c.key ? 0 : -1}
              ref={(el) => {
                radioRefs.current[c.key] = el;
              }}
              onClick={() => selectCadence(c.key)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectCadence(c.key);
                  return;
                }
                const nextIndex =
                  e.key === "ArrowRight" || e.key === "ArrowDown"
                    ? (index + 1) % CADENCES.length
                    : e.key === "ArrowLeft" || e.key === "ArrowUp"
                      ? (index - 1 + CADENCES.length) % CADENCES.length
                      : null;
                if (nextIndex === null) return;
                e.preventDefault();
                selectCadence(CADENCES[nextIndex].key, true);
              }}
            >
              <span className="r"></span>
              {c.label}
              <span className="sub">{c.sub}</span>
            </div>
          ))}
        </div>
      </div>
      {error && (
        <div className="err" role="alert" data-testid="ao-subscribe-error">
          {error}
        </div>
      )}
      <button className="ao-btn pri" type="submit" style={{ justifyContent: "center" }} disabled={busy}>
        <Ic name="mail" size={13} />
        {busy ? "Subscribing…" : "Subscribe"}
      </button>
      <div className="ao-optin">
        <Ic name="shield" size={13} style={{ flex: "none" }} />
        Confirmation is required before digests activate. One-click unsubscribe appears in every
        active digest.
      </div>
    </form>
  );
}

/** Live lane — MUST only mount when HAS_CONVEX (useMutation needs the provider). */
function LiveSubscribeForm({ roomSlug, roomTitle }: { roomSlug: string; roomTitle: string }) {
  const subscribe = useMutation(alwaysOnApi.subscribeToRoom);
  return (
    <SubscribeForm
      roomTitle={roomTitle}
      onSubmit={async (email, cadence) => {
        try {
          const result = (await subscribe({ slug: roomSlug, email, cadence })) as
            | { ok: true }
            | { ok: false; reason?: string }
            | null
            | undefined;
          if (result && result.ok === true) return { kind: "live" };
          // HONEST_STATUS: a rejected request never renders success.
          return {
            kind: "error",
            message: reasonMessage(result && result.ok === false ? result.reason ?? "" : ""),
          };
        } catch (error) {
          // Function missing / transport down: nothing was stored — say so.
          console.warn("[alwayson] subscribeToRoom unavailable — demo acknowledgement", error);
          return { kind: "demo" };
        }
      }}
    />
  );
}

/** Memory-mode lane — never pretends a subscription was stored. */
function DemoSubscribeForm({ roomTitle }: { roomTitle: string }) {
  return <SubscribeForm roomTitle={roomTitle} onSubmit={() => Promise.resolve({ kind: "demo" })} />;
}

export function SubscribeModal({ roomSlug, roomTitle, onClose }: SubscribeModalProps): ReactElement | null {
  return (
    <FocusTrapDialog
      className="ao-modal-scrim"
      panelClassName="ao-panel ao-modal ao-modal-card"
      ariaLabel="Subscribe to this room"
      testId="ao-subscribe-modal"
      onClose={onClose}
    >
      <button className="ao-btn ghost ao-modal-x" type="button" aria-label="Close" onClick={onClose}>
        <Ic name="x" size={14} />
      </button>
      {HAS_CONVEX ? (
        <LiveSubscribeForm roomSlug={roomSlug} roomTitle={roomTitle} />
      ) : (
        <DemoSubscribeForm roomTitle={roomTitle} />
      )}
    </FocusTrapDialog>
  );
}
