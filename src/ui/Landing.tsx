/** Landing (`.r-landing` + `.r-land2-*`) — "Diligence that shows its work."
 *  Landing-v2 parity (design-reference/room/landing-v2.jsx): two-column hero with a
 *  LOOPING product demo (lock → cite → commit → draft → smart-merge → v43), a
 *  live-proof pill (real counts in live mode, honest "demo" tag in memory mode),
 *  and a feature strip with UI micro-shots. Create/join flows + testids unchanged. */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { ArrowLeft, ArrowRight, Check, Lock, Moon, Plus, Sparkles, Users, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { createFreshRoom, enterDemoRoomAsHost, joinRoomByCode } from "../app/roomStore";
import { NodeReveal } from "./motion/NodeReveal";
import { FocusTrapDialog } from "./primitives/FocusTrapDialog";
import type { Session } from "./App";
import "./landing.css";

type LandingProps = {
  onEnter?: (s: Session) => void;
  mode?: "memory" | "live";
  defaultCode?: string;
  busy?: boolean;
  joinError?: string | null;
  initialIntent?: "create" | "join" | "sample" | null;
  onLiveDemo?: (name: string, autoAllow: boolean) => void;
  onLiveJoin?: (code: string, name: string) => void;
  onLiveCreate?: (name: string, title: string, code: string, autoAllow: boolean) => void;
};

export function Landing({
  onEnter,
  mode = "memory",
  defaultCode,
  busy = false,
  joinError,
  initialIntent = null,
  onLiveDemo,
  onLiveJoin,
  onLiveCreate,
}: LandingProps) {
  const [join, setJoin] = useState(defaultCode ?? "");
  const [name, setName] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joinDialogCode, setJoinDialogCode] = useState<string | null>(null);
  const initialHostKind = initialIntent === "create" ? "workspace" : initialIntent === "sample" ? "sample" : null;
  const [hostKind, setHostKind] = useState<"workspace" | "sample" | null>(initialHostKind);
  const [createDialogCode, setCreateDialogCode] = useState<string | null>(() => initialHostKind ? makeLandingRoomCode() : null);
  const [createTitle, setCreateTitle] = useState(initialHostKind === "sample" ? "Startup Banking Diligence War Room" : "My workspace");
  const [autoAllow, setAutoAllow] = useState(false);
  const joinInputRef = useRef<HTMLInputElement>(null);
  const live = mode === "live";
  const shownError = joinError ?? joinErr;
  const displayName = (fallback = "Guest") => name.trim() || fallback;
  useEffect(() => {
    if (!live || !initialIntent) return;
    if (initialIntent === "join") {
      if (defaultCode) setJoinDialogCode(defaultCode);
      else requestAnimationFrame(() => joinInputRef.current?.focus());
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("intent");
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore */
    }
  }, [defaultCode, initialIntent, live]);
  const toggleTheme = () => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  };

  const tryJoin = () => {
    setJoinErr(null);
    if (live) {
      const roomCode = join.trim();
      if (!roomCode) {
        setJoinErr("Enter a 6-12 character room code.");
        return;
      }
      if (useMobileProductSurface()) {
        enterMobileProduct({ room: roomCode });
        return;
      }
      setJoinDialogCode(roomCode);
      return;
    }
    const s = joinRoomByCode(join, displayName());
    if (s) onEnter?.(s);
    else setJoinErr(`No room found for "${join.toUpperCase()}".`);
  };
  const openHostDialog = (kind: "workspace" | "sample") => {
    if (live && useMobileProductSurface()) {
      enterMobileProduct({ intent: kind === "sample" ? "sample" : "create" });
      return;
    }
    setHostKind(kind);
    setCreateTitle(kind === "sample" ? "Startup Banking Diligence War Room" : "My workspace");
    setAutoAllow(false);
    setCreateDialogCode(makeLandingRoomCode());
  };
  const enterDemo = () => { if (live) openHostDialog("sample"); else onEnter?.(enterDemoRoomAsHost(name)); };
  const createRoom = () => { if (live) openHostDialog("workspace"); else onEnter?.(createFreshRoom("My room", name || "Host")); };
  const confirmLiveJoin = () => {
    if (!joinDialogCode) return;
    onLiveJoin?.(joinDialogCode, displayName());
    setJoinDialogCode(null);
  };
  const confirmLiveCreate = () => {
    if (!createDialogCode || !hostKind) return;
    if (hostKind === "sample") onLiveDemo?.(displayName("Host"), autoAllow);
    else onLiveCreate?.(displayName("Host"), createTitle.trim() || "My workspace", createDialogCode, autoAllow);
    setCreateDialogCode(null);
    setHostKind(null);
  };

  return (
    <div className="r-app">
      <div className="r-screen">
        <div className="r-landing-shell">
          <header className="r-landing-top">
            <button className="r-landing-brand" type="button" onClick={() => { window.location.hash = ""; }} aria-label="NodeRoom home">
              <span className="r-mark">N</span>
              <span>NodeRoom</span>
            </button>
            <button className="r-iconbtn" type="button" aria-label="Toggle light / dark" title="Toggle light / dark" onClick={toggleTheme}>
              <Moon size={16} />
            </button>
          </header>

          <main className="r-landing">
            <div className="r-land2-grid">
              <div>
                <span className="r-eyebrow"><span className="r-dot-live" /> Shared workrooms for people and NodeAgents</span>
                <h1 className="r-h1">
                  Work with AI. <span className="accent">Review every change.</span>
                </h1>
                <NodeReveal delay={140} distance={8}>
                  <p className="r-lede">
                    NodeRoom is a shared workspace where people and NodeAgents work on the same files,
                    spreadsheets, and notes. Every agent edit can stay reviewable and source-backed.
                  </p>
                </NodeReveal>
                <div className="r-cta-row" data-live={String(live)}>
                  <button data-testid={live ? "create-room" : "start-demo-room"} className="r-btn primary" disabled={busy} onClick={live ? createRoom : enterDemo}>
                    {live ? <Plus size={17} /> : <Sparkles size={17} />} {live ? "Create a room" : "Try sample room"}
                  </button>
                  <div className="r-join-inline">
                    <input
                      ref={joinInputRef}
                      placeholder="ENTER CODE"
                      value={join}
                      disabled={busy}
                      maxLength={14}
                      onChange={(e) => { setJoin(live ? e.target.value.toUpperCase() : e.target.value); setJoinErr(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") tryJoin(); }}
                      aria-label="Room code"
                      aria-invalid={Boolean(shownError)}
                      aria-describedby={shownError ? "landing-join-error" : undefined}
                      data-testid="join-room-code"
                    />
                    <button data-testid="join-room" className="r-btn" disabled={busy} onClick={tryJoin}>
                      Join room <ArrowRight size={15} />
                    </button>
                  </div>
                  {live && (
                    <button data-testid="try-sample-room" className="r-btn ghost" disabled={busy} onClick={enterDemo}>
                      <Sparkles size={16} /> Try sample
                    </button>
                  )}
                </div>
                {shownError && <div id="landing-join-error" className="r-join-error" role="alert">{shownError}</div>}
                <LandingProofPill live={live} />
                <div className="r-land2-trust"><Check size={14} /> Code-access rooms · Review-first agent edits</div>
              </div>
              <div><LandingDemoLoop /></div>
            </div>

            <div className="r-land2-featstrip">
              {LANDING_FEATURES.map((f, i) => (
                <NodeReveal key={f.h} delay={280 + i * 80} distance={10}>
                  <div className="r-land2-feat">
                    <div className="r-land2-feat-shot"><MicroShot kind={f.shot} /></div>
                    <h3>{f.h}</h3>
                    <p>{f.p}</p>
                  </div>
                </NodeReveal>
              ))}
            </div>
          </main>

          <div className="r-story-tape" aria-label="Product story">
            <div className="r-story-meta">
              <span>01 · SURFACE</span>
              <strong>The public surface</strong>
            </div>
            <div className="r-story-actions">
              <button className="r-iconbtn" type="button" aria-label="Previous story step" title="Previous story step">
                <ArrowLeft size={15} />
              </button>
              <button className="r-iconbtn" type="button" aria-label="Open product story" title="Open product story" onClick={() => { window.location.hash = "story"; }}>
                <ArrowRight size={15} />
              </button>
            </div>
            <span className="r-story-command">apps/web · scratchnode.live shell</span>
          </div>
        </div>
        {live && joinDialogCode && (
          <FocusTrapDialog
            className="r-room-modal-scrim"
            panelClassName="r-room-modal"
            ariaLabelledby="join-room-title"
            onClose={() => setJoinDialogCode(null)}
          >
              <div className="r-room-modal-head">
                <div className="row between">
                  <span className="kicker">Join a room</span>
                  <button className="r-iconbtn" type="button" aria-label="Close" onClick={() => setJoinDialogCode(null)}>
                    <X size={16} />
                  </button>
                </div>
                <h2 id="join-room-title">Join this room</h2>
                <p className="sub">Pick a display name. This browser stores a room-scoped session so reload can restore your place.</p>
              </div>
              <div className="r-room-modal-body">
                <label className="r-room-field">
                  <span>Room code</span>
                  <input className="r-text-input mono" value={joinDialogCode} readOnly />
                </label>
                <label className="r-room-field">
                  <span>Display name</span>
                  <input
                    data-testid="display-name"
                    className="r-text-input"
                    placeholder="quokka"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmLiveJoin(); }}
                    autoFocus
                  />
                </label>
                <div className="r-first-run-notice" data-testid="join-access-notice">
                  <Lock size={15} />
                  <div><strong>Invite holders join as editors.</strong><span>They can edit shared content, upload files, use room chat, and run NodeAgent. Treat the link like an access code.</span></div>
                </div>
                <button className="r-btn primary r-room-modal-submit" disabled={busy} onClick={confirmLiveJoin}>
                  Join room <ArrowRight size={16} />
                </button>
              </div>
          </FocusTrapDialog>
        )}
        {live && createDialogCode && (
          <FocusTrapDialog
            className="r-room-modal-scrim"
            panelClassName="r-room-modal"
            ariaLabelledby="create-room-title"
            onClose={() => { setCreateDialogCode(null); setHostKind(null); }}
          >
              <div className="r-room-modal-head">
                <div className="row between">
                  <span className="kicker">{hostKind === "sample" ? "Try a sample" : "Create a room"}</span>
                  <button className="r-iconbtn" type="button" aria-label="Close" onClick={() => { setCreateDialogCode(null); setHostKind(null); }}>
                    <X size={16} />
                  </button>
                </div>
                <h2 id="create-room-title">{hostKind === "sample" ? "Explore a synthetic workspace" : "Start with an empty workspace"}</h2>
                <p className="sub">A room is unlisted, but invite holders can join as editors. Review is the default for artifact changes.</p>
              </div>
              <div className="r-room-modal-body">
                <label className="r-room-field">
                  <span>Room title</span>
                  <input
                    className="r-text-input"
                    placeholder={hostKind === "sample" ? "Startup Banking Diligence War Room" : "My workspace"}
                    value={createTitle}
                    maxLength={80}
                    readOnly={hostKind === "sample"}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="r-room-field">
                  <span>Display name</span>
                  <input
                    data-testid="create-display-name"
                    className="r-text-input"
                    placeholder="Priya"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {hostKind === "sample" && (
                  <div className="r-first-run-notice sample" data-testid="sample-data-notice">
                    <Sparkles size={15} />
                    <div><strong>Synthetic sample data</strong><span>This room demonstrates NodeRoom. Do not treat its companies, sources, or conclusions as live research.</span></div>
                  </div>
                )}
                <div className="r-first-run-notice" data-testid="create-access-notice">
                  <Lock size={15} />
                  <div><strong>Code-access room</strong><span>The invite link does not expire and lets allowed visitors join as editors. Share it intentionally.</span></div>
                </div>
                <fieldset className="r-first-run-policy" data-testid="agent-policy-choice">
                  <legend>How should NodeAgent edits land?</legend>
                  <label data-selected={String(!autoAllow)}>
                    <input type="radio" name="agent-policy" value="review" checked={!autoAllow} onChange={() => setAutoAllow(false)} />
                    <span><strong>Review every artifact edit</strong><small>Recommended · changes wait for host approval; runs can still create provider, job, trace, and chat records.</small></span>
                  </label>
                  <label data-selected={String(autoAllow)}>
                    <input type="radio" name="agent-policy" value="auto" checked={autoAllow} onChange={() => setAutoAllow(true)} />
                    <span><strong>Auto-approve conflict-free edits</strong><small>NodeAgent may commit directly; every write remains traced.</small></span>
                  </label>
                </fieldset>
                <button className="r-btn primary r-room-modal-submit" data-testid={hostKind === "sample" ? "sample-room-submit" : "create-room-submit"} aria-label={hostKind === "sample" ? "Start sample room" : "Create empty room"} disabled={busy} onClick={confirmLiveCreate}>
                  {hostKind === "sample" ? "Start sample room" : "Create empty room"} <ArrowRight size={16} />
                </button>
              </div>
          </FocusTrapDialog>
        )}
      </div>
    </div>
  );
}

function useMobileProductSurface(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(max-width: 760px)")?.matches ?? window.innerWidth <= 760;
}

function enterMobileProduct(params: { intent?: "create" | "sample"; room?: string }): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (params.intent) url.searchParams.set("intent", params.intent);
  if (params.room) url.searchParams.set("room", params.room);
  window.location.assign(url);
}

function makeLandingRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join("").toUpperCase();
  return `NR${suffix}${Date.now().toString(36).toUpperCase().slice(-4)}`.slice(0, 12);
}

/* ── looping product demo: lock → cite → commit → draft → smart-merge → v43 ──
   Self-contained scripted frames + CSS transitions (src/ui/landing.css). No
   video, no deps. Under prefers-reduced-motion the loop pauses and shows the
   final frame; the CSS side also stills its own keyframes. */

const DEMO_ROWS = [
  { id: "rev", label: "Revenue", q3: "$12,400" },
  { id: "cogs", label: "COGS", q3: "$5,100" },
  { id: "gp", label: "Gross profit", q3: "$7,300" },
] as const;

type DemoFrame = {
  step: "lock" | "cite" | "commit" | "draft" | "smart-merge" | "v43";
  text: string;
  locked: string[];
  drafts: string[];
  vals: Record<string, string>;
  ink: string[];
  cite: boolean;
  version: number;
};

const DEMO_FRAMES: DemoFrame[] = [
  { step: "lock", text: "Locking the rows I’m about to write — read-only for others, still readable.", locked: ["rev", "cogs"], drafts: [], vals: {}, ink: [], cite: false, version: 41 },
  { step: "cite", text: "Found the reconciled total in the NetSuite close, p.4. Quoting it so it’s checkable.", locked: ["rev", "cogs"], drafts: [], vals: {}, ink: [], cite: true, version: 41 },
  { step: "commit", text: "Committed Variance for Revenue and COGS through the sync tool. v41 → v42.", locked: [], drafts: [], vals: { rev: "+24%", cogs: "+27.5%" }, ink: ["rev", "cogs"], cite: true, version: 42 },
  { step: "draft", text: "Your agent drafts the rows around the lock — held, never touching locked cells.", locked: [], drafts: ["gp"], vals: { rev: "+24%", cogs: "+27.5%" }, ink: [], cite: true, version: 42 },
  { step: "smart-merge", text: "Smart-merged the held draft on canonical v42 — no conflict. v42 → v43.", locked: [], drafts: [], vals: { rev: "+24%", cogs: "+27.5%", gp: "+21.7%" }, ink: ["gp"], cite: true, version: 43 },
  { step: "v43", text: "Done — two agents, one sheet, every cell traced back to its source.", locked: [], drafts: [], vals: { rev: "+24%", cogs: "+27.5%", gp: "+21.7%" }, ink: [], cite: true, version: 43 },
];
const DEMO_FRAME_MS = [1400, 1600, 1800, 1500, 1800, 2000];
const DEMO_LOOP_MS = DEMO_FRAME_MS.reduce((a, b) => a + b, 0);

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

function LandingDemoLoop() {
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (reduced) { setFrame(DEMO_FRAMES.length - 1); return; }
    let i = 0;
    let timer = window.setTimeout(function tick() {
      i = (i + 1) % DEMO_FRAMES.length;
      setFrame(i);
      timer = window.setTimeout(tick, DEMO_FRAME_MS[i]);
    }, DEMO_FRAME_MS[0]);
    return () => window.clearTimeout(timer);
  }, [reduced]);
  const f = DEMO_FRAMES[frame];

  const varCell = (id: string) => {
    const locked = f.locked.includes(id);
    const draft = f.drafts.includes(id);
    const val = f.vals[id];
    const inked = f.ink.includes(id);
    return (
      <td className={"var" + (val ? "" : " empty")}>
        {val ? <span key={`${frame}-${id}`} className={inked ? "r-land2-ink" : undefined}>{val}</span> : (locked || draft ? "" : "—")}
        {locked && <span className="r-land2-lockbadge"><Lock size={8} /> NA</span>}
        {draft && <span className="r-land2-lockbadge draft">draft</span>}
      </td>
    );
  };

  return (
    <div className="r-land2-shot" data-testid="landing-demo-loop" data-frame={f.step}>
      <div className="r-land2-shot-glow" />
      <div className="r-land2-shot-top">
        <div className="r-land2-shot-mark">N</div>
        <div className="r-land2-shot-code"><Users size={11} /> Q3 <b>X-7K</b></div>
        <span className="r-land2-demo-chip"><span className="rec" /> Live demo</span>
        <div className="r-land2-shot-avs">
          <div className="r-land2-shot-av" style={{ background: "var(--accent-primary)" }}>HS</div>
          <div className="r-land2-shot-av" style={{ background: "#5E6AD2" }}>PR</div>
          <div className="r-land2-shot-av" style={{ background: "#5B8F71" }}>qk</div>
          <div className="r-land2-shot-av agent" style={{ background: "#C08A5E" }}>NA</div>
        </div>
      </div>
      <div className="r-land2-shot-body">
        <div className="r-land2-agentline">
          <div className="av">NA</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="who">Room NodeAgent</div>
            <p className="txt" key={`t${frame}`}>{f.text}</p>
            {f.cite && (
              <div className="r-land2-cite" key={`c${frame}`}>
                <span className="pg">p.4</span>
                <span className="q">“Total recognized revenue, Q3: $12,400 (reconciled).”</span>
                <span className="st"><i /> source-backed</span>
              </div>
            )}
          </div>
        </div>
        <div className="r-land2-sheet">
          <table>
            <thead>
              <tr><th>Account</th><th className="num">Q3</th><th className="num">Variance</th></tr>
            </thead>
            <tbody>
              {DEMO_ROWS.map((r) => (
                <tr key={r.id} className={f.locked.includes(r.id) ? "locked" : f.drafts.includes(r.id) ? "drafting" : undefined}>
                  <td className="label">{r.label}</td>
                  <td className="num">{r.q3}</td>
                  {varCell(r.id)}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="r-land2-sheet-foot">
            <span className="r-land2-vpill">versionedSync</span>
            <span className="r-land2-vpill next" key={`v${f.version}`}>v{f.version}</span>
            <span className="grow" />
            <span className="src">traced · NetSuite p.4</span>
          </div>
        </div>
        {!reduced && (
          <div className="r-land2-scrub">
            <span className="r-land2-scrub-fill" style={{ animationDuration: `${DEMO_LOOP_MS}ms` }} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── live-proof pill ─────────────────────────────────────────────────────────
   Live mode: real bounded counts from convex/metrics.landingMetrics (value +
   honest `capped` flag → "1,000+"-style suffix, never an inflated number).
   Memory mode: the design's static demo numbers with an explicit "demo" tag —
   there is no ConvexProvider in memory mode, so the useQuery component is only
   mounted when live. Velocity sparkline: OMITTED this pass — its spike
   threshold needs a commit-rate history series we don't store (see
   convex/metrics.ts doc comment). */

type LandingMetric = { value: number; capped: boolean };
type LandingMetrics = { roomsLive: LandingMetric; cellsCommittedToday: LandingMetric };

// convex/_generated lags until the next codegen — which must NOT be run
// casually: `npx convex codegen` against a configured cloud deployment
// DEPLOYS schema+functions (documented gotcha). Same cast precedent as
// tests/notebookAgentOutline.test.ts.
const landingMetricsQuery = (api as unknown as {
  metrics: { landingMetrics: FunctionReference<"query", "public", Record<string, never>, LandingMetrics> };
}).metrics.landingMetrics;

function formatLandingMetric(m: LandingMetric | undefined): string {
  if (!m) return "—";
  return m.value.toLocaleString("en-US") + (m.capped ? "+" : "");
}

function ProofPillView({ rooms, cells, demo }: { rooms?: LandingMetric; cells?: LandingMetric; demo: boolean }) {
  return (
    <div className="r-land2-proof" data-testid="landing-proof-pill" data-demo={String(demo)}>
      <div className="r-land2-proof-seg">
        <span className="r-land2-proof-live" />
        <span className="r-land2-proof-num">{formatLandingMetric(rooms)}</span>
        <span className="r-land2-proof-lbl">rooms live</span>
      </div>
      <div className="r-land2-proof-seg">
        <span className="r-land2-proof-num">{formatLandingMetric(cells)}</span>
        <span className="r-land2-proof-lbl">cells committed today</span>
      </div>
      {demo && (
        <div className="r-land2-proof-seg">
          <span className="r-land2-proof-demo">demo</span>
        </div>
      )}
    </div>
  );
}

/** Mounted ONLY in live mode — memory mode has no ConvexProvider and useQuery would throw. */
function LiveProofPill() {
  const metrics = useQuery(landingMetricsQuery, {});
  return <ProofPillView rooms={metrics?.roomsLive} cells={metrics?.cellsCommittedToday} demo={false} />;
}

function LandingProofPill({ live }: { live: boolean }) {
  if (!live) return <ProofPillView rooms={{ value: 312, capped: false }} cells={{ value: 1284, capped: false }} demo />;
  return <LiveProofPill />;
}

/* ── feature strip micro-shots ────────────────────────────────────────────── */

const LANDING_FEATURES: Array<{ shot: "code" | "panels" | "lock"; h: string; p: string }> = [
  { shot: "code", h: "Share a code, not a seat", p: "Public by default. Anyone joins the room with six characters — no account." },
  { shot: "panels", h: "Open only what you need", p: "Files, chat, a live artifact, and your private agent — one to four panels." },
  { shot: "lock", h: "Locks, then smart-merge", p: "Agents lock the rows they touch and merge drafts on release. No collisions." },
];

function MicroShot({ kind }: { kind: "code" | "panels" | "lock" }) {
  if (kind === "code") {
    return (
      <div className="r-land2-ms center">
        <div className="r-land2-shot-code" style={{ fontSize: 13, padding: "5px 11px" }}>Q3X<b>-7K</b></div>
        <div className="r-land2-ms-row center">no account · join as guest</div>
      </div>
    );
  }
  if (kind === "panels") {
    const colors = ["#5E6AD2", "#C08A5E", "var(--success)", "var(--accent-primary)"];
    return (
      <div className="r-land2-ms panels">
        {colors.map((c, i) => (
          <div
            key={c}
            className={"r-land2-ms-panel" + (i === 1 ? " wide" : "")}
            style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 40%, transparent)` }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="r-land2-ms">
      <div className="r-land2-ms-row"><span className="r-land2-ms-pill lock"><Lock size={9} /> NA</span> Revenue · locked</div>
      <div className="r-land2-ms-row"><span className="r-land2-ms-pill draft">draft</span> Gross profit · smart-merge</div>
      <div className="r-land2-ms-row"><span className="r-land2-vpill next">v41 → v42</span></div>
    </div>
  );
}
