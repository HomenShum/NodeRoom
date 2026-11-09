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
 * never a live pulse). Loading, an empty room table and an erroring query each
 * render an explicit status line — never specimen cards. Without Convex the
 * section is not rendered at all.
 *
 * Card actions:
 *   - "Open room"  → #rooms/<slug> (public read-only room page)
 *   - "Subscribe"  → SubscribeModal (double opt-in email digest)
 */
import { Component, useState, type ReactNode } from "react";
import { Mail } from "lucide-react";
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

type SubscribeTarget = { slug: string; name: string };

/**
 * Health → badge. Green pulse ONLY for a genuinely healthy live room
 * (last run ok, or skipped = scanned + hash unchanged). failed = danger,
 * capped = needs-review amber, none = neutral "no runs yet".
 */
function HealthBadge({ health }: { health: AoLiveCardHealth }) {
  if (health === "ok" || health === "skipped") return <span className="live"><span className="d" />live</span>;
  if (health === "failed") return <span className="ao-chip bad">failed</span>;
  if (health === "capped") return <span className="ao-chip warn">capped</span>;
  return <span className="ao-chip">no runs yet</span>;
}

function CardsSection({
  rows,
  status,
  onSubscribe,
}: {
  rows: AoLiveCard[];
  /** Loading / empty / unavailable line shown instead of cards. */
  status?: string;
  onSubscribe: (target: SubscribeTarget) => void;
}) {
  return (
    <section
      className="rs-proof-section rs-live-rooms"
      data-testid="ao-landing-cards"
      data-ao-source="live"
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
          Explore public rooms
        </div>
        {status && <div className="ao-empty" data-testid="ao-landing-cards-status"><div className="b">{status}</div></div>}
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
  if (cards === undefined) return <CardsSection rows={[]} status="Loading public rooms…" onSubscribe={onSubscribe} />;
  if (!cards) return <CardsSection rows={[]} status="No public rooms are published yet." onSubscribe={onSubscribe} />;
  return <CardsSection rows={cards} onSubscribe={onSubscribe} />;
}

/* Error boundary: a throwing live query (e.g. alwaysOn module not deployed)
   renders an explicit unavailable line — never specimen cards. */
class AoCardsBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn("[alwayson] live room cards unavailable", error);
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function AlwaysOnCards() {
  // The card whose email-digest subscribe flow is open (null = closed).
  const [subscribeCard, setSubscribeCard] = useState<SubscribeTarget | null>(null);

  if (!HAS_CONVEX) return null;

  return (
    <>
      <AoCardsBoundary fallback={<CardsSection rows={[]} status="Public rooms are unavailable right now." onSubscribe={setSubscribeCard} />}>
        <LiveCardsSection onSubscribe={setSubscribeCard} />
      </AoCardsBoundary>
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
