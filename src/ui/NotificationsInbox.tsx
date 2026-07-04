/**
 * NotificationsInbox — the top-bar bell chip + compact inbox behind the design
 * contract "Notifications: instant (mentions, watched rows) / hourly (run
 * digests) / daily (rest) · watch = W".
 *
 * Tier grouping reuses the SAME pure policy module the server records with
 * (src/notifications/tiers.ts) — the client can never invent a tier the
 * backend didn't compute. Amber (= needs review) appears ONLY while unread
 * notifications exist; read state is quiet chrome. Terracotta stays reserved
 * for provenance/selection.
 *
 * Live (Convex) mode only: RoomShell mounts this component exclusively when
 * store.mode === "convex" && proof — the in-memory engine has no notification
 * log, so memory mode shows NOTHING (honest absence, same rule as cell
 * history). A local error boundary keeps a not-yet-deployed watches backend
 * from white-screening the room shell: the chip simply doesn't render.
 *
 * Watch = W: a window-level "w" listener (never while typing — same
 * textEntryIsActive contract as "/" and ⌘K) toggles a ROW watch for the sheet
 * cell the user last interacted with. Sheet <td>s are not focusable (the
 * table owns tabIndex), so "focused cell" = document.activeElement's closest
 * [data-element-id] when there is one, else the last pointer-touched cell —
 * the same interaction the presence "focus" claim paints. The ⌘K palette's
 * "Toggle watch on focused row" action funnels into the identical code path
 * via a window CustomEvent, so key and palette can never drift.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { AtSign, Bell, Check, Eye, ListChecks, X } from "lucide-react";
import type { FunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { ActorProof } from "../app/store";
import { textEntryIsActive } from "./focusMode";
import {
  NOTIFICATION_TIERS,
  type NotificationKind,
  type NotificationTier,
} from "../notifications/tiers";
import "./notifications.css";

// convex/_generated lags until the next codegen — which must NOT be run
// casually: `npx convex codegen` against a configured cloud deployment DEPLOYS
// schema+functions (documented gotcha). Same cast precedent as
// src/ui/panels/Artifact.tsx elementHistoryApi / src/ui/Landing.tsx.
export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  tier: NotificationTier;
  actorId?: string;
  targetKind?: "row" | "artifact";
  targetId?: string;
  windowKey?: string;
  payload?: Record<string, string>;
  count: number;
  readAt?: number;
  createdAt: number;
};
type WatchRow = { targetKind: "row" | "artifact"; targetId: string; updatedAt: number };
type RoomScopedArgs = { roomId: string; requester: ActorProof };
type SetWatchArgs = RoomScopedArgs & { targetKind: "row" | "artifact"; targetId: string; on: boolean };
const watchesApi = (api as unknown as {
  watches: {
    listNotifications: FunctionReference<"query", "public", RoomScopedArgs, NotificationRow[]>;
    listWatches: FunctionReference<"query", "public", RoomScopedArgs, WatchRow[]>;
    setWatch: FunctionReference<"mutation", "public", SetWatchArgs, { on: boolean; changed: boolean }>;
    markNotificationsRead: FunctionReference<"mutation", "public", RoomScopedArgs, { marked: number }>;
  };
}).watches;

/** Palette → W-key funnel: one event, one handler, zero drift. */
export const WATCH_TOGGLE_EVENT = "noderoom:toggle-watch";
export function requestWatchToggle(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WATCH_TOGGLE_EVENT));
}

const TIER_LABEL: Record<NotificationTier, string> = { instant: "Instant", hourly: "Hourly", daily: "Daily" };
const KIND_LABEL: Record<string, string> = { mention: "Mention", watched_write: "Watched row", run_digest: "Run digest" };
/** Toast lifetime — long enough to read, short enough to stay quiet chrome. */
const TOAST_MS = 2400;

export type FocusedRowTarget = { rowId: string; elementId: string; artifactId?: string };

/**
 * Resolve "the focused sheet row": document.activeElement's closest
 * [data-element-id] first (spec), else the last pointer-touched cell. Row id
 * is the elementId's row half ("sr_0004__owner" → "sr_0004") — the same
 * split the sheet renderer + wave-1 watch contract use. Pure; exported for
 * future scenario tests.
 */
export function resolveFocusedRowTarget(
  activeElement: Element | null,
  lastCell: FocusedRowTarget | null,
): FocusedRowTarget | null {
  const fromActive = activeElement?.closest?.("[data-element-id]") ?? null;
  if (fromActive) {
    const elementId = fromActive.getAttribute("data-element-id") ?? "";
    if (elementId) {
      return {
        elementId,
        rowId: elementId.split("__")[0],
        artifactId: fromActive.closest("[data-artifact-id]")?.getAttribute("data-artifact-id") ?? undefined,
      };
    }
  }
  return lastCell;
}

/** Compact relative time for inbox rows ("just now" / "5m ago" / "3h ago" / "4d ago"). */
export function notificationTimeAgo(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** One-line body for a row: payload preview > actor attribution > target id. */
export function notificationRowText(row: Pick<NotificationRow, "payload" | "targetId" | "kind">): string {
  const preview = row.payload?.preview?.trim();
  if (preview) return preview;
  if (row.targetId) return row.targetId;
  return KIND_LABEL[row.kind] ?? row.kind;
}

export function NotificationsInbox(props: { roomId: string; requester: ActorProof }) {
  return (
    <NotificationsErrorBoundary>
      <NotificationsInboxInner {...props} />
    </NotificationsErrorBoundary>
  );
}

function NotificationsInboxInner({ roomId, requester }: { roomId: string; requester: ActorProof }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** Last sheet cell the pointer touched — the W key's fallback "focused cell". */
  const lastCellRef = useRef<FocusedRowTarget | null>(null);

  const rows = useQuery(watchesApi.listNotifications, { roomId: roomId as never, requester }) ?? [];
  const watches = useQuery(watchesApi.listWatches, { roomId: roomId as never, requester }) ?? [];
  const setWatch = useMutation(watchesApi.setWatch);
  const markAllRead = useMutation(watchesApi.markNotificationsRead);

  const unread = rows.filter((r) => r.readAt == null).length;
  const groups = useMemo(
    () => NOTIFICATION_TIERS.map((tier) => ({ tier, rows: rows.filter((r) => r.tier === tier) })).filter((g) => g.rows.length > 0),
    [rows],
  );

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Refs so the window listeners below stay stable (no re-subscribe churn —
  // the CommandPalette listener-count contract).
  const toggleWatchRef = useRef<() => void>(() => {});
  toggleWatchRef.current = () => {
    const target = resolveFocusedRowTarget(document.activeElement, lastCellRef.current);
    if (!target) {
      showToast("Select a sheet cell first — W watches its row");
      return;
    }
    const active = watches.some((w) => w.targetKind === "row" && w.targetId === target.rowId);
    void setWatch({ roomId: roomId as never, requester, targetKind: "row", targetId: target.rowId, on: !active })
      .then((r) => showToast(r.on ? `Watching row ${target.rowId} — writes notify instantly` : `Stopped watching row ${target.rowId}`))
      .catch((err: unknown) => {
        const raw = err instanceof Error ? err.message : String(err);
        showToast(raw.includes("watch_limit_reached") ? "Watch limit reached (200) — unwatch something first" : "Couldn't update watch — try again");
      });
  };

  useEffect(() => {
    // W = watch the focused row (design: "watch = W"). Never mid-typing, never
    // with modifiers — identical etiquette to the "/" and ⌘K layers.
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "w" && e.key !== "W") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (textEntryIsActive()) return;
      e.preventDefault();
      toggleWatchRef.current();
    };
    const onToggleEvent = () => toggleWatchRef.current();
    // Remember the last sheet cell the pointer touched (capture phase so it
    // fires even when the cell click is handled upstream). Cells are <td>s
    // without tabindex, so this — not activeElement — is the usual W target.
    const onPointerDown = (e: Event) => {
      const cell = (e.target as Element | null)?.closest?.("[data-element-id]");
      const elementId = cell?.getAttribute("data-element-id");
      if (!cell || !elementId) return;
      lastCellRef.current = {
        elementId,
        rowId: elementId.split("__")[0],
        artifactId: cell.closest("[data-artifact-id]")?.getAttribute("data-artifact-id") ?? undefined,
      };
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(WATCH_TOGGLE_EVENT, onToggleEvent);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(WATCH_TOGGLE_EVENT, onToggleEvent);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  // Esc / outside-pointerdown close — dismissable chrome, standard contract.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onOutside = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, [open]);

  return (
    <div className="r-notif" ref={rootRef} data-noderoom-surface="shell.notifications">
      <button
        type="button"
        className="r-iconbtn r-notif-bell"
        data-testid="notifications-bell"
        data-on={String(open)}
        data-unread={String(unread > 0)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications"}
        aria-label={unread > 0 ? `Open notifications — ${unread} unread` : "Open notifications"}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="r-notif-badge" data-testid="notifications-unread-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="r-notif-panel" role="dialog" aria-label="Notifications" data-testid="notifications-inbox">
          <div className="r-notif-head">
            <Bell size={13} />
            <span className="r-notif-title">Notifications</span>
            <span className="r-notif-policy" title="Instant: mentions + watched rows · Hourly: run digests · Daily: the rest · watch = W">
              instant · hourly · daily
            </span>
            <button
              type="button"
              className="r-notif-markread"
              data-testid="notifications-mark-read"
              disabled={unread === 0}
              title="Mark all read"
              onClick={() => { void markAllRead({ roomId: roomId as never, requester }).catch(() => showToast("Couldn't mark read — try again")); }}
            >
              <ListChecks size={12} /> Mark all read
            </button>
            <button type="button" className="r-iconbtn r-iconbtn-sm" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          {groups.length === 0 && (
            <div className="r-notif-empty" data-testid="notifications-empty">
              Quiet so far. Mentions and watched-row writes land here instantly; run digests hourly; the rest daily. Press <kbd>W</kbd> on a sheet cell to watch its row.
            </div>
          )}
          {groups.map((g) => (
            <div key={g.tier} className="r-notif-group">
              <div className="r-notif-tier" data-tier={g.tier}>{TIER_LABEL[g.tier]}</div>
              {g.rows.map((row) => (
                <div key={row.id} className="r-notif-row" data-testid="notification-row" data-kind={row.kind} data-unread={String(row.readAt == null)}>
                  <span className="r-notif-kind" aria-hidden>
                    {row.kind === "mention" ? <AtSign size={12} /> : row.kind === "watched_write" ? <Eye size={12} /> : <Check size={12} />}
                  </span>
                  <span className="r-notif-body">
                    <span className="r-notif-line">{notificationRowText(row)}</span>
                    <span className="r-notif-meta">
                      {KIND_LABEL[row.kind] ?? row.kind}
                      {row.payload?.from ? ` · ${row.payload.from}` : ""}
                      {row.count > 1 ? ` · ×${row.count}` : ""}
                      {` · ${notificationTimeAgo(row.createdAt)}`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {toast && (
        <div className="r-notif-toast" role="status" aria-live="polite" data-testid="watch-toast">{toast}</div>
      )}
    </div>
  );
}

/**
 * Convex useQuery throws during RENDER when the server function is missing or
 * throws (e.g. the watches backend not deployed yet, a revoked proof). A local
 * boundary turns that into honest absence — the shell keeps working, the bell
 * simply isn't there. Same reasoning as FrontierObservationsPanel's boundary.
 */
class NotificationsErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}
