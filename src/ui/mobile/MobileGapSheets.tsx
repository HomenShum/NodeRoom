/* ============================================================================
   NodeAgent Mobile — Gap Pack sheets & overlays.
   Design source: design-reference/mobile-scale/gaps-app.jsx + gaps.css.
   These are the touch re-projections of desktop surfaces the phone was missing:

     • ReviewSheet    — Intake→Evidence→Draft→Review→Export pipeline checklist
     • TraceSheet     — recent trace rows (kind chips), bounded
     • ShareSheet     — invite code + decorative code pattern + role/expiry chips
     • ManageSheet    — role groups + live location (same data as PeoplePanel)
     • FirstJoinOverlay — 1-card guest welcome (extends RoomJoinConsent patterns)
     • OfflineBanner  — held-edits banner read from the store's offline snapshot

   Honesty: every field that has no backend yet is labelled as such with a muted
   caption ("coming with permissions backend") — never faked. The invite code,
   pipeline, trace, people, and offline snapshot are all REAL live data.

   Styling reuses gp-/ms-/cn-/na- classes (added to mobile.css from gaps.css) and
   only tokens that already resolve in the app scope (src/app/styles.css).
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import type { MobileCtx } from "./mobileTypes";
import type { ManageGroup, PipelineStage, TraceRow } from "./mobileData";

function SheetHead({ title, sub, right, onClose }: { title: React.ReactNode; sub?: string; right?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="na-sheet-head">
      <div className="st">
        <strong>{title}</strong>
        {sub ? <span>{sub}</span> : null}
      </div>
      {right}
      <button className="na-close" onClick={onClose} aria-label="Close">{Ico("x")}</button>
    </div>
  );
}

// ── 2 · Review tab: pipeline checklist ───────────────────────────────────────
// Reads ctx.pipeline (Intake→Evidence→Draft→Review→Export), derived from the
// SAME live data the desktop pipeline bar reads (artifacts + proposals + jobs).
export function ReviewSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const stages = ctx.pipeline;
  const reviewStage = stages.find((s) => s.key === "review");
  const waiting = ctx.inboxItems.length;
  return (
    <>
      <SheetHead title="Review pipeline" sub="Intake → Evidence → Draft → Review → Export" onClose={ctx.closeSheet} />
      <div className="na-sheet-body">
        <div className="gp-lbl" data-testid="gap-pipeline-label">Pipeline</div>
        <div className="gp-pipe" data-testid="gap-pipeline">
          {stages.map((s: PipelineStage) => (
            <div className={"gp-prow " + s.state} key={s.key} data-stage={s.key} data-state={s.state}>
              <span className="d">{s.state === "done" ? Ico("check", { width: 10, height: 10 }) : s.state === "on" ? "●" : ""}</span>
              {s.label}
              {s.meta ? <span className="mt">{s.meta}</span> : null}
            </div>
          ))}
        </div>

        <div className="gp-lbl" style={{ marginTop: 14 }}>
          Needs review · {reviewStage?.meta || (waiting ? waiting + " waiting" : "0 waiting")}
        </div>
        <div className="na-sheet-scroll" data-testid="gap-review-queue">
          {waiting === 0 ? (
            <div className="gp-cap">Nothing waiting — the review queue is clear.</div>
          ) : (
            ctx.inboxItems.slice(0, 8).map((it) => (
              <div className="ms-row" key={it.id}>
                <div className="tx">
                  <div className="nm">{it.title}</div>
                  <div className="it">{it.sub}</div>
                </div>
                <span className="fx-st needs_review">review</span>
              </div>
            ))
          )}
          <div className="gp-cap">swipe left on any grid row to flag · swipe right to watch</div>
        </div>

        <div className="ms-actions gp-review-actions">
          <button type="button" onClick={() => ctx.openSheet("evidence")}>{Ico("shield", { width: 12, height: 12 })}Evidence</button>
          <button type="button" className="pri" onClick={() => { ctx.setTab("inbox"); ctx.closeSheet(); }}>{Ico("inbox", { width: 12, height: 12 })}Open Inbox</button>
        </div>
      </div>
    </>
  );
}

// ── 3 · Trace sheet: recent trace rows (kind chips), bounded ─────────────────
export function TraceSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const rows = ctx.traceRows;
  return (
    <>
      <SheetHead
        title={<span>Room trace<span className="sc-count" data-testid="gap-trace-count">{rows.length}</span></span>}
        sub="most recent first · grouped by kind"
        onClose={ctx.closeSheet}
      />
      <div className="na-sheet-body">
        <div className="na-sheet-scroll" data-testid="gap-trace-rows">
          {rows.length === 0 ? (
            <div className="na-empty">
              <div className="eico">{Ico("history")}</div>
              <strong>No trace yet</strong>
              <span>Commits, locks, and citations will appear here as the room works.</span>
            </div>
          ) : (
            rows.map((r: TraceRow) => (
              <button
                type="button"
                className="sc-trrow"
                key={r.id}
                data-testid="gap-trace-row"
                onClick={() => ctx.openTrace(r.id)}
              >
                <span className={"sc-trk " + r.kind} data-kind={r.kind}>{r.kind}</span>
                <span className="txt">{r.text}</span>
                <span className="t">{r.time}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

// ── 5 · Share sheet: invite code prominent + decorative code box + chips ─────
export function ShareSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const code = ctx.inviteCode || ctx.room.code || "";
  const [copied, setCopied] = React.useState(false);
  const doCopy = async (): Promise<void> => {
    const link = typeof window !== "undefined" ? window.location.origin + "/#mobile?room=" + code : code;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setCopied(true);
      ctx.toast("Invite link copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      ctx.toast("Invite link was not copied. Select the room code and copy it manually.");
    }
  };
  // Decorative pattern seeded off the real code so it is stable per room — but it
  // is NOT a scannable QR. Labelled honestly below.
  const seed = Array.from(code).reduce((a, ch) => a + ch.charCodeAt(0), code.length);
  return (
    <>
      <SheetHead title="Share room" sub="treat this link like an access code" onClose={ctx.closeSheet} />
      <div className="na-sheet-body">
        <div className="gp-qr" role="img" aria-label="Decorative code pattern (not scannable)" data-testid="gap-share-pattern">
          {Array.from({ length: 49 }, (_, i) => <i key={i} className={(i * 7 + seed) % 5 < 2 ? "o" : ""} />)}
        </div>
        <div className="gp-cap" style={{ textAlign: "center" }}>Decorative pattern — not a scannable QR yet</div>

        <button type="button" className="gp-code" onClick={() => { void doCopy(); }} data-testid="gap-invite-code" aria-label={"Copy invite link for room " + code}>
          {code ? "code: " + code : "code: —"}
          {Ico(copied ? "check" : "link", { width: 15, height: 15 })}
        </button>

        <div className="gp-cap" data-testid="gap-share-access-copy">
          Anyone allowed by this deployment who has the link can join as a member, edit shared content,
          upload files, use room chat, and run NodeAgent. This link does not currently expire.
        </div>

        <div className="ms-actions">
          <button type="button" onClick={() => { void doCopy(); }}>{Ico("link", { width: 12, height: 12 })}Copy link</button>
        </div>
      </div>
    </>
  );
}

// ── 6 · Manage people: role groups + live location ───────────────────────────
export function ManageSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const groups = ctx.peopleGroups;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <>
      <SheetHead
        title={<span>Manage people<span className="sc-count" data-testid="gap-people-count">{total}</span></span>}
        sub="who is here, by role · live location"
        onClose={ctx.closeSheet}
      />
      <div className="na-sheet-body">
        <div className="na-sheet-scroll" data-testid="gap-people-groups">
          {groups.length === 0 ? (
            <div className="na-empty">
              <div className="eico">{Ico("users")}</div>
              <strong>Nobody here yet</strong>
              <span>Members and agents appear here as they join.</span>
            </div>
          ) : (
            groups.map((g: ManageGroup) => (
              <div className="gp-pgroup" key={g.key} data-role={g.key}>
                <div className="gp-lbl">{g.label} · {g.rows.length}</div>
                {g.rows.map((p) => (
                  <div className="cn-aclrow" key={p.id} data-testid="gap-person-row" style={{ padding: "6px 2px" }}>
                    <span className={"fx-av" + (p.role === "agent" ? " agent" : "")} style={{ background: p.color, width: 24, height: 24, fontSize: 9 }}>{p.short}</span>
                    <span className="tx">
                      <span className="nm">{p.name}</span>
                      {p.location ? <span className="it">{p.location}</span> : null}
                    </span>
                    <span className={"fx-st " + (p.role === "agent" ? "running" : p.role === "host" ? "complete" : "")}>{p.role}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="gp-cap" data-testid="gap-manage-stub-caption">
          Bulk role, expiry, and revoke are preview-only — coming with the permissions backend.
        </div>
      </div>
    </>
  );
}

// ── 8 · First-join notice (extends RoomJoinConsent patterns; not a duplicate) ─
// A single welcome card shown once per session. It is intentionally non-modal:
// the room, dock, chat, and sheets remain usable before the user dismisses it.
export function FirstJoinOverlay({
  people,
  agents,
  sample = false,
  credits,
  onDismiss,
}: {
  people: number;
  agents: number;
  sample?: boolean;
  credits?: { availableCredits: number; availableUsd: number; reservedCredits: number; requiredCredits: number; paused: boolean };
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="gp-onb-wrap" data-testid="gap-firstjoin" role="status" aria-live="polite" aria-labelledby="gp-onb-title">
      <div className="gp-onb">
        <div className="faces" aria-hidden>
          <span className="fx-av">{Ico("users", { width: 14, height: 14 })}</span>
        </div>
        <h4 id="gp-onb-title">
          {people > 0 ? `${people} ${people === 1 ? "person is" : "people are"}` : "You are"}
          {agents > 0 ? ` & ${agents} agent${agents === 1 ? "" : "s"} here` : " here"}
        </h4>
        <p>
          {sample
            ? "This workspace contains synthetic companies, sources, messages, and traces. Use it to inspect the review flow."
            : "Everyone in this room can read room messages and edit shared artifacts. Locks and receipts apply to your edits and the agent’s."}
        </p>
        {!sample && credits ? (
          <p className="gp-onb-credit" data-testid="mobile-firstjoin-credits">
            <strong>{credits.availableCredits.toFixed(1)} credits (${credits.availableUsd.toFixed(2)}) available.</strong>{" "}
            {credits.paused
              ? "Live work is paused for this room."
              : `${credits.requiredCredits.toFixed(1)} credits may be held for a standard run and unused credit is released after settlement.`}
            {credits.reservedCredits > 0 ? ` ${credits.reservedCredits.toFixed(1)} credits are held now.` : ""}
          </p>
        ) : null}
        <div className="acts">
          <button type="button" className="pri" aria-label="Dismiss first-join welcome" onClick={onDismiss}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ── 9 · Offline banner: held edits are visible, never lost ───────────────────
// Reads the store's offline snapshot (ctx.offline). Renders NOTHING when there
// is no transport to lose (memory mode) or nothing is held — quiet by default.
export function OfflineBanner({ ctx }: { ctx: MobileCtx }): React.ReactElement | null {
  const o = ctx.offline;
  if (!o) return null;
  if (o.held === 0 && o.dropped === 0 && o.conflicts === 0) return null;
  const parts: string[] = [];
  if (o.held > 0) parts.push(`${o.held} edit${o.held === 1 ? "" : "s"} held locally`);
  if (o.dropped > 0) parts.push(`${o.dropped} dropped (queue full)`);
  if (o.conflicts > 0) parts.push(`${o.conflicts} conflict${o.conflicts === 1 ? "" : "s"} on replay`);
  return (
    <div className="gp-banner" data-testid="gap-offline-banner" role="status">
      {Ico("bolt", { width: 12, height: 12 })}
      <span className="gp-banner-tx">{o.replaying ? "Reconnecting — " : "Connection lost — "}{parts.join(" · ")}</span>
      {o.conflicts > 0 && ctx.acknowledgeOfflineConflicts ? (
        <button type="button" className="gp-banner-act" onClick={() => ctx.acknowledgeOfflineConflicts!()}>Dismiss</button>
      ) : (
        <span className="gp-banner-act">{o.replaying ? "retrying…" : "will retry"}</span>
      )}
    </div>
  );
}
