/**
 * Always-On Rooms — public, read-only room page (#rooms/<slug>).
 * Faithful port of design-reference/alwayson/ao-room.jsx §2 (frame, tabs,
 * brief, papers sheet, topics graph, run log, proof footer, post-its,
 * read-only composer strip) styled by src/alwayson/alwayson.css.
 *
 * Data: usePublicRoomData(slug) under the root ConvexProvider when HAS_CONVEX;
 * memory mode / query errors / unknown functions fall back silently to the
 * demo bundle (honest specimen data — no fabricated "live" markers).
 *
 * Ops tab renders ONLY when the location search or hash carries ops=1, and
 * lazily imports AlwaysOnOpsPanel (owned by the ops lane).
 */
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { HAS_CONVEX } from "../app/store";
import { MarkdownBody } from "../ui/MarkdownBody";
import { AoIcon } from "./AoIcon";
import { SubscribeModal } from "./SubscribeModal";
import {
  fallbackRoomBundle,
  normalizeRoomSlug,
  usePublicRoomData,
  type PublicRoomBundle,
} from "./usePublicRoomData";
import "./alwayson.css";

const AlwaysOnOpsPanel = lazy(() => import("./OpsPanel").then((m) => ({ default: m.AlwaysOnOpsPanel })));

/* ── icons — shared .ao-* icon set, extracted to ./AoIcon so SubscribeModal
   (which rides the landing bundle) can use it without dragging this whole
   lazy page into that chunk. ──────────────────────────────────────────── */
const Ic = AoIcon;

/* ── tabs ─────────────────────────────────────────────────────────────────── */
const TABS = ["Home", "Papers", "Topics", "Weekly digest", "Trace"] as const;
type TabName = (typeof TABS)[number] | "Ops";

const tabTestId = (name: string) => `ao-tab-${name.toLowerCase().replace(/\s+/g, "-")}`;

function tabIcon(t: string): string {
  if (t === "Home") return "doc";
  if (t === "Papers") return "table";
  if (t === "Topics") return "gate";
  if (t === "Trace") return "activity";
  if (t === "Ops") return "shield";
  return "calendar";
}

/** ops=1 in either the search string or the hash query enables the Ops tab. */
function opsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return /(?:\?|&)ops=1(?:&|$)/.test(window.location.search) || /[?&]ops=1(?:&|$)/.test(window.location.hash);
}

/* ── silent fallback boundary: a throwing live query renders the demo view ── */
class AoFallbackBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    // Silent fallback per contract, but keep a console breadcrumb for debugging.
    console.warn("[alwayson] live room bundle unavailable — using demo data", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/* ── tab bodies (ported verbatim from ao-room.jsx) ────────────────────────── */

function Brief({ bundle }: { bundle: PublicRoomBundle }) {
  const { meta } = bundle;
  // LIVE: render the agent-written state.briefMarkdown through the repo's safe
  // markdown renderer (MarkdownBody builds React elements — text is escaped by
  // React, links pass safeHref; no dangerouslySetInnerHTML anywhere). The
  // specimen prose below is DEMO-ONLY — never shown for a live bundle.
  if (bundle.source === "live") {
    const markdown = (bundle.briefMarkdown ?? "").trim();
    return (
      <div className="ao-brief" data-testid="ao-brief-live">
        <div className="stamp">
          <span className="ao-chip acc" style={{ fontSize: 10 }}><Ic name="note" size={11} />daily brief · agent-authored · append-only</span>
        </div>
        {markdown ? (
          <MarkdownBody className="ao-brief-md" text={markdown} />
        ) : (
          <>
            <h2>{meta.briefTitle}</h2>
            <p>No brief yet — the first successful scan writes it.</p>
          </>
        )}
        <div className="agent-line"><span className="dot"></span>Written by the room agent · template-rendered from the last scan · deterministic, no model calls</div>
      </div>
    );
  }
  return (
    <div className="ao-brief">
      <div className="stamp">
        <span className="ao-chip acc" style={{ fontSize: 10 }}><Ic name="note" size={11} />daily brief · agent-authored · append-only</span>
      </div>
      <h2>{meta.briefTitle}</h2>
      <div className="date">{meta.briefDate}</div>

      <h3>New papers</h3>
      <ul>
        <li>Spectral sequences without tears — algebraic topology, lecture-note style, graduate.<span className="cite">[1]</span></li>
        <li>A gentle route to the étale fundamental group — arithmetic geometry, assumes one course in algebraic geometry.<span className="cite">[2]</span></li>
        <li>What attention heads actually compute — ML interpretability survey, intermediate.<span className="cite">[3]</span></li>
        <li>Renormalization for the impatient — QFT exposition, graduate.<span className="cite">[4]</span></li>
      </ul>

      <h3>Themes</h3>
      <ul>
        <li>The interpretability cluster grew for the third week running — 3 of the last 9 uploads.</li>
        <li>Topology lecture notes continue a 4-week streak; two share an author with prior uploads.</li>
      </ul>

      <h3>Recommended reads</h3>
      <ol>
        <li>Beginner — Causal inference: the missing semester.<span className="cite">[5]</span></li>
        <li>Graduate — Spectral sequences without tears.<span className="cite">[1]</span></li>
        <li>Specialist — Renormalization for the impatient.<span className="cite">[4]</span></li>
      </ol>

      <h3>Open questions</h3>
      <ul>
        <li>Is “Sheaves for systems biologists” a revision or a new upload? Source page shows no version marker.</li>
        <li>Author affiliations are not exposed on expositio.org — flagged, not guessed.</li>
      </ul>

      <div className="agent-line"><span className="dot"></span>Written by Room NodeAgent · every claim links to a source capture · admins can correct with a trace, never silently</div>
    </div>
  );
}

function ProofFooter({ bundle, onOpenTrace }: { bundle: PublicRoomBundle; onOpenTrace: () => void }) {
  return (
    <div className="ao-proof" data-testid="ao-proof-footer">
      <div className="ph"><Ic name="shield" size={12} />Proof · last run</div>
      <div className="rows">
        {bundle.proof.map((row) => (
          <div className="pr" key={row.k}>
            <span className="k">{row.k}</span>
            {row.link ? (
              <span className="v"><a role="button" tabIndex={0} onClick={onOpenTrace} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpenTrace(); }}>{row.v}</a></span>
            ) : (
              <span className={"v" + (row.ok ? " ok" : "")}>{row.v}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PapersSheet({ bundle }: { bundle: PublicRoomBundle }) {
  return (
    <div className="ao-sheet">
      <table>
        <colgroup><col style={{ width: "34%" }} /><col style={{ width: "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "15%" }} /></colgroup>
        <thead><tr><th>Title</th><th>Discipline</th><th>Difficulty</th><th>Status</th><th>First seen</th><th>Evidence</th></tr></thead>
        <tbody>
          {bundle.papers.map((p) => (
            <tr key={p.title}>
              <td className="tt">{p.title}<div className="tag">{p.topic}</div></td>
              <td>{p.discipline}</td>
              <td>{p.difficulty}</td>
              <td><span className={"ao-st " + p.status}>{p.status}</span></td>
              <td className="ao-mono" style={{ fontSize: 11 }}>{p.firstSeen}</td>
              <td><span className="ao-src"><Ic name="link" size={10} />{p.evidenceRef}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunLog({ bundle }: { bundle: PublicRoomBundle }) {
  return (
    <div className="ao-runlog">
      {bundle.runlog.map((r, i) => (
        <div className={"ao-run" + (r.status === "skipped" ? " skipped" : "")} key={i}>
          <span className="t">{r.at}</span>
          <span className="ic"><Ic name={r.status === "skipped" ? "hash" : r.status === "changed" ? "globe" : r.status === "failed" ? "alert" : "check"} size={12} /></span>
          <span className="ev"><span className="e">{r.event}</span><span className="m">{r.meta}</span></span>
          <span className={"ao-chip" + (r.status === "changed" ? " acc" : r.status === "ok" ? " ok" : r.status === "failed" ? " bad" : "")} style={{ fontSize: 9.5 }}>{r.status === "skipped" ? "skipped · hash match" : r.status}</span>
          <span className="cost">{r.cost}</span>
        </div>
      ))}
    </div>
  );
}

/* Topics graph — papers → topics → disciplines, hand-laid (specimen data). */
const G = {
  disc: [
    { id: "math", l: "Mathematics", x: 195, y: 118, w: 96 },
    { id: "cs", l: "Computer science", x: 600, y: 84, w: 128 },
    { id: "phys", l: "Physics", x: 662, y: 306, w: 66 },
    { id: "stat", l: "Statistics", x: 420, y: 262, w: 78 },
    { id: "bio", l: "Biology", x: 148, y: 330, w: 64 },
  ],
  topics: [
    { id: "atop", l: "algebraic topology", x: 320, y: 62 },
    { id: "ageo", l: "arithmetic geometry", x: 92, y: 196 },
    { id: "interp", l: "ML interpretability", x: 560, y: 178 },
    { id: "qft", l: "quantum field theory", x: 700, y: 402 },
    { id: "causal", l: "causal inference", x: 452, y: 388 },
    { id: "aptop", l: "applied topology", x: 268, y: 420 },
  ],
  papers: [
    { id: "p1", l: "Spectral sequences…", x: 402, y: 118, nw: true, t: "atop", d: "math" },
    { id: "p2", l: "Étale fundamental…", x: 150, y: 78, nw: true, t: "ageo", d: "math" },
    { id: "p3", l: "Attention heads…", x: 668, y: 196, nw: true, t: "interp", d: "cs" },
    { id: "p4", l: "Renormalization…", x: 588, y: 430, nw: true, t: "qft", d: "phys" },
    { id: "p5", l: "Causal inference…", x: 348, y: 322, nw: false, t: "causal", d: "stat" },
    { id: "p6", l: "Sheaves…", x: 158, y: 442, nw: false, t: "aptop", d: "bio" },
  ],
  rel: [["atop", "aptop"], ["atop", "ageo"], ["causal", "interp"]] as const,
};
const TOPIC_TO_DISC: Record<string, string> = { atop: "math", ageo: "math", interp: "cs", qft: "phys", causal: "stat", aptop: "bio" };
const gfind = (id: string) => G.disc.find((n) => n.id === id) ?? G.topics.find((n) => n.id === id);

/* The hand-laid specimen graph cannot lay out arbitrary live data, so it is
   demo-only. Live mode renders honest counts + the actual topic/discipline
   sets derived from the live papers — no specimen numbers, no fake layout —
   until a real graph index ships with the hosted room. */
function TopicsGraph({ bundle }: { bundle: PublicRoomBundle }) {
  if (bundle.source === "demo") return <TopicsGraphSpecimen />;
  const topics = [...new Set(bundle.papers.map((p) => p.topic).filter(Boolean))];
  const disciplines = [...new Set(bundle.papers.map((p) => p.discipline).filter(Boolean))];
  return (
    <div className="ao-graph" data-testid="ao-topics-live">
      <div className="ao-graph-head">
        <span className="t">Topics</span>
        <span className="ao-chip" style={{ fontSize: 9.5 }}>
          {bundle.papers.length} papers · {topics.length} topics · {disciplines.length} disciplines
        </span>
      </div>
      {topics.length === 0 ? (
        <div className="ao-empty" style={{ border: 0 }}>
          <div className="h">No topics yet</div>
          <div className="b">Topics appear once the scan classifies papers from the source index.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "14px 16px", alignContent: "flex-start" }}>
          {disciplines.map((d) => (
            <span className="ao-chip" key={d} style={{ fontWeight: 800 }}>{d}</span>
          ))}
          {topics.map((t) => (
            <span className="ao-chip" key={t}>{t}</span>
          ))}
        </div>
      )}
      <div className="ao-glegend">
        <span>counts derived from the live papers index</span>
        <span style={{ marginLeft: "auto" }}>interactive graph ships with the hosted room</span>
      </div>
    </div>
  );
}

function TopicsGraphSpecimen() {
  const [sel, setSel] = useState("p1");
  const sp = G.papers.find((p) => p.id === sel);
  const spTopic = sp ? gfind(sp.t) : undefined;
  return (
    <div className="ao-graph">
      <div className="ao-graph-head">
        <span className="t">Topics graph</span>
        <span className="ao-chip" style={{ fontSize: 9.5 }}>43 papers · 21 topics · 5 disciplines</span>
        <span className="grow"></span>
        {sp && spTopic && <span className="ao-src"><Ic name="link" size={10} />{sp.l.replace("…", "")} → {spTopic.l} · evidence attached</span>}
      </div>
      <svg viewBox="0 0 800 490" role="img" aria-label="Topics graph: papers link to topics, topics to disciplines">
        {/* edges: topic → discipline */}
        {G.topics.map((t) => {
          const dn = gfind(TOPIC_TO_DISC[t.id]);
          if (!dn) return null;
          return <line className="edge" key={t.id + dn.id} x1={t.x} y1={t.y} x2={dn.x} y2={dn.y} />;
        })}
        {/* edges: topic ↔ related topic */}
        {G.rel.map(([a, b]) => {
          const na = gfind(a);
          const nb = gfind(b);
          if (!na || !nb) return null;
          return <line className="edge rel" key={a + b} x1={na.x} y1={na.y} x2={nb.x} y2={nb.y} />;
        })}
        {/* edges: paper → topic + discipline */}
        {G.papers.map((p) => {
          const t = gfind(p.t);
          const d = gfind(p.d);
          if (!t || !d) return null;
          return (
            <g key={"e" + p.id}>
              <line className="edge" x1={p.x} y1={p.y} x2={t.x} y2={t.y} />
              <line className="edge" x1={p.x} y1={p.y} x2={d.x} y2={d.y} />
            </g>
          );
        })}
        {G.disc.map((n) => (
          <g className="ao-gdisc" key={n.id}>
            <rect x={n.x - n.w / 2} y={n.y - 12} width={n.w} height={24} rx="8"></rect>
            <text x={n.x} y={n.y + 3.5} textAnchor="middle">{n.l}</text>
          </g>
        ))}
        {G.topics.map((n) => (
          <g className="ao-gnode topic" key={n.id}>
            <circle cx={n.x} cy={n.y} r="6"></circle>
            <text x={n.x} y={n.y - 11} textAnchor="middle">{n.l}</text>
          </g>
        ))}
        {G.papers.map((n) => (
          <g className={"ao-gnode paper" + (n.nw ? " new" : "")} key={n.id} onClick={() => setSel(n.id)}>
            <circle cx={n.x} cy={n.y} r="5" stroke={sel === n.id ? "var(--text-primary)" : "none"} strokeWidth="1.5"></circle>
            <text x={n.x} y={n.y + 16} textAnchor="middle">{n.l}</text>
          </g>
        ))}
      </svg>
      <div className="ao-glegend">
        <span><span className="d" style={{ background: "var(--accent-primary)" }}></span>paper · new today</span>
        <span><span className="d" style={{ background: "var(--text-tertiary)" }}></span>paper · tracked</span>
        <span><span className="d" style={{ background: "#5E6AD2" }}></span>topic</span>
        <span style={{ marginLeft: "auto" }}>dashed = related topics · click a paper for its evidence ref</span>
      </div>
    </div>
  );
}

function Empty({ h, b }: { h: string; b: string }) {
  return <div className="ao-empty"><div className="h">{h}</div><div className="b">{b}</div></div>;
}

/* ── the room view (frame + tabs + rails + read-only strip) ───────────────── */

function PublicRoomView({ bundle }: { bundle: PublicRoomBundle }) {
  const [tab, setTab] = useState<TabName>("Home");
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const showOps = opsEnabled();
  const tabs: readonly TabName[] = showOps ? [...TABS, "Ops"] : TABS;
  const { meta } = bundle;

  return (
    <div className="ao-public" data-ao-source={bundle.source}>
      <div className="ao-wrap">
        <div className="ao-frame" data-testid="ao-room">
          <div className="ao-rtop">
            <span className="ao-mark" style={{ width: 28, height: 28 }}>N</span>
            <span className="crumb"><span>Public rooms / </span>{meta.title}</span>
            <span className="ao-chip acc"><Ic name="globe" size={11} />public · read-only</span>
            <span className="ao-chip"><Ic name="clock" size={11} />{meta.schedule}</span>
            <span className="grow"></span>
            {/* Viewer count is specimen-only: no viewer tracking exists, so a
                live bundle sets viewersWeek to null and the chip is hidden. */}
            {meta.viewersWeek !== null && (
              <span className="ao-chip"><Ic name="eye" size={11} />{meta.viewersWeek} viewers this week</span>
            )}
            <button className="ao-btn pri" style={{ padding: "6px 13px" }} data-testid="ao-subscribe-btn" onClick={() => setSubscribeOpen(true)}><Ic name="mail" size={13} />Subscribe</button>
          </div>
          <div className="ao-tabs">
            {tabs.map((t) => (
              <button className={"ao-tab" + (t === tab ? " on" : "")} key={t} data-testid={tabTestId(t)} onClick={() => setTab(t)}>
                <Ic name={tabIcon(t)} size={13} />{t}
                {t === "Papers" && <span className="ao-mono" style={{ fontSize: 9.5, color: "var(--text-tertiary)" }}>{meta.papersCount}</span>}
              </button>
            ))}
          </div>

          <div className="ao-rbody">
            <div className="ao-rmain">
              {tab === "Home" && <Brief bundle={bundle} />}
              {tab === "Papers" && <PapersSheet bundle={bundle} />}
              {tab === "Trace" && <RunLog bundle={bundle} />}
              {tab === "Topics" && <TopicsGraph bundle={bundle} />}
              {tab === "Weekly digest" && <Empty h="No weekly digest yet" b="The first one lands Monday 8:00. Weekly digests summarize the week's briefs — top reads by level, most active topics, new authors." />}
              {tab === "Ops" && showOps && (
                <Suspense fallback={<div className="ao-empty"><div className="b">Loading ops panel…</div></div>}>
                  <AlwaysOnOpsPanel />
                </Suspense>
              )}
            </div>
            <div className="ao-rside">
              <ProofFooter bundle={bundle} onOpenTrace={() => setTab("Trace")} />
              {/* Specimen post-it numbers are demo-only — a live room's changes
                  live in the proof footer + run log, never invented here. */}
              {bundle.source === "demo" && (
                <div className="ao-postit">
                  <div className="t"><Ic name="alert" size={12} />What changed · post-its</div>
                  <ul>
                    <li>4 new papers today — 3 topics touched</li>
                    <li>1 source page changed its list markup; parser adjusted, trace attached</li>
                    <li>2 rows carry a quality flag: no version marker on source</li>
                  </ul>
                </div>
              )}
              <div className="ao-postit">
                <div className="t"><Ic name="rss" size={12} />Sources · allowlist</div>
                <ul>
                  <li className="ao-mono" style={{ fontSize: 11 }}>{meta.sourceLine}</li>
                </ul>
                <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: "8px 0 0", lineHeight: 1.55 }}>Expositio is moderated, not peer-reviewed. Summaries carry quality flags and provenance — the room never grades papers as “good.”</p>
              </div>
            </div>
          </div>

          <div className="ao-ro">
            <Ic name="lock" size={13} style={{ color: "var(--text-tertiary)" }} />
            <span className="hint">You're viewing a public room. Only the owner and the room agent can write.</span>
            <span className="grow"></span>
            <button className="ao-btn" style={{ padding: "5px 12px", fontSize: 11.5 }} onClick={() => setSubscribeOpen(true)}><Ic name="mail" size={12} />Get the daily brief by email</button>
          </div>
        </div>
      </div>
      {subscribeOpen && (
        <SubscribeModal roomSlug={meta.slug} roomTitle={meta.title} onClose={() => setSubscribeOpen(false)} />
      )}
    </div>
  );
}

function MissingRoom({ slug }: { slug: string }) {
  return (
    <div className="ao-public">
      <div className="ao-wrap">
        <div className="ao-empty" data-testid="ao-room-missing">
          <div className="h">This public room isn't available</div>
          <div className="b">No published room matches “{slug || "(empty)"}”. Check the link, or browse the public rooms gallery on the landing page.</div>
        </div>
      </div>
    </div>
  );
}

function LivePublicRoom({ slug }: { slug: string }) {
  const bundle = usePublicRoomData(slug);
  if (!bundle) return <MissingRoom slug={slug} />;
  return <PublicRoomView bundle={bundle} />;
}

export function PublicRoomPage({ slug }: { slug: string }) {
  const normalized = normalizeRoomSlug(slug);
  const demo = fallbackRoomBundle(normalized);
  const demoView = demo ? <PublicRoomView bundle={demo} /> : <MissingRoom slug={normalized} />;
  if (!HAS_CONVEX) return demoView;
  return (
    <AoFallbackBoundary fallback={demoView}>
      <LivePublicRoom slug={normalized} />
    </AoFallbackBoundary>
  );
}
