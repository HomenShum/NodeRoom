import * as React from "react";
import { Ico, type IconName } from "../MobileIcons";

export interface MobileHeaderAction {
  id: string;
  label: string;
  icon: IconName;
  meta?: string;
  onSelect: () => void;
}

export interface MobileHeaderProps {
  roomName: string;
  roomLive: boolean;
  reviewCount: number;
  scrolled?: boolean;
  onSwitchRoom: () => void;
  onOpenReview: () => void;
  secondaryActions: MobileHeaderAction[];
}

export function formatMobileReviewBadge(count: number): string {
  return count > 9 ? "9+" : String(Math.max(0, count));
}

export function MobileHeader({
  roomName,
  roomLive,
  reviewCount,
  scrolled = false,
  onSwitchRoom,
  onOpenReview,
  secondaryActions,
}: MobileHeaderProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRoot = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent): void => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const choose = (action: MobileHeaderAction): void => {
    setMenuOpen(false);
    action.onSelect();
  };
  const reviewLabel = reviewCount > 0
    ? `Review inbox, ${reviewCount} ${reviewCount === 1 ? "item" : "items"}`
    : "Review inbox, 0 items";

  return (
    <div className="na-top" data-scrolled={scrolled ? "true" : undefined}>
      <header className="mobile-header" data-testid="mobile-header">
        <button
          type="button"
          className="mobile-room-context"
          data-testid="mobile-room-context"
          aria-label={`Switch room, current room ${roomName}`}
          title="Switch room"
          onClick={onSwitchRoom}
        >
          <span className="mobile-room-mark" aria-hidden="true">
            N
            {roomLive ? <i className="mobile-room-live" /> : null}
          </span>
          <span className="mobile-room-title" data-testid="mobile-room-title">{roomName}</span>
          {Ico("chevD", { "aria-hidden": true })}
        </button>

        <div className="mobile-header-actions">
          <button
            type="button"
            className="mobile-header-action"
            data-testid="mobile-review-action"
            aria-label={reviewLabel}
            title="Review inbox"
            onClick={onOpenReview}
          >
            {Ico("inbox", { "aria-hidden": true })}
            {reviewCount > 0 ? (
              <span className="mobile-review-badge" data-testid="mobile-review-badge" aria-hidden="true">
                {formatMobileReviewBadge(reviewCount)}
              </span>
            ) : null}
          </button>

          <div className="mobile-overflow-wrap" ref={menuRoot}>
            <button
              type="button"
              className="mobile-header-action"
              data-testid="mobile-overflow-action"
              aria-label="More room actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen ? "true" : "false"}
              title="More room actions"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {Ico("more", { "aria-hidden": true })}
            </button>
            {menuOpen ? (
              <div className="mobile-overflow-menu" data-testid="mobile-overflow-menu" role="menu" aria-label="Room actions">
                {secondaryActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="mobile-overflow-item"
                    role="menuitem"
                    onClick={() => choose(action)}
                  >
                    {Ico(action.icon, { "aria-hidden": true })}
                    <span>{action.label}</span>
                    {action.meta ? <span className="mobile-overflow-meta">{action.meta}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>
    </div>
  );
}
