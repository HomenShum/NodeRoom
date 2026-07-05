/**
 * LandingStory — the scroll-driven product story landing page.
 *
 * Teaches one idea in seven progressively deeper layers, grounded in the real
 * Q3 variance sheet, the real design tokens, and HONEST shipped/target labels.
 * The top sandbox is local and interactive for quick product feel; the deeper
 * scroll narrative renders the declarative event tape in storyTape.ts.
 */
import { useRef, useState } from "react";
import { ArrowRight, BookOpen, FileSpreadsheet, GitMerge, ShieldCheck, Sparkles } from "lucide-react";
import { demo } from "../app/roomStore";
import type { Session } from "../ui/App";
import { StoryStage } from "./StoryStage";
import { StoryLab } from "./StoryLab";
import { StoryQuickDemo } from "./StoryQuickDemo";
import { ProofBoard } from "./ProofBoard";
import { AlwaysOnCards } from "./AlwaysOnCards";
import "./landingStory.css";

export function LandingStory({ onEnter, onBack }: { onEnter: (s: Session) => void; onBack: () => void }) {
  const [showArch, setShowArch] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const enterDemo = () => onEnter({ roomId: demo.roomId, me: demo.me });
  const scrollToStage = () => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="r-app rs-page">
      {/* Slim top bar */}
      <header className="rs-topbar">
        <button className="rs-back" onClick={onBack} aria-label="Back to room selection">
          <span className="rs-mark">N</span> NodeRoom
        </button>
        <span className="rs-topbar-spacer" />
        <button className="r-btn" onClick={() => setShowArch((v) => !v)}>
          <BookOpen size={14} /> Architecture
        </button>
        <button className="r-btn primary" onClick={enterDemo}>
          Open live room <ArrowRight size={14} />
        </button>
      </header>

      <div className="r-screen rs-scroll">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="rs-hero">
          <span className="r-eyebrow"><Sparkles size={13} /> NodeRoom · live collaborative workroom</span>
          <h1 className="rs-hero-h1">
            Excel-like editing for <span className="rs-hl-human">humans</span>.
            Branch-based work for <span className="rs-hl-agent">agents</span>.
            Audit-grade commits for the <span className="rs-hl-room">room</span>.
          </h1>
          <p className="rs-hero-lede">
            Humans type instantly. Agents stream progress, work off to the side, and merge only
            validated, source-backed changes into the shared artifact.
          </p>

          <div className="rs-tension">
            {[
              "A banker is editing C2.",
              "An agent is analyzing A1:C5.",
              "A teammate is watching.",
              "Another agent is drafting a memo.",
              "Nobody gets blocked.",
              "Nobody gets clobbered.",
              "Every number remains explainable.",
            ].map((line, i) => (
              <span key={i} className={"rs-tension-line" + (i >= 4 ? " rs-tension-strong" : "")}>{line}</span>
            ))}
          </div>

          <div className="rs-hero-cta">
            <button className="r-btn primary lg" onClick={enterDemo}>
              Open the live room <ArrowRight size={15} />
            </button>
            <button className="r-btn lg" onClick={scrollToStage}>See how it works ↓</button>
            <button className="r-btn ghost lg" onClick={() => setShowArch(true)}>Read the architecture</button>
          </div>

          <div className="rs-legend">
            <span className="rs-status-chip rs-shipped"><span className="rs-status-dot" /> Shipped today</span>
            <span className="rs-status-chip rs-target"><span className="rs-status-dot" /> Target architecture</span>
            <span className="rs-legend-note">Every layer below says which it is. No overclaiming.</span>
          </div>
        </section>

        {/* ── Architecture panel (honest framing) ──────────────────────── */}
        {showArch && (
          <section className="rs-arch">
            <div className="rs-arch-card">
              <h2 className="rs-arch-h">The mental model</h2>
              <p className="rs-arch-line"><b>Binder</b> tells you what exists. <b>Stage</b> shows the work. <b>Copilot</b> drives the work. <b>Status</b> proves what just happened.</p>
              <p className="rs-arch-line rs-arch-sub"><b>LLM</b> routes intent. <b>Harness</b> schedules work. <b>Ledger</b> commits truth.</p>
              <div className="rs-arch-roles">
                <div className="rs-arch-role"><FileSpreadsheet size={15} /> <b>Work surface</b> — spreadsheet, proof, source, memo, chart; muscle memory preserved.</div>
                <div className="rs-arch-role"><ShieldCheck size={15} /> <b>Convex ledger</b> — per-element versions, CAS, locks, proposals, traces.</div>
                <div className="rs-arch-role"><GitMerge size={15} /> <b>Coordination</b> — claim a range, draft around it, smart-merge on release; never clobber.</div>
              </div>
              <p className="rs-arch-foot">
                Shipped today: optimistic UI, per-element CAS, lock leases, draft→merge. Target: live presence,
                a narration pane, a visible agent scratchpad, and an LLM semantic-rebase resolver.
              </p>
              <button className="r-btn" onClick={() => setShowArch(false)}>Close</button>
            </div>
          </section>
        )}

        {/* ── The seven layers ─────────────────────────────────────────── */}
        <div ref={stageRef}>
          <StoryQuickDemo />
          <StoryStage />
          <StoryLab />
        </div>

        {/* ── Final proof board ────────────────────────────────────────── */}
        <section className="rs-proof-section">
          <h2 className="rs-section-h">The artifact feels like Excel. The audit trail feels like Git.</h2>
          <p className="rs-section-sub">Formula. Digits. Source. Human edit. Trace. All visible before approval.</p>
          <ProofBoard />
        </section>

        {/* ── Live public rooms (Always-On Rooms gallery) ──────────────── */}
        <AlwaysOnCards />

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <section className="rs-cta-final">
          <h2 className="rs-section-h">Work in the spreadsheet. Let agents branch. Review the merge. Trust the trace.</h2>
          <div className="rs-hero-cta">
            <button className="r-btn primary lg" onClick={enterDemo}>Open the live room <ArrowRight size={15} /></button>
            <button className="r-btn lg" onClick={onBack}>Back to start</button>
          </div>
          <p className="rs-cta-foot">Startup diligence room - 3 humans - 2 agents - seeded demo data</p>
        </section>
      </div>
    </div>
  );
}
