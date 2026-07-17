import * as React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
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

          <DropdownMenu>
          <div className="mobile-overflow-wrap">
            <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="mobile-header-action"
              data-testid="mobile-overflow-action"
              aria-label="More room actions"
              title="More room actions"
            >
              {Ico("more", { "aria-hidden": true })}
            </button>
            </DropdownMenuTrigger>
              <DropdownMenuContent className="mobile-overflow-menu" data-testid="mobile-overflow-menu" aria-label="Room actions" align="end" sideOffset={4} collisionPadding={8}>
                {secondaryActions.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    className="mobile-overflow-item"
                    onSelect={action.onSelect}
                  >
                    {Ico(action.icon, { "aria-hidden": true })}
                    <span>{action.label}</span>
                    {action.meta ? <span className="mobile-overflow-meta">{action.meta}</span> : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
          </div>
          </DropdownMenu>
        </div>
      </header>
    </div>
  );
}
