// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "../src/ui/mobile/MobileScreens";
import type { InboxItem } from "../src/ui/mobile/mobileData";
import type { MobileCtx } from "../src/ui/mobile/mobileTypes";

afterEach(cleanup);

describe("mobile governed proposal inbox", () => {
  it("shows the real deck diff and receipts before the host decision", async () => {
    const item: InboxItem = {
      id: "proposal-deck-1",
      icon: "layers",
      tone: "accent",
      title: "Deck slide proposal",
      sub: "Slide 1 - review before it lands",
      status: "approve",
      statusTone: "warn",
      time: "now",
      kind: "deck",
      preview: "deck",
      review: {
        target: "Slide 1 - ARR bridge",
        before: "Title: ARR bridge",
        after: "Title: Evidence-backed ARR bridge",
        sources: ["ARR worksheet"],
        traceIds: ["trace-1"],
        traceOverflow: 4,
      },
    };
    const resolveProposalById = vi.fn(async () => ({ ok: true }));
    const toast = vi.fn();
    const ctx = {
      resolved: {},
      inboxItems: [item],
      isLive: true,
      loading: false,
      canApprove: true,
      resolveProposalById,
      openInbox: vi.fn(),
      toast,
    } as unknown as MobileCtx;

    render(<Inbox ctx={ctx} />);

    const review = screen.getByTestId("mobile-proposal-review");
    expect(review.textContent).toContain("Title: ARR bridge");
    expect(review.textContent).toContain("Title: Evidence-backed ARR bridge");
    expect(review.textContent).toContain("ARR worksheet");
    expect(review.textContent).toContain("Context trace trace-1");
    expect(review.textContent).toContain("+4 more context traces");
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(resolveProposalById).toHaveBeenCalledWith("proposal-deck-1", true));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Approved/));
  });

  it("routes rejection through the same live proposal resolver", async () => {
    const resolveProposalById = vi.fn(async () => ({ ok: true }));
    const ctx = {
      resolved: {},
      inboxItems: [{
        id: "proposal-deck-2",
        icon: "layers",
        tone: "accent",
        title: "Deck slide proposal",
        sub: "Slide 2 - review before it lands",
        status: "approve",
        statusTone: "warn",
        time: "now",
        kind: "deck",
        preview: "deck",
      } satisfies InboxItem],
      isLive: true,
      loading: false,
      canApprove: true,
      resolveProposalById,
      openInbox: vi.fn(),
      toast: vi.fn(),
    } as unknown as MobileCtx;

    render(<Inbox ctx={ctx} />);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(resolveProposalById).toHaveBeenCalledWith("proposal-deck-2", false));
  });
});
