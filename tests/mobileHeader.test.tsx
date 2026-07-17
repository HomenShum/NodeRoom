// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MobileHeader,
  formatMobileReviewBadge,
  type MobileHeaderAction,
} from "../src/ui/mobile/shell/MobileHeader";

afterEach(cleanup);

function renderHeader(reviewCount = 0, roomName = "Q3 Diligence") {
  const onSwitchRoom = vi.fn();
  const onOpenReview = vi.fn();
  const onJobs = vi.fn();
  const onPeople = vi.fn();
  const secondaryActions: MobileHeaderAction[] = [
    { id: "jobs", label: "Agent jobs", icon: "history", meta: "2", onSelect: onJobs },
    { id: "people", label: "People", icon: "users", onSelect: onPeople },
  ];
  render(
    <MobileHeader
      roomName={roomName}
      roomLive
      reviewCount={reviewCount}
      onSwitchRoom={onSwitchRoom}
      onOpenReview={onOpenReview}
      secondaryActions={secondaryActions}
    />,
  );
  return { onSwitchRoom, onOpenReview, onJobs, onPeople };
}

describe("MobileHeader", () => {
  it("keeps room, Review, and Overflow as stable commands", () => {
    const actions = renderHeader(0);

    expect(screen.queryByTestId("mobile-review-badge")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch room, current room Q3 Diligence" }));
    fireEvent.click(screen.getByRole("button", { name: "Review inbox, 0 items" }));

    expect(actions.onSwitchRoom).toHaveBeenCalledOnce();
    expect(actions.onOpenReview).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "More room actions" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("bounds the visible badge at 9+ while preserving the exact accessible count", () => {
    const { rerender } = render(
      <MobileHeader
        roomName="Room"
        roomLive={false}
        reviewCount={4}
        onSwitchRoom={() => undefined}
        onOpenReview={() => undefined}
        secondaryActions={[]}
      />,
    );
    expect(screen.getByTestId("mobile-review-badge").textContent).toContain("4");
    expect(screen.getByRole("button", { name: "Review inbox, 4 items" })).toBeTruthy();

    rerender(
      <MobileHeader
        roomName="Room"
        roomLive={false}
        reviewCount={100}
        onSwitchRoom={() => undefined}
        onOpenReview={() => undefined}
        secondaryActions={[]}
      />,
    );
    expect(screen.getByTestId("mobile-review-badge").textContent).toContain("9+");
    expect(screen.getByRole("button", { name: "Review inbox, 100 items" })).toBeTruthy();
    expect(formatMobileReviewBadge(9)).toBe("9");
    expect(formatMobileReviewBadge(10)).toBe("9+");
  });

  it("opens only secondary commands and closes before invoking one", () => {
    const actions = renderHeader(4);
    fireEvent.keyDown(screen.getByRole("button", { name: "More room actions" }), { key: "Enter" });

    const menu = screen.getByTestId("mobile-overflow-menu");
    expect(within(menu).getByRole("menuitem", { name: "Agent jobs 2" })).toBeTruthy();
    expect(within(menu).queryByText("Home")).toBeNull();
    expect(within(menu).queryByText("Review")).toBeNull();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "People" }));
    expect(actions.onPeople).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("mobile-overflow-menu")).toBeNull();
  });

  it("closes overflow on Escape and preserves a long room title for CSS ellipsis", () => {
    const title = "A very long governed diligence room title with an_unbroken_identifier_that_must_not_move_commands";
    renderHeader(4, title);
    expect(screen.getByTestId("mobile-room-title").textContent).toContain(title);

    fireEvent.keyDown(screen.getByRole("button", { name: "More room actions" }), { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("mobile-overflow-menu")).toBeNull();
  });
});
