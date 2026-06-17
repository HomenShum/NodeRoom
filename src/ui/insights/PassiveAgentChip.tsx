import { useState, useRef, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { useStore } from "../../app/store";
import { NoteworthyInbox } from "./NoteworthyInbox";
import type { PassiveActivityItem } from "../../app/store";

/** Statuses that are settled and quiet — never surfaced as needing attention. */
const QUIET_STATUSES = new Set(["not_noteworthy", "ignored", "completed"]);

function actionable(items: PassiveActivityItem[]): PassiveActivityItem[] {
  return items.filter((i) => !QUIET_STATUSES.has(i.status));
}

/** Calm chip that appears in the status strip only when the room has noticed something
 *  worth returning to. Reads the passive-intelligence feed through `useStore()` so it
 *  renders identically in memory ([] → hidden) and live Convex (reactive). Clicking opens
 *  the NoteworthyInbox popover anchored above the strip; never auto-edits anything. */
export function PassiveAgentChip({
  roomId,
  onOpenArtifact,
}: {
  roomId: string;
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const store = useStore();
  const feed = store.listPassiveActivity?.(roomId) ?? [];
  const items = actionable(feed);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click / Escape so the popover doesn't linger over the work surface.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className="r-passive-wrap" ref={wrapRef}>
      <button
        className="r-signal-chip r-passive-chip"
        data-testid="passive-agent-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Room noticed ${items.length} item${items.length === 1 ? "" : "s"}. Open passive intelligence inbox.`}
        onClick={() => setOpen((v) => !v)}
      >
        <Sparkles size={12} /> <b>Room</b> noticed {items.length}
      </button>
      {open && (
        <NoteworthyInbox
          items={items}
          onOpenArtifact={(id, opts) => { onOpenArtifact(id, opts); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
