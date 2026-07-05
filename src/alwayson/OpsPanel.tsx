/**
 * Always-On Rooms — owner ops panel (modes, caps, outbox state machine).
 * Ports design-reference/alwayson/ao-ops.jsx §5 (classes lifted verbatim from
 * the ao.css specimen; Lane B ships them in ./alwayson.css). Rendered by
 * PublicRoomPage under the Ops tab (demo/owner only) — this file exports ONLY
 * the component, no route logic.
 *
 * Demo data comes from ./demoData (AO_OUTBOX). The lane toggle swaps the ref
 * column between the Gmail-drafts bootstrap lane and the provider production
 * lane exactly like the specimen — same states, same table, two lanes.
 */

import { useState, type ReactElement } from "react";
import { Eye, FileText, Lock, Pause, Sparkles } from "lucide-react";
import { AO_OUTBOX } from "./demoData";
import "./alwayson.css";

type AoMode = {
  key: string;
  desc: string;
  icon: typeof Eye;
  on?: boolean;
  locked?: boolean;
};

const MODES: AoMode[] = [
  { key: "Monitor", desc: "Detect changes only. Hash checks, no LLM spend.", icon: Eye },
  { key: "Digest", desc: "Detect + summarize. The default for public rooms.", icon: FileText, on: true },
  { key: "Research", desc: "Summarize + enrich from extra allowed sources.", icon: Sparkles },
  { key: "Deep", desc: "Deep research runs. Explicit owner approval, every time.", icon: Lock, locked: true },
];

const SUB_STATS: Array<[string, string]> = [
  ["128", "active"],
  ["6", "pending"],
  ["3", "unsubscribed"],
];

const CAP_ROWS: Array<[string, string]> = [
  ["Per-run cap", "3.0 cr · hard"],
  ["Max pages per scan", "40"],
  ["Workpool", "always-on · low priority"],
  ["Deep research", "off · approval gate"],
  ["Retry policy", "1 retry · then capped"],
];

type OutboxLane = "bootstrap" | "prod";

/** Bootstrap refs (gmail_*) map 1:1 onto provider refs — same state machine, two lanes. */
function laneRef(ref: string, lane: OutboxLane): string {
  if (lane === "bootstrap") return ref;
  return ref.replace("gmail_msg", "resend_msg").replace("gmail_draft", "resend_q");
}

export function AlwaysOnOpsPanel(): ReactElement {
  const [lane, setLane] = useState<OutboxLane>("bootstrap");

  return (
    <div data-testid="ao-ops-panel">
      <div className="ao-modes" style={{ marginBottom: 18 }}>
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <div
              className={"ao-mode" + (m.on ? " on" : "") + (m.locked ? " locked" : "")}
              key={m.key}
              aria-disabled={m.locked || undefined}
            >
              <span className="nm">
                <Icon size={14} strokeWidth={1.7} aria-hidden="true" />
                {m.key}
                {m.on && (
                  <span className="badge" style={{ color: "var(--accent-ink)" }}>
                    DEFAULT
                  </span>
                )}
                {m.locked && <span className="badge">APPROVAL GATE</span>}
              </span>
              <span className="d">{m.desc}</span>
            </div>
          );
        })}
      </div>

      <div className="ao-cols c32">
        <div className="ao-panel ao-outbox" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px 0" }}>
            <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: "-.01em" }}>
              Email outbox · daily brief · Jul 4
            </span>
            <span className="grow"></span>
            <button
              type="button"
              className={"ao-btn" + (lane === "bootstrap" ? " pri" : "")}
              style={{ padding: "4px 10px", fontSize: 10.5 }}
              onClick={() => setLane("bootstrap")}
            >
              Gmail drafts · bootstrap
            </button>
            <button
              type="button"
              className={"ao-btn" + (lane === "prod" ? " pri" : "")}
              style={{ padding: "4px 10px", fontSize: 10.5 }}
              onClick={() => setLane("prod")}
            >
              Provider · production
            </button>
          </div>
          <div className="ao-sm">
            <span className="st">pending_draft</span>
            <span className="arr">→</span>
            <span className="st">draft_created</span>
            <span className="arr">→</span>
            <span className="gate">
              <Lock size={10} strokeWidth={1.7} aria-hidden="true" />
              {lane === "bootstrap" ? "human review" : "policy check"}
            </span>
            <span className="arr">→</span>
            <span className="st hot">approved</span>
            <span className="arr">→</span>
            <span className="st">sent</span>
            <span className="grow"></span>
            <span className="ao-mono" style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
              idempotency: room:brief:subscriber:cadence — a crash never double-sends
            </span>
          </div>
          <table>
            <colgroup>
              <col style={{ width: "26%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "17%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "20%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>To</th>
                <th>Brief</th>
                <th>State</th>
                <th>{lane === "bootstrap" ? "Gmail ref" : "Provider ref"}</th>
                <th>Idempotency key</th>
              </tr>
            </thead>
            <tbody>
              {AO_OUTBOX.map((r) => (
                <tr key={r.idempotencyKey}>
                  <td className="em">{r.to}</td>
                  <td className="mono">{r.brief}</td>
                  <td>
                    <span className={"ao-ost " + r.state}>{r.state}</span>
                  </td>
                  <td className="mono">{laneRef(r.ref, lane)}</td>
                  <td className="mono">{r.idempotencyKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="ao-substats">
            {SUB_STATS.map(([n, l]) => (
              <div className="ao-substat" key={l}>
                <div className="n">{n}</div>
                <div className="l">{l}</div>
              </div>
            ))}
          </div>
          <div className="ao-panel ao-caps">
            <div className="ao-kicker">Budget · July</div>
            <div className="ao-cap">
              <div className="l">
                Monthly cap<span className="v">7.4 / 20.0 cr</span>
              </div>
              <div className="ao-bar">
                <div className="fill" style={{ width: "37%" }}></div>
              </div>
            </div>
            <div>
              {CAP_ROWS.map(([label, value]) => (
                <div className="ao-caprow" key={label}>
                  {label}
                  <span className="v">{value}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="ao-btn"
              style={{ justifyContent: "center" }}
              title="demo — wire to pauseRoom"
            >
              <Pause size={13} strokeWidth={1.7} aria-hidden="true" />
              Pause room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
