/**
 * AlwaysOnCards — the "Live public rooms" landing gallery.
 *
 * Ports LandingSection from design-reference/alwayson/ao-factory.jsx (§3
 * landing cards) with card CSS lifted verbatim from
 * design-reference/alwayson/ao.css §3 (.ao-cards / .ao-card / .ao-kicker /
 * .ao-btn), shipped in src/alwayson/alwayson.css by the room lane.
 *
 * HONEST LIVENESS: when Convex is available the gallery reads
 * alwaysOn.listPublicRooms (same typed-cast seam as usePublicRoomData) and
 * renders the REAL rooms — name, description, lastMetric, lastRunAt freshness,
 * and lastRunStatus health (a failed/capped room shows exactly that state,
 * never a live pulse). Memory mode, a missing backend module, an erroring
 * query, or an empty room table all fall back to the AO_CARDS specimen set —
 * stamped data-ao-source="demo" with a neutral "demo" pulse badge (green is
 * success semantics only; specimen numbers are never presented as live).
 *
 * Card actions (both modes):
 *   - "Open room"  → #rooms/<slug> (public read-only room page)
 *   - "Subscribe"  → SubscribeModal (double opt-in email digest)
 */
import { Component, useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
import { AO_CARDS } from "../alwayson/demoData";
import { SubscribeModal } from "../alwayson/SubscribeModal";
import {
  useLivePublicRoomCards,
  type AoLiveCard,
  type AoLiveCardHealth,
} from "../alwayson/usePublicRoomData";
import { HAS_CONVEX } from "../app/store";
import "../alwayson/alwayson.css";

const openRoom = (slug: string) => {
  window.location.hash = `#rooms/${slug}`;
};

type CardRow = {
  slug: string;
  name: string;
  desc: string;
  updated: string;
  metric: string;
  health: AoLiveCardHealth | "demo";
};

type SubscribeTarget = { slug: string; name: string };

/** Specimen cards, stamped demo — badge + section attribute say so on the DOM. */
const DEMO_ROWS: CardRow[] = AO_CARDS.map((c) => ({
  slug: c.slug,
  name: c.name,
  desc: c.desc,
  updated: c.updated,
  metric: c.metric,
  health: "demo",
}));

/**
 * Health → badge. Green pulse ONLY for a genuinely healthy live room
 * (last run ok, or skipped = scanned + hash unchanged). Demo keeps the pulse
 * dot but neutral styling and the text "demo". failed = danger, capped =
 * needs-review amber, none = neutral "no runs yet".
 */
function HealthBadge({ health }: { health: CardRow["health"] }) {
  if (health === "demo") return <span className="live demo"><span className="d" />demo</span>;
  if (health === "ok" || health === "skipped") return <span className="live"><span className="d" />live</span>;
  if (health === "failed") return <span className="ao-chip bad">failed</span>;
  if (health === "capped") return <span className="ao-chip warn">capped</span>;
  return <span className="ao-chip">no runs yet</span>;
}

function CardsSection({
  rows,
  source,
  onSubscribe,
}: {
  rows: CardRow[];
  source: "live" | "demo";
  onSubscribe: (target: SubscribeTarget) => void;
}) {
  return (
    <section
      className="rs-proof-section rs-live-rooms"
      data-testid="ao-landing-cards"
      data-ao-source={source}
    >
      <h2 className="rs-section-h">The product demonstrates itself: live public rooms.</h2>
      <p className="rs-section-sub">
        Rooms a NodeAgent visibly maintains on a schedule — public and read-only. Each card shows
        the room, its scope, freshness, and its latest metric; open one to see the brief, sources,
        and run log.
      </p>

      {/* Card internals are the .ao-* specimen markup — do not restyle here. */}
      <div style={{ textAlign: "left" }}>
        <div className="ao-kicker" style={{ marginBottom: 12 }}>
          {source === "demo" ? "Explore public rooms · demo preview" : "Explore public rooms"}
        </div>
        <div className="ao-cards">
          {rows.map((c) => (
            <div className="ao-card" key={c.slug} data-testid={`ao-card-${c.slug}`}>
              <div className="top">
                <span className="nm">{c.name}</span>
                <span className="grow" />
                <HealthBadge health={c.health} />
              </div>
              <div className="desc">{c.desc}</div>
              <div className="meta">{c.updated} · {c.metric}</div>
              <div className="acts">
                <button
                  type="button"
                  className="ao-btn"
                  style={{ padding: "5px 11px", fontSize: 11.5 }}
                  data-testid="ao-card-open"
                  onClick={() => openRoom(c.slug)}
                >
                  Open room
                </button>
                <button
                  type="button"
                  className="ao-btn ghost"
                  style={{ padding: "5px 11px", fontSize: 11.5 }}
                  data-testid="ao-card-subscribe"
                  onClick={() => onSubscribe({ slug: c.slug, name: c.name })}
                >
                  <Mail size={12} /> Subscribe
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Live gallery — ONLY mounted under ConvexProvider (gated by HAS_CONVEX below). */
function LiveCardsSection({ onSubscribe }: { onSubscribe: (target: SubscribeTarget) => void }) {
  const cards = useLivePublicRoomCards();
  // Loading / empty / malformed → demo, honestly stamped as demo.
  if (!cards) return <CardsSection rows={DEMO_ROWS} source="demo" onSubscribe={onSubscribe} />;
  return <CardsSection rows={cards.map((c: AoLiveCard) => ({ ...c }))} source="live" onSubscribe={onSubscribe} />;
}

/* Silent fallback boundary: a throwing live query (e.g. alwaysOn module not
   deployed) renders the demo gallery — same contract as PublicRoomPage. */
class AoCardsBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("[alwayson] live room cards unavailable — using demo data", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function AlwaysOnCards() {
  // The card whose email-digest subscribe flow is open (null = closed).
  const [subscribeCard, setSubscribeCard] = useState<SubscribeTarget | null>(null);

  const demoSection = <CardsSection rows={DEMO_ROWS} source="demo" onSubscribe={setSubscribeCard} />;

  return (
    <>
      {HAS_CONVEX ? (
        <AoCardsBoundary fallback={demoSection}>
          <LiveCardsSection onSubscribe={setSubscribeCard} />
        </AoCardsBoundary>
      ) : (
        demoSection
      )}
      {subscribeCard && (
        <SubscribeModal
          roomSlug={subscribeCard.slug}
          roomTitle={subscribeCard.name}
          onClose={() => setSubscribeCard(null)}
        />
      )}
    </>
  );
}
