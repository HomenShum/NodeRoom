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
import {
  Component,
  lazy,
  Suspense,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

const slugifyUi = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tabSlug = (name: string) => slugifyUi(name);
const tabTestId = (name: string) => `ao-tab-${tabSlug(name)}`;
const tabButtonId = (name: string) => `ao-tab-button-${tabSlug(name)}`;
const tabPanelId = (name: string) => `ao-tab-panel-${tabSlug(name)}`;

type PublicPaper = PublicRoomBundle["papers"][number];
const PAPER_STATUS_FILTERS = ["all", "new", "updated", "tracked"] as const;
type PaperStatusFilter = (typeof PAPER_STATUS_FILTERS)[number];

function matchesPaper(paper: PublicPaper, query: string, status: PaperStatusFilter, topic: string | null): boolean {
  if (status !== "all" && paper.status !== status) return false;
  if (topic && paper.topic !== topic) return false;
  if (!query) return true;
  const haystack = [
    paper.title,
    paper.discipline,
    paper.topic,
    paper.difficulty,
    paper.status,
    paper.firstSeen,
    paper.evidenceRef,
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

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
              <span className="v">
                <button className="ao-proof-link" type="button" data-testid="ao-proof-trace" onClick={onOpenTrace}>
                  {row.v}
                </button>
              </span>
            ) : (
              <span className={"v" + (row.ok ? " ok" : "")}>{row.v}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PapersSheet({
  bundle,
  query,
  status,
  topic,
  onQueryChange,
  onStatusChange,
  onTopicChange,
}: {
  bundle: PublicRoomBundle;
  query: string;
  status: PaperStatusFilter;
  topic: string | null;
  onQueryChange: (query: string) => void;
  onStatusChange: (status: PaperStatusFilter) => void;
  onTopicChange: (topic: string | null) => void;
}) {
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredPapers = useMemo(
    () => bundle.papers.filter((paper) => matchesPaper(paper, normalizedQuery, status, topic)),
    [bundle.papers, normalizedQuery, status, topic],
  );
  const countLabel = `${filteredPapers.length} of ${bundle.papers.length} papers`;
  const clearFilters = () => {
    onQueryChange("");
    onStatusChange("all");
    onTopicChange(null);
  };

  return (
    <div className="ao-paper-panel" data-testid="ao-papers-panel">
      <div className="ao-paper-tools" data-testid="ao-paper-tools">
        <div className="ao-paper-search">
          <label htmlFor="ao-paper-search">Search papers</label>
          <input
            id="ao-paper-search"
            className="ao-input ao-paper-input"
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Title, topic, source"
            data-testid="ao-paper-search"
          />
        </div>
        <div className="ao-paper-status" role="group" aria-label="Paper status">
          <span className="ao-filter-label">Status</span>
          {PAPER_STATUS_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={"ao-filter" + (status === option ? " on" : "")}
              aria-pressed={status === option}
              data-testid={`ao-paper-status-${option}`}
              onClick={() => onStatusChange(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="ao-paper-meter">
          <span className="ao-chip ao-chip-xs" data-testid="ao-paper-count">{countLabel}</span>
          {(query || status !== "all" || topic) && (
            <button className="ao-btn ghost ao-btn-sm" type="button" data-testid="ao-paper-clear" onClick={clearFilters}>
              Clear
            </button>
          )}
        </div>
        {topic && (
          <div className="ao-paper-topic" data-testid="ao-paper-topic">
            <span className="ao-filter-label">Topic</span>
            <button className="ao-chip ao-topic-chip on" type="button" onClick={() => onTopicChange(null)}>
              {topic}
              <span aria-hidden="true">x</span>
            </button>
          </div>
        )}
      </div>
      {filteredPapers.length === 0 ? (
        <div className="ao-empty ao-paper-empty" data-testid="ao-paper-empty">
          <div className="h">No matching papers</div>
          <div className="b">Adjust the search or status filter.</div>
        </div>
      ) : (
        <>
          <div className="ao-sheet">
            <table>
              <colgroup><col style={{ width: "34%" }} /><col style={{ width: "15%" }} /><col style={{ width: "13%" }} /><col style={{ width: "11%" }} /><col style={{ width: "12%" }} /><col style={{ width: "15%" }} /></colgroup>
              <thead><tr><th>Title</th><th>Discipline</th><th>Difficulty</th><th>Status</th><th>First seen</th><th>Evidence</th></tr></thead>
              <tbody>
                {filteredPapers.map((p) => (
                  <tr key={p.title} data-testid="ao-paper-row">
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
          <div className="ao-paper-cards" data-testid="ao-paper-cards">
            {filteredPapers.map((p) => (
              <article className="ao-paper-card" key={p.title} data-testid="ao-paper-card">
                <div className="ao-paper-card-top">
                  <span className={"ao-st " + p.status}>{p.status}</span>
                  <span className="ao-mono">{p.firstSeen}</span>
                </div>
                <h3>{p.title}</h3>
                <div className="tag">{p.topic}</div>
                <div className="ao-paper-card-meta">
                  <span>{p.discipline}</span>
                  <span>{p.difficulty}</span>
                </div>
                <span className="ao-src"><Ic name="link" size={10} />{p.evidenceRef}</span>
              </article>
            ))}
          </div>
        </>
      )}
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
function TopicsGraph({ bundle, onTopicSelect }: { bundle: PublicRoomBundle; onTopicSelect: (topic: string) => void }) {
  const topics = useMemo(() => [...new Set(bundle.papers.map((p) => p.topic).filter(Boolean))], [bundle.papers]);
  const disciplines = useMemo(() => [...new Set(bundle.papers.map((p) => p.discipline).filter(Boolean))], [bundle.papers]);
  if (bundle.source === "demo") return <TopicsGraphSpecimen onTopicSelect={onTopicSelect} />;
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
        <div className="ao-live-topic-tags">
          {disciplines.map((d) => (
            <span className="ao-chip" key={d} style={{ fontWeight: 800 }}>{d}</span>
          ))}
          {topics.map((t) => (
            <button
              className="ao-chip ao-topic-chip"
              type="button"
              key={t}
              data-testid={`ao-topic-${slugifyUi(t)}`}
              onClick={() => onTopicSelect(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="ao-glegend">
        <span>counts derived from the live papers index</span>
        <span style={{ marginLeft: "auto" }}>topic chips filter the papers sheet</span>
      </div>
    </div>
  );
}

function TopicsGraphSpecimen({ onTopicSelect }: { onTopicSelect: (topic: string) => void }) {
  const [sel, setSel] = useState("p1");
  const sp = G.papers.find((p) => p.id === sel);
  const spTopic = sp ? gfind(sp.t) : undefined;
  const choosePaper = (paperId: string) => setSel(paperId);
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
          <g
            className={"ao-gnode paper" + (n.nw ? " new" : "")}
            key={n.id}
            role="button"
            tabIndex={0}
            aria-label={`Select ${n.l.replace("â€¦", "")}`}
            onClick={() => choosePaper(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                choosePaper(n.id);
              }
            }}
          >
            <circle cx={n.x} cy={n.y} r="5" stroke={sel === n.id ? "var(--text-primary)" : "none"} strokeWidth="1.5"></circle>
            <text x={n.x} y={n.y + 16} textAnchor="middle">{n.l}</text>
          </g>
        ))}
      </svg>
      <div className="ao-topic-strip" aria-label="Filter papers by topic">
        {G.topics.map((topic) => (
          <button
            className="ao-chip ao-topic-chip"
            type="button"
            key={topic.id}
            data-testid={`ao-topic-${slugifyUi(topic.l)}`}
            onClick={() => onTopicSelect(topic.l)}
          >
            {topic.l}
          </button>
        ))}
      </div>
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
  const [paperQuery, setPaperQuery] = useState("");
  const [paperStatus, setPaperStatus] = useState<PaperStatusFilter>("all");
  const [paperTopic, setPaperTopic] = useState<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const subscribeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const showOps = opsEnabled();
  const tabs: readonly TabName[] = showOps ? [...TABS, "Ops"] : TABS;
  const { meta } = bundle;
  const closeSubscribe = () => {
    setSubscribeOpen(false);
    window.requestAnimationFrame(() => subscribeTriggerRef.current?.focus({ preventScroll: true }));
  };
  const selectTopic = (topic: string) => {
    setPaperTopic(topic);
    setPaperQuery("");
    setPaperStatus("all");
    setTab("Papers");
  };
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, current: TabName) => {
    const currentIndex = tabs.indexOf(current);
    let nextIndex = currentIndex;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") nextIndex = (currentIndex + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = tabs.length - 1;
    else return;
    e.preventDefault();
    const next = tabs[nextIndex];
    setTab(next);
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };

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
            <button
              className="ao-btn pri ao-btn-sm"
              type="button"
              data-testid="ao-subscribe-btn"
              onClick={(e) => {
                subscribeTriggerRef.current = e.currentTarget;
                setSubscribeOpen(true);
              }}
            >
              <Ic name="mail" size={13} />Subscribe
            </button>
          </div>
          <div className="ao-tabs" role="tablist" aria-label="Room sections">
            {tabs.map((t) => (
              <button
                className={"ao-tab" + (t === tab ? " on" : "")}
                key={t}
                type="button"
                role="tab"
                id={tabButtonId(t)}
                aria-selected={t === tab}
                aria-controls={tabPanelId(t)}
                tabIndex={t === tab ? 0 : -1}
                data-testid={tabTestId(t)}
                ref={(el) => {
                  tabRefs.current[t] = el;
                }}
                onClick={() => setTab(t)}
                onKeyDown={(e) => handleTabKeyDown(e, t)}
              >
                <Ic name={tabIcon(t)} size={13} />{t}
                {t === "Papers" && <span className="ao-mono ao-tab-count">{meta.papersCount}</span>}
              </button>
            ))}
          </div>

          <div className="ao-rbody">
            <div className="ao-rmain" role="tabpanel" id={tabPanelId(tab)} aria-labelledby={tabButtonId(tab)} tabIndex={0}>
              {tab === "Home" && <Brief bundle={bundle} />}
              {tab === "Papers" && (
                <PapersSheet
                  bundle={bundle}
                  query={paperQuery}
                  status={paperStatus}
                  topic={paperTopic}
                  onQueryChange={setPaperQuery}
                  onStatusChange={setPaperStatus}
                  onTopicChange={setPaperTopic}
                />
              )}
              {tab === "Trace" && <RunLog bundle={bundle} />}
              {tab === "Topics" && <TopicsGraph bundle={bundle} onTopicSelect={selectTopic} />}
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
            <button
              className="ao-btn ao-btn-sm"
              type="button"
              onClick={(e) => {
                subscribeTriggerRef.current = e.currentTarget;
                setSubscribeOpen(true);
              }}
            >
              <Ic name="mail" size={12} />Get the daily brief by email
            </button>
          </div>
        </div>
      </div>
      {subscribeOpen && (
        <SubscribeModal roomSlug={meta.slug} roomTitle={meta.title} onClose={closeSubscribe} />
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
